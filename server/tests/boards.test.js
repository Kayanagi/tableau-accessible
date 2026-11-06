import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { hashToken } from '../src/auth.js';
import { startServer, sticky } from './helpers.js';

const BACKUP_SCRIPT = fileURLToPath(new URL('../scripts/backup.mjs', import.meta.url));

describe('API des tableaux', () => {
  let s, owner, editor, viewer, stranger;
  const addMember = (boardId, user, role) => s.app.db.prepare('INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, ?, 0)').run(boardId, user.id, role);
  const newBoard = async (body = {}) => {
    const res = await s.call('POST', '/api/boards', { cookie: owner.token, body: { name: 'Tableau', data: { items: [sticky('item-1')] }, ...body } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.board.id;
  };

  before(async () => {
    s = await startServer();
    [owner, editor, viewer, stranger] = await Promise.all(['Propriétaire', 'Éditrice', 'Lectrice', 'Étranger'].map(n => s.signUp(n)));
  });
  after(() => s.close());

  it('crée un tableau et restitue des données identiques au rechargement', async () => {
    const data = {
      name: 'Ignoré si name est donné',
      background: 'cream',
      frameOrder: ['f-1'],
      tags: [{ id: 'tag-1', name: 'Urgent', color: 'red' }],
      items: [
        { id: 'f-1', type: 'frame', x: 0, y: 0, width: 400, height: 300, content: 'Cadre' },
        sticky('item-2', { parent: 'f-1', tags: ['tag-1'], reactions: { '👍': ['Claire'] }, fontSize: 'auto', bold: false, align: 'center', size: 'm' }),
        { id: 'k-1', type: 'kanban', x: 0, y: 0, width: 548, height: 200, content: 'Kanban', columns: [{ id: 'col-1', name: 'À faire', cards: [{ id: 'card-1', text: 'Écrire' }] }] },
        { id: 'd-1', type: 'datatable', x: 0, y: 0, content: 'Tableau', rows: [['A', 'B'], ['é', '']] },
        { id: 'c-1', type: 'comment', x: 0, y: 0, messages: [{ author: 'Claire', date: '2026-11-05T10:00:00.000Z', text: 'Réponse' }], resolved: false, targetId: 'item-2' },
        { id: 'm-1', type: 'mindmap', x: 0, y: 0, content: 'Racine', parentNode: null, collapsed: false },
        { id: 'm-2', type: 'mindmap', x: 0, y: 0, content: 'Branche', parentNode: 'm-1' },
        { id: 'p-1', type: 'drawing', x: 0, y: 0, points: [0, 0, 10.5, 20], stroke: 'ink', strokeWidth: 4, vw: 10, vh: 20, content: '' },
        { id: 'l-1', type: 'connector', x: 0, y: 0, startId: 'item-2', end: { x: 5, y: 6 }, label: 'Oui', lineType: 'bezier', startCap: 'none', endCap: 'diamond', lineStyle: 'dashed', strokeWidth: 2, stroke: 'violet', waypoints: [{ x: 1, y: 2 }] }
      ]
    };
    const created = await s.call('POST', '/api/boards', { cookie: owner.token, body: { name: 'Mon tableau', icon: 'idea', data } });
    assert.equal(created.status, 201);
    assert.equal(created.body.rev, 0);
    assert.equal(created.body.role, 'owner');
    assert.match(created.body.board.id, /^brd_[\w-]{22}$/);

    const res = await s.call('GET', `/api/boards/${created.body.board.id}`, { cookie: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.rev, 0);
    assert.equal(res.body.role, 'owner');
    assert.equal(res.body.board.name, 'Mon tableau');
    assert.equal(res.body.board.icon, 'idea');
    assert.equal(res.body.board.background, 'cream');
    assert.deepEqual(res.body.board.frameOrder, ['f-1']);
    assert.deepEqual(res.body.board.tags, data.tags);
    assert.deepEqual(res.body.board.items, data.items);
    const meta = JSON.parse(s.app.db.prepare('SELECT meta FROM boards WHERE id = ?').get(created.body.board.id).meta);
    assert.deepEqual(meta, { tags: data.tags, frameOrder: ['f-1'], background: 'cream' });
    const rows = s.app.db.prepare('SELECT item_id, z, rev FROM board_items WHERE board_id = ? ORDER BY z').all(created.body.board.id);
    assert.deepEqual(rows.map(r => r.item_id), data.items.map(i => i.id));
    assert.deepEqual(rows.map(r => r.z), data.items.map((_, i) => i));
  });

  it('applique sanitizeIds et les reprises historiques à l’envoi d’un tableau local', async () => {
    const res = await s.call('POST', '/api/boards', {
      cookie: owner.token,
      body: {
        name: 'Ancien',
        data: {
          items: [
            sticky('id avec espaces', { color: 'yellow', parent: 'parent"cassé' }),
            { id: 'l-1', type: 'connector', lineType: 'arrow', startId: 'id-absent', end: { x: 1, y: 1 } },
            { id: 'k-1', type: 'kanban', x: 0, y: 0 },
            { id: 'c-1', type: 'comment', x: 0, y: 0 }
          ]
        }
      }
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [note, line, kanban, comment] = res.body.board.items;
    assert.equal(note.id, 'item-import-1');
    assert.equal(note.parent, null);
    assert.equal(note.color, 'miro_yellow');
    assert.equal(line.lineType, 'straight');
    assert.equal(line.endCap, 'arrow_filled');
    assert.equal(line.startCap, 'none');
    assert.deepEqual(line.waypoints, []);
    assert.equal(kanban.columns.length, 3);
    assert.deepEqual(comment.messages, []);
  });

  it('accepte une création sans données et prend le nom de data à défaut', async () => {
    const empty = await s.call('POST', '/api/boards', { cookie: owner.token, body: { name: 'Vide' } });
    assert.equal(empty.status, 201);
    assert.deepEqual(empty.body.board.items, []);
    assert.deepEqual(empty.body.board.tags, []);
    assert.equal(empty.body.board.icon, 'board');
    const named = await s.call('POST', '/api/boards', { cookie: owner.token, body: { data: { name: 'Depuis data', items: [] } } });
    assert.equal(named.body.board.name, 'Depuis data');
    const none = await s.call('POST', '/api/boards', { cookie: owner.token, body: { data: { items: [] } } });
    assert.equal(none.status, 400);
    assert.equal(none.body.code, 'invalid_name');
  });

  it('refuse des données invalides à la création, avec le chemin de l’erreur', async () => {
    const res = await s.call('POST', '/api/boards', { cookie: owner.token, raw: `{"name":"X","data":{"items":[{"id":"a","type":"text","x":0,"y":0,"nested":{"__proto__":{"polluted":true}}}]}}` });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'forbidden_key');
    assert.equal(res.body.path, 'data.items[0].nested.__proto__');
    assert.equal(({}).polluted, undefined);
    const icon = await s.call('POST', '/api/boards', { cookie: owner.token, body: { name: 'X', icon: 'constructor' } });
    assert.equal(icon.status, 400);
    assert.equal(icon.body.code, 'invalid_enum');
    for (const data of ['texte', [], { items: 'non' }, { items: [null] }, { items: [5] }]) {
      assert.equal((await s.call('POST', '/api/boards', { cookie: owner.token, body: { name: 'X', data } })).status, 400, JSON.stringify(data));
    }
  });

  it('liste les tableaux du compte : métadonnées, rôle, révision, nombre de membres', async () => {
    const user = await s.signUp('Liste');
    const a = (await s.call('POST', '/api/boards', { cookie: user.token, body: { name: 'A', icon: 'goal', data: { items: [sticky('x')] } } })).body.board.id;
    const b = await newBoard({ name: 'B' });
    addMember(b, user, 'viewer');
    const res = await s.call('GET', '/api/boards', { cookie: user.token });
    assert.equal(res.status, 200);
    const byId = new Map(res.body.boards.map(x => [x.id, x]));
    assert.equal(res.body.boards.length, 2);
    assert.deepEqual(Object.keys(byId.get(a)).sort(), ['createdAt', 'icon', 'id', 'memberCount', 'name', 'rev', 'role', 'updatedAt']);
    assert.equal(byId.get(a).role, 'owner');
    assert.equal(byId.get(a).icon, 'goal');
    assert.equal(byId.get(a).memberCount, 1);
    assert.equal(byId.get(b).role, 'viewer');
    assert.equal(byId.get(b).memberCount, 2);
  });

  it('remplace les données : révision suivante, 409 si baseRev est périmé', async () => {
    const id = await newBoard();
    const data = { items: [sticky('item-9')], tags: [] };
    const first = await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: 0, data } });
    assert.equal(first.status, 200);
    assert.equal(first.body.rev, 1);

    const stale = await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: 0, data: { items: [] } } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'conflict');
    assert.equal(stale.body.rev, 1);
    assert.match(stale.body.message, /modifié/);

    const got = await s.call('GET', `/api/boards/${id}`, { cookie: owner.token });
    assert.equal(got.body.rev, 1);
    assert.deepEqual(got.body.board.items, data.items);
    const row = s.app.db.prepare('SELECT rev FROM board_items WHERE board_id = ?').get(id);
    assert.equal(row.rev, 1);

    for (const baseRev of [undefined, -1, 1.5, '1', null]) {
      const res = await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev, data } });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'invalid_base_rev');
    }
  });

  it('accepte en PUT le tableau tel que renvoyé par GET, y compris ses dates', async () => {
    const id = await newBoard();
    const { rev, board } = (await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).body;
    board.items[0].content = 'Modifié';
    const res = await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: rev, data: board } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const again = (await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).body.board;
    assert.equal(again.items[0].content, 'Modifié');
    assert.equal(again.name, board.name);
    const meta = JSON.parse(s.app.db.prepare('SELECT meta FROM boards WHERE id = ?').get(id).meta);
    assert.deepEqual(Object.keys(meta), ['tags']);
  });

  it('ne répare pas en PUT, et rend les lignes canoniques', async () => {
    const id = await newBoard();
    const bad = await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: 0, data: { items: [sticky('a b')] } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_id');
    assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).body.rev, 0);

    const legacy = await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: 0, data: { items: [{ id: 'l', type: 'connector', lineType: 'arrow' }] } } });
    assert.equal(legacy.status, 400);
    assert.equal(legacy.body.code, 'invalid_enum');

    const res = await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: 0, data: { items: [{ id: 'l', type: 'connector', start: { x: 0, y: 0 }, end: { x: 9, y: 9 }, strokeWidth: 90 }] } } });
    assert.equal(res.status, 200);
    const line = (await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).body.board.items[0];
    assert.equal(line.strokeWidth, 20);
    assert.equal(line.lineType, 'straight');
    assert.equal(line.lineStyle, 'solid');
    assert.equal(line.stroke, 'auto');
    assert.equal(line.endCap, 'arrow_filled');
  });

  it('vide le journal de reprise lors d’un remplacement entier', async () => {
    const id = await newBoard();
    s.app.db.prepare("INSERT INTO board_ops (board_id, rev, client_id, client_seq, actor_name, ops, size, created_at) VALUES (?, 0, 'c', 1, 'A', '[]', 2, 0)").run(id);
    await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: 0, data: { items: [] } } });
    assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM board_ops WHERE board_id = ?').get(id).n, 0);
  });

  it('renomme sans changer la révision ; le nom de data est ignoré par PUT', async () => {
    const id = await newBoard();
    const res = await s.call('PATCH', `/api/boards/${id}`, { cookie: owner.token, body: { name: '  Nouveau nom ', icon: 'launch' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Nouveau nom');
    assert.equal(res.body.icon, 'launch');
    assert.equal(res.body.rev, 0);
    const iconOnly = await s.call('PATCH', `/api/boards/${id}`, { cookie: owner.token, body: { icon: 'goal' } });
    assert.equal(iconOnly.body.name, 'Nouveau nom');
    assert.equal((await s.call('PUT', `/api/boards/${id}/data`, { cookie: owner.token, body: { baseRev: 0, data: { name: 'Ancien nom', items: [] } } })).status, 200);
    assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).body.board.name, 'Nouveau nom');
    assert.equal((await s.call('PATCH', `/api/boards/${id}`, { cookie: owner.token, body: {} })).status, 400);
    assert.equal((await s.call('PATCH', `/api/boards/${id}`, { cookie: owner.token, body: { name: '' } })).status, 400);
    assert.equal((await s.call('PATCH', `/api/boards/${id}`, { cookie: owner.token, body: { name: 'x'.repeat(201) } })).status, 400);
    assert.equal((await s.call('PATCH', `/api/boards/${id}`, { cookie: owner.token, body: { icon: '🚀' } })).status, 400);
  });

  it('supprime en cascade : objets, membres, liens, sessions invitées', async () => {
    const id = await newBoard();
    addMember(id, editor, 'editor');
    s.app.db.prepare("INSERT INTO share_links (id, board_id, token_hash, role, created_at) VALUES ('l1', ?, x'00', 'viewer', 0)").run(id);
    s.app.db.prepare("INSERT INTO sessions (token_hash, share_link_id, guest_name, created_at, last_seen_at, expires_at) VALUES (x'01', 'l1', 'G', 0, 0, ?)").run(Date.now() + 100000);
    const res = await s.call('DELETE', `/api/boards/${id}`, { cookie: owner.token });
    assert.equal(res.status, 204);
    assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).status, 404);
    for (const table of ['board_items', 'board_members', 'share_links']) {
      assert.equal(s.app.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE board_id = ?`).get(id).n, 0, table);
    }
    assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM sessions WHERE token_hash = x'01'").get().n, 0);
  });

  describe('matrice des droits', () => {
    /* role : null pour un étranger. Résultat attendu par route. */
    const EXPECTED = {
      owner: { get: 200, put: 200, patch: 200, del: 204 },
      editor: { get: 200, put: 200, patch: 200, del: 403 },
      viewer: { get: 200, put: 403, patch: 403, del: 403 },
      stranger: { get: 404, put: 404, patch: 404, del: 404 },
      anonymous: { get: 401, put: 401, patch: 401, del: 401 }
    };

    const attempt = async (id, token) => ({
      get: (await s.call('GET', `/api/boards/${id}`, { cookie: token })).status,
      put: (await s.call('PUT', `/api/boards/${id}/data`, { cookie: token, body: { baseRev: 0, data: { items: [] } } })).status,
      patch: (await s.call('PATCH', `/api/boards/${id}`, { cookie: token, body: { name: 'Renommé' } })).status,
      del: (await s.call('DELETE', `/api/boards/${id}`, { cookie: token })).status
    });

    for (const who of Object.keys(EXPECTED)) {
      it(`${who} : GET ${EXPECTED[who].get}, PUT ${EXPECTED[who].put}, PATCH ${EXPECTED[who].patch}, DELETE ${EXPECTED[who].del}`, async () => {
        const id = await newBoard();
        addMember(id, editor, 'editor');
        addMember(id, viewer, 'viewer');
        const tokens = { owner: owner.token, editor: editor.token, viewer: viewer.token, stranger: stranger.token, anonymous: undefined };
        assert.deepEqual(await attempt(id, tokens[who]), EXPECTED[who]);
        if (EXPECTED[who].del !== 204) {
          assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).status, 200);
        }
      });
    }

    it('les routes de compte refusent l’anonyme : 401', async () => {
      for (const [method, path] of [['GET', '/api/me'], ['PATCH', '/api/me'], ['POST', '/api/me/password'], ['DELETE', '/api/me'], ['GET', '/api/me/export'], ['GET', '/api/boards'], ['POST', '/api/boards'], ['POST', '/api/auth/logout']]) {
        assert.equal((await s.call(method, path, { body: method === 'GET' ? undefined : {} })).status, 401, `${method} ${path}`);
      }
    });

    it('n’expose ni membres, ni liens, ni partage, ni WebSocket à cette phase', async () => {
      const id = await newBoard();
      for (const [method, path] of [['GET', `/api/boards/${id}/members`], ['GET', `/api/boards/${id}/links`], ['POST', `/api/boards/${id}/links`], ['POST', '/api/share/join'], ['GET', '/api/ws']]) {
        assert.equal((await s.call(method, path, { cookie: owner.token, body: method === 'GET' ? undefined : {} })).status, 404, `${method} ${path}`);
      }
    });

    describe('invité par lien', () => {
      const guestSession = (boardId, role, linkFields = {}) => {
        const token = `G${Math.random().toString(36).slice(2).padEnd(42, 'x')}`.slice(0, 43);
        const linkId = `link-${Math.random().toString(36).slice(2)}`;
        s.app.db.prepare('INSERT INTO share_links (id, board_id, token_hash, role, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
          .run(linkId, boardId, hashToken(`lien-${linkId}`), role, linkFields.expires_at ?? null, linkFields.revoked_at ?? null);
        s.app.db.prepare('INSERT INTO sessions (token_hash, share_link_id, guest_name, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(hashToken(token), linkId, 'Invité (invité)', Date.now(), Date.now(), Date.now() + 86400000);
        return token;
      };

      it('lecture : son tableau seul, aucune écriture, aucune route de compte', async () => {
        const id = await newBoard();
        const other = await newBoard();
        const token = guestSession(id, 'viewer');
        const me = await s.call('GET', '/api/me', { cookie: token });
        assert.deepEqual(me.body, { guest: true, boardId: id, role: 'viewer', guestName: 'Invité (invité)' });
        const got = await s.call('GET', `/api/boards/${id}`, { cookie: token });
        assert.equal(got.status, 200);
        assert.equal(got.body.role, 'viewer');
        assert.equal((await s.call('GET', `/api/boards/${other}`, { cookie: token })).status, 404);
        assert.equal((await s.call('PUT', `/api/boards/${id}/data`, { cookie: token, body: { baseRev: 0, data: { items: [] } } })).status, 403);
        assert.equal((await s.call('DELETE', `/api/boards/${id}`, { cookie: token })).status, 403);
        for (const [method, path] of [['GET', '/api/boards'], ['POST', '/api/boards'], ['PATCH', '/api/me'], ['GET', '/api/me/export'], ['DELETE', '/api/me'], ['POST', '/api/me/password']]) {
          const res = await s.call(method, path, { cookie: token, body: method === 'GET' ? undefined : {} });
          assert.equal(res.status, 403, `${method} ${path}`);
          assert.equal(res.body.code, 'account_required');
        }
      });

      it('édition : écrit sur son tableau, sans pouvoir le supprimer', async () => {
        const id = await newBoard();
        const token = guestSession(id, 'editor');
        assert.equal((await s.call('PUT', `/api/boards/${id}/data`, { cookie: token, body: { baseRev: 0, data: { items: [] } } })).status, 200);
        assert.equal((await s.call('DELETE', `/api/boards/${id}`, { cookie: token })).status, 403);
      });

      it('lien révoqué ou expiré : session refusée puis supprimée', async () => {
        const id = await newBoard();
        for (const fields of [{ revoked_at: 1 }, { expires_at: Date.now() - 1 }]) {
          const token = guestSession(id, 'editor', fields);
          assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: token })).status, 401);
          assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(hashToken(token)).n, 0);
        }
      });
    });
  });

  it('impose le quota de 100 tableaux possédés, sans compter ceux des autres', async () => {
    const user = await s.signUp('Quota');
    const t = Date.now();
    const insertBoard = s.app.db.prepare('INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    const insertMember = s.app.db.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)");
    s.app.db.transaction(() => {
      for (let i = 0; i < 99; i++) { insertBoard.run(`q-${i}`, 'Q', t, t); insertMember.run(`q-${i}`, user.id, t); }
    })();
    const shared = await newBoard();
    addMember(shared, user, 'editor');
    assert.equal((await s.call('POST', '/api/boards', { cookie: user.token, body: { name: 'Le centième' } })).status, 201);
    const res = await s.call('POST', '/api/boards', { cookie: user.token, body: { name: 'De trop' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'quota_exceeded');
  });

  it('applique le quota en octets à la création et au remplacement', async () => {
    const limited = await startServer({}, config => ({ ...config, accountBoardQuotaBytes: 900 }));
    try {
      const user = await limited.signUp('Octets');
      const first = await limited.call('POST', '/api/boards', { cookie: user.token, body: { name: 'Petit', data: { items: [sticky('a', { content: 'x'.repeat(200) })] } } });
      assert.equal(first.status, 201);
      const create = await limited.call('POST', '/api/boards', { cookie: user.token, body: { name: 'Trop', data: { items: [sticky('b', { content: 'x'.repeat(600) })] } } });
      assert.equal(create.status, 403);
      assert.equal(create.body.code, 'quota_exceeded');
      assert.match(create.body.message, /quota/i);
      const replace = await limited.call('PUT', `/api/boards/${first.body.board.id}/data`, { cookie: user.token, body: { baseRev: 0, data: { items: [sticky('a', { content: 'x'.repeat(1000) })] } } });
      assert.equal(replace.status, 403);
      assert.equal(replace.body.code, 'quota_exceeded');
    } finally { await limited.close(); }
  });

  it('refuse un second propriétaire au niveau du schéma', async () => {
    const id = await newBoard();
    assert.throws(() => addMember(id, stranger, 'owner'), /UNIQUE/);
  });
});

describe('sauvegarde', () => {
  it('écrit une copie cohérente en 600 et ne retire que les fichiers anciens du script', async () => {
    assert.match(readFileSync(BACKUP_SCRIPT, 'utf8'), /process\.umask\(0o077\)/);
    const s = await startServer();
    const dir = mkdtempSync(join(tmpdir(), 'baro-backup-'));
    try {
      const { token } = await s.signUp('Sauvegarde');
      await s.call('POST', '/api/boards', { cookie: token, body: { name: 'À garder', data: { items: [sticky('item-1')] } } });

      const oldName = 'baro-2020-01-01.db';
      const recent = `baro-${new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)}.db`;
      for (const name of [oldName, recent, 'autre-2020-01-01.db']) writeFileSync(join(dir, name), 'x');

      const run = () => spawnSync(process.execPath, [BACKUP_SCRIPT], { env: { ...process.env, BARO_DB: s.dbPath, BARO_BACKUP_DIR: dir }, encoding: 'utf8' });
      const first = run();
      assert.equal(first.status, 0, first.stderr);
      const again = run();
      assert.equal(again.status, 0, again.stderr);

      const today = `baro-${new Date().toISOString().slice(0, 10)}.db`;
      assert.deepEqual(readdirSync(dir).sort(), ['autre-2020-01-01.db', recent, today].sort());
      assert.equal(statSync(join(dir, today)).mode & 0o777, 0o600);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
      assert.equal(existsSync(join(dir, oldName)), false);

      const copy = new Database(join(dir, today), { readonly: true });
      try {
        assert.equal(copy.prepare('SELECT name FROM boards').get().name, 'À garder');
        assert.equal(copy.prepare('SELECT COUNT(*) n FROM board_items').get().n, 1);
        assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      } finally { copy.close(); }
    } finally {
      await s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
