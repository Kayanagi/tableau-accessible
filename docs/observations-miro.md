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
