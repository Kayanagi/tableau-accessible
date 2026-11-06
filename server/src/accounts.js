/* Suppression d'un compte : ses tableaux possédés, puis l'utilisateur. Les clés étrangères retirent
   ses sessions, ses appartenances et, avec chaque tableau, ses liens et les sessions invitées. */
export function createAccountRemoval(db) {
  const ownedBoards = db.prepare("SELECT board_id AS id FROM board_members WHERE user_id = ? AND role = 'owner'");
  const deleteBoard = db.prepare('DELETE FROM boards WHERE id = ?');
  const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');

  return db.transaction(userId => {
    for (const { id } of ownedBoards.all(userId)) deleteBoard.run(id);
    deleteUser.run(userId);
  });
}
