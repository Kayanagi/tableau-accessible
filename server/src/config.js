/* Configuration lue dans l'environnement. Toute valeur incohérente arrête le démarrage. */
export const PROD_SCRYPT_N = 2 ** 16;
const COOKIE_NAME = '__Host-baro_sid';
const INSECURE_COOKIE_NAME = 'baro_sid';

function parseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`BARO_ORIGIN invalide : ${value}`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new Error(`BARO_ORIGIN doit être une origine exacte, sans chemin ni barre finale : ${value}`);
  }
  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT invalide : ${value}`);
  return port;
}

function parseScryptN(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 2 ** 20 || (n & (n - 1)) !== 0) {
    throw new Error(`BARO_SCRYPT_N doit être une puissance de 2 comprise entre 2 et 2^20 : ${value}`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = parseOrigin(env.BARO_ORIGIN ?? 'https://baro.dwes.fr');
  const inscriptions = env.BARO_INSCRIPTIONS ?? 'ouvert';
  if (!['ouvert', 'ferme'].includes(inscriptions)) throw new Error(`BARO_INSCRIPTIONS doit valoir « ouvert » ou « ferme » : ${inscriptions}`);

  const insecureCookie = env.BARO_INSECURE_COOKIE === '1';
  if (env.BARO_INSECURE_COOKIE !== undefined && env.BARO_INSECURE_COOKIE !== '1' && env.BARO_INSECURE_COOKIE !== '0') {
    throw new Error('BARO_INSECURE_COOKIE doit valoir 0 ou 1');
  }
  if (production && insecureCookie) throw new Error('BARO_INSECURE_COOKIE est refusée quand NODE_ENV=production');

  const N = env.BARO_SCRYPT_N === undefined ? PROD_SCRYPT_N : parseScryptN(env.BARO_SCRYPT_N);
  if (production && N < PROD_SCRYPT_N) throw new Error(`BARO_SCRYPT_N ne peut pas descendre sous ${PROD_SCRYPT_N} quand NODE_ENV=production`);
  if (production && !origin.startsWith('https://')) throw new Error('BARO_ORIGIN doit être en https quand NODE_ENV=production');

  return {
    production,
    port: parsePort(env.PORT ?? 3006),
    dbPath: env.BARO_DB ?? '/var/lib/baro/baro.db',
    origin,
    inscriptionsOpen: inscriptions === 'ouvert',
    // Le préfixe __Host- impose Secure : le mode de test local change donc aussi de nom de cookie.
    cookie: { name: insecureCookie ? INSECURE_COOKIE_NAME : COOKIE_NAME, secure: !insecureCookie },
    scrypt: { N, r: 8, p: 2, concurrency: 2, queue: 10 }
  };
}
