import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { domainToASCII } from 'node:url';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { startInactivity } from '../src/index.js';
import { BATCH_SIZE, DELETE_AFTER_DAYS, NOTICE_DAYS, WARN_AFTER_DAYS, WARNING_SUBJECT, WARNING_TEXT, createInactivity } from '../src/inactivity.js';
import { createSendmail } from '../src/mail.js';
import { MIGRATIONS } from '../src/migrations.js';
import { hashToken } from '../src/auth.js';
import { PASSWORD, startServer, tokenFrom } from './helpers.js';

const DAY = 24 * 3600 * 1000;
const silent = { log() {}, error() {} };

/* Aucun test n'envoie de vrai e-mail : `send` est un faux, ou sendmail est un script temporaire. */
function harness(db, { result = true, log = silent } = {}) {
  const clock = { t: Date.now() };
  const sent = [];
  const send = async mail => {
    sent.push(mail);
    return typeof result === 'function' ? result(mail) : result;
  };
  return { clock, sent, inactivity: createInactivity({ db, send, now: () => clock.t, pauseMs: 0, log }) };
}

describe('comptes inactifs', () => {
  let s;
  let db;
  const dated = (id, activeDaysAgo, clock, warnedDaysAgo = null) => db
    .prepare('UPDATE users SET last_active_at = ?, inactivity_warned_at = ? WHERE id = ?')
    .run(clock.t - activeDaysAgo * DAY, warnedDaysAgo === null ? null : clock.t - warnedDaysAgo * DAY, id);
  const account = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  before(async () => {
    s = await startServer();
    db = s.app.db;
  });
  after(() => s.close());

  it('laisse intact un compte actif ou juste sous le seuil', async () => {
    const h = harness(db);
    const fresh = await s.signUp();
    const under = await s.signUp();
    dated(under.id, WARN_AFTER_DAYS - 1, h.clock);
    assert.deepEqual(await h.inactivity.run(), { warned: 0, deleted: 0, failed: 0 });
    assert.equal(h.sent.length, 0);
    assert.equal(account(fresh.id).inactivity_warned_at, null);
    assert.equal(account(under.id).inactivity_warned_at, null);
    db.prepare('DELETE FROM users').run();
  });

  it('avertit une seule fois après 700 jours, sans donnée de jeton dans le message', async () => {
    const h = harness(db);
    const u = await s.signUp();
    dated(u.id, WARN_AFTER_DAYS + 1, h.clock);
    assert.equal((await h.inactivity.run()).warned, 1);
    assert.equal(account(u.id).inactivity_warned_at, h.clock.t);
    h.clock.t += DAY;
    assert.equal((await h.inactivity.run()).warned, 0);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].to, u.email);
    assert.equal(h.sent[0].subject, WARNING_SUBJECT);
    assert.match(h.sent[0].text, /bientôt 24 mois/);
    assert.match(h.sent[0].text, /supprimé avec ses tableaux dans 30 jours/);
    assert.match(h.sent[0].text, /https:\/\/baro\.dwes\.fr\n/);
    assert.match(h.sent[0].text, /rgpd@dwes\.fr/);
    assert.doesNotMatch(h.sent[0].text, /[?&=]|jeton|token/);
    db.prepare('DELETE FROM users').run();
  });

  it('un envoi échoué ne pose pas de date, ne supprime rien, même à 25 mois, et réessaie', async () => {
    const lines = [];
    const log = { log: line => lines.push(line), error: line => lines.push(line) };
    let outcome = () => { throw new Error('relais hors service'); };
    const h = harness(db, { result: () => outcome(), log });
    const u = await s.signUp();
    dated(u.id, DELETE_AFTER_DAYS + 30, h.clock);
    assert.deepEqual(await h.inactivity.run(), { warned: 0, deleted: 0, failed: 1 });
    outcome = () => false;
    h.clock.t += 40 * DAY;
    assert.deepEqual(await h.inactivity.run(), { warned: 0, deleted: 0, failed: 1 });
    outcome = () => undefined; // seule la réponse true vaut réussite
    assert.equal((await h.inactivity.run()).warned, 0);
    assert.equal(account(u.id).inactivity_warned_at, null);
    outcome = () => true;
    assert.equal((await h.inactivity.run()).warned, 1);
    assert.equal(h.sent.length, 4);
    assert.ok(lines.length > 0);
    assert.ok(lines.every(line => !line.includes(u.email)), 'aucun e-mail dans les journaux');
    assert.ok(lines.every(line => line.includes(u.id)));
    db.prepare('DELETE FROM users').run();
  });

  it('une connexion après l’avertissement annule tout ; l’export reste sans champ technique', async () => {
    const h = harness(db);
    const u = await s.signUp();
    dated(u.id, DELETE_AFTER_DAYS + 1, h.clock, NOTICE_DAYS + 1);
    const login = await s.call('POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
    assert.equal(login.status, 200);
    assert.deepEqual(Object.keys(login.body.user).sort(), ['createdAt', 'displayName', 'email', 'id']);
    assert.equal(account(u.id).inactivity_warned_at, null);
    assert.ok(account(u.id).last_active_at >= h.clock.t);
    assert.deepEqual(await h.inactivity.run(), { warned: 0, deleted: 0, failed: 0 });
    const exported = await s.call('GET', '/api/me/export', { cookie: tokenFrom(login) });
    assert.deepEqual(Object.keys(exported.body.user).sort(), ['createdAt', 'displayName', 'email', 'id']);
    db.prepare('DELETE FROM users').run();
  });

  it('l’activité d’une session annule tout, même pendant l’envoi de l’avertissement', async () => {
    const h = harness(db);
    const u = await s.signUp();
    dated(u.id, DELETE_AFTER_DAYS + 1, h.clock, NOTICE_DAYS + 1);
    const hash = hashToken(u.token);
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(Date.now() - 2 * 3600 * 1000, hash);
    assert.equal((await s.call('GET', '/api/me', { cookie: u.token })).status, 200);
    assert.equal(account(u.id).inactivity_warned_at, null);
    assert.ok(account(u.id).last_active_at >= h.clock.t);

    dated(u.id, WARN_AFTER_DAYS + 1, h.clock);
    const racing = harness(db, { result: () => {
      db.prepare('UPDATE users SET last_active_at = ?, inactivity_warned_at = NULL WHERE id = ?').run(Date.now(), u.id);
      return true;
    } });
    racing.clock.t = h.clock.t;
    assert.equal((await racing.inactivity.run()).warned, 0);
    assert.equal(account(u.id).inactivity_warned_at, null);
    db.prepare('DELETE FROM users').run();
  });

  it('ne supprime qu’au bout de 30 jours d’avertissement et 730 jours d’inactivité, jamais avant', async () => {
    const h = harness(db);
    const u = await s.signUp();
    dated(u.id, WARN_AFTER_DAYS + 1, h.clock);
    assert.equal((await h.inactivity.run()).warned, 1);
    h.clock.t += (NOTICE_DAYS - 1) * DAY;
    assert.equal((await h.inactivity.run()).deleted, 0);
    h.clock.t += DAY - 1;
    assert.equal((await h.inactivity.run()).deleted, 0, 'une milliseconde avant les 30 jours');
    assert.ok(account(u.id));
    h.clock.t += 1;
    assert.equal((await h.inactivity.run()).deleted, 1);
    assert.equal(account(u.id), undefined);
    assert.equal(h.sent.length, 1);

    const recent = await s.signUp();
    dated(recent.id, DELETE_AFTER_DAYS + 200, h.clock, NOTICE_DAYS - 1);
    const notOldEnough = await s.signUp();
    dated(notOldEnough.id, DELETE_AFTER_DAYS - 1, h.clock, NOTICE_DAYS + 1);
    assert.equal((await h.inactivity.run()).deleted, 0);
    assert.ok(account(recent.id) && account(notOldEnough.id));
    db.prepare('DELETE FROM users').run();
  });

  it('supprime tableaux possédés et sessions, laisse intacts les tableaux d’autrui', async () => {
    const h = harness(db);
    const gone = await s.signUp();
    const other = await s.signUp();
    const board = async (owner, name) => (await s.call('POST', '/api/boards', { cookie: owner.token, body: { name } })).body.board.id;
    const owned = await board(gone, 'Le sien');
    const foreign = await board(other, 'Celui d’autrui');
    db.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'editor', 0)").run(foreign, gone.id);
    db.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'viewer', 0)").run(owned, other.id);
    dated(gone.id, DELETE_AFTER_DAYS + 1, h.clock, NOTICE_DAYS);
    assert.equal((await h.inactivity.run()).deleted, 1);

    const count = (sql, ...args) => db.prepare(`SELECT COUNT(*) n FROM ${sql}`).get(...args).n;
    assert.equal(count('users WHERE id = ?', gone.id), 0);
    assert.equal(count('sessions WHERE user_id = ?', gone.id), 0);
    assert.equal(count('board_members WHERE user_id = ?', gone.id), 0);
    assert.equal(count('boards WHERE id = ?', owned), 0);
    assert.equal(count('boards WHERE id = ?', foreign), 1);
    assert.equal(count('users WHERE id = ?', other.id), 1);
    assert.equal(count('sessions WHERE user_id = ?', other.id), 1);
    db.prepare('DELETE FROM boards').run();
    db.prepare('DELETE FROM users').run();
  });

  it('borne le lot à 100 comptes et n’affame pas ceux qui suivent des comptes en échec', async () => {
    const attempts = [];
    const h = harness(db, { result: mail => { attempts.push(mail.to); return false; } });
    const insert = db.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at, last_active_at) VALUES (?, ?, 'N', 'x', 0, 0, ?)");
    const total = BATCH_SIZE + 5;
    db.transaction(() => {
      for (let i = 0; i < total; i++) insert.run(`u_${String(i).padStart(4, '0')}`, `lot${i}@exemple.test`, h.clock.t - (WARN_AFTER_DAYS + 1) * DAY);
    })();
    await h.inactivity.run();
    assert.equal(attempts.length, BATCH_SIZE);
    await h.inactivity.run();
    assert.equal(new Set(attempts).size, total);
    // Les suppressions comptent dans le même lot : un lot plein ne laisse aucun envoi.
    db.prepare('UPDATE users SET inactivity_warned_at = ?, last_active_at = ?').run(h.clock.t - NOTICE_DAYS * DAY, h.clock.t - (DELETE_AFTER_DAYS + 1) * DAY);
    db.prepare('UPDATE users SET inactivity_warned_at = NULL WHERE id = ?').run('u_0000');
    attempts.length = 0;
    assert.equal((await h.inactivity.run()).deleted, BATCH_SIZE);
    assert.equal(attempts.length, 0);
    db.prepare('DELETE FROM users').run();
  });

  it('un passage en erreur est journalisé sans chute, le suivant fonctionne ; démarrage et configuration', async () => {
    const prod = { NODE_ENV: 'production' };
    assert.equal(loadConfig(prod).inactivityEnabled, true);
    assert.equal(loadConfig(prod).mailFrom, 'contact@dwes.fr');
    assert.equal(loadConfig({ ...prod, BARO_INACTIVITY: 'inactif' }).inactivityEnabled, false);
    assert.equal(loadConfig({}).inactivityEnabled, false);
    assert.equal(loadConfig({ ...prod, BARO_MAIL_FROM: 'baro@dwes.fr' }).mailFrom, 'baro@dwes.fr');
    assert.throws(() => loadConfig({ BARO_INACTIVITY: 'oui' }), /BARO_INACTIVITY/);
    assert.throws(() => loadConfig({ BARO_MAIL_FROM: 'a@b.fr\r\nBcc: x@y.fr' }), /BARO_MAIL_FROM/);
    const lines = [];
    const u = await s.signUp();
    let broken = true;
    const sent = [];
    const clockValue = Date.now();
    const inactivity = startInactivity(s.app, async mail => { sent.push(mail); return true; }, {
      now: () => {
        if (broken) throw Object.assign(new Error(u.email), { code: 'PANNE_TEST' });
        return clockValue;
      },
      pauseMs: 0,
      log: { log: line => lines.push(line), error: line => lines.push(line) }
    });
    assert.deepEqual(await inactivity.run(), { warned: 0, deleted: 0, failed: 1 });
    assert.deepEqual(lines, ['[baro] passage d’inactivité interrompu : PANNE_TEST']);
    broken = false;
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(clockValue - (WARN_AFTER_DAYS + 1) * DAY, u.id);
    assert.equal((await inactivity.run()).warned, 1);
    assert.equal(sent.length, 1);
    inactivity.stop();
    db.prepare('DELETE FROM users').run();
  });
});

describe('migration', () => {
  it('migre une base existante sans perte, de façon idempotente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baro-migration-'));
    const path = join(dir, 'baro.db');
    const old = new Database(path);
    old.exec(MIGRATIONS[0]);
    old.pragma('user_version = 1');
    const insert = old.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, 'N', 'x', ?, ?)");
    insert.run('u_sans', 'sans@exemple.test', 1000, 9000);
    insert.run('u_avec', 'avec@exemple.test', 1000, 1000);
    const session = old.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, 0, ?, 0)');
    session.run(Buffer.from('a'), 'u_avec', 5000);
    session.run(Buffer.from('b'), 'u_avec', 7000);
    old.prepare('INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, ?, 0, 0)').run('brd', 'Tableau');
    old.close();

    let db = openDb(path);
    assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
    const rows = () => db.prepare('SELECT id, last_active_at AS active, inactivity_warned_at AS warned, updated_at AS updated FROM users ORDER BY id').all();
    const expected = [
      { id: 'u_avec', active: 7000, warned: null, updated: 1000 },
      { id: 'u_sans', active: 1000, warned: null, updated: 9000 }
    ];
    assert.deepEqual(rows(), expected);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM boards').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 2);
    db.close();
    db = openDb(path);
    assert.deepEqual(rows(), expected);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('envoi par sendmail (script temporaire, jamais le vrai)', () => {
  let dir;
  const script = (name, body) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const mail = to => ({ to, subject: WARNING_SUBJECT, text: WARNING_TEXT });

  before(() => { dir = mkdtempSync(join(tmpdir(), 'baro-sendmail-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('refuse retours à la ligne et adresses multiples sans lancer le programme', async () => {
    const marker = join(dir, 'lance');
    const { send } = createSendmail({ from: 'contact@dwes.fr', path: script('marqueur', `touch "${marker}"`) });
    const refused = ['a@b.fr\nBcc: x@y.fr', 'a@b.fr\r\nSubject: x', 'a@b.fr\n', 'a\r@b.fr', 'a,b@c.fr', 'a;b@c.fr', '"a"@c.fr', 'a b@c.fr', 'a@b@c.fr', 'a(b)@c.fr', 'é@c.fr', 'a b@c.fr', '', null];
    for (const to of refused) assert.equal(await send(mail(to)), false, JSON.stringify(to));
    assert.equal(existsSync(marker), false);
    assert.throws(() => createSendmail({ from: 'a@b.fr\nX: y' }), /expéditeur/);
  });

  it('passe l’adresse en argument et écrit un message conforme ; le code de sortie décide', async () => {
    const args = join(dir, 'args');
    const stdin = join(dir, 'stdin');
    const clock = Date.UTC(2026, 10, 6, 12, 30, 0);
    const { send } = createSendmail({ from: 'contact@dwes.fr', now: () => clock, path: script('ok', `printf '%s\\n' "$@" > "${args}"; cat > "${stdin}"`) });
    assert.equal(await send(mail('a+$(id)@b.fr')), false, 'sous-chaîne de shell refusée');
    assert.equal(await send(mail("o'brien+tag@été.fr")), true);
    assert.equal(readFileSync(args, 'utf8'), `-i\n-f\ncontact@dwes.fr\n--\no'brien+tag@${domainToASCII('été.fr')}\n`);

    const message = readFileSync(stdin, 'utf8');
    const split = message.indexOf('\n\n');
    const headers = message.slice(0, split).replace(/\n /g, ' ').split('\n');
    assert.equal(message.slice(split + 2), WARNING_TEXT);
    assert.ok(headers.includes('From: contact@dwes.fr'));
    assert.ok(headers.includes('Content-Type: text/plain; charset=UTF-8'));
    assert.ok(headers.includes('Date: Fri, 06 Nov 2026 12:30:00 +0000'));
    assert.ok(headers.some(line => /^Message-ID: <[0-9a-f]{32}@dwes\.fr>$/.test(line)));
    const subject = headers.find(line => line.startsWith('Subject: ')).slice(9);
    const words = subject.split(' ');
    assert.ok(words.every(word => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(word) && word.length <= 75));
    assert.equal(words.map(word => Buffer.from(word.slice(10, -2), 'base64').toString('utf8')).join(''), WARNING_SUBJECT);
    assert.ok(Buffer.from(message.slice(0, split)).every(byte => byte < 128), 'en-têtes en ASCII');

    const code = script('code3', 'exit 3');
    assert.equal(await createSendmail({ from: 'contact@dwes.fr', path: code }).send(mail('a@b.fr')), false);
    const noRead = script('sans-lecture', 'exec 0<&-; exit 0');
    assert.equal(await createSendmail({ from: 'contact@dwes.fr', path: noRead }).send(mail('a@b.fr')), true);
    assert.equal(await createSendmail({ from: 'contact@dwes.fr', path: join(dir, 'absent') }).send(mail('a@b.fr')), false);
    const hang = script('bloque', 'exec sleep 30');
    assert.equal(await createSendmail({ from: 'contact@dwes.fr', path: hang, timeoutMs: 50 }).send(mail('a@b.fr')), false);
  });
});
