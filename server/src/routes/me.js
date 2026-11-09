import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { ACCOUNT_BODY, HttpError, tooMany } from '../http.js';
import { createAccountRemoval, createAccountUsage } from '../accounts.js';
import { publicUser } from '../auth.js';
import { ValidationError, emptyAccountData, isValidPassword, normalizeDisplayName, normalizePassword, prepareAccountData } from '../validate.js';
import { readBoard } from './boards.js';

const MIN = 60 * 1000;
// Exception à la limite de 16 Kio des routes de compte, comme pour les tableaux : les modèles sont des tableaux.
export const ACCOUNT_DATA_BODY = 2.5 * 1024 * 1024;

export function registerMeRoutes(router, app) {
  const { db, passwords, sessions, limiter, config } = app;
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const rename = db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?');
  const setHash = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?');
  const ownedBoards = db.prepare("SELECT board_id AS id FROM board_members WHERE user_id = ? AND role = 'owner'");
  const otherMemberships = db.prepare("SELECT board_id AS boardId, role FROM board_members WHERE user_id = ? AND role <> 'owner'");
  // Métadonnées seules : le nom du tableau et celui de l'invitant appartiennent à autrui.
  const receivedInvites = db.prepare('SELECT board_id AS boardId, role, created_at AS createdAt, expires_at AS expiresAt FROM board_invites WHERE email = ? AND expires_at > ?');
  const removeAccount = createAccountRemoval(db);
  const usage = createAccountUsage(db);
  const accountData = db.prepare('SELECT data, rev FROM account_data WHERE user_id = ?');
  const upsertData = db.prepare(`INSERT INTO account_data (user_id, data, rev, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, rev = excluded.rev, updated_at = excluded.updated_at`);

  function readData(userId) {
    const row = accountData.get(userId);
    return row ? { rev: row.rev, data: JSON.parse(row.data) } : { rev: 0, data: emptyAccountData() };
  }

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

  router.add('GET', '/api/me/data', ctx => ({ body: readData(ctx.session.userId) }), { auth: 'account' });

  /* Remplacement entier, à révision attendue. Le quota de 100 Mio compte tableaux et données du compte. */
  router.add('PUT', '/api/me/data', ctx => {
    const { baseRev, data } = ctx.body;
    if (!Number.isSafeInteger(baseRev) || baseRev < 0) throw new HttpError(400, 'invalid_base_rev', 'Révision de base (baseRev) manquante ou invalide.', { extra: { path: 'baseRev' } });
    let prepared;
    try { prepared = prepareAccountData(data); }
    catch (err) {
      if (err instanceof ValidationError) throw new HttpError(400, err.code, err.message, { extra: { path: err.path } });
      throw err;
    }
    const userId = ctx.session.userId;
    const rev = db.transaction(() => {
      const current = accountData.get(userId)?.rev ?? 0;
      if (current !== baseRev) throw new HttpError(409, 'conflict', 'Les données du compte ont été modifiées entre-temps.', { extra: { rev: current } });
      const next = usage.boardBytes(userId) + Buffer.byteLength(prepared.json);
      if (next > config.accountBoardQuotaBytes) {
        throw new HttpError(403, 'quota_exceeded', 'Le quota de stockage de votre compte est dépassé. Supprimez un tableau ou un modèle.');
      }
      upsertData.run(userId, prepared.json, current + 1, Date.now());
      return current + 1;
    })();
    return { body: { rev } };
  }, { auth: 'account', bodyLimit: ACCOUNT_DATA_BODY });

  router.add('GET', '/api/me/export', async ctx => {
    const userId = ctx.session.userId;
    const { res } = ctx;
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="baro-export.json"');
    for (const [name, value] of Object.entries(ctx.headers)) res.setHeader(name, value);
    const prefix = JSON.stringify({ exportedAt: new Date().toISOString(), user: publicUser(userById.get(userId)), data: readData(userId).data }).slice(0, -1);
    await write(res, `${prefix},"boards":[`);
    let first = true;
    for (const { id } of ownedBoards.all(userId)) {
      await yieldToLoop();
      const board = readBoard(db, id);
      await write(res, `${first ? '' : ','}${JSON.stringify(board)}`);
      first = false;
    }
    await yieldToLoop();
    await write(res, `],"memberships":${JSON.stringify(otherMemberships.all(userId))},"invites":${JSON.stringify(receivedInvites.all(ctx.session.user.email, Date.now()))}}`);
    res.end();
    return { handled: true };
  }, { auth: 'account', rate: { bucket: 'account-export', account: true, limit: 1, windowMs: 10 * MIN } });
}
