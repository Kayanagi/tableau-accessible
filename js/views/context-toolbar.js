import * as state from '../state.js';
import * as canvas from './canvas.js';
import * as clipboard from '../clipboard.js';
import { announce } from '../a11y/announcer.js';
import * as O from '../objects.js';
import * as obj from './canvas-objects.js';
import * as L from '../lines.js';

const TEXT_TYPES = ['sticky_note', 'shape', 'text', 'card', 'flipcard', 'mindmap'];
const ALIGN_ICONS = {
  left: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12M2 7h8M2 11h12M2 15h8"/></svg>',
  center: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12M4 7h8M2 11h12M4 15h8"/></svg>',
  right: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12M6 7h8M2 11h12M6 15h8"/></svg>'
};
let bar = null;
let container = null;
let menu = null;
let menuKey = null;
let onProperties = () => {};
let onNewTag = () => {};
let onOpenComment = () => {};
let activeKey = null;
let controls = [];

export function init(el, options) {
  container = el;
  onProperties = options.onProperties;
  onNewTag = options.onNewTag || onNewTag;
  onOpenComment = options.onOpenComment || onOpenComment;
  bar = document.createElement('div');
  bar.className = 'context-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Mise en forme de la sélection');
  bar.hidden = true;
  el.appendChild(bar);
  bar.addEventListener('keydown', onKey);
  bar.addEventListener('focusin', e => {
    const k = e.target.dataset.key;
    if (k) activeKey = k;
    if (k === 'start-cap' || k === 'end-cap') canvas.setActiveEnd(k === 'start-cap' ? 'start' : 'end');
  });
  bar.addEventListener('focusout', e => { if (menu && !bar.contains(e.relatedTarget)) closeMenu(false); });
  document.addEventListener('pointerdown', e => { if (menu && !bar.contains(e.target)) closeMenu(false); });
  state.subscribe(update);
  canvas.onView(place);
  addEventListener('resize', place);
}

export function focus() {
  if (bar.hidden) return false;
  (bar.querySelector('[tabindex="0"]') || bar.querySelector('button'))?.focus();
  return true;
}

function selection() {
  return state.getSelectedIds().map(state.getItem).filter(Boolean);
}

function idsOf(items, types) {
  return items.filter(i => !types || types.includes(i.type)).map(i => i.id);
}

function capIcon(cap, reverse) {
  const shape = L.capShape(cap, { x: reverse ? 4 : 28, y: 8 }, { x: reverse ? -1 : 1, y: 0 }, 9);
  let mark = '';
  if (shape) {
    const attrs = Object.entries(shape.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    mark = `<${shape.tag} ${attrs} fill="${shape.filled ? 'currentColor' : 'none'}"/>`;
  }
  const line = reverse ? `M${shape?.filled ? 10 : 4} 8H30` : `M2 8H${shape?.filled ? 22 : 28}`;
  return `<svg class="line-icon" viewBox="0 0 32 16" aria-hidden="true"><path d="${line}"/>${mark}</svg>`;
}

const TYPE_ICONS = { straight: 'M3 13L29 3', orthogonal: 'M3 13H16V3H29', bezier: 'M3 13C14 13 18 3 29 3' };
const typeIcon = t => `<svg class="line-icon" viewBox="0 0 32 16" aria-hidden="true"><path d="${TYPE_ICONS[t] || TYPE_ICONS.straight}"/></svg>`;
const styleIcon = s => `<svg class="line-icon" viewBox="0 0 32 16" aria-hidden="true"><path d="M2 8H30" ${s === 'dashed' ? 'stroke-dasharray="6 4"' : s === 'dotted' ? 'stroke-dasharray="0 4" stroke-linecap="round" style="stroke-width:2.4"' : ''}/></svg>`;
const widthIcon = w => `<svg class="line-icon" viewBox="0 0 32 16" aria-hidden="true"><path d="M2 8H30" style="stroke-width:${w}"/></svg>`;

function lineControls(links) {
  const ids = idsOf(links), first = links[0];
  const color = L.LINE_COLORS.find(c => c[0] === first.stroke) || L.LINE_COLORS[0];
  const locked = links.every(i => i.locked);
  return [
    { key: 'start-cap', label: `Début de ligne : ${L.CAPS[first.startCap]}. Extrémité active : Alt+flèches la déplace`, html: capIcon(first.startCap, true), menu: 'start-cap' },
    { key: 'reverse', label: 'Inverser les extrémités', html: '<span aria-hidden="true">⇄</span>', run: () => state.reverseLines(ids) },
    { key: 'end-cap', label: `Fin de ligne : ${L.CAPS[first.endCap]}. Extrémité active : Alt+flèches la déplace`, html: capIcon(first.endCap, false), menu: 'end-cap' },
    { key: 'line-type', label: `Type : ${L.LINE_TYPES[first.lineType]}`, html: typeIcon(first.lineType), menu: 'line-type' },
    { key: 'line-style', label: `Trait : ${L.LINE_STYLES[first.lineStyle]}`, html: styleIcon(first.lineStyle), menu: 'line-style' },
    { key: 'line-width', label: `Épaisseur : ${first.strokeWidth}`, html: widthIcon(first.strokeWidth), menu: 'line-width' },
    { key: 'line-color', label: `Couleur : ${color[1]}`, html: `<span class="swatch" style="background:${color[2]}" aria-hidden="true"></span>`, menu: 'line-color' },
    { key: 'line-text', label: 'Texte sur la ligne', text: 'T', run: () => canvas.edit(first.id) },
    { key: 'lock', label: locked ? 'Déverrouiller' : 'Verrouiller', text: '🔒', pressed: locked, run: () => state.toggleLockedMany(ids) },
    { key: 'more', label: 'Plus d’actions', text: '⋯', menu: 'more' }
  ];
}

function build(items) {
  if (items.every(i => i.type === 'connector')) return lineControls(items);
  const list = [];
  const notes = items.filter(i => i.type === 'sticky_note');
  const shapes = items.filter(i => i.type === 'shape');
  const texts = items.filter(i => TEXT_TYPES.includes(i.type));
  if (notes.length) {
    const c = state.PALETTE.find(p => p[0] === notes[0].color) || state.PALETTE[0];
    list.push({ key: 'color', label: `Couleur : ${c[1]}`, html: `<span class="swatch" style="background:${c[2]}" aria-hidden="true"></span>`, menu: 'color' });
  }
  if (shapes.length) list.push({ key: 'shape', label: `Type de forme : ${state.SHAPES[shapes[0].shape] || 'Rectangle'}`, text: 'Forme', menu: 'shape' });
  if (texts.length) {
    const ids = idsOf(texts);
    list.push(
      { key: 'font-auto', label: 'Taille du texte automatique', text: 'Auto', pressed: texts.every(i => i.fontSize === 'auto'), run: () => state.updateItems(ids, { fontSize: 'auto' }, 'Taille du texte automatique') },
      { key: 'font-down', label: 'Réduire le texte', text: 'A−', run: () => stepFont(texts, -2) },
      { key: 'font-up', label: 'Agrandir le texte', text: 'A+', run: () => stepFont(texts, 2) },
      { key: 'bold', label: 'Gras', html: '<b aria-hidden="true">G</b>', pressed: texts.every(i => i.bold), run: () => { const on = !texts.every(i => i.bold); state.updateItems(ids, { bold: on }, on ? 'Gras activé' : 'Gras désactivé'); } }
    );
    for (const a of ['left', 'center', 'right']) {
      list.push({ key: `align-${a}`, label: `Aligner ${state.ALIGN_NAMES[a]}`, html: ALIGN_ICONS[a], pressed: texts.every(i => i.align === a), run: () => state.updateItems(ids, { align: a }, `Texte aligné ${state.ALIGN_NAMES[a]}`) });
    }
  }
  if (notes.length) {
    const ids = idsOf(notes);
    for (const [s, letter] of [['s', 'P'], ['m', 'M'], ['l', 'G']]) {
      list.push({ key: `size-${s}`, label: `Post-it ${state.SIZE_NAMES[s]}`, text: letter, pressed: notes.every(i => i.size === s), run: () => setNoteSize(ids, s) });
    }
  }
  const ids = idsOf(items);
  const locked = items.every(i => i.locked);
  list.push(
    { key: 'lock', label: locked ? 'Déverrouiller' : 'Verrouiller', text: '🔒', pressed: locked, run: () => state.toggleLockedMany(ids) },
    { key: 'duplicate', label: 'Dupliquer', text: '⧉', run: () => { const copies = state.duplicateItems(ids); if (copies[0]) canvas.focusItem(copies[0].id); } },
    { key: 'delete', label: 'Supprimer', text: '🗑', run: () => state.removeItems(ids) }
  );
  list.push(...typeControls(items));
  if (items.length === 1 && items[0].type !== 'comment') list.push({ key: 'properties', label: 'Propriétés…', text: 'Propriétés…', run: () => onProperties(items[0].id) });
  list.push({ key: 'more', label: 'Plus d’actions', text: '⋯', menu: 'more' });
  return list;
}

function typeControls(items) {
  const list = [];
  const one = items.length === 1 ? items[0] : null;
  const drawings = items.filter(i => i.type === 'drawing');
  if (drawings.length) {
    list.push(
      { key: 'pen-color', label: `Couleur du trait : ${O.nameOf(O.PEN_COLORS, drawings[0].stroke)}`, html: `<span class="swatch" style="background:${O.hexOf(O.PEN_COLORS, drawings[0].stroke)}" aria-hidden="true"></span>`, menu: 'pen-color' },
      { key: 'pen-width', label: `Épaisseur : ${(O.PEN_WIDTHS.find(w => w[0] === drawings[0].strokeWidth) || O.PEN_WIDTHS[1])[1]}`, text: 'Épaisseur', menu: 'pen-width' }
    );
    if (one) list.push({ key: 'drawing-label', label: 'Étiquette du dessin…', text: 'Étiquette…', run: () => canvas.edit(one.id) });
  }
  if (one?.type === 'flipcard') list.push({ key: 'flip', label: 'Retourner la carte (Espace)', text: '⟲ Retourner', pressed: !!one.flipped, run: () => obj.flip(one.id) });
  if (one?.type === 'code') {
    list.push(
      { key: 'lang', label: `Langage : ${O.LANGUAGES[one.language]}`, text: O.LANGUAGES[one.language], menu: 'lang' },
      { key: 'copy-code', label: 'Copier le code', text: 'Copier le code', run: () => obj.copyCode(one.id) }
    );
  }
  if (one?.type === 'mindmap') {
    list.push(
      { key: 'mind-child', label: 'Ajouter un nœud enfant (Tab)', text: '+ Enfant', run: () => canvas.addMindNode(one.id, true) },
      { key: 'mind-sibling', label: 'Ajouter un nœud frère (Entrée)', text: '+ Frère', run: () => canvas.addMindNode(one.id, !one.parentNode) }
    );
    if (state.mindChildren(one.id).length) list.push({ key: 'mind-fold', label: one.collapsed ? 'Déplier la branche' : 'Replier la branche', text: one.collapsed ? 'Déplier' : 'Replier', run: () => state.setMindCollapsed(one.id, !one.collapsed) });
  }
  if (one?.type === 'kanban') {
    const col = () => obj.activeColumn(one, canvas.getActiveSub(one.id));
    list.push(
      { key: 'kb-card', label: 'Ajouter une carte (Insertion)', text: '+ Carte', run: () => obj.addCard(one.id, col()) },
      { key: 'kb-col', label: 'Ajouter une colonne', text: '+ Colonne', run: () => obj.addColumn(one.id) },
      { key: 'kb-rename', label: 'Renommer la colonne active', text: 'Renommer', run: () => { canvas.focusSub(one.id, `col:${one.columns[col()].id}`); obj.editSub(one.id, `col:${one.columns[col()].id}`); } },
      { key: 'kb-del', label: 'Supprimer la colonne active', text: '− Colonne', run: () => obj.removeColumn(one.id, col()) }
    );
  }
  if (one?.type === 'datatable') {
    const cell = () => (canvas.getActiveSub(one.id) || 'cell:0:0').split(':').slice(1).map(Number);
    list.push(
      { key: 'dt-row', label: 'Ajouter une ligne', text: '+ Ligne', run: () => obj.tableAdd(one.id, 'row', cell()[0]) },
      { key: 'dt-col', label: 'Ajouter une colonne', text: '+ Colonne', run: () => obj.tableAdd(one.id, 'col', cell()[1]) },
      { key: 'dt-del-row', label: 'Supprimer la ligne active', text: '− Ligne', run: () => obj.tableRemove(one.id, 'row', cell()[0]) },
      { key: 'dt-del-col', label: 'Supprimer la colonne active', text: '− Colonne', run: () => obj.tableRemove(one.id, 'col', cell()[1]) }
    );
  }
  if (one?.type === 'comment') {
    list.push(
      { key: 'thread', label: 'Ouvrir le fil', text: 'Ouvrir le fil', run: () => onOpenComment(one.id) },
      { key: 'resolve', label: 'Résolu', text: '✓ Résolu', pressed: !!one.resolved, run: () => state.setResolved(one.id, !one.resolved) }
    );
  }
  if (items.some(i => O.TAG_TYPES.includes(i.type))) list.push({ key: 'tags', label: 'Étiquettes', text: '🏷', menu: 'tags' });
  if (items.some(i => i.type !== 'connector' && i.type !== 'comment')) list.push({ key: 'react', label: 'Réagir', text: '☺', menu: 'react' });
  if (one && one.type !== 'connector' && one.type !== 'comment') list.push({ key: 'comment', label: 'Commenter (C)', text: '💬', run: () => canvas.createAtCenter('comment') });
  return list;
}

function stepFont(items, delta) {
  const sizes = new Map(items.map(i => [i.id, i.fontSize === 'auto' ? canvas.textLayout(i).fs : Number(i.fontSize) || 14]));
  const done = state.updateItems([...sizes.keys()], i => ({ fontSize: Math.min(96, Math.max(8, Math.round(sizes.get(i.id) + delta))) }));
  if (done[0]) announce(`Taille du texte ${done[0].fontSize}`);
}

function setNoteSize(ids, s) {
  const d = state.STICKY_SIZES[s];
  state.updateItems(ids, i => ({ x: Math.round(i.x + ((i.width || 150) - d) / 2), y: Math.round(i.y + ((i.height || 150) - d) / 2), width: d, height: d, size: s }), `Post-it ${state.SIZE_NAMES[s]}`);
}

function menuEntries(kind) {
  const items = selection();
  if (kind === 'color') {
    const notes = items.filter(i => i.type === 'sticky_note');
    return state.PALETTE.map(([id, name, hex], n) => ({
      label: `${name}, ${n + 1} sur 16`, html: `<span class="swatch" style="background:${hex}" aria-hidden="true"></span>`, checked: notes.every(i => i.color === id),
      run: () => state.updateItems(idsOf(notes), { color: id }, `Couleur : ${name}`)
    }));
  }
  if (kind === 'shape') {
    const shapes = items.filter(i => i.type === 'shape');
    return Object.entries(state.SHAPES).map(([id, name]) => ({ label: name, text: name, checked: shapes.every(i => i.shape === id), run: () => state.updateItems(idsOf(shapes), { shape: id }, `Forme : ${name}`) }));
  }
  if (kind === 'pen-color' || kind === 'pen-width') {
    const ds = items.filter(i => i.type === 'drawing');
    if (kind === 'pen-color') return O.PEN_COLORS.map(([id, name, hex]) => ({ label: name, html: `<span class="swatch" style="background:${hex}" aria-hidden="true"></span> ${name}`, checked: ds.every(i => i.stroke === id), run: () => state.updateItems(idsOf(ds), { stroke: id }, `Couleur du trait : ${name}`) }));
    return O.PEN_WIDTHS.map(([w, name]) => ({ label: name, text: name, checked: ds.every(i => i.strokeWidth === w), run: () => state.updateItems(idsOf(ds), { strokeWidth: w }, `Épaisseur : ${name}`) }));
  }
  if (kind === 'lang') {
    const code = items[0];
    return Object.entries(O.LANGUAGES).map(([id, name]) => ({ label: name, text: name, checked: code.language === id, run: () => state.updateItems([code.id], { language: id }, `Langage : ${name}`) }));
  }
  if (kind === 'tags') {
    const taggable = items.filter(i => O.TAG_TYPES.includes(i.type));
    return [
      ...state.getTags().map(tag => ({ role: 'menuitemcheckbox', label: tag.name, html: `<span class="tag-dot" style="background:${O.hexOf(O.TAG_COLORS, tag.color)}" aria-hidden="true"></span> ${escapeHtml(tag.name)}`, checked: taggable.every(i => i.tags?.includes(tag.id)), run: () => state.toggleTag(idsOf(taggable), tag.id) })),
      { label: 'Nouvelle étiquette…', run: () => onNewTag(idsOf(taggable)) }
    ];
  }
  if (kind === 'react') {
    const me = state.getAuthor() || 'Moi';
    const targets = items.filter(i => i.type !== 'connector' && i.type !== 'comment');
    return O.REACTIONS.map(([emoji, name]) => {
      const n = targets[0].reactions?.[emoji]?.length || 0;
      return { role: 'menuitemcheckbox', label: `${emoji} ${name}${n ? ` (${n})` : ''}`, checked: targets.every(i => i.reactions?.[emoji]?.includes(me)), run: () => state.toggleReaction(idsOf(targets), emoji) };
    });
  }
  const links = items.filter(i => i.type === 'connector');
  const lineIds = idsOf(links);
  const withIcon = (icon, name) => `${icon}<span>${name}</span>`;
  if (kind === 'start-cap' || kind === 'end-cap') {
    const field = kind === 'start-cap' ? 'startCap' : 'endCap', word = kind === 'start-cap' ? 'Début' : 'Fin';
    return Object.entries(L.CAPS).map(([id, name]) => ({ label: name, html: withIcon(capIcon(id, kind === 'start-cap'), name), checked: links.every(i => i[field] === id), run: () => state.updateItems(lineIds, { [field]: id }, `${word} de ligne : ${name}`) }));
  }
  if (kind === 'line-type') return Object.entries(L.LINE_TYPES).map(([id, name]) => ({ label: name, html: withIcon(typeIcon(id), name), checked: links.every(i => i.lineType === id), run: () => state.updateItems(lineIds, { lineType: id }, `Type de ligne : ${name}`) }));
  if (kind === 'line-style') return Object.entries(L.LINE_STYLES).map(([id, name]) => ({ label: name, html: withIcon(styleIcon(id), name), checked: links.every(i => i.lineStyle === id), run: () => state.updateItems(lineIds, { lineStyle: id }, `Trait : ${name}`) }));
  if (kind === 'line-width') return L.LINE_WIDTHS.map(w => ({ label: `${w} px`, html: withIcon(widthIcon(Math.min(w, 8)), `${w} px`), checked: links.every(i => i.strokeWidth === w), run: () => state.updateItems(lineIds, { strokeWidth: w }, `Épaisseur : ${w}`) }));
  if (kind === 'line-color') return L.LINE_COLORS.map(([id, name, css]) => ({ label: name, html: withIcon(`<span class="swatch" style="background:${css}" aria-hidden="true"></span>`, name), checked: links.every(i => i.stroke === id), run: () => state.updateItems(lineIds, { stroke: id }, `Couleur de ligne : ${name}`) }));
  const ids = idsOf(items);
  if (items.every(i => i.type === 'connector')) {
    return [
      { label: 'Dupliquer (Ctrl+D)', run: () => { const copies = state.duplicateItems(ids); if (copies[0]) canvas.focusItem(copies[0].id); } },
      { label: 'Supprimer (Suppr)', run: () => state.removeItems(ids) },
      ...(items.length === 1 ? [{ label: 'Extrémités et points de pliage…', run: () => onProperties(items[0].id) }] : []),
      { label: 'Copier (Ctrl+C)', run: () => clipboard.copy(ids) },
      { label: 'Couper (Ctrl+X)', run: () => clipboard.cut(ids) },
      { label: 'Coller (Ctrl+V)', run: () => clipboard.paste() },
      { label: 'Copier le style (Ctrl+Alt+C)', run: () => clipboard.copyStyle() },
      { label: 'Coller le style (Ctrl+Alt+V)', run: () => clipboard.pasteStyle(ids) },
      { label: 'Premier plan (Page précédente)', run: () => state.reorderItems(ids, true) },
      { label: 'Arrière-plan (Page suivante)', run: () => state.reorderItems(ids, false) }
    ];
  }
  return [
    { label: 'Copier (Ctrl+C)', run: () => clipboard.copy(ids) },
    { label: 'Couper (Ctrl+X)', run: () => clipboard.cut(ids) },
    { label: 'Coller (Ctrl+V)', run: () => clipboard.paste() },
    { label: 'Copier le style (Ctrl+Alt+C)', run: () => clipboard.copyStyle() },
    { label: 'Coller le style (Ctrl+Alt+V)', run: () => clipboard.pasteStyle(ids) },
    { label: 'Effacer le contenu (Ctrl+Retour arrière)', run: () => clipboard.clearContent(ids) },
    { label: 'Premier plan (Page précédente)', run: () => state.reorderItems(ids, true) },
    { label: 'Arrière-plan (Page suivante)', run: () => state.reorderItems(ids, false) },
    { label: 'Créer un cadre autour', run: () => state.frameAround(ids) },
    { label: 'Grouper (Ctrl+G)', run: () => state.groupItems(ids) },
    { label: 'Dégrouper (Ctrl+Maj+G)', run: () => state.ungroupItems(ids) }
  ];
}

function update() {
  const items = selection();
  const hadFocus = bar.contains(document.activeElement);
  if (!items.length) {
    if (hadFocus) canvas.getSvgElement().querySelector('.canvas-item[tabindex="0"]')?.focus();
    closeMenu(false);
    bar.hidden = true;
    return;
  }
  if (menu) closeMenu(false);
  controls = build(items);
  if (!controls.some(c => c.key === activeKey)) activeKey = controls[0].key;
  bar.replaceChildren(...controls.map(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = c.key;
    b.tabIndex = c.key === activeKey ? 0 : -1;
    if (c.html) b.innerHTML = c.html; else b.textContent = c.text;
    if (c.text !== c.label) { b.setAttribute('aria-label', c.label); b.title = c.label; }
    if (c.pressed !== undefined) b.setAttribute('aria-pressed', String(c.pressed));
    if (c.menu) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); }
    b.addEventListener('click', () => c.menu ? toggleMenu(c, b) : c.run());
    return b;
  }));
  bar.hidden = false;
  if (hadFocus) bar.querySelector(`[data-key="${activeKey}"]`)?.focus();
  place();
}

function toggleMenu(c, button) {
  if (menuKey === c.key) { closeMenu(true); return; }
  closeMenu(false);
  menuKey = c.key;
  menu = document.createElement('div');
  menu.className = `context-menu menu-${c.menu}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', c.label.split(' :')[0]);
  const entries = menuEntries(c.menu);
  entries.forEach((entry, n) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.tabIndex = -1;
    item.setAttribute('role', entry.role || (entry.checked === undefined ? 'menuitem' : 'menuitemradio'));
    if (entry.checked !== undefined) item.setAttribute('aria-checked', String(entry.checked));
    if (entry.html) { item.innerHTML = entry.html; item.setAttribute('aria-label', entry.label); item.title = entry.label; } else item.textContent = entry.text || entry.label;
    item.addEventListener('click', () => { closeMenu(true); entry.run(); });
    menu.appendChild(item);
    if (n === 0 || entry.checked) menu.dataset.start = n;
  });
  const left = button.offsetLeft;
  menu.style.left = `${Math.max(0, Math.min(left, bar.clientWidth - 200))}px`;
  bar.appendChild(menu);
  button.setAttribute('aria-expanded', 'true');
  menu.children[Number(menu.dataset.start) || 0].focus();
}

function closeMenu(refocus) {
  if (!menu) return;
  const key = menuKey;
  const old = menu;
  menu = null;
  menuKey = null;
  old.remove();
  const button = bar.querySelector(`[data-key="${key}"]`);
  button?.setAttribute('aria-expanded', 'false');
  if (refocus) button?.focus();
}

function onKey(e) {
  if (canvas.lineEndKey(e)) return;
  if (menu && menu.contains(e.target)) {
    const all = [...menu.children];
    const i = all.indexOf(e.target);
    const cols = menu.classList.contains('menu-color') ? 4 : 1;
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    if (e.key in moves) { e.preventDefault(); all[(i + moves[e.key] + all.length) % all.length].focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); all[e.key === 'Home' ? 0 : all.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
    e.stopPropagation();
    return;
  }
  const buttons = [...bar.children].filter(b => b.dataset.key);
  const i = buttons.indexOf(e.target);
  if (i < 0) return;
  if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons.forEach((b, n) => { b.tabIndex = n === next ? 0 : -1; });
    buttons[next].focus();
  } else if (e.key === 'ArrowDown' && e.target.getAttribute('aria-haspopup')) {
    e.preventDefault();
    e.target.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    canvas.focusItem(state.getSelectedId());
  }
}

function place() {
  if (!bar || bar.hidden) return;
  const r = canvas.getSelectionRect();
  if (!r) return;
  const docked = matchMedia('(max-width: 640px)').matches;
  bar.classList.toggle('is-docked', docked);
  if (docked) {
    const creation = document.querySelector('#app-board .creation-toolbar')?.getBoundingClientRect();
    Object.assign(bar.style, { left: '', top: '', bottom: `${creation ? innerHeight - creation.top + 6 : 4}px` });
    return;
  }
  const creation = document.querySelector('#app-board .creation-toolbar')?.getBoundingClientRect();
  const origin = container.getBoundingClientRect();
  const minLeft = creation && creation.width ? creation.right - origin.left + 8 : 4;
  const maxLeft = Math.max(minLeft, container.clientWidth - bar.offsetWidth - 4);
  const left = Math.min(maxLeft, Math.max(minLeft, (r.left + r.right) / 2 - bar.offsetWidth / 2));
  let top = r.top - bar.offsetHeight - 30;
  if (top < 4) top = r.bottom + 30;
  top = Math.min(Math.max(4, top), container.clientHeight - bar.offsetHeight - 4);
  Object.assign(bar.style, { left: `${left}px`, top: `${top}px`, bottom: '' });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
