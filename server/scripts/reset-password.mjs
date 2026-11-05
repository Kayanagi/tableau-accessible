#!/usr/bin/env node
/*
 * Réinitialise un mot de passe et ferme toutes les sessions du compte.
 * Usage : BARO_DB=/var/lib/baro/baro.db node server/scripts/reset-password.mjs <e-mail>
 * Le mot de passe est lu au clavier sans écho, ou sur l'entrée standard : jamais en argument,
 * il resterait visible dans l'historique et dans la liste des processus.
 */
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createPasswords } from '../src/auth.js';
import { isValidEmail, isValidPassword, normalizeEmail, normalizePassword } from '../src/validate.js';

function die(message) {
  console.error(message);
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise(resolve => {
    process.stdout.write(prompt);
    const { stdin } = process;
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = chunk => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f') value = [...value].slice(0, -1).join('');
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword() {
  if (process.stdin.isTTY) {
    const first = await askHidden('Nouveau mot de passe : ');
    const second = await askHidden('Confirmation : ');
    if (first !== second) die('Les deux saisies diffèrent.');
    return first;
  }
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text.replace(/\r?\n$/, '');
}

const email = normalizeEmail(process.argv[2]);
if (!isValidEmail(email)) die('Usage : node server/scripts/reset-password.mjs <e-mail>');

const config = loadConfig();
const password = normalizePassword(await readPassword());
if (!isValidPassword(password)) die('Le mot de passe doit contenir de 12 à 128 caractères.');

const db = openDb(config.dbPath);
try {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) die(`Aucun compte pour ${email}.`);
  const hash = await createPasswords(config.scrypt).hash(password);
  const closed = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, Date.now(), user.id);
    return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
  })();
  console.log(`Mot de passe de ${email} remplacé, ${closed} session(s) fermée(s).`);
} finally {
  db.close();
}
