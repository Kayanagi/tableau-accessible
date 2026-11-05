let region = null;

export function init() {
  region = document.getElementById('announcer');
}

function currentTarget() {
  const modal = [...document.querySelectorAll('dialog[open]')].filter(el => el.matches(':modal')).pop();
  if (!modal) return region;
  let target = modal.querySelector('[data-announcer]');
  if (!target) {
    target = document.createElement('div');
    target.className = 'sr-only';
    target.dataset.announcer = '';
    target.setAttribute('aria-live', 'polite');
    target.setAttribute('aria-atomic', 'true');
    modal.append(target);
  }
  return target;
}

export function announce(message) {
  const before = currentTarget();
  if (before) before.textContent = '';
  // Résolu après le rendu : un dialogue qui se ferme juste après l'annonce ne doit pas l'emporter avec lui.
  requestAnimationFrame(() => {
    const target = currentTarget();
    if (target) target.textContent = message;
  });
}
