import { HttpError, tooMany } from '../http.js';
import { newId, publicUser } from '../auth.js';
import { isValidEmail, isValidPassword, normalizeDisplayName, normalizeEmail, normalizePassword } from '../validate.js';

const MIN = 60 * 1000;
const WRONG_LOGIN = 'E-mail ou mot de passe incorrect';

function invalid(code, message) {
  return new HttpError(400, code, message);
}

export function registerAuthRoutes(router, app) {
  const { db, passwords, sessions, limiter, config } = app;
  const findUser = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  const rehash = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND password_hash = ?');

  function limit(bucket, key, max, windowMs) {
    const wait = limiter.hit(bucket, key, max, windowMs);
    if (wait) throw tooMany(wait);
  }

  function openSession(ctx, userId) {
    const previous = sessions.tokenOf(ctx.req);
    if (previous) sessions.destroyByToken(previous);
    return sessions.setCookie(sessions.create(userId));
  }

  router.add('POST', '/api/auth/register', async ctx => {
    if (!config.inscriptionsOpen) throw new HttpError(403, 'registrations_closed', 'Les inscriptions sont fermées pour le moment.');
    const email = normalizeEmail(ctx.body.email);
    const password = normalizePassword(ctx.body.password);
    const displayName = normalizeDisplayName(ctx.body.displayName);
    if (!isValidEmail(email)) throw invalid('invalid_email', 'Adresse e-mail invalide.');
    if (!isValidPassword(password)) throw invalid('invalid_password', 'Le mot de passe doit contenir de 12 à 128 caractères.');
    if (!displayName) throw invalid('invalid_display_name', 'Le nom affiché doit contenir de 1 à 50 caractères.');
    limit('register-ip', ctx.ip, 5, 60 * MIN);

    const taken = () => new HttpError(409, 'email_taken', 'Un compte existe déjà avec cette adresse e-mail.');
    if (findUser.get(email)) throw taken();
    const hash = await passwords.hash(password);
    const id = newId('u_');
    const t = Date.now();
    try {
      insertUser.run(id, email, displayName, hash, t, t);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw taken();
      throw err;
    }
    return {
      status: 201,
      headers: { 'Set-Cookie': openSession(ctx, id) },
      body: { guest: false, user: { id, email, displayName, createdAt: t } }
    };
  });

  router.add('POST', '/api/auth/login', async ctx => {
    if (typeof ctx.body.email !== 'string' || typeof ctx.body.password !== 'string') {
      throw invalid('invalid_input', 'L’e-mail et le mot de passe sont requis.');
    }
    const email = normalizeEmail(ctx.body.email).slice(0, 320);
    const password = normalizePassword(ctx.body.password);
    limit('login-ip', ctx.ip, 10, 15 * MIN);
    limit('login-email', email, 5, 15 * MIN);

    const user = isValidEmail(email) ? findUser.get(email) : undefined;
    const usable = user && isValidPassword(password);
    // Compte inconnu ou mot de passe hors format : même coût, même réponse.
    const ok = usable ? await passwords.verify(password, user.password_hash) : await passwords.fakeVerify(password.slice(0, 256));
    if (!ok) throw new HttpError(401, 'bad_credentials', WRONG_LOGIN);

    if (passwords.needsRehash(user.password_hash)) {
      // Relèvement des paramètres : une file saturée ne doit pas faire échouer la connexion.
      try { rehash.run(await passwords.hash(password), Date.now(), user.id, user.password_hash); }
      catch (err) { console.error('[baro] relèvement du hachage reporté :', err.code || err.message); }
    }
    return {
      headers: { 'Set-Cookie': openSession(ctx, user.id) },
      body: { guest: false, user: publicUser(user) }
    };
  });

  router.add('POST', '/api/auth/logout', ctx => {
    sessions.destroy(ctx.session.hash);
    return { status: 204, headers: { 'Set-Cookie': sessions.clearCookie() } };
  }, { auth: 'session' });
}
