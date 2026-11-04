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
      const from = state.getItem(c.startId);
      const to = state.getItem(c.endId);
      const fl = from ? state.getItemLabel(from) : '?';
      const tl = to ? state.getItemLabel(to) : '?';
      const lb = c.label ? ` (${c.label})` : '';
      lines.push(`- ${state.LINE_TYPES[c.lineType] || state.LINE_TYPES.arrow} : ${fl} → ${tl}${lb}`);
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
