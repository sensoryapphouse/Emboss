// Formatter fixes from the BANA Formats section 13 (Poetry and song lyrics) and 15 (Line-numbered material)
// gold sets (23 Sep 2026). Every new field is optional; without it output is unchanged.
//  - para.paraNumber: margin paragraph number inline before the paragraph (15.2.1b, F-205)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (s, tf) => ({ braille: translate(s, tf), inputPos: Array.from(s, (_, i) => i) });
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const fmt = (block, o = opts) => clean(formatBlock(block, o));
const trc = (block, o = opts) => clean(traceBlock(block, o).map((t) => t.s));
const both = (block, o = opts) => { const a = fmt(block, o); assert.deepEqual(trc(block, o), a, 'traceBlock differs from formatBlock'); return a; };
const doc = (blocks, o = opts) => clean((formatDocument({ title: null, blocks }, o) || '').split('\x0c').join('\r\n').split('\r\n'));
const T = (text, extra = {}) => ({ type: 'text', text, ...extra });
const LN = (text) => ({ type: 'linenum', text });

test('F-205 paraNumber: paragraph number inline, no right-margin number, no automatic note (15.2.1b)', () => {
  const segs = [LN('20'), T('Now, the wolf had put on the old lady\'s shawl and cap.')];
  const plain = both({ type: 'para', segments: segs });
  assert.ok(/#BJ$/.test(plain[0]), 'default: number at the right margin ' + plain[0]);
  const p = { type: 'para', paraNumber: true, segments: segs };
  const out = both(p);
  assert.ok(out[0].startsWith('  #BJ ,N['), out.join('\n'));
  assert.ok(!/#BJ$/.test(out[0]));
  // whole document: no note, and the number does not trigger the line-number note
  const d = doc([p, { type: 'para', paraNumber: true, segments: [LN('21'), T('"What a deep voice you have," said the little girl in surprise.')] }]);
  assert.ok(!d.join('\n').includes('@.<'), d.join('\n'));
  assert.ok(d.some((l) => l.startsWith('  #BA ')), d.join('\n'));
  assert.notEqual(getBlockSignature(p, opts, false), getBlockSignature({ ...p, paraNumber: false }, opts, false));
});

const countedSegs = [
  T('Sandy had a rat that ate fast. She said, “That rat eats too'), LN('13'),
  T('much. I must make the rat slow down.”'), LN('21'),
];
test('F-208 countedWords: number on the row where the print line ends, three blank cells after it, rule note (15.8.1)', () => {
  const p = { type: 'para', countedWords: true, segments: [...countedSegs] };
  const out = both({ ...p, lnNote: true });
  assert.ok(out[0].includes('@.<,?REE BLANK CELLS'), out.join('\n'));
  const rows = out.filter((l) => /#[A-J]+$/.test(l));
  assert.equal(rows.length, 2, out.join('\n'));
  assert.ok(/TOO {3}\S/.test(out.join('\n')), 'three blank cells after the end of the print line\n' + out.join('\n'));
  assert.ok(/#AC$/.test(rows[0]) && /#BA$/.test(rows[1]), out.join('\n'));
  // default (no field): the ordinary line-numbered wrap, unchanged
  const dflt = both({ type: 'para', lnNote: true, segments: [LN('13'), countedSegs[0], LN('21'), countedSegs[2]] });
  assert.ok(dflt.join('\n').includes(',L9E NUMB]S'), dflt.join('\n'));
  assert.notEqual(getBlockSignature(p, opts, false), getBlockSignature({ ...p, countedWords: false }, opts, false));
});

test('F-208 countedWords: a row holds one number; a print line that would end on it starts a new row', () => {
  const p = { type: 'para', countedWords: true, lnNoteOff: true, segments: [T('aa bb cc dd'), LN('4'), T('ee ff'), LN('6')] };
  const out = both(p);
  assert.equal(out.length, 2, out.join('\n'));
  assert.ok(/#D$/.test(out[0]) && /#F$/.test(out[1]), out.join('\n'));
  const q = { type: 'para', countedWords: true, lnNoteOff: true, segments: [T('aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss'), LN('19'), T('tt uu'), LN('21')] };
  const o2 = both(q);
  assert.ok(o2.every((l) => l.replace(/ +#[A-J]+$/, '').length <= 40 - 3 - 2), o2.join('\n'));   // text ends 2 cells before the widest number (3 cells wide)
});

test('F-234 lnNoteBeforeHeading: the automatic note precedes the heading (Sample 15-9); default after', () => {
  const h = { type: 'heading', level: 1, text: 'The Rat' };
  const p = { type: 'para', countedWords: true, segments: [...countedSegs] };
  const after = doc([h, p]);
  const before = doc([h, { ...p, lnNoteBeforeHeading: true }]);
  assert.ok(after.findIndex((l) => l.includes('@.<')) > after.findIndex((l) => l.includes(',RAT')), after.join('\n'));
  const iNote = before.findIndex((l) => l.includes('@.<')), iHead = before.findIndex((l) => l.includes(',RAT'));
  assert.ok(iNote >= 0 && iNote < iHead, before.join('\n'));
  assert.equal(before.filter((l) => l.includes('@.<')).length, 1, before.join('\n'));
  assert.equal(before[iHead - 1], '', before.join('\n'));
});

test('15.7.3d rhymeLetters: letter ends one cell before the widest line number; number keeps the margin; text stops before the letter', () => {
  const v = (letter, num, text, level = 0) => ({ type: 'play', subtype: 'verse', style: 'verse', ...(level ? { level } : {}), rhymeLetters: true, segments: [LN(letter), ...(num ? [LN(num)] : []), T(text)] });
  const blocks = [v('a', null, 'I wonder do you feel to-day'), v('b', null, 'As I have felt since, hand in hand,', 1), v('a', '5', 'This morn of Rome and May?'), v('c', '10', 'To catch at and let go.')];
  const d = doc(blocks);
  assert.ok(d.includes(',I WOND] D Y FEEL TO-"D            A'), d.join('\n'));
  assert.ok(d.includes(',? MORN ( ,ROME & ,MAY8            A  #E'), d.join('\n'));
  assert.ok(d.includes(',TO CAT* AT & LET G4              ;C #AJ'), d.join('\n'));
  for (const b of blocks) both(b, { ...opts, lineNumberWidth: 3 });   // trace parity
  // without the field the letter is an ordinary right-margin number word (unchanged)
  const plain = doc(blocks.map((b) => ({ ...b, rhymeLetters: undefined })));
  assert.ok(!plain.includes(',I WOND] D Y FEEL TO-"D            A'));
  assert.notEqual(getBlockSignature(blocks[0], opts, false), getBlockSignature({ ...blocks[0], rhymeLetters: false }, opts, false));
});

test('spaced ellipsis (glossary: three equally spaced periods): ". . ." is 444 when doc.spacedEllipsis; default unchanged; trace positions kept', () => {
  const p = { type: 'para', segments: [T('“Shut up, . . . !” the soldier hissed. Then . . . . nothing, ' ), T('bold', { tf: 1 })] };
  const run = (extra) => clean((formatDocument({ title: null, blocks: [p], ...extra }, opts) || '').split('\x0c').join('\r\n').split('\r\n'));
  assert.ok(run({}).join('\n').includes('4 4 4'), run({}).join('\n'));
  const on = run({ spacedEllipsis: true }).join('\n');
  assert.ok(on.includes('UP1 44460'), on);
  assert.ok(on.includes('4444'), on);
  assert.ok(!on.includes('4 4'), on);
  // the option form gives the same result, through the cell-trace path (translatePos) too
  const viaOpt = clean((formatDocument({ title: null, blocks: [p] }, { ...opts, spacedEllipsis: true }) || '').split('\x0c').join('\r\n').split('\r\n')).join('\n');
  assert.equal(viaOpt, on);
});

const verse = (text, extra = {}) => ({ type: 'play', subtype: 'verse', style: 'verse', text, ...extra });
test('F-124 wideSpaces: a run of spaces in a verse line is three blank cells (13.6.3); default collapses', () => {
  const v = verse('greens  coo  l choc', { wideSpaces: true });
  assert.deepEqual(both(v), ['GRE5S   COO   ;L *OC']);
  assert.deepEqual(both(verse('greens  coo  l choc')), ['GRE5S COO ;L *OC']);
  const segs = { ...verse('x'), wideSpaces: true, segments: [T('pinks   shy'), T(' end', { tf: 1 })] };
  assert.ok(both(segs)[0].includes('   '), both(segs)[0]);
  assert.notEqual(getBlockSignature(v, opts, false), getBlockSignature({ ...v, wideSpaces: false }, opts, false));
});

test('F-125 uncontractedPoem: one grade 1 passage indicator and terminator around the whole poem (13.6.4a)', () => {
  const lines = ['brought allofher tremB', '-ling', 'to a:dead.', 'stand-', ';Still)'];
  const blocks = lines.map((t, i) => verse(t, i === 0 ? { uncontractedPoem: true } : {}));
  blocks.splice(3, 0, { type: 'indicator', kind: 'line' });
  const d = doc(blocks).filter((l) => l !== '');
  assert.equal(d[0], ';;;BROUGHT ALLOFHER TREM,B', d.join('\n'));
  assert.equal(d.filter((l) => l.includes(';;;')).length, 1, d.join('\n'));
  assert.equal(d.filter((l) => l.endsWith(";'")).length, 1, d.join('\n'));
  assert.ok(d[d.length - 1].endsWith(`">;'`), d.join('\n'));
  // per-line traceBlock parity for the first and last lines
  const marked = blocks.filter((b) => b.type === 'play').map((b, i, a) => ({ ...b, uncontractedPoem: true, g1Open: i === 0, g1Close: i === a.length - 1 }));
  for (const b of marked) both(b);
  // default unchanged
  assert.ok(!doc(lines.map((t) => verse(t))).join('\n').includes(';;;'));
  assert.notEqual(getBlockSignature(marked[0], opts, false), getBlockSignature({ ...marked[0], g1Open: false }, opts, false));
});

test('13.11.2b songInfo: items under a song title at 7-5, no blank between, blank before verse 1; default 2-space paragraphs', () => {
  const h = { type: 'heading', level: 1, text: 'Over the Rainbow' };
  const items = ['from The Wizard of Oz', 'Words by E. Y. Harburg', 'Music by Harold Arlen'].map((text) => ({ type: 'para', songInfo: true, text }));
  const v = verse('Somewhere over the rainbow, way up high,');
  const d = doc([h, ...items, v]);
  assert.equal(d[1], '', d.join('\n'));                       // blank after the title
  assert.ok(d[2].startsWith('      ') && !d[2].startsWith('       '), d.join('\n'));
  assert.ok(d[3].startsWith('      ,^WS') && d[4].startsWith('      ,MUSIC'), d.join('\n'));
  assert.equal(d[5], '', d.join('\n'));
  assert.ok(d[6].startsWith(',"S'), d.join('\n'));
  const long = { type: 'para', songInfo: true, text: 'Words by E. Y. Harburg and someone else entirely, for this test' };
  const lines = both(long);
  assert.ok(lines[0].startsWith('      ,^WS') && lines[1].startsWith('    ') && !lines[1].startsWith('     '), lines.join('\n'));
  const plain = doc([h, ...items.map((b) => ({ ...b, songInfo: undefined })), v]);
  assert.ok(plain[2].startsWith('  ') && !plain[2].startsWith('   '), plain.join('\n'));
});

test('elision apostrophe (comin’, courtin’): word-final U+2019 that closes no opening quote is an apostrophe when doc.elisionApostrophe', () => {
  const p = { type: 'para', segments: [T('By courtin’ too slow, ‘go’ now.')] };
  const run = (extra) => doc([p].map((b) => b), opts).join('\n') && clean((formatDocument({ title: null, blocks: [p], ...extra }, opts) || '').split('\x0c').join('\r\n').split('\r\n')).join('\n');
  const off = run({}), on = run({ elisionApostrophe: true });
  assert.ok(off.includes('C\\RT9,0'), off);
  assert.ok(on.includes("C\\RT9' "), on);
  assert.ok(on.includes(',8G,0'), on);                       // the closing quote of a quotation stays
});

test('numeric reference mark directly before a word starting a-j takes the grade 1 terminator (UEB 5.6.2; Sample 13-08)', () => {
  const mk = (word) => ({ type: 'para', continuation: true, segments: [{ type: 'noteref', text: '1' }, T(word)] });
  assert.equal(both(mk('clarion'))[0], ";9#A;'CL>ION");
  assert.equal(both(mk('kite'))[0].includes(";'"), false, 'a letter beyond j cannot be read as a digit: unchanged');
  const spaced = both({ type: 'para', continuation: true, segments: [{ type: 'noteref', text: '1' }, T(' clarion')] })[0];
  assert.ok(!spaced.includes(";'"), spaced);
});

test('13.3.1c displayedPoem: a poem centred in print is displayed material, two cells in; default 1-3 unchanged', () => {
  const a = both(verse('Go and catch a falling star,', { displayedPoem: true }));
  assert.ok(a[0].startsWith('  ,G'), a.join('\n'));
  const b = both(verse('Go and catch a falling star,'));
  assert.ok(b[0].startsWith(',G'), b.join('\n'));
  assert.notEqual(getBlockSignature(verse('x', { displayedPoem: true }), opts, false), getBlockSignature(verse('x'), opts, false));
});
