/*
 * Formulaires partagés par le dialogue « Mon compte » et le dialogue de partage : champs avec erreur reliée, envoi, messages.
 * La connexion et l'inscription sont dans js/connexion.js, servi aussi sans session.
 */
import { announce } from '../a11y/announcer.js';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
const FIELD_OF_CODE = {
  invalid_email: 'email', email_taken: 'email', invalid_password: 'password', invalid_display_name: 'displayName',
  wrong_password: 'password', bad_credentials: 'password'
};

let nextField = 0;

export function makeField({ name, label, type = 'text', autocomplete, hint, value = '' }) {
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
  // Le formulaire reste en noValidate : c'est l'état « obligatoire » qui est exposé, pas la bulle du navigateur.
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
  }
  // Pas de role="alert" : le focus va au champ, qui lit l'erreur par aria-describedby. Une alerte en plus la ferait lire deux fois.
  const error = document.createElement('p');
  error.id = `${id}-error`;
  error.className = 'field-error';
  error.hidden = true;
  wrap.append(error);
  if (described.length) input.setAttribute('aria-describedby', described.join(' '));
  return { wrap, input, error, described, name };
}

export function setFieldError(field, message) {
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

export function formMessage() {
  const p = document.createElement('p');
  p.className = 'account-message';
  p.tabIndex = -1;
  p.hidden = true;
  return p;
}

export function setMessage(p, message, tone = 'error', { alert = true } = {}) {
  // Une alerte pour un échec, lue d'elle-même : l'appelant n'a pas à l'annoncer une seconde fois.
  if (message && tone === 'error' && alert) p.setAttribute('role', 'alert');
  else p.removeAttribute('role');
  p.textContent = message || '';
  p.hidden = !message;
  p.classList.toggle('is-error', tone === 'error');
  p.classList.toggle('is-success', tone === 'success');
}

/*
 * Échec affiché et focalisé : le focus le fait lire, sans alerte qui le lirait une seconde fois.
 * Déjà focalisé, le focus ne bouge pas et ne lirait rien : le message est alors annoncé.
 */
export function focusMessage(p, message) {
  setMessage(p, message, 'error', { alert: false });
  if (document.activeElement === p) announce(message);
  else p.focus();
}

/*
 * Formulaire commun : validation locale, puis envoi. Les erreurs vont au champ concerné, le focus à la première,
 * et le bouton reste focalisable pendant l'envoi (aria-disabled plutôt que disabled).
 */
export function makeForm({ fields, submitLabel, submitClass = 'btn-primary', busyMessage, validate, send, done }) {
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'account-form';
  const message = formMessage();
  form.append(message);
  if (fields.length > 1) {
    const required = document.createElement('p');
    required.className = 'field-hint';
    required.textContent = 'Tous les champs sont obligatoires.';
    form.append(required);
  }
  form.append(...fields.map(f => f.wrap));
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
    // Le focus lit l'erreur du champ ; s'il y est déjà (Entrée dans le champ), rien ne bouge : l'erreur est alors annoncée.
    if (first && document.activeElement === first.input) announce(errors[first.name]);
    else if (first) first.input.focus();
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
        focusMessage(message, err.message);
      }
    } finally {
      busy = false;
      submit.removeAttribute('aria-disabled');
    }
  });
  return { form, message, actions };
}

export const checkEmail = v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'Saisissez une adresse e-mail valide, par exemple nom@exemple.fr.');
export const checkNewPassword = v => ([...v].length >= PASSWORD_MIN && [...v].length <= PASSWORD_MAX ? null : `Le mot de passe doit contenir de ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`);
export const checkName = v => (v.trim() && [...v.trim()].length <= 50 ? null : 'Le nom affiché doit contenir de 1 à 50 caractères.');
export const clean = errors => Object.fromEntries(Object.entries(errors).filter(([, v]) => v));

export function button(label, run, className) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', run);
  return b;
}

export function privacyHint({ age = false } = {}) {
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  if (age) hint.append('Réservé aux personnes de 15 ans et plus. Consultez la page ');
  else hint.append('Consultez la page ');
  const link = document.createElement('a');
  link.href = 'confidentialite.html';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Confidentialité (nouvel onglet)';
  hint.append(link, ' pour savoir quelles données Baro conserve.');
  return hint;
}
