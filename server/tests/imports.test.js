import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { MIGRATIONS } from '../src/migrations.js';
import { startServer, sticky } from './helpers.js';

describe('Idempotence des imports de tableaux', () => {
  let s, owner, other;
  const create = (user, importKey, name = 'Importé') => s.call('POST', '/api/boards', {
    cookie: user.token,
    body: { name, importKey, data: { items: [sticky('item-1')] } }
  });
  const ownedCount = user => s.app.db.prepare("SELECT COUNT(*) AS n FROM board_members WHERE user_id = ? AND role = 'owner'").get(user.id).n;

  before(async () => {
    s = await startServer();
    owner = await s.signUp('Importatrice');
    other = await s.signUp('Autre compte');
  });
  after(() => s.close());

  it('renvoie le tableau existant au second POST sans créer de doublon', async () => {
    const first = await create(owner, 'local_board-1');
    const again = await create(owner, 'local_board-1');
    assert.equal(first.status, 201);
    assert.equal(first.body.existing, undefined);
    assert.equal(again.status, 200);
    assert.equal(again.body.existing, true);
    assert.equal(again.body.rev, first.body.rev);
    assert.equal(again.body.role, 'owner');
    assert.deepEqual(again.body.board, first.body.board);
    assert.equal(ownedCount(owner), 1);
    assert.deepEqual(s.app.db.prepare('SELECT owner_id, import_key, board_id FROM board_imports').all(), [
      { owner_id: owner.id, import_key: 'local_board-1', board_id: first.body.board.id }
    ]);
  });

  it('isole une même clé entre deux comptes', async () => {
    const first = await create(owner, 'shared_key');
    const second = await create(other, 'shared_key');
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(second.body.board.id, first.body.board.id);
    assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM board_imports WHERE import_key = 'shared_key'").get().n, 2);
  });

  it('permet de réutiliser la clé après suppression du tableau', async () => {
    const first = await create(owner, 'deleted_then_reimported');
    assert.equal((await s.call('DELETE', `/api/boards/${first.body.board.id}`, { cookie: owner.token })).status, 204);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM board_imports WHERE board_id = ?').get(first.body.board.id).n, 0);
    const second = await create(owner, 'deleted_then_reimported');
    assert.equal(second.status, 201);
    assert.notEqual(second.body.board.id, first.body.board.id);
  });

  it('refuse les clés absentes du contrat avec invalid_import_key', async () => {
    for (const importKey of ['', 'avec espace', 'accentué', 'a.b', 'x'.repeat(101), null, 42]) {
      const res = await create(owner, importKey);
      assert.equal(res.status, 400, JSON.stringify(importKey));
      assert.equal(res.body.code, 'invalid_import_key');
      assert.equal(res.body.path, 'importKey');
    }
  });

  it('ne recompte pas le tableau au quota lors d’une répétition', async () => {
    const user = await s.signUp('Quota import');
    const insertBoard = s.app.db.prepare('INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, ?, 0, 0)');
    const insertOwner = s.app.db.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'owner', 0)");
    s.app.db.transaction(() => {
      for (let i = 0; i < 99; i++) {
        insertBoard.run(`quota-import-${i}`, 'Existant');
        insertOwner.run(`quota-import-${i}`, user.id);
      }
    })();
    const first = await create(user, 'centieme');
    const again = await create(user, 'centieme');
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.body.existing, true);
    assert.equal(ownedCount(user), 100);
  });

  it('nettoie les clés quand le compte est supprimé', async () => {
    const user = await s.signUp('Compte supprimé');
    const created = await create(user, 'cascade_account');
    assert.equal(created.status, 201);
    s.app.db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM board_imports WHERE owner_id = ?').get(user.id).n, 0);
  });
});

describe('Migration 4', () => {
  it('passe une base existante de la version 3 à la version 4 sans perte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baro-migration-import-'));
    const path = join(dir, 'baro.db');
    try {
      const old = new Database(path);
      old.exec(MIGRATIONS.slice(0, 3).join('\n'));
      old.pragma('user_version = 3');
      old.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES ('u_1', 'a@b.fr', 'Ancienne', 'scrypt$x', 1, 2)").run();
      old.prepare("INSERT INTO boards (id, name, created_at, updated_at) VALUES ('brd_1', 'Ancien', 1, 2)").run();
      old.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES ('brd_1', 'u_1', 'owner', 1)").run();
      old.close();

      const db = openDb(path);
      assert.equal(db.pragma('user_version', { simple: true }), 4);
      assert.equal(MIGRATIONS.length, 4);
      assert.equal(db.prepare('SELECT name FROM boards WHERE id = ?').get('brd_1').name, 'Ancien');
      db.prepare("INSERT INTO board_imports (owner_id, import_key, board_id, created_at) VALUES ('u_1', 'legacy-key', 'brd_1', 3)").run();
      assert.throws(() => db.prepare("INSERT INTO board_imports (owner_id, import_key, board_id, created_at) VALUES ('u_1', 'legacy-key', 'brd_1', 4)").run(), /UNIQUE/);
      db.prepare("DELETE FROM boards WHERE id = 'brd_1'").run();
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM board_imports').get().n, 0);
      db.close();

      const again = openDb(path);
      assert.equal(again.pragma('user_version', { simple: true }), 4);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
