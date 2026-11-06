import * as io from '../io.js';
import * as state from '../state.js';
import * as boards from '../store/boards.js';
import { saveTemplate } from '../store/templates.js';
import { ask } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';
import { setBoardLabel } from '../ui/icons.js';
import { showNotice } from '../ui/notice.js';

let currentId = () => null;

export function saveAsTemplate(ids = null) {
  ask('Enregistrer comme modèle', boards.get(currentId()).nom, nom => {
    const snapshot = state.getSnapshot();
    if (ids) snapshot.items = state.collectForCopy(ids);
    try { saveTemplate(nom, snapshot); announce('Modèle enregistré dans Mes modèles'); }
    catch { announce('Impossible d’enregistrer le modèle : stockage indisponible'); }
  });
}

export function init(getId) {
  currentId = getId;
  const title = document.getElementById('board-title');
  const rename = () => {
    if (title.querySelector('input')) return;
    const board = boards.get(getId());
    if (!board) return;
    const input = document.createElement('input'); input.id = 'board-title-input';
    input.value = board.nom; input.setAttribute('aria-label', 'Nom du tableau');
    title.replaceChildren(input); input.focus(); input.select();
    const finish = save => {
      if (save && input.value.trim() && board.distant) {
        // Le nom d'un tableau du compte suit PATCH, jamais PUT : il ne change qu'après la réponse du serveur.
        const nom = input.value.trim();
        const remote = boards.remoteStore();
        remote.rename(board.id, nom).then(() => {
          state.getBoard().name = nom;
          remote.setBaseline(board.id, state.getSnapshot());
          setBoardLabel(title, board);
          document.title = `${board.nom} — Tableau blanc accessible`;
          announce(`Tableau renommé : ${board.nom}`);
        }).catch(err => {
          if (err.name !== 'ApiError') throw err;
          showNotice('board-action', err.message, { tone: 'error' });
          announce(err.message);
        });
      } else if (save && input.value.trim()) {
        boards.rename(board.id, input.value.trim());
        state.getBoard().name = board.nom;
        document.title = `${board.nom} — Tableau blanc accessible`;
        announce(`Tableau renommé : ${board.nom}`);
      } else announce('Renommage annulé');
      setBoardLabel(title, board);
      title.focus();
    };
    input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter'); } };
    input.onblur = () => { if (input.isConnected) finish(false); };
  };
  title.tabIndex = 0;
  title.title = 'Renommer le tableau (Entrée)';
  title.onclick = rename;
  title.onkeydown = e => { if (e.target === title && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); rename(); } };
  document.getElementById('btn-save-template').onclick = () => saveAsTemplate();
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
