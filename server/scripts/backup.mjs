#!/usr/bin/env node
/*
 * Sauvegarde quotidienne par VACUUM INTO : copie cohérente, sans arrêter le serveur.
 * BARO_DB : base source. BARO_BACKUP_DIR : destination (/var/backups/baro). 14 jours conservés.
 */
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const KEEP_DAYS = 14;
const DAY = 24 * 3600 * 1000;
const NAME = /^baro-(\d{4}-\d{2}-\d{2})\.db$/;

const source = process.env.BARO_DB ?? '/var/lib/baro/baro.db';
const directory = process.env.BARO_BACKUP_DIR ?? '/var/backups/baro';
const today = new Date().toISOString().slice(0, 10);
const target = join(directory, `baro-${today}.db`);
const partial = `${target}.partiel`;

mkdirSync(directory, { recursive: true, mode: 0o700 });
rmSync(partial, { force: true });

const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  db.prepare('VACUUM INTO ?').run(partial);
} finally {
  db.close();
}
chmodSync(partial, 0o600);
renameSync(partial, target);

// Seuls les fichiers nommés par ce script sont retirés.
const limit = Date.now() - KEEP_DAYS * DAY;
let removed = 0;
for (const name of readdirSync(directory)) {
  const date = NAME.exec(name)?.[1];
  if (date && Date.parse(`${date}T00:00:00Z`) < limit) {
    rmSync(join(directory, name));
    removed++;
  }
}
console.log(`Sauvegarde écrite : ${target}, ${removed} ancienne(s) retirée(s).`);
