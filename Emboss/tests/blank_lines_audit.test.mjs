// Blank-line audit fixes (Paul, 4 Nov 2026: "yes, go ahead"; audit in docs/blank-line-audit.md).
//
// Each test is a rule of the standard, not a copy of Emboss's old output:
//   W1  BANA 10.2.1 + Appendix C: "Each exercise set, with accompanying directions or headings, is preceded and
//       followed by a blank line." (App C: "Blank line before but not after instructions unless required by other formats.")
//   W2  BANA inside a box the ordinary rules still apply (7.2.1 only removes the blank after the top line and before the
//       bottom line): 4.3.3, 4.5.3, 4.5.7/4.6.2, 8.3.3a, 1.9.3, 13.3.1a.
//   W3  UKAAF B004 section 10, Example 1: "Place a blank line before the list and blank line at the end of the list."
//       (the "spaced" list option; the default compact list is James's decision UK-5 and does not change).
//   W4  UKAAF B004 section 9, Example 2: "paragraphs can be preceded by a blank line and then commence in cell 3 with
//       runovers starting in cell 1" (new Paragraph Style value 'indented-spaced'; off by default).
//   W5  BANA 14.3.1e: "Insert a blank line to separate scene settings from dialogue" (paragraph flag `sceneSetting`).
//   W6  BANA 1.9.3: "A blank line precedes each blocked paragraph, unless it follows a cell-5 or cell-7 heading", and
//       1.11.3c (a blank after a page change line when the next item normally has one before it) - for the whole-document
//       'block' Paragraph Style (it used to put the blank AFTER each paragraph).
//   S1  BANA 16.5.1b exception: a blank line before the page change indicator when the text after it begins in the
//       same cell as note runovers.
//   S2  BANA 21.2.3g: "Insert one blank line when print uses only blank lines to separate alphabetical divisions."
// Decision UK-5 (James) governs UKAAF blank lines and is not changed: the UKAAF tests below only cover the two options
// that Paul approved (W3, W4); every other UKAAF case is asserted unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, formatDocument, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const bana = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, suppressHeader: true, ...extra });
const ukaaf = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 38, depth: 25, translate: up, suppressHeader: true, ...extra });
// Page-1 lines, right-trimmed; a blank line is ''.
const lines = (blocks, o, doc = {}) => formatDocument({ title: null, blocks, ...doc }, o).split('\f')[0].split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
// Body without the trailing blank lines of the page.
const body = (blocks, o, doc = {}) => { const l = lines(blocks, o, doc); while (l.length && l[l.length - 1] === '') l.pop(); return l; };
const P = (text, x = {}) => ({ type: 'para', text, ...x });
const H = (level, text) => ({ type: 'heading', level, text });
const dir = (text, x = {}) => P(text, { directions: true, ...x });
const exList = () => ({ type: 'list', kind: 'exercise', items: [{ text: 'ONE', marker: '1.', level: 0 }, { text: 'TWO', marker: '2.', level: 0 }] });
const list = (...t) => ({ type: 'list', kind: 'list', items: t.map((x) => ({ text: x, level: 0 })) });
const verse = (t) => ({ type: 'play', subtype: 'verse', style: 'verse', text: t });
const box = (...b) => ({ type: 'box', blocks: b });
const PN = (page) => ({ type: 'pagenum', page });
const PCL = /^-{20,}/;   // a BANA print page change line (dots 3-6 across, then the number)

// ---------------------------------------------------------------------------------------------------------------
// W1: directions that begin an exercise set
// ---------------------------------------------------------------------------------------------------------------
test('W1 (BANA 10.2.1): directions that follow body text get a blank line before them', () => {
  const l = body([P('BODY TEXT HERE.'), dir('CIRCLE THE ANSWER.'), exList(), P('MORE BODY.')], bana());
  const i = l.findIndex((x) => x.includes('CIRCLE'));
  assert.ok(i > 0, JSON.stringify(l));
  assert.equal(l[i - 1], '', `blank before the directions: ${JSON.stringify(l)}`);
  assert.ok(l[i - 2].includes('BODY TEXT'), JSON.stringify(l));
  // 10.2.3: still no blank between the directions and the exercise
  assert.ok(l[i + 1].includes('1.') || l[i + 1].includes('ONE'), `exercise follows the directions directly: ${JSON.stringify(l)}`);
});

test('W1 regression: no blank between a cell-5 heading and directions (4.5.3)', () => {
  const l = body([H(2, 'UNIT ONE'), dir('CIRCLE THE ANSWER.'), exList()], bana());
  const i = l.findIndex((x) => x.includes('CIRCLE'));
  assert.equal(i, l.findIndex((x) => x.includes('UNIT ONE')) + 1, JSON.stringify(l));
});

test('W1: directions at the very start of the document have no leading blank line', () => {
  const l = lines([dir('CIRCLE THE ANSWER.'), exList()], bana());
  assert.ok(l[0].includes('CIRCLE'), JSON.stringify(l));
});

test('W1: further directions paragraphs of one set (7-5 margins, directionsContinued) take no blank line', () => {
  const l = body([P('BODY.'), dir('CIRCLE THE ANSWER.'), dir('THEN WRITE IT.', { directionsContinued: true }), exList()], bana());
  const i = l.findIndex((x) => x.includes('THEN WRITE'));
  assert.ok(l[i - 1].includes('CIRCLE'), JSON.stringify(l));
});

test('W1: after a list there is still exactly one blank line before the directions', () => {
  const l = body([list('A', 'B'), dir('CIRCLE THE ANSWER.'), exList()], bana());
  const i = l.findIndex((x) => x.includes('CIRCLE'));
  assert.equal(l[i - 1], '', JSON.stringify(l));
  assert.notEqual(l[i - 2], '', `not two blank lines: ${JSON.stringify(l)}`);
});

test('W1: one blank line (not two) between a page change line and directions (10.2.2)', () => {
  const l = body([P('BODY.'), PN('2'), dir('CIRCLE THE ANSWER.'), exList()], bana());
  const i = l.findIndex((x) => x.includes('CIRCLE'));
  assert.equal(l[i - 1], '', JSON.stringify(l));
  assert.ok(PCL.test(l[i - 2]), JSON.stringify(l));
});

test('W1: UKAAF is unchanged (directions are an ordinary paragraph; UK-5)', () => {
  const l = body([P('BODY TEXT HERE.'), dir('CIRCLE THE ANSWER.'), exList()], ukaaf());
  const i = l.findIndex((x) => x.includes('CIRCLE'));
  assert.ok(!l.slice(0, i).includes(''), JSON.stringify(l));
});

// ---------------------------------------------------------------------------------------------------------------
// W2: the join rules inside a BANA box
// ---------------------------------------------------------------------------------------------------------------
const inside = (l) => l.slice(l.findIndex((x) => /^7{5,}/.test(x)) + 1, l.findIndex((x, i) => i > 0 && /^G{5,}/.test(x)));   // lines between the box's top and bottom border (BANA box: dots 4-5-6 / 1-2-3-4-5-6 lines)
const rawBox = (blocks) => lines([box(...blocks)], bana());

test('W2 (BANA 4.5.3, 8.3.3a): inside a box a cell-5 heading is not followed by a blank before its list', () => {
  const l = rawBox([H(2, 'SIDE'), list('A', 'B')]);
  const i = l.findIndex((x) => x.includes('SIDE'));
  assert.ok(i > 0, JSON.stringify(l));
  assert.equal(l[i + 1].trim(), 'A', JSON.stringify(l));
});

test('W2 (BANA 1.9.3): inside a box a cell-5 heading is not followed by a blank before a blocked paragraph', () => {
  const l = rawBox([H(2, 'SIDE'), P('BLOCKED TEXT.', { blocked: true })]);
  const i = l.findIndex((x) => x.includes('SIDE'));
  assert.ok(l[i + 1].includes('BLOCKED TEXT'), JSON.stringify(l));
});

test('W2 (BANA 4.5.7, 4.6.2): inside a box no blank line between a cell-5 heading and a cell-7 heading', () => {
  const l = rawBox([H(2, 'FIVE'), H(3, 'SEVEN'), P('TEXT.')]);
  const i = l.findIndex((x) => x.includes('FIVE'));
  assert.ok(l[i + 1].includes('SEVEN'), JSON.stringify(l));
});

test('W2 (BANA 4.3.3 as Emboss reads it outside a box): consecutive centred headings join inside a box too', () => {
  const l = rawBox([H(1, 'TITLE'), H(1, 'AUTHOR'), P('TEXT.')]);
  const i = l.findIndex((x) => x.includes('TITLE'));
  assert.ok(l[i + 1].includes('AUTHOR'), JSON.stringify(l));
});

test('W2 (BANA 13.3.1a): inside a box a blank line before and after a poem', () => {
  const l = rawBox([P('FIRST TEXT.'), verse('LINE ONE'), verse('LINE TWO'), P('LAST TEXT.')]);
  const a = l.findIndex((x) => x.includes('LINE ONE')), b = l.findIndex((x) => x.includes('LINE TWO'));
  assert.equal(l[a - 1], '', JSON.stringify(l));
  assert.equal(l[b + 1], '', JSON.stringify(l));
  assert.equal(l[b - 1].includes('LINE ONE'), true, `no blank inside the poem: ${JSON.stringify(l)}`);
});

test('W2: a poem directly under a cell-5 heading inside a box takes no blank before it (13.3.1a exception)', () => {
  const l = rawBox([H(2, 'POEM'), verse('LINE ONE'), verse('LINE TWO')]);
  const i = l.findIndex((x) => x.includes('POEM'));
  assert.ok(l[i + 1].includes('LINE ONE'), JSON.stringify(l));
});

test('W2 (BANA 7.2.1): still no blank after the top line or before the bottom line', () => {
  const l = rawBox([verse('LINE ONE'), verse('LINE TWO')]);
  const t = l.findIndex((x) => /^7{5,}/.test(x));
  assert.ok(l[t + 1].includes('LINE ONE'), JSON.stringify(l));
  const bt = l.findIndex((x, i) => i > t && /^G{5,}/.test(x));
  assert.ok(l[bt - 1].includes('LINE TWO'), JSON.stringify(l));
});

test('W2 (BANA 10.2.1): directions inside a box after body text get a blank line before them', () => {
  const l = rawBox([P('BODY TEXT.'), dir('CIRCLE THE ANSWER.'), exList()]);
  const i = l.findIndex((x) => x.includes('CIRCLE'));
  assert.equal(l[i - 1], '', JSON.stringify(l));
});

test('W2: formatBlock and traceBlock still agree for a box with these joins', () => {
  const b = box(H(2, 'SIDE'), list('A', 'B'), P('TEXT.'), verse('L1'), verse('L2'), P('END.'));
  const o = { ...bana(), translatePos: upPos };
  assert.deepEqual(traceBlock(b, o, false).map((t) => t.s), formatBlock(b, o, false));
});

test('W2: UKAAF boxes are unchanged (UK-5 already applied in the box)', () => {
  const l = lines([box(H(2, 'SIDE'), list('A', 'B'), P('TEXT.'))], ukaaf());
  assert.ok(l.length > 3);
});

// ---------------------------------------------------------------------------------------------------------------
// W3: UKAAF spaced list
// ---------------------------------------------------------------------------------------------------------------
test('W3 (B004 s10 Ex1): the "spaced" list option keeps a blank line before and after the list', () => {
  const l = body([P('BEFORE TEXT.'), list('A', 'B'), P('AFTER TEXT.')], ukaaf({ listStyle: 'spaced' }));
  const a = l.findIndex((x) => x.trim() === 'A'), b = l.findIndex((x) => x.trim() === 'B');
  assert.equal(l[a - 1], '', JSON.stringify(l));
  assert.ok(l[a - 2].includes('BEFORE TEXT'), JSON.stringify(l));
  assert.equal(l[b + 1], '', JSON.stringify(l));
  assert.ok(l[b + 2].includes('AFTER TEXT'), JSON.stringify(l));
  assert.ok(!l[a].startsWith(' '), `items start in cell 1: ${JSON.stringify(l)}`);
});

test('W3 (decision UK-5, James): the default compact list has no blank lines, unchanged', () => {
  const l = body([P('BEFORE TEXT.'), list('A', 'B'), P('AFTER TEXT.')], ukaaf());
  assert.ok(!l.includes(''), JSON.stringify(l));
  const l2 = body([P('BEFORE TEXT.'), list('A', 'B'), P('AFTER TEXT.')], ukaaf({ listStyle: 'compact' }));
  assert.ok(!l2.includes(''), JSON.stringify(l2));
});

test('W3: spaced list straight after a heading still has the blank line between (Example 1: blank before the list)', () => {
  const l = body([H(2, 'HEAD'), list('A', 'B')], ukaaf({ listStyle: 'spaced' }));
  const a = l.findIndex((x) => x.trim() === 'A');
  assert.equal(l[a - 1], '', JSON.stringify(l));
});

test('W3: BANA is unaffected by listStyle', () => {
  const a = body([P('BEFORE TEXT.'), list('A', 'B'), P('AFTER TEXT.')], bana({ listStyle: 'spaced' }));
  const b = body([P('BEFORE TEXT.'), list('A', 'B'), P('AFTER TEXT.')], bana({ listStyle: 'compact' }));
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------------------------------------------
// W4: UKAAF paragraphs for young children (B004 s9 Example 2)
// ---------------------------------------------------------------------------------------------------------------
const long = 'THIS PARAGRAPH IS LONG ENOUGH TO RUN ONTO A SECOND BRAILLE LINE SO THE RUNOVER CELL CAN BE CHECKED.';
test('W4 (B004 s9 Ex2): paragraphStyle "indented-spaced" = a blank line before each paragraph, cell 3, runovers cell 1', () => {
  const l = lines([P(long), P(long)], ukaaf({ paragraphStyle: 'indented-spaced' }));
  const firsts = l.map((x, i) => [x, i]).filter(([x]) => x.startsWith('  ') && x.includes('PARAGRAPH'));
  assert.equal(firsts.length, 2, JSON.stringify(l));
  const second = firsts[1][1];
  assert.equal(l[second - 1], '', `blank before the second paragraph: ${JSON.stringify(l)}`);
  assert.ok(l[second + 1] && !l[second + 1].startsWith(' '), `runover in cell 1: ${JSON.stringify(l)}`);
});

test('W4: every paragraph is preceded by a blank line, including the one under a heading', () => {
  const l = body([H(2, 'HEAD'), P('SHORT ONE.'), P('SHORT TWO.')], ukaaf({ paragraphStyle: 'indented-spaced' }));
  const a = l.findIndex((x) => x.includes('SHORT ONE')), b = l.findIndex((x) => x.includes('SHORT TWO'));
  assert.equal(l[a - 1], '', JSON.stringify(l));
  assert.equal(l[b - 1], '', JSON.stringify(l));
});

test('W4 (decision UK-5): the default "indented" UKAAF paragraphs still run together with no blank line', () => {
  const l = body([P('SHORT ONE.'), P('SHORT TWO.')], ukaaf());
  assert.ok(!l.includes(''), JSON.stringify(l));
});

test('W4: the option is UKAAF-only: in BANA it lays out as the ordinary indented style', () => {
  const a = body([P('SHORT ONE.'), P('SHORT TWO.')], bana({ paragraphStyle: 'indented-spaced' }));
  const b = body([P('SHORT ONE.'), P('SHORT TWO.')], bana());
  assert.deepEqual(a, b);
});

test('W4: formatBlock and traceBlock agree for the new style', () => {
  const o = { ...ukaaf({ paragraphStyle: 'indented-spaced' }), translatePos: upPos };
  const seg = { type: 'para', segments: [{ type: 'text', text: 'A ' }, { type: 'text', text: 'BOLD', tf: 4 }, { type: 'text', text: ' ' + long }] };
  for (const b of [P(long), seg]) assert.deepEqual(traceBlock(b, o, false).map((t) => t.s), formatBlock(b, o, false));
});

test('W4: settings keep the new value; templates list it', async () => {
  const S = await import('../web/settings.mjs');
  assert.equal(S.sanitizeSettings({ paragraphStyle: 'indented-spaced', mode: 'ukaaf' }).paragraphStyle, 'indented-spaced');
  assert.equal(S.sanitizeSettings({ paragraphStyle: 'block', mode: 'bana' }).paragraphStyle, 'block');
  assert.equal(S.sanitizeSettings({ paragraphStyle: 'nonsense' }).paragraphStyle, 'indented');
});

// ---------------------------------------------------------------------------------------------------------------
// W6: whole-document "block" paragraph style
// ---------------------------------------------------------------------------------------------------------------
test('W6 (BANA 1.9.3): block style puts the blank line BEFORE each paragraph, not after', () => {
  const l = lines([P('ONE ONE.'), P('TWO TWO.'), P('THREE THREE.')], bana({ paragraphStyle: 'block' }));
  assert.ok(l[0].includes('ONE'), `no blank at the top of the document: ${JSON.stringify(l)}`);
  assert.equal(l[1], '', JSON.stringify(l));
  assert.ok(l[2].includes('TWO'), JSON.stringify(l));
  assert.equal(l[3], '', JSON.stringify(l));
  assert.ok(l[4].includes('THREE'), JSON.stringify(l));
});

test('W6 (BANA 1.11.3c): a block-style paragraph after a page change line gets one blank line', () => {
  const l = body([P('ONE ONE.'), PN('2'), P('TWO TWO.')], bana({ paragraphStyle: 'block' }));
  const i = l.findIndex((x) => x.includes('TWO'));
  assert.ok(PCL.test(l[i - 2]) && l[i - 1] === '', JSON.stringify(l));
  const j = l.findIndex((x) => PCL.test(x));
  assert.ok(l[j - 1].includes('ONE'), `no blank before the page change line (1.11.3b: only where another format needs it): ${JSON.stringify(l)}`);
});

test('W6 (BANA 1.9.3): no blank line between a cell-5 heading and the block-style paragraph under it', () => {
  const l = body([H(2, 'HEAD'), P('ONE ONE.'), P('TWO TWO.')], bana({ paragraphStyle: 'block' }));
  const i = l.findIndex((x) => x.includes('HEAD'));
  assert.ok(l[i + 1].includes('ONE'), JSON.stringify(l));
  assert.equal(l[i + 2], '', JSON.stringify(l));
});

test('W6: formatBlock/traceBlock agree for a block-style paragraph', () => {
  const o = { ...bana({ paragraphStyle: 'block' }), translatePos: upPos };
  const b = P(long);
  assert.deepEqual(traceBlock(b, o, false).map((t) => t.s), formatBlock(b, o, false));
});

// ---------------------------------------------------------------------------------------------------------------
// W5: scene setting (BANA 14.3.1e)
// ---------------------------------------------------------------------------------------------------------------
test('W5 (BANA 14.3.1e): a scene-setting paragraph is followed by a blank line before the dialogue', () => {
  const speech = { type: 'play', subtype: 'prose', text: 'NORA: HIDE THE TREE.' };
  const l = body([P('A ROOM IN HELMER\'S HOUSE.', { sceneSetting: true }), speech], bana());
  const i = l.findIndex((x) => x.includes('HELMER'));
  assert.equal(l[i + 1], '', JSON.stringify(l));
  assert.ok(l[i + 2].includes('NORA'), JSON.stringify(l));
});

test('W5: without the flag there is no blank line (unchanged)', () => {
  const speech = { type: 'play', subtype: 'prose', text: 'NORA: HIDE THE TREE.' };
  const l = body([P('A ROOM IN HELMER\'S HOUSE.'), speech], bana());
  const i = l.findIndex((x) => x.includes('HELMER'));
  assert.ok(l[i + 1].includes('NORA'), JSON.stringify(l));
});

test('W5: formatBlock/traceBlock agree for a scene-setting paragraph (plain and segmented)', () => {
  const o = { ...bana(), translatePos: upPos };
  const seg = { type: 'para', sceneSetting: true, segments: [{ type: 'text', text: 'A ' }, { type: 'text', text: 'ROOM', tf: 4 }, { type: 'text', text: ' IN THE HOUSE.' }] };
  for (const b of [P('A ROOM.', { sceneSetting: true }), seg]) assert.deepEqual(traceBlock(b, o, false).map((t) => t.s), formatBlock(b, o, false));
});

test('W5: the flag is registered, saved and offered to transcribers', async () => {
  const R = await import('../format/field-registry.mjs');
  const f = R.fieldByKey('sceneSetting');
  assert.ok(f, 'sceneSetting is in the registry');
  assert.equal(f.audience, 'transcriber');
  assert.ok(f.save && f.save.length, 'saved in the file');
  assert.ok(f.ui && f.ui.length, 'offered in the Braille formatting dialog');
});

// ---------------------------------------------------------------------------------------------------------------
// S1: BANA 16.5.1b exception
// ---------------------------------------------------------------------------------------------------------------
const fn = (id, m, t) => ({ type: 'footnote', id, segments: [{ type: 'noteref', text: m }, { type: 'text', text: t }] });
const pw = (t, id, m) => P(t, { segments: [{ type: 'text', text: t }, { type: 'noteref', text: m, idref: id }] });
const NOTE = 'THIS IS A LONG NOTE THAT WRAPS ONTO A SECOND LINE FOR SURE YES.';
test('S1 (BANA 16.5.1b): blank line before the page change line when the text after it starts in the note-runover cell', () => {
  const l = body([pw('TEXT', 'n1', '1'), fn('n1', '1', NOTE), PN('2'), P('INDENTED PARAGRAPH TEXT.')], bana());
  const j = l.findIndex((x) => PCL.test(x));
  assert.ok(j > 0, JSON.stringify(l));
  assert.equal(l[j - 1], '', JSON.stringify(l));
  assert.ok(l[j - 2].includes('SECOND') || l[j - 2].trim().length > 0, JSON.stringify(l));
  assert.ok(l[j + 1].startsWith('  ') && l[j + 1].includes('INDENTED'), `the text after the indicator is in cell 3: ${JSON.stringify(l)}`);
});

test('S1: no blank before the page change line when the text after it starts in another cell (blocked paragraph, cell 1)', () => {
  const l = body([pw('TEXT', 'n1', '1'), fn('n1', '1', NOTE), PN('2'), P('BLOCKED TEXT.', { blocked: true })], bana());
  const j = l.findIndex((x) => PCL.test(x));
  assert.notEqual(l[j - 1], '', JSON.stringify(l));
});

test('S1: the general rule is unchanged: no blank before the note separation line after a paragraph', () => {
  const l = body([pw('TEXT', 'n1', '1'), fn('n1', '1', 'SHORT NOTE.')], bana());
  const s = l.findIndex((x) => x.startsWith('"333333'));
  assert.notEqual(l[s - 1], '', JSON.stringify(l));
});

// ---------------------------------------------------------------------------------------------------------------
// S2: BANA 21.2.3g
// ---------------------------------------------------------------------------------------------------------------
test('S2 (BANA 21.2.3g): one blank line where print separates alphabetical divisions only by a blank line', () => {
  const idx = { type: 'list', kind: 'index', items: [
    { level: 1, text: 'EXTERNAL MIGRATION', page: '707' },
    { level: 1, text: 'EXTINCTION', page: '683' },
    { level: 1, text: 'FALCIPARUM MALARIA', page: '3', divisionBreak: true },
  ] };
  const l = body([idx], bana());
  const i = l.findIndex((x) => x.includes('FALCIPARUM'));
  assert.equal(l[i - 1], '', JSON.stringify(l));
  assert.ok(l[i - 2].includes('EXTINCTION'), JSON.stringify(l));
  // 21.2.3h: no flag, no blank
  const idx2 = { ...idx, items: idx.items.map((x) => ({ ...x, divisionBreak: undefined })) };
  const l2 = body([idx2], bana());
  assert.ok(!l2.includes(''), JSON.stringify(l2));
});
