// A89 / A90 (Paul, 2 Oct: a precaution against a very large book crashing the browser tab): opening a file above the large-file
// limit (20 MB of text; 100 MB packaged — settings.mjs largeFileWarning) asks first, in Quick Mode and in the editor; Cancel leaves
// everything as it was, OK opens it. A 21 MB plain-text book is used (it opens in a few seconds), so the test is quick.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-large-file-warning.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BIG = Buffer.from(('A sentence of a very long book, one of many.\n').repeat(Math.ceil(21 * 1024 * 1024 / 45)).slice(0, 21 * 1024 * 1024 + 10));
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
    // ---- Quick Mode
    let ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
    let page = await ctx.newPage();
    const asked = [];
    let answer = false;
    page.on('dialog', (d) => { asked.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
    await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await page.setInputFiles('#fileInput', { name: 'huge-book.txt', mimeType: 'text/plain', buffer: BIG });
    await page.waitForTimeout(1500);
    ok(`${engine} Quick Mode: a 21 MB book asks first`, asked.some((m) => /very large/i.test(m) && /21 MB/.test(m)), asked);
    ok(`${engine} Quick Mode: Cancel leaves it unopened`, await page.evaluate(() => document.getElementById('result').hidden), null);
    answer = true; asked.length = 0;
    await page.setInputFiles('#fileInput', []);
    await page.setInputFiles('#fileInput', { name: 'huge-book.txt', mimeType: 'text/plain', buffer: BIG });
    await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 120000 }).catch(() => {});
    ok(`${engine} Quick Mode: OK opens it`, await page.evaluate(() => !document.getElementById('result').hidden));
    await ctx.close();

    // ---- the editor (its own file input and drag-and-drop both go through importFile)
    ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
    page = await ctx.newPage();
    const asked2 = [];
    page.on('dialog', (d) => { asked2.push(d.message()); d.dismiss(); });
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => document.getElementById('editor').textContent.slice(0, 80));
    await page.setInputFiles('#loadFileInput', { name: 'huge-book.txt', mimeType: 'text/plain', buffer: BIG });
    await page.waitForTimeout(1500);
    ok(`${engine} editor: a 21 MB book asks first`, asked2.some((m) => /very large/i.test(m)), asked2);
    ok(`${engine} editor: Cancel leaves the document as it was`, (await page.evaluate(() => document.getElementById('editor').textContent.slice(0, 80))) === before);
    await ctx.close();
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Large file warning [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
