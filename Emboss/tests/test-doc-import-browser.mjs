// Word 97–2003 .doc import in the real app (headless Chrome): the editor loads a .doc (and a
// .docm / a .doc saved with a .docx name), shows print and braille, keeps pictures, and a
// NIMAS save reopens with the same structure; Quick Mode turns a .doc into braille.
//
// Needs the dev server:  node Emboss/scripts/serve.mjs 8142 &
//   node Emboss/tests/test-doc-import-browser.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8142);
const BASE = `http://localhost:${PORT}`;
const FIX = new URL('./fixtures/doc/', import.meta.url);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); } else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 300) : ''}`); }
};

const browser = await launchBrowser();
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' })); } catch { /* storage blocked */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });

async function load(name, file) {
  const arr = Array.from(readFileSync(new URL(file, FIX)));
  return page.evaluate(async ({ name, arr }) => {
    window.markDocumentClean();
    const before = window.lastBrf;
    await window.importFile(new File([new Uint8Array(arr)], name));
    const t0 = Date.now();
    while (window.lastBrf === before && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1000));
    const m = window.lastModel;
    return {
      types: (m.blocks || []).map((b) => b.type + (b.level || '')),
      texts: JSON.stringify(m.blocks),
      brf: window.lastBrf,
      print: document.querySelector('[contenteditable=true]')?.innerText || '',
      imgs: document.querySelectorAll('[contenteditable=true] img').length,
    };
  }, { name, arr });
}

console.log('--- .doc import in the editor ---');
const basics = await load('basics.doc', 'basics.doc');
ok('basics.doc: headings, list, table and footnote in the editor model', ['heading1', 'heading2', 'list', 'table', 'footnote'].every((t) => basics.types.includes(t)), basics.types);
ok('basics.doc: print pane shows the text', /Chapter One[\s\S]*Plain bold and italic[\s\S]*The footnote text\./.test(basics.print));
ok('basics.doc: braille shows the heading and list', /,*APT] ,"O/.test(basics.brf) && /#A4 ,F\/\r?\n#B4 ,SECOND/.test(basics.brf), basics.brf.slice(0, 300));
const objects = await load('objects.doc', 'objects.doc');
ok('objects.doc: its pictures are displayed', objects.imgs >= 2, objects.imgs);
ok('objects.doc: the equation is maths', objects.types.includes('math'));
const docm = await load('basics.docm', 'basics.docx');
ok('a .docm loads as Word', docm.types.join() === basics.types.join(), docm.types);
const renamed = await load('renamed.docx', 'basics.doc');
ok('a .doc saved with a .docx name loads', renamed.types.join() === basics.types.join(), renamed.types);

console.log('--- NIMAS save and reopen ---');
for (const f of ['basics.doc', 'objects.doc', 'tables.doc', 'numbering.doc']) {
  const first = await load(f, f);
  const again = await page.evaluate(async () => {
    const xml = window.exportCurrentDocumentXml();
    window.markDocumentClean();
    const before = window.lastBrf;
    await window.importFile(new File([xml], 'saved.xml', { type: 'text/xml' }));
    const t0 = Date.now();
    while (window.lastBrf === before && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1000));
    return (window.lastModel.blocks || []).map((b) => b.type + (b.level || ''));
  });
  const core = (ts) => ts.filter((t) => /^(heading|list|table|footnote|math)/.test(t)).join();
  ok(`${f}: headings, lists, tables, notes and maths survive a NIMAS save and reopen`, core(again) === core(first.types), { before: first.types, after: again });
}
await page.evaluate(() => window.markDocumentClean());

console.log('--- Quick Mode ---');
const q = await (await browser.newContext()).newPage();   // default settings: Quick Mode stays on its own page
q.on('pageerror', (e) => errors.push('quick: ' + e.message));
await q.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
await q.waitForTimeout(3000);
await q.setInputFiles('#fileInput', fileURLToPath(new URL('basics.doc', FIX)));
await q.waitForFunction(() => (document.getElementById('preview')?.textContent || '').length > 50, null, { timeout: 60000 }).catch(() => {});
const preview = await q.evaluate(() => document.getElementById('preview')?.textContent || '');
ok('Quick Mode: a .doc becomes braille', preview.length > 200 && /[⠀-⣿]/.test(preview), preview.slice(0, 100));

ok('no page errors', !errors.length, errors);
await browser.close();
console.log(`\n=== Word .doc import [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
process.exit(failures.length ? 1 : 0);
