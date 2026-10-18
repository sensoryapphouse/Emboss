// Paul, 1 Oct 2026 (screenshot of the πr² explanation taking three lines): the explanation bar at the foot of the editor is capped
// at about two lines at its text size and scrolls beyond that, and the braille position "(B1: L6, C24)" sits at the end of the last
// line when there is room, not on a line of its own. A height the user has dragged the bar to still wins (the cap is in em, so it
// grows with the bar's text size), and the bar never takes more than 30% of the window.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-status-bar.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
// CHANGED 17 Oct 2026 (Paul, feedback item 7b): at 700 px wide or less (or 520 px high or less) the explanation bar is hidden altogether, by Translate's own rule, so the
// cap on its height is measured at 760 px, the narrowest width at which it is shown (tests/test-explanation-bar.mjs checks the hiding).
const measure = async ({ width, latex, scale = 1 }) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((sc) => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'ukaaf', grade: 'g2', uiLanguage: 'en', statusScale: sc })); } catch {} }, scale);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async (l) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', segments: [{ type: 'text', text: 'Area ' }, { type: 'math', latex: l }] }] }); await window.render(); }, latex);
  await page.waitForTimeout(800);
  const r = await page.evaluate((l) => {
    window.showRuleInfo('$' + l + '$');
    const ds = document.getElementById('docStats'); ds.textContent = '(B1: L6, C24)'; ds.style.display = 'inline-block';
    const sb = document.getElementById('statusBar');
    const pieces = [...document.querySelectorAll('#ruleInfoBody > *')];
    const top = (e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2);
    const em = parseFloat(getComputedStyle(sb).fontSize);
    return { h: sb.clientHeight, scrollH: sb.scrollHeight, overflowY: getComputedStyle(sb).overflowY, em, lastMid: top(pieces[pieces.length - 1]), dsMid: top(ds), vh: innerHeight };
  }, latex);
  await ctx.close();
  return { ...r, errors };
};
try {
  const a = await measure({ width: 1400, latex: '\\pi r^2' });
  ok('πr² at 1400 px: the bar is two lines high, not three (≤ 6.8 em + border)', a.h <= Math.ceil(6.8 * a.em) + 2 && a.scrollH <= a.h + 1, a);
  ok('πr² at 1400 px: the position sits at the end of the last line', Math.abs(a.dsMid - a.lastMid) <= 12, a);
  const b = await measure({ width: 760, latex: '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' });
  ok('a long explanation at 760 px: the bar stays at its cap', b.h <= Math.ceil(6.8 * b.em) + 2, b);
  ok('... and scrolls (more content than shows, overflow auto)', b.scrollH > b.h + 20 && b.overflowY === 'auto', b);
  const c = await measure({ width: 760, latex: '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', scale: 2 });
  ok('with the bar\'s text made larger (scale 2) the cap grows with it, but never past 30% of the window', c.h > b.h && c.h <= Math.ceil(0.3 * c.vh) + 2, { b: b.h, c });
  ok('no page errors', [...a.errors, ...b.errors, ...c.errors].length === 0, [...a.errors, ...b.errors, ...c.errors]);
} finally {
  await browser.close();
}
console.log(`\n=== Explanation bar size [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
