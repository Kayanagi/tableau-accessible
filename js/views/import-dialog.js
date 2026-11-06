/*
 * « Importer vos tableaux de cet appareil » : le choix, puis le résultat tableau par tableau.
 * Rien n'est retiré de l'appareil sans un clic sur « Supprimer de cet appareil », et jamais après un échec.
 */
import * as account from '../store/account.js';
import * as localImport from '../store/local-import.js';
import { dialog } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';
import { button, formMessage, setMessage } from './account-forms.js';

const objectsLabel = n => `${n} objet${n > 1 ? 's' : ''}`;

export function openImportDialog() {
  const userId = account.getUser()?.id;
  let body;
  const el = dialog('Importer vos tableaux de cet appareil', d => {
    d.classList.add('account-dialog', 'import-dialog');
    body = document.createElement('div');
    body.className = 'account-body';
    d.append(body);
  });
  const heading = el.querySelector('h2');
  heading.tabIndex = -1;
  let busy = false;

  // Fermer sans importer vaut « Plus tard » : le dialogue ne revient pas de lui-même, il reste dans « Mon compte ».
  el.addEventListener('close', () => { localImport.markLater(localImport.importable(userId).map(b => b.id)); });
  el.addEventListener('cancel', e => { if (busy) e.preventDefault(); });

  function deleteButton(board, after) {
    const del = button('Supprimer de cet appareil', () => {
      localImport.removeFromDevice(board.id);
      announce(`${board.nom} supprimé de cet appareil`);
      after();
    }, 'btn-sm');
    del.setAttribute('aria-label', `Supprimer de cet appareil : ${board.nom}`);
    return del;
  }

  function importedList(onChange) {
    const done = localImport.alreadyImported(userId);
    if (!done.length) return null;
    const section = document.createElement('section');
    section.className = 'account-section';
    const h = document.createElement('h3');
    h.textContent = 'Déjà importés, encore sur cet appareil';
    const ul = document.createElement('ul');
    ul.className = 'import-list';
    for (const board of done) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'import-name';
      name.textContent = board.nom;
      li.append(name, deleteButton(board, onChange));
      ul.append(li);
    }
    section.append(h, ul);
    return section;
  }

  function showChoice({ focus = heading } = {}) {
    body.replaceChildren();
    const boards = localImport.importable(userId);
    const message = formMessage();
    body.append(message);
    if (!boards.length) {
      const p = document.createElement('p');
      p.textContent = 'Aucun tableau à importer depuis cet appareil.';
      body.append(p);
    } else {
      const form = document.createElement('form');
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'field import-choice';
      const legend = document.createElement('legend');
      legend.textContent = 'Tableaux à importer dans votre compte';
      fieldset.append(legend);
      for (const board of boards) {
        const label = document.createElement('label');
        label.className = 'import-option';
        const box = document.createElement('input');
        Object.assign(box, { type: 'checkbox', name: 'board', value: board.id, checked: true });
        label.append(box, ` ${board.nom} (${objectsLabel(localImport.countItems(board))})`);
        fieldset.append(label);
      }
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = 'Ces tableaux sont copiés sur votre compte. Rien n’est supprimé de cet appareil sans votre accord.';
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'btn-primary';
      submit.textContent = 'Importer dans mon compte';
      actions.append(submit, button('Plus tard', () => el.close()));
      form.append(fieldset, hint, actions);
      form.addEventListener('submit', e => {
        e.preventDefault();
        const ids = [...form.querySelectorAll('input:checked')].map(i => i.value);
        if (!ids.length) {
          setMessage(message, 'Cochez au moins un tableau, ou choisissez « Plus tard ».');
          message.focus();
          return;
        }
        run(boards.filter(b => ids.includes(b.id))).catch(err => console.error(err));
      });
      body.append(form);
    }
    const done = importedList(() => showChoice());
    if (done) body.append(done);
    (focus || heading).focus();
  }

  async function run(selected) {
    busy = true;
    body.replaceChildren();
    const progress = document.createElement('p');
    progress.setAttribute('role', 'status');
    body.append(progress);
    const results = [];
    for (const [index, board] of selected.entries()) {
      progress.textContent = `Import de ${board.nom} (${index + 1} sur ${selected.length})…`;
      try {
        const { skipped } = await localImport.importBoard(board, userId);
        results.push({ board, ok: true, skipped });
      } catch (err) {
        if (err.name !== 'ApiError') throw err;
        results.push({ board, ok: false, reason: err.message });
        // Session perdue : l'écran de connexion prend la place, le reste attendra.
        if (err.code === 'unauthenticated') break;
      }
    }
    busy = false;
    if (!el.open) return;
    await account.refreshBoards();
    showResults(results);
  }

  function showResults(results) {
    heading.textContent = 'Résultat de l’import';
    body.replaceChildren();
    const okCount = results.filter(r => r.ok).length;
    const failed = results.length - okCount;
    const summary = document.createElement('p');
    summary.setAttribute('role', 'status');
    summary.textContent = `${okCount} tableau${okCount > 1 ? 'x' : ''} importé${okCount > 1 ? 's' : ''}${failed ? `, ${failed} refusé${failed > 1 ? 's' : ''}` : ''}.`;
    const ul = document.createElement('ul');
    ul.className = 'import-list import-results';
    const render = () => {
      ul.replaceChildren();
      for (const r of results) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'import-name';
        if (r.ok) {
          name.textContent = `${r.board.nom} : importé`;
          li.append(name);
          if (r.removed) {
            const gone = document.createElement('span');
            gone.textContent = 'Supprimé de cet appareil';
            li.append(gone);
          } else {
            li.append(deleteButton(r.board, () => {
              r.removed = true;
              render();
              ul.closest('dialog')?.querySelector('h2')?.focus();
            }));
          }
        } else {
          name.textContent = `${r.board.nom} : refusé. ${r.reason} Il reste sur cet appareil.`;
          li.classList.add('is-refused');
          li.append(name);
        }
        ul.append(li);
      }
    };
    render();
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    actions.append(button('Terminer', () => el.close(), 'btn-primary'));
    if (localImport.importable(userId).length) {
      actions.append(button('Revenir à la liste', () => { heading.textContent = 'Importer vos tableaux de cet appareil'; showChoice(); }));
    }
    body.append(summary, ul, actions);
    heading.focus();
    announce(summary.textContent);
  }

  showChoice();
  return el;
}
