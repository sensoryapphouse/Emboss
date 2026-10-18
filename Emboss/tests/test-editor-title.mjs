// Import fix list #57b (Paul, 1 Oct 2026: "go with your recommendations"): a document title (Word/ODT/RTF Title style, with its
// Subtitle as a second line — IMP-W1; Markdown's first heading) is a `title` block to the readers, and the editor kept it only as an
// ordinary level-1 heading — so the editor's braille (line breaks, blank lines) differed from the reader's and the gold tests', and
// the save lost the title. The editor now keeps the title type.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-editor-title.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const HERE = path.dirname(fileURLToPath(import.meta.url));
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
const load = async (file) => {
  await page.evaluate(() => { window.markDocumentClean(); window.__tPrev = window.lastModel; });
  await page.setInputFiles('#loadFileInput', file);
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__tPrev, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
};
const settle = async () => {
  let prev = null;
  for (let k = 0; k < 25; k++) { await page.waitForTimeout(300); const b = await page.evaluate(() => window.lastBrf || ''); if (b === prev && k > 1) break; prev = b; }
};
const firstBlock = () => page.evaluate(() => { const b = window.lastModel.blocks[0]; return b && { type: b.type, level: b.level, text: b.text }; });
// Caret at the end of the document's first block (the title), through the editor's own selection.
const caretAtEndOfFirstBlock = async () => {
  await page.evaluate(() => { window.editor.update(() => { window.editor.getEditorState()._nodeMap.get('root').getFirstChild().selectEnd(); }, { discrete: true }); window.editor.focus(); });
  await page.waitForTimeout(150);
};
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await load(path.join(HERE, 'fixtures', 'import-audit', 'docx', 'w01-headings.docx'));
  const first = await page.evaluate(() => window.lastModel.blocks[0]);
  ok('a Word Title (with its Subtitle) stays a title block in the editor', first && first.type === 'title', first);
  ok('its two lines are kept', first && /alphatitle\nSub title alphasubtitle/.test(first.text || ''), first && first.text);
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('the save writes it as the title (class="bana-title")', /<h1 class="bana-title">Main title alphatitle<br\/>Sub title alphasubtitle<\/h1>/.test(xml), (xml.match(/<h1[^>]*>[^<]*(<br\/>[^<]*)?<\/h1>/) || [])[0]);
  const saved = path.join(HERE, '.editor-title-saved.xml');
  fs.writeFileSync(saved, xml);
  try {
    await load(saved);
    const again = await page.evaluate(() => window.lastModel.blocks[0]);
    ok('reopened, it is the title again', again && again.type === 'title' && /\n/.test(again.text || ''), again);
  } finally { fs.rmSync(saved, { force: true }); }
  await load(path.join(HERE, 'fixtures', 'import-audit', 'md', 'm02-lists.md'));
  const md = await page.evaluate(() => window.lastModel.blocks[0]);
  ok('Markdown\'s first heading stays the title', md && md.type === 'title', md);

  // Back to the Word title: its braille is the reader's (formatTitle: each line centred on its own, no heading blank-line rules),
  // typing in it keeps it a title, undo / redo carry the flag (the history is exportJSON / importJSON), the editor state round-trips.
  await load(path.join(HERE, 'fixtures', 'import-audit', 'docx', 'w01-headings.docx'));
  await settle();
  const rows = await page.evaluate(() => {
    const all = [];
    window.lastBrf.split('\f').forEach((pg) => { const ls = pg.split(/\r\n|\n/); if (ls.length && ls[ls.length - 1] === '') ls.pop(); all.push(...ls); });
    return window.lastTrace.rows.map((r, k) => (r === 0 ? all[k] : null)).filter((x) => x != null);
  });
  const fmt = await page.evaluate(async () => {
    const mod = await import('/format/document.mjs');
    const o = { ...window.lastFormatOpts }; delete o.trace;
    const out = await mod.formatDocumentAsync({ title: window.lastModel.title, blocks: [window.lastModel.blocks[0]] }, o);
    return out;
  });
  const wanted = String(fmt).split('\f')[0].split(/\r\n|\n/).filter((l) => l.trim());
  // (a page of the reader's own layout also carries a running head and a page number; the two title lines must follow one another in it)
  const mine = rows.filter((l) => l.trim()).map((l) => l.replace(/\s+$/, '')).join('\n');
  ok('its braille is the title layout: each of the two lines centred on its own', rows.length >= 2 && wanted.map((l) => l.replace(/\s+$/, '')).join('\n').includes(mine) && mine.split('\n').every((l) => /^ {5,}\S/.test(l)), { rows, wanted });

  const toc = await page.evaluate(() => (document.getElementById('printTocContainer') || {}).textContent || '');
  ok('the print contents list still lists the title (on one line), as it listed the level-1 heading', /Main title alphatitle Sub title alphasubtitle/.test(toc), toc.slice(0, 200));
  await caretAtEndOfFirstBlock();
  await page.keyboard.type(' more');
  await settle();
  let fb = await firstBlock();
  ok('typing at the end of the title keeps it a title, both lines', fb.type === 'title' && /\n/.test(fb.text) && /alphasubtitle more$/.test(fb.text), fb);
  await page.keyboard.press(UNDO);
  await settle();
  fb = await firstBlock();
  ok('undo keeps it a title', fb.type === 'title' && /alphasubtitle$/.test(fb.text), fb);
  await page.keyboard.press(REDO);
  await settle();
  fb = await firstBlock();
  ok('redo keeps it a title', fb.type === 'title' && /alphasubtitle more$/.test(fb.text), fb);
  const roundTrip = await page.evaluate(() => {
    const json = window.editor.getEditorState().toJSON();
    const h = json.root.children[0];
    const back = window.editor.parseEditorState(JSON.stringify(json));
    let flag = null;
    back.read(() => { flag = back._nodeMap.get('root').getFirstChild().getIsTitle(); });
    return { type: h.type, tag: h.tag, isTitle: h.isTitle, flag };
  });
  ok('the editor state JSON carries the flag and reads back', roundTrip.type === 'heading' && roundTrip.tag === 'h1' && roundTrip.isTitle === true && roundTrip.flag === true, roundTrip);

  // The style menu: the block stops being a title.
  const styleTo = async (v) => { await page.selectOption('#blockStyle', v); await settle(); };
  await caretAtEndOfFirstBlock();
  await styleTo('h1');
  fb = await firstBlock();
  ok('Heading 1 from the style menu makes it an ordinary heading (not the title)', fb.type === 'heading' && fb.level === 1, fb);
  let xml2 = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('... and the save writes a plain <h1>, no title class', /<h1>Main title alphatitle/.test(xml2) && !/bana-title/.test(xml2), (xml2.match(/<h1[^>]*>/) || [])[0]);
  await page.keyboard.press(UNDO);
  await settle();
  fb = await firstBlock();
  ok('undo of the style change gives the title back', fb.type === 'title', fb);
  await caretAtEndOfFirstBlock();
  await styleTo('p');
  fb = await firstBlock();
  ok('Body Text from the style menu makes it a paragraph', fb.type === 'para', fb);

  // A title with emphasis keeps it (the segments ride along), and the save writes it inside the title.
  const mdFile = path.join(HERE, '.editor-title-emph.md');
  fs.writeFileSync(mdFile, '# A *slanted* title\n\nBody text alphabody.\n');
  try {
    await load(mdFile);
    await settle();
    const eb = await page.evaluate(() => window.lastModel.blocks[0]);
    ok('a Markdown title with emphasis is a title with its segments', eb && eb.type === 'title' && Array.isArray(eb.segments) && eb.segments.some((g) => g.tf), eb);
    const exml = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok('... and the save keeps the emphasis inside the title <h1>', /<h1 class="bana-title">A <em>slanted<\/em> title<\/h1>/.test(exml), (exml.match(/<h1[^>]*>.*?<\/h1>/) || [])[0]);
  } finally { fs.rmSync(mdFile, { force: true }); }
} finally {
  await browser.close();
}
console.log(`\n=== Editor title [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
