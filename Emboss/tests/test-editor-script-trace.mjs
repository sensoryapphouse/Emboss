// Sub/superscripts in the real editor (import fix list #55, 1 Oct 2026): the editor's position trace (styledTranslatePos) now
// resolves the sub/superscript markers, with positions, wherever it can do so exactly as `translate` does. Checks, in real Chrome:
//   1. the braille the editor shows for a paragraph with H2O and x-squared is the same as before and as Quick Mode's (level signs
//      ";5" / ";9" are there, no raw escape, no private-use character);
//   2. the paragraph is traced: no "trace-fallback" notice for it, and its level-sign cells link back to the print text
//      (every braille cell carries a print character index; the level sign points at the marker, the digit at the digit);
//   3. a run that needs the grade 1 translator (the word "mass" with the subscript "sun", RUEB 3.4) still brailles correctly
//      through the fallback (the known limit: that one block has no cell links).
// Run (needs the dev server): node Emboss/scripts/serve.mjs 8298 &  then  node Emboss/tests/test-editor-script-trace.mjs 8298
// Not run by run-all-tests.mjs (imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
let pass = 0; const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${name}`); } else { failures.push(name); console.error(`  FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`); }
}

const HTML = '<!doctype html><html><head><title>Scripts</title></head><body>'
  + '<p>Water is H<sub>2</sub>O and x<sup>2</sup> here.</p>'
  + '<p>The mass<sub>sun</sub> is large.</p>'
  + '</body></html>';

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript(() => {
  try {
    localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' }));
  } catch {}
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
const t0 = Date.now();
while (await page.evaluate(() => typeof window.importFile !== 'function')) {
  if (Date.now() - t0 > 15000) throw new Error('importFile never appeared');
  await new Promise((r) => setTimeout(r, 50));
}
await page.waitForFunction(() => typeof window.lastBrf === 'string', null, { timeout: 60000 });
await page.evaluate(async (html) => {
  window.markDocumentClean?.();
  await window.importFile(new File([html], 'scripts.html', { type: 'text/html' }));
}, HTML);
await page.waitForTimeout(800);

const brf = await page.evaluate(() => window.lastBrf);
const lines = brf.split(/\r?\n/);
console.log(JSON.stringify(lines.filter((l) => l.trim())));
ok('H2O is brailled with its subscript level sign', /,H;5#B,O/.test(brf), brf);
ok('x squared is brailled with its superscript level sign', /X;9#B/.test(brf), brf);
ok('the word as a subscript is grouped in grade 1 (RUEB 3.4)', /MASS;;5<SUN>/.test(brf), brf);
ok('no raw liblouis escape or private-use character in the braille', !/\\X|[-]/.test(brf));

// the cells of the paragraphs: hovering a braille row builds its cells (each carries the print character index it came from)
await page.evaluate(() => document.querySelectorAll('.braille .brl-row').forEach((r) => r.dispatchEvent(new Event('pointerover', { bubbles: true }))));
await page.waitForTimeout(300);
const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.braille .brl-row')).map((r) => ({
  text: Array.from(r.querySelectorAll('.bcell')).map((c) => c.textContent).join(''),
  cells: Array.from(r.querySelectorAll('.bcell')).map((c) => (c.dataset.char === undefined ? null : +c.dataset.char)),
})));
console.log(JSON.stringify(rows.filter((r) => r.cells.length)));
const brlRows = rows.filter((r) => r.cells.length);
const nonBlank = (r) => r.cells.filter((n, i) => r.text[i] !== '\u2800');      // the cells that are not a blank (a blank is a space, which has no print character of its own)
// F9 E2a (PAUL'S DECISION, 9 Oct 2026): the editor's Title field is hidden here (the default), so the document's <title> "Scripts" is no
// longer added to the braille as its first row: the water paragraph is the first row with cells, the mass/sun paragraph the second
// (they were the second and third).
const waterPara = brlRows[0] || { text: '', cells: [] };
ok('the water paragraph has braille cells', waterPara.cells.length > 10, brlRows.length);
ok('every dotted cell of the water paragraph links back to a print character (it was traced, not rebuilt by the fallback)', nonBlank(waterPara).every((n) => n !== null), waterPara.cells);
ok('the level sign cells point at the sub/superscript text itself (H at 9, "2" at 11, x at 19, its "2" at 21)', [9, 11, 19, 21].every((n) => waterPara.cells.includes(n)), waterPara.cells);
const massPara = brlRows[1] || { text: '', cells: [] };
// Changed 1 Oct 2026 (feedback 30 Sep item 7, Paul): the grade-1 run is traced too now (styledTranslatePos with translateG1).
// Was: "the one block left to the fallback: right braille, no cell links (the known limit)".
ok('the mass/sun paragraph is traced too: every dotted cell links back to a print character', massPara.cells.length > 10 && nonBlank(massPara).every((n) => n !== null), massPara.cells);

const kinds = await page.evaluate(() => (window.lastWarnings || []).map((w) => w.kind));
console.log('  warnings:', JSON.stringify(kinds));
ok('no trace-fallback notice at all (was one, for the grade 1 word, before 1 Oct)', kinds.filter((k) => k === 'trace-fallback').length === 0, kinds);
ok('no page errors', pageErrors.length === 0, pageErrors);

await browser.close();
console.log(`\n=== editor sub/superscript trace [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
process.exit(failures.length ? 1 : 0);
