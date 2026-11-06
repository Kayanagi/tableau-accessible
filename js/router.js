let currentRoute = { view: 'accueil', boardId: null };
const listeners = new Set();

function parseRoute(path) {
  if (!path || !path.startsWith('/')) {
    return { view: 'accueil', boardId: null };
  }
  const spaceMatch = path.match(/^\/espace\/(.+)$/);
  if (spaceMatch) return { view: 'espace', spaceId: spaceMatch[1], boardId: null };
  const boardMatch = path.match(/^\/tableau\/(.+)$/);
  if (boardMatch) return { view: 'tableau', boardId: boardMatch[1] };
  if (path === '/favoris') return { view: 'favoris', boardId: null };
  if (path === '/parcourir') return { view: 'parcourir', boardId: null };
  if (path === '/compte') return { view: 'compte', boardId: null };
  return { view: 'accueil', boardId: null };
}

function onHashChange() {
  const hash = location.hash.slice(1) || '/';
  if (!hash.startsWith('/')) return;
  const newRoute = parseRoute(hash);
  const old = currentRoute;
  currentRoute = newRoute;
  for (const fn of listeners) {
    try { fn(currentRoute, old); } catch (e) { console.error(e); }
  }
}

export function init() {
  const hash = location.hash.slice(1) || '/';
  currentRoute = parseRoute(hash);
  window.addEventListener('hashchange', onHashChange);
  for (const fn of listeners) {
    try { fn(currentRoute, null); } catch (e) { console.error(e); }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRoute() {
  return currentRoute;
}

export function navigate(hash) {
  location.hash = hash;
}

export function isBoard() {
  return currentRoute.view === 'tableau';
}
