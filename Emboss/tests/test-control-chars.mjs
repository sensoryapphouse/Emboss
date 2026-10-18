// A89 (random-action testing, seed 1982326777, Chrome): text with invisible control characters (codes 0, 7, 27 — from a paste)
// in a table cell made that column one cell wider in the braille; a save drops them (a file cannot hold them), so the reopened
// document's braille was different. The editor now leaves them out of the document it brailles, as the save does: the braille
// is the same before and after a save + reopen, in a table and in a paragraph.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-control-chars.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const C = '\u0000\u0007 control chars \u001b';
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
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.exportCurrentDocumentXml === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    for (const [label, blocks] of [
      ['a table cell', [{ type: 'para', text: 'Before.' }, { type: 'table', headers: [C, 'Header 2', 'Header 3'], rows: [['Header 1', '', 'x'], ['a', 'b', 'c']], format: 'spatial', style: 'table-spatial' }]],
      ['a paragraph', [{ type: 'para', text: `Words ${C} and more words to wrap the line at the end of the braille line here.` }]],
    ]) {
      const first = await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); return { brf: window.lastBrf, xml: window.exportCurrentDocumentXml() }; }, blocks);
      const back = await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'saved.xml')); await window.render(); return window.lastBrf; }, first.xml);
      const strip = (s) => s.replace(/^.*\r?\n/, '');   // the first line holds the title, which the save adds
      ok(`${engine}: control characters in ${label} — the same braille after a save and reopen`, strip(first.brf) === strip(back), { first: first.brf.split(/\r?\n/).slice(0, 8), back: back.split(/\r?\n/).slice(0, 8) });
    }
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Control characters [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
