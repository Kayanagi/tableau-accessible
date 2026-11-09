# Mot de passe oublié et données du compte sur le serveur (v1.11.0)

Demande de Wesley (2026-11-09) : mot de passe oublié en libre-service ; ranger sur le serveur les données propres au compte, aujourd'hui gardées dans le navigateur (`js/store/account-local.js`), pour qu'elles ne soient plus lisibles sur un appareil partagé.

## 1. Mot de passe oublié

### Serveur

Migration 5 :

```sql
CREATE TABLE password_resets (
  token_hash BLOB PRIMARY KEY,          -- SHA-256 du jeton, jamais le jeton
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,          -- 1 heure
  used_at INTEGER
) WITHOUT ROWID;
CREATE INDEX password_resets_user ON password_resets(user_id);
```

| Route | Effet |
|---|---|
| `POST /api/auth/password-reset` `{email}` | Toujours **202** `{}` au même corps et à une durée comparable, que l'adresse ait un compte ou non (pas d'énumération). Si le compte existe : jeton aléatoire de 32 octets (base64url), haché en base, 1 h, usage unique ; les jetons précédents non utilisés du compte sont invalidés ; e-mail envoyé **après** la réponse (en tâche différée, sans bloquer ni faire varier la durée). Débit : 3 demandes par heure par adresse (comptées que le compte existe ou non), 10 par heure par préfixe IP, 50 par heure au total ; au-delà, 202 identique sans envoi (journal technique minimal, sans adresse en clair). |
| `POST /api/auth/password-reset/confirm` `{token, password}` | Jeton valide, non utilisé, non expiré → nouveau mot de passe (mêmes règles et même hachage scrypt que l'inscription), **toutes les sessions du compte supprimées**, jeton marqué utilisé, autres jetons supprimés ; 204. Sinon 400 `invalid_token` (même réponse pour inexistant, expiré, utilisé). Débit 10 par 15 min par préfixe IP. Mot de passe invalide : 400 avec le code existant. |

Routes publiques (pas de session), Origin strict et JSON comme les autres écritures, corps ≤ 16 Kio. Purge des jetons expirés avec la purge horaire existante. Suppression du compte : cascade.

E-mail (via `server/src/mail.js`, expéditeur `contact@dwes.fr`, texte brut en français) : objet « Baro : réinitialiser votre mot de passe » ; lien `https://baro.dwes.fr/reinitialiser.html#jeton=<jeton>` (le jeton est dans le fragment : il n'atteint ni les journaux nginx ni le Referer) ; validité 1 h ; « Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas. » Aucune donnée de tableau dans l'e-mail. L'adresse de base du lien vient de la configuration (`BARO_PUBLIC_URL`, défaut `https://baro.dwes.fr`).

### Client

- `connexion.html` et l'écran de connexion dans l'application : lien « Mot de passe oublié ? » qui affiche un formulaire e-mail ; après envoi, toujours le même message : « Si un compte existe pour cette adresse, un e-mail vient de partir. Le lien est valable une heure. Pensez à vérifier les indésirables. »
- Nouvelle page publique autonome `reinitialiser.html` + `js/reinitialiser.js` (réutilise `css/connexion.css`, aucun import, chemins absolus) : lit le jeton dans le fragment puis l'efface de la barre d'adresse (`history.replaceState`), demande le nouveau mot de passe deux fois (mêmes règles et aides que l'inscription), envoie la confirmation ; succès → message et lien « Se connecter » ; jeton invalide → message clair et lien pour refaire une demande.
- nginx : `reinitialiser.html` et `js/reinitialiser.js` s'ajoutent aux fichiers publics (`auth_request off`), dans `server/deploy/nginx-baro.dwes.fr.conf`.
- `rgpd@dwes.fr` reste mentionné en dernier recours.

## 2. Données du compte sur le serveur

Aujourd'hui `account-local.js` garde par compte dans `localStorage` : `espaces`, `favoris`, `placement` (tableau → espace), `modèles` (« Mes modèles »), `usage` (modèles récents). Elles passent sur le serveur ; le navigateur n'en garde qu'une copie de travail effacée à la déconnexion.

### Serveur

Migration 5 (suite) :

```sql
CREATE TABLE account_data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,                   -- JSON validé
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
```

| Route | Effet |
|---|---|
| `GET /api/me/data` | 200 `{rev, data}` ; compte sans données → `{rev: 0, data: {espaces: [], favoris: [], placement: {}, modèles: [], usage: {}}}` |
| `PUT /api/me/data` `{baseRev, data}` | `baseRev` ≠ rev courant → 409 `conflict` `{rev}` ; sinon remplace, rev + 1, 200 `{rev}` |

Validation stricte (dans `validate.js`) : uniquement les cinq clés ; `espaces` ≤ 200 (`id` motif sûr, `nom` 1 à 200 caractères normalisés comme les noms de tableau) ; `favoris` et `placement` ne référencent que des identifiants au format de tableau (pas de contrôle d'accès nécessaire : un identifiant sans accès ne révèle rien et n'est pas affiché) ; `modèles` ≤ 100, chacun validé comme un tableau (`prepareBoard`/`prepareImport`) avec nom et identifiant ; `usage` ≤ 200 entrées numériques. Taille sérialisée ≤ 2 Mio et **comptée dans le quota de 100 Mio du compte**. Corps de la route ≤ 2,5 Mio (exception à la limite de 16 Kio des routes de compte, comme pour les tableaux). Export du compte (`/api/me/export`) : inclut `data`. Débit d'écriture : celui des tableaux.

### Client

- `account-local.js` garde son interface publique (le reste du code ne change pas) mais devient un cache : à la connexion, `GET /api/me/data` ; chaque modification met à jour le cache puis envoie un `PUT` différé (≈1 s, regroupé) avec `baseRev` ; sur 409, relire, refaire la modification par fusion (union des espaces et favoris par identifiant, dernière valeur pour placement/usage, union des modèles par identifiant), renvoyer.
- Migration : au premier `GET` d'un compte à `rev 0`, si le stockage local du compte (`tableau-accessible-compte-<id>`) contient des données, les envoyer, puis effacer la clé locale après succès. Les données d'avant les comptes (dialogue d'import) suivent le même chemin.
  - **Tel qu'implémenté : à chaque chargement du compte, quelle que soit sa révision** (pas seulement à `rev 0`). Choix : un ancien appareil peut se connecter après qu'un autre a déjà rempli le compte (rev > 0) ; s'en tenir à `rev 0` laisserait ses espaces, favoris et modèles sur l'appareil sans jamais les envoyer, ou les ferait effacer sans envoi. L'envoi est une fusion (union par identifiant, place d'un tableau jamais écrasée, usage le plus récent) : rien de ce qui est sur le serveur n'est écrasé. Effet assumé : un élément supprimé depuis un autre appareil, mais encore présent dans l'ancien stockage de cet appareil, revient dans le compte au premier chargement ici.
  - La clé locale n'est effacée qu'après l'accord du serveur, élément par élément : elle est réécrite avec les seuls espaces et modèles refusés (élément invalide, refus `400` avec `path`), qui restent sur l'appareil ; refusée en entier (quota, taille) ou jamais envoyée (hors ligne, onglet fermé), elle reste telle quelle. Favoris, places et usages qui ne désignent pas un tableau ou un modèle du serveur (identifiant local) n'y sont pas gardés. Un essai par chargement du compte dans l'onglet : ce qui est refusé n'est pas renvoyé en boucle. Elle n'est effacée sans envoi qu'avec la suppression du compte.
  - Reprises (espaces d'avant la 1.10 marqués à un compte, favoris et espaces d'un ancien miroir) : écrites dans cette même clé, puis envoyées par le même chemin.
  - Dialogue d'import (espaces et « Mes modèles » d'avant les comptes) : chaque élément ne quitte l'espace commun de l'appareil qu'une fois enregistré par le serveur ; le compte rendu n'est affiché qu'après la réponse et dit, élément par élément, « importé », « refusé » (avec la raison, l'élément reste sur l'appareil) ou « pas encore enregistré » (le serveur n'a pas répondu ; l'élément reste sur l'appareil et en est retiré si l'envoi aboutit plus tard).
- Déconnexion : le cache est vidé ; l'option « Les garder sur cet appareil » ne concerne plus que le travail non envoyé des tableaux (le texte de l'écran est adapté ; espaces, favoris et modèles ne sont plus listés puisqu'ils sont sur le serveur — sauf modifications non encore envoyées, qui sont d'abord envoyées ou signalées).
- Hors ligne avec onglet ouvert : modifications gardées dans le cache et envoyées au retour (événement `online` existant). Fermer l'onglet avec des modifications non envoyées déclenche l'avertissement du navigateur (`beforeunload`), comme pour les tableaux ; au retour depuis le cache de navigation (`pageshow` persisté), l'envoi reprend.
- Refus du serveur : un élément précis (`400` avec `path`) est retiré et nommé, le reste repart ; un refus d'ensemble (`403 quota_exceeded`, `400 too_large`/`too_many`, `413`) ne jette pas le lot : chaque modification est réessayée seule, et seules celles que le serveur refuse seules sont retirées, en les nommant.
- Session expirée puis reconnexion dans le même onglet : les modifications en attente sont gardées et la copie est relue du serveur avant d'être renvoyée. Déconnexion faite dans un autre onglet : un dernier envoi est tenté ; ce qui n'a pas pu partir est signalé sur l'écran de connexion.
- Page de confidentialité : espaces, favoris et modèles enregistrés sur le serveur avec le compte, supprimés avec lui, inclus dans l'export.

## Contrat serveur tel qu'implémenté

Précisions là où le texte ci-dessus était muet. Toutes les erreurs gardent la forme existante `{code, message}` (+ `path` pour la validation, + `rev` pour 409).

### Mot de passe oublié

- `POST /api/auth/password-reset` `{email}` : **202 `{}`** (corps `{}`, sans cookie) pour toute adresse bien formée, compte ou non, débit dépassé ou non. Adresse mal formée ou absente : **400 `invalid_email`** (« Adresse e-mail invalide. ») — ne révèle rien, aucune adresse mal formée n'a de compte. Débits contrôlés dans l'ordre préfixe IP (10/h), adresse (3/h, clé = SHA-256 de l'adresse normalisée), total (50/h) ; une demande refusée par un débit ne consomme pas les suivants. La recherche du compte, la création du jeton et l'envoi partent tous en tâche différée (`setImmediate`) après la réponse : la requête ne touche pas la table `users`.
- `POST /api/auth/password-reset/confirm` `{token, password}` : **204** sans corps ni cookie (aucune session n'est ouverte : la personne se connecte ensuite). Ordre : jeton (format `[\w-]{43}` puis base) → **400 `invalid_token`** « Ce lien de réinitialisation n’est plus valable. Refaites une demande. », identique pour absent, mal formé, inconnu, expiré, utilisé ; puis mot de passe → **400 `invalid_password`** (même message que l'inscription), le jeton reste alors utilisable. Le jeton est relu dans la transaction (deux confirmations simultanées : une seule passe). Débit **429 `rate_limited`** + `Retry-After` au 11ᵉ essai par préfixe IP en 15 min.
- Une nouvelle demande supprime les jetons non utilisés du compte ; la confirmation marque le jeton utilisé et supprime tous les autres jetons du compte. Purge horaire : jetons dont `expires_at` est passé (utilisés compris).
- Journaux : « débit atteint (préfixe IP|adresse|total), aucun envoi » ; « envoi non confirmé pour le compte <id> ». Jamais d'adresse ni de jeton.

### E-mails : expéditeur et capture en test

`server/src/mail.js` → `createMailer(config)` choisit l'expéditeur du processus (mot de passe oublié **et** avertissements d'inactivité) :

| Situation | Envoi |
|---|---|
| `BARO_MAIL_CAPTURE=<chemin>` (refusée si `NODE_ENV=production`, le démarrage échoue) | une ligne JSON par message ajoutée au fichier (créé en 0600) : `{"from","to","subject","text","date"}` |
| `NODE_ENV=production` | `/usr/sbin/sendmail` comme avant |
| autre (développement, tests) | aucun envoi, un avertissement unique dans le journal |

Tests serveur : `createApp(config, { send })` accepte un expéditeur injecté ; `startServer()` (tests/helpers.js) injecte par défaut un faux qui range les messages dans `s.sent`, et `await s.settle()` attend la fin des envois différés.

Tests de bout en bout : dans `tests/helpers/app-server.mjs`, ajouter à l'environnement du processus enfant `BARO_MAIL_CAPTURE: join(dir, 'mails.jsonl')` et `BARO_PUBLIC_URL: origin` (sinon le lien pointe vers `https://baro.dwes.fr`). L'e-mail part **après** la réponse 202 : relire le fichier jusqu'à y trouver une ligne pour l'adresse (quelques dizaines de ms), puis extraire le lien avec `/https?:\/\/\S+\/reinitialiser\.html#jeton=([\w-]{43})/`. Au démarrage, le serveur écrit sur la sortie standard « e-mails capturés dans un fichier : usage de test uniquement ».

### Données du compte

- `GET /api/me/data` → 200 `{rev, data}` ; `PUT /api/me/data` `{baseRev, data}` → 200 `{rev}`. Compte requis (401 sans session, 403 `account_required` pour un invité). `baseRev` absent, négatif ou non entier → 400 `invalid_base_rev`. Conflit → 409 `{code: "conflict", message, rev}`.
- `data` : seules `espaces`, `favoris`, `placement`, `modèles`, `usage` ; une clé absente vaut vide ; toute autre clé (y compris `version` de l'ancien format local) → 400 `invalid_key`. Le serveur range une forme normalisée (renvoyée par le `GET` suivant, pas par le `PUT`).
  - `espaces` : ≤ 200, `{id, nom}` seulement, `id` sûr (`[\w-]+`, ≤ 128) et unique, `nom` normalisé (NFC, espaces retirés aux bords) de 1 à 200 caractères.
  - `favoris` : ≤ 2000, identifiants de tableau `brd_` + 22 caractères base64url, sans doublon.
  - `placement` : ≤ 2000 entrées, clé = identifiant de tableau, valeur = identifiant sûr (l'espace peut ne pas exister).
  - `modèles` : ≤ 100, champs admis `id` (sûr, unique), `nom` (comme un nom de tableau), `description` (≤ 1000 caractères), `créé` (entier ≥ 0), `partage` (booléen), `snapshot` (obligatoire). `snapshot` passe par `prepareImport` (reprises historiques : couleurs anciennes, structures manquantes) et est rangé sous forme de tableau `{name?, tags, frameOrder?, background?, items}`. Les champs d'affichage (`categorie`, `tags`, `données`) sont refusés : les retirer avant l'envoi, comme le fait déjà `stored()`.
  - `usage` : ≤ 200 entrées, clé sûre, valeur entier ≥ 0.
  - Codes : `invalid_key`, `invalid_id`, `duplicate_id`, `invalid_name`, `too_many`, `too_long`, `out_of_range`, `forbidden_key`, `missing_structure`, `invalid_enum`… avec `path` (`data.espaces[0].nom`, `data.modèles[0].snapshot.items[3].color`).
- Taille sérialisée > 2 Mio → 400 `too_large` ; corps > 2,5 Mio → 413 `body_too_large`. Quota : tableaux possédés + données du compte ≤ 100 Mio, sinon 403 `quota_exceeded` (les deux routes de tableaux comptent désormais aussi les données du compte).
- Export `/api/me/export` : clé `data` (même forme que `GET /api/me/data`.data, vide si rien n'est rangé).

## 3. Tests exigés

Serveur : demande de réinitialisation identique avec ou sans compte (statut, corps), envoi seulement si compte (faux expéditeur injecté), jeton haché, usage unique, expiration, invalidation des précédents, toutes les sessions supprimées après confirmation, débits ; `/api/me/data` (valeur par défaut, PUT, 409, validation de chaque clé, plafonds, quota, export, cascade), migration 4 → 5.

E2E : parcours complet mot de passe oublié avec un faux envoi (le serveur de tests capture l'e-mail et le lien), page `reinitialiser.html` (axe, clavier, 320 px, jeton effacé de l'URL) ; données de compte : deux appareils (deux contextes) voient les mêmes espaces/favoris/modèles, rien ne reste dans `localStorage` après déconnexion, migration depuis l'ancien stockage local, conflit entre deux onglets sans perte.
