import * as state from './state.js';
import { announce } from './a11y/announcer.js';

const FORMAT = 'tableau-accessible';
const STYLE_KEYS = { sticky_note: ['color', 'fontSize', 'bold', 'align'], shape: ['shape', 'fontSize', 'bold', 'align'], text: ['fontSize', 'bold', 'align'], card: ['fontSize', 'bold', 'align'], frame: [], connector: ['lineType'] };
let clip = null;
let pasteCount = 0;
let style = null;

function count(n, one, many) {
  return n === 1 ? one : `${n} ${many}`;
}

export function copy(ids = state.getSelectedIds()) {
  const items = state.collectForCopy(ids);
  if (!items.length) { announce('Rien à copier'); return false; }
  clip = items;
  pasteCount = 0;
  try {
    navigator.clipboard?.writeText(JSON.stringify({ format: FORMAT, items })).catch(() => {});
  } catch { /* presse-papiers système indisponible */ }
  announce(`${count(items.filter(i => i.type !== 'connector').length, '1 élément copié', 'éléments copiés')}`);
  return true;
}

export function cut(ids = state.getSelectedIds()) {
  if (!copy(ids)) return;
  pasteCount = -1;
  state.removeItems(ids);
}

export async function paste() {
  let items = clip;
  if (!items && navigator.clipboard?.readText) {
    try {
      const data = JSON.parse(await navigator.clipboard.readText());
      if (data?.format === FORMAT && Array.isArray(data.items)) items = data.items;
    } catch { /* contenu étranger ou accès refusé */ }
  }
  if (!items?.length) { announce('Presse-papiers vide'); return []; }
  pasteCount++;
  return state.pasteItems(items, 20 * pasteCount);
}

export function copyStyle(id = state.getSelectedId()) {
  const item = state.getItem(id);
  if (!item) return;
  style = {};
  for (const k of STYLE_KEYS[item.type] || []) if (item[k] !== undefined) style[k] = item[k];
  announce('Style copié');
}

export function pasteStyle(ids = state.getSelectedIds()) {
  if (!style) { announce('Aucun style copié'); return; }
  const s = style;
  state.updateItems(ids, item => Object.fromEntries((STYLE_KEYS[item.type] || []).filter(k => k in s).map(k => [k, s[k]])), 'Style collé');
}

export function clearContent(ids = state.getSelectedIds()) {
  const targets = ids.filter(id => { const i = state.getItem(id); return i && i.type !== 'connector' && i.type !== 'frame'; });
  if (!targets.length) return;
  state.updateItems(targets, { content: '' }, `Contenu effacé (${count(targets.length, '1 élément', 'éléments')})`);
}
