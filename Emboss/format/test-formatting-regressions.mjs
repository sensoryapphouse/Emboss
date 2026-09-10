// Formatting regression pins — one check per defect fixed in the 2026-09 formatter
// audit (see the numbered comments). Runs the real liblouis engine like the other
// gates. Every pin is a CONSTRUCTED input that reproduced the defect before the fix.
import path from 'path';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatVolumes, convertImageToBrailleMatrix } from './document.mjs';
import { styledTranslate } from './text-style.mjs';
import { wrapCells } from './layout.mjs';
import { BRF64 } from '../engine/brf-ascii.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const raw = (t, tf) => louis.translate(t, T, tf);
const translate = styledTranslate(raw, 'faithful');
const translateG1 = (t) => louis.translate(t, louis.TABLES.uebG1);
const BRF_SET = new Set(BRF64.split(''));
const cell = (...dots) => dots.map((d) => String.fromCodePoint(0x2800 + d)).join('');   // Unicode braille from dot values
const base = (mode, extra = {}) => ({ mode, width: mode === 'bana' ? 40 : 38, depth: 25, listStyle: 'spaced', toc: false, translate, ...extra });
const pagesOf = (brf) => brf.split('\x0c').map((p) => { const a = p.split('\r\n'); a.pop(); return a; });
const allLines = (brf) => pagesOf(brf).flat();
const badChars = (brf) => allLines(brf).flatMap((l) => [...l].filter((c) => !BRF_SET.has(c)));
const maxLen = (brf) => Math.max(0, ...allLines(brf).map((l) => l.length));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// #1 literal lowercase strings must be translated / replaced by BRF indicators
{
  const brf = formatDocument({ blocks: [{ type: 'code', text: 'for (i = 0; i < n; i++) {\n  print(i);\n}' }] }, base('ukaaf'));
  ok(badChars(brf).length === 0, `#1 code block emits only BRF chars, got ${JSON.stringify(badChars(brf))}`);
  const lines = allLines(brf);
  ok(lines.includes(';;;') && lines.includes(";'"), '#1 code block is a grade-1 passage (;;; … ;\')');
  const listed = formatDocument({ blocks: [{ type: 'table', headers: ['Name', 'Age', 'City'], rows: [['Ann', '31', 'Leeds'], ['Bob', '', 'York']] }] }, base('ukaaf', { tableFormat: 'listed' }));
  ok(badChars(listed).length === 0, `#1 listed table emits only BRF chars, got ${JSON.stringify(badChars(listed))}`);
  ok(listed.includes('@.<' + translate('Table: Listed Table Format') + '@.>'), '#1 listed-table TN is translated and wrapped in @.< … @.>');
}

// #2 Unicode braille (tactile raster, cover borders) mapped to BRF ASCII
{
  const lines = convertImageToBrailleMatrix(new Uint8Array(4 * 4 * 4).fill(0), 4, 4, 4);
  ok(lines.every((l) => [...l].every((c) => c.codePointAt(0) <= 0x283f)), '#2 raster is built from 6-dot cells (no dots 7/8)');
  const brf = formatDocument({ blocks: [{ type: 'graphic', alt: 'Square', lines: [...lines, ' ** '] }] }, base('ukaaf'));
  ok(badChars(brf).length === 0, `#2 tactile lines emit only BRF chars, got ${JSON.stringify(badChars(brf))}`);
  ok(allLines(brf).some((l) => l.trim() === '===='), '#2 full cells land as "=" in the BRF');
  const blocks = Array.from({ length: 60 }, (_, i) => ({ type: 'para', text: `Paragraph ${i} with enough words to fill the braille page quickly and cleanly.` }));
  const vols = formatVolumes({ title: 'A Book', blocks }, base('ukaaf', { volumePages: 2, includeCovers: true }));
  ok(vols.length > 1 && vols.every((v) => badChars(v.brf).length === 0), '#2 volume covers emit only BRF chars');
}

// #3 indents are clamped into the page; the width is never widened
{
  ok(wrapCells('A B C', 10, 12, 12).every((l) => l.length <= 10), '#3 wrapCells clamps an indent >= width');
  const brf = formatDocument({ blocks: [{ type: 'list', items: [{ text: 'alpha beta', level: 4 }, { text: 'gamma delta', level: 19 }] }] }, base('ukaaf', { width: 10 }));
  ok(maxLen(brf) <= 10, `#3 deep list levels stay within width 10 (max ${maxLen(brf)})`);
  const toc = formatDocument({ blocks: [{ type: 'list', kind: 'toc', items: [{ text: 'x', page: '1234567890123456789012345678901234567890' }] }] }, base('ukaaf'));
  ok(maxLen(toc) <= 38, `#3 toc-kind leader line stays within width (max ${maxLen(toc)})`);
}

// #4 transcriber's note indicators are UEB @.< … @.> in both modes, text translated
for (const mode of ['ukaaf', 'bana']) {
  const brf = formatDocument({ blocks: [{ type: 'note', text: 'Image: a cat' }] }, base(mode));
  const line = allLines(brf).find((l) => l.startsWith('@.<'));
  ok(line === '@.<' + translate('Image: a cat') + '@.>', `#4 ${mode} TN = ${JSON.stringify(allLines(brf))}`);
}

// #5 the colon is translated (UEB dots 25 = "3"), not a raw ":" cell
{
  const g = formatDocument({ blocks: [{ type: 'glossary', items: [{ term: 'Cat', def: 'A small animal.' }] }] }, base('ukaaf'));
  ok(allLines(g).includes(translate('Cat: A small animal.')), `#5 glossary entry translated whole: ${JSON.stringify(allLines(g).filter(Boolean))}`);
  const t = formatDocument({ blocks: [{ type: 'table', headers: ['Name', 'Age'], rows: [['Ann', '31']] }] }, base('ukaaf', { tableFormat: 'listed' }));
  ok(allLines(t).some((l) => l.trim() === translate('Age: 31')), `#5 listed-table value line translated whole`);
}

// #6 uncontracted runs: G1 table when supplied, UEB grade-1 indicators, terminator ;'
{
  const segs = [{ type: 'text', text: 'The word ' }, { type: 'text', text: 'knowledge', uncontracted: true }, { type: 'text', text: ' and ' }, { type: 'text', text: 'about the world', uncontracted: true }, { type: 'text', text: '.' }];
  const withG1 = formatDocument({ blocks: [{ type: 'para', segments: segs }] }, base('ukaaf', { translateG1 }));
  const flat = allLines(withG1).map((l) => l.trim()).join(' ');            // the passage may wrap across lines
  ok(flat.includes(';;KNOWLEDGE') && /;;;ABOUT THE WORLD;'/.test(flat), `#6 G1 run: ${JSON.stringify(allLines(withG1))}`);
  const noG1 = formatDocument({ blocks: [{ type: 'para', segments: segs }] }, base('ukaaf'));
  ok(noG1.includes(";'") && !noG1.includes(";,'"), `#6 fallback terminator is ;' : ${JSON.stringify(allLines(noG1))}`);
}

// #7 page boundaries: no heading (or its indicator line) on the last content line; no blank at the top
for (const mode of ['ukaaf', 'bana']) {
  let headingLast = 0, blankFirst = 0, indicatorLast = 0;
  const headingLines = new Set(Array.from({ length: 8 }, (_, k) => translate(`Heading ${k}`)));
  for (let fill = 1; fill <= 12; fill++) {
    const blocks = [{ type: 'para', text: Array.from({ length: fill * 6 }, (_, i) => `word${i}`).join(' ') }];
    for (let k = 0; k < 8; k++) blocks.push({ type: 'heading', level: k % 2 ? 1 : 2, text: `Heading ${k}` }, { type: 'para', text: `Body ${k} short.` });
    const pages = pagesOf(formatDocument({ blocks }, base(mode, { depth: 10 })));
    for (const pg of pages) {
      const cs = mode === 'ukaaf' ? 1 : 0, ce = mode === 'ukaaf' ? pg.length - 1 : pg.length - 2;
      if (headingLines.has((pg[ce] || '').trim())) headingLast++;
      if (/^\s*"31111111111$/.test(pg[ce] || '')) indicatorLast++;
      if (pg[cs] === '' && pg.length > cs + 1) blankFirst++;
    }
  }
  ok(headingLast === 0, `#7 ${mode}: heading on the last content line (${headingLast} pages)`);
  ok(indicatorLast === 0, `#7 ${mode}: indicator line on the last content line (${indicatorLast} pages)`);
  ok(blankFirst === 0, `#7 ${mode}: blank line at the top of a page (${blankFirst} pages)`);
}

// #8 consecutive blank lines collapse to one
{
  const blocks = [{ type: 'heading', level: 1, text: 'Title' }, { type: 'heading', level: 2, text: 'Section' }, { type: 'para', text: 'Text one.' }, { type: 'list', items: [{ text: 'a' }] }, { type: 'list', items: [{ text: 'c' }] }, { type: 'heading', level: 3, text: 'Sub' }, { type: 'para', text: 'Text two.' }, { type: 'heading', level: 1, text: 'Part Two' }, { type: 'list', items: [{ text: 'd' }] }, { type: 'note', text: 'A note.' }];
  for (const mode of ['ukaaf', 'bana']) {
    const lines = allLines(formatDocument({ blocks }, base(mode, { suppressHeader: true, depth: 45 })));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    let dbl = 0; for (let i = 1; i < lines.length; i++) if (lines[i] === '' && lines[i - 1] === '') dbl++;
    ok(dbl === 0, `#8 ${mode}: ${dbl} consecutive blank pairs`);
  }
}

// #9 TOC page numbers agree with the body when page furniture is suppressed
{
  const blocks = [];
  for (let k = 0; k < 30; k++) { blocks.push({ type: 'heading', level: 2, text: `Heading ${k}` }); for (let j = 0; j < 4; j++) blocks.push({ type: 'para', text: `Body ${k}.${j} text.` }); }
  const NUM = 'ABCDEFGHIJ'; const fromBrl = (s) => Number([...s].map((c) => (NUM.indexOf(c) + 1) % 10).join(''));
  for (const hide of [false, true]) {
    const pages = pagesOf(formatDocument({ blocks }, base('ukaaf', { toc: true, depth: 12, suppressHeader: hide })));
    const bodyHeads = new Set(Array.from({ length: 30 }, (_, k) => translate(`Heading ${k}`)));
    const tocCount = pages.findIndex((pg) => pg.some((l) => bodyHeads.has(l.trim())));   // first page holding a body heading line
    const toc = pages.slice(0, tocCount).flat();
    let mism = 0;
    for (let k = 0; k < 30; k++) {
      const hb = translate(`Heading ${k}`);
      const tocLine = toc.find((l) => l.trim().startsWith(hb + ' '));
      const claimed = tocLine ? fromBrl(tocLine.trim().split(/\s+/).pop().replace('#', '')) : null;
      const actual = pages.findIndex((pg, i) => i >= tocCount && pg.some((l) => l.trim() === hb)) - tocCount + 1;
      if (claimed !== actual) mism++;
    }
    ok(mism === 0, `#9 suppressHeader=${hide}: ${mism}/30 TOC entries name the wrong page`);
  }
}

// #10 volume title page uses the normalised (clamped) options and never exceeds depth
{
  const blocks = Array.from({ length: 40 }, (_, i) => ({ type: 'para', text: `Paragraph ${i} with enough words to fill the braille page quickly and cleanly.` }));
  const noWidth = formatVolumes({ title: 'T', blocks }, { mode: 'ukaaf', depth: 25, translate, volumePages: 2 });
  ok(pagesOf(noWidth[0].brf)[0].some((l) => /^ {5,}\S/.test(l)), `#10 title page is centred at the default width: ${JSON.stringify(pagesOf(noWidth[0].brf)[0])}`);
  const wide = formatVolumes({ title: 'T', blocks }, { mode: 'ukaaf', width: 200, depth: 25, translate, volumePages: 2, includeCovers: true });
  ok(maxLen(wide[0].brf) <= 60, `#10 cover lines respect the clamped width (max ${maxLen(wide[0].brf)})`);
  const tall = formatVolumes({ title: 'An Extraordinarily Long Title For A Braille Book That Goes On And On For Quite Some Time Indeed Without Stopping', blocks }, base('ukaaf', { depth: 10, volumePages: 2, includeCovers: true }));
  ok(pagesOf(tall[0].brf).every((pg) => pg.length <= 10), `#10 cover page capped at depth (${pagesOf(tall[0].brf)[0].length} lines)`);
}

// #11 a columnar table that cannot fit falls back to listed instead of losing columns
{
  const headers = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu'];
  const brf = formatDocument({ blocks: [{ type: 'table', headers, rows: [Array(12).fill('longish value here')] }] }, base('ukaaf', { tableFormat: 'columnar' }));
  ok(brf.includes('@.<'), '#11 over-wide forced-columnar table falls back to the listed format');
  ok(brf.includes(translate('Mu: longish value here')), '#11 the last column is not sliced off');
}

// #12 BANA centred heading keeps >= 3 blank cells each side (Formats 4.4.2)
{
  const brf = formatDocument({ blocks: [{ type: 'heading', level: 1, text: 'Xylophones Quizzed Jovially By Zealous Wombats Daily' }, { type: 'para', text: 'body' }] }, base('bana'));
  const lines = allLines(brf);
  const hl = lines.slice(0, lines.indexOf('  ' + translate('body'))).filter((l) => l.trim());   // the centred heading's own lines
  ok(hl.length > 0 && hl.every((l) => l.trim().length <= 34 && l.length - l.trimStart().length >= 3 && l.length <= 37), `#12 heading lines: ${JSON.stringify(hl)}`);
}

// #13 malformed blocks are skipped, not thrown; the good block still comes out
{
  const bad = [
    { type: 'table', headers: ['a'], rows: [null, ['x']] }, { type: 'table', headers: 'abc', rows: [['x']] },
    { type: 'pagenum', page: 12 }, { type: 'glossary', items: [null, { term: 'a', def: 'b' }] },
    { type: 'box', title: 'T', blocks: [null, { type: 'para', text: 'in box' }] }, { type: 'footnote', text: 12 },
    { type: 'para', segments: [{ type: 'text', text: 42 }] }, { type: 'graphic', alt: 'g', lines: [null, 5] },
  ];
  let threw = null, brf = '';
  try { brf = formatDocument({ title: 42, blocks: [...bad, { type: 'para', text: 'survivor' }] }, base('ukaaf')); } catch (e) { threw = e; }
  ok(threw === null, `#13 malformed blocks must not throw: ${threw && threw.message}`);
  ok(brf.includes(translate('survivor')), '#13 the well-formed block is still emitted');
  ok(brf.includes('"3' + translate('12').trim()), '#13 numeric pagenum is coerced, not dropped');
}

// #14 control characters never reach the BRF; tab becomes a space
{
  const brf = formatDocument({ blocks: [{ type: 'para', text: 'col1\tcol2' }, { type: 'para', text: 'ab\x1bcd\x07ef' }] }, base('ukaaf'));
  ok(!/[\t\x00-\x08\x0b-\x1f\x7f]/.test(brf.replace(/\r\n|\x0c/g, '')), '#14 no control characters in the BRF');
  ok(brf.includes(translate('col1 col2')), '#14 tab translated as a space');
}

// #15 per-character typeform stays aligned across a Unicode-braille run
{
  const text = 'ab ' + cell(1) + ' cd';
  const tf = [0, 0, 0, 0, 0, 4, 4];                                        // bold on "cd" only
  const got = translate(text, tf);
  const expected = raw('ab ', [0, 0, 0]) + 'A' + raw(' cd', [0, 4, 4]);
  ok(got === expected, `#15 typeform sliced per chunk: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
  ok(got !== translate(text, null), '#15 the emphasis is actually present');
}

console.log(`\nformatting-regressions gate: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
