// The editor must braille a file the way the reader's own model brailles (1 Oct 2026, import fix list #57). For every import-audit
// fixture this loads the file in the real editor, takes the reader's model (parseFile in the page, as the Load button reads it) and
// the editor's model after its round trip through Lexical (window.lastModel, what the braille pane formats), formats both in Node
// the same way, in BANA and UKAAF, and requires the same braille. A difference means the editor dropped or changed something the
// reader gave it (found this way: verse drama lost its play margins, unmarked list items gained a bullet).
//
// KNOWN differences are listed by name with their cause (import-fix-list.md #57 / #40); each is asserted to still differ, so a fix
// shows up as a failure that asks for its entry to be removed. Anything else that differs fails.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-editor-reader-parity.mjs [port] [--list]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright'). About 3 minutes.
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument } from '../format/document.mjs';

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const LIST = process.argv.includes('--list');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'import-audit');
const FILES = ['docx', 'doc', 'odt', 'rtf', 'html', 'md', 'epub', 'dtbook']
  .flatMap((d) => (fs.existsSync(path.join(FIX, d)) ? fs.readdirSync(path.join(FIX, d)).filter((f) => /\.(docx|doc|odt|rtf|html?|md|epub|xml)$/i.test(f)).map((f) => `${d}/${f}`) : []));

// file|mode -> why it still differs (import-fix-list.md #57 / #40)
const ITEMBLOCK = '#57d: a quotation among a list item\'s blocks (the editor holds only plain further paragraphs there)';
const ITEMCODE = '#57d: UKAAF only - the code block among a list item\'s blocks keeps its type in the editor now (#40), but the formatter puts blank lines around it inside the item and none around it between the three blocks the editor holds (a formatter difference in format/document.mjs, not the editor)';
const KNOWN = {
  // #57b fixed the title (the editor keeps the `title` type; the five TITLE entries are gone), #57c fixed the footnote's second paragraph (the NOTE2 entries for w05, its LibreOffice twins and m04 are gone) and #40 the code blocks.
  'html/h03-lists.html|bana': ITEMBLOCK,
  'html/h03-lists.html|ukaaf': ITEMBLOCK,
  'md/m02-lists.md|ukaaf': ITEMCODE,
};

const up = (s) => String(s).toUpperCase();
const braille = (model, mode) => {
  try { return formatDocument(structuredClone({ title: model.title, blocks: model.blocks, metadata: model.metadata }), { mode, width: 40, depth: 25, translate: up }).split(/\r?\n/); } catch (e) { return [`ERROR ${e.message}`]; }
};
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `line ${i}: reader ${JSON.stringify(a.slice(i, i + 2))} | editor ${JSON.stringify(b.slice(i, i + 2))}`; return null; };
const strip = (blocks) => JSON.parse(JSON.stringify(blocks || [], (k, v) => (k === '_key' ? undefined : v)));

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + String(detail).slice(0, 500) : ''}`); }
};
const found = [];

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
const page = await context.newPage();
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  for (const rel of FILES) {
    const file = path.join(FIX, rel);
    const binary = /\.(docx|doc|odt|epub)$/i.test(rel);
    const buf = fs.readFileSync(file);
    const reader = await page.evaluate(async ({ name, payload, binary }) => {
      let arg = payload;
      if (binary) { const bin = atob(payload); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); arg = u.buffer; }
      try { const m = await window.parseFile(name, arg); return JSON.parse(JSON.stringify({ title: m.title, blocks: m.blocks, metadata: m.metadata })); } catch (e) { return { error: String(e && e.message || e) }; }
    }, { name: path.basename(rel), payload: binary ? buf.toString('base64') : buf.toString('utf8'), binary });
    await page.evaluate(() => { window.markDocumentClean(); window.__parityPrev = window.lastModel; });
    await page.setInputFiles('#loadFileInput', file);
    await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__parityPrev, null, { timeout: 60000 }).catch(() => {});
    let prev = null;
    for (let k = 0; k < 20; k++) { await page.waitForTimeout(300); const b = await page.evaluate(() => window.lastBrf || ''); if (b === prev) break; prev = b; }
    const editor = await page.evaluate(() => JSON.parse(JSON.stringify({ blocks: window.lastModel ? window.lastModel.blocks : [] })));
    if (reader.error) { ok(`${rel}: the reader opens it`, false, reader.error); continue; }
    for (const mode of ['bana', 'ukaaf']) {
      const d = firstDiff(braille(reader, mode), braille({ ...reader, blocks: strip(editor.blocks) }, mode));
      const key = `${rel}|${mode}`;
      if (d) found.push(`${key}  ${d}`);
      if (LIST) continue;
      if (KNOWN[key]) ok(`${key} (KNOWN: ${KNOWN[key].slice(0, 60)}…) still differs`, !!d, `no longer differs: remove it from KNOWN`);
      else ok(`${key}: the editor brailles it as the reader's model does`, !d, d);
    }
  }
} finally {
  await browser.close();
}
if (LIST) { console.log(found.join('\n')); console.log(`\n${found.length} file/mode pairs differ`); process.exit(0); }
console.log(`\n=== Editor/reader braille parity [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
