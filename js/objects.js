export const PEN_COLORS = [
  ['ink', 'Encre', '#1b1740'], ['violet', 'Violet', '#4a2fcc'], ['red', 'Rouge', '#c4141f'],
  ['blue', 'Bleu', '#1f5fd1'], ['green', 'Vert', '#1a7f37'], ['orange', 'Orange', '#b45309']
];
export const PEN_WIDTHS = [[2, 'Fin'], [4, 'Moyen'], [8, 'Épais']];
export const TAG_COLORS = [
  ['violet', 'Violet', '#4a2fcc'], ['red', 'Rouge', '#b3261e'], ['green', 'Vert', '#1a7f37'],
  ['blue', 'Bleu', '#1f5fd1'], ['orange', 'Orange', '#a64b00'], ['gray', 'Gris', '#545266']
];
export const REACTIONS = [['👍', 'pouce levé'], ['👎', 'pouce baissé'], ['❤️', 'cœur'], ['🎉', 'fête'], ['😂', 'rire'], ['😮', 'surprise']];
export const LANGUAGES = { text: 'Texte brut', javascript: 'JavaScript', python: 'Python', html: 'HTML', css: 'CSS', json: 'JSON', bash: 'Bash', sql: 'SQL' };
export const BOARD_BACKGROUNDS = [
  ['default', 'Selon le thème', null, null], ['white', 'Blanc', '#ffffff', 'light'], ['cream', 'Crème', '#fbf6e9', 'light'],
  ['gray', 'Gris clair', '#eceef1', 'light'], ['sky', 'Bleu ciel', '#e3f1fb', 'light'], ['mint', 'Vert d’eau', '#e3f6ee', 'light'],
  ['lavender', 'Lavande', '#eee9ff', 'light'], ['night', 'Nuit', '#12101f', 'dark'], ['deep', 'Violet nuit', '#241a66', 'dark']
];
export const TAG_TYPES = ['sticky_note', 'card'];
export const AUTO_SIZE = ['kanban', 'datatable', 'mindmap', 'comment'];

export const KB = { colW: 180, pad: 8, head: 34, colHead: 30, cardH: 44, gap: 6 };
export const DT = { cellW: 120, cellH: 30, head: 28 };
export const MM = { gapX: 60, gapY: 16, w: 150, h: 44, rootW: 170, rootH: 56 };

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function hexOf(list, id) {
  return (list.find(c => c[0] === id) || list[0])[2];
}

export function nameOf(list, id) {
  return (list.find(c => c[0] === id) || list[0])[1];
}

export function kanbanSize(item) {
  const n = Math.max(1, item.columns.length);
  const most = Math.max(0, ...item.columns.map(c => c.cards.length));
  return { width: n * KB.colW + KB.pad, height: KB.head + KB.colHead + most * (KB.cardH + KB.gap) + KB.cardH + KB.pad };
}

export function kanbanGeom(item) {
  const top = item.y + KB.head;
  return item.columns.map((col, c) => {
    const x = item.x + KB.pad + c * KB.colW;
    return {
      x, y: top, w: KB.colW - KB.pad, h: item.height - KB.head - KB.pad,
      cards: col.cards.map((_, k) => ({ x: x + 6, y: top + KB.colHead + k * (KB.cardH + KB.gap), w: KB.colW - KB.pad - 12, h: KB.cardH }))
    };
  });
}

export function tableSize(item) {
  return { width: Math.max(1, item.rows[0]?.length || 1) * DT.cellW, height: DT.head + item.rows.length * DT.cellH };
}

export function cellBox(item, r, c) {
  return { x: item.x + c * DT.cellW, y: item.y + DT.head + r * DT.cellH, w: DT.cellW, h: DT.cellH };
}

export function defaults(type) {
  switch (type) {
    case 'kanban': return { content: 'Kanban', columns: ['À faire', 'En cours', 'Fait'].map(name => ({ id: uid('col'), name, cards: [] })) };
    case 'datatable': return { content: 'Tableau', rows: [['Colonne 1', 'Colonne 2', 'Colonne 3'], ['', '', ''], ['', '', '']] };
    case 'mindmap': return { content: '', parentNode: null, collapsed: false, width: MM.rootW, height: MM.rootH };
    case 'code': return { content: '', language: 'javascript', width: 320, height: 180 };
    case 'flipcard': return { content: '', back: '', flipped: false, width: 220, height: 140 };
    case 'comment': return { messages: [], resolved: false, width: 28, height: 28 };
    default: return {};
  }
}

const KEYWORDS = {
  javascript: 'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof this null undefined true false of in',
  python: 'def return if elif else for while in not and or import from as class try except finally raise with lambda None True False pass break continue yield global self',
  bash: 'if then else fi for do done while case esac function echo export local return in',
  sql: 'select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as null distinct',
  css: 'important',
  json: 'true false null',
  html: ''
};
const TOKEN = /(\/\/.*$|#.*$|--.*$|\/\*.*?\*\/|<!--.*?-->)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w-]*)/g;

export function highlight(line, lang) {
  if (lang === 'text') return [{ text: line, kind: '' }];
  const words = new Set((KEYWORDS[lang] || '').split(' '));
  const comment = { javascript: '//', python: '#', bash: '#', sql: '--', css: '/*', html: '<!--', json: null }[lang];
  const out = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    let kind = '';
    if (m[1]) { if (!comment || !m[1].startsWith(comment)) continue; kind = 'comment'; }
    else if (m[2]) kind = 'string';
    else if (m[3]) kind = 'number';
    else if (m[4] && words.has(lang === 'sql' ? m[4].toLowerCase() : m[4])) kind = 'keyword';
    else continue;
    if (m.index > last) out.push({ text: line.slice(last, m.index), kind: '' });
    out.push({ text: m[0], kind });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), kind: '' });
  return out;
}

export function simplify(points, eps) {
  if (points.length < 3) return points;
  let max = 0, index = 0;
  const [a, b] = [points[0], points[points.length - 1]];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
    if (d > max) { max = d; index = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(points.slice(0, index + 1), eps).slice(0, -1), ...simplify(points.slice(index), eps)];
}

export function smooth(points) {
  if (points.length < 3) return points;
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const a = points[i - 1], b = points[i + 1];
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
  });
}
