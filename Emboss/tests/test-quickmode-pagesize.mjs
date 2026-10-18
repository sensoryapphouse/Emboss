// A75/UK-7 (28 Sep, James / decisions.md "UKAAF"): the UK page-size presets (settings.mjs
// UK_PAGE_SIZE_PRESETS) were added to the editor's Settings dialog (#set-pageSize,
// editor/index.html + editor.mjs) but Quick Mode (web/index.html, web/app.mjs) only had the
// plain Cells/Lines fields. Quick Mode now has the same "Page size preset" select
// (#pageSize), wired the same way the editor's own is: picking a preset fills Cells/Lines
// (and nothing else — "Always let the user choose", James), then the document re-transcribes.
//
// Usage: node Emboss/tests/test-quickmode-pagesize.mjs [port]   (needs Emboss/scripts/serve.mjs)
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); } else { fail++; console.log(`  ✖ FAIL  ${name}${detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 300) : ''}`); }
};

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana', grade: 'g2', cells: 38, lines: 25, uiLanguage: 'en' }));
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('--- Quick Mode: page size preset select ---');
await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
await page.waitForSelector('#settingsBtn', { timeout: 30000 });

// CHANGED 17 Oct 2026 (Paul, feedback item 9a): Quick Mode's Settings are the editor's, one shared markup, so its controls carry the editor's ids (set-cells, set-lines, set-pageSize ...); they were cells, lines, pageSize ...
const hasSelect = await page.evaluate(() => !!document.getElementById('set-pageSize'));
ok('the #set-pageSize preset select exists in Quick Mode', hasSelect);

// Open the settings dialog and switch to the Page Geometry tab, same as a user would.
await page.click('#settingsBtn');
await page.waitForSelector('#settingsDialog[open]', { timeout: 10000 }).catch(() => {});
await page.click('.tab-btn[data-tab="tab-document"]');
await page.waitForSelector('#tab-document.settings-panel', { timeout: 10000 });

const before = await page.evaluate(() => ({ cells: document.getElementById('set-cells').value, lines: document.getElementById('set-lines').value }));
ok('starts at the plain BANA default (38x25), not a UK preset', before.cells === '38' && before.lines === '25', before);

// UK 12in paper (40x27): distinct from the starting 38x25 in BOTH fields, so this proves the
// preset drove the change rather than a coincidental default.
await page.selectOption('#set-pageSize', 'uk-40x27');
await page.waitForTimeout(150);
const after40x27 = await page.evaluate(() => ({ cells: document.getElementById('set-cells').value, lines: document.getElementById('set-lines').value }));
ok('selecting "UK 12in paper (40x27)" sets Cells=40, Lines=27', after40x27.cells === '40' && after40x27.lines === '27', after40x27);

// UK A4 (28x27): a second, different preset, to prove each selection is read fresh.
await page.selectOption('#set-pageSize', 'uk-28x27');
await page.waitForTimeout(150);
const afterA4 = await page.evaluate(() => ({ cells: document.getElementById('set-cells').value, lines: document.getElementById('set-lines').value }));
ok('selecting "UK A4 (28x27)" sets Cells=28, Lines=27', afterA4.cells === '28' && afterA4.lines === '27', afterA4);

// The resulting cells/lines are persisted immediately (same field, same persistSettings()
// path the plain Cells/Lines inputs already use) — it is Cells/Lines themselves that are the
// persisted state ("Always let the user choose", James: the preset selector is a convenience,
// not itself remembered as a separate setting).
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings') || '{}'));
ok('the resulting cells/lines were persisted to settings', persisted.cells === 28 && persisted.lines === 27, persisted);

ok('no page errors', errors.length === 0, errors);
await browser.close();
console.log(`\n=== quickmode-pagesize [${ENGINE_LABEL}]: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
