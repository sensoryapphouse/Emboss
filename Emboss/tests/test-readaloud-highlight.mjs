// Read aloud marks the spoken word in BOTH panes (Paul, 4 Nov 2026: "would be better if it highlighted both the text and the braille as it is
// speaking"; then, in Safari, "Braille doesn't change" - nothing in the braille pane at all).
//
// Speech is stubbed (no sound, no voices): the page's speechSynthesis/SpeechSynthesisUtterance are replaced by a hand-driven one, so the
// test decides when each utterance starts, when each word boundary fires and when it ends. Two kinds of voice:
//   'boundary'    fires a 'word' boundary event per word (charIndex only, no charLength - Safari's shape);
//   'noboundary'  fires only start and end - Safari's built-in/Siri voices, which give no boundary events at all.
// For each spoken word it checks: the print word is marked (CSS Highlight 'tts-word', or the fallback overlay where the Highlight API is
// missing) and in view; exactly that word's braille cells (.bcell.cell-speaking) are marked, in view in the braille pane, and look different
// from a plain cell (computed colours) with readable contrast; the braille row of the block read is tinted (.brl-reading).
// Documents: a short one (heading, paragraph with contracted words, list, table) in light and dark, with and without the Highlight API,
// and a long one (> 80 braille rows: the virtualized pane) read from the top to the bottom.
//
// Needs the dev server:  node Emboss/scripts/serve.mjs 8137 &     node Emboss/tests/test-readaloud-highlight.mjs [port]
// EMBOSS_ENGINE=chrome|webkit|firefox picks the engine (default Chrome). run-all-tests.mjs lists it as "browser (not run)".
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};

const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><head><meta name="dc:Title" content="Read aloud"/></head>
<book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`;
const SHORT = wrap(`<h1>Knowledge through learning</h1>
<p>The children know their knowledge through the questions.</p>
<list type="ul"><li>Bread and butter</li><li>Cheese and onions</li></list>
<table><thead><tr><th>Name</th><th>Colour</th></tr></thead><tbody><tr><td>Apple</td><td>Green</td></tr><tr><td>Plum</td><td>Purple</td></tr></tbody></table>
<p>The end of this short test.</p>`);
let longBody = '<h1>Long document</h1>';
for (let i = 0; i < 110; i++) longBody += `<p>Paragraph ${i} about knowledge through children.</p>`;
const LONG = wrap(longBody);

// the hand-driven speech
const STUB = () => {
  const st = { q: [], cur: null, pos: 0, mode: 'boundary' };
  window.__sp = st;
  class U { constructor(t) { this.text = t; this.rate = 1; } }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: U, configurable: true, writable: true });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak(u) { st.q.push(u); }, cancel() { st.q = []; st.cur = null; }, pause() {}, resume() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {}, speaking: false, pending: false, paused: false },
  });
  st.start = () => { st.cur = st.q.shift() || null; st.pos = 0; if (!st.cur) return null; st.cur.onstart && st.cur.onstart({}); return st.cur.text; };
  st.word = () => {
    const t = st.cur.text; const re = /\S+/g; re.lastIndex = st.pos; const m = re.exec(t);
    if (!m) return null;
    st.pos = m.index + m[0].length;
    st.cur.onboundary && st.cur.onboundary({ name: 'word', charIndex: m.index });
    return m[0];
  };
  st.end = () => { const u = st.cur; st.cur = null; u && u.onend && u.onend({}); };
};

// what is marked right now, judged in the page
const inspect = (expected) => {
  const out = { problems: [] };
  const strip = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const braille = document.getElementById('braille'), editor = document.getElementById('editor');
  const bR = braille.getBoundingClientRect();
  const lum = (rgb) => { const m = rgb.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  // print
  let printWord = null, printRect = null;
  if (globalThis.Highlight && CSS.highlights && CSS.highlights.get('tts-word')) {
    const h = CSS.highlights.get('tts-word'); const r = [...h][0];
    if (r) { printWord = r.toString(); const q = r.getBoundingClientRect(); printRect = q; }
  } else {
    const f = document.querySelector('[data-tts-fallback]');
    if (f) { printWord = f.getAttribute('data-word'); printRect = f.getBoundingClientRect(); }
  }
  if (printWord == null) out.problems.push('print: word not marked');
  else if (strip(printWord) !== strip(expected)) out.problems.push(`print: marked "${printWord}"`);
  if (printRect) {
    const eR = editor.getBoundingClientRect();
    if (printRect.bottom < eR.top - 1 || printRect.top > eR.bottom + 1 || printRect.bottom < 0 || printRect.top > innerHeight) out.problems.push('print: word not in view');
  }
  // braille
  const cells = [...braille.querySelectorAll('.bcell.cell-speaking')];
  if (!cells.length) out.problems.push('braille: no cell marked');
  else {
    const row = cells[0].closest('.brl-row');
    const units = new Set(cells.map((c) => c.dataset.unit)), blocks = new Set(cells.map((c) => c.closest('.brl-row')?.dataset.block));
    if (units.size !== 1 || blocks.size !== 1) out.problems.push('braille: marked cells of more than one unit/block');
    else {
      const text = window.cellText[`${[...blocks][0]}:${[...units][0]}`] || '';
      const chars = cells.map((c) => +c.dataset.char);
      const wordAt = (n) => { let a = n, b = n; while (a > 0 && !/\s/.test(text[a - 1])) a--; while (b < text.length && !/\s/.test(text[b])) b++; return text.slice(a, b); };
      const ws = new Set(chars.map(wordAt));
      if (ws.size !== 1 || strip([...ws][0]) !== strip(expected)) out.problems.push(`braille: marked cells of "${[...ws].join('|')}", spoken "${expected}"`);
    }
    for (const c of cells) {
      const r = c.getBoundingClientRect();
      if (r.top < bR.top - 1 || r.bottom > bR.bottom + 1) { out.problems.push('braille: marked cell not in view'); break; }
    }
    const cs = getComputedStyle(cells[0]);
    const plain = [...braille.querySelectorAll('.bcell:not(.cell-speaking)')].find((c) => c.closest('.brl-row') === row) || braille.querySelector('.bcell:not(.cell-speaking)');
    if (plain) {
      const ps = getComputedStyle(plain);
      if (cs.backgroundColor === ps.backgroundColor) out.problems.push(`braille: marked cell looks like a plain one (${cs.backgroundColor})`);
    }
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) out.problems.push('braille: marked cell has no background');
    else {
      const l1 = lum(cs.backgroundColor), l2 = lum(cs.color); const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (cr < 4.5) out.problems.push(`braille: marked cell contrast ${cr.toFixed(1)}`);
    }
    if (!row || !row.classList.contains('brl-reading')) out.problems.push('braille: line not tinted');
  }
  return out;
};

async function open(browser, { scheme = 'light', xml, noHighlightApi = false, mode = 'boundary' }) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 }, colorScheme: scheme, locale: 'en-US' });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' })); } catch {} });
  await ctx.addInitScript(STUB);
  await ctx.addInitScript((m) => { window.__sp.mode = m; }, mode);
  if (noHighlightApi) await ctx.addInitScript(() => { try { delete window.Highlight; } catch {} try { Object.defineProperty(CSS, 'highlights', { value: undefined, configurable: true }); } catch {} });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'ra.xml', { type: 'text/xml' })); }, xml);
  await page.waitForFunction(() => (window.lastModel?.blocks || []).length > 3, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}

// read the whole document word by word; returns { words, bad: [{word, problems}], kinds }
async function readAll(page, mode, limit = 100000) {
  await page.evaluate(() => { document.getElementById('editor').focus(); });
  await page.click('#btnRead');
  await page.waitForFunction(() => window.__sp.q.length > 0, null, { timeout: 5000 });
  let words = 0; const bad = []; const seenBlocks = new Set();
  for (let guard = 0; guard < 2000; guard++) {
    const text = await page.evaluate(() => window.__sp.start());
    if (text == null) break;
    if (mode === 'boundary') {
      for (;;) {
        const w = await page.evaluate(() => window.__sp.word());
        if (w == null) break;
        words++;
        if (words > limit) return { words, bad };
        const r = await page.evaluate(inspect, w);
        if (r.problems.length) bad.push({ word: w, text: text.slice(0, 30), problems: r.problems });
      }
    } else {
      await page.waitForTimeout(1600);                 // no boundary events: the braille must still follow, word by word
      const r = await page.evaluate(inspect, '');
      const problems = r.problems.filter((p) => !/^print: marked|^braille: marked cells of "/.test(p) && !/print: word not marked/.test(p));
      words++;
      if (problems.length) bad.push({ word: text.slice(0, 30), problems });
    }
    await page.evaluate(() => window.__sp.end());
    if (mode !== 'boundary' && words >= 12) { await page.click('#btnRead'); break; }
  }
  await page.evaluate(() => { try { document.getElementById('btnRead').getAttribute('aria-pressed') === 'true' && document.getElementById('btnRead').click(); } catch {} });
  return { words, bad };
}

const browser = await launchBrowser({ args: ['--no-sandbox'] });
try {
  console.log(`--- Read aloud: both panes marked (${ENGINE_LABEL}) ---`);
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await open(browser, { scheme, xml: SHORT });
    const r = await readAll(page, 'boundary');
    ok(`short document [${scheme}]: every spoken word (${r.words}) marked in print and braille, in view`, r.words > 25 && r.bad.length === 0, r.bad.slice(0, 4));
    ok(`short document [${scheme}]: no page errors`, page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { xml: SHORT, noHighlightApi: true });
    ok('Highlight API removed for this test', await page.evaluate(() => !(globalThis.Highlight && CSS.highlights)));
    const r = await readAll(page, 'boundary');
    ok(`short document, no Highlight API: every spoken word (${r.words}) marked in print (fallback) and braille`, r.words > 25 && r.bad.length === 0, r.bad.slice(0, 4));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { xml: LONG });
    ok('long document: the braille pane is virtualized', await page.evaluate(() => !!document.getElementById('braille')._virtualBraille?.isVirtualized()));
    const r = await readAll(page, 'boundary');
    ok(`long document (virtualized braille): every spoken word (${r.words}) marked in print and braille, in view`, r.words > 600 && r.bad.length === 0, r.bad.slice(0, 4));
    await ctx.close();
  }
  for (const [name, xml] of [['short', SHORT], ['long (virtualized)', LONG]]) {
    const { ctx, page } = await open(browser, { xml, mode: 'noboundary' });
    const r = await readAll(page, 'noboundary');
    ok(`${name} document, a voice with no boundary events: the braille still follows the reading (line tinted, in view, a word marked)`, r.words >= 5 && r.bad.length === 0, r.bad.slice(0, 4));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${ENGINE_LABEL}: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
