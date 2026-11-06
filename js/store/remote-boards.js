/*
 * Tableaux du compte : miroir local, écriture différée vers le serveur, conflits.
 * Chargé par import() dynamique, et seulement s'il y a un compte. Le miroir a sa propre clé, plafonnée :
 * il ne peut pas remplir le quota et faire échouer l'enregistrement des tableaux locaux.
 */
import * as api from '../sync/api.js';
import * as boards from './boards.js';
import { SESSION_FLAG } from './account.js';
import { normalizeBoardIcon } from '../ui/icons.js';

export const MIRROR_KEY = 'tableau-accessible-distants';
export const MIRROR_MAX_BYTES = 2 * 1024 * 1024;

const VERSION = 1;
const PERSIST_DELAY = 1000;
const WRITE_DELAY = 3000;
const WRITE_MAX_WAIT = 15000;
const RETRY_MIN = 3000;
const RETRY_MAX = 30000;

let owner = null;
let suspended = false;
let openId = null;
let listening = false;
let persistTimer = null;
let emit = () => {};
const entries = new Map();
const runtime = new Map();

function runtimeOf(id) {
  let rt = runtime.get(id);
  if (!rt) { rt = { timer: null, firstEdit: 0, inflight: null, lastJson: null, retry: 0, blocked: false, viewerWarned: false }; runtime.set(id, rt); }
  return rt;
}

function forget(id) {
  const rt = runtime.get(id);
  if (rt) clearTimeout(rt.timer);
  runtime.delete(id);
  entries.delete(id);
  if (openId === id) openId = null;
}

const hasFlag = () => { try { return localStorage.getItem(SESSION_FLAG) === '1'; } catch { return false; } };
const toIso = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); };

export function setEventHandler(fn) {
  emit = fn;
}

/* ---- Lecture ---- */

export const has = id => entries.has(id);
export const get = id => entries.get(id) || null;
export const list = () => [...entries.values()];
export const pending = () => list().filter(e => e.sortants);
export const isSuspended = () => suspended;
export const getOwner = () => owner;

/* ---- Miroir ---- */

function stored(entry, withData) {
  const { distant, horsCopie, ...rest } = entry;
  return withData ? rest : { ...rest, données: null, sortants: false };
}

function byAge(a, b) {
  return String(a.e.dernièreOuverture || '').localeCompare(String(b.e.dernièreOuverture || ''));
}

function writeMirror(parts, dropped) {
  const tableaux = parts.map(p => (dropped.has(p.e.id) ? p.light : p.full));
  localStorage.setItem(MIRROR_KEY, `{"version":${VERSION},"owner":${JSON.stringify(owner)},"tableaux":[${tableaux.join(',')}]}`);
}

function applyDrops(parts, dropped) {
  for (const { e } of parts) {
    const out = dropped.has(e.id);
    if (out && !e.sortants && e.données) { e.nbÉléments = e.données.items?.length ?? 0; e.données = null; }
    const announceIt = out && !e.horsCopie && (e.tooBig || e.sortants || e.id === openId);
    e.horsCopie = out;
    delete e.tooBig;
    if (announceIt) emit({ type: 'mirror-full', entry: e });
  }
}

/*
 * Écrit le miroir sous le plafond, mesuré en occupation réelle de localStorage (2 octets par unité UTF-16).
 * Ordre d'éviction : ce qui ne tiendra jamais, puis le moins récent sans sortants, et en dernier recours
 * un tableau avec sortants, qui reste alors en mémoire jusqu'à son envoi au serveur.
 */
function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  if (!hasFlag() && !suspended) return false;

  const parts = list().map(e => ({ e, full: JSON.stringify(stored(e, true)), light: JSON.stringify(stored(e, false)) }));
  const weight = text => text.length * 2;
  const shell = weight(`{"version":${VERSION},"owner":${JSON.stringify(owner)},"tableaux":[]}`);
  let total = shell + parts.reduce((sum, p) => sum + weight(p.full) + 2, 0);
  const dropped = new Set();
  const drop = p => {
    if (dropped.has(p.e.id) || !p.e.données) return;
    dropped.add(p.e.id);
    total -= weight(p.full) - weight(p.light);
  };

  for (const p of parts) {
    if (shell + weight(p.full) > MIRROR_MAX_BYTES) { p.e.tooBig = true; drop(p); }
  }
  const order = [...parts.filter(p => !p.e.sortants).sort(byAge), ...parts.filter(p => p.e.sortants).sort(byAge)];
  for (const p of order) {
    if (total <= MIRROR_MAX_BYTES) break;
    drop(p);
  }

  for (const p of [null, ...order]) {
    if (p) drop(p);
    try {
      writeMirror(parts, dropped);
      applyDrops(parts, dropped);
      return true;
    } catch (err) {
      console.warn('Miroir : écriture impossible', err);
    }
  }
  try { localStorage.removeItem(MIRROR_KEY); } catch { /* rien à libérer */ }
  applyDrops(parts, dropped);
  return false;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(persistNow, PERSIST_DELAY);
}

/* Appelé quand les tableaux locaux manquent de place : vide les données du miroir sans sortants. */
export function release() {
  let freed = false;
  for (const e of entries.values()) {
    if (e.données && !e.sortants && e.id !== openId) {
      e.nbÉléments = e.données.items?.length ?? 0;
      e.données = null;
      freed = true;
    }
  }
  if (freed) persistNow();
  return freed;
}

function readMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.tableaux)) return { owner: null, tableaux: [] };
    return parsed;
  } catch (err) {
    console.warn('Miroir illisible, ignoré :', err);
    return { owner: null, tableaux: [] };
  }
}

function adopt(raw) {
  return { ...raw, distant: true, icon: normalizeBoardIcon(raw.icon), espaceId: raw.espaceId || null, favori: !!raw.favori, sortants: !!raw.sortants };
}

/* Un autre onglet a réécrit le miroir : on reprend ce qu'il sait de plus récent, sauf nos écritures en attente. */
function onStorage(event) {
  if (event.key !== MIRROR_KEY || !event.newValue) return;
  let parsed;
  try { parsed = JSON.parse(event.newValue); } catch { return; }
  if (!Array.isArray(parsed.tableaux)) return;
  for (const raw of parsed.tableaux) {
    const mine = entries.get(raw.id);
    if (!mine) { entries.set(raw.id, adopt(raw)); continue; }
    if (mine.sortants || raw.id === openId || (raw.rev ?? 0) < (mine.rev ?? 0) || !raw.données) continue;
    entries.set(raw.id, { ...adopt(raw), favori: mine.favori, espaceId: mine.espaceId });
  }
}

function onLeave() {
  persistNow();
  flushAll({ keepalive: true });
}

export function init() {
  const saved = readMirror();
  owner = saved.owner || null;
  entries.clear();
  for (const raw of saved.tableaux) if (raw?.id) entries.set(raw.id, adopt(raw));
  suspended = false;
  if (listening) return;
  listening = true;
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', syncPending);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onLeave(); });
}

/*
 * Le miroir retrouvé peut appartenir à un autre compte (session expirée, autre personne connectée) :
 * ses modifications jamais envoyées deviennent des tableaux locaux, le reste est effacé.
 */
export function setOwner(user) {
  if (owner?.id && user?.id && owner.id !== user.id) {
    for (const e of list()) {
      if (e.sortants && e.données) saveLocalCopy(e, `${e.nom} (non envoyé)`);
      forget(e.id);
    }
  }
  owner = user;
  schedulePersist();
}

export function suspend() {
  suspended = true;
  for (const e of list()) if (!e.sortants && e.id !== openId) forget(e.id);
  for (const rt of runtime.values()) clearTimeout(rt.timer);
  persistNow();
}

export function resume() {
  suspended = false;
}

export function purge() {
  for (const id of [...entries.keys()]) forget(id);
  clearTimeout(persistTimer);
  persistTimer = null;
  owner = null;
  try { localStorage.removeItem(MIRROR_KEY); } catch { /* déjà absent */ }
}

/* ---- Données serveur vers entrée ---- */

function dataOf(board) {
  const { id, icon, rev, createdAt, updatedAt, ...data } = board;
  return data;
}

function applyServer(res, keep = {}) {
  const b = res.board;
  const previous = entries.get(b.id);
  const entry = previous || { distant: true, id: b.id, favori: false, espaceId: null, memberCount: 1 };
  Object.assign(entry, keep, {
    nom: b.name, icon: normalizeBoardIcon(b.icon), rev: res.rev, role: res.role,
    créé: toIso(b.createdAt), majLe: b.updatedAt, données: dataOf(b), sortants: false, perdu: false
  });
  entry.dernièreOuverture ||= toIso(b.updatedAt);
  entries.set(b.id, entry);
  runtimeOf(b.id).lastJson = null;
  return entry;
}

export async function refreshList() {
  const { boards: rows } = await api.listBoards();
  const seen = new Set();
  for (const row of rows) {
    seen.add(row.id);
    const e = entries.get(row.id);
    if (e) {
      Object.assign(e, { nom: row.name, icon: normalizeBoardIcon(row.icon), role: row.role, memberCount: row.memberCount, majLe: row.updatedAt, perdu: false });
      if (e.données) e.données.name = row.name;
    } else {
      entries.set(row.id, {
        distant: true, id: row.id, nom: row.name, icon: normalizeBoardIcon(row.icon), rev: row.rev, role: row.role, memberCount: row.memberCount,
        créé: toIso(row.createdAt), majLe: row.updatedAt, dernièreOuverture: toIso(row.updatedAt), favori: false, espaceId: null, données: null, sortants: false
      });
    }
  }
  for (const e of list()) {
    if (seen.has(e.id)) continue;
    // Disparu du compte : sans données à sauver, il sort simplement de la liste.
    if (e.sortants && e.données) { if (!e.perdu) { e.perdu = true; emit({ type: 'lost', entry: e }); } }
    else forget(e.id);
  }
  schedulePersist();
  return rows;
}

/* ---- Écriture différée ---- */

function scheduleWrite(id, delay) {
  const rt = runtimeOf(id);
  clearTimeout(rt.timer);
  if (suspended) return;
  rt.timer = setTimeout(() => { rt.timer = null; write(id); }, delay);
}

function sameData(id, json) {
  return runtimeOf(id).lastJson === json;
}

/* Référence posée après chargement : la normalisation d'state.loadBoard n'est pas une modification. */
export function setBaseline(id, snapshot) {
  runtimeOf(id).lastJson = JSON.stringify(snapshot);
  openId = id;
}

export function leave(id) {
  if (openId === id) openId = null;
}

export function edit(id, snapshot) {
  const e = entries.get(id);
  if (!e) return;
  const json = JSON.stringify(snapshot);
  if (sameData(id, json)) return; // sélection, zoom : rien à enregistrer
  const rt = runtimeOf(id);
  rt.lastJson = json;
  if (e.role === 'viewer') {
    if (!rt.viewerWarned) { rt.viewerWarned = true; emit({ type: 'read-only', entry: e }); }
    return;
  }
  e.données = snapshot;
  e.nbÉléments = snapshot.items?.length ?? 0;
  e.sortants = true;
  e.dernièreOuverture = new Date().toISOString();
  rt.blocked = false;
  schedulePersist();
  const now = Date.now();
  if (!rt.timer || !rt.firstEdit) rt.firstEdit = now;
  scheduleWrite(id, Math.min(WRITE_DELAY, Math.max(0, rt.firstEdit + WRITE_MAX_WAIT - now)));
}

function retryLater(id, err) {
  const rt = runtimeOf(id);
  rt.retry = Math.min(RETRY_MAX, rt.retry ? rt.retry * 2 : RETRY_MIN);
  const jitter = Math.random() * 500;
  scheduleWrite(id, err.retryAfter ? err.retryAfter * 1000 : rt.retry + jitter);
}

function write(id, options = {}) {
  const e = entries.get(id);
  const rt = runtimeOf(id);
  if (rt.inflight) return rt.inflight;
  if (!e?.sortants || !e.données || e.perdu || rt.blocked || suspended) return Promise.resolve();
  clearTimeout(rt.timer);
  rt.timer = null;
  rt.firstEdit = 0;
  const sent = e.données;
  rt.inflight = api.putBoardData(id, e.rev, sent, options).then(res => {
    e.rev = res.rev;
    e.majLe = res.updatedAt;
    rt.retry = 0;
    // Une édition arrivée pendant l'envoi garde ses sortants : son délai court déjà.
    if (e.données === sent) e.sortants = false;
    else if (!rt.timer) scheduleWrite(id, WRITE_DELAY);
    schedulePersist();
  }).catch(err => {
    if (err.name !== 'ApiError') throw err;
    return onWriteError(e, err);
  }).finally(() => { rt.inflight = null; });
  return rt.inflight;
}

async function onWriteError(e, err) {
  const rt = runtimeOf(e.id);
  if (err.code === 'conflict') { await onConflict(e); return; }
  if (err.status === 401) return; // déjà traité : session suspendue, sortants conservés
  if (err.status === 404) {
    e.perdu = true;
    schedulePersist();
    emit({ type: 'lost', entry: e });
    return;
  }
  if (err.unreachable) { retryLater(e.id, err); schedulePersist(); return; }
  // Refus définitif (validation, droits, taille) : pas de nouvel essai avant la prochaine modification.
  rt.blocked = true;
  schedulePersist();
  emit({ type: 'rejected', entry: e, error: err });
}

function conflictName(nom, date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${nom} (conflit du ${dd}/${mm})`;
}

function saveLocalCopy(entry, nom) {
  const copy = boards.create(nom, entry.données);
  if (boards.isSaveFailing()) { boards.remove(copy.id); return null; }
  boards.setIcon(copy.id, entry.icon);
  return copy;
}

/*
 * Conflit : aucune fusion. Le travail non envoyé part dans une copie, sur l'appareil tant qu'il y a la place,
 * sinon sur le compte. La version du serveur redevient celle du tableau.
 */
async function onConflict(e) {
  const nom = conflictName(e.nom);
  let copy = saveLocalCopy(e, nom);
  if (!copy) {
    try {
      copy = applyServer(await api.createBoard({ name: nom, icon: e.icon, data: e.données }));
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      // Nulle part où mettre la copie : le travail reste dans le miroir et rien n'est écrasé.
      runtimeOf(e.id).blocked = true;
      schedulePersist();
      emit({ type: 'rejected', entry: e, error: err });
      return;
    }
  }
  e.sortants = false;
  e.données = null;
  let fresh = false;
  try {
    applyServer(await api.getBoard(e.id));
    fresh = true;
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
  }
  schedulePersist();
  emit({ type: 'conflict', entry: e, copy, fresh });
}

export async function flush(id) {
  const rt = runtimeOf(id);
  clearTimeout(rt.timer);
  rt.timer = null;
  if (rt.inflight) await rt.inflight;
  await write(id);
  persistNow();
}

export function flushAll(options = {}) {
  return Promise.all(pending().map(e => write(e.id, options)));
}

/* Reprise au démarrage, à la connexion, au retour du réseau : chaque tableau en attente repart. */
export function syncPending() {
  if (suspended) return;
  for (const e of pending()) {
    const rt = runtimeOf(e.id);
    if (!rt.inflight && !rt.blocked) { rt.retry = 0; write(e.id); }
  }
}

/* ---- Ouverture ---- */

/*
 * Résultat : { status: 'ok', entry, offline } ou { status: 'lost', entry }, 'expired', 'error'.
 * Jamais de données inventées : sans état valide, l'appelant affiche une erreur et n'écrit rien.
 */
export async function open(id) {
  if (entries.has(id)) await flush(id);
  const e = entries.get(id);
  let res;
  try {
    res = await api.getBoard(id);
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
    if (err.status === 404) {
      if (e?.données) {
        e.perdu = true;
        schedulePersist();
        return { status: 'lost', entry: e };
      }
      forget(id);
      return { status: 'lost', entry: null };
    }
    if (err.status === 401) return { status: 'expired', entry: e?.données ? e : null };
    if (err.unreachable && e?.données) return { status: 'ok', entry: e, offline: true, error: err };
    return { status: 'error', error: err };
  }
  if (e?.sortants && e.données) {
    if (res.rev !== e.rev) {
      await onConflict(e);
      if (entries.get(id)?.données) return { status: 'ok', entry: entries.get(id) };
    } else {
      Object.assign(e, { role: res.role, nom: res.board.name, icon: normalizeBoardIcon(res.board.icon), perdu: false });
      return { status: 'ok', entry: e };
    }
  }
  const entry = applyServer(res);
  schedulePersist();
  return { status: 'ok', entry };
}

export async function ensureData(id) {
  const e = entries.get(id);
  if (e?.données) return e;
  const res = await api.getBoard(id);
  const entry = applyServer(res);
  schedulePersist();
  return entry;
}

/* ---- Actions du tableau de bord ---- */

export function touch(id) {
  const e = entries.get(id);
  if (!e) return;
  e.dernièreOuverture = new Date().toISOString();
  schedulePersist();
}

export function toggleFavori(id) {
  const e = entries.get(id);
  if (!e) return false;
  e.favori = !e.favori;
  schedulePersist();
  return e.favori;
}

export function setSpace(id, espaceId) {
  const e = entries.get(id);
  if (!e) return;
  e.espaceId = espaceId;
  schedulePersist();
}

export function clearSpace(espaceId) {
  for (const e of entries.values()) if (e.espaceId === espaceId) e.espaceId = null;
  schedulePersist();
}

export async function rename(id, nom) {
  const row = await api.patchBoard(id, { name: nom });
  const e = entries.get(id);
  if (e) {
    e.nom = row.name;
    if (e.données) e.données.name = row.name;
    schedulePersist();
  }
  return e;
}

export async function setIcon(id, icon) {
  const row = await api.patchBoard(id, { icon });
  const e = entries.get(id);
  if (e) { e.icon = normalizeBoardIcon(row.icon); schedulePersist(); }
  return e;
}

export async function remove(id) {
  await api.deleteBoard(id);
  forget(id);
  persistNow();
}

/*
 * « Enregistrer sur mon compte » : l'entrée locale n'est retirée qu'après le 201 et l'écriture du miroir.
 * Si le tableau n'entre pas dans le miroir, l'entrée locale reste : aucune copie n'est perdue.
 */
export async function upload(local) {
  const res = await api.createBoard({ name: local.nom, icon: normalizeBoardIcon(local.icon), data: local.données || { name: local.nom, items: [] } });
  const entry = applyServer(res, { favori: !!local.favori, espaceId: local.espaceId || null, dernièreOuverture: local.dernièreOuverture || new Date().toISOString(), nbÉléments: res.board.items.length });
  const written = persistNow();
  const mirrored = written && !!entry.données && !entry.horsCopie;
  if (mirrored) boards.remove(local.id);
  return { entry, mirrored };
}

/* « Garder une copie locale » : copie ordinaire sur l'appareil. Le tableau du compte n'est pas touché, sauf accès perdu. */
export async function keepLocalCopy(id) {
  const e = await ensureData(id);
  const lost = e.perdu;
  const copy = saveLocalCopy(e, lost ? e.nom : `${e.nom} (copie locale)`);
  if (!copy) return null;
  if (lost) { forget(id); persistNow(); }
  return copy;
}
