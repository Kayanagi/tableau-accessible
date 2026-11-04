import * as state from '../state.js';

let container = null;

export function init(el) {
  container = el;
  state.subscribe(() => render());
}

export function render() {
  if (!container) return;
  const focused = container.contains(document.activeElement) ? document.activeElement : null;
  const restore = focused?.dataset.selectId ? `[data-select-id="${focused.dataset.selectId}"]` : focused?.dataset.id ? `.outline-item-btn[data-id="${focused.dataset.id}"]` : focused?.dataset.group ? `[data-group="${focused.dataset.group}"]` : null;
  container.innerHTML = '';

  const board = state.getBoard();
  const frames = state.getFrames();
  const orphans = state.getOrphanItems();
  const connectors = state.getConnectors();
  const selectedId = state.getSelectedId();

  const heading = document.createElement('h2');
  heading.textContent = board.name;
  heading.classList.add('outline-title');
  container.appendChild(heading);

  if (board.items.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Tableau vide. Utilisez la barre d’outils pour ajouter des éléments.';
    empty.classList.add('outline-empty');
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Structure du tableau');
  list.setAttribute('aria-multiselectable', 'true');
  list.classList.add('outline-tree');

  for (const frame of frames) {
    const li = createFrameNode(frame, selectedId);
    list.appendChild(li);
  }

  if (orphans.length > 0) {
    if (frames.length > 0) {
      const sep = document.createElement('li');
      sep.setAttribute('role', 'treeitem');
      sep.classList.add('outline-separator');
      const span = document.createElement('span');
      span.textContent = 'Hors cadre';
      span.classList.add('outline-group-label');
      sep.appendChild(span);

      const subList = document.createElement('ul');
      subList.setAttribute('role', 'group');
      appendItems(subList, orphans, selectedId, connectors);
      sep.appendChild(subList);
      list.appendChild(sep);
    } else {
      appendItems(list, orphans, selectedId, connectors);
    }
  }

  const comments = state.getComments();
  if (comments.length > 0) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.classList.add('outline-separator');
    const span = document.createElement('span');
    span.textContent = `Commentaires (${comments.length})`;
    span.classList.add('outline-group-label');
    const subList = document.createElement('ul');
    subList.setAttribute('role', 'group');
    for (const c of comments) subList.appendChild(createItemNode(c, selectedId, connectors));
    li.append(span, subList);
    list.appendChild(li);
  }

  if (connectors.length > 0) {
    const sepLi = document.createElement('li');
    sepLi.setAttribute('role', 'treeitem');
    sepLi.classList.add('outline-separator');
    const span = document.createElement('span');
    span.textContent = `Liens (${connectors.length})`;
    span.classList.add('outline-group-label');
    sepLi.appendChild(span);

    const subList = document.createElement('ul');
    subList.setAttribute('role', 'group');
    for (const c of connectors) {
      subList.appendChild(createConnectorNode(c, selectedId));
    }
    sepLi.appendChild(subList);
    list.appendChild(sepLi);
  }

  container.appendChild(list);
  if (restore) container.querySelector(restore)?.focus();
}

function createFrameNode(frame, selectedId) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  li.setAttribute('aria-expanded', 'true');
  markSelected(li, frame);

  const btn = document.createElement('button');
  btn.classList.add('outline-item-btn');
  btn.setAttribute('data-id', frame.id);
  btn.innerHTML = `<span class="outline-icon" aria-hidden="true">□</span> <strong>${escapeHtml((frame.content || '(cadre sans nom)') + (frame.locked ? ' — 🔒 Verrouillé' : ''))}</strong>`;
  btn.addEventListener('click', () => {
    state.setSelectedId(frame.id);
    dispatchFocus(frame.id);
  });
  li.append(selectBox(frame), btn);

  const children = state.getChildrenOf(frame.id);
  if (children.length > 0) {
    const subList = document.createElement('ul');
    subList.setAttribute('role', 'group');
    appendItems(subList, children, selectedId, state.getConnectors());
    li.appendChild(subList);
  } else {
    const empty = document.createElement('span');
    empty.textContent = '(vide)';
    empty.classList.add('outline-empty-frame');
    li.appendChild(empty);
  }

  return li;
}

function createItemNode(item, selectedId, connectors) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  markSelected(li, item);

  const btn = document.createElement('button');
  btn.classList.add('outline-item-btn');
  btn.setAttribute('data-id', item.id);

  const icon = getTypeIcon(item);
  const label = state.getItemLabel(item);
  btn.innerHTML = `<span class="outline-icon" aria-hidden="true">${icon}</span> ${escapeHtml(label)}`;
  btn.addEventListener('click', () => {
    state.setSelectedId(item.id);
    dispatchFocus(item.id);
  });
  li.append(selectBox(item), btn);

  const links = connectors.filter(c => c.startId === item.id || c.endId === item.id);
  if (links.length > 0) {
    const linkInfo = document.createElement('ul');
    linkInfo.classList.add('outline-links');
    linkInfo.setAttribute('aria-label', 'Liens');
    for (const c of links) {
      const otherId = c.startId === item.id ? c.endId : c.startId;
      const other = state.getItem(otherId);
      const dir = c.startId === item.id ? 'vers' : 'depuis';
      const linkLi = document.createElement('li');
      linkLi.textContent = `Relie ${dir} ${other ? state.getItemLabel(other) : '?'}${c.label ? ' (' + c.label + ')' : ''}`;
      linkInfo.appendChild(linkLi);
    }
    li.appendChild(linkInfo);
  }
  if (item.type === 'mindmap') appendMindChildren(li, item, selectedId, connectors);
  if (item.type === 'kanban') {
    const cols = document.createElement('ul');
    cols.setAttribute('role', 'group');
    for (const col of item.columns) {
      const c = document.createElement('li');
      c.setAttribute('role', 'treeitem');
      c.classList.add('outline-detail');
      c.textContent = `${col.name} (${col.cards.length}) : ${col.cards.map(k => k.text || '(vide)').join(', ') || 'aucune carte'}`;
      cols.appendChild(c);
    }
    li.setAttribute('aria-expanded', 'true');
    li.appendChild(cols);
  }

  return li;
}

function appendItems(ul, items, selectedId, connectors) {
  const done = new Set();
  for (const item of items) {
    if (!item.groupId) { ul.appendChild(createItemNode(item, selectedId, connectors)); continue; }
    if (done.has(item.groupId)) continue;
    done.add(item.groupId);
    ul.appendChild(createGroupNode(items.filter(i => i.groupId === item.groupId), selectedId, connectors));
  }
}

function createGroupNode(members, selectedId, connectors) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  li.setAttribute('aria-expanded', 'true');
  const all = members.every(m => state.isSelected(m.id));
  li.setAttribute('aria-selected', String(all));
  if (all) li.classList.add('outline-selected');
  const btn = document.createElement('button');
  btn.classList.add('outline-item-btn');
  btn.dataset.group = members[0].groupId;
  btn.innerHTML = `<span class="outline-icon" aria-hidden="true">⧉</span> <strong>Groupe de ${members.length} éléments</strong>`;
  btn.addEventListener('click', () => state.setSelection(members.map(m => m.id), true));
  const sub = document.createElement('ul');
  sub.setAttribute('role', 'group');
  for (const m of members) sub.appendChild(createItemNode(m, selectedId, connectors));
  li.append(btn, sub);
  return li;
}

function appendMindChildren(li, item, selectedId, connectors) {
  const kids = state.mindChildren(item.id);
  if (!kids.length) return;
  li.setAttribute('aria-expanded', String(!item.collapsed));
  const sub = document.createElement('ul');
  sub.setAttribute('role', 'group');
  sub.hidden = !!item.collapsed;
  for (const k of kids) sub.appendChild(createItemNode(k, selectedId, connectors));
  li.appendChild(sub);
}

function createConnectorNode(c, selectedId) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  markSelected(li, c);

  const btn = document.createElement('button');
  btn.classList.add('outline-item-btn');
  btn.setAttribute('data-id', c.id);

  const label = state.getItemLabel(c);
  btn.innerHTML = `<span class="outline-icon" aria-hidden="true">→</span> ${escapeHtml(label)}`;
  btn.addEventListener('click', () => {
    state.setSelectedId(c.id);
    dispatchFocus(c.id);
  });
  li.append(selectBox(c), btn);
  return li;
}

function markSelected(li, item) {
  const on = state.isSelected(item.id);
  li.setAttribute('aria-selected', String(on));
  if (on) li.classList.add('outline-selected');
}

function selectBox(item) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'select-box';
  cb.checked = state.isSelected(item.id);
  cb.dataset.selectId = item.id;
  cb.setAttribute('aria-label', `Sélectionner : ${state.getItemLabel(item)}`);
  cb.addEventListener('change', () => state.toggleSelected(item.id));
  return cb;
}

function getTypeIcon(item) {
  switch (item.type) {
    case 'sticky_note': return '■';
    case 'shape': return '○';
    case 'text': return 'T';
    case 'card': return '▣';
    case 'frame': return '□';
    case 'connector': return '→';
    case 'drawing': return '✎';
    case 'comment': return '💬';
    case 'mindmap': return '❋';
    case 'kanban': return '▥';
    case 'datatable': return '▦';
    case 'code': return '‹›';
    case 'flipcard': return '⟲';
    default: return '•';
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function dispatchFocus(id) {
  document.dispatchEvent(new CustomEvent('outline-focus', { detail: { id } }));
}
