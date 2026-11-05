import * as history from './store/history.js';
import { announce } from './a11y/announcer.js';
import * as O from './objects.js';
import * as L from './lines.js';

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
export const LINE_TYPES = L.LINE_TYPES;
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
  connector: 'Ligne',
  drawing: 'Dessin à main levée',
  comment: 'Commentaire',
  mindmap: 'Carte mentale',
  kanban: 'Kanban',
  datatable: 'Tableau de données',
  code: 'Bloc de code',
  flipcard: 'Carte recto-verso'
};

let board = { name: 'Nouveau tableau', items: [] };
let selected = [];
let nextId = 1;
const listeners = new Set();

export const STICKY_SIZES = { s: 100, m: 150, l: 220 };
export const SIZE_NAMES = { s: 'petit', m: 'moyen', l: 'grand' };
export const ALIGN_NAMES = { left: 'à gauche', center: 'au centre', right: 'à droite' };
const DEFAULT_FONT = { text: 16, card: 13, code: 13, mindmap: 14, flipcard: 'auto' };
const AUTHOR_KEY = 'tableau-accessible-auteur';

function generateId() {
  return 'item-' + (nextId++);
}

function snapshot() {
  return JSON.parse(JSON.stringify(board));
}

function notify() {
  syncDerived();
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
  if (item.type === 'connector') L.normalizeLine(item);
  else {
    if (item.fontSize === undefined) item.fontSize = item.type === 'sticky_note' ? 'auto' : (DEFAULT_FONT[item.type] || 14);
    if (item.bold === undefined) item.bold = false;
    if (!item.align) item.align = ['sticky_note', 'shape', 'flipcard', 'mindmap'].includes(item.type) ? 'center' : 'left';
  }
  if (item.type === 'drawing') {
    item.points = Array.isArray(item.points) ? item.points : [];
    item.stroke = item.stroke || 'ink';
    item.strokeWidth = item.strokeWidth || 4;
    item.vw = item.vw || item.width || 1;
    item.vh = item.vh || item.height || 1;
  }
  const base = O.defaults(item.type);
  for (const [k, v] of Object.entries(base)) if (item[k] === undefined) item[k] = JSON.parse(JSON.stringify(v));
  if (item.type === 'mindmap' && item.parentNode) { item.width = O.MM.w; item.height = O.MM.h; }
  return item;
}

export function syncDerived() {
  for (const item of board.items) {
    if (item.type === 'kanban') Object.assign(item, O.kanbanSize(item));
    else if (item.type === 'datatable') Object.assign(item, O.tableSize(item));
    else if (item.type === 'comment' && item.targetId) {
      const t = getItem(item.targetId);
      if (t) { item.x = Math.round(t.x + (t.width || 100) - 14); item.y = Math.round(t.y - 14); }
    }
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
    const labelPart = item.label ? ` (${item.label})` : '';
    if (L.isFree(item)) return `Ligne libre de ${getEndLabel(item, 'start')} à ${getEndLabel(item, 'end')}${labelPart}`;
    const kind = item.endCap && item.endCap !== 'none' && item.endCap.startsWith('arrow') ? 'Flèche' : 'Ligne';
    const shape = item.lineType === 'orthogonal' ? ' à angles droits' : item.lineType === 'bezier' ? ' courbe' : '';
    return `${kind}${shape} de ${getEndLabel(item, 'start')} vers ${getEndLabel(item, 'end')}${labelPart}`;
  }
  if (item.type === 'card') {
    return `${typeName} : ${item.title || '(sans titre)'}`;
  }
  if (item.type === 'frame') {
    const children = board.items.filter(i => i.parent === item.id);
    return `${typeName} : ${item.content || '(sans nom)'}, ${children.length} élément(s)`;
  }
  if (item.type === 'drawing') return item.content ? `${typeName} : ${item.content}` : typeName;
  if (item.type === 'comment') {
    const n = item.messages.length;
    const first = item.messages[0];
    const target = getItem(item.targetId);
    return `${typeName}${first ? ` de ${first.author} : « ${first.text} »` : ' (sans message)'}, ${plural(n, '1 message', 'messages')}, ${item.resolved ? 'résolu' : 'non résolu'}${target ? `, sur ${itemLabel(target)}` : ''}`;
  }
  if (item.type === 'mindmap') {
    const kids = mindChildren(item.id).length;
    if (!item.parentNode) return `${typeName} : ${item.content || '(vide)'}, ${plural(mindDescendants(item.id).length + 1, '1 nœud', 'nœuds')}`;
    return `Nœud : ${item.content || '(vide)'}, niveau ${mindLevel(item) + 1}, ${plural(kids, '1 enfant', 'enfants')}${kids && item.collapsed ? ', replié' : ''}`;
  }
  if (item.type === 'kanban') {
    const cards = item.columns.reduce((n, c) => n + c.cards.length, 0);
    return `${typeName} : ${item.content || '(sans titre)'}, ${plural(item.columns.length, '1 colonne', 'colonnes')}, ${plural(cards, '1 carte', 'cartes')}`;
  }
  if (item.type === 'datatable') {
    return `${typeName} : ${item.content || '(sans titre)'}, ${plural(item.rows.length - 1, '1 ligne', 'lignes')}, ${plural(item.rows[0]?.length || 0, '1 colonne', 'colonnes')}`;
  }
  if (item.type === 'code') {
    const lines = (item.content || '').split('\n');
    return `${typeName} ${O.LANGUAGES[item.language] || ''} : ${lines[0] || '(vide)'}${item.content ? `, ${plural(lines.length, '1 ligne', 'lignes')}` : ''}`;
  }
  if (item.type === 'flipcard') {
    const face = item.flipped ? item.back : item.content;
    return `${typeName}, ${item.flipped ? 'verso' : 'recto'} visible : ${face || '(vide)'}`;
  }
  return `${typeName} : ${item.content || '(vide)'}`;
}

export function getEndLabel(item, end) {
  const target = getItem(item[`${end}Id`]);
  if (target) return itemLabel(target);
  const p = item[end];
  return p ? `(${p.x}, ${p.y})` : '?';
}

function lineDetails(item) {
  const parts = [];
  if (L.isFree(item) && item.lineType !== 'straight') parts.push(`type ${L.LINE_TYPES[item.lineType].toLowerCase()}`);
  if (item.startCap !== 'none') parts.push(`début : ${L.CAPS[item.startCap]?.toLowerCase()}`);
  if (item.endCap !== 'none') parts.push(`fin : ${L.CAPS[item.endCap]?.toLowerCase()}`);
  if (item.lineStyle !== 'solid') parts.push(`trait : ${L.LINE_STYLES[item.lineStyle]?.toLowerCase()}`);
  if (item.strokeWidth !== 2) parts.push(`épaisseur ${item.strokeWidth}`);
  if (item.stroke !== 'auto') parts.push(`couleur : ${L.LINE_COLORS.find(c => c[0] === item.stroke)?.[1].toLowerCase()}`);
  if (item.waypoints?.length) parts.push(plural(item.waypoints.length, '1 point de pliage', 'points de pliage'));
  return parts;
}

function decorations(item) {
  let out = '';
  const tags = (item.tags || []).map(getTag).filter(Boolean);
  if (tags.length) out += `, étiquettes : ${tags.map(t => t.name).join(', ')}`;
  const reacts = O.REACTIONS.filter(([e]) => item.reactions?.[e]?.length).map(([e, name]) => `${e} ${name} ${item.reactions[e].length}`);
  if (reacts.length) out += `, réactions : ${reacts.join(', ')}`;
  return out;
}

export function getItemLabel(item) {
  if (!item) return '';
  return itemLabel(item) + decorations(item) + (item.locked ? ' — 🔒 Élément verrouillé' : '');
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
  if (!sources.length) return [];
  const copies = pasteItems(sources, 20, false).filter(isSelectableCopy);
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
  const groups = new Map();
  for (const copy of copies) {
    if (copy.parent) copy.parent = map.get(copy.parent) || (getItem(copy.parent) ? copy.parent : null);
    if (copy.parentNode) copy.parentNode = map.get(copy.parentNode) || null;
    if (copy.targetId) copy.targetId = map.get(copy.targetId) || null;
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, O.uid('group'));
      copy.groupId = groups.get(copy.groupId);
    }
  }
  for (const original of source) {
    if (original.type !== 'connector') continue;
    if ((original.startId && !map.has(original.startId)) || (original.endId && !map.has(original.endId))) continue;
    const link = L.normalizeLine(JSON.parse(JSON.stringify(original)));
    link.id = generateId();
    link.locked = false;
    for (const end of ['start', 'end']) {
      if (link[`${end}Id`]) link[`${end}Id`] = map.get(link[`${end}Id`]);
      else if (link[end]) link[end] = { x: link[end].x + offset, y: link[end].y + offset };
    }
    link.waypoints = link.waypoints.map(w => ({ x: w.x + offset, y: w.y + offset }));
    copies.push(link);
  }
  board.items.push(...copies);
  for (const copy of copies) if (copy.type === 'mindmap' && !copy.parentNode) layoutMind(copy.id);
  selected = copies.filter(isSelectableCopy).map(c => c.id);
  notify();
  if (speak) announce(`${plural(selected.length, '1 élément collé', 'éléments collés')}`);
  return copies;
}

function isSelectableCopy(c) {
  return c.type !== 'connector' || !(c.startId && c.endId);
}

export function collectForCopy(ids) {
  const explicit = new Set(ids);
  const set = new Set(withMindTrees(ids, false).filter(id => getItem(id)?.type !== 'connector'));
  return board.items
    .filter(i => set.has(i.id) || (i.type === 'connector' && (explicit.has(i.id) || (set.has(i.startId) && set.has(i.endId)))))
    .map(i => {
      const copy = JSON.parse(JSON.stringify(i));
      if (i.type === 'connector') {
        for (const end of ['start', 'end']) {
          if (copy[`${end}Id`] && !set.has(copy[`${end}Id`])) L.setEnd(copy, end, L.anchorOf(i, end, getItem) || { x: 0, y: 0 });
        }
      }
      return copy;
    });
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
  if (item.type === 'connector') parts.push(...lineDetails(item));
  else {
    parts.push(`position ${item.x}, ${item.y}`);
    if (item.width && item.height) {
      parts.push(`taille ${item.width} par ${item.height}`);
    }
  }
  const connectors = board.items.filter(
    c => c.type === 'connector' && (c.startId === item.id || c.endId === item.id)
  );
  for (const c of connectors) {
    parts.push(`relié à ${getEndLabel(c, c.startId === item.id ? 'end' : 'start')}`);
  }
  if (item.parent) {
    const parent = getItem(item.parent);
    if (parent) {
      parts.push(`dans ${getItemLabel(parent)}`);
    }
  }
  if (item.groupId) parts.push(`dans un groupe de ${board.items.filter(i => i.groupId === item.groupId).length} éléments`);
  const notes = board.items.filter(c => c.type === 'comment' && c.targetId === item.id).length;
  if (notes) parts.push(plural(notes, '1 commentaire', 'commentaires'));
  if (item.type === 'drawing') parts.push(`trait ${O.nameOf(O.PEN_COLORS, item.stroke).toLowerCase()}, ${(O.PEN_WIDTHS.find(w => w[0] === item.strokeWidth) || [0, 'moyen'])[1].toLowerCase()}`);
  if (HINTS[item.type]) parts.push(HINTS[item.type]);
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
  const items = editable(withMindTrees(ids, true)).filter(isMovable);
  if (!items.length) return;
  history.pushState(snapshot());
  const objects = items.filter(i => i.type !== 'connector');
  const moving = new Set(objects.map(i => i.id));
  let detached = false;
  for (const line of items.filter(i => i.type === 'connector')) detached = L.shiftLine(line, dx, dy, moving, getItem) || detached;
  shiftFollowers(moving, new Set(items.map(i => i.id)), dx, dy);
  for (const item of objects) {
    item.x = Math.round(item.x + dx);
    item.y = Math.round(item.y + dy);
  }
  notify();
  if (items.length > 1) announce(`${items.length} éléments déplacés`);
  else if (objects.length) announce(`Déplacé en ${items[0].x}, ${items[0].y}`);
  else announce(`Ligne ${detached ? 'détachée et ' : ''}déplacée : ${getItemLabel(items[0])}`);
}

function shiftFollowers(moving, skip, dx, dy) {
  for (const c of getConnectors()) {
    if (skip.has(c.id) || !c.waypoints?.length || !moving.has(c.startId) || !moving.has(c.endId)) continue;
    c.waypoints = c.waypoints.map(w => ({ x: Math.round(w.x + dx), y: Math.round(w.y + dy) }));
  }
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
  const gone = new Set(withMindTrees(items.map(i => i.id), false));
  const label = items.length === 1 ? getItemLabel(items[0]) : `${items.length} éléments`;
  history.pushState(snapshot());
  for (const c of getConnectors()) {
    if (gone.has(c.id)) continue;
    const ends = ['start', 'end'].filter(end => gone.has(c[`${end}Id`]));
    if (ends.length === 2) { gone.add(c.id); continue; }
    if (ends.length) L.setEnd(c, ends[0], L.anchorOf(c, ends[0], getItem) || { x: 0, y: 0 });
  }
  board.items = board.items.filter(i => !gone.has(i.id));
  for (const i of board.items) {
    if (gone.has(i.parent)) i.parent = null;
    if (gone.has(i.targetId)) i.targetId = null;
  }
  relayoutAll();
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
  if (!Array.isArray(board.tags)) board.tags = [];
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
  const frames = board.items.filter(i => i.type === 'frame');
  const order = Array.isArray(board.frameOrder) ? board.frameOrder : [];
  return [...frames.filter(f => order.includes(f.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)), ...frames.filter(f => !order.includes(f.id))];
}

export function getConnectors() {
  return board.items.filter(i => i.type === 'connector');
}

function isListed(i) {
  return i.type !== 'connector' && i.type !== 'comment' && !(i.type === 'mindmap' && i.parentNode);
}

export function getChildrenOf(frameId) {
  return board.items.filter(i => i.parent === frameId && isListed(i));
}

export function getOrphanItems() {
  return board.items.filter(i => !i.parent && i.type !== 'frame' && isListed(i));
}

export function getComments() {
  return board.items.filter(i => i.type === 'comment');
}

const HINTS = {
  kanban: 'Entrée pour parcourir les cartes',
  datatable: 'Entrée pour parcourir les cellules',
  mindmap: 'flèches pour parcourir la carte, F2 pour modifier',
  flipcard: 'Espace pour retourner',
  drawing: 'Entrée pour modifier l’étiquette',
  connector: 'flèches pour déplacer, Alt+flèches pour déplacer l’extrémité active, Entrée pour le texte, Alt+F10 pour la barre de mise en forme'
};

export function isMovable(i) {
  return i && !(i.type === 'comment' && i.targetId && getItem(i.targetId));
}

export function movableIds(ids) {
  return withMindTrees(ids, true).filter(id => { const i = getItem(id); return isMovable(i) && !i.locked; });
}

export function transact(fn, message) {
  history.pushState(snapshot());
  const result = fn({ newId: generateId });
  board.items.forEach(normalizeItem);
  notify();
  if (message) announce(typeof message === 'function' ? message(result) : message);
  return result;
}

export function mutateItem(id, fn, message) {
  if (!getItem(id) || isLocked(id)) return null;
  return transact(() => fn(getItem(id)), message);
}

export function getAuthor() {
  try { return localStorage.getItem(AUTHOR_KEY) || ''; } catch { return ''; }
}

export function setAuthor(name) {
  try { localStorage.setItem(AUTHOR_KEY, name); } catch { /* stockage indisponible */ }
}

/* Groupes */
export function groupMembers(id) {
  const g = getItem(id)?.groupId;
  return g ? board.items.filter(i => i.groupId === g).map(i => i.id) : [id];
}

export function groupItems(ids) {
  const items = ids.map(getItem).filter(i => i && i.type !== 'connector' && i.type !== 'comment');
  if (items.length < 2) { announce('Sélectionnez au moins deux éléments à grouper'); return; }
  transact(() => { const g = O.uid('group'); items.forEach(i => { i.groupId = g; }); }, `Groupe de ${items.length} éléments créé`);
}

export function ungroupItems(ids) {
  const gs = new Set(ids.map(getItem).filter(i => i?.groupId).map(i => i.groupId));
  if (!gs.size) { announce('Aucun groupe dans la sélection'); return; }
  transact(() => board.items.forEach(i => { if (gs.has(i.groupId)) delete i.groupId; }), gs.size === 1 ? 'Groupe dissous' : `${gs.size} groupes dissous`);
}

/* Carte mentale */
export function mindChildren(id) {
  return board.items.filter(i => i.type === 'mindmap' && i.parentNode === id);
}

export function mindDescendants(id) {
  const out = [];
  const walk = p => mindChildren(p).forEach(c => { out.push(c.id); walk(c.id); });
  walk(id);
  return out;
}

export function mindRoot(id) {
  let i = getItem(id);
  while (i?.parentNode && getItem(i.parentNode)) i = getItem(i.parentNode);
  return i;
}

function mindLevel(item) {
  let n = 0, p = getItem(item.parentNode);
  while (p) { n++; p = getItem(p.parentNode); }
  return n;
}

export function isMindHidden(item) {
  let p = getItem(item.parentNode);
  while (p) { if (p.collapsed) return true; p = getItem(p.parentNode); }
  return false;
}

function withMindTrees(ids, whole) {
  const out = new Set(ids);
  for (const id of ids) {
    const item = getItem(id);
    if (item?.type !== 'mindmap') continue;
    const start = whole ? mindRoot(id) : item;
    out.add(start.id);
    mindDescendants(start.id).forEach(d => out.add(d));
  }
  return [...out];
}

function layoutMind(rootId) {
  const root = getItem(rootId);
  if (!root) return;
  const visibleKids = n => (n.collapsed ? [] : mindChildren(n.id));
  const span = n => {
    const kids = visibleKids(n);
    if (!kids.length) return n.height;
    return Math.max(n.height, kids.reduce((s, k) => s + span(k), 0) + O.MM.gapY * (kids.length - 1));
  };
  const place = (n, x, top, h) => {
    n.x = Math.round(x);
    n.y = Math.round(top + (h - n.height) / 2);
    const kids = visibleKids(n);
    const total = kids.reduce((s, k) => s + span(k), 0) + O.MM.gapY * Math.max(0, kids.length - 1);
    let y = top + (h - total) / 2;
    for (const k of kids) {
      const hk = span(k);
      place(k, x + n.width + O.MM.gapX, y, hk);
      y += hk + O.MM.gapY;
    }
  };
  const h = span(root);
  place(root, root.x, root.y + root.height / 2 - h / 2, h);
}

function relayoutAll() {
  board.items.filter(i => i.type === 'mindmap' && i.parentNode && !getItem(i.parentNode)).forEach(i => { i.parentNode = null; });
  board.items.filter(i => i.type === 'mindmap' && !i.parentNode).forEach(r => layoutMind(r.id));
}

export function addMindNode(refId, asChild) {
  const ref = getItem(refId);
  if (ref?.type !== 'mindmap' || isLocked(refId)) return null;
  const parentId = asChild || !ref.parentNode ? ref.id : ref.parentNode;
  return transact(() => {
    const parentItem = getItem(parentId);
    parentItem.collapsed = false;
    const node = normalizeItem({ id: generateId(), type: 'mindmap', parentNode: parentId, content: '', x: ref.x, y: ref.y, parent: ref.parent || null });
    if (parentId === ref.id) board.items.push(node);
    else board.items.splice(board.items.indexOf(ref) + 1, 0, node);
    layoutMind(mindRoot(parentId).id);
    selected = [node.id];
    return node;
  });
}

export function setMindCollapsed(id, collapsed) {
  const item = getItem(id);
  if (item?.type !== 'mindmap' || !mindChildren(id).length || !!item.collapsed === collapsed) return false;
  transact(() => { item.collapsed = collapsed; layoutMind(mindRoot(id).id); }, collapsed ? 'Branche repliée' : 'Branche dépliée');
  return true;
}

/* Étiquettes */
export function getTags() {
  return board.tags || (board.tags = []);
}

export function getTag(id) {
  return getTags().find(t => t.id === id) || null;
}

export function createTag(name, color, ids = []) {
  const targets = ids.map(getItem).filter(i => i && O.TAG_TYPES.includes(i.type) && !i.locked);
  return transact(() => {
    const tag = { id: O.uid('tag'), name, color };
    getTags().push(tag);
    targets.forEach(i => { i.tags = [...(i.tags || []), tag.id]; });
    return tag;
  }, `Étiquette « ${name} » créée${targets.length ? ' et ajoutée' : ''}`);
}

export function toggleTag(ids, tagId) {
  const items = editable(ids).filter(i => O.TAG_TYPES.includes(i.type));
  const tag = getTag(tagId);
  if (!items.length || !tag) return;
  const on = !items.every(i => i.tags?.includes(tagId));
  transact(() => items.forEach(i => { i.tags = on ? [...new Set([...(i.tags || []), tagId])] : (i.tags || []).filter(t => t !== tagId); }),
    `Étiquette « ${tag.name} » ${on ? 'ajoutée' : 'retirée'}`);
}

/* Réactions */
export function toggleReaction(ids, emoji) {
  const items = ids.map(getItem).filter(i => i && i.type !== 'connector' && i.type !== 'comment');
  if (!items.length) return;
  const me = getAuthor() || 'Moi';
  const on = !items.every(i => i.reactions?.[emoji]?.includes(me));
  const name = (O.REACTIONS.find(r => r[0] === emoji) || [])[1];
  transact(() => items.forEach(i => {
    const r = i.reactions = { ...(i.reactions || {}) };
    const list = (r[emoji] || []).filter(a => a !== me);
    if (on) list.push(me);
    if (list.length) r[emoji] = list; else delete r[emoji];
  }), () => `Réaction ${name} ${on ? 'ajoutée' : 'retirée'}, ${getItem(items[0].id)?.reactions?.[emoji]?.length || 0} au total`);
}

/* Commentaires */
export function postMessage(id, text) {
  const author = getAuthor() || 'Anonyme';
  return transact(() => { getItem(id).messages.push({ author, date: new Date().toISOString(), text }); }, 'Message publié');
}

export function setResolved(id, resolved) {
  return transact(() => { getItem(id).resolved = resolved; }, resolved ? 'Commentaire résolu' : 'Commentaire rouvert');
}

/* Lignes */
const END_WORDS = { start: ['Début', ''], end: ['Fin', 'e'] };

export function reverseLines(ids) {
  const lines = editable(ids).filter(i => i.type === 'connector');
  if (lines.length) transact(() => lines.forEach(L.reverseLine), 'Extrémités inversées');
}

export function moveLineEnd(id, end, dx, dy) {
  const item = getItem(id);
  if (!item || isLocked(id)) return;
  const at = L.anchorOf(item, end, getItem);
  if (!at) return;
  const was = L.isAttached(item, end);
  const [word, e] = END_WORDS[end];
  transact(() => L.setEnd(item, end, { x: at.x + dx, y: at.y + dy }), `${word} ${was ? `détaché${e} et ` : ''}déplacé${e} en (${at.x + dx}, ${at.y + dy})`);
}

export function endChangeMessage(item, end, wasAttached) {
  const [word, e] = END_WORDS[end];
  if (item[`${end}Id`]) return `${word} accroché${e} à ${getEndLabel(item, end)}`;
  return `${word} ${wasAttached ? 'détaché' : 'déplacé'}${e} en ${getEndLabel(item, end)}`;
}

export function removeWaypoint(id, index) {
  const item = getItem(id);
  if (!item?.waypoints?.[index] || isLocked(id)) return;
  transact(() => { item.waypoints.splice(index, 1); }, 'Point de pliage supprimé');
}

export function getContentSummary(item) {
  switch (item.type) {
    case 'connector': return getItemLabel(item);
    case 'card': return item.title || '';
    case 'kanban': return item.columns.map(c => `${c.name} : ${c.cards.map(k => k.text || '(vide)').join(', ') || '—'}`).join(' ; ');
    case 'datatable': return item.rows.map(r => r.join(' | ')).join(' / ');
    case 'flipcard': return `Recto : ${item.content || '(vide)'} / Verso : ${item.back || '(vide)'}`;
    case 'comment': return item.messages.map(m => `${m.author} : ${m.text}`).join(' / ');
    default: return item.content || '';
  }
}

export function moveFrame(id, direction) {
  const ids = getFrames().map(f => f.id);
  const from = ids.indexOf(id), to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return;
  history.pushState(snapshot());
  [ids[from], ids[to]] = [ids[to], ids[from]];
  board.frameOrder = ids;
  notify();
}
