const STORAGE_KEY = 'tableau-accessible-boards';
const OLD_STORAGE_KEY = 'tableau-accessible-board';
const CURRENT_VERSION = 2;

let data = { version: CURRENT_VERSION, tableaux: [] };
const listeners = new Set();

function generateId() {
  return 'board-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Sauvegarde impossible :', e);
  }
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
      return;
    }
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldRaw) {
      const oldBoard = JSON.parse(oldRaw);
      const now = new Date().toISOString();
      data.tableaux.push({
        id: generateId(),
        nom: oldBoard.name || 'Tableau importé',
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
  return data.tableaux;
}

export function get(id) {
  return data.tableaux.find(b => b.id === id) || null;
}

export function create(nom, données) {
  const now = new Date().toISOString();
  const board = {
    id: generateId(),
    nom,
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

export function saveData(id, snapshot) {
  const board = data.tableaux.find(b => b.id === id);
  if (!board) return;
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
  const original = data.tableaux.find(b => b.id === id);
  if (!original) return null;
  const now = new Date().toISOString();
  const copy = {
    id: generateId(),
    nom: original.nom + ' (copie)',
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
  if (!board) return false;
  board.favori = !board.favori;
  save();
  notify();
  return board.favori;
}

export function getFavoris() {
  return data.tableaux.filter(b => b.favori);
}

export function touchOpened(id) {
  const board = data.tableaux.find(b => b.id === id);
  if (!board) return;
  board.dernièreOuverture = new Date().toISOString();
  save();
}
