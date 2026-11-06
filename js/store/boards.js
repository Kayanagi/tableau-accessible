/*
 * Accès aux tableaux du compte (miroir distant, voir store/remote-boards.js) et aux espaces de l'appareil.
 * Le stockage local historique n'est plus affiché ni modifiable : il ne sert plus que de réserve à importer
 * (voir store/local-import.js), et de refuge au travail non envoyé d'un compte qui quitte l'appareil.
 */
import { BOARD_ICONS, normalizeBoardIcon } from '../ui/icons.js';

const STORAGE_KEY = 'tableau-accessible-boards';
const OLD_STORAGE_KEY = 'tableau-accessible-board';
const CURRENT_VERSION = 4;

let data = { version: CURRENT_VERSION, tableaux: [], espaces: [] };
const listeners = new Set();
const saveListeners = new Set();
let saveFailed = false;
let viewerId = null;
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

/* Le compte qui regarde : les espaces créés par un autre compte sur cet appareil ne lui sont pas montrés. */
export function setViewer(id) {
  viewerId = id || null;
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

export function toggleFavori(id) {
  return remote?.toggleFavori(id) ?? false;
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

export function removeFromReserve(id) {
  reloadReserve();
  data.tableaux = data.tableaux.filter(b => b.id !== id);
  save();
  notify();
}

/* ---- Espaces ---- */

export { BOARD_ICONS };
export function getSpaces() {
  return data.espaces.filter(s => !s.owner || s.owner === viewerId);
}
export function createSpace(nom) {
  reloadReserve();
  const space = { id: generateId().replace('board-', 'space-'), nom, owner: viewerId };
  data.espaces.push(space); save(); notify(); return space;
}
export function renameSpace(id, nom) {
  reloadReserve();
  const space = data.espaces.find(s => s.id === id);
  if (space) { space.nom = nom; save(); notify(); }
}
export function removeSpace(id) {
  reloadReserve();
  data.espaces = data.espaces.filter(s => s.id !== id);
  remote?.clearSpace(id);
  save(); notify();
}
export function moveToSpace(id, espaceId) {
  if (get(id) && (!espaceId || getSpaces().some(s => s.id === espaceId))) {
    remote.setSpace(id, espaceId || null);
    notify();
  }
}
