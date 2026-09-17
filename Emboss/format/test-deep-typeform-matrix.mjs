// Deep Typeform Matrix Test Suite: Exhaustively tests Bold, Italic, Underline,
// and all composite typeform combinations across 18 document block styles in both
// BANA and UKAAF modes, plus asserts 100% cell-trace alignment invariants.
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatBlock, traceBlock } from './document.mjs';
import { styledTranslate } from './text-style.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  console.log('=== Running Deep Typeform & Emphasis Formatter Engine Matrix ===\n');
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  const translate = styledTranslate((t, tfArr) => louis.translate(t, T, tfArr), 'faithful');
  const translatePos = (t, tfArr) => louis.translatePos(t, T, tfArr);

  const formatOptsBana = {
    mode: 'bana',
    standard: 'bana',
    width: 38,
    depth: 25,
    listStyle: 'spaced',
    translate,
    translatePos,
  };

  const formatOptsUkaaf = {
    mode: 'ukaaf',
    standard: 'ukaaf',
    width: 38,
    depth: 25,
    listStyle: 'spaced',
    translate,
    translatePos,
  };

  // Helper to verify cell trace invariant
  const verifyTraceInvariant = (block, o, styleName) => {
    const formattedLines = formatBlock(block, o).filter((l) => l !== undefined);
    const tracedLines = traceBlock(block, o, false, 0).map((x) => x.s);
    const fStr = formattedLines.join('\n');
    const tStr = tracedLines.join('\n');
    const match = fStr === tStr;
    check(`Cell Trace Invariant [${styleName} | ${o.mode}]: formatBlock matches traceBlock`, match, `\nFormatted:\n${fStr}\nTraced:\n${tStr}`);
    return match;
  };

  // Test matrix of segments
  const makeSegments = (tf) => [
    { type: 'text', text: 'This has ' },
    { type: 'text', text: 'emphasised', tf },
    { type: 'text', text: ' content.' },
  ];

  // --------------------------------------------------------------------------
  // 1. All 7 Typeform Bits in Paragraphs
  // --------------------------------------------------------------------------
  console.log('--- 1. Paragraph Typeform Combinations (tf = 1..7) ---');
  const typeforms = [
    { tf: 1, name: 'Italic (tf=1)', regex: /\.1EMPHASIS|\.1/ },
    { tf: 2, name: 'Underline (tf=2)', regex: /_1EMPHASIS|_1/ },
    { tf: 3, name: 'Italic + Underline (tf=3)', regex: /\._1EMPHASIS|\.1|_1/ },
    { tf: 4, name: 'Bold (tf=4)', regex: /\^1EMPHASIS|\^1/ },
    { tf: 5, name: 'Bold + Italic (tf=5)', regex: /\^\.1EMPHASIS|\^1|\.1/ },
    { tf: 6, name: 'Bold + Underline (tf=6)', regex: /\^_1EMPHASIS|\^1|_1/ },
    { tf: 7, name: 'Bold + Italic + Underline (tf=7)', regex: /\^|\.1|_1/ },
  ];

  for (const { tf, name, regex } of typeforms) {
    const block = { type: 'para', segments: makeSegments(tf) };
    const brfBana = formatBlock(block, formatOptsBana).join(' ');
    const brfUkaaf = formatBlock(block, formatOptsUkaaf).join(' ');
    check(`Paragraph ${name} [BANA]: emits UEB indicators`, regex.test(brfBana), brfBana);
    check(`Paragraph ${name} [UKAAF]: emits UEB indicators`, regex.test(brfUkaaf), brfUkaaf);
    verifyTraceInvariant(block, formatOptsBana, `Para ${name}`);
  }

  // --------------------------------------------------------------------------
  // 2. Headings (L1, L2, L3 in BANA & UKAAF)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Heading Levels 1, 2, 3 with Bold & Italic ---');
  for (const level of [1, 2, 3]) {
    const hBold = { type: 'heading', level, segments: makeSegments(4) };
    const hItal = { type: 'heading', level, segments: makeSegments(1) };
    
    const bBrl = formatBlock(hBold, formatOptsBana).join(' ');
    const uBrl = formatBlock(hBold, formatOptsUkaaf).join(' ');
    // Formats §4.3.7 / B004 §5: font attributes are ignored in centred, cell-5 and cell-7 headings.
    check(`Heading Level ${level} Bold [BANA]: bold indicator dropped (§4.3.7)`, !/\^1/.test(bBrl), bBrl);
    check(`Heading Level ${level} Bold [UKAAF]: bold indicator dropped (B004 §5)`, !/\^1/.test(uBrl), uBrl);
    verifyTraceInvariant(hBold, formatOptsBana, `Heading L${level} Bold`);
    verifyTraceInvariant(hItal, formatOptsUkaaf, `Heading L${level} Italic`);
  }

  // --------------------------------------------------------------------------
  // 3. Lists (Bulleted, Numbered, Exercise, TOC)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Lists (Bulleted, Numbered, Exercise, TOC) ---');
  const listKinds = ['bullet', 'number', 'exercise', 'toc'];
  for (const kind of listKinds) {
    const listBlock = {
      type: 'list',
      kind,
      items: [
        { segments: makeSegments(4), marker: kind === 'number' ? '1.' : undefined },
        { segments: makeSegments(1), marker: kind === 'number' ? '2.' : undefined },
      ],
    };
    const brf = formatBlock(listBlock, formatOptsBana).join('\n');
    check(`List [${kind}]: Item 1 has bold indicator (^1)`, /\^1/.test(brf), brf);
    check(`List [${kind}]: Item 2 has italic indicator (.1)`, /\.1/.test(brf), brf);
    verifyTraceInvariant(listBlock, formatOptsBana, `List-${kind}`);
  }

  // --------------------------------------------------------------------------
  // 4. Transcriber Notes (BANA & UKAAF)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Transcriber Notes ---');
  const noteBold = { type: 'note', segments: makeSegments(4) };
  const noteItal = { type: 'note', segments: makeSegments(1) };
  const noteUndl = { type: 'note', segments: makeSegments(2) };

  const noteBanaOut = formatBlock(noteBold, formatOptsBana).join(' ');
  const noteUkaafOut = formatBlock(noteBold, formatOptsUkaaf).join(' ');
  check('Note Bold [BANA]: contains BANA open/close delimiters and bold indicator', (noteBanaOut.includes('@.<') || noteBanaOut.includes('333') || noteBanaOut.includes('⠈⠨⠣') || noteBanaOut.includes('@')) && /\^1/.test(noteBanaOut), noteBanaOut);
  check('Note Bold [UKAAF]: contains UKAAF open/close delimiters and bold indicator', (noteUkaafOut.includes('@<') || noteUkaafOut.includes('⠰⠇') || noteUkaafOut.includes('@')) && /\^1/.test(noteUkaafOut), noteUkaafOut);
  verifyTraceInvariant(noteBold, formatOptsBana, 'Note Bold');
  verifyTraceInvariant(noteItal, formatOptsBana, 'Note Italic');
  verifyTraceInvariant(noteUndl, formatOptsUkaaf, 'Note Underline');

  // --------------------------------------------------------------------------
  // 5. Footnotes, Attributions, Captions, Quotes
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Footnotes, Attributions, Captions, Quotes ---');
  const styles5 = [
    { type: 'footnote', name: 'Footnote' },
    { type: 'attribution', name: 'Attribution' },
    { type: 'caption', name: 'Caption' },
    { type: 'para', style: 'quote', name: 'Quote' },
  ];
  for (const s of styles5) {
    const blk = { ...s, segments: makeSegments(4) };
    const out = formatBlock(blk, formatOptsBana).join(' ');
    check(`${s.name} Bold: retains bold indicator`, /\^1/.test(out), out);
    verifyTraceInvariant(blk, formatOptsBana, s.name);
  }

  // --------------------------------------------------------------------------
  // 6. Plays, Dialogue, Verse, Stage Directions
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Plays, Dialogue, Verse, Stage Directions ---');
  const playDialogue = { type: 'play', subtype: 'prose', segments: makeSegments(4) };
  const playVerse = { type: 'play', subtype: 'verse', segments: makeSegments(1) };
  const stageDir = { type: 'stage', segments: makeSegments(2) };

  check('Play Dialogue Bold: emits bold indicator', /\^1/.test(formatBlock(playDialogue, formatOptsBana).join(' ')));
  check('Play Verse Italic: emits italic indicator', /\.1/.test(formatBlock(playVerse, formatOptsBana).join(' ')));
  // Formats §14.4.1c: font attributes used for stage directions are ignored.
  check('Stage Direction Underline: underline indicator dropped (§14.4.1c)', !/_1/.test(formatBlock(stageDir, formatOptsBana).join(' ')));
  verifyTraceInvariant(playDialogue, formatOptsBana, 'Play Dialogue');
  verifyTraceInvariant(playVerse, formatOptsBana, 'Play Verse');
  verifyTraceInvariant(stageDir, formatOptsBana, 'Stage Direction');

  // --------------------------------------------------------------------------
  // 7. Sidebars / Box Containers with Nested Formatted Content
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Sidebars / Box Containers with Nested Content ---');
  const sidebarBox = {
    type: 'box',
    title: 'Sidebar Notice',
    blocks: [
      { type: 'heading', level: 2, segments: makeSegments(4) },
      { type: 'para', segments: makeSegments(1) },
      { type: 'list', kind: 'bullet', items: [{ segments: makeSegments(2) }] },
    ],
  };
  const sbOut = formatBlock(sidebarBox, formatOptsBana).join('\n');
  check('Sidebar Box: Top border 777 present (Formats §7.1.3)', sbOut.includes('7777777'), sbOut);
  check('Sidebar Box: Bottom border GGG present (Formats §7.1.3)', sbOut.includes('GGGGGGG'), sbOut);
  check('Sidebar Box: Nested Heading drops bold indicator (§4.3.7 applies inside boxes)', !/\^1/.test(sbOut), sbOut);
  check('Sidebar Box: Nested Para retains italic indicator (.1)', /\.1/.test(sbOut), sbOut);
  check('Sidebar Box: Nested List Item retains underline indicator (_1)', /_1/.test(sbOut), sbOut);
  verifyTraceInvariant(sidebarBox, formatOptsBana, 'Sidebar Box');

  // --------------------------------------------------------------------------
  // 8. Full Document Model Integration
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Full Document Model Integration ---');
  const fullDocModel = {
    title: 'Comprehensive Emphasis Test Document',
    blocks: [
      { type: 'heading', level: 1, segments: [{ type: 'text', text: 'Master Title with ' }, { type: 'text', text: 'Bold', tf: 4 }] },
      { type: 'para', segments: makeSegments(5) },
      { type: 'note', segments: makeSegments(4) },
      sidebarBox,
    ],
  };
  const docBrf = formatDocument(fullDocModel, formatOptsBana);
  check('Full Document: Formats without errors and contains multiple typeforms', docBrf.length > 100 && /\^1/.test(docBrf), docBrf.slice(0, 300));

  console.log(`\n==================================================`);
  console.log(`DEEP TYPEFORM MATRIX RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log(`==================================================\n`);
  process.exit(fail ? 1 : 0);
})();
