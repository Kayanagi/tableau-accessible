import { randomBytes } from 'node:crypto';
import { hashToken } from './auth.js';
import { createRateLimiter } from './rate-limit.js';

const HOUR = 3600 * 1000;
const GLOBAL_SEND_LIMIT = 200;
export const RESET_TTL = HOUR;
const TOKEN_FORMAT = /^[\w-]{43}$/;

export const RESET_SUBJECT = 'Baro : réinitialiser votre mot de passe';

export function resetText(link) {
  return `Bonjour,

Une demande de réinitialisation du mot de passe de votre compte Baro vient d'être faite.

Pour choisir un nouveau mot de passe, ouvrez ce lien :
${link}

Ce lien est valable une heure et ne sert qu'une fois.

Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas.

Pour toute question, écrivez à rgpd@dwes.fr.

Baro
`;
}

/*
 * Mot de passe oublié. La demande ne fait rien de visible pendant la requête : la recherche du compte,
 * la création du jeton et l'envoi partent en tâche différée, après la réponse, pour que statut, corps
 * et durée soient les mêmes avec ou sans compte. Seul le haché SHA-256 du jeton est gardé en base.
 * Les journaux ne portent jamais l'adresse ni le jeton.
 */
export function createPasswordResets({ db, send, publicUrl, now = Date.now, limiter = createRateLimiter(now), log = console }) {
  const queries = {
    findUser: db.prepare('SELECT id, email FROM users WHERE email = ?'),
    dropUnused: db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL'),
    insert: db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    find: db.prepare('SELECT user_id AS userId FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'),
    markUsed: db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'),
    dropOthers: db.prepare('DELETE FROM password_resets WHERE user_id = ? AND token_hash <> ?'),
    revokeAll: db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
    setHash: db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'),
    removeSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purge: db.prepare('DELETE FROM password_resets WHERE expires_at <= ?')
  };
  const pending = new Set();

  /* Un seul jeton utilisable par compte : le nouveau remplace les précédents non utilisés. */
  const issue = db.transaction(userId => {
    const token = randomBytes(32).toString('base64url');
    const t = now();
    queries.dropUnused.run(userId);
    queries.insert.run(hashToken(token), userId, t, t + RESET_TTL);
    return token;
  });

  async function deliver(email) {
    const user = queries.findUser.get(email);
    if (!user) return;
    if (limiter?.hit('reset-all', '*', GLOBAL_SEND_LIMIT, HOUR)) {
      log.warn('[baro] ALERTE réinitialisation : plafond global de 200 envois par heure atteint');
      return;
    }
    const token = issue(user.id);
    const link = `${publicUrl}/reinitialiser.html#jeton=${token}`;
    let ok = false;
    try { ok = (await send({ to: user.email, subject: RESET_SUBJECT, text: resetText(link) })) === true; }
    catch { ok = false; }
    if (!ok) log.warn(`[baro] réinitialisation : envoi non confirmé pour le compte ${user.id}`);
  }

  /* À appeler avec une adresse déjà normalisée et validée. Ne lève jamais, ne renvoie rien. */
  function request(email) {
    const task = new Promise(resolve => setImmediate(resolve))
      .then(() => deliver(email))
      .catch(err => log.error(`[baro] réinitialisation : échec de la tâche différée : ${err?.code || err?.name || 'erreur inconnue'}`))
      .finally(() => pending.delete(task));
    pending.add(task);
  }

  /* Le compte d'un jeton utilisable, ou null : inexistant, expiré et utilisé se confondent. */
  function check(token) {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return null;
    return queries.find.get(hashToken(token), now())?.userId ?? null;
  }

  /* Le jeton est relu dans la transaction : deux confirmations simultanées n'en valident qu'une. */
  const consume = db.transaction((token, userId, passwordHash) => {
    const hash = hashToken(token);
    const t = now();
    if (queries.find.get(hash, t)?.userId !== userId) return false;
    queries.markUsed.run(t, hash, t);
    queries.setHash.run(passwordHash, t, userId);
    queries.removeSessions.run(userId);
    queries.dropOthers.run(userId, hash);
    return true;
  });

  return {
    request,
    check,
    consume,
    revokeAll: userId => queries.revokeAll.run(userId).changes,
    purgeExpired: () => queries.purge.run(now()).changes,
    /* Pour les tests et l'arrêt : attend la fin des envois en cours. */
    idle: async () => { while (pending.size) await Promise.allSettled([...pending]); }
  };
}
