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
let selectedId = null;
let nextId = 1;
const listeners = new Set();

function generateId() {
  return 'item-' + (nextId++);
}

function snapshot() {
  return JSON.parse(JSON.stringify(board));
}

function notify() {
  for (const fn of listeners) {
    try { fn(board, selectedId); } catch (e) { console.error(e); }
  }
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
  return selectedId;
}

export function setSelectedId(id) {
  selectedId = id;
  notify();
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

export function duplicateItem(id) {
  const item = getItem(id);
  if (!item) return;
  const copy = JSON.parse(JSON.stringify(item));
  copy.x = (copy.x || 0) + 20;
  copy.y = (copy.y || 0) + 20;
  copy.locked = false;
  const result = addItem(copy);
  announce('Élément dupliqué');
  return result;
}

export function toggleLocked(id) {
  const item = getItem(id);
  if (!item) return;
  history.pushState(snapshot());
  item.locked = !item.locked;
  notify();
  announce(item.locked ? 'Élément verrouillé' : 'Élément déverrouillé');
}

export function reorderItem(id, front) {
  const item = getItem(id);
  if (!item || isLocked(id)) return;
  history.pushState(snapshot());
  board.items = board.items.filter(i => i.id !== id);
  if (front) board.items.push(item); else board.items.unshift(item);
  notify();
  announce(front ? 'Élément au premier plan' : 'Élément à l’arrière-plan');
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
  board.items.push(item);
  selectedId = item.id;
  notify();
  return item;
}

export function updateItem(id, changes) {
  if (isLocked(id)) return null;
  history.pushState(snapshot());
  const item = board.items.find(i => i.id === id);
  if (!item) return null;
  Object.assign(item, changes);
  notify();
  return item;
}

export function moveItem(id, dx, dy) {
  const item = board.items.find(i => i.id === id);
  if (!item || item.type === 'connector' || isLocked(id)) return;
  history.pushState(snapshot());
  item.x = Math.round(item.x + dx);
  item.y = Math.round(item.y + dy);
  notify();
  announce(`Déplacé en ${item.x}, ${item.y}`);
}

export function removeItem(id) {
  if (isLocked(id)) return;
  if (board.items.some(i => i.locked && i.type === 'connector' && (i.startId === id || i.endId === id))) { announce('Élément verrouillé : lien associé'); return; }
  const item = board.items.find(i => i.id === id);
  if (!item) return;
  const label = getItemLabel(item);
  history.pushState(snapshot());
  board.items = board.items.filter(i => {
    if (i.id === id) return false;
    if (i.type === 'connector' && (i.startId === id || i.endId === id)) return false;
    return true;
  });
  for (const i of board.items) {
    if (i.parent === id) i.parent = null;
  }
  if (selectedId === id) selectedId = null;
  notify();
  announce(`${label} supprimé, annuler possible`);
}

export function undo() {
  const prev = history.undo(snapshot());
  if (!prev) return false;
  board = prev;
  selectedId = null;
  syncNextId();
  notify();
  announce('Action annulée');
  return true;
}

export function redo() {
  const next = history.redo(snapshot());
  if (!next) return false;
  board = next;
  selectedId = null;
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
  for (const item of board.items) {
    if (item.type === 'sticky_note') item.color = LEGACY_COLORS[item.color] || item.color || 'light_yellow';
    if (item.type === 'connector') item.lineType = item.lineType || 'arrow';
  }
  syncNextId();
  selectedId = null;
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
