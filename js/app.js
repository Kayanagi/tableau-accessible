import * as navigation from './views/navigation.js';
import * as boardActions from './views/board-actions.js';
import * as state from './state.js';
import * as announcer from './a11y/announcer.js';
import * as canvas from './views/canvas.js';
import * as outline from './views/outline.js';
import * as table from './views/table.js';
import * as io from './io.js';
import * as router from './router.js';
import * as boards from './store/boards.js';
import * as dashboard from './views/dashboard.js';
import * as editor from './views/inline-editor.js';
import * as contextToolbar from './views/context-toolbar.js';
import * as clipboard from './clipboard.js';
import * as toolsPanel from './views/tools-panel.js';
import * as commentsPanel from './views/comments-panel.js';
import * as objects from './views/canvas-objects.js';
import * as O from './objects.js';
import * as L from './lines.js';
import * as paletteDrag from './views/palette-drag.js';

const TOOL_BUTTONS = { 'btn-select': 'select', 'btn-hand': 'hand', 'btn-sticky': 'sticky_note', 'btn-shape': 'shape:rectangle', 'btn-line': 'line', 'btn-text': 'text', 'btn-card': 'card', 'btn-frame': 'frame' };
const TOOL_KEYS = { v: 'select', h: 'hand', n: 'sticky_note', t: 'text', s: 'shape:rectangle', r: 'shape:rectangle', o: 'shape:circle', l: 'line', f: 'frame', p: 'pen', e: 'eraser', c: 'comment' };
const MORE_TOOLS = ['pen', 'eraser', 'comment', 'mindmap', 'kanban', 'datatable', 'code', 'flipcard'];

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
  if (oldRoute && route.view === oldRoute.view && route.boardId === oldRoute.boardId && route.spaceId === oldRoute.spaceId) return;
  if (route.view === 'tableau' && route.boardId) {
    showBoard(route.boardId);
  } else {
    showDashboard(route);
  }
}

function showDashboard(route) {
  if (unsubAutoSave) { unsubAutoSave(); unsubAutoSave = null; }
  currentBoardId = null;
  if (boardInitialized) navigation.reset();

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

  navigation.reset();
  editor.commit(false);
  editor.commitField(false);
  toolsPanel.close(false);
  commentsPanel.close(false);
  canvas.setTool('select');
  state.loadBoard(board.données || { name: board.nom, items: [] });

  unsubAutoSave = state.subscribe(() => {
    if (currentBoardId) boards.saveData(currentBoardId, state.getSnapshot());
  });

  document.getElementById('board-title').textContent = `${board.emoji || '📋'} ${board.nom}`;
  requestAnimationFrame(() => canvas.zoomToFit());
  document.title = `${board.nom} — Tableau blanc accessible`;

  requestAnimationFrame(() => {
    const h1 = document.getElementById('board-title');
    if (h1) h1.focus();
  });
  announcer.announce(`Tableau ouvert : ${board.nom}`);
}

function initBoardView() {
  canvas.init(document.getElementById('view-canvas'));
  editor.init();
  contextToolbar.init(document.getElementById('view-canvas'), { onProperties: openEditDialog, onNewTag: openTagDialog, onOpenComment: id => commentsPanel.open(id, true) });
  const appBoard = document.getElementById('app-board');
  toolsPanel.init(appBoard, document.getElementById('btn-more-tools'), chooseTool);
  commentsPanel.init(appBoard, document.getElementById('btn-comments'), gotoItem);
  outline.init(document.getElementById('view-outline'));
  table.init(document.getElementById('view-table'));
  boardActions.init(() => currentBoardId);
  setupTabs();
  setupToolbar();
  setupDialogs();
  navigation.init(showCanvasTab);
  setupDragSources();
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
  const colors = document.querySelector('.color-options');
  colors.replaceChildren();
  state.PALETTE.forEach(([id, name, hex], index) => {
    const label = document.createElement('label');
    label.className = 'color-option';
    const radio = document.createElement('input');
    Object.assign(radio, { type: 'radio', name: 'item-color', value: id, defaultChecked: index === 0 });
    radio.setAttribute('aria-label', `${name}, ${index + 1} sur 16`);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = hex;
    swatch.setAttribute('aria-hidden', 'true');
    label.append(radio, swatch, document.createTextNode(name));
    colors.append(label);
  });
  setupToolPalette();
  setupShapePalette();
  setupPenPalette();
  const selected = () => state.getSelectedIds();
  document.getElementById('btn-duplicate').onclick = () => duplicate(selected());
  document.getElementById('btn-lock').onclick = () => state.toggleLockedMany(selected());
  document.getElementById('btn-front').onclick = () => state.reorderItems(selected(), true);
  document.getElementById('btn-backward').onclick = () => state.reorderItems(selected(), false);
  document.querySelectorAll('#app-board [role="toolbar"]:not(.context-toolbar)').forEach(bar => {
    const buttons = () => [...bar.querySelectorAll('button')].filter(b => !b.disabled && !b.closest('[hidden], [role=menu]') && b.closest('[role="toolbar"]') === bar);
    const reset = () => { bar.querySelectorAll('button').forEach(b => { if (b.closest('[role="toolbar"]') === bar) b.tabIndex = -1; }); const all = buttons(); all.forEach((b, i) => b.tabIndex = i === 0 ? 0 : -1); };
    reset();
    bar.addEventListener('focusin', e => { if (e.target.matches('button') && e.target.closest('[role="toolbar"]') === bar) buttons().forEach(b => b.tabIndex = b === e.target ? 0 : -1); });
    bar.addEventListener('keydown', e => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const all = buttons(), i = all.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault(); e.stopPropagation();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + all.length) % all.length;
      all[next].focus();
    });
    state.subscribe(() => { if (!buttons().some(b => b.tabIndex === 0)) reset(); });
  });
  for (const [btnId, tool] of Object.entries(TOOL_BUTTONS)) {
    document.getElementById(btnId).addEventListener('click', (e) => {
      if (e.detail === 0 && canvas.isCreationTool(tool)) { createAtCenter(tool); return; }
      activateTool(canvas.getTool() === tool && tool !== 'select' ? 'select' : tool, false);
    });
  }
  canvas.onToolChange(tool => {
    for (const [btnId, t] of Object.entries(TOOL_BUTTONS)) {
      document.getElementById(btnId).setAttribute('aria-pressed', String(t === tool || (btnId === 'btn-shape' && tool.startsWith('shape'))));
    }
    const more = document.getElementById('btn-more-tools');
    more.classList.toggle('has-tool', MORE_TOOLS.includes(tool));
    more.setAttribute('aria-label', MORE_TOOLS.includes(tool) ? `Plus d’outils (actif : ${canvas.TOOL_NAMES[tool]})` : 'Plus d’outils');
    const creation = document.querySelector('#app-board .creation-toolbar').getBoundingClientRect();
    document.querySelectorAll('#shape-palette [data-shape]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shape === tool)));
    for (const [paletteId, t] of [['sticky-palette', 'sticky_note'], ['shape-palette', 'shape'], ['pen-palette', 'pen']]) {
      const palette = document.getElementById(paletteId);
      palette.hidden = tool.split(':')[0] !== t;
      palette.style.bottom = matchMedia('(max-width: 640px)').matches ? `${innerHeight - creation.top + 6}px` : '';
    }
  });
  document.getElementById('btn-link').addEventListener('click', () => openLinkDialog());
  document.getElementById('btn-undo').addEventListener('click', () => state.undo());
  document.getElementById('btn-redo').addEventListener('click', () => state.redo());
  document.getElementById('btn-zoom-in').addEventListener('click', () => canvas.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => canvas.zoomOut());
  document.getElementById('btn-zoom-reset').addEventListener('click', () => canvas.zoomReset());
  document.getElementById('btn-zoom-fit').addEventListener('click', () => canvas.zoomToFit());
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

function setupToolPalette() {
  const palette = document.getElementById('sticky-palette');
  const grid = palette.querySelector('.tool-colors');
  state.PALETTE.forEach(([id, name, hex], index) => {
    const label = document.createElement('label');
    label.className = 'tool-color';
    label.title = name;
    const radio = document.createElement('input');
    Object.assign(radio, { type: 'radio', name: 'tool-color', value: id, checked: index === 0 });
    radio.setAttribute('aria-label', `${name}, ${index + 1} sur 16`);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = hex;
    swatch.setAttribute('aria-hidden', 'true');
    label.append(radio, swatch);
    grid.append(label);
  });
  palette.addEventListener('change', e => canvas.setStickyColor(e.target.value));
  palette.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); createAtCenter('sticky_note'); }
    if (e.key === 'Escape') { e.preventDefault(); canvas.cancelTool(); document.getElementById('btn-sticky').focus(); }
  });
}

function setupShapePalette() {
  const palette = document.getElementById('shape-palette');
  palette.addEventListener('click', e => {
    const button = e.target.closest('[data-shape]');
    if (!button) return;
    if (e.detail === 0) createAtCenter(button.dataset.shape);
    else activateTool(button.dataset.shape, false);
  });
  palette.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); canvas.cancelTool(); document.getElementById('btn-shape').focus(); }
  });
}

function setupDragSources() {
  const buttons = { 'btn-sticky': 'sticky_note', 'btn-shape': 'shape:rectangle', 'btn-line': 'line', 'btn-text': 'text', 'btn-card': 'card', 'btn-frame': 'frame' };
  for (const [id, tool] of Object.entries(buttons)) {
    paletteDrag.attach(document.getElementById(id), () => ({ tool, color: tool === 'sticky_note' ? canvas.getStickyColor() : null }));
  }
  document.querySelectorAll('#sticky-palette .tool-color').forEach(label => {
    paletteDrag.attach(label, () => ({ tool: 'sticky_note', color: label.querySelector('input').value }));
  });
  document.querySelectorAll('#shape-palette [data-shape]').forEach(button => {
    paletteDrag.attach(button, () => ({ tool: button.dataset.shape }));
  });
  document.querySelectorAll('#tools-panel [data-tool]').forEach(button => {
    if (!canvas.isCreationTool(button.dataset.tool)) return;
    paletteDrag.attach(button, () => ({ tool: button.dataset.tool, color: button.dataset.tool === 'sticky_note' ? canvas.getStickyColor() : null, panel: document.getElementById('tools-panel'), done: () => toolsPanel.close(false) }));
  });
}

function setupPenPalette() {
  const palette = document.getElementById('pen-palette');
  const colors = palette.querySelector('.pen-colors');
  O.PEN_COLORS.forEach(([id, name, hex], index) => {
    const label = document.createElement('label');
    label.className = 'tool-color';
    label.title = name;
    const radio = document.createElement('input');
    Object.assign(radio, { type: 'radio', name: 'pen-color', value: id, checked: index === 0 });
    radio.setAttribute('aria-label', name);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = hex;
    swatch.setAttribute('aria-hidden', 'true');
    label.append(radio, swatch);
    colors.append(label);
  });
  const widths = palette.querySelector('.pen-widths');
  O.PEN_WIDTHS.forEach(([w, name]) => {
    const label = document.createElement('label');
    label.className = 'pen-width';
    const radio = document.createElement('input');
    Object.assign(radio, { type: 'radio', name: 'pen-width', value: String(w), checked: w === 4 });
    label.append(radio, ` ${name}`);
    widths.append(label);
  });
  palette.addEventListener('change', e => canvas.setPen(e.target.name === 'pen-color' ? e.target.value : null, e.target.name === 'pen-width' ? Number(e.target.value) : null));
  palette.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); canvas.cancelTool(); document.getElementById('btn-more-tools').focus(); }
  });
}

function chooseTool(tool, keyboard) {
  if (keyboard && canvas.isCreationTool(tool)) { createAtCenter(tool); return; }
  activateTool(tool, keyboard);
  const active = document.activeElement;
  if (!active || active === document.body || active.closest('[hidden]')) document.getElementById('btn-more-tools').focus();
}

function gotoItem(id) {
  showCanvasTab();
  canvas.reveal(id);
  canvas.focusItem(id);
  announcer.announce(`Élément atteint : ${state.getItemLabel(state.getItem(id))}`);
}

function openTagDialog(ids) {
  const dialog = document.getElementById('dialog-tag');
  const form = dialog.querySelector('form');
  form.reset();
  dialog.dataset.ids = JSON.stringify(ids || []);
  dialog.showModal();
}

function setupTagDialog() {
  const dialog = document.getElementById('dialog-tag');
  const select = dialog.querySelector('[name="tag-color"]');
  for (const [id, name] of O.TAG_COLORS) select.add(new Option(name, id));
  dialog.querySelector('.dialog-cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('tag-name') || '').trim();
    if (!name) return;
    state.createTag(name, fd.get('tag-color'), JSON.parse(dialog.dataset.ids || '[]'));
    dialog.close();
    canvas.focusItem(state.getSelectedId());
  });
}

function showCanvasTab() {
  if (currentView !== 'canvas') document.getElementById('tab-canvas').click();
}

function activateTool(tool, fromKey) {
  showCanvasTab();
  canvas.setTool(tool);
  const name = canvas.TOOL_NAMES[tool];
  if (tool === 'pen' || tool === 'eraser') { activateDrawTool(tool, fromKey); return; }
  if (!canvas.isCreationTool(tool)) { announcer.announce(`Outil ${name} actif`); return; }
  if (tool === 'line') { announcer.announce('Outil Ligne actif : glissez sur le canevas pour tracer une ligne libre, cliquez pour une ligne de longueur par défaut, ou Entrée pour la créer au centre de la vue. Échap pour annuler.'); return; }
  announcer.announce(`Outil ${name} actif : cliquez sur le canevas pour poser l’élément, ou Entrée pour le créer au centre de la vue. Échap pour annuler.`);
  if (tool === 'sticky_note' && fromKey) document.querySelector('#sticky-palette input:checked')?.focus();
}

function activateDrawTool(tool, fromKey) {
  const hint = tool === 'pen'
    ? 'Outil Stylo actif : dessinez au pointeur sur le canevas. Échap pour quitter.'
    : 'Outil Gomme actif : passez sur un tracé pour l’effacer. Échap pour quitter.';
  announcer.announce(hint);
  if (tool === 'pen' && fromKey) document.querySelector('#pen-palette input[name="pen-color"]:checked')?.focus();
}

function createAtCenter(tool) {
  showCanvasTab();
  canvas.createAtCenter(tool);
}

function duplicate(ids) {
  const copies = state.duplicateItems(ids);
  if (copies[0]) canvas.focusItem(copies[0].id);
  if (copies.length > 1) state.setSelection(copies.map(c => c.id));
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

  canvas.getSvgElement().addEventListener('item-edit', (e) => {
    const item = state.getItem(e.detail.id);
    if (item?.type === 'connector') editor.openLineLabel(item.id);
    else if (item?.type === 'comment') commentsPanel.open(item.id, true);
    else if (item && !objects.enterSub(item)) editor.open(item.id, e.detail.isNew);
  });
  canvas.getSvgElement().addEventListener('comment-open', (e) => commentsPanel.open(e.detail.id, e.detail.focus));
  setupTagDialog();
  setupLinkDialog();
  document.addEventListener('table-edit', (e) => openEditDialog(e.detail.id));
  document.addEventListener('outline-focus', (e) => { if (currentView === 'canvas') canvas.focusItem(e.detail.id); });
}

function setupDashboardDialogs() {
  for (const id of ['dialog-rename-board', 'dialog-delete-board']) {
    document.getElementById(id).addEventListener('close', () => {
      if (document.activeElement === document.body) document.getElementById('dashboard-title')?.focus();
    });
  }
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
    if (e.defaultPrevented) return;
    if (e.target.closest('dialog[open]') || e.target.closest('input, textarea, select, [contenteditable], .comments-panel, .tools-panel, .frames-panel, .board-search')) return;
    const boardVisible = !document.getElementById('app-board').hidden;
    if (!boardVisible) return;
    if (currentView === 'canvas') {
      const key = e.key.toLowerCase();
      const id = document.activeElement.closest?.('.canvas-item')?.getAttribute('data-id') || state.getSelectedId();
      const item = state.getItem(id);
      const ids = state.getSelectedIds().length ? state.getSelectedIds() : (id ? [id] : []);
      if (e.ctrlKey && e.shiftKey && e.altKey && e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (item) {
          const cx = item.x + (item.width || 0) / 2, cy = item.y + (item.height || 0) / 2;
          const candidates = state.getNonConnectorItems().filter(i => i.id !== id).map(i => ({ i, dx: i.x + (i.width || 0) / 2 - cx, dy: i.y + (i.height || 0) / 2 - cy }))
            .filter(c => e.key === 'ArrowRight' ? c.dx > 0 : e.key === 'ArrowLeft' ? c.dx < 0 : e.key === 'ArrowDown' ? c.dy > 0 : c.dy < 0)
            .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
          if (candidates[0]) canvas.focusItem(candidates[0].i.id);
        }
        return;
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowDown' && item?.groupId && state.getSelectedIds().length > 1 && canvas.enterGroup(id)) return;
        const target = e.key === 'ArrowDown' ? state.getChildrenOf(id)[0]?.id : item?.parent;
        if (target) canvas.focusItem(target);
        return;
      }
      if (e.ctrlKey && !e.altKey && key === 'd' && !e.shiftKey) { e.preventDefault(); duplicate(ids); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'g') { e.preventDefault(); if (e.shiftKey) state.ungroupItems(ids); else state.groupItems(ids); return; }
      if (e.ctrlKey && e.shiftKey && !e.altKey && key === 'l') { e.preventDefault(); state.toggleLockedMany(ids); return; }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.altKey && e.shiftKey && (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(e.code) || ['+', '=', '-', '_'].includes(e.key))) {
        e.preventDefault();
        state.resizeItems(ids, ['Equal', 'NumpadAdd'].includes(e.code) || ['+', '='].includes(e.key) ? 1.1 : 1 / 1.1);
        return;
      }
      if (ctrl && !e.shiftKey && !e.altKey && key === 'a') { e.preventDefault(); state.selectAll(); return; }
      if (ctrl && e.altKey && !e.shiftKey && key === 'c') { e.preventDefault(); clipboard.copyStyle(); return; }
      if (ctrl && e.altKey && !e.shiftKey && key === 'v') { e.preventDefault(); clipboard.pasteStyle(ids); return; }
      if (ctrl && !e.altKey && !e.shiftKey && key === 'c') { e.preventDefault(); clipboard.copy(ids); return; }
      if (ctrl && !e.altKey && !e.shiftKey && key === 'x') { e.preventDefault(); clipboard.cut(ids); return; }
      if (ctrl && !e.altKey && !e.shiftKey && key === 'v') { e.preventDefault(); clipboard.paste(); return; }
      if (ctrl && !e.altKey && e.key === 'Backspace') { e.preventDefault(); clipboard.clearContent(ids); return; }
      if (e.altKey && !ctrl && e.key === 'F10') { e.preventDefault(); contextToolbar.focus(); return; }
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (['PageUp', 'PageDown'].includes(e.key)) { e.preventDefault(); state.reorderItems(ids, e.key === 'PageUp'); return; }
        if (e.shiftKey && key === 'c') { e.preventDefault(); commentsPanel.toggle(); return; }
        if (TOOL_KEYS[key] && !e.shiftKey) { e.preventDefault(); activateTool(TOOL_KEYS[key], true); return; }
        if (e.key === 'Escape') {
          if (canvas.cancelTool()) { e.preventDefault(); return; }
          if (state.getSelectedIds().length) { e.preventDefault(); state.setSelection([], true); canvas.getSvgElement().focus({ preventScroll: true }); return; }
        }
        const onControl = e.target.closest('button, a, [role="menuitem"]');
        if (e.key === 'Enter' && !onControl && canvas.isCreationTool()) { e.preventDefault(); createAtCenter(canvas.getTool()); return; }
        if (['Delete', 'Backspace'].includes(e.key) && !onControl && state.getSelectedIds().length) { e.preventDefault(); state.removeItems(state.getSelectedIds()); return; }
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); state.undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' && e.shiftKey || e.key === 'Z')) { e.preventDefault(); state.redo(); }
    else if (e.key === '?' || (e.shiftKey && e.key === '?')) { e.preventDefault(); document.getElementById('dialog-help').showModal(); }
    else if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); canvas.zoomIn(); }
    else if (e.key === '-' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); canvas.zoomOut(); }
    else if (e.key === '0' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); canvas.zoomReset(); }
    else if (e.code === 'Digit1' && e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); canvas.zoomToFit(); }

  });
}

function openEditDialog(id) {
  const item = state.getItem(id);
  if (!item || item.type === 'comment' || state.isLocked(id)) return;
  editingId = id;
  if (item.type === 'connector') { openLinkDialogForEdit(item); return; }
  const dialog = document.getElementById('dialog-item');
  const form = dialog.querySelector('form');
  form.reset();
  const titles = { sticky_note: 'Éditer le post-it', shape: 'Éditer la forme', text: 'Éditer le texte', card: 'Éditer la carte', frame: 'Éditer le cadre', drawing: 'Éditer le dessin', mindmap: 'Éditer le nœud', kanban: 'Éditer le kanban', datatable: 'Éditer le tableau de données', code: 'Éditer le bloc de code', flipcard: 'Éditer la carte recto-verso' };
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
  if (type === 'sticky_note') data.color = fd.get('item-color') || 'light_yellow';
  if (type === 'shape') data.shape = fd.get('item-shape') || 'rectangle';
  if (type === 'card') data.title = fd.get('item-title') || '';
  if (type === 'text') { delete data.width; delete data.height; }
  if (type === 'sticky_note') data.size = state.sizeFromWidth(data.width);
  const parent = fd.get('item-parent');
  data.parent = parent && type !== 'frame' ? parent : null;
  if (editingId && state.updateItem(editingId, data)) announcer.announce(`${state.TYPES[type]} modifié`);
  editingId = null;
  dialog.close();
}

const FREE_END = '__libre__';

function setupLinkDialog() {
  const dialog = document.getElementById('dialog-link');
  const fill = (name, entries, value) => {
    const select = dialog.querySelector(`[name="${name}"]`);
    for (const [v, label] of entries) select.add(new Option(label, v, v === value, v === value));
  };
  fill('link-start-cap', Object.entries(L.CAPS), 'none');
  fill('link-end-cap', Object.entries(L.CAPS), 'arrow_filled');
  fill('link-type', Object.entries(L.LINE_TYPES), 'straight');
  fill('link-style', Object.entries(L.LINE_STYLES), 'solid');
  fill('link-width', L.LINE_WIDTHS.map(w => [String(w), `${w} px`]), '2');
  fill('link-color', L.LINE_COLORS.map(c => [c[0], c[1]]), 'auto');
  for (const end of ['start', 'end']) dialog.querySelector(`[name="link-${end}"]`).addEventListener('change', syncLinkFree);
  dialog.querySelector('.waypoint-add').addEventListener('click', () => {
    addWaypointRow(canvas.getViewCenter());
    dialog.querySelector('.waypoints-list li:last-child input').focus();
  });
}

function syncLinkFree() {
  const dialog = document.getElementById('dialog-link');
  for (const end of ['start', 'end']) {
    dialog.querySelector(`[data-free="${end}"]`).hidden = dialog.querySelector(`[name="link-${end}"]`).value !== FREE_END;
  }
}

function addWaypointRow(point) {
  const list = document.querySelector('#dialog-link .waypoints-list');
  const li = document.createElement('li');
  const field = (name, value) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', value, step: 10 });
    input.dataset.axis = name;
    label.append(`${name} `, input);
    return label;
  };
  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = 'Supprimer';
  del.addEventListener('click', () => {
    const next = li.nextElementSibling || li.previousElementSibling;
    li.remove();
    relabelWaypoints();
    (next?.querySelector('button') || document.querySelector('#dialog-link .waypoint-add')).focus();
    announcer.announce('Point de pliage retiré');
  });
  li.append(field('X', point.x), field('Y', point.y), del);
  list.append(li);
  relabelWaypoints();
}

function relabelWaypoints() {
  document.querySelectorAll('#dialog-link .waypoints-list li').forEach((li, i) => {
    li.querySelector('button').setAttribute('aria-label', `Supprimer le point de pliage ${i + 1}`);
    li.querySelectorAll('input').forEach(input => input.setAttribute('aria-label', `${input.dataset.axis} du point de pliage ${i + 1}`));
  });
}

function setLinkError(message) {
  const error = document.querySelector('#dialog-link .dialog-error');
  error.textContent = message;
  error.hidden = !message;
}

function openLinkDialog() {
  editingId = null;
  const dialog = document.getElementById('dialog-link');
  dialog.querySelector('form').reset();
  dialog.querySelector('.dialog-title').textContent = 'Nouvelle ligne';
  dialog.querySelector('.dialog-submit').textContent = 'Créer';
  dialog.querySelector('.dialog-delete').hidden = true;
  dialog.querySelector('.waypoints-list').replaceChildren();
  setLinkError('');
  populateLinkSelects();
  syncLinkFree();
  dialog.showModal();
}

function openLinkDialogForEdit(item) {
  editingId = item.id;
  const dialog = document.getElementById('dialog-link');
  const form = dialog.querySelector('form');
  form.reset();
  dialog.querySelector('.dialog-title').textContent = 'Éditer la ligne';
  dialog.querySelector('.dialog-submit').textContent = 'Enregistrer';
  dialog.querySelector('.dialog-delete').hidden = false;
  setLinkError('');
  populateLinkSelects();
  const value = (name, v) => { form.querySelector(`[name="${name}"]`).value = v; };
  for (const end of ['start', 'end']) {
    value(`link-${end}`, item[`${end}Id`] || FREE_END);
    const at = L.anchorOf(item, end, state.getItem) || { x: 0, y: 0 };
    value(`link-${end}-x`, at.x);
    value(`link-${end}-y`, at.y);
  }
  value('link-label', item.label || '');
  value('link-type', item.lineType);
  value('link-start-cap', item.startCap);
  value('link-end-cap', item.endCap);
  value('link-style', item.lineStyle);
  value('link-width', String(item.strokeWidth));
  value('link-color', item.stroke);
  dialog.querySelector('.waypoints-list').replaceChildren();
  (item.waypoints || []).forEach(addWaypointRow);
  syncLinkFree();
  dialog.showModal();
}

function populateLinkSelects() {
  const items = state.getNonConnectorItems();
  document.querySelectorAll('#dialog-link [name="link-start"], #dialog-link [name="link-end"]').forEach(sel => {
    sel.replaceChildren(new Option('-- Choisir --', ''), new Option('Point libre', FREE_END));
    for (const item of items) sel.add(new Option(state.getItemLabel(item), item.id));
  });
}

function submitLinkForm() {
  const dialog = document.getElementById('dialog-link');
  const fd = new FormData(dialog.querySelector('form'));
  const startId = fd.get('link-start'), endId = fd.get('link-end');
  if (!startId || !endId || (startId === endId && startId !== FREE_END)) {
    const message = 'Choisissez deux objets différents ou des points libres.';
    setLinkError(message);
    announcer.announce(message);
    return;
  }
  const number = name => Number(fd.get(name)) || 0;
  const target = (value, end) => (value === FREE_END ? { x: number(`link-${end}-x`), y: number(`link-${end}-y`) } : { id: value });
  const waypoints = [...dialog.querySelectorAll('.waypoints-list li')].map(li => ({
    x: Math.round(Number(li.querySelector('[data-axis="X"]').value) || 0),
    y: Math.round(Number(li.querySelector('[data-axis="Y"]').value) || 0)
  }));
  const fields = {
    label: fd.get('link-label') || '', lineType: fd.get('link-type'), startCap: fd.get('link-start-cap'), endCap: fd.get('link-end-cap'),
    lineStyle: fd.get('link-style'), strokeWidth: Number(fd.get('link-width')) || 2, stroke: fd.get('link-color'), waypoints
  };
  let id = editingId;
  if (id) {
    state.mutateItem(id, item => {
      Object.assign(item, fields);
      L.setEnd(item, 'start', target(startId, 'start'));
      L.setEnd(item, 'end', target(endId, 'end'));
    }, 'Ligne modifiée');
  } else {
    const data = { type: 'connector', x: 0, y: 0, ...fields };
    L.setEnd(data, 'start', target(startId, 'start'));
    L.setEnd(data, 'end', target(endId, 'end'));
    const item = state.addItem(data);
    id = item.id;
    announcer.announce(`Créé : ${state.getItemLabel(item)}`);
  }
  editingId = null;
  dialog.close();
  if (state.getItem(id) && currentView === 'canvas') canvas.focusItem(id);
}
