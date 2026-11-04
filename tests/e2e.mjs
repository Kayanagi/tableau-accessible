import { chromium } from 'playwright';
import { spawn } from 'child_process';

const PORT = 8765;
const BASE = `http://localhost:${PORT}`;
const results = [];
let passed = 0, failed = 0;

function log(label, ok, detail) {
  const status = ok ? 'OK' : 'ECHEC';
  results.push(`[${status}] ${label}${detail ? ' - ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: '/var/www/tableau-accessible', stdio: 'pipe'
});
await new Promise(r => setTimeout(r, 800));

let browser;
try {
  browser = await chromium.launch({ headless: true });

  // === 1280px tests ===
  console.log('--- Tests a 1280px ---');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  // --- Migration test ---
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('tableau-accessible-board', JSON.stringify({
      name: 'Ancien tableau', items: [
        { id: 'item-1', type: 'sticky_note', x: 100, y: 100, width: 150, height: 150, content: 'Note migrée', color: 'yellow' }
      ]
    }));
  });
  await page.reload();
  await page.waitForLoadState('networkidle');

  const migratedName = await page.textContent('.boards-table td:first-child, .boards-empty');
  log('Migration : ancien tableau visible', migratedName && migratedName.includes('Ancien tableau'), migratedName?.slice(0, 50));

  const hasNewKey = await page.evaluate(() => !!localStorage.getItem('tableau-accessible-boards'));
  log('Migration : nouvelle clé créée', hasNewKey);

  // --- Dashboard structure ---
  const hasNav = await page.$('nav[aria-label="Navigation principale"]');
  log('Dashboard : nav principale', !!hasNav);

  const hasMain = await page.$('main');
  log('Dashboard : landmark main', !!hasMain);

  const hasHeader = await page.$('header[role="banner"]');
  log('Dashboard : header banner', !!hasHeader);

  const skipLink = await page.$('.skip-link');
  log('Dashboard : lien d\'évitement', !!skipLink);

  const h1Text = await page.textContent('#dashboard-title');
  log('Dashboard : h1 présent', h1Text && h1Text.includes('Tableau blanc accessible'), h1Text);

  // --- Create board from template ---
  const tplBtns = await page.$$('.template-btn');
  log('Dashboard : boutons modèles', tplBtns.length >= 5, `${tplBtns.length} modèles`);

  // Click "Organigramme" template (2nd button)
  await tplBtns[1].click();
  await page.waitForFunction(() => location.hash.startsWith('#/tableau/'));
  const boardH1 = await page.textContent('#board-title');
  log('Création depuis modèle : titre', boardH1 === 'Organigramme', boardH1);

  const svgItems = await page.$$('.canvas-item');
  log('Création depuis modèle : éléments SVG', svgItems.length >= 6, `${svgItems.length} éléments`);

  // --- Board features ---
  // Add a sticky note
  await page.click('#btn-sticky');
  await page.waitForSelector('#dialog-item[open]');
  await page.fill('[name="item-content"]', 'Test post-it');
  await page.click('.dialog-submit');
  await page.waitForFunction(() => !document.querySelector('#dialog-item[open]'));
  const announce1 = await page.textContent('#announcer');
  log('Board : post-it créé', announce1 && announce1.includes('ajout'), announce1);

  // Undo / Redo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const undoAnn = await page.textContent('#announcer');
  log('Board : annuler', undoAnn && undoAnn.includes('annul'), undoAnn);

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  const redoAnn = await page.textContent('#announcer');
  log('Board : rétablir', redoAnn && redoAnn.includes('tablie'), redoAnn);

  // Back to dashboard
  await page.click('.btn-back');
  await page.waitForSelector('#dashboard-title');
  const backH1 = await page.textContent('#dashboard-title');
  log('Retour dashboard : h1', backH1 && backH1.includes('Tableau blanc accessible'), backH1);

  // --- Search ---
  const rows1 = await page.$$('.boards-table tbody tr');
  log('Dashboard : tableaux listés', rows1.length >= 2, `${rows1.length} tableaux`);

  await page.fill('#search-boards', 'Organigramme');
  await page.waitForTimeout(100);
  const filteredRows = await page.$$('.boards-table tbody tr');
  log('Recherche : filtre', filteredRows.length === 1, `${filteredRows.length} résultat(s)`);

  const searchStatus = await page.textContent('.search-status');
  log('Recherche : annonce résultats', searchStatus && searchStatus.includes('1'), searchStatus);

  await page.fill('#search-boards', '');
  await page.waitForTimeout(100);

  // --- Sort ---
  const sortBtns = await page.$$('.boards-table .sort-btn');
  if (sortBtns.length >= 1) {
    await sortBtns[0].click();
    await page.waitForTimeout(100);
    const sortedTh = await page.$('.boards-table th[aria-sort="ascending"], .boards-table th[aria-sort="descending"]');
    log('Tri : aria-sort présent', !!sortedTh);
  }

  // --- Favorite ---
  const favBtns = await page.$$('.btn-fav');
  if (favBtns.length > 0) {
    await favBtns[0].click();
    await page.waitForTimeout(200);
    const favAnn = await page.textContent('#announcer');
    log('Favori : toggle', favAnn && favAnn.includes('favori'), favAnn);
  }

  // Navigate to favorites
  await page.click('a[href="#/favoris"]');
  await page.waitForFunction(() => /favoris/i.test(document.querySelector('#dashboard-title')?.textContent || ''), null, { timeout: 3000 }).catch(() => {});
  const favTitle = await page.textContent('#dashboard-title');
  log('Navigation favoris : titre', favTitle && favTitle.includes('favoris'), favTitle);

  const favRows = await page.$$('.boards-table tbody tr');
  log('Favoris : au moins 1 tableau', favRows.length >= 1, `${favRows.length}`);

  // Back to home
  await page.click('a[href="#/"]');
  await page.waitForSelector('#dashboard-title');

  // --- Rename ---
  const renameBtns = await page.$$('button:text("Renommer")');
  if (renameBtns.length > 0) {
    await renameBtns[0].click();
    await page.waitForSelector('#dialog-rename-board[open]');
    await page.fill('[name="rename-name"]', 'Tableau renommé');
    await page.click('#dialog-rename-board .btn-primary');
    await page.waitForFunction(() => !document.querySelector('#dialog-rename-board[open]'));
    await page.waitForTimeout(150);
    const renameAnn = await page.textContent('#announcer');
    log('Renommer : succès', renameAnn && renameAnn.includes('renomm'), renameAnn);

    const renamed = await page.textContent('.boards-table');
    log('Renommer : nom affiché', renamed && renamed.includes('Tableau renomm'), renamed?.slice(0, 80));
  }

  // --- Duplicate ---
  const dupBtns = await page.$$('button:text("Dupliquer")');
  const countBefore = await page.$$eval('.boards-table tbody tr', els => els.length);
  if (dupBtns.length > 0) {
    await dupBtns[0].click();
    await page.waitForTimeout(200);
    const countAfter = await page.$$eval('.boards-table tbody tr', els => els.length);
    log('Dupliquer : +1 tableau', countAfter === countBefore + 1, `${countBefore} -> ${countAfter}`);
  }

  // --- Delete with confirmation ---
  const delBtns = await page.$$('.boards-table .btn-danger');
  const countBeforeDel = await page.$$eval('.boards-table tbody tr', els => els.length);
  if (delBtns.length > 0) {
    await delBtns[delBtns.length - 1].click();
    await page.waitForSelector('#dialog-delete-board[open]');
    log('Suppression : dialog confirmation', true);
    await page.click('#dialog-delete-board .btn-danger');
    await page.waitForFunction(() => !document.querySelector('#dialog-delete-board[open]'));
    await page.waitForTimeout(200);
    const countAfterDel = await page.$$eval('.boards-table tbody tr, .boards-empty', els => els.length);
    log('Suppression : tableau retiré', countAfterDel <= countBeforeDel, `${countBeforeDel} -> ${countAfterDel}`);
  }

  // --- Create via dialog ---
  await page.click('button:text("Créer un tableau")');
  await page.waitForSelector('#dialog-create-board[open]');
  await page.fill('[name="board-name"]', 'Mon tableau test');
  await page.click('#dialog-create-board .btn-primary');
  await page.waitForFunction(() => document.getElementById('board-title')?.textContent === 'Mon tableau test', null, { timeout: 5000 }).catch(() => {});
  const createdTitle = await page.textContent('#board-title');
  log('Création via dialog : titre', createdTitle === 'Mon tableau test', createdTitle);

  // Go back
  await page.click('.btn-back');
  await page.waitForSelector('#dashboard-title');

  // --- Hash navigation & focus ---
  // Navigate to parcourir
  await page.click('a[href="#/parcourir"]');
  await page.waitForFunction(() => /Tous les tableaux/.test(document.querySelector('#dashboard-title')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const parcTitle = await page.textContent('#dashboard-title');
  log('Hash /parcourir : titre', parcTitle && parcTitle.includes('Tous les tableaux'), parcTitle);

  // Open a board via hash
  const boardLinks = await page.$$('.board-link');
  if (boardLinks.length > 0) {
    const href = await boardLinks[0].getAttribute('href');
    await page.goto(BASE + '/' + href);
    await page.waitForSelector('#board-title');
    log('Navigation hash vers tableau', true);

    // Check document.title updated
    const docTitle = await page.title();
    log('document.title mis à jour', docTitle && docTitle.includes('Tableau blanc accessible'), docTitle);
  }

  // Go back to dashboard
  await page.goto(BASE + '/#/');
  await page.waitForSelector('#dashboard-title');

  // --- Grid/list toggle ---
  const toggleBtn = await page.$('#btn-toggle-view');
  if (toggleBtn) {
    const pressed1 = await toggleBtn.getAttribute('aria-pressed');
    log('Bascule : état initial', pressed1 === 'false');
    await toggleBtn.click();
    await page.waitForTimeout(100);
    const pressed2 = await toggleBtn.getAttribute('aria-pressed');
    log('Bascule : aria-pressed toggle', pressed2 === 'true');
    const grid = await page.$('.boards-grid');
    log('Bascule : vue grille affichée', !!grid);
    await toggleBtn.click();
    await page.waitForTimeout(100);
  }

  await page.goto(BASE + '/#/tableau/' + await page.evaluate(async () => {
    const boards = await import('/js/store/boards.js');
    return boards.create('Tests Miro', { name: 'Tests Miro', items: [] }).id;
  }));
  await page.waitForSelector('#app-board:not([hidden])');
  await page.waitForFunction(() => document.getElementById('board-title')?.textContent === 'Tests Miro');
  await page.waitForTimeout(100);
  const load = async items => page.evaluate(async items => {
    const state = await import('/js/state.js');
    state.loadBoard({ name: 'Tests Miro', items });
  }, items);
  const focus = async id => page.evaluate(async id => (await import('/js/views/canvas.js')).focusItem(id), id);
  const snapshot = () => page.evaluate(async () => (await import('/js/state.js')).getSnapshot());
  for (const [key, type] of [['n', 'sticky_note'], ['t', 'text'], ['r', 'shape'], ['l', 'connector']]) {
    await page.focus('#board-title');
    await page.keyboard.press(key);
    const dialog = type === 'connector' ? '#dialog-link' : '#dialog-item';
    log(`Raccourci ${key.toUpperCase()} : dialogue`, await page.locator(dialog).evaluate(el => el.open));
    if (key === 'n') {
      const palette = await page.locator('[name="item-color"]').evaluateAll(els => els.map(el => ({ label: el.getAttribute('aria-label'), color: el.nextElementSibling.style.backgroundColor })));
      const expected = ['#fff79e','#ffe86d','#ffb575','#ff9e9e','#ffd2f2','#fd9ae7','#b2d0fe','#b8acfb','#9ce6ff','#86b4f9','#81e7de','#6ae08d','#d1f09f','#b3e65f','#f3f5f7','#151515'];
      log('Palette : 16 couleurs exactes et radios nommées', await page.evaluate(({ palette, expected }) => palette.length === 16 && palette.every((p, i) => { const el = document.createElement('span'); el.style.color = expected[i]; return p.color === el.style.color && p.label.endsWith(`${i + 1} sur 16`); }), { palette, expected }));
    }
    await page.keyboard.press('Escape');
  }
  const note = (id, x, y, extra = {}) => ({ id, type: 'sticky_note', x, y, width: 100, height: 100, content: id, color: 'yellow', ...extra });
  await load([note('item-1', 100, 100), note('item-2', 300, 100), note('item-3', 600, 100)]);
  log('Couleur ancienne migrée au chargement', (await snapshot()).items[0].color === 'miro_yellow');
  await focus('item-1');
  await page.keyboard.press('Control+d');
  log('Ctrl+D : duplication', (await snapshot()).items.length === 4);
  await page.keyboard.press('Control+Shift+l');
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const locked = (await snapshot()).items[3];
  log('Verrouillage : suppression, déplacement et édition bloqués', locked?.locked && locked.x === 120 && !await page.locator('#dialog-item').evaluate(el => el.open));
  await page.keyboard.press('Control+z');
  const unlocked = !(await snapshot()).items[3].locked;
  await page.keyboard.press('Control+z');
  log('Historique : verrouillage et duplication annulables', unlocked && (await snapshot()).items.length === 3);
  await focus('item-1');
  await page.keyboard.press('PageUp');
  log('Page précédente : premier plan SVG et données', (await snapshot()).items.at(-1).id === 'item-1' && await page.locator('#canvas-items > :last-child').getAttribute('data-id') === 'item-1');
  await page.keyboard.press('Control+Alt+Shift+ArrowRight');
  log('Navigation : objet le plus proche', await page.evaluate(() => document.activeElement.getAttribute('data-id')) === 'item-2');
  await load([{ id: 'item-1', type: 'frame', x: 0, y: 0, width: 500, height: 400, content: 'Cadre' }, note('item-2', 100, 100, { parent: 'item-1' })]);
  await focus('item-1');
  await page.keyboard.press('Control+Shift+ArrowDown');
  const entered = await page.evaluate(() => document.activeElement.getAttribute('data-id')) === 'item-2';
  await page.keyboard.press('Control+Shift+ArrowUp');
  log('Cadre : entrer et sortir', entered && await page.evaluate(() => document.activeElement.getAttribute('data-id')) === 'item-1');
  await page.click('#btn-link');
  await page.selectOption('[name="link-start"]', 'item-1');
  await page.selectOption('[name="link-end"]', 'item-2');
  await page.selectOption('[name="link-type"]', 'orthogonal');
  await page.click('#dialog-link .dialog-submit');
  log('Lien orthogonal : dialogue et tracé SVG', (await snapshot()).items.at(-1).lineType === 'orthogonal' && / H .* V .* H /.test(await page.locator('.type-connector path').first().getAttribute('d')));
  await page.click('#tab-outline');
  await page.keyboard.press('n');
  log('Raccourcis désactivés dans le Plan', !await page.locator('#dialog-item').evaluate(el => el.open));
  await page.click('#tab-canvas');
  await page.click('#btn-sticky');
  await page.fill('[name="item-content"]', 'ntrl');
  log('Raccourcis désactivés dans un champ', await page.inputValue('[name="item-content"]') === 'ntrl' && !await page.locator('#dialog-link').evaluate(el => el.open));
  await page.keyboard.press('Escape');
  await page.focus('#btn-sticky');
  await page.keyboard.press('ArrowDown');
  log('Barre de création : navigation par flèches', await page.evaluate(() => document.activeElement.id) === 'btn-shape');

  log('Pas d\'erreurs console (1280px)', errors.length === 0, errors.join('; '));
  await ctx.close();

  // === 320px tests ===
  console.log('--- Tests a 320px ---');
  const ctx320 = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const p320 = await ctx320.newPage();
  const err320 = [];
  p320.on('console', m => { if (m.type() === 'error') err320.push(m.text()); });
  p320.on('pageerror', e => err320.push(e.message));

  await p320.goto(BASE + '/#/');
  await p320.waitForLoadState('networkidle');

  const title320 = await p320.title();
  log('320px : page chargée', title320.includes('Tableau blanc accessible'));

  const bodyW = await p320.$eval('body', el => el.scrollWidth);
  log('320px : pas de débordement', bodyW <= 320, `scrollWidth=${bodyW}`);

  const navLinks = await p320.$$('.nav-link');
  log('320px : nav visible', navLinks.length === 3);

  // Open a board at 320px
  if (!await p320.locator('.board-link').count()) {
    await p320.locator('.template-btn').first().click();
    await p320.waitForSelector('#app-board:not([hidden])');
    await p320.click('.btn-back');
  }
  const links320 = await p320.$$('.board-link');
  if (links320.length > 0) {
    await links320[0].click();
    await p320.waitForSelector('#board-title');

    const boardBodyW = await p320.$eval('body', el => el.scrollWidth);
    log('320px board : pas de débordement', boardBodyW <= 320, `scrollWidth=${boardBodyW}`);

    const backBtn = await p320.$('.btn-back');
    const backBox = await backBtn?.boundingBox();
    log('320px : bouton retour accessible', backBox && backBox.width >= 24 && backBox.height >= 24, `${backBox?.width}x${backBox?.height}`);
  }

  log('320px : pas d\'erreurs console', err320.length === 0, err320.join('; '));
  await ctx320.close();

} catch (err) {
  log('Exécution complète des tests', false, err.message);
  console.error('Erreur fatale:', err);
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log('\n=== RESULTATS ===');
for (const r of results) console.log(r);
console.log(`\nTotal: ${passed} OK, ${failed} ECHEC sur ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
