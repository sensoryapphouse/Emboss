// Emboss works with no network, as a deployed build (Paul, 10 Oct 2026: "Has this been properly tested offline before deploying?" —
// it had not: check-dist only reads the build to see that every file a page needs is in the service worker's cache list).
// This opens the BUILT app (dist/, served by its own serve.mjs), lets the service worker install and fill its cache, cuts the
// network, reloads, and then uses it: Quick Mode reads a document, brailles it and downloads a BRF and an eBraille file; the editor
// opens, brailles what is typed and downloads both. Any request that fails while offline is reported by URL.
//
// Usage: node Emboss/scripts/build-dist.mjs   then   (cd dist && NO_OPEN=1 node serve.mjs 8195 &)   then
//        node Emboss/tests/test-offline-dist.mjs 8195
// Run it on the build you are about to deploy. run-all-tests.mjs lists it as "browser (not run)" (it imports 'playwright').
// Chrome only: Playwright's WebKit cannot load any page while emulating offline, even one the service worker would answer
// ("WebKit encountered an internal error"), so Safari/iPad offline use has to be checked by hand on a real device.
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8195);
const BASE = `http://localhost:${PORT}`;
const SENTENCE = 'The teacher said the children could go out and play in the garden.';
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const SHOW = process.argv.includes('--show');   // a visible Chrome window, slowed down, with an OFFLINE label on the page, to watch it happen
const browser = await launchBrowser(SHOW ? { slowMo: 250 } : {});
const pause = (page, ms) => (SHOW ? page.waitForTimeout(ms) : Promise.resolve());
const label = (page, text) => (SHOW ? page.evaluate((t) => {
  let d = document.getElementById('__offlineLabel');
  if (!d) { d = document.createElement('div'); d.id = '__offlineLabel'; d.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#b00020;color:#fff;font:700 18px system-ui;padding:8px 18px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none'; document.body.appendChild(d); }
  d.textContent = t;
}, text).catch(() => {}) : Promise.resolve());

// A fresh profile; first visit online until the service worker controls the page and its cache is full.
async function primed(url, simpleMode) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 }, serviceWorkers: 'allow' });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', JSON.stringify(s)); } catch {} },
    { simpleMode, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // a request the PAGE could not get (the service worker's own network attempt, which fails offline before it answers from its cache, is not one)
  page.on('requestfailed', (r) => {
    try { if (r.serviceWorker && r.serviceWorker()) return; } catch {}
    try { if (!r.frame()) return; } catch { return; }                 // no page frame: the service worker's own request
    if (r.method() === 'HEAD') return;   // MathLive sends HEAD for its own script to find its fonts; a service worker cannot answer HEAD from its cache, and MathLive carries on (the font check below proves it)
    failed.push(r.url().replace(BASE, ''));
  });
  await page.goto(BASE + url, { waitUntil: 'load' });
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const t0 = Date.now();
    while (!navigator.serviceWorker.controller && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    const keys = await caches.keys();
    let n = 0; for (const k of keys) n += (await (await caches.open(k)).keys()).length;
    return { active: !!reg.active, controlled: !!navigator.serviceWorker.controller, caches: keys, entries: n };
  });
  return { ctx, page, errors, failed, sw };
}
async function download(page, item) {
  await page.click('#downloadBtn');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click(item)]);
  return dl.suggestedFilename();
}

try {
  // ---- Quick Mode ----
  console.log(`--- Quick Mode, built app at ${BASE}/index.html (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors, failed, sw } = await primed('/index.html', true);
    ok('Quick Mode: the service worker controls the page and has filled its cache', sw.controlled && sw.entries >= 50, sw);
    await ctx.setOffline(true);
    failed.length = 0;
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });   // a fresh load of the page (WebKit's test driver cannot reload offline)
    await page.waitForTimeout(2500);
    await label(page, 'OFFLINE — the network is cut: Quick Mode loaded from its offline copy');
    await pause(page, 2500);
    await page.setInputFiles('#fileInput', { name: 'offline.txt', mimeType: 'text/plain', buffer: Buffer.from(SENTENCE + '\n') });
    const ready = await page.waitForFunction(() => !document.getElementById('result').hidden && document.getElementById('preview').textContent.trim().length > 0, null, { timeout: 60000 }).then(() => true, () => false);
    ok('Quick Mode, offline: a document is read and brailled', ready);
    ok('Quick Mode, offline: Download BRF works', /\.brf$/i.test(await download(page, '#downloadBrfItem').catch((e) => String(e))));
    ok('Quick Mode, offline: Download eBraille works', /\.ebrl$/i.test(await download(page, '#downloadEbrlItem').catch((e) => String(e))));
    ok('Quick Mode, offline: no request failed', failed.length === 0, failed);
    ok('Quick Mode, offline: no page errors', errors.length === 0, errors);
    await label(page, 'OFFLINE — Quick Mode: document brailled, BRF and eBraille downloaded');
    await pause(page, 4000);
    await ctx.close();
  }
  // ---- the editor ----
  console.log(`--- the editor, built app at ${BASE}/editor/index.html (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors, failed, sw } = await primed('/editor/index.html', false);
    ok('editor: the service worker controls the page and has filled its cache', sw.controlled && sw.entries >= 50, sw);
    await ctx.setOffline(true);
    failed.length = 0;
    await page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} });
    await page.goto(BASE + '/editor/index.html', { waitUntil: 'load' });
    const up = await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 }).then(() => true, () => false);
    ok('editor, offline: it opens and brailles its first document', up);
    await label(page, 'OFFLINE — the network is cut: the editor loaded from its offline copy');
    await pause(page, 3000);
    const typed = await page.evaluate(async (text) => {
      window.markDocumentClean();
      const before = window.lastBrf;
      await window.importFile(new File([text + '\n'], 'offline.txt', { type: 'text/plain' }));
      const t0 = Date.now();
      while (window.lastBrf === before && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
      return window.lastBrf !== before && /G>D5/.test(window.lastBrf);
    }, SENTENCE).catch(() => false);
    ok('editor, offline: a document is opened and brailled', typed);
    ok('editor, offline: Download BRF works', /\.brf$/i.test(await download(page, '#downloadBrfItem').catch((e) => String(e))));
    ok('editor, offline: Download eBraille works', /\.ebrl$/i.test(await download(page, '#downloadEbrlItem').catch((e) => String(e))));
    const maths = await page.evaluate(async () => {
      await document.fonts.ready;
      return { mathField: !!customElements.get('math-field'), katex: [...document.fonts].filter((f) => /KaTeX/.test(f.family)).map((f) => f.status) };
    });
    ok('editor, offline: the maths editor is there and its fonts load (an equation is drawn in its own font)', maths.mathField && maths.katex.length > 0 && maths.katex.includes('loaded') && !maths.katex.includes('error'), maths);
    ok('editor, offline: no request failed', failed.length === 0, failed);
    ok('editor, offline: no page errors', errors.length === 0, errors);
    await label(page, 'OFFLINE — editor: document brailled, BRF and eBraille downloaded, maths fonts loaded');
    await pause(page, 4000);
    await page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} });
    await ctx.close();
  }
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }

await browser.close();
console.log(`\n=== Offline (built app) [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
