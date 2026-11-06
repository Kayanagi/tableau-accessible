/*
 * Import des tableaux restés sur cet appareil : ce qui reste à proposer, ce qui est déjà parti, le choix « Plus tard ».
 * Le suivi a sa propre clé : un tableau importé n'est jamais proposé une seconde fois, même s'il reste sur l'appareil.
 */
import * as boards from './boards.js';

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

/* Faut-il ouvrir le dialogue sans qu'on le demande ? Seulement pour ce qui n'a pas encore reçu de réponse. */
export function shouldPrompt(userId) {
  const { later } = read();
  return importable(userId).some(b => !later.includes(b.id));
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
