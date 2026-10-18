// Formatter fixes from the section 9 / 13 / 14 / 15 gold diagnoses (23 Sep 2026):
//   BANA 9.4.1   no blank between a poem and its attribution
//   F-84         optional `notConnected` on the later of two adjacent same-tier headings
//   9.4.1/9.5.1  attribution fragments do not chain; a source citation under a heading (9.5.2)
//   F-79         displayed list (9.2.2e) at 3-5
//   F-104        cross-reference / incidental note (9.6.1): 7-5, or 7-7 heading + 5-5 note
//   F-206        three blank cells after a speaker's name (14.6.2a, 15.5.2b)
//   F-241        only a leading label of a transcriber's note enclosed (14.10.2)
//   F-240        no blank between a stage direction and the verse run after it (14.5.3d)
//   F-234        line-number note wording / suppression
//   15.5.1c      unnumbered verse lines keep the number column in line-numbered text
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, suppressHeader: true, ...extra });
const bodyLines = (doc, extra) => formatDocument(doc, opts(extra)).split('\f')[0].split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
const verse = (text, level = 0, extra = {}) => ({ type: 'play', subtype: 'verse', text, level, ...extra });
const parity = (block, extra = {}) => {
  const o = { ...opts(extra), translatePos: upPos };
  const formatted = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
};

test('9.4.1: no blank line between a poem and its attribution, blank after the attribution', () => {
  const lines = bodyLines({ blocks: [verse('Line one'), verse('Line two'), { type: 'attribution', text: 'A Poet' }, { type: 'para', text: 'After.' }] });
  const i = lines.indexOf('LINE TWO');
  assert.ok(i > 0, lines.join('|'));
  assert.match(lines[i + 1], /^ {4}A POET$/, lines.join('|'));
  assert.equal(lines[i + 2], '');
});

test('poem with no attribution keeps its trailing blank line (unchanged)', () => {
  const lines = bodyLines({ blocks: [verse('Line one'), verse('Line two'), { type: 'para', text: 'After.' }] });
  const i = lines.indexOf('LINE TWO');
  assert.equal(lines[i + 1], '');
});

test('F-84: adjacent centred headings join by default; notConnected keeps the blank', () => {
  const joined = bodyLines({ blocks: [{ type: 'heading', level: 1, text: 'A Victim' }, { type: 'heading', level: 1, text: 'by Someone' }, { type: 'para', text: 'Text.' }] });
  const a = joined.findIndex((l) => l.includes('A VICTIM'));
  assert.ok(joined[a + 1].includes('BY SOMEONE'), joined.join('|'));
  const apart = bodyLines({ blocks: [{ type: 'heading', level: 1, text: 'A Victim' }, { type: 'heading', level: 1, text: 'by Someone', notConnected: true }, { type: 'para', text: 'Text.' }] });
  const b = apart.findIndex((l) => l.includes('A VICTIM'));
  assert.equal(apart[b + 1], '');
  assert.ok(apart[b + 2].includes('BY SOMEONE'), apart.join('|'));
});

test('9.5.2/9.5.1b: a source citation under a heading sits 4 cells right of the heading line; a plain attribution keeps cell 5', () => {
  const src = bodyLines({ blocks: [{ type: 'heading', level: 1, text: 'Title' }, { type: 'attribution', kind: 'source', text: 'Cite' }] });
  const h = src.findIndex((l) => l.includes('TITLE'));
  const hi = src[h].length - src[h].trimStart().length;
  const ci = src[h + 1].length - src[h + 1].trimStart().length;
  assert.equal(ci, hi + 4, src.join('|'));
  const att = bodyLines({ blocks: [{ type: 'heading', level: 1, text: 'Title' }, { type: 'attribution', text: 'Cite' }] });
  const j = att.findIndex((l) => l.includes('TITLE'));
  assert.equal(att[j + 2].length - att[j + 2].trimStart().length, 4, att.join("|"));
});

test('9.4.1: print-adjacent attribution fragments (continued) stay at one cell instead of chaining', () => {
  const lines = bodyLines({ blocks: [{ type: 'para', style: 'quote', text: 'Quoted.' }, { type: 'attribution', continued: true, text: '(Signed)' }, { type: 'attribution', text: 'Name' }] });
  const a = lines.findIndex((l) => l.includes('(SIGNED)'));
  const n = lines.findIndex((l) => l.includes('NAME'));
  const ind = (l) => l.length - l.trimStart().length;
  assert.equal(ind(lines[a]), ind(lines[n]), lines.join('|'));
});

test('F-79 / 9.2.2e: a displayed list starts at cell 3 with runover at cell 5; default list unchanged', () => {
  const items = [{ text: 'A displayed sentence long enough to wrap onto a second braille line, yes indeed.' }];
  const d = formatBlock({ type: 'list', kind: 'list', displayed: true, items }, opts(), false).filter(Boolean);
  assert.match(d[0], /^ {2}\S/); assert.match(d[1], /^ {4}\S/);
  const p = formatBlock({ type: 'list', kind: 'list', items }, opts(), false).filter(Boolean);
  assert.match(p[0], /^\S/); assert.match(p[1], /^ {2}\S/);
  parity({ type: 'list', kind: 'list', displayed: true, items });
});

test('F-104 / 9.6.1: incidental note 7-5 without heading, 7-7 + 5-5 with heading, blank before and after', () => {
  const t = 'For more information go online to see the companion website of this book now.';
  const n = formatBlock({ type: 'xref', text: t }, opts(), false);
  assert.equal(n[0], ''); assert.equal(n[n.length - 1], '');
  assert.match(n[1], /^ {6}\S/); assert.match(n[2], /^ {4}\S/);
  const h = formatBlock({ type: 'xref', heading: 'See also', text: t }, opts(), false);
  assert.match(h[1], /^ {6}SEE ALSO$/); assert.match(h[2], /^ {4}\S/);
  parity({ type: 'xref', text: t }); parity({ type: 'xref', heading: 'See also', text: t });
});

test('F-206 / 14.6.2a: speakerGap puts three blank cells after the speaker name', () => {
  const g = formatBlock(verse('SEBASTIAN: Do so.', 0, { playVerse: true, speakerGap: true }), opts(), false);
  assert.equal(g[0], 'SEBASTIAN:   DO SO.');
  const d = formatBlock(verse('SEBASTIAN: Do so.', 0, { playVerse: true }), opts(), false);
  assert.equal(d[0], 'SEBASTIAN: DO SO.');
  parity(verse('SEBASTIAN: Do so, and then go on a little further for the wrap.', 0, { playVerse: true, speakerGap: true }));
});

test('F-241 / 14.10.2: enclosePrefix encloses only the label; default encloses everything', () => {
  const p = formatBlock({ type: 'note', text: 'Cartoon title, artist and date', enclosePrefix: 'Cartoon' }, opts(), false);
  assert.match(p[0], /@\.<CARTOON@\.> TITLE/);
  assert.ok(!p.join('').endsWith('@.>') || p.join('').includes('CARTOON@.>'));
  const d = formatBlock({ type: 'note', text: 'Cartoon title, artist and date' }, opts(), false);
  assert.match(d[0], /^ {6}@\.<CARTOON TITLE/);
  parity({ type: 'note', text: 'Cartoon title, artist and date and more words to wrap', enclosePrefix: 'Cartoon' });
});

test('F-240 / 14.5.3d: no blank between a stage direction and the verse-play run after it', () => {
  const lines = bodyLines({ blocks: [{ type: 'play', subtype: 'prose', text: 'King: Follow her.' }, { type: 'stage', text: '[Exit.]' }, verse('O, this is grief;', 1, { playVerse: true }), verse('All from her death.', 1, { playVerse: true })] });
  const s = lines.findIndex((l) => l.includes('[EXIT.]'));
  assert.ok(lines[s + 1].includes('O, THIS IS GRIEF'), lines.join('|'));
});

test('F-234: lnNoteText replaces the automatic note wording; lnNoteOff suppresses it', () => {
  const numbered = (extra = {}) => ({ type: 'para', segments: [{ type: 'text', text: 'Some prose ' }, { type: 'linenum', text: '5' }, { type: 'text', text: ' more prose.' }], ...extra });
  const auto = bodyLines({ blocks: [numbered()] }).join('|');
  assert.match(auto, /LINE NUMBERS ARE SHOWN/);
  const custom = bodyLines({ blocks: [numbered({ lnNoteText: 'Three blank cells mark a new print line.' })] }).join('|');
  assert.match(custom, /THREE BLANK CELLS MARK/); assert.doesNotMatch(custom, /LINE NUMBERS ARE SHOWN/);
  const off = bodyLines({ blocks: [numbered({ lnNoteOff: true })] }).join('|');
  assert.doesNotMatch(off, /@\.</);
});

test('15.5.1c: an unnumbered verse line in a line-numbered document ends before the number column', () => {
  const long = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
  const withNum = bodyLines({ blocks: [verse('Numbered line', 0, { segments: [{ type: 'text', text: 'Numbered line ' }, { type: 'linenum', text: '10' }] }), verse(long)] }, {});
  const plain = bodyLines({ blocks: [verse(long)] });
  const maxW = (ls) => Math.max(...ls.map((l) => l.length));
  assert.ok(maxW(plain) > 36, plain.join('|'));
  assert.ok(withNum.filter((l) => /AAAA|IIII|JJJJ/.test(l)).every((l) => l.length <= 40 - 3 - 2 + 0), withNum.join('|'));
  parity({ ...verse(long), lnMargin: true }, { lineNumberWidth: 3 });
});
