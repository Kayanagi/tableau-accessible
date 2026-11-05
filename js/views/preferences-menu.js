import * as prefs from '../preferences.js';
import * as state from '../state.js';
import { BOARD_BACKGROUNDS } from '../objects.js';
import { announce } from '../a11y/announcer.js';

let nextId = 0;
let openMenu = null;

const themeLabel = () => `Thème : ${prefs.THEMES[prefs.getTheme()].name}`;

function preview(colors) {
  return `<span class="theme-preview" aria-hidden="true">${colors.map(c => `<span style="background:${c}"></span>`).join('')}</span>`;
}

function themeEntries() {
  return Object.entries(prefs.THEMES).map(([id, t]) => ({
    role: 'menuitemradio', theme: id, label: t.hint ? `${t.name} (${t.hint})` : t.name, icon: preview(t.colors), checked: prefs.getTheme() === id,
    run: () => { prefs.setTheme(id); announce(`Thème : ${t.name}`); }
  }));
}

function checkEntry(pref, label, on, off) {
  return { role: 'menuitemcheckbox', pref, label, checked: prefs.getPref(pref), keep: true, run: () => { const v = !prefs.getPref(pref); prefs.setPref(pref, v); announce(v ? on : off); return v; } };
}

function backgroundEntries() {
  const current = state.getBoard().background || 'default';
  return BOARD_BACKGROUNDS.map(([id, name, hex]) => ({
    role: 'menuitemradio', background: id, label: name, icon: hex ? preview([hex]) : preview(['var(--bg)']), checked: current === id,
    run: () => state.setBoardBackground(id)
  }));
}

function prefsSections(board) {
  return [
    { title: 'Apparence', entries: themeEntries() },
    { title: 'Affichage et clavier', entries: [
      checkEntry('grid', 'Afficher la grille', 'Grille affichée', 'Grille masquée'),
      checkEntry('reduceMotion', 'Réduire les animations', 'Animations réduites', 'Animations rétablies'),
      checkEntry('singleKey', 'Raccourcis à une lettre', 'Raccourcis à une lettre activés', 'Raccourcis à une lettre désactivés')
    ] },
    ...(board ? [{ title: 'Couleur de fond du tableau', entries: backgroundEntries() }] : [])
  ];
}

function renderEntry(entry, close) {
  const b = document.createElement('button');
  b.type = 'button';
  b.tabIndex = -1;
  b.setAttribute('role', entry.role);
  b.setAttribute('aria-checked', String(entry.checked));
  if (entry.theme) b.dataset.theme = entry.theme;
  if (entry.pref) b.dataset.pref = entry.pref;
  if (entry.background) b.dataset.background = entry.background;
  b.innerHTML = `<span class="menu-check" aria-hidden="true">✓</span>${entry.icon || ''}<span class="menu-label"></span>`;
  b.querySelector('.menu-label').textContent = entry.label;
  b.addEventListener('click', () => {
    const value = entry.run();
    if (entry.keep) b.setAttribute('aria-checked', String(value));
    else close(true);
  });
  return b;
}

function closeCurrent(refocus) {
  if (!openMenu) return;
  const { menu, button } = openMenu;
  openMenu = null;
  menu.remove();
  button.setAttribute('aria-expanded', 'false');
  if (refocus) button.focus();
}

function place(menu, button) {
  const r = button.getBoundingClientRect();
  const width = menu.offsetWidth, height = menu.offsetHeight;
  const left = Math.max(4, Math.min(r.left, innerWidth - width - 4));
  const below = r.bottom + 4;
  const top = below + height > innerHeight - 4 ? Math.max(4, innerHeight - height - 4) : below;
  Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });
}

function open(button, name, sections, last) {
  closeCurrent(false);
  const menu = document.createElement('div');
  menu.className = 'prefs-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', name);
  menu.id = button.getAttribute('aria-controls');
  const close = refocus => closeCurrent(refocus);
  sections.forEach((section, n) => {
    if (n) { const sep = document.createElement('div'); sep.setAttribute('role', 'separator'); menu.append(sep); }
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    if (section.title) {
      const id = `${menu.id}-g${n}`;
      const head = document.createElement('div');
      head.className = 'prefs-menu-title';
      head.id = id;
      head.textContent = section.title;
      group.setAttribute('aria-labelledby', id);
      group.append(head);
    }
    section.entries.forEach(entry => group.append(renderEntry(entry, close)));
    menu.append(group);
  });
  button.after(menu);
  button.setAttribute('aria-expanded', 'true');
  openMenu = { menu, button };
  place(menu, button);
  const items = [...menu.querySelectorAll('button')];
  const start = last ? items[items.length - 1] : items.find(i => i.getAttribute('role') === 'menuitemradio' && i.getAttribute('aria-checked') === 'true') || items[0];
  start.focus();
  menu.addEventListener('keydown', e => {
    e.stopPropagation();
    const i = items.indexOf(document.activeElement);
    const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 };
    if (e.key in moves) { e.preventDefault(); items[(moves[e.key] + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
  });
}

function menuButton(className, text, name, sections) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-control';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', `menu-${++nextId}`);
  button.addEventListener('click', () => { if (openMenu?.button === button) closeCurrent(true); else open(button, name, sections()); });
  button.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); open(button, name, sections(), e.key === 'ArrowUp'); }
  });
  wrap.append(button);
  return wrap;
}

export function init() {
  prefs.subscribe(() => document.querySelectorAll('.btn-appearance').forEach(b => { b.textContent = themeLabel(); }));
  document.addEventListener('pointerdown', e => {
    if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.button.contains(e.target)) closeCurrent(false);
  });
  addEventListener('resize', () => closeCurrent(false));
}

export function mount(host, board = false) {
  host.append(
    menuButton('btn-appearance', themeLabel(), 'Apparence', () => [{ entries: themeEntries() }]),
    menuButton('btn-preferences', 'Préférences', 'Préférences', () => prefsSections(board))
  );
}
