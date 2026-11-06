# Observations de Miro (2026-11-04)

Relevé en lecture seule d'un board et du dashboard d'un compte gratuit, via Chrome. Aucun objet créé ni modifié.

## Rendu

- Les objets du board sont dessinés dans un seul `<canvas id="main-canvas">` WebGL2, sans label ni rôle ARIA. Le contenu n'existe pas dans le DOM.
- Autres canvas : couche des curseurs (`active_users_layer`, 2D), canvas WebGL2 temporaire de 4096×4096 (`surface-engine-tmp-canvas`), pool de canvas 256×256.
- L'interface autour du canevas est du vrai HTML : 50 boutons nommés, rôles `toolbar`, `tree`, `status`, zones `aria-live`.
- Dashboard : aucun landmark (`main`, `nav`, `header`), pas de lien d'évitement, titres h1 et h2 corrects, tableau des récents (`role=table`) avec colonnes Nom, Utilisateurs en ligne, Espace, Dernière ouverture, Propriétaire.

## Interface

Quatre barres d'outils flottantes (`role=toolbar`), blanches, rayon 16 px, ombre `0 2px 4px rgba(34,36,40,.08)`, padding 4 px, boutons de 40 px.

| Barre | Position | Contenu |
|---|---|---|
| Board | haut gauche | Ouvrir la barre latérale, Accueil, emoji, nom du board, menu, export, plan |
| People | haut droite | Facilitation, mises à jour, Talktrack/appel, utilisateur, Présenter, Partager |
| Creation | gauche, verticale | Sélection, Formats et flux, Modèles, Post-it, Texte, Formes et lignes, Stylo, Cadre, Stickers/Emoji/GIF, Outils et intégrations, Annuler, Rétablir |
| Controls | bas droite | Cadres, Zoom arrière, Zoom et navigation (pourcentage), Zoom avant, Aide |

Police : Noto Sans 14 px (corps), Roobert et Apris pour les titres. Fond du board : gris clair.

## Jetons de couleur (thème clair)

| Jeton | Valeur |
|---|---|
| bleu primaire | `#3859ff` (survol `#314cd9`, pressé `#2a41b6`) |
| bleu clair (survol secondaire) | `#e8ecfc` |
| danger | `#d8182c` |
| texte par défaut | `#191812` |
| texte secondaire | `#42413a` |
| bordure par défaut | `#e7e7e5` |
| fond neutre survol / pressé | `#f4f4f1` / `#eeeeeb` |
| surface | `#ffffff` |

## Post-its : 16 couleurs

Les boutons sont nommés `place <couleur> sticky note, N of 16`.

1 jaune clair `#fff79e`, 2 jaune `#ffe86d`, 3 orange `#ffb575`, 4 rouge `#ff9e9e`, 5 rose clair `#ffd2f2`, 6 rose `#fd9ae7`, 7 bleu clair `#b2d0fe`, 8 violet `#b8acfb`, 9 bleu `#9ce6ff`, 10 bleu foncé `#86b4f9`, 11 cyan `#81e7de`, 12 vert foncé `#6ae08d`, 13 vert clair `#d1f09f`, 14 vert `#b3e65f`, 15 gris `#f3f5f7`, 16 noir `#151515`.

## Formes et lignes

- Formes rapides : rectangle, cercle, losange (`rhombus`), triangle.
- Lignes : ligne, flèche, flèche à angles droits (`arrow square`), flèche dessinée à la main (`arrow sketch`).

## Raccourcis clavier

- Outils : `V`/`H` sélection ou main, `T` texte, `N` post-it, `S` formes, `R` rectangle, `O` ovale, `L` connecteur, `P` stylo, `E` gomme, `C` commentaire, `F` cadres, `M` mini-carte, touches `1` à `9` pour la barre personnalisable.
- Édition : `Ctrl+Z` annuler, `Ctrl+Maj+Z` rétablir, `Ctrl+C/V/X`, `Ctrl+D` ou `Alt+glisser` dupliquer, `Ctrl+A` tout sélectionner, `Entrée` éditer, `Échap` désélectionner, `Retour arrière` supprimer.
- Organisation : `Ctrl+G` grouper, `Ctrl+Maj+G` dégrouper, `Ctrl+Maj+L` verrouiller, `PgUp`/`PgDn` premier plan et arrière-plan, `Ctrl+Alt+Maj+plus/moins` taille de l'objet.
- Sélection : `Maj+glisser` ou `Ctrl+clic` sélection multiple, `Ctrl+Alt+Maj+flèches` objet le plus proche dans une direction, `Ctrl+Maj+flèche bas/haut` entrer dans un conteneur ou en sortir.
- Texte : `Ctrl+B`, `Ctrl+I`, `Ctrl+U`.

## Ce que l'appli accessible reprend ou corrige

- Reprendre : les 16 couleurs, les raccourcis à une lettre, la sélection du plus proche objet par flèches, entrer dans un cadre et en sortir, le verrouillage, le regroupement.
- Corriger : donner un équivalent texte à chaque objet (vues Plan et Tableau), des landmarks, un lien d'évitement, une annonce vocale de chaque action.

## Tests en conditions réelles (tableau « Untitled » créé pour l'occasion)

- `N` ouvre un panneau de 16 couleurs (2 colonnes) et un bouton « Stack » ; un clic sur le canevas pose le post-it à cet endroit et le sélectionne.
- Double-clic : édition du texte **sur place**. Taille de police « Auto » : le texte grossit pour remplir le post-it.
- `Ctrl+D` : la copie est posée juste à droite de l'original, avec un petit écart, et devient la sélection.
- Sélection : 4 poignées d'angle (redimensionnement) et 4 points bleus au milieu des côtés (tirer un lien depuis un point vers un autre objet).
- Barre contextuelle au-dessus de la sélection (post-it) : changer de type, police, taille (Auto, +, -), gras, alignement, lien, taille du post-it (S/M/L), couleur, afficher l'auteur, étiquettes, réaction emoji, commentaire, verrouiller, menu « Plus ».
- Menu « Plus » : copier, copier le lien, copier en image, dupliquer, supprimer, commenter, copier/coller le style (`Ctrl+Alt+C` / `Ctrl+Alt+V`), effacer le contenu (`Ctrl+Retour arrière`), organiser (ordre), lier à un objet (`Ctrl+Alt+K`), verrouiller, créer un cadre autour, enregistrer comme modèle, exporter en CSV, infos.
- Cadres : formats personnalisé, A4, Lettre, Mobile, Tablette, Ordinateur.
- Formes rapides : rectangle, cercle, losange, triangle, plus une bibliothèque « More shapes ».

## Panneau « Outils, médias et intégrations »

- Formats : Prototype, Diagramme (Mermaid), Tableau, Frise chronologique, Kanban, Matrice, Parcours utilisateur, Doc, Diapositives, Activités interactives, Talktrack (vidéo).
- Essentiels : stylo, post-it, carte (tâche assignable), bloc de code, carte recto-verso, cadre, grille, carte mentale, note, personnes, pile de post-its, modèles, texte, carte utilisateur.
- Diagrammes : formes de diagramme, Draw.io, calques, organigramme.
- Planification : colonnes, dépendances, estimation, story points, tailles de t-shirt, user story map.
- Activités : code pour rejoindre, choix multiple, question ouverte, échelle, classement, nuage de mots, matrice 2×2.

## Bibliothèque de modèles

Catégories : Réunions et ateliers, Idéation et brainstorming, Recherche et design, Agile, Stratégie et planification, Diagrammes et cartographie, Présentations, Wireframes et prototypes, Formats, Modèles avec IA, Modèles de l'équipe, Miroverse (communauté).

## Lignes (testé en vrai)

- `L` puis glisser dans le vide : la ligne est **libre**, elle n'est liée à aucun objet. Chaque extrémité est un cercle déplaçable, qui s'accroche à un objet si on la dépose dessus.
- Un point au milieu de chaque segment : le tirer ajoute un point de pliage, et de nouveaux points apparaissent sur les deux segments créés.
- Barre contextuelle d'une ligne : début de ligne, inverser les extrémités, fin de ligne, type, couleur, insérer une forme sur la ligne, texte, verrouiller, plus.
- Extrémités : aucune, flèche arrondie, flèche en arc, flèche ouverte, flèche pleine, et d'autres dans « Plus ».
- Type : droit, à angles droits, courbe (Bézier). Trait : plein, tirets, pointillés. Option « sauts de ligne » aux croisements.
- Insérer sur une ligne : carte, texte, post-it carré ou large, rectangle, rectangle arrondi, cercle, triangle, losange, bulle, parallélogramme, étoile.

### Ligne tirée d'un objet, relâchée dans le vide (non observé dans Miro)

Ce geste n'a pas pu être reproduit par automatisation dans Miro : il n'est donc pas observé. Le comportement de Baro vient de la consigne de Wesley : une ligne n'est pas obligée de finir sur une autre forme. Relâcher dans le vide crée une ligne dont le début reste accroché à l'objet de départ et dont la fin est un point libre.

## Glisser-déposer

- Depuis la palette du post-it : saisir une pastille et la déposer sur le canevas pose le post-it à cet endroit, dans cette couleur, et ouvre l'édition.
- Le lecteur d'écran reçoit l'annonce « Created: red sticky note. Editing ».

## Boutique de modèles

- Fenêtre pleine avec, à gauche : Tous les modèles, Miroverse (communauté), modèles de l'équipe ; « Cas d'usage » : Réunions et ateliers, Idéation et brainstorming, Recherche et design, Agile, Stratégie et planification, Diagrammes et cartographie, Présentations, Wireframes et prototypes, Création d'images ; « Types » : Blueprints, Formats.
- En haut : recherche « par nom, catégorie ou entreprise » et case « Afficher à la création d'un tableau ». Une catégorie a des sous-filtres en pastilles et un tri (« Sort by Recommended »).
- Cartes : aperçu, auteur, titre. Au survol : « Use template » et « Preview », avec une courte description.
- Exemples : Project Review, Weekly OKR Meeting, Check-in Icebreaker, Impact/Effort Matrix, 4 L's Retrospective, Start Stop Continue, Rose Bud Thorn, Crazy Eights, Presentation, Product Brief Brainstorm, Requirements Gathering, Reverse Brainstorming, Idea Multiplier, Brainwriting, Mind Map, Product Backlog, Affinity Diagram, PI Planning, Sprint Planning, Daily Standup, Kanban Framework, Roadmap Planning, Value Stream Mapping, Timeline Builder, Flowchart, Research Insight Synthesis, Customer Journey Mapping, Design Critique, User Persona.

## Menu principal

- Tableau : nouveau, dupliquer, exporter, déplacer, favori, supprimer, **couleur de fond**, vue de départ, historique, détails.
- Affichage : **grille**, curseurs des collaborateurs, commentaires, barres de défilement, dimensions des objets, boutons annuler/rétablir, plein écran.
- Préférences : souris ou pavé tactile, alignement des objets, profil.
- Accessibilité : sélection précise, **réduire les animations**, **raccourcis à un seul caractère** (désactivables), vérificateur d'accessibilité.

## Clic droit et souris (testé en vrai)

- Réglage « Souris ou pavé tactile » (s'applique à tous les onglets) : Souris, Pavé tactile, Détection automatique.
  - Souris : **clic droit maintenu puis glisser pour déplacer la vue**, molette pour zoomer.
  - Pavé tactile : glisser à deux doigts pour déplacer, pincer pour zoomer.
- Un clic droit sans glisser ouvre un menu contextuel, à l'endroit du pointeur.
- Sur le fond : Coller (`Ctrl+V`), Tout déverrouiller, Ajouter un texte, Ajouter un post-it, Ajouter un commentaire, Discussion au curseur (`/`), Définir la vue de départ, Afficher la grille (`G`), Afficher les commentaires (`Maj+C`), Aligner sur la grille, Aligner sur les objets, Afficher la taille des objets, Suggérer la taille, Souris ou pavé tactile, Tout afficher (`Alt+1`).
- Sur un post-it : Copier, Copier le lien, Copier en image, Dupliquer, Supprimer, Commenter, Copier le style, Coller le style, Effacer le contenu (`Ctrl+Retour arrière`), Organiser, Lier à (`Ctrl+Alt+K`), Verrouiller, Créer un cadre, Enregistrer comme modèle, Exporter en CSV, Infos.
- Sur une ligne : le même menu, sans Commenter, Effacer le contenu ni Exporter en CSV.
