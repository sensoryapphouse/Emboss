// A89 step 3, found by random-action testing (scripts/monkey-test.mjs, seed 20261002, Chrome session 17): right after a file is
// loaded, the text pane can have the keyboard focus but no caret on the page (nothing was clicked); a paste then threw Lexical
// error #66 ("Expected node to have a parent") from inside its own insert — pasting formatted text at the very start of the first
// heading — and left the document half-changed (a stray empty paragraph). Lexical catches that itself and logs it (console.error,
// which cannot be prevented from outside); what matters is checked here: no uncaught page error, the pasted words are in the
// document, and nothing stray is left behind — Emboss puts the document back and pastes the plain text instead.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs). Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-paste-no-caret.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';
import { readFileSync } from 'node:fs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const FIXTURE = readFileSync(new URL('./fixtures/import-audit/html/h04-tables.html', import.meta.url), 'utf8');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const launch = () => launchBrowser({}, key);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g1', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const lexicalErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Lexical error/.test(m.text())) lexicalErrors.push(m.text().slice(0, 120)); });
  page.on('dialog', (d) => d.accept());
  const pasteWithoutClicking = (html, text) => page.evaluate(({ html, text }) => {
    const ed = document.getElementById('editor');
    ed.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', text); if (html) dt.setData('text/html', html);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    if (!ev.clipboardData || !ev.clipboardData.types.length) Object.defineProperty(ev, 'clipboardData', { value: dt });   // Firefox ignores clipboardData in the constructor
    ed.dispatchEvent(ev);
  }, { html, text });
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    for (const [label, html, text, expect] of [
      ['formatted text', '<p>Pasted <b>formatted</b> words</p>', 'Pasted formatted words', 'Pasted formatted words'],
      ['a table', '<table><tr><td>lonely</td></tr></table>', 'lonely', 'lonely'],
      ['plain text', '', 'Pasted plain words', 'Pasted plain words'],
    ]) {
      await page.evaluate(async (h) => { window.markDocumentClean(); await window.importFile(new File([h], 'h04-tables.html')); }, FIXTURE);
      await page.waitForTimeout(2500);
      const emptyBefore = await page.evaluate(() => [...document.querySelectorAll('#editor > p')].filter((e) => !e.textContent.trim() && !e.querySelector('img, math-field')).length);
      errors.length = 0; lexicalErrors.length = 0;
      await pasteWithoutClicking(html, text);
      await page.waitForTimeout(800);
      ok(`${engine}: pasting ${label} straight after loading a file, before clicking anything: no page error`, errors.length === 0, errors);
      ok(`${engine}: …the pasted ${label} is in the document`, await page.evaluate((x) => document.getElementById('editor').textContent.includes(x), expect));
      const emptyAfter = await page.evaluate(() => [...document.querySelectorAll('#editor > p')].filter((e) => !e.textContent.trim() && !e.querySelector('img, math-field')).length);
      ok(`${engine}: …and no stray empty paragraph is left behind`, emptyAfter <= emptyBefore, { emptyBefore, emptyAfter });
      ok(`${engine}: …and Lexical never failed (the paste went in whole, not by the plain-text fallback)`, lexicalErrors.length === 0, lexicalErrors);
      if (label === 'formatted text') ok(`${engine}: …and the formatting is kept (bold)`, await page.evaluate(() => [...document.querySelectorAll('#editor .ed-b, #editor strong, #editor b')].some((b) => /formatted/.test(b.textContent))));
    }
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Paste with no caret [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
