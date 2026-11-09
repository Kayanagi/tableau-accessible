import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { hashToken } from '../src/auth.js';
import { MIGRATIONS } from '../src/migrations.js';
import { createMailCapture, createMailer } from '../src/mail.js';
import { RESET_SUBJECT, createPasswordResets } from '../src/password-reset.js';
import { PASSWORD, nextIp, startServer, sticky, tokenFrom } from './helpers.js';

const NEW_PASSWORD = 'un tout nouveau secret';
const HOUR = 3600 * 1000;
const LINK = /https:\/\/baro\.dwes\.fr\/reinitialiser\.html#jeton=([\w-]{43})/;
const boardId = n => `brd_${String(n).padStart(22, 'x')}`;

const tokenOf = message => LINK.exec(message.text)?.[1] ?? null;

describe('Mot de passe oublié', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  /* Demande depuis une adresse IP neuve (chaque test garde ses compteurs), puis attente de l'envoi. */
  async function ask(email, ip = nextIp()) {
    const res = await s.call('POST', '/api/auth/password-reset', { body: { email }, ip });
    await s.settle();
    return res;
  }

  async function resetToken(email) {
    const before = s.sent.length;
    await ask(email);
    assert.equal(s.sent.length, before + 1);
    return tokenOf(s.sent.at(-1));
  }

  const confirm = (token, password = NEW_PASSWORD, ip = nextIp()) => s.call('POST', '/api/auth/password-reset/confirm', { body: { token, password }, ip });

  it('répond 202 {} à l’identique, avec ou sans compte, et n’écrit qu’au compte existant', async () => {
    const user = await s.signUp();
    const before = s.sent.length;
    const known = await ask(user.email.toUpperCase());
    const unknown = await ask('personne@exemple.test');
    for (const res of [known, unknown]) {
      assert.equal(res.status, 202);
      assert.deepEqual(res.body, {});
      assert.equal(res.headers.get('content-length'), '2');
      assert.equal(res.headers.get('set-cookie'), null);
    }
    assert.equal(s.sent.length, before + 1);
    const message = s.sent.at(-1);
    assert.equal(message.to, user.email);
    assert.equal(message.subject, RESET_SUBJECT);
    assert.ok(tokenOf(message));
    assert.match(message.text, /valable une heure/);
    assert.match(message.text, /Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas\./);
  });

  it('refuse une adresse mal formée par 400, sans rien envoyer', async () => {
    const before = s.sent.length;
    for (const email of ['pas-une-adresse', 42, undefined]) {
      const res = await ask(email);
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'invalid_email');
    }
    assert.equal(s.sent.length, before);
  });

  it('ne garde en base que le haché du jeton, valable une heure', async () => {
    const user = await s.signUp();
    const token = await resetToken(user.email);
    const rows = s.app.db.prepare('SELECT token_hash, created_at, expires_at, used_at FROM password_resets WHERE user_id = ?').all(user.id);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].token_hash, hashToken(token));
    assert.equal(rows[0].expires_at - rows[0].created_at, HOUR);
    assert.equal(rows[0].used_at, null);
    const dump = JSON.stringify(s.app.db.prepare('SELECT * FROM password_resets').all().map(r => ({ ...r, token_hash: r.token_hash.toString('base64url') })));
    assert.ok(!dump.includes(token));
  });

  it('change le mot de passe et ferme toutes les sessions du compte', async () => {
    const user = await s.signUp();
    const second = tokenFrom(await s.call('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }));
    const token = await resetToken(user.email);
    const res = await confirm(token);
    assert.equal(res.status, 204);
    assert.equal(res.body, null);
    for (const cookie of [user.token, second]) assert.equal((await s.call('GET', '/api/me', { cookie })).status, 401);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 0);
    assert.equal((await s.call('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } })).status, 401);
    assert.equal((await s.call('POST', '/api/auth/login', { body: { email: user.email, password: NEW_PASSWORD } })).status, 200);
    const hash = s.app.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash;
    assert.match(hash, /^scrypt\$1024\$8\$2\$/);
  });

  it('n’accepte un jeton qu’une fois, et répond pareil pour un jeton inconnu ou mal formé', async () => {
    const user = await s.signUp();
    const token = await resetToken(user.email);
    assert.equal((await confirm(token)).status, 204);
    const reused = await confirm(token, 'encore un autre secret');
    const unknown = await confirm('A'.repeat(43));
    const malformed = await confirm('court');
    const missing = await s.call('POST', '/api/auth/password-reset/confirm', { body: { password: NEW_PASSWORD } });
    for (const res of [reused, unknown, malformed, missing]) {
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, reused.body);
    }
    assert.equal(reused.body.code, 'invalid_token');
    assert.equal((await s.call('POST', '/api/auth/login', { body: { email: user.email, password: NEW_PASSWORD } })).status, 200);
  });

  it('refuse un jeton expiré', async () => {
    const user = await s.signUp();
    const token = await resetToken(user.email);
    s.app.db.prepare('UPDATE password_resets SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, hashToken(token));
    const res = await confirm(token);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'invalid_token');
    assert.equal(s.app.passwordResets.purgeExpired() >= 1, true);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ?').get(user.id).n, 0);
  });

  it('invalide la demande précédente non utilisée et ne garde que le jeton utilisé après confirmation', async () => {
    const user = await s.signUp();
    const first = await resetToken(user.email);
    const second = await resetToken(user.email);
    assert.notEqual(first, second);
    assert.equal((await confirm(first)).body.code, 'invalid_token');
    // Une ligne étrangère (jeton déjà utilisé d'une autre demande) disparaît avec la confirmation.
    s.app.db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)')
      .run(hashToken('ancien'), user.id, Date.now(), Date.now() + HOUR, Date.now());
    assert.equal((await confirm(second)).status, 204);
    const rows = s.app.db.prepare('SELECT token_hash, used_at FROM password_resets WHERE user_id = ?').all(user.id);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].token_hash, hashToken(second));
    assert.ok(rows[0].used_at);
  });

  it('refuse un mot de passe hors règles sans consommer le jeton', async () => {
    const user = await s.signUp();
    const token = await resetToken(user.email);
    const res = await confirm(token, 'court');
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'invalid_password');
    assert.equal((await s.call('GET', '/api/me', { cookie: user.token })).status, 200);
    assert.equal((await confirm(token)).status, 204);
  });

  it('limite à 3 demandes par heure et par adresse, avec la même réponse 202 au-delà', async () => {
    const user = await s.signUp();
    const before = s.sent.length;
    const responses = [];
    for (let i = 0; i < 4; i++) responses.push(await ask(user.email));
    for (const res of responses) {
      assert.equal(res.status, 202);
      assert.deepEqual(res.body, {});
    }
    assert.equal(s.sent.length, before + 3);
    // Comptée même sans compte : la quatrième demande pour une adresse inconnue ne fait rien de plus.
    for (let i = 0; i < 4; i++) assert.equal((await ask('fantome@exemple.test')).status, 202);
  });

  it('limite à 10 demandes par heure et par préfixe IP', async () => {
    const user = await s.signUp();
    const ip = nextIp();
    for (let i = 0; i < 10; i++) assert.equal((await ask(`ip${i}@exemple.test`, ip)).status, 202);
    const before = s.sent.length;
    const res = await ask(user.email, ip);
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, {});
    assert.equal(s.sent.length, before);
    await ask(user.email);
    assert.equal(s.sent.length, before + 1);
  });

  it('limite la confirmation à 10 essais par quart d’heure et par préfixe IP', async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) assert.equal((await confirm('B'.repeat(43), NEW_PASSWORD, ip)).status, 400);
    const limited = await confirm('B'.repeat(43), NEW_PASSWORD, ip);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });

  it('exige l’origine exacte, le JSON et un corps de 16 Kio au plus', async () => {
    for (const path of ['/api/auth/password-reset', '/api/auth/password-reset/confirm']) {
      assert.equal((await s.call('POST', path, { body: { email: 'a@b.fr' }, origin: 'https://ailleurs.test' })).status, 403);
      assert.equal((await s.call('POST', path, { raw: 'email=a@b.fr', contentType: 'application/x-www-form-urlencoded' })).status, 415);
      assert.equal((await s.call('POST', path, { body: { email: 'a@b.fr', pad: 'x'.repeat(17 * 1024) } })).status, 413);
    }
  });

  it('supprime les jetons avec le compte', async () => {
    const user = await s.signUp();
    await resetToken(user.email);
    const res = await s.call('DELETE', '/api/me', { cookie: user.token, body: { password: PASSWORD } });
    assert.equal(res.status, 204);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ?').get(user.id).n, 0);
  });
});

describe('Mot de passe oublié : débit total et envoi différé', () => {
  it('au-delà de 50 demandes par heure en tout, n’envoie plus rien', async () => {
    const s = await startServer();
    try {
      const user = await s.signUp();
      for (let i = 0; i < 50; i++) await s.call('POST', '/api/auth/password-reset', { body: { email: `total${i}@exemple.test` } });
      const res = await s.call('POST', '/api/auth/password-reset', { body: { email: user.email } });
      await s.settle();
      assert.equal(res.status, 202);
      assert.deepEqual(res.body, {});
      assert.equal(s.sent.length, 0);
    } finally {
      await s.close();
    }
  });

  it('répond sans attendre l’envoi, et un envoi en échec ne change rien à la réponse', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const calls = [];
    const s = await startServer({}, c => c, { send: async message => { calls.push(message); await gate; throw new Error('sendmail absent'); } });
    try {
      const user = await s.signUp();
      const res = await s.call('POST', '/api/auth/password-reset', { body: { email: user.email } });
      assert.equal(res.status, 202);
      assert.deepEqual(res.body, {});
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls.length, 1);
      release();
      await s.settle();
    } finally {
      release();
      await s.close();
    }
  });

  it('ne journalise ni l’adresse ni le jeton', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baro-reset-'));
    const db = openDb(join(dir, 'baro.db'));
    try {
      db.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES ('u_log', 'secret@exemple.test', 'N', 'x', 1, 1)").run();
      const lines = [];
      const log = { warn: line => lines.push(line), error: line => lines.push(line) };
      let text = '';
      const resets = createPasswordResets({ db, publicUrl: 'https://baro.dwes.fr', log, send: async message => { text = message.text; return false; } });
      resets.request('secret@exemple.test');
      await resets.idle();
      const token = tokenOf({ text });
      assert.ok(token);
      assert.equal(lines.length, 1);
      assert.match(lines[0], /u_log/);
      assert.ok(!lines[0].includes('secret@') && !lines[0].includes(token));
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Configuration et capture des e-mails', () => {
  it('lit BARO_PUBLIC_URL (https://baro.dwes.fr par défaut) et refuse une valeur incohérente', () => {
    assert.equal(loadConfig({}).publicUrl, 'https://baro.dwes.fr');
    assert.equal(loadConfig({ BARO_PUBLIC_URL: 'http://localhost:8080' }).publicUrl, 'http://localhost:8080');
    assert.throws(() => loadConfig({ BARO_PUBLIC_URL: 'https://baro.test/' }), /BARO_PUBLIC_URL/);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', BARO_PUBLIC_URL: 'http://baro.test' }), /https/);
  });

  it('écrit chaque message capturé en une ligne JSON, et refuse la capture en production', async () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', BARO_MAIL_CAPTURE: '/tmp/x.jsonl' }), /BARO_MAIL_CAPTURE/);
    const dir = mkdtempSync(join(tmpdir(), 'baro-capture-'));
    try {
      const path = join(dir, 'mails.jsonl');
      const config = loadConfig({ BARO_MAIL_CAPTURE: path });
      assert.equal(config.mailCapture, path);
      const { send } = createMailCapture({ from: 'contact@dwes.fr', path });
      assert.equal(await send({ to: 'a@exemple.test', subject: RESET_SUBJECT, text: 'un\ndeux' }), true);
      assert.equal(await send({ to: 'b@exemple.test', subject: 'Second', text: 'trois' }), true);
      assert.equal(await send({ to: 'a,b@exemple.test', subject: 'Refusé', text: '' }), false);
      const lines = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(lines.length, 2);
      assert.deepEqual({ ...lines[0], date: undefined }, { from: 'contact@dwes.fr', to: 'a@exemple.test', subject: RESET_SUBJECT, text: 'un\ndeux', date: undefined });
      // Hors production et sans capture : aucun envoi réel.
      const quiet = { warn() {} };
      assert.equal(await createMailer(loadConfig({ NODE_ENV: 'test' }), quiet).send({ to: 'a@exemple.test', subject: 'x', text: 'y' }), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Données du compte', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  const getData = cookie => s.call('GET', '/api/me/data', { cookie });
  const putData = (cookie, baseRev, data) => s.call('PUT', '/api/me/data', { cookie, body: { baseRev, data } });
  const template = (id, extra = {}) => ({ id, nom: 'Mon modèle', description: 'Enregistré.', créé: 1700000000000, snapshot: { name: 'Modèle', items: [sticky('n1')] }, ...extra });

  it('renvoie des données vides en révision 0 pour un compte neuf, et exige un compte', async () => {
    const user = await s.signUp();
    const res = await getData(user.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { rev: 0, data: { espaces: [], favoris: [], placement: {}, modèles: [], usage: {} } });
    assert.equal((await getData()).status, 401);
    assert.equal((await s.call('PUT', '/api/me/data', { body: { baseRev: 0, data: {} } })).status, 401);
  });

  it('remplace les données à révision attendue, puis répond 409 avec la révision courante', async () => {
    const user = await s.signUp();
    const data = {
      espaces: [{ id: 'space-1', nom: '  Travail  ' }],
      favoris: [boardId(1)],
      placement: { [boardId(1)]: 'space-1' },
      modèles: [template('custom-1', { partage: true })],
      usage: { vierge: 1700000000000, 'custom-1': 1700000000001 }
    };
    const put = await putData(user.token, 0, data);
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, { rev: 1 });
    const read = await getData(user.token);
    assert.equal(read.body.rev, 1);
    assert.deepEqual(read.body.data.espaces, [{ id: 'space-1', nom: 'Travail' }]);
    assert.deepEqual(read.body.data.favoris, [boardId(1)]);
    assert.deepEqual(read.body.data.usage, data.usage);
    assert.equal(read.body.data.modèles[0].partage, true);
    assert.deepEqual(read.body.data.modèles[0].snapshot.items, [sticky('n1')]);

    const stale = await putData(user.token, 0, { favoris: [] });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'conflict');
    assert.equal(stale.body.rev, 1);
    assert.equal((await putData(user.token, 1, {})).body.rev, 2);
    assert.deepEqual((await getData(user.token)).body, { rev: 2, data: { espaces: [], favoris: [], placement: {}, modèles: [], usage: {} } });
    for (const baseRev of [undefined, -1, 1.5, '2']) {
      const res = await putData(user.token, baseRev, {});
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'invalid_base_rev');
    }
  });

  it('range un modèle sous sa forme de tableau, reprises historiques comprises', async () => {
    const user = await s.signUp();
    const legacy = template('custom-ancien', { snapshot: { name: 'Ancien', items: [sticky('n1', { color: 'yellow' }), { id: 'k1', type: 'kanban', x: 0, y: 0 }] } });
    assert.equal((await putData(user.token, 0, { modèles: [legacy] })).status, 200);
    const stored = (await getData(user.token)).body.data.modèles[0];
    assert.equal(stored.snapshot.name, 'Ancien');
    assert.deepEqual(stored.snapshot.tags, []);
    assert.notEqual(stored.snapshot.items[0].color, 'yellow');
    assert.ok(Array.isArray(stored.snapshot.items[1].columns));
  });

  const cases = [
    ['clé inconnue', { version: 1 }, 'invalid_key', 'data.version'],
    ['données non objet', [], 'invalid_data', 'data'],
    ['espace sans identifiant sûr', { espaces: [{ id: 'a b', nom: 'X' }] }, 'invalid_id', 'data.espaces[0].id'],
    ['espace en double', { espaces: [{ id: 's', nom: 'A' }, { id: 's', nom: 'B' }] }, 'duplicate_id', 'data.espaces[1].id'],
    ['nom d’espace vide', { espaces: [{ id: 's', nom: '   ' }] }, 'invalid_name', 'data.espaces[0].nom'],
    ['nom d’espace trop long', { espaces: [{ id: 's', nom: 'x'.repeat(201) }] }, 'invalid_name', 'data.espaces[0].nom'],
    ['champ d’espace inconnu', { espaces: [{ id: 's', nom: 'A', couleur: 'rouge' }] }, 'invalid_key', 'data.espaces[0].couleur'],
    ['favori hors format de tableau', { favoris: ['space-1'] }, 'invalid_id', 'data.favoris[0]'],
    ['favori en double', { favoris: [boardId(1), boardId(1)] }, 'duplicate_id', 'data.favoris[1]'],
    ['placement d’un identifiant hors format', { placement: { 'item-1': 'space-1' } }, 'invalid_id', 'data.placement.item-1'],
    ['placement vers un espace mal formé', { placement: { [boardId(2)]: 'a b' } }, 'invalid_id', `data.placement.${boardId(2)}`],
    ['placement non objet', { placement: [] }, 'invalid_data', 'data.placement'],
    ['usage non numérique', { usage: { vierge: 'hier' } }, 'out_of_range', 'data.usage.vierge'],
    ['usage négatif', { usage: { vierge: -1 } }, 'out_of_range', 'data.usage.vierge'],
    ['modèle sans nom', { modèles: [template('t', { nom: '' })] }, 'invalid_name', 'data.modèles[0].nom'],
    ['modèle à champ inconnu', { modèles: [template('t', { categorie: 'Mes modèles' })] }, 'invalid_key', 'data.modèles[0].categorie'],
    ['modèle sans tableau', { modèles: [template('t', { snapshot: null })] }, 'missing_structure', 'data.modèles[0].snapshot'],
    ['modèle au contenu invalide', { modèles: [template('t', { snapshot: { items: [sticky('n1', { color: 'fuchsia' })] } })] }, 'invalid_enum', 'data.modèles[0].snapshot.items[0].color'],
    ['modèles en double', { modèles: [template('t'), template('t')] }, 'duplicate_id', 'data.modèles[1].id'],
    ['clé interdite', JSON.parse('{"usage":{"__proto__":1}}'), 'forbidden_key', 'data.usage.__proto__']
  ];

  it('valide chaque clé strictement (400, code et chemin)', async () => {
    const user = await s.signUp();
    for (const [label, data, code, path] of cases) {
      const res = await putData(user.token, 0, data);
      assert.equal(res.status, 400, label);
      assert.equal(res.body.code, code, label);
      assert.equal(res.body.path, path, label);
    }
    assert.equal((await getData(user.token)).body.rev, 0);
  });

  it('applique les plafonds de nombre : 200 espaces, 100 modèles, 200 usages', async () => {
    const user = await s.signUp();
    const spaces = n => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, nom: `Espace ${i}` }));
    const templates = n => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, nom: `M${i}`, snapshot: { items: [] } }));
    const usage = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, i]));
    assert.equal((await putData(user.token, 0, { espaces: spaces(200), modèles: templates(100), usage: usage(200) })).status, 200);
    for (const [data, path] of [[{ espaces: spaces(201) }, 'data.espaces'], [{ modèles: templates(101) }, 'data.modèles'], [{ usage: usage(201) }, 'data.usage']]) {
      const res = await putData(user.token, 1, data);
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'too_many');
      assert.equal(res.body.path, path);
    }
  });

  it('refuse plus de 2 Mio de données (400) et un corps de plus de 2,5 Mio (413)', async () => {
    const user = await s.signUp();
    const big = n => ({ id: `t${n}`, nom: 'Gros', snapshot: { items: [sticky('n1', { content: 'x'.repeat(49000) })] } });
    const fits = Array.from({ length: 40 }, (_, i) => big(i));
    assert.equal((await putData(user.token, 0, { modèles: fits })).status, 200);
    const tooBig = Array.from({ length: 45 }, (_, i) => big(i));
    const res = await putData(user.token, 1, { modèles: tooBig });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'too_large');
    const huge = await s.call('PUT', '/api/me/data', { cookie: user.token, raw: JSON.stringify({ baseRev: 1, data: {}, pad: 'x'.repeat(2.6 * 1024 * 1024) }) });
    assert.equal(huge.status, 413);
    assert.match(huge.body.message, /2,5 Mio/);
  });

  it('inclut les données dans l’export du compte', async () => {
    const user = await s.signUp();
    await putData(user.token, 0, { espaces: [{ id: 'space-x', nom: 'Exporté' }], favoris: [boardId(3)] });
    const res = await s.call('GET', '/api/me/export', { cookie: user.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.espaces, [{ id: 'space-x', nom: 'Exporté' }]);
    assert.deepEqual(res.body.data.favoris, [boardId(3)]);
    const empty = await s.signUp();
    assert.deepEqual((await s.call('GET', '/api/me/export', { cookie: empty.token })).body.data, { espaces: [], favoris: [], placement: {}, modèles: [], usage: {} });
  });

  it('supprime les données avec le compte', async () => {
    const user = await s.signUp();
    await putData(user.token, 0, { espaces: [{ id: 's', nom: 'A' }] });
    assert.equal((await s.call('DELETE', '/api/me', { cookie: user.token, body: { password: PASSWORD } })).status, 204);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM account_data WHERE user_id = ?').get(user.id).n, 0);
  });
});

describe('Données du compte et quota', () => {
  it('compte les données du compte dans le quota partagé avec les tableaux', async () => {
    const s = await startServer({}, config => ({ ...config, accountBoardQuotaBytes: 4000 }));
    try {
      const user = await s.signUp();
      const board = await s.call('POST', '/api/boards', { cookie: user.token, body: { name: 'Petit', data: { items: [sticky('a', { content: 'x'.repeat(1500) })] } } });
      assert.equal(board.status, 201);
      const tooMuch = { modèles: [{ id: 't', nom: 'M', snapshot: { items: [sticky('b', { content: 'y'.repeat(2500) })] } }] };
      const refused = await s.call('PUT', '/api/me/data', { cookie: user.token, body: { baseRev: 0, data: tooMuch } });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.code, 'quota_exceeded');
      const fits = { modèles: [{ id: 't', nom: 'M', snapshot: { items: [sticky('b', { content: 'y'.repeat(1500) })] } }] };
      assert.equal((await s.call('PUT', '/api/me/data', { cookie: user.token, body: { baseRev: 0, data: fits } })).status, 200);
      // Les données rangées réduisent d'autant la place laissée aux tableaux.
      const second = await s.call('POST', '/api/boards', { cookie: user.token, body: { name: 'Second', data: { items: [sticky('c', { content: 'z'.repeat(1000) })] } } });
      assert.equal(second.status, 403);
      assert.equal(second.body.code, 'quota_exceeded');
    } finally {
      await s.close();
    }
  });
});

describe('Migration 5', () => {
  it('passe une base de la version 4 à la version 5 sans perte, avec suppression en cascade', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baro-migration-5-'));
    const path = join(dir, 'baro.db');
    try {
      const old = new Database(path);
      old.exec(MIGRATIONS.slice(0, 4).join('\n'));
      old.pragma('user_version = 4');
      old.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES ('u_1', 'a@b.fr', 'Ancienne', 'scrypt$x', 1, 2)").run();
      old.prepare("INSERT INTO boards (id, name, created_at, updated_at) VALUES ('brd_1', 'Ancien', 1, 2)").run();
      old.close();

      const db = openDb(path);
      assert.equal(db.pragma('user_version', { simple: true }), 5);
      assert.equal(MIGRATIONS.length, 5);
      assert.equal(db.prepare('SELECT name FROM boards').get().name, 'Ancien');
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'password_resets_user'").get());
      db.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (x'01', 'u_1', 1, 2)").run();
      db.prepare("INSERT INTO account_data (user_id, data, rev, updated_at) VALUES ('u_1', '{}', 1, 1)").run();
      assert.throws(() => db.prepare("INSERT INTO account_data (user_id, data, rev, updated_at) VALUES ('u_1', '{}', 2, 2)").run(), /UNIQUE|PRIMARY/);
      assert.throws(() => db.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (x'02', 'u_absent', 1, 2)").run(), /FOREIGN KEY/);
      db.prepare("DELETE FROM users WHERE id = 'u_1'").run();
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account_data').get().n, 0);
      db.close();

      const again = openDb(path);
      assert.equal(again.pragma('user_version', { simple: true }), 5);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
