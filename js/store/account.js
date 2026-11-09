/*
 * État du compte : c'est lui qui ouvre ou ferme l'application.
 * L'indicateur ci-dessous ne dit qu'une chose (« une session a existé ici ») ; la session elle-même reste dans le cookie
 * HttpOnly, et seul GET /api/me la confirme. L'API et le miroir restent chargés par import() dynamique.
 *
 * getStatus() :
 *   loading     vérification en cours, rien n'est affiché ;
 *   signed-in   session confirmée par le serveur ;
 *   offline     serveur injoignable, session connue et miroir présent : l'application reste utilisable ;
 *   signed-out  pas de session ;
 *   unreachable serveur injoignable et rien sur cet appareil.
 */
import * as boards from './boards.js';
import * as local from './account-local.js';
import { forgetAccount } from './local-import.js';

export const SESSION_FLAG = 'tableau-accessible-compte';
/*
 * Laissé par une déconnexion ou une suppression voulue, juste avant de retirer l'indicateur : les autres onglets du
 * même compte y lisent si rien ne devait rester (« sans les garder », compte supprimé) au lieu de croire à une
 * session expirée. Sans ce choix explicite, ils gardent leur travail non envoyé, comme à une expiration.
 */
export const SIGNED_OUT_KEY = 'tableau-accessible-deconnexion';
const SIGNED_OUT_FRESH = 30 * 1000;

let api = null;
let remote = null;
let user = null;
let invites = [];
let status = 'loading';
let ready = Promise.resolve();
let restoring = false;
let booting = false;
let silentExpiry = false;
let reachable = true;
let listening = false;
const listeners = new Set();
const eventListeners = new Set();

export function hasSession() {
  try { return localStorage.getItem(SESSION_FLAG) === '1'; } catch { return false; }
}

function setFlag(on) {
  try {
    if (on) localStorage.setItem(SESSION_FLAG, '1');
    else localStorage.removeItem(SESSION_FLAG);
  } catch { /* stockage indisponible : la session vaudra pour cette page seulement */ }
}

function changed() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

function emit(event) {
  for (const fn of eventListeners) {
    try { fn(event); } catch (e) { console.error(e); }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* Événements des tableaux distants et de la session : conflit, accès perdu, miroir plein, hors-ligne… */
export function onEvent(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

export function getStatus() {
  return status;
}

export function getUser() {
  return user;
}

export function getInvites() {
  return invites;
}

export function isConnected() {
  return !!remote && hasSession() && !remote.isSuspended();
}

export function whenReady() {
  return ready;
}

function setUser(account) {
  user = account;
  boards.setViewer(account?.id);
}

async function loadModules() {
  if (remote) return;
  const [apiModule, remoteModule] = await Promise.all([import('../sync/api.js'), import('./remote-boards.js')]);
  api = apiModule;
  api.setHandlers({ unauthorized: () => expire({ silent: silentExpiry }), reachability: onReachability });
  remoteModule.setEventHandler(event => {
    if (event.type === 'foreign-owner') expire({ keepFlag: true, otherTab: true });
    else emit(event);
  });
  remoteModule.init();
  boards.attachRemote(remoteModule);
  remote = remoteModule;
  if (!listening) {
    listening = true;
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', () => { if (status === 'offline' || status === 'unreachable') start(); });
    // Espaces, favoris et modèles relus du serveur (chargement, autre onglet, autre appareil) : l'affichage suit.
    local.subscribe(() => { if (status === 'signed-in' || status === 'offline') changed(); });
    local.setRejectionHandler((error, what) => emit({ type: 'account-data-rejected', error, what }));
  }
}

/* Un événement par changement d'état, pas par requête : ni bruit répété, ni reprise manquée. */
function onReachability(isReachable) {
  if (isReachable === reachable) return;
  reachable = isReachable;
  emit({ type: reachable ? 'online' : 'offline' });
  if (!reachable) return;
  // Démarré hors ligne : la session n'a jamais été confirmée, le retour du serveur doit le faire.
  if (status === 'offline' && !booting) start();
  remote?.syncPending();
  local.syncPending();
}

/* L'indicateur est partagé entre onglets : celui qui ne l'a pas retiré doit aussi cesser d'écrire, et suivre une connexion. */
function onStorage(event) {
  if (event.key !== SESSION_FLAG && event.key !== null) return;
  if (!hasSession()) {
    const ended = signedOutElsewhere();
    if (ended?.discard) endedElsewhere(ended);
    else expire({ otherTab: true });
    // Déconnexion voulue : la copie de travail des espaces, favoris et modèles part ici aussi (ils sont sur le serveur),
    // après un dernier essai d'envoi de ce qui attendait dans cet onglet. Ce qui n'a pas pu partir est signalé.
    if (ended) {
      local.forgetAfterSending(ended.id, { removed: !!ended.removed })
        .then(sent => { if (!sent) emit({ type: 'account-data-unsent' }); })
        .catch(err => console.error(err));
    }
  } else if (!remote || remote.isSuspended()) start();
}

/* La déconnexion voulue, toute récente, du compte de cet onglet ; null sinon (expiration, autre compte). */
function signedOutElsewhere() {
  const id = user?.id || remote?.getOwner()?.id;
  if (!id) return null;
  try {
    const ended = JSON.parse(localStorage.getItem(SIGNED_OUT_KEY) || 'null');
    return ended?.id === id && Math.abs(Date.now() - ended.at) < SIGNED_OUT_FRESH ? ended : null;
  } catch {
    return null;
  }
}

/*
 * « Me déconnecter sans les garder » ou suppression du compte, dans un autre onglet : ce choix vaut ici aussi.
 * Le miroir qu'il a vidé n'est pas réécrit et le travail non envoyé de cet onglet n'est pas gardé.
 */
function endedElsewhere({ removed = false } = {}) {
  if (!remote || remote.isSuspended()) return;
  emit({ type: 'expired', otherTab: true, signedOut: removed ? 'removed' : 'discarded' });
  remote.discard();
  boards.detachRemote();
  remote = null;
  setUser(null);
  invites = [];
  status = 'signed-out';
  changed();
}

async function enter(account, nextStatus = 'signed-in') {
  setFlag(true);
  setUser(account);
  remote.setOwner(account);
  remote.resume();
  // Espaces, favoris et modèles chargés avec la liste : le premier affichage les montre déjà.
  await Promise.all([refreshBoards(), local.load()]);
  status = nextStatus;
  changed();
  remote.syncPending();
}

async function restore() {
  booting = true;
  await loadModules();
  // Sans indicateur, personne n'a de session à perdre : la page de connexion n'a rien à annoncer.
  silentExpiry = !hasSession();
  let me;
  try {
    me = await api.getMe();
  } catch (err) {
    silentExpiry = false;
    if (err.status === 401) {
      expire({ silent: !hasSession() });
      status = 'signed-out';
      changed();
      return;
    }
    const known = hasSession() && remote.getOwner();
    if (known) {
      setUser(remote.getOwner());
      remote.resume();
      status = 'offline';
    } else {
      status = 'unreachable';
    }
    changed();
    return;
  }
  silentExpiry = false;
  if (me.guest) { signedOut(); return; }
  await enter(me.user);
}

/* Au démarrage, et à chaque occasion de revérifier : une seule vérification à la fois. */
export function start() {
  if (restoring) return ready;
  restoring = true;
  ready = restore().catch(err => console.error(err)).finally(() => { restoring = false; booting = false; });
  return ready;
}

async function refreshInvites() {
  try {
    invites = (await api.listInvites()).invites || [];
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
  }
}

export async function refreshBoards() {
  if (!isConnected()) return;
  try {
    await Promise.all([remote.refreshList(), refreshInvites()]);
    changed();
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
  }
}

/* Rend { boardId, role } : la liste est déjà à jour au retour. */
export async function acceptInvite(id) {
  const res = await api.acceptInvite(id);
  invites = invites.filter(i => i.id !== id);
  await refreshBoards();
  return res;
}

export async function declineInvite(id) {
  await api.declineInvite(id);
  invites = invites.filter(i => i.id !== id);
  changed();
}

/* Rend le nombre d'invitations refusées par le serveur. */
export async function declineAllInvites() {
  const { declined } = await api.declineAllInvites();
  invites = [];
  changed();
  return declined;
}

export async function signedIn(account) {
  await loadModules();
  emit({ type: 'signed-in' });
  await enter(account);
}

export function updateUser(account) {
  setUser(account);
  remote?.setOwner(account);
  changed();
}

/*
 * La session n'est plus valable, ici ou dans un autre onglet : les modifications non envoyées restent sur l'appareil.
 * L'indicateur peut déjà avoir disparu : l'onglet doit quand même cesser d'écrire et garder son travail.
 * setUser(null) quitte aussi le compte dans store/account-local.js : ses changements en attente restent dans l'onglet,
 * et sa copie sera relue du serveur si la même personne se reconnecte ici.
 */
function expire({ keepFlag = false, otherTab = false, silent = false } = {}) {
  if (!remote || remote.isSuspended()) return;
  remote.suspend();
  if (!keepFlag) setFlag(false);
  setUser(null);
  invites = [];
  status = 'signed-out';
  if (!silent) emit({ type: 'expired', otherTab });
  changed();
}

/*
 * Déconnexion ou suppression du compte : le miroir est purgé, la copie de travail des espaces, favoris et modèles
 * aussi (ils sont sur le serveur). Le travail non envoyé des tableaux, si la personne l’a gardé, est mis de côté avant.
 * removed : le compte n'existe plus, le travail mis de côté pour lui sur l'appareil part aussi.
 * discarded : « Me déconnecter sans les garder » a été choisi ; les autres onglets du compte n'en gardent rien non plus.
 */
export function signedOut({ removed = false, discarded = false } = {}) {
  const id = user?.id || remote?.getOwner()?.id || null;
  if (id) {
    try { localStorage.setItem(SIGNED_OUT_KEY, JSON.stringify({ id, discard: removed || discarded, removed, at: Date.now() })); }
    catch { /* stockage plein : les autres onglets se croiront expirés et garderont leur travail */ }
  }
  if (id) local.forget(id, { removed });
  if (id && removed) {
    boards.removeReservedFor(id);
    forgetAccount(id);
  }
  remote?.purge();
  boards.detachRemote();
  remote = null;
  setFlag(false);
  setUser(null);
  invites = [];
  status = 'signed-out';
  emit({ type: 'signed-out' });
  changed();
}
