import * as state from './state.js';
import { announce } from './a11y/announcer.js';

export function exportJSON() {
  const data = state.getSnapshot();
  const json = JSON.stringify(data, null, 2);
  download(json, `${data.name || 'tableau'}.json`, 'application/json');
  announce('Tableau exporté en JSON');
}

export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.items || !Array.isArray(data.items)) throw new Error('Format invalide');
        state.loadBoard(data);
        announce('Tableau importé avec succès');
        resolve();
      } catch (e) {
        announce('Erreur lors de l\'import');
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function exportMarkdown() {
  const board = state.getBoard();
  const lines = [];
  lines.push(`# ${board.name}`);
  lines.push('');

  const frames = state.getFrames();
  const orphans = state.getOrphanItems();
  const connectors = state.getConnectors();

  if (frames.length > 0) {
    for (const frame of frames) {
      lines.push(`## ${frame.content || '(cadre sans nom)'}`);
      lines.push('');
      const children = state.getChildrenOf(frame.id);
      if (children.length === 0) {
        lines.push('*(vide)*');
      } else {
        pushItems(lines, children);
      }
      lines.push('');
    }
  }

  if (orphans.length > 0) {
    if (frames.length > 0) { lines.push('## Éléments hors cadre'); lines.push(''); }
    pushItems(lines, orphans);
    lines.push('');
  }

  if (connectors.length > 0) {
    lines.push('## Liens');
    lines.push('');
    for (const c of connectors) {
      const lb = c.label ? ` (${c.label})` : '';
      lines.push(`- ${c.startId || c.endId ? 'Ligne' : 'Ligne libre'} (${(state.LINE_TYPES[c.lineType] || state.LINE_TYPES.straight).toLowerCase()}) : ${state.getEndLabel(c, 'start')} → ${state.getEndLabel(c, 'end')}${lb}`);
    }
    lines.push('');
  }

  const comments = state.getComments();
  if (comments.length > 0) {
    lines.push('## Commentaires');
    lines.push('');
    for (const c of comments) {
      const target = state.getItem(c.targetId);
      lines.push(`- ${c.resolved ? '[x]' : '[ ]'} ${target ? `Sur ${state.getItemLabel(target)}` : 'Sur le canevas'}`);
      for (const m of c.messages) lines.push(`  - ${m.author} (${m.date.slice(0, 16).replace('T', ' ')}) : ${m.text}`);
    }
    lines.push('');
  }

  if (board.items.length === 0) { lines.push('*(tableau vide)*'); lines.push(''); }

  const md = lines.join('\n');
  download(md, `${board.name || 'tableau'}.md`, 'text/markdown');
  announce('Plan exporté en Markdown');
}

function pushItems(lines, items) {
  const groups = new Set();
  for (const item of items) {
    if (!item.groupId) { pushItem(lines, item, ''); continue; }
    if (groups.has(item.groupId)) continue;
    groups.add(item.groupId);
    const members = items.filter(i => i.groupId === item.groupId);
    lines.push(`- Groupe de ${members.length} éléments`);
    for (const m of members) pushItem(lines, m, '  ');
  }
}

function pushItem(lines, item, indent) {
  lines.push(`${indent}- ${state.getItemLabel(item)}`);
  const sub = indent + '  ';
  if (item.type === 'mindmap') for (const k of state.mindChildren(item.id)) pushItem(lines, k, sub);
  if (item.type === 'kanban') for (const col of item.columns) {
    lines.push(`${sub}- ${col.name}`);
    for (const card of col.cards) lines.push(`${sub}  - ${card.text || '(vide)'}`);
  }
  if (item.type === 'flipcard') lines.push(`${sub}- Recto : ${item.content || '(vide)'}`, `${sub}- Verso : ${item.back || '(vide)'}`);
  if (item.type === 'code' && item.content) {
    lines.push('', `${sub}\`\`\`${item.language === 'text' ? '' : item.language}`, ...item.content.split('\n').map(l => sub + l), `${sub}\`\`\``, '');
  }
  if (item.type === 'datatable') {
    const cell = v => String(v).replace(/\|/g, '\\|');
    lines.push('', `${sub}| ${item.rows[0].map(cell).join(' | ')} |`, `${sub}|${item.rows[0].map(() => ' --- |').join('')}`);
    for (const row of item.rows.slice(1)) lines.push(`${sub}| ${row.map(cell).join(' | ')} |`);
    lines.push('');
  }
}

function download(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

export function csvContent() {
  const board = state.getBoard();
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const rows = [['type', 'texte', 'couleur', 'x', 'y', 'étiquettes']];
  for (const i of board.items) if (i.type === 'connector') rows.push([i.type, state.getItemLabel(i), i.stroke || '', i.start?.x ?? '', i.start?.y ?? '', '']);
  else rows.push([i.type, [i.title, i.content, i.label, i.back, i.rows?.map(r => r.join(' | ')).join('\n'), i.columns?.map(c => `${c.name}: ${c.cards.map(v => v.text).join(', ')}`).join('\n')].filter(Boolean).join('\n'), i.color || '', i.x || 0, i.y || 0, (i.tags || []).map(id => board.tags?.find(t => t.id === id)?.name || id).join(', ')]);
  return rows.map(r => r.map(quote).join(',')).join('\r\n');
}
export function exportCSV() {
  download('\uFEFF' + csvContent(), `${state.getBoard().name}.csv`, 'text/csv;charset=utf-8');
  announce('Éléments exportés en CSV');
}
export function svgContent() {
  const source = document.querySelector('.canvas-svg');
  const panel = source.closest('[role=tabpanel]');
  const wasHidden = panel.hidden;
  panel.hidden = false;
  try {
    const copy = source.cloneNode(true);
    const originals = [source, ...source.querySelectorAll('*')];
    const clones = [copy, ...copy.querySelectorAll('*')];
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'white-space', 'visibility', 'display'];
    originals.forEach((el, i) => {
      const style = getComputedStyle(el);
      for (const prop of props) clones[i].style.setProperty(prop, style.getPropertyValue(prop));
      for (const attr of el.attributes) if (attr.value.includes('var(--')) clones[i].setAttribute(attr.name, style.getPropertyValue(attr.name) || attr.value.replace(/var\((--[\w-]+)\)/g, (_, name) => style.getPropertyValue(name).trim()));
      clones[i].removeAttribute('tabindex');
      clones[i].classList.remove('selected');
    });
    const group = source.querySelector('#canvas-items');
    const bounds = group.getBBox();
    const x = bounds.x - 24, y = bounds.y - 24;
    const width = Math.max(320, bounds.width + 48), height = Math.max(180, bounds.height + 48);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    copy.setAttribute('width', width); copy.setAttribute('height', height);
    copy.style.width = `${width}px`; copy.style.height = `${height}px`;
    copy.style.background = getComputedStyle(source).backgroundColor;
    copy.querySelectorAll(':scope > :not(defs):not(#canvas-items)').forEach(el => el.remove());
    copy.querySelectorAll('.resize-handle, .connector-handle, .selection-outline, .line-halo').forEach(el => el.remove());
    return { text: new XMLSerializer().serializeToString(copy), width, height };
  } finally { panel.hidden = wasHidden; }
}
export function exportSVG() {
  download(svgContent().text, `${state.getBoard().name}.svg`, 'image/svg+xml');
  announce('Canevas exporté en SVG');
}
export async function exportPNG() {
  const { text, width, height } = svgContent();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * 2); canvas.height = Math.ceil(height * 2);
    const context = canvas.getContext('2d');
    context.fillStyle = document.querySelector('.canvas-svg').style.backgroundColor || getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f7f7fb';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Image indisponible');
    const a = document.createElement('a'); const pngURL = URL.createObjectURL(blob);
    a.href = pngURL; a.download = `${state.getBoard().name}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(pngURL), 1000);
    announce('Canevas exporté en PNG, échelle 2');
  } catch { announce('Impossible d’exporter le PNG'); }
  finally { URL.revokeObjectURL(url); }
}
