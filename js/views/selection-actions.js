import * as state from '../state.js';
import * as clipboard from '../clipboard.js';
import * as canvas from './canvas.js';

export function duplicate(ids) {
  const copies = state.duplicateItems(ids);
  if (copies[0]) canvas.focusItem(copies[0].id);
  if (copies.length > 1) state.setSelection(copies.map(c => c.id));
}

/* Actions sur la sélection, communes à la barre contextuelle et au menu du clic droit. */
export const ACTIONS = {
  copy: { label: 'Copier', shortcut: 'Ctrl+C', keys: 'Control+C', run: ids => clipboard.copy(ids) },
  cut: { label: 'Couper', shortcut: 'Ctrl+X', keys: 'Control+X', run: ids => clipboard.cut(ids) },
  paste: { label: 'Coller', shortcut: 'Ctrl+V', keys: 'Control+V', run: () => clipboard.paste() },
  duplicate: { label: 'Dupliquer', shortcut: 'Ctrl+D', keys: 'Control+D', run: duplicate },
  remove: { label: 'Supprimer', shortcut: 'Suppr', keys: 'Delete', run: ids => state.removeItems(ids) },
  copyStyle: { label: 'Copier le style', shortcut: 'Ctrl+Alt+C', keys: 'Control+Alt+C', run: ids => clipboard.copyStyle(ids[0]) },
  pasteStyle: { label: 'Coller le style', shortcut: 'Ctrl+Alt+V', keys: 'Control+Alt+V', run: ids => clipboard.pasteStyle(ids) },
  clear: { label: 'Effacer le contenu', shortcut: 'Ctrl+Retour arrière', keys: 'Control+Backspace', run: ids => clipboard.clearContent(ids) },
  front: { label: 'Premier plan', shortcut: 'Page précédente', keys: 'PageUp', run: ids => state.reorderItems(ids, true) },
  back: { label: 'Arrière-plan', shortcut: 'Page suivante', keys: 'PageDown', run: ids => state.reorderItems(ids, false) },
  frame: { label: 'Créer un cadre', run: ids => state.frameAround(ids) },
  group: { label: 'Grouper', shortcut: 'Ctrl+G', keys: 'Control+G', run: ids => state.groupItems(ids) },
  ungroup: { label: 'Dégrouper', shortcut: 'Ctrl+Maj+G', keys: 'Control+Shift+G', run: ids => state.ungroupItems(ids) }
};
