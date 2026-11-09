/*
 * Accès aux tableaux du compte (miroir distant, voir store/remote-boards.js) et à ses espaces (store/account-local.js).
 * Le stockage local historique n'est plus affiché ni modifiable : il ne sert plus que de réserve à importer
 * (voir store/local-import.js), et de refuge au travail non envoyé d'un compte qui quitte l'appareil.
 * Ses espaces sans propriétaire sont proposés à l'import ; ceux qui portent un propriétaire rejoignent ce compte.
 */
import { BOARD_ICONS, normalizeBoardIcon } from '../ui/icons.js';
import * as local from './account-local.js';

const STORAGE_KEY = 'tableau-accessible-boards';
const OLD_STORAGE_KEY = 'tableau-accessible-board';
const CURRENT_VERSION = 4;

let data = { version: CURRENT_VERSION, tableaux: [], espaces: [] };
const listeners = new Set();
const saveListeners = new Set();
let saveFailed = false;
// Tableaux du compte : fourni par store/remote-boards.js une fois le compte chargé.
let remote = null;

function generateId() {
  return 'board-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function write() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* Un autre onglet peut avoir importé ou retiré un tableau : la réserve lue sur le disque fait foi. */
function reloadReserve() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(stored?.tableaux)) data.tableaux = stored.tableaux;
    if (Array.isArray(stored?.espaces)) data.espaces = stored.espaces;
  } catch (e) {
    console.warn('Lecture impossible :', e);
  }
}

function reportSave(error) {
  const failed = !!error;
  if (failed === saveFailed) return;
  saveFailed = failed;
  for (const fn of saveListeners) {
    try { fn(error); } catch (e) { console.error(e); }
  }
}

/* Rend compte de son résultat. La réserve passe avant le miroir, qui cède sa place si besoin. */
function save() {
  try {
    write();
  } catch (e) {
    let retried = false;
    try { retried = !!remote?.release(); if (retried) write(); }
    catch (again) { retried = false; e = again; }
    if (!retried) {
      console.warn('Sauvegarde impossible :', e);
      reportSave(e);
      return false;
    }
  }
  reportSave(null);
  return true;
}

export function isSaveFailing() {
  return saveFailed;
}

/* Appelé à chaque changement d'état : avec l'erreur à l'échec, avec null au rétablissement. */
export function onSaveFailure(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

export function attachRemote(source) {
  remote = source;
}

export function detachRemote() {
  remote = null;
}

export function remoteStore() {
  return remote;
}

/* Le compte qui regarde : ses espaces, favoris et modèles ont leur propre clé (store/account-local.js). */
export function setViewer(id) {
  local.setAccount(id);
  if (id) moveOwnedSpaces();
}

/*
 * Espaces créés avant cette version, déjà marqués à leur compte dans l'espace commun : chacun rejoint la clé de son
 * propriétaire, puis quitte l'espace commun. Ils n'ont jamais été montrés à un autre compte.
 */
function moveOwnedSpaces() {
  reloadReserve();
  const owned = data.espaces.filter(s => s.owner);
  if (!owned.length) return;
  const moved = new Set();
  for (const ownerId of new Set(owned.map(s => s.owner))) {
    const mine = owned.filter(s => s.owner === ownerId);
    if (local.adopt(ownerId, { espaces: mine })) mine.forEach(s => moved.add(s.id));
  }
  data.espaces = data.espaces.filter(s => !moved.has(s.id));
  save();
}

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

export function init() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      data = JSON.parse(raw);
      data.espaces ||= [];
      data.version = CURRENT_VERSION;
      for (const b of data.tableaux) {
        b.icon = normalizeBoardIcon(b.icon || b.emoji);
        delete b.emoji;
        b.espaceId ||= null;
      }
      save();
      return;
    }
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldRaw) {
      const oldBoard = JSON.parse(oldRaw);
      const now = new Date().toISOString();
      data.tableaux.push({
        id: generateId(),
        nom: oldBoard.name || 'Tableau importé',
        icon: 'board',
        créé: now,
        dernièreOuverture: now,
        favori: false,
        données: oldBoard
      });
      save();
    }
  } catch (e) {
    console.warn('Chargement impossible :', e);
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---- Tableaux du compte ---- */

export function getAll() {
  return remote ? remote.list() : [];
}

export function get(id) {
  return remote?.get(id) || null;
}

export async function create(nom, données) {
  const entry = await remote.create(nom, données);
  notify();
  return entry;
}

export function saveData(id, snapshot) {
  remote?.edit(id, snapshot);
}

export async function duplicate(id) {
  const original = get(id);
  if (!original?.données) return null;
  const copy = await remote.create(`${original.nom} (copie)`, original.données, { icon: normalizeBoardIcon(original.icon), espaceId: original.espaceId || null });
  notify();
  return copy;
}

/* Rend le nouvel état ; l'ancien si le stockage est plein. */
export function toggleFavori(id) {
  const on = !local.isFavori(id);
  if (!get(id) || !local.setFavori(id, on)) return !on;
  notify();
  return on;
}

export function getFavoris() {
  return getAll().filter(b => b.favori);
}

export function touchOpened(id) {
  remote?.touch(id);
}

/* ---- Réserve de l'appareil : tableaux historiques et travail à reprendre ---- */

export function reserveBoards() {
  reloadReserve();
  return data.tableaux;
}

/*
 * Rend null si le stockage est plein : l'alerte reste affichée. reservedFor garde ce travail à son compte :
 * une autre personne connectée sur cet appareil ne le verra pas.
 */
export function addToReserve(nom, données, { icon = 'board', reservedFor = null } = {}) {
  reloadReserve();
  const now = new Date().toISOString();
  const board = { id: generateId(), nom, icon: normalizeBoardIcon(icon), espaceId: null, créé: now, dernièreOuverture: now, favori: false, données: JSON.parse(JSON.stringify(données)) };
  board.données.name = nom;
  if (reservedFor) board.réservéÀ = reservedFor;
  data.tableaux.push(board);
  if (save()) return board;
  data.tableaux = data.tableaux.filter(b => b.id !== board.id);
  return null;
}

/* Le travail mis de côté pour un compte supprimé : plus personne ne peut le reprendre. */
export function removeReservedFor(userId) {
  reloadReserve();
  const before = data.tableaux.length;
  data.tableaux = data.tableaux.filter(b => b.réservéÀ !== userId);
  if (data.tableaux.length !== before) { save(); notify(); }
}

export function removeFromReserve(id) {
  reloadReserve();
  data.tableaux = data.tableaux.filter(b => b.id !== id);
  save();
  notify();
}

/* ---- Espaces : ceux du compte connecté ---- */

export { BOARD_ICONS };
export function getSpaces() {
  return local.spaces();
}

/* Rend l'espace créé, ou null si le stockage de l'appareil est plein. */
export function createSpace(nom) {
  try {
    const space = local.createSpace(nom);
    notify();
    return space;
  } catch (e) {
    console.warn('Espace non créé :', e);
    return null;
  }
}

function spaceChange(fn) {
  try {
    fn();
    notify();
    return true;
  } catch (e) {
    console.warn('Espace non modifié :', e);
    return false;
  }
}

export function renameSpace(id, nom) {
  return spaceChange(() => local.renameSpace(id, nom));
}

export function removeSpace(id) {
  return spaceChange(() => local.removeSpace(id));
}

export function moveToSpace(id, espaceId) {
  if (!get(id) || (espaceId && !getSpaces().some(s => s.id === espaceId))) return false;
  const ok = local.setPlacement(id, espaceId || null);
  notify();
  return ok;
}

/* ---- Espaces d'avant les comptes, communs à l'appareil ---- */

export function legacySpaces() {
  reloadReserve();
  return data.espaces.filter(s => !s.owner);
}

export function removeLegacySpaces(ids) {
  reloadReserve();
  data.espaces = data.espaces.filter(s => s.owner || !ids.includes(s.id));
  save();
}
