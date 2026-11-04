import { announce } from '../a11y/announcer.js';

const CATEGORIES = [
  ['Dessin', [
    ['pen', 'Stylo', 'P', 'Dessin à main levée, couleur et épaisseur au choix'],
    ['eraser', 'Gomme', 'E', 'Efface le tracé touché']
  ]],
  ['Essentiels', [
    ['comment', 'Commentaire', 'C', 'Pastille avec fil de discussion, sur un objet ou le canevas'],
    ['flipcard', 'Carte recto-verso', '', 'Deux faces à retourner, pour réviser ou révéler'],
    ['code', 'Bloc de code', '', 'Texte à chasse fixe, langage et coloration'],
    ['sticky_note', 'Post-it', 'N', 'Note colorée'],
    ['text', 'Texte', 'T', 'Texte libre'],
    ['frame', 'Cadre', 'F', 'Regroupe des éléments']
  ]],
  ['Formats', [
    ['kanban', 'Kanban', '', 'Colonnes À faire, En cours, Fait et cartes déplaçables'],
    ['datatable', 'Tableau de données', '', 'Grille de lignes et de colonnes éditables'],
    ['mindmap', 'Carte mentale', '', 'Idée centrale et branches, disposition automatique']
  ]]
];

let panel = null;
let button = null;
let list = null;
let search = null;
let count = null;
let onChoose = () => {};

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function init(host, trigger, choose) {
  button = trigger;
  onChoose = choose;
  panel = document.createElement('div');
  panel.id = 'tools-panel';
  panel.className = 'tools-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'tools-panel-title');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="tools-panel-head">
      <h2 id="tools-panel-title">Plus d’outils</h2>
      <button type="button" class="tools-close" aria-label="Fermer le panneau des outils (Échap)">×</button>
    </div>
    <label for="tools-search">Rechercher un outil</label>
    <input id="tools-search" type="search" autocomplete="off" aria-describedby="tools-count">
    <p id="tools-count" class="sr-only" aria-live="polite"></p>
    <div class="tools-list"></div>`;
  host.appendChild(panel);
  list = panel.querySelector('.tools-list');
  search = panel.querySelector('#tools-search');
  count = panel.querySelector('#tools-count');
  for (const [cat, tools] of CATEGORIES) {
    const section = document.createElement('section');
    section.className = 'tools-category';
    const id = `tools-cat-${fold(cat)}`;
    section.setAttribute('aria-labelledby', id);
    section.innerHTML = `<h3 id="${id}">${cat}</h3><ul></ul>`;
    for (const [tool, name, key, desc] of tools) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tool = tool;
      b.dataset.search = fold(`${name} ${desc} ${cat}`);
      b.setAttribute('aria-label', key ? `${name} (${key})` : name);
      b.setAttribute('aria-describedby', `tool-desc-${tool}`);
      if (key) b.setAttribute('aria-keyshortcuts', key.toLowerCase());
      b.innerHTML = `<span class="tool-name">${name}${key ? ` <kbd>${key}</kbd>` : ''}</span><span class="tool-desc" id="tool-desc-${tool}">${desc}</span>`;
      b.addEventListener('click', e => { close(false); onChoose(tool, e.detail === 0); });
      li.appendChild(b);
      section.querySelector('ul').appendChild(li);
    }
    list.appendChild(section);
  }
  search.addEventListener('input', filter);
  panel.querySelector('.tools-close').addEventListener('click', () => close(true));
  panel.addEventListener('keydown', onKey);
  panel.addEventListener('focusout', e => { if (!panel.hidden && e.relatedTarget && !panel.contains(e.relatedTarget) && e.relatedTarget !== button) close(false); });
  document.addEventListener('pointerdown', e => { if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) close(false); });
  button.addEventListener('click', () => (panel.hidden ? open() : close(true)));
}

export function isOpen() {
  return panel && !panel.hidden;
}

export function open() {
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  search.value = '';
  filter();
  place();
  search.focus();
  announce('Panneau Plus d’outils ouvert : saisissez pour filtrer, flèches pour parcourir, Échap pour fermer');
}

export function close(refocus) {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (refocus) button.focus();
}

function place() {
  const narrow = matchMedia('(max-width: 640px)').matches;
  const r = button.getBoundingClientRect();
  Object.assign(panel.style, narrow ? { left: '', top: '', bottom: `${innerHeight - r.top + 6}px` } : { left: `${r.right + 8}px`, top: `${Math.max(8, Math.min(r.top - 120, innerHeight - panel.offsetHeight - 8))}px`, bottom: '' });
}

function visibleButtons() {
  return [...list.querySelectorAll('button')].filter(b => !b.closest('[hidden]'));
}

function filter() {
  const q = fold(search.value.trim());
  let n = 0;
  for (const section of list.children) {
    let shown = 0;
    for (const li of section.querySelectorAll('li')) {
      const ok = !q || li.firstChild.dataset.search.includes(q);
      li.hidden = !ok;
      if (ok) shown++;
    }
    section.hidden = !shown;
    n += shown;
  }
  count.textContent = q ? (n ? `${n} outil${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''}` : 'Aucun outil trouvé') : '';
}

function onKey(e) {
  if (e.key !== 'Tab') e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
  const all = visibleButtons();
  if (e.target === search) {
    if (e.key === 'ArrowDown' && all.length) { e.preventDefault(); all[0].focus(); }
    if (e.key === 'Enter' && all.length) { e.preventDefault(); all[0].click(); }
    e.stopPropagation();
    return;
  }
  const i = all.indexOf(e.target);
  if (i < 0) return;
  const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 };
  if (e.key in moves) {
    e.preventDefault();
    e.stopPropagation();
    const n = moves[e.key];
    if (n < 0) search.focus(); else all[Math.min(n, all.length - 1)].focus();
  }
}
