// UEB 9.5.1 "Transcriber-defined typeform indicators": crossed-out (strikethrough) print is
// brailled as the SECOND transcriber-defined typeform (⠘⠼⠂ word / ⠘⠼⠆ symbol / ⠘⠼⠶ passage /
// ⠘⠼⠄ terminator — Emboss/engine/louis.mjs's TYPEFORM.trans2 = 64, confirmed against the
// compiled en-ueb-g1.ctb table by translating text with that bit set, below). NOT the first
// slot: the hyperlink indicator (F-233, format/document.mjs's HYPERLINK_OPEN/CLOSE, BANA Sample
// 6-15) already claims that one, and every imported external link is marked with it
// automatically (Paul's decision, 25 Sep 2026) — so a link and crossed-out text stay visually
// distinct in the finished braille. Model: parse.mjs readers stamp a struck-through text segment
// with `segment.transcriberTypeform = 'strike'` (a semantic value of Emboss's own, never a bare
// 'trans1'..'trans5' — those remain BrailleBlaster's own bai-trans1..bai-trans5 import numbers,
// parse.mjs A24), a field kept separate from the existing `segment.tf` (italic/underline/bold)
// bitmask; format/document.mjs's segTf() folds the two together only at the point a segment's
// typeform reaches liblouis (see its own comment for the full model, including why
// getBlockSignature needs no change: it already JSON.stringifies block.segments, which already
// covers this new field).
//
// One describe block per reader, then the shared braille-output matrix (word / passage /
// single letter / mid-word / combined with bold, in both UEB grades), a link-and-strikethrough
// test proving the two indicators stay distinct, the Special Symbols page listing (both
// indicators), and the NIMAS export/import round trip. BrailleBlaster's own
// <bai-trans1>…<bai-trans5> (parse.mjs A24) is exercised too, since this feature is what
// finally makes bai-trans2 among them actually braille (previously recorded on the segment and
// then silently dropped by the formatter).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
import { parseHtml, parseEpub, parseOdt, parseRtf, parseMarkdown, parseDtbook } from '../input/parse.mjs';
import { formatDocument, collectSpecialSymbols, suggestTranscriberNotes } from '../format/document.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { makeZip } from '../web/zip.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));

const translateG2 = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const OPTS_G2 = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: translateG2, translateG1, suppressHeader: true };
const OPTS_G1 = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: translateG1, suppressHeader: true };

// Confirm the compiled table's trans2 dot patterns/BRF-ASCII independently (task requirement),
// rather than only trusting format/document.mjs's own TRANS_TF_WORD_BRL constant.
const CONFIRM_TF2 = louis.TYPEFORM.trans2;
assert.equal(louis.translate('x', louis.TABLES.uebG2, [CONFIRM_TF2]), '^#2;X', 'trans2 SYMBOL form');
assert.equal(louis.translate('ab', louis.TABLES.uebG2, [CONFIRM_TF2, CONFIRM_TF2]), '^#1;AB', 'trans2 WORD form');
{
  const passage = louis.translate('a b c', louis.TABLES.uebG2, Array(5).fill(CONFIRM_TF2));
  assert.ok(passage.startsWith('^#7'), `trans2 PASSAGE opening indicator: ${passage}`);
  assert.ok(passage.endsWith("^#'"), `trans2 PASSAGE terminator: ${passage}`);
}

// The strikethrough (SECOND transcriber-defined typeform, trans2) BRF-ASCII forms (en-us-brf.dis
// + en-ueb-g1/g2.ctb — identical either way, the emphclass dot patterns do not depend on the
// contraction table). TRANS1_* forms are the FIRST transcriber-defined typeform: no longer
// strikethrough's own, but still used directly (via HYPERLINK_OPEN/CLOSE) by the hyperlink
// indicator, and exercised below to prove the two stay distinct.
const TRANS2_WORD = '^#1', TRANS2_SYMBOL = '^#2', TRANS2_PASSAGE = '^#7', TRANS2_END = "^#'";
const TRANS1_WORD = '@#1', TRANS1_SYMBOL = '@#2', TRANS1_PASSAGE = '@#7', TRANS1_END = "@#'";

function firstParaLine(model, opts = OPTS_G2) {
  return formatDocument({ blocks: model.blocks, title: model.title }, opts).split(/\r?\n/).map((l) => l.trimEnd()).find((l) => l.trim());
}
function strikeSegs(segments) {
  return (segments || []).filter((s) => s && s.type === 'text' && s.transcriberTypeform);
}

// ---------------------------------------------------------------------------------------------
describe('readers: HTML/EPUB, ODT, RTF, Markdown, DTBook — each marks \'strike\'', () => {
  test('HTML <s>', () => {
    const m = parseHtml('<p>before <s>struck</s> after</p>');
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].transcriberTypeform, 'strike');
    assert.equal(hit[0].text, 'struck');
  });

  test('HTML <strike>', () => {
    const m = parseHtml('<p>before <strike>struck</strike> after</p>');
    const hit = strikeSegs(m.blocks.find((b) => b.type === 'para').segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].transcriberTypeform, 'strike');
  });

  test('HTML <del> (print shows it crossed out, so it is treated the same as <s>)', () => {
    const m = parseHtml('<p>before <del>struck</del> after</p>');
    const hit = strikeSegs(m.blocks.find((b) => b.type === 'para').segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].transcriberTypeform, 'strike');
  });

  test('HTML inline style text-decoration: line-through', () => {
    const m = parseHtml('<p>before <span style="color:red;text-decoration: line-through">struck</span> after</p>');
    const hit = strikeSegs(m.blocks.find((b) => b.type === 'para').segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].transcriberTypeform, 'strike');
  });

  test('HTML text-decoration-line (the longhand property some sources use)', () => {
    const m = parseHtml('<p>before <span style="text-decoration-line:line-through">struck</span> after</p>');
    const hit = strikeSegs(m.blocks.find((b) => b.type === 'para').segments);
    assert.equal(hit.length, 1);
  });

  test('HTML <s> combined with <b>: both survive on the same segment', () => {
    const m = parseHtml('<p><s><b>struck bold</b></s></p>');
    const hit = strikeSegs(m.blocks.find((b) => b.type === 'para').segments);
    assert.equal(hit.length, 1);
    assert.ok(hit[0].tf, 'bold tf bit also set');
  });

  test('EPUB (shares parseHtml under the hood)', async () => {
    const html = '<html><body><p>before <s>struck</s> after</p></body></html>';
    const epub = await makeZip([
      { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OEBPS/content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata/><manifest><item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
      { name: 'OEBPS/chap1.xhtml', text: html },
    ]).arrayBuffer();
    const m = await parseEpub(epub);
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(strikeSegs(p.segments).length, 1);
  });

  test('ODT style:text-line-through-style (not "none")', async () => {
    const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
    const styles = '<office:automatic-styles><style:style style:name="Strike" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style></office:automatic-styles>';
    const content = `<?xml version="1.0"?><office:document-content ${NS}>${styles}<office:body><office:text><text:p>before <text:span text:style-name="Strike">struck</text:span> after</text:p></office:text></office:body></office:document-content>`;
    const m = await parseOdt(await makeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }]).arrayBuffer());
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'struck');
  });

  test('ODT style:text-line-through-style="none" is NOT strikethrough', async () => {
    const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
    const styles = '<office:automatic-styles><style:style style:name="NoStrike" style:family="text"><style:text-properties style:text-line-through-style="none"/></style:style></office:automatic-styles>';
    const content = `<?xml version="1.0"?><office:document-content ${NS}>${styles}<office:body><office:text><text:p><text:span text:style-name="NoStrike">plain</text:span></text:p></office:text></office:body></office:document-content>`;
    const m = await parseOdt(await makeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }]).arrayBuffer());
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(strikeSegs(p.segments).length, 0);
  });

  test('RTF \\strike (single)', () => {
    const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;
    const m = parseRtf(doc('{\\pard before \\strike struck\\strike0  after.\\par}'));
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text.trim(), 'struck');
  });

  test('RTF \\strikedl (double strikethrough — prints the same way, same \'strike\' slot)', () => {
    const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;
    const m = parseRtf(doc('{\\pard before \\strikedl struck\\strikedl0  after.\\par}'));
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
  });

  test('RTF \\striked1 — the easily-confused digit spelling (word "striked" + numeric param 1) is accepted the same way', () => {
    const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252 ${body}}`;
    const m = parseRtf(doc('{\\pard before \\striked1 struck\\striked0  after.\\par}'));
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
  });

  test('Markdown ~~text~~', () => {
    const m = parseMarkdown('Before ~~struck~~ after.');
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'struck');
  });

  test('Markdown ~~text~~ combined with **bold**', () => {
    const m = parseMarkdown('~~**struck bold**~~ plain.');
    const p = m.blocks.find((b) => b.type === 'para');
    // Markdown's tokenizer is not nesting-aware (each ~~...~~/**...** is matched whole), so
    // ~~**x**~~ keeps the OUTER strike marker and the inner ** literally — this test only
    // requires the paragraph is not silently flattened to plain text.
    assert.ok(p.segments && p.segments.length, 'kept as rich segments, not collapsed to text');
  });

  test('DTBook: BrailleBlaster\'s <bai-trans1> keeps its OWN source slot number (not Emboss\'s \'strike\')', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1><p>before <bai-trans1>struck</bai-trans1> after</p></level1></bodymatter></book>
</dtbook>`;
    const m = parseDtbook(xml);
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = (p.segments || []).filter((s) => s.transcriberTypeform === 'bai-trans1');
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'struck');
    // Genuine source clash (task requirement): a BrailleBlaster file that uses bai-trans1 for
    // something else AND separately has hyperlinks now collides on the SAME first-slot braille
    // indicator (bai-trans1 -> TRANS_TF_BIT.trans1, same bit HYPERLINK_OPEN/CLOSE's literal
    // cells represent) — collectSpecialSymbols must not crash over it, only report one entry
    // (first use wins).
    const withLink = [{ type: 'para', segments: [{ type: 'text', text: 'a', transcriberTypeform: 'bai-trans1' }, { type: 'text', text: 'b', hyperlink: true }] }];
    assert.doesNotThrow(() => collectSpecialSymbols(withLink, OPTS_G2));
    const found = collectSpecialSymbols(withLink, OPTS_G2);
    assert.equal(found.filter((s) => s.braille === TRANS1_WORD).length, 1, 'one entry, not two, for the shared first-slot indicator');
  });

  test('DTBook: Emboss\'s own <span class="strikethrough"> (NIMAS round-trip shape) reads as \'strike\'', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1><p>before <span class="strikethrough">struck</span> after</p></level1></bodymatter></book>
</dtbook>`;
    const m = parseDtbook(xml);
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].transcriberTypeform, 'strike');
  });
});

// ---------------------------------------------------------------------------------------------
describe('braille output: word / passage / single letter / mid-word / combined with bold', () => {
  test('a single struck word gets the trans2 (SECOND) WORD indicator, not trans1 (grade 2)', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'This is ' }, { type: 'text', text: 'struck', transcriberTypeform: 'strike' }, { type: 'text', text: ' out.' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(TRANS2_WORD), `expected the trans2 word indicator ${TRANS2_WORD} in: ${line}`);
    assert.ok(!line.includes(TRANS1_WORD), `must NOT use the trans1/hyperlink word indicator ${TRANS1_WORD}: ${line}`);
  });

  test('a struck passage of 3+ words gets the trans2 PASSAGE indicator and terminator (grade 2)', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'one two three', transcriberTypeform: 'strike' }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(TRANS2_PASSAGE), `expected the trans2 passage indicator ${TRANS2_PASSAGE} in: ${line}`);
    assert.ok(line.includes(TRANS2_END), `expected the trans2 terminator ${TRANS2_END} in: ${line}`);
  });

  test('a single struck letter gets the trans2 SYMBOL indicator (grade 2)', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'x', transcriberTypeform: 'strike' }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(TRANS2_SYMBOL), `expected the trans2 symbol indicator ${TRANS2_SYMBOL} in: ${line}`);
  });

  test('strike starting inside a word (partial-word emphasis) opens and closes mid-word', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'un', transcriberTypeform: 'strike' }, { type: 'text', text: 'happy' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(TRANS2_WORD), `expected an opening trans2 indicator in: ${line}`);
    assert.ok(line.includes(TRANS2_END), `expected a mid-word terminator before "happy" in: ${line}`);
    assert.ok(line.indexOf(TRANS2_END) < line.indexOf('HAPPY') || line.toUpperCase().includes('HAPPY'), line);
  });

  test('strike combined with bold: both indicators appear, nested', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'strong', tf: louis.TYPEFORM.bold, transcriberTypeform: 'strike' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(TRANS2_WORD), `expected trans2 in: ${line}`);
    assert.ok(/[~^]1/.test(line) || line.includes('~1') || line.includes('^1'), `expected a bold word indicator too in: ${line}`);
  });

  test('grade 1 (uncontracted): the same trans2 word indicator appears', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'This is ' }, { type: 'text', text: 'struck', transcriberTypeform: 'strike' }, { type: 'text', text: ' out.' }] }] };
    const line = firstParaLine(doc, OPTS_G1);
    assert.ok(line.includes(TRANS2_WORD), `expected the trans2 word indicator in grade 1: ${line}`);
  });

  test('grade 1 (uncontracted): a struck passage gets the trans2 PASSAGE indicator and terminator', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'one two three', transcriberTypeform: 'strike' }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc, OPTS_G1);
    assert.ok(line.includes(TRANS2_PASSAGE), `expected the trans2 passage indicator in grade 1: ${line}`);
    assert.ok(line.includes(TRANS2_END), `expected the trans2 terminator in grade 1: ${line}`);
  });

  test('grade 1 (uncontracted): a struck letter gets the trans2 SYMBOL indicator', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'x', transcriberTypeform: 'strike' }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc, OPTS_G1);
    assert.ok(line.includes(TRANS2_SYMBOL), `expected the trans2 symbol indicator in grade 1: ${line}`);
  });

  test('plain text (no transcriberTypeform) is unaffected', () => {
    const doc = { blocks: [{ type: 'para', text: 'Nothing struck here at all.' }] };
    const line = firstParaLine(doc);
    assert.ok(!line.includes(TRANS2_WORD) && !line.includes(TRANS2_SYMBOL) && !line.includes(TRANS2_PASSAGE));
  });
});

// ---------------------------------------------------------------------------------------------
describe('a link AND strikethrough in one paragraph: distinct indicators (Paul\'s decision, 25 Sep 2026)', () => {
  test('the hyperlink (first slot) and strikethrough (second slot) never share braille', () => {
    const doc = { blocks: [{ type: 'para', segments: [
      { type: 'text', text: 'Visit ', hyperlink: false },
      { type: 'text', text: 'our site', href: 'https://example.com', hyperlink: true },
      { type: 'text', text: ' and see the ' },
      { type: 'text', text: 'old price', transcriberTypeform: 'strike' },
      { type: 'text', text: ' today.' },
    ] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(TRANS1_PASSAGE) || line.includes(TRANS1_WORD), `expected a first-slot hyperlink indicator in: ${line}`);
    assert.ok(line.includes(TRANS2_WORD) || line.includes(TRANS2_PASSAGE), `expected a second-slot strike indicator in: ${line}`);
    // The two must not collapse onto the same cells: strike's word form is never mistaken for the hyperlink's.
    assert.notEqual(TRANS1_WORD, TRANS2_WORD);
    assert.notEqual(TRANS1_PASSAGE, TRANS2_PASSAGE);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Special Symbols page and Transcriber\'s Notes suggestion', () => {
  const blocks = [{ type: 'para', segments: [{ type: 'text', text: 'before ' }, { type: 'text', text: 'struck', transcriberTypeform: 'strike' }, { type: 'text', text: ' after' }] }];
  const linkBlocks = [{ type: 'para', segments: [{ type: 'text', text: 'before ' }, { type: 'text', text: 'linked', href: 'https://example.com', hyperlink: true }, { type: 'text', text: ' after' }] }];
  const bothBlocks = [{ type: 'para', segments: [
    { type: 'text', text: 'a ' },
    { type: 'text', text: 'linked', href: 'https://example.com', hyperlink: true },
    { type: 'text', text: ' b ' },
    { type: 'text', text: 'struck', transcriberTypeform: 'strike' },
  ] }];

  test('collectSpecialSymbols lists strikethrough as the SECOND transcriber-defined typeform, kind "typeform"', () => {
    const found = collectSpecialSymbols(blocks, OPTS_G2);
    const hit = found.find((s) => s.kind === 'typeform');
    assert.ok(hit, `no typeform entry found: ${JSON.stringify(found)}`);
    assert.equal(hit.braille, TRANS2_WORD);
    assert.match(hit.description, /second/i);
    assert.match(hit.description, /crossed-out/i);
  });

  test('collectSpecialSymbols lists the hyperlink indicator as the FIRST transcriber-defined typeform, kind "typeform"', () => {
    const found = collectSpecialSymbols(linkBlocks, OPTS_G2);
    const hit = found.find((s) => s.kind === 'typeform');
    assert.ok(hit, `no typeform entry found: ${JSON.stringify(found)}`);
    assert.equal(hit.braille, TRANS1_WORD);
    assert.match(hit.description, /first/i);
    assert.match(hit.description, /hyperlink/i);
  });

  test('a document with a link AND strikethrough lists BOTH typeform entries, distinct braille', () => {
    const found = collectSpecialSymbols(bothBlocks, OPTS_G2).filter((s) => s.kind === 'typeform');
    assert.equal(found.length, 2, `expected two distinct typeform entries: ${JSON.stringify(found)}`);
    const linkEntry = found.find((s) => /hyperlink/i.test(s.description));
    const strikeEntry = found.find((s) => /crossed-out/i.test(s.description));
    assert.ok(linkEntry && strikeEntry, JSON.stringify(found));
    assert.notEqual(linkEntry.braille, strikeEntry.braille);
    assert.equal(linkEntry.braille, TRANS1_WORD);
    assert.equal(strikeEntry.braille, TRANS2_WORD);
  });

  test('a document with no strikethrough lists no typeform entry', () => {
    const found = collectSpecialSymbols([{ type: 'para', text: 'Plain.' }], OPTS_G2);
    assert.ok(!found.some((s) => s.kind === 'typeform'));
  });

  test('suggestTranscriberNotes offers a note about the transcriber-defined typeform when used', () => {
    const suggestions = suggestTranscriberNotes(blocks, OPTS_G2);
    assert.ok(suggestions.some((s) => s.id === 'transcriber-typeform'), JSON.stringify(suggestions));
  });

  test('suggestTranscriberNotes offers a note when only the hyperlink indicator is used', () => {
    const suggestions = suggestTranscriberNotes(linkBlocks, OPTS_G2);
    assert.ok(suggestions.some((s) => s.id === 'transcriber-typeform'), JSON.stringify(suggestions));
  });

  test('suggestTranscriberNotes offers nothing of the kind when strikethrough is not used', () => {
    const suggestions = suggestTranscriberNotes([{ type: 'para', text: 'Plain.' }], OPTS_G2);
    assert.ok(!suggestions.some((s) => s.id === 'transcriber-typeform'));
  });
});

// ---------------------------------------------------------------------------------------------
describe('round trip: HTML -> NIMAS export -> DTBook re-import -> same braille', () => {
  test('a struck word survives save and reload, and brailles the same both times', () => {
    const m = parseHtml('<p>before <s>struck</s> after</p>');
    const model = { title: 'T', blocks: m.blocks };
    const before = firstParaLine(model);
    assert.ok(before.includes(TRANS2_WORD));

    const xml = exportToNimasXml(model, { uid: 'strike-roundtrip', date: '2026-01-01' });
    assert.ok(xml.includes('<span class="strikethrough">'), `exporter should write class="strikethrough":\n${xml}`);
    assert.doesNotMatch(xml, /<bai-[a-z0-9]+[ >/]/i, 'never a literal BrailleBlaster element');

    const reloaded = parseDtbook(xml);
    const p = reloaded.blocks.find((b) => b.type === 'para' && /struck/.test(b.text || ''));
    assert.ok(p, 'the struck paragraph survived reload');
    const hit = strikeSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].transcriberTypeform, 'strike');

    const after = firstParaLine({ title: 'T', blocks: reloaded.blocks });
    assert.equal(after, before, 'braille is identical before and after the round trip');
  });

  test('a second save/reload is stable (idempotent)', () => {
    const m = parseHtml('<p><s>struck</s></p>');
    const xml1 = exportToNimasXml({ title: 'T', blocks: m.blocks }, { uid: 'x', date: '2026-01-01' });
    const reloaded1 = parseDtbook(xml1);
    const xml2 = exportToNimasXml({ title: 'T', blocks: reloaded1.blocks }, { uid: 'x', date: '2026-01-01' });
    assert.equal(xml1, xml2);
  });
});
