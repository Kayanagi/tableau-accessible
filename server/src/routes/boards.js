import { HttpError } from '../http.js';
import { newId } from '../auth.js';
import { createAccountUsage } from '../accounts.js';
import { ValidationError, isValidIcon, normalizeBoardName, prepareBoard, prepareImport } from '../validate.js';

const MAX_OWNED_BOARDS = 100;
const RANK = { viewer: 1, editor: 2, owner: 3 };
const IMPORT_KEY = /^[A-Za-z0-9_-]{1,100}$/;

function notFound() {
  return new HttpError(404, 'board_not_found', 'Tableau introuvable.');
}

/* Contrôle commun aux routes de tableau et de partage, sur le paramètre :id. */
export function createBoardAccess(db) {
  const memberRole = db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?');

  function roleOf(session, boardId) {
    if (session.guest) return session.boardId === boardId ? session.role : null;
    return memberRole.get(boardId, session.userId)?.role ?? null;
  }

  /* Un tableau hors d'atteinte répond 404 : son existence n'est pas révélée. */
  function requireRole(ctx, minimum) {
    const role = roleOf(ctx.session, ctx.params.id);
    if (!role) throw notFound();
    if (RANK[role] < RANK[minimum]) throw new HttpError(403, 'forbidden', 'Votre rôle sur ce tableau ne permet pas cette action.');
    return role;
  }

  return { requireRole };
}

function invalid(err) {
  if (err instanceof ValidationError) return new HttpError(400, err.code, err.message, { extra: { path: err.path } });
  return err;
}

function prepare(fn, data) {
  try { return fn(data); } catch (err) { throw invalid(err); }
}

/* Le tableau tel que le client le charge : métadonnées, méta (tags, frameOrder, background) et objets. */
export function readBoard(db, id) {
  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  if (!row) return null;
  const items = db.prepare('SELECT data FROM board_items WHERE board_id = ? ORDER BY z').all(id).map(r => JSON.parse(r.data));
  return { id: row.id, name: row.name, icon: row.icon, rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at, ...JSON.parse(row.meta), items };
}

function writeItems(db, boardId, items, rev) {
  db.prepare('DELETE FROM board_items WHERE board_id = ?').run(boardId);
  const insert = db.prepare('INSERT INTO board_items (board_id, item_id, z, rev, data) VALUES (?, ?, ?, ?, ?)');
  items.forEach((item, z) => insert.run(boardId, item.id, z, rev, JSON.stringify(item)));
}

export function registerBoardRoutes(router, app) {
  const { db, config } = app;
  const { requireRole } = createBoardAccess(db);
  const countOwned = db.prepare("SELECT COUNT(*) AS n FROM board_members WHERE user_id = ? AND role = 'owner'");
  const ownerOf = db.prepare("SELECT user_id AS userId FROM board_members WHERE board_id = ? AND role = 'owner'");
  // Le quota compte aussi les données du compte (espaces, favoris, modèles) : un seul plafond de 100 Mio.
  const usage = createAccountUsage(db);
  const boardBytes = db.prepare(`SELECT length(CAST(name AS BLOB)) + length(CAST(icon AS BLOB)) + length(CAST(meta AS BLOB)) +
      (SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) FROM board_items WHERE board_id = boards.id) AS bytes
    FROM boards WHERE id = ?`);
  const importedBoard = db.prepare(`SELECT b.id
    FROM board_imports i JOIN boards b ON b.id = i.board_id
    WHERE i.owner_id = ? AND i.import_key = ?`);

  const serializedBytes = (name, icon, prepared) => Buffer.byteLength(name) + Buffer.byteLength(icon)
    + Buffer.byteLength(JSON.stringify(prepared.meta))
    + prepared.items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0);

  function requireQuota(userId, nextBytes) {
    if (nextBytes > config.accountBoardQuotaBytes) {
      throw new HttpError(403, 'quota_exceeded', 'Le quota de stockage de vos tableaux est dépassé. Supprimez un tableau ou réduisez son contenu.');
    }
  }

  router.add('GET', '/api/boards', ctx => {
    const rows = db.prepare(`SELECT b.id, b.name, b.icon, b.rev, b.created_at AS createdAt, b.updated_at AS updatedAt, m.role,
        (SELECT COUNT(*) FROM board_members x WHERE x.board_id = b.id) AS memberCount,
        (SELECT u.display_name FROM board_members o JOIN users u ON u.id = o.user_id WHERE o.board_id = b.id AND o.role = 'owner') AS ownerName
      FROM board_members m JOIN boards b ON b.id = m.board_id
      WHERE m.user_id = ? ORDER BY b.updated_at DESC`).all(ctx.session.userId);
    return { body: { boards: rows } };
  }, { auth: 'account' });

  router.add('POST', '/api/boards', ctx => {
    const { name, icon = 'board', data, importKey } = ctx.body;
    if (importKey !== undefined && (typeof importKey !== 'string' || !IMPORT_KEY.test(importKey))) {
      throw new HttpError(400, 'invalid_import_key', 'La clé d’import doit contenir de 1 à 100 caractères parmi A-Z, a-z, 0-9, _ et -.', { extra: { path: 'importKey' } });
    }
    if (!isValidIcon(icon)) throw new HttpError(400, 'invalid_enum', 'Icône inconnue.', { extra: { path: 'icon' } });
    const prepared = prepare(prepareImport, data);
    const finalName = normalizeBoardName(name ?? prepared.name);
    if (!finalName) throw new HttpError(400, 'invalid_name', 'Le nom du tableau doit contenir de 1 à 200 caractères.', { extra: { path: 'name' } });

    const id = newId('brd_');
    const t = Date.now();
    const existingId = db.transaction(() => {
      if (importKey !== undefined) {
        const existing = importedBoard.get(ctx.session.userId, importKey);
        if (existing) return existing.id;
      }
      if (countOwned.get(ctx.session.userId).n >= MAX_OWNED_BOARDS) {
        throw new HttpError(403, 'quota_exceeded', `Vous avez atteint la limite de ${MAX_OWNED_BOARDS} tableaux.`);
      }
      requireQuota(ctx.session.userId, usage.totalBytes(ctx.session.userId) + serializedBytes(finalName, icon, prepared));
      db.prepare('INSERT INTO boards (id, name, icon, meta, rev, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .run(id, finalName, icon, JSON.stringify(prepared.meta), t, t);
      db.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(id, ctx.session.userId, t);
      writeItems(db, id, prepared.items, 0);
      if (importKey !== undefined) {
        db.prepare('INSERT INTO board_imports (owner_id, import_key, board_id, created_at) VALUES (?, ?, ?, ?)')
          .run(ctx.session.userId, importKey, id, t);
      }
      return null;
    })();
    const board = readBoard(db, existingId ?? id);
    return existingId
      ? { status: 200, body: { rev: board.rev, role: 'owner', board, existing: true } }
      : { status: 201, body: { rev: board.rev, role: 'owner', board } };
  }, { auth: 'account' });

  router.add('GET', '/api/boards/:id', ctx => {
    const role = requireRole(ctx, 'viewer');
    const board = readBoard(db, ctx.params.id);
    if (!board) throw notFound();
    return { body: { rev: board.rev, role, board } };
  }, { auth: 'session', rate: { bucket: 'board-read', limit: 60, windowMs: 60 * 1000 } });

  router.add('PUT', '/api/boards/:id/data', ctx => {
    requireRole(ctx, 'editor');
    const { baseRev, data } = ctx.body;
    if (!Number.isSafeInteger(baseRev) || baseRev < 0) throw new HttpError(400, 'invalid_base_rev', 'Révision de base (baseRev) manquante ou invalide.', { extra: { path: 'baseRev' } });
    const prepared = prepare(prepareBoard, data);
    const t = Date.now();
    const rev = db.transaction(() => {
      const current = db.prepare('SELECT rev FROM boards WHERE id = ?').get(ctx.params.id);
      if (!current) throw notFound();
      if (current.rev !== baseRev) {
        throw new HttpError(409, 'conflict', 'Ce tableau a été modifié entre-temps.', { extra: { rev: current.rev } });
      }
      const owner = ownerOf.get(ctx.params.id);
      if (!owner) throw notFound();
      const stored = boardBytes.get(ctx.params.id);
      const row = db.prepare('SELECT name, icon FROM boards WHERE id = ?').get(ctx.params.id);
      requireQuota(owner.userId, usage.totalBytes(owner.userId) - stored.bytes + serializedBytes(row.name, row.icon, prepared));
      const next = current.rev + 1;
      // Le nom ne suit que PATCH : un renommage ailleurs ne provoque ni conflit ni retour en arrière.
      db.prepare('UPDATE boards SET meta = ?, rev = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(prepared.meta), next, t, ctx.params.id);
      writeItems(db, ctx.params.id, prepared.items, next);
      // Un remplacement entier rend le journal caduc : la reprise passera par un instantané.
      db.prepare('DELETE FROM board_ops WHERE board_id = ?').run(ctx.params.id);
      return next;
    })();
    return { body: { rev, updatedAt: t } };
  }, { auth: 'session' });

  router.add('PATCH', '/api/boards/:id', ctx => {
    requireRole(ctx, 'editor');
    const { name, icon } = ctx.body;
    if (name === undefined && icon === undefined) throw new HttpError(400, 'invalid_input', 'Indiquez un nom ou une icône.');
    const finalName = name === undefined ? undefined : normalizeBoardName(name);
    if (finalName === null) throw new HttpError(400, 'invalid_name', 'Le nom du tableau doit contenir de 1 à 200 caractères.', { extra: { path: 'name' } });
    if (icon !== undefined && !isValidIcon(icon)) throw new HttpError(400, 'invalid_enum', 'Icône inconnue.', { extra: { path: 'icon' } });
    db.prepare('UPDATE boards SET name = COALESCE(?, name), icon = COALESCE(?, icon), updated_at = ? WHERE id = ?')
      .run(finalName ?? null, icon ?? null, Date.now(), ctx.params.id);
    const row = db.prepare('SELECT id, name, icon, rev, created_at AS createdAt, updated_at AS updatedAt FROM boards WHERE id = ?').get(ctx.params.id);
    if (!row) throw notFound();
    return { body: row };
  }, { auth: 'session' });

  router.add('DELETE', '/api/boards/:id', ctx => {
    requireRole(ctx, 'owner');
    db.prepare('DELETE FROM boards WHERE id = ?').run(ctx.params.id);
    return { status: 204 };
  }, { auth: 'session' });
}
