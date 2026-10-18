// RTF import, 1 Oct 2026 (import fix list #45, #42, #48). The rule throughout: an RTF file gives the SAME model the Word .docx reader
// gives for the same document.
//
//   #45  Office Math in RTF ({\mmath {\*\moMathPara …}} / {\mmath {\*\moMath …}}, RTF 1.9.1 "Office Open XML Math"): the control words
//        are the OMML element names written with RTF syntax (\mf = m:f, \mnum, \mrad, \mdeg, \msSub …), a property that holds a value is
//        a group holding the value ({\mchr ∑}, {\mtype skw}) or an on/off control word (\mdegHide1, \mgrow0), and a run's own
//        properties are control words ({\mr\mscr0\msty2 a}: Murray Sargent's "Mathematical RTF" — \mscr 0-5 and \msty 0-3 follow the
//        order of the OOXML enumerations ST_Script and ST_Style). The tests rebuild the OMML of the Word fixtures as Word-form RTF and
//        require the SAME MathML omml.mjs gives the .docx equation; the display rule is the .docx reader's (oMathPara = display,
//        one block per equation; after text = inline; an equation alone in its paragraph = display, as the LibreOffice files need).
//   #48  A picture's caption: a paragraph in Word's Caption style directly after the paragraph holding the picture is the picture's
//        caption (graphic.caption), not a paragraph of its own — parseDocx (the A45/D1 convention) does exactly that.
//   #42  Table header row: the .docx reader takes a table's FIRST row as its header row whether or not it is marked (w:tblHeader) or
//        bold (checked: w12-tables.docx with every w:tblHeader removed gives the same headers). RTF already does the same, so it is
//        unchanged; these tests pin that agreement. (Import fix list #42 and the brief said the Word reader uses only a marked or bold
//        first row: that is the HTML / DTBook reader and the table-kind classifier, not the Word table model.)
//
// Set RTF_PARSE_MODULE to another copy of the parser to run the same tests against it (used to show them failing before the change).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
globalThis.XMLSerializer = globalThis.XMLSerializer || XMLSerializer;
const { parseRtf, parseDocx } = await import(process.env.RTF_PARSE_MODULE || '../input/parse.mjs');
const { ommlElementToMathML, MATH_NS } = await import('../input/omml.mjs');
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(EMBOSS, 'tests/fixtures/import-audit');
const readRtfFile = (name) => fs.readFileSync(path.join(FIX, 'rtf', name), 'latin1');
const docxBytes = (name) => { const b = fs.readFileSync(path.join(FIX, 'docx', name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const U = (n, fb = '?') => '\\' + 'u' + n + fb;                // \uN with its fallback, built so this file never holds backslash-u-digits
const doc = (body, header = '') => `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}${header} ${body}}`;
const mathsOf = (m) => {
  const out = [];
  JSON.stringify(m.blocks, (k, v) => { if (v && v.type === 'math') out.push(v); return v; });
  return out;
};
const textOf = (b) => b.text ?? (b.segments || []).map((g) => g.text || '').join('');

// ------------------------------------------------------------------------------------------------ OMML -> Word-form RTF (test helper)
const STY = ['p', 'b', 'i', 'bi'];
const SCR = ['roman', 'script', 'fraktur', 'double-struck', 'sans-serif', 'monospace'];
const ONOFF = new Set(['grow', 'degHide', 'subHide', 'supHide', 'hideLeft', 'hideRight', 'hideTop', 'hideBot', 'strikeH', 'strikeV', 'strikeBLTR', 'strikeTLBR', 'transp', 'zeroAsc', 'zeroDesc', 'zeroWid', 'show', 'opEmu', 'noBreak', 'diff', 'lit', 'nor']);
const rtfText = (s) => [...String(s)].map((ch) => {
  if (ch === '\\' || ch === '{' || ch === '}') return '\\' + ch;
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return ch;
  const unit = (u) => U(u > 32767 ? u - 65536 : u);
  return cp > 0xFFFF ? unit(0xD800 + ((cp - 0x10000) >> 10)) + unit(0xDC00 + ((cp - 0x10000) & 0x3FF)) : unit(cp);
}).join('');
const valOf = (el) => el.getAttributeNS(MATH_NS, 'val');
// onOffAs: 'word' = the control word with a number (\mgrow0, \mdegHide1) — how Word writes it — or 'group' = {\mdegHide 1}, how LibreOffice writes it
function ommlToRtf(el, onOffAs = 'word') {
  const n = el.localName;
  const kids = [...el.childNodes].filter((c) => c.nodeType === 1);
  if (n === 'r') {
    let props = '';
    for (const p of kids.filter((k) => k.localName === 'rPr').flatMap((k) => [...k.childNodes].filter((c) => c.nodeType === 1))) {
      const v = valOf(p);
      if (p.localName === 'sty') props += '\\msty' + STY.indexOf(v);
      else if (p.localName === 'scr') props += '\\mscr' + SCR.indexOf(v);
      else if (p.localName === 'nor' || p.localName === 'lit') props += '\\m' + p.localName;
    }
    const t = kids.filter((k) => k.localName === 't').map((k) => k.textContent).join('');
    return `{\\mr${props} ${rtfText(t)}}`;
  }
  if (!kids.length && valOf(el) !== null && n !== 't') {                  // a value property (inside a Pr group)
    const v = valOf(el);
    if (ONOFF.has(n) && onOffAs === 'word') return `\\m${n}${/^(0|false|off)$/i.test(v) ? 0 : 1}`;
    return `{\\m${n} ${rtfText(v)}}`;
  }
  if (!kids.length && /^(nor|lit)$/.test(n)) return '';
  if (n === 'ctrlPr') return '{\\mctrlPr}';
  return `{\\m${n}${n.endsWith('Pr') ? '' : ' '}${kids.map((k) => ommlToRtf(k, onOffAs)).join('')}}`;
}
function wordFixtureOmml(name) {
  const xml = execFileSync('unzip', ['-p', path.join(FIX, 'docx', name), 'word/document.xml'], { maxBuffer: 1 << 26 }).toString('utf8');
  const d = new DOMParser().parseFromString(xml, 'text/xml');
  return [...d.getElementsByTagNameNS(MATH_NS, 'oMath')];
}
// the RTF the equations of a Word fixture make: every equation in a paragraph of its own text, as the INLINE kind (after text)
function inlineRtf(omEls, onOffAs) {
  return doc(omEls.map((om, i) => `Eq ${i} {\\mmath {\\*\\moMath ${[...om.childNodes].filter((c) => c.nodeType === 1).map((k) => ommlToRtf(k, onOffAs)).join('')}}{\\mmathPict {\\*\\shppict{\\pict\\pngblip 89504e47}}}} end.\\par`).join('\n'));
}

for (const fixture of ['w14-equations.docx', 'w20-equation-contexts.docx']) {
  for (const onOffAs of ['word', 'group']) {
    test(`#45: every equation of ${fixture} written as Word-form RTF (${onOffAs === 'word' ? 'on/off properties as \\mdegHide1' : 'as {\\mdegHide 1}'}) gives the MathML the .docx reader gives`, () => {
      const oms = wordFixtureOmml(fixture);
      assert.ok(oms.length >= 10, 'fixture has equations');
      const m = parseRtf(inlineRtf(oms, onOffAs));
      const got = mathsOf(m).map((x) => x.mathml);
      assert.equal(got.length, oms.length, 'one equation each, and the fallback pictures are not added');
      assert.ok(!m.blocks.some((b) => b.type === 'graphic') && !m.resources, 'the \\mmathPict picture is not shown as well');
      oms.forEach((om, i) => assert.equal(got[i], ommlElementToMathML(om), `equation ${i}`));
    });
  }
}

// ------------------------------------------------------------------------------------------------ #45 details
test('#45: a run\'s \\msty0 is Word\'s "plain" style (m:sty p), so a lone letter is upright, not an italic variable', () => {
  const m = parseRtf(doc(`x {\\mmath {\\*\\moMath {\\msSub {\\me {\\mr\\mscr0\\msty0 H}}{\\msub {\\mr\\mscr0\\msty0 2}}}{\\mr\\mscr0\\msty0 O}}} y\\par`));
  assert.match(mathsOf(m)[0].mathml, /<mi mathvariant="normal">H<\/mi>/);
  assert.match(mathsOf(m)[0].mathml, /<mi mathvariant="normal">O<\/mi>/);
});

test('#45: {\\mbegChr } with no value is "no bracket" (an explicit empty value), not the default (', () => {
  const m = parseRtf(doc(`x {\\mmath {\\*\\moMath {\\md {\\mdPr {\\mbegChr }{\\mendChr \\}}}{\\me {\\mr a}}}}} y\\par`));
  const ml = mathsOf(m)[0].mathml;
  assert.match(ml, /<mo fence="true" stretchy="true"><\/mo><mi>a<\/mi><mo fence="true" stretchy="true">\}<\/mo>/, ml);
});

test('#45: \\mgrow0 inside a property group keeps the brackets small, as m:grow val 0 does', () => {
  const m = parseRtf(doc(`x {\\mmath {\\*\\moMath {\\md {\\mdPr\\mgrow0}{\\me {\\mr a}}}}} y\\par`));
  assert.match(mathsOf(m)[0].mathml, /stretchy="false"/);
});

test('#45: text written straight into an argument, with no \\mr around it, is the argument\'s run (it was a property value)', () => {
  const m = parseRtf(doc(`x {\\mmath {\\*\\moMath {\\mf {\\mnum 1}{\\mden 2}}}} y\\par`));
  assert.match(mathsOf(m)[0].mathml, /<mfrac><mn>1<\/mn><mn>2<\/mn><\/mfrac>/);
});

test('#45: an unknown ignorable group inside an equation is skipped whole, never read as its text', () => {
  const m = parseRtf(doc(`x {\\mmath {\\*\\moMath {\\mr a}{\\*\\insrsid 123 leaked}{\\mr b}}} y\\par`));
  assert.ok(!/leaked/.test(mathsOf(m)[0].mathml));
  assert.match(mathsOf(m)[0].mathml, /<mi>a<\/mi><mi>b<\/mi>/);
});

test('#45: a surrogate pair written as two \\u escapes (a math alphanumeric) arrives as one character', () => {
  const m = parseRtf(doc(`x {\\mmath {\\*\\moMath {\\mr ${U(-10187)}${U(-9138)}}}} y\\par`));
  assert.ok(mathsOf(m)[0].mathml.includes('\u{1D44E}'), mathsOf(m)[0].mathml);
});

test('#45: a character XML cannot hold inside an equation\'s run does not lose the equation; hidden math is not transcribed', () => {
  const m = parseRtf(doc(`x {\\mmath {\\*\\moMath {\\mr a${U(1)}b}}} y {\\v {\\mmath {\\*\\moMath {\\mr hiddenmath}}}} z\\par`));
  const ms = mathsOf(m);
  assert.equal(ms.length, 1);
  assert.match(ms[0].mathml, /<mi>ab<\/mi>/);
});

test('#45: {\\mmath {\\*\\moMathPara …}} with two equations is two display equations, one block each (the .docx reader\'s rule)', () => {
  const m = parseRtf(doc(`{\\mmath{\\*\\moMathPara{\\moMathParaPr{\\mmathPr\\mjc2}}{\\*\\moMath {\\mr a}{\\mr \\mnor =}{\\mr 1}}{\\*\\moMath {\\mr b}{\\mr \\mnor =}{\\mr 2}}}{\\mmathPict {\\*\\shppict{\\pict\\pngblip 89504e47}}}}\\par`));
  assert.deepEqual(m.blocks.map((b) => b.type), ['math', 'math']);
  assert.match(m.blocks[0].mathml, /<mi>a<\/mi>/); assert.match(m.blocks[1].mathml, /<mi>b<\/mi>/);
  assert.ok(!/<mi>b<\/mi>/.test(m.blocks[0].mathml), 'not run together into one equation');
});

test('#45: an equation of moMathPara sharing its paragraph with text is inline, as in the .docx reader', () => {
  const m = parseRtf(doc(`See {\\mmath{\\*\\moMathPara{\\*\\moMath {\\mr a}}}} here.\\par`));
  assert.deepEqual(m.blocks.map((b) => b.type), ['para']);
  assert.equal(m.blocks[0].segments.filter((s) => s.type === 'math').length, 1);
});

test('#45: a bare moMath alone in its paragraph is a display equation; after text it is inline (LibreOffice writes display equations this way)', () => {
  const alone = parseRtf(doc(`{\\mmath {\\*\\moMath {\\mr a}}}\\par`));
  assert.deepEqual(alone.blocks.map((b) => b.type), ['math']);
  const inline = parseRtf(doc(`Value {\\mmath {\\*\\moMath {\\mr a}}} end\\par`));
  assert.deepEqual(inline.blocks.map((b) => b.type), ['para']);
});

test('#45: the picture Word writes as the equation\'s fallback ({\\shppict} and {\\nonshppict} inside {\\mmathPict}) is not shown when the equation is read', () => {
  const pict = '{\\pict\\picw8\\pich8\\pngblip 89504e470d0a1a0a}';
  const m = parseRtf(doc(`{\\mmath {\\*\\moMath {\\mr a}}{\\mmathPict {\\*\\shppict${pict}}{\\nonshppict${pict}}}}\\par`));
  assert.deepEqual(m.blocks.map((b) => b.type), ['math']);
  assert.ok(!m.resources && !m.warnings, JSON.stringify(m.warnings));
});

test('#45: LibreOffice-written lo-w14-equations.rtf — 20 of the 30 equations are in the file as math and give the .docx\'s MathML (17 identical); the other 10 are only a picture in the file', async () => {
  const rtf = parseRtf(readRtfFile('lo-w14-equations.rtf'));
  const docx = await parseDocx(docxBytes('w14-equations.docx'));
  const flow = (model) => {
    const out = []; let label = null;
    for (const b of model.blocks) {
      if (b.type === 'math') out.push({ label, kind: 'display', mathml: b.mathml });
      else if (b.type === 'graphic') out.push({ label, kind: 'picture' });
      else if (b.type === 'para' || b.type === 'heading') {
        const m = /EQ(\w+):/.exec(textOf(b)); if (m) label = m[1];
        for (const g of b.segments || []) if (g.type === 'math') out.push({ label, kind: 'inline', mathml: g.mathml });
      }
    }
    return out;
  };
  const R = new Map(flow(rtf).map((x) => [x.label, x])), D = flow(docx);
  assert.equal(D.length, 30);
  const same = D.filter((d) => R.get(d.label) && R.get(d.label).kind === d.kind && R.get(d.label).mathml === d.mathml).map((d) => d.label);
  const asPicture = D.filter((d) => R.get(d.label).kind === 'picture').map((d) => d.label);
  assert.equal(same.length, 17, same.join(' '));
  assert.deepEqual(asPicture.sort(), ['cossub2', 'cosub', 'cuberoot', 'frac', 'log', 'radical', 'sin', 'sub', 'subsup', 'sup']);
  // the three that are read but differ are LibreOffice's own export: no m:func around log_2 x, the comma written as a run (no m:sepChr), no "plain" style on H and O
  const differ = D.filter((d) => R.get(d.label).kind !== 'picture' && R.get(d.label).mathml !== d.mathml).map((d) => d.label).sort();
  assert.deepEqual(differ, ['chem', 'logbase', 'sepdelim']);
});

// ------------------------------------------------------------------------------------------------ #48
const CAP_HEADER = '{\\stylesheet{\\s0 Normal;}{\\s1\\sbasedon0 heading 1;}{\\s27\\sbasedon0\\snext0\\i caption;}{\\s28\\sbasedon27 Illustration;}}';
const pic = (alt = 'a picture') => `{\\pict{\\*\\picprop{\\sp{\\sn wzDescription}{\\sv ${alt}}}}\\picw8\\pich8\\pngblip\n89504e470d0a1a0a0000000d49484452000000080000000808020000004b6d29dc0000001149444154789c633821278715310c2d090090bf4101b29f3e220000\n000049454e44ae426082}`;

test('#48: the Caption-style paragraph right after a picture is the picture\'s caption, not a paragraph of its own (lo-w13-images.rtf, as w13-images.docx)', async () => {
  const rtf = parseRtf(readRtfFile('lo-w13-images.rtf'));
  const docx = await parseDocx(docxBytes('w13-images.docx'));
  const g = rtf.blocks.find((b) => b.type === 'graphic' && b.alt === 'alphacapimg figure');
  assert.equal(g.caption, 'Figure 1: alphacaption text for the figure');
  assert.equal(docx.blocks.find((b) => b.type === 'graphic' && b.alt === 'alphacapimg figure').caption, g.caption, 'the .docx reader gives the same caption');
  assert.ok(!rtf.blocks.some((b) => b.type === 'para' && /alphacaption/.test(textOf(b))), 'no separate paragraph');
});

test('#48: a style based on Caption joins too; a paragraph in another style, or after an empty paragraph, does not', () => {
  const m = parseRtf(doc(`\\pard\\s0 ${pic('one')}\\par\\pard\\s28 Based on caption alphabased\\par\\pard\\s0 ${pic('two')}\\par\\pard\\s0 Ordinary alphaplain\\par\\pard\\s0 ${pic('three')}\\par\\pard\\s0\\par\\pard\\s27 Late alphalate\\par`, CAP_HEADER));
  const gs = m.blocks.filter((b) => b.type === 'graphic');
  assert.equal(gs[0].caption, 'Based on caption alphabased');
  assert.equal(gs[1].caption, undefined);
  assert.equal(gs[2].caption, undefined, 'an empty paragraph between breaks the pair, as in the .docx reader');
  const paras = m.blocks.filter((b) => b.type === 'para').map(textOf);
  assert.deepEqual(paras, ['Ordinary alphaplain', 'Late alphalate']);
});

test('#48: a Caption-style paragraph with no picture before it stays an ordinary paragraph', () => {
  const m = parseRtf(doc(`\\pard\\s0 Intro\\par\\pard\\s27 Caption alone alphacap\\par`, CAP_HEADER));
  assert.deepEqual(m.blocks.map((b) => b.type), ['para', 'para']);
});

test('#48: with several pictures in the paragraph the caption goes to the last one (the .docx reader\'s rule)', () => {
  const m = parseRtf(doc(`\\pard\\s0 ${pic('first')}${pic('second')}\\par\\pard\\s27 Both alphacap\\par`, CAP_HEADER));
  const gs = m.blocks.filter((b) => b.type === 'graphic');
  assert.equal(gs.length, 2);
  assert.equal(gs[0].caption, undefined);
  assert.equal(gs[1].caption, 'Both alphacap');
});

// ------------------------------------------------------------------------------------------------ #42
test('#42: the first row of a table is its header row whether or not \\trhdr marks it — as the .docx reader (its w12-tables.docx gives the same headers with every w:tblHeader removed)', async () => {
  const unmarked = '\\trowd\\trgaph108\\cellx2000\\cellx4000 \\pard\\intbl a1\\cell\\pard\\intbl a2\\cell\\row\\trowd\\trgaph108\\cellx2000\\cellx4000 \\pard\\intbl b1\\cell\\pard\\intbl b2\\cell\\row\\pard Done\\par';
  const marked = unmarked.replace('\\trowd\\trgaph108\\cellx2000', '\\trowd\\trhdr\\trgaph108\\cellx2000');
  for (const body of [unmarked, marked]) {
    const t = parseRtf(doc(body)).blocks.find((b) => b.type === 'table');
    assert.deepEqual(t.headers, ['a1', 'a2']);
    assert.deepEqual(t.rows, [['b1', 'b2']]);
  }
  // the LibreOffice twin of the Word fixture: every table's header row is the .docx table's
  const rtf = parseRtf(readRtfFile('lo-w12-tables.rtf')).blocks.filter((b) => b.type === 'table');
  const docx = (await parseDocx(docxBytes('w12-tables.docx'))).blocks.filter((b) => b.type === 'table');
  const cell = (c) => (typeof c === 'string' ? c : c && c.text) || '';
  const heads = (ts) => ts.map((t) => t.headers.map(cell).join('|'));
  for (const h of heads(docx).filter((h) => /alphaOuter1|alphaE1|alphaC1/.test(h))) assert.ok(heads(rtf).includes(h), h);
});
