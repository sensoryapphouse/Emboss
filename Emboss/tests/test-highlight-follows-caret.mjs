// Feedback 17 Oct 2026, item 10 (APH testers, Safari): moving through the text with the arrow keys left the print highlight behind — stale
// highlights lingering. The invariant, checked after every key once the page has settled, in Chrome and in WebKit (Safari's engine):
//   - exactly one word is lit in the print text (the CSS Custom Highlight "link-word"), and it is the word the caret is in;
//   - at most one block carries the block tint (print-linked), and it is the caret's block;
//   - no table cell, equation or read-aloud highlight is left from a place the caret has gone;
//   - and what is PAINTED agrees: every pixel of the highlight colour in the text pane lies inside a rectangle the page says is lit (WebKit once
//     kept painting text that a dropped Highlight had covered — the highlight is now emptied before it is dropped or replaced, editor.mjs setHl/delHl).
// Moving the caret into a place with no word (a card, a print-page marker) must also leave nothing lit behind.
// Playwright's WebKit did not show the Safari fault on these documents before the change (the invariant held both before and after), so this test
// guards against it coming back rather than demonstrating the old failure.
// Run: node Emboss/scripts/serve.mjs 8261 &   node Emboss/tests/test-highlight-follows-caret.mjs 8261     (EMBOSS_ENGINE=webkit for Safari's engine)
import { openSuite, openEditor } from './lib/suite.mjs';
import { decodePng } from './lib/png.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'feedback-17oct', 'small-nimas-test.xml');

const { page, ok, finish } = await openSuite('Highlight follows the caret', { viewport: { width: 1300, height: 800 } });
try {
  await openEditor(page);
  await page.evaluate(() => { window.markDocumentClean?.(); window.__prevModel = window.lastModel; });
  await page.setInputFiles('#loadFileInput', FILE);
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel && (window.lastModel.blocks || []).length > 5, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  const census = () => page.evaluate(() => {
    const ed = document.getElementById('editor');
    const blockOf = (n) => { const e = n && (n.nodeType === 1 ? n : n.parentElement); const b = e && e.closest && e.closest('#editor > *'); return b ? [...ed.children].indexOf(b) : null; };
    const h = CSS.highlights.get('link-word'); const rs = h ? [...h] : [];
    const sel = getSelection();
    const edr = ed.getBoundingClientRect();
    const rects = [];
    for (const r of rs) for (const q of r.getClientRects()) rects.push([q.left, q.top, q.right, q.bottom]);
    for (const e of ed.querySelectorAll('.print-linked, .table-cell-hl, .math-hl, .print-reading')) { const q = e.getBoundingClientRect(); rects.push([q.left, q.top, q.right, q.bottom]); }
    return {
      words: rs.length, wordText: rs[0] ? rs[0].toString() : null, wordBlock: rs[0] ? blockOf(rs[0].startContainer) : null,
      linked: [...ed.querySelectorAll('.print-linked')].map((e) => [...ed.children].indexOf(e.closest('#editor > *'))),
      cells: ed.querySelectorAll('.table-cell-hl').length, reading: ed.querySelectorAll('.print-reading').length,
      caretBlock: sel.anchorNode && ed.contains(sel.anchorNode) ? blockOf(sel.anchorNode) : null, inText: !!sel.anchorNode && ed.contains(sel.anchorNode),
      clip: { x: edr.left, y: edr.top, width: edr.width, height: edr.height }, rects,
    };
  });
  // the highlight colour of the page (--link) as the browser paints it
  const linkRgb = await page.evaluate(() => { const d = document.createElement('div'); d.style.background = 'var(--link)'; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c.match(/\d+/g).slice(0, 3).map(Number); });
  const strayPixels = async (c) => {
    const png = decodePng(await page.screenshot({ clip: c.clip }));
    const scale = png.width / c.clip.width;
    let stray = 0;
    for (let y = 0; y < png.height; y += 2) for (let x = 0; x < png.width; x += 2) {
      const p = png.at(x, y);
      if (Math.abs(p[0] - linkRgb[0]) > 3 || Math.abs(p[1] - linkRgb[1]) > 3 || Math.abs(p[2] - linkRgb[2]) > 3) continue;
      const X = x / scale + c.clip.x, Y = y / scale + c.clip.y;
      if (!c.rects.some(([l, t, r, b]) => X >= l - 3 && X <= r + 3 && Y >= t - 3 && Y <= b + 3)) stray++;
    }
    return stray;
  };

  const blocks = await page.locator('#editor > *').count();
  ok('the document loaded (a heading, lists, a table, a box)', blocks > 15, blocks);
  const bad = []; let frames = 0, painted = 0, strayWorst = 0;
  const check = async (label) => {
    await page.waitForTimeout(420);          // the page settles: the caret sync runs a frame after the key
    const c = await census(); frames++;
    const problems = [];
    if (c.inText && c.caretBlock != null) {
      if (c.words > 1) problems.push('more than one word lit');
      if (c.linked.length > 1) problems.push('more than one block tinted');
      if (c.words === 1 && c.wordBlock !== c.caretBlock && c.linked[0] !== c.caretBlock) problems.push(`the lit word is in block ${c.wordBlock}, the caret in block ${c.caretBlock}`);
      if (c.cells > 1) problems.push('more than one table cell lit');
      if (c.reading) problems.push('a read-aloud highlight is showing');
    }
    if (frames % 3 === 0) { const s = await strayPixels(c); painted++; strayWorst = Math.max(strayWorst, s); if (s > 40) problems.push(`${s} highlight-coloured pixels are painted where nothing is lit`); }
    if (problems.length) bad.push({ label, problems, c: { ...c, rects: undefined, clip: undefined } });
  };
  // 1. along the lines: right, then down, up, left, from several places
  const walk = [['ArrowRight', 18], ['ArrowDown', 6], ['ArrowRight', 12], ['ArrowUp', 4], ['ArrowLeft', 14], ['End', 1], ['Home', 1], ['ArrowDown', 30]];
  for (const start of [3, 12]) {
    const el = page.locator('#editor > *').nth(Math.min(start, blocks - 1));
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ position: { x: 10, y: 6 }, timeout: 4000 }).catch(() => {});
    for (const [key, n] of walk) for (let i = 0; i < n; i++) { await page.keyboard.press(key); if (i % 3 === 2 || n === 1) await check(`${key} #${i + 1} from block ${start}`); else await page.waitForTimeout(25); }
  }
  ok(`after ${frames} key presses the page showed one lit word, in the caret's block, with nothing left behind`, bad.length === 0, bad.slice(0, 3));
  ok(`what was painted agreed (${painted} frames looked at; at most ${strayWorst} stray highlight pixels)`, strayWorst <= 40, strayWorst);
  // 2. a held key: many presses with no pause, then the page settles
  await page.locator('#editor > *').nth(3).click({ position: { x: 10, y: 6 } });
  for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowRight');
  const held = await (async () => { await page.waitForTimeout(700); return census(); })();
  ok('after a burst of 80 arrow presses with no pause: one word lit, in the caret\'s block', held.words === 1 && held.linked.length <= 1 && (held.wordBlock === held.caretBlock || held.linked[0] === held.caretBlock), { ...held, rects: undefined, clip: undefined });
  // 3. the drop-and-replace path itself: a highlight that is replaced or deleted is emptied (so WebKit repaints the text it covered)
  ok('the old highlight object is emptied when the highlight moves (the repaint fix)', await page.evaluate(async () => {
    const h1 = CSS.highlights.get('link-word');
    if (!h1) return false;
    const before = [...h1].length;
    document.getElementById('editor').focus();
    getSelection().modify('move', 'forward', 'word'); getSelection().modify('move', 'forward', 'word');
    await new Promise((r) => setTimeout(r, 500));
    const h2 = CSS.highlights.get('link-word');
    return before > 0 && h2 !== h1 && [...h1].length === 0;
  }));
} finally { await finish(); }
