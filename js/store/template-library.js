export const CATEGORIES = ['Réunions et ateliers', 'Idéation et brainstorming', 'Recherche et design', 'Agile', 'Stratégie et planification', 'Diagrammes et cartographie', 'Mes modèles'];
const item = (type, content, x, y, extra = {}) => ({ type, content, x, y, width: 200, height: 140, ...extra });
const sections = labels => labels.flatMap((label, i) => [
  item('frame', label, 40 + i % 3 * 340, 40 + Math.floor(i / 3) * 300, { width: 310, height: 260 }),
  item('sticky_note', 'À compléter', 65 + i % 3 * 340, 95 + Math.floor(i / 3) * 300, { color: 'light_yellow' })
]);
const specs = [
  ['brainstorming', 'Brainstorming', 1, 'Explorer les idées puis choisir les pistes à approfondir.', sections(['Question de départ', 'Idées', 'À approfondir'])],
  ['start-stop-continue', 'Rétro Start/Stop/Continue', 3, 'Décider ensemble des pratiques à faire évoluer.', sections(['Commencer', 'Arrêter', 'Continuer'])],
  ['daily', 'Daily stand-up', 3, 'Partager les progrès et lever les obstacles.', sections(['Hier', 'Aujourd’hui', 'Obstacles'])],
  ['kanban-projet', 'Kanban de projet', 3, 'Suivre les tâches du projet.', [item('kanban', 'Projet', 50, 50, { columns: ['À faire', 'En cours', 'Terminé'].map((name, i) => ({ id: `col-${i}`, name, cards: i ? [] : [{ id: 'task-1', text: 'Première tâche' }] })) })]],
  ['diagramme-flux', 'Diagramme de flux', 5, 'Relier les étapes d’un processus.', [item('shape', 'Début', 50, 50, { shape: 'circle' }), item('shape', 'Étape', 350, 50, { shape: 'rectangle' }), item('connector', '', 0, 0, { startId: 'item-1', endId: 'item-2', label: 'Puis' })]],
  ['carte-mentale', 'Carte mentale', 5, 'Organiser les idées autour d’un sujet.', [item('mindmap', 'Sujet central', 50, 150, { parentNode: null }), item('mindmap', 'Piste A', 350, 50, { parentNode: 'item-1' }), item('mindmap', 'Piste B', 350, 250, { parentNode: 'item-1' })]],
  ['eisenhower', 'Matrice d’Eisenhower', 4, 'Prioriser selon l’urgence et l’importance.', sections(['Urgent et important', 'Important, non urgent', 'Urgent, peu important', 'Ni urgent ni important'])],
  ['swot', 'SWOT', 4, 'Étudier les forces et risques de la stratégie.', sections(['Forces', 'Faiblesses', 'Opportunités', 'Menaces'])],
  ['persona', 'Persona', 2, 'Décrire une personne et ses besoins.', [item('card', 'Contexte et habitudes', 50, 50, { title: 'Profil' }), item('flipcard', 'Besoins', 300, 50, { back: 'Freins et motivations' }), item('text', 'Objectif de la recherche', 50, 250)]],
  ['parcours-utilisateur', 'Parcours utilisateur', 2, 'Cartographier les étapes vécues et les opportunités.', [item('datatable', 'Parcours', 50, 50, { rows: [['Étape', 'Action', 'Émotion', 'Opportunité'], ['Découverte', '', '', ''], ['Utilisation', '', '', '']] })]],
  ['lean-canvas', 'Lean canvas', 4, 'Expliciter les hypothèses du projet.', sections(['Problème', 'Solution', 'Proposition de valeur', 'Segments clients', 'Canaux', 'Revenus', 'Coûts', 'Indicateurs', 'Avantage'])],
  ['user-story-map', 'User story map', 3, 'Organiser les activités et les versions du produit.', sections(['Découvrir', 'Choisir', 'Utiliser', 'Version initiale', 'Version suivante'])],
  ['effort-impact', 'Matrice effort/impact', 1, 'Choisir les actions au meilleur impact.', sections(['Faible effort, fort impact', 'Fort effort, fort impact', 'Faible effort, faible impact', 'Fort effort, faible impact'])],
  ['ordre-du-jour', 'Ordre du jour de réunion', 0, 'Préparer les sujets et les décisions.', [item('text', 'Objectif de la réunion', 50, 20), ...sections(['Sujets', 'Décisions', 'Actions'])]],
  ['revue-sprint', 'Revue de sprint', 0, 'Présenter les résultats et recueillir les retours.', sections(['Objectif du sprint', 'Démonstration', 'Retours', 'Prochaines étapes'])]
];
export const LIBRARY = specs.map(([id, nom, cat, description, items]) => ({ id, nom, icone: '◇', categorie: CATEGORIES[cat], description, données: () => ({ name: nom, items: items.map((v, i) => ({ ...JSON.parse(JSON.stringify(v)), id: `item-${i + 1}` })) }) }));
