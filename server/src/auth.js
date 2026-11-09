import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpError, parseCookies } from './http.js';

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_STORED_N = 2 ** 20;
const HOUR = 3600 * 1000;
export const SESSION_TTL = 30 * 24 * HOUR;
const TOKEN_FORMAT = /^[\w-]{43}$/;

export class ScryptBusyError extends HttpError {
  constructor() {
    super(503, 'busy', 'Le serveur est très sollicité. Réessayez dans quelques secondes.', { headers: { 'Retry-After': '5' } });
  }
}

function derive(password, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function parseHash(stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const valid = Number.isInteger(N) && N > 1 && N <= MAX_STORED_N && (N & (N - 1)) === 0
    && Number.isInteger(r) && r > 0 && r <= 32 && Number.isInteger(p) && p > 0 && p <= 16;
  if (!valid) return null;
  return { N, r, p, salt: Buffer.from(parts[4], 'base64url'), key: Buffer.from(parts[5], 'base64url') };
}

/* Calculs scrypt : `concurrency` simultanés, `queue` en attente, puis refus immédiat. */
export function createPasswords({ N, r, p, concurrency, queue, perPrefix = 2 }) {
  let active = 0;
  const waiting = [];
  const byPrefix = new Map();

  function schedule(task, prefix = '') {
    return new Promise((resolve, reject) => {
      const prefixLoad = byPrefix.get(prefix) ?? 0;
      if (prefix && prefixLoad >= perPrefix) { reject(new ScryptBusyError()); return; }
      if (prefix) byPrefix.set(prefix, prefixLoad + 1);
      const done = () => {
        if (!prefix) return;
        const left = (byPrefix.get(prefix) ?? 1) - 1;
        if (left) byPrefix.set(prefix, left); else byPrefix.delete(prefix);
      };
      const run = () => {
        active++;
        task().then(resolve, reject).finally(() => {
          active--;
          done();
          waiting.shift()?.();
        });
      };
      if (active < concurrency) run();
      else if (waiting.length < queue) waiting.push(run);
      else { done(); reject(new ScryptBusyError()); }
    });
  }

  async function hash(password, prefix) {
    const salt = randomBytes(SALT_LENGTH);
    const key = await schedule(() => derive(password, salt, { N, r, p }), prefix);
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  async function verify(password, stored, prefix) {
    const parsed = parseHash(stored);
    if (!parsed || parsed.key.length !== KEY_LENGTH) return false;
    const key = await schedule(() => derive(password, parsed.salt, parsed), prefix);
    return timingSafeEqual(key, parsed.key);
  }

  /* Même coût qu'une vérification réelle, pour un compte inconnu. */
  async function fakeVerify(password, prefix) {
    await schedule(() => derive(password, randomBytes(SALT_LENGTH), { N, r, p }), prefix);
    return false;
  }

  function needsRehash(stored) {
    const parsed = parseHash(stored);
    return !parsed || parsed.N !== N || parsed.r !== r || parsed.p !== p;
  }

  return { hash, verify, fakeVerify, needsRehash, load: () => ({ active, waiting: waiting.length }) };
}

export function newId(prefix) {
  return prefix + randomBytes(16).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest();
}

export function sessionCookie({ name, secure }, token, maxAgeSeconds) {
  const attrs = [`${name}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.splice(3, 0, 'Secure');
  return attrs.join('; ');
}

export function createSessions(db, config) {
  const cookie = config.cookie;
  const queries = {
    insert: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    find: db.prepare(`SELECT s.token_hash, s.user_id, s.share_link_id, s.guest_name, s.last_seen_at, s.expires_at,
        u.email, u.display_name, u.created_at AS user_created_at,
        l.board_id AS link_board_id, l.role AS link_role, l.expires_at AS link_expires_at, l.revoked_at AS link_revoked_at
      FROM sessions s
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN share_links l ON l.id = s.share_link_id
      WHERE s.token_hash = ?`),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    removeUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    touch: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?'),
    markActive: db.prepare('UPDATE users SET last_active_at = ?, inactivity_warned_at = NULL WHERE id = ?'),
    accountAlive: db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND user_id IS NOT NULL AND expires_at > ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
  };

  /* Toute connexion passe ici : elle compte comme activité et annule un avertissement d'inactivité. */
  const create = db.transaction(userId => {
    const token = randomBytes(32).toString('base64url');
    const t = Date.now();
    queries.insert.run(hashToken(token), userId, t, t, t + SESSION_TTL);
    queries.markActive.run(t, userId);
    return token;
  });

  const touchAccount = db.transaction((t, expires, hash, userId) => {
    queries.touch.run(t, expires, hash);
    queries.markActive.run(t, userId);
  });

  function tokenOf(req) {
    const token = parseCookies(req.headers.cookie).get(cookie.name);
    return token && TOKEN_FORMAT.test(token) ? token : null;
  }

  /* Renvoie la session valide ou null. Le jeton glisse au plus une fois par heure, invités exceptés. */
  function resolve(req) {
    const token = tokenOf(req);
    if (!token) return { session: null };
    const hash = hashToken(token);
    const row = queries.find.get(hash);
    if (!row) return { session: null };
    const t = Date.now();
    const guest = row.share_link_id !== null;
    const linkDead = guest && (row.link_revoked_at !== null || (row.link_expires_at !== null && row.link_expires_at <= t));
    if (row.expires_at <= t || linkDead) {
      queries.remove.run(hash);
      return { session: null };
    }
    let setCookie = null;
    const fetchSite = req.headers['sec-fetch-site'];
    const mayRefresh = fetchSite === undefined || fetchSite === 'same-origin';
    if (mayRefresh && t - row.last_seen_at >= HOUR) {
      const expires = guest ? row.expires_at : t + SESSION_TTL;
      if (guest) queries.touch.run(t, expires, hash);
      else touchAccount(t, expires, hash, row.user_id);
      if (!guest) setCookie = sessionCookie(cookie, token, SESSION_TTL / 1000);
    }
    const session = guest
      ? { guest: true, key: hash.toString('hex'), hash, boardId: row.link_board_id, role: row.link_role, guestName: row.guest_name }
      : { guest: false, key: hash.toString('hex'), hash, userId: row.user_id, user: { id: row.user_id, email: row.email, displayName: row.display_name, createdAt: row.user_created_at } };
    return { session, setCookie };
  }

  /* Pour le verrou nginx : simple lecture. Aucun glissement, aucune activité, aucune suppression. */
  function isAccountSession(req) {
    const token = tokenOf(req);
    return Boolean(token && queries.accountAlive.get(hashToken(token), Date.now()));
  }

  return {
    create,
    resolve,
    isAccountSession,
    tokenOf,
    destroy: hash => queries.remove.run(hash),
    destroyByToken: token => queries.remove.run(hashToken(token)),
    destroyAll: userId => queries.removeUser.run(userId),
    purgeExpired: () => queries.purge.run(Date.now()).changes,
    setCookie: token => sessionCookie(cookie, token, SESSION_TTL / 1000),
    clearCookie: () => sessionCookie(cookie, '', 0)
  };
}

export function publicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}
