// A89 step 3, found by random-action testing (Chrome and WebKit): the arrow keys could not leave an equation. MathLive moves the
// caret inside an equation itself, and at its edge asks the page to take over (its "move-out" event); Emboss did not, so Right at
// the end of an equation (or Left at its start) did nothing, however often it was pressed. Now Right / Down at the end put the
// caret just after the equation in the text, and Left / Up at the start just before it, where typing goes on as usual.
//
// Also (random-action testing, Chrome): Escape in an equation switched MathLive to its raw-LaTeX mode, where the arrow keys
// stopped moving — now Escape leaves the equation, the caret just after it; and after Insert › a page break from inside an
// equation the keyboard focus fell to the page — now it comes back to the text.
// Also (Firefox, random-action testing): Up from the end of a paragraph whose equation has raised parts (∞ over a ∑) stayed put —
// Firefox measured the equation's glyphs as lines of text above the caret.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs). Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-equation-arrows.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';
import { readFileSync } from 'node:fs';

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
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('dialog', (d) => d.accept());
  const inMath = () => page.evaluate(() => { const a = document.activeElement; return !!(a && (a.tagName === 'MATH-FIELD' || a.closest?.('math-field'))); });
  const pressUntilOut = async (key, max = 30) => { for (let i = 0; i < max; i++) { if (!(await inMath())) return i; await page.keyboard.press(key); } return (await inMath()) ? -1 : max; };
  const load = async () => {
    await page.evaluate(async () => {
      window.markDocumentClean();
      const html = '<p>Before the sum <math><mi>a</mi><mo>+</mo><mi>b</mi></math> after the sum.</p><p>Next paragraph.</p>';
      await window.importFile(new File([`<html><body>${html}</body></html>`], 't.html'));
    });
    await page.waitForFunction(() => document.querySelector('#editor math-field'), null, { timeout: 20000 });
    await page.waitForTimeout(800);
  };
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    await load();
    await page.click('#editor math-field');
    await page.waitForTimeout(300);
    ok(`${engine}: clicking an equation puts the caret in it`, await inMath());
    let n = await pressUntilOut('ArrowRight');
    ok(`${engine}: Right at the end of an equation leaves it`, n > 0, n);
    await page.keyboard.type('Z');
    await page.waitForTimeout(300);
    let text = await page.evaluate(() => document.querySelector('#editor p').textContent);
    ok(`${engine}: …and typing goes just after the equation, in the same paragraph`, /Z ?after the sum/.test(text) && !/Before the sumZ/.test(text), text);

    await load();
    await page.click('#editor math-field');
    await page.waitForTimeout(300);
    n = await pressUntilOut('ArrowLeft');
    ok(`${engine}: Left at the start of an equation leaves it`, n > 0, n);
    await page.keyboard.type('Y');
    await page.waitForTimeout(300);
    text = await page.evaluate(() => document.querySelector('#editor p').textContent);
    ok(`${engine}: …and typing goes just before the equation`, /Before the sum ?Y/.test(text), text);

    await load();
    await page.click('#editor math-field');
    await page.waitForTimeout(300);
    n = await pressUntilOut('ArrowDown', 6);
    ok(`${engine}: Down in a one-line equation leaves it`, n > 0, n);
    // Escape in an equation leaves it (not MathLive's LaTeX mode)
    await load();
    await page.click('#editor math-field');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok(`${engine}: Escape in an equation leaves it`, !(await inMath()));
    ok(`${engine}: …without switching the equation to LaTeX mode`, await page.evaluate(() => document.querySelector('#editor math-field').mode !== 'latex'), await page.evaluate(() => document.querySelector('#editor math-field').mode));
    await page.keyboard.type('W');
    await page.waitForTimeout(300);
    text = await page.evaluate(() => document.querySelector('#editor p').textContent);
    ok(`${engine}: …and typing goes just after the equation`, /W ?after the sum/.test(text), text);
    // Insert › page break from inside an equation: the keys still work afterwards
    await load();
    await page.click('#editor math-field');
    await page.waitForTimeout(300);
    await page.click('#btnInsertMenu'); await page.waitForTimeout(150);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#insertDropdown .insert-item')].filter((e) => e.offsetWidth > 0 && !e.disabled).map((e) => e.id));
    await page.click('#' + ids[ids.length - 1]);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(`${engine}: after Insert › ${ids[ids.length - 1]} from inside an equation, the keys are not lost to the page`, await page.evaluate(() => document.activeElement !== document.body), await page.evaluate(() => document.activeElement.tagName));
    // Up from the end of a paragraph with a tall equation (m03: "Function: f(x) = a0 + Σ … alphafunc")
    const md = readFileSync(new URL('./fixtures/import-audit/md/m03-tables-maths.md', import.meta.url), 'utf8');
    await page.evaluate(async (t) => { window.markDocumentClean(); await window.importFile(new File([t], 'm03.md')); }, md);
    await page.waitForTimeout(3000);
    const iFn = await page.evaluate(() => [...document.querySelectorAll('#editor > *')].findIndex((e) => /^Function:/.test(e.textContent)));
    await page.evaluate((i) => { const blk = document.querySelectorAll('#editor > *')[i]; const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement.closest('math-field, .math-embed') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) }); let last = null; for (let t = w.nextNode(); t; t = w.nextNode()) last = t; document.getElementById('editor').focus(); const r = document.createRange(); r.setStart(last, last.length); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); }, iFn);
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300);
    const blockNow = await page.evaluate(() => { const n = getSelection().anchorNode; const b = (n && (n.nodeType === 1 ? n : n.parentElement))?.closest?.('#editor > *'); return [...document.querySelectorAll('#editor > *')].indexOf(b); });
    ok(`${engine}: Up from the end of a paragraph with a tall equation goes to the line above`, blockNow === iFn - 1, { iFn, blockNow });
    ok(`${engine}: no page errors`, errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Arrow keys out of an equation [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
