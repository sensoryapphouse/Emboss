// APH feedback 17 Oct 2026 (Paul: "1 yes"): the BRF the editor exports is the BRF Quick Mode makes from the same file, line for
// line. The editor holds a list whose item contains a table or a quotation as pieces (the list, the block, the rest of the list);
// its Export used to format those pieces, so a quotation in a list item came out 2 cells left of Quick Mode's (BANA 9.2.2, Q-28:
// displayed material in a list is 2 cells right of the list's runover) and a page could end in a different place (BANA 8.3.5: the
// list's first item kept with the line after it). Export now formats the document whole, as Save, eBraille and Quick Mode do; the
// pane nests such a quotation as the list does too.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-editor-export-parity.mjs [port]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const B = `http://localhost:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  ['a list item holding a quotation and a table (import-audit h03)', path.join(HERE, 'fixtures', 'import-audit', 'html', 'h03-lists.html')],
  ['the testers\' small NIMAS file', path.join(HERE, 'fixtures', 'feedback-17oct', 'small-nimas-test.xml')],
];
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

const browser = await launchBrowser();
try {
  for (const mode of ['bana', 'ukaaf']) {
    for (const [label, file] of FILES) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
      const page = await ctx.newPage();
      page.on('dialog', (d) => d.accept());
      const download = async () => {
        await page.click('#downloadBtn');
        const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#downloadBrfItem')]);
        return fs.readFileSync(await d.path(), 'latin1').split(/\r?\n/);
      };
      await page.goto(B + '/web/index.html');
      await page.evaluate((m) => { const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}'); Object.assign(s, { simpleMode: true, mode: m, cells: 38, lines: 25 }); localStorage.setItem('emboss-settings', JSON.stringify(s)); }, mode);
      await page.reload(); await page.waitForTimeout(2500);
      await (await page.$('input[type=file]')).setInputFiles(file);
      await page.waitForFunction(() => /ready below/i.test(document.body.innerText), null, { timeout: 120000 });
      const quick = await download();
      await page.goto(B + '/web/editor/index.html'); await page.waitForTimeout(2500);
      await page.evaluate(() => window.markDocumentClean?.());
      await page.setInputFiles('#loadFileInput', file);
      await page.waitForFunction(() => /\S/.test(document.querySelector('.braille')?.textContent || ''), null, { timeout: 120000 });
      await page.waitForTimeout(3000);
      const ed = await download();
      const diff = [];
      for (let i = 0; i < Math.max(quick.length, ed.length); i++) if (quick[i] !== ed[i]) diff.push([i, quick[i], ed[i]]);
      ok(`${mode.toUpperCase()}, ${label}: the editor's exported BRF is Quick Mode's, line for line (${quick.length} lines)`, quick.length > 3 && diff.length === 0, diff.slice(0, 4));
      await ctx.close();
    }
  }
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }
await browser.close();
console.log(`\n=== Editor export = Quick Mode [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
