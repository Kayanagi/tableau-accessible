const PATHS = {
  board: '<rect x="18" y="20" width="28" height="32" rx="4"/><path d="M26 16h12v8H26z" class="icon-cut"/><path d="M25 30h14M25 38h14M25 46h10" class="icon-line-cut"/>',
  idea: '<path d="M32 10c-11 0-20 8-20 19 0 8 5 13 10 17v7h20v-7c5-4 10-9 10-17 0-11-9-19-20-19z"/><path d="M24 54h16M26 60h12" class="icon-line"/>',
  goal: '<circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="14" class="icon-cut"/><circle cx="32" cy="32" r="6"/><path d="M38 26 52 12M45 12h7v7" class="icon-line"/>',
  launch: '<path d="M38 10c9 4 14 12 16 22L37 49 20 32c2-10 8-18 18-22z"/><circle cx="38" cy="27" r="5" class="icon-cut"/><path d="M19 39 11 47l10 2M31 51l2 10 8-8" class="icon-line"/>',
  growth: '<path d="M32 55V26M31 39c-11 0-18-6-18-17 11 0 18 6 18 17zM33 31c0-11 7-18 18-18 0 11-7 18-18 18z"/><path d="M20 55h24" class="icon-line"/>',
  favorite: '<path d="m32 9 7 15 16 2-12 12 3 17-14-8-14 8 3-17L9 26l16-2z"/>',
  lock: '<rect x="14" y="28" width="36" height="28" rx="6"/><path d="M22 28v-7c0-7 4-12 10-12s10 5 10 12v7" class="icon-line"/><circle cx="32" cy="41" r="4" class="icon-cut"/>',
  delete: '<path d="M19 20h26l-2 37H21z"/><path d="M15 20h34M25 20v-7h14v7M27 30v17M37 30v17" class="icon-line-cut"/>',
  tag: '<path d="M10 14h24l20 20-20 20L10 30z"/><circle cx="22" cy="26" r="5" class="icon-cut"/>',
  reaction: '<circle cx="32" cy="32" r="24"/><circle cx="24" cy="27" r="3" class="icon-cut"/><circle cx="40" cy="27" r="3" class="icon-cut"/><path d="M21 38c3 7 19 7 22 0" class="icon-line-cut"/>',
  comment: '<path d="M10 13h44v34H29L17 56v-9h-7z"/><path d="M20 25h24M20 34h18" class="icon-line-cut"/>',
  drawing: '<path d="m14 48 5-15 24-24 12 12-24 24z"/><path d="m19 33 12 12M43 9l12 12M14 48l-3 7 8-2" class="icon-line-cut"/>',
  mindmap: '<circle cx="32" cy="32" r="9"/><circle cx="12" cy="16" r="6"/><circle cx="52" cy="16" r="6"/><circle cx="12" cy="49" r="6"/><circle cx="52" cy="49" r="6"/><path d="M25 26 17 20M39 26l8-6M25 38l-8 7M39 38l8 7" class="icon-line"/>'
};

export const BOARD_ICONS = [
  ['board', 'Tableau'], ['idea', 'Idée'], ['goal', 'Objectif'],
  ['launch', 'Lancement'], ['growth', 'Croissance'], ['favorite', 'Favori']
];

const LEGACY = { '📋': 'board', '💡': 'idea', '🎯': 'goal', '🚀': 'launch', '🌱': 'growth', '⭐': 'favorite' };

export function normalizeBoardIcon(value) {
  return PATHS[value] && BOARD_ICONS.some(([id]) => id === value) ? value : LEGACY[value] || 'board';
}

export function iconSvg(name, className = 'baro-icon') {
  const path = PATHS[name] || PATHS.board;
  return `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${path}</svg>`;
}

export function setBoardLabel(element, board) {
  element.replaceChildren();
  element.insertAdjacentHTML('afterbegin', iconSvg(normalizeBoardIcon(board.icon || board.emoji), 'baro-icon board-icon'));
  element.append(document.createTextNode(board.nom));
}
