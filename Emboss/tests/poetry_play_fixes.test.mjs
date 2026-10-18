// Six poetry/play/line-number bugs written up in Emboss/docs/standards-findings.md
// (F-122, F-180, F-181, F-182, F-240, F-178), fixed one at a time in
// Emboss/docs/wip/poetry-play-fixes.md's own stage order. Every expected value below comes
// from the cited rule's own quoted text or a gold worked example
// (Emboss/tests/gold/bana-formats-2016/section-13, section-14, section-15) — never from
// Emboss's pre-fix output. One describe block per finding.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import { parseDtbook } from '../input/parse.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

// ---- fake translate (structural tests: blank lines, margins, word boundaries) -----------
const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: upPos, suppressHeader: true, ...extra });
const bodyLines = (doc, extra) => formatDocument(doc, opts(extra)).split('\f')[0].split(/\r?\n/);
const fakeOpts = (mode, width = 40) => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

// ---- real liblouis en-ueb-g2 translator (rule-text / worked-example tests) ---------------
let translate, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t, tf) => louis.translate(t, T, tf || null);
  translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
});
const realOpts = (mode, width = 38) => ({
  mode, standard: mode, width, depth: 25, translate, translatePos,
});

// ===========================================================================================
// F-122 — BANA 13.8.1: "...Leave a blank between the end of a stanza, or the end of a poem,
// and the note separation line." Already fixed as an incidental side effect of F-121 (the
// unconditional trailing blank line poemRunBoundaries now adds after every BANA poem run) —
// standards-findings.md's own F-121 write-up flags this and asks for confirmation. This is a
// verification/regression test, not a code-change test: no source change was needed.
// ===========================================================================================
describe('F-122 — a note-separator line directly after a poem gets a blank line before it (BANA)', () => {
  test('two verse lines followed by a footnote: a blank line separates the poem from "333333', () => {
    const lines = bodyLines({ blocks: [
      { type: 'play', subtype: 'verse', style: 'verse', text: 'A line of poetry.' },
      { type: 'play', subtype: 'verse', style: 'verse', text: 'A second line, the last of the stanza.' },
      { type: 'footnote', text: 'A footnote explaining the reference marks.' },
    ] });
    const sepIdx = lines.findIndex((l) => l.includes('333333'));
    assert.ok(sepIdx > 0, `note separator not found: ${JSON.stringify(lines)}`);
    assert.equal(lines[sepIdx - 1], '', `blank line must precede the note separator (13.8.1): ${JSON.stringify(lines)}`);
  });

  test('a single-line poem followed by a footnote also gets the blank line', () => {
    const lines = bodyLines({ blocks: [
      { type: 'play', subtype: 'verse', style: 'verse', text: 'One lone verse line.' },
      { type: 'footnote', text: 'A footnote.' },
    ] });
    const sepIdx = lines.findIndex((l) => l.includes('333333'));
    assert.ok(sepIdx > 0, `note separator not found: ${JSON.stringify(lines)}`);
    assert.equal(lines[sepIdx - 1], '', `blank line must precede the note separator: ${JSON.stringify(lines)}`);
  });
});

// ===========================================================================================
// F-180 — BANA 14.6.1a: "Use 1-5 margins for the first line of dialogue [in verse plays]."
// (14.7.1's mixed prose/verse dialogue restates the same verse margin.) formatPlay currently
// delegates every isVerse block (poem line OR play-verse dialogue line — both share the exact
// same {type:'play', subtype:'verse', style:'verse'} shape) to nestedMargins('poetry', …),
// which gives a single-level block runover cell 3 (1-3), not cell 5 (1-5). A genuine poem
// (§13.3.1a, "One level: 1-3") must KEEP cell-3 for a single-level poem — only verse-PLAY
// dialogue needs the wider cell-5 floor. The distinguishing signal is block.playVerse, set by
// parse.mjs for a <p class="bai-verse"/"play-verse"> line (D5's own "verse drama" class
// marker), never for a genuine <poem> line; a plain isVerse block with no explicit playVerse
// flag keeps the pre-existing poetry default (matches every hand-built poem block already in
// the test suite, e.g. tests/nimas_poetry_verse.test.mjs, which never set any such flag).
// ===========================================================================================
describe('F-180 — a verse play\'s first line of dialogue uses 1-5 margins, not 1-3', () => {
  test('a level-0 verse-PLAY line (block.playVerse) wraps its runover at cell 5 (1-5)', () => {
    const o = fakeOpts('bana', 20);   // narrow width forces a runover line
    const block = { type: 'play', subtype: 'verse', style: 'verse', playVerse: true, text: 'A long line of dialogue that must wrap onto a second braille line' };
    const lines = clean(formatBlock(block, o));
    assert.ok(lines.length > 1, `expected a wrapped runover line: ${JSON.stringify(lines)}`);
    assert.equal(lines[0].match(/^ */)[0].length, 0, `first line begins cell 1: ${JSON.stringify(lines)}`);
    assert.equal(lines[1].match(/^ */)[0].length, 4, `runover begins cell 5 (14.6.1a): ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('a genuine single-level POEM line (no playVerse flag) keeps 1-3 margins (13.3.1a regression)', () => {
    const o = fakeOpts('bana', 20);
    const block = { type: 'play', subtype: 'verse', style: 'verse', text: 'A long line of poetry that must wrap onto a second braille line' };
    const lines = clean(formatBlock(block, o));
    assert.ok(lines.length > 1, `expected a wrapped runover line: ${JSON.stringify(lines)}`);
    assert.equal(lines[1].match(/^ */)[0].length, 2, `poem runover keeps cell 3 (13.3.1a "One level: 1-3"): ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('a level-1 continuation verse-PLAY line keeps 3-5 margins (14.6.1b, already correct)', () => {
    const o = fakeOpts('bana', 20);
    const block = { type: 'play', subtype: 'verse', style: 'verse', playVerse: true, level: 1, text: 'A continuation line by the same speaker that wraps' };
    const lines = clean(formatBlock(block, o));
    assert.equal(lines[0].match(/^ */)[0].length, 2, `first line begins cell 3: ${JSON.stringify(lines)}`);
    if (lines.length > 1) assert.equal(lines[1].match(/^ */)[0].length, 4, `runover begins cell 5: ${JSON.stringify(lines)}`);
    parity(block, o);
  });
});

// ===========================================================================================
// F-181 — BANA 15.8.1b/c ("Place line numbers... at the right margin of the braille line").
// A play-speaker/dialogue line's own `{type:'linenum'}` segment is silently DROPPED: formatPlay
// calls segmentsToBraille(block.segments, o) with lineNumbers defaulting to false (the
// generic A30 line-numbered-prose flag, document.mjs's segmentsToBraille), and wraps with
// wrapCells rather than the numbered-aware wrapBody.
// ===========================================================================================
describe('F-181 — line numbers in prose plays are not dropped, and land at the right margin', () => {
  test('a play-speaker block with a linenum segment keeps the number, right-justified', () => {
    const o = fakeOpts('bana', 40);
    const block = {
      type: 'play', subtype: 'prose', style: 'play-speaker',
      segments: [{ type: 'text', text: 'CAESAR. Speak.' }, { type: 'linenum', text: '5' }],
    };
    const lines = clean(formatBlock(block, o));
    const joined = lines.join('\n');
    assert.ok(joined.includes('5'), `line number dropped entirely: ${JSON.stringify(lines)}`);
    assert.ok(/5 *$/.test(lines[0]), `number must land at the right margin: ${JSON.stringify(lines)}`);
    parity(block, o);
  });
});

// ===========================================================================================
// F-182 — BANA 15.7.2c/d ("Place each letter... at the right margin"), 15.7.3c ("Place line
// numbers... at the right margin"). parsePoem's numPrefix folds a poem line's own number/
// rhyme-scheme letter into the START of the line's plain text — destroying its identity as a
// line number and gluing it to the LEFT margin, instead of building a genuine
// {type:'linenum'} segment that lands at the right margin (via F-181's wrapBody plumbing).
// ===========================================================================================
describe('F-182 — a poem\'s own line number/letter lands at the right margin, not the left', () => {
  test('a <linegroup>-sibling <linenum> (real DTBook) renders right-justified, not glued to the left', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <poem>
          <linegroup>
            <line>Line one of the poem</line>
            <linenum>5</linenum>
            <line>Line five of the poem</line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const o = fakeOpts('bana', 40);
    const lines = clean(formatDocument(doc, { ...o, suppressHeader: true }).split('\f')[0].split(/\r?\n/));
    const numberedLine = lines.find((l) => l.includes('LINE FIVE'));
    assert.ok(numberedLine, `line not found: ${JSON.stringify(lines)}`);
    assert.ok(!numberedLine.trimStart().startsWith('5'), `number must NOT be glued to the left margin: ${JSON.stringify(numberedLine)}`);
    assert.match(numberedLine, /5\s*$/, `number must land at the right margin: ${JSON.stringify(numberedLine)}`);
  });

  test('formatBlock/traceBlock parity for a poem line carrying a linenum segment', () => {
    const o = fakeOpts('bana', 40);
    const block = { type: 'play', subtype: 'verse', style: 'verse', text: 'A line of poetry', segments: [{ type: 'linenum', text: '12' }, { type: 'text', text: 'A line of poetry' }] };
    parity(block, o);
  });
});

// ===========================================================================================
// F-240 — BANA 14.5.3d/14.6.3d/14.7.2 ("Do not insert blank lines before or after stage
// directions or cues printed outside or between the lines of dialogue"). poemRunBoundaries
// treats a `stage` block between two verse `play` lines as ending the poem run (it is
// neither a verse block nor a recognised stanza separator), so each side becomes its own
// isolated single-line "poem" and picks up F-121's blank-line-before/after treatment
// independently — a spurious blank line appears on both sides of the stage direction.
// ===========================================================================================
describe('F-240 — a stage direction between two verse play lines gets no blank line around it', () => {
  test('two verse lines with a stage direction between them: no blank line either side of it', () => {
    const lines = bodyLines({ blocks: [
      { type: 'para', text: 'Before the scene.' },
      { type: 'play', subtype: 'verse', style: 'verse', playVerse: true, text: 'First line of dialogue.' },
      { type: 'stage', text: '[Exit Horatio.]' },
      { type: 'play', subtype: 'verse', style: 'verse', playVerse: true, text: 'Second line of dialogue.' },
      { type: 'para', text: 'After the scene.' },
    ] });
    const iStage = lines.findIndex((l) => l.includes('EXIT HORATIO'));
    assert.ok(iStage > 0, `stage direction not found: ${JSON.stringify(lines)}`);
    assert.notEqual(lines[iStage - 1], '', `no blank line before the stage direction (14.5.3d): ${JSON.stringify(lines)}`);
    assert.notEqual(lines[iStage + 1], '', `no blank line after the stage direction (14.5.3d): ${JSON.stringify(lines)}`);
    // The run's own OUTER boundary (13.3.1a-style, F-121) is unaffected: one blank line
    // before the whole verse run, one after — the stage direction sits INSIDE, not at an edge.
    const iFirst = lines.findIndex((l) => l.includes('FIRST LINE'));
    const iSecond = lines.findIndex((l) => l.includes('SECOND LINE'));
    assert.equal(lines[iFirst - 1], '', `blank line before the run's own first line: ${JSON.stringify(lines)}`);
    assert.equal(lines[iSecond + 1], '', `blank line after the run's own last line: ${JSON.stringify(lines)}`);
  });

  test('two stage directions between two verse lines: still no blank line around either', () => {
    const lines = bodyLines({ blocks: [
      { type: 'play', subtype: 'verse', style: 'verse', playVerse: true, text: 'First line.' },
      { type: 'stage', text: '[Thunder.]' },
      { type: 'stage', text: '[Lightning.]' },
      { type: 'play', subtype: 'verse', style: 'verse', playVerse: true, text: 'Second line.' },
    ] });
    const blanks = lines.filter((l) => l === '').length;
    // Only the run's own two outer blanks (before FIRST, after SECOND) — none around either
    // stage direction, and none between the two stage directions themselves.
    assert.equal(blanks, 2, `expected exactly 2 blank lines (before/after the whole run): ${JSON.stringify(lines)}`);
  });
});

// ===========================================================================================
// F-178 — BANA 14.1.4: "If print uses both full capitalization and emphasis to show speaker
// names, retain the capitalization and omit the emphasis." (Restated for prose/verse plays at
// 14.5.1b/14.6.1c.) parse.mjs extracts a speaker and dialogue into one play-speaker block;
// formatPlay unconditionally forwards every segment's own emphasis to segmentsToBraille,
// including a fully-capitalised speaker name's. The rule is unconditional (no "necessary for
// clarity" exception the way BANA 5.3.1/Q-25 has for headings) and the fix is mechanical: it
// only ever touches a segment that is BOTH already emphasised AND fully capitalised (letters
// only) — never a judgement call about which PART of a block is "the name" (that's exactly
// which segment(s) already carry both signals at once), so it proceeds despite Q-25 (a
// different, still-open design question about a PARTIAL-retention flag for headings/lists,
// not this unconditional strip-it-all rule).
// ===========================================================================================
describe('F-178 — emphasis on a fully-capitalised speaker name is omitted, not retained', () => {
  test('a fully-capitalised, emphasised speaker name loses its emphasis; the dialogue is unaffected', () => {
    const block = { type: 'play', subtype: 'prose', style: 'play-speaker', segments: [
      { type: 'text', text: 'HAMLET.', tf: 1 },
      { type: 'text', text: ' To be, or not to be.' },
    ] };
    const withEmphasis = clean(formatBlock({ ...block, segments: [{ type: 'text', text: 'HAMLET.' }, { type: 'text', text: ' To be, or not to be.' }] }, realOpts('bana')));
    const lines = clean(formatBlock(block, realOpts('bana')));
    assert.deepEqual(lines, withEmphasis, `emphasis on a fully-capitalised name must be omitted, matching the unemphasised rendering: ${JSON.stringify(lines)}`);
    parity(block, realOpts('bana'));
  });

  test('a MIXED-CASE emphasised speaker name keeps its emphasis (only full caps + emphasis together trigger 14.1.4)', () => {
    const block = { type: 'play', subtype: 'prose', style: 'play-speaker', segments: [
      { type: 'text', text: 'Hamlet.', tf: 1 },
      { type: 'text', text: ' To be, or not to be.' },
    ] };
    const lines = clean(formatBlock(block, realOpts('bana')));
    assert.ok(lines[0].includes('.1'), `mixed-case name must KEEP its italics: ${JSON.stringify(lines)}`);
    parity(block, realOpts('bana'));
  });

  test('emphasis on fully-capitalised DIALOGUE (not the speaker name) is retained, per 14.1.3/14.5.1b "follow print"', () => {
    const block = { type: 'play', subtype: 'prose', style: 'play-speaker', segments: [
      { type: 'text', text: 'Hamlet.' },
      { type: 'text', text: ' TO BE OR NOT TO BE.', tf: 1 },
    ] };
    const withoutEmphasis = clean(formatBlock({ type: 'play', subtype: 'prose', style: 'play-speaker', segments: [
      { type: 'text', text: 'Hamlet.' },
      { type: 'text', text: ' TO BE OR NOT TO BE.' },
    ] }, realOpts('bana')));
    const lines = clean(formatBlock(block, realOpts('bana')));
    assert.notDeepEqual(lines, withoutEmphasis, `emphasis on capitalised dialogue text is not a speaker name — must be kept: ${JSON.stringify(lines)}`);
    parity(block, realOpts('bana'));
  });
});

// ---- F-178 UKAAF regression: B004 K "Good practice 1" is explicitly permissive ("the
// speaker's name...can generally follow print's method...it can be italicised") — retaining
// emphasis on a UKAAF speaker name is correct, so the strip must be BANA-only. ----
describe('F-178 regression — UKAAF keeps a fully-capitalised speaker name\'s own emphasis (B004 K Good practice 1)', () => {
  test('UKAAF mode: a fully-capitalised, emphasised speaker name KEEPS its emphasis', () => {
    const block = { type: 'play', subtype: 'prose', style: 'play-speaker', segments: [
      { type: 'text', text: 'HAMLET.', tf: 1 },
      { type: 'text', text: ' To be, or not to be.' },
    ] };
    const withoutEmphasis = clean(formatBlock({ ...block, segments: [{ type: 'text', text: 'HAMLET.' }, { type: 'text', text: ' To be, or not to be.' }] }, realOpts('ukaaf')));
    const lines = clean(formatBlock(block, realOpts('ukaaf')));
    assert.notDeepEqual(lines, withoutEmphasis, `UKAAF must keep the speaker name's own emphasis (B004 K Good practice 1): ${JSON.stringify(lines)}`);
    parity(block, realOpts('ukaaf'));
  });
});

// ---- F-178 editor-round-trip regression: Emboss/web/editor/editor.mjs's own Lexical node
// round trip normalises block.style to 'dialogue' (its internal canonical name), not the
// literal 'play-speaker' parse.mjs writes — found live in Chrome (22 Sep). ----
describe('F-178 regression — the editor\'s own "dialogue" style alias is recognised too', () => {
  test('style: "dialogue" (the editor\'s round-tripped name) strips a fully-capitalised name\'s emphasis, same as "play-speaker"', () => {
    const block = { type: 'play', subtype: 'prose', style: 'dialogue', segments: [
      { type: 'text', text: 'HAMLET.', tf: 1 },
      { type: 'text', text: ' To be, or not to be.' },
    ] };
    const withoutEmphasis = clean(formatBlock({ ...block, segments: [{ type: 'text', text: 'HAMLET.' }, { type: 'text', text: ' To be, or not to be.' }] }, realOpts('bana')));
    const lines = clean(formatBlock(block, realOpts('bana')));
    assert.deepEqual(lines, withoutEmphasis, `style:'dialogue' (the editor's own round-tripped name) must also be recognised: ${JSON.stringify(lines)}`);
    parity(block, realOpts('bana'));
  });
});

describe('F-182 save — a poem line number saves as DTBook <linenum>, not a span', () => {
  test('<line><linenum>5</linenum>…</line> round-trips through parse → export', async () => {
    const { exportToNimasXml } = await import('../input/nimas-export.mjs');
    const xml = '<?xml version="1.0" encoding="UTF-8"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="P"/></head><book><bodymatter><level1><h1>P</h1><poem><linegroup><line>The woods are lovely,</line><line><linenum>5</linenum>And miles to go.</line></linegroup></poem></level1></bodymatter></book></dtbook>';
    const out = exportToNimasXml(parseDtbook(xml), { title: 'P' });
    assert.match(out, /<line><linenum>5<\/linenum>And miles to go\.<\/line>/);
    assert.doesNotMatch(out, /class="linenum"/);
  });
});
