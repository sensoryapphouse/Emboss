// Feedback 30 Sep 2026, item 17 (Paul, 2 Oct: "yes"): "Unsure what this warning means as it only appears sometimes when moving to
// quick mode … Maybe linked to the recovery feature." Reproduced: type, the autosave backup is taken, the text is emptied, then
// ← Quick Mode asked "You have unsaved changes. Are you sure you want to exit without saving?" over a blank editor, and on coming
// back "Recover unsaved work?" offered the text deleted on purpose. Now an emptied document is nothing to recover (the autosave
// tick clears the backup; Undo still restores while the page is open), leaving for Quick Mode with an empty document asks
// nothing, and a document with text goes to Quick Mode and back as before (no question, no recovery offer).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-empty-doc-leave.mjs [port]
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
async function run(emptyFirst) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('ed')) { sessionStorage.setItem('ed', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Start.' }] }); await window.render(); window.markDocumentClean(); });
  await page.click('#editor'); await page.keyboard.press(`${MOD}+End`); await page.keyboard.type(' Some words I typed.');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__forceAutosaveTick());
  if (emptyFirst) {
    await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('Backspace'); await page.waitForTimeout(400);
    await page.evaluate(() => window.__forceAutosaveTick());
  }
  await page.click('#backToSimple');
  await page.waitForURL(/\/web\/index\.html/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const inQuick = /\/web\/index\.html/.test(page.url());
  await page.click('#advancedBtn').catch(() => {});
  await page.waitForURL(/editor/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const back = await page.evaluate(() => ({ recover: [...document.querySelectorAll('dialog[open]')].some((d) => /Recover unsaved work/.test(d.innerText)), text: document.getElementById('editor')?.innerText || '' }));
  await ctx.close();
  return { dialogs, inQuick, back, errors };
}
try {
  console.log('--- an emptied document (the tester\'s case) ---');
  let r = await run(true);
  ok('← Quick Mode asks nothing when the document is empty', r.dialogs.length === 0 && r.inQuick, r.dialogs);
  ok('coming back offers no recovery of the deleted text, and the editor is empty', !r.back.recover && !/Some words/.test(r.back.text), r.back);
  ok('no page errors (emptied)', r.errors.length === 0, r.errors);
  console.log('--- a document with text (unchanged) ---');
  r = await run(false);
  ok('← Quick Mode asks nothing and takes the document along', r.dialogs.length === 0 && r.inQuick, r.dialogs);
  ok('coming back brings the document, with no recovery offer', !r.back.recover && /Some words I typed/.test(r.back.text), r.back);
  ok('no page errors (with text)', r.errors.length === 0, r.errors);
} finally {
  await browser.close();
}
console.log(`\n=== Leaving an empty document [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
