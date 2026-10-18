// 23 Sep — sort of the remaining Word / EPUB / HTML / Markdown import gaps (see
// Emboss/docs/g4-real-file-import.md, "Import gap sort, 23 Sep"). Each block pins one REAL
// loss that was fixed (the measurement-only differences have no test — they live in
// Emboss/scripts/measure-import-fidelity.mjs). Every saved export must stay well-formed.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml, parseDocx, parseMarkdown } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const zipBuf = async (files) => await makeZip(files).arrayBuffer();
function assertWellFormed(xml) {
  let errored = false;
  const dom = new DOMParser({ onError: (l) => { if (l === 'error' || l === 'fatalError') errored = true; } }).parseFromString(xml, 'text/xml');
  assert.ok(dom && dom.documentElement);
  assert.equal(errored, false, `saved XML must be well-formed:\n${xml}`);
}
const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function docx(bodyXml, stylesXml) {
  const files = [{ name: 'word/document.xml', text: `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyXml}</w:body></w:document>` }];
  if (stylesXml) files.push({ name: 'word/styles.xml', text: `<?xml version="1.0"?><w:styles xmlns:w="${W}">${stylesXml}</w:styles>` });
  return parseDocx(await zipBuf(files));
}
const segsOf = (blocks) => blocks.flatMap((b) => b.segments || []);

describe('DOCX: emphasis from a run\'s character style (rStyle), not only direct w:b/w:i/w:u', () => {
  const styles = `
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="character" w:styleId="KeyTerm"><w:name w:val="Key term"/><w:basedOn w:val="Strong"/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Notes"><w:name w:val="Notes"/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="character" w:styleId="NotesChar"><w:name w:val="Notes Char"/><w:link w:val="Notes"/><w:rPr><w:b/></w:rPr></w:style>`;

  test('a Strong-styled run is bold; a style based on it inherits bold and adds italic', async () => {
    const { blocks } = await docx(`<w:p><w:r><w:t xml:space="preserve">a </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>strong</w:t></w:r><w:r><w:t xml:space="preserve"> b </w:t></w:r><w:r><w:rPr><w:rStyle w:val="KeyTerm"/></w:rPr><w:t>term</w:t></w:r></w:p>`, styles);
    const segs = segsOf(blocks);
    assert.equal(segs.find((s) => s.text === 'strong')?.tf, TF_BOLD);
    assert.equal(segs.find((s) => s.text === 'term')?.tf, TF_BOLD | TF_ITALIC);
    assert.equal(segs.find((s) => s.text === 'a ')?.tf, undefined);
  });

  test('a direct <w:b w:val="0"/> switches the style\'s bold off', async () => {
    const { blocks } = await docx(`<w:p><w:r><w:rPr><w:rStyle w:val="Strong"/><w:b w:val="0"/></w:rPr><w:t>plain</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r></w:p>`, styles);
    const segs = segsOf(blocks);
    assert.equal(segs.find((s) => s.text === 'plain')?.tf, undefined);
  });

  // LINK-2 (Paul, 28 Sep 2026, KD round-2 Q1) reverses the first half of this: unlike bold/
  // italic (still not read from the Hyperlink style — csUsable/charStyleEmphasis, unchanged),
  // its underline specifically means "print showed this link underlined", so a run styled
  // Hyperlink now DOES carry TF_UNDERLINE (charStyleLinkUnderline) — was `!segsOf(blocks).
  // some((s) => s.tf)`, no tf at all. The "… Char" twin exclusion is unaffected — inside a paragraph of the partner style.
  // EXPECTATION CHANGED 30 Sep 2026 (import fix list #34, Paul's list; statutory-guidance-probation-roles.docx): the twin
  // was ignored EVERYWHERE, so the bold-italic "Formal sign-off as 'professionally qualified'" in a numbered-list paragraph
  // came in plain although print shows it bold italic. The twin of a paragraph style is that paragraph style's own look only
  // inside a paragraph OF that style (or one based on it); on words in any other paragraph it is ordinary inline formatting.
  test('Word\'s Hyperlink character style underlines a link (LINK-2); a linked "… Char" twin of a paragraph style is not inline emphasis inside a paragraph of that style', async () => {
    const { blocks } = await docx(`<w:p><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>www.x.org</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Notes"/></w:pPr><w:r><w:rPr><w:rStyle w:val="NotesChar"/></w:rPr><w:t xml:space="preserve">note</w:t></w:r></w:p>`, styles);
    const segs = segsOf(blocks);
    assert.equal(segs.find((s) => s.text === 'www.x.org')?.tf, TF_UNDERLINE);
    assert.equal(segs.find((s) => s.text === 'note')?.tf, undefined);
    assert.equal(blocks[0].type, 'para');
  });
  test('the same linked twin on words in another kind of paragraph is bold (import fix list #34)', async () => {
    const { blocks } = await docx(`<w:p><w:r><w:t xml:space="preserve">plain </w:t></w:r><w:r><w:rPr><w:rStyle w:val="NotesChar"/></w:rPr><w:t>note</w:t></w:r></w:p>`, styles);
    const segs = segsOf(blocks);
    assert.equal(segs.find((s) => s.text === 'note')?.tf, TF_BOLD);
    assert.equal(segs.find((s) => s.text === 'plain ')?.tf, undefined);
  });

  test('a save carries the styled bold through', async () => {
    const model = await docx(`<w:p><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>loud</w:t></w:r><w:r><w:t xml:space="preserve"> word</w:t></w:r></w:p>`, styles);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<strong>loud<\/strong>/);
  });
});

describe('DOCX: runs inside a tracked insertion / smart tag / simple field are read', () => {
  test('emphasis on a run wrapped in <w:ins> survives (its text was read by the plain path but lost from the segments)', async () => {
    const { blocks } = await docx(`<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r><w:ins w:id="1" w:author="a"><w:r><w:rPr><w:b/></w:rPr><w:t>added</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> text</w:t></w:r></w:p>`);
    const segs = segsOf(blocks);
    assert.equal(segs.find((s) => s.text === 'added')?.tf, TF_BOLD, JSON.stringify(blocks));
    assert.equal(segs.map((s) => s.text).join(''), 'see added text');
  });
});

describe('DOCX: a table with no text at all is not imported as an empty shell', () => {
  const emptyTbl = '<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr><w:tr><w:tc><w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr></w:p></w:tc></w:tr></w:tbl>';
  test('all-empty layout table dropped', async () => {
    const { blocks } = await docx(`${emptyTbl}<w:p><w:r><w:t>After.</w:t></w:r></w:p>`);
    assert.deepEqual(blocks, [{ type: 'para', text: 'After.' }]);
  });
  test('a table with any text is kept, empty rows still dropped', async () => {
    // Header row marked (w:tblHeader): an unmarked one-column table is a layout table and is
    // unwrapped into paragraphs (table-kind.mjs, layout_tables.test.mjs).
    const { blocks } = await docx('<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>H</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p/></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>v</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
    assert.deepEqual(blocks, [{ type: 'table', headers: ['H'], rows: [['v']] }]);
  });
});

describe('HTML/EPUB: a container mixing text with a link or emphasis stays one paragraph and keeps them', () => {
  const html = '<body><div>\n  To donate visit <a href="https://www.gutenberg.org/donate/">www.gutenberg.org/donate</a>. Thank <em>you</em>.\n</div></body>';
  test('one paragraph, href and italic preserved (was: three paragraphs, link dropped)', () => {
    const { blocks } = parseHtml(html);
    assert.equal(blocks.length, 1, JSON.stringify(blocks));
    const segs = blocks[0].segments;
    assert.equal(segs.find((s) => s.text === 'www.gutenberg.org/donate')?.href, 'https://www.gutenberg.org/donate/');
    assert.equal(segs.find((s) => s.text === 'you')?.tf, TF_ITALIC);
    assert.equal(segs.map((s) => s.text).join(''), 'To donate visit www.gutenberg.org/donate. Thank you.');
  });
  test('a save exports the link', () => {
    const xml = exportToNimasXml(parseHtml(html));
    assertWellFormed(xml);
    assert.match(xml, /<a href="https:\/\/www\.gutenberg\.org\/donate\/">www\.gutenberg\.org\/donate<\/a>/);
  });
  test('<br>-separated lines of a div keep one paragraph per line; only the line with the link merges', () => {
    const { blocks } = parseHtml('<body><div>first line<br>second <a href="https://x.org">link</a> line<br>third line</div></body>');
    assert.equal(blocks.length, 3, JSON.stringify(blocks));
    assert.equal(blocks[0].text, 'first line');
    assert.equal(blocks[1].segments.find((s) => s.href)?.href, 'https://x.org');
    assert.equal(blocks[2].text, 'third line');
  });
  test('a run with no link/emphasis behaves as before (one paragraph per text node)', () => {
    const { blocks } = parseHtml('<body><div>just <span>plain</span> text</div></body>');
    assert.ok(blocks.every((b) => !b.segments), JSON.stringify(blocks));
  });
});

describe('HTML: a one-line verse paragraph is a verse line', () => {
  test('<p class="poem">refrain</p> (no <br>) becomes a verse block', () => {
    const { blocks } = parseHtml('<body><p class="poem">“Wow! wow! wow!”</p></body>');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'play');
    assert.equal(blocks[0].subtype, 'verse');
  });
  test('a paragraph whose class merely contains "poem" and has no <br> stays prose', () => {
    const { blocks } = parseHtml('<body><p class="poem-title">Ode</p></body>');
    assert.equal(blocks[0].type, 'para');
  });
});

describe('Markdown: underscore emphasis, blockquote structure, comments, list continuation', () => {
  test('_two words_ and _x_ are italic; snake_case_name and code spans are untouched', () => {
    const { blocks } = parseMarkdown('A _data type_ is a _n_ thing, keep snake_case_name and `a_b_c`.');
    const segs = blocks[0].segments;
    assert.equal(segs.find((s) => s.text === 'data type')?.tf, TF_ITALIC);
    assert.equal(segs.find((s) => s.text === 'n')?.tf, TF_ITALIC);
    const flat = segs.map((s) => s.text).join('');
    assert.match(flat, /snake_case_name/);
    assert.match(flat, /a_b_c/);
  });
  test('plain-text path: an identifier with underscores keeps them (no emphasis anywhere)', () => {
    const { blocks } = parseMarkdown('Call my_var_name now.');
    assert.equal(blocks[0].text, 'Call my_var_name now.');
  });

  const md = [
    '> ##### Heads up', '>', '> First _quoted_ paragraph with a [link](https://x.org).', '>',
    '> Second paragraph, see [the docs][d].', '>', '> - one', '> - two wrapped', '>   line', '',
    'After the quote.', '', '[d]: https://docs.example/d', ''].join('\n');

  test('a blockquote is parsed as Markdown: paragraphs (style quote, shared id), heading, list, emphasis, links', () => {
    const { blocks } = parseMarkdown(md);
    const quotes = blocks.filter((b) => b.style === 'quote');
    assert.equal(quotes.length, 2, JSON.stringify(blocks));
    assert.equal(quotes[0].blockquoteId, quotes[1].blockquoteId);
    assert.ok(quotes[0].blockquoteId != null);
    assert.equal(quotes[0].segments.find((s) => s.text === 'quoted')?.tf, TF_ITALIC);
    assert.equal(quotes[0].segments.find((s) => s.text === 'link')?.href, 'https://x.org');
    assert.equal(quotes[1].segments.find((s) => s.text === 'the docs')?.href, 'https://docs.example/d');
    assert.ok(blocks.some((b) => b.type === 'heading' && b.level === 5 && b.text === 'Heads up'));
    const list = blocks.find((b) => b.type === 'list');
    assert.equal(list.items.length, 2);
    assert.equal(list.items[1].text, 'two wrapped line', 'a wrapped continuation line joins its item');
    assert.ok(!blocks.some((b) => b.type === 'note'), 'no transcriber note is invented');
    assert.equal(blocks.at(-1).text, 'After the quote.');
  });
  test('a single-paragraph quote gets no id, and the save is well-formed with a <blockquote>', () => {
    const model = parseMarkdown('> Just one line.\n');
    assert.equal(model.blocks[0].style, 'quote');
    assert.equal(model.blocks[0].blockquoteId, undefined);
    const xml = exportToNimasXml(parseMarkdown(md));
    assertWellFormed(xml);
    assert.match(xml, /<blockquote/);
  });
  test('an HTML comment is removed outside a fence but kept inside fenced code', () => {
    const { blocks } = parseMarkdown('See [Ch 4][s]<!-- ignore --> for more.\n\n```\n<!-- keep me -->\n```\n\n[s]: c4.md\n');
    const para = blocks.find((b) => b.type === 'para');
    assert.equal(para.segments.map((s) => s.text).join(''), 'See Ch 4 for more.');
    assert.equal(blocks.find((b) => b.type === 'code').text, '<!-- keep me -->');
  });
});
