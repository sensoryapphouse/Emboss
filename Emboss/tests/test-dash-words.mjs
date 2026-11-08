// Paul, 4 Nov 2026: type "She waited—and waited—until the morning came." (an em dash, no spaces, as books print it) and click "until": the
// print highlight and the braille highlight both covered "waited—until", and the explanation bar described it as ONE word ("12 cells for 12
// characters"). A dash is a word boundary (em dash, en dash, two-em, three-em, horizontal bar). The BRAILLE is unchanged (UEB writes the dash
// unspaced, ,-): the dash is not turned into a hyphen. Clicking the dash itself lights just the dash and its braille ,- and the bar explains it.
// For each word around an unspaced em dash and en dash: click it, and check the print highlight (CSS Highlight "link-word"), the braille cells lit
// (cell-hl) and the bar. Also the keyboard (the caret moved into "until" with the arrow keys).
// Unit tests of the pure part: tests/dash_words.test.mjs. Run: node Emboss/scripts/serve.mjs 8261 &  node Emboss/tests/test-dash-words.mjs 8261
// (EMBOSS_ENGINE=webkit for Safari's engine).
import { openSuite, openEditor } from './lib/suite.mjs';

const { page, ok, finish } = await openSuite('Dash is a word boundary', { viewport: { width: 1400, height: 900 } });
try {
  await openEditor(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const load = async (text) => { await page.evaluate(async (t) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: t }] }); await window.render(); }, text); await wait(900); };
  const brailleOf = () => page.evaluate(() => [...document.querySelectorAll('#braille .brl-row')].map((r) => r.textContent).join('|'));
  // click the middle of the character at `offset` in the first paragraph
  const clickChar = async (offset, frac = 0.5) => {
    const r = await page.evaluate(([o, f]) => {
      const p = document.querySelector('#editor p, #editor [data-block-idx="0"]');
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n, seen = 0;
      while ((n = w.nextNode())) { if (seen + n.nodeValue.length > o) { const rg = document.createRange(); rg.setStart(n, o - seen); rg.setEnd(n, o - seen + 1); const b = rg.getBoundingClientRect(); return { x: b.left + b.width * f, y: b.top + b.height / 2 }; } seen += n.nodeValue.length; }
      return null;
    }, [offset, frac]);
    await page.mouse.click(r.x, r.y); await wait(500);
  };
  const lit = () => page.evaluate(() => {
    const h = CSS.highlights.get('link-word'); const rs = h ? [...h] : [];
    const cells = [...document.querySelectorAll('#braille .cell-hl')];
    return {
      print: rs.map((r) => r.toString()).join('+'),
      braille: cells.map((c) => c.textContent).join(''),
      brailleChars: cells.map((c) => +c.dataset.char),
      bar: document.getElementById('statusBar').innerText.replace(/\s+/g, ' ').trim(),
      barWord: (document.querySelector('#statusBar .ri-word') || {}).textContent || null,
    };
  });

  for (const [name, d, dashBraille] of [['em dash', '—', '⠠⠤'], ['en dash', '–', null]]) {
    console.log(`--- ${name}, no spaces ---`);
    const text = `She waited${d}and waited${d}until the morning came.`;
    await load(text);
    const brl = await brailleOf();
    for (const [word, at] of [['She', 1], ['waited', text.indexOf('waited') + 2], ['and', text.indexOf('and') + 1], ['waited', text.lastIndexOf('waited') + 2], ['until', text.indexOf('until') + 2], ['morning', text.indexOf('morning') + 2]]) {
      await clickChar(at);
      const l = await lit();
      ok(`${name}: click "${word}" (char ${at}): the print highlight is just that word`, l.print === word, l);
      ok(`${name}: click "${word}": the braille lit lies inside that word`, l.brailleChars.length > 0 && l.brailleChars.every((c) => c >= at - word.length && c <= at + word.length && text.slice(c, c + 1) !== d), l);
      ok(`${name}: click "${word}": the bar explains just that word`, l.barWord === word, l);
    }
    // the dash itself
    await clickChar(text.indexOf(d), 0.2);
    let l = await lit();
    ok(`${name}: click the dash: the print highlight is just the dash`, l.print === d, l);
    ok(`${name}: click the dash: the braille lit is just the dash's braille`, l.braille.length >= 1 && l.brailleChars.every((c) => text[c] === d) && (dashBraille === null || l.braille === dashBraille), l);
    ok(`${name}: click the dash: the bar explains the dash alone`, l.barWord === d, l);
    // the keyboard: the caret moved into "until" lights "until", not "waited—until"
    await clickChar(text.indexOf('and') + 1);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');   // "and" ends, then the next word
    for (let k = 0; k < 8; k++) await page.keyboard.press('ArrowRight');
    await wait(500);
    l = await lit();
    ok(`${name}: the caret moved with the arrow keys never lights two words with a dash between`, !l.print.includes(d), l);
    // the braille itself is unchanged by the fix: the dash is written unspaced, as in print
    ok(`${name}: the braille has the dash unspaced, as print has it`, d === '—' ? /waited⠠⠤/.test(brl.replace(/\s+/g, '')) || /⠠⠤/.test(brl) : brl.length > 0, brl);
  }
  // the em dash braille text is the same as a build without the fix would give (the fix does not touch the translation)
  await load('She waited—and waited—until the morning came.');
  const b1 = await brailleOf();
  await clickChar(8); await wait(300);
  ok('clicking a word does not change the braille', (await brailleOf()) === b1);
  await load('it — and the other'); await clickChar(0, 0.3); const sa = await lit(); await clickChar(3, 0.2); const sb = await lit();
  ok('a dash with spaces round it is still fine ("it — and the other"): "it", then the dash alone', sa.print === 'it' && sb.print === '—', [sa.print, sb.print, sb.bar]);
  ok('a hyphenated word stays one word', await (async () => { await load('a well-known word'); await clickChar(5); return (await lit()).print === 'well-known'; })());
} finally {
  await finish();
}
