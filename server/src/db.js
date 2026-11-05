import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrations.js';

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Le fichier existe en 600 avant l'ouverture : SQLite en recopie les droits sur -wal et -shm.
  closeSync(openSync(path, 'a', 0o600));
  chmodSync(path, 0o600);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}
