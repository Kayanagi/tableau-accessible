import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from '../src/auth.js';
import { COOKIE, startServer } from './helpers.js';

const HOUR = 3600 * 1000;

describe('GET /api/session (verrou nginx)', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  function assertEmpty(res, status) {
    assert.equal(res.status, status);
    assert.equal(res.body, null);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('content-type'), null);
    assert.deepEqual(res.setCookie, []);
  }

  it('répond 204 sans corps à une session de compte valide', async () => {
    const { token } = await s.signUp();
    assertEmpty(await s.call('GET', '/api/session', { cookie: token }), 204);
  });

  it('répond 401 sans corps sans cookie, avec un cookie mal formé ou inconnu', async () => {
    assertEmpty(await s.call('GET', '/api/session'), 401);
    assertEmpty(await s.call('GET', '/api/session', { cookie: 'pas-un-jeton' }), 401);
    assertEmpty(await s.call('GET', '/api/session', { cookie: 'a'.repeat(43) }), 401);
  });

  it('ne reconnaît que le cookie de session configuré', async () => {
    const { token } = await s.signUp();
    assertEmpty(await s.call('GET', '/api/session', { cookie: token, cookieName: 'baro_sid' }), 401);
    assert.equal(COOKIE, '__Host-baro_sid');
  });

  it('répond 401 après déconnexion', async () => {
    const { token } = await s.signUp();
    assert.equal((await s.call('POST', '/api/auth/logout', { cookie: token })).status, 204);
    assertEmpty(await s.call('GET', '/api/session', { cookie: token }), 401);
  });

  it('répond 401 à une session expirée, sans écrire en base', async () => {
    const { token } = await s.signUp();
    const hash = hashToken(token);
    s.app.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, hash);
    assertEmpty(await s.call('GET', '/api/session', { cookie: token }), 401);
    assert.ok(s.app.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(hash));
  });

  it('répond 401 à une session invitée : le site exige un compte', async () => {
    const { token, id } = await s.signUp();
    const t = Date.now();
    const created = await s.call('POST', '/api/boards', { cookie: token, body: { name: 'Tableau', data: {} } });
    const boardId = created.body?.board?.id ?? created.body?.id;
    s.app.db.prepare('INSERT INTO share_links (id, board_id, token_hash, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('l_test', boardId, Buffer.alloc(32, 1), 'viewer', id, t);
    const guest = 'g'.repeat(43);
    s.app.db.prepare('INSERT INTO sessions (token_hash, share_link_id, guest_name, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hashToken(guest), 'l_test', 'Invité', t, t, t + HOUR);
    assert.equal((await s.call('GET', '/api/me', { cookie: guest })).body.guest, true);
    assertEmpty(await s.call('GET', '/api/session', { cookie: guest }), 401);
  });

  it('ne fait ni glisser la session ni compter comme une activité', async () => {
    const { token, id } = await s.signUp();
    const hash = hashToken(token);
    const longAgo = Date.now() - 2 * HOUR;
    const expires = Date.now() + HOUR;
    s.app.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(longAgo, expires, hash);
    s.app.db.prepare('UPDATE users SET last_active_at = ?, inactivity_warned_at = ? WHERE id = ?').run(longAgo, longAgo, id);
    assertEmpty(await s.call('GET', '/api/session', { cookie: token }), 204);
    assert.deepEqual({ ...s.app.db.prepare('SELECT last_seen_at, expires_at FROM sessions WHERE token_hash = ?').get(hash) }, { last_seen_at: longAgo, expires_at: expires });
    assert.deepEqual({ ...s.app.db.prepare('SELECT last_active_at, inactivity_warned_at FROM users WHERE id = ?').get(id) }, { last_active_at: longAgo, inactivity_warned_at: longAgo });
  });

  it('ne subit aucune limite de débit, même depuis une seule adresse', async () => {
    const { token } = await s.signUp();
    for (let i = 0; i < 500; i++) {
      const res = await s.call('GET', '/api/session', { cookie: token, ip: '10.200.0.1' });
      assert.equal(res.status, 204);
    }
  });

  it('n’accepte que GET ; toute écriture passe d’abord par la garde CSRF', async () => {
    const { token } = await s.signUp();
    assert.equal((await s.call('POST', '/api/session', { cookie: token, body: {} })).status, 405);
    assert.equal((await s.call('POST', '/api/session', { cookie: token, body: {}, origin: 'https://ailleurs.test' })).status, 403);
  });
});

describe('cookie de session', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  it('est SameSite=Lax à l’ouverture, au glissement et à l’effacement', async () => {
    const { token } = await s.signUp();
    s.app.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(Date.now() - 2 * HOUR, hashToken(token));
    const slid = await s.call('GET', '/api/me', { cookie: token });
    assert.equal(slid.setCookie[0], `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    const out = await s.call('POST', '/api/auth/logout', { cookie: token });
    assert.equal(out.setCookie[0], `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  });

  it('Lax ne dispense pas de la garde CSRF sur les écritures', async () => {
    const { token } = await s.signUp();
    assert.equal((await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: 'X' }, origin: 'https://ailleurs.test' })).status, 403);
    assert.equal((await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: 'X' }, origin: null })).status, 403);
    assert.equal((await s.call('PATCH', '/api/me', { cookie: token, raw: '{"displayName":"X"}', contentType: 'text/plain' })).status, 415);
    assert.equal((await s.call('PATCH', '/api/me', { cookie: token, body: { displayName: 'X' } })).status, 200);
  });
});
