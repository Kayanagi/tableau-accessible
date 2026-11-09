/*
 * Ce qu'un compte range en plus de ses tableaux : espaces, place des tableaux dans les espaces, favoris,
 * « Mes modèles » et modèles récemment utilisés. Tout est enregistré sur le serveur (GET/PUT /api/me/data) ;
 * l'onglet n'en garde qu'une copie de travail, en mémoire, effacée à la déconnexion.
 *
 * Lecture synchrone sur la copie de travail. Chaque modification y est appliquée aussitôt, gardée comme opération,
 * puis envoyée par un PUT différé (≈1 s, regroupé) avec la révision de base. Sur 409 (autre onglet, autre appareil),
 * la version du serveur est relue et les opérations non confirmées y sont rejouées : rien n'est écrasé.
 * Hors ligne, les opérations attendent dans l'onglet et partent au retour de la connexion.
 *
 * L'ancien stockage de l'appareil (une clé par compte, versions 1.10 et avant) est envoyé au premier chargement du
 * compte, puis effacé une fois le serveur d'accord. Les données d'avant les comptes passent par l'import
 * (store/local-import.js), qui écrit ici comme toute autre modification.
 */
const PREFIX = 'tableau-accessible-compte-';
export const LEGACY_TEMPLATES_KEY = 'tableau-accessible-templates';
export const LEGACY_USAGE_KEY = 'tableau-accessible-template-usage';
export const LEGACY_AUTHOR_KEY = 'tableau-accessible-auteur';

const SEND_DELAY_MS = 1000;
const RETRY_MS = 30 * 1000;
const REFRESH_AFTER_MS = 15 * 1000;
const MAX_CONFLICTS = 5;
// Limites du serveur, vérifiées avant d'écrire : un refus ferait perdre la modification après coup.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SPACES = 200;
const MAX_TEMPLATES = 100;
const MAX_USAGE = 200;
const MAX_REPAIRS = 10;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
const SAFE_ID = /^[\w-]{1,128}$/;
const BOARD_ID = /^brd_[A-Za-z0-9_-]{22}$/;

let current = null;
let listening = false;
let channel = null;
/* Par compte : copie confirmée par le serveur (base, rev), opérations en attente, copie de travail (view). */
const accounts = new Map();
const listeners = new Set();
let onRejected = () => {};

const empty = () => ({ espaces: [], placement: {}, favoris: [], modèles: [], usage: {} });
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export const keyOf = id => PREFIX + id;

function normalize(raw) {
  if (!isObject(raw)) return empty();
  return {
    espaces: Array.isArray(raw.espaces) ? raw.espaces.filter(s => s?.id && typeof s.nom === 'string').map(s => ({ id: s.id, nom: s.nom })) : [],
    placement: isObject(raw.placement) ? Object.fromEntries(Object.entries(raw.placement).filter(([, v]) => typeof v === 'string')) : {},
    favoris: Array.isArray(raw.favoris) ? raw.favoris.filter(f => typeof f === 'string') : [],
    modèles: Array.isArray(raw.modèles) ? raw.modèles.filter(t => t?.id && t.snapshot) : [],
    usage: isObject(raw.usage) ? Object.fromEntries(Object.entries(raw.usage).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) : {}
  };
}

/* Les plus récents d'abord : au-delà de la limite, les plus anciens usages sont oubliés. */
function trimUsage(usage) {
  const entries = Object.entries(usage);
  if (entries.length <= MAX_USAGE) return usage;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_USAGE));
}

const cleanName = value => {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_NAME ? name : null;
};

/*
 * Ce qui part au serveur : la forme qu'il admet (validate.js, prepareAccountData). Ce qu'il refuserait à coup sûr
 * (identifiant d'un tableau local, champ inconnu d'un ancien modèle, doublon) est écarté ici plutôt que de faire
 * échouer tout l'envoi.
 */
function toWire(d) {
  const spaceIds = new Set();
  const espaces = [];
  for (const space of d.espaces) {
    const nom = cleanName(space.nom);
    if (!nom || !SAFE_ID.test(space.id) || spaceIds.has(space.id)) continue;
    spaceIds.add(space.id);
    espaces.push({ id: space.id, nom });
  }
  const templateIds = new Set();
  const modèles = [];
  for (const t of d.modèles) {
    const nom = cleanName(t.nom);
    if (!nom || !SAFE_ID.test(t.id) || templateIds.has(t.id) || !isObject(t.snapshot)) continue;
    templateIds.add(t.id);
    const out = { id: t.id, nom };
    if (typeof t.description === 'string') out.description = [...t.description].slice(0, MAX_DESCRIPTION).join('');
    if (Number.isSafeInteger(t.créé) && t.créé >= 0) out.créé = t.créé;
    if (typeof t.partage === 'boolean') out.partage = t.partage;
    out.snapshot = t.snapshot;
    modèles.push(out);
  }
  return {
    espaces,
    favoris: [...new Set(d.favoris.filter(f => BOARD_ID.test(f)))],
    placement: Object.fromEntries(Object.entries(d.placement).filter(([board, space]) => BOARD_ID.test(board) && SAFE_ID.test(space))),
    modèles,
    usage: trimUsage(Object.fromEntries(Object.entries(d.usage).filter(([key, at]) => SAFE_ID.test(key) && Number.isSafeInteger(at) && at >= 0)))
  };
}

/* Refus du serveur sur un élément précis (path) : l'opération qui le retire, pour envoyer tout le reste. */
function repairOp(path, wire) {
  let m;
  if ((m = /^data\.modèles\[(\d+)\]/.exec(path)) && wire.modèles[m[1]]) {
    const id = wire.modèles[m[1]].id;
    return d => { d.modèles = d.modèles.filter(t => t.id !== id); };
  }
  if ((m = /^data\.espaces\[(\d+)\]/.exec(path)) && wire.espaces[m[1]]) {
    const id = wire.espaces[m[1]].id;
    return d => { d.espaces = d.espaces.filter(s => s.id !== id); };
  }
  if ((m = /^data\.favoris\[(\d+)\]/.exec(path)) && wire.favoris[m[1]] !== undefined) {
    const id = wire.favoris[m[1]];
    return d => { d.favoris = d.favoris.filter(f => f !== id); };
  }
  if ((m = /^data\.placement\.(.+)$/.exec(path)) && m[1] in wire.placement) {
    const board = m[1];
    return d => { delete d.placement[board]; };
  }
  if ((m = /^data\.usage\.(.+)$/.exec(path)) && m[1] in wire.usage) {
    const key = m[1];
    return d => { delete d.usage[key]; };
  }
  return null;
}

function checkLimits(data) {
  if (data.espaces.length > MAX_SPACES) throw new Error(`Au plus ${MAX_SPACES} espaces par compte.`);
  if (data.modèles.length > MAX_TEMPLATES) throw new Error(`Au plus ${MAX_TEMPLATES} modèles dans « Mes modèles ».`);
  const text = JSON.stringify(data);
  // Un caractère vaut 3 octets au plus en UTF-8 : le calcul exact n'est fait que s'il peut changer la réponse.
  if (text.length * 3 > MAX_BYTES && new Blob([text]).size > MAX_BYTES) throw new Error('Les données du compte dépasseraient 2 Mio.');
}

/* ---- Ancien stockage de l'appareil, par compte ---- */

function readFor(id) {
  try {
    return normalize(JSON.parse(localStorage.getItem(keyOf(id)) || 'null'));
  } catch {
    return empty();
  }
}

const hasData = d => d.espaces.length + d.favoris.length + d.modèles.length + Object.keys(d.placement).length + Object.keys(d.usage).length > 0;

/* ---- API, chargée à la demande comme dans store/account.js ---- */

let apiModule = null;
async function api() {
  apiModule ||= await import('../sync/api.js');
  return apiModule;
}

/* ---- État par compte ---- */

function stateOf(id) {
  let s = accounts.get(id);
  if (!s) {
    s = { id, loaded: false, rev: 0, base: empty(), ops: [], view: null, loading: null, sending: null, timer: null, retry: null, fetchedAt: 0, migrating: false };
    accounts.set(id, s);
  }
  return s;
}

const alive = s => accounts.get(s.id) === s;

function view(s) {
  if (!s.view) {
    const d = structuredClone(s.base);
    for (const op of s.ops) op(d);
    d.usage = trimUsage(d.usage);
    s.view = d;
  }
  return s.view;
}

function changed() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

/* Une modification refusée par le serveur (quota, élément invalide) : l'interface le dit, la copie est corrigée. */
export function setRejectionHandler(fn) {
  onRejected = fn || (() => {});
}

/* Appelé quand la copie de travail change sans action de l'onglet : chargement, autre onglet, autre appareil. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function schedule(s, delay = SEND_DELAY_MS) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => { s.timer = null; send(s); }, delay);
}

function scheduleRetry(s) {
  clearTimeout(s.retry);
  s.retry = setTimeout(() => { s.retry = null; if (alive(s)) syncState(s); }, RETRY_MS);
}

/*
 * Lit la version du serveur. L'ancien stockage de l'appareil, s'il en reste, s'ajoute en tête des opérations :
 * il part avec le prochain envoi et sa clé n'est effacée qu'après l'accord du serveur.
 */
async function fetchState(s) {
  if (s.loading) return s.loading;
  s.loading = (async () => {
    try {
      const { rev, data } = await (await api()).getAccountData();
      if (!alive(s)) return;
      s.rev = rev;
      s.base = normalize(data);
      s.loaded = true;
      s.fetchedAt = Date.now();
      if (!s.migrating) {
        const legacy = readFor(s.id);
        if (hasData(legacy)) {
          s.migrating = true;
          s.ops.unshift(mergeOp(legacy));
        }
      }
      s.view = null;
      changed();
      if (s.ops.length) schedule(s, 0);
    } catch (err) {
      if (err?.name !== 'ApiError') throw err;
      // Injoignable : nouvel essai plus tard. Session perdue (401) : l'écran de connexion prend la place.
      if (err.unreachable && alive(s)) scheduleRetry(s);
    } finally {
      s.loading = null;
    }
  })();
  return s.loading;
}

/* Envoie les opérations en attente ; sur conflit, relit et rejoue. Une seule série d'envois à la fois. */
function send(s) {
  if (s.sending) return s.sending;
  s.sending = (async () => {
    let conflicts = 0;
    let repairs = 0;
    while (alive(s) && s.ops.length) {
      if (!s.loaded) {
        await fetchState(s);
        if (!s.loaded) return;
        continue;
      }
      const count = s.ops.length;
      const data = toWire(structuredClone(view(s)));
      try {
        const { rev } = await (await api()).putAccountData(s.rev, data);
        if (!alive(s)) return;
        s.rev = rev;
        s.base = normalize(data);
        s.ops = s.ops.slice(count);
        s.view = null;
        s.fetchedAt = Date.now();
        if (s.migrating) {
          s.migrating = false;
          try { localStorage.removeItem(keyOf(s.id)); } catch { /* déjà absent */ }
        }
        channel?.postMessage({ id: s.id, rev });
      } catch (err) {
        if (err?.name !== 'ApiError') throw err;
        if (err.status === 409 && ++conflicts <= MAX_CONFLICTS) {
          await fetchState(s);
          continue;
        }
        if (err.unreachable || err.status === 409) { scheduleRetry(s); return; }
        if (err.status === 401) return;
        // Un élément précis est refusé : il est retiré, le reste repart.
        const repair = err.status === 400 && ++repairs <= MAX_REPAIRS ? repairOp(err.path || '', data) : null;
        if (repair) {
          s.ops.push(repair);
          s.view = null;
          changed();
          onRejected(err);
          continue;
        }
        // Refus d'ensemble (quota, taille) : ces modifications ne passeront pas, la copie revient à celle du serveur.
        console.warn('Données du compte refusées par le serveur :', err.message);
        s.ops = s.ops.slice(count);
        s.migrating = false;
        s.view = null;
        changed();
        onRejected(err);
        return;
      }
    }
  })().finally(() => { s.sending = null; });
  return s.sending;
}

function syncState(s) {
  if (!s.loaded) return fetchState(s);
  if (s.ops.length) return send(s);
  return Promise.resolve();
}

function listen() {
  if (listening) return;
  listening = true;
  // Un autre onglet a enregistré : la copie de cet onglet est relue, sauf envoi en cours (son 409 s'en chargera).
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel('baro-donnees-compte');
    channel.onmessage = e => {
      const s = current && accounts.get(current);
      if (s && e.data?.id === s.id && e.data.rev > s.rev && !s.sending) fetchState(s);
    };
  }
  addEventListener('online', () => syncPending());
  // Retour sur l'onglet : un autre appareil a pu écrire entre-temps.
  document.addEventListener('visibilitychange', () => {
    const s = current && accounts.get(current);
    if (document.visibilityState === 'visible' && s?.loaded && !s.sending && !s.ops.length && Date.now() - s.fetchedAt > REFRESH_AFTER_MS) fetchState(s);
  });
  // L'onglet se ferme avec des modifications en attente : dernier essai, sans attendre la réponse.
  addEventListener('pagehide', () => {
    const s = current && accounts.get(current);
    if (!s?.loaded || !s.ops.length || s.sending) return;
    clearTimeout(s.timer);
    api().then(a => a.putAccountData(s.rev, toWire(structuredClone(view(s))), { keepalive: true })).catch(() => {});
  });
}

/* Le compte connecté, ou null : sans compte, rien n'est lu ni écrit. Sa copie de travail est chargée aussitôt. */
export function setAccount(id) {
  listen();
  current = id || null;
  if (current && !stateOf(current).loaded) fetchState(stateOf(current));
}

export function accountId() {
  return current;
}

/* Chargement du compte connecté depuis le serveur : résolu une fois la copie à jour, ou le serveur injoignable. */
export function load() {
  if (!current) return Promise.resolve();
  const s = stateOf(current);
  return s.loaded ? Promise.resolve() : fetchState(s);
}

/* Envoie ce qui attend encore (déconnexion, retour de la connexion). */
export function flush() {
  if (!current) return Promise.resolve();
  const s = stateOf(current);
  clearTimeout(s.timer);
  s.timer = null;
  return syncState(s);
}

export function syncPending() {
  if (current) syncState(stateOf(current));
}

/* Des modifications de ce compte ne sont pas encore sur le serveur. */
export function hasUnsent(id = current) {
  return !!id && (accounts.get(id)?.ops.length || 0) > 0;
}

export function isLoaded(id = current) {
  return !!id && !!accounts.get(id)?.loaded;
}

export function read() {
  if (!current) return empty();
  return view(stateOf(current));
}

/*
 * Toute écriture passe par ici. fn reçoit une copie à modifier ; elle peut être rejouée sur la version du serveur
 * après un conflit : elle ne doit dépendre que de ses arguments. Lève si aucun compte n'est connecté ou si une limite
 * du serveur serait dépassée : rien n'est changé.
 * Pour un autre compte que le compte connecté (reprise d'anciennes données), l'écriture va à l'ancien stockage de
 * l'appareil, envoyé au serveur au prochain chargement de ce compte.
 */
export function update(fn, id = current) {
  if (!id) throw new Error('Aucun compte connecté.');
  if (id !== current) {
    const data = readFor(id);
    const result = fn(data);
    localStorage.setItem(keyOf(id), JSON.stringify(data));
    return result;
  }
  const s = stateOf(id);
  const next = structuredClone(view(s));
  const result = fn(next);
  next.usage = trimUsage(next.usage);
  checkLimits(next);
  s.ops.push(fn);
  s.view = next;
  schedule(s);
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

export function summary(id = current) {
  if (!id) return { espaces: 0, favoris: 0, modèles: 0 };
  const d = id === current ? read() : readFor(id);
  return { espaces: d.espaces.length, favoris: d.favoris.length, modèles: d.modèles.length };
}

export function hasContent(id = current) {
  const s = summary(id);
  return s.espaces + s.favoris + s.modèles > 0;
}

/* Déconnexion, suppression du compte : la copie de travail et l'ancien stockage de l'appareil disparaissent. */
export function forget(id) {
  if (!id) return;
  const s = accounts.get(id);
  if (s) {
    clearTimeout(s.timer);
    clearTimeout(s.retry);
    accounts.delete(id);
  }
  try { localStorage.removeItem(keyOf(id)); } catch { /* déjà absent */ }
  if (id === current) changed();
}

/*
 * Ajoute à un compte, sans doublon, ce qui lui revient : espaces et modèles par identifiant, favoris, place d'un
 * tableau (jamais écrasée), usage le plus récent d'un modèle. Seule déduplication de ces données : l'import
 * (store/local-import.js), la migration de l'ancien stockage et la reprise d'anciennes données passent par ici.
 */
function mergeOp({ espaces = [], favoris = [], placement = {}, modèles = [], usage = {} } = {}) {
  const input = structuredClone({ espaces, favoris, placement, modèles, usage });
  return d => {
    for (const s of input.espaces) if (!d.espaces.some(e => e.id === s.id)) d.espaces.push({ id: s.id, nom: s.nom });
    for (const f of input.favoris) if (!d.favoris.includes(f)) d.favoris.push(f);
    for (const [board, space] of Object.entries(input.placement)) if (space && !d.placement[board]) d.placement[board] = space;
    for (const t of input.modèles) if (!d.modèles.some(m => m.id === t.id)) d.modèles.push(structuredClone(t));
    for (const [template, at] of Object.entries(input.usage)) if (typeof at === 'number' && !(d.usage[template] >= at)) d.usage[template] = at;
  };
}

export function merge(data = {}, id = current) {
  update(mergeOp(data), id);
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
  update(d => { if (!d.espaces.some(s => s.id === space.id)) d.espaces.push({ ...space }); });
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

/*
 * Remplace la liste, mais n'enregistre que la différence (retraits, ajouts, modifications par identifiant) :
 * rejouée après un conflit, elle n'efface pas un modèle ajouté entre-temps par un autre onglet ou appareil.
 */
export function setTemplates(list) {
  const before = read().modèles.map(t => t.id);
  const after = structuredClone(list);
  const kept = new Set(after.map(t => t.id));
  const removed = before.filter(id => !kept.has(id));
  update(d => {
    d.modèles = d.modèles.filter(t => !removed.includes(t.id));
    for (const t of after) {
      const i = d.modèles.findIndex(m => m.id === t.id);
      if (i >= 0) d.modèles[i] = structuredClone(t);
      else d.modèles.push(structuredClone(t));
    }
  });
}

export function usage() {
  return read().usage;
}

export function markUsed(templateId) {
  if (!current) return;
  const at = Date.now();
  tryUpdate(d => { if (!(d.usage[templateId] >= at)) d.usage[templateId] = at; });
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
