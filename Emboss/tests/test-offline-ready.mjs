// S4-Q2 (Paul, 17 Oct 2026): Emboss tells the user when it can work offline — once, in the status line, on the first visit in this browser;
// and Help shows "Ready to work offline" (or "Still getting ready to work offline…") beside the version. No pop-up, no badge.
// Quick Mode and the editor, each in a fresh browser profile (a first visit), then a reload (not a first visit: nothing said again).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-offline-ready.mjs [port]
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const B = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const READY = 'Emboss is ready to work offline.';
const browser = await launchBrowser();
try {
  for (const [label, url, prep] of [
    ['Quick Mode', '/web/index.html', { simpleMode: true }],
    ['the editor', '/web/editor/index.html', { simpleMode: false }],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    await ctx.addInitScript((p) => { try { if (!sessionStorage.getItem('or')) { sessionStorage.setItem('or', '1'); localStorage.setItem('emboss-settings', JSON.stringify(p)); } } catch {} }, prep);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(B + url, { waitUntil: 'load' });
    const said = await page.waitForFunction((r) => ((document.getElementById('status') || document.getElementById('docStats'))?.textContent || '').includes(r), READY, { timeout: 90000 }).then(() => true, () => false);
    ok(`${label}, first visit: the status line says "${READY}"`, said, await page.evaluate(() => (document.getElementById('status') || document.getElementById('docStats'))?.textContent));
    ok(`${label}: Help shows "Ready to work offline" beside the version`, (await page.evaluate(() => document.getElementById('offlineState')?.textContent)) === 'Ready to work offline');
    await page.evaluate(() => window.markDocumentClean?.());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => (document.getElementById('status') || document.getElementById('docStats'))?.textContent || '');   // the editor's status line is #docStats
    ok(`${label}, next visit: it is not said again`, !st.includes(READY), st);
    ok(`${label}, next visit: Help still shows "Ready to work offline"`, (await page.evaluate(() => document.getElementById('offlineState')?.textContent)) === 'Ready to work offline');
    await ctx.close();
  }
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }
await browser.close();
console.log(`\n=== Offline ready [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
