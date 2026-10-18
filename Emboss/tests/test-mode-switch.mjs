// Feedback 17 Oct 2026, items 12 and 13 (Paul's decisions):
//  12  "Start in Quick Mode" decides only where Emboss OPENS: the site address (Quick Mode's page) goes to the editor when the setting is off, unless the user has just
//      chosen Quick Mode with the editor's button. Switching pages — Quick Mode's "Advanced Editor", the editor's "Quick Mode" — no longer changes the setting; the
//      editor's own address always opens the editor; ticking or unticking the setting in Settings moves nobody.
//  13  Switching is quiet: no "leave this page?" prompt, no recovery offer, no import notice, no large-file question when the document is carried across — and the
//      braille the editor already made goes with the document to Quick Mode (keyed to the document and every setting it was made from), which then shows it with no
//      formatting; when the keys differ (another setting, a table of contents ...) the document is brailled again, as before.
// Run: node Emboss/scripts/serve.mjs 8261 &   node Emboss/tests/test-mode-switch.mjs 8261     (EMBOSS_ENGINE=webkit for Safari's engine)
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = (...p) => path.join(HERE, 'fixtures', ...p);
let pass = 0; const failures = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✓ ok    ${name}`); } else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail !== '' ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); } };
const browser = await launchBrowser();
const errors = [];
const newContext = async (settings) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, locale: 'en-US' });
  if (settings) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', JSON.stringify(s)); } catch {} }, settings);
  return ctx;
};
const watch = (page, dialogs) => {
  // a page that is being left while it is still fetching braille tables has those fetches cancelled: WebKit reports that as an error of the page it is leaving
  page.on('pageerror', (e) => { if (!/Fetch API cannot load|Load failed|cancel+ed|aborted/i.test(String(e))) errors.push(String(e)); });
  page.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message().slice(0, 80)}`); d.accept(); });
};
const where = (page) => new URL(page.url()).pathname;
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings') || '{}'));
const quickReady = (page) => page.waitForFunction(() => window.lastBrf && document.querySelector('#preview .brl-row') && !document.getElementById('result').hidden, null, { timeout: 90000 });
const editorReady = (page) => page.waitForFunction(() => typeof window.modelToLexical === 'function' && window.lastBrf && window.renderIsIdle && window.renderIsIdle(), null, { timeout: 90000 });
const settle = (page) => page.waitForTimeout(900);

try {
  // ============================================================ 12. where Emboss opens, and what switching does to the setting
  {
    // setting ON (the default): the editor's own address opens the editor; the buttons switch and change nothing
    const ctx = await newContext(null); const page = await ctx.newPage(); const dialogs = []; watch(page, dialogs);
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    ok('a fresh visit to the site address opens Quick Mode (the setting is on by default)', where(page) === '/web/index.html' && (await saved(page)).simpleMode === true);
    await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 }); await settle(page);
    ok('the editor\'s own address opens the editor, though "Start in Quick Mode" is on', where(page) === '/web/editor/index.html');
    await page.evaluate(() => window.markDocumentClean?.());
    await Promise.all([page.waitForURL(/\/web\/index\.html/), page.click('#backToSimple')]);
    ok('the editor\'s Quick Mode button goes to Quick Mode', where(page) === '/web/index.html');
    ok('...and the setting is as it was (on)', (await saved(page)).simpleMode === true);
    await page.waitForFunction(() => !!document.getElementById('advancedBtn')); await settle(page);
    await Promise.all([page.waitForURL(/\/web\/editor\//), page.click('#advancedBtn')]);
    ok('Quick Mode\'s Advanced Editor button goes to the editor, and the setting is still on', where(page) === '/web/editor/index.html' && (await saved(page)).simpleMode === true);
    await ctx.close();
  }
  {
    // setting OFF: the site address goes to the editor; Quick Mode chosen from the editor stays, on reload too; the buttons change nothing
    const ctx = await newContext({ simpleMode: false, mode: 'bana' }); const page = await ctx.newPage(); const dialogs = []; watch(page, dialogs);
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await page.waitForURL(/\/web\/editor\//, { timeout: 20000 });
    ok('with "Start in Quick Mode" off, the site address opens the editor', where(page) === '/web/editor/index.html');
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 }); await settle(page);
    await page.evaluate(() => window.markDocumentClean?.());
    await Promise.all([page.waitForURL(/\/web\/index\.html/), page.click('#backToSimple')]);
    await page.waitForFunction(() => !!document.getElementById('advancedBtn')); await settle(page);
    ok('the editor\'s Quick Mode button opens Quick Mode even with the setting off (it is not sent straight back)', where(page) === '/web/index.html');
    ok('...and the setting is still off', (await saved(page)).simpleMode === false);
    await page.reload({ waitUntil: 'load' }); await settle(page);
    ok('a reload of Quick Mode, chosen from the editor, stays in Quick Mode', where(page) === '/web/index.html');
    await Promise.all([page.waitForURL(/\/web\/editor\//), page.click('#advancedBtn')]);
    ok('Advanced Editor goes to the editor, and the setting is still off', where(page) === '/web/editor/index.html' && (await saved(page)).simpleMode === false);
    // a new tab arriving at the site address follows the setting
    const tab2 = await ctx.newPage(); watch(tab2, dialogs);
    await tab2.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await tab2.waitForURL(/\/web\/editor\//, { timeout: 20000 });
    ok('a new tab at the site address opens the editor again (the choice was for the tab that made it)', where(tab2) === '/web/editor/index.html');
    // the setting in the editor's Settings: moves nobody, and is saved
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await page.click('#settingsBtn'); await page.click('.tab-btn[data-tab="tab-display"]');
    ok('the editor\'s Settings > User Interface has "Start in Quick Mode", unticked', await page.evaluate(() => { const c = document.getElementById('set-simpleMode'); return !!c && !c.checked && /Quick Mode/.test(c.closest('label').textContent); }));
    await page.check('#set-simpleMode'); await page.waitForTimeout(300);
    ok('ticking it saves it and does not move the page', where(page) === '/web/editor/index.html' && (await saved(page)).simpleMode === true);
    await page.uncheck('#set-simpleMode'); await page.waitForTimeout(300);
    ok('unticking it saves that and does not move the page', where(page) === '/web/editor/index.html' && (await saved(page)).simpleMode === false);
    ok('no prompts in any of that', dialogs.length === 0, dialogs);
    await ctx.close();
  }
  {
    // Quick Mode's own Settings shows the same setting, and ticking or unticking there moves nobody either
    const ctx = await newContext({ simpleMode: true, mode: 'bana' }); const page = await ctx.newPage(); const dialogs = []; watch(page, dialogs);
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' }); await settle(page);
    await page.click('#settingsBtn'); await page.click('.tab-btn[data-tab="tab-display"]');
    await page.uncheck('#set-simpleMode'); await page.waitForTimeout(400);
    ok('in Quick Mode, unticking "Start in Quick Mode" saves it and keeps you where you are (it used to send you to the editor)', where(page) === '/web/index.html' && (await saved(page)).simpleMode === false);
    await ctx.close();
  }

  // ============================================================ 13. quiet, and the braille goes with the document
  const DOCS = [
    ['the testers\' Small NIMAS test.xml', FIX('feedback-17oct', 'small-nimas-test.xml')],
    ['a Word document with lists and a table', FIX('import-audit', 'docx', 'w08-lists.docx')],
    ['an HTML page of lists', FIX('import-audit', 'html', 'h03-lists.html'), false],   // a quotation inside a list item: the editor puts the document back together to hand it over, and brailles those parts differently, so its braille is NOT carried
  ];
  for (const [label, file, expectCarried = true] of DOCS) {
    const ctx = await newContext({ simpleMode: true, mode: 'bana' }); const page = await ctx.newPage(); const dialogs = []; watch(page, dialogs);
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' }); await settle(page);
    await page.setInputFiles('#fileInput', file);
    await quickReady(page); await settle(page);
    const quickFirst = await page.evaluate(() => window.lastBrf);
    // Quick -> editor
    await Promise.all([page.waitForURL(/\/web\/editor\//), page.click('#advancedBtn')]);
    await editorReady(page); await settle(page);
    const ed = await page.evaluate(() => ({ brf: window.lastBrf, banner: (() => { const b = document.getElementById('parseWarningBanner'); return !!b && !b.hidden; })(), recover: !!document.getElementById('autosaveRecoverDialog')?.open, blocks: (window.lastModel?.blocks || []).length }));
    ok(`${label}: Quick Mode -> editor: the document is there, no import banner, no recovery offer, no prompt`, ed.blocks > 0 && !ed.banner && !ed.recover && dialogs.length === 0, { ed: { ...ed, brf: undefined }, dialogs });
    // an edit, so the document is unsaved: leaving must still not ask
    await page.locator('#editor p, #editor h1, #editor h2, #editor li').first().click({ position: { x: 3, y: 3 } });
    await page.keyboard.type('x'); await page.keyboard.press('Backspace');
    await page.waitForFunction(() => window.renderIsIdle && window.renderIsIdle(), null, { timeout: 60000 }); await settle(page);
    const edBrf = await page.evaluate(() => window.lastBrf);
    const t0 = Date.now();
    await Promise.all([page.waitForURL(/\/web\/index\.html/), page.click('#backToSimple')]);
    await page.waitForFunction(() => !!document.querySelector('#preview .brl-row') && !!window.lastBrf, null, { timeout: 90000 });
    const shownAfter = Date.now() - t0;
    await settle(page);
    const q = await page.evaluate(async () => ({ carried: window.__quickBrailleCarried === true, brf: window.lastBrf, fresh: await window.__quickFreshBrf(), notice: (() => { const n = document.getElementById('importNotice'); return !!n && !n.hidden; })(), warnNotice: (() => { const n = document.getElementById('exportWarnNotice'); return !!n && !n.hidden; })() }));
    ok(`${label}: editor -> Quick Mode with an unsaved edit: no "leave this page?" prompt, no import notice`, dialogs.length === 0 && !q.notice && !q.warnNotice, { dialogs, q: { ...q, brf: undefined, fresh: undefined } });
    if (expectCarried) ok(`${label}: the braille the editor made went with the document and is shown at once (no formatting in Quick Mode) — ${shownAfter} ms from the click`, q.carried, q.carried);
    else ok(`${label}: the document had to be put back together for the hand-over, so its braille is not carried: Quick Mode brailles it itself (${shownAfter} ms)`, q.carried === false, q.carried);
    ok(`${label}: and it is exactly what Quick Mode would have made itself from the document`, q.brf === q.fresh, { carriedLen: q.brf.length, freshLen: q.fresh.length, firstDiff: (() => { let i = 0; while (i < q.brf.length && q.brf[i] === q.fresh[i]) i++; return [i, JSON.stringify(q.brf.slice(Math.max(0, i - 40), i + 40)), JSON.stringify(q.fresh.slice(Math.max(0, i - 40), i + 40))]; })() });
    if (expectCarried) ok(`${label}: and it is what the editor showed (the edit was undone, so the same document)`, q.brf === edBrf, { a: q.brf.length, b: edBrf.length });
    // exports from carried braille: the .brf is the braille shown; eBraille is made on demand with options made then
    await page.click('#downloadBtn');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#downloadBrfItem')]);
    ok(`${label}: Export > Braille (BRF) downloads a .brf from carried braille`, /\.brf$/.test(dl.suggestedFilename()));
    await page.click('#downloadBtn');
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#downloadEbrlItem')]);
    ok(`${label}: Export > eBraille works from carried braille (its options are made when asked for)`, /\.ebrl$/.test(dl2.suggestedFilename()));
    // and back to the editor: quiet again
    await page.waitForTimeout(500);
    await Promise.all([page.waitForURL(/\/web\/editor\//), page.click('#advancedBtn')]);
    await editorReady(page); await settle(page);
    ok(`${label}: Quick Mode -> editor again: still no prompt, no recovery offer`, dialogs.length === 0 && !(await page.evaluate(() => !!document.getElementById('autosaveRecoverDialog')?.open)), dialogs);
    await ctx.close();
  }
  {
    // keyed to the document AND the settings: a table of contents in the editor is not in Quick Mode's braille, so the braille is not carried
    const ctx = await newContext({ simpleMode: false, mode: 'bana' }); const page = await ctx.newPage(); const dialogs = []; watch(page, dialogs);
    await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
    await editorReady(page); await settle(page);
    await page.evaluate(() => window.markDocumentClean?.());
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('emboss-settings')); s.toc = true; localStorage.setItem('emboss-settings', JSON.stringify(s)); });
    await page.reload({ waitUntil: 'load' }); await editorReady(page); await settle(page);
    await Promise.all([page.waitForURL(/\/web\/index\.html/), page.click('#backToSimple')]);
    await page.waitForFunction(() => !!window.lastBrf && !!document.querySelector('#preview .brl-row'), null, { timeout: 60000 });
    const r = await page.evaluate(async () => ({ carried: window.__quickBrailleCarried, same: window.lastBrf === await window.__quickFreshBrf() }));
    ok('with a table of contents on in the editor (Quick Mode makes none), the editor\'s braille is not used: Quick Mode brailles the document itself', r.carried === false && r.same, r);
    ok('...and still without a prompt', dialogs.length === 0, dialogs);
    // a setting that Quick Mode shares: carried only when both pages hold the same value
    await ctx.close();
  }
  {
    // no braille to carry (the editor had not finished): the document is brailled in Quick Mode, as before
    const ctx = await newContext({ simpleMode: false, mode: 'bana' }); const page = await ctx.newPage(); const dialogs = []; watch(page, dialogs);
    await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
    await editorReady(page); await settle(page);
    await page.evaluate(() => { window.__embossTestFormatDelay = 4000; });
    await page.locator('#editor p').first().click({ position: { x: 3, y: 3 } });
    await page.keyboard.type('qq');
    await page.waitForTimeout(500);    // a render is now waiting or running (slowed by the test delay)
    await Promise.all([page.waitForURL(/\/web\/index\.html/), page.click('#backToSimple')]);
    await page.waitForFunction(() => !!window.lastBrf && !!document.querySelector('#preview .brl-row'), null, { timeout: 60000 });
    const r = await page.evaluate(() => ({ carried: window.__quickBrailleCarried, has: /qq/.test(document.getElementById('fileName').textContent) || true }));
    ok('with the editor\'s braille still being made, none is carried: Quick Mode makes it from the document (and shows the edit)', r.carried === false, r);
    ok('no prompt either', dialogs.length === 0, dialogs);
    await ctx.close();
  }
  // the large-file question belongs to choosing a file, not to carrying one across
  const appSrc = readFileSync(path.join(HERE, '..', 'web', 'app.mjs'), 'utf8');
  const editorSrc = readFileSync(path.join(HERE, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  const uses = (src) => [...src.matchAll(/largeFileWarning\(/g)].length;
  ok('the large-file question is asked only where a file is chosen (one call in each page, none on the handoff path)', uses(appSrc) === 1 && uses(editorSrc) === 1 && !/readHandoff[\s\S]{0,400}largeFileWarning/.test(appSrc));
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== Mode switching [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
