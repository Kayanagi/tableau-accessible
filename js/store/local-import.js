/*
 * Import de ce qui est resté sur cet appareil d'avant les comptes : tableaux, espaces, « Mes modèles ».
 * Ce qui reste à proposer, ce qui est déjà parti, le choix « Plus tard », le refus (supprimer sans importer).
 * Le suivi a sa propre clé, commune à l'appareil : un tableau importé n'est jamais proposé une seconde fois, même s'il
 * reste sur l'appareil. Il est relu à chaque lecture et fusionné avec le disque à chaque écriture : un autre onglet
 * peut importer ou répondre « Plus tard » en même temps. Le serveur est la dernière garde : chaque tableau part avec
 * une clé d'import stable, et la même clé rend le tableau déjà créé (nouvel essai après coupure, deux onglets).
 * Espaces et modèles n'existent que sur l'appareil : ils ne quittent l'espace commun qu'une fois enregistrés par le
 * serveur (importés), ou sur refus explicite de la personne (supprimés sans import).
 */
import * as boards from './boards.js';
import * as local from './account-local.js';

const KEY = 'tableau-accessible-import';

/* Seulement si l'écriture a échoué (stockage plein) : garde de cet onglet, fusionnée à chaque lecture. */
let unsaved = null;
let listening = false;

const empty = () => ({ imported: {}, later: [] });
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function readDisk() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return {
      imported: isObject(parsed?.imported) ? parsed.imported : {},
      later: Array.isArray(parsed?.later) ? parsed.later.filter(id => typeof id === 'string') : []
    };
  } catch {
    return empty();
  }
}

/* Ce que l'on sait de plus complet : un tableau marqué importé quelque part le reste, « Plus tard » s'ajoute. */
function union(a, b) {
  return { imported: { ...a.imported, ...b.imported }, later: [...new Set([...a.later, ...b.later])] };
}

function read() {
  listen();
  const disk = readDisk();
  return unsaved ? union(disk, unsaved) : disk;
}

/* Le changement s'applique à la version du disque, relue à l'instant : rien d'un autre onglet n'est effacé. */
function change(fn) {
  const next = fn(read());
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    unsaved = null;
  } catch (e) {
    unsaved = next;
    console.warn('Suivi de l’import non enregistré :', e);
  }
}

function listen() {
  if (listening) return;
  listening = true;
  // Un autre onglet a écrit le suivi, ou libéré de la place : ce que cet onglet n'a pas pu enregistrer y est ajouté.
  addEventListener('storage', e => {
    if (unsaved && (e.key === KEY || e.key === null)) change(state => state);
  });
}

const visibleTo = (board, userId) => !board.réservéÀ || board.réservéÀ === userId;

export const itemCount = board => (Array.isArray(board.données?.items) ? board.données.items.length : 0);

/* Clé d'import envoyée au serveur : dérivée de l'identifiant local, stable d'un essai et d'un onglet à l'autre. */
export function importKeyOf(localId) {
  const id = String(localId);
  const clean = id.replace(/[^A-Za-z0-9_-]/g, '_');
  if (clean === id && clean.length <= 94) return `local-${clean}`;
  // Nettoyée ou trop longue : une empreinte de l'identifiant d'origine évite que deux identifiants se confondent.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return `local-${clean.slice(0, 80)}-${hash.toString(36)}`;
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

/*
 * Espaces et modèles copiés dans le compte connecté, puis envoyés au serveur. Chacun ne quitte l'espace commun de
 * l'appareil qu'une fois enregistré par le serveur ; ce qu'il refuse, ou ce qui n'a pas encore pu partir, y reste.
 * Une réponse qui arrive plus tard (retour de la connexion) retire encore ce qui a été accepté.
 * Rend un résultat par élément : { kind: 'space'|'template', id, nom, ok, pending?, reason? }.
 * Lève si une limite du compte serait dépassée : rien n'est envoyé ni retiré.
 */
export async function importOrganisation({ spaces = [], templates = [] }) {
  if (!spaces.length && !templates.length) return [];
  const ticket = local.importItems({ espaces: spaces, modèles: templates, usage: templates.length ? local.legacyUsage() : {} });
  const refusedOf = result => new Map(result.refused.map(r => [`${r.kind}:${r.id}`, r.reason]));
  ticket.settled.then(result => {
    if (!result.sent) return;
    const refused = refusedOf(result);
    const spaceIds = spaces.map(s => s.id).filter(id => !refused.has(`espace:${id}`));
    const templateIds = templates.map(t => t.id).filter(id => !refused.has(`modèle:${id}`));
    if (spaceIds.length) boards.removeLegacySpaces(spaceIds);
    if (templateIds.length) local.removeLegacyTemplates(templateIds);
  });
  await local.flush();
  // Réglé pendant l'envoi : le résultat est déjà là (ticket.result est posé avant la fin de flush).
  const result = ticket.result;
  const refused = result ? refusedOf(result) : new Map();
  const outcome = (kind, key, x) => {
    if (!result) return { kind, id: x.id, nom: x.nom, ok: false, pending: true };
    if (refused.has(`${key}:${x.id}`)) return { kind, id: x.id, nom: x.nom, ok: false, reason: refused.get(`${key}:${x.id}`) };
    if (!result.sent) return { kind, id: x.id, nom: x.nom, ok: false, reason: result.error?.message || 'Le serveur ne l’a pas enregistré.' };
    return { kind, id: x.id, nom: x.nom, ok: true };
  };
  return [...spaces.map(s => outcome('space', 'espace', s)), ...templates.map(t => outcome('template', 'modèle', t))];
}

/* Refus explicite : supprimés de cet appareil sans passer par le compte. */
export function discard({ boards: boardIds = [], spaces = [], templates = [] }) {
  for (const id of boardIds) boards.removeFromReserve(id);
  if (spaces.length) boards.removeLegacySpaces(spaces);
  if (templates.length) local.removeLegacyTemplates(templates);
  local.cleanupLegacy();
}

export function markLater(ids) {
  if (!ids.length) return;
  change(state => ({ ...state, later: [...new Set([...state.later, ...ids])] }));
}

function markImported(localId, remoteId, userId) {
  change(state => ({ imported: { ...state.imported, [localId]: { remoteId, userId } }, later: state.later.filter(id => id !== localId) }));
}

/*
 * Une fois la réponse reçue, le tableau est marqué aussitôt. Une réponse perdue (coupure) laisse le tableau proposé :
 * le nouvel essai porte la même clé et le serveur rend le tableau déjà créé, sans doublon.
 */
export async function importBoard(board, userId) {
  if (read().imported[board.id]) return { skipped: true };
  const { entry } = await boards.remoteStore().upload(board, { importKey: importKeyOf(board.id) });
  markImported(board.id, entry.id, userId);
  return { entry };
}

/* Jamais sans un clic de la personne : le suivi de l'identifiant reste, au cas où un autre onglet l'aurait encore affiché. */
export function removeFromDevice(id) {
  boards.removeFromReserve(id);
}

/*
 * Le compte qui avait importé ces tableaux a été supprimé de cet appareil : ce qu'il avait importé n'existe plus sur
 * le serveur. Leurs copies sur l'appareil redeviennent proposées : à importer dans un autre compte, ou à supprimer.
 */
export function forgetAccount(userId) {
  if (!userId) return;
  change(state => ({ ...state, imported: Object.fromEntries(Object.entries(state.imported).filter(([, v]) => v?.userId !== userId)) }));
}
