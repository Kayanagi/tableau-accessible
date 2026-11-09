/*
 * Connexion et création de compte. Aucun import : ce fichier est servi sans session, avec connexion.html et
 * css/connexion.css, alors que le reste de js/ ne l'est pas. L'application le réutilise pour l'écran de session expirée
 * (views/login-screen.js) : le formulaire n'existe qu'ici.
 */
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const TIMEOUT_MS = 30000;
const UNREACHABLE = 'Serveur injoignable. Vérifiez votre connexion ou réessayez plus tard.';
const RESET_SENT = 'Si un compte existe pour cette adresse, un e-mail vient de partir. Le lien est valable une heure. Pensez à vérifier les indésirables.';
export const FORGOT_HASH = '#mot-de-passe-oublie';
const FIELD_OF_CODE = { invalid_email: 'email', email_taken: 'email', invalid_password: 'password', invalid_display_name: 'displayName', bad_credentials: 'password' };

let nextField = 0;
let registrationsClosed = false;

/* Toute écriture porte Content-Type: application/json (garde CSRF du serveur). */
async function post(path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw { message: UNREACHABLE };
  }
  const json = await res.json().catch(() => null);
  if (res.ok && json) return json;
  if (json?.code) throw { code: json.code, message: json.message, path: json.path };
  throw { message: [502, 503, 504].includes(res.status) || res.ok ? UNREACHABLE : `Le serveur a refusé la requête (erreur ${res.status}).` };
}

function makeField({ name, label, type = 'text', autocomplete, hint }) {
  const id = `account-field-login-${++nextField}`;
  const wrap = document.createElement('div');
  wrap.className = 'field account-field';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { id, name, type });
  input.autocomplete = autocomplete;
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

/* focused : le message reçoit le focus, qui le fait lire ; une alerte en plus le ferait lire deux fois. */
function setMessage(p, message, focused = false) {
  if (message && !focused) p.setAttribute('role', 'alert');
  else p.removeAttribute('role');
  p.textContent = message || '';
  p.hidden = !message;
  p.classList.toggle('is-error', !!message);
}

/* Validation locale puis envoi. Les erreurs vont au champ concerné, le focus à la première ; le bouton reste focalisable pendant l'envoi. */
function makeForm({ fields, submitLabel, busyMessage, validate, send, done, announce }) {
  const form = document.createElement('form');
  form.noValidate = true;
  form.className = 'account-form';
  const message = document.createElement('p');
  message.className = 'account-message';
  message.tabIndex = -1;
  message.hidden = true;
  const required = document.createElement('p');
  required.className = 'field-hint';
  required.textContent = 'Tous les champs sont obligatoires.';
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-primary';
  submit.textContent = submitLabel;
  actions.append(submit);
  // Un seul champ : la mention « tous obligatoires » n'apprendrait rien.
  form.append(message, ...(fields.length > 1 ? [required] : []), ...fields.map(f => f.wrap), actions);

  let busy = false;
  // Le focus lit l'erreur du champ ; s'il y est déjà (Entrée dans le champ), rien ne bouge : l'erreur est alors annoncée.
  const showErrors = errors => {
    fields.forEach(f => setFieldError(f, errors[f.name]));
    const first = fields.find(f => errors[f.name]);
    if (first && document.activeElement === first.input) announce(errors[first.name]);
    else first?.input.focus();
    return !!first;
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    setMessage(message, '');
    const values = Object.fromEntries(fields.map(f => [f.name, f.input.value]));
    if (showErrors(validate(values))) return;
    busy = true;
    submit.setAttribute('aria-disabled', 'true');
    announce(busyMessage);
    try {
      await done(await send(values));
    } catch (err) {
      if (!err || typeof err.message !== 'string') throw err;
      const fieldName = FIELD_OF_CODE[err.code] || err.path;
      if (!fields.some(f => f.name === fieldName) || !showErrors({ [fieldName]: err.message })) {
        setMessage(message, err.message, true);
        if (document.activeElement === message) announce(err.message);
        else message.focus();
      }
    } finally {
      busy = false;
      submit.removeAttribute('aria-disabled');
    }
  });
  return { form, message, actions };
}

const checkEmail = v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'Saisissez une adresse e-mail valide, par exemple nom@exemple.fr.');
const clean = errors => Object.fromEntries(Object.entries(errors).filter(([, v]) => v));

function switchLine(text, label, run) {
  const p = document.createElement('p');
  p.className = 'account-switch';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', run);
  p.append(text, b);
  return p;
}

/*
 * Monte le formulaire dans body, sous le titre title. onSignedIn(user) reçoit le compte une fois le serveur d'accord.
 * Rend setNotice(message) : un message de plus (session expirée, serveur injoignable) sans toucher à la saisie.
 * forgot : ouvrir directement « Mot de passe oublié » (lien « refaire une demande » de reinitialiser.html).
 */
export function mountAuth({ title, body, announce, onSignedIn, notice = null, forgot = false }) {
  let current = null;

  function showLogin(text) {
    title.textContent = 'Se connecter';
    body.replaceChildren();
    const email = makeField({ name: 'email', label: 'Adresse e-mail', type: 'email', autocomplete: 'username' });
    const password = makeField({ name: 'password', label: 'Mot de passe', type: 'password', autocomplete: 'current-password' });
    const { form, message } = makeForm({
      announce,
      fields: [email, password], submitLabel: 'Se connecter', busyMessage: 'Connexion en cours…',
      validate: v => clean({ email: checkEmail(v.email), password: v.password ? null : 'Saisissez votre mot de passe.' }),
      send: v => post('/auth/login', { email: v.email.trim(), password: v.password }),
      done: res => onSignedIn(res.user)
    });
    body.append(form, switchLine('', 'Mot de passe oublié ?', () => showForgot(email.input.value)));
    if (!registrationsClosed) body.append(switchLine('Pas encore de compte ? ', 'Créer un compte', showRegister));
    current = message;
    if (text) { setMessage(message, text, true); message.focus(); }
    else email.input.focus();
  }

  function showRegister() {
    title.textContent = 'Créer un compte';
    body.replaceChildren();
    current = null;
    const name = makeField({ name: 'displayName', label: 'Nom affiché', autocomplete: 'name' });
    const email = makeField({ name: 'email', label: 'Adresse e-mail', type: 'email', autocomplete: 'username' });
    const password = makeField({ name: 'password', label: 'Mot de passe', type: 'password', autocomplete: 'new-password', hint: `De ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères, sans autre règle. Le collage et les gestionnaires de mots de passe sont permis.` });
    const { form, message, actions } = makeForm({
      announce,
      fields: [name, email, password], submitLabel: 'Créer mon compte', busyMessage: 'Création du compte en cours…',
      validate: v => clean({
        displayName: v.displayName.trim() && [...v.displayName.trim()].length <= 50 ? null : 'Le nom affiché doit contenir de 1 à 50 caractères.',
        email: checkEmail(v.email),
        password: [...v.password].length >= PASSWORD_MIN && [...v.password].length <= PASSWORD_MAX ? null : `Le mot de passe doit contenir de ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`
      }),
      send: async v => {
        try {
          return await post('/auth/register', { email: v.email.trim(), password: v.password, displayName: v.displayName.trim() });
        } catch (err) {
          if (err?.code !== 'registrations_closed') throw err;
          registrationsClosed = true;
          showLogin(err.message);
          return null;
        }
      },
      done: res => (res ? onSignedIn(res.user) : undefined)
    });
    const age = document.createElement('p');
    age.className = 'field-hint';
    age.textContent = 'En créant un compte, vous confirmez avoir 15 ans ou plus. La page Confidentialité, en bas de cet écran, dit quelles données Baro conserve.';
    form.insertBefore(age, actions);
    body.append(form, switchLine('Déjà un compte ? ', 'Se connecter', () => { showLogin(); announce('Se connecter'); }));
    current = message;
    name.input.focus();
    announce('Créer un compte');
  }

  /* La réponse est la même que l'adresse ait un compte ou non : rien ne dit ici quels comptes existent. */
  function showForgot(prefill = '') {
    title.textContent = 'Mot de passe oublié';
    body.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'field-hint account-intro';
    intro.textContent = 'Saisissez l’adresse e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.';
    const email = makeField({ name: 'email', label: 'Adresse e-mail', type: 'email', autocomplete: 'email' });
    email.input.value = prefill.trim();
    const { form, message } = makeForm({
      announce,
      fields: [email], submitLabel: 'Envoyer le lien', busyMessage: 'Envoi de la demande…',
      validate: v => clean({ email: checkEmail(v.email) }),
      send: v => post('/auth/password-reset', { email: v.email.trim() }),
      done: () => showForgotSent()
    });
    body.append(intro, form, switchLine('', 'Retour à la connexion', () => { showLogin(); announce('Se connecter'); }));
    current = message;
    email.input.focus();
    announce('Mot de passe oublié');
  }

  function showForgotSent() {
    title.textContent = 'Vérifiez vos e-mails';
    body.replaceChildren();
    const sent = document.createElement('p');
    sent.className = 'account-message is-success';
    sent.tabIndex = -1;
    sent.textContent = RESET_SENT;
    const help = document.createElement('p');
    help.className = 'field-hint';
    help.append('Rien reçu ? Vous pouvez refaire une demande dans quelques minutes, ou écrire à ');
    const mail = document.createElement('a');
    mail.href = 'mailto:rgpd@dwes.fr';
    mail.textContent = 'rgpd@dwes.fr';
    help.append(mail, '.');
    body.append(sent, help, switchLine('', 'Retour à la connexion', () => { showLogin(); announce('Se connecter'); }));
    current = null;
    // Le focus fait lire le message : pas d'alerte en plus, qui le lirait deux fois.
    sent.focus();
  }

  if (forgot) showForgot();
  else showLogin(notice);
  return {
    setNotice(text) { if (current) setMessage(current, text); }
  };
}

/* ---- Page autonome ---- */

const page = document.getElementById('login-body');
if (page && !document.getElementById('app-gate')) startPage();

const UNAVAILABLE = 'Baro est momentanément indisponible. Vos données ne sont pas perdues. Réessayez dans un instant.';
const RELOAD_KEY = 'tableau-accessible-connexion-recharge';
const RELOAD_WINDOW_MS = 15000;

/* Au plus un rechargement automatique : si la page revient aussitôt malgré une session valide, on ne boucle pas. */
function mayReload() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (last && Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    // Sans stockage, impossible de compter les rechargements : ne pas en risquer un seul.
    return false;
  }
}

function startPage() {
  // Même choix de thème que l'application, sans dépendre de ses modules.
  try {
    const theme = localStorage.getItem('tableau-accessible-theme');
    if (['light', 'dark', 'high-contrast'].includes(theme)) document.documentElement.setAttribute('data-theme', theme);
  } catch { /* stockage indisponible : le thème du système s'applique */ }

  // Lien « refaire une demande » de reinitialiser.html : le formulaire s'ouvre, l'adresse n'en garde rien.
  const forgot = location.hash === FORGOT_HASH;
  if (forgot) history.replaceState(null, '', location.pathname + location.search);

  const region = document.getElementById('announcer');
  const announce = text => { region.textContent = ''; setTimeout(() => { region.textContent = text; }, 50); };
  const title = document.getElementById('login-title');
  // nginx sert cette page à la place de l'adresse demandée : recharger y mène, hash compris. Ouverte directement, elle renvoie à l'accueil.
  const enter = () => {
    if (/\/connexion\.html$/.test(location.pathname)) location.replace(`/${location.hash}`);
    else location.reload();
  };

  function showUnavailable(focusRetry) {
    title.textContent = 'Baro est indisponible';
    page.replaceChildren();
    const message = document.createElement('p');
    message.className = 'account-message is-error';
    message.setAttribute('role', 'alert');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Réessayer';
    retry.addEventListener('click', () => check(true));
    page.append(message, retry);
    message.textContent = UNAVAILABLE;
    if (focusRetry) retry.focus();
  }

  /* 204 : session valide, cette page n'aurait pas dû être servie. 401 : le formulaire. Tout le reste : Baro est indisponible. */
  async function check(fromRetry = false) {
    // « Réessayer » va disparaître : le focus attend sur le titre plutôt que de retomber sur la page.
    if (fromRetry) title.focus();
    page.replaceChildren();
    const waiting = document.createElement('p');
    waiting.setAttribute('role', 'status');
    waiting.textContent = 'Vérification de la session…';
    page.append(waiting);
    let status = 0;
    try {
      status = (await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })).status;
    } catch { /* coupure réseau : même message qu'un serveur arrêté */ }
    if (status === 401) {
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* rien à retirer */ }
      mountAuth({ title, body: page, announce, onSignedIn: enter, forgot });
      return;
    }
    if (status === 204 && (fromRetry || mayReload())) { enter(); return; }
    showUnavailable(fromRetry);
  }

  check();
}
