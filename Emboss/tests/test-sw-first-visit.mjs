// A89 step 1, found running every browser suite in WebKit: on a FIRST visit, "A new version of Emboss is available" appeared
// (about 3 loads in 8 in WebKit), over the bottom of the page. The check was "a new service worker installed while one controls
// the page" — but Emboss's own service worker takes control as soon as it installs (clients.claim()), and in WebKit that can
// happen before the check runs, so a first install looked like an update. Now a page that was not controlled when it loaded
// never offers an update: there is nothing older to update from.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-sw-first-visit.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const VISITS = 8;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  try {
    for (const [pageName, simple, url] of [['editor', false, '/web/editor/index.html'], ['Quick Mode', true, '/web/index.html']]) {
      let shown = 0;
      for (let i = 0; i < VISITS; i++) {
        const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });   // a fresh profile: a first visit
        await ctx.addInitScript((simple) => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: simple, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} }, simple);
        const page = await ctx.newPage();
        await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'load' });
        await page.waitForTimeout(2500);
        if (await page.evaluate(() => { const t = document.getElementById('swUpdateToast'); return !!t && t.textContent.trim().length > 0 && t.offsetParent !== null; })) shown++;
        await ctx.close();
      }
      ok(`${engine} ${pageName}: no "new version" message on ${VISITS} first visits`, shown === 0, { shown });
    }
  } finally {
    await browser.close();
  }
}
console.log(`\n=== First visit, no update message [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
