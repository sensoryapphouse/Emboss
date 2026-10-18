// Word 97–2003 binary .doc reader (input/doc.mjs, 25 Sep 2026).
//
// Fixtures (tests/fixtures/doc/):
//   * basics.doc / objects.doc — written by tests/helpers/doc-writer.mjs from specs.mjs, each
//     with a .docx twin of the same content: the parity tests check parseDoc(.doc) builds the
//     SAME model as parseDocx(.docx) (only the note ids' prefix differs: doc-fn- / docx-fn-).
//   * basics-8bit / basics-pieces / basics-prm / objects-txid — the same content stored the
//     other ways Word stores it (cp1252 pieces, several pieces out of order, a piece Prm,
//     a text box found through its shape's lTxid).
//   * extras.doc — features the twin writer has no .docx form for (ruby, strikethrough,
//     drop cap, metafile pictures, verse line breaks, internal links, page breaks).
//   * cocoa-*.doc — written by macOS's own Word writer (textutil), an independent real writer.
//   * word6.doc / encrypted.doc — files the reader refuses with a clear message.
// Microsoft Word's own .doc (an IRM template shipped inside Word.app) is read when present.
//
// Fixtures (tests/fixtures/libreoffice/): lo-*.doc/.docx — LibreOffice 26.8's own .doc/.docx
// export (soffice --headless --convert-to), another independent real writer, found while
// comparing parseDoc/parseDocx models on LibreOffice-authored documents (26 Sep 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDoc } from '../input/doc.mjs';
import { parseDocx, parseFile, parseDtbook, BINARY_EXTS } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument } from '../format/document.mjs';
import { SCRIPT_MARKS } from '../format/text-style.mjs';
import { writeDoc, writeDocx } from './helpers/doc-writer.mjs';
import { writeCfb } from './helpers/cfb-writer.mjs';
import { RED, BLUE } from './fixtures/doc/specs.mjs';

const FIX = new URL('./fixtures/doc/', import.meta.url);
const bytes = (name) => { const b = readFileSync(new URL(name, FIX)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const load = (name) => parseDoc(bytes(name));
// Model → comparable JSON: note ids lose their reader-specific prefix, byte arrays compare by content.
// IMP-W9 (Paul, 30 Sep 2026): a running header/footer/comment "was not transcribed" notice is left out of the parity comparison: the .doc
// fixtures are written with a header story, but the test writer's .docx twin has no header part, so only the .doc side carries the notice
// (its own tests: import_imp_w_30sep.test.mjs).
const dropFurnitureNotice = (m) => {
  if (!m || !Array.isArray(m.warnings)) return m;
  const w = m.warnings.filter((x) => !/ not transcribed\.$/.test(x));
  const { warnings, ...rest } = m;
  return w.length ? { ...rest, warnings: w } : rest;
};
const norm = (m) => JSON.parse(JSON.stringify(dropFurnitureNotice(m), (k, v) => (v instanceof Uint8Array ? Array.from(v) : typeof v === 'string' ? v.replace(/^docx?-(fn|en)-/, 'X-$1-') : v)));
const { subOpen, supOpen, end } = SCRIPT_MARKS;

// ---------------------------------------------------------------------------------------
// Parity with the .docx reader
// ---------------------------------------------------------------------------------------
test('parity: basics.doc gives exactly the model parseDocx gives for basics.docx', async () => {
  assert.deepEqual(norm(await load('basics.doc')), norm(await parseDocx(bytes('basics.docx'))));
});

test('parity: objects.doc (pictures, shapes, text boxes, equations, OLE, complex tables) matches objects.docx', async () => {
  const docx = norm(await parseDocx(bytes('objects.docx')));
  // (Import fix list #34, 30 Sep 2026: the linked "Heading 3 Char" twin used in a Normal paragraph is read as bold by both readers; .doc parity done.)
  assert.deepEqual(norm(await load('objects.doc')), docx);
});

test('parity: tables.doc (layout vs data tables, captions, header row, table style, nested) matches tables.docx', async () => {
  const doc = await load('tables.doc');
  const docx = await parseDocx(bytes('tables.docx'));
  assert.deepEqual(norm(doc), norm(docx));
  // the same decisions (a table style's reason names it by display name here, by style id in .docx)
  assert.deepEqual(doc.tableKinds.map((k) => k.kind), docx.tableKinds.map((k) => k.kind));
});

test('tables: a "Table n" caption titles its table; layout tables are read as their cells\' content in reading order', async () => {
  const m = await load('tables.doc');
  assert.equal(m.blocks[0].type, 'table');
  assert.equal(m.blocks[0].title, 'Table 1: Scores');
  assert.deepEqual(m.blocks.slice(2, 5).map((b) => b.type + ':' + (b.text || b.items.map((i) => i.text).join('/'))), ['heading:Cell heading', 'para:Left text.', 'list:Right one/Right two']);
  assert.deepEqual(m.tableKinds.map((k) => k.kind), ['data', 'layout', 'layout', 'layout', 'data', 'data', 'layout', 'data', 'data']);
  assert.equal(m.tableKinds[4].reason, 'marked header row');
  assert.equal(m.tableKinds[5].reason, 'data table style "Grid Table 4 - Accent 1"');
  const k = m.blocks.findIndex((b) => b.type === 'caption');
  assert.deepEqual([m.blocks[k].text, m.blocks[k + 1].headers], ['A plain caption', ['K', 'V']], 'a plain caption after a table goes before it (BANA 11.2.8a)');
});

test('parity: numbering.doc (numbered headings, a list continuing after an interruption, contents entries) matches numbering.docx', async () => {
  assert.deepEqual(norm(await load('numbering.doc')), norm(await parseDocx(bytes('numbering.docx'))));
});

test('numbering: heading numbers, continued list numbering, toc entries with page numbers and levels', async () => {
  const m = await load('numbering.doc');
  assert.deepEqual(m.blocks[1].items, [{ text: 'Introduction', page: '1' }, { text: 'Background', page: '2', level: 1 }, { text: 'Manual entry', page: 'iv' }]);
  assert.deepEqual(m.blocks.filter((b) => b.type === 'heading').map((b) => b.text), ['Contents', '1 Introduction', '1.1 Scope', '1.2 Detail', '2 Method']);
  assert.ok(m.blocks.some((b) => b.type === 'para' && b.text === 'Name: Ann'), 'a tab with no dot leader is a space');
  const lists = m.blocks.filter((b) => b.type === 'list' && !b.kind);
  assert.deepEqual(lists.map((l) => l.items.map((i) => i.marker)), [['1.', '2.'], ['3.', 'I.', 'I.a']]);
});

test('legal numbering shows every number in the level text as Arabic numerals', async () => {
  const m = await parseDoc(writeDoc({ lists: { 1: [{ fmt: 'upperRoman', text: '%1.' }, { fmt: 'lowerLetter', text: '%1.%2', legal: true }] },
    body: [{ p: 'One', list: { id: 1, level: 0 } }, { p: 'Sub', list: { id: 1, level: 1 } }] }));
  assert.deepEqual(m.blocks[0].items.map((i) => i.marker), ['I.', '1.1']);
});

test('the same text stored as 8-bit pieces, as out-of-order pieces, or with the text box found by lTxid reads identically', async () => {
  const base = norm(await load('basics.doc'));
  assert.deepEqual(norm(await load('basics-8bit.doc')), base);
  assert.deepEqual(norm(await load('basics-pieces.doc')), base);
  assert.deepEqual(norm(await load('objects-txid.doc')), norm(await load('objects.doc')));
});

test('a piece property modifier (Prm) is applied: the second piece is bold', async () => {
  const m = await load('basics-prm.doc');
  const h = m.blocks.find((b) => b.type === 'heading' && b.text === 'Section');
  assert.deepEqual(h.segments, [{ type: 'text', text: 'Sec' }, { type: 'text', text: 'tion', tf: 4 }]);
});

// ---------------------------------------------------------------------------------------
// Feature checks (basics)
// ---------------------------------------------------------------------------------------
test('basics: title, headings, emphasis, scripts', async () => {
  const m = await load('basics.doc');
  assert.equal(m.title, 'The Document Title');
  assert.deepEqual(m.blocks[0], { type: 'title', text: 'The Document Title' });
  assert.deepEqual(m.blocks[1], { type: 'heading', level: 1, text: 'Chapter One' });
  assert.deepEqual(m.blocks[2].segments, [
    { type: 'text', text: 'Plain ' }, { type: 'text', text: 'bold', tf: 4 }, { type: 'text', text: ' and ' },
    { type: 'text', text: 'italic', tf: 1 }, { type: 'text', text: ' and ' }, { type: 'text', text: 'under', tf: 2 },
    { type: 'text', text: `, H${subOpen}2${end}O, x${supOpen}2${end}.` },
  ]);
  assert.deepEqual(m.metadata, { creator: 'Emboss tests' });
  assert.ok(!JSON.stringify(m).includes('Running head'), 'headers are not transcribed');
});

test('basics: footnote and endnote bodies follow their paragraph, numbered in order', async () => {
  const m = await load('basics.doc');
  const i = m.blocks.findIndex((b) => b.segments && b.segments.some((s) => s.type === 'noteref'));
  assert.deepEqual(m.blocks[i].segments.filter((s) => s.type === 'noteref'), [
    { type: 'noteref', text: '1', idref: 'doc-fn-1' }, { type: 'noteref', text: '1', idref: 'doc-en-1' }]);
  assert.deepEqual(m.blocks[i + 1], { type: 'footnote', text: 'The footnote text.', id: 'doc-fn-1' });
  assert.equal(m.blocks[i + 2].kind, 'endnote');
  assert.equal(m.blocks[i + 2].text, 'Endnote one');
});

test('basics: numbered list with a nested level, restarted bullets, table with a spanning cell', async () => {
  const m = await load('basics.doc');
  const lists = m.blocks.filter((b) => b.type === 'list');
  assert.deepEqual(lists[0].items, [
    { text: 'First', marker: '1.' }, { text: 'Second', marker: '2.' }, { text: 'Nested', marker: 'a)', level: 1 }, { text: 'Third', marker: '3.' }]);
  assert.deepEqual(lists[1].items, [{ text: 'Bullet one', marker: '•' }, { text: 'Bullet two', marker: '•' }]);
  const t = m.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers, ['Name', 'Age']);
  // IMP-W5 (Paul, 30 Sep 2026, "Merged cells"): the cell spanning two columns repeats its text in both (was: the second left empty).
  assert.deepEqual(t.rows[1], ['Wide', 'Wide']);
  assert.equal(t.rows[0][1].segments[0].tf, 4);
});

test('basics: hyperlink field → href; other fields show their result; XE dropped; revisions, hidden text and caps', async () => {
  const m = await load('basics.doc');
  const link = m.blocks.find((b) => b.segments && b.segments.some((s) => s.href));
  // LINK-2 (Paul, 28 Sep 2026, KD round-2 Q1): the fixture's hyperlink field is written with
  // the ordinary Hyperlink character style (doc-writer.mjs's EXTRA_BUILTIN, underline: true —
  // matching the real docx corpus's own built-in "Hyperlink" style, Emboss/tests/real_samples/
  // docx/*), which now carries tf: 2 (TYPEFORM.underline) through resolveChp's linkUnderline —
  // was `{ type: 'text', text: 'our site', href: 'https://example.com/' }`, no tf.
  assert.deepEqual(link.segments[1], { type: 'text', text: 'our site', tf: 2, href: 'https://example.com/' });
  assert.ok(m.blocks.some((b) => b.text === 'Field: 7 and done'));
  assert.ok(m.blocks.some((b) => b.text === 'Keep added end CAPS SMALL'), 'deleted and hidden text dropped, inserted kept, all caps and small caps upper-cased');
});

// IMP-W2 (Paul, 30 Sep 2026, "Shift+Enter"): an ordinary paragraph keeps its forced line breaks as ONE paragraph ('\n' in the segment text);
// the verse-line split (one play block per line) is only for a poem / verse style (import_imp_w_30sep.test.mjs). This test pinned the
// old verse split of the fixture's unstyled paragraph.
test('basics: Shift+Enter is a forced line break in one paragraph; tab, non-breaking hyphen, soft hyphen and Symbol-font glyph', async () => {
  const m = await load('basics.doc');
  assert.equal(m.blocks.filter((b) => b.type === 'play').length, 0);
  const para = m.blocks.find((b) => (b.segments || []).some((s) => /Tab bed/.test(s.text)) || b.text === 'Tab bed');
  assert.equal((para.segments || [{ text: para.text }]).map((s) => s.text).join(''), 'Tab bed\nline-xy α');
});

// ---------------------------------------------------------------------------------------
// Feature checks (objects)
// ---------------------------------------------------------------------------------------
test('objects: localised built-in heading (by sti), outline level from a custom style and directly', async () => {
  const m = await load('objects.doc');
  assert.deepEqual(m.blocks.slice(0, 3), [
    { type: 'heading', level: 1, text: 'Localised heading' },
    { type: 'heading', level: 2, text: 'Custom outline style' },
    { type: 'heading', level: 3, text: 'Direct outline' }]);
  // a character style's bold is emphasis; a linked (paragraph-style twin) one is not — inside a paragraph of its partner style. Import fix
  // list #34 (Paul, 30 Sep 2026; the .docx reader since that day, this .doc reader now): the twin "Heading 3 Char" on words in a NORMAL
  // paragraph is the author's bold (was: ignored everywhere, ' and linked' plain).
  assert.deepEqual(m.blocks[3].segments, [{ type: 'text', text: 'Char style ' }, { type: 'text', text: 'strong', tf: 4 }, { type: 'text', text: ' and ' }, { type: 'text', text: 'linked', tf: 4 }]);
});

test('objects: inline and floating pictures become graphics with alt text, caption and PNG bytes; text box in place', async () => {
  const m = await load('objects.doc');
  const g = m.blocks.filter((b) => b.type === 'graphic');
  assert.deepEqual(g.slice(0, 2).map((b) => [b.alt, b.caption]), [['A red square', 'Figure 1: red'], ['Blue bar', undefined]]);
  const res = new Map(m.resources.map((r) => [r.path, r]));
  assert.deepEqual(Array.from(res.get(g[0].src).bytes), Array.from(RED));
  assert.deepEqual(Array.from(res.get(g[1].src).bytes), Array.from(BLUE));
  assert.equal(res.get(g[0].src).mime, 'image/png');
  const bi = m.blocks.findIndex((b) => b.text === 'Boxed heading');
  assert.equal(m.blocks[bi].type, 'heading');
  assert.equal(m.blocks[bi - 1], g[1], 'the text box follows the floating picture anchored before it');
});

test('objects: Equation Editor 3.0 objects → MathML (inline and display); unreadable → placeholder; other OLE → its own placeholder', async () => {
  const m = await load('objects.doc');
  const inline = m.blocks.find((b) => b.segments && b.segments.some((s) => s.type === 'math'));
  assert.match(inline.segments[1].mathml, /<mi>x<\/mi><mo>\+<\/mo><mn>1<\/mn>/);
  assert.equal(inline.segments[1].latex, 'x + 1');
  assert.ok(m.blocks.some((b) => b.type === 'math' && /<mi>y<\/mi>/.test(b.mathml)), 'an equation alone in its paragraph is a display equation block');
  const segs = m.blocks.flatMap((b) => b.segments || []);
  assert.ok(segs.some((s) => s.type === 'imgnote' && s.text === 'equation not transcribed'));
  assert.ok(segs.some((s) => s.type === 'imgnote' && s.text === 'embedded object not transcribed (Excel spreadsheet)'));
  assert.equal(m.warnings.length, 2);
});

test('objects: vertical merge, a nested table following its outer table, a picture kept in its cell, the cell footnote after the table', async () => {
  const m = await load('objects.doc');
  const ti = m.blocks.findIndex((b) => b.type === 'table');
  const t = m.blocks[ti];
  assert.deepEqual(t.headers, ['H1', 'H2', 'H3']);
  // IMP-W6 (Paul, 30 Sep 2026): the nested table is no longer flattened into its cell; a placeholder stands there and the table follows
  // the outer one. IMP-W5: the vertically merged "tall" and the two-column "wide" repeat in every cell they cover.
  assert.deepEqual(t.rows[0], ['tall', 'b', 'outer (table follows)']);
  assert.deepEqual(t.rows[1], ['tall', 'wide', 'wide']);
  const pic = t.rows[2][0].segments.find((s) => s.type === 'imgnote');
  assert.equal(pic.text, 'cell pic');
  assert.deepEqual(Array.from(m.resources.find((r) => r.path === pic.src).bytes), Array.from(RED));
  assert.deepEqual(m.blocks[ti + 1], { type: 'footnote', text: 'cell note', id: 'doc-fn-1' });
  const nested = m.blocks[ti + 2];
  assert.equal(nested.type, 'table');
  assert.deepEqual([nested.headers, nested.rows], [['in1', 'in2'], [['in3', 'in4']]]);
  assert.deepEqual(m.tableKinds.map((k) => k.kind), ['data', 'data']);
});

// ---------------------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------------------
test('extras: ruby base text, strikethrough (the strike transcriber typeform), drop cap, metafile pictures → SVG', async () => {
  const m = await load('extras.doc');
  // IMP-W11 (Paul, 30 Sep 2026, "Ruby"): the guide follows its base text in brackets (was: the base alone).
  assert.deepEqual(m.blocks[0], { type: 'para', text: 'Ruby: 漢字 (かんじ) end' });
  assert.deepEqual(m.blocks[1].segments[1], { type: 'text', text: 'out', transcriberTypeform: 'strike' });
  assert.deepEqual(m.blocks[2], { type: 'para', text: 'Once upon a time.' });
  const g = m.blocks.filter((b) => b.type === 'graphic');
  assert.deepEqual(g.map((b) => b.alt), ['A drawn box', 'Packed box']);
  for (const b of g) {
    const r = m.resources.find((x) => x.path === b.src);
    assert.equal(r.mime, 'image/svg+xml');
    assert.match(new TextDecoder().decode(r.bytes), /<svg[\s\S]*<rect/);
  }
});

test('extras: Shift+Enter breaks are one forced-break paragraph; heading keeps its break as a space; internal link has no href; page break is a space', async () => {
  const m = await load('extras.doc');
  // IMP-W2 (Paul, 30 Sep 2026): the unstyled paragraph with two Shift+Enter breaks is one paragraph with a forced break (the empty line
  // between is one break); the verse split with a line indicator, for a poem style, is pinned in import_imp_w_30sep.test.mjs.
  assert.ok(m.blocks.some((b) => b.type === 'para' && (b.segments || [{ text: b.text }]).map((s) => s.text).join('') === 'Line one\nLine three'), JSON.stringify(m.blocks));
  assert.ok(m.blocks.some((b) => b.type === 'heading' && b.text === 'Heading with a break'));
  assert.ok(m.blocks.some((b) => b.type === 'para' && b.text === 'See chapter two.' && !b.segments));
  assert.ok(m.blocks.some((b) => b.text === 'Page one page two'));
  assert.ok(m.blocks.some((b) => b.text === 'Joined by a deleted paragraph mark.'), 'a paragraph mark deleted as a tracked change joins its paragraph to the next');
});

test('extras: a footnote with the author\'s own mark keeps that mark; the next automatic note is still number 1', async () => {
  const m = await load('extras.doc');
  const i = m.blocks.findIndex((b) => (b.segments || []).some((s) => s.type === 'noteref'));
  assert.deepEqual(m.blocks[i].segments.filter((s) => s.type === 'noteref').map((s) => s.text), ['*', '1']);
  // the note's own copy of a custom mark is text in the (superscript) footnote-reference style
  assert.deepEqual(m.blocks.slice(i + 1, i + 3).map((b) => b.text), [`${supOpen}*${end} Star note.`, 'Numbered note.']);
});

// ---------------------------------------------------------------------------------------
// Real writers
// ---------------------------------------------------------------------------------------
test('macOS (Cocoa) Word writer: emphasis, strikethrough, scripts, a table with a merged cell, non-ASCII text', async () => {
  const m = await load('cocoa-features.doc');
  const p = m.blocks[1];
  assert.deepEqual(p.segments.slice(0, 8).map((s) => [s.text, s.tf || 0, s.transcriberTypeform || '']), [
    ['Plain ', 0, ''], ['bold', 4, ''], [' ', 0, ''], ['italic', 1, ''], [' ', 0, ''], ['under', 2, ''], [' ', 0, ''], ['struck', 0, 'strike']]);
  assert.ok(p.segments[8].text.includes(`H${subOpen}2${end}O x${supOpen}2${end}`));
  const t = m.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers.map((h) => (typeof h === 'string' ? h : h.text)), ['Name', 'Age']);
  assert.deepEqual(t.rows[1], ['Merged', '']);
  assert.ok(m.blocks.some((b) => b.text === 'After table α — café.'));
  const s = await load('cocoa-sample.doc');
  assert.equal(s.blocks[0].text, 'Braille Test Document');
});

const WORD_DOC = '/Applications/Microsoft Word.app/Contents/Frameworks/mso99.framework/Versions/A/Resources/en.lproj/prottpln.doc';
test('Microsoft Word-written .doc (Word\'s own IRM template, when Word is installed): body text only, header ignored', { skip: !existsSync(WORD_DOC) }, async () => {
  const b = readFileSync(WORD_DOC);
  const m = await parseDoc(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  assert.equal(m.blocks.length, 1);
  assert.match(m.blocks[0].text, /^Permission is restricted for this document\./);
});

// ---------------------------------------------------------------------------------------
// Refusals, misnamed files, dispatch
// ---------------------------------------------------------------------------------------
test('Word 6/95 and encrypted files are refused with a clear message', async () => {
  await assert.rejects(load('word6.doc'), /Word 6\.0 or Word 95/);
  await assert.rejects(load('encrypted.doc'), /password-protected/);
  await assert.rejects(parseDoc(writeCfb([{ path: 'EncryptionInfo', data: new Uint8Array(8) }, { path: 'EncryptedPackage', data: new Uint8Array(8) }])), /password-protected/);
  await assert.rejects(parseDoc(writeCfb([{ path: 'Workbook', data: new Uint8Array(8) }])), /Excel workbook/);
  await assert.rejects(parseDoc(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 5])), /not a Word document/);
  const good = new Uint8Array(bytes('basics.doc'));
  await assert.rejects(parseDoc(good.slice(0, 3000)), /damaged/);
});

test('a ".doc" that is really RTF, HTML, a .docx or plain text is read by the right reader', async () => {
  const enc = new TextEncoder();
  assert.equal((await parseDoc(enc.encode('{\\rtf1\\ansi Hello {\\b bold}.\\par}'))).blocks[0].segments[1].tf, 4);
  assert.equal((await parseDoc(enc.encode('<html><body><h1>Head</h1><p>Para</p></body></html>'))).blocks[0].type, 'heading');
  assert.equal((await parseDoc(bytes('basics.docx'))).blocks[0].type, 'title');
  assert.equal((await parseDoc(enc.encode('One para.\n\nTwo para.'))).blocks.length, 2);
});

test('parseFile: .doc/.dot → the .doc reader, .docm/.dotx/.dotm → the .docx reader, all read as bytes', async () => {
  for (const ext of ['doc', 'dot', 'docm', 'dotx', 'dotm']) assert.ok(BINARY_EXTS.has(ext), ext);
  const want = norm(await parseFile('x.doc', bytes('basics.doc')));
  assert.deepEqual(norm(await parseFile('x.dot', bytes('basics.doc'))), want);
  for (const ext of ['docm', 'dotx', 'dotm']) assert.deepEqual(norm(await parseFile(`x.${ext}`, bytes('basics.docx'))), want, ext);
  // a Word 97–2003 file saved with a .docx name is still read (an encrypted .docx is refused)
  assert.deepEqual(norm(await parseFile('renamed.docx', bytes('basics.doc'))), want);
  await assert.rejects(parseFile('locked.docx', writeCfb([{ path: 'EncryptionInfo', data: new Uint8Array(8) }, { path: 'EncryptedPackage', data: new Uint8Array(8) }])), /password-protected/);
});

test('damaged files never crash or hang the reader: they load, or fail with a user-facing message', async () => {
  const { readCfb } = await import('../input/cfb.mjs');
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let loaded = 0;
  for (const f of ['basics.doc', 'objects.doc', 'tables.doc', 'numbering.doc']) {
    const orig = readCfb(new Uint8Array(bytes(f)));
    const streams = orig.entries.filter((e) => e.type === 'stream').map((e) => ({ path: e.path, data: orig.getStream(e.path) }));
    for (let it = 0; it < 40; it++) {
      const ss = streams.map((x) => ({ path: x.path, data: x.data.slice() }));
      const target = ss[Math.floor(rnd() * ss.length)];
      for (let k = 1 + Math.floor(rnd() * 20); k > 0; k--) target.data[Math.floor(rnd() * target.data.length)] = Math.floor(rnd() * 256);
      const t0 = Date.now();
      try { const m = await parseDoc(writeCfb(ss)); assert.ok(Array.isArray(m.blocks)); loaded++; }
      catch (e) { assert.ok(e && e.userFacing, `${f} #${it}: ${e && e.stack}`); }
      assert.ok(Date.now() - t0 < 5000, `${f} #${it} took ${Date.now() - t0} ms`);
    }
  }
  assert.ok(loaded > 100, `most damaged copies still load (${loaded}/160)`);
});

// ---------------------------------------------------------------------------------------
// Scale, downstream
// ---------------------------------------------------------------------------------------
test('a long document (many FKP pages) reads every paragraph with its formatting', async () => {
  const body = [];
  for (let i = 0; i < 2000; i++) body.push(i % 100 === 0 ? { p: `Part ${i}`, style: 'heading 2' } : { p: ['Para ', { text: `n${i}`, b: i % 7 === 0 }, ' ordinary text to fill the line.'] });
  const m = await parseDoc(writeDoc({ body }));
  assert.equal(m.blocks.length, 2000);
  assert.equal(m.blocks.filter((b) => b.type === 'heading').length, 20);
  assert.deepEqual(m.blocks[1999], { type: 'para', text: 'Para n1999 ordinary text to fill the line.' });
  assert.equal(m.blocks[1995].segments[1].tf, 4);
});

test('a .doc model survives NIMAS save and reopen (headings, list, table, note, link, maths)', async () => {
  for (const name of ['basics.doc', 'objects.doc']) {
    const m = await load(name);
    const back = parseDtbook(exportToNimasXml(m));
    const text = (bl) => JSON.stringify(bl.blocks);
    for (const s of ['Chapter One', 'Second', 'Wide', 'The footnote text.', 'https://example.com/', 'Localised heading', 'outer (table follows)', 'in3', 'cell note']) {
      if (text(m).includes(s)) assert.ok(text(back).includes(s), `${name}: ${s}`);
    }
    assert.deepEqual(back.blocks.filter((b) => b.type === 'heading').map((b) => [b.level, b.text]), m.blocks.filter((b) => b.type === 'heading').map((b) => [b.level, b.text]));
    if (name === 'objects.doc') assert.ok(back.blocks.some((b) => b.type === 'math' || (b.segments || []).some((s) => s.type === 'math')));
  }
});

test('a .doc model formats to braille (headings, list markers, note, table)', async () => {
  const m = await load('basics.doc');
  const up = (s) => String(s).toUpperCase();
  const brf = formatDocument(m, { mode: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
  const flat = brf.replace(/\s+/g, ' ');
  for (const s of ['CHAPTER ONE', 'FIRST', 'NESTED', 'THE FOOTNOTE TEXT.', 'NAME', 'WIDE']) assert.ok(flat.includes(s), s);
});

// ---------------------------------------------------------------------------------------
// List items with more than one paragraph, or with a table inside them (item.blocks; parity
// with parse.mjs's docxContinuesItem/docxAddItemPara and list_item_blocks.test.mjs's DOCX
// coverage of the same rule — 26 Sep 2026). Built with writeDoc/writeDocx from the same spec
// so parseDoc and parseDocx are checked against each other, not just against expectations.
// ---------------------------------------------------------------------------------------
const listSpec = (extraBody, opts = {}) => ({
  lists: { 1: [{ fmt: 'decimal', text: '%1.' }] },
  body: [
    { p: 'Item one.', style: 'List Paragraph', list: { id: '1', level: 0 } },
    ...extraBody,
    { p: 'Item two.', style: 'List Paragraph', list: { id: '1', level: 0 } },
  ],
  ...opts,
});
const docAndDocx = async (spec) => [await parseDoc(writeDoc(spec).buffer.slice(0)), await parseDocx(await writeDocx(spec))];

test('.doc: a ListParagraph-styled paragraph with no numbering after a numbered item is that item\'s further paragraph', async () => {
  const spec = listSpec([{ p: 'Its second paragraph.', style: 'List Paragraph' }]);
  const [doc, docx] = await docAndDocx(spec);
  assert.deepEqual(norm(doc), norm(docx));
  const [a, b] = doc.blocks[0].items;
  assert.equal(a.text, 'Item one.');
  assert.deepEqual(a.blocks, [{ type: 'para', text: 'Its second paragraph.' }]);
  assert.equal(b.text, 'Item two.');
  assert.equal(b.marker, '2.');
});

test('.doc: a plain (unstyled) paragraph indented at least as far as the list text continues the item; one at the margin ends the list', async () => {
  const spec = listSpec([{ p: 'Indented follow-on.', ind: 720 }, { p: 'Body text.' }]);
  const [doc, docx] = await docAndDocx(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(doc.blocks[0].items[0].blocks, [{ type: 'para', text: 'Indented follow-on.' }]);
  assert.deepEqual(doc.blocks.map((b) => b.type), ['list', 'para', 'list']);
});

test('.doc: an indented table between two items of the list is inside the first item; the list goes on', async () => {
  const spec = listSpec([{ table: [['Year', 'Total'], ['2019', '14']], ind: 720 }]);
  const [doc, docx] = await docAndDocx(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(doc.blocks.map((b) => b.type), ['list']);
  const [a, b] = doc.blocks[0].items;
  assert.equal(a.blocks.length, 1);
  assert.equal(a.blocks[0].type, 'table');
  assert.equal(b.text, 'Item two.');
  assert.equal(b.marker, '2.');
  // a table at the margin still ends the list (numbering goes on)
  const spec2 = listSpec([{ table: [['Year', 'Total'], ['2019', '14']] }]);
  const [doc2, docx2] = await docAndDocx(spec2);
  assert.deepEqual(norm(doc2), norm(docx2));
  assert.deepEqual(doc2.blocks.map((b) => b.type), ['list', 'table', 'list']);
  assert.equal(doc2.blocks[0].items[0].blocks, undefined);
});

// ---------------------------------------------------------------------------------------
// A "linked" character style (a paragraph style's auto-generated run-formatting twin, e.g.
// Heading 4 / "Heading 4 Char") found with no istdLink field at all in a real LibreOffice
// 26.8 .doc export (cbSTDBaseInFile 10, StdfBase only -- StdfPost2000, which carries istdLink
// in a real Word writer, is absent) -- 26 Sep 2026. Without it, resolveChp's "a linked style's
// own look is not user emphasis" rule (parity with parse.mjs's runEmphasis, matching a .docx
// character style's own w:link) never applied, so the run right before an automatic footnote
// reference (and the text right after it, both still carrying the character style) wrongly
// read tf 5 (bold+italic) -- the same text with no footnote reads tf 0, matching .docx exactly.
// `oldStsh` (doc-writer.mjs) writes a stylesheet in that same shape so this doesn't depend on a
// real LibreOffice binary fixture for a quirk that could change between LibreOffice versions.
// ---------------------------------------------------------------------------------------
test('.doc: a linked character style with no istdLink field (LibreOffice\'s .doc STSH shape) is still excluded from emphasis, even next to a footnote reference', async () => {
  const spec = {
    styles: [
      { name: 'Heading 4', type: 'para', sti: 4, basedOn: 'Normal', bold: true, italic: true, outline: 3 },
      { name: 'Heading 4 Char', type: 'char', bold: true, italic: true, linked: 'Heading 4' },
    ],
    body: [
      { p: [{ text: 'Formal sign-off from the Chief Officer', style: 'Heading 4 Char' }, { footnote: [{ p: 'The footnote text.' }] }, { text: '.', style: 'Heading 4 Char' }], style: 'Heading 4', outline: 3 },
      { p: 'Formal sign-off from the Chief Officer, elsewhere with no footnote.' },
    ],
  };
  const doc = await parseDoc(writeDoc(spec, { oldStsh: true }).buffer.slice(0));
  const docx = await parseDocx(await writeDocx(spec));
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(doc.blocks[0].segments, [
    { type: 'text', text: 'Formal sign-off from the Chief Officer' },
    { type: 'noteref', text: '1', idref: 'doc-fn-1' },
    { type: 'text', text: '.' },
  ]);
});

// ---------------------------------------------------------------------------------------
// LibreOffice-written fixtures (tests/fixtures/libreoffice/): real LibreOffice 26.8 .doc
// output, built by converting a hand-written flat-ODF (.fodt) source through soffice
// --convert-to odt, then --convert-to doc/docx from that .odt — so the .doc/.docx bytes
// are genuine LibreOffice filter output, not this repo's own writeDoc/writeDocx test
// writer. Found while comparing LibreOffice .doc/.docx/.odt output against parseDoc.
// ---------------------------------------------------------------------------------------
const LOFIX = new URL('./fixtures/libreoffice/', import.meta.url);
const loBytes = (name) => { const b = readFileSync(new URL(name, LOFIX)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('LibreOffice .doc: a text box (no picture) does not also produce an empty graphic block, and its explicit border/fill makes it a box (K7/BANA §7), same as the matching .docx', async () => {
  // LibreOffice's .doc export gives a floating shape/text-box anchor (0x08) a companion 0x01
  // "fallback picture" character ([MS-DOC]'s backward-compatible "can't draw this shape? show
  // this instead" convention) even when the shape has no picture fill at all; that fallback
  // PICF resolves to no blip, but doc.mjs used to push it anyway as an empty
  // {type:'graphic', src:'', alt:''} block right next to the text box's own paragraphs.
  //
  // The fixture's text box is LibreOffice's own default-styled one: an explicit white fill and
  // an explicit black border (OfficeArtFOPT fillColor/lineColor + the fFilled/fLine boolean
  // flags — see doc-art.mjs's readFopt), which LibreOffice's .docx export writes as the exact
  // same DrawingML <a:solidFill>/<a:ln><a:solidFill> — so both readers box it (K7/BANA §7); a
  // white fill names no colour (K7 only names a colour that visibly sets one box apart from
  // another), matching parse.mjs's own hexToColorName near-white rule.
  const doc = await parseDoc(loBytes('lo-textbox.doc'));
  const docx = await parseDocx(loBytes('lo-textbox.docx'));
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(doc.blocks.map((b) => b.type), ['para', 'box', 'para']);
  assert.equal(doc.blocks[0].text, 'Before the box.');
  assert.deepEqual(doc.blocks[1].blocks, [{ type: 'para', text: 'Text inside a text box.' }]);
  assert.equal(doc.blocks[1].boxColor, undefined);
  assert.equal(doc.blocks[2].text, 'After the box.');
});

test('LibreOffice .doc: a numbered list item with a further body paragraph at the same indent keeps it as the item\'s own further paragraph', async () => {
  // Found comparing a real government .docx (statutory-guidance-probation-roles) converted to
  // .doc with the same content: a "RATIONALE: …" paragraph right after a numbered item, same
  // ListParagraph style and indent as the item, no numbering of its own.
  const doc = await parseDoc(loBytes('lo-list-cont.doc'));
  const docx = await parseDocx(loBytes('lo-list-cont.docx'));
  assert.deepEqual(norm(doc), norm(docx));
  const [a, b] = doc.blocks[0].items;
  assert.equal(a.text, 'Item one.');
  assert.deepEqual(a.blocks, [{ type: 'para', text: 'RATIONALE: its further paragraph.' }]);
  assert.equal(b.text, 'Item two.');
  assert.equal(b.marker, '2.');
  assert.deepEqual(doc.blocks.map((b2) => b2.type), ['list', 'para']);
});

test('LibreOffice .doc: an internal-bookmark-only hyperlink field gets no href (matches .docx); an external one keeps its URL', async () => {
  // Every field LibreOffice writes to .doc has a stray control character (0x01) right at the
  // end of its instruction text, after the closing quote and before the field-result
  // delimiter. For `HYPERLINK \l "bookmark"` (an internal cross-reference, meant to give no
  // href at all — parseDocx drops it too, the same as a .docx hyperlink with only an internal
  // anchor), fieldHref used to tokenize that stray character as the href itself once the
  // bookmark argument had already been consumed, producing a literal "\u0001" href instead of
  // no href at all.
  const doc = await parseDoc(loBytes('lo-hyperlink.doc'));
  const docx = await parseDocx(loBytes('lo-hyperlink.docx'));
  assert.deepEqual(norm(doc), norm(docx));
  const hrefs = [];
  JSON.stringify(doc.blocks, (k, v) => { if (k === 'href') hrefs.push(v); return v; });
  assert.deepEqual(hrefs, ['https://example.com/page']);
});
