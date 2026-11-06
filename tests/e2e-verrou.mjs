/*
 * Connexion obligatoire, import des tableaux de l'appareil, partage (docs/verrou-et-partage.md, §5).
 * SHOTS=<dossier> écrit des captures d'écran pour relecture.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startAppServer } from './helpers/app-server.mjs';
import { signedInContext, TEST_PASSWORD, nextEmail } from './helpers/session.mjs';

const require = createRequire(import.meta.url);
const axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.SHOTS || null;
const BOARDS_KEY = 'tableau-accessible-boards';
const MIRROR_KEY = 'tableau-accessible-distants';

let passed = 0, failed = 0;
function log(label, ok, detail) {
  console.log(`[${ok ? 'OK' : 'ECHEC'}] ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) passed++; else failed++;
}

const app = await startAppServer();
const browser = await chromium.launch({ headless: true });
const BASE = app.origin;

function track(page) {
  const api = [], errors = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { api, errors };
}

async function anon(width = 1280, height = 800) {
  app.nextClient();
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  return { context, page, ...track(page) };
}

async function signed(displayName, width = 1280, height = 800) {
  const email = nextEmail();
  const context = await signedInContext(browser, app, { viewport: { width, height } }, { displayName, email });
  const page = await context.newPage();
  return { context, page, email, ...track(page) };
}

async function axe(page, label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
  log(`axe : ${label}`, res.violations.length === 0, res.violations.map(v => `${v.id} (${v.nodes[0]?.target})`).join(', '));
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `verrou-${name}.png`) }); };
const noOverflow = page => page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  const main = d ? null : document.querySelector('main');
  return document.documentElement.scrollWidth <= innerWidth && (!d || d.scrollWidth <= d.clientWidth) && (!main || main.scrollWidth <= main.clientWidth);
});
const smallTargets = (page, scope) => page.evaluate(sel => [...document.querySelectorAll(`${sel} button, ${sel} input, ${sel} select`)].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.width < 24 || r.height < 24); }).length, scope);
const sticky = (id, content, x = 40) => ({ id, type: 'sticky_note', x, y: 40, width: 150, height: 150, content, color: 'light_yellow', size: 'm' });
const localBoard = (id, nom, items = [], extra = {}) => ({ id, nom, icon: 'board', espaceId: null, créé: '2026-01-01T00:00:00.000Z', dernièreOuverture: '2026-01-01T00:00:00.000Z', favori: false, données: { name: nom, items, tags: [] }, ...extra });
const seedInit = (page, boards) => page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('semé')) { localStorage.setItem(k, v); sessionStorage.setItem('semé', '1'); } }, [BOARDS_KEY, JSON.stringify({ version: 4, tableaux: boards, espaces: [] })]);
const createBoard = (page, name, items = []) => page.evaluate(async ([n, list]) => (await (await import('/js/store/boards.js')).create(n, { name: n, items: list, tags: [] })).id, [name, items]);
const serverBoards = page => page.evaluate(async () => (await (await fetch('/api/boards')).json()).boards);
const fetchStatus = (page, id) => page.evaluate(async i => (await fetch(`/api/boards/${i}`)).status, id);
const row = (page, text) => page.locator('.boards-table tbody tr', { hasText: text });
const gateShown = page => page.getByRole('heading', { name: 'Se connecter' }).waitFor();

try {
  // === Aucune route ne montre de contenu sans session ===
  {
    console.log('--- Écran de connexion ---');
    const { context, page, api, errors } = await anon();
    await seedInit(page, [localBoard('board-1-a', 'Secret local', [sticky('item-1', 'Note secrète')])]);
    for (const route of ['#/', '#/tableau/brd_x', '#/espace/space-1', '#/favoris', '#/parcourir', '#/compte']) {
      await page.goto(`${BASE}/${route}`);
      await page.reload();
      await gateShown(page);
      const nothing = await page.evaluate(() => !document.getElementById('dashboard-title') && !document.querySelector('.canvas-item, .boards-table, dialog[open]') && document.getElementById('app-board').hidden && !document.body.innerText.includes('Secret local'));
      log(`Sans session, ${route} : connexion seule`, nothing);
    }
    log('Sans session : seul GET /api/me est demandé', api.every(a => a === 'GET /api/me'), [...new Set(api)].join(', '));
    await axe(page, 'écran de connexion');
    log('Connexion : un main et un h1', await page.locator('main:visible').count() === 1 && await page.locator('h1:visible').count() === 1);
    log('Connexion : autocomplete', await page.getByLabel('Adresse e-mail').getAttribute('autocomplete') === 'username' && await page.getByLabel('Mot de passe').getAttribute('autocomplete') === 'current-password');
    log('Connexion : focus sur le premier champ', await page.evaluate(() => document.activeElement.type === 'email'));
    for (const width of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 700 });
      log(`Connexion sans débordement à ${width} px`, await noOverflow(page));
      await shot(page, `connexion-${width}`);
    }
    await page.setViewportSize({ width: 320, height: 700 });
    log('Connexion : cibles de 24 px au moins à 320 px', await smallTargets(page, '.login-card') === 0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'high-contrast'));
    await axe(page, 'écran de connexion, contraste élevé');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await axe(page, 'écran de connexion, thème sombre');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    // Erreur reliée, alerte
    await page.getByLabel('Adresse e-mail').fill('personne@exemple.test');
    await page.getByLabel('Mot de passe').fill('mauvais mot de passe');
    await page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
    const err = page.locator('.field-error', { hasText: 'incorrect' });
    await err.waitFor();
    log('Échec : role="alert", relié au champ', await err.getAttribute('role') === 'alert' && (await page.getByLabel('Mot de passe').getAttribute('aria-describedby')).includes(await err.getAttribute('id')));
    await axe(page, 'écran de connexion avec erreur');
    log('Connexion : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Page de connexion autonome : ce que nginx sert sans session ===
  {
    console.log('--- Page autonome ---');
    const { context, page, errors } = await anon();
    const scripts = [];
    page.on('request', r => { const u = new URL(r.url()); if (u.pathname !== '/api/me' && !u.pathname.startsWith('/api/')) scripts.push(u.pathname); });
    await page.goto(`${BASE}/connexion.html#/tableau/brd_demande`);
    await gateShown(page);
    log('Autonome : ses seuls fichiers sont demandés', scripts.every(p => ['/connexion.html', '/css/connexion.css', '/js/connexion.js'].includes(p)), scripts.join(', '));
    log('Autonome : focus sur le premier champ', await page.evaluate(() => document.activeElement.type === 'email'));
    log('Autonome : autocomplete', await page.getByLabel('Adresse e-mail').getAttribute('autocomplete') === 'username' && await page.getByLabel('Mot de passe').getAttribute('autocomplete') === 'current-password');
    log('Autonome : 15 ans et confidentialité', (await page.locator('.login-footer').textContent()).includes('15 ans') && await page.locator('.login-footer a').getAttribute('href') === '/confidentialite.html');
    await axe(page, 'page de connexion autonome');
    for (const theme of ['dark', 'high-contrast']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await axe(page, `page autonome, thème ${theme}`);
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    for (const width of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 700 });
      log(`Autonome sans débordement à ${width} px`, await noOverflow(page));
      await shot(page, `autonome-${width}`);
    }
    await page.setViewportSize({ width: 320, height: 700 });
    log('Autonome : cibles de 24 px au moins à 320 px', await smallTargets(page, '.login-card') === 0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press('Enter');
    log('Autonome : erreur reliée au champ, focus dessus', await page.evaluate(() => { const a = document.activeElement; return a.type === 'email' && a.getAttribute('aria-invalid') === 'true' && !!document.getElementById(a.getAttribute('aria-describedby'))?.textContent; }));
    await page.getByLabel('Adresse e-mail').fill('personne@exemple.test');
    await page.getByLabel('Mot de passe').fill('mauvais mot de passe');
    await page.keyboard.press('Enter');
    const err = page.locator('.field-error', { hasText: 'incorrect' });
    await err.waitFor();
    log('Autonome : échec en role="alert"', await err.getAttribute('role') === 'alert');
    await axe(page, 'page autonome avec erreur');
    // Inscription au clavier : l'application s'ouvre, hash conservé
    await page.getByRole('button', { name: 'Créer un compte' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Créer un compte' }).waitFor();
    log('Autonome : autocomplete new-password', await page.getByLabel('Mot de passe').getAttribute('autocomplete') === 'new-password');
    await axe(page, 'page autonome, inscription');
    await page.keyboard.type('Dora');
    await page.keyboard.press('Tab');
    await page.keyboard.type(nextEmail());
    await page.keyboard.press('Tab');
    await page.keyboard.type(TEST_PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForURL(u => u.pathname === '/' && u.hash === '#/tableau/brd_demande');
    await page.getByRole('heading', { name: 'Tableau inaccessible' }).waitFor();
    log('Autonome : après connexion, retour à la route demandée dans l’application', true);
    // Une session déjà ouverte ne reste pas sur la page de connexion
    await page.goto(`${BASE}/connexion.html`);
    await page.waitForURL(u => u.pathname === '/');
    log('Autonome : ouverte avec une session, renvoie à l’accueil', true);
    log('Autonome : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();

    // Session valide mais page servie quand même : un seul rechargement automatique, puis un message
    const loop = await anon();
    let docs = 0;
    await loop.page.route('**/api/session', r => r.fulfill({ status: 204 }));
    await loop.page.route(u => u.pathname === '/', async r => { docs++; return r.fulfill({ response: await loop.page.request.get(`${BASE}/connexion.html`) }); });
    await loop.page.goto(`${BASE}/`);
    await loop.page.getByRole('alert').waitFor();
    log('Autonome : au plus un rechargement automatique', docs === 2, `${docs} chargements`);
    await loop.context.close();

    // Servie à la place de l'adresse : une connexion recharge la même adresse
    const served = await anon();
    await served.page.route(u => u.pathname === '/', async r => {
      const logged = (await r.request().headerValue('cookie'))?.includes('=');
      if (logged) return r.continue();
      const res = await served.page.request.get(`${BASE}/connexion.html`);
      return r.fulfill({ response: res });
    });
    await served.page.goto(`${BASE}/#/favoris`);
    await gateShown(served.page);
    await served.page.getByRole('button', { name: 'Créer un compte' }).click();
    await served.page.getByLabel('Nom affiché').fill('Eva');
    await served.page.getByLabel('Adresse e-mail').fill(nextEmail());
    await served.page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
    await served.page.getByRole('button', { name: 'Créer mon compte' }).click();
    await served.page.waitForSelector('#dashboard-title');
    log('Comme derrière nginx : même adresse et hash conservés, application chargée', served.page.url().endsWith('/#/favoris') && (await served.page.locator('#dashboard-title').textContent()) === 'Tableaux favoris');
    await served.context.close();
  }

  // === État de chargement, hash conservé, clavier seul ===
  {
    console.log('--- Chargement et route demandée ---');
    const owner = await signed('Ana');
    await owner.page.goto(`${BASE}/#/`);
    await owner.page.waitForSelector('#dashboard-title');
    const id = await createBoard(owner.page, 'Ciblé', [sticky('item-1', 'Ici')]);
    let release; const gate = new Promise(r => { release = r; });
    await owner.page.route('**/api/me', async r => { await gate; await r.continue(); });
    const goto = owner.page.goto(`${BASE}/#/tableau/${id}`).then(() => owner.page.reload({ waitUntil: 'commit' }));
    await goto;
    await owner.page.locator('[role="status"]', { hasText: 'Chargement' }).waitFor();
    log('Vérification en cours : « Chargement… », rien d’autre', await owner.page.locator('#dashboard-title, .canvas-item, .account-form').count() === 0);
    release();
    await owner.page.waitForSelector('.canvas-item[data-id="item-1"]');
    await owner.page.unroute('**/api/me');
    log('Session valable : tableau ouvert sans passer par la connexion', true);

    // Sans session : au clavier seul, connexion puis retour à la route
    await owner.page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }));
    await owner.page.evaluate(() => localStorage.clear());
    await owner.page.reload();
    await gateShown(owner.page);
    log('Hash conservé à l’écran de connexion', owner.page.url().endsWith(`#/tableau/${id}`));
    await owner.page.keyboard.type(owner.email);
    await owner.page.keyboard.press('Tab');
    await owner.page.keyboard.type(TEST_PASSWORD);
    await owner.page.keyboard.press('Enter');
    await owner.page.waitForSelector('.canvas-item[data-id="item-1"]');
    log('Clavier seul : connexion, retour au tableau demandé', owner.page.url().endsWith(`#/tableau/${id}`));
    await owner.page.waitForFunction(() => document.activeElement?.id === 'board-title');
    log('Après la connexion : focus sur le titre du tableau', true);
    await owner.context.close();
  }

  // === Hors ligne ===
  {
    console.log('--- Hors ligne ---');
    const { context, page, errors } = await signed('Hors ligne');
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const id = await createBoard(page, 'Dans le miroir', [sticky('item-1', 'Copie')]);
    await page.waitForTimeout(100);
    const noMirror = await anon();
    await page.waitForTimeout(1200);
    await app.stopBackend();
    // Onglet déjà ouvert : un nouveau chargement exige le serveur (nginx sert alors connexion.html en 503, voir plus bas).
    await page.evaluate(i => { location.hash = `#/tableau/${i}`; }, id);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    log('Hors ligne, onglet ouvert, avec miroir : le tableau s’ouvre', await page.locator('.login-screen').count() === 0);
    log('Hors ligne, onglet ouvert : message visible', (await page.locator('#app-notices').textContent()).includes('injoignable') || (await page.locator('#app-notices').textContent()).includes('copie de cet appareil'));
    await page.evaluate(() => { location.hash = '#/'; });
    await row(page, 'Dans le miroir').waitFor();
    log('Hors ligne, onglet ouvert : tableau de bord utilisable', true);
    // Page autonome, serveur arrêté : message et bouton, pas de formulaire
    const down = await anon();
    await down.page.goto(`${BASE}/connexion.html`);
    const alert = down.page.getByRole('alert');
    await alert.waitFor();
    log('Autonome, serveur arrêté : message clair en alerte', (await alert.textContent()).includes('Baro est momentanément indisponible. Vos données ne sont pas perdues.'));
    log('Autonome, serveur arrêté : pas de formulaire actif', await down.page.locator('form, input').count() === 0);
    await axe(down.page, 'page autonome, Baro indisponible');
    await shot(down.page, 'indisponible');
    await noMirror.page.goto(BASE);
    await gateShown(noMirror.page);
    const text = await noMirror.page.locator('.login-screen').textContent();
    log('Hors ligne sans miroir : message clair, pas d’écran vide', text.includes('Serveur injoignable'));
    log('Hors ligne sans miroir : bouton Réessayer', await noMirror.page.getByRole('button', { name: 'Réessayer' }).count() === 1);
    await axe(noMirror.page, 'connexion, serveur injoignable');
    await shot(noMirror.page, 'injoignable');
    await app.startBackend();
    await noMirror.page.getByRole('button', { name: 'Réessayer' }).click();
    await noMirror.page.waitForFunction(() => !document.querySelector('.login-screen')?.textContent.includes('injoignable'));
    log('Réessayer : le message disparaît, la saisie reste possible', await noMirror.page.getByLabel('Adresse e-mail').count() === 1);
    log('Hors ligne : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await down.page.getByRole('button', { name: 'Réessayer' }).click();
    await down.page.getByLabel('Adresse e-mail').waitFor();
    log('Autonome : Réessayer au retour du serveur rend le formulaire', true);
    await down.context.close();
    await noMirror.context.close();
    await context.close();
  }

  // === Import ===
  {
    console.log('--- Import ---');
    const { context, page, api, errors } = await signed('Importatrice');
    const seed = [
      localBoard('board-1-un', 'Un', [sticky('item-1', 'Accentué : été')]),
      localBoard('board-1-deux', 'Deux', [sticky('item-1', 'a'), sticky('item-2', 'b', 300)]),
      localBoard('board-1-refus', 'Refusé'),
      localBoard('board-1-decoche', 'Décoché'),
      localBoard('board-1-autre', 'Travail d’un autre', [], { réservéÀ: 'usr_autre' })
    ];
    await seedInit(page, seed);
    await page.goto(`${BASE}/#/`);
    const dlg = page.locator('.import-dialog');
    await dlg.waitFor();
    await page.getByRole('heading', { name: 'Importer vos tableaux de cet appareil' }).waitFor();
    log('Dialogue : nom et nombre d’objets', (await dlg.textContent()).includes('Deux (2 objets)') && (await dlg.textContent()).includes('Un (1 objet)'));
    log('Dialogue : cases cochées par défaut', await page.evaluate(() => [...document.querySelectorAll('.import-dialog input[type=checkbox]')].every(i => i.checked)));
    log('Dialogue : le travail réservé à un autre compte n’apparaît pas', !(await dlg.textContent()).includes('Travail d’un autre'));
    log('Tableaux locaux : jamais dans le tableau de bord', !(await page.locator('#app-dashboard').textContent()).includes('Décoché'));
    await axe(page, 'dialogue d’import');
    await shot(page, 'import');
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      log(`Import sans débordement à ${width} px`, await noOverflow(page));
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Plus tard : mémorisé
    await page.getByRole('button', { name: 'Plus tard' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.reload();
    await page.waitForSelector('#dashboard-title');
    await page.waitForTimeout(400);
    log('Plus tard : mémorisé, le dialogue ne revient pas', await dlg.count() === 0);
    log('Plus tard : rien d’envoyé', !api.includes('POST /api/boards') && (await serverBoards(page)).length === 0);

    // Depuis « Mon compte » ; refus d'un tableau ; un décoché
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Importer vos tableaux de cet appareil…' }).click();
    await dlg.waitFor();
    await page.getByRole('checkbox', { name: /Décoché/ }).uncheck();
    const refusal = 'Vous avez atteint la limite de 100 tableaux.';
    await page.route('**/api/boards', async r => {
      if (r.request().method() === 'POST' && r.request().postDataJSON().name === 'Refusé') return r.fulfill({ status: 403, json: { code: 'quota_exceeded', message: refusal } });
      return r.continue();
    });
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const results = await page.locator('.import-results').textContent();
    log('Compte rendu : réussi et refusé avec la raison', results.includes('Un : importé') && results.includes('Deux : importé') && results.includes('Refusé : refusé') && results.includes(refusal));
    log('Compte rendu : 2 importés, 1 refusé', (await dlg.locator('[role="status"]').textContent()).includes('2 tableaux importés, 1 refusé'));
    await axe(page, 'compte rendu de l’import');
    await shot(page, 'import-resultat');
    let local = JSON.parse(await page.evaluate(k => localStorage.getItem(k), BOARDS_KEY)).tableaux;
    log('Import : rien supprimé de l’appareil sans clic', local.length === 5);
    log('Import : aucun bouton de suppression pour un refus', await page.getByRole('button', { name: 'Supprimer de cet appareil : Refusé' }).count() === 0);
    await page.unroute('**/api/boards');
    const names = (await serverBoards(page)).map(b => b.name).sort().join();
    log('Import : sur le compte', names === 'Deux,Un', names);
    await page.getByRole('button', { name: 'Supprimer de cet appareil : Un' }).click();
    local = JSON.parse(await page.evaluate(k => localStorage.getItem(k), BOARDS_KEY)).tableaux;
    log('Supprimer de cet appareil : après un clic seulement', !local.some(b => b.id === 'board-1-un') && local.some(b => b.id === 'board-1-deux'));

    // Second passage : pas de doublon
    await page.getByRole('button', { name: 'Terminer' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Importer vos tableaux de cet appareil…' }).click();
    await dlg.waitFor();
    const second = await dlg.textContent();
    log('Second passage : les importés ne sont plus proposés', await page.getByRole('checkbox', { name: /Deux/ }).count() === 0 && second.includes('Déjà importés'));
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const after = (await serverBoards(page)).map(b => b.name).sort().join();
    log('Second passage : pas de doublon', after === 'Deux,Décoché,Refusé,Un', after);
    await page.getByRole('button', { name: 'Terminer' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.account-dialog', { state: 'detached' });
    await page.reload();
    await page.waitForSelector('#dashboard-title');
    await page.waitForTimeout(400);
    log('Rechargement : plus rien à proposer, pas de dialogue', await dlg.count() === 0);
    log('Import : contenu accentué préservé', await page.evaluate(async () => {
      const list = (await (await fetch('/api/boards')).json()).boards;
      const un = list.find(b => b.name === 'Un');
      return (await (await fetch(`/api/boards/${un.id}`)).json()).board.items[0].content === 'Accentué : été';
    }));
    log('Import : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Partage ===
  {
    console.log('--- Partage ---');
    const owner = await signed('Ana');
    const guest = await signed('Bruno');
    const other = await signed('Carole');
    const { page } = owner;
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const id = await createBoard(page, 'Atelier <b>partagé</b>', [sticky('item-1', 'Texte d’Ana'), sticky('item-2', 'Autre', 300)]);
    await page.goto(`${BASE}/#/parcourir`);
    await page.reload();
    await row(page, 'Atelier').getByRole('button', { name: /Partager…/ }).click();
    const share = page.locator('.share-dialog');
    await share.locator('.share-list').first().waitFor();
    log('Partager : texte explicite', (await share.textContent()).includes('Aucun e-mail n’est envoyé : prévenez la personne, elle verra l’invitation en se connectant avec cette adresse.'));
    log('Partager : le propriétaire est listé', (await share.locator('.share-list').first().textContent()).includes('Ana (vous)'));

    // Au clavier seul
    await page.getByLabel('Adresse e-mail de la personne').focus();
    await page.keyboard.type('adresse invalide');
    await page.keyboard.press('Enter');
    log('Adresse invalide : erreur reliée, focus sur le champ', await page.evaluate(() => document.activeElement.type === 'email' && document.activeElement.getAttribute('aria-invalid') === 'true'));
    await page.keyboard.press('Control+a');
    await page.keyboard.type(guest.email);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await share.getByText(`${guest.email} : Peut lire`).waitFor();
    log('Clavier seul : invitation créée en lecture', await page.evaluate(() => document.activeElement.type === 'email'));
    await page.getByLabel('Adresse e-mail de la personne').fill(other.email);
    await page.getByRole('button', { name: 'Inviter' }).click();
    await share.getByText(`${other.email} : Peut modifier`).waitFor();
    await page.getByLabel('Adresse e-mail de la personne').fill('annulee@exemple.test');
    await page.getByRole('button', { name: 'Inviter' }).click();
    await share.getByText('annulee@exemple.test : Peut modifier').waitFor();
    await page.getByRole('button', { name: 'Annuler l’invitation de annulee@exemple.test' }).click();
    await share.getByText('annulee@exemple.test : Peut modifier').waitFor({ state: 'detached' });
    log('Invitation annulée', true);
    await axe(page, 'dialogue de partage');
    await shot(page, 'partage');
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      log(`Partage sans débordement à ${width} px`, await noOverflow(page));
    }
    await page.setViewportSize({ width: 320, height: 700 });
    log('Partage : cibles de 24 px au moins à 320 px', await smallTargets(page, '.share-dialog') === 0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await share.locator('.dialog-header button').click();

    // Invitation : bandeau, axe, nom non interprété
    await guest.page.goto(`${BASE}/#/`);
    const banner = guest.page.locator('#invites-section');
    await banner.waitFor();
    log('Invitations : nombre annoncé (role=status)', await guest.page.locator('#invites-count').getAttribute('role') === 'status' && (await guest.page.locator('#invites-count').textContent()).includes('1 invitation en attente'));
    log('Invitations : invitant et rôle affichés', (await banner.textContent()).includes('Ana') && (await banner.textContent()).includes('Peut lire'));
    log('Invitations : nom du tableau jamais interprété', await banner.locator('strong b').count() === 0 && (await banner.locator('strong').textContent()).includes('<b>'));
    log('Avant acceptation : tableau inaccessible (404)', await fetchStatus(guest.page, id) === 404);
    await axe(guest.page, 'liste des invitations');
    await shot(guest.page, 'invitations');
    for (const width of [320, 768, 1280]) {
      await guest.page.setViewportSize({ width, height: 700 });
      log(`Invitations sans débordement à ${width} px`, await noOverflow(guest.page));
    }
    await guest.page.setViewportSize({ width: 1280, height: 800 });
    await guest.page.getByRole('button', { name: /Accepter l’invitation/ }).focus();
    await guest.page.keyboard.press('Enter');
    const sharedRow = guest.page.locator('#shared-section tr', { hasText: 'Atelier' });
    await sharedRow.waitFor();
    log('Acceptation : section « Partagés avec moi »', await guest.page.getByRole('heading', { name: 'Partagés avec moi' }).count() === 1);
    log('Acceptation : badge de rôle et propriétaire', (await sharedRow.locator('.board-badge').textContent()) === 'Lecture seule' && (await sharedRow.textContent()).includes('De Ana'));
    log('Acceptation : bandeau retiré, focus sur le tableau', await banner.count() === 0 && await guest.page.evaluate(() => !!document.activeElement.closest('#shared-section')));
    log('Invité : ni renommer, ni supprimer, ni partager', await sharedRow.getByRole('button', { name: /^(Renommer|Supprimer|Partager)/ }).count() === 0);
    log('Invité : « Quitter le tableau » proposé', await sharedRow.getByRole('button', { name: /Quitter le tableau/ }).count() === 1);
    await axe(guest.page, 'tableau de bord avec partagés');

    // Refus par un autre compte
    await other.page.goto(`${BASE}/#/`);
    await other.page.locator('#invites-section').waitFor();
    log('Invitation : visible par la bonne adresse seulement', (await other.page.locator('#invites-section').textContent()).includes('Peut modifier'));
    await other.page.getByRole('button', { name: /Refuser l’invitation/ }).click();
    await other.page.locator('#invites-section').waitFor({ state: 'detached' });
    log('Refus : le tableau reste inaccessible', await fetchStatus(other.page, id) === 404 && await other.page.locator('#shared-section').count() === 0);

    // Lecture seule vraiment non éditable
    const g = guest.page;
    guest.api.length = 0;
    await g.goto(`${BASE}/#/tableau/${id}`);
    await g.waitForSelector('.canvas-item[data-id="item-1"]');
    log('Lecture seule : message persistant', await g.locator('#board-readonly').isVisible() && (await g.locator('#board-readonly').textContent()) === 'Lecture seule');
    const hidden = await g.evaluate(() => ['btn-sticky', 'btn-shape', 'btn-line', 'btn-text', 'btn-card', 'btn-frame', 'btn-more-tools', 'btn-link', 'btn-duplicate', 'btn-lock', 'btn-undo', 'btn-import', 'btn-share'].filter(id => document.getElementById(id).offsetParent !== null));
    log('Lecture seule : outils d’écriture retirés', hidden.length === 0, hidden.join(','));
    log('Lecture seule : outils de lecture présents', await g.locator('#btn-zoom-in').isVisible() && await g.locator('#btn-search').isVisible() && await g.locator('#btn-leave').isVisible());
    await axe(g, 'tableau en lecture seule');
    await shot(g, 'lecture-seule');
    const snap = () => g.evaluate(async () => JSON.stringify((await import('/js/state.js')).getSnapshot()));
    const before = await snap();
    const it = g.locator('.canvas-item[data-id="item-1"]').first();
    await it.focus();
    for (const key of ['Control+d', 'Delete', 'ArrowRight', 'Control+x', 'Control+v', 'Control+Shift+l', 'Control+g', 'PageUp', 'Control+z', 'Control+Backspace', 'Enter', 'F2', 'n', 'Enter', 't', 'Enter', 'Shift+Tab']) {
      await g.keyboard.press(key);
      await g.keyboard.press('Escape').catch(() => {});
    }
    log('Lecture seule : aucun raccourci ne change le tableau', await snap() === before);
    log('Lecture seule : pas d’éditeur ouvert', await g.locator('.inline-editor').count() === 0);
    await it.click();
    log('Lecture seule : aucune barre de mise en forme ni poignée', await g.locator('.context-toolbar:not([hidden])').count() === 0 && await g.locator('[data-handle], [data-link]').count() === 0);
    const box = await it.boundingBox();
    await g.mouse.move(box.x + 30, box.y + 30);
    await g.mouse.down();
    await g.mouse.move(box.x + 130, box.y + 130, { steps: 4 });
    await g.mouse.up();
    await it.dblclick();
    log('Lecture seule : glisser et double-cliquer ne changent rien', await snap() === before && await g.locator('.inline-editor').count() === 0);
    await it.click({ button: 'right' });
    const menu = await g.locator('.canvas-menu').textContent();
    log('Lecture seule : menu contextuel sans écriture', menu.includes('Copier') && !/Supprimer|Couper|Dupliquer|Verrouiller/.test(menu), menu.slice(0, 80));
    await g.keyboard.press('Escape');
    await g.locator('#board-title').click();
    log('Lecture seule : titre non renommable', await g.locator('#board-title-input').count() === 0);
    await g.locator('#tab-table').click();
    log('Vue Tableau : ni Éditer ni Supprimer', await g.locator('#view-table').getByRole('button', { name: /^(Éditer|Supprimer)$/ }).count() === 0 && (await g.locator('#view-table').textContent()).includes('Texte d’Ana'));
    await g.locator('#tab-outline').click();
    log('Vue Plan : contenu lisible', (await g.locator('#view-outline').textContent()).includes('Texte d’Ana'));
    await g.locator('#tab-canvas').click();
    await g.waitForTimeout(3500);
    log('Lecture seule : aucun PUT émis', !guest.api.some(a => a.startsWith('PUT') || a.startsWith('PATCH')), guest.api.filter(a => !a.startsWith('GET')).join(','));
    const direct = await g.evaluate(async i => (await fetch(`/api/boards/${i}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: 0, data: { name: 'x', items: [] } }) })).status, id);
    log('Le serveur reste l’autorité : PUT direct refusé (403)', direct === 403);
    log('Lecture seule : mobile 320 px sans débordement', await (async () => { await g.setViewportSize({ width: 320, height: 640 }); const ok = await g.evaluate(() => document.documentElement.scrollWidth <= innerWidth); await g.setViewportSize({ width: 1280, height: 800 }); return ok; })());

    // Le propriétaire donne le droit d'écrire
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    log('Vue tableau : « Partager… » pour le propriétaire', await page.locator('#btn-share').isVisible() && await page.locator('#btn-leave').isHidden());
    await page.click('#btn-share');
    await page.getByLabel('Rôle de Bruno').waitFor();
    await page.getByLabel('Rôle de Bruno').selectOption('editor');
    await page.waitForFunction(() => document.getElementById('announcer')?.textContent || document.querySelector('.share-dialog [data-announcer]')?.textContent);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Rôle de Bruno');
    log('Changement de rôle : focus gardé sur la liste', true);
    await page.locator('.share-dialog .dialog-header button').click();
    await g.goto(`${BASE}/#/`);
    await g.locator('#shared-section tr', { hasText: 'Atelier' }).locator('.board-badge', { hasText: 'Peut modifier' }).waitFor();
    await g.goto(`${BASE}/#/tableau/${id}`);
    await g.waitForSelector('.canvas-item[data-id="item-1"]');
    log('Éditeur : plus de lecture seule', await g.locator('#board-readonly').isHidden() && await g.locator('#btn-sticky').isVisible());
    await g.locator('.canvas-item[data-id="item-1"]').first().focus();
    await g.keyboard.press('Control+d');
    await g.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.endsWith('/data')), null, { timeout: 6000 });
    await g.waitForTimeout(300);
    log('Éditeur : son écriture arrive sur le serveur', (await g.evaluate(async i => (await (await fetch(`/api/boards/${i}`)).json()).board.items.length, id)) === 3);
    const manage = await g.evaluate(async i => [(await fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@exemple.test', role: 'viewer' }) })).status, (await fetch(`/api/boards/${i}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })).status], id);
    log('Éditeur : ne gère pas le partage et ne supprime pas', manage.join() === '403,403', manage.join());

    // Droit retiré pendant l'édition : le travail non envoyé part dans une copie
    await g.locator('.canvas-item[data-id="item-1"]').first().focus();
    await g.route('**/api/boards/*/data', r => r.abort());
    await g.keyboard.press('Control+d');
    await g.waitForFunction(i => { const m = JSON.parse(localStorage.getItem('tableau-accessible-distants') || 'null'); return true; }, id);
    await g.waitForTimeout(200);
    const guestId = (await g.evaluate(async () => (await import('/js/store/account.js')).getUser().id));
    await page.evaluate(async ([i, u]) => fetch(`/api/boards/${i}/members/${u}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }), [id, guestId]);
    await g.unroute('**/api/boards/*/data');
    await g.evaluate(async () => (await import('/js/store/account.js')).refreshBoards());
    await g.locator('.notice-error', { hasText: 'plus accès' }).waitFor({ timeout: 8000 });
    await g.locator('.notice-error', { hasText: 'gardées dans la copie' }).waitFor({ timeout: 8000 });
    log('Accès retiré : message et lecture seule', await g.locator('#board-readonly').isVisible());
    const copyRow = (await serverBoards(g)).find(b => b.name.includes('Atelier') && b.role === 'owner');
    log('Accès retiré : copie sur le compte, avec le travail non envoyé', !!copyRow && (await g.evaluate(async i => (await (await fetch(`/api/boards/${i}`)).json()).board.items.length, copyRow.id)) === 4);
    log('Accès retiré : le tableau répond 404', await fetchStatus(g, id) === 404);
    await g.getByRole('button', { name: 'Ouvrir la copie' }).click();
    await g.waitForFunction(() => document.getElementById('board-readonly').hidden && location.hash.includes('brd_'));
    log('Ouvrir la copie : modifiable', await g.locator('#btn-sticky').isVisible());

    // Quitter
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const inv = await page.evaluate(async ([i, mail]) => (await fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, role: 'viewer' }) })).status, [id, other.email]);
    log('Nouvelle invitation', inv === 201);
    await other.page.reload();
    await other.page.getByRole('button', { name: /Accepter l’invitation/ }).click();
    const leaving = other.page.locator('#shared-section tr', { hasText: 'Atelier' });
    await leaving.waitFor();
    await leaving.getByRole('button', { name: /Quitter le tableau/ }).click();
    await other.page.locator('dialog[open]').getByRole('button', { name: 'Quitter le tableau' }).click();
    await leaving.waitFor({ state: 'detached' });
    log('Quitter : retiré de la liste, plus d’accès', await fetchStatus(other.page, id) === 404);
    await owner.context.close();
    await guest.context.close();
    await other.context.close();
  }

  // === Séparation entre comptes sur un même appareil ===
  {
    console.log('--- Comptes sur un même appareil ---');
    const { context, page } = await signed('Ana');
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    await createBoard(page, 'Tableau d’Ana', [sticky('item-1', 'A')]);
    await page.click('#btn-create-space');
    await page.locator('dialog[open] input').fill('Espace d’Ana');
    await page.locator('dialog[open] form button').first().click();
    await page.waitForFunction(() => document.querySelector('.space-row a')?.textContent === 'Espace d’Ana');
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await gateShown(page);
    log('Déconnexion : plus rien du compte dans la page', !(await page.evaluate(() => document.body.innerText)).includes('Ana'));
    const email = nextEmail();
    await page.getByRole('button', { name: 'Créer un compte' }).click();
    await page.getByLabel('Nom affiché').fill('Bruno');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForSelector('#dashboard-title');
    const text = await page.locator('#app-dashboard').textContent();
    log('Autre compte : ni tableau ni espace du précédent', !text.includes('Tableau d’Ana') && !text.includes('Espace d’Ana'));
    log('Autre compte : le miroir ne garde rien du précédent', !(await page.evaluate(k => localStorage.getItem(k) || '', MIRROR_KEY)).includes('Tableau d’Ana'));
    await context.close();
  }
} catch (err) {
  log('Exception', false, err.stack || err.message);
} finally {
  await browser.close();
  await app.close();
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
