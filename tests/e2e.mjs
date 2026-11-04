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
  for (const [key, button] of [['n', 'btn-sticky'], ['t', 'btn-text'], ['r', 'btn-shape'], ['l', null]]) {
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
  log('Point bleu : tirer vers un objet crée une flèche, relâcher dans le vide ne crée rien', decorative && link?.startId === 'item-1' && link.endId === 'item-2' && link.lineType === 'arrow' && (await snapshot()).items.length === 4);

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
    await p320.click('#btn-comments');
    const cp = await p320.locator('#comments-panel').boundingBox();
    const wComments = await p320.$eval('body', el => el.scrollWidth);
    await p320.keyboard.press('Escape');
    log('320px : panneaux Plus d’outils et Commentaires sans débordement', tp && cp && tp.x >= 0 && tp.x + tp.width <= 320 && cp.x >= 0 && cp.x + cp.width <= 320 && wTools <= 320 && wComments <= 320, `${wTools}/${wComments}`);
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
