# Tableau blanc accessible

Application statique de tableau blanc, accessible (WCAG 2.2 AA), multi-tableaux. Sans d&eacute;pendance externe, sans CDN, sans build.

## Fonctionnalit&eacute;s

- **Dashboard** : page d'accueil avec navigation (Accueil, Favoris, Parcourir), mod&egrave;les de cr&eacute;ation, liste/grille des tableaux, recherche, tri, actions (ouvrir, renommer, dupliquer, favori, supprimer avec confirmation).
- **Multi-tableaux** : chaque tableau a son propre espace dans le localStorage. Migration automatique depuis l'ancien format mono-tableau.
- **Mod&egrave;les** : Vierge, Organigramme/flux, R&eacute;trospective 4 L, Feuille de route, Liste de t&acirc;ches.
- **Trois vues synchronis&eacute;es** par tableau : Canevas (SVG interactif), Plan (arborescence), Tableau (table triable).
- **Import/export** : JSON (depuis le dashboard ou le tableau), Markdown (depuis le tableau).
- **Accessibilit&eacute;** : landmarks, lien d'&eacute;vitement, annonces aria-live, focus visible, cibles &ge; 24 px, contraste AA, th&egrave;me clair/sombre/contraste &eacute;lev&eacute;, `prefers-reduced-motion`, responsive &ge; 320 px.

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
| ? | Ouvrir l'aide |
| Ctrl+Z | Annuler |
| Ctrl+Maj+Z | R&eacute;tablir |
| +/- | Zoom avant/arri&egrave;re |
| 0 | R&eacute;initialiser le zoom |
| Tab / Maj+Tab | Naviguer entre les &eacute;l&eacute;ments |
| Fl&egrave;ches | D&eacute;placer l'&eacute;l&eacute;ment (10 px) |
| Maj+Fl&egrave;ches | D&eacute;placer en grand pas (50 px) |
| Entr&eacute;e | &Eacute;diter l'&eacute;l&eacute;ment |
| Suppr | Supprimer l'&eacute;l&eacute;ment |

## Mod&egrave;le de donn&eacute;es

### Multi-tableaux (localStorage `tableau-accessible-boards`)

```json
{
  "version": 2,
  "tableaux": [
    {
      "id": "board-1234-abc",
      "nom": "Mon tableau",
      "cr&eacute;&eacute;": "2026-01-01T00:00:00.000Z",
      "derni&egrave;reOuverture": "2026-01-01T12:00:00.000Z",
      "favori": false,
      "donn&eacute;es": {
        "name": "Mon tableau",
        "items": [ ... ]
      }
    }
  ]
}
```

### Tableau individuel (champ `donn&eacute;es`)

```json
{
  "name": "Mon tableau",
  "items": [
    { "id": "item-1", "type": "sticky_note", "x": 100, "y": 100, "width": 150, "height": 150, "content": "Id&eacute;e", "color": "yellow" },
    { "id": "item-2", "type": "shape", "x": 300, "y": 200, "width": 120, "height": 80, "shape": "rectangle", "content": "&Eacute;tape" },
    { "id": "item-3", "type": "text", "x": 500, "y": 100, "width": 200, "height": 30, "content": "Note" },
    { "id": "item-4", "type": "card", "x": 100, "y": 400, "width": 200, "height": 120, "title": "Titre", "content": "Description" },
    { "id": "item-5", "type": "frame", "x": 50, "y": 50, "width": 600, "height": 500, "content": "Groupe" },
    { "id": "item-6", "type": "connector", "startId": "item-1", "endId": "item-2", "label": "reli&eacute;" }
  ]
}
```

Types : `sticky_note`, `shape`, `text`, `card`, `frame`, `connector`.

## Accessibilit&eacute;

- Landmarks : `<header>`, `<nav>`, `<main>` sur chaque vue.
- Lien d'&eacute;vitement vers le contenu principal.
- Annonces `aria-live` pour les actions et changements de vue.
- `aria-sort` sur les colonnes triables.
- `aria-pressed` sur les boutons &agrave; bascule (favori, vue grille/liste).
- `<dialog>` de confirmation pour la suppression.
- `<time datetime>` pour les dates.
- Contraste WCAG AA, cibles tactiles &ge; 24 px.

## Limites

- Pas de collaboration en temps r&eacute;el (l'&eacute;tat JSON est con&ccedil;u pour &ecirc;tre s&eacute;rialisable).
- Pas de redimensionnement &agrave; la souris.
- Pas de courbes de B&eacute;zier pour les connecteurs.
- Stockage local uniquement (localStorage).

## Tests

Les tests E2E utilisent Playwright (Chromium headless).

```bash
cd tests
npm install playwright
npx playwright install chromium
node e2e.mjs
```
