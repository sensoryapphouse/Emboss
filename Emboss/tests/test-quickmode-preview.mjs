// Feedback 17 Oct 2026, item 8 (Paul's decisions): Quick Mode's braille preview is drawn by the editor's own renderer (web/braille-render.mjs renderBraille), so its
// cells, "page N" markers, size and spacing are the editor's braille pane's; it used to be one <pre> of Unicode braille with "──── page break ────" lines. Read is
// gone from Quick Mode. The testers' report that "the APH font sometimes fails to load once you scroll the preview" could not be made to happen as a font fault
// (the font is loaded, nothing fails) — the <pre> was ONE text block roughly a million pixels tall for the testers' book, where a browser may stop painting; the
// editor's renderer keeps only the lines in view in the page. This checks the new preview in a real browser, with a small document and with the testers' large book.
// Run: node Emboss/scripts/serve.mjs 8261 &   node Emboss/tests/test-quickmode-preview.mjs 8261     (EMBOSS_ENGINE=webkit for Safari's engine)
import { openSuite, URL_BASE } from './lib/suite.mjs';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMALL = path.join(HERE, 'fixtures', 'feedback-17oct', 'small-nimas-test.xml');
// a long book made on the spot (about 1,000 braille pages is not needed: 400 paragraphs make well over the 80 lines at which the renderer virtualises)
const BIG = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Long</title></head><body><h1>A long book</h1>' + Array.from({ length: 500 }, (_, i) => `<p>Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog, and then some more words follow so that the line wraps in braille.</p>`).join('') + '</body></html>';

const { page, ok, finish } = await openSuite('Quick Mode braille preview', { settings: { simpleMode: true, mode: 'bana' }, viewport: { width: 1200, height: 900 } });
try {
  await page.goto(`${URL_BASE}/web/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.setInputFiles('#fileInput', SMALL);
  await page.waitForFunction(() => window.lastBrf && document.querySelector('#preview .brl-row'), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const small = await page.evaluate(() => {
    const p = document.getElementById('preview');
    const row = p.querySelector('.brl-row'), wrap = p.querySelector('.brl-text-wrap'), cell = p.querySelector('.bcell');
    const pb = [...p.querySelectorAll('.brl-pagebreak')].map((e) => e.textContent);
    return {
      tag: p.tagName, cls: p.className, role: p.getAttribute('role'), label: p.getAttribute('aria-label'),
      rows: p.querySelectorAll('.brl-row').length, cells: p.querySelectorAll('.bcell').length, pageBreaks: pb,
      hasPre: !!p.querySelector('pre') || p.tagName === 'PRE', oldMarker: /page break/i.test(p.textContent),
      font: cell && getComputedStyle(cell).fontFamily, size: wrap && getComputedStyle(wrap).fontFamily && getComputedStyle(p).fontSize,
      lineHeight: row && getComputedStyle(row).lineHeight, pages: window.lastBrf.split('\f').length,
      fonts: [...document.fonts].filter((f) => /APH/.test(f.family)).map((f) => f.status),
      dots: [...p.querySelectorAll('.brl-text-wrap')].slice(0, 3).map((e) => e.textContent.slice(0, 20)),
    };
  });
  ok('the preview is the editor\'s braille container (a div of class "braille", not a <pre>)', small.tag === 'DIV' && /\bbraille\b/.test(small.cls) && !small.hasPre, small);
  ok('it is drawn by renderBraille: braille rows, one cell per braille character, a region named Braille', small.rows > 20 && small.cells > 200 && small.role === 'region' && small.label === 'Braille', small);
  // only the lines in view are in the page, so the markers are collected while scrolling down through the document
  const seenMarkers = new Set();
  for (let y = 0; y < 14; y++) {
    const got = await page.evaluate((n) => { const p = document.getElementById('preview'); p.scrollTop = Math.round((p.scrollHeight - p.clientHeight) * n / 13); return [...p.querySelectorAll('.brl-pagebreak')].map((e) => e.textContent); }, y);
    await page.waitForTimeout(120);
    for (const t of await page.evaluate(() => [...document.querySelectorAll('#preview .brl-pagebreak')].map((e) => e.textContent))) seenMarkers.add(t);
    for (const t of got) seenMarkers.add(t);
  }
  await page.evaluate(() => { document.getElementById('preview').scrollTop = 0; });
  ok('its page markers read "page 2", "page 3" … as the editor\'s do (and no "page break" line)', seenMarkers.has('page 2') && seenMarkers.has(`page ${small.pages}`) && [...seenMarkers].every((t) => /^page \d+$/.test(t)) && !small.oldMarker, { seen: [...seenMarkers], pages: small.pages });
  ok('the cells are in the APH braille font, line height 1.4, as in the editor', /APHfont/.test(small.font) && small.lineHeight === `${Math.round(parseFloat(small.size) * 1.4 * 100) / 100}px`, small);
  ok('the font is loaded', small.fonts.length > 0 && small.fonts.every((s) => s === 'loaded'), small.fonts);
  ok('the cells are the braille dots (Unicode braille), as the editor shows', small.dots.every((d) => /^[⠀-⣿]+$/.test(d.trim()) || d.trim() === ''), small.dots);
  ok('there is no Read button in Quick Mode, nor any read-aloud code in its page', await page.evaluate(() => !document.getElementById('readBtn')) && !/tts\.mjs|handleReadAloud|buildSpokenItems/.test(readFileSync(path.join(HERE, '..', 'web', 'app.mjs'), 'utf8')));

  // the same page, in the editor's braille pane: the same drawing
  const ed = await (async () => {
    const p2 = await page.context().newPage();
    await p2.goto(`${URL_BASE}/web/editor/index.html`, { waitUntil: 'load' });
    await p2.waitForFunction(() => typeof window.modelToLexical === 'function' && window.lastBrf, null, { timeout: 60000 });
    await p2.waitForTimeout(800);
    const r = await p2.evaluate(() => { const b = document.getElementById('braille'); const row = b.querySelector('.brl-row'); const cell = b.querySelector('.bcell'); return { cls: row.className, wrap: row.querySelector('.brl-text-wrap').className, font: getComputedStyle(cell).fontFamily, pb: b.querySelector('.brl-pagebreak')?.textContent }; });
    await p2.close();
    return r;
  })();
  ok('the editor\'s braille pane has the same structure and font (one renderer)', ed.cls === 'brl-row' && ed.wrap.startsWith('brl-text-wrap') && ed.font === small.font, { ed, quick: small.font });

  // a long document: only the lines in view are in the page, and scrolling keeps drawing cells in the font
  await page.setInputFiles('#fileInput', { name: 'long.html', mimeType: 'text/html', buffer: Buffer.from(BIG) });
  await page.waitForFunction(() => window.lastBrf && window.lastBrf.length > 50000 && document.querySelector('#preview .brl-virtual-window'), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const lines = await page.evaluate(() => window.lastBrf.split(/\r?\n/).length);
  const inPage = () => page.evaluate(() => ({ rows: document.querySelectorAll('#preview .brl-row').length, top: Math.round(document.getElementById('preview').scrollTop), h: document.getElementById('preview').scrollHeight, cellsDrawn: document.querySelectorAll('#preview .bcell, #preview .brl-text-wrap').length, sample: (document.querySelector('#preview .brl-text-wrap') || {}).textContent, font: getComputedStyle(document.querySelector('#preview .brl-text-wrap')).fontFamily, aph: [...document.fonts].filter((f) => /APH/.test(f.family)).map((f) => f.status) }));
  const first = await inPage();
  ok(`a long book (${lines} braille lines) puts only about a screenful in the page (${first.rows} rows)`, lines > 400 && first.rows > 5 && first.rows < 160, { lines, first });
  const fails = [];
  for (const frac of [0.2, 0.55, 0.9, 1]) {
    await page.evaluate((f) => { const p = document.getElementById('preview'); p.scrollTop = (p.scrollHeight - p.clientHeight) * f; }, frac);
    await page.waitForTimeout(350);
    const v = await inPage();
    if (!(v.rows > 5 && v.rows < 160 && /APHfont/.test(v.font) && v.aph.every((s) => s === 'loaded') && /[⠀-⣿]/.test(v.sample || ''))) fails.push({ frac, v });
  }
  ok('scrolling to 20 %, 55 %, 90 % and the end keeps drawing braille cells in the loaded APH font, a screenful at a time', fails.length === 0, fails);
  ok('the page never holds more than a few hundred elements for it (the old <pre> was one block of the whole book)', (await page.evaluate(() => document.querySelectorAll('#preview *').length)) < 3000);
} finally { await finish(); }
