// 18 Oct 2026 (Paul: "Sometimes Emboss doesn't let me go back to Quick Mode and won't reload properly … intermittent"). Two causes, both
// reproduced here before the fix:
//  - a browser can leave an IndexedDB open unanswered (Safari does now and then; another tab can block it): the Quick Mode button waited on it
//    for ever (it did nothing), and the editor waited on it while loading (a reload never finished). handoff-db.mjs and autosave.mjs now give
//    up on an open after 4 s; the switch goes ahead (the document travels by the tab's own sessionStorage copy) and the editor loads;
//  - a slow but not dead network: the service worker fetched pages and scripts network-first with no limit, so a switch or a reload neither
//    came nor failed. After 3.5 s the build's stored copy answers.
// Chrome (the service worker and the network are controlled through Playwright).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-switch-resilience.mjs [port]
// (Emboss's own dev server: its service worker installs there.)
import { launchBrowser, ENGINE, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8258);
const B = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
// IndexedDB.open that never answers, switched on with window.__hangIdb (set before load with sessionStorage 'hang-idb')
// 'hang-idb-quick' = '1' holds it up on the Quick Mode page only. Patched on IDBFactory.prototype (4 Nov 2026): WebKit ignored the patch on the
// indexedDB object itself on some loads, so the earlier WebKit runs did not hold IndexedDB up at all.
const hangIdb = () => {
  const real = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...a) {
    let on = false;
    try { on = sessionStorage.getItem('hang-idb') === '1' || window.__hangIdb || (sessionStorage.getItem('hang-idb-quick') === '1' && /\/web\/index\.html$/.test(location.pathname)); } catch { /* */ }
    if (on) return { set onsuccess(f) {}, set onerror(f) {}, set onupgradeneeded(f) {}, set onblocked(f) {} };
    return real.apply(this, a);
  };
};
// "Ready" means the document itself is in the editor (its demo text, or a handed-over one) and the braille pane shows braille, not
// "Loading the braille engine…": that placeholder is non-blank text too, and a click on Quick Mode before the document has loaded
// hands over an EMPTY document (nothing to lose, so no id and no copy), which is not what this suite is about (4 Nov 2026).
const editorReady = (page, ms) => page.waitForFunction(() => /\S/.test(document.querySelector('#editor')?.innerText || '') && /[⠀-⣿]/.test(document.querySelector('.braille')?.textContent || ''), null, { timeout: ms }).then(() => true, () => false);
try {
  // ---- IndexedDB that never answers
  {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('rs')) { sessionStorage.setItem('rs', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false })); } } catch {} });
    await ctx.addInitScript(hangIdb);
    const page = await ctx.newPage();
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(B + '/web/editor/index.html');
    ok('the editor loads (IndexedDB working)', await editorReady(page, 30000));
    await page.evaluate(() => { window.__hangIdb = true; });
    const t0 = Date.now();
    await page.click('#backToSimple');
    const left = await page.waitForURL(/\/web\/index\.html/, { timeout: 15000 }).then(() => true, () => false);
    ok('IndexedDB not answering: the Quick Mode button still goes to Quick Mode (within 8 s)', left && Date.now() - t0 < 8000, { left, ms: Date.now() - t0, url: page.url() });
    const arrived = await page.waitForFunction(() => /\S/.test(document.getElementById('fileName')?.textContent || '') && /ready below/i.test(document.body.innerText), null, { timeout: 60000 }).then(() => true, () => false);
    ok('… and the document arrives there, brailled (the tab\'s own copy)', arrived, await page.evaluate(() => document.getElementById('status')?.textContent));
    // a reload of the editor while IndexedDB does not answer
    await page.evaluate(() => { sessionStorage.setItem('hang-idb', '1'); });
    const t1 = Date.now();
    await page.goto(B + '/web/editor/index.html');
    ok('IndexedDB not answering: the editor still finishes loading (a reload is not stuck)', await editorReady(page, 30000), { ms: Date.now() - t1 });
    ok('no "could not take your document" question for a document with nothing unsaved', !dialogs.some((m) => /couldn.t take your document/i.test(m)), dialogs);
    await ctx.close();
  }
  // ---- IndexedDB answering for the editor but not, a moment later, for Quick Mode (Safari's now-and-then, 18 Oct 2026): the document was kept only in
  // IndexedDB, so Quick Mode found nothing (4 Nov 2026: found in WebKit). The tab's own copy is kept too, until the destination has loaded it.
  {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('rs')) { sessionStorage.setItem('rs', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false })); } } catch {} });
    await ctx.addInitScript(hangIdb);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(B + '/web/editor/index.html');
    ok('the editor loads', await editorReady(page, 30000));
    await page.evaluate(() => sessionStorage.setItem('hang-idb-quick', '1'));
    await page.click('#backToSimple');
    await page.waitForURL(/\/web\/index\.html/, { timeout: 15000 });
    const arrived = await page.waitForFunction(() => /\S/.test(document.getElementById('fileName')?.textContent || '') && /ready below/i.test(document.body.innerText), null, { timeout: 60000 }).then(() => true, () => false);
    ok('IndexedDB not answering in Quick Mode only: the document still arrives (the tab\'s own copy)', arrived);
    ok('… and the copy is gone once Quick Mode has it', await page.evaluate(() => !Object.keys(sessionStorage).some((k) => k.startsWith('emboss-editor-doc:'))));
    await ctx.close();
  }
  // ---- Quick Mode pressed while the editor is still loading its document (Paul, 4 Nov 2026, answer B): the button waits for the load, so the
  // document goes back to Quick Mode - before, an empty editor was handed over and the document did not come back. The load is held up by an
  // IndexedDB that does not answer (the editor reads the hand-over from it and gives up after 4 s, then uses the tab's own copy).
  {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('rs')) { sessionStorage.setItem('rs', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false })); } } catch {} });
    await ctx.addInitScript(hangIdb);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(B + '/web/editor/index.html');
    ok('the editor loads', await editorReady(page, 30000));
    await page.click('#backToSimple');
    await page.waitForURL(/\/web\/index\.html/, { timeout: 15000 });
    const inQuick = await page.waitForFunction(() => /\S/.test(document.getElementById('fileName')?.textContent || '') && /ready below/i.test(document.body.innerText), null, { timeout: 60000 }).then(() => true, () => false);
    ok('the document is in Quick Mode', inQuick);
    await page.evaluate(() => sessionStorage.setItem('hang-idb', '1'));
    await page.click('#advancedBtn');
    await page.waitForURL(/\/web\/editor\//, { timeout: 15000 });
    const midLoad = await page.waitForFunction(() => window.__quickButtonWired === true && window.__editorStartupLoaded !== true, null, { timeout: 15000, polling: 20 }).then(() => true, () => false);
    ok('the editor is still loading the document when Quick Mode is pressed', midLoad);
    // pressed and read in one step (the button's first, synchronous part sets the status), so the load cannot finish in between
    const press = await page.evaluate(() => { const loading = window.__editorStartupLoaded !== true; document.getElementById('backToSimple').click(); return { loading, said: document.getElementById('docStats')?.textContent || '' }; });   // the editor's status text shows in the status bar's docStats
    const back = await page.waitForURL(/\/web\/index\.html/, { timeout: 20000 }).then(() => true, () => false);
    const arrived = back && await page.waitForFunction(() => /\S/.test(document.getElementById('fileName')?.textContent || '') && /ready below/i.test(document.body.innerText), null, { timeout: 60000 }).then(() => true, () => false);
    ok('Quick Mode pressed during the load waits, then the document comes back to Quick Mode', back && arrived, { back, arrived, url: page.url() });
    ok('… and the status line said it was waiting for the document', press.loading && /as soon as the document has loaded/i.test(press.said), press);
    await ctx.close();
  }
  // ---- a slow network, with the service worker in charge: Chrome only. Playwright can slow the requests a service worker makes only in Chromium;
  // in WebKit and Firefox its route holds back the browser's own page request, which no page could get round (4 Nov 2026). Safari: by hand.
  if (ENGINE !== 'chrome') console.log(`  - skip  the slow-network checks (Chrome only: Playwright cannot slow a service worker's requests in ${ENGINE_LABEL})`);
  else {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, serviceWorkers: 'allow' });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('rs')) { sessionStorage.setItem('rs', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false })); } } catch {} });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(B + '/web/index.html');
    const controlled = await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 90000 }).then(() => true, () => false);
    ok('the service worker is in charge (its first-visit download done)', controlled);
    await page.waitForTimeout(5000);
    await page.goto(B + '/web/editor/index.html');
    ok('the editor loads', await editorReady(page, 30000));
    await ctx.route(/\/web\/(index\.html|app\.mjs|style\.css|editor\/index\.html|editor\/editor\.mjs)(\?|$)/, async (route) => { await new Promise((r) => setTimeout(r, 40000)); route.continue().catch(() => {}); });
    let t0 = Date.now();
    await page.click('#backToSimple');
    const quick = await page.waitForFunction(() => location.pathname.endsWith('/web/index.html') && !!document.getElementById('dropzone') && document.readyState === 'complete', null, { timeout: 20000 }).then(() => true, () => false);
    ok('a network taking 40 s: the switch to Quick Mode still happens (within 15 s)', quick && Date.now() - t0 < 15000, { quick, ms: Date.now() - t0 });
    t0 = Date.now();
    await page.reload({ waitUntil: 'load', timeout: 20000 }).catch(() => {});
    const reloaded = await page.waitForFunction(() => !!document.getElementById('dropzone') && document.readyState === 'complete', null, { timeout: 15000 }).then(() => true, () => false);
    ok('… and a reload of Quick Mode completes (within 15 s)', reloaded && Date.now() - t0 < 15000, { reloaded, ms: Date.now() - t0 });
    await ctx.close();
  }
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }
await browser.close();
console.log(`\n=== Switching and reloading when IndexedDB or the network is slow [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
