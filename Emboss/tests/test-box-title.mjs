// A89 (random-action testing, seed 1982326777, Chrome): Insert › Print page with the caret in the middle of a box's title split
// the box in two, each half keeping the old title ("Theoretical Focus & Case Study 1") beside its new first heading
// ("Theoretical" / "Focus & Case Study 1"). The braille showed both; a save writes the box's first heading as its title, so the
// reopened document's braille was different. In the editor a box's title IS its first heading (what the user sees and edits):
// the braille and the save now agree, and a split or edited title carries over.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-box-title.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const TITLE = 'Theoretical Focus and Case Study';
const BOX = [{ type: 'para', text: 'Before the box.' }, { type: 'box', title: TITLE, blocks: [{ type: 'heading', level: 2, text: TITLE }, { type: 'para', text: 'Inside the box.' }, { type: 'list', ordered: true, kind: 'exercise', style: 'exercise', items: [{ text: 'Derive it.', marker: '1.' }, { text: 'Evaluate it.', marker: '2.' }] }] }, { type: 'para', text: 'After the box.' }];
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'ukaaf', grade: 'g1', uiLanguage: 'en', transcriberTools: true })); } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const sameAfterSave = async () => {
    const first = await page.evaluate(async () => { await window.render(); return { brf: window.lastBrf, xml: window.exportCurrentDocumentXml() }; });
    const back = await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'saved.xml')); await window.render(); return window.lastBrf; }, first.xml);
    const body = (s) => s.split(/\r?\n/).filter((l) => !/BEFORE THE BOX|^\s*$/.test(l)).slice(1);   // the title line the save adds aside
    return { same: body(first.brf).join('\n') === body(back).join('\n'), first: body(first.brf).slice(0, 14), back: body(back).slice(0, 14) };
  };
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.exportCurrentDocumentXml === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    // the random-action case: the caret in the middle of the box's title, then Insert › Print page
    await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, BOX);
    await page.evaluate(() => {
      const h = document.querySelector('#editor aside h2, #editor .emboss-sidebar-card h2');
      const t = document.createTreeWalker(h, NodeFilter.SHOW_TEXT).nextNode();
      document.getElementById('editor').focus();
      const r = document.createRange(); r.setStart(t, t.data.indexOf('Focus')); r.collapse(true);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    await page.waitForTimeout(200);
    await page.click('#btnInsertMenu'); await page.click('#btnInsertPrintPage'); await page.waitForTimeout(600);
    await page.keyboard.press('Escape').catch(() => {});
    let r = await sameAfterSave();
    ok(`${engine}: a print page inserted in a box's title — the same braille after a save and reopen`, r.same, r);
    // and a title edited in place
    await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, BOX);
    await page.click('#editor aside h2, #editor .emboss-sidebar-card h2'); await page.keyboard.press('End'); await page.keyboard.type(' Two');
    await page.waitForTimeout(400);
    r = await sameAfterSave();
    ok(`${engine}: a box title edited in place — the same braille after a save and reopen, the old title gone`, r.same && !r.first.join(' ').includes('STUDY\n') && r.first.some((l) => /TWO/.test(l)), r);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Box title [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
