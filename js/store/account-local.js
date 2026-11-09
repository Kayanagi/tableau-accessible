/*
 * Ce qu'un compte range en plus de ses tableaux : espaces, place des tableaux dans les espaces, favoris,
 * « Mes modèles » et modèles récemment utilisés. Tout est enregistré sur le serveur (GET/PUT /api/me/data) ;
 * l'onglet n'en garde qu'une copie de travail, en mémoire, effacée à la déconnexion.
 *
 * Lecture synchrone sur la copie de travail. Chaque modification y est appliquée aussitôt, gardée comme opération,
 * puis envoyée par un PUT différé (≈1 s, regroupé) avec la révision de base. Sur 409 (autre onglet, autre appareil),
 * la version du serveur est relue et les opérations non confirmées y sont rejouées : rien n'est écrasé.
 * Un refus d'ensemble (quota, taille) ne jette pas le lot : chaque opération est essayée seule, et seules celles qui
 * ne passent pas sont retirées, en les nommant. Hors ligne, les opérations attendent dans l'onglet et partent au
 * retour de la connexion ; fermer l'onglet avant est signalé (beforeunload).
 *
 * Ce qui vient de l'appareil (ancien stockage par compte, données d'avant les comptes) n'y est effacé qu'une fois le
 * serveur d'accord, élément par élément : ce qu'il refuse reste sur l'appareil.
 *   - L'ancien stockage de l'appareil (une clé par compte, versions 1.10 et avant, et reprises d'anciens miroirs ou
 *     espaces marqués à un compte, voir adopt) est envoyé au chargement du compte, puis réécrit avec les seuls
 *     éléments refusés (effacé s'il n'en reste pas).
 *   - L'import des espaces et modèles d'avant les comptes (store/local-import.js) passe par importItems, qui rend la
 *     réponse du serveur élément par élément.
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
const INVALID_SPACE = 'Nom ou identifiant d’espace non valable.';
const INVALID_TEMPLATE = 'Modèle incomplet, ou nom ou identifiant non valable.';

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

/* Ce que le serveur refuserait à coup sûr : écarté avant l'envoi (toWire), et signalé quand cela vient d'un import. */
const validSpace = s => !!cleanName(s?.nom) && SAFE_ID.test(s?.id);
const validTemplate = t => !!cleanName(t?.nom) && SAFE_ID.test(t?.id) && isObject(t?.snapshot);

/*
 * Ce qui part au serveur : la forme qu'il admet (validate.js, prepareAccountData). Ce qu'il refuserait à coup sûr
 * (identifiant d'un tableau local, champ inconnu d'un ancien modèle, doublon) est écarté ici plutôt que de faire
 * échouer tout l'envoi. Un élément venu de l'appareil et écarté ici n'y est pas effacé (voir settle et importItems).
 */
function toWire(d) {
  const spaceIds = new Set();
  const espaces = [];
  for (const space of d.espaces) {
    if (!validSpace(space) || spaceIds.has(space.id)) continue;
    spaceIds.add(space.id);
    espaces.push({ id: space.id, nom: cleanName(space.nom) });
  }
  const templateIds = new Set();
  const modèles = [];
  for (const t of d.modèles) {
    if (!validTemplate(t) || templateIds.has(t.id)) continue;
    templateIds.add(t.id);
    const out = { id: t.id, nom: cleanName(t.nom) };
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

/* Refus du serveur sur un élément précis (path) : l'élément, et l'opération qui le retire pour envoyer tout le reste. */
function refusalAt(path, wire) {
  let m;
  if ((m = /^data\.modèles\[(\d+)\]/.exec(path)) && wire.modèles[m[1]]) {
    const { id, nom } = wire.modèles[m[1]];
    return { kind: 'modèle', id, label: `modèle « ${nom} »`, apply: d => { d.modèles = d.modèles.filter(t => t.id !== id); } };
  }
  if ((m = /^data\.espaces\[(\d+)\]/.exec(path)) && wire.espaces[m[1]]) {
    const { id, nom } = wire.espaces[m[1]];
    return { kind: 'espace', id, label: `espace « ${nom} »`, apply: d => { d.espaces = d.espaces.filter(s => s.id !== id); } };
  }
  if ((m = /^data\.favoris\[(\d+)\]/.exec(path)) && wire.favoris[m[1]] !== undefined) {
    const id = wire.favoris[m[1]];
    return { kind: 'favori', id, label: 'un favori', apply: d => { d.favoris = d.favoris.filter(f => f !== id); } };
  }
  if ((m = /^data\.placement\.(.+)$/.exec(path)) && m[1] in wire.placement) {
    const board = m[1];
    return { kind: 'placement', id: board, label: 'la place d’un tableau dans un espace', apply: d => { delete d.placement[board]; } };
  }
  if ((m = /^data\.usage\.(.+)$/.exec(path)) && m[1] in wire.usage) {
    const key = m[1];
    return { kind: 'usage', id: key, label: 'l’historique d’usage d’un modèle', apply: d => { delete d.usage[key]; } };
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

/* Lève si le stockage est plein : l'appelant garde alors sa propre copie. */
function writeFor(id, d) {
  if (hasData(d)) localStorage.setItem(keyOf(id), JSON.stringify({ version: 1, ...d }));
  else localStorage.removeItem(keyOf(id));
}

/* ---- API, chargée à la demande comme dans store/account.js ---- */

let apiModule = null;
async function api() {
  apiModule ||= await import('../sync/api.js');
  return apiModule;
}

/* ---- État par compte ---- */

/*
 * ops : opérations { apply(d), label, ticket?, repair? } dans l'ordre ; apply ne dépend que de ses arguments (rejouée
 * après un conflit). label nomme l'opération si le serveur la refuse. ticket : un appelant attend la réponse.
 * refusals : éléments refusés par le serveur pendant que des tickets attendent (raison donnée à l'appelant).
 */
function stateOf(id) {
  let s = accounts.get(id);
  if (!s) {
    s = { id, loaded: false, rev: 0, base: empty(), ops: [], view: null, loading: null, sending: null, timer: null, retry: null, fetchedAt: 0, migration: null, migrationTried: false, refusals: [] };
    accounts.set(id, s);
  }
  return s;
}

const alive = s => accounts.get(s.id) === s;

function apply(base, ops) {
  const d = structuredClone(base);
  for (const op of ops) op.apply(d);
  d.usage = trimUsage(d.usage);
  return d;
}

function view(s) {
  s.view ||= apply(s.base, s.ops);
  return s.view;
}

function changed() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

/* Une modification refusée par le serveur (quota, élément invalide) : fn(erreur, ce qui a été refusé). */
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

/* ---- Suivi d'une opération par son appelant : import, ancien stockage de l'appareil ---- */

const elementsOf = input => [
  ...(input.espaces || []).map(x => ({ kind: 'espace', id: x.id, nom: x.nom })),
  ...(input.modèles || []).map(x => ({ kind: 'modèle', id: x.id, nom: x.nom }))
];

/*
 * result (une seule fois) : { sent: true, refused } une fois enregistrée, refused listant les espaces et modèles de
 * l'entrée absents de ce que le serveur a accepté, avec la raison ; { sent: false, refused, error? } si elle a été
 * refusée en entier ou abandonnée (compte oublié). Tant que result est null, la réponse n'est pas venue.
 */
function ticketFor(input, { quiet = false, refused = [] } = {}) {
  let resolve;
  const ticket = { input, quiet, result: null, settled: new Promise(r => { resolve = r; }) };
  ticket.settle = result => {
    if (ticket.result) return;
    ticket.result = { ...result, refused: [...refused, ...result.refused] };
    resolve(ticket.result);
  };
  return ticket;
}

function reasonOf(s, el) {
  const found = s.refusals.findLast(r => r.kind === el.kind && r.id === el.id);
  return found?.reason || 'Le serveur ne l’a pas enregistré.';
}

const presentIn = (wire, el) => (el.kind === 'espace' ? wire.espaces : wire.modèles).some(x => x.id === el.id);

/* Le serveur a accepté base + batch (wire), à la révision rev. */
function commit(s, batch, rev, wire) {
  s.rev = rev;
  s.base = normalize(wire);
  s.ops = s.ops.filter(op => !batch.includes(op));
  s.view = null;
  s.fetchedAt = Date.now();
  for (const op of batch) {
    if (!op.ticket) continue;
    const refused = elementsOf(op.ticket.input).filter(el => !presentIn(wire, el)).map(el => ({ ...el, reason: reasonOf(s, el) }));
    op.ticket.settle({ sent: true, refused });
  }
  if (!s.ops.some(op => op.ticket)) s.refusals = [];
}

/* Refusées seules par le serveur : retirées de la copie ; ce qui était refusé est nommé. */
function drop(s, batch, err) {
  s.ops = s.ops.filter(op => !batch.includes(op));
  s.view = null;
  for (const op of batch) {
    op.ticket?.settle({ sent: false, error: err, refused: elementsOf(op.ticket.input).map(el => ({ ...el, reason: err.message })) });
  }
  const main = batch.find(op => !op.repair) || batch[0];
  console.warn('Données du compte refusées par le serveur :', main.label, err.message);
  if (!main.ticket?.quiet) onRejected(err, main.label);
  changed();
}

/* Un élément refusé appartient-il à un import dont l'appelant rend compte lui-même ? */
const reportedByCaller = (s, refusal) => s.ops.some(op => op.ticket?.quiet && !op.ticket.result && elementsOf(op.ticket.input).some(el => el.kind === refusal.kind && el.id === refusal.id));

/*
 * L'ancien stockage de l'appareil, s'il en reste, s'ajoute en tête des opérations. Une fois le serveur d'accord, il est
 * réécrit avec les seuls éléments refusés ; refusé en entier, ou jamais envoyé, il reste tel quel. Un essai par
 * chargement du compte : ce qui est refusé n'est pas renvoyé en boucle.
 */
function startMigration(s) {
  if (s.migration) return;
  const legacy = readFor(s.id);
  if (!hasData(legacy)) return;
  const ticket = ticketFor(legacy);
  s.migration = ticket;
  s.ops.unshift({ apply: mergeOp(legacy), label: 'les espaces, favoris et modèles gardés sur cet appareil (ils y restent)', ticket });
  s.view = null;
  ticket.settled.then(result => finishMigration(s, legacy, result));
}

function finishMigration(s, sent, result) {
  if (s.migration?.result === result) s.migration = null;
  if (!result.sent) { s.migrationTried = true; return; }
  const refused = new Set(result.refused.map(el => `${el.kind}:${el.id}`));
  // Relu : une reprise a pu y écrire entre-temps. Seul ce qui a été envoyé et accepté en sort.
  const left = readFor(s.id);
  left.espaces = left.espaces.filter(x => refused.has(`espace:${x.id}`) || !sent.espaces.some(y => y.id === x.id));
  left.modèles = left.modèles.filter(x => refused.has(`modèle:${x.id}`) || !sent.modèles.some(y => y.id === x.id));
  // Favoris, places et usages écartés par toWire (identifiant d'un tableau local…) n'ont pas de sens pour le serveur.
  left.favoris = left.favoris.filter(f => !sent.favoris.includes(f));
  for (const [board, space] of Object.entries(sent.placement)) if (left.placement[board] === space) delete left.placement[board];
  for (const [key, at] of Object.entries(sent.usage)) if (left.usage[key] <= at && !refused.has(`modèle:${key}`)) delete left.usage[key];
  try { writeFor(s.id, left); } catch (e) { console.warn('Ancien stockage du compte non réécrit :', e); }
  if (refused.size) { s.migrationTried = true; return; }
  // Ajouté pendant l'envoi (reprise d'un ancien miroir) : part à son tour.
  if (alive(s) && s.loaded && hasData(left)) {
    startMigration(s);
    schedule(s, 0);
  }
}

/* ---- Lecture et envoi ---- */

/*
 * Lit la version du serveur ; les opérations en attente y sont rejouées. Une réponse plus ancienne que la copie
 * (un envoi a été confirmé pendant la lecture) est ignorée.
 */
async function fetchState(s) {
  if (s.loading) return s.loading;
  s.loading = (async () => {
    try {
      const { rev, data } = await (await api()).getAccountData();
      if (!alive(s)) return;
      if (s.loaded && rev < s.rev) return;
      s.rev = rev;
      s.base = normalize(data);
      s.loaded = true;
      s.fetchedAt = Date.now();
      if (!s.migrationTried) startMigration(s);
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

/*
 * Envoie les opérations en attente ; sur conflit, relit et rejoue. Une seule série d'envois à la fois.
 * Élément précis refusé (400 avec path) : il est retiré par une opération de réparation, le reste repart.
 * Refus d'ensemble (quota, taille, trop d'éléments) : les opérations du lot sont essayées une à une (avec leurs
 * réparations), dans l'ordre ; seules celles que le serveur refuse seules sont retirées, et nommées.
 */
function send(s) {
  if (s.sending) return s.sending;
  s.sending = (async () => {
    let conflicts = 0;
    let repairs = 0;
    let queue = [];   // isolement : opérations d'un lot refusé, à essayer seules
    let group = null; // l'opération essayée seule et ses réparations
    while (alive(s) && s.ops.length) {
      if (!s.loaded) {
        await fetchState(s);
        if (!s.loaded) return;
        continue;
      }
      queue = queue.filter(op => s.ops.includes(op));
      if (group && !s.ops.includes(group[0])) group = null;
      if (!group && queue.length) { group = [queue[0]]; repairs = 0; }
      const batch = group ? group.filter(op => s.ops.includes(op)) : [...s.ops];
      const data = toWire(apply(s.base, batch));
      try {
        const { rev } = await (await api()).putAccountData(s.rev, data);
        if (!alive(s)) return;
        commit(s, batch, rev, data);
        if (group) { queue = queue.filter(op => !batch.includes(op)); group = null; }
        channel?.postMessage({ id: s.id, rev });
      } catch (err) {
        if (err?.name !== 'ApiError') throw err;
        if (err.status === 409 && ++conflicts <= MAX_CONFLICTS) {
          await fetchState(s);
          continue;
        }
        if (err.unreachable || err.status === 409) { scheduleRetry(s); return; }
        if (err.status === 401) return;
        const refusal = err.status === 400 && ++repairs <= MAX_REPAIRS ? refusalAt(err.path || '', data) : null;
        if (refusal) {
          const repair = { apply: refusal.apply, label: refusal.label, repair: true };
          s.ops.splice(s.ops.indexOf(batch.at(-1)) + 1, 0, repair);
          if (group) group.push(repair);
          s.refusals.push({ kind: refusal.kind, id: refusal.id, reason: err.message });
          s.view = null;
          changed();
          if (!reportedByCaller(s, refusal)) onRejected(err, refusal.label);
          continue;
        }
        if (!group && batch.length > 1) {
          queue = [...batch];
          continue;
        }
        drop(s, batch, err);
        if (group) { queue = queue.filter(op => !batch.includes(op)); group = null; }
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

const anyUnsent = () => [...accounts.values()].some(s => s.ops.length > 0);

function listen() {
  if (listening) return;
  listening = true;
  // Un autre onglet a enregistré : la copie de cet onglet est relue, sauf envoi en cours (son 409 s'en chargera).
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel('baro-donnees-compte');
    channel.onmessage = e => {
      const s = current && accounts.get(current);
      if (s?.loaded && e.data?.id === s.id && e.data.rev > s.rev && !s.sending) fetchState(s);
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
    s.timer = null;
    api().then(a => a.putAccountData(s.rev, toWire(structuredClone(view(s))), { keepalive: true })).catch(() => {});
  });
  // Ces modifications ne sont qu'en mémoire : les perdre en fermant l'onglet doit être une décision.
  addEventListener('beforeunload', event => {
    if (!anyUnsent()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  // Retour depuis le cache de navigation : pagehide a arrêté le minuteur, l'envoi reprend.
  addEventListener('pageshow', event => {
    if (!event.persisted) return;
    const s = current && accounts.get(current);
    if (s?.ops.length && !s.timer && !s.sending) schedule(s, 0);
  });
}

/*
 * Le compte connecté, ou null : sans compte, rien n'est lu ni écrit. Sa copie de travail est chargée aussitôt.
 * Le compte quitté (session expirée, autre compte) garde ses opérations en attente, mais sa copie sera relue du
 * serveur à son retour dans cet onglet : un autre appareil a pu écrire entre-temps.
 */
export function setAccount(id) {
  listen();
  const next = id || null;
  const previous = current && current !== next ? accounts.get(current) : null;
  if (previous) {
    previous.loaded = false;
    previous.migrationTried = false;
    clearTimeout(previous.timer);
    clearTimeout(previous.retry);
    previous.timer = previous.retry = null;
  }
  current = next;
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

/*
 * Envoie ce qui attend encore (déconnexion, import) et rend la main une fois l'envoi fini : chargement compris, et
 * envoi déjà en cours compris. Ce qui n'a pas pu partir reste en attente (hasUnsent).
 */
export async function flush() {
  if (!current) return;
  const s = stateOf(current);
  clearTimeout(s.timer);
  s.timer = null;
  if (!s.loaded) await fetchState(s);
  if (!alive(s) || !s.loaded) return;
  clearTimeout(s.timer);
  s.timer = null;
  if (s.ops.length || s.sending) await send(s);
}

export function syncPending() {
  if (current) syncState(stateOf(current));
}

/* Des modifications de ce compte ne sont pas encore sur le serveur. */
export function hasUnsent(id = current) {
  return !!id && (accounts.get(id)?.ops.length || 0) > 0;
}

export function read() {
  if (!current) return empty();
  return view(stateOf(current));
}

/*
 * Toute écriture passe par ici. Lève si aucun compte n'est connecté ou si une limite du serveur serait dépassée :
 * rien n'est changé. op.apply reçoit une copie à modifier ; elle peut être rejouée sur la version du serveur après
 * un conflit : elle ne doit dépendre que de ses arguments.
 */
function enqueue(op) {
  if (!current) throw new Error('Aucun compte connecté.');
  const s = stateOf(current);
  const next = structuredClone(view(s));
  op.apply(next);
  next.usage = trimUsage(next.usage);
  checkLimits(next);
  s.ops.push(op);
  s.view = next;
  schedule(s);
}

function update(apply, label) {
  enqueue({ apply, label });
}

/* Les écritures d'organisation (favori, espace) ne doivent pas casser l'interface : l'échec est signalé par false. */
function tryUpdate(fn, label) {
  try {
    update(fn, label);
    return true;
  } catch (e) {
    console.warn('Rangement non enregistré :', e);
    return false;
  }
}

/*
 * Déconnexion, suppression du compte : la copie de travail disparaît. L'ancien stockage de l'appareil n'est effacé
 * qu'avec le compte (removed) : tant qu'il existe, le serveur ne l'a pas reçu.
 */
export function forget(id, { removed = false } = {}) {
  if (!id) return;
  const s = accounts.get(id);
  if (s) {
    clearTimeout(s.timer);
    clearTimeout(s.retry);
    accounts.delete(id);
    for (const op of s.ops) op.ticket?.settle({ sent: false, abandoned: true, refused: [] });
  }
  if (removed) {
    try { localStorage.removeItem(keyOf(id)); } catch { /* déjà absent */ }
  }
  if (id === current) changed();
}

/*
 * Déconnexion faite dans un autre onglet : un dernier envoi est tenté, puis la copie de travail est oubliée.
 * Rend false si des changements n'ont pas pu partir (la session est souvent déjà fermée) : l'appelant le signale.
 */
export async function forgetAfterSending(id, { removed = false } = {}) {
  const s = id && accounts.get(id);
  if (s?.ops.length && !removed) {
    clearTimeout(s.timer);
    s.timer = null;
    try { await send(s); } catch (e) { console.error(e); }
  }
  const unsent = !removed && !!s && alive(s) && s.ops.length > 0;
  // Reconnecté entre-temps dans cet onglet : la copie redevient celle du compte connecté, rien n'est oublié.
  if (id === current) return !unsent;
  forget(id, { removed });
  return !unsent;
}

/*
 * Ajoute à un compte, sans doublon, ce qui lui revient : espaces et modèles par identifiant, favoris, place d'un
 * tableau (jamais écrasée), usage le plus récent d'un modèle. Seule déduplication de ces données : l'import
 * (store/local-import.js), l'ancien stockage de l'appareil et les reprises passent par ici.
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

/*
 * Import dans le compte connecté (espaces et modèles d'avant les comptes). Lève si une limite serait dépassée : rien
 * n'est changé. Rend le ticket de l'envoi (voir ticketFor) : l'appelant ne retire ses données de l'appareil qu'une fois
 * ticket.result connu, et seulement pour ce qui n'est pas dans result.refused. Ce que le serveur refuserait à coup sûr
 * n'est pas envoyé, et figure d'emblée dans refused.
 */
export function importItems({ espaces = [], modèles = [], usage = {} }) {
  const refused = [
    ...espaces.filter(x => !validSpace(x)).map(x => ({ kind: 'espace', id: x.id, nom: x.nom, reason: INVALID_SPACE })),
    ...modèles.filter(x => !validTemplate(x)).map(x => ({ kind: 'modèle', id: x.id, nom: x.nom, reason: INVALID_TEMPLATE }))
  ];
  const input = { espaces: espaces.filter(validSpace), modèles: modèles.filter(validTemplate), usage };
  const ticket = ticketFor(input, { quiet: true, refused });
  if (!input.espaces.length && !input.modèles.length) {
    ticket.settle({ sent: true, refused: [] });
    return ticket;
  }
  enqueue({ apply: mergeOp(input), label: 'l’import des espaces et modèles de cet appareil', ticket });
  return ticket;
}

/*
 * Reprise (espaces d'avant cette version marqués à un compte, favoris d'un ancien miroir) : écrite dans l'ancien
 * stockage de l'appareil de ce compte, qui part au serveur au chargement du compte (ou aussitôt s'il est déjà chargé)
 * et n'en est effacé qu'après son accord. Rend false si le stockage est plein : l'appelant garde alors sa copie.
 */
export function adopt(id, { espaces = [], favoris = [], placement = {} } = {}) {
  if (!id || (!espaces.length && !favoris.length && !Object.keys(placement).length)) return true;
  try {
    const d = readFor(id);
    mergeOp({ espaces, favoris, placement })(d);
    writeFor(id, d);
  } catch (e) {
    console.warn('Reprise impossible :', e);
    return false;
  }
  const s = id === current ? accounts.get(id) : null;
  if (s?.loaded && !s.migration) {
    s.migrationTried = false;
    startMigration(s);
    changed();
    schedule(s, 0);
  }
  return true;
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
  }, on ? 'l’ajout d’un favori' : 'le retrait d’un favori');
}

export function setPlacement(boardId, spaceId) {
  return tryUpdate(d => {
    if (spaceId) d.placement[boardId] = spaceId;
    else delete d.placement[boardId];
  }, 'le rangement d’un tableau dans un espace');
}

export function forgetBoard(boardId) {
  if (!current) return;
  const d = read();
  if (!d.favoris.includes(boardId) && !d.placement[boardId]) return;
  tryUpdate(x => {
    x.favoris = x.favoris.filter(f => f !== boardId);
    delete x.placement[boardId];
  }, 'le retrait d’un tableau des favoris et des espaces');
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
  update(d => { if (!d.espaces.some(s => s.id === space.id)) d.espaces.push({ ...space }); }, `la création de l’espace « ${nom} »`);
  return space;
}

export function renameSpace(id, nom) {
  update(d => {
    const space = d.espaces.find(s => s.id === id);
    if (space) space.nom = nom;
  }, `le nouveau nom d’espace « ${nom} »`);
}

export function removeSpace(id) {
  const nom = read().espaces.find(s => s.id === id)?.nom;
  update(d => {
    d.espaces = d.espaces.filter(s => s.id !== id);
    for (const [board, space] of Object.entries(d.placement)) if (space === id) delete d.placement[board];
  }, nom ? `la suppression de l’espace « ${nom} »` : 'la suppression d’un espace');
}

/* ---- Mes modèles ---- */

export function templates() {
  return read().modèles;
}

export function addTemplates(list) {
  const label = list.length === 1 ? `le modèle « ${list[0].nom} »` : `${list.length} modèles`;
  update(mergeOp({ modèles: list }), label);
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
  const gone = read().modèles.find(t => removed.includes(t.id));
  const label = removed.length === 1 && gone ? `la suppression du modèle « ${gone.nom} »` : 'la modification de « Mes modèles »';
  update(d => {
    d.modèles = d.modèles.filter(t => !removed.includes(t.id));
    for (const t of after) {
      const i = d.modèles.findIndex(m => m.id === t.id);
      if (i >= 0) d.modèles[i] = structuredClone(t);
      else d.modèles.push(structuredClone(t));
    }
  }, label);
}

export function usage() {
  return read().usage;
}

export function markUsed(templateId) {
  if (!current) return;
  const at = Date.now();
  tryUpdate(d => { if (!(d.usage[templateId] >= at)) d.usage[templateId] = at; }, 'l’historique d’usage d’un modèle');
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
