import { setImmediate as yieldToLoop, setTimeout as sleep } from 'node:timers/promises';
import { createAccountRemoval } from './accounts.js';

const DAY = 24 * 3600 * 1000;
export const DELETE_AFTER_DAYS = 730;
export const NOTICE_DAYS = 30;
export const WARN_AFTER_DAYS = DELETE_AFTER_DAYS - NOTICE_DAYS;
export const BATCH_SIZE = 100;
const PASS_INTERVAL = DAY;
const PAUSE_BETWEEN_SENDS = 1000;

export const WARNING_SUBJECT = 'Votre compte Baro sera bientôt supprimé';
export const WARNING_TEXT = `Bonjour,

Votre compte Baro est sans connexion depuis bientôt 24 mois.

Il sera supprimé avec ses tableaux dans 30 jours.

Pour le garder, il suffit de vous connecter sur https://baro.dwes.fr

Pour toute question, écrivez à rgpd@dwes.fr.

Baro
`;

const reason = err => err?.code || err?.name || 'erreur inconnue';

/* Règle de sûreté : un compte n'est supprimé qu'après un avertissement réussi d'au moins 30 jours.
   `send` n'a pas de valeur par défaut, et seule une réponse strictement true vaut envoi réussi.
   Les journaux ne portent que l'identifiant du compte, jamais l'e-mail. */
export function createInactivity({ db, send, now = Date.now, batchSize = BATCH_SIZE, pauseMs = PAUSE_BETWEEN_SENDS, log = console }) {
  const removeAccount = createAccountRemoval(db);
  const dueForDeletion = db.prepare('SELECT id FROM users WHERE inactivity_warned_at <= ? AND last_active_at < ? AND id > ? ORDER BY id LIMIT ?');
  const dueForWarning = db.prepare('SELECT id FROM users WHERE inactivity_warned_at IS NULL AND last_active_at < ? AND id > ? ORDER BY id LIMIT ?');
  const stillDeletable = db.prepare('SELECT 1 FROM users WHERE id = ? AND inactivity_warned_at <= ? AND last_active_at < ?');
  const stillWarnable = db.prepare('SELECT email, last_active_at FROM users WHERE id = ? AND inactivity_warned_at IS NULL AND last_active_at < ?');
  const markWarned = db.prepare('UPDATE users SET inactivity_warned_at = ? WHERE id = ? AND inactivity_warned_at IS NULL AND last_active_at = ?');

  // Reprise après le dernier compte vu : des comptes en échec ne bloquent pas ceux qui les suivent.
  const cursors = { deletion: '', warning: '' };
  let stopped = false;
  let running = null;
  let timer = null;

  function take(statement, name, cutoffs, limit) {
    if (limit <= 0) return [];
    const rows = statement.all(...cutoffs, cursors[name], limit);
    cursors[name] = rows.length === limit ? rows.at(-1).id : '';
    return rows;
  }

  // Conditions relues dans la transaction : une connexion a pu arriver depuis la sélection du lot.
  const deleteIfDue = db.transaction(id => {
    const t = now();
    if (!stillDeletable.get(id, t - NOTICE_DAYS * DAY, t - DELETE_AFTER_DAYS * DAY)) return false;
    removeAccount(id);
    return true;
  }).immediate;

  async function deleteBatch(stats, limit) {
    const t = now();
    const rows = take(dueForDeletion, 'deletion', [t - NOTICE_DAYS * DAY, t - DELETE_AFTER_DAYS * DAY], limit);
    for (const { id } of rows) {
      if (stopped) break;
      try {
        if (deleteIfDue(id)) {
          stats.deleted++;
          log.log(`[baro] compte supprimé pour inactivité : ${id}`);
        }
      } catch (err) {
        stats.failed++;
        log.error(`[baro] suppression pour inactivité reportée, compte ${id} : ${reason(err)}`);
      }
      await yieldToLoop();
    }
    return rows.length;
  }

  async function warnOne(id, stats) {
    const account = stillWarnable.get(id, now() - WARN_AFTER_DAYS * DAY);
    if (!account) return;
    let sent = false;
    try {
      sent = (await send({ to: account.email, subject: WARNING_SUBJECT, text: WARNING_TEXT })) === true;
    } catch (err) {
      log.error(`[baro] erreur d’envoi de l’avertissement, compte ${id} : ${reason(err)}`);
    }
    if (stopped) return;
    if (!sent) {
      stats.failed++;
      log.error(`[baro] avertissement d’inactivité non envoyé, compte ${id} : nouvel essai au prochain passage`);
      return;
    }
    // Sans effet si le compte s'est connecté ou a été supprimé pendant l'envoi.
    if (markWarned.run(now(), id, account.last_active_at).changes) {
      stats.warned++;
      log.log(`[baro] avertissement d’inactivité envoyé, compte ${id}`);
    }
  }

  async function warnBatch(stats, limit) {
    const rows = take(dueForWarning, 'warning', [now() - WARN_AFTER_DAYS * DAY], limit);
    for (const { id } of rows) {
      if (stopped) break;
      await warnOne(id, stats);
      if (pauseMs > 0 && !stopped) await sleep(pauseMs, undefined, { ref: false });
      else await yieldToLoop();
    }
  }

  async function pass() {
    const stats = { warned: 0, deleted: 0, failed: 0 };
    try {
      const handled = await deleteBatch(stats, batchSize);
      if (!stopped) await warnBatch(stats, batchSize - handled);
    } catch (err) {
      stats.failed++;
      log.error(`[baro] passage d’inactivité interrompu : ${reason(err)}`);
    }
    return stats;
  }

  /* Un seul passage à la fois : un appel pendant un passage en cours reçoit le même résultat. */
  function run() {
    running ??= pass().finally(() => { running = null; });
    return running;
  }

  return {
    run,
    start() {
      run();
      timer = setInterval(run, PASS_INTERVAL);
      timer.unref();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
