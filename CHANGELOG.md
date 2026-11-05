# Journal des modifications

Ce journal suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [1.6.2] - 2026-11-05

### Accessibilité
- Annonces disponibles dans les dialogues modaux et compteur de résultats stable dans la boutique.
- Focus conservé après le choix d’une catégorie sur mobile et aide ouverte sur son titre.
- Déplacement des cartes Kanban par boutons, désactivés aux limites.
- Noms accessibles alignés sur les textes visibles et sélection simple exposée sur le canevas.
- Raccourcis sans débordement à 320 px, placeholders contrastés et cibles de tri d’au moins 24 px.
- Contenu textuel du cadre disponible pendant la présentation.

## [1.6.1] - 2026-11-05

### Sécurité
- Les identifiants et valeurs d'un tableau importé sont validés au chargement (injection HTML possible par un JSON piégé).
- Le panneau des commentaires ne construit plus ses éléments avec des identifiants injectés dans du HTML.
- Les formules sont neutralisées dans l'export CSV.

### Corrigé
- Quitter un tableau conserve le texte en cours de saisie.
- Un objet déposé dans des cadres imbriqués rejoint le cadre du dessus, quel que soit l'ordre de présentation.
- Le zoom est restauré correctement après une présentation en plein écran.
- La mini-carte englobe aussi les lignes libres.
- La copie d'une ligne seule annonce le bon nombre d'éléments.
- La tuile « Vierge » crée directement un tableau vierge, comme dans Miro.

## [1.6.0] - 2026-11-05

### Ajouté
- Panneau Cadres : liste numérotée, nombre d’éléments, ajustement de la vue, renommage et ordre persistant (`frameOrder`, facultatif), boutons et Alt+flèches.
- Mode Présenter : plein écran ou repli plein fenêtre, navigation clavier, compteur annoncé et sortie par Échap ; vue entière sans cadre.
- Mini-carte interactive (M), synchronisée avec les objets et la vue.
- Recherche locale (Ctrl+F dans le tableau), résultats surlignés, compteur et navigation par Entrée / Maj+Entrée.
- Déplacement de la vue avec les flèches sur le canevas sans sélection ; Maj augmente le pas.
- Lignes comme dans Miro : ligne libre (L ou outil Ligne, glisser ou clic), extrémités libres ou accrochées (`startId`/`endId`, `start`/`end`), cercles d’extrémité déplaçables avec mise en évidence de l’objet survolé, points de pliage (`waypoints`), déplacement à la souris et aux flèches (une ligne attachée se détache), Alt+flèches sur l’extrémité active.
- Barre d’une ligne : Début de ligne, Inverser les extrémités, Fin de ligne (`startCap`, `endCap`), Type (`lineType` : droit, angles droits, courbe), Trait (`lineStyle`), Épaisseur, Couleur, Texte sur place, Verrouiller, Plus.
- Dialogue de ligne : Source et Cible en « Point libre » avec X/Y, points de pliage modifiables.
- Glisser-déposer depuis les pastilles de post-it, les formes, les boutons d’outil et le panneau Plus d’outils : fantôme, seuil de 5 px, annulation par Échap ou hors du canevas, annonce, tactile. Palette des formes (rectangle, cercle, losange, triangle).
- Sélecteur « Apparence » (menu à `menuitemradio`, aperçu et coche) et menu « Préférences » : grille, réduction des animations, raccourcis à une lettre désactivables (WCAG 2.1.4), couleur de fond stockée dans le tableau.
- Boutique de modèles : grande fenêtre, navigation par cas d’usage et types, recherche, case « Afficher à la création d’un tableau », sous-filtres, tri, cartes avec aperçu fidèle, vue Aperçu, Communauté sans contenu inventé, 56 modèles remplis.
- « Actions du tableau » replie les outils secondaires sur petit écran.
- Aide, documentation et tests de lignes, glisser-déposer, thèmes, préférences, boutique et 320 px.

### Modifié
- L ouvre l’outil Ligne ; le dialogue reste accessible par le bouton « Lien… ». Entrée sur une ligne édite son texte ; le dialogue passe par Plus.
- Supprimer un objet garde la ligne liée en point libre, sauf si ses deux objets disparaissent.
- Anciens `lineType` `line` et `arrow` lus et convertis au chargement.
- Thème sombre : violet DWES `#6c4bff` avec texte blanc ; contrastes AA sur les bordures, liens et boutons de danger de tous les thèmes.

### Supprimé
- Bouton qui faisait défiler les thèmes.

## [1.5.0] - 2026-11-04

### Ajouté
- Dashboard « Bon retour », navigation latérale repliable et menu mobile.
- Espaces locaux : création, renommage, suppression confirmée conservant les tableaux, déplacement et route `#/espace/<id>`.
- Emoji par tableau et renommage depuis l’en-tête avec Entrée / Échap et annonce.
- Bibliothèque de 20 modèles avec catégories, recherche, descriptions et aperçus SVG locaux ; conservation des cinq identifiants historiques.
- Enregistrement et suppression de modèles personnels sur l’appareil.
- Menu Exporter accessible au clavier : JSON, Markdown, CSV, SVG aux couleurs calculées et PNG à l’échelle 2.
- 20 tests couvrant le dashboard, les espaces, les modèles, les exports et le menu mobile à 320 px.

### Modifié
- Stockage version 3 avec migration additive des espaces et emoji ; tableaux et réglages conservés.
- Documentation des fonctionnalités, routes, modèles et clés de stockage.

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

### Corrigé
- Un objet créé au centre de la vue (panneau « Plus d'outils », clavier) se place à côté des objets existants au lieu de les recouvrir, et la vue le montre.
- La racine vide d'une carte mentale affiche le texte indicatif « Idée centrale ».

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
