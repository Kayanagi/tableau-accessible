/*
 * Comptes et tableaux enregistrés (v1.9.0) : cas 1, 8, 9 et 10 du §11 de docs/serveur-temps-reel.md,
 * plus conflit, écriture différée, serveur coupé, tableau distant injoignable et inscriptions fermées.
 * SHOTS=<dossier> écrit des captures d'écran pour relecture.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startAppServer } from './helpers/app-server.mjs';

const require = createRequire(import.meta.url);
const axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.SHOTS || null;
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

async function register(page, name = 'Claire') {
  const email = `u${++userCounter}@exemple.test`;
  await page.goto(`${BASE}/#/compte`);
  await page.waitForSelector('.account-dialog');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Nom affiché').fill(name);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('heading', { name: 'Mon compte' }).waitFor();
  return email;
}

async function closeDialog(page) {
  await page.locator('.account-dialog .dialog-header button').click();
  await page.waitForSelector('.account-dialog', { state: 'detached' });
}

const row = (page, text) => page.locator('.boards-table tbody tr', { hasText: text });
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const mirror = async page => JSON.parse(await stored(page, MIRROR_KEY) || 'null');
const fetchBoard = (page, id) => page.evaluate(async i => (await fetch(`/api/boards/${i}`)).json(), id);

/* Écriture directe sur le serveur, comme le ferait un autre appareil. */
const putDirect = (page, id, baseRev, data) => page.evaluate(async ([i, r, d]) => (await fetch(`/api/boards/${i}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: r, data: d }) })).status, [id, baseRev, data]);

async function seedAndUpload(page, name, items) {
  await page.evaluate(([key, value]) => {
    const current = JSON.parse(localStorage.getItem(key) || '{"version":4,"tableaux":[],"espaces":[]}');
    const seed = JSON.parse(value).tableaux[0];
    seed.id = `board-1-${Math.random().toString(36).slice(2, 8)}`;
    current.tableaux.push(seed);
    localStorage.setItem(key, JSON.stringify(current));
  }, [BOARDS_KEY, seedBoards(name, items)]);
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await row(page, name).getByRole('button', { name: /Enregistrer sur mon compte/ }).click();
  await row(page, name).locator('.board-badge-account').waitFor();
  const href = await row(page, name).locator('a.board-link').getAttribute('href');
  return href.replace('#/tableau/', '');
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
  // === Cas 1 : le mode local ne change pas ===
  {
    console.log('--- Cas 1 : mode local ---');
    const { context, page, api, errors } = await newPage();
    const scripts = [];
    page.on('request', r => { if (/sync\/api\.js|remote-boards\.js|account-dialog\.js/.test(r.url())) scripts.push(r.url()); });
    const seed = seedBoards('Local', [sticky('item-1', 'Bonjour')]);
    await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('semé')) { localStorage.setItem(key, value); sessionStorage.setItem('semé', '1'); } }, [BOARDS_KEY, seed]);
    await page.goto(BASE);
    await page.waitForSelector('.boards-table');
    log('Local : clé identique octet pour octet au chargement', await stored(page, BOARDS_KEY) === seed);
    await page.click('a.board-link');
    await page.waitForSelector('#app-board:not([hidden])');
    await page.click('#btn-sticky');
    await page.evaluate(() => document.getElementById('btn-sticky').click());
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('.boards-table');
    await page.waitForTimeout(300);
    log('Local : aucune requête /api/', api.length === 0, api.join(', '));
    log('Local : aucun module de synchro chargé', scripts.length === 0, scripts.join(', '));
    log('Local : aucun indicateur ni miroir', await stored(page, FLAG_KEY) === null && await stored(page, MIRROR_KEY) === null);
    log('Local : aucun badge', await page.locator('.board-badge').count() === 0);
    log('Local : pas d’action vers le compte', await page.getByRole('button', { name: /Enregistrer sur mon compte/ }).count() === 0);
    const parsed = JSON.parse(await stored(page, BOARDS_KEY));
    log('Local : format v4 conservé', parsed.version === 4 && Array.isArray(parsed.tableaux) && Array.isArray(parsed.espaces));
    await page.click('#btn-account');
    await page.waitForSelector('.account-dialog');
    log('Local : ouvrir le dialogue n’émet aucune requête', api.length === 0, api.join(', '));
    log('Local : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Cas 10 : parcours compte au clavier seul, axe, largeurs ===
  {
    console.log('--- Cas 10 : clavier, axe, largeurs ---');
    const { context, page, errors } = await newPage();
    const email = `u${++userCounter}@exemple.test`;
    await page.goto(BASE);
    await page.waitForSelector('#btn-account');
    await page.focus('#btn-account');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.account-dialog');
    log('Clavier : focus sur le premier champ', await page.evaluate(() => document.activeElement.autocomplete) === 'email');
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
    await page.getByRole('heading', { name: 'Mon compte' }).waitFor();
    log('Clavier : inscription réussie, indicateur posé', await stored(page, FLAG_KEY) === '1');
    log('Indicateur non sensible', !(await stored(page, FLAG_KEY)).includes('@'));
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
    await page.getByLabel('Mot de passe actuel').fill(`trop court mais plus long`);
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
    await page.waitForSelector('.account-dialog', { state: 'detached' });
    log('Déconnexion : indicateur retiré, miroir purgé', await stored(page, FLAG_KEY) === null && await stored(page, MIRROR_KEY) === null);
    await page.click('#btn-account');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill('mot de passe erroné');
    await page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.locator('.field-error', { hasText: 'E-mail ou mot de passe incorrect' }).waitFor();
    log('Connexion refusée : indicateur toujours absent', await stored(page, FLAG_KEY) === null);
    await axe(page, 'connexion avec erreur');
    await shot(page, 'connexion-erreur');
    await page.getByLabel('Mot de passe').fill('un autre mot de passe');
    await page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.getByRole('heading', { name: 'Mon compte' }).waitFor();
    log('Reconnexion avec le nouveau mot de passe', await stored(page, FLAG_KEY) === '1');

    // Suppression : avertissement, mot de passe
    await page.getByRole('button', { name: 'Supprimer mon compte…' }).click();
    await page.getByRole('heading', { name: 'Supprimer le compte' }).waitFor();
    await axe(page, 'suppression du compte');
    await page.getByLabel('Mot de passe').fill('mauvais mot de passe');
    await page.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click();
    await page.locator('.field-error', { hasText: 'Mot de passe incorrect.' }).waitFor();
    log('Suppression : mauvais mot de passe refusé', await stored(page, FLAG_KEY) === '1');
    await page.getByLabel('Mot de passe').fill('un autre mot de passe');
    await page.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click();
    await page.waitForSelector('.account-dialog', { state: 'detached' });
    log('Suppression : indicateur retiré', await stored(page, FLAG_KEY) === null);
    await context.close();
  }

  // === Cas 8 : envoi d'un tableau local ===
  {
    console.log('--- Cas 8 : envoi d’un tableau local ---');
    const { context, page, api, errors } = await newPage();
    await register(page);
    await closeDialog(page);
    const items = [sticky('item-1', 'Accentué : été'), sticky('item-2', 'Deuxième', 300), { id: 'item-3', type: 'connector', x: 0, y: 0, startId: 'item-1', endId: 'item-2', lineType: 'straight', startCap: 'none', endCap: 'arrow_filled', lineStyle: 'solid', strokeWidth: 2, stroke: 'auto', label: '', waypoints: [] }];
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [BOARDS_KEY, seedBoards('À envoyer', items)]);
    await page.reload();
    await row(page, 'À envoyer').locator('.board-badge-device').waitFor();
    log('Badge « Sur cet appareil »', (await row(page, 'À envoyer').locator('.board-badge').textContent()) === 'Sur cet appareil');
    await axe(page, 'tableau de bord connecté');
    await shot(page, 'dashboard-avant-envoi');

    // Échec réseau : l'entrée locale reste
    await page.route('**/api/boards', r => (r.request().method() === 'POST' ? r.abort() : r.continue()));
    await row(page, 'À envoyer').getByRole('button', { name: /Enregistrer sur mon compte/ }).click();
    await page.locator('.notice-error').waitFor();
    log('Envoi échoué : entrée locale conservée', JSON.parse(await stored(page, BOARDS_KEY)).tableaux.length === 1);
    log('Envoi échoué : message visible', (await page.locator('.notice-error').textContent()).includes('injoignable'));
    await page.unroute('**/api/boards');

    // Observe le moment où l'entrée locale disparaît par rapport au 201
    const localBefore = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).tableaux[0].données, BOARDS_KEY);
    let localAtResponse = null;
    await page.route('**/api/boards', async r => {
      if (r.request().method() !== 'POST') return r.continue();
      localAtResponse = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).tableaux.length, BOARDS_KEY);
      return r.continue();
    });
    await row(page, 'À envoyer').getByRole('button', { name: /Enregistrer sur mon compte/ }).click();
    await row(page, 'À envoyer').locator('.board-badge-account').waitFor();
    await page.unroute('**/api/boards');
    log('Entrée locale présente tant que le 201 n’est pas reçu', localAtResponse === 1);
    log('Entrée locale retirée après le 201', JSON.parse(await stored(page, BOARDS_KEY)).tableaux.length === 0);
    const m = await mirror(page);
    log('Miroir écrit avec les données', m?.tableaux?.length === 1 && m.tableaux[0].données?.items?.length === 3 && m.tableaux[0].rev === 0);
    log('Badge « Sur mon compte »', (await row(page, 'À envoyer').locator('.board-badge').textContent()) === 'Sur mon compte');
    const id = m.tableaux[0].id;

    // Rechargement : données identiques
    await page.reload();
    await row(page, 'À envoyer').waitFor();
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.waitForSelector('#app-board:not([hidden])');
    await page.waitForSelector(`.canvas-item[data-id="item-1"]`);
    const server = await fetchBoard(page, id);
    const pick = list => list.map(i => [i.id, i.type, i.content, i.x, i.y, i.width, i.height, i.color, i.startId, i.endId]);
    log('Données identiques au rechargement', JSON.stringify(pick(server.board.items)) === JSON.stringify(pick(localBefore.items)), JSON.stringify(pick(server.board.items)).slice(0, 80));
    log('Tableau affiché : 2 notes et un connecteur', await page.locator('.canvas-item').count() >= 3);
    await shot(page, 'tableau-distant');

    // Aucune écriture à l'ouverture, écriture 3 s après une modification, flush à la sortie
    await page.waitForTimeout(3500);
    log('Ouvrir sans modifier n’écrit rien', !api.some(a => a.startsWith('PUT')), api.filter(a => a.startsWith('PUT')).join(','));
    await page.locator('.canvas-item[data-id="item-1"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(800);
    log('Pas de PUT avant le délai', !api.some(a => a.startsWith('PUT')));
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.endsWith('/data')), null, { timeout: 5000 });
    const afterPut = await fetchBoard(page, id);
    log('PUT après le délai : rev 1, 4 objets', afterPut.rev === 1 && afterPut.board.items.length === 4, `rev ${afterPut.rev}, ${afterPut.board.items.length} objets`);
    const puts = api.filter(a => a.startsWith('PUT')).length;
    await page.locator('.canvas-item[data-id="item-2"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.goto(`${BASE}/#/`);
    await page.waitForFunction(n => performance.getEntriesByType('resource').filter(e => e.name.endsWith('/data')).length > n, puts, { timeout: 2000 });
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

    // Conflit 409
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
    const local = JSON.parse(await stored(page, BOARDS_KEY)).tableaux.find(b => b.nom === copyName);
    log('Conflit : copie locale avec mes modifications', local?.données?.items?.length === 6, `${local?.données?.items?.length} objets`);
    const afterConflict = await fetchBoard(page, id);
    log('Conflit : aucune fusion, serveur intact', afterConflict.board.items.length === 1 && afterConflict.board.items[0].content === 'Écrit ailleurs');
    await page.waitForFunction(() => document.querySelectorAll('.canvas-item').length === 1);
    log('Conflit : version du serveur affichée', true);
    await shot(page, 'conflit');
    await page.waitForTimeout(3500);
    log('Conflit : pas de réécriture ensuite', (await fetchBoard(page, id)).rev === afterConflict.rev);

    // Garder une copie locale
    await page.goto(`${BASE}/#/`);
    await row(page, 'Renommé été').first().waitFor();
    await page.locator('.boards-table tbody tr', { has: page.locator('.board-badge-account') }).getByRole('button', { name: /Garder une copie locale/ }).click();
    await row(page, 'Renommé été (copie locale)').waitFor();
    log('Garder une copie locale : tableau du compte conservé', (await page.evaluate(async i => (await fetch(`/api/boards/${i}`)).status, id)) === 200);
    log('Garder une copie locale : entrée locale ordinaire', JSON.parse(await stored(page, BOARDS_KEY)).tableaux.some(b => b.nom === 'Renommé été (copie locale)' && b.données.items.length === 1));
    log('Envoi et conflit : pas d’erreur console', errors.length === 0, errors.join(' | '));

    // Largeurs du tableau de bord connecté
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      // main coupe ce qui dépasse : scrollWidth du document ne suffit pas à le voir.
      log(`Tableau de bord connecté sans débordement à ${width} px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth));
      await page.locator('.boards-table').scrollIntoViewIfNeeded();
      await shot(page, `dashboard-connecte-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Suppression du compte : avertissement sur les tableaux avec d'autres membres (réponse simulée, le partage arrive en v1.11)
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
    await closeDialog(page);
    // 30 notes de 45 000 caractères : valide pour le serveur, mais au-delà de 2 Mio dans localStorage.
    const huge = Array.from({ length: 30 }, (_, i) => sticky(`item-${i + 1}`, 'é'.repeat(45000), i * 10));
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [BOARDS_KEY, seedBoards('Énorme', huge)]);
    await page.reload();
    await row(page, 'Énorme').getByRole('button', { name: /Enregistrer sur mon compte/ }).click();
    await page.locator('.notice', { hasText: 'trop volumineux' }).waitFor({ timeout: 15000 });
    log('Trop gros pour le miroir : message affiché', true);
    const boardsAfter = JSON.parse(await stored(page, BOARDS_KEY));
    log('Trop gros : tableau local conservé', boardsAfter.tableaux.length === 1 && boardsAfter.tableaux[0].données.items.length === 30);
    const size = (await stored(page, MIRROR_KEY) || '').length * 2;
    log('Miroir sous le plafond de 2 Mio', size <= 2 * 1024 * 1024, `${size} octets`);
    const m = await mirror(page);
    log('Trop gros : entrée du miroir sans données', m.tableaux.length === 1 && m.tableaux[0].données === null);
    await shot(page, 'miroir-plein');
    log('Trop gros : présent sur le compte', (await page.evaluate(async () => (await (await fetch('/api/boards')).json()).boards.length)) === 1);

    // Modifier un tableau local reste enregistré (un petit : le canevas n'est pas fait pour 30 textes de 45 000 caractères)
    await page.evaluate(([k, v]) => { const d = JSON.parse(localStorage.getItem(k)); const b = JSON.parse(v).tableaux[0]; b.id = 'board-2-petit'; d.tableaux.push(b); localStorage.setItem(k, JSON.stringify(d)); }, [BOARDS_KEY, seedBoards('Petit', [sticky('item-1', 'Local')])]);
    await page.reload();
    await row(page, 'Petit').locator('a.board-link').click();
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    await page.locator('.canvas-item[data-id="item-1"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.waitForFunction(k => JSON.parse(localStorage.getItem(k)).tableaux.find(t => t.nom === 'Petit').données.items.length === 2, BOARDS_KEY);
    log('Miroir plein : le tableau local s’enregistre toujours', true);
    await page.goto(`${BASE}/#/`);

    // Éviction : deux tableaux qui tiennent seuls mais pas ensemble ; le moins récent cède
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ version: 4, tableaux: [], espaces: [] })), BOARDS_KEY);
    await page.reload();
    const part = n => Array.from({ length: 12 }, (_, i) => sticky(`item-${i + 1}`, String(n).repeat(45000), i * 10));
    const firstId = await seedAndUpload(page, 'Premier', part(1));
    await page.waitForTimeout(50);
    const secondId = await seedAndUpload(page, 'Second', part(2));
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

    // Quota réel : le miroir cède la place aux tableaux locaux
    await page.evaluate(() => {
      let chunk = 'x'.repeat(1024 * 256), i = 0;
      while (chunk.length >= 1024) { try { localStorage.setItem(`rempli-${i++}`, chunk); } catch { chunk = chunk.slice(0, chunk.length / 2); } }
    });
    const local2 = await page.evaluate(async () => {
      const boards = await import('/js/store/boards.js');
      const b = boards.create('Après quota', { name: 'Après quota', items: [{ id: 'item-1', type: 'text', x: 0, y: 0, content: 'x'.repeat(100000) }] });
      return { failing: boards.isSaveFailing(), saved: JSON.parse(localStorage.getItem('tableau-accessible-boards')).tableaux.some(t => t.id === b.id) };
    });
    log('Quota atteint : le miroir libère la place, tableau local enregistré', local2.saved && !local2.failing, JSON.stringify(local2));

    // Quota sans issue : boards.save() rend compte et un message s'affiche
    const failing = await page.evaluate(async () => {
      const boards = await import('/js/store/boards.js');
      boards.create('Trop', { name: 'Trop', items: [{ id: 'item-1', type: 'text', x: 0, y: 0, content: 'x'.repeat(6000000) }] });
      return boards.isSaveFailing();
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
    await closeDialog(page);
    const id = await seedAndUpload(page, 'Distant', [sticky('item-1', 'Sur le compte')]);
    await page.evaluate(([k, v]) => { const d = JSON.parse(localStorage.getItem(k)); d.tableaux.push(JSON.parse(v).tableaux[0]); localStorage.setItem(k, JSON.stringify(d)); }, [BOARDS_KEY, seedBoards('Ici', [sticky('item-1', 'Local')])]);
    await page.reload();
    await row(page, 'Ici').waitFor();

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

    // Tableaux locaux utilisables
    await page.getByRole('link', { name: 'Retour à l’accueil' }).click();
    await row(page, 'Ici').waitFor();
    log('Serveur coupé : message clair', (await page.locator('#app-notices').textContent()).includes('injoignable'));
    await shot(page, 'serveur-coupe');
    await row(page, 'Ici').locator('a.board-link').click();
    await page.waitForSelector('.canvas-item[data-id="item-1"]');
    await page.locator('.canvas-item[data-id="item-1"]').first().focus();
    await page.keyboard.press('Control+d');
    await page.waitForFunction(k => JSON.parse(localStorage.getItem(k)).tableaux.find(t => t.nom === 'Ici').données.items.length === 2, BOARDS_KEY);
    log('Serveur coupé : tableau local modifiable et enregistré', true);
    await page.goto(`${BASE}/#/`);

    // Rechargement serveur coupé : démarrage sans blocage, indicateur conservé
    await page.reload();
    await row(page, 'Ici').waitFor();
    log('Serveur coupé au démarrage : indicateur conservé', await stored(page, FLAG_KEY) === '1');
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

    // Session expirée : indicateur retiré, plus aucune requête au rechargement
    await page.evaluate(async () => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }));
    await page.goto(`${BASE}/#/tableau/${id}`);
    await page.getByRole('heading', { name: 'Connexion requise' }).waitFor();
    log('Session expirée : message et indicateur retiré', await stored(page, FLAG_KEY) === null);
    log('Session expirée : message visible', (await page.locator('#app-notices').textContent()).includes('session a expiré'));
    api.length = 0;
    await page.goto(`${BASE}/#/`);
    await page.reload();
    await page.waitForSelector('.boards-table');
    await page.waitForTimeout(300);
    log('Session expirée : aucune requête /api/ au rechargement', api.length === 0, api.join(', '));
    const unexpected = errors.filter(e => !/\b(502|401)\b/.test(e));
    log('Serveur coupé : pas d’erreur console inattendue', unexpected.length === 0, unexpected.join(' | '));
    await context.close();
  }

  // === Refus du serveur : le message est affiché tel quel (réponses simulées) ===
  {
    console.log('--- Refus du serveur ---');
    const { context, page } = await newPage();
    await register(page);
    await closeDialog(page);
    const id = await seedAndUpload(page, 'Limité', [sticky('item-1', 'Note')]);
    await page.evaluate(([k, v]) => { const d = JSON.parse(localStorage.getItem(k)); d.tableaux.push(JSON.parse(v).tableaux[0]); localStorage.setItem(k, JSON.stringify(d)); }, [BOARDS_KEY, seedBoards('Refusé', [])]);
    await page.reload();
    await row(page, 'Refusé').waitFor();

    const quota = 'Vous avez atteint la limite de 100 tableaux.';
    await page.route('**/api/boards', r => (r.request().method() === 'POST' ? r.fulfill({ status: 403, json: { code: 'quota_exceeded', message: quota } }) : r.continue()));
    await row(page, 'Refusé').getByRole('button', { name: /Enregistrer sur mon compte/ }).click();
    await page.locator('.notice-error', { hasText: quota }).waitFor();
    log('Quota : message affiché, tableau local conservé', JSON.parse(await stored(page, BOARDS_KEY)).tableaux.some(b => b.nom === 'Refusé'));
    await page.unroute('**/api/boards');

    const tooLarge = 'La requête dépasse la taille maximale de 4 Mio.';
    await page.route('**/api/boards', r => (r.request().method() === 'POST' ? r.fulfill({ status: 413, json: { code: 'body_too_large', message: tooLarge } }) : r.continue()));
    await row(page, 'Refusé').getByRole('button', { name: /Enregistrer sur mon compte/ }).click();
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
} catch (err) {
  log('Exception', false, err.stack || err.message);
} finally {
  await browser.close();
  await app.close();
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
