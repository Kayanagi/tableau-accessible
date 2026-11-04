# Tableau blanc accessible

Application statique de tableau blanc, accessible (WCAG 2.2 AA), multi-tableaux. Sans dépendance externe, sans CDN, sans build.

## Fonctionnalités

- **Dashboard** : page d'accueil avec navigation (Accueil, Favoris, Parcourir), modèles de création, liste/grille des tableaux, recherche, tri, actions (ouvrir, renommer, dupliquer, favori, supprimer avec confirmation).
- **Multi-tableaux** : chaque tableau a son propre espace dans le localStorage. Migration automatique depuis l'ancien format mono-tableau.
- **Modèles** : Vierge, Organigramme/flux, Rétrospective 4 L, Feuille de route, Liste de tâches.
- **Trois vues synchronisées** par tableau : Canevas (SVG interactif), Plan (arborescence), Tableau (table triable).
- **Import/export** : JSON (depuis le dashboard ou le tableau), Markdown (depuis le tableau).
- **Accessibilité** : landmarks, lien d'évitement, annonces aria-live, focus visible, cibles ≥ 24 px, contraste AA, thème clair/sombre/contraste élevé, `prefers-reduced-motion`, responsive ≥ 320 px.

Les raccourcis de création et d’organisation s’appliquent au Canevas, hors champs et dialogues. Les flèches permettent de parcourir les boutons des barres d’outils avec un seul arrêt de tabulation par barre.

- 16 couleurs Miro identiques dans tous les thèmes, avec nom français et migration des anciennes couleurs.
- Liens : ligne simple, flèche (par défaut), flèche à angles droits.
- Verrouillage : déplacement, édition et suppression bloqués ; duplication, verrouillage et ordre annulables.
- Barres de création et de zoom flottantes, adaptées aux petits écrans.
- Thème DWES violet ; application disponible sur https://baro.dwes.fr.

### Manipulation directe (1.3.0)

- **Outils** Sélection (V) et Main (H) ; outils de création post-it (N, avec panneau de 16 couleurs), texte (T), forme (S, R, O), carte et cadre (F) : un clic sur le canevas pose l’élément sous le pointeur, le sélectionne et ouvre l’édition du texte. Échap annule l’outil.
- **Voie 100 % clavier** : Entrée sur un bouton d’outil, ou Entrée après la touche de l’outil, crée l’élément au centre de la vue.
- **Édition sur place** au double-clic ou à Entrée, dans une zone de texte superposée à l’objet (suit le zoom et le déplacement de la vue) ; Échap, Ctrl+Entrée ou un clic à l’extérieur valide, en une seule entrée d’historique. Taille de police « Auto » pour les post-its.
- **Poignées** d’angle pour redimensionner (Maj garde les proportions) et **points bleus** pour tirer une flèche vers un autre objet. Équivalents clavier : Ctrl+Alt+Maj+plus/moins, et L pour le dialogue de lien.
- **Sélection multiple** : rectangle de sélection sur le fond, Maj+clic ou Ctrl+clic, Ctrl+A ; cases à cocher dans le Plan (avec `aria-selected`) et le Tableau. Déplacer, supprimer, dupliquer, verrouiller, changer la couleur s’appliquent à toute la sélection en une entrée d’historique.
- **Presse-papiers** : Ctrl+C / X / V (interne, plus le presse-papiers système en JSON si disponible), collage décalé de 20 px avec les liens internes conservés ; Ctrl+Alt+C / V pour le style ; Ctrl+Retour arrière pour effacer le contenu.
- **Barre contextuelle** flottante au-dessus de la sélection (en bas de l’écran sur mobile), atteignable par Alt+F10 : couleur, taille du texte (Auto, +, −), gras, alignement, taille du post-it (P/M/G), type de forme, type de ligne, verrouiller, dupliquer, supprimer, Propriétés… (dialogue complet) et menu Plus (copier, coller, style, premier plan, arrière-plan, créer un cadre autour).

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
| `#/tableau/<id>` | Tableau individuel |

## Raccourcis clavier (vue tableau)

| Raccourci | Action |
|-----------|--------|
| V / H | Outil Sélection / outil Main |
| N / T / S / R / O / F | Outil post-it / texte / forme / rectangle / cercle / cadre (clic pour poser) |
| Entrée (outil actif ou bouton d’outil) | Créer au centre de la vue |
| L | Nouveau lien (dialogue) |
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

## Modèle de données

### Multi-tableaux (localStorage `tableau-accessible-boards`)

```json
{
  "version": 2,
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
    { "id": "item-6", "type": "connector", "startId": "item-1", "endId": "item-2", "label": "relié" }
  ]
}
```

Types : `sticky_note`, `shape`, `text`, `card`, `frame`, `connector`.

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
- Pas de groupes (Ctrl+G) ni de mise en forme riche du texte (italique, souligné).
- Pas de courbes de Bézier pour les connecteurs.
- Stockage local uniquement (localStorage).

## Tests

Les tests E2E utilisent Playwright (Chromium headless).

```bash
cd tests
npm install playwright
npx playwright install chromium
node e2e.mjs   # sert le dossier parent du script sur le port 8765
```
