// Batch S5d, item S2-Q1 (Paul, 15 Oct 2026: "every other Save format reads the live document", part of E2): the editor's alternative saves
// (plain text, Markdown, HTML, Word, native JSON; none is in a menu yet) were built from lastModel, the model of the LAST RENDER, which is
// 200 ms and more behind the typing. They now read the document as it is this instant, as the NIMAS save does, after the picture
// descriptions still being typed are put into it.
//
// The saves are reached through the test hook window.__embossTestSaveAs(format) (the same exportTextDocument the Save button calls).
//   - a word typed and saved at once is in every format (the precondition is checked: lastModel does not have it yet);
//   - a picture description still being typed (the box not left) is in every format;
//   - a title typed in the Title field names the saved file and is in the document.
//
// Chrome by default (EMBOSS_ENGINE=webkit|firefox for another engine; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8214 &   then   node Emboss/tests/test-s5d-live-save.mjs [port]
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';
import { readZip } from './helpers/zip-read.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAGklEQVR4nGO4o6FBFcQwatCoQaMGjRpEGQIA3r3CEG0ftIUAAAAASUVORK5CYII=';
const FORMATS = ['txt', 'md', 'html', 'docx', 'json'];
const URL_ = `http://localhost:${PORT}/web/editor/index.html`;

async function readDownload(dl) {
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  return Buffer.concat(chunks);
}
// text of a saved file: the document part for a Word file
const textOf = (format, buf) => (format === 'docx' ? readZip(buf).get('word/document.xml').toString('utf8') : buf.toString('utf8'));
async function saveAs(page, format) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.evaluate((f) => window.__embossTestSaveAs(f), format)]);
  const buf = await readDownload(dl);
  return { name: dl.suggestedFilename(), buf, text: textOf(format, buf) };
}
async function fresh(browser, extraSettings = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((extra) => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', ...extra })); } catch { /* none */ } }, extraSettings);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.__embossTestSaveAs === 'function' && window.lastBrf !== undefined, null, { timeout: 60000 });
  await sleep(800);
  return { ctx, page, errors };
}
async function load(page, blocks) {
  await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ title: 'Live Save Test', blocks: b }); await window.render(); }, blocks);
  await sleep(600);
}

for (const key of (ENGINE_SET ? [ENGINE] : [ENGINES[0]])) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  try {
    // ---- 1. a word typed and saved at once --------------------------------------------------------------------------------
    {
      const { ctx, page, errors } = await fresh(browser);
      await load(page, [{ type: 'heading', level: 1, text: 'A heading' }, { type: 'para', text: 'First paragraph.' }, { type: 'para', text: 'Second paragraph.' }]);
      for (const format of FORMATS) {
        const marker = `EDIT${format.toUpperCase()}ZQ`;
        await page.click('#editor p >> nth=0');
        await page.keyboard.press('End');
        await page.keyboard.type(' ' + marker);
        // saved at once: the last render (lastModel) has not seen the word yet
        const stale = await page.evaluate((m) => !JSON.stringify(window.lastModel || {}).includes(m), marker);
        const out = await saveAs(page, format);
        ok(`${engine} ${format}: the test is meaningful - the last render did not have the word yet`, stale);
        ok(`${engine} ${format}: a word typed just before the save is in the file`, out.text.includes(marker), out.text.slice(0, 300));
        ok(`${engine} ${format}: the file has the right extension`, out.name.endsWith('.' + format), out.name);
        await sleep(450);   // let the render catch up before the next format's edit
      }
      ok(`${engine}: no script error`, errors.length === 0, errors);
      await page.evaluate(() => window.markDocumentClean());
      await ctx.close();
    }

    // ---- 2. a picture description still being typed ----------------------------------------------------------------------
    {
      const { ctx, page, errors } = await fresh(browser);
      await load(page, [{ type: 'para', text: 'Before the picture.' }, { type: 'graphic', src: PNG, alt: 'ORIGINAL DESCRIPTION' }, { type: 'para', text: 'After it.' }]);
      await page.evaluate(() => window.markDocumentClean());
      await page.click('#editor .doc-image-block textarea.doc-image-alt');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      const MARKER = 'DESCRIBED WHILE TYPING';
      await page.keyboard.type(MARKER);
      ok(`${engine}: setup - the box still has the focus`, await page.evaluate(() => document.activeElement?.classList.contains('doc-image-alt')));
      for (const format of FORMATS) {
        const out = await saveAs(page, format);
        ok(`${engine} ${format}: a picture description still being typed is in the file`, out.text.includes(MARKER) && (format === 'json' || !out.text.includes('ORIGINAL DESCRIPTION')), out.text.slice(out.text.indexOf('DESC') - 40, out.text.indexOf('DESC') + 80));
      }
      // a Word file carries the picture itself, with the description as its alt text
      const w = await saveAs(page, 'docx');
      ok(`${engine} docx: the picture is embedded and its alt text is the description`, readZip(w.buf).has('word/media/image1.png') && /descr="DESCRIBED WHILE TYPING"/.test(w.text));
      const after = await page.evaluate(() => ({ dirty: window.isDocumentDirty(), focus: document.activeElement?.className || document.activeElement?.tagName, value: document.querySelector('#editor .doc-image-block textarea.doc-image-alt')?.value }));
      ok(`${engine}: saving a derived format leaves the document unsaved`, after.dirty === true, after);
      ok(`${engine}: ... and the description box holds what was typed`, after.value === MARKER, after);
      ok(`${engine}: no script error`, errors.length === 0, errors);
      await page.evaluate(() => window.markDocumentClean());
      await ctx.close();
    }

    // ---- 3. a title typed in the Title field ---------------------------------------------------------------------------
    {
      const { ctx, page, errors } = await fresh(browser, { transcriberTools: true });   // the Title field is a Transcriber tool
      await load(page, [{ type: 'heading', level: 1, text: 'Some heading' }, { type: 'para', text: 'A paragraph.' }]);
      const hasField = await page.evaluate(() => !!document.getElementById('docTitleInput') && !document.getElementById('docTitleRow')?.hidden);
      if (hasField) {
        await page.fill('#docTitleInput', 'My New Title');
        await page.keyboard.press('Tab');                        // the field commits on change
        const out = await saveAs(page, 'md');
        ok(`${engine} md: a title typed just before the save names the file`, out.name === 'my-new-title.md', out.name);
        ok(`${engine} md: ... and is in the document`, /title: My New Title|# My New Title/.test(out.text), out.text.slice(0, 200));
      } else console.log(`  (the Title field is hidden here: its check is skipped)`);
      ok(`${engine}: no script error`, errors.length === 0, errors);
      await page.evaluate(() => window.markDocumentClean());
      await ctx.close();
    }
  } finally { await browser.close(); }
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
