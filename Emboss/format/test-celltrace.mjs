// Gate for the formatter-emitted cell trace (word/cell linking source of truth).
// 1) byte-exact: tracing must not change the BRF (gold path untouched).
// 2) no drift: the traced braille must be byte-identical to the real formatBlock
//    output for EVERY block type — otherwise the map would silently mis-tag.
// 3) correctness: known words map to the right cells for emphasis paragraphs, an
//    H1 (with its rule line), and a list — the cases the old approach couldn't do.
import path from 'path';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatBlock, traceBlock } from './document.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const translate = (t, tf) => louis.translate(t, T, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
const baseOpts = (extra = {}) => ({ mode: 'ukaaf', width: 38, depth: 25, listStyle: 'spaced', translate, translatePos, mathToBrf: null, ...extra });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// A document exercising every block type + emphasis + a list.
const model = { blocks: [
  { type: 'heading', level: 1, text: 'Chapter One' },
  { type: 'para', segments: [{ type: 'text', text: 'This word is ' }, { type: 'text', text: 'important', tf: 4 }, { type: 'text', text: ', and this is ' }, { type: 'text', text: 'emphasised', tf: 1 }, { type: 'text', text: '.' }] },
  { type: 'para', text: 'The quick brown fox jumps over the lazy dog.' },
  { type: 'heading', level: 2, text: 'A short list' },
  { type: 'list', items: [{ text: 'apples' }, { text: 'oranges and pears' }, { text: 'bananas' }] },
] };

// 1) byte-exact: trace on vs off
const off = formatDocument(model, baseOpts());
const trace = {};
const on = formatDocument(model, baseOpts({ trace }));
ok(off === on, 'tracing does not change the BRF (byte-exact preserved)');
ok(Array.isArray(trace.rowCells) && Array.isArray(trace.rows) && trace.rowCells.length === trace.rows.length, 'rowCells produced, parallel to rows');

// 2) no drift, for both modes + list styles
for (const mode of ['ukaaf', 'bana']) for (const listStyle of ['spaced', 'compact']) {
  const o = baseOpts({ mode, listStyle });
  for (const b of model.blocks) {
    const real = formatBlock(b, o);
    const traced = traceBlock(b, o);
    ok(traced.length === real.length && traced.every((t, i) => t.s === real[i]),
      `no drift: ${b.type}${b.level ? b.level : ''} in ${mode}/${listStyle}`);
    // every non-null src cell must sit on a NON-space braille cell
    traced.forEach((t) => { for (let i = 0; i < t.s.length; i++) if (t.src[i] != null) ok(t.s[i] !== ' ', `src on a non-space cell (${b.type})`); });
  }
}

// 3) correctness — pull the cell map for a block and check a word's cells.
function cellsForWord(block, o, unit, wordStart, wordEnd) {
  const traced = traceBlock(block, o);
  const out = [];
  for (const line of traced) for (let i = 0; i < line.s.length; i++) { const s = line.src[i]; if (s && s.u === unit && s.c >= wordStart && s.c < wordEnd) out.push(line.s[i]); }
  return out.join('');
}
{
  const o = baseOpts();
  // emphasis paragraph: "important" is bold, chars 13..22 of the flat text
  const emph = model.blocks[1];
  const flat = 'This word is important, and this is emphasised.';
  const iStart = flat.indexOf('important'), iEnd = iStart + 'important'.length;
  const cells = cellsForWord(emph, o, 0, iStart, iEnd);
  ok(cells.includes('IMPORTANT') && cells.length > 'important'.length, `emphasis paragraph maps "important" to cells + its emphasis indicator: "${cells}"`);
  // plain paragraph: "brown" chars 10..15 → BR[N
  const plain = model.blocks[2];
  ok(cellsForWord(plain, o, 0, 10, 15) === 'BR[N', '"brown" in the plain paragraph → BR[N');
  // H1: rule line cells are all null; "one" (chars 8..11) still maps
  const h1 = traceBlock(model.blocks[0], o);
  const ruleLine = h1.find((l) => l.s.includes('3') && l.src.every((s) => s == null));
  ok(!!ruleLine, 'H1 rule line has no source cells (all null)');
  ok(cellsForWord(model.blocks[0], o, 0, 8, 11).length > 0, 'H1 heading text still maps ("One")');
  // em-dash sentence with multiple "and" occurrences
  const emDashPara = { type: 'para', text: 'Click any word here and its braille lights up beside it — and the other way round.' };
  const emDashTraced = traceBlock(emDashPara, o);
  const emText = emDashPara.text;
  const firstAndIdx = emText.indexOf('and');
  const secondAndIdx = emText.indexOf('and', firstAndIdx + 1);
  const firstAndCells = cellsForWord(emDashPara, o, 0, firstAndIdx, firstAndIdx + 3);
  const secondAndCells = cellsForWord(emDashPara, o, 0, secondAndIdx, secondAndIdx + 3);
  ok(firstAndCells === '&', `first "and" maps to single contracted cell & (got "${firstAndCells}")`);
  ok(secondAndCells === '&', `second "and" maps to single contracted cell & (got "${secondAndCells}")`);
  const emDashCells = cellsForWord(emDashPara, o, 0, emText.indexOf('—'), emText.indexOf('—') + 1);
  ok(emDashCells === ',-', `em-dash maps to UEB dash cells ,- (got "${emDashCells}")`);

  // BANA & UKAAF styled blocks cell-trace invariants
  const styledBlocks = [
    { type: 'play', subtype: 'prose', text: 'HAMLET: To be, or not to be, that is the question.' },
    { type: 'stage', text: 'Enter Ghost and Hamlet.' },
    { type: 'caption', text: 'Figure 1. The structure of an atom.' },
    { type: 'footnote', text: 'See page 45 for additional notes.' },
    { type: 'note', text: 'Transcriber note on symbols used.' },
  ];

  for (const sb of styledBlocks) {
    const real = formatBlock(sb, o);
    const traced = traceBlock(sb, o);
    ok(traced.length === real.length && traced.every((t, i) => t.s === real[i]),
      `styled block no drift: ${sb.type}`);
    // Check first word maps to non-empty cells
    const firstWord = sb.text.split(' ')[0];
    const wCells = cellsForWord(sb, o, 0, 0, firstWord.length);
    ok(wCells.length > 0, `first word "${firstWord}" in ${sb.type} maps to cells "${wCells}"`);
  }

  // Table blocks (Spatial and Listed) cell-trace invariants
  const tableBlocks = [
    {
      type: 'table',
      headers: ['Planet', 'Moons', 'Mass'],
      rows: [
        ['Earth', '1', '5.97'],
        ['Mars', '2', '0.64'],
        ['Jupiter', '79', '1898']
      ],
      format: 'spatial'
    },
    {
      type: 'table',
      headers: ['Word', 'Definition'],
      rows: [
        ['Aspect', 'A particular part or feature of something.'],
        ['Context', 'The circumstances that form the setting for an event.']
      ],
      format: 'listed',
      caption: 'Vocabulary Table',
      tabletn: 'Listed format used for narrative definitions'
    }
  ];

  for (const tb of tableBlocks) {
    const real = formatBlock(tb, o);
    const traced = traceBlock(tb, o);
    ok(traced.length === real.length && traced.every((t, i) => t.s === real[i]),
      `table no drift: format=${tb.format}`);
    traced.forEach((t) => {
      for (let i = 0; i < t.s.length; i++) {
        if (t.src[i] != null) ok(t.s[i] !== ' ', `table src on non-space cell (${tb.format})`);
      }
    });

    // Check header cell coordinate mapping
    const h0Cells = cellsForWord(tb, o, 0, 0, tb.headers[0].length);
    ok(h0Cells.length > 0, `header 0 "${tb.headers[0]}" maps to cells: "${h0Cells}"`);

    // Check first data row first cell
    const r0c0Unit = tb.headers.length;
    const r0c0Word = tb.rows[0][0];
    const r0c0Cells = cellsForWord(tb, o, r0c0Unit, 0, r0c0Word.length);
    ok(r0c0Cells.length > 0, `row 0 cell 0 "${r0c0Word}" maps to cells: "${r0c0Cells}"`);
  }
}

// Table cells with emphasis, grade-1 runs and maths (A25): markup strings and
// { text, segments } objects, in every table format and both modes, with a stub maths
// translator so the maths cells take part.
{
  const richCells = (format) => ({
    type: 'table', format,
    headers: [{ text: 'Term', segments: [{ type: 'text', text: 'Term', tf: 4 }] }, 'Value *(units)*'],
    rows: [
      ['**Area** of a circle', { text: 'pi r^2', segments: [{ type: 'math', latex: '\\pi r^2' }, { type: 'text', text: ' square units' }] }],
      ['`www.example.com`', 'plain 5 \\* 3'],
      [{ text: 'x', segments: [{ type: 'text', text: 'the ' }, { type: 'text', text: 'first', tf: 1 }, { type: 'text', text: ' entry' }] }, ''],
    ],
  });
  for (const mode of ['ukaaf', 'bana']) {
    const o = baseOpts({ mode, mathToBrf: (seg) => `_${seg.latex.length}` });
    for (const format of ['spatial', 'listed', 'paragraph']) {
      const tb = richCells(format);
      const real = formatBlock(tb, o);
      const traced = traceBlock(tb, o);
      ok(traced.length === real.length && traced.every((t, i) => t.s === real[i]),
        `rich-cell table no drift: ${format}/${mode}\n    real:   ${JSON.stringify(real)}\n    traced: ${JSON.stringify(traced.map((t) => t.s))}`);
      traced.forEach((t) => { for (let i = 0; i < t.s.length; i++) if (t.src[i] != null) ok(t.s[i] !== ' ', `rich-cell src on non-space cell (${format}/${mode})`); });
      ok(cellsForWord(tb, o, 2, 2, 6).length > 0, `bold "Area" maps to cells (${format}/${mode})`);
      ok(!real.join('\n').includes('**'), `no literal markup in braille (${format}/${mode})`);
    }
  }
}

console.log(`\ncell-trace gate: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
