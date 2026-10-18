// Feedback 30 Sep 2026, item 13 (Paul, 1 Oct: "yes"): "Is NIMAS Package a relevant export?" NIMAS stays the save format (it is how
// a document is reopened with its styles and choices, and a standard DAISY format), but the Braille menu's "NIMAS package (.zip)" —
// not braille, and the same file Save makes — is a transcriber tool, hidden while Transcriber tools is off; Save's tooltip says
// what it is for in plain words.
// Paul, 18 Oct 2026: "it should be hidden" - the NIMAS package is no longer offered at all, Transcriber tools on or off (so not in
// Emboss Plus either, where Transcriber tools is on); the expectation below changed from "offered" to "not offered". Save is unchanged.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-nimas-menu.mjs [port]
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
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('nm')) { sessionStorage.setItem('nm', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const menu = () => page.evaluate(() => [...document.querySelectorAll('#downloadMenu .menu-dropdown-item')].filter((b) => b.getClientRects().length > 0).map((b) => b.textContent.trim()));
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Some text.' }] }); await window.render(); });
  await page.click('#downloadBtn');
  await page.waitForTimeout(300);
  let items = await menu();
  ok('with Transcriber tools off the Braille menu has no NIMAS package', items.length >= 2 && !items.some((t) => /NIMAS/.test(t)), items);
  ok('... and still has BRF and eBraille', items.some((t) => /BRF/.test(t)) && items.some((t) => /eBraille/.test(t)), items);
  const title = await page.evaluate(() => document.getElementById('saveDocBtn').title);
  ok('Save\'s tooltip says what it is for, without "NIMAS"', /open again in Emboss/.test(title) && !/NIMAS/.test(title), title);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('set-transcriberTools').click());
  await page.waitForTimeout(300);
  await page.click('#downloadBtn');
  await page.waitForTimeout(300);
  items = await menu();
  ok('with Transcriber tools on (as in Emboss Plus), still no NIMAS package (Paul, 18 Oct)', items.length >= 2 && !items.some((t) => /NIMAS/.test(t)), items);
  await page.keyboard.press('Escape');
  const helpLine = await page.evaluate(() => [...document.querySelectorAll('#helpDialog li, dialog li')].filter((li) => li.getClientRects().length > 0 || getComputedStyle(li).display !== 'none').some((li) => /^\s*NIMAS package\b/.test(li.textContent)));   // the Export menu's own entry (Help still says Save makes a package for a document with pictures)
  ok('... and Help\'s list of Export choices has no NIMAS package', !helpLine, helpLine);
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== NIMAS menu [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
