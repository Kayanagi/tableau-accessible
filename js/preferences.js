const KEY = 'tableau-accessible-prefs';
const THEME_KEY = 'tableau-accessible-theme';
const DEFAULTS = { grid: true, reduceMotion: false, singleKey: true, storeOnCreate: true };
export const THEMES = {
  auto: { name: 'Automatique', hint: 'système', colors: ['#f7f7fb', '#12101f', '#6c4bff'] },
  light: { name: 'Clair', colors: ['#f7f7fb', '#ecebf8', '#4a2fcc'] },
  dark: { name: 'Sombre', colors: ['#12101f', '#1d1a33', '#6c4bff'] },
  'high-contrast': { name: 'Contraste élevé', colors: ['#000000', '#ffffff', '#ffff00'] }
};

let prefs = { ...DEFAULTS };
let theme = 'auto';
const listeners = new Set();

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
}

function apply() {
  const html = document.documentElement;
  if (theme === 'auto') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', theme);
  html.toggleAttribute('data-no-grid', !prefs.grid);
  html.toggleAttribute('data-reduce-motion', prefs.reduceMotion);
}

export function load() {
  try { prefs = { ...DEFAULTS, ...JSON.parse(read(KEY) || '{}') }; } catch { prefs = { ...DEFAULTS }; }
  const saved = read(THEME_KEY);
  theme = THEMES[saved] ? saved : 'auto';
  apply();
}

export function getPref(name) {
  return prefs[name];
}

export function setPref(name, value) {
  prefs[name] = value;
  write(KEY, JSON.stringify(prefs));
  apply();
  for (const fn of listeners) fn();
}

export function getTheme() {
  return theme;
}

export function setTheme(id) {
  if (!THEMES[id]) return;
  theme = id;
  write(THEME_KEY, id);
  apply();
  for (const fn of listeners) fn();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reducedMotion() {
  return prefs.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
