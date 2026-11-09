/*
 * Dialogue du compte, une fois connecté : nom, mot de passe, export, tableaux de l'appareil, déconnexion, suppression.
 * La connexion et l'inscription sont sur l'écran de connexion (views/login-screen.js).
 */
import * as api from '../sync/api.js';
import * as account from '../store/account.js';
import * as boards from '../store/boards.js';
import * as local from '../store/account-local.js';
import { dialog } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';
import { button, checkName, checkNewPassword, clean, focusMessage, formMessage, makeField, makeForm, PASSWORD_MAX, PASSWORD_MIN, privacyHint, setMessage } from './account-forms.js';
import { openImportDialog } from './import-dialog.js';

let nextWarning = 0;

export function openAccountDialog({ onClose } = {}) {
  let body;
  const el = dialog('Mon compte', d => {
    d.classList.add('account-dialog');
    body = document.createElement('div');
    body.className = 'account-body';
    d.append(body);
  });
  const heading = el.querySelector('h2');
  heading.tabIndex = -1;
  el.addEventListener('close', () => onClose?.());

  let firstView = true;
  const show = (title, build) => {
    heading.textContent = title;
    body.replaceChildren();
    const target = build(body) || heading;
    target.focus();
    // Le focus arrive sur un champ : sans cette annonce, le changement de vue passe inaperçu au lecteur d'écran.
    if (!firstView && target.tagName === 'INPUT') announce(title);
    firstView = false;
  };

  /* ---- Connecté ---- */

  function section(root, title, ...content) {
    const s = document.createElement('section');
    s.className = 'account-section';
    const h = document.createElement('h3');
    h.textContent = title;
    s.append(h, ...content);
    root.append(s);
    return s;
  }

  /* returnTo : le bouton qui a mené à la vue quittée par « Annuler », pour reprendre là où on en était. */
  function showAccount(returnTo) {
    const user = account.getUser();
    if (!user) { showUnreachable(); return; }
    show('Mon compte', root => {
      const who = document.createElement('p');
      who.className = 'account-who';
      who.textContent = `Connecté avec l’adresse ${user.email}`;
      root.append(who);

      const name = makeField({ name: 'displayName', label: 'Nom affiché', autocomplete: 'name', value: user.displayName });
      section(root, 'Nom', makeForm({
        fields: [name], submitLabel: 'Enregistrer le nom', busyMessage: 'Enregistrement du nom…',
        validate: v => clean({ displayName: checkName(v.displayName) }),
        send: v => api.updateMe({ displayName: v.displayName.trim() }),
        done: (res, { message }) => {
          account.updateUser(res.user);
          setMessage(message, 'Nom enregistré.', 'success');
          announce('Nom enregistré');
        }
      }).form);

      const oldPassword = makeField({ name: 'password', label: 'Mot de passe actuel', type: 'password', autocomplete: 'current-password' });
      const newPassword = makeField({ name: 'newPassword', label: 'Nouveau mot de passe', type: 'password', autocomplete: 'new-password', hint: `De ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères. Vos autres appareils seront déconnectés.` });
      section(root, 'Mot de passe', makeForm({
        fields: [oldPassword, newPassword], submitLabel: 'Changer le mot de passe', busyMessage: 'Changement du mot de passe…',
        validate: v => clean({ password: v.password ? null : 'Saisissez votre mot de passe actuel.', newPassword: checkNewPassword(v.newPassword) }),
        send: v => api.changePassword({ oldPassword: v.password, newPassword: v.newPassword }),
        done: (_, { message, form }) => {
          form.reset();
          setMessage(message, 'Mot de passe changé.', 'success');
          announce('Mot de passe changé');
        }
      }).form);

      const dataMessage = formMessage();
      const exportBtn = button('Exporter mes données', async () => {
        setMessage(dataMessage, '');
        announce('Préparation de l’export…');
        try {
          download(await api.exportAccount());
          setMessage(dataMessage, 'Export téléchargé : baro-export.json.', 'success');
          announce('Export téléchargé');
        } catch (err) {
          if (err.name !== 'ApiError') throw err;
          setMessage(dataMessage, err.message);
        }
      });
      const dataHint = document.createElement('p');
      dataHint.className = 'field-hint';
      dataHint.textContent = 'Un fichier JSON avec votre compte, vos espaces, favoris et modèles, et les tableaux dont vous êtes propriétaire.';
      section(root, 'Mes données', dataHint, privacyHint(), dataMessage, exportBtn);

      const importHint = document.createElement('p');
      importHint.className = 'field-hint';
      importHint.textContent = 'Les tableaux créés sur cet appareil avant les comptes peuvent rejoindre votre compte.';
      const importBtn = button('Importer vos tableaux de cet appareil…', () => openImportDialog());
      section(root, 'Tableaux de cet appareil', importHint, importBtn);

      const leaveMessage = formMessage();
      const logoutBtn = button('Se déconnecter', () => startLogout(leaveMessage));
      const deleteBtn = button('Supprimer mon compte…', showDelete, 'btn-danger');
      section(root, 'Session', leaveMessage, logoutBtn);
      section(root, 'Supprimer le compte', deleteBtn);
      return { logout: logoutBtn, delete: deleteBtn }[returnTo] || heading;
    });
  }

  function showUnreachable() {
    show('Mon compte', root => {
      const p = document.createElement('p');
      p.className = 'account-message is-error';
      p.textContent = 'Serveur injoignable : votre compte n’est pas disponible pour le moment. La copie de vos tableaux sur cet appareil reste utilisable.';
      announce(p.textContent);
      root.append(p, button('Réessayer', async () => {
        announce('Nouvelle tentative…');
        account.start();
        await account.whenReady();
        if (account.getUser()) showAccount();
        else if (account.hasSession()) { showUnreachable(); announce('Serveur toujours injoignable'); }
      }));
      return heading;
    });
  }

  function clearSessionAndClose(message, options) {
    account.signedOut(options);
    el.close();
    announce(message);
  }

  /*
   * Ce qui attend encore part d'abord : tableaux, puis espaces, favoris et modèles. Ce qui n'a pas pu partir est
   * signalé avant la déconnexion ; le travail des tableaux peut rester sur l'appareil si la personne le choisit.
   */
  async function startLogout(message) {
    announce('Déconnexion en cours…');
    const remote = boards.remoteStore();
    await Promise.all([remote?.flushAll(), local.flush()]);
    const waiting = remote?.pending() || [];
    const unsent = local.hasUnsent();
    if (waiting.length || unsent) { showLogoutWarning(waiting, unsent); return; }
    await logoutNow(message);
  }

  /* Rend false si le serveur a refusé : la session reste ouverte, le message le dit. */
  async function logoutNow(message, { keepLocal = false, discarded = false } = {}) {
    try {
      await api.logout();
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      if (err.status !== 401) {
        focusMessage(message, err.message);
        return false;
      }
    }
    clearSessionAndClose('Vous êtes déconnecté.', { keepLocal, discarded });
    return true;
  }

  /*
   * Proposé au seul propriétaire, depuis sa session : ses modifications de tableaux non envoyées (à garder ici, à son
   * seul usage, ou à effacer) et, le cas échéant, ses changements d'espaces, favoris ou modèles que le serveur n'a pas
   * encore reçus : ceux-là ne peuvent pas rester sur l'appareil, seulement être renvoyés ou abandonnés.
   */
  function showLogoutWarning(waiting, unsent) {
    show('Modifications non envoyées', root => {
      const parts = [];
      const list = items => {
        const ul = document.createElement('ul');
        for (const text of items) { const li = document.createElement('li'); li.textContent = text; ul.append(li); }
        return ul;
      };
      if (waiting.length) {
        const p = document.createElement('p');
        p.textContent = 'Ces tableaux ont des modifications qui n’ont pas pu être envoyées. La déconnexion efface les données du compte sur cet appareil :';
        parts.push(p, list(waiting.map(e => e.nom)));
      }
      if (unsent) {
        const p = document.createElement('p');
        p.textContent = 'Vos derniers changements d’espaces, de favoris ou de modèles n’ont pas pu être envoyés au serveur. Ils seront perdus à la déconnexion : réessayez l’envoi si la connexion est revenue.';
        parts.push(p);
      }
      if (waiting.length) {
        const advice = document.createElement('p');
        advice.textContent = '« Les garder sur cet appareil » laisse ici les modifications des tableaux, à l’usage de votre seul compte : une autre personne connectée ici ne les voit pas. Vos espaces, favoris et modèles sont enregistrés sur le serveur avec votre compte. Sur un appareil partagé, choisissez « Me déconnecter sans les garder ».';
        parts.push(advice);
      }
      const message = formMessage();
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      // Une seule opération à la fois : des clics répétés ne mettent pas plusieurs copies de côté.
      let busy = false;
      const once = run => async () => {
        if (busy) return;
        busy = true;
        actions.setAttribute('aria-busy', 'true');
        try { await run(); }
        finally { busy = false; actions.removeAttribute('aria-busy'); }
      };
      if (waiting.length) {
        actions.append(
          button('Les garder sur cet appareil et me déconnecter', once(async () => {
            // Le serveur n'a pas pu les recevoir : elles attendent ici et vous seront proposées à l'import à votre retour.
            // Tout ou rien : si un tableau ne tient pas, ou si la déconnexion échoue, les réserves déjà posées sont retirées.
            const remote = boards.remoteStore();
            const kept = [];
            const undo = () => kept.forEach(b => boards.removeFromReserve(b.id));
            for (const e of waiting) {
              const saved = remote.keepOnDevice(e.id);
              if (!saved) {
                undo();
                focusMessage(message, 'Stockage plein : ces modifications n’ont pas pu être gardées. Rien n’a été mis de côté et vous restez connecté.');
                return;
              }
              kept.push(saved);
            }
            let done = false;
            try { done = await logoutNow(message, { keepLocal: true }); }
            finally { if (!done) undo(); }
          }), 'btn-primary'),
          button('Me déconnecter sans les garder', once(() => logoutNow(message, { discarded: true })), 'btn-danger')
        );
      } else {
        actions.append(
          button('Réessayer l’envoi', once(async () => {
            announce('Nouvel envoi…');
            await local.flush();
            if (!local.hasUnsent()) { await logoutNow(message); return; }
            focusMessage(message, 'Toujours impossible d’envoyer ces changements. Vérifiez votre connexion.');
          }), 'btn-primary'),
          button('Me déconnecter quand même', once(() => logoutNow(message)), 'btn-danger')
        );
      }
      actions.append(button('Annuler', () => { if (!busy) showAccount('logout'); }));
      root.append(...parts, message, actions);
      // Le focus part sur le titre, puis Tab mène aux boutons : l'avertissement serait sauté.
      announce(parts.map(p => p.textContent).join(' '));
      return heading;
    });
  }

  async function showDelete() {
    let rows = null;
    let failure = null;
    announce('Vérification de vos tableaux…');
    try {
      rows = (await api.listBoards()).boards;
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      failure = err.message;
    }
    if (!el.open || !account.hasSession()) return; // Session expirée entre-temps : l'écran de connexion a pris la place.
    show('Supprimer le compte', root => {
      if (failure) {
        // L'avertissement est obligatoire : sans la liste des tableaux, pas de suppression possible.
        const p = document.createElement('p');
        p.className = 'account-message is-error';
        p.textContent = `Impossible de vérifier vos tableaux : ${failure}`;
        const actions = document.createElement('div');
        actions.className = 'dialog-actions';
        actions.append(button('Réessayer', showDelete, 'btn-primary'), button('Annuler', () => showAccount('delete')));
        root.append(p, actions);
        announce(p.textContent);
        return heading;
      }
      const owned = rows.filter(b => b.role === 'owner');
      const shared = owned.filter(b => b.memberCount > 1);
      const warning = document.createElement('div');
      warning.className = 'account-warning';
      warning.id = `account-warning-${++nextWarning}`;
      const intro = document.createElement('p');
      intro.textContent = `Cette suppression est définitive. Votre compte et ${owned.length === 0 ? 'vos données seront effacés' : owned.length === 1 ? 'votre tableau enregistré sur le compte seront effacés' : `vos ${owned.length} tableaux enregistrés sur le compte seront effacés`}. Vos espaces, favoris et modèles, enregistrés avec le compte, le seront aussi. Les tableaux d’avant les comptes restés sur cet appareil y restent : ceux que vous aviez importés seront de nouveau proposés à l’import, ou à la suppression de cet appareil.`;
      warning.append(intro);
      if (shared.length) {
        const p = document.createElement('p');
        p.textContent = 'Ces tableaux ont d’autres membres, qui les perdront aussi :';
        const ul = document.createElement('ul');
        ul.className = 'account-shared';
        for (const b of shared) {
          const others = b.memberCount - 1;
          const li = document.createElement('li');
          li.textContent = `${b.name} (${others} autre${others > 1 ? 's' : ''} membre${others > 1 ? 's' : ''})`;
          ul.append(li);
        }
        warning.append(p, ul);
      }
      const password = makeField({ name: 'password', label: 'Mot de passe', type: 'password', autocomplete: 'current-password' });
      // Tab depuis le titre mène droit au champ : l'avertissement doit y être rattaché pour ne pas être sauté.
      password.described.push(warning.id);
      password.input.setAttribute('aria-describedby', warning.id);
      const { form, actions } = makeForm({
        fields: [password], submitLabel: 'Supprimer définitivement mon compte', submitClass: 'btn-danger', busyMessage: 'Suppression du compte…',
        validate: v => clean({ password: v.password ? null : 'Saisissez votre mot de passe pour confirmer.' }),
        send: v => api.deleteMe({ password: v.password }),
        done: () => clearSessionAndClose('Votre compte a été supprimé.', { removed: true })
      });
      actions.append(button('Annuler', () => showAccount('delete')));
      root.append(warning, form);
      return heading;
    });
  }

  /* ---- Choix de la vue ---- */

  show('Mon compte', root => {
    const p = document.createElement('p');
    p.setAttribute('role', 'status');
    p.textContent = 'Chargement du compte…';
    root.append(p);
    return heading;
  });
  account.whenReady().then(() => {
    if (el.open) showAccount();
  });
  return el;
}

function download(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'baro-export.json';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}
