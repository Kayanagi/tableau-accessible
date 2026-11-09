import { ACCOUNT_BODY, HttpError, tooMany } from '../http.js';
import { newId } from '../auth.js';
import { isValidEmail, normalizeEmail } from '../validate.js';
import { createBoardAccess } from './boards.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const INVITE_TTL = 30 * DAY;
export const MAX_PENDING_INVITES = 50;
export const MAX_PENDING_INVITES_PER_EMAIL = 20;
export const MAX_INVITE_CREATIONS_PER_HOUR = 20;
export const MAX_BOARD_MEMBERS = 100;
const MAX_LISTED_INVITES = 100;
const SHARED_ROLES = new Set(['editor', 'viewer']);
const OPTIONS = { auth: 'account', bodyLimit: ACCOUNT_BODY };
const READ_OPTIONS = bucket => ({ auth: 'account', rate: { bucket, limit: 60, windowMs: MIN } });

function inviteNotFound() {
  return new HttpError(404, 'invite_not_found', 'Invitation introuvable.');
}

function memberNotFound() {
  return new HttpError(404, 'member_not_found', 'Cette personne n’est pas membre du tableau.');
}

function requireSharedRole(value) {
  if (typeof value !== 'string' || !SHARED_ROLES.has(value)) {
    throw new HttpError(400, 'invalid_enum', 'Le rôle doit être « editor » ou « viewer ».', { extra: { path: 'role' } });
  }
}

export function registerMemberRoutes(router, app) {
  const { db, limiter } = app;
  const { requireRole } = createBoardAccess(db);

  const listMembers = db.prepare(`SELECT m.user_id AS userId, u.display_name AS displayName, m.role
    FROM board_members m JOIN users u ON u.id = m.user_id
    WHERE m.board_id = ? ORDER BY m.role = 'owner' DESC, u.display_name, m.user_id`);
  const memberOf = db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?');
  const countMembers = db.prepare('SELECT COUNT(*) AS n FROM board_members WHERE board_id = ?');
  const insertMember = db.prepare('INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, ?, ?)');
  const setMemberRole = db.prepare('UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?');
  const deleteMember = db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?');
  const memberView = db.prepare(`SELECT m.user_id AS userId, u.display_name AS displayName, m.role
    FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND m.user_id = ?`);

  const pendingOfBoard = db.prepare(`SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt
    FROM board_invites WHERE board_id = ? AND expires_at > ? ORDER BY created_at DESC, id`);
  const inviteView = db.prepare('SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt FROM board_invites WHERE id = ?');
  const inviteOfEmail = db.prepare('SELECT id FROM board_invites WHERE board_id = ? AND email = ?');
  const countInvites = db.prepare('SELECT COUNT(*) AS n FROM board_invites WHERE board_id = ?');
  const countInvitesOfEmail = db.prepare('SELECT COUNT(*) AS n FROM board_invites WHERE email = ? AND expires_at > ?');
  const purgeBoardInvites = db.prepare('DELETE FROM board_invites WHERE board_id = ? AND expires_at <= ?');
  const insertInvite = db.prepare('INSERT INTO board_invites (id, board_id, email, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const updateInvite = db.prepare('UPDATE board_invites SET role = ?, invited_by = ? WHERE id = ?');
  const cancelInvite = db.prepare('DELETE FROM board_invites WHERE id = ? AND board_id = ? AND expires_at > ?');

  const invitesOfAccount = db.prepare(`SELECT i.id, i.board_id AS boardId, b.name AS boardName, u.display_name AS invitedByName,
      i.role, i.created_at AS createdAt, i.expires_at AS expiresAt
    FROM board_invites i
    JOIN boards b ON b.id = i.board_id
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.email = ? AND i.expires_at > ? ORDER BY i.created_at DESC, i.id LIMIT ?`);
  const inviteOfAccount = db.prepare('SELECT id, board_id AS boardId, role FROM board_invites WHERE id = ? AND email = ? AND expires_at > ?');
  const deleteInvite = db.prepare('DELETE FROM board_invites WHERE id = ?');
  const declineInvite = db.prepare('DELETE FROM board_invites WHERE id = ? AND email = ? AND expires_at > ?');
  const declineAllInvites = db.prepare('DELETE FROM board_invites WHERE email = ? AND expires_at > ?');

  /*
   * La table users n'est jamais consultée : le quota et son message générique sont identiques,
   * que l'adresse ait un compte ou non. Ce 403 révèle seulement qu'une adresse reçoit déjà
   * beaucoup d'invitations ; c'est le compromis retenu pour empêcher l'inondation inter-tableaux.
   */
  const saveInvite = db.transaction((boardId, email, role, userId) => {
    const t = Date.now();
    purgeBoardInvites.run(boardId, t);
    const existing = inviteOfEmail.get(boardId, email);
    if (existing) {
      updateInvite.run(role, userId, existing.id);
      return { id: existing.id, created: false };
    }
    if (countInvitesOfEmail.get(email, t).n >= MAX_PENDING_INVITES_PER_EMAIL) {
      throw new HttpError(403, 'quota_exceeded', 'Cette adresse a atteint la limite d’invitations en attente.');
    }
    const wait = limiter.check('invite-create', userId, MAX_INVITE_CREATIONS_PER_HOUR, HOUR);
    if (wait) throw tooMany(wait);
    if (countInvites.get(boardId).n >= MAX_PENDING_INVITES) {
      throw new HttpError(403, 'quota_exceeded', `Ce tableau a atteint la limite de ${MAX_PENDING_INVITES} invitations en attente.`);
    }
    const id = newId('inv_');
    insertInvite.run(id, boardId, email, role, userId, t, t + INVITE_TTL);
    return { id, created: true };
  });

  /* Une personne déjà membre garde son rôle : une invitation n'abaisse ni n'élève personne. */
  const acceptInvite = db.transaction((id, session) => {
    const t = Date.now();
    const invite = inviteOfAccount.get(id, session.user.email, t);
    if (!invite) throw inviteNotFound();
    const current = memberOf.get(invite.boardId, session.userId);
    if (!current) {
      if (countMembers.get(invite.boardId).n >= MAX_BOARD_MEMBERS) {
        throw new HttpError(403, 'quota_exceeded', `Ce tableau a atteint la limite de ${MAX_BOARD_MEMBERS} membres.`);
      }
      insertMember.run(invite.boardId, session.userId, invite.role, t);
    }
    deleteInvite.run(id);
    return { boardId: invite.boardId, role: current?.role ?? invite.role };
  }).immediate;

  router.add('GET', '/api/boards/:id/members', ctx => {
    const role = requireRole(ctx, 'viewer');
    const body = { role, members: listMembers.all(ctx.params.id) };
    if (role === 'owner') body.invites = pendingOfBoard.all(ctx.params.id, Date.now());
    return { body };
  }, READ_OPTIONS('board-members'));

  router.add('POST', '/api/boards/:id/invites', ctx => {
    requireRole(ctx, 'owner');
    const email = normalizeEmail(ctx.body.email);
    if (!isValidEmail(email)) throw new HttpError(400, 'invalid_email', 'Adresse e-mail invalide.', { extra: { path: 'email' } });
    requireSharedRole(ctx.body.role);
    if (email === ctx.session.user.email) {
      throw new HttpError(400, 'cannot_invite_self', 'Vous êtes déjà propriétaire de ce tableau.', { extra: { path: 'email' } });
    }
    const { id, created } = saveInvite(ctx.params.id, email, ctx.body.role, ctx.session.userId);
    if (created) limiter.hit('invite-create', ctx.session.userId, MAX_INVITE_CREATIONS_PER_HOUR, HOUR);
    return { status: created ? 201 : 200, body: { invite: inviteView.get(id) } };
  }, OPTIONS);

  router.add('DELETE', '/api/boards/:id/invites/:inviteId', ctx => {
    requireRole(ctx, 'owner');
    if (!cancelInvite.run(ctx.params.inviteId, ctx.params.id, Date.now()).changes) throw inviteNotFound();
    return { status: 204 };
  }, OPTIONS);

  router.add('PATCH', '/api/boards/:id/members/:userId', ctx => {
    requireRole(ctx, 'owner');
    requireSharedRole(ctx.body.role);
    const target = memberOf.get(ctx.params.id, ctx.params.userId);
    if (!target) throw memberNotFound();
    if (target.role === 'owner') throw new HttpError(403, 'owner_protected', 'Le rôle du propriétaire ne peut pas être modifié.');
    setMemberRole.run(ctx.body.role, ctx.params.id, ctx.params.userId);
    return { body: memberView.get(ctx.params.id, ctx.params.userId) };
  }, OPTIONS);

  router.add('DELETE', '/api/boards/:id/members/:userId', ctx => {
    const role = requireRole(ctx, 'viewer');
    if (role !== 'owner' && ctx.params.userId !== ctx.session.userId) {
      throw new HttpError(403, 'forbidden', 'Votre rôle sur ce tableau ne permet pas cette action.');
    }
    const target = memberOf.get(ctx.params.id, ctx.params.userId);
    if (!target) throw memberNotFound();
    if (target.role === 'owner') throw new HttpError(403, 'owner_protected', 'Le propriétaire ne peut ni quitter le tableau ni en être retiré.');
    deleteMember.run(ctx.params.id, ctx.params.userId);
    return { status: 204 };
  }, OPTIONS);

  router.add('GET', '/api/invites', ctx => {
    return { body: { invites: invitesOfAccount.all(ctx.session.user.email, Date.now(), MAX_LISTED_INVITES) } };
  }, READ_OPTIONS('invites-read'));

  router.add('POST', '/api/invites/:id/accept', ctx => {
    return { body: acceptInvite(ctx.params.id, ctx.session) };
  }, OPTIONS);

  router.add('POST', '/api/invites/:id/decline', ctx => {
    if (!declineInvite.run(ctx.params.id, ctx.session.user.email, Date.now()).changes) throw inviteNotFound();
    return { status: 204 };
  }, OPTIONS);

  router.add('POST', '/api/invites/decline-all', ctx => {
    const declined = declineAllInvites.run(ctx.session.user.email, Date.now()).changes;
    return { body: { declined } };
  }, OPTIONS);
}
