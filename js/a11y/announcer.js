let region = null;

export function init() {
  region = document.getElementById('announcer');
}

export function announce(message) {
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}
