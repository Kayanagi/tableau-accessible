/* Migrations numérotées par PRAGMA user_version : chacune s'exécute une fois, dans une transaction. */
export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'board',
    meta TEXT NOT NULL DEFAULT '{}',
    rev INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE share_links (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('viewer','editor')),
    label TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    last_used_at INTEGER
  );
  CREATE INDEX share_links_board ON share_links(board_id);

  CREATE TABLE board_members (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
    via_link_id TEXT REFERENCES share_links(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (board_id, user_id)
  ) WITHOUT ROWID;
  CREATE UNIQUE INDEX one_owner ON board_members(board_id) WHERE role = 'owner';
  CREATE INDEX members_user ON board_members(user_id);

  CREATE TABLE sessions (
    token_hash BLOB PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    share_link_id TEXT REFERENCES share_links(id) ON DELETE CASCADE,
    guest_name TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    CHECK ((user_id IS NULL) <> (share_link_id IS NULL))
  ) WITHOUT ROWID;

  CREATE TABLE board_items (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    z INTEGER NOT NULL,
    rev INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (board_id, item_id)
  ) WITHOUT ROWID;

  CREATE TABLE board_ops (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    rev INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    client_seq INTEGER NOT NULL,
    actor_name TEXT NOT NULL,
    ops TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (board_id, rev),
    UNIQUE (board_id, client_id, client_seq)
  ) WITHOUT ROWID;
  `,
  `
  ALTER TABLE users ADD COLUMN last_active_at INTEGER;
  ALTER TABLE users ADD COLUMN inactivity_warned_at INTEGER;
  UPDATE users SET last_active_at = MAX(created_at, COALESCE((SELECT MAX(last_seen_at) FROM sessions WHERE sessions.user_id = users.id), created_at));
  `
];

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current > MIGRATIONS.length) {
    throw new Error(`Base en version ${current}, plus récente que ce serveur (${MIGRATIONS.length})`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
