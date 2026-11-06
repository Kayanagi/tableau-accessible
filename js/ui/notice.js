/*
 * Messages visibles en haut de page, hors dialogue : rien ne se ferme tout seul et rien ne prend le focus,
 * sauf pour le rendre quand le message qui l'avait disparaît.
 * L'annonce vocale reste à la charge de l'appelant (announcer), pour éviter de lire deux fois.
 */
const notices = new Map();

/* Où aller quand le message qui a le focus disparaît : le message voisin, sinon le titre de la vue. */
function focusAfter(el) {
  return el.nextElementSibling?.querySelector('button') || el.previousElementSibling?.querySelector('button') || document.getElementById('dashboard-title') || document.getElementById('board-title');
}

function zone() {
  let el = document.getElementById('app-notices');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-notices';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Messages de l’application');
    document.querySelector('.skip-link')?.after(el);
  }
  return el;
}

/* Une clé identifie le sujet : un nouveau message remplace le précédent au lieu de s'empiler. */
export function showNotice(key, message, { tone = 'info', actions = [] } = {}) {
  // Même sujet, nouveau texte : le focus reste dans le message s'il y était, pour ne jamais retomber sur la page.
  const previous = notices.get(key);
  const hadFocus = !!previous?.contains(document.activeElement);
  previous?.remove();
  notices.delete(key);
  const el = document.createElement('div');
  el.className = `notice notice-${tone}`;
  el.dataset.notice = key;
  const text = document.createElement('p');
  text.textContent = message;
  el.append(text);
  const buttons = document.createElement('div');
  buttons.className = 'notice-actions';
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => { clearNotice(key); action.run(); });
    buttons.append(button);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Fermer';
  close.setAttribute('aria-label', `Fermer le message : ${message}`);
  close.addEventListener('click', () => clearNotice(key));
  buttons.append(close);
  el.append(buttons);
  zone().append(el);
  notices.set(key, el);
  if (hadFocus) close.focus();
}

export function clearNotice(key) {
  const el = notices.get(key);
  if (!el) return;
  const next = el.contains(document.activeElement) ? focusAfter(el) : null;
  el.remove();
  notices.delete(key);
  next?.focus();
}
