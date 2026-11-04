import * as history from './store/history.js';
import { announce } from './a11y/announcer.js';

const COLORS = {
  yellow: 'Jaune',
  blue: 'Bleu',
  green: 'Vert',
  pink: 'Rose',
  orange: 'Orange',
  purple: 'Violet',
  gray: 'Gris'
};

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

export function getItemLabel(item) {
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
    return `${typeName} de ${startLabel} vers ${endLabel}${labelPart}`;
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
  history.pushState(snapshot());
  const item = board.items.find(i => i.id === id);
  if (!item) return null;
  Object.assign(item, changes);
  notify();
  return item;
}

export function moveItem(id, dx, dy) {
  const item = board.items.find(i => i.id === id);
  if (!item || item.type === 'connector') return;
  history.pushState(snapshot());
  item.x = Math.round(item.x + dx);
  item.y = Math.round(item.y + dy);
  notify();
  announce(`Déplacé en ${item.x}, ${item.y}`);
}

export function removeItem(id) {
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
