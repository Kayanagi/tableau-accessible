/*
 * Ce qu'un compte range sur cet appareil seulement, faute d'API côté serveur : espaces, place des tableaux dans
 * les espaces, favoris, « Mes modèles » et modèles récemment utilisés.
 * Une clé par compte : un autre compte connecté sur cet appareil n'y accède jamais par l'application.
 * À la déconnexion, la personne choisit de les garder ici ou de les effacer (views/account-dialog.js).
 * Les données d'avant les comptes, sans propriétaire, passent par l'import (store/local-import.js).
 */
const PREFIX = 'tableau-accessible-compte-';
export const LEGACY_TEMPLATES_KEY = 'tableau-accessible-templates';
export const LEGACY_USAGE_KEY = 'tableau-accessible-template-usage';
export const LEGACY_AUTHOR_KEY = 'tableau-accessible-auteur';

let current = null;
let cache = null;
let listening = false;

const empty = () => ({ version: 1, espaces: [], placement: {}, favoris: [], modèles: [], usage: {} });
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export const keyOf = id => PREFIX + id;

function readFor(id) {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyOf(id)) || 'null');
    if (!isObject(parsed)) return empty();
    return {
      version: 1,
      espaces: Array.isArray(parsed.espaces) ? parsed.espaces.filter(s => s?.id && typeof s.nom === 'string') : [],
      placement: isObject(parsed.placement) ? parsed.placement : {},
      favoris: Array.isArray(parsed.favoris) ? parsed.favoris.filter(f => typeof f === 'string') : [],
      modèles: Array.isArray(parsed.modèles) ? parsed.modèles.filter(t => t?.id && t.snapshot) : [],
      usage: isObject(parsed.usage) ? parsed.usage : {}
    };
  } catch {
    return empty();
  }
}

function listen() {
  if (listening) return;
  listening = true;
  // Un autre onglet du même compte a écrit : la prochaine lecture repart du disque.
  addEventListener('storage', e => { if (e.key === null || (current && e.key === keyOf(current))) cache = null; });
}

/* Le compte connecté, ou null : sans compte, rien n'est lu ni écrit. */
export function setAccount(id) {
  listen();
  if ((id || null) === current) return;
  current = id || null;
  cache = null;
}

export function accountId() {
  return current;
}

export function read() {
  if (!current) return empty();
  cache ||= readFor(current);
  return cache;
}

/* Toute écriture passe par ici. Lève si aucun compte n'est connecté ou si le stockage est plein : rien n'est changé. */
export function update(fn, id = current) {
  if (!id) throw new Error('Aucun compte connecté.');
  const data = id === current ? structuredClone(read()) : readFor(id);
  const result = fn(data);
  localStorage.setItem(keyOf(id), JSON.stringify(data));
  if (id === current) cache = data;
  return result;
}

/* Les écritures d'organisation (favori, espace) ne doivent pas casser l'interface : l'échec est signalé par false. */
function tryUpdate(fn) {
  try {
    update(fn);
    return true;
  } catch (e) {
    console.warn('Rangement non enregistré :', e);
    return false;
  }
}

/* Ce que la déconnexion doit proposer de garder ou d'effacer. L'historique d'usage des modèles n'est pas du contenu. */
export function summary(id = current) {
  if (!id) return { espaces: 0, favoris: 0, modèles: 0 };
  const d = id === current ? read() : readFor(id);
  return { espaces: d.espaces.length, favoris: d.favoris.length, modèles: d.modèles.length };
}

export function hasContent(id = current) {
  const s = summary(id);
  return s.espaces + s.favoris + s.modèles > 0;
}

export function forget(id) {
  if (!id) return;
  try { localStorage.removeItem(keyOf(id)); } catch { /* déjà absent */ }
  if (id === current) cache = null;
}

/*
 * Ajoute à un compte, sans doublon, ce qui lui revient : espaces et modèles par identifiant, favoris, place d'un
 * tableau (jamais écrasée), usage le plus récent d'un modèle. Seule déduplication de ces données : l'import
 * (store/local-import.js) et la reprise d'anciennes données passent par ici. Lève si le stockage est plein.
 */
export function merge({ espaces = [], favoris = [], placement = {}, modèles = [], usage = {} } = {}, id = current) {
  update(d => {
    for (const s of espaces) if (!d.espaces.some(e => e.id === s.id)) d.espaces.push({ id: s.id, nom: s.nom });
    for (const f of favoris) if (!d.favoris.includes(f)) d.favoris.push(f);
    for (const [board, space] of Object.entries(placement)) if (space && !d.placement[board]) d.placement[board] = space;
    for (const t of modèles) if (!d.modèles.some(m => m.id === t.id)) d.modèles.push(t);
    for (const [template, at] of Object.entries(usage)) if (typeof at === 'number' && !(d.usage[template] >= at)) d.usage[template] = at;
  }, id);
}

/* Reprise silencieuse (espaces d'avant cette version, favoris d'un ancien miroir) : l'échec est signalé par false. */
export function adopt(id, { espaces = [], favoris = [], placement = {} } = {}) {
  if (!id || (!espaces.length && !favoris.length && !Object.keys(placement).length)) return true;
  try {
    merge({ espaces, favoris, placement }, id);
    return true;
  } catch (e) {
    console.warn('Reprise impossible :', e);
    return false;
  }
}

/* ---- Favoris et place dans les espaces ---- */

export function isFavori(boardId) {
  return read().favoris.includes(boardId);
}

/* Un espace supprimé, ou pas encore importé, ne range rien. */
export function spaceOf(boardId) {
  const d = read();
  const space = d.placement[boardId];
  return space && d.espaces.some(s => s.id === space) ? space : null;
}

export function setFavori(boardId, on) {
  return tryUpdate(d => {
    d.favoris = d.favoris.filter(f => f !== boardId);
    if (on) d.favoris.push(boardId);
  });
}

export function setPlacement(boardId, spaceId) {
  return tryUpdate(d => {
    if (spaceId) d.placement[boardId] = spaceId;
    else delete d.placement[boardId];
  });
}

export function forgetBoard(boardId) {
  if (!current) return;
  const d = read();
  if (!d.favoris.includes(boardId) && !d.placement[boardId]) return;
  tryUpdate(x => {
    x.favoris = x.favoris.filter(f => f !== boardId);
    delete x.placement[boardId];
  });
}

/* ---- Espaces ---- */

export function spaces() {
  return read().espaces;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSpace(nom) {
  const space = { id: newId('space'), nom };
  update(d => { d.espaces.push(space); });
  return space;
}

export function renameSpace(id, nom) {
  update(d => {
    const space = d.espaces.find(s => s.id === id);
    if (space) space.nom = nom;
  });
}

export function removeSpace(id) {
  update(d => {
    d.espaces = d.espaces.filter(s => s.id !== id);
    for (const [board, space] of Object.entries(d.placement)) if (space === id) delete d.placement[board];
  });
}

/* ---- Mes modèles ---- */

export function templates() {
  return read().modèles;
}

export function addTemplates(list) {
  merge({ modèles: list });
}

export function setTemplates(list) {
  update(d => { d.modèles = list; });
}

export function usage() {
  return read().usage;
}

export function markUsed(templateId) {
  if (!current) return;
  tryUpdate(d => { d.usage[templateId] = Date.now(); });
}

/* ---- Données d'avant les comptes, communes à l'appareil ---- */

function readLegacy(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

export function legacyTemplates() {
  const list = readLegacy(LEGACY_TEMPLATES_KEY, []);
  return Array.isArray(list) ? list.filter(t => t?.id && t.snapshot) : [];
}

/* Retire de l'espace commun les modèles traités ; l'historique d'usage part avec le dernier. */
export function removeLegacyTemplates(ids) {
  const left = legacyTemplates().filter(t => !ids.includes(t.id));
  if (left.length) localStorage.setItem(LEGACY_TEMPLATES_KEY, JSON.stringify(left));
  else {
    localStorage.removeItem(LEGACY_TEMPLATES_KEY);
    localStorage.removeItem(LEGACY_USAGE_KEY);
  }
}

export function legacyUsage() {
  const usage = readLegacy(LEGACY_USAGE_KEY, {});
  return isObject(usage) ? usage : {};
}

/*
 * Ce qui, d'avant les comptes, n'a plus de raison d'être : le nom d'auteur des commentaires (il vient désormais du
 * compte) et l'historique d'usage quand il n'y a plus aucun modèle à importer.
 */
export function cleanupLegacy() {
  try {
    localStorage.removeItem(LEGACY_AUTHOR_KEY);
    if (!legacyTemplates().length) localStorage.removeItem(LEGACY_USAGE_KEY);
  } catch { /* stockage indisponible */ }
}
