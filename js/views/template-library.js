import { TEMPLATES, CATEGORIES, getCustomTemplates, removeTemplate, setTemplateShared, getTemplate, markUsed, getUsage } from '../store/templates.js';
import { dialog, ask } from '../ui/dialog.js';
import { announce } from '../a11y/announcer.js';
import { getPref, setPref } from '../preferences.js';
import { preview, describeContent } from './template-preview.js';

const USE_CASES = CATEGORIES.filter(c => c !== 'Mes modèles');
const SECTIONS = {
  all: { title: 'Tous les modèles', filter: () => true },
  community: { title: 'Communauté', filter: t => t.partage },
  mine: { title: 'Mes modèles', filter: t => t.categorie === 'Mes modèles' },
  formats: { title: 'Formats', filter: t => !!t.format, tagsOf: t => (t.format ? [t.format] : []) }
};
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
const authorOf = t => (t.categorie === 'Mes modèles' ? 'Vous' : 'DWES');
const sectionOf = key => (key.startsWith('cat:') ? { title: key.slice(4), filter: t => t.categorie === key.slice(4) } : SECTIONS[key]);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function make(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

export function openLibrary(use) {
  const view = { section: 'all', tag: '', sort: 'recommended', query: '', previewId: null };
  let root, main, status, searchInput;

  const allTemplates = () => [...TEMPLATES, ...getCustomTemplates()];
  const choose = id => { markUsed(id); root.close(); use(id); };

  const found = () => {
    const q = fold(view.query.trim());
    const section = q ? SECTIONS.all : sectionOf(view.section);
    let list = allTemplates().filter(section.filter);
    if (q) list = list.filter(t => fold(`${t.nom} ${t.categorie} ${t.description} ${(t.tags || []).join(' ')} ${t.format || ''}`).includes(q));
    const tagsOf = section.tagsOf || (t => t.tags || []);
    if (view.tag && !q) list = list.filter(t => tagsOf(t).includes(view.tag));
    const order = allTemplates().map(t => t.id);
    if (view.sort === 'name') list.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    else if (view.sort === 'recent') {
      const usage = getUsage();
      list.sort((a, b) => (usage[b.id] || b.créé || 0) - (usage[a.id] || a.créé || 0) || order.indexOf(b.id) - order.indexOf(a.id));
    } else list.sort((a, b) => (b.recommande ? 1 : 0) - (a.recommande ? 1 : 0) || order.indexOf(a.id) - order.indexOf(b.id));
    return list;
  };

  const select = key => {
    view.section = key;
    view.tag = '';
    view.query = '';
    searchInput.value = '';
    view.previewId = null;
    root.querySelectorAll('[data-section]').forEach(b => {
      if (b.dataset.section === key) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    root.querySelector('.store-nav-toggle').textContent = `Catégories : ${sectionOf(key).title}`;
    if (matchMedia('(max-width: 640px)').matches) toggleNav(false);
    renderMain();
    announce(`${sectionOf(key).title} : ${plural(found().length, 'modèle')}`);
  };

  const toggleNav = open => {
    const toggle = root.querySelector('.store-nav-toggle');
    root.querySelector('.store-nav').classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  const useButton = t => make('button', { type: 'button', class: 'btn-primary store-use', text: 'Utiliser le modèle', 'aria-label': `Utiliser le modèle ${t.nom}`, onclick: () => choose(t.id) });

  const card = t => {
    const data = t.données();
    const hover = make('div', { class: 'store-hover' },
      make('p', { text: t.description }),
      make('div', { class: 'store-hover-actions' }, useButton(t), make('button', { type: 'button', class: 'store-preview-btn', text: 'Aperçu', 'aria-label': `Aperçu de ${t.nom}`, onclick: () => { view.previewId = t.id; renderMain(); } }))
    );
    const thumb = make('div', { class: 'store-thumb' }, preview({ ...data, name: t.nom }), hover);
    const node = make('article', { class: 'store-card', 'data-template': t.id }, thumb, make('div', { class: 'store-meta' }, make('span', { class: 'store-author', text: authorOf(t) }), make('h4', { text: t.nom })));
    if (t.categorie === 'Mes modèles') {
      node.append(make('div', { class: 'store-own' },
        make('button', { type: 'button', text: 'Partageable', 'aria-pressed': String(!!t.partage), 'aria-label': `Partageable : ${t.nom}`, onclick: () => { setTemplateShared(t.id, !t.partage); renderMain(); announce(t.partage ? 'Modèle retiré des partageables' : 'Modèle marqué comme partageable'); root.querySelector(`[data-template="${t.id}"] .store-own button`)?.focus(); } }),
        make('button', { type: 'button', text: 'Supprimer le modèle', 'aria-label': `Supprimer le modèle ${t.nom}`, onclick: () => ask(`Supprimer « ${t.nom} » ?`, '', () => { removeTemplate(t.id); renderMain(); searchInput.focus(); announce('Modèle supprimé'); }, true) })
      ));
    }
    return node;
  };

  const renderPreview = t => {
    const data = t.données();
    const back = make('button', { type: 'button', class: 'store-back', text: '← Retour à la liste', onclick: () => backToList(t.id) });
    const heading = make('h3', { tabindex: '-1', text: t.nom });
    main.replaceChildren(make('div', { class: 'store-detail' },
      back, heading,
      make('div', { class: 'store-large' }, preview({ ...data, name: t.nom }, { width: 800, large: true })),
      make('p', { text: t.description }),
      make('dl', { class: 'store-facts' },
        make('dt', { text: 'Éléments' }), make('dd', { text: `${data.items.length} (${describeContent(data.items)})` }),
        make('dt', { text: 'Catégorie' }), make('dd', { text: t.categorie }),
        make('dt', { text: 'Auteur' }), make('dd', { text: authorOf(t) })),
      useButton(t)
    ));
    heading.focus();
    announce(`Aperçu de ${t.nom}`);
  };

  const backToList = id => {
    view.previewId = null;
    renderMain();
    root.querySelector(`[data-template="${id}"] .store-preview-btn`)?.focus();
  };

  const renderMain = () => {
    if (view.previewId) { const t = getTemplate(view.previewId); if (t) { renderPreview(t); return; } view.previewId = null; }
    const searching = !!view.query.trim();
    const section = searching ? { title: `Résultats pour « ${view.query.trim()} »` } : sectionOf(view.section);
    const list = found();
    const head = make('div', { class: 'store-head' });
    head.append(make('h3', { text: section.title }));
    status = make('p', { class: 'store-count', role: 'status', text: plural(list.length, 'modèle') });
    head.append(status);
    const sort = make('select', { id: 'store-sort' });
    [['recommended', 'Recommandés'], ['name', 'Nom A-Z'], ['recent', 'Récents']].forEach(([v, name]) => sort.add(new Option(name, v, v === view.sort, v === view.sort)));
    sort.onchange = () => { view.sort = sort.value; renderMain(); root.querySelector('#store-sort').focus(); announce(`Tri : ${sort.options[sort.selectedIndex].text}`); };
    head.append(make('label', { class: 'store-sort', for: 'store-sort', text: 'Trier par' }), sort);
    const blocks = [head];
    const pool = searching ? [] : allTemplates().filter(sectionOf(view.section).filter);
    const tagsOf = sectionOf(view.section).tagsOf || (t => t.tags || []);
    const tags = [...new Set(pool.flatMap(tagsOf))];
    if (tags.length > 1 && !['all', 'community', 'mine'].includes(view.section)) {
      blocks.push(make('div', { class: 'store-pills', role: 'group', 'aria-label': 'Filtrer' }, ...['', ...tags].map(tag => make('button', {
        type: 'button', class: 'store-pill', text: tag || 'Tout', 'data-tag': tag, 'aria-pressed': String(view.tag === tag),
        onclick: () => { view.tag = tag; renderMain(); root.querySelector(`.store-pill[data-tag="${CSS.escape(tag)}"]`)?.focus(); announce(`${tag || 'Tout'} : ${plural(found().length, 'modèle')}`); }
      }))));
    }
    if (view.section === 'community' && !searching) {
      blocks.push(make('p', { class: 'store-notice', id: 'store-community-note', text: 'La publication de modèles par la communauté arrivera avec le serveur. Pour l’instant, cette page présente les modèles partageables disponibles sur cet appareil : ceux de DWES et les vôtres marqués « Partageable ». Rien n’est envoyé.' }));
    }
    if (list.length) blocks.push(make('div', { class: 'store-grid' }, ...list.map(card)));
    else blocks.push(make('p', { class: 'store-empty', text: searching ? 'Aucun modèle ne correspond à la recherche.' : view.section === 'mine' ? 'Aucun modèle personnel. Dans un tableau, choisissez « Enregistrer comme modèle ».' : 'Aucun modèle dans cette catégorie.' }));
    main.replaceChildren(...blocks);
  };

  root = dialog('Boutique de modèles', el => {
    el.classList.add('template-store');
    searchInput = make('input', { id: 'store-search', type: 'search', placeholder: 'Rechercher par nom ou catégorie', 'aria-label': 'Rechercher par nom ou catégorie', autocomplete: 'off' });
    searchInput.oninput = () => { view.query = searchInput.value; view.previewId = null; renderMain(); };
    const onCreate = make('input', { id: 'store-on-create', type: 'checkbox' });
    onCreate.checked = getPref('storeOnCreate');
    onCreate.onchange = () => { setPref('storeOnCreate', onCreate.checked); announce(onCreate.checked ? 'La boutique s’ouvrira à la création d’un tableau' : 'Dialogue simple à la création d’un tableau'); };
    const top = make('div', { class: 'store-top' }, searchInput,
      make('label', { class: 'store-check', for: 'store-on-create' }, onCreate, 'Afficher à la création d’un tableau'),
      make('button', { type: 'button', id: 'store-blank', class: 'store-blank', text: 'Tableau vierge', onclick: () => choose('vierge') }));
    const navItem = (key, text) => make('li', {}, make('button', { type: 'button', 'data-section': key, text, onclick: () => select(key) }));
    const nav = make('nav', { class: 'store-nav', 'aria-label': 'Catégories de modèles' },
      make('ul', {}, navItem('all', 'Tous les modèles'), navItem('community', 'Communauté'), navItem('mine', 'Mes modèles')),
      make('h3', { text: 'Cas d’usage' }), make('ul', {}, ...USE_CASES.map(c => navItem(`cat:${c}`, c))),
      make('h3', { text: 'Types' }), make('ul', {}, navItem('formats', 'Formats')));
    const toggle = make('button', { type: 'button', class: 'store-nav-toggle', 'aria-expanded': 'false', text: 'Catégories : Tous les modèles', onclick: () => toggleNav(!nav.classList.contains('is-open')) });
    main = make('main', { class: 'store-main', tabindex: '-1' });
    main.setAttribute('role', 'region');
    main.setAttribute('aria-label', 'Modèles');
    el.append(top, toggle, make('div', { class: 'store-body' }, nav, main));
    el.addEventListener('cancel', e => { if (view.previewId) { e.preventDefault(); backToList(view.previewId); } });
    nav.querySelector('[data-section="all"]').setAttribute('aria-current', 'true');
  });
  renderMain();
  searchInput.focus();
  return root;
}
