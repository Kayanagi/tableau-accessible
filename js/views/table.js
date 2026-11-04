import * as state from '../state.js';

let container = null;
let sortCol = 'type';
let sortAsc = true;

export function init(el) {
  container = el;
  state.subscribe(() => render());
}

export function render() {
  if (!container) return;
  const focusedId = container.contains(document.activeElement) ? document.activeElement.dataset.selectId : null;
  container.innerHTML = '';

  const items = state.getItems();

  if (items.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Aucun élément. Utilisez la barre d’outils pour en ajouter.';
    p.classList.add('table-empty');
    container.appendChild(p);
    return;
  }

  const table = document.createElement('table');
  table.classList.add('items-table');

  const caption = document.createElement('caption');
  caption.textContent = `${items.length} élément(s) dans le tableau`;
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const selTh = document.createElement('th');
  selTh.setAttribute('scope', 'col');
  selTh.textContent = 'Sélection';
  headerRow.appendChild(selTh);

  const columns = [
    { key: 'type', label: 'Type' },
    { key: 'content', label: 'Contenu' },
    { key: 'color', label: 'Couleur' },
    { key: 'x', label: 'X' },
    { key: 'y', label: 'Y' },
    { key: 'width', label: 'Largeur' },
    { key: 'height', label: 'Hauteur' }
  ];

  for (const col of columns) {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    const btn = document.createElement('button');
    btn.classList.add('sort-btn');
    btn.textContent = col.label;
    const isSorted = sortCol === col.key;
    if (isSorted) {
      btn.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
      btn.classList.add('sorted');
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = sortAsc ? ' ▲' : ' ▼';
      btn.appendChild(arrow);
    }
    btn.addEventListener('click', () => {
      if (sortCol === col.key) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col.key;
        sortAsc = true;
      }
      render();
    });
    th.appendChild(btn);
    headerRow.appendChild(th);
  }

  const actTh = document.createElement('th');
  actTh.setAttribute('scope', 'col');
  actTh.textContent = 'Actions';
  headerRow.appendChild(actTh);

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const sorted = [...items].sort((a, b) => {
    let va = getCellValue(a, sortCol);
    let vb = getCellValue(b, sortCol);
    if (typeof va === 'number' && typeof vb === 'number') {
      return sortAsc ? va - vb : vb - va;
    }
    va = String(va).toLowerCase();
    vb = String(vb).toLowerCase();
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  const tbody = document.createElement('tbody');
  for (const item of sorted) {
    const tr = document.createElement('tr');
    if (state.isSelected(item.id)) tr.classList.add('table-selected');
    tr.setAttribute('data-id', item.id);
    const selTd = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'select-box';
    cb.checked = state.isSelected(item.id);
    cb.dataset.selectId = item.id;
    cb.setAttribute('aria-label', `Sélectionner : ${state.getItemLabel(item)}`);
    cb.addEventListener('change', () => state.toggleSelected(item.id));
    selTd.appendChild(cb);
    tr.appendChild(selTd);

    tr.appendChild(createTd((state.TYPES[item.type] || item.type) + (item.locked ? ' — 🔒 Verrouillé' : '')));
    tr.appendChild(createTd(getContentDisplay(item)));
    tr.appendChild(createTd(getColorDisplay(item)));
    tr.appendChild(createTd(item.x != null ? item.x : '-'));
    tr.appendChild(createTd(item.y != null ? item.y : '-'));
    tr.appendChild(createTd(item.width || '-'));
    tr.appendChild(createTd(item.height || '-'));

    const actTd = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Éditer';
    editBtn.classList.add('btn-sm');
    editBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('table-edit', { detail: { id: item.id } }));
    });
    actTd.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Supprimer';
    delBtn.classList.add('btn-sm', 'btn-danger');
    delBtn.addEventListener('click', () => {
      state.removeItem(item.id);
    });
    actTd.appendChild(delBtn);

    tr.appendChild(actTd);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
  if (focusedId) container.querySelector(`[data-select-id="${focusedId}"]`)?.focus();
}

function createTd(text) {
  const td = document.createElement('td');
  td.textContent = String(text);
  return td;
}

function getCellValue(item, col) {
  switch (col) {
    case 'type': return state.TYPES[item.type] || item.type;
    case 'content': return getContentDisplay(item);
    case 'color': return getColorDisplay(item);
    case 'x': return item.x != null ? item.x : -Infinity;
    case 'y': return item.y != null ? item.y : -Infinity;
    case 'width': return item.width || 0;
    case 'height': return item.height || 0;
    default: return '';
  }
}

function getContentDisplay(item) {
  if (item.type === 'connector') {
    return state.getItemLabel(item);
  }
  if (item.type === 'card') {
    return item.title || '';
  }
  return item.content || '';
}

function getColorDisplay(item) {
  if (item.type === 'sticky_note') {
    return state.COLORS[item.color] || '-';
  }
  return '-';
}
