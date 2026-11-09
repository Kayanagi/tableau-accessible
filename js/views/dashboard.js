import { ask, dialog } from '../ui/dialog.js';
import { openLibrary } from './template-library.js';
import * as boards from '../store/boards.js';
import { iconSvg, setBoardLabel } from '../ui/icons.js';
import { TEMPLATES, getTemplate } from '../store/templates.js';
import * as router from '../router.js';
import { announce } from '../a11y/announcer.js';
import * as prefsMenu from './preferences-menu.js';
import { getPref } from '../preferences.js';
import * as account from '../store/account.js';
import { showNotice } from '../ui/notice.js';
import { openLeaveDialog, openShareDialog, ROLE_LABELS } from './share-dialog.js';

let navExpanded = !matchMedia('(max-width: 640px)').matches;
let container = null;
let searchQuery = '';
let sortCol = 'dernièreOuverture';
let sortAsc = false;
let gridView = false;
let lastSection = null;
let lastRoute = null;
let lastSignature = '';
let lastMain = null;
let creating = false;

export function init(el) {
  container = el;
}

export function render(route) {
  if (!container) return;
  if (route.view === 'compte') route = { ...route, view: 'accueil' };
  container.innerHTML = '';
  container.hidden = false;

  const header = document.createElement('header');
  header.setAttribute('role', 'banner');
  header.classList.add('dashboard-header');

  const h1 = document.createElement('h1');
  h1.id = 'dashboard-title';
  h1.setAttribute('tabindex', '-1');
  const titles = {
    accueil: 'Bon retour',
    favoris: 'Tableaux favoris',
    parcourir: 'Tous les tableaux'
  };
  h1.textContent = route.view === 'espace' ? boards.getSpaces().find(s => s.id === route.spaceId)?.nom || 'Espace introuvable' : titles[route.view] || 'Tableau blanc accessible';
  header.appendChild(h1);

  const actions = document.createElement('div');
  actions.classList.add('dashboard-header-actions');

  const createBtn = document.createElement('button');
  createBtn.classList.add('btn-primary');
  createBtn.textContent = 'Créer un tableau';
  createBtn.addEventListener('click', startCreation);
  actions.appendChild(createBtn);

  const importBtn = document.createElement('button');
  importBtn.textContent = 'Importer JSON';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.classList.add('sr-only');
  fileInput.setAttribute('aria-label', 'Choisir un fichier JSON à importer');
  fileInput.setAttribute('tabindex', '-1');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBoardFromFile(file);
    e.target.value = '';
  });
  importBtn.addEventListener('click', () => fileInput.click());
  actions.appendChild(importBtn);
  actions.appendChild(fileInput);

  const accountBtn = document.createElement('button');
  accountBtn.id = 'btn-account';
  accountBtn.textContent = 'Mon compte';
  accountBtn.addEventListener('click', () => router.navigate('/compte'));
  actions.appendChild(accountBtn);

  prefsMenu.mount(actions);

  header.appendChild(actions);
  container.appendChild(header);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Navigation principale');
  nav.classList.add('dashboard-nav');
  nav.id = 'dashboard-navigation';
  nav.hidden = !navExpanded;
  container.classList.toggle('nav-collapsed', !navExpanded);
  const toggle = document.createElement('button');
  toggle.id = 'btn-navigation'; toggle.textContent = 'Menu de navigation';
  toggle.setAttribute('aria-controls', nav.id); toggle.setAttribute('aria-expanded', String(navExpanded));
  toggle.onclick = () => { navExpanded = !navExpanded; nav.hidden = !navExpanded; toggle.setAttribute('aria-expanded', String(navExpanded)); container.classList.toggle('nav-collapsed', !navExpanded); };
  actions.prepend(toggle);
  const navUl = document.createElement('ul');
  navUl.classList.add('nav-list');
  const navItems = [
    { href: '#/', label: 'Accueil', view: 'accueil' },
    { href: '#/favoris', label: 'Favoris', view: 'favoris' },
    { href: '#/parcourir', label: 'Parcourir', view: 'parcourir' }
  ];
  for (const item of navItems) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = item.href;
    a.textContent = item.label;
    a.classList.add('nav-link');
    if (item.view === route.view) a.setAttribute('aria-current', 'page');
    li.appendChild(a);
    navUl.appendChild(li);
  }
  nav.appendChild(navUl);
  const spacesTitle = document.createElement('h2'); spacesTitle.textContent = 'Espaces'; nav.append(spacesTitle);
  for (const space of boards.getSpaces()) {
    const row = document.createElement('div'); row.className = 'space-row';
    const link = document.createElement('a'); link.href = `#/espace/${space.id}`; link.textContent = space.nom;
    if (route.spaceId === space.id) link.setAttribute('aria-current', 'page');
    const rename = document.createElement('button'); rename.textContent = 'Renommer'; rename.setAttribute('aria-label', `Renommer l’espace ${space.nom}`);
    rename.onclick = () => ask('Renommer l’espace', space.nom, nom => { const ok = boards.renameSpace(space.id, nom); render(router.getRoute()); announce(ok ? 'Espace renommé' : 'Stockage de cet appareil plein : espace non renommé'); });
    const del = document.createElement('button'); del.textContent = 'Supprimer'; del.setAttribute('aria-label', `Supprimer l’espace ${space.nom}`);
    del.onclick = () => ask(`Supprimer l’espace « ${space.nom} » ? Les tableaux seront conservés.`, '', () => { if (!boards.removeSpace(space.id)) { announce('Stockage de cet appareil indisponible : espace non supprimé'); return; } if (route.spaceId === space.id) router.navigate('/'); else render(router.getRoute()); announce('Espace supprimé, tableaux conservés'); }, true);
    row.append(link, rename, del); nav.append(row);
  }
  const add = document.createElement('button'); add.id = 'btn-create-space'; add.textContent = 'Créer un espace';
  add.onclick = () => ask('Créer un espace', '', nom => { const ok = boards.createSpace(nom); render(router.getRoute()); announce(ok ? 'Espace créé' : 'Stockage de cet appareil plein : espace non créé'); });
  nav.append(add);
  container.appendChild(nav);

  const main = document.createElement('main');
  main.id = 'main-content';
  main.setAttribute('tabindex', '-1');
  lastMain = main;
  renderInvites(main);

  if (route.view === 'accueil') {
    const tplSection = document.createElement('section');
    tplSection.setAttribute('aria-labelledby', 'templates-title');
    tplSection.classList.add('templates-section');
    const h2t = document.createElement('h2');
    h2t.id = 'templates-title';
    h2t.textContent = 'Commencer un nouveau tableau';
    tplSection.appendChild(h2t);

    const tplList = document.createElement('ul');
    tplList.classList.add('templates-list');
    tplList.setAttribute('role', 'list');
    for (const tpl of TEMPLATES.slice(0, 5)) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.classList.add('template-btn');
      btn.setAttribute('data-template', tpl.id);
      const icon = document.createElement('span');
      icon.classList.add('template-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = tpl.icone;
      btn.appendChild(icon);
      const label = document.createElement('span');
      label.textContent = tpl.nom;
      btn.appendChild(label);
      btn.addEventListener('click', () => createFromTemplate(tpl.id));
      li.appendChild(btn);
      tplList.appendChild(li);
    }
    tplSection.appendChild(tplList);
    const all = document.createElement('button'); all.id = 'btn-template-library'; all.textContent = 'Tous les modèles'; all.onclick = () => openLibrary(createFromTemplate); tplSection.append(all);
    main.appendChild(tplSection);
  }

  const boardsSection = document.createElement('section');
  boardsSection.setAttribute('aria-labelledby', 'boards-title');
  boardsSection.classList.add('boards-section');
  const h2b = document.createElement('h2');
  h2b.id = 'boards-title';
  const sectionTitles = {
    accueil: 'Tableaux récents',
    favoris: 'Tableaux favoris',
    parcourir: 'Tous les tableaux'
  };
  h2b.textContent = sectionTitles[route.view] || 'Tableaux';
  boardsSection.appendChild(h2b);

  const toolbar = document.createElement('div');
  toolbar.classList.add('boards-toolbar');
  const searchDiv = document.createElement('div');
  searchDiv.classList.add('search-field');
  const searchLabel = document.createElement('label');
  searchLabel.setAttribute('for', 'search-boards');
  searchLabel.classList.add('sr-only');
  searchLabel.textContent = 'Rechercher un tableau';
  searchDiv.appendChild(searchLabel);
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.id = 'search-boards';
  searchInput.placeholder = 'Rechercher par nom…';
  searchInput.autocomplete = 'off';
  searchInput.value = searchQuery;
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    updateBoardsList(boardsSection, route);
  });
  searchDiv.appendChild(searchInput);
  toolbar.appendChild(searchDiv);

  const viewToggle = document.createElement('button');
  viewToggle.id = 'btn-toggle-view';
  viewToggle.setAttribute('aria-pressed', String(gridView));
  viewToggle.setAttribute('aria-label', gridView ? 'Liste : vue en liste' : 'Grille : vue en grille');
  viewToggle.textContent = gridView ? 'Liste' : 'Grille';
  viewToggle.addEventListener('click', () => {
    gridView = !gridView;
    viewToggle.setAttribute('aria-pressed', String(gridView));
    viewToggle.setAttribute('aria-label', gridView ? 'Liste : vue en liste' : 'Grille : vue en grille');
    viewToggle.textContent = gridView ? 'Liste' : 'Grille';
    updateBoardsList(boardsSection, route);
    announce(gridView ? 'Vue en grille' : 'Vue en liste');
  });
  toolbar.appendChild(viewToggle);
  boardsSection.appendChild(toolbar);

  lastSection = boardsSection;
  lastRoute = route;
  main.appendChild(boardsSection);
  updateBoardsList(boardsSection, route);
  container.appendChild(main);

  const footer = document.createElement('footer');
  footer.className = 'dashboard-footer';
  const privacy = document.createElement('a');
  privacy.href = 'confidentialite.html';
  privacy.textContent = 'Confidentialité';
  footer.append(privacy);
  container.appendChild(footer);
}

function signature() {
  const connected = account.isConnected();
  return JSON.stringify([connected, account.getInvites().map(i => [i.id, i.boardName, i.invitedByName, i.role]), boards.getAll().map(b => [b.id, b.nom, b.icon, b.favori, b.espaceId, b.dernièreOuverture, b.role, b.perdu, b.memberCount, b.ownerName, b.données?.items?.length ?? b.nbÉléments])]);
}

/* Fermeture de session : rien de ce qui était affiché ne reste dans la page. */
export function clear() {
  if (container) { container.innerHTML = ''; container.hidden = true; }
  lastSection = lastRoute = lastMain = null;
  lastSignature = '';
  searchQuery = '';
}

/* ---- Invitations reçues : nom du tableau et de l'invitant choisis par un autre compte, en textContent seulement ---- */

const inviteCount = n => `${n} invitation${n > 1 ? 's' : ''} en attente`;

function renderInvites(main) {
  let section = main.querySelector('#invites-section');
  const hadFocus = !!section?.contains(document.activeElement);
  const label = hadFocus ? document.activeElement.getAttribute('aria-label') : null;
  const invites = account.getInvites();
  if (!invites.length) {
    section?.remove();
    if (hadFocus) document.getElementById('dashboard-title')?.focus();
    return;
  }
  // Bandeau qui apparaît en cours d'usage (page déjà affichée) : une zone role="status" insérée déjà remplie n'est pas
  // lue de façon fiable, l'annonceur dit donc le nombre une fois. Au premier rendu, il fait partie de la page.
  const appearing = !section && main.isConnected;
  if (!section) {
    section = document.createElement('section');
    section.id = 'invites-section';
    section.className = 'invites-banner';
    section.setAttribute('aria-labelledby', 'invites-title');
    const h2 = document.createElement('h2');
    h2.id = 'invites-title';
    h2.textContent = 'Invitations';
    const status = document.createElement('p');
    status.id = 'invites-count';
    status.setAttribute('role', 'status');
    // Rempli avant l'insertion : seule l'annonce ci-dessous le lit, pas un changement de la zone.
    status.textContent = inviteCount(invites.length);
    const list = document.createElement('ul');
    list.className = 'invites-list';
    const all = document.createElement('div');
    all.className = 'invite-actions invites-all';
    const declineAll = document.createElement('button');
    declineAll.id = 'btn-decline-all';
    declineAll.className = 'btn-sm';
    declineAll.textContent = 'Tout refuser';
    declineAll.addEventListener('click', () => confirmDeclineAll());
    all.append(declineAll);
    section.append(h2, status, list, all);
    main.prepend(section);
  }
  section.querySelector('#btn-decline-all').setAttribute('aria-label', `Tout refuser : ${inviteCount(invites.length)}`);
  // Le texte ne change que s'il diffère : une zone live réécrite à l'identique peut être relue.
  const count = section.querySelector('#invites-count');
  if (count.textContent !== inviteCount(invites.length)) count.textContent = inviteCount(invites.length);
  if (appearing) announce(inviteCount(invites.length));
  const list = section.querySelector('.invites-list');
  list.replaceChildren();
  for (const invite of invites) {
    const li = document.createElement('li');
    const text = document.createElement('p');
    const name = document.createElement('strong');
    name.textContent = invite.boardName;
    const inviter = invite.invitedByName ? `, par ${invite.invitedByName}` : '';
    text.append(name, ` (${ROLE_LABELS[invite.role]}${inviter})`);
    const actions = document.createElement('div');
    actions.className = 'invite-actions';
    const accept = document.createElement('button');
    accept.className = 'btn-sm btn-primary';
    accept.textContent = 'Accepter';
    accept.setAttribute('aria-label', `Accepter l’invitation : ${invite.boardName}`);
    accept.addEventListener('click', () => answerInvite(invite, true));
    const decline = document.createElement('button');
    decline.className = 'btn-sm';
    decline.textContent = 'Refuser';
    decline.setAttribute('aria-label', `Refuser l’invitation : ${invite.boardName}`);
    decline.addEventListener('click', () => answerInvite(invite, false));
    actions.append(accept, decline);
    li.append(text, actions);
    list.append(li);
  }
  if (hadFocus) ([...section.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label) || section.querySelector('button'))?.focus();
}

/* Résultat lu en role="status" : la zone existe avant que son texte ne change, et survit au retrait du bandeau. */
function inviteResult(main) {
  let p = main.querySelector('#invites-result');
  if (!p) {
    p = document.createElement('p');
    p.id = 'invites-result';
    p.className = 'invites-result';
    p.setAttribute('role', 'status');
    main.prepend(p);
  }
  return p;
}

/* Confirmation explicite avant d'envoyer : les tableaux refusés ne reviennent qu'avec une nouvelle invitation. */
function confirmDeclineAll() {
  const n = account.getInvites().length;
  const main = lastMain;
  const result = inviteResult(main);
  result.textContent = '';
  const el = dialog('Refuser toutes les invitations ?', d => {
    d.classList.add('account-dialog');
    const p = document.createElement('p');
    p.id = 'decline-all-warning';
    // Le focus part sur Annuler : l'avertissement est lu avec le nom du dialogue.
    d.setAttribute('aria-describedby', p.id);
    p.textContent = `${n > 1 ? `Les ${n} invitations en attente seront refusées` : 'L’invitation en attente sera refusée'}. Pour accéder à ces tableaux, il faudra être invité de nouveau.`;
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn-danger';
    yes.textContent = 'Refuser toutes les invitations';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = 'Annuler';
    no.addEventListener('click', () => d.close());
    let busy = false;
    yes.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      d.close();
      try {
        const declined = await account.declineAllInvites();
        if (!main?.isConnected) return;
        renderInvites(main);
        result.textContent = declined > 1 ? `${declined} invitations refusées.` : declined === 1 ? 'Invitation refusée.' : 'Aucune invitation à refuser.';
        document.getElementById('dashboard-title')?.focus();
      } catch (err) {
        if (err.name !== 'ApiError') throw err;
        account.refreshBoards();
        reportError('invites', err);
      }
    });
    actions.append(yes, no);
    d.append(p, actions);
  });
  // Action irréversible : le focus part sur Annuler.
  el.querySelector('.dialog-actions button:last-child').focus();
}

async function answerInvite(invite, yes) {
  try {
    const res = yes ? await account.acceptInvite(invite.id) : await account.declineInvite(invite.id);
    if (!lastMain?.isConnected) return;
    renderInvites(lastMain);
    updateBoardsList(lastSection, lastRoute);
    announce(yes ? `Invitation acceptée : ${invite.boardName}` : `Invitation refusée : ${invite.boardName}`);
    const next = yes ? lastMain.querySelector(`[data-board-id="${CSS.escape(res.boardId)}"] a`) : null;
    (next || lastMain.querySelector('#invites-section button') || document.getElementById('dashboard-title'))?.focus();
  } catch (err) {
    if (err.name !== 'ApiError') throw err;
    // Invitation expirée ou annulée entre-temps : la liste est relue.
    if (err.notFound) account.refreshBoards();
    // Tableau complet (100 membres) : l'invitation reste en attente, la raison est dite telle quelle.
    if (yes && err.code === 'quota_exceeded') err.message = `Invitation non acceptée : ${err.message} L’invitation reste en attente.`;
    reportError('invites', err);
  }
}

/* Après un changement côté compte : met la liste à jour en place, sans perdre le focus ni le titre. */
export function refresh() {
  if (!container || container.hidden || !lastSection?.isConnected) return;
  if (signature() === lastSignature) return;
  const active = document.activeElement;
  const row = lastMain.contains(active) ? active.closest('[data-board-id]') : null;
  const rowId = row?.dataset.boardId;
  const label = active?.getAttribute?.('aria-label') || active?.textContent;
  renderInvites(lastMain);
  updateBoardsList(lastSection, lastRoute);
  if (!rowId) return;
  const next = lastMain.querySelector(`[data-board-id="${CSS.escape(rowId)}"]`);
  if (!next) { document.getElementById('boards-title')?.focus(); return; }
  const same = [...next.querySelectorAll('a, button, select')].find(el => (el.getAttribute('aria-label') || el.textContent) === label);
  (same || next.querySelector('a'))?.focus();
}

function itemCount(board) {
  return board.données?.items?.length ?? board.nbÉléments ?? null;
}

const isShared = board => board.role === 'viewer' || board.role === 'editor';

/* Le rôle en clair ; rien pour un tableau à soi qui n'est partagé avec personne. */
function badgeText(board) {
  if (board.perdu) return 'Accès perdu';
  if (board.role === 'viewer') return 'Lecture seule';
  if (board.role === 'editor') return 'Peut modifier';
  return board.memberCount > 1 ? 'Partagé' : null;
}

function addBadge(el, board) {
  const text = badgeText(board);
  if (!text) return;
  const badge = document.createElement('span');
  badge.className = `board-badge board-badge-${board.perdu ? 'lost' : board.role}`;
  badge.textContent = text;
  el.appendChild(badge);
  if (isShared(board) && board.ownerName) {
    const owner = document.createElement('span');
    owner.className = 'board-owner';
    owner.textContent = `De ${board.ownerName}`;
    el.appendChild(owner);
  }
}

function reportError(key, err) {
  if (err.name !== 'ApiError') throw err;
  showNotice(key, err.message, { tone: 'error' });
  announce(err.message);
}

/* Section « Partagés avec moi », juste après celle des tableaux. Elle n'existe que si elle a quelque chose à montrer. */
function renderSharedSection(section, list, route) {
  const main = section.parentElement || lastMain;
  main?.querySelector('#shared-section')?.remove();
  if (!list.length) return;
  const shared = document.createElement('section');
  shared.id = 'shared-section';
  shared.className = 'boards-section';
  shared.setAttribute('aria-labelledby', 'shared-title');
  const h2 = document.createElement('h2');
  h2.id = 'shared-title';
  h2.textContent = 'Partagés avec moi';
  shared.append(h2);
  if (gridView) renderGrid(shared, list);
  else renderTable(shared, list, route);
  section.after(shared);
}

function updateBoardsList(section, route) {
  lastSignature = signature();
  section.querySelectorAll('.boards-table, .boards-grid, .boards-empty, .search-status').forEach(el => el.remove());

  let allBoards = route.view === 'favoris' ? boards.getFavoris() : boards.getAll();
  if (route.view === 'espace') allBoards = allBoards.filter(b => b.espaceId === route.spaceId);
  let filtered = allBoards;
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = allBoards.filter(b => b.nom.toLowerCase().includes(q));
    const status = document.createElement('p');
    status.classList.add('search-status');
    status.setAttribute('role', 'status');
    status.textContent = `${filtered.length} résultat(s) pour « ${searchQuery} »`;
    section.appendChild(status);
    announce(`${filtered.length} résultat(s)`);
  }

  const sorted = [...filtered].sort((a, b) => {
    let va, vb;
    switch (sortCol) {
      case 'nom':
        va = a.nom.toLowerCase(); vb = b.nom.toLowerCase(); break;
      case 'dernièreOuverture':
        va = a.dernièreOuverture || ''; vb = b.dernièreOuverture || ''; break;
      case 'éléments':
        va = itemCount(a) || 0; vb = itemCount(b) || 0; break;
      default: va = ''; vb = '';
    }
    if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  // Favoris et espaces mélangent tout ce qu'on a choisi d'y mettre ; ailleurs, ce qui est à moi et ce qu'on m'a partagé se distinguent.
  const splitShared = route.view === 'accueil' || route.view === 'parcourir';
  const mine = splitShared ? sorted.filter(b => !isShared(b)) : sorted;
  const shared = splitShared ? sorted.filter(isShared) : [];
  renderSharedSection(section, shared, route);

  if (mine.length === 0) {
    const empty = document.createElement('p');
    empty.classList.add('boards-empty');
    if (searchQuery.trim()) {
      empty.textContent = sorted.length ? 'Aucun de vos tableaux ne correspond à la recherche.' : 'Aucun tableau ne correspond à la recherche.';
    } else if (route.view === 'favoris') {
      empty.textContent = 'Aucun tableau en favori.';
    } else {
      empty.textContent = 'Aucun tableau. Créez votre premier tableau !';
    }
    section.appendChild(empty);
    return;
  }

  if (gridView) {
    renderGrid(section, mine);
  } else {
    renderTable(section, mine, route);
  }
}

function renderTable(section, boardsList, route) {
  const table = document.createElement('table');
  table.classList.add('boards-table');
  const caption = document.createElement('caption');
  caption.textContent = `${boardsList.length} tableau(x)`;
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const columns = [
    { key: 'nom', label: 'Nom' },
    { key: 'dernièreOuverture', label: 'Dernière ouverture' },
    { key: 'éléments', label: 'Éléments' }
  ];
  for (const col of columns) {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    const btn = document.createElement('button');
    btn.classList.add('sort-btn');
    btn.textContent = col.label;
    const isSorted = sortCol === col.key;
    if (isSorted) {
      th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
      btn.classList.add('sorted');
    } else {
      th.setAttribute('aria-sort', 'none');
    }
    btn.addEventListener('click', () => {
      if (sortCol === col.key) { sortAsc = !sortAsc; }
      else { sortCol = col.key; sortAsc = col.key === 'nom'; }
      updateBoardsList(lastSection, route);
    });
    th.appendChild(btn);
    tr.appendChild(th);
  }
  const favTh = document.createElement('th');
  favTh.setAttribute('scope', 'col');
  favTh.textContent = 'Favori';
  tr.appendChild(favTh);
  const actTh = document.createElement('th');
  actTh.setAttribute('scope', 'col');
  actTh.textContent = 'Actions';
  tr.appendChild(actTh);
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const board of boardsList) {
    const row = document.createElement('tr');
    row.dataset.boardId = board.id;

    const nameTd = document.createElement('td');
    nameTd.setAttribute('data-label', 'Nom');
    const nameLink = document.createElement('a');
    nameLink.href = `#/tableau/${board.id}`;
    setBoardLabel(nameLink, board);
    nameLink.classList.add('board-link');
    nameTd.appendChild(nameLink);
    addBadge(nameTd, board);
    row.appendChild(nameTd);

    const dateTd = document.createElement('td');
    dateTd.setAttribute('data-label', 'Dernière ouverture');
    if (board.dernièreOuverture) {
      const time = document.createElement('time');
      time.setAttribute('datetime', board.dernièreOuverture);
      time.textContent = formatDate(board.dernièreOuverture);
      dateTd.appendChild(time);
    } else {
      dateTd.textContent = '-';
    }
    row.appendChild(dateTd);

    const countTd = document.createElement('td');
    countTd.setAttribute('data-label', 'Éléments');
    countTd.textContent = itemCount(board) ?? '-';
    row.appendChild(countTd);

    const favTd = document.createElement('td');
    favTd.setAttribute('data-label', 'Favori');
    const favBtn = document.createElement('button');
    favBtn.classList.add('btn-sm', 'btn-fav');
    favBtn.setAttribute('aria-pressed', String(!!board.favori));
    favBtn.setAttribute('aria-label', board.favori ? `Retirer ${board.nom} des favoris` : `Ajouter ${board.nom} aux favoris`);
    favBtn.innerHTML = iconSvg('favorite');
    favBtn.classList.toggle('is-active', !!board.favori);
    favBtn.addEventListener('click', () => {
      const isFav = boards.toggleFavori(board.id);
      announce(isFav ? `${board.nom} ajouté aux favoris` : `${board.nom} retiré des favoris`);
      render(router.getRoute());
    });
    favTd.appendChild(favBtn);
    row.appendChild(favTd);

    const actTd = document.createElement('td');
    actTd.setAttribute('data-label', 'Actions');
    actTd.classList.add('board-actions');

    const openLink = document.createElement('a');
    openLink.href = `#/tableau/${board.id}`;
    openLink.classList.add('btn-sm');
    openLink.textContent = 'Ouvrir';
    actTd.appendChild(openLink);

    const renameBtn = document.createElement('button');
    renameBtn.classList.add('btn-sm');
    renameBtn.textContent = 'Renommer';
    renameBtn.addEventListener('click', () => openRenameDialog(board));
    if (canEdit(board)) actTd.appendChild(renameBtn);

    const dupBtn = document.createElement('button');
    dupBtn.classList.add('btn-sm');
    dupBtn.textContent = 'Dupliquer';
    dupBtn.addEventListener('click', async () => {
      try {
        await boards.remoteStore().ensureData(board.id);
        const copy = await boards.duplicate(board.id);
        if (copy) {
          announce(`Tableau dupliqué : ${copy.nom}`);
          render(router.getRoute());
        }
      } catch (err) { reportError('board-action', err); }
    });
    actTd.appendChild(dupBtn);

    const exportBtn = document.createElement('button');
    exportBtn.classList.add('btn-sm');
    exportBtn.textContent = 'Exporter';
    exportBtn.addEventListener('click', () => exportBoardJSON(board));
    actTd.appendChild(exportBtn);

    const delBtn = document.createElement('button');
    delBtn.classList.add('btn-sm', 'btn-danger');
    delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', () => openDeleteDialog(board));
    if (canDelete(board)) actTd.appendChild(delBtn);

    addBoardActions(actTd, board);
    row.appendChild(actTd);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  section.appendChild(table);
}

function renderGrid(section, boardsList) {
  const grid = document.createElement('ul');
  grid.classList.add('boards-grid');
  grid.setAttribute('role', 'list');
  for (const board of boardsList) {
    const li = document.createElement('li');
    li.classList.add('board-card');
    li.dataset.boardId = board.id;
    const link = document.createElement('a');
    link.href = `#/tableau/${board.id}`;
    link.classList.add('board-card-link');
    const title = document.createElement('strong');
    title.classList.add('board-card-title');
    setBoardLabel(title, board);
    link.appendChild(title);
    addBadge(link, board);
    const meta = document.createElement('span');
    meta.classList.add('board-card-meta');
    meta.textContent = itemCount(board) === null ? 'Éléments : non chargés' : `${itemCount(board) || 0} élément(s)`;
    link.appendChild(meta);
    if (board.dernièreOuverture) {
      const time = document.createElement('time');
      time.classList.add('board-card-date');
      time.setAttribute('datetime', board.dernièreOuverture);
      time.textContent = formatDate(board.dernièreOuverture);
      link.appendChild(time);
    }
    li.appendChild(link);

    const actionsBar = document.createElement('div');
    actionsBar.classList.add('board-card-actions');
    const favBtn = document.createElement('button');
    favBtn.setAttribute('aria-pressed', String(!!board.favori));
    favBtn.setAttribute('aria-label', board.favori ? `Retirer ${board.nom} des favoris` : `Ajouter ${board.nom} aux favoris`);
    favBtn.innerHTML = iconSvg('favorite');
    favBtn.classList.toggle('is-active', !!board.favori);
    favBtn.classList.add('btn-sm', 'btn-fav');
    favBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isFav = boards.toggleFavori(board.id);
      announce(isFav ? `${board.nom} ajouté aux favoris` : `${board.nom} retiré des favoris`);
      render(router.getRoute());
    });
    actionsBar.appendChild(favBtn);
    const delBtn = document.createElement('button');
    delBtn.classList.add('btn-sm', 'btn-danger');
    delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openDeleteDialog(board);
    });
    if (canDelete(board)) actionsBar.appendChild(delBtn);
    addBoardActions(actionsBar, board);
    li.appendChild(actionsBar);
    grid.appendChild(li);
  }
  section.appendChild(grid);
}

/* Un tableau naît sur le compte. Hors ligne ou refusé : le message du serveur, et rien de créé. */
async function createAndOpen(nom, données) {
  if (creating) return;
  creating = true;
  try {
    const board = await boards.create(nom, données);
    if (router.getRoute().spaceId) boards.moveToSpace(board.id, router.getRoute().spaceId);
    announce(`Tableau créé : ${board.nom}`);
    router.navigate(`/tableau/${board.id}`);
  } catch (err) {
    reportError('board-action', err);
  } finally {
    creating = false;
  }
}

function createFromTemplate(templateId) {
  const tpl = getTemplate(templateId);
  if (!tpl) return;
  const données = tpl.données();
  createAndOpen(données.name || tpl.nom, données);
}

function startCreation() {
  if (getPref('storeOnCreate')) openLibrary(createFromTemplate);
  else openCreateDialog();
}

function openCreateDialog() {
  const dialog = document.getElementById('dialog-create-board');
  if (!dialog) return;
  dialog.querySelector('form').reset();
  dialog.showModal();
}

export function handleCreateSubmit() {
  const dialog = document.getElementById('dialog-create-board');
  const fd = new FormData(dialog.querySelector('form'));
  const nom = (fd.get('board-name') || '').trim() || 'Nouveau tableau';
  const templateId = fd.get('board-template') || 'vierge';
  const tpl = getTemplate(templateId);
  const données = tpl ? tpl.données() : { name: nom, items: [] };
  dialog.close();
  createAndOpen(nom, données);
}

function openRenameDialog(board) {
  const dialog = document.getElementById('dialog-rename-board');
  if (!dialog) return;
  dialog.querySelector('[name="rename-id"]').value = board.id;
  const input = dialog.querySelector('[name="rename-name"]');
  input.value = board.nom;
  dialog.showModal();
  input.select();
}

export function handleRenameSubmit() {
  const dialog = document.getElementById('dialog-rename-board');
  const fd = new FormData(dialog.querySelector('form'));
  const id = fd.get('rename-id');
  const nom = (fd.get('rename-name') || '').trim();
  dialog.close();
  if (!id || !nom) return;
  boards.remoteStore().rename(id, nom).then(() => {
    announce(`Tableau renommé : ${nom}`);
    render(router.getRoute());
  }).catch(err => reportError('board-action', err));
}

function openDeleteDialog(board) {
  const dialog = document.getElementById('dialog-delete-board');
  if (!dialog) return;
  dialog.querySelector('[name="delete-id"]').value = board.id;
  dialog.querySelector('.delete-board-name').textContent = board.nom;
  dialog.showModal();
}

export function handleDeleteConfirm() {
  const dialog = document.getElementById('dialog-delete-board');
  const id = dialog.querySelector('[name="delete-id"]').value;
  dialog.close();
  if (!id || !boards.get(id)) return;
  const nom = boards.get(id).nom;
  boards.remoteStore().remove(id).then(() => {
    announce(`${nom} supprimé`);
    render(router.getRoute());
  }).catch(err => reportError('board-action', err));
}

function importBoardFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let obj;
    try {
      obj = JSON.parse(reader.result);
      if (!obj.items || !Array.isArray(obj.items)) throw new Error('Format invalide');
    } catch (e) {
      announce('Erreur lors de l\'import');
      console.error(e);
      return;
    }
    try {
      const board = await boards.create(obj.name || 'Tableau importé', obj);
      announce(`Tableau importé : ${board.nom}`);
      render(router.getRoute());
    } catch (err) {
      reportError('board-action', err);
    }
  };
  reader.onerror = () => announce('Erreur lors de la lecture du fichier');
  reader.readAsText(file);
}

async function exportBoardJSON(board) {
  try { await boards.remoteStore().ensureData(board.id); }
  catch (err) { reportError('board-action', err); return; }
  const json = JSON.stringify(board.données, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${board.nom || 'tableau'}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  announce(`Tableau exporté : ${board.nom}`);
}

function formatDate(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function addBoardActions(el, board) {
  const icon = document.createElement('select');
  icon.setAttribute('aria-label', `Image de ${board.nom}`);
  for (const [id, label] of boards.BOARD_ICONS) icon.add(new Option(label, id));
  icon.value = board.icon || 'board';
  icon.disabled = !canEdit(board);
  icon.onchange = async () => {
    try { await boards.remoteStore().setIcon(board.id, icon.value); }
    catch (err) { icon.value = board.icon; reportError('board-action', err); return; }
    const link = el.closest('tr, li').querySelector('.board-link, .board-card-title');
    setBoardLabel(link, board);
    announce('Image du tableau modifiée');
  };
  const move = document.createElement('button'); move.textContent = 'Déplacer';
  move.onclick = () => dialog(`Déplacer « ${board.nom} »`, d => {
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Espace de destination'); select.add(new Option('Sans espace', ''));
    boards.getSpaces().forEach(s => select.add(new Option(s.nom, s.id)));
    select.value = board.espaceId || '';
    const ok = document.createElement('button'); ok.textContent = 'Déplacer le tableau';
    ok.onclick = () => { d.close(); boards.moveToSpace(board.id, select.value); render(router.getRoute()); announce('Tableau déplacé'); };
    d.append(select, ok);
  });
  el.append(icon, move);
  addAccountAction(el, board);
}

const canEdit = board => board.role !== 'viewer' && !board.perdu;
const canDelete = board => board.role === 'owner' && !board.perdu;

/* Partager (propriétaire), quitter (invité), récupérer le contenu d'un tableau perdu. */
function addAccountAction(el, board) {
  if (board.perdu) {
    const keep = document.createElement('button');
    keep.classList.add('btn-sm', 'btn-account-action');
    keep.textContent = 'Garder une copie';
    keep.setAttribute('aria-label', `Garder une copie : ${board.nom}`);
    keep.addEventListener('click', () => keepCopy(board));
    el.append(keep);
    return;
  }
  const owner = board.role === 'owner';
  const action = document.createElement('button');
  action.classList.add('btn-sm', 'btn-account-action');
  action.textContent = owner ? 'Partager…' : 'Quitter le tableau';
  action.setAttribute('aria-label', `${action.textContent} : ${board.nom}`);
  action.addEventListener('click', () => {
    if (owner) openShareDialog(board);
    else openLeaveDialog(board, () => render(router.getRoute()));
  });
  el.append(action);
}

async function keepCopy(board) {
  try {
    const copy = await boards.remoteStore().keepCopy(board.id);
    render(router.getRoute());
    lastMain?.querySelector(`[data-board-id="${CSS.escape(copy.id)}"] a`)?.focus();
    announce(`Copie créée : ${copy.nom}`);
  } catch (err) {
    reportError('board-action', err);
  }
}

/* Tableau distant impossible à afficher : un message et un retour, jamais un tableau vide. */
export function renderProblem({ title, message, actions = [] }) {
  if (!container) return;
  container.innerHTML = '';
  container.hidden = false;
  container.classList.add('nav-collapsed');
  const main = document.createElement('main');
  main.id = 'main-content';
  main.className = 'board-problem';
  main.tabIndex = -1;
  const h1 = document.createElement('h1');
  h1.id = 'dashboard-title';
  h1.tabIndex = -1;
  h1.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  const row = document.createElement('div');
  row.className = 'dialog-actions';
  for (const action of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', action.run);
    row.append(b);
  }
  const back = document.createElement('a');
  back.href = '#/';
  back.className = 'board-problem-back';
  back.textContent = 'Retour à l’accueil';
  row.append(back);
  main.append(h1, p, row);
  container.append(main);
  lastSection = null;
  h1.focus();
}

export function renderLoading(message) {
  if (!container) return;
  container.innerHTML = '';
  container.hidden = false;
  container.classList.add('nav-collapsed');
  const main = document.createElement('main');
  main.id = 'main-content';
  main.className = 'board-problem';
  const p = document.createElement('p');
  p.setAttribute('role', 'status');
  p.textContent = message;
  main.append(p);
  container.append(main);
  lastSection = null;
}
