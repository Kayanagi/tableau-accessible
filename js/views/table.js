import * as state from '../state.js';
import { announce } from '../a11y/announcer.js';
import { LINE_COLORS } from '../lines.js';

let container = null;
let tagFilter = '';
let sortCol = 'type';
let sortAsc = true;

export function init(el) {
  container = el;
  state.subscribe(() => render());
}

export function render() {
  if (!container) return;
  const focusedId = container.contains(document.activeElement) ? document.activeElement.dataset.selectId : null;
  const filterFocused = document.activeElement?.id === 'table-tag-filter';
  container.innerHTML = '';

  const tags = state.getTags();
  if (tagFilter && !state.getTag(tagFilter)) tagFilter = '';
  const items = tagFilter ? state.getItems().filter(i => i.tags?.includes(tagFilter)) : state.getItems();
  if (tags.length) {
    const wrap = document.createElement('div');
    wrap.className = 'table-filter';
    const label = document.createElement('label');
    label.htmlFor = 'table-tag-filter';
    label.textContent = 'Filtrer par étiquette';
    const select = document.createElement('select');
    select.id = 'table-tag-filter';
    select.add(new Option('Toutes les étiquettes', ''));
    for (const t of tags) select.add(new Option(t.name, t.id));
    select.value = tagFilter;
    select.addEventListener('change', () => {
      tagFilter = select.value;
      render();
      const n = tagFilter ? state.getItems().filter(i => i.tags?.includes(tagFilter)).length : state.getItems().length;
      announce(`${n} élément(s) affiché(s)${tagFilter ? ` avec l’étiquette ${state.getTag(tagFilter).name}` : ''}`);
    });
    wrap.append(label, select);
    container.appendChild(wrap);
    if (filterFocused) select.focus();
  }

  if (items.length === 0) {
    const p = document.createElement('p');
    p.textContent = tagFilter ? 'Aucun élément avec cette étiquette.' : (state.isReadOnly() ? 'Aucun élément.' : 'Aucun élément. Utilisez la barre d’outils pour en ajouter.');
    p.classList.add('table-empty');
    container.appendChild(p);
    return;
  }

  const table = document.createElement('table');
  table.classList.add('items-table');

  const caption = document.createElement('caption');
  caption.textContent = `${items.length} élément(s) dans le tableau${tagFilter ? ` avec l’étiquette « ${state.getTag(tagFilter).name} »` : ''}`;
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
    { key: 'tags', label: 'Étiquettes' },
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

  const readOnly = state.isReadOnly();
  if (!readOnly) {
    const actTh = document.createElement('th');
    actTh.setAttribute('scope', 'col');
    actTh.textContent = 'Actions';
    headerRow.appendChild(actTh);
  }

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

    tr.appendChild(createTd((state.TYPES[item.type] || item.type) + (item.locked ? ' — Verrouillé' : '')));
    tr.appendChild(createTd(getContentDisplay(item)));
    tr.appendChild(createTd(getColorDisplay(item)));
    tr.appendChild(createTd(getTagsDisplay(item)));
    const line = item.type === 'connector';
    tr.appendChild(createTd(line ? (item.start?.x ?? '-') : item.x != null ? item.x : '-'));
    tr.appendChild(createTd(line ? (item.start?.y ?? '-') : item.y != null ? item.y : '-'));
    tr.appendChild(createTd(!line && item.width || '-'));
    tr.appendChild(createTd(!line && item.height || '-'));

    tbody.appendChild(tr);
    if (readOnly) continue;

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
  }

  table.appendChild(tbody);
  container.appendChild(table);
  renderDataTables(items.filter(i => i.type === 'datatable'));
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
    case 'tags': return getTagsDisplay(item);
    case 'x': return item.type === 'connector' ? (item.start?.x ?? -Infinity) : item.x != null ? item.x : -Infinity;
    case 'y': return item.type === 'connector' ? (item.start?.y ?? -Infinity) : item.y != null ? item.y : -Infinity;
    case 'width': return item.type === 'connector' ? 0 : item.width || 0;
    case 'height': return item.type === 'connector' ? 0 : item.height || 0;
    default: return '';
  }
}

function getContentDisplay(item) {
  return state.getContentSummary(item);
}

function getTagsDisplay(item) {
  return (item.tags || []).map(id => state.getTag(id)?.name).filter(Boolean).join(', ') || '-';
}

function renderDataTables(list) {
  if (!list.length) return;
  const h = document.createElement('h2');
  h.className = 'data-tables-title';
  h.textContent = 'Tableaux de données';
  container.appendChild(h);
  for (const item of list) {
    const t = document.createElement('table');
    t.className = 'items-table data-grid';
    const cap = document.createElement('caption');
    cap.textContent = item.content || 'Tableau de données';
    const head = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const v of item.rows[0]) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = v; hr.appendChild(th); }
    head.appendChild(hr);
    const body = document.createElement('tbody');
    for (const row of item.rows.slice(1)) {
      const tr = document.createElement('tr');
      for (const v of row) tr.appendChild(createTd(v));
      body.appendChild(tr);
    }
    t.append(cap, head, body);
    container.appendChild(t);
  }
}

function getColorDisplay(item) {
  if (item.type === 'connector') return LINE_COLORS.find(c => c[0] === item.stroke)?.[1] || '-';
  if (item.type === 'sticky_note') {
    return state.COLORS[item.color] || '-';
  }
  return '-';
}
