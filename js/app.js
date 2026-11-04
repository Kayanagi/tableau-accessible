import * as state from './state.js';
import * as announcer from './a11y/announcer.js';
import * as canvas from './views/canvas.js';
import * as outline from './views/outline.js';
import * as table from './views/table.js';
import * as io from './io.js';
import * as router from './router.js';
import * as boards from './store/boards.js';
import * as dashboard from './views/dashboard.js';

let currentView = 'canvas';
let currentTheme = 'auto';
let editingId = null;
let currentBoardId = null;
let unsubAutoSave = null;
let boardInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
  announcer.init();
  boards.init();

  dashboard.init(document.getElementById('app-dashboard'), {
    onThemeToggle: toggleTheme
  });

  setupTheme();
  setupDashboardDialogs();

  router.subscribe(onRouteChange);
  router.init();
});

function onRouteChange(route, oldRoute) {
  if (oldRoute && route.view === oldRoute.view && route.boardId === oldRoute.boardId) return;
  if (route.view === 'tableau' && route.boardId) {
    showBoard(route.boardId);
  } else {
    showDashboard(route);
  }
}

function showDashboard(route) {
  if (unsubAutoSave) { unsubAutoSave(); unsubAutoSave = null; }
  currentBoardId = null;

  document.getElementById('app-board').hidden = true;
  const el = document.querySelector('.board-main');
  if (el) el.removeAttribute('id');

  const dashEl = document.getElementById('app-dashboard');
  dashEl.hidden = false;
  dashboard.render(route);

  const titles = {
    accueil: 'Tableau blanc accessible',
    favoris: 'Favoris — Tableau blanc accessible',
    parcourir: 'Parcourir — Tableau blanc accessible'
  };
  document.title = titles[route.view] || 'Tableau blanc accessible';

  requestAnimationFrame(() => {
    const h1 = document.getElementById('dashboard-title');
    if (h1) h1.focus();
  });

  const labels = { accueil: 'Accueil', favoris: 'Tableaux favoris', parcourir: 'Tous les tableaux' };
  announcer.announce(labels[route.view] || 'Accueil');
}

function showBoard(boardId) {
  const board = boards.get(boardId);
  if (!board) { router.navigate('/'); return; }

  if (unsubAutoSave) { unsubAutoSave(); unsubAutoSave = null; }
  boards.touchOpened(boardId);
  currentBoardId = boardId;

  const dashEl = document.getElementById('app-dashboard');
  dashEl.innerHTML = '';
  dashEl.hidden = true;

  const appBoard = document.getElementById('app-board');
  appBoard.hidden = false;
  const boardMain = appBoard.querySelector('.board-main');
  if (boardMain) boardMain.id = 'main-content';

  if (!boardInitialized) {
    initBoardView();
    boardInitialized = true;
  }

  state.loadBoard(board.données || { name: board.nom, items: [] });

  unsubAutoSave = state.subscribe(() => {
    if (currentBoardId) boards.saveData(currentBoardId, state.getSnapshot());
  });

  document.getElementById('board-title').textContent = board.nom;
  document.title = `${board.nom} — Tableau blanc accessible`;

  requestAnimationFrame(() => {
    const h1 = document.getElementById('board-title');
    if (h1) h1.focus();
  });
  announcer.announce(`Tableau ouvert : ${board.nom}`);
}

function initBoardView() {
  canvas.init(document.getElementById('view-canvas'));
  outline.init(document.getElementById('view-outline'));
  table.init(document.getElementById('view-table'));
  setupTabs();
  setupToolbar();
  setupDialogs();
  setupShortcuts();
}

function setupTabs() {
  const tabs = document.querySelectorAll('[role="tab"]');
  const panels = document.querySelectorAll('[role="tabpanel"]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('aria-controls');
      tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      panels.forEach(p => p.hidden = true);
      document.getElementById(target).hidden = false;
      currentView = target.replace('view-', '');
      announcer.announce(`Vue ${tab.textContent} active`);
    });
    tab.addEventListener('keydown', (e) => {
      const tabsList = Array.from(tabs);
      const idx = tabsList.indexOf(tab);
      let next = -1;
      if (e.key === 'ArrowRight') next = (idx + 1) % tabsList.length;
      if (e.key === 'ArrowLeft') next = (idx - 1 + tabsList.length) % tabsList.length;
      if (next >= 0) { e.preventDefault(); tabsList[next].click(); tabsList[next].focus(); }
    });
  });
}

function setupToolbar() {
  document.getElementById('btn-sticky').addEventListener('click', () => openCreateDialog('sticky_note'));
  document.getElementById('btn-shape').addEventListener('click', () => openCreateDialog('shape'));
  document.getElementById('btn-text').addEventListener('click', () => openCreateDialog('text'));
  document.getElementById('btn-card').addEventListener('click', () => openCreateDialog('card'));
  document.getElementById('btn-frame').addEventListener('click', () => openCreateDialog('frame'));
  document.getElementById('btn-link').addEventListener('click', () => openLinkDialog());
  document.getElementById('btn-undo').addEventListener('click', () => state.undo());
  document.getElementById('btn-redo').addEventListener('click', () => state.redo());
  document.getElementById('btn-zoom-in').addEventListener('click', () => canvas.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => canvas.zoomOut());
  document.getElementById('btn-zoom-reset').addEventListener('click', () => canvas.zoomReset());
  document.getElementById('btn-export-json').addEventListener('click', () => io.exportJSON());
  document.getElementById('btn-export-md').addEventListener('click', () => io.exportMarkdown());
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
  document.getElementById('file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) { try { await io.importJSON(file); } catch (err) { console.error(err); } }
    e.target.value = '';
  });
  document.getElementById('btn-help').addEventListener('click', () => document.getElementById('dialog-help').showModal());
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  state.subscribe(() => {
    document.getElementById('btn-undo').disabled = !state.canUndo();
    document.getElementById('btn-redo').disabled = !state.canRedo();
  });
}

function toggleTheme() {
  const themes = ['auto', 'light', 'dark', 'high-contrast'];
  const labels = { auto: 'Automatique', light: 'Clair', dark: 'Sombre', 'high-contrast': 'Contraste élevé' };
  const idx = themes.indexOf(currentTheme);
  currentTheme = themes[(idx + 1) % themes.length];
  applyTheme();
  announcer.announce(`Thème : ${labels[currentTheme]}`);
}

function setupTheme() {
  try { const saved = localStorage.getItem('tableau-accessible-theme'); if (saved) currentTheme = saved; } catch (e) { /* ignore */ }
  applyTheme();
}

function applyTheme() {
  const html = document.documentElement;
  html.removeAttribute('data-theme');
  if (currentTheme !== 'auto') html.setAttribute('data-theme', currentTheme);
  try { localStorage.setItem('tableau-accessible-theme', currentTheme); } catch (e) { /* ignore */ }
}

function setupDialogs() {
  const dialogItem = document.getElementById('dialog-item');
  const dialogLink = document.getElementById('dialog-link');
  const dialogHelp = document.getElementById('dialog-help');

  dialogItem.querySelector('.dialog-cancel').addEventListener('click', () => dialogItem.close());
  dialogLink.querySelector('.dialog-cancel').addEventListener('click', () => dialogLink.close());
  dialogHelp.querySelector('.dialog-close').addEventListener('click', () => dialogHelp.close());

  dialogItem.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitItemForm(); });
  dialogItem.querySelector('.dialog-delete').addEventListener('click', () => {
    if (editingId) { state.removeItem(editingId); editingId = null; dialogItem.close(); }
  });

  dialogLink.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitLinkForm(); });
  dialogLink.querySelector('.dialog-delete').addEventListener('click', () => {
    if (editingId) { state.removeItem(editingId); editingId = null; dialogLink.close(); }
  });

  canvas.getSvgElement().addEventListener('item-edit', (e) => openEditDialog(e.detail.id));
  document.addEventListener('table-edit', (e) => openEditDialog(e.detail.id));
  document.addEventListener('outline-focus', (e) => { if (currentView === 'canvas') canvas.focusItem(e.detail.id); });
}

function setupDashboardDialogs() {
  const createD = document.getElementById('dialog-create-board');
  if (createD) {
    createD.querySelector('.dialog-cancel').addEventListener('click', () => createD.close());
    createD.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); dashboard.handleCreateSubmit(); });
  }
  const renameD = document.getElementById('dialog-rename-board');
  if (renameD) {
    renameD.querySelector('.dialog-cancel').addEventListener('click', () => renameD.close());
    renameD.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); dashboard.handleRenameSubmit(); });
  }
  const deleteD = document.getElementById('dialog-delete-board');
  if (deleteD) {
    deleteD.querySelector('.dialog-cancel').addEventListener('click', () => deleteD.close());
    deleteD.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); dashboard.handleDeleteConfirm(); });
  }
}

function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('dialog[open]') || e.target.closest('input, textarea, select')) return;
    const boardVisible = !document.getElementById('app-board').hidden;
    if (!boardVisible) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); state.undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' && e.shiftKey || e.key === 'Z')) { e.preventDefault(); state.redo(); }
    else if (e.key === '?' || (e.shiftKey && e.key === '?')) { e.preventDefault(); document.getElementById('dialog-help').showModal(); }
    else if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); canvas.zoomIn(); }
    else if (e.key === '-' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); canvas.zoomOut(); }
    else if (e.key === '0' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); canvas.zoomReset(); }
    else if (e.key === 'n' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openCreateDialog('sticky_note'); }
  });
}

function openCreateDialog(type) {
  editingId = null;
  const dialog = document.getElementById('dialog-item');
  const form = dialog.querySelector('form');
  form.reset();
  const titles = { sticky_note: 'Nouveau post-it', shape: 'Nouvelle forme', text: 'Nouveau texte', card: 'Nouvelle carte', frame: 'Nouveau cadre' };
  dialog.querySelector('.dialog-title').textContent = titles[type] || 'Nouvel élément';
  dialog.querySelector('[name="item-type"]').value = type;
  dialog.querySelector('.dialog-submit').textContent = 'Créer';
  dialog.querySelector('.dialog-delete').hidden = true;
  toggleFieldsets(type);
  const center = canvas.getViewCenter();
  form.querySelector('[name="item-x"]').value = center.x;
  form.querySelector('[name="item-y"]').value = center.y;
  updateParentSelect();
  dialog.showModal();
}

function openEditDialog(id) {
  const item = state.getItem(id);
  if (!item) return;
  editingId = id;
  if (item.type === 'connector') { openLinkDialogForEdit(item); return; }
  const dialog = document.getElementById('dialog-item');
  const form = dialog.querySelector('form');
  form.reset();
  const titles = { sticky_note: 'Éditer le post-it', shape: 'Éditer la forme', text: 'Éditer le texte', card: 'Éditer la carte', frame: 'Éditer le cadre' };
  dialog.querySelector('.dialog-title').textContent = titles[item.type] || 'Éditer';
  dialog.querySelector('[name="item-type"]').value = item.type;
  dialog.querySelector('.dialog-submit').textContent = 'Enregistrer';
  dialog.querySelector('.dialog-delete').hidden = false;
  toggleFieldsets(item.type);
  form.querySelector('[name="item-content"]').value = item.content || '';
  form.querySelector('[name="item-x"]').value = item.x || 0;
  form.querySelector('[name="item-y"]').value = item.y || 0;
  form.querySelector('[name="item-width"]').value = item.width || 150;
  form.querySelector('[name="item-height"]').value = item.height || 150;
  if (item.type === 'sticky_note' && item.color) { const r = form.querySelector(`[name="item-color"][value="${item.color}"]`); if (r) r.checked = true; }
  if (item.type === 'shape' && item.shape) { const r = form.querySelector(`[name="item-shape"][value="${item.shape}"]`); if (r) r.checked = true; }
  if (item.type === 'card' && item.title) form.querySelector('[name="item-title"]').value = item.title;
  updateParentSelect(item.id);
  if (item.parent) form.querySelector('[name="item-parent"]').value = item.parent;
  dialog.showModal();
}

function toggleFieldsets(type) {
  const dialog = document.getElementById('dialog-item');
  dialog.querySelector('.fields-color').hidden = type !== 'sticky_note';
  dialog.querySelector('.fields-shape').hidden = type !== 'shape';
  dialog.querySelector('.fields-card-title').hidden = type !== 'card';
  dialog.querySelector('.fields-size').hidden = (type === 'text');
  dialog.querySelector('.fields-parent').hidden = (type === 'frame');
}

function updateParentSelect(excludeId) {
  const select = document.querySelector('[name="item-parent"]');
  const frames = state.getFrames();
  select.innerHTML = '<option value="">Aucun</option>';
  for (const f of frames) {
    if (f.id === excludeId) continue;
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.content || '(cadre sans nom)';
    select.appendChild(opt);
  }
}

function submitItemForm() {
  const dialog = document.getElementById('dialog-item');
  const form = dialog.querySelector('form');
  const fd = new FormData(form);
  const type = fd.get('item-type');
  const data = {
    type, content: fd.get('item-content') || '',
    x: parseInt(fd.get('item-x'), 10) || 0, y: parseInt(fd.get('item-y'), 10) || 0,
    width: parseInt(fd.get('item-width'), 10) || 150, height: parseInt(fd.get('item-height'), 10) || 150
  };
  if (type === 'sticky_note') data.color = fd.get('item-color') || 'yellow';
  if (type === 'shape') data.shape = fd.get('item-shape') || 'rectangle';
  if (type === 'card') data.title = fd.get('item-title') || '';
  if (type === 'text') { data.width = 200; data.height = 30; }
  const parent = fd.get('item-parent');
  if (parent && type !== 'frame') data.parent = parent;
  if (editingId) {
    state.updateItem(editingId, data);
    announcer.announce(`${state.TYPES[type]} modifié`);
  } else {
    const item = state.addItem(data);
    announcer.announce(`${state.TYPES[type]} ajouté`);
    if (currentView === 'canvas') requestAnimationFrame(() => canvas.focusItem(item.id));
  }
  editingId = null;
  dialog.close();
}

function openLinkDialog() {
  editingId = null;
  const dialog = document.getElementById('dialog-link');
  dialog.querySelector('form').reset();
  dialog.querySelector('.dialog-title').textContent = 'Nouveau lien';
  dialog.querySelector('.dialog-submit').textContent = 'Créer';
  dialog.querySelector('.dialog-delete').hidden = true;
  populateLinkSelects();
  dialog.showModal();
}

function openLinkDialogForEdit(item) {
  editingId = item.id;
  const dialog = document.getElementById('dialog-link');
  const form = dialog.querySelector('form');
  form.reset();
  dialog.querySelector('.dialog-title').textContent = 'Éditer le lien';
  dialog.querySelector('.dialog-submit').textContent = 'Enregistrer';
  dialog.querySelector('.dialog-delete').hidden = false;
  populateLinkSelects();
  form.querySelector('[name="link-start"]').value = item.startId;
  form.querySelector('[name="link-end"]').value = item.endId;
  form.querySelector('[name="link-label"]').value = item.label || '';
  dialog.showModal();
}

function populateLinkSelects() {
  const items = state.getNonConnectorItems();
  document.querySelectorAll('#dialog-link select').forEach(sel => {
    sel.innerHTML = '<option value="">-- Choisir --</option>';
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = state.getItemLabel(item);
      sel.appendChild(opt);
    }
  });
}

function submitLinkForm() {
  const dialog = document.getElementById('dialog-link');
  const fd = new FormData(dialog.querySelector('form'));
  const startId = fd.get('link-start');
  const endId = fd.get('link-end');
  const label = fd.get('link-label') || '';
  if (!startId || !endId || startId === endId) {
    announcer.announce('Veuillez choisir deux éléments différents');
    return;
  }
  if (editingId) {
    state.updateItem(editingId, { startId, endId, label });
    announcer.announce('Lien modifié');
  } else {
    state.addItem({ type: 'connector', startId, endId, label, x: 0, y: 0 });
    const s = state.getItem(startId);
    const t = state.getItem(endId);
    announcer.announce(`Lien créé entre ${s ? state.getItemLabel(s) : '?'} et ${t ? state.getItemLabel(t) : '?'}`);
  }
  editingId = null;
  dialog.close();
}
