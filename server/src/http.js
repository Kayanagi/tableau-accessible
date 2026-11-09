import { isIP } from 'node:net';

export const MAX_BODY = 4 * 1024 * 1024;
export const ACCOUNT_BODY = 16 * 1024;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_TYPE = /^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;

export class HttpError extends Error {
  constructor(status, code, message, { headers = {}, extra = {} } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.extra = extra;
  }
}

export function tooMany(retryAfter) {
  const minutes = Math.ceil(retryAfter / 60);
  const wait = retryAfter < 60 ? `${retryAfter} s` : `${minutes} min`;
  return new HttpError(429, 'rate_limited', `Trop de tentatives. Réessayez dans ${wait}.`, { headers: { 'Retry-After': String(retryAfter) } });
}

/* X-Real-IP n'est écrit que par nginx : on ne le croit que si le pair TCP est la machine elle-même. */
export function clientIp(req) {
  const peer = req.socket?.remoteAddress || '';
  if (peer === '127.0.0.1' || peer === '::ffff:127.0.0.1') {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && isIP(real.trim())) return real.trim();
  }
  return peer;
}

/* Une adresse IPv6 partage sa clé de débit avec tout son préfixe /64. */
export function ipPrefix(value) {
  if (typeof value !== 'string') return '';
  const ip = value.trim().toLowerCase();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return ip;
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${words.slice(0, 4).map(word => Number.parseInt(word || '0', 16).toString(16)).join(':')}::/64`;
}

export function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (!out.has(name)) out.set(name, part.slice(at + 1).trim());
  }
  return out;
}

export class Router {
  routes = [];

  add(method, pattern, handler, options = {}) {
    const names = [];
    const source = pattern.replace(/:(\w+)/g, (_, name) => { names.push(name); return '([\\w-]{1,128})'; });
    this.routes.push({ method, regex: new RegExp(`^${source}$`), names, handler, options });
  }

  match(method, path) {
    const allowed = new Set();
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      if (route.method !== method) { allowed.add(route.method); continue; }
      return { route, params: Object.fromEntries(route.names.map((name, i) => [name, m[i + 1]])) };
    }
    return { allowed: [...allowed] };
  }
}

/* Garde CSRF : même origine exacte et corps JSON sur toute écriture, routes inconnues comprises. */
export function guardWrite(req, origin) {
  if (req.headers.origin !== origin) throw new HttpError(403, 'bad_origin', 'Origine de la requête refusée.');
  const type = req.headers['content-type'];
  if (typeof type !== 'string' || !JSON_TYPE.test(type.trim())) {
    throw new HttpError(415, 'bad_content_type', 'La requête doit être envoyée au format JSON (Content-Type: application/json).');
  }
}

function tooLarge(limit) {
  const mib = Math.round(limit / (1024 * 1024) * 10) / 10;
  const amount = limit < 1024 * 1024 ? `${Math.ceil(limit / 1024)} Kio` : `${String(mib).replace('.', ',')} Mio`;
  return new HttpError(413, 'body_too_large', `La requête dépasse la taille maximale de ${amount}.`);
}

export function readJsonBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) return reject(tooLarge(limit));
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > limit) { over = true; chunks.length = 0; reject(tooLarge(limit)); return; }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (over) return;
      if (!size) return resolve({});
      let value;
      try { value = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
      catch { return reject(new HttpError(400, 'invalid_json', 'Le corps de la requête n’est pas un JSON valide.')); }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return reject(new HttpError(400, 'invalid_json', 'Le corps de la requête doit être un objet JSON.'));
      }
      resolve(value);
    });
  });
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (body === undefined) { res.end(); return; }
  const text = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

/*
 * Ordre de contrôle : garde CSRF, route, session, débit par session, corps, traitement.
 * `prepare(ctx, route)` applique session et débit ; le corps n'est lu qu'ensuite.
 */
export function createHandler(router, app) {
  return async function handle(req, res) {
    try {
      let path;
      try { path = new URL(req.url, 'http://localhost').pathname; }
      catch { throw new HttpError(400, 'bad_request', 'Adresse de requête invalide.'); }
      if (WRITE_METHODS.has(req.method)) guardWrite(req, app.config.origin);

      const { route, params, allowed } = router.match(req.method, path);
      if (!route) {
        if (allowed?.length) throw new HttpError(405, 'method_not_allowed', 'Méthode non autorisée sur cette adresse.', { headers: { Allow: allowed.join(', ') } });
        throw new HttpError(404, 'not_found', 'Adresse introuvable.');
      }

      const ip = clientIp(req);
      const ctx = { req, res, params, ip, ipKey: ipPrefix(ip), body: {}, session: null, headers: {} };
      app.prepare(ctx, route.options);
      if (WRITE_METHODS.has(req.method)) ctx.body = await readJsonBody(req, route.options.bodyLimit ?? MAX_BODY);
      const result = (await route.handler(ctx)) ?? {};
      if (result.handled) return;
      send(res, result.status ?? 200, result.body, { ...ctx.headers, ...result.headers });
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) {
        send(res, err.status, { code: err.code, message: err.message, ...err.extra }, err.headers);
        return;
      }
      console.error(`[baro] erreur ${req.method} ${String(req.url).split('?')[0]} :`, err);
      send(res, 500, { code: 'internal', message: 'Erreur interne du serveur. Réessayez dans un instant.' });
    }
  };
}
