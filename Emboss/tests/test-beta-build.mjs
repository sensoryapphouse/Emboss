// Feedback 30 Sep 2026, item 15 (Paul, 2 Oct: no separate codebase; a beta build setting; unlock with ?tools=1): a beta build
// (./deploy-emboss.sh --beta, which marks both pages with <meta name="emboss-beta" content="1">) shows only the everyday editor —
// the Transcriber tools switch is hidden and off, Ctrl/Cmd+Shift+\ (the hardware controls) does nothing, and the help lines that
// point to them are hidden. A link with ?tools=1 unlocks all of it on that computer (remembered); ?tools=0 locks it again.
// Without the marker nothing changes. Here the marker is simulated with window.EMBOSS_BETA, which the pages also honour.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-beta-build.mjs [port]
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
const open = async (beta, settings) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(({ beta, settings }) => { if (beta) window.EMBOSS_BETA = true; try { if (!sessionStorage.getItem('bb')) { sessionStorage.setItem('bb', '1'); localStorage.setItem('emboss-settings', JSON.stringify(settings)); } } catch {} }, { beta, settings });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
};
const state = (page) => page.evaluate(() => {
  const sw = document.getElementById('set-transcriberTools');
  const field = sw && sw.closest('.field');
  return {
    switchShown: !!field && !field.hidden && getComputedStyle(field).display !== 'none',   // in the (closed) Settings dialog: its own state, not on-screen
    tt: document.body.classList.contains('transcriber-tools'),
    expert: document.body.classList.contains('expert-hardware'),
    helpNote: [...document.querySelectorAll('#helpDialog .help-tt-off.help-note')].some((n) => getComputedStyle(n).display !== 'none'),
  };
});
const pressHardwareToggle = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, shiftKey: true, bubbles: true })));
const EDITOR = '/web/editor/index.html';
const SET_ON = { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', transcriberTools: true, expertHardware: true };
try {
  console.log('--- a beta build ---');
  let { ctx, page, errors } = await open(true, SET_ON);
  await page.goto(BASE + EDITOR, { waitUntil: 'load' }); await page.waitForTimeout(2000);
  let s = await state(page);
  ok('the Transcriber tools switch is hidden', !s.switchShown, s);
  ok('Transcriber tools is off even though the saved settings say on', !s.tt, s);
  ok('the hardware controls are off even though the saved settings say on', !s.expert, s);
  await pressHardwareToggle(page); await page.waitForTimeout(300);
  ok('Ctrl/Cmd+Shift+\\ does not turn the hardware controls on', !(await state(page)).expert);
  ok('the help note pointing to Transcriber tools is hidden', !s.helpNote, s);
  // item 15 (3): the settings a beta user does not need, hidden; the tab named for what it holds; plain labels
  const fields = (page, ids) => page.evaluate((ids) => Object.fromEntries(ids.map((id) => { const f = document.getElementById(id)?.closest('.field'); return [id, !!f && getComputedStyle(f).display !== 'none']; })), ids);
  const tabText = (page) => page.evaluate(() => { const b = document.querySelector('#settingsDialog .tab-btn[data-tab="tab-document"]'); return [...b.querySelectorAll('span')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent.trim()).join(' '); });
  let f = await fields(page, ['set-listStyle', 'set-tableFormat']);
  ok('beta: List Spacing and Default Table Layout are hidden', !f['set-listStyle'] && !f['set-tableFormat'], f);
  ok('beta: the settings tab is called "Page size"', (await tabText(page)) === 'Page size', await tabText(page));
  const labels = await page.evaluate(() => ({ code: document.querySelector('label[for="set-language"]').textContent.trim(), ascii: document.querySelector('[data-i18n="toolbar.toggle_brf"]').textContent.trim() }));
  ok('the braille code and BRF-letters labels are in plain words', labels.code === 'Braille code' && labels.ascii === 'Show braille as BRF letters instead of dots', labels);
  // unlock with ?tools=1, remembered
  await page.goto(BASE + EDITOR + '?tools=1', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  s = await state(page);
  ok('?tools=1 unlocks: the switch shows and the saved choices apply', s.switchShown && s.tt && s.expert, s);
  await page.goto(BASE + EDITOR, { waitUntil: 'load' }); await page.waitForTimeout(2000);
  ok('... and the unlock is remembered on this computer', (await state(page)).switchShown);
  await page.goto(BASE + EDITOR + '?tools=0', { waitUntil: 'load' }); await page.waitForTimeout(2000);
  s = await state(page);
  ok('?tools=0 locks it again', !s.switchShown && !s.tt && !s.expert, s);
  ok('no page errors (editor, beta)', errors.length === 0, errors);
  await ctx.close();

  console.log('--- Quick Mode in a beta build ---');
  ({ ctx, page, errors } = await open(true, { simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en' }));
  await page.goto(BASE + '/web/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  await pressHardwareToggle(page); await page.waitForTimeout(300);
  ok('in Quick Mode, Ctrl/Cmd+Shift+\\ does not show the Emboss button', !(await page.evaluate(() => document.body.classList.contains('expert-hardware'))));
  // 17 Oct 2026 (item 9a): Quick Mode's Settings carry the editor's ids (set-listStyle ...), not listStyle ...
  const qf = await page.evaluate(() => Object.fromEntries(['set-listStyle', 'set-tableFormat', 'set-includeCovers'].map((id) => { const fl = document.getElementById(id)?.closest('.field'); return [id, !!fl && getComputedStyle(fl).display !== 'none']; })));
  ok('Quick Mode beta: List Spacing, Default Table Layout and Volume Covers are hidden', !qf['set-listStyle'] && !qf['set-tableFormat'] && !qf['set-includeCovers'], qf);
  const ql = await page.evaluate(() => ({ simple: document.querySelector('[data-i18n="settings.simple_mode_label"]').textContent.trim(), code: document.querySelector('label[for="set-language"]').textContent.trim(), tab: [...document.querySelectorAll('#settingsDialog .tab-btn[data-tab="tab-document"] span')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent.trim()).join(' ') }));
  ok('Quick Mode: "Start in Quick Mode", "Braille code", and the tab "Page size"', ql.simple === 'Start in Quick Mode' && ql.code === 'Braille code' && ql.tab === 'Page size', ql);
  ok('no page errors (Quick Mode, beta)', errors.length === 0, errors);
  await ctx.close();

  console.log('--- an ordinary build is unchanged ---');
  ({ ctx, page, errors } = await open(false, SET_ON));
  await page.goto(BASE + EDITOR, { waitUntil: 'load' }); await page.waitForTimeout(2000);
  s = await state(page);
  ok('without the beta marker the switch shows and the saved choices apply', s.switchShown && s.tt && s.expert, s);
  const nf = await page.evaluate(() => ({ list: getComputedStyle(document.getElementById('set-listStyle').closest('.field')).display !== 'none', table: getComputedStyle(document.getElementById('set-tableFormat').closest('.field')).display !== 'none', tab: [...document.querySelectorAll('#settingsDialog .tab-btn[data-tab="tab-document"] span')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent.trim()).join(' ') }));
  ok('without the beta marker List Spacing and Table Layout show, and the tab is "Advanced Production"', nf.list && nf.table && nf.tab === 'Advanced Production', nf);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(`\n=== Beta build [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
