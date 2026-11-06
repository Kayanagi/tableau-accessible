import { BOARD_ICONS, normalizeBoardIcon } from '../ui/icons.js';

const STORAGE_KEY = 'tableau-accessible-boards';
const OLD_STORAGE_KEY = 'tableau-accessible-board';
const CURRENT_VERSION = 4;

let data = { version: CURRENT_VERSION, tableaux: [], espaces: [] };
const listeners = new Set();
const saveListeners = new Set();
let saveFailed = false;
// Tableaux du compte : fourni par store/remote-boards.js, chargé seulement s'il y a un compte.
let remote = null;

function generateId() {
  return 'board-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function write() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function reportSave(error) {
  const failed = !!error;
  if (failed === saveFailed) return;
  saveFailed = failed;
  for (const fn of saveListeners) {
    try { fn(error); } catch (e) { console.error(e); }
  }
}

/* Rend compte de son résultat. Les tableaux locaux passent avant le miroir, qui cède sa place si besoin. */
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

export function getAll() {
  return remote ? [...data.tableaux, ...remote.list()] : data.tableaux;
}

export function getLocal(id) {
  return data.tableaux.find(b => b.id === id) || null;
}

export function get(id) {
  return getLocal(id) || remote?.get(id) || null;
}

export function create(nom, données) {
  const now = new Date().toISOString();
  const board = {
    id: generateId(),
    nom,
    icon: 'board',
    espaceId: null,
    créé: now,
    dernièreOuverture: now,
    favori: false,
    données: données ? JSON.parse(JSON.stringify(données)) : { name: nom, items: [] }
  };
  board.données.name = nom;
  data.tableaux.push(board);
  save();
  notify();
  return board;
}

/* Retire une entrée que le stockage n'a pas pu recevoir, sans réécrire : l'alerte de stockage plein reste vraie. */
export function discard(id) {
  data.tableaux = data.tableaux.filter(b => b.id !== id);
  notify();
}

export function saveData(id, snapshot) {
  const board = data.tableaux.find(b => b.id === id);
  if (!board) { remote?.edit(id, snapshot); return; }
  board.données = snapshot;
  board.dernièreOuverture = new Date().toISOString();
  save();
}

export function remove(id) {
  data.tableaux = data.tableaux.filter(b => b.id !== id);
  save();
  notify();
}

export function rename(id, nom) {
  const board = data.tableaux.find(b => b.id === id);
  if (!board) return null;
  board.nom = nom;
  if (board.données) board.données.name = nom;
  save();
  notify();
  return board;
}

export function duplicate(id) {
  const original = get(id);
  if (!original?.données) return null;
  const now = new Date().toISOString();
  const copy = {
    id: generateId(),
    nom: original.nom + ' (copie)',
    icon: normalizeBoardIcon(original.icon || original.emoji),
    espaceId: original.espaceId || null,
    créé: now,
    dernièreOuverture: now,
    favori: false,
    données: JSON.parse(JSON.stringify(original.données))
  };
  copy.données.name = copy.nom;
  data.tableaux.push(copy);
  save();
  notify();
  return copy;
}

export function toggleFavori(id) {
  const board = data.tableaux.find(b => b.id === id);
  if (!board) return remote?.toggleFavori(id) ?? false;
  board.favori = !board.favori;
  save();
  notify();
  return board.favori;
}

export function getFavoris() {
  return getAll().filter(b => b.favori);
}

export function touchOpened(id) {
  const board = data.tableaux.find(b => b.id === id);
  if (!board) { remote?.touch(id); return; }
  board.dernièreOuverture = new Date().toISOString();
  save();
}

export { BOARD_ICONS };
export function setIcon(id, icon) {
  const board = getLocal(id);
  if (!board || !BOARD_ICONS.some(([id]) => id === icon)) return;
  board.icon = icon;
  save(); notify();
}
export function getSpaces() { return data.espaces; }
export function createSpace(nom) {
  const space = { id: generateId().replace('board-', 'space-'), nom };
  data.espaces.push(space); save(); notify(); return space;
}
export function renameSpace(id, nom) {
  const space = data.espaces.find(s => s.id === id);
  if (space) { space.nom = nom; save(); notify(); }
}
export function removeSpace(id) {
  data.espaces = data.espaces.filter(s => s.id !== id);
  for (const b of data.tableaux) if (b.espaceId === id) b.espaceId = null;
  remote?.clearSpace(id);
  save(); notify();
}
export function moveToSpace(id, espaceId) {
  const b = get(id);
  if (b && (!espaceId || data.espaces.some(s => s.id === espaceId))) {
    if (b.distant) { remote.setSpace(id, espaceId || null); notify(); return; }
    b.espaceId = espaceId || null; save(); notify();
  }
}
