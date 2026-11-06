/*
 * Appels à l'API du serveur. Module chargé par import() dynamique : le mode local ne l'exécute jamais.
 * Toute écriture porte Content-Type: application/json, même sans corps (garde CSRF du serveur).
 */
const TIMEOUT_MS = 30000;
const KEEPALIVE_MAX = 60 * 1024;
const UNREACHABLE_MESSAGE = 'Serveur injoignable. Vérifiez votre connexion ou réessayez plus tard.';

export class ApiError extends Error {
  constructor({ status = 0, code = 'unreachable', message = UNREACHABLE_MESSAGE, path, rev, retryAfter = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.path = path;
    this.rev = rev;
    this.retryAfter = retryAfter;
  }

  /* Vrai quand réessayer plus tard a un sens : réseau, passerelle, surcharge ou débit. */
  get unreachable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

let onUnauthorized = () => {};
let onReachability = () => {};

export function setHandlers(handlers) {
  onUnauthorized = handlers.unauthorized || onUnauthorized;
  onReachability = handlers.reachability || onReachability;
}

async function request(method, path, { body, keepalive = false } = {}) {
  const init = { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    if (body !== undefined) init.body = JSON.stringify(body);
    // Le navigateur refuse keepalive au-delà de 64 Kio : le gros tableau reste dans le miroir.
    if (keepalive && (init.body?.length || 0) < KEEPALIVE_MAX) init.keepalive = true;
  }
  if (!init.keepalive) init.signal = AbortSignal.timeout(TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    onReachability(false);
    throw new ApiError({});
  }
  const text = await res.text().catch(() => '');
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }

  // Une réponse sans JSON vient d'une passerelle ou du statique : l'API n'a pas répondu.
  if (!res.ok && !json?.code) {
    onReachability(false);
    throw new ApiError({ status: res.status >= 500 ? res.status : 0 });
  }
  if (res.ok && text && json === null) {
    onReachability(false);
    throw new ApiError({});
  }
  // Une erreur JSON vient de l'API elle-même : le serveur répond, son message suffit.
  onReachability(true);
  if (res.ok) return json;

  const retry = Number(res.headers.get('Retry-After'));
  const error = new ApiError({ status: res.status, code: json.code, message: json.message, path: json.path, rev: json.rev, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null });
  if (res.status === 401 && json.code === 'unauthenticated') onUnauthorized(error);
  throw error;
}

const board = id => `/boards/${encodeURIComponent(id)}`;

export const register = fields => request('POST', '/auth/register', { body: fields });
export const login = fields => request('POST', '/auth/login', { body: fields });
export const logout = () => request('POST', '/auth/logout');

export const getMe = () => request('GET', '/me');
export const updateMe = fields => request('PATCH', '/me', { body: fields });
export const changePassword = fields => request('POST', '/me/password', { body: fields });
export const deleteMe = fields => request('DELETE', '/me', { body: fields });
export const exportAccount = () => request('GET', '/me/export');

export const listBoards = () => request('GET', '/boards');
export const createBoard = fields => request('POST', '/boards', { body: fields });
export const getBoard = id => request('GET', board(id));
export const putBoardData = (id, baseRev, data, options = {}) => request('PUT', `${board(id)}/data`, { body: { baseRev, data }, ...options });
export const patchBoard = (id, fields) => request('PATCH', board(id), { body: fields });
export const deleteBoard = id => request('DELETE', board(id));
