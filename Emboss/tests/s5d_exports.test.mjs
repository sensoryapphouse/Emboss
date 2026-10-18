// Audit batch S5d (Emboss/docs/chatgpt-audit-15oct.md, "Dormant export APIs and boundary hardening"; Paul's decision E2, 15 Oct 2026:
// repair and test the editor's alternative saves rather than remove them). The saves exist in the editor's code (exportTextDocument:
// txt, md, html, json, docx) but are reached by no menu today; this file proves what they write.
//
//   - the plain-text, Markdown and HTML writers (web/export-formats.mjs) are one traversal of the editor model, and every block type
//     the model has is written (the audit: the old inline code left out code, box, note, poem, drama and production-page blocks and
//     assumed heading.text);
//   - the DOCX writer (web/docx-export.mjs) writes a Title style, every heading level with its inline structure, core properties,
//     real Word equations (OMML), code in a monospace style, hyperlinks with relationships, real footnote and endnote parts, semantic
//     paragraph styles before the generic paragraph, pictures with alt text, tables with header rows and captions, and list items
//     that hold only nested blocks or are term/definition pairs;
//   - round trips through Emboss's own readers (parseFile: DOCX, HTML, Markdown) keep what a document is made of;
//   - the PEF writer refuses cell and line counts that are not finite whole numbers (audit row "PEF boundary").
//
// S5D_DOCX_IMPL / S5D_TEXT_IMPL / S5D_PEF_IMPL run the same tests against another copy of a writer (the pre-change one: the failing-first evidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { richModel, latexToMathml, PNG_1PX } from './helpers/s5d-model.mjs';
import { readZip } from './helpers/zip-read.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const implUrl = (env, rel) => (process.env[env] ? pathToFileURL(path.resolve(process.env[env])).href : pathToFileURL(path.join(here, rel)).href);
const X = await import(implUrl('S5D_TEXT_IMPL', '../web/export-formats.mjs'));
const D = await import(implUrl('S5D_DOCX_IMPL', '../web/docx-export.mjs'));
const { parseFile } = await import('../input/parse.mjs');
const { mathmlToLatex } = await import('../engine/mathml-to-latex.mjs');
const { SCRIPT_MARKS } = await import('../format/text-style.mjs');
const { exportToPef } = await import(implUrl('S5D_PEF_IMPL', '../format/pef.mjs'));

const TXT = () => X.exportToText(richModel());
const MD = () => X.exportToMarkdown(richModel());
const HTML = () => X.exportToHtml(richModel(), {});
const norm = (s) => String(s || '').replace(/[\s{}]/g, '');

// ------------------------------------------------------------------------------------------------------------------------------
// the shared traversal
// ------------------------------------------------------------------------------------------------------------------------------
test('S5d: the script brackets are text-style.mjs SCRIPT_MARKS', () => {
  assert.equal(SCRIPT_MARKS.subOpen, ''); assert.equal(SCRIPT_MARKS.supOpen, ''); assert.equal(SCRIPT_MARKS.end, '');
});

test('S5d: every block type of the model is written by all three text formats, and nothing is dropped silently', () => {
  assert.equal(typeof X.buildExportDoc, 'function', 'one shared traversal');
  const doc = X.buildExportDoc(richModel());
  assert.deepEqual(doc.warnings, [], 'no block type of the rich model is unknown to the traversal');
  const kinds = new Set();
  const walk = (nodes) => { for (const n of nodes) { kinds.add(n.k); if (n.children) walk(n.children); for (const it of n.items || []) walk(it.children || []); } };
  walk(doc.nodes);
  for (const k of ['title', 'heading', 'p', 'quote', 'code', 'list', 'table', 'box', 'note', 'footnote', 'verse', 'pagebreak', 'figure', 'math', 'rule']) assert.ok(kinds.has(k), `traversal has ${k}`);
  // a phrase from every block of the rich model must be in each output
  const phrases = ['The Test Book', 'A Subtitle', 'Chapter One', 'Fifth level', 'Sixth level', 'Apples', 'Green pears', 'Third', 'A paragraph inside the item.',
    'An item holding only a nested block.', 'the smallest unit', 'a binary digit', '85 g butter', 'Fruit prices', 'Prices in pence', 'Pear', 'Prices rounded.',
    'A side box', 'Text inside the box.', 'A transcriber note.', 'Roses are red,', 'Sugar is sweet.', 'HAMLET. To be or not to be.', 'Exit, pursued by a bear.',
    'return x  +  1;', 'A quoted line.', 'Another quoted line.', 'A. Source', '12', 'A tiny red dot', 'Figure 1. A dot.', 'The dot is one pixel.',
    'The footnote text.', 'The endnote text.', 'The last paragraph.'];
  for (const [name, out] of [['txt', TXT()], ['md', MD()], ['html', HTML()]]) {
    // plain text writes the title and level 1 headings in capitals
    for (const p of phrases) assert.ok(name === 'txt' ? out.toLowerCase().includes(p.toLowerCase()) : out.includes(p), `${name} has "${p}"`);
  }
});

test('S5d: a heading or title that has only segments (no .text) is written (audit: "assumes heading.text")', () => {
  const m = { title: 'T', blocks: [
    { type: 'heading', level: 2, segments: [{ type: 'text', text: 'Only ' }, { type: 'text', text: 'segments', tf: 4 }] },
    { type: 'title', segments: [{ type: 'text', text: 'Segment title' }] },
  ] };
  assert.match(X.exportToText(m), /Only segments/);
  assert.match(X.exportToMarkdown(m), /## Only \*\*segments\*\*/);
  assert.match(X.exportToHtml(m), /<h2>Only <strong>segments<\/strong><\/h2>/);
  assert.match(X.exportToHtml(m), /<h1 class="doc-title">Segment title<\/h1>/);
  assert.match(X.exportToMarkdown(m), /# Segment title/);
});

test('S5d: a block of a type the traversal does not know is written from its text and reported', () => {
  const doc = X.buildExportDoc({ blocks: [{ type: 'mystery', text: 'Kept words' }, { type: 'mystery2' }] });
  assert.equal(doc.warnings.length, 2);
  assert.match(X.exportToText({ blocks: [{ type: 'mystery', text: 'Kept words' }] }), /Kept words/);
});

// ------------------------------------------------------------------------------------------------------------------------------
// plain text
// ------------------------------------------------------------------------------------------------------------------------------
test('S5d TXT: exact snippets', () => {
  const t = TXT();
  assert.match(t, /^THE TEST BOOK\n=+\nA Subtitle\n/);
  assert.ok(t.includes('Plain, bold, italic, underlined and a link and a citation Moby Dick and H_2O and x^2 and code_text and an equation $x^{2}+\\frac{a}{b}$ and a note[1].'));
  assert.ok(t.includes('[1] The footnote text.'));
  assert.ok(t.includes('[i] The endnote text.'));
  assert.ok(t.includes('* Pears\n    * Green pears\n* Plums'));
  assert.ok(t.includes('1. First\n2. Second\n    a. Sub a\n3. Third'));
  assert.ok(t.includes('Atom - the smallest unit\nBit - a binary digit'));
  assert.ok(t.includes('Fruit\tPrice\nApple\t40\nPear\t55'));
  assert.ok(t.includes('[Note: Prices rounded.]'));
  assert.ok(t.includes('    function f(x) {\n      return x  +  1;\n    }'), 'code keeps its whitespace');
  assert.ok(t.includes('Roses are red,\nViolets are blue.\n\nSugar is sweet.'), 'stanza break');
  assert.ok(t.includes('[Page 12]'));
  assert.ok(t.includes('[Picture: A tiny red dot]\nFigure 1. A dot.\nThe dot is one pixel.'));
  assert.ok(t.includes('$$\\sqrt{a^2+b^2}$$'));
  assert.ok(t.includes('> A quoted line.\n>\n> Another quoted line.'));
});

// ------------------------------------------------------------------------------------------------------------------------------
// Markdown
// ------------------------------------------------------------------------------------------------------------------------------
test('S5d MD: exact snippets', () => {
  const t = MD();
  assert.match(t, /^---\nauthor: Ada Author\nlang: en-GB\n---\n\n# The Test Book\n\n\*A Subtitle\*\n/);
  for (const h of ['# Chapter One', '## A **bold** heading with [a link](https://example.org/h)', '### Third level', '#### Fourth level', '##### Fifth level', '###### Sixth level']) assert.ok(t.includes(h), h);
  assert.ok(t.includes('Plain, **bold**, *italic*, <u>underlined</u> and [a link](https://example.org/a?b=1&c=2) and a citation <cite>Moby Dick</cite> and H<sub>2</sub>O and x<sup>2</sup> and `code_text` and an equation $x^{2}+\\frac{a}{b}$ and a note[^fn1].'));
  assert.ok(t.includes('[^fn1]: The footnote text.'));
  assert.ok(t.includes('[^en1]: The endnote text.'));
  assert.ok(t.includes('- Pears\n  - Green pears\n- Plums'));
  assert.ok(t.includes('1. First\n2. Second\n   1. Sub a\n3. Third'));
  assert.ok(t.includes('- Item with a block\n\n  A paragraph inside the item.\n- An item holding only a nested block.'));
  assert.ok(t.includes('- **Atom** — the smallest unit'));
  assert.ok(t.includes('| Fruit | Price |\n| --- | --- |\n| Apple | 40 |\n| **Pear** | 55 |'));
  assert.ok(t.includes('**Fruit prices**') && t.includes('*Prices in pence*'));
  assert.ok(t.includes('```\nfunction f(x) {\n  return x  +  1;\n}\n```'));
  assert.ok(t.includes('Roses are red,  \nViolets are blue.\n\nSugar is sweet.'));
  assert.ok(t.includes('$$\n\\sqrt{a^2+b^2}\n$$'));
  assert.ok(t.includes('<aside class="box"><h3>A side box</h3>'));
  assert.ok(t.includes('<span class="pagebreak" role="doc-pagebreak" title="12">[Page 12]</span>'));
  assert.ok(t.includes('![A tiny red dot](data:image/png;base64,'), 'a package picture is embedded, so the file stands alone');
});

test('S5d MD: characters Markdown would read as markup are escaped', () => {
  const t = X.exportToMarkdown({ blocks: [
    { type: 'para', text: '* not a bullet and # not a heading, 1. not a list, a_b*c [x](y) <b> $5 | pipe' },
    { type: 'para', text: '# starts like a heading' },
    { type: 'para', text: '- starts like a bullet' },
    { type: 'para', text: '2) starts like a list' },
  ] });
  assert.ok(t.includes('\\* not a bullet and # not a heading, 1. not a list, a\\_b\\*c \\[x\\](y) \\<b\\> \\$5 \\| pipe'), t);
  assert.ok(t.includes('\\# starts like a heading') && t.includes('\\- starts like a bullet') && t.includes('2\\) starts like a list'));
});

// ------------------------------------------------------------------------------------------------------------------------------
// HTML
// ------------------------------------------------------------------------------------------------------------------------------
test('S5d HTML: exact snippets', () => {
  const t = HTML();
  assert.ok(t.startsWith('<!DOCTYPE html>\n<html lang="en-GB"'));
  assert.ok(t.includes('<title>The Test Book</title>') && t.includes('<meta name="author" content="Ada Author">'));
  assert.ok(t.includes('<h1 class="doc-title">The Test Book<br>A Subtitle</h1>'));
  assert.ok(t.includes('<h2>A <strong>bold</strong> heading with <a href="https://example.org/h">a link</a></h2>'));
  assert.ok(t.includes('<h6>Sixth level</h6>'));
  assert.match(t, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"><mrow><msup><mi>x<\/mi>/);
  assert.ok(t.includes('<a href="https://example.org/a?b=1&amp;c=2">a link</a>'));
  assert.ok(t.includes('H<sub>2</sub>O') && t.includes('x<sup>2</sup>') && t.includes('<code>code_text</code>') && t.includes('<cite>Moby Dick</cite>'));
  assert.match(t, /<a class="noteref" id="ref-fn1" href="#fn1" role="doc-noteref" epub:type="noteref"><sup>1<\/sup><\/a>/);
  assert.match(t, /<aside id="fn1" class="footnote" role="doc-footnote" epub:type="footnote"><p><a class="backlink" href="#ref-fn1" role="doc-backlink" epub:type="backlink">1<\/a> The footnote text\.<\/p><\/aside>/);
  assert.match(t, /<aside id="en1" class="endnote" role="doc-endnote" epub:type="endnote">/);
  assert.ok(t.includes('<ul><li>Apples</li><li>Pears<ul><li>Green pears</li></ul></li><li>Plums</li></ul>'));
  assert.ok(t.includes('<ol><li>First</li><li>Second<ol type="a"><li>Sub a</li></ol></li><li>Third</li></ol>'));
  assert.ok(t.includes('<li><p>An item holding only a nested block.</p></li>'));
  assert.ok(t.includes('<dl><dt>Atom</dt><dd>the smallest unit</dd><dt>Bit</dt><dd>a binary digit</dd></dl>'));
  assert.ok(t.includes('<table><caption>Fruit prices — Prices in pence</caption><thead><tr><th scope="col">Fruit</th><th scope="col">Price</th></tr></thead>'));
  assert.ok(t.includes('<pre><code>function f(x) {\n  return x  +  1;\n}</code></pre>'));
  assert.ok(t.includes('<p class="poem">Roses are red,<br>Violets are blue.</p><p class="poem">Sugar is sweet.</p>'));
  assert.ok(t.includes('<blockquote><p>A quoted line.</p><p>Another quoted line.</p></blockquote>'));
  assert.ok(t.includes('<div class="pagebreak" role="doc-pagebreak" epub:type="pagebreak" title="12" data-pagenum="12"></div>'));
  assert.match(t, /<figure><img src="data:image\/png;base64,[A-Za-z0-9+\/=]+" alt="A tiny red dot"><figcaption>Figure 1\. A dot\.<\/figcaption><p class="image-description">The dot is one pixel\.<\/p><\/figure>/);
  assert.match(t, /<div class="math-block"><math display="block"/);
  assert.ok(t.includes('<aside class="box"><h3>A side box</h3>'));
  assert.ok(t.includes('<aside class="transcriber-note"><p>A transcriber note.</p></aside>'));
  assert.ok(t.includes('<hr>'));
});

test('S5d HTML: nothing in the document can run script', () => {
  const t = X.exportToHtml({ title: '</title><script>alert(1)</script>', blocks: [
    { type: 'para', segments: [{ type: 'text', text: 'click <b>me</b>', href: 'javascript:alert(1)' }, { type: 'text', text: ' and ' }, { type: 'text', text: 'data', href: 'data:text/html,<script>1</script>' }] },
    { type: 'graphic', src: 'javascript:alert(1)', alt: '"><script>x</script>' },
    { type: 'graphic', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: 'svg' },
    { type: 'para', segments: [{ type: 'math', mathml: '<math><mi>x</mi><script>alert(1)</script><mi onclick="alert(1)">y</mi><mi href="javascript:alert(2)" xlink:href="javascript:alert(3)">z</mi><annotation-xml encoding="text/html"><script>alert(4)</script></annotation-xml></math>' }] },
  ] });
  assert.ok(!/<script/i.test(t.replace(/<style>[\s\S]*<\/style>/, '')), t);
  assert.ok(!/javascript:/i.test(t) && !/data:text\/html/i.test(t) && !/onclick/i.test(t));
  assert.ok(t.includes('click &lt;b&gt;me&lt;/b&gt;'));
  assert.ok(t.includes('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), 'a picture as an SVG data URI in an <img> cannot run script and is kept');
});

// ------------------------------------------------------------------------------------------------------------------------------
// round trips through Emboss's own readers
// ------------------------------------------------------------------------------------------------------------------------------
const all = (blocks, f, out = []) => { for (const b of blocks || []) { if (!b) continue; if (f(b)) out.push(b); all(b.blocks, f, out); for (const it of b.items || []) all(it && it.blocks, f, out); } return out; };
const textOf = (b) => (b.segments ? b.segments.map((s) => s.text || s.latex || '').join('') : b.text) || '';
const segTypes = (b) => (b.segments || []).map((s) => s.type);

test('S5d round trip HTML -> parseFile: headings, emphasis, links, lists, glossary, table, notes, code, quote, page, picture, maths, verse', async () => {
  const d = await parseFile('x.html', HTML());
  assert.equal(d.title, 'The Test Book');
  const hs = d.blocks.filter((b) => b.type === 'heading');
  assert.deepEqual(hs.map((h) => h.level), [1, 1, 2, 3, 4, 5, 6]);
  const h2 = hs[2];
  assert.ok(h2.segments.some((s) => s.tf === 4 && s.text === 'bold') && h2.segments.some((s) => s.href === 'https://example.org/h'), 'inline structure in a heading');
  const p = d.blocks.find((b) => b.type === 'para' && /Plain, /.test(textOf(b)));
  assert.ok(p.segments.some((s) => s.type === 'math') && p.segments.some((s) => s.type === 'noteref'));
  assert.ok(p.segments.some((s) => s.text === 'a link' && s.href === 'https://example.org/a?b=1&c=2'));
  // (S5D-Q4, Paul 17 Oct 2026: this was a known gap — the HTML reader had no uncontracted mark for <code>; it now reads inline <code> as computer code, as the Markdown reader does)
  assert.ok(p.segments.some((s) => s.text === 'code_text' && s.uncontracted), 'inline code is read as computer code (uncontracted)');
  assert.ok(p.segments.some((s) => (s.text || '').includes('H\uE000' + '2\uE002' + 'O')) && p.segments.some((s) => (s.text || '').includes('x\uE001' + '2\uE002')), 'subscript and superscript');
  const notes = d.blocks.filter((b) => b.type === 'footnote');
  assert.deepEqual(notes.map((n) => [n.text, n.kind || 'footnote']), [['The footnote text.', 'footnote'], ['The endnote text.', 'endnote']]);
  const lists = d.blocks.filter((b) => b.type === 'list');
  assert.deepEqual(lists[0].items.map((i) => [i.text, i.level || 0]), [['Apples', 0], ['Pears', 0], ['Green pears', 1], ['Plums', 0]]);
  assert.deepEqual(lists[1].items.map((i) => [i.text, i.marker, i.level || 0]), [['First', '1.', 0], ['Second', '2.', 0], ['Sub a', 'a.', 1], ['Third', '3.', 0]]);
  assert.equal(lists[2].items.length, 2);
  assert.ok(lists.some((l) => l.kind === 'glossary' && l.items.length === 2));
  const tbl = d.blocks.find((b) => b.type === 'table');
  assert.deepEqual(tbl.headers, ['Fruit', 'Price']);
  assert.equal(tbl.rows.length, 2);
  assert.ok(d.blocks.some((b) => b.type === 'caption' && /Fruit prices/.test(b.text)));
  assert.ok(d.blocks.some((b) => b.type === 'code' && b.text === 'function f(x) {\n  return x  +  1;\n}'));
  assert.equal(d.blocks.filter((b) => b.style === 'quote').length, 2);
  assert.ok(d.blocks.some((b) => b.type === 'pagenum' && b.page === '12'));
  const g = d.blocks.find((b) => b.type === 'graphic');
  assert.equal(g.alt, 'A tiny red dot'); assert.equal(g.caption, 'Figure 1. A dot.'); assert.match(g.src, /^data:image\/png;base64,/);
  assert.equal(g.description, 'The dot is one pixel.', 'S5D-Q4 (Paul 17 Oct 2026): the picture\'s description paragraph is read back (it was a known gap: lost)');
  const mb = d.blocks.find((b) => b.type === 'math');
  assert.equal(norm(mathmlToLatex(mb.mathml)), norm('\\sqrt{a^2+b^2}'));
  assert.deepEqual(d.blocks.filter((b) => b.fromPoem).map((b) => b.text), ['Roses are red,', 'Violets are blue.', 'Sugar is sweet.']);
  assert.ok(d.blocks.some((b) => b.type === 'box' && b.title === 'A side box'));
});

test('S5d round trip Markdown -> parseFile: title, headings, emphasis, links, maths, notes, lists, table, code, quote, picture', async () => {
  const d = await parseFile('x.md', MD());
  assert.equal(d.title, 'The Test Book');
  assert.equal(d.blocks[0].type, 'title');
  assert.deepEqual(d.blocks.filter((b) => b.type === 'heading').map((h) => h.level), [1, 2, 3, 4, 5, 6]);
  const p = d.blocks.find((b) => b.type === 'para' && /Plain, /.test(textOf(b)));
  assert.ok(p.segments.some((s) => s.tf === 4 && s.text === 'bold') && p.segments.some((s) => s.tf === 1 && s.text === 'italic') && p.segments.some((s) => s.tf === 2 && s.text === 'underlined'));
  assert.ok(p.segments.some((s) => s.text === 'a link' && s.href === 'https://example.org/a?b=1&c=2'));
  const m = p.segments.find((s) => s.type === 'math');
  assert.equal(norm(m.latex), norm('x^{2}+\\frac{a}{b}'));
  assert.ok(p.segments.some((s) => s.type === 'noteref'));
  assert.ok(p.segments.some((s) => s.text === 'code_text' && s.uncontracted) && p.segments.some((s) => (s.text || '').includes('H\uE000' + '2\uE002' + 'O')));
  assert.deepEqual(d.blocks.filter((b) => b.type === 'footnote').map((n) => n.text), ['The footnote text.', 'The endnote text.']);
  const lists = d.blocks.filter((b) => b.type === 'list');
  assert.deepEqual(lists[0].items.map((i) => [i.text, i.level || 0]), [['Apples', 0], ['Pears', 0], ['Green pears', 1], ['Plums', 0]]);
  assert.deepEqual(lists[1].items.map((i) => i.marker), ['1.', '2.', '1.', '3.']);
  assert.equal(lists[2].items.length, 2, 'an item holding only a block is still an item');
  const tbl = d.blocks.find((b) => b.type === 'table');
  assert.deepEqual(tbl.headers, ['Fruit', 'Price']);
  assert.ok(d.blocks.some((b) => b.type === 'code' && b.text === 'function f(x) {\n  return x  +  1;\n}'));
  assert.equal(d.blocks.filter((b) => b.style === 'quote' && /quoted line/.test(b.text)).length, 2);
  const g = d.blocks.find((b) => b.type === 'graphic');
  assert.equal(g.alt, 'A tiny red dot');
  assert.ok(d.blocks.some((b) => b.type === 'math' && norm(b.latex) === norm('\\sqrt{a^2+b^2}')));
  assert.ok(d.blocks.some((b) => b.type === 'box' && b.title === 'A side box'));
  assert.ok(d.blocks.some((b) => /\[Page 12\]/.test(textOf(b))), 'the page break stays visible (the Markdown reader has no page-break markup)');
});

// ------------------------------------------------------------------------------------------------------------------------------
// DOCX
// ------------------------------------------------------------------------------------------------------------------------------
async function docx(model = richModel(), opts = { latexToMathml }) {
  const blob = D.exportToDocxBlob(model, model.title || 'Document', opts);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts = readZip(bytes);
  const text = (n) => (parts.has(n) ? parts.get(n).toString('utf8') : null);
  return { bytes, parts, text, doc: text('word/document.xml') };
}
const xmlOk = (name, xml) => {
  const errs = [];
  const dp = new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') errs.push(msg); } });
  const d = dp.parseFromString(xml, 'text/xml');
  assert.deepEqual(errs, [], `${name} is well-formed XML`);
  return d;
};
// the order WordprocessingML requires inside w:pPr and w:rPr (Word refuses or repairs a file that breaks it)
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
function checkOrder(dom, tag, order, label) {
  for (const el of Array.from(dom.getElementsByTagName(tag))) {
    const names = Array.from(el.childNodes).filter((c) => c.nodeType === 1).map((c) => c.localName);
    const idx = names.map((n) => order.indexOf(n));
    assert.ok(!idx.includes(-1), `${label}: unknown child in ${tag}: ${names}`);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${label}: ${tag} children in schema order: ${names}`);
  }
}

test('S5d DOCX: the package has its parts, and every part is well-formed with Word\'s element order', async () => {
  const { parts, text } = await docx();
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/settings.xml',
    'word/footnotes.xml', 'word/endnotes.xml', 'word/_rels/document.xml.rels', 'word/media/image1.png']) assert.ok(parts.has(n), `part ${n}`);
  for (const [n] of parts) if (/\.(xml|rels)$/.test(n)) {
    const dom = xmlOk(n, text(n));
    if (/^word\/(document|footnotes|endnotes)\.xml$/.test(n)) { checkOrder(dom, 'w:pPr', PPR_ORDER, n); checkOrder(dom, 'w:rPr', RPR_ORDER, n); }
  }
  const ct = text('[Content_Types].xml');
  for (const frag of ['Extension="png"', '/word/footnotes.xml', '/word/endnotes.xml', '/word/settings.xml', '/docProps/core.xml']) assert.ok(ct.includes(frag), `content type for ${frag}`);
  assert.deepEqual(Array.from(parts.get('word/media/image1.png')), Array.from(PNG_1PX), 'the picture bytes are the model\'s');
});

test('S5d DOCX: core properties (title, author, language)', async () => {
  const { text } = await docx();
  const core = text('docProps/core.xml');
  assert.match(core, /<dc:title>The Test Book<\/dc:title>/);
  assert.match(core, /<dc:creator>Ada Author<\/dc:creator>/);
  assert.match(core, /<dc:language>en-GB<\/dc:language>/);
  assert.match(text('word/styles.xml'), /<w:lang w:val="en-GB"/);
  assert.match(text('_rels/.rels'), /core-properties/);
});

test('S5d DOCX: Title and Subtitle styles for the title, heading styles 1-6 with outline levels, inline structure in a heading', async () => {
  const { doc, text } = await docx();
  assert.match(doc, /<w:pStyle w:val="Title"\/>.*?The Test Book/);
  assert.match(doc, /<w:pStyle w:val="Subtitle"\/>.*?A Subtitle/);
  for (let l = 1; l <= 6; l++) assert.ok(doc.includes(`<w:pStyle w:val="Heading${l}"/>`), `Heading${l}`);
  const st = text('word/styles.xml');
  for (const id of ['Title', 'Subtitle', 'Heading4', 'Heading5', 'Heading6', 'Hyperlink', 'FootnoteText', 'FootnoteReference', 'EndnoteText', 'EndnoteReference', 'SourceCode', 'Quote', 'Caption']) assert.ok(st.includes(`w:styleId="${id}"`), `style ${id}`);
  assert.match(st, /w:styleId="Heading4"[\s\S]*?<w:outlineLvl w:val="3"\/>/);
  const h2 = doc.match(/<w:p><w:pPr><w:pStyle w:val="Heading2"\/>(?:<w:keepNext\/>)?<\/w:pPr>.*?<\/w:p>/)[0];
  assert.match(h2, /<w:b\/>.*?<w:t xml:space="preserve">bold<\/w:t>/, 'bold run inside the heading');
  assert.match(h2, /<w:hyperlink r:id="rId\d+"[^>]*>.*?a link/, 'link inside the heading');
});

test('S5d DOCX: hyperlinks have external relationships', async () => {
  const { doc, text } = await docx();
  const rels = text('word/_rels/document.xml.rels');
  const m = doc.match(/<w:hyperlink r:id="(rId\d+)"[^>]*>(?:(?!<\/w:hyperlink>).)*?a link/);
  assert.ok(m, 'a hyperlink element');
  const rel = new RegExp(`<Relationship Id="${m[1]}"[^>]*>`).exec(rels)[0];
  assert.match(rel, /relationships\/hyperlink/); assert.match(rel, /TargetMode="External"/);
  assert.ok(rels.includes('Target="https://example.org/a?b=1&amp;c=2"'));
  assert.ok(!/javascript:/i.test(rels));
});

test('S5d DOCX: equations are Word equations (OMML), not dollar text', async () => {
  const { doc } = await docx();
  assert.ok(!/\$x|\$\$|\\frac|\\sqrt/.test(doc), 'no LaTeX or dollar text in the body');
  assert.match(doc, /xmlns:m="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math"/);
  assert.match(doc, /<m:oMath><m:sSup>.*?<m:f>/s, 'inline x^2 + a/b');
  assert.match(doc, /<m:oMathPara><m:oMath><m:rad>/, 'block equation, square root');
  assert.match(doc, /<m:num>.*?<m:t[^>]*>a<\/m:t>.*?<\/m:num><m:den>.*?<m:t[^>]*>b<\/m:t>/s);
});

test('S5d DOCX: code keeps its whitespace in a monospace style, one paragraph per line', async () => {
  const { doc } = await docx();
  const codeParas = doc.match(/<w:p><w:pPr><w:pStyle w:val="SourceCode"\/>.*?<\/w:p>/g) || [];
  assert.equal(codeParas.length, 3);
  assert.match(codeParas[1], /Consolas/);
  assert.match(codeParas[1], /<w:t xml:space="preserve">  return x  \+  1;<\/w:t>/);
});

test('S5d DOCX: real footnotes and endnotes with references; marks that are not the automatic numbers are written as custom marks', async () => {
  const { doc, text } = await docx();
  assert.match(doc, /<w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference w:id="1"\/><\/w:r>/);
  assert.match(doc, /<w:endnoteReference w:customMarkFollows="1" w:id="1"\/><\/w:r><w:r>.*?<w:t[^>]*>i<\/w:t>/s, 'the endnote mark "i" is not the automatic number 1');
  const fn = text('word/footnotes.xml');
  assert.match(fn, /<w:footnote w:id="1">.*?The footnote text\./s);
  assert.match(fn, /w:type="separator"/);
  assert.match(text('word/endnotes.xml'), /<w:endnote w:id="1">.*?The endnote text\./s);
  assert.ok(!/The footnote text\./.test(doc), 'a cited note is in its part, not also in the body');
  assert.match(text('word/settings.xml'), /<w:footnotePr>/);
});

test('S5d DOCX: semantic styles come before the generic paragraph (quote, attribution, stage, caption, verse)', async () => {
  const { doc } = await docx();
  assert.match(doc, /<w:pStyle w:val="Quote"\/>.*?A quoted line\./s);
  assert.match(doc, /<w:pStyle w:val="EmbossByline"\/>.*?A\. Source/s);
  assert.match(doc, /<w:pStyle w:val="EmbossVerse"\/>.*?Roses are red,/s);
  const { doc: d2 } = await docx({ blocks: [{ type: 'para', style: 'quote', text: 'Q' }, { type: 'para', style: 'attribution', text: 'B' }, { type: 'caption', text: 'C' }] });
  assert.match(d2, /<w:pStyle w:val="Quote"\/>/); assert.match(d2, /<w:pStyle w:val="EmbossByline"\/>/); assert.match(d2, /<w:pStyle w:val="EmbossCaption"\/>/);
});

test('S5d DOCX: pictures are embedded with their alt text; the caption follows in the Caption style; an SVG is a described placeholder', async () => {
  const { doc, text } = await docx();
  assert.match(doc, /<w:drawing><wp:inline[^>]*>.*?<wp:docPr id="\d+" name="Picture \d+" descr="A tiny red dot"\/>.*?<a:blip r:embed="(rId\d+)"\/>/s);
  const rid = /<a:blip r:embed="(rId\d+)"/.exec(doc)[1];
  assert.match(text('word/_rels/document.xml.rels'), new RegExp(`Id="${rid}"[^>]*relationships/image"[^>]*Target="media/image1\\.png"`));
  assert.match(doc, /<w:pStyle w:val="Caption"\/>.*?Figure 1\. A dot\./s);
  assert.match(doc, /The dot is one pixel\./);
  const { doc: d2 } = await docx({ blocks: [{ type: 'graphic', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: 'A tactile map' }] });
  assert.ok(!d2.includes('<w:drawing>') && d2.includes('[Graphic: A tactile map]'));
});

test('S5d DOCX: a table has a header row, borders and its title and caption above', async () => {
  const { doc } = await docx();
  const at = doc.indexOf('<w:tbl>');
  assert.ok(at > 0);
  const before = doc.slice(Math.max(0, at - 700), at);
  assert.match(before, /Fruit prices/); assert.match(before, /Prices in pence/);
  assert.match(doc.slice(at), /<w:tr><w:trPr><w:tblHeader\/><\/w:trPr><w:tc>.*?Fruit/s);
  assert.match(doc.slice(at, at + 400), /<w:tblW w:w="5000" w:type="pct"\/>/);
  assert.match(doc, /Prices rounded\./);
});

test('S5d DOCX: list items that hold only a nested block or are term/definition pairs are written', async () => {
  const { doc } = await docx({ blocks: [
    { type: 'list', items: [{ marker: '•', blocks: [{ type: 'para', text: 'Only a block' }] }, { text: 'Normal', marker: '•' }] },
    { type: 'list', kind: 'glossary', items: [{ term: 'Atom', def: 'smallest' }, { termSegments: [{ type: 'text', text: 'Bit', tf: 4 }], term: 'Bit', def: 'binary digit' }] },
    { type: 'glossary', items: [{ term: 'Byte', def: 'eight bits' }] },
  ] });
  assert.match(doc, /ListBullet.*?Only a block/s);
  for (const w of ['Atom', 'smallest', 'Bit', 'binary digit', 'Byte', 'eight bits']) assert.ok(doc.includes(w), w);
});

test('S5d DOCX: a box is a run of paragraphs bordered on four sides', async () => {
  const { doc } = await docx();
  const boxed = doc.match(/<w:p><w:pPr>(?:(?!<\/w:pPr>).)*?<w:pBdr><w:top [^>]*\/><w:left [^>]*\/><w:bottom [^>]*\/><w:right [^>]*\/><\/w:pBdr>.*?<\/w:p>/gs) || [];
  assert.equal(boxed.length, 2, 'the box heading and its paragraph');
});

test('S5d round trip DOCX -> parseFile: title, headings, links, lists, glossary, table, notes, code, quote, picture, equations', async () => {
  const { bytes } = await docx();
  const d = await parseFile('x.docx', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(d.title, 'The Test Book');
  assert.equal(d.metadata && d.metadata.creator, 'Ada Author');
  const t0 = d.blocks[0];
  assert.equal(t0.type, 'title'); assert.equal(t0.text, 'The Test Book\nA Subtitle');
  assert.deepEqual(d.blocks.filter((b) => b.type === 'heading').map((h) => h.level), [1, 2, 3, 4, 5, 6]);
  const h2 = d.blocks.find((b) => b.type === 'heading' && b.level === 2);
  assert.ok(h2.segments.some((s) => s.tf === 4 && s.text === 'bold') && h2.segments.some((s) => s.href === 'https://example.org/h'));
  const p = d.blocks.find((b) => b.type === 'para' && /Plain, /.test(textOf(b)));
  assert.ok(p.segments.some((s) => s.text === 'a link' && s.href === 'https://example.org/a?b=1&c=2'));
  assert.ok(p.segments.some((s) => s.type === 'noteref'));
  const im = p.segments.find((s) => s.type === 'math');
  assert.ok(im, 'inline equation read back as maths');
  assert.equal(norm(mathmlToLatex(im.mathml)), norm('x^{2}+\\frac{a}{b}'));
  assert.ok(p.segments.some((s) => /H/.test(s.text || '') && //.test(s.text || '')), 'subscript');
  const fns = d.blocks.filter((b) => b.type === 'footnote');
  // (S5D-Q4, Paul 17 Oct 2026 — a known gap closed: a custom mark such as the endnote's "i" is a (raised) run of the note's own text in Word;
  // Emboss's reader now takes it as the reference's own mark and no longer leaves it at the start of the note's text)
  assert.deepEqual(fns.map((n) => [n.text.replace(/[\uE000-\uE002]/g, ''), n.kind || 'footnote']), [['The footnote text.', 'footnote'], ['The endnote text.', 'endnote']]);
  assert.ok(p.segments.some((s) => s.type === 'noteref' && s.text === 'i') || d.blocks.some((b) => (b.segments || []).some((s) => s.type === 'noteref' && s.text === 'i')), 'the endnote reference keeps its mark "i"');
  const lists = d.blocks.filter((b) => b.type === 'list');
  // (Word lists that follow each other are one list to Emboss's reader, as they were before S5d: the items are checked in order)
  const items = lists.filter((l) => l.kind !== 'glossary').flatMap((l) => l.items);
  const seq = (from, n) => items.slice(from, from + n).map((i) => [i.text, i.marker, i.level || 0]);
  assert.deepEqual(seq(0, 4), [['Apples', '\u2022', 0], ['Pears', '\u2022', 0], ['Green pears', '\u2022', 1], ['Plums', '\u2022', 0]]);
  assert.deepEqual(seq(4, 4), [['First', '1.', 0], ['Second', '2.', 0], ['Sub a', 'a.', 1], ['Third', '3.', 0]]);
  assert.ok(items.some((i) => /nested block/.test(i.text || '')), 'the item holding only a nested block');
  assert.ok(items.some((i) => i.text === 'Item with a block' && (i.blocks || []).some((b) => /inside the item/.test(b.text))), 'an item with a further paragraph');
  assert.ok(lists.some((l) => l.kind === 'glossary' || l.items.some((i) => i.term === 'Atom') || l.items.some((i) => /Atom/.test(i.text))));
  const tbl = d.blocks.find((b) => b.type === 'table');
  assert.deepEqual(tbl.headers.map((h) => (typeof h === 'string' ? h : h.text)), ['Fruit', 'Price']);
  assert.equal(tbl.rows.length, 2);
  // (the table's title is a Word Caption paragraph; Emboss's reader takes only a "Table N" caption as a table title)
  assert.ok(d.blocks.some((b) => /Fruit prices/.test(b.text || b.title || '')) && d.blocks.some((b) => b.type === 'caption' && /Prices in pence/.test(b.text)));
  assert.ok(d.blocks.some((b) => b.type === 'note' && b.kind === 'tabletn' && /Prices rounded/.test(b.text)));
  assert.ok(d.blocks.some((b) => b.type === 'code' && b.text === 'function f(x) {\n  return x  +  1;\n}'), 'code with its whitespace');
  assert.equal(d.blocks.filter((b) => b.style === 'quote').length, 2);
  const g = d.blocks.find((b) => b.type === 'graphic');
  assert.equal(g.alt, 'A tiny red dot'); assert.equal(g.caption, 'Figure 1. A dot.');
  const res = (d.resources || []).find((r) => r.path === g.src);
  assert.ok(res, 'the picture came back as a resource'); assert.deepEqual(Array.from(res.bytes), Array.from(PNG_1PX));
  const mb = d.blocks.find((b) => b.type === 'math');
  assert.equal(norm(mathmlToLatex(mb.mathml)), norm('\\sqrt{a^2+b^2}'));
  assert.ok(d.blocks.some((b) => b.type === 'box' && /side box/i.test(b.title || '')), 'the bordered run is a box');
  assert.ok(d.blocks.some((b) => b.type === 'note' && /transcriber note/.test(b.text)));
});

test('S5d DOCX: maths without MathML is converted when the caller gives a converter, and is plain text otherwise', async () => {
  const m = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'v ' }, { type: 'math', latex: 'a^2' }] }] };
  const withConv = await docx(m, { latexToMathml });
  assert.match(withConv.doc, /<m:oMath><m:sSup>/);
  const without = await docx(m, {});
  assert.ok(without.doc.includes('a^2') && !/<m:sSup>/.test(without.doc));
  assert.match(without.doc, /<m:oMath>.*?<m:t[^>]*>a\^2<\/m:t>/s, 'still an equation object, holding the LaTeX as text');
});

test('S5d DOCX: the existing list, empty-item and glossary behaviour is unchanged (tests/docx_plain_list.test.mjs covers the round trip)', async () => {
  const { doc } = await docx({ blocks: [{ type: 'list', items: [{ text: '' }, { text: 'kept', marker: '•' }] }] });
  assert.ok(doc.includes('kept'));
});

// ------------------------------------------------------------------------------------------------------------------------------
// PEF boundary (audit row "PEF boundary": the exporter accepted fractional direct-API dimensions)
// ------------------------------------------------------------------------------------------------------------------------------
test('S5d PEF: cells and lines must be finite whole numbers', () => {
  const model = { title: 'T', blocks: [{ type: 'para', text: 'hello' }] };
  const translate = (t) => t;
  for (const bad of [{ width: 10.5 }, { depth: 5.25 }, { width: NaN }, { depth: Infinity }, { width: -3 }, { depth: 0 }, { width: '12abc' }, { width: '12.5' }]) {
    assert.throws(() => exportToPef(model, { mode: 'bana', translate, ...bad }), /whole number/i, JSON.stringify(bad));
  }
  const warn = console.warn; console.warn = () => {};
  let ok;
  try { ok = exportToPef(model, { mode: 'bana', translate, width: 40, depth: 25 }); } finally { console.warn = warn; }
  assert.match(ok, /<pef /);
  assert.match(ok, /cols="40" rows="25"/);
});

// ------------------------------------------------------------------------------------------------------------------------------
// edges: empty and odd models, hostile characters, notes, header groups, deep lists, the build
// ------------------------------------------------------------------------------------------------------------------------------
test('S5d: empty, partial and odd models do not throw in any format', async () => {
  const models = [null, undefined, {}, { blocks: [] }, { blocks: [null, 5, 'x', {}, { type: 'para' }, { type: 'list' }, { type: 'list', items: [null, {}, { text: '' }] }, { type: 'table' }, { type: 'table', headers: null, rows: [null, [null]] }, { type: 'box' }, { type: 'heading' }, { type: 'graphic' }, { type: 'footnote' }] }];
  for (const m of models) {
    for (const f of [X.exportToText, X.exportToMarkdown, X.exportToHtml]) assert.equal(typeof f(m), 'string');
    const blob = D.exportToDocxBlob(m, 'T');
    const parts = readZip(new Uint8Array(await blob.arrayBuffer()));
    for (const [n, buf] of parts) if (/\.(xml|rels)$/.test(n)) xmlOk(n, buf.toString('utf8'));
  }
  assert.equal(X.exportToText({ blocks: [] }).trim(), '');
});

test('S5d: characters XML cannot hold, and markup in the text, cannot break a Word file', async () => {
  const bad = 'a\u0000b\u0008c\u000Bd\u001Fe￾f\uD800g <tag> & "q" \'s\'   end';
  const { parts, doc } = await docx({ title: bad, metadata: { creator: bad, language: 'x"><evil' }, blocks: [
    { type: 'para', text: bad }, { type: 'heading', level: 1, text: bad }, { type: 'code', text: bad },
    { type: 'para', segments: [{ type: 'text', text: bad, href: 'https://x.org/?a=1&b="2"' }, { type: 'math', mathml: '<math><mi>x</mi><mo>&lt;</mo><mi>y</mi></math>' }] },
    { type: 'table', headers: [bad], rows: [[bad]] },
  ] });
  for (const [n, buf] of parts) if (/\.(xml|rels)$/.test(n)) xmlOk(n, buf.toString('utf8'));
  assert.ok(!/[\u0000-\u0008\u000B\u001F￾]/.test(doc));
  assert.ok(doc.includes('&lt;tag&gt; &amp; &quot;q&quot;'));
  assert.ok(!/<evil/.test(parts.get('word/styles.xml').toString('utf8')) && !/<evil/.test(parts.get('docProps/core.xml').toString('utf8')));
  assert.match(doc, /<m:t[^>]*>&lt;<\/m:t>/, 'a less-than sign in MathML stays text');
});

test('S5d: header groups (a two-tier table heading) in every format', async () => {
  const m = { blocks: [{ type: 'table', headerGroups: [{ text: 'Group A', from: 0, to: 1 }, { text: 'Group B', from: 2, to: 2 }], headers: ['a1', 'a2', 'b1'], rows: [['1', '2', '3']] }] };
  assert.ok(X.exportToHtml(m).includes('<thead><tr><th scope="colgroup" colspan="2">Group A</th><th scope="colgroup" colspan="1">Group B</th></tr><tr><th scope="col">a1</th><th scope="col">a2</th><th scope="col">b1</th></tr></thead>'));
  assert.match(X.exportToMarkdown(m), /\| Group A — a1 \| Group A — a2 \| Group B — b1 \|/);
  assert.match(X.exportToText(m), /Group A\tGroup A\tGroup B\na1\ta2\tb1\n1\t2\t3/);
  const { doc } = await docx(m);
  assert.match(doc, /<w:gridSpan w:val="2"\/>.*?Group A/s);
  assert.equal((doc.match(/<w:tblHeader\/>/g) || []).length, 2);
});

test('S5d: deep and uneven lists nest by level in every format', async () => {
  const m = { blocks: [{ type: 'list', items: [
    { text: 'deep first', marker: '•', level: 2 }, { text: 'back', marker: '•' }, { text: 'one', marker: '•', level: 1 }, { text: 'two', marker: '•', level: 2 }, { text: 'three', marker: '•', level: 3 }, { text: 'again', marker: '•' },
  ] }] };
  assert.equal(X.exportToHtml(m).match(/<body>\n([\s\S]*?)\n<\/body>/)[1], '<ul><li>deep first</li><li>back<ul><li>one<ul><li>two<ul><li>three</li></ul></li></ul></li></ul></li><li>again</li></ul>');
  assert.ok(X.exportToMarkdown(m).includes('- back\n  - one\n    - two\n      - three\n- again'));
  assert.ok(X.exportToText(m).includes('* back\n    * one\n        * two\n            * three\n* again'));
});

test('S5d: a note reference whose note is not in the document, and a note nobody cites, are written in every format', async () => {
  const m = { blocks: [
    { type: 'para', segments: [{ type: 'text', text: 'Cites nothing' }, { type: 'noteref', text: '9', idref: 'nowhere' }] },
    { type: 'footnote', id: 'lonely', text: 'Nobody cites this note.' },
    { type: 'footnote', id: 'multi', blocks: [{ type: 'para', text: 'First paragraph of note.' }, { type: 'para', text: 'Second paragraph of note.' }] },
    { type: 'para', segments: [{ type: 'text', text: 'Cites twice' }, { type: 'noteref', text: '1', idref: 'multi' }, { type: 'text', text: ' and ' }, { type: 'noteref', text: '1', idref: 'multi' }] },
  ] };
  assert.ok(X.exportToHtml(m).includes('<sup>9</sup>') && X.exportToHtml(m).includes('Nobody cites this note.'));
  assert.ok(X.exportToMarkdown(m).includes('<sup>9</sup>') && X.exportToMarkdown(m).includes('[^lonely]: Nobody cites this note.'));
  assert.ok(X.exportToMarkdown(m).includes('[^multi]: First paragraph of note.\n\n    Second paragraph of note.'));
  assert.ok(X.exportToText(m).includes('Nobody cites this note.'));
  const { doc, text } = await docx(m);
  assert.match(doc, /EmbossFootnote.*?Nobody cites this note\./s, 'an uncited note stays a paragraph');
  assert.equal((doc.match(/<w:footnoteReference /g) || []).length, 1, 'a note is referenced once (Word cannot reference a note twice); the second citation is the mark as raised text');
  const fn = text('word/footnotes.xml');
  assert.match(fn, /First paragraph of note\.[\s\S]*Second paragraph of note\./);
  assert.ok(!/Nobody cites/.test(fn));
  assert.match(doc, /<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">9<\/w:t>/, 'an unmatched reference keeps its mark');
});

test('S5d DOCX: a link inside a footnote has its relationship in the footnote part', async () => {
  const { parts, text } = await docx({ blocks: [
    { type: 'para', segments: [{ type: 'text', text: 'x' }, { type: 'noteref', text: '1', idref: 'n' }] },
    { type: 'footnote', id: 'n', segments: [{ type: 'text', text: 'see ' }, { type: 'text', text: 'here', href: 'https://example.org/note' }] },
  ] });
  assert.ok(parts.has('word/_rels/footnotes.xml.rels'));
  const rid = /<w:hyperlink r:id="(rId\d+)"/.exec(text('word/footnotes.xml'))[1];
  assert.match(text('word/_rels/footnotes.xml.rels'), new RegExp(`Id="${rid}"[^>]*Target="https://example.org/note"[^>]*TargetMode="External"`));
});

test('S5d DOCX: a picture the model holds as a data URI (JPEG, GIF) is embedded; one it cannot read is a placeholder', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64').toString('base64');
  const { parts, doc } = await docx({ blocks: [
    { type: 'graphic', src: `data:image/gif;base64,${gif}`, alt: 'a gif' },
    { type: 'graphic', src: 'https://example.org/remote.png', alt: 'remote' },
    { type: 'graphic', src: 'data:image/png;base64,AAAA', alt: 'broken png' },
  ] });
  assert.ok(parts.has('word/media/image1.gif') && !parts.has('word/media/image2.gif'));
  assert.match(doc, /descr="a gif"/);
  assert.ok(doc.includes('[Graphic: remote]') && doc.includes('[Graphic: broken png]'));
  assert.match(parts.get('[Content_Types].xml').toString('utf8'), /Extension="gif" ContentType="image\/gif"/);
});

test('S5d: export-formats.mjs is in the production build (build-dist.mjs copies it; the dist service worker list is generated from it)', async () => {
  const fs = await import('node:fs');
  const build = fs.readFileSync(path.join(here, '..', 'scripts', 'build-dist.mjs'), 'utf8');
  assert.match(build, /\['web\/export-formats\.mjs', 'export-formats\.mjs'\]/);
  const editor = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  assert.match(editor, /from '\/web\/export-formats\.mjs'/);
  assert.doesNotMatch(editor.slice(editor.indexOf('function exportTextDocument'), editor.indexOf('window.__embossTestSaveAs')), /lastModel\??\.blocks|exportToDocxBlob\(lastModel/, 'no alternative save reads lastModel');
});

// ------------------------------------------------------------------------------------------------------------------------------
// real documents: the shipped NIMAS samples through every writer (no word lost, nothing unknown to the traversal)
// ------------------------------------------------------------------------------------------------------------------------------
test('S5d real NIMAS samples: all four writers run, every Word part is well-formed, and a Word round trip loses no word', async () => {
  const fs = await import('node:fs');
  const dir = path.join(here, 'nimas_samples');
  const words = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  // the words of a model: a block's own text (not its parts as well), a box's title once, a picture's alt text and caption, table cells
  const wordsOf = (blocks, out = []) => {
    for (const b of blocks || []) {
      if (!b || typeof b !== 'object') continue;
      if (b.title) out.push(String(b.title));
      if (b.alt) out.push(b.alt);
      if (b.caption) out.push(String(b.caption));
      const own = b.segments ? b.segments.map((s) => s.text || '').join('') : b.text;
      if (own) out.push(own);
      for (const it of b.items || []) { out.push(it.segments ? it.segments.map((s) => s.text || '').join('') : (it.text || '')); wordsOf(it.blocks, out); }
      for (const r of b.rows ? [b.headers || [], ...b.rows] : []) for (const c of r) out.push(typeof c === 'string' ? c : (c && c.text) || '');
      const kids = b.blocks && !own ? (b.type === 'box' && b.blocks[0] && b.blocks[0].type === 'heading' && String(b.blocks[0].text || '').trim() === String(b.title || '').trim() ? b.blocks.slice(1) : b.blocks) : null;
      if (kids) wordsOf(kids, out);
    }
    return out;
  };
  const count = (arr) => { const m = new Map(); for (const w of arr) m.set(w, (m.get(w) || 0) + 1); return m; };
  const files = ['NIMAS_valid_baseline.xml', 'glossary.xml', 'dontworrybehappy.xml', 'nimas_test.xml', 'TablesTestXml.xml', 'tableOfContents.xml', 'basicDTBook.xml', '9780076996285NIMAS.xml'];
  for (const f of files) {
    const m = await parseFile(f, fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.deepEqual(X.buildExportDoc(m).warnings, [], `${f}: every block type is known`);
    for (const fn of [X.exportToText, X.exportToMarkdown, X.exportToHtml]) assert.ok(fn(m).length > 0);
    const blob = D.exportToDocxBlob(m, f, { latexToMathml });
    const ab = await blob.arrayBuffer();
    const parts = readZip(new Uint8Array(ab));
    for (const [n, buf] of parts) if (/\.(xml|rels)$/.test(n)) { const dom = xmlOk(`${f}:${n}`, buf.toString('utf8')); if (n === 'word/document.xml') { checkOrder(dom, 'w:pPr', PPR_ORDER, f); checkOrder(dom, 'w:rPr', RPR_ORDER, f); } }
    const back = await parseFile('x.docx', ab);
    const before = count(words(wordsOf(m.blocks).join(' '))), after = count(words(wordsOf(back.blocks).join(' ')));
    let lost = 0; const lostWords = [];
    for (const [w, n] of before) { const d = n - (after.get(w) || 0); if (d > 0) { lost += d; lostWords.push(w); } }
    assert.equal(lost, 0, `${f}: words lost in a Word round trip: ${lostWords.slice(0, 12).join(' ')}`);
  }
});
