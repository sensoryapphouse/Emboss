// Playwright browser checks for the "leftovers" (Paul, 25 Sep 2026):
//   1. Load errors — a hard failure (password-protected / damaged / Word 6-95 / not-a-Word-file)
//      is shown as a plain error, no "continue editing" wording, and leaves the current document
//      untouched; a genuine partial parse still gets today's banner. Editor AND Quick Mode.
//   2. Multi-paragraph list items — the "Continue Item" command (slash menu "/continue" and
//      Ctrl/Cmd+Shift+Enter) turns a blank new list line into a further paragraph of the item
//      above (item.blocks), and back; it saves/exports correctly and the help documents it.
//   3. (tts.mjs / proofread.mjs's own item.blocks ordering is covered by pure Node unit tests —
//      format/test-tts.mjs and format/test-roundtrip.mjs — since neither needs a browser.)
//
// Needs the dev server:  node Emboss/scripts/serve.mjs 8137 &
//   node Emboss/tests/test-editor-leftovers.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

// Binary junk that Emboss's .doc reader must refuse outright (doc.mjs's sniffNonCfb): not a
// zip/RTF/HTML/CFB/Word-2-DOS signature, and mostly control bytes so it isn't read as plain text.
function badDocBytes() {
  const bytes = new Uint8Array(256).fill(0x01);
  bytes[0] = 0x11; bytes[1] = 0x22;
  return bytes;
}
const GOOD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1><h1>Baseline Document</h1><p>Baseline paragraph text.</p></level1></bodymatter></book>
</dtbook>`;
// A genuine "partial parse" trigger: garbage bytes named .odt. parse.mjs's XML reader
// (parseXml) falls back to HTML parsing on malformed XML, and HTML parsing is forgiving enough
// to recover almost anything, so a malformed-XML file is not a reliable way to make ANY reader
// throw. An .odt is a zip archive (content.xml inside it); garbage bytes fail zip parsing itself
// ("not a zip (no EOCD)", input/parse.mjs's listZipEntries) — a plain Error, not `.userFacing`
// (only the .doc/.docx readers wrap their hard failures that way), so it is exactly a "this
// couldn't be fully parsed, not a file Emboss flatly refuses" case.
function badOdtBytes() {
  const bytes = new Uint8Array(64).fill(0x2a);   // not a PK zip signature, not any recognised format
  return bytes;
}

const browser = await launchBrowser({ args: ['--no-sandbox'] });

// ==================================================================================
// 1a. Editor: load errors (hard failure vs partial parse)
// ==================================================================================
console.log('--- Editor: load errors ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' })); } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });

  // Baseline: load a good document, keep its model (as JSON — exportCurrentDocumentXml() embeds
  // a fresh generated id/timestamp on every call, so it is not byte-stable even when unchanged)
  // to compare against after a hard failure.
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'good.xml', { type: 'text/xml' })); }, GOOD_XML);
  await page.waitForFunction(() => (window.lastModel?.blocks || []).some((b) => /Baseline paragraph/.test(b.text || '')), null, { timeout: 20000 });
  const baselineBlocks = await page.evaluate(() => JSON.stringify(window.lastModel.blocks));

  // Hard failure: a .doc Emboss cannot read at all.
  await page.evaluate(async (bytes) => {
    window.markDocumentClean();
    await window.importFile(new File([new Uint8Array(bytes)], 'bad.doc', { type: 'application/msword' }));
  }, Array.from(badDocBytes()));
  await page.waitForFunction(() => !document.getElementById('parseWarningBanner').hidden, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(200);   // announce() debounces its textContent update by ~30ms
  const hard = await page.evaluate(() => ({
    hidden: document.getElementById('parseWarningBanner').hidden,
    isError: document.getElementById('parseWarningBanner').classList.contains('is-error'),
    role: document.getElementById('parseWarningBanner').getAttribute('role'),
    text: document.getElementById('parseWarningText').textContent,
    announce: document.getElementById('announce').textContent,
    blocks: JSON.stringify(window.lastModel.blocks),
  }));
  ok('hard failure: the parse-warning banner is shown', !hard.hidden, hard);
  ok('hard failure: banner is styled as an error (is-error, role=alert)', hard.isError && hard.role === 'alert', hard);
  ok('hard failure: shows the reader\'s own plain message, not "continue editing" wording', !/continue editing/i.test(hard.text) && /not a word document/i.test(hard.text), hard.text);
  ok('hard failure: leaves the current document untouched', hard.blocks === baselineBlocks, { before: baselineBlocks, after: hard.blocks });
  ok('hard failure: announced to screen readers', /not a word document/i.test(hard.announce), hard.announce);

  // Partial parse: a malformed but not-a-hard-failure file still gets today's banner.
  await page.evaluate(async (bytes) => { window.markDocumentClean(); await window.importFile(new File([new Uint8Array(bytes)], 'broken.odt', { type: 'application/vnd.oasis.opendocument.text' })); }, Array.from(badOdtBytes()));
  await page.waitForFunction(() => !document.getElementById('parseWarningBanner').hidden, null, { timeout: 20000 }).catch(() => {});
  const partial = await page.evaluate(() => ({
    isError: document.getElementById('parseWarningBanner').classList.contains('is-error'),
    role: document.getElementById('parseWarningBanner').getAttribute('role'),
    text: document.getElementById('parseWarningText').textContent,
  }));
  ok('partial parse: banner keeps its ordinary (non-error) styling', !partial.isError && partial.role === 'status', partial);
  ok('partial parse: keeps the "continue editing" wording', /continue editing/i.test(partial.text), partial.text);

  ok('editor load-error checks: no page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 1b. Quick Mode: load errors (hard failure vs today's wording; untouched result)
// ==================================================================================
console.log('--- Quick Mode: load errors ---');
{
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'emboss-leftovers-'));
  const badDocPath = path.join(tmpDir, 'bad.doc');
  writeFileSync(badDocPath, Buffer.from(badDocBytes()));
  const goodXmlPath = path.join(tmpDir, 'good.xml');
  writeFileSync(goodXmlPath, GOOD_XML);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  await page.setInputFiles('#fileInput', goodXmlPath);
  await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 20000 }).catch(() => {});
  const beforeResultHtml = await page.evaluate(() => document.getElementById('result').innerHTML);
  const beforeStatus = await page.evaluate(() => document.getElementById('status').textContent);

  await page.setInputFiles('#fileInput', badDocPath);
  await page.waitForFunction((prev) => document.getElementById('status').textContent !== prev, beforeStatus, { timeout: 20000 }).catch(() => {});
  const afterBad = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    cls: document.getElementById('status').className,
    resultHtml: document.getElementById('result').innerHTML,
  }));
  ok('Quick Mode hard failure: status is styled as an error', /\berr\b/.test(afterBad.cls), afterBad.cls);
  ok('Quick Mode hard failure: shows the reader\'s own plain message, no extra wrapping', !/Could not read that file:/i.test(afterBad.status) && /not a word document/i.test(afterBad.status), afterBad.status);
  ok('Quick Mode hard failure: the previous result is left untouched', afterBad.resultHtml === beforeResultHtml);

  // A non-hard failure keeps today's generic wording (proves the branch split goes both ways).
  const brokenOdtPath = path.join(tmpDir, 'broken.odt');
  writeFileSync(brokenOdtPath, Buffer.from(badOdtBytes()));
  await page.setInputFiles('#fileInput', brokenOdtPath);
  await page.waitForFunction((prev) => document.getElementById('status').textContent !== prev, afterBad.status, { timeout: 20000 }).catch(() => {});
  const afterBroken = await page.evaluate(() => document.getElementById('status').textContent);
  ok('Quick Mode non-hard failure: keeps the generic "Could not read that file:" wording', /Could not read that file:/i.test(afterBroken), afterBroken);

  ok('Quick Mode load-error checks: no page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 2. Editor: "Continue Item" — slash command + keyboard shortcut, save/export, help text
// ==================================================================================
console.log('--- Editor: Continue Item (multi-paragraph list items) ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' })); } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  const shortcut = process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter';

  async function freshOneItemList(itemText) {
    await page.evaluate(async (text) => {
      window.markDocumentClean();
      window.modelToLexical({ blocks: [{ type: 'list', ordered: false, items: [{ text }] }] });
      await window.render();
    }, itemText);
    await page.waitForFunction(() => document.querySelectorAll('#editor li').length > 0, null, { timeout: 10000 });
    // Put the caret at the end of the (only) item's text.
    await page.evaluate(() => {
      window.editor.update(() => {
        let n = window.editor.getEditorState()._nodeMap.get('root').getChildren()[0];
        while (n.getLastChild && n.getLastChild()) n = n.getLastChild();
        n.selectEnd();
      });
      window.editor.focus();
    });
  }

  // ---- keyboard shortcut: Ctrl/Cmd+Shift+Enter ----
  await freshOneItemList('First line of the item.');
  await page.keyboard.press('Enter');                          // blank new list line
  await page.keyboard.press(shortcut);                          // Continue Item: on
  await page.keyboard.type('A further paragraph, added with the shortcut.');
  let xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('shortcut: saves the further paragraph inside the item (<li>…<p>…</p></li>)',
    /<li[^>]*>First line of the item\.\s*<p>A further paragraph, added with the shortcut\.<\/p>\s*<\/li>/.test(xml), xml.match(/<li[^]*?<\/li>/)?.[0]);
  ok('shortcut: no console/page errors while typing', !errors.length, errors);

  // toggle back: the same shortcut on the continuation paragraph turns it back into a new item.
  await page.keyboard.press(shortcut);
  await page.keyboard.press('End');
  await page.keyboard.type(' Now a plain item.');
  xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('shortcut (toggle back): the paragraph becomes its own list item again, not nested',
    /<li[^>]*>First line of the item\.<\/li>\s*<li[^>]*>A further paragraph, added with the shortcut\. Now a plain item\.<\/li>/.test(xml), xml.match(/<li[^]*?<\/li>\s*<li[^]*?<\/li>/)?.[0]);

  // ---- slash menu: "/continue" ----
  errors.length = 0;
  await freshOneItemList('Second item text.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/continue');
  await page.waitForSelector('#slashList .slash-item', { timeout: 5000 });
  const offered = await page.$$eval('#slashList .slash-item', (els) => els.map((e) => e.id.replace('slash-opt-', '')));
  ok('slash menu: "/continue" (Continue Item) is offered on a blank new list line', offered.includes('continue'), offered);
  await page.keyboard.press('Enter');                            // run the highlighted match (continue is the only match)
  // executeCommand() runs the command's action() via a 10ms setTimeout (after clearing the "/continue"
  // query text) — typing immediately would race it, so wait for it to actually land first.
  await page.waitForTimeout(200);
  await page.keyboard.type('A further paragraph, added from the slash menu.');
  xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('slash command: saves the further paragraph inside the item',
    /<li[^>]*>Second item text\.\s*<p>A further paragraph, added from the slash menu\.<\/p>\s*<\/li>/.test(xml), xml.match(/<li[^]*?<\/li>/)?.[0]);
  ok('slash command: no console/page errors', !errors.length, errors);

  // ---- braille: the further paragraph is indented deeper than the item's own (runover) line ----
  // Braille text is contracted/translated (window.lastBrf is BANA ASCII BRF, not literal English),
  // so the continuation is identified by POSITION: it's whatever line(s) change once it's added.
  // Lines are compared UNFILTERED (blank lines kept) because a page-number footer near the
  // bottom of the page is itself non-blank, so filtering blank lines out would misidentify it as
  // part of the item's own (wrapped) text.
  const indentOf = (l) => l.length - l.replace(/^ +/, '').length;
  await freshOneItemList('An item with text long enough that it should reliably wrap onto a second braille line when the page is only forty cells wide, so there is a runover line to compare against.');
  await page.waitForFunction(() => typeof window.lastBrf === 'string', null, { timeout: 10000 });
  const beforeBrf = await page.evaluate(() => window.lastBrf);
  const beforeLines = beforeBrf.split(/\f/)[0].split(/\r\n|\n/);
  const itemLineCount = beforeLines.filter((l) => l.trim().length).length;
  ok('braille margin check setup: the long item wraps onto at least 2 lines', itemLineCount >= 2, beforeLines);
  await page.keyboard.press('Enter');
  await page.keyboard.press(shortcut);
  await page.keyboard.type('Further paragraph for the margin check.');
  await page.waitForFunction((prevLen) => (window.lastBrf || '').length !== prevLen, beforeBrf.length, { timeout: 10000 }).catch(() => {});
  const afterBrf = await page.evaluate(() => window.lastBrf);
  const afterLines = afterBrf.split(/\f/)[0].split(/\r\n|\n/);
  let firstDiff = 0;
  while (firstDiff < beforeLines.length && firstDiff < afterLines.length && beforeLines[firstDiff] === afterLines[firstDiff]) firstDiff++;
  const runoverLine = beforeLines[firstDiff - 1];
  const contLine = afterLines[firstDiff];
  ok('braille: adding the further paragraph changes the braille output', firstDiff < beforeLines.length || firstDiff < afterLines.length, { beforeLines, afterLines });
  ok('braille: the further paragraph starts deeper than the item\'s own runover margin (BANA 10.3.3: +2 cells)',
    !!runoverLine && !!contLine && indentOf(contLine) === indentOf(runoverLine) + 2,
    { runoverLine, contLine, runoverIndent: runoverLine && indentOf(runoverLine), contIndent: contLine && indentOf(contLine), beforeLines, afterLines });

  // ---- help: the feature is documented ----
  const helpHtml = await page.evaluate(() => document.getElementById('helpDialog').innerHTML);
  ok('help: documents "Continue Item"', /Continue Item/i.test(helpHtml), '');
  ok('help: documents the Ctrl/⌘+Shift+Enter shortcut', /Shift<\/kbd>\+<kbd>Enter/i.test(helpHtml) || /Shift.{0,10}Enter/i.test(helpHtml), '');

  await ctx.close();
}

await browser.close();
console.log(`\n=== editor leftovers [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All editor-leftovers checks passed.');
}
