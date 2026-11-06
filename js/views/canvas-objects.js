import * as state from '../state.js';
import * as O from '../objects.js';
import { announce } from '../a11y/announcer.js';
import { svgEl, appendLayoutText, wrapText, measureText, textLayout, focusSub, focusItem } from './canvas.js';
import { openField as editField } from './inline-editor.js';

const CODE_INK = { '': '#f1eeff', keyword: '#c9b5ff', string: '#a8e6a1', number: '#ffcf8a', comment: '#b5b0cc' };
let flippedNow = null;

function text(x, y, content, attrs = {}) {
  const t = svgEl('text', { x, y, 'aria-hidden': 'true', ...attrs });
  t.textContent = content;
  return t;
}

function fit(str, w, fs) {
  if (measureText(str, fs) <= w) return str;
  let n = str.length;
  while (n > 0 && measureText(str.slice(0, n) + '…', fs) > w) n--;
  return str.slice(0, n) + '…';
}

export function renderDrawing(g, item) {
  const { x, y, width: w, height: h } = item;
  g.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: 'transparent', stroke: 'none', 'pointer-events': 'none' }));
  const inner = svgEl('g', { transform: `translate(${x} ${y}) scale(${w / item.vw} ${h / item.vh})` });
  const pts = [];
  for (let i = 0; i < item.points.length; i += 2) pts.push(`${item.points[i]},${item.points[i + 1]}`);
  const points = pts.join(' ');
  const sw = item.strokeWidth;
  inner.append(
    svgEl('polyline', { points, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(16, sw + 10), 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round', class: 'drawing-hit' }),
    svgEl('polyline', { points, fill: 'none', stroke: O.hexOf(O.PEN_COLORS, item.stroke), 'stroke-width': sw, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' })
  );
  g.appendChild(inner);
  if (item.content) g.appendChild(text(x, y + h + 16, item.content, { fill: 'var(--fg)', 'font-size': 13, class: 'item-text' }));
}

export function renderComment(g, item) {
  const n = item.messages.length;
  g.append(
    svgEl('circle', { cx: item.x + 14, cy: item.y + 14, r: 14, fill: item.resolved ? '#5d5a72' : 'var(--primary)', stroke: 'var(--bg)', 'stroke-width': 2 }),
    text(item.x + 14, item.y + 18.5, item.resolved ? '✓' : String(n || '+'), { fill: item.resolved ? '#ffffff' : 'var(--on-primary)', 'font-size': 13, 'font-weight': 'bold', 'text-anchor': 'middle' })
  );
}

export function renderMindmap(g, item) {
  const root = !item.parentNode;
  const kids = state.mindChildren(item.id).length;
  g.appendChild(svgEl('rect', { x: item.x, y: item.y, width: item.width, height: item.height, rx: root ? 14 : 10, fill: root ? 'var(--primary)' : 'var(--card-bg)', stroke: 'var(--primary)', 'stroke-width': 2 }));
  const parent = state.getItem(item.parentNode);
  if (parent) {
    const sx = parent.x + parent.width, sy = parent.y + parent.height / 2, ex = item.x, ey = item.y + item.height / 2, mx = (sx + ex) / 2;
    g.appendChild(svgEl('path', { d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`, fill: 'none', stroke: 'var(--primary)', 'stroke-width': 2, 'pointer-events': 'none' }));
  }
  if (item.content) appendLayoutText(g, item, root ? 'var(--on-primary)' : 'var(--fg)');
  else g.appendChild(text(item.x + item.width / 2, item.y + item.height / 2 + 5, root ? 'Idée centrale' : 'Nouvelle idée', { fill: root ? 'var(--on-primary)' : 'var(--fg)', 'font-size': 14, 'font-style': 'italic', 'text-anchor': 'middle', opacity: 0.85, 'aria-hidden': 'true' }));
  if (kids) {
    const cx = item.x + item.width - 14, cy = item.y + item.height / 2;
    const toggle = svgEl('g', { 'data-action': 'toggle-mind', class: 'mind-toggle' });
    toggle.append(
      svgEl('circle', { cx, cy, r: 12, fill: 'var(--bg)', stroke: 'var(--primary)', 'stroke-width': 1.5 }),
      text(cx, cy + 4.5, item.collapsed ? String(kids) : '−', { fill: 'var(--fg)', 'font-size': 12, 'font-weight': 'bold', 'text-anchor': 'middle' })
    );
    g.appendChild(toggle);
  }
}

export function renderFlipcard(g, item) {
  const { x, y, width: w, height: h } = item;
  g.appendChild(svgEl('rect', { x, y, width: w, height: h, rx: 10, fill: item.flipped ? 'var(--surface)' : 'var(--card-bg)', stroke: 'var(--primary)', 'stroke-width': 2 }));
  g.appendChild(text(x + 12, y + 18, item.flipped ? 'VERSO' : 'RECTO', { fill: 'var(--fg)', 'font-size': 11, 'font-weight': 'bold', 'letter-spacing': 1 }));
  const btn = svgEl('g', { 'data-action': 'flip', class: 'flip-btn' });
  btn.append(
    svgEl('circle', { cx: x + w - 18, cy: y + 18, r: 13, fill: 'var(--primary)' }),
    text(x + w - 18, y + 23, '⟲', { fill: 'var(--on-primary)', 'font-size': 15, 'text-anchor': 'middle' })
  );
  g.appendChild(btn);
  appendLayoutText(g, { ...item, content: item.flipped ? item.back : item.content }, 'var(--fg)');
  if (flippedNow === item.id) { g.classList.add('flip-anim'); flippedNow = null; }
}

export function renderCode(g, item) {
  const { x, y, width: w, height: h } = item;
  g.appendChild(svgEl('rect', { x, y, width: w, height: h, rx: 6, fill: '#1e1b2e', stroke: 'var(--border)', 'stroke-width': 1 }));
  g.appendChild(text(x + 10, y + 19, O.LANGUAGES[item.language] || 'Texte brut', { fill: '#c9c3ff', 'font-size': 12, 'font-weight': 'bold' }));
  const copy = svgEl('g', { 'data-action': 'copy-code', class: 'code-copy' });
  copy.append(svgEl('rect', { x: x + w - 62, y: y + 4, width: 56, height: 22, rx: 4, fill: '#3a3456' }), text(x + w - 34, y + 19, 'Copier', { fill: '#ffffff', 'font-size': 11, 'text-anchor': 'middle' }));
  g.appendChild(copy);
  const L = textLayout(item);
  const t = svgEl('text', { 'font-size': L.fs, 'font-family': 'ui-monospace, Consolas, monospace', 'aria-hidden': 'true', class: 'item-text code-text' });
  t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  L.lines.forEach((line, i) => {
    let first = true;
    for (const tok of O.highlight(line || ' ', item.language)) {
      const span = svgEl('tspan', { fill: CODE_INK[tok.kind] });
      if (first) { span.setAttribute('x', L.box.x); span.setAttribute('y', L.box.y + i * L.lh + L.fs); first = false; }
      if (tok.kind === 'comment') span.setAttribute('font-style', 'italic');
      span.textContent = tok.text;
      t.appendChild(span);
    }
  });
  g.appendChild(t);
}

export function renderKanban(g, item) {
  const { x, y, width: w, height: h } = item;
  g.appendChild(svgEl('rect', { x, y, width: w, height: h, rx: 8, fill: 'var(--surface)', stroke: 'var(--border)', 'stroke-width': 1 }));
  g.appendChild(text(x + 10, y + 22, fit(item.content || 'Kanban', w - 20, 14), { fill: 'var(--fg)', 'font-size': 14, 'font-weight': 'bold', class: 'item-text' }));
  O.kanbanGeom(item).forEach((geo, c) => {
    const col = item.columns[c];
    const n = col.cards.length;
    const cg = svgEl('g', { role: 'list', tabindex: '-1', 'data-sub': `col:${col.id}`, 'aria-label': `Colonne ${col.name}, ${n} carte${n > 1 ? 's' : ''}`, class: 'kanban-col' });
    cg.append(
      svgEl('rect', { x: geo.x, y: geo.y, width: geo.w, height: geo.h, rx: 6, fill: 'var(--bg)', stroke: 'var(--border)', 'stroke-width': 1, class: 'sub-focus' }),
      text(geo.x + 8, geo.y + 20, fit(`${col.name} (${n})`, geo.w - 16, 13), { fill: 'var(--fg)', 'font-size': 13, 'font-weight': 'bold' })
    );
    col.cards.forEach((card, k) => {
      const b = geo.cards[k];
      const kg = svgEl('g', { role: 'listitem', tabindex: '-1', 'data-sub': `card:${card.id}`, 'aria-label': `${card.text || '(vide)'}, ${k + 1} sur ${n}`, class: 'kanban-card' });
      kg.appendChild(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4, fill: 'var(--card-bg)', stroke: 'var(--card-border)', 'stroke-width': 1, class: 'sub-focus' }));
      wrapText(card.text || '', b.w - 12, 12).slice(0, 2).forEach((line, i) => kg.appendChild(text(b.x + 6, b.y + 17 + i * 15, line, { fill: 'var(--fg)', 'font-size': 12 })));
      cg.appendChild(kg);
    });
    const addY = geo.y + O.KB.colHead + n * (O.KB.cardH + O.KB.gap);
    const add = svgEl('g', { 'data-action': 'kanban-add', 'data-col': c, class: 'kanban-add' });
    add.append(svgEl('rect', { x: geo.x + 6, y: addY, width: geo.w - 12, height: 28, rx: 4, fill: 'transparent', stroke: 'var(--border)', 'stroke-dasharray': '4 3' }), text(geo.x + 14, addY + 18, '+ Carte', { fill: 'var(--fg)', 'font-size': 12 }));
    cg.appendChild(add);
    g.appendChild(cg);
  });
}

export function renderDatatable(g, item) {
  const { x, y, width: w, height: h } = item;
  g.appendChild(svgEl('rect', { x, y, width: w, height: h, rx: 4, fill: 'var(--card-bg)', stroke: 'var(--border)', 'stroke-width': 1 }));
  g.appendChild(text(x + 6, y + 19, fit(item.content || 'Tableau', w - 12, 13), { fill: 'var(--fg)', 'font-size': 13, 'font-weight': 'bold', class: 'item-text' }));
  const grid = svgEl('g', { role: 'grid', 'aria-label': item.content || 'Tableau de données', 'aria-rowcount': item.rows.length, 'aria-colcount': item.rows[0]?.length || 0 });
  item.rows.forEach((row, r) => {
    const rg = svgEl('g', { role: 'row', 'aria-rowindex': r + 1 });
    row.forEach((value, c) => {
      const b = O.cellBox(item, r, c);
      const cell = svgEl('g', { role: r === 0 ? 'columnheader' : 'gridcell', tabindex: '-1', 'data-sub': `cell:${r}:${c}`, 'aria-colindex': c + 1, 'aria-label': value || 'vide', class: 'table-cell' });
      cell.append(
        svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: r === 0 ? 'var(--surface)' : 'var(--card-bg)', stroke: 'var(--border)', 'stroke-width': 1, class: 'sub-focus' }),
        text(b.x + 6, b.y + 19, fit(value, b.w - 12, 12), { fill: 'var(--fg)', 'font-size': 12, 'font-weight': r === 0 ? 'bold' : 'normal' })
      );
      rg.appendChild(cell);
    });
    grid.appendChild(rg);
  });
  g.appendChild(grid);
}

export function renderDecorations(g, item, box) {
  const tags = (item.tags || []).map(state.getTag).filter(Boolean);
  if (tags.length && O.TAG_TYPES.includes(item.type)) {
    let tx = box.x + 8;
    const ty = box.y + box.h - 24;
    for (const tag of tags) {
      const tw = measureText(tag.name, 11) + 14;
      if (tx + tw > box.x + box.w - 6) break;
      g.append(svgEl('rect', { x: tx, y: ty, width: tw, height: 18, rx: 9, fill: O.hexOf(O.TAG_COLORS, tag.color), class: 'tag-pill' }), text(tx + 7, ty + 13, tag.name, { fill: '#ffffff', 'font-size': 11 }));
      tx += tw + 4;
    }
  }
  const reacts = O.REACTIONS.filter(([e]) => item.reactions?.[e]?.length);
  if (reacts.length) {
    let rx = box.x;
    const ry = box.y + box.h + (item.locked ? 24 : 4);
    for (const [e] of reacts) {
      const label = `${e} ${item.reactions[e].length}`;
      const rw = measureText(label, 12) + 14;
      g.append(svgEl('rect', { x: rx, y: ry, width: rw, height: 22, rx: 11, fill: 'var(--surface)', stroke: 'var(--border)', class: 'reaction-pill' }), text(rx + 7, ry + 15.5, label, { fill: 'var(--fg)', 'font-size': 12 }));
      rx += rw + 4;
    }
  }
}

/* Actions */
export function flip(id) {
  const item = state.getItem(id);
  if (item?.type !== 'flipcard') return;
  flippedNow = id;
  state.viewToggle(id, i => { i.flipped = !i.flipped; }, () => {
    const it = state.getItem(id);
    return `${it.flipped ? 'Verso' : 'Recto'} visible : ${(it.flipped ? it.back : it.content) || '(vide)'}`;
  });
}

export async function copyCode(id) {
  const item = state.getItem(id);
  if (!item) return;
  try { await navigator.clipboard.writeText(item.content || ''); announce('Code copié dans le presse-papiers'); }
  catch { announce('Copie impossible : presse-papiers indisponible'); }
}

function findCard(item, cardId) {
  for (let c = 0; c < item.columns.length; c++) {
    const k = item.columns[c].cards.findIndex(card => card.id === cardId);
    if (k >= 0) return { c, k };
  }
  return null;
}

export function activeColumn(item, sub) {
  if (!sub) return 0;
  const [kind, ref] = sub.split(':');
  if (kind === 'col') return Math.max(0, item.columns.findIndex(col => col.id === ref));
  if (kind === 'card') return findCard(item, ref)?.c ?? 0;
  return 0;
}

export function moveCard(id, cardId, toCol, toPos) {
  const item = state.getItem(id);
  const from = item && findCard(item, cardId);
  if (!from || toCol < 0 || toCol >= item.columns.length) return;
  const target = item.columns[toCol];
  const pos = Math.max(0, Math.min(toPos, target.cards.length - (from.c === toCol ? 1 : 0)));
  if (from.c === toCol && from.k === pos) return;
  const done = state.mutateItem(id, it => {
    const [card] = it.columns[from.c].cards.splice(from.k, 1);
    it.columns[toCol].cards.splice(pos, 0, card);
    return card;
  }, card => `Carte ${card.text || '(vide)'} déplacée dans ${target.name}, position ${pos + 1} sur ${target.cards.length}`);
  if (done) focusSub(id, `card:${cardId}`);
}

export function addCard(id, col, pos) {
  const item = state.getItem(id);
  if (!item) return;
  const card = { id: O.uid('card'), text: '' };
  const c = item.columns[col] ? col : 0;
  if (!state.mutateItem(id, it => { const list = it.columns[c].cards; list.splice(pos ?? list.length, 0, card); }, `Carte ajoutée dans ${item.columns[c].name}`)) return;
  focusSub(id, `card:${card.id}`);
  editSub(id, `card:${card.id}`);
}

export function addColumn(id) {
  const col = { id: O.uid('col'), name: 'Nouvelle colonne', cards: [] };
  if (!state.mutateItem(id, it => { it.columns.push(col); }, 'Colonne ajoutée')) return;
  focusSub(id, `col:${col.id}`);
  editSub(id, `col:${col.id}`);
}

export function removeColumn(id, c) {
  const item = state.getItem(id);
  if (!item || item.columns.length < 2) { announce('Un kanban garde au moins une colonne'); return; }
  const col = item.columns[c];
  state.mutateItem(id, it => { it.columns.splice(c, 1); }, `Colonne ${col.name} supprimée avec ${col.cards.length} carte(s), annuler possible`);
  const next = state.getItem(id)?.columns[Math.min(c, item.columns.length - 1)];
  if (next) focusSub(id, `col:${next.id}`);
}

export function tableAdd(id, kind, at) {
  const item = state.getItem(id);
  if (!item) return;
  state.mutateItem(id, it => {
    if (kind === 'row') it.rows.splice(at + 1, 0, it.rows[0].map(() => ''));
    else it.rows.forEach((r, n) => r.splice(at + 1, 0, n === 0 ? `Colonne ${r.length + 1}` : ''));
  }, kind === 'row' ? 'Ligne ajoutée' : 'Colonne ajoutée');
  focusSub(id, kind === 'row' ? `cell:${at + 1}:0` : `cell:0:${at + 1}`);
}

export function tableRemove(id, kind, at) {
  const item = state.getItem(id);
  if (!item) return;
  if (kind === 'row' && (at < 1 || item.rows.length < 3)) { announce(at < 1 ? 'La ligne d’en-tête ne peut pas être supprimée' : 'Le tableau garde au moins une ligne'); return; }
  if (kind === 'col' && item.rows[0].length < 2) { announce('Le tableau garde au moins une colonne'); return; }
  state.mutateItem(id, it => { if (kind === 'row') it.rows.splice(at, 1); else it.rows.forEach(r => r.splice(at, 1)); }, kind === 'row' ? 'Ligne supprimée' : 'Colonne supprimée');
  const it = state.getItem(id);
  focusSub(id, kind === 'row' ? `cell:${Math.min(at, it.rows.length - 1)}:0` : `cell:0:${Math.min(at, it.rows[0].length - 1)}`);
}

export function editSub(id, sub) {
  const item = state.getItem(id);
  if (!item || state.isLocked(id)) return;
  const [kind, a, b] = sub.split(':');
  if (kind === 'card' || kind === 'col') {
    const geo = O.kanbanGeom(item);
    if (kind === 'card') {
      const pos = findCard(item, a);
      if (!pos) return;
      const card = item.columns[pos.c].cards[pos.k];
      editField({ id, sub, box: geo[pos.c].cards[pos.k], value: card.text, label: 'Texte de la carte', onCommit: v => state.mutateItem(id, it => { findCardIn(it, a).text = v; }, 'Carte modifiée') });
    } else {
      const c = item.columns.findIndex(col => col.id === a);
      const g = geo[c];
      editField({ id, sub, box: { x: g.x, y: g.y, w: g.w, h: O.KB.colHead }, value: item.columns[c].name, label: 'Nom de la colonne', singleLine: true, onCommit: v => state.mutateItem(id, it => { it.columns.find(col => col.id === a).name = v || 'Sans nom'; }, `Colonne renommée : ${v || 'Sans nom'}`) });
    }
  } else if (kind === 'cell') {
    const r = Number(a), c = Number(b);
    editField({ id, sub, box: O.cellBox(item, r, c), value: item.rows[r][c], label: `Cellule ligne ${r + 1}, colonne ${c + 1}`, singleLine: true, onCommit: v => state.mutateItem(id, it => { it.rows[r][c] = v; }, 'Cellule modifiée') });
  }
}

function findCardIn(item, cardId) {
  for (const col of item.columns) { const card = col.cards.find(k => k.id === cardId); if (card) return card; }
  return {};
}

export function onSubKey(e, item, sub) {
  const [kind, a, b] = sub.split(':');
  const ctrl = e.ctrlKey || e.metaKey;
  const go = s => { e.preventDefault(); focusSub(item.id, s); };
  if (e.key === 'Escape') { e.preventDefault(); focusItem(item.id); return true; }
  if ((e.key === 'Enter' || e.key === 'F2') && !ctrl) { e.preventDefault(); editSub(item.id, sub); return true; }
  if (item.type === 'kanban') {
    const cols = item.columns;
    const c = activeColumn(item, sub);
    const colSub = n => `col:${cols[n].id}`;
    const cardSub = (n, k) => `card:${cols[n].cards[k].id}`;
    if (kind === 'col') {
      if (e.key === 'ArrowDown' && cols[c].cards.length) return go(cardSub(c, 0)), true;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !ctrl) { const n = c + (e.key === 'ArrowRight' ? 1 : -1); if (cols[n]) go(colSub(n)); else e.preventDefault(); return true; }
      if (e.key === 'Insert') { e.preventDefault(); addCard(item.id, c); return true; }
      if (e.key === 'Delete') { e.preventDefault(); removeColumn(item.id, c); return true; }
      if (e.key.startsWith('Arrow')) { e.preventDefault(); return true; }
      return false;
    }
    const k = findCard(item, a)?.k ?? 0;
    const card = cols[c].cards[k];
    if (ctrl && !e.shiftKey && !e.altKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') moveCard(item.id, card.id, c + (e.key === 'ArrowRight' ? 1 : -1), k);
      else moveCard(item.id, card.id, c, k + (e.key === 'ArrowDown' ? 1 : -1));
      return true;
    }
    if (ctrl || e.altKey) return false;
    if (e.key === 'ArrowUp') return go(k ? cardSub(c, k - 1) : colSub(c)), true;
    if (e.key === 'ArrowDown') { if (cols[c].cards[k + 1]) go(cardSub(c, k + 1)); else e.preventDefault(); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const n = c + (e.key === 'ArrowRight' ? 1 : -1);
      if (!cols[n]) { e.preventDefault(); return true; }
      return go(cols[n].cards.length ? cardSub(n, Math.min(k, cols[n].cards.length - 1)) : colSub(n)), true;
    }
    if (e.key === 'Home' || e.key === 'End') return go(cardSub(c, e.key === 'Home' ? 0 : cols[c].cards.length - 1)), true;
    if (e.key === 'Insert') { e.preventDefault(); addCard(item.id, c, k + 1); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      state.mutateItem(item.id, it => { it.columns[c].cards.splice(k, 1); }, `Carte ${card.text || '(vide)'} supprimée, annuler possible`);
      const left = state.getItem(item.id).columns[c].cards;
      focusSub(item.id, left.length ? `card:${left[Math.min(k, left.length - 1)].id}` : colSub(c));
      return true;
    }
    return false;
  }
  if (item.type === 'datatable' && kind === 'cell') {
    if (ctrl && !['Home', 'End'].includes(e.key)) return false;
    const r = Number(a), c = Number(b), rows = item.rows.length, cols = item.rows[0].length;
    const moves = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], Home: ctrl ? [0, 0] : [r, 0], End: ctrl ? [rows - 1, cols - 1] : [r, cols - 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const [nr, nc] = moves[e.key];
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) focusSub(item.id, `cell:${nr}:${nc}`);
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (item.rows[r][c]) state.mutateItem(item.id, it => { it.rows[r][c] = ''; }, 'Cellule effacée');
      focusSub(item.id, sub);
      return true;
    }
  }
  return false;
}

export function enterSub(item) {
  if (item.type === 'kanban') {
    const col = item.columns.find(cl => cl.cards.length);
    focusSub(item.id, col ? `card:${col.cards[0].id}` : `col:${item.columns[0].id}`);
    announce('Entrée dans le kanban : flèches pour parcourir, Ctrl+flèches pour déplacer une carte, Insertion pour ajouter, Échap pour sortir');
    return true;
  }
  if (item.type === 'datatable') {
    focusSub(item.id, 'cell:0:0');
    announce('Entrée dans le tableau : flèches pour parcourir, Entrée pour modifier une cellule, Échap pour sortir');
    return true;
  }
  return false;
}

export function dropCard(id, cardId, pt) {
  const item = state.getItem(id);
  if (!item) return;
  const geo = O.kanbanGeom(item);
  let col = geo.findIndex(g => pt.x >= g.x && pt.x <= g.x + g.w + O.KB.pad);
  if (col < 0) col = pt.x < geo[0].x ? 0 : geo.length - 1;
  const others = item.columns[col].cards.filter(k => k.id !== cardId).length;
  const pos = Math.max(0, Math.min(others, Math.floor((pt.y - geo[col].y - O.KB.colHead + O.KB.cardH / 2) / (O.KB.cardH + O.KB.gap))));
  moveCard(id, cardId, col, pos);
}
