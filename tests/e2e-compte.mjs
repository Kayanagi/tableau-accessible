/*
 * Comptes et tableaux enregistrés : cas 8, 9 et 10 du §11 de docs/serveur-temps-reel.md,
 * plus conflit, écriture différée, serveur coupé, tableau distant injoignable et inscriptions fermées.
 * L'écran de connexion, l'import et le partage ont leur propre fichier : tests/e2e-verrou.mjs.
 * SHOTS=<dossier> écrit des captures d'écran pour relecture.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startAppServer } from './helpers/app-server.mjs';

const require = createRequire(import.meta.url);
const axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.SHOTS || null;
const ONLY = process.env.ONLY || null; // ONLY=C01,C04 : ne rejoue que ces scénarios de non-régression
const BOARDS_KEY = 'tableau-accessible-boards';
const MIRROR_KEY = 'tableau-accessible-distants';
const FLAG_KEY = 'tableau-accessible-compte';
const PASSWORD = 'correct horse battery';

let passed = 0, failed = 0, userCounter = 0;
function log(label, ok, detail) {
  console.log(`[${ok ? 'OK' : 'ECHEC'}] ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) passed++; else failed++;
}

const app = await startAppServer();
const browser = await chromium.launch({ headless: true });
const BASE = app.origin;

async function newPage(width = 1280, height = 800) {
  app.nextClient();
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  const api = [];
  const errors = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, api, errors };
}

const seedBoards = (name, items = []) => JSON.stringify({ version: 4, tableaux: [{ id: 'board-1-seed', nom: name, icon: 'board', espaceId: null, créé: '2026-01-01T00:00:00.000Z', dernièreOuverture: '2026-01-01T00:00:00.000Z', favori: false, données: { name, items, tags: [] } }], espaces: [] });
const sticky = (id, content, x = 40) => ({ id, type: 'sticky_note', x, y: 40, width: 150, height: 150, content, color: 'light_yellow', size: 'm' });

/* Depuis l'écran de connexion : l'application s'ouvre sur la route demandée. */
async function register(page, name = 'Claire') {
  const email = `u${++userCounter}@exemple.test`;
  await page.goto(`${BASE}/#/`);
  await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Nom affiché').fill(name);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForSelector('#dashboard-title');
  return email;
}

async function login(page, email, password = PASSWORD) {
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
}

const row = (page, text) => page.locator('.boards-table tbody tr', { hasText: text });
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const mirror = async page => JSON.parse(await stored(page, MIRROR_KEY) || 'null');
const fetchBoard = (page, id) => page.evaluate(async i => (await fetch(`/api/boards/${i}`)).json(), id);
const serverBoards = page => page.evaluate(async () => (await (await fetch('/api/boards')).json()).boards);

/* Écriture directe sur le serveur, comme le ferait un autre appareil. */
const putDirect = (page, id, baseRev, data) => page.evaluate(async ([i, r, d]) => (await fetch(`/api/boards/${i}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: r, data: d }) })).status, [id, baseRev, data]);

/* Un tableau sur le compte, avec sa copie dans le miroir, et le tableau de bord à jour. */
async function seedAndUpload(page, name, items) {
  const id = await page.evaluate(async ([n, list]) => (await (await import('/js/store/boards.js')).create(n, { name: n, items: list, tags: [] })).id, [name, items]);
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await row(page, name).waitFor();
  return id;
}

async function axe(page, label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
  log(`axe : ${label}`, res.violations.length === 0, res.violations.map(v => `${v.id} (${v.nodes[0]?.target})`).join(', '));
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const noOverflow = page => page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  return document.documentElement.scrollWidth <= innerWidth && (!d || d.scrollWidth <= d.clientWidth);
});

try {
  if (!ONLY) {
  // === Liens vers la page de confidentialité ===
  {
    console.log('--- Confidentialité ---');
    const { context, page } = await newPage();
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
    const gateLink = page.locator('.login-footer').getByRole('link', { name: 'Confidentialité (nouvel onglet)', exact: true });
    log('Confidentialité : lien présent sur l’écran de connexion',
      await gateLink.getAttribute('href') === 'confidentialite.html'
      && await gateLink.getAttribute('target') === '_blank'
      && await gateLink.getAttribute('rel') === 'noopener');
    log('Écran de connexion : mention des 15 ans', (await page.locator('.login-footer').textContent()).includes('15 ans'));

    await page.getByRole('button', { name: 'Créer un compte' }).click();
    await page.getByLabel('Nom affiché').fill('Claire');
    await page.getByLabel('Adresse e-mail').fill(`u${++userCounter}@exemple.test`);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    log('Confidentialité : lien toujours présent à la création du compte', await page.locator('.login-footer').getByRole('link', { name: 'Confidentialité (nouvel onglet)', exact: true }).count() === 1);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForSelector('.dashboard-footer');
    const dashboardLink = page.locator('.dashboard-footer').getByRole('link', { name: 'Confidentialité', exact: true });
    log('Confidentialité : lien présent sur le tableau de bord', await dashboardLink.getAttribute('href') === 'confidentialite.html');
    await page.click('#btn-account');
    await page.getByRole('heading', { name: 'Mon compte' }).waitFor();
    const accountLink = page.locator('.account-section', { hasText: 'Mes données' }).getByRole('link', { name: 'Confidentialité (nouvel onglet)', exact: true });
    log('Confidentialité : lien présent près de l’export', await accountLink.getAttribute('href') === 'confidentialite.html');

    const privacyPage = await page.request.get(`${BASE}/confidentialite.html`);
    log('Confidentialité : page servie avec le contact RGPD', privacyPage.status() === 200 && (await privacyPage.text()).includes('rgpd@dwes.fr'));
    await context.close();
  }

  // === Cas 10 : parcours compte au clavier seul, axe, largeurs ===
  {
    console.log('--- Cas 10 : clavier, axe, largeurs ---');
    const { context, page, errors } = await newPage();
    const email = `u${++userCounter}@exemple.test`;
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
    log('Clavier : focus sur le premier champ', await page.evaluate(() => document.activeElement.autocomplete) === 'username');
    await page.keyboard.press('Enter');
    log('Clavier : erreur liée au champ, focus sur la première erreur', await page.evaluate(() => {
      const a = document.activeElement;
      return a.type === 'email' && a.getAttribute('aria-invalid') === 'true' && !!document.getElementById(a.getAttribute('aria-describedby'))?.textContent;
    }));
    await page.keyboard.press('Shift+Tab');
    await page.getByRole('button', { name: 'Créer un compte' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Créer un compte' }).waitFor();
    log('Clavier : autocomplete new-password à l’inscription', await page.getByLabel('Mot de passe').getAttribute('autocomplete') === 'new-password');
    await page.keyboard.type('Claire');
    await page.keyboard.press('Tab');
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.type('trop court');
    await page.keyboard.press('Enter');
    log('Clavier : mot de passe trop court signalé', await page.evaluate(() => document.activeElement.getAttribute('aria-invalid') === 'true' && document.activeElement.type === 'password'));
    await axe(page, 'inscription avec erreur');
    await page.keyboard.type(' mais plus long');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#dashboard-title');
    log('Clavier : inscription réussie, indicateur posé', await stored(page, FLAG_KEY) === '1');
    log('Indicateur non sensible', !(await stored(page, FLAG_KEY)).includes('@'));
    await page.focus('#btn-account');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Mon compte' }).waitFor();
    await axe(page, 'mon compte');

    for (const theme of ['light', 'dark', 'high-contrast']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await axe(page, `mon compte, thème ${theme}`);
      await shot(page, `compte-${theme}-1280`);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      log(`Mon compte sans débordement à ${width} px`, await noOverflow(page));
      await shot(page, `compte-${width}`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    const small = await page.evaluate(() => [...document.querySelectorAll('.account-dialog button, .account-dialog input')].filter(el => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).length);
    log('Cibles de 24 px au moins à 320 px', small === 0, `${small} trop petite(s)`);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Nom, mot de passe, export
    await page.getByLabel('Nom affiché').fill('Claire D.');
    await page.getByRole('button', { name: 'Enregistrer le nom' }).click();
    await page.getByText('Nom enregistré.').waitFor();
    log('Nom modifié', true);
    await page.getByLabel('Mot de passe actuel').fill('mauvais mot de passe');
    await page.getByLabel('Nouveau mot de passe').fill('un autre mot de passe');
    await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
    await page.locator('.field-error', { hasText: 'Mot de passe incorrect.' }).waitFor();
    log('Mauvais mot de passe : erreur liée au champ, focus', await page.evaluate(() => document.activeElement.autocomplete === 'current-password' && document.activeElement.getAttribute('aria-invalid') === 'true'));
    await page.getByLabel('Mot de passe actuel').fill('trop court mais plus long');
    await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
    await page.getByText('Mot de passe changé.').waitFor();
    log('Mot de passe changé, session gardée', (await page.evaluate(async () => (await fetch('/api/me')).status)) === 200);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter mes données' }).click()]);
    log('Export téléchargé', download.suggestedFilename() === 'baro-export.json');

    // Échap, retour du focus
    await page.keyboard.press('Escape');
    await page.waitForSelector('.account-dialog', { state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.id === 'btn-account');
    log('Échap : dialogue fermé, focus sur le bouton du compte, route quittée', !page.url().includes('compte'));
    log('Compte : pas d’erreur console', errors.length === 0, errors.join(' | '));

    // Déconnexion, reconnexion, mauvais identifiants
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
    log('Déconnexion : indicateur retiré, miroir purgé', await stored(page, FLAG_KEY) === null && await stored(page, MIRROR_KEY) === null);
    log('Déconnexion : tableau de bord retiré de la page', await page.locator('#dashboard-title').count() === 0);
    await login(page, email, 'mot de passe erroné');
    await page.locator('.field-error', { hasText: 'E-mail ou mot de passe incorrect' }).waitFor();
    log('Connexion refusée : indicateur toujours absent', await stored(page, FLAG_KEY) === null);
    await axe(page, 'connexion avec erreur');
    await shot(page, 'connexion-erreur');
    await page.getByLabel('Mot de passe').fill('un autre mot de passe');
    await page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.waitForSelector('#dashboard-title');
    log('Reconnexion avec le nouveau mot de passe', await stored(page, FLAG_KEY) === '1');

    // Suppression : avertissement, mot de passe
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Supprimer mon compte…' }).click();
    await page.getByRole('heading', { name: 'Supprimer le compte' }).waitFor();
    await axe(page, 'suppression du compte');
    await page.getByLabel('Mot de passe').fill('mauvais mot de passe');
    await page.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click();
    await page.locator('.field-error', { hasText: 'Mot de passe incorrect.' }).waitFor();
    log('Suppression : mauvais mot de passe refusé', await stored(page, FLAG_KEY) === '1');
    await page.getByLabel('Mot de passe').fill('un autre mot de passe');
    await page.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click();
    await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
    log('Suppression : indicateur retiré, retour à la connexion', await stored(page, FLAG_KEY) === null);
    await context.close();
  }

  // === Cas 8 : un tableau du compte, de bout en bout ===
  {
    console.log('--- Cas 8 : écriture, conflit ---');
    const { context, page, api, errors } = await newPage();
    await register(page);
    const items = [sticky('item-1', 'Accentué : été'), sticky('item-2', 'Deuxième', 300), { id: 'item-3', type: 'connector', x: 0, y: 0, startId: 'item-1', endId: 'item-2', lineType: 'straight', startCap: 'none', endCap: 'arrow_filled', lineStyle: 'solid', strokeWidth: 2, stroke: 'auto', label: '', waypoints: [] }];
    const id = await seedAndUpload(page, 'À envoyer', items);
    const m = await mirror(page);
    log('Miroir écrit avec les données', m?.tableaux?.length === 1 && m.tableaux[0].données?.items?.length === 3 && m.tableaux[0].rev === 0);
    log('Tableau à soi non partagé : aucun badge', await row(page, 'À envoyer').locator('.board-badge').count() === 0);
    await axe(page, 'tableau de bord connecté');

    // Rechargement : données identiques
    await page.reload();
    await row(page, 'À envoyer').waitFor();
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.waitForSelector('#app-board:not([hidden])');
    await page.waitForSelector(`.canvas-item[data-id="item-1"]`);
    const server = await fetchBoard(page, id);
    const pick = list => list.map(i => [i.id, i.type, i.content, i.x, i.y, i.width, i.height, i.color, i.startId, i.endId]);
    log('Données identiques au rechargement', JSON.stringify(pick(server.board.items)) === JSON.stringify(pick(items)), JSON.stringify(pick(server.board.items)).slice(0, 80));
    log('Tableau affiché : 2 notes et un connecteur', await page.locator('.canvas-item').count() >= 3);
    await shot(page, 'tableau-distant');

    // Aucune écriture à l'ouverture, écriture 3 s après une modification, flush à la sortie
    await page.waitForTimeout(3500);
    log('Ouvrir sans modifier n’écrit rien', !api.some(a => a.startsWith('PUT')), api.filter(a => a.startsWith('PUT')).join(','));
    await page.locator('.canvas-item[data-id="item-1"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(800);
    log('Pas de PUT avant le délai', !api.some(a => a.startsWith('PUT')));
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => /\/boards\/[^/]+\/data$/.test(e.name)), null, { timeout: 5000 });
    const afterPut = await fetchBoard(page, id);
    log('PUT après le délai : rev 1, 4 objets', afterPut.rev === 1 && afterPut.board.items.length === 4, `rev ${afterPut.rev}, ${afterPut.board.items.length} objets`);
    const puts = api.filter(a => a.startsWith('PUT')).length;
    await page.locator('.canvas-item[data-id="item-2"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.goto(`${BASE}/#/`);
    await page.waitForFunction(n => performance.getEntriesByType('resource').filter(e => /\/boards\/[^/]+\/data$/.test(e.name)).length > n, puts, { timeout: 2000 });
    const flushed = await fetchBoard(page, id);
    log('Flush à la sortie, sans attendre le délai', flushed.board.items.length === 5 && flushed.rev === 2, `rev ${flushed.rev}, ${flushed.board.items.length} objets`);

    // Renommage par PATCH
    await row(page, 'À envoyer').getByRole('button', { name: 'Renommer' }).click();
    await page.fill('#field-rename-name', 'Renommé été');
    await page.click('#dialog-rename-board .btn-primary');
    await row(page, 'Renommé été').waitFor();
    const renamed = await fetchBoard(page, id);
    log('Renommage par PATCH, révision inchangée', renamed.board.name === 'Renommé été' && renamed.rev === 2);
    await page.waitForTimeout(1200);

    // Conflit 409 : la copie part sur le compte
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    const direct = await putDirect(page, id, 2, { name: 'Renommé été', tags: [], items: [sticky('item-1', 'Écrit ailleurs')] });
    log('Autre appareil : PUT accepté', direct === 200);
    await page.locator('.canvas-item[data-id="item-2"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.locator('.notice-error', { hasText: 'modifié ailleurs' }).waitFor({ timeout: 8000 });
    const dd = String(new Date().getDate()).padStart(2, '0'), mm = String(new Date().getMonth() + 1).padStart(2, '0');
    const copyName = `Renommé été (conflit du ${dd}/${mm})`;
    log('Conflit : copie annoncée dans le message', (await page.locator('.notice-error').textContent()).includes(copyName));
    await page.waitForFunction(() => document.getElementById('announcer').textContent.includes('modifié ailleurs'));
    log('Conflit : annonce vocale', true);
    const copyRow = (await serverBoards(page)).find(b => b.name === copyName);
    log('Conflit : copie sur le compte avec mes modifications', copyRow && (await fetchBoard(page, copyRow.id)).board.items.length === 6);
    const afterConflict = await fetchBoard(page, id);
    log('Conflit : aucune fusion, serveur intact', afterConflict.board.items.length === 1 && afterConflict.board.items[0].content === 'Écrit ailleurs');
    await page.waitForFunction(() => document.querySelectorAll('.canvas-item').length === 1);
    log('Conflit : version du serveur affichée', true);
    await shot(page, 'conflit');
    await page.waitForTimeout(3500);
    log('Conflit : pas de réécriture ensuite', (await fetchBoard(page, id)).rev === afterConflict.rev);
    await page.goto(`${BASE}/#/`);
    await row(page, copyName).waitFor();
    log('Envoi et conflit : pas d’erreur console', errors.filter(e => !/\b409\b/.test(e)).length === 0, errors.join(' | '));

    // Largeurs du tableau de bord connecté
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      // main coupe ce qui dépasse : scrollWidth du document ne suffit pas à le voir.
      log(`Tableau de bord connecté sans débordement à ${width} px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth));
      await page.locator('.boards-table').first().scrollIntoViewIfNeeded();
      await shot(page, `dashboard-connecte-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Suppression du compte : avertissement sur les tableaux avec d'autres membres
    await page.route('**/api/boards', r => (r.request().method() === 'GET' ? r.fulfill({ json: { boards: [{ id, name: 'Renommé été', icon: 'board', rev: 3, role: 'owner', createdAt: 1, updatedAt: 1, memberCount: 3 }] } }) : r.continue()));
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Supprimer mon compte…' }).click();
    await page.getByRole('heading', { name: 'Supprimer le compte' }).waitFor();
    log('Suppression : tableaux partagés listés', (await page.locator('.account-shared').textContent()).includes('Renommé été (2 autres membres)'));
    await shot(page, 'suppression-compte');
    await page.unroute('**/api/boards');
    await context.close();
  }

  // === Cas 9 : miroir plein ===
  {
    console.log('--- Cas 9 : miroir plein ---');
    const { context, page, errors } = await newPage();
    await register(page);
    // 30 notes de 45 000 caractères : valide pour le serveur, mais au-delà de 2 Mio dans localStorage.
    const huge = Array.from({ length: 30 }, (_, i) => sticky(`item-${i + 1}`, 'é'.repeat(45000), i * 10));
    const hugeId = await page.evaluate(async ([list]) => (await (await import('/js/store/boards.js')).create('Énorme', { name: 'Énorme', items: list, tags: [] })).id, [huge]);
    await page.waitForTimeout(100);
    const size = (await stored(page, MIRROR_KEY) || '').length * 2;
    log('Miroir sous le plafond de 2 Mio', size <= 2 * 1024 * 1024, `${size} octets`);
    const m = await mirror(page);
    log('Trop gros : entrée du miroir sans données', m.tableaux.length === 1 && m.tableaux[0].données === null);
    log('Trop gros : présent sur le compte', (await serverBoards(page)).some(b => b.id === hugeId));
    await page.locator('.notice', { hasText: 'ne tient pas dans la copie' }).waitFor({ timeout: 5000 });
    log('Trop gros pour le miroir : message affiché', true);
    await shot(page, 'miroir-plein');

    // Éviction : deux tableaux qui tiennent seuls mais pas ensemble ; le moins récent cède
    await page.evaluate(async i => { await (await import('/js/store/remote-boards.js')).remove(i); }, hugeId);
    await page.reload();
    await page.waitForSelector('#dashboard-title');
    const part = n => Array.from({ length: 12 }, (_, i) => sticky(`item-${i + 1}`, String(n).repeat(45000), i * 10));
    const firstId = await seedAndUpload(page, 'Premier', part(1));
    await page.waitForTimeout(50);
    const secondId = await seedAndUpload(page, 'Second', part(2));
    await page.waitForTimeout(1300);
    const evicted = await mirror(page);
    const byId = id => evicted.tableaux.find(t => t.id === id);
    log('Éviction : le moins récent perd ses données', byId(firstId)?.données === null && byId(secondId)?.données?.items?.length === 12, `${(await stored(page, MIRROR_KEY)).length * 2} octets`);
    log('Éviction : tableau évincé toujours listé', await row(page, 'Premier').count() === 1);

    // Éviction : un tableau avec sortants n'est pas sacrifié, c'est celui sans sortants qui cède
    await page.evaluate(async id => {
      const remote = await import('/js/store/remote-boards.js');
      const e = await remote.ensureData(id);
      remote.edit(id, { ...e.données, items: e.données.items.map((item, i) => (i ? item : { ...item, content: 'Modifié' + item.content.slice(7) })) });
    }, firstId);
    await page.waitForTimeout(1300);
    const withPending = await mirror(page);
    const pendingFirst = withPending.tableaux.find(t => t.id === firstId), otherSecond = withPending.tableaux.find(t => t.id === secondId);
    log('Éviction : sortants conservés, l’autre évincé', pendingFirst?.sortants === true && pendingFirst.données?.items?.[0]?.content.startsWith('Modifié') && otherSecond?.données === null, JSON.stringify([pendingFirst?.sortants, pendingFirst?.données?.items?.length, otherSecond?.données?.items?.length]));
    await page.waitForFunction(i => JSON.parse(localStorage.getItem('tableau-accessible-distants')).tableaux.find(t => t.id === i).sortants === false, firstId, { timeout: 8000 });

    // Quota réel : le miroir cède la place à la réserve de l'appareil
    await page.evaluate(() => {
      let chunk = 'x'.repeat(1024 * 256), i = 0;
      while (chunk.length >= 1024) { try { localStorage.setItem(`rempli-${i++}`, chunk); } catch { chunk = chunk.slice(0, chunk.length / 2); } }
    });
    const local2 = await page.evaluate(async () => {
      const boards = await import('/js/store/boards.js');
      const b = boards.addToReserve('Après quota', { name: 'Après quota', items: [{ id: 'item-1', type: 'text', x: 0, y: 0, content: 'x'.repeat(100000) }] });
      return { failing: boards.isSaveFailing(), saved: !!b && JSON.parse(localStorage.getItem('tableau-accessible-boards')).tableaux.some(t => t.id === b.id) };
    });
    log('Quota atteint : le miroir libère la place, réserve enregistrée', local2.saved && !local2.failing, JSON.stringify(local2));

    // Quota sans issue : boards.save() rend compte et un message s'affiche
    const failing = await page.evaluate(async () => {
      const boards = await import('/js/store/boards.js');
      const b = boards.addToReserve('Trop', { name: 'Trop', items: [{ id: 'item-1', type: 'text', x: 0, y: 0, content: 'x'.repeat(6000000) }] });
      return b === null && boards.isSaveFailing();
    });
    log('Quota sans issue : échec rendu', failing === true);
    await page.locator('.notice-error', { hasText: 'stockage de cet appareil est plein' }).waitFor();
    log('Quota sans issue : message affiché', true);
    log('Miroir : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Serveur coupé, tableau injoignable, course ===
  {
    console.log('--- Serveur indisponible ---');
    const { context, page, api, errors } = await newPage();
    await register(page);
    const id = await seedAndUpload(page, 'Distant', [sticky('item-1', 'Sur le compte')]);
    const otherId = await seedAndUpload(page, 'Ici', [sticky('item-1', 'Autre')]);
    await page.waitForTimeout(1300);

    // Tableau distant sans copie : une erreur, pas un tableau vide
    await page.evaluate(async () => (await import('/js/store/remote-boards.js')).release());
    log('Copie évincée avant la coupure', (await mirror(page)).tableaux.find(t => t.id === id).données === null);
    await app.stopBackend();
    const before = api.filter(a => !a.startsWith('GET')).length;
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.getByRole('heading', { name: 'Tableau indisponible' }).waitFor();
    log('Injoignable : message d’erreur', true);
    log('Injoignable : pas de canevas affiché', await page.locator('#app-board').isHidden());
    log('Injoignable : retour possible', await page.getByRole('link', { name: 'Retour à l’accueil' }).isVisible());
    log('Injoignable : focus sur le titre', await page.evaluate(() => document.activeElement?.id === 'dashboard-title'));
    await axe(page, 'tableau indisponible');
    await shot(page, 'tableau-indisponible');
    await page.waitForTimeout(3500);
    log('Injoignable : aucune écriture', api.filter(a => !a.startsWith('GET')).length === before);

    // Le reste de la liste reste visible
    await page.getByRole('link', { name: 'Retour à l’accueil' }).click();
    await row(page, 'Ici').waitFor();
    log('Serveur coupé : message clair', (await page.locator('#app-notices').textContent()).includes('injoignable'));
    await shot(page, 'serveur-coupe');

    // Rechargement serveur coupé : démarrage sans blocage, indicateur conservé
    await page.reload();
    await row(page, 'Ici').waitFor();
    log('Serveur coupé au démarrage : indicateur conservé, application ouverte', await stored(page, FLAG_KEY) === '1' && await page.locator('.login-screen').count() === 0);
    await app.startBackend();
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('[data-notice="server"]'));
    await row(page, 'Distant').waitFor();

    // Écriture hors ligne depuis le miroir, envoyée au retour
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    await page.goto(`${BASE}/#/`);
    await page.waitForTimeout(1300);
    await page.reload();
    await row(page, 'Distant').waitFor();
    await page.waitForTimeout(200);
    await app.stopBackend();
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    log('Hors ligne : la copie du miroir s’ouvre, message affiché', (await page.locator('#app-notices').textContent()).includes('copie de cet appareil'));
    await page.locator('.canvas-item[data-id="item-1"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(1500);
    log('Hors ligne : sortants dans le miroir', (await mirror(page)).tableaux.find(t => t.id === id).sortants === true);
    await app.startBackend();
    await page.waitForFunction(i => { const m = JSON.parse(localStorage.getItem('tableau-accessible-distants')); return m.tableaux.find(t => t.id === i).sortants === false; }, id, { timeout: 20000 });
    const resent = await fetchBoard(page, id);
    log('Retour du serveur : modifications envoyées', resent.board.items.length === 2 && resent.rev === 1, `rev ${resent.rev}, ${resent.board.items.length} objets`);

    // Course : la réponse tardive d'un tableau quitté n'est pas affichée
    await page.goto(`${BASE}/#/`);
    await row(page, 'Distant').waitFor();
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route(`**/api/boards/${id}`, async r => { await gate; await r.continue(); });
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.locator('[role="status"]', { hasText: 'Chargement du tableau' }).waitFor();
    log('Course : pas de canevas pendant le chargement', await page.locator('#app-board').isHidden());
    await page.goto(`${BASE}/#/parcourir`);
    await page.waitForSelector('.boards-table');
    release();
    await page.waitForTimeout(500);
    log('Course : réponse tardive ignorée', await page.locator('#app-board').isHidden() && await page.locator('#dashboard-title').textContent() === 'Tous les tableaux');
    await page.unroute(`**/api/boards/${id}`);

    // Session expirée en cours de route : retour à la connexion, hash conservé
    await page.goto(`${BASE}/#/tableau/${otherId}`);
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    await page.evaluate(async () => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }));
    await page.evaluate(async () => (await import('/js/store/account.js')).start());
    await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
    log('Session expirée : indicateur retiré', await stored(page, FLAG_KEY) === null);
    log('Session expirée : message visible', (await page.locator('.login-screen').textContent()).includes('session a expiré'));
    log('Session expirée : plus de canevas dans la page', await page.locator('.canvas-item').count() === 0 && await page.locator('#app-board').isHidden());
    log('Session expirée : route conservée', page.url().includes(`#/tableau/${otherId}`));
    const unexpected = errors.filter(e => !/\b(502|401|409)\b/.test(e));
    log('Serveur coupé : pas d’erreur console inattendue', unexpected.length === 0, unexpected.join(' | '));
    await context.close();
  }

  // === Refus du serveur : le message est affiché tel quel (réponses simulées) ===
  {
    console.log('--- Refus du serveur ---');
    const { context, page } = await newPage();
    await register(page);
    const id = await seedAndUpload(page, 'Limité', [sticky('item-1', 'Note')]);

    const quota = 'Vous avez atteint la limite de 100 tableaux.';
    await page.route('**/api/boards', r => (r.request().method() === 'POST' ? r.fulfill({ status: 403, json: { code: 'quota_exceeded', message: quota } }) : r.continue()));
    await row(page, 'Limité').getByRole('button', { name: 'Dupliquer' }).click();
    await page.locator('.notice-error', { hasText: quota }).waitFor();
    log('Quota : message affiché, rien de créé', (await serverBoards(page)).length === 1);
    await page.unroute('**/api/boards');

    const tooLarge = 'La requête dépasse la taille maximale de 4 Mio.';
    await page.route('**/api/boards', r => (r.request().method() === 'POST' ? r.fulfill({ status: 413, json: { code: 'body_too_large', message: tooLarge } }) : r.continue()));
    await row(page, 'Limité').getByRole('button', { name: 'Dupliquer' }).click();
    await page.locator('.notice-error', { hasText: tooLarge }).waitFor();
    log('Corps trop gros : message affiché', true);
    await page.unroute('**/api/boards');

    const slow = 'Trop de tentatives. Réessayez dans 30 s.';
    await page.evaluate(async () => (await import('/js/store/remote-boards.js')).release());
    await page.route(`**/api/boards/${id}`, r => r.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: { code: 'rate_limited', message: slow } }));
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.locator('.board-problem', { hasText: slow }).waitFor();
    log('429 à l’ouverture sans copie : message affiché, pas de canevas', await page.locator('#app-board').isHidden());
    await page.unroute(`**/api/boards/${id}`);
    await page.goto(`${BASE}/#/`);

    await page.route('**/api/me/export', r => r.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: { code: 'rate_limited', message: slow } }));
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Exporter mes données' }).click();
    await page.locator('.account-message', { hasText: slow }).waitFor();
    log('429 à l’export : message affiché', true);
    await context.close();
  }

  // === Inscriptions fermées ===
  {
    console.log('--- Inscriptions fermées ---');
    const closed = await startAppServer({ inscriptions: 'ferme' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${closed.origin}/#/compte`);
    await page.getByRole('button', { name: 'Créer un compte' }).click();
    await page.getByLabel('Nom affiché').fill('Claire');
    await page.getByLabel('Adresse e-mail').fill('ferme@exemple.test');
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
    log('Inscriptions fermées : retour à la connexion', true);
    log('Inscriptions fermées : message clair, focus dessus', await page.evaluate(() => document.activeElement.textContent.includes('inscriptions sont fermées')));
    log('Inscriptions fermées : plus de bouton de création', await page.getByRole('button', { name: 'Créer un compte' }).count() === 0);
    log('Inscriptions fermées : aucun indicateur', await page.evaluate(k => localStorage.getItem(k), FLAG_KEY) === null);
    await shot(page, 'inscriptions-fermees');
    await context.close();
    await closed.close();
  }
  }

  // === Revue v1.9.0 et audit d'accessibilité : un scénario par constat ===
  const dup = async page => { await page.locator('.canvas-item[data-id="item-1"]').first().focus(); await page.keyboard.press('Control+d'); };
  const openBoard = async (page, id) => { await page.goto(`${BASE}/#/tableau/${id}`); await page.waitForSelector('.canvas-item[data-id="item-1"]'); };
  const reserveNames = async page => JSON.parse(await stored(page, BOARDS_KEY) || '{"tableaux":[]}').tableaux.map(b => b.nom);
  const conflictCopies = async page => (await serverBoards(page)).map(b => b.name).filter(n => n.includes('conflit'));
  const notices = page => page.locator('#app-notices').textContent().catch(() => '');
  const remoteCall = (page, fn, arg) => page.evaluate(async ([source, a]) => (0, eval)(`(${source})`)(await import('/js/store/remote-boards.js'), a), [fn.toString(), arg]);
  const fillStorage = page => page.evaluate(() => { let i = 0; for (const n of [1048576, 1024, 1]) { const s = 'x'.repeat(n); try { for (;;) localStorage.setItem(`rempli-${i++}`, s); } catch { /* plein */ } } });
  const elsewhere = (page, id, extra = 'ailleurs') => page.evaluate(async ([i, content]) => {
    const s = await (await fetch(`/api/boards/${i}`)).json();
    const { id: _, icon, rev, createdAt, updatedAt, ...d } = s.board;
    d.items.push({ id: 'item-99', type: 'sticky_note', x: 400, y: 40, width: 150, height: 150, content, color: 'light_yellow', size: 'm' });
    return (await fetch(`/api/boards/${i}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: rev, data: d }) })).status;
  }, [id, extra]);
  const listen = page => page.evaluate(() => {
    window.__dit = [];
    new MutationObserver(() => { const t = document.getElementById('announcer').textContent; if (t) window.__dit.push(t); }).observe(document.getElementById('announcer'), { childList: true, characterData: true, subtree: true });
  });
  const said = (page, text) => page.evaluate(t => window.__dit.filter(x => x.includes(t)).length, text);
  async function connected(name = 'Tableau', items = [sticky('item-1', 'x')]) {
    const parts = await newPage();
    const email = await register(parts.page);
    const id = await seedAndUpload(parts.page, name, items);
    return { ...parts, email, id };
  }
  async function logoutIn(page) {
    await page.goto(`${BASE}/#/compte`);
    await page.waitForSelector('.account-dialog');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.waitForFunction(k => localStorage.getItem(k) === null, FLAG_KEY);
  }

  /* Interroge depuis Node : waitForFunction n'attend pas fiablement un prédicat asynchrone. */
  async function until(page, fn, arg, timeout = 15000) {
    const end = Date.now() + timeout;
    for (;;) {
      if (await page.evaluate(fn, arg)) return;
      if (Date.now() > end) throw new Error(`Délai dépassé : ${fn}`);
      await new Promise(r => setTimeout(r, 700));
    }
  }

  const REG = {
    async C01() {
      const { context, page: a, id, email } = await connected('C1');
      const b = await context.newPage();
      await openBoard(b, id);
      // Modification pas encore partie : la sortie ne doit pas la perdre, et le serveur la refuserait de toute façon.
      await b.route('**/api/boards/*/data', r => r.abort());
      await dup(b);
      await b.waitForTimeout(200);
      await logoutIn(a);
      await b.unroute('**/api/boards/*/data');
      await b.waitForFunction(() => document.querySelector('.login-screen')?.textContent.includes('autre onglet'));
      log('C1 : l’autre onglet est suspendu, prévenu, et n’affiche plus rien', await remoteCall(b, m => m.isSuspended()) && await b.locator('.canvas-item').count() === 0);
      await b.waitForFunction(k => JSON.parse(localStorage.getItem(k) || 'null')?.tableaux?.some(t => t.sortants && t.données.items.length === 2), MIRROR_KEY, { timeout: 5000 });
      log('C1 : le travail de l’onglet B est écrit dans le miroir', true);
      await a.goto(`${BASE}/#/`);
      await login(a, email);
      await a.waitForSelector('#dashboard-title');
      await until(a, async i => (await (await fetch(`/api/boards/${i}`)).json()).board?.items.length === 2, id, 10000);
      log('C1 : reconnexion : le travail de B arrive sur le serveur', true);
      await context.close();
    },
    async C02() {
      const { context, page, id } = await connected('C2');
      await openBoard(page, id);
      await page.waitForTimeout(1300);
      await app.stopBackend();
      await fillStorage(page);
      await dup(page);
      await page.locator('[data-notice^="save-"]').waitFor({ timeout: 5000 });
      const text = await notices(page);
      log('C2 : message exact, pas de « reste enregistré »', text.includes('pas encore sur le serveur') && !text.includes('Il reste enregistré'), text.slice(0, 160));
      log('C2 : sortants gardés en mémoire', await remoteCall(page, (m, i) => m.get(i).sortants && m.get(i).données.items.length === 2, id));
      log('C2 : version durable du miroir intacte', (await mirror(page)).tableaux.find(t => t.id === id).données?.items?.length === 1);
      const asked = new Promise(resolve => page.once('dialog', d => { resolve(d.type()); d.accept().catch(() => {}); }));
      await page.close({ runBeforeUnload: true });
      log('C2 : fermer l’onglet demande confirmation', await Promise.race([asked, new Promise(r => setTimeout(() => r('rien'), 3000))]) === 'beforeunload');
      await app.startBackend();
      await context.close();
      // Trop gros pour le miroir et pour keepalive, serveur joignable
      const big = await connected('C2b');
      await big.page.goto(`${BASE}/#/`);
      await remoteCall(big.page, (m, i) => { const e = m.get(i); m.edit(i, { ...e.données, items: Array.from({ length: 25 }, (_, n) => ({ id: `item-${n + 1}`, type: 'sticky_note', x: n, y: 0, width: 150, height: 150, content: 'z'.repeat(45000), color: 'light_yellow', size: 'm' })) }); }, big.id);
      await big.page.keyboard.press('Tab');
      await big.page.locator('[data-notice^="save-"]').waitFor({ timeout: 5000 });
      const asked2 = new Promise(resolve => big.page.once('dialog', d => { resolve(d.type()); d.accept().catch(() => {}); }));
      await big.page.close({ runBeforeUnload: true });
      log('C2 : trop gros, envoi en attente : confirmation demandée', await Promise.race([asked2, new Promise(r => setTimeout(() => r('rien'), 3000))]) === 'beforeunload');
      await big.context.close();
    },
    async C03() {
      const { context, page, api, id } = await connected('C3');
      await openBoard(page, id);
      app.setBodyLimit(50);
      await dup(page);
      await page.locator('[data-notice^="save-"]').waitFor({ timeout: 6000 });
      await page.waitForTimeout(7000);
      app.setBodyLimit();
      const puts = api.filter(a => a.startsWith('PUT')).length;
      log('C3 : 413 HTML : un seul envoi', puts === 1, `${puts} PUT`);
      const text = await notices(page);
      log('C3 : 413 HTML : message juste', text.includes('trop volumineux') && !text.includes('injoignable'), text.slice(0, 160));
      await page.goto(`${BASE}/#/`);
      await page.waitForTimeout(100);
      const before = api.filter(a => a.startsWith('PUT')).length;
      await remoteCall(page, async (m, i) => { const e = m.get(i); m.edit(i, { ...e.données, items: Array.from({ length: 100 }, (_, n) => ({ id: `item-${n + 1}`, type: 'sticky_note', x: n, y: 0, width: 150, height: 150, content: 'z'.repeat(45000), color: 'light_yellow', size: 'm' })) }); await m.flush(i); }, id);
      log('C3 : plus de 4 Mio : refus avant envoi', api.filter(a => a.startsWith('PUT')).length === before);
      await context.close();
    },
    async C04() {
      const { context, page, id } = await connected('C4');
      await openBoard(page, id);
      await elsewhere(page, id);
      let release; const gate = new Promise(r => { release = r; });
      await page.route(`**/api/boards/${id}`, async r => { if (r.request().method() === 'GET') await gate; await r.continue(); });
      await dup(page);
      const put = page.waitForResponse(r => /\/boards\/[^/]+\/data$/.test(r.url()) && r.status() === 409, { timeout: 6000 });
      await put;
      await dup(page);
      await dup(page);
      await page.waitForTimeout(100);
      const shown = await page.locator('.canvas-item').count();
      release();
      await page.locator('.notice-error', { hasText: 'modifié ailleurs' }).waitFor({ timeout: 5000 });
      await page.unroute(`**/api/boards/${id}`);
      const copyRow = (await serverBoards(page)).find(b => b.name.includes('conflit'));
      const copyItems = copyRow && (await fetchBoard(page, copyRow.id)).board.items.length;
      log('C4 : éditions pendant la résolution dans la copie', shown === 4 && copyItems === 4, `écran ${shown}, copie ${copyItems}`);
      await page.waitForFunction(() => document.querySelectorAll('.canvas-item').length === 2);
      log('C4 : le serveur s’affiche ensuite', true);
      await context.close();
      // Variante : édition pendant l'envoi de la copie au compte
      const v = await connected('C4b');
      await openBoard(v.page, v.id);
      await v.page.waitForTimeout(1300);
      await elsewhere(v.page, v.id);
      let free; const held = new Promise(r => { free = r; });
      let first = true;
      await v.page.route('**/api/boards', async r => { if (r.request().method() === 'POST' && first) { first = false; await held; } await r.continue(); });
      const posted = v.page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/boards'), { timeout: 8000 });
      await dup(v.page);
      await posted;
      await dup(v.page);
      await v.page.waitForTimeout(100);
      free();
      await v.page.locator('.notice-error', { hasText: 'modifié ailleurs' }).waitFor({ timeout: 8000 });
      const sizes = await v.page.evaluate(async () => {
        const { boards } = await (await fetch('/api/boards')).json();
        const out = [];
        for (const b of boards.filter(x => x.name.includes('conflit'))) out.push((await (await fetch(`/api/boards/${b.id}`)).json()).board.items.length);
        return out;
      });
      log('C4 : édition pendant l’envoi de la copie : rien de perdu', sizes.includes(3), JSON.stringify(sizes));
      await v.context.close();
    },
    async C05() {
      const { context, page, id } = await connected('C5');
      await openBoard(page, id);
      await page.route('**/api/boards/*/data', r => r.abort());
      await dup(page);
      await page.waitForTimeout(1300);
      await page.goto(`${BASE}/#/`);
      await page.waitForTimeout(200);
      await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }));
      await fillStorage(page);
      const email = `u${++userCounter}@exemple.test`;
      await page.evaluate(([e, pw]) => fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: pw, displayName: 'D' }) }), [email, PASSWORD]);
      await page.reload();
      await page.locator('[data-notice="copy-failed"]').waitFor({ timeout: 8000 });
      log('C5 : copie impossible : sortants gardés', await page.evaluate(i => { const e = JSON.parse(localStorage.getItem('tableau-accessible-distants')).tableaux.find(t => t.id === i); return e?.sortants === true && e.données.items.length === 2; }, id));
      log('C5 : le travail d’un autre compte n’est jamais listé', await row(page, 'C5').count() === 0 && await remoteCall(page, (m, i) => m.get(i)?.perduPour != null && !m.list().some(e => e.id === i), id));
      log('C5 : le message ne nomme pas le tableau d’un autre compte', !(await notices(page)).includes('C5'));
      log('C5 : l’alerte de stockage plein reste', (await notices(page)).includes('stockage de cet appareil est plein'));
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('rempli-')) localStorage.removeItem(k); });
      await page.reload();
      await page.waitForFunction(k => JSON.parse(localStorage.getItem(k) || '{"tableaux":[]}').tableaux.some(b => b.nom === 'C5 (non envoyé)' && b.données.items.length === 2 && !!b.réservéÀ), BOARDS_KEY);
      log('C5 : place libérée : le travail attend son compte sur l’appareil', await page.locator('.import-dialog').count() === 0);
      await context.close();
    },
    async C06() {
      const connector = { id: 'item-3', type: 'connector', x: 0, y: 0, startId: 'item-1', endId: 'item-2', lineType: 'straight', startCap: 'none', endCap: 'arrow_filled', lineStyle: 'solid', strokeWidth: 2, stroke: 'auto', label: '', waypoints: [] };
      const { context, page, id } = await connected('C6', [sticky('item-1', 'x'), sticky('item-2', 'y', 300), connector]);
      await openBoard(page, id);
      await dup(page);
      await page.waitForTimeout(200);
      await page.reload();
      await page.waitForFunction(i => JSON.parse(localStorage.getItem('tableau-accessible-distants')).tableaux.find(t => t.id === i).sortants === false, id, { timeout: 8000 });
      const s = await fetchBoard(page, id);
      log('C6 : recharger après une modification : enregistrée', s.board.items.length === 4 && s.rev >= 1, `rev ${s.rev}, ${s.board.items.length} objets`);
      log('C6 : recharger : aucune fausse copie', (await conflictCopies(page)).length === 0 && !(await notices(page)).includes('modifié ailleurs'));
      // Déterministe : le serveur applique le PUT, le navigateur ne lit jamais la réponse
      await page.waitForSelector('.canvas-item[data-id="item-1"]');
      let lost = true;
      await page.route(`**/api/boards/${id}/data`, async r => { if (lost) { lost = false; await r.fetch(); await r.abort(); } else await r.continue(); });
      await dup(page);
      const conflict = page.waitForResponse(r => /\/boards\/[^/]+\/data$/.test(r.url()) && r.status() === 409, { timeout: 12000 });
      await conflict;
      await page.waitForFunction(i => JSON.parse(localStorage.getItem('tableau-accessible-distants')).tableaux.find(t => t.id === i).sortants === false, id, { timeout: 8000 });
      log('C6 : réponse perdue puis 409 : pas de copie', (await conflictCopies(page)).length === 0);
      log('C6 : réponse perdue : révision reprise', await remoteCall(page, (m, i) => m.get(i).rev, id) === (await fetchBoard(page, id)).rev);
      await context.close();
    },
    async C07() {
      const { context, page: a, id } = await connected('C7');
      await a.goto(`${BASE}/#/`);
      const b = await context.newPage();
      await b.goto(`${BASE}/#/`);
      await row(b, 'C7').waitFor();
      await openBoard(a, id);
      await a.waitForTimeout(1300);
      await a.route(`**/api/boards/${id}/data`, r => r.abort());
      await dup(a);
      await a.waitForFunction(([k, i]) => JSON.parse(localStorage.getItem(k)).tableaux.find(t => t.id === i).sortants === true, [MIRROR_KEY, id]);
      await b.waitForTimeout(200);
      log('C7 : l’onglet passif n’adopte pas les sortants', (await remoteCall(b, m => m.pending().length)) === 0);
      await b.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await b.waitForTimeout(200);
      const m = (await mirror(a)).tableaux.find(t => t.id === id);
      log('C7 : sa sortie ne réécrit pas une version ancienne', m.sortants === true && m.données.items.length === 2);
      await a.unroute(`**/api/boards/${id}/data`);
      await until(a, async i => (await (await fetch(`/api/boards/${i}`)).json()).rev === 1, id, 40000);
      await remoteCall(b, m2 => m2.flushAll());
      await b.waitForTimeout(400);
      log('C7 : aucune fausse copie', (await conflictCopies(b)).length === 0, (await serverBoards(b)).map(x => x.name).join(','));
      await context.close();
    },
    async C08() {
      const { context, page, id } = await connected('C8');
      await openBoard(page, id);
      await page.evaluate(i => fetch(`/api/boards/${i}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }), id);
      await page.evaluate(async () => (await import('/js/store/account.js')).refreshBoards());
      await page.locator('.notice-error', { hasText: 'plus accès' }).waitFor({ timeout: 3000 });
      await dup(page);
      await page.waitForTimeout(300);
      log('C8 : tableau ouvert disparu : lecture seule, entrée gardée', await remoteCall(page, (m, i) => m.get(i)?.perdu === true && m.get(i).données.items.length === 1, id) && await page.locator('#board-readonly').isVisible());
      await page.getByRole('button', { name: 'Garder une copie' }).click();
      await page.waitForFunction(() => document.getElementById('board-title')?.textContent.includes('C8') && !document.getElementById('app-board').hidden && document.getElementById('board-readonly').hidden);
      const kept8 = (await serverBoards(page)).find(b => b.name === 'C8');
      log('C8 : copie récupérée sur le compte', kept8 && (await fetchBoard(page, kept8.id)).board.items.length === 1);
      await context.close();
      // Liste en retard : ne retire pas un tableau tout juste créé
      const v = await newPage();
      await register(v.page);
      let free; const gate = new Promise(r => { free = r; });
      await v.page.route('**/api/boards', async r => { if (r.request().method() !== 'GET') return r.continue(); const resp = await r.fetch(); await gate; return r.fulfill({ response: resp }); });
      const late = v.page.evaluate(async () => (await import('/js/store/account.js')).refreshBoards());
      await v.page.waitForTimeout(150);
      await v.page.evaluate(async () => (await import('/js/store/boards.js')).create('Tout juste', { name: 'Tout juste', items: [] }));
      free();
      await late;
      await v.page.waitForTimeout(100);
      log('C8 : liste en retard : tableau créé gardé', await v.page.evaluate(async () => (await import('/js/store/remote-boards.js')).list().some(e => e.nom === 'Tout juste')));
      await v.context.close();
    },
    async C09() {
      const { context, page: a, email } = await connected('C9-u1');
      const b = await context.newPage();
      await b.goto(`${BASE}/#/`);
      await row(b, 'C9-u1').waitFor();
      await logoutIn(a);
      await a.waitForTimeout(300);
      log('C9 : l’autre onglet ne réécrit pas le miroir purgé', await stored(a, MIRROR_KEY) === null);
      const u2 = await register(a);
      await seedAndUpload(a, 'C9-u2', [sticky('item-1', 'u2')]);
      await a.waitForTimeout(1300);
      await b.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await b.waitForTimeout(300);
      const m = await mirror(a);
      log('C9 : le miroir reste à U2', m.owner.email === u2 && m.owner.email !== email && !m.tableaux.some(t => t.nom === 'C9-u1'), `${m.owner.email} ; ${m.tableaux.map(t => t.nom)}`);
      const names = await remoteCall(b, x => x.list().map(e => e.nom));
      log('C9 : l’onglet B n’affiche plus les données de U1', !names.includes('C9-u1'), names.join(','));
      await context.close();
    },
    async C10() {
      const { context, page, id } = await connected('C10');
      await page.goto(`${BASE}/#/`);
      let free; const gate = new Promise(r => { free = r; });
      let first = true;
      await page.route(`**/api/boards/${id}`, async r => {
        if (r.request().method() === 'GET' && first) { first = false; const resp = await r.fetch(); await gate; await r.fulfill({ response: resp }); return; }
        await r.continue();
      });
      await page.goto(`${BASE}/#/tableau/${id}`);
      await page.waitForTimeout(150);
      await page.goto(`${BASE}/#/`);
      await page.waitForTimeout(100);
      await openBoard(page, id);
      await dup(page);
      await until(page, async i => (await (await fetch(`/api/boards/${i}`)).json()).rev === 1, id, 8000);
      free();
      await page.waitForTimeout(400);
      const revAfter = await remoteCall(page, (m, i) => m.get(i).rev, id);
      log('C10 : GET tardif : la révision ne recule pas', revAfter === 1, `rev ${revAfter}`);
      await dup(page);
      await until(page, async i => (await (await fetch(`/api/boards/${i}`)).json()).rev === 2, id, 8000);
      log('C10 : pas de conflit ensuite', (await conflictCopies(page)).length === 0);
      await page.unroute(`**/api/boards/${id}`);
      await context.close();
    },
    async C11() {
      const { context, page, id } = await connected('C11');
      await elsewhere(page, id);
      await page.goto(`${BASE}/#/`);
      await page.evaluate(async () => (await import('/js/store/account.js')).refreshBoards());
      log('C11 : liste : copie périmée vidée', await remoteCall(page, (m, i) => m.get(i).données === null && m.get(i).rev === 1, id));
      await page.route(`**/api/boards/${id}`, r => r.abort());
      await row(page, 'C11').getByRole('button', { name: 'Dupliquer' }).click();
      await page.locator('.notice-error').waitFor();
      log('C11 : serveur injoignable, copie périmée : échec annoncé, pas de copie', (await serverBoards(page)).length === 1);
      await page.unroute(`**/api/boards/${id}`);
      await row(page, 'C11').first().getByRole('button', { name: 'Dupliquer' }).click();
      await row(page, 'C11 (copie)').waitFor();
      const dup11 = (await serverBoards(page)).find(b => b.name === 'C11 (copie)');
      log('C11 : dupliquer lit la version du serveur', (await fetchBoard(page, dup11.id)).board.items.length === 2);
      // Sans que la liste ait été relue
      await page.evaluate(i => fetch(`/api/boards/${i}`).then(r => r.json()).then(s => { const { id: _, icon, rev, createdAt, updatedAt, ...d } = s.board; d.items[0].content = 'encore'; return fetch(`/api/boards/${i}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: rev, data: d }) }); }), id);
      const kept = await remoteCall(page, (m, i) => m.keepCopy(i).then(c => c.données), id);
      log('C11 : garder une copie lit la version du serveur', kept.items.some(x => x.content === 'encore'));
      await context.close();
    },
    async C12() {
      const { context, page, id } = await connected('C12');
      await openBoard(page, id);
      await listen(page);
      let puts = 0, broken = true;
      const message = 'Erreur interne du serveur.';
      await page.route(`**/api/boards/${id}/data`, r => { puts++; return broken ? r.fulfill({ status: 500, json: { code: 'internal', message } }) : r.continue(); });
      await dup(page);
      await page.locator('[data-notice^="save-"]', { hasText: message }).waitFor({ timeout: 6000 });
      log('C12 : 500 JSON : message dès le premier échec', puts === 1, `${puts} PUT`);
      await page.waitForFunction(() => performance.getEntriesByType('resource').filter(e => /\/boards\/[^/]+\/data$/.test(e.name)).length >= 2, null, { timeout: 8000 });
      await page.waitForTimeout(300);
      log('C12 : pas de répétition', await said(page, message) === 1 && await page.locator('[data-notice^="save-"]').count() === 1, `${await said(page, message)} annonce(s)`);
      broken = false;
      await page.locator('[data-notice^="save-"]').waitFor({ state: 'detached', timeout: 15000 });
      log('C12 : message retiré après l’envoi réussi', (await fetchBoard(page, id)).rev === 1);
      await context.close();
    },
    async C13() {
      const { context, page, id: a } = await connected('C13a');
      const b = await seedAndUpload(page, 'C13b', [sticky('item-1', 'y')]);
      await openBoard(page, a);
      let free; const gate = new Promise(r => { free = r; });
      await page.route(`**/api/boards/${a}`, async r => { if (r.request().method() === 'PATCH') await gate; await r.continue(); });
      await page.locator('#board-title').click();
      await page.locator('#board-title-input').fill('Renommé');
      await page.keyboard.press('Enter');
      await openBoard(page, b);
      free();
      await until(page, async i => (await (await fetch(`/api/boards/${i}`)).json()).board.name === 'Renommé', a);
      await page.waitForTimeout(200);
      const state = await page.evaluate(async () => (await import('/js/state.js')).getBoard().name);
      log('C13 : renommer A puis ouvrir B : B garde son nom', state === 'C13b' && (await page.locator('#board-title').textContent()).includes('C13b') && (await page.title()).startsWith('C13b'), state);
      await context.close();
    },
    async C14() {
      const { context, page, id } = await connected('C14');
      await openBoard(page, id);
      await page.waitForTimeout(1300);
      await elsewhere(page, id);
      await fillStorage(page);
      await page.route('**/api/boards', r => (r.request().method() === 'POST' ? r.abort() : r.continue()));
      const aborted = page.waitForEvent('requestfailed', { predicate: r => r.method() === 'POST', timeout: 8000 });
      await dup(page);
      await aborted;
      await page.waitForTimeout(200);
      log('C14 : copie impossible : le travail reste', await remoteCall(page, (m, i) => m.get(i).sortants === true && m.get(i).données.items.length === 2, id));
      await page.unroute('**/api/boards');
      await until(page, async () => (await (await fetch('/api/boards')).json()).boards.some(b => b.name.includes('conflit')), null, 15000);
      log('C14 : au retour du réseau, la copie est créée sans intervention', true);
      await context.close();
    },
    async C15() {
      // Importer un fichier remplacerait la version du serveur : la vue tableau n'en propose plus, l'accueil l'importe dans un nouveau tableau.
      const { context, page, id } = await connected('C15');
      await openBoard(page, id);
      log('C15 : vue tableau sans bouton Importer ni sélecteur de fichier', await page.locator('#btn-import, #file-import').count() === 0 && await page.locator('#app-board').getByRole('button', { name: /^Importer/ }).count() === 0);
      await page.goto(`${BASE}/#/`);
      await page.waitForSelector('#dashboard-title');
      log('C15 : l’import de fichier reste à l’accueil, dans un nouveau tableau', await page.getByRole('button', { name: 'Importer JSON' }).count() === 1);
      const s = await fetchBoard(page, id);
      log('C15 : tableau et serveur intacts', s.rev === 0 && s.board.items.length === 1);
      await context.close();
    },
    async A11Y() {
      // A : contraste accru du système
      const a = await browser.newContext({ viewport: { width: 1280, height: 800 }, contrast: 'more', colorScheme: 'dark' });
      const pa = await a.newPage();
      await register(pa);
      await seedAndUpload(pa, 'Un', []);
      await seedAndUpload(pa, 'Deux', []);
      await pa.waitForSelector('.boards-table');
      log('A : contraste accru : variables de table définies', await pa.evaluate(() => { const s = getComputedStyle(document.documentElement); return ['--table-stripe', '--table-hover', '--outline-hover'].map(v => s.getPropertyValue(v).trim()).join(); }) === '#1a1a1a,#333333,#333333');
      await axe(pa, 'tableau de bord, contraste accru du système');
      // B et C : lien Ouvrir
      for (const theme of ['dark', 'high-contrast']) {
        await pa.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        log(`B : lien Ouvrir à la couleur des liens, ${theme}`, await pa.evaluate(() => getComputedStyle(document.querySelector('.board-actions a')).color === (() => { const p = document.createElement('a'); p.style.color = 'var(--link)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })()));
        await axe(pa, `tableau de bord, ${theme}`);
      }
      log('C : Ouvrir est un lien, sans role', await pa.locator('.board-actions a[role]').count() === 0 && await pa.getByRole('link', { name: 'Ouvrir' }).count() === 2);
      await pa.getByRole('link', { name: 'Ouvrir' }).first().focus();
      await pa.keyboard.press('Enter');
      await pa.waitForSelector('#app-board:not([hidden])');
      log('C : Entrée ouvre le tableau', true);
      await a.close();

      // D : hors ligne, retour, sans répétition
      const { context, page, id } = await connected('D');
      await page.goto(`${BASE}/#/`);
      await listen(page);
      await app.stopBackend();
      await page.evaluate(async () => { const a = await import('/js/store/account.js'); await a.refreshBoards(); });
      await page.locator('[data-notice="server"]').waitFor();
      await page.waitForTimeout(150);
      await page.evaluate(async () => { const a = await import('/js/store/account.js'); await a.refreshBoards(); await a.refreshBoards(); });
      await page.waitForTimeout(300);
      log('D : hors ligne annoncé une seule fois', await said(page, 'Serveur injoignable') === 1, `${await said(page, 'Serveur injoignable')} annonce(s)`);
      await app.startBackend();
      await page.evaluate(async () => (await import('/js/store/account.js')).refreshBoards());
      await page.locator('[data-notice="server"]').waitFor({ state: 'detached' });
      await page.waitForTimeout(150);
      log('D : retour annoncé', await said(page, 'Connexion au serveur rétablie') === 1);

      // E : titre pendant le chargement
      let free; const gate = new Promise(r => { free = r; });
      await page.route(`**/api/boards/${id}`, async r => { await gate; await r.continue(); });
      await page.goto(`${BASE}/#/tableau/${id}`);
      await page.locator('[role="status"]', { hasText: 'Chargement du tableau' }).waitFor();
      log('E : titre du document pendant le chargement', (await page.title()).startsWith('Chargement du tableau'), await page.title());
      free();
      await page.waitForSelector('.canvas-item[data-id="item-1"]');
      await page.unroute(`**/api/boards/${id}`);
      await page.goto(`${BASE}/#/`);

      // Audit : focus rendu quand un message disparaît
      await row(page, 'D').waitFor();
      await page.evaluate(async () => (await import('/js/ui/notice.js')).showNotice('essai', 'Message d’essai'));
      await page.locator('[data-notice="essai"] button').focus();
      await page.keyboard.press('Enter');
      await page.locator('[data-notice="essai"]').waitFor({ state: 'detached' });
      log('Audit : message fermé : le focus ne retombe pas sur la page', await page.evaluate(() => document.activeElement !== document.body && document.activeElement?.id === 'dashboard-title'));

      // Audit : champs obligatoires ; session expirée dialogue ouvert
      await page.click('#btn-account');
      await page.getByRole('heading', { name: 'Mon compte' }).waitFor();
      log('Audit : champs marqués obligatoires', await page.evaluate(() => [...document.querySelectorAll('.account-dialog input')].every(i => i.required)));
      await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }));
      await page.getByRole('button', { name: 'Enregistrer le nom' }).click();
      await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
      log('Audit : session expirée dialogue ouvert : retour à la connexion', (await page.locator('.login-screen').textContent()).includes('session a expiré') && await page.locator('dialog[open]').count() === 0);
      await context.close();
    }
  };
  const ONLY_LIST = ONLY ? ONLY.split(',') : null;
  for (const [name, run] of Object.entries(REG)) {
    if (ONLY_LIST && !ONLY_LIST.includes(name)) continue;
    console.log(`--- ${name} ---`);
    try { await run(); } catch (err) { log(`${name} : exception`, false, err.message.split('\n').slice(0, 3).join(' ')); app.setBodyLimit(); await app.startBackend(); }
  }
} catch (err) {
  log('Exception', false, err.stack || err.message);
} finally {
  await browser.close();
  await app.close();
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
