/*
 * Tableaux du compte : miroir local, écriture différée vers le serveur, conflits.
 * Le miroir a sa propre clé, plafonnée : il ne peut pas remplir le quota de l'appareil à lui seul.
 */
import * as api from '../sync/api.js';
import * as boards from './boards.js';
import * as local from './account-local.js';
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
let mayReplaceOwner = false;
let listSeq = 0;
let emit = () => {};
const removed = new Set();
const entries = new Map();
const runtime = new Map();

function runtimeOf(id) {
  let rt = runtime.get(id);
  if (!rt) { rt = { timer: null, firstEdit: 0, inflight: null, lastJson: null, sent: null, retry: 0, warned: false, blocked: false, addedAt: 0 }; runtime.set(id, rt); }
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
/* Favori et espace sont rangés au compte (store/account-local.js), pas dans le miroir. */
const decorate = e => {
  if (!e) return null;
  e.favori = local.isFavori(e.id);
  e.espaceId = local.spaceOf(e.id);
  return e;
};
export const get = id => decorate(entries.get(id));
/* Une entrée marquée perduPour est le travail d'un autre compte, gardé en attendant de la place : elle n'est jamais montrée. */
const allEntries = () => [...entries.values()];
export const list = () => allEntries().filter(e => !e.perduPour).map(decorate);
export const pending = () => list().filter(e => e.sortants);
export const isSuspended = () => suspended;
export const getOwner = () => owner;

/* ---- Miroir ---- */

function stored(entry, withData) {
  const { distant, horsCopie, favori, espaceId, ...rest } = entry;
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

/* Le miroir sur le disque appartient-il à un autre compte que celui de cet onglet ? */
function isForeign(disk) {
  return !mayReplaceOwner && !!disk.owner?.id && !!owner?.id && disk.owner.id !== owner.id;
}

/* Une version écrite par un autre onglet, plus avancée que la nôtre, ne doit pas être écrasée à notre sortie. */
function otherTabIsAhead(e, seen) {
  if (!seen || e.sortants) return false;
  return (seen.rev ?? 0) > (e.rev ?? 0) || (seen.rev === e.rev && !!seen.sortants);
}

/*
 * Écrit le miroir sous le plafond, mesuré en occupation réelle de localStorage (2 octets par unité UTF-16).
 * Seul un tableau sans sortants peut être évincé : d'abord celui qui ne tiendra jamais, puis le moins récent.
 * Un tableau avec sortants qui ne tient pas garde ses données en mémoire et le disque garde sa dernière version
 * durable : l'interface le dit (mirror-full) et la fermeture de l'onglet est signalée (beforeunload).
 */
function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  if (!hasFlag() && !suspended) return false;

  const disk = readMirror();
  if (isForeign(disk)) {
    // Un autre compte a pris l'appareil : ses données ne sont pas à nous, ne rien y réécrire.
    if (!suspended) emit({ type: 'foreign-owner' });
    for (const e of pending()) e.horsCopie = true;
    return false;
  }
  // Suspendu : la session est finie, seul le travail non envoyé a sa place sur le disque.
  const source = suspended ? allEntries().filter(e => e.sortants) : allEntries();
  if (suspended && !source.length) return false;

  const prior = new Map(disk.tableaux.filter(t => t?.id).map(t => [t.id, t]));
  const weight = text => text.length * 2;
  const shell = weight(`{"version":${VERSION},"owner":${JSON.stringify(owner)},"tableaux":[]}`);
  const parts = source.map(e => {
    const seen = prior.get(e.id);
    if (otherTabIsAhead(e, seen)) {
      const full = JSON.stringify(seen);
      return { e, full, light: full, frozen: true };
    }
    const full = JSON.stringify(stored(e, true));
    // Ne tient pas : pour un tableau avec sortants, la version durable précédente vaut mieux que rien.
    const light = JSON.stringify(e.sortants && seen?.sortants && seen.données ? seen : stored(e, false));
    return { e, full, light, frozen: false };
  });
  let total = shell + parts.reduce((sum, p) => sum + weight(p.full) + 2, 0);
  const dropped = new Set();
  const drop = p => {
    if (dropped.has(p.e.id) || !p.e.données || p.frozen) return;
    dropped.add(p.e.id);
    total -= weight(p.full) - weight(p.light);
  };

  for (const p of parts) {
    if (shell + weight(p.full) > MIRROR_MAX_BYTES) { p.e.tooBig = true; drop(p); }
  }
  const evictable = parts.filter(p => !p.e.sortants).sort(byAge);
  const unsent = parts.filter(p => p.e.sortants).sort(byAge);
  for (const p of [...evictable, ...unsent]) {
    if (total <= MIRROR_MAX_BYTES) break;
    drop(p);
  }

  const attempt = () => {
    try { writeMirror(parts, dropped); return true; }
    catch (err) { console.warn('Miroir : écriture impossible', err); return false; }
  };
  let written = attempt();
  for (const p of evictable) {
    if (written) break;
    if (dropped.has(p.e.id) || !p.e.données || p.frozen) continue;
    drop(p);
    written = attempt();
  }
  if (!written) {
    // Le disque garde sa dernière version : mieux vaut une version ancienne que des sortants effacés.
    unsent.forEach(p => dropped.add(p.e.id));
    if (!unsent.length && !disk.tableaux.some(t => t?.sortants)) {
      try { localStorage.removeItem(MIRROR_KEY); } catch { /* rien à libérer */ }
    }
  }
  if (written) mayReplaceOwner = false;
  applyDrops(parts, dropped);
  return written;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(persistNow, PERSIST_DELAY);
}

/* Appelé quand la réserve de l'appareil manque de place : vide les données du miroir sans sortants. */
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

/* Miroir d'une version précédente : ses favoris et espaces rejoignent le compte qui l'a écrit. */
function adoptOrganisation(saved) {
  if (!saved.owner?.id) return;
  const favoris = [], placement = {};
  for (const t of saved.tableaux) {
    if (!t?.id) continue;
    if (t.favori) favoris.push(t.id);
    if (t.espaceId) placement[t.id] = t.espaceId;
  }
  local.adopt(saved.owner.id, { favoris, placement });
}

/*
 * Un autre onglet a réécrit le miroir : on reprend ce que le serveur a confirmé, jamais ses sortants,
 * qui restent à l'onglet qui les a écrits : les envoyer d'ici produirait de faux conflits.
 */
function onStorage(event) {
  if (event.key !== MIRROR_KEY || !event.newValue) return;
  let parsed;
  try { parsed = JSON.parse(event.newValue); } catch { return; }
  if (!Array.isArray(parsed.tableaux)) return;
  if (isForeign(parsed)) {
    if (!suspended) emit({ type: 'foreign-owner' });
    return;
  }
  if (suspended) return;
  for (const raw of parsed.tableaux) {
    if (!raw?.id || removed.has(raw.id)) continue;
    const confirmed = raw.sortants ? { ...raw, données: null, sortants: false } : raw;
    const mine = entries.get(raw.id);
    if (!mine) { entries.set(raw.id, adopt(confirmed)); continue; }
    if (mine.sortants || raw.id === openId || (raw.rev ?? 0) < (mine.rev ?? 0) || !confirmed.données) continue;
    entries.set(raw.id, { ...adopt(confirmed), favori: mine.favori, espaceId: mine.espaceId });
  }
}

function saveForeignWork() {
  if (!isForeign(readMirror())) return;
  for (const e of pending()) {
    if (e.données && saveOnDevice(e, `${e.nom} (non envoyé)`, owner?.id)) e.sortants = false;
  }
}

function onLeave() {
  persistNow();
  saveForeignWork();
  flushAll({ keepalive: true });
}

/* Ce qui n'est ni sur le disque ni encore sur le serveur disparaîtrait avec l'onglet. */
function onBeforeUnload(event) {
  persistNow();
  saveForeignWork();
  if (!pending().some(e => e.horsCopie)) return;
  event.preventDefault();
  event.returnValue = '';
}

export function init() {
  const saved = readMirror();
  owner = saved.owner || null;
  adoptOrganisation(saved);
  entries.clear();
  for (const raw of saved.tableaux) if (raw?.id) entries.set(raw.id, adopt(raw));
  suspended = false;
  if (listening) return;
  listening = true;
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', syncPending);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onLeave(); });
}

/*
 * Le miroir retrouvé peut appartenir à un autre compte (session expirée, autre personne connectée) :
 * ses modifications jamais envoyées partent dans la réserve de l'appareil, réservées à ce compte, qui se les
 * verra proposer à sa prochaine connexion. Le reste est effacé.
 */
export function setOwner(user) {
  if (owner?.id && user?.id && owner.id !== user.id) {
    for (const e of list()) {
      if (e.id === openId) emit({ type: 'owner-changed', id: e.id });
      if (e.sortants && e.données && !saveOnDevice(e, `${e.nom} (non envoyé)`, owner.id)) {
        // Stockage plein : le travail reste dans le miroir, invisible pour ce compte, jusqu'à ce qu'il y ait de la place.
        e.perdu = true;
        e.perduPour = owner.id;
        emit({ type: 'copy-failed', entry: e });
        continue;
      }
      forget(e.id);
    }
    mayReplaceOwner = true;
  }
  owner = user;
  retryForeignWork();
  schedulePersist();
}

function retryForeignWork() {
  for (const e of allEntries()) {
    if (e.perduPour && e.données && saveOnDevice(e, `${e.nom} (non envoyé)`, e.perduPour)) forget(e.id);
  }
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
  // Réponse tardive d'une requête abandonnée : elle ne fait jamais reculer la révision.
  if (previous && res.rev < previous.rev) return previous;
  if (!previous) runtimeOf(b.id).addedAt = Date.now();
  const entry = previous || { distant: true, id: b.id, favori: false, espaceId: null, memberCount: 1 };
  Object.assign(entry, keep, {
    nom: b.name, icon: normalizeBoardIcon(b.icon), rev: res.rev, role: res.role,
    créé: toIso(b.createdAt), majLe: b.updatedAt, données: dataOf(b), sortants: false, perdu: false
  });
  entry.dernièreOuverture ||= toIso(b.updatedAt);
  entries.set(b.id, entry);
  // Le tableau ouvert garde sa référence : l'état affiché ne vient pas de cette réponse.
  if (b.id !== openId) runtimeOf(b.id).lastJson = null;
  return entry;
}

export async function refreshList() {
  const seq = ++listSeq;
  const startedAt = Date.now();
  const { boards: rows } = await api.listBoards();
  if (seq !== listSeq) return rows; // une liste plus récente est déjà demandée
  const seen = new Set();
  for (const row of rows) {
    seen.add(row.id);
    if (removed.has(row.id)) continue;
    const e = entries.get(row.id);
    if (e) {
      const demoted = e.role !== 'viewer' && row.role === 'viewer';
      Object.assign(e, { nom: row.name, icon: normalizeBoardIcon(row.icon), role: row.role, memberCount: row.memberCount, ownerName: row.ownerName, majLe: row.updatedAt, perdu: false });
      if (demoted) emit({ type: 'role-lost', entry: e });
      if (e.données) e.données.name = row.name;
      // Modifié ailleurs : la copie est périmée. Le tableau ouvert le découvrira à son prochain envoi.
      if (!e.sortants && e.id !== openId && row.rev > (e.rev ?? 0)) {
        if (e.données) e.nbÉléments = e.données.items?.length ?? 0;
        e.données = null;
        e.rev = row.rev;
      }
    } else {
      entries.set(row.id, {
        distant: true, id: row.id, nom: row.name, icon: normalizeBoardIcon(row.icon), rev: row.rev, role: row.role, memberCount: row.memberCount, ownerName: row.ownerName,
        créé: toIso(row.createdAt), majLe: row.updatedAt, dernièreOuverture: toIso(row.updatedAt), favori: false, espaceId: null, données: null, sortants: false
      });
    }
  }
  for (const e of list()) {
    if (seen.has(e.id)) continue;
    // Créé après le départ de la requête : la liste est simplement en retard.
    if (runtimeOf(e.id).addedAt >= startedAt) continue;
    // Disparu du compte : sans données à sauver et s'il n'est pas ouvert, il sort simplement de la liste.
    if ((e.sortants && e.données) || e.id === openId) {
      if (!e.perdu) { e.perdu = true; emit({ type: 'lost', entry: e }); }
    } else forget(e.id);
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

/* Un seul message tant que l'échec dure : le serveur a répondu, mais la modification n'est pas enregistrée. */
function warnOnce(e, err) {
  const rt = runtimeOf(e.id);
  if (rt.warned || !err.fromServer) return;
  rt.warned = true;
  emit({ type: 'retrying', entry: e, error: err });
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
  // Rôle viewer : jamais de PUT. Le travail d'avant le retrait du droit reste ici, pour la copie (keepCopy).
  if (!e?.sortants || !e.données || e.perdu || e.role === 'viewer' || rt.blocked || suspended) return Promise.resolve();
  clearTimeout(rt.timer);
  rt.timer = null;
  rt.firstEdit = 0;
  const sent = e.données;
  rt.sent = sent;
  rt.inflight = api.putBoardData(id, e.rev, sent, options).then(res => {
    e.rev = res.rev;
    e.majLe = res.updatedAt;
    rt.retry = 0;
    settled(e);
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

function settled(e) {
  const rt = runtimeOf(e.id);
  rt.warned = false;
  rt.blocked = false;
  emit({ type: 'sent', entry: e });
}

async function onWriteError(e, err) {
  const rt = runtimeOf(e.id);
  if (err.code === 'conflict') { await onConflict(e); return; }
  if (err.code === 'unauthenticated') return; // déjà traité : session suspendue, sortants conservés
  if (err.notFound) { markLost(e); return; }
  if (err.unreachable) { retryLater(e.id, err); warnOnce(e, err); schedulePersist(); return; }
  // Le propriétaire vient de retirer le droit d'écrire : le travail non envoyé reste ici, l'interface passe en lecture seule.
  if (err.code === 'forbidden') {
    e.role = 'viewer';
    schedulePersist();
    emit({ type: 'role-lost', entry: e });
    return;
  }
  // Refus définitif (validation, droits, taille) : pas de nouvel essai avant la prochaine modification.
  rt.blocked = true;
  schedulePersist();
  emit({ type: 'rejected', entry: e, error: err });
}

function markLost(e) {
  e.perdu = true;
  schedulePersist();
  emit({ type: 'lost', entry: e });
}

function conflictName(nom, date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${nom} (conflit du ${dd}/${mm})`;
}

function saveOnDevice(entry, nom, reservedFor) {
  return boards.addToReserve(nom, entry.données, { icon: entry.icon, reservedFor });
}

function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedKeys(value[key])]));
}

/* Contenu comparable d'un tableau, indépendant de l'ordre des clés. Le nom suit PATCH, il n'en fait pas partie. */
function contentOf(data) {
  if (!data) return null;
  return JSON.stringify(sortedKeys({ items: data.items ?? [], tags: data.tags ?? [], frameOrder: data.frameOrder ?? [], background: data.background ?? null }));
}

/*
 * Conflit : aucune fusion, mais d'abord vérifier qu'il y en a un. Un PUT accepté dont la réponse n'a pas été lue
 * (rechargement juste après une modification) revient en 409 alors que le serveur a déjà ce contenu.
 * Sinon le travail non envoyé part dans une copie sur le compte, et la version du serveur redevient celle du tableau.
 * Rien ne s'intercale entre la dernière copie et ce remplacement.
 */
async function onConflict(e, known = null) {
  const rt = runtimeOf(e.id);
  let res = known;
  if (!res) {
    try {
      res = await api.getBoard(e.id);
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      if (err.notFound) markLost(e);
      else if (err.code !== 'unauthenticated') { retryLater(e.id, err); warnOnce(e, err); schedulePersist(); }
      return;
    }
  }

  const onServer = contentOf(dataOf(res.board));
  const sameAsCurrent = onServer === contentOf(e.données);
  if (sameAsCurrent || onServer === contentOf(rt.sent)) {
    e.rev = res.rev;
    e.majLe = res.board.updatedAt;
    if (sameAsCurrent) e.sortants = false;
    else scheduleWrite(e.id, WRITE_DELAY);
    settled(e);
    schedulePersist();
    return;
  }

  emit({ type: 'conflict-flush', entry: e });
  const nom = conflictName(e.nom);
  let copy = null;
  while (!copy) {
    const snapshot = e.données;
    let created;
    try {
      created = applyServer(await api.createBoard({ name: nom, icon: e.icon, data: snapshot }));
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      if (err.code === 'unauthenticated') return;
      // Nulle part où mettre la copie : le travail reste dans le miroir et rien n'est écrasé.
      if (err.unreachable) {
        retryLater(e.id, err);
        warnOnce(e, err);
      } else {
        rt.blocked = true;
        emit({ type: 'rejected', entry: e, error: err });
      }
      schedulePersist();
      return;
    }
    // Modifié pendant l'envoi : cette copie est incomplète, une seconde reprend tout.
    if (e.données === snapshot) copy = created;
  }
  e.sortants = false;
  clearTimeout(rt.timer);
  rt.timer = null;
  rt.warned = false;
  applyServer(res);
  schedulePersist();
  emit({ type: 'conflict', entry: e, copy });
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
    if (err.notFound) {
      if (e?.données) {
        e.perdu = true;
        schedulePersist();
        return { status: 'lost', entry: e };
      }
      forget(id);
      return { status: 'lost', entry: null };
    }
    if (err.code === 'unauthenticated') return { status: 'expired', entry: e?.données ? e : null };
    if (err.unreachable && e?.données) return { status: 'ok', entry: e, offline: true, error: err };
    return { status: 'error', error: err };
  }
  if (e?.sortants && e.données) {
    if (res.role === 'viewer') {
      if (e.role !== 'viewer') { e.role = 'viewer'; emit({ type: 'role-lost', entry: e }); }
      return { status: 'ok', entry: e };
    }
    if (res.rev > e.rev) await onConflict(e, res);
    else Object.assign(e, { role: res.role, nom: res.board.name, icon: normalizeBoardIcon(res.board.icon), perdu: false });
    if (e.données) return { status: 'ok', entry: e };
  }
  const entry = applyServer(res);
  schedulePersist();
  // Réponse plus ancienne que ce qui est connu, et plus de copie : rien de valide à afficher.
  if (!entry.données) return { status: 'error', error: { message: 'La version à jour de ce tableau n’a pas pu être chargée.' } };
  return { status: 'ok', entry };
}

/*
 * Le contenu à dupliquer, exporter ou copier : la version du serveur, ou le travail non envoyé s'il y en a.
 * Serveur injoignable : la copie sert si elle n'est pas connue périmée (refreshList vide celles qui le sont).
 */
export async function ensureData(id) {
  const e = entries.get(id);
  if (e?.données && (e.perdu || e.sortants)) return e;
  let res;
  try {
    res = await api.getBoard(id);
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
    if (err.notFound && e?.données) { e.perdu = true; schedulePersist(); return e; }
    if (err.unreachable && e?.données) return e;
    throw err;
  }
  // Modifié pendant la lecture : le travail en attente passe avant cette réponse.
  if (e?.sortants && e.données) return e;
  const entry = applyServer(res);
  schedulePersist();
  return entry;
}

/* Le tableau ouvert est perdu : son état affiché est la version à sauver. */
export function setData(id, snapshot) {
  const e = entries.get(id);
  if (e) e.données = snapshot;
}

/* ---- Actions du tableau de bord ---- */

export function touch(id) {
  const e = entries.get(id);
  if (!e) return;
  e.dernièreOuverture = new Date().toISOString();
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
  removed.add(id);
  forget(id);
  local.forgetBoard(id);
  persistNow();
}

/* Favori et espace d'un tableau neuf : un espace inconnu du compte est simplement ignoré à l'affichage. */
function organise(id, { favori, espaceId } = {}) {
  if (favori) local.setFavori(id, true);
  if (espaceId) local.setPlacement(id, espaceId);
}

/* Tableau neuf sur le compte, tel qu'à la création, l'import d'un fichier ou la duplication. */
export async function create(nom, données, extra = {}) {
  const data = JSON.parse(JSON.stringify(données || { name: nom, items: [] }));
  data.name = nom;
  const res = await api.createBoard({ name: nom, icon: normalizeBoardIcon(extra.icon), data });
  const entry = applyServer(res, { dernièreOuverture: extra.dernièreOuverture || new Date().toISOString(), nbÉléments: res.board.items.length });
  organise(entry.id, extra);
  persistNow();
  return decorate(entry);
}

/* Un tableau de la réserve envoyé sur le compte. La réserve n'est jamais touchée ici : l'en retirer demande un clic. */
export async function upload(reserved) {
  const res = await api.createBoard({ name: reserved.nom, icon: normalizeBoardIcon(reserved.icon), data: reserved.données || { name: reserved.nom, items: [] } });
  const entry = applyServer(res, { dernièreOuverture: reserved.dernièreOuverture || new Date().toISOString(), nbÉléments: res.board.items.length });
  organise(entry.id, reserved);
  persistNow();
  return { entry: decorate(entry) };
}

/*
 * « Garder une copie » : un nouveau tableau sur le compte, comme pour un conflit.
 * Accès perdu : l'entrée disparaît une fois la copie en sûreté.
 * Droit d'écriture retiré : le travail est dans la copie, la version du serveur reste celle du tableau.
 */
export async function keepCopy(id) {
  const e = await ensureData(id);
  const lost = e.perdu;
  const copy = await create(lost ? e.nom : `${e.nom} (copie)`, e.données, { icon: e.icon, espaceId: e.espaceId });
  if (lost) forget(id);
  else if (e.role === 'viewer') e.sortants = false;
  persistNow();
  return copy;
}

/* Déconnexion avec du travail non envoyé : il attend sur l'appareil, proposé à ce seul compte à sa prochaine connexion. */
export function keepOnDevice(id) {
  const e = entries.get(id);
  if (!e?.données) return null;
  return saveOnDevice(e, `${e.nom} (non envoyé)`, owner?.id);
}

/* Le tableau n'est plus à nous : quitté, ou accès retiré. */
export function drop(id) {
  removed.add(id);
  forget(id);
  local.forgetBoard(id);
  persistNow();
}
