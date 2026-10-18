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
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

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
const hangIdb = () => {
  const real = indexedDB.open.bind(indexedDB);
  indexedDB.open = function (...a) {
    let on = false; try { on = sessionStorage.getItem('hang-idb') === '1' || window.__hangIdb; } catch { /* */ }
    if (on) return { set onsuccess(f) {}, set onerror(f) {}, set onupgradeneeded(f) {}, set onblocked(f) {} };
    return real(...a);
  };
};
const editorReady = (page, ms) => page.waitForFunction(() => /\S/.test(document.querySelector('.braille')?.textContent || '') && !!document.querySelector('#editor [data-lexical-editor], #editor'), null, { timeout: ms }).then(() => true, () => false);
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
  // ---- a slow network, with the service worker in charge
  {
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
