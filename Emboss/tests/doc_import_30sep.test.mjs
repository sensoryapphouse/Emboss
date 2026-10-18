// Word 97-2003 .doc reader: the remaining import problems of the 30 Sep 2026 list (Emboss/docs/import-fix-list.md), brought level with
// the .docx reader (parse.mjs), which was fixed the same day. The .doc reader is built to give the SAME model as the .docx reader for
// the same document, so most tests here build one spec, write it as a .doc (tests/helpers/doc-writer.mjs writeDoc) AND as a .docx
// (writeDocx) and compare the two models — a .doc that differs from its .docx twin is the bug.
//   row 1 / IMP-W7   custom bullets (arrow, en dash...) keep their glyph as the list item's `marker`
//   row 30           numbering of LibreOffice-written .doc files (analysis: see the test names)
//   row 31 (.doc)    Equation Editor / MathType equations: a function name is a function, brackets are stretchy fences
//   row 11 (.doc)    pictures: alt text from the shape's description, captions, floating pictures; IMP-W12 no-description warning
//   checklist        a table inside a footnote, letters typed in a Symbol-font run, the check-box form field
// Every test was written to FAIL against the reader as it was before this batch: point DOC_MJS at a saved copy of the old doc.mjs
// placed next to the real one (input/doc.pre.mjs) to see it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const { parseDocx } = await import('../input/parse.mjs');
const { parseDoc } = await import(process.env.DOC_MJS || '../input/doc.mjs');
const { writeDoc, writeDocx } = await import('./helpers/doc-writer.mjs');

// U+F000 + n: a symbol-font character as Word stores it in a list level's number text (U+F0D8 = Wingdings 0xD8)
const PUA = (n) => String.fromCharCode(0xF000 + n);
const u8ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const readDoc = (spec) => parseDoc(u8ab(writeDoc(spec)));
const readDocx = async (spec) => parseDocx(await writeDocx(spec));
// the two readers' models for one spec, note ids (doc-fn- / docx-fn-) made alike, byte arrays by content, the "not transcribed" notice left out
const norm = (m) => {
  if (m && Array.isArray(m.warnings)) { const w = m.warnings.filter((x) => !/ not transcribed\.$/.test(x)); const { warnings, ...rest } = m; m = w.length ? { ...rest, warnings: w } : rest; }
  return JSON.parse(JSON.stringify(m, (k, v) => (v instanceof Uint8Array ? Array.from(v) : typeof v === 'string' ? v.replace(/^docx?-(fn|en)-/, 'X-$1-') : v)));
};
const twins = async (spec) => ({ doc: await readDoc(spec), docx: await readDocx(spec) });
const flat = (b) => (typeof b.text === 'string' ? b.text : (b.segments || []).map((s) => s.text || '').join(''));
const markers = (m) => m.blocks.filter((b) => b.type === 'list').flatMap((b) => b.items.map((i) => i.marker ?? null));

// =====================================================================================================
// Row 1 / IMP-W7: custom bullets keep their glyph
// =====================================================================================================
// A level's bullet character is stored as text in the list table's LVL (PUA U+F0xx for a symbol-font bullet, the level's font in its
// CHPX). The .doc reader used to give every shape but the four it knew a plain "•", where the .docx reader (parse.mjs wordBulletGlyph,
// Paul's IMP-W7) keeps it so the braille can give it a transcriber-defined symbol.
const BULLETS = {
  1: [{ fmt: 'bullet', text: PUA(0xD8), font: 'Wingdings' }],     // Wingdings arrowhead (Word's "Ø" bullet) -> ➢
  2: [{ fmt: 'bullet', text: '➢', font: 'Arial' }],              // the arrow typed in an ordinary font (LibreOffice writes it so)
  3: [{ fmt: 'bullet', text: '–', font: 'Arial' }],         // en dash
  4: [{ fmt: 'bullet', text: PUA(0xB7), font: 'Symbol' }],        // the ordinary Word bullet -> stays a dot
  5: [{ fmt: 'bullet', text: PUA(0xA7), font: 'Wingdings' }],     // Wingdings small black square -> ■
  6: [{ fmt: 'bullet', text: 'o', font: 'Arial' }],              // Courier/Arial "o" -> ○
  7: [{ fmt: 'bullet', text: PUA(0xE8), font: 'Wingdings' }],     // Wingdings heavy right arrow -> ➔
  8: [{ fmt: 'bullet', text: PUA(0x76), font: 'Wingdings' }],     // a Wingdings shape with no Unicode form here -> the ordinary dot
  9: [{ fmt: 'bullet', text: '•' }],                         // a literal bullet
  10: [{ fmt: 'bullet', text: '★', font: 'Arial' }],        // a star
};
const bulletSpec = () => ({ lists: BULLETS, body: Object.keys(BULLETS).map((id) => ({ p: `item ${id}`, list: { id, level: 0 } })) });

test('row 1 / IMP-W7: a .doc list keeps its custom bullet glyph as the item marker, as the .docx twin does', async () => {
  const { doc, docx } = await twins(bulletSpec());
  assert.deepEqual(markers(docx), ['➢', '➢', '–', '•', '■', '○', '➔', '•', '•', '★'], 'the .docx reader (the reference)');
  assert.deepEqual(markers(doc), markers(docx));
  assert.deepEqual(norm(doc), norm(docx));
});

// =====================================================================================================
// Row 30 (audit #28): numbering of a restarted / "start at 5" list in a LibreOffice-written .doc
// =====================================================================================================
// FINDING (no reader change): in lo-w08-lists.doc the two items of the "restarted" list are written by LibreOffice as two DIFFERENT
// lists: item 1 in a NEW list (LFO 9 -> its own LST 9, a clone of LST 3 made by the exporter for the restart) and item 2 in the
// ORIGINAL list (LFO 3 -> LST 3); likewise "start at 5" (LFO 10 / LST 10, start 5, then LFO 7 / LST 7, start 1). Nothing in the file
// (no shared lsid, no override, no list name) ties the pair together, so Word's own rule — a list is counted on its own — gives
// "1." "1." and "5." "1."; soffice itself reads its own file that way (converting lo-w08-lists.doc to text gives 1. / 1. and 5. / 1.).
// The .docx twin differs because LibreOffice's .docx export keeps both items in ONE list. Guessing that two adjacent lists with
// the same look are one would number real Word documents wrongly, so the reader follows the file. What Word itself writes for a
// restart — ONE list, a second numbering instance (LFO) with a start-at override — IS read correctly, and is pinned below.
test('row 30: a Word-style restart (a second LFO on the same list with a start-at override) and "start at 5" number as the .docx twin does', async () => {
  const spec = {
    lists: { 1: [{ fmt: 'decimal', text: '%1.' }], 2: { like: 1, start: 1 }, 3: { like: 1, start: 5 } },
    body: [{ p: 'a1', list: { id: 1, level: 0 } }, { p: 'a2', list: { id: 1, level: 0 } }, { p: 'b1', list: { id: 2, level: 0 } }, { p: 'b2', list: { id: 2, level: 0 } },
      { p: 'Interrupting paragraph.' }, { p: 'a3', list: { id: 1, level: 0 } }, { p: 'c1', list: { id: 3, level: 0 } }, { p: 'c2', list: { id: 3, level: 0 } }],
  };
  const { doc, docx } = await twins(spec);
  assert.deepEqual(markers(docx), ['1.', '2.', '1.', '2.', '3.', '5.', '6.'], 'the .docx reader (the reference)');
  assert.deepEqual(markers(doc), markers(docx));
  assert.deepEqual(norm(doc), norm(docx));
});

test('row 30: LibreOffice\'s .doc export writes a restarted list as two lists; the reader follows the file (as Word and LibreOffice itself read it)', async () => {
  const { readFileSync } = await import('node:fs');
  const b = readFileSync(new URL('./fixtures/import-audit/doc/lo-w08-lists.doc', import.meta.url));
  const m = await parseDoc(u8ab(new Uint8Array(b)));
  const num = (tok) => { for (const bl of m.blocks) for (const it of bl.items || []) if (flat(it) === tok) return it.marker; return undefined; };
  assert.equal(num('alpharestart1'), '1.');
  assert.equal(num('alpharestart2'), '1.', 'a different list in the file (LFO 3, not LFO 9), so it starts at its own start value');
  assert.equal(num('alphastart5a'), '5.');
  assert.equal(num('alphastart5b'), '1.');
  assert.equal(num('alphacont2'), '4.', 'the first list goes on after an interrupting paragraph');
});

// =====================================================================================================
// Row 31 (.doc part): Equation Editor / MathType equations — functions and brackets, as the Word (OMML) reader writes them
// =====================================================================================================
// Paul's Word-equation decision (A84, import fix list #31): a function name (sin, cos, log, lim ...) is <mi>name</mi> followed by U+2061
// (function application), never <mtext>; brackets are stretchy fences <mo fence="true" stretchy="true">; UEB puts a space between a
// subscript ending in a letter and a function name after it (Guidelines for Technical Material 9.3.3). omml.mjs did this for Word;
// mtef.mjs (.doc, and .docx objects) still wrote <mtext>sin</mtext> and plain brackets.
const { mtefToMathML } = await import(process.env.MTEF_MJS || '../input/mtef.mjs');
const { ommlElementToMathML } = await import('../input/omml.mjs');
const { mathmlToLatex } = await import('../engine/mathml-to-latex.mjs');
const { v3, v5, FACE } = await import('./helpers/mtef-writer.mjs');
const { makeMathToBrf } = await import('../format/node-maths-helper.mjs');
const ueb = makeMathToBrf('ukaaf'), nemeth = makeMathToBrf('bana');
const AF = '\u2061';
const M = (inner) => `<math display="block">${inner}</math>`;
const conv = (bytes) => mtefToMathML(new Uint8Array(bytes));
const X3 = (c) => v3.char(FACE.VARIABLE, c), N3 = (c) => v3.char(FACE.NUMBER, c), S3 = (c) => v3.char(FACE.SYMBOL, c);
const X5 = (c) => v5.char(FACE.VARIABLE, c), N5 = (c) => v5.char(FACE.NUMBER, c), S5 = (c) => v5.char(FACE.SYMBOL, c);
const OM = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const fromOmml = (inner) => ommlElementToMathML(new DOMParser().parseFromString(`<m:oMath xmlns:m="${OM}">${inner}</m:oMath>`, 'application/xml').documentElement);
const mr = (t, plain = false) => `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<m:t>${t}</m:t></m:r>`;
const mfunc = (name, arg) => `<m:func><m:fName>${mr(name, true)}</m:fName><m:e>${arg}</m:e></m:func>`;

test('row 31: a function name in the Function style (Equation Editor 3.0 and MathType) is <mi> + function application, as Word\'s m:func', () => {
  const v3eq = v3.eqn(v3.line(v3.chars(FACE.FUNCTION, 'sin'), X3('x')));
  const v5eq = v5.eqn(v5.line(v5.char(FACE.FUNCTION, 's', { funcStart: true }), v5.chars(FACE.FUNCTION, 'in'), X5('x')));
  const want = fromOmml(mfunc('sin', mr('x')));
  assert.equal(want, M(`<mrow><mi>sin</mi><mo>${AF}</mo><mi>x</mi></mrow>`), 'the reference: what the Word reader gives');
  assert.equal(conv(v3eq), want);
  assert.equal(conv(v5eq), want);
});

test('row 31: a function name typed in the Text style (how LibreOffice Math writes it) is a function too, with or without a power or subscript', () => {
  assert.equal(conv(v3.eqn(v3.line(v3.chars(FACE.TEXT, 'cos'), X3('x')))), M(`<mrow><mi>cos</mi><mo>${AF}</mo><mi>x</mi></mrow>`));
  // log base 2 of x: the subscript belongs to the name (Word: m:func with a scripted m:fName)
  const log2 = v3.eqn(v3.line(v3.chars(FACE.TEXT, 'log'), v3.tmpl(15, 0, v3.line(N3('2')), v3.nullLine()), X3('x')));
  assert.equal(conv(log2), fromOmml(`<m:func><m:fName><m:sSub><m:e>${mr('log', true)}</m:e><m:sub>${mr('2')}</m:sub></m:sSub></m:fName><m:e>${mr('x')}</m:e></m:func>`));
  assert.equal(mathmlToLatex(conv(log2)).replace(/\s+/g, ''), '\\log_{2}x');
  // sin squared x
  assert.equal(conv(v3.eqn(v3.line(v3.chars(FACE.FUNCTION, 'sin'), v3.tmpl(15, 0, v3.nullLine(), v3.line(N3('2'))), X3('x')))),
    M(`<mrow><msup><mi>sin</mi><mn>2</mn></msup><mo>${AF}</mo><mi>x</mi></mrow>`));
});

test('row 31: a Text-style word that is not exactly a function name stays text; a function with no argument after it has no function application', () => {
  assert.match(conv(v3.eqn(v3.line(X3('x'), S3('='), N3('2'), v3.chars(FACE.TEXT, ' if '), X3('y')))), /<mtext>\u00A0if\u00A0<\/mtext>/);
  assert.equal(conv(v3.eqn(v3.line(v3.chars(FACE.TEXT, 'sine'), X3('x')))), M('<mrow><mtext>sine</mtext><mi>x</mi></mrow>'));
  assert.equal(conv(v3.eqn(v3.line(v3.chars(FACE.FUNCTION, 'sin')))), M('<mi>sin</mi>'), 'a bare name');
  assert.equal(conv(v3.eqn(v3.line(v3.chars(FACE.FUNCTION, 'sin'), S3('='), N3('0')))), M('<mrow><mi>sin</mi><mo>=</mo><mn>0</mn></mrow>'), 'a name before an operator has no argument');
});

test('row 31: a function written with brackets, sin(x), applies to the bracketed argument', () => {
  const eq = v3.eqn(v3.line(v3.chars(FACE.FUNCTION, 'sin'), v3.tmpl(1, 0, v3.line(X3('x')), S3('('), S3(')'))));
  assert.equal(conv(eq), M(`<mrow><mi>sin</mi><mo>${AF}</mo><mrow><mo fence="true" stretchy="true">(</mo><mi>x</mi><mo fence="true" stretchy="true">)</mo></mrow></mrow>`));
});

test('row 31: a limit, lim as a limit template (MTEF 3 selector 39) and LibreOffice\'s lim written as the operator of a summation-style template, is lim, not a sum', () => {
  const want = M(`<mrow><munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mo>${AF}</mo><mi>f</mi></mrow>`);
  assert.equal(conv(v3.eqn(v3.line(v3.tmpl(39, 1, v3.line(v3.chars(FACE.FUNCTION, 'lim')), v3.line(X3('x'), S3('→'), N3('0')), v3.nullLine()), X3('f')))), want);
  // LibreOffice: template 43 (main, lower, upper, then the operator's own characters "lim" + a spacing character)
  const lo = v3.eqn(v3.line(v3.tmpl(43, 1, v3.nullLine(), v3.line(X3('x'), S3('→'), N3('0')), v3.nullLine(), v3.line(v3.chars(FACE.FUNCTION, 'lim'), v3.char(FACE.SPACE, 0xEB04))), X3('f')));
  assert.equal(conv(lo), want);
  assert.doesNotMatch(conv(lo), /∑/);
  assert.equal(mathmlToLatex(conv(lo)).replace(/\s+/g, ''), '\\lim_{x\\to0}f');
});

test('row 31: a bracket template is a stretchy fence (as Word\'s m:d); a missing bracket is an empty fence', () => {
  const round = conv(v3.eqn(v3.line(v3.tmpl(1, 0, v3.line(X3('a'), S3('+'), X3('b')), S3('('), S3(')')))));
  assert.equal(round, fromOmml(`<m:d><m:e>${mr('a')}${mr('+')}${mr('b')}</m:e></m:d>`));
  assert.equal(mathmlToLatex(round).replace(/\s+/g, ''), '\\left(a+b\\right)');
  // a brace on the left only (selector 2, variation 2 = no right bracket)
  const left = conv(v3.eqn(v3.line(v3.tmpl(2, 1, v3.line(X3('x')), S3('{'), S3('}')))));
  assert.match(left, /<mo fence="true" stretchy="true">\{<\/mo><mi>x<\/mi><mo fence="true" stretchy="true"><\/mo>/);
  // MathType (MTEF 5) brackets, round, square, bars
  for (const [sel, l, r, ch1, ch2] of [[1, '(', ')', '(', ')'], [3, '[', ']', '[', ']'], [4, '|', '|', '|', '|']]) {
    const m5 = conv(v5.eqn(v5.line(v5.tmpl(sel, 3, v5.line(X5('x')), S5(ch1), S5(ch2)))));
    assert.equal(m5, M(`<mrow><mo fence="true" stretchy="true">${l}</mo><mi>x</mi><mo fence="true" stretchy="true">${r}</mo></mrow>`), `selector ${sel}`);
  }
  // a bracket TYPED as a character (not a template) is not a fence: nothing in the equation says it stretches
  assert.equal(conv(v3.eqn(v3.line(X3('f'), S3('('), X3('x'), S3(')')))), M('<mrow><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo></mrow>'));
});

test('row 31 (braille): UEB puts a space between a subscript ending in a letter and the function name after it, as for Word; Nemeth is as the Word equation', () => {
  // a_n cos x
  const eq = v3.eqn(v3.line(X3('a'), v3.tmpl(15, 0, v3.line(X3('n')), v3.nullLine()), v3.chars(FACE.FUNCTION, 'cos'), X3('x')));
  const mml = conv(eq);
  assert.match(mml, /<msub><mi>a<\/mi><mi>n<\/mi><\/msub><mspace width="0\.3em"\/><mi>cos<\/mi>/);
  const word = fromOmml(`<m:sSub><m:e>${mr('a')}</m:e><m:sub>${mr('n')}</m:sub></m:sSub>${mfunc('cos', mr('x'))}`);
  assert.equal(ueb(mml), ueb(word), 'UEB braille is the Word equation\'s');
  assert.equal(nemeth(mml), nemeth(word), 'Nemeth braille is the Word equation\'s');
  const plainMml = mml.replace('<mspace width="0.3em"/>', '');
  // 1 Oct 2026 (A84 for every reader; tests/mathml_function_space.test.mjs): the space is now also added to any equation just before
  // MathCAT in UEB, so the MathML without the reader's own <mspace> brailles the same (was: notEqual — "without the space the subscript
  // n runs into cos in UEB").
  assert.equal(ueb(plainMml), ueb(mml), 'the space is added before MathCAT for any equation, so the result is the same');
  // a subscript that is a digit needs no space
  const digit = conv(v3.eqn(v3.line(X3('a'), v3.tmpl(15, 0, v3.line(N3('2')), v3.nullLine()), v3.chars(FACE.FUNCTION, 'cos'), X3('x'))));
  assert.doesNotMatch(digit, /<mspace/);
});

// =====================================================================================================
// Row 11 (.doc part) + IMP-W12: pictures — alt text, captions, floating pictures, the no-description warning
// =====================================================================================================
const { RED, BLUE } = await import('./fixtures/doc/specs.mjs');
test('row 11: a picture\'s alt text (the shape\'s wzDescription), a Caption-style paragraph after it, a floating picture and its alt text: the .doc gives the .docx twin\'s model', async () => {
  const spec = {
    body: [
      { p: ['Inline: ', { image: { png: RED, alt: 'A red square' } }] },
      { p: 'Figure 1: the red square', style: 'caption' },
      { floatImage: { png: BLUE, alt: 'Blue bar' } },
      { p: 'Text after the floating picture.' },
      { p: [{ image: { png: RED } }] },                        // no description at all
      { p: [{ image: { png: BLUE, alt: 'Two pictures, one paragraph' } }, { image: { png: RED, alt: 'second one' } }] },
      { p: 'Figure 2: both', style: 'caption' },
    ],
  };
  const { doc, docx } = await twins(spec);
  const g = (m) => m.blocks.filter((b) => b.type === 'graphic').map((b) => [b.alt, b.caption ?? null, b.decorative ?? null]);
  assert.deepEqual(g(docx), [['A red square', 'Figure 1: the red square', null], ['Blue bar', null, null], ['', null, null], ['Two pictures, one paragraph', null, null], ['second one', 'Figure 2: both', null]], 'the .docx reader (the reference)');
  assert.deepEqual(g(doc), g(docx));
  assert.deepEqual(norm(doc), norm(docx));
});

test('row 11 / IMP-W12: a .doc picture with no description raises the same transcription warning as its .docx twin; with a description or a caption it does not', async () => {
  const { formatDocument } = await import('../format/document.mjs');
  const up = (s) => String(s || '').toUpperCase();
  const warn = async (model) => { const o = { mode: 'bana', width: 30, depth: 25, translate: up }; formatDocument(model, o); return (o.warnings || []).filter((w) => w.kind === 'picture-no-description').map((w) => w.blockIndex); };
  const spec = { body: [{ p: [{ image: { png: RED } }] }, { p: [{ image: { png: BLUE, alt: 'A blue bar' } }] }, { p: [{ image: { png: RED } }] }, { p: 'Figure 1: captioned', style: 'caption' }, { p: 'end' }] };
  const { doc, docx } = await twins(spec);
  assert.deepEqual(await warn(docx), [0], 'the .docx reader (the reference): only the first picture is undescribed and uncaptioned');
  assert.deepEqual(await warn(doc), await warn(docx));
});

test('row 11: a picture\'s own name is its alt text only when it is not Word\'s automatic name ("Picture 3"), as the .docx reader reads docPr name', async () => {
  // a named shape with no description: doc-art.mjs makeImage uses wzName unless it is "Picture 3" / "Image 2" ... (parse.mjs DOCX_DEFAULT_PICTURE_NAME_RE)
  const { readFileSync } = await import('node:fs');
  const b = readFileSync(new URL('./fixtures/import-audit/doc/lo-w13-images.doc', import.meta.url));
  const m = await parseDoc(u8ab(new Uint8Array(b)));
  const g = m.blocks.filter((x) => x.type === 'graphic');
  assert.equal(g.length, 6, 'all six pictures of the LibreOffice-written file arrive, inline and floating');
  assert.ok(g.every((x) => x.src && m.resources.some((r) => r.path === x.src)));
  assert.equal(g[3].caption, 'Figure 1: alphacaption text for the figure', 'the Caption-style paragraph after the picture');
});

// =====================================================================================================
// Checklist section 7 (the UNKNOWN / PARTIAL rows of "Word 97-2003 .doc")
// =====================================================================================================
test('checklist: a table inside a footnote keeps every cell\'s text (as paragraphs of the note, as the .docx reader reads a table in a note)', async () => {
  const spec = { body: [{ p: ['Text', { footnote: [{ p: 'Before the table.' }, { table: [['a1', 'b1'], ['a2', 'b2']] }, { p: 'After the table.' }] }, ' end.'] }] };
  const { doc, docx } = await twins(spec);
  const note = (m) => m.blocks.find((b) => b.type === 'footnote');
  assert.deepEqual(note(docx).blocks.map(flat), ['Before the table.', 'a1', 'b1', 'a2', 'b2', 'After the table.'], 'the .docx reader (the reference)');
  assert.deepEqual(note(doc).blocks.map(flat), note(docx).blocks.map(flat));
  assert.deepEqual(norm(doc), norm(docx));
  assert.equal(doc.blocks.filter((b) => b.type === 'table').length, 0, 'a note cannot hold a table: no table block is made');
});

test('checklist: ordinary letters in a Symbol-font run are what print shows, Greek (ab = αβ, ABC = ΑΒΧ); digits and spaces stay; another font is left alone', async () => {
  const m = await readDoc({ body: [{ p: ['Greek: ', { text: 'ab', font: 'Symbol' }, ' and ', { text: 'ABC 12', font: 'Symbol' }, ' but ', { text: 'ab', font: 'Arial' }] }] });
  assert.equal(flat(m.blocks[0]), 'Greek: αβ and ΑΒΧ 12 but ab');
  assert.equal(m.warnings, undefined);
});

test('checklist: ordinary characters in a Wingdings run are shapes: an unmapped one is U+FFFD and named in the load warning (as a Wingdings symbol typed with Insert Symbol); spaces stay', async () => {
  const m = await readDoc({ body: [{ p: ['x ', { text: 'l ', font: 'Wingdings' }, 'y'] }] });
  assert.equal(flat(m.blocks[0]), 'x \uFFFD y');
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /1 symbol typed in a symbol font \(Wingdings F06C\)/);
});

test('checklist: a check-box form field is [x] when ticked and [ ] when not, where it stands in the text (HTML\'s form; the state was lost before)', async () => {
  const m = await readDoc({ body: [
    { p: ['Before: ', { checkbox: { checked: true } }, ' ticked then ', { checkbox: { checked: false } }, ' empty.'] },
    { p: [{ checkbox: { checked: true, separator: true } }, ' Option A'] },                    // LibreOffice writes an empty result part
    { p: [{ checkbox: { checked: false, separator: true } }, ' Option B'] },
    { p: [{ checkbox: { res: 25, def: true } }, ' default on, never toggled'] },                 // iRes 25: the form field has no result yet; wDef applies
    { p: [{ checkbox: { res: 25, def: false } }, ' default off'] },
  ] });
  assert.deepEqual(m.blocks.map(flat), ['Before: [x] ticked then [ ] empty.', '[x] Option A', '[ ] Option B', '[x] default on, never toggled', '[ ] default off']);
});

test('checklist: a drop-down form field is its selected item (HTML\'s <select>); none chosen and no default: nothing; Word\'s and LibreOffice\'s layouts', async () => {
  const items = ['Apple', 'Banana', 'Cherry'];
  const m = await readDoc({ body: [
    { p: ['Fruit: ', { dropdown: { items, selected: 1 } }, ' end.'] },
    { p: ['LibreOffice layout: ', { dropdown: { items, selected: 2, lo: true } }, '.'] },
    { p: ['Never chosen, default the first: ', { dropdown: { items, res: 25, def: 0 } }, '.'] },
    { p: ['Never chosen, default the third: ', { dropdown: { items, res: 25, def: 2 } }, '.'] },
    { p: ['Out of range: ', { dropdown: { items, res: 9 } }, '.'] },
  ] });
  assert.deepEqual(m.blocks.map(flat), ['Fruit: Banana end.', 'LibreOffice layout: Cherry.', 'Never chosen, default the first: Apple.', 'Never chosen, default the third: Cherry.', 'Out of range: .']);
});

test('checklist: a damaged or unknown form field keeps the text around it and does not throw', async () => {
  const m = await readDoc({ body: [{ p: ['a ', { checkbox: { checked: true, bad: true } }, ' b'] }] });   // the form data's offset is past the end of the Data stream
  assert.equal(flat(m.blocks[0]), 'a b');
  const text = await readDoc({ body: [{ p: ['a ', { field: 'FORMTEXT', result: 'typed' }, ' b'] }] });
  assert.equal(flat(text.blocks[0]), 'a typed b', 'a text form field is its result text, as before');
});

test('checklist: the real LibreOffice-written files: check boxes, a drop-down and a text field of a .doc written from a Word form', async () => {
  const { readFileSync } = await import('node:fs');
  const read = async (n) => parseDoc(u8ab(new Uint8Array(readFileSync(new URL(`./fixtures/import-audit/doc/${n}`, import.meta.url)))));
  assert.deepEqual((await read('lo-checkbox.doc')).blocks.map(flat), ['Before: [x] ticked box then [ ] empty box end.', '[x] Option A', '[ ] Option B']);
  assert.deepEqual((await read('lo-forms.doc')).blocks.map(flat), ['Fruit: Banana end.', 'Name: Typed answer done.']);
});

test('row 1: the older .doc form, the bare Wingdings byte, is that font\'s shape too; an unmapped Wingdings shape is the plain dot and raises no symbol warning', async () => {
  const m = await readDoc({ lists: { 1: [{ fmt: 'bullet', text: 'Ø', font: 'Wingdings' }], 2: [{ fmt: 'bullet', text: '§', font: 'Wingdings' }], 3: [{ fmt: 'bullet', text: PUA(0x76), font: 'Wingdings' }], 4: [{ fmt: 'bullet', text: 'Ø', font: 'Arial' }] },
    body: [1, 2, 3, 4].map((id) => ({ p: `item ${id}`, list: { id, level: 0 } })) });
  assert.deepEqual(markers(m), ['➢', '■', '•', '•'], 'Ø in Wingdings is the arrowhead, § the small square; Ø in an ordinary font is just a letter-like sign, not a bullet shape');
  assert.equal(m.warnings, undefined, 'a bullet shape with no table entry is silently the plain dot (as the .docx reader)');
});

test('row 1 (braille): a .doc arrow bullet is a transcriber-defined symbol in BANA, listed on the Special Symbols page; UKAAF keeps the ordinary bullet', async () => {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { formatDocument } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
  const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
  const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
  const m = await readDoc({ lists: { 1: [{ fmt: 'bullet', text: PUA(0xD8), font: 'Wingdings' }] }, body: [{ p: 'Apples', list: { id: 1, level: 0 } }, { p: 'Pears', list: { id: 1, level: 0 } }] });
  const base = { width: 40, depth: 25, translate, translatePos, suppressHeader: true };
  const lines = (brf) => brf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bana = lines(formatDocument({ ...m, blocks: [...m.blocks, { type: 'sympage', auto: true }] }, { ...base, mode: 'bana', standard: 'bana' }));
  assert.ok(bana.includes(`;? ${translate('Apples')}`) && bana.includes(`;? ${translate('Pears')}`), bana.join('\n'));
  assert.ok(bana.includes(`.=;? ${translate('Arrow bullet')}`), bana.join('\n'));
  const ukaaf = lines(formatDocument(m, { ...base, mode: 'ukaaf', standard: 'ukaaf', docEndMarker: false }));
  assert.ok(ukaaf.includes(`_4 ${translate('Apples')}`), ukaaf.join('\n'));
});
