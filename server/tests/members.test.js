import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { hashToken } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { MIGRATIONS } from '../src/migrations.js';
import {
  INVITE_TTL, MAX_BOARD_MEMBERS, MAX_INVITE_CREATIONS_PER_HOUR,
  MAX_PENDING_INVITES, MAX_PENDING_INVITES_PER_EMAIL
} from '../src/routes/members.js';
import { ORIGIN, PASSWORD, startServer, sticky } from './helpers.js';

const DAY = 24 * 3600 * 1000;
let mailCounter = 0;
const freshEmail = () => `invite-${++mailCounter}@ailleurs.test`;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('Partage par tableau', () => {
  let s, owner, editor, viewer, stranger;

  const newBoard = async (user = owner, name = 'Partagé') => {
    const res = await s.call('POST', '/api/boards', { cookie: user.token, body: { name, data: { items: [sticky('item-1')] } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.board.id;
  };
  const invite = (boardId, email, role = 'editor', user = owner) =>
    s.call('POST', `/api/boards/${boardId}/invites`, { cookie: user.token, body: { email, role } });
  const accept = (id, user) => s.call('POST', `/api/invites/${id}/accept`, { cookie: user.token });
  const decline = (id, user) => s.call('POST', `/api/invites/${id}/decline`, { cookie: user.token });
  const count = (table, where, ...args) => s.app.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;
  const expire = id => s.app.db.prepare('UPDATE board_invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1, id);
  const addMember = (boardId, user, role) => s.app.db.prepare('INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, ?, 0)').run(boardId, user.id, role);
  const fillMembers = (boardId, total) => {
    const insertUser = s.app.db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)');
    const insertMember = s.app.db.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'viewer', 0)");
    for (let i = count('board_members', 'board_id = ?', boardId); i < total; i++) {
      const userId = `u_quota_${boardId}_${i}`;
      insertUser.run(userId, `${userId}@exemple.test`, `Membre ${i}`, 'scrypt$test');
      insertMember.run(boardId, userId);
    }
  };

  /* Tableau avec ses trois rôles, partagé par le vrai parcours d'invitation. */
  const sharedBoard = async () => {
    const id = await newBoard();
    for (const [user, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
      const sent = await invite(id, user.email, role);
      assert.equal((await accept(sent.body.invite.id, user)).status, 200);
    }
    return id;
  };

  before(async () => { s = await startServer(); });
  /* Comptes neufs à chaque test : les limites de débit par compte et par session ne se cumulent pas. */
  beforeEach(async () => {
    [owner, editor, viewer, stranger] = await Promise.all(['Propriétaire', 'Éditrice', 'Lectrice', 'Étranger'].map(n => s.signUp(n)));
  });
  after(() => s.close());

  describe('invitations du propriétaire', () => {
    it('crée une invitation avec une adresse normalisée, valable 30 jours', async () => {
      const id = await newBoard();
      const sentAfter = Date.now();
      const res = await invite(id, '  Claire.Martin@AILLEURS.test ', 'viewer');
      assert.equal(res.status, 201);
      const { invite: sent } = res.body;
      assert.match(sent.id, /^inv_[\w-]{22}$/);
      assert.equal(sent.email, 'claire.martin@ailleurs.test');
      assert.equal(sent.role, 'viewer');
      assert.ok(sent.createdAt >= sentAfter);
      assert.equal(sent.expiresAt - sent.createdAt, INVITE_TTL);
      assert.equal(INVITE_TTL, 30 * DAY);
    });

    it('met à jour l’invitation existante sans en créer une seconde', async () => {
      const id = await newBoard();
      const email = freshEmail();
      const first = await invite(id, email, 'viewer');
      s.app.db.prepare('UPDATE board_invites SET expires_at = ? WHERE id = ?').run(Date.now() + DAY, first.body.invite.id);
      const second = await invite(id, email.toUpperCase(), 'editor');
      assert.equal(second.status, 200);
      assert.equal(second.body.invite.id, first.body.invite.id);
      assert.equal(second.body.invite.role, 'editor');
      assert.ok(second.body.invite.expiresAt <= Date.now() + DAY);
      assert.equal(count('board_invites', 'board_id = ?', id), 1);
    });

    it('ne prolonge jamais l’expiration lors d’une mise à jour', async () => {
      const id = await newBoard();
      const first = await invite(id, freshEmail(), 'viewer');
      const fixedExpiry = Date.now() + 2 * DAY;
      s.app.db.prepare('UPDATE board_invites SET expires_at = ? WHERE id = ?').run(fixedExpiry, first.body.invite.id);
      const second = await invite(id, first.body.invite.email, 'editor');
      assert.equal(second.status, 200);
      assert.equal(second.body.invite.expiresAt, fixedExpiry);
    });

    it('annule une invitation, une seule fois et seulement sur son tableau', async () => {
      const id = await newBoard();
      const other = await newBoard();
      const { body } = await invite(id, freshEmail());
      assert.equal((await s.call('DELETE', `/api/boards/${other}/invites/${body.invite.id}`, { cookie: owner.token })).status, 404);
      assert.equal((await s.call('DELETE', `/api/boards/${id}/invites/${body.invite.id}`, { cookie: owner.token })).status, 204);
      assert.equal((await s.call('DELETE', `/api/boards/${id}/invites/${body.invite.id}`, { cookie: owner.token })).status, 404);
      assert.equal(count('board_invites', 'id = ?', body.invite.id), 0);
    });

    it('refuse une adresse ou un rôle invalide, et sa propre adresse', async () => {
      const id = await newBoard();
      const send = body => s.call('POST', `/api/boards/${id}/invites`, { cookie: owner.token, body });
      for (const email of ['pas-une-adresse', '', 42, null, `${'a'.repeat(250)}@b.fr`]) {
        const res = await send({ email, role: 'editor' });
        assert.equal(res.status, 400, String(email));
        assert.equal(res.body.code, 'invalid_email');
      }
      for (const role of ['owner', 'admin', '', undefined, 1]) {
        const res = await send({ email: freshEmail(), role });
        assert.equal(res.status, 400, String(role));
        assert.equal(res.body.code, 'invalid_enum');
      }
      const self = await send({ email: owner.email.toUpperCase(), role: 'editor' });
      assert.equal(self.status, 400);
      assert.equal(self.body.code, 'cannot_invite_self');
      assert.equal(count('board_invites', 'board_id = ?', id), 0);
    });
  });

  describe('aucune énumération de comptes', () => {
    /* Seules les valeurs propres à chaque requête sont neutralisées : tout le reste doit coïncider. */
    const shape = res => {
      const { id, email, createdAt, expiresAt, ...rest } = res.body.invite;
      return {
        status: res.status,
        rest,
        keys: Object.keys(res.body.invite),
        topKeys: Object.keys(res.body),
        idFormat: /^inv_[\w-]{22}$/.test(id),
        ttl: expiresAt - createdAt,
        headers: [...res.headers.keys()].filter(name => name !== 'date').sort(),
        setCookie: res.setCookie
      };
    };

    it('répond de la même façon avec ou sans compte', async () => {
      const id = await newBoard();
      const withAccount = await invite(id, stranger.email, 'viewer');
      const withoutAccount = await invite(id, freshEmail(), 'viewer');
      assert.equal(withAccount.status, 201);
      assert.deepEqual(shape(withAccount), shape(withoutAccount));
    });

    it('répond de la même façon pour une même adresse, avant et après l’inscription', async () => {
      const email = freshEmail();
      const beforeSignUp = await invite(await newBoard(), email, 'viewer');
      const registered = await s.call('POST', '/api/auth/register', { body: { email, password: PASSWORD, displayName: 'Arrivée' } });
      assert.equal(registered.status, 201);
      const afterwards = await invite(await newBoard(), email, 'viewer');
      assert.deepEqual(shape(afterwards), shape(beforeSignUp));
      assert.equal(afterwards.body.invite.email, beforeSignUp.body.invite.email);
    });

    it('répond de la même façon pour une personne déjà membre', async () => {
      const id = await sharedBoard();
      const member = await invite(id, viewer.email, 'viewer');
      const unknown = await invite(id, freshEmail(), 'viewer');
      assert.deepEqual(shape(member), shape(unknown));
    });

    it('prend une durée comparable avec ou sans compte', async () => {
      const id = await newBoard();
      const known = stranger.email;
      const unknown = freshEmail();
      await invite(id, known);
      await invite(id, unknown);
      const timings = { known: [], unknown: [] };
      for (let i = 0; i < 25; i++) {
        for (const [name, email] of [['known', known], ['unknown', unknown]]) {
          const start = performance.now();
          assert.equal((await invite(id, email)).status, 200);
          timings[name].push(performance.now() - start);
        }
      }
      assert.ok(Math.abs(median(timings.known) - median(timings.unknown)) < 25, JSON.stringify({ known: median(timings.known), unknown: median(timings.unknown) }));
    });
  });

  describe('invitations reçues', () => {
    it('liste les invitations adressées au compte, et à lui seul', async () => {
      const invitee = await s.signUp('Invitée');
      const id = await newBoard(owner, 'Plan de rentrée');
      const sent = await invite(id, invitee.email.toUpperCase(), 'viewer');
      const mine = await s.call('GET', '/api/invites', { cookie: invitee.token });
      assert.equal(mine.status, 200);
      assert.deepEqual(mine.body.invites.map(({ createdAt, expiresAt, ...rest }) => rest), [{
        id: sent.body.invite.id, boardId: id, boardName: 'Plan de rentrée', invitedByName: 'Propriétaire', role: 'viewer'
      }]);
      const others = await s.call('GET', '/api/invites', { cookie: stranger.token });
      assert.ok(!others.body.invites.some(entry => entry.id === sent.body.invite.id));
    });

    it('accepte : crée l’appartenance, retire l’invitation, ouvre le tableau', async () => {
      const invitee = await s.signUp('Invitée');
      const id = await newBoard();
      const { body } = await invite(id, invitee.email, 'viewer');
      assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: invitee.token })).status, 404);
      const res = await accept(body.invite.id, invitee);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { boardId: id, role: 'viewer' });
      assert.equal(count('board_invites', 'id = ?', body.invite.id), 0);
      const board = await s.call('GET', `/api/boards/${id}`, { cookie: invitee.token });
      assert.equal(board.status, 200);
      assert.equal(board.body.role, 'viewer');
      assert.equal((await accept(body.invite.id, invitee)).status, 404);
    });

    it('répond 404 à un autre compte, sans toucher à l’invitation', async () => {
      const invitee = await s.signUp('Invitée');
      const id = await newBoard();
      const { body } = await invite(id, invitee.email);
      for (const res of [await accept(body.invite.id, stranger), await decline(body.invite.id, stranger), await accept(body.invite.id, owner)]) {
        assert.equal(res.status, 404);
        assert.equal(res.body.code, 'invite_not_found');
      }
      assert.equal(count('board_invites', 'id = ?', body.invite.id), 1);
      assert.equal(count('board_members', 'board_id = ? AND user_id = ?', id, stranger.id), 0);
      assert.equal((await accept('inv_inconnue', invitee)).status, 404);
    });

    it('refuse : retire l’invitation sans créer d’appartenance', async () => {
      const invitee = await s.signUp('Invitée');
      const id = await newBoard();
      const { body } = await invite(id, invitee.email);
      assert.equal((await decline(body.invite.id, invitee)).status, 204);
      assert.equal(count('board_invites', 'id = ?', body.invite.id), 0);
      assert.equal(count('board_members', 'board_id = ? AND user_id = ?', id, invitee.id), 0);
      assert.equal((await decline(body.invite.id, invitee)).status, 404);
    });

    it('refuse toutes les invitations en attente du compte et renvoie leur nombre', async () => {
      const invitee = await s.signUp('Invitée');
      const first = await invite(await newBoard(), invitee.email);
      await invite(await newBoard(), invitee.email);
      const expired = await invite(await newBoard(), invitee.email);
      expire(expired.body.invite.id);
      await invite(await newBoard(), stranger.email);
      const res = await s.call('POST', '/api/invites/decline-all', { cookie: invitee.token, body: {} });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { declined: 2 });
      assert.equal(count('board_invites', 'email = ? AND expires_at > ?', invitee.email, Date.now()), 0);
      assert.equal(count('board_invites', 'id = ?', expired.body.invite.id), 1);
      assert.equal(count('board_invites', 'email = ?', stranger.email), 1);
      assert.equal(count('board_invites', 'id = ?', first.body.invite.id), 0);
    });

    it('répond declined 0 quand le compte n’a rien à refuser', async () => {
      const res = await s.call('POST', '/api/invites/decline-all', { cookie: stranger.token, body: {} });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { declined: 0 });
    });

    it(`garde l’invitation si le tableau a déjà ${MAX_BOARD_MEMBERS} membres`, async () => {
      const invitee = await s.signUp('Invitée');
      const id = await newBoard();
      const sent = await invite(id, invitee.email);
      fillMembers(id, MAX_BOARD_MEMBERS);
      const res = await accept(sent.body.invite.id, invitee);
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'quota_exceeded');
      assert.equal(count('board_members', 'board_id = ?', id), MAX_BOARD_MEMBERS);
      assert.equal(count('board_invites', 'id = ?', sent.body.invite.id), 1);
    });

    it('laisse une personne déjà membre accepter au plafond sans doublon', async () => {
      const id = await newBoard();
      addMember(id, stranger, 'editor');
      const sent = await invite(id, stranger.email, 'viewer');
      fillMembers(id, MAX_BOARD_MEMBERS);
      const res = await accept(sent.body.invite.id, stranger);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { boardId: id, role: 'editor' });
      assert.equal(count('board_members', 'board_id = ?', id), MAX_BOARD_MEMBERS);
      assert.equal(count('board_invites', 'id = ?', sent.body.invite.id), 0);
    });

    it('annule entièrement l’acceptation si une étape échoue', async t => {
      t.mock.method(console, 'error', () => {});
      const invitee = await s.signUp('Invitée');
      const id = await newBoard();
      const { body } = await invite(id, invitee.email);
      s.app.db.exec("CREATE TRIGGER refuse_suppression BEFORE DELETE ON board_invites BEGIN SELECT RAISE(ABORT, 'test'); END");
      try {
        assert.equal((await accept(body.invite.id, invitee)).status, 500);
      } finally {
        s.app.db.exec('DROP TRIGGER refuse_suppression');
      }
      assert.equal(count('board_members', 'board_id = ? AND user_id = ?', id, invitee.id), 0);
      assert.equal(count('board_invites', 'id = ?', body.invite.id), 1);
    });

    it('garde le rôle d’une personne déjà membre qui accepte une invitation', async () => {
      const id = await sharedBoard();
      const { body } = await invite(id, editor.email, 'viewer');
      const res = await accept(body.invite.id, editor);
      assert.equal(res.status, 200);
      assert.equal(res.body.role, 'editor');
      assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: editor.token })).body.role, 'editor');
      assert.equal(count('board_members', 'board_id = ? AND user_id = ?', id, editor.id), 1);
    });

    it('traite une invitation expirée comme absente, puis la purge', async () => {
      const invitee = await s.signUp('Invitée');
      const id = await newBoard();
      const { body } = await invite(id, invitee.email);
      expire(body.invite.id);
      assert.equal((await accept(body.invite.id, invitee)).status, 404);
      assert.equal((await decline(body.invite.id, invitee)).status, 404);
      assert.deepEqual((await s.call('GET', '/api/invites', { cookie: invitee.token })).body.invites, []);
      assert.deepEqual((await s.call('GET', `/api/boards/${id}/members`, { cookie: owner.token })).body.invites, []);
      assert.equal((await s.call('DELETE', `/api/boards/${id}/invites/${body.invite.id}`, { cookie: owner.token })).status, 404);
      assert.equal(count('board_members', 'board_id = ? AND user_id = ?', id, invitee.id), 0);
      assert.ok(s.app.purgeExpiredInvites() >= 1);
      assert.equal(count('board_invites', 'id = ?', body.invite.id), 0);
    });

    it('recrée une invitation à neuf après expiration', async () => {
      const id = await newBoard();
      const email = freshEmail();
      const first = await invite(id, email);
      expire(first.body.invite.id);
      const second = await invite(id, email);
      assert.equal(second.status, 201);
      assert.notEqual(second.body.invite.id, first.body.invite.id);
      assert.equal(count('board_invites', 'board_id = ?', id), 1);
    });

    it('répond 404 pour un tableau supprimé', async () => {
      const invitee = await s.signUp('Invitée');
      const id = await newBoard();
      const { body } = await invite(id, invitee.email);
      assert.equal((await s.call('DELETE', `/api/boards/${id}`, { cookie: owner.token })).status, 204);
      assert.equal((await accept(body.invite.id, invitee)).status, 404);
      assert.deepEqual((await s.call('GET', '/api/invites', { cookie: invitee.token })).body.invites, []);
      assert.equal(count('board_invites', 'board_id = ?', id), 0);
    });
  });

  describe('rôles et membres', () => {
    it('viewer lit mais n’écrit pas', async () => {
      const id = await sharedBoard();
      assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: viewer.token })).status, 200);
      const writes = [
        ['PUT', `/api/boards/${id}/data`, { baseRev: 0, data: { items: [] } }],
        ['PATCH', `/api/boards/${id}`, { name: 'Refusé' }],
        ['DELETE', `/api/boards/${id}`, {}]
      ];
      for (const [method, path, body] of writes) {
        assert.equal((await s.call(method, path, { cookie: viewer.token, body })).status, 403, `${method} ${path}`);
      }
      assert.equal(s.app.db.prepare('SELECT name FROM boards WHERE id = ?').get(id).name, 'Partagé');
    });

    it('editor écrit, mais ne gère pas le partage et ne supprime pas', async () => {
      const id = await sharedBoard();
      const written = await s.call('PUT', `/api/boards/${id}/data`, { cookie: editor.token, body: { baseRev: 0, data: { items: [sticky('item-2')] } } });
      assert.equal(written.status, 200);
      const refused = [
        ['POST', `/api/boards/${id}/invites`, { email: freshEmail(), role: 'editor' }],
        ['DELETE', `/api/boards/${id}/invites/inv_x`, {}],
        ['PATCH', `/api/boards/${id}/members/${viewer.id}`, { role: 'editor' }],
        ['PATCH', `/api/boards/${id}/members/${editor.id}`, { role: 'editor' }],
        ['DELETE', `/api/boards/${id}/members/${viewer.id}`, {}],
        ['DELETE', `/api/boards/${id}/members/${owner.id}`, {}],
        ['DELETE', `/api/boards/${id}`, {}]
      ];
      for (const [method, path, body] of refused) {
        const res = await s.call(method, path, { cookie: editor.token, body });
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal(res.body.code, 'forbidden');
      }
    });

    it('répond 404 sur toutes les routes de partage à qui n’a pas accès', async () => {
      const id = await sharedBoard();
      const routes = [
        ['GET', `/api/boards/${id}/members`],
        ['POST', `/api/boards/${id}/invites`, { email: freshEmail(), role: 'editor' }],
        ['DELETE', `/api/boards/${id}/invites/inv_x`, {}],
        ['PATCH', `/api/boards/${id}/members/${viewer.id}`, { role: 'editor' }],
        ['DELETE', `/api/boards/${id}/members/${viewer.id}`, {}],
        ['GET', '/api/boards/brd_inconnu/members']
      ];
      for (const [method, path, body] of routes) {
        const res = await s.call(method, path, { cookie: stranger.token, body });
        assert.equal(res.status, 404, `${method} ${path}`);
        assert.equal(res.body.code, 'board_not_found');
      }
      assert.equal(count('board_members', 'board_id = ?', id), 3);
    });

    it('montre les invitations au propriétaire seul, et aucune adresse de membre', async () => {
      const id = await sharedBoard();
      const email = freshEmail();
      await invite(id, email, 'viewer');
      const asOwner = await s.call('GET', `/api/boards/${id}/members`, { cookie: owner.token });
      assert.equal(asOwner.status, 200);
      assert.equal(asOwner.body.role, 'owner');
      assert.deepEqual(asOwner.body.members[0], { userId: owner.id, displayName: 'Propriétaire', role: 'owner' });
      assert.deepEqual(asOwner.body.members.map(m => m.role).sort(), ['editor', 'owner', 'viewer']);
      assert.deepEqual(asOwner.body.invites.map(({ email: address, role }) => ({ email: address, role })), [{ email, role: 'viewer' }]);
      assert.ok(asOwner.body.invites[0].id);
      assert.ok(!JSON.stringify(asOwner.body.members).includes('@'));
      for (const user of [editor, viewer]) {
        const res = await s.call('GET', `/api/boards/${id}/members`, { cookie: user.token });
        assert.equal(res.status, 200);
        assert.equal(res.body.members.length, 3);
        assert.equal(res.body.invites, undefined);
        assert.ok(!JSON.stringify(res.body).includes('@'));
      }
    });

    it('change editor et viewer dans les deux sens, avec effet immédiat', async () => {
      const id = await sharedBoard();
      const change = role => s.call('PATCH', `/api/boards/${id}/members/${editor.id}`, { cookie: owner.token, body: { role } });
      const down = await change('viewer');
      assert.equal(down.status, 200);
      assert.deepEqual(down.body, { userId: editor.id, displayName: 'Éditrice', role: 'viewer' });
      assert.equal((await s.call('PATCH', `/api/boards/${id}`, { cookie: editor.token, body: { name: 'Refusé' } })).status, 403);
      assert.equal((await change('editor')).body.role, 'editor');
      assert.equal((await s.call('PATCH', `/api/boards/${id}`, { cookie: editor.token, body: { name: 'Admis' } })).status, 200);
    });

    it('refuse de donner le rôle owner, de changer le propriétaire ou un inconnu', async () => {
      const id = await sharedBoard();
      const patch = (userId, role) => s.call('PATCH', `/api/boards/${id}/members/${userId}`, { cookie: owner.token, body: { role } });
      assert.equal((await patch(editor.id, 'owner')).status, 400);
      assert.equal((await patch(editor.id, undefined)).status, 400);
      const self = await patch(owner.id, 'viewer');
      assert.equal(self.status, 403);
      assert.equal(self.body.code, 'owner_protected');
      const absent = await patch(stranger.id, 'viewer');
      assert.equal(absent.status, 404);
      assert.equal(absent.body.code, 'member_not_found');
      assert.equal(s.app.db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(id, owner.id).role, 'owner');
    });

    it('retire un membre, qui perd aussitôt l’accès', async () => {
      const id = await sharedBoard();
      const res = await s.call('DELETE', `/api/boards/${id}/members/${viewer.id}`, { cookie: owner.token });
      assert.equal(res.status, 204);
      assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: viewer.token })).status, 404);
      assert.equal((await s.call('DELETE', `/api/boards/${id}/members/${viewer.id}`, { cookie: owner.token })).status, 404);
    });

    it('laisse un membre quitter, mais pas le propriétaire', async () => {
      const id = await sharedBoard();
      assert.equal((await s.call('DELETE', `/api/boards/${id}/members/${editor.id}`, { cookie: editor.token })).status, 204);
      assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: editor.token })).status, 404);
      const leave = await s.call('DELETE', `/api/boards/${id}/members/${owner.id}`, { cookie: owner.token });
      assert.equal(leave.status, 403);
      assert.equal(leave.body.code, 'owner_protected');
      assert.equal((await s.call('GET', `/api/boards/${id}`, { cookie: owner.token })).body.role, 'owner');
    });

    it('enrichit GET /api/boards du nom du propriétaire et du nombre de membres', async () => {
      const id = await sharedBoard();
      for (const [user, role] of [[owner, 'owner'], [editor, 'editor'], [viewer, 'viewer']]) {
        const entry = (await s.call('GET', '/api/boards', { cookie: user.token })).body.boards.find(b => b.id === id);
        assert.equal(entry.role, role);
        assert.equal(entry.ownerName, 'Propriétaire');
        assert.equal(entry.memberCount, 3);
      }
      await invite(id, freshEmail());
      const entry = (await s.call('GET', '/api/boards', { cookie: owner.token })).body.boards.find(b => b.id === id);
      assert.equal(entry.memberCount, 3);
    });
  });

  describe('export et suppression de compte', () => {
    it('exporte les tableaux possédés et les invitations reçues, sans contenu d’autrui', async () => {
      const account = await s.signUp('Exportée');
      const mine = await newBoard(account, 'À moi');
      const shared = await newBoard(owner, 'Secret partagé');
      const invited = await newBoard(owner, 'Secret invité');
      await accept((await invite(shared, account.email)).body.invite.id, account);
      const { body } = await invite(invited, account.email, 'viewer');
      const res = await s.call('GET', '/api/me/export', { cookie: account.token });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.boards.map(b => b.id), [mine]);
      assert.deepEqual(res.body.memberships, [{ boardId: shared, role: 'editor' }]);
      assert.deepEqual(res.body.invites, [{ boardId: invited, role: 'viewer', createdAt: body.invite.createdAt, expiresAt: body.invite.expiresAt }]);
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes('Secret'));
      assert.ok(!text.includes('Propriétaire'));
      assert.ok(!text.includes(owner.email));
    });

    it('nettoie appartenances, invitations reçues et envoyées, et tableaux possédés', async () => {
      const gone = await s.signUp('Partante');
      const owned = await newBoard(gone, 'Le sien');
      const foreign = await newBoard();
      const foreignInvited = await newBoard();
      await accept((await invite(foreign, gone.email)).body.invite.id, gone);
      await invite(foreignInvited, gone.email);
      assert.equal((await invite(owned, 'tiers-efface@ailleurs.test', 'viewer', gone)).status, 201);
      await accept((await invite(owned, stranger.email, 'viewer', gone)).body.invite.id, stranger);
      // Envoyée sur un tableau d'autrui : seule la suppression explicite la retire, la clé étrangère garderait la ligne.
      const sentElsewhere = (await invite(foreign, freshEmail())).body.invite.id;
      s.app.db.prepare('UPDATE board_invites SET invited_by = ? WHERE id = ?').run(gone.id, sentElsewhere);

      const res = await s.call('DELETE', '/api/me', { cookie: gone.token, body: { password: PASSWORD } });
      assert.equal(res.status, 204);
      assert.equal(count('users', 'id = ?', gone.id), 0);
      assert.equal(count('board_members', 'user_id = ?', gone.id), 0);
      assert.equal(count('board_invites', 'email = ?', gone.email), 0);
      assert.equal(count('board_invites', 'invited_by = ?', gone.id), 0);
      assert.equal(count('board_invites', 'id = ?', sentElsewhere), 0);
      assert.equal(count('boards', 'id = ?', owned), 0);
      assert.equal(count('board_invites', 'board_id = ?', owned), 0);
      assert.equal(count('board_members', 'board_id = ?', owned), 0);
      assert.equal(count('boards', 'id = ?', foreign), 1);
      assert.equal((await s.call('GET', `/api/boards/${owned}`, { cookie: stranger.token })).status, 404);
    });
  });

  describe('plafonds et garde-fous', () => {
    const insertInvites = (boardId, n, expiresAt = Date.now() + DAY) => {
      const insert = s.app.db.prepare("INSERT INTO board_invites (id, board_id, email, role, created_at, expires_at) VALUES (?, ?, ?, 'viewer', 0, ?)");
      for (let i = 0; i < n; i++) insert.run(`inv_${boardId}_${i}`.slice(0, 120), boardId, `plafond-${i}@ailleurs.test`, expiresAt);
    };
    const insertInvitesForEmail = async (email, n, expiresAt = Date.now() + DAY) => {
      const insert = s.app.db.prepare("INSERT INTO board_invites (id, board_id, email, role, created_at, expires_at) VALUES (?, ?, ?, 'viewer', 0, ?)");
      const boardIds = [];
      for (let i = 0; i < n; i++) {
        const boardId = await newBoard();
        boardIds.push(boardId);
        insert.run(`inv_email_${boardId}`, boardId, email, expiresAt);
      }
      return boardIds;
    };

    it(`plafonne à ${MAX_PENDING_INVITES} invitations en attente par tableau`, async () => {
      const id = await newBoard();
      insertInvites(id, MAX_PENDING_INVITES);
      const full = await invite(id, freshEmail());
      assert.equal(full.status, 403);
      assert.equal(full.body.code, 'quota_exceeded');
      assert.equal((await invite(id, 'plafond-0@ailleurs.test', 'editor')).status, 200, 'une mise à jour reste possible');
      s.app.db.prepare('DELETE FROM board_invites WHERE email = ? AND board_id = ?').run('plafond-1@ailleurs.test', id);
      assert.equal((await invite(id, freshEmail())).status, 201);
    });

    it('ne compte pas les invitations expirées dans le plafond', async () => {
      const id = await newBoard();
      insertInvites(id, MAX_PENDING_INVITES, Date.now() - 1);
      assert.equal((await invite(id, freshEmail())).status, 201);
      assert.equal(count('board_invites', 'board_id = ?', id), 1);
    });

    it(`plafonne à ${MAX_PENDING_INVITES_PER_EMAIL} invitations actives par adresse, tous tableaux confondus`, async () => {
      const email = freshEmail();
      await insertInvitesForEmail(email, MAX_PENDING_INVITES_PER_EMAIL);
      const full = await invite(await newBoard(), email);
      assert.equal(full.status, 403);
      assert.deepEqual(full.body, { code: 'quota_exceeded', message: 'Cette adresse a atteint la limite d’invitations en attente.' });
    });

    it('ne compte pas les invitations expirées dans le plafond par adresse', async () => {
      const email = freshEmail();
      const boardIds = await insertInvitesForEmail(email, MAX_PENDING_INVITES_PER_EMAIL);
      expire(s.app.db.prepare('SELECT id FROM board_invites WHERE board_id = ?').get(boardIds[0]).id);
      assert.equal((await invite(await newBoard(), email)).status, 201);
    });

    it('autorise la mise à jour du même tableau quand l’adresse est au plafond', async () => {
      const email = freshEmail();
      const [first] = await insertInvitesForEmail(email, MAX_PENDING_INVITES_PER_EMAIL);
      const updated = await invite(first, email, 'viewer');
      assert.equal(updated.status, 200);
      assert.equal(updated.body.invite.role, 'viewer');
    });

    it('renvoie le même refus de quota avec ou sans compte destinataire', async () => {
      const known = stranger.email;
      const unknown = freshEmail();
      for (const email of [known, unknown]) {
        await insertInvitesForEmail(email, MAX_PENDING_INVITES_PER_EMAIL);
      }
      const knownRefusal = await invite(await newBoard(), known);
      const unknownRefusal = await invite(await newBoard(), unknown);
      assert.equal(knownRefusal.status, 403);
      assert.deepEqual(knownRefusal.body, unknownRefusal.body);
    });

    it(`limite à ${MAX_INVITE_CREATIONS_PER_HOUR} créations par heure et par compte`, async () => {
      const sender = await s.signUp('Pressée');
      const [first, second] = [await newBoard(sender), await newBoard(sender)];
      const existing = freshEmail();
      assert.equal((await invite(first, 'pas-une-adresse', 'editor', sender)).status, 400);
      assert.equal((await invite(first, existing, 'editor', sender)).status, 201);
      assert.equal((await invite(first, existing, 'viewer', sender)).status, 200);
      for (let i = 1; i < MAX_INVITE_CREATIONS_PER_HOUR; i++) {
        assert.equal((await invite(first, freshEmail(), 'editor', sender)).status, 201, `création ${i + 1}`);
      }
      const limited = await invite(second, freshEmail(), 'editor', sender);
      assert.equal(limited.status, 429);
      assert.equal(limited.body.code, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal(count('board_invites', 'board_id = ?', second), 0);
      assert.equal((await invite(first, existing, 'editor', sender)).status, 200, 'une mise à jour reste possible');
    });

    it('n’accepte aucune écriture sans Origin exacte ni JSON', async () => {
      const id = await sharedBoard();
      const { body } = await invite(id, stranger.email);
      const writes = [
        ['POST', `/api/boards/${id}/invites`],
        ['DELETE', `/api/boards/${id}/invites/${body.invite.id}`],
        ['PATCH', `/api/boards/${id}/members/${viewer.id}`],
        ['DELETE', `/api/boards/${id}/members/${viewer.id}`],
        ['POST', `/api/invites/${body.invite.id}/accept`],
        ['POST', `/api/invites/${body.invite.id}/decline`],
        ['POST', '/api/invites/decline-all']
      ];
      for (const [method, path] of writes) {
        const payload = { cookie: stranger.token, body: { email: freshEmail(), role: 'viewer' } };
        for (const origin of [null, 'https://autre.test', `${ORIGIN}/`]) {
          const res = await s.call(method, path, { ...payload, origin });
          assert.equal(res.status, 403, `${method} ${path} ${origin}`);
          assert.equal(res.body.code, 'bad_origin');
        }
        assert.equal((await s.call(method, path, { ...payload, contentType: 'text/plain' })).status, 415);
      }
      assert.equal(count('board_invites', 'id = ?', body.invite.id), 1);
    });

    it('limite le corps à 16 Kio', async () => {
      const id = await newBoard();
      const res = await s.call('POST', `/api/boards/${id}/invites`, { cookie: owner.token, body: { email: 'a@b.fr', role: 'viewer', padding: 'x'.repeat(17 * 1024) } });
      assert.equal(res.status, 413);
    });

    it('exige une session de compte : 401 sans session, 403 pour un invité par lien', async () => {
      const id = await newBoard();
      const routes = [
        ['GET', `/api/boards/${id}/members`],
        ['POST', `/api/boards/${id}/invites`],
        ['DELETE', `/api/boards/${id}/invites/inv_x`],
        ['PATCH', `/api/boards/${id}/members/${owner.id}`],
        ['DELETE', `/api/boards/${id}/members/${owner.id}`],
        ['GET', '/api/invites'],
        ['POST', '/api/invites/inv_x/accept'],
        ['POST', '/api/invites/inv_x/decline'],
        ['POST', '/api/invites/decline-all']
      ];
      const guest = 'g'.repeat(43);
      const t = Date.now();
      s.app.db.prepare("INSERT INTO share_links (id, board_id, token_hash, role, created_at) VALUES ('lnk_membres', ?, ?, 'viewer', ?)").run(id, Buffer.from('jeton-membres'), t);
      s.app.db.prepare("INSERT INTO sessions (token_hash, share_link_id, guest_name, created_at, last_seen_at, expires_at) VALUES (?, 'lnk_membres', 'Invité', ?, ?, ?)").run(hashToken(guest), t, t, t + DAY);
      for (const [method, path] of routes) {
        const body = method === 'GET' ? undefined : {};
        assert.equal((await s.call(method, path, { body })).status, 401, `${method} ${path}`);
        const res = await s.call(method, path, { cookie: guest, body });
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal(res.body.code, 'account_required');
      }
    });
  });
});

describe('Quota et partage', () => {
  it('un tableau partagé ne compte pas dans le quota de l’invité', async () => {
    const s = await startServer({ BARO_ACCOUNT_BOARD_QUOTA_BYTES: '2000' });
    try {
      const [owner, invitee] = await Promise.all([s.signUp('Propriétaire'), s.signUp('Invitée')]);
      const data = { items: [sticky('item-1', { content: 'x'.repeat(1400) })] };
      const created = await s.call('POST', '/api/boards', { cookie: owner.token, body: { name: 'Grand', data } });
      assert.equal(created.status, 201);
      const sent = await s.call('POST', `/api/boards/${created.body.board.id}/invites`, { cookie: owner.token, body: { email: invitee.email, role: 'editor' } });
      assert.equal((await s.call('POST', `/api/invites/${sent.body.invite.id}/accept`, { cookie: invitee.token })).status, 200);
      assert.equal((await s.call('POST', '/api/boards', { cookie: invitee.token, body: { name: 'Le mien', data } })).status, 201);
      assert.equal((await s.call('POST', '/api/boards', { cookie: owner.token, body: { name: 'En trop', data } })).status, 403);
    } finally {
      await s.close();
    }
  });
});

describe('Migration 3', () => {
  it('passe une base existante de la version 2 à la version 3 sans perte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baro-migration-'));
    const path = join(dir, 'baro.db');
    try {
      const old = new Database(path);
      old.exec(MIGRATIONS[0]);
      old.exec(MIGRATIONS[1]);
      old.pragma('user_version = 2');
      old.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at, last_active_at, inactivity_warned_at) VALUES ('u_1', 'a@b.fr', 'Ancienne', 'scrypt$x', 1, 2, 3, 4)").run();
      old.prepare("INSERT INTO boards (id, name, created_at, updated_at) VALUES ('brd_1', 'Ancien', 1, 2)").run();
      old.prepare("INSERT INTO board_members (board_id, user_id, role, created_at) VALUES ('brd_1', 'u_1', 'owner', 1)").run();
      old.prepare("INSERT INTO board_items (board_id, item_id, z, rev, data) VALUES ('brd_1', 'i', 0, 0, '{}')").run();
      old.close();

      const db = openDb(path);
      assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
      assert.equal(MIGRATIONS.length, 3);
      assert.deepEqual(db.prepare('SELECT email, last_active_at, inactivity_warned_at FROM users').get(), { email: 'a@b.fr', last_active_at: 3, inactivity_warned_at: 4 });
      assert.equal(db.prepare('SELECT role FROM board_members').get().role, 'owner');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM board_items').get().n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM board_invites').get().n, 0);
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'board_invites_email'").get());

      const insert = db.prepare("INSERT INTO board_invites (id, board_id, email, role, invited_by, created_at, expires_at) VALUES (?, 'brd_1', ?, ?, 'u_1', 1, 2)");
      insert.run('inv_1', 'c@d.fr', 'viewer');
      assert.throws(() => insert.run('inv_2', 'c@d.fr', 'viewer'), /UNIQUE/);
      assert.throws(() => insert.run('inv_3', 'e@f.fr', 'owner'), /CHECK/);
      db.prepare("DELETE FROM boards WHERE id = 'brd_1'").run();
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM board_invites').get().n, 0);
      db.close();

      const again = openDb(path);
      assert.equal(again.pragma('user_version', { simple: true }), 3);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
