// Emboss Plus (Paul, 16 Oct 2026, P1): https://emboss-plus.pages.dev carries the full build, and both pages are marked
// <meta name="emboss-plus" content="1"> (build-dist.mjs, EMBOSS_PLUS=1). A FIRST visit (nothing saved) starts with Transcriber
// tools on; a visitor who has already chosen keeps their choice; the hardware controls' shortcut (Ctrl/Cmd+Shift+\) works, as in
// any non-beta build. Without the marker a first visit starts with Transcriber tools off, as before. The marker is simulated with
// window.EMBOSS_PLUS, which the pages also honour (web/settings.mjs isPlusBuild).
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
// plus: simulate the marker; saved: settings already in this browser (null = a first visit)
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
  return { tt: document.body.classList.contains('transcriber-tools'), savedTT: saved && saved.transcriberTools, title: (() => { const r = document.getElementById('docTitleRow'); return !!r && !r.hidden; })(), para: shown('set-paragraphStyle') || shown('paragraphStyle') };
});
const pressHardware = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, shiftKey: true, bubbles: true })));

try {
  console.log(`--- Emboss Plus, a first visit (${ENGINE_LABEL}) ---`);
  let { ctx, page, errors } = await open(true, null);
  // a first visit lands in Quick Mode (the starting mode); then the user opens the editor
  await page.goto(BASE + '/web/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('emboss-settings')); st.simpleMode = false; localStorage.setItem('emboss-settings', JSON.stringify(st)); });
  await page.goto(BASE + '/web/editor/index.html', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  let s = await state(page);
  ok('editor: Transcriber tools are on, saved as the starting choice, and the transcriber settings and Title field show', s.tt && s.savedTT === true && s.title && s.para, s);
  await pressHardware(page); await page.waitForTimeout(300);
  ok('editor: Ctrl/Cmd+Shift+\\ turns the hardware controls on (not locked as in a beta)', await page.evaluate(() => document.body.classList.contains('expert-hardware')));
  ok('editor: no page errors', errors.length === 0, errors);
  await ctx.close();

  ({ ctx, page, errors } = await open(true, null));
  await page.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}'); if (s.simpleMode === false) { s.simpleMode = true; localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} });
  await page.goto(BASE + '/web/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  s = await state(page);
  ok('Quick Mode, first visit: Transcriber tools on (its paragraph style setting shows)', s.tt && s.savedTT === true && s.para, s);
  ok('Quick Mode: no page errors', errors.length === 0, errors);
  await ctx.close();

  console.log(`--- Emboss Plus, a visitor who already chose (${ENGINE_LABEL}) ---`);
  ({ ctx, page, errors } = await open(true, { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', transcriberTools: false }));
  await page.goto(BASE + '/web/editor/index.html', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  s = await state(page);
  ok('a saved "Transcriber tools off" is kept: the Plus marker only sets the starting choice', !s.tt && s.savedTT === false, s);
  await ctx.close();

  console.log(`--- not Emboss Plus, a first visit (${ENGINE_LABEL}) ---`);
  ({ ctx, page, errors } = await open(false, null));
  await page.goto(BASE + '/web/editor/index.html', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  s = await state(page);
  ok('without the marker a first visit starts with Transcriber tools off, as before', !s.tt && !s.savedTT, s);
  await ctx.close();
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }

await browser.close();
console.log(`\n=== Emboss Plus [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
