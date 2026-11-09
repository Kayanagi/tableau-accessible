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
    // Le focus va au champ, qui lit l'erreur par aria-describedby : pas d'alerte en plus, qui la ferait lire deux fois.
    log('Échec : relié au champ, focus dessus, lu une seule fois', await err.getAttribute('role') === null && await page.evaluate(id => { const a = document.activeElement; return a.type === 'password' && a.getAttribute('aria-invalid') === 'true' && a.getAttribute('aria-describedby').split(' ').includes(id); }, await err.getAttribute('id')));
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
    // Entrée dans le champ : le focus ne bouge pas, l'erreur est donc annoncée (et une seule fois : pas de role="alert").
    const heardError = await page.waitForFunction(() => document.getElementById('announcer').textContent.includes('incorrect'), null, { timeout: 3000 }).then(() => true, () => false);
    log('Autonome : échec annoncé une fois, relié au champ', heardError && await err.getAttribute('role') === null && (await page.getByLabel('Mot de passe').getAttribute('aria-describedby')).includes(await err.getAttribute('id')));
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
    log('Compte rendu : 2 importés, 1 refusé', (await dlg.locator('.import-summary').textContent()).includes('2 tableaux importés, 1 refusé'));
    // Une seule annonce : le résumé passe par l'annonceur, il n'est pas en plus une zone role="status" insérée remplie.
    log('Compte rendu : annoncé une fois, sans role="status" rempli à l’insertion', await dlg.locator('.import-summary').getAttribute('role') === null && await page.waitForFunction(() => document.querySelector('.import-dialog [data-announcer]')?.textContent.includes('2 tableaux importés, 1 refusé'), null, { timeout: 3000 }).then(() => true, () => false));
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
    const hidden = await g.evaluate(() => ['btn-sticky', 'btn-shape', 'btn-line', 'btn-text', 'btn-card', 'btn-frame', 'btn-more-tools', 'btn-link', 'btn-duplicate', 'btn-lock', 'btn-undo', 'btn-share'].filter(id => document.getElementById(id).offsetParent !== null));
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
    await g.waitForFunction(() => performance.getEntriesByType('resource').some(e => /\/boards\/[^/]+\/data$/.test(e.name)), null, { timeout: 6000 });
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

  // === Lecture seule au clavier : kanban et tableau de données ===
  {
    console.log('--- Lecture seule au clavier ---');
    const owner = await signed('Ana');
    const viewer = await signed('Bruno');
    await owner.page.goto(`${BASE}/#/`);
    await owner.page.waitForSelector('#dashboard-title');
    const kb = { id: 'kb', type: 'kanban', x: 100, y: 100, content: 'Sprint', columns: [{ id: 'c1', name: 'À faire', cards: [{ id: 'k1', text: 'Tâche A' }, { id: 'k2', text: 'Tâche B' }] }, { id: 'c2', name: 'En cours', cards: [{ id: 'k3', text: 'Tâche C' }] }] };
    const dt = { id: 'dt', type: 'datatable', x: 100, y: 600, content: 'Budget', rows: [['Poste', 'Montant'], ['Loyer', '800']] };
    const id = await createBoard(owner.page, 'Lecture clavier', [kb, dt]);
    const invited = await owner.page.evaluate(async ([i, mail]) => (await fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, role: 'viewer' }) })).status, [id, viewer.email]);
    await viewer.page.goto(`${BASE}/#/`);
    await viewer.page.waitForSelector('#dashboard-title');
    const accepted = await viewer.page.evaluate(async () => {
      const { invites } = await (await fetch('/api/invites')).json();
      return (await fetch(`/api/invites/${invites[0].id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })).status;
    }).catch(() => 0);
    log('Viewer : invitation acceptée', invited === 201 && accepted === 200, `${invited} ${accepted}`);
    const v = viewer.page;
    viewer.api.length = 0;
    await v.goto(`${BASE}/#/tableau/${id}`);
    await v.waitForSelector('.canvas-item[data-id="kb"]');
    await v.locator('#board-readonly').waitFor();
    const snap = () => v.evaluate(async () => JSON.stringify((await import('/js/state.js')).getSnapshot().items));
    const before = await snap();
    const sub = () => v.evaluate(() => document.activeElement?.dataset?.sub || document.activeElement?.getAttribute('data-id') || document.activeElement?.tagName);
    const heard = text => v.waitForFunction(t => document.getElementById('announcer').textContent.includes(t), text, { timeout: 3000 }).then(() => true, () => false);
    await v.locator('.canvas-item[data-id="kb"]').first().focus();
    await v.keyboard.press('Enter');
    log('Kanban, lecture seule : Entrée mène à la première carte', await sub() === 'card:k1');
    log('Kanban, lecture seule : consigne adaptée annoncée', await heard('Entrée dans le kanban, lecture seule'));
    const path = [];
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']) { await v.keyboard.press(key); path.push(await sub()); }
    log('Kanban, lecture seule : flèches de carte en carte et de colonne en colonne', path.join() === 'card:k2,card:k3,col:c2,col:c1,card:k1', path.join());
    for (const key of ['Enter', 'F2', 'Insert', 'Delete', 'Backspace', 'Control+ArrowRight', 'Control+ArrowDown']) await v.keyboard.press(key);
    log('Kanban, lecture seule : ni éditeur, ni ajout, ni suppression, ni déplacement', await snap() === before && await v.locator('.inline-editor').count() === 0 && await sub() === 'card:k1');
    log('Kanban, lecture seule : refus annoncé', await heard('Lecture seule : ce tableau ne peut pas être modifié.'));
    await v.keyboard.press('Escape');
    log('Kanban : Échap rend le focus à l’objet', await sub() === 'kb');
    await v.locator('.canvas-item[data-id="dt"]').first().focus();
    await v.keyboard.press('Enter');
    log('Tableau de données, lecture seule : Entrée mène à la première cellule', await sub() === 'cell:0:0');
    log('Tableau de données, lecture seule : consigne adaptée annoncée', await heard('Entrée dans le tableau, lecture seule'));
    const cells = [];
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'End', 'Home', 'Control+End', 'Control+Home']) { await v.keyboard.press(key); cells.push(await sub()); }
    log('Tableau de données, lecture seule : cellule par cellule', cells.join() === 'cell:0:1,cell:1:1,cell:1:0,cell:1:1,cell:1:0,cell:1:1,cell:0:0', cells.join());
    log('Tableau de données : la cellule porte son contenu', await v.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Poste');
    await v.keyboard.press('ArrowDown');
    for (const key of ['Enter', 'F2', 'Delete', 'Backspace', 'x']) await v.keyboard.press(key);
    log('Tableau de données, lecture seule : rien ne s’édite ni ne s’efface', await snap() === before && await v.locator('.inline-editor').count() === 0 && await sub() === 'cell:1:0');
    await v.keyboard.press('Escape');
    log('Tableau de données : Échap rend le focus à l’objet', await sub() === 'dt');
    await axe(v, 'kanban et tableau de données en lecture seule');
    await v.waitForTimeout(3500);
    log('Lecture seule au clavier : aucun PUT émis', !viewer.api.some(a => a.startsWith('PUT') || a.startsWith('PATCH')), viewer.api.filter(a => !a.startsWith('GET')).join(','));
    log('Lecture seule au clavier : pas d’erreur console', viewer.errors.length === 0, viewer.errors.join(' | '));
    await owner.context.close();
    await viewer.context.close();
  }

  // === Séparation entre comptes sur un même appareil ===
  {
    console.log('--- Comptes sur un même appareil ---');
    const ana = await signed('Ana');
    const { context, page, errors } = ana;
    const accountKeys = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tableau-accessible-compte-')));
    const allStored = () => page.evaluate(() => Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('\n'));
    const register = async (name, email) => {
      await page.getByRole('button', { name: 'Créer un compte' }).click();
      await page.getByLabel('Nom affiché').fill(name);
      await page.getByLabel('Adresse e-mail').fill(email);
      await page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
      await page.getByRole('button', { name: 'Créer mon compte' }).click();
      await page.waitForSelector('#dashboard-title');
    };
    const login = async email => {
      await page.getByLabel('Adresse e-mail').fill(email);
      await page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
      await page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
      await page.waitForSelector('#dashboard-title');
    };
    const logout = async choice => {
      await page.click('#btn-account');
      await page.getByRole('button', { name: 'Se déconnecter' }).click();
      if (choice) await page.getByRole('button', { name: choice }).click();
      await gateShown(page);
    };
    const createSpace = async nom => {
      await page.click('#btn-create-space');
      await page.locator('dialog[open] input').fill(nom);
      await page.locator('dialog[open] form button').first().click();
      await page.locator('.space-row a', { hasText: nom }).waitFor();
    };
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const anaBoard = await createBoard(page, 'Tableau d’Ana', [sticky('item-1', 'A')]);
    await createSpace('Espace d’Ana');
    await page.evaluate(async i => {
      (await import('/js/store/boards.js')).toggleFavori(i);
      (await import('/js/store/templates.js')).saveTemplate('Modèle d’Ana', { name: 'Modèle d’Ana', items: [], tags: [] });
    }, anaBoard);
    await page.goto(`${BASE}/#/tableau/${anaBoard}`);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    await page.click('#btn-comments');
    log('Commentaires : auteur = nom affiché du compte, sans champ à remplir', (await page.locator('.comments-author').textContent()).includes('Ana') && await page.locator('#comment-author').count() === 0);
    await page.keyboard.press('Escape');
    // Une modification du tableau qui ne part pas : la déconnexion propose de la garder ou non. Espaces, favoris et
    // modèles sont sur le serveur (v1.11.0) : envoyés avant la déconnexion, ils ne sont plus listés.
    await page.route('**/api/boards/*/data', r => r.abort());
    await page.locator('.canvas-item[data-id="item-1"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByRole('heading', { name: 'Modifications non envoyées' }).waitFor();
    const warning = await page.locator('.account-dialog').textContent();
    log('Déconnexion : le tableau non envoyé est listé, pas l’organisation du compte', warning.includes('Tableau d’Ana') && !warning.includes('espaces, de favoris ou de modèles n’ont pas pu'), warning.slice(0, 200));
    log('Déconnexion : garder ou effacer, au choix du propriétaire', await page.getByRole('button', { name: 'Les garder sur cet appareil et me déconnecter' }).count() === 1 && await page.getByRole('button', { name: 'Me déconnecter sans les garder' }).count() === 1);
    await axe(page, 'avertissement de déconnexion');
    await page.getByRole('button', { name: 'Me déconnecter sans les garder' }).click();
    await gateShown(page);
    await page.unroute('**/api/boards/*/data');
    log('Déconnexion : plus rien du compte dans la page', !(await page.evaluate(() => document.body.innerText)).includes('Ana'));
    const leftover = await allStored();
    log('Déconnexion : rien d’Ana sur l’appareil (miroir, espace, favori, modèle)', !/Ana|Tableau d’Ana|Espace d’Ana|Modèle d’Ana/.test(leftover) && (await accountKeys()).length === 0, leftover.slice(0, 200));

    const brunoEmail = nextEmail();
    await register('Bruno', brunoEmail);
    await page.waitForTimeout(400);
    const text = await page.locator('#app-dashboard').textContent();
    log('Autre compte : ni tableau ni espace du précédent', !text.includes('Tableau d’Ana') && !text.includes('Espace d’Ana'));
    log('Autre compte : aucun modèle, aucun favori du précédent', await page.evaluate(async () => (await import('/js/store/templates.js')).getCustomTemplates().length === 0 && (await import('/js/store/boards.js')).getFavoris().length === 0));
    log('Autre compte : commentaires signés de son propre nom', await page.evaluate(async () => (await import('/js/state.js')).getAuthor()) === 'Bruno');
    log('Autre compte : aucun import proposé', await page.locator('.import-dialog').count() === 0);
    log('Autre compte : le miroir ne garde rien du précédent', !(await page.evaluate(k => localStorage.getItem(k) || '', MIRROR_KEY)).includes('Tableau d’Ana'));

    await createSpace('Espace de Bruno');
    await logout(null);
    log('Bruno déconnecté : son espace ne reste pas sur l’appareil', (await accountKeys()).length === 0 && !(await allStored()).includes('Espace de Bruno'));
    await login(ana.email);
    await page.locator('.space-row a', { hasText: 'Espace d’Ana' }).waitFor();
    const anaText = await page.locator('#app-dashboard').textContent();
    log('Retour d’Ana : son espace revient du serveur, rien de Bruno', !anaText.includes('Espace de Bruno') && anaText.includes('Espace d’Ana') && anaText.includes('Tableau d’Ana'));
    log('Retour d’Ana : son favori et son modèle reviennent', await page.evaluate(async () => (await import('/js/store/boards.js')).getFavoris().length === 1 && (await import('/js/store/templates.js')).getCustomTemplates().map(t => t.nom).join() === 'Modèle d’Ana'));
    await logout(null);
    await login(brunoEmail);
    await page.locator('.space-row a', { hasText: 'Espace de Bruno' }).waitFor();
    log('Retour de Bruno : son espace est là, seul', (await page.locator('.space-row a').allTextContents()).join() === 'Espace de Bruno');
    log('Comptes successifs : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Données d'avant les comptes : proposées une fois, puis effacées de l'espace commun ===
  {
    console.log('--- Données d’avant les comptes ---');
    const { context, page, errors } = await signed('Carole');
    const legacyBoards = [
      localBoard('board-1-ancien', 'Ancien', [sticky('item-1', 'x')], { espaceId: 'space-ancien', favori: true }),
      localBoard('board-1-pas-a-moi', 'Pas à moi')
    ];
    const seeds = {
      [BOARDS_KEY]: JSON.stringify({ version: 4, tableaux: legacyBoards, espaces: [{ id: 'space-ancien', nom: 'Ancien espace' }, { id: 'space-autre', nom: 'Espace d’un autre' }] }),
      'tableau-accessible-templates': JSON.stringify([{ id: 'custom-ancien', nom: 'Ancien modèle', description: '', créé: 1, snapshot: { name: 'Ancien modèle', items: [] } }]),
      'tableau-accessible-template-usage': JSON.stringify({ 'custom-ancien': 5 }),
      'tableau-accessible-auteur': 'Quelqu’un'
    };
    await page.addInitScript(s => { if (!sessionStorage.getItem('semé')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('semé', '1'); } }, seeds);
    await page.goto(`${BASE}/#/`);
    const dlg = page.locator('.import-dialog');
    await dlg.waitFor();
    const offered = await dlg.textContent();
    log('Import : tableaux, espaces et modèles proposés', ['Tableaux à importer', 'Espaces à importer', 'Modèles à importer dans « Mes modèles »', 'Ancien espace', 'Ancien modèle', 'Pas à moi'].every(t => offered.includes(t)));
    log('Ancien nom d’auteur des commentaires : effacé de l’appareil', await page.evaluate(() => localStorage.getItem('tableau-accessible-auteur')) === null);
    await axe(page, 'dialogue d’import avec espaces et modèles');
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      log(`Import complet sans débordement à ${width} px`, await noOverflow(page));
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('checkbox', { name: 'Espace d’un autre' }).uncheck();
    await page.getByRole('checkbox', { name: /Pas à moi/ }).uncheck();
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const results = await page.locator('.import-results').textContent();
    log('Compte rendu : espace, modèle et tableau importés', results.includes('Espace « Ancien espace » : importé') && results.includes('Modèle « Ancien modèle » : importé') && results.includes('Ancien : importé'), results);
    log('Compte rendu : résumé', (await dlg.locator('.import-summary').textContent()).includes('1 tableau importé, 1 espace importé, 1 modèle importé'));
    const common = await page.evaluate(k => ({ boards: JSON.parse(localStorage.getItem(k)), templates: localStorage.getItem('tableau-accessible-templates'), usage: localStorage.getItem('tableau-accessible-template-usage') }), BOARDS_KEY);
    log('Espace et modèle importés : retirés de l’espace commun', common.boards.espaces.map(s => s.nom).join() === 'Espace d’un autre' && common.templates === null && common.usage === null);
    await page.getByRole('button', { name: 'Terminer' }).click();
    await dlg.waitFor({ state: 'detached' });
    const org = await page.evaluate(async () => {
      const boards = await import('/js/store/boards.js');
      const b = boards.getAll().find(x => x.nom === 'Ancien');
      return { favori: b?.favori, espace: boards.getSpaces().find(s => s.id === b?.espaceId)?.nom, modèles: (await import('/js/store/templates.js')).getCustomTemplates().map(t => t.nom).join() };
    });
    log('Import : le tableau retrouve son espace et son favori, le modèle est dans Mes modèles', org.favori === true && org.espace === 'Ancien espace' && org.modèles === 'Ancien modèle', JSON.stringify(org));

    // Refuser ce qui n'est pas à soi : supprimer de l'appareil sans importer
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Importer vos tableaux de cet appareil…' }).click();
    await dlg.waitFor();
    log('Second passage : seul ce qui n’a pas été importé reste proposé', await page.getByRole('checkbox', { name: 'Espace d’un autre' }).count() === 1 && await page.getByRole('checkbox', { name: /Pas à moi/ }).count() === 1 && await page.getByRole('checkbox', { name: /Ancien/ }).count() === 0);
    await page.getByRole('button', { name: 'Supprimer de cet appareil sans importer…' }).click();
    await page.getByRole('heading', { name: 'Supprimer sans importer' }).waitFor();
    const confirmText = await dlg.textContent();
    log('Supprimer sans importer : confirmation explicite avec la liste', confirmText.includes('irréversible') && confirmText.includes('Tableau « Pas à moi »') && confirmText.includes('Espace « Espace d’un autre »'));
    log('Supprimer sans importer : focus sur le titre', await page.evaluate(() => document.activeElement.tagName === 'H2'));
    await axe(page, 'confirmation de suppression sans import');
    await page.getByRole('button', { name: 'Annuler' }).click();
    await page.getByRole('heading', { name: 'Importer vos tableaux de cet appareil' }).waitFor();
    log('Annuler : rien n’est supprimé', await page.evaluate(k => JSON.parse(localStorage.getItem(k)).tableaux.some(b => b.id === 'board-1-pas-a-moi'), BOARDS_KEY));
    await page.getByRole('button', { name: 'Supprimer de cet appareil sans importer…' }).click();
    await page.getByRole('button', { name: 'Supprimer définitivement de cet appareil' }).click();
    await dlg.locator('.import-status', { hasText: '2 éléments supprimés de cet appareil, sans import.' }).waitFor();
    log('Suppression sans import : message lu par l’annonceur seul', await dlg.locator('.import-status').getAttribute('role') === null && await page.waitForFunction(() => document.querySelector('.import-dialog [data-announcer]')?.textContent.includes('2 éléments supprimés'), null, { timeout: 3000 }).then(() => true, () => false));
    const after = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), BOARDS_KEY);
    log('Supprimer sans importer : effacés de l’appareil, rien envoyé', !after.tableaux.some(b => b.id === 'board-1-pas-a-moi') && after.espaces.length === 0 && !(await serverBoards(page)).some(b => b.name === 'Pas à moi'));
    log('Supprimer sans importer : plus rien à proposer', (await dlg.textContent()).includes('Aucun tableau à importer depuis cet appareil.'));
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.account-dialog', { state: 'detached' });

    // Un second compte sur l'appareil : plus rien d'avant les comptes à lui proposer
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await gateShown(page);
    await page.getByRole('button', { name: 'Créer un compte' }).click();
    await page.getByLabel('Nom affiché').fill('Daniel');
    await page.getByLabel('Adresse e-mail').fill(nextEmail());
    await page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForSelector('#dashboard-title');
    await page.waitForTimeout(400);
    log('Second compte : rien d’avant les comptes ne lui est proposé', await dlg.count() === 0 && !(await page.locator('#app-dashboard').textContent()).includes('Ancien'));
    log('Données d’avant les comptes : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Tout refuser ===
  {
    console.log('--- Tout refuser ---');
    const owner = await signed('Ana');
    const guest = await signed('Bruno');
    await owner.page.goto(`${BASE}/#/`);
    await owner.page.waitForSelector('#dashboard-title');
    for (const name of ['Premier', 'Second']) {
      const id = await createBoard(owner.page, name);
      await owner.page.evaluate(async ([i, mail]) => fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, role: 'editor' }) }), [id, guest.email]);
    }
    const g = guest.page;
    await g.goto(`${BASE}/#/`);
    await g.locator('#invites-section').waitFor();
    const all = g.getByRole('button', { name: /^Tout refuser/ });
    log('Tout refuser : bouton dans le bandeau, nommé avec le nombre', await all.getAttribute('aria-label') === 'Tout refuser : 2 invitations en attente');
    await all.focus();
    await g.keyboard.press('Enter');
    const confirm = g.locator('dialog[open]');
    await confirm.getByRole('heading', { name: 'Refuser toutes les invitations ?' }).waitFor();
    log('Tout refuser : confirmation explicite, focus sur Annuler', (await confirm.textContent()).includes('Les 2 invitations en attente seront refusées') && await g.evaluate(() => document.activeElement.textContent === 'Annuler'));
    await axe(g, 'confirmation Tout refuser');
    await g.keyboard.press('Enter');
    await confirm.waitFor({ state: 'detached' });
    log('Tout refuser : Annuler n’envoie rien', !guest.api.includes('POST /api/invites/decline-all') && await g.locator('#invites-section').count() === 1);
    await all.click();
    await g.getByRole('button', { name: 'Refuser toutes les invitations' }).click();
    const result = g.locator('#invites-result');
    await result.filter({ hasText: '2 invitations refusées.' }).waitFor();
    log('Tout refuser : résultat en role="status", bandeau retiré', await result.getAttribute('role') === 'status' && await g.locator('#invites-section').count() === 0);
    log('Tout refuser : plus aucune invitation sur le serveur', (await g.evaluate(async () => (await (await fetch('/api/invites')).json()).invites.length)) === 0);
    log('Tout refuser : pas d’erreur console', guest.errors.length === 0, guest.errors.join(' | '));

    // Acceptation refusée par le serveur (tableau complet) : message clair, invitation gardée
    const id = await createBoard(owner.page, 'Complet');
    await owner.page.evaluate(async ([i, mail]) => fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, role: 'viewer' }) }), [id, guest.email]);
    await g.reload();
    await g.locator('#invites-section').waitFor();
    await g.route('**/api/invites/*/accept', r => r.fulfill({ status: 403, json: { code: 'quota_exceeded', message: 'Ce tableau a atteint la limite de 100 membres.' } }));
    await g.getByRole('button', { name: /Accepter l’invitation/ }).click();
    await g.locator('.notice-error', { hasText: 'Invitation non acceptée : Ce tableau a atteint la limite de 100 membres. L’invitation reste en attente.' }).waitFor();
    log('Acceptation au-delà de 100 membres : message clair, invitation gardée', await g.locator('#invites-section').count() === 1);
    await g.unroute('**/api/invites/*/accept');

    // Invitation refusée par le serveur (plafond de l'adresse) : message clair dans le dialogue de partage
    await owner.page.goto(`${BASE}/#/parcourir`);
    await owner.page.reload();
    await row(owner.page, 'Complet').getByRole('button', { name: /Partager…/ }).click();
    await owner.page.route('**/api/boards/*/invites', r => r.request().method() === 'POST' ? r.fulfill({ status: 403, json: { code: 'quota_exceeded', message: 'Cette adresse a atteint la limite d’invitations en attente.' } }) : r.continue());
    await owner.page.getByLabel('Adresse e-mail de la personne').fill('pleine@exemple.test');
    await owner.page.getByRole('button', { name: 'Inviter' }).click();
    await owner.page.locator('.share-dialog').getByText('Invitation non enregistrée : Cette adresse a atteint la limite d’invitations en attente.').waitFor();
    log('Invitation au-delà de 20 en attente : message clair', true);
    await owner.context.close();
    await guest.context.close();
  }

  // === Import : deux onglets, « Plus tard » périmé, coupure, compte supprimé ===
  {
    console.log('--- Import : deux onglets et coupure ---');
    const IMPORT_KEY = 'tableau-accessible-import';
    const { context, page, errors } = await signed('Deux onglets');
    await seedInit(page, [localBoard('board-2-a', 'Onglet A', [sticky('item-1', 'a')]), localBoard('board-2-b', 'Onglet B'), localBoard('board-2-c', 'Onglet C')]);
    await page.goto(`${BASE}/#/`);
    const dlg = p => p.locator('.import-dialog');
    await dlg(page).waitFor();
    // Deux autres onglets du même compte ont lu le suivi avant l'import
    const tab2 = await context.newPage();
    const tab3 = await context.newPage();
    for (const t of [tab2, tab3]) { await t.goto(`${BASE}/#/`); await dlg(t).waitFor(); }
    const posts = [];
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/boards') posts.push(r.postDataJSON()); });
    await page.getByRole('checkbox', { name: /Onglet C/ }).uncheck();
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    log('Import : chaque tableau porte une clé d’import stable', posts.length === 2 && posts.map(b => b.importKey).sort().join() === 'local-board-2-a,local-board-2-b', posts.map(b => b.importKey).join());
    // Onglet 2, liste périmée : il importe à son tour
    await tab2.getByRole('checkbox', { name: /Onglet C/ }).uncheck();
    await tab2.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await tab2.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const names = (await serverBoards(page)).map(b => b.name).sort().join();
    log('Deux onglets : aucun doublon sur le compte', names === 'Onglet A,Onglet B', names);
    // Onglet 3, liste périmée : « Plus tard » n'efface pas les marques « importé »
    await tab3.getByRole('button', { name: 'Plus tard' }).click();
    await dlg(tab3).waitFor({ state: 'detached' });
    const track = JSON.parse(await page.evaluate(k => localStorage.getItem(k), IMPORT_KEY));
    log('« Plus tard » périmé : les marques « importé » d’un autre onglet restent', !!track.imported['board-2-a'] && !!track.imported['board-2-b'] && track.later.includes('board-2-c'), JSON.stringify(track));
    await tab3.reload();
    await tab3.waitForSelector('#dashboard-title');
    await tab3.waitForTimeout(400);
    log('« Plus tard » périmé : rien n’est reproposé au rechargement', await dlg(tab3).count() === 0);
    await tab2.close();
    await tab3.close();

    // Coupure : le serveur crée le tableau, la réponse se perd ; le nouvel essai ne le duplique pas
    await page.getByRole('button', { name: 'Terminer' }).click();
    await dlg(page).waitFor({ state: 'detached' });
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Importer vos tableaux de cet appareil…' }).click();
    await dlg(page).waitFor();
    let cut = true;
    await page.route('**/api/boards', async r => {
      if (r.request().method() === 'POST' && cut) { cut = false; await r.fetch(); return r.abort(); }
      return r.continue();
    });
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    log('Coupure : réponse perdue, le tableau reste proposé', (await page.locator('.import-results').textContent()).includes('Onglet C : refusé') && !JSON.parse(await page.evaluate(k => localStorage.getItem(k), IMPORT_KEY)).imported['board-2-c']);
    await page.unroute('**/api/boards');
    await page.getByRole('button', { name: 'Revenir à la liste' }).click();
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const afterCut = (await serverBoards(page)).map(b => b.name).sort().join();
    log('Réimport après coupure : pas de doublon', afterCut === 'Onglet A,Onglet B,Onglet C', afterCut);
    log('Réimport après coupure : marqué importé', !!JSON.parse(await page.evaluate(k => localStorage.getItem(k), IMPORT_KEY)).imported['board-2-c']);
    await page.getByRole('button', { name: 'Terminer' }).click();
    await dlg(page).waitFor({ state: 'detached' });

    // Compte supprimé : ce qu'il avait importé redevient proposé (à importer ailleurs, ou à supprimer de l'appareil)
    await page.getByRole('button', { name: 'Supprimer mon compte…' }).click();
    await page.getByRole('heading', { name: 'Supprimer le compte' }).waitFor();
    await page.getByLabel('Mot de passe', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click();
    await gateShown(page);
    await page.getByRole('button', { name: 'Créer un compte' }).click();
    await page.getByLabel('Nom affiché').fill('Suivant');
    await page.getByLabel('Adresse e-mail').fill(nextEmail());
    await page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await dlg(page).waitFor();
    log('Compte supprimé : ses tableaux importés sont de nouveau proposés', await page.getByRole('checkbox', { name: /Onglet A/ }).count() === 1 && await page.getByRole('button', { name: 'Supprimer de cet appareil sans importer…' }).count() === 1);
    log('Import, deux onglets et coupure : pas d’erreur console', errors.filter(e => !/Failed to fetch|ERR_FAILED/.test(e)).length === 0, errors.join(' | '));
    await context.close();
  }

  // === Session fermée : la fin de session ne vaut pas « Plus tard » ===
  {
    console.log('--- Import et fin de session ---');
    const { context, page } = await signed('Fin de session');
    await seedInit(page, [localBoard('board-3-a', 'Pas encore répondu')]);
    await page.goto(`${BASE}/#/`);
    await page.locator('.import-dialog').waitFor();
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }));
    // Le prochain appel reçoit 401 : la session expire, l'écran de connexion ferme le dialogue.
    await page.evaluate(async () => (await import('/js/store/account.js')).refreshBoards());
    await gateShown(page);
    const later = JSON.parse(await page.evaluate(() => localStorage.getItem('tableau-accessible-import')) || '{"later":[]}').later;
    log('Fin de session : la fermeture du dialogue ne vaut pas « Plus tard »', !later.includes('board-3-a'), JSON.stringify(later));
    await context.close();
  }

  // === Quitter un tableau avec des modifications non envoyées ===
  {
    console.log('--- Quitter avec envoi échoué ---');
    const owner = await signed('Ana');
    const guest = await signed('Bruno');
    await owner.page.goto(`${BASE}/#/`);
    await owner.page.waitForSelector('#dashboard-title');
    await guest.page.goto(`${BASE}/#/`);
    await guest.page.waitForSelector('#dashboard-title');
    const share = async (id, role) => {
      await owner.page.evaluate(async ([i, mail, r]) => fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, role: r }) }), [id, guest.email, role]);
      await guest.page.evaluate(async () => { const { invites } = await (await fetch('/api/invites')).json(); for (const inv of invites) await fetch(`/api/invites/${inv.id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); });
    };
    const g = guest.page;
    const editUnsent = async id => {
      await g.goto(`${BASE}/#/tableau/${id}`);
      await g.waitForSelector('.canvas-item[data-id="item-1"]');
      await g.route('**/api/boards/*/data', r => r.abort());
      await g.locator('.canvas-item[data-id="item-1"]').first().focus();
      await g.keyboard.press('Control+d');
      await g.waitForFunction(i => { const e = JSON.parse(localStorage.getItem('tableau-accessible-distants') || '{"tableaux":[]}').tableaux.find(t => t.id === i); return e?.sortants && e.données?.items.length === 2; }, id, { timeout: 8000 });
    };
    const leave = async name => {
      await g.goto(`${BASE}/#/`);
      const r = g.locator('#shared-section tr', { hasText: name });
      await r.waitFor();
      await r.getByRole('button', { name: /Quitter le tableau/ }).click();
      await g.locator('dialog[open]').getByRole('button', { name: 'Quitter le tableau' }).click();
      return r;
    };

    // Envoi impossible, copie possible : le travail part dans une copie avant de quitter
    const id1 = await createBoard(owner.page, 'Quitté', [sticky('item-1', 'x')]);
    await share(id1, 'editor');
    await editUnsent(id1);
    // Toutes les annonces, pas seulement la dernière : d'autres peuvent suivre (liste relue).
    await g.evaluate(() => { window.heard = []; new MutationObserver(() => window.heard.push(document.getElementById('announcer').textContent)).observe(document.getElementById('announcer'), { childList: true, characterData: true, subtree: true }); });
    const r1 = await leave('Quitté');
    await r1.waitFor({ state: 'detached', timeout: 10000 });
    const copy1 = (await serverBoards(g)).find(b => b.name === 'Quitté (copie)' && b.role === 'owner');
    log('Quitter, envoi échoué : copie sur le compte avec le travail non envoyé', !!copy1 && (await g.evaluate(async i => (await (await fetch(`/api/boards/${i}`)).json()).board.items.length, copy1.id)) === 2);
    log('Quitter, envoi échoué : le tableau est bien quitté', await fetchStatus(g, id1) === 404);
    log('Quitter, envoi échoué : la copie est annoncée', await g.waitForFunction(() => window.heard.some(t => t.includes('gardées dans la copie « Quitté (copie) »')), null, { timeout: 3000 }).then(() => true, async () => { console.log(await g.evaluate(() => JSON.stringify(window.heard))); return false; }));

    // Ni envoi ni copie possibles : on ne quitte pas, et on le dit
    const id2 = await createBoard(owner.page, 'Gardé', [sticky('item-1', 'y')]);
    await share(id2, 'editor');
    await editUnsent(id2);
    await g.route('**/api/boards', r => (r.request().method() === 'POST' ? r.abort() : r.continue()));
    await leave('Gardé');
    const refusal = g.locator('dialog[open] .account-message', { hasText: 'n’ont pas pu être mises à l’abri' });
    await refusal.waitFor({ timeout: 10000 });
    log('Quitter, ni envoi ni copie : refusé avec un message clair', (await refusal.textContent()).includes('Vous n’avez pas quitté le tableau'));
    log('Quitter, ni envoi ni copie : toujours membre, travail gardé', await fetchStatus(g, id2) === 200 && await g.evaluate(i => JSON.parse(localStorage.getItem('tableau-accessible-distants')).tableaux.find(t => t.id === i)?.sortants === true, id2));
    await g.unroute('**/api/boards');
    await g.unroute('**/api/boards/*/data');
    await g.locator('dialog[open]').getByRole('button', { name: 'Annuler' }).click();
    log('Quitter : pas d’erreur console', guest.errors.filter(e => !/Failed to fetch|ERR_FAILED/.test(e)).length === 0, guest.errors.join(' | '));
    await owner.context.close();
    await guest.context.close();
  }

  // === Droit d'écrire retiré alors que du travail attend : copie, puis version du serveur ===
  {
    console.log('--- Perte du droit d’écrire avec travail local ---');
    const owner = await signed('Ana');
    const guest = await signed('Bruno');
    await owner.page.goto(`${BASE}/#/`);
    await owner.page.waitForSelector('#dashboard-title');
    const g = guest.page;
    await g.goto(`${BASE}/#/`);
    await g.waitForSelector('#dashboard-title');
    const id = await createBoard(owner.page, 'Rétrogradé', [sticky('item-1', 'serveur')]);
    await owner.page.evaluate(async ([i, mail]) => fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, role: 'editor' }) }), [id, guest.email]);
    await g.evaluate(async () => { const { invites } = await (await fetch('/api/invites')).json(); await fetch(`/api/invites/${invites[0].id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); });
    await g.goto(`${BASE}/#/tableau/${id}`);
    await g.waitForSelector('.canvas-item[data-id="item-1"]');
    await g.route('**/api/boards/*/data', r => r.abort());
    await g.locator('.canvas-item[data-id="item-1"]').first().focus();
    await g.keyboard.press('Control+d');
    await g.waitForFunction(i => JSON.parse(localStorage.getItem('tableau-accessible-distants') || '{"tableaux":[]}').tableaux.find(t => t.id === i)?.sortants === true, id, { timeout: 8000 });
    const guestId = await g.evaluate(async () => (await import('/js/store/account.js')).getUser().id);
    await owner.page.evaluate(async ([i, u]) => fetch(`/api/boards/${i}/members/${u}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }) }), [id, guestId]);
    await g.unroute('**/api/boards/*/data');
    await g.reload();
    await g.locator('.notice-error', { hasText: 'gardées dans la copie' }).waitFor({ timeout: 10000 });
    await g.waitForFunction(i => { const e = JSON.parse(localStorage.getItem('tableau-accessible-distants')).tableaux.find(t => t.id === i); return e && !e.sortants && e.données?.items.length === 1; }, id, { timeout: 8000 }).catch(() => {});
    const copies = (await serverBoards(g)).filter(b => b.name === 'Rétrogradé (copie)');
    log('Droit retiré : une seule copie, avec le travail non envoyé', copies.length === 1 && (await g.evaluate(async i => (await (await fetch(`/api/boards/${i}`)).json()).board.items.length, copies[0].id)) === 2, `${copies.length} copie(s)`);
    log('Droit retiré : le tableau affiche la version du serveur, en lecture seule', await g.locator('.canvas-item[data-id]').evaluateAll(els => new Set(els.map(e => e.dataset.id)).size) === 1 && await g.locator('#board-readonly').isVisible());
    const mirrored = await g.evaluate(i => JSON.parse(localStorage.getItem('tableau-accessible-distants')).tableaux.find(t => t.id === i), id);
    log('Droit retiré : le miroir reprend la version du serveur', mirrored && !mirrored.sortants && mirrored.données?.items.length === 1, JSON.stringify({ sortants: mirrored?.sortants, n: mirrored?.données?.items.length }));
    await g.reload();
    await g.waitForSelector('.canvas-item[data-id="item-1"]');
    await g.waitForTimeout(1500);
    log('Droit retiré : rechargé, pas de seconde copie', (await serverBoards(g)).filter(b => b.name.startsWith('Rétrogradé (copie)')).length === 1);
    log('Droit retiré : pas d’erreur console', guest.errors.filter(e => !/Failed to fetch|ERR_FAILED/.test(e)).length === 0, guest.errors.join(' | '));
    await owner.context.close();
    await guest.context.close();
  }

  // === Déconnexion dans un autre onglet : son choix vaut pour tous les onglets du compte ===
  {
    console.log('--- Déconnexion avec un autre onglet ouvert ---');
    const { context, page } = await signed('Deux onglets');
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const id = await createBoard(page, 'Pas gardé', [sticky('item-1', 'x')]);
    const tabB = await context.newPage();
    await tabB.goto(`${BASE}/#/tableau/${id}`);
    await tabB.waitForSelector('.canvas-item[data-id="item-1"]');
    await tabB.route('**/api/boards/*/data', r => r.abort());
    await tabB.locator('.canvas-item[data-id="item-1"]').first().focus();
    await tabB.keyboard.press('Control+d');
    await tabB.waitForFunction(i => JSON.parse(localStorage.getItem('tableau-accessible-distants') || '{"tableaux":[]}').tableaux.find(t => t.id === i)?.sortants === true, id, { timeout: 8000 });
    // Une modification non envoyée dans cet onglet aussi : la déconnexion pose la question, et la réponse est « sans les garder ».
    await page.route('**/api/boards/*/data', r => r.abort());
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    await page.locator('.canvas-item[data-id="item-1"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByRole('button', { name: 'Me déconnecter sans les garder' }).click();
    await gateShown(page);
    await gateShown(tabB);
    await tabB.waitForTimeout(1500);
    const left = await tabB.evaluate(() => ({ mirror: localStorage.getItem('tableau-accessible-distants'), reserve: localStorage.getItem('tableau-accessible-boards') || '' }));
    log('Déconnexion ailleurs, sans garder : le miroir vidé n’est pas réécrit', left.mirror === null, (left.mirror || '').slice(0, 120));
    log('Déconnexion ailleurs, sans garder : rien n’est mis de côté', !left.reserve.includes('Pas gardé'));
    log('Déconnexion ailleurs : message adapté', (await tabB.locator('.login-screen').textContent()).includes('déconnecté dans un autre onglet sans garder'));
    await context.close();
  }

  // === Bandeau d'invitations apparu en cours d'usage : annoncé une fois ===
  {
    console.log('--- Invitation reçue en cours d’usage ---');
    const owner = await signed('Ana');
    const guest = await signed('Bruno');
    await owner.page.goto(`${BASE}/#/`);
    await owner.page.waitForSelector('#dashboard-title');
    const g = guest.page;
    await g.goto(`${BASE}/#/`);
    await g.waitForSelector('#dashboard-title');
    await g.evaluate(() => { window.heard = []; new MutationObserver(() => window.heard.push(document.getElementById('announcer').textContent)).observe(document.getElementById('announcer'), { childList: true, characterData: true, subtree: true }); });
    const id = await createBoard(owner.page, 'Arrivée');
    await owner.page.evaluate(async ([i, mail]) => fetch(`/api/boards/${i}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, role: 'viewer' }) }), [id, guest.email]);
    await g.evaluate(async () => (await import('/js/store/account.js')).refreshBoards());
    await g.locator('#invites-section').waitFor();
    await g.waitForTimeout(300);
    const heard = await g.evaluate(() => window.heard.filter(t => t === '1 invitation en attente').length);
    log('Bandeau apparu en cours d’usage : nombre annoncé une fois', heard === 1, `${heard} annonce(s)`);
    await owner.context.close();
    await guest.context.close();
  }
} catch (err) {
  log('Exception', false, err.stack || err.message);
} finally {
  await browser.close();
  await app.close();
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
