import * as state from '../state.js';
import * as canvas from './canvas.js';
import { announce } from '../a11y/announcer.js';
import { ask } from '../ui/dialog.js';
import { getPref } from '../preferences.js';
import { geometry } from '../lines.js';

let board, panel, list, search, input, status, map, player, counter;
let showCanvas, searchOpener, panelOpener, presenting = false, slide = 0, hits = [], hit = -1;
let mapBounds, dragging = false, savedView;
const NS = 'http://www.w3.org/2000/svg';
const byId = id => document.getElementById(id);
const name = frame => frame.content || 'Cadre sans nom';
function button(text, action) {
  const el = document.createElement('button');
  el.type = 'button'; el.textContent = text; el.onclick = action;
  return el;
}

export function init(openCanvas) {
  showCanvas = openCanvas;
  board = byId('app-board');
  panel = document.createElement('aside');
  panel.id = 'frames-panel'; panel.className = 'frames-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Cadres');
  const head = document.createElement('div'); head.className = 'frames-head';
  const heading = document.createElement('h2'); heading.textContent = 'Cadres';
  head.append(heading, button('Fermer les cadres', () => closeFrames()));
  list = document.createElement('ol');
  panel.append(head, list);
  board.append(panel);
  byId('btn-frames').onclick = () => {
    if (!panel.hidden) { closeFrames(); return; }
    panelOpener = document.activeElement; panel.hidden = false;
    byId('btn-frames').setAttribute('aria-expanded', 'true'); renderFrames();
    (list.querySelector('[data-action="visit"]') || panel.querySelector('button')).focus();
  };
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFrames(); }
  });
  search = document.createElement('div'); search.id = 'board-search'; search.className = 'board-search'; search.hidden = true;
  const label = document.createElement('label'); label.textContent = 'Rechercher dans le tableau';
  input = document.createElement('input'); input.type = 'search'; input.id = 'board-search-input'; label.htmlFor = input.id;
  status = document.createElement('span'); status.setAttribute('role', 'status');
  search.append(label, input, status, button('Précédent', () => nextHit(-1)), button('Suivant', () => nextHit(1)), button('Fermer la recherche', closeSearch));
  byId('view-canvas').append(search);
  input.oninput = () => updateSearch(true);
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
    if (e.key === 'Enter') { e.preventDefault(); nextHit(e.shiftKey ? -1 : 1); }
  });
  byId('btn-search').onclick = openSearch;
  map = document.createElementNS(NS, 'svg'); map.id = 'minimap'; map.classList.add('minimap'); map.setAttribute('aria-hidden', 'true'); map.hidden = true;
  board.append(map);
  map.hidden = true; map.setAttribute('hidden', '');
  byId('btn-minimap').onclick = toggleMap;
  map.addEventListener('pointerdown', e => { dragging = true; map.setPointerCapture(e.pointerId); moveMap(e); });
  map.addEventListener('pointermove', e => { if (dragging) moveMap(e); });
  map.addEventListener('pointerup', () => { dragging = false; });
  map.addEventListener('pointercancel', () => { dragging = false; });
  player = document.createElement('div'); player.id = 'presentation-controls'; player.className = 'presentation-controls'; player.hidden = true;
  player.setAttribute('role', 'toolbar'); player.setAttribute('aria-label', 'Présentation');
  counter = document.createElement('span'); counter.setAttribute('role', 'status'); counter.setAttribute('aria-live', 'polite');
  player.append(button('Précédent', () => goSlide(slide - 1)), counter, button('Suivant', () => goSlide(slide + 1)), button('Quitter', stopPresentation));
  board.append(player);
  byId('btn-present').onclick = startPresentation;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', () => {
    if (presenting && !document.fullscreenElement) stopPresentation();
    else if (presenting) goSlide(slide);
  });
  window.addEventListener('resize', () => { if (presenting) requestAnimationFrame(() => goSlide(slide)); });
  canvas.onView(() => { renderMap(); highlight(); });
  state.subscribe(() => { if (!panel.hidden) renderFrames(); if (!search.hidden) updateSearch(); renderMap(); });
}

function closeFrames(restore = true) {
  panel.hidden = true; byId('btn-frames').setAttribute('aria-expanded', 'false');
  if (restore) panelOpener?.focus();
}
function renderFrames() {
  const focused = panel.contains(document.activeElement) ? document.activeElement : null;
  const id = focused?.dataset.frame, action = focused?.dataset.action;
  list.replaceChildren();
  const frames = state.getFrames();
  frames.forEach((frame, index) => {
    const row = document.createElement('li');
    const count = state.getChildrenOf(frame.id).length;
    const visit = button(`${index + 1}. ${name(frame)} — ${count} élément${count > 1 ? 's' : ''}`, () => {
      showCanvas(); canvas.fitFrame(frame.id); announce(`Cadre ${index + 1} : ${name(frame)}`);
      if (matchMedia('(max-width: 640px)').matches) closeFrames();
    });
    const move = direction => {
      state.moveFrame(frame.id, direction);
      list.querySelector(`[data-frame="${CSS.escape(frame.id)}"][data-action="visit"]`)?.focus();
      announce(`Cadre ${name(frame)}, position ${state.getFrames().findIndex(f => f.id === frame.id) + 1}`);
    };
    row.onkeydown = e => {
      if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); move(e.key === 'ArrowUp' ? -1 : 1); }
    };
    const up = button('Monter', () => move(-1)), down = button('Descendre', () => move(1));
    up.disabled = index === 0; down.disabled = index === frames.length - 1;
    const rename = button('Renommer', () => ask('Renommer le cadre', frame.content || '', value => {
      if (state.updateItem(frame.id, { content: value })) announce(`Cadre renommé : ${value}`);
      list.querySelector(`[data-frame="${CSS.escape(frame.id)}"][data-action="visit"]`)?.focus();
    }));
    rename.disabled = state.isLocked(frame.id);
    [visit, up, down, rename].forEach((b, i) => { b.dataset.frame = frame.id; b.dataset.action = ['visit', 'up', 'down', 'rename'][i]; b.setAttribute('aria-label', `${b.textContent}${i ? ` : ${name(frame)}` : ''}`); });
    row.append(visit, up, down, rename); list.append(row);
  });
  if (!frames.length) { const empty = document.createElement('li'); empty.textContent = 'Aucun cadre. Créez-en un avec l’outil Cadre (F).'; list.append(empty); }
  if (id) list.querySelector(`[data-frame="${CSS.escape(id)}"][data-action="${action}"]`)?.focus();
}

function openSearch() {
  searchOpener = document.activeElement; showCanvas(); search.hidden = false; input.focus(); updateSearch();
}
function closeSearch(restore = true) {
  search.hidden = true; hits = []; hit = -1; highlight();
  if (restore) searchOpener?.focus();
}
function searchable(item) {
  const strings = [];
  const collect = value => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, v]) => { if (['text', 'title', 'name', 'content', 'label', 'cells', 'rows', 'columns', 'cards', 'headers', 'front', 'back'].includes(key)) collect(v); });
  };
  ['content', 'title', 'label', 'columns', 'rows', 'headers', 'front', 'back'].forEach(k => collect(item[k]));
  (item.tags || []).forEach(id => collect(state.getBoard().tags.find(t => t.id === id)?.name));
  return strings.join(' ').toLocaleLowerCase('fr');
}
function updateSearch(reset = false) {
  const previous = hits[hit];
  const q = input.value.trim().toLocaleLowerCase('fr');
  hits = q ? state.getItems().filter(i => searchable(i).includes(q)).map(i => i.id) : [];
  hit = reset ? -1 : hits.indexOf(previous);
  showCount();
  highlight();
}
function showCount() {
  status.textContent = !input.value.trim() ? '' : !hits.length ? 'Aucun résultat' : hit < 0 ? `${hits.length} résultat${hits.length > 1 ? 's' : ''}` : `${hit + 1} sur ${hits.length}`;
}
function nextHit(direction) {
  if (!hits.length) return;
  hit = (hit < 0 ? (direction > 0 ? 0 : hits.length - 1) : (hit + direction + hits.length) % hits.length);
  const id = hits[hit];
  let parent = state.getItem(state.getItem(id)?.parentNode);
  const visited = new Set();
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    if (parent.collapsed) state.setMindCollapsed(parent.id, false);
    parent = state.getItem(parent.parentNode);
  }
  state.setSelectedId(id); canvas.reveal(id);
  showCount(); highlight();
}
function highlight() {
  canvas.getSvgElement()?.querySelectorAll('.canvas-item').forEach(el => {
    el.classList.toggle('search-result', hits.includes(el.dataset.id));
    el.classList.toggle('search-current', hits[hit] === el.dataset.id);
  });
}
function toggleMap() {
  map.hidden = !map.hidden; map.toggleAttribute('hidden', map.hidden); byId('btn-minimap').setAttribute('aria-pressed', String(!map.hidden)); renderMap();
}
function fitAspect(box) {
  const r = map.getBoundingClientRect(), ratio = (r.width || 200) / (r.height || 130);
  if (box.w / box.h < ratio) { const w = box.h * ratio; box.x -= (w - box.w) / 2; box.w = w; }
  else { const h = box.w / ratio; box.y -= (h - box.h) / 2; box.h = h; }
  return box;
}
function rect(box, cls) {
  const el = document.createElementNS(NS, 'rect');
  Object.entries({ x: box.x, y: box.y, width: box.w, height: box.h, class: cls }).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}
function renderMap() {
  if (!map || map.hidden) return;
  const view = canvas.getViewport();
  const boxes = state.getNonConnectorItems().map(canvas.itemBox);
  const all = [...boxes, view];
  const x = Math.min(...all.map(b => b.x)) - 40, y = Math.min(...all.map(b => b.y)) - 40;
  const w = Math.max(...all.map(b => b.x + b.w)) - x + 40, h = Math.max(...all.map(b => b.y + b.h)) - y + 40;
  mapBounds = fitAspect({ x, y, w, h });
  map.setAttribute('viewBox', `${mapBounds.x} ${mapBounds.y} ${mapBounds.w} ${mapBounds.h}`);
  map.setAttribute('preserveAspectRatio', 'none');
  const lines = state.getConnectors().map(c => geometry(c, state.getItem)).filter(Boolean).map(g => {
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('d', g.d); el.setAttribute('class', 'minimap-line');
    return el;
  });
  map.replaceChildren(...boxes.map(b => rect(b, 'minimap-object')), ...lines, rect(view, 'minimap-view'));
}
function moveMap(e) {
  e.preventDefault();
  const b = map.getBoundingClientRect(), world = mapBounds;
  canvas.centerView(world.x + (e.clientX - b.left) / b.width * world.w, world.y + (e.clientY - b.top) / b.height * world.h);
}

async function startPresentation() {
  showCanvas(); closeFrames(false); closeSearch(false); canvas.cancelTool(); state.setSelection([]);
  savedView = canvas.getViewport(); presenting = true; slide = 0;
  board.classList.add('is-presenting'); player.hidden = false;
  for (const el of board.children) if (el !== player && !el.classList.contains('board-main')) el.inert = true;
  canvas.getContainer().inert = true;
  goSlide(0);
  const [, next, quit] = player.querySelectorAll('button');
  (next.disabled ? quit : next).focus();
  try { if (board.requestFullscreen) await board.requestFullscreen(); } catch { /* Full-window overlay remains available. */ }
  if (!presenting && document.fullscreenElement === board) document.exitFullscreen()?.catch(() => {});
  if (presenting) goSlide(slide);
}
function goSlide(index) {
  const frames = state.getFrames();
  slide = Math.max(0, Math.min(frames.length - 1, index));
  if (frames.length) {
    canvas.fitFrame(frames[slide].id);
    let clip = byId('presentation-clip');
    if (!clip) {
      clip = document.createElementNS(NS, 'clipPath'); clip.id = 'presentation-clip';
      canvas.getSvgElement().querySelector('defs').append(clip);
    }
    clip.replaceChildren(rect(canvas.itemBox(frames[slide]), ''));
    byId('canvas-items').setAttribute('clip-path', 'url(#presentation-clip)');
    counter.textContent = `Cadre ${slide + 1} sur ${frames.length} : ${name(frames[slide])}`;
  } else {
    byId('canvas-items').removeAttribute('clip-path');
    canvas.zoomToFit(); counter.textContent = 'Vue entière. Ajoutez des cadres pour présenter';
  }
  const [prev, next, quit] = player.querySelectorAll('button');
  prev.disabled = !frames.length || slide === 0;
  next.disabled = !frames.length || slide === frames.length - 1;
  if (player.contains(document.activeElement) && document.activeElement.disabled || document.activeElement === document.body) (next.disabled ? (prev.disabled ? quit : prev) : next).focus();
}
function stopPresentation() {
  if (!presenting) return;
  presenting = false; board.classList.remove('is-presenting'); player.hidden = true;
  for (const el of board.children) el.inert = false;
  canvas.getContainer().inert = false;
  if (document.fullscreenElement === board) document.exitFullscreen()?.catch(() => {});
  byId('canvas-items').removeAttribute('clip-path');
  if (savedView) canvas.restoreViewport(savedView);
  byId('btn-present').focus(); announce('Présentation terminée');
}
function onKey(e) {
  if (presenting) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopPresentation(); return; }
    const actions = { ArrowRight: slide + 1, ' ': slide + 1, PageDown: slide + 1, ArrowLeft: slide - 1, PageUp: slide - 1, Home: 0, End: state.getFrames().length - 1 };
    if (e.key in actions && !(e.key === ' ' && e.target.closest('button'))) { e.preventDefault(); goSlide(actions[e.key]); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const buttons = [...player.querySelectorAll('button')].filter(b => !b.disabled);
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
    e.stopImmediatePropagation();
    return;
  }
  if (board.hidden || e.target.closest('dialog[open], input, textarea, select, [contenteditable]')) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && board.contains(e.target)) {
    e.preventDefault(); e.stopImmediatePropagation(); openSearch();
  } else if (getPref('singleKey') && e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !byId('view-canvas').hidden) {
    e.preventDefault(); e.stopImmediatePropagation(); toggleMap();
  }
}
export function reset() {
  if (!board) return;
  stopPresentation(); closeFrames(false); closeSearch(false); input.value = '';
  map.hidden = true; map.setAttribute('hidden', ''); byId('btn-minimap').setAttribute('aria-pressed', 'false');
}
