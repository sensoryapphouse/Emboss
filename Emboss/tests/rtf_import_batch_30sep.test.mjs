// RTF import batch (Paul's import fix list, 30 Sep 2026): #15a, #17, #18, #19, #15c, #12, small caps / underline kinds /
// strikethrough / script font, #1e (RTF text boxes), #11 (pictures), and the LibreOffice equations that arrive as a picture only.
// The standards behind the choices: RTF 1.9.1 (a backslash and a line break is \par; \listtable / \ls / \ilvl; \uN with \ucN;
// \fcharsetN and \ansicpgN; \shp / \shptxt / \do; \pict and \picprop; \v; \deleted), RUEB 9.6.1 (small capitals are best
// transcribed as capitals), RUEB 11.4.1 (sub/superscript), BANA Formats 2016 10.3.3 (a further paragraph of a list item).
// The Word reader is the model for the representation (list items with marker + level, SCRIPT_MARKS, the strikethrough
// typeform, text boxes as boxes only when they have an outline); these tests pin that RTF comes out the same.
//
// Set RTF_PARSE_MODULE to another copy of the parser to run the same tests against it (used to show them failing before the change).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
const { parseRtf } = await import(process.env.RTF_PARSE_MODULE || '../input/parse.mjs');
const { SCRIPT_MARKS: M, styledTranslate } = await import('../format/text-style.mjs');
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(EMBOSS, 'tests/fixtures/import-audit/rtf');
const read = (name) => fs.readFileSync(path.join(FIX, name), 'latin1');

// \uN with its fallback, built so this file never holds a backslash-u followed by digits (an editor can turn those into the character)
const U = (n, fb = '?') => '\\' + 'u' + n + fb;
const doc = (body, header = '') => `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}${header} ${body}}`;
const paras = (m) => m.blocks.filter((b) => b.type === 'para').map((b) => b.text ?? (b.segments || []).map((g) => g.text || '').join(''));
const textOf = (b) => b.text ?? (b.segments || []).map((g) => g.text || '').join('');
const listItems = (m) => m.blocks.filter((b) => b.type === 'list').flatMap((b) => b.items);
const itemText = (it) => it.text ?? (it.segments || []).map((g) => g.text || '').join('');
const summary = (items) => items.map((it) => `${it.marker}|${it.level || 0}|${itemText(it)}`);

// ------------------------------------------------------------------------------------------------------------ #15a
test('#15a: a backslash and a line break is \\par (Cocoa/TextEdit ends every paragraph that way)', () => {
  const m = parseRtf(doc('one\\\ntwo\\\r\nthree\\par'));
  assert.deepEqual(paras(m), ['one', 'two', 'three']);
});

test('#15a/#17: a TextEdit-written list keeps every item, with its level and marker (Pandoc list_simple read "onetwosubnew list")', () => {
  const m = parseRtf(read('textedit-lists.rtf'));
  assert.deepEqual(summary(listItems(m)), [
    '•|0|one', '•|0|two', '•|1|sub one', '•|1|sub two',           // bullets: the dot, nested one level
    '1|0|first', '2|0|second', '1|1|inner a', '3|0|third',          // the numbers TextEdit wrote (no full stop in its level text)
  ]);
  assert.equal(paras(m)[0], 'Intro');
});

// ------------------------------------------------------------------------------------------------------------ #17
test('#17: a LibreOffice-written list (Symbol, Courier and Wingdings bullets, a/i/legal numbering, a second paragraph in an item)', () => {
  const m = parseRtf(read('lo-w08-lists.rtf'));
  const items = listItems(m);
  const find = (t) => items.find((it) => itemText(it) === t);
  // the Symbol bullet (\u-3913 in a Symbol-font level) is a real bullet, not "?".
  // Changed 17 Oct 2026 (APH feedback point 15, Paul: 15a): Word's default nested bullets - Courier "o" at level 2, Wingdings' square at level 3 - are the ordinary bullet at those levels (were the hollow circle and the solid square).
  assert.deepEqual([find('alphabullet1'), find('alphabullet2'), find('alphabullet3'), find('alphabullet4')].map((it) => `${it.marker}|${it.level || 0}`), ['•|0', '•|1', '•|2', '•|0']);
  assert.deepEqual(['alphanum1', 'alphanum2', 'alphanum3', 'alphanum4', 'alphanum5', 'alphanum6'].map((t) => `${find(t).marker}|${find(t).level || 0}`),
    ['1.|0', 'a.|1', 'i.|2', 'ii.|2', 'b.|1', '2.|0']);
  assert.deepEqual(['alphalegal1', 'alphalegal11', 'alphalegal111', 'alphalegal112', 'alphalegal12', 'alphalegal2'].map((t) => `${find(t).marker}|${find(t).level || 0}`),
    ['1.|0', '1.1|1', '1.1.1|2', '1.1.2|2', '1.2|1', '2.|0']);
  assert.deepEqual(['alphaupper1', 'alphaupper2', 'alphaupper3'].map((t) => find(t).marker), ['(A)', 'I)', '1)']);
  // custom bullets go through the Word reader's bullet table: the tick is a known bullet, the arrow and the dash are the dot
  // Changed 30 Sep (merging the formatter batch): Paul's IMP-W7 keeps a custom bullet's print shape (arrow ➢, dash –) instead of
  // folding it to the ordinary bullet; BANA brailles it as a transcriber-defined symbol listed on the Special Symbols page.
  assert.deepEqual(['alphacustom1', 'alphacustom2', 'alphacustom3'].map((t) => find(t).marker), ['➢', '✓', '–']);
  // the second paragraph of an item stays part of the item (BANA 10.3.3), not a paragraph of its own
  const multi = find('alphamulti1');
  assert.equal(multi.marker, '7.');
  assert.deepEqual((multi.blocks || []).map(textOf), ['Second paragraph of item one alphamultib.']);
  assert.ok(!paras(m).some((t) => /Second paragraph of item one/.test(t)), 'no paragraph of its own');
  assert.equal(find('alphamulti2').marker, '8.');
  // "no private-use character" is left as a marker
  assert.ok(items.every((it) => !/[-]/.test(it.marker)), items.map((it) => it.marker).join(' '));
});

test('#17: a Word-style list (\\listtext with Symbol \\\'b7, Courier o, Wingdings \\\'a7) and its levels', () => {
  const m = parseRtf(read('r02-lists-tables.rtf'));
  const items = listItems(m);
  // Changed 17 Oct 2026 (APH feedback point 15, Paul: 15a): Word's default nested bullets - Courier "o" at level 2, Wingdings' square at level 3 - are the ordinary bullet at those levels (were the hollow circle and the solid square).
  assert.deepEqual(summary(items.slice(0, 4)), ['•|0|alphabullet1', '•|1|alphabullet2', '•|2|alphabullet3', '•|0|alphabullet4']);
  assert.deepEqual(summary(items.slice(4, 9)), ['1.|0|alphanum1', 'a.|1|alphanum2', 'i.|2|alphanum3', 'b.|1|alphanum4', '2.|0|alphanum5']);
});

const LISTS = '{\\*\\listtable'
  + '{\\list\\listtemplateid1{\\listlevel\\levelnfc0\\levelstartat1{\\leveltext\\\'02\\\'00.;}{\\levelnumbers\\\'01;}}{\\listlevel\\levelnfc4\\levelstartat1{\\leveltext\\\'02\\\'01.;}{\\levelnumbers\\\'01;}}{\\listlevel\\levelnfc2\\levelstartat1{\\leveltext\\\'02\\\'02.;}{\\levelnumbers\\\'01;}}\\listid1}'
  + '{\\list\\listtemplateid2{\\listlevel\\levelnfc23\\levelstartat1{\\leveltext\\\'01' + U(61623) + ';}{\\levelnumbers;}\\f3}\\listid2}'
  + '{\\list\\listtemplateid3{\\listlevel\\levelnfc3\\levelstartat1{\\leveltext\\\'03(\\\'00);}{\\levelnumbers\\\'02;}}{\\listlevel\\levelnfc0\\levelstartat1\\levellegal{\\leveltext\\\'03\\\'00.\\\'01;}{\\levelnumbers\\\'01\\\'03;}}\\listid3}'
  + '}{\\*\\listoverridetable{\\listoverride\\listid1\\listoverridecount0\\ls1}{\\listoverride\\listid2\\listoverridecount0\\ls2}'
  + '{\\listoverride\\listid1\\listoverridecount1{\\lfolevel\\listoverridestartat\\levelstartat5}\\ls3}{\\listoverride\\listid3\\listoverridecount0\\ls4}}';
const LIST_FONTS = '{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}{\\f1\\fnil\\fcharset2 Symbol;}{\\f3\\fnil\\fcharset2 Symbol;}{\\f4\\fnil\\fcharset2 Wingdings;}}';
const listDoc = (body) => `{\\rtf1\\ansi\\ansicpg1252\\deff0${LIST_FONTS}${LISTS} ${body}}`;

test('#17: \\ls + \\ilvl against the list table give the marker and level with NO written label (numbers, letters, roman, bullet, start-at)', () => {
  const m = parseRtf(listDoc('\\pard\\ls1\\ilvl0 one\\par\\pard\\ls1\\ilvl1 two\\par\\pard\\ls1\\ilvl2 three\\par\\pard\\ls1\\ilvl0 four\\par'
    + '\\pard\\ls2\\ilvl0 bullet\\par\\pard\\ls3\\ilvl0 five\\par\\pard\\ls3\\ilvl0 six\\par'
    + '\\pard\\ls4\\ilvl0 legal\\par\\pard\\ls4\\ilvl1 legal two\\par'));
  assert.deepEqual(summary(listItems(m)), [
    '1.|0|one', 'a.|1|two', 'i.|2|three', '2.|0|four', '•|0|bullet',
    '5.|0|five', '6.|0|six',                                   // a list override that restarts at 5
    '(A)|0|legal', '1.1|1|legal two',                          // the level text "(%1)"; a legal level shows its numbers as decimals
  ]);
});

test('#17: the older \\pntext / \\pn form (Word 6-97, Pandoc\'s writer): nesting by \\pnlvlN, bullets through the font', () => {
  const m = parseRtf(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f1\\fnil\\fcharset2 Symbol;}} `
    + '\\pard{\\pntext\\f0 1.\\tab}{\\*\\pn\\pnlvlbody\\pnf0\\pnindent0\\pnstart1\\pndec{\\pntxta.}} first\\par'
    + '\\pard{\\pntext\\f0 2.\\tab}{\\*\\pn\\pnlvlbody\\pnf0\\pnindent0\\pnstart1\\pndec{\\pntxta.}} second\\par'
    + '\\pard{\\pntext\\f1\\\'b7\\tab}{\\*\\pn\\pnlvlblt\\pnf1\\pnindent360{\\pntxtb\\\'b7}} dot\\par}');
  assert.deepEqual(summary(listItems(m)), ['1.|0|first', '2.|0|second', '•|0|dot']);
  // a file that writes no label at all: the \\pn group alone says what the paragraph is (a bullet; numbers from \\pnstart)
  const bare = parseRtf(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f1\\fnil\\fcharset2 Symbol;}} `
    + '\\pard{\\pn\\pnlvlblt\\pnf1\\pnindent360{\\pntxtb\\\'b7}} dot\\par'
    + '\\pard{\\pn\\pnlvlbody\\pnf0\\pnstart3\\pndec{\\pntxta.}} three\\par\\pard{\\pn\\pnlvlbody\\pnf0\\pnstart3\\pndec{\\pntxta.}} four\\par}');
  assert.deepEqual(summary(listItems(bare)), ['•|0|dot', '3.|0|three', '4.|0|four']);
});

test('#17: where a file writes labels, a list paragraph WITHOUT one is not numbered: the item before it continues (Pandoc\'s list_multiparagraph.rtf)', () => {
  const m = parseRtf('{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}'
    + '{\\*\\listtable{\\list\\listtemplateid1{\\listlevel\\levelnfc23\\levelstartat1{\\leveltext\\\'01\\uc0' + U(8226, ' ') + ';}{\\levelnumbers;}\\fi-360\\li720\\lin720 }{\\listname ;}\\listid1}}'
    + '{\\*\\listoverridetable{\\listoverride\\listid1\\listoverridecount0\\ls1}}\n'
    + '\\pard\\li720\\fi-360\n\\ls1\\ilvl0 {\\listtext\\tab ' + U(8226, ' ') + '\\tab}First item, paragraph one.\\par\n'
    + '\\pard\\li720\\fi-360\n\\ls1\\ilvl0 First item, paragraph two.\\par\n'
    + '\\pard\\li720\\fi-360\n\\ls1\\ilvl0 {\\listtext\\tab ' + U(8226, ' ') + '\\tab}Second item.\\par\n}');
  const items = listItems(m);
  assert.deepEqual(items.map(itemText), ['First item, paragraph one.', 'Second item.']);
  assert.deepEqual((items[0].blocks || []).map(textOf), ['First item, paragraph two.']);
});

test('#17: a numbered heading stays a heading, its number starting the text (as the Word reader)', () => {
  const m = parseRtf(`{\\rtf1\\ansi\\deff0{\\stylesheet{\\s1\\outlinelevel0 heading 1;}}${LISTS} \\pard\\s1\\ls1\\ilvl0 Introduction\\par\\pard Body.\\par}`);
  assert.equal(m.blocks[0].type, 'heading');
  assert.equal(textOf(m.blocks[0]), '1. Introduction');
});

test('#17: a paragraph indented like the list text, straight after an item, is that item\'s further paragraph; an unindented one ends the list', () => {
  const m = parseRtf(listDoc('\\pard\\ls1\\ilvl0 item\\par\\pard\\li720 more of the item\\par\\pard\\ls1\\ilvl0 next\\par\\pard after the list\\par'));
  const items = listItems(m);
  assert.deepEqual(items.map(itemText), ['item', 'next']);
  assert.deepEqual((items[0].blocks || []).map(textOf), ['more of the item']);
  assert.deepEqual(paras(m), ['after the list']);
});

// ------------------------------------------------------------------------------------------------------------ #18
test('#18: \\sub \\super \\up \\dn \\nosupersub become the script markers (RUEB 11.4.1); a raised space marks nothing', () => {
  const m = parseRtf(doc('H{\\sub 2}O and x{\\super 2} and y\\up6 z\\up0 w\\dn6 q\\nosupersub r and a{\\super  }b{\\super two words}\\par'));
  assert.equal(textOf(m.blocks[0]), `H${M.subOpen}2${M.end}O and x${M.supOpen}2${M.end} and y${M.supOpen}z${M.end}w${M.subOpen}q${M.end}r and a b${M.supOpen}two words${M.end}`);
});

test('#18: a raised run in bold keeps both (the marker pair sits inside the bold segment)', () => {
  const m = parseRtf(doc('plain {\\b bold{\\super 2}}\\par'));
  const segs = m.blocks[0].segments;
  assert.ok(segs.some((g) => g.tf === 4 && g.text === `bold${M.supOpen}2${M.end}`), JSON.stringify(segs));
});

test('#18: braille: CO2 from RTF is CO with the subscript sign (the same as a Word file)', async () => {
  const path2 = path.join(EMBOSS, 'engine', 'louis.mjs');
  const louis = await import(path2);
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const tr = styledTranslate((t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null), 'faithful', (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null));
  const m = parseRtf(doc('CO{\\sub 2}\\par'));
  assert.equal(tr(textOf(m.blocks[0])), ',,CO;5#B');
});

// ------------------------------------------------------------------------------------------------------------ #19
test('#19: hidden text (\\v) and a tracked deletion (\\deleted) are not transcribed; a tracked insertion (\\revised) is kept', () => {
  const m = parseRtf(doc('before {\\v alphahidden} middle \\v hidden too\\v0  {\\deleted\\revauthdel1 alphadeleted} and {\\revised\\revauth1 alphainserted} end\\par'));
  assert.equal(textOf(m.blocks[0]), 'before middle and alphainserted end');
});

test('#19: a hidden footnote reference brings no note', () => {
  const m = parseRtf(doc('text{\\v{\\footnote\\pard hidden note\\par}} more\\par'));
  assert.ok(!m.blocks.some((b) => b.type === 'footnote'), JSON.stringify(m.blocks));
});

// ------------------------------------------------------------------------------------------------------------ #15c
const cp = (charset, body, head = '\\ansicpg1252') => parseRtf(`{\\rtf1\\ansi${head}\\deff0{\\fonttbl{\\f0\\fnil\\fcharset${charset} Font;}} \\pard ${body}\\par}`).blocks[0].text;

test('#15c: \\\'hh through the code page of the font\'s \\fcharset (and \\ansicpg for charset 0)', () => {
  assert.equal(cp(204, '\\\'cf\\\'f0\\\'e8\\\'e2\\\'e5\\\'f2'), 'Привет');                 // 1251 Cyrillic
  assert.equal(cp(0, '\\\'cf\\\'f0\\\'e8', '\\ansicpg1251'), 'При');                          // \ansicpg1251 and an ANSI-charset font
  assert.equal(cp(238, '\\\'e8\\\'f8'), 'čř');                                                 // 1250
  assert.equal(cp(161, '\\\'e1\\\'e2\\\'e3'), 'αβγ');                                          // 1253 Greek
  assert.equal(cp(162, '\\\'fd\\\'f0'), 'ığ');                                                 // 1254 Turkish
  assert.equal(cp(177, '\\\'e0\\\'e1'), 'אב');                                                 // 1255 Hebrew
  assert.equal(cp(178, '\\\'c7\\\'e1'), 'ال');                                                 // 1256 Arabic
  assert.equal(cp(186, '\\\'e0\\\'e8'), 'ąč');                                                 // 1257 Baltic
  assert.equal(cp(222, '\\\'a1\\\'d2'), 'กา');                                                 // 874 Thai
  assert.equal(cp(128, '\\\'82\\\'a0\\\'82\\\'a2'), 'あい');                                   // 932 Shift-JIS (two bytes a character)
  assert.equal(cp(134, '\\\'d6\\\'d0\\\'ce\\\'c4'), '中文');                                   // 936 GBK
  assert.equal(cp(129, '\\\'b0\\\'a1'), '가');                                                 // 949 Korean
  assert.equal(cp(136, '\\\'a4\\\'a4\\\'a4\\\'e5'), '中文');                                   // 950 Big5
  assert.equal(cp(77, '\\\'8a\\\'9f'), 'äü');                                                  // 10000 Mac Roman
});

test('#15c: one document can mix code pages by font; Latin text still reads as Windows-1252', () => {
  const m = parseRtf('{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}{\\f1\\fnil\\fcharset204 Arial;}} \\pard caf\\\'e9 {\\f1 \\\'cf\\\'f0} \\\'80\\par}');
  assert.equal(m.blocks[0].text, 'café Пр €');
});

test('#15c: \\uN with \\ucN (none, one, two bytes of fallback) and its group scope', () => {
  assert.equal(parseRtf(doc(`${U(1055)}${U(1088)} x\\par`)).blocks[0].text, 'Пр x');                                 // \uc1 by default: the ? is skipped
  assert.equal(parseRtf(doc(`\\uc0${U(1055, ' ')}${U(1088, ' ')}x\\par`)).blocks[0].text, 'Прx');  // \uc0: nothing follows to skip
  assert.equal(parseRtf(doc(`\\uc2${U(12354, '')}\\'82\\'a0z\\par`)).blocks[0].text, 'あz');                          // \uc2: two fallback bytes
  assert.equal(parseRtf(doc(`{\\uc0${U(233, ' ')}}\\uc1${U(233)}x\\par`)).blocks[0].text, 'ééx');                    // \uc is group-scoped
});

test('#15c: a Symbol-font byte is that font\'s glyph (the Word reader\'s Symbol table)', () => {
  const m = parseRtf('{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f3\\fnil\\fcharset2 Symbol;}} \\pard x{\\f3\\\'61\\\'62}y{\\f3 c}z\\par}');
  assert.equal(m.blocks[0].text, 'xαβyχz');                       // the bytes, and the bare character a Word SYMBOL field's result is
  const wd = parseRtf('{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f4\\fnil\\fcharset2 Wingdings;}} \\pard x{\\f4\\\'d8}y{\\f4\\\'21}\\par}');
  assert.equal(wd.blocks[0].text, 'x\u27A2y\uFFFD');   // Wingdings D8 is the arrowhead; a code with no known glyph is U+FFFD, listed in the load warning
  assert.ok(wd.warnings.some((w) => /symbol/.test(w)), JSON.stringify(wd.warnings));
});

// ------------------------------------------------------------------------------------------------------------ #12
test('#12: a surrogate pair written as two \\uN is ONE character (how Word writes an emoji)', () => {
  assert.equal(parseRtf(doc(`Hello ${U(-10179)}${U(-8704)} world\\par`)).blocks[0].text, 'Hello \u{1F600} world');
  assert.equal(parseRtf(doc(`${U(-10179, '')}\\'3f${U(-8704, '')}\\'3f\\par`)).blocks[0].text, '\u{1F600}');
  // a writer that gives the whole code point in one \\uN (not a 16-bit signed number) is read as that character too
  assert.equal(parseRtf(doc(`${U(128512, '?')} x\\par`)).blocks[0].text, '\u{1F600} x');
  // with a language on the run the two halves must not be split into two segments
  const m = parseRtf(doc(`\\lang1036\\langfe1041 a ${U(-10179)}${U(-8704)} b\\par`));
  const all = (m.blocks[0].segments || [m.blocks[0]]).map((g) => g.text).join('');
  assert.equal(all, 'a \u{1F600} b');
  assert.ok((m.blocks[0].segments || []).every((g) => !/[\uD800-\uDBFF]$/.test(g.text) && !/^[\uDC00-\uDFFF]/.test(g.text)), JSON.stringify(m.blocks[0]));
});

// ------------------------------------------------------------------------------------------------------------ run formatting
test('small caps and caps are capitals in braille (RUEB 9.6.1), as the Word reader does', () => {
  assert.equal(parseRtf(doc('a \\scaps small caps\\scaps0  b \\caps all caps\\caps0  c\\par')).blocks[0].text, 'a SMALL CAPS b ALL CAPS c');
});

test('every underline kind is underlined print (TF_UNDERLINE = 2); \\ulnone and \\ul0 end it', () => {
  for (const kind of ['ul', 'uldb', 'uld', 'ulw', 'ulwave', 'ulth', 'uldash', 'uldashd', 'uldashdd', 'ulhwave', 'ulldash', 'ulthd', 'ululdbwave', 'ulhair']) {
    const segs = parseRtf(doc(`a \\${kind} under\\ulnone  b\\par`)).blocks[0].segments;
    assert.ok(segs.some((g) => g.text === 'under' && (g.tf & 2) === 2), `${kind}: ${JSON.stringify(segs)}`);
    assert.ok(segs.some((g) => /b$/.test(g.text) && !g.tf), kind);
  }
  assert.ok(parseRtf(doc('\\ul x\\ul0  y\\par')).blocks[0].segments.some((g) => /y/.test(g.text) && !g.tf));
});

test('strikethrough (\\strike, \\striked1) is the strikethrough typeform', () => {
  const segs = parseRtf(doc('a \\strike one\\strike0  b \\striked1 two\\striked0  c\\par')).blocks[0].segments;
  assert.deepEqual(segs.filter((g) => g.transcriberTypeform === 'strike').map((g) => g.text), ['one', 'two']);
});

test('a script / handwriting font is the script typeform (TF_SCRIPT = 8), as SCRIPT_FONT_RE in the Word reader', () => {
  const m = parseRtf('{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f2\\fscript Brush Script MT;}{\\f3 Lucida Handwriting;}{\\f4 Courier New;}} \\pard plain {\\f2 brush} {\\f3 lucida} {\\f4 mono}\\par}');
  const segs = m.blocks[0].segments;
  assert.deepEqual(segs.filter((g) => (g.tf & 8) === 8).map((g) => g.text), ['brush', 'lucida']);
  assert.ok(segs.some((g) => /mono/.test(g.text) && !g.tf));
});

// ------------------------------------------------------------------------------------------------------------ #1e text boxes
test('#1e: a shape\'s text box keeps its text; a fallback (\\shprslt) copy is not read twice; with an outline it is a box', () => {
  const shape = (line) => `{\\shp{\\*\\shpinst\\shpleft0{\\sp{\\sn shapeType}{\\sv 202}}{\\sp{\\sn fLine}{\\sv ${line}}}{\\shptxt\\pard\\plain Box title\\par\\pard\\plain Words in the box\\par}}{\\shprslt Words again\\par}}`;
  const flat = parseRtf(doc(`Before ${shape(0)}after.\\par`));
  assert.deepEqual(flat.blocks.map(textOf), ['Box title', 'Words in the box', 'Before after.']);          // the box text in front of the anchor paragraph
  const boxed = parseRtf(doc(`Before ${shape(1)}after.\\par`));
  const box = boxed.blocks.find((b) => b.type === 'box');
  assert.ok(box, JSON.stringify(boxed.blocks));
  assert.equal(box.render, 'required');
  assert.deepEqual(box.blocks.map(textOf), ['Box title', 'Words in the box']);
  assert.ok(!JSON.stringify(boxed).includes('Words again'));
});

test('#1e: an old drawing object (\\do … \\dptxbx) keeps its text box; a solid line makes it a box', () => {
  const dob = (line) => `{\\*\\do\\dobxcolumn\\dobypara\\dodhgt8192\\dptxbx\\dpx0\\dpy0\\dpxsize2000\\dpysize500\\dpfillfgcr255\\${line}{\\dptxbxtext\\pard\\plain Old style box\\par}}`;
  const plain = parseRtf(doc(`${dob('dplinehollow')}Anchor.\\par`));
  assert.deepEqual(plain.blocks.map(textOf), ['Old style box', 'Anchor.']);
  const boxed = parseRtf(doc(`${dob('dplinesolid')}Anchor.\\par`));
  assert.equal(boxed.blocks[0].type, 'box');
  assert.ok(JSON.stringify(boxed.blocks[0]).includes('Old style box'));
});

test('#1e: a LibreOffice-written text box is read (its text was lost)', () => {
  const lo = path.join(FIX, 'lo-w11-boxes.rtf');
  const m = parseRtf(fs.readFileSync(lo, 'latin1'));
  assert.ok(JSON.stringify(m.blocks).includes('alphatextbox'));
});

// ------------------------------------------------------------------------------------------------------------ #11 pictures
const PNG = '89504e470d0a1a0a0000000d494844520000000800000008080200000012d2d8fb0000001249444154789c63fccfc0f0df0044c066160020d2cf5a6e0000000049454e44ae426082';
const pict = (props = '') => `{\\pict${props}\\picw8\\pich8\\picwgoal240\\pichgoal240\\pngblip\r\n${PNG}}`;

test('#11: a picture keeps its description (\\picprop wzDescription); wzName is not a description', () => {
  const m = parseRtf(doc(`${pict('{\\*\\picprop{\\sp{\\sn wzDescription}{\\sv A red square}}{\\sp{\\sn wzName}{\\sv Picture 1}}}')}\\par`));
  const g = m.blocks.find((b) => b.type === 'graphic');
  assert.equal(g.alt, 'A red square');
  assert.equal(m.resources.length, 1);
  const nameOnly = parseRtf(doc(`${pict('{\\*\\picprop{\\sp{\\sn wzDescription}{\\sv }}{\\sp{\\sn wzName}{\\sv Picture 1}}}')}\\par`));
  assert.equal(nameOnly.blocks.find((b) => b.type === 'graphic').alt, '');
});

test('#11: a picture written twice (\\shppict and \\nonshppict) is read once', () => {
  const both = `{\\*\\shppict${pict('{\\*\\picprop{\\sp{\\sn wzDescription}{\\sv Twice}}}')}}{\\nonshppict{\\pict\\picw8\\pich8\\wmetafile8 0100}}`;
  const m = parseRtf(doc(`See ${both} done.\\par`));
  assert.equal(m.blocks.filter((b) => b.type === 'graphic').length, 1);
  assert.equal(m.resources.length, 1);
  assert.equal(m.blocks.find((b) => b.type === 'graphic').alt, 'Twice');
  // only a \nonshppict (no shppict): read
  const only = parseRtf(doc(`{\\nonshppict${pict()}}\\par`));
  assert.equal(only.blocks.filter((b) => b.type === 'graphic').length, 1);
});

test('#11: a floating picture (a shape whose pib property is a picture) keeps the picture and the shape\'s description', () => {
  const shp = `{\\shp{\\*\\shpinst\\shpleft0{\\sp{\\sn shapeType}{\\sv 75}}{\\sp{\\sn wzDescription}{\\sv A red square}}{\\sp{\\sn pib}{\\sv ${pict()}}}}{\\shprslt ${pict()}}}`;
  const m = parseRtf(doc(`Text. ${shp} End.\\par`));
  const gs = m.blocks.filter((b) => b.type === 'graphic');
  assert.equal(gs.length, 1);
  assert.equal(gs[0].alt, 'A red square');
  assert.equal(m.resources.length, 1);
  // and the LibreOffice-written picture file: every description arrives
  const lo = parseRtf(read('lo-w13-images.rtf'));
  const alts = lo.blocks.filter((b) => b.type === 'graphic').map((b) => b.alt);
  assert.deepEqual(alts, ['alphaalttext a red square', 'alphatitlealt blue circle', '', 'alphacapimg figure', 'alphafloatalt small image', 'alphainlinealt']);
});

// ------------------------------------------------------------------------------------------------------------ equations
test('equations: LibreOffice gives 20 of the 30 as \\moMath; the other 10 carry only a picture — kept as a picture, marked, and warned about', () => {
  const m = parseRtf(read('lo-w14-equations.rtf'));
  const maths = m.blocks.filter((b) => b.type === 'math').length + m.blocks.filter((b) => b.type === 'para').reduce((n, b) => n + (b.segments || []).filter((g) => g.type === 'math').length, 0);
  assert.equal(maths, 20);
  const pics = m.blocks.filter((b) => b.type === 'graphic');
  assert.equal(pics.length, 10);
  assert.ok(pics.every((g) => g.alt === 'equation not transcribed'));
  assert.ok(m.warnings.some((w) => /10 equations are in this file only as a picture/.test(w)), JSON.stringify(m.warnings));
  assert.equal(m.resources.length, 10);
});

test('equations: math written straight inside \\mmath (no \\moMath) is read', () => {
  const m = parseRtf(doc('x {\\mmath{\\*\\mmathPr\\mmathFont34}{\\mr a}{\\mf{\\mfPr}{\\mnum{\\mr 1}}{\\mden{\\mr 2}}}} y\\par'));
  const segs = m.blocks[0].segments || [];
  assert.ok(segs.some((g) => g.type === 'math' && /<mfrac/.test(g.mathml)), JSON.stringify(m.blocks[0]));
});

// ------------------------------------------------------------------------------------------------------------ nothing else changed
test('a plain document still reads as before (paragraphs, bold/italic, a footnote, a hyperlink field)', () => {
  const m = parseRtf(doc('One {\\b bold} and {\\i italic}.{\\super\\chftn{\\footnote\\pard\\plain {\\super\\chftn} Note text.\\par}}\\par Two {\\field{\\*\\fldinst{HYPERLINK "https://example.org"}}{\\fldrslt link}}.\\par'));
  assert.equal(m.blocks[0].segments[1].tf, 4);
  assert.ok(m.blocks.some((b) => b.type === 'footnote' && b.text === 'Note text.'));
  const last = m.blocks.filter((b) => b.type === 'para').pop();
  assert.ok(last.segments.some((g) => g.href === 'https://example.org'));
});
