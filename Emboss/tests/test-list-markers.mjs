// Nested list items showed two markers in the editor (A85, Paul 30 Sep: "b. a. Italics", "◦ ○ Italics"): the level rules
// in web/editor/index.html forced the browser's own list marker with !important over the rule that hides it when the editor
// draws the print marker itself (data-marker), and Lexical's indent padding left a wide gap between marker and text.
// Every item that has its own marker must show no native marker, and its text must sit next to the marker at every level.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-list-markers.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = [...['w00-paul-test-word-doc-2.docx', 'w08-lists.docx', 'w17-nested-lists.docx'].map((f) => path.join(HERE, 'fixtures', 'import-audit', 'docx', f)),
  // An ODT legal list ("1.1", "1.1.1"): the label is part of the item text and the item has no marker of its own — it
  // still must not show the browser's a./i. as well (30 Sep, found merging the ODT reader fixes).
  path.join(HERE, 'fixtures', 'import-audit', 'odt', 'lo-w08-lists.odt')];
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
const page = await context.newPage();
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  for (const file of FILES) {
    const name = path.basename(file);
    await page.evaluate(() => window.markDocumentClean());
    await page.setInputFiles('#loadFileInput', file);
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => [...document.querySelectorAll('#editor li')].filter((li) => li.closest('ul,ol') && !li.closest('[data-list-kind="toc"],[data-bana-style="toc"],.bana-style-toc')).map((li) => {
      const text = li.querySelector('span');
      return {
        text: li.innerText.slice(0, 30), level: Number(li.dataset.level || 0),
        native: getComputedStyle(li).listStyleType,
        gap: text ? Math.round(text.getBoundingClientRect().left - li.getBoundingClientRect().left) : null,
        left: Math.round(li.getBoundingClientRect().left),
      };
    }));
    ok(`${name}: has list items with their own markers`, items.length > 0, items.length);
    const doubled = items.filter((i) => i.native !== 'none');
    ok(`${name}: no item shows the browser's marker as well as its own`, doubled.length === 0, doubled);
    const gaps = [...new Set(items.filter((i) => i.gap != null).map((i) => i.gap))];
    ok(`${name}: the text sits the same distance from its marker at every level`, gaps.length <= 1, gaps);
    const byLevel = new Map();
    for (const i of items) if (!byLevel.has(i.level)) byLevel.set(i.level, i.left);
    const lefts = [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    ok(`${name}: deeper levels are indented further`, lefts.every((l, k) => k === 0 || l > lefts[k - 1]), lefts);
  }
  // An item with no print marker in a bulleted list (HTML text straight inside a <ul> (#46); an ODT legal label written into the item's
  // text (D9)) shows no bullet in the editor and gets none in the braille or the saved file (1 Oct 2026: the editor's model gave it "•",
  // so the editor's braille had a bullet the reader's did not).
  await page.evaluate(() => window.markDocumentClean());
  await page.setInputFiles('#loadFileInput', path.join(HERE, 'fixtures', 'import-audit', 'html', 'h03-lists.html'));
  await page.waitForTimeout(4000);
  const loose = await page.evaluate(() => {
    const li = [...document.querySelectorAll('#editor li')].find((x) => /alphaloose/.test(x.innerText));
    return li ? { marker: li.dataset.marker, native: getComputedStyle(li).listStyleType } : null;
  });
  ok('an unmarked item in a bulleted list shows no bullet', loose && !loose.marker && loose.native === 'none', loose);
  const brf = await page.evaluate(() => window.lastBrf || '');
  ok('and the braille gives it none', /\n {0,4}LOOSE TEXT ALPHALOOSE/.test(brf) && !/_4 LOOSE TEXT ALPHALOOSE/.test(brf), brf.split(/\r?\n/).filter((l) => /ALPHALOOSE/.test(l)));
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('and the saved file marks it bana-no-marker', /<li class="bana-no-marker">loose text alphaloose<\/li>/.test(xml), (xml.match(/<li[^>]*>loose text alphaloose<\/li>/) || [])[0]);

  // A list whose nested level has another type keeps that level's type through the editor (random-action testing, 4 Nov 2026):
  // a numbered list inside an unmarked list lost its "1." "2." in the editor's braille and in the saved file; the same for a
  // lettered one, and a bulleted list inside a numbered list. Reopening the saved file must brail the same.
  const dt = (frag) => `<?xml version="1.0" encoding="UTF-8"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1><h1>H</h1>${frag}</level1></bodymatter></book></dtbook>`;
  const MIXED = [
    { label: 'numbered inside unmarked', xml: dt('<list type="pl"><li>Outer item one<list type="ol" enum="1"><li>Inner alpha</li><li>Inner beta</li></list></li><li>Outer item two</li></list>'),
      brf: [/^ *#A4 ,9N\] ALPHA/m, /^ *#B4 ,9N\] 2TA/m], saved: /<list type="pl">[\s\S]*<list type="ol">[\s\S]*Inner alpha[\s\S]*Inner beta/ },
    { label: 'lettered from c inside unmarked', xml: dt('<list type="pl"><li>Outer item one<list type="ol" enum="a" start="3"><li>Inner alpha</li><li>Inner beta</li></list></li><li>Outer item two</li></list>'),
      brf: [/^ *;C4 ,9N\] ALPHA/m, /^ *;D4 ,9N\] 2TA/m], saved: /<list type="ol" enum="a" start="3">/ },
    { label: 'bulleted inside numbered', xml: dt('<list type="ol"><li>Outer item one<list type="ul"><li>Inner alpha</li><li>Inner beta</li></list></li><li>Outer item two</li></list>'),
      brf: [/^ *_4 ,9N\] ALPHA/m, /^ *_4 ,9N\] 2TA/m], saved: /<list type="ol">[\s\S]*<list type="ul">[\s\S]*Inner alpha/ },
  ];
  for (const c of MIXED) {
    await page.evaluate(() => window.markDocumentClean());
    await page.setInputFiles('#loadFileInput', { name: 'mixed.xml', mimeType: 'text/xml', buffer: Buffer.from(c.xml) });
    await page.waitForTimeout(4000);
    const brf1 = await page.evaluate(() => window.lastBrf || '');
    for (const re of c.brf) ok(`${c.label}: the editor's braille has the inner marker ${re}`, re.test(brf1), brf1.split(/\r?\n/).filter((l) => /,9N\]/.test(l)));
    const saved = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok(`${c.label}: the saved file keeps the inner list's type`, c.saved.test(saved) && !/class="level-1"/.test(saved), saved.replace(/\s+/g, ' ').slice(saved.indexOf('<list'), saved.indexOf('<list') + 400));
    await page.evaluate(() => window.markDocumentClean());
    await page.setInputFiles('#loadFileInput', { name: 'mixed-saved.xml', mimeType: 'text/xml', buffer: Buffer.from(saved) });
    await page.waitForTimeout(4000);
    const brf2 = await page.evaluate(() => window.lastBrf || '');
    ok(`${c.label}: reopening the saved file brails the same`, brf2 === brf1 && brf2.length > 0, { a: brf1.slice(0, 300), b: brf2.slice(0, 300) });
  }
} finally {
  await browser.close();
}
console.log(`\n=== List markers [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
