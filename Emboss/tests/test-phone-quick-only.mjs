// Paul, 18 Oct 2026: "If using phone only allow quick mode and hide advanced button." On a phone (the screen's shorter side under 500 points,
// in either orientation - settings.mjs isPhoneScreen; a narrow window on a computer is not a phone, and a tablet keeps the editor):
//  - Quick Mode has no Advanced Editor button, and Settings has no "Start in Quick Mode" choice;
//  - the editor's address goes straight to Quick Mode (with the document's hand-over hash, if any); "Start in Quick Mode" off does not send a
//    phone to the editor either.
// This replaces test-mobile-editor-notice.mjs (30 Sep item 12: a notice offering Quick Mode, with "Open the editor anyway").
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-phone-quick-only.mjs [port]
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
const PHONE = { viewport: { width: 375, height: 812 }, screen: { width: 375, height: 812 }, hasTouch: true };
const PHONE_LANDSCAPE = { viewport: { width: 812, height: 375 }, screen: { width: 812, height: 375 }, hasTouch: true };
const TABLET = { viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, hasTouch: true };
const NARROW_DESKTOP = { viewport: { width: 420, height: 800 }, screen: { width: 1920, height: 1080 } };
const open = async (device, path, simpleMode = true) => {
  const ctx = await browser.newContext(device);
  await ctx.addInitScript((sm) => { try { if (!sessionStorage.getItem('pq')) { sessionStorage.setItem('pq', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: sm, mode: 'bana' })); } } catch {} }, simpleMode);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  return { ctx, page, errors };
};
const shown = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; }, sel);
const onEditor = (page) => /\/editor\//.test(page.url());
try {
  for (const [label, dev] of [['a phone', PHONE], ['a phone on its side', PHONE_LANDSCAPE]]) {
    let { ctx, page, errors } = await open(dev, '/web/index.html');
    ok(`${label}: Quick Mode has no Advanced Editor button`, !(await shown(page, '#advancedBtn')));
    await page.click('#settingsBtn'); await page.waitForTimeout(400);
    await page.evaluate(() => { const t = [...document.querySelectorAll('#settingsDialog [role=tab], #settingsDialog .tab-btn')].find((b) => /interface/i.test(b.textContent)); t && t.click(); });
    await page.waitForTimeout(300);
    ok(`${label}: Settings has no "Start in Quick Mode" choice`, !(await shown(page, '#set-simpleMode')) && !(await page.evaluate(() => { const l = document.querySelector('label[for="set-simpleMode"]'); return !!l && l.getClientRects().length > 0; })));
    ok(`${label}: no page errors`, errors.length === 0, errors);
    await ctx.close();
    ({ ctx, page, errors } = await open(dev, '/web/editor/index.html#ha=test123'));
    ok(`${label}: the editor's address goes to Quick Mode, keeping the hand-over hash`, !onEditor(page) && /\/(web\/)?(index\.html)?#ha=test123$/.test(page.url()), page.url());
    await ctx.close();
    ({ ctx, page, errors } = await open(dev, '/web/index.html', false));
    ok(`${label}: with "Start in Quick Mode" off, the address still stays in Quick Mode`, !onEditor(page), page.url());
    await ctx.close();
  }
  for (const [label, dev] of [['a tablet', TABLET], ['a narrow window on a computer', NARROW_DESKTOP]]) {
    let { ctx, page } = await open(dev, '/web/index.html');
    ok(`${label}: Quick Mode has the Advanced Editor button`, await shown(page, '#advancedBtn'));
    await ctx.close();
    ({ ctx, page } = await open(dev, '/web/editor/index.html'));
    ok(`${label}: the editor opens`, onEditor(page) && (await page.evaluate(() => typeof window.modelToLexical === 'function' || !!document.getElementById('editor'))), page.url());
    await ctx.close();
  }
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }
await browser.close();
console.log(`\n=== Phone: Quick Mode only [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
