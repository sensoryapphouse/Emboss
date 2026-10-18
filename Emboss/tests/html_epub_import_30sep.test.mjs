// HTML and EPUB import fixes (Paul's import fix list, 30 Sep 2026): #3, #9, #15b, #19, #29, #30a, #33.
// Each test was written before the fix and fails against the pre-change parse.mjs (see the report).
//
// Rules used (none of them changes an existing expectation):
//   #3   EPUB spine items with linear="no" are part of the book (covers, notes); they stay where the spine puts them.
//   #33  CSS the way Word / Google Docs "web page" HTML writes it: font-weight bold..900 (bold), font-style
//        italic/oblique, text-decoration underline/line-through, text-transform:uppercase and font-variant:small-caps
//        (upper case; RUEB 9.6.1), inherited by descendants, also from a <style> class rule; <cite>/<var>/<dfn> are
//        italic (browser default); <q> is drawn with quotation marks.
//   #19  hidden content is not transcribed (the `hidden` attribute, display:none, visibility:hidden, aria-hidden,
//        a hidden class in a <style> or the book's own CSS file, <noscript>, <template>, <script>, <style>, an
//        unselected <option>).
//   #9   a <blockquote> keeps everything inside it (footer/cite attribution, div, list, table), all in one quotation.
//   #29  <br> is a forced line break, <pre> keeps its lines, ol reversed / start / li value, a second <dd>, MathML
//        annotation text is not text, footnotes (doc-noteref + doc-footnote / epub:type), pagebreaks, check boxes,
//        inline svg with a title.
//   #15b words in table cells with several paragraphs / list items / <br> do not run together.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml, parseEpub } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
// (xmldom, the Node test parser, refuses an epub:type attribute unless the prefix is declared; a browser does not mind)
const page = (body, head = '') => `<!DOCTYPE html><html xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title>${head}</head><body>${body}</body></html>`;
const parse = (body, head = '') => parseHtml(page(body, head)).blocks;

// every piece of text in a block tree, in order
function textOf(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(textOf).join(' ');
  if (x.segments && x.segments.length) return textOf(x.segments.map((s) => (s.type === 'math' ? (s.latex || '') : (s.text ?? ''))).join(''));
  let t = x.text ?? '';
  for (const k of ['blocks', 'items', 'rows', 'headers']) if (x[k]) t += ' ' + textOf(x[k]);
  if (x.title) t += ' ' + x.title;
  return t;
}
const allText = (blocks) => textOf(blocks);
const segs = (b) => b.segments || [{ type: 'text', text: b.text }];
const segWith = (b, text) => segs(b).find((s) => (s.text || '').includes(text));

describe('#33 CSS written as inline style', () => {
  test('font-weight bold / bolder / 600..900 is bold; normal / 400 is not', () => {
    const b = parse('<p>a <span style="font-weight:bold">b1</span> <span style="font-weight:bolder">b2</span> <span style="font-weight:600">b3</span> <span style="font-weight:700">b4</span> <span style="font-weight:900">b5</span> <span style="font-weight:normal">n1</span> <span style="font-weight:400">n2</span></p>')[0];
    for (const w of ['b1', 'b2', 'b3', 'b4', 'b5']) assert.equal(segWith(b, w)?.tf, TF_BOLD, w + ' ' + JSON.stringify(b));
    for (const w of ['n1', 'n2']) assert.ok(!segWith(b, w)?.tf, w + ' ' + JSON.stringify(b));
  });
  test('font-style italic / oblique is italic', () => {
    const b = parse('<p><span style="font-style:italic">i1</span> <span style="font-style: oblique">i2</span> <span style="font-style:normal">n</span></p>')[0];
    assert.equal(segWith(b, 'i1')?.tf, TF_ITALIC);
    assert.equal(segWith(b, 'i2')?.tf, TF_ITALIC);
    assert.ok(!segWith(b, 'n')?.tf);
  });
  test('text-decoration underline (kept) and line-through (still the strikethrough typeform)', () => {
    const b = parse('<p><span style="text-decoration:underline">u</span> <span style="text-decoration: line-through">s</span></p>')[0];
    assert.equal(segWith(b, 'u')?.tf, TF_UNDERLINE);
    assert.equal(segWith(b, 's')?.transcriberTypeform, 'strike');
  });
  test('text-transform:uppercase and font-variant:small-caps give upper-case text (RUEB 9.6.1)', () => {
    const b = parse('<p>plain <span style="text-transform:uppercase">shout</span> <span style="font-variant:small-caps">Small Caps</span> <span style="font-variant: small-caps; text-transform: none">x</span> end</p>')[0];
    assert.equal(textOf(b), 'plain SHOUT SMALL CAPS x end');
  });
  test('a block element carries the style to all its text, and so do ancestors', () => {
    const blocks = parse('<div style="font-weight:bold"><p>all bold <i>and italic</i></p><ul><li>item</li></ul></div><p style="font-style:italic">whole para</p><h2 style="text-transform:uppercase">head</h2>');
    assert.equal(segWith(blocks[0], 'all bold')?.tf, TF_BOLD);
    assert.equal(segWith(blocks[0], 'and italic')?.tf, TF_BOLD | TF_ITALIC);
    assert.equal(segWith(blocks[1].items[0], 'item')?.tf, TF_BOLD, JSON.stringify(blocks[1]));
    assert.equal(segWith(blocks[2], 'whole para')?.tf, TF_ITALIC);
    assert.equal(blocks[3].text, 'HEAD');
  });
  test('a table cell keeps the style', () => {
    const t = parse('<table><tr><td style="font-weight:bold">b</td><td><span style="font-style:italic">i</span></td></tr></table>').find((x) => x.type === 'table');
    const cells = [...t.headers, ...t.rows.flat()];
    const tfOf = (c) => (c && c.segments ? c.segments.find((s) => s.text)?.tf : 0);
    assert.equal(tfOf(cells.find((c) => textOf(c) === 'b')), TF_BOLD, JSON.stringify(t));
    assert.equal(tfOf(cells.find((c) => textOf(c) === 'i')), TF_ITALIC, JSON.stringify(t));
  });
  test('a <b> or <i> made normal by style (Google Docs wraps the page in <b style="font-weight:normal">) is not bold', () => {
    const blocks = parse('<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">Bold</span> then plain.</p><p>Second paragraph.</p></b>');
    assert.equal(blocks.length, 2, JSON.stringify(blocks));
    assert.equal(segWith(blocks[0], 'Bold')?.tf, TF_BOLD);
    assert.ok(!segWith(blocks[0], 'then plain')?.tf);
    assert.equal(textOf(blocks[1]), 'Second paragraph.');
  });
});

describe('#33 CSS written as <style> class rules', () => {
  const head = '<style>.c1{font-weight:700}.c2 {font-style:italic; text-decoration:underline}\n/* a comment */ span.c3{text-transform:uppercase} #only{font-weight:bold} p.q{font-style:italic} .gone{display:none}\n@media print{.c1{font-weight:400}} .c4:hover{font-weight:bold}</style>';
  test('class, tag.class and id rules give bold / italic / underline / upper case', () => {
    const b = parse('<p>x <span class="c1">one</span> <span class="c2">two</span> <span class="c3">three</span> <span id="only">four</span> <span class="c4">five</span></p><p class="q">six</p>', head);
    assert.equal(segWith(b[0], 'one')?.tf, TF_BOLD);
    assert.equal(segWith(b[0], 'two')?.tf, TF_ITALIC | TF_UNDERLINE);
    assert.ok(textOf(b[0]).includes('THREE'));
    assert.equal(segWith(b[0], 'four')?.tf, TF_BOLD);
    assert.ok(!segWith(b[0], 'five')?.tf, 'a :hover rule is not a style of the text');
    assert.equal(segWith(b[1], 'six')?.tf, TF_ITALIC);
  });
  test('an inline style wins over a class rule', () => {
    const b = parse('<p><span class="c1" style="font-weight:normal">plain</span></p>', head)[0];
    assert.ok(!segWith(b, 'plain')?.tf, JSON.stringify(b));
  });
});

describe('#33 CSS details', () => {
  test('rule order and specificity: a later rule, a more specific rule and !important win; the font shorthand is read', () => {
    const head = '<style>.a{font-weight:bold} .a.b{font-weight:normal} .c{font-style:normal} .c{font-style:italic} .d{font-style:italic !important} p{font:italic small-caps 12px/1.2 Georgia}</style>';
    const b = parse('<p><span class="a">x1</span> <span class="a b">x2</span> <span class="c">x3</span> <span class="d" style="font-style:normal">x4</span></p>', head)[0];
    assert.equal(segWith(b, 'X1')?.tf & TF_BOLD, TF_BOLD);
    assert.ok(!(segWith(b, 'X2')?.tf & TF_BOLD), 'the more specific .a.b makes it normal again');
    assert.ok(segWith(b, 'X3')?.tf & TF_ITALIC, 'the later .c rule wins');
    assert.ok(segWith(b, 'X4')?.tf & TF_ITALIC, '!important beats the style attribute');
    assert.match(textOf(b), /X1 X2 X3 X4/, 'p{font: italic small-caps …} gives small caps (upper case) and italic to the whole paragraph');
    assert.ok(segWith(b, 'X1')?.tf & TF_ITALIC);
  });
  test('a heading is not bold emphasis because a style sheet makes headings bold; italic on a heading is kept', () => {
    const h = parse('<h2>Plain heading</h2><h3 style="font-style:italic">Slanted</h3>', '<style>h2,h3{font-weight:bold}</style>');
    assert.equal(h[0].segments, undefined, JSON.stringify(h[0]));
    assert.equal(h[0].text, 'Plain heading');
    assert.equal(segWith(h[1], 'Slanted')?.tf, TF_ITALIC);
  });
  test('an emphasised list item does not repeat the words of the list nested in it', () => {
    const l = parse('<ul><li><b>Alpha</b> item<ul><li>nested</li></ul></li></ul>')[0];
    assert.equal(textOf(l.items[0]).trim(), 'Alpha item');
    assert.equal(l.items[1].text, 'nested');
  });
  test('a container with bare text and a bold or upper-case style gives a styled paragraph', () => {
    const b = parse('<div style="font-weight:bold">bare words</div><div style="text-transform:uppercase">more words</div>');
    assert.equal(b[0].segments[0].tf, TF_BOLD);
    assert.equal(b[1].text, 'MORE WORDS');
  });
});

describe('#33 tags: ins, cite, var, dfn, q', () => {
  test('<ins> keeps its text and adds no underline; <cite>, <var>, <dfn> are italic', () => {
    const b = parse('<p><ins>ins</ins> <cite>cit</cite> <var>vr</var> <dfn>df</dfn> <ins style="text-decoration:underline">insu</ins></p>')[0];
    assert.ok(textOf(b).includes('ins'));
    assert.ok(!segWith(b, 'ins')?.tf, JSON.stringify(b));
    for (const w of ['cit', 'vr', 'df']) assert.equal(segWith(b, w)?.tf, TF_ITALIC, w);
    assert.equal(segWith(b, 'insu')?.tf, TF_UNDERLINE);
  });
  test('<q> is drawn with quotation marks, nested ones with single marks', () => {
    const b = parse('<p>He said <q>go <q>now</q> please</q> and left.</p>')[0];
    assert.equal(textOf(b), 'He said “go ‘now’ please” and left.');
  });
});

describe('#19 hidden content is not transcribed', () => {
  test('hidden attribute, display:none, visibility:hidden, aria-hidden, hidden class, noscript, template, script', () => {
    const head = '<style>.h{display: none}</style>';
    const blocks = parse(
      '<p>Visible one.</p><p hidden>SECRETa</p><p style="display:none">SECRETb</p><p style="visibility: hidden">SECRETc</p>'
      + '<p aria-hidden="true">SECRETd</p><p class="x h">SECRETe</p><noscript>SECRETf</noscript><template><p>SECRETg</p></template>'
      + '<p>Inline <span hidden>SECRETh</span><span style="display:none">SECRETi</span><span class="h">SECRETj</span>visible <script>var SECRETk=1;</script>two.</p>'
      + '<div hidden><ul><li>SECRETl</li></ul></div>', head);
    const t = allText(blocks);
    assert.ok(!/SECRET/.test(t), t);
    assert.ok(/Visible one\./.test(t) && /Inline visible two\./.test(t.replace(/\s+/g, ' ')), t);
  });
  test('hidden text in a heading, a list item and a table cell is dropped too', () => {
    const t = allText(parse('<h2>Head<span hidden>SECRET1</span></h2><ul><li>Item<span style="display:none">SECRET2</span></li></ul><table><tr><td>Cell<span aria-hidden="true">SECRET3</span></td><td>x</td></tr></table>'));
    assert.ok(!/SECRET/.test(t), t);
    assert.ok(/Head/.test(t) && /Item/.test(t) && /Cell/.test(t));
  });
  test('a select keeps only the selected option; an input keeps its value; a check box its state', () => {
    const blocks = parse('<p>Pick <select><option>Aone</option><option selected>Btwo</option><option>Cthree</option></select> name: <input type="text" value="Paul"> <input type="hidden" value="SECRET"> <input type="checkbox" checked> on <input type="checkbox"> off</p>');
    const t = textOf(blocks[0]);
    assert.ok(/Btwo/.test(t) && !/Aone|Cthree/.test(t), t);
    assert.ok(/Paul/.test(t) && !/SECRET/.test(t), t);
    assert.ok(/\[x\] on/.test(t) && /\[ \] off/.test(t), t);
  });
});

describe('#9 a blockquote keeps everything inside it', () => {
  test('a footer / cite after the paragraph is kept as the attribution', () => {
    const blocks = parse('<blockquote><p>To be or not to be.</p><footer>Shakespeare, <cite>Hamlet</cite></footer></blockquote>');
    const t = allText(blocks);
    assert.ok(/To be or not to be\./.test(t) && /Shakespeare/.test(t) && /Hamlet/.test(t), JSON.stringify(blocks));
    assert.ok(blocks.some((b) => b.type === 'attribution' && /Shakespeare/.test(b.text)), JSON.stringify(blocks));
    const ids = new Set(blocks.map((b) => b.blockquoteId));
    assert.equal(ids.size, 1);
    assert.ok([...ids][0] != null, 'one quotation: the attribution shares the quotation id');
  });
  test('a div, a list and a table inside a blockquote are kept, in order, in one quotation', () => {
    const blocks = parse('<blockquote><div>First quoted.</div><ul><li>one</li><li>two</li></ul><table><tr><td>c1</td><td>c2</td></tr></table><p>Last quoted.</p></blockquote>');
    const t = allText(blocks).replace(/\s+/g, ' ');
    for (const w of ['First quoted.', 'one', 'two', 'c1', 'c2', 'Last quoted.']) assert.ok(t.includes(w), w + ' in ' + t);
    assert.ok(t.indexOf('First quoted.') < t.indexOf('one') && t.indexOf('two') < t.indexOf('c1') && t.indexOf('c2') < t.indexOf('Last quoted.'));
    assert.equal(new Set(blocks.map((b) => b.blockquoteId)).size, 1, JSON.stringify(blocks.map((b) => [b.type, b.blockquoteId])));
    assert.ok(blocks.every((b) => b.blockquoteId != null));
  });
  test('the ordinary single-paragraph and two-paragraph quotations are unchanged', () => {
    const one = parse('<blockquote><p>Just one.</p></blockquote>');
    assert.equal(one.length, 1); assert.equal(one[0].style, 'quote'); assert.equal(one[0].blockquoteId, undefined);
    const two = parse('<blockquote><p>First.</p><p>Second.</p></blockquote>');
    assert.equal(two.length, 2); assert.ok(two.every((b) => b.style === 'quote' && b.blockquoteId != null));
  });
});

describe('#29 HTML details', () => {
  test('<br> is a forced line break, not a space', () => {
    const b = parse('<p>Line one<br>line two<br/>\n  line three</p>')[0];
    assert.equal(segs(b).map((s) => s.text).join(''), 'Line one\nline two\nline three');
  });
  test('<br> in a heading, a glossary entry or an attribution is a space (they flow)', () => {
    const blocks = parse('<h2 style="font-style:italic">Line one<br>line two</h2><dl><dt>Term<br>two</dt><dd><b>Def</b> one<br>two</dd></dl>');
    assert.equal(blocks[0].text, 'Line one line two');
    assert.ok(!segs(blocks[0]).some((x) => /\n/.test(x.text)));
    assert.equal(blocks[1].items[0].term, 'Term two');
    assert.ok(!JSON.stringify(blocks[1]).includes('\\n'));
  });
  test('<br> in a list item keeps the break; in a table cell it is a space', () => {
    const blocks = parse('<ul><li>alpha<br>beta</li></ul><table><tr><td>gamma<br>delta</td><td>x</td></tr></table>');
    assert.equal(segs(blocks[0].items[0]).map((s) => s.text).join(''), 'alpha\nbeta');
    const t = blocks.find((x) => x.type === 'table');
    assert.ok([...t.headers, ...t.rows.flat()].some((c) => textOf(c) === 'gamma delta'), JSON.stringify(t));
  });
  test('<pre> keeps its lines and indentation', () => {
    const b = parse('<pre>first\n  second\n\tthird</pre><pre><code>x = 1\ny = 2\n</code></pre>');
    assert.equal(b[0].type, 'code');
    assert.match(b[0].text, /^first\n {2}second\n\s+third$/);
    assert.equal(b[1].text, 'x = 1\ny = 2');
  });
  test('<ol reversed>, <ol start> and <li value> number as print does', () => {
    const [rev, start, val] = parse('<ol reversed><li>a</li><li>b</li><li>c</li></ol><ol start="5"><li>d</li><li>e</li></ol><ol><li value="10">f</li><li>g</li><li value="3">h</li><li>i</li></ol>');
    assert.deepEqual(rev.items.map((i) => i.marker), ['3.', '2.', '1.']);
    assert.deepEqual(start.items.map((i) => i.marker), ['5.', '6.']);
    assert.deepEqual(val.items.map((i) => i.marker), ['10.', '11.', '3.', '4.']);
  });
  test('a second <dd> stays a definition of the same term', () => {
    const l = parse('<dl><dt>Term</dt><dd>first def</dd><dd>second def</dd><dt>Other</dt><dd>o def</dd></dl>')[0];
    assert.equal(l.items.length, 2, JSON.stringify(l));
    assert.equal(l.items[0].term, 'Term');
    // one entry: the formatter sets a glossary entry from its term and def (it does not read item.blocks), so the second definition is joined on
    assert.equal(l.items[0].def, 'first def second def');
    assert.equal(l.items[0].text, 'Term \u2014 first def second def');
    assert.ok(!l.items.some((i) => i.term === '' ), 'no item without a term');
  });
  test('MathML annotation text is not added to the formula', () => {
    const b = parse('<p>Math <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>y</mi><annotation encoding="application/x-tex">yy</annotation></semantics></math> end</p>')[0];
    const m = b.segments.find((s) => s.type === 'math');
    assert.ok(m && !/annotation/.test(m.mathml) && !/yy/.test(m.mathml), JSON.stringify(m));
    assert.ok(!/yy/.test(m.latex || ''), JSON.stringify(m));
  });
  test('task-list check boxes keep their state as [x] / [ ]', () => {
    const l = parse('<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox"> todo</li></ul>')[0];
    assert.equal(textOf(l.items[0]).trim(), '[x] done');
    assert.equal(textOf(l.items[1]).trim(), '[ ] todo');
  });
  test('inline svg with a title / aria-label is a picture with that description', () => {
    const blocks = parse('<svg width="40" height="40" role="img" aria-labelledby="t1"><title id="t1">Red circle</title><desc>A red circle on white</desc><circle r="5"/></svg><p>After <svg aria-label="Small star"><circle r="1"/></svg> text.</p>');
    const g = blocks.filter((b) => b.type === 'graphic');
    assert.equal(g.length, 2, JSON.stringify(blocks));
    assert.ok(/Red circle/.test(g[0].alt) && /A red circle on white/.test(g[0].alt));
    assert.equal(g[1].alt, 'Small star');
    assert.ok(!/Red circle|red circle/.test(allText(blocks.filter((b) => b.type !== 'graphic'))));
  });
});

describe('#29 / #30a footnotes and print page numbers', () => {
  const FN = '<p>Text with a note<sup><a role="doc-noteref" href="#fn1" id="r1">1</a></sup> and more.</p><p>Another paragraph.</p><aside role="doc-footnote" id="fn1"><p>The note body.</p></aside>';
  test('a doc-noteref link is a note reference and its doc-footnote aside a note after that paragraph (not a box)', () => {
    const blocks = parse(FN);
    const p = blocks[0];
    const ref = p.segments.find((s) => s.type === 'noteref');
    assert.ok(ref && ref.text === '1' && ref.idref, JSON.stringify(p));
    assert.ok(!p.segments.some((s) => /[-]/.test(s.text || '')), 'no empty superscript markers: ' + JSON.stringify(p));
    assert.ok(!/(^|\s)1(\s|$)/.test(p.segments.filter((s) => s.type === 'text').map((s) => s.text).join('')), 'the number is not repeated as plain text');
    const note = blocks[1];
    assert.equal(note.type, 'footnote', JSON.stringify(blocks));
    assert.equal(note.id, ref.idref);
    assert.match(textOf(note), /The note body\./);
    assert.ok(!blocks.some((b) => b.type === 'box'));
    assert.equal(blocks.filter((b) => /The note body/.test(textOf(b))).length, 1, 'the note is not also left where it stood');
  });
  test('the note saves as <note> with a matching <noteref> (well-formed NIMAS)', () => {
    const xml = exportToNimasXml(parseHtml(page(FN)));
    assert.match(xml, /<noteref idref="#([^"]+)">1<\/noteref>/);
    const id = /<noteref idref="#([^"]+)"/.exec(xml)[1];
    assert.match(xml, new RegExp(`<note id="${id}" class="footnote"><p>The note body\\.</p></note>`));
  });
  test('epub:type footnote / endnote / rearnote, and a class="footnote-ref" link, are notes', () => {
    const blocks = parse('<p>A<a epub:type="noteref" href="#n1"><sup>1</sup></a> B<a class="footnote-ref" href="#n2">[2]</a> C<a epub:type="noteref" href="#n3">3</a></p>'
      + '<aside epub:type="footnote" id="n1"><p>Foot one.</p></aside><ol class="footnotes"><li id="n2"><p>Foot two. <a href="#r2" role="doc-backlink">↩</a></p></li></ol><aside epub:type="rearnote" id="n3">Rear three.</aside>');
    const notes = blocks.filter((b) => b.type === 'footnote');
    assert.equal(notes.length, 3, JSON.stringify(blocks));
    assert.deepEqual(notes.map((n) => textOf(n).replace(/\s+/g, ' ').trim()), ['Foot one.', 'Foot two.', 'Rear three.']);
    assert.ok(!blocks.some((b) => b.type === 'box' || b.type === 'list'));
    assert.deepEqual(blocks[0].segments.filter((s) => s.type === 'noteref').map((s) => s.text), ['1', '2', '3']);
  });
  test('an endnote-typed note is kind endnote; an unreferenced note-typed aside is still a note', () => {
    const blocks = parse('<p>X<a epub:type="noteref" href="#e1">1</a></p><aside epub:type="endnote" id="e1"><p>End body.</p></aside><aside role="doc-footnote" id="lone"><p>Lone note.</p></aside>');
    const notes = blocks.filter((b) => b.type === 'footnote');
    assert.equal(notes.length, 2, JSON.stringify(blocks));
    assert.equal(notes[0].kind, 'endnote');
    assert.match(textOf(notes[1]), /Lone note\./);
  });
  test('a note whose reference is before a page break waits for the last piece of that paragraph', () => {
    const blocks = parse('<p>Before<a role="doc-noteref" href="#n1">1</a> and <span role="doc-pagebreak" title="5"></span> after.</p><p>Next.</p><aside role="doc-footnote" id="n1"><p>The note.</p></aside>');
    assert.deepEqual(blocks.map((b) => b.type), ['para', 'pagenum', 'para', 'footnote', 'para'], JSON.stringify(blocks));
  });
  test('XHTML <span .../> is an empty element (the HTML parser would take it as open and swallow the rest of the paragraph)', () => {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>One<span role="doc-pagebreak" title="7"/> two <b>three</b>.</p></body></html>';
    const blocks = parseHtml(xhtml).blocks;
    assert.deepEqual(blocks.map((b) => b.type), ['para', 'pagenum', 'para'], JSON.stringify(blocks));
    assert.equal(blocks[1].page, '7');
    assert.equal(textOf(blocks[2]).trim(), 'two three.');
  });
  test('a reference with no note to go to stays as plain superscript text, nothing lost', () => {
    const b = parse('<p>See<sup><a role="doc-noteref" href="#missing">7</a></sup> here.</p>')[0];
    assert.match(textOf(b), /7/);
  });
  test('epub:type="pagebreak" and role="doc-pagebreak" are print page numbers, in a block and inside a paragraph', () => {
    const blocks = parse('<p>Before<span epub:type="pagebreak" role="doc-pagebreak" id="p1" title="12"></span> after.</p>'
      + '<p epub:type="pagebreak" role="doc-pagebreak" id="p2" title="13">13</p><div role="doc-pagebreak" aria-label="iv"></div><span epub:type="pagebreak" title="14"></span><p>Tail.</p>');
    const pages = blocks.filter((b) => b.type === 'pagenum').map((b) => b.page);
    assert.deepEqual(pages, ['12', '13', 'iv', '14'], JSON.stringify(blocks));
    const paras = blocks.filter((b) => b.type === 'para').map((b) => textOf(b).trim());
    assert.deepEqual(paras.slice(0, 2), ['Before', 'after.'], 'the paragraph is split at the page turn');
    assert.ok(blocks[1].continued || blocks[0].continued, JSON.stringify(blocks));
    assert.ok(!paras.includes('13'), 'the page number is not left as a paragraph');
  });
});

describe('#15b words do not run together in a table cell', () => {
  test('paragraphs, list items, line breaks and divs in a cell are separated by spaces', () => {
    const t = parse('<table><tr><th>H</th><th>I</th></tr><tr><td><p>p1</p><p>p2</p></td><td><ul><li>l1</li><li>l2</li></ul></td></tr><tr><td>a<br>b</td><td><div>d1</div><div>d2</div></td></tr></table>').find((x) => x.type === 'table');
    const cells = t.rows.flat().map((c) => textOf(c).replace(/\s+/g, ' ').trim());
    assert.deepEqual(cells, ['p1 p2', 'l1 l2', 'a b', 'd1 d2']);
  });
});

// ------------------------------------------------------------------------------------------------ EPUB
const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const CONTAINER = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
const xhtml = (body, extra = '') => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title>${extra}</head><body>${body}</body></html>`;
function epub(items, spine, files, meta = '<dc:title>Book</dc:title>') {
  const manifest = items.map(([id, href, type = 'application/xhtml+xml', props]) => `<item id="${id}" href="${href}" media-type="${type}"${props ? ` properties="${props}"` : ''}/>`).join('');
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${meta}</metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`;
  return zipBuf([{ name: 'META-INF/container.xml', text: CONTAINER }, { name: 'OEBPS/content.opf', text: opf }, ...files]);
}

describe('#3 EPUB non-linear spine items', () => {
  test('a cover page and a notes file marked linear="no" are read, at the place the spine puts them', async () => {
    const buf = await epub(
      [['cover', 'cover.xhtml'], ['c1', 'c1.xhtml'], ['c2', 'c2.xhtml'], ['notes', 'notes.xhtml'], ['img', 'cover.png', 'image/png']],
      '<itemref idref="cover" linear="no"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="notes" linear="no"/>',
      [{ name: 'OEBPS/cover.xhtml', text: xhtml('<div><img src="cover.png" alt="The cover of the book"/></div>') },
        { name: 'OEBPS/c1.xhtml', text: xhtml('<h1>Chapter one</h1><p>First text.</p>') },
        { name: 'OEBPS/c2.xhtml', text: xhtml('<h1>Chapter two</h1><p>Second text.</p>') },
        { name: 'OEBPS/notes.xhtml', text: xhtml('<h1>Notes</h1><ol><li>The endnote text.</li></ol>') },
        { name: 'OEBPS/cover.png', data: PNG }]);
    const m = await parseEpub(buf);
    const order = m.blocks.map((b) => (b.type === 'graphic' ? 'G:' + b.alt : textOf(b))).join(' | ');
    assert.ok(order.startsWith('G:The cover of the book |'), order);
    assert.match(order, /Chapter one.*First text.*Chapter two.*Second text.*Notes.*The endnote text/);
    assert.equal(m.blocks[0].type, 'graphic', 'the cover is a picture, not text');
    assert.equal(m.resources && m.resources.length, 1);
  });
  test('an image-only cover written as svg <image> is a picture with its description', async () => {
    const buf = await epub([['cover', 'cover.xhtml'], ['c1', 'c1.xhtml'], ['img', 'cover.png', 'image/png']],
      '<itemref idref="cover" linear="no"/><itemref idref="c1"/>',
      [{ name: 'OEBPS/cover.xhtml', text: xhtml('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" aria-label="Book cover"><title>Book cover</title><image width="10" height="10" xlink:href="cover.png"/></svg>') },
        { name: 'OEBPS/c1.xhtml', text: xhtml('<p>Text.</p>') },
        { name: 'OEBPS/cover.png', data: PNG }]);
    const m = await parseEpub(buf);
    assert.equal(m.blocks[0].type, 'graphic', JSON.stringify(m.blocks));
    assert.match(m.blocks[0].alt, /Book cover/);
    assert.equal(m.blocks[0].src, 'OEBPS/cover.png');
    assert.equal(m.resources && m.resources.length, 1);
  });
});

describe('EPUB notes, hidden text, CSS', () => {
  test('noterefs in chapters find their notes in another (non-linear) file; the notes are not left there too', async () => {
    const buf = await epub([['c1', 'text/c1.xhtml'], ['notes', 'text/notes.xhtml']], '<itemref idref="c1"/><itemref idref="notes" linear="no"/>',
      [{ name: 'OEBPS/text/c1.xhtml', text: xhtml('<p>One<a epub:type="noteref" href="notes.xhtml#n1" id="r1"><sup>1</sup></a>.</p><p>Two<a epub:type="noteref" href="notes.xhtml#n2" id="r2"><sup>2</sup></a>.</p><p>End.</p>') },
        { name: 'OEBPS/text/notes.xhtml', text: xhtml('<section epub:type="endnotes"><h1>Notes</h1><ol><li id="n1" epub:type="endnote"><p>First note. <a href="c1.xhtml#r1" epub:type="backlink">↩</a></p></li><li id="n2" epub:type="endnote"><p>Second note. <a href="c1.xhtml#r2">back</a></p></li></ol></section>') }]);
    const m = await parseEpub(buf);
    const kinds = m.blocks.map((b) => b.type + ':' + textOf(b).replace(/\s+/g, ' ').trim());
    assert.deepEqual(kinds, ['para:One1.', 'footnote:First note.', 'para:Two2.', 'footnote:Second note.', 'para:End.'], JSON.stringify(m.blocks));
    assert.equal(m.blocks[1].kind, 'endnote');
    const xml = exportToNimasXml(m);
    assert.equal((xml.match(/<noteref /g) || []).length, 2);
    assert.equal((xml.match(/<note /g) || []).length, 2);
  });
  test('text hidden by the book\'s own CSS file (.hidden{display:none}) is not transcribed', async () => {
    const buf = await epub([['c1', 'c1.xhtml'], ['css', 'style.css', 'text/css']], '<itemref idref="c1"/>',
      [{ name: 'OEBPS/c1.xhtml', text: xhtml('<p>Shown.</p><p class="hidden">SECRET</p><p>Also <span class="hidden">SECRET</span>shown <span class="b">bold</span>.</p>', '<link rel="stylesheet" type="text/css" href="style.css"/>') },
        { name: 'OEBPS/style.css', text: '.hidden { display: none; }\n.b { font-weight: bold }' }]);
    const m = await parseEpub(buf);
    const t = allText(m.blocks).replace(/\s+/g, ' ');
    assert.ok(!/SECRET/.test(t), t);
    assert.match(t, /Shown\./);
    assert.equal(segWith(m.blocks[1], 'bold')?.tf, TF_BOLD, JSON.stringify(m.blocks));
  });
});

// ------------------------------------------------------------------------------------------------ the two fixture files
describe('fixtures: a Google Docs / Word style web page and a non-linear EPUB with notes', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'import-audit');
  test('h06-web-page-css.html reads the way a browser shows it', () => {
    const blocks = parseHtml(fs.readFileSync(path.join(dir, 'html', 'h06-web-page-css.html'), 'utf8')).blocks;
    const t = allText(blocks).replace(/\s+/g, ' ');
    assert.ok(!/hidden(class|span)|visibilityhidden|ariahidden/i.test(t.replace(/hidden things/, '')), t);
    assert.ok(blocks.length > 15, 'the <b style="font-weight:normal"> wrapper must not swallow the page into one paragraph: ' + blocks.length);
    assert.equal(blocks[0].segments, undefined);                                      // the heading: a style sheet's bold is not emphasis
    const p1 = blocks[1];
    assert.equal(segWith(p1, 'alphac1bold')?.tf, TF_BOLD);
    assert.equal(segWith(p1, 'alphac2italicunder')?.tf, TF_ITALIC | TF_UNDERLINE);
    assert.match(textOf(p1), /ALPHAC3UPPER ALPHAC4SMALLCAPS alphac5plain/);
    assert.ok(blocks.some((b) => b.type === 'attribution' && /alphabqfooter/.test(b.text)));
    assert.ok(blocks.some((b) => b.type === 'code' && /\n {4}alphapreindented\n/.test(b.text)));
    assert.deepEqual(blocks.filter((b) => b.type === 'list' && b.kind !== 'glossary' && b.items[0].marker !== '•').map((b) => b.items.map((i) => i.marker)), [['3.', '2.', '1.'], ['7.', '20.', '21.']]);
    assert.equal(blocks.filter((b) => b.type === 'footnote').length, 1);
    assert.deepEqual(blocks.filter((b) => b.type === 'pagenum').map((b) => b.page), ['9']);
    assert.ok(blocks.some((b) => b.type === 'graphic' && b.alt === 'alphasvgtitle'));
    const xml = exportToNimasXml({ title: 'x', blocks });
    assert.match(xml, /<noteref idref="#[^"]+">1<\/noteref>/);
  });
  test('e02-nonlinear-notes.epub: cover picture first, notes after their references, hidden / bold from the book\'s CSS', async () => {
    const buf = fs.readFileSync(path.join(dir, 'epub', 'e02-nonlinear-notes.epub'));
    const m = await parseEpub(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.equal(m.blocks[0].type, 'graphic');
    assert.equal(m.blocks[0].alt, 'alphacovertitle');
    assert.equal(m.blocks[0].src, 'EPUB/images/cover.png');
    assert.equal(m.resources.length, 1);
    const t = allText(m.blocks).replace(/\s+/g, ' ');
    assert.ok(!/alphaepubhidden|alphanav|alphanotestitle|back/.test(t), t);             // hidden class; the nav document; the emptied "Notes" section; back-links
    assert.deepEqual(m.blocks.map((b) => b.type), ['graphic', 'heading', 'para', 'pagenum', 'para', 'footnote', 'para', 'footnote', 'heading', 'para', 'footnote']);
    assert.deepEqual(m.blocks.filter((b) => b.type === 'footnote').map((b) => [b.text, b.kind]), [['alphaendnote1', 'endnote'], ['alphaendnote2', 'endnote'], ['alphaendnote3', 'endnote']]);
    assert.match(textOf(m.blocks[2]), /^ALPHALEADWORDS OF THE FIRST PARAGRAPH1 CONTINUE HERE$/);   // .lead { font-variant: small-caps }
    assert.equal(segWith(m.blocks[6], 'alphaboldclass')?.tf, TF_BOLD);                   // .strong { font-weight: bold } from book.css
  });
});
