import * as state from '../state.js';
import * as history from '../store/history.js';
import { announce } from '../a11y/announcer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BASE_W = 2000;
const BASE_H = 1500;
const SMALL_STEP = 10;
const LARGE_STEP = 50;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;

let svg = null;
let itemsGroup = null;
let zoom = 1;
let panX = 0;
let panY = 0;
let focusedIndex = -1;
let dragState = null;
let container = null;

const colorValues = {
  yellow: { bg: 'var(--note-yellow)', pattern: 'pattern-hlines' },
  blue: { bg: 'var(--note-blue)', pattern: 'pattern-dlines-r' },
  green: { bg: 'var(--note-green)', pattern: 'pattern-dots' },
  pink: { bg: 'var(--note-pink)', pattern: 'pattern-dlines-l' },
  orange: { bg: 'var(--note-orange)', pattern: 'pattern-cross' },
  purple: { bg: 'var(--note-purple)', pattern: 'pattern-vlines' },
  gray: { bg: 'var(--note-gray)', pattern: null }
};

export function init(el) {
  container = el;
  svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', 'Canevas du tableau blanc. Utilisez Tab pour naviguer entre les éléments, flèches pour déplacer, Entrée pour éditer, Suppr pour supprimer.');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('canvas-svg');
  updateViewBox();

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = buildDefs();
  svg.appendChild(defs);

  const grid = document.createElementNS(SVG_NS, 'rect');
  grid.setAttribute('width', '100%');
  grid.setAttribute('height', '100%');
  grid.setAttribute('fill', 'url(#grid)');
  grid.classList.add('canvas-grid');
  svg.appendChild(grid);

  itemsGroup = document.createElementNS(SVG_NS, 'g');
  itemsGroup.setAttribute('id', 'canvas-items');
  svg.appendChild(itemsGroup);

  el.appendChild(svg);

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('keydown', onKeyDown);

  state.subscribe(() => render());
}

function buildDefs() {
  return `
    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="var(--grid-color)" stroke-width="0.5"/>
    </pattern>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="var(--fg)">
      <polygon points="0 0, 10 3.5, 0 7"/>
    </marker>
    <pattern id="pattern-hlines" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="4" x2="8" y2="4" stroke="var(--pattern-stroke)" stroke-width="1"/>
    </pattern>
    <pattern id="pattern-vlines" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="4" y1="0" x2="4" y2="8" stroke="var(--pattern-stroke)" stroke-width="1"/>
    </pattern>
    <pattern id="pattern-dlines-r" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="8" x2="8" y2="0" stroke="var(--pattern-stroke)" stroke-width="1"/>
    </pattern>
    <pattern id="pattern-dlines-l" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="8" y2="8" stroke="var(--pattern-stroke)" stroke-width="1"/>
    </pattern>
    <pattern id="pattern-dots" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="1.5" fill="var(--pattern-stroke)"/>
    </pattern>
    <pattern id="pattern-cross" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="4" x2="8" y2="4" stroke="var(--pattern-stroke)" stroke-width="0.7"/>
      <line x1="4" y1="0" x2="4" y2="8" stroke="var(--pattern-stroke)" stroke-width="0.7"/>
    </pattern>
  `;
}

function updateViewBox() {
  if (!svg) return;
  const w = BASE_W / zoom;
  const h = BASE_H / zoom;
  svg.setAttribute('viewBox', `${panX} ${panY} ${w} ${h}`);
}

export function zoomIn() {
  zoom = Math.min(MAX_ZOOM, zoom * 1.25);
  updateViewBox();
  announce(`Zoom ${Math.round(zoom * 100)}%`);
}

export function zoomOut() {
  zoom = Math.max(MIN_ZOOM, zoom / 1.25);
  updateViewBox();
  announce(`Zoom ${Math.round(zoom * 100)}%`);
}

export function zoomReset() {
  zoom = 1;
  panX = 0;
  panY = 0;
  updateViewBox();
  announce('Zoom reinitialise');
}

export function getZoom() {
  return zoom;
}

export function render() {
  if (!itemsGroup) return;
  itemsGroup.innerHTML = '';

  const items = state.getItems();
  const selectedId = state.getSelectedId();

  const frames = items.filter(i => i.type === 'frame');
  const regular = items.filter(i => i.type !== 'frame' && i.type !== 'connector');
  const connectors = items.filter(i => i.type === 'connector');
  const ordered = [...frames, ...regular, ...connectors];

  ordered.forEach((item, idx) => {
    const g = renderItem(item, idx);
    if (!g) return;
    if (item.id === selectedId) {
      g.classList.add('selected');
    }
    itemsGroup.appendChild(g);
  });

  updateFocusableItems();
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
    default: return null;
  }

  return g;
}

function renderStickyNote(g, item) {
  const { x, y, width = 150, height = 150, color = 'yellow', content = '' } = item;
  const colorName = state.COLORS[color] || color;
  const cv = colorValues[color] || colorValues.yellow;

  const rect = createRect(x, y, width, height, 6);
  rect.setAttribute('fill', cv.bg);
  rect.setAttribute('stroke', 'var(--note-border)');
  rect.setAttribute('stroke-width', '1');
  g.appendChild(rect);

  if (cv.pattern) {
    const overlay = createRect(x, y, width, height, 6);
    overlay.setAttribute('fill', `url(#${cv.pattern})`);
    overlay.setAttribute('opacity', '0.15');
    overlay.classList.add('pattern-overlay');
    g.appendChild(overlay);
  }

  const badge = document.createElementNS(SVG_NS, 'text');
  badge.setAttribute('x', x + 6);
  badge.setAttribute('y', y + 14);
  badge.setAttribute('font-size', '10');
  badge.setAttribute('fill', 'var(--note-text)');
  badge.setAttribute('aria-hidden', 'true');
  badge.classList.add('color-badge');
  badge.textContent = colorName;
  g.appendChild(badge);

  appendWrappedText(g, content, x + 8, y + 30, width - 16, 14);
}

function renderShape(g, item) {
  const { x, y, width = 120, height = 80, shape = 'rectangle', content = '' } = item;

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
      const pts = `${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`;
      shapeEl = document.createElementNS(SVG_NS, 'polygon');
      shapeEl.setAttribute('points', pts);
      break;
    }
    case 'diamond': {
      const pts = `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`;
      shapeEl = document.createElementNS(SVG_NS, 'polygon');
      shapeEl.setAttribute('points', pts);
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

  if (content) {
    const txt = document.createElementNS(SVG_NS, 'text');
    txt.setAttribute('x', x + width / 2);
    txt.setAttribute('y', y + height / 2 + 5);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', 'var(--fg)');
    txt.setAttribute('font-size', '14');
    txt.textContent = content.length > 30 ? content.slice(0, 30) + '…' : content;
    g.appendChild(txt);
  }
}

function renderText(g, item) {
  const { x, y, content = '', width = 200 } = item;
  const hitArea = createRect(x - 4, y - 4, width + 8, 30, 0);
  hitArea.setAttribute('fill', 'transparent');
  hitArea.setAttribute('stroke', 'none');
  g.appendChild(hitArea);
  appendWrappedText(g, content, x, y + 14, width, 16);
}

function renderCard(g, item) {
  const { x, y, width = 200, height = 120, title = '', content = '' } = item;
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

  if (content) {
    appendWrappedText(g, content, x + 10, y + headerH + 18, width - 20, 13);
  }
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
    label.textContent = content;
    g.appendChild(label);
  }
}

function renderConnector(g, item) {
  const startItem = state.getItem(item.startId);
  const endItem = state.getItem(item.endId);
  if (!startItem || !endItem) return;

  const x1 = startItem.x + (startItem.width || 100) / 2;
  const y1 = startItem.y + (startItem.height || 100) / 2;
  const x2 = endItem.x + (endItem.width || 100) / 2;
  const y2 = endItem.y + (endItem.height || 100) / 2;

  const hitLine = document.createElementNS(SVG_NS, 'line');
  hitLine.setAttribute('x1', x1);
  hitLine.setAttribute('y1', y1);
  hitLine.setAttribute('x2', x2);
  hitLine.setAttribute('y2', y2);
  hitLine.setAttribute('stroke', 'transparent');
  hitLine.setAttribute('stroke-width', '16');
  g.appendChild(hitLine);

  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', 'var(--connector-stroke)');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('marker-end', 'url(#arrowhead)');
  g.appendChild(line);

  if (item.label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const bg = document.createElementNS(SVG_NS, 'rect');
    const textLen = item.label.length * 7 + 12;
    bg.setAttribute('x', mx - textLen / 2);
    bg.setAttribute('y', my - 10);
    bg.setAttribute('width', textLen);
    bg.setAttribute('height', 20);
    bg.setAttribute('rx', '3');
    bg.setAttribute('fill', 'var(--bg)');
    bg.setAttribute('stroke', 'var(--connector-stroke)');
    bg.setAttribute('stroke-width', '0.5');
    g.appendChild(bg);

    const txt = document.createElementNS(SVG_NS, 'text');
    txt.setAttribute('x', mx);
    txt.setAttribute('y', my + 4);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', 'var(--fg)');
    txt.setAttribute('font-size', '12');
    txt.textContent = item.label;
    g.appendChild(txt);
  }
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

function appendWrappedText(g, text, x, startY, maxWidth, fontSize) {
  if (!text) return;
  const charsPerLine = Math.max(8, Math.floor(maxWidth / (fontSize * 0.6)));
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (test.length > charsPerLine && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const textEl = document.createElementNS(SVG_NS, 'text');
  textEl.setAttribute('fill', 'var(--fg)');
  textEl.setAttribute('font-size', fontSize);
  textEl.setAttribute('aria-hidden', 'true');

  lines.slice(0, 8).forEach((l, i) => {
    const tspan = document.createElementNS(SVG_NS, 'tspan');
    tspan.setAttribute('x', x);
    tspan.setAttribute('y', startY + i * (fontSize * 1.35));
    tspan.textContent = i === 7 && lines.length > 8 ? l.slice(0, -1) + '…' : l;
    textEl.appendChild(tspan);
  });

  g.appendChild(textEl);
}

function updateFocusableItems() {
  const groups = itemsGroup.querySelectorAll('.canvas-item');
  groups.forEach((g, i) => {
    g.setAttribute('tabindex', i === focusedIndex ? '0' : '-1');
  });
  if (groups.length > 0 && focusedIndex === -1) {
    groups[0].setAttribute('tabindex', '0');
  }
}

function onKeyDown(e) {
  const groups = Array.from(itemsGroup.querySelectorAll('.canvas-item'));
  if (groups.length === 0) return;

  const active = document.activeElement;
  const idx = groups.indexOf(active);
  if (idx === -1) return;

  const id = active.getAttribute('data-id');
  const item = state.getItem(id);

  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!item || item.type === 'connector') return;
      e.preventDefault();
      const step = e.shiftKey ? LARGE_STEP : SMALL_STEP;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      state.moveItem(id, dx, dy);
      requestAnimationFrame(() => {
        const updated = itemsGroup.querySelector(`[data-id="${id}"]`);
        if (updated) updated.focus();
      });
      break;
    }
    case 'Tab': {
      const dir = e.shiftKey ? -1 : 1;
      const next = idx + dir;
      if (next >= 0 && next < groups.length) {
        e.preventDefault();
        focusedIndex = next;
        updateFocusableItems();
        groups[next].focus();
        const nextId = groups[next].getAttribute('data-id');
        state.setSelectedId(nextId);
      }
      break;
    }
    case 'Enter': {
      e.preventDefault();
      if (id) {
        const event = new CustomEvent('item-edit', { detail: { id }, bubbles: true });
        svg.dispatchEvent(event);
      }
      break;
    }
    case 'Delete':
    case 'Backspace': {
      e.preventDefault();
      if (id) {
        state.removeItem(id);
        focusedIndex = Math.min(focusedIndex, groups.length - 2);
        if (focusedIndex < 0) focusedIndex = 0;
        requestAnimationFrame(() => {
          const newGroups = itemsGroup.querySelectorAll('.canvas-item');
          if (newGroups[focusedIndex]) {
            newGroups[focusedIndex].focus();
          }
        });
      }
      break;
    }
    case 'Escape': {
      state.setSelectedId(null);
      break;
    }
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

function onPointerDown(e) {
  const g = e.target.closest('.canvas-item');
  if (g) {
    const id = g.getAttribute('data-id');
    const item = state.getItem(id);
    state.setSelectedId(id);

    const groups = Array.from(itemsGroup.querySelectorAll('.canvas-item'));
    focusedIndex = groups.indexOf(g);
    updateFocusableItems();
    g.focus();

    if (item && item.type !== 'connector') {
      const svgPt = screenToSvg(e.clientX, e.clientY);
      dragState = {
        id,
        startX: svgPt.x,
        startY: svgPt.y,
        itemStartX: item.x,
        itemStartY: item.y,
        moved: false
      };
      svg.setPointerCapture(e.pointerId);
    }
  } else {
    state.setSelectedId(null);
  }
}

function onPointerMove(e) {
  if (!dragState) return;
  const svgPt = screenToSvg(e.clientX, e.clientY);
  const dx = svgPt.x - dragState.startX;
  const dy = svgPt.y - dragState.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    dragState.moved = true;
  }
  if (!dragState.moved) return;

  const item = state.getItem(dragState.id);
  if (!item) return;

  if (!dragState.snapshotPushed) {
    history.pushState(state.getSnapshot());
    dragState.snapshotPushed = true;
  }

  item.x = Math.round(dragState.itemStartX + dx);
  item.y = Math.round(dragState.itemStartY + dy);
  render();
  const g = itemsGroup.querySelector(`[data-id="${dragState.id}"]`);
  if (g) g.focus();
}

function onPointerUp(e) {
  if (dragState) {
    if (dragState.moved) {
      const item = state.getItem(dragState.id);
      if (item) {
        announce(`Déplacé en ${item.x}, ${item.y}`);
      }
    } else {
      if (e.detail >= 2) {
        const event = new CustomEvent('item-edit', { detail: { id: dragState.id }, bubbles: true });
        svg.dispatchEvent(event);
      }
    }
    svg.releasePointerCapture(e.pointerId);
    dragState = null;
  }
}

export function focusItem(id) {
  const groups = Array.from(itemsGroup.querySelectorAll('.canvas-item'));
  const g = groups.find(el => el.getAttribute('data-id') === id);
  if (g) {
    focusedIndex = groups.indexOf(g);
    updateFocusableItems();
    g.focus();
    state.setSelectedId(id);
  }
}

export function getViewCenter() {
  const w = BASE_W / zoom;
  const h = BASE_H / zoom;
  return { x: Math.round(panX + w / 2), y: Math.round(panY + h / 2) };
}

export function getSvgElement() {
  return svg;
}
