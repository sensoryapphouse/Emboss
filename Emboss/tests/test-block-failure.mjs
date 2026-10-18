// A89 step 3 (robustness programme; Paul, 2 Oct): one paragraph Emboss cannot braille must not take the whole braille pane with
// it. Before, any error while brailling replaced the entire braille with "Braille could not be generated". Now the paragraphs
// that fail on their own are marked "[Emboss could not braille this paragraph]" in the braille, everything else is brailled,
// the status says so, and editing the paragraph so it brailles again brings the braille back. The failure is made on purpose
// with the editor's test hook window.__embossTestBreakBlock.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-block-failure.mjs [port]
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', ascii: true })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  const state = () => page.evaluate(() => ({ brf: window.lastBrf || '', second: window.lastModel?.blocks?.[1]?.text || '', braille: document.getElementById('braille').textContent, status: `${document.getElementById('docStats')?.textContent || ''} ${document.getElementById('announce')?.textContent || ''}` }));
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      window.markDocumentClean();
      window.modelToLexical({ blocks: [{ type: 'para', text: 'First paragraph about cats.' }, { type: 'para', text: 'Second paragraph BREAK ME here.' }, { type: 'para', text: 'Third paragraph about dogs.' }] });
      window.__embossTestBreakBlock = (b) => JSON.stringify(b).includes('BREAK ME');
      await window.render();
    });
    await page.waitForTimeout(500);
    let s = await state();
    ok(`${engine}: the other paragraphs are still brailled`, /CATS/i.test(s.brf) && /DOGS/i.test(s.brf), s.brf.slice(0, 300));
    ok(`${engine}: the failing paragraph is marked in the braille`, /could not braille this paragraph/.test(s.second) && s.brf.split('\n').filter((l) => l.trim()).length >= 3, { second: s.second, brf: s.brf.slice(0, 300) });
    ok(`${engine}: the braille pane does not say the whole document failed`, !/could not be generated/i.test(s.braille), s.braille.slice(0, 200));
    ok(`${engine}: the status says a paragraph could not be brailled`, /could not braille 1 paragraph/i.test(s.status), s.status);
    // edit the paragraph so it brailles again
    await page.evaluate(async () => { window.__embossTestBreakBlock = null; await window.render(); });
    await page.waitForTimeout(500);
    s = await state();
    ok(`${engine}: once the paragraph can be brailled, it is brailled again`, /BREAK ME/.test(s.second), s.second);
    // every paragraph failing: the old message, nothing hidden
    await page.evaluate(async () => { window.__embossTestBreakBlock = () => true; await window.render(); });
    await page.waitForTimeout(500);
    s = await state();
    ok(`${engine}: when nothing at all can be brailled, the pane says so as before`, /could not be generated/i.test(s.braille), s.braille.slice(0, 200));
    await page.evaluate(async () => { window.__embossTestBreakBlock = null; await window.render(); });
    ok(`${engine}: no page errors`, errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== One paragraph failing [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
