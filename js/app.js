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
import { setBoardLabel } from './ui/icons.js';
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
import * as prefs from './preferences.js';
import * as prefsMenu from './views/preferences-menu.js';
import * as canvasMenu from './views/canvas-menu.js';
import { duplicate } from './views/selection-actions.js';
import * as account from './store/account.js';
import { showNotice, clearNotice, clearAllNotices } from './ui/notice.js';
import * as loginScreen from './views/login-screen.js';
import { openLeaveDialog, openShareDialog } from './views/share-dialog.js';
import * as localImport from './store/local-import.js';

const TOOL_BUTTONS = { 'btn-select': 'select', 'btn-hand': 'hand', 'btn-sticky': 'sticky_note', 'btn-shape': 'shape:rectangle', 'btn-line': 'line', 'btn-text': 'text', 'btn-card': 'card', 'btn-frame': 'frame' };
const TOOL_KEYS = { v: 'select', h: 'hand', n: 'sticky_note', t: 'text', s: 'shape:rectangle', r: 'shape:rectangle', o: 'shape:circle', l: 'line', f: 'frame', p: 'pen', e: 'eraser', c: 'comment' };
const MORE_TOOLS = ['pen', 'eraser', 'comment', 'mindmap', 'kanban', 'datatable', 'code', 'flipcard'];
// Ce qui ne sert qu'à écrire disparaît en lecture seule : zoom, recherche, cadres et exports restent.
const READ_ONLY_HIDDEN = ['btn-sticky', 'btn-shape', 'btn-line', 'btn-text', 'btn-card', 'btn-frame', 'btn-more-tools', 'btn-link', 'board-group-organize', 'board-group-history', 'btn-import'];

let currentView = 'canvas';
let editingId = null;
let currentBoardId = null;
let unsubAutoSave = null;
let boardInitialized = false;
let boardTicket = 0;
let suppressAutoSave = false;
let returnHash = '/';
let closeAccount = null;
// Tant que c'est vrai, aucune route ne rend quoi que ce soit : seul l'écran de connexion est dans la page.
let locked = true;
let lockNotice = null;
let importAsked = false;

document.addEventListener('DOMContentLoaded', () => {
  announcer.init();
  boards.init();
  prefs.load();
  prefsMenu.init();

  dashboard.init(document.getElementById('app-dashboard'));

  setupDashboardDialogs();

  boards.onSaveFailure(onLocalSaveFailure);
  account.subscribe(onAccountChange);
  account.onEvent(onAccountEvent);
  router.subscribe(onRouteChange);
  router.init();
  // GET /api/me décide de tout : le contenu n'est rendu qu'une fois la session confirmée.
  account.start();
});

function onAccountChange() {
  const status = account.getStatus();
  if (status === 'loading') return;
  if (status === 'signed-in' || status === 'offline') {
    if (locked) unlock();
    applyBoardAccess();
    dashboard.refresh();
    promptImport();
    return;
  }
  lock(status);
}

function lockView(status) {
  if (status === 'unreachable') {
    return { notice: 'Serveur injoignable : la connexion n’est pas possible pour le moment et aucune copie de vos tableaux n’est enregistrée sur cet appareil. Vérifiez votre connexion, puis réessayez.', retry: () => account.start() };
  }
  return { notice: lockNotice };
}

/* Ferme tout ce qui montrait du contenu, puis affiche la connexion. L'adresse demandée reste dans le hash. */
function lock(status) {
  const view = lockView(status);
  const gate = document.getElementById('app-gate');
  if (locked && loginScreen.isShown()) {
    loginScreen.update(view);
    return;
  }
  const wasOpen = !locked;
  locked = true;
  boardTicket++;
  importAsked = false;
  if (wasOpen) tearDown();
  document.title = 'Connexion — Tableau blanc accessible';
  loginScreen.show(gate, view);
  // Un message est une alerte qui reçoit le focus : il se lit tout seul. Sinon, dire où l'on est.
  if (!view.notice) announcer.announce('Connexion requise');
}

function tearDown() {
  closeOpenBoard();
  closeAccount?.();
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  clearAllNotices();
  clipboard.reset();
  if (boardInitialized) {
    navigation.reset();
    editor.commit(false);
    editor.commitField(false);
    toolsPanel.close(false);
    commentsPanel.close(false);
    state.setReadOnly(false);
    suppressAutoSave = true;
    try { state.loadBoard({ name: 'Tableau', items: [] }); }
    finally { suppressAutoSave = false; }
    document.getElementById('board-title').textContent = 'Tableau';
  }
  document.getElementById('app-board').hidden = true;
  document.querySelector('.board-main')?.removeAttribute('id');
  dashboard.clear();
}

function unlock() {
  locked = false;
  lockNotice = null;
  loginScreen.hide(document.getElementById('app-gate'));
  if (account.getStatus() === 'offline') showServerNotice();
  onRouteChange(router.getRoute(), null);
}

/* Une seule fois par session : ensuite, le dialogue reste accessible depuis « Mon compte ». */
async function promptImport() {
  if (importAsked || account.getStatus() !== 'signed-in') return;
  const userId = account.getUser()?.id;
  if (!userId) return;
  importAsked = true;
  if (!localImport.shouldPrompt(userId)) return;
  const { openImportDialog } = await import('./views/import-dialog.js');
  // Après le rendu de la route, pour que le focus revienne au bon endroit à la fermeture.
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!locked && !document.querySelector('dialog[open]')) openImportDialog(); }));
}

function showServerNotice() {
  notify('server', 'Serveur injoignable : la copie de vos tableaux sur cet appareil reste utilisable. Vos modifications sont gardées ici et seront envoyées au retour de la connexion.', { actions: [{ label: 'Réessayer', run: () => account.start() }] });
}

function onLocalSaveFailure(error) {
  if (!error) { clearNotice('local-save'); return; }
  const message = 'Enregistrement impossible : le stockage de cet appareil est plein. Libérez de la place pour ne rien perdre.';
  showNotice('local-save', message, { tone: 'error' });
  announcer.announce(message);
}

function notify(key, message, options) {
  showNotice(key, message, options);
  announcer.announce(message);
}

function onAccountEvent(event) {
  const { type, entry } = event;
  if (type === 'offline') {
    if (!locked) showServerNotice();
  } else if (type === 'online') {
    clearNotice('server');
    announcer.announce('Connexion au serveur rétablie');
  } else if (type === 'expired') {
    // L'état affiché part à la fermeture : ce qui était en cours de saisie doit d'abord rejoindre le miroir.
    flushEditing();
    lockNotice = event.otherTab
      ? 'Cette session a pris fin dans un autre onglet. Reconnectez-vous : vos modifications non envoyées restent sur cet appareil.'
      : 'Votre session a expiré. Reconnectez-vous : vos modifications non envoyées restent sur cet appareil.';
  } else if (type === 'signed-out') {
    returnHash = '/';
    lockNotice = null;
  } else if (type === 'mirror-full') {
    if (entry.sortants) notify(`save-${entry.id}`, `« ${entry.nom} » ne tient pas sur cet appareil et vos dernières modifications ne sont pas encore sur le serveur. Gardez cet onglet ouvert jusqu’à leur envoi.`, { tone: 'error' });
    else notify(`mirror-${entry.id}`, `« ${entry.nom} » ne tient pas dans la copie de cet appareil : pas d’accès hors ligne pour ce tableau. Il reste enregistré sur votre compte.`);
  } else if (type === 'rejected') {
    notify(`save-${entry.id}`, `« ${entry.nom} » n’a pas pu être enregistré : ${event.error.message} Vos modifications restent sur cet appareil.`, { tone: 'error' });
  } else if (type === 'retrying') {
    notify(`save-${entry.id}`, `« ${entry.nom} » n’a pas pu être enregistré : ${event.error.message} Nouvel essai automatique, vos modifications restent sur cet appareil.`, { tone: 'error' });
  } else if (type === 'sent') {
    clearNotice(`save-${entry.id}`);
  } else if (type === 'copy-failed') {
    notify('copy-failed', 'Des modifications non envoyées d’un autre compte n’ont pas pu être mises de côté : le stockage de cet appareil est plein. Elles restent gardées ; libérez de la place, puis rechargez la page.', { tone: 'error' });
  } else if (type === 'owner-changed') {
    if (currentBoardId === event.id) {
      closeOpenBoard();
      router.navigate('/');
    }
    notify('session', 'Un autre compte est maintenant connecté sur cet appareil : le tableau ouvert a été fermé.');
  } else if (type === 'conflict-flush') {
    // Un texte en cours de saisie doit partir dans la copie, pas disparaître au rechargement.
    if (currentBoardId === entry.id) flushEditing();
  } else if (type === 'role-lost') {
    onAccessLost(entry, `Vous ne pouvez plus modifier « ${entry.nom} » : il est passé en lecture seule.`);
  } else if (type === 'lost') {
    onAccessLost(entry, `Vous n’avez plus accès à « ${entry.nom} ».`);
  } else if (type === 'conflict') {
    onConflict(event);
  }
}

function onConflict({ entry, copy }) {
  const isOpen = currentBoardId === entry.id;
  const message = `« ${entry.nom} » a été modifié ailleurs. Vos modifications sont gardées dans la copie « ${copy.nom} ».`;
  showNotice(`board-${entry.id}`, message, { tone: 'error', actions: [{ label: 'Ouvrir la copie', run: () => router.navigate(`/tableau/${copy.id}`) }] });
  announcer.announce(isOpen ? `${message} La version du serveur est affichée.` : message);
  if (isOpen) reloadOpenBoard(entry);
  else dashboard.refresh();
}

/* Remplace le contenu affiché sans le compter comme une modification à envoyer. */
function reloadOpenBoard(entry) {
  const remote = boards.remoteStore();
  suppressAutoSave = true;
  try { state.loadBoard(JSON.parse(JSON.stringify(entry.données))); }
  finally { suppressAutoSave = false; }
  remote.setBaseline(entry.id, state.getSnapshot());
  setBoardLabel(document.getElementById('board-title'), entry);
  const active = document.activeElement;
  if (!active || active === document.body) document.getElementById('board-title').focus();
}

/*
 * Droit d'écrire ou accès retiré : plus aucune modification possible, et le travail non envoyé part dans une copie
 * sur le compte, comme pour un conflit. Sans travail à sauver, la copie reste un choix.
 */
async function onAccessLost(entry, reason) {
  const isOpen = currentBoardId === entry.id;
  if (isOpen) flushEditing();
  applyBoardAccess();
  if (!entry.sortants || !entry.données) {
    const actions = entry.perdu ? [{ label: 'Garder une copie', run: () => keepLostCopy(entry.id) }] : [];
    notify(`board-${entry.id}`, reason, { tone: 'error', actions });
    return;
  }
  try {
    const copy = await boards.remoteStore().keepCopy(entry.id);
    notify(`board-${entry.id}`, `${reason} Vos modifications sont gardées dans la copie « ${copy.nom} ».`, { tone: 'error', actions: [{ label: 'Ouvrir la copie', run: () => router.navigate(`/tableau/${copy.id}`) }] });
    dashboard.refresh();
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
    notify(`board-${entry.id}`, `${reason} ${err.message} Vos modifications restent sur cet appareil.`, { tone: 'error', actions: [{ label: 'Garder une copie', run: () => keepLostCopy(entry.id) }] });
  }
}

async function keepLostCopy(id) {
  try {
    const copy = await boards.remoteStore().keepCopy(id);
    announcer.announce(`Copie créée : ${copy.nom}`);
    router.navigate(`/tableau/${copy.id}`);
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
    notify('board-action', err.message, { tone: 'error' });
  }
}

/* Lecture seule et actions du tableau ouvert : suit le rôle, qui peut changer pendant qu'il est ouvert. */
function applyBoardAccess() {
  if (!currentBoardId || !boardInitialized) return;
  const entry = boards.get(currentBoardId);
  if (!entry) return;
  const readOnly = entry.role === 'viewer' || !!entry.perdu;
  const changedMode = readOnly !== state.isReadOnly();
  if (changedMode && readOnly) flushEditing();
  state.setReadOnly(readOnly);
  document.getElementById('board-readonly').hidden = !readOnly;
  for (const id of READ_ONLY_HIDDEN) document.getElementById(id).hidden = readOnly;
  document.getElementById('btn-share').hidden = entry.role !== 'owner' || !!entry.perdu;
  document.getElementById('btn-leave').hidden = entry.role === 'owner' || !!entry.perdu;
  boardActions.syncTitle();
  if (!changedMode) return;
  if (readOnly) canvas.setTool('select');
  state.touch();
}

async function showAccount(route, oldRoute) {
  if (oldRoute && oldRoute.view !== 'compte') returnHash = oldRoute.view === 'tableau' ? `/tableau/${oldRoute.boardId}` : oldRoute.view === 'espace' ? `/espace/${oldRoute.spaceId}` : oldRoute.view === 'accueil' ? '/' : `/${oldRoute.view}`;
  if (!oldRoute || oldRoute.view === 'tableau' || !document.getElementById('dashboard-title')) showDashboard(route);
  document.title = 'Mon compte — Tableau blanc accessible';
  const { openAccountDialog } = await import('./views/account-dialog.js');
  if (router.getRoute().view !== 'compte' || closeAccount) return;
  const el = openAccountDialog({
    onClose() {
      closeAccount = null;
      if (router.getRoute().view === 'compte') router.navigate(returnHash);
    }
  });
  closeAccount = () => { if (el.open) el.close(); };
}

function onRouteChange(route, oldRoute) {
  if (locked) return;
  if (oldRoute && route.view === oldRoute.view && route.boardId === oldRoute.boardId && route.spaceId === oldRoute.spaceId) return;
  if (route.view !== 'compte') closeAccount?.();
  if (route.view === 'compte') {
    showAccount(route, oldRoute).catch(err => console.error(err));
  } else if (route.view === 'tableau' && route.boardId) {
    showBoard(route.boardId).catch(err => console.error(err));
  } else if (oldRoute?.view === 'compte') {
    showDashboard(route, true);
  } else {
    showDashboard(route);
  }
}

function flushEditing() {
  if (!boardInitialized) return;
  editor.commit(false);
  editor.commitField(false);
}

/* Quitte le tableau ouvert. Un tableau du compte part aussitôt vers le serveur, sans attendre le délai. */
function closeOpenBoard() {
  flushEditing();
  if (unsubAutoSave) { unsubAutoSave(); unsubAutoSave = null; }
  const remote = boards.remoteStore();
  if (currentBoardId && remote?.has(currentBoardId)) {
    remote.leave(currentBoardId);
    remote.flush(currentBoardId).catch(err => console.error(err));
  }
  currentBoardId = null;
}

function showDashboard(route, fromAccount = false) {
  boardTicket++;
  closeOpenBoard();
  if (boardInitialized) navigation.reset();

  document.getElementById('app-board').hidden = true;
  const el = document.querySelector('.board-main');
  if (el) el.removeAttribute('id');

  const dashEl = document.getElementById('app-dashboard');
  dashEl.hidden = false;
  dashboard.render(route);
  if (account.isConnected()) account.refreshBoards();

  const titles = {
    accueil: 'Tableau blanc accessible',
    favoris: 'Favoris — Tableau blanc accessible',
    parcourir: 'Parcourir — Tableau blanc accessible',
    compte: 'Mon compte — Tableau blanc accessible'
  };
  document.title = titles[route.view] || 'Tableau blanc accessible';

  requestAnimationFrame(() => {
    const target = document.getElementById(fromAccount ? 'btn-account' : 'dashboard-title');
    if (target && !document.querySelector('dialog[open]')) target.focus();
  });
  if (fromAccount || route.view === 'compte') return;

  const labels = { accueil: 'Accueil', favoris: 'Tableaux favoris', parcourir: 'Tous les tableaux' };
  announcer.announce(labels[route.view] || 'Accueil');
}

/*
 * Un tableau attend son état distant : le ticket écarte une réponse arrivée après une autre navigation,
 * et sans état valide rien n'est chargé.
 */
async function showBoard(boardId) {
  const ticket = ++boardTicket;

  closeOpenBoard();
  hideBoardView();
  document.title = 'Chargement du tableau — Tableau blanc accessible';
  dashboard.renderLoading('Chargement du tableau…');
  announcer.announce('Chargement du tableau…');

  await account.whenReady();
  if (ticket !== boardTicket) return;
  const remote = boards.remoteStore();
  if (!remote) { showRemoteProblem(boardId, { status: 'expired' }); return; }
  const result = await remote.open(boardId);
  if (ticket !== boardTicket) return;
  if (result.status !== 'ok') { showRemoteProblem(boardId, result); return; }

  displayBoard(result.entry);
  if (result.offline) {
    const reason = result.error?.status ? result.error.message : 'Serveur injoignable.';
    notify('server', `${reason} Voici la copie de cet appareil. Vos modifications sont gardées ici et seront envoyées au retour de la connexion.`, { actions: [{ label: 'Réessayer', run: () => account.start() }] });
  }
}

function hideBoardView() {
  document.getElementById('app-board').hidden = true;
  document.querySelector('.board-main')?.removeAttribute('id');
  document.getElementById('app-dashboard').hidden = false;
}

function showRemoteProblem(boardId, result) {
  if (locked) return;
  hideBoardView();
  const retry = { label: 'Réessayer', run: () => showBoard(boardId).catch(err => console.error(err)) };
  let view;
  if (result.status === 'lost') {
    view = { title: 'Tableau inaccessible', message: 'Ce tableau n’existe plus ou vous n’y avez plus accès.', actions: result.entry ? [{ label: 'Garder une copie', run: () => keepLostCopy(boardId) }] : [] };
  } else {
    view = { title: 'Tableau indisponible', message: `Ce tableau n’a pas pu être chargé. ${result.error?.message || ''} Rien n’a été modifié.`.trim(), actions: [retry] };
  }
  document.title = `${view.title} — Tableau blanc accessible`;
  dashboard.renderProblem(view);
  announcer.announce(`${view.title}. ${view.message}`);
}

function displayBoard(board) {
  const boardId = board.id;
  closeOpenBoard();
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
  // Avant le chargement : les vues se rendent aussitôt, sans les actions d'écriture si besoin.
  state.setReadOnly(false);
  applyBoardAccess();
  canvas.setTool('select');
  // Une copie : l'entrée du miroir ne doit changer que par edit(), jamais par mutation directe de l'état.
  state.loadBoard(JSON.parse(JSON.stringify(board.données)));
  boards.remoteStore().setBaseline(boardId, state.getSnapshot());

  // En lecture seule, rien ne part : retourner une carte ou replier une branche n'est pas une modification.
  unsubAutoSave = state.subscribe(() => {
    if (currentBoardId && !suppressAutoSave && !state.isReadOnly()) boards.saveData(currentBoardId, state.getSnapshot());
  });

  setBoardLabel(document.getElementById('board-title'), board);
  requestAnimationFrame(() => canvas.zoomToFit());
  document.title = `${board.nom} — Tableau blanc accessible`;

  requestAnimationFrame(() => {
    const h1 = document.getElementById('board-title');
    if (h1) h1.focus();
  });
  announcer.announce(state.isReadOnly() ? `Tableau ouvert en lecture seule : ${board.nom}` : `Tableau ouvert : ${board.nom}`);
}

function initBoardView() {
  canvas.init(document.getElementById('view-canvas'));
  editor.init();
  contextToolbar.init(document.getElementById('view-canvas'), { onProperties: openEditDialog, onNewTag: openTagDialog, onOpenComment: id => commentsPanel.open(id, true) });
  const appBoard = document.getElementById('app-board');
  toolsPanel.init(appBoard, document.getElementById('btn-more-tools'), chooseTool);
  commentsPanel.init(appBoard, document.getElementById('btn-comments'), gotoItem);
  canvasMenu.init({ onProperties: openEditDialog });
  outline.init(document.getElementById('view-outline'));
  table.init(document.getElementById('view-table'));
  boardActions.init(() => currentBoardId);
  setupTabs();
  setupToolbar();
  setupDialogs();
  navigation.init(showCanvasTab);
  prefsMenu.mount(document.getElementById('board-prefs'), true);
  setupDragSources();
  const boardMenu = document.getElementById('btn-board-menu');
  boardMenu.addEventListener('click', () => {
    const open = boardMenu.getAttribute('aria-expanded') !== 'true';
    boardMenu.setAttribute('aria-expanded', String(open));
    document.getElementById('board-tools').classList.toggle('is-open', open);
  });
  setupShortcuts();
  const current = () => boards.get(currentBoardId);
  document.getElementById('btn-share').addEventListener('click', () => { if (current()) openShareDialog(current()); });
  document.getElementById('btn-leave').addEventListener('click', () => { if (current()) openLeaveDialog(current(), () => router.navigate('/')); });
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
  document.getElementById('btn-import').addEventListener('click', () => {
    if (refuseRemoteImport()) return;
    document.getElementById('file-import').click();
  });
  document.getElementById('file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && refuseRemoteImport()) { e.target.value = ''; return; }
    if (file) { try { await io.importJSON(file); } catch (err) { console.error(err); } }
    e.target.value = '';
  });
  document.getElementById('btn-help').addEventListener('click', () => document.getElementById('dialog-help').showModal());
  state.subscribe(() => {
    document.getElementById('btn-undo').disabled = !state.canUndo();
    document.getElementById('btn-redo').disabled = !state.canRedo();
  });
}

/* Importer remplacerait la version du serveur, sans confirmation possible et sans historique à restaurer. */
function refuseRemoteImport() {
  notify('board-action', 'Import refusé : ce tableau est enregistré sur votre compte et serait remplacé. Importez le fichier dans un nouveau tableau, depuis l’accueil.', { tone: 'error' });
  return true;
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
    if (locked) return;
    if (e.target.closest('dialog[open]') || e.target.closest('input, textarea, select, [contenteditable], .comments-panel, .tools-panel, .frames-panel, .board-search')) return;
    const boardVisible = !document.getElementById('app-board').hidden;
    if (!boardVisible) return;
    const singleKey = prefs.getPref('singleKey');
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
      if (e.altKey && !ctrl && !e.shiftKey && e.code === 'Digit1') { e.preventDefault(); canvas.zoomToFit(); return; }
      if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && !ctrl && !e.altKey && (e.target === document.body || e.target.closest('.canvas-svg, .context-toolbar'))) { e.preventDefault(); canvasMenu.openFromKeyboard(); return; }
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (['PageUp', 'PageDown'].includes(e.key)) { e.preventDefault(); state.reorderItems(ids, e.key === 'PageUp'); return; }
        if (singleKey && e.shiftKey && key === 'c') { e.preventDefault(); commentsPanel.toggle(); return; }
        if (singleKey && !e.shiftKey && key === 'g') { e.preventDefault(); prefsMenu.togglePref('grid'); return; }
        if (singleKey && TOOL_KEYS[key] && !e.shiftKey) { e.preventDefault(); activateTool(TOOL_KEYS[key], true); return; }
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
    else if (!singleKey) return;
    else if (e.key === '?' || (e.shiftKey && e.key === '?')) { e.preventDefault(); openHelp(); }
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

function openHelp() {
  document.getElementById('dialog-help').showModal();
  document.getElementById('dialog-help-title').focus();
}
