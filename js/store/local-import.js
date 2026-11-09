/*
 * Import de ce qui est resté sur cet appareil d'avant les comptes : tableaux, espaces, « Mes modèles ».
 * Ce qui reste à proposer, ce qui est déjà parti, le choix « Plus tard », le refus (supprimer sans importer).
 * Le suivi a sa propre clé : un tableau importé n'est jamais proposé une seconde fois, même s'il reste sur l'appareil.
 * Espaces et modèles n'existent que sur l'appareil : importés ou refusés, ils quittent aussitôt l'espace commun.
 */
import * as boards from './boards.js';
import * as local from './account-local.js';

const KEY = 'tableau-accessible-import';

let memory = null;

function read() {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    memory = { imported: parsed?.imported || {}, later: Array.isArray(parsed?.later) ? parsed.later : [] };
  } catch {
    memory = { imported: {}, later: [] };
  }
  return memory;
}

/* Le suivi en mémoire tient lieu de garde si le stockage est plein : pas de doublon dans cet onglet. */
function write(state) {
  memory = state;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    memory = null;
  } catch (e) {
    console.warn('Suivi de l’import non enregistré :', e);
  }
}

const visibleTo = (board, userId) => !board.réservéÀ || board.réservéÀ === userId;
const itemCount = board => (Array.isArray(board.données?.items) ? board.données.items.length : 0);

export function countItems(board) {
  return itemCount(board);
}

/* Tableaux à proposer à ce compte. */
export function importable(userId) {
  const { imported } = read();
  return boards.reserveBoards().filter(b => !imported[b.id] && visibleTo(b, userId));
}

/* Tableaux déjà importés par ce compte et encore présents sur l'appareil. */
export function alreadyImported(userId) {
  const { imported } = read();
  return boards.reserveBoards().filter(b => imported[b.id]?.userId === userId);
}

/* Espaces et modèles d'avant les comptes, sans propriétaire : le premier compte qui les importe les prend. */
export function importableSpaces() {
  return boards.legacySpaces();
}

export function importableTemplates() {
  return local.legacyTemplates();
}

export function hasAnything(userId) {
  return importable(userId).length + importableSpaces().length + importableTemplates().length > 0;
}

/* Faut-il ouvrir le dialogue sans qu'on le demande ? Seulement pour ce qui n'a pas encore reçu de réponse. */
export function shouldPrompt(userId) {
  const { later } = read();
  return [...importable(userId), ...importableSpaces(), ...importableTemplates()].some(x => !later.includes(x.id));
}

/* Copiés dans le compte connecté, puis retirés de l'espace commun. Lève si le stockage est plein : rien n'est retiré. */
export function importSpaces(spaces) {
  if (!spaces.length) return;
  local.update(d => {
    for (const s of spaces) if (!d.espaces.some(e => e.id === s.id)) d.espaces.push({ id: s.id, nom: s.nom });
  });
  boards.removeLegacySpaces(spaces.map(s => s.id));
}

export function importTemplates(list) {
  if (!list.length) return;
  const usage = local.legacyUsage();
  local.update(d => {
    for (const t of list) if (!d.modèles.some(m => m.id === t.id)) d.modèles.push(t);
    for (const [id, at] of Object.entries(usage)) if (typeof at === 'number' && !(d.usage[id] >= at)) d.usage[id] = at;
  });
  local.removeLegacyTemplates(list.map(t => t.id));
}

/* Refus explicite : supprimés de cet appareil sans passer par le compte. */
export function discard({ boards: boardIds = [], spaces = [], templates = [] }) {
  for (const id of boardIds) boards.removeFromReserve(id);
  if (spaces.length) boards.removeLegacySpaces(spaces);
  if (templates.length) local.removeLegacyTemplates(templates);
  local.cleanupLegacy();
}

export function markLater(ids) {
  const state = read();
  write({ ...state, later: [...new Set([...state.later, ...ids])] });
}

function markImported(localId, remoteId, userId) {
  const state = read();
  write({ imported: { ...state.imported, [localId]: { remoteId, userId } }, later: state.later.filter(id => id !== localId) });
}

/* Une fois le 201 reçu, le tableau est marqué aussitôt : rien ne doit pouvoir le renvoyer. */
export async function importBoard(board, userId) {
  const { imported } = read();
  if (imported[board.id]) return { skipped: true };
  const { entry } = await boards.remoteStore().upload(board);
  markImported(board.id, entry.id, userId);
  return { entry };
}

/* Jamais sans un clic de la personne : le suivi de l'identifiant reste, au cas où un autre onglet l'aurait encore en mémoire. */
export function removeFromDevice(id) {
  boards.removeFromReserve(id);
}

export function cleanupLegacy() {
  local.cleanupLegacy();
}
