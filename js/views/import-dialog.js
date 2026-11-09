/*
 * « Importer vos tableaux de cet appareil » : ce qui reste d'avant les comptes (tableaux, espaces, « Mes modèles »),
 * le choix, puis le résultat élément par élément.
 * Un tableau importé n'est retiré de l'appareil qu'après un clic sur « Supprimer de cet appareil », jamais après un échec.
 * « Supprimer de cet appareil sans importer » permet de refuser ce qui n'est pas à soi, après confirmation explicite.
 */
import * as account from '../store/account.js';
import * as localImport from '../store/local-import.js';
import { dialog } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';
import { button, focusMessage, formMessage } from './account-forms.js';

const objectsLabel = n => `${n} objet${n > 1 ? 's' : ''}`;
const count = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const FULL = 'La limite des données du compte est atteinte (200 espaces, 100 modèles, 2 Mio).';

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

  const pendingIds = () => [...localImport.importable(userId), ...localImport.importableSpaces(), ...localImport.importableTemplates()].map(x => x.id);
  // Fermer sans importer vaut « Plus tard » : le dialogue ne revient pas de lui-même, il reste dans « Mon compte ».
  // Pas une fermeture due à la fin de session (écran de connexion) : personne n'a répondu, la question reviendra.
  el.addEventListener('close', () => {
    if (account.getStatus() === 'signed-in' && account.getUser()?.id === userId) localImport.markLater(pendingIds());
  });
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

  function group(legendText, kind, entries, label) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'field import-choice';
    const legend = document.createElement('legend');
    legend.textContent = legendText;
    fieldset.append(legend);
    for (const entry of entries) {
      const option = document.createElement('label');
      option.className = 'import-option';
      const box = document.createElement('input');
      Object.assign(box, { type: 'checkbox', name: kind, value: entry.id, checked: true });
      option.append(box, ` ${label(entry)}`);
      fieldset.append(option);
    }
    return fieldset;
  }

  /* status : message de réussite à afficher en tête (après une suppression), lu une fois, par l'annonceur. */
  function showChoice({ status = null } = {}) {
    heading.textContent = 'Importer vos tableaux de cet appareil';
    body.replaceChildren();
    const offer = { board: localImport.importable(userId), space: localImport.importableSpaces(), template: localImport.importableTemplates() };
    const message = formMessage();
    body.append(message);
    if (status) {
      // Pas de role="status" : inséré déjà rempli, il ne serait pas lu de façon fiable, et l'annonceur le lit déjà.
      const done = document.createElement('p');
      done.className = 'account-message is-success import-status';
      done.textContent = status;
      body.prepend(done);
    }
    if (!offer.board.length && !offer.space.length && !offer.template.length) {
      const p = document.createElement('p');
      p.textContent = 'Aucun tableau à importer depuis cet appareil.';
      body.append(p);
    } else {
      const form = document.createElement('form');
      if (offer.board.length) form.append(group('Tableaux à importer dans votre compte', 'board', offer.board, b => `${b.nom} (${objectsLabel(localImport.itemCount(b))})`));
      if (offer.space.length) form.append(group('Espaces à importer dans votre compte', 'space', offer.space, s => s.nom));
      if (offer.template.length) form.append(group('Modèles à importer dans « Mes modèles »', 'template', offer.template, t => t.nom));
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = 'Ces éléments ont été créés sur cet appareil avant les comptes. Importez ce qui est à vous ; ce qui ne l’est pas peut être supprimé de cet appareil sans être importé. Rien n’est supprimé sans votre accord.';
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'btn-primary';
      submit.textContent = 'Importer dans mon compte';
      const checked = () => {
        const ids = kind => [...form.querySelectorAll(`input[name="${kind}"]:checked`)].map(i => i.value);
        return { board: offer.board.filter(b => ids('board').includes(b.id)), space: offer.space.filter(s => ids('space').includes(s.id)), template: offer.template.filter(t => ids('template').includes(t.id)) };
      };
      const none = sel => !sel.board.length && !sel.space.length && !sel.template.length;
      const refuse = button('Supprimer de cet appareil sans importer…', () => {
        const sel = checked();
        if (none(sel)) {
          focusMessage(message, 'Cochez au moins un élément à supprimer de cet appareil.');
          return;
        }
        showDiscard(sel);
      }, 'btn-danger');
      actions.append(submit, button('Plus tard', () => el.close()), refuse);
      form.append(hint, actions);
      form.addEventListener('submit', e => {
        e.preventDefault();
        const sel = checked();
        if (none(sel)) {
          focusMessage(message, 'Cochez au moins un élément, ou choisissez « Plus tard ».');
          return;
        }
        run(sel);
      });
      body.append(form);
    }
    const done = importedList(() => showChoice());
    if (done) body.append(done);
    heading.focus();
    if (status) announce(status);
  }

  /* Confirmation explicite : la liste exacte, un bouton qui dit ce qu'il fait, et Annuler. */
  function showDiscard(sel) {
    heading.textContent = 'Supprimer sans importer';
    body.replaceChildren();
    const intro = document.createElement('p');
    intro.id = 'import-discard-intro';
    intro.textContent = 'Ces éléments seront supprimés définitivement de cet appareil, sans être importés dans votre compte. Cette action est irréversible :';
    const ul = document.createElement('ul');
    const items = [
      ...sel.board.map(b => `Tableau « ${b.nom} »`),
      ...sel.space.map(s => `Espace « ${s.nom} »`),
      ...sel.template.map(t => `Modèle « ${t.nom} »`)
    ];
    for (const text of items) { const li = document.createElement('li'); li.textContent = text; ul.append(li); }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const confirm = button('Supprimer définitivement de cet appareil', () => {
      localImport.discard({ boards: sel.board.map(b => b.id), spaces: sel.space.map(s => s.id), templates: sel.template.map(t => t.id) });
      showChoice({ status: `${count(items.length, 'élément supprimé', 'éléments supprimés')} de cet appareil, sans import.` });
    }, 'btn-danger');
    confirm.setAttribute('aria-describedby', intro.id);
    actions.append(confirm, button('Annuler', () => showChoice()));
    body.append(intro, ul, actions);
    heading.focus();
    // Le focus est sur le titre : la liste est lue d'emblée, pour que rien ne soit supprimé à l'aveugle.
    announce(`${intro.textContent} ${items.join(', ')}.`);
  }

  async function run(sel) {
    busy = true;
    try {
      // Le bouton « Importer » va disparaître : le focus attend sur le titre plutôt que de retomber sur la page.
      heading.focus();
      body.replaceChildren();
      const progress = document.createElement('p');
      progress.setAttribute('role', 'status');
      body.append(progress);
      const results = [];
      // Espaces et modèles d'abord : ils rejoignent le compte, et les tableaux importés retrouvent leur espace.
      for (const [kind, list, fn] of [['space', sel.space, localImport.importSpaces], ['template', sel.template, localImport.importTemplates]]) {
        if (!list.length) continue;
        try {
          fn(list);
          list.forEach(x => results.push({ kind, nom: x.nom, ok: true }));
        } catch (err) {
          console.warn(err);
          list.forEach(x => results.push({ kind, nom: x.nom, ok: false, reason: FULL }));
        }
      }
      for (const [index, board] of sel.board.entries()) {
        progress.textContent = `Import de ${board.nom} (${index + 1} sur ${sel.board.length})…`;
        try {
          const { skipped } = await localImport.importBoard(board, userId);
          results.push({ kind: 'board', nom: board.nom, board, ok: true, skipped });
        } catch (err) {
          if (err.name !== 'ApiError') throw err;
          results.push({ kind: 'board', nom: board.nom, board, ok: false, reason: err.message });
          // Session perdue : l'écran de connexion prend la place, le reste attendra.
          if (err.code === 'unauthenticated') break;
        }
      }
      if (!el.open) return;
      await account.refreshBoards();
      if (el.open) showResults(results);
    } catch (err) {
      console.error(err);
      if (el.open) showFailure();
    } finally {
      busy = false;
    }
  }

  /* Erreur inattendue : rien n'est retiré de l'appareil, le dialogue reste fermable et la liste peut être reprise. */
  function showFailure() {
    heading.textContent = 'Import interrompu';
    body.replaceChildren();
    const p = document.createElement('p');
    p.className = 'account-message is-error';
    p.textContent = 'Une erreur inattendue a interrompu l’import. Rien n’a été supprimé de cet appareil ; les tableaux déjà importés restent dans votre compte.';
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    actions.append(button('Revenir à la liste', () => showChoice(), 'btn-primary'), button('Fermer', () => el.close()));
    body.append(p, actions);
    heading.focus();
    announce(p.textContent);
  }

  function summaryOf(results) {
    const ok = kind => results.filter(r => r.ok && r.kind === kind).length;
    const parts = [];
    const boards = ok('board'), spaces = ok('space'), templates = ok('template');
    if (boards || (!spaces && !templates)) parts.push(`${boards} tableau${boards > 1 ? 'x' : ''} importé${boards > 1 ? 's' : ''}`);
    if (spaces) parts.push(`${count(spaces, 'espace importé', 'espaces importés')}`);
    if (templates) parts.push(`${count(templates, 'modèle importé', 'modèles importés')}`);
    const failed = results.filter(r => !r.ok).length;
    if (failed) parts.push(`${failed} refusé${failed > 1 ? 's' : ''}`);
    return `${parts.join(', ')}.`;
  }

  function showResults(results) {
    heading.textContent = 'Résultat de l’import';
    body.replaceChildren();
    // Lu par l'annonceur seulement : un role="status" inséré déjà rempli le ferait lire deux fois, ou pas du tout.
    const summary = document.createElement('p');
    summary.className = 'import-summary';
    summary.textContent = summaryOf(results);
    const ul = document.createElement('ul');
    ul.className = 'import-list import-results';
    const nameOf = r => (r.kind === 'space' ? `Espace « ${r.nom} »` : r.kind === 'template' ? `Modèle « ${r.nom} »` : r.nom);
    const render = () => {
      ul.replaceChildren();
      for (const r of results) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'import-name';
        if (r.ok) {
          name.textContent = `${nameOf(r)} : importé`;
          li.append(name);
          // Espaces et modèles ont déjà quitté l'espace commun de l'appareil : rien à supprimer.
          if (r.kind !== 'board') { ul.append(li); continue; }
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
          name.textContent = `${nameOf(r)} : refusé. ${r.reason} Il reste sur cet appareil.`;
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
    if (localImport.hasAnything(userId)) actions.append(button('Revenir à la liste', () => showChoice()));
    body.append(summary, ul, actions);
    heading.focus();
    announce(summary.textContent);
  }

  showChoice();
  return el;
}
