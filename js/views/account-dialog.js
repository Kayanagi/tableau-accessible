/*
 * Dialogue du compte : connexion, inscription, nom, mot de passe, export, déconnexion, suppression.
 * Chargé par import() dynamique à l'ouverture de #/compte : ouvrir ce dialogue n'émet aucune requête /api/
 * tant que personne n'est connecté.
 */
import * as api from '../sync/api.js';
import * as account from '../store/account.js';
import * as boards from '../store/boards.js';
import { dialog } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const FIELD_OF_CODE = {
  invalid_email: 'email', email_taken: 'email', invalid_password: 'password', invalid_display_name: 'displayName',
  wrong_password: 'password', bad_credentials: 'password'
};

let nextField = 0;
let registrationsClosed = false;

function makeField({ name, label, type = 'text', autocomplete, hint, value = '' }) {
  const id = `account-field-${++nextField}`;
  const wrap = document.createElement('div');
  wrap.className = 'field account-field';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { id, name, type, value });
  input.autocomplete = autocomplete;
  input.setAttribute('autocapitalize', 'none');
  input.spellcheck = false;
  wrap.append(lab, input);
  const described = [];
  if (hint) {
    const p = document.createElement('p');
    p.id = `${id}-hint`;
    p.className = 'field-hint';
    p.textContent = hint;
    wrap.append(p);
    described.push(p.id);
  }
  const error = document.createElement('p');
  error.id = `${id}-error`;
  error.className = 'field-error';
  error.hidden = true;
  wrap.append(error);
  if (described.length) input.setAttribute('aria-describedby', described.join(' '));
  return { wrap, input, error, described, name };
}

function setFieldError(field, message) {
  field.error.textContent = message || '';
  field.error.hidden = !message;
  if (message) {
    field.input.setAttribute('aria-invalid', 'true');
    field.input.setAttribute('aria-describedby', [...field.described, field.error.id].join(' '));
  } else {
    field.input.removeAttribute('aria-invalid');
    if (field.described.length) field.input.setAttribute('aria-describedby', field.described.join(' '));
    else field.input.removeAttribute('aria-describedby');
  }
}

function formMessage() {
  const p = document.createElement('p');
  p.className = 'account-message';
  p.tabIndex = -1;
  p.hidden = true;
  return p;
}

function setMessage(p, message, tone = 'error') {
  p.textContent = message || '';
  p.hidden = !message;
  p.classList.toggle('is-error', tone === 'error');
  p.classList.toggle('is-success', tone === 'success');
}

/*
 * Formulaire commun : validation locale, puis envoi. Les erreurs vont au champ concerné, le focus à la première,
 * et le bouton reste focalisable pendant l'envoi (aria-disabled plutôt que disabled).
 */
function makeForm({ fields, submitLabel, submitClass = 'btn-primary', busyMessage, validate, send, done }) {
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'account-form';
  const message = formMessage();
  form.append(message, ...fields.map(f => f.wrap));
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = submitClass;
  submit.textContent = submitLabel;
  actions.append(submit);
  form.append(actions);

  let busy = false;
  const showErrors = errors => {
    fields.forEach(f => setFieldError(f, errors[f.name]));
    const first = fields.find(f => errors[f.name]);
    if (first) { first.input.focus(); announce(errors[first.name]); }
    return !!first;
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    setMessage(message, '');
    const values = Object.fromEntries(fields.map(f => [f.name, f.input.value]));
    if (showErrors(validate(values) || {})) return;
    busy = true;
    submit.setAttribute('aria-disabled', 'true');
    announce(busyMessage);
    try {
      await done(await send(values), { form, message, fields });
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      const fieldName = FIELD_OF_CODE[err.code] || err.path;
      if (!fields.some(f => f.name === fieldName) || !showErrors({ [fieldName]: err.message })) {
        setMessage(message, err.message);
        message.focus();
        announce(err.message);
      }
    } finally {
      busy = false;
      submit.removeAttribute('aria-disabled');
    }
  });
  return { form, message, actions };
}

const checkEmail = v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'Saisissez une adresse e-mail valide, par exemple nom@exemple.fr.');
const checkNewPassword = v => ([...v].length >= PASSWORD_MIN && [...v].length <= PASSWORD_MAX ? null : `Le mot de passe doit contenir de ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`);
const checkName = v => (v.trim() && [...v.trim()].length <= 50 ? null : 'Le nom affiché doit contenir de 1 à 50 caractères.');
const clean = errors => Object.fromEntries(Object.entries(errors).filter(([, v]) => v));

function button(label, run, className) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', run);
  return b;
}

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

  const show = (title, build, focusTarget) => {
    heading.textContent = title;
    body.replaceChildren();
    const target = build(body);
    (focusTarget || target || heading).focus();
  };

  /* ---- Sans session ---- */

  function showLogin(notice) {
    show('Se connecter', root => {
      const email = makeField({ name: 'email', label: 'Adresse e-mail', type: 'email', autocomplete: 'email' });
      const password = makeField({ name: 'password', label: 'Mot de passe', type: 'password', autocomplete: 'current-password' });
      const { form, message } = makeForm({
        fields: [email, password], submitLabel: 'Se connecter', busyMessage: 'Connexion en cours…',
        validate: v => clean({ email: checkEmail(v.email), password: v.password ? null : 'Saisissez votre mot de passe.' }),
        send: v => api.login({ email: v.email.trim(), password: v.password }),
        done: async res => { await account.signedIn(res.user); announce(`Connecté en tant que ${res.user.displayName}`); showAccount(); }
      });
      root.append(form);
      if (notice) setMessage(message, notice);
      if (!registrationsClosed) {
        const other = document.createElement('p');
        other.className = 'account-switch';
        other.append('Pas encore de compte ? ', button('Créer un compte', showRegister));
        root.append(other);
      }
      const help = document.createElement('p');
      help.className = 'field-hint';
      help.textContent = 'Le compte est facultatif : sans compte, vos tableaux restent sur cet appareil.';
      root.append(help);
      if (notice) { announce(notice); return message; }
      return email.input;
    });
  }

  function showRegister() {
    show('Créer un compte', root => {
      const name = makeField({ name: 'displayName', label: 'Nom affiché', autocomplete: 'name' });
      const email = makeField({ name: 'email', label: 'Adresse e-mail', type: 'email', autocomplete: 'email' });
      const password = makeField({ name: 'password', label: 'Mot de passe', type: 'password', autocomplete: 'new-password', hint: `De ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères, sans autre règle. Le collage et les gestionnaires de mots de passe sont permis.` });
      const { form } = makeForm({
        fields: [name, email, password], submitLabel: 'Créer mon compte', busyMessage: 'Création du compte en cours…',
        validate: v => clean({ displayName: checkName(v.displayName), email: checkEmail(v.email), password: checkNewPassword(v.password) }),
        send: async v => {
          try {
            return await api.register({ email: v.email.trim(), password: v.password, displayName: v.displayName.trim() });
          } catch (err) {
            if (err.code !== 'registrations_closed') throw err;
            registrationsClosed = true;
            showLogin(err.message);
            return null;
          }
        },
        done: async res => {
          if (!res) return;
          await account.signedIn(res.user);
          announce('Compte créé. Vous êtes connecté.');
          showAccount();
        }
      });
      const other = document.createElement('p');
      other.className = 'account-switch';
      other.append('Déjà un compte ? ', button('Se connecter', () => showLogin()));
      root.append(form, other);
      return name.input;
    });
  }

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

  function showAccount() {
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
          announce(err.message);
        }
      });
      const dataHint = document.createElement('p');
      dataHint.className = 'field-hint';
      dataHint.textContent = 'Un fichier JSON avec votre compte et les tableaux dont vous êtes propriétaire.';
      section(root, 'Mes données', dataHint, dataMessage, exportBtn);

      const leaveMessage = formMessage();
      section(root, 'Session', leaveMessage, button('Se déconnecter', () => startLogout(leaveMessage)));
      section(root, 'Supprimer le compte', button('Supprimer mon compte…', showDelete, 'btn-danger'));
      return heading;
    });
  }

  function showUnreachable() {
    show('Mon compte', root => {
      const p = document.createElement('p');
      p.className = 'account-message is-error';
      p.textContent = 'Serveur injoignable : votre compte n’est pas disponible pour le moment. Les tableaux de cet appareil restent utilisables.';
      root.append(p, button('Réessayer', async () => {
        announce('Nouvelle tentative…');
        account.start();
        await account.whenReady();
        if (account.getUser()) showAccount();
        else if (account.hasSession()) { showUnreachable(); announce('Serveur toujours injoignable'); }
        else showLogin();
      }));
      return heading;
    });
  }

  function clearSessionAndClose(message) {
    account.signedOut();
    el.close();
    announce(message);
  }

  async function startLogout(message) {
    announce('Déconnexion en cours…');
    const remote = boards.remoteStore();
    await remote?.flushAll();
    const waiting = remote?.pending() || [];
    if (waiting.length) { showLogoutWarning(waiting); return; }
    await logoutNow(message);
  }

  async function logoutNow(message) {
    try {
      await api.logout();
    } catch (err) {
      if (err.name !== 'ApiError') throw err;
      if (err.status !== 401) {
        setMessage(message, err.message);
        message.focus();
        announce(err.message);
        return;
      }
    }
    clearSessionAndClose('Vous êtes déconnecté.');
  }

  function showLogoutWarning(waiting) {
    show('Modifications non envoyées', root => {
      const intro = document.createElement('p');
      intro.textContent = 'Ces tableaux ont des modifications qui n’ont pas pu être envoyées. La déconnexion efface les données du compte sur cet appareil :';
      const ul = document.createElement('ul');
      for (const e of waiting) { const li = document.createElement('li'); li.textContent = e.nom; ul.append(li); }
      const message = formMessage();
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      actions.append(
        button('Garder des copies locales et me déconnecter', async () => {
          const remote = boards.remoteStore();
          for (const e of waiting) {
            if (!(await remote.keepLocalCopy(e.id))) {
              setMessage(message, 'Stockage plein : les copies locales n’ont pas pu être créées. Vous restez connecté.');
              message.focus();
              announce(message.textContent);
              return;
            }
          }
          await logoutNow(message);
        }, 'btn-primary'),
        button('Me déconnecter sans les garder', () => logoutNow(message), 'btn-danger'),
        button('Annuler', showAccount)
      );
      root.append(intro, ul, message, actions);
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
    show('Supprimer le compte', root => {
      if (failure) {
        // L'avertissement est obligatoire : sans la liste des tableaux, pas de suppression possible.
        const p = document.createElement('p');
        p.className = 'account-message is-error';
        p.textContent = `Impossible de vérifier vos tableaux : ${failure}`;
        const actions = document.createElement('div');
        actions.className = 'dialog-actions';
        actions.append(button('Réessayer', showDelete, 'btn-primary'), button('Annuler', showAccount));
        root.append(p, actions);
        return heading;
      }
      const owned = rows.filter(b => b.role === 'owner');
      const shared = owned.filter(b => b.memberCount > 1);
      const warning = document.createElement('div');
      warning.className = 'account-warning';
      const intro = document.createElement('p');
      intro.textContent = `Cette suppression est définitive. Votre compte et ${owned.length === 0 ? 'vos données seront effacés' : owned.length === 1 ? 'votre tableau enregistré sur le compte seront effacés' : `vos ${owned.length} tableaux enregistrés sur le compte seront effacés`}. Les tableaux restés sur cet appareil ne sont pas touchés.`;
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
      const { form, actions } = makeForm({
        fields: [password], submitLabel: 'Supprimer définitivement mon compte', submitClass: 'btn-danger', busyMessage: 'Suppression du compte…',
        validate: v => clean({ password: v.password ? null : 'Saisissez votre mot de passe pour confirmer.' }),
        send: v => api.deleteMe({ password: v.password }),
        done: () => clearSessionAndClose('Votre compte a été supprimé.')
      });
      actions.append(button('Annuler', showAccount));
      root.append(warning, form);
      return heading;
    });
  }

  /* ---- Choix de la vue ---- */

  if (!account.hasSession()) {
    showLogin();
  } else {
    show('Mon compte', root => {
      const p = document.createElement('p');
      p.setAttribute('role', 'status');
      p.textContent = 'Chargement du compte…';
      root.append(p);
      return heading;
    });
    account.whenReady().then(() => {
      if (!el.open) return;
      if (!account.hasSession()) showLogin();
      else showAccount();
    });
  }
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
