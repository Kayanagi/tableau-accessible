# Journal des modifications

Ce journal suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

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
