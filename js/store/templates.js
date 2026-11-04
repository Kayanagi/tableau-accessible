import { LIBRARY, CATEGORIES } from './template-library.js';
export { CATEGORIES };
export const TEMPLATES = [
  {
    id: 'vierge',
    nom: 'Vierge',
    icone: '+',
    données: () => ({ name: 'Nouveau tableau', items: [] })
  },
  {
    id: 'organigramme',
    nom: 'Organigramme / flux',
    icone: '◇',
    données: () => ({
      name: 'Organigramme',
      items: [
        { id: 'item-1', type: 'shape', shape: 'rectangle', x: 300, y: 50, width: 160, height: 60, content: 'Début' },
        { id: 'item-2', type: 'shape', shape: 'rectangle', x: 300, y: 180, width: 160, height: 60, content: 'Étape 1' },
        { id: 'item-3', type: 'shape', shape: 'diamond', x: 300, y: 320, width: 160, height: 100, content: 'Décision ?' },
        { id: 'item-4', type: 'shape', shape: 'rectangle', x: 100, y: 500, width: 160, height: 60, content: 'Option A' },
        { id: 'item-5', type: 'shape', shape: 'rectangle', x: 500, y: 500, width: 160, height: 60, content: 'Option B' },
        { id: 'item-6', type: 'shape', shape: 'rectangle', x: 300, y: 640, width: 160, height: 60, content: 'Fin' },
        { id: 'item-7', type: 'connector', startId: 'item-1', endId: 'item-2', label: '', x: 0, y: 0 },
        { id: 'item-8', type: 'connector', startId: 'item-2', endId: 'item-3', label: '', x: 0, y: 0 },
        { id: 'item-9', type: 'connector', startId: 'item-3', endId: 'item-4', label: 'Oui', x: 0, y: 0 },
        { id: 'item-10', type: 'connector', startId: 'item-3', endId: 'item-5', label: 'Non', x: 0, y: 0 },
        { id: 'item-11', type: 'connector', startId: 'item-4', endId: 'item-6', label: '', x: 0, y: 0 },
        { id: 'item-12', type: 'connector', startId: 'item-5', endId: 'item-6', label: '', x: 0, y: 0 }
      ]
    })
  },
  {
    id: 'retrospective',
    nom: 'Rétrospective 4 L',
    icone: '⊞',
    données: () => ({
      name: 'Rétrospective 4 L',
      items: [
        { id: 'item-1', type: 'frame', x: 50, y: 50, width: 450, height: 350, content: 'Liked (Aimé)' },
        { id: 'item-2', type: 'frame', x: 550, y: 50, width: 450, height: 350, content: 'Learned (Appris)' },
        { id: 'item-3', type: 'frame', x: 50, y: 450, width: 450, height: 350, content: 'Lacked (Manqué)' },
        { id: 'item-4', type: 'frame', x: 550, y: 450, width: 450, height: 350, content: 'Longed for (Souhaité)' }
      ]
    })
  },
  {
    id: 'feuille-de-route',
    nom: 'Feuille de route',
    icone: '▸',
    données: () => ({
      name: 'Feuille de route',
      items: [
        { id: 'item-1', type: 'frame', x: 50, y: 50, width: 300, height: 500, content: 'T1' },
        { id: 'item-2', type: 'frame', x: 400, y: 50, width: 300, height: 500, content: 'T2' },
        { id: 'item-3', type: 'frame', x: 750, y: 50, width: 300, height: 500, content: 'T3' },
        { id: 'item-4', type: 'frame', x: 1100, y: 50, width: 300, height: 500, content: 'T4' },
        { id: 'item-5', type: 'card', x: 70, y: 80, width: 260, height: 100, title: 'Objectif 1', content: 'Description', parent: 'item-1' },
        { id: 'item-6', type: 'card', x: 420, y: 80, width: 260, height: 100, title: 'Objectif 2', content: 'Description', parent: 'item-2' }
      ]
    })
  },
  {
    id: 'liste-taches',
    nom: 'Liste de tâches',
    icone: '☑',
    données: () => ({
      name: 'Liste de tâches',
      items: [
        { id: 'item-1', type: 'frame', x: 50, y: 50, width: 300, height: 600, content: 'À faire' },
        { id: 'item-2', type: 'frame', x: 400, y: 50, width: 300, height: 600, content: 'En cours' },
        { id: 'item-3', type: 'frame', x: 750, y: 50, width: 300, height: 600, content: 'Terminé' },
        { id: 'item-4', type: 'sticky_note', x: 75, y: 80, width: 250, height: 120, content: 'Tâche exemple', color: 'yellow', parent: 'item-1' }
      ]
    })
  }
];

const legacyCategories = [4, 5, 3, 4, 3];
const legacyDescriptions = {
  'Vierge': 'Un tableau vide pour partir de zéro.',
  'Organigramme / flux': 'Étapes, décision oui/non et liens fléchés pour décrire un processus.',
  'Rétrospective 4 L': 'Aimé, Appris, Manqué, Souhaité : quatre cadres pour faire le bilan.',
  'Feuille de route': 'Quatre trimestres et des jalons pour planifier un projet.',
  'Liste de tâches': 'Trois colonnes À faire, En cours, Fait.'
};
TEMPLATES.forEach((t, i) => { t.categorie = CATEGORIES[legacyCategories[i]]; t.description = legacyDescriptions[t.nom] || `Modèle ${t.nom}.`; });
TEMPLATES.push(...LIBRARY);
const KEY = 'tableau-accessible-templates';
export function getCustomTemplates() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]').map(t => ({ ...t, categorie: 'Mes modèles', données: () => JSON.parse(JSON.stringify(t.snapshot)) })); }
  catch { return []; }
}
export function saveTemplate(nom, snapshot) {
  const list = getCustomTemplates().map(({ données, ...t }) => t);
  const t = { id: 'custom-' + Date.now() + Math.random().toString(36).slice(2, 6), nom, description: 'Modèle enregistré sur cet appareil.', snapshot: JSON.parse(JSON.stringify(snapshot)) };
  localStorage.setItem(KEY, JSON.stringify([...list, t]));
  return t;
}
export function removeTemplate(id) {
  localStorage.setItem(KEY, JSON.stringify(getCustomTemplates().filter(t => t.id !== id).map(({ données, ...t }) => t)));
}
export function getTemplate(id) {
  return [...TEMPLATES, ...getCustomTemplates()].find(t => t.id === id) || null;
}
