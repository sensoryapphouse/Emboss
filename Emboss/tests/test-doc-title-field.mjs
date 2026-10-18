// Feedback 30 Sep 2026, item 10 (Paul, 1 Oct: "yes"): "Some of the braille present in the braille view is not present in the print
// view and editable." With the tester's document (web/test_samples/nimas_comprehensive_structures_sample.xml, BANA), the two lines
// at the top of the braille were the document's title, from the file's details: nowhere in the text pane, and only changeable in
// Book details (a transcriber tool). Now:
//  - a "Title" field above the text shows the document's title and changes it: the braille title, the running heads and the save follow;
//  - with no title of its own, the field says the first heading is used;
//  - a click on a braille line Emboss adds (the title, a running head, a braille page number) explains it in the bar at the bottom;
//  - a title typed into the field is kept when the text is emptied; Clear starts a new document, title included.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-doc-title-field.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
// The Title field is shown here by its own setting: since Paul's decision of 7 Oct 2026 it is hidden unless Transcriber tools is on or
// "Show the Title field above the text" is ticked.
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('dtf')) { sessionStorage.setItem('dtf', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', showTitleField: true })); } } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const wait = (ms) => page.waitForTimeout(ms);
const brf = () => page.evaluate(() => window.lastBrf || '');
const settle = async () => { let prev = null; for (let k = 0; k < 20; k++) { await wait(300); const b = await brf(); if (b === prev) return b; prev = b; } return prev; };
const field = () => page.evaluate(() => { const f = document.getElementById('docTitleInput'); const l = f && document.querySelector(`label[for="${f.id}"]`); return f ? { value: f.value, placeholder: f.placeholder, label: l ? l.textContent : null, shown: f.getClientRects().length > 0 } : null; });
const clickRow = async (i) => { await page.evaluate((r) => { const row = document.querySelector(`#braille .brl-row[data-row="${r}"]`); row.scrollIntoView({ block: 'center' }); }, i); const box = await page.evaluate((r) => { const b = document.querySelector(`#braille .brl-row[data-row="${r}"]`).getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; }, i); await page.mouse.click(box.x, box.y); await wait(300); return page.evaluate(() => document.getElementById('statusBar').innerText); };
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await wait(1500);
  await page.evaluate(async () => { const txt = await (await fetch('/web/test_samples/nimas_comprehensive_structures_sample.xml')).text(); window.markDocumentClean(); await window.importFile(new File([txt], 'sample.xml', { type: 'text/xml' })); });
  let b = await settle();
  let f = await field();
  ok('a Title field above the text shows the document\'s title', !!f && f.shown && f.value === 'Comprehensive NIMAS Structural Showcase' && /Title/.test(f.label || ''), f);
  ok('the braille starts with that title (BANA, first page)', /^ +,COMPREH5SIVE ,,NIMAS/.test(b), b.split(/\r?\n/).slice(0, 3));
  // explain the lines Emboss adds
  let bar = await clickRow(0);
  ok('a click on the braille title explains it and where to change it', /Document title/.test(bar) && /Title field/.test(bar), bar);
  const lines = b.split(/\r?\n/);
  const footer = lines.findIndex((l, i) => i > 3 && /^ {20,}#A$/.test(l));
  bar = await clickRow(footer);
  ok('a click on a braille page number explains it', /Braille page number/.test(bar), { footer, bar });
  const head2 = lines.findIndex((l, i) => i > footer && /\S/.test(l));
  bar = await clickRow(head2);
  ok('a click on the next page\'s first line (print page number / running head) explains it', /print page number|Running head/i.test(bar), { head2, line: lines[head2], bar });
  // change the title
  await page.fill('#docTitleInput', 'My Book of Shapes');
  await page.keyboard.press('Tab');
  b = await settle();
  ok('the braille title follows the field', /^ +,MY ,BOOK \( ,%APES/.test(b) && !/COMPREH5SIVE/.test(b.split(/\r?\n/).slice(0, 3).join(' ')), b.split(/\r?\n/).slice(0, 3));
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('the save has the new title', /<doctitle>My Book of Shapes<\/doctitle>/.test(xml), (xml.match(/<doctitle>[^<]*<\/doctitle>/) || [])[0]);
  ok('the document is marked changed', await page.evaluate(() => window.isDocumentDirty()));
  // no title of its own
  await page.fill('#docTitleInput', '');
  await page.keyboard.press('Tab');
  await settle();
  f = await field();
  ok('with the field empty, it says the first heading is used', f.value === '' && /first heading/i.test(f.placeholder) && /Table of Contents/.test(f.placeholder), f);
  // a typed title survives emptying the text; Clear starts a new document
  await page.evaluate(() => { window.markDocumentClean(); document.getElementById('btnClear').click(); });
  await settle();
  ok('Clear empties the Title field', (await field()).value === '', await field());
  await page.fill('#docTitleInput', 'Typed Title');
  await page.keyboard.press('Tab');
  await page.click('#editor');
  await page.keyboard.type('Some words.');
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Other words.');
  b = await settle();
  ok('a title typed into the field is kept when the text is emptied', (await field()).value === 'Typed Title' && /,TYP\$ ,TITLE/.test(b), { field: await field(), top: b.split(/\r?\n/).slice(0, 2) });
  ok('no page errors', errors.length === 0, errors);
  // UKAAF (Paul, 2 Oct): the typed title goes in the running head, which starts on braille page 2, so in a one-page document the
  // braille does not change — the label says where the title goes, and the status says why nothing shows yet.
  ok('BANA: the label says the title is shown at the top of the braille', /shown at the top/i.test((await field()).label || ''), (await field()).label);
  {
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx2.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'ukaaf', grade: 'g2', uiLanguage: 'en', showTitleField: true })); } catch {} });
    const p2 = await ctx2.newPage();
    p2.on('dialog', (d) => d.accept());
    await p2.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await p2.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
    await p2.waitForTimeout(2500);
    const label = await p2.evaluate(() => document.querySelector('label[for="docTitleInput"]').textContent);
    ok('UKAAF: the label says the title is the running head from braille page 2', /running head/i.test(label) && /page 2/.test(label), label);
    const pages = await p2.evaluate(() => (window.lastBrf || '').split('\f').length);
    await p2.fill('#docTitleInput', 'My Test Title');
    await p2.press('#docTitleInput', 'Enter');
    await p2.waitForTimeout(1500);
    const said = await p2.evaluate(() => `${document.getElementById('docStats')?.textContent || ''} ${document.getElementById('announce')?.textContent || ''}`);
    ok(`UKAAF, a ${pages}-page document: after typing a title, the status says it will appear in the running head from page 2`, pages === 1 && /running head/i.test(said) && /page 2/.test(said), { pages, said });
    await ctx2.close();
  }
} finally {
  await browser.close();
}
console.log(`\n=== Document title field [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
