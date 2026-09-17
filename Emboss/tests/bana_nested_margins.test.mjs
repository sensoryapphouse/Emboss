// Nested indentation, heading blank-line exceptions, heading/stage emphasis and the
// retained print bullet — pinned to the standards:
//   BANA Formats 2016 §8.5.1b (nested lists), §10.4.1 / §10.4.2b (exercise sets),
//   §2.10.6b (contents), §21.2.1b / §21.4 (indexes), §13.3.1 (poetry): the main entry
//   begins in cell 1, each sub-level two cells further right, and ALL runovers begin
//   two cells to the right of the farthest indented level — 1-3; 1-5, 3-5; 1-7, 3-7, 5-7.
//   UKAAF B004 §10 Ex1/Ex2, App C Ex1 (1/5, 3/7, 5/9), App I (indexes share one runover
//   start), App J (poetry runover cell 5).
//   Formats §4.3.3, §4.5.3, §4.5.7, §4.6.2, §8.3.3a, §13.3.1a (no blank line after a
//   heading in the listed cases); §4.3.7 / §14.4.1c (font attributes ignored).
//   Formats §8.6.2a: a print bullet is retained as the UEB bullet _4 (dots 456, 256).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import { STYLE_DEFINITIONS, isListStyle, formatStyleInspectorBadge } from '../format/styles.mjs';

const upper = (s) => String(s).toUpperCase();
// A typeform-aware stand-in for the translator: emphasised runs are wrapped in ^ … ^
// so a test can see whether `tf` reached the translator.
const tfTranslate = (s, tf) => (Array.isArray(tf) && tf.some(Boolean) ? `^${upper(s)}^` : upper(s));
const tfTranslatePos = (s, tf) => { const b = tfTranslate(s, tf); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, s.length - 1)) }; };
const bodyLines = (brf) => brf.split(/\r?\n/).filter((l) => l.trim() && !/#[A-J]+$/.test(l.trim()) && !l.includes('\f'));
const leading = (l) => l.length - l.trimStart().length;
// [entry indent, runover indent] for each entry that starts with one of `starts`.
const pairs = (lines, starts) => starts.map((t) => {
  const i = lines.findIndex((l) => l.trimStart().startsWith(t));
  assert.ok(i >= 0 && i + 1 < lines.length, `entry ${t} and its runover present: ${JSON.stringify(lines)}`);
  return [leading(lines[i]), leading(lines[i + 1])];
});
const opts = (mode, extra = {}) => ({ mode, width: 30, depth: 25, translate: upper, ...extra });

const longText = (label) => `${label} entry that is long enough to need a second braille line`;
const threeLevelList = () => ({ type: 'list', items: [
  { text: longText('Main'), level: 0 },
  { text: longText('Sub'), level: 1 },
  { text: longText('Subsub'), level: 2 },
] });

test('BANA §8.5.1b: three-level list is 1-7, 3-7, 5-7 (all runovers share the deepest indent + 2)', () => {
  const lines = bodyLines(formatDocument({ blocks: [threeLevelList()] }, opts('bana')));
  const entries = ['MAIN ENTRY', 'SUB ENTRY', 'SUBSUB ENTRY'].map((t) => lines.findIndex((l) => l.trimStart().startsWith(t)));
  assert.deepEqual(entries.map((i) => leading(lines[i])), [0, 2, 4], `entries in cells 1, 3, 5: ${JSON.stringify(lines)}`);
  assert.deepEqual(entries.map((i) => leading(lines[i + 1])), [6, 6, 6], `every runover in cell 7: ${JSON.stringify(lines)}`);
});

test('BANA §8.5.1b / §10.4.1: one level is 1-3, two levels 1-5, 3-5 — for lists, exercises and indexes', () => {
  for (const kind of [undefined, 'plain', 'exercise', 'index', 'toc']) {
    const one = bodyLines(formatDocument({ blocks: [{ type: 'list', kind, items: [{ text: longText('Only'), level: 0 }] }] }, opts('bana')));
    assert.deepEqual([leading(one[0]), leading(one[1])], [0, 2], `${kind ?? 'list'} one level 1-3: ${JSON.stringify(one)}`);
    const two = bodyLines(formatDocument({ blocks: [{ type: 'list', kind, items: [
      { text: longText('Main'), level: 0 }, { text: longText('Sub'), level: 1 },
    ] }] }, opts('bana')));
    assert.deepEqual(pairs(two, ['MAIN', 'SUB']), [[0, 4], [2, 4]], `${kind ?? 'list'} two levels 1-5, 3-5: ${JSON.stringify(two)}`);
  }
});

test('UKAAF B004 App C Ex1: nested list 1/5, 3/7, 5/9; §10 Ex1: a flat list stays 1-3', () => {
  const lines = bodyLines(formatDocument({ blocks: [threeLevelList()] }, opts('ukaaf')));
  const entries = ['MAIN ENTRY', 'SUB ENTRY', 'SUBSUB ENTRY'].map((t) => lines.findIndex((l) => l.trimStart().startsWith(t)));
  assert.deepEqual(entries.map((i) => leading(lines[i])), [0, 2, 4], `entries in cells 1, 3, 5: ${JSON.stringify(lines)}`);
  assert.deepEqual(entries.map((i) => leading(lines[i + 1])), [4, 6, 8], `runovers in cells 5, 7, 9: ${JSON.stringify(lines)}`);
  const flat = bodyLines(formatDocument({ blocks: [{ type: 'list', items: [{ text: longText('Only') }] }] }, opts('ukaaf')));
  assert.deepEqual([leading(flat[0]), leading(flat[1])], [0, 2], `flat list 1-3: ${JSON.stringify(flat)}`);
});

test('UKAAF B004 App I: index entries share one runover start two cells right of the deepest entry', () => {
  const lines = bodyLines(formatDocument({ blocks: [{ type: 'list', kind: 'index', items: [
    { text: longText('Main'), level: 0 }, { text: longText('Sub'), level: 1 },
  ] }] }, opts('ukaaf')));
  assert.deepEqual(pairs(lines, ['MAIN', 'SUB']), [[0, 4], [2, 4]], `index 1-5, 3-5: ${JSON.stringify(lines)}`);
});

test('UKAAF B004 §10 Ex2 compact (5-1, 7-1) applies only in UKAAF mode; BANA ignores listStyle=compact', () => {
  const doc = { blocks: [{ type: 'list', items: [{ marker: '1.', text: longText('Main'), level: 0 }, { marker: 'a.', text: longText('Sub'), level: 1 }] }] };
  const uk = bodyLines(formatDocument(doc, opts('ukaaf', { listStyle: 'compact' })));
  assert.deepEqual(pairs(uk, ['MAIN', 'SUB']), [[4, 0], [6, 0]], `compact 5/1, 7/1: ${JSON.stringify(uk)}`);
  assert.equal(uk[0].includes('1.'), false, 'compact ignores print markers');
  const us = bodyLines(formatDocument(doc, opts('bana', { listStyle: 'compact' })));
  assert.deepEqual(pairs(us, ['1. MAIN', 'A. SUB']), [[0, 4], [2, 4]], `BANA keeps §8.5.1b 1-5, 3-5: ${JSON.stringify(us)}`);
  assert.equal(us[0].startsWith('1.'), true, 'BANA keeps the print marker');
});

test('BANA §13.3.1: a two-level poem (one line per block, stanza break inside) is 1-5, 3-5', () => {
  const line = (level, text) => ({ type: 'play', subtype: 'verse', style: 'verse', level, text });
  const doc = { blocks: [
    { type: 'heading', level: 1, text: 'Poem' },
    line(0, 'The wind was a torrent of darkness among the gusty trees'),
    { type: 'indicator', kind: 'stanza' },
    line(1, 'And the moon was a ghostly galleon tossed upon cloudy seas'),
    { type: 'para', text: 'Prose after the poem, which must not be part of it at all.' },
  ] };
  const lines = bodyLines(formatDocument(doc, opts('bana')));
  const i0 = lines.findIndex((l) => l.startsWith('THE WIND')), i1 = lines.findIndex((l) => l.startsWith('  AND THE MOON'));
  assert.ok(i0 >= 0 && i1 >= 0, JSON.stringify(lines));
  assert.equal(leading(lines[i0 + 1]), 4, `level 0 runover cell 5: ${JSON.stringify(lines[i0 + 1])}`);
  assert.equal(leading(lines[i1 + 1]), 4, `level 1 runover cell 5: ${JSON.stringify(lines[i1 + 1])}`);
  const prose = lines.find((l) => l.trimStart().startsWith('PROSE AFTER'));
  assert.equal(leading(prose), 2, 'the paragraph after the poem is a normal 3-1 paragraph');
});

test('UKAAF B004 App J: poem lines start in cell 1 with runovers in cell 5; a sub-level steps in by 2', () => {
  const line = (level, text) => ({ type: 'play', subtype: 'verse', style: 'verse', level, text });
  const lines = bodyLines(formatDocument({ blocks: [
    line(0, 'The wind was a torrent of darkness among the gusty trees'),
    line(1, 'And the moon was a ghostly galleon tossed upon cloudy seas'),
  ] }, opts('ukaaf')));
  assert.deepEqual(pairs(lines, ['THE WIND', 'AND THE MOON']), [[0, 4], [2, 4]], JSON.stringify(lines));
});

test('BANA §2.10.6b: the generated contents page uses the nested pattern (1-5, 3-5 for two heading levels)', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'A chapter heading whose contents entry needs a second line' },
    { type: 'para', text: 'Body.' },
    { type: 'heading', level: 2, text: 'A section heading whose contents entry needs a second line' },
    { type: 'para', text: 'More body.' },
  ];
  const brf = formatDocument({ blocks }, opts('bana', { toc: true, width: 32 }));
  const tocPage = brf.split('\f')[0].split(/\r?\n/).filter((l) => l.trim());
  const c1 = tocPage.findIndex((l) => l.startsWith('A CHAPTER')), c2 = tocPage.findIndex((l) => l.startsWith('  A SECTION'));
  assert.ok(c1 >= 0 && c2 >= 0, JSON.stringify(tocPage));
  assert.equal(leading(tocPage[c1 + 1]), 4, `chapter runover in cell 5: ${JSON.stringify(tocPage)}`);
  assert.equal(leading(tocPage[c2 + 1]), 4, `section runover in cell 5: ${JSON.stringify(tocPage)}`);
});

test('BANA §4.5.7 / §4.6.2: no blank line between a cell-5 and cell-7 heading; §4.4.1/§4.5.1 a centred heading is still followed by a blank line before a cell-5 heading (F-26 — see heading_blank_lines.test.mjs for the full tier-pair table)', () => {
  const lines = formatDocument({ blocks: [
    { type: 'heading', level: 1, text: 'Chapter' },
    { type: 'heading', level: 2, text: 'Section' },
    { type: 'heading', level: 3, text: 'Topic' },
    { type: 'para', text: 'Body text.' },
    { type: 'heading', level: 1, text: 'Part Two' },
    { type: 'para', text: 'More body text.' },
  ] }, opts('bana', { suppressHeader: true })).split('\f')[0].split(/\r?\n/);
  const at = (t) => lines.findIndex((l) => l.trim() === t);
  // F-26: `joinsWithoutBlank` used to fire for ANY heading-to-heading pair, wrongly
  // dropping the blank line BANA 4.4.1 (default) + 4.5.1 (unconditional) require between
  // a centred heading and the cell-5 heading that follows it — not one of 4.4.1's three
  // named exceptions. Fixed: the blank line is kept.
  assert.equal(lines[at('CHAPTER') + 1], '', `centred → cell-5 keeps its blank line (§4.4.1/§4.5.1): ${JSON.stringify(lines)}`);
  assert.equal(at('SECTION'), at('CHAPTER') + 2, `centred → cell-5 keeps its blank line (§4.4.1/§4.5.1): ${JSON.stringify(lines)}`);
  assert.equal(at('TOPIC'), at('SECTION') + 1, `cell-5 → cell-7 with no blank (§4.5.7/§4.6.2, unaffected by F-26): ${JSON.stringify(lines)}`);
  assert.equal(lines[at('TOPIC') + 1].trim(), 'BODY TEXT.', 'cell-7 heading followed directly by its text');
  assert.equal(lines[at('PART TWO') - 1], '', 'centred heading preceded by a blank line');
  assert.equal(lines[at('PART TWO') + 1], '', 'centred heading followed by a blank line before ordinary text');
});

test('BANA §4.5.3 / §8.3.3a / §13.3.1a: no blank line between a cell-5 or cell-7 heading and a list or poem', () => {
  const lines = formatDocument({ blocks: [
    { type: 'para', text: 'Intro.' },
    { type: 'heading', level: 2, text: 'Materials' },
    { type: 'list', items: [{ text: 'notebook' }, { text: 'pencil' }] },
    { type: 'heading', level: 3, text: 'Ode' },
    { type: 'play', subtype: 'verse', style: 'verse', text: 'A verse line' },
    { type: 'heading', level: 1, text: 'Vocabulary' },
    { type: 'list', items: [{ text: 'spider' }] },
  ] }, opts('bana', { suppressHeader: true })).split('\f')[0].split(/\r?\n/);
  const at = (t) => lines.findIndex((l) => l.trim() === t);
  assert.equal(lines[at('MATERIALS') - 1], '', 'cell-5 heading preceded by a blank line (§4.5.1)');
  assert.equal(lines[at('MATERIALS') + 1], 'NOTEBOOK', `list follows the cell-5 heading directly: ${JSON.stringify(lines)}`);
  assert.equal(lines[at('ODE') + 1], 'A VERSE LINE', `poem follows the cell-7 heading directly: ${JSON.stringify(lines)}`);
  assert.equal(lines[at('VOCABULARY') + 1], '', 'a centred heading is still followed by a blank line before a list (§4.4.1)');
});

test('UKAAF mode keeps the B004 list spacing (blank line before a list after a heading)', () => {
  const lines = formatDocument({ blocks: [
    { type: 'para', text: 'Intro.' },
    { type: 'heading', level: 2, text: 'Materials' },
    { type: 'list', items: [{ text: 'notebook' }] },
  ] }, opts('ukaaf', { suppressHeader: true })).split('\f')[0].split(/\r?\n/);
  const at = (t) => lines.findIndex((l) => l.trim() === t);
  assert.equal(lines[at('MATERIALS') + 1], '', JSON.stringify(lines));
});

test('BANA §4.3.7 / §14.4.1c: font attributes are dropped from headings and stage directions but kept in paragraphs', () => {
  const segs = [{ type: 'text', text: 'Plain and ' }, { type: 'text', text: 'bold', tf: 4 }];
  const o = opts('bana', { translate: tfTranslate, translatePos: tfTranslatePos });
  for (const level of [1, 2, 3]) {
    const h = formatBlock({ type: 'heading', level, segments: segs }, o, false).filter(Boolean);
    assert.equal(h.some((l) => l.includes('^')), false, `heading level ${level} drops tf: ${JSON.stringify(h)}`);
    const tr = traceBlock({ type: 'heading', level, segments: segs }, o, false);
    assert.deepEqual(tr.map((t) => t.s), formatBlock({ type: 'heading', level, segments: segs }, o, false), 'trace mirrors the formatter');
  }
  const st = formatBlock({ type: 'stage', segments: segs }, o);
  assert.equal(st.some((l) => l.includes('^')), false, `stage direction drops tf: ${JSON.stringify(st)}`);
  const p = formatBlock({ type: 'para', segments: segs }, o);
  assert.equal(p.some((l) => l.includes('^')), true, `paragraph keeps tf: ${JSON.stringify(p)}`);
  const g1 = formatBlock({ type: 'heading', level: 2, segments: [{ type: 'text', text: 'Word', uncontracted: true }] }, o, false);
  assert.equal(g1.some((l) => l.includes(';;')), true, 'uncontracted runs in a heading keep their grade-1 indicator');
});

test('BANA §8.6.2a: a retained print bullet marker is rendered as the UEB bullet _4 (dots 456, 256)', () => {
  const doc = { blocks: [{ type: 'list', items: [{ marker: '•', text: 'apple' }, { marker: '•', segments: [{ type: 'text', text: 'pear' }] }] }] };
  const o = opts('bana', { translate: upper, translatePos: tfTranslatePos });
  const lines = bodyLines(formatDocument(doc, o));
  assert.deepEqual(lines, ['_4 APPLE', '_4 PEAR'], JSON.stringify(lines));
  const tr = traceBlock(doc.blocks[0], o, false).map((t) => t.s);
  assert.deepEqual(tr, formatBlock(doc.blocks[0], o, false), 'trace mirrors the formatter');
});

test('styles: plain lists are their own style (DTBook <list type="pl">), index cites §21', () => {
  assert.equal(STYLE_DEFINITIONS.plain.name, 'Plain List');
  assert.equal(STYLE_DEFINITIONS.plain.xmlType, 'pl');
  assert.equal(STYLE_DEFINITIONS.plain.firstCell, 1);
  assert.equal(STYLE_DEFINITIONS.plain.runoverCell, 3);
  assert.equal(isListStyle('plain'), true);
  assert.match(STYLE_DEFINITIONS.index.description, /§21/);
  assert.doesNotMatch(STYLE_DEFINITIONS.index.description, /§18/);
  assert.match(formatStyleInspectorBadge('plain', 'bana'), /^Style: Plain List \(1-3\)/);
});
