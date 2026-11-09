/*
 * Page publique « Choisir un nouveau mot de passe », ouverte depuis le lien reçu par e-mail
 * (reinitialiser.html#jeton=…). Aucun import : servie sans session, avec reinitialiser.html et css/connexion.css.
 *
 * Le jeton est lu dans le fragment, qui n'est jamais envoyé au serveur, puis retiré aussitôt de la barre d'adresse et
 * de l'historique. Il ne vit plus qu'en mémoire, n'est jamais écrit dans la console ni le stockage, et part seulement
 * dans le corps de la confirmation.
 */
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const TIMEOUT_MS = 30000;
const UNREACHABLE = 'Serveur injoignable. Vérifiez votre connexion ou réessayez plus tard.';
const FORGOT_URL = '/connexion.html#mot-de-passe-oublie';

let token = readToken();

function readToken() {
  const match = /^#jeton=([A-Za-z0-9_-]{16,128})$/.exec(location.hash);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return match ? match[1] : null;
}

const title = document.getElementById('reset-title');
const body = document.getElementById('reset-body');
const region = document.getElementById('announcer');
// Une annonce remplace celle qui attend encore ; announce('') fait taire la dernière.
let pending = 0;
const announce = text => {
  clearTimeout(pending);
  region.textContent = '';
  if (text) pending = setTimeout(() => { region.textContent = text; }, 50);
};

// Même choix de thème que l'application, sans dépendre de ses modules.
try {
  const theme = localStorage.getItem('tableau-accessible-theme');
  if (['light', 'dark', 'high-contrast'].includes(theme)) document.documentElement.setAttribute('data-theme', theme);
} catch { /* stockage indisponible : le thème du système s'applique */ }

/* 204 rend null. Une erreur de l'API rend { code, message, path } ; une coupure, le seul message. */
async function post(path, payload) {
  let res;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw { message: UNREACHABLE };
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (res.ok) return json;
  if (json?.code) throw { code: json.code, message: json.message, path: json.path };
  throw { message: [502, 503, 504].includes(res.status) ? UNREACHABLE : `Le serveur a refusé la requête (erreur ${res.status}).` };
}

let nextField = 0;

function makeField({ name, label, hint }) {
  const id = `reset-field-${++nextField}`;
  const wrap = document.createElement('div');
  wrap.className = 'field account-field';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { id, name, type: 'password' });
  input.autocomplete = 'new-password';
  input.setAttribute('autocapitalize', 'none');
  input.spellcheck = false;
  input.required = true;
  wrap.append(lab, input);
  const described = [];
  if (hint) {
    const p = document.createElement('p');
    p.id = `${id}-hint`;
    p.className = 'field-hint';
    p.textContent = hint;
    wrap.append(p);
    described.push(p.id);
    input.setAttribute('aria-describedby', p.id);
  }
  // Pas de role="alert" : le focus va au champ, qui lit l'erreur par aria-describedby. Une alerte en plus la ferait lire deux fois.
  const error = document.createElement('p');
  error.id = `${id}-error`;
  error.className = 'field-error';
  error.hidden = true;
  wrap.append(error);
  return { wrap, input, error, described, name };
}

function setFieldError(field, message) {
  field.error.textContent = message || '';
  field.error.hidden = !message;
  const ids = message ? [...field.described, field.error.id] : field.described;
  if (message) field.input.setAttribute('aria-invalid', 'true');
  else field.input.removeAttribute('aria-invalid');
  if (ids.length) field.input.setAttribute('aria-describedby', ids.join(' '));
  else field.input.removeAttribute('aria-describedby');
}

/* Message focalisé : le focus le fait lire, sans alerte qui le lirait une seconde fois. */
function message(text, tone) {
  const p = document.createElement('p');
  p.className = `account-message is-${tone}`;
  p.tabIndex = -1;
  p.textContent = text;
  return p;
}

function linkLine(...links) {
  const p = document.createElement('p');
  p.className = 'account-switch';
  links.forEach(([label, href], i) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (i) p.append(' · ');
    p.append(a);
  });
  return p;
}

function showView(heading, ...content) {
  title.textContent = heading;
  document.title = `${heading} — Baro, le tableau blanc accessible`;
  body.replaceChildren(...content);
}

/* Inexistant, expiré, déjà utilisé ou incomplet : la même issue, refaire une demande. */
function showInvalid(text) {
  token = null;
  const msg = message(text, 'error');
  showView('Lien non valable', msg, linkLine(['Refaire une demande', FORGOT_URL], ['Se connecter', '/']));
  msg.focus();
}

function showDone() {
  token = null;
  const msg = message('Votre mot de passe a été changé. Par sécurité, toutes vos sessions ont été fermées, sur tous vos appareils : connectez-vous avec le nouveau mot de passe.', 'success');
  showView('Mot de passe changé', msg, linkLine(['Se connecter', '/']));
  msg.focus();
}

function showForm() {
  const password = makeField({ name: 'password', label: 'Nouveau mot de passe', hint: `De ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères, sans autre règle. Le collage et les gestionnaires de mots de passe sont permis.` });
  const confirm = makeField({ name: 'confirm', label: 'Confirmer le nouveau mot de passe', hint: 'Saisissez le même mot de passe une seconde fois.' });
  const fields = [password, confirm];
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'account-form';
  const formMessage = document.createElement('p');
  formMessage.className = 'account-message is-error';
  formMessage.tabIndex = -1;
  formMessage.hidden = true;
  const required = document.createElement('p');
  required.className = 'field-hint';
  required.textContent = 'Tous les champs sont obligatoires.';
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary';
  submit.textContent = 'Enregistrer le nouveau mot de passe';
  actions.append(submit);
  form.append(formMessage, required, password.wrap, confirm.wrap, actions);

  const validate = v => {
    const length = [...v.password].length;
    const errors = {};
    if (length < PASSWORD_MIN || length > PASSWORD_MAX) errors.password = `Le mot de passe doit contenir de ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`;
    if (!v.confirm) errors.confirm = 'Saisissez une seconde fois le nouveau mot de passe.';
    else if (v.confirm !== v.password) errors.confirm = 'Les deux mots de passe ne sont pas identiques.';
    return errors;
  };

  // Le focus lit l'erreur du champ ; s'il y est déjà (Entrée dans le champ), rien ne bouge : l'erreur est alors annoncée.
  const showErrors = errors => {
    fields.forEach(f => setFieldError(f, errors[f.name]));
    const first = fields.find(f => errors[f.name]);
    if (first && document.activeElement === first.input) announce(errors[first.name]);
    else first?.input.focus();
    return !!first;
  };

  const showFormMessage = text => {
    formMessage.textContent = text;
    formMessage.hidden = false;
    if (document.activeElement === formMessage) announce(text);
    else formMessage.focus();
  };

  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || !token) return;
    formMessage.hidden = true;
    const values = { password: password.input.value, confirm: confirm.input.value };
    if (showErrors(validate(values))) return;
    busy = true;
    submit.setAttribute('aria-disabled', 'true');
    announce('Enregistrement du mot de passe…');
    try {
      // Réponse reçue : l'annonce « en cours » qui n'a pas encore été lue est retirée, sinon elle passerait après le résultat.
      await post('/auth/password-reset/confirm', { token, password: values.password }).finally(() => announce(''));
      showDone();
    } catch (err) {
      if (!err || typeof err.message !== 'string') throw err;
      if (err.code === 'invalid_token') showInvalid('Ce lien n’est plus valable : il a déjà servi, a expiré (au bout d’une heure) ou a été remplacé par une demande plus récente. Refaites une demande pour recevoir un nouveau lien.');
      else if (err.code === 'invalid_password') showErrors({ password: err.message });
      else showFormMessage(err.message);
    } finally {
      busy = false;
      submit.removeAttribute('aria-disabled');
    }
  });

  showView('Choisir un nouveau mot de passe', form);
  password.input.focus();
}

if (token) showForm();
else showInvalid('Ce lien de réinitialisation est incomplet. Ouvrez le lien reçu par e-mail tel quel, ou refaites une demande pour en recevoir un nouveau.');
