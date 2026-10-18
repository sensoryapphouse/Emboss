// A user's report (Paul, 1 Oct 2026): "sometimes the uneditable braille lingers from previous stuff". A loaded file's title is kept
// apart from the text (the document title: page 1, line 1 of the braille, BANA 1.8.1 / the running head) — it is not in the text pane,
// so it cannot be edited there. Clear, or deleting all the text and starting again, left it in place: the new text's braille still
// began with the old document's title. Now Clear starts a new document (no title), and so does emptying the text by hand.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-editor-stale-title.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'fixtures', 'import-audit', 'docx', 'w01-headings.docx');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const brfLines = async () => (await page.evaluate(() => window.lastBrf || '')).split(/\r?\n/).filter((l) => l.trim());
const load = async () => {
  await page.evaluate(() => { window.markDocumentClean(); window.__sPrev = window.lastModel; });
  await page.setInputFiles('#loadFileInput', FILE);
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__sPrev, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
};
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  await load();
  ok('a loaded document\'s title is on line 1 of its braille', /ALPHATITLE/.test((await brfLines())[0] || ''), (await brfLines())[0]);

  // deleting everything by hand and typing something new
  await page.click('#editor');
  await page.keyboard.press(`${mod}+a`); await page.keyboard.press('Backspace');
  await page.keyboard.type('Hello world'); await page.waitForTimeout(2000);
  let lines = await brfLines();
  ok('after deleting all the text, the old title is gone from the braille', !lines.some((l) => /ALPHATITLE/.test(l)) && lines.some((l) => /HELLO/.test(l)), lines.slice(0, 3));

  // Clear, then typing
  await load();
  await page.click('#btnClear'); await page.waitForTimeout(800);
  await page.click('#editor'); await page.keyboard.type('Fresh start'); await page.waitForTimeout(2000);
  lines = await brfLines();
  ok('after Clear, the old title is gone from the braille', !lines.some((l) => /ALPHATITLE/.test(l)) && lines.some((l) => /,FRE%/.test(l)), lines.slice(0, 3));
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('and from the saved file', !/alphatitle/.test(xml), (xml.match(/<doctitle>[^<]*<\/doctitle>/) || [])[0]);

  // editing the text of a loaded document (not emptying it) keeps its title
  await load();
  await page.click('#editor'); await page.keyboard.press(`${mod}+End`); await page.keyboard.type(' more'); await page.waitForTimeout(2000);
  ok('editing a document (without emptying it) keeps its title', /ALPHATITLE/.test((await brfLines())[0] || ''), (await brfLines())[0]);
} finally {
  await browser.close();
}
console.log(`\n=== Editor stale title [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
