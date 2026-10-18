// A46/A47 — real-document import fidelity (Emboss/docs/g4-real-file-import.md, 23 Sep).
//
// A46 (stage 1): bold, italic and links were dropped on import — verified 23 Sep,
// `parseFile('t.html', '<p>Plain <b>bold</b> and <i>italic</i> and <a href="https://x.org">a
// link</a>.</p>')` returned one paragraph with NO segments at all (confirmed again in this
// session with a standalone copy of the pre-fix hasInlineElements/htmlParagraphSegments code —
// see the scratch folder's before-fix-repro.mjs; not copied into the repo). The same loss
// affected EPUB (goes through the HTML path), DOCX (w:hyperlink's r:id was never resolved to a
// URL) and ODT (text:span's style was never resolved to bold/italic/underline, and text:a's
// href was dropped). Markdown's `**bold**`/`*italic*` already worked before this task and are
// only guarded here, not changed; Markdown's `[text](url)` href is deliberately left as-is (see
// the note on that test) since fixing it would conflict with an existing, out-of-scope-to-edit
// regression pin (input/parse-regressions.test.mjs #9) and the real corpus has zero inline
// markdown links to lose (g4 doc: only reference-style `[text][ref]` links appear, a distinct,
// still-open code path).
//
// A47 (stage 2): an HTML/EPUB <blockquote> parsed to a `note` block (D9), which
// nimas-export.mjs always serialises as <prodnote> — a transcriber's note, wrongly read aloud
// as one, instead of DTBook's own <blockquote> (parseDtbook's own <blockquote> handling already
// produces a style:'quote' paragraph for this — matched here). Verse written as Gutenberg-style
// `<p class="poem">line<br>line…</p>` collapsed every <br> to a single space, losing the line
// structure (D10) — Emboss already models a verse line as its own
// {type:'play', subtype:'verse', style:'verse'} block (parsePoem / nimas-export's
// 'verse'/'poem'/'play' case, which writes an untagged one back as <p class="bai-verse">, no
// invented <poem> wrapper); the HTML parser just never produced it for this pattern.
//
// Each stage tests the parser's output directly AND a full save (exportToNimasXml), since the
// exported DTBook is what a transcriber actually gets.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml, parseEpub, parseDocx, parseOdt, parseMarkdown, parseRtf } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const zipBuf = async (files) => await makeZip(files).arrayBuffer();

// The exported XML is well-formed (necessary, not sufficient, for DTBook validity — the full
// NIMAS check is `node Emboss/scripts/daisy-validate.mjs`, run separately, not part of this
// fast unit suite; see the task's own final report for that run).
function assertWellFormed(xml) {
  let errored = false;
  const parser = new DOMParser({ onError: (level) => { if (level === 'error' || level === 'fatalError') errored = true; } });
  const dom = parser.parseFromString(xml, 'text/xml');
  assert.ok(dom && dom.documentElement, 'saved XML parses back to a document');
  assert.equal(errored, false, `saved XML must be well-formed:\n${xml}`);
}

const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;

// ---------------------------------------------------------------------------
// A46 stage 1 — bold/italic/links
// ---------------------------------------------------------------------------
describe('A46: HTML — bold, italic and links survive import', () => {
  const html = '<p>Plain <b>bold</b> and <i>italic</i> and <a href="https://x.org">a link</a>.</p>';

  test('parseHtml produces segments carrying tf and href (not a flattened plain paragraph)', () => {
    const { blocks } = parseHtml(html);
    assert.equal(blocks.length, 1);
    assert.ok(Array.isArray(blocks[0].segments) && blocks[0].segments.length > 1, `expected segments, got ${JSON.stringify(blocks[0])}`);
    const bold = blocks[0].segments.find((s) => s.text === 'bold');
    const italic = blocks[0].segments.find((s) => s.text === 'italic');
    const link = blocks[0].segments.find((s) => s.text === 'a link');
    assert.equal(bold?.tf, TF_BOLD);
    assert.equal(italic?.tf, TF_ITALIC);
    assert.equal(link?.href, 'https://x.org');
  });

  test('a save (exportToNimasXml) carries bold/italic/link out to the transcriber', () => {
    const xml = exportToNimasXml(parseHtml(html));
    assertWellFormed(xml);
    assert.match(xml, /<strong>bold<\/strong>/);
    assert.match(xml, /<em>italic<\/em>/);
    assert.match(xml, /<a href="https:\/\/x\.org">a link<\/a>/);
  });

  test('nested emphasis combines typeform bits (<b><i>…</i></b>)', () => {
    const { blocks } = parseHtml('<p><b><i>both</i></b></p>');
    const seg = blocks[0].segments.find((s) => s.text === 'both');
    assert.equal(seg?.tf, TF_BOLD | TF_ITALIC);
  });

  test('<u> survives as underline typeform', () => {
    const { blocks } = parseHtml('<p>plain <u>underlined</u> text</p>');
    const seg = blocks[0].segments.find((s) => s.text === 'underlined');
    assert.equal(seg?.tf, TF_UNDERLINE);
  });

  test('a pretty-printed source (newlines/indentation around inline emphasis) does not turn into hard line breaks', () => {
    const { blocks } = parseHtml('<p>The quick\n      <em>brown</em>\n      fox</p>');
    const flat = blocks[0].segments.map((s) => s.text).join('');
    assert.equal(flat, 'The quick brown fox');
  });
});

describe('A46: EPUB — same fix via the shared HTML path', () => {
  test('bold/italic/link survive parseEpub + exportToNimasXml', async () => {
    const epub = await zipBuf([
      { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OEBPS/content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Book</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
      { name: 'OEBPS/c1.xhtml', text: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Said <i>very</i> quietly, with <a href="https://gutenberg.org">a link</a>.</p></body></html>' },
    ]);
    const model = await parseEpub(epub);
    const seg = model.blocks[0].segments;
    assert.ok(seg.some((s) => s.text === 'very' && s.tf === TF_ITALIC));
    assert.ok(seg.some((s) => s.href === 'https://gutenberg.org'));
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<em>very<\/em>/);
    assert.match(xml, /<a href="https:\/\/gutenberg\.org">a link<\/a>/);
  });
});

describe('A46: DOCX — w:b/w:i and a resolved w:hyperlink relationship survive import', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const docXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> Italic</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:t>a link</w:t></w:r></w:hyperlink></w:p>
</w:body></w:document>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.gov.uk/page" TargetMode="External"/></Relationships>`;

  test('parseDocx resolves the relationship id to a real href, alongside bold/italic', async () => {
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/_rels/document.xml.rels', text: relsXml }]);
    const { blocks } = await parseDocx(buf);
    const segs = blocks[0].segments;
    assert.ok(segs.some((s) => s.text === 'Bold' && s.tf === TF_BOLD));
    assert.ok(segs.some((s) => s.text === ' Italic' && s.tf === TF_ITALIC));
    assert.ok(segs.some((s) => s.text === 'a link' && s.href === 'https://example.gov.uk/page'), JSON.stringify(segs));
  });

  test('a save carries the resolved link out (exportToNimasXml)', async () => {
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/_rels/document.xml.rels', text: relsXml }]);
    const model = await parseDocx(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<strong>Bold<\/strong>/);
    assert.match(xml, /<em> Italic<\/em>/);
    assert.match(xml, /<a href="https:\/\/example\.gov\.uk\/page">a link<\/a>/);
  });

  test('a hyperlink with no resolvable relationship (no rels part) keeps its text, no href — unchanged from before this fix', async () => {
    // input/parse-regressions.test.mjs #3 pins exactly this shape (docx zip with no rels
    // part) to the pre-existing "text kept, no href" behaviour; this is the same fixture
    // confirming the A46 fix does not regress it.
    const noRelsXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t xml:space="preserve"> link text</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: noRelsXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks[0], { type: 'para', segments: [{ type: 'text', text: 'Bold', tf: TF_BOLD }, { type: 'text', text: ' link text tail' }] });
  });
});

describe('A46: ODT — text:span (resolved automatic style) and text:a survive import', () => {
  const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const contentXml = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="${T}" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:automatic-styles>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
</office:automatic-styles>
<office:body><office:text>
<text:p>Plain <text:span text:style-name="T1">bold</text:span> and <text:span text:style-name="T2">italic</text:span> and <text:a xlink:href="mailto:x@y.gov.uk">a link</text:a>.</text:p>
</office:text></office:body></office:document-content>`;

  test('parseOdt resolves the automatic style to bold/italic and keeps the link href', async () => {
    const buf = await zipBuf([{ name: 'content.xml', text: contentXml }]);
    const { blocks } = await parseOdt(buf);
    const segs = blocks[0].segments;
    assert.ok(segs.some((s) => s.text === 'bold' && s.tf === TF_BOLD), JSON.stringify(segs));
    assert.ok(segs.some((s) => s.text === 'italic' && s.tf === TF_ITALIC));
    assert.ok(segs.some((s) => s.text === 'a link' && s.href === 'mailto:x@y.gov.uk'));
  });

  test('a save carries bold/italic/link out (exportToNimasXml)', async () => {
    const buf = await zipBuf([{ name: 'content.xml', text: contentXml }]);
    const model = await parseOdt(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<strong>bold<\/strong>/);
    assert.match(xml, /<em>italic<\/em>/);
    assert.match(xml, /<a href="mailto:x@y\.gov\.uk">a link<\/a>/);
  });
});

describe('A46: Markdown — bold/italic already worked; left unchanged', () => {
  // Per the task's own instruction ("check whether these already work before changing
  // anything"): **bold**/*italic* already produced tf-bearing segments before this task, so
  // nothing was changed for Markdown. This is a regression guard, not a fix.
  test('**bold** / *italic* still produce tf-bearing segments', () => {
    const { blocks } = parseMarkdown('see **bold** and *italic* text');
    const segs = blocks[0].segments;
    assert.ok(segs.some((s) => s.tf === TF_BOLD));
    assert.ok(segs.some((s) => s.tf === TF_ITALIC));
  });
});

// ---------------------------------------------------------------------------
// A47 stage 2 — blockquote and verse
// ---------------------------------------------------------------------------
describe('A47: HTML <blockquote> is Emboss\'s displayed-quotation block, not a transcriber\'s note', () => {
  const html = '<blockquote><div>Quoted text with a <a href="https://x.org">link</a> inside.</div></blockquote>';

  test('parseHtml produces a style:\'quote\' paragraph, not a note block', () => {
    const { blocks } = parseHtml(html);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'para');
    assert.equal(blocks[0].style, 'quote');
    assert.notEqual(blocks[0].type, 'note');
    assert.ok(blocks[0].segments.some((s) => s.href === 'https://x.org'));
  });

  test('a save writes <blockquote>, never <prodnote>, for the quoted text', () => {
    const xml = exportToNimasXml(parseHtml(html));
    assertWellFormed(xml);
    assert.match(xml, /<blockquote/);
    assert.doesNotMatch(xml, /<prodnote[^>]*>Quoted text/);
    assert.match(xml, /Quoted text with a <a href="https:\/\/x\.org">link<\/a> inside\./);
  });

  test('a multi-paragraph blockquote is wrapped in one <blockquote>, not one per paragraph', () => {
    const multi = '<blockquote><p>First paragraph.</p><p>Second paragraph.</p></blockquote>';
    const xml = exportToNimasXml(parseHtml(multi));
    assertWellFormed(xml);
    const opens = (xml.match(/<blockquote/g) || []).length;
    const closes = (xml.match(/<\/blockquote>/g) || []).length;
    assert.equal(opens, 1, xml);
    assert.equal(closes, 1, xml);
    assert.match(xml, /First paragraph\.[\s\S]*Second paragraph\./);
  });
});

describe('A47: HTML verse (<br>-separated lines) keeps its line structure', () => {
  const poem = '<p class="poem">How doth the little crocodile<br>Improve his shining tail,<br><br>How cheerfully he seems to grin,<br>How neatly spread his claws!</p>';

  test('parseHtml produces one verse block per line, with a stanza-break indicator for the blank line', () => {
    const { blocks } = parseHtml(poem);
    const verse = blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verse.length, 4, JSON.stringify(blocks));
    assert.equal(verse[0].text, 'How doth the little crocodile');
    assert.equal(verse[1].text, 'Improve his shining tail,');
    assert.equal(verse[2].text, 'How cheerfully he seems to grin,');
    assert.equal(verse[3].text, 'How neatly spread his claws!');
    assert.ok(blocks.some((b) => b.type === 'indicator' && b.kind === 'line'), 'blank line between stanzas kept as an indicator');
  });

  // 1 Oct 2026 (import fix list #50; docs/expectation-changes.md): a class-marked poem paragraph is a poem, so a save writes its lines
  // as <line>s of a <poem> (a <linegroup> per stanza). It was <p class="bai-verse"> per line, which the DTBook reader reads back as
  // verse drama (D5), so the braille changed on reopening (Alice's runover lines in cell 5 instead of 3).
  test('a save keeps each line as its own <line> of a <poem>, a stanza per <linegroup>, not one run-on paragraph', () => {
    const xml = exportToNimasXml(parseHtml(poem));
    assertWellFormed(xml);
    const verseLines = xml.match(/<line>[^<]*<\/line>/g) || [];
    assert.equal(verseLines.length, 4, xml);
    assert.match(xml, /<poem>\s*<linegroup>\s*<line>How doth the little crocodile<\/line>\s*<line>Improve his shining tail,<\/line>\s*<\/linegroup>\s*<linegroup>/);
    // The whole poem must never collapse into one paragraph carrying every line's text.
    assert.doesNotMatch(xml, /How doth the little crocodile Improve his shining tail/);
  });

  // CHANGED 30 Sep 2026 (import fix list #29, Paul's brief): this test used to pin `<br>` -> a space ("Address line one Address line two").
  // A <br> inside a paragraph is now a forced line break ('\n' in the text, as the Word and DTBook readers have it), because print shows the
  // line break (an address, a signature). What the test is about is unchanged: the paragraph is still ONE ordinary paragraph, not verse.
  test('an ordinary paragraph with a stray <br> (not class="poem"/"verse") stays one paragraph, with a forced line break', () => {
    const { blocks } = parseHtml('<p>Address line one<br>Address line two</p>');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'para');
    assert.equal(blocks[0].segments.map((s) => s.text).join(''), 'Address line one\nAddress line two');
  });
});

// ---------------------------------------------------------------------------
// A45 — DOCX/ODT images and footnotes (Emboss/docs/g4-real-file-import.md's D2/D3: 0 of
// 573 images and 0 of 83 footnotes survived any DOCX/ODT import). Fixed in parse.mjs by
// giving a picture the same {type:'graphic', src, alt, caption} shape parseDtbook's own
// pushImage/parseImgGroup build for a DTBook <img>/<imggroup> (A26/A29), and a footnote the
// same {type:'noteref'}/{type:'footnote'} shapes parseDtbook's walkInline/pushNote build
// for <noteref>/<note> — never the RTF reader's A44/D6 mistake of splicing note text into
// the middle of the referencing sentence.
// ---------------------------------------------------------------------------
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);

describe('A45: DOCX — an embedded picture survives import, never silently dropped', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const drawing = (docPrAttrs, rid) => `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1" cy="1"/><wp:docPr id="1" ${docPrAttrs}/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  const relsXml = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;

  test('a picture with real alt text produces a graphic block carrying the image bytes', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r>${drawing('name="Picture 1" descr="A red triangle diagram"', 'rId5')}</w:r></w:p>
<w:p><w:r><w:t>Body text.</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([
      { name: 'word/document.xml', text: docXml },
      { name: 'word/_rels/document.xml.rels', text: relsXml },
      { name: 'word/media/image1.png', data: PNG_BYTES },
    ]);
    const model = await parseDocx(buf);
    assert.equal(model.blocks[0].type, 'graphic', JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].alt, 'A red triangle diagram');
    assert.equal(model.blocks[0].src, 'media/image1.png');
    assert.equal(model.blocks[1].type, 'para');
    assert.ok(Array.isArray(model.resources) && model.resources.length === 1, JSON.stringify(model.resources));
    assert.equal(model.resources[0].path, 'media/image1.png');
    assert.equal(model.resources[0].mime, 'image/png');
    assert.deepEqual([...model.resources[0].bytes], [...PNG_BYTES]);
  });

  test('a save keeps the picture as a real <img>, not a dropped/placeholder note', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r>${drawing('name="Picture 1" descr="A red triangle diagram"', 'rId5')}</w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([
      { name: 'word/document.xml', text: docXml },
      { name: 'word/_rels/document.xml.rels', text: relsXml },
      { name: 'word/media/image1.png', data: PNG_BYTES },
    ]);
    const model = await parseDocx(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<img[^>]*alt="A red triangle diagram"/);
  });

  test('a picture with no alt text at all still produces a block (its own Word default name is NOT used as alt — docx-fix item 3)', async () => {
    // "Picture 12" is Word's own auto-generated docPr name, never text a real author wrote
    // (see DOCX_DEFAULT_PICTURE_NAME_RE) — BANA 6.4.1 treats this exactly like an HTML <img
    // alt=""> (an uncaptioned, undescribed picture): the block is kept (still one block,
    // still a resource), but with no alt text, so the formatter's existing §6.4.1 omission
    // applies instead of printing a meaningless "[Picture 12]".
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r>${drawing('name="Picture 12"', 'rId5')}</w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/_rels/document.xml.rels', text: relsXml }, { name: 'word/media/image1.png', data: PNG_BYTES }]);
    const model = await parseDocx(buf);
    assert.equal(model.blocks.length, 1, JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].type, 'graphic');
    assert.equal(model.blocks[0].alt, '');
  });

  test('a Word "Caption"-styled paragraph right after an image becomes its caption, not an orphaned paragraph', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r>${drawing('name="Picture 1" descr="A diagram"', 'rId5')}</w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>Figure 1: the diagram</w:t></w:r></w:p>
<w:p><w:r><w:t>Next paragraph.</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/_rels/document.xml.rels', text: relsXml }, { name: 'word/media/image1.png', data: PNG_BYTES }]);
    const model = await parseDocx(buf);
    assert.equal(model.blocks.length, 2, JSON.stringify(model.blocks));   // image (with caption folded in) + "Next paragraph."
    assert.equal(model.blocks[0].type, 'graphic');
    assert.equal(model.blocks[0].caption, 'Figure 1: the diagram');
    assert.equal(model.blocks[1].text, 'Next paragraph.');
  });
});

describe('A45: DOCX — a footnote reference and its body survive import, without D6\'s splicing bug', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><w:t xml:space="preserve">See the guidance</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r><w:r><w:t xml:space="preserve"> for details.</w:t></w:r></w:p>
</w:body></w:document>`;
  const footnotesXml = `<?xml version="1.0"?><w:footnotes xmlns:w="${W}">
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:id="2"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Full citation text.</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

  test('parseDocx keeps the reference mark in the sentence and the note as its own block', async () => {
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/footnotes.xml', text: footnotesXml }]);
    const model = await parseDocx(buf);
    const para = model.blocks[0];
    assert.equal(para.type, 'para');
    const ref = para.segments.find((s) => s.type === 'noteref');
    assert.ok(ref, JSON.stringify(para));
    assert.equal(ref.text, '1');                     // Word's first-referenced footnote is marked "1"
    const after = para.segments.find((s) => s.text && s.text.includes('for details'));
    assert.ok(after, 'the sentence continues after the reference, unsplit');
    const note = model.blocks.find((b) => b.type === 'footnote');
    assert.ok(note, JSON.stringify(model.blocks));
    assert.equal(note.text.trim(), 'Full citation text.');
    assert.equal(note.id, ref.idref);
    // D6 regression guard: the footnote's own text must never end up inside the paragraph.
    assert.ok(!para.segments.some((s) => s.text && s.text.includes('Full citation text')));
  });

  test('a save writes a real <note>/<noteref> pair, and the sentence reads unbroken', async () => {
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/footnotes.xml', text: footnotesXml }]);
    const model = await parseDocx(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<noteref idref="[^"]+">1<\/noteref>/);
    assert.match(xml, /<note id="[^"]+"[^>]*><p>\s*Full citation text\.\s*<\/p><\/note>/);
    assert.match(xml, /See the guidance<noteref[^>]*>1<\/noteref> for details\./);
  });
});

describe('A45: ODT — a draw:frame picture survives import, never silently dropped', () => {
  const contentXmlFor = (frame, extraPara = '') => `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0">
<office:body><office:text>
<text:p>${frame}</text:p>${extraPara}
</office:text></office:body></office:document-content>`;

  test('a picture with real alt text (svg:title) produces a graphic block carrying the image bytes', async () => {
    const frame = '<draw:frame draw:name="Image1"><draw:image xlink:href="Pictures/image1.png"/><svg:title>A blue circle</svg:title><svg:desc>Circle description</svg:desc></draw:frame>';
    const buf = await zipBuf([{ name: 'content.xml', text: contentXmlFor(frame) }, { name: 'Pictures/image1.png', data: PNG_BYTES }]);
    const model = await parseOdt(buf);
    assert.equal(model.blocks.length, 1, JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].type, 'graphic');
    assert.equal(model.blocks[0].alt, 'A blue circle');
    assert.equal(model.blocks[0].description, 'Circle description');
    assert.equal(model.blocks[0].src, 'Pictures/image1.png');
    assert.ok(model.resources?.length === 1, JSON.stringify(model.resources));
    assert.equal(model.resources[0].path, 'Pictures/image1.png');
    assert.deepEqual([...model.resources[0].bytes], [...PNG_BYTES]);
  });

  test('a save keeps the picture as a real <img>, not a dropped/placeholder note', async () => {
    const frame = '<draw:frame draw:name="Image1"><draw:image xlink:href="Pictures/image1.png"/><svg:title>A blue circle</svg:title></draw:frame>';
    const buf = await zipBuf([{ name: 'content.xml', text: contentXmlFor(frame) }, { name: 'Pictures/image1.png', data: PNG_BYTES }]);
    const model = await parseOdt(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<img[^>]*alt="A blue circle"/);
  });

  // CHANGED 30 Sep 2026 (import fix list #35, audit #21): the picture is still a block, but its frame name is NOT its alt text.
  // Every LibreOffice picture gets a name ("Image2", "Frame7"); it is a label for the shape, not a description, and was being
  // brailled as one. Rule: a picture with no description has none (Word: its auto-generated "Picture 3" name is never the alt
  // text; BANA 6.4.1 omits an undescribed, uncaptioned illustration). Was: alt === 'Frame7'.
  test('a picture with no title/desc at all still produces a block (with no alt text: its frame name is not a description)', async () => {
    const frame = '<draw:frame draw:name="Frame7"><draw:image xlink:href="Pictures/image1.png"/></draw:frame>';
    const buf = await zipBuf([{ name: 'content.xml', text: contentXmlFor(frame) }, { name: 'Pictures/image1.png', data: PNG_BYTES }]);
    const model = await parseOdt(buf);
    assert.equal(model.blocks.length, 1, JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].type, 'graphic');
    assert.equal(model.blocks[0].alt, '');
  });

  test('a "Caption"-styled paragraph right after an image becomes its caption', async () => {
    const frame = '<draw:frame draw:name="Image1"><draw:image xlink:href="Pictures/image1.png"/><svg:title>A diagram</svg:title></draw:frame>';
    const stylesXml = '<office:automatic-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><style:style style:name="Figure" style:family="paragraph" style:parent-style-name="Caption"/></office:automatic-styles>';
    const content = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0">
${stylesXml}
<office:body><office:text>
<text:p>${frame}</text:p>
<text:p text:style-name="Figure">Figure 1: the diagram</text:p>
<text:p>Next paragraph.</text:p>
</office:text></office:body></office:document-content>`;
    const buf = await zipBuf([{ name: 'content.xml', text: content }, { name: 'Pictures/image1.png', data: PNG_BYTES }]);
    const model = await parseOdt(buf);
    assert.equal(model.blocks.length, 2, JSON.stringify(model.blocks));   // image (with caption folded in) + "Next paragraph."
    assert.equal(model.blocks[0].type, 'graphic');
    assert.equal(model.blocks[0].caption, 'Figure 1: the diagram');
    assert.equal(model.blocks[1].text, 'Next paragraph.');
  });
});

describe('A45: ODT — a footnote reference and its body survive import, without D6\'s splicing bug', () => {
  const content = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:text>
<text:p>See the guidance<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Full citation text.</text:p></text:note-body></text:note> for details.</text:p>
</office:text></office:body></office:document-content>`;

  test('parseOdt keeps the reference mark in the sentence and the note as its own block', async () => {
    const buf = await zipBuf([{ name: 'content.xml', text: content }]);
    const model = await parseOdt(buf);
    const para = model.blocks[0];
    assert.equal(para.type, 'para');
    const ref = para.segments.find((s) => s.type === 'noteref');
    assert.ok(ref, JSON.stringify(para));
    assert.equal(ref.text, '1');
    const after = para.segments.find((s) => s.text && s.text.includes('for details'));
    assert.ok(after, 'the sentence continues after the reference, unsplit');
    const note = model.blocks.find((b) => b.type === 'footnote');
    assert.ok(note, JSON.stringify(model.blocks));
    assert.equal(note.text.trim(), 'Full citation text.');
    assert.equal(note.id, ref.idref);
    // The paragraph's own flat text must never carry the note's body either (D6 regression guard).
    assert.ok(!para.text.includes('Full citation text'));
    assert.ok(!para.segments.some((s) => s.text && s.text.includes('Full citation text')));
  });

  test('a save writes a real <note>/<noteref> pair, and the sentence reads unbroken', async () => {
    const buf = await zipBuf([{ name: 'content.xml', text: content }]);
    const model = await parseOdt(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<noteref idref="[^"]+">1<\/noteref>/);
    assert.match(xml, /<note id="[^"]+"[^>]*><p>\s*Full citation text\.\s*<\/p><\/note>/);
    assert.match(xml, /See the guidance<noteref[^>]*>1<\/noteref> for details\./);
  });
});

// ---------------------------------------------------------------------------
// A48 — DOCX: a heading whose style isn't literally named Heading1..HeadingN (D1). Before
// this fix, `parseDocx`'s only heading check was `/^heading([1-9])/.test(style)` against the
// paragraph's raw `w:pStyle` id — a real document that defines its own style
// (`PHEHeading`, `TitleGrey`, …), extremely common in government/publisher templates, got
// silently demoted to a plain paragraph, with no check of the style's own `w:outlineLvl` in
// styles.xml at all. In the worst real corpus file
// (fungal-skin-nail-infections-guidance.docx) this zeroed out the entire heading hierarchy
// and the document's own title. See classifyDocxStyle in parse.mjs for the precedence this
// fix uses (outlineLvl on the nearest style in the w:basedOn chain that sets one; then a
// built-in Heading/Title/Subtitle id anywhere in that chain; then the style's own name
// against Word's stock display name; Title only, a name containing the word "title") and
// the task's own final report for why it stops there rather than guessing further.
// ---------------------------------------------------------------------------
describe('A48: DOCX — a heading survives when its style is not named Heading1..HeadingN', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const stylesXml = (extra) => `<?xml version="1.0"?><w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
${extra}
</w:styles>`;
  const docXmlFor = (styleId, text) => `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>
</w:body></w:document>`;

  test('a custom style based on a built-in heading (directly, and through a chain) is recognised', async () => {
    // OrgHeading1 -> Heading1 direct; OrgSubHeading -> OrgHeading1 -> Heading1, a two-hop
    // chain, mirroring the real corpus's TitlePage2 -> TitleGrey -> Title pattern.
    const extra = '<w:style w:type="paragraph" w:styleId="OrgHeading1"><w:name w:val="Org Heading 1"/><w:basedOn w:val="Heading1"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="OrgSubHeading"><w:name w:val="Org Sub Heading"/><w:basedOn w:val="OrgHeading1"/></w:style>';
    const doc1 = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="OrgHeading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="OrgSubHeading"/></w:pPr><w:r><w:t>Chapter One, Part A</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: doc1 }, { name: 'word/styles.xml', text: stylesXml(extra) }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [
      { type: 'heading', level: 1, text: 'Chapter One' },
      { type: 'heading', level: 1, text: 'Chapter One, Part A' },
    ], JSON.stringify(blocks));
  });

  test('a style with an outline level and no useful name is recognised (real corpus: PHEHeading)', async () => {
    // Mirrors fungal-skin-nail-infections-guidance.docx's own PHEHeading style exactly:
    // basedOn Normal (no heading in the chain at all), but its own w:outlineLvl is set
    // directly — the most reliable signal there is, per Word's own semantics.
    const extra = '<w:style w:type="paragraph" w:styleId="PHEHeading"><w:name w:val="PHE Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>';
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXmlFor('PHEHeading', 'About Public Health England') }, { name: 'word/styles.xml', text: stylesXml(extra) }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'heading', level: 1, text: 'About Public Health England' }], JSON.stringify(blocks));
  });

  test('a style named "heading 2" with a non-standard id is recognised', async () => {
    const extra = '<w:style w:type="paragraph" w:styleId="CustomStyle7"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>';
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXmlFor('CustomStyle7', 'Methodology') }, { name: 'word/styles.xml', text: stylesXml(extra) }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'heading', level: 2, text: 'Methodology' }], JSON.stringify(blocks));
  });

  test('a paragraph-level w:outlineLvl (no matching style signal) is recognised', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="Normal"/><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>Direct override</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml('') }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'heading', level: 3, text: 'Direct override' }], JSON.stringify(blocks));
  });

  test('a save (exportToNimasXml) carries the recognised heading out, at the right level', async () => {
    const extra = '<w:style w:type="paragraph" w:styleId="PHEHeading"><w:name w:val="PHE Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>';
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXmlFor('PHEHeading', 'Foreword') }, { name: 'word/styles.xml', text: stylesXml(extra) }]);
    const model = await parseDocx(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<h1>Foreword<\/h1>/);
  });

  test('ordinary body paragraphs — including ones with "Heading" in their style name — do not become headings (false-heading guard)', async () => {
    // Real corpus style names that look heading-ish but are NOT document structure:
    // TableHeading/ColumnHeading/BoxHeading (table/figure/box captions, no outlineLvl, not
    // based on a built-in heading), Word's own outlineLvl=9 "Body Text" sentinel on Normal
    // (must not be read as "level 10"), and a plain paragraph with no heading signal at all.
    const extra = '<w:style w:type="paragraph" w:styleId="TableHeading"><w:name w:val="Table Heading"/><w:basedOn w:val="Normal"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="BodyTextSentinel"><w:name w:val="Body Text Sentinel"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>';
    const doc1 = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="TableHeading"/></w:pPr><w:r><w:t>Column totals</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="BodyTextSentinel"/></w:pPr><w:r><w:t>An ordinary sentence about the budget.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Another ordinary paragraph.</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: doc1 }, { name: 'word/styles.xml', text: stylesXml(extra) }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [
      { type: 'para', text: 'Column totals' },
      { type: 'para', text: 'An ordinary sentence about the budget.' },
      { type: 'para', text: 'Another ordinary paragraph.' },
    ], JSON.stringify(blocks));
    assert.ok(blocks.every((b) => b.type !== 'heading' && b.type !== 'title'), JSON.stringify(blocks));
  });
});

describe('A48: DOCX — the document title survives when it is not literally styled "Title"', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const stylesXml = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="TitleGrey"><w:name w:val="Title Grey"/><w:basedOn w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="PHEFrontPageMainTitle"><w:name w:val="PHE Front Page Main Title"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;

  test('a style based on the built-in Title style (through a chain) sets the document title', async () => {
    // Mirrors template-framework-document-executive-agencies.docx's own TitleGrey/Subtitle
    // pairing exactly — this is the file the task names as having "lost its title".
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="TitleGrey"/></w:pPr><w:r><w:t>Specimen framework document:</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t>Executive agencies</w:t></w:r></w:p>
<w:p><w:r><w:t>Body text.</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml }]);
    const model = await parseDocx(buf);
    assert.equal(model.title, 'Specimen framework document:');
    // IMP-W1 (Paul, 30 Sep 2026, decisions.md "Word import"): the Subtitle goes WITH the Title as the second line of the same heading,
    // no longer a second title block (a chapter of its own). This test pinned { title 'Specimen…:' } then { title 'Executive agencies' }.
    assert.deepEqual(model.blocks[0], { type: 'title', text: 'Specimen framework document:\nExecutive agencies', segments: [{ type: 'text', text: 'Specimen framework document:\nExecutive agencies' }] });   // (segments: what the editor shows, line break kept)
    assert.deepEqual(model.blocks[1], { type: 'para', text: 'Body text.' });
  });

  test('a style whose own name contains "title" (no chain to the built-in style) sets the document title', async () => {
    // Mirrors fungal-skin-nail-infections-guidance.docx's own PHEFrontPageMainTitle
    // exactly: basedOn Normal, no outlineLvl anywhere, so only the name fallback catches it.
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="PHEFrontPageMainTitle"/></w:pPr><w:r><w:t>Fungal skin and nail infections</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml }]);
    const model = await parseDocx(buf);
    assert.equal(model.title, 'Fungal skin and nail infections');
    assert.deepEqual(model.blocks[0], { type: 'title', text: 'Fungal skin and nail infections' });
  });

  test('a save (exportToNimasXml) still validates and carries the recovered title text', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:pPr><w:pStyle w:val="TitleGrey"/></w:pPr><w:r><w:t>Specimen framework document:</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml }]);
    const model = await parseDocx(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<h1( class="bana-title")?>Specimen framework document:<\/h1>/);   // a title block keeps its identity on save (24 Sep)
  });
});

// ---------------------------------------------------------------------------
// A44 — RTF: no structural model at all (D5), and a footnote's text spliced into the
// surrounding sentence (D6). See Emboss/docs/g4-real-file-import.md and EMBOSS-TASKS.md's
// own A44 row. Six stages, smallest first; each stage's own describe block below.
// ---------------------------------------------------------------------------

describe('A44 stage 1: RTF — paragraph headings from \\outlinelevel and the \\stylesheet', () => {
  const stylesheet = '{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}{\\s2\\outlinelevel1 heading 2;}{\\s17 Title;}}';
  const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252\\deff0${stylesheet}${body}}`;

  test('a direct \\outlinelevel on the paragraph becomes a heading block, not flat text', () => {
    const model = parseRtf(doc('{\\pard\\outlinelevel0 Chapter One\\par}{\\pard Body text.\\par}'));
    assert.equal(model.blocks[0].type, 'heading', JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].level, 1);
    assert.equal(model.blocks[0].text, 'Chapter One');
    assert.equal(model.blocks[1].type, 'para');
  });

  test('a stylesheet heading style (\\s1, no direct override) is recognised via the style chain', () => {
    const model = parseRtf(doc('{\\pard\\s1 Chapter from style\\par}{\\pard\\s0 Ordinary body.\\par}'));
    assert.equal(model.blocks[0].type, 'heading', JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].level, 1);
    assert.equal(model.blocks[1].type, 'para');
  });

  test('a stylesheet Title style is recognised as the document title', () => {
    const model = parseRtf(doc('{\\pard\\s17 Report Title\\par}{\\pard\\s0 Body.\\par}'));
    assert.equal(model.title, 'Report Title');
    assert.equal(model.blocks[0].type, 'title');
  });

  test('a direct \\outlinelevel9 (body-text sentinel) overrides a heading style back to a plain paragraph', () => {
    const model = parseRtf(doc('{\\pard\\s1\\outlinelevel9 Styled as heading 1 but marked body text.\\par}{\\pard\\s0 Other.\\par}'));
    assert.equal(model.blocks[0].type, 'para', JSON.stringify(model.blocks));
  });

  test('a direct \\outlinelevel promotes an ordinary style to a heading', () => {
    const model = parseRtf(doc('{\\pard\\s0\\outlinelevel1 Promoted paragraph\\par}{\\pard\\s0 Other.\\par}'));
    assert.equal(model.blocks[0].type, 'heading', JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].level, 2);
  });

  test('a save (exportToNimasXml) turns the heading into a real <h1>', () => {
    const model = parseRtf(doc('{\\pard\\outlinelevel0 Chapter One\\par}{\\pard Body text.\\par}'));
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<h1>Chapter One<\/h1>/);
  });
});

// ---------------------------------------------------------------------------
describe('A44 stage 2: RTF — \\b/\\i/\\ul become tf segments, honouring nesting and \\b0/\\i0/\\ulnone', () => {
  const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;

  test('bold, italic and underline each produce a tf-carrying segment, and the off forms end them', () => {
    const model = parseRtf(doc('{\\pard Plain \\b bold\\b0  and \\i italic\\i0  and \\ul underlined\\ulnone  text.\\par}'));
    const segs = model.blocks[0].segments;
    assert.ok(segs.some((seg) => seg.text === 'bold' && seg.tf === TF_BOLD), JSON.stringify(segs));
    assert.ok(segs.some((seg) => seg.text === 'italic' && seg.tf === TF_ITALIC), JSON.stringify(segs));
    assert.ok(segs.some((seg) => seg.text === 'underlined' && seg.tf === TF_UNDERLINE), JSON.stringify(segs));
    assert.ok(segs.some((seg) => seg.text.includes('Plain') && !seg.tf), JSON.stringify(segs));
    assert.ok(segs.some((seg) => seg.text.includes('text.') && !seg.tf), JSON.stringify(segs));
  });

  test('nested bold+italic combine bits, and closing the group ends both at once', () => {
    const model = parseRtf(doc('{\\pard Before {\\b bold \\i bolditalic} after.\\par}'));
    const segs = model.blocks[0].segments;
    assert.ok(segs.some((seg) => seg.text === 'bold ' && seg.tf === TF_BOLD), JSON.stringify(segs));
    assert.ok(segs.some((seg) => seg.text === 'bolditalic' && seg.tf === (TF_BOLD | TF_ITALIC)), JSON.stringify(segs));
    assert.ok(segs.some((seg) => seg.text === ' after.' && !seg.tf), JSON.stringify(segs));
  });

  test('a save (exportToNimasXml) still validates with emphasis runs present', () => {
    const model = parseRtf(doc('{\\pard Plain \\b bold\\b0  text.\\par}'));
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
  });
});

// ---------------------------------------------------------------------------
// D6 — the corruption case: test first and hardest, per the task.
describe('A44 stage 3: RTF — a footnote sits at its reference point, not spliced into the sentence (D6)', () => {
  const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;
  const withFootnote = (n) => `{\\pard See the guidance\\chftn {\\footnote\\pard\\plain \\chftn  Full citation text ${n}.\\par} for details.\\par}`;

  test('the reference mark stays in place and the sentence continues unbroken; the note becomes its own block', () => {
    const model = parseRtf(doc(withFootnote(1)));
    const para = model.blocks[0];
    assert.equal(para.type, 'para');
    const ref = para.segments.find((seg) => seg.type === 'noteref');
    assert.ok(ref, JSON.stringify(para));
    assert.equal(ref.text, '1');
    const after = para.segments.find((seg) => seg.text && seg.text.includes('for details'));
    assert.ok(after, 'the sentence continues after the reference, unsplit');
    // D6 regression guard: the footnote's own text must never end up inside the paragraph.
    assert.ok(!para.segments.some((seg) => seg.text && seg.text.includes('Full citation text')));
    const note = model.blocks.find((b) => b.type === 'footnote');
    assert.ok(note, JSON.stringify(model.blocks));
    assert.equal(note.text.trim(), 'Full citation text 1.');
    assert.equal(note.id, ref.idref);
  });

  test('a save writes a real <note>/<noteref> pair, and the sentence reads unbroken', () => {
    const model = parseRtf(doc(withFootnote(1)));
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<noteref idref="[^"]+">1<\/noteref>/);
    assert.match(xml, /<note id="[^"]+"[^>]*><p>\s*Full citation text 1\.\s*<\/p><\/note>/);
    assert.match(xml, /See the guidance<noteref[^>]*>1<\/noteref> for details\./);
  });

  test('two footnotes in the same document number sequentially', () => {
    const model = parseRtf(doc('{\\pard First\\chftn {\\footnote\\pard\\plain \\chftn  Note one.\\par} sentence.\\par}{\\pard Second\\chftn {\\footnote\\pard\\plain \\chftn  Note two.\\par} sentence.\\par}'));
    const notes = model.blocks.filter((b) => b.type === 'footnote');
    assert.deepEqual(notes.map((note) => note.text.trim()), ['Note one.', 'Note two.']);
    const refs = model.blocks.filter((b) => b.type === 'para').flatMap((b) => b.segments.filter((seg) => seg.type === 'noteref'));
    assert.deepEqual(refs.map((r) => r.text), ['1', '2']);
  });
});

// ---------------------------------------------------------------------------
describe('A44 stage 4: RTF — a HYPERLINK field\'s target survives on the segment', () => {
  const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;
  // Real corpus shape: \*\fldinst's own HYPERLINK text sits inside a \rtlch/\ltrch
  // formatting subgroup, not directly in \*\fldinst's own group.
  const field = '{\\field{\\*\\fldinst {\\ltrch\\fcs0  HYPERLINK "https://example.org/page" }}{\\fldrslt {\\ul the guidance}}}';

  test('an external HYPERLINK field stamps .href on its visible text', () => {
    const model = parseRtf(doc(`{\\pard See ${field} for more.\\par}`));
    const segs = model.blocks[0].segments;
    const link = segs.find((seg) => seg.href);
    assert.ok(link, JSON.stringify(segs));
    assert.equal(link.href, 'https://example.org/page');
    assert.equal(link.text, 'the guidance');
    const before = segs.find((seg) => seg.text === 'See ');
    const afterSeg = segs.find((seg) => seg.text === ' for more.');
    assert.ok(before && afterSeg, JSON.stringify(segs));
  });

  test('a save carries the href through to the exported XML', () => {
    const model = parseRtf(doc(`{\\pard See ${field} for more.\\par}`));
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /href="https:\/\/example\.org\/page"/);
  });

  test('an internal \\l bookmark field (every real TOC entry in the corpus) becomes a fragment href, not lost', () => {
    // \l's own backslash is itself RTF-escaped (\\l) inside the field instruction string,
    // exactly as Word writes it — real bytes confirmed against inclusive-accessible-stadia-
    // report.rtf's own TOC entries.
    const bookmarkField = '{\\field{\\*\\fldinst {\\rtlch\\fcs1 \\ltrch\\fcs0  HYPERLINK \\\\l "_Toc1" }}{\\fldrslt {\\ul Section One}}}';
    const model = parseRtf(doc(`{\\pard ${bookmarkField}\\tab 3\\par}`));
    const segs = model.blocks[0].segments;
    const link = segs.find((seg) => seg.href);
    assert.ok(link, JSON.stringify(segs));
    assert.equal(link.href, '#_Toc1');
    assert.equal(link.text, 'Section One');
  });
});

// ---------------------------------------------------------------------------
describe('A44 stage 5: RTF — \\listtext paragraphs become a list block with markers', () => {
  const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;
  const item = (text) => `{\\listtext\\pard\\plain \\'b7\\tab}\\pard\\li720 ${text}\\par`;

  test('consecutive \\listtext paragraphs group into one list, each keeping its marker', () => {
    const model = parseRtf(doc(`${item('First item.')}${item('Second item.')}\\pard Not a list item.\\par`));
    const list = model.blocks.find((b) => b.type === 'list');
    assert.ok(list, JSON.stringify(model.blocks));
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].text, 'First item.');
    // Changed 30 Sep 2026 (import fix list #17, BANA Formats 8.6.2): the label is the Symbol-font bullet byte \'b7, which this input has no font table
    // to name; it used to stay as the middle dot U+00B7 (cp1252's reading of that byte). A label of one or two characters that are not letters or
    // digits is a bullet, and a bullet is the print bullet "•", as the Word reader gives for every unnamed bullet (wordBulletGlyph).
    assert.equal(list.items[0].marker, '•');
    assert.equal(list.items[1].text, 'Second item.');
    const after = model.blocks.find((b) => b.type === 'para' && b.text === 'Not a list item.');
    assert.ok(after, JSON.stringify(model.blocks));
  });

  test('a save (exportToNimasXml) still validates with the list present', () => {
    const model = parseRtf(doc(`${item('First item.')}${item('Second item.')}`));
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
  });
});

// ---------------------------------------------------------------------------
describe('A44 stage 6: RTF — a \\pict image and a simple \\trowd/\\cell/\\row table survive import', () => {
  const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;
  const PNG_HEX = '89504e470d0a1a0a00000001';
  const PNG_BYTES2 = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

  test('a PNG \\pict becomes a graphic block with its bytes in model.resources', () => {
    const model = parseRtf(doc(`{\\pard {\\pict\\pngblip\\picw100\\pich100 ${PNG_HEX}}\\par}`));
    const g = model.blocks.find((b) => b.type === 'graphic');
    assert.ok(g, JSON.stringify(model.blocks));
    assert.ok(model.resources?.length === 1, JSON.stringify(model.resources));
    assert.equal(model.resources[0].mime, 'image/png');
    assert.deepEqual([...model.resources[0].bytes], PNG_BYTES2);
    assert.equal(g.src, model.resources[0].path);
  });

  test('a minimal table becomes a table block with the first row as headers', () => {
    const model = parseRtf(doc('{\\trowd\\intbl Name\\cell Age\\cell\\row\\trowd\\intbl Ann\\cell 3\\cell\\row\\pard\\par}'));
    const t = model.blocks.find((b) => b.type === 'table');
    assert.ok(t, JSON.stringify(model.blocks));
    assert.deepEqual(t.headers, ['Name', 'Age']);
    assert.deepEqual(t.rows, [['Ann', '3']]);
  });
});

// ---------------------------------------------------------------------------
// A51 — DOCX content controls (<w:sdt>) were never opened on import: everything inside
// one (text, headings, images, tables) fell through parseDocx's body walk, which only
// recognised a fixed set of element names (oMathPara/oMath, tbl, p) and silently dropped
// anything else — the biggest single loss found in the 23 Sep re-measurement of
// template-framework-document-executive-agencies.docx (0 of 3 images, all table rows, and
// some underline runs lost, all sitting inside a content control). Fixed by unwrapping
// <w:sdt> — block-level (body child) and inline (paragraph-run-level, a distinct schema
// construct) — so its <w:sdtContent> children are processed exactly as if the wrapper
// weren't there, recursively, and a control with no/empty <w:sdtContent> throws nothing
// and contributes nothing. See flattenSdtChildren and paragraphSegments's walkNode in
// input/parse.mjs.
// ---------------------------------------------------------------------------
describe('A51: DOCX — a content control (w:sdt) is transparent to import', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sdtPr = '<w:sdtPr><w:alias w:val="Title placeholder"/><w:id w:val="12345"/></w:sdtPr>';
  const drawing = (docPrAttrs, rid) => `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1" cy="1"/><wp:docPr id="1" ${docPrAttrs}/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  const relsXml = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;

  test('a paragraph wrapped in a block-level w:sdt is recovered', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:sdt>${sdtPr}<w:sdtContent><w:p><w:r><w:t>Wrapped paragraph.</w:t></w:r></w:p></w:sdtContent></w:sdt>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'para', text: 'Wrapped paragraph.' }], JSON.stringify(blocks));
  });

  test('a picture inside a content control is recovered (same graphic-block shape as A45)', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>
<w:sdt>${sdtPr}<w:sdtContent>
<w:p><w:r>${drawing('name="Picture 1" descr="Cover image"', 'rId5')}</w:r></w:p>
</w:sdtContent></w:sdt>
</w:body></w:document>`;
    const buf = await zipBuf([
      { name: 'word/document.xml', text: docXml },
      { name: 'word/_rels/document.xml.rels', text: relsXml },
      { name: 'word/media/image1.png', data: PNG_BYTES },
    ]);
    const model = await parseDocx(buf);
    assert.equal(model.blocks[0].type, 'graphic', JSON.stringify(model.blocks));
    assert.equal(model.blocks[0].alt, 'Cover image');
    assert.equal(model.blocks[0].src, 'media/image1.png');
    assert.ok(Array.isArray(model.resources) && model.resources.length === 1, JSON.stringify(model.resources));
  });

  test('a table inside a content control is recovered', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:sdt>${sdtPr}<w:sdtContent>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Age</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Ann</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:sdtContent></w:sdt>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const { blocks } = await parseDocx(buf);
    const t = blocks.find((b) => b.type === 'table');
    assert.ok(t, JSON.stringify(blocks));
    assert.deepEqual(t.headers, ['Name', 'Age']);
    assert.deepEqual(t.rows, [['Ann', '3']]);
  });

  test('a nested content control (one inside another) is recovered', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:sdt>${sdtPr}<w:sdtContent>
<w:sdt>${sdtPr}<w:sdtContent><w:p><w:r><w:t>Nested content.</w:t></w:r></w:p></w:sdtContent></w:sdt>
</w:sdtContent></w:sdt>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'para', text: 'Nested content.' }], JSON.stringify(blocks));
  });

  test('an empty/placeholder content control produces nothing and does not throw', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><w:t>Before.</w:t></w:r></w:p>
<w:sdt>${sdtPr}<w:sdtContent/></w:sdt>
<w:sdt>${sdtPr}</w:sdt>
<w:p><w:r><w:t>After.</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    // parseDocx must not throw on an sdtContent-less or empty sdt — if it did, this
    // await would reject and fail the test before the assertion below ever ran.
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'para', text: 'Before.' }, { type: 'para', text: 'After.' }], JSON.stringify(blocks));
  });

  test('a heading inside a content control is still recognised as a heading (A48)', async () => {
    const stylesXml = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>`;
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:sdt>${sdtPr}<w:sdtContent><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Section One</w:t></w:r></w:p></w:sdtContent></w:sdt>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'heading', level: 1, text: 'Section One' }], JSON.stringify(blocks));
  });

  test('an inline (run-level) w:sdt inside a paragraph keeps its emphasis segment, alongside plain text', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><w:t xml:space="preserve">Plain </w:t></w:r><w:sdt>${sdtPr}<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>bold placeholder</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> tail.</w:t></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const { blocks } = await parseDocx(buf);
    const segs = blocks[0].segments;
    assert.ok(segs, JSON.stringify(blocks));
    assert.ok(segs.some((s) => s.text === 'Plain '));
    assert.ok(segs.some((s) => s.text === 'bold placeholder' && s.tf === TF_BOLD), JSON.stringify(segs));
    assert.ok(segs.some((s) => s.text === ' tail.'));
  });

  test('a save (exportToNimasXml) carries content-control content out, well-formed', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:sdt>${sdtPr}<w:sdtContent><w:p><w:r><w:t>Wrapped paragraph.</w:t></w:r></w:p></w:sdtContent></w:sdt>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const model = await parseDocx(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /Wrapped paragraph\./);
  });
});

// ---------------------------------------------------------------------------
// A52 — ODT list items: route through the same inline handling paragraphs use
// ---------------------------------------------------------------------------
describe('A52: ODT — a list item keeps its bold/italic/underline and link, not just plain text', () => {
  const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const contentXml = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="${T}" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:automatic-styles>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
</office:automatic-styles>
<office:body><office:text>
<text:list>
<text:list-item><text:p>Plain <text:span text:style-name="T1">bold</text:span> and <text:a xlink:href="https://x.org">a link</text:a>.</text:p></text:list-item>
<text:list-item><text:p>Second item, no formatting.</text:p></text:list-item>
</text:list>
</office:text></office:body></office:document-content>`;

  test('parseOdt keeps bold and link segments on the list item, not just its flattened text', async () => {
    const buf = await zipBuf([{ name: 'content.xml', text: contentXml }]);
    const { blocks } = await parseOdt(buf);
    assert.equal(blocks.length, 1, JSON.stringify(blocks));
    const list = blocks[0];
    assert.equal(list.type, 'list');
    assert.equal(list.items.length, 2, JSON.stringify(list.items));
    const [first, second] = list.items;
    assert.equal(first.text, 'Plain bold and a link.');
    assert.ok(Array.isArray(first.segments), JSON.stringify(first));
    assert.ok(first.segments.some((s) => s.text === 'bold' && s.tf === TF_BOLD), JSON.stringify(first.segments));
    assert.ok(first.segments.some((s) => s.text === 'a link' && s.href === 'https://x.org'), JSON.stringify(first.segments));
    // An item with no formatting at all stays a plain {text} item (no segments invented).
    assert.equal(second.segments, undefined, JSON.stringify(second));
  });

  test('a save carries the list item\'s bold and link out (exportToNimasXml)', async () => {
    const buf = await zipBuf([{ name: 'content.xml', text: contentXml }]);
    const model = await parseOdt(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<strong>bold<\/strong>/);
    assert.match(xml, /<a href="https:\/\/x\.org">a link<\/a>/);
  });
});

// ---------------------------------------------------------------------------
// A53 — Markdown: a real GFM table block, and inline/reference-style links
// ---------------------------------------------------------------------------
describe('A53: Markdown — a GFM table becomes a real table block, not flattened paragraphs', () => {
  const md = '# T\n\n| Name | Age |\n|------|-----|\n| Ada | 36 |\n| Grace | 85 |\n\nAfter the table.\n';

  test('parseMarkdown builds a {type:"table"} block with headers and rows', () => {
    const { blocks } = parseMarkdown(md);
    const table = blocks.find((b) => b.type === 'table');
    assert.ok(table, JSON.stringify(blocks));
    assert.deepEqual(table.headers, ['Name', 'Age']);
    assert.deepEqual(table.rows, [['Ada', '36'], ['Grace', '85']]);
    // The table ends at the blank line — "After the table." is its own paragraph, not a row.
    const after = blocks.find((b) => b.text === 'After the table.');
    assert.ok(after, JSON.stringify(blocks));
  });

  test('a save carries the table out as a real <table> (exportToNimasXml)', () => {
    const model = parseMarkdown(md);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<table>/);
    assert.match(xml, /Ada/);
    assert.match(xml, /Grace/);
  });

  test('a pipe-delimited line with NO separator row is not mistaken for a table (pre-A53 fallback kept)', () => {
    const { blocks } = parseMarkdown('| not | a | table |\n\njust prose after it\n');
    assert.equal(blocks[0].type, 'para');
    assert.equal(blocks[0].text, 'not | a | table');
  });
});

describe('A53: Markdown — inline and reference-style links carry their href, not just visible text', () => {
  test('an inline [text](url) link produces an href-bearing segment', () => {
    const { blocks } = parseMarkdown('see *this* [link](http://x.com) now');
    const segs = blocks[0].segments;
    assert.ok(segs.some((s) => s.text === 'link' && s.href === 'http://x.com'), JSON.stringify(segs));
    assert.ok(segs.some((s) => s.text === 'this' && s.tf === TF_ITALIC));
  });

  test('a reference-style [text][ref] link resolves against its [ref]: url definition', () => {
    const md = 'see the [documentation][docs] for more.\n\n[docs]: https://example.org/docs\n';
    const { blocks } = parseMarkdown(md);
    const segs = blocks[0].segments;
    assert.ok(segs.some((s) => s.text === 'documentation' && s.href === 'https://example.org/docs'), JSON.stringify(segs));
    // The definition line itself is consumed, not left behind as a stray paragraph.
    assert.ok(!blocks.some((b) => (b.text || '').includes('example.org')), JSON.stringify(blocks));
  });

  test('a shorthand [text][] reference link resolves by its own text', () => {
    const md = 'the [Gutenberg Project][] site.\n\n[gutenberg project]: https://gutenberg.org\n';
    const { blocks } = parseMarkdown(md);
    const segs = blocks[0].segments;
    assert.ok(segs.some((s) => s.text === 'Gutenberg Project' && s.href === 'https://gutenberg.org'), JSON.stringify(segs));
  });

  test('a save carries the link out (exportToNimasXml)', () => {
    const model = parseMarkdown('see *this* [link](http://x.com) now');
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<a href="http:\/\/x\.com">link<\/a>/);
  });
});

// ---------------------------------------------------------------------------
// A54 — HTML/EPUB cover images: a real graphic block, not an empty placeholder
// ---------------------------------------------------------------------------
describe('A54: HTML — an <img>/<figure> becomes a graphic block with src and alt, not an empty note', () => {
  test('an <img> inside a <p> becomes a graphic block', () => {
    const { blocks } = parseHtml('<p><img src="cover.jpg" alt="The book cover"></p>');
    assert.equal(blocks.length, 1, JSON.stringify(blocks));
    assert.equal(blocks[0].type, 'graphic');
    assert.equal(blocks[0].src, 'cover.jpg');
    assert.equal(blocks[0].alt, 'The book cover');
  });

  test('a standalone <img> becomes a graphic block', () => {
    const { blocks } = parseHtml('<img src="illustration.png" alt="An illustration">');
    assert.equal(blocks[0].type, 'graphic');
    assert.equal(blocks[0].src, 'illustration.png');
    assert.equal(blocks[0].alt, 'An illustration');
  });

  test('a <figure><img><figcaption> becomes a graphic block with its caption', () => {
    const { blocks } = parseHtml('<figure><img src="fig1.jpg" alt="Figure one"><figcaption>The first figure</figcaption></figure>');
    assert.equal(blocks[0].type, 'graphic');
    assert.equal(blocks[0].src, 'fig1.jpg');
    assert.equal(blocks[0].alt, 'Figure one');
    assert.equal(blocks[0].caption, 'The first figure');
  });

  test('a save keeps it as a real <img>, not an empty <prodnote>', () => {
    const model = parseHtml('<p><img src="cover.jpg" alt="The book cover"></p>');
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<img[^>]*alt="The book cover"/);
    assert.ok(!/<prodnote[^>]*>Image: /.test(xml), xml);
  });
});

describe('A54: EPUB — a cover image survives with its bytes embedded from the package', () => {
  test('an image referenced from a nested chapter resolves to a package-relative path and carries its bytes', async () => {
    const epub = await zipBuf([
      { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OEBPS/content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Book</dc:title></metadata><manifest><item id="c1" href="text/cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
      { name: 'OEBPS/text/cover.xhtml', text: '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../images/cover.jpg" alt="Front cover"/></body></html>' },
      { name: 'OEBPS/images/cover.jpg', data: PNG_BYTES },
    ]);
    const model = await parseEpub(epub);
    const g = model.blocks.find((b) => b.type === 'graphic');
    assert.ok(g, JSON.stringify(model.blocks));
    assert.equal(g.alt, 'Front cover');
    assert.equal(g.src, 'OEBPS/images/cover.jpg');
    assert.ok(Array.isArray(model.resources) && model.resources.length === 1, JSON.stringify(model.resources));
    assert.equal(model.resources[0].path, 'OEBPS/images/cover.jpg');
    assert.deepEqual([...model.resources[0].bytes], [...PNG_BYTES]);
  });

  test('a save keeps the cover as a real <img>', async () => {
    const epub = await zipBuf([
      { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OEBPS/content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Book</dc:title></metadata><manifest><item id="c1" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
      { name: 'OEBPS/cover.xhtml', text: '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="cover.jpg" alt="Front cover"/></body></html>' },
      { name: 'OEBPS/cover.jpg', data: PNG_BYTES },
    ]);
    const model = await parseEpub(epub);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /<img[^>]*alt="Front cover"/);
  });
});

// ---------------------------------------------------------------------------
// A55 — DOCX floating text boxes (w:txbxContent) are walked as body content
// ---------------------------------------------------------------------------
describe('A55: DOCX — a floating text box\'s own content is walked in place', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  test('a DrawingML text box (wps:txbx) on an otherwise-empty anchor paragraph produces a real block', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent><w:p><w:pPr><w:pStyle w:val="TitleGrey"/></w:pPr><w:r><w:t>Boxed Title</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>
<w:p><w:r><w:t>Ordinary body paragraph.</w:t></w:r></w:p>
</w:body></w:document>`;
    const stylesXml = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="TitleGrey"><w:name w:val="TitleGrey"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [
      { type: 'heading', level: 1, text: 'Boxed Title' },
      { type: 'para', text: 'Ordinary body paragraph.' },
    ], JSON.stringify(blocks));
  });

  test('the same box stored twice (DrawingML mc:Choice + legacy VML mc:Fallback) is kept once, not duplicated', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
<mc:Choice Requires="wps" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:drawing><wp:anchor><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></wps:txbx></wp:anchor></w:drawing>
</mc:Choice>
<mc:Fallback>
<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict>
</mc:Fallback>
</mc:AlternateContent></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'para', text: 'Box text' }], JSON.stringify(blocks));
  });

  test('a legacy-only VML text box (no AlternateContent at all) is still walked', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent><w:p><w:r><w:t>Legacy box text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'para', text: 'Legacy box text' }], JSON.stringify(blocks));
  });

  test('a save carries the text box content out, well-formed', async () => {
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wps:txbx xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:txbxContent><w:p><w:r><w:t>Boxed paragraph.</w:t></w:r></w:p></w:txbxContent></wps:txbx></wp:anchor></w:drawing></w:r></w:p>
</w:body></w:document>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
    const model = await parseDocx(buf);
    const xml = exportToNimasXml(model);
    assertWellFormed(xml);
    assert.match(xml, /Boxed paragraph\./);
  });

  // Found re-measuring the real corpus file after the fix above: a text box's own
  // paragraph is very often ALSO wrapped in its own <w:sdt> content control
  // (txbxContent > sdt > sdtContent > p, not a direct txbxContent > p — confirmed by
  // walking template-framework-document-executive-agencies.docx's real ancestor chain for
  // its TitleGrey/HMTtitlep2 running-head text, which docxTxbxParagraphs missed entirely
  // until this was fixed). docxTxbxParagraphs must unwrap that with flattenSdtChildren,
  // the same helper A51 already uses at body level, not just look for a direct <w:p> child.
  test('a text box paragraph wrapped in its own content control (real-corpus shape) is still recovered', async () => {
    const sdtPr2 = '<w:sdtPr><w:alias w:val="Title"/><w:id w:val="99"/></w:sdtPr>';
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
<w:p><w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wps:txbx xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:txbxContent><w:sdt>${sdtPr2}<w:sdtContent><w:p><w:pPr><w:pStyle w:val="TitleGrey"/></w:pPr><w:r><w:t>Specimen framework document:</w:t></w:r></w:p></w:sdtContent></w:sdt></w:txbxContent></wps:txbx></wp:anchor></w:drawing></w:r></w:p>
</w:body></w:document>`;
    const stylesXml = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="TitleGrey"><w:name w:val="TitleGrey"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>`;
    const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml }]);
    const { blocks } = await parseDocx(buf);
    assert.deepEqual(blocks, [{ type: 'heading', level: 1, text: 'Specimen framework document:' }], JSON.stringify(blocks));
  });
});
