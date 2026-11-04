import * as state from '../state.js';
import * as canvas from './canvas.js';
import * as clipboard from '../clipboard.js';
import { announce } from '../a11y/announcer.js';

const TEXT_TYPES = ['sticky_note', 'shape', 'text', 'card'];
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
let activeKey = null;
let controls = [];

export function init(el, options) {
  container = el;
  onProperties = options.onProperties;
  bar = document.createElement('div');
  bar.className = 'context-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Mise en forme de la sélection');
  bar.hidden = true;
  el.appendChild(bar);
  bar.addEventListener('keydown', onKey);
  bar.addEventListener('focusin', e => { const k = e.target.dataset.key; if (k) activeKey = k; });
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

function build(items) {
  const list = [];
  const notes = items.filter(i => i.type === 'sticky_note');
  const shapes = items.filter(i => i.type === 'shape');
  const links = items.filter(i => i.type === 'connector');
  const texts = items.filter(i => TEXT_TYPES.includes(i.type));
  if (notes.length) {
    const c = state.PALETTE.find(p => p[0] === notes[0].color) || state.PALETTE[0];
    list.push({ key: 'color', label: `Couleur : ${c[1]}`, html: `<span class="swatch" style="background:${c[2]}" aria-hidden="true"></span>`, menu: 'color' });
  }
  if (shapes.length) list.push({ key: 'shape', label: `Type de forme : ${state.SHAPES[shapes[0].shape] || 'Rectangle'}`, text: 'Forme', menu: 'shape' });
  if (links.length) list.push({ key: 'line', label: `Type de ligne : ${state.LINE_TYPES[links[0].lineType] || state.LINE_TYPES.arrow}`, text: 'Ligne', menu: 'line' });
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
  if (items.length === 1) list.push({ key: 'properties', label: 'Propriétés…', text: 'Propriétés…', run: () => onProperties(items[0].id) });
  list.push({ key: 'more', label: 'Plus d’actions', text: '⋯', menu: 'more' });
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
  if (kind === 'line') {
    const links = items.filter(i => i.type === 'connector');
    return Object.entries(state.LINE_TYPES).map(([id, name]) => ({ label: name, text: name, checked: links.every(i => (i.lineType || 'arrow') === id), run: () => state.updateItems(idsOf(links), { lineType: id }, `Ligne : ${name}`) }));
  }
  const ids = idsOf(items);
  return [
    { label: 'Copier (Ctrl+C)', run: () => clipboard.copy(ids) },
    { label: 'Couper (Ctrl+X)', run: () => clipboard.cut(ids) },
    { label: 'Coller (Ctrl+V)', run: () => clipboard.paste() },
    { label: 'Copier le style (Ctrl+Alt+C)', run: () => clipboard.copyStyle() },
    { label: 'Coller le style (Ctrl+Alt+V)', run: () => clipboard.pasteStyle(ids) },
    { label: 'Effacer le contenu (Ctrl+Retour arrière)', run: () => clipboard.clearContent(ids) },
    { label: 'Premier plan (Page précédente)', run: () => state.reorderItems(ids, true) },
    { label: 'Arrière-plan (Page suivante)', run: () => state.reorderItems(ids, false) },
    { label: 'Créer un cadre autour', run: () => state.frameAround(ids) }
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
    item.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemradio');
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
