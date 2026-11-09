/*
 * Serveur de test : statique + /api proxifié, sur une même origine, comme nginx en production.
 * Le vrai serveur Baro tourne dans un processus enfant, avec une base temporaire.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
// La politique de production, sans upgrade-insecure-requests : le test tourne en http.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

export async function startAppServer({ inscriptions = 'ouvert' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'baro-e2e-'));
  // Le serveur écrit chaque e-mail dans ce fichier (BARO_MAIL_CAPTURE), une ligne JSON par message, au lieu de l'envoyer.
  const mailFile = join(dir, 'mails.jsonl');
  let backend = null;
  let backendPort = 0;
  let clientIp = 1;
  // Comme client_max_body_size de nginx : réponse HTML, le serveur Baro n'est même pas contacté.
  let bodyLimit = 4 * 1024 * 1024;

  const statics = (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || file.includes(`${sep}server${sep}`) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('introuvable');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  };

  const proxy = (req, res) => {
    if (!backend) {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<h1>502</h1>');
      return;
    }
    if (Number(req.headers['content-length']) > bodyLimit) {
      req.resume();
      res.writeHead(413, { 'Content-Type': 'text/html' });
      res.end('<html><h1>413 Request Entity Too Large</h1></html>');
      return;
    }
    const upstream = http.request({ host: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: { ...req.headers, 'x-real-ip': `10.0.0.${clientIp}` } }, r => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/html' }); res.end('<h1>502</h1>'); });
    req.pipe(upstream);
  };

  const front = http.createServer((req, res) => (req.url.startsWith('/api/') ? proxy(req, res) : statics(req, res)));
  const port = await listen(front);
  const origin = `http://localhost:${port}`;

  async function startBackend() {
    if (backend) return;
    const probe = http.createServer();
    backendPort = await listen(probe);
    await new Promise(r => probe.close(r));
    const child = spawn(process.execPath, ['server/src/start.js'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', PORT: String(backendPort), BARO_DB: join(dir, 'baro.db'), BARO_ORIGIN: origin, BARO_INSECURE_COOKIE: '1', BARO_SCRYPT_N: '1024', BARO_INSCRIPTIONS: inscriptions, BARO_MAIL_CAPTURE: mailFile, BARO_PUBLIC_URL: origin }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Le serveur Baro ne démarre pas')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('à l\'écoute')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', chunk => { if (!/cookie sans Secure|débit atteint/.test(String(chunk))) console.error(String(chunk)); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Le serveur Baro s'est arrêté : ${code}`)); });
    });
    child.removeAllListeners('exit');
    backend = child;
  }

  async function stopBackend() {
    if (!backend) return;
    const child = backend;
    backend = null;
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  }

  await startBackend();
  return {
    origin,
    startBackend,
    stopBackend,
    /* Change l'adresse vue par le serveur : chaque parcours a ses propres compteurs de débit. */
    nextClient() { clientIp = (clientIp % 250) + 1; },
    setBodyLimit(bytes = 4 * 1024 * 1024) { bodyLimit = bytes; },
    /* E-mails capturés par le serveur, du plus ancien au plus récent ; to filtre par destinataire. */
    mails(to = null) {
      if (!existsSync(mailFile)) return [];
      const all = readFileSync(mailFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
      return to ? all.filter(m => m.to === to) : all;
    },
    async close() {
      await stopBackend();
      front.closeAllConnections();
      await new Promise(r => front.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
