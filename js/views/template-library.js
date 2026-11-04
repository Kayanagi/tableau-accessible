import { TEMPLATES, CATEGORIES, getCustomTemplates, removeTemplate } from '../store/templates.js';
import { dialog, ask } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';

const NS = 'http://www.w3.org/2000/svg';
export function preview(snapshot) {
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('template-preview');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Aperçu : ${snapshot.name}`);
  const items = snapshot.items.filter(i => i.type !== 'connector');
  const left = Math.min(0, ...items.map(i => i.x));
  const top = Math.min(0, ...items.map(i => i.y));
  svg.setAttribute('viewBox', `${left - 10} ${top - 10} ${Math.max(300, ...items.map(i => i.x + (i.width || 200))) - left + 20} ${Math.max(180, ...items.map(i => i.y + (i.height || 140))) - top + 20}`);
  for (const i of snapshot.items) {
    if (i.type === 'connector') {
      const a = snapshot.items.find(v => v.id === i.startId), b = snapshot.items.find(v => v.id === i.endId);
      if (!a || !b) continue;
      const line = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1: a.x + (a.width || 200) / 2, y1: a.y + (a.height || 140) / 2, x2: b.x + (b.width || 200) / 2, y2: b.y + (b.height || 140) / 2, stroke: '#4a2fcc', 'stroke-width': 4 })) line.setAttribute(k, v);
      svg.append(line); continue;
    }
    const rect = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: i.x, y: i.y, width: i.width || 200, height: i.height || 140, fill: i.type === 'frame' ? '#f7f7fb' : i.type === 'sticky_note' ? '#fff79e' : '#e6e0ff', stroke: '#4a2fcc', 'stroke-width': 2, rx: 4 })) rect.setAttribute(k, v);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', i.x + 8); text.setAttribute('y', i.y + 24);
    text.setAttribute('font-size', 16); text.setAttribute('fill', '#1b1740');
    text.textContent = (i.title || i.content || '').slice(0, 32);
    svg.append(rect, text);
  }
  return svg;
}
export function openLibrary(use) {
  dialog('Bibliothèque de modèles', el => {
    el.classList.add('template-library');
    const filters = document.createElement('div');
    const category = document.createElement('select');
    category.id = 'template-category'; category.setAttribute('aria-label', 'Catégorie de modèles');
    category.add(new Option('Toutes les catégories', ''));
    CATEGORIES.forEach(c => category.add(new Option(c, c)));
    const search = document.createElement('input');
    search.id = 'template-search'; search.type = 'search'; search.setAttribute('aria-label', 'Rechercher un modèle');
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const list = document.createElement('div'); list.className = 'library-results';
    const field = (text, control) => { const l = document.createElement('label'); l.className = 'library-field'; l.append(text, control); control.removeAttribute('aria-label'); return l; };
    search.placeholder = 'SWOT, rétro, kanban…';
    filters.className = 'library-filters';
    filters.append(field('Catégorie', category), field('Rechercher', search)); el.append(filters, status, list);
    const render = () => {
      list.replaceChildren();
      const found = [...TEMPLATES, ...getCustomTemplates()].filter(t => (!category.value || t.categorie === category.value) && `${t.nom} ${t.description}`.toLocaleLowerCase('fr').includes(search.value.toLocaleLowerCase('fr')));
      status.textContent = `${found.length} modèle(s)`;
      for (const t of found) {
        const card = document.createElement('article'); card.dataset.template = t.id;
        const h = document.createElement('h3'); h.textContent = t.nom;
        const desc = document.createElement('p'); desc.textContent = t.description;
        const button = document.createElement('button'); button.textContent = 'Utiliser ce modèle';
        button.onclick = () => { el.close(); use(t.id); };
        card.append(h, preview(t.données()), desc, button);
        if (t.categorie === 'Mes modèles') {
          const del = document.createElement('button'); del.textContent = 'Supprimer le modèle';
          del.onclick = () => ask(`Supprimer « ${t.nom} » ?`, '', () => { removeTemplate(t.id); render(); search.focus(); announce('Modèle supprimé'); }, true);
          card.append(del);
        }
        list.append(card);
      }
    };
    category.onchange = render; search.oninput = render; render();
  });
}
