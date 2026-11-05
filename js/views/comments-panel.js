import * as state from '../state.js';
import { announce } from '../a11y/announcer.js';

let panel = null;
let body = null;
let toggleButton = null;
let showResolved = false;
let forced = null;
let returnFocus = null;
let onGoto = () => {};
const drafts = new Map();
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export function init(host, button, goto) {
  toggleButton = button;
  onGoto = goto;
  panel = document.createElement('aside');
  panel.id = 'comments-panel';
  panel.className = 'comments-panel';
  panel.setAttribute('aria-labelledby', 'comments-title');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="comments-head">
      <h2 id="comments-title" tabindex="-1">Commentaires</h2>
      <button type="button" class="comments-close" aria-label="Fermer les commentaires (Maj+C)">×</button>
    </div>
    <div class="comments-body"></div>`;
  host.appendChild(panel);
  body = panel.querySelector('.comments-body');
  panel.querySelector('.comments-close').addEventListener('click', () => close(true));
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  });
  panel.addEventListener('input', e => { if (e.target.dataset.draft) drafts.set(e.target.dataset.draft, e.target.value); });
  panel.addEventListener('submit', onSubmit);
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', e => { if (e.target.id === 'comments-show-resolved') { showResolved = e.target.checked; render(); } });
  button.addEventListener('click', () => toggle());
  state.subscribe(() => { if (!panel.hidden) render(); });
}

export function isOpen() {
  return panel && !panel.hidden;
}

export function toggle() {
  if (isOpen()) close(true); else open();
}

export function open(id = null, focusReply = false) {
  if (panel.hidden) returnFocus = document.activeElement;
  forced = id;
  panel.hidden = false;
  toggleButton.setAttribute('aria-expanded', 'true');
  render();
  const thread = id && body.querySelector(`[data-thread="${id}"]`);
  if (thread && focusReply) thread.querySelector('textarea').focus();
  else if (thread) thread.querySelector('h3').focus();
  else panel.querySelector('#comments-title').focus();
  const open = state.getComments().filter(c => !c.resolved).length;
  announce(id ? `Fil de commentaire ouvert${focusReply ? ' : saisissez votre message' : ''}` : `Panneau des commentaires ouvert, ${open} non résolu${open > 1 ? 's' : ''}`);
}

export function close(refocus) {
  if (!isOpen()) return;
  panel.hidden = true;
  forced = null;
  toggleButton.setAttribute('aria-expanded', 'false');
  if (refocus) (returnFocus?.isConnected && returnFocus !== document.body ? returnFocus : toggleButton).focus();
  announce('Panneau des commentaires fermé');
}

function targetLabel(c) {
  const t = state.getItem(c.targetId);
  return t ? `Sur ${state.getItemLabel(t)}` : 'Sur le canevas';
}

function render() {
  const active = document.activeElement;
  const restore = panel.contains(active) ? (active.id ? `#${CSS.escape(active.id)}` : active.dataset.focusKey ? `[data-focus-key="${active.dataset.focusKey}"]` : null) : null;
  const author = state.getAuthor();
  const all = state.getComments();
  const shown = all.filter(c => showResolved || !c.resolved || c.id === forced);
  const openCount = all.filter(c => !c.resolved).length;
  body.innerHTML = '';
  const who = document.createElement('div');
  who.className = 'comments-author';
  if (author) {
    who.innerHTML = `<p>Vous commentez en tant que <strong></strong>. <button type="button" class="btn-sm" data-act="rename" data-focus-key="rename">Changer de nom</button></p>`;
    who.querySelector('strong').textContent = author;
  } else {
    who.innerHTML = `<form class="author-form"><label for="comment-author">Votre nom (mémorisé sur cet appareil)</label><div class="author-row"><input id="comment-author" type="text" autocomplete="name" required><button type="submit" class="btn-sm">Enregistrer</button></div></form>`;
  }
  body.appendChild(who);
  const filter = document.createElement('label');
  filter.className = 'comments-filter';
  filter.innerHTML = `<input type="checkbox" id="comments-show-resolved" ${showResolved ? 'checked' : ''}> Afficher les commentaires résolus`;
  body.appendChild(filter);
  const summary = document.createElement('p');
  summary.className = 'comments-summary';
  summary.textContent = `${all.length} commentaire${all.length > 1 ? 's' : ''}, ${openCount} non résolu${openCount > 1 ? 's' : ''}`;
  body.appendChild(summary);
  const ol = document.createElement('ol');
  ol.className = 'comments-list';
  for (const c of shown) ol.appendChild(thread(c));
  if (!shown.length) {
    const p = document.createElement('p');
    p.className = 'comments-empty';
    p.textContent = all.length ? 'Tous les commentaires sont résolus.' : 'Aucun commentaire. Outil Commentaire (C) pour en ajouter.';
    body.appendChild(p);
  } else body.appendChild(ol);
  if (restore) body.querySelector(restore)?.focus();
}

function thread(c) {
  const li = document.createElement('li');
  const art = document.createElement('article');
  art.className = 'comment-thread' + (c.resolved ? ' is-resolved' : '') + (state.isSelected(c.id) ? ' is-selected' : '');
  art.dataset.thread = c.id;
  art.setAttribute('aria-labelledby', `ct-${c.id}`);
  const h = document.createElement('h3');
  h.id = `ct-${c.id}`;
  h.tabIndex = -1;
  h.textContent = targetLabel(c);
  const status = document.createElement('p');
  status.className = 'comment-status';
  status.textContent = `${c.resolved ? 'Résolu' : 'Non résolu'} · ${c.messages.length} message${c.messages.length > 1 ? 's' : ''}`;
  art.append(h, status);
  if (c.messages.length) {
    const msgs = document.createElement('ol');
    msgs.className = 'comment-messages';
    for (const m of c.messages) {
      const item = document.createElement('li');
      const meta = document.createElement('p');
      meta.className = 'comment-meta';
      const strong = document.createElement('strong');
      strong.textContent = m.author;
      const time = document.createElement('time');
      time.dateTime = m.date;
      time.textContent = dateFmt.format(new Date(m.date));
      meta.append(strong, ' · ', time);
      const text = document.createElement('p');
      text.textContent = m.text;
      item.append(meta, text);
      msgs.appendChild(item);
    }
    art.appendChild(msgs);
  }
  const form = document.createElement('form');
  form.className = 'comment-reply';
  form.dataset.reply = c.id;
  const label = document.createElement('label');
  label.htmlFor = `reply-${c.id}`;
  label.textContent = c.messages.length ? 'Répondre' : 'Message';
  const area = document.createElement('textarea');
  area.id = `reply-${c.id}`;
  area.rows = 2;
  area.dataset.draft = c.id;
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'btn-sm btn-primary';
  send.dataset.focusKey = `send-${c.id}`;
  send.textContent = 'Publier';
  form.append(label, area, send);
  form.querySelector('textarea').value = drafts.get(c.id) || '';
  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  for (const [act, text, cls] of [['goto', 'Aller à l’élément', 'btn-sm'], ['resolve', 'Résolu', 'btn-sm'], ['delete', 'Supprimer', 'btn-sm btn-danger']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.act = act;
    b.dataset.focusKey = `${act}-${c.id}`;
    b.textContent = text;
    if (act === 'resolve') b.setAttribute('aria-pressed', String(!!c.resolved));
    actions.appendChild(b);
  }
  art.append(form, actions);
  li.appendChild(art);
  return li;
}

function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (form.classList.contains('author-form')) {
    const name = form.querySelector('input').value.trim();
    if (!name) return;
    state.setAuthor(name);
    render();
    announce(`Nom enregistré : ${name}`);
    body.querySelector('textarea')?.focus();
    return;
  }
  const id = form.dataset.reply;
  const area = form.querySelector('textarea');
  const text = area.value.trim();
  if (!text) { announce('Message vide'); area.focus(); return; }
  if (!state.getAuthor()) { announce('Indiquez d’abord votre nom'); body.querySelector('#comment-author')?.focus(); return; }
  drafts.delete(id);
  area.value = '';
  state.postMessage(id, text);
  body.querySelector(`#reply-${CSS.escape(id)}`)?.focus();
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('[data-thread]')?.dataset.thread;
  const act = b.dataset.act;
  if (act === 'rename') { state.setAuthor(''); render(); body.querySelector('#comment-author')?.focus(); return; }
  const c = state.getItem(id);
  if (!c) return;
  forced = id;
  if (act === 'goto') onGoto(c.targetId && state.getItem(c.targetId) ? c.targetId : c.id);
  else if (act === 'resolve') state.setResolved(id, !c.resolved);
  else if (act === 'delete') {
    state.removeItems([id]);
    panel.querySelector('#comments-title').focus();
  }
}
