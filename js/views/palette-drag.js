import * as canvas from './canvas.js';
import * as state from '../state.js';
import { announce } from '../a11y/announcer.js';

const THRESHOLD = 5;
const SIZES = { sticky_note: [150, 150], text: [200, 40], 'shape:rectangle': [120, 80], 'shape:circle': [100, 100], 'shape:diamond': [120, 100], 'shape:triangle': [120, 100], line: [200, 8], card: [200, 120], frame: [400, 300], comment: [28, 28], mindmap: [170, 56], kanban: [548, 116], datatable: [360, 118], code: [320, 180], flipcard: [220, 140] };
const NAMES = { sticky_note: 'post-it', text: 'texte', 'shape:rectangle': 'rectangle', 'shape:circle': 'cercle', 'shape:diamond': 'losange', 'shape:triangle': 'triangle', line: 'ligne', card: 'carte', frame: 'cadre', comment: 'commentaire', mindmap: 'carte mentale', kanban: 'kanban', datatable: 'tableau de données', code: 'bloc de code', flipcard: 'carte recto-verso' };
const NO_EDIT = ['line', 'kanban', 'datatable', 'comment'];

let session = null;

export function attach(source, describe) {
  source.addEventListener('pointerdown', e => {
    if (e.button !== 0 || session) return;
    session = { source, describe, id: e.pointerId, x: e.clientX, y: e.clientY, started: false, spec: null, ghost: null };
    listen(true);
  });
}

function listen(on) {
  const fn = on ? addEventListener : removeEventListener;
  fn('pointermove', onMove, true);
  fn('pointerup', onUp, true);
  fn('pointercancel', onCancel, true);
  fn('keydown', onKey, true);
}

function onMove(e) {
  const s = session;
  if (!s || e.pointerId !== s.id) return;
  if (!s.started) {
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < THRESHOLD) return;
    start(s);
  }
  e.preventDefault();
  moveGhost(s, e.clientX, e.clientY);
}

function start(s) {
  s.started = true;
  s.spec = s.describe();
  const ghost = document.createElement('div');
  ghost.className = `drag-ghost ghost-${s.spec.tool.replace(':', '-')}`;
  ghost.setAttribute('aria-hidden', 'true');
  const [w, h] = SIZES[s.spec.tool] || [150, 150];
  const scale = Math.min(1, canvas.getZoom());
  s.w = Math.max(32, w * scale);
  s.h = Math.max(s.spec.tool === 'line' ? 8 : 32, h * scale);
  ghost.style.width = `${s.w}px`;
  ghost.style.height = `${s.h}px`;
  const hex = s.spec.color && state.PALETTE.find(c => c[0] === s.spec.color)?.[2];
  if (hex) ghost.style.background = hex;
  s.ghost = ghost;
  document.getElementById('app-board').append(ghost);
  if (s.spec.panel) s.spec.panel.classList.add('is-drag-source');
  document.body.classList.add('is-palette-dragging');
  announce(`Glisser : ${NAMES[s.spec.tool] || 'élément'}. Relâchez sur le canevas, Échap pour annuler.`);
}

function moveGhost(s, x, y) {
  s.ghost.style.transform = `translate(${x - s.w / 2}px, ${y - s.h / 2}px)`;
}

function clear() {
  const s = session;
  session = null;
  listen(false);
  if (!s) return s;
  s.ghost?.remove();
  document.body.classList.remove('is-palette-dragging');
  if (s.spec?.panel) s.spec.panel.classList.remove('is-drag-source');
  return s;
}

function swallowClick() {
  const stop = e => { e.stopPropagation(); e.preventDefault(); };
  addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', stop, { capture: true }), 0);
}

function onUp(e) {
  const s = session;
  if (!s || e.pointerId !== s.id) return;
  if (!s.started) { clear(); return; }
  e.preventDefault();
  clear();
  swallowClick();
  const over = document.elementFromPoint(e.clientX, e.clientY);
  s.spec.done?.();
  if (!over?.closest('.canvas-svg')) { announce('Glisser annulé : relâché hors du canevas'); return; }
  const item = canvas.dropAt(s.spec.tool, e.clientX, e.clientY, s.spec.color);
  announce(`Créé : ${describeItem(s.spec, item)}.${NO_EDIT.includes(s.spec.tool) ? '' : ' Édition.'}`);
}

function describeItem(spec) {
  const color = spec.color && state.COLORS[spec.color];
  return `${NAMES[spec.tool] || 'élément'}${color ? ` ${color.toLowerCase()}` : ''}`;
}

function onCancel(e) {
  if (session && e.pointerId === session.id) { const s = clear(); s?.spec?.done?.(); }
}

function onKey(e) {
  if (e.key !== 'Escape' || !session?.started) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const s = clear();
  s.spec.done?.();
  swallowClick();
  announce('Glisser annulé');
}
