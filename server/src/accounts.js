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

/* Octets comptés au quota du compte : ses tableaux possédés et ses données de compte (espaces, modèles…). */
export function createAccountUsage(db) {
  const boards = db.prepare(`SELECT COALESCE(SUM(
      length(CAST(b.name AS BLOB)) + length(CAST(b.icon AS BLOB)) + length(CAST(b.meta AS BLOB)) +
      (SELECT COALESCE(SUM(length(CAST(i.data AS BLOB))), 0) FROM board_items i WHERE i.board_id = b.id)
    ), 0) AS bytes
    FROM boards b JOIN board_members m ON m.board_id = b.id
    WHERE m.user_id = ? AND m.role = 'owner'`);
  const data = db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM account_data WHERE user_id = ?');
  return {
    boardBytes: userId => boards.get(userId).bytes,
    dataBytes: userId => data.get(userId).bytes,
    totalBytes: userId => boards.get(userId).bytes + data.get(userId).bytes
  };
}
