// A89 (the nightly random-action run, seed 1763563818, Chrome): after "Recover unsaved work?" was answered, the dialog went and the
// keyboard was left on the page itself — the next Tab reached the toolbar's first button (Quick Mode) and a typed space pressed it.
// Now, after Recover or Discard, the caret is in the document (at its start), so typing goes into the text.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-recover-focus.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports './lib/launch-browser.mjs').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  for (const answer of ['autosaveRecoverBtn', 'autosaveDiscardBtn']) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    try {
      await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      await page.click('#editor p >> nth=0');
      await page.keyboard.press('End');
      await page.keyboard.type(' unsaved words');
      await page.waitForTimeout(4000);                                   // the backup is written ~2 s after typing pauses
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector(`#${answer}`, { state: 'visible', timeout: 30000 });
      await page.click(`#${answer}`);
      await page.waitForFunction(() => typeof window.importFile === 'function' && window.lastBrf, null, { timeout: 60000 });
      await page.waitForTimeout(800);
      const where = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
      ok(`${engine} (${answer === 'autosaveRecoverBtn' ? 'Recover' : 'Discard'}): the keyboard is back in the document`, where === 'editor', where);
      await page.keyboard.type('Q');
      await page.waitForTimeout(300);
      ok(`${engine} (${answer === 'autosaveRecoverBtn' ? 'Recover' : 'Discard'}): …and typing goes into the text`, await page.evaluate(() => document.getElementById('editor').textContent.includes('Q')) && /editor/.test(page.url()));
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
}
console.log(`\n=== Focus after the recovery question [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
