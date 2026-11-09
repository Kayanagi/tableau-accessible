import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/index.js';

export const ORIGIN = 'https://baro.test';
export const PASSWORD = 'correct horse battery';
export const COOKIE = '__Host-baro_sid';

let ipCounter = 0;
export const nextIp = () => { ipCounter++; return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; };

let userCounter = 0;

/* Serveur réel sur port éphémère, avec base temporaire et N de scrypt abaissé par configuration. */
export async function startServer(env = {}, tweak = config => config) {
  const dir = mkdtempSync(join(tmpdir(), 'baro-test-'));
  const dbPath = join(dir, 'baro.db');
  const config = tweak(loadConfig({ NODE_ENV: 'test', PORT: '0', BARO_DB: dbPath, BARO_ORIGIN: ORIGIN, BARO_SCRYPT_N: '1024', ...env }));
  const app = createApp(config);
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;

  /* Appel HTTP : les valeurs par défaut sont celles d'une page légitime du même site. */
  async function call(method, path, { body, cookie, ip = nextIp(), origin = ORIGIN, contentType = 'application/json', raw, cookieName = COOKIE, headers: extraHeaders = {} } = {}) {
    const headers = { 'X-Real-IP': ip };
    if (origin) headers.Origin = origin;
    if (contentType && method !== 'GET') headers['Content-Type'] = contentType;
    if (cookie) headers.Cookie = `${cookieName}=${cookie}`;
    Object.assign(headers, extraHeaders);
    const res = await fetch(base + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, setCookie: res.headers.getSetCookie() };
  }

  /* Crée un compte et renvoie son jeton de session. */
  async function signUp(name = 'Compte') {
    const email = `u${++userCounter}@exemple.test`;
    const res = await call('POST', '/api/auth/register', { body: { email, password: PASSWORD, displayName: name } });
    if (res.status !== 201) throw new Error(`inscription : ${res.status} ${JSON.stringify(res.body)}`);
    return { email, id: res.body.user.id, token: tokenFrom(res) };
  }

  async function close() {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { app, base, call, signUp, close, dbPath, dir };
}

export function tokenFrom(res, name = COOKIE) {
  const line = res.setCookie.find(c => c.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).split(';')[0] : null;
}

export function sticky(id, extra = {}) {
  return { id, type: 'sticky_note', x: 10, y: 20, width: 150, height: 150, content: 'Bonjour', color: 'light_yellow', ...extra };
}
