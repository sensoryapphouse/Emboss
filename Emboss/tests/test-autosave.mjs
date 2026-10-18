// Autosave & crash recovery (Fable review #7, Emboss/docs/fable-review-26sep.md): the editor
// previously had only a beforeunload guard (editor.mjs ~10451, unmoved by this feature) — no
// help at all against a crash, a killed tab, or an accidental "Leave". Emboss/web/editor/
// autosave.mjs now snapshots the document (the NIMAS XML window.exportCurrentDocumentXml()
// itself produces, plus loaded image resources, title and package/xml metadata) to IndexedDB
// every ~30s and on hide/pagehide while it is dirty, and offers "Recover unsaved work from
// <time>?" on the next load when a snapshot survived (i.e. the previous session ended dirty).
//
// Tests here use window.__forceAutosaveTick() (autosave.mjs's forceAutosaveTick, exposed for
// exactly this) instead of waiting out the real 30s interval — everything else is the real
// production path: real typing, a real page reload, the real recovery dialog and its real
// Recover/Discard buttons, a real Save click, a real NIMAS package import for the images case.
//
// Needs the dev server:  node Emboss/scripts/serve.mjs 8237 &
//   node Emboss/tests/test-autosave.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { makeZip } from '../web/zip.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

const SETTINGS_JSON = JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
const isMac = process.platform === 'darwin';
const END_OF_DOC = isMac ? 'Meta+End' : 'Control+End';

const browser = await launchBrowser({ args: ['--no-sandbox'] });

// A fresh, isolated browser context per scenario: IndexedDB and localStorage persist across a
// page reload *within* a context (the crash/reopen case this feature is for) but never leak
// between contexts, so each test starts with no stored autosave snapshot of its own.
async function freshContext() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await ctx.addInitScript((json) => { try { localStorage.setItem('emboss-settings', json); } catch {} }, SETTINGS_JSON);
  return ctx;
}

async function openEditor(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.__forceAutosaveTick === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  return { page, errors };
}

// Reloads the page and waits for either the recovery dialog (a stored snapshot survived) or a
// normal ready editor (nothing to recover) — whichever happens. `sawDialog` tells the caller
// which branch actually happened, since a reload's timing (dialog vs. straight to ready) is
// exactly what several tests below are checking.
async function reloadAndSettle(page, { timeout = 30000 } = {}) {
  await page.reload({ waitUntil: 'load' });
  const outcome = await Promise.race([
    page.waitForSelector('#autosaveRecoverDialog', { state: 'attached', timeout }).then(() => 'dialog').catch(() => null),
    page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout }).then(() => 'ready').catch(() => null),
  ]);
  if (outcome === 'dialog') return { sawDialog: true };
  // No dialog: make sure the ordinary ready state was in fact reached (not just a timeout race).
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout });
  return { sawDialog: false };
}

async function typeUniqueParagraph(page, text) {
  const prevBrfLen = (await page.evaluate(() => window.lastBrf || '')).length;
  await page.click('#editor');
  await page.keyboard.press(END_OF_DOC);
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  // render() is debounced ~100ms after the last edit (editor.mjs's scheduleRender): wait for the
  // braille to actually reflect the new text before anything reads window.lastBrf, so a snapshot
  // taken right after typing isn't a stale pre-edit render.
  await page.waitForFunction((prevLen) => (window.lastBrf || '').length !== prevLen, prevBrfLen, { timeout: 10000 });
}

// ==================================================================================
// 1. Edit -> wait -> reload -> Recover restores the text and the braille
// ==================================================================================
console.log('--- Recover: restores text and braille ---');
{
  const ctx = await freshContext();
  const { page, errors } = await openEditor(ctx);
  const marker = 'Autosave recovery test paragraph, one two three.';

  await typeUniqueParagraph(page, marker);
  const dirtyBefore = await page.evaluate(() => window.isDocumentDirty());
  ok('typing marks the document dirty', dirtyBefore === true, dirtyBefore);

  await page.evaluate(() => window.__forceAutosaveTick());
  const beforeBrf = await page.evaluate(() => window.lastBrf);
  const beforeXml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('setup: the typed paragraph is in the pre-reload document', beforeXml.includes(marker), beforeXml.slice(0, 200));

  const { sawDialog } = await reloadAndSettle(page);
  ok('a snapshot from a dirty document offers recovery on reload', sawDialog === true);

  const dlgInfo = await page.evaluate(() => {
    const dlg = document.getElementById('autosaveRecoverDialog');
    const title = document.getElementById('autosaveRecoverTitle');
    const hint = document.getElementById('autosaveRecoverHint');
    return {
      isOpen: !!dlg && dlg.open,
      role: dlg && dlg.getAttribute('role'),
      labelledby: dlg && dlg.getAttribute('aria-labelledby'),
      describedby: dlg && dlg.getAttribute('aria-describedby'),
      hasTitle: !!title && title.textContent.length > 0,
      hasHint: !!hint && hint.textContent.length > 0,
      recoverBtn: !!document.getElementById('autosaveRecoverBtn'),
      discardBtn: !!document.getElementById('autosaveDiscardBtn'),
      focused: document.activeElement && document.activeElement.id,
    };
  });
  ok('recovery dialog is a real, open <dialog>', dlgInfo.isOpen === true, dlgInfo);
  ok('recovery dialog is an alertdialog wired to its heading and hint (screen-reader accessible)',
    dlgInfo.role === 'alertdialog' && dlgInfo.labelledby === 'autosaveRecoverTitle' && dlgInfo.describedby === 'autosaveRecoverHint' && dlgInfo.hasTitle && dlgInfo.hasHint, dlgInfo);
  ok('recovery dialog offers both Recover and Discard', dlgInfo.recoverBtn && dlgInfo.discardBtn, dlgInfo);
  ok('recovery dialog starts focus on the primary (Recover) button (keyboard-friendly)', dlgInfo.focused === 'autosaveRecoverBtn', dlgInfo);

  await page.click('#autosaveRecoverBtn');
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 20000 });
  const afterXml = await page.evaluate(() => window.exportCurrentDocumentXml());
  const afterBrf = await page.evaluate(() => window.lastBrf);
  const dialogGone = await page.evaluate(() => !document.getElementById('autosaveRecoverDialog'));

  ok('Recover restores the typed text', afterXml.includes(marker), afterXml.slice(0, 200));
  ok('Recover restores the same braille as before the reload', afterBrf === beforeBrf, { beforeLen: beforeBrf.length, afterLen: afterBrf.length });
  ok('the recovery dialog is removed from the DOM after a choice', dialogGone);
  const dirtyAfterRecover = await page.evaluate(() => window.isDocumentDirty());
  ok('a recovered document counts as unsaved (the close guard still asks)', dirtyAfterRecover === true, dirtyAfterRecover);
  ok('no console/page errors', !errors.length, errors);

  await ctx.close();
}

// ==================================================================================
// 2. Discard removes the snapshot
// ==================================================================================
console.log('--- Discard: removes the snapshot ---');
{
  const ctx = await freshContext();
  const { page, errors } = await openEditor(ctx);
  const marker = 'Discard test content should vanish.';

  await typeUniqueParagraph(page, marker);
  await page.evaluate(() => window.__forceAutosaveTick());

  const first = await reloadAndSettle(page);
  ok('setup: a dialog is offered before Discard', first.sawDialog === true);
  await page.click('#autosaveDiscardBtn');
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 20000 });
  const afterDiscardXml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('Discard does not restore the typed text', !afterDiscardXml.includes(marker), afterDiscardXml.slice(0, 200));

  // The snapshot is gone: reloading again offers nothing.
  const second = await reloadAndSettle(page);
  ok('after Discard, a further reload offers no recovery prompt', second.sawDialog === false);
  ok('no console/page errors', !errors.length, errors);

  await ctx.close();
}

// ==================================================================================
// 3. An explicit Save clears the snapshot
// ==================================================================================
console.log('--- Save: clears the snapshot ---');
{
  const ctx = await freshContext();
  const { page, errors } = await openEditor(ctx);
  const marker = 'Save clears the autosave backup test.';

  await typeUniqueParagraph(page, marker);
  await page.evaluate(() => window.__forceAutosaveTick());

  await page.click('#saveDocBtn');
  await page.waitForTimeout(200);   // saveBlob()'s synthetic <a>.click() + markDocumentClean() + clearAutosaveSnapshot()
  const dirtyAfterSave = await page.evaluate(() => window.isDocumentDirty());
  ok('Save marks the document clean', dirtyAfterSave === false, dirtyAfterSave);

  const { sawDialog } = await reloadAndSettle(page);
  ok('after an explicit Save, reloading offers no recovery prompt', sawDialog === false);
  ok('no console/page errors', !errors.length, errors);

  await ctx.close();
}

// ==================================================================================
// 4. No prompt when nothing is unsaved
// ==================================================================================
console.log('--- No prompt when nothing unsaved ---');
{
  const ctx = await freshContext();
  const { page, errors } = await openEditor(ctx);
  // No edits at all — a brand-new session, nothing dirty, nothing autosaved.
  await page.evaluate(() => window.__forceAutosaveTick());   // must be a no-op: isDirty() is false
  const { sawDialog } = await reloadAndSettle(page);
  ok('an untouched document never shows the recovery prompt', sawDialog === false);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 5. A document with images restores them
// ==================================================================================
console.log('--- Recover: a document with images restores them ---');
{
  // A minimal NIMAS package (OEB-style OPF + DTBook + one real image), built the same way
  // Emboss/tests/nimas_package_import.test.mjs builds its fixtures, so importFile's normal
  // package path populates model.resources exactly as a real NIMAS package would.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const opf = `<?xml version="1.0"?>
<package xmlns="http://openebook.org/namespaces/oeb-package/1.0/" unique-identifier="uid">
  <metadata><dc-metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:Title>Autosave Image Doc</dc:Title></dc-metadata></metadata>
  <manifest>
    <item id="book1" href="doc/book.xml" media-type="application/x-dtbook+xml"/>
    <item id="img1" href="doc/images/a.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="book1"/></spine>
</package>`;
  const dtbook = `<?xml version="1.0"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3">
  <head><meta name="dc:Title" content="Autosave Image Doc"/></head>
  <book><bodymatter><level1>
    <h1>Autosave Image Test</h1>
    <p>Paragraph before the image.</p>
    <img src="./images/a.png" alt="A test image"/>
  </level1></bodymatter></book>
</dtbook>`;
  const zipBlob = await makeZip([
    { name: 'pkg/content.opf', text: opf },
    { name: 'pkg/doc/book.xml', text: dtbook },
    { name: 'pkg/doc/images/a.png', data: png },
  ]);
  const zipB64 = Buffer.from(await zipBlob.arrayBuffer()).toString('base64');

  const ctx = await freshContext();
  const { page, errors } = await openEditor(ctx);

  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.markDocumentClean();
    await window.importFile(new File([bytes], 'autosave-image-test.zip', { type: 'application/zip' }));
  }, zipB64);
  await page.waitForFunction(() => (window.lastModel?.blocks || []).some((b) => /Autosave Image Test/.test(b.text || '')), null, { timeout: 20000 });
  const importedImgSrc = await page.evaluate(() => document.querySelector('.doc-image-block img')?.src || '');
  ok('setup: the package image renders in the editor before any edit', importedImgSrc.startsWith('blob:'), importedImgSrc);

  // Edit, so the document is dirty and due an autosave.
  await typeUniqueParagraph(page, 'Edited after loading the image package.');
  await page.evaluate(() => window.__forceAutosaveTick());

  const { sawDialog } = await reloadAndSettle(page);
  ok('a dirty document with images offers recovery', sawDialog === true);
  await page.click('#autosaveRecoverBtn');
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 20000 });

  const after = await page.evaluate(() => ({
    imgSrc: document.querySelector('.doc-image-block img')?.src || '',
    resources: (window.lastModel?.resources || []).map((r) => ({ path: r.path, mime: r.mime, len: r.bytes ? r.bytes.length : 0 })),
    xml: window.exportCurrentDocumentXml(),
  }));
  ok('recovered document still shows the image (a resolved blob: URL, not a broken/removed <img>)', after.imgSrc.startsWith('blob:'), after.imgSrc);
  ok('recovered document keeps the image as a model resource', after.resources.length === 1 && after.resources[0].path === 'images/a.png' && after.resources[0].mime === 'image/png' && after.resources[0].len === png.length, after.resources);
  ok('recovered document keeps the edit made after loading the package', after.xml.includes('Edited after loading the image package.'), after.xml.slice(0, 300));
  ok('no console/page errors', !errors.length, errors);

  await ctx.close();
}

// ==================================================================================
// 6. Timing on a large (1.4MB) document — must not slow typing: the export runs off the
//    keystroke path (the 30s timer / hide / pagehide only), so this measures forceAutosaveTick
//    itself, not a keystroke.
// ==================================================================================
console.log('--- Timing: large NIMAS document ---');
{
  const largeNimasPath = path.join(here, 'nimas_samples', '9780544087507NIMAS.xml');
  const sizeBytes = readFileSync(largeNimasPath).length;

  const ctx = await freshContext();
  const { page, errors } = await openEditor(ctx);

  const importMs = await page.evaluate(async () => {
    const res = await fetch('/web/large-nimas.xml');
    const text = await res.text();
    window.markDocumentClean();
    const t0 = performance.now();
    await window.importFile(new File([text], 'large-nimas.xml', { type: 'text/xml' }));
    return performance.now() - t0;
  });
  await page.waitForFunction(() => (window.lastModel?.blocks || []).length > 0, null, { timeout: 90000 });

  // One small edit — the only thing that must stay fast; autosave itself never runs from this.
  // A real click (not a bare .focus()) is needed so Lexical actually has a selection to type
  // into — the same reason typeUniqueParagraph() above uses page.click('#editor').
  // A paragraph of text, not the middle of the editor: since 1 Oct 2026 the middle can be a picture's description box (feedback
  // item 8), where the keystroke rightly edits the description instead of the text.
  await page.click('#editor p.ed-p >> nth=0');
  const keystrokeStart = Date.now();
  await page.keyboard.press(END_OF_DOC);
  await page.keyboard.type('X');
  const keystrokeMs = Date.now() - keystrokeStart;
  const dirtyAfterKeystroke = await page.evaluate(() => window.isDocumentDirty());
  ok('the large-document keystroke actually registers as a dirty edit (so the tick below does real work)', dirtyAfterKeystroke === true, dirtyAfterKeystroke);

  const tickMs = await page.evaluate(async () => {
    const t0 = performance.now();
    await window.__forceAutosaveTick();
    return performance.now() - t0;
  });
  const exportOnlyMs = await page.evaluate(() => {
    const t0 = performance.now();
    window.exportCurrentDocumentXml();
    return performance.now() - t0;
  });

  console.log(`  … 1.4MB NIMAS file: ${(sizeBytes / 1024).toFixed(0)} KB on disk`);
  console.log(`  … importFile (parse + build + first render): ${importMs.toFixed(0)} ms`);
  console.log(`  … one keystroke at end of a ${(sizeBytes / 1024).toFixed(0)}KB document, wall-clock (includes IPC): ${keystrokeMs} ms`);
  console.log(`  … forceAutosaveTick (buildModel + exportToNimasXml + IndexedDB write): ${tickMs.toFixed(0)} ms`);
  console.log(`  … exportCurrentDocumentXml alone (buildModel + exportToNimasXml, no IndexedDB): ${exportOnlyMs.toFixed(0)} ms`);

  ok('a single keystroke stays fast on the large document (autosave never runs on the keystroke path)', keystrokeMs < 2000, keystrokeMs);
  ok('an autosave tick on the large document completes well under the 30s interval', tickMs < 10000, tickMs);
  ok('no console/page errors', !errors.length, errors);

  await ctx.close();
}

await browser.close();
console.log(`\n=== autosave [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All autosave checks passed.');
}
