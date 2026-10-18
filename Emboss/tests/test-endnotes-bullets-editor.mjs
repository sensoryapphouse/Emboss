// IMP-W3 (endnote section) and IMP-W7 (custom bullets), Paul, 30 Sep 2026, through the real editor in headless Chrome:
//  - a Word file with an endnote: the print view keeps the endnote right after its paragraph, the braille has the endnote
//    section (new page, NOTES), and Save -> reopen gives the same braille with the note still an endnote in the file;
//  - a Word file with a Wingdings arrow bullet: the editor shows the arrow, the braille is the first transcriber-defined
//    symbol, and Save -> reopen keeps it (class bana-bullet-glyph-27a2).
// Usage: node Emboss/scripts/serve.mjs 8284 &   then   node Emboss/tests/test-endnotes-bullets-editor.mjs 8284
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { makeZip } = await import('../web/zip.mjs');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const item = (t) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const numbering = `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-w3w7-'));
const arrowDocx = path.join(dir, 'arrows.docx');
fs.writeFileSync(arrowDocx, Buffer.from(await makeZip([
  { name: 'word/document.xml', text: `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>Intro</w:t></w:r></w:p>${item('Apples')}${item('Pears')}</w:body></w:document>` },
  { name: 'word/numbering.xml', text: numbering },
]).arrayBuffer()));
const endnoteDocx = path.join(HERE, 'fixtures', 'import-audit', 'docx', 'w05-notes-comments.docx');

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });

async function load(file) {
  await page.evaluate(() => window.markDocumentClean && window.markDocumentClean());
  await page.setInputFiles('#loadFileInput', file);
  await page.waitForTimeout(4500);
}
async function roundTrip() {
  const before = await page.evaluate(() => window.lastBrf);
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  await page.evaluate(() => window.markDocumentClean && window.markDocumentClean());
  await page.evaluate(async (x) => { await window.importFile(new File([x], 'reopen.xml', { type: 'text/xml' })); }, xml);
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() => window.lastBrf);
  return { before, after, xml };
}

console.log('--- IMP-W3: endnotes ---');
await load(endnoteDocx);
const en = await page.evaluate(() => ({
  print: [...document.querySelectorAll('#editor > *')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  pages: window.lastBrf.split('\f').map((p) => p.replace(/\r/g, '')),
  warnings: window.lastWarnings.length,
}));
const iPara = en.print.findIndex((t) => /Second with an endnote/.test(t));
ok('the print view keeps the endnote right after its paragraph', iPara >= 0 && /Endnote text/.test(en.print[iPara + 1] || ''), en.print.slice(0, 6));
ok('the braille has the endnote section on the last page, under NOTES', en.pages.length >= 2 && /@\.<,,NOTES@\.>/.test(en.pages[en.pages.length - 1]) && /5DNOTE TEXT/.test(en.pages[en.pages.length - 1]), en.pages[en.pages.length - 1]);
ok('the endnote text is not among the paragraphs', !/5DNOTE TEXT/.test(en.pages[0]), en.pages[0]);
const rt = await roundTrip();
ok('save -> reopen: the same braille', rt.before === rt.after);
ok('the saved file keeps the endnote as an endnote', (rt.xml.match(/<note [^>]*class="endnote"/g) || []).length === 1, rt.xml.slice(rt.xml.indexOf('<note')));

console.log('--- IMP-W7: custom bullets ---');
await load(arrowDocx);
const bl = await page.evaluate(() => ({
  markers: [...document.querySelectorAll('#editor li')].map((l) => l.getAttribute('data-marker')),
  brf: window.lastBrf.replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter(Boolean),
}));
ok('the editor shows the arrow as the bullet', bl.markers.length === 2 && bl.markers.every((m) => m === '➢'), bl.markers);
ok('the braille is the first transcriber-defined symbol on each item', bl.brf.includes(';? ,APPLES') && bl.brf.includes(';? ,PE>S'), bl.brf);
const rb = await roundTrip();
ok('save -> reopen: the same braille', rb.before === rb.after, rb.after);
ok('the saved file records the glyph', (rb.xml.match(/bana-bullet-glyph-27a2/g) || []).length === 2);

ok('no uncaught page errors', errs.length === 0, errs);
await browser.close();
console.log('');
console.log(`=== Endnotes and bullets in the editor [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) { console.error('FAILED:', failures.join(', ')); process.exit(1); }
