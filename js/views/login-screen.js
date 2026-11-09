/*
 * Écran de connexion dans l'application : session expirée en cours d'usage, ou serveur sans page de connexion devant lui.
 * Le formulaire est celui de la page autonome (js/connexion.js). Après la connexion, l'application reprend d'elle-même à la route demandée (voir app.js).
 */
import { announce } from '../a11y/announcer.js';
import * as account from '../store/account.js';
import { mountAuth } from '../connexion.js';
import { privacyHint } from './account-forms.js';

let root = null;
let body = null;
let auth = null;
let currentNotice = null;
let retryButton = null;
let retrying = false;

export function isShown() {
  return !!root && !!body?.isConnected;
}

/* Le même bouton reste d'une tentative à l'autre : le remplacer ferait perdre le focus à qui vient de l'activer. */
function setRetry(run) {
  if (!run) {
    if (retryButton?.contains(document.activeElement)) document.getElementById('login-title')?.focus();
    retryButton?.remove();
    retryButton = null;
    return;
  }
  if (!retryButton) {
    retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'login-retry';
    retryButton.textContent = 'Réessayer';
    retryButton.addEventListener('click', () => {
      retrying = true;
      announce('Nouvelle tentative…');
      retryButton.run();
    });
    body.parentElement.insertBefore(retryButton, body);
  }
  retryButton.run = run;
}

/* notice : message à faire lire en arrivant (session expirée, serveur injoignable). */
export function show(el, { notice = null, retry = null } = {}) {
  root = el;
  root.replaceChildren();
  root.hidden = false;
  const main = document.createElement('main');
  main.id = 'main-content';
  main.className = 'login-screen';
  main.tabIndex = -1;
  const card = document.createElement('div');
  card.className = 'login-card';
  const brand = document.createElement('p');
  brand.className = 'login-brand';
  brand.textContent = 'Baro, le tableau blanc accessible';
  const title = document.createElement('h1');
  title.id = 'login-title';
  title.tabIndex = -1;
  body = document.createElement('div');
  body.className = 'account-body';
  const foot = document.createElement('footer');
  foot.className = 'login-footer';
  foot.append(privacyHint({ age: true }));
  card.append(brand, title, body, foot);
  main.append(card);
  root.append(main);
  currentNotice = notice;
  auth = mountAuth({
    title, body, notice, announce,
    onSignedIn: async user => {
      await account.signedIn(user);
      announce(`Connecté en tant que ${user.displayName}`);
    }
  });
  retrying = false;
  setRetry(retry);
}

/* L'état change alors que l'écran est là : la saisie en cours et le focus ne bougent pas. */
export function update({ notice = null, retry = null } = {}) {
  if (!isShown()) return;
  if (notice !== currentNotice) {
    currentNotice = notice;
    auth.setNotice(notice);
  } else if (retrying && notice) {
    // Nouvelle tentative, même échec : le message affiché ne change pas, il faut donc le redire.
    announce(notice);
  }
  retrying = false;
  setRetry(retry);
}

export function hide(el) {
  el.replaceChildren();
  el.hidden = true;
  root = body = auth = retryButton = null;
  currentNotice = null;
  retrying = false;
}
