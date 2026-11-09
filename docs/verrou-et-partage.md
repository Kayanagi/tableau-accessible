# Connexion obligatoire, import et partage par tableau (v1.10.0)

Demande de Wesley (2026-11-06) : une page de connexion qui verrouille l'accès ; chacun n'accède qu'à ses tableaux et à ceux qu'on partage avec lui. Décisions : le mode local disparaît mais ses tableaux peuvent être importés ; partage par tableau ; équipes en v1.11.0 ; le verrou concerne tout le site : décision du 2026-11-06, nginx ne sert sans session que la page de connexion, la page de confidentialité et `/api/` (voir « Déploiement du verrou »). Les données ne sortent toujours que du serveur, après contrôle de session et de droits.

Numérotation : v1.10.0 verrou + import + partage ; v1.11.0 équipes ; v1.12.0 synchro temps réel ; v1.13.0 curseurs, lien de partage, invités (anciennes v1.10.0 et v1.11.0 de `serveur-temps-reel.md`).

## 1. Client : l'écran de connexion

- Au chargement, rien du tableau de bord ni des tableaux n'est affiché ni rendu tant que la session n'est pas confirmée par `GET /api/me`. Pendant la vérification : un état « Chargement… » (région `role="status"`).
- Sans session (401, ou serveur injoignable sans miroir) : page plein écran `main` avec `h1`, formulaire Connexion / Créer un compte (réutiliser la logique de `js/views/account-dialog.js`, pas de copie), lien vers `confidentialite.html`, mention des 15 ans. Après connexion, retour à la route demandée (`#/tableau/<id>` conservé).
- Aucune route (`#/`, `#/tableau/…`, `#/espace/…`, favoris, parcourir) ne rend de contenu sans session. `#/compte` reste disponible une fois connecté.
- Hors ligne avec session connue et miroir présent : l'application reste utilisable (miroir existant, plafonné à 2 Mio). Hors ligne sans miroir : message clair, pas d'écran vide.
- Session expirée en cours de route : retour à l'écran de connexion, modifications non envoyées conservées dans le miroir (comportement existant), annonce vocale.
- Accessibilité : focus sur le `h1` ou le premier champ à l'affichage, erreurs reliées aux champs (`aria-describedby`), `role="alert"` pour les échecs sans focus ; les erreurs de champ sont lues par le focus (`aria-describedby`), sans alerte, pour ne pas être lues deux fois, `autocomplete` corrects (`username`, `current-password`, `new-password`), contrastes AA, 320 px à 1920 px.

## 2. Client : les tableaux locaux deviennent importables

- `js/store/boards.js` ne sert plus qu'au compte (miroir distant). Le stockage local historique n'est plus affiché ni modifiable.
- Après une connexion (ou à l'ouverture si une session existe), si des tableaux locaux historiques existent et n'ont pas été traités : dialogue « Importer vos tableaux de cet appareil » listant les tableaux (nom, nombre d'objets), cases cochées par défaut, boutons « Importer dans mon compte », « Plus tard ». Le choix « Plus tard » est mémorisé par appareil et le dialogue reste accessible depuis « Mon compte ».
- L'import utilise `POST /api/boards` (un par tableau), respecte les quotas (100 tableaux, 100 Mio) et affiche le résultat tableau par tableau (réussi / refusé et pourquoi). Après import réussi, proposer « Supprimer de cet appareil » (jamais automatique, jamais sans clic). Rien n'est supprimé en cas d'échec.
- Un import ne doit jamais dupliquer un tableau déjà importé (mémoriser l'identifiant local importé).

## 3. Serveur : partage par tableau

Tables (migration 3) :

```sql
CREATE TABLE board_invites (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email TEXT NOT NULL,                 -- normalisé, en minuscules
  role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,         -- 30 jours
  UNIQUE (board_id, email)
);
CREATE INDEX board_invites_email ON board_invites(email);
```

`board_members` existe déjà (rôles `owner`, `editor`, `viewer`, un seul propriétaire).

Routes (toutes en `auth: 'account'`, Origin strict, JSON, limite de corps 16 Kio) :

`POST /api/boards` accepte `importKey` (`[A-Za-z0-9_-]`, 1 à 100 caractères). Pour un même compte et une même clé, il renvoie le tableau déjà créé avec `200` et `existing: true` ; après suppression de ce tableau, la clé peut être réutilisée.

| Route | Qui | Effet |
|---|---|---|
| `GET /api/boards/:id/members` | membre | membres (nom affiché, rôle) et, pour le propriétaire seulement, invitations en attente (e-mail, rôle) |
| `POST /api/boards/:id/invites` `{email, role}` | propriétaire | crée ou met à jour l'invitation. **Réponse identique que l'adresse ait un compte ou non** (pas d'énumération de comptes). Aucun e-mail envoyé. Plafond : 50 invitations en attente par tableau, 20 créations par heure par compte |
| `DELETE /api/boards/:id/invites/:inviteId` | propriétaire | retire l'invitation |
| `PATCH /api/boards/:id/members/:userId` `{role}` | propriétaire | change `editor` ↔ `viewer` ; impossible sur le propriétaire |
| `DELETE /api/boards/:id/members/:userId` | propriétaire, ou la personne elle-même (quitter) | retire ; le propriétaire ne peut pas quitter (il supprime ou transfère plus tard) |
| `GET /api/invites` | compte | invitations en attente adressées à l'e-mail du compte : tableau (nom), invitant (nom), rôle |
| `POST /api/invites/:id/accept` | compte invité | crée la ligne `board_members`, supprime l'invitation (transaction) |
| `POST /api/invites/:id/decline` | compte invité | supprime l'invitation |

Règles :

- Une invitation n'est visible et acceptable que par le compte dont l'e-mail correspond. Une invitation expirée ou d'un tableau supprimé répond 404.
- Un tableau partagé ne compte pas dans le quota de l'invité ; le quota reste celui du propriétaire (déjà le cas : `ownedBytes`).
- Les lectures de tableau (`GET /api/boards/:id`, export, `PUT …/data`, `PATCH`) continuent de passer par `requireRole` : `viewer` lit, `editor` écrit, seul `owner` supprime et gère le partage. Un tableau hors d'atteinte répond 404.
- `GET /api/boards` renvoie déjà les tableaux partagés avec le rôle ; ajouter `ownerName` et le nombre de membres.
- Export des données du compte (`/api/me/export`) : n'inclut que les tableaux possédés ; les invitations reçues y figurent en métadonnées sans contenu d'autrui.
- Suppression d'un compte : les tableaux possédés partent (comportement existant), les appartenances et invitations reçues sont supprimées, les invitations envoyées aussi. Le test d'inactivité doit continuer de passer.
- La page `confidentialite.html` et le texte d'information doivent mentionner : e-mail d'une personne invitée conservé jusqu'à acceptation, refus ou 30 jours ; tableaux partagés visibles par les personnes invitées ; l'invitation n'envoie aucun e-mail.

## 4. Client : partage

- Dans le menu d'un tableau (fiche du tableau de bord et vue tableau) : « Partager… » (propriétaire) ouvre un dialogue : champ e-mail + rôle (Peut modifier / Peut lire), liste des membres avec changement de rôle et retrait, liste des invitations en attente avec annulation. Texte explicite : « Aucun e-mail n'est envoyé : prévenez la personne, elle verra l'invitation en se connectant avec cette adresse. »
- Pour un invité : « Quitter le tableau ».
- Tableau de bord : section « Partagés avec moi » (ou filtre), badge de rôle, et bandeau « Invitations » (nombre) avec Accepter / Refuser, annoncé aux lecteurs d'écran (`role="status"`).
- Un tableau en lecture seule (`viewer`) : édition désactivée dans l'interface (canevas, plan, tableau), message persistant « Lecture seule », aucun PUT émis. Le serveur reste l'autorité (403).
- Si l'accès est retiré pendant l'édition : message, la copie locale du miroir est conservée sous forme de « copie » (mécanisme de conflit existant).

## 5. Tests exigés

Serveur (`server/tests/`) : invitation créée / mise à jour / annulée ; réponse identique avec ou sans compte (comparer corps et statut) ; acceptation par le bon compte, refus par un autre (404) ; expiration ; rôle `viewer` ne peut pas écrire, `editor` ne peut pas gérer le partage ni supprimer ; propriétaire non retirable ; quitter ; suppression de compte nettoie tout ; plafonds ; hors d'atteinte = 404 ; migration 2 → 3 sur base existante.

E2E (`tests/e2e-compte.mjs`, nouveau fichier `tests/e2e-verrou.mjs` si plus clair) : aucune route ne montre de contenu sans session ; hash `#/tableau/<id>` conservé après connexion ; import local → compte avec compte rendu, pas de doublon au second passage ; deux comptes, partage, acceptation, lecture seule vraiment non éditable ; axe-core sur écran de connexion, dialogue d'import, dialogue de partage, liste des invitations ; 320, 768 et 1280 px ; clavier seul ; hors ligne avec miroir.

`tests/e2e.mjs` existant doit être adapté (il suppose le mode local) : passer par une connexion de test plutôt que de supprimer des vérifications.

## 6. Hors périmètre de cette version

Équipes (v1.11.0), e-mail d'invitation, vérification d'adresse e-mail, transfert de propriété, lien de partage anonyme, temps réel.

Limite connue à écrire dans le CHANGELOG et la page de confidentialité : les adresses e-mail ne sont pas vérifiées ; si une adresse invitée a été inscrite par un tiers avant la personne visée, l'invitation lui est visible. Le propriétaire voit l'invitation « en attente » et peut l'annuler.

## 7. Déploiement du verrou

Configuration cible : `server/deploy/nginx-baro.dwes.fr.conf`. Sans session de compte valide, nginx ne sert que `/connexion.html`, `/css/connexion.css`, `/js/connexion.js`, `/confidentialite.html` et `/api/`. Toute autre adresse reçoit `connexion.html` en 200, à la même URL. `GET /api/session` (204 ou 401, sans corps, `Cache-Control: no-store`) sert de contrôle : lecture seule, sans limite de débit, sans glissement de session ni activité enregistrée. Si le serveur Baro ne répond pas, le site reste fermé : `connexion.html` en 503.

Les fichiers de connexion doivent rester autonomes : chemins absolus, aucun import depuis `js/` ni feuille de style de `css/` hors de ceux listés, car tout le reste est verrouillé.

### Ordre d'application

L'ordre compte. Avec la nouvelle configuration, un serveur sans `/api/session` rendrait le site indisponible (503), et un dépôt sans `connexion.html` répondrait 404 partout.

1. Publier le code dans `/var/www/tableau-accessible` et recharger le serveur Baro.
2. Vérifier les deux prérequis :
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://baro.dwes.fr/api/session    # attendu : 401
   curl -s -o /dev/null -w '%{http_code}\n' https://baro.dwes.fr/connexion.html # attendu : 200
   ```
3. Garder une copie hors de `sites-enabled` et de `sites-available`, puis installer la configuration :
   ```sh
   sudo cp /etc/nginx/sites-available/baro.dwes.fr.conf /root/baro.dwes.fr.conf.avant-verrou
   sudo cp /var/www/tableau-accessible/server/deploy/nginx-baro.dwes.fr.conf /etc/nginx/sites-available/baro.dwes.fr.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. Contrôler en navigation privée : `/` et `/js/app.js` sans session affichent la connexion (`curl` : 200, `text/html`) ; `/confidentialite.html` répond 200 ; `/server/`, `/tests/` et `/README.md` répondent 404 ; après connexion, `/` affiche l'application et un lien `#/tableau/<id>` ouvert depuis un autre site arrive sur le tableau.

### Retour arrière

```sh
sudo cp /root/baro.dwes.fr.conf.avant-verrou /etc/nginx/sites-available/baro.dwes.fr.conf
sudo nginx -t && sudo systemctl reload nginx
```

Le code du serveur peut rester en place : `/api/session` est alors inutilisé et le cookie Lax reste valable. Revenir aussi au code précédent n'est nécessaire que si la version elle-même est en cause.

### Limites connues

- Les cookies déjà posés restent `SameSite=Strict` jusqu'à leur renouvellement (glissement horaire ou nouvelle connexion).
- Une session invitée (lien de partage, prévu en v1.13.0) reçoit 401 de `/api/session` : le verrou devra être revu avec cette version.
- Le contrôle est appelé deux fois pour `/` (redirection interne vers `index.html`). Le coût est négligeable : une lecture par clé primaire.
