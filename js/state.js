import * as history from './store/history.js';
import { announce } from './a11y/announcer.js';

export const PALETTE = [
  ['light_yellow', 'Jaune clair', '#fff79e'], ['miro_yellow', 'Jaune', '#ffe86d'],
  ['miro_orange', 'Orange', '#ffb575'], ['red', 'Rouge', '#ff9e9e'],
  ['light_pink', 'Rose clair', '#ffd2f2'], ['miro_pink', 'Rose', '#fd9ae7'],
  ['light_blue', 'Bleu clair', '#b2d0fe'], ['violet', 'Violet', '#b8acfb'],
  ['miro_blue', 'Bleu', '#9ce6ff'], ['dark_blue', 'Bleu foncé', '#86b4f9'],
  ['cyan', 'Cyan', '#81e7de'], ['dark_green', 'Vert foncé', '#6ae08d'],
  ['light_green', 'Vert clair', '#d1f09f'], ['miro_green', 'Vert', '#b3e65f'],
  ['miro_gray', 'Gris', '#f3f5f7'], ['black', 'Noir', '#151515']
];
const COLORS = Object.fromEntries(PALETTE.map(([id, name]) => [id, name]));
export const LINE_TYPES = { line: 'Ligne simple', arrow: 'Flèche', orthogonal: 'Flèche à angles droits' };
const LEGACY_COLORS = { yellow: 'miro_yellow', blue: 'miro_blue', green: 'miro_green', pink: 'miro_pink', orange: 'miro_orange', purple: 'violet', gray: 'miro_gray' };

const SHAPES = {
  rectangle: 'Rectangle',
  circle: 'Cercle',
  triangle: 'Triangle',
  diamond: 'Losange'
};

const TYPES = {
  sticky_note: 'Post-it',
  shape: 'Forme',
  text: 'Texte',
  card: 'Carte',
  frame: 'Cadre',
  connector: 'Lien'
};

let board = { name: 'Nouveau tableau', items: [] };
let selected = [];
let nextId = 1;
const listeners = new Set();

export const STICKY_SIZES = { s: 100, m: 150, l: 220 };
export const SIZE_NAMES = { s: 'petit', m: 'moyen', l: 'grand' };
export const ALIGN_NAMES = { left: 'à gauche', center: 'au centre', right: 'à droite' };
const DEFAULT_FONT = { text: 16, card: 13 };

function generateId() {
  return 'item-' + (nextId++);
}

function snapshot() {
  return JSON.parse(JSON.stringify(board));
}

function notify() {
  selected = selected.filter(id => board.items.some(i => i.id === id));
  for (const fn of listeners) {
    try { fn(board, getSelectedId()); } catch (e) { console.error(e); }
  }
}

export function sizeFromWidth(w) {
  return w <= 125 ? 's' : w <= 185 ? 'm' : 'l';
}

export function normalizeItem(item) {
  if (item.type === 'sticky_note') {
    item.color = LEGACY_COLORS[item.color] || item.color || 'light_yellow';
    item.size = item.size || sizeFromWidth(item.width || 150);
  }
  if (item.type === 'connector') item.lineType = item.lineType || 'arrow';
  else {
    if (item.fontSize === undefined) item.fontSize = item.type === 'sticky_note' ? 'auto' : (DEFAULT_FONT[item.type] || 14);
    if (item.bold === undefined) item.bold = false;
    if (!item.align) item.align = ['sticky_note', 'shape'].includes(item.type) ? 'center' : 'left';
  }
  return item;
}

export { COLORS, SHAPES, TYPES };

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getBoard() {
  return board;
}

export function getItems() {
  return board.items;
}

export function getItem(id) {
  return board.items.find(i => i.id === id) || null;
}

export function getSelectedId() {
  return selected.length ? selected[selected.length - 1] : null;
}

export function getSelectedIds() {
  return [...selected];
}

export function isSelected(id) {
  return selected.includes(id);
}

export function announceSelection() {
  const n = selected.length;
  announce(n === 0 ? 'Aucun élément sélectionné' : n === 1 ? '1 élément sélectionné' : `${n} éléments sélectionnés`);
}

export function setSelectedId(id) {
  selected = id ? [id] : [];
  notify();
}

export function setSelection(ids, speak = false) {
  selected = [...new Set(ids)];
  notify();
  if (speak) announceSelection();
}

export function toggleSelected(id) {
  selected = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
  notify();
  announceSelection();
}

export function selectAll() {
  setSelection(board.items.map(i => i.id), true);
}

function itemLabel(item) {
  if (!item) return '';
  const typeName = TYPES[item.type] || item.type;
  if (item.type === 'sticky_note') {
    const colorName = COLORS[item.color] || item.color;
    return `${typeName} ${colorName} : ${item.content || '(vide)'}`;
  }
  if (item.type === 'shape') {
    const shapeName = SHAPES[item.shape] || item.shape;
    return `${shapeName} : ${item.content || '(vide)'}`;
  }
  if (item.type === 'connector') {
    const startItem = getItem(item.startId);
    const endItem = getItem(item.endId);
    const startLabel = startItem ? getItemLabel(startItem) : '?';
    const endLabel = endItem ? getItemLabel(endItem) : '?';
    const labelPart = item.label ? ` (${item.label})` : '';
    return `${LINE_TYPES[item.lineType] || LINE_TYPES.arrow} de ${startLabel} vers ${endLabel}${labelPart}`;
  }
  if (item.type === 'card') {
    return `${typeName} : ${item.title || '(sans titre)'}`;
  }
  if (item.type === 'frame') {
    const children = board.items.filter(i => i.parent === item.id);
    return `${typeName} : ${item.content || '(sans nom)'}, ${children.length} élément(s)`;
  }
  return `${typeName} : ${item.content || '(vide)'}`;
}

export function getItemLabel(item) {
  return itemLabel(item) + (item?.locked ? ' — 🔒 Élément verrouillé' : '');
}

export function isLocked(id) {
  if (!getItem(id)?.locked) return false;
  announce('Élément verrouillé');
  return true;
}

function plural(n, one, many) {
  return n === 1 ? one : `${n} ${many}`;
}

export function touch() {
  notify();
}

export function duplicateItem(id) {
  return duplicateItems([id])[0];
}

export function duplicateItems(ids) {
  const sources = collectForCopy(ids);
  if (!sources.some(i => i.type !== 'connector')) return [];
  const copies = pasteItems(sources, 20, false).filter(c => c.type !== 'connector');
  announce(copies.length === 1 ? 'Élément dupliqué' : `${copies.length} éléments dupliqués`);
  return copies;
}

export function pasteItems(source, offset, speak = true) {
  const map = new Map();
  const copies = [];
  history.pushState(snapshot());
  for (const original of source) {
    if (original.type === 'connector') continue;
    const copy = JSON.parse(JSON.stringify(original));
    map.set(original.id, copy.id = generateId());
    copy.x = (copy.x || 0) + offset;
    copy.y = (copy.y || 0) + offset;
    copy.locked = false;
    copies.push(normalizeItem(copy));
  }
  for (const copy of copies) {
    if (copy.parent) copy.parent = map.get(copy.parent) || (getItem(copy.parent) ? copy.parent : null);
  }
  for (const original of source) {
    if (original.type !== 'connector' || !map.has(original.startId) || !map.has(original.endId)) continue;
    const link = JSON.parse(JSON.stringify(original));
    Object.assign(link, { id: generateId(), startId: map.get(original.startId), endId: map.get(original.endId), locked: false });
    copies.push(link);
  }
  board.items.push(...copies);
  selected = copies.filter(c => c.type !== 'connector').map(c => c.id);
  notify();
  if (speak) announce(`${plural(selected.length, '1 élément collé', 'éléments collés')}`);
  return copies;
}

export function collectForCopy(ids) {
  const set = new Set(ids.filter(id => getItem(id)?.type !== 'connector'));
  return board.items
    .filter(i => set.has(i.id) || (i.type === 'connector' && set.has(i.startId) && set.has(i.endId)))
    .map(i => JSON.parse(JSON.stringify(i)));
}

function editable(ids) {
  const items = ids.map(getItem).filter(Boolean);
  const free = items.filter(i => !i.locked);
  if (items.length && !free.length) announce(items.length === 1 ? 'Élément verrouillé' : 'Éléments verrouillés');
  return free;
}

export function toggleLocked(id) {
  toggleLockedMany([id]);
}

export function toggleLockedMany(ids) {
  const items = ids.map(getItem).filter(Boolean);
  if (!items.length) return;
  const lock = !items.every(i => i.locked);
  history.pushState(snapshot());
  items.forEach(i => { i.locked = lock; });
  notify();
  const what = items.length === 1 ? 'Élément' : `${items.length} éléments`;
  announce(`${what} ${lock ? 'verrouillé' : 'déverrouillé'}${items.length > 1 ? 's' : ''}`);
}

export function reorderItem(id, front) {
  reorderItems([id], front);
}

export function reorderItems(ids, front) {
  const moving = editable(ids);
  if (!moving.length) return;
  history.pushState(snapshot());
  board.items = board.items.filter(i => !moving.includes(i));
  if (front) board.items.push(...moving); else board.items.unshift(...moving);
  notify();
  announce(front ? 'Élément au premier plan' : 'Élément à l’arrière-plan');
}

export function updateItems(ids, changes, message) {
  const items = editable(ids);
  if (!items.length) return [];
  history.pushState(snapshot());
  for (const item of items) Object.assign(item, typeof changes === 'function' ? changes(item) : changes);
  notify();
  if (message) announce(message);
  return items;
}

export function resizeItems(ids, factor) {
  const items = editable(ids).filter(i => i.type !== 'connector');
  if (!items.length) return;
  history.pushState(snapshot());
  for (const i of items) {
    const w = Math.max(20, Math.round((i.width || 100) * factor));
    const h = Math.max(20, Math.round((i.height || 100) * factor));
    i.x = Math.round(i.x + ((i.width || 100) - w) / 2);
    i.y = Math.round(i.y + ((i.height || 100) - h) / 2);
    i.width = w; i.height = h;
    if (i.type === 'sticky_note') i.size = sizeFromWidth(w);
  }
  notify();
  announce(items.length === 1 ? `Taille ${items[0].width} par ${items[0].height}` : `${items.length} éléments redimensionnés`);
}

export function setItemBox(item, box) {
  Object.assign(item, box);
  if (item.type === 'sticky_note') item.size = sizeFromWidth(item.width);
}

export function frameAround(ids) {
  const items = ids.map(getItem).filter(i => i && i.type !== 'connector');
  if (!items.length) return null;
  const pad = 40;
  const minX = Math.min(...items.map(i => i.x)) - pad, minY = Math.min(...items.map(i => i.y)) - pad;
  const maxX = Math.max(...items.map(i => i.x + (i.width || 100))) + pad;
  const maxY = Math.max(...items.map(i => i.y + (i.height || 30))) + pad;
  history.pushState(snapshot());
  const frame = normalizeItem({ id: generateId(), type: 'frame', x: minX, y: minY, width: maxX - minX, height: maxY - minY, content: 'Cadre' });
  for (const i of items) if (i.type !== 'frame' && !i.locked) i.parent = frame.id;
  board.items.unshift(frame);
  selected = [frame.id];
  notify();
  announce(`Cadre créé autour de ${plural(items.length, '1 élément', 'éléments')}`);
  return frame;
}

export function getItemAriaLabel(item) {
  if (!item) return '';
  const base = getItemLabel(item);
  const parts = [base];
  if (item.type !== 'connector') {
    parts.push(`position ${item.x}, ${item.y}`);
    if (item.width && item.height) {
      parts.push(`taille ${item.width} par ${item.height}`);
    }
  }
  const connectors = board.items.filter(
    c => c.type === 'connector' && (c.startId === item.id || c.endId === item.id)
  );
  for (const c of connectors) {
    const otherId = c.startId === item.id ? c.endId : c.startId;
    const other = getItem(otherId);
    if (other) {
      parts.push(`relie a ${getItemLabel(other)}`);
    }
  }
  if (item.parent) {
    const parent = getItem(item.parent);
    if (parent) {
      parts.push(`dans ${getItemLabel(parent)}`);
    }
  }
  return parts.join(', ');
}

export function addItem(item) {
  history.pushState(snapshot());
  item.id = generateId();
  board.items.push(normalizeItem(item));
  selected = [item.id];
  notify();
  return item;
}

export function updateItem(id, changes, record = true) {
  if (isLocked(id)) return null;
  const item = board.items.find(i => i.id === id);
  if (!item) return null;
  if (record) history.pushState(snapshot());
  Object.assign(item, changes);
  notify();
  return item;
}

export function moveItem(id, dx, dy) {
  moveItems([id], dx, dy);
}

export function moveItems(ids, dx, dy) {
  const items = editable(ids).filter(i => i.type !== 'connector');
  if (!items.length) return;
  history.pushState(snapshot());
  for (const item of items) {
    item.x = Math.round(item.x + dx);
    item.y = Math.round(item.y + dy);
  }
  notify();
  announce(items.length === 1 ? `Déplacé en ${items[0].x}, ${items[0].y}` : `${items.length} éléments déplacés`);
}

export function removeItem(id) {
  removeItems([id]);
}

export function removeItems(ids) {
  const blocked = id => board.items.some(i => i.locked && i.type === 'connector' && (i.startId === id || i.endId === id));
  const items = editable(ids).filter(i => i.type === 'connector' || !blocked(i.id));
  if (!items.length) {
    if (ids.some(blocked)) announce('Élément verrouillé : lien associé');
    return;
  }
  const gone = new Set(items.map(i => i.id));
  const label = items.length === 1 ? getItemLabel(items[0]) : `${items.length} éléments`;
  history.pushState(snapshot());
  board.items = board.items.filter(i => !gone.has(i.id) && !(i.type === 'connector' && (gone.has(i.startId) || gone.has(i.endId))));
  for (const i of board.items) {
    if (gone.has(i.parent)) i.parent = null;
  }
  notify();
  announce(`${label} supprimé${items.length > 1 ? 's' : ''}, annuler possible`);
}

export function undo() {
  const prev = history.undo(snapshot());
  if (!prev) return false;
  board = prev;
  selected = [];
  syncNextId();
  notify();
  announce('Action annulée');
  return true;
}

export function redo() {
  const next = history.redo(snapshot());
  if (!next) return false;
  board = next;
  selected = [];
  syncNextId();
  notify();
  announce('Action rétablie');
  return true;
}

export function canUndo() {
  return history.canUndo();
}

export function canRedo() {
  return history.canRedo();
}

function syncNextId() {
  let maxId = 0;
  for (const item of board.items) {
    const num = parseInt(item.id.replace('item-', ''), 10);
    if (!isNaN(num) && num > maxId) maxId = num;
  }
  nextId = maxId + 1;
}

export function loadBoard(data) {
  history.clear();
  board = data;
  if (!board.items) board.items = [];
  if (!board.name) board.name = 'Nouveau tableau';
  board.items.forEach(normalizeItem);
  syncNextId();
  selected = [];
  notify();
}

export function getSnapshot() {
  return snapshot();
}

export function getNonConnectorItems() {
  return board.items.filter(i => i.type !== 'connector');
}

export function getFrames() {
  return board.items.filter(i => i.type === 'frame');
}

export function getConnectors() {
  return board.items.filter(i => i.type === 'connector');
}

export function getChildrenOf(frameId) {
  return board.items.filter(i => i.parent === frameId && i.type !== 'connector');
}

export function getOrphanItems() {
  return board.items.filter(i => !i.parent && i.type !== 'frame' && i.type !== 'connector');
}
