/*
 * Mot de passe oublié et données du compte sur le serveur (docs/compte-v111.md, §3).
 * Le serveur de test capture les e-mails (BARO_MAIL_CAPTURE) : le lien de réinitialisation y est lu.
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
const RESET_SENT = 'Si un compte existe pour cette adresse, un e-mail vient de partir. Le lien est valable une heure. Pensez à vérifier les indésirables.';
const NEW_PASSWORD = 'nouveau mot de passe solide';
const ACCOUNT_PREFIX = 'tableau-accessible-compte-';

let passed = 0, failed = 0;
function log(label, ok, detail) {
  console.log(`[${ok ? 'OK' : 'ECHEC'}] ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) passed++; else failed++;
}

const app = await startAppServer();
const browser = await chromium.launch({ headless: true });
const BASE = app.origin;

function track(page) {
  const api = [], errors = [], consoleText = [], urls = [];
  page.on('request', r => {
    urls.push(r.url());
    const headers = r.headers();
    if (headers.referer) urls.push(headers.referer);
    if (new URL(r.url()).pathname.startsWith('/api/')) api.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    consoleText.push(m.text());
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return { api, errors, consoleText, urls };
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

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `v111-${name}.png`) }); };
const noOverflow = page => page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  return document.documentElement.scrollWidth <= innerWidth && (!d || d.scrollWidth <= d.clientWidth);
});
const smallTargets = (page, scope) => page.evaluate(sel => [...document.querySelectorAll(`${sel} button, ${sel} input, ${sel} a`)].filter(el => { const r = el.getBoundingClientRect(); return r.width && el.tagName !== 'A' && (r.width < 24 || r.height < 24); }).length, scope);
const focusText = page => page.evaluate(() => document.activeElement?.textContent || '');
const gateShown = page => page.getByRole('heading', { name: 'Se connecter' }).waitFor();
const createBoard = (page, name) => page.evaluate(async n => (await (await import('/js/store/boards.js')).create(n, { name: n, items: [], tags: [] })).id, name);
const serverData = page => page.evaluate(async () => (await (await fetch('/api/me/data', { cache: 'no-store' })).json()));
const accountKeys = page => page.evaluate(p => Object.keys(localStorage).filter(k => k.startsWith(p)), ACCOUNT_PREFIX);
const allStored = page => page.evaluate(() => Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('\n'));
const until = async (fn, timeout = 8000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await new Promise(r => setTimeout(r, 150));
  }
};
const lastLink = email => {
  const mail = app.mails(email).at(-1);
  return mail?.text.match(/https?:\/\/\S+\/reinitialiser\.html#jeton=[A-Za-z0-9_-]+/)?.[0] || null;
};
const resetRequest = (context, email) => context.request.post(`${BASE}/api/auth/password-reset`, { headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: { email } });
const createSpace = async (page, nom) => {
  await page.click('#btn-create-space');
  await page.locator('dialog[open] input').fill(nom);
  await page.locator('dialog[open] form button').first().click();
  await page.locator('.space-row a', { hasText: nom }).waitFor();
};
const spacesOf = page => page.evaluate(async () => (await import('/js/store/boards.js')).getSpaces().map(s => s.nom).sort().join('|'));

try {
  // === Mot de passe oublié : parcours complet, page autonome ===
  {
    console.log('--- Mot de passe oublié ---');
    const owner = await signed('Rémi');
    const email = owner.email;
    log('Avant : session ouverte sur un autre appareil', (await owner.context.request.get(`${BASE}/api/me`)).status() === 200);

    // Même réponse avec ou sans compte
    const known = await resetRequest(owner.context, email);
    const unknown = await resetRequest(owner.context, 'personne-inconnue@exemple.test');
    log('Demande : même statut et même corps avec ou sans compte', known.status() === 202 && unknown.status() === 202 && await known.text() === await unknown.text(), `${known.status()} ${await known.text()} / ${unknown.status()} ${await unknown.text()}`);
    const firstLink = await until(() => lastLink(email));
    log('Demande : e-mail capturé pour le compte', !!firstLink);

    const { context, page, consoleText, urls, errors } = await anon();
    await page.goto(`${BASE}/connexion.html`);
    await gateShown(page);
    await page.getByLabel('Adresse e-mail').fill(email);
    const forgot = page.getByRole('button', { name: 'Mot de passe oublié ?' });
    log('Connexion : lien « Mot de passe oublié ? »', await forgot.count() === 1);
    await forgot.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Mot de passe oublié' }).waitFor();
    const field = page.getByLabel('Adresse e-mail');
    log('Oubli : focus sur le champ, adresse reprise, autocomplete email', await page.evaluate(() => document.activeElement.type === 'email') && await field.inputValue() === email && await field.getAttribute('autocomplete') === 'email');
    await axe(page, 'formulaire « Mot de passe oublié » (page autonome)');
    await field.fill('pas une adresse');
    await page.keyboard.press('Enter');
    const fieldError = page.locator('.field-error:not([hidden])');
    await fieldError.waitFor();
    log('Oubli : erreur reliée au champ, sans alerte', await fieldError.getAttribute('role') === null && await page.evaluate(id => { const a = document.activeElement; return a.type === 'email' && a.getAttribute('aria-invalid') === 'true' && a.getAttribute('aria-describedby').split(' ').includes(id); }, await fieldError.getAttribute('id')));
    await axe(page, 'formulaire « Mot de passe oublié » avec erreur');

    // Adresse sans compte : même message
    await field.fill('personne-inconnue-2@exemple.test');
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await page.getByRole('heading', { name: 'Vérifiez vos e-mails' }).waitFor();
    const unknownMessage = await focusText(page);
    log('Oubli sans compte : message attendu, focus dessus', unknownMessage === RESET_SENT, unknownMessage);
    log('Oubli : rgpd@dwes.fr en dernier recours', await page.getByRole('link', { name: 'rgpd@dwes.fr' }).count() === 1);
    await axe(page, 'message après la demande');
    await page.getByRole('button', { name: 'Retour à la connexion' }).click();
    await gateShown(page);
    await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await page.getByRole('heading', { name: 'Vérifiez vos e-mails' }).waitFor();
    log('Oubli avec compte : exactement le même message', await focusText(page) === RESET_SENT);
    await page.waitForTimeout(500);
    log('Oubli : aucun e-mail pour une adresse sans compte', app.mails('personne-inconnue@exemple.test').length === 0 && app.mails('personne-inconnue-2@exemple.test').length === 0);
    const link = await until(() => app.mails(email).length === 2 && lastLink(email));
    const mail = app.mails(email).at(-1);
    log('E-mail : objet, expéditeur, lien vers reinitialiser.html avec le jeton dans le fragment', mail?.subject === 'Baro : réinitialiser votre mot de passe' && mail.from === 'contact@dwes.fr' && !!link && link.startsWith(`${BASE}/reinitialiser.html#jeton=`), `${mail?.subject} ${mail?.from}`);
    log('E-mail : validité et phrase de sécurité', /une heure/.test(mail?.text) && /Si vous n.êtes pas à l.origine de cette demande, ignorez ce message/.test(mail?.text));
    const token = link.split('#jeton=')[1];
    for (const width of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 700 });
      log(`Message de demande sans débordement à ${width} px`, await noOverflow(page));
    }
    await shot(page, 'oubli-envoye');
    await context.close();

    // Lien remplacé par une demande plus récente
    const old = await anon();
    await old.page.goto(firstLink);
    await old.page.getByRole('heading', { name: 'Choisir un nouveau mot de passe' }).waitFor();
    await old.page.getByLabel('Nouveau mot de passe', { exact: true }).fill(NEW_PASSWORD);
    await old.page.getByLabel('Confirmer le nouveau mot de passe').fill(NEW_PASSWORD);
    await old.page.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' }).click();
    await old.page.getByRole('heading', { name: 'Lien non valable' }).waitFor();
    log('Lien précédent : invalidé par la nouvelle demande, message clair', (await focusText(old.page)).includes('plus valable'));
    log('Lien non valable : lien pour refaire une demande', await old.page.getByRole('link', { name: 'Refaire une demande' }).getAttribute('href') === '/connexion.html#mot-de-passe-oublie');
    await axe(old.page, 'lien non valable');
    await old.page.getByRole('link', { name: 'Refaire une demande' }).click();
    await old.page.getByRole('heading', { name: 'Mot de passe oublié' }).waitFor();
    log('Refaire une demande : le formulaire s’ouvre, le fragment est retiré', !old.page.url().includes('#') && await old.page.evaluate(() => document.activeElement.type === 'email'));
    await old.context.close();

    // Page reinitialiser.html à 320 px, au clavier
    const reset = await anon(320, 700);
    await reset.page.goto(link);
    await reset.page.getByRole('heading', { name: 'Choisir un nouveau mot de passe' }).waitFor();
    log('reinitialiser.html : jeton effacé de la barre d’adresse', !reset.page.url().includes('jeton') && await reset.page.evaluate(() => location.hash === ''), reset.page.url());
    log('reinitialiser.html : focus sur le premier champ, autocomplete new-password', await reset.page.evaluate(() => document.activeElement.autocomplete === 'new-password') && await reset.page.getByLabel('Confirmer le nouveau mot de passe').getAttribute('autocomplete') === 'new-password');
    log('reinitialiser.html : mêmes aides qu’à l’inscription', (await reset.page.locator('.field-hint').allTextContents()).some(t => t.includes('De 12 à 128 caractères')));
    log('reinitialiser.html : sans débordement à 320 px', await noOverflow(reset.page));
    log('reinitialiser.html : cibles de 24 px au moins à 320 px', await smallTargets(reset.page, '.login-card') === 0);
    await axe(reset.page, 'reinitialiser.html à 320 px');
    await shot(reset.page, 'reinitialiser-320');
    for (const theme of ['dark', 'high-contrast']) {
      await reset.page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await axe(reset.page, `reinitialiser.html, thème ${theme}`);
    }
    await reset.page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await reset.page.keyboard.press('Enter');
    const pwError = reset.page.locator('.field-error:not([hidden])').first();
    await pwError.waitFor();
    log('Clavier : Entrée à vide, erreur reliée au premier champ, focus dessus', await reset.page.evaluate(id => { const a = document.activeElement; return a.autocomplete === 'new-password' && a.getAttribute('aria-invalid') === 'true' && a.getAttribute('aria-describedby').split(' ').includes(id); }, await pwError.getAttribute('id')));
    await reset.page.keyboard.type(NEW_PASSWORD);
    await reset.page.keyboard.press('Tab');
    await reset.page.keyboard.type('autre chose encore');
    await reset.page.keyboard.press('Enter');
    await reset.page.locator('.field-error', { hasText: 'pas identiques' }).waitFor();
    log('Clavier : confirmation différente, erreur sur le second champ', await reset.page.evaluate(() => document.activeElement.getAttribute('aria-invalid') === 'true' && document.activeElement.labels[0].textContent === 'Confirmer le nouveau mot de passe'));
    await axe(reset.page, 'reinitialiser.html avec erreurs');
    await reset.page.keyboard.press('Control+A');
    await reset.page.keyboard.type(NEW_PASSWORD);
    await reset.page.keyboard.press('Enter');
    await reset.page.getByRole('heading', { name: 'Mot de passe changé' }).waitFor();
    log('Succès : message focalisé et lien « Se connecter »', (await focusText(reset.page)).includes('mot de passe a été changé') && await reset.page.getByRole('link', { name: 'Se connecter' }).getAttribute('href') === '/');
    await axe(reset.page, 'mot de passe changé');
    log('Jeton jamais dans une adresse, un Referer ou la console', !reset.urls.some(u => u.includes(token)) && !reset.consoleText.some(t => t.includes(token)));
    log('Après confirmation : toutes les sessions du compte sont fermées', (await owner.context.request.get(`${BASE}/api/me`)).status() === 401);
    const login = (password) => reset.context.request.post(`${BASE}/api/auth/login`, { headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: { email, password } });
    log('Nouveau mot de passe accepté, ancien refusé', (await login(TEST_PASSWORD)).status() === 401 && (await login(NEW_PASSWORD)).status() === 200);
    log('reinitialiser.html : pas d’erreur console', reset.errors.length === 0, reset.errors.join(' | '));

    // Usage unique
    const again = await anon();
    await again.page.goto(link);
    await again.page.getByLabel('Nouveau mot de passe', { exact: true }).fill('encore un autre mot de passe');
    await again.page.getByLabel('Confirmer le nouveau mot de passe').fill('encore un autre mot de passe');
    await again.page.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' }).click();
    await again.page.getByRole('heading', { name: 'Lien non valable' }).waitFor();
    log('Jeton déjà utilisé : refusé', true);
    await again.page.goto(`${BASE}/reinitialiser.html`);
    await again.page.getByRole('heading', { name: 'Lien non valable' }).waitFor();
    log('Sans jeton : message clair et lien pour refaire une demande', (await focusText(again.page)).includes('incomplet') && await again.page.getByRole('link', { name: 'Refaire une demande' }).count() === 1);
    await again.context.close();
    await reset.context.close();
    log('Page autonome : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await owner.context.close();
  }

  // === Mot de passe oublié dans l'application (écran de connexion intégré) ===
  {
    console.log('--- Mot de passe oublié dans l’application ---');
    const { context, page, errors } = await anon(320, 700);
    await page.goto(`${BASE}/#/`);
    await gateShown(page);
    await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
    await page.getByRole('heading', { name: 'Mot de passe oublié' }).waitFor();
    log('Application : formulaire d’oubli, focus sur le champ', await page.evaluate(() => document.activeElement.autocomplete === 'email'));
    log('Application : sans débordement à 320 px', await noOverflow(page));
    await axe(page, 'oubli dans l’application à 320 px');
    await page.getByLabel('Adresse e-mail').fill('personne-inconnue-3@exemple.test');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Vérifiez vos e-mails' }).waitFor();
    log('Application : même message après envoi', await focusText(page) === RESET_SENT);
    for (const theme of ['light', 'dark', 'high-contrast']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await axe(page, `message après envoi dans l’application, thème ${theme}`);
    }
    await page.getByRole('button', { name: 'Retour à la connexion' }).click();
    await gateShown(page);
    log('Application : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Données du compte : deux appareils, déconnexion ===
  {
    console.log('--- Données du compte sur deux appareils ---');
    const first = await signed('Ana');
    const { page } = first;
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const boardId = await createBoard(page, 'Tableau partagé entre appareils');
    await createSpace(page, 'Espace d’Ana');
    await page.evaluate(async ([id]) => {
      const boards = await import('/js/store/boards.js');
      boards.toggleFavori(id);
      boards.moveToSpace(id, boards.getSpaces()[0].id);
      (await import('/js/store/templates.js')).saveTemplate('Modèle d’Ana', { name: 'Modèle d’Ana', items: [], tags: [] });
    }, [boardId]);
    log('Rien dans le stockage du navigateur pour le compte', (await accountKeys(page)).length === 0 && !(await allStored(page)).includes('Espace d’Ana'));
    const saved = await until(async () => { const d = await serverData(page); return d.data.modèles.length === 1 && d.data.favoris.length === 1 ? d : null; });
    log('Envoi différé : espace, favori, place et modèle sur le serveur', !!saved && saved.data.espaces[0]?.nom === 'Espace d’Ana' && saved.data.favoris[0] === boardId && saved.data.placement[boardId] === saved.data.espaces[0].id && saved.data.modèles[0].nom === 'Modèle d’Ana', JSON.stringify(saved?.data).slice(0, 200));
    log('Envoi regroupé : quelques PUT seulement', first.api.filter(a => a === 'PUT /api/me/data').length <= 3, String(first.api.filter(a => a === 'PUT /api/me/data').length));

    // Second appareil : connexion par l'écran de l'application
    const second = await anon();
    await second.page.goto(`${BASE}/#/`);
    await gateShown(second.page);
    await second.page.getByLabel('Adresse e-mail').fill(first.email);
    await second.page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
    await second.page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
    await second.page.waitForSelector('#dashboard-title');
    await second.page.locator('.space-row a', { hasText: 'Espace d’Ana' }).waitFor();
    const org = await second.page.evaluate(async id => {
      const boards = await import('/js/store/boards.js');
      const b = boards.getAll().find(x => x.id === id);
      return { favori: b?.favori, espace: boards.getSpaces().find(s => s.id === b?.espaceId)?.nom, modèles: (await import('/js/store/templates.js')).getCustomTemplates().map(t => t.nom).join() };
    }, boardId);
    log('Second appareil : mêmes espaces, favoris, place et modèles', org.favori === true && org.espace === 'Espace d’Ana' && org.modèles === 'Modèle d’Ana', JSON.stringify(org));

    // Modification sur le second appareil, visible au retour sur le premier
    await createSpace(second.page, 'Espace du second appareil');
    await until(async () => (await serverData(second.page)).data.espaces.length === 2);
    await first.page.reload();
    await first.page.locator('.space-row a', { hasText: 'Espace du second appareil' }).waitFor({ timeout: 8000 }).then(() => log('Premier appareil : l’espace créé ailleurs apparaît', true), () => log('Premier appareil : l’espace créé ailleurs apparaît', false));

    // Déconnexion directe : rien n'attend, rien n'est listé
    await second.page.click('#btn-account');
    await second.page.getByRole('button', { name: 'Se déconnecter' }).click();
    await gateShown(second.page);
    log('Déconnexion : sans avertissement, espaces et modèles étant sur le serveur', true);
    const leftover = await allStored(second.page);
    log('Après déconnexion : rien du compte dans le stockage du navigateur', (await accountKeys(second.page)).length === 0 && !/Espace d’Ana|Modèle d’Ana|Espace du second appareil/.test(leftover), leftover.slice(0, 200));
    log('Après déconnexion : copie de travail vidée', await second.page.evaluate(async () => (await import('/js/store/account-local.js')).read().espaces.length === 0));
    log('Deux appareils : pas d’erreur console', first.errors.length === 0 && second.errors.length === 0, [...first.errors, ...second.errors].join(' | '));
    await second.context.close();
    await first.context.close();
  }

  // === Migration depuis l'ancien stockage de l'appareil ===
  {
    console.log('--- Migration de l’ancien stockage ---');
    const { context, page, errors } = await signed('Basile');
    const me = await (await context.request.get(`${BASE}/api/me`)).json();
    const userId = me.user.id;
    const boardRes = await context.request.post(`${BASE}/api/boards`, { headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: { name: 'Tableau de Basile', data: { name: 'Tableau de Basile', items: [], tags: [] } } });
    const boardId = (await boardRes.json()).board.id;
    const legacy = {
      version: 1,
      espaces: [{ id: 'space-ancien-1', nom: 'Espace migré' }],
      favoris: [boardId],
      placement: { [boardId]: 'space-ancien-1' },
      modèles: [{ id: 'custom-ancien-1', nom: 'Modèle migré', description: 'Ancien', créé: 1700000000000, snapshot: { name: 'Modèle migré', items: [] } }],
      usage: { 'custom-ancien-1': 1700000000000 }
    };
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('semé')) { localStorage.setItem(k, v); sessionStorage.setItem('semé', '1'); } }, [ACCOUNT_PREFIX + userId, JSON.stringify(legacy)]);
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const migrated = await until(async () => { const d = await serverData(page); return d.rev > 0 && d.data.modèles.length ? d : null; });
    log('Migration : l’ancien stockage part au serveur', !!migrated && migrated.data.espaces[0]?.nom === 'Espace migré' && migrated.data.modèles[0]?.nom === 'Modèle migré' && migrated.data.favoris[0] === boardId && migrated.data.usage['custom-ancien-1'] === 1700000000000, JSON.stringify(migrated?.data).slice(0, 200));
    log('Migration : la clé locale est effacée après succès', await until(async () => (await accountKeys(page)).length === 0));
    await page.locator('.space-row a', { hasText: 'Espace migré' }).waitFor();
    log('Migration : l’espace s’affiche', true);
    await page.reload();
    await page.waitForSelector('#dashboard-title');
    await page.waitForTimeout(1500);
    const after = await serverData(page);
    log('Migration : une seule fois, sans doublon au rechargement', after.data.espaces.length === 1 && after.data.modèles.length === 1, JSON.stringify(after.data.espaces));
    log('Migration : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Conflit entre deux onglets, hors ligne, déconnexion avec envoi en attente ===
  {
    console.log('--- Deux onglets et hors ligne ---');
    const { context, page, errors } = await signed('Chloé');
    const other = await context.newPage();
    const otherTrack = track(other);
    await page.goto(`${BASE}/#/`);
    await other.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    await other.waitForSelector('#dashboard-title');
    // Les deux onglets partent de la même révision : le second envoi reçoit 409 et fusionne.
    await Promise.all([
      page.evaluate(async () => (await import('/js/store/boards.js')).createSpace('Onglet un')),
      other.evaluate(async () => (await import('/js/store/boards.js')).createSpace('Onglet deux'))
    ]);
    const merged = await until(async () => { const d = await serverData(page); return d.data.espaces.length === 2 ? d : null; });
    log('Conflit entre onglets : les deux espaces sont gardés', !!merged && merged.data.espaces.map(s => s.nom).sort().join('|') === 'Onglet deux|Onglet un', JSON.stringify((await serverData(page)).data.espaces));
    log('Conflit entre onglets : chaque onglet finit par voir les deux', await until(async () => await spacesOf(page) === 'Onglet deux|Onglet un' && await spacesOf(other) === 'Onglet deux|Onglet un'));
    await other.close();

    // Hors ligne : gardé dans l'onglet, envoyé au retour
    await context.setOffline(true);
    await page.evaluate(async () => (await import('/js/store/boards.js')).createSpace('Créé hors ligne'));
    await page.waitForTimeout(1600);
    await context.setOffline(false);
    const back = await until(async () => (await serverData(page)).data.espaces.some(s => s.nom === 'Créé hors ligne'), 10000);
    log('Hors ligne : la modification part au retour de la connexion', !!back);

    // Déconnexion avec un envoi impossible : signalé, réessayé
    // Le dialogue du compte est chargé à la demande : ouvert avant la coupure.
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Se déconnecter' }).waitFor();
    await context.setOffline(true);
    await page.evaluate(async () => (await import('/js/store/boards.js')).createSpace('En attente'));
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByRole('heading', { name: 'Modifications non envoyées' }).waitFor();
    const warning = await page.locator('.account-dialog').textContent();
    log('Déconnexion : changements non envoyés signalés, sans « garder sur cet appareil »', warning.includes('espaces, de favoris ou de modèles') && await page.getByRole('button', { name: 'Les garder sur cet appareil et me déconnecter' }).count() === 0 && await page.getByRole('button', { name: 'Réessayer l’envoi' }).count() === 1);
    log('Déconnexion : focus sur le titre', await page.evaluate(() => document.activeElement.tagName === 'H2'));
    await axe(page, 'avertissement de déconnexion, données du compte');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Réessayer l’envoi' }).click();
    await gateShown(page);
    log('Réessayer l’envoi : envoyé puis déconnecté', true);
    log('Deux onglets et hors ligne : pas d’erreur console', errors.length === 0 && otherTrack.errors.length === 0, [...errors, ...otherTrack.errors].join(' | '));
    await context.close();
  }

  // === Import d'avant les comptes : rien ne quitte l'appareil avant l'accord du serveur ===
  {
    console.log('--- Import refusé par le serveur ---');
    const { context, page, errors } = await signed('Denise');
    const BOARDS_KEY = 'tableau-accessible-boards';
    const TEMPLATES_KEY = 'tableau-accessible-templates';
    const badSnapshot = { name: 'Modèle abîmé', items: [{ id: 'item-1', type: 'sticky_note', x: 0, y: 0, width: 100, height: 100, content: 'x', size: 'énorme' }] };
    const seeds = {
      [BOARDS_KEY]: JSON.stringify({ version: 4, tableaux: [], espaces: [{ id: 'space-avant-a', nom: 'Espace A' }, { id: 'space-avant-b', nom: 'Espace B' }] }),
      [TEMPLATES_KEY]: JSON.stringify([
        { id: 'custom-avant-ok', nom: 'Modèle sain', description: '', créé: 1, snapshot: { name: 'Modèle sain', items: [] } },
        { id: 'custom-avant-abime', nom: 'Modèle abîmé', description: '', créé: 2, snapshot: badSnapshot }
      ])
    };
    await page.addInitScript(s => { if (!sessionStorage.getItem('semé')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('semé', '1'); } }, seeds);
    const common = () => page.evaluate(([b, t]) => ({ espaces: (JSON.parse(localStorage.getItem(b)) || {}).espaces?.map(s => s.id) || [], modèles: (JSON.parse(localStorage.getItem(t)) || []).map(m => m.id) }), [BOARDS_KEY, TEMPLATES_KEY]);
    const quota = route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'quota_exceeded', message: 'Espace de stockage du compte plein (simulé).' }) })
      : route.continue();
    await page.route('**/api/me/data', quota);
    await page.goto(`${BASE}/#/`);
    const dlg = page.locator('.import-dialog');
    await dlg.waitFor();
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const refusedText = await dlg.locator('.import-results').textContent();
    log('Quota (simulé) : chaque espace et modèle est dit refusé, avec la raison', ['Espace « Espace A » : refusé. Espace de stockage du compte plein (simulé).', 'Espace « Espace B » : refusé.', 'Modèle « Modèle sain » : refusé.', 'Modèle « Modèle abîmé » : refusé.'].every(t => refusedText.includes(t)) && refusedText.includes('Il reste sur cet appareil.'), refusedText.slice(0, 300));
    log('Quota (simulé) : aucun « importé » annoncé', !refusedText.includes(': importé') && (await dlg.locator('.import-summary').textContent()).includes('4 refusés'));
    const kept = await common();
    log('Quota (simulé) : rien n’a quitté l’appareil', kept.espaces.join() === 'space-avant-a,space-avant-b' && kept.modèles.join() === 'custom-avant-ok,custom-avant-abime', JSON.stringify(kept));
    log('Quota (simulé) : rien sur le serveur, rien qui attende dans l’onglet', (await serverData(page)).rev === 0 && await page.evaluate(async () => !(await import('/js/store/account-local.js')).hasUnsent()));
    await axe(page, 'compte rendu d’import refusé');

    // Le serveur accepte, sauf un modèle invalide : celui-là reste sur l'appareil, nommé avec sa raison
    await page.unroute('**/api/me/data', quota);
    await page.getByRole('button', { name: 'Revenir à la liste' }).click();
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const mixed = await dlg.locator('.import-results').textContent();
    log('Élément refusé : le reste est importé', mixed.includes('Espace « Espace A » : importé') && mixed.includes('Espace « Espace B » : importé') && mixed.includes('Modèle « Modèle sain » : importé'), mixed.slice(0, 300));
    log('Élément refusé : nommé, avec la raison du serveur, gardé sur l’appareil', /Modèle « Modèle abîmé » : refusé\. Taille inconnue\. Il reste sur cet appareil\./.test(mixed), mixed);
    const left = await common();
    log('Élément refusé : seul lui reste dans l’espace commun', left.espaces.length === 0 && left.modèles.join() === 'custom-avant-abime', JSON.stringify(left));
    const onServer = (await serverData(page)).data;
    log('Élément refusé : le serveur a le reste, pas lui', onServer.espaces.map(s => s.nom).sort().join() === 'Espace A,Espace B' && onServer.modèles.map(t => t.nom).join() === 'Modèle sain', JSON.stringify(onServer.modèles.map(t => t.nom)));
    log('Élément refusé : pas de second message hors du dialogue', await page.locator('[data-notice="account-data"]').count() === 0);
    await axe(page, 'compte rendu d’import avec un élément refusé');
    await page.getByRole('button', { name: 'Terminer' }).click();
    await dlg.waitFor({ state: 'detached' });

    // Hors ligne : en attente, retiré de l'appareil seulement quand l'envoi aboutit
    await page.evaluate(([b]) => { const d = JSON.parse(localStorage.getItem(b)); d.espaces.push({ id: 'space-avant-c', nom: 'Espace C' }); localStorage.setItem(b, JSON.stringify(d)); }, [BOARDS_KEY]);
    await page.click('#btn-account');
    await page.getByRole('button', { name: 'Importer vos tableaux de cet appareil…' }).click();
    await dlg.waitFor();
    await page.getByRole('checkbox', { name: 'Modèle abîmé' }).uncheck();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Importer dans mon compte' }).click();
    await page.getByRole('heading', { name: 'Résultat de l’import' }).waitFor();
    const waiting = await dlg.locator('.import-results').textContent();
    log('Hors ligne : « pas encore enregistré », gardé sur l’appareil', waiting.includes('Espace « Espace C » : pas encore enregistré') && (await common()).espaces.join() === 'space-avant-c', waiting);
    await context.setOffline(false);
    log('Hors ligne : retiré de l’appareil une fois l’envoi abouti', await until(async () => (await common()).espaces.length === 0, 10000) && (await serverData(page)).data.espaces.some(s => s.nom === 'Espace C'));
    log('Import refusé : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Migration : un modèle refusé reste dans l'ancien stockage, le reste part ===
  {
    console.log('--- Migration avec un modèle refusé ---');
    const { context, page, errors } = await signed('Émile');
    const userId = (await (await context.request.get(`${BASE}/api/me`)).json()).user.id;
    const legacy = {
      version: 1,
      espaces: [{ id: 'space-mig-1', nom: 'Espace gardé' }],
      favoris: [], placement: {},
      modèles: [
        { id: 'custom-mig-ok', nom: 'Modèle migré', créé: 1, snapshot: { name: 'Modèle migré', items: [] } },
        { id: 'custom-mig-abime', nom: 'Modèle abîmé', créé: 2, snapshot: { name: 'Modèle abîmé', items: [{ id: 'item-1', type: 'sticky_note', x: 0, y: 0, width: 100, height: 100, content: 'x', size: 'énorme' }] } }
      ],
      usage: { 'custom-mig-abime': 5, 'custom-mig-ok': 6 }
    };
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('semé')) { localStorage.setItem(k, v); sessionStorage.setItem('semé', '1'); } }, [ACCOUNT_PREFIX + userId, JSON.stringify(legacy)]);
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const sent = await until(async () => { const d = await serverData(page); return d.rev > 0 && d.data.modèles.length ? d : null; });
    log('Migration : le reste part au serveur', !!sent && sent.data.espaces[0]?.nom === 'Espace gardé' && sent.data.modèles.map(t => t.nom).join() === 'Modèle migré', JSON.stringify(sent?.data.modèles.map(t => t.nom)));
    const stored = await until(async () => {
      const raw = await page.evaluate(k => localStorage.getItem(k), ACCOUNT_PREFIX + userId);
      const d = raw && JSON.parse(raw);
      return d && d.espaces.length === 0 ? d : null;
    });
    log('Migration : la clé locale garde le seul modèle refusé (et son usage)', !!stored && stored.modèles.map(t => t.id).join() === 'custom-mig-abime' && stored.usage['custom-mig-abime'] === 5 && !('custom-mig-ok' in stored.usage), JSON.stringify(stored).slice(0, 200));
    const notice = page.locator('[data-notice="account-data"]');
    await notice.waitFor({ timeout: 5000 }).catch(() => {});
    log('Migration : le refus est signalé en nommant le modèle', (await notice.textContent().catch(() => '')).includes('modèle « Modèle abîmé »'), await notice.textContent().catch(() => ''));
    await page.reload();
    await page.waitForSelector('#dashboard-title');
    await page.waitForTimeout(1500);
    const again = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), ACCOUNT_PREFIX + userId);
    log('Migration : au rechargement, le modèle refusé est toujours sur l’appareil, rien en double', again?.modèles.map(t => t.id).join() === 'custom-mig-abime' && (await serverData(page)).data.modèles.length === 1);
    log('Migration avec refus : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Refus d'ensemble : les modifications sont réessayées une à une ===
  {
    console.log('--- Quota : une modification refusée, les autres passent ---');
    const { context, page, errors } = await signed('Fanny');
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    await page.route('**/api/me/data', route => (route.request().method() === 'PUT' && (route.request().postData() || '').includes('Trop gros')
      ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'quota_exceeded', message: 'Espace de stockage du compte plein (simulé).' }) })
      : route.continue()));
    await page.evaluate(async () => {
      const boards = await import('/js/store/boards.js');
      boards.createSpace('Accepté');
      boards.createSpace('Trop gros');
      boards.createSpace('Accepté aussi');
    });
    const ok = await until(async () => (await serverData(page)).data.espaces.length === 2);
    log('Refus d’ensemble : les autres modifications du lot sont enregistrées', !!ok && (await serverData(page)).data.espaces.map(s => s.nom).sort().join() === 'Accepté,Accepté aussi', JSON.stringify((await serverData(page)).data.espaces));
    const notice = page.locator('[data-notice="account-data"]');
    await notice.waitFor({ timeout: 5000 }).catch(() => {});
    log('Refus d’ensemble : le message nomme ce qui a été refusé', (await notice.textContent().catch(() => '')).includes('création de l’espace « Trop gros »'), await notice.textContent().catch(() => ''));
    log('Refus d’ensemble : la copie revient à ce que le serveur a', await spacesOf(page) === 'Accepté|Accepté aussi');
    log('Refus d’ensemble : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // === Fermeture avec des changements non envoyés, puis expiration et reconnexion dans le même onglet ===
  {
    console.log('--- Fermeture, expiration et reconnexion ---');
    const { context, page, email, errors } = await signed('Gaspard');
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#dashboard-title');
    const beforeUnload = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
    log('beforeunload : rien à envoyer, rien à demander', await beforeUnload() === false);
    await page.route('**/api/me/data', route => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
    await page.evaluate(async () => (await import('/js/store/boards.js')).createSpace('Gardé dans l’onglet'));
    await page.waitForTimeout(1500);
    log('beforeunload : changement non envoyé, la fermeture est signalée', await beforeUnload() === true);

    // Un autre appareil écrit pendant que la session de cet onglet expire
    const other = await browser.newContext();
    await other.request.post(`${BASE}/api/auth/login`, { headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: { email, password: TEST_PASSWORD } });
    const current = await (await other.request.get(`${BASE}/api/me/data`)).json();
    const put = await other.request.put(`${BASE}/api/me/data`, { headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: { baseRev: current.rev, data: { ...current.data, espaces: [...current.data.espaces, { id: 'space-ailleurs', nom: 'Créé ailleurs' }] } } });
    log('Autre appareil : écriture acceptée', put.ok(), String(put.status()));
    await context.clearCookies();
    await page.evaluate(async () => { await (await import('/js/sync/api.js')).getMe().catch(() => {}); });
    await gateShown(page);
    log('Expiration : le changement non envoyé attend toujours dans l’onglet (fermeture signalée)', await beforeUnload() === true);
    // Les envois restent bloqués : seule une relecture du serveur peut montrer ce que l'autre appareil a écrit.
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(TEST_PASSWORD);
    await page.locator('.account-form').getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.waitForSelector('#dashboard-title');
    await page.locator('.space-row a', { hasText: 'Créé ailleurs' }).waitFor({ timeout: 8000 }).then(() => log('Reconnexion : la copie est relue du serveur (écriture d’un autre appareil visible)', true), () => log('Reconnexion : la copie est relue du serveur (écriture d’un autre appareil visible)', false));
    log('Reconnexion : le changement gardé est toujours là, en attente', await spacesOf(page) === 'Créé ailleurs|Gardé dans l’onglet' && await beforeUnload() === true, await spacesOf(page));
    await page.unroute('**/api/me/data');
    await page.evaluate(async () => (await import('/js/store/account-local.js')).flush());
    const both = await until(async () => { const d = await serverData(page); return ['Créé ailleurs', 'Gardé dans l’onglet'].every(n => d.data.espaces.some(s => s.nom === n)) ? d : null; });
    log('Reconnexion : le changement gardé part, sans écraser l’autre appareil', !!both, JSON.stringify((await serverData(page)).data.espaces.map(s => s.nom)));
    log('beforeunload : plus rien à signaler une fois envoyé', await until(async () => await beforeUnload() === false));
    log('Fermeture et reconnexion : pas d’erreur console', errors.length === 0, errors.join(' | '));
    await other.close();
    await context.close();
  }
} catch (err) {
  console.error(err);
  failed++;
} finally {
  await browser.close();
  await app.close();
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
