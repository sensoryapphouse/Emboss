// Going back from the editor to Quick Mode takes the document with it (Paul, 26 Sep 2026: "going
// back to simple mode after an edit is asking questions even though I am still on the same
// document"). The editor hands its document to Quick Mode through the same IndexedDB handoff Quick
// Mode uses to open a file in the editor, so there is no "unsaved changes" question and no
// browser "Leave site?" prompt; Quick Mode opens the edited document; and because the edits were
// never saved to a file, they stay marked unsaved in both directions.
//
// Usage: node Emboss/tests/test-quickmode-return.mjs [port]   (needs Emboss/scripts/serve.mjs)
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
    if (!sessionStorage.getItem('qm-test-init')) {
      sessionStorage.setItem('qm-test-init', '1');
      localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' }));
    }
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(`${d.type()}: ${d.message()}`); await d.dismiss(); });

console.log('--- editor → Quick Mode keeps the edited document ---');
await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
const marker = 'Quick Mode return test paragraph';
await page.evaluate(async (text) => {
  window.modelToLexical({ title: 'Return Test', blocks: [{ type: 'heading', level: 1, text: 'Return Test' }, { type: 'para', text: 'Original paragraph.' }] });
  await window.render();
  window.markDocumentClean();
  // An edit, as a user would make: a new paragraph with the marker text.
  window.modelToLexical({ title: 'Return Test', blocks: [{ type: 'heading', level: 1, text: 'Return Test' }, { type: 'para', text: 'Original paragraph.' }, { type: 'para', text }] });
  await window.render();
}, marker);
ok('setup: the edited document is unsaved', await page.evaluate(() => window.isDocumentDirty()) === true);

await Promise.all([page.waitForURL(/\/web\/index\.html/, { timeout: 30000 }), page.click('#backToSimple')]);
ok('no question and no Leave-site prompt on the way to Quick Mode', dialogs.length === 0, dialogs);
await page.waitForFunction(() => !document.getElementById('result')?.hidden && (document.getElementById('preview')?.textContent || '').length > 0, null, { timeout: 60000 });
const quick = await page.evaluate(() => ({ name: document.getElementById('fileName')?.textContent || '', preview: document.getElementById('preview')?.textContent || '' }));
ok('Quick Mode opens the document from the editor (its title shown)', quick.name.includes('Return Test'), quick.name);
ok('Quick Mode brailles the edited text (",qk ,mode return")', quick.preview.includes('⠠⠟⠅⠀⠠⠍⠕⠙⠑⠀⠗⠑⠞⠥⠗⠝') || /,QK ,MODE RETURN/.test(quick.preview), quick.preview.slice(0, 200));

console.log('--- the unsaved edits stay guarded ---');
const guarded = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
ok('closing Quick Mode now asks first (the edits were never saved to a file)', guarded === true);

console.log('--- Quick Mode → editor brings the unsaved flag back ---');
await Promise.all([page.waitForURL(/\/web\/editor\/index\.html/, { timeout: 30000 }), page.evaluate(() => {
  // A89: click() returns undefined, so the old `advancedBtn?.click() ?? (simple-mode switch)` ran BOTH, and the app navigated
  // twice; Chrome let the second navigation win quietly, WebKit ("Navigation canceled by policy check") and Firefox
  // (NS_BINDING_ABORTED) fail the first one. The switch is only the fallback when the button is missing.
  const b = document.getElementById('advancedBtn');
  if (b) { b.click(); return; }
  const sm = document.getElementById('simpleMode');
  if (sm) { sm.checked = false; sm.dispatchEvent(new Event('change')); }
})]);
await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0 && typeof window.isDocumentDirty === 'function', null, { timeout: 60000 });
await page.waitForTimeout(300);
const back = await page.evaluate(() => ({ xml: window.exportCurrentDocumentXml(), dirty: window.isDocumentDirty(), recoverDialog: !!document.getElementById('autosaveRecoverDialog') }));
ok('the editor reopens the same edited document', back.xml.includes('Quick Mode return test paragraph'), back.xml.slice(0, 200));
ok('it is still marked unsaved', back.dirty === true, back.dirty);
ok('no crash-recovery prompt on a handoff', back.recoverDialog === false);
ok('no dialogs on the way back to the editor', dialogs.length === 0, dialogs);
ok('no page errors', errors.length === 0, errors);

// Leave the browser storage tidy for the next run.
await page.evaluate(() => { window.markDocumentClean(); return window.__clearAutosaveSnapshot && window.__clearAutosaveSnapshot(); });
await browser.close();
console.log(`\n=== quickmode-return [${ENGINE_LABEL}]: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
