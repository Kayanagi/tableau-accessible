import * as state from '../state.js';
import * as canvas from './canvas.js';
import { announce } from '../a11y/announcer.js';

const LABELS = { sticky_note: 'du post-it', shape: 'de la forme', text: 'du texte', card: 'de la carte', frame: 'du nom du cadre' };
let ed = null;

export function init() {
  canvas.onView(position);
}

export function isOpen() {
  return !!ed;
}

export function open(id, isNew = false) {
  commit(false);
  const item = state.getItem(id);
  if (!item || item.type === 'connector' || state.isLocked(id)) return false;
  const el = document.createElement('textarea');
  el.className = 'inline-editor';
  el.setAttribute('aria-label', `Texte ${LABELS[item.type] || ''}`.trim());
  el.setAttribute('aria-describedby', 'inline-editor-hint');
  el.value = item.content || '';
  el.spellcheck = true;
  ed = { id, el, isNew };
  canvas.getContainer().appendChild(el);
  canvas.setEditing(id);
  el.addEventListener('input', position);
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      commit(true);
    }
  });
  el.addEventListener('blur', () => { if (ed?.el === el) commit(false); });
  position();
  el.focus({ preventScroll: true });
  el.setSelectionRange(el.value.length, el.value.length);
  announce(`${isNew ? `${state.TYPES[item.type]} ajouté. ` : ''}Saisissez le texte, Échap pour valider.`);
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
  else s.background = '';
}

export function commit(refocus) {
  if (!ed) return;
  const { id, el, isNew } = ed;
  ed = null;
  const value = el.value;
  el.remove();
  canvas.setEditing(null);
  const item = state.getItem(id);
  if (item && value !== (item.content || '')) {
    state.updateItem(id, { content: value }, !isNew);
    announce(isNew ? `${state.TYPES[item.type]} ajouté` : 'Texte modifié');
  }
  if (refocus) canvas.focusItem(id);
}
