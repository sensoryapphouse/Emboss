// A89 (random-action testing, Firefox): after Insert Table the caret is in a table cell, and in Firefox Down did nothing at all —
// the caret could not leave the cell (each cell is its own small editing box, and the browsers each did their own thing with
// Up/Down there). Now, in every browser, Up/Down in a table cell go to the cell above/below in the same column, as in a word
// processor's table; Down from the last row leaves the table for the text after it, Up from the top row for the text before it.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-table-arrows.mjs [port]
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
  const browser = await launchBrowser({}, key);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', transcriberTools: true })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('dialog', (d) => d.accept());
  // "h<col>" / "r<row>,<col>" in a cell, or the top-level block index of the caret
  const where = () => page.evaluate(() => {
    const a = document.activeElement;
    if (a?.classList?.contains('table-cell-input')) return a.dataset.row === '-1' ? `h${a.dataset.col}` : `r${a.dataset.row},${a.dataset.col}`;
    const n = getSelection().anchorNode;
    const blk = (n && (n.nodeType === 1 ? n : n.parentElement))?.closest?.('#editor > *');
    return String([...document.querySelectorAll('#editor > *')].indexOf(blk));
  });
  const press = async (k, n) => { const t = []; for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); t.push(await where()); } return t; };
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      window.markDocumentClean();
      window.modelToLexical({ blocks: [{ type: 'para', text: 'Before the table.' }, { type: 'table', headers: ['Name', 'Age'], rows: [['Ann', '7'], ['Bob', '9']] }, { type: 'para', text: 'After the table.' }] });
      await window.render();
    });
    await page.waitForTimeout(500);
    await page.click('.table-cell-input[data-row="-1"][data-col="1"]');
    let t = await press('ArrowDown', 3);
    ok(`${engine}: Down goes down the column, then out of the table to the text after it`, t.join() === 'r0,1,r1,1,2', t);
    await page.keyboard.type('Z'); await page.waitForTimeout(200);
    ok(`${engine}: …and typing goes into that text`, await page.evaluate(() => document.querySelectorAll('#editor > *')[2].textContent.includes('Z')));
    await page.click('.table-cell-input[data-row="1"][data-col="0"]');
    t = await press('ArrowUp', 3);
    ok(`${engine}: Up goes up the column, then out of the table to the text before it`, t.join() === 'r0,0,h0,0', t);

    // the random-action case: Insert Table, then Down
    await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Some words.' }, { type: 'para', text: 'More words.' }] }); await window.render(); });
    await page.click('#editor p >> nth=0');
    await page.keyboard.press('End');
    await page.click('#btnInsertMenu');
    await page.click('#btnTable');
    await page.waitForTimeout(800);
    const start = await where();
    t = await press('ArrowDown', 8);
    ok(`${engine}: after Insert Table (caret in ${start}), Down moves every time until it leaves the table`, t.every((x, i) => i === 0 ? x !== start : (x !== t[i - 1] || !/^[hr]/.test(x))) && !/^[hr]/.test(t[t.length - 1]), [start, ...t]);
    ok(`${engine}: no page errors`, errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Arrow keys in tables [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
