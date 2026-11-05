import * as state from '../state.js';
import * as O from '../objects.js';
import * as L from '../lines.js';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#1b1740', PRIMARY = '#4a2fcc', LINE = '#5b6170', PAPER = '#ffffff', MUTED = '#b9b5d4';
const LINE_HEX = { auto: LINE, violet: '#4a2fcc', red: '#c4141f', blue: '#1f5fd1', green: '#1a7f37', orange: '#b45309' };

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function bars(svg, x, y, w, h, count = 3, fill = MUTED) {
  const height = Math.max(h / (count * 2 + 1), 2);
  for (let i = 0; i < count; i++) {
    el('rect', { x, y: y + height * (i * 2 + 1), width: w * (i === count - 1 ? 0.6 : 0.95), height, rx: height / 2, fill, opacity: 0.8 }, svg);
  }
}

function wrapLines(text, maxChars, maxLines) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) { line = next; continue; }
    if (line) lines.push(line);
    line = word.slice(0, maxChars);
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(1, maxChars - 1))}…`; }
  return lines;
}

/* Écrit le texte s'il reste lisible à l'écran, sinon dessine des barres. */
function label(svg, ctx, text, x, y, w, h, { color = INK, bold = false, center = false, barFill } = {}) {
  if (!text) return;
  const fs = ctx.minFont / ctx.scale;
  const maxChars = Math.floor(w / (fs * 0.56));
  const maxLines = Math.floor(h / (fs * 1.25));
  if (maxChars < 6 || maxLines < 1 || (!ctx.large && !bold)) {
    const n = Math.min(3, Math.max(1, Math.ceil(String(text).length / 18)));
    bars(svg, x + w * 0.05, y + h * 0.15, w * 0.9, h * 0.7, n, barFill || (color === INK ? MUTED : color));
    return;
  }
  const lines = wrapLines(text, maxChars, maxLines);
  const top = y + (h - lines.length * fs * 1.25) / 2 + fs;
  lines.forEach((line, i) => {
    const t = el('text', { x: center ? x + w / 2 : x, y: top + i * fs * 1.25, 'font-size': fs, fill: color, 'font-family': 'system-ui, sans-serif', 'font-weight': bold ? 700 : 400, 'text-anchor': center ? 'middle' : 'start', 'aria-hidden': 'true' }, svg);
    t.textContent = line;
  });
}

function drawLine(svg, item, find) {
  const G = L.geometry(item, find);
  if (!G) return;
  const color = LINE_HEX[item.stroke] || LINE;
  const width = Math.max(item.strokeWidth || 2, 2);
  const path = el('path', { d: G.body, fill: 'none', stroke: color, 'stroke-width': width }, svg);
  const dash = L.dashOf(item);
  if (dash) path.setAttribute('stroke-dasharray', dash);
  const size = L.capSize(width) * 1.4;
  for (const [cap, p, dir] of [[item.startCap, G.start, G.startDir], [item.endCap, G.end, G.endDir]]) {
    const shape = L.capShape(cap, p, dir, size);
    if (shape) el(shape.tag, { ...shape.attrs, fill: shape.filled ? color : 'none', stroke: color, 'stroke-width': width }, svg);
  }
}

function drawItem(svg, i, ctx, find) {
  const { x, y, width: w = 200, height: h = 140 } = i;
  switch (i.type) {
    case 'frame':
      el('rect', { x, y, width: w, height: h, rx: 4, fill: PAPER, 'fill-opacity': 0.75, stroke: '#9d99c2', 'stroke-width': 2 }, svg);
      break;
    case 'sticky_note': {
      const bg = (state.PALETTE.find(c => c[0] === i.color) || state.PALETTE[0])[2];
      el('rect', { x, y, width: w, height: h, rx: 4, fill: bg, stroke: 'rgba(27,23,64,.25)', 'stroke-width': 1 }, svg);
      label(svg, ctx, i.content, x + 6, y + 6, w - 12, h - 12, { center: true, color: i.color === 'black' ? '#ffffff' : INK, barFill: 'rgba(27,23,64,.45)' });
      break;
    }
    case 'shape': {
      const attrs = { fill: '#f2f1fa', stroke: INK, 'stroke-width': 2 };
      if (i.shape === 'circle') el('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...attrs }, svg);
      else if (i.shape === 'diamond') el('polygon', { points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`, ...attrs }, svg);
      else if (i.shape === 'triangle') el('polygon', { points: `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`, ...attrs }, svg);
      else el('rect', { x, y, width: w, height: h, rx: 2, ...attrs }, svg);
      label(svg, ctx, i.content, x + w * 0.1, y + h * 0.15, w * 0.8, h * 0.7, { center: true, bold: ctx.large });
      break;
    }
    case 'text':
      label(svg, ctx, i.content, x, y, w, h, { bold: i.bold || ctx.large });
      break;
    case 'card':
      el('rect', { x, y, width: w, height: h, rx: 6, fill: PAPER, stroke: '#8580b3', 'stroke-width': 1.5 }, svg);
      el('rect', { x, y, width: w, height: Math.min(32, h / 3), rx: 6, fill: PRIMARY }, svg);
      label(svg, ctx, i.title, x + 6, y + 1, w - 12, Math.min(30, h / 3), { color: '#ffffff', barFill: '#ffffff' });
      label(svg, ctx, i.content, x + 8, y + 38, w - 16, h - 44);
      break;
    case 'kanban':
      el('rect', { x, y, width: w, height: h, rx: 8, fill: '#ecebf8', stroke: '#8580b3', 'stroke-width': 1.5 }, svg);
      O.kanbanGeom(i).forEach((g, c) => {
        el('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 6, fill: '#f7f7fb', stroke: '#bdb8de' }, svg);
        label(svg, ctx, i.columns[c].name, g.x + 4, g.y + 2, g.w - 8, 26, { bold: true });
        g.cards.forEach((b, k) => {
          el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4, fill: PAPER, stroke: '#8580b3' }, svg);
          label(svg, ctx, i.columns[c].cards[k].text, b.x + 4, b.y + 2, b.w - 8, b.h - 4);
        });
      });
      break;
    case 'datatable':
      i.rows.forEach((row, r) => row.forEach((v, c) => {
        const b = O.cellBox(i, r, c);
        el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: r ? PAPER : '#dcd6ff', stroke: '#8580b3' }, svg);
        if (v) label(svg, ctx, v, b.x + 4, b.y + 2, b.w - 8, b.h - 4, { bold: !r && ctx.large });
      }));
      break;
    case 'mindmap': {
      const root = !i.parentNode;
      const parent = find(i.parentNode);
      if (parent) {
        const sx = parent.x + parent.width, sy = parent.y + parent.height / 2, ex = x, ey = y + h / 2, mx = (sx + ex) / 2;
        el('path', { d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`, fill: 'none', stroke: PRIMARY, 'stroke-width': 2 }, svg);
      }
      el('rect', { x, y, width: w, height: h, rx: root ? 14 : 10, fill: root ? PRIMARY : PAPER, stroke: PRIMARY, 'stroke-width': 2 }, svg);
      label(svg, ctx, i.content, x + 6, y + 2, w - 12, h - 4, { center: true, color: root ? '#ffffff' : INK, barFill: root ? '#ffffff' : MUTED, bold: ctx.large });
      break;
    }
    case 'code':
      el('rect', { x, y, width: w, height: h, rx: 6, fill: '#1e1b2e' }, svg);
      bars(svg, x + 12, y + 14, w - 24, h - 24, 5, '#c9b5ff');
      break;
    case 'flipcard':
      el('rect', { x, y, width: w, height: h, rx: 10, fill: PAPER, stroke: PRIMARY, 'stroke-width': 2 }, svg);
      el('circle', { cx: x + w - 18, cy: y + 18, r: 11, fill: PRIMARY }, svg);
      label(svg, ctx, i.content, x + 12, y + 28, w - 24, h - 36, { center: true });
      break;
    case 'drawing':
      break;
    default:
      el('rect', { x, y, width: w, height: h, fill: '#ecebf8', stroke: '#8580b3' }, svg);
  }
}

function drawFrameTitle(svg, i, ctx) {
  if (!i.content) return;
  const fs = ctx.minFont / ctx.scale, h = fs * 1.5, w = i.width || 200;
  el('rect', { x: i.x, y: i.y, width: w, height: Math.min(h, i.height || h), fill: '#ecebf8', stroke: '#9d99c2' }, svg);
  label(svg, ctx, i.content, i.x + fs * 0.4, i.y, w - fs * 0.8, h, { bold: true });
}

const NAMES = [['frame', 'cadre'], ['sticky_note', 'post-it'], ['shape', 'forme'], ['card', 'carte'], ['connector', 'ligne'], ['kanban', 'kanban'], ['datatable', 'tableau'], ['mindmap', 'nœud'], ['text', 'texte']];

export function describeContent(items) {
  const parts = NAMES.map(([type, name]) => {
    const n = items.filter(i => i.type === type).length;
    return n ? `${n} ${name}${n > 1 && !name.endsWith('s') && name !== 'post-it' && name !== 'kanban' ? 's' : ''}` : '';
  }).filter(Boolean);
  return parts.join(', ') || 'tableau vide';
}

export function preview(snapshot, { width = 300, large = false } = {}) {
  const items = snapshot.items.map(i => {
    const copy = state.normalizeItem(JSON.parse(JSON.stringify(i)));
    if (copy.type === 'kanban') Object.assign(copy, O.kanbanSize(copy));
    if (copy.type === 'datatable') Object.assign(copy, O.tableSize(copy));
    return copy;
  });
  const find = id => items.find(i => i.id === id);
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('template-preview');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Aperçu de ${snapshot.name} : ${describeContent(items)}`);
  const boxOf = i => {
    if (i.type === 'connector') return L.geometry(i, find)?.bbox;
    if (i.type === 'text') return { x: i.x, y: i.y, w: Math.min(i.width || 200, String(i.content || '').length * (Number(i.fontSize) || 16) * 0.55), h: i.height || 40 };
    return { x: i.x, y: i.y, w: i.width || 200, h: i.height || 40 };
  };
  const boxes = items.map(boxOf).filter(Boolean);
  if (!boxes.length) {
    svg.setAttribute('viewBox', '0 0 300 180');
    el('rect', { x: 110, y: 50, width: 80, height: 80, rx: 12, fill: 'none', stroke: '#8580b3', 'stroke-width': 2, 'stroke-dasharray': '6 4' }, svg);
    el('path', { d: 'M150 72V108M132 90H168', stroke: PRIMARY, 'stroke-width': 4, 'stroke-linecap': 'round' }, svg);
    return svg;
  }
  const pad = 24;
  const x = Math.min(...boxes.map(b => b.x)) - pad, y = Math.min(...boxes.map(b => b.y)) - pad;
  const w = Math.max(...boxes.map(b => b.x + b.w)) + pad - x, h = Math.max(...boxes.map(b => b.y + b.h)) + pad - y;
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const height = large ? width * 0.56 : width * 0.62;
  const ctx = { large, minFont: large ? 13 : 12, scale: Math.min(width / w, height / h) };
  for (const item of items) if (item.type !== 'connector') drawItem(svg, item, ctx, find);
  for (const item of items) if (item.type === 'connector') drawLine(svg, item, find);
  for (const item of items) if (item.type === 'frame') drawFrameTitle(svg, item, ctx);
  return svg;
}
