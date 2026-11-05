export const CAPS = { none: 'Aucune', arrow_open: 'Flèche ouverte', arrow_filled: 'Flèche pleine', arrow_round: 'Flèche arrondie', circle: 'Cercle', diamond: 'Losange' };
export const LINE_TYPES = { straight: 'Droit', orthogonal: 'Angles droits', bezier: 'Courbe' };
export const LINE_STYLES = { solid: 'Plein', dashed: 'Tirets', dotted: 'Pointillés' };
export const LINE_WIDTHS = [1, 2, 4, 6, 8];
export const LINE_COLORS = [
  ['auto', 'Automatique', 'var(--connector-stroke)'], ['violet', 'Violet', 'var(--line-violet)'], ['red', 'Rouge', 'var(--line-red)'],
  ['blue', 'Bleu', 'var(--line-blue)'], ['green', 'Vert', 'var(--line-green)'], ['orange', 'Orange', 'var(--line-orange)']
];
export const END_NAMES = { start: 'Début', end: 'Fin' };

export function normalizeLine(item) {
  if (item.lineType === 'line') { item.lineType = 'straight'; item.endCap ??= 'none'; }
  else if (item.lineType === 'arrow' || !item.lineType) { item.lineType = 'straight'; item.endCap ??= 'arrow_filled'; }
  else item.endCap ??= 'arrow_filled';
  if (!Object.hasOwn(CAPS, item.startCap)) item.startCap = 'none';
  if (!Object.hasOwn(CAPS, item.endCap)) item.endCap = 'arrow_filled';
  if (!['solid', 'dashed', 'dotted'].includes(item.lineStyle)) item.lineStyle = 'solid';
  item.strokeWidth = Math.min(20, Math.max(1, Number(item.strokeWidth) || 2));
  item.stroke ??= 'auto';
  item.label ??= '';
  item.x ??= 0;
  item.y ??= 0;
  if (!Array.isArray(item.waypoints)) item.waypoints = [];
  return item;
}

export function strokeOf(item) {
  return (LINE_COLORS.find(c => c[0] === item.stroke) || LINE_COLORS[0])[2];
}

export function dashOf(item) {
  const w = item.strokeWidth || 2;
  if (item.lineStyle === 'dashed') return `${w * 4} ${w * 3}`;
  if (item.lineStyle === 'dotted') return `0 ${w * 2.5}`;
  return null;
}

function center(i) {
  return { x: (i.x || 0) + (i.width || 100) / 2, y: (i.y || 0) + (i.height || 100) / 2 };
}

function edgePoint(i, toward) {
  const c = center(i);
  const hw = (i.width || 100) / 2, hh = (i.height || 100) / 2;
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (!dx && !dy) return c;
  let t;
  if (i.type === 'shape' && i.shape === 'circle') t = 1 / Math.hypot(dx / hw, dy / hh);
  else if (i.type === 'shape' && i.shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function sideAnchor(i, toward, horizontal) {
  const c = center(i);
  const hw = (i.width || 100) / 2, hh = (i.height || 100) / 2;
  return horizontal ? { x: c.x + Math.sign(toward.x - c.x || 1) * hw, y: c.y } : { x: c.x, y: c.y + Math.sign(toward.y - c.y || 1) * hh };
}

function endRef(item, end, find) {
  const id = item[`${end}Id`];
  const obj = id ? find(id) : null;
  if (obj) return { obj, at: center(obj) };
  return item[end] ? { at: item[end] } : null;
}

const isHorizontal = (a, b) => Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function capSize(strokeWidth) {
  return 6 + (strokeWidth || 2) * 2;
}

function capTrim(cap, size) {
  return { none: 0, arrow_open: 0, arrow_filled: size * 0.85, arrow_round: size * 0.5, circle: size * 0.8, diamond: size * 1.3 }[cap] || 0;
}

function toward(p, q, dist) {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (!len || len <= dist) return p;
  return { x: p.x + (q.x - p.x) / len * dist, y: p.y + (q.y - p.y) / len * dist };
}

function polyPath(pts) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.x === b.x && a.y === b.y) continue;
    d += a.y === b.y ? ` H ${b.x}` : a.x === b.x ? ` V ${b.y}` : ` L ${b.x} ${b.y}`;
  }
  return d;
}

function curvePath(cubics, trimStart = 0, trimEnd = 0) {
  const first = toward(cubics[0].a, cubics[0].c1, trimStart);
  let d = `M ${first.x} ${first.y}`;
  cubics.forEach((c, i) => {
    const b = i === cubics.length - 1 ? toward(c.b, c.c2, trimEnd) : c.b;
    d += ` C ${c.c1.x} ${c.c1.y}, ${c.c2.x} ${c.c2.y}, ${b.x} ${b.y}`;
  });
  return d;
}

function cubicAt(c, t) {
  const u = 1 - t;
  const f = k => u * u * u * c.a[k] + 3 * u * u * t * c.c1[k] + 3 * u * t * t * c.c2[k] + t * t * t * c.b[k];
  return { x: f('x'), y: f('y') };
}

function buildCubics(pts) {
  if (pts.length === 2) {
    const [a, b] = pts;
    const k = isHorizontal(a, b) ? { x: (b.x - a.x) / 2, y: 0 } : { x: 0, y: (b.y - a.y) / 2 };
    return [{ a, b, c1: { x: a.x + k.x, y: a.y + k.y }, c2: { x: b.x - k.x, y: b.y - k.y } }];
  }
  return pts.slice(0, -1).map((p, i) => {
    const prev = pts[i - 1] || p, q = pts[i + 1], next = pts[i + 2] || q;
    return { a: p, b: q, c1: { x: p.x + (q.x - prev.x) / 6, y: p.y + (q.y - prev.y) / 6 }, c2: { x: q.x - (next.x - p.x) / 6, y: q.y - (next.y - p.y) / 6 } };
  });
}

/* Géométrie complète d'une ligne ; null si une extrémité n'existe plus. */
export function geometry(item, find) {
  const a = endRef(item, 'start', find), b = endRef(item, 'end', find);
  if (!a || !b) return null;
  const wps = item.waypoints || [];
  const firstRef = wps[0] || b.at, lastRef = wps[wps.length - 1] || a.at;
  const type = item.lineType;
  let s, e;
  if (type === 'orthogonal') {
    s = a.obj ? sideAnchor(a.obj, firstRef, isHorizontal(a.at, firstRef)) : a.at;
    e = b.obj ? sideAnchor(b.obj, lastRef, isHorizontal(b.at, lastRef)) : b.at;
  } else {
    s = a.obj ? edgePoint(a.obj, firstRef) : a.at;
    e = b.obj ? edgePoint(b.obj, lastRef) : b.at;
  }
  const points = [s, ...wps, e];
  const size = capSize(item.strokeWidth);
  const trimStart = capTrim(item.startCap, size), trimEnd = capTrim(item.endCap, size);
  let d, body, mids, samples, startDir, endDir;
  if (type === 'bezier') {
    const cubics = buildCubics(points);
    d = curvePath(cubics);
    body = curvePath(cubics, trimStart, trimEnd);
    mids = cubics.map(c => cubicAt(c, 0.5));
    samples = cubics.flatMap(c => [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => cubicAt(c, t)));
    const f = cubics[0], l = cubics[cubics.length - 1];
    startDir = { x: f.a.x - f.c1.x, y: f.a.y - f.c1.y };
    endDir = { x: l.b.x - l.c2.x, y: l.b.y - l.c2.y };
  } else {
    let verts = points;
    if (type === 'orthogonal') {
      verts = [s];
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i], q = points[i + 1], m = mid(p, q);
        verts.push(...(isHorizontal(p, q) ? [{ x: m.x, y: p.y }, { x: m.x, y: q.y }, q] : [{ x: p.x, y: m.y }, { x: q.x, y: m.y }, q]));
      }
      verts = verts.filter((v, i) => !i || v.x !== verts[i - 1].x || v.y !== verts[i - 1].y);
    }
    mids = points.slice(0, -1).map((p, i) => mid(p, points[i + 1]));
    samples = verts;
    d = polyPath(verts);
    const trimmed = [...verts];
    if (verts.length > 1) {
      trimmed[0] = toward(verts[0], verts[1], trimStart);
      trimmed[trimmed.length - 1] = toward(verts[verts.length - 1], verts[verts.length - 2], trimEnd);
    }
    body = polyPath(trimmed);
    const v1 = verts[1] || verts[0], vn = verts[verts.length - 2] || verts[0], vl = verts[verts.length - 1];
    startDir = { x: verts[0].x - v1.x, y: verts[0].y - v1.y };
    endDir = { x: vl.x - vn.x, y: vl.y - vn.y };
  }
  const n = points.length - 1;
  const labelAt = n % 2 ? mids[(n - 1) / 2] : points[n / 2];
  const xs = samples.map(p => p.x), ys = samples.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { start: s, end: e, points, d, body, mids, labelAt, startDir, endDir, bbox: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
}

/* Forme d'extrémité : { tag, attrs, filled } placée sur la pointe `p`, orientée selon `dir`. */
export function capShape(cap, p, dir, size) {
  if (!cap || cap === 'none') return null;
  const len = Math.hypot(dir.x, dir.y) || 1;
  const fx = dir.x / len, fy = dir.y / len;
  const nx = -fy, ny = fx;
  const at = (back, side) => `${p.x - fx * back + nx * side},${p.y - fy * back + ny * side}`;
  const w = size * 0.55;
  switch (cap) {
    case 'arrow_open': return { tag: 'polyline', attrs: { points: `${at(size, w)} ${at(0, 0)} ${at(size, -w)}` }, filled: false };
    case 'arrow_filled': return { tag: 'polygon', attrs: { points: `${at(size, w)} ${at(0, 0)} ${at(size, -w)}` }, filled: true };
    case 'arrow_round': return { tag: 'path', attrs: { d: `M ${at(0, 0)} L ${at(size, w)} Q ${at(size * 0.45, 0)} ${at(size, -w)} Z` }, filled: true };
    case 'circle': return { tag: 'circle', attrs: { cx: p.x - fx * size * 0.45, cy: p.y - fy * size * 0.45, r: size * 0.45 }, filled: true };
    case 'diamond': return { tag: 'polygon', attrs: { points: `${at(0, 0)} ${at(size * 0.7, w)} ${at(size * 1.4, 0)} ${at(size * 0.7, -w)}` }, filled: true };
    default: return null;
  }
}

const round = p => ({ x: Math.round(p.x), y: Math.round(p.y) });

export function anchorOf(item, end, find) {
  const g = geometry(item, find);
  return g ? round(g[end]) : null;
}

export function setEnd(item, end, target) {
  if (target.id) {
    item[`${end}Id`] = target.id;
    delete item[end];
  } else {
    delete item[`${end}Id`];
    item[end] = round(target);
  }
}

export function isAttached(item, end) {
  return !!item[`${end}Id`];
}

export function isFree(item) {
  return !item.startId && !item.endId;
}

/* Déplace une ligne ; une extrémité accrochée à un objet qui ne bouge pas se détache. */
export function shiftLine(item, dx, dy, moving, find) {
  const g = geometry(item, find);
  if (!g) return false;
  let detached = false;
  for (const end of ['start', 'end']) {
    const id = item[`${end}Id`];
    if (id && moving.has(id)) continue;
    if (id) detached = true;
    setEnd(item, end, { x: (id ? g[end].x : item[end].x) + dx, y: (id ? g[end].y : item[end].y) + dy });
  }
  item.waypoints = (item.waypoints || []).map(w => ({ x: Math.round(w.x + dx), y: Math.round(w.y + dy) }));
  return detached;
}

export function reverseLine(item) {
  const { startId, endId, start, end } = item;
  delete item.startId; delete item.endId; delete item.start; delete item.end;
  if (endId) item.startId = endId; else item.start = end;
  if (startId) item.endId = startId; else item.end = start;
  item.waypoints = [...(item.waypoints || [])].reverse();
}
