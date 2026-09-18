// Regression pins for the input-parser audit (2026-09): one check per confirmed defect, each
// built from the probe that exposed it. Node-only; shims DOMParser/XMLSerializer with
// @xmldom/xmldom like format/test-maths.mjs, and builds docx/odt/epub containers with the
// STORE-only writer in web/zip.mjs. Run: node input/parse-regressions.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
const P = await import('./parse.mjs');
const { formatDocument } = await import('../format/document.mjs');
const { makeZip } = await import('../web/zip.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const J = (x) => JSON.stringify(x);
const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const fmt = (doc) => formatDocument(doc, { translate: (t) => t, width: 38, depth: 25, mode: 'ukaaf' });
let pass = 0, fail = 0;
const check = (id, name, cond, detail) => {
  if (cond) { pass++; console.log(`ok   #${id} ${name}`); }
  else { fail++; console.log(`FAIL #${id} ${name}\n     got: ${detail}`); }
};

// #1 DOCTYPE with an internal subset: content must survive (real sample + a MathML-style subset)
{
  const real = fs.readFileSync(path.join(HERE, '../tests/nimas_samples/9781946636171NIMAS.xml'), 'utf8');
  const d = P.parseNimasXml(real);
  const nim2 = `<?xml version="1.0"?><!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "dtbook-2005-3.dtd" [ <!ENTITY % MATHML.prefixed "INCLUDE"> <!ENTITY % MATHML.prefix "m"> <!ENTITY myent "Zed"> ]>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>H</h1><p>Body text &myent;</p></level1></bodymatter></book></dtbook>`;
  const d2 = P.parseNimasXml(nim2);
  check(1, 'DOCTYPE internal subset', d.blocks.length > 100 && J(d2.blocks) === J([{ type: 'heading', level: 1, text: 'H' }, { type: 'para', text: 'Body text Zed' }]), `${d.blocks.length} blocks; ${J(d2.blocks)}`);
}

// #2 pretty-printed <p> with inline emphasis: no hard line breaks
{
  const h = P.parseHtml('<p>The quick\n      <em>brown</em>\n      fox jumps over the lazy dog and keeps going</p>');
  const brf = fmt(h);
  const lines = brf.split('\r\n');
  check(2, 'HTML source newlines are not line breaks', lines[1].startsWith('  The quick brown fox jumps') && !lines.includes('brown'), J(brf));
}

// #3 docx: hyperlink runs survive on the emphasis/segments path
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const docXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t xml:space="preserve"> link text</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>-3 is negative</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>span12</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>c3</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;
const dd = await P.parseDocx(await zipBuf([{ name: 'word/document.xml', text: docXml }]));
check(3, 'docx hyperlink text kept with bold run', J(dd.blocks[0]) === J({ type: 'para', segments: [{ type: 'text', text: 'Bold', tf: 4 }, { type: 'text', text: ' link text tail' }] }), J(dd.blocks[0]));

// #4 NIMAS <lic> pairs whose last component is a bare page number are contents entries
//    (D2, Paul 16 Sep: real NIMAC books mark contents this way; nothing is lost, and outside
//    contents the page follows the entry in braille)
const nim = `<?xml version="1.0"?><!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><book><bodymatter>
<level1><pagenum id="p1" page="normal">12</pagenum><h1>Chapter</h1>
<p>Caf&eacute; &amp; cr&egrave;me &mdash; ok &bogus;</p>
<p><img src="a.png" alt="Diagram of a cell"/></p>
<list type="pl"><li><lic>Item one</lic><lic>5</lic></li><li><lic>Item two</lic><lic>9</lic></li></list>
<list type="ul"><li>Alpha<list type="ul"><li>Beta</li></list></li><li>Gamma</li></list>
<sidebar render="required"><hd>Side</hd><list type="ul"><li><lic>x</lic><lic>3</lic></li></list>
<table><tr><th>Name</th><th>Age</th></tr><tr><th>Ann</th><td>3</td></tr></table></sidebar>
<table><tr><th>Name</th><th>Age</th></tr><tr><th>Ann</th><td colspan="2">3</td><td>z</td></tr><tr><th>Bob</th><td>5</td></tr></table>
</level1></bodymatter></book></dtbook>`;
const nd = P.parseNimasXml(nim);
const by = (type) => nd.blocks.filter((b) => b.type === type);
check(4, 'NIMAS lic pairs → contents entries', J(by('list')[0]) === J({ type: 'list', items: [{ text: 'Item one', page: '5' }, { text: 'Item two', page: '9' }], kind: 'toc', style: 'toc' }), J(by('list')[0]));

// #5 named entities decoded; unknown ones kept visible
check(5, 'named entities', by('para')[0]?.text === 'Café & crème — ok &bogus;', J(by('para')[0]));

// #6 nested lists: no duplication, nested items get level (HTML, ODT, NIMAS container + main path)
{
  const h = P.parseHtml('<ul><li>Alpha<ul><li>Beta</li></ul></li><li>Gamma</li></ul>').blocks[0];
  const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const odtXml = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="${T}" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:body><office:text>
<text:list><text:list-item><text:p>Alpha</text:p><text:list><text:list-item><text:p>Beta</text:p></text:list-item></text:list></text:list-item><text:list-item><text:p>Gamma</text:p></text:list-item></text:list>
<text:p>Name<text:tab/>Value</text:p>
<table:table><table:table-header-rows><table:table-row><table:table-cell><text:p>H1</text:p></table:table-cell><table:table-cell><text:p>H2</text:p></table:table-cell></table:table-row></table:table-header-rows><table:table-row><table:table-cell><text:p>r1c1</text:p></table:table-cell><table:table-cell><text:p>r1c2</text:p></table:table-cell></table:table-row></table:table>
</office:text></office:body></office:document-content>`;
  const od = await P.parseOdt(await zipBuf([{ name: 'content.xml', text: odtXml }]));
  globalThis.__od = od;
  const want = J([{ text: 'Alpha' }, { text: 'Beta', level: 1 }, { text: 'Gamma' }]);
  // F-33/A6, BANA Formats 2016 §8.6.2 ("Retain bullets whenever they are used in lists"):
  // the NIMAS <list type="ul"> source (line 63 above) carries no literal bullet character,
  // so parse.mjs now defaults each item's marker to '•' (formatList already renders it as
  // '_4') instead of silently dropping the bullet — the HTML/ODT parsers here go through
  // their own, unrelated list code and are unaffected, so only the NIMAS expectation adds
  // the marker.
  const wantNimas = J([{ text: 'Alpha', marker: '•' }, { text: 'Beta', marker: '•', level: 1 }, { text: 'Gamma', marker: '•' }]);
  const box = by('box')[0];
  check(6, 'nested lists not duplicated', J(h.items) === want && J(od.blocks[0].items) === want && J(by('list')[1].items) === wantNimas && J(box.blocks[1].items) === J([{ text: 'x', page: '3' }]),
    `html=${J(h.items)} odt=${J(od.blocks[0].items)} nimas=${J(by('list')[1].items)} box=${J(box.blocks[1])}`);
}

// #7 a leading minus / asterisk is content, a bullet needs a following space
check(7, 'stripLeadingBullet keeps -3 and *Note*', P.stripLeadingBullet('-3 is less than 0') === '-3 is less than 0' && P.stripLeadingBullet('*Note* this') === '*Note* this'
  && P.stripLeadingBullet('• Item') === 'Item' && P.stripLeadingBullet('- 5 degrees') === '5 degrees' && dd.blocks[1].items[0].text === '-3 is negative',
  `${P.stripLeadingBullet('-3 is less than 0')} | ${P.stripLeadingBullet('*Note* this')} | ${P.stripLeadingBullet('• Item')} | ${J(dd.blocks[1])}`);

// #8 ordered lists carry markers (HTML @start, Markdown)
{
  const h = P.parseHtml('<ol start="3"><li>First</li><li>Second</li></ol>').blocks[0];
  const m = P.parseMarkdown('1. first\n2. second\n').blocks[0];
  check(8, 'ordered list markers', J(h.items) === J([{ text: 'First', marker: '3.' }, { text: 'Second', marker: '4.' }]) && J(m.items) === J([{ text: 'first', marker: '1.' }, { text: 'second', marker: '2.' }]) && /\r\n1\. first\r\n2\. second/.test(fmt(P.parseMarkdown('1. first\n2. second\n'))),
    `html=${J(h.items)} md=${J(m.items)}`);
}

// #9 markdown: fenced code → code block; links → text; intraword underscores untouched
{
  const md = P.parseMarkdown('# T\n\n```js\nlet x = 1;\nlet y = 2;\n```\n\nsee *this* [link](http://x.com) now\n\nuse snake_case_name here and *also* this\n');
  const [, code, link, snake] = md.blocks;
  check(9, 'markdown fences/links/underscores', J(code) === J({ type: 'code', text: 'let x = 1;\nlet y = 2;' })
    && J(link.segments) === J([{ type: 'text', text: 'see ' }, { type: 'text', text: 'this', tf: 1 }, { type: 'text', text: ' link now' }])
    && J(snake.segments) === J([{ type: 'text', text: 'use snake_case_name here and ' }, { type: 'text', text: 'also', tf: 1 }, { type: 'text', text: ' this' }]),
    J(md.blocks));
}

// #10 RTF: \uc0, \rquote, \tab, cp1252
{
  const r = P.parseRtf("{\\rtf1\\ansi\\ansicpg1252\\cocoartf2709\\uc0 Heading\\par \\u8220 Hello\\u8221  world\\par don\\rquote t\\par Name\\tab Value\\par \\'93Quoted\\'94\\par caf\\'e9\\par \\uc1\\u8217\\'92s ok\\par}");
  const texts = r.blocks.map((b) => b.text);
  check(10, 'RTF unicode/char words/cp1252', J(texts) === J(['Heading', '“Hello” world', 'don’t', 'Name Value', '“Quoted”', 'café', '’s ok']), J(texts));
}

// #11 EPUB: percent-encoded hrefs resolve; nav / linear=no skipped
{
  const epub = await zipBuf([
    { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Book</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="c1" href="Chapter%201.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>' },
    { name: 'OEBPS/nav.xhtml', text: '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><h1>Contents</h1><ol><li><a href="c2.xhtml">Chapter 2</a></li></ol></nav></body></html>' },
    { name: 'OEBPS/Chapter 1.xhtml', text: '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter 1</h1><p>Chapter one body.</p></body></html>' },
    { name: 'OEBPS/c2.xhtml', text: '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter 2</h1><p>Chapter two body.</p></body></html>' },
  ]);
  const e = await P.parseEpub(epub);
  check(11, 'EPUB hrefs decoded, nav skipped', J(e.blocks) === J([{ type: 'heading', level: 1, text: 'Chapter 1' }, { type: 'para', text: 'Chapter one body.' }, { type: 'heading', level: 1, text: 'Chapter 2' }, { type: 'para', text: 'Chapter two body.' }]), J(e.blocks));
}

// #12 tables aligned: row-header th stays in its row; colspan / gridSpan pad
{
  const h = P.parseHtml('<table><tr><th>Name</th><th>Age</th></tr><tr><th>Ann</th><td>3</td></tr><tr><th>Bob</th><td>5</td></tr></table>').blocks[0];
  const t = by('table')[0];
  const dt = dd.blocks[2];
  check(12, 'table alignment', J(h) === J({ type: 'table', headers: ['Name', 'Age'], rows: [['Ann', '3'], ['Bob', '5']] })
    && J(t.rows) === J([['Ann', '3', '', 'z'], ['Bob', '5']]) && J(dt.rows) === J([['span12', '', 'c3']]),
    `html=${J(h)} nimas=${J(t)} docx=${J(dt)}`);
}

// #13 <p><img alt></p> keeps the image
{
  const h = P.parseHtml('<p><img src="a.png" alt="Diagram of a cell"/></p><p>after</p>').blocks;
  check(13, 'image inside <p>', J(h[0]) === J({ type: 'note', kind: 'image', text: 'Image: Diagram of a cell' }) && J(by('graphic')[0]) === J({ type: 'graphic', src: 'a.png', alt: 'Diagram of a cell' }), `html=${J(h)} nimas=${J(by('graphic'))}`);
}

// #14 <pagenum> → pagenum block
check(14, 'pagenum block', nd.blocks[0]?.type === 'pagenum' && nd.blocks[0].text === '12' && nd.blocks[0].page === '12' && nd.blocks[0].pageType === 'normal' && !nd.blocks.some((b) => b.type === 'para' && b.text === '12'), J(nd.blocks[0]));

// #15 .xhtml routed to the HTML parser
check(15, '.xhtml routing', J((await P.parseFile('ch1.xhtml', '<html><body><p>Hello</p></body></html>')).blocks) === J([{ type: 'para', text: 'Hello' }]), J((await P.parseFile('ch1.xhtml', '<p>Hello</p>')).blocks));

// #16 class token "g1" only — "heading1" is not grade 1
check(16, 'g1 class token match', J(P.parseHtml('<p class="heading1">Hello world</p>').blocks) === J([{ type: 'para', text: 'Hello world' }])
  && P.parseHtml('<p class="x g1">Hello world</p>').blocks[0].segments?.[0]?.uncontracted === true, J(P.parseHtml('<p class="heading1">Hello world</p>').blocks));

// #17 ODT tab + table block
{
  const od = globalThis.__od;
  check(17, 'ODT tab and table', od.blocks[1].text === 'Name Value' && J(od.blocks[2]) === J({ type: 'table', headers: ['H1', 'H2'], rows: [['r1c1', 'r1c2']] }), J(od.blocks.slice(1)));
}

console.log(`parse-regressions: ${pass}/${pass + fail} passed${fail ? ` (${fail} FAILED)` : ''}`);
if (fail) process.exitCode = 1;
