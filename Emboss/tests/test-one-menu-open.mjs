// Feedback 30 Sep 2026, item 16 (Paul, 2 Oct: "yes"): "Multiple dropdown styles that can be opened simultaneously" — the style list
// (the browser's own dropdown) and the Insert menu were open together in the tester's screenshot. Opening any one of the style
// list, Insert, the Braille menu or a title page's Field… menu now closes the others. (F9 C1, 9 Oct: the style list is now its own menu, #btnStyleMenu.)
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-one-menu-open.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('om')) { sessionStorage.setItem('om', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const open = () => page.evaluate(() => ({ insert: !document.getElementById('insertDropdown').hidden, braille: !document.getElementById('downloadMenu').hidden, style: !document.getElementById('styleDropdown').hidden }));
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Some text.' }] }); await window.render(); });
  await page.click('#editor');

  await page.click('#btnInsertMenu'); await page.waitForTimeout(200);
  ok('Insert opens', (await open()).insert);
  // F9 C1 (Paul, 9 Oct 2026): the style list is now a menu in the Insert menu's own look (the button #btnStyleMenu opens #styleDropdown); the
  // native <select id="blockStyle"> stays only as its hidden model. Item 16's rule is unchanged: opening the style list closes Insert.
  await page.click('#btnStyleMenu'); await page.waitForTimeout(200);
  ok('opening the style list closes Insert (the tester\'s screenshot)', !(await open()).insert && (await open()).style, await open());

  await page.click('#btnInsertMenu'); await page.waitForTimeout(200);
  ok('opening Insert closes the style list', (await open()).insert && !(await open()).style, await open());
  await page.focus('#btnStyleMenu'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
  ok('opening the style list from the keyboard closes Insert too', !(await open()).insert && (await open()).style, await open());
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok('Esc closes the style list', !(await open()).style, await open());

  await page.click('#btnInsertMenu'); await page.waitForTimeout(200);
  await page.click('#downloadBtn'); await page.waitForTimeout(200);
  let o = await open();
  ok('opening the Braille menu closes Insert', o.braille && !o.insert, o);
  await page.click('#btnInsertMenu'); await page.waitForTimeout(200);
  o = await open();
  ok('opening Insert closes the Braille menu', o.insert && !o.braille, o);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  o = await open();
  ok('Esc closes the open menu', !o.insert && !o.braille && !o.style, o);
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== One menu open [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
