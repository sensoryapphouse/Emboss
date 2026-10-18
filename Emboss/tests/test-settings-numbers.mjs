// A89 step 3, found by random-action testing (all three browsers): Settings is a form, and its Close and Done buttons submitted
// it. With a number out of range (Cells -1, Lines 99999) the browser refused — "An invalid form control … is not focusable" when
// the field was on another tab — and Settings would not close. And Quick Mode read the field as typed, so -1 cells could reach the
// braille. Now Close and Done always close (formnovalidate), and a number field takes the nearest allowed value as soon as it
// is changed (Cells -1 → 10, 99999 → 60).
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs). Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-settings-numbers.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const launch = () => launchBrowser({}, key);
  const browser = await launch();
  for (const [pageName, simple, cellsId, url] of [['Quick Mode', true, 'set-cells', '/web/index.html'], ['editor', false, 'set-cells', '/web/editor/index.html']]) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.addInitScript((simple) => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: simple, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} }, simple);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && /invalid form control/i.test(m.text())) errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('dialog', (d) => d.accept());
    const open = async () => { await page.click('#settingsBtn'); await page.waitForSelector('#settingsDialog[open]', { timeout: 5000 }); };
    const isOpen = () => page.evaluate(() => document.getElementById('settingsDialog').open);
    try {
      await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      // a typed value out of range is brought within range
      await open();
      await page.evaluate((id) => { const el = document.getElementById(id); el.closest('.settings-panel')?.classList.add('active'); }, cellsId);
      for (const [typed, want] of [['-1', '10'], ['99999', '60']]) {
        await page.evaluate(({ id, v }) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, { id: cellsId, v: typed });
        await page.waitForTimeout(200);
        const v = await page.evaluate((id) => document.getElementById(id).value, cellsId);
        ok(`${engine} ${pageName}: Cells ${typed} becomes ${want}`, v === want, v);
      }
      // an invalid value the field still holds (no change event), on a tab not showing: Close still closes
      await page.evaluate((id) => { document.getElementById(id).value = '-5'; document.querySelectorAll('#settingsDialog .settings-panel').forEach((p) => p.classList.remove('active')); }, cellsId);
      await page.click('#settingsDialog .dialog-head button');
      await page.waitForTimeout(300);
      ok(`${engine} ${pageName}: Close closes Settings even with a number out of range`, !(await isOpen()));
      await open();
      await page.evaluate((id) => { document.getElementById(id).value = '-5'; }, cellsId);
      await page.click('#settingsDialog .dialog-foot button');
      await page.waitForTimeout(300);
      ok(`${engine} ${pageName}: Done closes Settings even with a number out of range`, !(await isOpen()));
      ok(`${engine} ${pageName}: no "invalid form control" error`, errors.length === 0, errors);
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
}
console.log(`\n=== Settings numbers [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
