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

export const SESSION_FLAG = 'tableau-accessible-compte';

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
}

/* L'indicateur est partagé entre onglets : celui qui ne l'a pas retiré doit aussi cesser d'écrire, et suivre une connexion. */
function onStorage(event) {
  if (event.key !== SESSION_FLAG && event.key !== null) return;
  if (!hasSession()) expire({ otherTab: true });
  else if (!remote || remote.isSuspended()) start();
}

async function enter(account, nextStatus = 'signed-in') {
  setFlag(true);
  setUser(account);
  remote.setOwner(account);
  remote.resume();
  await refreshBoards();
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

/* Déconnexion ou suppression du compte : le miroir est purgé. */
export function signedOut() {
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
