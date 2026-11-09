/*
 * Partage d'un tableau : inviter, changer un rôle, retirer un membre, annuler une invitation (propriétaire),
 * quitter le tableau (invité). Les noms et adresses viennent d'autres comptes : textContent uniquement.
 */
import * as api from '../sync/api.js';
import * as account from '../store/account.js';
import * as boards from '../store/boards.js';
import { dialog } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';
import { button, checkEmail, clean, formMessage, makeField, makeForm, setMessage } from './account-forms.js';

export const ROLE_LABELS = { owner: 'Propriétaire', editor: 'Peut modifier', viewer: 'Peut lire' };

let nextId = 0;

function roleSelect(value, label) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  select.add(new Option(ROLE_LABELS.editor, 'editor'));
  select.add(new Option(ROLE_LABELS.viewer, 'viewer'));
  select.value = value;
  return select;
}

export function openShareDialog(board) {
  let body;
  const el = dialog(`Partager « ${board.nom} »`, d => {
    d.classList.add('account-dialog', 'share-dialog');
    body = document.createElement('div');
    body.className = 'account-body';
    d.append(body);
  });
  const heading = el.querySelector('h2');
  heading.tabIndex = -1;

  const intro = document.createElement('p');
  intro.className = 'share-notice';
  intro.textContent = 'Aucun e-mail n’est envoyé : prévenez la personne, elle verra l’invitation en se connectant avec cette adresse.';

  const email = makeField({ name: 'email', label: 'Adresse e-mail de la personne', type: 'email', autocomplete: 'off' });
  const roleWrap = document.createElement('div');
  roleWrap.className = 'field account-field';
  const roleLabel = document.createElement('label');
  roleLabel.htmlFor = `share-role-${++nextId}`;
  roleLabel.textContent = 'Rôle';
  const role = roleSelect('editor');
  role.removeAttribute('aria-label');
  role.id = roleLabel.htmlFor;
  roleWrap.append(roleLabel, role);

  const status = formMessage();
  const lists = document.createElement('div');
  const { form, actions } = makeForm({
    fields: [email], submitLabel: 'Inviter', busyMessage: 'Envoi de l’invitation…',
    validate: v => clean({ email: checkEmail(v.email) }),
    send: v => api.createInvite(board.id, { email: v.email.trim(), role: role.value }).catch(err => {
      // Plafond atteint (adresse ou tableau) : dire que rien n'a été enregistré, puis la raison donnée par le serveur.
      if (err.name === 'ApiError' && err.code === 'quota_exceeded') err.message = `Invitation non enregistrée : ${err.message}`;
      throw err;
    }),
    done: async (res, { form: f, message }) => {
      f.reset();
      role.value = 'editor';
      setMessage(message, `Invitation enregistrée pour ${res.invite.email}. Prévenez cette personne.`, 'success');
      announce(`Invitation enregistrée pour ${res.invite.email}`);
      await refresh();
      email.input.focus();
    }
  });
  form.insertBefore(roleWrap, actions);
  body.append(intro, form, status, lists);

  /* Après un changement, le focus va à l'élément nommé s'il existe encore, sinon au champ d'invitation. */
  async function act(run, spoken, focusKey) {
    setMessage(status, '');
    try {
      await run();
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      setMessage(status, err.message);
      status.focus();
      await refresh().catch(() => {});
      return;
    }
    announce(spoken);
    await refresh();
    (focusKey && lists.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`) || email.input).focus();
  }

  function listSection(title) {
    const section = document.createElement('section');
    section.className = 'account-section';
    const h = document.createElement('h3');
    h.textContent = title;
    const ul = document.createElement('ul');
    ul.className = 'share-list';
    section.append(h, ul);
    lists.append(section);
    return ul;
  }

  function renderLists(data) {
    lists.replaceChildren();
    const members = listSection(`Membres (${data.members.length})`);
    const me = account.getUser()?.id;
    for (const member of data.members) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'share-name';
      name.textContent = member.userId === me ? `${member.displayName} (vous)` : member.displayName;
      li.append(name);
      if (member.role === 'owner') {
        const owner = document.createElement('span');
        owner.textContent = ROLE_LABELS.owner;
        li.append(owner);
      } else {
        const select = roleSelect(member.role, `Rôle de ${member.displayName}`);
        select.dataset.focusKey = `role-${member.userId}`;
        select.addEventListener('change', () => act(() => api.setMemberRole(board.id, member.userId, select.value), `${member.displayName} : ${ROLE_LABELS[select.value]}`, select.dataset.focusKey));
        const remove = button('Retirer', () => act(() => api.removeMember(board.id, member.userId), `${member.displayName} retiré du tableau`), 'btn-sm');
        remove.setAttribute('aria-label', `Retirer ${member.displayName} du tableau`);
        li.append(select, remove);
      }
      members.append(li);
    }
    const pending = data.invites || [];
    const invited = listSection(`Invitations en attente (${pending.length})`);
    if (!pending.length) {
      const li = document.createElement('li');
      li.textContent = 'Aucune invitation en attente.';
      invited.append(li);
    }
    for (const invite of pending) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'share-name';
      name.textContent = `${invite.email} : ${ROLE_LABELS[invite.role]}`;
      const cancel = button('Annuler l’invitation', () => act(() => api.cancelInvite(board.id, invite.id), `Invitation de ${invite.email} annulée`), 'btn-sm');
      cancel.setAttribute('aria-label', `Annuler l’invitation de ${invite.email}`);
      li.append(name, cancel);
      invited.append(li);
    }
  }

  async function refresh() {
    try {
      renderLists(await api.listMembers(board.id));
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      lists.replaceChildren();
      setMessage(status, err.message);
    }
    account.refreshBoards();
  }

  const loading = document.createElement('p');
  loading.setAttribute('role', 'status');
  loading.textContent = 'Chargement des membres…';
  lists.append(loading);
  refresh().catch(err => console.error(err));
  heading.focus();
  return el;
}

/* Quitter un tableau partagé : ce qui reste à envoyer part d'abord ; une copie est proposée si l'envoi échoue. */
export function openLeaveDialog(board, onLeft) {
  const el = dialog(`Quitter « ${board.nom} » ?`, d => {
    d.classList.add('account-dialog');
    const body = document.createElement('div');
    body.className = 'account-body';
    const p = document.createElement('p');
    p.textContent = 'Vous n’y aurez plus accès, à moins d’être invité de nouveau.';
    const message = formMessage();
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    let busy = false;
    actions.append(
      button('Quitter le tableau', async () => {
        if (busy) return;
        busy = true;
        const remote = boards.remoteStore();
        try {
          await remote.flush(board.id);
          await api.removeMember(board.id, account.getUser().id);
        } catch (err) {
          if (err.name !== 'ApiError') throw err;
          setMessage(message, err.message);
          message.focus();
          busy = false;
          return;
        }
        remote.drop(board.id);
        d.close();
        announce(`Vous avez quitté ${board.nom}`);
        onLeft?.();
      }, 'btn-danger'),
      button('Annuler', () => d.close())
    );
    body.append(p, message, actions);
    d.append(body);
  });
  el.querySelector('.btn-danger').focus();
  return el;
}
