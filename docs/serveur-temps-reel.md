# Baro : serveur temps réel, comptes et partage

Statut : décidé, à implémenter. Base : v1.8.1 (`3f17bc9`). Ce document tranche ; il ne compare pas d'options.

## 0. Principes

- **Le mode local ne change pas.** Sans compte ni lien de partage : aucune requête réseau, aucun module de synchro chargé (`import()` dynamique), clé `tableau-accessible-boards` et format v4 inchangés. Si le serveur tombe, le statique et les tableaux locaux fonctionnent toujours.
- **Le serveur est l'autorité de l'ordre.** Un processus unique et SQLite synchrone sérialisent les écritures : chaque lot accepté reçoit le numéro de révision suivant.
- **Aucun mutateur de `state.js` n'est instrumenté.** La synchro compare l'état courant à une copie de référence après chaque `notify()`, au même endroit que l'enregistrement automatique d'`app.js`. Cela couvre les 12 `history.pushState` de `state.js`, les 3 de `canvas.js`, `transact`, `touch`, et les fonctions futures.
- **Dépendances serveur : `better-sqlite3` (^11, déjà sur la machine) et `ws` (^8) uniquement.** HTTP par `node:http`, tests par `node:test`. Aucune dépendance côté navigateur, toujours pas de build.
- **Aucun secret applicatif.** Jetons aléatoires stockés hachés, pas de HMAC. `ecosystem.config.cjs` ne contient que `PORT`, `BARO_DB`, `BARO_ORIGIN`, `BARO_INSCRIPTIONS`.

## 1. Infrastructure

| Sujet | Décision |
|---|---|
| Port | **3006**, sur `127.0.0.1` (libre : vérifié par `ss`, nginx et la carte des ports) |
| Processus | PM2 `baro-server`, **fork, 1 instance** (salons et révisions en mémoire), `max_memory_restart: 400M` |
| Base | **`/var/lib/baro/baro.db`**, hors de la racine web, dossier en 700. WAL, `foreign_keys=ON`, `synchronous=NORMAL`, migrations par `PRAGMA user_version` |
| Sauvegarde | Timer systemd quotidien (pas de cron sur ce serveur) : `VACUUM INTO` vers `/var/backups/baro/`, 14 jours conservés |
| CSP | **Inchangée.** `connect-src 'self'` couvre `wss:` de même hôte selon CSP3. Vérifié par un test de fumée en production (§10). Ne pas modifier le snippet, partagé avec d'autres sites |

Vhost `baro.dwes.fr.conf`, à ajouter :

```nginx
location ^~ /server/ { return 404; }

location ^~ /api/ {
    include snippets/proxy.conf;          # Upgrade + $connection_upgrade déjà définis
    proxy_read_timeout 120s;              # ping WebSocket toutes les 30 s
    client_max_body_size 4m;
    proxy_pass http://127.0.0.1:3006;
}
```

Pièges :

- **Le `location ^~ /server/` doit être en ligne avant la première fusion du dossier `server/`** : `main` est servi tel quel depuis la racine du dépôt.
- **Aucun `add_header` dans ces blocs** : il annulerait tous les en-têtes de sécurité hérités (HSTS, CSP, etc.).
- Le serveur Node renvoie `Cache-Control: no-store` ; le `no-cache` du vhost s'y ajoute sans effet (`no-store` prévaut).
- Adresse client : uniquement `X-Real-IP`, écrit par nginx, et seulement si le pair TCP est `127.0.0.1`.

## 2. Modèle de données SQLite

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                     -- 'u_' + 16 octets base64url
  email TEXT NOT NULL UNIQUE,              -- trim + minuscules + NFKC
  display_name TEXT NOT NULL,              -- 1 à 50 caractères
  password_hash TEXT NOT NULL,             -- scrypt$N$r$p$sel$hash
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_at INTEGER,                  -- migration 2 ; NULL n'est jamais traité comme inactif
  inactivity_warned_at INTEGER             -- migration 2 ; date de l'avertissement réussi
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,                     -- 'brd_' + 16 octets base64url
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'board',
  meta TEXT NOT NULL DEFAULT '{}',         -- { tags, frameOrder, background }
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  token_hash BLOB NOT NULL UNIQUE,         -- SHA-256 du jeton
  role TEXT NOT NULL CHECK (role IN ('viewer','editor')),
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,                      -- NULL : pas d'expiration
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
  token_hash BLOB PRIMARY KEY,             -- SHA-256 du jeton du cookie
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  share_link_id TEXT REFERENCES share_links(id) ON DELETE CASCADE,
  guest_name TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (share_link_id IS NULL))   -- compte OU invité
) WITHOUT ROWID;

CREATE TABLE board_items (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  z INTEGER NOT NULL,                      -- position dans board.items
  rev INTEGER NOT NULL,                    -- dernière révision qui l'a écrit
  data TEXT NOT NULL,                      -- objet JSON tel que dans board.items
  PRIMARY KEY (board_id, item_id)
) WITHOUT ROWID;

CREATE TABLE board_ops (                   -- journal de reprise, pas un historique
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
```

Décisions associées :

- Objets stockés en JSON, un par ligne : les types évoluent vite, le serveur valide sans en dépendre pour le SQL.
- Purge de `board_ops` : au-delà de 8 Mio par tableau ou de 30 jours. Aucune adresse IP stockée.
- `favori` et `espaceId` restent **locaux à l'appareil** dans cette version.
- Suppression d'un tableau : définitive, propriétaire seul, confirmation. Suppression d'un compte : ses tableaux en propriété sont supprimés après avertissement listant ceux qui ont d'autres membres.

## 3. Authentification

- **Hachage : scrypt natif**, `N=2^16, r=8, p=2`, sel de 16 octets, clé de 32 octets. Node 22 n'a pas d'argon2 natif (`crypto.argon2` absent, vérifié sur la 22.23). Mesuré ici : 483 ms par calcul ; mémoire théorique d'environ 67 Mo (128 × N × r), non mesurée. La machine n'a que 1,1 Go disponible et **pas de swap** : **2 calculs simultanés au plus, file de 10, puis 503** avec `Retry-After`. Paramètres stockés dans le hash pour pouvoir les relever.
- **Mot de passe** : 12 à 128 caractères, sans règle de composition. Collage et gestionnaires autorisés (`autocomplete`), aucun captcha (WCAG 3.3.8).
- **Inscription** : e-mail non vérifié au départ, désactivable par `BARO_INSCRIPTIONS=ferme`. L'unicité renvoie un 409 explicite : sans envoi d'e-mail, l'énumération n'est pas masquable, elle est freinée par le débit.
- **Mot de passe oublié** : pas de parcours public au départ. `server/scripts/reset-password.mjs` en ligne de commande. Le parcours par e-mail (relais Postfix existant) est une version ultérieure.
- **Session** : cookie `__Host-baro_sid`, `HttpOnly; Secure; SameSite=Strict; Path=/`, 32 octets aléatoires, seul le SHA-256 est en base. 30 jours glissants (`last_seen_at` écrit au plus une fois par heure). Nouveau jeton à la connexion, purge de toutes les sessions au changement de mot de passe.
- **Strict est compatible avec un lien reçu par e-mail** : la page est statique, et ses appels `fetch` depuis la page ouverte sont de même site, donc le cookie part.
- **CSRF, sans jeton** : `SameSite=Strict` + `Origin` strictement égal à `BARO_ORIGIN` sur toute méthode d'écriture **et sur l'upgrade WebSocket** + `Content-Type: application/json` obligatoire.
- **Débit** (mémoire, fenêtre glissante, 429 + `Retry-After`) :

| Route | Limite |
|---|---|
| Connexion, avant lecture du corps | 10 / 15 min par préfixe IP (`/64` en IPv6) |
| Échec de connexion | 5 / 15 min par couple e-mail + préfixe IP ; 50 / 15 min par e-mail, succès non comptés |
| Inscription | 5 / h par préfixe IP (`/64` en IPv6) |
| Entrée par lien | 10 / min par IP |
| Autres écritures HTTP | 120 / min par session |
| Lecture d’un tableau | 60 / min par session |
| Export du compte | 1 / 10 min par compte |

- Connexion : message unique « E-mail ou mot de passe incorrect », calcul scrypt factice si le compte n'existe pas. Les 401 ne devraient déclencher aucune prison fail2ban (jails actives : `nginx-http-auth`, `nginx-botsearch`, `nginx-bad-request`) ; à confirmer au test de fumée.
- **Comptes inactifs** : un compte sans connexion depuis 24 mois est supprimé, après un e-mail d'avertissement envoyé 30 jours avant (`server/src/inactivity.js`). Durées en jours fixes : avertissement après 700 jours, suppression après 730.
  - Activité : une connexion, ou une session de compte au même endroit que le glissement horaire du jeton. Elle écrit `last_active_at` et remet `inactivity_warned_at` à `NULL`. Une session invitée ne compte pas pour un compte.
  - Passage au démarrage puis toutes les 24 h, 100 comptes au plus (suppressions d'abord, envois avec le reste), un compte à la fois. Une erreur est journalisée et le serveur continue. Les journaux ne portent que l'identifiant du compte.
  - **Règle de sûreté : jamais de suppression sans avertissement réussi d'au moins 30 jours.** Un envoi échoué ne pose aucune date et sera réessayé. Les conditions sont relues dans la transaction de suppression. La suppression suit la même logique que `DELETE /api/me` (`server/src/accounts.js`).
  - Envoi par `/usr/sbin/sendmail` (Postfix local, relais OVH), sans shell ni dépendance. Réussi signifie : code de sortie 0, donc message accepté par Postfix, pas forcément distribué. Une adresse que Postfix lirait autrement qu'une adresse unique et ASCII (virgule, guillemets, partie locale accentuée, retour à la ligne) est refusée : son compte n'est ni averti ni supprimé.
  - Configuration, sans secret : `BARO_INACTIVITY` (`actif` par défaut en production, `inactif` ailleurs ; `inactif` désactive tout) et `BARO_MAIL_FROM` (`contact@dwes.fr` par défaut). Les valeurs par défaut suffisent en production : `ecosystem.config.cjs` ne change pas (§0).
- Quotas : 100 tableaux possédés et 100 Mio cumulés par compte. Le quota d’octets est configurable par `BARO_ACCOUNT_BOARD_QUOTA_BYTES` et s’applique aux créations et remplacements entiers ; dépassement : `403 quota_exceeded`.

## 4. API HTTP (contrat, pour `api-designer`)

JSON uniquement. Erreurs : `{ "code": "...", "message": "texte français" }`. Le texte est affichable tel quel et annoncé.

| Méthode et route | Droit | Effet |
|---|---|---|
| `POST /api/auth/register` | public | `{email, password, displayName}` → 201 + cookie |
| `POST /api/auth/login` / `logout` | public / session | |
| `GET /api/me` | session | compte ou invité (`{guest, boardId}`) |
| `PATCH /api/me`, `POST /api/me/password` | compte | nom ; ancien + nouveau mot de passe |
| `DELETE /api/me` | compte + mot de passe | suppression (RGPD) |
| `GET /api/me/export` | compte | archive JSON du compte et des tableaux possédés (RGPD), envoyée tableau par tableau avec contre-pression |
| `GET /api/boards` | compte | métadonnées, rôle, `rev` |
| `POST /api/boards` | compte | `{name, icon, data}` : création ou envoi d'un tableau local ; applique `sanitizeIds` |
| `GET /api/boards/:id` | membre / invité | `{rev, role, board}` |
| `PUT /api/boards/:id/data` | editor+ | `{baseRev, data}` : remplacement entier, 409 si `baseRev` périmé |
| `PATCH /api/boards/:id` | editor+ | `{name?, icon?}` |
| `DELETE /api/boards/:id` | owner | |
| `GET /api/boards/:id/members`, `PATCH`/`DELETE .../members/:userId` | owner | rôle, retrait |
| `GET`/`POST /api/boards/:id/links`, `DELETE .../links/:linkId` | owner | liste, création, révocation |
| `POST /api/share/join` | public | `{token, guestName?}` → `{boardId, role}` |
| `GET /api/ws?board=:id` | upgrade | §5 |

## 5. Protocole de synchronisation

### Opérations

```js
{ k: 'put',   id, item }                 // crée ou ressuscite, objet complet
{ k: 'set',   id, f: { champ: valeur }, del: ['champ'] }
{ k: 'del',   id }
{ k: 'order', ids: [...] }               // ordre complet, seulement si l'ordre relatif change
{ k: 'meta',  f: { name, tags, frameOrder, background }, del: [...] }
```

### Résolution de conflit

**Dernier écrivain par objet, résolu au grain du champ de premier niveau.** Écart assumé par rapport à un remplacement d'objet complet : celui-ci ferait perdre sans bruit un texte saisi pendant qu'un autre déplace l'objet, et imposerait de renvoyer tous les points d'un dessin pour un déplacement.

- `set` sur objet supprimé : ignoré et signalé. `put` : l'emporte toujours (annuler une suppression).
- `order` : l'ordre le plus récent gagne. Le serveur retire les identifiants inconnus et ajoute à la fin les absents.
- **Exception `messages` (commentaires), fusion par union** : la clé est `date + author + text`. Le serveur ajoute les nouveaux messages avec `author` forcé au nom de la connexion et refuse un `date` à plus de 24 h de son horloge. Un retrait n'est accepté que sur les messages de l'auteur lui-même (cas de l'annulation). Sans cela, deux réponses simultanées se perdraient.
- **Limites acceptées** : `columns` (kanban), `rows` (tableau de données), `reactions` et `tags` sont un seul champ : deux modifications simultanées du même champ en perdent une, et la personne en est informée (§8).
- **Objet verrouillé** : le serveur refuse tout `set`/`del` si `locked` est vrai, sauf un `set` qui le déverrouille.

### Messages

```js
// client vers serveur
{ t: 'hello', clientId, lastRev }        // clientId : UUID par onglet
{ t: 'ops', c, base, ops: [...] }        // c : séquence client, 1 lot = 1 transaction SQLite
{ t: 'pres', x, y, sel: [...] }          // §6

// serveur vers client
{ t: 'welcome', rev, role, you, peers }
{ t: 'rev', rev, by: { id, name }, c?, clientId?, ops, rejected?: [{ id, item|null, reason }] }
{ t: 'snapshot', rev, board }
{ t: 'pres', u: [...] } | { t: 'join', peer } | { t: 'leave', id }
{ t: 'role', role } | { t: 'slow', retryMs } | { t: 'err', code, message, c? }
```

- **Un seul message `rev`, envoyé à tous, auteur compris** : il sert d'accusé de réception quand `clientId` et `c` sont les siens. Les opérations y sont **canoniques** (après validation et normalisation).
- `rejected` porte l'état serveur de l'objet refusé : c'est le mécanisme unique de réparation d'une divergence.
- Fermetures : `4401` session invalide, `4403` accès retiré, `1008` abus, `1009` trop gros, `1012` redémarrage.

### Côté client

1. **Copie de référence** : `Map(id → JSON de l'objet)` + ordre + méta, établie *après* le chargement. La comparaison ne démarre **jamais** avant un état valide : sinon un tableau vide enverrait des suppressions. `showBoard` doit donc attendre l'état distant, et afficher une erreur plutôt qu'un tableau vide.
2. **Comparaison** à chaque `notify()`, sur les champs de premier niveau. Les sélections donnent une comparaison vide. **Champs dérivés exclus** (sinon chaque client les réémet en boucle) : `x, y` d'un commentaire avec `targetId`, `width, height` de `kanban` et `datatable`, tous recalculés par `syncDerived`.
3. **Envoi** optimiste, regroupé au plus toutes les 100 ms, lots découpés sous 200 Kio. Le glisser ne notifie qu'à la fin : pas de rafale.
4. **Réception** : nouvelle fonction `state.applyRemote(ops)`. Elle modifie `board.items` **sur place** (les gestes en cours gardent leur référence), garde la sélection, n'appelle pas `loadBoard` (qui vide l'historique), puis met à jour la référence *après* normalisation. Pour un champ avec une écriture locale en attente, seule la référence est mise à jour : la valeur locale sera ordonnée après par le serveur, tous convergent.

### Identifiants : changement obligatoire

`generateId()` produit `item-N` par onglet : **deux personnes créeraient le même identifiant**. En mode partagé : `item-c<8 caractères aléatoires par onglet>-<n>`, conforme à `SAFE_ID`. `syncNextId` l'ignore (`parseInt` donne `NaN`). Les identifiants existants sont conservés. Le mode local garde `item-N`.

### Annuler / rétablir

`history.js` stocke des instantanés complets : les restaurer écraserait le travail des autres, et les réécrire à chaque opération distante coûterait jusqu'à 200 analyses JSON par lot. **En mode partagé, l'historique devient une pile de patchs.**

- `history.js` gagne un compteur de `pushState` et un mode externe : `pushState` n'y fait plus d'instantané. **Le mode local ne change pas.**
- À chaque comparaison non vide : si le compteur a bougé, nouvelle entrée `{ forward, inverse }` ; sinon fusion dans l'entrée du sommet. C'est la sémantique actuelle de `updateItem(..., record=false)`.
- `state.undo()` en mode partagé : applique `inverse` **uniquement sur les champs dont la valeur vaut encore `forward`**, puis le résultat repart comme une écriture normale. Rétablir est symétrique. Portée : ses propres actions, cet onglet, perdu au rechargement (comme aujourd'hui).
- Annonces : « Action annulée » ; « Action annulée en partie : Claire a modifié cet élément entre-temps » ; « Rien à annuler : … ».
- L'inverse d'une suppression est un `put` (avec `order` si l'objet n'était pas au sommet).

### Coupure, reprise, hors-ligne

- **Connexion** : ping toutes les 30 s ; reconnexion avec attente exponentielle et aléa, de 1 à 30 s.
- **Reprise** : `hello.lastRev`. S'il reste couvert par `board_ops`, le serveur renvoie les `rev` manquantes, sinon un `snapshot`, appliqué aussi par `applyRemote` (ni perte d'historique, ni perte de focus). Le client renvoie ensuite ses lots non accusés, avec les mêmes `clientId`/`c`.
- **Idempotence** : `UNIQUE(board_id, client_id, client_seq)`. Un lot déjà vu renvoie sa `rev`, sans réappliquer.
- **Hors-ligne** : on continue d'éditer ; les lots s'accumulent et, au-delà de 100, ceux jamais envoyés sont **fusionnés** (`set`+`set`, `put`+`set`, `put`+`del`).
- **Miroir local** : clé séparée `tableau-accessible-distants` (`{ id, nom, rev, role, données, sortants }`), écrite avec 1 s de délai, **plafonnée à 2 Mio**, éviction du moins récent sans sortants. Le miroir ne peut donc pas remplir le quota et faire échouer l'enregistrement des tableaux locaux. Si le tableau n'entre pas : pas de hors-ligne pour lui, et un message le dit (`boards.save()` échoue aujourd'hui en silence).
- **Accès perdu** (`4403`, 404 à la reprise) : message clair et proposition « Garder une copie locale », qui convertit le miroir en tableau local ordinaire.
- **Invités** : mémoire seule, rien dans `localStorage` (poste partagé). Une déconnexion de compte purge le miroir, après avertissement s'il reste des sortants.
- **Mode lecture** : boutons d'édition désactivés et annonce « Tableau en lecture seule » ; filet universel : toute comparaison non vide est annulée localement depuis la référence et n'est jamais envoyée. Le serveur refuse de toute façon.
- **Passage de local à distant** : action explicite « Enregistrer sur mon compte ». L'entrée locale n'est retirée qu'après le 201 et l'écriture du miroir. Aucune migration automatique. Inverse : « Garder une copie locale ».
- **Import JSON dans un tableau distant : refusé**, avec message (il passerait par `loadBoard` et produirait un remplacement massif). Importer dans un nouveau tableau reste possible.

## 6. Présence et curseurs

- **Client** : `pres` au plus **10 fois par seconde**, en trailing, seulement si changement, et jamais si `bufferedAmount > 64 Kio`. Coordonnées du tableau (indépendantes du zoom). `sel` : élément ciblé ou sélection, 20 au plus.
- **Serveur** : 20 `pres` par seconde par connexion, l'excédent est jeté sans erreur. Diffusion **groupée toutes les 100 ms**, dernière valeur seulement, jamais stockée. Couleur attribuée par le serveur dans une palette à 3:1 minimum sur les fonds clairs et sombres.
- **Clavier** : un utilisateur sans souris émet `sel`, et apparaît donc aux autres comme un utilisateur à la souris.
- **Rendu** : calque `<g id="remote-cursors" aria-hidden="true">`, sans focus ni `pointer-events`, hors de `#canvas-items` (donc déjà exclu des exports SVG et PNG). Flèche + **nom affiché** : la couleur n'est jamais le seul repère. Sans interpolation si `prefers-reduced-motion`. 20 curseurs au plus affichés, masquables dans les préférences. Nom posé par `textContent`.
- **Équivalent non visuel, obligatoire** : panneau « Personnes présentes » accessible au clavier : nom, rôle, élément actuel, bouton « Aller à l'élément » (réutilise `gotoItem`). Sans lui, l'information des curseurs serait réservée aux personnes qui voient et utilisent une souris.

## 7. Lien de partage

- **Jeton** : `randomBytes(32)` en base64url (256 bits), seul le SHA-256 est en base. **Affiché une seule fois** à la création, puis lien listé par libellé, rôle, date, dernier usage. Perdu : on en crée un autre.
- **URL** : `https://baro.dwes.fr/#/partage/<jeton>`. Le fragment n'atteint ni nginx, ni ses journaux, ni le `Referer`. Le client envoie le jeton par `POST`, puis fait `history.replaceState` vers `#/tableau/<id>`.
- **Réglages** : rôle **« lecture » par défaut** ou « édition », expiration facultative, propriétaire seul.
- **Connecté** : entrée dans `board_members` avec `via_link_id`, sans jamais abaisser un rôle déjà supérieur.
- **Non connecté** : nom demandé (formulaire étiqueté), session invitée limitée à ce lien, 7 jours. Le serveur suffixe « (invité) » pour empêcher l'usurpation d'un membre. Un nouveau lien remplace la session invitée précédente.
- **Invalide, expiré ou révoqué** : **la même réponse 404** dans tous les cas.
- **Révocation immédiate** : en une transaction, `revoked_at`, suppression des sessions invitées et des membres `via_link_id` de ce lien ; les sockets concernées sont fermées en `4403`. Les membres ajoutés autrement restent.
- **Hors périmètre** : ajout d'un membre par e-mail (évite une seconde surface d'énumération). Le lien suffit au départ.

## 8. Accessibilité des événements distants

- **Région dédiée** `#announcer-collab` (`aria-live="polite"`, `aria-atomic`) : `announce()` vide sa région avant d'écrire, une annonce distante effacerait donc la réponse à une action locale.
- **Digest** : au plus une annonce toutes les **5 s**, retardée de 1,5 s après une annonce locale, jamais pendant une saisie. Un seul élément : « Claire a modifié le post-it « Budget » ». Plusieurs : « Claire a modifié 3 éléments », « 2 personnes ont modifié 7 éléments ». Jamais `assertive`.
- **Arrivées et départs** : regroupés sur 3 s ; départ annoncé après **15 s** de grâce, pour taire les rechargements et les coupures brèves.
- **Préférence** « Annonces de collaboration » : toutes (défaut), arrivées et départs seulement, aucune. **Journal « Activité récente »** consultable (50 entrées, sans `aria-live`) : l'annonce n'est jamais la seule trace.
- **Modification concurrente** : si un autre écrase un champ écrit par soi depuis moins de 3 s : « Modification simultanée sur … : la version de Claire a été retenue ».
- **État de connexion** : `role="status"`, annoncé seulement après 5 s de stabilité : « Hors ligne : vos modifications sont gardées sur cet appareil », « Reconnecté, 3 modifications envoyées ».
- **Focus préservé, point bloquant** : `outline.js` et `table.js` reconstruisent tout (`innerHTML = ''`) puis refocalisent ; chaque modification distante ferait relire l'élément et perdre la position du curseur virtuel. **Abonnés avec un 3e argument `{ remote: true }` : si le focus est dans la vue, le rendu est différé jusqu'à `focusout` ou à la prochaine action locale.** Même règle pour le canevas si le focus est sur un sous-élément (`data-sub`), et pour le panneau de commentaires (les brouillons sont déjà conservés).
- **Élément focalisé supprimé à distance** : focus sur le canevas et annonce « L'élément que vous consultiez a été supprimé par Claire ». Dialogue ou éditeur ouvert sur cet élément : le contenu reste affiché, l'enregistrement explique que l'élément n'existe plus et propose de copier le texte.
- **Dialogues, messages, connexion** : mêmes règles que le reste de l'appli, erreurs liées au champ (`aria-describedby`), français avec accents, cibles de 24 px minimum, vérifiés de 320 px à 1280 px.

## 9. Limites et validation serveur

**Rejeter, jamais réparer** pour les opérations temps réel ; un lot avec opération invalide renvoie l'objet dans `rejected` et applique le reste. L'import initial (`POST /api/boards`) passe, lui, par `sanitizeIds` puis la même validation.

**Code partagé** : nouveau module pur `js/model-rules.js` (`SAFE_ID`, `ID_REFS`, `sanitizeIds`, `PALETTE`, `SHAPES`, `TYPES`), réexporté par `state.js`, qui ne change donc pas pour ses appelants. Le serveur importe `../js/model-rules.js`, `../js/lines.js` (`normalizeLine`, `CAPS`, `LINE_TYPES`…) et `../js/objects.js` (`REACTIONS`, `LANGUAGES`, `TAG_COLORS`, `BOARD_BACKGROUNDS`), tous sans DOM. **Un seul jeu de règles.** Réexécuter `normalizeLine` côté serveur rend canoniques les connecteurs.

| Limite | Valeur |
|---|---|
| Message WebSocket (`ws` `maxPayload`) | 256 Kio |
| Corps HTTP | 16 Kio sur l’authentification et les routes de compte ; 4 Mio sur les données de tableau (nginx et Node) |
| Tableau | 5 000 objets, 4 Mio de JSON |
| Objet | 128 Kio de JSON |
| Texte d'un champ | 50 000 caractères ; noms, étiquettes, libellés : 200 |
| `points` / `waypoints` | 10 000 / 200 |
| Kanban | 50 colonnes, 500 cartes par colonne |
| Tableau de données | 200 lignes × 50 colonnes |
| Messages par commentaire / étiquettes par tableau | 500 / 200 |
| Connexions | 50 par tableau, 10 par compte, 200 au total |
| Débit par connexion | 30 lots/s et 1 Mio/10 s ; au-delà `slow` (le client met en file) ; abus répété : `1008` |

Règles qui vont au-delà de `sanitizeIds`/`normalizeLine`, chacune liée à un défaut réel du client face à des données qui ne viennent plus de soi :

- **Clés** : refus récursif de `__proto__`, `constructor`, `prototype` (un `Object.assign` côté client changerait le prototype de l'objet). Clés de premier niveau sous `/^[A-Za-z]\w{0,39}$/`.
- **Identifiants** : `SAFE_ID` sur `id`, `ID_REFS`, identifiants imbriqués (`columns[].id`, `cards[].id`, `tags[]`, `frameOrder[]`). Plusieurs sélecteurs n'échappent pas (`[data-id="${id}"]`).
- **Énumérations** : `type`, `color`, `shape`, `language`, `stroke` et `lineType`, clés de `reactions`, `background`, `icon`. `app.js:574` injecte `item.color` dans un sélecteur, ce qui lèverait une erreur à l'ouverture du dialogue.
- **Cycles `parentNode` refusés, profondeur limitée à 64** : `mindLevel` et `mindRoot` bouclent à l'infini, `mindDescendants` déborde la pile. Un seul client malveillant gèlerait tous les onglets. L’import historique détache les nœuds au-delà de 64 ; la validation stricte les rejette. Autoréférences refusées sur tous les `ID_REFS`.
- **Champs structurels requis et non supprimables** : `columns`, `rows`, `messages`, sinon `normalizeItem` génère des identifiants aléatoires **différents sur chaque client** via `O.defaults`.
- **Nombres** : finis, entre -10^7 et 10^7 ; `width`/`height` entre 0 et 10^5. `type` immuable par `set`.
- **Audit `security-auditor` avant la v1.10.0** : tous les chemins des données vers le DOM. Lecture préliminaire : le contenu passe par `textContent` ou `escapeHtml`, et `insertAdjacentHTML` d'`icons.js` reçoit un nom normalisé. La CSP reste le second rempart.

## 10. Phases et fichiers

Chaque version est livrable et testable seule. **Préalable commun, avant toute fusion de `server/` : `location ^~ /server/` en ligne.** Puis, dans l'ordre : serveur, proxy `/api/`, client.

### v1.9.0 : serveur, comptes, enregistrement

Livré : comptes, sessions, tableaux distants, miroir, envoi d'un tableau local vers le compte, tableau de bord avec badge « Sur mon compte » et « Sur cet appareil ». Écriture par `PUT .../data` (3 s de délai). Conflit `409` : aucune fusion, copie créée « (conflit du JJ/MM) » et annoncée.

```
server/package.json, package-lock.json, ecosystem.config.cjs
server/src/index.js, config.js, http.js (routeur, garde Origin, corps JSON, erreurs)
server/src/db.js, migrations.js
server/src/auth.js (scrypt, file de calcul, sessions), rate-limit.js
server/src/accounts.js, inactivity.js, mail.js (comptes inactifs, §3)
server/src/routes/auth.js, me.js, boards.js
server/src/validate.js
server/scripts/reset-password.mjs, backup.mjs
server/deploy/baro.nginx.conf.example, baro-backup.service, baro-backup.timer
server/tests/auth.test.js, boards.test.js, validate.test.js, inactivity.test.js
js/model-rules.js            (nouveau)
js/sync/api.js               (nouveau)
js/store/remote-boards.js    (nouveau, miroir)
js/views/account-dialog.js   (nouveau)
tests/e2e-compte.mjs, tests/helpers/app-server.mjs  (nouveaux)
```

Modifiés : `js/state.js` (extraction), `js/store/boards.js` (`get`/`getAll` fusionnés, `save()` qui rend compte de l'échec), `js/app.js` (`showBoard` asynchrone avec garde de course, refus d'import dans un tableau distant), `js/router.js` (`#/compte`), `js/views/dashboard.js`, `js/views/board-actions.js`, `index.html`, `css/`, `.gitignore`, `README.md`, `CHANGELOG.md`.

### v1.10.0 : synchronisation temps réel

Livré : §5 et §8 hors présence. Plusieurs onglets ou appareils d'un même compte collaborent déjà : testable sans le partage. `PUT .../data` n'est plus utilisé par le client.

```
server/src/ws/hub.js (salons, ping, débit), server/src/ws/protocol.js
server/src/ops.js (application d'un lot, fusion de messages, purge)
server/tests/ops.test.js, sync.test.js, convergence.test.js
js/sync/diff.js, shared-history.js, outbox.js, client.js  (nouveaux, les 3 premiers purs)
js/a11y/collab-announcer.js  (nouveau)
js/views/activity-panel.js   (nouveau)
tests/e2e-synchro.mjs        (nouveau)
```

Modifiés : `js/state.js` (`applyRemote`, préfixe d'identifiants, `undo`/`redo` déléguées), `js/store/history.js`, `js/app.js`, `js/views/outline.js`, `table.js`, `canvas.js`, `comments-panel.js` (rendu différé), `js/preferences.js`, `js/views/preferences-menu.js`, `js/views/board-actions.js` (renommage par `meta`), `index.html`, `css/`.

### v1.11.0 : curseurs et partage

Livré : §6, §7, rôles appliqués dans l'interface, invités.

```
server/src/routes/links.js, members.js
server/src/ws/presence.js
server/tests/share.test.js, presence.test.js
js/views/share-dialog.js, presence-panel.js, remote-cursors.js  (nouveaux)
tests/e2e-partage.mjs        (nouveau)
```

Modifiés : `js/router.js` (`#/partage/<jeton>`), `js/views/canvas.js` (calque), `js/app.js` (lecture seule), `js/a11y/collab-announcer.js`, `index.html`, `css/`.

## 11. Plan de tests

Environnement : `node:test` côté serveur, base temporaire, sur port éphémère. Playwright côté navigateur, avec `tests/helpers/app-server.mjs` (statique + `/api` proxifié, WebSocket compris, pour rester de même origine). **`tests/e2e.mjs` reste vert sans modification à chaque version.**

**v1.9.0**

1. Le mode local n'émet aucune requête `/api/` et ne change pas la clé `tableau-accessible-boards` (octet pour octet sur un scénario type).
2. Hash scrypt vérifié, relèvement des paramètres, file saturée : 503.
3. Cookie : attributs exacts, jeton absent de la base en clair, purge au changement de mot de passe.
4. `Origin` absent ou étranger : 403 ; `Content-Type` de formulaire : 415.
5. Débits : 429 et `Retry-After`, sur IP et e-mail.
6. Droits : matrice `owner`/`editor`/`viewer`/étranger sur chaque route.
7. Validation : table de cas par règle du §9 (`__proto__`, cycle, énumération, taille).
8. Envoi d'un tableau local : données identiques au rechargement, entrée locale retirée seulement après 201.
9. Miroir plein : tableau local toujours enregistré, message affiché.
10. Parcours compte au clavier seul, axe-core, 320 à 1280 px.

**v1.10.0**

1. Convergence : test à graine fixe, N clients virtuels, opérations aléatoires, coupures, réordonnancements ; états finaux identiques au serveur.
2. Idempotence : lot rejoué, une seule `rev`.
3. Reprise par `rev` et par `snapshot` (journal purgé).
4. Annuler n'écrase pas une modification distante du même objet (autre champ) ; annulation partielle (même champ) annoncée.
5. Annuler une suppression rétablit l'objet et son identifiant.
6. Deux créations simultanées : aucune collision d'identifiant.
7. Deux réponses simultanées à un commentaire : les deux restent ; auteur forcé par le serveur.
8. Champs dérivés : déplacer la cible d'un commentaire n'émet **aucune** opération sur le commentaire ; pas de boucle entre deux clients.
9. Hors-ligne : édition, rechargement, reconnexion ; sortants envoyés une seule fois.
10. Tableau distant inaccessible à l'ouverture : erreur affichée, **aucun `del` émis**.
11. Focus dans le plan ou la table : DOM inchangé tant que le focus reste, rendu à la sortie.
12. Annonces : rafale de 50 lots en 5 s, au plus 1 annonce dans la région ; préférence « aucune » respectée ; `#announcer` jamais écrasé.

**v1.11.0**

1. Présence : 100 mouvements en 1 s, au plus 10 messages émis, diffusion groupée à 100 ms.
2. `#remote-cursors` : `aria-hidden`, aucun élément focalisable, absent des exports SVG et PNG.
3. Panneau « Personnes présentes » et « Aller à l'élément » au clavier seul.
4. Arrivée et départ regroupés ; rechargement sous 15 s : pas d'annonce.
5. Jeton absent des journaux et de la barre d'adresse après entrée.
6. Lien révoqué ou expiré ou faux : réponses identiques.
7. Révocation : socket fermée en moins d'une seconde, autres membres intacts, copie locale proposée.
8. Rôle lecture : refus serveur d'un `ops` forgé, filet local, annonce.
9. Rôle jamais abaissé par l'entrée sur un lien.
10. Invité : aucune écriture en `localStorage`.

**Test de fumée en production, à chaque version** : `/server/package.json` et `/server/src/index.js` en 404 ; `/api/me` avec en-têtes de sécurité présents ; WebSocket établie depuis un vrai navigateur **sans violation CSP** (Chromium, Firefox, WebKit) ; `127.0.0.1:3006` injoignable de l'extérieur.

**Portes** : `security-auditor` (authentification, CSWSH, §9), `accessibility-engineer` avec test réel au lecteur d'écran (NVDA ou Orca) sur le §8, `performance-engineer` sur 5 000 objets.

## 12. Risques et arbitrages

| Risque | Gravité | Traitement |
|---|---|---|
| `server/` publié avant le `location` 404 | Élevée | Préalable bloquant du §10, test de fumée. Base hors racine de toute façon |
| Comparaison lancée sur un état vide : suppressions en masse | Élevée | §5 (référence préalable), test 10 de la v1.10.0 |
| Un éditeur efface tout le tableau (invités compris), sans historique de versions côté serveur | Moyenne | Lien en lecture par défaut, sauvegarde quotidienne. Historique de versions : version ultérieure |
| Pas de vérification d'e-mail, inscription ouverte : abus de stockage | Moyenne | Débit, quotas, `BARO_INSCRIPTIONS=ferme` |
| Comptes inactifs : avertissement accepté par Postfix puis jamais reçu (adresse non vérifiée, rebond) : suppression quand même au bout de 30 jours | Moyenne | Connaissance des rebonds hors périmètre. Sauvegarde quotidienne, 14 jours conservés |
| Mot de passe oublié sans parcours public | Moyenne | Commande d'administration ; parcours e-mail à planifier |
| Mémoire : 1,1 Go disponible, pas de swap | Moyenne | 2 scrypt simultanés, 400 Mo PM2, une seule instance |
| 5 000 objets : `notify()` déclenche déjà snapshot et rendu complet à chaque changement ; les lots distants les multiplient | Moyenne | Application groupée par trame (une seule `notify`), miroir à 1 s, mesure par `performance-engineer` avant la v1.10.0. Rendu incrémental si nécessaire |
| `columns`, `rows`, `reactions` en dernier écrivain : perte possible à l'écriture simultanée | Faible à moyenne | Annonce de modification simultanée. Fusion fine ultérieure si l'usage le demande |
| Processus unique : pas de haute disponibilité | Faible | Reprise automatique du client, redémarrage en `1012`. Volontaire |
| **Nouveau traitement de données personnelles** (e-mails, contenus, invités) | Obligation | **Avant l'ouverture publique** : ligne au registre RGPD DWES, mentions d'information, durées (sessions, journal à 30 jours), export et suppression prévus au §4 |

## 13. Hors périmètre

Versions et restauration, invitations par e-mail, notifications, espaces et favoris partagés, édition de texte simultanée dans un même champ (CRDT), curseurs de saisie, verrous d'édition, équipes, SSO.
