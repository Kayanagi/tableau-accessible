import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { ACCOUNT_BODY, HttpError, tooMany } from '../http.js';
import { createAccountRemoval } from '../accounts.js';
import { publicUser } from '../auth.js';
import { isValidPassword, normalizeDisplayName, normalizePassword } from '../validate.js';
import { readBoard } from './boards.js';

const MIN = 60 * 1000;

export function registerMeRoutes(router, app) {
  const { db, passwords, sessions, limiter } = app;
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const rename = db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?');
  const setHash = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?');
  const ownedBoards = db.prepare("SELECT board_id AS id FROM board_members WHERE user_id = ? AND role = 'owner'");
  const otherMemberships = db.prepare("SELECT board_id AS boardId, role FROM board_members WHERE user_id = ? AND role <> 'owner'");
  const removeAccount = createAccountRemoval(db);

  async function write(res, chunk) {
    if (res.write(chunk)) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); };
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(new Error('connexion fermée pendant l’export')); };
      res.once('drain', onDrain);
      res.once('close', onClose);
    });
  }

  /* Réponse 403 et non 401 : une erreur de saisie ne doit pas faire croire à une session perdue. */
  async function requirePassword(ctx, value) {
    const wait = limiter.hit('password-check', ctx.session.userId, 5, 15 * MIN);
    if (wait) throw tooMany(wait);
    const password = normalizePassword(value);
    const user = userById.get(ctx.session.userId);
    if (!isValidPassword(password) || !(await passwords.verify(password, user.password_hash, ctx.ipKey))) {
      throw new HttpError(403, 'wrong_password', 'Mot de passe incorrect.');
    }
  }

  router.add('GET', '/api/me', ctx => {
    const s = ctx.session;
    if (s.guest) return { body: { guest: true, boardId: s.boardId, role: s.role, guestName: s.guestName } };
    return { body: { guest: false, user: s.user } };
  }, { auth: 'session' });

  router.add('PATCH', '/api/me', ctx => {
    const name = normalizeDisplayName(ctx.body.displayName);
    if (!name) throw new HttpError(400, 'invalid_display_name', 'Le nom affiché doit contenir de 1 à 50 caractères.');
    rename.run(name, Date.now(), ctx.session.userId);
    return { body: { guest: false, user: publicUser(userById.get(ctx.session.userId)) } };
  }, { auth: 'account', bodyLimit: ACCOUNT_BODY });

  router.add('POST', '/api/me/password', async ctx => {
    const next = normalizePassword(ctx.body.newPassword);
    if (!isValidPassword(next)) throw new HttpError(400, 'invalid_password', 'Le mot de passe doit contenir de 12 à 128 caractères.');
    await requirePassword(ctx, ctx.body.oldPassword);
    const hash = await passwords.hash(next, ctx.ipKey);
    const token = db.transaction(() => {
      setHash.run(hash, Date.now(), ctx.session.userId);
      sessions.destroyAll(ctx.session.userId);
      return sessions.create(ctx.session.userId);
    })();
    return { status: 204, headers: { 'Set-Cookie': sessions.setCookie(token) } };
  }, { auth: 'account', bodyLimit: ACCOUNT_BODY });

  router.add('DELETE', '/api/me', async ctx => {
    await requirePassword(ctx, ctx.body.password);
    removeAccount(ctx.session.userId);
    return { status: 204, headers: { 'Set-Cookie': sessions.clearCookie() } };
  }, { auth: 'account', bodyLimit: ACCOUNT_BODY });

  router.add('GET', '/api/me/export', async ctx => {
    const userId = ctx.session.userId;
    const { res } = ctx;
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="baro-export.json"');
    for (const [name, value] of Object.entries(ctx.headers)) res.setHeader(name, value);
    const prefix = JSON.stringify({ exportedAt: new Date().toISOString(), user: publicUser(userById.get(userId)) }).slice(0, -1);
    await write(res, `${prefix},"boards":[`);
    let first = true;
    for (const { id } of ownedBoards.all(userId)) {
      await yieldToLoop();
      const board = readBoard(db, id);
      await write(res, `${first ? '' : ','}${JSON.stringify(board)}`);
      first = false;
    }
    await yieldToLoop();
    await write(res, `],"memberships":${JSON.stringify(otherMemberships.all(userId))}}`);
    res.end();
    return { handled: true };
  }, { auth: 'account', rate: { bucket: 'account-export', account: true, limit: 1, windowMs: 10 * MIN } });
}
