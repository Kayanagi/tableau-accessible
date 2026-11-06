/*
 * Messages visibles en haut de page, hors dialogue : rien ne se ferme tout seul et rien ne prend le focus.
 * L'annonce vocale reste à la charge de l'appelant (announcer), pour éviter de lire deux fois.
 */
const notices = new Map();

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
  clearNotice(key);
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
  close.addEventListener('click', () => {
    const next = el.nextElementSibling?.querySelector('button') || el.previousElementSibling?.querySelector('button') || document.getElementById('dashboard-title') || document.getElementById('board-title');
    clearNotice(key);
    next?.focus();
  });
  buttons.append(close);
  el.append(buttons);
  zone().append(el);
  notices.set(key, el);
}

export function clearNotice(key) {
  notices.get(key)?.remove();
  notices.delete(key);
}
