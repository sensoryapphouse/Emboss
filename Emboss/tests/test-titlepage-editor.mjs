// K29 Stage 1c: the Title Page editor card (design docs/transcriber-pages-customisation-design.md §4).
// Checks: inserting via the slash command and the style menu; the Book details dialog opening by
// itself on insertion; the card's accessible names (role=group card, labelled segment groups, chip
// aria-labels); editing a line (turns the page "edited"); Regenerate plus undo; a live field update
// after a Book details change (TP-6, decisions.md — fields stay live even on an edited page); a
// save -> reload round trip; and the style hidden while Transcriber tools are off.
//
// Needs the dev server:  node Emboss/scripts/serve.mjs <port> &
//   node Emboss/tests/test-titlepage-editor.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};

const settingsJson = (extra = {}) => JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', ...extra });

const browser = await launchBrowser({ args: ['--no-sandbox'] });

async function freshContext(settingsExtra) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript((json) => { try { localStorage.setItem('emboss-settings', json); } catch {} }, settingsJson(settingsExtra));
  return ctx;
}

async function openEditor(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.exportCurrentDocumentXml === 'function' && typeof window.markDocumentClean === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  return { page, errors };
}

// A book with enough Book details set that the Title Page's Title/Author/Transcriber/Volume
// segments all have at least one line (Publisher segment is left blank, so line-dropping shows too).
// Book details are set through the real "Book details…" dialog (like test-titlepage-details.mjs),
// not by poking `options` into modelToLexical's argument, which only builds editor nodes — the
// document-level book-detail fields the Title Page reads (tpCurrentModel/loadedDocInfo.options)
// are a separate store the dialog's own save path is what actually updates.
async function seedBookDetails(page) {
  await page.evaluate(() => {
    window.modelToLexical({ blocks: [{ type: 'heading', level: 1, text: 'Prentice Hall Literature' }, { type: 'para', text: 'Chapter one.' }] });
  });
  await page.evaluate(() => window.render());
  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('.settings-nav .tab-btn[data-tab="tab-document"]');
  await page.click('#btnTitlepageDetails');
  await page.waitForSelector('#titlepageDetailsDialog[open]');
  // title/authors go through the SAME dialog (loadedDocInfo.title/.metadata) — modelToLexical alone
  // never touches loadedDocInfo, which is what titlePageFieldsFrom (via tpCurrentModel) reads.
  await page.fill('#tpTitle', 'Prentice Hall Literature');
  await page.fill('#tpAuthors', 'Jane Author');
  await page.fill('#tpTranscriber', 'Pat Transcriber');
  await page.fill('#tpYear', '2026');
  await page.click('#titlepageDetailsSave');
  await page.waitForSelector('#titlepageDetailsDialog[open]', { state: 'hidden' });
}

// K29 Stage 1d: a book with a Title Page AND a Special Symbols page and a Transcriber's Notes page
// already on it, loaded straight through modelToLexical's generic block loader (appendBlock's
// 'titlepage'/'sympage'/'tnpage' cases — see editor.mjs) rather than the insertTitlePage()/insertSymPage()/
// insertTnPage() UI actions, so nothing here pops open the Book details or Suggested Notes dialogs.
async function seedFullBookWithPages(page) {
  await page.evaluate(() => {
    window.modelToLexical({ blocks: [
      { type: 'titlepage', matter: 'transcriber', auto: true },
      { type: 'sympage', matter: 'transcriber', entries: [{ print: '•', braille: '⠒', description: 'Bullet' }] },
      { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'Nemeth code is used for mathematics.' }] },
      { type: 'heading', level: 1, text: 'Prentice Hall Literature' },
      { type: 'para', text: 'Chapter one.' },
    ] });
  });
  await page.evaluate(() => window.render());
  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('.settings-nav .tab-btn[data-tab="tab-document"]');
  await page.click('#btnTitlepageDetails');
  await page.waitForSelector('#titlepageDetailsDialog[open]');
  await page.fill('#tpTitle', 'Prentice Hall Literature');
  await page.fill('#tpAuthors', 'Jane Author');
  await page.fill('#tpTranscriber', 'Pat Transcriber');
  await page.fill('#tpYear', '2026');
  await page.click('#titlepageDetailsSave');
  await page.waitForSelector('#titlepageDetailsDialog[open]', { state: 'hidden' });
}

const cardInfo = () => page => page.evaluate(() => {
  const card = document.querySelector('#editor .emboss-titlepage-card');
  if (!card) return null;
  const segments = [...card.querySelectorAll('.tp-segment')].map((s) => ({
    name: s.getAttribute('aria-label'),
    role: s.getAttribute('role'),
    lines: [...s.querySelectorAll('.ed-p, p')].map((p) => p.textContent.trim()),
  }));
  const chips = [...card.querySelectorAll('.tp-field-chip')].map((c) => ({ field: c.title, text: c.textContent, ariaLabel: c.getAttribute('aria-label') }));
  return {
    role: card.getAttribute('role'), ariaLabel: card.getAttribute('aria-label'), auto: card.dataset.auto,
    segments, chips,
  };
});

// ==================================================================================
// 1. Hidden when Transcriber tools are off (style dropdown + slash menu); shown when on
// ==================================================================================
console.log('--- Transcriber tools gate ---');
{
  const ctx = await freshContext({ transcriberTools: false });
  const { page, errors } = await openEditor(ctx);
  const optValues = await page.$$eval('#blockStyle option', (os) => os.filter((o) => !o.hidden).map((o) => o.value));
  ok('titlepage is not in the style dropdown while Transcriber tools is off', !optValues.includes('titlepage'), optValues);
  await page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: '' }] }); });
  await page.locator('#editor').click();
  await page.keyboard.type('/titlepage');
  await page.waitForTimeout(300);
  const slashIds = await page.$$eval('#slashList .slash-item', (els) => els.map((e) => e.id.replace('slash-opt-', ''))).catch(() => []);
  ok('/titlepage is not offered by the slash menu while Transcriber tools is off', !slashIds.includes('titlepage'), slashIds);
  await page.keyboard.press('Escape').catch(() => {});
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 2. Insert via the slash command: card appears, Book details dialog opens by itself
// ==================================================================================
console.log('--- Insert via /titlepage ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => { window.editor.update(() => { window.editor.getEditorState()._nodeMap.get('root').getFirstChild().selectStart(); }); window.editor.focus(); });
  await page.keyboard.type('/titlepage');
  await page.waitForSelector('#slashList .slash-item', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.waitForSelector('#titlepageDetailsDialog[open]', { timeout: 10000 });
  ok('the Book details dialog opens by itself on insertion (design §4)', await page.evaluate(() => document.getElementById('titlepageDetailsDialog').open));
  await page.click('#titlepageDetailsClose');
  const info = await cardInfo()(page);
  ok('the card is inserted at the START of the book', await page.evaluate(() => document.querySelector('#editor > *:first-child')?.classList.contains('emboss-titlepage-card')));
  ok('inserting again re-uses the same page (design §3.4: at most one)', await page.evaluate(() => document.querySelectorAll('#editor .emboss-titlepage-card').length === 1));
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 3. Insert via the style dropdown
// ==================================================================================
console.log('--- Insert via the style menu ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => { window.editor.update(() => { window.editor.getEditorState()._nodeMap.get('root').getFirstChild().selectStart(); }); window.editor.focus(); });
  await page.selectOption('#blockStyle', 'titlepage');
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  ok('the style menu inserts the Title Page too', true);
  await page.click('#titlepageDetailsClose').catch(() => {});
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 4. Accessible names: card, segment groups, field chips
// ==================================================================================
console.log('--- Accessible names ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});
  const info = await cardInfo()(page);
  ok('the card is a role=group aside, labelled "Title Page"', info.role === 'group' && info.ariaLabel === 'Title Page', info);
  ok('every segment is its own labelled role=group', info.segments.length >= 4 && info.segments.every((s) => s.role === 'group' && s.name), info.segments.map((s) => s.name));
  ok('segments are in BANA order (Title, Author, ..., Transcriber, Volume)', info.segments[0].name === 'Title' && info.segments.some((s) => s.name === 'Author') && info.segments[info.segments.length - 1].name === 'Volume', info.segments.map((s) => s.name));
  ok('the Publisher and copyright segment is dropped (no book details set for it)', !info.segments.some((s) => s.name === 'Publisher and copyright'), info.segments.map((s) => s.name));
  const titleChip = info.chips.find((c) => c.field === 'title');
  ok('the title field chip announces "Title, field, <value>"', titleChip && /title, field, Prentice Hall Literature/i.test(titleChip.ariaLabel), titleChip);
  const volChip = info.chips.find((c) => c.field === 'totalVolumes');
  ok('the Volume segment always has a totalVolumes chip (TP-11: "In 1 Volume")', !!volChip, info.chips);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 5. Editing a line turns the page "edited"; Regenerate + Undo
// ==================================================================================
console.log('--- Editing, Regenerate, Undo ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  const brfNoTitlePage = await page.evaluate(() => window.lastBrf);
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});

  const before = await cardInfo()(page);
  ok('a freshly-inserted page is auto', before.auto === '1', before.auto);
  ok('Regenerate is hidden/disabled while the page is unedited', await page.evaluate(() => { const b = document.getElementById('btnTitlepageRegen'); return !b || b.hidden || b.disabled; }));
  // The braille pane re-renders asynchronously: wait until it shows the inserted title page, and has
  // settled, before taking the "original" braille (28 Sep: taken too early, it held no title page at all).
  await page.waitForFunction((prev) => window.lastBrf !== prev, brfNoTitlePage, { timeout: 10000 });
  await page.waitForTimeout(400);
  const brfBefore = await page.evaluate(() => window.lastBrf);

  // Click into the Title segment's line and type extra text — an ordinary edit (design §4 "Each
  // line is an ordinary paragraph the transcriber can type in, delete, or add to").
  await page.locator('#editor .emboss-titlepage-card .tp-segment').first().locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (revised)');
  await page.waitForTimeout(400);   // syncTitlePages/the flip-listener run on the next update tick
  const edited = await cardInfo()(page);
  ok('the page is marked edited (auto off) after typing on it', edited.auto === '' || edited.auto === undefined || edited.auto === null, edited.auto);
  ok('the typed text is on the page', edited.segments[0].lines.some((l) => l.includes('(revised)')), edited.segments[0].lines);
  const regenBtn = await page.evaluate(() => { const b = document.getElementById('btnTitlepageRegen'); return { hidden: b?.hidden, disabled: b?.disabled }; });
  ok('Regenerate becomes available once the page is edited', regenBtn.hidden === false && regenBtn.disabled === false, regenBtn);
  // K29 Stage 1c rework (Fable review): the braille pane must reflect the edited wording, not just
  // the card — format/document.mjs's traceTitlePage now lays out an edited page's own segments.
  await page.waitForFunction((prev) => window.lastBrf !== prev, brfBefore, { timeout: 5000 });
  const brfEdited = await page.evaluate(() => window.lastBrf);
  ok('editing the card changes the braille pane (the edit reaches the braille)', brfEdited !== brfBefore, { before: brfBefore?.slice(0, 80), after: brfEdited?.slice(0, 80) });

  await page.click('#btnTitlepageRegen');
  await page.waitForTimeout(300);
  const regenerated = await cardInfo()(page);
  ok('Regenerate removes the hand-typed text', !regenerated.segments[0].lines.some((l) => l.includes('(revised)')), regenerated.segments[0].lines);
  ok('Regenerate turns the page back to auto', regenerated.auto === '1', regenerated.auto);
  const brfRegenerated = await page.evaluate(() => window.lastBrf);
  ok('Regenerate restores the ORIGINAL (pre-edit) braille exactly', brfRegenerated === brfBefore, { before: brfBefore?.slice(0, 80), after: brfRegenerated?.slice(0, 80) });

  // The editor's own undo shortcut (a debounced, whole-document history stack — editor.mjs's
  // performUndo/scheduleHistorySnapshot, not Lexical's HistoryPlugin) keys off navigator.platform,
  // which Playwright reports as the (Mac) host's own platform here, so Cmd+Z, not Ctrl+Z.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  const undone = await cardInfo()(page);
  ok('Undo (one step) brings the edited wording back', undone.segments[0].lines.some((l) => l.includes('(revised)')), undone.segments[0].lines);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 6. Live field update after a Book details change (TP-6), on both an auto and an edited page
// ==================================================================================
console.log('--- Live field update (TP-6) ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});

  // Edit a DIFFERENT line first (the Title line), so the Transcriber chip's own line-structure
  // stays untouched and TP-6's "live on an edited page too" can be checked on it.
  await page.locator('#editor .emboss-titlepage-card .tp-segment').first().locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.waitForTimeout(400);
  ok('setup: the page is now edited', (await cardInfo()(page)).auto !== '1');

  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('.settings-nav .tab-btn[data-tab="tab-document"]');
  await page.click('#btnTitlepageDetails');
  await page.waitForSelector('#titlepageDetailsDialog[open]');
  await page.fill('#tpTranscriber', 'A Different Transcriber');
  await page.click('#titlepageDetailsSave');
  await page.waitForTimeout(400);

  const after = await cardInfo()(page);
  const transChip = after.chips.find((c) => c.field === 'transcriber');
  ok('the transcriber chip updates on an EDITED page (TP-6: fields stay live)', transChip && transChip.text === 'A Different Transcriber', transChip);
  ok('the hand-typed "!" on the Title line survived (structure untouched)', after.segments[0].lines.some((l) => l.includes('!')), after.segments[0].lines);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 7. Save -> reload round trip
// ==================================================================================
console.log('--- Save -> reload round trip ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});
  await page.locator('#editor .emboss-titlepage-card .tp-segment').first().locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (a hand-edited title)');
  await page.waitForTimeout(400);

  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('the page saves as a DTBook level1 with no bana-tp-auto (edited)', /<level1 class="bana-title-page">/.test(xml), xml.match(/<level1 class="bana-title-page[^"]*">/)?.[0]);
  ok('the hand-typed wording is in the saved XML', xml.includes('(a hand-edited title)'), xml.slice(0, 400));
  ok('a field chip is saved as a bana-field span', /<span class="bana-field" title="title">/.test(xml));

  await page.evaluate(async (savedXml) => {
    window.markDocumentClean();
    await window.importFile(new File([savedXml], 'titlepage-reload-test.xml', { type: 'text/xml' }));
  }, xml);
  await page.waitForFunction(() => (window.lastModel?.blocks || []).some((b) => b.type === 'titlepage'), null, { timeout: 20000 });
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.waitForTimeout(300);
  const reloaded = await cardInfo()(page);
  ok('the edited wording survives a save/reload', reloaded.segments[0].lines.some((l) => l.includes('(a hand-edited title)')), reloaded.segments[0].lines);
  ok('the reloaded page is still marked edited (not auto)', reloaded.auto !== '1', reloaded.auto);
  ok('no console/page errors', !errors.length, errors);

  // Leave the browser storage tidy for the next run (memory rule: emboss-chrome-test-hygiene).
  await page.evaluate(() => { window.markDocumentClean(); return window.__clearAutosaveSnapshot && window.__clearAutosaveSnapshot(); });
  await ctx.close();
}

// ==================================================================================
// 8. UKAAF mode: the card shows UK content (UK-9), not BANA's
// ==================================================================================
console.log('--- UKAAF title page content ---');
{
  const ctx = await freshContext({ transcriberTools: true, mode: 'ukaaf' });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});
  const info = await cardInfo()(page);
  ok('UKAAF: the Title segment shows the title', info.segments.some((s) => s.name === 'Title' && s.lines.some((l) => l.includes('Prentice Hall Literature'))), info.segments);
  ok('UKAAF: the Author segment shows the author', info.segments.some((s) => s.name === 'Author' && s.lines.some((l) => l.includes('Jane Author'))), info.segments);
  ok('UKAAF: no Transcriber segment (UK-9: not shown), though Book details has one set', !info.segments.some((s) => s.name === 'Transcriber'), info.segments.map((s) => s.name));
  ok('UKAAF: no braille-code field chip anywhere on the page', !info.chips.some((c) => c.field === 'brailleCode'), info.chips);
  ok('UKAAF: no print-page-range field chip (UK-9: not shown)', !info.chips.some((c) => c.field === 'printPages'), info.chips);
  const volSeg = info.segments.find((s) => s.name === 'Volume');
  ok('UKAAF: the Volume segment gives the volume notice in words ("In one volume")', !!volSeg && volSeg.lines.some((l) => /in one volume/i.test(l)), volSeg);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 9. K29 Stage 1d "Insert field": puts a chip at the cursor and the braille shows the value
// ==================================================================================
console.log('--- Insert field: puts a chip at the cursor, braille shows the value ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});
  await page.waitForTimeout(300);

  const before = await cardInfo()(page);
  const titleLineBefore = before.segments[0].lines[0];
  const brfBefore = await page.evaluate(() => window.lastBrf);

  // Click at the end of the Title segment's first line and insert the Transcriber field there —
  // design §4: "puts a field chip at the cursor" (a field the Title line does not normally carry).
  await page.locator('#editor .emboss-titlepage-card .tp-segment').first().locator('p').first().click();
  await page.keyboard.press('End');
  ok('the Insert field button is shown with the caret in a Title Page line', await page.evaluate(() => !document.getElementById('btnTpInsertField')?.hidden));
  await page.click('#btnTpInsertField');
  await page.waitForSelector('#tpInsertFieldMenu:not([hidden])');
  const items = await page.$$eval('#tpInsertFieldMenu .menu-dropdown-item', (els) => els.map((e) => e.textContent.trim()));
  ok('the menu lists field labels (e.g. "Transcriber")', items.includes('Transcriber'), items);
  await page.locator('#tpInsertFieldMenu .menu-dropdown-item', { hasText: 'Transcriber' }).click();
  await page.waitForTimeout(300);

  const after = await cardInfo()(page);
  ok('a new chip for the inserted field is on the page', after.chips.filter((c) => c.field === 'transcriber').length > before.chips.filter((c) => c.field === 'transcriber').length, after.chips);
  ok('the Title line now carries the inserted value, live (design §4)', after.segments[0].lines[0] !== titleLineBefore && after.segments[0].lines[0].includes('Pat Transcriber'), after.segments[0].lines[0]);
  ok('the page is marked edited (inserting a field changes the page’s structure)', after.auto !== '1', after.auto);

  // lastBrf is braille (dot patterns), not literal print text, so the inserted VALUE cannot be found
  // by a plain string search — the braille pane changing at all, on a page that already reflects the
  // field's value in the card (checked above), is what "the braille shows the value" means here.
  await page.waitForFunction((prev) => window.lastBrf !== prev, brfBefore, { timeout: 5000 });
  const brfAfter = await page.evaluate(() => window.lastBrf);
  ok('the braille pane reflects the inserted field (re-rendered, and longer by one more line’s worth)', brfAfter !== brfBefore && brfAfter.length > brfBefore.length, { beforeLen: brfBefore.length, afterLen: brfAfter.length });
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 10. Insert field is keyboard-reachable (Ctrl/⌘+Shift+F) and announced
// ==================================================================================
console.log('--- Insert field: keyboard-reachable and announced ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});
  await page.waitForTimeout(300);

  await page.locator('#editor .emboss-titlepage-card .tp-segment').last().locator('p').first().click();
  await page.keyboard.press('Home');
  await page.evaluate(() => { document.getElementById('announce').textContent = ''; });
  // Playwright reports the (Mac) host's own platform (same reasoning as the Undo test's Meta+z above).
  await page.keyboard.press('Meta+Shift+F');
  await page.waitForSelector('#tpInsertFieldMenu:not([hidden])', { timeout: 5000 });
  ok('Ctrl/⌘+Shift+F opens the Insert-field menu', await page.evaluate(() => !document.getElementById('tpInsertFieldMenu').hidden));
  ok('the toggle button reports aria-expanded=true', await page.evaluate(() => document.getElementById('btnTpInsertField').getAttribute('aria-expanded') === 'true'));
  const focusedIsMenuItem = await page.evaluate(() => document.activeElement?.closest('#tpInsertFieldMenu') != null && document.activeElement.getAttribute('role') === 'menuitem');
  ok('focus moves into the menu (keyboard-reachable)', focusedIsMenuItem);

  await page.keyboard.press('Enter');   // activates the focused (first) menu item
  await page.waitForTimeout(300);
  const announceText = await page.evaluate(() => document.getElementById('announce')?.textContent || '');
  ok('the inserted field is announced to screen readers (design §4)', /field/i.test(announceText) && announceText.length > 0, announceText);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 11. K29 Stage 1d "Print title page…" — HTML (intercept window.print/window.open, not the real dialog)
// ==================================================================================
console.log('--- Print title page… ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedFullBookWithPages(page);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    window.__printTest = { opened: false, printed: false, openedHtml: null };
    window.open = () => {
      window.__printTest.opened = true;
      return {
        document: { open() {}, write(html) { window.__printTest.openedHtml = html; }, close() {} },
        focus() {},
        print() { window.__printTest.printed = true; },
      };
    };
  });

  ok('"Print title page…" is offered (the document has a Title Page)', await page.evaluate(() => !document.getElementById('printTitlepageItem')?.hidden));
  await page.click('#downloadBtn');
  await page.waitForSelector('#downloadMenu:not([hidden])');
  await page.click('#printTitlepageItem');
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => window.__printTest);
  ok('window.open was called (the print copy opens in a new window)', result.opened);
  ok('window.print was called (opens the browser’s print dialog)', result.printed);
  ok('the HTML carries the title page’s own lines with current field values', result.openedHtml && result.openedHtml.includes('Prentice Hall Literature') && result.openedHtml.includes('Pat Transcriber'), result.openedHtml?.slice(0, 400));
  ok('the HTML includes the Special Symbols page (KD 5d)', result.openedHtml && /Special Symbols/i.test(result.openedHtml) && result.openedHtml.includes('Bullet'), result.openedHtml?.length);
  ok('the HTML includes the Transcriber’s Notes page (KD 5d)', result.openedHtml && result.openedHtml.includes('Nemeth code is used for mathematics.'), result.openedHtml?.length);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 12. The BRF/PEF export offer to also save the print copy appears
// ==================================================================================
console.log('--- Export offer: save the print copy alongside BRF/PEF ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await seedBookDetails(page);
  ok('no offer before a Title Page exists', await page.evaluate(() => document.getElementById('titlepagePrintOffer')?.hidden !== false));
  await page.evaluate(() => window.insertTitlePage());
  await page.waitForSelector('#editor .emboss-titlepage-card', { timeout: 10000 });
  await page.click('#titlepageDetailsClose').catch(() => {});
  await page.waitForTimeout(300);

  await page.click('#downloadBtn');
  await page.waitForSelector('#downloadMenu:not([hidden])');
  await page.click('#downloadBrfItem');
  await page.waitForTimeout(200);
  ok('the export offer appears after a BRF export of a document with a Title Page', await page.evaluate(() => document.getElementById('titlepagePrintOffer')?.hidden === false));

  await page.click('#titlepagePrintOfferDismiss');
  ok('Dismiss hides the offer again', await page.evaluate(() => document.getElementById('titlepagePrintOffer')?.hidden === true));
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

await browser.close();
console.log(`\n=== titlepage-editor [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All titlepage-editor checks passed.');
}
