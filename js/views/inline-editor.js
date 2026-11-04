import * as state from '../state.js';
import * as canvas from './canvas.js';
import { announce } from '../a11y/announcer.js';

const LABELS = { sticky_note: 'du post-it', shape: 'de la forme', text: 'du texte', card: 'de la carte', frame: 'du nom du cadre', mindmap: 'du nœud', code: 'du code', drawing: 'Étiquette du dessin' };
const ADDED = { sticky_note: 'Post-it ajouté', shape: 'Forme ajoutée', text: 'Texte ajouté', card: 'Carte ajoutée', frame: 'Cadre ajouté', mindmap: 'Nœud de carte mentale ajouté', code: 'Bloc de code ajouté', flipcard: 'Carte recto-verso ajoutée' };
const NOT_EDITABLE = ['connector', 'comment', 'kanban', 'datatable'];
let ed = null;
let field = null;

export function init() {
  canvas.onView(position);
  canvas.onView(positionField);
}

export function isOpen() {
  return !!ed || !!field;
}

export function open(id, isNew = false) {
  commit(false);
  commitField();
  const item = state.getItem(id);
  if (!item || NOT_EDITABLE.includes(item.type) || state.isLocked(id)) return false;
  if (item.type === 'drawing') return openDrawingLabel(item);
  const key = item.type === 'flipcard' && item.flipped ? 'back' : 'content';
  const el = document.createElement('textarea');
  el.className = 'inline-editor' + (item.type === 'code' ? ' is-code' : '');
  const label = item.type === 'flipcard' ? `Texte du ${item.flipped ? 'verso' : 'recto'}` : `Texte ${LABELS[item.type] || ''}`.trim();
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-describedby', item.type === 'mindmap' ? 'mind-editor-hint' : 'inline-editor-hint');
  el.value = item[key] || '';
  el.spellcheck = item.type !== 'code';
  ed = { id, el, isNew, key };
  canvas.getContainer().appendChild(el);
  canvas.setEditing(id);
  el.addEventListener('input', position);
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      commit(true);
      return;
    }
    if (item.type === 'mindmap' && !e.shiftKey && !e.ctrlKey && !e.altKey && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      const child = e.key === 'Tab' || !item.parentNode;
      commit(false);
      canvas.addMindNode(id, child);
    }
  });
  el.addEventListener('blur', () => { if (ed?.el === el) commit(false); });
  position();
  el.focus({ preventScroll: true });
  el.setSelectionRange(el.value.length, el.value.length);
  announce(`${isNew ? `${ADDED[item.type] || `${state.TYPES[item.type]} ajouté`}. ` : ''}Saisissez le texte, Échap pour valider.`);
  return true;
}

function position() {
  if (!ed) return;
  const item = state.getItem(ed.id);
  if (!item) { commit(false); return; }
  const z = canvas.getZoom();
  const L = canvas.textLayout(item, ed.el.value);
  const isFrame = item.type === 'frame';
  const box = isFrame ? { x: L.box.x - 4, y: L.box.y, w: L.box.w + 8, h: L.box.h + 4 } : canvas.itemBox(item);
  if (item.type === 'text') box.h = Math.max(box.h, (L.lines.length || 1) * L.lh);
  const p = canvas.toContainer(box.x, box.y);
  const s = ed.el.style;
  const textH = Math.max(1, L.lines.length) * L.lh;
  const padTop = isFrame ? 2 : L.box.y - box.y + (L.box.valign === 'middle' ? Math.max(0, (L.box.h - textH) / 2) : 0);
  const padX = isFrame ? 4 : L.box.x - box.x;
  Object.assign(s, {
    left: `${p.x}px`, top: `${p.y}px`, width: `${box.w * z}px`, height: `${box.h * z}px`,
    fontSize: `${L.fs * z}px`, lineHeight: `${L.lh * z}px`, fontWeight: L.bold ? 'bold' : 'normal',
    textAlign: isFrame ? 'left' : L.align, color: canvas.inkFor(item),
    padding: `${padTop * z}px ${padX * z}px 0`
  });
  if (item.type === 'sticky_note') s.background = (state.PALETTE.find(c => c[0] === item.color) || state.PALETTE[0])[2];
  else if (item.type === 'code') s.background = '#1e1b2e';
  else if (item.type === 'mindmap' && !item.parentNode) s.background = 'var(--primary)';
  else s.background = '';
}

export function commit(refocus) {
  if (!ed) return;
  const { id, el, isNew, key } = ed;
  ed = null;
  const value = el.value;
  el.remove();
  canvas.setEditing(null);
  const item = state.getItem(id);
  if (item && value !== (item[key] || '')) {
    state.updateItem(id, { [key]: value }, !isNew);
    announce(isNew ? (ADDED[item.type] || `${state.TYPES[item.type]} ajouté`) : 'Texte modifié');
  }
  if (item?.type === 'mindmap') canvas.setMapMode(id);
  if (refocus) canvas.focusItem(id);
}

function openDrawingLabel(item) {
  const b = canvas.itemBox(item);
  return openField({
    id: item.id, box: { x: b.x, y: b.y + b.h + 2, w: Math.max(160, b.w), h: 24 }, value: item.content || '', label: 'Étiquette du dessin', singleLine: true,
    onCommit: v => state.updateItem(item.id, { content: v }) && announce(v ? `Étiquette du dessin : ${v}` : 'Étiquette du dessin effacée')
  });
}

export function openField(opts) {
  commit(false);
  commitField();
  const el = document.createElement(opts.singleLine ? 'input' : 'textarea');
  el.className = 'inline-editor field-editor';
  el.setAttribute('aria-label', opts.label);
  el.setAttribute('aria-describedby', 'inline-editor-hint');
  el.value = opts.value || '';
  field = { ...opts, el };
  canvas.getContainer().appendChild(el);
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (opts.singleLine || e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      commitField(true);
    }
  });
  el.addEventListener('blur', () => { if (field?.el === el) commitField(false); });
  positionField();
  el.focus({ preventScroll: true });
  el.select();
  announce(`${opts.label} : saisissez le texte, Échap pour valider.`);
  return true;
}

function positionField() {
  if (!field) return;
  const z = canvas.getZoom();
  const p = canvas.toContainer(field.box.x, field.box.y);
  Object.assign(field.el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${field.box.w * z}px`, height: `${field.box.h * z}px`, fontSize: `${13 * z}px`, lineHeight: `${16 * z}px`, padding: `${4 * z}px ${6 * z}px`, color: 'var(--fg)', background: 'var(--card-bg)' });
}

export function commitField(refocus) {
  if (!field) return;
  const f = field;
  field = null;
  const value = f.el.value;
  f.el.remove();
  if (value !== (f.value || '')) f.onCommit(value);
  if (refocus) {
    if (f.sub && state.getItem(f.id)) canvas.focusSub(f.id, f.sub);
    else canvas.focusItem(f.id);
  }
}
