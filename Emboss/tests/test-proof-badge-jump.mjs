// Feedback 17 Oct 2026, item 5 (APH testers): clicking "N words to check" did nothing when the caret was in the print text. Cause (found in
// Playwright's WebKit, which behaves like Safari here): Safari does not give a button the focus when it is clicked, so the focus sat on the page
// and the editor's focus-rescue (rescueEditorFocus) put it back on the text a moment after the jump — and WebKit then scrolled the text back to
// the old caret, undoing the jump. The badge now takes the focus itself (as it does in Chrome), so there is nothing to rescue.
// Run: node Emboss/scripts/serve.mjs 8261 &   node Emboss/tests/test-proof-badge-jump.mjs 8261     (EMBOSS_ENGINE=webkit for Safari's engine)
import { openSuite, openEditor, loadIntoEditor } from './lib/suite.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const lists = readFileSync(path.join(HERE, 'fixtures', 'import-audit', 'html', 'h03-lists.html'), 'utf8');
// 90 paragraphs of filler, then the list fixture whose "alphareversed3" is a word the read-back check flags: the word is far below the caret
const filler = Array.from({ length: 90 }, (_, i) => `<p>Paragraph ${i + 1} of plain filler text, a sentence of ordinary words to push the flagged word well below the first screen.</p>`).join('\n');
const html = lists.replace('<body>', '<body>\n' + filler);

const { page, ok, finish } = await openSuite('Proof badge jump');
try {
  await openEditor(page);
  await loadIntoEditor(page, 'proof-jump.html', html);
  await page.waitForFunction(() => { const b = document.getElementById('proofBadge'); return b && !b.hidden && !window.proofreadBusy(); }, null, { timeout: 60000 });
  const view = () => page.evaluate(() => {
    const h = CSS.highlights.get('link-word'); const r = h && [...h][0];
    const ed = document.getElementById('editor').getBoundingClientRect();
    const q = r && r.getBoundingClientRect();
    return { word: r ? r.toString() : null, inView: !!q && q.height > 0 && q.top >= ed.top && q.bottom <= ed.bottom, scroll: Math.round(document.getElementById('editor').scrollTop), main: document.querySelector('main').scrollTop, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) };
  });
  // the caret in the print text, at the top
  await page.locator('#editor p').first().click({ position: { x: 20, y: 8 } });
  await page.waitForTimeout(700);
  const before = await view();
  ok('the caret is in the text, at the top (nothing flagged is in view yet)', before.scroll < 300, before);
  for (let n = 1; n <= 2; n++) {
    await page.click('#proofBadge');
    await page.waitForTimeout(1600);   // long enough for the focus rescue (450 ms) and WebKit's late scroll to the old caret
    const v = await view();
    ok(`click ${n}: a flagged word is lit`, !!v.word && /^alpha/.test(v.word), v);
    ok(`click ${n}: and it is in view in the print pane (the text was scrolled to it, and stayed there)`, v.inView, v);
    ok(`click ${n}: the page round the panes did not move`, v.main === 0, v);
  }
  const bar = await page.evaluate(() => document.getElementById('statusBar').innerText);
  ok('the explanation bar says which word, of how many', /Word \d+ of \d+ to check: “alpha/.test(bar), bar.slice(0, 200));
} finally { await finish(); }
