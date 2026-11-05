import * as state from '../state.js';
import * as history from '../store/history.js';
import { announce } from '../a11y/announcer.js';
import * as O from '../objects.js';
import * as obj from './canvas-objects.js';
import * as L from '../lines.js';
import { iconSvg } from '../ui/icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BASE_W = 2000;
const BASE_H = 1500;
const SMALL_STEP = 10;
const LARGE_STEP = 50;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const LINK_BLUE = '#3859ff';
const TOOL_SIZES = {
  sticky_note: [150, 150], text: [200, 30], 'shape:rectangle': [120, 80], 'shape:circle': [100, 100], 'shape:diamond': [120, 100], 'shape:triangle': [120, 100], line: [200, 20], card: [200, 120], frame: [400, 300],
  comment: [28, 28], mindmap: [170, 56], kanban: [548, 116], datatable: [360, 118], code: [320, 180], flipcard: [220, 140]
};
export const TOOL_NAMES = {
  select: 'Sélection', hand: 'Main', sticky_note: 'Post-it', text: 'Texte', 'shape:rectangle': 'Rectangle', 'shape:circle': 'Cercle', 'shape:diamond': 'Losange', 'shape:triangle': 'Triangle', line: 'Ligne', card: 'Carte', frame: 'Cadre',
  pen: 'Stylo', eraser: 'Gomme', comment: 'Commentaire', mindmap: 'Carte mentale', kanban: 'Kanban', datatable: 'Tableau de données', code: 'Bloc de code', flipcard: 'Carte recto-verso'
};
const DRAW_TOOLS = ['pen', 'eraser'];

let svg = null;
let itemsGroup = null;
let overlay = null;
let zoom = 1;
let panX = 0;
let panY = 0;
let panState = null;
let focusedIndex = -1;
let dragState = null;
let resizeState = null;
let linkState = null;
let lineDraft = null;
let lineDrag = null;
let activeEnd = 'end';
let marquee = null;
let pendingCreate = null;
let lastDownId = null;
let spaceDown = false;
let editingId = null;
let tool = 'select';
let stickyColor = 'light_yellow';
let penColor = 'ink';
let penWidth = 4;
let penState = null;
let eraseState = null;
let cardDrag = null;
let enteredGroup = null;
let mapMode = null;
let lastSub = {};
let container = null;
let fontFamily = 'sans-serif';
const viewListeners = new Set();
const toolListeners = new Set();
const measureCtx = document.createElement('canvas').getContext('2d');

export function init(el) {
  container = el;
  svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', 'Canevas du tableau blanc. Utilisez Tab pour naviguer entre les éléments, flèches pour déplacer les éléments ou la vue sans sélection, Maj pour un plus grand pas, Entrée pour modifier le texte, Suppr pour supprimer.');
  svg.setAttribute('tabindex', '0');
  svg.classList.add('canvas-svg');
  svg.dataset.tool = 'select';

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = buildDefs();
  svg.appendChild(defs);

  const grid = document.createElementNS(SVG_NS, 'rect');
  grid.setAttribute('x', '-50000');
  grid.setAttribute('y', '-50000');
  grid.setAttribute('width', '100000');
  grid.setAttribute('height', '100000');
  grid.setAttribute('fill', 'url(#grid)');
  grid.classList.add('canvas-grid');
  svg.appendChild(grid);

  itemsGroup = document.createElementNS(SVG_NS, 'g');
  itemsGroup.setAttribute('id', 'canvas-items');
  svg.appendChild(itemsGroup);

  overlay = document.createElementNS(SVG_NS, 'g');
  overlay.setAttribute('id', 'canvas-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  svg.appendChild(overlay);

  el.appendChild(svg);
  fontFamily = getComputedStyle(svg).fontFamily || 'sans-serif';
  updateViewBox();

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('dblclick', onDoubleClick);
  svg.addEventListener('keydown', onKeyDown);
  svg.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onSpace);
  document.addEventListener('keyup', onSpace);
  window.addEventListener('blur', () => { spaceDown = false; svg.classList.remove('space-pan'); });
  new ResizeObserver(() => updateViewBox()).observe(svg);

  state.subscribe(() => render());
}

export function onView(fn) {
  viewListeners.add(fn);
}

function emitView() {
  for (const fn of viewListeners) fn();
}

export function onToolChange(fn) {
  toolListeners.add(fn);
}

export function getTool() {
  return tool;
}

export function isCreationTool(t = tool) {
  return t !== 'select' && t !== 'hand' && !DRAW_TOOLS.includes(t);
}

export function setPen(color, width) {
  if (color) penColor = color;
  if (width) penWidth = width;
}

export function setTool(t) {
  if (!svg) return;
  tool = t;
  svg.dataset.tool = t.split(':')[0];
  for (const fn of toolListeners) fn(t);
}

export function getStickyColor() {
  return stickyColor;
}

export function setStickyColor(c) {
  stickyColor = c;
}

function buildDefs() {
  return `
    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="var(--grid-color)" stroke-width="0.5"/>
    </pattern>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="var(--fg)">
      <polygon points="0 0, 10 3.5, 0 7"/>
    </marker>
  `;
}

function viewSize() {
  const w = svg?.clientWidth || BASE_W;
  const h = svg?.clientHeight || BASE_H;
  return { w: w / zoom, h: h / zoom };
}

function updateViewBox() {
  if (!svg) return;
  const { w, h } = viewSize();
  svg.setAttribute('viewBox', `${panX} ${panY} ${w} ${h}`);
  const label = document.getElementById('btn-zoom-reset');
  if (label) label.textContent = `${Math.round(zoom * 100)} %`;
  renderOverlay();
  emitView();
}

function zoomAt(factor, cx, cy) {
  const before = viewSize();
  const fx = cx === undefined ? 0.5 : (cx - panX) / before.w;
  const fy = cy === undefined ? 0.5 : (cy - panY) / before.h;
  const px = panX + before.w * fx;
  const py = panY + before.h * fy;
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  const after = viewSize();
  panX = px - after.w * fx;
  panY = py - after.h * fy;
  updateViewBox();
}

export function panBy(dx, dy) {
  panX += dx / zoom;
  panY += dy / zoom;
  updateViewBox();
}

export function zoomToFit() {
  const boxes = state.getItems().map(itemBox).filter(b => b.w || b.h);
  if (!svg || !boxes.length || !svg.clientWidth) { zoomReset(); return; }
  const minX = Math.min(...boxes.map(b => b.x));
  const minY = Math.min(...boxes.map(b => b.y));
  const maxX = Math.max(...boxes.map(b => b.x + b.w));
  const maxY = Math.max(...boxes.map(b => b.y + b.h));
  const pad = 40;
  const z = Math.min(svg.clientWidth / (maxX - minX + pad * 2), svg.clientHeight / (maxY - minY + pad * 2));
  zoom = Math.min(1.5, Math.max(MIN_ZOOM, z));
  const { w, h } = viewSize();
  panX = (minX + maxX) / 2 - w / 2;
  panY = (minY + maxY) / 2 - h / 2;
  updateViewBox();
  announce(`Vue ajustée au contenu, zoom ${Math.round(zoom * 100)} %`);
}

export function zoomIn() {
  zoomAt(1.25);
  announce(`Zoom ${Math.round(zoom * 100)} %`);
}

export function zoomOut() {
  zoomAt(1 / 1.25);
  announce(`Zoom ${Math.round(zoom * 100)} %`);
}

export function zoomReset() {
  zoom = 1;
  panX = 0;
  panY = 0;
  updateViewBox();
  announce('Zoom réinitialisé à 100 %');
}

export function getZoom() {
  return zoom;
}

function applyBackground() {
  const entry = O.BOARD_BACKGROUNDS.find(b => b[0] === state.getBoard().background);
  svg.style.background = entry?.[2] || '';
  container.classList.toggle('on-light', entry?.[3] === 'light');
  container.classList.toggle('on-dark', entry?.[3] === 'dark');
}

export function render() {
  if (!itemsGroup) return;
  applyBackground();
  state.syncDerived();
  const activeId = document.activeElement?.closest('.canvas-item')?.getAttribute('data-id');
  const activeSub = document.activeElement?.dataset?.sub;
  itemsGroup.innerHTML = '';
  const multi = state.getSelectedIds().length > 1;

  state.getItems().forEach((item, idx) => {
    if (item.type === 'mindmap' && state.isMindHidden(item)) return;
    const g = renderItem(item, idx);
    if (!g) return;
    if (state.isSelected(item.id)) {
      g.classList.add('selected');
      if (multi) g.setAttribute('aria-label', 'Sélectionné, ' + g.getAttribute('aria-label'));
    }
    if (item.id === editingId) g.classList.add('is-editing');
    itemsGroup.appendChild(g);
  });

  updateFocusableItems();
  if (activeId) {
    const g = itemsGroup.querySelector(`[data-id="${activeId}"]`);
    ((activeSub && g?.querySelector(`[data-sub="${CSS.escape(activeSub)}"]`)) || g)?.focus({ preventScroll: true });
  }
  renderOverlay();
  emitView();
}

export function setEditing(id) {
  editingId = id;
  render();
}

function renderItem(item, index) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', state.getItemAriaLabel(item));
  g.setAttribute('data-id', item.id);
  g.setAttribute('data-index', index);
  g.classList.add('canvas-item', `type-${item.type}`);

  switch (item.type) {
    case 'sticky_note': renderStickyNote(g, item); break;
    case 'shape': renderShape(g, item); break;
    case 'text': renderText(g, item); break;
    case 'card': renderCard(g, item); break;
    case 'frame': renderFrame(g, item); break;
    case 'connector': renderConnector(g, item); break;
    case 'drawing': obj.renderDrawing(g, item); break;
    case 'comment': obj.renderComment(g, item); break;
    case 'mindmap': obj.renderMindmap(g, item); break;
    case 'kanban': obj.renderKanban(g, item); break;
    case 'datatable': obj.renderDatatable(g, item); break;
    case 'code': obj.renderCode(g, item); break;
    case 'flipcard': obj.renderFlipcard(g, item); break;
    default: return null;
  }
  if (item.type !== 'connector') obj.renderDecorations(g, item, itemBox(item));

  if (item.locked) {
    const lockBox = itemBox(item);
    const icon = document.createElementNS(SVG_NS, 'g');
    icon.setAttribute('class', 'canvas-lock-icon');
    icon.setAttribute('transform', `translate(${lockBox.x} ${lockBox.y + lockBox.h + 3}) scale(.22)`);
    const parsed = new DOMParser().parseFromString(iconSvg('lock'), 'image/svg+xml').documentElement;
    for (const child of [...parsed.children]) icon.appendChild(document.importNode(child, true));
    const badge = document.createElementNS(SVG_NS, 'text');
    badge.setAttribute('x', lockBox.x + 18);
    badge.setAttribute('y', lockBox.y + lockBox.h + 18);
    badge.setAttribute('fill', 'var(--fg)');
    badge.setAttribute('font-size', '14');
    badge.textContent = 'Verrouillé';
    g.append(icon, badge);
  }
  return g;
}

function measure(text, fs, bold) {
  measureCtx.font = `${bold ? 'bold ' : ''}${fs}px ${fontFamily}`;
  return measureCtx.measureText(text).width;
}

export function measureText(text, fs) {
  return measure(text, fs, false);
}

export function wrapText(text, maxW, fs) {
  return wrap(text, maxW, fs, false);
}

function wrap(text, maxW, fs, bold) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (measure(test, fs, bold) <= maxW) { line = test; continue; }
      if (line) lines.push(line);
      while (word.length > 1 && measure(word, fs, bold) > maxW) {
        let n = word.length - 1;
        while (n > 1 && measure(word.slice(0, n), fs, bold) > maxW) n--;
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      line = word;
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

export function textBox(item) {
  const { x, y } = item;
  const w = item.width || 150, h = item.height || 100;
  const tagH = item.tags?.length && O.TAG_TYPES.includes(item.type) ? 24 : 0;
  switch (item.type) {
    case 'sticky_note': return { x: x + 10, y: y + 22, w: w - 20, h: h - 30 - tagH, valign: 'middle' };
    case 'mindmap': return { x: x + 10, y: y + 4, w: w - 20 - (state.mindChildren(item.id).length ? 22 : 0), h: h - 8, valign: 'middle' };
    case 'flipcard': return { x: x + 12, y: y + 34, w: w - 24, h: h - 42, valign: 'middle' };
    case 'code': return { x: x + 10, y: y + 32, w: w - 20, h: h - 38, valign: 'top' };
    case 'shape': {
      const k = !item.shape || item.shape === 'rectangle' ? 0 : item.shape === 'triangle' ? 0.25 : 0.15;
      const top = item.shape === 'triangle' ? y + h * 0.45 : y + h * k + 6;
      return { x: x + w * k + 6, y: top, w: w * (1 - 2 * k) - 12, h: y + h * (1 - k) - 6 - top, valign: 'middle' };
    }
    case 'card': return { x: x + 10, y: y + 40, w: w - 20, h: h - 48 - tagH, valign: 'top' };
    case 'frame': return { x: x + 8, y: y - 24, w: w - 16, h: 20, valign: 'top' };
    default: return { x, y, w, h: Infinity, valign: 'top' };
  }
}

function fits(text, box, fs, bold) {
  if (fs > 8 && text.split(/\s+/).some(word => measure(word, fs, bold) > box.w)) return false;
  const lines = wrap(text, box.w, fs, bold);
  return lines.length * fs * 1.25 <= box.h && lines.every(l => measure(l, fs, bold) <= box.w);
}

export function textLayout(item, text = item.content || '') {
  const box = textBox(item);
  const bold = !!item.bold;
  if (item.type === 'code') {
    const fs = Number(item.fontSize) || 13, lh = fs * 1.25;
    const max = Math.max(1, Math.floor(box.h / lh));
    const cols = Math.max(4, Math.floor(box.w / (fs * 0.6)));
    let lines = text ? text.split('\n').map(l => (l.length > cols ? l.slice(0, cols - 1) + '…' : l)) : [];
    if (lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = '…'; }
    return { box, fs, lh, lines, bold: false, align: 'left' };
  }
  let fs = item.fontSize;
  if (item.type === 'frame') fs = 13;
  else if (fs === 'auto') {
    if (!isFinite(box.h)) fs = 16;
    else {
      const sample = text.trim() ? text : 'Aa';
      let lo = 6, hi = 48;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(sample, box, mid, bold)) lo = mid; else hi = mid - 1;
      }
      fs = lo;
    }
  }
  fs = Number(fs) || 14;
  const lh = fs * 1.25;
  let lines = text ? wrap(text, Math.max(box.w, fs), fs, bold) : [];
  if (isFinite(box.h) && item.type !== 'frame') {
    const max = Math.max(1, Math.floor(box.h / lh));
    if (lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = lines[max - 1].slice(0, -1) + '…'; }
  }
  return { box, fs, lh, lines, bold, align: item.align || 'left' };
}

export function appendLayoutText(g, item, ink) {
  const L = textLayout(item);
  if (!L.lines.length) return;
  const total = L.lines.length * L.lh;
  const top = L.box.valign === 'middle' ? L.box.y + (L.box.h - total) / 2 : L.box.y;
  const ax = L.align === 'center' ? L.box.x + L.box.w / 2 : L.align === 'right' ? L.box.x + L.box.w : L.box.x;
  const textEl = document.createElementNS(SVG_NS, 'text');
  textEl.setAttribute('fill', ink);
  textEl.setAttribute('font-size', L.fs);
  if (L.bold) textEl.setAttribute('font-weight', 'bold');
  textEl.setAttribute('text-anchor', { left: 'start', center: 'middle', right: 'end' }[L.align] || 'start');
  textEl.setAttribute('aria-hidden', 'true');
  textEl.classList.add('item-text');
  L.lines.forEach((l, i) => {
    const tspan = document.createElementNS(SVG_NS, 'tspan');
    tspan.setAttribute('x', ax);
    tspan.setAttribute('y', top + i * L.lh + L.lh / 2 + L.fs * 0.35);
    tspan.textContent = l;
    textEl.appendChild(tspan);
  });
  g.appendChild(textEl);
}

export function inkFor(item) {
  if (item.type === 'sticky_note') return item.color === 'black' ? '#ffffff' : '#1b1740';
  if (item.type === 'code') return '#f1eeff';
  if (item.type === 'mindmap' && !item.parentNode) return 'var(--on-primary)';
  return 'var(--fg)';
}

export function itemBox(item) {
  if (item.type === 'connector') return L.geometry(item, state.getItem)?.bbox || { x: 0, y: 0, w: 0, h: 0 };
  const w = item.width || 100;
  let h = item.height || 30;
  if (item.type === 'text') {
    const L = textLayout(item);
    h = Math.max(h, L.lines.length * L.lh);
  }
  return { x: item.x || 0, y: item.y || 0, w, h };
}

function renderStickyNote(g, item) {
  const { x, y, width = 150, height = 150, color = 'light_yellow' } = item;
  const colorName = state.COLORS[color] || color;
  const bg = (state.PALETTE.find(c => c[0] === color) || state.PALETTE[0])[2];
  const ink = inkFor(item);

  const rect = createRect(x, y, width, height, 6);
  rect.setAttribute('fill', bg);
  rect.setAttribute('stroke', 'var(--note-border)');
  rect.setAttribute('stroke-width', '1');
  g.appendChild(rect);

  const badge = document.createElementNS(SVG_NS, 'text');
  badge.setAttribute('x', x + 6);
  badge.setAttribute('y', y + 14);
  badge.setAttribute('font-size', '10');
  badge.setAttribute('fill', ink);
  badge.setAttribute('aria-hidden', 'true');
  badge.classList.add('color-badge');
  badge.textContent = colorName;
  g.appendChild(badge);

  appendLayoutText(g, item, ink);
}

function renderShape(g, item) {
  const { x, y, width = 120, height = 80, shape = 'rectangle' } = item;

  let shapeEl;
  switch (shape) {
    case 'circle': {
      shapeEl = document.createElementNS(SVG_NS, 'ellipse');
      shapeEl.setAttribute('cx', x + width / 2);
      shapeEl.setAttribute('cy', y + height / 2);
      shapeEl.setAttribute('rx', width / 2);
      shapeEl.setAttribute('ry', height / 2);
      break;
    }
    case 'triangle': {
      shapeEl = document.createElementNS(SVG_NS, 'polygon');
      shapeEl.setAttribute('points', `${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`);
      break;
    }
    case 'diamond': {
      shapeEl = document.createElementNS(SVG_NS, 'polygon');
      shapeEl.setAttribute('points', `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`);
      break;
    }
    default: {
      shapeEl = createRect(x, y, width, height, 2);
      break;
    }
  }
  shapeEl.setAttribute('fill', 'var(--shape-fill)');
  shapeEl.setAttribute('stroke', 'var(--shape-stroke)');
  shapeEl.setAttribute('stroke-width', '2');
  g.appendChild(shapeEl);
  appendLayoutText(g, item, 'var(--fg)');
}

function renderText(g, item) {
  const box = itemBox(item);
  const hitArea = createRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8, 0);
  hitArea.setAttribute('fill', 'transparent');
  hitArea.setAttribute('stroke', 'none');
  g.appendChild(hitArea);
  appendLayoutText(g, item, 'var(--fg)');
}

function renderCard(g, item) {
  const { x, y, width = 200, height = 120, title = '' } = item;
  const headerH = 32;

  const bg = createRect(x, y, width, height, 6);
  bg.setAttribute('fill', 'var(--card-bg)');
  bg.setAttribute('stroke', 'var(--card-border)');
  bg.setAttribute('stroke-width', '1');
  g.appendChild(bg);

  const header = createRect(x, y, width, headerH, 0);
  header.setAttribute('fill', 'var(--primary)');
  header.setAttribute('rx', '6');
  g.appendChild(header);
  const headerMask = createRect(x, y + 6, width, headerH - 6, 0);
  headerMask.setAttribute('fill', 'var(--primary)');
  g.appendChild(headerMask);

  const titleText = document.createElementNS(SVG_NS, 'text');
  titleText.setAttribute('x', x + 10);
  titleText.setAttribute('y', y + 22);
  titleText.setAttribute('fill', 'var(--on-primary)');
  titleText.setAttribute('font-size', '14');
  titleText.setAttribute('font-weight', 'bold');
  titleText.textContent = title.length > 25 ? title.slice(0, 25) + '…' : title;
  g.appendChild(titleText);

  appendLayoutText(g, item, 'var(--fg)');
}

function renderFrame(g, item) {
  const { x, y, width = 400, height = 300, content = '' } = item;

  const rect = createRect(x, y, width, height, 4);
  rect.setAttribute('fill', 'var(--frame-fill)');
  rect.setAttribute('stroke', 'var(--frame-stroke)');
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('stroke-dasharray', '8 4');
  g.appendChild(rect);

  if (content) {
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x + 8);
    label.setAttribute('y', y - 6);
    label.setAttribute('fill', 'var(--frame-label)');
    label.setAttribute('font-size', '13');
    label.setAttribute('font-weight', 'bold');
    label.classList.add('item-text');
    label.textContent = content;
    g.appendChild(label);
  }
}

function renderConnector(g, item) {
  const G = L.geometry(item, state.getItem);
  if (!G) return;
  const sw = item.strokeWidth || 2, color = L.strokeOf(item), dash = L.dashOf(item);
  g.append(
    svgEl('path', { d: G.d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(16, sw + 12), class: 'line-hit' }),
    svgEl('path', { d: G.d, fill: 'none', stroke: 'var(--primary)', 'stroke-width': sw + 6, 'stroke-opacity': 0.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none', class: 'line-halo' })
  );
  const body = svgEl('path', { d: G.body, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': item.lineStyle === 'dotted' ? 'round' : 'butt', 'pointer-events': 'none', class: 'line-body' });
  if (dash) body.setAttribute('stroke-dasharray', dash);
  g.appendChild(body);
  const size = L.capSize(sw);
  for (const [cap, p, dir, end] of [[item.startCap, G.start, G.startDir, 'start'], [item.endCap, G.end, G.endDir, 'end']]) {
    const shape = L.capShape(cap, p, dir, size);
    if (!shape) continue;
    g.appendChild(svgEl(shape.tag, { ...shape.attrs, fill: shape.filled ? color : 'none', stroke: color, 'stroke-width': shape.filled ? 1 : sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'pointer-events': 'none', class: `line-cap line-cap-${end}`, 'data-cap': cap }));
  }
  if (item.label && item.id !== editingId) {
    const { x, y } = G.labelAt;
    const w = measure(item.label, 13, false) + 14;
    g.append(
      svgEl('rect', { x: x - w / 2, y: y - 11, width: w, height: 22, rx: 4, fill: 'var(--bg)', stroke: color, 'stroke-width': 0.5, class: 'line-label-bg' }),
      Object.assign(svgEl('text', { x, y: y + 4.5, 'text-anchor': 'middle', fill: 'var(--fg)', 'font-size': 13, 'aria-hidden': 'true', class: 'line-label' }), { textContent: item.label })
    );
  }
}

export function selectedLine() {
  const ids = state.getSelectedIds();
  const item = ids.length === 1 ? state.getItem(ids[0]) : null;
  return item?.type === 'connector' ? item : null;
}

export function getActiveEnd() {
  return activeEnd;
}

export function setActiveEnd(end) {
  if (activeEnd === end) return;
  activeEnd = end;
  renderOverlay();
}

/* Alt+flèches : déplace l'extrémité active de la ligne sélectionnée. */
export function lineEndKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || !e.key.startsWith('Arrow')) return false;
  const line = selectedLine();
  if (!line) return false;
  e.preventDefault();
  const step = e.shiftKey ? LARGE_STEP : SMALL_STEP;
  state.moveLineEnd(line.id, activeEnd, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
  return true;
}

export function lineLabelBox(id) {
  const item = state.getItem(id);
  const G = item && L.geometry(item, state.getItem);
  if (!G) return null;
  const w = Math.max(160, measure(item.label || '', 13, false) + 40);
  return { x: G.labelAt.x - w / 2, y: G.labelAt.y - 14, w, h: 28 };
}

function renderLineHandles(line) {
  const G = L.geometry(line, state.getItem);
  if (!G) return;
  const u = 1 / zoom;
  G.mids.forEach((m, i) => {
    const a = G.points[i], b = G.points[i + 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) * zoom < 72) return;
    overlay.append(
      svgEl('circle', { cx: m.x, cy: m.y, r: 12 * u, fill: 'transparent', 'data-mid': i, class: 'line-handle line-mid' }),
      svgEl('circle', { cx: m.x, cy: m.y, r: 5 * u, fill: '#ffffff', stroke: LINK_BLUE, 'stroke-width': 1.5 * u, 'pointer-events': 'none' })
    );
  });
  (line.waypoints || []).forEach((w, i) => {
    overlay.append(
      svgEl('circle', { cx: w.x, cy: w.y, r: 12 * u, fill: 'transparent', 'data-wp': i, class: 'line-handle line-wp' }),
      svgEl('circle', { cx: w.x, cy: w.y, r: 6 * u, fill: LINK_BLUE, stroke: '#ffffff', 'stroke-width': 1.5 * u, 'pointer-events': 'none' })
    );
  });
  for (const end of ['start', 'end']) {
    const p = G[end];
    if (end === activeEnd) overlay.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 12 * u, fill: 'none', stroke: LINK_BLUE, 'stroke-width': 1.5 * u, 'stroke-dasharray': `${3 * u} ${2 * u}`, 'pointer-events': 'none', class: 'line-active-end' }));
    overlay.append(
      svgEl('circle', { cx: p.x, cy: p.y, r: 12 * u, fill: 'transparent', 'data-end': end, class: 'line-handle line-end' }),
      svgEl('circle', { cx: p.x, cy: p.y, r: 7 * u, fill: L.isAttached(line, end) ? LINK_BLUE : '#ffffff', stroke: LINK_BLUE, 'stroke-width': 2 * u, 'pointer-events': 'none' })
    );
  }
}

function renderSnapTarget(item) {
  if (!item) return;
  const b = itemBox(item), u = 1 / zoom;
  overlay.appendChild(svgEl('rect', { x: b.x - 4 * u, y: b.y - 4 * u, width: b.w + 8 * u, height: b.h + 8 * u, rx: 6 * u, fill: 'rgba(56,89,255,0.12)', stroke: LINK_BLUE, 'stroke-width': 2.5 * u, 'pointer-events': 'none', class: 'snap-target' }));
}

function createRect(x, y, w, h, rx) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', x);
  r.setAttribute('y', y);
  r.setAttribute('width', w);
  r.setAttribute('height', h);
  if (rx) r.setAttribute('rx', rx);
  return r;
}

export function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function selectionItems() {
  return state.getSelectedIds().map(state.getItem).filter(i => i && i.type !== 'connector' && !(i.type === 'mindmap' && state.isMindHidden(i)));
}

function unionBox(items) {
  const boxes = items.map(itemBox);
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}

function renderOverlay() {
  if (!overlay) return;
  overlay.replaceChildren();
  const u = 1 / zoom;
  const items = selectionItems();
  if (items.length > 1) {
    const b = unionBox(items);
    overlay.appendChild(svgEl('rect', { x: b.x - 6 * u, y: b.y - 6 * u, width: b.w + 12 * u, height: b.h + 12 * u, fill: 'none', stroke: LINK_BLUE, 'stroke-width': 1.5 * u, 'stroke-dasharray': `${6 * u} ${4 * u}`, class: 'selection-box' }));
  }
  if (items.length === 1 && state.getSelectedIds().length === 1 && !items[0].locked && items[0].id !== editingId && !dragState?.moved && items[0].type !== 'comment') {
    const b = itemBox(items[0]);
    const corners = O.AUTO_SIZE.includes(items[0].type) ? {} : { nw: [b.x, b.y], ne: [b.x + b.w, b.y], sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h] };
    for (const [name, [cx, cy]] of Object.entries(corners)) {
      const hit = svgEl('rect', { x: cx - 12 * u, y: cy - 12 * u, width: 24 * u, height: 24 * u, fill: 'transparent', 'data-handle': name, class: `handle handle-${name}` });
      overlay.append(hit, svgEl('rect', { x: cx - 5 * u, y: cy - 5 * u, width: 10 * u, height: 10 * u, fill: '#ffffff', stroke: LINK_BLUE, 'stroke-width': 1.5 * u, 'pointer-events': 'none' }));
    }
    const off = 18 * u;
    const dots = { n: [b.x + b.w / 2, b.y - off], s: [b.x + b.w / 2, b.y + b.h + off], w: [b.x - off, b.y + b.h / 2], e: [b.x + b.w + off, b.y + b.h / 2] };
    for (const [name, [cx, cy]] of Object.entries(dots)) {
      overlay.append(
        svgEl('circle', { cx, cy, r: 12 * u, fill: 'transparent', 'data-link': name, class: 'link-dot' }),
        svgEl('circle', { cx, cy, r: 6 * u, fill: LINK_BLUE, stroke: '#ffffff', 'stroke-width': 1.5 * u, 'pointer-events': 'none' })
      );
    }
  }
  const line = selectedLine();
  if (line && !line.locked && line.id !== editingId && !dragState?.moved) renderLineHandles(line);
  if (lineDrag) renderSnapTarget(lineDrag.hover);
  if (lineDraft) {
    overlay.appendChild(svgEl('line', { x1: lineDraft.from.x, y1: lineDraft.from.y, x2: lineDraft.cur.x, y2: lineDraft.cur.y, stroke: LINK_BLUE, 'stroke-width': 2 * u, 'stroke-dasharray': `${6 * u} ${4 * u}`, class: 'line-draft', 'pointer-events': 'none' }));
    renderSnapTarget(lineDraft.hover);
    renderSnapTarget(lineDraft.fromItem);
  }
  if (marquee?.moved) {
    const x = Math.min(marquee.start.x, marquee.cur.x), y = Math.min(marquee.start.y, marquee.cur.y);
    overlay.appendChild(svgEl('rect', { x, y, width: Math.abs(marquee.cur.x - marquee.start.x), height: Math.abs(marquee.cur.y - marquee.start.y), fill: 'rgba(56,89,255,0.08)', stroke: LINK_BLUE, 'stroke-width': u, class: 'marquee', 'pointer-events': 'none' }));
  }
  if (penState) {
    overlay.appendChild(svgEl('polyline', { points: penState.points.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: O.hexOf(O.PEN_COLORS, penColor), 'stroke-width': penWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'pen-preview', 'pointer-events': 'none' }));
  }
  if (linkState) {
    overlay.appendChild(svgEl('line', { x1: linkState.from.x, y1: linkState.from.y, x2: linkState.to.x, y2: linkState.to.y, stroke: LINK_BLUE, 'stroke-width': 2 * u, 'stroke-dasharray': `${6 * u} ${4 * u}`, 'marker-end': 'url(#arrowhead)', class: 'link-preview', 'pointer-events': 'none' }));
  }
}

function updateFocusableItems() {
  const groups = itemsGroup.querySelectorAll('.canvas-item');
  groups.forEach((g, i) => {
    g.setAttribute('tabindex', i === focusedIndex ? '0' : '-1');
  });
  if (groups.length > 0 && (focusedIndex === -1 || focusedIndex >= groups.length)) {
    groups[0].setAttribute('tabindex', '0');
  }
}

function targetIds(id) {
  return state.isSelected(id) ? state.getSelectedIds() : [id];
}

function onKeyDown(e) {
  if (e.defaultPrevented || lineEndKey(e)) return;
  if (e.target === svg && !state.getSelectedIds().length && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 200 : 50;
    panBy(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    announce('Vue déplacée');
    return;
  }
  const active = document.activeElement;
  const sub = active?.dataset?.sub;
  const holder = active?.closest?.('.canvas-item');
  if (sub && holder) {
    const subItem = state.getItem(holder.getAttribute('data-id'));
    if (subItem) lastSub[subItem.id] = sub;
    if (e.key !== 'Tab') { if (subItem) obj.onSubKey(e, subItem, sub); return; }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && tool !== 'select') { e.preventDefault(); cancelTool(); return; }
  if (e.key === 'Enter' && isCreationTool()) { e.preventDefault(); createAtCenter(); return; }
  if (e.key === 'Enter' && DRAW_TOOLS.includes(tool)) { e.preventDefault(); announce('Le tracé se fait au pointeur. Au clavier, Tab parcourt les tracés existants : flèches pour les déplacer, Entrée pour les décrire, Suppr pour les supprimer.'); return; }
  const groups = Array.from(itemsGroup.querySelectorAll('.canvas-item'));
  if (groups.length === 0) return;

  const idx = groups.indexOf(holder);
  if (idx === -1) return;

  const id = holder.getAttribute('data-id');
  const item = state.getItem(id);
  if (!sub && item && itemKey(e, item)) return;

  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!item) return;
      e.preventDefault();
      const step = e.shiftKey ? LARGE_STEP : SMALL_STEP;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      state.moveItems(targetIds(id), dx, dy);
      itemsGroup.querySelector(`[data-id="${id}"]`)?.focus();
      break;
    }
    case 'Tab': {
      const next = idx + (e.shiftKey ? -1 : 1);
      if (next >= 0 && next < groups.length) {
        e.preventDefault();
        focusedIndex = next;
        updateFocusableItems();
        groups[next].focus();
        mapMode = null;
        selectItem(groups[next].getAttribute('data-id'));
      }
      break;
    }
    case 'Enter': {
      e.preventDefault();
      if (item && obj.enterSub(item)) break;
      edit(id);
      break;
    }
    case 'Delete':
    case 'Backspace': {
      e.preventDefault();
      state.removeItems(targetIds(id));
      if (state.getItem(id)) break;
      const remaining = itemsGroup.querySelectorAll('.canvas-item');
      focusedIndex = Math.max(0, Math.min(idx, remaining.length - 1));
      updateFocusableItems();
      remaining[focusedIndex]?.focus();
      break;
    }
    case 'Escape': {
      e.preventDefault();
      if (state.getSelectedIds().length) state.setSelection([], true);
      svg.focus({ preventScroll: true });
      break;
    }
  }
}

function itemKey(e, item) {
  if (e.key === 'F2') { e.preventDefault(); if (!obj.enterSub(item)) edit(item.id); return true; }
  if (item.type === 'flipcard' && e.key === ' ') { e.preventDefault(); obj.flip(item.id); return true; }
  if (item.type !== 'mindmap') return false;
  const inMap = mapMode === item.id && state.isSelected(item.id);
  if (inMap && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); addMindNode(item.id, true); return true; }
  if (inMap && e.key === 'Enter') { e.preventDefault(); addMindNode(item.id, !item.parentNode); return true; }
  if (e.key === 'Escape') mapMode = null;
  if (e.shiftKey || !e.key.startsWith('Arrow')) return false;
  e.preventDefault();
  const kids = state.mindChildren(item.id);
  const siblings = item.parentNode ? state.mindChildren(item.parentNode) : [item];
  const i = siblings.findIndex(s => s.id === item.id);
  let target = null;
  if (e.key === 'ArrowRight') { if (kids.length && item.collapsed) state.setMindCollapsed(item.id, false); else target = kids[0]?.id; }
  else if (e.key === 'ArrowLeft') { if (kids.length && !item.collapsed) state.setMindCollapsed(item.id, true); else target = item.parentNode; }
  else target = siblings[i + (e.key === 'ArrowDown' ? 1 : -1)]?.id;
  mapMode = target || item.id;
  if (target) focusItem(target);
  return true;
}

export function addMindNode(id, child) {
  const node = state.addMindNode(id, child);
  if (!node) return null;
  mapMode = node.id;
  focusGroup(node.id);
  svg.dispatchEvent(new CustomEvent('item-edit', { detail: { id: node.id, isNew: true }, bubbles: true }));
  return node;
}

export function setMapMode(id) {
  mapMode = id;
}

export function edit(id) {
  svg.dispatchEvent(new CustomEvent('item-edit', { detail: { id }, bubbles: true }));
}

function groupSelection(id) {
  const item = state.getItem(id);
  return item?.groupId && enteredGroup !== item.groupId ? state.groupMembers(id) : [id];
}

export function selectItem(id) {
  const item = state.getItem(id);
  if (enteredGroup && item?.groupId !== enteredGroup) enteredGroup = null;
  state.setSelection(groupSelection(id));
}

export function enterGroup(id) {
  const item = state.getItem(id);
  if (!item?.groupId) return false;
  enteredGroup = item.groupId;
  state.setSelectedId(id);
  focusGroup(id);
  announce(`Dans le groupe : ${state.getItemLabel(item)}`);
  return true;
}

export function focusSub(id, s) {
  lastSub[id] = s;
  if (!state.isSelected(id) || state.getSelectedIds().length !== 1) state.setSelectedId(id);
  const g = itemsGroup.querySelector(`[data-id="${id}"]`);
  if (!g) return;
  focusedIndex = Array.from(itemsGroup.children).indexOf(g);
  updateFocusableItems();
  g.querySelector(`[data-sub="${CSS.escape(s)}"]`)?.focus({ preventScroll: true });
}

export function getActiveSub(id) {
  return lastSub[id] || null;
}

export function cancelTool() {
  if (tool === 'select') return false;
  setTool('select');
  announce('Outil annulé, outil Sélection actif');
  return true;
}

function onSpace(e) {
  if (e.type === 'keydown' && e.defaultPrevented) return;
  if (e.key !== ' ' || !svg || container.hidden || document.getElementById('app-board')?.hidden) return;
  if (e.target.closest?.('input, textarea, select, button, a, dialog, [contenteditable], [role="menuitem"], [role="menuitemradio"]')) return;
  if (e.type === 'keydown') {
    spaceDown = true;
    svg.classList.add('space-pan');
    e.preventDefault();
  } else {
    spaceDown = false;
    svg.classList.remove('space-pan');
  }
}

function screenToSvg(clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x, y: svgPt.y };
}

export function toContainer(x, y) {
  const ctm = svg.getScreenCTM();
  const r = container.getBoundingClientRect();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = x; pt.y = y;
  const p = pt.matrixTransform(ctm);
  return { x: p.x - r.left, y: p.y - r.top };
}

export function getSelectionRect() {
  const items = selectionItems();
  let b;
  if (items.length) b = unionBox(items);
  else {
    const c = state.getItem(state.getSelectedId());
    if (c?.type !== 'connector' || !L.geometry(c, state.getItem)) return null;
    b = itemBox(c);
  }
  const a = toContainer(b.x, b.y), z = toContainer(b.x + b.w, b.y + b.h);
  return { left: a.x, top: a.y, right: z.x, bottom: z.y };
}

function startPan(e) {
  panState = { x: e.clientX, y: e.clientY, panX, panY };
  svg.setPointerCapture(e.pointerId);
  svg.classList.add('is-panning');
}

function focusGroup(id) {
  const current = itemsGroup.querySelector(`[data-id="${id}"]`);
  if (!current) return;
  focusedIndex = Array.from(itemsGroup.children).indexOf(current);
  updateFocusableItems();
  current.focus({ preventScroll: true });
}

function onPointerDown(e) {
  if (e.button === 1 || tool === 'hand' || spaceDown) { e.preventDefault(); startPan(e); return; }
  if (e.button !== 0) return;
  const pt = screenToSvg(e.clientX, e.clientY);
  if (tool === 'pen') { e.preventDefault(); penState = { points: [pt] }; svg.setPointerCapture(e.pointerId); return; }
  if (tool === 'eraser') { e.preventDefault(); eraseState = { ids: new Set() }; eraseAt(e); svg.setPointerCapture(e.pointerId); return; }
  if (tool === 'line') {
    e.preventDefault();
    lineDraft = { from: pt, cur: pt, fromItem: hitItem(pt), hover: null, moved: false };
    svg.setPointerCapture(e.pointerId);
    return;
  }
  if (isCreationTool()) { e.preventDefault(); pendingCreate = pt; return; }

  const line = selectedLine();
  const lineHandle = line && !line.locked ? e.target.closest('[data-end], [data-wp], [data-mid]') : null;
  if (lineHandle) {
    e.preventDefault();
    const { end, wp, mid: segment } = lineHandle.dataset;
    if (end) setActiveEnd(end);
    lineDrag = { id: line.id, end, index: Number(end ? 0 : wp ?? segment), isNew: !end && !wp, start: pt, moved: false, hover: null, wasAttached: end ? L.isAttached(line, end) : false };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  const handle = e.target.closest('[data-handle]');
  const dot = e.target.closest('[data-link]');
  const sel = selectionItems()[0];
  if (handle && sel) {
    e.preventDefault();
    resizeState = { id: sel.id, handle: handle.getAttribute('data-handle'), box: { x: sel.x, y: sel.y, w: sel.width || 100, h: sel.height || 30 }, start: pt, pushed: false };
    svg.setPointerCapture(e.pointerId);
    return;
  }
  if (dot && sel) {
    e.preventDefault();
    const b = itemBox(sel);
    linkState = { fromId: sel.id, from: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, to: pt };
    svg.setPointerCapture(e.pointerId);
    renderOverlay();
    return;
  }

  const g = e.target.closest('.canvas-item');
  const action = e.target.closest('[data-action]');
  if (g && action && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); runAction(action, g.getAttribute('data-id')); return; }
  if (g) {
    const id = g.getAttribute('data-id');
    lastDownId = id;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const subEl = additive ? null : e.target.closest('[data-sub]');
    if (additive) {
      const members = groupSelection(id);
      const on = !members.every(state.isSelected);
      state.setSelection(on ? [...state.getSelectedIds(), ...members] : state.getSelectedIds().filter(s => !members.includes(s)), true);
    } else if (!state.isSelected(id)) selectItem(id);
    if (state.getItem(id)?.type === 'mindmap') mapMode = id;
    if (subEl) focusSub(id, subEl.dataset.sub); else focusGroup(id);
    if (!state.isSelected(id)) return;
    const item = state.getItem(id);
    if (subEl?.dataset.sub.startsWith('card:') && !item.locked) {
      cardDrag = { id, cardId: subEl.dataset.sub.slice(5), start: pt, moved: false };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (!item || state.isLocked(id)) return;
    const ids = state.movableIds(state.getSelectedIds());
    const objects = ids.filter(sid => state.getItem(sid).type !== 'connector');
    const moving = new Set(objects);
    const lines = ids.filter(sid => !moving.has(sid));
    const followers = state.getConnectors().filter(c => !lines.includes(c.id) && c.waypoints?.length && moving.has(c.startId) && moving.has(c.endId));
    dragState = {
      ids, moving, starts: new Map(objects.map(sid => [sid, { x: state.getItem(sid).x, y: state.getItem(sid).y }])),
      lines: new Map(lines.map(sid => [sid, JSON.parse(JSON.stringify(state.getItem(sid)))])),
      followers: new Map(followers.map(c => [c.id, c.waypoints.map(w => ({ ...w }))])),
      detached: false, start: pt, moved: false
    };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  lastDownId = null;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (!additive && state.getSelectedIds().length) state.setSelection([]);
  marquee = { start: pt, cur: pt, additive, base: state.getSelectedIds(), moved: false };
  svg.setPointerCapture(e.pointerId);
}

function runAction(el, id) {
  const kind = el.dataset.action;
  if (kind === 'kanban-add') { obj.addCard(id, Number(el.dataset.col)); return; }
  focusItem(id);
  if (kind === 'flip') obj.flip(id);
  else if (kind === 'copy-code') obj.copyCode(id);
  else if (kind === 'toggle-mind') state.setMindCollapsed(id, !state.getItem(id)?.collapsed);
}

function eraseAt(e) {
  const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('.canvas-item.type-drawing');
  const id = hit?.getAttribute('data-id');
  if (id && !eraseState.ids.has(id)) { eraseState.ids.add(id); hit.classList.add('is-erased'); }
}

function finishPen() {
  const raw = penState.points;
  penState = null;
  let pts = O.simplify(O.smooth(raw), 0.75 / zoom);
  if (pts.length < 2) pts = [pts[0], { x: pts[0].x + 0.5, y: pts[0].y + 0.5 }];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  const w = Math.max(1, Math.ceil(Math.max(...xs) - x)), h = Math.max(1, Math.ceil(Math.max(...ys) - y));
  const points = pts.flatMap(p => [Math.round((p.x - x) * 10) / 10, Math.round((p.y - y) * 10) / 10]);
  state.addItem({ type: 'drawing', x, y, width: w, height: h, vw: w, vh: h, points, stroke: penColor, strokeWidth: penWidth, content: '' });
  state.setSelection([]);
  renderOverlay();
  announce('Tracé ajouté : Dessin à main levée');
}

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const pt = screenToSvg(e.clientX, e.clientY);
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, pt.x, pt.y);
  } else {
    panBy(e.shiftKey ? e.deltaY : e.deltaX, e.shiftKey ? 0 : e.deltaY);
  }
}

function resizedBox(r, pt, keepRatio) {
  const { box, handle } = r;
  let dx = pt.x - r.start.x, dy = pt.y - r.start.y;
  let w = box.w + (handle.includes('e') ? dx : -dx);
  let h = box.h + (handle.includes('s') ? dy : -dy);
  if (keepRatio) {
    const s = Math.max(w / box.w, h / box.h);
    w = box.w * s; h = box.h * s;
  }
  w = Math.max(20, Math.round(w));
  h = Math.max(20, Math.round(h));
  return { x: handle.includes('w') ? box.x + box.w - w : box.x, y: handle.includes('n') ? box.y + box.h - h : box.y, width: w, height: h };
}

function onPointerMove(e) {
  if (panState) {
    panX = panState.panX - (e.clientX - panState.x) / zoom;
    panY = panState.panY - (e.clientY - panState.y) / zoom;
    updateViewBox();
    return;
  }
  const pt = screenToSvg(e.clientX, e.clientY);
  if (penState) {
    const last = penState.points[penState.points.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) * zoom >= 2) { penState.points.push(pt); renderOverlay(); }
    return;
  }
  if (eraseState) { eraseAt(e); return; }
  if (cardDrag) {
    const dx = pt.x - cardDrag.start.x, dy = pt.y - cardDrag.start.y;
    if (!cardDrag.moved && Math.abs(dx) * zoom <= 3 && Math.abs(dy) * zoom <= 3) return;
    cardDrag.moved = true;
    const el = itemsGroup.querySelector(`[data-id="${cardDrag.id}"] [data-sub="card:${CSS.escape(cardDrag.cardId)}"]`);
    el?.setAttribute('transform', `translate(${dx} ${dy})`);
    el?.classList.add('is-dragging');
    return;
  }
  if (resizeState) {
    const item = state.getItem(resizeState.id);
    if (!item) return;
    if (!resizeState.pushed) { history.pushState(state.getSnapshot()); resizeState.pushed = true; }
    state.setItemBox(item, resizedBox(resizeState, pt, e.shiftKey));
    render();
    return;
  }
  if (linkState) {
    linkState.to = pt;
    renderOverlay();
    return;
  }
  if (lineDraft) {
    lineDraft.cur = pt;
    if (Math.hypot(pt.x - lineDraft.from.x, pt.y - lineDraft.from.y) * zoom >= 5) lineDraft.moved = true;
    const over = hitItem(pt);
    lineDraft.hover = lineDraft.moved && over && over !== lineDraft.fromItem ? over : null;
    renderOverlay();
    return;
  }
  if (lineDrag) { moveLineDrag(pt); return; }
  if (marquee) {
    marquee.cur = pt;
    if (Math.abs(pt.x - marquee.start.x) * zoom > 3 || Math.abs(pt.y - marquee.start.y) * zoom > 3) marquee.moved = true;
    renderOverlay();
    return;
  }
  if (!dragState) return;
  const dx = pt.x - dragState.start.x;
  const dy = pt.y - dragState.start.y;
  if (!dragState.moved && Math.abs(dx) * zoom <= 3 && Math.abs(dy) * zoom <= 3) return;
  if (!dragState.moved) { history.pushState(state.getSnapshot()); dragState.moved = true; }
  for (const [id, original] of dragState.lines) {
    const item = state.getItem(id);
    if (!item) continue;
    for (const key of ['startId', 'endId', 'start', 'end']) delete item[key];
    Object.assign(item, JSON.parse(JSON.stringify(original)));
    if (L.shiftLine(item, dx, dy, dragState.moving, state.getItem)) dragState.detached = true;
  }
  for (const [id, wps] of dragState.followers) {
    const item = state.getItem(id);
    if (item) item.waypoints = wps.map(w => ({ x: Math.round(w.x + dx), y: Math.round(w.y + dy) }));
  }
  for (const [id, s] of dragState.starts) {
    const item = state.getItem(id);
    if (item) { item.x = Math.round(s.x + dx); item.y = Math.round(s.y + dy); }
  }
  render();
}

function moveLineDrag(pt) {
  const d = lineDrag;
  const item = state.getItem(d.id);
  if (!item) return;
  if (!d.moved) {
    if (Math.hypot(pt.x - d.start.x, pt.y - d.start.y) * zoom < 3) return;
    history.pushState(state.getSnapshot());
    d.moved = true;
    if (d.isNew) { item.waypoints.splice(d.index, 0, { x: Math.round(pt.x), y: Math.round(pt.y) }); d.isNew = false; d.added = true; }
  }
  if (d.end) {
    L.setEnd(item, d.end, pt);
    const other = item[`${d.end === 'start' ? 'end' : 'start'}Id`];
    d.hover = hitItem(pt, other) || null;
  } else item.waypoints[d.index] = { x: Math.round(pt.x), y: Math.round(pt.y) };
  render();
}

function finishLineDrag() {
  const d = lineDrag;
  lineDrag = null;
  const item = state.getItem(d.id);
  if (!d.moved || !item) return;
  if (d.end && d.hover) L.setEnd(item, d.end, { id: d.hover.id });
  state.touch();
  if (d.end) announce(state.endChangeMessage(item, d.end, d.wasAttached));
  else {
    const w = item.waypoints[d.index];
    announce(`Point de pliage ${d.added ? 'ajouté' : 'déplacé'} en (${w.x}, ${w.y})`);
  }
}

function createLine(start, end) {
  const data = { type: 'connector', x: 0, y: 0, label: '', lineType: 'straight', startCap: 'none', endCap: 'arrow_filled' };
  L.setEnd(data, 'start', start);
  L.setEnd(data, 'end', end);
  activeEnd = 'end';
  const item = state.addItem(data);
  setTool('select');
  focusGroup(item.id);
  announce(`Créé : ${state.getItemLabel(item)}`);
  return item;
}

function onPointerUp(e) {
  if (svg.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  if (panState) {
    panState = null;
    svg.classList.remove('is-panning');
    return;
  }
  if (penState) { finishPen(); return; }
  if (eraseState) {
    const ids = [...eraseState.ids];
    eraseState = null;
    if (ids.length) state.removeItems(ids);
    return;
  }
  if (cardDrag) {
    const d = cardDrag;
    cardDrag = null;
    if (d.moved && e.type === 'pointerup') obj.dropCard(d.id, d.cardId, screenToSvg(e.clientX, e.clientY));
    else if (d.moved) render();
    return;
  }
  if (pendingCreate) {
    const pt = pendingCreate;
    pendingCreate = null;
    if (e.type === 'pointerup') createAt(tool, pt);
    return;
  }
  if (resizeState) {
    const r = resizeState;
    resizeState = null;
    if (r.pushed) {
      state.touch();
      const item = state.getItem(r.id);
      if (item) announce(`Taille ${item.width} par ${item.height}`);
    }
    return;
  }
  if (lineDraft) {
    const l = lineDraft;
    lineDraft = null;
    if (e.type !== 'pointerup') { renderOverlay(); return; }
    if (!l.moved) { createAt('line', l.from); return; }
    createLine(l.fromItem ? { id: l.fromItem.id } : l.from, l.hover ? { id: l.hover.id } : l.cur);
    return;
  }
  if (lineDrag) { finishLineDrag(); return; }
  if (linkState) {
    const l = linkState;
    linkState = null;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.canvas-item');
    const endId = target?.getAttribute('data-id');
    const end = state.getItem(endId);
    if (end && end.type !== 'connector' && endId !== l.fromId) {
      state.addItem({ type: 'connector', startId: l.fromId, endId, label: '', lineType: 'straight', endCap: 'arrow_filled', x: 0, y: 0 });
      state.setSelectedId(l.fromId);
      announce(`Lien créé entre ${state.getItemLabel(state.getItem(l.fromId))} et ${state.getItemLabel(end)}`);
    } else {
      renderOverlay();
      announce('Aucun lien créé');
    }
    return;
  }
  if (marquee) {
    const m = marquee;
    marquee = null;
    if (!m.moved) { renderOverlay(); return; }
    const x1 = Math.min(m.start.x, m.cur.x), x2 = Math.max(m.start.x, m.cur.x);
    const y1 = Math.min(m.start.y, m.cur.y), y2 = Math.max(m.start.y, m.cur.y);
    const inside = state.getItems().filter(i => {
      if (i.type === 'connector' && (i.startId || i.endId)) return false;
      const b = itemBox(i);
      return b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2;
    }).map(i => i.id);
    state.setSelection(m.additive ? [...m.base, ...inside] : inside, true);
    return;
  }
  if (dragState) {
    const d = dragState;
    dragState = null;
    if (d.moved) {
      state.touch();
      const first = state.getItem(d.ids[0]);
      if (first?.type === 'connector' && d.ids.length === 1) announce(`Ligne ${d.detached ? 'détachée et ' : ''}déplacée : ${state.getItemLabel(first)}`);
      else announce(d.ids.length === 1 && first ? `Déplacé en ${first.x}, ${first.y}` : `${d.ids.length} éléments déplacés`);
    } else renderOverlay();
  }
}

function onDoubleClick(e) {
  const line = selectedLine();
  if (tool === 'select' && line && !line.locked) {
    const pt = screenToSvg(e.clientX, e.clientY);
    const hit = (line.waypoints || []).findIndex(w => Math.hypot(w.x - pt.x, w.y - pt.y) * zoom <= 14);
    if (hit >= 0) { state.removeWaypoint(line.id, hit); focusGroup(line.id); return; }
  }
  if (tool !== 'select' || !lastDownId || e.shiftKey || e.ctrlKey || e.metaKey) return;
  const item = state.getItem(lastDownId);
  if (item?.groupId && enteredGroup !== item.groupId) { enterGroup(item.id); return; }
  if (e.target.closest('[data-action]')) return;
  const sub = e.target.closest('[data-sub]')?.dataset.sub;
  if (sub) { obj.editSub(lastDownId, sub); return; }
  edit(lastDownId);
}

function hitItem(pt, exclude) {
  return [...state.getItems()].reverse().find(i => {
    if (i.id === exclude || ['connector', 'comment'].includes(i.type) || (i.type === 'mindmap' && state.isMindHidden(i))) return false;
    const b = itemBox(i);
    return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
  });
}

export function dropAt(t, clientX, clientY, color) {
  const pt = screenToSvg(clientX, clientY);
  const before = stickyColor;
  if (color) stickyColor = color;
  const item = createAt(t, pt);
  stickyColor = before;
  return item;
}

export function createAt(t, pt, useSelection = false) {
  if (t === 'line') return createLine({ x: pt.x - 100, y: pt.y }, { x: pt.x + 100, y: pt.y });
  const [type, shape] = t.split(':');
  const [w, h] = TOOL_SIZES[t] || [150, 150];
  const data = { type, x: Math.round(pt.x - w / 2), y: Math.round(pt.y - h / 2), width: w, height: h, content: '', ...O.defaults(type) };
  if (type === 'sticky_note') data.color = stickyColor;
  if (type === 'shape') data.shape = shape || 'rectangle';
  if (type === 'card') data.title = '';  if (type === 'comment') {
    const target = useSelection ? state.getItem(state.getSelectedId()) : hitItem(pt);
    if (target && !['connector', 'comment'].includes(target.type)) data.targetId = target.id;
  }
  if (type !== 'frame' && type !== 'comment') {
    const frame = state.getItems().filter(f => f.type === 'frame' && pt.x >= f.x && pt.x <= f.x + f.width && pt.y >= f.y && pt.y <= f.y + f.height).pop();
    data.parent = frame ? frame.id : null;
  }
  const item = state.addItem(data);
  if (type === 'mindmap') mapMode = item.id;
  setTool('select');
  focusGroup(item.id);
  if (type === 'comment') svg.dispatchEvent(new CustomEvent('comment-open', { detail: { id: item.id, focus: true }, bubbles: true }));
  else if (type === 'kanban' || type === 'datatable') announce(`${TOOL_NAMES[type]} ajouté. Entrée pour parcourir ${type === 'kanban' ? 'les cartes' : 'les cellules'}.`);
  else svg.dispatchEvent(new CustomEvent('item-edit', { detail: { id: item.id, isNew: true }, bubbles: true }));
  return item;
}

export function createAtCenter(t = tool) {
  const { w, h } = viewSize();
  const pt = { x: Math.round(panX + w / 2), y: Math.round(panY + h / 2) };
  if (!t.startsWith('comment')) {
    const [iw, ih] = TOOL_SIZES[t] || [150, 150];
    const others = state.getItems().filter(i => !['connector', 'comment', 'frame'].includes(i.type) && i.width);
    for (let n = 0; n < 50; n++) {
      const l = pt.x - iw / 2, tp = pt.y - ih / 2;
      const hit = others.find(o => l < o.x + o.width + 20 && l + iw + 20 > o.x && tp < o.y + (o.height || 0) + 20 && tp + ih + 20 > o.y);
      if (!hit) break;
      pt.x = hit.x + hit.width + 40 + iw / 2;
    }
  }
  const item = createAt(t, pt, true);
  reveal(item.id);
  return item;
}

export function reveal(id) {
  const item = state.getItem(id);
  if (!item || !svg) return;
  const b = itemBox(item);
  const { w, h } = viewSize();
  if (b.x >= panX && b.y >= panY && b.x + b.w <= panX + w && b.y + b.h <= panY + h) return;
  panX = b.x + b.w / 2 - w / 2;
  panY = b.y + b.h / 2 - h / 2;
  updateViewBox();
}

export function focusItem(id) {
  state.setSelectedId(id);
  focusGroup(id);
}

export function getViewCenter() {
  const { w, h } = viewSize();
  return { x: Math.round((panX + w / 2) / 10) * 10, y: Math.round((panY + h / 2) / 10) * 10 };
}

export function getSvgElement() {
  return svg;
}

export function getContainer() {
  return container;
}

export function fitFrame(id) {
  const item = state.getItem(id);
  if (!item || !svg?.clientWidth) return;
  const b = itemBox(item);
  zoom = Math.min(MAX_ZOOM, svg.clientWidth / (b.w + 64), svg.clientHeight / (b.h + 64));
  centerView(b.x + b.w / 2, b.y + b.h / 2);
}

export function centerView(x, y) {
  const { w, h } = viewSize();
  panX = x - w / 2;
  panY = y - h / 2;
  updateViewBox();
}

export function getViewport() {
  const { w, h } = viewSize();
  return { x: panX, y: panY, w, h };
}

export function restoreViewport(view) {
  zoom = (svg.clientWidth || BASE_W) / view.w;
  centerView(view.x + view.w / 2, view.y + view.h / 2);
}
