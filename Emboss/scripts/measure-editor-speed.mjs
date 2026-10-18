// Feedback 30 Sep 2026, item 11 ("Responsiveness is generally better in Chrome than Safari but not a concern for small documents";
// Paul, 1 Oct: install WebKit and measure). Times the same editor actions in Chrome and in WebKit (Safari's engine, Playwright's
// build), alternating the two so that other load on the machine falls on both alike, and prints medians.
//
// For each document (small, medium, large): load it (until its braille stops changing), type one character into a paragraph (until it
// shows in the text; until the braille has caught up), type a 20-character phrase (until the braille has caught up), and jump to the
// end of the document (until the caret's braille line is shown). Headless, so the numbers are relative, not what a user's Safari
// will show exactly; a ratio well above 1 marks where WebKit is slow.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/scripts/measure-editor-speed.mjs [port] [--runs N]
import { chromium, webkit } from 'playwright';

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) || 8137);
const RUNS = Number((args[args.indexOf('--runs') + 1] && args.includes('--runs')) ? args[args.indexOf('--runs') + 1] : 3);
const DOCS = [
  { name: 'small (Word test document)', url: '/tests/fixtures/import-audit/docx/w00-paul-test-word-doc-2.docx', file: 'w00.docx', binary: true },
  { name: 'medium (NIMAS showcase, ~25 pages)', url: '/web/test_samples/nimas_comprehensive_structures_sample.xml', file: 'showcase.xml' },
  { name: 'large (real NIMAS book, 1.4 MB)', url: '/web/large-nimas.xml', file: 'large-nimas.xml' },
];
const ENGINES = { chrome: () => chromium.launch({ channel: 'chrome', headless: true }), webkit: () => webkit.launch({ headless: true }) };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

async function measure(engine, doc) {
  const browser = await ENGINES[engine]();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    // until the braille has been the same for `quiet` ms (render is debounced and asynchronous)
    const settledAfter = (t0, quiet = 600) => page.evaluate(async ({ t0, quiet }) => {
      let last = window.lastBrf, lastChange = performance.now();
      const start = performance.now();
      while (performance.now() - lastChange < quiet && performance.now() - start < 120000) {
        await new Promise((r) => setTimeout(r, 20));
        if (window.lastBrf !== last) { last = window.lastBrf; lastChange = performance.now(); }
      }
      return lastChange - t0;
    }, { t0, quiet });
    const load = await page.evaluate(async (d) => {
      const res = await fetch(d.url);
      const data = d.binary ? await res.arrayBuffer() : await res.text();
      window.markDocumentClean();
      window.__t0 = performance.now();
      await window.importFile(new File([data], d.file));
      return window.__t0;
    }, doc);
    const loadMs = await settledAfter(load, 1000);
    // one keystroke into the first paragraph of text
    await page.click('#editor p.ed-p >> nth=0');
    await page.keyboard.press('End');
    // until one more "Z" is in the text (wherever the caret was: a paragraph may end with something after its text, such as a
    // contents line's page number)
    const zCount = () => (document.getElementById('editor').textContent.match(/Z/g) || []).length;
    const key = await page.evaluate((src) => { window.__zBefore = eval(src)(); window.__keyT0 = performance.now(); return window.__keyT0; }, `(${zCount})`);
    await page.keyboard.type('Z');
    const shownMs = await page.evaluate(async ({ t0, src }) => {
      const count = eval(src);
      for (let k = 0; k < 4000 && count() <= window.__zBefore; k++) await new Promise((r) => setTimeout(r, 1));
      return performance.now() - t0;
    }, { t0: key, src: `(${zCount})` });
    const keyBrailleMs = await settledAfter(key, 600);
    // a 20-character phrase
    const phraseT0 = await page.evaluate(() => performance.now());
    await page.keyboard.type(' quick brown foxes!');
    const phraseMs = await settledAfter(phraseT0, 600);
    // jump to the end of the document
    const endT0 = await page.evaluate(() => performance.now());
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    const endMs = await page.evaluate(async (t0) => { for (let k = 0; k < 400; k++) { await new Promise((r) => requestAnimationFrame(r)); if (document.querySelector('#braille .brl-row.brl-caret-line, #braille .brl-row.caret-row, #braille .brl-row.brl-linked')) break; } return performance.now() - t0; }, endT0);
    const blocks = await page.evaluate(() => (window.lastModel?.blocks || []).length);
    return { loadMs, shownMs, keyBrailleMs, phraseMs, endMs, blocks };
  } finally {
    await browser.close();
  }
}

const results = {};
for (const doc of DOCS) {
  results[doc.name] = { chrome: [], webkit: [] };
  for (let r = 0; r < RUNS; r++) for (const engine of ['chrome', 'webkit']) {
    try { results[doc.name][engine].push(await measure(engine, doc)); } catch (e) { console.error(`${engine} ${doc.name}: ${e.message}`); }
    process.stderr.write('.');
  }
}
process.stderr.write('\n');
const fmt = (x) => (Number.isFinite(x) ? `${Math.round(x)} ms` : '—');
for (const [name, byEngine] of Object.entries(results)) {
  console.log(`\n${name} — ${byEngine.chrome[0]?.blocks ?? '?'} blocks, median of ${RUNS} runs`);
  console.log(`  ${'measure'.padEnd(34)}${'Chrome'.padStart(10)}${'WebKit'.padStart(10)}${'ratio'.padStart(8)}`);
  for (const [k, label] of [['loadMs', 'load until braille is ready'], ['shownMs', 'one key: shows in the text'], ['keyBrailleMs', 'one key: braille caught up'], ['phraseMs', 'typing a phrase: braille caught up'], ['endMs', 'jump to the end']]) {
    const c = median(byEngine.chrome.map((x) => x[k])), w = median(byEngine.webkit.map((x) => x[k]));
    console.log(`  ${label.padEnd(34)}${fmt(c).padStart(10)}${fmt(w).padStart(10)}${(Number.isFinite(c) && c > 0 ? (w / c).toFixed(1) + '×' : '—').padStart(8)}`);
  }
}
