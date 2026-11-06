import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROD_SCRYPT_N, loadConfig } from '../src/config.js';
import { ScryptBusyError, createPasswords, hashToken, sessionCookie } from '../src/auth.js';
import { clientIp, ipPrefix } from '../src/http.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { COOKIE, ORIGIN, PASSWORD, nextIp, startServer, tokenFrom } from './helpers.js';

const FAST = { N: 1024, r: 8, p: 2, concurrency: 2, queue: 10 };
const RESET_SCRIPT = fileURLToPath(new URL('../scripts/reset-password.mjs', import.meta.url));

describe('configuration', () => {
  const prod = { NODE_ENV: 'production', BARO_ORIGIN: ORIGIN };

  it('applique par défaut les paramètres de production', () => {
    const config = loadConfig(prod);
    assert.deepEqual(config.scrypt, { N: 2 ** 16, r: 8, p: 2, concurrency: 2, queue: 10, perPrefix: 2 });
    assert.equal(config.accountBoardQuotaBytes, 100 * 1024 * 1024);
    assert.deepEqual(config.cookie, { name: '__Host-baro_sid', secure: true });
    assert.equal(PROD_SCRYPT_N, 65536);
  });

  it('refuse le cookie non sécurisé en production', () => {
    assert.throws(() => loadConfig({ ...prod, BARO_INSECURE_COOKIE: '1' }), /refusée/);
  });

  it('refuse un N abaissé en production', () => {
    assert.throws(() => loadConfig({ ...prod, BARO_SCRYPT_N: '1024' }), /BARO_SCRYPT_N/);
  });

  it('refuse une origine inexacte ou une valeur d’inscription inconnue', () => {
    assert.throws(() => loadConfig({ BARO_ORIGIN: 'https://baro.test/' }), /origine exacte/);
    assert.throws(() => loadConfig({ BARO_INSCRIPTIONS: 'fermé' }), /BARO_INSCRIPTIONS/);
    assert.throws(() => loadConfig({ ...prod, BARO_ORIGIN: 'http://baro.test' }), /https/);
  });
});

describe('hachage scrypt', () => {
  it('stocke les paramètres et vérifie le mot de passe', async () => {
    const pw = createPasswords(FAST);
    const stored = await pw.hash(PASSWORD);
    assert.match(stored, /^scrypt\$1024\$8\$2\$[\w-]{22}\$[\w-]{43}$/);
    assert.equal(await pw.verify(PASSWORD, stored), true);
    assert.equal(await pw.verify('autre mot de passe', stored), false);
    assert.equal(await pw.verify(PASSWORD, 'scrypt$3$8$2$aa$bb'), false);
  });

  it('accepte réellement N=2^16, r=8, p=2', async () => {
    const pw = createPasswords({ ...FAST, N: 2 ** 16 });
    const stored = await pw.hash(PASSWORD);
    assert.ok(stored.startsWith('scrypt$65536$8$2$'));
    assert.equal(await pw.verify(PASSWORD, stored), true);
  });

  it('signale un hash à relever et vérifie encore l’ancien', async () => {
    const old = await createPasswords({ ...FAST, N: 512 }).hash(PASSWORD);
    const pw = createPasswords(FAST);
    assert.equal(pw.needsRehash(old), true);
    assert.equal(await pw.verify(PASSWORD, old), true);
    assert.equal(pw.needsRehash(await pw.hash(PASSWORD)), false);
  });

  it('borne les calculs simultanés et refuse au-delà de la file', async () => {
    const pw = createPasswords({ ...FAST, concurrency: 2, queue: 10 });
    const jobs = Array.from({ length: 15 }, () => pw.hash(PASSWORD).then(() => 'ok', e => e));
    assert.deepEqual(pw.load(), { active: 2, waiting: 10 });
    const results = await Promise.all(jobs);
    assert.equal(results.filter(r => r === 'ok').length, 12);
    const refused = results.filter(r => r instanceof ScryptBusyError);
    assert.equal(refused.length, 3);
    assert.equal(refused[0].status, 503);
    assert.equal(refused[0].headers['Retry-After'], '5');
    assert.deepEqual(pw.load(), { active: 0, waiting: 0 });
  });

  it('empêche un préfixe de remplir seul la file scrypt', async () => {
    const pw = createPasswords({ ...FAST, concurrency: 1, queue: 4, perPrefix: 2 });
    const jobs = [pw.hash(PASSWORD, 'a'), pw.hash(PASSWORD, 'a'), pw.hash(PASSWORD, 'a'), pw.hash(PASSWORD, 'b')];
    const results = await Promise.allSettled(jobs);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason instanceof ScryptBusyError).length, 1);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  });
});

describe('adresse cliente', () => {
  const req = (remoteAddress, real) => ({ socket: { remoteAddress }, headers: real ? { 'x-real-ip': real } : {} });

  it('ne croit X-Real-IP que si le pair TCP est 127.0.0.1', () => {
    assert.equal(clientIp(req('127.0.0.1', '203.0.113.9')), '203.0.113.9');
    assert.equal(clientIp(req('::ffff:127.0.0.1', '203.0.113.9')), '203.0.113.9');
    assert.equal(clientIp(req('198.51.100.7', '203.0.113.9')), '198.51.100.7');
    assert.equal(clientIp(req('127.0.0.1', 'pas une adresse')), '127.0.0.1');
    assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1');
  });

  it('regroupe les IPv6 par /64 et normalise les IPv4 mappées', () => {
    assert.equal(ipPrefix('2001:0db8:abcd:12::1'), '2001:db8:abcd:12::/64');
    assert.equal(ipPrefix('2001:db8:abcd:12:ffff::9'), '2001:db8:abcd:12::/64');
    assert.equal(ipPrefix('::ffff:192.0.2.4'), '192.0.2.4');
  });
});

describe('débit, fenêtre glissante', () => {
  it('libère une place à mesure que la fenêtre glisse', () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    assert.equal(limiter.hit('b', 'k', 2, 1000), 0);
    t = 500;
    assert.equal(limiter.hit('b', 'k', 2, 1000), 0);
    t = 600;
    assert.equal(limiter.hit('b', 'k', 2, 1000), 1);
    t = 1000;
    assert.equal(limiter.hit('b', 'k', 2, 1000), 0);
    limiter.sweep();
    assert.equal(limiter.size(), 1);
    t = 5000;
    limiter.sweep();
    assert.equal(limiter.size(), 0);
    limiter.hit('login-email', 'victime', 2, 1000);
    limiter.hit('login-ip', 'adresse', 2, 1000);
    assert.equal(limiter.size('login-email'), 1);
    assert.equal(limiter.size('login-ip'), 1);
  });
});

describe('API d’authentification', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  it('n’écoute que sur 127.0.0.1', () => {
    assert.equal(s.app.server.address().address, '127.0.0.1');
  });

  it('crée toutes les tables du schéma dès la première migration', () => {
    const names = s.app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
    assert.deepEqual(names, ['board_invites', 'board_items', 'board_members', 'board_ops', 'boards', 'sessions', 'share_links', 'users']);
    assert.equal(s.app.db.pragma('user_version', { simple: true }), 3);
    assert.equal(s.app.db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(s.app.db.pragma('foreign_keys', { simple: true }), 1);
  });

  it('inscrit, pose le cookie exact et n’expose pas le jeton en base', async () => {
    const res = await s.call('POST', '/api/auth/register', { body: { email: '  Claire@Exemple.TEST ', password: PASSWORD, displayName: ' Claire ' } });
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['createdAt', 'displayName', 'email', 'id']);
    assert.equal(res.body.user.email, 'claire@exemple.test');
    assert.equal(res.body.user.displayName, 'Claire');
    assert.match(res.body.user.id, /^u_[\w-]{22}$/);

    assert.equal(res.setCookie.length, 1);
    const token = tokenFrom(res);
    assert.match(token, /^[\w-]{43}$/);
    assert.equal(res.setCookie[0], `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const stored = s.app.db.prepare('SELECT token_hash FROM sessions').all();
    assert.ok(stored.some(r => r.token_hash.equals(hashToken(token))));
    assert.ok(stored.every(r => !r.token_hash.toString('latin1').includes(token)));
    s.app.db.pragma('wal_checkpoint(TRUNCATE)');
    for (const file of readdirSync(s.dir)) {
      assert.ok(!readFileSync(join(s.dir, file)).includes(token), `jeton en clair dans ${file}`);
      assert.ok(!readFileSync(join(s.dir, file)).includes(PASSWORD), `mot de passe en clair dans ${file}`);
    }
    const row = s.app.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('claire@exemple.test');
    assert.match(row.password_hash, /^scrypt\$1024\$8\$2\$/);
  });

  it('rejette les champs d’inscription invalides, avec un message en français', async () => {
    const ok = { email: 'neuf@exemple.test', password: PASSWORD, displayName: 'Neuf' };
    const cases = [
      [{ ...ok, email: 'sans-arobase' }, 'invalid_email'],
      [{ ...ok, password: 'trop court' }, 'invalid_password'],
      [{ ...ok, password: 'x'.repeat(129) }, 'invalid_password'],
      [{ ...ok, password: 123456789012 }, 'invalid_password'],
      [{ ...ok, displayName: '' }, 'invalid_display_name'],
      [{ ...ok, displayName: 'x'.repeat(51) }, 'invalid_display_name'],
      [{ ...ok, displayName: 'a\nb' }, 'invalid_display_name']
    ];
    for (const [body, code] of cases) {
      const res = await s.call('POST', '/api/auth/register', { body });
      assert.equal(res.status, 400, code);
      assert.equal(res.body.code, code);
      assert.equal(typeof res.body.message, 'string');
    }
    const accented = await s.call('POST', '/api/auth/register', { body: { ...ok, password: 'court' } });
    assert.match(accented.body.message, /à 128 caractères/);
    assert.match((await s.call('POST', '/api/auth/register', { body: { ...ok, displayName: '' } })).body.message, /affiché/);
  });

  it('borne le corps avant normalisation et refuse un JSON de compte trop gros', async () => {
    const expansion = await s.call('POST', '/api/auth/register', { body: { email: 'expansion@exemple.test', password: '\uFDFA'.repeat(2000), displayName: 'Nom' } });
    assert.equal(expansion.status, 400);
    assert.equal(expansion.body.code, 'invalid_password');
    const oversized = await s.call('POST', '/api/auth/login', { raw: JSON.stringify({ email: 'a@b.fr', password: PASSWORD, nested: 'x'.repeat(20 * 1024) }) });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.code, 'body_too_large');
  });

  it('accepte exactement 12 et 128 caractères, sans règle de composition', async () => {
    const a = await s.call('POST', '/api/auth/register', { body: { email: 'douze@exemple.test', password: 'aaaaaaaaaaaa', displayName: 'A' } });
    const b = await s.call('POST', '/api/auth/register', { body: { email: 'cent@exemple.test', password: 'é'.repeat(128), displayName: 'B' } });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const short = await s.call('POST', '/api/auth/register', { body: { email: 'onze@exemple.test', password: 'a'.repeat(11), displayName: 'C' } });
    assert.equal(short.status, 400);
  });

  it('répond 409 explicite sur un e-mail déjà pris, casse et forme comprises', async () => {
    const { email } = await s.signUp();
    const res = await s.call('POST', '/api/auth/register', { body: { email: email.toUpperCase(), password: PASSWORD, displayName: 'Bis' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'email_taken');
  });

  it('connecte avec un nouveau jeton et remplace l’ancienne session', async () => {
    const { email, token } = await s.signUp();
    const res = await s.call('POST', '/api/auth/login', { body: { email, password: PASSWORD }, cookie: token });
    assert.equal(res.status, 200);
    const fresh = tokenFrom(res);
    assert.notEqual(fresh, token);
    assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 401);
    const me = await s.call('GET', '/api/me', { cookie: fresh });
    assert.equal(me.status, 200);
    assert.equal(me.body.guest, false);
    assert.equal(me.body.user.email, email);
  });

  it('donne la même réponse pour un compte inconnu et un mauvais mot de passe', async () => {
    const { email } = await s.signUp();
    const wrong = await s.call('POST', '/api/auth/login', { body: { email, password: 'mauvais mot de passe' } });
    const unknown = await s.call('POST', '/api/auth/login', { body: { email: 'absent@exemple.test', password: PASSWORD } });
    const malformed = await s.call('POST', '/api/auth/login', { body: { email: 'pas-un-email', password: PASSWORD } });
    for (const res of [wrong, unknown, malformed]) {
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { code: 'bad_credentials', message: 'E-mail ou mot de passe incorrect' });
      assert.deepEqual(res.setCookie, []);
    }
  });

  it('compte seulement les échecs par couple e-mail et préfixe, avec un plafond e-mail plus large', async () => {
    const { email } = await s.signUp();
    const ip = nextIp();
    for (let i = 0; i < 4; i++) assert.equal((await s.call('POST', '/api/auth/login', { ip, body: { email, password: PASSWORD } })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await s.call('POST', '/api/auth/login', { ip, body: { email, password: 'mot de passe faux' } })).status, 401);
    assert.equal((await s.call('POST', '/api/auth/login', { ip, body: { email, password: 'mot de passe faux' } })).status, 429);
    for (let i = 0; i < 6; i++) {
      assert.equal((await s.call('POST', '/api/auth/login', { ip: nextIp(), body: { email, password: 'encore un faux mot' } })).status, 401);
    }
  });

  it('refuse de créer une session si le hash change pendant la connexion', async () => {
    const { email } = await s.signUp();
    const original = s.app.passwords.verify;
    let enteredResolve, release;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    s.app.passwords.verify = async (...args) => {
      const ok = await original(...args);
      enteredResolve();
      await gate;
      return ok;
    };
    const pending = s.call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    await entered;
    s.app.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run('scrypt$2$8$2$AA$AA', email);
    release();
    const res = await pending;
    s.app.passwords.verify = original;
    assert.equal(res.status, 401);
    assert.deepEqual(res.setCookie, []);
  });

  it('exécute un calcul scrypt factice si le compte est inconnu', async () => {
    const original = s.app.passwords.fakeVerify;
    let calls = 0;
    s.app.passwords.fakeVerify = pw => { calls++; return original(pw); };
    await s.call('POST', '/api/auth/login', { body: { email: 'fantome@exemple.test', password: PASSWORD } });
    await s.call('POST', '/api/auth/login', { body: { email: 'fantome2@exemple.test', password: 'y'.repeat(5000) } });
    s.app.passwords.fakeVerify = original;
    assert.equal(calls, 2);
  });

  it('relève les paramètres du hash à la connexion', async () => {
    const { email } = await s.signUp();
    const old = await createPasswords({ ...FAST, N: 512 }).hash(PASSWORD);
    s.app.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(old, email);
    const res = await s.call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(res.status, 200);
    const after = s.app.db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email).password_hash;
    assert.notEqual(after, old);
    assert.ok(after.startsWith('scrypt$1024$8$2$'));
  });

  it('déconnecte : session supprimée, cookie effacé', async () => {
    const { token } = await s.signUp();
    const res = await s.call('POST', '/api/auth/logout', { cookie: token });
    assert.equal(res.status, 204);
    assert.equal(res.setCookie[0], `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 401);
    assert.equal((await s.call('POST', '/api/auth/logout', { cookie: token })).status, 401);
  });

  it('refuse les sessions expirées et fait glisser une session vue il y a plus d’une heure', async () => {
    const { token } = await s.signUp();
    const hash = hashToken(token);
    const longAgo = Date.now() - 2 * 3600 * 1000;
    s.app.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(longAgo, Date.now() + 1000 * 60, hash);
    const res = await s.call('GET', '/api/me', { cookie: token });
    assert.equal(res.status, 200);
    assert.equal(res.setCookie[0], sessionCookie({ name: COOKIE, secure: true }, token, 2592000));
    const row = s.app.db.prepare('SELECT last_seen_at, expires_at FROM sessions WHERE token_hash = ?').get(hash);
    assert.ok(row.last_seen_at > longAgo);
    assert.ok(row.expires_at > Date.now() + 29 * 24 * 3600 * 1000);
    const quiet = await s.call('GET', '/api/me', { cookie: token });
    assert.deepEqual(quiet.setCookie, []);

    s.app.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, hash);
    assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 401);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(hash).n, 0);
  });

  it('change le mot de passe : ancien vérifié, toutes les sessions purgées, nouveau jeton', async () => {
    const { email, token } = await s.signUp();
    const other = tokenFrom(await s.call('POST', '/api/auth/login', { body: { email, password: PASSWORD } }));
    const next = 'nouveau mot de passe long';

    const bad = await s.call('POST', '/api/me/password', { cookie: other, body: { oldPassword: 'faux mot de passe', newPassword: next } });
    assert.equal(bad.status, 403);
    assert.equal(bad.body.code, 'wrong_password');
    const weak = await s.call('POST', '/api/me/password', { cookie: other, body: { oldPassword: PASSWORD, newPassword: 'court' } });
    assert.equal(weak.status, 400);

    const res = await s.call('POST', '/api/me/password', { cookie: other, body: { oldPassword: PASSWORD, newPassword: next } });
    assert.equal(res.status, 204);
    const fresh = tokenFrom(res);
    assert.ok(fresh && fresh !== other && fresh !== token);
    assert.equal((await s.call('GET', '/api/me', { cookie: other })).status, 401);
    assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 401);
    assert.equal((await s.call('GET', '/api/me', { cookie: fresh })).status, 200);
    assert.equal((await s.call('POST', '/api/auth/login', { body: { email, password: PASSWORD } })).status, 401);
    assert.equal((await s.call('POST', '/api/auth/login', { body: { email, password: next } })).status, 200);
  });

  it('renomme le compte, sans toucher à l’e-mail', async () => {
    const { token, email } = await s.signUp();
    const res = await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: 'Élodie', email: 'autre@exemple.test' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.displayName, 'Élodie');
    assert.equal(res.body.user.email, email);
    assert.equal((await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: '  ' } })).status, 400);
    assert.equal((await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: 'Claire\u200B' } })).status, 400);
  });

  it('exporte le compte sans le hash ni le jeton', async () => {
    const { token, email } = await s.signUp();
    await s.call('POST', '/api/boards', { cookie: token, body: { name: 'À exporter', data: { items: [] } } });
    const res = await s.call('GET', '/api/me/export', { cookie: token });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    assert.equal(res.headers.get('content-length'), null);
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.boards.length, 1);
    assert.equal(res.body.boards[0].name, 'À exporter');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('scrypt$'));
    assert.ok(!text.includes(token));
    const limited = await s.call('GET', '/api/me/export', { cookie: token });
    assert.equal(limited.status, 429);
  });

  it('supprime le compte (mot de passe exigé), ses tableaux possédés et ses sessions', async () => {
    const { token, id } = await s.signUp();
    const other = await s.signUp();
    const mine = (await s.call('POST', '/api/boards', { cookie: token, body: { name: 'Le mien', data: { items: [] } } })).body.board.id;
    const theirs = (await s.call('POST', '/api/boards', { cookie: other.token, body: { name: 'Le sien', data: { items: [] } } })).body.board.id;
    s.app.db.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'editor', 0)").run(theirs, id);

    assert.equal((await s.call('DELETE', '/api/me', { cookie: token, body: {} })).status, 403);
    assert.equal((await s.call('DELETE', '/api/me', { cookie: token, body: { password: 'faux mot de passe' } })).status, 403);
    const res = await s.call('DELETE', '/api/me', { cookie: token, body: { password: PASSWORD } });
    assert.equal(res.status, 204);
    assert.ok(res.setCookie[0].includes('Max-Age=0'));

    assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 401);
    const count = sql => s.app.db.prepare(sql).get().n;
    assert.equal(count(`SELECT COUNT(*) n FROM boards WHERE id = '${mine}'`), 0);
    assert.equal(count(`SELECT COUNT(*) n FROM boards WHERE id = '${theirs}'`), 1);
    assert.equal(count(`SELECT COUNT(*) n FROM users WHERE id = '${id}'`), 0);
    assert.equal(count(`SELECT COUNT(*) n FROM board_members WHERE user_id = '${id}'`), 0);
    assert.equal(count(`SELECT COUNT(*) n FROM sessions WHERE user_id = '${id}'`), 0);
  });

  it('borne les tentatives sur le mot de passe d’un compte connecté', async () => {
    const { token } = await s.signUp();
    let last;
    for (let i = 0; i < 6; i++) last = await s.call('DELETE', '/api/me', { cookie: token, body: { password: 'faux mot de passe' } });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
  });

  it('réinitialise un mot de passe en ligne de commande et ferme les sessions', async () => {
    const { email, token } = await s.signUp();
    const next = 'mot de passe administrateur';
    const env = { ...process.env, NODE_ENV: 'test', BARO_DB: s.dbPath, BARO_ORIGIN: ORIGIN, BARO_SCRYPT_N: '1024' };
    const run = (who, input) => spawnSync(process.execPath, [RESET_SCRIPT, who], { env, input, encoding: 'utf8' });

    const unknown = run('absent@exemple.test', `${next}\n`);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Aucun compte/);
    const weak = run(email, 'court\n');
    assert.equal(weak.status, 1);
    assert.match(weak.stderr, /12 à 128/);

    const done = run(email, `${next}\n`);
    assert.equal(done.status, 0, done.stderr);
    assert.ok(!done.stdout.includes(next));
    assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 401);
    assert.equal((await s.call('POST', '/api/auth/login', { body: { email, password: next } })).status, 200);
  });
});

describe('garde CSRF', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  const login = { email: 'a@exemple.test', password: PASSWORD };

  it('refuse Origin absent ou étranger sur toute écriture : 403', async () => {
    const { token } = await s.signUp();
    const writes = [['POST', '/api/auth/login'], ['POST', '/api/auth/register'], ['POST', '/api/auth/logout'], ['POST', '/api/boards'], ['PATCH', '/api/me'], ['DELETE', '/api/me'], ['PUT', '/api/boards/x/data'], ['DELETE', '/api/boards/x'], ['POST', '/api/inconnue']];
    for (const origin of [null, 'https://evil.test', `${ORIGIN}/`, 'http://baro.test', 'null', `${ORIGIN}.evil.test`]) {
      for (const [method, path] of writes) {
        const res = await s.call(method, path, { cookie: token, body: login, origin });
        assert.equal(res.status, 403, `${method} ${path} depuis ${origin}`);
        assert.equal(res.body.code, 'bad_origin');
      }
    }
  });

  it('refuse un Content-Type de formulaire : 415', async () => {
    const { token } = await s.signUp();
    for (const contentType of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain', 'application/jsonp', null]) {
      const res = await s.call('POST', '/api/auth/login', { raw: JSON.stringify(login), contentType, cookie: token });
      assert.equal(res.status, 415, String(contentType));
      assert.equal(res.body.code, 'bad_content_type');
    }
    const ok = await s.call('POST', '/api/auth/login', { raw: JSON.stringify(login), contentType: 'application/json; charset=utf-8' });
    assert.equal(ok.status, 401);
  });

  it('impose aussi le Content-Type JSON à un DELETE sans corps', async () => {
    const { token } = await s.signUp();
    const res = await s.call('DELETE', '/api/boards/x', { cookie: token, contentType: null });
    assert.equal(res.status, 415);
  });

  it('laisse passer les lectures sans Origin, avec no-store partout', async () => {
    const res = await s.call('GET', '/api/me', { origin: null });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const forbidden = await s.call('POST', '/api/auth/login', { body: login, origin: null });
    assert.equal(forbidden.headers.get('cache-control'), 'no-store');
    const missing = await s.call('GET', '/api/inconnue');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
  });

  it('rejette un JSON invalide, un corps qui n’est pas un objet, et répond 405 sur une mauvaise méthode', async () => {
    assert.equal((await s.call('POST', '/api/auth/login', { raw: '{pas du json' })).status, 400);
    assert.equal((await s.call('POST', '/api/auth/login', { raw: '[1,2]' })).body.code, 'invalid_json');
    assert.equal((await s.call('POST', '/api/auth/login', { raw: 'null' })).body.code, 'invalid_json');
    const res = await s.call('PUT', '/api/auth/login', { body: {} });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });

  it('rejette sans erreur serveur un JSON imbriqué à l’extrême', async () => {
    const { token } = await s.signUp();
    const depth = 10_000;
    const raw = `{"name":"X","data":{"items":[{"id":"a","type":"text","x":0,"y":0,"z":${'['.repeat(depth)}${']'.repeat(depth)}}]}}`;
    const res = await s.call('POST', '/api/boards', { cookie: token, raw });
    assert.equal(res.status, 400);
  });

  it('refuse un corps de compte de plus de 16 Kio : 413', async () => {
    const res = await s.call('POST', '/api/auth/login', { raw: `{"email":"${'x'.repeat(17 * 1024)}"}` });
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'body_too_large');
    assert.equal((await s.call('GET', '/api/me')).status, 401);
  });
});

describe('débits de l’API', () => {
  it('connexion : 10 / 15 min par adresse IP', async () => {
    const s = await startServer();
    try {
      const ip = nextIp();
      for (let i = 0; i < 10; i++) {
        assert.equal((await s.call('POST', '/api/auth/login', { ip, body: { email: `n${i}@exemple.test`, password: PASSWORD } })).status, 401);
      }
      const res = await s.call('POST', '/api/auth/login', { ip, body: { email: 'n11@exemple.test', password: PASSWORD } });
      assert.equal(res.status, 429);
      assert.equal(res.body.code, 'rate_limited');
      const wait = Number(res.headers.get('retry-after'));
      assert.ok(wait > 0 && wait <= 900);
      assert.equal((await s.call('POST', '/api/auth/login', { body: { email: 'n11@exemple.test', password: PASSWORD } })).status, 401);
    } finally { await s.close(); }
  });

  it('connexion : 50 échecs / 15 min par e-mail, depuis des adresses différentes, casse ignorée', async () => {
    const s = await startServer();
    try {
      for (let i = 0; i < 50; i++) {
        assert.equal((await s.call('POST', '/api/auth/login', { body: { email: 'cible@exemple.test', password: PASSWORD } })).status, 401);
      }
      const res = await s.call('POST', '/api/auth/login', { body: { email: 'CIBLE@exemple.test', password: PASSWORD } });
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get('retry-after')) > 0);
      assert.equal((await s.call('POST', '/api/auth/login', { body: { email: 'autre@exemple.test', password: PASSWORD } })).status, 401);
    } finally { await s.close(); }
  });

  it('inscription : 5 / h par adresse IP', async () => {
    const s = await startServer();
    try {
      const ip = nextIp();
      for (let i = 0; i < 5; i++) {
        assert.equal((await s.call('POST', '/api/auth/register', { ip, body: { email: `r${i}@exemple.test`, password: PASSWORD, displayName: 'R' } })).status, 201);
      }
      const res = await s.call('POST', '/api/auth/register', { ip, body: { email: 'r6@exemple.test', password: PASSWORD, displayName: 'R' } });
      assert.equal(res.status, 429);
      const wait = Number(res.headers.get('retry-after'));
      assert.ok(wait > 900 && wait <= 3600);
    } finally { await s.close(); }
  });

  it('autres écritures : 120 / min par session', async () => {
    const s = await startServer();
    try {
      const { token } = await s.signUp();
      const other = await s.signUp();
      for (let i = 0; i < 120; i++) {
        assert.equal((await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: `N${i}` } })).status, 200);
      }
      const res = await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: 'Encore' } });
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get('retry-after')) > 0);
      assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 200);
      assert.equal((await s.call('PATCH', '/api/me', { cookie: other.token, body: { displayName: 'Libre' } })).status, 200);
    } finally { await s.close(); }
  });

  it('file de scrypt saturée : 503 et Retry-After', async () => {
    const s = await startServer({}, config => ({ ...config, scrypt: { ...config.scrypt, N: 2 ** 12, concurrency: 1, queue: 1 } }));
    try {
      const attempts = Array.from({ length: 6 }, (_, i) => s.call('POST', '/api/auth/login', { body: { email: `q${i}@exemple.test`, password: PASSWORD } }));
      const results = await Promise.all(attempts);
      const statuses = results.map(r => r.status);
      assert.ok(statuses.includes(503), statuses.join());
      assert.ok(statuses.includes(401), statuses.join());
      const busy = results.find(r => r.status === 503);
      assert.equal(busy.headers.get('retry-after'), '5');
      assert.equal(busy.body.code, 'busy');
    } finally { await s.close(); }
  });

  it('inscriptions fermées : 403', async () => {
    const s = await startServer({ BARO_INSCRIPTIONS: 'ferme' });
    try {
      const res = await s.call('POST', '/api/auth/register', { body: { email: 'x@exemple.test', password: PASSWORD, displayName: 'X' } });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'registrations_closed');
      assert.match(res.body.message, /fermées/);
    } finally { await s.close(); }
  });
});

describe('mode de test local', () => {
  it('pose un cookie sans préfixe __Host- ni Secure, et le relit', async () => {
    const s = await startServer({ BARO_INSECURE_COOKIE: '1' });
    try {
      const res = await s.call('POST', '/api/auth/register', { body: { email: 'local@exemple.test', password: PASSWORD, displayName: 'L' } });
      assert.equal(res.status, 201);
      const line = res.setCookie[0];
      assert.match(line, /^baro_sid=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
      const token = tokenFrom(res, 'baro_sid');
      assert.equal((await s.call('GET', '/api/me', { cookie: token, cookieName: 'baro_sid' })).status, 200);
      assert.equal((await s.call('GET', '/api/me', { cookie: token })).status, 401);
    } finally { await s.close(); }
  });
});

/* Sous PM2, le script lancé par Node n'est pas celui du serveur : le démarrage ne doit pas en dépendre. */
it('le serveur démarre quand un lanceur importe son point d’entrée', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'baro-start-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../src/start.js', import.meta.url).href)})`], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), BARO_DB: join(directory, 'baro.db'), BARO_INACTIVITY: 'inactif', BARO_ORIGIN: 'http://localhost', BARO_INSECURE_COOKIE: '1', BARO_SCRYPT_N: '1024' },
    stdio: 'ignore'
  });
  try {
    let status = 0;
    for (let i = 0; i < 50 && !status; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      status = await fetch(`http://127.0.0.1:${port}/api/me`).then(res => res.status, () => 0);
    }
    assert.equal(status, 401);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
