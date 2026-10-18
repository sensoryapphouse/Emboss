// Feedback 30 Sep 2026, item 3 (Paul, 1 Oct: "yes"): braille typed with six-key entry came out at the paragraph indent, so a
// transcriber could not place it exactly. A paragraph made only of typed braille now comes out exactly as typed: cell 1, its spaces
// kept, each Enter a new line (format/document.mjs typedBrailleRuns; tests/typed_braille_para.test.mjs has the layout rules). This
// types it with the real S D F / J K L keys in Chrome and reads the editor's own braille, and checks the typed cells still link back
// to the paragraph (the braille-to-print link).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-sixkey-exact.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const DOTS = { 1: 'KeyF', 2: 'KeyD', 3: 'KeyS', 4: 'KeyJ', 5: 'KeyK', 6: 'KeyL' };
const CELL = { a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5], e: [1, 5] };

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
const page = await context.newPage();
const chord = async (letter) => {
  const keys = CELL[letter].map((d) => DOTS[d]);
  for (const k of keys) await page.keyboard.down(k);
  for (const k of keys) await page.keyboard.up(k);
};
const settle = async () => { let prev = null; for (let k = 0; k < 20; k++) { await page.waitForTimeout(300); const b = await page.evaluate(() => window.lastBrf || ''); if (b === prev) return b; prev = b; } return prev; };
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ title: '', blocks: [{ type: 'para', text: 'Print words here.' }] }); });
  await settle();
  await page.click('#editor');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.click('#btnSixKey');
  ok('six-key entry is on', await page.$eval('#btnSixKey', (b) => b.getAttribute('aria-pressed') === 'true'));
  await page.focus('#editor');
  await chord('a'); await chord('b');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Space');
  await chord('c'); await chord('d');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Space');
  await chord('e');
  const brf = await settle();
  const lines = String(brf).split(/\r?\n/);
  ok('the print paragraph keeps its indent (cell 3)', lines.some((l) => /^ {2},PR9T/.test(l)), lines.slice(0, 6));
  ok('the typed braille starts in cell 1 with its three spaces kept', lines.includes('AB   CD'), lines.slice(0, 6));
  ok('the next typed line keeps its two leading spaces', lines.includes('  E'), lines.slice(0, 6));
  const model = await page.evaluate(() => window.lastModel.blocks.map((b) => ({ type: b.type, text: b.text, segments: b.segments })));
  ok('the typed paragraphs are ordinary paragraphs of Unicode braille', model.length === 3 && model.slice(1).every((b) => b.type === 'para'), model);
  // the typed cells link back to their paragraph (the trace the braille pane's click and caret sync use)
  const linked = await page.evaluate(() => {
    const t = window.lastTrace || {};
    const lines = window.lastBrf.split(/\r?\n/);
    const row = (text) => { const r = lines.indexOf(text); return r < 0 ? null : (t.rowCells?.[r] || []).map((c) => (c ? c.c : null)); };
    return { ab: row('AB   CD'), e: row('  E') };
  });
  ok('each typed cell (and space) links back to its own character in the paragraph', JSON.stringify(linked.ab) === '[0,1,2,3,4,5,6]' && JSON.stringify(linked.e) === '[0,1,2]', linked);
  // save, then open the saved file again: the spacing is kept (spaces XML would collapse are saved as U+2800 blank cells)
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('the saved file keeps the three spaces as blank cells', xml.includes('\u2801\u2803\u2800\u2800\u2800\u2809\u2819'), xml.slice(xml.indexOf('<bodymatter'), xml.indexOf('<bodymatter') + 400));
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sixkey-')), 'typed.xml');
  fs.writeFileSync(file, xml);
  await page.evaluate(() => { window.markDocumentClean(); window.__prevModel = window.lastModel; });
  await page.setInputFiles('#loadFileInput', file);
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel, null, { timeout: 30000 }).catch(() => {});
  const brf2 = String(await settle()).split(/\r?\n/);
  ok('reopened, the typed braille is laid out the same', brf2.includes('AB   CD') && brf2.includes('  E'), brf2.slice(0, 6));
} finally {
  await browser.close();
}
console.log(`\n=== Six-key exact braille [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
