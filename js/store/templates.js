import { LIBRARY, CATEGORIES } from './template-library.js';
import * as local from './account-local.js';
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
        { id: 'item-4', type: 'frame', x: 550, y: 450, width: 450, height: 350, content: 'Longed for (Souhaité)' },
        { id: 'item-5', type: 'sticky_note', x: 80, y: 90, width: 150, height: 150, content: 'Ce qui nous a plu', color: 'light_green', parent: 'item-1' },
        { id: 'item-6', type: 'sticky_note', x: 580, y: 90, width: 150, height: 150, content: 'Ce que nous avons découvert', color: 'miro_blue', parent: 'item-2' },
        { id: 'item-7', type: 'sticky_note', x: 80, y: 490, width: 150, height: 150, content: 'Ce qui nous a manqué', color: 'miro_orange', parent: 'item-3' },
        { id: 'item-8', type: 'sticky_note', x: 580, y: 490, width: 150, height: 150, content: 'Ce que nous aimerions', color: 'violet', parent: 'item-4' }
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
        { id: 'item-6', type: 'card', x: 420, y: 80, width: 260, height: 100, title: 'Objectif 2', content: 'Description', parent: 'item-2' },
        { id: 'item-7', type: 'card', x: 770, y: 80, width: 260, height: 100, title: 'Objectif 3', content: 'Description', parent: 'item-3' },
        { id: 'item-8', type: 'sticky_note', x: 1150, y: 80, width: 150, height: 150, content: 'Jalon à confirmer', color: 'miro_yellow', parent: 'item-4' },
        { id: 'item-9', type: 'connector', startId: 'item-5', endId: 'item-6', label: 'Dépend de', x: 0, y: 0 }
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
        { id: 'item-4', type: 'sticky_note', x: 75, y: 80, width: 250, height: 120, content: 'Tâche exemple', color: 'yellow', parent: 'item-1' },
        { id: 'item-5', type: 'sticky_note', x: 425, y: 80, width: 250, height: 120, content: 'Tâche en cours', color: 'miro_blue', parent: 'item-2' },
        { id: 'item-6', type: 'sticky_note', x: 775, y: 80, width: 250, height: 120, content: 'Tâche terminée', color: 'light_green', parent: 'item-3' }
      ]
    })
  }
];

const LEGACY = {
  vierge: { categorie: 'Formats', description: 'Un tableau vide pour partir de zéro.', tags: [], format: 'Tableaux', recommande: true },
  organigramme: { categorie: 'Diagrammes et cartographie', description: 'Étapes, décision oui/non et liens fléchés pour décrire un processus.', tags: ['Processus'], format: 'Diagrammes', recommande: true, partage: true },
  retrospective: { categorie: 'Agile', description: 'Aimé, Appris, Manqué, Souhaité : quatre cadres pour faire le bilan.', tags: ['Rétrospective'], recommande: true, partage: true },
  'feuille-de-route': { categorie: 'Stratégie et planification', description: 'Quatre trimestres et des jalons pour planifier un projet.', tags: ['Feuille de route'], recommande: true, partage: true },
  'liste-taches': { categorie: 'Agile', description: 'Trois colonnes À faire, En cours, Terminé.', tags: ['Kanban'], format: 'Kanban', partage: true }
};
TEMPLATES.forEach(t => Object.assign(t, LEGACY[t.id]));
TEMPLATES.push(...LIBRARY);
/* « Mes modèles » et l'historique d'usage sont enregistrés avec le compte connecté, sur le serveur (store/account-local.js). */
const asTemplate = t => ({ ...t, categorie: 'Mes modèles', tags: [], données: () => JSON.parse(JSON.stringify(t.snapshot)) });
const stored = list => list.map(({ données, categorie, tags, ...t }) => t);
export function getCustomTemplates() {
  return local.templates().map(asTemplate);
}
/* Lève si aucun compte n'est connecté ou si une limite du compte serait dépassée : l'appelant le dit. */
export function saveTemplate(nom, snapshot) {
  const t = { id: 'custom-' + Date.now() + Math.random().toString(36).slice(2, 6), nom, description: 'Modèle enregistré avec votre compte.', créé: Date.now(), snapshot: JSON.parse(JSON.stringify(snapshot)) };
  local.addTemplates([t]);
  return t;
}
export function removeTemplate(id) {
  local.setTemplates(stored(getCustomTemplates().filter(t => t.id !== id)));
}
export function setTemplateShared(id, partage) {
  local.setTemplates(stored(getCustomTemplates().map(t => (t.id === id ? { ...t, partage } : t))));
}
export function getTemplate(id) {
  return [...TEMPLATES, ...getCustomTemplates()].find(t => t.id === id) || null;
}
export function markUsed(id) {
  local.markUsed(id);
}
export function getUsage() {
  return local.usage();
}
