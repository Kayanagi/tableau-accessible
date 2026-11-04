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
| N | Nouveau post-it |
| T / S / R / O / L / F | Texte / forme / rectangle / cercle / lien / cadre |
| Ctrl+D | Dupliquer l’élément |
| Ctrl+Maj+L | Verrouiller / déverrouiller |
| Page précédente / Page suivante | Premier plan / arrière-plan |
| Ctrl+Alt+Maj+flèches | Objet le plus proche dans la direction |
| Ctrl+Maj+flèche bas / haut | Entrer dans un cadre / sortir vers son parent |
| ? | Ouvrir l'aide |
| Ctrl+Z | Annuler |
| Ctrl+Maj+Z | Rétablir |
| +/- | Zoom avant/arrière |
| 0 | Réinitialiser le zoom |
| Maj+1 | Tout afficher (ajuster la vue au contenu) |
| Glisser le fond / molette | Déplacer la vue |
| Ctrl+molette | Zoomer sur le pointeur |
| Tab / Maj+Tab | Naviguer entre les éléments |
| Flèches | Déplacer l'élément (10 px) |
| Maj+Flèches | Déplacer en grand pas (50 px) |
| Entrée | Éditer l'élément |
| Suppr | Supprimer l'élément |

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
    { "id": "item-1", "type": "sticky_note", "x": 100, "y": 100, "width": 150, "height": 150, "content": "Idée", "color": "light_yellow" },
    { "id": "item-2", "type": "shape", "x": 300, "y": 200, "width": 120, "height": 80, "shape": "rectangle", "content": "Étape" },
    { "id": "item-3", "type": "text", "x": 500, "y": 100, "width": 200, "height": 30, "content": "Note" },
    { "id": "item-4", "type": "card", "x": 100, "y": 400, "width": 200, "height": 120, "title": "Titre", "content": "Description" },
    { "id": "item-5", "type": "frame", "x": 50, "y": 50, "width": 600, "height": 500, "content": "Groupe" },
    { "id": "item-6", "type": "connector", "startId": "item-1", "endId": "item-2", "label": "relié" }
  ]
}
```

Types : `sticky_note`, `shape`, `text`, `card`, `frame`, `connector`.

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
- Pas de redimensionnement à la souris.
- Pas de courbes de Bézier pour les connecteurs.
- Stockage local uniquement (localStorage).

## Tests

Les tests E2E utilisent Playwright (Chromium headless).

```bash
cd tests
npm install playwright
npx playwright install chromium
node e2e.mjs
```
