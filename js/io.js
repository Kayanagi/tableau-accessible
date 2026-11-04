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
        for (const child of children) lines.push(`- ${state.getItemLabel(child)}`);
      }
      lines.push('');
    }
  }

  if (orphans.length > 0) {
    if (frames.length > 0) { lines.push('## Éléments hors cadre'); lines.push(''); }
    for (const item of orphans) lines.push(`- ${state.getItemLabel(item)}`);
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
      lines.push(`- ${fl} → ${tl}${lb}`);
    }
    lines.push('');
  }

  if (board.items.length === 0) { lines.push('*(tableau vide)*'); lines.push(''); }

  const md = lines.join('\n');
  download(md, `${board.name || 'tableau'}.md`, 'text/markdown');
  announce('Plan exporté en Markdown');
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
