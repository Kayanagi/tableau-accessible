import http from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { HttpError, Router, createHandler, tooMany } from './http.js';
import { createPasswords, createSessions } from './auth.js';
import { createRateLimiter } from './rate-limit.js';
import { createInactivity } from './inactivity.js';
import { createSendmail } from './mail.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerBoardRoutes } from './routes/boards.js';

const HOST = '127.0.0.1';
const WRITES_PER_MINUTE = 120;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export function createApp(config) {
  const db = openDb(config.dbPath);
  const app = {
    config,
    db,
    passwords: createPasswords(config.scrypt),
    sessions: createSessions(db, config),
    limiter: createRateLimiter(),
    /* Les limites IP de route sont appliquées avant toute lecture du corps. */
    prepare(ctx, options) {
      if (options.ipRate) {
        const wait = app.limiter.hit(options.ipRate.bucket, ctx.ipKey, options.ipRate.limit, options.ipRate.windowMs);
        if (wait) throw tooMany(wait);
      }
      if (!options.auth) return;
      const { session, setCookie } = app.sessions.resolve(ctx.req);
      if (!session) throw new HttpError(401, 'unauthenticated', 'Vous devez vous connecter pour continuer.');
      if (options.auth === 'account' && session.guest) throw new HttpError(403, 'account_required', 'Cette action demande un compte.');
      if (ctx.req.method !== 'GET') {
        const wait = app.limiter.hit('writes', session.key, WRITES_PER_MINUTE, MINUTE);
        if (wait) throw tooMany(wait);
      }
      if (options.rate) {
        const key = options.rate.account ? session.userId : session.key;
        const wait = app.limiter.hit(options.rate.bucket, key, options.rate.limit, options.rate.windowMs);
        if (wait) throw tooMany(wait);
      }
      ctx.session = session;
      if (setCookie) ctx.headers['Set-Cookie'] = setCookie;
    }
  };

  const router = new Router();
  registerAuthRoutes(router, app);
  registerMeRoutes(router, app);
  registerBoardRoutes(router, app);

  const server = http.createServer(createHandler(router, app));
  server.requestTimeout = 30 * 1000;
  server.headersTimeout = 15 * 1000;

  app.sessions.purgeExpired();
  const sweep = setInterval(() => {
    app.sessions.purgeExpired();
    app.limiter.sweep();
  }, HOUR);
  sweep.unref();

  app.server = server;
  app.listen = port => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
  app.close = () => new Promise(resolve => {
    clearInterval(sweep);
    server.close(() => {
      db.close();
      resolve();
    });
    server.closeIdleConnections();
  });
  return app;
}

/* Hors de createApp : les tests du serveur HTTP ne peuvent pas démarrer ce passage par accident. */
export function startInactivity(app, send, options = {}) {
  const inactivity = createInactivity({ db: app.db, send, ...options });
  inactivity.start();
  return inactivity;
}

async function main() {
  const config = loadConfig();
  const app = createApp(config);
  const port = await app.listen(config.port);
  console.log(`[baro] à l'écoute sur ${HOST}:${port}, origine ${config.origin}`);
  if (!config.cookie.secure) console.warn('[baro] cookie sans Secure : usage local uniquement');
  const inactivity = config.inactivityEnabled ? startInactivity(app, createSendmail({ from: config.mailFrom }).send) : null;
  console.log(`[baro] suppression des comptes inactifs : ${inactivity ? 'active' : 'désactivée'}`);
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    const force = setTimeout(() => process.exit(1), 5000);
    force.unref();
    inactivity?.stop();
    app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`[baro] démarrage impossible : ${err.message}`);
    process.exit(1);
  });
}
