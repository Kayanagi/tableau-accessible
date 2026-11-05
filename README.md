# Tableau blanc accessible

Application statique de tableau blanc, accessible (WCAG 2.2 AA), multi-tableaux. Sans dépendance externe, sans CDN, sans build.

## Fonctionnalités

- **Dashboard** : page d'accueil avec navigation (Accueil, Favoris, Parcourir), modèles de création, liste/grille des tableaux, recherche, tri, actions (ouvrir, renommer, dupliquer, favori, supprimer avec confirmation).
- **Multi-tableaux** : chaque tableau a son propre espace dans le localStorage. Migration automatique depuis l'ancien format mono-tableau.
- **Modèles** : boutique de 56 modèles intégrés, cas d’usage, sous-filtres, tri, recherche, aperçu SVG généré localement ; modèles personnels enregistrés sur cet appareil et supprimables.
- **Trois vues synchronisées** par tableau : Canevas (SVG interactif), Plan (arborescence), Tableau (table triable).
- **Import/export** : JSON (depuis le dashboard ou le tableau), menu Exporter dans le tableau : JSON, Markdown, CSV des éléments, SVG et PNG du canevas entier (échelle 2). Les couleurs calculées du thème sont intégrées au SVG.
- **Accessibilité** : landmarks, lien d'évitement, annonces aria-live, focus visible, cibles ≥ 24 px, contraste AA, thème clair/sombre/contraste élevé, `prefers-reduced-motion`, responsive ≥ 320 px.

Les raccourcis de création et d’organisation s’appliquent au Canevas, hors champs et dialogues. Les flèches permettent de parcourir les boutons des barres d’outils avec un seul arrêt de tabulation par barre.

- 16 couleurs Miro identiques dans tous les thèmes, avec nom français et migration des anciennes couleurs.
- Lignes libres ou attachées, points de pliage, types droit, angles droits et courbe (voir 1.6.0).
- Verrouillage : déplacement, édition et suppression bloqués ; duplication, verrouillage et ordre annulables.
- Barres de création et de zoom flottantes, adaptées aux petits écrans.
- Thème DWES violet ; application disponible sur https://baro.dwes.fr.

### Dashboard et modèles (1.5.0)

La barre latérale regroupe Accueil (« Bon retour », modèles et tableaux récents), Favoris, Parcourir et Espaces. Le bouton « Menu de navigation » la replie ; elle est fermée initialement sur mobile. Les espaces sont des dossiers locaux : création, renommage, suppression confirmée sans supprimer les tableaux, déplacement depuis une ligne ou une carte.

Chaque tableau peut recevoir un emoji parmi six choix. Son titre dans l’en-tête est éditable au clic ou avec Entrée : Entrée valide, Échap annule. « Enregistrer comme modèle » conserve une copie dans « Mes modèles » de la bibliothèque ouverte par « Tous les modèles ».

Modèles intégrés : Vierge, Organigramme / flux, Rétrospective 4 L, Feuille de route, Liste de tâches, Brainstorming, Rétro Start/Stop/Continue, Daily stand-up, Kanban de projet, Diagramme de flux, Carte mentale, Matrice d’Eisenhower, SWOT, Persona, Parcours utilisateur, Lean canvas, User story map, Matrice effort/impact, Ordre du jour de réunion, Revue de sprint.

Catégories : Réunions et ateliers, Idéation et brainstorming, Recherche et design, Agile, Stratégie et planification, Diagrammes et cartographie, Mes modèles. Les cinq identifiants historiques restent compatibles. Les données supplémentaires sont dans `js/store/template-library.js`.

Le stockage `tableau-accessible-boards` passe en version 3 : collection `espaces` (id, nom), champs facultatifs `espaceId` (null) et `emoji` (📋) par tableau. Les tableaux et réglages antérieurs sont conservés. Les modèles personnels utilisent `tableau-accessible-templates`.

### Manipulation directe (1.3.0)

- **Outils** Sélection (V) et Main (H) ; outils de création post-it (N, avec panneau de 16 couleurs), texte (T), forme (S, R, O), carte et cadre (F) : un clic sur le canevas pose l’élément sous le pointeur, le sélectionne et ouvre l’édition du texte. Échap annule l’outil.
- **Voie 100 % clavier** : Entrée sur un bouton d’outil, ou Entrée après la touche de l’outil, crée l’élément au centre de la vue.
- **Édition sur place** au double-clic ou à Entrée, dans une zone de texte superposée à l’objet (suit le zoom et le déplacement de la vue) ; Échap, Ctrl+Entrée ou un clic à l’extérieur valide, en une seule entrée d’historique. Taille de police « Auto » pour les post-its.
- **Poignées** d’angle pour redimensionner (Maj garde les proportions) et **points bleus** pour tirer une flèche vers un autre objet. Équivalents clavier : Ctrl+Alt+Maj+plus/moins, et L pour le dialogue de lien.
- **Sélection multiple** : rectangle de sélection sur le fond, Maj+clic ou Ctrl+clic, Ctrl+A ; cases à cocher dans le Plan (avec `aria-selected`) et le Tableau. Déplacer, supprimer, dupliquer, verrouiller, changer la couleur s’appliquent à toute la sélection en une entrée d’historique.
- **Presse-papiers** : Ctrl+C / X / V (interne, plus le presse-papiers système en JSON si disponible), collage décalé de 20 px avec les liens internes conservés ; Ctrl+Alt+C / V pour le style ; Ctrl+Retour arrière pour effacer le contenu.
- **Barre contextuelle** flottante au-dessus de la sélection (en bas de l’écran sur mobile), atteignable par Alt+F10 : couleur, taille du texte (Auto, +, −), gras, alignement, taille du post-it (P/M/G), type de forme, type de ligne, verrouiller, dupliquer, supprimer, Propriétés… (dialogue complet) et menu Plus (copier, coller, style, premier plan, arrière-plan, créer un cadre autour).

### Nouveaux objets (1.4.0)

- **Plus d’outils** : bouton « Plus… » de la barre de création, panneau classé par catégories (Dessin, Essentiels, Formats) avec recherche, navigable aux flèches ; Entrée crée l’outil au centre de la vue, Échap referme.
- **Stylo (P) et gomme (E)** : tracé à main levée lissé, stocké en polyline compacte ; couleur et épaisseur dans la palette du stylo et la barre contextuelle. Un tracé est un objet (« Dessin à main levée » + étiquette facultative) : Tab le sélectionne, les flèches le déplacent, Entrée modifie l’étiquette, Suppr le supprime.
- **Groupes** : Ctrl+G / Ctrl+Maj+G ; un clic sélectionne le groupe, double-clic ou Ctrl+Maj+flèche bas entre dedans ; nœud parent dans le Plan.
- **Commentaires (C)** : pastille sur un objet ou le canevas, fil de messages (auteur saisi une fois et mémorisé sur l’appareil, date), résolu / non résolu ; panneau latéral (Maj+C) avec « Aller à l’élément ».
- **Étiquettes** sur post-its et cartes : liste propre au tableau, couleur, ajout et retrait depuis la barre contextuelle, filtre dans la vue Tableau.
- **Réactions** : 6 emoji, compteur visible et lu dans le nom accessible.
- **Carte mentale** : racine et nœuds, Tab enfant, Entrée frère, disposition horizontale automatique avec liens courbes, plier / déplier, flèches dans l’arbre, arbre imbriqué dans le Plan.
- **Kanban** : colonnes À faire / En cours / Fait renommables, ajout et suppression ; cartes déplacées à la souris ou au clavier (Ctrl+flèches) avec annonce de la colonne et de la position.
- **Tableau de données** : grille éditable (rôles `grid`, `gridcell`), flèches entre cellules, Entrée pour éditer, lignes et colonnes ajoutées ou supprimées ; rendu en vraie table HTML dans la vue Tableau.
- **Bloc de code** : texte à chasse fixe, langage au choix, coloration simple sans dépendance, bouton « Copier le code ».
- **Carte recto-verso** : bouton « Retourner » (`aria-pressed`) ou Espace, annonce de la face visible, animation coupée si `prefers-reduced-motion`.
- Tous ces types sont présents dans le Plan, le Tableau, l’export Markdown, le copier-coller (arbres et groupes recréés) et l’historique. Les anciens tableaux restent valides.

## Lancement

```
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

## Routes (hash)

| Route | Vue |
|-------|-----|
| `#/` | Accueil (dashboard) |
| `#/favoris` | Tableaux favoris |
| `#/parcourir` | Tous les tableaux |
| `#/espace/<id>` | Tableaux d’un espace local |
| `#/tableau/<id>` | Tableau individuel |

## Raccourcis clavier (vue tableau)

| Raccourci | Action |
|-----------|--------|
| V / H | Outil Sélection / outil Main |
| N / T / S / R / O / F | Outil post-it / texte / forme / rectangle / cercle / cadre (clic pour poser) |
| Entrée (outil actif ou bouton d’outil) | Créer au centre de la vue |
| L | Outil Ligne (glisser : ligne libre ; clic : longueur par défaut) |
| Alt+flèches (ligne sélectionnée) | Déplacer l’extrémité active |
| Entrée / double-clic | Modifier le texte sur place |
| Échap | Valider le texte, annuler l’outil ou désélectionner |
| Alt+F10 | Aller à la barre contextuelle |
| Ctrl+A | Tout sélectionner |
| Maj+clic / Ctrl+clic | Ajouter ou retirer de la sélection |
| Ctrl+C / Ctrl+X / Ctrl+V | Copier / couper / coller |
| Ctrl+Alt+C / Ctrl+Alt+V | Copier / coller le style |
| Ctrl+Retour arrière | Effacer le contenu |
| Ctrl+D | Dupliquer la sélection |
| Ctrl+Maj+L | Verrouiller / déverrouiller |
| Ctrl+Alt+Maj+plus / moins | Agrandir / réduire |
| Page précédente / Page suivante | Premier plan / arrière-plan |
| Ctrl+Alt+Maj+flèches | Objet le plus proche dans la direction |
| Ctrl+Maj+flèche bas / haut | Entrer dans un cadre / sortir vers son parent |
| ? | Ouvrir l'aide |
| Ctrl+Z | Annuler |
| Ctrl+Maj+Z | Rétablir |
| +/- | Zoom avant/arrière |
| 0 | Réinitialiser le zoom |
| Maj+1 | Tout afficher (ajuster la vue au contenu) |
| Glisser le fond (outil Main ou Espace maintenu) / molette | Déplacer la vue |
| Glisser le fond (outil Sélection) | Rectangle de sélection |
| Ctrl+molette | Zoomer sur le pointeur |
| Tab / Maj+Tab | Naviguer entre les éléments |
| Flèches | Déplacer la sélection (10 px) |
| Maj+Flèches | Déplacer en grand pas (50 px) |
| Suppr | Supprimer la sélection |
| P / E | Stylo / gomme (au pointeur) |
| C | Commentaire sur la sélection (Entrée) ou au clic |
| Maj+C | Afficher / masquer le panneau des commentaires |
| Ctrl+G / Ctrl+Maj+G | Grouper / dégrouper |
| F2 | Modifier le texte de l’élément |
| Espace (carte recto-verso) | Retourner la carte |
| Carte mentale : flèches, Tab, Entrée | Parcourir (gauche replie, droite déplie) ; après une saisie ou un clic, Tab ajoute un enfant, Entrée un frère ; Échap rend Tab à la navigation |
| Kanban : Entrée, flèches, Ctrl+flèches, Insertion | Entrer, parcourir, déplacer la carte (gauche/droite : colonne, haut/bas : ordre), ajouter une carte |
| Tableau de données : Entrée, flèches, Suppr | Entrer, parcourir les cellules, éditer, effacer |

## Modèle de données

### Multi-tableaux (localStorage `tableau-accessible-boards`)

```json
{
  "version": 3,
  "tableaux": [
    {
      "id": "board-1234-abc",
      "nom": "Mon tableau",
      "créé": "2026-01-01T00:00:00.000Z",
      "dernièreOuverture": "2026-01-01T12:00:00.000Z",
      "favori": false,
      "données": {
        "name": "Mon tableau",
        "items": [ ... ]
      }
    }
  ]
}
```

### Tableau individuel (champ `données`)

```json
{
  "name": "Mon tableau",
  "items": [
    { "id": "item-1", "type": "sticky_note", "x": 100, "y": 100, "width": 150, "height": 150, "content": "Idée", "color": "light_yellow", "size": "m", "fontSize": "auto", "bold": false, "align": "center" },
    { "id": "item-2", "type": "shape", "x": 300, "y": 200, "width": 120, "height": 80, "shape": "rectangle", "content": "Étape" },
    { "id": "item-3", "type": "text", "x": 500, "y": 100, "width": 200, "height": 30, "content": "Note" },
    { "id": "item-4", "type": "card", "x": 100, "y": 400, "width": 200, "height": 120, "title": "Titre", "content": "Description" },
    { "id": "item-5", "type": "frame", "x": 50, "y": 50, "width": 600, "height": 500, "content": "Groupe" },
    { "id": "item-6", "type": "connector", "startId": "item-1", "end": { "x": 900, "y": 400 }, "lineType": "straight", "startCap": "none", "endCap": "arrow_filled", "lineStyle": "solid", "strokeWidth": 2, "stroke": "auto", "waypoints": [], "label": "relié" }
  ]
}
```

Types : `sticky_note`, `shape`, `text`, `card`, `frame`, `connector`, `drawing` (`points` relatifs, `vw`/`vh`, `stroke`, `strokeWidth`), `comment` (`targetId`, `messages`, `resolved`), `mindmap` (`parentNode`, `collapsed`), `kanban` (`columns[].cards[]`), `datatable` (`rows`, première ligne = en-têtes), `code` (`language`), `flipcard` (`back`, `flipped`).

Propriétés communes facultatives : `groupId`, `tags` (identifiants de `board.tags`, `{ id, name, color }`), `reactions` (`{ "👍": ["Auteur"] }`).

Mise en forme (hors liens) : `fontSize` (`"auto"` ou nombre de pixels), `bold`, `align` (`left`, `center`, `right`) ; post-its : `size` (`s`, `m`, `l`). Les anciens tableaux reçoivent des valeurs par défaut au chargement (post-it : Auto, centré ; forme : 14, centré ; texte : 16 ; carte : 13), sans perte de données.

## Accessibilité

- Landmarks : `<header>`, `<nav>`, `<main>` sur chaque vue.
- Lien d'évitement vers le contenu principal.
- Annonces `aria-live` pour les actions et changements de vue.
- `aria-sort` sur les colonnes triables.
- `aria-pressed` sur les boutons à bascule (favori, vue grille/liste).
- `<dialog>` de confirmation pour la suppression.
- `<time datetime>` pour les dates.
- Contraste WCAG AA, cibles tactiles ≥ 24 px.

## Limites

- Pas de collaboration en temps réel (l'état JSON est conçu pour être sérialisable).
- Pas de mise en forme riche du texte (italique, souligné).
- Le dessin à main levée se fait au pointeur uniquement (les tracés existants restent manipulables au clavier).
- Pas d’insertion de forme sur une ligne ni de sauts de ligne aux croisements.
- Communauté : publication prévue avec le serveur, seuls les modèles locaux partageables sont listés.
- Stockage local uniquement (localStorage).

## Tests

Les tests E2E utilisent Playwright (Chromium headless).

```bash
cd tests
npm install playwright
npx playwright install chromium
node e2e.mjs   # sert le dossier parent du script sur le port 8765 (PORT=… pour en changer)
```

### Présentation et navigation (1.6.0)

« Cadres », dans les contrôles en bas à droite, ouvre un panneau non modal : choisir un cadre ajuste la vue, les boutons Monter / Descendre ou Alt+flèche haut/bas changent son ordre, Renommer change son nom. Le champ facultatif `frameOrder` conserve les identifiants dans l’ordre de présentation ; sans ce champ, l’ordre existant des cadres est conservé. Les nouveaux cadres rejoignent la fin de la liste. Échap ferme le panneau et rend le focus.

« Présenter » affiche un cadre à la fois, en plein écran si disponible, sinon en superposition plein fenêtre. Flèches gauche/droite, Espace, Page précédente/suivante et Début/Fin parcourent les cadres ; Échap ou Quitter termine la présentation. Sans cadre, la vue entière est présentée avec le message « Ajoutez des cadres pour présenter ». Aucune transition animée.

M ou « Mini-carte » affiche un aperçu simplifié, masqué initialement (y compris à 320 px). Cliquer ou glisser dessus déplace la vue ; le bouton indique son état. Sur le fond du canevas, sans sélection, les flèches déplacent la vue et Maj augmente le pas.

« Rechercher » ou Ctrl+F lorsque le focus est dans la vue tableau ouvre la recherche locale : textes, titres, étiquettes, tableaux, kanbans, cartes mentales et code. Les objets trouvés sont surlignés. Entrée / Maj+Entrée sélectionne le résultat suivant / précédent et l’amène à l’écran ; le compteur annonce sa position. Échap ferme et rend le focus.

### Lignes (1.6.0)

L ou le bouton Ligne, puis glisser dans le vide, crée une ligne libre ; un clic crée une longueur par défaut ; Entrée la crée au centre. Chaque extrémité est un objet (`startId`, `endId`) ou un point (`start`, `end` : `{ x, y }`). Sélectionnée, une ligne montre un cercle à chaque extrémité (accroché à l’objet survolé au dépôt, détaché hors de l’objet) et un point au milieu de chaque segment, qui ajoute un point de pliage (`waypoints`) ; un double-clic le supprime.

Voie clavier : flèches pour déplacer (une ligne attachée se détache), Alt+flèches pour l’extrémité active, Alt+F10 pour la barre, où Début de ligne ou Fin de ligne choisit cette extrémité ; Plus, « Extrémités et points de pliage… » ouvre le dialogue avec X/Y modifiables.

Champs : `startCap`, `endCap` (`none`, `arrow_open`, `arrow_filled`, `arrow_round`, `circle`, `diamond`), `lineType` (`straight`, `orthogonal`, `bezier` ; anciens `line` et `arrow` convertis au chargement), `lineStyle` (`solid`, `dashed`, `dotted`), `strokeWidth`, `stroke` (`auto`, `violet`, `red`, `blue`, `green`, `orange`, couleurs adaptées au thème), `label`.

### Glisser-déposer (1.6.0)

Saisir une pastille de post-it, une forme, un bouton d’outil ou une entrée du panneau Plus d’outils, puis déposer sur le canevas : l’élément est posé à cet endroit et l’édition s’ouvre. Seuil de 5 px ; Échap ou un relâchement hors du canevas annule. Un simple clic garde l’outil actif ; les voies clavier restent.

### Apparence et préférences (1.6.0)

« Thème : … » ouvre un menu Automatique, Clair, Sombre, Contraste élevé. « Préférences » (tableau de bord et tableau) contient aussi Afficher la grille, Réduire les animations et Raccourcis à une lettre. Stockage : `tableau-accessible-theme`, `tableau-accessible-prefs`. Le tableau ajoute la couleur de fond, stockée dans `background` ; le thème Contraste élevé l’ignore pour garantir le contraste.

### Boutique de modèles (1.6.0)

« Créer un tableau », le bouton + (Vierge) et « Tous les modèles » ouvrent la boutique si « Afficher à la création d’un tableau » est cochée (par défaut), sinon « Créer un tableau » et + ouvrent le dialogue simple. Colonne gauche : Tous les modèles, Communauté, Mes modèles, Cas d’usage, Types. Une catégorie propose des pastilles et un tri ; « Récents » classe d’abord les modèles utilisés sur cet appareil. Communauté n’affiche que des modèles locaux partageables. Données : `js/store/template-library.js`, aperçus : `js/views/template-preview.js`.
