// Feedback 30 Sep 2026, item 9 (Paul, 1 Oct: "Yes, go ahead"): "Cannot delete certain imported blocks e.g. images." A picture
// card had no Delete button (tables, tactile graphics, equations and page numbers each have one), and a click on a picture, a
// table or a tactile graphic did not select it, so Delete and Backspace did nothing for a mouse user. Now:
//  - the picture card has a "🗑 Delete" button (Undo brings the picture back);
//  - a click on a picture, a tactile graphic or a table's bar selects it (outlined); Delete or Backspace then works as from the
//    keyboard: the first press says what is selected, the second removes it (the 28 Sep protection against accidental deletes);
//  - a click in the picture's description box does not select the picture (typing there edits the description).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-picture-delete.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('pdl')) { sessionStorage.setItem('pdl', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => page.waitForTimeout(ms);
const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const types = () => page.evaluate(() => (window.lastModel?.blocks || []).map((b) => b.type).join(','));
const settle = async () => { let prev = null; for (let k = 0; k < 15; k++) { await wait(250); const t = await types(); if (t === prev) return t; prev = t; } return prev; };
const load = async (blocks) => { await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks); await wait(500); };
const clickAt = async (sel, dx = 12, dy = 8) => { const r = await page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top }; }, sel); await page.mouse.click(r.x + dx, r.y + dy); await wait(250); };
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await wait(1500);
  const PIC = [{ type: 'para', text: 'Before the picture.' }, { type: 'graphic', src: PNG, alt: 'A grey square' }, { type: 'para', text: 'After the picture.' }];

  console.log('--- the Delete button on the picture card ---');
  await load(PIC);
  const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('#editor .doc-image-block button')].find((x) => /Delete/.test(x.textContent)); return b ? { text: b.textContent, title: b.title } : null; });
  ok('the picture card has a Delete button', !!btn, btn);
  await page.evaluate(() => [...document.querySelectorAll('#editor .doc-image-block button')].find((x) => /Delete/.test(x.textContent)).click());
  ok('the button removes the picture and keeps the paragraphs around it', (await settle()) === 'para,para' && (await count('#editor .doc-image-block')) === 0, await types());
  await page.click('#editor'); await page.keyboard.press(`${MOD}+z`);
  ok('Undo brings it back', (await settle()) === 'para,graphic,para', await types());

  console.log('--- click the picture, then Delete twice ---');
  await load(PIC);
  await clickAt('#editor .doc-image-block');
  ok('a click on the picture outlines it as selected', await page.evaluate(() => !!document.querySelector('#editor .doc-image-block.emboss-selected, #editor .emboss-selected .doc-image-block, #editor .doc-image-block.emboss-armed')));
  await page.keyboard.press('Delete');
  await wait(300);
  ok('the first Delete keeps it and says it is selected', (await count('#editor .doc-image-block')) === 1 && /Picture selected/.test(await page.evaluate(() => document.getElementById('announce').textContent)), await page.evaluate(() => document.getElementById('announce').textContent));
  // Seen in the browser pane, 1 Oct: while a picture was selected the word highlight and the explanation bar jumped to the first
  // word of the document ("Before"), as if Delete would act there. Now the picture's own braille lines are the ones linked.
  const bar = await page.evaluate(() => document.getElementById('statusBar').innerText);
  ok('while it is selected, the explanation bar does not explain a word elsewhere ("Before")', !/Before/.test(bar), bar);
  await page.keyboard.press('Delete');
  ok('the second Delete removes it', (await settle()) === 'para,para', await types());
  await page.click('#editor'); await page.keyboard.press(`${MOD}+z`);
  ok('Undo brings it back', (await settle()) === 'para,graphic,para', await types());

  console.log('--- click the picture, then Backspace twice ---');
  await load(PIC);
  await clickAt('#editor .doc-image-block');
  await page.keyboard.press('Backspace'); await wait(300);
  await page.keyboard.press('Backspace');
  ok('Backspace twice removes it too', (await settle()) === 'para,para', await types());

  console.log('--- a selected picture does not swallow navigation and typing ---');
  await load(PIC);
  await clickAt('#editor .doc-image-block');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.type(' Typed');
  await settle();
  ok('click a picture, then Cmd/Ctrl+End and type: the text goes at the end of the document', await page.evaluate(() => /After the picture\. ?Typed$/.test(window.lastModel.blocks[window.lastModel.blocks.length - 1].text || '')), await page.evaluate(() => window.lastModel.blocks.map((b) => b.text || b.type)));

  console.log('--- a click in the description box does not select the picture ---');
  await load(PIC);
  await page.click('#editor .doc-image-block textarea.doc-image-alt');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Tab');
  ok('Backspace / Delete in the box edit the description, the picture stays', (await settle()) === 'para,graphic,para' && (await page.evaluate(() => window.lastModel.blocks[1].alt)) === 'A grey squar', await page.evaluate(() => window.lastModel.blocks[1]));

  console.log('--- a table: click its bar, Delete twice ---');
  await load([{ type: 'para', text: 'Before the table.' }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }, { type: 'para', text: 'After the table.' }]);
  await clickAt('#editor .table-context-bar strong', 4, 6);
  await page.keyboard.press('Delete'); await wait(300);
  ok('the first Delete keeps the table', (await types()) === 'para,table,para', await types());
  await page.keyboard.press('Delete');
  ok('the second Delete removes it', (await settle()) === 'para,para', await types());

  console.log('--- an imported Word file (w13-images.docx) ---');
  await page.evaluate(() => window.markDocumentClean());
  await page.setInputFiles('#loadFileInput', path.join(HERE, 'fixtures', 'import-audit', 'docx', 'w13-images.docx'));
  await wait(4500);
  const before = await count('#editor .doc-image-block');
  await clickAt('#editor .doc-image-block');
  await page.keyboard.press('Delete'); await wait(300); await page.keyboard.press('Delete'); await wait(800);
  ok('an imported picture can be deleted by click + Delete twice', before > 0 && (await count('#editor .doc-image-block')) === before - 1, { before, after: await count('#editor .doc-image-block') });
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== Picture delete [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
