/* Suppression d'un compte : ses tableaux possédés, ses invitations reçues et envoyées, puis l'utilisateur.
   Les clés étrangères retirent ses sessions, ses appartenances et, avec chaque tableau, ses liens,
   ses invitations et les sessions invitées. */
export function createAccountRemoval(db) {
  const ownedBoards = db.prepare("SELECT board_id AS id FROM board_members WHERE user_id = ? AND role = 'owner'");
  const deleteBoard = db.prepare('DELETE FROM boards WHERE id = ?');
  const emailOf = db.prepare('SELECT email FROM users WHERE id = ?');
  const deleteReceivedInvites = db.prepare('DELETE FROM board_invites WHERE email = ?');
  const deleteSentInvites = db.prepare('DELETE FROM board_invites WHERE invited_by = ?');
  const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');

  return db.transaction(userId => {
    for (const { id } of ownedBoards.all(userId)) deleteBoard.run(id);
    const account = emailOf.get(userId);
    if (account) deleteReceivedInvites.run(account.email);
    deleteSentInvites.run(userId);
    deleteUser.run(userId);
  });
}
