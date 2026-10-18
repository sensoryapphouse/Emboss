// LINK-2 (Paul, 28 Sep 2026, from KD's round-2 answer Q1, docs/decisions.md): KD marks a link
// with whatever typeform the print shows — blue text gets a transcriber-defined typeform
// (LINK-1, 25 Sep 2026), underlined text gets UEB's own underline indicator. Refines LINK-1:
// a link whose print is UNDERLINED (segment.tf carries TYPEFORM.underline = 2) is brailled with
// UEB's ordinary underline typeform indicator and nothing else — no transcriber-defined
// typeform (format/document.mjs's HYPERLINK_OPEN/CLOSE, BANA Sample 6-15), and no Special
// Symbols page entry for it. A link with NO underline keeps today's LINK-1 treatment
// (transcriber-defined typeform, listed on the Symbols page).
//
// format/document.mjs: groupSegments' new `linkUnderline` flag (set once, from the SOURCE
// segment's own tf, since a hyperlink segment always starts its own group) decides, in both
// segmentsToBraille and its cell-trace mirror tcJoined (shared by paragraphs AND table cells —
// see formatTable's own segsBraille, which calls segmentsToBraille when a cell is "rich"), and
// collectSpecialSymbols skips the hyperlink Special-Symbols entry for an underlined link.
//
// input/parse.mjs: the docx reader (runEmphasis/charStyleLinkUnderline) reads the underline
// straight off a run's Hyperlink/FollowedHyperlink character style (real corpus: Word's own
// built-in "Hyperlink" style carries <w:u w:val="single"/>, Emboss/tests/real_samples/docx/*) —
// charStyleEmphasis deliberately skips that SAME style for ordinary emphasis, since its
// formatting normally just means "this is a link", not print emphasis; underline is the one
// exception LINK-2 asks for. The HTML/EPUB reader (htmlParagraphSegments) already combined an
// <a href> with a nested/wrapping <u> via ordinary tf-bit nesting (A46) with no change needed;
// only the CSS-only spelling (`style="text-decoration:underline"`, no <u> tag) was missing
// (HAS_UNDERLINE_STYLE_RE, mirroring the existing line-through style regex) — added so a book
// stylesheet that keeps an <a>'s underline via CSS is read the same as a literal <u>. A bare
// <a href> stays unaffected (no underline signal at all).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseHtml, parseDocx } from '../input/parse.mjs';
import { formatDocument, collectSpecialSymbols } from '../format/document.mjs';
import { writeDocx } from './helpers/doc-writer.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));

const translateG2 = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const OPTS_G2 = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: translateG2, translateG1, suppressHeader: true };

const UL = louis.TYPEFORM.underline;
assert.equal(UL, 2, 'engine/louis.mjs TYPEFORM.underline bit (task requirement: "the ordinary tf underline bit, TYPEFORM underline = 2")');

// Confirmed independently against the compiled table (same style as strikethrough.test.mjs's
// own CONFIRM_TF2 checks) — the ordinary UEB underline word/passage forms, NOT the
// transcriber-defined hyperlink slot's own @#… forms.
assert.equal(louis.translate('word', louis.TABLES.uebG2, Array(4).fill(UL)), '_1^W', 'underline WORD form');
{
  const passage = louis.translate('a b c', louis.TABLES.uebG2, Array(5).fill(UL));
  assert.ok(passage.startsWith('_7'), `underline PASSAGE opening indicator: ${passage}`);
  assert.ok(passage.endsWith("_'"), `underline PASSAGE terminator: ${passage}`);
}
const UL_WORD = '_1', UL_PASSAGE = '_7', UL_END = "_'";
const HYPERLINK_WORD = '@#1', HYPERLINK_PASSAGE = '@#7', HYPERLINK_END = "@#'";

function firstParaLine(model, opts = OPTS_G2) {
  return formatDocument({ blocks: model.blocks, title: model.title }, opts).split(/\r?\n/).map((l) => l.trimEnd()).find((l) => l.trim());
}

// ---------------------------------------------------------------------------------------------
describe('formatter: an underlined link braille\'s with UEB\'s own underline indicator only', () => {
  test('a single-word underlined link gets the underline WORD indicator, not the hyperlink wrap', () => {
    const doc = { blocks: [{ type: 'para', segments: [
      { type: 'text', text: 'See ' },
      { type: 'text', text: 'here', href: 'https://example.com', hyperlink: true, tf: UL },
      { type: 'text', text: ' now.' },
    ] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(UL_WORD), `expected the underline word indicator ${UL_WORD} in: ${line}`);
    assert.ok(!line.includes(HYPERLINK_WORD) && !line.includes(HYPERLINK_PASSAGE), `must NOT use the transcriber-defined hyperlink indicator @#… in: ${line}`);
  });

  test('a multi-word underlined link gets the underline PASSAGE indicator and terminator, not the hyperlink wrap', () => {
    const doc = { blocks: [{ type: 'para', segments: [
      { type: 'text', text: 'See ' },
      { type: 'text', text: 'our full site here', href: 'https://example.com', hyperlink: true, tf: UL },
      { type: 'text', text: ' now.' },
    ] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(UL_PASSAGE), `expected the underline passage indicator ${UL_PASSAGE} in: ${line}`);
    assert.ok(line.includes(UL_END), `expected the underline terminator ${UL_END} in: ${line}`);
    assert.ok(!line.includes(HYPERLINK_WORD) && !line.includes(HYPERLINK_PASSAGE), `must NOT use the transcriber-defined hyperlink indicator @#… in: ${line}`);
  });

  test('collectSpecialSymbols lists NO link typeform entry for an underlined-only link', () => {
    const blocks = [{ type: 'para', segments: [{ type: 'text', text: 'before ' }, { type: 'text', text: 'linked', href: 'https://example.com', hyperlink: true, tf: UL }, { type: 'text', text: ' after' }] }];
    const found = collectSpecialSymbols(blocks, OPTS_G2);
    assert.ok(!found.some((s) => s.kind === 'typeform'), `expected no typeform entry: ${JSON.stringify(found)}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('formatter: a non-underlined link is unchanged (LINK-1)', () => {
  test('a link with no underline still gets the first transcriber-defined typeform (@#… forms)', () => {
    const doc = { blocks: [{ type: 'para', segments: [
      { type: 'text', text: 'See ' },
      { type: 'text', text: 'our full site here', href: 'https://example.com', hyperlink: true },
      { type: 'text', text: ' now.' },
    ] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(HYPERLINK_PASSAGE) || line.includes(HYPERLINK_WORD), `expected the transcriber-defined hyperlink indicator @#… in: ${line}`);
    assert.ok(line.includes(HYPERLINK_END) || line.includes(HYPERLINK_WORD), `expected the closing/word form too in: ${line}`);
  });

  test('collectSpecialSymbols still lists the hyperlink typeform entry for a non-underlined link', () => {
    const blocks = [{ type: 'para', segments: [{ type: 'text', text: 'before ' }, { type: 'text', text: 'linked', href: 'https://example.com', hyperlink: true }, { type: 'text', text: ' after' }] }];
    const found = collectSpecialSymbols(blocks, OPTS_G2);
    const hit = found.find((s) => s.kind === 'typeform');
    assert.ok(hit, `expected a typeform entry: ${JSON.stringify(found)}`);
    assert.equal(hit.braille, HYPERLINK_WORD);
    assert.match(hit.description, /hyperlink/i);
  });

  test('a link in a table cell keeps LINK-1\'s indicator when not underlined, and switches to UEB underline when it is', () => {
    // A second, plain row (no tf at all) alongside the link row keeps the emphasis NOT
    // shared by every cell in the table — otherwise document.mjs's K1 decorative-emphasis
    // rule (decorativeEmphasisOf: a typeform shared by every single cell of a table is
    // stripped as decorative table-wide styling, BANA K1) would strip a lone link cell's
    // own underline bit as "the whole table is decoratively underlined", which is not what
    // this test means to exercise.
    const row2 = [{ text: 'other row', segments: [{ type: 'text', text: 'other row' }] }];
    const plainLinkDoc = { blocks: [{ type: 'table', headers: [{ text: 'Col' }], rows: [[{ text: 'entry', segments: [{ type: 'text', text: 'entry', href: 'https://example.com', hyperlink: true }] }], row2] }] };
    const underlinedLinkDoc = { blocks: [{ type: 'table', headers: [{ text: 'Col' }], rows: [[{ text: 'entry', segments: [{ type: 'text', text: 'entry', href: 'https://example.com', hyperlink: true, tf: UL }] }], row2] }] };
    const plainOut = formatDocument(plainLinkDoc, OPTS_G2);
    const underlinedOut = formatDocument(underlinedLinkDoc, OPTS_G2);
    assert.ok(plainOut.includes(HYPERLINK_WORD) || plainOut.includes(HYPERLINK_PASSAGE), `table cell link expected @#… in: ${plainOut}`);
    assert.ok(underlinedOut.includes(UL_WORD) || underlinedOut.includes(UL_PASSAGE), `table cell underlined link expected _1/_7 in: ${underlinedOut}`);
    assert.ok(!underlinedOut.includes(HYPERLINK_WORD) && !underlinedOut.includes(HYPERLINK_PASSAGE), `table cell underlined link must not use @#…: ${underlinedOut}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('DOCX importer: a Hyperlink-style run imports as an underlined link', () => {
  test('writeDocx\'s own href run (wrapped in <w:hyperlink>, rStyle="Hyperlink") comes back with the underline tf bit set', async () => {
    const spec = { body: [{ p: ['See ', { text: 'our site', href: 'https://example.com' }, ' for more.'] }] };
    const ab = await writeDocx(spec);
    const model = await parseDocx(ab);
    const para = model.blocks.find((b) => Array.isArray(b.segments) && b.segments.some((s) => s.href));
    const link = para.segments.find((s) => s.href);
    assert.ok(link, JSON.stringify(para.segments));
    assert.equal(link.href, 'https://example.com');
    assert.ok((link.tf || 0) & UL, `expected the underline bit on the Hyperlink-style run: ${JSON.stringify(link)}`);
  });

  test('a direct w:u="none" override on the run (author removed the underline) is NOT read as underlined', async () => {
    const spec = { body: [{ p: ['See ', { text: 'our site', href: 'https://example.com', u: false }, ' for more.'] }] };
    const ab = await writeDocx(spec);
    const model = await parseDocx(ab);
    const para = model.blocks.find((b) => Array.isArray(b.segments) && b.segments.some((s) => s.href));
    const link = para.segments.find((s) => s.href);
    assert.ok(link, JSON.stringify(para.segments));
    assert.ok(!((link.tf || 0) & UL), `direct w:u="none" must win over the Hyperlink style's own underline: ${JSON.stringify(link)}`);
  });

  test('end to end: that underlined link brailles with UEB\'s underline indicator, not the hyperlink wrap', async () => {
    const spec = { body: [{ p: ['See ', { text: 'our full site here', href: 'https://example.com' }, ' now.'] }] };
    const ab = await writeDocx(spec);
    const model = await parseDocx(ab);
    const line = firstParaLine(model);
    assert.ok(line.includes(UL_PASSAGE) || line.includes(UL_WORD), `expected UEB underline in: ${line}`);
    assert.ok(!line.includes(HYPERLINK_PASSAGE) && !line.includes(HYPERLINK_WORD), `must not use the hyperlink wrap: ${line}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('HTML/EPUB importer: only an explicit underline counts', () => {
  const withLink = (inner) => `<html><body><p>Before ${inner} after.</p></body></html>`;
  const linkSeg = async (html) => {
    const model = parseHtml(html);
    const para = model.blocks.find((b) => Array.isArray(b.segments) && b.segments.some((s) => s.href));
    return para.segments.find((s) => s.href);
  };

  test('a bare <a href> is NOT underlined — stays a transcriber-defined-typeform link', async () => {
    const seg = await linkSeg(withLink('<a href="https://example.com">our site</a>'));
    assert.ok(seg, 'no link segment found');
    assert.ok(!((seg.tf || 0) & UL), `a bare <a> must carry no underline bit: ${JSON.stringify(seg)}`);
    const model = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'Before ' }, { ...seg, hyperlink: true, text: 'our full site here name' }, { type: 'text', text: ' after.' }] }] };
    const line = firstParaLine(model);
    assert.ok(line.includes(HYPERLINK_PASSAGE) || line.includes(HYPERLINK_WORD), `expected @#… in: ${line}`);
  });

  test('<u><a href>…</a></u> (tag wraps the link) becomes an underlined link', async () => {
    const seg = await linkSeg(withLink('<u><a href="https://example.com">our site</a></u>'));
    assert.ok(seg, 'no link segment found');
    assert.ok((seg.tf || 0) & UL, `expected the underline bit: ${JSON.stringify(seg)}`);
  });

  test('<a href>…<u>text</u></a> (tag inside the link) becomes an underlined link', async () => {
    const seg = await linkSeg(withLink('<a href="https://example.com"><u>our site</u></a>'));
    assert.ok(seg, 'no link segment found');
    assert.ok((seg.tf || 0) & UL, `expected the underline bit: ${JSON.stringify(seg)}`);
  });

  test('style="text-decoration: underline" directly on the <a> becomes an underlined link', async () => {
    const seg = await linkSeg(withLink('<a href="https://example.com" style="text-decoration: underline">our site</a>'));
    assert.ok(seg, 'no link segment found');
    assert.ok((seg.tf || 0) & UL, `expected the underline bit: ${JSON.stringify(seg)}`);
  });

  test('style="text-decoration: underline" on an ANCESTOR of the <a> becomes an underlined link', async () => {
    const seg = await linkSeg(withLink('<span style="text-decoration:underline"><a href="https://example.com">our site</a></span>'));
    assert.ok(seg, 'no link segment found');
    assert.ok((seg.tf || 0) & UL, `expected the underline bit: ${JSON.stringify(seg)}`);
  });

  test('style="text-decoration: none" is NOT read as underlined', async () => {
    const seg = await linkSeg(withLink('<a href="https://example.com" style="text-decoration: none">our site</a>'));
    assert.ok(seg, 'no link segment found');
    assert.ok(!((seg.tf || 0) & UL), `text-decoration:none must not set the underline bit: ${JSON.stringify(seg)}`);
  });

  test('end to end: an <u><a> link brailles with UEB\'s underline indicator, not the hyperlink wrap', async () => {
    const model = parseHtml(withLink('<u><a href="https://example.com">our full site here</a></u>'));
    const line = firstParaLine(model);
    assert.ok(line.includes(UL_PASSAGE) || line.includes(UL_WORD), `expected UEB underline in: ${line}`);
    assert.ok(!line.includes(HYPERLINK_PASSAGE) && !line.includes(HYPERLINK_WORD), `must not use the hyperlink wrap: ${line}`);
  });
});
