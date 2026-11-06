/*
 * État du compte, sans dépendance réseau : l'indicateur ci-dessous évite tout appel à /api/ en mode local.
 * Il ne dit qu'une chose (« une session a existé ici ») ; la session elle-même reste dans le cookie HttpOnly.
 * L'API et le miroir ne sont chargés, par import() dynamique, que s'il est présent ou à la connexion.
 */
import * as boards from './boards.js';

export const SESSION_FLAG = 'tableau-accessible-compte';

let api = null;
let remote = null;
let user = null;
let ready = Promise.resolve();
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

export function getUser() {
  return user;
}

export function isConnected() {
  return !!remote && hasSession() && !remote.isSuspended();
}

export function whenReady() {
  return ready;
}

async function loadModules() {
  if (remote) return;
  const [apiModule, remoteModule] = await Promise.all([import('../sync/api.js'), import('./remote-boards.js')]);
  api = apiModule;
  api.setHandlers({ unauthorized: () => expire(), reachability: onReachability });
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
  }
}

/* Un événement par changement d'état, pas par requête : ni bruit répété, ni reprise manquée. */
function onReachability(isReachable) {
  if (isReachable === reachable) return;
  reachable = isReachable;
  emit({ type: reachable ? 'online' : 'offline' });
  if (reachable) remote?.syncPending();
}

/* L'indicateur est partagé entre onglets : celui qui ne l'a pas retiré doit aussi cesser d'écrire. */
function onStorage(event) {
  if (event.key !== SESSION_FLAG && event.key !== null) return;
  if (!remote) return;
  if (!hasSession()) expire({ otherTab: true });
  else if (remote.isSuspended()) start();
}

async function restore() {
  await loadModules();
  changed();
  try {
    const me = await api.getMe();
    if (me.guest) { signedOut(); return; }
    user = me.user;
    remote.setOwner(user);
    remote.resume();
  } catch (err) {
    if (err.status === 401) return;
    user = remote.getOwner();
    changed();
    return;
  }
  changed();
  await refreshBoards();
  remote.syncPending();
}

/* Au démarrage : ne fait rien, et surtout aucune requête, sans l'indicateur. */
export function start() {
  if (!hasSession()) return;
  ready = restore().catch(err => console.error(err));
}

export async function refreshBoards() {
  if (!isConnected()) return;
  try {
    await remote.refreshList();
    changed();
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
  }
}

export async function signedIn(account) {
  setFlag(true);
  await loadModules();
  user = account;
  remote.setOwner(account);
  remote.resume();
  emit({ type: 'signed-in' });
  changed();
  await refreshBoards();
  remote.syncPending();
}

export function updateUser(account) {
  user = account;
  remote?.setOwner(account);
  changed();
}

/*
 * La session n'est plus valable, ici ou dans un autre onglet : les modifications non envoyées restent sur l'appareil.
 * L'indicateur peut déjà avoir disparu : l'onglet doit quand même cesser d'écrire et garder son travail.
 */
function expire({ keepFlag = false, otherTab = false } = {}) {
  if (!remote || remote.isSuspended()) return;
  remote.suspend();
  if (!keepFlag) setFlag(false);
  user = null;
  emit({ type: 'expired', otherTab });
  changed();
}

/* Déconnexion ou suppression du compte : le miroir est purgé. */
export function signedOut() {
  remote?.purge();
  boards.detachRemote();
  remote = null;
  setFlag(false);
  user = null;
  changed();
}
