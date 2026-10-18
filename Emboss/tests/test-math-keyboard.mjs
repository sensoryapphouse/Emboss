// The maths keyboard must not squeeze the text and braille panes away (Paul, 30 Sep 2026). Opening MathLive's
// virtual keyboard pads the page by its height; with the braille-rules band showing an equation's rules (several
// rows), the panes were left a few lines tall, or nothing on a small window. While the keyboard is open the band now
// keeps to about one row (editor.mjs watchMathKeyboard, body.math-keyboard-open in index.html).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-math-keyboard.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const URL = `http://localhost:${PORT}/web/editor/index.html`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`); }
};

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(() => {
  try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' })); } catch {}
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const measure = () => page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const mf = document.querySelector('math-field');
  return {
    open: document.body.classList.contains('math-keyboard-open'),
    visible: !!(window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible),
    panes: Math.round(r(document.getElementById('panesLayout')).height),
    band: Math.round(r(document.getElementById('statusBar')).height),
    fieldInView: (() => { const f = r(mf), p = r(document.getElementById('editor')); return f.bottom > p.top && f.top < p.bottom; })(),
  };
});

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && !!window.mathVirtualKeyboard, null, { timeout: 20000 });
  await page.waitForTimeout(1500);   // let the app's own start-up document finish loading first
  await page.evaluate(async () => {
    window.markDocumentClean();
    window.modelToLexical({ blocks: [
      { type: 'para', text: 'Before the equation.' },
      { type: 'math', latex: 'S_n=\\frac{n}{2}(2a+(n-1)d)=\\frac{n(a+a_n)}{2}' },
      { type: 'para', text: 'After the equation.' },
    ] });
    await window.render();
  });
  await page.waitForTimeout(800);
  const before = await measure();
  ok('keyboard starts closed', !before.visible && !before.open, before);

  await page.locator('math-field').first().click();
  await page.waitForTimeout(500);
  // Changed 17 Oct 2026 (Paul, feedback item 3b): MathLive's own keyboard toggle (a glyph that is not an Iconoir icon) is hidden; Emboss's own button, beside each
  // equation, opens and closes the same keyboard. And (item 7a) the explanation bar is hidden while the keyboard is open — so "the rules band keeps to one row" holds
  // as "there is no band at all".
  const toggle = page.locator('#editor .math-kb-btn').first();
  await toggle.click();
  await page.waitForTimeout(1200);
  const open = await measure();
  ok('the keyboard button opens the keyboard and the page knows it', open.visible && open.open, open);
  ok('the rules band keeps to about one row while it is open', open.band <= 60, open);
  ok('the text and braille panes keep real room (at least 200px) at 1280x720', open.panes >= 200, open);
  ok('the equation being edited stays in view', open.fieldInView, open);

  await toggle.click();
  await page.waitForTimeout(1000);
  const closed = await measure();
  ok('closing the keyboard clears the state', !closed.visible && !closed.open, closed);
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}

console.log(`\n=== Maths keyboard layout [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
