// Feedback 30 Sep 2026, item 19: "in Safari, arrow-down gets stuck at blocks with equations" (screenshot: the caret on the last
// line of "Mathematical expressions are encoded…", which holds two equations). Reproduced, 2 Oct: in WebKit (Safari's engine)
// the Down key cannot leave any line that holds an equation (a MathLive <math-field>), even with a plain paragraph next; in
// Chrome it can, but from that paragraph with a ⁂ break and a print page after it, Chrome's caret jumped to the footnotes at
// the end of the book. Now Up/Down off the first/last line of a paragraph with an equation is Emboss's own: the caret goes to
// the next (previous) paragraph, at the same distance across, or selects a ⁂ break / print page there (as a click does since
// item 9), from which the next Down goes on below it. Inside the paragraph, and everywhere else, the browser moves the caret.
//
// Runs in Chrome, WebKit and Firefox (A89: all three when EMBOSS_ENGINE is not set; only that one when it is, as run-browser-suites.mjs does). Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-arrow-past-equations.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const M = (s) => `<math><mi>${s}</mi><mo>+</mo><mi>b</mi></math>`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  // where the caret is: "<top-level block index>" or "sel:<class>" when a block is selected as a whole
  const where = () => page.evaluate(() => {
    const picked = document.querySelector('#editor .emboss-selected');
    if (picked) return `sel:${picked.className.split(' ')[0]}`;
    // in an equation: Firefox's document selection does not follow the focus into the equation's field
    const mf = document.activeElement?.closest?.('#editor math-field');
    if (mf) return String([...document.querySelectorAll('#editor > *')].indexOf(mf.closest('#editor > *')));
    const s = getSelection(); const n = s.anchorNode;
    const blk = (n && (n.nodeType === 1 ? n : n.parentElement))?.closest?.('#editor > *');
    return String([...document.querySelectorAll('#editor > *')].indexOf(blk));
  });
  const load = async (html) => {
    await page.evaluate(async (h) => { window.markDocumentClean(); await window.importFile(new File([`<html><body>${h}</body></html>`], 't.html')); }, html);
    await page.waitForFunction(() => document.querySelector('#editor math-field'), null, { timeout: 20000 });
    await page.waitForTimeout(800);
  };
  // caret at the start (or end) of top-level block i
  const caretIn = (i, atEnd = false) => page.evaluate(({ i, atEnd }) => {
    const blk = document.querySelectorAll('#editor > *')[i];
    const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement.closest('math-field, .math-embed') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let tn = w.nextNode(), last = tn;
    while (atEnd && (last = w.nextNode() || last) && last !== tn) tn = last;
    document.getElementById('editor').focus();
    const r = document.createRange(); r.setStart(tn, atEnd ? tn.length : 0); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  }, { i, atEnd });
  const down = async (n = 1, key = 'ArrowDown') => { const t = []; for (let k = 0; k < n; k++) { await page.keyboard.press(key); await page.waitForTimeout(150); t.push(await where()); } return t; };
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    await load(`<p>The sum ${M('a')} is short.</p><p>Next paragraph.</p>`);
    await caretIn(0);
    let t = await down(1);
    ok(`${engine}: Down leaves a one-line paragraph with an equation`, t[0] === '1', t);
    await page.keyboard.type('Z'); await page.waitForTimeout(200);
    ok(`${engine}: …and typing goes into the next paragraph`, await page.evaluate(() => document.querySelectorAll('#editor > *')[1].textContent.includes('Z')), await page.evaluate(() => document.querySelectorAll('#editor > *')[1].textContent));
    t = await down(1, 'ArrowUp');
    ok(`${engine}: Up goes back into the paragraph with the equation`, t[0] === '0', t);

    await load(`<p>The sum is ${M('a')}</p><p>Next paragraph.</p>`);
    await caretIn(0);
    t = await down(1);
    ok(`${engine}: Down leaves a paragraph that ends with an equation`, t[0] === '1', t);

    const long = 'Words that wrap onto several lines in the text pane. '.repeat(6);
    await load(`<p>${long}The sum ${M('a')} and ${long}</p><p>After.</p>`);
    await caretIn(0);
    t = await down(12);
    ok(`${engine}: Down goes line by line through a long paragraph with an equation and on to the next one`, t.includes('1') && t.indexOf('1') >= 2, t);

    await load(`<p>Before.</p><p>The sum ${M('a')} is short.</p><p>After.</p>`);
    await caretIn(2);
    t = await down(2, 'ArrowUp');
    ok(`${engine}: Up from below goes into the paragraph with the equation, then above it`, t[0] === '1' && t[1] === '0', t);

    // A89 (random-action testing, seed 614743370, Chrome): a paragraph holding ONLY an equation (displayed maths). From the
    // paragraph below it, Up did not move at all — that paragraph has no equation, so the browser moved the caret, and it cannot
    // step onto a line that is all equation. Down from the paragraph above it likewise.
    const D = (s) => `<math display="block"><mn>26</mn><mo>÷</mo><mi>${s}</mi></math>`;
    await load(`<p>Before the sum.</p><p>${D('x')}</p><p><strong>however</strong> Mrs. Emboss, river and more words after it.</p>`);
    await caretIn(2);
    await page.keyboard.press('End'); await page.waitForTimeout(100);
    t = await down(2, 'ArrowUp');
    ok(`${engine}: Up from below an equation-only paragraph goes into it, then above it`, t[0] === '1' && t[1] === '0', t);
    await caretIn(0);
    t = await down(2);
    ok(`${engine}: Down from above an equation-only paragraph goes into it, then below it`, t[0] === '1' && t[1] === '2', t);
    await load(`<h1>Title</h1><p>Words before.</p><p>${D('x')}</p><p>${D('y')}</p><p>After both.</p>`);
    await caretIn(4);
    t = await down(4, 'ArrowUp');
    ok(`${engine}: Up passes two equation-only paragraphs in a row`, t.join() === '3,2,1,0', t);

    // A89 (random-action testing, seeds 1992578869 and 614743370, Chrome): Shift+Down past a box with an equation in it extended
    // the selection 5 to 20 blocks in one press, to the end of the book — the browser's own Shift+Down skips over an equation.
    // Now Shift+Up/Down near an equation extend the selection one line, as Up/Down move the caret.
    const focusBlock = () => page.evaluate(() => {
      const s = getSelection(); const n = s.focusNode;
      const blk = (n && (n.nodeType === 1 ? n : n.parentElement))?.closest?.('#editor > *');
      return String([...document.querySelectorAll('#editor > *')].indexOf(blk));
    });
    for (const [label, html] of [
      ['a box with an equation', `<p>Words before the box.</p><aside><p>Inside the box ${M('a')} and more.</p></aside><p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>`],
      ['an equation-only paragraph', `<p>Words before.</p><p>${D('x')}</p><p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>`],
      ['a paragraph with an equation', `<p>Words before.</p><p>The sum ${M('a')} is short.</p><p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>`],
    ]) {
      await load(html);
      await caretIn(0);
      const seen = [];
      for (let k = 0; k < 3; k++) { await page.keyboard.press('Shift+ArrowDown'); await page.waitForTimeout(150); seen.push(await focusBlock()); }
      const sel = await page.evaluate(() => getSelection().toString().replace(/\s+/g, ' ').trim());
      ok(`${engine}: Shift+Down past ${label} extends the selection one block at a time`, seen.join() === '1,2,3' && /^Words before/.test(sel), { seen, sel: sel.slice(0, 80) });
      const back = [];
      for (let k = 0; k < 2; k++) { await page.keyboard.press('Shift+ArrowUp'); await page.waitForTimeout(150); back.push(await focusBlock()); }
      ok(`${engine}: …and Shift+Up takes it back one block at a time`, back.join() === '2,1', back);
    }

    // A89 (random-action testing, seed 1982326777, WebKit): Up from a heading whose block above is a card (a print page, then a
    // ⁂ break, then another print page) did not move at all in WebKit. Up / Down now select a card above / below, as a click does,
    // and go on from it.
    {
      await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'heading', level: 1, text: 'First' }, { type: 'pagenum', page: '2' }, { type: 'break', kind: 'asterisks' }, { type: 'pagenum', page: '3' }, { type: 'heading', level: 1, text: 'Second' }, { type: 'para', text: 'Body.' }] }); await window.render(); });
      await page.waitForTimeout(400);
      await caretIn(4, true);
      t = await down(4, 'ArrowUp');
      ok(`${engine}: Up from a heading below cards selects each card in turn, then reaches the heading above`, t[3] === '0' && t.slice(0, 3).every((x) => x.startsWith('sel:')) && new Set(t.slice(0, 3)).size >= 2, t);
      await caretIn(0, true);
      t = await down(4);
      ok(`${engine}: …and Down from the heading above goes the other way`, t[3] === '4' && t.slice(0, 3).every((x) => x.startsWith('sel:')), t);
    }

    // the tester's own document and place
    await page.evaluate(async () => { const x = await (await fetch('/web/test_samples/nimas_comprehensive_structures_sample.xml')).text(); window.markDocumentClean(); await window.importFile(new File([x], 's.xml')); });
    await page.waitForTimeout(4000);
    const iEq = await page.evaluate(() => [...document.querySelectorAll('#editor > *')].findIndex((e) => e.querySelector('math-field')));
    const kinds = await page.evaluate((i) => [...document.querySelectorAll('#editor > *')].slice(i + 1, i + 4).map((e) => e.className.split(' ')[0]), iEq);
    await caretIn(iEq);
    t = await down(8);
    ok(`${engine}: the tester's paragraph — Down reaches the ⁂ break, the print page, then the Chapter 2 heading (${kinds.join(', ')})`,
      (() => { const upto = t.slice(0, t.indexOf(String(iEq + 3)) + 1); return upto.length > 2 && upto.includes(`sel:${kinds[0]}`) && upto.indexOf(`sel:${kinds[0]}`) < upto.indexOf(`sel:${kinds[1]}`) && upto.every((x) => x.startsWith('sel:') || x === String(iEq) || x === String(iEq + 3)); })(), t);
    // and back up again, from the start of the heading
    await caretIn(iEq + 3);
    t = await down(3, 'ArrowUp');
    // (Up from a plain heading over cards is the browser's own move — Chrome skips them, WebKit stops between them once — and
    // was never stuck; what matters is that it reaches the paragraph and Up then works inside it.)
    ok(`${engine}: …and Up from the heading gets back into the paragraph with the equations`, t.includes(String(iEq)) && t.slice(0, t.indexOf(String(iEq))).every((x) => x === '-1' || x.startsWith('sel:')), t);
    ok(`${engine}: no page errors`, errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Arrow keys past equations [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
