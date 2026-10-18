// A89 (random-action testing, seed 1982326777, WebKit): a Title Page with other blocks above it (pasted or moved there) was
// brailled where it stood, while a save always writes it first (BANA 2.2.1: the title page begins the book; nimas-export.mjs), so
// the reopened document's braille was different. The Title Page now stays the first block of the document in the editor too:
// whatever goes above it ends up just after it.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-titlepage-first.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'ukaaf', grade: 'g2', uiLanguage: 'en', transcriberTools: true })); } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const order = () => page.evaluate(() => (window.lastModel?.blocks || []).map((b) => b.type).slice(0, 4).join(','));
  const sameAfterSave = async () => {
    const first = await page.evaluate(async () => { await window.render(); return { brf: window.lastBrf, xml: window.exportCurrentDocumentXml() }; });
    const back = await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'saved.xml')); await window.render(); return window.lastBrf; }, first.xml);
    return { same: first.brf === back, first: first.brf.split(/\r?\n/).slice(0, 10), back: back.split(/\r?\n/).slice(0, 10) };
  };
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.exportCurrentDocumentXml === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ title: 'A Book', blocks: [{ type: 'para', text: 'Words above the title page.' }, { type: 'titlepage', matter: 'transcriber', auto: true }, { type: 'para', text: 'The body.' }] }); await window.render(); });
    ok(`${engine}: a Title Page with a paragraph above it comes first`, (await order()).startsWith('titlepage,para'), await order());
    let r = await sameAfterSave();
    ok(`${engine}: …and the braille is the same after a save and reopen`, r.same, r);
    // two Title Pages (a document that came in with two — a paste or a load; random-action testing, seed 1982326777, Firefox): one
    // is kept, first, as a save keeps one
    await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ title: 'A Book', blocks: [{ type: 'para', text: 'Words above.' }, { type: 'titlepage', matter: 'transcriber', auto: true }, { type: 'para', text: 'Between.' }, { type: 'titlepage', matter: 'transcriber', auto: true }, { type: 'para', text: 'The body.' }] }); await window.render(); });
    ok(`${engine}: two Title Pages — one is kept, first`, await page.evaluate(() => (window.lastModel?.blocks || []).filter((b) => b.type === 'titlepage').length === 1 && window.lastModel.blocks[0].type === 'titlepage'), await order());
    r = await sameAfterSave();
    ok(`${engine}: …and the braille is the same after a save and reopen`, r.same, r);

    // moving a paragraph up above it (Alt+Up)
    await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ title: 'A Book', blocks: [{ type: 'titlepage', matter: 'transcriber', auto: true }, { type: 'para', text: 'The body.' }] }); await window.render(); });
    await page.click('#editor p.ed-p >> nth=0'); await page.keyboard.press('Alt+ArrowUp'); await page.waitForTimeout(500);
    ok(`${engine}: a paragraph moved up past the Title Page leaves it first`, (await order()).startsWith('titlepage'), await order());
    r = await sameAfterSave();
    ok(`${engine}: …and the braille is the same after a save and reopen`, r.same, r);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Title Page first [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
