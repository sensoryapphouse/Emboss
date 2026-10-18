// 18 Oct 2026 (Paul: "If the focus is not in the editing area then multiple Backspace sometimes gets confused about what to delete and
// delete the wrong thing"). After a click outside the text, three Backspaces must delete three characters before the caret the user
// left - or, after a click on a contents entry, act at that heading, where the caret now is:
//  - Bold with a plain caret inside a word bolds the word and puts the caret back (the word was left selected; the next Backspace deleted it);
//  - a click on the explanation bar or a blank part of the page: the focus comes back with the caret where it was (it came back at the
//    start of the document);
//  - a click on a contents entry puts the caret at that heading (it stayed behind, so Backspace acted off-screen).
// Backspace outside text fields is NOT blocked (Paul: it must still go "Back", e.g. in focus mode) - only with the focus on the page itself.
// Chrome and WebKit.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-backspace-focus.mjs [port]
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const B = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const docText = (page) => page.evaluate(() => [...document.querySelectorAll('#editor > *')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
const removed = (before, after) => {
  let a = 0; while (a < before.length && before[a] === after[a]) a++;
  let z = 0; while (z < before.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++;
  return { text: before.slice(a, before.length - z), before: before.slice(Math.max(0, a - 20), a) };
};
const browser = await launchBrowser();
async function run(label, act, expect) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('b')) { sessionStorage.setItem('b', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false })); } } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(B + '/web/editor/index.html'); await page.waitForTimeout(3500);
  // the caret inside the word "emphasised", after its "s" (…emphas|ised.)
  const w = page.locator('#editor').getByText('emphasised', { exact: false }).first();
  await w.click();
  await page.evaluate(() => {
    const walk = document.createTreeWalker(document.getElementById('editor'), NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) { const i = n.textContent.indexOf('emphasised'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 6); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; } }
  });
  await page.waitForTimeout(400);
  const before = await docText(page);
  await act(page); await page.waitForTimeout(700);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Backspace'); await page.waitForTimeout(300); }
  const r = removed(before, await docText(page));
  ok(`${label}: three Backspaces delete ${JSON.stringify(expect.text)}${expect.where ? ' ' + expect.where : ''}`, r.text === expect.text && (!expect.before || r.before.endsWith(expect.before)), r);
  await ctx.close();
}
try {
  const atCaret = { text: 'has', before: 'and this is emp', where: 'before the caret' };
  await run('the caret in the text (control)', async () => {}, atCaret);
  await run('after Bold with a plain caret inside a word', async (page) => { await page.click('#btnBold'); }, atCaret);
  await run('after a click on the explanation bar', async (page) => { await page.click('#statusBar'); }, atCaret);
  await run('after a click on a blank part of the page', async (page) => { await page.mouse.click(700, 40); }, atCaret);
  await run('after a click on the contents entry "A short list"', async (page) => { await page.locator('a[data-jump-block]').nth(1).click(); }, { text: 'd. | ', before: 'the other way roun', where: 'at that heading (joined to the paragraph above, as Backspace at a heading\'s start does)' });
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }
await browser.close();
console.log(`\n=== Backspace after a click outside the text [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
