import * as boards from '../store/boards.js';
import { TEMPLATES, getTemplate } from '../store/templates.js';
import * as router from '../router.js';
import { announce } from '../a11y/announcer.js';

let container = null;
let searchQuery = '';
let sortCol = 'dernièreOuverture';
let sortAsc = false;
let gridView = false;
let onThemeToggle = null;

export function init(el, opts) {
  container = el;
  if (opts && opts.onThemeToggle) onThemeToggle = opts.onThemeToggle;
}

export function render(route) {
  if (!container) return;
  container.innerHTML = '';
  container.hidden = false;

  const header = document.createElement('header');
  header.setAttribute('role', 'banner');
  header.classList.add('dashboard-header');

  const h1 = document.createElement('h1');
  h1.id = 'dashboard-title';
  h1.setAttribute('tabindex', '-1');
  const titles = {
    accueil: 'Tableau blanc accessible',
    favoris: 'Tableaux favoris',
    parcourir: 'Tous les tableaux'
  };
  h1.textContent = titles[route.view] || 'Tableau blanc accessible';
  header.appendChild(h1);

  const actions = document.createElement('div');
  actions.classList.add('dashboard-header-actions');

  const createBtn = document.createElement('button');
  createBtn.classList.add('btn-primary');
  createBtn.textContent = 'Créer un tableau';
  createBtn.addEventListener('click', openCreateDialog);
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

  if (onThemeToggle) {
    const themeBtn = document.createElement('button');
    themeBtn.setAttribute('aria-label', 'Changer de thème');
    themeBtn.textContent = 'Thème';
    themeBtn.addEventListener('click', onThemeToggle);
    actions.appendChild(themeBtn);
  }

  header.appendChild(actions);
  container.appendChild(header);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Navigation principale');
  nav.classList.add('dashboard-nav');
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
  container.appendChild(nav);

  const main = document.createElement('main');
  main.id = 'main-content';
  main.setAttribute('tabindex', '-1');

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
    for (const tpl of TEMPLATES) {
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
  viewToggle.setAttribute('aria-label', gridView ? 'Vue en liste' : 'Vue en grille');
  viewToggle.textContent = gridView ? 'Liste' : 'Grille';
  viewToggle.addEventListener('click', () => {
    gridView = !gridView;
    viewToggle.setAttribute('aria-pressed', String(gridView));
    viewToggle.setAttribute('aria-label', gridView ? 'Vue en liste' : 'Vue en grille');
    viewToggle.textContent = gridView ? 'Liste' : 'Grille';
    updateBoardsList(boardsSection, route);
    announce(gridView ? 'Vue en grille' : 'Vue en liste');
  });
  toolbar.appendChild(viewToggle);
  boardsSection.appendChild(toolbar);

  updateBoardsList(boardsSection, route);
  main.appendChild(boardsSection);
  container.appendChild(main);
}

function updateBoardsList(section, route) {
  section.querySelectorAll('.boards-table, .boards-grid, .boards-empty, .search-status').forEach(el => el.remove());

  let allBoards = route.view === 'favoris' ? boards.getFavoris() : boards.getAll();
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
        va = (a.données?.items?.length) || 0; vb = (b.données?.items?.length) || 0; break;
      default: va = ''; vb = '';
    }
    if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  if (sorted.length === 0) {
    const empty = document.createElement('p');
    empty.classList.add('boards-empty');
    if (searchQuery.trim()) {
      empty.textContent = 'Aucun tableau ne correspond à la recherche.';
    } else if (route.view === 'favoris') {
      empty.textContent = 'Aucun tableau en favori.';
    } else {
      empty.textContent = 'Aucun tableau. Créez votre premier tableau !';
    }
    section.appendChild(empty);
    return;
  }

  if (gridView) {
    renderGrid(section, sorted);
  } else {
    renderTable(section, sorted, route);
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
      updateBoardsList(section, route);
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

    const nameTd = document.createElement('td');
    nameTd.setAttribute('data-label', 'Nom');
    const nameLink = document.createElement('a');
    nameLink.href = `#/tableau/${board.id}`;
    nameLink.textContent = board.nom;
    nameLink.classList.add('board-link');
    nameTd.appendChild(nameLink);
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
    countTd.textContent = (board.données?.items?.length) || 0;
    row.appendChild(countTd);

    const favTd = document.createElement('td');
    favTd.setAttribute('data-label', 'Favori');
    const favBtn = document.createElement('button');
    favBtn.classList.add('btn-sm', 'btn-fav');
    favBtn.setAttribute('aria-pressed', String(!!board.favori));
    favBtn.setAttribute('aria-label', board.favori ? `Retirer ${board.nom} des favoris` : `Ajouter ${board.nom} aux favoris`);
    favBtn.textContent = board.favori ? '★' : '☆';
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
    openLink.setAttribute('role', 'button');
    openLink.textContent = 'Ouvrir';
    actTd.appendChild(openLink);

    const renameBtn = document.createElement('button');
    renameBtn.classList.add('btn-sm');
    renameBtn.textContent = 'Renommer';
    renameBtn.addEventListener('click', () => openRenameDialog(board));
    actTd.appendChild(renameBtn);

    const dupBtn = document.createElement('button');
    dupBtn.classList.add('btn-sm');
    dupBtn.textContent = 'Dupliquer';
    dupBtn.addEventListener('click', () => {
      const copy = boards.duplicate(board.id);
      if (copy) {
        announce(`Tableau dupliqué : ${copy.nom}`);
        render(router.getRoute());
      }
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
    actTd.appendChild(delBtn);

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
    const link = document.createElement('a');
    link.href = `#/tableau/${board.id}`;
    link.classList.add('board-card-link');
    const title = document.createElement('strong');
    title.classList.add('board-card-title');
    title.textContent = board.nom;
    link.appendChild(title);
    const meta = document.createElement('span');
    meta.classList.add('board-card-meta');
    meta.textContent = `${(board.données?.items?.length) || 0} élément(s)`;
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
    favBtn.textContent = board.favori ? '★' : '☆';
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
    actionsBar.appendChild(delBtn);
    li.appendChild(actionsBar);
    grid.appendChild(li);
  }
  section.appendChild(grid);
}

function createFromTemplate(templateId) {
  const tpl = getTemplate(templateId);
  if (!tpl) return;
  const données = tpl.données();
  const board = boards.create(données.name || tpl.nom, données);
  announce(`Tableau créé : ${board.nom}`);
  router.navigate(`/tableau/${board.id}`);
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
  const board = boards.create(nom, données);
  dialog.close();
  announce(`Tableau créé : ${board.nom}`);
  router.navigate(`/tableau/${board.id}`);
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
  if (id && nom) {
    boards.rename(id, nom);
    announce(`Tableau renommé : ${nom}`);
    render(router.getRoute());
  }
  dialog.close();
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
  if (id) {
    const board = boards.get(id);
    const nom = board ? board.nom : 'Tableau';
    boards.remove(id);
    announce(`${nom} supprimé`);
    render(router.getRoute());
  }
  dialog.close();
}

function importBoardFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj.items || !Array.isArray(obj.items)) throw new Error('Format invalide');
      const nom = obj.name || 'Tableau importé';
      const board = boards.create(nom, obj);
      announce(`Tableau importé : ${board.nom}`);
      render(router.getRoute());
    } catch (e) {
      announce('Erreur lors de l\'import');
      console.error(e);
    }
  };
  reader.onerror = () => announce('Erreur lors de la lecture du fichier');
  reader.readAsText(file);
}

function exportBoardJSON(board) {
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
