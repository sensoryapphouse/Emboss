// A2: nothing is dropped silently on load.
//  - input/load-audit.mjs compares the DTBook source with the model; parseDtbook() puts
//    anything missing into model.warnings, which the editor shows in its notice banner.
//  - Losses it found, now kept: sidebars in list items; other sidebar and stanza children
//    (div, epigraph, address, text); block children of a list item running together;
//    a list's production note; images in table cells; tables in notes; words either side
//    of an inline image; a contents entry's own trailing number; loose text in a list.
//  - Print line numbers are content: prose ones are kept as segments (A30), verse ones as prefixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;
const here = path.dirname(fileURLToPath(import.meta.url));
const wrap = (b) => `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><book><bodymatter><level1><h1>T</h1>${b}</level1></bodymatter></book></dtbook>`;

const CASES = {
  'sidebar in a list item': `<list type="ul"><li>Item one <sidebar render="optional"><hd>Box</hd><p>Inside box alpha</p></sidebar> after</li></list>`,
  'other sidebar children': `<sidebar render="required"><p>para</p><div><p>div bravo</p></div><epigraph>epi mike</epigraph><address>addr oscar</address><sidebar><p>nested papa</p></sidebar></sidebar>`,
  'other stanza children': `<poem><linegroup><line>line one</line><div>odd romeo</div></linegroup></poem>`,
  'blocks in a list item': `<list type="ul"><li>Item <div><p>div amber</p></div><blockquote><p>bq bronze</p></blockquote><dl><dt>dune</dt><dd>ember</dd></dl></li></list>`,
  'a list production note': `<list type="ul"><hd>list hd</hd><li>a</li><prodnote>list pn tt</prodnote></list>`,
  'image in a table cell': `<table><tr><td><img src="t.png" alt="t"/> ee</td></tr></table>`,
  'table in a note': `<p>x<noteref idref="#n9">1</noteref></p><note id="n9"><p>np ii</p><table><tr><td>note td kk</td></tr></table></note>`,
  'inline image in a word': `<dl><dt>croon</dt><dd>(kr<img src="oo.png" alt=""/>n) v.</dd></dl>`,
  'loose text in a list': `<list type="ol">Imagine a TOC here</list>`,
  'contents entry ending in a number': `<list type="pl"><li class="toc-entry"><p><strong>AUDIO</strong></p><p>Remarks, November 21, 1963</p></li><li class="toc-page"><p>190</p></li></list>`,
};

for (const [name, body] of Object.entries(CASES)) {
  test(`kept: ${name}`, () => {
    const d = parseDtbook(wrap(body));
    assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));
  });
}

test('block children of a list item are separate words', () => {
  const d = parseDtbook(wrap(CASES['blocks in a list item']));
  const item = d.blocks.find((b) => b.type === 'list').items[0];
  assert.match(item.text, /amber bq/);
});

test('an image in a table cell and a table in a note are saved', () => {
  const xml = exportToNimasXml(parseDtbook(wrap(CASES['image in a table cell'] + CASES['table in a note'])));
  assert.match(xml, /src="t\.png"/);
  assert.match(xml, /note td kk/);
});

test('a contents entry keeps its trailing number when the page follows', () => {
  const it = parseDtbook(wrap(CASES['contents entry ending in a number'])).blocks.find((b) => b.type === 'list').items[0];
  assert.match(it.text, /1963$/);
  assert.equal(it.page, '190');
});

test('lost content is reported, with the first lost word in context', () => {
  const d = parseDtbook(wrap('<p>Kept words <img src="a.png" alt="a"/></p>'));
  assert.equal(d.warnings, undefined);
  const { loadWarnings } = awaitImport;
  const dom = new DOMParser().parseFromString(wrap('<p>alpha bravo</p>'), 'text/xml');
  const w = loadWarnings(dom, { blocks: [{ type: 'heading', text: 'T' }, { type: 'para', text: 'alpha' }] });
  assert.equal(w.length, 1);
  assert.match(w[0], /^1 word of the file could not be loaded \(the first is “bravo”, in “…T alpha bravo…”\)$/);
  const w2 = loadWarnings(dom, { blocks: [] });
  assert.match(w2[0], /^3 words/);
  const imgDom = new DOMParser().parseFromString(wrap('<p>a</p><img src="x.png" alt="x"/><table><tr><td>c</td></tr></table>'), 'text/xml');
  assert.deepEqual(loadWarnings(imgDom, { blocks: [{ type: 'para', text: 'T a c' }] }), ['1 image could not be loaded', '1 table could not be loaded']);
});

test('print line numbers are kept in prose and verse (class-marked ones too)', () => {
  const d = parseDtbook(wrap('<p>Some prose <span class="linenum">10</span> text.</p><poem><linegroup><line><linenum>5</linenum>A verse line</line><line><span class="linenum">6</span>Another</line></linegroup></poem>'));
  assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));
  assert.deepEqual(d.blocks[1].segments.map((g) => g.type), ['text', 'linenum', 'text']);
  assert.ok(d.blocks.some((b) => /^6 Another/.test(b.text || '')), JSON.stringify(d.blocks));
  const lost = loadWarningsFor('<p>Some prose <span class="linenum">10</span> text.</p>', [{ type: 'heading', text: 'T' }, { type: 'para', text: 'Some prose text.' }]);
  assert.match(lost[0], /the first is “10”/);
});
const loadWarningsFor = (body, blocks) => awaitImport.loadWarnings(new DOMParser().parseFromString(wrap(body), 'text/xml'), { blocks });

test('real samples load with nothing lost', () => {
  for (const f of ['9781946636171NIMAS.xml', '9780076996285NIMAS.xml', 'tableOfContents.xml']) {
    const d = parseDtbook(fs.readFileSync(path.join(here, 'nimas_samples', f), 'utf8'));
    assert.equal(d.warnings, undefined, `${f}: ${JSON.stringify(d.warnings)}`);
  }
  const big = parseDtbook(fs.readFileSync(path.join(here, 'nimas_samples', '9780544087507NIMAS.xml'), 'utf8'));
  assert.equal(big.warnings, undefined, JSON.stringify(big.warnings));
});

test('editor shows the load notices', () => {
  const ed = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  assert.match(ed, /if \(model\.warnings && model\.warnings\.length\) \{\s*showParseWarning\(/);
});

const awaitImport = await import('../input/load-audit.mjs');
