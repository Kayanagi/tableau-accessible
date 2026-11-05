import { chromium } from 'playwright';
import { spawn } from 'child_process';

const PORT = Number(process.env.PORT) || 8765;
const BASE = `http://localhost:${PORT}`;
const results = [];
let passed = 0, failed = 0;

function log(label, ok, detail) {
  const status = ok ? 'OK' : 'ECHEC';
  results.push(`[${status}] ${label}${detail ? ' - ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe'
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
  log('Dashboard : h1 présent', h1Text && h1Text.includes('Bon retour'), h1Text);

  // --- Create board from template ---
  const tplBtns = await page.$$('.template-btn');
  log('Dashboard : boutons modèles', tplBtns.length >= 5, `${tplBtns.length} modèles`);

  // Click "Organigramme" template (2nd button)
  await tplBtns[1].click();
  await page.waitForFunction(() => location.hash.startsWith('#/tableau/'));
  const boardH1 = await page.textContent('#board-title');
  log('Création depuis modèle : titre', boardH1.endsWith('Organigramme'), boardH1);

  const svgItems = await page.$$('.canvas-item');
  log('Création depuis modèle : éléments SVG', svgItems.length >= 6, `${svgItems.length} éléments`);

  // --- Board features ---
  // Add a sticky note
  await page.focus('#btn-sticky');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.inline-editor');
  await page.keyboard.type('Test post-it');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.inline-editor') && /ajout/.test(document.getElementById('announcer').textContent));
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
  log('Retour dashboard : h1', backH1 && backH1.includes('Bon retour'), backH1);

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
  await page.waitForFunction(() => location.hash === '#/' && !/favoris/i.test(document.querySelector('#dashboard-title')?.textContent || ''));

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
  await page.waitForSelector('dialog.template-store[open]');
  log('Boutique : ouverte par Créer un tableau, case cochée par défaut', await page.isChecked('#store-on-create'));
  await page.uncheck('#store-on-create');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.template-store'));
  await page.click('button:text("Créer un tableau")');
  await page.waitForSelector('#dialog-create-board[open]');
  log('Boutique : case décochée, dialogue simple', await page.locator('dialog.template-store').count() === 0);
  await page.fill('[name="board-name"]', 'Mon tableau test');
  await page.click('#dialog-create-board .btn-primary');
  await page.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Mon tableau test'), null, { timeout: 5000 }).catch(() => {});
  const createdTitle = await page.textContent('#board-title');
  log('Création via dialog : titre', createdTitle.endsWith('Mon tableau test'), createdTitle);

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
  await page.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Tests Miro'));
  await page.waitForTimeout(100);
  const load = async items => page.evaluate(async items => {
    const state = await import('/js/state.js');
    state.loadBoard({ name: 'Tests Miro', items });
  }, items);
  const focus = async id => page.evaluate(async id => (await import('/js/views/canvas.js')).focusItem(id), id);
  const snapshot = () => page.evaluate(async () => (await import('/js/state.js')).getSnapshot());
  for (const [key, button] of [['n', 'btn-sticky'], ['t', 'btn-text'], ['r', 'btn-shape'], ['l', 'btn-line']]) {
    await page.focus('#board-title');
    await page.keyboard.press(key);
    if (button) log(`Raccourci ${key.toUpperCase()} : outil actif`, await page.getAttribute(`#${button}`, 'aria-pressed') === 'true' && await page.locator('.canvas-svg').getAttribute('data-tool') !== 'select');
    else log(`Raccourci ${key.toUpperCase()} : dialogue`, await page.locator('#dialog-link').evaluate(el => el.open));
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
  log('Raccourcis désactivés dans le Plan', !await page.locator('#dialog-item').evaluate(el => el.open) && await page.getAttribute('#btn-sticky', 'aria-pressed') === 'false');
  await page.click('#tab-canvas');
  await page.focus('#btn-sticky');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.inline-editor');
  await page.keyboard.type('ntrl');
  log('Raccourcis désactivés dans un champ', await page.inputValue('.inline-editor') === 'ntrl' && !await page.locator('#dialog-link').evaluate(el => el.open) && await page.getAttribute('#btn-text', 'aria-pressed') === 'false');
  await page.keyboard.press('Escape');
  await page.focus('#btn-sticky');
  await page.keyboard.press('ArrowDown');
  log('Barre de création : navigation par flèches', await page.evaluate(() => document.activeElement.id) === 'btn-shape');

  // === Manipulation directe (1.3.0) ===
  const canvasCall = (fn, arg) => page.evaluate(async ({ fn, arg }) => (await import('/js/views/canvas.js'))[fn](arg), { fn, arg });
  const box = id => page.locator(`#canvas-items [data-id="${id}"] > :first-child`).boundingBox();
  const mid = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const selection = () => page.evaluate(async () => (await import('/js/state.js')).getSelectedIds());
  const announced = re => page.waitForFunction(src => new RegExp(src).test(document.getElementById('announcer').textContent), re.source);
  const drag = async (from, to, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
  };
  const clickWith = async (p, mods) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(p.x, p.y);
    for (const m of mods) await page.keyboard.up(m);
  };
  const fresh = async items => { await load(items); await canvasCall('zoomReset'); };

  await fresh([]);
  await page.focus('#board-title');
  await page.keyboard.press('n');
  const paletteOk = await page.locator('#sticky-palette input[name="tool-color"]').count() === 16 && await page.evaluate(() => document.activeElement.name === 'tool-color');
  await page.keyboard.press('ArrowRight');
  const svgBox = await page.locator('.canvas-svg').boundingBox();
  const clickAt = { x: svgBox.x + 500, y: svgBox.y + 300 };
  await page.mouse.click(clickAt.x, clickAt.y);
  await page.waitForSelector('.inline-editor');
  let snap = await snapshot();
  const placed = await box(snap.items[0]?.id);
  const c = mid(placed);
  log('Outil N + clic : post-it posé sous le pointeur, couleur choisie, outil Sélection rétabli', paletteOk && snap.items.length === 1 && snap.items[0].color === 'miro_yellow' && Math.abs(c.x - clickAt.x) <= 2 && Math.abs(c.y - clickAt.y) <= 2 && await page.getAttribute('#btn-select', 'aria-pressed') === 'true', `centre ${c.x},${c.y} pour ${clickAt.x},${clickAt.y}`);
  const editorBox = await page.locator('.inline-editor').boundingBox();
  log('Édition sur place : zone de texte nommée, focalisée et superposée à l’objet', await page.evaluate(() => document.activeElement.classList.contains('inline-editor') && !!document.activeElement.getAttribute('aria-label')) && Math.abs(editorBox.x - placed.x) <= 3 && Math.abs(editorBox.width - placed.width) <= 3);
  await page.keyboard.type('Bonjour');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.inline-editor'));
  snap = await snapshot();
  const created = snap.items[0];
  await page.keyboard.press('Control+z');
  log('Création + saisie : texte enregistré, focus rendu, une seule entrée d’historique', created.content === 'Bonjour' && (await snapshot()).items.length === 0);

  await fresh([note('item-1', 100, 100, { content: 'Avant' })]);
  await page.mouse.dblclick(...Object.values(mid(await box('item-1'))));
  await page.waitForSelector('.inline-editor');
  const before = await page.inputValue('.inline-editor');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Après');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.inline-editor'));
  const afterEdit = (await snapshot()).items[0].content;
  const focusBack = await page.evaluate(() => document.activeElement.getAttribute('data-id'));
  await page.keyboard.press('Control+z');
  log('Double-clic, édition sur place puis Échap, annulable en une fois', before === 'Avant' && afterEdit === 'Après' && focusBack === 'item-1' && (await snapshot()).items[0].content === 'Avant');

  await fresh([note('item-1', 100, 100, { width: 150, height: 150, content: 'Court' }), note('item-2', 300, 100, { width: 150, height: 150, content: 'Un texte bien plus long qui doit rétrécir pour tenir dans le post-it sans déborder' })]);
  const sizes = await page.$$eval('#canvas-items .item-text', els => els.map(el => Number(el.getAttribute('font-size'))));
  log('Taille de police Auto : le texte long est plus petit que le court', (await snapshot()).items[0].fontSize === 'auto' && sizes[0] > sizes[1], sizes.join(' / '));

  await fresh([note('item-1', 100, 100), note('item-2', 400, 100), note('item-3', 700, 100)]);
  await page.mouse.click(...Object.values(mid(await box('item-1'))));
  const se = await page.locator('.handle-se').boundingBox();
  await drag(mid(se), { x: mid(se).x + 50, y: mid(se).y + 30 });
  const resized = (await snapshot()).items[0];
  const nw = await page.locator('.handle-nw').boundingBox();
  await drag(mid(nw), { x: mid(nw).x - 40, y: mid(nw).y }, ['Shift']);
  const ratio = (await snapshot()).items[0];
  log('Poignées : redimensionnement à la souris, Maj garde les proportions', resized.width === 150 && resized.height === 130 && resized.x === 100 && ratio.width === 190 && Math.abs(ratio.width / ratio.height - 150 / 130) < 0.02 && ratio.x + ratio.width === 250, `${resized.width}x${resized.height} puis ${ratio.width}x${ratio.height}`);
  await page.keyboard.press('Control+Alt+Shift+Equal');
  const grown = (await snapshot()).items[0];
  log('Ctrl+Alt+Maj+plus agrandit l’objet', grown.width === Math.round(ratio.width * 1.1), `${grown.width}`);

  await fresh([note('item-1', 100, 100), note('item-2', 400, 100), note('item-3', 700, 100)]);
  await page.mouse.click(...Object.values(mid(await box('item-1'))));
  const decorative = await page.getAttribute('#canvas-overlay', 'aria-hidden') === 'true';
  await drag(mid(await page.locator('.link-dot').nth(3).boundingBox()), mid(await box('item-2')));
  snap = await snapshot();
  const link = snap.items.find(i => i.type === 'connector');
  await page.mouse.click(...Object.values(mid(await box('item-1'))));
  const dot = mid(await page.locator('.link-dot').nth(1).boundingBox());
  await drag(dot, { x: dot.x, y: dot.y + 200 });
  log('Point bleu : tirer vers un objet crée une flèche, relâcher dans le vide ne crée rien', decorative && link?.startId === 'item-1' && link.endId === 'item-2' && link.lineType === 'straight' && link.endCap === 'arrow_filled' && (await snapshot()).items.length === 4);

  const b1 = await box('item-1'), b2 = await box('item-2');
  await page.keyboard.press('Escape');
  await drag({ x: b1.x - 20, y: b1.y - 20 }, { x: b2.x + b2.width + 20, y: b2.y + b2.height + 20 });
  await announced(/2 éléments sélectionnés/);
  log('Rectangle de sélection sur le fond (outil Sélection) et annonce', JSON.stringify((await selection()).sort()) === '["item-1","item-2"]');

  await clickWith(mid(await box('item-3')), ['Shift']);
  const three = (await selection()).length;
  await clickWith(mid(await box('item-1')), ['Control']);
  log('Maj+clic et Ctrl+clic ajoutent et retirent', three === 3 && JSON.stringify((await selection()).sort()) === '["item-2","item-3"]');

  const starts = (await snapshot()).items.map(i => i.x);
  await drag(mid(await box('item-2')), { x: mid(await box('item-2')).x + 30, y: mid(await box('item-2')).y });
  const moved = (await snapshot()).items.map(i => i.x);
  await page.keyboard.press('Control+z');
  log('Glisser déplace toute la sélection, une entrée d’historique', moved[1] === starts[1] + 30 && moved[2] === starts[2] + 30 && moved[0] === starts[0] && (await snapshot()).items[2].x === starts[2]);

  await focus('item-1');
  await page.keyboard.press('Control+a');
  await announced(/4 éléments sélectionnés/);
  await page.keyboard.press('Delete');
  const emptied = (await snapshot()).items.length;
  await page.keyboard.press('Control+z');
  log('Ctrl+A, Suppr puis Ctrl+Z', emptied === 0 && (await snapshot()).items.length === 4);

  await focus('item-1');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  snap = await snapshot();
  const pasted = snap.items.slice(4);
  const pastedLink = pasted.find(i => i.type === 'connector');
  const ids = pasted.map(i => i.id);
  log('Copier/coller : décalage de 20 px, nouveaux ids, lien conservé', pasted.length === 4 && pasted[0].x === 120 && pasted[0].y === 120 && ids.includes(pastedLink?.startId) && ids.includes(pastedLink?.endId) && !snap.items.slice(0, 4).some(i => ids.includes(i.id)) && (await selection()).length === 3);
  await page.keyboard.press('Control+x');
  log('Couper retire la sélection', (await snapshot()).items.length === 4);

  await fresh([note('item-1', 100, 100, { color: 'red', bold: true }), note('item-2', 400, 100), note('item-3', 700, 100, { content: 'À effacer' })]);
  await focus('item-1');
  await page.keyboard.press('Control+Alt+c');
  await focus('item-2');
  await page.keyboard.press('Control+Alt+v');
  await focus('item-3');
  await page.keyboard.press('Control+Backspace');
  snap = await snapshot();
  log('Copier/coller le style et effacer le contenu', snap.items[1].color === 'red' && snap.items[1].bold === true && snap.items[2].content === '');

  await fresh([note('item-1', 100, 100), note('item-2', 400, 100), note('item-3', 700, 100)]);
  await page.mouse.click(...Object.values(mid(await box('item-1'))));
  await clickWith(mid(await box('item-2')), ['Shift']);
  const bar = page.locator('.context-toolbar');
  const barBox = await bar.boundingBox();
  const selTop = Math.min((await box('item-1')).y, (await box('item-2')).y);
  const roving = await bar.locator('button[tabindex="0"]').count();
  log('Barre contextuelle : toolbar nommée, au-dessus de la sélection, un seul arrêt Tab', await bar.getAttribute('role') === 'toolbar' && await bar.getAttribute('aria-label') === 'Mise en forme de la sélection' && barBox.y + barBox.height <= selTop && roving === 1);
  await bar.locator('[data-key="color"]').click();
  await page.locator('.context-menu [role="menuitemradio"]').nth(7).click();
  await bar.locator('[data-key="bold"]').click();
  snap = await snapshot();
  const styled = snap.items.slice(0, 2).every(i => i.color === 'violet' && i.bold);
  await page.keyboard.press('Control+z');
  snap = await snapshot();
  log('Barre contextuelle : couleur et gras appliqués aux deux éléments, gras annulé en une fois', styled && snap.items[1].color === 'violet' && !snap.items[0].bold && !snap.items[1].bold);

  await focus('item-1');
  await page.keyboard.press('Alt+F10');
  const inBar = await page.evaluate(() => !!document.activeElement.closest('.context-toolbar'));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const second = await page.evaluate(() => document.activeElement.dataset.key);
  await page.keyboard.press('Escape');
  log('Alt+F10 vers la barre, flèches, Échap revient à l’objet', inBar && second === 'font-auto' && await page.evaluate(() => document.activeElement.getAttribute('data-id')) === 'item-1');

  await page.keyboard.press('h');
  const vb = await page.getAttribute('.canvas-svg', 'viewBox');
  const handStart = mid(await box('item-1'));
  await drag(handStart, { x: handStart.x + 80, y: handStart.y + 40 });
  log('Outil Main : glisser un objet déplace la vue, pas l’objet', await page.getAttribute('#btn-hand', 'aria-pressed') === 'true' && (await snapshot()).items[0].x === 100 && await page.getAttribute('.canvas-svg', 'viewBox') !== vb);
  await page.keyboard.press('v');

  await fresh([]);
  await page.focus('#btn-text');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.inline-editor');
  await page.keyboard.type('Au clavier');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.inline-editor'));
  snap = await snapshot();
  const center = await page.evaluate(async () => (await import('/js/views/canvas.js')).getViewCenter());
  const t = snap.items[0];
  log('Voie clavier : Entrée sur le bouton crée au centre de la vue et édite', t?.type === 'text' && t.content === 'Au clavier' && Math.abs(t.x + t.width / 2 - center.x) <= 10 && Math.abs(t.y + t.height / 2 - center.y) <= 10 && await page.evaluate(id => document.activeElement.getAttribute('data-id') === id, t.id));

  await fresh([note('item-1', 100, 100), note('item-2', 400, 100)]);
  await focus('item-1');
  await page.keyboard.press('Control+a');
  await page.click('#tab-outline');
  const outlineSel = await page.$$eval('#view-outline [role="treeitem"][aria-selected="true"]', els => els.length);
  await page.locator('#view-outline .select-box').first().uncheck();
  const afterUncheck = await selection();
  await page.click('#tab-table');
  const tableChecked = await page.$$eval('#view-table .select-box:checked', els => els.length);
  log('Plan et Tableau : sélection multiple synchronisée (aria-selected, cases à cocher)', outlineSel === 2 && JSON.stringify(afterUncheck) === '["item-2"]' && tableChecked === 1);
  await page.click('#tab-canvas');

  // === Nouveaux objets (1.4.0) ===
  const label = id => page.getAttribute(`#canvas-items [data-id="${id}"]`, 'aria-label');
  const activeId = () => page.evaluate(() => document.activeElement.closest('.canvas-item')?.getAttribute('data-id'));
  const fromPanel = async query => {
    await page.click('#btn-more-tools');
    await page.waitForSelector('#tools-panel:not([hidden])');
    await page.fill('#tools-search', query);
    await page.keyboard.press('Enter');
  };

  await fresh([]);
  await page.click('#btn-more-tools');
  const dlg = await page.getAttribute('#tools-panel', 'role') === 'dialog' && await page.evaluate(() => document.activeElement.id) === 'tools-search';
  await page.fill('#tools-search', 'kanban');
  const visibleTools = await page.$$eval('#tools-panel .tools-list button', els => els.filter(b => !b.closest('[hidden]')).map(b => b.dataset.tool));
  await page.keyboard.press('Escape');
  log('Plus d’outils : dialogue, recherche filtrée, Échap rend le focus', dlg && JSON.stringify(visibleTools) === '["kanban"]' && await page.isHidden('#tools-panel') && await page.evaluate(() => document.activeElement.id) === 'btn-more-tools' && await page.getAttribute('#btn-more-tools', 'aria-expanded') === 'false');

  await page.click('#btn-more-tools');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const secondTool = await page.evaluate(() => document.activeElement.dataset.tool);
  await page.keyboard.press('Escape');
  const arrowsOk = secondTool === 'eraser';

  await fromPanel('recto');
  await page.waitForSelector('.inline-editor');
  await page.keyboard.type('Question');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.inline-editor'));
  snap = await snapshot();
  const fc = snap.items[0];
  log('Carte recto-verso : créée au clavier depuis le panneau (flèches, recherche), nom accessible', arrowsOk && fc?.type === 'flipcard' && /Carte recto-verso, recto visible : Question/.test(await label(fc.id)));
  await page.keyboard.press('Space');
  await announced(/Verso visible/);
  const flipped = (await snapshot()).items[0].flipped;
  await page.keyboard.press('Control+z');
  log('Carte recto-verso : Espace retourne, annonce, annulable', flipped === true && (await snapshot()).items[0].flipped === false);

  await fresh([]);
  await page.focus('#board-title');
  await page.keyboard.press('p');
  const sb = await page.locator('.canvas-svg').boundingBox();
  const penFrom = { x: sb.x + 400, y: sb.y + 300 }, penTo = { x: sb.x + 520, y: sb.y + 360 };
  await drag(penFrom, penTo);
  snap = await snapshot();
  const dr = snap.items[0];
  log('Stylo (P) : tracé à main levée, polyline compacte', dr?.type === 'drawing' && dr.points.length >= 4 && dr.points.length < 40 && await page.locator('#canvas-items .type-drawing polyline').count() === 2 && /^Dessin à main levée/.test(await label(dr.id)));
  await page.keyboard.press('Escape');
  await focus(dr.id);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.field-editor');
  await page.keyboard.type('Flèche');
  await page.keyboard.press('Enter');
  snap = await snapshot();
  log('Tracé au clavier : déplacé et étiquette modifiable', snap.items[0].x === dr.x + 10 && snap.items[0].content === 'Flèche' && /Dessin à main levée : Flèche/.test(await label(dr.id)) && await activeId() === dr.id);
  await page.keyboard.press('e');
  await drag(penFrom, penTo);
  log('Gomme (E) : le tracé touché est supprimé', (await snapshot()).items.length === 0);
  await page.keyboard.press('Escape');

  await fresh([note('item-1', 100, 100), note('item-2', 300, 100), note('item-3', 600, 100)]);
  await focus('item-1');
  await clickWith(mid(await box('item-2')), ['Shift']);
  await page.keyboard.press('Control+g');
  snap = await snapshot();
  const grouped = snap.items[0].groupId && snap.items[0].groupId === snap.items[1].groupId;
  await page.keyboard.press('Escape');
  await page.mouse.click(...Object.values(mid(await box('item-2'))));
  const whole = (await selection()).length;
  await page.mouse.dblclick(...Object.values(mid(await box('item-2'))));
  const inside = JSON.stringify(await selection());
  log('Groupe : Ctrl+G, un clic sélectionne le groupe, double-clic entre dedans', grouped && whole === 2 && inside === '["item-2"]' && /dans un groupe de 2/.test(await label('item-1')));
  await page.click('#tab-outline');
  const groupNode = await page.locator('#view-outline [data-group]').textContent();
  const nested = await page.locator('#view-outline [role="treeitem"]:has([data-group]) [role="group"] .outline-item-btn').count();
  await page.click('#tab-canvas');
  await focus('item-1');
  await page.keyboard.press('Control+Shift+g');
  log('Groupe : nœud parent dans le Plan, Ctrl+Maj+G dégroupe', /Groupe de 2 éléments/.test(groupNode) && nested === 2 && !(await snapshot()).items.some(i => i.groupId));

  await page.evaluate(() => localStorage.setItem('tableau-accessible-auteur', 'Wesley'));
  await fresh([note('item-1', 100, 100, { content: 'Idée' })]);
  await focus('item-1');
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#comments-panel:not([hidden])');
  const replyFocused = await page.evaluate(() => document.activeElement.matches('.comment-reply textarea'));
  await page.keyboard.type('À revoir');
  await page.click('.comment-reply button[type="submit"]');
  await announced(/Message publié/);
  snap = await snapshot();
  const cm = snap.items.find(i => i.type === 'comment');
  log('Commentaire (C) : posé sur l’objet, fil avec auteur mémorisé et date', replyFocused && cm?.targetId === 'item-1' && cm.messages[0]?.author === 'Wesley' && !!cm.messages[0].date && /Commentaire de Wesley : « À revoir », 1 message, non résolu, sur Post-it/.test(await label(cm.id)) && /1 commentaire/.test(await label('item-1')) && await page.locator('.comment-messages time[datetime]').count() === 1);
  await page.click('.comment-actions [data-act="resolve"]');
  await announced(/Commentaire résolu/);
  const resolved = (await snapshot()).items.find(i => i.type === 'comment').resolved;
  await page.click('.comment-actions [data-act="goto"]');
  const atTarget = await activeId();
  await page.keyboard.press('Shift+C');
  const hiddenAfter = await page.isHidden('#comments-panel');
  await page.keyboard.press('Shift+C');
  const shownAgain = await page.isVisible('#comments-panel');
  await page.keyboard.press('Escape');
  log('Commentaire : résolu annoncé, navigation vers l’objet, Maj+C affiche et masque', resolved === true && atTarget === 'item-1' && hiddenAfter && shownAgain && await page.isHidden('#comments-panel'));

  await fresh([note('item-1', 100, 100, { content: 'A' }), note('item-2', 400, 100, { content: 'B' }), { id: 'item-3', type: 'card', x: 700, y: 100, width: 200, height: 120, title: 'C', content: '' }]);
  await page.evaluate(async () => { const s = await import('/js/state.js'); s.createTag('Urgent', 'red', ['item-1', 'item-3']); });
  await page.waitForSelector('#canvas-items [data-id="item-1"] .tag-pill');
  const tagLabel = await label('item-3');
  await page.click('#tab-table');
  await page.selectOption('#table-tag-filter', { label: 'Urgent' });
  const rows = await page.$$eval('#view-table .items-table:not(.data-grid) tbody tr', els => els.map(e => e.dataset.id).sort());
  await page.selectOption('#table-tag-filter', '');
  await page.click('#tab-canvas');
  log('Étiquettes : affichées, dans le nom accessible, filtrées dans la vue Tableau', /étiquettes : Urgent/.test(tagLabel) && JSON.stringify(rows) === '["item-1","item-3"]');
  await page.mouse.click(...Object.values(mid(await box('item-2'))));
  await page.locator('.context-toolbar [data-key="tags"]').click();
  await page.locator('.context-menu [role="menuitemcheckbox"]').first().click();
  log('Étiquettes : ajout depuis la barre contextuelle', (await snapshot()).items[1].tags?.length === 1);

  await page.locator('.context-toolbar [data-key="react"]').click();
  await page.locator('.context-menu [role="menuitemcheckbox"]').first().click();
  await announced(/Réaction pouce levé ajoutée, 1 au total/);
  log('Réactions : compteur visible et dans le nom accessible', /réactions : 👍 pouce levé 1/.test(await label('item-2')) && /👍 1/.test(await page.locator('#canvas-items [data-id="item-2"]').textContent()));

  await fresh([]);
  await fromPanel('mentale');
  await page.waitForSelector('.inline-editor');
  await page.keyboard.type('Racine');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.activeElement.classList.contains('inline-editor') && !document.activeElement.value);
  await page.keyboard.type('Enfant');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement.classList.contains('inline-editor') && !document.activeElement.value);
  await page.keyboard.type('Frère');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.inline-editor'));
  snap = await snapshot();
  const [root, kid, sib] = snap.items;
  log('Carte mentale : Tab ajoute un enfant, Entrée un frère, disposition horizontale', root?.content === 'Racine' && kid?.parentNode === root.id && sib?.parentNode === root.id && kid.x > root.x + root.width && kid.x === sib.x && sib.y > kid.y && await page.locator('#canvas-items path[d*=" C "]').count() === 2);
  await page.keyboard.press('ArrowUp');
  const up = await activeId();
  await page.keyboard.press('ArrowLeft');
  const toRoot = await activeId();
  await page.keyboard.press('ArrowLeft');
  const folded = (await snapshot()).items[0].collapsed && await page.locator('#canvas-items .type-mindmap').count() === 1;
  await page.click('#tab-outline');
  const tree = await page.$eval('#view-outline [role="treeitem"][aria-expanded]', el => el.getAttribute('aria-expanded') + ':' + el.querySelectorAll('[role="group"] .outline-item-btn').length);
  await page.click('#tab-canvas');
  log('Carte mentale : flèches dans l’arbre, plier, arbre imbriqué dans le Plan', up === kid.id && toRoot === root.id && folded && tree === 'false:2');

  const kb = { id: 'item-1', type: 'kanban', x: 100, y: 100, content: 'Sprint', columns: [{ id: 'c1', name: 'À faire', cards: [{ id: 'k1', text: 'Tâche A' }, { id: 'k2', text: 'Tâche B' }] }, { id: 'c2', name: 'En cours', cards: [{ id: 'k3', text: 'Tâche C' }] }, { id: 'c3', name: 'Fait', cards: [] }] };
  await fresh([kb]);
  await focus('item-1');
  await page.keyboard.press('Enter');
  const onCard = await page.evaluate(() => document.activeElement.dataset.sub);
  await page.keyboard.press('Control+ArrowRight');
  await announced(/Carte Tâche A déplacée dans En cours, position 1 sur 2/);
  const kbSnap = (await snapshot()).items[0];
  await page.keyboard.press('Control+ArrowDown');
  await announced(/position 2 sur 2/);
  log('Kanban : Ctrl+flèches déplacent la carte entre colonnes et dans l’ordre, annonce', onCard === 'card:k1' && kbSnap.columns[1].cards[0].id === 'k1' && (await snapshot()).items[0].columns[1].cards[1].id === 'k1' && await page.evaluate(() => document.activeElement.dataset.sub) === 'card:k1' && /Kanban : Sprint, 3 colonnes, 3 cartes/.test(await label('item-1')));
  await page.keyboard.press('Escape');
  const cardB = mid(await page.locator('[data-sub="card:k2"] rect').boundingBox());
  const colFait = await page.locator('[data-sub="col:c3"] > rect').boundingBox();
  await drag(cardB, { x: colFait.x + colFait.width / 2, y: colFait.y + 50 });
  await announced(/Carte Tâche B déplacée dans Fait/);
  log('Kanban : glisser une carte vers une autre colonne', (await snapshot()).items[0].columns[2].cards[0]?.id === 'k2');

  await fresh([{ id: 'item-1', type: 'datatable', x: 100, y: 100, content: 'Budget', rows: [['Poste', 'Montant'], ['', ''], ['', '']] }]);
  await focus('item-1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.field-editor');
  await page.keyboard.type('120');
  await page.keyboard.press('Enter');
  snap = await snapshot();
  const cellRole = await page.evaluate(() => document.activeElement.getAttribute('role') + ':' + document.activeElement.dataset.sub);
  await page.locator('.context-toolbar [data-key="dt-row"]').click();
  const rowsAfter = (await snapshot()).items[0].rows.length;
  await page.click('#tab-table');
  const grid = await page.$$eval('#view-table .data-grid th[scope="col"]', els => els.map(e => e.textContent).join(','));
  await page.click('#tab-canvas');
  log('Tableau de données : cellules au clavier, édition, ajout de ligne, rendu en table', snap.items[0].rows[1][1] === '120' && cellRole === 'gridcell:cell:1:1' && rowsAfter === 4 && grid === 'Poste,Montant' && /Tableau de données : Budget, 3 lignes, 2 colonnes/.test(await label('item-1')), `${snap.items[0].rows[1][1]} ${cellRole} ${rowsAfter} ${grid} ${await label('item-1')}`);

  await fresh([{ id: 'item-1', type: 'code', x: 100, y: 100, width: 320, height: 180, language: 'javascript', content: 'const x = 1; // un\nreturn "ok";' }]);
  const kw = await page.$$eval('#canvas-items .code-text tspan', els => els.filter(e => e.textContent === 'const').map(e => e.getAttribute('fill')));
  await focus('item-1');
  const langBtn = await page.locator('.context-toolbar [data-key="lang"]').textContent();
  log('Bloc de code : nom accessible, coloration, langage dans la barre', /Bloc de code JavaScript : const x = 1; \/\/ un, 2 lignes/.test(await label('item-1')) && kw[0] === '#c9b5ff' && langBtn === 'JavaScript' && await page.locator('.context-toolbar [data-key="copy-code"]').count() === 1);

  await fresh([{ id: 'item-1', type: 'mindmap', x: 100, y: 100, content: 'R', parentNode: null }, { id: 'item-2', type: 'mindmap', x: 0, y: 0, content: 'E', parentNode: 'item-1' }, note('item-3', 500, 100, { groupId: 'g1' }), note('item-4', 700, 100, { groupId: 'g1' })]);
  await focus('item-1');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  snap = await snapshot();
  const pastedMap = snap.items.slice(4);
  const newRoot = pastedMap.find(i => i.type === 'mindmap' && !i.parentNode);
  const newGroup = pastedMap.filter(i => i.type === 'sticky_note').map(i => i.groupId);
  log('Copier-coller : arbre et groupe recréés avec de nouveaux identifiants', pastedMap.length === 4 && pastedMap.some(i => i.parentNode === newRoot?.id) && newGroup[0] && newGroup[0] === newGroup[1] && newGroup[0] !== 'g1');

  // Dashboard et modèles (1.5.0), contexte isolé.
  const dashContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const d = await dashContext.newPage();
  await d.goto(BASE + '/#/');
  await d.waitForSelector('#btn-create-space');
  await d.click('#btn-create-space');
  await d.locator('dialog[open] input').fill('Atelier');
  await d.locator('dialog[open] form button').first().click();
  await d.waitForFunction(() => document.querySelector('.space-row a')?.textContent === 'Atelier');
  log('Espace : création', await d.locator('.space-row a').count() === 1);
  await d.getByRole('button', { name: 'Renommer l’espace Atelier', exact: true }).click();
  await d.locator('dialog[open] input').fill('Équipe');
  await d.locator('dialog[open] form button').first().click();
  await d.waitForFunction(() => document.querySelector('.space-row a')?.textContent === 'Équipe');
  log('Espace : renommage accentué', await d.locator('.space-row a').textContent() === 'Équipe');
  await d.click('[data-template="retrospective"]');
  await d.waitForFunction(() => location.hash.startsWith('#/tableau/'));
  const dashBoardId = await d.evaluate(() => location.hash.split('/').pop());
  await d.click('#board-title');
  await d.fill('#board-title-input', 'Titre validé');
  await d.keyboard.press('Enter');
  await d.waitForFunction(() => document.querySelector('#board-title').textContent.includes('Titre validé'));
  log('Titre : Entrée renomme et sauvegarde', await d.evaluate(async id => (await import('/js/store/boards.js')).get(id).nom, dashBoardId) === 'Titre validé');
  await d.focus('#board-title'); await d.keyboard.press('Enter');
  await d.fill('#board-title-input', 'À annuler'); await d.keyboard.press('Escape');
  log('Titre : Échap annule', (await d.textContent('#board-title')).includes('Titre validé'));
  await d.click('.btn-back');
  await d.waitForSelector('.boards-table');
  await d.locator('.boards-table select').selectOption('launch');
  log('Tableau : image vectorielle affichée et sauvegardée', await d.locator('.board-link .board-icon').count() === 1 && await d.evaluate(async id => (await import('/js/store/boards.js')).get(id).icon, dashBoardId) === 'launch');
  await d.getByRole('button', { name: 'Déplacer', exact: true }).click();
  await d.locator('dialog[open] select').selectOption({ label: 'Équipe' });
  await d.getByRole('button', { name: 'Déplacer le tableau', exact: true }).click();
  log('Tableau : déplacement dans un espace', !!await d.evaluate(async id => (await import('/js/store/boards.js')).get(id).espaceId, dashBoardId));
  await d.locator('.space-row a').click();
  await d.waitForFunction(() => location.hash.startsWith('#/espace/') && document.querySelector('#dashboard-title')?.textContent === 'Équipe');
  log('Route espace : tableau filtré', await d.locator('.board-link').count() === 1);
  await d.getByRole('button', { name: 'Supprimer l’espace Équipe', exact: true }).click();
  log('Espace : suppression confirmée par dialogue', await d.locator('dialog[open]').count() === 1);
  await d.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
  await d.waitForFunction(() => location.hash === '#/' && !document.querySelector('.space-row'));
  log('Espace : suppression conserve le tableau', await d.locator('.board-link').count() === 1);
  await d.click('#btn-template-library');
  await d.waitForSelector('dialog.template-store[open]');
  const totalTemplates = await d.locator('.store-card').count();
  const allCurrent = await d.getAttribute('.store-nav [data-section="all"]', 'aria-current') === 'true';
  log('Boutique : au moins 40 modèles, anciens identifiants conservés', totalTemplates >= 40 && await d.evaluate(async () => { const { getTemplate } = await import('/js/store/templates.js'); return ['vierge', 'organigramme', 'retrospective', 'feuille-de-route', 'liste-taches', 'brainstorming', 'start-stop-continue', 'daily', 'kanban-projet', 'diagramme-flux', 'carte-mentale', 'eisenhower', 'swot', 'persona', 'parcours-utilisateur', 'lean-canvas', 'user-story-map', 'effort-impact', 'ordre-du-jour', 'revue-sprint'].every(getTemplate); }), `${totalTemplates} modèles`);
  log('Boutique : grande fenêtre, navigation et colonne active', allCurrent && (await d.locator('dialog.template-store').boundingBox()).width > 1000 && await d.locator('.store-nav [data-section]').count() === 12 && await d.evaluate(() => document.activeElement.id) === 'store-search');
  await d.click('.store-nav [data-section="cat:Agile"]');
  const agileCount = await d.locator('.store-card').count();
  log('Boutique : catégorie Agile et aria-current', agileCount >= 8 && agileCount < totalTemplates && await d.getAttribute('.store-nav [data-section="cat:Agile"]', 'aria-current') === 'true' && await d.getAttribute('.store-nav [data-section="all"]', 'aria-current') === null);
  await d.click('.store-pill[data-tag="Scrum"]');
  const scrumNames = await d.locator('.store-card h4').allTextContents();
  log('Boutique : sous-filtre en pastille (aria-pressed)', scrumNames.length >= 3 && scrumNames.length < agileCount && scrumNames.includes('Backlog produit') && await d.getAttribute('.store-pill[data-tag="Scrum"]', 'aria-pressed') === 'true');
  await d.selectOption('#store-sort', 'name');
  const sortedNames = await d.locator('.store-card h4').allTextContents();
  log('Boutique : tri Nom A-Z', JSON.stringify(sortedNames) === JSON.stringify([...sortedNames].sort((a, b) => a.localeCompare(b, 'fr'))) && await d.evaluate(() => document.activeElement.id) === 'store-sort');
  await d.selectOption('#store-sort', 'recommended');
  await d.fill('#store-search', 'wireframes');
  log('Boutique : recherche par catégorie', await d.locator('.store-card').count() === 3);
  await d.fill('#store-search', 'Persona');
  log('Boutique : recherche par nom', await d.locator('.store-card').count() === 1 && await d.locator('.store-card h4').textContent() === 'Persona' && (await d.textContent('.store-count')) === '1 modèle');
  const personaCard = d.locator('.store-card[data-template="persona"]');
  log('Boutique : carte fidèle, auteur DWES, aperçu nommé sans micro-texte', await personaCard.locator('.store-author').textContent() === 'DWES' && (await personaCard.locator('svg').getAttribute('aria-label')).startsWith('Aperçu de Persona :') && await personaCard.locator('svg rect').count() >= 3);
  const hoverOpacity = () => personaCard.locator('.store-hover').evaluate(el => Number(getComputedStyle(el).opacity));
  await d.mouse.move(2, 2);
  await d.locator('#store-search').focus();
  await d.waitForFunction(() => Number(getComputedStyle(document.querySelector('.store-card .store-hover')).opacity) === 0);
  await d.locator('.store-nav [data-section="formats"]').focus();
  await d.keyboard.press('Tab');
  let tabs = 0;
  while (!await d.evaluate(() => !!document.activeElement.closest('.store-card')) && tabs++ < 12) await d.keyboard.press('Tab');
  await d.waitForFunction(() => Number(getComputedStyle(document.querySelector('.store-card .store-hover')).opacity) > 0.9);
  log('Boutique : boutons atteints et révélés au clavier, sans survol', await d.evaluate(() => document.activeElement.classList.contains('store-use')) && await hoverOpacity() > 0.9);
  await d.locator('.store-card[data-template="persona"] .store-preview-btn').click();
  await d.waitForSelector('.store-detail');
  const detail = await d.textContent('.store-detail');
  log('Boutique : aperçu avec description, nombre d’éléments et catégorie', await d.evaluate(() => document.activeElement.tagName) === 'H3' && /3 \(/.test(detail) && detail.includes('Recherche et design') && detail.includes('Décrire une personne') && await d.locator('.store-large svg').count() === 1);
  await d.click('.store-back');
  log('Boutique : retour à la liste et focus rendu', await d.locator('.store-grid').count() === 1 && await d.evaluate(() => document.activeElement.classList.contains('store-preview-btn')));
  await d.locator('.store-card[data-template="persona"] .store-preview-btn').click();
  await d.waitForSelector('.store-detail');
  await d.keyboard.press('Escape');
  await d.waitForFunction(() => !document.querySelector('.store-detail'));
  log('Boutique : Échap dans l’aperçu revient à la liste sans fermer', await d.locator('dialog.template-store[open]').count() === 1);
  await d.click('.store-card[data-template="persona"] .store-use');
  await d.waitForFunction(() => location.hash.startsWith('#/tableau/') && document.querySelector('#board-title')?.textContent.includes('Persona'));
  log('Modèle : nombre exact d’objets créés', await d.evaluate(async () => (await import('/js/state.js')).getItems().length) === 3);
  await d.click('#btn-save-template');
  await d.locator('dialog[open] input').fill('Mon persona');
  await d.locator('dialog[open] form button').first().click();
  await d.click('.btn-back'); await d.waitForSelector('#btn-template-library');
  await d.click('#btn-template-library'); await d.click('.store-nav [data-section="mine"]');
  log('Modèle personnel : enregistré, auteur Vous', await d.locator('.store-card h4').textContent() === 'Mon persona' && await d.locator('.store-card .store-author').textContent() === 'Vous');
  await d.click('.store-own button[aria-pressed]');
  await d.waitForFunction(() => document.querySelector('.store-own button[aria-pressed]')?.getAttribute('aria-pressed') === 'true');
  await d.click('.store-nav [data-section="community"]');
  const communityAuthors = await d.locator('.store-card .store-author').allTextContents();
  log('Communauté : pas de faux auteur, publication annoncée, sans lien mort', communityAuthors.length > 0 && communityAuthors.every(a => ['DWES', 'Vous'].includes(a)) && communityAuthors.includes('Vous') && /arrivera avec le serveur/.test(await d.textContent('.store-notice')) && await d.locator('.store-main a').count() === 0);
  await d.click('.store-nav [data-section="mine"]');
  await d.locator('.store-card .store-use').first().click();
  await d.waitForFunction(() => location.hash.startsWith('#/tableau/'));
  log('Modèle personnel : réutilisé sans perte', await d.evaluate(async () => (await import('/js/state.js')).getItems().length) === 3);
  await d.click('.btn-back'); await d.waitForSelector('#btn-template-library');
  await d.click('#btn-template-library');
  await d.selectOption('#store-sort', 'recent');
  log('Boutique : tri Récents, le dernier utilisé en tête', await d.locator('.store-card h4').first().textContent() === 'Mon persona');
  await d.fill('#store-search', '');
  await d.keyboard.press('Escape');
  await d.waitForFunction(() => !document.querySelector('dialog.template-store'));
  await d.click('.dashboard-header-actions .btn-primary');
  log('Boutique : Créer un tableau l’ouvre si la case est cochée, Tableau vierge disponible', await d.locator('dialog.template-store[open] #store-blank').count() === 1);
  await d.click('#store-blank');
  await d.waitForFunction(() => location.hash.startsWith('#/tableau/') && !document.querySelector('dialog.template-store'));
  await d.evaluate(() => { location.hash = '#/'; });
  await d.waitForSelector('#btn-template-library');
  await d.evaluate(async () => { const b = await import('/js/store/boards.js'); const c = b.getAll().filter(x => (x.données?.items?.length || 0) >= 3); location.hash = `#/tableau/${c[c.length - 1].id}`; });
  await d.waitForSelector('#app-board:not([hidden])');
  const downloadText = async format => {
    await d.click('#btn-export');
    const downloading = d.waitForEvent('download');
    await d.click(`#btn-export-${format}`);
    const stream = await (await downloading).createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  };
  const csvData = await downloadText('csv');
  log('Export CSV : colonnes et contenu', csvData.includes('"étiquettes"') && csvData.includes('Travaille en télétravail') && csvData.includes('"card"'));
  const svgData = await downloadText('svg');
  log('Export SVG : objets et couleurs résolues', svgData.includes('canvas-items') && svgData.includes('Camille') && !svgData.includes('var(--'));
  await d.focus('#btn-export'); await d.keyboard.press('ArrowDown');
  const firstExport = await d.evaluate(() => document.activeElement.id);
  await d.keyboard.press('ArrowDown');
  const secondExport = await d.evaluate(() => document.activeElement.id);
  await d.keyboard.press('Escape');
  log('Menu Exporter : flèches et Échap', firstExport === 'btn-export-json' && secondExport === 'btn-export-md' && await d.getAttribute('#btn-export', 'aria-expanded') === 'false' && await d.evaluate(() => document.activeElement.id) === 'btn-export');
  await d.click('.btn-back'); await d.waitForSelector('#btn-template-library');
  await d.click('#btn-template-library'); await d.click('.store-nav [data-section="mine"]');
  await d.getByRole('button', { name: 'Supprimer le modèle Mon persona', exact: true }).click();
  await d.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
  await d.waitForFunction(() => document.querySelectorAll('.store-card').length === 0);
  log('Modèle personnel : suppression confirmée', await d.evaluate(async () => (await import('/js/store/templates.js')).getCustomTemplates().length) === 0);
  await dashContext.close();

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

  log('320px : barre latérale repliée sans débordement', await p320.getAttribute('#btn-navigation', 'aria-expanded') === 'false' && await p320.isHidden('#dashboard-navigation') && bodyW <= 320);
  await p320.click('#btn-navigation');
  const navLinks = await p320.$$('.nav-link');
  log('320px : nav visible', navLinks.length === 3);

  // Open a board at 320px
  if (!await p320.locator('.board-link').count()) {
    await p320.locator('[data-template="organigramme"]').click();
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

    const firstId = await p320.evaluate(async () => (await import('/js/state.js')).getItems().find(i => i.type !== 'connector').id);
    await p320.evaluate(async id => (await import('/js/views/canvas.js')).focusItem(id), firstId);
    await p320.waitForSelector('.context-toolbar.is-docked:not([hidden])');
    const ctx = await p320.locator('.context-toolbar').boundingBox();
    const creation = await p320.locator('.creation-toolbar').boundingBox();
    await p320.keyboard.press('n');
    const pal = await p320.locator('#sticky-palette').boundingBox();
    const w320 = await p320.$eval('body', el => el.scrollWidth);
    log('320px : barre contextuelle en bas, palette visible, sans débordement', w320 <= 320 && ctx.x >= 0 && ctx.x + ctx.width <= 320 && ctx.y + ctx.height <= creation.y && pal.x >= 0 && pal.x + pal.width <= 320, `scrollWidth=${w320}`);
    await p320.keyboard.press('Escape');
    await p320.click('#btn-more-tools');
    const tp = await p320.locator('#tools-panel').boundingBox();
    const wTools = await p320.$eval('body', el => el.scrollWidth);
    await p320.keyboard.press('Escape');
    await p320.click('#btn-board-menu');
    await p320.click('#btn-comments');
    const cp = await p320.locator('#comments-panel').boundingBox();
    const wComments = await p320.$eval('body', el => el.scrollWidth);
    await p320.keyboard.press('Escape');
    log('320px : panneaux Plus d’outils et Commentaires sans débordement', tp && cp && tp.x >= 0 && tp.x + tp.width <= 320 && cp.x >= 0 && cp.x + cp.width <= 320 && wTools <= 320 && wComments <= 320, `${wTools}/${wComments}`);
  }

  log('320px : pas d\'erreurs console', err320.length === 0, err320.join('; '));
  await ctx320.close();

  // Présentation et navigation : contexte isolé et Fullscreen API indisponible.
  const navCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const nav = await navCtx.newPage();
  await nav.addInitScript(() => { Element.prototype.requestFullscreen = undefined; });
  await nav.goto(BASE);
  await nav.locator('[data-template="organigramme"]').click();
  await nav.waitForFunction(() => !document.getElementById('app-board').hidden);
  await nav.evaluate(async () => {
    const s = await import('/js/state.js');
    s.loadBoard({ name: 'Navigation', items: [
      { id: 'item-1', type: 'frame', content: 'Début', x: 0, y: 0, width: 500, height: 400 },
      { id: 'item-2', type: 'frame', content: 'Fin', x: 2000, y: 0, width: 500, height: 400 },
      { id: 'item-3', type: 'text', content: 'Trouvaille première', parent: 'item-1', x: 50, y: 50, width: 150, height: 30 },
      { id: 'item-4', type: 'kanban', content: 'Projet', x: 2050, y: 80, columns: [{ id: 'col-1', name: 'À faire', cards: [{ id: 'card-1', text: 'Trouvaille kanban' }] }] }
    ] });
  });
  await nav.click('#btn-frames');
  await nav.waitForFunction(() => document.querySelectorAll('#frames-panel [data-action="visit"]').length === 2);
  log('Cadres : liste numérotée et nombre d’éléments', (await nav.textContent('#frames-panel ol')).includes('1. Début — 1 élément'));
  await nav.click('#frames-panel [data-frame="item-2"][data-action="visit"]');
  log('Cadres : ajustement sur le cadre', await nav.evaluate(async () => {
    const c = await import('/js/views/canvas.js'); const v = c.getViewport();
    return v.x <= 2000 && v.y <= 0 && v.x + v.w >= 2500 && v.y + v.h >= 400;
  }));
  await nav.keyboard.press('Alt+ArrowUp');
  await nav.waitForFunction(() => document.querySelector('#frames-panel [data-action="visit"]').dataset.frame === 'item-2');
  log('Cadres : Alt+flèche réordonne', (await nav.textContent('#frames-panel [data-action="visit"]')).startsWith('1. Fin'));
  await nav.reload();
  await nav.waitForFunction(() => !!document.querySelector('.canvas-item'));
  await nav.click('#btn-frames');
  await nav.waitForFunction(() => document.querySelector('#frames-panel [data-action="visit"]')?.dataset.frame === 'item-2');
  log('Cadres : ordre persistant après rechargement', true);
  await nav.click('#frames-panel [data-frame="item-2"][data-action="rename"]');
  await nav.locator('dialog[open] input').fill('Arrivée');
  await nav.locator('dialog[open] form button').click();
  await nav.waitForFunction(() => document.querySelector('#frames-panel ol').textContent.includes('Arrivée'));
  log('Cadres : renommage depuis le panneau', true);
  await nav.keyboard.press('Escape');
  log('Cadres : Échap ferme et rend le focus', await nav.evaluate(() => document.getElementById('frames-panel').hidden && document.activeElement.id === 'btn-frames'));
  await nav.click('#btn-present');
  await nav.waitForFunction(() => document.getElementById('app-board').classList.contains('is-presenting'));
  log('Présentation : entrée avec repli plein fenêtre', await nav.evaluate(() => !document.fullscreenElement && !document.getElementById('presentation-controls').hidden));
  log('Présentation : compteur initial', (await nav.textContent('#presentation-controls [role=status]')) === 'Cadre 1 sur 2 : Arrivée');
  await nav.keyboard.press('ArrowRight');
  await nav.waitForFunction(() => document.querySelector('#presentation-controls [role=status]').textContent === 'Cadre 2 sur 2 : Début');
  await nav.keyboard.press('ArrowLeft');
  await nav.waitForFunction(() => document.querySelector('#presentation-controls [role=status]').textContent === 'Cadre 1 sur 2 : Arrivée');
  log('Présentation : suivant et précédent au clavier', true);
  await nav.keyboard.press('Escape');
  log('Présentation : Échap quitte et rend le focus', await nav.evaluate(() => !document.getElementById('app-board').classList.contains('is-presenting') && document.activeElement.id === 'btn-present'));
  await nav.focus('.canvas-svg');
  await nav.keyboard.press('m');
  await nav.waitForFunction(() => document.getElementById('btn-minimap').getAttribute('aria-pressed') === 'true');
  log('Mini-carte : M bascule avec état accessible', await nav.locator('#minimap').isVisible());
  const beforeMap = await nav.locator('.canvas-svg').getAttribute('viewBox');
  await nav.locator('#minimap').click({ position: { x: 10, y: 10 } });
  await nav.waitForFunction(old => document.querySelector('.canvas-svg').getAttribute('viewBox') !== old, beforeMap);
  log('Mini-carte : clic déplace la vue', true);
  await nav.focus('.canvas-svg');
  await nav.keyboard.press('Control+f');
  await nav.locator('#board-search-input').fill('Trouvaille');
  await nav.waitForFunction(() => document.querySelector('#board-search [role=status]').textContent === '2 résultats');
  log('Recherche : compteur et surlignage', await nav.locator('.search-result').count() === 2);
  await nav.keyboard.press('Enter');
  await nav.waitForFunction(() => document.querySelector('.canvas-item.selected')?.dataset.id === 'item-3');
  log('Recherche : Entrée sélectionne le premier résultat', (await nav.textContent('#board-search [role=status]')) === '1 sur 2');
  await nav.keyboard.press('Enter');
  await nav.waitForFunction(() => document.querySelector('.canvas-item.selected')?.dataset.id === 'item-4');
  log('Recherche : résultat dans une carte kanban', (await nav.textContent('#board-search [role=status]')) === '2 sur 2');
  await nav.keyboard.press('Escape');
  await nav.evaluate(async () => { (await import('/js/state.js')).setSelection([]); document.querySelector('.canvas-svg').focus(); });
  const beforeArrow = await nav.locator('.canvas-svg').getAttribute('viewBox');
  await nav.keyboard.press('ArrowRight');
  await nav.waitForFunction(old => document.querySelector('.canvas-svg').getAttribute('viewBox') !== old, beforeArrow);
  log('Canevas : flèche sans sélection déplace la vue', true);
  await nav.evaluate(async () => { (await import('/js/state.js')).loadBoard({ name: 'Vide', items: [] }); });
  await nav.click('#btn-present');
  await nav.waitForFunction(() => document.querySelector('#presentation-controls [role=status]').textContent === 'Vue entière. Ajoutez des cadres pour présenter');
  const emptyPresentation = await nav.locator('#presentation-controls').isVisible();
  await nav.keyboard.press('Escape');
  await nav.setViewportSize({ width: 320, height: 700 });
  await nav.click('#btn-frames');
  log('Présentation sans cadre et navigation à 320 px sans débordement', emptyPresentation && await nav.evaluate(() => document.body.scrollWidth <= 320));
  await navCtx.close();

  // Lignes (1.6.0)
  const lineCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const lp = await lineCtx.newPage();
  const lineErrors = [];
  lp.on('pageerror', e => lineErrors.push(e.message));
  lp.on('console', m => { if (m.type() === 'error') lineErrors.push(m.text()); });
  await lp.goto(BASE + '/#/');
  await lp.waitForSelector('#btn-create-space');
  const lineBoard = await lp.evaluate(async () => (await import('/js/store/boards.js')).create('Lignes', { name: 'Lignes', items: [] }).id);
  await lp.evaluate(id => { location.hash = `#/tableau/${id}`; }, lineBoard);
  await lp.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Lignes'));
  const lState = (fn, ...args) => lp.evaluate(async ({ fn, args }) => (await import('/js/state.js'))[fn](...args), { fn, args });
  const lLoad = async items => { await lp.evaluate(async items => { (await import('/js/state.js')).loadBoard({ name: 'Lignes', items }); (await import('/js/views/canvas.js')).zoomReset(); }, items); };
  const lItems = () => lp.evaluate(async () => (await import('/js/state.js')).getSnapshot().items);
  const lLine = async () => (await lItems()).find(i => i.type === 'connector');
  const lDrag = async (from, to) => { await lp.mouse.move(from.x, from.y); await lp.mouse.down(); await lp.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 }); await lp.mouse.move(to.x, to.y, { steps: 4 }); await lp.mouse.up(); };
  const lToScreen = (x, y) => lp.evaluate(async ([x, y]) => { const c = await import('/js/views/canvas.js'); const p = c.toContainer(x, y); const r = c.getContainer().getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, [x, y]);
  const lHandle = async sel => { const b = await lp.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const lAnn = re => lp.waitForFunction(src => new RegExp(src).test(document.getElementById('announcer').textContent), re.source);
  const lNote = (id, x, y, content) => ({ id, type: 'sticky_note', x, y, width: 150, height: 150, content, color: 'red' });

  await lLoad([]);
  await lp.focus('#board-title');
  await lp.keyboard.press('l');
  const lineTool = await lp.getAttribute('#btn-line', 'aria-pressed') === 'true';
  await lDrag(await lToScreen(300, 200), await lToScreen(600, 350));
  await lAnn(/Créé : Ligne libre/);
  let ln = await lLine();
  log('Ligne : L puis glisser dans le vide crée une ligne libre', lineTool && ln && !ln.startId && !ln.endId && ln.start.x === 300 && ln.start.y === 200 && ln.end.x === 600 && ln.end.y === 350 && await lp.getAttribute('#btn-select', 'aria-pressed') === 'true', JSON.stringify(ln));
  const lineLabel = await lp.locator(`#canvas-items [data-id="${ln.id}"]`).getAttribute('aria-label');
  log('Ligne libre : nom accessible avec coordonnées', lineLabel.startsWith('Ligne libre de (300, 200) à (600, 350)'), lineLabel);

  await lLoad([]);
  await lp.click('#btn-line');
  const dflt = await lToScreen(500, 300);
  await lp.mouse.click(dflt.x, dflt.y);
  await lAnn(/Créé : Ligne libre/);
  ln = await lLine();
  log('Ligne : clic sans glisser crée une longueur par défaut', ln.end.x - ln.start.x === 200 && ln.start.y === 300 && ln.end.y === 300);

  await lp.keyboard.press('Control+z');
  await lp.focus('#btn-line');
  await lp.keyboard.press('Enter');
  await lAnn(/Créé : Ligne libre/);
  log('Ligne : voie clavier sur le bouton, créée au centre et sélectionnée', (await lState('getSelectedIds')).length === 1 && !!(await lLine())?.start);

  await lLoad([{ id: 'item-1', type: 'connector', start: { x: 300, y: 200 }, end: { x: 600, y: 200 } }]);
  await lp.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('item-1'));
  await lp.keyboard.press('ArrowRight');
  ln = await lLine();
  log('Ligne libre : flèches déplacent', ln.start.x === 310 && ln.end.x === 610);
  const lineMid = await lToScreen(400, 200);
  await lDrag(lineMid, { x: lineMid.x + 40, y: lineMid.y + 30 });
  ln = await lLine();
  log('Ligne libre : glisser déplace, annulable', ln.start.x === 350 && ln.start.y === 230 && ln.end.x === 650);

  await lLoad([lNote('item-1', 100, 100, 'Post-it A'), lNote('item-2', 500, 100, 'Post-it B'), { id: 'item-3', type: 'connector', start: { x: 300, y: 500 }, end: { x: 600, y: 500 } }]);
  await lp.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('item-3'));
  const endHandle = await lHandle('[data-end="end"]');
  const overB = await lToScreen(575, 175);
  await lp.mouse.move(endHandle.x, endHandle.y);
  await lp.mouse.down();
  await lp.mouse.move(overB.x, overB.y, { steps: 6 });
  await lp.waitForSelector('.snap-target');
  const snapShown = await lp.locator('.snap-target').count() === 1;
  await lp.mouse.up();
  await lAnn(/Fin accrochée à Post-it Rouge : Post-it B/);
  ln = await lLine();
  log('Extrémité : déposée sur un objet, mise en évidence et accrochée', snapShown && ln.endId === 'item-2' && !ln.end);
  await lDrag(await lHandle('[data-end="end"]'), await lToScreen(700, 500));
  await lAnn(/Fin détachée en \(700, 500\)/);
  ln = await lLine();
  log('Extrémité : tirée hors de l’objet, détachée et annoncée', !ln.endId && ln.end.x === 700 && ln.end.y === 500);

  await lLoad([{ id: 'item-1', type: 'connector', start: { x: 300, y: 300 }, end: { x: 700, y: 300 } }]);
  await lp.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('item-1'));
  await lDrag(await lHandle('[data-mid="0"]'), await lToScreen(500, 500));
  await lAnn(/Point de pliage ajouté en \(500, 500\)/);
  ln = await lLine();
  const midsAfter = await lp.locator('[data-mid]').count();
  log('Point de pliage : le point milieu ajoute un pli et deux nouveaux milieux', ln.waypoints.length === 1 && ln.waypoints[0].x === 500 && ln.waypoints[0].y === 500 && midsAfter === 2);
  const wp = await lHandle('[data-wp="0"]');
  await lp.mouse.dblclick(wp.x, wp.y);
  await lAnn(/Point de pliage supprimé/);
  log('Point de pliage : double-clic le supprime', (await lLine()).waypoints.length === 0);

  await lp.locator('.context-toolbar [data-key="end-cap"]').click();
  await lp.getByRole('menuitemradio', { name: 'Losange' }).click();
  await lp.locator('.context-toolbar [data-key="start-cap"]').click();
  await lp.getByRole('menuitemradio', { name: 'Cercle' }).click();
  await lp.locator('.context-toolbar [data-key="line-type"]').click();
  await lp.getByRole('menuitemradio', { name: 'Courbe' }).click();
  await lp.locator('.context-toolbar [data-key="line-style"]').click();
  await lp.getByRole('menuitemradio', { name: 'Tirets' }).click();
  await lp.locator('.context-toolbar [data-key="line-width"]').click();
  await lp.getByRole('menuitemradio', { name: '6 px' }).click();
  await lp.locator('.context-toolbar [data-key="line-color"]').click();
  await lp.getByRole('menuitemradio', { name: 'Vert' }).click();
  ln = await lLine();
  const bodyPath = lp.locator('#canvas-items .line-body');
  log('Barre de ligne : extrémités, type, trait, épaisseur et couleur appliqués', ln.endCap === 'diamond' && ln.startCap === 'circle' && ln.lineType === 'bezier' && ln.lineStyle === 'dashed' && ln.strokeWidth === 6 && ln.stroke === 'green' && / C /.test(await bodyPath.getAttribute('d')) && !!(await bodyPath.getAttribute('stroke-dasharray')) && await lp.locator('.line-cap[data-cap="diamond"]').count() === 1);
  await lp.locator('.context-toolbar [data-key="reverse"]').click();
  await lAnn(/Extrémités inversées/);
  ln = await lLine();
  log('Barre de ligne : inverser les extrémités', ln.start.x === 700 && ln.end.x === 300);
  await lp.keyboard.press('Control+z');
  await lp.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('item-1'));
  await lp.keyboard.press('Alt+F10');
  await lp.keyboard.press('Home');
  const onStartCap = await lp.evaluate(() => document.activeElement.dataset.key);
  await lp.keyboard.press('Alt+ArrowDown');
  await lAnn(/Début déplacé en \(300, 310\)/);
  log('Clavier : barre pour choisir Début, Alt+flèche déplace l’extrémité active', onStartCap === 'start-cap' && (await lLine()).start.y === 310);
  await lp.keyboard.press('Escape');
  await lp.keyboard.press('Enter');
  await lp.waitForSelector('.field-editor');
  await lp.keyboard.type('Étape');
  await lp.keyboard.press('Enter');
  await lp.waitForFunction(() => document.querySelector('#canvas-items .line-label')?.textContent === 'Étape');
  log('Texte sur la ligne : édition sur place, au milieu', (await lLine()).label === 'Étape');

  await lp.locator('.context-toolbar [data-key="more"]').click();
  await lp.getByRole('menuitem', { name: 'Extrémités et points de pliage…' }).click();
  await lp.waitForSelector('#dialog-link[open]');
  const startIsFree = await lp.inputValue('[name="link-start"]') === '__libre__';
  await lp.fill('[name="link-end-x"]', '800');
  await lp.click('.waypoint-add');
  await lp.locator('.waypoints-list input').nth(0).fill('450');
  await lp.locator('.waypoints-list input').nth(1).fill('120');
  await lp.click('#dialog-link .dialog-submit');
  await lp.waitForFunction(() => !document.querySelector('#dialog-link[open]'));
  ln = await lLine();
  log('Dialogue : extrémités et points de pliage modifiables en X/Y', startIsFree && ln.end.x === 800 && ln.waypoints[0].x === 450 && ln.waypoints[0].y === 120);

  await lLoad([lNote('item-1', 100, 100, 'Post-it A')]);
  await lp.click('#btn-link');
  await lp.selectOption('[name="link-start"]', 'item-1');
  await lp.selectOption('[name="link-end"]', '__libre__');
  await lp.fill('[name="link-end-x"]', '900');
  await lp.fill('[name="link-end-y"]', '400');
  await lp.click('#dialog-link .dialog-submit');
  await lp.waitForFunction(() => !document.querySelector('#dialog-link[open]'));
  ln = await lLine();
  const halfLabel = await lp.locator(`#canvas-items [data-id="${ln.id}"]`).getAttribute('aria-label');
  log('Dialogue : source objet, cible point libre, nom accessible', ln.startId === 'item-1' && ln.end.x === 900 && halfLabel.startsWith('Flèche de Post-it Rouge : Post-it A vers (900, 400)'), halfLabel);

  await lLoad([lNote('item-1', 100, 100, 'A'), lNote('item-2', 500, 100, 'B'), { id: 'item-3', type: 'connector', startId: 'item-1', endId: 'item-2', lineType: 'line', label: 'ancien', x: 0, y: 0 }, { id: 'item-4', type: 'connector', startId: 'item-1', endId: 'item-2', lineType: 'arrow', x: 0, y: 0 }, { id: 'item-5', type: 'connector', startId: 'item-1', endId: 'item-2', lineType: 'orthogonal', x: 0, y: 0 }]);
  let legacy = (await lItems()).filter(i => i.type === 'connector');
  log('Ancien lien : toujours valide et migré', legacy[0].lineType === 'straight' && legacy[0].endCap === 'none' && legacy[1].endCap === 'arrow_filled' && legacy[2].lineType === 'orthogonal' && legacy[2].endCap === 'arrow_filled' && await lp.locator('#canvas-items .line-body').count() === 3);
  const oldEdge = await lp.locator('#canvas-items [data-id="item-3"] .line-body').getAttribute('d');
  await lState('moveItems', ['item-2'], 0, 100);
  log('Objet déplacé : l’extrémité suit et reste au bord', await lp.locator('#canvas-items [data-id="item-3"] .line-body').getAttribute('d') !== oldEdge && (await lItems()).find(i => i.id === 'item-3').endId === 'item-2');
  await lp.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('item-3'));
  await lp.keyboard.press('ArrowDown');
  await lAnn(/Ligne détachée et déplacée/);
  ln = (await lItems()).find(i => i.id === 'item-3');
  log('Ligne attachée des deux côtés : déplacée, elle se détache', !ln.startId && !ln.endId && !!ln.start && !!ln.end);

  await lLoad([{ id: 'item-1', type: 'connector', start: { x: 100, y: 100 }, end: { x: 300, y: 100 }, waypoints: [{ x: 200, y: 200 }], label: 'trouvaille' }, lNote('item-2', 500, 100, 'A'), { id: 'item-3', type: 'connector', startId: 'item-2', end: { x: 900, y: 100 } }]);
  await lp.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('item-1'));
  await lp.keyboard.press('Control+d');
  let lineItems = (await lItems()).filter(i => i.type === 'connector');
  const dup = lineItems.find(i => !['item-1', 'item-3'].includes(i.id));
  log('Ligne libre : duplication décalée', lineItems.length === 3 && dup.start.x === 120 && dup.waypoints[0].x === 220);
  await lp.keyboard.press('Control+z');
  await lp.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('item-3'));
  await lp.keyboard.press('Control+c');
  await lp.keyboard.press('Control+v');
  lineItems = (await lItems()).filter(i => i.type === 'connector');
  const pastedLine = lineItems.find(i => !['item-1', 'item-3'].includes(i.id));
  log('Copier-coller : extrémité d’un objet non copié devenue point libre', !pastedLine.startId && !!pastedLine.start && pastedLine.end.x === 920);
  await lp.keyboard.press('Control+z');
  await lState('removeItems', ['item-2']);
  ln = (await lItems()).find(i => i.id === 'item-3');
  log('Suppression d’un objet : la ligne garde un point libre', !!ln && !ln.startId && !!ln.start);
  await lp.click('#tab-outline');
  const outlineLines = await lp.locator('#view-outline').textContent();
  await lp.click('#tab-table');
  const tableLines = await lp.locator('#view-table').textContent();
  await lp.click('#tab-canvas');
  const csvLines = await lp.evaluate(async () => (await import('/js/io.js')).csvContent());
  await lp.click('#btn-search');
  await lp.fill('#board-search-input', 'trouvaille');
  await lp.waitForFunction(() => document.querySelector('#board-search [role=status]').textContent === '1 résultat');
  await lp.keyboard.press('Escape');
  log('Plan, Tableau, CSV et recherche connaissent les lignes libres', /Ligne libre de \(100, 100\) à \(300, 100\)/.test(outlineLines) && /Ligne libre de \(100, 100\)/.test(tableLines) && csvLines.includes('Ligne libre de (100, 100)'));
  log('Lignes : pas d’erreurs console', lineErrors.length === 0, lineErrors.join('; '));
  await lineCtx.close();

  // Glisser-déposer depuis les palettes (1.6.0)
  const dropCtx = await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true });
  const dp = await dropCtx.newPage();
  await dp.goto(BASE + '/#/');
  await dp.waitForSelector('#btn-create-space');
  const dropBoard = await dp.evaluate(async () => (await import('/js/store/boards.js')).create('Glisser', { name: 'Glisser', items: [] }).id);
  await dp.evaluate(id => { location.hash = `#/tableau/${id}`; }, dropBoard);
  await dp.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Glisser'));
  const dItems = () => dp.evaluate(async () => (await import('/js/state.js')).getSnapshot().items);
  const dReset = () => dp.evaluate(async () => { (await import('/js/state.js')).loadBoard({ name: 'Glisser', items: [] }); (await import('/js/views/canvas.js')).zoomReset(); });
  const dCentre = async sel => { const b = await dp.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const dAnn = re => dp.waitForFunction(src => new RegExp(src).test(document.getElementById('announcer').textContent), re.source);
  const dDrag = async (sel, to) => { const a = await dCentre(sel); await dp.mouse.move(a.x, a.y); await dp.mouse.down(); await dp.mouse.move(a.x + 8, a.y + 8); await dp.mouse.move(to.x, to.y, { steps: 5 }); };

  await dReset();
  await dp.click('#btn-sticky');
  await dp.waitForSelector('#sticky-palette:not([hidden])');
  const svgB = await dp.locator('.canvas-svg').boundingBox();
  const dropAt = { x: svgB.x + 700, y: svgB.y + 300 };
  await dDrag('#sticky-palette .tool-color:nth-child(4)', dropAt);
  await dp.waitForSelector('.drag-ghost');
  const ghostFollows = await dp.locator('.drag-ghost').boundingBox();
  await dp.mouse.up();
  await dAnn(/Créé : post-it rouge\. Édition\./);
  let placedNote = (await dItems())[0];
  const placedBox = await dp.locator(`#canvas-items [data-id="${placedNote.id}"] > :first-child`).boundingBox();
  log('Palette post-it : glisser une pastille pose le post-it à cet endroit, dans cette couleur', placedNote.color === 'red' && Math.abs(placedBox.x + placedBox.width / 2 - dropAt.x) <= 2 && Math.abs(placedBox.y + placedBox.height / 2 - dropAt.y) <= 2 && Math.abs(ghostFollows.x + ghostFollows.width / 2 - dropAt.x) <= 2);
  log('Palette post-it : édition ouverte, fantôme retiré, outil Sélection', await dp.evaluate(() => document.activeElement.classList.contains('inline-editor')) && await dp.locator('.drag-ghost').count() === 0 && await dp.getAttribute('#btn-select', 'aria-pressed') === 'true');
  await dp.keyboard.press('Escape');

  await dReset();
  await dDrag('#btn-text', dropAt);
  await dp.mouse.up();
  await dAnn(/Créé : texte\. Édition\./);
  log('Outil : glisser le bouton Texte crée sur le canevas', (await dItems())[0]?.type === 'text' && await dp.evaluate(() => document.activeElement.classList.contains('inline-editor')));
  await dp.keyboard.press('Escape');

  await dReset();
  await dp.click('#btn-more-tools');
  await dp.waitForSelector('#tools-panel:not([hidden])');
  await dp.locator('#tools-panel [data-tool="kanban"]').scrollIntoViewIfNeeded();
  await dDrag('#tools-panel [data-tool="kanban"]', dropAt);
  await dp.mouse.up();
  await dAnn(/Créé : kanban\./);
  log('Plus d’outils : glisser crée l’objet et referme le panneau', (await dItems())[0]?.type === 'kanban' && await dp.isHidden('#tools-panel'));

  await dReset();
  await dp.click('#btn-shape');
  await dp.waitForSelector('#shape-palette:not([hidden])');
  await dDrag('#shape-palette [data-shape="shape:diamond"]', dropAt);
  await dp.mouse.up();
  await dAnn(/Créé : losange\. Édition\./);
  log('Formes : glisser un losange depuis la palette', (await dItems())[0]?.shape === 'diamond');
  await dp.keyboard.press('Escape');

  await dReset();
  await dDrag('#btn-card', dropAt);
  await dp.waitForSelector('.drag-ghost');
  await dp.keyboard.press('Escape');
  await dAnn(/Glisser annulé/);
  await dp.mouse.up();
  log('Annulation : Échap retire le fantôme et ne crée rien', (await dItems()).length === 0 && await dp.locator('.drag-ghost').count() === 0 && await dp.getAttribute('#btn-card', 'aria-pressed') === 'false');
  const head = await dCentre('#board-title');
  await dDrag('#btn-card', head);
  await dp.mouse.up();
  await dAnn(/relâché hors du canevas/);
  log('Annulation : relâcher hors du canevas ne crée rien', (await dItems()).length === 0);
  const nearby = await dCentre('#btn-frame');
  await dp.mouse.move(nearby.x, nearby.y);
  await dp.mouse.down();
  await dp.mouse.move(nearby.x + 2, nearby.y + 2);
  await dp.mouse.up();
  log('Seuil de 5 px : un simple clic garde l’outil actif', await dp.getAttribute('#btn-frame', 'aria-pressed') === 'true' && (await dItems()).length === 0);
  await dp.keyboard.press('Escape');

  const cdp = await dropCtx.newCDPSession(dp);
  const touchFrom = await dCentre('#btn-sticky');
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await touch('touchStart', [touchFrom]);
  await touch('touchMove', [{ x: touchFrom.x + 20, y: touchFrom.y + 10 }]);
  await touch('touchMove', [dropAt]);
  await dp.waitForSelector('.drag-ghost');
  await touch('touchEnd', []);
  await dAnn(/Créé : post-it .*\. Édition\./);
  log('Tactile : glisser au doigt crée le post-it', (await dItems())[0]?.type === 'sticky_note');
  await dropCtx.close();

  // Apparence et préférences (1.6.0)
  const prefCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const pp = await prefCtx.newPage();
  await pp.goto(BASE + '/#/');
  await pp.waitForSelector('#btn-create-space');
  const appearance = pp.locator('#app-dashboard .btn-appearance');
  const noCycle = await pp.locator('#btn-theme').count() === 0 && await pp.getByRole('button', { name: 'Thème', exact: true }).count() === 0;
  log('Thème : le bouton qui fait défiler est supprimé, sélecteur affichant le thème courant', noCycle && await appearance.textContent() === 'Thème : Automatique' && await appearance.getAttribute('aria-haspopup') === 'menu');
  await appearance.focus();
  await pp.keyboard.press('ArrowDown');
  await pp.waitForSelector('.prefs-menu[role="menu"]');
  const firstChecked = await pp.evaluate(() => document.activeElement.dataset.themeChoice + ':' + document.activeElement.getAttribute('aria-checked'));
  const radios = await pp.locator('.prefs-menu [role="menuitemradio"]').allTextContents();
  await pp.keyboard.press('ArrowDown');
  await pp.keyboard.press('ArrowDown');
  const onDark = await pp.evaluate(() => document.activeElement.dataset.themeChoice);
  await pp.keyboard.press('Escape');
  const escReturn = await pp.evaluate(() => document.activeElement.classList.contains('btn-appearance')) && await pp.locator('.prefs-menu').count() === 0;
  await appearance.press('Enter');
  await pp.waitForSelector('.prefs-menu');
  await pp.keyboard.press('ArrowDown'); await pp.keyboard.press('ArrowDown');
  await pp.keyboard.press('Enter');
  await pp.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  log('Menu Apparence : flèches, aria-checked, Échap et retour du focus', firstChecked === 'auto:true' && radios.length === 4 && radios[3].includes('Contraste élevé') && onDark === 'dark' && escReturn);
  await pp.waitForFunction(() => /Thème : Sombre/.test(document.getElementById('announcer').textContent));
  log('Menu Apparence : Entrée applique, annonce et rend le focus', await appearance.textContent() === 'Thème : Sombre' && await pp.evaluate(() => document.activeElement.classList.contains('btn-appearance')));
  await pp.reload();
  await pp.waitForSelector('#app-dashboard .btn-appearance');
  await pp.locator('#app-dashboard .btn-appearance').click();
  log('Menu Apparence : thème persistant et coché', await pp.evaluate(() => document.documentElement.dataset.theme === 'dark') && await pp.getAttribute('.prefs-menu [data-theme-choice="dark"]', 'aria-checked') === 'true' && await pp.getAttribute('.prefs-menu [data-theme-choice="light"]', 'aria-checked') === 'false');
  await pp.keyboard.press('Escape');

  const contrast = await pp.evaluate(() => {
    const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const out = {};
    for (const theme of ['light', 'dark', 'high-contrast']) {
      document.documentElement.setAttribute('data-theme', theme);
      const css = getComputedStyle(document.documentElement);
      const v = n => css.getPropertyValue(`--${n}`).trim();
      out[theme] = { text: [['fg', 'bg'], ['fg', 'surface'], ['link', 'bg'], ['on-primary', 'primary'], ['on-danger', 'danger'], ['frame-label', 'bg']].map(([a, b]) => ratio(v(a), v(b))), ui: [['border', 'bg'], ['focus-ring', 'bg'], ['primary', 'bg'], ['connector-stroke', 'bg']].map(([a, b]) => ratio(v(a), v(b))), primary: v('primary') };
    }
    document.documentElement.setAttribute('data-theme', 'dark');
    return out;
  });
  log('Thèmes : contraste AA (texte 4,5:1, interface 3:1) dans tous les thèmes', Object.values(contrast).every(c => c.text.every(r => r >= 4.5) && c.ui.every(r => r >= 3)), JSON.stringify(contrast));
  log('Thème sombre : palette DWES', contrast.dark.primary === '#6c4bff' && contrast.light.primary === '#4a2fcc');

  const prefBoard = await pp.evaluate(async () => (await import('/js/store/boards.js')).create('Préférences', { name: 'Préférences', items: [] }).id);
  await pp.evaluate(id => { location.hash = `#/tableau/${id}`; }, prefBoard);
  await pp.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Préférences'));
  const boardPrefs = pp.locator('#app-board .btn-preferences');
  await boardPrefs.click();
  const prefItems = await pp.locator('.prefs-menu [role="menuitemcheckbox"]').evaluateAll(els => els.map(e => [e.dataset.pref, e.getAttribute('aria-checked')]));
  const hasThemes = await pp.locator('.prefs-menu [role="menuitemradio"][data-theme-choice]').count() === 4;
  log('Menu Apparence : libellés lisibles sur toutes les entrées', await pp.evaluate(() => [...document.querySelectorAll('.prefs-menu [data-theme-choice] .menu-label')].length === 0 || [...document.querySelectorAll('.prefs-menu [data-theme-choice] .menu-label')].every(l => getComputedStyle(l).color === getComputedStyle(l.closest('.prefs-menu')).color)));
  log('Préférences : Apparence, cases par défaut et réglage de la souris', hasThemes && JSON.stringify(prefItems) === '[["grid","true"],["snapGrid","false"],["showSize","false"],["reduceMotion","false"],["singleKey","true"]]');
  await pp.click('.prefs-menu [data-pref="grid"]');
  const stillOpen = await pp.locator('.prefs-menu').count() === 1 && await pp.getAttribute('.prefs-menu [data-pref="grid"]', 'aria-checked') === 'false';
  await pp.click('.prefs-menu [data-pref="reduceMotion"]');
  await pp.click('.prefs-menu [data-pref="singleKey"]');
  await pp.keyboard.press('Escape');
  log('Préférences : grille masquée et animations réduites', stillOpen && await pp.locator('.canvas-grid').evaluate(el => getComputedStyle(el).display) === 'none' && await pp.evaluate(() => document.documentElement.hasAttribute('data-reduce-motion')));
  await pp.focus('#board-title');
  const zoomBefore = await pp.textContent('#btn-zoom-reset');
  for (const k of ['n', 't', 'l', 'm', '?', '+']) await pp.keyboard.press(k);
  const ignored = await pp.getAttribute('#btn-select', 'aria-pressed') === 'true' && await pp.getAttribute('#btn-minimap', 'aria-pressed') === 'false' && await pp.locator('dialog[open]').count() === 0 && await pp.textContent('#btn-zoom-reset') === zoomBefore;
  await pp.reload();
  await pp.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Préférences'));
  await pp.focus('#board-title');
  await pp.keyboard.press('n');
  const stillOff = await pp.getAttribute('#btn-sticky', 'aria-pressed') === 'false';
  await pp.locator('#app-board .btn-preferences').click();
  await pp.click('.prefs-menu [data-pref="singleKey"]');
  await pp.keyboard.press('Escape');
  await pp.focus('#board-title');
  await pp.keyboard.press('n');
  log('Raccourcis à une lettre : désactivés, persistants, puis réactivables (WCAG 2.1.4)', ignored && stillOff && await pp.getAttribute('#btn-sticky', 'aria-pressed') === 'true' && await pp.locator('#view-canvas').count() === 1);
  await pp.keyboard.press('Escape');
  await pp.locator('#app-board .btn-preferences').click();
  await pp.click('.prefs-menu [data-background="mint"]');
  await pp.waitForFunction(() => /Couleur de fond : Vert d’eau/.test(document.getElementById('announcer').textContent));
  const bgState = await pp.evaluate(async () => (await import('/js/state.js')).getSnapshot().background);
  const bgCss = await pp.locator('.canvas-svg').evaluate(el => getComputedStyle(el).backgroundColor);
  const inkOnBg = await pp.locator('#view-canvas').evaluate(el => getComputedStyle(el).getPropertyValue('--fg').trim());
  await pp.reload();
  await pp.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Préférences'));
  await pp.waitForFunction(() => document.querySelector('.canvas-svg').style.backgroundColor !== '');
  log('Couleur de fond : stockée dans le tableau, persistante, encre lisible sur le fond clair en thème sombre', bgState === 'mint' && bgCss === 'rgb(227, 246, 238)' && inkOnBg === '#1b1740');
  await prefCtx.close();

  // 320 px : nouveautés sans débordement (1.6.0)
  const small = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const sp = await small.newPage();
  await sp.goto(BASE + '/#/');
  await sp.waitForSelector('#btn-create-space', { state: 'attached' });
  const noOverflow = () => sp.evaluate(() => document.documentElement.scrollWidth <= 320 && document.body.scrollWidth <= 320);
  await sp.locator('#app-dashboard .btn-appearance').click();
  const menu320 = await sp.locator('.prefs-menu').boundingBox();
  const menuOk = menu320.x >= 0 && menu320.x + menu320.width <= 320 && await noOverflow();
  await sp.keyboard.press('Escape');
  await sp.locator('.dashboard-header-actions .btn-primary').click();
  await sp.waitForSelector('dialog.template-store[open]');
  const store320 = await noOverflow() && (await sp.locator('dialog.template-store').boundingBox()).width <= 320;
  await sp.click('.store-nav-toggle');
  await sp.click('.store-nav [data-section="cat:Agile"]');
  const firstUse = sp.locator('.store-card .store-use').first();
  const useVisible = await firstUse.isVisible() && await firstUse.evaluate(el => Number(getComputedStyle(el.closest('.store-hover')).opacity)) === 1;
  log('320 px : menu Apparence et boutique sans débordement, boutons visibles sans survol', menuOk && store320 && useVisible && await sp.evaluate(() => document.querySelector('.store-grid').scrollWidth <= 320));
  await firstUse.click();
  await sp.waitForSelector('#app-board:not([hidden])');
  await sp.evaluate(async () => { (await import('/js/state.js')).loadBoard({ name: 'P', items: [{ id: 'item-1', type: 'connector', start: { x: 10, y: 10 }, end: { x: 200, y: 200 } }] }); (await import('/js/views/canvas.js')).focusItem('item-1'); });
  await sp.waitForSelector('.context-toolbar.is-docked:not([hidden])');
  const bar320 = await sp.locator('.context-toolbar').boundingBox();
  const headerH = (await sp.locator('#app-board > header').boundingBox()).height;
  log('320 px : barre de ligne dans l’écran, en-tête compact sans débordement', bar320.x >= 0 && bar320.x + bar320.width <= 320 && headerH < 140 && await noOverflow(), `en-tête ${headerH}`);
  await sp.click('#btn-board-menu');
  log('320 px : actions du tableau repliables', await sp.isVisible('#btn-export') && await noOverflow());
  await sp.click('#btn-board-menu');
  await sp.click('#btn-minimap');
  const map320 = await sp.locator('#minimap').boundingBox();
  log('320 px : mini-carte masquée par défaut puis dans l’écran', map320.x >= 0 && map320.x + map320.width <= 320 && await noOverflow());
  await small.close();

  const flushCtx = await browser.newContext();
  const fl = await flushCtx.newPage();
  await fl.goto(BASE + '/#/');
  const flushId = await fl.evaluate(async () => (await import('/js/store/boards.js')).create('Saisie', { name: 'Saisie', items: [] }).id);
  await fl.goto(BASE + '/#/tableau/' + flushId);
  await fl.waitForFunction(() => document.getElementById('board-title')?.textContent.includes('Saisie'));
  await fl.keyboard.press('n');
  await fl.keyboard.press('Enter');
  await fl.waitForSelector('.inline-editor');
  await fl.keyboard.type('Texte non validé');
  await fl.evaluate(() => { location.hash = '#/'; });
  await fl.waitForFunction(() => document.getElementById('app-board').hidden);
  const kept = await fl.evaluate(async id => (await import('/js/store/boards.js')).get(id).données.items[0]?.content, flushId);
  log('Quitter le tableau garde le texte en cours de saisie', kept === 'Texte non validé', kept);
  await flushCtx.close();

  const secCtx = await browser.newContext();
  const sec = await secCtx.newPage();
  await sec.goto(BASE + '/#/');
  await sec.locator('.template-tile, #btn-template-library').first().waitFor();
  const evil = 'x"><meta http-equiv=refresh content="0;url=about:blank">';
  const sanitized = await sec.evaluate(async evil => {
    const state = await import('/js/state.js');
    state.loadBoard({ name: 'S', items: [
      { id: evil, type: 'comment', x: 1, y: 1, messages: [] },
      { id: 'a', type: 'connector', start: { x: 0, y: 0 }, end: { x: 9, y: 9 }, strokeWidth: '2"><img src=x>', lineStyle: '"><b>', endCap: '<i>', parent: evil }
    ] });
    const [c, l] = state.getItems();
    return { id: c.id, width: l.strokeWidth, style: l.lineStyle, cap: l.endCap, parent: l.parent };
  }, evil);
  log('Sécurité : valeurs importées assainies', /^[\w-]+$/.test(sanitized.id) && sanitized.width === 2 && sanitized.style === 'solid' && sanitized.cap === 'arrow_filled' && sanitized.parent === null, JSON.stringify(sanitized));
  const csv = await sec.evaluate(async () => {
    const state = await import('/js/state.js');
    const io = await import('/js/io.js');
    state.loadBoard({ name: 'S', items: [{ id: 'n', type: 'text', x: 0, y: 0, width: 100, height: 30, content: '=HYPERLINK("http://x")' }] });
    return io.csvContent();
  });
  log('Sécurité : formule neutralisée dans le CSV', csv.includes(`"'=HYPERLINK`), csv.split('\r\n')[1]);
  await secCtx.close();
  const auditCtx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const audit = await auditCtx.newPage();
  await audit.goto(BASE + '/#/');
  await audit.waitForSelector('#btn-template-library');
  await audit.click('#btn-template-library');
  await audit.waitForSelector('dialog.template-store[open]');
  await audit.evaluate(async () => { (await import('/js/a11y/announcer.js')).announce('Annonce modale'); });
  await audit.waitForFunction(() => document.querySelector('dialog[open] [data-announcer]')?.textContent === 'Annonce modale');
  log('Annonce dans une région du dialogue modal', await audit.locator('dialog[open] [data-announcer][aria-live="polite"]').count() === 1);
  await audit.evaluate(() => { window.auditStatus = document.querySelector('.template-store .store-count'); });
  await audit.fill('#store-search', 'a');
  await audit.fill('#store-search', 'ag');
  log('Boutique : même nœud status après deux frappes', await audit.evaluate(() => window.auditStatus === document.querySelector('.template-store .store-count') && window.auditStatus.isConnected));
  await audit.click('.store-nav-toggle');
  await audit.locator('.store-nav [data-section^="cat:"]').first().click();
  await audit.waitForFunction(() => document.activeElement?.matches('.store-nav-toggle'));
  log('320 px : focus sur Catégories après sélection', await audit.locator('.store-nav-toggle').evaluate(el => el === document.activeElement));
  const auditContrast = await audit.evaluate(() => {
    const luminance = rgb => {
      const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const original = document.documentElement.getAttribute('data-theme');
    const ratios = [];
    for (const theme of ['light', 'dark', 'high-contrast']) {
      document.documentElement.setAttribute('data-theme', theme);
      for (const selector of ['#search-boards', '#store-search']) {
        const el = document.querySelector(selector);
        const fg = luminance(getComputedStyle(el, '::placeholder').color);
        let bg = el;
        while (getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)' && bg.parentElement) bg = bg.parentElement;
        const back = luminance(getComputedStyle(bg).backgroundColor);
        ratios.push((Math.max(fg, back) + .05) / (Math.min(fg, back) + .05));
      }
    }
    if (original === null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', original);
    return ratios;
  });
  log('Placeholders : contraste ≥ 4,5 dans les trois thèmes', auditContrast.every(r => r >= 4.5), auditContrast.join(', '));
  await audit.locator('dialog.template-store .dialog-header button').click();
  const auditId = await audit.evaluate(async () => (await import('/js/store/boards.js')).create('Audit', { name: 'Audit', items: [] }).id);
  await audit.goto(BASE + '/#/tableau/' + auditId);
  await audit.waitForFunction(() => document.getElementById('board-title')?.textContent.includes('Audit'));
  await audit.evaluate(() => document.getElementById('btn-help').click());
  await audit.waitForFunction(() => document.activeElement?.id === 'dialog-help-title');
  log('Aide ouverte en haut sur le titre', await audit.locator('#dialog-help').evaluate(el => el.scrollTop === 0));
  log('320 px : raccourcis sans débordement horizontal', await audit.locator('.shortcuts-list').evaluate(el => el.scrollWidth <= el.clientWidth) && await audit.locator('#dialog-help').evaluate(el => el.scrollWidth <= el.clientWidth));
  await audit.evaluate(() => document.getElementById('dialog-help').close());
  await audit.evaluate(async () => {
    const state = await import('/js/state.js');
    state.loadBoard({ name: 'Audit', items: [{ id: 'kb', type: 'kanban', x: 10, y: 10, width: 600, height: 300, columns: [
      { id: 'c1', name: 'À faire', cards: [{ id: 'k1', text: 'Carte audit' }, { id: 'k2', text: 'Deuxième' }] },
      { id: 'c2', name: 'Fait', cards: [] }
    ] }] });
    (await import('/js/views/canvas.js')).focusSub('kb', 'card:k1');
  });
  await audit.waitForSelector('[data-key="kb-move-right"]');
  const leftDisabled = await audit.locator('[data-key="kb-move-left"]').isDisabled();
  await audit.click('[data-key="kb-move-down"]');
  const movedDown = await audit.evaluate(async () => (await import('/js/state.js')).getItem('kb').columns[0].cards[1].id === 'k1');
  await audit.click('[data-key="kb-move-right"]');
  await audit.waitForFunction(async () => (await import('/js/state.js')).getItem('kb').columns[1].cards[0]?.id === 'k1');
  await audit.click('[data-key="kb-move-left"]');
  await audit.click('[data-key="kb-move-down"]');
  await audit.click('[data-key="kb-move-up"]');
  log('Kanban : quatre boutons déplacent la carte et limites désactivées', leftDisabled && movedDown && await audit.locator('[data-key="kb-move-up"]').isDisabled());
  await audit.click('#tab-table');
  await audit.waitForSelector('.sort-btn');
  log('Tri : toutes les cibles font au moins 24 × 24 px', await audit.locator('.sort-btn').evaluateAll(nodes => nodes.length > 0 && nodes.every(el => { const r = el.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; })));
  await audit.click('#tab-canvas');
  await audit.evaluate(async () => {
    (await import('/js/state.js')).loadBoard({ name: 'Audit', items: [
      { id: 'f1', type: 'frame', x: 0, y: 0, width: 600, height: 400, content: 'Premier' },
      { id: 't1', type: 'text', x: 40, y: 80, width: 100, height: 40, content: 'Texte du premier', parent: 'f1' },
      { id: 'f2', type: 'frame', x: 800, y: 0, width: 600, height: 400, content: 'Second' },
      { id: 't2', type: 'text', x: 840, y: 80, width: 100, height: 40, content: 'Texte du second', parent: 'f2' }
    ] });
    document.getElementById('btn-present').click();
  });
  await audit.waitForFunction(() => document.getElementById('presentation-content')?.textContent.includes('Texte du premier'));
  await audit.getByRole('button', { name: 'Suivant', exact: true }).click();
  await audit.waitForFunction(() => document.getElementById('presentation-content')?.textContent.includes('Texte du second'));
  log('Présentation : alternative mise à jour hors aria-live', await audit.locator('#presentation-content').evaluate(el => !el.closest('[aria-live], [role="status"]') && !el.inert && !el.textContent.includes('Texte du premier')));
  await auditCtx.close();

  // === Clic droit et souris (1.8.0) ===
  {
  const rcCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const rc = await rcCtx.newPage();
  const rcErrors = [];
  rc.on('console', m => { if (m.type() === 'error') rcErrors.push(m.text()); });
  rc.on('pageerror', e => rcErrors.push(e.message));
  await rc.goto(BASE + '/#/');
  await rc.waitForSelector('#app-dashboard .btn-preferences');
  const openRcBoard = async page => {
    const id = await page.evaluate(async () => (await import('/js/store/boards.js')).create('Clic droit', { name: 'Clic droit', items: [] }).id);
    await page.evaluate(id => { location.hash = `#/tableau/${id}`; }, id);
    await page.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Clic droit'));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  await openRcBoard(rc);
  const rcItems = [
    { id: 'n1', type: 'sticky_note', x: 200, y: 150, width: 150, height: 150, content: 'Un', color: 'light_yellow' },
    { id: 'n2', type: 'sticky_note', x: 420, y: 150, width: 150, height: 150, content: 'Deux', color: 'light_yellow' },
    { id: 'l1', type: 'connector', start: { x: 650, y: 200 }, end: { x: 950, y: 200 } }
  ];
  const rcLoad = async (page, items = rcItems, selected = []) => page.evaluate(async ({ items, selected }) => {
    const state = await import('/js/state.js');
    state.loadBoard({ name: 'Clic droit', items });
    (await import('/js/views/canvas.js')).zoomReset();
    state.setSelection(selected);
    document.querySelector('.canvas-svg').focus({ preventScroll: true });
  }, { items, selected });
  const rcAt = (page, x, y) => page.evaluate(({ x, y }) => {
    const svg = document.querySelector('.canvas-svg');
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, { x, y });
  const rcWorld = (page, x, y) => page.evaluate(({ x, y }) => {
    const p = new DOMPoint(x, y).matrixTransform(document.querySelector('.canvas-svg').getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }, { x, y });
  const rcView = page => page.evaluate(async () => {
    const canvas = await import('/js/views/canvas.js');
    return { ...canvas.getViewport(), zoom: canvas.getZoom() };
  });
  const rcSelected = page => page.evaluate(async () => (await import('/js/state.js')).getSelectedIds());
  const rcLabels = page => page.locator('.canvas-menu .menu-label').allTextContents();
  const rcRightClick = async (page, x, y) => {
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForSelector('.canvas-menu');
  };
  const rcRightDrag = async (page, from, to, during) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    const seen = during ? await during() : null;
    await page.mouse.up({ button: 'right' });
    return seen;
  };
  const rcPointerMode = (page, mode) => page.evaluate(async mode => (await import('/js/preferences.js')).setPref('pointerMode', mode), mode);

  await rcLoad(rc, rcItems, ['n1']);
  await rc.evaluate(() => { window.rcNative = []; document.addEventListener('contextmenu', e => window.rcNative.push(e.defaultPrevented)); });
  let before = await rcView(rc);
  let start = await rcAt(rc, 1100, 600);
  const cursor = await rcRightDrag(rc, start, { x: start.x - 120, y: start.y - 60 }, () => rc.evaluate(() => getComputedStyle(document.querySelector('.canvas-svg')).cursor));
  let after = await rcView(rc);
  log('Clic droit glissé sur le fond : vue déplacée, grabbing, sans menu ni changement de sélection', Math.abs(after.x - before.x - 120) < 1 && Math.abs(after.y - before.y - 60) < 1 && cursor === 'grabbing' && await rc.locator('.canvas-menu').count() === 0 && (await rcSelected(rc)).join() === 'n1' && await rc.evaluate(() => window.rcNative.length > 0 && window.rcNative.every(Boolean)), `${JSON.stringify(after)} curseur ${cursor}`);

  await rcLoad(rc, rcItems, ['n1']);
  before = await rcView(rc);
  start = await rcAt(rc, 495, 225);
  await rcRightDrag(rc, start, { x: start.x + 80, y: start.y + 40 });
  after = await rcView(rc);
  const unmoved = await rc.evaluate(async () => { const n = (await import('/js/state.js')).getItem('n2'); return n.x === 420 && n.y === 150; });
  log('Clic droit glissé au-dessus d’un objet : vue déplacée, objet immobile, sélection inchangée', Math.abs(before.x - after.x - 80) < 1 && unmoved && (await rcSelected(rc)).join() === 'n1' && await rc.locator('.canvas-menu').count() === 0);

  await rcLoad(rc);
  await rc.evaluate(async () => (await import('/js/views/canvas.js')).edit('n1'));
  await rc.waitForSelector('.inline-editor');
  await rc.keyboard.type('Saisie');
  start = await rcAt(rc, 1100, 600);
  await rcRightDrag(rc, start, { x: start.x - 50, y: start.y });
  const stillEditing = await rc.evaluate(() => document.activeElement?.classList.contains('inline-editor') && document.activeElement.value.endsWith('Saisie'));
  await rc.keyboard.press('Escape');
  await rc.waitForFunction(async () => !document.querySelector('.inline-editor') && (await import('/js/state.js')).getItem('n1').content.endsWith('Saisie'));
  await rcLoad(rc);
  const nDrag = await rcAt(rc, 275, 225);
  await rc.mouse.move(nDrag.x, nDrag.y);
  await rc.mouse.down();
  await rc.mouse.move(nDrag.x + 40, nDrag.y + 20, { steps: 3 });
  await rc.mouse.down({ button: 'right' });
  await rc.mouse.up({ button: 'right' });
  await rc.mouse.move(nDrag.x + 60, nDrag.y + 20, { steps: 2 });
  await rc.mouse.up();
  const dragged = await rc.evaluate(async () => (await import('/js/state.js')).getItem('n1').x);
  log('Édition sur place et glisser d’objet : clic droit sans dégât', stillEditing && dragged === 260 && await rc.locator('.canvas-menu').count() === 0, `édition ${stillEditing}, x ${dragged}`);

  await rcLoad(rc);
  await rc.locator('.canvas-svg').evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  start = await rcAt(rc, 1100, 600);
  await rcRightClick(rc, start.x, start.y);
  const backgroundLabels = await rcLabels(rc);
  const box = await rc.locator('.canvas-menu').boundingBox();
  const gridRole = await rc.locator('.canvas-menu [data-pref="grid"]').getAttribute('role');
  const gridHint = await rc.locator('.canvas-menu [data-pref="grid"] .menu-shortcut').textContent();
  log('Clic droit sur le fond : menu complet à l’emplacement du pointeur et dans l’écran', backgroundLabels.join('|') === 'Coller|Tout déverrouiller|Ajouter un texte|Ajouter un post-it|Ajouter un commentaire|Afficher la grille|Afficher les commentaires|Aligner sur la grille|Afficher la taille des objets|Souris ou pavé tactile…|Tout afficher' && gridRole === 'menuitemcheckbox' && gridHint === 'G' && box.x <= start.x && box.y <= start.y && box.x + box.width <= 1400 && box.y + box.height <= 900 && await rc.evaluate(() => document.activeElement.closest('.canvas-menu[role="menu"]') !== null), backgroundLabels.join('|'));
  await rc.keyboard.press('Escape');

  await rcLoad(rc);
  const nOne = await rcAt(rc, 275, 225);
  await rcRightClick(rc, nOne.x, nOne.y);
  const objectLabels = await rcLabels(rc);
  const selectedFirst = await rcSelected(rc);
  const copyHint = await rc.getByRole('menuitem', { name: 'Copier', exact: true }).locator('.menu-shortcut').textContent();
  await rc.keyboard.press('Escape');
  await rcLoad(rc, rcItems, ['n1', 'n2']);
  await rcRightClick(rc, nOne.x, nOne.y);
  const multiKept = (await rcSelected(rc)).join() === 'n1,n2' && (await rcLabels(rc)).includes('Grouper') && !(await rcLabels(rc)).includes('Propriétés…');
  await rc.keyboard.press('Escape');
  log('Clic droit sur un objet : sélectionne, bon menu, raccourci affiché ; sélection multiple gardée', selectedFirst.join() === 'n1' && objectLabels.join('|') === 'Copier|Couper|Dupliquer|Supprimer|Commenter|Copier le style|Coller le style|Effacer le contenu|Premier plan|Arrière-plan|Verrouiller|Créer un cadre|Enregistrer comme modèle|Exporter en CSV|Propriétés…' && copyHint === 'Ctrl+C' && multiKept, objectLabels.join('|'));

  await rcLoad(rc);
  const onLine = await rcAt(rc, 800, 200);
  await rcRightClick(rc, onLine.x, onLine.y);
  const lineLabels = await rcLabels(rc);
  log('Clic droit sur une ligne : sans Commenter, Effacer le contenu ni Exporter en CSV', (await rcSelected(rc)).join() === 'l1' && !['Commenter', 'Effacer le contenu', 'Exporter en CSV'].some(l => lineLabels.includes(l)) && ['Copier', 'Couper', 'Dupliquer', 'Supprimer', 'Copier le style', 'Coller le style', 'Premier plan', 'Arrière-plan', 'Verrouiller', 'Créer un cadre', 'Enregistrer comme modèle', 'Propriétés…'].every(l => lineLabels.includes(l)), lineLabels.join('|'));
  await rc.getByRole('menuitem', { name: 'Créer un cadre', exact: true }).click();
  await rc.waitForFunction(async () => (await import('/js/state.js')).getItems().some(i => i.type === 'frame'));

  await rcLoad(rc);
  await rcRightClick(rc, start.x, start.y);
  const clickPoint = await rcWorld(rc, start.x, start.y);
  await rc.getByRole('menuitem', { name: 'Ajouter un post-it', exact: true }).click();
  await rc.waitForSelector('.inline-editor');
  const posed = await rc.evaluate(async () => { const s = await import('/js/state.js'); return s.getItem(s.getSelectedId()); });
  await rc.keyboard.press('Escape');
  await rc.waitForFunction(() => !document.querySelector('.inline-editor'));
  await rcRightClick(rc, 500, 500);
  await rc.locator('.canvas-menu [data-pref="snapGrid"]').click();
  await rc.keyboard.press('Escape');
  await rcRightClick(rc, 507, 513);
  await rc.getByRole('menuitem', { name: 'Ajouter un texte', exact: true }).click();
  await rc.waitForSelector('.inline-editor');
  const snapped = await rc.evaluate(async () => { const s = await import('/js/state.js'); const i = s.getItem(s.getSelectedId()); return i.x % 50 === 0 && i.y % 50 === 0; });
  await rc.keyboard.press('Escape');
  await rc.waitForFunction(() => !document.querySelector('.inline-editor'));
  await rc.keyboard.press('ArrowRight');
  const arrowSnapped = await rc.evaluate(async () => { const s = await import('/js/state.js'); return s.getItem(s.getSelectedId()).x % 50 === 0; });
  await rc.evaluate(async () => (await import('/js/preferences.js')).setPref('snapGrid', false));
  log('Ajouter un post-it au point du clic ; Aligner sur la grille aimante à 50', Math.abs(posed.x + posed.width / 2 - clickPoint.x) <= 1 && Math.abs(posed.y + posed.height / 2 - clickPoint.y) <= 1 && posed.type === 'sticky_note' && snapped && arrowSnapped, JSON.stringify({ x: posed.x, y: posed.y, clickPoint }));

  await rcLoad(rc);
  await rcRightClick(rc, start.x, start.y);
  const gridItem = rc.locator('.canvas-menu [data-pref="grid"]');
  const gridBefore = await gridItem.getAttribute('aria-checked');
  await gridItem.click();
  await rc.waitForFunction(() => document.documentElement.hasAttribute('data-no-grid') && /Grille masquée/.test(document.getElementById('announcer').textContent));
  const gridAfter = await gridItem.getAttribute('aria-checked');
  await rc.keyboard.press('Escape');
  await rc.locator('.canvas-svg').focus();
  await rc.keyboard.press('g');
  await rc.waitForFunction(() => !document.documentElement.hasAttribute('data-no-grid'));
  await rc.click('#app-board .btn-preferences');
  const syncedGrid = await rc.locator('.prefs-menu [data-pref="grid"]').getAttribute('aria-checked');
  const prefLabels = await rc.locator('.prefs-menu .menu-label').allTextContents();
  await rc.keyboard.press('Escape');
  await rc.locator('.canvas-svg').focus();
  await rc.keyboard.press('Alt+1');
  await rc.waitForFunction(() => /Vue ajustée/.test(document.getElementById('announcer').textContent));
  await rcLoad(rc, rcItems, ['n1']);
  await rc.evaluate(async () => (await import('/js/preferences.js')).setPref('showSize', true));
  await rc.waitForSelector('.size-label');
  const sizeShown = await rc.locator('.size-label').textContent();
  await rc.evaluate(async () => (await import('/js/preferences.js')).setPref('showSize', false));
  await rc.waitForFunction(() => !document.querySelector('.size-label'));
  log('Coche grille, touche G, Alt+1 et taille des objets, synchronisées avec le menu Préférences', gridBefore === 'true' && gridAfter === 'false' && syncedGrid === 'true' && sizeShown === '150 × 150' && ['Aligner sur la grille', 'Afficher la taille des objets', 'Souris ou pavé tactile…'].every(l => prefLabels.includes(l)), sizeShown);

  await rcLoad(rc, rcItems, ['n1']);
  await rc.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('n1'));
  await rc.keyboard.press('Shift+F10');
  await rc.waitForSelector('.canvas-menu');
  const firstItem = await rc.evaluate(() => document.activeElement.textContent);
  await rc.keyboard.press('ArrowUp');
  const wrapped = await rc.evaluate(() => document.activeElement.querySelector('.menu-label').textContent);
  await rc.keyboard.press('Home');
  await rc.keyboard.press('ArrowDown');
  const second = await rc.evaluate(() => document.activeElement.querySelector('.menu-label').textContent);
  await rc.keyboard.press('End');
  const last = await rc.evaluate(() => document.activeElement.querySelector('.menu-label').textContent);
  await rc.keyboard.press('Escape');
  const focusBack = await rc.evaluate(() => !document.querySelector('.canvas-menu') && document.activeElement.getAttribute('data-id') === 'n1');
  await rcLoad(rc);
  await rc.keyboard.press('ContextMenu');
  await rc.waitForSelector('.canvas-menu');
  const centered = await rc.evaluate(() => {
    const m = document.querySelector('.canvas-menu').getBoundingClientRect(), s = document.querySelector('.canvas-svg').getBoundingClientRect();
    return Math.abs(m.left - (s.left + s.width / 2)) < 2 && document.querySelector('.canvas-menu').getAttribute('aria-label') === 'Menu du canevas';
  });
  await rc.keyboard.press('Escape');
  log('Maj+F10 et touche Menu : flèches, Début, Fin, Échap et retour du focus', firstItem.startsWith('✓Copier') && wrapped === 'Propriétés…' && second === 'Couper' && last === 'Propriétés…' && focusBack && centered && await rc.evaluate(() => document.activeElement.classList.contains('canvas-svg')), `${firstItem} / ${wrapped} / ${second} / ${last} / ${focusBack} / ${centered}`);

  await rcLoad(rc);
  await rcRightClick(rc, 1000, 300);
  const firstPlace = await rc.locator('.canvas-menu').boundingBox();
  await rc.mouse.click(300, 700, { button: 'right' });
  await rc.waitForFunction(({ x }) => { const m = document.querySelector('.canvas-menu'); return m && m.getBoundingClientRect().x !== x; }, { x: firstPlace.x });
  const secondPlace = await rc.locator('.canvas-menu').boundingBox();
  const single = await rc.locator('.canvas-menu').count() === 1;
  await rc.mouse.click(1200, 700);
  await rc.waitForFunction(() => !document.querySelector('.canvas-menu'));
  log('Second clic droit ailleurs : rouvert au bon endroit ; clic extérieur : fermé', single && firstPlace.x === 1000 && firstPlace.y === 300 && secondPlace.x === 300 && secondPlace.y + secondPlace.height <= 900, JSON.stringify({ firstPlace, secondPlace }));

  await rcLoad(rc);
  await rcPointerMode(rc, 'mouse');
  start = await rcAt(rc, 700, 400);
  await rc.mouse.move(start.x, start.y);
  const worldBefore = await rcWorld(rc, start.x, start.y);
  await rc.mouse.wheel(0, -100);
  await rc.waitForFunction(async () => (await import('/js/views/canvas.js')).getZoom() > 1);
  const worldAfter = await rcWorld(rc, start.x, start.y);
  before = await rcView(rc);
  await rc.keyboard.down('Shift');
  await rc.mouse.wheel(0, 100);
  await rc.keyboard.up('Shift');
  await rc.waitForFunction(async x => (await import('/js/views/canvas.js')).getViewport().x !== x, before.x);
  after = await rcView(rc);
  log('Mode Souris : la molette zoome sur le pointeur, Maj+molette déplace à l’horizontale', Math.abs(worldBefore.x - worldAfter.x) < 1 && Math.abs(worldBefore.y - worldAfter.y) < 1 && after.zoom === before.zoom && after.y === before.y && after.x > before.x, JSON.stringify({ worldBefore, worldAfter }));

  await rcLoad(rc);
  await rcPointerMode(rc, 'trackpad');
  before = await rcView(rc);
  await rc.mouse.move(start.x, start.y);
  await rc.mouse.wheel(30, 40);
  await rc.waitForFunction(async x => (await import('/js/views/canvas.js')).getViewport().x !== x, before.x);
  after = await rcView(rc);
  const panned = Math.abs(after.x - before.x - 30) < 1 && Math.abs(after.y - before.y - 40) < 1 && after.zoom === 1;
  await rc.keyboard.down('Control');
  await rc.mouse.wheel(0, -100);
  await rc.keyboard.up('Control');
  await rc.waitForFunction(async () => (await import('/js/views/canvas.js')).getZoom() > 1);
  const pinchPlace = await rcView(rc);
  await rc.evaluate(({ x, y }) => document.querySelector('.canvas-svg').dispatchEvent(new WheelEvent('wheel', { deltaY: 3.5, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), start);
  await rc.waitForFunction(async z => (await import('/js/views/canvas.js')).getZoom() < z, pinchPlace.zoom);
  const padPinch = panned && pinchPlace.zoom > 1 && (await rcView(rc)).zoom > pinchPlace.zoom * 0.9;

  await rcLoad(rc);
  await rcPointerMode(rc, 'auto');
  await rc.evaluate(() => { window.rcWheel = performance.now(); });
  await rc.waitForFunction(() => performance.now() - window.rcWheel > 250);
  const wheelAt = (delta) => rc.evaluate(({ x, y, delta }) => document.querySelector('.canvas-svg').dispatchEvent(new WheelEvent('wheel', { ...delta, clientX: x, clientY: y, bubbles: true, cancelable: true })), { ...start, delta });
  await wheelAt({ deltaY: 2.5, deltaX: 1.5 });
  const padView = await rcView(rc);
  await rc.evaluate(() => { window.rcWheel = performance.now(); });
  await rc.waitForFunction(() => performance.now() - window.rcWheel > 250);
  await wheelAt({ deltaY: -120 });
  const mouseView = await rcView(rc);
  await rc.evaluate(() => { window.rcWheel = performance.now(); });
  await rc.waitForFunction(() => performance.now() - window.rcWheel > 250);
  await wheelAt({ deltaY: -3, deltaMode: 1 });
  const lineView = await rcView(rc);
  log('Mode Pavé tactile et détection automatique : deux doigts déplacent, pincement et molette entière zooment', padPinch && padView.zoom === 1 && padView.y > 0 && mouseView.zoom > 1 && lineView.zoom > mouseView.zoom, JSON.stringify({ pinchPlace, padView, mouseView, lineView }));

  await rcLoad(rc);
  await rcRightClick(rc, 1000, 300);
  await rc.getByRole('menuitem', { name: 'Souris ou pavé tactile…' }).click();
  await rc.waitForSelector('#dialog-pointer[open]');
  const modeNames = await rc.locator('#dialog-pointer label').allTextContents();
  const autoChecked = await rc.getByRole('radio', { name: 'Détection automatique' }).isChecked();
  const described = await rc.evaluate(() => [...document.querySelectorAll('#dialog-pointer input')].every(i => document.getElementById(i.getAttribute('aria-describedby'))?.textContent.length > 20));
  await rc.getByRole('radio', { name: 'Pavé tactile' }).check();
  await rc.waitForFunction(() => document.querySelector('#dialog-pointer [data-announcer]')?.textContent.includes('Pavé tactile'));
  await rc.keyboard.press('Escape');
  const pointerFocus = await rc.evaluate(() => document.activeElement.classList.contains('canvas-svg'));
  await rc.reload();
  await rc.waitForFunction(() => document.getElementById('board-title')?.textContent.endsWith('Clic droit'));
  await rc.click('#app-board .btn-preferences');
  await rc.locator('.prefs-menu').getByRole('menuitem', { name: 'Souris ou pavé tactile…' }).click();
  await rc.waitForSelector('#dialog-pointer[open]');
  const persisted = await rc.getByRole('radio', { name: 'Pavé tactile' }).isChecked();
  await rc.keyboard.press('Escape');
  const stored = await rc.evaluate(() => JSON.parse(localStorage.getItem('tableau-accessible-prefs')).pointerMode);
  log('Réglage Souris ou pavé tactile : trois radios décrites, persistant après rechargement', modeNames.join('|') === 'Souris|Pavé tactile|Détection automatique' && autoChecked && described && pointerFocus && persisted && stored === 'trackpad' && !rcErrors.length, `${modeNames.join('|')} ${rcErrors.join(' ; ')}`);
  await rcCtx.close();

  const narrowCtx = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const narrow = await narrowCtx.newPage();
  await narrow.goto(BASE + '/#/');
  await narrow.waitForSelector('#app-dashboard .btn-preferences');
  await openRcBoard(narrow);
  await rcLoad(narrow, rcItems, []);
  const narrowCheck = async () => narrow.evaluate(() => {
    const m = document.querySelector('.canvas-menu').getBoundingClientRect();
    const targets = [...document.querySelectorAll('.canvas-menu button')].every(b => { const r = b.getBoundingClientRect(); return r.height >= 24 && r.width >= 24; });
    return m.left >= 0 && m.right <= innerWidth && m.top >= 0 && m.bottom <= innerHeight && targets && document.documentElement.scrollWidth <= innerWidth;
  });
  const narrowCorner = await narrow.evaluate(() => {
    const svg = document.querySelector('.canvas-svg');
    for (let y = innerHeight - 4; y > 0; y -= 4) if (svg.contains(document.elementFromPoint(innerWidth - 6, y))) return { x: innerWidth - 6, y };
    return null;
  });
  await rcRightClick(narrow, narrowCorner.x, narrowCorner.y);
  const narrowFond = await narrowCheck();
  await narrow.keyboard.press('Escape');
  await narrow.evaluate(async () => (await import('/js/views/canvas.js')).focusItem('n1'));
  await narrow.keyboard.press('Shift+F10');
  await narrow.waitForSelector('.canvas-menu');
  const narrowObjet = await narrowCheck();
  const narrowComplete = await narrow.locator('.canvas-menu').evaluate(m => m.scrollHeight <= m.clientHeight);
  await narrow.keyboard.press('Escape');
  await narrow.evaluate(async () => (await import('/js/views/pointer-settings.js')).open());
  await narrow.waitForSelector('#dialog-pointer[open]');
  const narrowDialog = await narrow.evaluate(() => { const d = document.getElementById('dialog-pointer'); return d.scrollWidth <= d.clientWidth && document.documentElement.scrollWidth <= innerWidth; });
  log('320 px : menus et dialogue sans débordement, cibles d’au moins 24 px', narrowFond && narrowObjet && narrowComplete && narrowDialog, `${narrowFond} ${narrowObjet} ${narrowComplete} ${narrowDialog}`);
  await narrowCtx.close();
  }
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
