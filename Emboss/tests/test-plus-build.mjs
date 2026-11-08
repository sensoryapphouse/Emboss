// Emboss Plus was a second build (Paul, 16 Oct 2026, P1): https://emboss-plus.pages.dev, both pages marked <meta name="emboss-plus" content="1">, where a FIRST visit
// started with Transcriber tools on and Ctrl/Cmd+Shift+\ worked. ONE EMBOSS (Paul, 4 Nov 2026: EMBOSS-TASKS.md section P, P-Q C: emboss-plus is to be deleted when the
// one build ships): the marker means nothing now. A first visit on a page marked Plus starts like every other first visit - Transcriber tools OFF, the Title field
// hidden, no first-visit question - and a visitor's own choice of Transcriber tools is kept. (tests/test-beta-build.mjs is the fuller test of the one build.)
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-plus-build.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
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
// plus: simulate the old marker; saved: settings already in this browser (null = a first visit)
const open = async (plus, saved) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(({ plus, saved }) => {
    if (plus) window.EMBOSS_PLUS = true;
    try { if (!sessionStorage.getItem('pb')) { sessionStorage.setItem('pb', '1'); if (saved) localStorage.setItem('emboss-settings', JSON.stringify(saved)); else localStorage.removeItem('emboss-settings'); } } catch {}
  }, { plus, saved });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
};
const state = (page) => page.evaluate(() => {
  let saved = null; try { saved = JSON.parse(localStorage.getItem('emboss-settings') || 'null'); } catch {}
  const shown = (id) => { const f = document.getElementById(id)?.closest('.field'); return !!f && getComputedStyle(f).display !== 'none'; };
  return { tt: document.body.classList.contains('transcriber-tools'), savedTT: saved && saved.transcriberTools, title: (() => { const r = document.getElementById('docTitleRow'); return !!r && !r.hidden; })(), para: shown('set-paragraphStyle'), expert: document.body.classList.contains('expert-hardware') };
});
const pressHardware = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, shiftKey: true, bubbles: true })));

try {
  console.log(`--- a page marked Emboss Plus, a first visit (${ENGINE_LABEL}) ---`);
  let { ctx, page, errors } = await open(true, null);
  // a first visit lands in Quick Mode (the starting mode); then the user opens the editor
  await page.goto(BASE + '/web/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('emboss-settings')); st.simpleMode = false; localStorage.setItem('emboss-settings', JSON.stringify(st)); });
  await page.goto(BASE + '/web/editor/index.html', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  let s = await state(page);
  // Paul, 4 Nov 2026: one Emboss (EMBOSS-TASKS section P) - Plus's "Transcriber tools on at a first visit" is dropped
  ok('editor: Transcriber tools are OFF at a first visit, saved as off; no Title field, no transcriber settings', !s.tt && s.savedTT === false && !s.title && !s.para, s);
  await pressHardware(page); await page.waitForTimeout(300);
  ok('editor: Ctrl/Cmd+Shift+\\ does nothing (writing to devices is put aside; Paul, 4 Nov 2026)', !(await state(page)).expert);
  ok('editor: no page errors', errors.length === 0, errors);
  await ctx.close();

  ({ ctx, page, errors } = await open(true, null));
  await page.goto(BASE + '/web/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  s = await state(page);
  ok('Quick Mode, first visit: Transcriber tools off (its paragraph style setting is hidden)', !s.tt && s.savedTT === false && !s.para, s);
  ok('Quick Mode: no page errors', errors.length === 0, errors);
  await ctx.close();

  console.log(`--- a visitor who already chose (${ENGINE_LABEL}) ---`);
  ({ ctx, page, errors } = await open(true, { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', transcriberTools: true }));
  await page.goto(BASE + '/web/editor/index.html', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  s = await state(page);
  ok('a saved "Transcriber tools on" is kept, and the transcriber settings and Title field show', s.tt && s.savedTT === true && s.title && s.para, s);
  await ctx.close();
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }

await browser.close();
console.log(`\n=== Emboss Plus marker [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
