import * as io from '../io.js';
import * as state from '../state.js';
import * as boards from '../store/boards.js';
import { saveTemplate } from '../store/templates.js';
import { ask } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';

export function init(getId) {
  const title = document.getElementById('board-title');
  const rename = () => {
    if (title.querySelector('input')) return;
    const board = boards.get(getId());
    if (!board) return;
    const input = document.createElement('input'); input.id = 'board-title-input';
    input.value = board.nom; input.setAttribute('aria-label', 'Nom du tableau');
    title.replaceChildren(input); input.focus(); input.select();
    const finish = save => {
      if (save && input.value.trim()) {
        boards.rename(board.id, input.value.trim());
        state.getBoard().name = board.nom;
        document.title = `${board.nom} — Tableau blanc accessible`;
        announce(`Tableau renommé : ${board.nom}`);
      } else announce('Renommage annulé');
      title.textContent = `${board.emoji || '📋'} ${board.nom}`;
      title.focus();
    };
    input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter'); } };
    input.onblur = () => { if (input.isConnected) finish(false); };
  };
  title.tabIndex = 0;
  title.title = 'Renommer le tableau (Entrée)';
  title.onclick = rename;
  title.onkeydown = e => { if (e.target === title && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); rename(); } };
  document.getElementById('btn-save-template').onclick = () => ask('Enregistrer comme modèle', boards.get(getId()).nom, nom => {
    try { saveTemplate(nom, state.getSnapshot()); announce('Modèle enregistré dans Mes modèles'); }
    catch { announce('Impossible d’enregistrer le modèle : stockage indisponible'); }
  });
  const button = document.getElementById('btn-export');
  const menu = document.getElementById('export-menu');
  const entries = [...menu.querySelectorAll('button')];
  const close = focus => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); };
  const open = last => { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); entries[last ? entries.length - 1 : 0].focus(); };
  button.onclick = () => menu.hidden ? open(false) : close(true);
  button.onkeydown = e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); open(e.key === 'ArrowUp'); } };
  menu.onkeydown = e => {
    e.stopPropagation();
    const index = entries.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    if (e.key === 'Tab') close(false);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); entries[e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length].focus();
    }
  };
  const actions = { json: io.exportJSON, md: io.exportMarkdown, svg: io.exportSVG, png: io.exportPNG, csv: io.exportCSV };
  entries.forEach(entry => entry.onclick = () => { close(true); actions[entry.dataset.format](); });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== button) close(false); });
}
