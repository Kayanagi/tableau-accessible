/*
 * Validation serveur (§9 du document). Rejeter, jamais réparer : seul l'import initial passe
 * d'abord par sanitizeIds et les reprises de format historique, puis par la même validation.
 */
import { ID_REFS, LEGACY_COLORS, PALETTE, SAFE_ID, SHAPES, TYPES, sanitizeIds } from '../../js/model-rules.js';
import { CAPS, LINE_COLORS, LINE_STYLES, LINE_TYPES, normalizeLine } from '../../js/lines.js';
import { BOARD_BACKGROUNDS, LANGUAGES, PEN_COLORS, REACTIONS, TAG_COLORS, defaults } from '../../js/objects.js';
import { BOARD_ICONS } from '../../js/ui/icons.js';

export const LIMITS = {
  boardItems: 5000,
  boardBytes: 4 * 1024 * 1024,
  itemBytes: 128 * 1024,
  text: 50000,
  name: 200,
  displayName: 50,
  idLength: 128,
  points: 10000,
  waypoints: 200,
  kanbanColumns: 50,
  kanbanCards: 500,
  tableRows: 200,
  tableColumns: 50,
  messages: 500,
  tags: 200,
  coordinate: 1e7,
  size: 1e5,
  depth: 32,
  passwordMin: 12,
  passwordMax: 128,
  email: 254
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TOP_LEVEL_KEY = /^[A-Za-z]\w{0,39}$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const STRUCTURAL = { kanban: 'columns', datatable: 'rows', comment: 'messages' };
const ALIGNS = ['left', 'center', 'right'];
const STICKY_SIZES = ['s', 'm', 'l'];
const NUMERIC_FIELDS = ['x', 'y', 'width', 'height', 'strokeWidth', 'vw', 'vh'];
const TEXT_FIELDS = ['content', 'title', 'back'];
const BOOLEAN_FIELDS = ['locked', 'bold', 'collapsed', 'flipped', 'resolved'];
const BOARD_FIELDS = ['name', 'tags', 'frameOrder', 'background'];

const idsOf = list => new Set(list.map(entry => entry[0]));
const COLOR_IDS = idsOf(PALETTE);
const LINE_COLOR_IDS = idsOf(LINE_COLORS);
const PEN_COLOR_IDS = idsOf(PEN_COLORS);
const TAG_COLOR_IDS = idsOf(TAG_COLORS);
const REACTION_IDS = idsOf(REACTIONS);
const BACKGROUND_IDS = idsOf(BOARD_BACKGROUNDS);
const ICON_IDS = idsOf(BOARD_ICONS);

export class ValidationError extends Error {
  constructor(code, message, path = '') {
    super(message);
    this.code = code;
    this.path = path.slice(0, 200);
  }
}

function fail(path, message, code = 'invalid_data') {
  throw new ValidationError(code, message, path);
}

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const charCount = s => { let count = 0; for (const _ of s) count++; return count; };
const join = (path, key) => (path ? `${path}.${key}` : String(key));

function requireEnum(value, set, path, message) {
  if (typeof value !== 'string' || !set.has(value)) fail(path, message, 'invalid_enum');
}

function requireMapKey(value, map, path, message) {
  if (typeof value !== 'string' || !Object.hasOwn(map, value)) fail(path, message, 'invalid_enum');
}

function safeId(value, path) {
  if (typeof value !== 'string' || value.length > LIMITS.idLength || !SAFE_ID.test(value)) fail(path, 'Identifiant invalide', 'invalid_id');
}

function shortText(value, path, label) {
  if (typeof value !== 'string') fail(path, `${label} : texte attendu`);
  if (charCount(value) > LIMITS.name) fail(path, `${label} : ${LIMITS.name} caractères au plus`, 'too_long');
}

function point(value, path) {
  if (!isPlain(value) || typeof value.x !== 'number' || typeof value.y !== 'number') fail(path, 'Point { x, y } attendu');
}

/* Parcours récursif borné : clés interdites, profondeur, textes et nombres, partout dans l'objet. */
function walk(value, path, depth = 0) {
  if (depth > LIMITS.depth) fail(path, 'Données trop profondément imbriquées');
  if (typeof value === 'string') {
    if (value.length > LIMITS.text) fail(path, `Texte de plus de ${LIMITS.text} caractères`, 'too_long');
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > LIMITS.coordinate) fail(path, `Nombre hors limites (±${LIMITS.coordinate})`, 'out_of_range');
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walk(value[i], `${path}[${i}]`, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) fail(join(path, key), 'Clé interdite', 'forbidden_key');
      walk(value[key], join(path, key), depth + 1);
    }
  }
}

function checkTopLevelKeys(object, path) {
  for (const key of Object.keys(object)) {
    if (FORBIDDEN_KEYS.has(key)) fail(join(path, key), 'Clé interdite', 'forbidden_key');
    if (!TOP_LEVEL_KEY.test(key)) fail(join(path, key), 'Nom de champ invalide', 'invalid_key');
  }
}

function checkKanban(columns, path) {
  if (!Array.isArray(columns)) fail(path, 'Liste de colonnes attendue', 'missing_structure');
  if (columns.length > LIMITS.kanbanColumns) fail(path, `${LIMITS.kanbanColumns} colonnes au plus`, 'too_many');
  const seen = new Set();
  const unique = (id, at) => {
    safeId(id, at);
    if (seen.has(id)) fail(at, 'Identifiant en double', 'duplicate_id');
    seen.add(id);
  };
  columns.forEach((col, c) => {
    const at = `${path}[${c}]`;
    if (!isPlain(col)) fail(at, 'Colonne invalide');
    unique(col.id, `${at}.id`);
    shortText(col.name, `${at}.name`, 'Nom de colonne');
    if (!Array.isArray(col.cards)) fail(`${at}.cards`, 'Liste de cartes attendue', 'missing_structure');
    if (col.cards.length > LIMITS.kanbanCards) fail(`${at}.cards`, `${LIMITS.kanbanCards} cartes au plus par colonne`, 'too_many');
    col.cards.forEach((card, k) => {
      const atCard = `${at}.cards[${k}]`;
      if (!isPlain(card)) fail(atCard, 'Carte invalide');
      unique(card.id, `${atCard}.id`);
      if (card.text !== undefined && typeof card.text !== 'string') fail(`${atCard}.text`, 'Texte attendu');
    });
  });
}

function checkRows(rows, path) {
  if (!Array.isArray(rows)) fail(path, 'Liste de lignes attendue', 'missing_structure');
  if (rows.length > LIMITS.tableRows) fail(path, `${LIMITS.tableRows} lignes au plus`, 'too_many');
  rows.forEach((row, r) => {
    const at = `${path}[${r}]`;
    if (!Array.isArray(row)) fail(at, 'Ligne invalide');
    if (row.length > LIMITS.tableColumns) fail(at, `${LIMITS.tableColumns} colonnes au plus`, 'too_many');
    row.forEach((cell, c) => { if (typeof cell !== 'string') fail(`${at}[${c}]`, 'Texte attendu'); });
  });
}

function checkMessages(messages, path) {
  if (!Array.isArray(messages)) fail(path, 'Liste de messages attendue', 'missing_structure');
  if (messages.length > LIMITS.messages) fail(path, `${LIMITS.messages} messages au plus`, 'too_many');
  messages.forEach((m, i) => {
    const at = `${path}[${i}]`;
    if (!isPlain(m)) fail(at, 'Message invalide');
    shortText(m.author, `${at}.author`, 'Auteur');
    if (typeof m.text !== 'string') fail(`${at}.text`, 'Texte attendu');
    if (typeof m.date !== 'string' || m.date.length > 64 || !Number.isFinite(Date.parse(m.date))) fail(`${at}.date`, 'Date invalide');
  });
}

function checkReactions(reactions, path) {
  if (!isPlain(reactions)) fail(path, 'Réactions invalides');
  for (const [emoji, authors] of Object.entries(reactions)) {
    if (!REACTION_IDS.has(emoji)) fail(join(path, emoji), 'Réaction inconnue', 'invalid_enum');
    if (!Array.isArray(authors)) fail(join(path, emoji), 'Liste d’auteurs attendue');
    authors.forEach((a, i) => shortText(a, `${join(path, emoji)}[${i}]`, 'Auteur'));
  }
}

function checkStroke(item) {
  if (item.stroke === undefined) return;
  if (item.type === 'connector') requireEnum(item.stroke, LINE_COLOR_IDS, 'stroke', 'Couleur de ligne inconnue');
  else if (item.type === 'drawing') requireEnum(item.stroke, PEN_COLOR_IDS, 'stroke', 'Couleur de trait inconnue');
  else fail('stroke', 'Couleur de trait inattendue pour ce type', 'invalid_enum');
}

/* Vérifie un objet seul ; le cycle de parentNode, qui dépend du tableau, est vérifié à part. */
function checkItem(item) {
  if (!isPlain(item)) fail('', 'Objet attendu');
  checkTopLevelKeys(item, '');
  walk(item, '');
  if (Buffer.byteLength(JSON.stringify(item)) > LIMITS.itemBytes) fail('', 'Objet de plus de 128 Kio', 'too_large');

  safeId(item.id, 'id');
  requireMapKey(item.type, TYPES, 'type', 'Type d’objet inconnu');

  for (const ref of ID_REFS) {
    const value = item[ref];
    if (value === undefined || value === null) continue;
    safeId(value, ref);
    if (value === item.id) fail(ref, 'Un élément ne peut pas se référencer lui-même', 'self_reference');
  }

  for (const field of NUMERIC_FIELDS) {
    if (item[field] !== undefined && typeof item[field] !== 'number') fail(field, 'Nombre attendu');
  }
  for (const field of ['width', 'height']) {
    if (item[field] !== undefined && (item[field] < 0 || item[field] > LIMITS.size)) fail(field, `Taille hors limites (0 à ${LIMITS.size})`, 'out_of_range');
  }
  if (item.type !== 'connector') {
    for (const field of ['x', 'y']) if (item[field] === undefined) fail(field, 'Position requise', 'missing_structure');
  }
  for (const field of TEXT_FIELDS) {
    if (item[field] !== undefined && typeof item[field] !== 'string') fail(field, 'Texte attendu');
  }
  if (item.label !== undefined) shortText(item.label, 'label', 'Libellé');
  for (const field of BOOLEAN_FIELDS) {
    if (item[field] !== undefined && typeof item[field] !== 'boolean') fail(field, 'Booléen attendu');
  }
  if (item.fontSize !== undefined && item.fontSize !== 'auto' && typeof item.fontSize !== 'number') fail('fontSize', 'Taille de police invalide');
  if (item.align !== undefined && !ALIGNS.includes(item.align)) fail('align', 'Alignement inconnu', 'invalid_enum');
  if (item.size !== undefined && !STICKY_SIZES.includes(item.size)) fail('size', 'Taille inconnue', 'invalid_enum');

  if (item.color !== undefined) requireEnum(item.color, COLOR_IDS, 'color', 'Couleur inconnue');
  if (item.shape !== undefined) requireMapKey(item.shape, SHAPES, 'shape', 'Forme inconnue');
  if (item.language !== undefined) requireMapKey(item.language, LANGUAGES, 'language', 'Langage inconnu');
  checkStroke(item);
  if (item.lineType !== undefined) requireMapKey(item.lineType, LINE_TYPES, 'lineType', 'Type de ligne inconnu');
  if (item.lineStyle !== undefined) requireMapKey(item.lineStyle, LINE_STYLES, 'lineStyle', 'Style de ligne inconnu');
  if (item.startCap !== undefined) requireMapKey(item.startCap, CAPS, 'startCap', 'Extrémité de ligne inconnue');
  if (item.endCap !== undefined) requireMapKey(item.endCap, CAPS, 'endCap', 'Extrémité de ligne inconnue');
  if (item.reactions !== undefined) checkReactions(item.reactions, 'reactions');

  if (item.tags !== undefined) {
    if (!Array.isArray(item.tags)) fail('tags', 'Liste d’étiquettes attendue');
    if (item.tags.length > LIMITS.tags) fail('tags', `${LIMITS.tags} étiquettes au plus`, 'too_many');
    item.tags.forEach((id, i) => safeId(id, `tags[${i}]`));
  }
  for (const end of ['start', 'end']) if (item[end] !== undefined && item[end] !== null) point(item[end], end);
  if (item.waypoints !== undefined) {
    if (!Array.isArray(item.waypoints)) fail('waypoints', 'Liste de points attendue');
    if (item.waypoints.length > LIMITS.waypoints) fail('waypoints', `${LIMITS.waypoints} points au plus`, 'too_many');
    item.waypoints.forEach((w, i) => point(w, `waypoints[${i}]`));
  }
  if (item.points !== undefined) {
    if (!Array.isArray(item.points)) fail('points', 'Liste de coordonnées attendue');
    if (item.points.length > LIMITS.points) fail('points', `${LIMITS.points} coordonnées au plus`, 'too_many');
    if (item.points.length % 2) fail('points', 'Nombre pair de coordonnées attendu');
    item.points.forEach((n, i) => { if (typeof n !== 'number') fail(`points[${i}]`, 'Nombre attendu'); });
  }

  // Champs structurels : absents, normalizeItem générerait des identifiants différents sur chaque client.
  const required = STRUCTURAL[item.type];
  if (required && item[required] === undefined) fail(required, 'Champ requis', 'missing_structure');
  if (item.columns !== undefined) checkKanban(item.columns, 'columns');
  if (item.rows !== undefined) checkRows(item.rows, 'rows');
  if (item.messages !== undefined) checkMessages(item.messages, 'messages');
}

/* Renvoie l'identifiant d'un élément pris dans un cycle de parentNode, ou null. */
export function findParentCycle(items) {
  const parents = new Map(items.map(i => [i.id, i.parentNode]));
  const done = new Set();
  for (const item of items) {
    const path = new Set();
    let id = item.id;
    while (id != null && parents.has(id) && !done.has(id)) {
      if (path.has(id)) return id;
      path.add(id);
      id = parents.get(id);
    }
    for (const seen of path) done.add(seen);
  }
  return null;
}

export function findDeepParent(items, maximum = 64) {
  const parents = new Map(items.map(item => [item.id, item.parentNode]));
  for (const item of items) {
    let id = item.id;
    const seen = new Set();
    for (let depth = 0; id != null && parents.has(id); depth++) {
      if (seen.has(id)) break;
      if (depth > maximum) return item.id;
      seen.add(id);
      id = parents.get(id);
    }
  }
  return null;
}

function repairParentDepth(items, maximum = 64) {
  while (true) {
    const id = findDeepParent(items, maximum);
    if (id === null) return;
    const item = items.find(candidate => candidate.id === id);
    if (!item) return;
    delete item.parentNode;
  }
}

function checkBoardMeta(data) {
  if (data.name !== undefined) shortText(data.name, 'name', 'Nom du tableau');
  if (data.background !== undefined && data.background !== null) requireEnum(data.background, BACKGROUND_IDS, 'background', 'Couleur de fond inconnue');
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) fail('tags', 'Liste d’étiquettes attendue');
    if (data.tags.length > LIMITS.tags) fail('tags', `${LIMITS.tags} étiquettes au plus`, 'too_many');
    const seen = new Set();
    data.tags.forEach((tag, i) => {
      const at = `tags[${i}]`;
      if (!isPlain(tag)) fail(at, 'Étiquette invalide');
      safeId(tag.id, `${at}.id`);
      if (seen.has(tag.id)) fail(`${at}.id`, 'Identifiant en double', 'duplicate_id');
      seen.add(tag.id);
      shortText(tag.name, `${at}.name`, 'Nom d’étiquette');
      requireEnum(tag.color, TAG_COLOR_IDS, `${at}.color`, 'Couleur d’étiquette inconnue');
    });
  }
  if (data.frameOrder !== undefined) {
    if (!Array.isArray(data.frameOrder)) fail('frameOrder', 'Liste d’identifiants attendue');
    if (data.frameOrder.length > LIMITS.boardItems) fail('frameOrder', 'Liste trop longue', 'too_many');
    data.frameOrder.forEach((id, i) => safeId(id, `frameOrder[${i}]`));
  }
}

/* Les autres champs (id, rev, dates renvoyés par GET) ne sont ni stockés ni interprétés. */
function knownFields(data) {
  const out = {};
  for (const key of BOARD_FIELDS) if (Object.hasOwn(data, key)) out[key] = data[key];
  return out;
}

function clone(data) {
  return JSON.parse(JSON.stringify({ ...knownFields(data), items: data.items }));
}

function checkBoard(data) {
  if (!isPlain(data)) fail('data', 'Objet attendu');
  checkTopLevelKeys(data, 'data');
  const { items } = data;
  const rest = knownFields(data);
  walk(rest, 'data');
  checkBoardMeta(data);
  if (!Array.isArray(items)) fail('data.items', 'Liste d’objets attendue', 'missing_structure');
  if (items.length > LIMITS.boardItems) fail('data.items', `${LIMITS.boardItems} objets au plus`, 'too_many');
  const ids = new Set();
  let bytes = 0;
  items.forEach((item, i) => {
    try { checkItem(item); }
    catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(err.code, err.message, err.path ? `data.items[${i}].${err.path}` : `data.items[${i}]`);
      throw err;
    }
    if (ids.has(item.id)) fail(`data.items[${i}].id`, 'Identifiant en double', 'duplicate_id');
    ids.add(item.id);
    bytes += Buffer.byteLength(JSON.stringify(item));
  });
  const cycle = findParentCycle(items);
  if (cycle !== null) fail(`data.items`, `Cycle de parentNode autour de ${cycle}`, 'parent_cycle');
  const deep = findDeepParent(items);
  if (deep !== null) fail('data.items', `Profondeur de parentNode supérieure à 64 autour de ${deep}`, 'parent_depth');
  bytes += Buffer.byteLength(JSON.stringify(rest));
  if (bytes > LIMITS.boardBytes) fail('data', 'Tableau de plus de 4 Mio', 'too_large');
}

/* Forme canonique : seuls les champs connus du tableau sont conservés, les lignes normalisées. */
function canonical(data) {
  const items = data.items.map(item => (item.type === 'connector' ? normalizeLine(item) : item));
  const meta = { tags: data.tags ?? [] };
  if (data.frameOrder !== undefined) meta.frameOrder = data.frameOrder;
  if (data.background !== undefined && data.background !== null) meta.background = data.background;
  return { name: data.name, meta, items };
}

/* Remplacement d'un tableau (PUT) : aucune réparation. Lève ValidationError. */
export function prepareBoard(data) {
  checkBoard(data);
  return canonical(clone(data));
}

/* Envoi d'un tableau local (POST) : reprises de format historique, puis la même validation. */
export function prepareImport(data) {
  if (data === undefined || data === null) return canonical({ items: [] });
  if (!isPlain(data)) fail('data', 'Objet attendu');
  if (data.items !== undefined && !Array.isArray(data.items)) fail('data.items', 'Liste d’objets attendue', 'missing_structure');
  const source = data.items ?? [];
  if (source.length > LIMITS.boardItems) fail('data.items', `${LIMITS.boardItems} objets au plus`, 'too_many');
  source.forEach((item, i) => { if (!isPlain(item)) fail(`data.items[${i}]`, 'Objet attendu'); });
  checkTopLevelKeys(data, 'data');
  walk({ ...knownFields(data), items: source }, 'data');

  const copy = clone({ ...data, items: source });
  try {
    sanitizeIds(copy.items);
    repairParentDepth(copy.items);
    for (const item of copy.items) {
      if (item.type === 'sticky_note' && typeof item.color === 'string' && Object.hasOwn(LEGACY_COLORS, item.color)) item.color = LEGACY_COLORS[item.color];
      if (item.type === 'connector') normalizeLine(item);
      const field = typeof item.type === 'string' && Object.hasOwn(STRUCTURAL, item.type) ? STRUCTURAL[item.type] : null;
      if (field && item[field] === undefined) item[field] = defaults(item.type)[field];
    }
  } catch (err) {
    // Un objet comme { "toString": 1 } à la place d'une valeur simple fait lever String() ou Number().
    if (err instanceof TypeError) fail('data.items', 'Valeur invalide dans un objet');
    throw err;
  }
  checkBoard(copy);
  return canonical(copy);
}

/* Objet seul, pour les opérations temps réel : renvoie l'erreur ou null. */
export function validateItem(item) {
  try { checkItem(item); return null; }
  catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
}

/*
 * Opération `set` sur un objet existant : type et identifiant immuables, champs structurels
 * non supprimables, résultat revalidé. `items` (facultatif) sert à détecter un cycle créé par l'écriture.
 */
export function validateSet(current, fields = {}, removed = [], items = null) {
  try {
    if (!isPlain(fields)) fail('f', 'Objet attendu');
    if (!Array.isArray(removed)) fail('del', 'Liste de champs attendue');
    checkTopLevelKeys(fields, 'f');
    removed.forEach((key, i) => {
      if (typeof key !== 'string') fail(`del[${i}]`, 'Nom de champ attendu');
      if (FORBIDDEN_KEYS.has(key)) fail(`del[${i}]`, 'Clé interdite', 'forbidden_key');
    });
    if (Object.hasOwn(fields, 'type') && fields.type !== current.type) fail('f.type', 'Le type d’un objet ne change pas', 'immutable');
    if (Object.hasOwn(fields, 'id') && fields.id !== current.id) fail('f.id', 'L’identifiant d’un objet ne change pas', 'immutable');
    if (removed.includes('type') || removed.includes('id')) fail('del', 'Le type et l’identifiant ne se suppriment pas', 'immutable');
    if (removed.includes(STRUCTURAL[current.type])) fail('del', 'Champ structurel non supprimable', 'missing_structure');

    const merged = { ...current, ...fields };
    for (const key of removed) delete merged[key];
    checkItem(merged);
    if (items) {
      const after = items.map(i => (i.id === current.id ? merged : i));
      const cycle = findParentCycle(after);
      if (cycle !== null) fail('parentNode', `Cycle de parentNode autour de ${cycle}`, 'parent_cycle');
      const deep = findDeepParent(after);
      if (deep !== null) fail('parentNode', `Profondeur de parentNode supérieure à 64 autour de ${deep}`, 'parent_depth');
    }
    return null;
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
}

/* Champs de compte et de tableau. */
export function normalizeEmail(value) {
  return typeof value === 'string' && value.length <= LIMITS.email ? value.normalize('NFKC').trim().toLowerCase() : '';
}

export function isValidEmail(email) {
  return email.length > 0 && email.length <= LIMITS.email && EMAIL.test(email);
}

export function normalizePassword(value) {
  return typeof value === 'string' && value.length <= LIMITS.passwordMax * 2 ? value.normalize('NFKC') : null;
}

export function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  const n = charCount(password);
  return n >= LIMITS.passwordMin && n <= LIMITS.passwordMax;
}

export function normalizeDisplayName(value) {
  if (typeof value !== 'string' || value.length > LIMITS.displayName * 2) return null;
  const name = value.normalize('NFC').trim();
  const n = charCount(name);
  return n >= 1 && n <= LIMITS.displayName && !CONTROL_OR_FORMAT.test(name) ? name : null;
}

export function normalizeBoardName(value) {
  if (typeof value !== 'string' || value.length > LIMITS.name * 2) return null;
  const name = value.normalize('NFC').trim();
  const n = charCount(name);
  return n >= 1 && n <= LIMITS.name && !CONTROL_OR_FORMAT.test(name) ? name : null;
}

export function isValidIcon(value) {
  return typeof value === 'string' && ICON_IDS.has(value);
}
