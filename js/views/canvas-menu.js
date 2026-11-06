import * as state from '../state.js';
import * as io from '../io.js';
import * as prefs from '../preferences.js';
import * as canvas from './canvas.js';
import * as editor from './inline-editor.js';
import * as commentsPanel from './comments-panel.js';
import * as pointerSettings from './pointer-settings.js';
import { togglePref, toggleLabel } from './preferences-menu.js';
import { saveAsTemplate } from './board-actions.js';
import { ACTIONS } from './selection-actions.js';
import { announce } from '../a11y/announcer.js';

let current = null;
let onProperties = () => {};

export function init(options) {
  onProperties = options.onProperties;
  canvas.onContextRequest(open);
  document.addEventListener('pointerdown', e => { if (current && !current.menu.contains(e.target)) close(true); }, true);
  document.addEventListener('wheel', e => { if (current && !current.menu.contains(e.target)) close(true); }, { capture: true, passive: true });
  addEventListener('resize', () => close(true));
  addEventListener('hashchange', () => close(false));
}

export function openFromKeyboard() {
  open(canvas.contextAnchor());
}

function prefEntry(pref, shortcut, keys) {
  return { role: 'menuitemcheckbox', label: toggleLabel(pref), shortcut, keys, pref, keep: true, checked: () => prefs.getPref(pref), run: () => togglePref(pref) };
}

function unlockAll() {
  const ids = state.getItems().filter(i => i.locked).map(i => i.id);
  if (ids.length) state.toggleLockedMany(ids);
  else announce('Aucun élément verrouillé');
}

function backgroundEntries(point) {
  if (state.isReadOnly()) return readOnlyEntries();
  const add = (label, tool) => ({ label, run: () => canvas.createAt(tool, point) });
  const letters = prefs.getPref('singleKey');
  return [
    [ACTIONS.paste, { label: 'Tout déverrouiller', run: unlockAll }],
    [add('Ajouter un texte', 'text'), add('Ajouter un post-it', 'sticky_note'), add('Ajouter un commentaire', 'comment')],
    [
      prefEntry('grid', letters ? 'G' : '', letters ? 'G' : ''),
      { role: 'menuitemcheckbox', label: 'Afficher les commentaires', shortcut: letters ? 'Maj+C' : '', keys: letters ? 'Shift+C' : '', checked: () => commentsPanel.isOpen(), run: () => commentsPanel.toggle() },
      prefEntry('snapGrid'),
      prefEntry('showSize')
    ],
    [
      { label: 'Souris ou pavé tactile…', run: pointerSettings.open },
      { label: 'Tout afficher', shortcut: 'Alt+1', keys: 'Alt+1', run: () => canvas.zoomToFit() }
    ]
  ];
}

/* Lecture seule : rien qui écrive, seulement la vue et ce qui copie vers l'extérieur. */
function readOnlyEntries(ids = []) {
  const letters = prefs.getPref('singleKey');
  return [
    ...(ids.length ? [[{ ...ACTIONS.copy, run: () => ACTIONS.copy.run(ids) }]] : []),
    [
      prefEntry('grid', letters ? 'G' : '', letters ? 'G' : ''),
      { role: 'menuitemcheckbox', label: 'Afficher les commentaires', shortcut: letters ? 'Maj+C' : '', keys: letters ? 'Shift+C' : '', checked: () => commentsPanel.isOpen(), run: () => commentsPanel.toggle() }
    ],
    [
      { label: 'Souris ou pavé tactile…', run: pointerSettings.open },
      { label: 'Tout afficher', shortcut: 'Alt+1', keys: 'Alt+1', run: () => canvas.zoomToFit() }
    ]
  ];
}

function objectEntries(ids) {
  if (state.isReadOnly()) return readOnlyEntries(ids);
  const items = ids.map(state.getItem).filter(Boolean);
  const onlyLines = items.every(i => i.type === 'connector');
  const onlyComments = items.every(i => i.type === 'comment');
  const textual = !onlyLines && !onlyComments;
  const act = action => ({ ...action, run: () => action.run(ids) });
  const letters = prefs.getPref('singleKey');
  const groupable = items.filter(i => i.type !== 'connector' && i.type !== 'comment');
  const canGroup = groupable.length > 1 && (new Set(groupable.map(i => i.groupId)).size > 1 || !groupable[0].groupId);
  const locked = items.every(i => i.locked);
  return [
    [act(ACTIONS.copy), act(ACTIONS.cut), act(ACTIONS.duplicate), act(ACTIONS.remove)],
    [
      ...(textual ? [{ label: 'Commenter', shortcut: letters ? 'C' : '', keys: letters ? 'C' : '', run: () => canvas.createAtCenter('comment') }] : []),
      act(ACTIONS.copyStyle), act(ACTIONS.pasteStyle),
      ...(textual ? [act(ACTIONS.clear)] : [])
    ],
    [act(ACTIONS.front), act(ACTIONS.back)],
    [
      ...(canGroup ? [act(ACTIONS.group)] : []),
      ...(items.some(i => i.groupId) ? [act(ACTIONS.ungroup)] : []),
      { label: locked ? 'Déverrouiller' : 'Verrouiller', shortcut: 'Ctrl+Maj+L', keys: 'Control+Shift+L', run: () => state.toggleLockedMany(ids) }
    ],
    [
      act(ACTIONS.frame),
      { label: 'Enregistrer comme modèle', run: () => saveAsTemplate(ids) },
      ...(onlyLines ? [] : [{ label: 'Exporter en CSV', run: () => io.exportCSV(ids) }]),
      ...(items.length === 1 && !onlyComments ? [{ label: 'Propriétés…', run: () => onProperties(ids[0]) }] : [])
    ]
  ];
}

function renderEntry(entry) {
  const b = document.createElement('button');
  b.type = 'button';
  b.tabIndex = -1;
  b.setAttribute('role', entry.role || 'menuitem');
  if (entry.checked) b.setAttribute('aria-checked', String(entry.checked()));
  if (entry.keys) b.setAttribute('aria-keyshortcuts', entry.keys);
  if (entry.pref) b.dataset.pref = entry.pref;
  b.innerHTML = '<span class="menu-check" aria-hidden="true">✓</span><span class="menu-label"></span>';
  b.querySelector('.menu-label').textContent = entry.label;
  if (entry.shortcut) {
    const hint = document.createElement('span');
    hint.className = 'menu-shortcut';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = entry.shortcut;
    b.append(hint);
  }
  b.addEventListener('click', () => {
    if (entry.keep) { b.setAttribute('aria-checked', String(entry.run())); return; }
    close(true);
    entry.run();
    if (document.activeElement === document.body) canvas.getSvgElement().focus({ preventScroll: true });
  });
  return b;
}

function place(menu, x, y) {
  const width = menu.offsetWidth, height = menu.offsetHeight;
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const left = Math.max(4, Math.min(x, vw - width - 4));
  const fitsBelow = y + height <= vh - 4;
  const top = fitsBelow ? y : y - height >= 4 ? y - height : Math.max(4, vh - height - 4);
  Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });
}

function onKey(e, items) {
  e.stopPropagation();
  const i = items.indexOf(document.activeElement);
  const moves = { ArrowDown: i + 1, ArrowUp: i < 0 ? -1 : i - 1, Home: 0, End: items.length - 1 };
  if (e.key in moves) { e.preventDefault(); items[(moves[e.key] + items.length) % items.length].focus(); }
  else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
}

function open({ id, clientX, clientY, point, keyboard }) {
  close(false);
  editor.commit(false);
  editor.commitField(false);
  if (!keyboard) canvas.prepareContext(id);
  const ids = id ? state.getSelectedIds() : [];
  const svg = canvas.getSvgElement();
  const origin = document.activeElement === document.body ? svg : document.activeElement;
  const onlyLines = ids.length && ids.every(i => state.getItem(i)?.type === 'connector');
  const menu = document.createElement('div');
  menu.className = 'prefs-menu canvas-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', !ids.length ? 'Menu du canevas' : onlyLines ? 'Menu de la ligne' : 'Menu de l’objet');
  const groups = (ids.length ? objectEntries(ids) : backgroundEntries(point)).filter(group => group.length);
  groups.forEach((group, n) => {
    if (n) { const sep = document.createElement('div'); sep.setAttribute('role', 'separator'); menu.append(sep); }
    menu.append(...group.map(renderEntry));
  });
  menu.addEventListener('contextmenu', e => e.preventDefault());
  document.getElementById('app-board').append(menu);
  place(menu, clientX, clientY);
  const items = [...menu.querySelectorAll('button')];
  menu.addEventListener('keydown', e => onKey(e, items));
  current = { menu, origin };
  /* À la souris, le focus reste sur le menu : les flèches atteignent ensuite les entrées. */
  if (keyboard) items[0].focus({ preventScroll: true });
  else { menu.tabIndex = -1; menu.focus({ preventScroll: true }); }
}

function close(refocus) {
  if (!current) return;
  const { menu, origin } = current;
  current = null;
  menu.remove();
  if (!refocus) return;
  const target = origin.isConnected ? origin : canvas.getSvgElement();
  target.focus({ preventScroll: true });
}
