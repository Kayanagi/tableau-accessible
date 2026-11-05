/* Règles du modèle partagées entre le navigateur et le serveur : module pur, sans DOM ni stockage. */
export const PALETTE = [
  ['light_yellow', 'Jaune clair', '#fff79e'], ['miro_yellow', 'Jaune', '#ffe86d'],
  ['miro_orange', 'Orange', '#ffb575'], ['red', 'Rouge', '#ff9e9e'],
  ['light_pink', 'Rose clair', '#ffd2f2'], ['miro_pink', 'Rose', '#fd9ae7'],
  ['light_blue', 'Bleu clair', '#b2d0fe'], ['violet', 'Violet', '#b8acfb'],
  ['miro_blue', 'Bleu', '#9ce6ff'], ['dark_blue', 'Bleu foncé', '#86b4f9'],
  ['cyan', 'Cyan', '#81e7de'], ['dark_green', 'Vert foncé', '#6ae08d'],
  ['light_green', 'Vert clair', '#d1f09f'], ['miro_green', 'Vert', '#b3e65f'],
  ['miro_gray', 'Gris', '#f3f5f7'], ['black', 'Noir', '#151515']
];

export const LEGACY_COLORS = { yellow: 'miro_yellow', blue: 'miro_blue', green: 'miro_green', pink: 'miro_pink', orange: 'miro_orange', purple: 'violet', gray: 'miro_gray' };

export const SHAPES = {
  rectangle: 'Rectangle',
  circle: 'Cercle',
  triangle: 'Triangle',
  diamond: 'Losange'
};

export const TYPES = {
  sticky_note: 'Post-it',
  shape: 'Forme',
  text: 'Texte',
  card: 'Carte',
  frame: 'Cadre',
  connector: 'Ligne',
  drawing: 'Dessin à main levée',
  comment: 'Commentaire',
  mindmap: 'Carte mentale',
  kanban: 'Kanban',
  datatable: 'Tableau de données',
  code: 'Bloc de code',
  flipcard: 'Carte recto-verso'
};

export const SAFE_ID = /^[\w-]+$/;
export const ID_REFS = ['parent', 'startId', 'endId', 'targetId', 'groupId', 'parentNode'];

export function sanitizeIds(items) {
  items.forEach((item, i) => {
    if (typeof item.id !== 'string' || !SAFE_ID.test(item.id)) item.id = `item-import-${i + 1}`;
    for (const ref of ID_REFS) if (item[ref] != null && !SAFE_ID.test(String(item[ref]))) item[ref] = null;
  });
}
