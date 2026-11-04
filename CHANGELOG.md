# Journal des modifications

Ce journal suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [1.4.0] - 2026-11-04

### Ajouté
- Bouton « Plus… » et panneau Plus d’outils : outils classés par catégories, recherche, navigation aux flèches, création au centre de la vue avec Entrée.
- Stylo (P) et gomme (E) : tracé à main levée lissé en polyline compacte, couleur et épaisseur ; le tracé est un objet sélectionnable, déplaçable, avec étiquette facultative.
- Groupes : Ctrl+G, Ctrl+Maj+G, clic sur le groupe entier, double-clic pour y entrer, nœud parent dans le Plan.
- Commentaires (C) : pastille sur un objet ou le canevas, fil de messages avec auteur mémorisé et date, résolu / non résolu, panneau latéral (Maj+C) avec navigation vers l’élément.
- Étiquettes colorées sur post-its et cartes, gérées depuis la barre contextuelle et filtrables dans la vue Tableau.
- Réactions emoji (6 au choix) avec compteur, lues dans le nom accessible.
- Carte mentale : Tab pour un enfant, Entrée pour un frère, disposition automatique et liens courbes, plier / déplier, flèches dans l’arbre, arbre imbriqué dans le Plan.
- Kanban : colonnes renommables, ajout et suppression, cartes déplacées à la souris ou au clavier (Ctrl+flèches) avec annonce de la colonne et de la position.
- Tableau de données : grille éditable au clavier, lignes et colonnes ajoutables, rendu en table HTML dans la vue Tableau.
- Bloc de code : langage, coloration simple, copie du code.
- Carte recto-verso : retournement par bouton ou Espace, annonce de la face visible, animation désactivée si mouvement réduit.
- Export Markdown des nouveaux types (arbre, colonnes, tableau, code, commentaires).
- 20 tests de bout en bout pour ces fonctions ; port des tests configurable (`PORT`).

### Modifié
- F2 modifie le texte de l’élément ; Maj+lettre n’active plus d’outil.
- Aide et README mis à jour.

## [1.3.1] - 2026-11-04

### Corrigé
- La barre de mise en forme restait collée au bord gauche du canevas au lieu de se placer au-dessus de la sélection.

## [1.3.0] - 2026-11-04

### Ajouté
- Outils Sélection (V) et Main (H) ; outils de création actifs (N, T, S, R, O, F, Carte) : un clic sur le canevas pose l’élément sous le pointeur, le sélectionne et ouvre l’édition du texte ; Échap annule l’outil.
- Panneau de 16 couleurs (2 colonnes, boutons radio nommés) à l’activation de l’outil post-it.
- Voie clavier : Entrée sur un bouton d’outil, ou après la touche de l’outil, crée l’élément au centre de la vue.
- Édition du texte sur place (double-clic ou Entrée) dans une zone superposée à l’objet, qui suit le zoom et la vue ; une seule entrée d’historique.
- Taille de police « Auto » pour les post-its : le texte grossit ou rétrécit pour tenir.
- Poignées d’angle pour redimensionner à la souris (Maj garde les proportions) et Ctrl+Alt+Maj+plus/moins au clavier.
- Points bleus au milieu des côtés : tirer vers un autre objet crée une flèche.
- Sélection multiple : rectangle de sélection, Maj+clic, Ctrl+clic, Ctrl+A, cases à cocher dans le Plan et le Tableau, annonce du nombre d’éléments sélectionnés.
- Presse-papiers : Ctrl+C / X / V avec liens internes conservés, Ctrl+Alt+C / V pour le style, Ctrl+Retour arrière pour effacer le contenu.
- Barre contextuelle de mise en forme (Alt+F10) : couleur, taille du texte, gras, alignement, taille du post-it, type de forme, type de ligne, verrouillage, duplication, suppression, Propriétés… et menu Plus (dont « Créer un cadre autour »).
- Propriétés `fontSize`, `bold`, `align` et `size`, avec valeurs par défaut pour les anciens tableaux.
- 19 tests de bout en bout pour ces fonctions.

### Modifié
- Les boutons et raccourcis de création activent un outil au lieu d’ouvrir un dialogue ; le dialogue complet reste accessible par « Propriétés… ».
- Glisser le fond trace un rectangle de sélection ; la vue se déplace avec l’outil Main, la barre d’espace maintenue, le bouton du milieu ou la molette.
- Déplacer, supprimer, dupliquer, verrouiller et l’ordre s’appliquent à toute la sélection, en une entrée d’historique.
- Le texte des objets est coupé selon sa largeur réelle et respecte l’alignement.
- Aide et README mis à jour.

### Corrigé
- Un déplacement à la souris est enregistré et propagé aux vues Plan et Tableau dès le relâchement.
- Enregistrer les propriétés d’un texte ne remet plus sa taille à 200 × 30.
- Les tests servent le dossier du dépôt courant au lieu d’un chemin fixe.

## [1.2.0] - 2026-11-04

### Ajouté
- Palette de 16 couleurs Miro, noms français et migration des anciens identifiants.
- Lignes simples, flèches et flèches à angles droits.
- Raccourcis de création, duplication, verrouillage, ordre et navigation spatiale ou dans les cadres.
- Indication du verrouillage dans les trois vues et protection des éléments.
- Barres flottantes accessibles de création et de zoom, navigation par flèches et adaptation à 320 px.
- Vue façon Miro : déplacement en glissant le fond ou à la molette, Ctrl + molette pour zoomer sur le pointeur, bouton « Tout afficher » (Maj+1), ajustement automatique au contenu à l'ouverture, grille infinie.
- Tests de ces fonctionnalités.

### Corrigé
- Les liens s'arrêtent au bord des rectangles, cercles et losanges au lieu de traverser le texte ; les liens à angles droits sortent par le côté adapté.
- Le zoom à 100 % correspond à la taille réelle (le texte était réduit à 16 % sur mobile).
- Le canevas tient dans la hauteur de l'écran.
- Les tests de navigation attendent le rendu de la route (échecs aléatoires).

## [1.1.0] - 2026-11-04

### Ajouté
- Thème DWES violet, clair et sombre.
- Mise en ligne sur https://baro.dwes.fr.

## [1.0.0] - 2026-11-04

### Ajouté
- Version initiale du tableau blanc accessible : canevas SVG, Plan, Tableau, historique, import JSON et exports JSON/Markdown.
- Dashboard multi-tableaux avec modèles, recherche, tri, favoris et gestion locale des tableaux.
