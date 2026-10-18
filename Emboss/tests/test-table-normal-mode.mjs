// Feedback 30 Sep 2026, item 5 (Paul, 1 Oct: hide it for the beta audience — TVIs, paraprofessionals, parents): with
// Transcriber tools off, a table's bar still showed braille formatting — the layout button (Auto / Spatial / Listed / … , the
// BANA §11 table layouts) and "⚙ Braille formatting", which opened the Braille formatting dialog. Paul decided on 25 Sep that the
// Layout dialog is a transcriber tool (the toolbar's Layout button is hidden and Ctrl/Cmd+Alt+B refuses while the setting is off);
// the table bar's two buttons had been missed. Now both are hidden with the setting off, the dialog itself refuses to open then,
// and a table keeps the layout it already has. With the setting on, nothing changes.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-table-normal-mode.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { try { if (!sessionStorage.getItem('tnm-init')) { sessionStorage.setItem('tnm-init', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} });
const page = await context.newPage();
const TABLE = { type: 'table', headers: ['Substance', 'Formula'], rows: [['Salt', 'NaCl'], ['Sugar', 'C12H22O11']], format: 'listed' };
const load = async () => { await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, [{ type: 'para', text: 'Before.' }, TABLE]); await wait(400); };
// the table bar's buttons, by role: the layout cycle (no dialog), Braille formatting (opens a dialog), + Row
const bar = () => page.evaluate(() => {
  const btns = [...document.querySelectorAll('.table-context-bar .table-context-btn')];
  const shown = (b) => !!b && b.getClientRects().length > 0;
  const layout = btns.find((b) => /Listed|Auto|Spatial/.test(b.textContent));
  const fmt = btns.find((b) => b.getAttribute('aria-haspopup') === 'dialog');
  const addRow = btns.find((b) => /Row/.test(b.textContent));
  return { layout: shown(layout), fmt: shown(fmt), addRow: shown(addRow), layoutExists: !!layout, fmtExists: !!fmt };
});
const setTools = async (on) => {
  const isOn = await page.evaluate(() => document.body.classList.contains('transcriber-tools'));
  if (isOn !== on) await page.evaluate(() => document.getElementById('set-transcriberTools').click());
  await wait(300);
};
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await setTools(false);
  await load();
  let b = await bar();
  ok('transcriber tools off: the table bar is there, with + Row', b.addRow, b);
  ok('transcriber tools off: the table layout button (Listed / Auto / …) is hidden', b.layoutExists && !b.layout, b);
  ok('transcriber tools off: "⚙ Braille formatting" is hidden on the table bar', b.fmtExists && !b.fmt, b);
  // the dialog itself refuses while the setting is off, whichever way it is reached
  const opened = await page.evaluate(() => { const btn = [...document.querySelectorAll('.table-context-bar .table-context-btn')].find((x) => x.getAttribute('aria-haspopup') === 'dialog'); btn.click(); return document.getElementById('brailleFmtDialog').open; });
  ok('transcriber tools off: the table\'s Braille formatting dialog does not open', !opened);
  ok('transcriber tools off: the table keeps the layout it has (Listed)', await page.evaluate(() => window.lastModel.blocks.some((x) => x.type === 'table' && x.format === 'listed')));
  // turned on: both are back and work
  await setTools(true);
  b = await bar();
  ok('transcriber tools on: the layout button and "⚙ Braille formatting" are shown', b.layout && b.fmt && b.addRow, b);
  await page.evaluate(() => [...document.querySelectorAll('.table-context-bar .table-context-btn')].find((x) => x.getAttribute('aria-haspopup') === 'dialog').click());
  await page.waitForSelector('#brailleFmtDialog[open]', { timeout: 3000 }).catch(() => {});
  ok('transcriber tools on: "⚙ Braille formatting" opens the dialog', await page.evaluate(() => document.getElementById('brailleFmtDialog').open));
  await page.evaluate(() => document.getElementById('brailleFmtDialog').close());
  // and off again: hidden again at once (no reload)
  await setTools(false);
  b = await bar();
  ok('turned off again: both are hidden again', !b.layout && !b.fmt && b.addRow, b);
} finally {
  await browser.close();
}
console.log(`\n=== Table bar in normal mode [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
