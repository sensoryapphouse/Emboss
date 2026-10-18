// Feedback 30 Sep 2026, item 6 ("Paper size presets are confusing and seem wrong"; Paul, 1 Oct: fix all four, and choose the
// standard from the browser / machine on the very first run). In Quick Mode and the editor:
//  1. Quick Mode's header shows the page size really in use (it said 38×25 on a fresh start while the page was 38×27);
//  2. a BANA setup with no size of its own gets BANA's 38x25, and switching standard in the editor takes that standard's size;
//  3. US braille paper presets (11 × 11½ in: 38 × 25, 40 × 25) are offered, the current standard's sizes first;
//  4. the preset list shows the preset matching Cells × Lines, or "Custom size";
//  and on the very first run the standard follows the browser (en-US -> BANA, en-GB -> UKAAF) and is saved.
// Unit rules: tests/page_size_presets.test.mjs.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-page-size-presets.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
// a fresh browser profile with this language and time zone, optionally with saved settings
const open = async (path, { locale, timezoneId, seed } = {}) => {
  const ctx = await browser.newContext({ locale, timezoneId, viewport: { width: 1300, height: 900 } });
  if (seed) await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('pp-seed')) { sessionStorage.setItem('pp-seed', '1'); localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return { ctx, page, errors };
};
const setVal = (page, id, v) => page.evaluate(([i, val]) => { const el = document.getElementById(i); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);

// CHANGED 17 Oct 2026 (Paul, feedback item 9a): Quick Mode's Settings are the editor's, one shared markup, so its controls carry the editor's ids (set-cells, set-lines, set-pageSize ...); they were cells, lines, pageSize ...
const quick = (page) => page.evaluate(() => ({
  summary: document.getElementById('settingsSummary')?.textContent || '',
  cells: document.getElementById('set-cells').value, lines: document.getElementById('set-lines').value,
  preset: document.getElementById('set-pageSize').value,
  first: [...document.getElementById('set-pageSize').options].slice(1, 2).map((o) => o.value)[0],
  customLabel: document.getElementById('set-pageSize').options[0].textContent,
  saved: JSON.parse(localStorage.getItem('emboss-settings') || 'null'),
}));
const ed = (page) => page.evaluate(() => ({
  mode: document.getElementById('set-mode').value,
  cells: document.getElementById('set-cells').value, lines: document.getElementById('set-lines').value,
  preset: document.getElementById('set-pageSize').value,
  first: [...document.getElementById('set-pageSize').options].slice(1, 2).map((o) => o.value)[0],
  saved: JSON.parse(localStorage.getItem('emboss-settings') || 'null'),
}));
try {
  console.log('--- Quick Mode, first run, US English ---');
  let { ctx, page, errors } = await open('/web/index.html', { locale: 'en-US', timezoneId: 'America/New_York' });
  let q = await quick(page);
  ok('first run in US English: BANA, 38×25, and saved', q.saved && q.saved.mode === 'bana' && q.cells === '38' && q.lines === '25', q);
  ok('the header shows the size in use (BANA · Grade 2 · 38×25)', /BANA/.test(q.summary) && /38×25/.test(q.summary), q.summary);
  ok('the preset list shows "US braille paper 11 × 11½ in (38 × 25)", US sizes first', q.preset === 'us-38x25' && q.first === 'us-38x25', q);
  ok('the first entry is "Custom size"', q.customLabel === 'Custom size', q.customLabel);
  await setVal(page, 'set-pageSize', 'us-40x25');
  await page.waitForTimeout(300);
  q = await quick(page);
  ok('picking US 40 × 25 sets Cells 40, Lines 25, the header follows, and the list keeps showing it', q.cells === '40' && q.lines === '25' && /40×25/.test(q.summary) && q.preset === 'us-40x25', q);
  await setVal(page, 'set-cells', '33');
  await page.waitForTimeout(300);
  q = await quick(page);
  ok('a size that is no preset shows "Custom size"', q.preset === '' && /33×25/.test(q.summary), q);
  ok('no page errors (Quick Mode, US)', errors.length === 0, errors);
  await ctx.close();

  console.log('--- Quick Mode, first run, British English ---');
  ({ ctx, page, errors } = await open('/web/index.html', { locale: 'en-GB', timezoneId: 'Europe/London' }));
  q = await quick(page);
  ok('first run in British English: UKAAF, 38×27, UK sizes first', q.saved && q.saved.mode === 'ukaaf' && /UKAAF/.test(q.summary) && /38×27/.test(q.summary) && q.preset === 'uk-38x27' && q.first === 'uk-38x27', q);
  ok('no page errors (Quick Mode, UK)', errors.length === 0, errors);
  await ctx.close();

  console.log('--- Quick Mode, saved BANA without a page size ---');
  ({ ctx, page, errors } = await open('/web/index.html', { locale: 'en-GB', timezoneId: 'Europe/London', seed: { mode: 'bana', grade: 'g2', uiLanguage: 'en' } }));
  q = await quick(page);
  ok('a saved BANA setup with no size of its own is laid out at 38×25 (not the UK 38×27)', q.cells === '38' && q.lines === '25' && /BANA/.test(q.summary) && /38×25/.test(q.summary), q);
  await ctx.close();

  console.log('--- Editor ---');
  // as a user does: the first run is Quick Mode (Simple mode is on at install), then they switch to the editor
  ({ ctx, page, errors } = await open('/web/index.html', { locale: 'en-US', timezoneId: 'America/Chicago' }));
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('emboss-settings')); s.simpleMode = false; localStorage.setItem('emboss-settings', JSON.stringify(s)); });
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && !!document.getElementById('set-mode'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  let e = await ed(page);
  ok('editor, first run in US English: BANA, 38 × 25, US preset shown and first', e.mode === 'bana' && e.cells === '38' && e.lines === '25' && e.preset === 'us-38x25' && e.first === 'us-38x25', e);
  await setVal(page, 'set-mode', 'ukaaf');
  await page.waitForTimeout(500);
  e = await ed(page);
  ok('switching the standard to UKAAF takes UKAAF\'s 38 × 27, UK sizes first, and saves it', e.cells === '38' && e.lines === '27' && e.preset === 'uk-38x27' && e.first === 'uk-38x27' && e.saved.mode === 'ukaaf' && e.saved.lines === 27, e);
  await setVal(page, 'set-mode', 'bana');
  await page.waitForTimeout(500);
  e = await ed(page);
  ok('and back to BANA takes 38 × 25 again', e.cells === '38' && e.lines === '25' && e.preset === 'us-38x25', e);
  await setVal(page, 'set-pageSize', 'uk-28x27');
  await page.waitForTimeout(500);
  e = await ed(page);
  ok('picking UK A4 (28x27) in the editor sets the size and the list keeps showing it', e.cells === '28' && e.lines === '27' && e.preset === 'uk-28x27' && e.saved.cells === 28, e);
  ok('no page errors (editor)', errors.length === 0, errors);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(`\n=== Page size presets [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
