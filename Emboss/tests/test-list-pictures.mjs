// Found 17 Oct 2026 by the S5D-Q4 import work (Paul: "fix both first"):
//  - a picture inside an HTML/EPUB list item — in the item's text, linked, or the item's only content — was dropped with its description;
//    it is now a picture of the item (its transcriber's note follows the item's text, as a picture after a paragraph in an item already did);
//  - the editor dropped a picture's "decorative" mark (an HTML alt="", Word's IMP-W12), so it warned "picture has no description" where
//    Quick Mode did not; the mark now goes through the editor, for as long as the picture has no description.
// Checked in the editor and in Quick Mode with tests/fixtures/feedback-17oct/list-pictures.html.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-list-pictures.mjs [port]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const B = `http://localhost:${PORT}`;
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'feedback-17oct', 'list-pictures.html');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('lp')) { sessionStorage.setItem('lp', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana' })); } } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // ---- the editor
  await page.goto(B + '/web/editor/index.html'); await page.waitForTimeout(2500);
  await page.evaluate(() => window.markDocumentClean?.());
  await page.setInputFiles('#loadFileInput', FILE);
  await page.waitForFunction(() => /\S/.test(document.querySelector('.braille')?.textContent || ''), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  const cards = await page.evaluate(() => [...document.querySelectorAll('#editor .doc-image-block')].map((c) => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)));
  ok('editor: all three pictures are there (the decorative one, the one in an item\'s text, the item that is only a picture)', cards.length === 3, cards);
  const alts = await page.evaluate(() => [...document.querySelectorAll('#editor .doc-image-block textarea, #editor .doc-image-block input')].map((x) => x.value));
  ok('editor: the two list pictures keep their descriptions', alts.includes('A red apple with a leaf') && alts.includes('A green pear'), alts);
  const badge = await page.evaluate(() => { const b = document.getElementById('warnBadge'); return { hidden: !b || b.hidden, text: b ? b.textContent.trim() : '' }; });
  ok('editor: the decorative picture (alt="") raises no "no description" warning', badge.hidden, badge);
  const quickDl = async () => { await page.click('#downloadBtn'); const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#downloadBrfItem')]); return fs.readFileSync(await d.path(), 'latin1'); };
  const edBrf = await quickDl();
  ok('editor: the braille has the two pictures\' notes', /APPLE/.test(edBrf) && /PE>/.test(edBrf), edBrf.split(/\r?\n/).filter((l) => /ILLU|APPLE|PE>/.test(l)));
  // ---- Quick Mode: the same braille
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}'); s.simpleMode = true; localStorage.setItem('emboss-settings', JSON.stringify(s)); window.markDocumentClean?.(); });
  await page.goto(B + '/web/index.html'); await page.waitForTimeout(2500);
  await (await page.$('input[type=file]')).setInputFiles(FILE);
  await page.waitForFunction(() => /ready below/i.test(document.body.innerText), null, { timeout: 60000 });
  const qBrf = await quickDl();
  { const a = qBrf.split(/\r?\n/), b = edBrf.split(/\r?\n/); const d = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d.push([i, a[i], b[i]]); ok('Quick Mode: the same braille as the editor\'s, line for line', d.length === 0, d.slice(0, 6)); }
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }
await browser.close();
console.log(`\n=== Pictures in lists [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
