// Import fix list #40 (Paul approved, 1 Oct 2026): the editor has a code block. The readers make `{ type: 'code', text: 'line one\n  line two' }`
// (Word Source Code / HTML Preformatted style, HTML <pre>, ODT Preformatted Text, Markdown fences and indented code); the formatter brailles
// one as displayed computer code (a grade-1 passage, lines kept: BANA 19 / UEB technical 17) and the save writes <p class="bana-code"> with
// <br/> line breaks. But the editor had no code block: a code block became an ordinary paragraph there (contracted braille, saved as <p>).
// Now a "Computer code" block style (the dropdown, the slash menu) holds one: shown in a monospace font with its spaces and lines kept,
// braille and save as the reader's code block, also among a list item's blocks.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-editor-code-block.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = (f) => path.join(HERE, 'fixtures', 'import-audit', f);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

const browser = await launchBrowser();
const newPage = async (settings, colorScheme = 'light') => {
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme });
  await context.addInitScript((s) => { try { localStorage.setItem('emboss-settings', JSON.stringify(s)); } catch {} },
    { simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en', ...settings });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  return page;
};
const load = async (page, file) => {
  await page.evaluate(() => window.markDocumentClean());
  await page.setInputFiles('#loadFileInput', FIX(file));
  await page.waitForTimeout(4000);
};
const xmlOf = (page) => page.evaluate(() => window.exportCurrentDocumentXml());
const brfLines = async (page) => (await page.evaluate(() => window.lastBrf || '')).split(/\r?\n/);
// The grade-1 passage around the first braille line matching `re`: the indicator line before it, the terminator after it.
const passageAround = (lines, re) => {
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return { at };
  let open = -1, close = -1;
  for (let i = at; i >= Math.max(0, at - 6) && open < 0; i--) if (lines[i].trim() === ';;;') open = i;
  for (let i = at; i < Math.min(lines.length, at + 8) && close < 0; i++) if (lines[i].trim() === ";'") close = i;
  return { at, open, close, lines: lines.slice(Math.max(0, at - 3), at + 5) };
};
// The document's only passage (a document with one code block): the lines between the indicator and the terminator.
const onlyPassage = (lines) => {
  const open = lines.findIndex((l) => l.trim() === ';;;');
  const close = lines.findIndex((l, i) => i > open && l.trim() === ";'");
  return { open, close, body: open >= 0 && close > open ? lines.slice(open + 1, close).filter((l) => l.trim()) : [] };
};
const codeParas = (page, re) => page.evaluate((src) => [...document.querySelectorAll('#editor p[data-bana-style="code"]')].filter((p) => new RegExp(src).test(p.textContent)).map((p) => {
  const cs = getComputedStyle(p);
  return { text: p.textContent, brs: p.querySelectorAll('br').length, font: cs.fontFamily, white: cs.whiteSpace, size: cs.fontSize };
}), re.source);

try {
  // ---- loaded code blocks: HTML <pre>, Markdown fence and indented code, Word Source Code ----
  let page = await newPage({ transcriberTools: true });
  for (const [file, label, re, wantText, wantBrs, brfRe, xmlRe] of [
    ['html/h01-structure.html', 'HTML <pre>', /alphapre/, 'preformatted   line one alphapre', 1, /ALPHAPRE/, /<p class="bana-code">preformatted {3}line one alphapre<br\/> {2}indented line two<\/p>/],
    ['md/m01-inline-blocks.md', 'Markdown indented code', /alphaindented/, 'indented code alphaindented', 1, /ALPHAINDENTED/, /<p class="bana-code">indented code alphaindented<br\/>second code line<\/p>/],
    ['md/m01-inline-blocks.md', 'Markdown fenced code', /alphafenced/, 'function alphafenced() { return 1; }', 0, /ALPHAFENCED/, /<p class="bana-code">function alphafenced\(\) \{ return 1; \}<\/p>/],
    ['docx/w10-paragraph-layout.docx', 'Word Source Code style', /alphacode/, 'Source code paragraph alphacode', 1, /ALPHACODE/, /<p class="bana-code">[^<]*alphacode[^<]*<br\/>[^<]*<\/p>/],
  ]) {
    await load(page, file);
    const found = await codeParas(page, re);
    ok(`${label}: shows as a code block in the editor`, found.length === 1, found);
    const c = found[0] || {};
    ok(`${label}: monospace, spaces and lines kept`, /mono|courier|menlo|consolas/i.test(c.font || '') && /^pre/.test(c.white || '') && (c.text || '').includes(wantText) && c.brs === wantBrs, c);
    const lines = await brfLines(page);
    const pa = passageAround(lines, brfRe);
    ok(`${label}: its braille is a grade-1 passage (;;; … ;')`, pa.open >= 0 && pa.close >= 0 && pa.open < pa.at && pa.close >= pa.at, pa);
    const xml = await xmlOf(page);
    ok(`${label}: saves as <p class="bana-code"> with <br/>`, xmlRe.test(xml), (xml.match(/.{0,40}alpha(pre|indented|fenced|code).{0,60}/) || [])[0]);
  }

  // ---- a code block among a list item's blocks keeps its type (Markdown list item) ----
  await load(page, 'md/m02-lists.md');
  const itemCode = await codeParas(page, /alphaitemcode/);
  ok('a code block in a list item shows as a code block', itemCode.length === 1, itemCode);
  let xml = await xmlOf(page);
  ok('and saves as <p class="bana-code"> inside the same list item', /alphaitempara second paragraph<\/p>\s*<p class="bana-code">alphaitemcode<\/p>\s*<\/li>/.test(xml), (xml.match(/.{0,120}alphaitemcode.{0,60}/) || [])[0]);
  const lines = await brfLines(page);
  const pa = passageAround(lines, /ALPHAITEMCODE/);
  ok('and its braille is a grade-1 passage', pa.open >= 0 && pa.close >= 0, pa);

  // ---- contrast of the code block, light and dark ----
  const contrast = () => page.evaluate(() => {
    const p = document.querySelector('#editor p[data-bana-style="code"]');
    if (!p) return null;
    const parse = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
    let bg = { r: 255, g: 255, b: 255, a: 0 };
    const layers = [];
    for (let e = p; e; e = e.parentElement) layers.push(parse(getComputedStyle(e).backgroundColor));
    for (const l of layers.reverse()) bg = { r: l.r * l.a + bg.r * (1 - l.a), g: l.g * l.a + bg.g * (1 - l.a), b: l.b * l.a + bg.b * (1 - l.a), a: 1 };
    const fg = parse(getComputedStyle(p).color);
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { ratio: (a + 0.05) / (b + 0.05), fg, bg };
  });
  const light = await contrast();
  ok('code block text has enough contrast in light mode', light && light.ratio >= 4.5, light);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); });
  await page.waitForTimeout(300);
  const dark = await contrast();
  ok('and in dark mode', dark && dark.ratio >= 4.5, dark);
  await page.context().close();

  // ---- Transcriber tools off: the style is not offered (like Blockquote), but a loaded code block shows it ----
  page = await newPage({ transcriberTools: false });
  await load(page, 'html/h01-structure.html');
  if (await page.locator('#editor p[data-bana-style="code"]').count()) await page.locator('#editor p[data-bana-style="code"]').first().click();
  await page.waitForTimeout(300);
  let sel = await page.evaluate(() => ({ value: document.getElementById('blockStyle').value, has: [...document.getElementById('blockStyle').options].some((o) => o.value === 'code') }));
  ok('a code block in the caret shows "Computer code" in the dropdown even with Transcriber tools off', sel.value === 'code' && sel.has, sel);
  await page.locator('#editor h1').first().click();
  await page.waitForTimeout(300);
  sel = await page.evaluate(() => ({ value: document.getElementById('blockStyle').value, has: [...document.getElementById('blockStyle').options].some((o) => o.value === 'code') }));
  ok('elsewhere it is not offered while Transcriber tools is off (as Blockquote)', !sel.has, sel);
  await page.context().close();

  // ---- typing: apply the style, Enter inside, leave ----
  page = await newPage({ transcriberTools: true });
  await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ title: 'T', blocks: [{ type: 'para', text: 'x = 1' }, { type: 'para', text: 'tail' }] }); return window.render(); });
  await page.waitForTimeout(1500);
  await page.locator('#editor p', { hasText: 'x = 1' }).click();
  await page.keyboard.press('End');
  const styleOpts = await page.evaluate(() => [...document.getElementById('blockStyle').options].map((o) => ({ v: o.value, l: o.dataset.full || o.textContent })));
  ok('the style dropdown offers "Computer code"', styleOpts.some((o) => o.v === 'code' && /computer code/i.test(o.l)), styleOpts.filter((o) => /code|quote/.test(o.v)));
  await page.selectOption('#blockStyle', 'code', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ok('applying the style makes the paragraph a code block', (await codeParas(page, /x = 1/)).length === 1);
  xml = await xmlOf(page);
  ok('saved as <p class="bana-code">', /<p class="bana-code">x = 1<\/p>/.test(xml), (xml.match(/.{0,40}x = 1.{0,40}/) || [])[0]);
  let pass1 = onlyPassage(await brfLines(page));
  ok('and its braille is one grade-1 passage of one line', pass1.open >= 0 && pass1.close > pass1.open && pass1.body.length === 1, pass1);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('y = 2');
  await page.waitForTimeout(1200);
  ok('Enter inside a code block makes a new line in the same block', (await page.evaluate(() => document.querySelectorAll('#editor p[data-bana-style="code"]').length)) === 1);
  xml = await xmlOf(page);
  ok('saved as one block with <br/>', /<p class="bana-code">x = 1<br\/>y = 2<\/p>/.test(xml), (xml.match(/.{0,40}x = 1.{0,60}/) || [])[0]);
  pass1 = onlyPassage(await brfLines(page));
  ok('one grade-1 passage holds both lines', pass1.open >= 0 && pass1.close > pass1.open && pass1.body.length === 2, pass1);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('z');
  xml = await xmlOf(page);
  ok('Shift+Enter is a new line in the block too', /<p class="bana-code">x = 1<br\/>y = 2<br\/>z<\/p>/.test(xml), (xml.match(/.{0,40}x = 1.{0,60}/) || [])[0]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('after');
  await page.waitForTimeout(800);
  xml = await xmlOf(page);
  ok('Enter on an empty last line leaves the block: a body paragraph follows and the block has no trailing line', /<p class="bana-code">x = 1<br\/>y = 2<br\/>z<\/p>\s*<p>after<\/p>/.test(xml), (xml.match(/.{0,40}x = 1.{0,100}/) || [])[0]);
  ok('and only the first block is code', (await page.evaluate(() => document.querySelectorAll('#editor p[data-bana-style="code"]').length)) === 1);
  // back to body text
  await page.locator('#editor p', { hasText: 'x = 1' }).click();
  await page.waitForTimeout(400);
  ok('the dropdown shows "Computer code" while the caret is in the block', (await page.evaluate(() => document.getElementById('blockStyle').value)) === 'code');
  await page.selectOption('#blockStyle', 'p', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  xml = await xmlOf(page);
  ok('choosing Body Text turns it back into an ordinary paragraph (its lines stay lines)', !/bana-code/.test(xml) && /<p>x = 1<br\/>y = 2<br\/>z<\/p>/.test(xml), (xml.match(/.{0,40}x = 1.{0,60}/) || [])[0]);
  // ---- the slash menu: /code ----
  await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ title: 'T', blocks: [{ type: 'para', text: 'first' }, { type: 'para', text: 'second' }] }); return window.render(); });
  await page.waitForTimeout(1000);
  await page.locator('#editor p', { hasText: 'first' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/code');
  await page.waitForSelector('#slashList .slash-item', { timeout: 5000 }).catch(() => {});
  const menu = await page.$$eval('#slashList .slash-item', (els) => els.map((e) => e.id.replace('slash-opt-', '')));
  ok('the slash menu offers Computer Code for /code', menu.includes('code'), menu);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('x = 1');
  await page.waitForTimeout(800);
  ok('and applies it to the paragraph', (await codeParas(page, /^x = 1$/)).length === 1, await codeParas(page, /./));
  // ---- the flags a reader sets (dot locator, keep spaces) ride on the code block through the editor and the save ----
  await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ title: 'T', blocks: [{ type: 'code', text: 'a  b\n  c', dotLocator: true, keepSpaces: true }] }); return window.render(); });
  await page.waitForTimeout(1000);
  xml = await xmlOf(page);
  ok('dotLocator and keepSpaces stay on a code block', /<p class="bana-code bana-dot-locator bana-keep-spaces">a {2}b<br\/> {2}c<\/p>/.test(xml), (xml.match(/<p class="bana-code[^>]*>.*?<\/p>/) || [])[0]);
  const fl = await brfLines(page);
  ok('and the dot locator shows in the braille', fl.some((l) => l.trim() === '""=;;;'), fl.slice(0, 8));
  await page.context().close();
} finally {
  await browser.close();
}
console.log(`\n=== Editor code block [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
