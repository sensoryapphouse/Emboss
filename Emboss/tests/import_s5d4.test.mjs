// Import gaps left by the S5d exports, decided by Paul (product owner) on 17 Oct 2026 (audit question S5D-Q4):
//
//   1. Word: a footnote or endnote whose reference carries a custom mark (w:customMarkFollows — "*", "i", a dagger). Word writes the
//      mark as the text of the run after the reference AND again as the first run of the note's own text. The reference keeps the mark
//      (a noteref segment's `text`, as for an automatic number); it is not also text in the note, and not twice in the paragraph.
//   2. HTML (and EPUB chapters, which go through the same reader):
//        a) a picture's description: <img alt> is the picture's `alt` — the field the editor calls "Description for the braille
//           reader". An empty alt="" (or role="presentation"/"none" with no alt) is a decorative picture: `decorative: true`, the
//           same flag the Word reader sets (IMP-W12), so no "picture has no description" warning. A <figcaption> stays the caption.
//           Emboss's own HTML export also writes a picture's production-note description as <p class="image-description"> inside the
//           <figure>: it is read back as the block's `description`, not lost.
//        b) <code> inside running text is computer code: `uncontracted: true` on its segment (as the Markdown and NIMAS readers
//           mark it); <pre><code> is the Computer Code block (the HTML reader already had <pre>).
//
// S5D4_PARSE_IMPL runs the same tests against another copy of input/parse.mjs (the pre-change one: the failing-first evidence).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { makeZip } from '../web/zip.mjs';
import { readZip } from './helpers/zip-read.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { parseFile, parseHtml, parseEpub, parseDocx } = await import(process.env.S5D4_PARSE_IMPL ? pathToFileURL(path.resolve(process.env.S5D4_PARSE_IMPL)).href : pathToFileURL(path.join(here, '../input/parse.mjs')).href);
const X = await import('../web/export-formats.mjs');
const D = await import('../web/docx-export.mjs');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SUP = '', SUP_END = '';

// every text in a block, in order (segments or text); a note reference's mark is the reference, not text, so it is left out
const textOf = (b) => (b.segments ? b.segments.filter((s) => s.type !== 'noteref').map((s) => s.text || '').join('') : b.text) || '';
const noMarks = (s) => String(s).replace(/[-]/g, '');

// ------------------------------------------------------------------------------------------------------------------------------
// 1. Word: custom note marks
// ------------------------------------------------------------------------------------------------------------------------------
async function wordFile({ body, footnotes = null, endnotes = null }) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`;
  const parts = [{ name: 'word/document.xml', text: docXml }];
  if (footnotes) parts.push({ name: 'word/footnotes.xml', text: `<?xml version="1.0"?><w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>` });
  if (endnotes) parts.push({ name: 'word/endnotes.xml', text: `<?xml version="1.0"?><w:endnotes xmlns:w="${W}">${endnotes}</w:endnotes>` });
  return parseDocx(await makeZip(parts).arrayBuffer());
}
const run = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const sup = (t) => `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
const ref = (kind, id, custom) => `<w:r><w:${kind}Reference${custom ? ' w:customMarkFollows="1"' : ''} w:id="${id}"/></w:r>`;
const note = (kind, id, ...runs) => `<w:${kind} w:id="${id}"><w:p>${runs.join('')}</w:p></w:${kind}>`;

describe('S5D-Q4 Word: a custom note mark is the reference\'s own mark', () => {
  test('footnote marked "*" and endnote marked "i": the reference keeps the mark; the note text does not start with it; the paragraph has it once', async () => {
    const m = await wordFile({
      body: `<w:p>${run('A statement')}${ref('footnote', 1, true)}${run('*')}${run(' continues, and then')}${ref('endnote', 1, true)}${sup('i')}${run(' ends.')}</w:p>`,
      footnotes: note('footnote', 1, run('*'), run(' A custom asterisk footnote.')),
      endnotes: note('endnote', 1, sup('i'), run(' The custom endnote.')),
    });
    const para = m.blocks.find((b) => b.type === 'para');
    const refs = para.segments.filter((s) => s.type === 'noteref');
    assert.deepEqual(refs.map((s) => s.text), ['*', 'i'], JSON.stringify(para.segments));
    assert.equal(noMarks(textOf(para)), 'A statement continues, and then ends.', 'each mark once, as the reference, never also as body text');
    const notes = m.blocks.filter((b) => b.type === 'footnote');
    assert.deepEqual(notes.map((n) => [noMarks(textOf(n)).trim(), n.kind || 'footnote', n.id]), [['A custom asterisk footnote.', 'footnote', refs[0].idref], ['The custom endnote.', 'endnote', refs[1].idref]]);
  });

  test('the note\'s mark may be styled, raised or on a note whose text has several paragraphs; only the mark goes', async () => {
    const m = await wordFile({
      body: `<w:p>${run('One')}${ref('footnote', 1, true)}${run('†')}${run(' and two')}${ref('footnote', 2, true)}${run('‡')}${run('.')}</w:p>`,
      footnotes: note('footnote', 1, `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:t>†</w:t></w:r>`, run(' Dagger note.'))
        + `<w:footnote w:id="2"><w:p>${sup('‡')}${run(' Double dagger, first paragraph.')}</w:p><w:p>${run('Second paragraph, ‡ kept.')}</w:p></w:footnote>`,
    });
    const refs = m.blocks.find((b) => b.type === 'para').segments.filter((s) => s.type === 'noteref');
    assert.deepEqual(refs.map((s) => s.text), ['†', '‡']);
    const notes = m.blocks.filter((b) => b.type === 'footnote');
    assert.equal(noMarks(textOf(notes[0])).trim(), 'Dagger note.');
    assert.deepEqual(notes[1].blocks.map((b) => noMarks(textOf(b)).trim()), ['Double dagger, first paragraph.', 'Second paragraph, ‡ kept.']);
  });

  test('an automatic note keeps its text whatever it starts with; so does a custom-marked note that does not repeat its mark', async () => {
    const m = await wordFile({
      body: `<w:p>${run('Auto')}${ref('footnote', 1, false)}${run(' custom')}${ref('footnote', 2, true)}${run('*')}${run('.')}</w:p>`,
      footnotes: note('footnote', 1, run('1 apple a day.')) + note('footnote', 2, run('No repeated mark here.')) + note('footnote', 3, run('in the beginning')),
    });
    const notes = m.blocks.filter((b) => b.type === 'footnote');
    assert.deepEqual(notes.map((n) => noMarks(textOf(n)).trim()), ['1 apple a day.', 'No repeated mark here.']);
    // a mark is a word of its own: the custom mark "i" does not take the "i" off "in the beginning"
    const m2 = await wordFile({ body: `<w:p>${run('X')}${ref('footnote', 3, true)}${run('i')}${run('.')}</w:p>`, footnotes: note('footnote', 3, run('in the beginning')) });
    assert.equal(noMarks(textOf(m2.blocks.find((b) => b.type === 'footnote'))), 'in the beginning');
  });

  test('Emboss\'s own Word export of custom-marked notes reads back with the marks on the references only', async () => {
    const model = { blocks: [
      { type: 'para', segments: [{ type: 'text', text: 'Foot' }, { type: 'noteref', text: '*', idref: 'fn1' }, { type: 'text', text: ' and end' }, { type: 'noteref', text: 'i', idref: 'en1' }, { type: 'text', text: '.' }] },
      { type: 'footnote', id: 'fn1', text: 'The footnote text.' },
      { type: 'footnote', id: 'en1', kind: 'endnote', text: 'The endnote text.' },
    ] };
    const bytes = new Uint8Array(await D.exportToDocxBlob(model, 'T', {}).arrayBuffer());
    const parts = readZip(bytes);
    assert.match(parts.get('word/endnotes.xml').toString('utf8'), /<w:t[^>]*>i<\/w:t>/, 'the export writes the endnote\'s custom mark as the first run of the note (as Word does)');
    const m = await parseFile('x.docx', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const para = m.blocks.find((b) => b.type === 'para');
    assert.deepEqual(para.segments.filter((s) => s.type === 'noteref').map((s) => s.text), ['*', 'i']);
    assert.equal(noMarks(textOf(para)), 'Foot and end.');
    assert.deepEqual(m.blocks.filter((b) => b.type === 'footnote').map((n) => [noMarks(textOf(n)).trim(), n.kind || 'footnote']), [['The footnote text.', 'footnote'], ['The endnote text.', 'endnote']]);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
// 2. HTML and EPUB: picture descriptions and <code>
// ------------------------------------------------------------------------------------------------------------------------------
const page = (body) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
const html = (body) => parseHtml(page(body)).blocks;

describe('S5D-Q4 HTML: a picture\'s description', () => {
  test('<img alt> is the picture\'s description (alt), on its own, in a paragraph, in a link and in a figure; a figcaption stays the caption', () => {
    const b = html('<img src="a.png" alt="Alt of a"><p>Text <img src="b.png" alt="Alt of b"> more.</p><div><a href="u"><img src="c.png" alt="Alt of c"></a></div>'
      + '<figure><img src="d.png" alt="Alt of d"><figcaption>Figure 4. The caption.</figcaption></figure>');
    const g = b.filter((x) => x.type === 'graphic');
    assert.deepEqual(g.map((x) => [x.src, x.alt, x.caption]), [['a.png', 'Alt of a', undefined], ['b.png', 'Alt of b', undefined], ['c.png', 'Alt of c', undefined], ['d.png', 'Alt of d', 'Figure 4. The caption.']]);
    assert.ok(g.every((x) => !x.decorative), 'a described picture is not decorative');
  });

  test('an empty alt="" is a decorative picture; a missing alt is not (the transcriber is still asked); role="presentation" is decorative', () => {
    const b = html('<img src="a.png" alt=""><img src="b.png"><img src="c.png" alt="  "><img src="d.png" role="presentation"><img src="e.png" role="none" alt="">'
      + '<p><img src="f.png" alt=""></p><figure><img src="g.png" alt=""><figcaption>Cap only</figcaption></figure>');
    const g = Object.fromEntries(b.filter((x) => x.type === 'graphic').map((x) => [x.src, x]));
    for (const s of ['a.png', 'c.png', 'd.png', 'e.png', 'f.png', 'g.png']) { assert.equal(g[s].decorative, true, s); assert.equal(g[s].alt, '', s); }
    assert.ok(!g['b.png'].decorative, 'no alt attribute at all: unknown, not decorative');
    assert.equal(g['g.png'].caption, 'Cap only', 'a decorative picture\'s caption is still its caption');
  });

  test('the figure\'s description paragraph (as Emboss\'s HTML export writes it) is the picture\'s description, not lost, not a paragraph', () => {
    const b = html('<figure><img src="a.png" alt="A dot"><figcaption>Figure 1. A dot.</figcaption><p class="image-description">The dot is one pixel.</p><p class="image-description">It is red.</p></figure><p>After.</p>');
    assert.equal(b.length, 2, JSON.stringify(b));
    assert.deepEqual([b[0].alt, b[0].caption, b[0].description], ['A dot', 'Figure 1. A dot.', 'The dot is one pixel. It is red.']);
    assert.equal(b[1].text, 'After.');
  });

  test('Emboss\'s own HTML export of a picture reads back with alt, caption and description; a decorative one stays decorative', () => {
    const model = { blocks: [
      { type: 'graphic', src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'A tiny red dot', caption: 'Figure 1. A dot.', description: 'The dot is one pixel.' },
      { type: 'graphic', src: 'data:image/png;base64,iVBORw0KGgo=', alt: '', decorative: true },
    ] };
    const g = parseHtml(X.exportToHtml(model, {})).blocks.filter((b) => b.type === 'graphic');
    assert.deepEqual([g[0].alt, g[0].caption, g[0].description], ['A tiny red dot', 'Figure 1. A dot.', 'The dot is one pixel.']);
    assert.deepEqual([g[1].alt, g[1].decorative], ['', true]);
  });
});

describe('S5D-Q4 HTML: <code>', () => {
  test('<code> in running text is computer code (uncontracted) and nothing else around it is', () => {
    const [p] = html('<p>Run <code>x = f(y)</code> now, and <em>stress</em> this.</p>');
    const code = p.segments.filter((s) => s.uncontracted);
    assert.deepEqual(code.map((s) => s.text), ['x = f(y)'], JSON.stringify(p.segments));
    assert.equal(textOf(p), 'Run x = f(y) now, and stress this.');
    assert.ok(p.segments.filter((s) => !s.uncontracted).every((s) => s.type === 'text'));
    assert.equal(p.segments.find((s) => s.text === 'stress').tf, 1);
  });

  test('a paragraph that is only code, code in a heading, a list item, a link and with bold inside keep it', () => {
    const b = html('<p><code>only</code></p><h2>Use <code>f()</code></h2><ul><li>call <code>g()</code></li></ul><p><a href="http://x.org/"><code>lnk</code></a> and <code>a <b>b</b></code></p>');
    assert.deepEqual(b[0].segments.map((s) => [s.text, !!s.uncontracted]), [['only', true]]);
    assert.deepEqual(b[1].segments.filter((s) => s.uncontracted).map((s) => s.text), ['f()']);
    assert.deepEqual((b[2].items[0].segments || []).filter((s) => s.uncontracted).map((s) => s.text), ['g()'], JSON.stringify(b[2]));
    const lnk = b[3].segments.find((s) => s.text === 'lnk');
    assert.ok(lnk.uncontracted && lnk.href === 'http://x.org/');
    assert.ok(b[3].segments.filter((s) => s.uncontracted).map((s) => s.text).join('').includes('a b'));
    assert.equal(b[3].segments.find((s) => s.text === 'b').tf, 4);
  });

  test('<pre><code> and <pre> are the Computer Code block, with their lines and indentation', () => {
    const b = html('<pre><code class="language-js">function f(x) {\n  return x;\n}</code></pre><pre>plain\n  indented</pre><p>After.</p>');
    assert.deepEqual(b.map((x) => [x.type, x.text]), [['code', 'function f(x) {\n  return x;\n}'], ['code', 'plain\n  indented'], ['para', 'After.']]);
  });

  test('Emboss\'s own HTML export: inline code and a code block read back', () => {
    const model = { blocks: [
      { type: 'para', segments: [{ type: 'text', text: 'Call ' }, { type: 'text', text: 'code_text', uncontracted: true }, { type: 'text', text: ' here.' }] },
      { type: 'code', text: 'function f(x) {\n  return x  +  1;\n}' },
    ] };
    const b = parseHtml(X.exportToHtml(model, {})).blocks;
    assert.deepEqual(b[0].segments.filter((s) => s.uncontracted).map((s) => s.text), ['code_text']);
    assert.deepEqual([b[1].type, b[1].text], ['code', 'function f(x) {\n  return x  +  1;\n}']);
  });
});

const CONTAINER = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
const xhtml = (body) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

describe('S5D-Q4 EPUB: the chapters go through the same reader', () => {
  test('alt text, a decorative picture, a figure with caption and description, inline <code> and <pre><code>', async () => {
    const opf = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title></metadata>'
      + '<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="img" href="dot.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>';
    const buf = await makeZip([{ name: 'META-INF/container.xml', text: CONTAINER }, { name: 'OEBPS/content.opf', text: opf },
      { name: 'OEBPS/c1.xhtml', text: xhtml('<h1>Chapter</h1><p>Run <code>x = f(y)</code> now.</p><pre><code>a = 1;\n  b = 2;</code></pre>'
        + '<img src="dot.png" alt="A red dot"/><img src="dot.png" alt=""/>'
        + '<figure><img src="dot.png" alt="Figure alt"/><figcaption>Figure 1. Caption.</figcaption><p class="image-description">Production note.</p></figure>') },
      { name: 'OEBPS/dot.png', data: PNG }]).arrayBuffer();
    const m = await parseEpub(buf);
    const p = m.blocks.find((b) => b.type === 'para');
    assert.deepEqual(p.segments.filter((s) => s.uncontracted).map((s) => s.text), ['x = f(y)'], JSON.stringify(p.segments));
    assert.deepEqual(m.blocks.find((b) => b.type === 'code').text, 'a = 1;\n  b = 2;');
    const g = m.blocks.filter((b) => b.type === 'graphic');
    assert.deepEqual(g.map((x) => [x.alt, !!x.decorative, x.caption, x.description]), [['A red dot', false, undefined, undefined], ['', true, undefined, undefined], ['Figure alt', false, 'Figure 1. Caption.', 'Production note.']]);
  });
});

// Found 17 Oct 2026 by this work (Paul: "fix both first"): a picture in an HTML/EPUB list item's own text, a linked one, or an item that is
// only a picture, was dropped with its description. It is now a picture of the item (item.blocks), after the item's text.
test('HTML: a picture in a list item is kept, as a picture of that item (inline, linked, the only content, nested)', async () => {
  const { parseHtml } = await import('../input/parse.mjs');
  const items = (h) => parseHtml(h).blocks.find((b) => b.type === 'list').items.map((i) => [i.text, i.level || 0, (i.blocks || []).map((g) => `${g.type}:${g.alt}`)]);
  assert.deepEqual(items('<ul><li>Apples <img src="a.png" alt="A red apple"/> are good</li><li>Pears</li></ul>'), [['Apples are good', 0, ['graphic:A red apple']], ['Pears', 0, []]]);
  assert.deepEqual(items('<ol><li>One <a href="x"><img src="b.png" alt="Logo"/></a></li></ol>'), [['One', 0, ['graphic:Logo']]]);
  assert.deepEqual(items('<ul><li><img src="p.png" alt="A green pear"/></li><li>Plums</li></ul>'), [['', 0, ['graphic:A green pear']], ['Plums', 0, []]]);
  assert.deepEqual(items('<ul><li>A<ul><li>B <img src="c.png" alt="C"/></li></ul></li></ul>'), [['A', 0, []], ['B', 1, ['graphic:C']]], 'a nested item\'s picture is the nested item\'s, not its parent\'s');
  assert.deepEqual(items('<ul><li></li><li>Plums</li></ul>'), [['Plums', 0, []]], 'an empty item with no picture is still left out');
});
