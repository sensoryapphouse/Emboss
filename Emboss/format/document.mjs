// Document formatter: a structured document model -> content lines -> BRF.
// Block layout follows the Rule Register (SETUP_AND_VALIDATION.md), switchable
// by mode ('ukaaf' | 'bana'). Paragraph wrapping and page assembly are the
// gold-validated primitives from layout.js / page.js.
import { wrapCells, wrapCellsSrc, GAP_CELL, GAP3_CELL, LN_OPEN, LN_CLOSE, hasLineNumbers, stripLineNumbers, wrapNumbered, wrapCounted } from './layout.mjs';   // A39 stage 2: formatParagraph's last caller (formatPara) is gone; layout.mjs itself is untouched (other files may still use it)
import { assemble, banaLineOne, banaRunningHead, toBRF, brailleNumber, seriesPageNumber, linesPerPage, banaPageChangeNumber, renumberPage, renumberPageSeries, continuationPrefix, formatPrintPageHeader } from './page.mjs';
import { unicodeBrailleToBrf, BRF64 } from '../engine/brf-ascii.mjs';
import { cellSegments, cellPlainText, cellIsBlank, cellFromSegments } from './cell-markup.mjs';
import { STYLE_DEFINITIONS, getStyleMargins, isListStyle, resolveStyleFromXml } from './styles.mjs';
import { titlepageBookDetails, REPRODUCTION_NOTICES, ukAccessibleCopyStatement, titlePageTemplateSegments, refreshTitlePageValues } from './field-registry.mjs';   // K29 Stage 1b: Title Page book-details pre-fill (Stage 1a). Stage 1c rework: the ONE shared Title Page template (wording) traceTitlePage lays out — see traceTitlePage's own comment.

export { STYLE_DEFINITIONS, getStyleMargins, isListStyle, resolveStyleFromXml };

const rightJustify = (text, width) => ' '.repeat(Math.max(0, width - text.length)) + text;

// BRF indicators concatenated AFTER translation (never fed to the print translator):
// UEB transcriber's note @.< … @.> (dots 4,46,126 / 4,46,345; UEB §3.27, used by
// both B004 and Formats §3.2); grade-1 passage ;;; … ;' and grade-1 word ;; (UEB §5).
const TN_OPEN = '@.<', TN_CLOSE = '@.>';
// F-233 / BANA 6.12.3.b(3): a hyperlink indicator (dots 456-2356 / dots 456-1236), layered ON TOP OF
// whatever typeform indicators the hyperlinked run's own `tf` already produces (Sample 6-15). Optional
// per-segment `hyperlink: true`; a segment without it is unaffected (default off).
// LINK-2 (Paul, 28 Sep 2026, KD round-2 Q1): refines this — a link segment whose print was
// UNDERLINED (seg.tf carries TF_UNDERLINE, set by the importers: parse.mjs's docx/html/epub
// readers) takes UEB's own underline typeform indicator instead, and skips this wrap entirely
// (groupSegments' `linkUnderline` flag, below). Only a link with no underline still gets the
// first transcriber-defined typeform (LINK-1, unchanged).
const HYPERLINK_OPEN = '@#7', HYPERLINK_CLOSE = "@#'";
// liblouis TYPEFORM bit for underline (engine/louis.mjs / louis-browser.mjs: TYPEFORM.underline = 2).
const TF_UNDERLINE = 2;
// F-16 / BANA 11.6.6: "The ditto mark (dots 5, 2) is left-adjusted in the appropriate column."
// A print ditto glyph standing alone in a table cell becomes this literal two-cell braille
// sequence, never run through the print translator (which would otherwise read a bare
// quotation mark as an opening/closing UEB quote). Opt-in per table: `block.dittoMarks`.
const DITTO_RE = /^["″”‘’]$/;
const DITTO_BRL = '"1';
const G1_PASSAGE_OPEN = ';;;', G1_TERMINATOR = ";'", G1_WORD = ';;';
// TBL-NUM-1 (Paul, 28 Sep 2026; KD round-2 Q4) / BANA §11.7.1j-l, UEB §6.9: the numeric
// passage indicator ('##', dots 3456-3456) opens a run of digits that need no numeral
// sign of their own, closed by the numeric terminator ("#'", dots 3456-3, i.e. the
// numeral sign followed by the letter-group terminator). Used only per computeTableColumns'
// numericPassageOk / applyNumericPassageMarks below.
const NUMERIC_PASSAGE_OPEN = '##', NUMERIC_PASSAGE_CLOSE = "#'";
// A39 safety net: liblouis's own escape for a character its tables leave undefined
// (engine/louis.mjs's foldNonBmp comment: 'a 𝑥 b' -> "A '\XD835''\XDC65' ;B"). o.translate
// and o.translatePos are DOCUMENTED to agree ("o.translatePos... mirrors o.translate" —
// see the cell-trace comment below), but that is a contract the CALLER upholds, not
// something document.mjs can enforce — e.g. the editor wraps o.translate with
// styledTranslate's Unicode-invisible-char normalizer (text-style.mjs) but not
// o.translatePos, so raw ZWJ/ZWNJ/bidi-control input can make the two diverge for this one
// escape-producing case even though they are proven identical (56512 real-book blocks +
// synthetic sweep, single_pass_layout.test.mjs) for every block type otherwise. Detecting
// this specific signature and falling back to formatBlock for just that one block keeps the
// single-layout fast path for realistic content while never trusting traceBlock's braille
// text when there is concrete evidence it came from an untranslated/undefined character.
const LOU_UNDEFINED_CHAR_RE = /'\\X[0-9A-Fa-f]{4}'/;
// Any string that must land in the BRF as cells: Unicode braille is mapped to BRF
// ASCII (dots 7/8 masked) and anything else outside the 64-cell set becomes a blank.
const BRF_CHARS = new Set(BRF64);
const toBrfCells = (str, onBlank) => unicodeBrailleToBrf(String(str ?? '')).split('').map((c) => {
  if (BRF_CHARS.has(c)) return c;
  if (onBlank) onBlank(c);
  return ' ';
}).join('');

const centred = (text, width) =>
  ' '.repeat(Math.max(0, Math.floor((width - text.length) / 2))) + text;

// Centre a (possibly multi-line) block of text, wrapping first if it's wider
// than the page. Verified against corpus/ukaaf/sample3.brf: a headline/title
// longer than the geometry width is greedily word-wrapped (no indent) and
// EACH resulting line is centred independently, not left-blocked as a
// paragraph — see gold lines "SWITCHING TO CLEAN ENERGY WILL STOP GREAT /
// BARRIER REEF DESTRUCTION FROM GLOBAL WARMING, / SAYS WWF" (3 lines, each
// centred on its own). Also applies to a BANA/UKAAF centred (L1) heading,
// which uses the same centred-block presentation (B004 §5 / Formats §4.4).
function centredBlock(text, width, wrapWidth = width) {
  return wrapCells(text, wrapWidth, 0, 0).map((line) => centred(line.trim(), width));
}

// F-40 / BANA §4.4.3: "Headings should be balanced and divided at a logical location
// when longer than one line" (Example 4-8 divides "Using Natural Resources in the
// United States" as "Using Natural Resources" / "in the United States" — a break after
// the fourth word, NOT the greedy fill that would instead pack "...in the United" onto
// line 1 and strand "States" alone on line 2). wrapCells's plain greedy fill respects
// word boundaries ("logical location") but always packs each line as full as it can
// before moving on, so it never balances. This finds the NARROWEST wrap width that
// still needs the same (minimum) number of lines wrapCells' own greedy fill needs at
// the full `maxWidth` — greedy line count is monotonic non-increasing as width grows,
// so binary search applies — then wraps at that narrower width instead. This can never
// split a word (the search floor is the longest word) and never adds a line beyond the
// minimum wrapCells itself would use. Verified against Example 4-8 (width 40,
// wrapWidth 34): greedy gives 33/7-cell lines (only "STATES" left on line 2); this
// gives 23/17, breaking after "RESOURCES" — the gold braille exactly.
function balancedWrapWidth(text, maxWidth) {
  const words = String(text || '').split(' ').filter((w) => w.length > 0);
  if (words.length <= 1) return maxWidth;
  const targetLines = wrapCells(text, maxWidth, 0, 0).length;
  if (targetLines <= 1) return maxWidth;
  const maxWordLen = Math.max(...words.map((w) => w.length));
  let lo = Math.max(1, maxWordLen), hi = maxWidth;
  if (lo >= hi) return hi;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const lines = wrapCells(text, mid, 0, 0).length;
    if (lines <= targetLines) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// Balanced centred-heading block — BANA §4.4.3 only (see balancedWrapWidth above). Used
// ONLY by formatHeading's BANA centred branch: every OTHER centred block (the document
// title §2.10, UKAAF §5/Appendix A's L1 heading, a table heading §11.3.1a, the generated
// "Contents"/volume title lines) keeps plain centredBlock — §4.4.3's balanced-division
// requirement is specific to centred HEADINGS, and BANA names it nowhere else. Falls
// back to centredBlock's plain greedy fill for text carrying an explicit line break
// (`\n`, e.g. a hard-broken multi-segment heading) — the "logical/balanced" division
// this implements is for wrapping ONE overlong line, not for re-flowing an author-chosen
// break, and no gold sample exercises that combination.
function centredHeadingBlock(text, width, wrapWidth = width) {
  if (String(text || '').includes('\n')) return centredBlock(text, width, wrapWidth);
  return wrapCells(text, balancedWrapWidth(text, wrapWidth), 0, 0).map((line) => centred(line.trim(), width));
}

// Indicator / break lines (B004 Glossary, R17: "An indicator line (or end
// marker) is a line which can be placed after a section is complete"). Three
// forms: a colons end marker (line indicator dot5,dots25 + 10 colons), a
// dot-2s end marker (same line indicator + 10 dot-2 signs), or 3 spaced
// centred asterisks ("usually a break in text" — no line-indicator prefix).
// Gold-verified (corpus/ukaaf/sample4.brf, the joke breaks): the asterisk
// form is the BRF-ASCII asterisk sign ("9) x3, single-space separated, then
// centred as a block — e.g. "               "9 "9 "9" at 38 cells.
// First transcriber-defined print symbol (RUEB §3.26: dots 1456, in grade 1 mode in
// contracted braille). Used for a print asterism (⁂) in BANA mode.
const TD_SYMBOL_1 = ';?';
const isBanaOpts = (o) => o.standard === 'bana' || o.mode === 'bana';
const indicatorLine = (kind, width, mode = 'ukaaf') => {
  // A print asterism: BANA Formats §1.9.5 — no UEB equivalent, so a transcriber-defined
  // symbol, centred, spaced; UKAAF B004 (Glossary, Indicator line) — three spaced asterisks.
  if (kind === 'asterism') return centred(mode === 'bana' ? `${TD_SYMBOL_1} ${TD_SYMBOL_1} ${TD_SYMBOL_1}` : '"9 "9 "9', width).replace(/\s+$/, '');
  if (kind === 'asterisks') return centred('"9 "9 "9', width).replace(/\s+$/, '');
  return centred('"3' + (kind === 'colons' ? '3' : '1').repeat(10), width).replace(/\s+$/, '');
};

// Until the Special Symbols page exists (G8), the first transcriber-defined symbol is
// explained in a transcriber's note before its first use (RUEB §3.26.1; BANA Formats
// §3.3.1), the symbol preceded by the dot locator for mention (.=), 7-5 margins (§3.2.2).
// formatDocument marks that block with `tdNote`.
function tdSymbolNote(block, o) {
  if (!block.tdNote || !isBanaOpts(o) || block.kind !== 'asterism') return [];
  const text = `@.<.=${TD_SYMBOL_1} ${o.translate('Asterism (section break)').trim()}@.>`;
  return wrapCells(text, o.width || 38, 6, 4).map((l) => l.replace(/\s+$/, ''));
}

// Nested indentation — { first, runover } as 0-based cell offsets — for lists,
// exercise sets, contents entries, indexes and poetry. `level` is the item's own
// level and `maxLevel` the deepest level anywhere in the same block (a formatter
// must scan the whole block before laying out its items).
//  BANA (Formats §8.5.1b lists, §10.4.2b exercises, §2.10.6b contents, §21.2.1b
//    alphabetic references / indexes, §13.3.1 poetry): the main entry begins in
//    cell 1, each sub-level begins two cells to the right of the previous one, and
//    ALL runovers begin two cells to the right of the farthest indented level —
//    one level 1-3; two levels 1-5, 3-5; three levels 1-7, 3-7, 5-7 (§10.4.1: an
//    exercise set with no subentries is 1-3).
//  UKAAF (B004): a list with no sub-entries is 1-3 (§10 Ex1); a nested list follows
//    App C Ex1 — each level's runover four cells to the right of its own entry
//    (1/5, 3/7, 5/9 …); the 'compact' house style (§10 Ex2 / App C Ex2) is 5/1,
//    7/1, 9/1. Indexes (App I: "runovers are indented two cells further than the
//    deepest entry (i.e. all entries have the same runover start)") and contents
//    (App H, sub-levels indented 2) share one runover start as in BANA. Poetry
//    (App J): a line begins in cell 1 and "the runover should begin in cell 5"; a
//    sub-level steps in by 2 and the shared runover is never left of cell 5.
function nestedMargins(kind, level, maxLevel, mode, listStyle) {
  const lvl = Math.max(0, Number(level) || 0);
  const deepest = Math.max(lvl, Number(maxLevel) || 0);
  // BANA Formats §14.6.1a/14.7.1 (F-180): "Use 1-5 margins for the first line of dialogue
  // [in a verse play]" / "3-5 margins for additional lines by the same speaker" (14.6.1b,
  // already correct via the ordinary formula below whenever a level-1 line is present).
  // Unlike an ordinary poem (§13.3.1a "One level: 1-3", the plain formula's own single-level
  // case), a verse PLAY line always keeps at least a cell-5 runover even when it is the only
  // line in its run (deepest stays 0) — the same floor B004 App J's own 'poetry' case already
  // applies for UKAAF, here applied to BANA verse-PLAY dialogue specifically (formatPlay picks
  // this kind only for a verse block explicitly flagged block.playVerse — see F-180 there).
  if (kind === 'play-verse') return { first: lvl * 2, runover: Math.max(4, deepest * 2 + 2) };
  if (mode !== 'bana') {
    // UK-5 (28 Sep, James / decisions.md "UKAAF"): the 'compact' house style (B004 §10 Ex2 /
    // App C Ex2) is now the UKAAF DEFAULT — a caller that never sets `listStyle` at all (a test,
    // a direct formatDocument call, an older saved document) gets compact, same as one that sets
    // it explicitly. Only an explicit `listStyle: 'spaced'` opts back into the old 1-3 / blank-
    // line style (B004 §10 Ex1). Supersedes the previous "spaced unless told otherwise" default.
    if (kind === 'list' || kind === 'exercise') {
      if (listStyle !== 'spaced') return { first: 4 + lvl * 2, runover: 0 };         // B004 §10 Ex2 / App C Ex2 (UK-5 default)
      if (deepest === 0) return { first: 0, runover: 2 };                            // B004 §10 Ex1
      return { first: lvl * 2, runover: lvl * 2 + 4 };                               // B004 App C Ex1
    }
    if (kind === 'poetry') return { first: lvl * 2, runover: Math.max(4, deepest * 2 + 2) };   // B004 App J
  }
  return { first: lvl * 2, runover: deepest * 2 + 2 };
}
// The B004 §10 Ex2 'compact' list style is a UKAAF house style; Formats §8 has no
// equivalent, so the option is ignored in BANA mode. UK-5: compact is now the UKAAF default —
// true unless `o.mode === 'bana'` or `o.listStyle` is explicitly 'spaced'.
const isCompactList = (o) => o.mode !== 'bana' && o.listStyle !== 'spaced';

// Formats §4.3.7 (and B004 §5's "maximise the use of space"): font attributes are
// ignored in centred, cell-5 and cell-7 headings; §14.4.1c: likewise in stage
// directions. Drop `tf` from the text runs before translation, keeping uncontracted
// (grade 1) runs and inline maths as they are.
const stripEmphasis = (segments) => (Array.isArray(segments)
  ? segments.map((s) => (s && s.type !== 'math' && (s.tf || s.transcriberTypeform)) ? { ...s, tf: undefined, transcriberTypeform: undefined } : s)
  : segments);

// BANA §14.1.4 (restated for prose/verse plays at 14.5.1b/14.6.1c), F-178: "If print uses
// both full capitalization and emphasis to show speaker names, retain the capitalization and
// omit the emphasis." Only ever touches the block's own LEADING segment — a speaker's name is
// structurally always the first thing in a play-speaker block (parse.mjs extracts "speaker and
// dialogue into a single play-speaker block", name first) — and only when that segment is BOTH
// already emphasised (`tf` set) AND fully capitalised (has at least one cased letter, every
// cased letter uppercase — a bare "." or a digit carries no case, so "HAMLET." and "2" both
// still count, "Hamlet." does not). Deliberately narrower than "any matching segment anywhere
// in the block": dialogue text can independently be all-caps (a shouted line) and separately,
// legitimately emphasised — 14.1.4 is about the NAME specifically, and the name's own fixed
// leading position is the one thing about "which part is the name" that is not a judgement
// call (contrast Q-25, a genuinely open question about a different rule, 5.3.1's PARTIAL
// heading-emphasis retention, where no such structural anchor exists).
const isFullyCapitalised = (s) => {
  const letters = String(s ?? '').replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
};
const stripCapsEmphasis = (segments) => {
  if (!Array.isArray(segments) || !segments.length) return segments;
  const [first, ...rest] = segments;
  if (!first || first.type === 'math' || !first.tf || !isFullyCapitalised(first.text)) return segments;
  return [{ ...first, tf: undefined }, ...rest];
};
// A play-speaker/dialogue block's `style` is not one fixed string: parse.mjs always writes
// the literal 'play-speaker', but Emboss/web/editor/editor.mjs's own Lexical node round trip
// (paraBlock, `block.style = banaStyle`) normalises it to its internal canonical name
// 'dialogue' instead — found live in Chrome (22 Sep, this batch's own end-to-end check): a
// document imported once and re-rendered through the editor lost the F-178 fix entirely
// because `block.style === 'play-speaker'` alone no longer matched. 'speaker' is a third,
// older alias the editor's own style-picker mapping (setBanaStyleForBlock) still accepts.
const isPlaySpeakerStyle = (style) => style === 'play-speaker' || style === 'dialogue' || style === 'speaker';

// liblouis TYPEFORM bit for bold (engine/louis.mjs / louis-browser.mjs: TYPEFORM.bold = 4).
const TF_BOLD = 4;
// UKAAF B004 Appendix A, "Good practice example of six heading levels": levels 4 and 6
// each "Use a typeform indicator, such as bold" to stand apart from level 5, which sits
// at the same cell position (4 and 5 are both cell-1/runover-5) but is explicitly "without
// typeform indicators". This bold marks the heading's RANK, not the source document's own
// emphasis, so — like stripEmphasis for the other levels — it overrides any print tf already
// on the heading rather than layering onto it.
const forceBold = (segments) => (Array.isArray(segments)
  ? segments.map((s) => (s && s.type !== 'math') ? { ...s, tf: TF_BOLD } : s)
  : segments);

const isVerseBlock = (b) => !!b && typeof b === 'object' && (b.type === 'verse' || b.type === 'poem' || b.type === 'poetry'
  || (b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse' || b.style === 'poem')));
const isVerseSeparator = (b) => !!b && typeof b === 'object'
  && ((b.type === 'indicator' && (b.kind === 'line' || b.kind === 'stanza')) || b.type === 'blank');

// "The indention pattern is based on the entire poem" (Formats §13.3.1). Parsed poems
// arrive one verse line per block, so find each run of verse blocks (stanza breaks
// allowed inside) and return bi -> deepest level for every line of a poem that has
// sub-levels; a poem with a single level needs no annotation.
function verseRunLevels(blocks) {
  const out = new Map();
  let run = [], max = 0;
  const flush = () => { if (max > 0) for (const bi of run) out.set(bi, max); run = []; max = 0; };
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (isVerseBlock(b)) { run.push(bi); max = Math.max(max, b.level || 0); }
    else if (run.length && isVerseSeparator(b)) { /* stanza break inside the poem */ }
    else flush();
  }
  flush();
  return out;
}

// F-125 / BANA 13.6.4a: "Use uncontracted braille. Use the grade 1 passage indicator and terminator around the entire poem."
// F-128 / F-129 - UKAAF B004 App J poetry METHODS (UKAAF only, optional `poemMethod` on the verse lines of a poem; absent = the
// line-by-line method as before; BANA never reads it).
//  'line-indicator' (F-128), B004 App J "line indicator method": "Poetry may be written continuously with the line indicator
//    placed at the end of each verse line. Each stanza begins in cell 3 of a new line. The line indicator occurs at the end of
//    each stanza except the last. It doesn't appear at the end of a poem or verse extract." Each stanza becomes one running-text
//    block (first line cell 3, runovers cell 1, no blank line between stanzas); the indicator follows every verse line but the
//    poem's last. The guide's prose is ambiguous (every verse line vs stanza ends) - the guide's own worked example (gold b004-j-2)
//    puts it after every line, which is what is built. Its cells are the agency's choice: `o.lineIndicator` (braille ASCII, default
//    '_' = dots 456, as the gold shows; a UEB-style '_/' = dots 456-34 is the alternative).
//  'stanza-cell3' (F-129), B004 App J line-by-line method: "...alternatively, each stanza or paragraph may start in cell 3 of a
//    new line." No blank line between stanzas; the first line of each stanza is in cell 3, the rest in cell 1, runovers cell 5.
// Runs a pass over the whole block list before layout so formatBlock and traceBlock see the same ordinary `play` blocks (A39 parity).
function applyPoemMethods(blocks, o) {
  if (!Array.isArray(blocks) || o.mode === 'bana' || o.standard === 'bana') return blocks;
  if (!blocks.some((b) => b && b.poemMethod && isVerseLineBlock(b))) return blocks;
  const out = [];
  const ind = String(o.lineIndicator || '_');
  const lineSegs = (b) => (Array.isArray(b.segments) && b.segments.length ? b.segments : [{ type: 'text', text: String(b.text ?? '') }]);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const method = b && isVerseLineBlock(b) ? b.poemMethod : null;
    if (method !== 'line-indicator' && method !== 'stanza-cell3') { out.push(b); continue; }
    // collect the run: verse lines with separators between stanzas
    let j = i; const stanzas = [[]]; let trailing = [];
    while (j < blocks.length) {
      const c = blocks[j];
      if (isVerseLineBlock(c)) { stanzas[stanzas.length - 1].push(c); trailing = []; j++; }
      else if (isVerseSeparator(c)) { trailing.push(c); j++; if (stanzas[stanzas.length - 1].length) stanzas.push([]); }
      else break;
    }
    if (!stanzas[stanzas.length - 1].length) stanzas.pop();
    const rest = (l) => { const { text, segments, level, poemMethod, ...r } = l; return r; };
    stanzas.forEach((st, si) => {
      const lastStanza = si === stanzas.length - 1;
      if (method === 'stanza-cell3') {
        st.forEach((l, li) => out.push({ ...l, ...(li === 0 ? { poemFirst: 2, poemRunover: 4 } : {}) }));
      } else {
        const segs = [];
        st.forEach((l, li) => {
          if (li) segs.push({ type: 'text', text: ' ' });
          segs.push(...lineSegs(l));
          if (!(lastStanza && li === st.length - 1)) segs.push({ type: 'brl', text: '', brl: ind });
        });
        out.push({ ...rest(st[0]), type: 'play', subtype: 'verse', segments: segs, poemFirst: 2, poemRunover: 0, poemMethod: 'line-indicator' });
      }
    });
    if (trailing.length) out.push(...trailing);
    i = j - 1;
  }
  return out;
}

// Optional `uncontractedPoem` on any verse line of a poem (default off: contracted, as before) makes the whole run uncontracted with ONE
// passage indicator (;;;) in front of its first line and ONE terminator (;') after its last, not a pair per line. Returns
// bi -> { uncontractedPoem, g1Open, g1Close } for every line of such a run.
function uncontractedPoemRuns(blocks) {
  const out = new Map();
  let run = [], flagged = false;
  const flush = () => { if (flagged && run.length) run.forEach((bi, k) => out.set(bi, { uncontractedPoem: true, g1Open: k === 0, g1Close: k === run.length - 1 })); run = []; flagged = false; };
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (isVerseBlock(b)) { run.push(bi); if (b.uncontractedPoem) flagged = true; }
    else if (run.length && isVerseSeparator(b)) { /* stanza break inside the poem */ }
    else flush();
  }
  flush();
  return out;
}
// BANA 15.5.1c / 15.3.1c: a poem whose lines carry print line numbers (in any of its lines) keeps the two-cell margin before the
// number column on EVERY line, "whether these numbers are implied or actually shown". Same run shape as verseRunLevels; returns the
// indexes of the verse blocks of such runs. A poem with no numbers, or a book's other poems, are untouched.
function numberedVerseRuns(blocks) {
  const out = new Set();
  let run = [], numbered = false;
  const flush = () => { if (numbered) for (const bi of run) out.add(bi); run = []; numbered = false; };
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (isVerseBlock(b)) { run.push(bi); if (Array.isArray(b.segments) && b.segments.some((g) => g && g.type === 'linenum' && String(g.text ?? '').trim())) numbered = true; }
    else if (run.length && isVerseSeparator(b)) { /* stanza break inside the poem */ }
    else flush();
  }
  flush();
  return out;
}

// F-121 / BANA §13.3.1a ("Leave a blank line before and after a poem", exceptions: a
// cell-5/cell-7 heading immediately before the poem it applies to, or a cell-5 glossary
// entry word before a poem in a glossary — both already handled by joinsWithoutBlank, which
// is unaffected by this) and §13.7.1a ("Precede and follow a prose poem with blank lines").
// §13.9.3b (a blank line between the first and second doubly-transcribed versions of a poem)
// and §13.11.2b (a blank line before the first verse of a song) share this same root cause
// and need no separate mechanism: each is just another poem placed next to other content.
//
// Three block shapes carry a poem or prose poem, each needing its OWN run-boundary rule:
//  - a per-print-line block (`type:'play'`, subtype/style verse — what parse.mjs's parsePoem
//    and the real DTBook <poem>/<linegroup>/<line> round trip always produce, one block per
//    braille line): a maximal run of these, stanza-break indicators allowed inside (mirrors
//    verseRunLevels above), is ONE poem — no blank between its own lines, only at the run's
//    own two ends.
//  - a "whole poem" block (`type` verse/poem/poetry, its own `.lines` array): always its own,
//    self-contained poem, even sitting directly next to another one of the same kind — this
//    is exactly §13.9.3b's "first and second version" shape (two complete poems placed back
//    to back) and the general "two consecutive poems" case, which must still get a blank
//    line between them, not be merged into one run.
//  - a run of contiguous `para`/`style:'verse'` blocks (Emboss's prose-poem representation,
//    §13.7): merges like the per-line verse form (its own paragraphs are one prose poem),
//    parallel to how F-93/joinsWithoutBlank treats the paragraphs of one quoted passage.
const isVerseLineBlock = (b) => !!b && typeof b === 'object' && b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse' || b.style === 'poem');
const isWholePoemBlock = (b) => !!b && typeof b === 'object' && (b.type === 'verse' || b.type === 'poem' || b.type === 'poetry');
const isProsePoemBlock = (b) => !!b && typeof b === 'object' && b.type === 'para' && String(b.style ?? '').toLowerCase() === 'verse';
function poemRunBoundaries(blocks) {
  const starts = new Set(), ends = new Set();
  let run = [], kind = null;
  const flush = () => { if (run.length) { starts.add(run[0]); ends.add(run[run.length - 1]); } run = []; kind = null; };
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (isWholePoemBlock(b)) { flush(); starts.add(bi); ends.add(bi); continue; }
    if (isVerseLineBlock(b) || isProsePoemBlock(b)) {
      const k = isVerseLineBlock(b) ? 'line' : 'prose';
      if (run.length && kind === k) run.push(bi);
      else { flush(); run = [bi]; kind = k; }
      continue;
    }
    if (run.length && kind === 'line' && isVerseSeparator(b)) continue;   // stanza break inside a poem
    // F-240 / BANA 14.5.3d/14.6.3d/14.7.2: "Do not insert blank lines before or after stage
    // directions or cues printed outside or between the lines of dialogue." A `stage` block
    // sitting inside a verse-PLAY run is neither a verse block nor a stanza separator, but it
    // must not flush the run either — otherwise each side becomes its own isolated one-line
    // "poem" and picks up its own leading/trailing blank, putting a blank on BOTH sides of the
    // stage direction. Treated exactly like a stanza break: skipped, run stays open, the stage
    // direction itself is never added to `run` (so it is never a start/end of the poem's own
    // outer boundary either).
    if (run.length && kind === 'line' && b && b.type === 'stage') continue;
    flush();
  }
  flush();
  return { starts, ends };
}

// Blank-line exceptions after a heading (BANA). True when `block`, which follows the
// emitted heading `prev`, may not be separated from it by a blank line: §4.3.3 no
// blank line between connected headings (§4.5.6 cell-5 → cell-5; §4.5.7 / §4.6.2
// cell-5 → cell-7 — see HEADING_JOIN_TIERS below for the exact heading/heading table);
// §4.5.3 / §8.3.3a a cell-5 or cell-7 heading is not followed by a blank line before a
// list; §13.3.1a nor before the poem it applies to. A centred heading keeps its blank
// line after (§4.4.1) except before another heading of one of the tiers named below.
//
// BANA heading tiers (Formats §4.2.1-§4.2.2). The braille hierarchy is centred, cell-5,
// cell-7. "When there are more than three distinct heading levels in print, cell-7
// headings are applied only to the lowest hierarchy level; the use of centered headings
// is extended to one or more subsection levels as necessary" — so the tier of a print
// level depends on the whole document, not on the level number alone:
//   deepest level ≤ 3  → the fixed mapping h1 centred, h2 cell-5, h3 cell-7 (unchanged);
//   ≤ 3 distinct levels (e.g. h1, h2, h5) → top-down: centred, cell-5, cell-7;
//   > 3 distinct levels → bottom-up: deepest cell-7, next cell-5, all above centred.
// banaHeadingTiers() builds the level→tier map once per document (o.headingTiers).
function banaHeadingTiers(blocks) {
  const levels = new Set();
  const visit = (bs) => {
    for (const b of bs || []) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'heading') levels.add(Math.max(1, Number(b.level) || 1));
      if ((b.type === 'box' || b.type === 'sidebar') && Array.isArray(b.blocks)) visit(b.blocks);
    }
  };
  visit(blocks);
  const sorted = [...levels].sort((a, b) => a - b);
  if (!sorted.length || sorted[sorted.length - 1] <= 3) return null;
  const tiers = {};
  if (sorted.length <= 3) {
    const topDown = ['centred', 'cell5', 'cell7'];
    sorted.forEach((lv, i) => { tiers[lv] = topDown[i]; });
  } else {
    sorted.forEach((lv, i) => {
      const fromBottom = sorted.length - 1 - i;
      tiers[lv] = fromBottom === 0 ? 'cell7' : (fromBottom === 1 ? 'cell5' : 'centred');
    });
  }
  return tiers;
}
function banaTier(lvl, o) {
  const L = Math.max(1, Number(lvl) || 1);
  const t = o && o.headingTiers && o.headingTiers[L];
  if (t) return t;
  return L === 1 ? 'centred' : (L === 2 ? 'cell5' : 'cell7');   // no document context: fixed mapping
}
const headingTierKey = (o) => (o && o.headingTiers ? JSON.stringify(o.headingTiers) : '');
// F-26: the exact heading-to-heading tier pairs BANA §4 exempts from the general
// blank-line defaults (§4.4.1 blank after a centred heading; §4.5.1 blank before a
// cell-5 heading; §4.6.2 blank before a cell-7 heading). Every pair NOT listed here
// keeps the default blank line — "followed by another heading" is not one of §4.4.1's
// three named exceptions (a: related box; b: table-of-contents entry; c: alphabetic
// division), so a centred heading followed by a cell-5 or cell-7 heading is NOT exempt,
// contrary to the previous "any heading after any heading" behaviour this replaces:
//   centred -> centred : NO blank — §4.3.3 "Do not insert a blank line between
//                         connected headings" (Examples 4-3/4-4 are each one
//                         conceptual heading split across two centred lines: chapter
//                         number + title, unit number + title — same-tier, genuinely
//                         connected). K2/EMBOSS-TASKS G1 (KD, BANA Example 4-2): a
//                         title and its author's name are TWO SEPARATE items, not one
//                         connected heading split in two, even though both are level-1
//                         centred headings run one after the other in print — Example
//                         4-2's own braille keeps the ordinary blank line between them.
//                         A byline/author heading produced right under a title
//                         (parse.mjs's `<byline>` handling) carries `notConnected: true`
//                         for exactly this reason, opting back into the default blank
//                         line the way F-84's `notConnected` flag already does for any
//                         other heading pair that looks connected but isn't.
//   cell-5  -> cell-5  : NO blank — §4.5.6 "A cell-5 heading may be followed by an
//                         equally important cell-5 heading, without a blank line
//                         between the two headings."
//   cell-5  -> cell-7  : NO blank — §4.5.7 "A cell-5 heading may be followed by a
//                         cell-7 heading, without an intervening blank line", and
//                         §4.6.2's own exception: "There is no blank line between a
//                         cell-5 heading and cell-7 heading."
//   centred -> cell-5  : blank kept — §4.4.1 default + §4.5.1 "Precede a cell-5
//                         heading with a blank line" (unconditional; not excepted).
//   centred -> cell-7  : blank kept — §4.4.1 default + §4.6.2 "Precede a cell-7
//                         heading with a blank line" (its only exception names a
//                         PRECEDING cell-5 heading, not centred).
//   cell-5  -> centred : blank kept — §4.5.5 "A cell-5 heading cannot be followed by
//                         a centered heading" says this pairing doesn't occur in a
//                         well-formed document; if it appears anyway, no rule exempts
//                         it, so §4.4.1's default (blank before a centred heading)
//                         applies.
//   cell-7  -> (any)   : blank kept — §4.6.6 "A cell-7 heading cannot be followed by
//                         a: Centered heading / Cell-5 heading / Cell-7 heading" names
//                         no exception either; the receiving tier's own default rule
//                         (§4.4.1 / §4.5.1 / §4.6.2) applies if it appears anyway.
const HEADING_JOIN_TIERS = new Set(['centred>centred', 'cell5>cell5', 'cell5>cell7']);
// BANA 21.2.3c: "Insert a blank line before, but not after, the first alphabetical division."
// A centred heading that is just a division letter (or a short letter range such as "A-B")
// followed by an index/glossary list joins it with no blank line.
function isDivisionLetterBeforeReference(heading, block) {
  if (!block || block.type !== 'list' || (block.kind !== 'index' && block.kind !== 'glossary')) return false;
  const t = (heading.text ?? (heading.segments || []).map((g) => g.text || '').join('')).trim();
  // 21.2.3: a division letter is one letter, a print capital-and-lower pair ("A a", Sample 21-10) or a short range.
  return /^\p{L}(\s\p{L}|\s?[-\u2013\u2014]\s?\p{L})?$/u.test(t);
}
// `nb` (optional) = { before, after }: the blocks either side of the pair, for the two "one list
// interrupted by something" joins (BANA 6.2.2a image note, 1.11.3a print-page indicator).
const isPlainList = (b) => !!b && b.type === 'list' && (b.kind == null || b.kind === 'list');
const isImageNote = (b) => !!b && (b.type === 'graphic' || b.type === 'tactile') && isPrintImage(b);
// UK-5 (28 Sep, James / decisions.md "UKAAF"): the one blank-line exception UKAAF keeps is before a
// "sub-heading" — B004 §5's cell-1/runover-cell-5 heading. In Emboss's UKAAF level mapping (formatHeading /
// traceBlock's 'heading' case) that is levels 2 and 5 (§5 L2; Appendix A L5) and level 4 (Appendix A L4,
// same margins, bold) — NOT level 3 or 6, which are cell-3/runover-5 and get no exception, despite the
// brief's shorthand "level 2/3" (checked directly against the margins those branches use).
const isUkaafSubHeading = (block) => !!block && block.type === 'heading' && [2, 4, 5].includes(block.level || 1);
function joinsWithoutBlank(prev, block, o, nb = null) {
  if (!prev || !block) return false;
  // UK-4 (docs/decisions.md "UKAAF"; diagnosis-ukaaf-and-page-count-26sep.md cause 5): B004 §10 does not call
  // for a blank line between a heading and a sub-heading directly under it — sample 2's gold puts "For the
  // madeira cake:" (L3) directly under "Ingredients" (L1) with nothing between them. `block.level > prev.level`
  // reads "directly under" as strict nesting (a deeper heading immediately following a shallower one), not
  // just any two adjacent headings — two headings at the SAME level (e.g. two L1 sections in a row) are not
  // "one under the other" and keep the ordinary blank line. UKAAF only; BANA's own heading-join rules
  // (HEADING_JOIN_TIERS below) are unaffected — checked, no equivalent BANA bug: BANA already has explicit,
  // separately-cited tier-by-tier exceptions for when two headings join without a blank line.
  // UK-5 (28 Sep, James): UKAAF carries NO blank lines at all, except before a sub-heading (isUkaafSubHeading,
  // above) that does not directly follow a centred (level-1) heading — the "directly follows a centred
  // heading" case is already the heading-to-heading branch just below (UK-4), unchanged. Supersedes UK-1
  // through UK-4's narrower, BANA-style "blank line by default, drop it in specific cases" reading for
  // UKAAF: UK-5 flips the UKAAF default itself. This function's two callers (buildDocPages/
  // buildDocPagesAsync) strip BOTH the previous block's own trailing blank line(s) and this block's own
  // leading blank line(s) whenever it returns true, regardless of which formatter emitted them (a list, a
  // table, a footnote, a box, a poem/displayed-material run …) — so this one boundary rule removes the
  // blank lines every one of those would otherwise carry around it in UKAAF, without editing each
  // formatter individually. Where a B004 structure needs its own separator regardless (a box's own border
  // lines; a table's UK-6 end marker) that lives in the formatter itself, untouched by this.
  if (o.mode !== 'bana') {
    if (prev.type === 'heading' && block.type === 'heading') return (block.level || 1) > (prev.level || 1);   // UK-4, unchanged
    if (isUkaafSubHeading(block)) return false;   // UK-5 exception: this sub-heading keeps its blank line
    // A line/stanza-break separator's entire rendered content IS one blank line — traceBlock's
    // 'break'/'indicator' case: `if (kind === 'line' || kind === 'stanza') return [tcBlank]`, same
    // as a bare 'blank' block — whether it is marking a poem stanza break (B004 App J) or the
    // editor's general-purpose Document Break. It is not padding AROUND some other block that UK-5
    // removes, it IS the requested break itself (found via this file's own test suite: stripping
    // it left two stanzas, or two paragraphs either side of a manual break, running together with
    // no visible break at all). Never stripped, on either side of the pair. (isVerseSeparator
    // itself only names 'indicator', not 'break' — kept separate rather than widened, since it
    // also drives poem-run boundary detection elsewhere, where the distinction may matter.)
    const isBlankLineBlock = (b) => b.type === 'blank' || ((b.type === 'break' || b.type === 'indicator') && (b.kind === 'line' || b.kind === 'stanza'));
    if (isBlankLineBlock(prev) || isBlankLineBlock(block)) return false;
    return true;   // UK-5: no blank line anywhere else
  }
  // BANA 6.2.2a: no blank line before or after an image caption/description "unless required by
  // other formats"; a list interrupted by the image continues, so list / image note / list has
  // no blank on either side of the note (Sample 6-12).
  if (nb) {
    if (isPlainList(prev) && isImageNote(block) && isPlainList(nb.after)) return true;
    if (isImageNote(prev) && isPlainList(block) && isPlainList(nb.before)) return true;
    // BANA 1.11.3a/b/c: a print page indicator inside a continuing list (list / indicator / list)
    // takes no blank line on either side - neither the list's own ending blank nor a starting one
    // is required (Sample 6-11).
    if (isPlainList(prev) && block.type === 'pagenum' && isPlainList(nb.after)) return true;
    if (prev.type === 'pagenum' && isPlainList(block) && isPlainList(nb.before)) return true;
  }
  if (prev.type === 'para' && prev.songInfo && block.type === 'para' && block.songInfo) return true;   // 13.11.2b: no blank lines between the items under a song title
  // K10 / BANA 4.3.6 ("A heading is not preceded by a blank line when it follows the note
  // separation line") read LITERALLY, per KD's answer to Q-10: only the note that itself
  // carries the separation line (`noteRunStart`, formatFootnote's noteLead — i.e. a run of
  // exactly one note, so nothing but that one note's own text sits between the separator and
  // the heading) drops the heading's blank line. A heading after a run of TWO OR MORE notes
  // still gets the default blank line — the block right before it there is the run's LAST
  // note, which does not carry `noteRunStart` (only the first note of a run does), so this
  // branch does not fire for it. An endnote never gets the separation line (noteLead), so it
  // is excluded here too.
  if (prev.type === 'footnote' && prev.kind !== 'endnote' && prev.noteRunStart && block.type === 'heading') return true;
  if (prev.type === 'heading') {
    // F-84: optional per-heading opt-out. `notConnected: true` on the LATER heading (e.g. a byline
    // that is a separate element, Sample 13-2) keeps the blank line 4.3.3 would otherwise drop.
    // F-69 / BANA 7.2.1e (8.3.3b, Sample 8-4): a heading that accompanies the box right after it (optional
    // `accompaniesBox` on the heading) takes no blank line before the box's top line.
    if ((block.type === 'box' || block.type === 'sidebar') && prev.accompaniesBox) return true;
    // BANA 21.2.3c: "a blank line before, but not after, the first alphabetical division" - a division letter
    // that follows a title heading (Sample 21-10 "Thesaurus" / "A a") is not a connected heading.
    if (block.type === 'heading' && nb && isDivisionLetterBeforeReference(block, nb.after)) return false;
    if (block.type === 'heading') return !block.notConnected && HEADING_JOIN_TIERS.has(`${banaTier(prev.level, o)}>${banaTier(block.level, o)}`);
    if (block.type === 'attribution' && block.kind === 'source') return true;   // 9.5.2: no blank line between a heading and a source citation
    // BANA 21.6.5c/f (Samples 21-7, 21-8): a glossary entry word treated as a cell-5 heading (optional `entryWord`
    // on the heading) takes no blank line before its illustrative material, "even though blank lines are
    // required in specific formats, such as poetry": the paragraph, list, displayed text or verse that follows.
    if (prev.entryWord && block.type !== 'heading') return true;
    const prevTier = banaTier(prev.level, o);
    if (prevTier === 'centred') return isDivisionLetterBeforeReference(prev, block);   // BANA 21.2.3c
    // §1.9.3's own exception, having failed the centred check above `prevTier` is now either
    // cell-5 or cell-7: "[a blank line precedes each blocked paragraph] unless it follows a
    // cell-5 or cell-7 heading" — drop the blocked paragraph's own leading blank (F-39).
    if (block.type === 'para' && (block.blocked || directionsMargins(block, o))) return true;   // directions: §4.5.3 "usually not followed by a blank line"
    if (block.type === 'list' && block.columns > 1 && columnedListPlan(block, o)) return false;   // §4.5.3 / §8.4.1a: a blank line separates the heading from columns
    return block.type === 'list' || block.type === 'glossary' || isVerseBlock(block);
  }
  // K32 / BANA 21.2.3d: "Do not insert blank lines before or after other alphabetical
  // divisions" — a division letter that follows the PREVIOUS division's own list (as opposed to
  // the reference's title heading, or a headnote paragraph under it — either of which still
  // introduces the FIRST division, keeping 21.2.3c's blank line) takes no blank line before it.
  if (prev.type === 'list' && block.type === 'heading' && nb && isDivisionLetterBeforeReference(block, nb.after)) return true;
  // F-69 / BANA 7.2.1e (with 11.3.1c/d): no blank line between a caption and the box that follows it.
  if (prev.type === 'caption' && (block.type === 'box' || block.type === 'sidebar')) return true;
  // BANA 3.2.2 / 10.6.8 / 10.6.10 (Examples 10-19, 10-22): a transcriber's note explaining how the
  // exercise question below was changed sits directly above it - no blank line between them.
  // Optional `afterNote` on the list (default off): the note explaining a symbol used in the list sits directly above it (Sample 17-11, 17.9.2a).
  if (prev.type === 'note' && block.type === 'list' && (block.afterNote || block.kind === 'exercise' || (prev.cell5 && block.kind === 'list'))) return true;   // cell5: 10.9.2b heading TN, list directly under
  // K11 / BANA 14.10.4b (Example 14-10): a single-frame cartoon's caption runs straight on from
  // its own scene-setting note, no blank line at all — unlike an ordinary caption, which always
  // opens with one (formatCaption's unconditional leading ''). Same `afterNote` opt-in flag as
  // the list case just above, now also allowed on a caption block (field-registry.mjs).
  if (prev.type === 'note' && block.type === 'caption' && block.afterNote) return true;
  // BANA §10.2.3: "Do not leave a blank line between directions and exercise material unless it
  // is required by other formats" — a list or definition list straight after a directions paragraph.
  // BANA 10.7.2b: a word list for multiple questions (optional `wordList` flag) is not "exercise material":
  // the blank line before it is kept.
  if (prev.type === 'para' && directionsMargins(prev, o) && (block.type === 'list' || block.type === 'glossary') && !(block.type === 'list' && (block.wordList || startsExerciseExample(block, o)))) return true;
  // K23 / BANA 1.9.3 as clarified in the March 2024 Updates: "A blank line precedes blocked paragraphs, unless they
  // follows a cell-5 heading, a cell-7 heading, an open box line, or directions." Directions (10.3.2, `directions`)
  // then a blocked paragraph (1-1: `blocked`, or every paragraph when paragraphStyle is 'block'; not displayed material,
  // and not a diagrammed sentence with arrow lines, which 18.8.1 precedes by a blank line: Example 18-14).
  if (prev.type === 'para' && prev.directions && block.type === 'para' && !block.directions && (block.blocked || o.paragraphStyle === 'block') && !quoteMargins(block, o) && !(Array.isArray(block.arrowLines) && block.arrowLines.length)) return true;
  // K23 / BANA 3.2.1c, 4.3.1 as clarified in the March 2024 Updates: "If a transcriber's note comes between two items
  // that do not require a blank line between them, e.g. directions and exercise material or a cell 5 heading and a
  // blocked paragraph, no blank line is required preceding or following the transcriber's note." Look through the note
  // to the item on its other side. A cell-5 note (10.9.2b: a heading in TN indicators) is a heading here, not a note, and a
  // key list in a note (`keyList`, formatTnKeyList) keeps its blank lines ("Blank line before and after key list", App. C).
  if (nb) {
    const isTn = (b) => !!b && typeof b === 'object' && b.type === 'note' && !b.cell5 && !b.keyList;
    if (isTn(prev) && nb.before && typeof nb.before === 'object' && !isTn(nb.before) && joinsWithoutBlank(nb.before, block, o)) return true;
    if (isTn(block) && nb.after && typeof nb.after === 'object' && !isTn(nb.after) && joinsWithoutBlank(prev, nb.after, o)) return true;
  }
  // F-93 / §9.2.2b: "Do not insert blank lines between individual items in displayed
  // material" — two adjacent quote-styled paragraphs at the SAME adjusted margin (same
  // style bucket via quoteMargins, same nesting level) are the paragraphs of one displayed
  // passage (exactly what parse.mjs's <blockquote> handling produces for a <blockquote>
  // with several <p> children), not two separate passages — join with no blank at all. A
  // different margin (a different nesting level) is treated as a different passage and
  // keeps the default blank (see the F-93 regression test in
  // displayed_and_verse_rules.test.mjs). K6: the test is the shared RUNOVER (the adjusted
  // margin itself), not the first-line margin — §9.2.2d lets one paragraph of a passage be
  // blocked and the next indented (KD: "fully dependent upon what print has"), and both are
  // still the same passage, so comparing `first` too would wrongly reinsert a blank line
  // between them.
  if (block.type === 'para') {
    const prevQ = quoteMargins(prev, o), q = quoteMargins(block, o);
    if (prevQ && q && prevQ.runover === q.runover) return true;
  }
  return false;
}

// Heading formatter. levels 1..6.
//  UKAAF (B004 §5, R4-R7, levels 1-3): L1 centred (preceded by an indicator line);
//    L2 cell 1 / runover cell 5; L3 cell 3 / runover cell 5; blank line before L2/L3.
//  UKAAF (B004 Appendix A, "Good practice example of six heading levels", levels 4-6):
//    levels 1-3 there are renumbered for a book-length document (L1 new-page/no-indicator,
//    L2 centred+indicator, L3 centred/no indicator) — a DIFFERENT scheme from §5's, which
//    this formatter keeps for L1-3 (byte-identical output is required). What Appendix A
//    adds beyond the 3-level case is read literally for L4-6, appended after L3:
//      "Level 4: Cell 1 heading with runovers in cell 5, preceded by a blank line. Use a
//       typeform indicator, such as bold." -> same margins as L2, forced bold (forceBold).
//      "Level 5: Same as level 4, but without typeform indicators." -> L2's margins, plain.
//      "Level 6: Starting in cell 3 with runovers in cell 5. Use a typeform indicator such
//       as bold." -> same margins as L3 (blank line before, by parallel structure with L4),
//       forced bold.
//  BANA (Formats §4.4-4.6, R4-R6, levels 1-3): centred (blank before+after); cell-5; cell-7.
//  BANA levels 4-6: §4.2.1 "When there are more than three distinct heading levels in
//    print, cell-7 headings are applied only to the lowest hierarchy level; the use of
//    centered headings is extended to one or more subsection levels as necessary." Formats
//    defines only the three margin treatments in §4.2.2 ("centered, cell-5, cell-7") —
//    there is no fourth print position — so, keeping L1-3 exactly as they already are
//    (L3 = cell-7, the required byte-identical baseline), the only BANA-defined tool left
//    for extending the hierarchy further is the "extended" centred treatment: L4-6 are
//    centred, the same as L1, per §4.2.1's own wording (their content, per §2.10.3/§4.2.1,
//    is expected to carry a distinguishing terminology/typeface cue from the source, which
//    braille headings don't otherwise encode).
//  Font attributes: BANA drops a typeform that covers the whole heading and keeps one that
//  covers only part of it (K1: §4.3.7, §5.3.1, Example 4-7; see headingEmphasisOf); UKAAF
//  drops them all (B004 §5), except the synthetic bold UKAAF adds at L4/L6 (see forceBold).
// Line breaks and spaces at the very start or end of a heading's runs mean nothing in braille (Shift+Enter at the start of a
// heading in the editor; a save drops them) — A89, random-action testing. Both layout paths trim them the same way.
function headingWithTrimmedEdges(block) {
  if (!Array.isArray(block.segments) || !block.segments.length) return block;
  const first = block.segments[0], last = block.segments[block.segments.length - 1];
  const edge = (g, re) => g && g.type !== 'math' && typeof g.text === 'string' && re.test(g.text);
  if (!edge(first, /^\s/) && !edge(last, /\s$/)) return block;
  return { ...block, segments: trimRunEdges(block.segments) };
}
function formatHeading(block, o, atStart) {
  block = headingWithTrimmedEdges(block);
  const w = o.width;
  const L = block.level || 1;
  const out = [];
  // F-75: a box's own title (boxTitleHeading) is not a §4 heading, so §4.3.7's "font attributes
  // are ignored" does not apply to it — it sets keepEmphasis and its own segments survive.
  const plainT = () => (block.segments ? segmentsToBraille(block.keepEmphasis ? block.segments : headingEmphasisOf(block.segments, o), o) : o.translate(block.text ?? ''));
  const boldT = () => {
    if (block.segments) return segmentsToBraille(forceBold(stripEmphasis(block.segments)), o);
    const text = block.text ?? '';
    return o.translate(text, Array(text.length).fill(TF_BOLD));
  };
  if (o.mode === 'bana') {
    const tier = block.tierOverride || banaTier(L, o);                                    // §4.2.1-2, see banaHeadingTiers (tierOverride: F-75, a box's own title)
    // K6 / BANA §9.2.2c: "Cell-5 and cell-7 headings within displayed material are based on
    // the adjusted left margin. Consequently the margins for cell-5 headings are blocked in
    // 7-7, and cell-7 headings are blocked in 9-9." KD: "Yes, and the margin should shift
    // outward." The adjusted left margin (cell 3) is 2 cells right of the ordinary body
    // margin (cell 1), so a heading nested in displayed material (`block.displayed`, set by
    // the reader — see field-registry.mjs and quoteMargins/formatList's own `displayed`
    // offset) shifts by that same 2 cells: cell-5 (5-5) -> 7-7, cell-7 (7-7) -> 9-9. Centred
    // headings are unaffected — §9.2.2c: "Centered headings remain based on the non-adjusted
    // left margin, i.e., the full width of the line."
    const dspOff = block.displayed ? 2 : 0;
    if (tier === 'cell5') { out.push('', ...wrapCells(plainT(), w, 4 + dspOff, 4 + dspOff)); }              // cell-5 (§4.5)
    else if (tier === 'cell7') { out.push('', ...wrapCells(plainT(), w, 6 + dspOff, 6 + dspOff)); }         // cell-7 (§4.6)
    else { out.push('', ...centredHeadingBlock(plainT(), w, Math.max(1, w - 6)), ''); }   // centred (§4.4.1-2, §4.4.3)
  } else {
    // §5: an L1 heading is centred, optionally preceded by an indicator line. The indicator
    // is an "end marker … placed after a section is complete" (B004 R17: "can be", not a
    // requirement), so there is nothing for it to close at the very top of a document — emit
    // the heading alone (and no leading blank line) when it opens the document. UK-1 (26 Sep
    // 2026, docs/decisions.md "UKAAF"): the marker was previously emitted before every non-
    // first L1 heading unconditionally, over-applying an optional B004 convention (the UKAAF
    // gold corpus's own leaflets, several L1 headings each, carry none at all). Off by
    // default; `o.endMarkers` (a document option) turns it on everywhere, `block.endMarkerBefore`
    // turns it on for just this heading. UK-6 (28 Sep, James): this end-of-chapter marker is now
    // the COLONS form, not dot-2s — UK-1's dot-2s choice is superseded (dot-2s is now UK-6's
    // after-table / after-subsection marker). UK-5 (28 Sep, James): UKAAF carries no blank line
    // here at all (marker on or off) — joinsWithoutBlank's UKAAF branch drops this block's own
    // leading blank the same way it does for every other UKAAF join, so nothing is pushed here.
    if (L === 1) {
      if (atStart) out.push(...centredBlock(plainT(), w));
      else {
        const wantMarker = o.endMarkers === true || block.endMarkerBefore === true;   // UK-1/UK-6
        out.push(...(wantMarker ? [indicatorLine('colons', w)] : []), ...centredBlock(plainT(), w));
      }
    } else if (L === 2 || L === 5) { out.push('', ...wrapCells(plainT(), w, 0, 4)); }      // cell 1 / runover 5 (§5 L2; App A L5) — UK-5 sub-heading: blank line kept
    else if (L === 3) { out.push(...wrapCells(plainT(), w, 2, 4)); }                       // cell 3 / runover 5 (§5 L3) — UK-5: no blank-line exception here
    else if (L === 4) { out.push('', ...wrapCells(boldT(), w, 0, 4)); }                    // App A L4: cell 1 / runover 5, bold — UK-5 sub-heading: blank line kept
    else { out.push(...wrapCells(boldT(), w, 2, 4)); }                                     // App A L6: cell 3 / runover 5, bold — UK-5: no blank-line exception here
  }
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Centred title used once at the top of a document (B004 §5 / Formats §2.10).
// Wrapped + each line centred independently if longer than the page width
// (see centredBlock; gold-verified against sample3's multi-line headline).
// A title with a forced line break — a Word/ODT/RTF Title followed by its Subtitle (IMP-W1: "Main\nSub") — centres each
// line on its own braille line, as print sets them (30 Sep: the break was translated as a space and the two ran together).
function formatTitle(block, o) {
  return String(block.text ?? '').split('\n').flatMap((part) => centredBlock(o.translate(part), o.width).map((l) => l.replace(/\s+$/, '')));
}

// List (B004 §10, R2/R3; Formats §8). Two standard house styles, chosen by o.listStyle:
//   'spaced' (default, B004 §10 Ex1 / Formats §8.3): blank line before & after; entry
//       cell 1, runover cell 3 (1-3); print marker kept in cell 1; nested levels per
//       nestedMargins (Formats §8.5.1b / B004 App C Ex1).
//   'compact'  (B004 §10 Ex2, UKAAF only): entry cell 5, runover cell 1 (5-1); print
//       markers kept (numbers always, bullets per Show bullets, UK-10); no blank lines; nested further
//       indents cell 7, 9 (5/1, 7/1, 9/1).
// kind 'exercise' (Formats §10.4), 'index' (§21.2.1b / B004 App I) and 'toc' (§2.10.6b)
// take the same nested pattern via nestedMargins. A '•' print bullet is retained as the
// UEB bullet _4 (dots 456, 256; Formats §8.6.2a), added after translation.
const UEB_BULLET = '_4';
// F-33 / BANA Formats §8.6.2a: the print bullet keeps its own braille correspondence. A bullet is the
// item's `marker` when it is one of these glyphs, or an optional `item.bullet` (glyph or name) carried
// BESIDE an ordinal `marker` (§8.7.1a: Example 8-5a "_4 #b4 ..."). Only the primary bullet is unmarked;
// the others need a Special Symbols entry / transcriber's note (§8.6.2b, G8, not built).
// K22(b) / errata (Sample 8-13, UEB 3.28): the checkmark bullet is dot 4 + dots 1-4-6, `@%` —
// not dot 5 + dots 1-4-6, `"%` (the old §8.6.2a table's mistake, matching neither UEB 3.28 nor
// what liblouis itself gives for √/✓/✔).
const BULLET_BRAILLE = { '•': UEB_BULLET, '□': ';$#D', '■': '_$#D', '○': ';$=', '▲': ';$#C', '√': '@%', '✓': '@%', '✔': '@%',
  // G8 stage 1 (opt-in sub-level bullets). BANA §8.6.2a leaves a print sub-level bullet to the transcriber (follow print,
  // list the symbol, §8.6.2b); no fixed cells, so they reuse the cells of the hollow circle and solid square.
  '◦': ';$=', '▪': '_$#D' };
const BULLET_NAMES = { dot: '•', 'hollow square': '□', 'solid square': '■', 'hollow circle': '○', triangle: '▲', checkmark: '√' };
const DEFAULT_LEVEL_BULLETS = ['•', '◦', '▪'];
// Opt-in only (block.symbols array, or o.nestedBullets === true): the glyph for list level N (default •, ◦, ▪, repeating
// the last). Off by default so existing output is unchanged.
const levelBulletsOn = (block, o) => Array.isArray(block?.symbols) ? block.symbols.length > 0 : o?.nestedBullets === true;
function levelBulletGlyph(block, level) {
  const seq = Array.isArray(block?.symbols) && block.symbols.length ? block.symbols : DEFAULT_LEVEL_BULLETS;
  return seq[Math.min(level, seq.length - 1)];
}
const bulletGlyph = (v) => { const g = BULLET_NAMES[String(v ?? '').toLowerCase()] ?? v; return Object.prototype.hasOwnProperty.call(BULLET_BRAILLE, g) ? g : null; };
// IMP-W7: a "custom" print bullet is a single symbol (dingbat, arrow, star, dash...) that is neither an ordinary dot-like
// bullet nor one of the bullets BULLET_BRAILLE gives cells to. The dot-like shapes (small/black circles and squares, the
// middle dot, the triangular and hyphen bullets) stay the ordinary bullet, as they always were.
const DOT_LIKE_BULLET_RE = /^[\u2022\u00B7\u2219\u2023\u2043\u25E6\u25AA\u25AB\u25CF\u26AB\u26AC\u2B24\u29BF\u2218\u25D8\u25D9]$/;
const CUSTOM_BULLET_RE = /^[\p{So}\p{Pd}\u2212\u2190-\u21FF\u2900-\u297F]$/u;
function customBulletGlyph(marker) {
  const t = String(marker ?? '').replace(/\uFE0F/g, '').trim();
  if (!t || [...t].length !== 1) return null;
  if (DOT_LIKE_BULLET_RE.test(t) || Object.prototype.hasOwnProperty.call(BULLET_BRAILLE, t)) return null;
  return CUSTOM_BULLET_RE.test(t) ? t : null;
}
// What the Special Symbols page calls a custom bullet (BANA 2.5.2d: the symbol, a space, its meaning with a capital).
const CUSTOM_BULLET_SHAPES = [
  [/^[\u2190-\u21FF\u2794\u2798-\u27BE\u27F0-\u27FF\u2900-\u297F\u2B00-\u2B11\u2B60-\u2BFF\u25B6\u25BA\u25B7\u25C0\u25C4\u25C1\u25BB]$/, 'arrow'],
  [/^[\p{Pd}\u2212]$/u, 'dash'],
  [/^[\u2605\u2606\u2726-\u2735\u2736-\u273D\u2B50]$/, 'star'],
  [/^[\u25C6\u25C7\u2756\u2B25-\u2B2A\u2666\u2662]$/, 'diamond'],
  [/^[\u2715-\u2718]$/, 'cross'],
  [/^[\u2665\u2661\u2764]$/, 'heart'],
  [/^[\u2740-\u2743\u273F\u2741\u273E]$/, 'flower'],
  [/^[\u25FC\u25FB\u25FE\u25FD]$/, 'square'],
];
function customBulletDescription(ch) {
  const hit = CUSTOM_BULLET_SHAPES.find(([re]) => re.test(ch));
  return hit ? `${hit[1].charAt(0).toUpperCase()}${hit[1].slice(1)} bullet` : `Bullet symbol ${ch}`;
}
// BANA only: the transcriber-defined symbol for a custom print bullet, taken from the same pool, in the same order of first
// use, as ICON-1's icons (assignIconSymbol). null when this is not a custom bullet, the output is UKAAF, or all seven symbols
// are taken (then a warning says the ordinary bullet stood in).
function customBullet(marker, o) {
  if (!o || !isBanaOpts(o)) return null;
  const ch = customBulletGlyph(marker);
  if (!ch) return null;
  const cp = ch.codePointAt(0);
  const sym = assignIconSymbol(o, ch, cp, customBulletDescription(ch));
  if (sym) return { brl: sym.brl, char: ch, description: sym.description };
  if (!o._warnCtx) return null;   // the pre-pass (preassignIconSymbols) has no block yet; the block's own layout reports it
  const ctx = o._warnCtx;
  const at = typeof ctx.blockIndex === 'number' ? ctx.blockIndex : -1;
  if (!(o._warnings || []).some((w) => w.kind === 'bullet-symbol-overflow' && w.blockIndex === at && w.glyph === ch)) {
    pushWarning(o, 'bullet-symbol-overflow', `The bullet ${ch} has no transcriber-defined symbol left (a document can have seven); it was brailled as the ordinary bullet.`, { glyph: ch });
  }
  return null;
}
// The item's bullet: { brl, ordinal } (ordinal = the marker text kept beside a separate `bullet`), or null.
function itemBullet(item, block, o) {
  if (!item) return null;
  if (block && (item.level || 0) > 0 && !item.bullet && levelBulletsOn(block, o)) {
    const base = itemBullet(item, null, o);              // only a primary-dot item takes the level glyph; numbers/letters stay as printed (a custom print bullet, IMP-W7, is not a dot)
    if (base && !base.ordinal && base.brl === UEB_BULLET) {
      const g = bulletGlyph(levelBulletGlyph(block, item.level || 0));
      if (g) return { brl: BULLET_BRAILLE[g], ordinal: '' };
    }
    return base;
  }
  // F-42 / F-33 (23 Sep verification): a bullet name or glyph the table does not know (`star`, `★`, `●`, `*`) is
  // still a bullet - it falls back to the primary dot bullet instead of being dropped or printed as raw text.
  if (item.bullet) { const g = bulletGlyph(item.bullet); return { brl: g ? BULLET_BRAILLE[g] : UEB_BULLET, ordinal: item.marker ? String(item.marker) : '' }; }
  const g = item.marker ? bulletGlyph(item.marker) : null;
  if (g) return { brl: BULLET_BRAILLE[g], ordinal: '' };
  // IMP-W7 (Paul, 30 Sep 2026): a print bullet with no UEB sign of its own (an arrow, a dash, a star...) is, in BANA, a
  // transcriber-defined symbol (8.6.2a, UEB 3.26), listed on the Special Symbols page (8.6.2b). UKAAF, or no symbol left:
  // the ordinary bullet stands for it (B004 section 10, N.B.: "if the bullet symbol is obscure it can be substituted").
  if (item.marker) {
    const c = customBullet(item.marker, o);
    if (c) return { brl: c.brl, ordinal: '', custom: c };
  }
  return item.marker && /^[\p{S}\p{Pd}\u2212*\u00B7\u2219\u2023\u2043]$/u.test(String(item.marker).trim()) ? { brl: UEB_BULLET, ordinal: '' } : null;
}
// §8.7.1b: when only SOME items of a level carry a bullet, the beginning character of every item at that
// level begins at the same cell (Example 8-5a: three blank cells before "#a4"; Example 8-6), and runovers
// are two cells to the right of that beginning. Returns Map(level -> cells taken by the widest bullet + 1),
// only for such mixed levels. An ordinal-only item beside bullet-only items (a different marker scheme,
// not the §8.7.1 shape) is not padded.
function listBulletPads(block, o) {
  const pads = new Map();
  if (isCompactList(o) || block.kind === 'toc') return pads;
  const byLevel = new Map();
  for (const it of block.items ?? []) {
    if (!it) continue;
    const lvl = it.level || 0;
    const e = byLevel.get(lvl) || { w: 0, plain: 0, ordinalPlain: 0, bulletOnly: 0 };
    const b = itemBullet(it, block, o);
    if (b) { e.w = Math.max(e.w, b.brl.length + 1); if (!b.ordinal) e.bulletOnly++; }
    else { e.plain++; if (it.marker) e.ordinalPlain++; }
    byLevel.set(lvl, e);
  }
  for (const [lvl, e] of byLevel) {
    if (!e.w || !e.plain) continue;
    if (e.bulletOnly && e.ordinalPlain) continue;
    pads.set(lvl, e.w);
  }
  return pads;
}
const listMaxLevel = (block) => {
  let m = Number(block.maxLevel) || 0;
  for (const it of block.items ?? []) if (it && it.level > m) m = it.level;
  return m;
};
const listMarginKind = (kind) => ((kind === 'exercise' || kind === 'index' || kind === 'toc') ? kind : 'list');
// Contents entries (a `toc` list with page numbers):
//  BANA Formats §2.10.7a: the page number at the right margin on the entry's last line, after
//    guide dots (dot 5) "preceded and followed by a blank cell"; with no room for two guide
//    dots the number follows the item; if it does not fit, it goes on a runover line.
//  UKAAF B004 (H. Tables of contents): lead lines of hyphens, then a print page column and a
//    braille page column separated by 2 cells, headed "print page" / "braille page"; with no
//    print page numbers in the document, only the braille column. Braille page numbers come
//    from formatDocument's second pass (o.tocBrlPages, matched by entry text).
const tocKey = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
function tocColumns(block, o) {
  if (isBanaOpts(o)) return null;
  const tr = (t) => o.translate(t).trim();
  const withPrint = o._hasPrintPages !== false;
  const pages = (block.items || []).filter((it) => it && it.page).map((it) => tr(tocPageText(block, it)));
  const PW = withPrint ? Math.max(tr('print').length, tr('page').length, ...pages.map((x) => x.length)) : 0;
  // Wide enough for the largest braille page number (#ajjg: 1,000 pages and more overflowed the line).
  const brlPages = o.tocBrlPages && o.tocBrlPages.size ? [...o.tocBrlPages.values()].map((n) => brailleNumber(n).length) : [];
  const BW = Math.max(tr('braille').length, tr('page').length, 4, ...brlPages);
  const colW = (withPrint ? PW + 2 : 0) + BW;
  const w = o.width || 38;
  const colStart = w - colW;
  if (colStart < w / 2) return null;                      // page references too long for columns: they follow the entry
  const cell = (a, b) => (withPrint ? a.padEnd(PW) + '  ' : '') + b;
  return {
    PW, BW, colStart, withPrint,
    header: [' '.repeat(colStart) + cell(tr('print'), tr('braille')), ' '.repeat(colStart) + cell(tr('page'), tr('page'))].map((l) => l.replace(/\s+$/, '')),
    cols: (printPage, brlPage) => cell(printPage || '', brlPage || '').replace(/\s+$/, ''),
  };
}
function tocBraillePage(item, o) {
  const map = o.tocBrlPages;
  if (!map || !map.size) return '';
  // An entry the editor gives as formatted runs only has its words read from them (A89, random-action testing: the number was
  // missing until a save and reopen, whose reader gives the text too).
  const words = item.title ?? item.text ?? (Array.isArray(item.segments) ? item.segments.map((g) => (g && typeof g.text === 'string' ? g.text : '')).join('') : '');
  const key = tocKey(words);
  let n = map.get(key);
  if (n == null) {                                         // "Chapter 1: …" → the heading that starts "Chapter 1:"
    const label = key.split(':')[0];
    if (label && label !== key) {
      const hits = [...map.keys()].filter((k) => k.split(':')[0] === label);
      if (hits.length === 1) n = map.get(hits[0]);
    }
  }
  return n == null ? '' : brailleNumber(n);
}
// titleTc / pageTc are { s, src } (the formatter passes src of nulls); returns { s, src } lines.
function tocEntryLines(o, titleTc, pageTc, brlPage, cols, first, runover) {
  const w = o.width || 38;
  const nul = (str) => ({ s: str, src: Array.from(str, () => null) });
  const cat = (...parts) => ({ s: parts.map((p) => p.s).join(''), src: parts.flatMap((p) => p.src) });
  if (cols) {
    const wrapped = tcWrap(o, titleTc, Math.max(first + 4, cols.colStart - 4), first, runover);
    const last = wrapped[wrapped.length - 1] || nul('');
    const colsStr = cols.cols(pageTc.s, brlPage);
    const colsTc = cols.withPrint ? cat(pageTc, nul(' '.repeat(Math.max(0, cols.PW - pageTc.s.length) + 2) + brlPage)) : nul(brlPage);
    const lead = cols.colStart - last.s.length - 2;               // " ---- " up to the columns
    const tail = { s: colsStr, src: colsTc.src.slice(0, colsStr.length) };
    if (lead >= 2) wrapped[wrapped.length - 1] = cat(last, nul(' ' + '-'.repeat(lead) + ' '), tail);
    else wrapped.push(cat(nul(' '.repeat(runover) + '-'.repeat(Math.max(2, cols.colStart - runover - 1)) + ' '), tail));
    return wrapped.map((l) => tcRstrip(l));
  }
  const wrapped = tcWrap(o, titleTc, w, first, runover);
  const last = wrapped[wrapped.length - 1] || nul('');
  const room = w - last.s.length - pageTc.s.length;               // cells between entry and number
  if (room >= 4) {
    wrapped[wrapped.length - 1] = cat(last, nul(' ' + '"'.repeat(room - 2) + ' '), pageTc);
  } else if (room >= 1) {
    wrapped[wrapped.length - 1] = cat(last, nul(' '.repeat(room)), pageTc);
  } else {
    const dots = w - runover - pageTc.s.length - 2;
    if (dots >= 2) wrapped.push(cat(nul(' '.repeat(runover)), nul('"'.repeat(dots) + ' '), nul(' '.repeat(w - runover - dots - 1 - pageTc.s.length)), pageTc));
    else wrapped.push(...tcWrap(o, pageTc, w, runover, runover));
  }
  return wrapped.map((l) => tcRstrip(l));
}

// A list item's page references that are not set in contents columns (an index, or contents
// whose references are too long for columns) directly follow the entry: BANA Formats §21.4
// (Example 21-12 "Sea, 237"); B004 App I ("page numbers directly follow the index entry").
// They were dropped from the braille before (A2).
// Returns the braille to append ("1 #bdg": ", 237"), or '' when the item has no page.
function pageSuffix(item, o) {
  const page = String(item.page ?? '').trim();
  if (!page) return '';
  const plain = (item.segments ? item.segments.map((g) => g.text || '').join('') : String(item.text ?? '')).replace(/\s+$/, '');
  // Already punctuated: a trailing , : ; . -- also when only a closing quote/bracket follows it
  // (BANA Example 21-1 "Action archaeology," 302: the comma is inside the quote).
  const comma = /[,:;.][\u201d\u2019"')\]]*$/.test(plain) ? '' : o.translate(',').trim();
  return comma + ' ' + o.translate(page).trim();
}
// F-151 / BANA 2.10.7a ("Page numbers for contents entries are placed, without the continuation letter, at the
// right margin"): optional `stripContinuation` on a contents list drops a trailing continuation letter (a, b ... z,
// or a doubled aa, bb ...) after a digit from each entry's page number ("12a" -> "12"). Default: the page is set verbatim.
const tocPageText = (block, item) => {
  const p = String(item.page ?? '').trim();
  return block && block.stripContinuation ? p.replace(/(\d)([a-zA-Z])\2?$/, '$1') : p;
};
const tocInColumns = (kind, item, cols, o) => kind === 'toc' && item.page && (cols || isBanaOpts(o));

// F-34 / BANA Formats §8.4.1: a simple list printed in side-by-side columns may keep that arrangement
// when it fits (Sample 8-5). Optional `block.columns` (the print column count; nothing in the parser sets
// it yet). The first column begins in cell 1, the next column two blank cells after the longest item of
// the column before it (§8.4.1b), no guide dots; words fill down each column in reading order (§8.4.1d,
// Sample 8-5: the left column takes the extra item). Anything else stays one vertical column, which
// §8.4.1 allows: nested items (§8.5.1d), bulleted or numbered items (§8.7.1c), one line too wide.
// Returns { rows: [[item index, ...], ...], starts: [cell, ...] } or null.
function columnedListPlan(block, o) {
  const cols = Math.floor(Number(block.columns));
  const items = block.items ?? [];
  if (!(cols > 1) || o.mode !== 'bana' || isCompactList(o) || block.displayed || block.translationPairs || items.length < 2) return null;   // K27 / BANA 9.2.6a: never columnar
  if (block.kind && block.kind !== 'list') return null;
  if (block.kind === 'glossary' || block.style === 'glossary') return null;
  const strs = [];
  for (const it of items) {
    if (!it || it.level || it.marker || it.bullet || it.page) return null;
    const b = (it.segments ? segmentsToBraille(it.segments, g1Quiet(o)) : o.translate(it.text ?? '')).replace(/\s+/g, ' ').trim();
    if (!b) return null;
    strs.push(b);
  }
  const rowsN = Math.ceil(items.length / cols), nCols = Math.ceil(items.length / rowsN);
  if (nCols < 2) return null;
  const starts = [0];
  let total = 0;
  for (let c = 0; c < nCols; c++) {
    const idx = []; for (let r = 0; r < rowsN && c * rowsN + r < items.length; r++) idx.push(c * rowsN + r);
    const wid = Math.max(...idx.map((i) => strs[i].length));
    total = starts[c] + wid;
    starts.push(total + 2);
  }
  starts.pop();
  if (total > (o.width || 38)) return null;
  const rows = [];
  for (let r = 0; r < rowsN; r++) { const row = []; for (let c = 0; c < nCols; c++) { const i = c * rowsN + r; if (i < items.length) row.push(i); } rows.push(row); }
  return { rows, starts, strs };
}
// BANA 10.8 exercise examples (optional item fields, BANA mode only; nothing changes without them):
//  `example: true`  - the item belongs to an exercise example / model / sample question with its
//                     answer: 10.8.3 a blank line before and after the example.
//  `label` / `labelSegments` - the label ("Example:") stands on a line of its own in cell 1
//                     (10.8.5, 10.8.6: the numbered item / each sentence then starts in cell 1);
//                     emphasis on a label followed by punctuation is not kept (10.8.2).
// Whether print's label and item arrive already split is an import decision; the formatter only
// honours the fields. `exampleBlankBefore` says whether an example item needs the blank line.
const exampleLabelParts = (item) => {
  const segs = Array.isArray(item.labelSegments) ? item.labelSegments : null;
  const plain = segs ? segs.map((g) => (g && g.text) || '').join('') : String(item.label ?? '');
  const punct = /[\p{P}]\s*$/u.test(plain);
  return { segs: segs && punct ? segs.map((g) => (g && g.tf ? { ...g, tf: undefined } : g)) : segs, plain };
};
const hasExampleLabel = (item) => !!item && (item.label != null || item.labelSegments != null) && !!(item.labelSegments ? item.labelSegments.length : String(item.label ?? '').trim());
// K31 / BANA 10.8.5, 10.8.6: recognising the label itself. Two ways, in order of preference:
//  1. An explicit model field - `item.label`/`item.labelSegments`/`item.example` already set (by a reader or the
//     editor, per the field-registry note "set by import only"). Always honoured as-is, never overridden below.
//  2. Failing that, a conservative text pattern over the item's own plain text/segments, run here so it applies
//     uniformly to every exercise list regardless of where the items came from: the item's leading word(s) are
//     "Example", "Model" or "Sample" (§10.8.1 "etc." covers reasonable variants such as "Sample Answer"; "Answer"
//     itself is recognised only as the continuation of an example already open, never as a label that starts one -
//     BANA gives Example/Model/Sample as the labels, with "Answer" following as part of the same example), optionally
//     with a trailing colon, AND the label is followed either by a numbered/lettered item on the same line (10.8.5)
//     or by a further, unlabelled, unnumbered item at the same level that continues the example (10.8.6). A label
//     with nothing after it to split (one sentence, nothing following) is left exactly as the reader gave it - both
//     rules require something AFTER the label before it moves to its own line.
// Deterministic in block.items/block.kind/o.mode alone, all already in getBlockSignature's cache key, so no change
// there is needed; formatList and traceBlock both call this in place of `block.items` (A39 parity, single copy here).
const EX_LABEL_START = /^(?:example|model|sample)\b/i;
const EX_LABEL = /^((?:example|model|sample)s?\s*:?)\s+(\S[\s\S]*)$/i;
const EX_IDENT = /^\(?(?:\d+|[a-z])[.)]\s/i;                                  // a numbered/lettered item, e.g. "1." "a)"
const exIsLabelled = (t) => /^\s*(example|model|sample|answer)\b/i.test(String(t ?? ''));
function itemLeadText(item) {
  if (!item) return '';
  if (Array.isArray(item.segments)) return item.segments.map((g) => (g && typeof g.text === 'string' ? g.text : '')).join('');
  return String(item.text ?? '');
}
// Slice a segment array to the plain-text range [from, to); each covered segment keeps its other fields (tf etc.)
// and is split only at the two cut points, same technique as parse.mjs's splitPhoneticSegments.
function sliceItemSegments(segs, from, to) {
  const out = [];
  let pos = 0;
  for (const seg of segs) {
    const text = (seg && typeof seg.text === 'string') ? seg.text : '';
    const segStart = pos, segEnd = pos + text.length;
    pos = segEnd;
    if (segEnd <= from || segStart >= to || !text) continue;
    const a = Math.max(from, segStart) - segStart, b = Math.min(to, segEnd) - segStart;
    out.push(a === 0 && b === text.length ? seg : { ...seg, text: text.slice(a, b) });
  }
  return out;
}
function deriveExerciseLabels(block, o) {
  const items = block && Array.isArray(block.items) ? block.items : [];
  if (!items.length || block.kind !== 'exercise' || o.mode !== 'bana') return items;
  let changed = false;
  const built = items.slice();
  let inExample = false, sentences = false;
  items.forEach((it, i) => {
    if (!it) return;
    const already = hasExampleLabel(it) || !!it.example;                     // explicit field wins - never overridden
    const t = itemLeadText(it);
    if (!already && EX_LABEL_START.test(t.trim())) {
      // BANA 10.8.1-10.8.4: an item beginning with the label word IS a recognised exercise
      // example (10.8.3's blank line before/after; 10.8.4's "format like the following
      // questions/answers") whether or not there is anything to SPLIT - Sample 10-7 (10.8.4)
      // is exactly this: "Example" stays inline with its one sentence (nothing to split, no
      // continuation, no numbered item on the same line) and still gets the blank line before
      // it and after the "Answer" item that follows. 10.8.5/10.8.6 (the split itself, below)
      // are additional, conditional on a numbered item on the same line or further sentences.
      inExample = true; sentences = false;
      const m = EX_LABEL.exec(t);
      const next = items[i + 1];
      const nextT = itemLeadText(next).trim();
      const more = !!next && (Number(next.level) || 0) === (Number(it.level) || 0) && !!nextT && !exIsLabelled(nextT) && !EX_IDENT.test(nextT);   // 10.8.6
      if (m && (more || EX_IDENT.test(m[2]))) {                              // 10.8.5 (same-line numbered item) or 10.8.6 (more sentences)
        const labelLen = m[1].length, bodyStart = m[0].length - m[2].length;
        let patched;
        if (Array.isArray(it.segments)) {
          const labelSegments = sliceItemSegments(it.segments, 0, labelLen);
          patched = { ...it, segments: sliceItemSegments(it.segments, bodyStart, t.length), labelSegments, label: labelSegments.map((g) => g.text || '').join('') };
        } else {
          patched = { ...it, text: t.slice(bodyStart), label: t.slice(0, labelLen) };
        }
        built[i] = patched; changed = true;
        sentences = more;
      }
    } else if (inExample && sentences && t.trim() && !exIsLabelled(t) && !EX_IDENT.test(t.trim())) {
      // a further sentence of the labelled example (10.8.6) - text unchanged, just flagged as part of the example below
    } else if (inExample && !/^\s*answer\b/i.test(t)) {
      inExample = false; sentences = false;
    }
    if (inExample && !built[i].example) { built[i] = { ...built[i], example: true }; changed = true; }
  });
  return changed ? built : items;
}
// joinsWithoutBlank (BANA 10.2.3 / 10.8.3) needs to know, ahead of formatList/traceBlock, whether an exercise list's
// FIRST item is (or derives to be) an example - deriveExerciseLabels is the one place that decides that, so this
// just asks it and reads the answer off item 0, rather than re-implementing the recognition rule a second time.
const startsExerciseExample = (block, o) => {
  if (!block || block.type !== 'list' || block.kind !== 'exercise') return false;
  const items = deriveExerciseLabels(block, o);
  return !!(items[0] && items[0].example);
};
// BANA 21.9.2e (F-212): entries with an article, reflexive pronoun, English infinitive or other element before the
// entry word (optional block.sharedMargin; optional item.lead = that element, e.g. "el", "las", "to", which is
// already part of item.text). The longest such element begins in cell 1, the initial letters of all main entry
// words align at the cell after it, subentries begin two cells right of that margin and all runovers two cells
// right of the deepest subentry level. Returns the margin (0-based cell) or null. The margin is computed for the
// whole block, which is what the June 2024 changes ask: 21.9.2d(2) "Align the initial letters of the entry words in the
// same braille cell throughout the reference section" (the 2016 text adjusted it for each braille page).
function sharedMarginOf(block, o) {
  if (!block.sharedMargin) return null;
  let margin = 0;
  for (const it of block.items || []) {
    if (!it || (it.level || 0) !== 0 || it.lead == null || !String(it.lead).trim()) continue;
    margin = Math.max(margin, o.translate(String(it.lead)).trim().length + 1);
  }
  return margin || null;
}
const sharedMarginCells = (item, lvl, margin, maxLevel, o) => ({
  first: lvl === 0 ? margin - (item.lead != null && String(item.lead).trim() ? o.translate(String(item.lead)).trim().length + 1 : 0) : margin + 2 * lvl,
  runover: margin + 2 + 2 * maxLevel,
});
// ---- List items with more than one paragraph, or with a table (or other block) inside them ----
// Model: a list item may carry `blocks: [...]`, the item's further content AFTER its first paragraph (item.text /
// item.segments), in print order: more paragraphs ({type:'para', text | segments}), a table, a code block, a picture
// ... Sub-items stay flat, level-tagged items that follow the item (and its blocks). An item with no `blocks` is
// exactly as before, so every existing document formats as it did.
//  Paragraphs: BANA Formats §10.3.3 "Begin additional paragraphs two cells to the right of the runover position"
//    (Example 10-3), the rule §16.3d gives for notes ("Use 1-3 margins; for additional paragraphs in a note, use 5-3
//    margins") and §11.18f for a column entry: an item at 1-3 continues at 5-3, a nested item's paragraph at
//    (runover+2)-(runover). UKAAF B004 has no rule of its own for this; its list principle (§10 "easily
//    distinguishable ... clear to the braille reader when they have ended", App C "entry starts of different levels
//    will not be confused with runovers") is met by the same shape: 1/3 -> 5/3, a nested 1/5 item -> 7/5. The B004
//    §10 Ex2 compact style (5/1) is paragraph-like already: a further paragraph keeps the item's margins.
//  Tables and every other block: formatted as outside a list (BANA §11.2.5a "Begin the first column of a table in
//    cell 1", §11.2.5d a blank line before and after), then the list goes on with its next item.
// formatList and traceBlock both go through these helpers, so the two paths give the same lines (A39).
const isItemParaBlock = (b) => !!b && typeof b === 'object' && (b.type === 'para' || b.type == null) && !b.style && (b.text != null || Array.isArray(b.segments));
const itemBlocksOf = (item) => (item && Array.isArray(item.blocks) ? item.blocks.filter((b) => b && typeof b === 'object') : []);
const itemParaMargins = (first, runover, compact) => (compact ? { first, runover } : { first: runover + 2, runover });
// Splice a non-paragraph block's own lines (strings, or traced {s, src}) into a list's lines: one blank line before
// and after, never two, and its keep-together groups carried over at their new positions.
function appendItemBlockLines(out, keep, lines, blank) {
  if (!Array.isArray(lines) || !lines.length) return;
  const isBlank = (l) => (typeof l === 'string' ? l : l.s) === '';
  let a = 0; while (a < lines.length && isBlank(lines[a])) a++;
  let z = lines.length; while (z > a && isBlank(lines[z - 1])) z--;
  if (a >= z) return;
  if (out.length && !isBlank(out[out.length - 1])) out.push(blank);
  const base = out.length - a;
  out.push(...lines.slice(a, z), blank);
  for (const g of Array.isArray(lines.keepGroups) ? lines.keepGroups : []) {
    const s = Math.max(g[0], a), e = Math.min(g[1], z - 1);
    if (s <= e) keep.push([s + base, e + base, ...g.slice(2)]);
  }
}
// A39 stage 2 ("one layout path"): formatItemBlocks (the formatList-side mirror of this) is
// deleted — traceItemBlocks, called from traceBlockCore's 'list' case, is now the only
// implementation (formatBlock's 'list' case is a projection of traceBlockCore). Each
// further paragraph is its own source unit (unitOf(k) for the k-th paragraph of the item:
// the editor shows it as its own list line). A table (or other block) inside an item is
// traced without a source: its cells are not units of the list.
function traceItemBlocks(item, o, w, first, runover, compact, out, keep, unitOf, maxLevel) {
  let k = 0;
  for (const b of itemBlocksOf(item)) {
    if (isItemParaBlock(b)) {
      const u = unitOf(k++);
      const tr = Array.isArray(b.segments) ? tcSegs(g1Quiet(o), b.segments, u, true) : tcRun(o, String(b.text ?? ''), null, u, 0);
      if (!tr.s.trim()) continue;
      const m = itemParaMargins(first, runover, compact);
      out.push(...tcWrapBody(o, tr, w, m.first, m.runover));
    } else {
      const traced = traceBlock(withListNestLevel(b, maxLevel, o), o, false);   // mirror formatItemBlocks (Q-28 / K6, A39)
      const plain = traced.map((l) => tcDeco(l.s));
      if (Array.isArray(traced.keepGroups)) Object.defineProperty(plain, 'keepGroups', { value: traced.keepGroups });
      appendItemBlockLines(out, keep, plain, tcBlank);
    }
  }
}
// A39 stage 2 ("one layout path"): formatList is gone -- traceBlockCore's own 'list' case (see its A39 comments) is the only implementation left; formatBlock's 'list' case is a projection of it.

// Displayed / quoted material: a `para` whose style is quote-like (the parser emits
// {type:'para', style:'quote'} for <blockquote> / class="quote" / "extract"). Returns the
// margins and blank-line rule, or null for body text (including an epigraph — see isEpigraph
// below; F-94, §9.3.1c: "Do not treat epigraphs as displayed material", so `epigraph` is
// deliberately NOT a member of this set). Shared by formatPara / formatSegmentedPara and
// traceBlock.
//  BANA (Formats §9.2.2): the adjusted left margin is 2 cells to the right of the
//    runover position of the surrounding text — cell 3 for body text — and
//    paragraphs are blocked at it (§9.2.2d), i.e. 3-3. A blank line precedes and
//    follows displayed material (§9.2.2a) but none separates the paragraphs of one
//    displayed passage (§9.2.2b): joinsWithoutBlank (above) drops the blank entirely
//    between two quote paragraphs at the same adjusted margin (F-93) — every quote
//    paragraph still carries both blanks on its own, for the passage's own outer boundary.
//    Nested displayed matter (block.level, e.g. a quote inside a list) moves a further
//    2 cells per level (§9.2.2 example).
//  UKAAF (B004 App. B "Good practice example of paragraph layout" / App. G Ex. 2):
//    a set-out quoted passage is indented 4 cells — "new paragraphs start in cell 7
//    with runover lines in cell 5" (7-5) — and "otherwise, no blank lines are used"
//    (a blank line only between two separate extracts, which the model cannot tell
//    from two paragraphs of one extract, so none is emitted).
const QUOTE_STYLES = new Set(['quote', 'blockquote', 'extract', 'displayed']);
// K6 / BANA §9.2.2d: "Blocked paragraphs are blocked at the adjusted left margin; indented
// paragraphs begin 2 cells to the right of the adjusted left margin." KD: "Both! Fully
// dependent upon what print has" — a displayed paragraph is blocked (default) or indented
// per-paragraph, following whatever indent print gives THAT paragraph (optional
// `block.displayIndent`, set by the reader from print's own first-line indent — see
// field-registry.mjs). Only the FIRST line moves; the runover stays at the adjusted margin
// either way, exactly as an ordinary indented paragraph's own runover sits left of its first
// line (R1, 3-1).
function quoteMargins(block, o) {
  if (!block || !QUOTE_STYLES.has(String(block.style ?? '').toLowerCase())) return null;
  const nest = Math.max(0, Number(block.level) || 0) * 2;
  if (o.mode === 'bana') {
    const adj = 2 + nest;                                 // adjusted left margin (0-based; cell 3 when nest is 0)
    return { first: block.displayIndent ? adj + 2 : adj, runover: adj, blank: true };
  }
  return { first: 6 + nest, runover: 4 + nest, blank: false };
}
// K6 / BANA §9.2.2 (Q-28, confirmed by a BANA transcriber 25 Sep 2026 — round 1 item 19): "displayed
// material within a nested list that has margins 1-7, 3-7, 5-7 would begin in cell 9" — i.e. the
// adjusted margin is 2 cells right of the LIST's own runover (nestedMargins' `deepest`, the level
// every item of that list shares, not the individual item's own `level`), not a number the
// transcriber happens to have set on the displayed block itself (which item.blocks never sets, and
// a hand-authored `level` may not match the list it actually sits in). quoteMargins already adds 2
// cells per unit of `block.level` (§9.2.2d's own step), so the list's `maxLevel` (0-based, the
// deepest item anywhere in the list — listMaxLevel(block)) becomes level = maxLevel + 1: a flat,
// one-level list (maxLevel 0) nests a displayed passage one step in (level 1); the worked 3-level
// example (maxLevel 2) gives level 3, landing on cell 9 exactly as the rule's own example does. Only
// a quote/displayed-style block is affected (a heading or nested list already has its own §9.2.2c/
// §9.1.2 handling via `block.displayed`); an explicitly higher hand-set level is kept, never
// lowered, since a transcriber may deliberately nest a passage deeper than the list itself.
// BANA-only (o.mode==='bana'): no equivalent UKAAF rule is in scope here (KD's confirmation is
// specifically against BANA 9.2.2).
const withListNestLevel = (b, maxLevel, o) => {
  if (o.mode !== 'bana' || !b || !QUOTE_STYLES.has(String(b.style ?? '').toLowerCase())) return b;
  const want = Math.max(0, Number(maxLevel) || 0) + 1;
  return (Math.max(0, Number(b.level) || 0) >= want) ? b : { ...b, level: want };
};
const withQuoteBlanks = (lines, q) => (q.blank ? ['', ...lines, ''] : lines);
// F-94 / BANA §9.3.1: an epigraph is explicitly NOT displayed material (9.3.1c) — it keeps
// its own print format instead of the adjusted/blocked quote margin (9.3.1b: "a poem in
// poetry format, 3-1 margins for indented paragraphs, etc." — a poem epigraph is parsed as
// an ordinary nested <poem>, see parse.mjs, so only the plain "indented paragraph" case
// reaches formatPara/formatSegmentedPara here; block.blocked (§1.9.3) is honoured exactly
// like any other paragraph for the "etc." case where print itself is blocked). 9.3.1d's own
// blank line before and after is independent of the margin choice, so it is added here
// directly rather than by (re-)joining QUOTE_STYLES. BANA-only: no UKAAF B004 rule names an
// epigraph or a forced blank line around one.
const isEpigraph = (block) => !!block && typeof block === 'object' && String(block.style ?? '').toLowerCase() === 'epigraph';
// A39 stage 2: the plain-string withEpigraphBlanks (formatPara/formatSegmentedPara's own
// mirror of this) is gone -- traceBlockCore's 'para' case (the only implementation of
// 'para' left) uses this { s, src } line-shape version directly (tcBlank stands in for a
// plain '').
function withEpigraphBlanksTc(lines, block, o) {
  if (!isEpigraph(block) || o.mode !== 'bana' || !lines.length) return lines;
  const out = block.continuation ? [...lines] : [tcBlank, ...lines];
  if (!block.continued) out.push(tcBlank);
  return out;
}
// Same, for a quote paragraph split around a print page turn: no blank at the split,
// and the piece after the turn starts at the runover cell.
const quoteLines = (lines, q, block) => {
  if (!q.blank) return lines;
  const out = block?.continuation ? [...lines] : ['', ...lines];
  if (!block?.continued) out.push('');
  return out;
};

// Paragraph (R1): 3-1, no blank line between paragraphs (default 'indented').
// Or 1-1 with blank line between paragraphs ('block'). A quote-styled paragraph
// takes the displayed-material margins from quoteMargins instead.
// A paragraph interrupted by a print page turn is split around the page change indicator:
// `continued` marks the piece before it, `continuation` the piece after, which resumes in
// cell 1 (BANA §1.11.3 Example 1-9; B004 §8 "resumed in cell 1 … unless a new paragraph").
//
// F-39 / BANA §1.9.3: "Use 1-1 margins for blocked paragraphs. A blank line precedes each
// blocked paragraph, unless it follows a cell-5 or cell-7 heading." — a PER-PARAGRAPH
// `block.blocked` flag (set from print, e.g. `<p class="blocked">` — see parse.mjs /
// nimas-export.mjs), independent of the document-wide `o.paragraphStyle === 'block'` toggle
// above (which already gets the 1-1 margins right but adds its blank line AFTER, not
// before, every paragraph — wrong for this rule, confirmed directly against the §4 gold
// corpus). A blocked paragraph's own leading blank line is added here unconditionally;
// `joinsWithoutBlank` (below) drops it again, along with the preceding block's trailing
// blank, exactly when this paragraph follows a cell-5/cell-7 heading (the rule's own
// exception) — the same drop-and-collapse machinery already used for headings.
// BANA Formats §10.3.2: "Use 5-5 margins for unnumbered or unlettered directions." (F-174 / F-235).
// An exercise/activity-directions paragraph (`block.directions`, set by the reader or the
// editor style, never guessed here) takes cell 5 for both its first and its runover lines in BANA
// mode; UKAAF keeps the ordinary paragraph margins, B004 has no such rule.
// §10.3.2 (second sentence): "Use 7-5 margins for additional paragraphs" within the directions -
// an optional `directionsContinued` flag on the 2nd and later directions paragraph of one set.
// §10.3.3: numbered or lettered directions ("A. Use each ...", optional `directionsLabelled`) are the top level
// of a nested list: 1-5, and their additional paragraphs 7-5 (as above).
// F-107 (example 3-2): optional `block.hangingMargins` (default off: ordinary paragraph margins) sets a paragraph in 1-3 margins
// (first line cell 1, runovers cell 3), as the gold shows for a key sentence with an embedded note. Not a rule of the text.
const hangingMargins = (block) => (block && block.hangingMargins ? { first: 0, runover: 2 } : null);
const directionsMargins = (block, o) => (block && block.directions && o.mode === 'bana' ? { first: block.directionsContinued ? 6 : (block.directionsLabelled ? 0 : 4), runover: 4 }
  : (block && block.songInfo && o.mode === 'bana' ? { first: 6, runover: 4 } : null));   // 13.11.2b: `songInfo` (default off) - each item under a song title takes 7-5 margins
// F-219/F-206 / BANA 19.4.1c (Morse: three blank cells between words), optional `block.wordGaps`
// (default: a run of spaces collapses to one, as always): every interior run of two or more spaces
// becomes a non-collapsible gap of two or three blank cells (a longer run is kept at three).
const wordGapsOf = (block) => {
  if (!block || !block.wordGaps) return block;
  const isText = (g) => g && (g.type === undefined || g.type === 'text') && typeof g.text === 'string';
  const cut = (seg) => {
    const t = String(seg.text ?? '');
    const parts = t.split(/(?<=\S)([^\S\n]{2,})(?=\S)/);
    if (parts.length < 2) return [seg];
    const out = [];
    parts.forEach((p, i) => { if (i % 2) out.push({ type: 'gap', cells: p.length >= 3 ? 3 : 2 }); else if (p) out.push({ ...seg, text: p }); });
    return out;
  };
  const src = block.segments ? block.segments : [{ type: 'text', text: String(block.text ?? '') }];
  // A run of blanks that straddles segment boundaries (`abc  ` + italic `def`) is one run: split each text
  // segment into leading blanks / core / trailing blanks, join the blank pieces, and turn a run of 2+ that
  // sits between two content pieces into a gap; every other blank piece goes back exactly as it was.
  const pieces = [];
  for (const g of src) {
    if (!isText(g)) { pieces.push({ g }); continue; }
    const m = /^([^\S\n]*)([\s\S]*?)([^\S\n]*)$/.exec(g.text);
    if (m[1]) pieces.push({ ws: m[1], g });
    if (m[2]) pieces.push({ g: { ...g, text: m[2] } });
    if (m[3] && m[2]) pieces.push({ ws: m[3], g });
  }
  const out = [];
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].ws === undefined) { out.push(...(isText(pieces[i].g) ? cut(pieces[i].g) : [pieces[i].g])); continue; }
    let j = i, n = 0;
    while (j < pieces.length && pieces[j].ws !== undefined) n += pieces[j++].ws.length;
    if (n >= 2 && i > 0 && j < pieces.length) out.push({ type: 'gap', cells: n >= 3 ? 3 : 2 });
    else for (let k = i; k < j; k++) out.push({ ...pieces[k].g, text: pieces[k].ws });
    i = j - 1;
  }
  return { ...block, segments: out, wordGaps: false };
};
// F-99 / BANA 9.2.3b ("Omit font attributes when the entire section of displayed material is emphasized") and
// F-215 / BANA 14.3.1d ("Omit font attributes unless needed for distinction", a scene-setting paragraph). Two
// optional fields, both default off (so a block without them is formatted exactly as before):
//   `omitFullEmphasis` - every text run of the block (its `segments`, or those of its `items`) carries the same
//                        emphasis: drop it throughout. Emphasis on only part of the passage is kept (9.2.3a).
//   `omitEmphasis`     - the transcriber has judged the emphasis is not needed for distinction: drop all of it.
// Applied at the top of formatBlock and traceBlock (parity, A39); both fields are in getBlockSignature's key.
// F-145 / F-83 / F-159 (batch B): "ignore font attributes" where the rule says so, driven by an optional marker the producer supplies
// (nothing here decides WHERE the rule applies; that is the print side's judgement — the transcriber's own choice,
// e.g. block.ignoreFont for a 2.9.1f dedication/acknowledgement, stays whatever else changes). All default off:
//   `block.ignoreFont`      - drop every font attribute of the block;
//   `segment.ignoreFont`    - drop the font attribute of that run only. BANA's June 2024 foreign-language changes merged
//                             the old 5.3.2 (a letter standing for itself) and 5.3.3 (a word part: prefix, suffix,
//                             identified root word) into one new 5.3.2, limited to ENGLISH letters and word parts (K19,
//                             `Emboss/docs/bana-2024-changes-review.md` finding A6). TF-1 (Paul, 28 Sep 2026, from KD's
//                             round-2 answer): the old 5.3.3-5.3.11 are withdrawn — not renumbered, not reprinted —
//                             so `segment.ignoreFont` is now only ever the transcriber's own explicit judgement call
//                             (5.3.2, or any other reason the transcriber records), never something Emboss infers for
//                             an old-5.3.x reason on its own;
//   `item.ignoreFont`       - the same for one list item;
//   `block.diacriticNotation` - 20.4.2: runs that carry a diacritic / stress mark (combining marks, primary/secondary stress, prime) lose their font attribute.
const DIACRITIC_RE = /[\u0300-\u036f\u02c8\u02cc\u2032]/;
const fontIgnoredOf = (block) => {
  if (!block || typeof block !== 'object') return block;
  const whole = !!block.ignoreFont, dia = !!block.diacriticNotation;
  const hasSegMark = (segs) => Array.isArray(segs) && segs.some((s) => s && s.ignoreFont);
  const any = whole || dia || hasSegMark(block.segments) || (Array.isArray(block.items) && block.items.some((it) => it && (it.ignoreFont || hasSegMark(it.segments) || hasSegMark(it.termSegments) || hasSegMark(it.defSegments) || itemBlocksOf(it).some((b) => isItemParaBlock(b) && hasSegMark(b.segments)))));
  if (!any) return block;
  let changed = false;
  const fix = (segs, all) => (Array.isArray(segs) ? segs.map((s) => {
    if (!s || s.type === 'math' || (!s.tf && !s.transcriberTypeform)) return s;
    if (all || s.ignoreFont || (dia && DIACRITIC_RE.test(String(s.text ?? '').normalize('NFD')))) { changed = true; return { ...s, tf: undefined, transcriberTypeform: undefined }; }
    return s;
  }) : segs);
  const out = { ...block };
  if (Array.isArray(block.segments)) out.segments = fix(block.segments, whole);
  if (Array.isArray(block.items)) out.items = block.items.map((it) => {
    if (!it || typeof it !== 'object') return it;
    const all = whole || !!it.ignoreFont;
    const n = { ...it };
    for (const k of ['segments', 'termSegments', 'defSegments']) if (Array.isArray(it[k])) n[k] = fix(it[k], all);
    if (Array.isArray(it.blocks)) n.blocks = it.blocks.map((b) => (isItemParaBlock(b) && Array.isArray(b.segments) ? { ...b, segments: fix(b.segments, all) } : b));   // the item's further paragraphs
    return n;
  });
  return changed ? out : block;
};
const emphasisOmittedOf = (block) => {
  block = fontIgnoredOf(block);
  if (!block || (!block.omitEmphasis && !block.omitFullEmphasis)) return block;
  const strip = (segs) => (Array.isArray(segs) ? stripEmphasis(segs) : segs);
  const lists = [];
  if (Array.isArray(block.segments)) lists.push(block.segments);
  if (Array.isArray(block.items)) for (const it of block.items) if (it && Array.isArray(it.segments)) lists.push(it.segments);
  // An item's further paragraphs (item.blocks) are part of the list's text (8.1.4a: the entire list).
  if (Array.isArray(block.items)) for (const it of block.items) for (const b of itemBlocksOf(it)) if (isItemParaBlock(b) && Array.isArray(b.segments)) lists.push(b.segments);
  if (!lists.length) return block;
  if (!block.omitEmphasis) {
    const tfs = new Set();
    for (const segs of lists) for (const s of segs) {
      if (!s || s.type === 'math' || s.type === 'gap' || s.type === 'noteref' || s.type === 'linenum') continue;
      if (typeof s.text !== 'string' || !s.text.trim()) continue;
      tfs.add(segTf(s));
    }
    if (tfs.size !== 1 || tfs.has(0)) return block;   // mixed, or nothing emphasised: 9.2.3a keeps it as print shows
  }
  const out = { ...block };
  if (Array.isArray(block.segments)) out.segments = strip(block.segments);
  if (Array.isArray(block.items)) out.items = block.items.map((it) => {
    if (!it || typeof it !== 'object') return it;
    const n = Array.isArray(it.segments) ? { ...it, segments: strip(it.segments) } : it;
    if (!Array.isArray(it.blocks)) return n;
    return { ...n, blocks: it.blocks.map((b) => (isItemParaBlock(b) && Array.isArray(b.segments) ? { ...b, segments: strip(b.segments) } : b)) };
  });
  return out;
};
// ===================== K1 / K4: decorative emphasis and multi-paragraph passages =====================
// K1 (transcriber KD, round 1, Q-25) / BANA 5.3.1 as restated in the June 2024 changes: "Print font attributes may
// be ignored when they are used for decorative purposes ... In general, font attributes in tables of contents,
// headings (centered, cell-5, cell-7), dedications, titles, lists, etc., do not reinforce learning ... When these
// items are partially emphasized, however, font attributes must be retained." Also 8.1.4a ("Omit emphasis when the
// entire list uses the same print font attribute"), 2.10.8b-c, 2.9.1f, 4.3.7 (Example 4-7). (Old 5.3.5, "ignore font
// attributes for titles of books, poems, plays ... that appear as a complete heading", withdrawn by TF-1 — Paul, 28
// Sep 2026 — is not cited as a separate reason any more: a heading wholly made of an italic title is still dropped,
// but only because 5.3.1's own "titles" already covers a heading that is entirely, uniformly emphasised.) KD: "If every bit
// of content within a list (or table or dedication or etc.) has an emphasis (e.g., bold), then it is 99% of the time
// safe to ignore that bold entirely" — otherwise follow print, whether a whole item or one word of it is emphasised.
// The test is made PER TYPEFORM (italic, underline, bold, script, each transcriber-defined typeform): a list that is
// all bold with one italic word loses the bold and keeps the italic. Only runs with a letter or digit count (a plain
// comma or space after bold text does not make the text "partly" bold, UEB 9.7.2); maths, note references, embedded
// notes and literal braille are neutral. Scope of "the whole structure":
//   heading    - one heading block (BANA only: formatHeading; UKAAF keeps B004 §5, all heading emphasis dropped);
//   list       - one list block, nested items and each item's further paragraphs, terms and definitions included;
//   table      - one table block: every heading and entry cell;
//   contents   - a list of kind 'toc', together with the contents lists next to it (only print page numbers between);
//   dedication - blocks marked `dedication` (optional model field), consecutive ones together.
// The group-wide mask of a multi-block contents or dedication is worked out by emphasisContext (buildDocPages) and
// passed as `block.structTf`; a block formatted on its own works it out from itself. Transcriber overrides
// (ignoreFont, omitEmphasis, omitFullEmphasis) are applied first and still win; `keepEmphasis` on a list, table or
// dedication keeps print emphasis that is not decorative (8.1.4b: a list of titles in italics, Example 8-6).
const isCountedEmphSeg = (s) => !!s && (s.type == null || s.type === 'text') && typeof s.text === 'string' && /[\p{L}\p{N}]/u.test(s.text);
// The typeform bits (segTf) shared by every counted run of every unit (an array of segment arrays); 0 when none.
function sharedTfMask(units) {
  let mask = -1, any = false;
  for (const segs of units) {
    if (!Array.isArray(segs)) continue;
    for (const s of segs) {
      if (!isCountedEmphSeg(s)) continue;
      any = true;
      mask &= segTf(s);
      if (!mask) return 0;
    }
  }
  return any ? mask : 0;
}
// Remove the typeform bits in `mask` from each run (print tf bits and a transcriber-defined typeform).
function dropTfBits(segs, mask) {
  if (!mask || !Array.isArray(segs)) return segs;
  let changed = false;
  const out = segs.map((s) => {
    if (!s || s.type === 'math' || !(segTf(s) & mask)) return s;
    changed = true;
    const n = { ...s, tf: ((s.tf || 0) & ~mask) || undefined };
    if (transTfBit(s) & mask) n.transcriberTypeform = undefined;
    return n;
  });
  return changed ? out : segs;
}
// BANA 4.3.7 / 5.3.1 (old 5.3.5 withdrawn, TF-1 — subsumed by 5.3.1's own "titles"): a heading drops the typeforms that cover all of it and keeps the rest (Example 4-7:
// ",h5rik ,ibs51 .7,a ,doll's ,h\se.'"). UKAAF B004 §5 ("it is NOT good practice to slavishly represent all of these
// in a braille heading ... The layout will generally be sufficient indication") has no partial-emphasis exception:
// UKAAF headings keep dropping all print emphasis, as before.
const headingEmphasisOf = (segments, o) => (o && o.mode === 'bana' && Array.isArray(segments) ? dropTfBits(segments, sharedTfMask([segments])) : stripEmphasis(segments));
const plainUnit = (text) => (text != null && String(text).trim() ? [{ type: 'text', text: String(text) }] : []);
const segsOrText = (segs, text) => (Array.isArray(segs) && segs.length ? segs : plainUnit(text));
function listItemUnits(it) {
  if (!it || typeof it !== 'object') return [];
  const units = [];
  if (Array.isArray(it.segments) && it.segments.length) units.push(it.segments);
  else if (it.term != null || it.def != null || Array.isArray(it.termSegments) || Array.isArray(it.defSegments)) units.push(segsOrText(it.termSegments, it.term), segsOrText(it.defSegments, it.def));
  else units.push(plainUnit(it.text));
  for (const b of itemBlocksOf(it)) if (isItemParaBlock(b)) units.push(segsOrText(b.segments, b.text));
  return units;
}
function stripItemTf(it, mask) {
  if (!it || typeof it !== 'object') return it;
  const n = { ...it };
  for (const k of ['segments', 'termSegments', 'defSegments']) if (Array.isArray(it[k])) n[k] = dropTfBits(it[k], mask);
  if (Array.isArray(it.blocks)) n.blocks = it.blocks.map((b) => (isItemParaBlock(b) && Array.isArray(b.segments) ? { ...b, segments: dropTfBits(b.segments, mask) } : b));
  return n;
}
const tableCellsOf = (block) => [...(Array.isArray(block.headers) ? block.headers : []), ...(Array.isArray(block.rows) ? block.rows : []).flatMap((r) => (Array.isArray(r) ? r : [r]))];
function stripCellTf(cell, mask) {
  if (cell == null || cellIsBlank(cell)) return cell;
  const segs = cellSegments(cell);
  if (!segs.some((s) => s && s.type !== 'math' && (segTf(s) & mask))) return cell;
  const stripped = dropTfBits(segs, mask);
  return typeof cell === 'object' ? { ...cell, segments: stripped } : cellFromSegments(cellPlainText(cell), stripped);
}
// The units (segment arrays) of one block of a structure group, for the shared-typeform test.
function structUnits(block) {
  if (!block || typeof block !== 'object') return [];
  if (block.type === 'list') return (Array.isArray(block.items) ? block.items : []).flatMap(listItemUnits);
  if (block.type === 'table') return tableCellsOf(block).filter((c) => c != null && !cellIsBlank(c)).map((c) => cellSegments(c));
  return [segsOrText(block.segments, block.text)];
}
// TF-1 (Paul, 28 Sep 2026): old BANA 5.3.9 ("Ignore font attributes for numbers/letters beginning exercise
// material ... This includes any associated punctuation and/or labels used in conjunction with identifiers",
// "Step 1. Draw a box. {Omit the bold}") is one of the old 5.3.3-5.3.11 the June 2024 Changes to Foreign Language
// Sections do not reprint; Formats reprints only 5.3.1 (decorative, whole-structure) and 5.3.2 (English letters and
// word parts standing alone). A bold item-leading identifier is no longer stripped on its own account: 5.4.1
// ("Follow print for the meaningful use of italics, bold, color, etc.") applies instead. The item-wide 5.3.1 test
// below (sharedTfMask over the whole list) still drops emphasis that covers an entire list uniformly.
function decorativeEmphasisOf(block, o) {
  if (!block || typeof block !== 'object' || block.keepEmphasis) return block;   // keepEmphasis: the transcriber says the emphasis is not decorative (8.1.4b titles, Example 8-6)
  const isList = block.type === 'list' && Array.isArray(block.items);
  const isTable = block.type === 'table';
  const isDed = !!block.dedication && !isList && !isTable && block.type !== 'heading' && Array.isArray(block.segments);
  if (!isList && !isTable && !isDed) return block;
  // K27 / BANA 9.2.6c: a translation-pairs list omits typeform used to mark a whole item as
  // one language (foreign text or its translation) — computed PER ITEM (each item is one
  // language's line), unlike the shared mask below, which needs the WHOLE list to share it.
  // A word emphasised for another reason within an item (partial) is kept.
  if (isList && block.translationPairs) {
    const tpItems = block.items.map((it) => {
      const m = sharedTfMask(listItemUnits(it));
      return m ? stripItemTf(it, m) : it;
    });
    if (tpItems.some((it, k) => it !== block.items[k])) block = { ...block, items: tpItems };
  }
  const mask = Number.isInteger(block.structTf) ? block.structTf : sharedTfMask(structUnits(block));
  if (!mask) return block;
  if (isList) return { ...block, items: block.items.map((it) => stripItemTf(it, mask)) };
  if (isTable) {
    const out = { ...block };
    if (Array.isArray(block.headers)) out.headers = block.headers.map((c) => stripCellTf(c, mask));
    if (Array.isArray(block.rows)) out.rows = block.rows.map((r) => (Array.isArray(r) ? r.map((c) => stripCellTf(c, mask)) : stripCellTf(r, mask)));
    return out;
  }
  return { ...block, segments: dropTfBits(block.segments, mask) };
}
// Transcriber overrides first (F-99 / F-215 / F-145), then the decorative-emphasis rule (K1).
const emphasisResolvedOf = (block, o) => decorativeEmphasisOf(emphasisOmittedOf(block), o);

// K4 (KD, Q-26) / BANA 5.6.1-5.6.2 / UEB 9.9.1: "When transcribing a typeform passage which extends over more than one
// text element (e.g. a series of consecutive paragraphs), each text element is preceded by the typeform passage
// indicator and the typeform is terminated only at the point where the typeform changes." A run is two or more
// consecutive ordinary paragraphs (same style) that each carry the same typeform over all their text; every paragraph
// of the run opens with the passage indicator (even a one-word paragraph) and only the last is terminated. The March
// 2024 Updates say which blocks interrupt a run: a print page change does not (1.11.3e: no need to terminate for the
// print page number), nor does a braille page change or the running head (1.8.2f, 1.15.1h — nothing to do, the run
// lives in the text); a transcriber's note does (3.1.4), and so do reference notes placed at a page change (16.5.1j),
// as does any other block (heading, list, table, box, picture...). List items and contents entries are separate text
// elements, emphasised individually (Updates, 8.1.4 and 2.10.8), so runs are paragraphs only. A paragraph continued
// over a print page change (`continued` / `continuation`) is one paragraph: its second piece does not open again.
// `block.tfRun = { m, o, c }` (typeform bits in the run, opened here, closed here), set by emphasisContext; it is in
// getBlockSignature's key because the paragraph's braille now depends on its neighbours.
const PASSAGE_BRL = { 1: ['.7', ".'"], 2: ['_7', "_'"], 4: ['^7', "^'"], 8: ['@7', "@'"], 32: ['@#7', "@#'"], 64: ['^#7', "^#'"], 128: ['_#7', "_#'"], 256: ['"#7', "\"#'"], 512: ['.#7', ".#'"] };
const PASSAGE_BITS = Object.keys(PASSAGE_BRL).map(Number).sort((a, b) => a - b);
function tfRunMask(block) {
  if (!block || typeof block !== 'object' || block.type !== 'para') return 0;
  if (!Array.isArray(block.segments) || block.diagram || (Array.isArray(block.arrowLines) && block.arrowLines.length) || block.wordGaps || block.paraNumber) return 0;
  for (const s of block.segments) {
    if (!s || !(s.type == null || s.type === 'text') || typeof s.text !== 'string' || s.uncontracted || s.hyperlink || s.blank || s.spanTypeform || s.text.includes('\n')) return 0;
  }
  return sharedTfMask([block.segments]) & PASSAGE_BITS.reduce((a, b) => a | b, 0);
}
// Opening indicators outermost first (liblouis's own nesting: bold before italic, `^7.7 ... .'^'`), closing in reverse.
const tfRunOpen = (run) => PASSAGE_BITS.filter((b) => run.o & b).reverse().map((b) => PASSAGE_BRL[b][0]).join('');
const tfRunClose = (run) => PASSAGE_BITS.filter((b) => run.c & b).map((b) => PASSAGE_BRL[b][1]).join('');
const tfRunWrap = (braille, run) => (run && String(braille).trim() ? tfRunOpen(run) + braille + tfRunClose(run) : braille);
function tfRunWrapTc(tr, run) {
  if (!run || !tr || !String(tr.s).trim()) return tr;
  const a = tfRunOpen(run), z = tfRunClose(run);
  return { s: a + tr.s + z, src: [...Array.from(a, () => null), ...tr.src, ...Array.from(z, () => null)] };
}
const tfRunKey = (block) => `${block && block.tfRun ? `+tr${block.tfRun.m}.${block.tfRun.o}.${block.tfRun.c}` : ''}${block && Number.isInteger(block.structTf) ? `+st${block.structTf}` : ''}`;
// bi -> { tfRun } / { structTf } for the blocks whose emphasis depends on their neighbours, walked in output order
// (`order`, notes already moved to the end of their print page).
function emphasisContext(blocks, order, o) {
  const out = new Map();
  const put = (bi, v) => out.set(bi, { ...(out.get(bi) || {}), ...v });
  const seq = (Array.isArray(order) ? order : blocks.map((_, i) => i)).filter((bi) => blocks[bi] && typeof blocks[bi] === 'object');
  const isPageChange = (b) => b.type === 'pagenum';
  // K1 groups: contents lists next to each other, dedication blocks next to each other.
  const groupKey = (b) => (b.type === 'list' && b.kind === 'toc' ? 'toc' : (b.dedication && b.type !== 'heading' ? 'ded' : null));
  let group = [], gKey = null;
  const flushGroup = () => {
    if (group.length > 1) {
      const mask = sharedTfMask(group.flatMap((bi) => structUnits(emphasisOmittedOf(blocks[bi]))));
      for (const bi of group) put(bi, { structTf: mask });
    }
    group = []; gKey = null;
  };
  for (const bi of seq) {
    const b = blocks[bi];
    if (isPageChange(b)) continue;
    const k = groupKey(b);
    if (k !== gKey) flushGroup();
    if (k) { gKey = k; group.push(bi); }
  }
  flushGroup();
  // K4 passage runs.
  let run = [];                                          // [{ bi, b, mask }]
  const cls = (b) => `${b.style ?? ''}|${b.displayed ? 1 : 0}|${b.directions ? 1 : 0}`;
  const flushRun = () => {
    for (const bit of PASSAGE_BITS) {
      let i = 0;
      while (i < run.length) {
        if (!(run[i].mask & bit)) { i++; continue; }
        let j = i;
        while (j + 1 < run.length && (run[j + 1].mask & bit)) j++;
        if (j > i) {
          for (let k = i; k <= j; k++) {
            const r = run[k];
            r.m = (r.m || 0) | bit;
            const resumed = k > i && r.b.continuation && run[k - 1].b.continued;   // the rest of the same paragraph
            if (!resumed) r.o = (r.o || 0) | bit;
            if (k === j) r.c = (r.c || 0) | bit;
          }
        }
        i = j + 1;
      }
    }
    for (const r of run) if (r.m) put(r.bi, { tfRun: { m: r.m, o: r.o || 0, c: r.c || 0 } });
    run = [];
  };
  for (const bi of seq) {
    const b = blocks[bi];
    if (isPageChange(b)) continue;
    const resolved = out.has(bi) && Number.isInteger(out.get(bi).structTf) ? { ...b, structTf: out.get(bi).structTf } : b;
    const mask = b.type === 'para' ? tfRunMask(emphasisResolvedOf(resolved, o)) : 0;
    if (!mask || (run.length && cls(run[run.length - 1].b) !== cls(b))) flushRun();
    if (mask) run.push({ bi, b, mask });
  }
  flushRun();
  return out;
}
// F-189 / BANA 18.7.1 ("Use 1-3 margins for each diagrammed sentence") and 18.8.1 ("Precede and follow
// each arrow/sentence pair by blank lines"): optional `block.diagram` (1-3 margins) and `block.arrowLines`
// (the transcriber's own arrow / line-mode shaft lines, literal braille cells placed above the sentence;
// implies diagram). BANA only; without either field the paragraph is formatted as always.
const isDiagramPara = (block, o) => !!block && (block.diagram || (Array.isArray(block.arrowLines) && block.arrowLines.length)) && o.mode === 'bana';
const arrowLinesOf = (block, o) => (Array.isArray(block.arrowLines) ? block.arrowLines.filter((l) => typeof l === 'string').map((l) => l.replace(/\s+$/, '').slice(0, (o && o.width) || 40)) : []);   // F-189: a literal line is clipped to the page width, never wider (23 Sep verification)
// Feedback 30 Sep 2026, item 3 (Paul, 1 Oct): a paragraph made only of typed braille (six-key entry or pasted Unicode braille; at
// least one non-blank cell, nothing but cells, spaces and line breaks) is the transcriber's own braille and comes out exactly as
// typed: cell 1, no paragraph indent or block-style blank line, spaces and line breaks kept, wrapped only where a line is longer
// than the page (at its last space that fits, else at the edge; the runover in cell 1). Returns [{ text, base, collapsed }] runs in
// the editor's link coordinates (its cellText: raw offsets for plain text, each segment's whitespace runs counted as one), or null.
const TYPED_BRAILLE_RE = /^[⠀-⣿ \n]*[⠁-⣿][⠀-⣿ \n]*$/;
function typedBrailleRuns(block) {
  if (!block || block.type !== 'para' || block.diagram || (block.style && block.style !== 'body')) return null;   // a styled paragraph (quote, verse, ...) keeps its style's margins
  if (Array.isArray(block.segments)) {
    if (!block.segments.length || !block.segments.every((g) => g && (g.type === undefined || g.type === 'text') && typeof g.text === 'string')) return null;
    if (!TYPED_BRAILLE_RE.test(block.segments.map((g) => g.text).join(''))) return null;
    let base = 0;
    return block.segments.map((g) => { const r = { text: g.text, base, collapsed: true }; base += g.text.replace(/\s+/g, ' ').length; return r; });
  }
  if (block.segments != null || typeof block.text !== 'string' || !TYPED_BRAILLE_RE.test(block.text)) return null;
  return [{ text: block.text, base: 0, collapsed: false }];
}
function typedBrailleLinesTc(runs, width, unit) {
  const lines = [];
  let s = '', src = [];
  for (const { text, base, collapsed } of runs) {
    let c = base;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (collapsed && /\s/.test(ch) && i > 0 && /\s/.test(text[i - 1])) { /* same collapsed character as the one before */ } else if (i > 0) c++;
      if (ch === '\n') { lines.push({ s, src }); s = ''; src = []; continue; }
      s += unicodeBrailleToBrf(ch);
      src.push({ u: unit, c });
    }
  }
  lines.push({ s, src });
  const out = [];
  for (let { s: ls, src: lsrc } of lines) {
    while (ls.length > width) {
      let cut = ls.lastIndexOf(' ', width);
      if (cut <= 0) cut = width;
      out.push({ s: ls.slice(0, cut), src: lsrc.slice(0, cut) });
      let k = cut; while (k < ls.length && ls[k] === ' ') k++;
      ls = ls.slice(k); lsrc = lsrc.slice(k);
    }
    out.push({ s: ls, src: lsrc });
  }
  return out.map((x) => tcRstrip(x));
}
// A39 stage 2 ("one layout path"): formatDiagramPara and formatPara are gone -- traceBlockCore's 'para' case (which now also serves as `default`) is the only implementation left; formatBlock's 'para'/default cases are a projection of it.

// UEB 9.5.1 transcriber-defined typeform indicators (strikethrough/crossed-out print and
// anything else print has no standard UEB typeform for). Model: `segment.transcriberTypeform`
// (parse.mjs) is a STRING naming the slot. Two disjoint sources write it:
//   - 'strike' — Emboss's OWN strikethrough (every reader + the editor; UEB 9.5.1 crossed-out
//     text). Deliberately NOT 'trans1': the hyperlink indicator (F-233, HYPERLINK_OPEN/CLOSE
//     below) already claims the FIRST transcriber-defined typeform slot (BANA Sample 6-15), and
//     every imported external link is marked with it automatically (Paul, 25 Sep 2026) — so
//     strikethrough uses the SECOND slot instead, to stay visually distinct from a hyperlink in
//     the finished braille. 'strike' maps onto trans2's bit purely as an implementation detail
//     (below); nothing outside this file/parse.mjs ever sees the word 'trans2' for strikethrough.
//   - 'bai-trans1'..'bai-trans5' — BrailleBlaster's own '<bai-trans1>'..'<bai-trans5>' import
//     (parse.mjs A24, matched below by the trailing 'trans' + digit the regex looks for), kept
//     as the source's own slot number because Emboss does not know what any of them print-meant
//     (braille_blaster_import.test.mjs asserts the exact string, so it is never rewritten). A
//     source file that both uses bai-trans1 AND has hyperlinks is a genuine clash
//     already present in the source (both now render as the same first-slot indicator) — Emboss
//     does not attempt to resolve it; see collectSpecialSymbols below for how the Special
//     Symbols page reports it (first use wins, never a crash).
// transcriberTypeform is a SEPARATE field from the numeric `tf` (italic/underline/bold only,
// unchanged everywhere else in this file); the two combine only here, at the point a segment's
// typeform actually reaches liblouis, so nothing that inspects `seg.tf` elsewhere (richness
// checks, hyperlink/heading logic, the cache key's `JSON.stringify(block.segments)` which
// already covers this field with no further change needed) has to know transcriberTypeform
// exists. Bit values verified against the compiled en-ueb-g1.ctb (see Emboss/engine/louis.mjs's
// TYPEFORM comment for the probe).
const TRANS_TF_BIT = { trans1: 32, trans2: 64, trans3: 128, trans4: 256, trans5: 512 };
function transTfBit(seg) {
  const ttf = seg && typeof seg.transcriberTypeform === 'string' ? seg.transcriberTypeform : null;
  if (ttf === 'strike') return TRANS_TF_BIT.trans2;         // Emboss's own strikethrough: SECOND transcriber-defined typeform
  const m = ttf ? /trans([1-5])$/.exec(ttf) : null;
  return m ? TRANS_TF_BIT['trans' + m[1]] : 0;
}
// The combined bit array value liblouis actually needs for one segment: print tf (italic/
// underline/bold) OR'd with its transcriber-defined typeform, if any.
const segTf = (seg) => (seg && seg.tf || 0) | transTfBit(seg);

// ---- K16: foreign-language teaching texts (BANA Formats 1.16.3-1.16.4, 5.4.4, 8.10, 10.1.6c; June 2024 changes) ----
// Optional document option `foreignText` (field-registry.mjs; default off). Off, the braille is byte-identical outside
// glossaries: incidental foreign words are contracted with UEB modifiers (1.16.2; liblouis with NFC input, K20). A
// glossary's foreign text is brailled as below with the option off too (21.6.3b, foreignRefSegments).
// On, a text segment whose `seg.lang` names a language other than English (input/lang.mjs records it) is foreign
// material "identified as foreign" (1.16.3) and is brailled:
//   - UNCONTRACTED, in the same contracted run as its English neighbours (so an emphasis passage can span both): the
//     letters carry liblouis's no_contract typeform bit (0x1000, liblouis.h) - the method of the ready option kept in
//     docs/proposals/foreign-uncontracted-option.mjs, which reproduces RUEB 13.1.2 / 13.2.1 in one liblouis call;
//   - with FOREIGN ALPHABET SIGNS for accented letters (1.16.3 "Use foreign alphabet signs for accented letters"),
//     read from BANA Formats 2016 Appendix D (French, German, Italian, Spanish; Examples D-1..D-4, Example 21-22,
//     new Example 21-38 `L(`), not UEB modifiers. A language Appendix D does not cover: Appendix D's own heading defers
//     to BANA's "Guidance for Transcribing Foreign Language Material in UEB" (Provisional, May 2015), whose Method 3
//     ("Using Foreign Language Signs for Accented Letters", for foreign-language textbooks and bilingual dictionaries)
//     follows RUEB 13.6 and takes the signs from World Braille Usage, 3rd ed. (UNESCO/Perkins/NLS 2013; RUEB 13.6.2
//     "Refer to: The most recent edition of World Braille Usage"). So Portuguese uses WBU's Portuguese alphabet (p. 197,
//     Brazil and Portugal). A language with no braille code of its own in WBU (Latin, which RUEB 13.4.1's "foreign code
//     signs used in braille production in the country where the language is spoken" cannot apply to) keeps UEB
//     modifiers (RUEB 13.4.1 / 13.5; the Guidance's Method 2, "UEB Accented Letters and Uncontracted Words"), still
//     uncontracted. Other WBU languages are not tabled yet: they keep UEB modifiers too (FOREIGN_OTHER);
//   - with UEB punctuation, inverted marks included (1.16.3; liblouis's own ^;8 / ^;6);
//   - with no grade 1 indicator (RUEB 13.2.2), except the one numeric mode needs before a-j.
// How: the segment's per-character typeform carries the language (bits 16-23, FOREIGN_UNIT) on top of the liblouis bits;
// installForeign (called from installScrub, so formatBlock, traceBlock and both page builders get it) wraps
// o.translate / o.translatePos, takes those bits off before liblouis, and does the rest. The accented letters are
// translated as their base letters and then swapped for the foreign sign: the cell of each is found by translating the
// line twice (base letter / another letter of the same a-j or k-z class) and diffing - so it works with o.translate
// alone (the quick converter has no translatePos) and both paths give the same braille (A39). If anything does not line
// up, the line keeps UEB modifiers (still uncontracted) rather than risk a wrong cell.
const FOREIGN_NO_CONTRACT = 0x1000;
const FOREIGN_UNIT = 0x10000;
const FOREIGN_OTHER = 0xFF;                                   // foreign, but no foreign alphabet tabled (UEB modifiers)
const FOREIGN_LANGS = ['fr', 'de', 'it', 'es', 'pt'];         // index + 1 is the code in the typeform
// BANA Formats 2016 Appendix D, braille ASCII and Appendix D's own letter names. `[lower-case letter]: [sign, name]`.
// Portuguese (not in Appendix D): World Braille Usage, 3rd ed. (2013), p. 197 "Alphabet: Portuguese" (dots given there:
// ç 12346, á 12356, é 123456, í 34, ó 346, ú 23456, à 1246, â 16, ê 126, ô 1456, ã 345, õ 246, ü 1256).
const FOREIGN_ALPHABETS = {
  fr: { name: 'French', signs: { 'â': ['*', 'a circumflex'], 'à': ['(', 'a grave'], 'ç': ['&', 'c cedilla'], 'é': ['=', 'e acute'], 'ê': ['<', 'e circumflex'],
    'ë': ['$', 'e diaeresis'], 'è': ['!', 'e grave'], 'î': ['%', 'i circumflex'], 'ï': [']', 'i diaeresis'], 'ô': ['?', 'o circumflex'], 'œ': ['[', 'o-e ligature'],
    'û': [':', 'u circumflex'], 'ü': ['\\', 'u diaeresis'], 'ù': [')', 'u grave'], 'æ': ['>', 'a-e ligature'] } },
  de: { name: 'German', signs: { 'ä': ['>', 'a umlaut'], 'ö': ['[', 'o umlaut'], 'ü': ['\\', 'u umlaut'], 'ß': ['!', 'ess-tsett'] } },
  it: { name: 'Italian', signs: { 'â': ['*', 'a circumflex'], 'à': ['(', 'a grave'], 'ç': ['&', 'c cedilla'], 'é': ['=', 'e acute'], 'ê': ['<', 'e circumflex'],
    'ë': ['$', 'e diaeresis'], 'è': ['!', 'e grave'], 'î': ['%', 'i circumflex'], 'ï': [']', 'i diaeresis'], 'ì': ['/', 'i grave'], 'ô': ['?', 'o circumflex'],
    'ö': ['[', 'o diaeresis'], 'ò': ['+', 'o grave'], 'û': [':', 'u circumflex'], 'ü': ['\\', 'u diaeresis'], 'ù': [')', 'u grave'] } },
  es: { name: 'Spanish', signs: { 'á': ['(', 'a acute'], 'é': ['!', 'e acute'], 'í': ['/', 'i acute'], 'ñ': [']', 'n tilde'], 'ó': ['+', 'o acute'],
    'ú': [')', 'u acute'], 'ü': ['\\', 'u diaeresis'], 'ç': ['&', 'c cedilla'] } },
  pt: { name: 'Portuguese', signs: { 'ç': ['&', 'c cedilla'], 'á': ['(', 'a acute'], 'é': ['=', 'e acute'], 'í': ['/', 'i acute'], 'ó': ['+', 'o acute'],
    'ú': [')', 'u acute'], 'à': ['$', 'a grave'], 'â': ['*', 'a circumflex'], 'ê': ['<', 'e circumflex'], 'ô': ['?', 'o circumflex'],
    'ã': ['>', 'a tilde'], 'õ': ['[', 'o tilde'], 'ü': ['\\', 'u diaeresis'] } },
};
const FOREIGN_BASE_SPECIAL = { 'œ': 'o', 'æ': 'a', 'ß': 's' };
const foreignBase = (ch) => FOREIGN_BASE_SPECIAL[ch] || ch.normalize('NFD')[0];
// The diff partner of a base letter: another letter of the same a-j / k-z class, so numeric mode (a-j after a digit)
// is the same for both translations.
const FOREIGN_ALT = { a: 'b', c: 'd', e: 'f', i: 'j', n: 'm', o: 'p', s: 't', u: 'v' };
/** 'fr-CA' -> 1 ... ; any other non-English language -> FOREIGN_OTHER; English / none -> 0. */
function foreignLangIndex(lang) {
  const p = String(lang ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (!p || p === 'en') return 0;
  const i = FOREIGN_LANGS.indexOf(p);
  return i >= 0 ? i + 1 : FOREIGN_OTHER;
}
const foreignAlphabetOf = (idx) => (idx >= 1 && idx <= FOREIGN_LANGS.length ? FOREIGN_ALPHABETS[FOREIGN_LANGS[idx - 1]] : null);
const FOREIGN_LETTER_RE = /[\p{L}\p{M}]/u;
/** The typeform array of one text run: `base` everywhere, plus (foreignText on, or a glossary's foreign segment -
 *  `seg.foreignRef`, see foreignRefSegments; a foreign `seg.lang`, not an uncontracted segment) the language code on
 *  every character and no_contract on its letters. */
function foreignCharTf(text, base, seg, o) {
  const t = String(text ?? '');
  const idx = seg && (seg.foreignRef || (o && o.foreignText)) && !seg.uncontracted ? foreignLangIndex(seg.lang) : 0;
  if (!idx) return Array(t.length).fill(base);
  const hi = idx * FOREIGN_UNIT;
  return Array.from({ length: t.length }, (_, i) => base | hi | (FOREIGN_LETTER_RE.test(t[i]) ? FOREIGN_NO_CONTRACT : 0));
}
const tfHasForeign = (tf) => Array.isArray(tf) && tf.some((v) => v >= FOREIGN_UNIT);
// NFC with a position map (decomposed accents would otherwise miss the sign table), typeform kept per character.
function foreignNfc(t, tf) {
  let out = ''; const otf = [], map = [];
  for (let i = 0; i < t.length;) {
    let j = i + 1; while (j < t.length && /\p{M}/u.test(t[j])) j++;
    const c = t.slice(i, j).normalize('NFC');
    if (j - i > 1 && c.length === 1) { out += c; otf.push(tf[i]); map.push(i); }
    else for (let k = i; k < j; k++) { out += t[k]; otf.push(tf[k]); map.push(k); }
    i = j;
  }
  return { t: out, tf: otf, map };
}
// liblouis skips its `match` quote rules inside a no-contract word, so an ASCII " touching one comes out as the
// nonspecific quote (`,7`); curl those first (same length). From docs/proposals/foreign-uncontracted-option.mjs.
// Likewise a right single quote between two letters of a no-contract word (d’une, l’abbaye) would come out as a closing
// quote (`,0`); it is an apostrophe (Appendix D Example D-1: `d'une`, `l'abbaye`).
function foreignCurlQuotes(text, lt) {
  if (!text.includes('"') && !text.includes('’')) return text;
  const chars = Array.from(text);
  if (chars.length !== text.length) return text;
  const nc = (i) => i >= 0 && i < chars.length && (lt[i] & FOREIGN_NO_CONTRACT);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '’' && nc(i - 1) && nc(i + 1) && /\p{L}/u.test(chars[i - 1]) && /\p{L}/u.test(chars[i + 1])) { chars[i] = "'"; continue; }
    if (chars[i] !== '"') continue;
    let j = i + 1; while (j < chars.length && /[^\s\p{L}\p{N}]/u.test(chars[j])) j++;
    let k = i - 1; while (k >= 0 && /[^\s\p{L}\p{N}]/u.test(chars[k])) k--;
    if (!nc(j) && !nc(k)) continue;
    const opens = (i === 0 || /[\s([{—-]/.test(chars[i - 1])) && j < chars.length && /[\p{L}\p{N}]/u.test(chars[j]);
    chars[i] = opens ? '“' : '”';
  }
  return chars.join('');
}
// RUEB 13.2.2: no grade 1 indicator in foreign material. Words are matched input to output by spaces (liblouis keeps
// one space per space); in a word whose letters are all foreign, a `;` before a letter (or capital sign) goes, unless it
// belongs to another symbol (^;8, ;9 ...) or ends numeric mode (#AB;E). Unequal word counts: nothing is touched.
function foreignStripG1(text, tf, r) {
  const inTok = text.split(' '), outTok = r.b.split(' ');
  if (inTok.length !== outTok.length) return r;
  const drop = new Set();
  let ii = 0, oi = 0;
  for (let k = 0; k < inTok.length; k++) {
    const tok = inTok[k], ot = outTok[k];
    let letters = 0, foreign = 0;
    for (let c = 0; c < tok.length; c++) if (/\p{L}/u.test(tok[c])) { letters++; if (tf[ii + c] >= FOREIGN_UNIT) foreign++; }
    if (letters && letters === foreign) {
      for (let c = 0; c < ot.length; c++) {
        if (ot[c] !== ';' || (c > 0 && '^_".@;'.includes(ot[c - 1]))) continue;
        const nx = ot.slice(c + 1);
        if (!/^;?,{0,2}[A-Za-z]/.test(nx)) continue;
        const h = ot.lastIndexOf('#', c);
        if (h >= 0 && /^[A-Ja-j14]*$/.test(ot.slice(h + 1, c))) continue;
        drop.add(oi + c);
        if (nx[0] === ';') { drop.add(oi + c + 1); c++; }
      }
    }
    ii += tok.length + 1; oi += ot.length + 1;
  }
  if (!drop.size) return r;
  return { b: Array.from(r.b).filter((_, i) => !drop.has(i)).join(''), p: Array.isArray(r.p) ? r.p.filter((_, i) => !drop.has(i)) : r.p };
}
function foreignTranslate(raw, text, tf, pos) {
  let t = String(text ?? '');
  let tfa = Array.from({ length: t.length }, (_, i) => Number(tf[i]) || 0);
  let map = null;
  if (t !== t.normalize('NFC')) ({ t, tf: tfa, map } = foreignNfc(t, tfa));
  const lt = tfa.map((v) => v & 0xFFFF);
  const q = foreignCurlQuotes(t, lt);
  let t1 = '', t2 = '';
  const subs = [];
  for (let i = 0; i < q.length; i++) {
    const ch = q[i], lo = ch.toLowerCase();
    const al = (lt[i] & FOREIGN_NO_CONTRACT) ? foreignAlphabetOf((tfa[i] >>> 16) & 0xFF) : null;
    const e = al && lo.length === 1 ? al.signs[lo] : null;
    const b = e ? foreignBase(lo) : null;
    if (e && b && FOREIGN_ALT[b]) {
      const up = ch !== lo;
      t1 += up ? b.toUpperCase() : b; t2 += up ? FOREIGN_ALT[b].toUpperCase() : FOREIGN_ALT[b];
      subs.push({ i, sign: e[0], base: b });
    } else { t1 += ch; t2 += ch; }
  }
  const run = (s) => {
    const res = raw(s, lt);
    if (!pos) return { b: String(res ?? ''), p: null };
    const b = (typeof res === 'object' && res !== null) ? String(res.braille ?? res.text ?? '') : String(res ?? '');
    const p = (typeof res === 'object' && res !== null && Array.isArray(res.inputPos ?? res.map)) ? (res.inputPos ?? res.map).slice() : Array.from(b, (_, i) => i);
    return { b, p };
  };
  let out = foreignStripG1(t1, tfa, run(t1));
  if (subs.length) {
    const r2 = foreignStripG1(t2, tfa, run(t2));
    const diff = [];
    if (r2.b.length === out.b.length) for (let k = 0; k < out.b.length; k++) if (out.b[k] !== r2.b[k]) diff.push(k);
    if (r2.b.length === out.b.length && diff.length === subs.length && diff.every((k, n) => out.b[k].toLowerCase() === subs[n].base)) {
      const chars = Array.from(out.b);
      diff.forEach((k, n) => { chars[k] = subs[n].sign; });
      out = { b: chars.join(''), p: out.p };
    } else out = foreignStripG1(q, tfa, run(q));             // does not line up: UEB modifiers, still uncontracted
  }
  if (!pos) return out.b;
  const p = map ? out.p.map((x) => (typeof x === 'number' && x >= 0 ? (map[x] ?? x) : x)) : out.p;
  return { braille: out.b, inputPos: p };
}
// Wrap o.translate / o.translatePos once (marked; keeps the scrub mark so installScrub does not wrap again). A call whose
// typeform carries no language code goes straight through, untouched.
function installForeign(o) {
  if (!o || typeof o !== 'object') return o;
  for (const [k, pos] of [['translate', false], ['translatePos', true]]) {
    const f = o[k];
    if (typeof f !== 'function' || f.__foreign) continue;
    const w = (text, tf, ...rest) => (tfHasForeign(tf) ? foreignTranslate((t, x) => f(t, x, ...rest), text, tf, pos) : f(text, tf, ...rest));
    w.__foreign = true; if (f.__scrub) w.__scrub = true;
    o[k] = w;
  }
  return o;
}
// Every text segment of a model, wherever it sits (blocks, items, glossary term/def, table cells, nested blocks).
function foreignWalkSegments(list, fn, depth = 0) {
  if (!Array.isArray(list) || depth > 14) return;
  for (const n of list) {
    if (Array.isArray(n)) { foreignWalkSegments(n, fn, depth + 1); continue; }
    if (!n || typeof n !== 'object') continue;
    for (const key of ['segments', 'termSegments', 'defSegments', 'titleSegments']) if (Array.isArray(n[key])) for (const g of n[key]) if (g && typeof g === 'object' && g.type !== 'math' && g.type !== 'brl') fn(g);
    for (const key of ['blocks', 'items', 'entries', 'paragraphs', 'rows', 'cells', 'headers', 'header']) if (Array.isArray(n[key])) foreignWalkSegments(n[key], fn, depth + 1);
  }
}
/** 1.16.4: the document's foreign language - the commonest non-English `seg.lang` (by characters). */
function docForeignLang(blocks) {
  const n = new Map();
  foreignWalkSegments(blocks, (g) => { const idx = foreignLangIndex(g.lang); if (idx) { const p = String(g.lang).trim().toLowerCase().split(/[-_]/)[0]; n.set(p, (n.get(p) || 0) + String(g.text ?? '').length); } });
  let best = null, max = 0;
  for (const [p, c] of n) if (c > max) { best = p; max = c; }
  return best;
}
/** BANA 1.16.4: "The title page is considered English. A running head which begins on page t2 is considered foreign ...
 *  The full title which appears on page 1 of the body would be considered foreign." With `foreignText` and the optional
 *  `foreignTitle` (field-registry.mjs), the running head and the page-1 title are translated as foreign material in the
 *  document's foreign language; otherwise this is o.translate. (Emboss builds no title page yet - K29 - so nothing is
 *  there to keep English.) */
function foreignTitleTranslate(doc, o) {
  if (!o || typeof o.translate !== 'function' || !o.foreignText || !doc || !doc.foreignTitle) return o && o.translate;
  const hi = (foreignLangIndex(docForeignLang(doc.blocks)) || FOREIGN_OTHER) * FOREIGN_UNIT;
  return (text, tf) => {
    const t = String(text ?? '');
    return o.translate(t, Array.from({ length: t.length }, (_, i) => ((Array.isArray(tf) && tf[i]) || 0) | hi | (FOREIGN_LETTER_RE.test(t[i]) ? FOREIGN_NO_CONTRACT : 0)));
  };
}
// BANA 8.10 / 10.1.6c: "If all itemized lists in a text are in a foreign language, the grade 1 symbol indicator is not
// required for single letters that identify exercise items or answer choices. If there are some English and some
// foreign language itemized lists, treat all identifying letters as English ... Explain this usage in a transcriber's
// note." A list (or exercise) counts when its items carry a print identifier (`item.marker`, not a bullet); it is foreign
// when every such item's lettered text is in foreign segments. -> { foreign, english } list counts.
const FOREIGN_BULLET_MARK_RE = /^[\p{S}*·•∙‣⁃◦▪]$/u;
function foreignListCounts(blocks) {
  const c = { foreign: 0, english: 0 };
  const itemForeign = (it) => {
    const segs = Array.isArray(it.segments) ? it.segments.filter((g) => g && (g.type === 'text' || g.type == null) && /\p{L}/u.test(String(g.text ?? ''))) : [];
    return segs.length > 0 && segs.every((g) => !g.uncontracted && foreignLangIndex(g.lang));
  };
  const walk = (list, depth) => {
    if (!Array.isArray(list) || depth > 12) return;
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'list' && !['toc', 'glossary', 'index'].includes(b.kind) && Array.isArray(b.items)) {
        const marked = b.items.filter((it) => it && typeof it.marker === 'string' && it.marker.trim() && !it.bullet && !FOREIGN_BULLET_MARK_RE.test(it.marker.trim()));
        if (marked.length) c[marked.every(itemForeign) ? 'foreign' : 'english']++;
      }
      for (const key of ['blocks']) if (Array.isArray(b[key])) walk(b[key], depth + 1);
      if (Array.isArray(b.items)) for (const it of b.items) if (it && Array.isArray(it.blocks)) walk(it.blocks, depth + 1);
    }
  };
  walk(blocks, 0);
  return c;
}
/** An item's print identifier ("b.", "iv)"): as a foreign identifier (no grade 1 indicator) when every itemized list of
 *  the text is foreign (o._foreignLists, set by the page builders), otherwise as UEB requires. */
function itemMarkerTranslate(o, marker) {
  const m = String(marker ?? '');
  if (!o._foreignLists) return o.translate(m);
  return o.translate(m, Array.from({ length: m.length }, (_, i) => FOREIGN_OTHER * FOREIGN_UNIT | (FOREIGN_LETTER_RE.test(m[i]) ? FOREIGN_NO_CONTRACT : 0)));
}
// The page builders' document-level set-up for the option (both builders call it before formatting any block).
function applyForeignText(doc, o) {
  if (!(o.foreignText || doc?.foreignText)) return;
  o.foreignText = true;
  const c = foreignListCounts(Array.isArray(doc?.blocks) ? doc.blocks : []);
  if (c.foreign && !c.english) o._foreignLists = true;
}
// K16 / BANA 21.6.3 "English and Foreign Language Glossaries" - automatic, with or without the foreignText option:
// "a. Use contracted braille for English entry words. b. Use uncontracted braille for foreign language entry words, using
// the appropriate accented letters and symbols for the language. (See UEB, §13, Foreign Language.) c. List foreign
// language symbols on the Special Symbols page." The same holds for a bilingual reference (21.9.2; `bilingual` is a
// glossary-block flag): BANA's Provisional Guidance (May 2015) names "bilingual dictionaries (e.g., English/French)" for
// Method 3 (foreign signs for accented letters; "Neither foreign contractions nor UEB contractions are used in foreign
// words"; RUEB 13.6.1 "bilingual texts", 13.6.3). Inside a glossary block every text segment with a non-English `seg.lang`
// (the readers record it, input/lang.mjs) is foreign material and is brailled as the option brailles it (uncontracted,
// the language's foreign alphabet signs, UEB punctuation, no grade 1 indicator): the entry word, and a foreign
// definition too - 21.6.3's own description ("with the foreign language definition following on the same line") and
// Example 21-22 (`,peque]/simos microorganismos unicelulares4`, `,la habilidad de no caer4`, uncontracted). English
// text in the glossary, and every segment with no `lang`, is contracted as before (21.6.3a). Outside glossaries nothing
// changes: incidental foreign words stay contracted with UEB modifiers (1.16.2) unless the document option is on.
// The segments are copied with `foreignRef` (read by foreignCharTf); formatGlossary and traceBlock's glossary case both
// go through here (A39).
// Not a 17.6 definition list (`definitionList`, a glossary-shaped block): "Entry words are contracted only" (17.6.1), a
// foreign word in it is incidental (1.16.2); a 17.7 word list is in a foreign-language text, where the option applies.
const isForeignRefBlock = (b) => !!b && typeof b === 'object' && !b.definitionList && (b.type === 'glossary' || (b.type === 'list' && (b.kind === 'glossary' || b.style === 'glossary')));
const isForeignRefSeg = (g) => !!g && typeof g === 'object' && g.type !== 'math' && g.type !== 'brl' && !g.uncontracted && !!foreignLangIndex(g.lang);
function foreignRefSegments(block, segs) {
  if (!isForeignRefBlock(block) || !Array.isArray(segs) || !segs.some(isForeignRefSeg)) return segs;
  return segs.map((g) => (isForeignRefSeg(g) ? { ...g, foreignRef: true } : g));
}
// The glossary blocks of a model, wherever they sit (inside boxes, list items ...).
function foreignRefBlocks(list, out = [], depth = 0) {
  if (!Array.isArray(list) || depth > 14) return out;
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    if (isForeignRefBlock(b)) { out.push(b); continue; }
    if (Array.isArray(b.blocks)) foreignRefBlocks(b.blocks, out, depth + 1);
    if (Array.isArray(b.items)) for (const it of b.items) if (it && Array.isArray(it.blocks)) foreignRefBlocks(it.blocks, out, depth + 1);
  }
  return out;
}
// Special Symbols page (BANA 21.6.3c "List foreign language symbols on the Special Symbols page"; Appendix G "Foreign
// language symbols (UEB §13)"; RUEB 13.6.5): each foreign alphabet sign the document uses. PROVISIONAL wording
// ("e acute (French)", Appendix D's own letter names) until the transcribers give theirs. One entry per braille sign;
// a sign two languages share lists both ("e grave (French); e acute (Spanish)").
// Option off: only the glossaries' foreign text (21.6.3b, foreignRefSegments) has foreign signs, so only it is listed.
function collectForeignSigns(blocks, o, add, path = []) {
  if (!o) return;
  const scope = o.foreignText ? blocks : foreignRefBlocks(blocks);
  if (!scope.length) return;
  const bySign = new Map();
  foreignWalkSegments(scope, (g) => {
    if (g.uncontracted) return;
    const al = foreignAlphabetOf(foreignLangIndex(g.lang));
    if (!al) return;
    for (const ch of String(g.text ?? '').normalize('NFC').toLowerCase()) {
      const e = al.signs[ch];
      if (!e) continue;
      const d = `${e[1]} (${al.name})`;
      if (!bySign.has(e[0])) bySign.set(e[0], []);
      if (!bySign.get(e[0]).includes(d)) bySign.get(e[0]).push(d);
    }
  });
  for (const [sign, ds] of bySign) add({ print: '', braille: sign, kind: 'foreign', description: ds.join('; '), firstUse: path });
}

// Group inline segments for translation: adjacent contracted text segments form ONE run
// with a per-character typeform array, so liblouis sees the whole symbols-sequence —
// translated one segment at a time it never saw the unemphasised punctuation after a bold
// word and dropped the terminator (UEB §9: `^1emphasis^'1`, not `^1emphasis1`; A27a).
// Maths and uncontracted (grade 1) segments stay separate. `len` is each group's length
// in the flat text (maths counts as `$latex$`), which the cell trace uses for positions.
// Optional `imgnote.spanTypeform` (BANA 18.3.3c, Example 18-5): an embedded transcriber's note inside one emphasised run does NOT
// break the run: the typeform passage/word indicator is worked out over the whole sentence (note counted as one symbols-sequence,
// UEB 9.7.1) and the note's cells are put in where it sat. Done by translating the run with a placeholder 8-dot cell that liblouis
// passes through untouched, then swapping the note in. Needs `o` (checked: the placeholder must come out as one distinct cell).
const SPAN_NOTE_MARK = '\u28FF';
function spanNoteCell(o) {
  if (!o || typeof o.translate !== 'function') return null;
  let b; try { b = String(o.translate(SPAN_NOTE_MARK) ?? '').trim(); } catch { return null; }
  return b.length === 1 && b !== SPAN_NOTE_MARK && !/[A-Za-z0-9]/.test(b) ? b : null;
}
// Swap each placeholder cell in translated `braille` for its note's cells (in order, `state.k` runs on across the group's lines); the note's
// cells have no input position (-1).
function spliceSpanNotes(braille, inputPos, g, state, o, mark) {
  let out = '', pos = Array.isArray(inputPos) ? [] : null;
  for (let i = 0; i < braille.length; i++) {
    if (braille[i] === mark && state.k < g.notes.length) {
      const brl = TN_OPEN + imgnoteBraille(g.notes[state.k++].seg, o) + TN_CLOSE;
      out += brl; if (pos) for (let j = 0; j < brl.length; j++) pos.push(-1);
    } else { out += braille[i]; if (pos) pos.push(inputPos[i]); }
  }
  return { braille: out, inputPos: pos };
}
function groupSegments(segments, o) {
  const groups = [];
  const segList = segments || [];
  for (const [si, seg] of segList.entries()) {
    if (!seg) continue;
    if (seg.type === 'math') {
      groups.push({ math: seg, len: (seg.latex ? `$${seg.latex}$` : '⟨equation⟩').length });
      continue;
    }
    if (seg.type === 'noteref') {
      groups.push({ noteref: seg, len: String(seg.text ?? '').length });
      continue;
    }
    if (seg.type === 'linenum') {
      groups.push({ linenum: seg, len: String(seg.text ?? '').length });
      continue;
    }
    if (seg.type === 'gap') {                                        // 17.6.1c: two blank cells, not collapsible; no print characters
      groups.push({ gap: true, cells: seg.cells === 3 ? 3 : 2, len: 0 });
      continue;
    }
    if (seg.type === 'imgnote') {
      const lastG = groups[groups.length - 1], nx = segList.slice(si + 1).find((x) => x);
      if (seg.spanTypeform && o && lastG && lastG.text != null && !lastG.uncontracted && nx && nx.type === 'text' && !nx.uncontracted && String(nx.text ?? '').trim() && spanNoteCell(o)) {
        (lastG.notes || (lastG.notes = [])).push({ i: lastG.text.length, len: String(seg.text ?? '').length, seg });
        lastG.text += SPAN_NOTE_MARK; lastG.tf.push(lastG.tf.length ? lastG.tf[lastG.tf.length - 1] : 0);
        lastG.len = lastG.text.length + lastG.notes.reduce((a, n) => a + n.len - 1, 0);
        continue;
      }
      groups.push({ imgnote: seg, len: String(seg.text ?? '').length });
      continue;
    }
    if (seg.blank && !String(seg.text ?? '').trim()) {                // F-237: print shows empty space for an omitted word / a blank to fill in (BANA 10.6.1): three dot-5 cells (the transcriber's note explaining the change is the caller's TN)
      groups.push({ brl: { type: 'brl', text: '', brl: BLANK_CELLS }, len: 0 });
      continue;
    }
    if (seg.type === 'brl') {                                        // F-187/F-188/F-222: literal braille cells (grouping indicators, transcriber-defined symbols, dot locators, devised cells); `text` is the print it stands for
      groups.push({ brl: seg, len: String(seg.text ?? '').length });
      continue;
    }
    const t = String(seg.text ?? '').replace(/[^\S\n]+/g, ' ');    // collapse horizontal space runs; keep \n
    if (!t) continue;
    const last = groups[groups.length - 1];
    // F-233: a hyperlinked run never merges with a plain neighbour (its own group, so the
    // indicator pair wraps exactly the hyperlinked text, layered outside any tf it also carries).
    if (!seg.hyperlink && !seg.uncontracted && last && last.text != null && !last.uncontracted && !last.hyperlink) {
      last.text += t;
      for (const v of foreignCharTf(t, segTf(seg), seg, o)) last.tf.push(v);   // K16: a foreign run's language code (foreignText only)
    } else if (!seg.hyperlink && seg.uncontracted && last && last.text != null && last.uncontracted && !last.hyperlink && (seg.tf || seg.transcriberTypeform || last.hasTf)) {
      // Adjacent uncontracted pieces, one of them emphasised (17.4.1b partial emphasis: `a` **cc** `ident`), are ONE uncontracted word.
      last.text += t;
      for (let i = 0; i < t.length; i++) last.tf.push(segTf(seg));
      last.hasTf = true;
    } else {
      // LINK-2: a hyperlink segment whose print tf carries the underline bit is braille'd
      // with UEB's own underline typeform (below), not the hyperlink wrap — decided once
      // here, from the SOURCE segment's own tf (never a merged/foreign-adjusted one), since a
      // hyperlink segment always starts its own group (see the F-233 comment above).
      groups.push({ text: t, tf: foreignCharTf(t, segTf(seg), seg, o), uncontracted: !!seg.uncontracted, hasTf: !!seg.uncontracted && (!!seg.tf || !!seg.transcriberTypeform), hyperlink: !!seg.hyperlink, linkUnderline: !!seg.hyperlink && !!((seg.tf || 0) & TF_UNDERLINE) });
    }
    { const lg = groups[groups.length - 1]; lg.len = lg.text.length + (lg.notes ? lg.notes.reduce((a, n) => a + n.len - 1, 0) : 0); }
  }
  // Split each text group into lines (a \n is a forced line break), with their typeforms.
  for (const g of groups) {
    if (g.text == null) continue;
    g.lines = [];
    let start = 0;
    for (const line of g.text.split('\n')) {
      const tf = g.tf.slice(start, start + line.length);
      g.lines.push({ text: line, start, tf: tf.some(Boolean) ? tf : null });
      start += line.length + 1;
    }
  }
  return groups;
}

// A print note reference mark (BANA Formats §16.2.2, same form in UKAAF B004 §11 Ex 2):
// a superscripted number or letter takes the superscript indicator (;9#a, ;9b);
// asterisks and daggers are not superscript (§16.2.2c) and keep their own symbols.
// BANA 16.2.2's own symbol table gives a fixed equivalent for a "superscripted hollow
// dot" mark too — ";9"0" (Example 16-2: '"<craft;9"0"> craft;9"04') — a print glyph with
// no single canonical Unicode form (F-106/Q-34). The section's own worked examples settle
// on "°" (U+00B0 DEGREE SIGN, gold-transcribed for Example 16-2 and all three marks of
// Sample 16-4 from the PDF's small raised open circle); ○ U+25CB, ◦ U+25E6 and • U+2022 are
// the other candidates a real source could plausibly use for the same glyph. All four map
// to the rule's fixed symbol exactly like asterisk/dagger/double-dagger do, rather than
// falling through to raw liblouis translation of whichever character the print used.
const NOTE_SYMBOLS = { '*': '"9', '∗': '"9', '†': '@,?', '‡': '@,]', '°': ';9"0', '○': ';9"0', '◦': ';9"0', '•': ';9"0' };
function noterefBraille(seg, o) {
  const mark = String(seg.text ?? '').trim();
  if (!mark) return '';
  if ([...mark].every((ch) => NOTE_SYMBOLS[ch])) return [...mark].map((ch) => NOTE_SYMBOLS[ch]).join('');
  if (/^[a-z]+$/.test(mark)) return `;9${mark.toUpperCase()}`;
  if (/^[A-Z]$/.test(mark)) return `;9,${mark}`;
  return `;9${o.translate(mark).trim()}`;
}

// UEB 5.6.2 / 6.5: a numeric reference mark (;9#a) sets numeric mode, which only a space, hyphen, dash or the grade 1 terminator ends, and a
// letter a-j straight after it would read as a digit - so a numeric mark written directly before a word that begins with a-j takes the terminator
// (Sample 13-08: ;9#A;'CL>ION). `next` is the following text group.
const noterefTerminator = (seg, next) => (next && typeof next.text === 'string' && /^\d+$/.test(String(seg.text ?? '').trim()) && /^[a-jA-J]/.test(next.text) ? G1_TERMINATOR : '');
// A print line number (A30) in the braille stream: a word of its own (see wrapNumbered).
const lineNumberWord = (seg, o) => {
  const t = String(seg.text ?? '').trim();
  return t ? ` ${LN_OPEN}${o.translate(t).trim()}${LN_CLOSE} ` : '';
};
// Wrap a paragraph or list item: line-numbered text (BANA Formats §15.3–15.4) takes the
// numbered wrap; the document's widest number (o.lineNumberWidth) sets the text width.
function wrapBody(braille, o, width, first, runover, counted = false) {
  if (!hasLineNumbers(braille)) return wrapCells(braille, width, first, runover);
  if (counted) return wrapCounted(braille, null, width, first, runover, o.lineNumberWidth || 0).lines;   // F-208: block.countedWords
  return wrapNumbered(braille, null, width, first, runover, o.lineNumberWidth || 0).lines;
}
function tcWrapBody(o, tr, width, first, runover, counted = false) {         // mirror wrapBody
  if (!hasLineNumbers(tr.s)) return tcWrap(o, tr, width, first, runover);
  const { lines, srcs } = (counted ? wrapCounted : wrapNumbered)(tr.s, tr.src, width, first, runover, o.lineNumberWidth || 0);
  return lines.map((line, i) => tcRstrip({ s: line, src: srcs[i] }));
}
// The transcriber's note before the first line-numbered text (BANA Formats §15.4.1d):
// only the lines print numbers are numbered, so the reader is told (A30).
// F-208 / BANA 15.8.1b: the rule's own suggested wording for counted words (`block.countedWords`).
const COUNTED_WORDS_NOTE = 'Three blank cells indicate the end of a print line. The numbers in the right margin are the number of words read at the point of the three blank cells.';
const LINE_NUMBER_NOTE = 'Line numbers are shown at the right margin where print numbers a line. Three blank cells within a braille line show where that print line begins.';
function lineNumberNote(block, o) {
  if (!block.lnNote) return [];
  const { first, runover } = tnMargins(o);
  // F-234: optional `block.lnNoteText` (on the first numbered block) supplies the source's own wording instead of the fixed sentence.
  const text = block.lnNoteText && String(block.lnNoteText).trim() ? String(block.lnNoteText).trim() : (block.countedWords ? COUNTED_WORDS_NOTE : LINE_NUMBER_NOTE);
  return wrapCells(TN_OPEN + o.translate(text).trim() + TN_CLOSE, o.width || 38, first, runover).map((l) => l.replace(/\s+$/, ''));
}

// UEB §5.1-5.2 (and BANA Formats §17.2.2d, §17.3.2, §17.8-17.11: spelling words repeated or
// listed "in uncontracted braille" show no indicator in Samples 17-1..17-3, Examples 17-3, 17-7,
// 17-8, 17-10): a grade-1 indicator exists only to stop a reader taking letters for a
// contraction, so in a list item, or a paragraph that is wholly uncontracted (`o.g1Quiet`, see
// g1Quiet below), it is NOT written when no symbols-sequence of the run could be misread. Running
// prose and headings keep it (their uncontracted words stand out from contracted text). Two
// things can be misread: a lone letter (b = but, c = can ... z = as) and a run of letters equal
// to a shortform's letters (ab = about, td = today ...); digits followed by a-j also need it.
const G1_LONE_LETTER_SIGNS = new Set('bcdefghjklmnpqrstuvwxyz'.split(''));
const G1_SHORTFORMS = new Set(('ab abv ac acr af afn afw ag agst al alm alr alt alth alw bl brl cd chn dcl dclg dcv dcvg ei fr fst gd grt '
  + 'herf hm hmf imm xs xf lr ll mch myf mst nec nei onef ourvs pd perh qk rcv rcvg rjc rjcg sd shd sch themvs thyf td tgr tm tn wd yr yrf yrvs').split(' '));
const g1Quiet = (o) => (o.g1Quiet ? o : { ...o, g1Quiet: true });
const segsWhollyUncontracted = (segs) => Array.isArray(segs) && segs.some((g) => g && g.uncontracted)
  && segs.every((g) => !g || g.uncontracted || (g.type === 'text' && !String(g.text ?? '').trim()));
function g1IndicatorNeeded(str) {
  const s = String(str ?? '');
  if (/[^\x00-\x7f]/.test(s)) return true;                            // non-ASCII (accents, symbols): leave to the caller
  if (!/[A-Za-z\d]/.test(s)) return false;                             // only symbols/punctuation (`+`, `=`): no letter or digit to misread (UEB 5.1), Example 17-13
  if (/\d/.test(s) || !/[A-Za-z]/.test(s)) return true;              // digits: keep the indicator
  for (const tok of s.split(/\s+/)) {
    const letters = tok.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (!letters) continue;
    if (letters.length === 1 ? G1_LONE_LETTER_SIGNS.has(letters) : G1_SHORTFORMS.has(letters)) return true;
  }
  return false;
}

// K22(a) / errata: Example 10-16 (`"<_1to _1g">`, no terminator) was matched by stripping the
// passage terminator (`_'`) liblouis writes after a two- or three-word run of word indicators
// (UEB 9). The errata corrects the book's own expected braille to `"<_1to _1g_'">` — exactly
// what liblouis produces unmodified — so the strip (formerly `stripWordRunTerminator` /
// `stripWordRunTerminatorPos`, `WORD_RUN_TERMINATOR`) existed only to match the now-superseded
// example and has been removed; liblouis's own output is used as-is (see translateLine below
// and its cell-trace mirror).

// An embedded note's braille; optional `imgnote.uncontracted` (17.11.2b: the repeated word of a crossed-out-letter word is written
// uncontracted like the word it repeats, Example 17-12) uses the grade-1 translator with no indicator. Default: contracted.
function imgnoteBraille(note, o) {
  const t = String(note.text ?? '');
  const g1 = note.uncontracted && (o.translateG1 || o.translateUncontracted);
  return (g1 ? g1(t) : o.translate(t)).trim();
}
// UEB 9.3.1-9.3.2 / 9.7.2 and BANA Example 1-18 (`.1TR9EO4`): a typeform WORD indicator runs to the end of its symbols-sequence, attached
// punctuation included, so an emphasised single word followed directly by punctuation needs no terminator. Optional (`o.typeformWordPunct`
// or `doc.typeformWordPunct`; default off: liblouis / BrailleBlaster write `.1TR9EO.'4`). Extends the typeform over that trailing
// punctuation before translation (same length: cell-trace positions are untouched). Words followed by letters/digits keep the terminator.
function typeformWordPunct(text, tf, o) {
  if (!o || !o.typeformWordPunct || !Array.isArray(tf) || !tf.some(Boolean)) return tf;
  const out = tf.slice(), n = text.length;
  for (let i = 0; i < n;) {
    if (!tf[i]) { i++; continue; }
    let j = i; while (j < n && tf[j] === tf[i]) j++;
    let k = j; while (k < n && !tf[k] && /[^\p{L}\p{N}\s]/u.test(text[k])) k++;
    const run = text.slice(i, j);
    if (k > j && (k === n || /\s/.test(text[k])) && /\p{L}/u.test(run) && !/\s/.test(run) && (i === 0 || /[^\p{L}\p{N}]/u.test(text[i - 1]))) for (let m = j; m < k; m++) out[m] = tf[i];
    i = j;
  }
  return out;
}
// Uncontracted (grade 1) run inside grade-2 text: translate with the G1 table
// when the caller supplies one, then mark it with the UEB grade-1 word
// indicator (single word) or passage indicator + terminator (UEB §5.4-5.5).
// Shared by segmentsToBraille and its cell-trace mirror (tcJoined), so the two can
// never disagree. The result is NOT trimmed: a run's own boundary spaces (e.g. the
// " ... " between two uncontracted sentences, BANA Sample 17-12 `great4 444 ,this`)
// belong to the running text.
function uncontractedLineBraille(str, tf, o) {
  if (!str) return '';
  const g1 = o.translateG1 || o.translateUncontracted;
  // BANA 17.4.1c / 17.10.3 / 17.13.1: print emphasis is kept on an uncontracted run (typeform forwarded to the grade-1 table).
  const tr = g1 ? (tf ? g1(str, tf) : g1(str)) : (tf ? o.translate(str, tf) : o.translate(str));
  if (o.g1Bare || (o.g1Quiet && !g1IndicatorNeeded(str))) return tr;   // g1Bare: the caller writes one passage indicator/terminator around several lines (13.6.4a)
  return str.includes(' ') ? `${G1_PASSAGE_OPEN}${tr}${G1_TERMINATOR}` : `${G1_WORD}${tr}`;
}
// Render a mixed run of text/math segments into one braille string (no wrapping).
// Shared by paragraphs, list items and headings that contain inline maths.
function segmentsToBraille(segments, o, lineNumbers = false) {
  let braille = '';
  const translateLine = (str, tf, isUncontracted) => {
    if (!str) return '';
    if (isUncontracted) return uncontractedLineBraille(str, tf, o);
    return tf ? o.translate(str, typeformWordPunct(str, tf, o)) : o.translate(str);
  };
  const grouped = groupSegments(segments, o);
  for (const [gi, g] of grouped.entries()) {
    if (g.gap) { braille += ` ${g.cells === 3 ? GAP3_CELL : GAP_CELL} `; continue; }
    if (g.noteref) { braille += noterefBraille(g.noteref, o) + noterefTerminator(g.noteref, grouped[gi + 1]); continue; }
    if (g.linenum) { if (lineNumbers) braille += lineNumberWord(g.linenum, o); continue; }
    // BANA 10.11.1: an image inside exercise material becomes an embedded transcriber's
    // note (TN indicators around its description) right where the image sat.
    if (g.imgnote) { braille += TN_OPEN + imgnoteBraille(g.imgnote, o) + TN_CLOSE; continue; }
    if (g.brl) { braille += String(g.brl.brl ?? ''); continue; }
    if (g.math) {
      if (isUnreadableMath(g.math)) { braille += unreadableMathBrf(o, g.math); continue; }   // A89
      if (!o.mathToBrf) continue;
      try { const brf = o.mathToBrf(g.math); if (brf) braille += brf; }
      catch (e) {
        if (isRejectedMath(e)) braille += unreadableMathBrf(o, g.math, e);   // S2b #11: the engine rejected a non-empty equation: the note stands for it
        else { if (typeof console !== 'undefined') console.warn('[maths] inline equation skipped:', (e && e.message) || e); warnInlineMathSkipped(o, e); }
      }
      continue;
    }
    if (g.notes) {                                                   // spanTypeform notes: swap the placeholder cells for the notes
      const mark = spanNoteCell(o), st = { k: 0 };
      braille += g.lines.map((l) => spliceSpanNotes(translateLine(l.text, l.tf, false), null, g, st, o, mark).braille).join('\n');
      continue;
    }
    if (g.hyperlink && !g.linkUnderline) { braille += HYPERLINK_OPEN + g.lines.map((l) => translateLine(l.text, l.tf, g.uncontracted)).join('\n') + HYPERLINK_CLOSE; continue; }   // LINK-2: an underlined link skips the wrap — UEB's own underline indicator (from `l.tf`, below) is enough
    braille += g.lines.map((l) => translateLine(l.text, l.tf, g.uncontracted)).join('\n');
  }
  return braille.replace(/^[^\S\n]+|[^\S\n]+$/g, '');          // trim boundary spaces, keep newlines
}

// F-205 / BANA 15.2.1b: optional `block.paraNumber` (default off: the number goes to the right margin as
// line-numbered text) puts a margin paragraph number INLINE, before the paragraph's first word:
// the leading linenum segment becomes literal cells ("#BJ ") that sit in the text and wrap with it.
// `text` keeps the print characters so source positions in the cell trace are unchanged.
function paraNumberSegs(block, segments, o) {
  if (!block || !block.paraNumber || !Array.isArray(segments)) return segments;
  const i = segments.findIndex((g) => g && !(g.type === 'text' && !String(g.text ?? '').trim()));
  const g = segments[i];
  if (!g || g.type !== 'linenum') return segments;
  const t = String(g.text ?? '').trim();
  if (!t) return segments;
  const out = segments.slice();
  out[i] = { type: 'brl', brl: `${o.translate(t).trim()} `, text: g.text };
  return out;
}
// A39 stage 2 ("one layout path"): formatSegmentedPara is gone -- traceBlockCore's 'para' case's segments branch is the only implementation left.

// Transcriber's note (a `note` block): the UEB TN indicators @.< … @.> (UEB §3.27)
// enclose the translated text. Margins per mode (shared with traceBlock):
//  BANA Formats §3.2.2: "A standard transcriber's note uses 7-5 margins" — Example 3-1
//    shows it in cell 7, runover cell 5, with no blank line before or after.
//  UKAAF: B004 gives no margin for a stand-alone TN, so the house 1-3 is kept.
const tnMargins = (o) => (o.mode === 'bana' ? { first: 6, runover: 4 } : { first: 0, runover: 2 });
// The TN indicators replace a note's own print markers (A27d): "[Transcriber's Note: …]"
// (or "[TN: …]") loses its brackets and label, and emphasis covering the whole note is
// dropped. Returns the segments to translate and `offset`, the number of flat-text
// characters removed from the front (for the cell trace).
const TN_LABEL_RE = /^\s*(\[\s*)?((?:transcriber['’]s\s+note|tn)\s*:\s*)?/i;
function tnContent(block) {
  let segs = block.segments
    ? block.segments.map((g) => ({ ...g }))
    : [{ type: 'text', text: String(block.text ?? '') }];
  const texts = segs.filter((g) => g.type !== 'math' && String(g.text || '').trim());
  if (texts.length && texts.every((g) => g.tf && g.tf === texts[0].tf)) segs = segs.map((g) => (g.type === 'math' ? g : { ...g, tf: 0 }));
  let offset = 0;
  const first = segs[0], last = segs[segs.length - 1];
  if (first && first.type !== 'math') {
    const m = String(first.text || '').match(TN_LABEL_RE);
    const bracketed = !!m[1] && last.type !== 'math' && /\]\s*$/.test(String(last.text || ''));
    // Strip "[label: … ]" or a bare leading "label:"; a lone "[" without its "]" stays.
    if (bracketed || (m[2] && !m[1])) {
      offset = m[0].length;
      first.text = String(first.text).slice(offset);
      if (bracketed) last.text = String(last.text).replace(/\s*\]\s*$/, '');
    }
  }
  return { segs: mentionLocatorSegs(block, segs.filter((g) => g.type === 'math' || g.text)), offset };
}
// F-138 / RUEB 3.13, BANA 2.5.2c, 3.3.1: optional `block.mentionSymbols` (array of print strings; default absent =
// no change) puts the dot locator for "mention" (.=) before the FIRST occurrence of each listed symbol in the note
// (Example 3-1: `symbol .="8 repres5ts`). The locator is a zero-width literal-cell segment (`text` empty), so the
// print text and source offsets of the cell trace are unchanged.
function mentionLocatorSegs(block, segs) {
  const syms = Array.isArray(block.mentionSymbols) ? block.mentionSymbols.map(String).filter(Boolean) : [];
  if (!syms.length) return segs;
  let out = segs;
  for (const sym of syms) {
    const next = [];
    let done = false;
    for (const g of out) {
      const i = (!done && (!g.type || g.type === 'text') && !g.uncontracted) ? String(g.text ?? '').indexOf(sym) : -1;
      if (i < 0) { next.push(g); continue; }
      done = true;
      const t = String(g.text);
      if (i > 0) next.push({ ...g, text: t.slice(0, i) });
      next.push({ type: 'brl', text: '', brl: '.=' });
      next.push({ ...g, text: t.slice(i) });
    }
    out = next;
  }
  return out;
}
// F-164 / BANA 3.2.1a-b: "Unspaced transcriber's note indicators begin (@.<) and end (@.>) a
// transcriber's note, regardless of the number of paragraphs" -- a note with several source
// <p> (block.blocks, parse.mjs's pushProdnote) opens with @.< on its first paragraph and
// closes with @.> on its last, each paragraph at the note's own margin, no blank between
// (3.2.1c). The rule gives no separate margin for continuation paragraphs (no gold example),
// so each keeps the standard note margin (BANA 7-5, UKAAF 1-3). Mirrored in traceBlock.
function tnParas(block) {
  return (Array.isArray(block.blocks) ? block.blocks : []).filter((cb) => String(cb.text ?? '').trim() || (cb.segments && cb.segments.length));
}
// F-241 / BANA 14.10.2, 14.5.2a: optional `block.enclosePrefix` (default: the whole note is enclosed, as before)
// encloses only that leading text in @.< @.> and continues the rest of the SAME 7-5 line as ordinary text
// ("Cartoon" title, artist ... ; "Craig, Peter" Together). Returns null when it does not apply.
function tnPrefixSplit(block, tn) {
  const prefix = block.enclosePrefix ? String(block.enclosePrefix).trim() : '';
  if (!prefix || block.tnPart || tnParas(block).length > 1 || !tn.segs.length) return null;
  const first = tn.segs[0];
  if (!first || first.type === 'math' || first.type === 'noteref' || first.type === 'linenum' || first.type === 'gap') return null;
  const t = String(first.text ?? '');
  if (!t.startsWith(prefix)) return null;
  const restFirst = t.slice(prefix.length);
  const rest = [...(restFirst ? [{ ...first, text: restFirst }] : []), ...tn.segs.slice(1)];
  if (!rest.length || !rest.some((g) => g.type === 'math' || String(g.text || '').trim())) return null;
  return { pre: [{ ...first, text: prefix }], rest, restOffset: tn.offset + prefix.length };
}
// F-15 / BANA 3.3.2: optional `block.keyList` (default off) on a plain-text note whose first line is the introduction
// and whose further lines (two or more) identify abbreviations or symbols: the introduction keeps the note's 7-5
// margins, the identifications use 1-3 margins "preceded and followed by a blank line", and the closing indicator
// follows the last item. Optional `block.keyLocator` puts the dot locator for "mention" (.=) before each item
// (BANA 2.5.2c: symbols; letters that are keys do not need it, 16.11.1e). Returns null when not applicable.
function tnKeyLines(block, o) {
  if (!block.keyList || !isBanaOpts(o) || block.segments || block.tnPart || tnParas(block).length > 1) return null;
  const text = String(block.text ?? '');
  const lines = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) lines.push({ text: raw.trim(), base: pos + lead });
    pos += raw.length + 1;
  }
  return lines.length >= 3 ? lines : null;
}
function formatTnKeyList(block, o, lines) {
  const w = o.width || 38;
  const { first, runover } = tnMargins(o);
  const loc = block.keyLocator ? '.=' : '';
  const out = wrapCells(TN_OPEN + o.translate(lines[0].text).trim(), w, first, runover).map((l) => l.replace(/\s+$/, ''));
  out.push('');
  lines.slice(1).forEach((it, i, a) => {
    out.push(...wrapCells(loc + o.translate(it.text).trim() + (i === a.length - 1 ? TN_CLOSE : ''), w, 0, 2).map((l) => l.replace(/\s+$/, '')));
  });
  out.push('');
  return out;
}
// BANA 16.9.3d: "Do not add print page numbers to the notes if they do not appear in print." The pages of the endnote section follow
// the last print page, so assemble() would keep showing that page's number (with a continuation letter) on their line 1: replaced
// by the running head alone.
function clearEndnotePrintPages(pages, content, contentBlock, pagePlan, en, asm, o) {
  const first = content.findIndex((l, k) => contentBlock[k] === en.headIdx && l !== '');
  if (first < 0) return;
  const { pageOf } = planPages(pagePlan, content.length);
  const titles = banaLineOne(asm).titles;
  for (let p = pageOf(first); p < pages.length; p++) {
    if (Array.isArray(pages[p]) && pages[p].length) pages[p][0] = banaRunningHead(null, titles, o.width, p + 1, null);
  }
}
// IMP-W3 / BANA 16.9.3b: the heading NOTES the transcriber supplies for an endnote section, in transcriber's note indicators,
// centred, with a blank line under it. (UKAAF uses an ordinary heading block instead; see planEndnoteSection.)
// BANA 4.3.2 / 16.9.3b: "on line 1 (line 3 if a running head is used)": with a running head on line 1 the heading is two lines down. The
// line between is a single space, not '' - pagination drops a blank that would open a page, and this one must stay (toBRF strips it).
function endnoteHeadLines(block, o) {
  const w = o.width || 38;
  return [...(o._runningHead ? [' '] : []), ...centredBlock(TN_OPEN + o.translate(String(block.text || 'NOTES')).trim() + TN_CLOSE, w).map((l) => l.replace(/\s+$/, '')), ''];
}
function formatTranscriberNote(block, o) {
  if (block.endnoteHead) return endnoteHeadLines(block, o);
  const w = o.width || 38;
  const keyLines = tnKeyLines(block, o);
  if (keyLines) return formatTnKeyList(block, o, keyLines);
  const paras = tnParas(block);
  if (paras.length > 1) {
    const { first, runover } = tnMargins(o);
    const out = [];
    paras.forEach((cb, i) => {
      const inner = segmentsToBraille(tnContent(cb).segs, o).trim();
      if (!inner) return;
      out.push(...wrapCells((i === 0 ? TN_OPEN : '') + inner + (i === paras.length - 1 ? TN_CLOSE : ''), w, first, runover).map((l) => l.replace(/\s+$/, '')));
    });
    return out;
  }
  const tnc = tnContent(block);
  const split = tnPrefixSplit(block, tnc);
  if (split) {
    const both = TN_OPEN + segmentsToBraille(split.pre, o).trim() + TN_CLOSE + ' ' + segmentsToBraille(split.rest, o).trim();
    const { first: f1, runover: r1 } = tnMargins(o);
    return wrapCells(both, w, f1, r1).map((l) => l.replace(/\s+$/, ''));
  }
  const inner = segmentsToBraille(tnc.segs, o).trim();
  if (!inner) return [];
  // F-164: one paragraph of an editor-side multi-paragraph note (block.tnPart, set by the
  // editor's buildModel): @.< only on the first, @.> only on the last.
  const formatted = (block.tnPart === 'mid' || block.tnPart === 'last' ? '' : TN_OPEN) + inner + (block.tnPart === 'mid' || block.tnPart === 'first' ? '' : TN_CLOSE);   // indicators are BRF, added after translation
  // BANA 10.9.2b: a column heading the transcriber supplies in TN indicators (optional `cell5` flag on the
  // note) is a cell-5 heading: 5-5 margins, a blank line before it, and the list under it follows directly.
  const c5 = !!block.cell5 && o.mode === 'bana';
  const { first, runover } = c5 ? { first: 4, runover: 4 } : tnMargins(o);
  const nl = wrapCells(formatted, w, first, runover).map((l) => l.replace(/\s+$/, ''));
  return c5 ? ['', ...nl] : nl;
}

// Transcriber's Notes PAGE (block `tnpage`, BANA Formats 2.6.1) — a NEW renderer, deliberately not
// formatTranscriberNote: 2.6.1b "Transcribe all notes as 3-1 paragraphs. Do not use the
// transcriber's note indicators." so no @.< @.> and no 7-5 margins. 2.6.1a: TRANSCRIBER'S NOTES is
// a centred heading on the first line. Block model: { type:'tnpage', heading?, entries:[{ text |
// segments, paragraphs?:[{text|segments}] }], matter:'transcriber' }. Each entry (and each of its
// paragraphs) is one 3-1 paragraph; 3-1 paragraphs carry no blank line between them (gold: Sample
// 2-21 Transcriber's Notes). One blank line follows the heading (same gold). The page's own braille
// page number (t1, t2 ...) is added by the page builder (applyTranscriberPageSeries), and the block is
// forced onto a fresh page and followed by a break (forcedPageBreakBlocks). Multi-volume BANA (KD round 2
// Q7d, 28 Sep 2026): the SAME block/content repeats in every volume (formatVolumesFromBuild's BANA
// branch) — 2.6.1 is itself volume-scoped wording ("...throughout the volume"), and unlike sympage there
// is no per-volume derivation to redo (entries are always author-provided text, not collected from the
// document). Multi-volume UKAAF: UNCHANGED — this block (there, "Note to Braille Edition", UK-8) still
// rides with volume 1 only, as before this brief; left alone deliberately (this file's report). Mirrored
// in traceBlock (A39) and keyed in getBlockSignature.
const TNPAGE_HEADING = "TRANSCRIBER\u2019S NOTES";
// UK-8 (28 Sep, James via Paul): "Special Symbols / Transcriber's Notes pages" are "a BANA convention,
// not used in the UK"; the UK equivalent is a "Note to Braille Edition", "entirely at the transcriber's
// discretion". Emboss keeps using the SAME tnpage block/formatter for it (no new block type) \u2014 only the
// default heading differs by mode, exactly as an explicit block.heading already overrides either default.
const TNPAGE_HEADING_UKAAF = 'NOTE TO BRAILLE EDITION';
const tnpageHeading = (block, o) => (String(block.heading ?? '').trim() || (o && !isBanaOpts(o) ? TNPAGE_HEADING_UKAAF : TNPAGE_HEADING));
function tnpageParas(block) {
  const out = [];
  for (const e of Array.isArray(block.entries) ? block.entries : []) {
    if (!e || typeof e !== 'object') continue;
    const own = e.segments ? { segments: e.segments } : { text: e.text };
    const hasOwn = e.segments ? e.segments.length : String(e.text ?? '').trim();
    if (hasOwn) out.push(own);
    for (const pp of Array.isArray(e.paragraphs) ? e.paragraphs : []) {
      if (pp && typeof pp === 'object' && (pp.segments ? pp.segments.length : String(pp.text ?? '').trim())) out.push(pp.segments ? { segments: pp.segments } : { text: pp.text });
    }
  }
  return out;
}
function formatTnPage(block, o) {
  const w = o.width || 38;
  const out = [...centredHeadingBlock(o.translate(tnpageHeading(block, o)), w, Math.max(1, w - 6)).map((l) => l.replace(/\s+$/, '')), ''];
  for (const pp of tnpageParas(block)) {
    const braille = pp.segments ? segmentsToBraille(pp.segments, segsWhollyUncontracted(pp.segments) ? g1Quiet(o) : o) : o.translate(String(pp.text));
    out.push(...wrapCells(braille, w, 2, 0).map((l) => l.replace(/\s+$/, '')));
  }
  return out;
}

// Special Symbols PAGE (block `sympage`, BANA Formats 2.5) — G8 stage 5. 2.5.2a: "Place SPECIAL SYMBOLS USED IN
// THIS VOLUME as a centered heading on lines 1 and 2" (centredHeadingBlock breaks it over two lines, as the
// Sample 2-21 gold shows; a following blank line, as on the TN page). 2.5.2c: "List all symbols using 1-3
// margins. Precede each symbol with the dot locator for 'mention' (.=), which should be the first symbol listed."
// 2.5.2d: symbol, a space, its meaning beginning with a capital letter. 2.5.2e: braille order
// (collectSpecialSymbols). One entry per line, runover at cell 3. 2.5.2b: the heading is not repeated on later
// Special Symbols pages (a long list runs on with no heading; nothing to do: the heading is only in this block).
// Block model: { type:'sympage', matter:'transcriber', heading?, entries?:[{ braille, print?, description? }],
// auto?:true }. `braille` is the symbol's cells (ASCII braille) and may be '' for the dot locator itself, which
// is listed as ".= Dot locator, ...". An explicit non-empty `entries` wins (the 'edited page' case); with
// `auto:true` or no `entries` the page is derived from collectSpecialSymbols over the whole document
// (resolveSymPages, run once before formatting): dot locator first, then the symbols in braille order. A document
// with no symbol and nothing explicit gets a dormant block (no `matter`, formats to nothing, forces no page).
// Numbered t1, t2 ... and forced onto its own page by the transcriber-matter machinery (2.2.1a/b), and ordered
// BEFORE any tnpage (2.2.1: Title page, Second title page, Special Symbols, Transcriber's Notes). Multi-volume
// BANA (KD round 2 Q7d, 28 Sep 2026 — was an open question, now answered): the page repeats in EVERY volume,
// each one scoped to that volume's own symbols (2.5.1), NOT the whole-document entries resolveSymPages put on
// this block — formatVolumesFromBuild's BANA branch re-derives it per volume (renderTranscriberMatterPages,
// blocksForOrigPages), falling back to this block's entries verbatim only when they were hand-edited (not
// auto), since Emboss cannot then tell which lines belong to which volume. UKAAF B004 has no such page; the
// same layout is used. Mirrored in traceBlock (A39) and keyed in getBlockSignature.
const SYMPAGE_HEADING = 'SPECIAL SYMBOLS USED IN THIS VOLUME';
const SYMPAGE_DOT_LOCATOR = { print: '.=', braille: '', description: 'Dot locator, precedes listed symbols' };
// PROVISIONAL wording (no transcriber-approved names yet; plain descriptive text, see the round-2 question file).
// Names as KD writes them on the Special Symbols page (round 2, Q7b, 28 Sep 2026): the shape alone, without "bullet".
const SYMBOL_MEANINGS = { '•': 'Bullet', '□': 'Hollow square', '■': 'Solid square', '○': 'Hollow circle', '◦': 'Hollow circle',
  '▪': 'Solid square', '▲': 'Triangle', '√': 'Checkmark', '✓': 'Checkmark', '✔': 'Checkmark' };
const symbolMeaning = (e) => {
  if (e && typeof e.description === 'string' && e.description.trim()) return e.description.trim();
  if (e && SYMBOL_MEANINGS[e.print]) return SYMBOL_MEANINGS[e.print];
  if (e && e.name) return `${e.name.charAt(0).toUpperCase()}${e.name.slice(1)} bullet`;
  const t = String(e?.print ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};
const sympageHeading = (block) => (String(block.heading ?? '').trim() || SYMPAGE_HEADING);
const sympageEntries = (block) => (Array.isArray(block.entries) ? block.entries.filter((e) => e && typeof e === 'object' && !Array.isArray(e)) : []);
function symbolListLine(e, o) {
  const d = symbolMeaning(e);
  return { sym: '.=' + String(e.braille ?? '').trim(), desc: d };
}
function formatSymPage(block, o) {
  if (block.dormant || !sympageEntries(block).length) return [];
  const w = o.width || 38;
  const out = [...centredHeadingBlock(o.translate(sympageHeading(block)), w, Math.max(1, w - 6)).map((l) => l.replace(/\s+$/, '')), ''];
  for (const e of sympageEntries(block)) {
    const { sym, desc } = symbolListLine(e, o);
    const text = sym + (desc ? ' ' + o.translate(desc) : '');
    out.push(...wrapCells(text, w, 0, 2).map((l) => l.replace(/\s+$/, '')));
  }
  return out;
}
// Resolve every `sympage` before formatting (see the block comment above). Indices are preserved (an unused
// auto page becomes a dormant block rather than being removed); a sympage that follows a tnpage swaps places
// with the first tnpage so the Special Symbols page comes first (BANA 2.2.1).
function resolveSymPages(blocks, o) {
  if (!Array.isArray(blocks) || !blocks.some((b) => b && b.type === 'sympage')) return blocks;
  const rest = blocks.filter((b) => !(b && b.type === 'sympage'));
  let derived = null;
  let out = blocks.map((b) => {
    if (!b || b.type !== 'sympage' || b.dormant) return b;
    if (sympageEntries(b).length) return b;
    if (Array.isArray(b.entries) && b.auto !== true) return { type: 'sympage', dormant: true };
    if (!derived) derived = collectSpecialSymbols(rest, o);
    if (!derived.length) return { type: 'sympage', dormant: true };
    return { ...b, entries: [SYMPAGE_DOT_LOCATOR, ...derived.map((d) => ({ print: d.print, braille: d.braille, description: symbolMeaning(d) }))] };
  });
  const ti = out.findIndex((b) => b && b.type === 'tnpage');
  const si = out.findIndex((b) => b && b.type === 'sympage' && !b.dormant);
  if (ti >= 0 && si > ti) { out = out.slice(); [out[ti], out[si]] = [out[si], out[ti]]; }
  return out;
}

// ---- Title Page (block `titlepage`, BANA Formats 2016 §2.3, K29 Stage 1b) ----
// Block model: { type:'titlepage', matter:'transcriber', <book-detail fields, see titlePageFieldsFrom>,
// volume, volumeOf, braillePages, printPages (per-volume fields — not stored on the document; set on the
// block COPY that resolveTitlePage/formatVolumes build for each format pass; see their own comments for
// exactly where each value comes from) }. Design doc §4/§5 row "1b Title Page formatter".
// Five segments, in BANA 2.3.3a's fixed order: Title, Author, Publisher and Copyright, Transcriber, Volume
// Information. Each segment is a list of "logical lines" — a line is dropped entirely when any of its
// fields is empty (design §3.1's line-dropping rule: "Transcription of {isbn}" with no ISBN, "Proofread by"
// with no proofreader, etc.); a logical line may itself wrap to more than one physical line (1-3 margins,
// 2.3.3c). No blank line is ever placed WITHIN a segment (2.3.3d) — only whole logical lines are dropped.

// doc (or a doc-like plain object: title/metadata/tp* fields, as field-registry.mjs's titlepageBookDetails
// and TP_KEYS expect) -> plain field values, refreshed on every format (TP-6: fields are always live, even
// on an otherwise-edited page — Stage 1b has no "edited page" concept yet, that is Stage 1c). No per-volume
// fields here (volume/volumeOf/braillePages/printPages): those are computed after pagination and merged
// onto the block copy separately (see buildDocPages's title-page pass and formatVolumes, below).
function titlePageFieldsFrom(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const details = titlepageBookDetails(d);
  const authors = Array.isArray(details.authors.value) ? details.authors.value.filter((a) => String(a || '').trim()) : [];
  const editors = Array.isArray(d.tpEditors) ? d.tpEditors.filter((a) => String(a || '').trim()) : [];
  const country = d.tpCountry || null;
  let reproductionNotice = typeof d.tpReproductionNotice === 'string' && d.tpReproductionNotice.trim() ? d.tpReproductionNotice.trim() : '';
  if (!reproductionNotice) {
    // TP-7/P3: editable with a warning, never locked — this is only the DEFAULT offered when the
    // transcriber has not typed one of their own. Canada's own statement belongs on the second title
    // page (2.3.6e(2), design §1), out of Stage 1's scope (no second title page yet): none here.
    if (country === 'US') reproductionNotice = REPRODUCTION_NOTICES.US;
    // TP-8/P4: UKAAF draft, unverified by a UK producer (docs/ukaaf-title-page-draft.md) — see this
    // file's report for the still-open page-number question this leaves for UKAAF.
    else if (country === 'UK') reproductionNotice = ukAccessibleCopyStatement({ title: d.title, authors });
  }
  const publishedByWord = d.tpPublishedBy === 'permission' ? 'With permission of the publisher'
    : d.tpPublishedBy === 'published' ? 'Published by' : '';
  return {
    title: String(d.title || '').trim(),
    series: String(d.tpSeries || '').trim(),
    gradeLevel: String(d.tpGradeLevel || '').trim(),
    subtitle: String(d.tpSubtitle || '').trim(),
    edition: String(d.tpEdition || '').trim(),
    authors,
    translator: String(d.tpTranslator || '').trim(),
    editors,
    publishedBy: publishedByWord,
    publisher: String(details.publisher.value || '').trim(),
    publisherCity: String(d.tpPublisherCity || '').trim(),
    publisherUrl: String(d.tpPublisherUrl || '').trim(),
    copyright: String(details.copyright.value || '').trim(),
    reproductionNotice,
    isbn: Array.isArray(details.isbn.value) ? details.isbn.value.filter((s) => String(s || '').trim()) : [],
    printingHistory: String(d.tpPrintingHistory || '').trim(),
    // BANA 2.3.7: the year the page is created, when none is typed (design §3.1 "this year" default).
    transcriptionYear: String(d.tpYear || '').trim() || String(new Date().getFullYear()),
    brailleCode: 'Unified English Braille',   // computed (tpBrailleCode, field-registry.mjs): the only braille code Emboss offers today
    transcriber: String(d.tpTranscriber || '').trim(),
    proofreader: String(d.tpProofreader || '').trim(),
    tactileSpecialist: String(d.tpTactileSpecialist || '').trim(),
    agency: String(d.tpAgency || '').trim(),
    agencyLocation: String(d.tpAgencyLocation || '').trim(),
    // customBraille (2.3.8b, "Uncontracted" for a grade-1 volume): Emboss has no whole-document/whole-
    // volume grade-1 setting to read this from today (open item, this file's report) — always blank.
    customBraille: '',
    // UK-9: UKAAF's "publisher (and year if present)" line. Emboss has no dedicated "publication year"
    // book-detail field (BANA's tpYear is the year TRANSCRIBED, a different thing — 2.3.7 — and would be
    // the wrong default here); the document's own imported date (dc:Date -> metadata.date) is the one
    // "publication year" signal Emboss already captures, so that is read here, first 4-digit run found.
    // Unused in BANA mode (field-registry.mjs's titlePageTemplateSegments has no BANA line for it).
    publicationYear: (/\b(\d{4})\b/.exec(String(d.metadata?.date || '')) || [])[1] || '',
  };
}
const tpText = (s) => [{ type: 'text', text: String(s) }];
// A "logical line" is a segments array (the same shape segmentsToBraille/tcSegs already take); most are a
// single plain-text run, but the "et al." line (2.3.5e) mixes a plain run with an uncontracted tail — the
// grade-1 word indicator BANA requires before "al" (uncontractedLineBraille already adds it, mirrored by
// tcJoined's own `g.uncontracted` branch, so this is the only place that needs to know about it).
// 2.3.4a (errata order) / c: title, series, grade level, subtitle, edition, each its own line when there
// is room (built inline in traceTitlePage, which needs the plain strings for tpPackTitleItems below —
// not this module's usual segments-array shape). Packing (errata 2.3.4d, joining neighbours with
// semicolons on overflow) is applied there too, only if the unpacked page does not fit.
// Join adjacent title items with '; ' from the end inward (grade level, usually last, "joins the line
// before it when there is room", 2.3.4g) until the page fits or one item remains. `items` are the plain
// strings behind tpTitleSegLines (order preserved); returns the same shape, packed by one more step.
function tpPackTitleItems(items) {
  if (items.length < 2) return items;
  return [...items.slice(0, -2), `${items[items.length - 2]}; ${items[items.length - 1]}`];
}
// K29 Stage 1c rework (Fable review): the Author/Publisher/Transcriber/Volume line-composition rules
// that used to live here (tpAuthorSegLines/tpPublisherSegLines/tpTranscriberSegLines/tpVolumeSegLines)
// are GONE — they are now field-registry.mjs's titlePageTemplateSegments, the ONE template the editor
// card and this formatter both consume (see traceTitlePage's own comment for how). Only the Title
// segment's line-BUILDING stays inline below (titleTagged, in traceTitlePage): it is inseparable from
// the page-FIT decisions (2.3.4d packing, 2.3.4g grade-level joining) that only make sense here.

// "and"-joined range text, BANA 2.3.8c/d style: "t1-t4, p1-p29, and 1-116" (Oxford comma only from three
// parts on; exactly two parts join with a plain "and", matching Sample 2-9's "i-xx and 1-a65").
function tpJoinRangeParts(parts) {
  const p = parts.filter(Boolean);
  if (!p.length) return '';
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return `${p.slice(0, -1).join(', ')}, and ${p[p.length - 1]}`;
}
function tpRangeLabel(prefix, count) {
  if (!count) return '';
  return count === 1 ? `${prefix}1` : `${prefix}1-${prefix}${count}`;
}
// BANA 2.3.8c: "Braille pages t1-t4, p1-p29, and 1-116" from this volume's own page counts.
function tpBraillePagesRange(tCount, pCount, bodyCount) {
  return tpJoinRangeParts([tpRangeLabel('t', tCount), tpRangeLabel('p', pCount), tpRangeLabel('', bodyCount)]);
}
// BANA 2.3.8c/d: "Print pages i-x and 1-44" from the print-page labels (plain text, e.g. "i", "44") that
// fall within a range of `content` line indices, grouped into runs of the same numbering style (roman vs
// arabic) and joined. NOT modelled here (open item, this file's report): continuation letters and
// transposed/repeated print pages (2.3.8d) — each page contributes its own label once, first-seen order.
const TP_ROMAN_RE = /^[ivxlcdm]+$/i;
function tpPrintPageRange(blocks, content, contentBlock, lineFrom, lineTo) {
  const labels = [];
  const seenBlocks = new Set();
  for (let i = Math.max(0, lineFrom); i < Math.min(content.length, lineTo); i++) {
    const bi = contentBlock[i];
    if (bi == null || bi < 0 || seenBlocks.has(bi)) continue;
    const blk = blocks[bi];
    if (!blk || blk.type !== 'pagenum') continue;
    const label = String(blk.page ?? blk.text ?? '').trim();
    if (!label) continue;
    seenBlocks.add(bi);
    labels.push(label);
  }
  if (!labels.length) return '';
  const groups = [];
  for (const l of labels) {
    const style = TP_ROMAN_RE.test(l) ? 'roman' : 'arabic';
    const g = groups[groups.length - 1];
    if (g && g.style === style) g.last = l; else groups.push({ style, first: l, last: l });
  }
  return tpJoinRangeParts(groups.map((g) => (g.first === g.last ? g.first : `${g.first}-${g.last}`)));
}
// The complete, standalone physical page for a resolved titlepage block (fields already merged by
// resolveTitlePage/caller) — traceTitlePage's own content, full depth, PLUS (UKAAF only) the ordinary
// line-1 braille-page-number line that block deliberately leaves for its caller to add (its own comment
// explains why: BANA already has the number merged into its last content line, UKAAF does not).
// UK-9 (28 Sep): "Page number 1, in Arabic. All braille page numbers are Arabic and restart at 1 in
// each volume" — James's answer to "2a Title page number". Unlike BANA's t1 (a SEPARATE braille-page
// series, 2.2.1b, that never collides with the book's own page 1), B004 has no such series (see this
// file's report): the title page is plain braille page 1, brailleNumber(1), not seriesPageNumber
// ('transcriber', 1). Known limitation, reported rather than fixed here (out of this brief's scope,
// which is the title page's own code, not buildDocPages'/assemble()'s pagination): the body content
// that follows is not aware a title page (or its notice page, see assembleUkTitleNoticePage) claimed
// pages 1(-2) first, so it still starts its own numbering at plain page 1 too, in UKAAF mode.
// CONFIRMED (28 Sep, real UKAAF-produced BRFs supplied after the above was written —
// references/ukaaf/home-nation-languages.brf and foreign-language-guidelines-28x27.brf, both
// producer output, not Emboss's own): page 1 of each is exactly "#A" alone on line 1, an EMPTY line
// 2, then the centred title block starting line 3 — traceTitlePage's own budget (below) is reduced by
// one further line for UKAAF to leave room for it.
function assembleTitlePage(block, o) {
  const contentLines = traceBlockCore(block, o, true).map((t) => t.s);
  if (isBanaOpts(o) || o.suppressHeader || o.pageHeaders === false) return contentLines;
  const w = o.width || 38;
  return [rightJustify(brailleNumber(1), w), '', ...contentLines];
}
// UK-9: "The accessible-copy copy notice goes on the page after the title page, as in print." A second,
// plain standalone page — braille page 2 (Arabic, see assembleTitlePage's own comment) — carrying just
// the notice text (field-registry.mjs's ukAccessibleCopyStatement, or the transcriber's own typed
// tpReproductionNotice, whichever titlePageFieldsFrom already resolved onto the block). PROVISIONAL,
// like the rest of UK-9: no RNIB Braillists' Manual seen, and B004 gives no placement/format rule for
// this page beyond "as in print" — a plain 1-1 paragraph, wrapped to the page width, was chosen as the
// simplest sensible reading; the page number shares line 1 (B004 §7 top-right), matching the title
// page's own line-1 convention.
function assembleUkTitleNoticePage(noticeText, o) {
  const w = o.width || 38;
  const num = rightJustify(brailleNumber(2), w);
  const body = wrapCells(o.translate(String(noticeText || '')), w, 0, 0).map((l) => l.replace(/\s+$/, ''));
  return [num, ...body];
}
// This brief (UK-9 follow-up, continuous UKAAF numbering): the title page plus, for UKAAF, its
// accessible-copy notice page — the SAME pair buildStandaloneTitlePage already builds for the
// whole-document/single-volume case, factored out here so formatVolumesFromBuild's own per-volume title
// page (previously built with a bare assembleTitlePage call, no notice page at all) can share it. Always
// 1 page for BANA (title only, its own t1), always 2 for UKAAF (title + notice, pages 1-2 of that
// volume) — see assembleUkTitleNoticePage's/buildStandaloneTitlePage's own comments for why the notice
// has no BANA equivalent and is unconditional (not gated on tpCountry) once in UKAAF mode.
function assembleTitleAndNotice(full, o) {
  const titlePage = assembleTitlePage(full, o);
  if (!isBanaOpts(o)) {
    const notice = String(full.reproductionNotice || '').trim() || ukAccessibleCopyStatement({ title: full.title, authors: full.authors });
    return [titlePage, assembleUkTitleNoticePage(notice, o)];
  }
  return [titlePage];
}
// Build the WHOLE-DOCUMENT title page (volume=1/volumeOf=1, or whatever the block already carries) from a
// buildDocPages/buildDocPagesAsync call's own results, called AFTER pagination so the per-volume fields
// (design §3.1) are known: `kinds` (tSeries.kinds — 'transcriber'/'body' per body page, excluding the
// title page itself, which the content loop never adds a page for) gives braille-page counts, `tocPages`
// gives the front-matter count, `content`/`contentBlock` give the print-page labels. Returns an ARRAY of
// one or more standalone pages (UK-9: UKAAF gets a second page, the accessible-copy notice — see this
// function's own UK-9 comment below), or null when the document has no titlepage block (every other
// document: this is never called at all — see its call site).
// Fable review (26 Sep, single-volume regression): `kinds` is null whenever applyTranscriberPageSeries
// itself returned null — which it does for the ordinary case of a titlepage block with NO OTHER
// transcriber-matter block (no Special Symbols/Transcriber's Notes page): every body page is then plain
// 'body', so there is nothing to count in `kinds`, but that is not the same as there being no BODY pages —
// `bodyPageCount` (the whole document's own final body-page count, `tSeries ? tSeries.pages.length :
// bodyPages.length` at the call site) is the correct count either way and is what is used whenever `kinds`
// itself is absent.
function buildStandaloneTitlePage(blocks, o, kinds, tocPages, content, contentBlock, bodyPageCount) {
  const block = blocks.find((b) => b && typeof b === 'object' && b.type === 'titlepage');
  if (!block) return null;
  const k = Array.isArray(kinds) ? kinds : null;
  const tCount = (k ? k.filter((x) => x === 'transcriber').length : 0) + 1;   // +1: the title page itself, never counted in `kinds` (see above)
  const pCount = Array.isArray(tocPages) ? tocPages.length : 0;
  const bodyCount = k ? k.filter((x) => x === 'body').length : (Number(bodyPageCount) || 0);
  const braillePages = tpBraillePagesRange(tCount, pCount, bodyCount);
  const printPages = tpPrintPageRange(blocks, content || [], contentBlock || [], 0, (content || []).length);
  const volume = block.volume ?? 1, volumeOf = block.volumeOf ?? 1;
  const full = { ...block, volume, volumeOf, volumeLabel: block.volumeLabel ?? `Volume ${volume}`, braillePages, printPages };
  // UK-9: an ARRAY of standalone pages, not one — UKAAF always gets a second page straight after the
  // title page for the accessible-copy notice (assembleUkTitleNoticePage's own comment). The notice
  // falls back to ukAccessibleCopyStatement here (not just titlePageFieldsFrom's tpCountry==='UK'
  // gate) so a UKAAF-mode document gets a sensible default notice even when tpCountry was never set —
  // tpCountry/reproductionNotice was designed around BANA's US/Canada choice, a different axis from the
  // document's own FORMAT mode, which is what actually decides whether this page exists at all.
  // (assembleTitleAndNotice, above, is the shared implementation — formatVolumesFromBuild's own
  // per-volume title page now goes through the same function, this brief.)
  return assembleTitleAndNotice(full, o);
}
// Multi-volume only (formatVolumes/formatVolumesAsync): each volume's OWN print-page range, read from its
// already-rendered pages' running heads rather than from content/pagenum blocks (which a volume's own
// chunk no longer conveniently exposes once split — see formatVolumes' own comment). Reliable for the
// ordinary case: an arabic print-page number is always written through brailleNumber/formatPrintPageHeader
// and decoded back here exactly (tpDecodeBrailleNumber is its exact inverse). NOT modelled here (open
// item, this file's report, same limitation tpPrintPageRange itself already carries): continuation letters
// (`m[1]` below, a repeated/transposed print page, 2.3.8d) and roman-numeral or other non-arabic print-page
// labels, both skipped rather than guessed at; only the first and last plain arabic label found are used,
// so an internal gap or a UKAAF page (open number-placement question, this file's report) is not shown.
const TP_NUMDIGITS = 'ABCDEFGHIJ';   // mirrors page.mjs's own NUMDIGITS — brailleNumber's exact inverse
function tpDecodeBrailleNumber(s) {
  const m = /^#([A-J]+)$/.exec(s);
  if (!m) return null;
  return String(Number(m[1].split('').map((c) => String((TP_NUMDIGITS.indexOf(c) + 1) % 10)).join('')));
}
function tpPrintPageRangeFromPages(pages) {
  const labels = [];
  for (const pg of Array.isArray(pages) ? pages : []) {
    if (!Array.isArray(pg) || !pg.length) continue;
    const head = String(pg[0] || '').replace(/\s+$/, '');
    const m = /(?:^|\s)([A-Z]*)(#[A-J]+)$/.exec(head);
    if (!m || m[1]) continue;
    const n = tpDecodeBrailleNumber(m[2]);
    if (n != null) labels.push(n);
  }
  if (!labels.length) return '';
  const first = labels[0], last = labels[labels.length - 1];
  return first === last ? first : `${first}-${last}`;
}
// Resolve the (at most one, design §3.4) `titlepage` block before formatting, like resolveSymPages: merges
// the document's book-detail fields onto it (TP-6: always live) while keeping whatever per-volume fields
// (volume/volumeOf/braillePages/printPages) the caller already set on the block — buildStandaloneTitlePage
// for a single document, formatVolumesFromBuild for a multi-volume split; both default to volume=1/
// volumeOf=1 when unset, so a direct formatBlock/traceBlock call on a raw `{type:'titlepage'}` block still
// renders sensibly. `matter:'transcriber'` is set for consistency with tnpage/sympage (BANA 2.2.1) and in
// case something else keys off blockMatter, but — unlike them — this block is skipped entirely by the
// ordinary content loop and rendered standalone instead (see traceTitlePage's own comment for why), so it
// is always first regardless of its position among blocks: no swap is needed here the way resolveSymPages
// needs one for sympage/tnpage.
function resolveTitlePage(blocks, doc, o) {
  if (!Array.isArray(blocks) || !blocks.some((b) => b && b.type === 'titlepage')) return blocks;
  const ti = blocks.findIndex((b) => b && b.type === 'titlepage');
  const fields = titlePageFieldsFrom(doc);
  return blocks.map((b, i) => {
    if (i !== ti) return b;
    const volume = b.volume ?? 1, volumeOf = b.volumeOf ?? 1;
    return { ...b, type: 'titlepage', matter: 'transcriber', ...fields,
      volume, volumeOf, volumeLabel: b.volumeLabel ?? `Volume ${volume}`,
      braillePages: b.braillePages ?? '', printPages: b.printPages ?? '' };
  });
}
// The title page's own content (BANA 2.3.3, K29 Stage 1b): segments in order, 1-3 margins, no blank line
// within a segment (2.3.3d), blank lines spread as evenly as possible between segments (2.3.3e), text on
// line 1 and the last line (2.3.3b) — the braille page number shares that last line (always t1 within its
// own volume, BANA 2.2.1c). errata 2.3.4d title-segment packing is tried first when the page does not fit
// unpacked, and a page that still overflows is truncated with a transcription warning
// ('titlepage-overflow') rather than spilling onto a second page (design §4: stage 2 is where overflow gets
// a real home, a second title page). A39/"one layout path": this is the ONLY implementation — formatBlock's
// 'titlepage' case is a plain projection of it (traceBlockCore(block,o,atStart).map(t=>t.s)), like pagenum/
// math/graphic/break/indicator/blank.
//
// Fable review (26 Sep, comparison against gold Sample 2-21): the title page must use the FULL page depth
// — 2.3.3e and Samples 2-9/2-21 both put text on line 1 AND on line 25 (or whatever `depth` is), not a
// 23-line budget with a reserved (and then dropped) running head and footer. Reserving no room for either
// is only possible because this block is never laid out through the shared per-document content/assemble()
// pipeline that every OTHER block shares (perPage there is a single number that must be right for every
// page in the whole document, so it cannot special-case one page's budget without risking every other
// page). Instead the title page is rendered standalone — buildStandaloneTitlePage/assembleTitlePage, called
// from buildDocPages/buildDocPagesAsync/formatVolumesFromBuild — and its own block is skipped entirely by
// the ordinary content loop (a `continue` right where every other block is read, so it contributes zero
// lines and zero page-break side effects there: confined to the title page's own page, exactly as asked).
// A direct formatBlock/traceBlock call on a raw titlepage block (this function) still renders the FULL
// page on its own — BANA gets the whole `depth` lines (no running head reserved: 2.2.1a, transcriber pages
// carry no print page numbers; its own number instead shares the last text line, computed here); UKAAF
// keeps depth-1, because assembleTitlePage's own wrapper adds the ordinary line-1 number for that mode (its
// exact placement on a title page is still an open question, this file's report).
// K29 Stage 1c rework: a shared-template "part" ({lit} or {fld,idx?,value}) -> the plain segments-array
// shape wrapLine (traceTitlePage, below) already expects; a `line.etAl`/`line.cell3` flag becomes the
// SAME special-case markers (__etAl / a `.cell3` property tacked onto the returned segs) that
// traceTitlePage's own wrapLine has taken since Stage 1b, so wrapLine itself needed no change at all.
function tpLineToSegs(line) {
  if (line.etAl) return { __etAl: true, first: line.parts[0].value };
  const segs = line.parts.map((p) => ({ type: 'text', text: 'fld' in p ? String(p.value ?? '') : String(p.lit ?? '') }));
  if (line.cell3) segs.cell3 = true;
  return segs;
}
function traceTitlePage(block, o, atStart, unit = 0) {
  // Defensive defaults: resolveTitlePage always sets these (authors/editors/isbn as arrays; volume/
  // volumeOf as numbers), but formatBlock/traceBlock may be called directly on a hand-built block (a
  // test, or a future editor preview) that skips it — this keeps that a sensible render, not a crash.
  block = { authors: [], editors: [], isbn: [], volume: 1, volumeOf: 1, ...block };
  const w = o.width || 40, depth = o.depth || 25;
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const isBana = isBanaOpts(o);
  // UK-9 CONFIRMED (28 Sep, real UKAAF BRFs — see assembleTitlePage's own comment): line 1 is the page
  // number, line 2 is BLANK, content starts line 3 — two lines reserved off the TOP for UKAAF, not one
  // (assembleTitlePage adds both the number line and the blank line itself; this budget leaves room for
  // both). BANA is unaffected (still just `depth`, the number shares the LAST content line instead).
  const perPage = Math.max(1, hideHeader ? depth : (isBana ? depth : depth - 2));
  // BANA 2.3.3b's "shares the last line" is a BANA-only rule (Samples 2-9/2-21 are both BANA). UKAAF's own
  // convention already puts every page's braille number on line 1 (B004 §7) — assembleTitlePage adds that
  // line itself (this function's own budget already leaves room for it).
  const numbered = !hideHeader && isBana;
  const pageNumText = numbered ? seriesPageNumber('transcriber', 1) : '';
  // UK-9: one line reserved off the bottom of a UKAAF page for the end marker (indicatorLine('colons',
  // ...), James's "at the end of the book, and on the title page"). CONFIRMED placement, no blank line
  // before it (28 Sep, real UKAAF BRF: references/ukaaf/foreign-language-guidelines-28x27.brf page 2 —
  // the colons marker sits directly under the last Contents entry, no gap, closing that list before the
  // Introduction; not a title page in that BRF, but the best real evidence found for the marker's own
  // spacing, so it supersedes this file's earlier "after a blank line" guess). BANA reserves nothing here
  // (footerLines 0, contentBudget === perPage): this changes NOTHING for BANA. Also nothing when headers/
  // furniture are suppressed (hideHeader) — matches the `numbered`/pageNumText line above, which is
  // skipped the same way, and keeps a suppressed-header render's budget the full `depth` either way.
  const footerLines = (!isBana && !hideHeader) ? 1 : 0;
  const contentBudget = Math.max(1, perPage - footerLines);

  let u = unit;
  // mirror tcCell (F-16): a plain single run goes through tcRun (which falls back to o.translate with no
  // o.translatePos — every headless test, gold and formatDocument). The "et al." line (2.3.5e, tagged
  // `etAl` by the shared template, field-registry.mjs's titlePageTemplateSegments) is built by hand for
  // the same reason: tcJoined's plain-run branch has no no-positions fallback, only its uncontracted-run
  // branch (uncontractedLineBraille) does not need one.
  // UK-9: "Layout: centred lines, since UK title pages are usually centred" (James: "varies with code,
  // spacing and paper" — no fixed rule given). BANA keeps its own 1-3-margin wrap exactly as before
  // (`cell3` only ever means anything there, BANA's ISBN-list indent, 2.3.6f); UKAAF instead centres
  // each wrapped line (tcCentredBlock, the traced mirror of centredBlock — same as a centred heading).
  const wrapLine = (segs, cell3) => {
    let tr;
    if (segs && segs.__etAl) {
      const plain = tcRun(o, `${segs.first} et `, null, u, 0);
      const tail = uncontractedLineBraille('al.', null, o);
      tr = { s: plain.s + tail, src: [...plain.src, ...Array(tail.length).fill(null)] };
    } else {
      tr = segsAreRich(segs, o) ? tcRstrip(tcJoined(o, [{ segs, unit: u }])) : tcRun(o, segs.map((g) => g.text || '').join(''), null, u, 0);
    }
    u++;
    return isBana ? tcWrap(o, tr, w, cell3 ? 2 : 0, 2) : tcCentredBlock(o, tr, w, w);
  };

  // K29 Stage 1c rework (Fable review): "an edited page's wording is what the transcriber wants
  // brailled" (TP-6) — an edited page (block.segments, no block.auto) lays out EXACTLY its own saved
  // lines, in their own saved order, with only the field VALUES refreshed live (refreshTitlePageValues
  // — TP-6 "fields stay live" applies just as much to an edited page). No packing/grade-level-joining
  // is attempted on a hand-arranged page (that would silently reword what the transcriber typed); a
  // page that does not fit is truncated with the same 'titlepage-overflow' warning as an auto page.
  // An auto (untouched) page instead uses field-registry.mjs's titlePageTemplateSegments — the SAME
  // template the editor card renders — for its Author/Publisher/Transcriber/Volume segments, and BANA
  // 2.3.4d/g's page-fit-only rewording (title/grade-level packing) for its Title segment, exactly as
  // Stage 1b did (unchanged: `block` already carries `title`/`series`/… flat, via resolveTitlePage's
  // merge of titlePageFieldsFrom(doc), which titlePageTemplateSegments(block, block) also reads).
  const edited = block.auto !== true && Array.isArray(block.segments) && block.segments.length > 0;
  let flat, warnOverflow = false;

  if (edited) {
    const segments = refreshTitlePageValues(block.segments, block, block);
    flat = [];
    segments.forEach((seg, si) => {
      for (const line of (seg.lines || [])) for (const l of wrapLine(tpLineToSegs(line), line.cell3)) flat.push({ seg: si, line: l });
    });
    if (flat.length > contentBudget) { warnOverflow = true; flat = flat.slice(0, contentBudget); }
  } else if (!isBana) {
    // UK-9: UKAAF's own, much simpler template (ukTitlePageSegments, field-registry.mjs) — no title-
    // segment packing/et al./ISBN cell-3 (none of BANA's 2.3.4/2.3.5/2.3.6f machinery applies: UKAAF's
    // template has no series/grade/edition/translator/ISBN lines to pack or indent in the first place),
    // so every segment is laid out the SAME generic way, unlike BANA's title-segment special case below.
    const template = titlePageTemplateSegments(block, block, 'ukaaf');
    flat = [];
    template.forEach((seg, si) => { for (const line of seg.lines) for (const l of wrapLine(tpLineToSegs(line), line.cell3)) flat.push({ seg: si, line: l }); });
    if (flat.length > contentBudget) { warnOverflow = true; flat = flat.slice(0, contentBudget); }
  } else {
    const template = titlePageTemplateSegments(block, block, 'bana');
    const buildFlat = (titleItems) => {
      const segsList = [titleItems.map(tpText), ...[1, 2, 3, 4].map((i) => template[i].lines.map(tpLineToSegs))];
      const out2 = [];
      segsList.forEach((seg, si) => { for (const line of seg) for (const l of wrapLine(line, line.cell3)) out2.push({ seg: si, line: l }); });
      return out2;
    };

    // BANA 2.3.4g: the grade level joins the line before it WHENEVER IT FITS (Fable review, 26 Sep: gold
    // Sample 2-21's line 1 is "PRENTICE HALL LITERATURE; Bronze" — title and grade level joined, with no
    // overall page overflow at all) — unlike the other title items, which keep their own line (2.3.4c)
    // unless the whole page overflows (tpPackTitleItems below is that fallback, for every item). Checked
    // here, once, before that fallback: a one-line fit test using the same wrapLine every real line uses.
    const fitsOneLine = (text) => wrapLine(tpText(text), false).length === 1;
    let titleTagged = [
      { key: 'title', text: block.title }, { key: 'series', text: block.series }, { key: 'gradeLevel', text: block.gradeLevel },
      { key: 'subtitle', text: block.subtitle }, { key: 'edition', text: block.edition },
    ].map((x) => ({ key: x.key, text: String(x.text || '').trim() })).filter((x) => x.text);
    const gi = titleTagged.findIndex((x) => x.key === 'gradeLevel');
    if (gi > 0) {
      const combined = `${titleTagged[gi - 1].text}; ${titleTagged[gi].text}`;
      if (fitsOneLine(combined)) titleTagged.splice(gi - 1, 2, { key: 'title', text: combined });
    }
    let titleItems = titleTagged.map((x) => x.text);
    flat = buildFlat(titleItems);
    while (flat.length > contentBudget && titleItems.length > 1) {
      titleItems = tpPackTitleItems(titleItems);
      flat = buildFlat(titleItems);
    }
    if (flat.length > contentBudget) { warnOverflow = true; flat = flat.slice(0, contentBudget); }
  }

  const presentSegs = [...new Set(flat.map((x) => x.seg))];
  const gaps = Math.max(0, presentSegs.length - 1);
  const blankBudget = Math.max(0, contentBudget - flat.length);
  const base = gaps ? Math.floor(blankBudget / gaps) : 0;
  const extra = gaps ? blankBudget % gaps : 0;

  const out = [];
  let gapIdx = 0, prevSeg = null;
  for (const { seg, line } of flat) {
    if (prevSeg !== null && seg !== prevSeg) {
      const n = base + (gapIdx < extra ? 1 : 0);
      for (let k = 0; k < n; k++) out.push(tcBlank);
      gapIdx++;
    }
    out.push(line);
    prevSeg = seg;
  }
  if (!gaps) for (let k = 0; k < blankBudget; k++) out.push(tcBlank);   // a lone segment: spend the budget after it, still ending on a text line

  if (warnOverflow) pushWarning(o, 'titlepage-overflow', 'The title page is too long; move items to a second title page');

  if (numbered && out.length) {
    let li = out.length - 1;
    while (li > 0 && out[li].s === '') li--;
    const cur = out[li];
    const text = cur.s.replace(/\s+$/, '');
    if (text.length + 3 + pageNumText.length <= w) {
      const padded = text.padEnd(w - pageNumText.length) + pageNumText;
      out[li] = { s: padded, src: [...cur.src.slice(0, text.length), ...Array(padded.length - text.length).fill(null)] };
    } else if (out.length < perPage) {
      out.push({ s: rightJustify(pageNumText, w), src: Array(w).fill(null) });
    } else {
      const at = Math.max(0, w - pageNumText.length);
      out[li] = { s: text.padEnd(at).slice(0, at) + pageNumText, src: Array(w).fill(null) };
    }
  }
  // UK-9: the end marker, at the foot of the page, directly after the content — no blank line before
  // it (see footerLines above for the real-BRF evidence this now follows).
  if (!isBana && !hideHeader) out.push(tcDeco(indicatorLine('colons', w)));
  return out;
}

// Footnote / Endnote formatting per BANA Formats §12 (1-3 margin: first cell 1, runover cell 3)
// BANA Formats §16.5.1a: a run of notes at the end of a print page follows a note
// separation line ("333333), which "cannot be on the last line of the braille page" (kept
// with the first note line); no blank line before it or between notes. Endnote sections
// (§16.9) and UKAAF (B004 D) keep a blank line before each note.
const NOTE_SEPARATOR = '"333333';
// IMP-W3: a note in the endnote section (`inEndnoteSection`, set by buildDocPages) has no blank line before it (Sample 16-11: the
// notes run together in 1-3 margins); the section's first note follows the heading's own blank line.
const noteLead = (block, o) => (block.inEndnoteSection ? [] : isBanaOpts(o) && block.kind !== 'endnote' ? (block.noteRunStart ? [NOTE_SEPARATOR] : []) : ['']);
// A source note is sometimes already transcribed with its own reference mark as the first
// characters of its body (a real print footnote conventionally restates its number/symbol
// there, e.g. `note_references.test.mjs`'s `<note id="n1"><p>1 First note.</p></note>`, or a
// note built with the mark as its own leading `noteref` segment) — in either case the mark
// must not be added again. Checks only the opening paragraph (the one §16.5.1/16.2.1's
// restated mark belongs to).
function noteBodyStartsWithMark(block, mark) {
  const m = String(mark ?? '').trim();
  if (!m) return false;
  const first = (Array.isArray(block.blocks) && block.blocks.length) ? block.blocks[0] : block;
  // The text of the leading runs together, not the first run alone: the editor keeps an empty piece of text where the caret
  // stands, and a note whose number was in a run of its own (italic) after a space or an empty run then looked as if it had none
  // (A89, random-action testing). Every run's text counts (a note reference's too, 16.2.2a), up to an equation.
  const segs = Array.isArray(first.segments) ? first.segments : [];
  let leadText = segs.length ? '' : String(first.text ?? '');
  for (const s of segs) { if (!s || s.type === 'math') break; leadText += String(s.text ?? ''); if (leadText.trim().length >= m.length) break; }
  // The body's own number is often set as a superscript (<sup>1</sup>, the 9780544087507 NIMAS book): its script markers
  // (U+E000-U+E002) come before the digit and are not print, so they are ignored here — or the mark was added a second time,
  // ;9#A;9#A (1 Oct 2026).
  return leadText.replace(/[\uE000-\uE002]/g, '').trimStart().startsWith(m);
}
// F-113 / BANA 16.5.1d: "Use 1-3 margins; for additional paragraphs in a note, use 5-3
// margins." Each of a multi-paragraph note's blk.blocks (parse.mjs's pushNote) is rendered
// directly at its own margin — first cell 1 (0,2) for the opening paragraph, first cell 5
// (4,2) for every one after it in BANA; UKAAF has no equivalent rule (B004 D only says a
// multi-paragraph note is "treated as such"), so its continuation paragraphs keep the same
// 1-3 margin, still on their own line rather than run into the paragraph before them.
// Optional `block.noteMarkPlacement` ('none' | 'inline'; default absent = the mark is prefixed as above): 16.5.1d "do not
// add a mark that print does not use" ('none': the note has no printed mark, e.g. a note keyed to a highlighted word) and
// 16.2.2a "before or after the word, as in print" ('inline': the mark is where the body's own noteref segment puts it).
function formatFootnote(block, o) {
  const w = o.width || 38;
  // #57c: the editor keeps a note of several paragraphs as one footnote block per paragraph (so each can be linked to its braille
  // lines); the second and later are marked `noteCont`. Such a block is a further paragraph of the note above it: no separation line
  // or blank line before it, no reference mark, and the 5-3 margins (BANA 16.5.1d) of block.blocks[i > 0] below.
  if (block.noteCont) {
    const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(String(block.text ?? ''));
    return body.trim() ? wrapCells(body, w, isBanaOpts(o) ? 4 : 0, 2).map((l) => l.replace(/\s+$/, '')) : [];
  }
  const out = noteLead(block, o);
  // BANA 16.5.1/16.2.1: the note body begins with the SAME reference mark used at its point
  // of reference in the text (Example 16-1: text `,hamlet"9` / note `"9,o!llo`; numbered
  // notes open `;9#a`) — only the opening paragraph gets it, never a continuation paragraph.
  const markBrl = (block.noteMark && !block.noteMarkPlacement && !noteBodyStartsWithMark(block, block.noteMark)) ? noterefBraille({ text: block.noteMark }, o) : '';
  if (Array.isArray(block.blocks) && block.blocks.length) {
    block.blocks.forEach((cb, i) => {
      const body = cb.segments ? segmentsToBraille(cb.segments, o) : o.translate(String(cb.text ?? ''));
      if (!body.trim()) return;
      const { first, runover } = (i > 0 && isBanaOpts(o)) ? { first: 4, runover: 2 } : { first: 0, runover: 2 };
      out.push(...wrapCells(i === 0 ? markBrl + body : body, w, first, runover));
    });
  } else if (Array.isArray(block.segments)) {
    const body = segmentsToBraille(block.segments, o);
    out.push(...wrapCells(markBrl + body, w, 0, 2));
  } else if (block.text != null && String(block.text).trim()) {
    out.push(...wrapCells(markBrl + o.translate(String(block.text)), w, 0, 2));
  }
  const lines = out.map((l) => l.replace(/\s+$/, ''));
  if (lines[0] === NOTE_SEPARATOR && lines.length > 1) Object.defineProperty(lines, 'keepGroups', { value: [[0, 1]] });
  return lines;
}

// Attribution (Formats §9.4.1): blocked "in the fifth cell to the right of the beginning
// of the previous line" (§9.4.1b) — NOT a fixed cell 5: `block.attribCell` (set by
// buildDocPages/buildDocPagesAsync from the actual previous braille line's own leading-space
// count, whatever block produced that line — a paragraph's runover, a poem line, a displayed
// quotation, another attribution, and so on — literally "the previous line", per sample-9-6's
// own worked example where the quote begins cell 3 and the attribution blocks at cell 7, not
// the fixed cell 5) carries the real per-instance offset. A23 / F-100 writeup: when the
// immediately preceding content line belongs to a HEADING block, it does not count as "the
// previous line" for this rule — 9.4.1's own definition is that an attribution identifies the
// source of "the quote, poem, story, etc.", i.e. of textual/narrative matter, not of a title —
// and empirically a centred heading's own (often large, centring-derived) indent pushed the
// attribution far enough right to wrap it onto two lines, breaking both
// displayed_and_verse_rules.test.mjs's 13.11.2b song case and nimas_bana_structures.test.mjs's
// byline-after-heading case; buildDocPages leaves attribCell unset in that case, so this falls
// back to the old fixed offset 4 (cell 5). A block formatted outside that pipeline (a direct
// formatBlock/traceBlock call, or UKAAF mode, which has no §9.4 rule and keeps its
// pre-existing fixed placement) likewise has no attribCell and uses the same fallback. No
// blank line before it (it belongs to the text it follows, §9.4.1a) and "always leave a blank
// line following an attribution" (§9.4.1d). Mirrored in traceBlock.
// F-80 / BANA 9.4.1d, 9.5.1c/d: the trailing blank line only belongs to the true END of an
// attribution/citation run — `block.continued` (the same flag `para`/`quote` already use for
// "more of this run follows without a blank") suppresses it so several short, print-distinct
// fragments (Sample 9-7's image credits; Sample 9-10's "(Signed)"/signature pair) can be
// authored as separate attribution blocks and still lay out with no blank between them.
function formatAttribution(block, o) {
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  const w = o.width || 38;
  const cell = Number.isFinite(block.attribCell) ? block.attribCell : 4;
  const out = block.continued ? [...wrapCells(body, w, cell, cell)] : [...wrapCells(body, w, cell, cell), ''];
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Caption formatting per BANA Formats §5 & §11 (7-5 margin: cell 7 first, cell 5 runover)
function formatCaption(block, o) {
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  const w = o.width || 38;
  const first = o.mode === 'bana' ? 6 : 4;
  const runover = o.mode === 'bana' ? 4 : 4;
  // F-4 / BANA 11.2.8b: "If the table has no title or heading, insert an identifier (e.g., figure,
  // chart, table, etc.) enclosed in transcriber's note indicators. The caption follows the identifier
  // on the same line." Optional `block.identifier`: a string is translated and prefixed before the
  // caption text; `true` wraps the caption as given (the print's own caption already names it, as in
  // BANA Sample 11-1's "Figure 24-7"). No field: unchanged (a captioned, titled table today).
  const wrapped = block.identifier
    ? TN_OPEN + (block.identifier === true ? '' : o.translate(String(block.identifier)).trim() + ' ') + body + TN_CLOSE
    : body;
  const out = ['', ...wrapCells(wrapped, w, first, runover)];
  return out.map((l) => l.replace(/\s+$/, ''));
}

// F-104 / BANA 9.6.1: cross-reference or incidental note. No reference mark, blank line before and
// after (9.6.1c); with its own heading: heading 7-7 then the note on the next line 5-5 (9.6.1d);
// without a heading: 7-5 (9.6.1e). `block.heading` is the optional heading text.
function xrefWrap(block, o, body, hbody) {
  const w = o.width || 38;
  const first = o.mode === 'bana' ? 6 : 4;
  return hbody != null ? [...wrapCells(hbody, w, 6, 6), ...wrapCells(body, w, 4, 4)] : wrapCells(body, w, first, 4);
}
function formatXref(block, o) {
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  const hbody = block.heading && String(block.heading).trim() ? o.translate(String(block.heading)) : null;
  return ['', ...xrefWrap(block, o, body, hbody), ''].map((l) => l.replace(/\s+$/, ''));
}

// Play / Drama Dialogue / Verse formatting per BANA Formats §13 / §14. A verse line
// takes the poem-wide nested pattern (Formats §13.3.1; B004 App J): `block.maxLevel`
// is the deepest level in the poem, supplied by buildDocPages for parsed line-per-block
// poems (a lone block falls back to its own level).
// F-206 / BANA 14.6.2a, 15.5.2b: `block.speakerGap` (optional) puts three blank cells between the speaker's name (the
// text up to its first ':' or '.') and the first word of the dialogue — print's own large space after the name.
// K33 default (BANA, no `speakerGap`): two blank cells after a speaker's name that print does not set off from the
// dialogue — 14.5.1d / 14.6.1e "Insert two blank spaces between speaker names and dialogue if print shows no
// distinction between the names and the dialogue, e.g., emphasis on the names; punctuation between the names and
// related dialogue", and a cartoon's or graphic novel's "character's name followed by two spaces" (14.10.5a/c,
// 14.11.1; Samples 14-5, 14-11, 14-12). The name is marked in the text by the two or more spaces that follow it
// (`Woman  My parents ...`); a name ending in punctuation, an emphasised name, or a name in full capitals (Sample
// 14-3's `,,c>ol ,y don't`) is set off by print already and keeps the single space (the runs of spaces collapse as
// everywhere else). With no double space the name cannot be told from the dialogue, so the single space stays.
// Returns the segments to translate, or the input segments unchanged.
const SPEAKER_NAME_RE = /^(\s*[^\s:.!?;,][^\n]{0,40}?)([^\S\n]{2,})(\S[\s\S]*)$/;
const speakerNameCut = (t) => {
  const m = SPEAKER_NAME_RE.exec(t);
  if (!m || /[:.!?;,]$/.test(m[1]) || isFullyCapitalised(m[1]) || m[1].trim().split(/\s+/).length > 4) return null;
  return [m[1], m[2] + m[3]];                              // the spaces stay with the dialogue (cell-trace positions)
};
function speakerGapSegments(block, o, segs) {
  if (o.mode !== 'bana') return segs;
  if (!block.speakerGap) {
    // Dialogue only: a §13 poem line (a verse 'play' block that is not verse-play dialogue, F-180) has no speaker.
    if ((block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem') && !block.playVerse) return segs;
    const isText = (g) => g && (g.type === undefined || g.type === 'text') && typeof g.text === 'string';
    const src = segs && segs.length ? segs : [{ type: 'text', text: String(block.text ?? '') }];
    const first = src[0];
    const c = isText(first) && !first.tf ? speakerNameCut(first.text) : null;
    return c ? [{ ...first, text: c[0] }, { type: 'gap', cells: 2 }, { ...first, text: c[1] }, ...src.slice(1)] : segs;
  }
  const cut = (t) => { const m = /^(\s*[^\s:.][^:.]*[:.])(\s+\S[\s\S]*)$/.exec(t); return m ? [m[1], m[2]] : null; };   // the whitespace stays with the dialogue so cell-trace source positions stay aligned
  if (segs && segs.length) {
    const first = segs[0];
    if (first && (first.type === undefined || first.type === 'text') && typeof first.text === 'string') {
      const c = cut(first.text);
      if (c) return [{ ...first, text: c[0] }, { type: 'gap', cells: 3 }, { ...first, text: c[1] }, ...segs.slice(1)];
    }
    return segs;
  }
  const c = cut(String(block.text ?? ''));
  return c ? [{ type: 'text', text: c[0] }, { type: 'gap', cells: 3 }, { type: 'text', text: c[1] }] : segs;
}

// F-124 / BANA 13.6.3: "Use three blank cells to separate widely spaced words or phrases." Optional `block.wideSpaces`
// (default off: runs of spaces collapse to one cell as before): a run of two or more spaces in the line's text is such wide spacing
// and becomes three blank cells (the F-206 `gap` segment). The spaces stay with the text that follows the gap so cell-trace positions align.
function wideSpaceSegments(block, o, segs) {
  if (!block.wideSpaces || o.mode !== 'bana') return segs;
  const src = (segs && segs.length) ? segs : [{ type: 'text', text: String(block.text ?? '') }];
  const out = [];
  for (const g of src) {
    if (!g || !(g.type === undefined || g.type === 'text') || typeof g.text !== 'string' || !/[^\S\n]{2,}/.test(g.text)) { out.push(g); continue; }
    const pieces = g.text.split(/([^\S\n]{2,})/);              // [text, run, text, run, text ...]
    if (pieces[0]) out.push({ ...g, text: pieces[0] });
    for (let k = 1; k < pieces.length; k += 2) {
      const after = pieces[k] + (pieces[k + 1] ?? '');
      if (pieces[k + 1] && pieces[k + 1].trim() && pieces[k - 1].trim()) out.push({ type: 'gap', cells: 3 });
      out.push({ ...g, text: after });
    }
  }
  return out;
}
const g1PoemSegs = (block, segs) => (segs && segs.length ? segs : [{ type: 'text', text: String(block.text ?? '') }]).map((g) => (g && (g.type === undefined || g.type === 'text') ? { ...g, uncontracted: true } : g));
function formatPlay(block, o) {
  const isVerse = block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem';
  const lvl = block.level || 0;
  // F-180 / BANA §14.6.1a: a verse-PLAY dialogue line (block.playVerse — stamped by parse.mjs
  // for a <p class="bai-verse"/"play-verse"> line, D5's own "verse drama" marker, never for a
  // genuine <poem>) needs the wider cell-5 floor; everything else (a genuine poem line, or any
  // isVerse block with no explicit playVerse flag — the pre-existing default, kept for
  // backward compatibility with hand-built blocks that never set it) keeps the plain
  // nested-poetry formula (§13.3.1a "One level: 1-3").
  const marginKind = (isVerse && o.mode === 'bana' && block.playVerse) ? 'play-verse' : 'poetry';
  const dsp = isVerse && block.displayedPoem && o.mode === 'bana' ? 2 : 0;   // 13.3.1c second option (optional `displayedPoem`, default off): a poem centred in print is displayed material, two cells in from the poem margins
  const nm = isVerse
    ? nestedMargins(marginKind, lvl, block.maxLevel ?? lvl, o.mode)
    : { first: lvl === 0 ? 0 : 4, runover: 2 };
  const first = (block.poemFirst ?? nm.first) + dsp, runover = (block.poemRunover ?? nm.runover) + dsp;   // F-128/F-129: poemMethod margins (UKAAF App J)
  const w = o.width || 38;
  // F-178 / BANA §14.1.4: "retain the capitalization and omit the emphasis" when print shows
  // a speaker's name both fully capitalised and emphasised — scoped to a play-speaker block
  // (the ONE block type that carries a speaker's name in its own segments at all).
  // BANA-only (14.1.4 is a BANA Formats rule; B004 K "Good practice 1" is explicitly
  // permissive for UKAAF — "the speaker's name...can generally follow print's method...it
  // can be italicised" — retaining a UKAAF speaker name's own emphasis is correct, not a bug).
  let segs = (isPlaySpeakerStyle(block.style) && block.segments && o.mode === 'bana') ? stripCapsEmphasis(block.segments) : block.segments;
  segs = speakerGapSegments(block, o, segs);            // F-206
  segs = wideSpaceSegments(block, o, segs);             // F-124 (optional `wideSpaces`)
  const rhyme = isVerse ? takeRhymeLetter(block, segs, o) : null;   // 15.7.3d: optional `rhymeLetters`
  if (rhyme) segs = rhyme.segs;
  // F-181 / BANA §15.5.2a/15.8.1b/c: a play-speaker/dialogue line's own `{type:'linenum'}`
  // segment (the same A30 construct an ordinary numbered paragraph carries — see
  // formatSegmentedPara) must not be silently dropped, and must land at the right margin, not
  // wherever it happens to sit in the source text — segmentsToBraille needs `lineNumbers: true`
  // to keep it, and wrapBody (not plain wrapCells) to route it through wrapNumbered whenever
  // one is actually present (wrapBody falls back to wrapCells unchanged when there is none).
  let body;
  if (block.uncontractedPoem && o.mode === 'bana') {                    // 13.6.4a: whole poem uncontracted, one ;;; ... ;' around it
    body = segmentsToBraille(g1PoemSegs(block, segs), { ...o, g1Bare: true }, true);
    if (body.trim()) body = (block.g1Open ? G1_PASSAGE_OPEN : '') + body + (block.g1Close ? G1_TERMINATOR : '');
  } else body = segs ? segmentsToBraille(segs, o, true) : o.translate(block.text || '');
  if (!body.trim()) return [];
  // BANA 15.5.1c, 15.3.1c: in line-numbered poetry keep the two-cell margin before the (widest) print line number
  // "whether these numbers are implied or actually shown" - an unnumbered verse line ends where a numbered one would.
  if (rhyme) {
    const rw = rhymeWrapOpts(o, w, hasLineNumbers(body), rhyme.letter.length);
    const rl = wrapBody(body, rw.o, rw.width, first, runover).map((l) => l.replace(/\s+$/, ''));
    if (rl.length) rl[0] = putRhymeLetter(rl[0], rhyme.letter, w, o);
    return rl;
  }
  return wrapBody(body, o, playWrapWidth(block, o, w, hasLineNumbers(body), isVerse), first, runover).map((l) => l.replace(/\s+$/, ''));
}
// BANA 15.7.3d (Sample 15-8): a poem with a rhyme scheme AND line numbers. Optional `block.rhymeLetters` (default off; the
// first linenum segment of the line is then the rhyme letter, any second one the print line number): the letter stands on
// the line's first braille row so that it ENDS one cell before the widest line number of the document; the line number keeps
// the right margin, and the verse text stops at least one blank cell before the letter.
function takeRhymeLetter(block, segs, o) {
  if (!block.rhymeLetters || !Array.isArray(segs)) return null;
  const i = segs.findIndex((g) => g && g.type === 'linenum' && String(g.text ?? '').trim());
  if (i < 0) return null;
  return { segs: segs.filter((_, k) => k !== i), letter: o.translate(String(segs[i].text).trim()).trim() };
}
function rhymeWrapOpts(o, w, numbered, len) {                  // the text stops before the letter: the numbered wrap counts the letter as part of the number column
  const lnw = o.lineNumberWidth || 0;
  return numbered ? { o: { ...o, lineNumberWidth: lnw + len }, width: w } : { o, width: Math.max(9, w - lnw - len - 2) };
}
function rhymeStart(o, w, len) { const lnw = o.lineNumberWidth || 0; return Math.max(0, (lnw > 0 ? w - lnw - 1 : w) - len); }
function putRhymeLetter(line, letter, w, o) {
  const at = rhymeStart(o, w, letter.length);
  const s = line.length < at ? line.padEnd(at) : line;
  return s.slice(0, at) + letter + s.slice(at + letter.length);
}
function tcPutRhymeLetter(t, letter, w, o) {
  const at = rhymeStart(o, w, letter.length);
  const pad = Math.max(0, at - t.s.length);
  const s = t.s + ' '.repeat(pad), src = [...t.src, ...Array(pad).fill(null)];
  return { s: s.slice(0, at) + letter + s.slice(at + letter.length), src: [...src.slice(0, at), ...Array(letter.length).fill(null), ...src.slice(at + letter.length)] };
}
function playWrapWidth(block, o, w, numbered, isVerse) {
  const lnw = o.lineNumberWidth || 0;
  return (isVerse && block.lnMargin && o.mode === 'bana' && lnw > 0 && !numbered) ? Math.max(9, w - lnw) : w;   // unnumbered verse lines wrap before the number column; BrailleBlaster 3.2.3 wraps at w - widest number (Collections: 36), so no extra 2 cells (checked 23 Sep)
}

// Stage Directions formatting per BANA Formats §14 (7-7 or 9-7); font attributes
// are ignored (§14.4.1c, see stripEmphasis).
// A stage direction's segments, emphasis removed (BANA §14.4.1c). UKAAF B004 (K. Plays)
// encloses stage directions in square brackets; BANA §14.4.1a follows print and adds none.
// `open`/`close` are the added brackets (no print source).
function stageParts(block, o) {
  const segs = block.segments ? stripEmphasis(block.segments) : [{ type: 'text', text: String(block.text || '') }];
  const flat = segs.map((g) => (g.type === 'math' ? 'x' : String(g.text || ''))).join('');
  const enclosed = /^\s*[[(]/.test(flat) && /[\])]\s*$/.test(flat);
  const add = o.mode !== 'bana' && flat.trim() && !enclosed;
  // The added brackets go round the words, not the spaces at the direction's edges: "[2 ]" before a save, "[2]" after it,
  // which trims them (A89, random-action testing).
  return { segs: add ? trimRunEdges(segs) : segs, open: add ? '[' : '', close: add ? ']' : '' };
}
function trimRunEdges(segs) {
  const out = segs.map((g) => ({ ...g }));
  const isText = (g) => g && (g.type === 'text' || g.type == null) && typeof g.text === 'string';   // plain text only: a literal-braille (brl) or note-ref run is never trimmed or dropped
  for (let i = 0; i < out.length && isText(out[i]); i++) { out[i].text = out[i].text.replace(/^\s+/, ''); if (out[i].text) break; }
  for (let i = out.length - 1; i >= 0 && isText(out[i]); i--) { out[i].text = out[i].text.replace(/\s+$/, ''); if (out[i].text) break; }
  return out.filter((g) => !isText(g) || g.text !== '');
}
function formatStage(block, o) {
  const w = o.width || 38;
  const lvl = block.level || 0;
  const first = lvl === 0 ? 6 : 8;
  const runover = 6;
  const { segs, open, close } = stageParts(block, o);
  const body = segmentsToBraille([...(open ? [{ type: 'text', text: open }] : []), ...segs, ...(close ? [{ type: 'text', text: close }] : [])], o);
  if (!body.trim()) return [];
  return wrapCells(body, w, first, runover).map((l) => l.replace(/\s+$/, ''));
}

// Box lines per BANA Formats 2016 §7.1.3 (and Example 4-6): top box line `7`
// (dots 2356), bottom box line `G` (dots 12356 — the standard prints it as a
// lowercase g; this BRF is upper-case ASCII braille, see BRF64). For a set of
// nested boxes the exterior box takes `=` (dots 123456) for both its top and
// bottom border while the interior boxes keep 7/G (§7.6.1). Box lines start at the left margin and
// run the full width of the page (§7.3.3). UKAAF B004 has no box-line rule, so
// the same form is used in both modes.
function boxBorders(block, o, w) {
  const kids = Array.isArray(block.blocks) ? block.blocks : [];
  const holdsBox = kids.some((cb) => cb && typeof cb === 'object' && (cb.type === 'box' || cb.type === 'sidebar'));
  const exterior = holdsBox && !(o._boxDepth > 0);
  // F-70 / BANA 7.3.3b: "The length of box lines within line-numbered text adheres to the
  // required two blank cells before line numbers" — narrow the border the same way ordinary
  // numbered prose does (o.lineNumberWidth, the document-wide widest line number; wrapNumbered's
  // own "text ends 2 cells before the widest number" formula, layout.mjs's wrapNumbered/
  // document.mjs:157,3578) whenever the document carries any line-numbered text at all.
  const lnw = o.lineNumberWidth || 0;
  const bw = lnw > 0 ? Math.max(1, w - lnw - 2) : w;
  return exterior ? { top: '='.repeat(bw), bottom: '='.repeat(bw) } : { top: '7'.repeat(bw), bottom: 'G'.repeat(bw) };
}
// Boxed material (BANA Formats §7; UKAAF follows the same form). A box is
// preceded and followed by a blank line (§7.2.1) but no blank line follows the
// top box line or precedes the bottom box line (§7.2.1c/d) — the blank lines the
// boxed content itself requires (e.g. around a list, §8.3.2a; between blocked
// paragraphs, §1.9.3) are kept. The box heading (<hd> / title) goes on the line
// AFTER the top box line with no blank line between (§4.3.5, §7.2.1e); a title
// with no matching child heading is set as a cell-5 heading, the level the
// parser gives a sidebar <hd>. A nested box is formatted with o._boxDepth so
// its borders are interior 7/G; its own surrounding blanks fall away next to
// the exterior border (§7.6.1a/b) and remain elsewhere (§7.6.1c/d).
// F-75 / BANA 7.2.1e, Example 7-2: a box's own title. Was always a synthetic level-2 (cell-5)
// plain-text heading; the box block may now carry, optionally,
//   titleAlign    'centred' | 'cell5' (default) | 'cell7' — where the title sits (Example 7-2's
//                 'Forms of be' is centred: floor((40-10)/2) = 15 leading cells);
//   titleSegments the title's own segments; unlike a §4 heading the title keeps their print
//                 emphasis (Example 7-2: the italic word 'be' keeps its italics indicator).
// Absent both, the result is exactly the old level-2 plain heading. `title` stays the plain text.
const boxTitleText = (block) => {
  if (block.title != null) return String(block.title).trim();
  if (Array.isArray(block.titleSegments)) return block.titleSegments.map((s) => (s && typeof s.text === 'string' ? s.text : '')).join('').trim();
  return '';
};
const BOX_TITLE_TIERS = { centred: 'centred', cell5: 'cell5', cell7: 'cell7' };
function boxTitleHeading(block, rawTitle) {
  const h = { type: 'heading', level: 2, text: rawTitle };
  if (Array.isArray(block.titleSegments) && block.titleSegments.length) { h.segments = block.titleSegments; h.keepEmphasis = true; }
  if (BOX_TITLE_TIERS[block.titleAlign]) h.tierOverride = BOX_TITLE_TIERS[block.titleAlign];
  return h;
}

// K7 / BANA 7.5.1: "Indicate the box color unless all the boxes are the same color." Every box/sidebar in the
// document (nested ones too), collected once per format pass and cached on `o` (o._boxColorsUniform) since a
// single box cannot tell, from itself, whether every OTHER box shares its colour — see computeBoxColorsUniform's
// two call sites in formatDocument/formatVolume. Fewer than two boxes total: nothing to differ from, so uniform
// (say nothing). Two or more boxes, every one carrying a colour: uniform only when they are all the same colour.
// Two or more boxes, but only SOME carry a colour: not uniform (Emboss cannot confirm the un-marked ones match),
// so the boxes that DO carry a colour still name it — boxColorPrefix already says nothing for a box with no
// boxColor of its own, colour-uniform or not.
function computeBoxColorsUniform(blocks) {
  const colors = new Set();
  let boxCount = 0, uncolored = 0;
  const visit = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'box' || b.type === 'sidebar') {
        boxCount++;
        const c = typeof b.boxColor === 'string' ? b.boxColor.trim().toLowerCase() : '';
        if (c) colors.add(c); else uncolored++;
      }
      if (Array.isArray(b.blocks)) visit(b.blocks);
    }
  };
  visit(blocks);
  if (boxCount < 2) return true;
  if (uncolored > 0 && colors.size > 0) return false;   // a mix of coloured and unmarked boxes: cannot confirm uniformity
  return colors.size <= 1;
}
// K7 / BANA 7.5.2: "Insert the name of the color, enclosed in transcriber's note indicators, at the beginning of
// the opening box line. A blank cell separates the embedded transcriber's note from the box line." Named only
// when the document's boxes are not all the same colour (computeBoxColorsUniform, above); a box without
// `boxColor` set says nothing either way. Blank/false when boxLines is off (no box line to prefix).
function boxColorPrefix(block, o) {
  if (o._boxColorsUniform || block.boxLines === false) return '';
  const name = typeof block.boxColor === 'string' ? block.boxColor.trim() : '';
  if (!name) return '';
  const braille = o.translate(name).trim();
  return braille ? TN_OPEN + braille + TN_CLOSE + ' ' : '';
}

// A39 stage 2 ("one layout path"): formatBox is gone (A70: an empty box now returns [] too) -- traceBlockCore's 'box'/'sidebar' case is the only implementation left; formatBlock's case is a projection of it. boxHeadingLineCount (below) still calls formatHeading directly for pagination's own line-count purposes -- formatHeading itself was not converted.

// F-71 / BANA 7.3.5a: "If the box line is followed by a heading, the heading must be followed
// by at least one line of text." A box's own title heading (formatBox, above) is spliced
// directly into the box's own lines under the box's own block index — never a separate
// type:'heading' block applyPageBoundaries's isHeading() can see — so the number of lines that
// synthetic heading occupies is recomputed here, mirroring formatBox's own
// `rawTitle && !hasTitleHeading` condition exactly, letting applyPageBoundaries require a
// further real text line after it. Returns 0 when the box has no synthetic title heading
// (no title, or the title is already a genuine child heading block formatBox leaves alone).
function boxHeadingLineCount(bi, blocks, o) {
  const block = blocks[bi];
  if (!block || typeof block !== 'object' || (block.type !== 'box' && block.type !== 'sidebar')) return 0;
  const rawTitle = boxTitleText(block);
  if (!rawTitle) return 0;
  const kids = Array.isArray(block.blocks) ? block.blocks : [];
  const hasTitleHeading = kids.some((cb) => cb && typeof cb === 'object' && cb.type === 'heading' && String(cb.text ?? '').trim() === rawTitle);
  if (hasTitleHeading) return 0;
  return formatHeading(boxTitleHeading(block, rawTitle), o, false).filter((l) => l !== '').length;
}

// TF-1 (Paul, 28 Sep 2026): old BANA 5.3.4 ("Ignore font attributes used with parts-of-speech abbreviations ...
// e.g., v. or v for verb ... in dictionaries and glossaries") is one of the old 5.3.3-5.3.11 the June 2024 Changes
// to Foreign Language Sections do not reprint, so it is withdrawn; a part-of-speech abbreviation's print font
// attribute is no longer stripped automatically (5.4.1: follow print). POS_ABBREVS/isPosAbbrevRun and the
// stripPosAbbrevEmphasis() helper that used them were removed with this call site (see the TF-1 test file and
// Emboss/docs/expectation-changes.md).

// Glossary definition list formatting per BANA Formats §19 (1-3 runover, 3-5 nested)
// A glossary entry as segments: "term: definition" (BANA Formats Sample 21-1), whether or not
// the parts carry emphasis — the parser keeps segments for every <dt>/<dd>, the editor only
// for formatted ones, and both must braille alike. Entries with no term/def keep their own.
// K25 / BANA 17.6.1b-c and 21.9.2c as changed in June 2024 (Changes to the Foreign Language Sections): a definition list
// (17.6; also 17.7.1c word lists in foreign-language texts) and a bilingual reference (21.9.2) follow print punctuation
// only: "Leave one blank cell between an entry word or phrase and its definition when the entry is followed by
// punctuation"; "Leave two blank cells between entries and definitions if entries are not followed by punctuation"
// (21.9.2c: "If no punctuation appears in print, leave two blank cells"). The 2016 capital-letter test (and the 21.5.1c
// enclosure test, and 21.5.1e's mixed-style rule) are glossary rules (21.5, unchanged), so a block flag chooses:
// optional `definitionList` or `bilingual` (default off: the glossary rules, as before).
const glossaryPunctOnly = (block) => !!block && !!(block.definitionList || block.bilingual);
// BANA 21.2.2 (section 21, untouched by the June 2024 changes, so still in force — distinct from the withdrawn
// 5.3.11 "entry words in alphabetic references"): "Ignore entry word font attributes when all entry words are
// emphasized. Use emphasis only for entry words requiring distinction, e.g., book titles, foreign terms, etc." Only
// the typeform bits common to EVERY entry word (an item that also has a definition, i.e. really is an entry word)
// are decorative and dropped; a word emphasised for distinction — bold or italic on its own, the rest of the list
// plain — keeps it (TF-1, 28 Sep 2026: a single bold glossary entry word is no longer stripped on the old,
// unconditional 5.3.11 basis).
// termOwnMask, unlike sharedTfMask, ignores a term's own PLAIN counted runs (e.g. a §20.6 respelling/pronunciation
// in parentheses next to the entry word, Example 20-22 "accused (uh-KUZD)": only "accused" is bold) instead of
// letting them zero the result — an entry word's own typeform is whatever its emphasised run(s) carry, not
// "uniform across the whole term including its respelling". An entirely plain term has no typeform to share (0).
function termOwnMask(segs) {
  let mask = -1, any = false;
  for (const s of (segs || [])) {
    if (!isCountedEmphSeg(s)) continue;
    const t = segTf(s);
    if (!t) continue;
    any = true;
    mask &= t;
    if (!mask) return 0;
  }
  return any ? mask : 0;
}
// BANA 21.7.3b: "Omit font attributes for entry words at the main and subentry levels" — a MULTILEVEL thesaurus
// (block.thesaurus with subentries, i.e. some item.level > 0) drops every entry word's own font attribute
// unconditionally, unlike 21.2.2's general "only when all entry words are emphasised" test above (which still
// governs a single-level thesaurus, 21.7.2 — no font-attribute clause of its own — and every other glossary /
// alphabetic-reference / dictionary block; Sample 21-9 vs Sample 21-10).
const isMultilevelThesaurus = (block) => !!block && !!block.thesaurus && Array.isArray(block.items) && block.items.some((it) => it && it.level > 0);
function glossaryEntryWordMask(items, forceAll = false) {
  if (forceAll) return -1;   // 21.7.3b: drop every bit an entry word carries, no uniformity test
  let mask = -1, any = false;
  for (const it of (items || [])) {
    if (!it || typeof it !== 'object') continue;
    const def = it.def != null ? String(it.def).trim() : '';
    if (!(def || (Array.isArray(it.defSegments) && it.defSegments.length))) continue;   // no definition: not an entry word
    const term = it.term != null ? String(it.term).trim() : '';
    const termSegsRaw = Array.isArray(it.termSegments) && it.termSegments.length ? it.termSegments : (term ? [{ type: 'text', text: term }] : []);
    if (!termSegsRaw.length) continue;
    any = true;
    mask &= termOwnMask(termSegsRaw);
    if (!mask) return 0;
  }
  return any ? mask : 0;
}
function glossarySegments(it, forceGap = false, dictionary = false, o = null, punctOnly = false, termMask = 0) {
  const term = it.term != null ? String(it.term).trim() : '';
  const def = it.def != null ? String(it.def).trim() : '';
  const termSegsRaw = Array.isArray(it.termSegments) && it.termSegments.length ? it.termSegments : (term ? [{ type: 'text', text: term }] : []);
  let termSegs = (def || (Array.isArray(it.defSegments) && it.defSegments.length)) ? dropTfBits(termSegsRaw, termMask) : termSegsRaw;
  // BANA 21.8.6a: an entry word's superscript number (optional `termSup`, e.g. "1") always follows the
  // entry word in braille, "regardless of print placement" (the field is the same whether print put it
  // before or after the word). Emitted as literal cells: the UEB superscript indicator (";9", grade 1 + dots 35,
  // as text-style.mjs levelSign) then the number, with no blank cell before it.
  const termSup = it.termSup != null ? String(it.termSup).trim() : '';
  if (termSup && termSegs.length && o && o.translate) termSegs = [...termSegs, { type: 'brl', text: termSup, brl: ';9' + o.translate(termSup).trim() }];
  // TF-1 (Paul, 28 Sep 2026): old 5.3.4 (part-of-speech abbreviation font attributes ignored) withdrawn — a
  // definition's part-of-speech abbreviation now follows print like the rest of the definition (5.4.1).
  const defSegs = Array.isArray(it.defSegments) && it.defSegments.length ? it.defSegments : (def ? [{ type: 'text', text: def }] : []);
  // F-236: combine whenever termSegs/defSegs THEMSELVES are both non-empty — not just the
  // plain term/def strings — so an item supplying termSegments/defSegments only (no plain
  // string at all, e.g. because a part carries emphasis and was authored as segments) still
  // keeps both halves instead of silently losing one to the final `termSegs : defSegs` fallback.
  if (termSegs.length && defSegs.length) {
    const termPlain = term || termSegs.map((s) => (s && s.text) || '').join('');
    const defPlain = def || defSegs.map((s) => (s && s.text) || '').join('');
    // F-183 / F-194. BANA 17.6.1b-c (and 21.5.1c-d): "Leave one blank cell between an entry word
    // and its definition when the entry word is followed by punctuation, or if the definition
    // starts with an uppercase letter." "Leave two blank cells between entries and definitions
    // when the entry words are phrases instead of individual words, if they are not followed by
    // punctuation, or if the definition begins with a lowercase letter." No colon is invented
    // where print had none (the earlier ': ' separator was Emboss's own).
    const punctuated = /[^\p{L}\p{N}\s]$/u.test(termPlain);
    const upper = /^[^\p{L}\p{N}]*\p{Lu}/u.test(defPlain);
    // 21.5.1c: also one blank cell when the definition starts with an enclosure symbol, e.g. "(n.)".
    const enclosed = /^[(\[{\u201C\u2018"]/.test(defPlain) || /^'[^']*\S'(?![\p{L}\p{N}])/u.test(defPlain);   // a straight " opens a quote like a curly one; a straight ' only when a closing ' follows (else 'tis / 'cause)
    // Dictionary entries (optional block.dictionary): BANA 21.8.2 / 21.8.6a "follow print for the placement and
    // spacing" of the parts of an entry, and print has one space between them (Examples 21-23, 21-24, 21-35).
    const sep = dictionary || (!forceGap && (punctuated || (!punctOnly && (upper || enclosed)))) ? { type: 'text', text: ' ' } : { type: 'gap' };   // a 'gap' is two blank cells that survive the wrap's space-collapse; K25: punctOnly (glossaryPunctOnly) drops the capital and enclosure tests
    return [...termSegs, sep, ...defSegs];
  }
  if (Array.isArray(it.segments) && it.segments.length) return it.segments;
  if (it.text != null && String(it.text).trim()) return [{ type: 'text', text: String(it.text) }];
  return termSegs.length ? termSegs : defSegs;
}

// BANA 21.5.1e: "Insert two blank spaces before the start of all definitions ... when the
// alphabetic reference has a variety of entry styles." A list is mixed when some entries would
// take the one-cell separator (21.5.1c) and others the two-cell one (21.5.1d).
function glossaryMixedStyles(items) {
  let one = false, two = false;
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue;
    const segs = glossarySegments(it);
    if (segs.some((g) => g && g.type === 'gap')) two = true;
    else if (segs.length > 1 && it.term != null && it.def != null || (Array.isArray(it.termSegments) && it.termSegments.length && Array.isArray(it.defSegments) && it.defSegments.length)) one = true;
    if (one && two) return true;
  }
  return false;
}
// Margins of a glossary entry. Default: level 0 is 1-3, deeper levels first 2 + (lvl-1)*2 and runover 2 + lvl*2.
// Optional block.alphabeticMargins / block.thesaurus / block.dictionary (BANA 21.2.1b, 21.7.2, 21.7.3a, 21.8.5): the main entry
// begins in cell 1, each subentry level two cells further right, and ALL runovers two cells right of the deepest
// level in the list - one level 1-3, two levels 1-5 and 3-5, three levels 1-7, 3-7, 5-7.
function glossaryMargins(block, items) {
  if (!(block.alphabeticMargins || block.dictionary || block.thesaurus)) {
    return (it) => { const lvl = it.level || 0; return { first: lvl === 0 ? 0 : 2 + (lvl - 1) * 2, runover: 2 + lvl * 2 }; };
  }
  const maxLevel = (items || []).reduce((m, it) => Math.max(m, (it && it.level) || 0), 0);
  return (it) => ({ first: ((it && it.level) || 0) * 2, runover: 2 + maxLevel * 2 });
}
function formatGlossary(block, o) {
  const items = block.items || [];
  if (!items.length) return [];
  const out = [''];
  const w = o.width || 38;
  const punctOnly = glossaryPunctOnly(block);                     // K25: 17.6.1 / 21.9.2c (June 2024)
  const mixed = !block.thesaurus && !punctOnly && glossaryMixedStyles(items);   // 21.5.1e belongs to 21.5; a thesaurus follows print (21.7.1, Sample 21-10)
  const termMask = glossaryEntryWordMask(items, isMultilevelThesaurus(block));   // TF-1 / BANA 21.2.2, or 21.7.3b unconditional
  const gm = glossaryMargins(block, items);
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const { first, runover } = gm(it);
    const segs = foreignRefSegments(block, glossarySegments(it, mixed, !!block.dictionary, o, punctOnly, termMask));   // K16 / BANA 21.6.3b: foreign text uncontracted, foreign signs
    const body = segs.length ? segmentsToBraille(segs, o) : '';
    if (body) out.push(...wrapCells(body, w, first, runover));
  }
  out.push('');
  return out.map((l) => l.replace(/\s+$/, ''));
}

// ---- Print page numbers: implied (F-45), combined/omitted/facing (F-46, F-47), spelled out (F-49) ----
// All optional pagenum fields; a pagenum with none of them renders exactly as before.
//   implied: true      the print page shows no number but has one (BANA 1.11.5: "the print page number is
//                      inserted whether or not it appears in print"). With no `page` given, resolvePageNumbers()
//                      infers it as the previous print page number plus one (arabic or roman, case kept).
//   through: '5'       the last page of a combined number: "i" + through "v" -> "i-v" (1.11.8a), omitted pages
//                      "25-29" (1.11.8c), facing pages "44-45" (1.12.1). Roman and arabic are never combined (1.11.8).
//   combineWithNext:   the page is blank or holds only an uncaptioned illustration (1.11.8d): it is combined
//                      with the next print page that has text ("24-25"); no indicator of its own.
//   spelled: 'eighty-nine'   the print's own spelled-out form (BANA 1.14.1, follows print, hyphens included).
const ROMAN_VAL = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanToInt(s) {
  const t = String(s).toLowerCase(); let n = 0;
  for (let i = 0; i < t.length; i++) { const v = ROMAN_VAL[t[i]], nx = ROMAN_VAL[t[i + 1]]; n += nx > v ? -v : v; }
  return n;
}
function intToRoman(n) {
  const T = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; for (const [v, r] of T) while (n >= v) { s += r; n -= v; } return s;
}
// 'arabic' | 'roman' | 'ROMAN' | null for a print page number (canonical roman numerals only).
function pageNumberSystem(s) {
  const t = String(s ?? '').trim();
  if (/^\d+$/.test(t)) return 'arabic';
  if (/^[ivxlcdm]+$/.test(t) && intToRoman(romanToInt(t)) === t) return 'roman';
  if (/^[IVXLCDM]+$/.test(t) && intToRoman(romanToInt(t)).toUpperCase() === t) return 'ROMAN';
  return null;
}
function nextPageNumber(s) {
  const t = String(s ?? '').trim(), sys = pageNumberSystem(t);
  if (sys === 'arabic') return String(Number(t) + 1);
  if (sys === 'roman') return intToRoman(romanToInt(t) + 1);
  if (sys === 'ROMAN') return intToRoman(romanToInt(t) + 1).toUpperCase();
  return null;
}
// "a-b" unless the two are in different numbering systems (1.11.8: "Do not combine different types of
// numbering systems"): then the first number alone.
function combinePageNumbers(a, b) {
  a = String(a ?? '').trim(); b = String(b ?? '').trim();
  if (!b || a === b) return a;
  if (!a) return b;
  const sa = pageNumberSystem(a), sb = pageNumberSystem(b);
  if (sa && sb && sa !== sb) return a;
  return `${a}-${b}`;
}
// The number a later implied page counts from: the end of a "a-b" range, when both ends are plain arabic/roman numbers.
const lastOfRange = (s) => {
  const t = String(s ?? '').trim(), m = /^([^-]+)-([^-]+)$/.exec(t);
  if (m) return pageNumberSystem(m[1]) && pageNumberSystem(m[2]) ? m[2] : null;
  return pageNumberSystem(t) ? t : null;
};
// The print page number text of a pagenum block, its `through` end folded in.
function pageNumberText(block) {
  const p = String(block.page ?? block.text ?? '').trim();
  return p && block.through != null && String(block.through).trim() ? combinePageNumbers(p, block.through) : p;
}
// F-227 / BANA 10.7.2e: "Regardless of print location, place the word list before the first question."
// Document-level pass: a list block already flagged `wordList: true` (10.7.2b, existing field) that
// currently sits AFTER the exercise list it serves is moved to sit directly before that exercise's list
// block (a `box`-wrapped word list, e.g. answer choices in a box per 10.7.2f, moves as the whole box).
// Blocks without any `wordList` marker are returned unchanged (opt-in, no default-behaviour change).
const isWordListBlock = (b) => !!(b && typeof b === 'object' && ((b.type === 'list' && b.wordList) ||
  (b.type === 'box' && Array.isArray(b.blocks) && b.blocks.some(isWordListBlock))));
function resolveWordLists(blocks) {
  if (!Array.isArray(blocks) || !blocks.some(isWordListBlock)) return blocks;
  const out = [...blocks];
  for (let i = 0; i < out.length; i++) {
    if (!isWordListBlock(out[i])) continue;
    let j = i - 1;
    while (j >= 0 && out[j].type !== 'heading' && !(out[j] && out[j].type === 'list' && out[j].kind === 'exercise')) j--;
    if (j >= 0 && out[j].type === 'list' && out[j].kind === 'exercise') {
      const [wl] = out.splice(i, 1);
      out.splice(j, 0, wl);
    }
  }
  return out;
}
// BANA 1.11.8d: "When a page is blank or has only an uncaptioned illustration, combine that/those page(s) with the next
// page on which text occurs." A print page that holds nothing the braille shows (no block at all, or only graphics with no
// caption, description, alt text or citation, which printImageParts gives no lines) gets no page change line of its own:
// its number is combined with the next page's ("3-5", combinePageNumbers, as for F-46's `combineWithNext`) instead of
// stacking indicators (24 Sep real-book validation, bug 10). BANA only. Only within one numbering system (1.11.8: "Do not
// combine different types of numbering systems"): both plain arabic, or both roman; a lettered number (R65, VKV1) is left
// as it is. Unlike resolvePageNumbers, no block is removed (the empty page's pagenum stays as one with no number, which
// yields no line), so block indexes still match the document's for the editor's row map (trace.rows).
function combineEmptyPrintPages(blocks, o) {
  if (!isBanaOpts(o || {}) || !Array.isArray(blocks)) return blocks;
  const isPn = (b) => !!b && typeof b === 'object' && b.type === 'pagenum';
  const plain = (b) => isPn(b) && !b.combineWithNext && !b.implied && !b.unnumbered && !(b.through != null && String(b.through).trim());
  const num = (b) => String(b.page ?? b.text ?? '').trim();
  const shows = (b) => {
    if (!b || typeof b !== 'object') return false;
    if (b.type !== 'graphic') return true;
    const p = printImageParts(b);
    return !!(p.caption || p.description || p.citation);
  };
  let out = null;
  for (let i = 0; i < blocks.length; i++) {
    if (!plain(blocks[i])) continue;
    const run = [i];
    let j = i;
    for (;;) {
      let k = j + 1; while (k < blocks.length && !isPn(blocks[k]) && !shows(blocks[k])) k++;
      if (k >= blocks.length || !plain(blocks[k])) { j = -1; break; }
      const sys = pageNumberSystem(num(blocks[j]));
      if (!sys || sys !== pageNumberSystem(num(blocks[k]))) { j = -1; break; }
      j = k;
      let t = k + 1; while (t < blocks.length && !isPn(blocks[t]) && !shows(blocks[t])) t++;
      if (t < blocks.length && isPn(blocks[t])) { run.push(k); continue; }   // this page is empty too
      break;
    }
    if (j < 0) continue;
    out ||= [...blocks];
    for (const r of run) out[r] = { type: 'pagenum', page: '', text: '', ...(blocks[r].id ? { id: blocks[r].id } : {}), combinedWithNext: true };
    const page = combinePageNumbers(num(blocks[i]), num(blocks[j]));
    out[j] = { ...blocks[j], page, text: page };
    i = j;
  }
  return out || blocks;
}
// Document-level pass (F-45 implied numbers, F-46 blank pages combined with the next): returns a copy of
// `blocks` with `implied` numbers filled in and `combineWithNext` pages merged into the next pagenum. The
// input array is returned unchanged when no pagenum uses either field. A combined page keeps its place as an
// empty pagenum (no number, so no line), as combineEmptyPrintPages does: the output has exactly the input's block
// indexes, which the editor's print-to-braille row map (trace.rows) relies on (F-46; dropping the block shifted every
// later index by one). Trailing combined pages (no later page with text) put their first number on the first of them.
const combinedPlaceholder = (b) => ({ type: 'pagenum', page: '', text: '', ...(b.id ? { id: b.id } : {}), combinedWithNext: true });
function resolvePageNumbers(blocks) {
  if (!Array.isArray(blocks) || !blocks.some((b) => b && typeof b === 'object' && b.type === 'pagenum' && (b.implied || b.combineWithNext))) return blocks;
  const out = [];
  let last = null, pendingStart = null, pendingAt = -1;
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || b.type !== 'pagenum') { out.push(b); continue; }
    let page = String(b.page ?? b.text ?? '').trim();
    if (!page && b.implied && last) page = nextPageNumber(last) || '';
    if (b.combineWithNext) {
      if (page && pendingStart == null) { pendingStart = page; pendingAt = out.length; }
      if (page) last = lastOfRange(page);
      if (page) { out.push(combinedPlaceholder(b)); continue; }   // its number goes to the next page with text
    }
    let through = b.through;
    if (pendingStart != null && page) { page = combinePageNumbers(pendingStart, through != null && String(through).trim() ? through : page); through = undefined; pendingStart = null; }
    if (page) last = through != null && String(through).trim() ? lastOfRange(through) : lastOfRange(page);
    if (page === String(b.page ?? b.text ?? '').trim() && through === b.through && !b.combineWithNext) { out.push(b); continue; }
    const nb = { ...b, page, text: page }; if (through === undefined) delete nb.through; else nb.through = through; delete nb.combineWithNext;
    out.push(nb);
  }
  if (pendingStart != null) { const { combinedWithNext, ...keep } = out[pendingAt]; out[pendingAt] = { ...keep, page: pendingStart, text: pendingStart }; }   // trailing blank pages keep their own number
  return out;
}
// The lines of a print page number indicator (shared by formatPageNum and traceBlock, so they cannot drift).
// `spelled` (BANA 1.14.1c): six cells of dots 36 then the print's spelled-out number, runovers in cell 7,
// on the line(s) after the numeric indicator. Its first line stops short of the numeric number so it still
// fits beside it when the two land on line 1 (assemble() merges them there when there is no running head).
const ALPHA_LEAD = 6;
function pageNumLines(block, o) {
  const p = pageNumberText(block);
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  // F-51 / BANA 1.11.6a: "Insert a row of unspaced dots 36 across the width of the line to indicate print page
  // changes" where print has no page numbers. Optional `unnumbered: true` on a pagenum block that has no number
  // (default: such a block yields nothing, as before). BANA only; UKAAF has no equivalent rule.
  if (!p && block && block.unnumbered && isBana) return ['-'.repeat(o.width || 40)];
  if (!p) return [];
  const w = o.width || 38;
  const pageBrl = o.translate ? o.translate(p).trim() : p;
  if (isBana) {
    // BANA Formats 2016 §1.11.3 / Example 1-9: the page change indicator is "a
    // line of unspaced dots 36 ... starting at the left margin and ending with
    // the new page number at the right margin. There is no space between the
    // page change indicator and the first symbol of the print page number" —
    // e.g. `-------------------------------------#bb`. No `"3` prefix (that is
    // the UKAAF form, below). page.mjs's banaPageChangeNumber() recognises it.
    const num = pageBrl.slice(0, Math.max(1, w - 3));
    const lines = ['-'.repeat(w - num.length) + num];
    const sp = String(block.spelled ?? '').trim();
    if (sp) {
      const words = (o.translate ? o.translate(sp).trim() : sp).split(/\s+/).filter(Boolean);
      let cur = '', first = true, budget = w - ALPHA_LEAD - num.length - 1;
      const flush = () => { lines.push((first ? '-'.repeat(ALPHA_LEAD) : ' '.repeat(ALPHA_LEAD)) + cur); first = false; cur = ''; budget = w - ALPHA_LEAD; };
      for (const wd of words) {
        if (cur && cur.length + 1 + wd.length > budget) flush();
        cur = cur ? cur + ' ' + wd : wd;
      }
      if (cur) flush();
    }
    return lines;
  }
  // UKAAF B004 §8: Centred line with dot 5, dots 25 ("3) immediately followed by the page number in braille
  const indicator = '"3' + pageBrl;
  return [centred(indicator, w).replace(/\s+$/, '')];
}

// ---- Table helpers, shared by formatTable and traceTable so the cell trace cannot drift ----
const TABLE_GUIDE = '"';                                   // guide dot: dot 5
// Column separation line under the column headings (Formats §11.4.2b): "3333 — dot 5
// followed by a series of dots 25 — "extends across the full width of the column"
// (Example 11-6: `"333333333333  "3333333  "333333333`). One dot-run per column, exactly the
// column's own width, and the runs are two blank cells apart like the columns themselves
// (11.2.5b; K33 — the book's page images show two cells, e.g. Example 4-10's
// `"33333333  "3333333333  "3333333333`; an earlier gold transcription taken from a text
// dump had collapsed them to one).
// `overhangWidths` (BANA §11.4.3a, Change 2 — see padOverhang below): extra blank cells
// after a specific column, when a grouped column's own separator run must line up with
// an overhanging primary heading above it.
// `hasHeader` (BANA §11.4.2c, F-8): "Columns without a heading do not have a separation
// line" — a per-column boolean (that column's own header text, trimmed, non-empty). A
// column with no heading gets a plain blank segment (its own width) instead of a dot run,
// exactly the same convention renderVerticalSection/traceVerticalSection already use for
// their own separation line.
const tableSeparator = (widths, gutter, hasHeader, overhangWidths) => {
  const cols = widths.map((cw, ci) => (hasHeader[ci] ? TABLE_GUIDE + '3'.repeat(Math.max(0, cw - 1)) : ' '.repeat(cw)));
  return joinTableRow(padOverhang(cols, overhangWidths), gutter);
};
// A numeric entry for place-value alignment (§11.6.1d): optional sign, digits with
// thousands commas, optional decimal fraction. Anything else (units, %, ±, text) is a
// text entry and left-adjusted (§11.6.1c). Returns the fraction length incl. the point
// (0 when integral), or -1 when not numeric.
const NUMERIC_RE = /^[-+]?\d[\d,]*(\.\d+)?$/;
const numericFrac = (raw) => { const m = NUMERIC_RE.exec(String(raw ?? '').trim()); return m ? (m[1] ? m[1].length : 0) : -1; };
// Place-value alignment plan for one column (§11.6.1d "aligned by place value … to align
// digits, decimals, or commas"; B004 §12 "figures may be aligned on the right (or their
// decimal points aligned)"): null when any non-blank entry is not numeric, else the aligned
// width and a left pad per row so that the decimal points — hence the digits — line up,
// anchored at the column's left edge. The braille fraction is one cell per print character
// (UEB digits and the decimal point), so int cells = braille length - fraction length.
function numericColumnPlan(rawEntries, brlEntries) {
  let maxInt = 0, maxFrac = 0, any = false;
  const ints = [];
  for (let i = 0; i < brlEntries.length; i++) {
    const raw = rawEntries[i];
    if (raw == null || String(raw).trim() === '') { ints.push(null); continue; }
    const frac = numericFrac(raw);
    if (frac < 0) return null;
    const intCells = Math.max(0, brlEntries[i].length - frac);
    ints.push(intCells); any = true;
    maxInt = Math.max(maxInt, intCells); maxFrac = Math.max(maxFrac, frac);
  }
  if (!any) return null;
  return { width: maxInt + maxFrac, pads: ints.map((ic) => (ic == null ? 0 : maxInt - ic)) };
}
// F-7 (standards-findings.md), superseded by K3 below: BANA 11.6.1d aligns numerals "by
// place value … to align digits, DECIMALS, or COMMAS" — named punctuation to line up, not
// any incidental run of digits; B004 §12 is explicit that a column is "normally aligned on
// the left" and place-value/right alignment is an optional, transcriber-chosen treatment
// "if figures are to be worked on or summed". F-7 read that as: a column whose print
// entries carry a decimal point or thousands comma defaults to place-value alignment,
// everything else defaults to left. Reproduced against B004 §12 Example 1's own worked
// braille (the "No." column, 1..10, stays flush left; Emboss used to right-pad it) and
// gold-verified the other way against BANA Sample 11-2's "Total" column (commas, and the
// sample's own agreed braille right-aligns it — braille.lines rows 12-15).
//
// K3 (EMBOSS-TASKS.md section K; transcriber KD, BANA): that punctuation heuristic is
// itself only a proxy for the real rule, BF2016 §11.6.1d/§11.6.1c: "Transcribe numerals
// aligned by place value in print AS SHOWN" / "Left-adjust items within the columns of a
// table (not including numbers) EVEN THOUGH the print text shows column entries centered
// or right-adjusted" — i.e. follow what PRINT did with the column, not what the numbers
// themselves look like. A punctuation-free column that print right-aligns (KD's own
// example: a place-value table with no single decimal or comma anywhere) must still be
// place-value aligned; a punctuation-bearing column print never aligned must stay left.
// Each reader now records that per column from the source markup's own alignment —
// `block.printAlign[c]` ('right' | 'decimal' | undefined; see parse.mjs's parseTable/DOCX
// w:jc/w:tab-decimal readers, the HTML/DTBook shared markupCellAlign, ODT's resolved
// fo:text-align, doc.mjs's sprmPJc, and parseRtf's \qr/\tqdec) — 'decimal' and 'right' are
// both a positive "print aligned this column" signal (numericColumnPlan itself works out
// whether the alignment is on a decimal point, a comma, or plain digits from the entries'
// own text, per §11.6.1d's "digits, decimals, OR commas"); anything else (left/center/
// justify, no markup signal at all, or a column whose cells disagree) means print did NOT
// align the column, so §11.6.1c's plain left-adjustment applies — never a punctuation guess.
// `columnAlign[c]` remains the transcriber's own explicit override ("a way to mark a column
// as 'don't align'", the original F-7 finding) and still wins over the print signal either
// way: 'left' forces left-adjustment even over a print-aligned column, 'right' or 'decimal'
// forces place-value alignment even over a column print never aligned (e.g. a plain-integer
// column the transcriber does want summed) — the two are the same instruction to
// numericAlignApplies (numericColumnPlan itself works out whether the actual alignment lands
// on a decimal point, a comma, or plain digits, from the column's own entries); the editor's
// Braille formatting dialog offers both words only because that is how a transcriber reads
// the print column (K35). Anything else (undefined/'auto') defers to printAlign.
function numericAlignApplies(colAlign, printAlign) {
  if (colAlign === 'left') return false;
  if (colAlign === 'right' || colAlign === 'decimal') return true;
  return printAlign === 'right' || printAlign === 'decimal';
}
// Fill one column entry line out to its column width: { pre, post } such that
// pre + text + post is exactly cw cells.
//  §11.6.1f: "Two or more guide dots lead the reader from one column to the next, and are
//    inserted to fill out the width of a column with shorter entries … Leave one space
//    between the end of the entry and the beginning of guide dots" — so a short entry in a
//    column that has a next column is followed by a blank cell then dots 5 to the column's
//    end, and only when that leaves at least two guide dots. B004 §12 agrees ("guide dots
//    are used to bridge the gap between columns, leaving a space at each end. Two cells is
//    the minimum length"). §11.6.1g: no guide dots after a column runover line.
//  §11.6.4: a blank entry is filled with "guide dots across the width of a column".
//  Numbers (§11.6.1d) are place-value padded on the LEFT (`pre`, plain space — never
//    guide-dotted, since that padding positions digits/decimals/commas, not a gap to the
//    next column); the LEADING padding is invisible to the reader either way, but the
//    TRAILING gap left after a place-value-aligned entry (when the column is wider than its
//    widest aligned entry, e.g. a header wider than any figure) is exactly the same
//    "shorter entry in the column" case §11.6.1f/B004 12 guide-dots describe, and is guide-
//    dotted the same way (F-6; standards-findings.md — previously any numeric column always
//    returned plain space padding here and never reached the guide-dot branch at all;
//    reproduced against B004 §12 Example 1's Square/Cube columns, guide-dotted in the
//    standard's own braille, space-padded in Emboss's old output).
// BANA §11.5.3a: a blank cell in the row-heading column whose heading is implied by the row
// above (printed once per group) stays BLANK — never guide-dotted (`implied`, see impliedRowHeading).
function impliedRowHeading(cells, allRows) {
  return cells.length > 1 && cells[0] === '' && cells.slice(1).some((x) => x !== '') && allRows.some((r) => r[0] !== '');
}
// `noFill` (block.guideDots === false, BANA 10.9.1d matching columns): a short entry is padded with plain
// spaces, never guide dots (a wholly blank cell keeps its dots).
// `lead` (K33): how many cells of the following two-cell column gap the guide dots may run
// on into — 0 in BANA (11.6.1f: guide dots "fill out the width of a column", then the gap of
// 11.2.5b: Example 4-10 `well """"  bett]`), 1 in UKAAF (B004 §12: guide dots "bridge the gap
// between columns, leaving a space at each end. Two cells is the minimum length" — B004's page
// images, §12 Example 1 `#a   #a """" #a` / `#ajj "" #ajjj` and Appendix E, run the dots to one
// cell before the next column). The returned `lead` is the number of gap cells this line's
// dots actually take (joinTableRow puts that many guide dots at the start of the gap).
function tableCellFill(text, cw, { firstLine, lastCol, numPad, implied = false, noFill = false, lead = 0 }) {
  const len = text.length;
  if (len >= cw) return { pre: '', post: '', lead: 0 };
  if (!len && implied) return { pre: '', post: ' '.repeat(cw), lead: 0 };
  if (!len) return { pre: '', post: firstLine ? TABLE_GUIDE.repeat(cw) : ' '.repeat(cw), lead: 0 };
  const ext = lastCol ? 0 : lead;
  const dotted = (pre, gap) => (firstLine && !lastCol && !noFill && gap - 1 + ext >= 2
    ? { pre, post: ' ' + TABLE_GUIDE.repeat(gap - 1), lead: ext }
    : { pre, post: ' '.repeat(gap), lead: 0 });
  if (numPad >= 0) {
    const pre = ' '.repeat(Math.min(numPad, cw - len));
    return dotted(pre, cw - len - pre.length);
  }
  return dotted('', cw - len);
}
// The guide-dot lead (see tableCellFill) a table's format gives its column gaps: UKAAF 1, BANA 0.
const tableGuideLead = (o) => (isBanaOpts(o || {}) ? 0 : 1);
// Squeeze natural column widths into the line (unchanged selection logic); null when the
// columns cannot fit even at the 2-cell minimum, so the caller falls back to a non-columnar format.
function fitColumnWidths(colWidths, w, gutter, minWidths = null) {
  const colCount = colWidths.length;
  const totalSpatialWidth = colWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter;
  let actualWidths = [...colWidths];
  if (totalSpatialWidth > w) {
    const avail = Math.max(colCount * 2, w - (colCount - 1) * gutter);
    let remainingAvail = avail;
    const remainingCols = [];
    const computed = Array(colCount).fill(0);
    for (let c = 0; c < colCount; c++) {
      if (colWidths[c] <= Math.max(3, Math.floor(avail / colCount))) {
        computed[c] = Math.max(2, colWidths[c]);
        remainingAvail -= computed[c];
      } else {
        remainingCols.push(c);
      }
    }
    if (remainingCols.length > 0 && remainingAvail > 0) {
      const sumRemainingNatural = remainingCols.reduce((sum, c) => sum + colWidths[c], 0);
      for (const c of remainingCols) {
        computed[c] = Math.max(2, Math.floor((colWidths[c] / sumRemainingNatural) * remainingAvail));
      }
      actualWidths = computed;
    } else {
      const sumNatural = colWidths.reduce((a, b) => a + b, 0);
      actualWidths = colWidths.map((cw) => Math.max(2, Math.floor((cw / sumNatural) * avail)));
    }
  }
  // Words are never divided (BANA Formats §1.10.1): a squeezed column narrower than its
  // longest word takes cells from columns with room to spare; if there are not enough,
  // the table cannot be columnar (null → listed / paragraph form). A27b.
  if (minWidths) {
    const need = (c) => Math.max(0, (minWidths[c] || 0) - actualWidths[c]);
    for (let c = 0; c < colCount; c++) {
      let short = need(c);
      while (short > 0) {
        let donor = -1, spare = 0;
        for (let d = 0; d < colCount; d++) {
          const sp = actualWidths[d] - Math.max(2, minWidths[d] || 0);
          if (d !== c && sp > spare) { spare = sp; donor = d; }
        }
        if (donor < 0) return null;
        const take = Math.min(short, spare);
        actualWidths[donor] -= take;
        actualWidths[c] += take;
        short -= take;
      }
    }
  }
  // Even squeezed, the columns may not fit the line (many columns at a 2-cell
  // minimum). Never slice columns off the right edge.
  if (actualWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter > w) return null;
  return actualWidths;
}
// The widest space-separated word in a string (braille words are single-space-separated).
const widestWord = (str) => Math.max(0, ...String(str || '').split(' ').map((t) => t.length));
// The widest word (space-separated braille) in each column, headers included.
function columnMinWidths(headers, rows, colCount) {
  const out = Array(colCount).fill(0);
  const widest = widestWord;
  for (let c = 0; c < colCount; c++) {
    let m = widest(headers[c]);                     // headers wrap at runover 0 (§11.4.1) — no extra margin needed
    for (const r of rows) {
      const words = String(r[c] || '').split(' ').filter(Boolean);
      if (!words.length) continue;
      // §11.6.1a: a column entry's runover is indented 2 cells. Any word after the
      // first can end up on a runover line (pushed there by the words before it), so it
      // needs 2 cells of headroom beyond its own length or wrapCells' overflow safety
      // net divides it (found while proving T9: BANA Sample 11-04's "territory"-style
      // entries, A27b/§1.10.1). The FIRST word always starts the entry's first line at
      // indent 0, so it needs only its own width — reserving +2 for it too made BANA
      // Sample 11-04's "Williamson's Sapsucker" column (13 cells in the book: the first
      // word exactly fills it, "Sapsucker" runs over in 2+10) need 15 and fall back.
      const rest = words.slice(1).map((t) => t.length);
      m = Math.max(m, words[0].length, rest.length ? Math.max(...rest) + 2 : 0);
    }
    out[c] = m;
  }
  return out;
}
// T9 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026): BANA §11.6.1 "Column entries are
// limited to two lines. Entries that cannot be limited to two lines require another
// specialized table format." Checked against the SQUEEZED width actually chosen by
// fitColumnWidths (never the unsqueezed natural width) — a header or a column entry
// that would need a third line at that width fails the check, so 'auto' mode rejects
// columnar and falls back as before this fix. Word division is already impossible here
// (fitColumnWidths never squeezes a column below columnMinWidths' widest word), so this
// only ever checks line COUNT. Headers wrap 0/0 (no runover indent, matching
// formatColumnar's plain header path); entries wrap 0/2 (§11.6.1a's two-cell runover
// indent, matching formatColumnar's data-row path).
function fitsTwoLines(headers, rows, actualWidths) {
  for (let c = 0; c < actualWidths.length; c++) {
    if (headers[c] && wrapCells(headers[c], actualWidths[c], 0, 0).length > 2) return false;
  }
  for (const row of rows) {
    for (let c = 0; c < actualWidths.length; c++) {
      if (row[c] && wrapCells(row[c], actualWidths[c], 0, 2).length > 2) return false;
    }
  }
  return true;
}
// T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026 — standards-findings.md F-18's own
// status update): BANA §11.14 Wide Tables: Vertical Division. "A wide table may be
// divided into vertical sections" (11.14.1); "Repeat the row headings for each section of
// the table" (11.14.1b). Column 0 is always the row-heading column (§11.5.1: "The first
// column consists of the row headings"), so this greedily packs the table's DATA columns
// (1..colCount-1) into consecutive sections, each of which — together with column 0,
// repeated — must fit the line at their own NATURAL (unsqueezed) width. Natural width,
// not a squeeze, is what BANA's own Sample 11-22 (gold: tests/gold/bana-formats-2016/
// section-11/sample-11-22.json) shows: none of its six data columns is narrowed at all —
// they are simply grouped 4+2 across two sections once the table no longer has to fit
// them all on one line. Returns an array of one-or-more-column-index arrays (each
// excluding column 0, which the caller repeats in every section), or null when even a
// single data column cannot fit beside the row-heading column (division cannot help —
// Listed, §11.16, is the next resort per §11.12.1) or when the whole table needs only one
// section (division achieves nothing; defensive — resolveTableLayout only tries this
// after the plain columnar squeeze has already failed on the full, unsqueezed table).
function computeVerticalSections(colWidths, gutter, w, colCount) {
  if (colCount < 3) return null; // a row-heading column + at least 2 data columns to divide
  const rowHeadW = colWidths[0];
  const sections = [];
  let current = [];
  let currentWidth = 0;
  for (let ci = 1; ci < colCount; ci++) {
    const add = current.length ? gutter + colWidths[ci] : colWidths[ci];
    const proposed = currentWidth + add;
    if (current.length && rowHeadW + gutter + proposed > w) {
      sections.push(current);
      if (rowHeadW + gutter + colWidths[ci] > w) return null; // a single column doesn't fit
      current = [ci];
      currentWidth = colWidths[ci];
    } else {
      if (!current.length && rowHeadW + gutter + colWidths[ci] > w) return null;
      current.push(ci);
      currentWidth = proposed;
    }
  }
  if (current.length) sections.push(current);
  return sections.length >= 2 ? sections : null;
}
// Renders one vertical-division section (BANA §11.14.1b's repeated row-heading column,
// index 0, plus a subset of data columns) at its NATURAL width — header row (§11.4.1),
// its separation line (§11.4.2, blank under column 0 since it has no heading of its own
// here — 11.4.2c: "Columns without a heading do not have a separation line", gold-verified
// by Sample 11-22's own blank row-heading-column header having no dot run beneath it), then
// the data rows (§11.6, F-77: no forced blank line between rows). `headers`/`rows`/`widths`/
// `numPlans` are already restricted to this section's own columns (column 0 first).
function renderVerticalSection(headers, rows, widths, numPlans, gutter, w, noFill = false, lead = 0) {
  const colCount = widths.length;
  const out = [];
  if (headers.some((h) => h.trim())) {
    const headerWrapped = headers.map((h, ci) => wrapCells(h, widths[ci], 0, 0));
    const maxHdrLines = Math.max(1, ...headerWrapped.map((l) => l.length));
    for (let li = 0; li < maxHdrLines; li++) {
      const raw = headerWrapped.map((lines) => lines[li] || '');
      const lineCols = raw.map((t, ci) => t.padEnd(widths[ci], ' '));
      out.push(joinTableRow(lineCols, gutter).slice(0, w));
    }
    const sepCols = widths.map((cw, ci) => (headers[ci].trim() ? (TABLE_GUIDE + '3'.repeat(Math.max(0, cw - 1))) : ' '.repeat(cw)));
    out.push(joinTableRow(sepCols, gutter).slice(0, w));
  }
  const plans = numPlans.map((p, c) => (p && widths[c] >= p.width ? p : null));
  const rowWrappedData = rows.map((row) => row.map((cell, ci) => wrapCells(cell, widths[ci], 0, 2)));
  // BANA §11.5.4 vs §11.9.1.b (F-2): a blank row reads as a deliberate spacer/grouping
  // line ONLY when the table also has rows WITH real content around it — that is what
  // "show row groupings" / "set off rows of totals" means (Sample 11-6). When EVERY row
  // is blank (a skeleton table, §11.9.1: "Indicate empty column entries with guide dots"
  // — the whole point of the format), each row stays guide-dotted like any other blank
  // entry; gold-verified against Sample 11-17 (Skeleton Table), whose four rows are all
  // blank on purpose and must keep their guide dots, not collapse to blank lines.
  const anyRowHasContent = rows.some((row) => row.some((cell) => cell !== ''));
  const headLines = out.length;
  const rowStarts = [];                                      // first line of each row (verticalSectionGroups)
  rowWrappedData.forEach((cellWrapped, ri) => {
    if (ri === 1 && headLines) Object.defineProperty(out, 'headKeep', { value: out.length - 1 });   // headings + separation line + first row (formatVertical keeps them together)
    rowStarts.push(out.length);
    if (anyRowHasContent && rows[ri].every((cell) => cell === '')) { out.push(''); return; }
    const maxLines = Math.max(1, ...cellWrapped.map((l) => l.length));
    for (let li = 0; li < maxLines; li++) {
      const leads = [];
      const lineCols = cellWrapped.map((lines, ci) => {
        const t = lines[li] || '';
        const f = tableCellFill(t, widths[ci], { firstLine: li === 0, lastCol: ci === colCount - 1, numPad: plans[ci] ? plans[ci].pads[ri] : -1, implied: ci === 0 && impliedRowHeading(rows[ri], rows), noFill, lead });
        leads.push(f.lead);
        return f.pre + t + f.post;
      });
      out.push(joinTableRow(lineCols, gutter, leads).slice(0, w));
    }
  });
  if (headLines && rows.length === 1) Object.defineProperty(out, 'headKeep', { value: out.length - 1 });
  Object.defineProperty(out, 'rowStarts', { value: rowStarts });
  Object.defineProperty(out, 'headLines', { value: headLines });
  return out;
}
// Keep groups of one vertical-division section placed at output line `base` (section `si`). With repeated headings on
// (tableRepeatOn: BANA's default), as the columnar path: one group per row, the first also holding the section's column
// headings and separation line, tagged so applyPageBoundaries repeats them above a row of this section that opens a
// braille page (BANA 11.4.4a "repeat the column headings on each succeeding braille page", 24 Sep re-check problem 6:
// maths p8 -> p9, anthology p1104). The tag carries the section number, so each section repeats its own headings and
// each section's first group is its own group. Without repeating: the headings, separation line and first row only
// (BANA 11.2.6d, bug 12).
function verticalSectionGroups(sec, base, si, repeat) {
  if (repeat && Array.isArray(sec.rowStarts) && sec.rowStarts.length) {
    const groups = tableRowGroups(sec.headLines ? 0 : -1, sec.headLines - 1, sec.rowStarts, sec.length - 1);
    return groups.map(([a, b, tag]) => (tag ? [base + a, base + b, `${tag}.${si}`] : [base + a, base + b]));
  }
  return sec.headKeep != null ? [[base, base + sec.headKeep]] : [];
}
// The transcriber's note announcing a vertically divided table (BANA 11.14.1c sample
// wording): "Table is divided vertically into 2 sections." — pluralised count (always
// >= 2 sections by computeVerticalSections' own construction).
const verticalDivisionTn = (n) => `Table is divided vertically into ${n} sections.`;
// ---- K15 (EMBOSS-TASKS.md): wide tables on facing pages — BANA Formats 2016 §11.13; UKAAF B004 Appendix E,
// "Good practice example of a table over two pages". ----
// The table is read across a left-hand and a right-hand braille page seen together: "Use the full width of the two
// pages, usually 80 cells" (11.13.1a). formatTable/traceTable emit it as one block whose column-heading and row lines
// are 2w cells wide: cells [0, w) belong to the left-hand page and cells [w, 2w) to the right-hand page. A table row is
// therefore one content line, and the rows line up on the two pages by construction: §11.6.1b ("Begin all column
// entries on the line on which the row heading ends") holds across the pair, and a row takes as many lines on both
// pages as its tallest entry on either (B004 App E: "The rows on the facing pages must line up"). The parts of the
// block are tagged through keepGroups — 'FL' the lead (transcriber's note and table heading), 'FA' the source placed
// after the heading, 'FT' the top box line, 'FH' the column headings and separation line, 'FR<n>' row n, 'FB' the
// bottom box line, 'FC' the source after the table — and applyPageBoundaries lays out the pages (placeFacingTable,
// planFacingPages): the table starts on a fresh left-hand page, the two pages of a pair hold the same lines, and a
// longer table continues on further pairs with the column headings repeated (11.4.4a).
const FACING_TN = {
  bana: 'The following table is read across facing pages.',          // BANA 11.13.1c's own sample wording
  ukaaf: 'The following table is to be read across facing pages.',   // B004 App E Example 2's note
};
const FACING_TAG_RE = /^F(?:L|A|T|H|B|C|R\d+)$/;
// Whether a formatted/traced table block is a facing-pages table (its keepGroups carry the lead tag).
const isFacingLines = (lines) => !!(lines && Array.isArray(lines.keepGroups) && lines.keepGroups.some((g) => g[2] === 'FL'));
// Where the separation line under the last left-hand column heading and the guide dots after the last left-hand
// column entry end: the last cell of the page. BANA 11.13.1j/k "to the right margin of that page"; UKAAF B004 App E "the
// guidelines on the first page extend to the right-hand side". Checked against the page image of BANA Sample 11-21
// (PDF p.328): both end in cell 40, with two blank cells between the columns before them (11.2.5b; K33 — the gold
// file's text, first taken from the PDF text layer, had collapsed those gaps to one cell and so ended at cell 37).
const facingGuideEnd = (w) => w;
// Which data columns go on the left-hand page and which on the right-hand page ({ left, right, widths }). The left page
// holds the row headings (column 0) and as many data columns as fit ("A column may end in the last cell on the left-hand
// page", 11.13.1l); the rest go on the right page from cell 1 (11.13.1m) with no row headings (11.13.1i).
//  1. Natural widths first (as vertical division, §11.14), the same 2-cell gutter arithmetic as computeVerticalSections:
//     BANA Sample 11-21 then splits its six year columns 4 + 2 exactly as the book does.
//  2. Otherwise each page's columns squeezed as a columnar table's are (fitColumnWidths: no word divided), accepted only
//     when no entry needs more than two lines (§11.6.1, fitsTwoLines) — B004 App E Example 2's own entries and headings
//     run over within their columns ("Light / cloud", "Maximum / temperature"). The split with the most columns on the
//     left-hand page wins.
// null when the table fits one page at its natural width, or neither way fits the two pages ("the full width of the
// two pages", 11.13.1a) with a data column on each.
function facingColumnPlan(colWidths, gutter, w, colCount, headers = null, rows = null) {
  if (colCount < 3) return null;
  if (colWidths[0] <= w) {
    let used = colWidths[0], ci = 1;
    const left = [];
    for (; ci < colCount && used + gutter + colWidths[ci] <= w; ci++) { used += gutter + colWidths[ci]; left.push(ci); }
    if (ci >= colCount) return null;                     // the whole table fits one page
    const right = [];
    let rw = -gutter;
    for (let cj = ci; cj < colCount; cj++) { rw += gutter + colWidths[cj]; right.push(cj); }
    if (left.length && rw <= w) return { left, right, widths: colWidths.slice() };
  }
  if (!headers || !rows) return null;
  // The narrowest width at which each column's heading (wrapped 0/0) and entries (0/2, §11.6.1a) take at most two lines
  // without dividing a word (never below columnMinWidths, A27b); Infinity when even the natural width does not.
  const minW = columnMinWidths(headers, rows, colCount);
  const twoLine = colWidths.map((nat, ci) => {
    for (let cw = Math.max(1, minW[ci]); cw <= nat; cw++) {
      if (headers[ci] && wrapCells(headers[ci], cw, 0, 0).length > 2) continue;
      if (rows.every((r) => !r[ci] || wrapCells(r[ci], cw, 0, 2).length <= 2)) return cw;
    }
    return Infinity;
  });
  // One page's widths: every column at its two-line width, the cells to spare shared out one at a time to the columns
  // furthest below their natural width (fewer runovers); null when the columns do not fit the page.
  const pageWidths = (cols) => {
    const ws = cols.map((ci) => twoLine[ci]);
    let spare = w - ws.reduce((a, b) => a + b, 0) - gutter * (cols.length - 1);
    if (!(spare >= 0)) return null;
    for (;;) {
      let best = -1;
      cols.forEach((ci, k) => { if (ws[k] < colWidths[ci] && (best < 0 || colWidths[ci] - ws[k] > colWidths[cols[best]] - ws[best])) best = k; });
      if (best < 0 || spare <= 0) break;
      ws[best]++; spare--;
    }
    return ws;
  };
  const all = Array.from({ length: colCount }, (_, i) => i);
  for (let k = colCount - 2; k >= 1; k--) {
    const L = all.slice(0, k + 1), R = all.slice(k + 1);
    const lw = pageWidths(L), rw = lw && pageWidths(R);
    if (rw) return { left: L.slice(1), right: R, widths: [...lw, ...rw] };
  }
  return null;
}
// The facing-pages plan for a table (shared by resolveTableLayout and traceTable): only a top-level table
// (`facingPerPage`, set by buildDocPages; never inside a box or other block, which applyPageBoundaries cannot lay out
// as page pairs) and never under a two-tier column heading (§11.4.3; a primary heading spanning the page break has no
// rule — the same exclusion as vertical division).
const facingPlanFor = (c) => (c.facingPerPage > 0 && !c.headerGroups.length ? facingColumnPlan(c.colWidths, c.gutter, c.w, c.colCount, c.headers, c.rows) : null);
// The facing-pages fields of computeTableColumns' result (and of traceTable's mirror of it): the page length
// buildDocPages gives a top-level table (`_facingPerPage`; 0 inside a box), and verticalLead(n), formatVertical's own
// lines above its first section (heading, notes, blank lines) for verticalFitsOnePage.
function facingContext(block, o, w) {
  return {
    facingPerPage: block._facingPerPage > 0 && !(o._boxDepth > 0) ? block._facingPerPage : 0,
    verticalLead: (n) => {
      const t = tableTitleLines(block.title, o, w).length;
      const note = block.tabletn || block.note ? wrapCells(TN_OPEN + o.translate(block.tabletn || block.note).trim() + TN_CLOSE, w, 6, 4).length + 1 : 0;
      return (t ? t + 1 : 0) + note + wrapCells(TN_OPEN + o.translate(verticalDivisionTn(n)).trim() + TN_CLOSE, w, 6, 4).length + 1;
    },
  };
}
// K15 / BANA 11.14.1: "When a divided table takes more than a single page, the preferred format is to place the table
// on facing pages." Whether the vertically divided table (formatVertical's lines, less its leading/trailing blank) fits
// on one braille page. `c.verticalLead(n)` = the lines above its first section (heading, notes, blank lines).
function verticalFitsOnePage(c, sections) {
  let n = c.verticalLead(sections.length) + sections.length - 1;
  sections.forEach((cols) => {
    const all = [0, ...cols];
    n += renderVerticalSection(all.map((ci) => c.headers[ci]), c.rows.map((row) => all.map((ci) => row[ci])), all.map((ci) => c.colWidths[ci]), all.map((ci) => c.numPlans[ci]), c.gutter, c.w).length;
  });
  return n <= c.facingPerPage;
}
// K15: whether 'auto' (BANA) sets a table on facing pages when the column squeeze has failed and facingColumnPlan fits:
//  - it can be divided vertically (`sections`): only when the divided table would take more than one braille page —
//    BANA 11.14.1: "Divided tables should be on one braille page if possible ... When a divided table takes more than a
//    single page, the preferred format is to place the table on facing pages";
//  - it cannot be divided: only a table of figures, two or more columns holding nothing but numbers (numericColumnCount,
//    the "multiple columns of numbers" of 11.17.1/11.18.1a) — transcriber KD, of number-heavy tables: "I would try to put
//    the table across facing pages or divide it vertically before I would go all the way to a listed format, because
//    listed format really robs the reader of the spatial layout". Any other table keeps Listed, as before (the rule sets
//    no order among the wide-table formats, 11.12.2).
const facingAutoPreferred = (c, sections) => (sections ? !verticalFitsOnePage(c, sections) : numericColumnCount(c.rawRows, c.colCount) >= 2);
// The column-heading and row lines of a facing-pages table, each 2w cells wide (see above). `headers`/`rows` are
// traced cells ({ s, src }); formatTable passes its plain strings with null sources, so formatTable and traceTable
// share this one renderer and cannot drift (A39). Returns { lines, headLines, rowRanges: [[first, last] per row] }.
function renderFacingBody(headers, rows, natWidths, numPlans, plan, gutter, w, guideEnd, noFill, guideLead = 0) {
  const leftCols = [0, ...plan.left], rightCols = plan.right;
  const colWidths = plan.widths || natWidths;                  // facingColumnPlan's widths (natural, or squeezed per page)
  const nulls = (k) => Array.from({ length: Math.max(0, k) }, () => null);
  const spaces = (k) => ({ s: ' '.repeat(Math.max(0, k)), src: nulls(k) });
  const cat = (a, b) => ({ s: a.s + b.s, src: [...a.src, ...b.src] });
  const cut = (t, k) => ({ s: t.s.slice(0, k), src: t.src.slice(0, k) });
  const trimEnd = (t) => { let k = t.s.length; while (k > 0 && t.s[k - 1] === ' ') k--; return cut(t, k); };
  const pair = (l, r) => { const L = trimEnd(cut(l, w)), R = trimEnd(cut(r, w)); return R.s ? cat(cat(L, spaces(w - L.s.length)), R) : L; };
  const gap = (c) => { const g = gapText(c.lead, gutter); return { s: g, src: nulls(g.length) }; };   // always two cells (11.2.5b, K33)
  const join = (cells) => cells.reduce((acc, c, k) => (k ? cat(cat(acc, gap(cells[k - 1])), c.t) : c.t), { s: '', src: [] });
  const lines = [];
  // Column headings (§11.4.1, wrapped within the column) and the separation line (§11.4.2; none under a column without
  // a heading, 11.4.2c), which under the last left-hand column heading runs on to the right margin (11.13.1j).
  if (headers.some((h) => h.s.trim())) {
    const wrapped = headers.map((h, ci) => wrapCellsSrc(h.s, h.src, colWidths[ci], 0, 0));
    const hcell = (ci, li) => {
      const t = wrapped[ci].lines[li] || '';
      return { t: cat({ s: t, src: (wrapped[ci].srcs[li] || []).slice(0, t.length) }, spaces(colWidths[ci] - t.length)), lead: 0 };
    };
    const n = Math.max(1, ...wrapped.map((x) => x.lines.length));
    for (let li = 0; li < n; li++) lines.push(pair(join(leftCols.map((ci) => hcell(ci, li))), join(rightCols.map((ci) => hcell(ci, li)))));
    const scell = (ci) => (headers[ci].s.trim() ? { t: { s: TABLE_GUIDE + '3'.repeat(Math.max(0, colWidths[ci] - 1)), src: nulls(colWidths[ci]) }, lead: 0 } : { t: spaces(colWidths[ci]), lead: 0 });
    let left = join(leftCols.map(scell));
    if (headers[leftCols[leftCols.length - 1]].s.trim() && left.s.length < guideEnd) left = cat(left, { s: '3'.repeat(guideEnd - left.s.length), src: nulls(guideEnd - left.s.length) });
    lines.push(pair(left, join(rightCols.map(scell))));
  }
  const headLines = lines.length;
  // Rows (§11.6): runovers indented two cells in the column (11.6.1a), guide dots (11.6.1f/g, tableCellFill), place-value
  // alignment (11.6.1d), a blank spacer row as a blank line (§11.5.4, as columnar). Entries begin on the line on which the
  // row heading ends (11.6.1b) on both pages; the right-hand page has no row headings (11.13.1i).
  const plain = rows.map((r) => r.map((x) => x.s));
  const plans = numPlans.map((p, ci) => (p && colWidths[ci] >= p.width ? p : null));
  const anyRowHasContent = plain.some((r) => r.some((x) => x !== ''));
  const rowRanges = [];
  rows.forEach((row, ri) => {
    const start = lines.length;
    if (anyRowHasContent && plain[ri].every((x) => x === '')) { lines.push({ s: '', src: [] }); rowRanges.push([start, start]); return; }
    const wrapped = row.map((x, ci) => wrapCellsSrc(x.s, x.src, colWidths[ci], 0, 2));
    const headingLines = wrapped[0].lines.length;
    const offset = Math.max(0, headingLines - 1);
    const maxLines = Math.max(1, headingLines, ...wrapped.map((x, ci) => (ci === 0 ? 0 : offset + x.lines.length)));
    const implied = impliedRowHeading(plain[ri], plain);
    const cell = (ci, li, lastCol) => {
      const srcLi = ci === 0 ? li : li - offset;
      if (srcLi < 0) return { t: spaces(colWidths[ci]), lead: 0, text: null };   // the row heading is still running over
      const text = wrapped[ci].lines[srcLi] || '', tsrc = (wrapped[ci].srcs[srcLi] || []).slice(0, text.length);
      const { pre, post, lead } = tableCellFill(text, colWidths[ci], { firstLine: srcLi === 0, lastCol, numPad: plans[ci] ? plans[ci].pads[ri] : -1, implied: ci === 0 && implied, noFill, lead: guideLead });
      return { t: { s: pre + text + post, src: [...nulls(pre.length), ...tsrc, ...nulls(post.length)] }, lead, text, tsrc, pre, first: srcLi === 0 };
    };
    for (let li = 0; li < maxLines; li++) {
      const lc = leftCols.map((ci) => cell(ci, li, false));
      // 11.13.1k: the guide dots after the last left-hand column entry run on to the right margin (one space after the
      // entry, 11.6.1f; a blank entry is guide dots throughout). Only on the entry's first line (11.6.1g).
      const k = lc.length - 1, last = lc[k];
      const head = cat(join(lc.slice(0, k)), gap(lc[k - 1]));
      const at = head.s.length;
      if (last.text !== null && last.first && !noFill) {
        const reach = guideEnd - at;
        if (last.text === '') last.t = { s: TABLE_GUIDE.repeat(Math.max(colWidths[leftCols[k]], reach)), src: nulls(Math.max(colWidths[leftCols[k]], reach)) };
        else if (reach - last.pre.length - last.text.length >= 3) {
          const dots = reach - last.pre.length - last.text.length - 1;
          last.t = { s: last.pre + last.text + ' ' + TABLE_GUIDE.repeat(dots), src: [...nulls(last.pre.length), ...last.tsrc, ...nulls(dots + 1)] };
        }
      }
      const left = cat(cat(head, spaces(at - head.s.length)), last.t);
      lines.push(pair(left, join(rightCols.map((ci, j) => cell(ci, li, j === rightCols.length - 1)))));
    }
    rowRanges.push([start, lines.length - 1]);
  });
  return { lines, headLines, rowRanges };
}
// The whole facing-pages table block (lines of the caller's kind: `mk` makes one from a string; `titleLines` and `body`
// are already of that kind). BANA 11.13.1e: "place all transcriber's notes and table headings above the top box line";
// Sample 11-21: the note, a blank line, the centred heading (11.13.1g: on the left-hand page only), then the top box
// line, which "serves as a locator on the right facing page and must be followed by column headings on the next line".
// UKAAF (B004 App E Example 2): the heading, the note, a blank line, the column headings; no box lines. The note is the
// rule's own sample wording (11.13.1c), followed in the same note by the table's own note / guide-dot note and key list
// (as columnar, K8). The source (block.citation) goes on the line after the table on the left-hand page only (11.13.1h,
// 'FC'); the BANA alternative "If the entire source will not fit on the page with the table, place the source on the
// line following the table heading. Block the source 4 cells to the right of the beginning of the last line of the
// heading" is emitted too ('FA') and placeFacingTable keeps exactly one of the two.
function assembleFacingTable(block, o, w, noteParas, titleLines, body, mk) {
  const bana = isBanaOpts(o);
  const str = (x) => (typeof x === 'string' ? x : x.s);
  const out = [mk('')];
  const groups = [];
  const group = (from, tag) => { if (out.length > from) groups.push([from, out.length - 1, tag]); };
  const paras = [bana ? FACING_TN.bana : FACING_TN.ukaaf, ...noteParas];
  let tn = tableKeyNoteLines(block, o, w, paras);
  if (!tn.length) paras.forEach((p, i) => tn.push(...wrapCells((i === 0 ? TN_OPEN : '') + o.translate(p).trim() + (i === paras.length - 1 ? TN_CLOSE : ''), w, bana ? 6 : 2, bana ? 4 : 0)));
  const cite = tableCitation(block);
  const citeBrl = cite ? o.translate(cite.text).trim() : '';
  let from = out.length;
  if (bana) {
    out.push(...tn.map(mk), mk(''));
    if (titleLines.length) out.push(...titleLines);
    group(from, 'FL');
    if (citeBrl && titleLines.length) {
      const lastTitle = str(titleLines[titleLines.length - 1]);
      const ind = Math.min(w - 1, lastTitle.length - lastTitle.trimStart().length + 4);
      from = out.length; out.push(...wrapCells(citeBrl, w, ind, ind).map(mk)); group(from, 'FA');
    }
    from = out.length; out.push(mk('7'.repeat(2 * w))); group(from, 'FT');   // the box lines run across both pages (Sample 11-21)
  } else {
    out.push(...titleLines, ...tn.map(mk), mk(''));
    group(from, 'FL');
  }
  from = out.length; out.push(...body.lines.slice(0, body.headLines)); group(from, 'FH');
  body.rowRanges.forEach(([a, b], ri) => { from = out.length; out.push(...body.lines.slice(a, b + 1)); group(from, 'FR' + ri); });
  if (bana) { from = out.length; out.push(mk('G'.repeat(2 * w))); group(from, 'FB'); }
  if (citeBrl) { from = out.length; out.push(...wrapCells(citeBrl, w, 4, 4).map(mk)); group(from, 'FC'); }
  out.push(mk(''));
  Object.defineProperty(out, 'keepGroups', { value: groups });   // non-enumerable: lines still compare as plain arrays
  return out;
}
// Page plan for a facing-pages table (applyPageBoundaries' placeFacingTable). `g` = the block's tagged content line
// indexes ({ lead, alt, top, head, rows: [[...]], bottom, cite }); `cap0` = body lines free on the first left-hand page,
// `perPage` = body lines of a page, `rh` = line 1 carries a running head. Returns { before, pairs, after }: `before` =
// lead lines that go on the page(s) before the table (11.13.1d: "The table takes precedence on the facing pages, and
// any related content that does not fit must be on the previous page"), each pair = { lines, leftOnly } — the lines of
// the left-hand page in order (null = blank line); the right-hand page repeats the same sequence with the right halves,
// blank where leftOnly — and `after` = source lines that fit neither place (placed after the table).
//  - The first pair: the lead (when it fits there with the top box line, the headings and the first row), then the top
//    box line on line 2 (after the print page number; line 3, after a blank line, when a running head is used:
//    11.13.1f) and the column headings.
//  - Each later pair: the column headings repeated (11.4.4a), after a blank line when a running head is used (11.4.4b).
//  - Rows are never divided between pairs when they fit a page (11.2.6d: "Insert the page break at the beginning of a
//    new row"); the bottom box line stays with the last row (7.3.5b).
function planFacingPages(g, { cap0, perPage, rh, forceLead = false }) {
  const plan = (leadOnLeft, withAlt) => {
    const rows = g.rows.map((r) => r.slice());
    const pairs = [];
    let r = 0, first = true;
    while ((first || r < rows.length) && pairs.length < 100000) {
      const cap = first ? cap0 : perPage;
      const lines = [], leftOnly = [];
      const push = (x, lo = false) => { lines.push(x); leftOnly.push(lo); };
      if (first && leadOnLeft) { g.lead.forEach((x) => push(x, true)); if (withAlt) g.alt.forEach((x) => push(x, true)); }
      const opener = first && g.top != null ? [g.top] : [];
      if (!lines.length && rh) push(null);
      opener.forEach((x) => push(x));
      g.head.forEach((x) => push(x));
      let placed = 0;
      while (r < rows.length) {
        const tail = r === rows.length - 1 && g.bottom != null ? 1 : 0;
        if (lines.length + rows[r].length + tail <= cap) { rows[r].forEach((x) => push(x)); r++; placed++; continue; }
        if (!placed) {                                   // a row taller than the page: divided (11.2.6d "If necessary")
          rows[r].splice(0, Math.max(1, cap - lines.length)).forEach((x) => push(x));
          if (!rows[r].length) r++;
          placed++;
          continue;
        }
        break;
      }
      if (r >= rows.length && g.bottom != null) push(g.bottom);
      pairs.push({ lines, leftOnly });
      first = false;
    }
    return pairs;
  };
  const firstNeed = (withAlt) => g.lead.length + (withAlt ? g.alt.length : 0) + (g.top != null ? 1 : 0) + g.head.length + (g.rows.length ? g.rows[0].length : 0) + (g.rows.length <= 1 && g.bottom != null ? 1 : 0);
  const build = (withAlt) => {
    const leadOnLeft = forceLead || firstNeed(withAlt) <= cap0;
    return { leadOnLeft, pairs: plan(leadOnLeft, withAlt), withAlt };
  };
  let res = build(false);
  let after = [];
  if (g.cite.length) {
    const last = res.pairs[res.pairs.length - 1];
    if (last.lines.length + g.cite.length <= (res.pairs.length === 1 ? cap0 : perPage)) g.cite.forEach((x) => { last.lines.push(x); last.leftOnly.push(true); });
    else if (g.alt.length) res = build(true);
    else after = g.cite.slice();
  }
  const before = res.leadOnLeft ? [] : [...g.lead, ...(res.withAlt ? g.alt : [])];
  return { before, pairs: res.pairs, after, altUsed: res.withAlt };
}
// T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026): BANA §11.18 Stairstep and §11.17 Linear —
// two SELECTABLE wide-table formats (`block.format = 'stairstep' | 'linear'`). Unlike vertical
// division they are never chosen by 'auto' (Paul: "selectable"); a table that does not qualify
// falls back to Listed/paragraph exactly as an unfittable 'vertical' table does. BANA only:
// neither format exists in UKAAF B004, so in UKAAF mode they fall back to paragraph form.
//
// Qualifying tests (mechanical parts of the rules only — the judgement parts are left to the
// transcriber, who chose the format):
//  - 11.18.1 "Limit this format to tables with four or fewer columns. For larger tables use the
//    Listed Table Format in Formats, §11.16."
//  - 11.17.1 / 11.18.1a "Multiple columns of numbers ... are not appropriate" — two or more
//    columns whose every non-blank entry is a number disqualify the table (Paul's own wording
//    of the decision: "≤4 non-numeric columns").
//  - 11.17.1 "This format is not an option when there are colons or semicolons in the table."
//  - both formats name every column heading in the transcriber's note (11.17.1d, 11.18.1c), so
//    every column needs a heading; 11.18.1k "Headings may be devised when there are none in
//    print" is the transcriber's own act (type the devised headings into the table), not
//    something Emboss invents. A two-tier heading (headerGroups, §11.4.3) has no place in
//    either note and falls back, as for vertical division.
//  - "repetitive types of entries (e.g., proper names)", "nonintuitive column entries"
//    (11.17.1, 11.18.1a) and "when context does not clearly indicate what the column level or
//    heading is, choose another format" (11.18.1h) are transcriber judgements, not checked.
const STAIRSTEP_MAX_COLUMNS = 4;
// 11.18.1c sample: "Table changed as follows:"
const STAIRSTEP_TN = 'Table changed as follows:';
// 11.18.1l sample: "A series of three guide dots indicates a blank entry."
const STAIRSTEP_BLANK_TN = 'A series of three guide dots indicates a blank entry.';
// 11.17.1d sample: "Columns follow one another in this order:"
const LINEAR_TN = 'Columns follow one another in this order:';
// 11.17.1k: "Insert three unspaced dot 5s to represent a blank entry in print ... Sample: A series
// of three dot 5s indicates a blank entry." The worked example (Sample 11-25) words it "A
// series of three dot 5s indicates a blank space in print." — the gold sample's own wording.
const LINEAR_BLANK_TN = 'A series of three dot 5s indicates a blank space in print.';
// 11.17.1c: "Insert a colon after the first column heading and a semicolon after each internal
// column." Braille-ASCII of ':' and ';' (Sample 11-25: `,alabama3 ,montgom]y2`), used only
// after a blank entry's three dot 5s — a punctuation mark translated alone would pick up a
// grade-1 indicator (";" alone is ";2"), so text entries take their mark inside their own
// translate call instead.
const LINEAR_PUNCT_BRL = { ':': '3', ';': '2' };
const linearPunct = (ci, colCount) => (ci === 0 ? ':' : (ci < colCount - 1 ? ';' : ''));

// How many columns hold nothing but numbers (§11.17.1/§11.18.1a "columns of numbers").
function numericColumnCount(rawRows, colCount, skipRows) {
  let n = 0;
  for (let ci = 0; ci < colCount; ci++) {
    let any = false, all = true;
    rawRows.forEach((r, ri) => {
      if (skipRows && skipRows.has(ri)) return;
      const t = cellPlainText(r[ci]);
      if (t.trim() === '') return;
      any = true;
      if (numericFrac(t) < 0) all = false;
    });
    if (any && all) n++;
  }
  return n;
}
// TBL-NUM-1 / BANA §11.7.1j: "Tables consisting solely of numbers in the row headings and
// column entries may use the numeric passage indicator" — true only when EVERY column
// (including the row-heading column, ci 0) is all-numeric (numericColumnCount === colCount);
// column HEADINGS (Mon/Tue/.../Fri in Example 11-9) are text and untouched either way. Off
// by default (`block.numericPassage`); not attempted alongside a two-tier header
// (headerGroups, §11.4.3), a secondary row heading (rowSubheadings, §11.5.1b) or a stairstep
// subdivision heading (subdivisionRows, §11.18.1j) — no gold table in this section combines
// the numeric passage indicator with any of those, and where it would open/close relative to
// them is unanswered by the rule text; computeTableColumns/traceTable fall back to plain
// numeral translation for such a table and record a `table-fallback` warning instead (see
// formatTable/traceTable). BANA only (isBana) — UEB §6.9 is common to both standards, but
// this section's own material and B004's §12 tables never combine numbers with the
// indicator, so UKAAF is left for a future decision.
function numericPassageEligible(block, rawRows, colCount, isBana) {
  return !!(isBana && block && block.numericPassage
    && colCount > 0 && rawRows.length > 0
    && !(Array.isArray(block.headerGroups) && block.headerGroups.length)
    && !tableRowSubMap(block, rawRows.length).size
    && !(Array.isArray(block.subdivisionRows) && block.subdivisionRows.length)
    && numericColumnCount(rawRows, colCount) === colCount);
}
// UEB §6.9: strip the per-entry numeral sign (this codebase's ASCII-braille leading '#',
// BRF64) from every already-translated numeric cell in `rows` (mutated in place), then open
// the passage with '##' on the very first non-blank entry and close it with "#'" on the very
// last — row-major reading order, top row to bottom, left column to right, over every column
// (only ever called once numericPassageEligible has confirmed every column is all-numeric).
// Gold-verified against Example 11-9: the row-heading column's own entries (1/2/3, read as
// the digit-letters a/b/c once their numeral signs are gone) take part exactly as any other
// column — row 1's heading is the table's first entry, so it carries the opening marker.
function applyNumericPassageMarks(rows, colCount) {
  let firstPos = null, lastPos = null;
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < colCount; ci++) {
      const cell = rows[ri][ci];
      if (!cell) continue;
      if (cell.charAt(0) === '#') rows[ri][ci] = cell.slice(1);
      if (!firstPos) firstPos = [ri, ci];
      lastPos = [ri, ci];
    }
  }
  if (firstPos) { const [r, c] = firstPos; rows[r][c] = NUMERIC_PASSAGE_OPEN + rows[r][c]; }
  if (lastPos) { const [r, c] = lastPos; rows[r][c] = rows[r][c] + NUMERIC_PASSAGE_CLOSE; }
}
// Traced mirror of applyNumericPassageMarks: `rowTrs[ri][ci]` is a {s, src} pair (traceTable's
// own per-cell translation); the marker characters are transcriber-devised, not sourced from
// print, so they get null src entries — the same convention as tcDeco/TN_OPEN/TN_CLOSE.
function applyNumericPassageMarksTraced(rowTrs, colCount) {
  let firstPos = null, lastPos = null;
  for (let ri = 0; ri < rowTrs.length; ri++) {
    for (let ci = 0; ci < colCount; ci++) {
      const cell = rowTrs[ri][ci];
      if (!cell || !cell.s) continue;
      if (cell.s.charAt(0) === '#') rowTrs[ri][ci] = { s: cell.s.slice(1), src: cell.src.slice(1) };
      if (!firstPos) firstPos = [ri, ci];
      lastPos = [ri, ci];
    }
  }
  if (firstPos) { const [r, c] = firstPos; const cell = rowTrs[r][c]; rowTrs[r][c] = { s: NUMERIC_PASSAGE_OPEN + cell.s, src: [null, null, ...cell.src] }; }
  if (lastPos) { const [r, c] = lastPos; const cell = rowTrs[r][c]; rowTrs[r][c] = { s: cell.s + NUMERIC_PASSAGE_CLOSE, src: [...cell.src, null, null] }; }
}
// The transcriber's note BANA §11.7.1j requires ("Place a transcriber's note before the
// table to inform the reader of this format") and §11.7.1l's "these symbols are required on
// the Special Symbols page" — each symbol preceded by the dot locator for mention (UEB
// §3.3.1, '.=', the SAME literal convention formatTnKeyList's `keyLocator`/BANA §2.5.2c use
// for a symbol being MENTIONED rather than used functionally) since the note names the
// symbols themselves. Gold-verified against Example 11-9's own note: an intro line (6-4
// margins, TN_OPEN), a blank line, then each symbol (0-2 margins, no blank between them),
// the last carrying TN_CLOSE. (Whether these two symbols also need an entry on the
// document's own Special Symbols page, §2.5, is a separate, front-matter-wide mechanism —
// collectSpecialSymbols — this decision does not wire them into; see the task report.)
const NUMERIC_PASSAGE_NOTE_INTRO = 'Symbols used below:';
const NUMERIC_PASSAGE_NOTE_ITEMS = [[NUMERIC_PASSAGE_OPEN, 'Numeric passage indicator'], [NUMERIC_PASSAGE_CLOSE, 'Numeric terminator']];
function numericPassageNoteLines(o, w) {
  const out = wrapCells(TN_OPEN + o.translate(NUMERIC_PASSAGE_NOTE_INTRO).trim(), w, 6, 4);
  out.push('');
  NUMERIC_PASSAGE_NOTE_ITEMS.forEach(([sym, meaning], i, a) => {
    out.push(...wrapCells('.=' + sym + ' ' + o.translate(meaning).trim() + (i === a.length - 1 ? TN_CLOSE : ''), w, 0, 2));
  });
  return out;
}
// Traced mirror of numericPassageNoteLines: transcriber-devised wording, not sourced from
// print — every line is plain decoration (tcDeco), like formatTnKeyList's own key-list lines.
function tcNumericPassageNoteLines(o, w) {
  const out = tcWrap(o, tcDeco(TN_OPEN + o.translate(NUMERIC_PASSAGE_NOTE_INTRO).trim()), w, 6, 4);
  out.push(tcBlank);
  NUMERIC_PASSAGE_NOTE_ITEMS.forEach(([sym, meaning], i, a) => {
    out.push(...tcWrap(o, tcDeco('.=' + sym + ' ' + o.translate(meaning).trim() + (i === a.length - 1 ? TN_CLOSE : '')), w, 0, 2));
  });
  return out;
}
// §11.18.1j row indexes (`block.subdivisionRows`) that are subdivision headings, kept within the rows.
const subdivisionRowSet = (raw, rowCount) => new Set((Array.isArray(raw) ? raw : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < rowCount));
// Whether the table can be a stairstep table; the plan ({ sub: Set of subdivision row indexes,
// subHeading }) or null (fall back).
function stairstepPlan(bana, subRowsRaw, subHeadingRaw, rawHeaders, rawRows, colCount, has, headerGroups) {
  if (!bana || headerGroups.length || colCount > STAIRSTEP_MAX_COLUMNS) return null;
  for (let ci = 0; ci < colCount; ci++) if (!has(rawHeaders[ci])) return null;
  const sub = subdivisionRowSet(subRowsRaw, rawRows.length);
  // 11.18.1j: the subdivision heading is named in the note's key, so it needs its own text.
  if (sub.size && !has(subHeadingRaw)) return null;
  if (numericColumnCount(rawRows, colCount, sub) >= 2) return null;
  return { sub, subHeading: sub.size ? String(subHeadingRaw).trim() : '' };
}
function linearAllowed(bana, rawHeaders, rawRows, colCount, has, headerGroups) {
  if (!bana || colCount < 2 || headerGroups.length) return false;
  for (let ci = 0; ci < colCount; ci++) if (!has(rawHeaders[ci])) return false;
  const cells = [...rawHeaders, ...rawRows.flat()];
  if (cells.some((v) => /[:;]/.test(cellPlainText(v)))) return false;   // 11.17.1: colons/semicolons rule the format out
  return numericColumnCount(rawRows, colCount, null) < 2;
}
// The note's paragraphs (a source table note first), each 7-5, in one transcriber's note; the
// blank-entry explanation precedes the format's own sentence because the sentence introduces
// the heading list that closes the note (11.17.1b, 11.18.1c; Sample 11-25 orders them so).
function bodyTnParagraphs(block, hasBlank, blankTn, formatTn) {
  const paras = [];
  if (block.tabletn || block.note) paras.push(String(block.tabletn || block.note));
  if (hasBlank) paras.push(blankTn);
  paras.push(formatTn);
  return paras;
}
// 11.18.1e: "Use 1-1 margins for the first column of each row, 3-3 margins for the second column,
// 5-5 margins for the third column, and 7-7 margins for the fourth column." Column ci is
// blocked at cell 2*ci+1. 11.18.1f: "When a column entry has multiple paragraphs, indent the
// second and following paragraphs two cells to the right of the margin, e.g., 3-3, 5-3." — an
// entry's paragraphs are its '\n'-separated parts (wrapCells' own paragraph convention).
function stairstepEntryLines(text, ci, w) {
  const m = 2 * ci;
  const out = [];
  String(text).split('\n').filter((p) => p !== '').forEach((p, pi) => out.push(...wrapCells(p, w, pi === 0 ? m : m + 2, m)));
  return out;
}
// Traced counterpart of stairstepEntryLines' paragraph split: a traced entry's '\n'-separated paragraphs.
function tcSplitParagraphs(tr) {
  const out = [];
  let s = '', src = [];
  for (let i = 0; i < tr.s.length; i++) {
    if (tr.s[i] === '\n') { if (s) out.push({ s, src }); s = ''; src = []; continue; }
    s += tr.s[i]; src.push(tr.src[i] ?? null);
  }
  if (s) out.push({ s, src });
  return out;
}
// BANA Formats §11.16 Listed Table Format: the transcriber's note explaining the change to
// print format (l, sample wording), the note for blank entries (h), and the three unspaced
// guide dots (dot 5) that stand for a blank entry.
const LISTED_TN = 'Print format is changed. Row headings are blocked in cell 5; column headings begin in cell 1. All headings are repeated for clarity. A colon separates headings from table entries.';
const LISTED_BLANK_TN = 'A series of three guide dots indicates a blank entry in print.';
const LISTED_BLANK = '"""';
// 24 Sep re-check, problem 5: a listed table with no headings at all (formatListed's noHeadings: every entry alone, no
// "heading: " prefix, no colon) must not be told it has headings that are "repeated for clarity" and a colon after them.
// The note then says only what the layout does: the first entry of each row blocked in cell 5 (4-4 margins), the others
// from cell 1 (0-2 margins), as 11.16.1l's note does for a table with headings.
const LISTED_TN_NO_HEADINGS = 'Print format is changed. The first entry of each row is blocked in cell 5; the other entries of the row begin in cell 1.';
// The note's paragraphs (a source table note first), each in 7-5 inside one TN (Sample 11-24).
function listedTnParagraphs(block, rawRows, colCount, has, noHeadings = false) {
  const paras = [];
  if (block.tabletn || block.note) paras.push(String(block.tabletn || block.note));
  paras.push(noHeadings ? LISTED_TN_NO_HEADINGS : LISTED_TN);
  if (rawRows.some((r) => Array.from({ length: colCount }, (_, ci) => r[ci]).some((v, ci) => ci > 0 && !has(v)))) paras.push(LISTED_BLANK_TN);
  return paras;
}

// F-20 / BANA 11.6.4 ("Use guide dots across the width of a column to indicate a blank space or a blank to be
// filled in. Explain the series of guide dots in a transcriber's note."): optional `guideDotNote` on a table
// (true = the wording below, or the transcriber's own string) adds that explanation as a paragraph of the
// table's opening note in the columnar (spatial) format, only when a real blank ENTRY occurs (a blank cell
// in a row that has some other content - a wholly blank row is a blank line, not a guide-dot entry, F-2).
// Default off: the note wording is the transcriber's, so nothing is added unasked.
const GUIDE_DOT_TN = 'Guide dots indicate a blank entry in print.';
function columnarTnParagraphs(block, rawRows, colCount, has) {
  const paras = [];
  if (block.tabletn || block.note) paras.push(String(block.tabletn || block.note));
  if (block._interchangeTn) paras.push(block._interchangeTn);   // BANA 11.15.1 / B004 App E (interchangedTable)
  if (block.guideDotNote && block.guideDots !== false
    && rawRows.some((r) => Array.from({ length: colCount }, (_, ci) => r[ci]).some((v, ci) => !has(v)) && Array.from({ length: colCount }, (_, ci) => r[ci]).some((v) => has(v)))) {
    paras.push(typeof block.guideDotNote === 'string' && block.guideDotNote.trim() ? block.guideDotNote.trim() : GUIDE_DOT_TN);
  }
  return paras;
}

// K8 / BANA 11.8.1-11.8.2: a table's key list (block.key: [{ symbol, meaning, group? }], group 'row' or
// column/unset). Column items first, row items after, each alphabetised by symbol (11.8.2n) — the BANA
// examples alphabetise by the key letters themselves, not by what they stand for. Only built for the
// columnar (spatial) layout so far (formatColumnar / traceColumnar); other table formats don't render it.
function tableKeyGroups(block) {
  const items = Array.isArray(block.key) ? block.key.filter((it) => it && typeof it === 'object' && String(it.symbol ?? '').trim() && String(it.meaning ?? '').trim()) : [];
  const bySymbol = (a, b) => String(a.symbol).localeCompare(String(b.symbol));
  return {
    col: items.filter((it) => it.group !== 'row').sort(bySymbol),
    row: items.filter((it) => it.group === 'row').sort(bySymbol),
  };
}
// BANA 11.8.2a's own wording, or the transcriber's (block.keyIntro): only "and row" when both groups are used.
function tableKeyIntroText(block, col, row) {
  const own = typeof block.keyIntro === 'string' ? block.keyIntro.trim() : '';
  if (own) return own;
  if (col.length && row.length) return 'Key to column and row headings:';
  if (row.length) return 'Key to row headings:';
  return 'Key to column headings:';
}
// The whole key-list transcriber's note (11.8.2): `leadParas` (the table's own note / F-20's guide-dot note,
// plain untranslated text) come first in the SAME note, the key list always last (11.8.2i) — cell-5 "Column
// headings"/"Row headings" only when both groups are present (11.8.2m), else the items follow the intro line
// directly (Sample 11-8). No blank lines inside the note; the blank line before/after it is the caller's
// (formatColumnar already leaves one after the title and pushes one once this returns, as for a plain note).
// Returns [] when the table carries no usable key item.
function tableKeyNoteLines(block, o, w, leadParas) {
  const { col, row } = tableKeyGroups(block);
  if (!col.length && !row.length) return [];
  const paras = [...(leadParas || []), tableKeyIntroText(block, col, row)];
  const out = [];
  paras.forEach((p, i) => out.push(...wrapCells((i === 0 ? TN_OPEN : '') + o.translate(p).trim(), w, 6, 4)));
  const pushItems = (label, arr, isLastGroup) => {
    if (!arr.length) return;
    if (label) out.push(...wrapCells(o.translate(label).trim(), w, 4, 4));
    arr.forEach((it, i) => {
      const lastLine = isLastGroup && i === arr.length - 1;
      out.push(...wrapCells(o.translate(`${it.symbol} ${it.meaning}`).trim() + (lastLine ? TN_CLOSE : ''), w, 0, 2));
    });
  };
  if (col.length && row.length) { pushItems('Column headings', col, false); pushItems('Row headings', row, true); }
  else pushItems(null, col.length ? col : row, true);
  return out;
}
// Traced mirror of tableKeyNoteLines (A39): the key list is transcriber-devised text, not sourced from print,
// so every line is plain decoration (tcDeco) — like a box border or a rule line.
function tcTableKeyNoteLines(block, o, w, leadParas) {
  return tableKeyNoteLines(block, o, w, leadParas).map((l) => tcDeco(l));
}

// The transcriber's note that opens the UKAAF paragraph-form table (B004 §12 Example 2:
// "[The following table is brailled in paragraph form. Each entry gives: Date;
// Description; Money out; Money in; Balance.]").
const paragraphFormTn = (names) => `The following table is brailled in paragraph form. Each entry gives: ${names.join('; ')}.`;

// BANA 11.16.1g (KD, the BANA transcriber, 28 Sep 2026 — the March 2024 errata's reason
// for Sample 11-24 line 15): a listed-table cell can hold more than one entry (print shows
// several office-holders, one per line, in a single cell — Sample 11-24's Secretary of
// State/Treasury/War/Navy columns). A cell's entries are '\n'-separated (see cell-markup.mjs
// and parse.mjs's brAsNewline for how that reaches the model); this splits a cell's own
// segments on embedded '\n' into one segs array per entry, keeping each entry's typeform
// (mirrors tcSplitParagraphs, the traced counterpart, for un-traced segs).
function splitCellEntries(segs) {
  const out = [];
  let cur = [];
  for (const g of segs) {
    if (g.type === 'text' && typeof g.text === 'string' && g.text.includes('\n')) {
      String(g.text).split('\n').forEach((part, i) => {
        if (i > 0) { out.push(cur); cur = []; }
        if (part !== '') cur.push({ ...g, text: part });
      });
    } else {
      cur.push(g);
    }
  }
  out.push(cur);
  return out;
}
// Cell segments with whitespace collapsed and the ends trimmed.
function trimSegs(segs) {
  const out = segs.map((g) => (g.type === 'text' ? { ...g, text: String(g.text || '').replace(/\s+/g, ' ') } : g));
  if (out[0] && out[0].type === 'text') out[0].text = out[0].text.replace(/^ /, '');
  const n = out.length - 1;
  if (n >= 0 && out[n].type === 'text') out[n].text = out[n].text.replace(/ $/, '');
  return out.filter((g) => g.type !== 'text' || g.text);
}

// A listed table's "heading:" (BANA 11.16.1d "Each column heading is followed by a colon"). The colon is Emboss's, not
// print's. UEB 9.7.3: "ignore a change in typeform for closing punctuation when a typeform word indicator is used", and
// 9.7.2: "When there is doubt, except for the hyphen, dash and ellipsis, consider the punctuation as being included in
// the typeform". So when the heading ends in emphasised text the colon takes the same typeform: a bold one-word heading
// is `^1,DEF9I;N3` (BrailleBlaster: `^1,A2REVIA;NS3`), not `^1,DEF9I;N^'3` (24 Sep re-check, problem 3: 745 terminators
// in the anthology). A passage indicator's terminator then follows the colon. A plain heading keeps a plain colon.
// Returns the colon segment to append to the heading's segments.
function listedColonSeg(h) {
  const last = Array.isArray(h) ? h[h.length - 1] : null;
  return last && last.type === 'text' && last.tf && !last.uncontracted && !last.hyperlink ? { type: 'text', text: ':', tf: last.tf } : null;
}
// heading + ':' + sep + b, the colon typeformed as above.
function joinListedHead(h, sep, b) {
  const c = listedColonSeg(h);
  if (!c) return joinSegs(h, ':' + sep, b);
  return sep || b.length ? joinSegs([...h, c], sep, b) : [...h, c];
}
// A62 (Paul, 26 Sep): a paragraph-form row (B004 §12) ends with a full stop, unless its last entry
// already ends with sentence punctuation (. ? !), allowing closing quotes or brackets after it.
function rowEndsWithStop(rawRow, colCount, has) {
  const last = rawRow[colCount - 1];
  return has(last) && /[.?!]["'\u201d\u2019)\]]*$/.test(cellPlainText(last).trim());
}
// a + plain separator + b, merging adjacent plain runs so plain cells stay one translate call.
// A hyperlinked run is not plain (F-233 / LINK-1: groupSegments keeps it in its own group for the
// indicator pair); merging it into a neighbour dropped `hyperlink` (or spread it over the neighbour),
// so a linked run in a listed table cell lost its indicator in formatBlock but not in traceBlock.
const isPlainTextSeg = (g) => !!g && g.type === 'text' && !g.tf && !g.uncontracted && !g.hyperlink;
function joinSegs(a, sep, b) {
  const out = [];
  const push = (g) => {
    const last = out[out.length - 1];
    if (isPlainTextSeg(g) && isPlainTextSeg(last)) last.text += g.text;
    else out.push({ ...g });
  };
  [...a, { type: 'text', text: sep }, ...b].forEach(push);
  return out;
}

// Shared table layout prep: translated headers/rows, natural column widths and the
// resolved format mode. Used by both formatTable (rendering) and tableLayout (the
// editor's too-wide warning, G15) so the two computations can never disagree.
function computeTableColumns(block, o) {
  const rawHeaders = Array.isArray(block.headers) ? block.headers : [];
  const rawRows = (Array.isArray(block.rows) ? block.rows : []).map((r) => (Array.isArray(r) ? r : (r == null ? [] : [r])));
  const w = o.width || 38;

  // Format mode resolution: block-level format/style takes highest priority
  let mode = block.format || block.style || o.tableFormat || 'auto';
  if (mode === 'table-listed') mode = 'listed';
  if (mode === 'table-spatial') mode = 'spatial';
  if (mode === 'spatial') mode = 'columnar';

  const colCount = Math.max(rawHeaders.length, ...rawRows.map((r) => r.length));
  if (!(colCount > 0)) return { rawHeaders, rawRows, w, mode, colCount: 0, bana: o.mode === 'bana', numericPassageOk: false };

  // Translate all cells. A cell is a markup string or { text, segments } (format/cell-markup.mjs).
  const has = (v) => !cellIsBlank(v);
  const segsBraille = (segs) => {
    // A61 (Paul, 26 Sep): a cell that is only a link (or another transcriber-defined typeform) is not
    // plain text either: it keeps its indicator in every table format (LINK-1).
    const rich = segs.length > 1 || (segs[0] && (segs[0].tf || segs[0].hyperlink || segs[0].transcriberTypeform || segs[0].uncontracted || segs[0].type === 'math' || segs[0].type === 'imgnote' || segs[0].type === 'brl' || (o.foreignText && foreignLangIndex(segs[0].lang))));   // K16: a foreign cell (foreignText); imgnote: a picture alone in a cell keeps its TN indicators; brl: literal braille cells (a BrailleBlaster-style cell with no print text of its own)
    if (rich) return segmentsToBraille(segs, o).replace(/\s+$/, '');
    return o.translate(segs.map((g) => g.text || '').join('')).replace(/\s+$/, '');
  };
  // F-16 / BANA 11.6.6 (see the module-level DITTO_RE/DITTO_BRL comment): opt-in per table via `block.dittoMarks`.
  const tr = (v) => {
    if (!has(v)) return '';
    if (block.dittoMarks && DITTO_RE.test(cellPlainText(v).trim())) return DITTO_BRL;
    return segsBraille(trimRunEdges(cellSegments(v)));   // spaces at a cell's edges do not count (A89); its inside (a second paragraph's line break) is kept
  };

  const headers = rawHeaders.map(tr);
  while (headers.length < colCount) headers.push('');
  const rows = rawRows.map((r) => {
    const row = r.map(tr);
    while (row.length < colCount) row.push('');
    return row;
  });

  // TBL-NUM-1 / BANA §11.7.1j-l (numericPassageEligible/applyNumericPassageMarks above):
  // marks are applied to the already-translated `rows` HERE, before colWidths below, so the
  // marked/unmarked width difference is what actually gets laid out — Example 11-9's own
  // row-heading column is 3 cells wide only because its very first entry carries the
  // two-cell '##' marker, not because every row-heading entry does.
  const numericPassageOk = numericPassageEligible(block, rawRows, colCount, o.mode === 'bana');
  if (numericPassageOk) applyNumericPassageMarks(rows, colCount);

  // Natural column widths. A numeric column (§11.6.1d) is at least as wide as its
  // place-value-aligned entries (widest integer part + longest fraction) — only when
  // place-value alignment actually applies to that column (K3: numericAlignApplies, print's
  // own alignment via block.printAlign, transcriber override via block.columnAlign).
  // A numeric-passage column skips place-value alignment (numPlans stays null for every
  // column) — the marker characters distort a cell's raw length away from its actual digit
  // count in a way numericColumnPlan never accounts for, and no gold table combines the two.
  const colAlign = Array.isArray(block.columnAlign) ? block.columnAlign : [];
  const printAlign = Array.isArray(block.printAlign) ? block.printAlign : [];
  const numPlans = numericPassageOk ? Array(colCount).fill(null) : Array.from({ length: colCount }, (_, c) => {
    const rawCol = rawRows.map((r) => cellPlainText(r[c]));
    return numericAlignApplies(colAlign[c], printAlign[c]) ? numericColumnPlan(rawCol, rows.map((r) => r[c])) : null;
  });
  const colWidths = Array(colCount).fill(1);
  for (let c = 0; c < colCount; c++) {
    if (headers[c]) colWidths[c] = Math.max(colWidths[c], headers[c].length);
    for (const r of rows) {
      if (r[c]) colWidths[c] = Math.max(colWidths[c], r[c].length);
    }
    if (numPlans[c]) colWidths[c] = Math.max(colWidths[c], numPlans[c].width);
  }
  // BANA 11.5.1b (block.rowSubheadings): the primary row headings share the row-heading column's width, and a
  // secondary row heading is indented two cells (3-5 margins).
  const rowSubs = new Map();
  for (const [r, text] of tableRowSubMap(block, rows.length)) rowSubs.set(r, tr(text));
  const subFrom = tableSubIndentFrom(rowSubs);
  for (const t of rowSubs.values()) colWidths[0] = Math.max(colWidths[0], t.length);
  rows.forEach((r, ri) => { if (ri >= subFrom && r[0]) colWidths[0] = Math.max(colWidths[0], r[0].length + 2); });

  // BANA §11.4.3: a second, primary heading tier over two or more sub-columns
  // (`block.headerGroups = [{ text, from, to }]`, 0-based inclusive column span —
  // parse.mjs/nimas-export.mjs's DTBook round trip, F-12). Translated once here so
  // formatTable/traceTable never re-translate it.
  const rawHeaderGroups = Array.isArray(block.headerGroups) ? block.headerGroups : [];
  const headerGroups = rawHeaderGroups
    .map((g) => ({ text: tr(g && g.text), from: Math.max(0, Math.trunc(Number(g && g.from))), to: Math.min(colCount - 1, Math.trunc(Number(g && g.to))) }))
    .filter((g) => Number.isFinite(g.from) && Number.isFinite(g.to) && g.to >= g.from && g.text);

  // Inter-column gutter: 2 spaces per standard
  const gutter = 2;
  // BANA 11.4.3a (Change 2, Paul's decision 17 Sep 2026 — standards-findings.md F-12's
  // own "open question", now settled; standards-questions.md has the remaining
  // transcriber question on whether this is the right reading): "The separation line is
  // the width of the primary heading when it is wider than all of the sub-column
  // headings." Tried in this order for each group whose heading is wider than its own
  // span (widths measured PRE-squeeze — fitColumnWidths runs on `colWidths` afterwards
  // and, by construction, never needs to squeeze when an overhang was granted, since
  // the whole-table fit was already checked here):
  //  1. OVERHANG (preferred): if the whole table — every column's natural width, plus
  //     every overhang already granted to an earlier group, plus this one — still fits
  //     the line, the heading stays UNWRAPPED at its own full width; the sub-columns
  //     beneath are entirely unchanged (colWidths untouched); the extra cells needed
  //     are recorded in `overhangWidths[g.to]` (rendering-only padding, applied by
  //     traceGroupedHeaderRows/traceColumnar via padOverhang — never guide-dotted,
  //     11.6.1g's reasoning) so every later column still starts two cells after the
  //     wider of the heading and its span.
  //  2. WRAP (the pre-existing behaviour, when the overhang would not fit the page):
  //     the heading wraps within its span (traceGroupedHeaderRows, unchanged), the
  //     span widened only to the heading's own WIDEST WORD (never its whole unwrapped
  //     text — words are never divided, A27b/§1.10.1) — added to the LAST sub-column.
  // No gold sample in this section has a primary heading wider than its own span, so
  // neither branch is gold-verified; both are synthetic-tested (table_auto_squeeze.
  // test.mjs) against the rule text itself, per this project's own testing rule.
  const overhangWidths = Array(colCount).fill(0);
  for (const g of headerGroups) {
    const spanWidth = colWidths.slice(g.from, g.to + 1).reduce((a, b) => a + b, 0) + gutter * (g.to - g.from);
    if (g.text.length <= spanWidth) continue;                // heading already fits its span
    const overhangExtra = g.text.length - spanWidth;
    const currentTotal = colWidths.reduce((a, b) => a + b, 0) + gutter * (colCount - 1) + overhangWidths.reduce((a, b) => a + b, 0);
    if (currentTotal + overhangExtra <= w) {
      overhangWidths[g.to] += overhangExtra;
      g.overhang = true;
    } else {
      const need = widestWord(g.text) - spanWidth;
      if (need > 0) colWidths[g.to] += need;
    }
  }
  const totalSpatialWidth = colWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter + overhangWidths.reduce((a, b) => a + b, 0);

  return { rawHeaders, rawRows, w, mode, colCount, has, segsBraille, tr, headers, rows, numPlans, colWidths, gutter, totalSpatialWidth, headerGroups, overhangWidths, rowSubs, subFrom, subdivisionRows: block.subdivisionRows, subdivisionHeading: block.subdivisionHeading, bana: o.mode === 'bana', numericPassageOk, ...facingContext(block, o, w) };
}

// The layout formatTable actually uses for a table: 'columnar' with its squeezed column
// widths, or the over-wide fallback layout name — 'listed' (BANA Formats §11.9) or
// 'paragraph' (UKAAF B004 §12) — when the columns do not fit even squeezed to their
// 2-cell minimum (fitColumnWidths, A27b). Shared by formatTable and tableLayout.
function resolveTableLayout(c) {
  if (c.mode === 'listed') return { layout: 'listed' };
  if (c.mode === 'paragraph' || c.mode === 'table-paragraph') return { layout: 'paragraph' };
  const fallbackLayout = c.bana ? 'listed' : 'paragraph';
  const tryColumnar = () => {
    const actualWidths = fitColumnWidths(c.colWidths, c.w, c.gutter, columnMinWidths(c.headers, c.rows, c.colCount));
    if (actualWidths) return { layout: 'columnar', actualWidths, gutter: c.gutter };
    // TBL-NUM-1 / BANA §11.7.1l: "The numeric passage indicator can be used in conjunction
    // with one blank cell between columns of numbers if this results in the table appearing
    // on one page" — tried only once the standard 2-cell gutter does not fit (Example 11-9
    // itself never reaches this: its columns already fit at 2 cells, gold-verified), and
    // only for a table numericPassageEligible already qualified for the indicator in the
    // first place (formatColumnar/traceColumnar apply the indicator itself once this layout
    // is chosen, regardless of which gutter got it there).
    if (c.numericPassageOk) {
      const narrowed = fitColumnWidths(c.colWidths, c.w, 1, columnMinWidths(c.headers, c.rows, c.colCount));
      if (narrowed) return { layout: 'columnar', actualWidths: narrowed, gutter: 1 };
    }
    return { layout: fallbackLayout };
  };
  // T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026): BANA §11.14 Wide Tables: Vertical
  // Division. Only attempted for a table with a single-tier header — c.headerGroups is
  // BANA §11.4.3's own two-tier complex heading (F-12); no gold sample combines the two,
  // and dividing columns under a primary heading that spans several of them would need
  // its own, unverified span-splitting rule, so that combination is left to Listed.
  const tryVertical = () => {
    if (c.headerGroups.length) return null;
    const sections = computeVerticalSections(c.colWidths, c.gutter, c.w, c.colCount);
    return sections ? { layout: 'vertical', sections } : null;
  };
  if (c.mode === 'vertical') return tryVertical() || { layout: fallbackLayout };
  // T4: BANA §11.18 Stairstep and §11.17 Linear are selectable only — 'auto' never picks them.
  if (c.mode === 'stairstep') {
    const plan = stairstepPlan(c.bana, c.subdivisionRows, c.subdivisionHeading, c.rawHeaders, c.rawRows, c.colCount, c.has, c.headerGroups);
    return plan ? { layout: 'stairstep', plan } : { layout: fallbackLayout };
  }
  if (c.mode === 'linear') {
    return linearAllowed(c.bana, c.rawHeaders, c.rawRows, c.colCount, c.has, c.headerGroups) ? { layout: 'linear' } : { layout: fallbackLayout };
  }
  if (c.mode === 'columnar') return tryColumnar();
  // K15: BANA §11.13 / B004 App E facing pages, selectable in both modes. A table that cannot be set across facing
  // pages (it fits one page, its right-hand columns do not fit a page, it is not a top-level table, or it has a two-tier
  // heading) is laid out as 'auto' would lay it out.
  const facingPlan = c.mode === 'facing' || c.bana ? facingPlanFor(c) : null;
  if (c.mode === 'facing' && facingPlan) return { layout: 'facing', plan: facingPlan };
  // T9 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026, standards-findings.md F-18's own
  // status update): 'auto' mode always tries the word-preserving squeeze FIRST — never
  // gated on whether the table already fits at its unsqueezed natural width, as before
  // this fix (that old pre-check is why BANA Sample 11-04 fell straight to Listed even
  // though the book's own transcription squeezes 22/17/19-cell columns to 13/13/10 with
  // runovers) — and accepts columnar only when the squeeze both fits the line
  // (fitColumnWidths, which already never divides a word — columnMinWidths) AND every
  // entry, headers included, fits in at most two lines of its squeezed column (BANA
  // §11.6.1: "Column entries are limited to two lines. Entries that cannot be limited
  // to two lines require another specialized table format." — fitsTwoLines). A
  // headerGroups table (BANA §11.4.3, F-12) is covered by this same unconditional
  // attempt: its primary heading's own width need is already folded into c.colWidths
  // above, before this squeeze runs. Falls back (as before) when either check fails;
  // the transcriber can still force 'columnar' from the toolbar (c.mode==='columnar'
  // above), which bypasses this two-line check entirely — unchanged.
  const attempt = tryColumnar();
  if (attempt.layout === 'columnar' && fitsTwoLines(c.headers, c.rows, attempt.actualWidths)) return attempt;
  // T4: when the squeeze doesn't reach a usable columnar table, try dividing it
  // vertically (BANA §11.14) before falling back to Listed/paragraph, which stays the
  // last resort (EMBOSS-TASKS.md T4: "vertical division ... also the automatic fallback
  // when its sections fit a page; listed stays the last resort").
  const vertical = tryVertical();
  // K15: facing pages in the automatic order (facingAutoPreferred). BANA only: B004 gives facing pages as one
  // good-practice example, with no order among the formats.
  if (c.bana && facingPlan && facingAutoPreferred(c, vertical && vertical.sections)) return { layout: 'facing', plan: facingPlan };
  if (vertical) return vertical;
  return { layout: fallbackLayout };
}

// Which layout a table will actually braille as, without rendering it: 'columnar', or the
// over-wide fallback ('listed' in BANA, 'paragraph' in UKAAF). The editor's table toolbar
// uses this to warn when a 'spatial'/'auto' table falls back (G15) — it calls formatTable's
// own width computation (computeTableColumns/resolveTableLayout) so the warning can never
// disagree with what actually gets brailled.
export function tableLayout(block, o) {
  // BANA 11.15 / B004 App E: an interchanged table reports 'interchange'; one that cannot be interchanged, what 'auto' gives.
  const ix = tableFormatMode(block, o) === 'interchange' ? interchangedTable(block, o) : undefined;
  if (ix) return 'interchange';
  if (ix === null) return tableLayout({ ...block, format: 'auto' }, o);
  // K15: the editor asks about a top-level table; facing pages need its page length (buildDocPages sets it when formatting).
  const top = block && !(block._facingPerPage > 0) ?{ ...block, _facingPerPage: linesPerPage(Math.max(10, Math.min(45, Number(o && o.depth) || 25)), !!(o && (o.suppressHeader || o.pageHeaders === false)), isBanaOpts(o || {}) ? 'bana' : 'ukaaf', true, false) } : block;
  const c = computeTableColumns(top, o);
  if (!(c.colCount > 0)) return 'columnar';
  return resolveTableLayout(c).layout;
}

// ---- BANA Formats 2016 §11.15 Wide Tables: Interchanged Columns and Rows; UKAAF B004 Appendix E, "Good practice
// example of a transposed table". ----
//   11.15.1 "Sometimes it is possible to fit a wide table across the page by interchanging the table columns and rows.
//   This is done only if it preserves the clarity of the table. Insert a transcriber's note before the table. Sample:
//   Columns and rows are interchanged."
// A SELECTABLE format (`block.format = 'interchange'`, or settings tableFormat): whether interchanging "preserves the
// clarity of the table" is the transcriber's judgement about the content, so 'auto' never chooses it. The print table
// is transposed — the column headings become the row headings (column 0) and the row headings become the column
// headings, the corner cell staying where it is (Sample 11-23: Jan-Jun across in print, down the side in braille;
// Sunrise/Sunset down the side in print, the two column headings in braille) — and the result is an ordinary columnar
// table (§11.2-11.6) with the rule's note as the first paragraph of the table's opening note. Only when it then fits
// across the page, the way 'auto' accepts a columnar table (squeezed without dividing a word, no entry over two lines,
// §11.6.1): that is the point of the format ("to fit a wide table across the page"). Otherwise, and for a table with
// no row to interchange, a two-tier heading (§11.4.3) or row subheadings (§11.5.1b) — structures that have no
// interchanged form — the table is laid out as 'auto' would lay it out.
const INTERCHANGE_TN = {
  bana: 'Columns and rows are interchanged.',              // BANA 11.15.1's own sample wording (Sample 11-23)
  ukaaf: 'The table has been transposed in braille.',      // B004 App E Example 1's note (its first clause)
};
// The table format a block asks for (the order computeTableColumns / traceTable resolve it in).
const tableFormatMode = (block, o) => (block && (block.format || block.style)) || (o && o.tableFormat) || 'auto';
// A column's print alignment carried to the interchanged table: each new column holds one print row's entries, which
// come from every print data column — so an alignment is kept only when all the print data columns share it.
const commonAlign = (arr, colCount) => {
  if (!Array.isArray(arr)) return undefined;
  const vals = Array.from({ length: colCount - 1 }, (_, k) => arr[k + 1] ?? null);
  return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
};
// The interchanged table block (format 'columnar', `_interchangeTn` its note, `_interchangeOf` the unit map back to
// the print cells for traceTable), or null when the table cannot or need not be interchanged (see above).
function interchangedTable(block, o) {
  const H = Array.isArray(block.headers) ? block.headers : [];
  const R = (Array.isArray(block.rows) ? block.rows : []).map((r) => (Array.isArray(r) ? r : (r == null ? [] : [r])));
  const C = Math.max(H.length, ...R.map((r) => r.length));
  if (!(C >= 2) || !R.length) return null;
  if (Array.isArray(block.headerGroups) && block.headerGroups.length) return null;
  if (block.rowSubheadings && (Array.isArray(block.rowSubheadings) ? block.rowSubheadings.length : Object.keys(block.rowSubheadings).length)) return null;
  const cell = (v) => (v == null ? '' : v);
  const t = {
    ...block, format: 'columnar',
    headers: [cell(H[0]), ...R.map((r) => cell(r[0]))],
    rows: Array.from({ length: C - 1 }, (_, k) => [cell(H[k + 1]), ...R.map((r) => cell(r[k + 1]))]),
    _interchangeTn: INTERCHANGE_TN[isBanaOpts(o || {}) ? 'bana' : 'ukaaf'],
  };
  delete t.style;
  for (const f of ['headerGroups', 'rowSubheadings', 'totalRows', 'subdivisionRows', 'subdivisionHeading', 'printAlign', 'columnAlign']) delete t[f];
  const pa = commonAlign(block.printAlign, C), ca = commonAlign(block.columnAlign, C);
  if (pa) t.printAlign = [null, ...R.map(() => pa)];
  if (ca) t.columnAlign = [null, ...R.map(() => ca)];
  // BANA 11.8: a key to the column headings now keys the row headings, and the other way round.
  if (Array.isArray(block.key)) t.key = block.key.map((it) => (it && typeof it === 'object' ? { ...it, group: it.group === 'row' ? 'column' : 'row' } : it));
  const c = computeTableColumns(t, o);
  if (!(c.colCount > 0)) return null;
  const widths = fitColumnWidths(c.colWidths, c.w, c.gutter, columnMinWidths(c.headers, c.rows, c.colCount));
  if (!widths || !fitsTwoLines(c.headers, c.rows, widths)) return null;
  // traceTable's cell units (header ci -> ci; row ri, column ci -> headers.length + ri * colCount + ci) of the
  // interchanged table, mapped back to the print table's own units, so the editor links each braille entry to its cell.
  const Hc = H.length, tH = R.length + 1;
  Object.defineProperty(t, '_interchangeOf', {
    value: (u) => {
      if (!(u >= 0)) return u;
      if (u < tH) return u === 0 ? 0 : Hc + (u - 1) * C;                     // a new column heading: print row u-1's heading
      const k = u - tH, ri = Math.floor(k / tH), cj = k % tH;                  // new row ri = print column ri+1
      return cj === 0 ? ri + 1 : Hc + (cj - 1) * C + ri + 1;
    },
  });
  return t;
}

// BANA Formats §11.3.1a: "Center table headings." A table's HEADING (its own title, e.g.
// "Table 12: Populations") is a different thing from its CAPTION (§11.2.8b: 7-5 margins,
// never centred — see formatCaption / the standalone 'caption' block; F-4). `title` is the
// heading text carried on the table block itself (`block.title`) — a string, or an array
// when print shows it as more than one hard-broken line (e.g. a sequence number on its own
// line above the title proper, BANA Example 11-4: "Table 9.5" / "Smoking Among Americans by
// Age and Sex"). Each print line is centred independently and, if it alone is wider than the
// page, further word-wrapped first (centredBlock) — never merged with an adjacent print line
// even when the two would together fit the width (gold-verified: BANA Sample 11-2's "Table
// 11.1" stays alone on its own centred line, not joined to "Summary Comparison...").
function tableTitleLines(title, o, w) {
  if (title == null) return [];
  const raw = Array.isArray(title) ? title : [title];
  const out = [];
  for (const line of raw) {
    const s = String(line ?? '').trim();
    if (!s) continue;
    out.push(...centredHeadingBlock(o.translate(s), w));   // balanced wrap, BANA §4.4.3 / F-28 / F-40
  }
  return out.map((l) => l.replace(/\s+$/, ''));
}

// BANA Formats §11.2.5b: "Each column is separated from a following column by two blank
// cells." Always two, on every line (K33, 26 Sep 2026). Emboss used to narrow the gap to one
// cell wherever an entry or its guide dots reached the column's edge (F-10/Q-7/Q-9, read
// from BANA Example 11-2 and Sample 11-1); that reading came from a gold transcription taken
// from a text dump that had collapsed two blank cells to one. The book's page images show two
// cells (Example 11-2 `mosquito  #cj "ds`, Sample 11-1 `,daily """""""""  #e4ci.0`), and
// transcriber KD confirms 11.2.5b. `gutter` is always 2 EXCEPT the one narrow exception
// TBL-NUM-1 (28 Sep 2026) adds: BANA §11.7.1l's one-cell gap, tried only for a table that
// already qualifies for the numeric passage indicator (numericPassageOk) and only once the
// standard 2-cell gutter does not fit it on one page (resolveTableLayout's tryColumnar /
// traceTable's matching autoWidths pre-check). `leads[ci]` (UKAAF, see tableCellFill) is
// how many guide dots run on from column ci into the gap — the column positions never move.
const gapText = (lead, gutter) => TABLE_GUIDE.repeat(lead || 0) + ' '.repeat(gutter - (lead || 0));
function joinTableRow(colTexts, gutter, leads = null) {
  let s = '';
  for (let ci = 0; ci < colTexts.length; ci++) {
    s += colTexts[ci];
    if (ci < colTexts.length - 1) s += gapText(leads ? leads[ci] : 0, gutter);
  }
  return s;
}

// BANA §11.4.3a overhang (Change 2, Paul's decision 17 Sep 2026 — see computeTableColumns'
// `overhangWidths`/`headerGroups[gi].overhang`): "The separation line is the width of the
// primary heading when it is wider than all of the sub-column headings." When a group's
// heading overhangs its own span AND the whole table still fits the line with that overhang,
// the sub-columns beneath stay their own natural width (never widened) — instead, extra
// blank cells are appended after the group's LAST sub-column, on every row of the table
// (primary, extra, sub-tier, separator and data rows alike), so every later column still
// lines up under the wider heading/separator above. Never guide-dotted (11.6.1g's own "no
// dots after a runover" reasoning applies here too: this is layout padding, not column
// content) and followed by the standard 2-cell gutter (no guide-dot lead into it —
// `overhangLeads`) — together giving exactly "the next column starts two cells after the
// wider of the heading and its span." A no-op (returns its input unchanged) whenever no
// column has an overhang, so it is safe to call unconditionally from formatColumnar/
// traceColumnar's general row-rendering code, whether or not the table has a two-tier
// header at all.
const padOverhang = (colTexts, overhangWidths) => (
  (overhangWidths && overhangWidths.some(Boolean))
    ? colTexts.map((t, ci) => (overhangWidths[ci] ? t + ' '.repeat(overhangWidths[ci]) : t))
    : colTexts
);
const overhangLeads = (leads, overhangWidths) => (
  (overhangWidths && overhangWidths.some(Boolean))
    ? leads.map((e, ci) => (overhangWidths[ci] ? 0 : e))
    : leads
);

// Which group (index into `headerGroups`) each column belongs to, or null for a
// column with a single-tier heading (no primary heading over it) — shared by the
// format and trace renderers of BANA §11.4.3's complex column headings.
function groupColumnMap(colCount, headerGroups) {
  const groupOf = Array(colCount).fill(null);
  headerGroups.forEach((g, gi) => { for (let c = g.from; c <= g.to; c++) groupOf[c] = gi; });
  return groupOf;
}
// A group's own rendered width: its sub-columns' widths plus the (nominal, 2-cell)
// gutters between them — the primary heading is one continuous run of text/dots
// across this width, never per-sub-column (11.4.3a: "The [separation] line starts at
// the left margin of the primary and secondary sub-column headings and ends at the
// right margin of the last sub-column").
const groupSpanWidth = (g, actualWidths, gutter) =>
  actualWidths.slice(g.from, g.to + 1).reduce((a, b) => a + b, 0) + gutter * (g.to - g.from);

// A72 stage 3 ("one layout path" — tables): formatGroupedHeaderRows is gone (BANA
// §11.4.3 complex/two-tier column headings) -- traceGroupedHeaderRows (below, formerly
// this function's mirror) is the only implementation left, called from traceColumnar;
// formatColumnar itself is gone too (see formatTable's final fallthrough). The rule
// comment (gold-derived row layout) that used to sit here now sits on
// traceGroupedHeaderRows instead.

// ---- Optional table fields (BANA §11). Every one defaults to "absent = output unchanged". ----
//  block.citation      F-14, BANA 11.2.5g / 9.5.3: a source citation, a string or { text, position }.
//                      "Place source citations on the next line after completion of the table blocked four
//                      cells to the right of the material it follows. Follow print for placement above or
//                      below the bottom box line. A blank line should follow a source citation when it
//                      appears immediately after the bottom box line." (9.5.3: no blank line between the
//                      bottom box line and the source.) position 'below-box' (default: after the box, or
//                      straight after an unboxed table) or 'inside-box' (last line inside the box).
//                      Blocked four cells right = 5-5 margins. Applies to every table layout.
//  block.totalRows     F-17, BANA 11.6.2 / 11.6.2a / 11.6.2b: 0-based row indexes of total rows. "When
//                      horizontal lines separate column items from totals, the horizontal line symbol
//                      should extend across the width of the column total." A line of dot 5 + dots 25
//                      (the separation-line pattern) is put on its own line above the total row under each
//                      column (not the row-heading column) whose total entry holds a digit. Columnar layout.
//  block.rowSubheadings F-12 remainder, BANA 11.5.1b: [{ row, text }]: a primary row heading (no entries,
//                      no guide dots) placed above 0-based data row `row`; "use 1-5 margins for the primary
//                      row headings and 3-5 margins for the secondary row headings", the secondary headings
//                      being the row headings of every row from `row` down to the next subheading.
//                      Columnar layout.
function tableCitation(block) {
  const c = block && block.citation;
  const text = typeof c === 'string' ? c : (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : '');
  if (!text.trim()) return null;
  return { text: text.trim(), position: c && typeof c === 'object' && c.position === 'inside-box' ? 'inside-box' : 'below-box' };
}
const tableCitationLines = (block, o) => {
  const ci = tableCitation(block);
  return ci ? wrapCells(o.translate(ci.text).trim(), o.width || 38, 4, 4) : [];
};
// Splice citation lines in before a table's trailing blank line(s), in place (keepGroups survives).
function withTableCitation(block, o, lines) {
  if (isFacingLines(lines)) return lines;                   // K15: a facing-pages table places its own source (11.13.1h)
  if (!lines.length) return lines;
  const cl = tableCitationLines(block, o);
  let at = lines.length;
  while (at > 0 && lines[at - 1] === '') at--;
  if (cl.length) { lines.splice(at, 0, ...cl); at += cl.length; }
  // UK-6 (28 Sep, James / decisions.md "UKAAF"): a dot-2s end marker after each table, "before
  // resuming normal text" — after the table's own last line, or after its below-table citation
  // when it has one — on by default in UKAAF (`o.tableEndMarker`; an explicit `false` turns it
  // off, field-registry.mjs). No equivalent in BANA.
  if (o.mode !== 'bana' && o.tableEndMarker !== false) lines.splice(at, 0, indicatorLine('dot2s', o.width || 38));
  return lines;
}
// F-13 — BANA §11.4.4 "Repeated Column Headings. When tables are longer than a single page:
//   a. Repeat the column headings (with accompanying separation lines) at the top of each succeeding page.
//   b. Insert a blank line between a running head and the repeated headings.
//   c. Omit the blank line following the running head if additional runover pages can be avoided by the use of line 2."
// and §11.2.6d "If necessary, a table may be divided between pages at the most appropriate place... Insert the
// page break at the beginning of a new row if possible." Each columnar row (and the column headings, kept with the
// first row) is a keep-together group for applyPageBoundaries, which also repeats the headings. `block.repeatHeadings`
// (true / false) overrides; unset means ON in BANA mode (the rule says "Repeat", not "may repeat") and OFF for UKAAF
// (B004 §12 / Appendix E say nothing about a table over two pages).
function tableRepeatOn(block, o) {
  if (block && block.repeatHeadings === false) return false;
  if (block && block.repeatHeadings === true) return true;
  return isBanaOpts(o);
}
// keepGroups for a columnar table: one group per row; the first also spans the headings (third element
// 'H<n>' = the first n lines of the group are the repeatable headings + separation line).
function tableRowGroups(headStart, headEnd, rowStarts, last) {
  const groups = rowStarts.map((st, k) => [st, k + 1 < rowStarts.length ? rowStarts[k + 1] - 1 : last]);
  if (headStart >= 0 && headEnd >= headStart && groups.length) groups[0] = [headStart, groups[0][1], 'H' + (headEnd - headStart + 1)];
  return groups;
}
// BANA §11.3.2b: "When a sequentially numbered table is longer than one braille page, repeat and center the table
// number on line 25 of each succeeding braille page, followed by "(cont.)". When a table occupies only one page, do
// not put the table number on line 25." Print text of that line, or null. block.continuedNote: false = never; a string
// = that text (print); true = the first title line + " (cont.)"; unset = automatic only when the first title line is
// a bare "Table <number>" (the sequentially numbered heading of §11.3.2a). BANA only (line 25 is the BANA page number line).
function tableContinuedNoteText(block, o) {
  if (!block || block.type !== 'table' || !isBanaOpts(o)) return null;
  const cn = block.continuedNote;
  if (cn === false) return null;
  if (typeof cn === 'string' && cn.trim()) return cn.trim();
  const first = String((Array.isArray(block.title) ? block.title[0] : block.title) ?? '').trim();
  if (!first) return null;
  if (cn === true || /^table\s+[0-9A-Za-z][\w.\-]*$/i.test(first)) return first + ' (cont.)';
  return null;
}
// Row indexes of block.totalRows within 0..rowCount-1 (row 0 has nothing above it to separate).
function tableTotalRowSet(block, rowCount) {
  const set = new Set();
  if (Array.isArray(block && block.totalRows)) for (const r of block.totalRows) { const n = Math.trunc(Number(r)); if (Number.isFinite(n) && n > 0 && n < rowCount) set.add(n); }
  return set;
}
// Map(row -> plain heading text) from block.rowSubheadings.
function tableRowSubMap(block, rowCount) {
  const m = new Map();
  if (Array.isArray(block && block.rowSubheadings)) {
    for (const e of block.rowSubheadings) {
      const n = Math.trunc(Number(e && e.row));
      const text = e && e.text != null ? String(e.text).trim() : '';
      if (Number.isFinite(n) && n >= 0 && n < rowCount && text) m.set(n, text);
    }
  }
  return m;
}
// Rows whose row heading is a secondary heading (3-5 margins): every row from the first subheading down.
const tableSubIndentFrom = (subs) => (subs.size ? Math.min(...subs.keys()) : Infinity);
// Which columns of a total row get the retained line: not the row-heading column, entries holding a digit.
const totalRuleCols = (rawRow, colCount) => Array.from({ length: colCount }, (_, ci) => ci > 0 && /\d/.test(cellPlainText(rawRow[ci])));
// Column [start,end) spans of a joined row (mirrors joinTableRow's gutter arithmetic).
function tableColSpans(colTexts, gutter) {
  const spans = [];
  let pos = 0;
  colTexts.forEach((t, ci) => { spans.push([pos, pos + t.length]); pos += t.length + (ci < colTexts.length - 1 ? gutter : 0); });
  return spans;
}
// The retained horizontal line: under each flagged column, across the extent of that column's entry in `line`.
function retainedRuleLine(line, spans, flags) {
  const out = Array(line.length).fill(' ');
  spans.forEach(([a, b], ci) => {
    if (!flags[ci]) return;
    const seg = line.slice(a, b);
    const lead = seg.length - seg.trimStart().length, body = seg.trim().length;
    if (!body) return;
    for (let k = 0; k < body; k++) out[a + lead + k] = k === 0 ? TABLE_GUIDE : '3';
  });
  return out.join('').replace(/\s+$/, '');
}

// A72 stage 3 ("one layout path" — tables): formatTable is now a thin projection of
// traceTable — the same relationship traceProjection already gives every other block
// type. Every resolved layout (columnar/listed/paragraph/stairstep/linear/vertical/
// facing/interchange) used to have its own formatXxx mirror closure here, hand-kept in
// step with traceTable's traceXxx counterpart; all eight are gone now, along with the
// computeTableColumns/resolveTableLayout calls and the two pushWarning checks this
// function used to make before dispatching (table-fallback, TBL-NUM-1's numericPassage
// warning) — traceTable already makes the identical calls itself, so making them here
// too only double-counted them (tests/transcription_warnings.test.mjs, tests/
// table_numeric_passage.test.mjs both caught this during the conversion: 2 warnings
// instead of 1). Braille proven byte-identical over the whole parity corpus before and
// after, both modes, both formatDocument and formatDocumentAsync+translatePos (the
// editor's own call) — see the task report.
function formatTable(block, o) {
  return tableModeProjection(block, o);
}

// Computer Code Block formatting with UEB indicators
const DOT_LOCATOR_USE = '""=';                                  // UEB 3.14, dot locator for "use"
const codeLineSpaced = (l, block, w) => {
  if (!block.spaceLetters) return l;
  const t = l.trim();
  if (!/^\S+$/.test(t)) return l;
  const spaced = Array.from(t).join(' ');
  return spaced.length <= w ? spaced : l;
};
function formatCodeBlock(block, o) {
  const text = String(block.text ?? '');
  if (!text.trim()) return [];
  const w = o.width || 38;
  const lines = text.split('\n');
  // Displayed computer code is a grade-1 passage (UEB Technical §17): the passage
  // indicator and terminator stand on their own lines around the code, which is
  // translated uncontracted when the caller supplies a grade-1 translate.
  const g1 = o.translateG1 || o.translateUncontracted || o.translate;
  // F-220 / BANA 19.2.2a, 19.2.2g, 19.6.1b: optional `block.dotLocator` puts the dot locator for "use"
  // before the passage indicator and the terminator. F-219 / 19.2.2d, 19.5.3g: optional `block.keepSpaces`
  // keeps a line's own runs of blanks (and leading blanks) when it fits the width. 19.6.1c: optional
  // `block.spaceLetters` puts one blank between the letters of a line of a word puzzle / letter search
  // (only when the spaced line fits, as the rule allows).
  const loc = block.dotLocator ? DOT_LOCATOR_USE : '';
  const out = ['', loc + G1_PASSAGE_OPEN];
  lines.forEach((l) => {
    if (!l.trim()) return;
    const t = g1(codeLineSpaced(l, block, w));
    if (block.keepSpaces && t.replace(/\s+$/, '').length <= w) { out.push(t); return; }
    out.push(...wrapCells(t, w, 0, 2));
  });
  out.push(loc + G1_TERMINATOR, '');
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Convert pixel array (RGBA) to 2x3 dot braille matrix line-art. SIX-dot cells: BRF
// (en-us-brf.dis) has no dots 7/8, so an 8-dot raster would lose its bottom row at
// the embosser.
export function convertImageToBrailleMatrix(pixels, width, height, targetCellsW = 20) {
  if (!pixels || !width || !height) return [];
  const cellWidth = targetCellsW;
  const cellHeight = Math.max(1, Math.floor((height / width) * cellWidth * (2 / 3)));   // a cell is 2 dots wide x 3 tall
  const resultLines = [];
  const dotWidth = cellWidth * 2;
  const dotHeight = cellHeight * 3;

  for (let cy = 0; cy < cellHeight; cy++) {
    let line = '';
    for (let cx = 0; cx < cellWidth; cx++) {
      let code = 0;
      const dotMap = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20]];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          const px = Math.min(width - 1, Math.floor(((cx * 2 + c) / dotWidth) * width));
          const py = Math.min(height - 1, Math.floor(((cy * 3 + r) / dotHeight) * height));
          const idx = (py * width + px) * 4;
          const lum = (pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114);
          if (lum < 128) code |= dotMap[r][c]; // dark pixels become tactile dots
        }
      }
      line += String.fromCharCode(0x2800 + code);
    }
    resultLines.push(line);
  }
  return resultLines;
}

// A print image (not a tactile graphic), BANA Formats §6.2–6.4 (B004 has no image rule; the
// same layout is used): the print caption in 7-5 (§6.2.2; UKAAF: the caption margins), with
// a transcriber's-note label first when print does not identify the illustration (§6.2.2b);
// the description (prodnote, else the alt text) in transcriber's note indicators on the next
// line (§6.2.2e, §6.3.1); no blank lines around them (§6.2.2a). An image with no caption,
// description or alt text is decorative and omitted (§6.4.1).
const isPrintImage = (block) => !(typeof block.svg === 'string' && block.svg.trim()) && !(Array.isArray(block.lines) && block.lines.length);
const IDENTIFIED_RE = /^\s*(figure|fig\.|photo|photograph|illustration|image|picture|map|diagram|chart|graph|drawing|painting|plate|table|exhibit)\b/i;
// F-231 / BANA 6.2.2b: "insert a label ... (e.g., photograph, figure, etc.)" — the word must
// fit the actual picture (a book's own worked examples use "Photograph"/"Picture"/etc., never
// a single fixed word), so block.figureType carries whatever word the source document
// supplies; "Illustration" stays the fallback only when it isn't set, exactly Emboss's own
// pre-existing default.
// Bug 5 / real-book-validation-24sep.md: `description || alt` silently dropped the alt text
// whenever a production note was also present (23 images in the science book — only
// "Production note: this image crosses the gutter…" survived; "An illustration of the
// organisms in the pond ecosystem." was gone). BANA 6.3.1: "the description... is enclosed in
// transcriber's note indicators" — the description IS the image's content (source alt text is
// exactly that); a production note (block.description, from a source <prodnote>) is additional
// producer-added text about the image (often production/layout detail, e.g. "crosses the
// gutter", not a substitute content description) — neither rule prefers one over the other, so
// both are kept, alt (the content) first, then the production note, matching 6.2.2e's own
// caption-then-description line order. Guarded against literal duplication only (some sources
// put the same text in both places).
function printImageParts(block) {
  const caption = String(block.caption ?? '').trim();
  const captionSegs = caption ? (Array.isArray(block.captionSegments) && block.captionSegments.length ? block.captionSegments : [{ type: 'text', text: caption }]) : [];
  const altText = String(block.alt ?? '').trim();
  const noteText = String(block.description ?? '').trim();
  const description = altText && noteText && altText !== noteText ? `${altText} ${noteText}` : (noteText || altText);
  const label = !caption || !IDENTIFIED_RE.test(caption);
  const labelWord = (block.figureType != null && String(block.figureType).trim()) || 'Illustration';
  const citation = String(block.citation ?? '').trim();      // BANA 6.2.2c / F-168: optional source citation
  return { caption, captionSegs, description, label, labelWord, citation };
}
const imageMargins = (o) => (isBanaOpts(o) ? { first: 6, runover: 4 } : { first: 4, runover: 4 });
function traceOrFormatPrintImage(block, o, unit) {
  if (typeof o.translatePos !== 'function') {                // formatBlock may be called with translate only
    o = { ...o, translatePos: (t, tf) => { const b = o.translate(t, tf); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(t).length - 1))) }; } };
  }
  const parts = printImageParts(block);
  if (!parts.caption && !parts.description && !parts.citation) {
    // IMP-W12 (Paul, 30 Sep 2026): a picture with no description, caption or citation puts nothing in the braille
    // (BANA 6.4.1) - and unless the author marked it decorative (`block.decorative`), the transcriber is asked for a
    // description through the transcription-warnings channel. One warning per picture (a block laid out twice, trace then
    // plain, reports it once). The braille is unchanged.
    if (!block.decorative) {
      const at = (o._warnCtx && typeof o._warnCtx.blockIndex === 'number') ? o._warnCtx.blockIndex : -1;
      const src = String(block.src ?? '');
      if (!(o._warnings || []).some((x) => x.kind === 'picture-no-description' && x.blockIndex === at && x.src === src)) {
        pushWarning(o, 'picture-no-description', 'A picture has no description. Add one so the braille can describe it.', { src });
      }
    }
    return [];
  }
  const w = o.width || 38;
  const { first, runover } = imageMargins(o);
  const tn = (text) => `${TN_OPEN}${o.translate(text).trim()}${TN_CLOSE}`;
  const out = [];
  if (parts.caption || parts.label) {
    const labelStr = parts.label ? tn(parts.labelWord) + (parts.caption ? ' ' : '') : '';
    const cap = parts.caption ? tcJoined(o, [{ segs: parts.captionSegs, unit }]) : { s: '', src: [] };
    const line = { s: labelStr + cap.s, src: [...Array.from(labelStr, () => null), ...cap.src] };
    out.push(...tcWrap(o, line, w, first, runover));
  }
  if (parts.description) {
    const d = tn(parts.description);
    out.push(...tcWrap(o, tcDeco(d), w, first, runover));
  }
  // BANA 6.2.2c: the source citation follows the caption - or, when there is a description, starts on the line
  // after the description - in 7-5 margins.
  if (parts.citation) out.push(...tcWrap(o, tcJoined(o, [{ segs: [{ type: 'text', text: parts.citation }], unit }]), w, first, runover));
  return out.map((x) => tcRstrip(x));
}

// Tactile Graphic raster / BRF placeholder rendering. A39: formatBlock is now a
// projection of traceBlock for this type (formatTactileGraphic, the plain-lines
// mirror, is deleted — this is the only implementation left).
function traceTactileGraphic(block, o) {
  if (isPrintImage(block)) return traceOrFormatPrintImage(block, o, 0);
  const w = o.width || 38;
  const desc = String(block.title || block.alt || 'Tactile Graphic');
  const label = `[Tactile graphic: ${desc}]`;
  let body;
  if (o.translatePos) {
    const { braille, inputPos } = o.translatePos(label, null);
    body = { s: braille, src: inputPos.map((p) => ({ u: 0, c: p })) };
  } else {
    const tr = typeof o?.translate === 'function' ? o.translate : (t) => t;
    const braille = tr(label);
    body = { s: braille, src: Array.from(braille, () => ({ u: 0, c: 0 })) };
  }
  const out = [tcBlank, ...tcWrap(o, body, w, 0, 2)];

  if (block.lines && Array.isArray(block.lines) && block.lines.length) {
    let blankCount = 0; const blankChars = new Set();
    block.lines.forEach((l) => {
      const cells = toBrfCells(String(l ?? '').replace(/\*/g, '='), (c) => { blankCount++; blankChars.add(c); }).replace(/\s/g, ' ').slice(0, w);
      out.push(tcDeco(centred(cells, w).replace(/\s+$/, '')));
    });
    if (blankCount) pushWarning(o, 'blanked-char', `${blankCount} character${blankCount === 1 ? '' : 's'} in the tactile graphic pattern ${blankCount === 1 ? 'is' : 'are'} not a valid braille cell and ${blankCount === 1 ? 'was' : 'were'} left blank`, { count: blankCount, chars: Array.from(blankChars) });
  }
  out.push(tcBlank);
  return out.map((x) => tcRstrip(x));
}

// K24 / BANA 8.4.1c ("Keep a columned list on a single page when possible", repeated in the March 2024 Updates): the rows
// of a list set in columns (columnedListPlan) are one keep-together group (lines.keepGroups). A list longer than a page is
// divided as before (8.4.1g). Shared by formatList and traceBlock.
function columnedListKeep(lines, rowFrom) {
  const flat = lines.map((l) => (typeof l === 'string' ? l : l.s));
  let b = lines.length - 1;
  while (b > rowFrom && flat[b] === '') b--;
  if (b > rowFrom) Object.defineProperty(lines, 'keepGroups', { value: [[rowFrom, b]], configurable: true });
  return lines;
}
// K24 / BANA 10.4 and 10.3 as clarified in the March 2024 Updates: "Exercise questions without answer choices should be
// kept on a single braille page if possible" and "Directions for questions without answer choices should be on the same
// braille page as at least one of the questions to which it applies" (10.3.1a: the directions and at least one question
// on the same page). In a BANA exercise list (kind 'exercise'), each question - a level-0 item that is not part of an
// example (10.8) - with no answer choices or subentries after it is one keep-together group. A question WITH choices
// gets a group tagged 'q<k>' spanning the question AND every answer-choice item that follows it (every item at a
// deeper level, up to the next level-0 item or the end of the list) - K31 / BANA 10.3.1b-c: "Place the question and
// its corresponding answer choices together on the same page" and "Place all answer choices for a given question
// together on the same page." Like every other keep-together group (a table row, a verse line, §8.3.5b-c's list
// opener - see applyPageBoundaries), the WHOLE group moves to the next page when it would not fit here but does fit
// on one page; a group longer than a page is left to the ordinary per-line fill, same limit tables already have for
// an over-long row (10.3.1c's own second sentence, "do not divide a single answer choice", is not separately
// enforced in that overflow case - no gold example exercises it, and doing so would need a further, answer-choice-
// level keep-group nested inside this one). The tag is also read by the "directions with the first question" rule
// right below in applyPageBoundaries, which now finds the true end of the first question+choices, not just the stem.
// An item with further blocks (a table inside it) keeps its own groups and gets none. `ranges` = [{ item, from, to }],
// each item's lines as formatList / traceBlock pushed them (the same on both paths).
function exerciseKeep(lines, block, ranges, o) {
  if (!lines || !lines.length || !block || block.kind !== 'exercise' || !isBanaOpts(o) || isCompactList(o) || !ranges || !ranges.length) return lines;
  const flat = lines.map((l) => (typeof l === 'string' ? l : l.s));
  const groups = [];
  ranges.forEach((r, k) => {
    const it = r.item;
    if (!it || (it.level || 0) !== 0 || it.example || it.blocks) return;
    let a = r.from, b = Math.min(r.to, flat.length - 1);
    while (a <= b && flat[a] === '') a++;
    while (b >= a && flat[b] === '') b--;
    if (a > b) return;
    const next = ranges[k + 1];
    const hasChoices = !!(next && next.item && (next.item.level || 0) > 0);
    if (hasChoices) {
      let e = k + 1;
      while (e < ranges.length && ranges[e].item && (ranges[e].item.level || 0) > 0) e++;
      let bb = Math.min(ranges[e - 1].to, flat.length - 1);
      while (bb >= a && flat[bb] === '') bb--;
      if (bb > b) b = bb;
    }
    groups.push(hasChoices ? [a, b, 'q' + k] : [a, b]);
  });
  if (!groups.length) return lines;
  const prior = Array.isArray(lines.keepGroups) ? lines.keepGroups : [];
  Object.defineProperty(lines, 'keepGroups', { value: [...prior, ...groups], configurable: true });
  return lines;
}
// F-35 / BANA 8.3.5b-c: "The first item of a list may begin on the next-to-last line of a page if it will fit on one
// braille line" and "A list may not begin on the last line of a page". The first item plus the line after it (the next
// item's first line) is one keep-together group (lines.keepGroups, the mechanism table rows use): a group that would run
// past the page moves whole to the next page, so a list never starts on the last line, and a multi-line first item never
// starts on the next-to-last. BANA only, plain lists of two or more items; opt out with `o.listPageRules === false`.
// Shared by formatBlock and traceBlock (same line counts), so pagination is identical on both paths.
const LIST_KEEP_KINDS = new Set(['', 'list', 'plain', 'ordered', 'unordered', 'bullet', 'numbered']);
function withListKeep(lines, block, o) {
  if (!lines || !lines.length || !block || block.type !== 'list' || !isBanaOpts(o) || o.listPageRules === false) return lines;
  if (block.style === 'glossary' || !LIST_KEEP_KINDS.has(String(block.kind ?? '')) || block.displayed) return lines;
  const items = block.items;
  if (!Array.isArray(items) || items.length < 2 || !items[0] || isCompactList(o) || columnedListPlan(block, o)) return lines;
  let one;
  try { one = traceBlockCore({ ...block, items: [items[0]], maxLevel: listMaxLevel(block) }, o, false).map((t) => t.s); } catch { return lines; }   // A39 stage 2: formatList is gone; traceBlockCore's own 'list' case is the only implementation left
  const flat = lines.map((l) => (typeof l === 'string' ? l : l.s));
  const n1 = one.length - 1;                             // the one-item list ends in a blank line
  if (n1 < 1 || n1 >= flat.length) return lines;
  for (let k = 0; k < n1; k++) if (one[k] !== flat[k]) return lines;   // the first item is not laid out the same alone: leave the list as it was
  let a = 0; while (a < n1 && one[a] === '') a++;
  if (a >= n1) return lines;
  // One-line first item: it and the next line (never the last line of a page). A two-line or longer first item: its
  // first two lines and one more (so it never starts on the last or next-to-last line, 8.3.5b); once three lines fit, the
  // rules say nothing further about where the item may divide.
  const k = n1 - a;
  let end = a + Math.min(k, 2);
  if (end >= flat.length || flat[end] === '') end--;
  if (end <= a) return lines;
  Object.defineProperty(lines, 'keepGroups', { value: [[a, end], ...(Array.isArray(lines.keepGroups) ? lines.keepGroups : [])], configurable: true });   // + an item's table rows (formatItemBlocks)
  return lines;
}
// A malformed block (null/undefined, or missing a usable `type`) is skipped
// rather than thrown on — one bad block in a document shouldn't take down
// the whole conversion.
function formatBlock(block, o, atStart) {
  if (!block || typeof block !== 'object') return [];
  block = emphasisResolvedOf(block, o);                  // F-99 / F-215, K1 (mirrored in traceBlock)
  installScrub(o);
  try {
    return withListKeep(formatBlockUnguarded(block, o, atStart), block, o);   // F-35 (mirrored in traceBlock)
  } catch (e) {
    if (typeof console !== 'undefined') console.warn(`[format] ${block.type ?? 'para'} block skipped:`, (e && e.message) || e);
    pushWarning(o, 'block-skipped', (e && e.message) || String(e), { snippet: blockTextSnippet(block) });
    return [];
  }
}
// A39 stage 2 ("one layout path"): project traceBlockCore's [{s,src}] lines into
// formatBlock's plain string[] -- and carry the non-enumerable `keepGroups` side channel
// across too. A plain .map() drops it (it is non-enumerable, by design -- see the A39
// comment on single_pass_layout.test.mjs): applyPageBoundaries and withListKeep read
// keepGroups off the array formatBlock actually returns, not off the trace array it was
// computed from, so a block type whose trace case sets it (list: itemKeep/exerciseKeep/
// columnedListKeep; box: none today, but a child's own groups could one day bubble up)
// would silently lose it here without this.
function traceProjection(block, o, atStart) {
  const traced = traceBlockCore(block, o, atStart);
  const lines = traced.map((t) => t.s);
  if (Array.isArray(traced.keepGroups)) Object.defineProperty(lines, 'keepGroups', { value: traced.keepGroups, configurable: true });
  return lines;
}
// A72 ("one layout path", stage 3 — tables): mirror of traceProjection for a single
// resolved table layout branch. formatTable calls this, per converted format, instead of
// its own formatXxx closure; traceTable is the only implementation of that format left.
// Copies the same side channels traceTable's own interchange case already defends
// (keepGroups always; headKeep/headLines/rowStarts never actually land on traceTable's
// own top-level return today — they are only ever set on renderVerticalSection's/
// traceVerticalSection's per-SECTION result, consumed internally — but are copied
// defensively all the same, matching that existing code).
function tableModeProjection(block, o) {
  const traced = traceTable(block, o);
  const lines = traced.map((t) => t.s);
  for (const k of ['keepGroups', 'headKeep', 'headLines', 'rowStarts']) if (traced[k] !== undefined) Object.defineProperty(lines, k, { value: traced[k], configurable: true });
  return lines;
}
function formatBlockUnguarded(block, o, atStart) {
  switch (block.type) {
    case 'title': return formatTitle(block, o);
    case 'heading': return traceProjection(block, o, atStart);   // A39 stage 2: projection of traceBlock (was formatHeading; formatHeading itself survives — boxHeadingLineCount still calls it directly)
    case 'para': return traceProjection(block, o, atStart);   // A39 stage 2: projection of traceBlock (was formatPara)
    case 'list': return traceProjection(block, o, atStart);   // A39 stage 2: projection of traceBlock (was formatList)
    case 'glossary': return formatGlossary(block, o);
    case 'box':
    case 'sidebar': return traceProjection(block, o, atStart);   // A39 stage 2: projection of traceBlock (was formatBox; A70 empty-box fix lives in the trace case now)
    case 'pagenum': return traceProjection(block, o, atStart);   // A39: formatBlock is now a projection of traceBlock for this type (was formatPageNum)
    case 'attribution': return formatAttribution(block, o);
    case 'caption': return formatCaption(block, o);
    case 'xref': return formatXref(block, o);
    case 'verse':
    case 'poem':
    case 'poetry':
      if (Array.isArray(block.lines)) {
        const out = [];
        for (const line of block.lines) {
          out.push(...formatPlay({ type: 'play', subtype: 'verse', text: String(line), level: block.level || 0, maxLevel: block.maxLevel }, o));
        }
        return out;
      }
      return formatPlay({ ...block, subtype: 'verse' }, o);
    case 'dialogue':
      if (block.speaker || block.speech) {
        const full = block.speaker ? `${block.speaker}: ${block.speech || ''}` : (block.speech || '');
        return formatPlay({ ...block, text: full }, o);
      }
      return formatPlay(block, o);
    case 'play':
      if (block.speaker || block.speech) {
        const full = block.speaker ? `${block.speaker}: ${block.speech || ''}` : (block.speech || '');
        return formatPlay({ ...block, text: full }, o);
      }
      return formatPlay(block, o);
    case 'stage': return formatStage(block, o);
    case 'note': return formatTranscriberNote(block, o);
    case 'tnpage': return formatTnPage(block, o);
    case 'sympage': return formatSymPage(block, o);
    case 'titlepage': return traceProjection(block, o, atStart);   // K29 Stage 1b: formatBlock is a projection of traceTitlePage (A39 "one layout path")
    case 'footnote': return formatFootnote(block, o);
    case 'table': return withTableCitation(block, o, formatTable(block, o));
    case 'code': return formatCodeBlock(block, o);
    case 'graphic': case 'tactile': return traceProjection(block, o, atStart);   // A39: projection of traceBlock (was formatTactileGraphic)
    case 'math': return traceProjection(block, o, atStart);   // A39: projection of traceBlock (was formatMath)
    // A 'break' (the editor's "Document Break", <hr>) is the same thing as an
    // 'indicator': a blank line, or a centred print break symbol (Formats
    // §1.9.5: "Center the braille equivalent on a separate line ... place a
    // space between each symbol"). It used to fall through to formatPara and
    // vanish.
    case 'break':
    case 'indicator':
      return traceProjection(block, o, atStart);   // A39: projection of traceBlock
    case 'blank': return traceProjection(block, o, atStart);   // A39: projection of traceBlock ([''])
    default: return traceProjection(block, o, atStart);   // A39 stage 2: projection of traceBlock (was formatPara; traceBlockCore's 'para' case now also handles `default`)
  }
}

// ===================== cell trace (editor word/cell linking) =====================
// Parallel to formatBlock: every cell carries a source coordinate {u,c} (u = unit
// index — 0 for a block, item index for a list; c = char index into that unit's
// flat text) or null for a decoration/space cell. traceBlock returns [{ s, src }]
// per content line, one entry per switch case mirroring formatBlockUnguarded's own
// switch case-for-case (see single_pass_layout.test.mjs, which checks the two
// switches stay in lockstep and that every case's `s` matches formatBlock's line).
// A39: buildDocPages/buildDocPagesAsync trust this equality and use traceBlock's own
// lines as the formatted output when translatePos is on, instead of laying the block
// out twice — see the A39 comment at their call site. o.translatePos(text, tf) →
// { braille, inputPos } is supplied by the caller (the editor) and mirrors o.translate.
function tcRstrip(o) { let b = o.s.length; while (b > 0 && o.s[b - 1] === ' ') b--; return { s: o.s.slice(0, b), src: o.src.slice(0, b) }; }
function tcTrimBoth(s, src) { let a = 0, b = s.length; while (a < b && s[a] === ' ') a++; while (b > a && s[b - 1] === ' ') b--; return { s: s.slice(a, b), src: src.slice(a, b) }; }
function tcRun(o, text, tf, unit, base) {                    // one translated text run
  // No-positions mode (A39 projection, `check-layout-parity.mjs`/task "one layout
  // path"): when the caller (formatBlock, via traceBlockCore) has no o.translatePos —
  // every headless test, gold and formatDocument — fall back to plain o.translate and
  // skip the source-map bookkeeping entirely (no per-char inputPos array from liblouis,
  // just a same-length array of nulls), matching the existing traceTactileGraphic
  // no-positions fallback below.
  if (!o.translatePos) {
    const braille = String((o.translate ? o.translate(text, tf || null) : text) ?? '');
    return { s: braille, src: Array.from(braille, () => null) };
  }
  const res = o.translatePos(text, tf || null);
  const braille = (typeof res === 'object' && res !== null) ? (res.braille ?? res.text ?? '') : (typeof res === 'string' ? res : '');
  const inputPos = (typeof res === 'object' && res !== null) ? (res.inputPos ?? res.map ?? Array.from({ length: braille.length }, (_, i) => i)) : Array.from({ length: braille.length }, (_, i) => i);
  return { s: braille, src: inputPos.map((p) => ({ u: unit, c: base + (typeof p === 'number' ? p : 0) })) };
}
// eBraille export (flowLines, below): with o.flowMarks the cells of a note reference come out fenced
// by these private-use characters, with the id of the note they point at, so the exporter can wrap them
// in a link. Never set by the formatter itself, so no braille changes.
const FLOW_REF_OPEN = '\uE010', FLOW_REF_SEP = '\uE011', FLOW_REF_CLOSE = '\uE012';
const tcDeco = (str) => ({ s: str, src: Array.from(str, () => null) });   // no source (rule line, marker, maths)
const tcBlank = { s: '', src: [] };
function tcSegs(o, segments, unit, lineNumbers = false) {    // mirror segmentsToBraille
  return tcJoined(o, [{ segs: segments || [], unit }], lineNumbers);
}
// Mirror of segmentsToBraille over cell segments joined into one string (table cells,
// listed "header: value" lines, paragraph-form rows): parts are [{ segs, unit }], unit
// null for decoration (separators, dashes). Adjacent plain runs are translated together,
// as joinSegs does in formatTable; each character maps back to its own cell.
function tcJoined(o, parts, lineNumbers = false) {
  // Flatten the parts, recording the source of every character of the flat text in the
  // same coordinates groupSegments uses (collapsed text; maths counts as `$latex$`).
  const flat = [], charSrc = [];
  for (const { segs, unit, base = 0 } of parts) {
    let c = base;
    // `.entries()`, not a plain `for...of`: mirrors groupSegments's own `segList.entries()`
    // (segList = segments || []) so a caller's malformed `segments` (a string instead of an
    // array — tests/transcription_warnings.test.mjs's "block-skipped" case) throws the same
    // TypeError here as it always did in segmentsToBraille, instead of a bare `for...of`
    // silently iterating the string's characters and swallowing the malformed input.
    for (const [, g0] of (segs || []).entries()) {
      let g = g0;
      if (!g) continue;
      if (g.blank && !String(g.text ?? '').trim()) g = { type: 'brl', text: '', brl: BLANK_CELLS };   // mirror groupSegments (F-237 blank)
      if (g.type === 'gap') { flat.push(g); continue; }
      if (g.type === 'math' || g.type === 'noteref' || g.type === 'linenum' || g.type === 'imgnote' || g.type === 'brl') {
        const len = g.type === 'math' ? (g.latex ? `$${g.latex}$` : '⟨equation⟩').length : String(g.text ?? '').length;
        flat.push(g);
        for (let i = 0; i < len; i++) charSrc.push(unit == null ? null : { u: unit, c: c + i });
        c += len;
        continue;
      }
      const t = String(g.text ?? '').replace(/[^\S\n]+/g, ' ');
      if (!t) continue;
      flat.push({ ...g, text: t });
      for (let i = 0; i < t.length; i++) charSrc.push(unit == null ? null : { u: unit, c: c + i });
      c += t.length;
    }
  }
  let s = '', src = [], pos = 0;
  const grouped = groupSegments(flat, o);
  for (const [gi, g] of grouped.entries()) {
    if (g.gap) { s += ` ${g.cells === 3 ? GAP3_CELL : GAP_CELL} `; src.push(null, null, null); continue; }
    if (g.linenum) {
      const brl = lineNumbers ? lineNumberWord(g.linenum, o) : '';
      s += brl;
      for (let i = 0; i < brl.length; i++) src.push(null);
      pos += g.len;
      continue;
    }
    if (g.noteref) {
      let brl = noterefBraille(g.noteref, o) + noterefTerminator(g.noteref, grouped[gi + 1]);
      if (o.flowMarks) brl = FLOW_REF_OPEN + String(g.noteref.idref ?? '') + FLOW_REF_SEP + brl + FLOW_REF_CLOSE;   // eBraille export (flowLines): the reference's cells, fenced, so they can be made a link
      s += brl;
      for (let i = 0; i < brl.length; i++) src.push(charSrc[pos + Math.min(i, Math.max(0, g.len - 1))] ?? null);
      pos += g.len;
      continue;
    }
    if (g.imgnote) {
      // Mirror segmentsToBraille's TN wrapping; no per-character source (synthesized
      // from the image's own alt text, not a position in the item's print text).
      const brl = TN_OPEN + imgnoteBraille(g.imgnote, o) + TN_CLOSE;
      s += brl;
      for (let i = 0; i < brl.length; i++) src.push(null);
      pos += g.len;
      continue;
    }
    if (g.brl) {                                             // mirror segmentsToBraille: literal cells, no source
      const brl = String(g.brl.brl ?? '');
      s += brl;
      for (let i = 0; i < brl.length; i++) src.push(null);
      pos += g.len;
      continue;
    }
    if (g.math) {
      if (o.mathToBrf || isUnreadableMath(g.math)) {
        let brf = ''; try { brf = isUnreadableMath(g.math) ? unreadableMathBrf(o, g.math) : (o.mathToBrf(g.math) || ''); } catch (e) { if (isRejectedMath(e)) brf = unreadableMathBrf(o, g.math, e); else { brf = ''; warnInlineMathSkipped(o, e); } }   // mirror segmentsToBraille (A65; A89 for an unreadable equation; S2b #11 for one the engine rejected)
        s += brf;
        for (let i = 0; i < brf.length; i++) src.push(charSrc[pos + Math.min(i, g.len - 1)] ?? null);
      }
      pos += g.len;
      continue;
    }
    const spanSt = g.notes ? { k: 0 } : null, spanMark = g.notes ? spanNoteCell(o) : null;
    if (g.hyperlink && !g.linkUnderline) { s += HYPERLINK_OPEN; for (let i = 0; i < HYPERLINK_OPEN.length; i++) src.push(null); }   // mirror segmentsToBraille (F-233 / LINK-2)
    g.lines.forEach((l, li) => {
      if (li > 0) { s += '\n'; src.push(null); }
      if (!l.text) return;
      const at = pos + l.start;
      if (g.uncontracted) {                                  // grade-1 run: indicators have no source of their own
        // Mirror segmentsToBraille's translateLine exactly (same helper). Formerly re-ran
        // segmentsToBraille on this one line, whose final boundary-space trim dropped the
        // run's own spaces: BANA Sample 17-12's " ... " came out `great4444,this`.
        const brl = uncontractedLineBraille(l.text, l.tf, o);
        s += brl;
        for (let i = 0; i < brl.length; i++) src.push(charSrc[at + Math.min(i, l.text.length - 1)] ?? null);
        return;
      }
      // No-positions mode (A39 stage 2, "one layout path"): mirror tcRun's own fallback —
      // when the caller has no o.translatePos (every headless test, gold and
      // formatDocument), skip liblouis's per-char inputPos bookkeeping and call o.translate
      // directly, same as translateLine (segmentsToBraille) does for the format-side mirror.
      let braille, inputPos;
      if (!o.translatePos) {
        braille = String((o.translate ? o.translate(l.text, typeformWordPunct(l.text, l.tf, o)) : l.text) ?? '');
        inputPos = Array.from(braille, () => null);
      } else {
        const res = o.translatePos(l.text, typeformWordPunct(l.text, l.tf, o));   // mirror translateLine
        braille = (typeof res === 'object' && res !== null) ? (res.braille ?? res.text ?? '') : (typeof res === 'string' ? res : '');
        inputPos = (typeof res === 'object' && res !== null) ? (res.inputPos ?? res.map ?? Array.from({ length: braille.length }, (_, i) => i)) : Array.from({ length: braille.length }, (_, i) => i);
      }
      if (g.notes) {                                         // mirror segmentsToBraille: spanTypeform notes (positions counted over the note's own print characters)
        ({ braille, inputPos } = spliceSpanNotes(braille, inputPos, g, spanSt, o, spanMark));
        s += braille;
        for (const p of inputPos) {
          if (p === -1) { src.push(null); continue; }
          const ti = l.start + (typeof p === 'number' ? p : 0);
          src.push(charSrc[pos + ti + g.notes.reduce((a, n) => a + (n.i < ti ? n.len - 1 : 0), 0)] ?? null);
        }
        return;
      }
      s += braille;
      for (const p of inputPos) src.push(charSrc[at + (typeof p === 'number' ? p : 0)] ?? null);
    });
    if (g.hyperlink && !g.linkUnderline) { s += HYPERLINK_CLOSE; for (let i = 0; i < HYPERLINK_CLOSE.length; i++) src.push(null); }   // mirror segmentsToBraille (F-233 / LINK-2)
    pos += g.len;
  }
  return tcTrimBoth(s, src);
}
const segsAreRich = (segs, o = null) => segs.length > 1 || !!(segs[0] && (segs[0].tf || segs[0].hyperlink || segs[0].transcriberTypeform || segs[0].uncontracted || segs[0].type === 'math' || segs[0].type === 'imgnote' || segs[0].type === 'brl' || (o && o.foreignText && foreignLangIndex(segs[0].lang))));   // mirror formatTable's segsBraille (K16: a foreign cell)
function tcCell(o, cell, unit, dittoMarks) {                 // mirror formatTable's tr() (F-16)
  if (dittoMarks && DITTO_RE.test(cellPlainText(cell).trim())) return { s: DITTO_BRL, src: Array.from(DITTO_BRL, () => null) };
  const segs = trimRunEdges(cellSegments(cell));   // mirror formatTable's tr() (A89)
  if (segsAreRich(segs, o)) return tcRstrip(tcJoined(o, [{ segs, unit }]));
  return tcRun(o, segs.map((g) => g.text || '').join('').replace(/\s+$/, ''), null, unit, 0);
}
function tcWrap(o, tr, width, first, runover) {              // mirror wrapCells (+ trailing strip)
  const { lines, srcs } = wrapCellsSrc(tr.s, tr.src, width, first, runover);
  return lines.map((line, i) => tcRstrip({ s: line, src: srcs[i] }));
}
function tcCentredBlock(o, tr, width, wrapWidth = width) {   // mirror centredBlock: wrap 0/0 then centre(trim)
  const { lines, srcs } = wrapCellsSrc(tr.s, tr.src, wrapWidth, 0, 0);
  return lines.map((line, i) => {
    let a = 0, b = line.length; while (a < b && line[a] === ' ') a++; while (b > a && line[b - 1] === ' ') b--;
    const trimmed = line.slice(a, b);
    const pad = Math.max(0, Math.floor((width - trimmed.length) / 2));
    const src = []; for (let k = 0; k < pad; k++) src.push(null); for (let k = a; k < b; k++) src.push(srcs[i][k]);
    return tcRstrip({ s: ' '.repeat(pad) + trimmed, src });
  });
}
// Mirror of centredHeadingBlock (BANA §4.4.3, F-40): same balancedWrapWidth search over
// the plain translated text (word/width arithmetic only — no source positions involved),
// then wrap+centre with wrapCellsSrc/pad exactly as tcCentredBlock does, just at the
// narrower balanced width instead of `wrapWidth`. Same `\n` fallback to plain tcCentredBlock.
function tcCentredHeadingBlock(o, tr, width, wrapWidth = width) {
  if (tr.s.includes('\n')) return tcCentredBlock(o, tr, width, wrapWidth);
  const bw = balancedWrapWidth(tr.s, wrapWidth);
  const { lines, srcs } = wrapCellsSrc(tr.s, tr.src, bw, 0, 0);
  return lines.map((line, i) => {
    let a = 0, b = line.length; while (a < b && line[a] === ' ') a++; while (b > a && line[b - 1] === ' ') b--;
    const trimmed = line.slice(a, b);
    const pad = Math.max(0, Math.floor((width - trimmed.length) / 2));
    const src = []; for (let k = 0; k < pad; k++) src.push(null); for (let k = a; k < b; k++) src.push(srcs[i][k]);
    return tcRstrip({ s: ' '.repeat(pad) + trimmed, src });
  });
}
// Traced mirror of tableTitleLines (BANA §11.3.1a): each print line of a table heading,
// independently centred (and wrapped if it alone overflows the width) — never joined with
// an adjacent print line. unit 0 throughout, matching traceTable's pre-existing single-line
// traceTitle (a heading has no per-cell "unit" of its own to trace).
function traceTableTitleLines(title, o, w) {
  if (title == null) return [];
  const raw = Array.isArray(title) ? title : [title];
  const out = [];
  for (const line of raw) {
    const s = String(line ?? '').trim();
    if (!s) continue;
    out.push(...tcCentredHeadingBlock(o, tcRun(o, s, null, 0, 0), w));
  }
  return out;
}
// BANA §11.4.3: Complex Tables with Column and Sub-column Headings. `headerGroups`
// carries the primary heading row; `headers`/`headerTrs` (unchanged) stays the flat
// sub-column/single-tier row. Gold-derived from the section's only four worked
// two-tier-header samples (11-2, 11-9, 11-13, 11-15 — standards-findings.md F-12):
//  - the primary row (a) and its separation line span ONLY the grouped columns; a
//    column with no group is blank on both those lines (11.4.2c: "Columns without a
//    heading do not have a separation line" — read here as "without a heading AT
//    THAT TIER").
//  - the sub-column row (b) and its OWN separation line (c) span every column,
//    grouped or not: a single-tier column's own heading — one line, or, per §11.4.1's
//    generic two-line cap, two — sits BOTTOM-ALIGNED against this row. A one-line
//    heading (Samples 11-9/11-13/11-15's "Year"/"Annual avg"/"prép.") sits only here;
//    a two-line one (Sample 11-2's "Fiscal Year", wrapped "Fiscal"/"Year" because it
//    doesn't fit its own 7-cell column) puts its runover ("Year") here and pushes its
//    first line ("Fiscal") into an EXTRA row inserted between the primary row's
//    separation line and this row — never sharing the primary row itself, confirmed
//    by the gold braille's literal blanks under the grouped columns on that extra row
//    and under the single-tier column on the primary row (see the gold JSON's own
//    line-by-line `braille.notes`).
// A72 stage 3 ("one layout path" — tables): this was traceGroupedHeaderRows, the traced
// mirror of formatGroupedHeaderRows; the format-side function (and this comment's
// original home, above it) is gone -- this is the only implementation left, called from
// traceColumnar. `headerTrs[ci]` is already the traced {s,src} for column ci's flat
// (sub-column/single-tier) heading; `headerGroups[gi].tr` is the traced {s,src} for the
// group's own primary heading (translated once in traceTable's setup).
function traceGroupedHeaderRows(headerTrs, headerGroups, actualWidths, gutter, w, overhangWidths = null, o = { mode: 'bana' }) {
  const colCount = actualWidths.length;
  const groupOf = groupColumnMap(colCount, headerGroups);
  const overhang = overhangWidths || Array(colCount).fill(0);
  // BANA §11.4.3a overhang (Change 2) — traced mirror of the same helper in
  // formatGroupedHeaderRows/padOverhang: append extra blank cells (null src) after a
  // specific column's part.
  const padPartOverhang = (part, ci) => (overhang[ci] ? { s: part.s + ' '.repeat(overhang[ci]), src: [...part.src, ...Array(overhang[ci]).fill(null)] } : part);

  const ownWrapped = headerTrs.map((tr, ci) => wrapCellsSrc(tr.s, tr.src, actualWidths[ci], 0, 0));
  // A group flagged `.overhang` stays UNWRAPPED, one line, at its own full width.
  const groupWrapped = headerGroups.map((g) => (g.overhang ? { lines: [g.tr.s], srcs: [g.tr.src] } : wrapCellsSrc(g.tr.s, g.tr.src, groupSpanWidth(g, actualWidths, gutter), 0, 0)));

  const primaryTierHeight = Math.max(1, ...groupWrapped.map((wc) => wc.lines.length));
  const groupedCols = [...Array(colCount).keys()].filter((ci) => groupOf[ci] != null);
  const subTierHeight = Math.max(1, ...groupedCols.map((ci) => ownWrapped[ci].lines.length));
  const extra = Array(colCount).fill(0);
  for (let ci = 0; ci < colCount; ci++) {
    if (groupOf[ci] == null) extra[ci] = Math.max(0, ownWrapped[ci].lines.length - subTierHeight);
  }
  const maxExtra = Math.max(0, ...extra);

  const out = [];
  const slots = [];
  for (let ci = 0; ci < colCount;) {
    const gi = groupOf[ci];
    if (gi != null) {
      const g = headerGroups[gi];
      slots.push({ width: groupSpanWidth(g, actualWidths, gutter) + (g.overhang ? overhang[g.to] : 0), groupIndex: gi });
      ci = g.to + 1;
    } else { slots.push({ width: actualWidths[ci] }); ci++; }
  }
  const padTr = (s, src, width) => ({ s: s + ' '.repeat(Math.max(0, width - s.length)), src: [...src, ...Array(Math.max(0, width - s.length)).fill(null)] });
  const joinSlotLine = (parts) => {
    let s = '', src = [];
    for (let i = 0; i < parts.length; i++) {
      s += parts[i].s; src.push(...parts[i].src);
      if (i < parts.length - 1) { s += ' '.repeat(gutter); for (let k = 0; k < gutter; k++) src.push(null); }   // two cells (11.2.5b, K33)
    }
    return { s: s.slice(0, w), src: src.slice(0, w) };
  };

  for (let li = 0; li < primaryTierHeight; li++) {
    const parts = slots.map((sl) => {
      if (sl.groupIndex == null) return { s: ' '.repeat(sl.width), src: Array(sl.width).fill(null) };
      const wc = groupWrapped[sl.groupIndex];
      const lineS = wc.lines[li] || ''; const lineSrc = wc.srcs[li] || [];
      return padTr(lineS, lineSrc, sl.width);
    });
    out.push(joinSlotLine(parts));
  }
  {
    const parts = slots.map((sl) => {
      if (sl.groupIndex == null) return { s: ' '.repeat(sl.width), src: Array(sl.width).fill(null) };
      const dots = TABLE_GUIDE + '3'.repeat(Math.max(0, sl.width - 1));
      return { s: dots, src: Array(dots.length).fill(null) };
    });
    out.push(joinSlotLine(parts));
  }

  for (let li = 0; li < maxExtra; li++) {
    const parts = Array.from({ length: colCount }, (_, ci) => {
      if (groupOf[ci] != null || extra[ci] === 0) return padPartOverhang({ s: ' '.repeat(actualWidths[ci]), src: Array(actualWidths[ci]).fill(null) }, ci);
      const padTop = maxExtra - extra[ci];
      const wc = ownWrapped[ci];
      const idx = li - padTop;
      const lineS = (idx >= 0 ? wc.lines[idx] : '') || '';
      const lineSrc = (idx >= 0 ? wc.srcs[idx] : []) || [];
      return padPartOverhang(padTr(lineS, lineSrc, actualWidths[ci]), ci);
    });
    out.push(joinSlotLine(parts));
  }

  const subTierLines = Array.from({ length: colCount }, (_, ci) => {
    const wc = ownWrapped[ci];
    if (groupOf[ci] != null) return wc;
    const padTop = subTierHeight - wc.lines.length;
    if (padTop > 0) return { lines: [...Array(padTop).fill(''), ...wc.lines], srcs: [...Array(padTop).fill([]), ...wc.srcs] };
    const start = wc.lines.length - subTierHeight;
    return { lines: wc.lines.slice(start), srcs: wc.srcs.slice(start) };
  });
  for (let li = 0; li < subTierHeight; li++) {
    const parts = subTierLines.map((wc, ci) => {
      const lineS = wc.lines[li] || ''; const lineSrc = wc.srcs[li] || [];
      return padPartOverhang(padTr(lineS, lineSrc, actualWidths[ci]), ci);
    });
    out.push(joinSlotLine(parts));
  }
  // B004 §12 / Appendix E (Task 2, 26 Sep 2026): BANA-only, mirror formatGroupedHeaderRows.
  if (isBanaOpts(o)) out.push(tcDeco(tableSeparator(actualWidths, gutter, headerTrs.map((h) => !!(h.s && h.s.trim())), overhang).slice(0, w)));

  return out;
}
function traceBlock(block, o, atStart, unit = 0) {
  const traced = traceBlockCore(block, o, atStart, unit);
  return block && typeof block === 'object' && block.type === 'list' ? withListKeep(traced, emphasisResolvedOf(block, o), o) : traced;   // mirror formatBlock (F-35)
}
function traceBlockCore(block, o, atStart, unit = 0) {
  if (!block || typeof block !== 'object') return [];
  block = emphasisResolvedOf(block, o);                  // mirror formatBlock (F-99 / F-215, K1)
  installScrub(o);
  const w = o.width;
  const paraLike = (block) => {
    const text = block.text ?? '';
    if (!text.trim()) return [];
    const q = quoteMargins(block, o);                  // mirror formatPara (displayed material)
    if (q) {
      const res = tcWrap(o, tcRun(o, text, null, unit, 0), w, block.continuation ? q.runover : q.first, q.runover);
      return quoteLines(res, q, block).map((x) => (x === '' ? tcBlank : x));
    }
    const blocked = !!block.blocked;                     // mirror formatPara (F-39 / §1.9.3)
    const isBlock = o.paragraphStyle === 'block';
    const dm = directionsMargins(block, o) || hangingMargins(block);
    const first = dm ? dm.first : (blocked || isBlock || block.continuation) ? 0 : 2;
    const res = tcWrap(o, tcRun(o, text, null, unit, 0), w, first, dm ? dm.runover : 0);
    if (blocked && !block.continuation) res.unshift(tcBlank);
    else if (isBlock && !block.continued) res.push(tcBlank);
    return withEpigraphBlanksTc(res, block, o);           // mirror formatPara (F-94 / §9.3.1d)
  };
  switch (block.type) {
    case 'title': {                                   // mirror formatTitle: each line of a title (Title + Subtitle, IMP-W1) centred on its own
      const parts = String(block.text ?? '').split('\n');
      let base = 0;
      return parts.flatMap((part) => { const r = tcCentredBlock(o, tcRun(o, part, null, unit, base), w).map((x) => tcRstrip(x)); base += part.length + 1; return r; });
    }
    case 'heading': {
      block = headingWithTrimmedEdges(block);   // as formatHeading
      // §4.3.7 / forceBold, as formatHeading — see formatHeading's comment for the full
      // BANA §4.2.1 / UKAAF Appendix A reading behind levels 4-6.
      const plainTr = () => (block.segments ? tcSegs(o, block.keepEmphasis ? block.segments : headingEmphasisOf(block.segments, o), unit) : tcRun(o, block.text ?? '', null, unit, 0));   // keepEmphasis: F-75, see formatHeading; headingEmphasisOf: K1
      const boldTr = () => {
        if (block.segments) return tcSegs(o, forceBold(stripEmphasis(block.segments)), unit);
        const text = block.text ?? '';
        return tcRun(o, text, Array(text.length).fill(TF_BOLD), unit, 0);
      };
      const L = block.level || 1; const out = [];
      if (o.mode === 'bana') {
        const tier = block.tierOverride || banaTier(L, o);   // mirror formatHeading
        const dspOff = block.displayed ? 2 : 0;               // K6 / §9.2.2c, mirror formatHeading
        if (tier === 'cell5') out.push(tcBlank, ...tcWrap(o, plainTr(), w, 4 + dspOff, 4 + dspOff));
        else if (tier === 'cell7') out.push(tcBlank, ...tcWrap(o, plainTr(), w, 6 + dspOff, 6 + dspOff));
        else out.push(tcBlank, ...tcCentredHeadingBlock(o, plainTr(), w, Math.max(1, w - 6)), tcBlank);
      } else {
        if (L === 1) {                                   // mirror formatHeading: no end marker at the document start; UK-1/UK-6 conditional marker
          if (atStart) out.push(...tcCentredBlock(o, plainTr(), w));
          else {
            const wantMarker = o.endMarkers === true || block.endMarkerBefore === true;   // UK-1/UK-6, mirror formatHeading
            out.push(...(wantMarker ? [tcDeco(indicatorLine('colons', w))] : []), ...tcCentredBlock(o, plainTr(), w));   // UK-6 colons marker; UK-5 no blank line
          }
        } else if (L === 2 || L === 5) out.push(tcBlank, ...tcWrap(o, plainTr(), w, 0, 4));   // UK-5 sub-heading: blank line kept
        else if (L === 3) out.push(...tcWrap(o, plainTr(), w, 2, 4));                          // UK-5: no blank-line exception here
        else if (L === 4) out.push(tcBlank, ...tcWrap(o, boldTr(), w, 0, 4));                  // UK-5 sub-heading: blank line kept
        else out.push(...tcWrap(o, boldTr(), w, 2, 4));                                        // UK-5: no blank-line exception here
      }
      return out.map((x) => tcRstrip(x));
    }
    case 'para':
    default: {   // mirror formatBlockUnguarded: an unrecognised block.type falls through to formatPara too (A39 stage 2 fix -
                 // this used to be a separate `default: return paraLike(block)` below that skipped wordGapsOf and segments)
      const typed = typedBrailleRuns(block);             // feedback item 3: typed braille comes out exactly as typed
      if (typed) return typedBrailleLinesTc(typed, w, unit);
      block = wordGapsOf(block);                        // mirror formatPara (F-219 / F-206, 19.4.1c)
      // #58 (1 Oct 2026): a forced line break ('\n': Shift+Enter, <br>, RTF \line — IMP-W2) in a paragraph with no formatting is a line
      // break, as it is in a paragraph with segments; translated as plain text, liblouis turned it into a space and the lines ran together.
      if (block.type === 'para' && !block.segments && typeof block.text === 'string' && block.text.includes('\n') && !isDiagramPara(block, o)) block = { ...block, segments: [{ type: 'text', text: block.text }] };
      if (isDiagramPara(block, o)) {                     // mirror formatDiagramPara (F-189, 18.7.1 / 18.8.1)
        const tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, String(block.text ?? ''), null, unit, 0);
        if (!tr.s.trim()) return [];
        const lines = tcWrap(o, tr, w, 0, 2);
        const arrows = arrowLinesOf(block, o).map(tcDeco);
        if (arrows.length) return [tcBlank, ...arrows, ...lines, tcBlank];
        return block.blocked && !block.continuation ? [tcBlank, ...lines] : lines;   // mirror formatDiagramPara
      }
      if (block.segments) {
        const pnSegs = paraNumberSegs(block, block.segments, o);   // mirror formatSegmentedPara (F-205)
        const run = block.tfRun;                         // mirror formatSegmentedPara (K4)
        const tr = tfRunWrapTc(tcSegs((segsWhollyUncontracted(block.segments) || block.g1Quiet) ? g1Quiet(o) : o, run ? dropTfBits(pnSegs, run.m) : pnSegs, unit, true), run);
        if (!stripLineNumbers(tr.s)) return [];
        const note = lineNumberNote(block, o).map(tcDeco);
        const gap = note.length ? [tcBlank] : [];        // F-234 / BANA 15.8.1c, mirror formatSegmentedPara
        const q = quoteMargins(block, o);              // mirror formatSegmentedPara
        if (q) {
          const res = tcWrapBody(o, tr, w, block.continuation ? q.runover : q.first, q.runover, !!block.countedWords);
          return [...note, ...gap, ...quoteLines(res, q, block).map((x) => (x === '' ? tcBlank : x))];
        }
        const blocked = !!block.blocked;                 // mirror formatSegmentedPara (F-39 / §1.9.3)
        const isBlock = o.paragraphStyle === 'block';
        const dm = directionsMargins(block, o) || hangingMargins(block);
        const first = dm ? dm.first : (blocked || isBlock || block.continuation) ? 0 : 2;   // a paragraph resumed after a page turn: cell 1
        const res = tcWrapBody(o, tr, w, first, dm ? dm.runover : 0, !!block.countedWords);
        if (blocked && !block.continuation) res.unshift(tcBlank);
        else if (isBlock && !block.continued) res.push(tcBlank);
        return [...note, ...gap, ...withEpigraphBlanksTc(res, block, o)];   // §9.3.1d (F-94)
      }
      return paraLike(block);
    }
    case 'attribution': {
      const tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, block.text || '', null, unit, 0);
      if (!tr.s) return [];
      // A23 / §9.4.1b: mirror formatAttribution's block.attribCell (the real previous-line
      // offset computed by buildDocPages/buildDocPagesAsync), falling back to the old fixed
      // cell 5 when it is unset (no previous line, previous line is a heading, or a direct
      // formatBlock/traceBlock call outside that pipeline).
      const cell = Number.isFinite(block.attribCell) ? block.attribCell : 4;
      // F-80: block.continued suppresses the trailing blank (mirrors formatAttribution).
      return [...tcWrap(o, tr, w, cell, cell), ...(block.continued ? [] : [tcBlank])].map((x) => tcRstrip(x));   // §9.4.1d blank after
    }
    case 'xref': {                                          // mirror formatXref (F-104)
      const tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, block.text || '', null, unit, 0);
      if (!tr.s) return [];
      const hh = block.heading && String(block.heading).trim() ? tcRun(o, String(block.heading), null, unit, 0) : null;
      const body = hh
        ? [...tcWrap(o, hh, w, 6, 6), ...tcWrap(o, tr, w, 4, 4)]
        : tcWrap(o, tr, w, o.mode === 'bana' ? 6 : 4, 4);
      return [tcBlank, ...body, tcBlank].map((x) => tcRstrip(x));
    }
    case 'caption': {
      const first = o.mode === 'bana' ? 6 : 4;
      const runover = o.mode === 'bana' ? 4 : 4;
      let tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, block.text || '', null, unit, 0);
      if (!tr.s) return [];
      if (block.identifier) {                              // mirror formatCaption (F-4)
        const idPart = block.identifier === true ? '' : o.translate(String(block.identifier)).trim() + ' ';
        tr = { s: TN_OPEN + idPart + tr.s + TN_CLOSE, src: [...Array.from(TN_OPEN + idPart, () => null), ...tr.src, ...Array.from(TN_CLOSE, () => null)] };
      }
      return [tcBlank, ...tcWrap(o, tr, w, first, runover)].map((x) => tcRstrip(x));
    }
    case 'dialogue':                                        // mirror formatBlockUnguarded's 'dialogue' case
      if (block.speaker || block.speech) {
        const full = block.speaker ? `${block.speaker}: ${block.speech || ''}` : (block.speech || '');
        return traceBlock({ ...block, type: 'play', text: full }, o, atStart, unit);
      }
      return traceBlock({ ...block, type: 'play' }, o, atStart, unit);
    case 'play': {
      const isVerse = block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem';
      const lvl = block.level || 0;
      const marginKind = (isVerse && o.mode === 'bana' && block.playVerse) ? 'play-verse' : 'poetry';   // mirror formatPlay (F-180)
      const dsp = isVerse && block.displayedPoem && o.mode === 'bana' ? 2 : 0;   // mirror formatPlay (13.3.1c)
      const nm = isVerse                                                   // mirror formatPlay
        ? nestedMargins(marginKind, lvl, block.maxLevel ?? lvl, o.mode)
        : { first: lvl === 0 ? 0 : 4, runover: 2 };
      const first = (block.poemFirst ?? nm.first) + dsp, runover = (block.poemRunover ?? nm.runover) + dsp;   // mirror formatPlay (F-128/F-129)
      let segs = (isPlaySpeakerStyle(block.style) && block.segments && o.mode === 'bana') ? stripCapsEmphasis(block.segments) : block.segments;   // mirror formatPlay (F-178, BANA-only)
      segs = speakerGapSegments(block, o, segs);   // F-206 (mirror formatPlay)
      segs = wideSpaceSegments(block, o, segs);    // F-124 (mirror formatPlay)
      const rhyme = isVerse ? takeRhymeLetter(block, segs, o) : null;   // mirror formatPlay (15.7.3d)
      if (rhyme) segs = rhyme.segs;
      const g1p = block.uncontractedPoem && o.mode === 'bana';             // mirror formatPlay (13.6.4a)
      let tr = g1p ? tcSegs({ ...o, g1Bare: true }, g1PoemSegs(block, segs), unit, true) : (segs ? tcSegs(o, segs, unit, true) : tcRun(o, block.text || '', null, unit, 0));   // F-181: keep linenum
      if (g1p && tr.s.trim()) {
        const pre = block.g1Open ? G1_PASSAGE_OPEN : '', post = block.g1Close ? G1_TERMINATOR : '';
        tr = { s: pre + tr.s + post, src: [...Array(pre.length).fill(null), ...tr.src, ...Array(post.length).fill(null)] };
      }
      if (!tr.s) return [];
      if (rhyme) {
        const rw = rhymeWrapOpts(o, w, hasLineNumbers(tr.s), rhyme.letter.length);
        const rl = tcWrapBody(rw.o, tr, rw.width, first, runover).map((x) => tcRstrip(x));
        if (rl.length) rl[0] = tcPutRhymeLetter(rl[0], rhyme.letter, w, o);
        return rl;
      }
      return tcWrapBody(o, tr, playWrapWidth(block, o, w, hasLineNumbers(tr.s), isVerse), first, runover).map((x) => tcRstrip(x));   // F-181: mirror formatPlay's wrapBody (15.5.1c width)
    }
    case 'verse':
    case 'poem':
    case 'poetry': {                                                        // mirror formatBlockUnguarded
      if (Array.isArray(block.lines)) {
        const out = [];
        block.lines.forEach((line, li) => {
          const itemUnit = unit ? (unit * 1000 + li) : li;
          out.push(...traceBlock({ type: 'play', subtype: 'verse', text: String(line), level: block.level || 0, maxLevel: block.maxLevel }, o, false, itemUnit));
        });
        return out;
      }
      return traceBlock({ ...block, type: 'play', subtype: 'verse' }, o, atStart, unit);
    }
    case 'stage': {
      const lvl = block.level || 0;
      const first = lvl === 0 ? 6 : 8;
      const runover = 6;
      const { segs, open, close } = stageParts(block, o);   // as formatStage
      const bracket = (t) => ({ segs: t ? [{ type: 'text', text: t }] : [], unit: null });
      const tr = tcJoined(o, [bracket(open), { segs, unit }, bracket(close)]);
      if (!tr.s) return [];
      return tcWrap(o, tr, w, first, runover).map((x) => tcRstrip(x));
    }
    case 'titlepage': return traceTitlePage(block, o, atStart, unit);   // K29 Stage 1b: BANA 2.3.3 — the ONE implementation (see traceTitlePage's own comment)
    case 'tnpage': {                                   // mirror formatTnPage (BANA 2.6.1); unit = the paragraph's index
      const w = o.width || 38;
      const head = tcRun(o, tnpageHeading(block, o), null, unit, 0);
      head.src = head.src.map(() => null);             // the heading is fixed text, not editable source
      const out = [...tcCentredHeadingBlock(o, head, w, Math.max(1, w - 6)), tcBlank];
      tnpageParas(block).forEach((pp, k) => {
        const tr = pp.segments ? tcSegs(segsWhollyUncontracted(pp.segments) ? g1Quiet(o) : o, pp.segments, k) : tcRun(o, String(pp.text), null, k, 0);
        out.push(...tcWrap(o, tr, w, 2, 0));
      });
      return out.map((x) => tcRstrip(x));
    }
    case 'sympage': {                                  // mirror formatSymPage (BANA 2.5.2); unit = the entry's index
      if (block.dormant || !sympageEntries(block).length) return [];
      const w = o.width || 38;
      const head = tcRun(o, sympageHeading(block), null, unit, 0);
      head.src = head.src.map(() => null);
      const out = [...tcCentredHeadingBlock(o, head, w, Math.max(1, w - 6)), tcBlank];
      sympageEntries(block).forEach((e, k) => {
        const { sym, desc } = symbolListLine(e, o);
        const parts = [tcDeco(sym)];
        if (desc) { parts.push(tcDeco(' ')); const tr = tcRun(o, desc, null, k, 0); tr.src = tr.src.map(() => null); parts.push(tr); }
        out.push(...tcWrap(o, { s: parts.map((x) => x.s).join(''), src: parts.flatMap((x) => x.src) }, w, 0, 2));
      });
      return out.map((x) => tcRstrip(x));
    }
    case 'note': {
      if (block.endnoteHead) return endnoteHeadLines(block, o).map((l) => (l ? tcDeco(l) : tcBlank));   // mirror formatTranscriberNote (IMP-W3)
      const keyLines = tnKeyLines(block, o);           // mirror formatTnKeyList (F-15 / BANA 3.3.2)
      if (keyLines) {
        const w = o.width || 38;
        const { first, runover } = tnMargins(o);
        const loc = block.keyLocator ? tcDeco('.=') : { s: '', src: [] };
        const run = (ln) => { const tr = tcRun(o, ln.text, null, unit, ln.base); const n = tr.s.trim().length; return { s: tr.s.trim(), src: tr.src.slice(0, n) }; };
        const cat = (...parts) => ({ s: parts.map((x) => x.s).join(''), src: parts.flatMap((x) => x.src) });
        const out = tcWrap(o, cat(tcDeco(TN_OPEN), run(keyLines[0])), w, first, runover).map((x) => tcRstrip(x));
        out.push(tcBlank);
        keyLines.slice(1).forEach((it, i, a) => {
          out.push(...tcWrap(o, cat(loc, run(it), i === a.length - 1 ? tcDeco(TN_CLOSE) : { s: '', src: [] }), w, 0, 2).map((x) => tcRstrip(x)));
        });
        out.push(tcBlank);
        return out;
      }
      const paras = tnParas(block);
      if (paras.length > 1) {                          // mirror formatTranscriberNote (F-164)
        const w = o.width || 38;
        const { first, runover } = tnMargins(o);
        const out = [];
        paras.forEach((cb, i) => {
          const tn = tnContent(cb);
          const tr = tcJoined(o, [{ segs: tn.segs, unit, base: tn.offset }]);
          const n = tr.s.trim().length;
          if (!n) return;
          const od = i === 0 ? tcDeco(TN_OPEN) : { s: '', src: [] };
          const cd = i === paras.length - 1 ? tcDeco(TN_CLOSE) : { s: '', src: [] };
          const full = { s: od.s + tr.s.trim() + cd.s, src: [...od.src, ...tr.src.slice(0, n), ...cd.src] };
          out.push(...tcWrap(o, full, w, first, runover).map((x) => tcRstrip(x)));
        });
        return out;
      }
      const text = String(block.text ?? '');
      if (!text.trim() && !block.segments) return [];
      const w = o.width || 38;
      const openDeco = block.tnPart === 'mid' || block.tnPart === 'last' ? { s: '', src: [] } : tcDeco(TN_OPEN);
      const closeDeco = block.tnPart === 'mid' || block.tnPart === 'first' ? { s: '', src: [] } : tcDeco(TN_CLOSE);
      const tn = tnContent(block);                     // mirror formatTranscriberNote
      const split = tnPrefixSplit(block, tn);          // F-241 (mirror formatTranscriberNote)
      if (split) {
        const a = tcJoined(o, [{ segs: split.pre, unit, base: tn.offset }]);
        const b = tcJoined(o, [{ segs: split.rest, unit, base: split.restOffset }]);
        const al = a.s.trim().length, bl = b.s.trim().length;
        const od = tcDeco(TN_OPEN), cd = tcDeco(TN_CLOSE);
        const both = { s: od.s + a.s.trim() + cd.s + ' ' + b.s.trim(), src: [...od.src, ...a.src.slice(0, al), ...cd.src, null, ...b.src.slice(0, bl)] };
        const { first: f1, runover: r1 } = tnMargins(o);
        return tcWrap(o, both, w, f1, r1).map((x) => tcRstrip(x));
      }
      const tr = tcJoined(o, [{ segs: tn.segs, unit, base: tn.offset }]);
      const trimmedLen = tr.s.trim().length;
      const full = {
        s: openDeco.s + tr.s.trim() + closeDeco.s,
        src: [...openDeco.src, ...tr.src.slice(0, trimmedLen), ...closeDeco.src]
      };
      const c5 = !!block.cell5 && o.mode === 'bana';   // mirror formatTranscriberNote (10.9.2b)
      const { first, runover } = c5 ? { first: 4, runover: 4 } : tnMargins(o);
      const ntc = tcWrap(o, full, w, first, runover).map((x) => tcRstrip(x));
      return c5 ? [tcBlank, ...ntc] : ntc;
    }
    case 'footnote': {
      const w = o.width || 38;
      if (block.noteCont) {   // mirror formatFootnote (#57c): a further paragraph of the note above, 5-3 in BANA, no lead lines, no mark
        const tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, block.text == null ? '' : String(block.text), null, unit, 0);
        if (!tr.s.trim()) return [];
        return tcWrap(o, tr, w, isBanaOpts(o) ? 4 : 0, 2).map((x) => tcRstrip(x));
      }
      const out = noteLead(block, o).map((l) => (l ? tcDeco(l) : tcBlank));
      // Mirror formatFootnote's markBrl: BANA 16.5.1/16.2.1, opening paragraph only.
      const markDeco = (block.noteMark && !block.noteMarkPlacement && !noteBodyStartsWithMark(block, block.noteMark)) ? tcDeco(noterefBraille({ text: block.noteMark }, o)) : null;
      const prepend = (tr) => (markDeco ? { s: markDeco.s + tr.s, src: [...markDeco.src, ...tr.src] } : tr);
      if (block.blocks && block.blocks.length) {
        // Mirror formatFootnote: 1-3 for the opening paragraph, 5-3 (BANA) after it (F-113).
        block.blocks.forEach((cb, i) => {
          let tr = cb.segments ? tcSegs(o, cb.segments, unit) : tcRun(o, cb.text || '', null, unit, 0);
          if (!tr.s) return;
          if (i === 0) tr = prepend(tr);
          const { first, runover } = (i > 0 && isBanaOpts(o)) ? { first: 4, runover: 2 } : { first: 0, runover: 2 };
          out.push(...tcWrap(o, tr, w, first, runover));
        });
      } else if (block.segments) {
        const seg = prepend(tcSegs(o, block.segments, unit));
        out.push(...tcWrap(o, seg, w, 0, 2));
      } else if (block.text && block.text.trim()) {
        const tr = prepend(tcRun(o, block.text, null, unit, 0));
        out.push(...tcWrap(o, tr, w, 0, 2));
      }
      const traced = out.map((x) => tcRstrip(x));
      // mirror formatFootnote: keep the note-separation line with its first body line (§16.5.1a)
      if (out.length > 1 && out[0].s === NOTE_SEPARATOR) Object.defineProperty(traced, 'keepGroups', { value: [[0, 1]] });
      return traced;
    }
    case 'list': {
      if (block.kind === 'glossary' || block.style === 'glossary') {
        return traceBlock({ ...block, type: 'glossary' }, o, atStart, unit);
      }
      const items = deriveExerciseLabels(block, o); if (!items.length) return [];   // K31 / BANA 10.8.5, 10.8.6 (mirrors formatList, A39)
      const compact = isCompactList(o); const out = [...lineNumberNote(block, o).map(tcDeco), ...(compact ? [] : [tcBlank])];
      const kind = block.kind;
      const mkind = listMarginKind(kind);
      const maxLevel = listMaxLevel(block);
      const tocCols = kind === 'toc' ? tocColumns(block, o) : null;
      let tocHeaderDone = false;
      let prevExample = false;                            // mirror formatList (10.8.3)
      const bulletPads = listBulletPads(block, o);          // mirror formatList (F-42)
      const colPlan = columnedListPlan(block, o);           // mirror formatList (F-34)
      const shared = sharedMarginOf(block, o);              // mirror formatList (F-212)
      if (colPlan) {
        const rowFrom = out.length;                          // mirror formatList (K24 / 8.4.1c)
        const cellTc = items.map((item, ui) => {
          if (item.segments) { const sg = tcSegs(g1Quiet(o), item.segments, ui, true); return tcTrimBoth(sg.s, sg.src); }
          const raw = tcRun(o, item.text ?? '', null, ui, 0);
          return tcTrimBoth(raw.s, raw.src);
        });
        for (const row of colPlan.rows) {
          let line = tcBlank;
          row.forEach((i, c) => { line = { s: line.s.padEnd(colPlan.starts[c]) + cellTc[i].s, src: [...line.src, ...Array.from({ length: Math.max(0, colPlan.starts[c] - line.s.length) }, () => null), ...cellTc[i].src] }; });
          out.push(tcRstrip(line));
        }
        out.push(tcBlank);
        return columnedListKeep(out.map((x) => tcRstrip(x)), rowFrom);   // mirror formatList (K24 / 8.4.1c)
      }
      const itemKeep = [];                                   // mirror formatList
      const qRanges = [];                                    // mirror formatList (K24 / 10.3, 10.4)
      let endsInItemBlock = false, extraUnits = 0;
      items.forEach((item, ui) => {
        if (!item) return;
        endsInItemBlock = false;
        const qFrom = out.length;                            // mirror formatList (K24)
        const lvl = item.level || 0;
        const nm = nestedMargins(mkind, lvl, maxLevel, o.mode, o.listStyle);   // mirror formatList
        const dOff = (block.displayed || block.translationPairs) && o.mode === 'bana' && kind !== 'toc' ? 2 : 0;   // F-79 / K27 (mirror formatList)
        const sc = shared != null ? sharedMarginCells(item, lvl, shared, maxLevel, o) : null;   // mirror formatList (F-212)
        const first = sc ? sc.first : nm.first + dOff, runover = sc ? sc.runover : nm.runover + dOff;
        if (tocInColumns(kind, item, tocCols, o)) {          // mirror formatList
          const transTitle = (item.title ?? item.text ?? '').replace(/\s+/g, ' ').trim();
          let titleBody;
          let titleLen = 0;
          if (item.segments) {
            titleBody = tcSegs(o, item.segments, ui);
            titleLen = item.segments.map(s => s.text || '').join('').length;
          } else {
            const raw = tcRun(o, transTitle, null, ui, 0);
            titleBody = tcTrimBoth(raw.s, raw.src);
            titleLen = transTitle.length;
          }
          if (titleBody.s.includes('\n')) titleBody = { s: titleBody.s.replace(/[\r\n]+/g, ' '), src: titleBody.src };
          const runPage = tcRun(o, tocPageText(block, item), null, ui, titleLen);   // F-151 (mirror formatList)
          const pageTc = tcTrimBoth(runPage.s, runPage.src);
          if (tocCols && !tocHeaderDone) { out.push(...tocCols.header.map(tcDeco)); tocHeaderDone = true; }
          out.push(...tocEntryLines(o, titleBody, pageTc, tocBraillePage(item, o), tocCols, first, runover));
          return;
        }

        if (o.mode === 'bana' && !compact) {                 // mirror formatList (10.8.3, 10.8.5, 10.8.6, 10.8.2)
          const ex = !!item.example;
          if (ex !== prevExample && out.length && out[out.length - 1].s !== '') out.push(tcBlank);
          prevExample = ex;
          if (hasExampleLabel(item)) {
            const lp = exampleLabelParts(item);
            const lb = lp.segs ? segmentsToBraille(lp.segs, g1Quiet(o)) : o.translate(lp.plain);
            out.push(...tcWrapBody(o, tcDeco(lb), w, first, runover));
          }
        }
        // An item's further paragraphs (item.blocks) are list lines of their own in the editor, so the units count them:
        // the k-th line of the list is unit k (the same as the item index when no item has further paragraphs).
        const liIdx = ui + extraUnits;
        const itemUnit = unit ? (unit * 1000 + liIdx) : liIdx;
        // UK-10 (28 Sep, James / decisions.md "UKAAF"): "Show bullets" doc option, default on, both
        // modes. Off leaves an UNORDERED bullet out entirely (the item lays out as a plain item, no
        // bullet cell) — a numbered or lettered marker (rawBul without an .ordinal is the pure-bullet
        // case; an .ordinal beside a bullet, §8.7.1a, is the numbered/lettered marker this must keep)
        // is unaffected. `rawBul` (not gated by showBullets) still drives `blankItem` below, unchanged.
        const rawBul = itemBullet(item, block, o);
        const bulletsOn = o.showBullets !== false;
        // The compact (5-1) layout keeps the item's marker too (28 Sep): it used to drop every marker (B004 §10
        // Ex2's ingredients list has none), which, once compact became the UKAAF default (UK-5), took the numbers
        // off every numbered list. Numbers are content and always stay; bullets follow Show bullets (UK-10).
        const bul = bulletsOn ? rawBul : null;
        const pad = (compact || !bulletsOn) ? 0 : (bulletPads.get(lvl) || 0);
        const marker = (!bulletsOn && rawBul && !rawBul.ordinal) ? '' : (item.marker ? item.marker + ' ' : '');
        const bom = bul && bul.ordinal ? bul.ordinal + ' ' : '';
        const markerStr = bul ? bul.brl + ' '.repeat(Math.max(1, pad - bul.brl.length)) + (bom ? (item.segments ? o.translate(bom).trim() + ' ' : o.translate(bom)) : '')   // §8.6.2a/§8.7.1a, as formatList
          : !marker ? ''
          : (item.segments ? itemMarkerTranslate(o, marker).trim() + ' ' : o.translate(marker));   // mirror formatList (K16: BANA 8.10)
        const blankItem = !rawBul && !item.segments && item.blank && !String(item.text ?? '').trim();   // mirror formatList (8.8.2 blank division)
        const markerSrc = Array.from(markerStr, () => null);
        const tr = blankItem ? { s: BLANK_CELLS, src: [null, null, null] } : item.segments ? tcSegs(g1Quiet(o), item.segments, itemUnit, true) : tcRun(o, item.text ?? '', null, itemUnit, 0);
        const markerStrB = blankItem && markerStr ? markerStr.replace(/\s+$/, '') + ' ' : markerStr;
        let full = markerStr ? { s: markerStrB + tr.s, src: [...Array.from(markerStrB, () => null), ...tr.src] } : tr;
        const pageBrl = pageSuffix(item, o);                 // mirror formatList
        if (pageBrl) {
          const t = tcRstrip(full);
          full = { s: t.s + pageBrl, src: [...t.src, ...Array.from(pageBrl, () => null)] };
        }
        const lead = item._itemCont && !compact ? runover + 2 : first;   // mirror formatList (editor: an item's further paragraph after its table)
        out.push(...tcWrapBody(o, full, w, lead + (pad && !bul ? pad : 0), runover + pad));
        if (item.blocks) {                                   // mirror formatList (formatItemBlocks)
          const before = out.length;
          traceItemBlocks(item, o, w, first, runover, compact, out, itemKeep, (k) => (unit ? unit * 1000 + liIdx + 1 + k : liIdx + 1 + k), maxLevel);
          extraUnits += itemBlocksOf(item).filter(isItemParaBlock).length;
          endsInItemBlock = out.length > before && out[out.length - 1].s === '';
        }
        qRanges.push({ item, from: qFrom, to: out.length - 1 });   // mirror formatList (K24)
      });
      if (!compact && !endsInItemBlock) out.push(tcBlank);   // mirror formatList
      const traced = out.map((x) => tcRstrip(x));
      if (itemKeep.length) Object.defineProperty(traced, 'keepGroups', { value: itemKeep, configurable: true });
      return exerciseKeep(traced, block, qRanges, o);        // mirror formatList (K24 / 10.3, 10.4)
    }
    case 'glossary': {
      const items = block.items || [];
      if (!items.length) return [];
      const out = [tcBlank];
      const punctOnly = glossaryPunctOnly(block);                        // mirror formatGlossary (K25)
      const mixed = !block.thesaurus && !punctOnly && glossaryMixedStyles(items);
      const termMask = glossaryEntryWordMask(items, isMultilevelThesaurus(block));   // mirror formatGlossary
      const gm = glossaryMargins(block, items);
      items.forEach((it, ui) => {
        if (!it) return;
        const { first, runover } = gm(it);
        const segs = foreignRefSegments(block, glossarySegments(it, mixed, !!block.dictionary, o, punctOnly, termMask));   // mirror formatGlossary (K16 / 21.6.3b)
        const seg = segs.length ? tcSegs(o, segs, ui) : { s: '' };
        if (seg.s) out.push(...tcWrap(o, seg, w, first, runover));
      });
      out.push(tcBlank);
      return out.map((x) => tcRstrip(x));
    }
    case 'box':
    case 'sidebar': {                                        // mirror formatBox
      const text = block.text || '';
      const w = o.width || 38;
      const rawTitle = boxTitleText(block);
      let { top, bottom } = boxBorders(block, o, w);
      const colorPrefix = boxColorPrefix(block, o);   // K7 — mirror formatBox
      if (colorPrefix) top = colorPrefix.length < top.length ? colorPrefix + top.slice(colorPrefix.length) : colorPrefix;
      const inner = { ...o, _boxDepth: (o._boxDepth || 0) + 1 };
      const body = [];
      const add = (lines) => { for (const l of lines) { if (!l) continue; if (l.s === '' && (!body.length || body[body.length - 1].s === '')) continue; body.push(l); } };
      const kids = Array.isArray(block.blocks) ? block.blocks : [];
      const hasTitleHeading = !!rawTitle && kids.some((cb) => cb && typeof cb === 'object' && cb.type === 'heading' && String(cb.text ?? '').trim() === rawTitle);
      const titleHeadingBlock = (rawTitle && !hasTitleHeading) ? boxTitleHeading(block, rawTitle) : null;
      if (titleHeadingBlock) add(traceBlock(titleHeadingBlock, inner, false, 0));
      // BANA §11.3.1b/c/d — mirror formatBox's before-box title hoist (see there for the rule).
      let hoistedTitle = [];
      const citationBelow = [];                            // mirror formatBox (BANA 11.2.5g / 9.5.3)
      const renderKids = kids.map((cb) => {
        if (cb && typeof cb === 'object' && cb.type === 'table' && !citationBelow.length && tableCitation(cb) && tableCitation(cb).position === 'below-box') {
          citationBelow.push(...tableCitationLines(cb, inner).map((l) => tcDeco(l)));
          cb = { ...cb, citation: null };
        }
        if (!hoistedTitle.length && cb && typeof cb === 'object' && cb.type === 'table' && cb.title && cb.titlePosition === 'before-box') {
          hoistedTitle = traceTableTitleLines(cb.title, inner, w);
          return { ...cb, title: null };
        }
        return cb;
      });
      if (renderKids.some((cb) => cb && typeof cb === 'object')) {
        // A74 / UK-5 (28 Sep, this brief): UKAAF carries no blank lines at all (except before a
        // sub-heading), and joinsWithoutBlank already implements that for the top-level document flow
        // (buildDocPages/buildDocPagesAsync's own call) — but a box's children were laid out through
        // this hand-rolled loop instead, which only ever mirrored BANA's own narrow §10.2.3 "directions"
        // case (P5) below, so a UKAAF box kept every blank line its children's formatters emit around
        // themselves (a table, a footnote run, …). Consulting joinsWithoutBlank for every sibling pair
        // here too — including the box's own title heading against its first child — fixes that. BANA is
        // unchanged: the guard still only fires for that same para+directions case as before.
        const ukaaf = !isBanaOpts(inner);
        let prevKid = titleHeadingBlock;
        renderKids.forEach((cb, u) => {
          if (!cb || typeof cb !== 'object') return;
          let lines = traceBlock(cb, inner, false, u);
          const drop = prevKid && (ukaaf ? joinsWithoutBlank(prevKid, cb, inner) : (prevKid.type === 'para' && prevKid.directions && joinsWithoutBlank(prevKid, cb, inner)));   // mirror formatBox (P5) for BANA; UK-5 for UKAAF
          if (drop) {
            while (body.length && body[body.length - 1].s === '') body.pop();
            while (lines.length && lines[0] && lines[0].s === '') lines = lines.slice(1);
          }
          add(lines);
          prevKid = cb;
        });
      } else if (text.trim()) {
        // tcRun already has the no-positions fallback (A39 stage 2); this used to call
        // o.translatePos directly, which threw when formatBlock's projection reached this
        // case without one.
        add(tcWrap(o, tcRun(o, text, null, 0, 0), w, 0, 2));
      }
      while (body.length && body[body.length - 1].s === '') body.pop();
      // A70 (26 Sep): an empty box - no title, no content, no hoisted/below-box table
      // citation - used to still emit its bare top/bottom border lines. The editor no
      // longer leaves an empty box behind (the sidebar fix), but an imported one can still
      // reach here. Produce nothing instead.
      if (!hoistedTitle.length && !body.length && !citationBelow.length) return [];
      if (block.boxLines === false) return [tcBlank, ...hoistedTitle, ...body, ...citationBelow, tcBlank].map((x) => tcRstrip(x));   // mirror formatBox (F-230)
      return [tcBlank, ...hoistedTitle, tcDeco(top), ...body, tcDeco(bottom), ...citationBelow, tcBlank].map((x) => tcRstrip(x));
    }
    case 'pagenum': return pageNumLines(block, o).map((l) => tcDeco(l));   // A39: formatBlock is a projection of this (shared pageNumLines)
    // Maths: transcribe the MathML via the maths engine (UEB/Nemeth per mode) to BRF ASCII,
    // then set it off as a displayed block (blank line before; blocked at cell 1, runover
    // cell 3). Requires o.mathToBrf (maths engine ready); if absent or it errors, the
    // equation is skipped rather than breaking the document. A39: formatBlock is a
    // projection of this (was formatMath).
    case 'math': {
      let brf;
      if (isUnreadableMath(block)) brf = unreadableMathBrf(o, block);   // A89
      else {
      if (!o.mathToBrf || (!block.mathml && !block.latex)) return [];
      try { brf = o.mathToBrf(block); }
      catch (e) {
        if (isRejectedMath(e)) brf = unreadableMathBrf(o, block, e);   // S2b #11: the engine rejected a non-empty equation: the note stands for it
        else { pushWarning(o, 'block-skipped', `Equation could not be transcribed: ${(e && e.message) || e}`, { blockType: 'math' }); return []; }
      }
      }
      if (!brf) return [];
      // A11: a matrix (or other multi-row spatial layout) marks its row boundaries with an
      // embedded '\n' (cleanMathCatBraille, engine/maths.mjs) -- each row is a grid row the
      // maths engine already positioned, not a wrapped continuation of one long equation.
      // wrapCells's ordinary +2 "runover" indent is a PROSE convention (for an equation long
      // enough to word-wrap); applying it here pushed every row after the first two cells out
      // of alignment with row 1. Column alignment / enlarged brackets / the minus-sign hang /
      // side-by-side matrices remain separate, larger, not-yet-implemented work (A11).
      const runover = brf.includes('\n') ? 0 : 2;
      return [tcBlank, ...tcWrap(o, tcDeco(brf), w, 0, runover)].map((x) => tcRstrip(x));
    }
    case 'break':
    case 'indicator':
      if (block.kind === 'line' || block.kind === 'stanza') return [tcBlank];
      if (block.text) return tcWrap(o, tcRun(o, block.text, null, unit, 0), w, 0, 0);
      return [...tdSymbolNote(block, o).map(tcDeco), tcDeco(indicatorLine(block.kind || 'dot2s', w, isBanaOpts(o) ? 'bana' : 'ukaaf'))];
    case 'blank': return [tcBlank];
    case 'code': {                                          // mirror formatCodeBlock: grade-1 passage, no per-char source
      const text = String(block.text ?? '');
      if (!text.trim()) return [];
      const w = o.width || 38;
      const lines = text.split('\n');
      const g1 = o.translateG1 || o.translateUncontracted || o.translate;
      const loc = block.dotLocator ? DOT_LOCATOR_USE : '';   // mirror formatCodeBlock (F-220 / F-219)
      const out = [tcBlank, tcDeco(loc + G1_PASSAGE_OPEN)];
      lines.forEach((l) => {
        if (!l.trim()) return;
        const t = g1(codeLineSpaced(l, block, w));
        if (block.keepSpaces && t.replace(/\s+$/, '').length <= w) { out.push(tcDeco(t)); return; }
        out.push(...tcWrap(o, tcDeco(t), w, 0, 2));
      });
      out.push(tcDeco(loc + G1_TERMINATOR), tcBlank);
      return out.map((x) => tcRstrip(x));
    }
    case 'table': return withTableCitationTrace(block, o, traceTable(block, o));
    case 'graphic': case 'tactile': return traceTactileGraphic(block, o);
  }
}

// Traced mirror of withTableCitation: the citation cells carry no source coordinate.
function withTableCitationTrace(block, o, lines) {
  if (isFacingLines(lines)) return lines;                   // K15: mirror withTableCitation
  if (!lines.length) return lines;
  const cl = tableCitationLines(block, o).map((l) => tcDeco(l));
  let at = lines.length;
  while (at > 0 && lines[at - 1].s === '') at--;
  if (cl.length) { lines.splice(at, 0, ...cl); at += cl.length; }
  if (o.mode !== 'bana' && o.tableEndMarker !== false) lines.splice(at, 0, tcDeco(indicatorLine('dot2s', o.width || 38)));   // UK-6, mirror withTableCitation
  return lines;
}

// Traced counterpart to formatTable for character-to-cell coordinate mapping
function traceTable(block, o) {
  // mirror formatTable: BANA 11.15 / B004 App E interchanged table, each braille entry traced back to its print cell.
  if (tableFormatMode(block, o) === 'interchange') {
    const t = interchangedTable(block, o);
    if (!t) return traceTable({ ...block, format: 'auto' }, o);
    const lines = traceTable(t, o);
    const out = lines.map((l) => (l && Array.isArray(l.src) ? { ...l, src: l.src.map((p) => (p && typeof p.u === 'number' ? { ...p, u: t._interchangeOf(p.u) } : p)) } : l));
    for (const k of ['keepGroups', 'headKeep', 'headLines', 'rowStarts']) if (lines[k] !== undefined) Object.defineProperty(out, k, { value: lines[k] });
    return out;
  }
  const rawHeaders = Array.isArray(block.headers) ? block.headers : [];
  const rawRows = (Array.isArray(block.rows) ? block.rows : []).map((r) => (Array.isArray(r) ? r : (r == null ? [] : [r])));
  const w = o.width || 38;

  let mode = block.format || block.style || o.tableFormat || 'auto';
  if (mode === 'table-listed') mode = 'listed';
  if (mode === 'table-spatial') mode = 'spatial';
  if (mode === 'spatial') mode = 'columnar';

  const colCount = Math.max(rawHeaders.length, ...rawRows.map((r) => r.length));
  if (!(colCount > 0)) return [];

  const has = (v) => !cellIsBlank(v);

  const headerCount = rawHeaders.length;
  const headerTrs = [];
  for (let ci = 0; ci < colCount; ci++) {
    const rawH = rawHeaders[ci];
    if (has(rawH)) {
      headerTrs.push(tcCell(o, rawH, ci, block.dittoMarks));
    } else {
      headerTrs.push({ s: '', src: [] });
    }
  }

  const rowTrs = [];
  rawRows.forEach((r, ri) => {
    const row = [];
    for (let ci = 0; ci < colCount; ci++) {
      const rawCell = r[ci];
      const unit = headerCount + ri * colCount + ci;
      if (has(rawCell)) {
        row.push(tcCell(o, rawCell, unit, block.dittoMarks));
      } else {
        row.push({ s: '', src: [] });
      }
    }
    rowTrs.push(row);
  });

  const headers = headerTrs.map((h) => h.s);
  // TBL-NUM-1 / mirror computeTableColumns: marks are applied to rowTrs BEFORE the plain
  // `rows` strings below are derived, so every width/plan computation downstream (colWidths,
  // numPlans, fitColumnWidths...) sees exactly what formatTable's own `rows` sees.
  const numericPassageOk = numericPassageEligible(block, rawRows, colCount, o.mode === 'bana');
  if (numericPassageOk) applyNumericPassageMarksTraced(rowTrs, colCount);
  // TBL-NUM-1 — mirror formatTable's matching check.
  if (block.numericPassage && !numericPassageOk) {
    pushWarning(o, 'table-fallback', 'Numeric passage indicator requested but the table is not eligible (not all-numeric, or combined with a two-tier header/secondary row heading/subdivision heading) — set with plain numeral translation instead', { requestedMode: 'numericPassage' });
  }
  const rows = rowTrs.map((r) => r.map((c) => c.s));

  // mirror formatTable: numeric plans widen a column to its place-value-aligned width,
  // only where place-value alignment applies at all (K3: numericAlignApplies). A
  // numeric-passage column skips this (see computeTableColumns' matching comment).
  const colAlign = Array.isArray(block.columnAlign) ? block.columnAlign : [];
  const printAlign = Array.isArray(block.printAlign) ? block.printAlign : [];
  const numPlans = numericPassageOk ? Array(colCount).fill(null) : Array.from({ length: colCount }, (_, c) => {
    const rawCol = rawRows.map((r) => cellPlainText(r[c]));
    return numericAlignApplies(colAlign[c], printAlign[c]) ? numericColumnPlan(rawCol, rows.map((r) => r[c])) : null;
  });
  const colWidths = Array(colCount).fill(1);
  for (let c = 0; c < colCount; c++) {
    if (headers[c]) colWidths[c] = Math.max(colWidths[c], headers[c].length);
    for (const r of rows) {
      if (r[c]) colWidths[c] = Math.max(colWidths[c], r[c].length);
    }
    if (numPlans[c]) colWidths[c] = Math.max(colWidths[c], numPlans[c].width);
  }
  // mirror computeTableColumns: BANA 11.5.1b row subheadings (block.rowSubheadings) — translated once, widths.
  const rowSubTrs = new Map();
  for (const [r, text] of tableRowSubMap(block, rows.length)) rowSubTrs.set(r, tcDeco(o.translate(text).trim()));
  const subFrom = tableSubIndentFrom(rowSubTrs);
  for (const t of rowSubTrs.values()) colWidths[0] = Math.max(colWidths[0], t.s.length);
  rows.forEach((r, ri) => { if (ri >= subFrom && r[0]) colWidths[0] = Math.max(colWidths[0], r[0].length + 2); });
  const totalRowSet = tableTotalRowSet(block, rows.length);      // mirror formatColumnar (BANA 11.6.2b)

  // mirror computeTableColumns: BANA §11.4.3's complex (two-tier) header, F-12 — the
  // group's own text is translated once here (unit -1-groupIndex: a group's primary
  // heading has no single flat-headers cell of its own to trace, matching the
  // existing convention for a table's title/heading, traceTableTitleLines above).
  const rawHeaderGroups = Array.isArray(block.headerGroups) ? block.headerGroups : [];
  const groupTrRuns = rawHeaderGroups.map((g, gi) => tcRun(o, String((g && g.text) ?? ''), null, -1 - gi, 0));
  const headerGroups = rawHeaderGroups
    .map((g, gi) => ({ text: groupTrRuns[gi].s, tr: groupTrRuns[gi], from: Math.max(0, Math.trunc(Number(g && g.from))), to: Math.min(colCount - 1, Math.trunc(Number(g && g.to))) }))
    .filter((g) => Number.isFinite(g.from) && Number.isFinite(g.to) && g.to >= g.from && g.text);

  const gutter = 2;
  // mirror computeTableColumns: BANA 11.4.3a overhang (Change 2) — see that function's
  // own comment for the rule and the two-branch (overhang / wrap) reasoning.
  const overhangWidths = Array(colCount).fill(0);
  for (const g of headerGroups) {
    const spanWidth = colWidths.slice(g.from, g.to + 1).reduce((a, b) => a + b, 0) + gutter * (g.to - g.from);
    if (g.text.length <= spanWidth) continue;
    const overhangExtra = g.text.length - spanWidth;
    const currentTotal = colWidths.reduce((a, b) => a + b, 0) + gutter * (colCount - 1) + overhangWidths.reduce((a, b) => a + b, 0);
    if (currentTotal + overhangExtra <= w) {
      overhangWidths[g.to] += overhangExtra;
      g.overhang = true;
    } else {
      const need = widestWord(g.text) - spanWidth;
      if (need > 0) colWidths[g.to] += need;
    }
  }
  const totalSpatialWidth = colWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter + overhangWidths.reduce((a, b) => a + b, 0);

  const title = block.title;                      // mirror formatTable: never block.caption (F-4)
  const traceTitle = () => traceTableTitleLines(title, o, w);
  const traceTn = (text, unit) => {                         // @.< text @.> with the text traced
    const openDeco = tcDeco(TN_OPEN), closeDeco = tcDeco(TN_CLOSE);
    const run = unit == null ? tcDeco(o.translate(text).trim()) : tcRun(o, text.trim(), null, unit, 0);
    return { s: openDeco.s + run.s + closeDeco.s, src: [...openDeco.src, ...run.src, ...closeDeco.src] };
  };

  // mirror formatParagraphForm (B004 §12 paragraph form; F-19's 4-1 margin)
  const traceParagraphForm = () => {
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);
    if (block.tabletn || block.note) out.push(...tcWrap(o, traceTn(block.tabletn || block.note, 0), w, 3, 0));
    const names = Array.from({ length: colCount }, (_, ci) => (has(rawHeaders[ci]) ? cellPlainText(rawHeaders[ci]).trim() : `Column ${ci + 1}`));
    out.push(...tcWrap(o, traceTn(paragraphFormTn(names), null), w, 3, 0));
    // The row is translated as one print string (as formatParagraphForm does for a plain
    // row); each cell's character range maps to its unit, the separators to null.
    const deco = (text) => ({ segs: [{ type: 'text', text }], unit: null });
    rawRows.forEach((rawRow, ri) => {
      const parts = [];
      for (let ci = 0; ci < colCount; ci++) {
        if (ci) parts.push(deco('; '));
        if (has(rawRow[ci])) parts.push({ segs: trimSegs(cellSegments(rawRow[ci])), unit: headerCount + ri * colCount + ci });
        else parts.push(deco('–'));
      }
      if (!rowEndsWithStop(rawRow, colCount, has)) parts.push(deco('.'));   // mirror formatParagraphForm (A62)
      out.push(...tcWrap(o, tcJoined(o, parts), w, 3, 0));
    });
    out.push(tcBlank);
    return out;
  };
  const traceFallback = () => {
    if (tableLayoutWasChosen(block, o)) {                    // A72 stage 3: the only source of this warning now -- formatTable's own copy is gone (both fallback targets, 'listed'/'paragraph', are tableModeProjection)
      const resolvedLayout = o.mode === 'bana' ? 'listed' : 'paragraph';
      const requested = requestedTableMode(block, o);
      pushWarning(o, 'table-fallback', `Table could not be set as ${requested} and was laid out as ${resolvedLayout === 'listed' ? 'a Listed table' : 'paragraph form'} instead`, { requestedMode: requested, resolvedLayout });
    }
    return o.mode === 'bana' ? traceListed() : traceParagraphForm();
  };

  const traceListed = () => {                               // mirror formatListed (§11.16)
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);

    const noHeadings = !rawHeaders.some(has);
    const paras = listedTnParagraphs(block, rawRows, colCount, has, noHeadings);
    paras.forEach((p, i) => {
      const text = (i === 0 ? TN_OPEN : '') + o.translate(p).trim() + (i === paras.length - 1 ? TN_CLOSE : '');
      out.push(...tcWrap(o, tcDeco(text), w, 6, 4));
    });
    const leadEnd = out.length - 1;                          // mirror formatListed: the title and note kept with the first row

    const sep = (text) => ({ segs: [{ type: 'text', text }], unit: null });
    // Bug 2 / mirror formatListed's own noHeadings comment above: BANA 11.16.1 has no rule
    // for a table with no column headings at all, so no "Col n:"/"Row n" label is invented
    // when every header cell is blank.
    const keepGroups = [];                                   // mirror formatListed: §11.16j, each row on one braille page, the first with the title and note
    rawRows.forEach((rawRow, ri) => {
      out.push(tcBlank);
      const rowStart = out.length;
      const unit0 = headerCount + ri * colCount;
      const label = has(rawRow[0]) ? { segs: trimSegs(cellSegments(rawRow[0])), unit: unit0 } : (noHeadings ? sep('') : sep(`Row ${ri + 1}`));
      // mirror joinListedHead: the colon takes an emphasised heading's typeform (UEB 9.7.3); it has no print source
      const colonPart = (hp) => { const c = listedColonSeg(hp.segs); return c ? [hp, { segs: [c], unit: null }] : [hp, sep(':')]; };
      const h0 = { segs: trimSegs(cellSegments(rawHeaders[0])), unit: 0 };
      const heading = has(rawHeaders[0]) ? [...colonPart(h0), sep(' '), label] : [label];
      out.push(...tcWrap(o, tcRstrip(tcJoined(o, heading)), w, 4, 4));
      for (let ci = 1; ci < colCount; ci++) {
        const hPart = has(rawHeaders[ci]) ? { segs: trimSegs(cellSegments(rawHeaders[ci])), unit: ci } : (noHeadings ? null : sep(`Col ${ci + 1}`));
        const unit = headerCount + ri * colCount + ci;
        // BANA 11.16.1g (KD, 28 Sep 2026): mirror formatListed — a cell with more than one
        // entry ('\n'-separated) puts the heading alone at 1-5 and each entry at 3-5.
        const entrySegs = has(rawRow[ci]) ? splitCellEntries(cellSegments(rawRow[ci])).map(trimSegs).filter((e) => e.length) : [];
        if (entrySegs.length > 1) {
          if (hPart) out.push(...tcWrap(o, tcJoined(o, colonPart(hPart)), w, 0, 4));
          entrySegs.forEach((e) => out.push(...tcWrap(o, tcJoined(o, [{ segs: e, unit }]), w, 2, 4)));
          continue;
        }
        let line;
        if (entrySegs.length) {
          line = hPart ? tcJoined(o, [...colonPart(hPart), sep(' '), { segs: entrySegs[0], unit }]) : tcJoined(o, [{ segs: entrySegs[0], unit }]);
        } else if (hPart) {
          const head = tcJoined(o, colonPart(hPart));
          const dots = tcDeco(` ${LISTED_BLANK}`);
          line = { s: head.s + dots.s, src: [...head.src, ...dots.src] };
        } else {
          line = tcDeco(LISTED_BLANK);
        }
        out.push(...tcWrap(o, line, w, 0, 2));
      }
      keepGroups.push(ri === 0 && leadEnd >= 1 ? [1, out.length - 1, 'L'] : [rowStart, out.length - 1]);
    });
    out.push(tcBlank);
    Object.defineProperty(out, 'keepGroups', { value: keepGroups });   // non-enumerable: lines still compare as plain arrays
    return out;
  };

  // Traced mirror of renderVerticalSection (BANA §11.14 Wide Tables: Vertical Division,
  // T4): the same header/separator (blank under a column without a heading, 11.4.2c) and
  // data-row rendering, unit-tracked, restricted to one section's own columns (column 0,
  // the row heading, first).
  const traceVerticalSection = (headerTrsSub, rowTrsSub, widths, numPlansSub) => {
    const colCountSub = widths.length;
    const headerStrs = headerTrsSub.map((h) => h.s);
    const out = [];
    // F-2/BANA §11.5.4 vs §11.9.1.b — mirror renderVerticalSection: blank-row-as-blank-
    // line only applies when some OTHER row has real content (else it's a skeleton table).
    const anyRowHasContent = rowTrsSub.some((row) => row.some((cTr) => cTr.s !== ''));
    const traceRow = (cellTrList, ri) => {
      const isData = ri != null;
      if (isData && anyRowHasContent && cellTrList.every((cTr) => cTr.s === '')) return [tcBlank];
      const wrappedCells = cellTrList.map((cTr, ci) => wrapCellsSrc(cTr.s, cTr.src, widths[ci], 0, isData ? 2 : 0));
      const maxLines = Math.max(1, ...wrappedCells.map((wc) => wc.lines.length));
      const rowOut = [];
      for (let li = 0; li < maxLines; li++) {
        let lineStr = '';
        const lineSrc = [];
        for (let ci = 0; ci < colCountSub; ci++) {
          const wc = wrappedCells[ci];
          const cellLine = wc.lines[li] || '';
          const cellSrc = wc.srcs[li] || [];
          const targetW = widths[ci];
          let lead = 0;
          if (isData) {
            const f = tableCellFill(cellLine, targetW, { firstLine: li === 0, lastCol: ci === colCountSub - 1, numPad: numPlansSub[ci] ? numPlansSub[ci].pads[ri] : -1, implied: ci === 0 && impliedRowHeading(cellTrList.map((x) => x.s), rowTrsSub.map((r) => r.map((x) => x.s))), noFill: block.guideDots === false, lead: tableGuideLead(o) });
            lineStr += f.pre + cellLine + f.post;
            for (let k = 0; k < f.pre.length; k++) lineSrc.push(null);
            lineSrc.push(...cellSrc);
            for (let k = 0; k < f.post.length; k++) lineSrc.push(null);
            lead = f.lead;
          } else {
            lineStr += cellLine.padEnd(targetW, ' ');
            lineSrc.push(...cellSrc);
            for (let k = cellLine.length; k < targetW; k++) lineSrc.push(null);
          }
          if (ci < colCountSub - 1) {
            lineStr += gapText(lead, gutter);                  // two cells (11.2.5b, K33) — mirror renderVerticalSection
            for (let k = 0; k < gutter; k++) lineSrc.push(null);
          }
        }
        rowOut.push({ s: lineStr.slice(0, w), src: lineSrc.slice(0, w) });
      }
      return rowOut;
    };
    if (headerStrs.some((h) => h.trim())) {
      out.push(...traceRow(headerTrsSub, null));
      const sepCols = widths.map((cw, ci) => (headerStrs[ci].trim() ? (TABLE_GUIDE + '3'.repeat(Math.max(0, cw - 1))) : ' '.repeat(cw)));
      out.push(tcDeco(joinTableRow(sepCols, gutter).slice(0, w)));
    }
    const headLines = out.length;                            // mirror renderVerticalSection's headKeep (BANA 11.2.6d)
    const rowStarts = [];
    rowTrsSub.forEach((r, ri) => {
      if (ri === 1 && headLines) Object.defineProperty(out, 'headKeep', { value: out.length - 1 });
      rowStarts.push(out.length);
      out.push(...traceRow(r, ri));
    });
    if (headLines && rowTrsSub.length === 1) Object.defineProperty(out, 'headKeep', { value: out.length - 1 });
    Object.defineProperty(out, 'rowStarts', { value: rowStarts });
    Object.defineProperty(out, 'headLines', { value: headLines });
    return out;
  };
  const traceVertical = (sections) => {
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);
    if (block.tabletn || block.note) {
      const tnText = block.tabletn || block.note;
      const openDeco = tcDeco(TN_OPEN);
      const closeDeco = tcDeco(TN_CLOSE);
      const tnRun = tcRun(o, tnText.trim(), null, 0, 0);
      out.push(...tcWrap(o, { s: openDeco.s + tnRun.s + closeDeco.s, src: [...openDeco.src, ...tnRun.src, ...closeDeco.src] }, w, 6, 4), tcBlank);
    }
    out.push(...tcWrap(o, tcDeco(TN_OPEN + o.translate(verticalDivisionTn(sections.length)).trim() + TN_CLOSE), w, 6, 4), tcBlank);
    const keepGroups = [[1, out.length - 2, 'W']];           // mirror formatVertical (BANA 11.2.6d; the notes kept with the first section)
    sections.forEach((cols, si) => {
      const allCols = [0, ...cols];
      const sec = traceVerticalSection(
        allCols.map((ci) => headerTrs[ci]),
        rowTrs.map((r) => allCols.map((ci) => r[ci])),
        allCols.map((ci) => colWidths[ci]),
        allCols.map((ci) => numPlans[ci]),
      );
      keepGroups.push(...verticalSectionGroups(sec, out.length, si, tableRepeatOn(block, o)));
      out.push(...sec);
      if (si < sections.length - 1) out.push(tcBlank);
    });
    out.push(tcBlank);
    if ((isBanaOpts(o) || tableRepeatOn(block, o)) && keepGroups.length) Object.defineProperty(out, 'keepGroups', { value: keepGroups });
    return out;
  };

  // Traced mirror of formatStairstep (BANA §11.18, T4) — see that function's rule text.
  const traceStairstep = (plan) => {
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);
    const hasBlank = rows.some((r, ri) => !plan.sub.has(ri) && r.some((cell) => cell === ''));
    bodyTnParagraphs(block, hasBlank, STAIRSTEP_BLANK_TN, STAIRSTEP_TN).forEach((p, i) => out.push(...tcWrap(o, tcDeco((i === 0 ? TN_OPEN : '') + o.translate(p).trim()), w, 6, 4)));
    out.push(tcBlank);
    const key = [];
    if (plan.sub.size) key.push({ tr: tcDeco(o.translate(plan.subHeading).trim()), indent: 4 });
    for (let ci = 0; ci < colCount; ci++) key.push({ tr: headerTrs[ci], indent: 2 * ci });
    key.forEach((k, i) => {
      const close = i === key.length - 1 ? tcDeco(TN_CLOSE) : tcBlank;
      out.push(...tcWrap(o, { s: k.tr.s + close.s, src: [...k.tr.src, ...close.src] }, w, k.indent, k.indent));
    });
    out.push(tcBlank);
    const keepGroups = [];
    let groupStart = null;
    rowTrs.forEach((row, ri) => {
      if (plan.sub.has(ri)) {
        if (row[0].s === '') return;
        if (out[out.length - 1].s !== '') out.push(tcBlank);
        groupStart = out.length;
        out.push(...tcWrap(o, row[0], w, 4, 4));
        return;
      }
      const rowStart = groupStart != null ? groupStart : out.length;
      groupStart = null;
      for (let ci = 0; ci < colCount; ci++) {
        const m = 2 * ci;
        const entry = row[ci].s === '' ? tcDeco(LISTED_BLANK) : row[ci];
        tcSplitParagraphs(entry).forEach((para, pi) => out.push(...tcWrap(o, para, w, pi === 0 ? m : m + 2, m)));
      }
      keepGroups.push([rowStart, out.length - 1]);
    });
    out.push(tcBlank);
    Object.defineProperty(out, 'keepGroups', { value: keepGroups });
    return out;
  };
  // Traced mirror of formatLinear (BANA §11.17, T4).
  const traceLinear = () => {
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);
    const hasBlank = rows.some((r) => r.some((cell) => cell === ''));
    bodyTnParagraphs(block, hasBlank, LINEAR_BLANK_TN, LINEAR_TN).forEach((p, i) => out.push(...tcWrap(o, tcDeco((i === 0 ? TN_OPEN : '') + o.translate(p).trim()), w, 6, 4)));
    out.push(tcBlank);
    const piece = (rawCell, ci, unit) => {
      const punct = linearPunct(ci, colCount);
      if (!has(rawCell)) return tcDeco(LISTED_BLANK + (LINEAR_PUNCT_BRL[punct] || ''));
      const parts = [{ segs: trimSegs(cellSegments(rawCell)), unit }];
      if (punct) parts.push({ segs: [{ type: 'text', text: punct }], unit: null });
      return tcJoined(o, parts);
    };
    const joinPieces = (pieces) => {
      let s = '', src = [];
      pieces.forEach((pc, i) => { if (i) { s += ' '; src.push(null); } s += pc.s; src.push(...pc.src); });
      return { s, src };
    };
    const order = joinPieces(Array.from({ length: colCount }, (_, ci) => piece(rawHeaders[ci], ci, ci)));
    const close = tcDeco(TN_CLOSE);
    out.push(...tcWrap(o, { s: order.s + close.s, src: [...order.src, ...close.src] }, w, 0, 2));
    out.push(tcBlank);
    const keepGroups = [];
    rawRows.forEach((rawRow, ri) => {
      const rowStart = out.length;
      out.push(...tcWrap(o, joinPieces(Array.from({ length: colCount }, (_, ci) => piece(rawRow[ci], ci, headerCount + ri * colCount + ci))), w, 0, 2));
      keepGroups.push([rowStart, out.length - 1]);
    });
    out.push(tcBlank);
    Object.defineProperty(out, 'keepGroups', { value: keepGroups });
    return out;
  };

  const traceColumnar = () => {
    // TBL-NUM-1 / BANA §11.7.1l — mirror resolveTableLayout's tryColumnar: try the 1-cell
    // gutter only once the standard 2 cells does not fit, and only for a numericPassageOk
    // table. `g` shadows the outer `gutter` for the rest of this renderer only.
    let g = gutter;
    let actualWidths = fitColumnWidths(colWidths, w, g, columnMinWidths(headers, rows, colCount));
    if (!actualWidths && numericPassageOk) {
      g = 1;
      actualWidths = fitColumnWidths(colWidths, w, g, columnMinWidths(headers, rows, colCount));
    }
    if (!actualWidths) return traceFallback();
    const plans = numPlans.map((p, c) => (p && actualWidths[c] >= p.width ? p : null));

    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);

    const columnarParas = columnarTnParagraphs(block, rawRows, colCount, has);   // mirror formatColumnar (F-20)
    const keyLines = tcTableKeyNoteLines(block, o, w, columnarParas);   // K8 — mirror formatColumnar
    if (keyLines.length) {
      out.push(...keyLines, tcBlank);
    } else if (columnarParas.length) {
      columnarParas.forEach((tnText, i) => {
        const openDeco = tcDeco(i === 0 ? TN_OPEN : '');
        const closeDeco = tcDeco(i === columnarParas.length - 1 ? TN_CLOSE : '');
        const tnRun = tcRun(o, tnText.trim(), null, 0, 0);
        const tnFull = {
          s: openDeco.s + tnRun.s + closeDeco.s,
          src: [...openDeco.src, ...tnRun.src, ...closeDeco.src]
        };
        out.push(...tcWrap(o, tnFull, w, 6, 4));
      });
      out.push(tcBlank);
    }
    // TBL-NUM-1 — mirror formatColumnar's matching note.
    if (numericPassageOk) out.push(...tcNumericPassageNoteLines(o, w), tcBlank);

    // F-2/BANA §11.5.4 vs §11.9.1.b — mirror formatColumnar: blank-row-as-blank-line only
    // applies when some OTHER row has real content (else it's a skeleton table, §11.9.1.b,
    // which keeps guide dots on every row — gold-verified against Sample 11-17).
    const anyRowHasContent = rowTrs.some((row) => row.some((cTr) => cTr.s !== ''));
    // ri == null: a heading row (runover 0, space-padded); else a data row (runover 2,
    // guide dots / place-value padding via tableCellFill) — mirror formatColumnar.
    const formatTracedRow = (cellTrList, ri = null) => {
      const isData = ri != null;
      if (isData && anyRowHasContent && cellTrList.every((cTr) => cTr.s === '')) return { lines: [tcBlank], maxLines: 1 };
      const secondary = isData && ri >= subFrom;               // BANA 11.5.1b: a secondary row heading takes 3-5 margins
      const wrappedCells = cellTrList.map((cTr, ci) => (ci === 0 && secondary ? wrapCellsSrc(cTr.s, cTr.src, actualWidths[0], 2, 4) : wrapCellsSrc(cTr.s, cTr.src, actualWidths[ci], 0, isData ? 2 : 0)));
      // A9/BANA §11.6.1b ("Begin all column entries on the line on which the row heading
      // ends.") / §11.5.2a — mirror formatColumnar: on a DATA row, column 0 is the row
      // heading (§11.5.1) and is never shifted; every other column's entry is held back
      // until the row heading's own LAST line (offset), not zipped in lockstep with it by
      // line index (the header row, isData false, is unaffected — unchanged below).
      const headingLines = isData ? wrappedCells[0].lines.length : 0;
      const offset = isData && colCount > 1 ? Math.max(0, headingLines - 1) : 0;
      const maxLines = isData
        ? Math.max(1, headingLines, ...wrappedCells.map((wc, ci) => (ci === 0 ? 0 : offset + wc.lines.length)))
        : Math.max(1, ...wrappedCells.map((wc) => wc.lines.length));
      const rowOut = [];
      let spans = null;                                          // column [start,end) of the first line (BANA 11.6.2b rule)

      for (let li = 0; li < maxLines; li++) {
        let lineStr = '';
        const lineSrc = [];
        const lineSpans = [];
        for (let ci = 0; ci < colCount; ci++) {
          const wc = wrappedCells[ci];
          const srcLi = isData && ci !== 0 ? li - offset : li;
          const targetW = actualWidths[ci];
          const spanStart = lineStr.length;

          if (isData && srcLi < 0) {
            // The row heading is still running over; this column's entry has not begun
            // yet (§11.6.1b) — plain blank, never guide-dotted (mirror formatColumnar:
            // that would misread as a deliberately blank §11.6.4 entry, which this is not).
            lineStr += ' '.repeat(targetW);
            for (let k = 0; k < targetW; k++) lineSrc.push(null);
            if (ci < colCount - 1) {
              lineStr += ' '.repeat(g);
              for (let k = 0; k < g; k++) lineSrc.push(null);
            }
            continue;
          }

          const cellLine = (wc.lines[srcLi] || '');
          const cellSrc = (wc.srcs[srcLi] || []);

          let lead = 0;
          if (isData) {
            const f = tableCellFill(cellLine, targetW, { firstLine: srcLi === 0, lastCol: ci === colCount - 1, numPad: plans[ci] ? plans[ci].pads[ri] : -1, implied: ci === 0 && impliedRowHeading(cellTrList.map((x) => x.s), rowTrs.map((r) => r.map((x) => x.s))), noFill: block.guideDots === false, lead: tableGuideLead(o) });
            lineStr += f.pre + cellLine + f.post;
            for (let k = 0; k < f.pre.length; k++) lineSrc.push(null);
            lineSrc.push(...cellSrc);
            for (let k = 0; k < f.post.length; k++) lineSrc.push(null);
            lead = f.lead;                                         // mirror formatColumnar
          } else {
            lineStr += cellLine.padEnd(targetW, ' ');
            lineSrc.push(...cellSrc);
            for (let k = cellLine.length; k < targetW; k++) lineSrc.push(null);
          }
          lineSpans.push([spanStart, lineStr.length]);

          // BANA §11.4.3a overhang (Change 2) — mirror formatColumnar's padOverhang: a
          // no-op except on the specific column a group's heading overhangs past
          // (overhangWidths is all zero for a table with no headerGroups).
          if (overhangWidths[ci]) {
            lineStr += ' '.repeat(overhangWidths[ci]);
            for (let k = 0; k < overhangWidths[ci]; k++) lineSrc.push(null);
            lead = 0;
          }

          if (ci < colCount - 1) {
            lineStr += gapText(lead, g);                   // two cells (11.2.5b, K33) unless narrowed (TBL-NUM-1)
            for (let k = 0; k < g; k++) lineSrc.push(null);
          }
        }
        if (li === 0) spans = lineSpans;
        rowOut.push({
          s: lineStr.slice(0, w),
          src: lineSrc.slice(0, w)
        });
      }
      return { lines: rowOut, maxLines, spans };
    };

    const headStart = out.length;                            // F-13 — mirror formatColumnar
    if (headerGroups.length) {
      out.push(...traceGroupedHeaderRows(headerTrs, headerGroups, actualWidths, g, w, overhangWidths, o));
    } else if (headers.some((h) => h.trim())) {
      const hdrFormatted = formatTracedRow(headerTrs);
      out.push(...hdrFormatted.lines);

      // F-8/BANA §11.4.2c: per-column, mirroring formatColumnar.
      // Task 2, 26 Sep 2026: BANA-only (isBanaOpts) — see formatTable's matching comment.
      if (isBanaOpts(o)) out.push(tcDeco(tableSeparator(actualWidths, g, headers.map((h) => !!h.trim())).slice(0, w)));   // §11.4.2b "3333
    }
    const headEnd = out.length - 1;
    const rowStarts = [];

    const rowFormatted = rowTrs.map((r, ri) => formatTracedRow(r, ri));

    rowFormatted.forEach((rf, ri) => {
      rowStarts.push(out.length);
      // mirror formatColumnar: BANA 11.5.1b primary row heading, BANA 11.6.2b retained line above a total row.
      if (rowSubTrs.has(ri)) out.push(...tcWrap(o, rowSubTrs.get(ri), actualWidths[0], 0, 4));
      if (totalRowSet.has(ri) && rf.spans && rf.lines.length && rf.lines[0].s !== '') {
        const rule = retainedRuleLine(rf.lines[0].s, rf.spans, totalRuleCols(rawRows[ri], colCount));
        if (rule) out.push(tcDeco(rule));
      }
      out.push(...rf.lines);
    });

    if (tableRepeatOn(block, o) && rowStarts.length) Object.defineProperty(out, 'keepGroups', { value: tableRowGroups(headEnd >= headStart ? headStart : -1, headEnd, rowStarts, out.length - 1) });   // F-13 — mirror formatColumnar
    out.push(tcBlank);
    return out;
  };

  if (mode === 'listed') return traceListed();
  if (mode === 'paragraph' || mode === 'table-paragraph') return traceParagraphForm();
  // T4 — mirror resolveTableLayout: an explicit 'vertical' format divides the table's
  // data columns into sections (BANA §11.14); a two-tier header (headerGroups, F-12) is
  // out of scope (same reasoning as resolveTableLayout's tryVertical) and falls back.
  if (mode === 'vertical') {
    const sections = headerGroups.length ? null : computeVerticalSections(colWidths, gutter, w, colCount);
    return sections ? traceVertical(sections) : traceFallback();
  }
  // T4 — mirror resolveTableLayout: BANA §11.18 Stairstep / §11.17 Linear, selectable only.
  if (mode === 'stairstep') {
    const plan = stairstepPlan(o.mode === 'bana', block.subdivisionRows, block.subdivisionHeading, rawHeaders, rawRows, colCount, has, headerGroups);
    return plan ? traceStairstep(plan) : traceFallback();
  }
  if (mode === 'linear') return linearAllowed(o.mode === 'bana', rawHeaders, rawRows, colCount, has, headerGroups) ? traceLinear() : traceFallback();
  if (mode === 'columnar') return traceColumnar();
  // K15 — mirror resolveTableLayout / formatTable's formatFacing (the same renderFacingBody / assembleFacingTable).
  const fc = { colWidths, gutter, w, colCount, headers, rows, rawRows, numPlans, headerGroups, ...facingContext(block, o, w) };
  const facingPlan = mode === 'facing' || o.mode === 'bana' ? facingPlanFor(fc) : null;
  const traceFacing = () => {
    const body = renderFacingBody(headerTrs, rowTrs, colWidths, numPlans, facingPlan, gutter, w, facingGuideEnd(w), block.guideDots === false, tableGuideLead(o));
    return assembleFacingTable(block, o, w, columnarTnParagraphs(block, rawRows, colCount, has), traceTitle(), body, tcDeco);
  };
  if (mode === 'facing' && facingPlan) return traceFacing();
  // T9 — mirror resolveTableLayout: 'auto' always tries the squeeze first (never gated
  // on the unsqueezed natural width, as before this fix) and accepts columnar only when
  // it fits AND every entry, headers included, stays within two lines (BANA §11.6.1).
  // traceColumnar recomputes this identical fitColumnWidths call, so this pre-check
  // can never disagree with what it actually renders. TBL-NUM-1 / BANA §11.7.1l: mirror
  // resolveTableLayout's tryColumnar — try the 1-cell gutter too, once the standard 2
  // does not fit, for a numericPassageOk table (traceColumnar's own such attempt would
  // otherwise never be reached: this pre-check would reject the table before calling it).
  let autoWidths = fitColumnWidths(colWidths, w, gutter, columnMinWidths(headers, rows, colCount));
  if (!autoWidths && numericPassageOk) autoWidths = fitColumnWidths(colWidths, w, 1, columnMinWidths(headers, rows, colCount));
  if (autoWidths && fitsTwoLines(headers, rows, autoWidths)) return traceColumnar();
  // T4 — mirror resolveTableLayout: try vertical division before falling back to
  // Listed/paragraph, which stays the last resort.
  const sections = headerGroups.length ? null : computeVerticalSections(colWidths, gutter, w, colCount);
  // K15 — mirror resolveTableLayout: BANA 11.14.1, facing pages before a vertical division longer than a page.
  if (o.mode === 'bana' && facingPlan && facingAutoPreferred(fc, sections)) return traceFacing();
  if (sections) return traceVertical(sections);
  return traceFallback();
}

// Collapse a leading blank line at the very top (nothing to separate from).
function trimLeadingBlank(lines) {
  while (lines.length && lines[0] === '') lines.shift();
  return lines;
}

// Front matter vs body (BANA 2.1.1; F-148). A page belongs to one of three "matter" kinds, and
// the kind decides its braille page-number series (page.mjs PAGE_SERIES):
//   'transcriber' -> t1, t2 ...   the four BANA 2.2.1 pages (Title, Second Title, Special Symbols,
//                                 Transcriber's Notes), in that order, first in the volume
//   'front'       -> p1, p2 ...   print front matter proper (BANA 2.7.1b, 2.10.2f), after them
//   'body'        -> 1, 2 ...     the book text (assemble()); numbering is never touched here
// A block may carry `matter: 'transcriber' | 'front'`; absent means 'body'. NOT YET CONSUMED by
// the page builder: today only the generated pages (volumeTitlePage -> transcriber, buildToc ->
// front) are placed in a series. LATER STAGES PLUG IN here: the Transcriber's Notes / Title /
// Special Symbols block kinds set matter:'transcriber', and a stage that splits ordinary blocks
// into front matter uses matter:'front'; the page builder then groups consecutive same-matter
// blocks, paginates each group and numbers it with transcriberPageNumberLine()/seriesPageNumber
// (the t series restarts at t1 in every volume, BANA 2.2.1c). Because that will change output it
// must then join getBlockSignature's cache key and the formatBlock/traceBlock parity.
const MATTER_SERIES = Object.freeze({ transcriber: 'transcriber', front: 'front', body: 'body' });
function blockMatter(block) {
  const m = block && typeof block === 'object' ? block.matter : null;
  return Object.prototype.hasOwnProperty.call(MATTER_SERIES, m) ? m : 'body';
}
function matterPageNumber(matter, n) {
  return seriesPageNumber(MATTER_SERIES[Object.prototype.hasOwnProperty.call(MATTER_SERIES, matter) ? matter : 'body'], n);
}

// A Table of Contents from the document's headings and their braille page
// numbers, as preliminary page(s) numbered with a 'p' prefix (a separate
// sequence, so the body still starts at braille page 1 — the braille convention
// that avoids the TOC-length-changes-body-numbers circularity). Entry indent by
// heading level; page number right-justified after guide dots (BANA) / a hyphen lead line (UKAAF).
function buildToc(headings, o) {
  if (!headings.length) return [];
  const w = o.width;
  // F-149 / BANA 2.10.3a ("Center the print contents heading (e.g., Table of Contents, What You Will Study)"): optional
  // `o.tocHeading` is the print's own wording (default: "Contents"). F-150 / 2.10.7b ("Any line without a page number ends at
  // least six cells before the right margin"): optional `o.tocRightBuffer` (BANA only) keeps the heading and every entry line
  // that carries no page number within width-6 (default: full width, as before).
  const buffer = o.tocRightBuffer && isBanaOpts(o) ? Math.min(6, Math.max(0, w - 12)) : 0;
  const tocTitle = typeof o.tocHeading === 'string' && o.tocHeading.trim() ? o.tocHeading.trim() : 'Contents';
  const lines = [...centredBlock(o.translate(tocTitle), w - buffer).map((l) => l.replace(/\s+$/, '')), ''];
  const maxLevel = headings.reduce((m, h) => Math.max(m, (h.level || 1) - 1), 0);
  for (const h of headings) {
    const num = brailleNumber(h.page);
    // Nested contents pattern (Formats §2.10.6b: runovers two cells right of the
    // deepest sub-level, e.g. 1-5, 3-5). Wrap a long entry so it never overflows
    // the page; put the page number right-justified on the last line, or on its
    // own line if it won't fit there.
    const { first: indent, runover } = nestedMargins('toc', (h.level || 1) - 1, maxLevel, o.mode);
    const wrapped = wrapCells(o.translate(h.text), w - buffer, indent, runover);
    const li = wrapped.length - 1;
    // Leaders: BANA guide dots with a blank cell either side (Formats §2.10.7a); UKAAF
    // lead lines of hyphens (B004 H). No room for two leader cells: spaces only.
    const leader = isBanaOpts(o) ? '"' : '-';
    const room = w - wrapped[li].length - num.length;
    if (room >= 4) {
      wrapped[li] += ' ' + leader.repeat(room - 2) + ' ' + num;
    } else if (room >= 2) {
      wrapped[li] += ' '.repeat(room) + num;
    } else {
      wrapped.push(rightJustify(num, w));
    }
    for (const l of wrapped) lines.push(l.replace(/\s+$/, ''));
  }
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  // BANA Formats §2.10.5: "Table of contents entries may not appear on line 1
  // or line 25, as these lines contain the print and braille page numbers", so
  // a contents page is a blank line 1, depth−2 entry lines, and the P-numbered
  // last line — exactly `depth` lines. (This used to take the depth−1 body
  // count and add both furniture lines, making a 26-line page.) UKAAF keeps its
  // depth−1 entries under the line-1 page information line.
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', isBana);
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) {
    // Front-matter series (BANA 2.7.1b "Precede braille page numbers by p"). BANA 2.10.2c says a
    // transcriber-*generated* contents "has a t page number", but calls it a judgement for informal
    // materials, so the default stays the p series; o.tocPageSeries === 'transcriber' opts in.
    const pnum = seriesPageNumber(o.tocPageSeries === 'transcriber' ? 'transcriber' : 'front', pages.length + 1);   // e.g. P#A
    const chunk = lines.slice(i, i + perPage);
    // Match the body's per-mode page-number placement: BANA on the last line
    // (bottom-right), UKAAF on the first line (top-right). (Was always top-right.)
    // With page furniture suppressed the prelim pages carry no number line either,
    // so a TOC page never exceeds the depth.
    if (hideHeader) {
      pages.push(chunk);
    } else if (isBana) {
      while (chunk.length < perPage) chunk.push('');
      pages.push(['', ...chunk, rightJustify(pnum, w)]);
    } else {
      pages.push([rightJustify(pnum, w), ...chunk]);
    }
  }
  return pages;
}

// Line-numbered text in the document (A30): the first block with a print line number and
// the widest number in braille.
function dropFirstLinenum(segs) { const i = segs.findIndex((g) => g && g.type === 'linenum' && String(g.text ?? '').trim()); return i < 0 ? segs : segs.filter((_, k) => k !== i); }
function lineNumberInfo(blocks, o) {
  let first = -1, width = 0;
  const scan = (segs, bi) => {
    for (const g of segs || []) {
      if (!g || g.type !== 'linenum' || !String(g.text ?? '').trim()) continue;
      if (first < 0) first = bi;
      width = Math.max(width, o.translate(String(g.text).trim()).trim().length);
    }
  };
  blocks.forEach((b, bi) => {
    if (!b || typeof b !== 'object') return;
    if (b.type === 'para' && !b.paraNumber) scan(b.segments, bi);   // F-205: an inline paragraph number is not line-numbered text
    if (b.type === 'list') for (const it of b.items || []) scan(it && it.segments, bi);
    if (b.type === 'play') scan(b.rhymeLetters && Array.isArray(b.segments) ? dropFirstLinenum(b.segments) : b.segments, bi);   // 15.7.3: the rhyme letter is not a line number        // F-181: a play-speaker/dialogue line's own linenum
  });
  return { first, width };
}

// F-234 / Sample 15-9: optional `lnNoteBeforeHeading` on the first line-numbered block puts the automatic
// note before the heading that directly precedes it (default: after the heading, as before). Returns that heading's index or -1.
function lnNoteHeadingIndex(blocks, first) {
  const b = first > 0 ? blocks[first] : null;
  if (!b || !b.lnNoteBeforeHeading || b.lnNoteOff) return -1;
  const h = blocks[first - 1];
  return h && h.type === 'heading' ? first - 1 : -1;
}

// getBlockSignature builds o.blockCache's per-block cache key from two parts (Fable review,
// docs/fable-review-26sep.md §2 / risk #3 — this replaced a ~90-line hand-picked field list: a new
// block field had to be added by hand every time, and misses happened — repeatHeadings, figureType,
// blocked and the page-turn flags (continued/continuation) were missed until 24 Sep 2026):
//
//   (a) blockOwnSignature(block) — a canonical, deterministic JSON serialisation of the WHOLE block
//       object. This covers every field.registry.mjs field automatically (tests/field_registry.test.mjs
//       and tests/block_signature_cache.test.mjs both check this), plus every core/structural field
//       (type, text, segments, items, blocks/headers/rows, title, level, marker, style, subtype,
//       format, latex, mathml, ...) that field-registry.mjs does not track because it is never
//       "optional". It also covers, for free, the per-instance values buildDocPages computes and
//       merges onto a block's own copy (`fb = { ...fb, someField }`) BEFORE calling
//       getBlockSignature(fb, o, atStart) — they are genuinely the object's own enumerable
//       properties by the time this function sees it: A23 attribCell (BANA 9.4.1b, the previous
//       braille line's own indent), K1/K4 tfRun/structTf (emphasisContext, a passage's emphasis
//       depending on its neighbours), K15 _facingPerPage (a top-level table's facing-page length),
//       and the interchanged-table note _interchangeTn. A new such field can never be missed again:
//       there is nothing left to hand-pick. The one field deliberately dropped is `_key`, the
//       editor's own Lexical node-identity tag — grepping document.mjs for every `block._`/`fb._`/
//       `b._` property confirms it is read nowhere except the old version of this function, so
//       dropping it cannot change what a cache hit returns (Sep 2026 audit).
//   (b) blockContextKey(block, o, atStart) — everything genuinely read by formatBlock/traceBlock (and
//       everything they call — formatTable/traceTable, withListKeep, tcSegs, headingTierKey, ...)
//       that is NOT a property of the block: atStart, and the handful of o.* options found by an
//       exhaustive Sep 2026 audit (a Proxy over `o` logging every property read, run across the full
//       tests/nimas_samples + tests/real_samples + tests/fixtures/libreoffice + gold corpus in both
//       modes, cross-checked line by line against every o.* occurrence in this file to rule out
//       false positives from `{ ...o, x }` option-copies, which make a Proxy see every property of
//       `o` regardless of whether it is actually used). Two genuine misses turned up and are fixed
//       here, gated to the block types where they matter so an unrelated block's cache entry is not
//       pointlessly busted by them:
//         - o._boxDepth: facingContext (called from formatTable/traceTable) zeroes a table's own
//           facing-page plan when it is inside a box (K15 / BANA 11.14.1's facing-page rule applies
//           to a top-level table only) — read directly, not only via the already-keyed
//           block._facingPerPage.
//         - o.listPageRules: withListKeep (called from both formatBlock and traceBlock) sets or omits
//           a BANA list's keep-together `lines.keepGroups` side channel (F-35, BANA 8.3.5b-c)
//           depending on `o.listPageRules === false`; field-registry.mjs already marks it
//           affectsBraille:true (cache:'doc'), but it was never joined into the key.
//
// No WeakMap caches blockOwnSignature's own JSON by block-object identity: measured, and rejected as
// UNSAFE, not just unnecessary. It would only ever help if the SAME block object were reused,
// unmutated, across calls — but grepping web/editor/editor.mjs's buildModel()/nodeToBlocks shows the
// editor allocates a brand-new object literal for every block on every render, changed or not (no
// memoization), so a real edit gets a fresh object anyway and an identity cache would never hit for
// it. Worse: if any OTHER caller mutates a block's fields in place while reusing a warm o.blockCache
// (a reasonable pattern this file does not forbid — tests/block_signature_cache.test.mjs's A23
// regression test does exactly this), an identity-keyed cache would keep returning the pre-mutation
// JSON forever, since a WeakMap has no way to notice the object changed — precisely the class of
// stale-cache bug this whole redesign exists to remove. Plain JSON.stringify on one block is measured
// as fast enough on its own (see this review's report for the before/after timings) that no caching
// is needed here at all.
const BLOCK_SIG_DROP_FIELDS = new Set(['_key']);
function blockSigReplacer(k, v) {
  if (BLOCK_SIG_DROP_FIELDS.has(k)) return undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // Deterministic key order: JSON.stringify otherwise walks an object's OWN keys in insertion
    // order, and two logically identical blocks built by different code paths (import vs paste vs
    // undo) can insert the same fields in a different order — that would be a false cache MISS
    // (never a wrong hit), but it would defeat much of the point of caching. Sorting every object's
    // keys makes the serialisation depend only on field names and values, never on how the block was
    // built. (Arrays keep their own index order — order is semantic there: segments/items/rows.)
    const out = {};
    for (const kk of Object.keys(v).sort()) out[kk] = v[kk];
    return out;
  }
  return v;
}
function blockOwnSignature(block) {
  return JSON.stringify(block, blockSigReplacer);
}
function blockContextKey(block, o, atStart) {
  const type = block.type;
  const tocPagesKey = block.kind === 'toc' ? `${o.tocBrlPagesKey || ''}|${o._hasPrintPages ? 1 : 0}` : '';
  const boxColorKey = block.boxColor ? (o._boxColorsUniform ? '1' : '0') : '';
  const boxDepthKey = type === 'table' ? (o._boxDepth || 0) : '';                                  // K15 miss fix
  const listRulesKey = type === 'list' ? (o.listPageRules === false ? '0' : '1') : '';              // F-35 miss fix
  const nestedBulletsKey = type === 'list' ? (o.nestedBullets === true ? '1' : '0') : '';
  const endnoteHeadKey = block.endnoteHead ? (o._runningHead ? '1' : '0') : '';                    // IMP-W3: the heading's own line position
  // S5d (audit 15 Oct, "cached non-position formatter API"): the icon-symbol mapping is the document's, not the block's - an icon put
  // before a cached paragraph moves that paragraph's own icon to the next slot - so it is in EVERY block's key (a list's
  // showBullets stays list-only). Empty, so unchanged, for a document with no icon.
  const iconMapKey = o._iconSymbols && o._iconSymbols.size ? [...o._iconSymbols.values()].map((e) => `${e.codePoint}:${e.slot}`).join(',') : '';
  const showBulletsKey = endnoteHeadKey + (type === 'list' ? (o.showBullets === false ? '0' : '1') : '') + iconMapKey;   // UK-10; IMP-W7: a custom bullet's braille is the symbol slot its glyph holds
  const tableEndMarkerKey = type === 'table' ? (o.tableEndMarker === false ? '0' : '1') : '';        // UK-6
  return [
    atStart ? '1' : '0',
    o.width || 0,
    o.paragraphStyle ?? '',
    o.listStyle ?? '',
    o.mode ?? '',
    o.tableFormat ?? '',
    o.trace ? '1' : '0',
    headingTierKey(o),               // BANA heading tiers depend on the whole document
    tocPagesKey,
    o.lineIndicator ?? '',
    nestedBulletsKey,
    o.spacedEllipsis ? '1' : '0',
    o.typeformWordPunct ? '1' : '0',
    o.elisionApostrophe ? '1' : '0',
    o.foreignText ? '1' : '0',
    o._foreignLists ? '1' : '0',
    boxColorKey,
    o.lineNumberWidth || 0,
    boxDepthKey,
    listRulesKey,
    o.endMarkers ? '1' : '0',   // UK-1: formatHeading/traceBlockCore's L1 UKAAF branch reads it directly
    showBulletsKey,
    tableEndMarkerKey,
  ].join('|');
}
function getBlockSignature(block, o, atStart) {
  if (!block) return '';
  return `${blockOwnSignature(block)}|${blockContextKey(block, o, atStart)}`;
}

// Page-boundary rules (Rule Register R8: B004 §5 "must not appear on the bottom
// line" / Formats §4.3.9 & §1.15.2 "followed by at least one line of text"; and no blank line
// at the top of a page). Walks the content in page order: a blank that would open a
// page is dropped; a heading or print page number block (its indicator line, its wrapped lines and one
// following text line) that would not fit on the current page is pushed to the next
// page with blank filler. Blocks taller than a page are left alone. The three
// parallel arrays stay aligned (filler = block -1, no cells).
// BANA Formats §16.5.1: "Place notes at the end of the print page" — each footnote is
// rendered just before the first print page change after the block that references it (or
// at the end of the document), in reference order; a note with no reference in the document
// stays where it is. Endnotes (§16.9) and UKAAF (B004 D: notes may stay near their text) keep
// their place. `runStart` holds the footnotes that open a run of notes (separation line).
//
// F-108 (16.5.1c/g/h): notes queued for the end of the page live in `pending` until the
// next flush point; every OTHER block (including a note nobody ever references) used to be
// pushed straight into `order` the moment it was reached, ahead of whatever was still
// waiting in `pending` — silently reordering notes (16.5.1c: "list notes in the order in
// which they appear") and letting a note run get displaced past a later heading that starts
// a new titled section on the same print page (16.5.1g/h). Fix: an unreferenced note joins
// `pending` too, in its own place in the queue, instead of jumping the queue; and a heading
// is also a flush point (like a page-number block), so a note run can never land after it.
//
// F-109 (16.8.1a): "Place notes before tables… they need to be read before reading the
// table." A table whose own cell content carries a `noteref` matches the scan below just
// like an ordinary referencing paragraph, so its released note(s) would otherwise join
// `pending` and surface at the *next* page-end flush — i.e. after the table. Notes released
// by a table are tracked separately (`releasedByTable`) and spliced directly into `order`
// immediately before the table itself, never deferred.
// IMP-W3 (Paul, 30 Sep 2026; import fix list #25) / BANA Formats 16.9.2, 16.9.3, 16.10.1a: an ENDNOTE SECTION. Word, ODT, RTF and
// .doc endnotes sit in the block list right after the paragraph that cites them (kind 'endnote'); in braille they are collected
// at the end of the document - in a book of several volumes, at the end of the volume whose text cites them (16.9.2b; see
// formatVolumesFromBuild) - on a new braille page (16.9.3a), under the heading NOTES in transcriber's note indicators on line 1
// (16.9.3b), each note in 1-3 margins (16.9.3c) with no blank line between notes (Sample 16-11). UKAAF (B004 D: "Notes which
// appear at the end of the book may appear at the end of the relevant braille volume ... Write endnotes in list format, i.e.
// starting in cell 1 ..., and runovers in cell 3. An entry for a section of such notes is included in the table of contents for
// that braille volume") gets the same placement under an ordinary level-1 heading "Notes" (so the contents lists it), also on a
// new page. B004 says nothing about a new page; the same as BANA is used.
// "Follow print" (16.9.2a): an endnote section print itself places - endnotes straight after a heading that names them ("Notes",
// "Endnotes", "Footnotes" ...), as at the end of a chapter or book - stays where it is and is not given a second heading.
// Nothing is removed or renumbered: `planEndnoteSection` only returns the order (noteLayout puts the collected blocks last) and a
// synthesised heading block appended after the document's own blocks, so block indexes still match the editor's (trace.rows).
const isEndnoteBlock = (b) => !!b && typeof b === 'object' && b.type === 'footnote' && b.kind === 'endnote';
const ENDNOTE_HEADING_RE = /notes?\b|endnotes?/i;
function planEndnoteSection(blocks, o) {
  if (!Array.isArray(blocks) || !blocks.some(isEndnoteBlock)) return null;
  const isBana = isBanaOpts(o);
  // A section the sub-build of one volume's notes hands in already made (formatVolumesFromBuild): its own heading leads it.
  const preHead = blocks.findIndex((b) => b && typeof b === 'object' && b.endnoteHead);
  if (preHead >= 0) return { blocks, headIdx: preHead, moved: blocks.map((b, bi) => (isEndnoteBlock(b) ? bi : -1)).filter((bi) => bi >= 0), built: true };
  const headingText = (h) => String(h.text ?? (Array.isArray(h.segments) ? h.segments.map((g) => (g && g.text) || '').join('') : '') ?? '');
  const hasNoteref = (h) => Array.isArray(h.segments) && h.segments.some((g) => g && g.type === 'noteref');
  const inPrintSection = (bi) => {
    let j = bi - 1;
    while (j >= 0 && (isEndnoteBlock(blocks[j]) || (blocks[j] && blocks[j].type === 'pagenum'))) j--;
    const h = j >= 0 ? blocks[j] : null;
    return !!h && h.type === 'heading' && ENDNOTE_HEADING_RE.test(headingText(h)) && !hasNoteref(h);
  };
  const moved = [];
  blocks.forEach((b, bi) => { if (isEndnoteBlock(b) && !inPrintSection(bi)) moved.push(bi); });
  if (!moved.length) return null;
  const head = isBana
    ? { type: 'note', text: 'NOTES', endnoteHead: true, pageBreakBefore: true }
    : { type: 'heading', level: 1, text: 'Notes', endnoteHead: true, pageBreakBefore: true };
  return { blocks: [...blocks, head], headIdx: blocks.length, moved };
}
function noteLayout(blocks, isBana, en) {
  const n = blocks.length;
  const isNote = (b) => !!b && typeof b === 'object' && b.type === 'footnote' && b.kind !== 'endnote';
  const isNoteCont = (b) => isNote(b) && b.noteCont === true;      // #57c: a further paragraph of the note before it (the editor's one block per paragraph)
  const collected = en ? new Set(en.moved) : null;           // IMP-W3: endnotes that go to the end-of-book section
  const releasedBy = new Map();                              // referencing bi -> [note bi], deferred to page end
  const releasedByTable = new Map();                         // table bi -> [note bi], placed right before the table
  const moved = new Set();
  if (isBana) {
    const noteAt = new Map();
    blocks.forEach((b, bi) => { if (isNote(b) && b.id && !b.noteCont && !noteAt.has(b.id)) noteAt.set(b.id, bi); });
    if (noteAt.size) {
      blocks.forEach((b, bi) => {
        if (!b || typeof b !== 'object' || isNote(b)) return;
        const json = JSON.stringify(b);
        if (!json.includes('"noteref"')) return;
        for (const m of json.matchAll(/"idref":"((?:[^"\\]|\\.)*)"/g)) {
          const nb = noteAt.get(JSON.parse(`"${m[1]}"`));
          if (nb == null || moved.has(nb)) continue;
          // #57c: the paragraphs after a note's first (`noteCont`) go with it.
          const group = [nb];
          for (let j = nb + 1; j < n && isNoteCont(blocks[j]); j++) group.push(j);
          group.forEach((g) => moved.add(g));
          const target = b.type === 'table' ? releasedByTable : releasedBy;
          if (!target.has(bi)) target.set(bi, []);
          target.get(bi).push(...group);
        }
      });
    }
  }
  const order = [];
  const pending = [];
  const flush = () => { order.push(...pending); pending.length = 0; };
  // An empty note (its text deleted in the editor) is not brailled at all: no separation line or blank line with nothing under it.
  // A save drops it, so the reopened braille differed (A89, the nightly random-action run).
  const emptyNote = (b) => isNote(b) && !String(b.text ?? '').trim() && !(Array.isArray(b.segments) && b.segments.some((g) => g && (g.type && g.type !== 'text' ? true : String(g.text ?? '').trim()))) && !(Array.isArray(b.blocks) && b.blocks.length);
  for (let bi = 0; bi < n; bi++) {
    if (emptyNote(blocks[bi])) continue;
    if (moved.has(bi)) continue;                             // placed before/after its reference instead
    if (en && (collected.has(bi) || bi === en.headIdx)) continue;   // IMP-W3: the endnote section is appended below
    const b = blocks[bi];
    if (b && typeof b === 'object' && (b.type === 'pagenum' || b.type === 'heading')) flush();
    const before = releasedByTable.get(bi);
    if (before) order.push(...before.filter((x) => !emptyNote(blocks[x])));   // 16.8.1a: pinned immediately before the table
    if (isBana && isNote(b)) pending.push(bi);                // unreferenced note: still deferred, keeps its queue place
    else order.push(bi);
    const notes = releasedBy.get(bi);
    if (notes) pending.push(...notes.filter((x) => !emptyNote(blocks[x])));
  }
  flush();
  if (en) order.push(en.headIdx, ...en.moved);               // IMP-W3: the endnote section, in the order the notes stand in the text
  const runStart = new Set();
  if (isBana) order.forEach((bi, k) => { if (isNote(blocks[bi]) && !(k > 0 && isNote(blocks[order[k - 1]]))) runStart.add(bi); });
  return { order, runStart };
}

// BANA Formats §16.5.1 / §16.2.1: a note's body opens with the SAME reference mark used at
// its point of reference in the text (Example 16-1: text `,hamlet"9` / note `"9,o!llo`;
// numbered notes open `;9#a` the same way, §16.2.1). A `<note>` element's own content never
// carries that mark literally (`pushNote`, `Emboss/input/parse.mjs`, keeps only the note's
// print text) — it is the referencing `noteref` segment (carrying `idref` pointing at the
// note's own `id`) that records it. `findNoteMarks` walks the whole document tree once (deep,
// so a noteref nested in a list item, table cell or heading is found too, not only a
// top-level paragraph) and maps each referenced note id to the mark text of the FIRST
// noteref that points at it, in document order — mirroring how a real source can only have
// been transcribed with one such mark per note.
function findNoteMarks(blocks) {
  const marks = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'noteref' && node.idref) {
      const id = String(node.idref);
      if (!marks.has(id)) {
        const mark = String(node.text ?? '').trim();
        if (mark) marks.set(id, mark);
      }
    }
    for (const k in node) walk(node[k]);
  };
  walk(blocks);
  return marks;
}

// A23 / BANA 9.4.1b: "Block attributions in the fifth cell to the right of the beginning of
// the previous line" — literally the immediately preceding braille content LINE, whatever
// block produced it (a paragraph's own runover, a displayed quotation, a poem line, another
// attribution, …), not a fixed cell 5 and not the block's own first-line margin when that
// differs from its runover (an ordinary 3-1 paragraph's runover sits left of its first line;
// sample-9-6's displayed quote has no such split, first and runover both cell 3, so it cannot
// by itself settle this, but the rule text names "the previous LINE", singular, not "the
// passage" or "the paragraph"). EXCEPTION: a heading is not "the previous line" for this rule
// — 9.4.1's own definition is that an attribution identifies the source of "the quote, poem,
// story, etc.", i.e. of textual/narrative matter, not of a title, and a centred heading's own
// (often large, centring-derived) indent empirically pushed the attribution far enough right
// to wrap it onto two lines, breaking both displayed_and_verse_rules.test.mjs's 13.11.2b song
// case and nimas_bana_structures.test.mjs's byline-after-heading case. Returns the 0-based
// cell offset to store as `block.attribCell`, or undefined when the old fixed default
// (formatAttribution/traceBlock's own fallback to 4) should apply instead: no previous
// content line at all, or the previous one belongs to a heading.
function attributionCellFor(content, contentBlock, blocks, block) {
  let pi = content.length - 1;
  while (pi >= 0 && content[pi] === '') pi--;
  if (pi < 0) return undefined;
  const prevBlock = blocks[contentBlock[pi]];
  const line = content[pi];
  const prevIndent = line.length - line.replace(/^ +/, '').length;
  // 9.5.1b/9.5.2: a SOURCE citation (block.kind 'source') placed directly under a heading is blocked in the
  // fifth cell to the right of the beginning of the heading's last line (Example 9-6: heading line at cell 6, citation at cell 10).
  if (prevBlock && typeof prevBlock === 'object' && prevBlock.type === 'heading') {
    return block && block.kind === 'source' ? prevIndent + 4 : undefined;
  }
  // 9.4.1 / 9.5.1: print-adjacent attribution fragments (`continued`, F-80) are ONE attribution: the next fragment
  // stays at the cell of the previous one instead of chaining another 4 cells to the right (Sample 9-10 "(Signed)" / name).
  if (prevBlock && typeof prevBlock === 'object' && prevBlock.type === 'attribution' && prevBlock.continued) return prevIndent;
  return prevIndent + 4;
}

// A23 / BANA 9.4.1a: "Do not start the attribution on a new braille page. If necessary, carry
// the last line of text, followed by the attribution, to a new braille page." Tags the last
// already-pushed line of the preceding text together with this whole attribution as one
// applyPageBoundaries keep-together group (the same `contentKeep` mechanism §11.16j's listed-
// table rows use, via keepGroupIndex) so the pair moves to the next page together rather than
// letting the attribution alone open it. `pushStart` is `content.length` from just before this
// attribution block's own lines were appended. Skipped when either side already carries some
// other keep-group tag, so as not to clobber it (rare block-type combination).
function markAttributionKeepGroup(content, contentKeep, bi, pushStart) {
  if (pushStart >= content.length) return;
  let prevIdx = pushStart - 1;
  while (prevIdx >= 0 && content[prevIdx] === '') prevIdx--;
  if (prevIdx < 0 || contentKeep[prevIdx] != null) return;
  for (let k = pushStart; k < content.length; k++) if (contentKeep[k] != null) return;
  const key = `attrib:${bi}`;
  for (let k = prevIdx; k < content.length; k++) contentKeep[k] = key;
}

// A block's keep-together groups (lines.keepGroups = [[first, last], …] line indexes, set by
// formatListed) as a per-line group number, or null.
const isDirectionsPara = (b) => !!b && typeof b === 'object' && b.type === 'para' && !!b.directions;   // BANA 10.3.2 directions (K24)
function keepGroupIndex(lines) {
  if (!lines || !Array.isArray(lines.keepGroups) || !lines.keepGroups.length) return null;
  const of = Array(lines.length).fill(null);
  lines.keepGroups.forEach(([a, b, tag], g) => { for (let i = a; i <= b && i < lines.length; i++) of[i] = typeof tag === 'string' ? tag : g; });
  return of;
}

// A8 / BANA Formats §21.2.1a: "Start each alphabetic reference on a new braille page." §21.1.1
// scopes "alphabetic reference" to glossaries, thesauruses, dictionaries, indexes and other
// similar material (e.g. gazetteers) — but explicitly hands bibliographies to §22 instead
// ("treated as a separate category... see Bibliographies, section 22"), and §22 (22.1-22.3.2)
// has no equivalent new-page rule, so a bibliography (an unclassed `list`, kind 'plain' —
// standards-map.md BANA 22.2.1's own evidence) is deliberately excluded. UKAAF/B004 Appendix I
// ("Index to books") has no matching rule either, so this is BANA-only. Emboss only models two
// of §21.1.1's named constructs as distinct block kinds today (no 'thesaurus'/'dictionary' kind
// exists, standards-findings.md F-193), so only those two are reachable here.
//
// Returns the Set of block indexes (into `blocks`) whose first line must always open a fresh
// braille page — a GENERAL mechanism, not an index-specific special case: applyPageBoundaries
// below breaks unconditionally (regardless of whether the block fits on a page) for any block
// index in this Set, and does nothing when the block already opens a page (no blank page is
// ever inserted). A later rule needing the same "always start here" behaviour — e.g. the
// transcriber's own pages, or BANA Formats §1.15.1d's "begin the main text of each volume with
// braille page 1" front matter — adds its own clause to the `||` below (or, for a rule that
// isn't BANA-only, a clause outside the `isBana &&` guard) rather than inventing a new
// mechanism; no changes to applyPageBoundaries or page.mjs's assemble() are needed to do so.
// An image block that puts nothing in the braille (no caption, description or citation): a decorative picture.
function isEmptyImageBlock(b) {
  if (!b || typeof b !== 'object' || b.type !== 'graphic' || !isPrintImage(b)) return false;
  const p = printImageParts(b);
  return !(p.caption || p.description || p.citation);
}
const ALPHA_REFERENCE_TITLE = /\b(glossar(y|ies)|index(es)?|indices|dictionar(y|ies)|thesauru(s|ses)|thesauri|gazetteers?|word ?list|vocabulary|lexicon)\b/i;
const DIVISION_LETTER = /^\s*[A-Za-z](\s*[-\u2013\u2014]\s*[A-Za-z])?\s*$/;
function forcedPageBreakBlocks(blocks, isBana) {
  const set = new Set();
  blocks.forEach((b, bi) => {
    if (!b || typeof b !== 'object') return;
    // F-147 / BANA 2.10.2b ("The table of contents begins on a new braille page"): optional `pageBreakBefore` on any block (a
    // manually-authored `kind:'toc'` list is the case it exists for) opens a fresh braille page. Default off; no blank page is
    // ever inserted when the block already opens a page. Not BANA-only: the field is an explicit request.
    if (b.pageBreakBefore && blocks.slice(0, bi).some((x) => x && typeof x === 'object')) set.add(bi);   // nothing before it: it already opens the document
    if (isBana && b.type === 'list' && (b.kind === 'index' || b.kind === 'glossary')) {
      // Gold section 21 (Example 21-2, 21-13): the break goes before the heading run that
      // introduces the list (title, headnote, division letter), not between the division letter
      // and its list. Walk back over headings, crossing at most two paragraphs (a headnote). A
      // heading joins the run only when it follows the run without a paragraph between, or when its own
      // text names an alphabetic reference (Glossary, Index, ...): so a chapter heading and its paragraphs
      // before the "Glossary" heading are not carried onto the new page (23 Sep verification, P2).
      // A list of the same kind already earlier in that run means this is a further division of the same
      // alphabetic reference: no new break.
      const headText = (h) => String(h.text ?? (Array.isArray(h.segments) ? h.segments.map((g) => g && g.text || '').join('') : '') ?? '');
      // 24 Sep re-check, problem 1 (a regression) and bug 7's formatter half: the parser splits a glossary at each print page
      // turn (parseDefinitionList: glossary list, pagenum, glossary list), and a decorative image with nothing to show can sit
      // between two pieces too. Such a piece continues the same alphabetic reference: 21.2.1a starts the REFERENCE on a new
      // page, and BANA 1.11 wants the page change indicator in place, not a new braille page. So when the previous block,
      // stepping over print page numbers and images that show nothing, is a list of the same kind, this is no new reference.
      let pj = bi - 1;
      while (pj >= 0 && blocks[pj] && typeof blocks[pj] === 'object' && (blocks[pj].type === 'pagenum' || isEmptyImageBlock(blocks[pj]))) pj--;
      const samePiece = pj < bi - 1 && pj >= 0 && !!blocks[pj] && blocks[pj].type === 'list' && blocks[pj].kind === b.kind;
      let start = bi, paras = 0, crossed = 0, continuation = false;
      const titles = [];
      for (let j = bi - 1; j >= 0; j--) {
        const p = blocks[j];
        if (!p || typeof p !== 'object') break;
        if (p.type === 'heading') {
          const named = ALPHA_REFERENCE_TITLE.test(headText(p));
          if (crossed && !named && !DIVISION_LETTER.test(titles[titles.length - 1] || '')) { if (!titles.length) titles.push(headText(p)); break; }   // title, headnote, division letter (Example 21-2); an earlier heading is not part of the run, but is what the list sits under when it has no heading of its own
          start = j; crossed = 0; titles.push(headText(p));
          continue;
        }
        if (p.type === 'para' && paras < 2) { paras++; crossed++; continue; }
        if (p.type === 'list' && (p.kind === 'index' || p.kind === 'glossary')) continuation = true;
        break;
      }
      // The parser tags every definition list `glossary`, so a plain definition list (a spelling-activity
      // list) is not an alphabetic reference: an index always is; a glossary only when it says so
      // (`reference`, `dictionary`, `thesaurus`) or its introducing heading run names one (BANA 21.1.1); a glossary
      // with no heading run at all keeps today's break.
      const isReference = b.kind === 'index' || b.reference === true || b.dictionary || b.thesaurus
        || (b.reference !== false && (titles.some((t) => ALPHA_REFERENCE_TITLE.test(t)) || !titles.length));   // no introducing heading at all: cannot be told apart, keep the old behaviour
      if (isReference && !continuation && !samePiece) set.add(start);
    }
    // BANA 2.2.1a (transcriber-generated pages, each on its own page): a Transcriber's Notes page
    // (`tnpage`) or any block with matter:'transcriber' opens a fresh braille page AND the block after
    // it opens another (so the page holds only that block). Not BANA-only: a transcriber's page is
    // wanted under UKAAF too. Adjacent transcriber blocks each open their own page.
    if (b.type === 'tnpage' || blockMatter(b) === 'transcriber') {
      set.add(bi);
      for (let j = bi + 1; j < blocks.length; j++) {
        if (blocks[j] && typeof blocks[j] === 'object') { set.add(j); break; }
      }
    }
  });
  return set;
}
// The braille pages of applyPageBoundaries' output lines, from its page plan (pagePlan[p] = { start: the page's first
// output line, free: lines lifted onto line 1 }). Pages do not all hold perPage output lines: on a BANA page a page change
// line lifted onto line 1 (Formats 1.11.2, with a spelled-out number merged there, 1.14.1c) costs no body line, so that
// page's run is longer by `free`, and `line / perPage` drifts by one page for every such page before the line. The
// contents page numbers (buildToc, tocPageMap) and the transcriber page series use this instead (24 Sep follow-up).
//   pageOf(line) -> 0-based braille page;  range(p) -> [first body line, end) of page p (its lifted lines excluded)
function planPages(pagePlan, total) {
  const plan = Array.isArray(pagePlan) && pagePlan.length ? pagePlan : [{ start: 0, free: 0 }];
  const pageOf = (line) => {
    let lo = 0, hi = plan.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (plan[mid].start <= line) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const range = (p) => p < plan.length ? [plan[p].start + (plan[p].free || 0), p + 1 < plan.length ? plan[p + 1].start : total] : [total, total];
  return { pageOf, range };
}
// BANA 2.2.1b: transcriber-generated pages (blocks with matter:'transcriber', e.g. a `tnpage`) carry
// their own braille page numbers t1, t2 ..., and the book's own pages then still start at 1. assemble()
// numbers every page in the body series, so after it has run each page's number is rewritten here (page
// text and row layout are untouched, so traceRows still mirrors it). A page is a transcriber page when
// its content lines belong to such a block (forcedPageBreakBlocks keeps them apart from other content;
// the page <-> line mapping is applyPageBoundaries' own page plan, planPages).
// Returns null when the document has no transcriber block (ordinary books: nothing changes).
// `startAt` (K29 Stage 1b, default 0 — every pre-existing caller is unaffected): when a titlepage block was
// rendered standalone and already claims t1 (buildStandaloneTitlePage, called separately — the title page
// itself never reaches this function, since the content loop skips it entirely), the remaining transcriber
// pages this function finds (Special Symbols, Transcriber's Notes) must start their own numbering at t2,
// not t1. Passing 1 there reserves it.
function applyTranscriberPageSeries(pages, content, contentBlock, blocks, pagePlan, o, startAt = 0) {
  const isT = (bi) => bi >= 0 && blockMatter(blocks[bi]) === 'transcriber';
  if (!blocks.some((b) => b && typeof b === 'object' && blockMatter(b) === 'transcriber' && b.type !== 'titlepage')) return null;
  const { range } = planPages(pagePlan, content.length);
  const kinds = pages.map((_, p) => {
    const [from, to] = range(p);
    for (let i = from; i < to; i++) {
      if (content[i] !== '' && contentBlock[i] >= 0) return isT(contentBlock[i]) ? 'transcriber' : 'body';
    }
    return 'body';
  });
  if (!kinds.includes('transcriber')) return null;
  const renum = { width: o.width, mode: isBanaOpts(o) ? 'bana' : 'ukaaf', suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders };
  let t = startAt, n = 0;
  const bodyNumber = [];
  const out = pages.map((pg, p) => {
    if (kinds[p] === 'transcriber') { t++; bodyNumber.push(null); return renumberPageSeries(pg, p + 1, 'transcriber', t, renum); }
    n++; bodyNumber.push(n);
    return renumberPageSeries(pg, p + 1, 'body', n, renum);
  });
  return { pages: out, kinds, bodyNumber };
}

// UK-9 follow-up (this brief): shift already-numbered UKAAF 'body' pages by a fixed offset so the body's
// own Arabic sequence continues after the standalone title page (1) and its accessible-copy notice (2,
// always present for UKAAF, assembleUkTitleNoticePage) instead of restarting at 1 — buildDocPages/
// buildDocPagesAsync number the body independently of the standalone title page (K29 Stage 1b:
// buildStandaloneTitlePage/assembleTitlePage's own comments explain why they are rendered separately).
// A page of matter:'transcriber' (Special Symbols/Transcriber's Notes — applyTranscriberPageSeries' own
// t-prefixed series, an existing, UKAAF-applies-too mechanism this brief does not touch, see its own
// header comment) is left alone: only 'body'-kind pages are part of this continuous sequence. Applied as
// a plain post-hoc renumber (like renumberPage's other callers, e.g. volume splitting) rather than by
// threading a start offset through assemble()/applyTranscriberPageSeries' own `p+1` position arithmetic,
// which would have to be undone again for the case (Special Symbols/Notes mixed with a title page) this
// brief does not otherwise touch. `kinds[p]` marks each page's kind (null/absent = ordinary document,
// every page 'body'); 'body' pages are already numbered 1..n in order (assemble()'s or
// applyTranscriberPageSeries' own doing), so the n-th 'body' page found is simply renumbered to n+offset.
// A shift can only ever WIDEN a number by at most one braille cell (crossing a single power-of-ten
// boundary, e.g. #I -> #AJ) since `offset` is always 2 here — renumberPage's overlay writes only into
// the (now one cell wider) number's own slot, which the ORIGINAL render already left >= 2 blank cells of
// running-head-title clearance beside (runningHead's own `+2` check) — so at most it narrows that
// clearance to 1 cell; it can never clip real text. Whether the running-head TITLE is shown at all is
// unaffected either way: that decision was already made, per physical page, by assemble()'s own local
// (always 1-indexed-from-the-start-of-THIS-body) page count before this function ever runs, and this
// function never touches it — only the trailing number substring is rewritten.
function shiftUkBodyPages(pages, kinds, offset, o) {
  if (!offset || !Array.isArray(pages) || !pages.length) return pages;
  const renum = { width: o.width, mode: 'ukaaf', suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders };
  let n = 0;
  return pages.map((pg, p) => {
    if (kinds && kinds[p] && kinds[p] !== 'body') return pg;
    n++;
    return renumberPage(pg, n, n + offset, renum);
  });
}

// ---- K12: braille page guide words in alphabetic references (BANA Formats §21.3.2) ----
// §21.3.2: "Add braille page guide words to all alphabetic references except bibliographies. An agency may choose to
// omit the guide words in certain alphabetic references, such as indexes." a: they "indicate the first and last main
// entries on the braille page"; b: none for subentries; c: "Center guide words on the last line of every braille page";
// d/e: at least three blank cells before the first guide word and between the last one and the braille page number;
// f: three blank cells after it when an interpoint even page has no number; g: no punctuation attached to the end of
// the entry word; h: a dash (,-) connects them; i: shortened when too long (no period added, enough letters of each
// word to be intelligible); j: "(cont.)" after the last guide word of the previous page(s) when a page has no new main
// entry. March 2024 Updates [21.3.2k]: capital/typeform passage indicators need not be terminated in guide word text.
// UKAAF: B004 has no guide words (its page information line, §6, centres the title/section name instead), so this is
// BANA only. A post-pass over the assembled pages: the guide words go on the braille-page-number line (line 25), which
// is never a text line in Emboss's BANA page, so no page break and no line count changes; the page's trace row there
// stays page furniture (traceRows pushes it with no source). Options (field-registry.mjs, both default on):
// doc/o.guideWords === false turns them off; doc/o.indexGuideWords === false omits them from indexes only.
// Emboss's own choice (K12 brief): a reference that fits on one braille page gets none.
const GUIDE_TRAIL_PUNCT = /[\s.,;:!?–—…\-]+$/u;     // §21.3.2g (a hyphen that STARTS an entry, "-agogy", is kept)
const guidePlain = (segs) => (Array.isArray(segs) ? segs.map((g) => (g && typeof g.text === 'string' ? g.text : '')).join('') : '');
function guideClean(s) {
  let t = String(s ?? '').replace(/[·‧]/g, '').replace(/\s+/g, ' ').trim();   // dictionary syllable dots (fum·ble) are not part of the word
  t = t.replace(GUIDE_TRAIL_PUNCT, '');
  // a closing bracket or quote is punctuation attached to the end of the word unless the entry opened it ("Earth (A Gift Shop)")
  while (/[)\]}”’"']$/.test(t)) {
    const close = t[t.length - 1];
    const open = { ')': '(', ']': '[', '}': '{', '”': '“', '’': '‘' }[close];
    const opened = open ? t.includes(open) : (t.slice(0, -1).includes(close));
    if (opened) break;
    t = t.slice(0, -1).replace(GUIDE_TRAIL_PUNCT, '');
  }
  return t;
}
// The entry word of a main entry, in print. Glossary/dictionary/thesaurus: the term (bilingual: the language the
// glossary is organised by, the part before "/", §21.9.2d / Sample 21-4). Index: the heading word or phrase without its
// page references and cross-references (§21.4.4: "An index entry consists of the word or phrase with all its page references").
function guideEntryWord(it, block, glossary) {
  if (!it || typeof it !== 'object') return '';
  let s = '';
  if (glossary && (it.term != null || (Array.isArray(it.termSegments) && it.termSegments.length))) s = it.term != null ? String(it.term) : guidePlain(it.termSegments);
  else {
    s = it.text != null && String(it.text).trim() ? String(it.text) : guidePlain(it.segments);
    if (glossary) s = s.split(/\s+[—–]\s+|:\s/)[0];
    else {
      s = s.replace(/\s+/g, ' ');
      const loc = /,\s*(?:[A-Za-z]{1,3}[-–]?\d|\d|[ivxl]+(?:\s*[,–-]|$))/.exec(s);   // ", 247", ", R30", ", xii"
      if (loc) s = s.slice(0, loc.index);
      const see = /(?:[.;,]\s*|\s*\(\s*)[Ss]ee(?:\s+also)?\b|\s+See(?:\s+also)?\b/.exec(s);   // "..., R68. See also moral", "(see ...)"; not "Things to see"
      if (see && see.index > 0) s = s.slice(0, see.index);
    }
  }
  if (block && block.bilingual && s.includes('/')) {
    // K16: an element before the entry word (`item.lead`, 21.9.2d) may hold its own slash ("el/la artista"): the
    // language split is after it (21.9.4a then drops the lead for a foreign entry, guideForeignEntry)
    const lead = it.lead != null ? String(it.lead) : '';
    const pre = lead.trim() && s.trimStart().startsWith(lead.trim()) ? s.slice(0, s.indexOf(lead.trim()) + lead.trim().length) : '';
    s = pre + s.slice(pre.length).split('/')[0];
  }
  return guideClean(s);
}
// K16 / BANA 21.9.4 "Guide Words in Foreign Language Texts" (Formats 2016; the June 2024 changes leave 21.9.4 as it was):
// "a. Omit articles, reflexive pronouns, or other elements that precede foreign entry words when choosing guide-word text.
//  b. Use only the initial entry word as a guide word when an entry consists of two or more foreign words. Use the first
//  two words of an entry when two or more consecutive entries have the same initial word."
// An entry word is FOREIGN when every letter of it is text with one non-English `seg.lang` and the body brailles it as
// foreign material (the document option foreignText, or a glossary - 21.6.3b, foreignRefSegments). Its guide word is then
// brailled the same way: uncontracted, with the language's foreign alphabet signs (21.6.3d "The language by which the
// glossary is organized should be used for guide words"; guideBraille). 21.9.4a-b themselves apply where 21.9 does - a
// foreign-language text (foreignText) or a bilingual reference (`bilingual`, 21.9.2) - not to an English textbook's
// 21.6.3 glossary. The element before the entry word is `item.lead` when the model gives one (21.9.2d, sharedMargin);
// otherwise an article or reflexive pronoun of the entry's language from FOREIGN_GUIDE_LEADS (Emboss's closed list, the
// definite and indefinite articles and the reflexive pronoun), and only when a further word follows it.
const FOREIGN_GUIDE_LEADS = {
  es: ['el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'se'],
  fr: ['le', 'la', 'les', "l'", 'un', 'une', 'des', 'se', "s'"],
  de: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'sich'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', "l'", 'un', 'uno', 'una', "un'", 'si'],
  pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'se'],
};
// The language (primary subtag) of an entry word `word` (a prefix of the entry's text), or null: every letter of the
// word must be in segments of that one foreign language.
function guideEntryLang(it, glossary, word) {
  const segs = glossary && Array.isArray(it.termSegments) && it.termSegments.length ? it.termSegments : (Array.isArray(it.segments) ? it.segments : null);
  let need = (String(word).match(/\p{L}/gu) || []).length;
  if (!segs || !need) return null;
  let lang = null;
  for (const g of segs) {
    if (!g || typeof g !== 'object') continue;
    if (g.type === 'math') return null;
    if (typeof g.text !== 'string') continue;
    for (const ch of g.text) {
      if (!/\p{L}/u.test(ch)) continue;
      const p = !g.uncontracted && foreignLangIndex(g.lang) ? String(g.lang).trim().toLowerCase().split(/[-_]/)[0] : null;
      if (!p || (lang && p !== lang)) return null;
      lang = p;
      if (--need === 0) return lang;
    }
  }
  return null;
}
/** A main entry's guide-word record: { word, lang } (lang: the foreign language code of the typeform, 0 = English), plus
 *  `words` (the entry's words after 21.9.4a) when 21.9.4 applies - guideForeignWords then picks one or two (21.9.4b). */
function guideForeignEntry(word, it, block, glossary, o) {
  const brailledForeign = !!(o.foreignText || isForeignRefBlock(block));
  const lang = brailledForeign ? guideEntryLang(it, glossary, word) : null;
  const e = { word, lang: lang ? foreignLangIndex(lang) : 0 };
  if (!lang || !(o.foreignText || block.bilingual)) return e;
  let w = word;
  const lead = it.lead != null ? String(it.lead).trim() : '';
  const rest = lead && w.toLowerCase().startsWith(lead.toLowerCase()) ? w.slice(lead.length) : null;
  if (rest != null && rest.trim() && (/['’]$/.test(lead) || /^\s/.test(rest))) w = rest.trim();   // 21.9.4a: the model's own lead
  else if (!lead) {
    const m = /^(\p{L}+(?:['’](?=\p{L})|\s+))(?=\S)/u.exec(w);
    if (m && (FOREIGN_GUIDE_LEADS[lang] || []).includes(m[1].trim().toLowerCase().replace('’', "'"))) w = w.slice(m[1].length);   // 21.9.4a
  }
  e.words = w.split(/\s+/).filter(Boolean);
  e.word = guideClean(e.words[0] || word) || word;
  return e;
}
// 21.9.4b over each reference's main entries in order (entryAt: content line -> entry record).
function guideForeignWords(entryAt) {
  const byRun = new Map();
  for (const li of [...entryAt.keys()].sort((x, y) => x - y)) {
    const e = entryAt.get(li);
    if (!byRun.has(e.run)) byRun.set(e.run, []);
    byRun.get(e.run).push(e);
  }
  const head = (e) => guideClean((e.words ? e.words[0] : String(e.word).split(/\s+/)[0]) || '').toLowerCase();
  for (const list of byRun.values()) {
    list.forEach((e, k) => {
      if (!e.words || e.words.length < 2) return;
      const same = [list[k - 1], list[k + 1]].some((n) => n && head(n) === head(e));
      e.word = guideClean(same ? e.words.slice(0, 2).join(' ') : e.words[0]) || e.word;
    });
  }
}
const isGuideGlossary =(b) => !!b && (b.type === 'glossary' || (b.type === 'list' && (b.kind === 'glossary' || b.style === 'glossary')));
const isGuideIndex = (b) => !!b && b.type === 'list' && b.kind === 'index';
const guideText = (b) => String(b && (b.text ?? guidePlain(b.segments)) || '');
const isDivisionLetterBlock = (b) => !!b && (b.type === 'heading' || b.type === 'para') && DIVISION_LETTER.test(guideText(b));
// The alphabetic references: each starts at an index list, or at a glossary that is an alphabetic reference by the same
// test forcedPageBreakBlocks uses (21.1.1: `reference`, `dictionary`, `thesaurus`, or an introducing heading that names
// one, or no introducing heading at all), and runs on over the pieces the parser splits it into: further lists (an
// index's later divisions come as plain lists), division letters (21.2.3), print page changes and images that show
// nothing. It stops at anything else (a non-division heading, a paragraph, a table ...). Bibliographies (kind-less lists
// under their own heading, §22) never start one.
function alphabeticReferenceRuns(blocks) {
  const runs = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const index = isGuideIndex(b), gloss = isGuideGlossary(b);
    if (!index && !gloss) continue;
    if (gloss && !index && b.reference === false) continue;
    if (gloss && !(b.reference === true || b.dictionary || b.thesaurus)) {
      const titles = [];
      let paras = 0;
      for (let j = bi - 1; j >= 0; j--) {
        const p = blocks[j];
        if (!p || typeof p !== 'object') break;
        if (p.type === 'pagenum' || isEmptyImageBlock(p) || isDivisionLetterBlock(p)) continue;
        if (p.type === 'heading') { titles.push(guideText(p)); if (!DIVISION_LETTER.test(guideText(p))) break; continue; }
        if (p.type === 'para' && paras < 2) { paras++; continue; }
        break;
      }
      if (titles.length && !titles.some((t) => ALPHA_REFERENCE_TITLE.test(t))) continue;
    }
    const members = new Set([bi]);
    let j = bi + 1;
    for (; j < blocks.length; j++) {
      const p = blocks[j];
      if (!p || typeof p !== 'object') continue;
      if (p.type === 'pagenum' || isEmptyImageBlock(p) || isDivisionLetterBlock(p)
        || isGuideGlossary(p) || (p.type === 'list' && p.kind !== 'toc' && !p.wordList)) { members.add(j); continue; }
      break;
    }
    runs.push({ kind: index ? 'index' : 'glossary', members, glossary: gloss });
    bi = j - 1;
  }
  return runs;
}
// The guide-word text of one page, in braille, at most `maxLen` cells: "A,-B" (one entry: "A"; none: "A (cont.)").
// Translated as one print string with an en dash (UEB ,-), so contractions and grade 1 indicators are those of the
// whole guide text ("according" -> ac, Sample 21-3). Shortened from the end of the longer word first, keeping at least
// three letters of each (21.3.2i); a trailing capitals-passage terminator is dropped (Updates 21.3.2k).
// K16: `la` / `lb` - the foreign language code of the first / last word (guideForeignEntry; 0 = English): that word is
// translated as foreign material (uncontracted, foreign alphabet signs), the dash and "(cont.)" as English.
function guideBraille(o, first, last, cont, maxLen, la = 0, lb = 0) {
  const ftf = (s, idx) => Array.from({ length: s.length }, (_, i) => (idx ? idx * FOREIGN_UNIT | (FOREIGN_LETTER_RE.test(s[i]) ? FOREIGN_NO_CONTRACT : 0) : 0));
  const tr = (s, tf) => {
    let t = String((tf && tf.some(Boolean) ? o.translate(s, tf) : o.translate(s)) ?? '').trim();
    if (t.includes(',,,') && t.endsWith(",'")) t = t.slice(0, -2);
    return t;
  };
  const one = (s, idx) => tr(s, ftf(s, idx)).length;
  const build = (a, b) => (cont ? tr(`${a} (cont.)`, [...ftf(a, la), ...ftf(' (cont.)', 0)])
    : (b != null ? tr(`${a}–${b}`, [...ftf(a, la), 0, ...ftf(b, lb)]) : tr(a, ftf(a, la))));
  let a = first, b = cont ? null : last;
  const MIN = 3;
  const cut = (s) => guideClean(s.slice(0, -1)) || s.slice(0, 1);
  let out = build(a, b);
  for (let guard = 0; out.length > maxLen && guard < 400; guard++) {
    const aShort = a.length > Math.min(MIN, first.length), bShort = b != null && b.length > Math.min(MIN, last.length);
    if (!aShort && !bShort) break;
    if (aShort && (!bShort || one(a, la) >= one(b, lb))) a = cut(a); else b = cut(b);
    out = build(a, b);
  }
  return out.length > maxLen ? out.slice(0, maxLen).replace(/[\s,]+$/, '') : out;
}
function applyGuideWords(pages, content, contentBlock, blocks, pagePlan, o, doc) {
  if (!isBanaOpts(o) || o.suppressHeader || o.pageHeaders === false) return;
  if (o.guideWords === false || doc?.guideWords === false) return;
  const noIndex = o.indexGuideWords === false || doc?.indexGuideWords === false;
  const runs = alphabeticReferenceRuns(blocks).filter((r) => !(noIndex && r.kind === 'index'));
  if (!runs.length) return;
  const runOf = new Map();
  runs.forEach((r, ri) => { for (const bi of r.members) runOf.set(bi, ri); });
  // Main entries (level 0) of each member list, in order; the k-th line of that block that starts in cell 1 is the
  // first line of its k-th main entry (every alphabetic-reference layout puts main entries, and nothing else, there:
  // subentries, runovers and centred division letters are indented).
  const itemsOf = new Map();
  const startLines = new Map();
  for (let i = 0; i < content.length; i++) {
    const bi = contentBlock[i];
    if (!runOf.has(bi)) continue;
    const b = blocks[bi];
    if (!b || !Array.isArray(b.items)) continue;
    const line = content[i];
    if (!line || line[0] === ' ' || banaPageChangeNumber(line) !== null) continue;
    if (!startLines.has(bi)) startLines.set(bi, []);
    startLines.get(bi).push(i);
  }
  const entryAt = new Map();                      // content line -> { run, word }
  for (const [bi, lines] of startLines) {
    const b = blocks[bi], ri = runOf.get(bi), glossary = isGuideGlossary(b);
    // An item with no text puts no line in the braille; a level-0 "See also ..." line or a division letter kept as an
    // item takes a cell-1 line but is not a main entry (null: it lines up, it is never a guide word).
    if (!itemsOf.has(bi)) itemsOf.set(bi, (b.items || []).filter((it) => it && typeof it === 'object' && !(it.level > 0))
      .map((it) => {
        const raw = glossary && it.term != null ? String(it.term) : (it.text != null && String(it.text).trim() ? String(it.text) : guidePlain(it.segments) || guidePlain(it.termSegments) || String(it.def ?? ''));
        if (!raw.trim()) return undefined;
        if (/^\s*see\b/i.test(raw) || DIVISION_LETTER.test(raw)) return null;
        const word = guideEntryWord(it, b, glossary);
        return word ? guideForeignEntry(word, it, b, glossary, o) : null;   // K16: { word, lang[, words] } (21.9.4)
      }).filter((x) => x !== undefined));
    const words = itemsOf.get(bi);
    if (words.length !== lines.length) continue;   // cannot line the entries up with the braille: this block adds no guide words
    lines.forEach((li, k) => { if (words[k]) entryAt.set(li, { run: ri, ...words[k] }); });
  }
  if (!entryAt.size) return;
  guideForeignWords(entryAt);                     // K16 / BANA 21.9.4b
  const { range } = planPages(pagePlan, content.length);
  const pageRuns = pages.map((_, p) => {
    const [from, to] = range(p);
    const set = new Set();
    for (let i = from; i < to; i++) if (content[i] !== '' && runOf.has(contentBlock[i])) set.add(runOf.get(contentBlock[i]));
    return set;
  });
  const pagesPerRun = new Map();
  pageRuns.forEach((set) => set.forEach((ri) => pagesPerRun.set(ri, (pagesPerRun.get(ri) || 0) + 1)));
  const w = o.width || 40;
  const lastWord = new Map();                    // run -> the last main entry seen so far (21.3.2j)
  pages.forEach((page, p) => {
    const [from, to] = range(p);
    const entries = [];
    for (let i = from; i < to; i++) if (entryAt.has(i)) entries.push(entryAt.get(i));
    const runsHere = [...pageRuns[p]].filter((ri) => (pagesPerRun.get(ri) || 0) > 1);
    let first = null, last = null, cont = false, firstE = null, lastE = null;
    if (entries.length && (pagesPerRun.get(entries[0].run) || 0) > 1) {
      firstE = entries[0]; lastE = entries[entries.length - 1];
    } else if (!entries.length && runsHere.length && lastWord.has(runsHere[0])) {
      firstE = lastWord.get(runsHere[0]); lastE = firstE; cont = true;
    }
    if (firstE) { first = firstE.word; last = lastE.word; }
    for (const e of entries) lastWord.set(e.run, e);
    if (first == null || !Array.isArray(page) || !page.length) return;
    const foot = String(page[page.length - 1] ?? '');
    const num = foot.trim();
    if (/\s/.test(num)) return;                  // a table's "(cont.)" note already holds this line (F-13)
    const right = num ? w - num.length - 3 : w - 3;   // 21.3.2e / f
    let maxLen = 0;
    for (let L = right; L > 0; L--) { const at = Math.floor((w - L) / 2); if (at >= 3 && at + L <= right) { maxLen = L; break; } }   // 21.3.2c-d: centred
    if (!maxLen) return;
    const g = guideBraille(o, first, first === last && !cont ? null : last, cont, maxLen, firstE.lang || 0, lastE.lang || 0);   // K16: a foreign guide word is brailled as foreign
    if (!g) return;
    const at = Math.floor((w - g.length) / 2);
    let line = ' '.repeat(at) + g;
    if (num) line = line.padEnd(w - num.length) + num;
    page[page.length - 1] = line;
  });
}
function applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana = false, contentKeep = [], o = {}, asm = null) {
  const n = content.length;
  const out = [], outBlock = [], outCells = [], outNote = [];
  // F-13 (BANA §11.3.2b): a table's "(cont.)" line-25 note rides along per output line (see tableContinuedNoteText, assemble).
  const contNotes = new Map();
  const contNoteOf = (b) => {
    if (b < 0 || !blocks[b] || typeof blocks[b] !== 'object' || blocks[b].type !== 'table') return null;
    if (!contNotes.has(b)) {
      const t = tableContinuedNoteText(blocks[b], o);
      contNotes.set(b, t && typeof o.translate === 'function' ? { id: b, text: o.translate(t).trim() } : null);
    }
    return contNotes.get(b);
  };
  const push = (l, b, c) => { out.push(l); outBlock.push(b === TITLE_LINE ? -1 : b); outCells.push(c); outNote.push(l !== '' && typeof b === 'number' ? contNoteOf(b) : null); };
  const tHead = new Map();                                   // F-13 (§11.4.4a): table block -> its repeatable heading lines
  const isHeading = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && blocks[bi].type === 'heading';
  const isPageNum = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && blocks[bi].type === 'pagenum';
  const isGraphic = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && (blocks[bi].type === 'graphic' || blocks[bi].type === 'tactile');
  const isBox = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && (blocks[bi].type === 'box' || blocks[bi].type === 'sidebar');
  // Box lines (Formats §7.1.3): `7` opens, `G` closes; an exterior `=` border
  // opens when it is the first line of its box block and closes when it is not.
  const boxLineKind = (i) => {
    if (i < 0 || i >= n) return null;
    const l = content[i], bi = contentBlock[i];
    if (!isBox(bi) || typeof l !== 'string' || l.length < 3) return null;
    if (/^7+$/.test(l)) return 'top';
    if (/^G+$/.test(l)) return 'bottom';
    if (/^=+$/.test(l)) {
      let prev = i - 1; while (prev >= 0 && contentBlock[prev] === bi && content[prev] === '') prev--;
      return (prev < 0 || contentBlock[prev] !== bi) ? 'top' : 'bottom';
    }
    return null;
  };
  const seenBoundaryBlock = new Set();
  const forcedBreaks = forcedPageBreakBlocks(blocks, isBana);   // A8 / BANA §21.2.1a — see forcedPageBreakBlocks

  // Page accounting. `bodyPos` counts the body lines used on the current braille page. On a BANA page with a line 1,
  // assemble() lifts the page's FIRST line onto line 1 when it is a page change indicator (Formats §1.11.2), with a
  // spelled-out number straight after it (§1.14.1c): those cost no body line. Only the first line: a second indicator
  // stacked under it takes a body line (24 Sep real-book validation, bug 1: counting every indicator at the top of a page
  // as free put every later keep decision in the anthology 1-3 lines off). `lineOne` is the function assemble() itself
  // uses, so the lines planned for each page are exactly the lines assemble puts there; `pagePlan` records the plan
  // ({ start: first output line of the page, free: lines lifted onto line 1 }) so tests can check that.
  const lineOne = isBana && asm ? banaLineOne(asm) : null;
  let bodyPos = 0, pageNo = 1, pageStart = 0, pageFree = 0;
  let printCur = null, printStart = 1, printMid = null;      // the print page number line 1 shows (mirrors assemble), for §11.4.4b
  const pagePlan = [{ start: 0, free: 0 }];
  const newPage = () => {
    pagePlan[pagePlan.length - 1].free = pageFree;
    if (printMid !== null) { printCur = printMid; printStart = pageNo; printMid = null; }
    bodyPos = 0; pageNo++; pageStart = out.length; pageFree = 0;
    pagePlan.push({ start: pageStart, free: 0 });
  };
  // Put one line on the page and count it (`note` given: a line being re-placed, with its own saved note).
  const place = (l, b, c, note) => {
    if (note === undefined) push(l, b, c);
    else { out.push(l); outBlock.push(b); outCells.push(c); outNote.push(note); }
    const at = out.length - 1;
    if (lineOne && bodyPos === 0 && at - pageStart === pageFree && pageFree < 2 && lineOne.top(out, pageStart, pageNo).n > pageFree) {
      if (pageFree === 0) { printCur = banaPageChangeNumber(l); printStart = pageNo; }
      pageFree++;
      return;
    }
    if (lineOne) { const pc = banaPageChangeNumber(l); if (pc !== null) printMid = pc; }
    bodyPos++;
    if (bodyPos === perPage) newPage();
  };
  const padPage = () => { while (bodyPos > 0) place('', -1, null); };
  // BANA 1.11.4: "Begin the new print page on the next braille page when there is not enough room for the page change
  // indicator and one line of text (other than a heading)"; BANA 4 / 8.3.5d: a heading is followed by at least one line
  // of its text on the same braille page. So when a block moves to the next page (a list's keep group F-35, a box line,
  // a graphic, a verse stanza, a table row, a forced break), the page change line(s) and heading(s) that would be left as
  // the last lines of this page go with it (real-book validation bugs 6 and 8). `need` = the lines the moving block needs
  // on the new page; `carry` = 'all' (headings and page change lines), 'pagenum' (page change lines only) or false.
  // Nothing is carried when it would empty this page or when the carried lines and the block would not fit one page.
  // BANA only (UKAAF pagination is unchanged).
  const carryable = (k, carry) => isPageNum(outBlock[k]) || (carry === 'all' && isHeading(outBlock[k]));
  const breakPage = (need, carry = 'all') => {
    if (bodyPos === 0) return;
    // K23 / BANA 1.18: a blank line carried to the top of this page (blankGoesToTop, below) is not left behind as the
    // only thing on a page the next block does not fit on: when nothing but it (and lines that move on with the block)
    // is on this page, it is dropped, as a blank at the top of a page always was.
    if (carriedBlank >= 0 && carriedBlank === pageStart + pageFree && carriedBlank < out.length && out[carriedBlank] === '') {
      let other = false;
      for (let k = carriedBlank + 1; k < out.length && !other; k++) if (out[k] !== '' && !(carry && isBana && carryable(k, carry))) other = true;
      if (!other) {
        out.splice(carriedBlank, 1); outBlock.splice(carriedBlank, 1); outCells.splice(carriedBlank, 1); outNote.splice(carriedBlank, 1);
        bodyPos--; carriedBlank = -1;
        if (bodyPos === 0) return;
      }
    }
    if (carry && isBana) {
      const from = pageStart + pageFree;
      let j = out.length;
      while (j > from && (out[j - 1] === '' || carryable(j - 1, carry))) j--;
      while (j < out.length && out[j] === '') j++;
      const tailLen = out.length - j;
      let stays = false;
      for (let k = from; k < j && !stays; k++) if (out[k] !== '') stays = true;
      const cost = tailLen - (lineOne && tailLen && banaPageChangeNumber(out[j]) !== null ? 1 : 0);
      if (tailLen && !stays && carry === 'pagenum') return;   // only page change lines on this page (a forced break): the block already opens it
      if (tailLen && stays && cost + need <= perPage) {
        const tl = out.splice(j), tb = outBlock.splice(j), tc = outCells.splice(j), tn = outNote.splice(j);
        bodyPos -= tailLen;
        printMid = null;
        if (lineOne) for (let k = from; k < out.length; k++) { const pc = banaPageChangeNumber(out[k]); if (pc !== null) printMid = pc; }
        padPage();
        tl.forEach((l, k) => { if (!(bodyPos === 0 && l === '')) place(l, tb[k], tc[k], tn[k]); });
        return;
      }
    }
    padPage();
  };

  // K23 / BANA 1.18 as clarified in the March 2024 Updates: "When rules determine that a blank line follows text (e.g., a
  // list, box or poem) and that text ends on line 24 or 25 of a braille page, the required blank line is placed at the top
  // of the next braille page; line 1 if there is no running head or line 2 if a running head is used" (13.4.1d says the
  // same for a stanza). Every other blank line that would open a page is still dropped (the rule is about a blank that
  // FOLLOWS text, not one that precedes the next item, e.g. before a heading). A blank follows text when it is the text
  // block's own trailing blank (a list, box, poem, displayed material, table ... ends with it; a blank inside a block,
  // e.g. between table sections, does not count, except between the stanzas of a whole-poem block) or a stanza break.
  // It goes to the top only when the previous page ended with text on its last body line, something follows it, and:
  //  - line 1 is a body line (no running head and no print page number line) or carries a running head: with only the
  //    print page number on line 1, line 1 itself is that blank line ("line 1 if there is no running head");
  //  - the next line is not a page change indicator lifted onto line 1 (1.11.2), nor a block that forces a new page.
  // BANA only. `carriedBlank` lets breakPage drop it again if the page would otherwise hold nothing else.
  let carriedBlank = -1;
  const blankGoesToTop = (i) => {
    if (!isBana || i < 1 || pageFree || out.length !== pageStart || !out.length || out[out.length - 1] === '' || content[i - 1] === '') return false;
    const ob = contentBlock[i], b = ob >= 0 ? blocks[ob] : null;
    if (!b || typeof b !== 'object') return false;
    let j = i + 1; while (j < n && content[j] === '') j++;
    if (j >= n) return false;
    const follows = isVerseSeparator(b)
      || (contentBlock[i - 1] === ob && (contentBlock[j] !== ob || isVerseBlock(b)) && !(b.type === 'para' && o.paragraphStyle === 'block' && !quoteMargins(b, o)));
    if (!follows || forcedBreaks.has(contentBlock[j])) return false;
    if (lineOne && banaPageChangeNumber(content[j]) !== null) return false;
    if (perPage < (o.depth || 25) - 1 && !(lineOne && lineOne.showsTitle(printCur ? formatPrintPageHeader(printCur, pageNo - printStart) : null, pageNo))) return false;
    return true;
  };

  // K15 / BANA Formats §11.13, UKAAF B004 App E: a table set across facing pages (assembleFacingTable's tagged lines
  // [i, end] of block bi) is laid out here as a whole: its lines are 2w cells wide, the left half going on a left-hand
  // page and the right half on the facing right-hand page, line for line (planFacingPages has the rule text).
  // `o.interpoint` (the embosser's duplex setting; default single-sided): a left-hand page is an even braille page
  // (in the body series: transcriber pages have their own t-series, BANA 2.2.1b); in single-sided production any page
  // can be the left-hand page (it is bound to face left, its front side blank, 11.13.1b), so no page is added.
  const fw = o.width || 38;
  const bodyPageNumber = () => {
    if (!blocks.some((b) => b && typeof b === 'object' && blockMatter(b) === 'transcriber')) return pageNo;
    let t = 0;
    for (let p = 0; p + 1 < pagePlan.length; p++) {
      for (let k = pagePlan[p].start; k < pagePlan[p + 1].start; k++) {
        if (out[k] !== '' && outBlock[k] >= 0) { if (blockMatter(blocks[outBlock[k]]) === 'transcriber') t++; break; }
      }
    }
    return pageNo - t;
  };
  const placeFacingTable = (i, end, bi) => {
    const tagPre = bi + ':';
    const g = { lead: [], alt: [], top: null, head: [], rows: [], bottom: null, cite: [] };
    let rowTag = null;
    for (let k = i; k <= end; k++) {
      const kt = typeof contentKeep[k] === 'string' && contentKeep[k].startsWith(tagPre) ? contentKeep[k].slice(tagPre.length) : null;
      if (kt === 'FL') g.lead.push(k); else if (kt === 'FA') g.alt.push(k); else if (kt === 'FT') g.top = k; else if (kt === 'FH') g.head.push(k);
      else if (kt === 'FB') g.bottom = k; else if (kt === 'FC') g.cite.push(k);
      else if (kt && /^FR\d+$/.test(kt)) { if (kt !== rowTag) { g.rows.push([]); rowTag = kt; } g.rows[g.rows.length - 1].push(k); }
    }
    const runningHead = () => !!(lineOne && lineOne.showsTitle(printCur ? formatPrintPageHeader(printCur, pageNo - printStart) : null, pageNo));
    // One half of content line k (null: a blank line). A right-hand page shows no "(cont.)" note (11.13.1g: the table's
    // heading is not repeated on the right facing page).
    const half = (k, right) => {
      if (k == null) { place('', -1, null, right ? null : undefined); return; }
      const s = right ? content[k].slice(fw) : content[k].slice(0, fw);
      let e = s.length; while (e > 0 && s[e - 1] === ' ') e--;
      const c = contentCells[k], off = right ? fw : 0;
      place(s.slice(0, e), bi, Array.isArray(c) ? c.slice(off, off + e) : null, right ? null : undefined);
    };
    // 1. Lead lines that cannot share the left-hand page with the table go before it (11.13.1d).
    const est = planFacingPages(g, { cap0: perPage, perPage, rh: runningHead() });
    if (est.before.length) {
      if (bodyPos > 0 && est.before.length > perPage - bodyPos && est.before.length <= perPage) breakPage(est.before.length);
      est.before.forEach((k) => { if (!(bodyPos === 0 && content[k] === '')) place(content[k], bi, contentCells[k]); });
      g.lead = []; g.alt = [];
      if (est.altUsed) g.cite = [];
    }
    // 2. A fresh left-hand page (11.13.1: "Care must be taken to ensure that the first page is on the left-hand page";
    //    11.13.1d: only the table and its related content on the facing pages). A print page change indicator ending the
    //    page goes with the table (BANA 1.11.4, breakPage); in interpoint an odd page is left blank before it (11.13.1b).
    breakPage(0, 'pagenum');
    // Each page of the pair is marked in the page plan ('L' / 'R', and 'pad' for that blank page) so that a volume split
    // (formatVolumes, volumeChunks) never separates the two pages of a pair and keeps the left-hand page even.
    if (o.interpoint === true && bodyPageNumber() % 2 === 1) {
      const tl = out.splice(pageStart), tb = outBlock.splice(pageStart), tc = outCells.splice(pageStart), tn = outNote.splice(pageStart);
      bodyPos = 0; pageFree = 0;
      const padAt = pagePlan.length - 1;
      for (let k = 0; k < perPage; k++) place('', -1, null);
      pagePlan[padAt].facing = 'pad';
      tl.forEach((l, k) => place(l, tb[k], tc[k], tn[k]));
    }
    // 3. The page pairs: the right-hand page holds the same line sequence as the left-hand page (blank where the line is
    //    left-hand only, and for any line already on the left-hand page above the table).
    const lead0 = bodyPos;
    const plan = planFacingPages(g, { cap0: perPage - lead0, perPage, rh: runningHead(), forceLead: true });
    plan.pairs.forEach((p, pi) => {
      pagePlan[pagePlan.length - 1].facing = 'L';
      p.lines.forEach((k) => half(k, false));
      padPage();
      pagePlan[pagePlan.length - 1].facing = 'R';
      for (let k = 0; k < (pi === 0 ? lead0 : 0); k++) place('', -1, null, null);
      p.lines.forEach((k, j) => half(p.leftOnly[j] ? null : k, true));
      padPage();
    });
    plan.after.forEach((k) => place(content[k], bi, contentCells[k]));
  };

  for (let i = 0; i < n; i++) {
    const carryTop = bodyPos === 0 && content[i] === '' && contentBlock[i] !== TITLE_LINE && blankGoesToTop(i);
    if (bodyPos === 0 && content[i] === '' && contentBlock[i] !== TITLE_LINE && !carryTop) continue;   // no blank at the top of a page (the title's own blank line stays; K23: 1.18's carried blank)
    // K32 / BANA 21.2.1a: the title's own trailing blank line is kept even at the top of a page
    // (just above) so a heading right after the title still gets its ordinary blank line — but
    // not when that heading (or list, etc.) is itself a forced-page-break block (a Glossary or
    // Index whose heading opens the whole document). Keeping the blank there would strand the
    // title alone on a blank braille page 1: forced-break block bi is added to `forcedBreaks`
    // unconditionally, so once this blank is PLACED, bodyPos leaves 0 before that block's own
    // break check runs, and breakPage's "does nothing when the block already opens a page
    // (bodyPos === 0)" short-circuit (a few lines below) no longer applies — the block moves to
    // page 2 anyway, leaving page 1 with only the title and this blank. Dropped here instead,
    // exactly like an ordinary leading blank, so the forced block opens page 1 itself.
    if (bodyPos === 0 && content[i] === '' && contentBlock[i] === TITLE_LINE) {
      let j = i; while (j < n && content[j] === '') j++;
      if (j < n && forcedBreaks.has(contentBlock[j])) continue;
    }
    const bi = contentBlock[i];
    if (bi >= 0 && typeof contentKeep[i] === 'string' && contentKeep[i].startsWith(bi + ':') && FACING_TAG_RE.test(contentKeep[i].slice(String(bi).length + 1)) && !seenBoundaryBlock.has('f' + bi)) {
      seenBoundaryBlock.add('f' + bi);                       // K15: see placeFacingTable
      let end = i; while (end + 1 < n && contentBlock[end + 1] === bi) end++;
      placeFacingTable(i, end, bi);
      i = end;
      continue;
    }
    // A8 / BANA §21.2.1a: a forced-break block (forcedPageBreakBlocks) always opens a fresh
    // page — unconditional, unlike the heading/keep-group checks below, which move a group to
    // the next page only when it additionally FITS there. Does nothing when the block already
    // opens a page (bodyPos === 0), so no blank page is ever inserted.
    if (forcedBreaks.has(bi) && content[i] !== '' && !seenBoundaryBlock.has(bi)) {
      seenBoundaryBlock.add(bi);
      // BANA 1.11.4: a page change line just before the forced break goes to the new page too (science p183); not onto a
      // transcriber's page (BANA 2.2.1a: that page holds only its own block).
      const fb = blocks[bi];
      breakPage(0, fb && (fb.type === 'tnpage' || blockMatter(fb) === 'transcriber') ? false : 'pagenum');
    }
    if ((isHeading(bi) || isPageNum(bi) || isGraphic(bi)) && content[i] !== '' && !seenBoundaryBlock.has(bi)) {
      seenBoundaryBlock.add(bi);
      let end = i; while (end + 1 < n && contentBlock[end + 1] === bi) end++;  // last line of the block
      while (end > i && content[end] === '') end--;                            // minus its trailing blanks
      let next = end + 1; while (next < n && content[next] === '') next++;     // the text line that must follow
      
      // If a print page indicator is followed by a heading (or chain of headings/pagenums),
      // the heading itself must not be orphaned. Per UKAAF B004 §8 and BANA Formats §1.15.2,
      // a print page indicator cannot immediately precede a heading that is carried over.
      if (isPageNum(bi)) {
        let curNext = next;
        let chainCount = 0;
        while (curNext < n && chainCount < 3 && (isHeading(contentBlock[curNext]) || isPageNum(contentBlock[curNext]))) {
          chainCount++;
          const nextBi = contentBlock[curNext];
          let hEnd = curNext; while (hEnd + 1 < n && contentBlock[hEnd + 1] === nextBi) hEnd++;
          while (hEnd > curNext && content[hEnd] === '') hEnd--;
          let hNext = hEnd + 1; while (hNext < n && content[hNext] === '') hNext++;
          curNext = hNext;
          next = hNext < n ? hNext : hEnd;
        }
      }
      
      const need = isGraphic(bi) ? (end - i + 1) : ((next < n ? next : end) - i + 1);
      if (bodyPos > 0 && need > perPage - bodyPos && need <= perPage) breakPage(need);
    }
    // K24 / BANA 10.3 as clarified in the March 2024 Updates ("Directions for questions without answer choices should be on
    // the same braille page as at least one of the questions to which it applies"; 10.3.1a, the directions and at least one
    // question on the same page): at the first line of a run of directions paragraphs (and any transcriber's note after
    // them), the run and the first question of the exercise list that follows it (the first keep group exerciseKeep gave
    // the list, after any example) move to the next page together when they would not fit here and do fit one page.
    if (isBana && content[i] !== '' && bi >= 0 && isDirectionsPara(blocks[bi]) && !seenBoundaryBlock.has('d' + bi)) {
      let k = i;
      for (; k < n; k++) {
        const kb = contentBlock[k], kbk = kb >= 0 ? blocks[kb] : null;
        if (content[k] === '') continue;
        if (isDirectionsPara(kbk)) { seenBoundaryBlock.add('d' + kb); continue; }
        if (kbk && typeof kbk === 'object' && kbk.type === 'note' && !kbk.cell5) continue;
        break;
      }
      const lb = k < n ? contentBlock[k] : -1;
      if (lb >= 0 && blocks[lb] && typeof blocks[lb] === 'object' && blocks[lb].type === 'list' && blocks[lb].kind === 'exercise') {
        let q = k; while (q < n && contentBlock[q] === lb && !(contentKeep[q] && String(contentKeep[q]).startsWith(lb + ':'))) q++;
        if (q < n && contentBlock[q] === lb) {
          let end = q; while (end + 1 < n && contentKeep[end + 1] === contentKeep[q]) end++;
          const need = end - i + 1;
          if (bodyPos > 0 && need > perPage - bodyPos && need <= perPage) breakPage(need);
        }
      }
    }
    // Keep-together groups (a listed-table row, Formats §11.16j): a group that would run
    // past the page and fits on one page moves to the next page. (K24/K31: a 'q' group - an exercise question with
    // its answer choices, exerciseKeep, BANA 10.3.1b-c - is one of these groups too, in addition to marking where the
    // first question ends for the directions rule just above.)
    const kg = contentKeep[i];
    if (kg && content[i] !== '' && !seenBoundaryBlock.has(kg)) {
      seenBoundaryBlock.add(kg);
      let end = i; while (end + 1 < n && contentKeep[end + 1] === kg) end++;
      // A table's title and transcriber's note stay with its first row (BANA 11.2.6, 11.16; 24 Sep re-check problem 2):
      // a listed table's first row group starts at its title (tag 'L': the lines up to its last blank line are that lead);
      // a vertically divided table's notes are a group of their own tagged 'W', kept with the group after it (the first
      // section's headings and first row). When lead and row do not fit one page together, the note is not moved on alone:
      // the row follows it straight on, divided at the page end (11.2.6d "If necessary, a table may be divided between
      // pages"), and only the note and the row's first two lines (its row heading and first entry) are kept together, as a
      // heading is kept with its text (BANA 8.3.5, 1.11.4). Moving the long row whole left the note above a page of blank
      // lines (anthology p535); keeping nothing left the note as the last lines of a page.
      let rowFrom = -1, rowKey = null;
      if (/:L$/.test(kg)) {
        for (let k = end; k > i; k--) if (content[k] === '') { rowFrom = k + 1; break; }
      } else if (/:W$/.test(kg)) {
        let nx = end + 1; while (nx < n && content[nx] === '' && contentKeep[nx] == null) nx++;
        if (nx < n && contentKeep[nx] && contentKeep[nx] !== kg) {
          rowFrom = nx; rowKey = contentKeep[nx];
          let e2 = nx; while (e2 + 1 < n && contentKeep[e2 + 1] === rowKey) e2++;
          end = e2;
        }
      }
      if (rowFrom > i && end - i + 1 > perPage) {
        end = Math.min(end, rowFrom + 1);
        if (rowKey) seenBoundaryBlock.add(rowKey);
      }
      const need = end - i + 1;
      if (bodyPos > 0 && need > perPage - bodyPos && need <= perPage) breakPage(need);
    }
    // F-126 / BANA 13.3.1b ("A line of poetry may not be divided between braille pages") and 13.4.2 ("When a page break
    // would occur following the first line of a stanza, take the entire stanza to the next braille page"). BANA only,
    // for verse lines that are blocks of their own (type 'play', one line each; a `poem` block holding all its lines
    // has no line boundaries to protect). A line that would straddle the page moves whole to the next page when it fits
    // there; so does a stanza (a run of verse-line blocks, two or more lines) whose first line would be the last on the
    // page, when the whole stanza fits on one page. Opt out with `o.verseKeep === false`.
    if (isBana && o.verseKeep !== false && content[i] !== '' && bi >= 0 && isVerseLineBlock(blocks[bi]) && !seenBoundaryBlock.has('v' + bi)) {
      seenBoundaryBlock.add('v' + bi);
      let e1 = i; while (e1 + 1 < n && contentBlock[e1 + 1] === bi) e1++;
      while (e1 > i && content[e1] === '') e1--;   // not the block's trailing blank (the one after a poem, poemRunBoundaries): a last line needs only its own row (bug 11)
      let p0 = i; while (p0 > 0 && contentBlock[p0 - 1] === bi) p0--;   // the block's own leading blank line(s)
      if (bodyPos > 0 && e1 - i + 1 > perPage - bodyPos && e1 - i + 1 <= perPage) breakPage(e1 - i + 1);
      if (bodyPos > 0 && (p0 === 0 || contentBlock[p0 - 1] < 0 || !isVerseLineBlock(blocks[contentBlock[p0 - 1]]))) {
        let s = e1, lines = 1;
        for (let k = e1 + 1; k < n && contentBlock[k] >= 0 && isVerseLineBlock(blocks[contentBlock[k]]); k++) { s = k; if (contentBlock[k] !== contentBlock[k - 1]) lines++; }
        if (lines >= 2 && e1 - i + 1 === perPage - bodyPos && s - i + 1 <= perPage) breakPage(s - i + 1);
      }
    }
    // Formats §7.3.5: (a) "A top box line must be followed by at least one line
    // of text on the braille page" — a top line (or a run of exterior + interior
    // top lines, §7.6.1a) that would end the page moves to the next one with
    // its first line of text; (b) "A bottom box line must be preceded by at
    // least one line of text on the braille page" — the last line of text goes
    // over with its bottom line(s) rather than leaving them to open a page.
    let boxNeed = 0;
    const kind = boxLineKind(i);
    if (kind === 'top') {
      let next = i + 1; while (next < n && (content[next] === '' || boxLineKind(next) === 'top')) next++;
      // F-71 / BANA 7.3.5a second sentence: when that next line begins the box's own
      // synthetic title heading, the heading itself must also be followed by >=1 line of
      // real text on the same page — step past the heading's own lines (and any blanks) to
      // find that further line, and require IT (not just the heading) to fit on the page.
      const headingLines = boxHeadingLineCount(bi, blocks, o);
      if (headingLines > 0 && next < n && contentBlock[next] === bi) {
        let after = next + headingLines;
        while (after < n && content[after] === '') after++;
        next = after;
        // A short box whose heading is followed by only one body line before its own
        // closing border: 7.3.5b (the bottom box line must be PRECEDED by at least one
        // line of text) already pairs that last line with the border independently, a
        // few lines below — chain through it here too, so the heading-orphan check moves
        // the whole top+heading+body+bottom group together, rather than fitting only
        // top+heading+body on this page and re-stranding the heading when 7.3.5b's own
        // separate check then pushes body+bottom alone to the next page.
        if (next < n && boxLineKind(next + 1) === 'bottom') {
          let end = next + 1; while (boxLineKind(end + 1) === 'bottom') end++;
          next = end;
        }
      } else if (isBana && next < n && boxLineKind(next + 1) === 'bottom') {
        // The same for a box with no heading whose only line of text is followed by its bottom line: 7.3.5b would move
        // that line and the bottom line on alone and leave the top line as the last line of this page (anthology p161).
        // BANA only (UKAAF pagination is unchanged).
        let end = next + 1; while (boxLineKind(end + 1) === 'bottom') end++;
        next = end;
      }
      boxNeed = (next < n ? next : i) - i + 1;
    } else if (kind !== 'bottom' && content[i] !== '' && boxLineKind(i + 1) === 'bottom') {
      let end = i + 1; while (boxLineKind(end + 1) === 'bottom') end++;
      boxNeed = end - i + 1;
    }
    if (boxNeed && bodyPos > 0 && boxNeed > perPage - bodyPos && boxNeed <= perPage) breakPage(boxNeed);
    // F-13 / BANA §11.4.4a-b: a table's heading group (headings + separation line + first row, tag "<bi>:H<n>", n = the
    // heading lines) is remembered; a later row of that table that opens a braille page gets the headings repeated
    // above it, after a blank line when line 1 carries a running head (not when it holds only the print page number: the
    // title too long for a running head, bug 13). Skipped when headings + row would not fit one page.
    const kt = contentKeep[i];
    if (typeof kt === 'string' && bi >= 0) {
      const hm = /^\d+:H(\d+)(?:\.\d+)?$/.exec(kt);   // "H<n>.<section>": a vertical-division section's own headings
      if (hm) {
        if (!(i > 0 && contentKeep[i - 1] === kt)) tHead.set(bi, { lines: content.slice(i, i + Number(hm[1])), cells: contentCells.slice(i, i + Number(hm[1])) });
      } else if (bodyPos === 0 && content[i] !== '' && tHead.has(bi) && /^\d+:\d+$/.test(kt)) {
        const hd = tHead.get(bi);
        let end = i; while (end + 1 < n && contentKeep[end + 1] === kt) end++;
        const lead = lineOne && lineOne.showsTitle(printCur ? formatPrintPageHeader(printCur, pageNo - printStart) : null, pageNo) ? 1 : 0;
        if (lead + hd.lines.length + (end - i + 1) <= perPage) {
          if (lead) place('', -1, null);
          hd.lines.forEach((hl, k) => place(hl, bi, hd.cells[k]));
        }
      }
    }
    place(content[i], bi, contentCells[i]);
    if (carryTop) carriedBlank = out.length - 1;
  }
  pagePlan[pagePlan.length - 1].free = pageFree;
  if (pagePlan.length > 1 && pagePlan[pagePlan.length - 1].start === out.length) pagePlan.pop();
  return { content: out, contentBlock: outBlock, contentCells: outCells, contentNote: outNote, pagePlan };
}

// BANA Formats §1.11.3d: "Use only one blank line following a page change
// indicator when the guidelines require a blank line before and after a page
// change indicator" (Example 1-10: a list ends, the indicator follows it
// directly, then one blank line before the heading). The blank line before the
// indicator (§1.11.3b) is kept only when no blank follows it (§1.11.3c).
function singleBlankAroundPageChange(content, contentBlock, contentCells, blocks, contentKeep = []) {
  const isPageNum = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && blocks[bi].type === 'pagenum';
  for (let i = content.length - 2; i >= 1; i--) {
    if (isPageNum(contentBlock[i]) && banaPageChangeNumber(content[i]) !== null && content[i - 1] === '' && content[i + 1] === '') {
      content.splice(i - 1, 1); contentBlock.splice(i - 1, 1); contentCells.splice(i - 1, 1); contentKeep.splice(i - 1, 1);
    }
  }
  return { content, contentBlock, contentCells, contentKeep };
}

// Text cleaning applied to everything that reaches the translator: house
// normalisation: tabs and C0/DEL control characters become spaces (which
// preserves exact 1:1 character positions for translatePos source-linking). Newlines are kept.
const cleanForTranslate = (text) => String(text || '').replace(/\t/g, ' ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ');

// Untranslatable print characters (F-213). liblouis has no cell for an icon/shape/emoji (a pencil, a star, a ballot box) and prints its undefined-character
// escape `'\X270F'` into the braille, which a reader could never interpret. BANA 17.5.1: "If a print symbol does not have a corresponding symbol in braille,
// devise a symbol using a shape indicator or a transcriber-defined symbol indicator"; 17.5.1d: list such symbols on the Special Symbols page or in a
// transcriber's note. UKAAF (UK-8: no Special Symbols page): the escape is replaced by the six-dot full cell (`=`, the same placeholder engine/louis.mjs uses
// for non-BMP input) so no escape ever reaches the output, and each distinct code point is recorded in `o.untranslatable` ([{ char, codePoint }]) for a
// warning. BANA (ICON-1 below): a transcriber-defined print symbol instead, when one is available. Translatable text is untouched (byte-identical).
// `untranslatableNoteText(list)` gives the note wording (used when a caller lists the UKAAF/overflow ones).
const BLANK_CELLS = '"""';   // three dot-5 cells (BRF `"`), BANA 10.6.1 / 8.8.2 blank symbol
const LOU_ESCAPE_GLOBAL_RE = /'\\X([0-9A-Fa-f]{4})'/g;
const UNTRANSLATABLE_CELL = '=';

// ICON-1 (Paul, 28 Sep 2026; KD round-2 Q7e) / RUEB §3.26, BANA 17.5.1d, 2.5.2: BANA only (UK-8:
// no Special Symbols page in UKAAF, which keeps the plain full-cell + warning treatment above
// unchanged). Each DISTINCT print character liblouis has no braille cell for (a pointing hand, a
// light bulb, a dingbat, an emoji…) becomes its own transcriber-defined print symbol instead of the
// full-cell placeholder — assigned the first time it is seen (in document order) and reused on
// repeat, then listed on the Special Symbols page (collectIconSymbols below, wired into
// collectSpecialSymbols) with a description. RUEB §3.26's own table names symbols only up to the
// SEVENTH (⠹ ⠼⠹ ⠈⠼⠹ ⠘⠼⠹ ⠸⠼⠹ ⠐⠼⠹ ⠨⠼⠹): the first is the dots-1456 cell alone, in grade 1 mode
// (§3.26.1's own note; TD_SYMBOL_1 above already does this for the print asterism — BRF '?').
// The second on is the numeral sign (dots 3456, BRF '#') followed by that same dots-1456 cell, with
// one more prefix cell stacking on for the third through seventh (dot4 '@', dots45 '^', dots456
// '_', dot5 '"', dots46 '.' — all confirmed against engine/brf-ascii.mjs's BRF64 dot-mask table).
// An 8th distinct icon in the same document has no further slot and falls back to the old full-cell
// + o.untranslatable/lou-undefined-char treatment (replaceUndefinedChar below).
//
// The print asterism (BANA 1.9.5) uses the first symbol (TD_SYMBOL_1) itself; a document that has one
// starts its icons at the second (preassignIconSymbols sets o._iconSlotOffset), so one symbol never has
// two meanings (RUEB 3.26.1: "list each ... symbol ... and its meaning").
// A78 (closed a gap flagged while building ICON-1): a non-BMP character (most emoji, including
// the brief's own "a lightbulb 💡" example — U+1F4A1) now DOES reach this code as a pair of
// adjacent '\Xhhhh' escapes (one per UTF-16 surrogate half), re-paired back into the single code
// point by scanUndefinedEscapes below. Emboss/engine/louis.mjs's/louis-browser.mjs's own
// foldNonBmp/bmpFold — the WASM marshalling boundary, called before liblouis ever runs — used to
// substitute the bare full-cell placeholder (U+283F ⠿, BRF '=') for any non-BMP code point with no
// single-character NFKC fold, so document.mjs's scrub layer only ever saw the ALREADY-SUBSTITUTED
// '=' cell, never an escape to intercept; foldNonBmp now keeps such a code point's two surrogate
// units intact instead, and liblouis's own undefined-character-escape fallback fires for each,
// exactly as it already did for an ordinary undefined BMP character. A mathematical alphanumeric
// (𝑥 U+1D465 etc.) still folds to its plain letter/digit via NFKC before liblouis ever sees it, so
// it never reaches this code at all — unchanged. See tests/emoji_icons.test.mjs for the coverage
// (BANA icon symbol assignment/reuse/Symbols-page entry, UKAAF full-cell-plus-warning, the editor
// translatePos path, and the NFKC-fold case staying untouched).
const ICON_SYMBOL_BRL = [null, ';?', '#?', '@#?', '^#?', '_#?', '"#?', '.#?'];
// A small table for the common dingbats/emoji/symbols a BANA transcriber is actually likely to meet
// (RUEB §3.26.1's own examples: ‰, ฿, a flower symbol). Unicode's formal character NAME reads like
// "WHITE RIGHT POINTING INDEX" and is not what belongs on a Symbols page; this gives BANA 2.5.2d's
// required "meaning" in plain lower-case words instead. Anything not listed here falls back to a
// generic "Print symbol" plus the character itself (iconDescription below). The non-BMP entries
// (💡🚫👉👈🙂😀😊📞📧⭐🌟) were added for when the ICON_SYMBOL_BRL comment's foldNonBmp gap (above)
// was closed (A78) — now reachable, the same as every BMP entry in this table.
const ICON_SYMBOL_NAMES = {
  '☞': 'pointing hand', '☜': 'pointing hand', '👉': 'pointing hand', '👈': 'pointing hand',
  '💡': 'light bulb',
  '⚠': 'warning sign', '⚠️': 'warning sign',
  '☐': 'check box', '✅': 'check mark', '✔': 'check mark', '✔️': 'check mark', '❌': 'cross mark', '✖': 'cross mark',
  '★': 'star', '☆': 'star', '✩': 'star', '✪': 'star', '✫': 'star', '⭐': 'star', '🌟': 'star',
  '✏': 'pencil', '✎': 'pencil', '✒': 'pen nib',
  '❤': 'heart', '❤️': 'heart', '♥': 'heart',
  '☺': 'smiling face', '🙂': 'smiling face', '😀': 'smiling face', '😊': 'smiling face',
  '☂': 'umbrella', '☔': 'umbrella',
  '☎': 'telephone', '📞': 'telephone',
  '✉': 'envelope', '📧': 'envelope', '✂': 'scissors', '✁': 'scissors',
  '⛔': 'no entry sign', '🚫': 'prohibited sign',
  '‰': 'per mille sign',
};
const iconCapitalize = (s) => { const t = String(s || ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
// BANA 2.5.2d: "symbol, a space, its meaning beginning with a capital letter" — so, unlike
// symbolMeaning's plain description pass-through, this always returns a capitalised string.
function iconDescription(o, char, cp) {
  const altSrc = o && o.iconAlt;
  const alt = altSrc ? (typeof altSrc.get === 'function' ? altSrc.get(char) : altSrc[char]) : null;
  if (typeof alt === 'string' && alt.trim()) return iconCapitalize(alt.trim());
  const name = ICON_SYMBOL_NAMES[char];
  if (name) return iconCapitalize(name);
  return `Print symbol ${char}`;
}
// Look up (assigning on first use) the transcriber-defined symbol for one distinct untranslatable
// character, keyed by code point. Returns null past the 7th distinct icon in this document — RUEB
// names no further slot, so the caller keeps the old full-cell behaviour for the overflow.
function assignIconSymbol(o, char, cp, description) {
  const map = o._iconSymbols || (o._iconSymbols = new Map());
  const existing = map.get(cp);
  if (existing) return existing;
  // The print asterism (BANA 1.9.5) already uses the first transcriber-defined symbol (TD_SYMBOL_1); when the
  // document has one, icons start at the second, so one symbol never has two meanings (28 Sep, main session).
  const slot = map.size + 1 + (o._iconSlotOffset || 0);
  if (slot >= ICON_SYMBOL_BRL.length) return null;
  const entry = { slot, brl: ICON_SYMBOL_BRL[slot], char, codePoint: cp, description: description || iconDescription(o, char, cp) };   // IMP-W7: a custom bullet names itself ("Arrow bullet")
  map.set(cp, entry);
  return entry;
}
// liblouis's foldNonBmp emits ONE \Xhhhh escape per UTF-16 code unit (see LOU_UNDEFINED_CHAR_RE's
// own comment above: 'a 𝑥 b' -> A '\XD835''\XDC65' ;B), so a non-BMP emoji/dingbat appears as an
// adjacent HIGH-surrogate escape immediately followed by a LOW-surrogate escape. Scans a braille
// string for every escape occurrence, pairing such adjacent surrogate halves back into the single
// real character they came from, so ICON-1 never assigns two different symbols (or lists two
// different Special Symbols page entries) for what a reader sees as one glyph.
function scanUndefinedEscapes(braille) {
  const re = new RegExp(LOU_ESCAPE_GLOBAL_RE.source, 'g');
  const raw = [];
  let m;
  while ((m = re.exec(braille))) raw.push({ index: m.index, len: m[0].length, hex: m[1] });
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const hi = parseInt(a.hex, 16);
    if (hi >= 0xD800 && hi <= 0xDBFF && i + 1 < raw.length) {
      const b = raw[i + 1];
      if (b.index === a.index + a.len) {
        const lo = parseInt(b.hex, 16);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          const cp = (hi - 0xD800) * 0x400 + (lo - 0xDC00) + 0x10000;
          out.push({ index: a.index, len: a.len + b.len, codePoint: cp, char: String.fromCodePoint(cp) });
          i++; continue;
        }
      }
    }
    out.push({ index: a.index, len: a.len, codePoint: hi, char: String.fromCharCode(hi) });
  }
  return out;
}
// One occurrence of liblouis's undefined-character escape -> the braille text that replaces it.
// BANA: a transcriber-defined print symbol (ICON-1) when one is available. UKAAF, or the 8th+
// distinct BANA icon: the old six-dot full-cell placeholder, recorded on `o.untranslatable` and
// aggregated for the `lou-undefined-char` transcription warning exactly as before — a character
// handled as an icon symbol is no longer "untranslatable" and never reaches either.
function replaceUndefinedChar(o, char, cp) {
  // The sub/superscript markers (text-style.mjs SCRIPT_MARKS, U+E000–U+E002) are not print characters: a translator that
  // does not handle them (the editor's position trace) passes them to liblouis, which escapes them. They are dropped, never
  // reported as symbols with no braille (Paul, 30 Sep: the notice listed them).
  if (cp >= 0xE000 && cp <= 0xE002) return '';
  if (isBanaOpts(o)) {
    const sym = assignIconSymbol(o, char, cp);
    if (sym) return sym.brl;
  }
  const list = o.untranslatable || (o.untranslatable = []);
  if (!list.some((e) => e.codePoint === cp)) list.push({ char, codePoint: cp });
  if (o._warnCtx) {
    const agg = o._warnCtx.__lou || (o._warnCtx.__lou = { count: 0, chars: new Set() });
    agg.count++; agg.chars.add(char);
  }
  return UNTRANSLATABLE_CELL;
}
function scrubUndefinedChars(o, braille) {
  if (typeof braille !== 'string' || braille.indexOf('\\X') < 0) return braille;
  const occ = scanUndefinedEscapes(braille);
  if (!occ.length) return braille;
  let out = '', last = 0;
  for (const e of occ) {
    out += braille.slice(last, e.index);
    out += replaceUndefinedChar(o, e.char, e.codePoint);
    last = e.index + e.len;
  }
  out += braille.slice(last);
  return out;
}
// Same, for a translatePos result ({ braille, inputPos }): each escape occurrence (one \Xhhhh match,
// or a surrogate pair of two — see scanUndefinedEscapes) collapses to its replacement's cells, so
// its input-position entries collapse to that many copies of the escape's own source position.
function scrubUndefinedPos(o, res) {
  if (!res || typeof res.braille !== 'string' || res.braille.indexOf('\\X') < 0) return res;
  const src = res.braille, pos = res.inputPos;
  const occ = scanUndefinedEscapes(src);
  if (!occ.length) return res;
  let out = '', np = [], last = 0;
  for (const e of occ) {
    out += src.slice(last, e.index); if (pos) np.push(...pos.slice(last, e.index));
    const rep = replaceUndefinedChar(o, e.char, e.codePoint);
    out += rep; o._posScrubs = (o._posScrubs || 0) + 1;
    if (pos) { const p = pos[e.index]; for (let k = 0; k < rep.length; k++) np.push(p); }
    last = e.index + e.len;
  }
  out += src.slice(last); if (pos) np.push(...pos.slice(last));
  return { ...res, braille: out, ...(pos ? { inputPos: np } : {}) };
}
// ICON-1 pre-pass: assigns every document's distinct icon its transcriber-defined symbol slot, in
// true document order, BEFORE any block is formatted — the Special Symbols page is resolved
// (resolveSymPages/collectSpecialSymbols, called from buildDocPages/buildDocPagesAsync) well before
// the main per-block translate loop would otherwise be the first to discover them, and the page
// comes EARLY in the document (BANA 2.2.1), before the body text that actually uses the icons.
// Reuses the real o.translate (already wrapped by installScrub) purely for its replaceUndefinedChar
// side effect on o._iconSymbols — the return value is discarded, and since o._warnCtx is not set
// yet here, no transcription warning is raised by this pass (only the real per-block loop's own
// translate calls, landing on the very same already-assigned slot, ever do that — and only for a
// genuine 8th-icon overflow). BANA only (UK-8: no Special Symbols page in UKAAF). A direct
// formatBlock/traceBlock caller with no whole document to pre-scan (e.g. a unit test) still gets
// correct, order-of-first-use slots from assignIconSymbol's own lazy, per-`o` accumulation — this
// pre-pass only fixes the ordering relative to the EARLY Special Symbols page within one
// formatDocument/formatDocumentAsync call.
function preassignIconSymbols(blocks, o) {
  if (!isBanaOpts(o) || typeof o.translate !== 'function') return;
  const hasAsterism = (bs) => (bs || []).some((b) => b && (((b.type === 'break' || b.type === 'indicator') && b.kind === 'asterism' && !b.text) || hasAsterism(b.blocks)));
  if (hasAsterism(blocks)) o._iconSlotOffset = 1;
  for (const { text, bullet } of collectPlainText(blocks, 0, true)) {
    if (bullet) { customBullet(bullet, o); continue; }   // IMP-W7: a custom print bullet takes the next free symbol in document order too
    try { o.translate(text); } catch { /* a hostile/malformed run costs nothing here; the real per-block pass below has its own try/catch */ }
  }
}
// Wrap the translate functions once (idempotent, marked) so every entry point (formatDocument, formatBlock, traceBlock) is covered.
function installScrub(o) {
  if (!o || typeof o !== 'object') return o;
  for (const k of ['translate', 'translateG1', 'translateUncontracted']) {
    const f = o[k];
    if (typeof f === 'function' && !f.__scrub) { const w = (...a) => scrubUndefinedChars(o, f(...a)); w.__scrub = true; o[k] = w; }
  }
  const fp = o.translatePos;
  if (typeof fp === 'function' && !fp.__scrub) { const w = (...a) => scrubUndefinedPos(o, fp(...a)); w.__scrub = true; o.translatePos = w; }
  return installForeign(o);   // K16: foreign-language runs (only a typeform carrying a language code is touched)
}
export function untranslatableNoteText(list) {
  const cps = (list || []).map((e) => 'U+' + e.codePoint.toString(16).toUpperCase().padStart(4, '0'));
  return cps.length ? 'Untranslatable print symbol' + (cps.length > 1 ? 's' : '') + ': ' + cps.join(', ') + '; shown as the full cell.' : '';
}

// Spaced ellipsis (Sample 15-4) / BANA Formats glossary: an ellipsis is "a set of three equally spaced periods" (UEB 7.3.1: follow print for the number of
// dots), so print typed as spaced periods (". . .") is the ellipsis symbol, not three periods each followed by a space (`4 4 4`). Optional
// (`o.spacedEllipsis` or `doc.spacedEllipsis`; default off, translation unchanged): run before translation, keeping the typeform
// array and the returned source positions in step with the original text. A space between the ellipsis and a following ! or ? goes too.
const SPACED_ELLIPSIS_RE = /\.(?: \.){2,}(?: (?=[!?]))?/g;
function collapseSpacedEllipsis(text, tf) {
  const t = String(text || '');
  if (!t.includes('. .')) return { t, tf, map: null };
  const map = [];
  let out = '', last = 0, changed = false;
  for (const m of t.matchAll(SPACED_ELLIPSIS_RE)) {
    for (let i = last; i < m.index; i++) { out += t[i]; map.push(i); }
    for (let i = m.index; i < m.index + m[0].length; i++) if (t[i] === '.') { out += '.'; map.push(i); }
    last = m.index + m[0].length; changed = true;
  }
  if (!changed) return { t, tf, map: null };
  for (let i = last; i < t.length; i++) { out += t[i]; map.push(i); }
  return { t: out, tf: Array.isArray(tf) ? map.map((i) => tf[i]) : tf, map };
}
function applySpacedEllipsis(o) {
  const rawTr = o.translate, rawTrPos = o.translatePos, rawG1 = o.translateG1;
  if (typeof rawTr === 'function') o.translate = (text, tf) => { const c = collapseSpacedEllipsis(text, tf); return rawTr(c.t, c.tf); };
  if (typeof rawG1 === 'function') o.translateG1 = (text, tf) => { const c = collapseSpacedEllipsis(text, tf); return rawG1(c.t, c.tf); };
  if (typeof rawTrPos === 'function') {
    o.translatePos = (text, tf) => {
      const c = collapseSpacedEllipsis(text, tf);
      const res = rawTrPos(c.t, c.tf);
      if (!c.map || typeof res !== 'object' || res === null) return res;
      const key = Array.isArray(res.inputPos) ? 'inputPos' : (Array.isArray(res.map) ? 'map' : null);
      return key ? { ...res, [key]: res[key].map((p) => (typeof p === 'number' ? (c.map[p] ?? p) : p)) } : res;
    };
  }
}

// Word-final apostrophe of an elision (comin', courtin', Sample 13-14; BANA glossary "elision: the omission of a letter or shortening of a
// word, e.g., comin' for coming"). liblouis reads a word-final U+2019 as a closing single quote (`,0`) except after "s"; an apostrophe
// is `'`. Optional (`o.elisionApostrophe` or `doc.elisionApostrophe`; default off): a U+2019 that follows a letter, is not followed by a
// letter or digit, and closes no opening U+2018 seen earlier in the same text run becomes a plain apostrophe before translation
// (same length, so cell-trace positions are untouched). A quotation that opens in an earlier run is not seen: that is why it is an option.
function elisionApostrophes(text) {
  const t = String(text || '');
  if (!t.includes('\u2019')) return t;
  let open = 0, out = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\u2018') open++;
    else if (ch === '\u2019') {
      if (open > 0) open--;
      else if (i > 0 && /\p{L}/u.test(t[i - 1]) && !/[\p{L}\p{N}]/u.test(t[i + 1] || ' ')) { out += "'"; continue; }
    }
    out += ch;
  }
  return out;
}
function applyElisionApostrophe(o) {
  const rawTr = o.translate, rawTrPos = o.translatePos, rawG1 = o.translateG1;
  if (typeof rawTr === 'function') o.translate = (text, tf) => rawTr(elisionApostrophes(text), tf);
  if (typeof rawTrPos === 'function') o.translatePos = (text, tf) => rawTrPos(elisionApostrophes(text), tf);
  if (typeof rawG1 === 'function') o.translateG1 = (text, tf) => rawG1(elisionApostrophes(text), tf);
}

// ===================== transcription warnings (Fable review #5, docs/fable-review-26sep.md) =====================
// A structured record of anything the formatter had to skip, replace, or silently fall back on
// while turning this document into braille: a block whose formatter threw and was dropped
// (formatBlock's own catch), traceBlock throwing and falling back to formatBlock (the braille is
// identical either way — only that one block's editor cell-linking is affected for this render),
// a liblouis-undefined print character replaced by the full-cell placeholder (scrubUndefinedChars,
// already tracked in `o.untranslatable` for F-213 — this adds a per-block, per-run count and the
// distinct characters), a raster dot-pattern row (formatTactileGraphic/traceTactileGraphic) whose
// character isn't valid BRF and became a blank cell, and a table that could not be set in its
// requested/auto layout and fell back to Listed (BANA)/paragraph (UKAAF) (formatTable/traceTable,
// the same resolveTableLayout the G15 toolbar badge already uses). Collected on `o._warnings`
// while buildDocPages*/buildDocPagesAsync* runs (`o._warnCtx` holds the block currently being
// formatted, read by pushWarning and by scrubUndefinedChars) and copied to the caller-visible
// `o.warnings` by formatDocument/formatDocumentAsync — the same pattern already used for
// `o.untranslatable`. Nothing here is ever read back into a formatting decision, so recording a
// warning can never change the braille that gets emitted.
function blockTextSnippet(block) {
  // Read-only preview text for a warning entry \u2014 never allowed to throw itself (a hostile
  // or malformed block must still only cost its OWN warning, not the whole conversion; see
  // formatBlock's own header comment above).
  try {
    if (!block || typeof block !== 'object') return '';
    const clip = (s) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > 80 ? s.slice(0, 77) + '\u2026' : s; };
    if (typeof block.text === 'string' && block.text.trim()) return clip(block.text);
    if (Array.isArray(block.segments) && block.segments.length) {
      const s = block.segments.map((g) => (g && g.text) || '').join('');
      if (s.trim()) return clip(s);
    }
    if (Array.isArray(block.items) && block.items.length) {
      const it = block.items[0];
      const s = it && (it.text || (Array.isArray(it.segments) ? it.segments.map((g) => (g && g.text) || '').join('') : ''));
      if (s && s.trim()) return clip(s);
    }
    if (Array.isArray(block.headers) && block.headers.length) return clip(block.headers.map((h) => cellPlainText(h)).join(' | '));
    if (typeof block.title === 'string' && block.title.trim()) return clip(block.title);
    if (typeof block.alt === 'string' && block.alt.trim()) return clip(block.alt);
    return '';
  } catch { return ''; }
}
// Transcription warning 'table-fallback': only a layout the transcriber CHOSE (columnar, vertical,
// stairstep, linear, facing...) that Emboss could not use is a warning. 'auto' (Quick Mode's and
// the settings default) and 'spatial' (the editor's default) falling to Listed/paragraph form is
// the rule working (BANA §11.9, B004 §12), and the editor's G15 notice already says so.
function requestedTableMode(block, o) {
  return String(block.format || block.style || o.tableFormat || 'auto').replace(/^table-/, '');
}
function tableLayoutWasChosen(block, o) {
  return !['auto', 'spatial', 'listed', 'paragraph'].includes(requestedTableMode(block, o));
}
// A65: an inline equation (in a paragraph, caption or table cell) the maths engine rejects is left
// out of the braille; say so. Both layout paths can run for one block (the trace path, then
// formatBlock when the trace is distrusted), so the same message for the same block is kept once.
function warnInlineMathSkipped(o, e) {
  const message = `Equation could not be transcribed and was left out: ${(e && e.message) || e}`;
  const ctx = (o && o._warnCtx) || {};
  const at = typeof ctx.blockIndex === 'number' ? ctx.blockIndex : -1;
  if ((o && o._warnings || []).some((w) => w.kind === 'block-skipped' && w.blockIndex === at && w.message === message)) return;
  pushWarning(o, 'block-skipped', message, { inline: true });
}
// A89 (Paul, 2 Oct 2026): an equation that held only TeX Emboss could not convert (input/omml.mjs texOnlyMathToMathML marks it with an
// <merror>) is not dropped without a word: the braille has a transcriber's note "equation could not be read" where it stood, and the
// transcriber is told through the transcription warnings (kind math-unreadable), once per equation in its block, the way a picture
// with no description is (traceOrFormatPrintImage). Needs no maths engine.
const isUnreadableMath = (m) => !!m && typeof m.mathml === 'string' && /<(?:[\w.-]+:)?merror\b/.test(m.mathml);
// S2b #11 (ChatGPT audit 15 Oct 2026): an equation the maths engine REJECTS (MathCAT refuses a non-empty MathML: a fraction with one child) is
// treated the same way. engine/maths.mjs and format/node-maths-helper.mjs throw an error marked `mathRejected` (an empty equation stays
// nothing); it used to come back as '' and was dropped without a word. Inline and display, one-pass and async, all end up here.
const isRejectedMath = (e) => !!e && e.mathRejected === true;
function unreadableMathBrf(o, m, rejected) {
  const ctx = (o && o._warnCtx) || {};
  const at = typeof ctx.blockIndex === 'number' ? ctx.blockIndex : -1;
  const tex = String(m.latex ?? '');
  const eqKey = tex || String(m.mathml ?? '');                       // which equation (two different ones in a block are two warnings)
  if (!(o && o._warnings || []).some((w) => w.kind === 'math-unreadable' && w.blockIndex === at && w.tex === tex && (w.eqKey === undefined || w.eqKey === eqKey))) {
    if (rejected) pushWarning(o, 'math-unreadable', `An equation could not be translated into braille by the maths engine, so a transcriber's note stands in its place. Check it, or type it again as an equation.`, { tex, eqKey, rejected: true, detail: rejected.detail || '' });
    else pushWarning(o, 'math-unreadable', `An equation could not be read${tex ? ` (its TeX: ${tex})` : ''}. Check it, or type it again as an equation.`, { tex, eqKey });
  }
  return `${TN_OPEN}${String(o.translate('Equation could not be read') ?? '').trim()}${TN_CLOSE}`;
}
function pushWarning(o, kind, message, extra) {
  if (!o || typeof o !== 'object') return;
  const arr = o._warnings || (o._warnings = []);
  const ctx = o._warnCtx || {};
  arr.push({
    kind,
    blockIndex: typeof ctx.blockIndex === 'number' ? ctx.blockIndex : -1,
    blockType: ctx.blockType || null,
    message: String(message ?? ''),
    snippet: ctx.snippet || '',
    ...(extra || {}),
  });
}

// S3a #14 (ChatGPT audit 15 Oct 2026): THE braille page number a line's page is cited as in a contents list, for the automatic contents
// (buildDocPages/buildDocPagesAsync) and for a manual/imported one (tocPageMap) alike, so the two cannot drift apart again. It is the
// page's number in the body's own series (`tSeries.bodyNumber`, set when Special Symbols / Transcriber's Notes pages are numbered
// apart; null otherwise, then the page's position) PLUS the front-matter offset (`ukTitleOffset`: a UKAAF Title Page and its notice
// claim pages 1-2, so the body continues from 3 - the same shift shiftUkBodyPages applies to the pages themselves at the end).
// tocPageMap used to leave the offset out, so a manual contents sent a reader to the Title Page.
function headingBraillePage(line, pageOf, tSeries, ukTitleOffset) {
  return (tSeries ? (tSeries.bodyNumber[pageOf(line)] || 1) : pageOf(line) + 1) + (ukTitleOffset || 0);
}

// S3a #15 (ChatGPT audit 15 Oct 2026): a block's laid-out lines are cached under a signature of its CONTENT (getBlockSignature), so the same
// cache entry serves the block wherever it stands - after an insert before it, after a move, or for a second identical block. The
// warnings recorded while it was laid out used to be cached as they were pushed, `blockIndex` included, and handed back as the SAME
// objects on every reuse; the editor finds the paragraph to highlight by that index (editor.mjs), so after any edit above it a warning
// pointed at the wrong paragraph, and two identical blocks shared one location. Now the cache keeps position-free copies and every reuse
// builds fresh warning objects carrying the block's CURRENT index (the other fields - kind, blockType, message, snippet, details - are
// the block's own and travel with its content).
const copyWarning = (w) => { const c = { ...w }; for (const k of Object.keys(c)) if (Array.isArray(c[k])) c[k] = c[k].slice(); return c; };
const warningsForCache = (list) => list.map((w) => { const c = copyWarning(w); delete c.blockIndex; return c; });
const warningsForBlock = (cached, bi) => cached.map((w) => ({ ...copyWarning(w), blockIndex: bi }));

// Assemble the document's body lines and TOC prelims, ready to convert to BRF or
// split into volumes. `empty` when there's nothing to format. `opts` is the
// normalised option set (clamped geometry, cleaning translate) for callers that
// build further pages (volume title pages) — never reuse the raw caller options.
function buildDocPages(doc, o) {
  o = o ? { ...o } : {};
  if (typeof o.translate !== 'function') throw new Error('formatDocument: opts.translate must be the braille translate function');
  if (typeof o.translate === 'function') {
    const rawTr = o.translate;
    o.translate = (text, typeform) => rawTr(cleanForTranslate(text), typeform);
  }
  if (typeof o.translatePos === 'function') {
    const rawTrPos = o.translatePos;
    o.translatePos = (text, typeform) => rawTrPos(cleanForTranslate(text), typeform);
  }
  if (typeof o.translateG1 === 'function') {
    const rawG1 = o.translateG1;
    o.translateG1 = (text, tf) => rawG1(cleanForTranslate(text), tf);
  }
  installScrub(o);   // an untranslatable print character never leaks a hex escape (F-213)
  if (o.spacedEllipsis || doc?.spacedEllipsis) { o.spacedEllipsis = true; applySpacedEllipsis(o); }   // spaced ellipsis (optional, default off)
  if (o.typeformWordPunct || doc?.typeformWordPunct) o.typeformWordPunct = true;   // typeform word indicator covers attached punctuation (optional, default off)
  if (o.elisionApostrophe || doc?.elisionApostrophe) { o.elisionApostrophe = true; applyElisionApostrophe(o); }   // elision apostrophe (optional, default off)
  // UK-7 (28 Sep, James / decisions.md "UKAAF"): on by DEFAULT in UKAAF now (when print pages are
  // shown at all — page.mjs's runningHead only reads it there; BANA never reads it, so the default
  // is moot for BANA). Q-17, the transcriber question this was provisional on, is now answered.
  // An explicit `false` (on either `o` or `doc`) still turns it off.
  o.pilPrintPage = (o.pilPrintPage === false || doc?.pilPrintPage === false) ? false
    : (o.pilPrintPage === true || doc?.pilPrintPage === true || (o.standard !== 'bana' && o.mode !== 'bana'));
  if (o.exhaustiveSymbols || doc?.exhaustiveSymbols) o.exhaustiveSymbols = true;   // K13: every braille symbol used, not only the ones BANA Appendix G requires (optional, default off)
  applyForeignText(doc, o);   // K16: foreign-language teaching text (BANA 1.16.3, 8.10; optional, default off)
  preassignIconSymbols(Array.isArray(doc?.blocks) ? doc.blocks : [], o);   // ICON-1: symbol slots assigned in document order before the Special Symbols page is resolved below
  o.width = Math.max(10, Math.min(60, Number(o.width) || 38));
  o.depth = Math.max(10, Math.min(45, Number(o.depth) || 25));
  const blocks0 = applyPoemMethods(resolveWordLists(resolvePageNumbers(combineEmptyPrintPages(resolveTitlePage(resolveSymPages(Array.isArray(doc?.blocks) ? doc.blocks : [], o), doc, o), o))), o);   // F-45/F-46: implied and blank-page print numbers (1.11.8d: blank and picture-only pages combined); F-227: word list moved before its exercise; K29: title page fields + sort-first (design §4)
  const en = planEndnoteSection(blocks0, o);               // IMP-W3: the end-of-book endnote section (null when there is none)
  const blocks = en ? en.blocks : blocks0;
  const enSet = en ? new Set(en.moved) : null;
  const hasPrintPages = o._forcePrintPages === true || blocks.some((b) => b && typeof b === 'object' && b.type === 'pagenum');   // _forcePrintPages: one volume's endnote section (formatVolumesFromBuild) keeps the book's page layout
  o._hasPrintPages = hasPrintPages;                      // UKAAF contents: print page column only when print pages are shown
  o._runningHead = hasBrailleTitle(doc, o) && !(o.suppressHeader || o.pageHeaders === false);   // IMP-W3: BANA 4.3.2 - a running head (the book title on line 1) is used
  const hasTitle = hasBrailleTitle(doc, o);
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  const headings = [];
  if (isBana) o.headingTiers = banaHeadingTiers(blocks); // document-wide heading tiers (Formats §4.2.1)
  const verseMax = verseRunLevels(blocks);              // poem-wide indentation (Formats §13.3.1)
  const numberedVerse = isBana ? numberedVerseRuns(blocks) : null;   // 15.5.1c
  const g1Poems = isBana ? uncontractedPoemRuns(blocks) : null;      // 13.6.4a (F-125)
  const poemRuns = isBana ? poemRunBoundaries(blocks) : null;   // poem/prose-poem blank lines (F-121, §13.3.1a/13.7.1a)
  const lineNumbers = lineNumberInfo(blocks, o);
  const lnHead = lnNoteHeadingIndex(blocks, lineNumbers.first);   // F-234: index of the heading that carries the line-number note before it (`lnNoteBeforeHeading`), else -1
  o.lineNumberWidth = lineNumbers.width;                 // the text of every numbered line ends 2 cells before the widest number
  o._boxColorsUniform = computeBoxColorsUniform(blocks);  // K7: whether the document's boxes are all the same colour
  const firstAsterism = isBana ? blocks.findIndex((b) => b && (b.type === 'break' || b.type === 'indicator') && b.kind === 'asterism' && !b.text) : -1;
  const { order, runStart } = noteLayout(blocks, isBana, en);
  const noteMarks = findNoteMarks(blocks);               // BANA 16.5.1/16.2.1: a note's own opening reference mark
  const emphCtx = emphasisContext(blocks, order, o);     // K1 contents/dedication groups, K4 multi-paragraph passages
  let content = [], contentBlock = [], contentCells = [], contentKeep = [];
  let atStart = true;
  for (const bi of order) {
    const block = blocks[bi];
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'titlepage' && !o._flowSink) continue;   // K29 Stage 1b: rendered standalone, confined to its own page — see traceTitlePage's and buildStandaloneTitlePage's own comments (the eBraille flow, flowDocument, sees it as an ordinary block)
    let fb = verseMax.has(bi) ? { ...block, maxLevel: verseMax.get(bi) } : block;   // verse line tagged with its poem's depth
    if (g1Poems && g1Poems.has(bi)) fb = { ...fb, ...g1Poems.get(bi) };                // 13.6.4a: one grade 1 passage around the whole poem
    if (numberedVerse && numberedVerse.has(bi)) fb = { ...fb, lnMargin: true };          // 15.5.1c: keep the line-number column on every line of a numbered poem
    if (bi === firstAsterism) fb = { ...fb, tdNote: true };                             // explain the symbol at first use
    if (bi === lineNumbers.first && !block.lnNoteOff && lnHead < 0) fb = { ...fb, lnNote: true };   // F-234: `lnNoteOff` on that block suppresses the automatic note                         // explain line numbers at first use (A30)
    if (runStart.has(bi)) fb = { ...fb, noteRunStart: true };                           // note separation line (§16.5.1a)
    if (enSet && enSet.has(bi)) fb = { ...fb, inEndnoteSection: true };                   // IMP-W3: 1-3 margins, no blank line before the note
    if (emphCtx.has(bi)) fb = { ...fb, ...emphCtx.get(bi) };                            // K1 / K4 (in getBlockSignature's key)
    if (block.type === 'footnote' && block.id && noteMarks.has(block.id)) fb = { ...fb, noteMark: noteMarks.get(block.id) };   // §16.5.1/16.2.1: repeat the reference mark
    if (block.type === 'table') fb = { ...fb, _facingPerPage: perPage };                 // K15: a top-level table may be set across facing pages (BANA 11.13)
    // A23 / BANA 9.4.1b: see attributionCellFor's own header comment. UKAAF has no §9.4 rule
    // (F-100/standards-map BANA 9.4.1), so its attribution keeps the old fixed placement.
    if (isBana && block.type === 'attribution') {
      const cell = attributionCellFor(content, contentBlock, blocks, block);
      if (cell !== undefined) fb = { ...fb, attribCell: cell };
    }
    o._warnCtx = { blockIndex: bi, blockType: (block.type || 'para'), snippet: blockTextSnippet(block) };   // transcription-warnings channel (Fable review #5)
    if (o._flowSink) { if (o._flowSink({ bi, block, fb, o, atStart, blocks, isBana })) atStart = false; continue; }   // eBraille export: flowDocument() takes every prepared block here and lays none of it out in pages
    let lines = null, srcs = null;
    const cacheKey = o.blockCache ? getBlockSignature(fb, o, atStart) : null;
    if (cacheKey && o.blockCache.has(cacheKey)) {
      const cached = o.blockCache.get(cacheKey);
      lines = cached.lines;
      srcs = cached.srcs;
      if (cached.warnings && cached.warnings.length) (o._warnings || (o._warnings = [])).push(...warningsForBlock(cached.warnings, bi));   // S3a #15: a cached warning is block-relative; point it at THIS block
      if (lines.length) atStart = false;
    }
    if (lines === null) {
      const _warnMark = (o._warnings || (o._warnings = [])).length;
      // A39: traceBlock is a hand-maintained mirror of formatBlock that lays out the same
      // block a second time just to carry a source-offset map alongside each line. Proven
      // (scratchpad/fix-a39: 56512 real-book comparisons across all 19 nimas_samples in
      // BANA+UKAAF, plus a synthetic sweep of every block type/branch, 0 mismatches — see
      // single_pass_layout.test.mjs) to emit byte-identical lines to formatBlock for
      // every block type, so when translatePos is on (always, in the editor) its own lines
      // ARE the formatted output — no need to also call formatBlock and throw its result
      // away. formatBlock only runs when translatePos is off, or as a fallback if traceBlock
      // itself throws (mirrors formatBlock's own per-block try/catch robustness).
      if (o.translatePos) {
        try {
          const ps0 = o._posScrubs || 0;   // scrubUndefinedPos hides the escape signature below, so it counts its replacements instead
          const tr = traceBlock(fb, o, atStart);
          const trLines = tr.map((t) => t.s);
          if ((o._posScrubs || 0) !== ps0 || trLines.some((l) => LOU_UNDEFINED_CHAR_RE.test(l))) {
            lines = null; srcs = null;   // see the LOU_UNDEFINED_CHAR_RE comment: fall through to formatBlock below
            if (o._warnCtx) o._warnCtx.__lou = undefined;   // discard the provisional traceBlock scrub count; only the formatBlock pass below is authoritative
            pushWarning(o, 'trace-fallback', 'liblouis produced an undefined-character escape here; the plain formatter was used for this block instead of the editor-linked one (braille unaffected)');
          } else {
            lines = trLines;
            // tr.keepGroups (table listed-format rows, a footnote's separator+first line —
            // §11.16j/§16.5.1a) is a non-enumerable property .map() does not carry over; it
            // drives applyPageBoundaries's page-fit decisions, so it must ride along with lines
            // exactly as formatBlock's own lines carry it (see formatListed/formatFootnote).
            if (tr.keepGroups) Object.defineProperty(lines, 'keepGroups', { value: tr.keepGroups });
            srcs = tr.map((t) => t.src);
          }
        } catch (e) { pushWarning(o, 'trace-fallback', (e && e.message) || String(e)); lines = null; srcs = null; }
      }
      // A39 stage 2 ("one layout path"): formatBlock's own 'para'/'heading'/'list'/
      // 'box' cases now route through the SAME traceBlockCore code traceBlock just used
      // (formatBlock is a projection of it) -- so a plain `formatBlock(fb, o, atStart)`
      // here would consult o.translatePos too and hit the very failure (or LOU_UNDEFINED_
      // CHAR escape) this fallback exists to route around. This fallback's whole point is
      // "use the plain, translatePos-independent formatter for this one block" (tests/
      // transcription_warnings.test.mjs's trace-fallback case), so translatePos is dropped
      // for just this call, forcing tcRun/tcJoined's no-positions branch (o.translate only).
      if (lines === null) lines = formatBlock(fb, o.translatePos ? { ...o, translatePos: undefined } : o, atStart);
      if (lines.length) atStart = false;
      if (o._warnCtx && o._warnCtx.__lou && o._warnCtx.__lou.count) {
        const agg = o._warnCtx.__lou;
        pushWarning(o, 'lou-undefined-char', `liblouis has no braille cell for ${agg.count} character${agg.count === 1 ? '' : 's'} here; shown as the full cell`, { count: agg.count, chars: Array.from(agg.chars) });
      }
      if (o.blockCache && cacheKey && (!o.translatePos || srcs !== null)) {
        o.blockCache.set(cacheKey, { lines, srcs, warnings: warningsForCache(o._warnings.slice(_warnMark)) });   // S3a #15: stored without a position (see warningsForBlock)
      }
    }
    if (bi === lnHead && lines.length) {                   // F-234: the automatic note goes before the heading that precedes the numbered text (Sample 15-9)
      const noteLines = lineNumberNote({ ...blocks[lineNumbers.first], lnNote: true }, o);
      if (noteLines.length) {
        const pad = lines[0] === '' ? [] : [''];
        lines = [...noteLines, ...pad, ...lines];
        if (srcs) srcs = [...noteLines.map(() => null), ...pad.map(() => null), ...srcs];
      }
    }
    // F-121 / §13.3.1a / §13.7.1a: a blank line before/after a poem or prose poem — added
    // here (not inside formatPlay/formatPara) because it depends on the poem's own RUN
    // boundary across sibling blocks (poemRunBoundaries), exactly like the heading-join
    // blank-line logic below depends on the two adjacent blocks, not either one alone. The
    // cell-5/cell-7 heading exception is untouched: it fires via joinsWithoutBlank, which
    // drops this same leading blank a few lines down when it applies.
    if (poemRuns && lines.length) {
      // F-240 / BANA 14.5.3d, 14.6.3d, 14.7.2: no blank line before or after a stage direction between lines of dialogue -
      // so a verse-PLAY run gets no poem blank on the side that touches a stage direction.
      const stageNeighbour = (k) => !!(block.playVerse && blocks[k] && blocks[k].type === 'stage');
      if (poemRuns.starts.has(bi) && !stageNeighbour(bi - 1)) { lines = ['', ...lines]; if (srcs) srcs = [null, ...srcs]; }
      // BANA 9.4.1: an attribution belongs to the text it follows - no blank between the poem's last line and it.
      if (poemRuns.ends.has(bi) && !stageNeighbour(bi + 1) && !(blocks[bi + 1] && blocks[bi + 1].type === 'attribution')) { lines = [...lines, '']; if (srcs) srcs = [...srcs, null]; }
    }
    // BANA 10.2.2 (F-175): "Insert a blank line between a page change indicator and the directions" that
    // follow it; with the blank the previous block left before the indicator, 1.11.3d
    // (singleBlankAroundPageChange) keeps only the one after.
    if (isBana && block.type === 'para' && block.directions && bi > 0 && blocks[bi - 1] && blocks[bi - 1].type === 'pagenum' && lines.length && lines[0] !== '') {
      lines = ['', ...lines]; if (srcs) srcs = [null, ...srcs];
    }

    const headingText = block.text || (Array.isArray(block.segments) ? block.segments.map(s => (s && s.text) || '').join('') : '');   // A64: a malformed block must not stop the whole document
    if (o.toc && block && block.type === 'heading' && String(headingText ?? '').trim()) {
      headings.push({ text: String(headingText), level: block.level || 1, bi });
    }
    // An attribution belongs to the displayed material it follows (Formats §9.4.1, Sample
    // 9-6: the attribution sits directly under the quote's last line and the blank line
    // comes after it) — drop the trailing blank the quote paragraph emitted before it.
    if (block.type === 'attribution' && lines.length && content.length && content[content.length - 1] === '' && quoteMargins(blocks[bi - 1], o)) {
      content.pop(); contentBlock.pop(); contentCells.pop(); contentKeep.pop();
    }
    // Blank-line joins after a heading (Formats §4.3.3, §4.5.3, §4.5.7, §4.6.2, §8.3.3a,
    // §13.3.1a — see joinsWithoutBlank): drop the heading's trailing blank line and
    // this block's leading blank line(s) so the two stand on adjacent lines.
    let li0 = 0;
    if (lines.length && content.length && joinsWithoutBlank(blocks[contentBlock[contentBlock.length - 1]], block, o, { before: blocks[contentBlock[contentBlock.length - 1] - 1], after: blocks[bi + 1] })) {
      const pbi = contentBlock[contentBlock.length - 1];
      while (content.length && content[content.length - 1] === '' && contentBlock[contentBlock.length - 1] === pbi) {
        content.pop(); contentBlock.pop(); contentCells.pop(); contentKeep.pop();
      }
      while (li0 < lines.length && lines[li0] === '') li0++;
    }
    const keepOf = keepGroupIndex(lines);
    const pushStart = content.length;
    for (let li = li0; li < lines.length; li++) {
      if (lines[li] === '' && content.length && content[content.length - 1] === '') continue;
      content.push(lines[li]); contentBlock.push(bi); contentCells.push(srcs ? srcs[li] : null);
      contentKeep.push(keepOf && keepOf[li] != null ? `${bi}:${keepOf[li]}` : null);
    }
    // A23 / BANA 9.4.1a — see markAttributionKeepGroup's own header comment.
    if (isBana && block.type === 'attribution') markAttributionKeepGroup(content, contentKeep, bi, pushStart);
  }
  if (o._flowSink) return { flow: true, opts: o, blocks };   // eBraille export: the sink has seen every block; there are no pages to build
  // UK-6 (28 Sep, James / decisions.md "UKAAF"): a colons end marker as the LAST line of the whole
  // document — on by default (`o.docEndMarker`; an explicit `false` turns it off, field-registry.mjs).
  // Pushed here, at the true end of `content` before pagination/volume-splitting, so in a multi-volume
  // book (formatVolumes/formatVolumesFromBuild slice the already-paginated pages into volumes AFTER
  // this point) it always lands on the last page of the LAST volume, never repeated per volume. UK-5:
  // no blank line before it (consistent with every other UKAAF join).
  if (!isBana && o.docEndMarker !== false && content.length) {
    content.push(indicatorLine('colons', o.width || 38)); contentBlock.push(-1); contentCells.push(null); contentKeep.push(null);
  }
  const preLen = content.length;
  trimLeadingBlank(content);
  const shift = preLen - content.length;
  if (shift) { contentBlock.splice(0, shift); contentCells.splice(0, shift); contentKeep.splice(0, shift); }
  if (!content.length) return { empty: true, opts: o };
  if (isBana) ({ content, contentBlock, contentCells, contentKeep } = singleBlankAroundPageChange(content, contentBlock, contentCells, blocks, contentKeep));
  const hasTP = blocks.some((b) => b && typeof b === 'object' && b.type === 'titlepage');   // K29 Stage 1b
  // UK-9 follow-up (this brief): the title page (1) and, for UKAAF, its accessible-copy notice page (2,
  // always present — assembleTitleAndNotice's own comment) claim braille pages 1-2 first, so the body's
  // own Arabic sequence must continue from 3, not restart at 1 (shiftUkBodyPages, applied at every final-
  // assembly call site: formatDocument/Async and formatVolumesFromBuild's single- and multi-volume
  // paths). BANA is unaffected (0): its title page is t1 in the separate transcriber series (2.2.1b),
  // and the body starts at 1 — BANA's own rule.
  const ukTitleOffset = (!isBana && hasTP) ? 2 : 0;
  const pageOne = bookTitleLines(doc, o, isBana, hideHeader, hasTP);
  if (pageOne.rest.length) {
    content.unshift(...pageOne.rest); contentBlock.unshift(...pageOne.rest.map(() => TITLE_LINE));
    contentCells.unshift(...pageOne.rest.map(() => null)); contentKeep.unshift(...pageOne.rest.map(() => null));
  }
  // assemble()'s options: applyPageBoundaries plans the pages with the same line-1 rule assemble applies (banaLineOne).
  const asm = {
    title: docBrailleTitle(doc, o), width: o.width, depth: o.depth, mode: isBana ? 'bana' : 'ukaaf', translate: foreignTitleTranslate(doc, o), pageOneTitle: pageOne.first,   // K16 / BANA 1.16.4: the running head may be foreign
    suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders, hasPrintPages, pilPrintPage: o.pilPrintPage,
    interpointOmitEven: o.interpointOmitEven, runningHeadKeyWords: doc?.runningHeadKeyWords,   // F-64 (BANA 1.15.1f), F-61 (BANA 1.8.2e): both optional, default off
  };
  let contentNote, pagePlan;
  ({ content, contentBlock, contentCells, contentNote, pagePlan } = applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana, contentKeep, o, asm));
  if (o.trace && typeof o.trace === 'object') o.trace.pagePlan = { pages: pagePlan, lines: content };   // the planned pages (tests check them against assemble's)
  const bodyPages = assemble(content, { ...asm, lineNotes: contentNote });
  if (en && isBana && hasPrintPages && !hideHeader) clearEndnotePrintPages(bodyPages, content, contentBlock, pagePlan, en, asm, o);   // IMP-W3: BANA 16.9.3d
  applyGuideWords(bodyPages, content, contentBlock, blocks, pagePlan, o, doc);   // K12 / BANA 21.3.2: guide words on line 25 (no line counts change)
  const tSeries = applyTranscriberPageSeries(bodyPages, content, contentBlock, blocks, pagePlan, o, hasTP ? 1 : 0);   // BANA 2.2.1b (null for ordinary books); K29: t1 reserved for the standalone title page
  let tocPages = [];
  if (o.toc && headings.length) {
    // The page each heading's text is really on: its first nonblank line (a heading carried to the next page by breakPage
    // leaves its leading blank line behind, with padding after it), located with the page plan (not line / perPage).
    const { pageOf } = planPages(pagePlan, content.length);
    const firstLine = new Map();
    content.forEach((l, k) => { if (l !== '' && !firstLine.has(contentBlock[k])) firstLine.set(contentBlock[k], k); });
    for (const h of headings) {
      const line = firstLine.has(h.bi) ? firstLine.get(h.bi) : contentBlock.indexOf(h.bi);
      h.line = Math.max(0, line);
      h.page = headingBraillePage(h.line, pageOf, tSeries, ukTitleOffset);   // UK-9 follow-up: the TOC cites the body's own (now possibly shifted) page numbers
    }
    tocPages = buildToc(headings, o);
  }
  const titlePagePages = hasTP ? buildStandaloneTitlePage(blocks, o, tSeries ? tSeries.kinds : null, tocPages, content, contentBlock, tSeries ? tSeries.pages.length : bodyPages.length) : null;   // K29 Stage 1b — null for every document without a titlepage block; UK-9: an array of 1+ standalone pages
  return { empty: false, content, contentBlock, contentCells, headings, tocPages, bodyPages: tSeries ? tSeries.pages : bodyPages, pageKinds: tSeries ? tSeries.kinds : null, hasPrintPages, hasTitle, perPage, pagePlan, blocks, opts: o, alphaMerged: bodyPages.alphaMerged, titlePagePages, ukTitleOffset, bodyNumber: tSeries ? tSeries.bodyNumber : null, endnotes: en ? { headIdx: en.headIdx, moved: en.moved } : null };
}

// Let the page repaint between chunks of a long format (A37). A MessageChannel task is not
// subject to Chrome's background-tab timer throttling, which stretched each setTimeout(0)
// here to ~340 ms (later up to a minute) whenever the tab was hidden: a large textbook took
// minutes to load in the background instead of ~5 s.
function yieldToEventLoop() {
  if (typeof MessageChannel !== 'function') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); r(); };
    ch.port2.postMessage(0);
  });
}

async function buildDocPagesAsync(doc, o) {
  o = o ? { ...o } : {};
  if (typeof o.translate !== 'function') throw new Error('formatDocument: opts.translate must be the braille translate function');
  if (typeof o.translate === 'function') {
    const rawTr = o.translate;
    o.translate = (text, typeform) => rawTr(cleanForTranslate(text), typeform);
  }
  if (typeof o.translatePos === 'function') {
    const rawTrPos = o.translatePos;
    o.translatePos = (text, typeform) => rawTrPos(cleanForTranslate(text), typeform);
  }
  if (typeof o.translateG1 === 'function') {
    const rawG1 = o.translateG1;
    o.translateG1 = (text, tf) => rawG1(cleanForTranslate(text), tf);
  }
  installScrub(o);   // an untranslatable print character never leaks a hex escape (F-213)
  if (o.spacedEllipsis || doc?.spacedEllipsis) { o.spacedEllipsis = true; applySpacedEllipsis(o); }   // spaced ellipsis (optional, default off)
  if (o.typeformWordPunct || doc?.typeformWordPunct) o.typeformWordPunct = true;   // typeform word indicator covers attached punctuation (optional, default off)
  if (o.elisionApostrophe || doc?.elisionApostrophe) { o.elisionApostrophe = true; applyElisionApostrophe(o); }   // elision apostrophe (optional, default off)
  // UK-7 (28 Sep, James / decisions.md "UKAAF"): on by DEFAULT in UKAAF now (when print pages are
  // shown at all — page.mjs's runningHead only reads it there; BANA never reads it, so the default
  // is moot for BANA). Q-17, the transcriber question this was provisional on, is now answered.
  // An explicit `false` (on either `o` or `doc`) still turns it off.
  o.pilPrintPage = (o.pilPrintPage === false || doc?.pilPrintPage === false) ? false
    : (o.pilPrintPage === true || doc?.pilPrintPage === true || (o.standard !== 'bana' && o.mode !== 'bana'));
  if (o.exhaustiveSymbols || doc?.exhaustiveSymbols) o.exhaustiveSymbols = true;   // K13: every braille symbol used, not only the ones BANA Appendix G requires (optional, default off)
  applyForeignText(doc, o);   // K16: foreign-language teaching text (BANA 1.16.3, 8.10; optional, default off)
  preassignIconSymbols(Array.isArray(doc?.blocks) ? doc.blocks : [], o);   // ICON-1: symbol slots assigned in document order before the Special Symbols page is resolved below
  o.width = Math.max(10, Math.min(60, Number(o.width) || 38));
  o.depth = Math.max(10, Math.min(45, Number(o.depth) || 25));
  const blocks0 = applyPoemMethods(resolveWordLists(resolvePageNumbers(combineEmptyPrintPages(resolveTitlePage(resolveSymPages(Array.isArray(doc?.blocks) ? doc.blocks : [], o), doc, o), o))), o);   // F-45/F-46: implied and blank-page print numbers (1.11.8d: blank and picture-only pages combined); F-227: word list moved before its exercise; K29: title page fields + sort-first (design §4)
  const en = planEndnoteSection(blocks0, o);               // IMP-W3: the end-of-book endnote section (null when there is none)
  const blocks = en ? en.blocks : blocks0;
  const enSet = en ? new Set(en.moved) : null;
  const hasPrintPages = o._forcePrintPages === true || blocks.some((b) => b && typeof b === 'object' && b.type === 'pagenum');   // _forcePrintPages: one volume's endnote section (formatVolumesFromBuild) keeps the book's page layout
  o._hasPrintPages = hasPrintPages;                      // UKAAF contents: print page column only when print pages are shown
  o._runningHead = hasBrailleTitle(doc, o) && !(o.suppressHeader || o.pageHeaders === false);   // IMP-W3: BANA 4.3.2 - a running head (the book title on line 1) is used
  const hasTitle = hasBrailleTitle(doc, o);
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  const headings = [];
  if (isBana) o.headingTiers = banaHeadingTiers(blocks); // document-wide heading tiers (Formats §4.2.1)
  const verseMax = verseRunLevels(blocks);              // poem-wide indentation (Formats §13.3.1)
  const numberedVerse = isBana ? numberedVerseRuns(blocks) : null;   // 15.5.1c
  const g1Poems = isBana ? uncontractedPoemRuns(blocks) : null;      // 13.6.4a (F-125)
  const poemRuns = isBana ? poemRunBoundaries(blocks) : null;   // poem/prose-poem blank lines (F-121, §13.3.1a/13.7.1a)
  const lineNumbers = lineNumberInfo(blocks, o);
  const lnHead = lnNoteHeadingIndex(blocks, lineNumbers.first);   // F-234: index of the heading that carries the line-number note before it (`lnNoteBeforeHeading`), else -1
  o.lineNumberWidth = lineNumbers.width;                 // the text of every numbered line ends 2 cells before the widest number
  o._boxColorsUniform = computeBoxColorsUniform(blocks);  // K7: whether the document's boxes are all the same colour
  const firstAsterism = isBana ? blocks.findIndex((b) => b && (b.type === 'break' || b.type === 'indicator') && b.kind === 'asterism' && !b.text) : -1;
  const { order, runStart } = noteLayout(blocks, isBana, en);
  const noteMarks = findNoteMarks(blocks);               // BANA 16.5.1/16.2.1: a note's own opening reference mark
  const emphCtx = emphasisContext(blocks, order, o);     // K1 contents/dedication groups, K4 multi-paragraph passages
  let content = [], contentBlock = [], contentCells = [], contentKeep = [];
  let atStart = true;
  for (let oi = 0; oi < order.length; oi++) {
    const bi = order[oi];
    if (oi > 0 && oi % 150 === 0) {
      if (typeof o.onProgress === 'function') {
        o.onProgress(bi, blocks.length);
      }
      await yieldToEventLoop();
    }
    const block = blocks[bi];
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'titlepage') continue;   // K29 Stage 1b: rendered standalone, confined to its own page — see traceTitlePage's and buildStandaloneTitlePage's own comments
    let fb = verseMax.has(bi) ? { ...block, maxLevel: verseMax.get(bi) } : block;   // verse line tagged with its poem's depth
    if (g1Poems && g1Poems.has(bi)) fb = { ...fb, ...g1Poems.get(bi) };                // 13.6.4a: one grade 1 passage around the whole poem
    if (numberedVerse && numberedVerse.has(bi)) fb = { ...fb, lnMargin: true };          // 15.5.1c: keep the line-number column on every line of a numbered poem
    if (bi === firstAsterism) fb = { ...fb, tdNote: true };                             // explain the symbol at first use
    if (bi === lineNumbers.first && !block.lnNoteOff && lnHead < 0) fb = { ...fb, lnNote: true };   // F-234: `lnNoteOff` on that block suppresses the automatic note                         // explain line numbers at first use (A30)
    if (runStart.has(bi)) fb = { ...fb, noteRunStart: true };                           // note separation line (§16.5.1a)
    if (enSet && enSet.has(bi)) fb = { ...fb, inEndnoteSection: true };                   // IMP-W3: 1-3 margins, no blank line before the note
    if (emphCtx.has(bi)) fb = { ...fb, ...emphCtx.get(bi) };                            // K1 / K4 (in getBlockSignature's key)
    if (block.type === 'footnote' && block.id && noteMarks.has(block.id)) fb = { ...fb, noteMark: noteMarks.get(block.id) };   // §16.5.1/16.2.1: repeat the reference mark
    if (block.type === 'table') fb = { ...fb, _facingPerPage: perPage };                 // K15: a top-level table may be set across facing pages (BANA 11.13)
    // A23 / BANA 9.4.1b — see buildDocPages's identical comment.
    if (isBana && block.type === 'attribution') {
      const cell = attributionCellFor(content, contentBlock, blocks, block);
      if (cell !== undefined) fb = { ...fb, attribCell: cell };
    }
    o._warnCtx = { blockIndex: bi, blockType: (block.type || 'para'), snippet: blockTextSnippet(block) };   // transcription-warnings channel (Fable review #5)
    let lines = null, srcs = null;
    const cacheKey = o.blockCache ? getBlockSignature(fb, o, atStart) : null;
    if (cacheKey && o.blockCache.has(cacheKey)) {
      const cached = o.blockCache.get(cacheKey);
      lines = cached.lines;
      srcs = cached.srcs;
      if (cached.warnings && cached.warnings.length) (o._warnings || (o._warnings = [])).push(...warningsForBlock(cached.warnings, bi));   // S3a #15: a cached warning is block-relative; point it at THIS block
      if (lines.length) atStart = false;
    }
    if (lines === null) {
      const _warnMark = (o._warnings || (o._warnings = [])).length;
      // A39: traceBlock is a hand-maintained mirror of formatBlock that lays out the same
      // block a second time just to carry a source-offset map alongside each line. Proven
      // (scratchpad/fix-a39: 56512 real-book comparisons across all 19 nimas_samples in
      // BANA+UKAAF, plus a synthetic sweep of every block type/branch, 0 mismatches — see
      // single_pass_layout.test.mjs) to emit byte-identical lines to formatBlock for
      // every block type, so when translatePos is on (always, in the editor) its own lines
      // ARE the formatted output — no need to also call formatBlock and throw its result
      // away. formatBlock only runs when translatePos is off, or as a fallback if traceBlock
      // itself throws (mirrors formatBlock's own per-block try/catch robustness).
      if (o.translatePos) {
        try {
          const ps0 = o._posScrubs || 0;   // scrubUndefinedPos hides the escape signature below, so it counts its replacements instead
          const tr = traceBlock(fb, o, atStart);
          const trLines = tr.map((t) => t.s);
          if ((o._posScrubs || 0) !== ps0 || trLines.some((l) => LOU_UNDEFINED_CHAR_RE.test(l))) {
            lines = null; srcs = null;   // see the LOU_UNDEFINED_CHAR_RE comment: fall through to formatBlock below
            if (o._warnCtx) o._warnCtx.__lou = undefined;   // discard the provisional traceBlock scrub count; only the formatBlock pass below is authoritative
            pushWarning(o, 'trace-fallback', 'liblouis produced an undefined-character escape here; the plain formatter was used for this block instead of the editor-linked one (braille unaffected)');
          } else {
            lines = trLines;
            // tr.keepGroups (table listed-format rows, a footnote's separator+first line —
            // §11.16j/§16.5.1a) is a non-enumerable property .map() does not carry over; it
            // drives applyPageBoundaries's page-fit decisions, so it must ride along with lines
            // exactly as formatBlock's own lines carry it (see formatListed/formatFootnote).
            if (tr.keepGroups) Object.defineProperty(lines, 'keepGroups', { value: tr.keepGroups });
            srcs = tr.map((t) => t.src);
          }
        } catch (e) { pushWarning(o, 'trace-fallback', (e && e.message) || String(e)); lines = null; srcs = null; }
      }
      // A39 stage 2 ("one layout path"): formatBlock's own 'para'/'heading'/'list'/
      // 'box' cases now route through the SAME traceBlockCore code traceBlock just used
      // (formatBlock is a projection of it) -- so a plain `formatBlock(fb, o, atStart)`
      // here would consult o.translatePos too and hit the very failure (or LOU_UNDEFINED_
      // CHAR escape) this fallback exists to route around. This fallback's whole point is
      // "use the plain, translatePos-independent formatter for this one block" (tests/
      // transcription_warnings.test.mjs's trace-fallback case), so translatePos is dropped
      // for just this call, forcing tcRun/tcJoined's no-positions branch (o.translate only).
      if (lines === null) lines = formatBlock(fb, o.translatePos ? { ...o, translatePos: undefined } : o, atStart);
      if (lines.length) atStart = false;
      if (o._warnCtx && o._warnCtx.__lou && o._warnCtx.__lou.count) {
        const agg = o._warnCtx.__lou;
        pushWarning(o, 'lou-undefined-char', `liblouis has no braille cell for ${agg.count} character${agg.count === 1 ? '' : 's'} here; shown as the full cell`, { count: agg.count, chars: Array.from(agg.chars) });
      }
      if (o.blockCache && cacheKey && (!o.translatePos || srcs !== null)) {
        o.blockCache.set(cacheKey, { lines, srcs, warnings: warningsForCache(o._warnings.slice(_warnMark)) });   // S3a #15: stored without a position (see warningsForBlock)
      }
    }
    if (bi === lnHead && lines.length) {                   // F-234: the automatic note goes before the heading that precedes the numbered text (Sample 15-9)
      const noteLines = lineNumberNote({ ...blocks[lineNumbers.first], lnNote: true }, o);
      if (noteLines.length) {
        const pad = lines[0] === '' ? [] : [''];
        lines = [...noteLines, ...pad, ...lines];
        if (srcs) srcs = [...noteLines.map(() => null), ...pad.map(() => null), ...srcs];
      }
    }
    // F-121 / §13.3.1a / §13.7.1a — see buildDocPages's identical comment.
    if (poemRuns && lines.length) {
      // F-240 / BANA 14.5.3d, 14.6.3d, 14.7.2: no blank line before or after a stage direction between lines of dialogue -
      // so a verse-PLAY run gets no poem blank on the side that touches a stage direction.
      const stageNeighbour = (k) => !!(block.playVerse && blocks[k] && blocks[k].type === 'stage');
      if (poemRuns.starts.has(bi) && !stageNeighbour(bi - 1)) { lines = ['', ...lines]; if (srcs) srcs = [null, ...srcs]; }
      // BANA 9.4.1: an attribution belongs to the text it follows - no blank between the poem's last line and it.
      if (poemRuns.ends.has(bi) && !stageNeighbour(bi + 1) && !(blocks[bi + 1] && blocks[bi + 1].type === 'attribution')) { lines = [...lines, '']; if (srcs) srcs = [...srcs, null]; }
    }
    // BANA 10.2.2 (F-175): "Insert a blank line between a page change indicator and the directions" that
    // follow it; with the blank the previous block left before the indicator, 1.11.3d
    // (singleBlankAroundPageChange) keeps only the one after.
    if (isBana && block.type === 'para' && block.directions && bi > 0 && blocks[bi - 1] && blocks[bi - 1].type === 'pagenum' && lines.length && lines[0] !== '') {
      lines = ['', ...lines]; if (srcs) srcs = [null, ...srcs];
    }

    const headingText = block.text || (Array.isArray(block.segments) ? block.segments.map(s => (s && s.text) || '').join('') : '');   // A64: a malformed block must not stop the whole document
    if (o.toc && block && block.type === 'heading' && String(headingText ?? '').trim()) {
      headings.push({ text: String(headingText), level: block.level || 1, bi });
    }
    // An attribution belongs to the displayed material it follows (Formats §9.4.1, Sample
    // 9-6: the attribution sits directly under the quote's last line and the blank line
    // comes after it) — drop the trailing blank the quote paragraph emitted before it.
    if (block.type === 'attribution' && lines.length && content.length && content[content.length - 1] === '' && quoteMargins(blocks[bi - 1], o)) {
      content.pop(); contentBlock.pop(); contentCells.pop(); contentKeep.pop();
    }
    // Blank-line joins after a heading (Formats §4.3.3, §4.5.3, §4.5.7, §4.6.2, §8.3.3a,
    // §13.3.1a — see joinsWithoutBlank): drop the heading's trailing blank line and
    // this block's leading blank line(s) so the two stand on adjacent lines.
    let li0 = 0;
    if (lines.length && content.length && joinsWithoutBlank(blocks[contentBlock[contentBlock.length - 1]], block, o, { before: blocks[contentBlock[contentBlock.length - 1] - 1], after: blocks[bi + 1] })) {
      const pbi = contentBlock[contentBlock.length - 1];
      while (content.length && content[content.length - 1] === '' && contentBlock[contentBlock.length - 1] === pbi) {
        content.pop(); contentBlock.pop(); contentCells.pop(); contentKeep.pop();
      }
      while (li0 < lines.length && lines[li0] === '') li0++;
    }
    const keepOf = keepGroupIndex(lines);
    const pushStart = content.length;
    for (let li = li0; li < lines.length; li++) {
      if (lines[li] === '' && content.length && content[content.length - 1] === '') continue;
      content.push(lines[li]); contentBlock.push(bi); contentCells.push(srcs ? srcs[li] : null);
      contentKeep.push(keepOf && keepOf[li] != null ? `${bi}:${keepOf[li]}` : null);
    }
    // A23 / BANA 9.4.1a — see markAttributionKeepGroup's own header comment.
    if (isBana && block.type === 'attribution') markAttributionKeepGroup(content, contentKeep, bi, pushStart);
  }
  // UK-6 (28 Sep, James / decisions.md "UKAAF"): a colons end marker as the LAST line of the whole
  // document — on by default (`o.docEndMarker`; an explicit `false` turns it off, field-registry.mjs).
  // Pushed here, at the true end of `content` before pagination/volume-splitting, so in a multi-volume
  // book (formatVolumes/formatVolumesFromBuild slice the already-paginated pages into volumes AFTER
  // this point) it always lands on the last page of the LAST volume, never repeated per volume. UK-5:
  // no blank line before it (consistent with every other UKAAF join).
  if (!isBana && o.docEndMarker !== false && content.length) {
    content.push(indicatorLine('colons', o.width || 38)); contentBlock.push(-1); contentCells.push(null); contentKeep.push(null);
  }
  const preLen = content.length;
  trimLeadingBlank(content);
  const shift = preLen - content.length;
  if (shift) { contentBlock.splice(0, shift); contentCells.splice(0, shift); contentKeep.splice(0, shift); }
  if (!content.length) return { empty: true, opts: o };
  if (isBana) ({ content, contentBlock, contentCells, contentKeep } = singleBlankAroundPageChange(content, contentBlock, contentCells, blocks, contentKeep));
  const hasTP = blocks.some((b) => b && typeof b === 'object' && b.type === 'titlepage');   // K29 Stage 1b
  // UK-9 follow-up (this brief): the title page (1) and, for UKAAF, its accessible-copy notice page (2,
  // always present — assembleTitleAndNotice's own comment) claim braille pages 1-2 first, so the body's
  // own Arabic sequence must continue from 3, not restart at 1 (shiftUkBodyPages, applied at every final-
  // assembly call site: formatDocument/Async and formatVolumesFromBuild's single- and multi-volume
  // paths). BANA is unaffected (0): its title page is t1 in the separate transcriber series (2.2.1b),
  // and the body starts at 1 — BANA's own rule.
  const ukTitleOffset = (!isBana && hasTP) ? 2 : 0;
  const pageOne = bookTitleLines(doc, o, isBana, hideHeader, hasTP);
  if (pageOne.rest.length) {
    content.unshift(...pageOne.rest); contentBlock.unshift(...pageOne.rest.map(() => TITLE_LINE));
    contentCells.unshift(...pageOne.rest.map(() => null)); contentKeep.unshift(...pageOne.rest.map(() => null));
  }
  // assemble()'s options: applyPageBoundaries plans the pages with the same line-1 rule assemble applies (banaLineOne).
  const asm = {
    title: docBrailleTitle(doc, o), width: o.width, depth: o.depth, mode: isBana ? 'bana' : 'ukaaf', translate: foreignTitleTranslate(doc, o), pageOneTitle: pageOne.first,   // K16 / BANA 1.16.4: the running head may be foreign
    suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders, hasPrintPages, pilPrintPage: o.pilPrintPage,
    interpointOmitEven: o.interpointOmitEven, runningHeadKeyWords: doc?.runningHeadKeyWords,   // F-64 (BANA 1.15.1f), F-61 (BANA 1.8.2e): both optional, default off
  };
  let contentNote, pagePlan;
  ({ content, contentBlock, contentCells, contentNote, pagePlan } = applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana, contentKeep, o, asm));
  if (o.trace && typeof o.trace === 'object') o.trace.pagePlan = { pages: pagePlan, lines: content };   // the planned pages (tests check them against assemble's)
  const bodyPages = assemble(content, { ...asm, lineNotes: contentNote });
  if (en && isBana && hasPrintPages && !hideHeader) clearEndnotePrintPages(bodyPages, content, contentBlock, pagePlan, en, asm, o);   // IMP-W3: BANA 16.9.3d
  applyGuideWords(bodyPages, content, contentBlock, blocks, pagePlan, o, doc);   // K12 / BANA 21.3.2: guide words on line 25 (no line counts change)
  const tSeries = applyTranscriberPageSeries(bodyPages, content, contentBlock, blocks, pagePlan, o, hasTP ? 1 : 0);   // BANA 2.2.1b (null for ordinary books); K29: t1 reserved for the standalone title page
  let tocPages = [];
  if (o.toc && headings.length) {
    // The page each heading's text is really on: its first nonblank line (a heading carried to the next page by breakPage
    // leaves its leading blank line behind, with padding after it), located with the page plan (not line / perPage).
    const { pageOf } = planPages(pagePlan, content.length);
    const firstLine = new Map();
    content.forEach((l, k) => { if (l !== '' && !firstLine.has(contentBlock[k])) firstLine.set(contentBlock[k], k); });
    for (const h of headings) {
      const line = firstLine.has(h.bi) ? firstLine.get(h.bi) : contentBlock.indexOf(h.bi);
      h.line = Math.max(0, line);
      h.page = headingBraillePage(h.line, pageOf, tSeries, ukTitleOffset);   // UK-9 follow-up: the TOC cites the body's own (now possibly shifted) page numbers
    }
    tocPages = buildToc(headings, o);
  }
  const titlePagePages = hasTP ? buildStandaloneTitlePage(blocks, o, tSeries ? tSeries.kinds : null, tocPages, content, contentBlock, tSeries ? tSeries.pages.length : bodyPages.length) : null;   // K29 Stage 1b — null for every document without a titlepage block; UK-9: an array of 1+ standalone pages
  return { empty: false, content, contentBlock, contentCells, headings, tocPages, bodyPages: tSeries ? tSeries.pages : bodyPages, pageKinds: tSeries ? tSeries.kinds : null, hasPrintPages, hasTitle, perPage, pagePlan, blocks, opts: o, alphaMerged: bodyPages.alphaMerged, titlePagePages, ukTitleOffset, bodyNumber: tSeries ? tSeries.bodyNumber : null, endnotes: en ? { headIdx: en.headIdx, moved: en.moved } : null };
}

// BANA Formats §1.8.1: the complete book title, in print capitalization, centred on line 1
// of braille page 1 "and other lines as necessary", followed by a blank line. `first` goes on
// line 1 (assemble); `rest` (further title lines and the blank line) opens the body.
const TITLE_LINE = -2;                                     // contentBlock marker: page-1 title lines (kept, then -1)
// F9 item E2a (Paul, 9 Oct 2026): `titleInBraille: false` (the editor with its Title field hidden; Quick Mode without Transcriber tools)
// means the document's title is not ADDED to the braille: not the BANA title on page 1's first line, not the running heads (BANA's and
// UKAAF's), and the page furniture that goes with a title (the extra head line) goes too. The document's own text, a Title Page the
// transcriber inserted, and the title as document metadata (a NIMAS save, a PEF/eBraille name) are unchanged. Default (option absent or
// anything but false) = as before.
const docBrailleTitle = (doc, o) => (o && o.titleInBraille === false ? null : (doc?.title ?? null));
const hasBrailleTitle = (doc, o) => { const t = docBrailleTitle(doc, o); return !!(t && String(t).trim()); };
function bookTitleLines(doc, o, isBana, hideHeader, suppress = false) {
  // K29 Stage 1b: a document with a `titlepage` block shows the title there (BANA 2.3.3a's own Title
  // segment) — this generic "book title on page 1" mechanism (Formats §1.8.1) would otherwise duplicate
  // it right before the title page block, and centred rather than in the title page's own 1-3 margins.
  if (suppress) return { first: null, rest: [] };
  const title = docBrailleTitle(doc, o) != null ? String(docBrailleTitle(doc, o)).trim() : '';
  if (!isBana || hideHeader || !title || typeof o.translate !== 'function') return { first: null, rest: [] };
  const w = o.width || 40;
  const lines = wrapCells(foreignTitleTranslate(doc, o)(title).trim(), Math.max(10, w - 10), 0, 0).map((l) => l.trim()).filter(Boolean);   // K16 / BANA 1.16.4: the page-1 title may be foreign
  if (!lines.length) return { first: null, rest: [] };
  const rest = lines.slice(1).map((l) => centred(l, w).replace(/\s+$/, ''));
  rest.push('');                                            // §1.8.1e blank line after the title
  return { first: lines[0], rest };
}

// UKAAF contents lists need each entry's braille page (B004 H): a first pass paginates the
// document (the contents columns have a fixed width, so the second pass lays out the same
// lines), then each heading's braille page is looked up by its text.
const needsTocPages = (doc, o) => !isBanaOpts(o || {}) && (doc?.blocks || []).some((b) => b && b.type === 'list' && b.kind === 'toc' && (b.items || []).some((it) => it && it.page));
function tocPageMap(b) {
  const map = new Map();
  if (!b || b.empty) return map;
  const seen = new Set();
  const { pageOf } = planPages(b.pagePlan, b.content.length);   // the page the heading is really on (not line / perPage)
  const tSeries = b.bodyNumber ? { bodyNumber: b.bodyNumber } : null;   // the build's transcriber-page series, when it has one
  b.contentBlock.forEach((bi, line) => {
    if (seen.has(bi) || b.content[line] === '') return;
    const blk = b.blocks[bi];
    if (!blk || blk.type !== 'heading') return;
    seen.add(bi);
    const text = blk.text || (blk.segments ? blk.segments.map((g) => g.text || '').join('') : '');
    const key = tocKey(text);
    if (key && !map.has(key)) map.set(key, headingBraillePage(line, pageOf, tSeries, b.ukTitleOffset));   // S3a #14: the same resolver as the automatic contents
  });
  return map;
}
const withTocPages = (o, map) => ({ ...o, tocBrlPages: map, tocBrlPagesKey: JSON.stringify([...map]) });
function buildDocPagesFull(doc, o) {
  if (!needsTocPages(doc, o)) return buildDocPages(doc, o);
  return buildDocPages(doc, withTocPages(o, tocPageMap(buildDocPages(doc, withTocPages(o, new Map())))));
}
async function buildDocPagesFullAsync(doc, o) {
  if (!needsTocPages(doc, o)) return buildDocPagesAsync(doc, o);
  return buildDocPagesAsync(doc, withTocPages(o, tocPageMap(await buildDocPagesAsync(doc, withTocPages(o, new Map())))));
}

function formatDocument(doc, o) {
  const b = buildDocPagesFull(doc, o);
  if (b.empty) return '';
  if (b.opts && b.opts.untranslatable) o.untranslatable = b.opts.untranslatable;   // F-213: the distinct untranslatable print characters, for a Special Symbols page / warning
  o.warnings = (b.opts && b.opts._warnings) || [];   // transcription-warnings channel (Fable review #5) — never affects the braille above
  if (o.trace) { const t = traceRows(b.content, b.contentBlock, b.contentCells, b.tocPages, b.opts, b.hasPrintPages, b.hasTitle, b.alphaMerged); o.trace.rows = t.rows; o.trace.rowCells = t.rowCells; }
  const finalBodyPages = shiftUkBodyPages(b.bodyPages, b.pageKinds, b.ukTitleOffset, b.opts);   // UK-9 follow-up: continuous Arabic numbering after a UKAAF title page (+ notice) — see shiftUkBodyPages' own comment
  return toBRF([...(b.titlePagePages || []), ...b.tocPages, ...finalBodyPages]);   // K29 Stage 1b: the title page (when present) is rendered standalone, outside b.bodyPages — see buildStandaloneTitlePage; UK-9: possibly 2 pages
}

async function formatDocumentAsync(doc, o) {
  const b = await buildDocPagesFullAsync(doc, o);
  if (b.empty) return '';
  if (b.opts && b.opts.untranslatable) o.untranslatable = b.opts.untranslatable;   // F-213: the distinct untranslatable print characters, for a Special Symbols page / warning
  o.warnings = (b.opts && b.opts._warnings) || [];   // transcription-warnings channel (Fable review #5) — never affects the braille above
  if (o.trace) { const t = traceRows(b.content, b.contentBlock, b.contentCells, b.tocPages, b.opts, b.hasPrintPages, b.hasTitle, b.alphaMerged); o.trace.rows = t.rows; o.trace.rowCells = t.rowCells; }
  const finalBodyPages = shiftUkBodyPages(b.bodyPages, b.pageKinds, b.ukTitleOffset, b.opts);   // UK-9 follow-up
  return toBRF([...(b.titlePagePages || []), ...b.tocPages, ...finalBodyPages]);
}

// Print a braille page with a centered title, a volume number, and border rows
// top and bottom. Standard UK/US library prelim layout.
function volumeTitlePage(vol, of, title, o) {
  const w = o.width, depth = o.depth;
  const tr = (s) => o.translate(s);
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  if (isBana) {
    const border = '='.repeat(w);
    // F-57 / BANA 1.15.1, 2.2.1b: a transcriber-generated page carries a t-prefixed braille page number,
    // bottom right (line 25) like every BANA page. It is the first page of the volume, so t1. With page
    // furniture suppressed no page carries a number, so none is added.
    const numbered = !(o.suppressHeader || o.pageHeaders === false);
    const reserve = numbered ? 1 : 0;
    const lines = [border, ''];
    if (title) { for (const l of centredBlock(tr(title), w)) lines.push(l.replace(/\s+$/, '')); lines.push(''); }
    for (const l of centredBlock(tr(`VOLUME ${vol} OF ${of}`), w)) lines.push(l.replace(/\s+$/, ''));
    while (lines.length < depth - 1 - reserve) lines.push('');
    while (lines.length > depth - 1 - reserve) lines.splice(lines.length - 1, 1);   // over-long title: trim above the bottom border
    lines.push(border);
    if (numbered) lines.push(rightJustify(matterPageNumber('transcriber', 1), w));
    return lines;
  }
  const lines = [''];
  if (title) { for (const l of centredBlock(tr(title), w)) lines.push(l.replace(/\s+$/, '')); lines.push(''); lines.push(''); }
  for (const l of centredBlock(tr(`Volume ${vol} of ${of}`), w)) lines.push(l.replace(/\s+$/, ''));
  return lines.slice(0, depth);
}

// F-54 / BANA 1.6.5 (batch B): optional `o.endOfVolume` (BANA only, default off) puts a centred "End of Volume N" statement in
// transcriber's-note indicators on the last page of each volume, and "The End" after it in the final volume (1.6.5a/b). Placement,
// in the order the rule gives it: a blank line before the statement whenever possible (c); with no room for the blank, on the
// last line when text ends on the next-to-last (d); on the text's own last line after three blank cells and followed by three
// (e, single line only); otherwise one line of text is carried to a new page that holds it and the statement (f). The
// statement always goes on the volume's real last page whatever its format (g); a print "Curtain Falling" is simply the
// last text before it (h). The carried page's print-page number takes the next continuation letter; the braille page number counts on.
function addEndOfVolume(pages, vol, of, o, b) {
  if (!o.endOfVolume || !isBanaOpts(o) || !pages.length) return pages;
  const w = o.width, hideHeader = o.suppressHeader || o.pageHeaders === false;
  // A one-volume book carries "The End" only (KD, round 2 Q10b, 28 Sep 2026); "End of Volume n" is for a set.
  const stmts = of === 1 ? ['The End'] : [`End of Volume ${vol}`, ...(vol === of ? ['The End'] : [])];
  const lines = [];
  for (const t of stmts) for (const l of centredBlock(TN_OPEN + o.translate(t).trim() + TN_CLOSE, w)) lines.push(l.replace(/\s+$/, ''));
  const n = lines.length;
  const out = pages.slice(0, -1);
  const page = [...pages[pages.length - 1]];
  const depth = o.depth || 25;
  if (hideHeader) while (page.length < depth) page.push('');
  const ce = hideHeader ? page.length - 1 : page.length - 2;       // last content line (the braille page number sits below it)
  let L = -1;
  for (let i = ce; i >= 0; i--) if (String(page[i]).trim() !== '') { L = i; break; }
  const place = (from) => { lines.forEach((l, k) => { page[from + k] = l; }); };
  if (L + 1 + n <= ce) { place(L + 2); return [...out, page]; }                       // (c)
  if (L + n <= ce) { place(L + 1); return [...out, page]; }                            // (d) for one line; no blank possible
  if (n === 1 && L === ce) {                                                            // (e)
    const t = String(page[ce]).replace(/\s+$/, '');
    const st = lines[0].trim();
    if (t.length + 3 + st.length + 3 <= w) { page[ce] = t + '   ' + st; return [...out, page]; }
  }
  // (f) carry one line of text to a new page with the statement
  const carried = String(page[L]).replace(/\s+$/, '');
  page[L] = '';
  const hasHead = !hideHeader && b && page.length === b.perPage + 2;
  const np = [];
  if (hasHead) {
    const head = String(page[0]);
    const m = /(?:^|\s)([A-Z]*)(#[A-J]+)$/.exec(head);
    let mid = null;                                            // a print page that began further down this page is the one in effect at its end
    for (let i = 1; i <= ce; i++) { const x = banaPageChangeNumber(String(page[i])); if (x) mid = x; }
    let h = head.replace(/\s+$/, '');
    const base = mid ?? (m ? m[2] : null);
    if (base) {
      const idx = mid ? 0 : (m[1] ? (m[1].length - 1) * 26 + (m[1].charCodeAt(0) - 64) : 0);
      const nh = formatPrintPageHeader(base, idx + 1);
      const title = m && !mid ? head.slice(0, head.length - m[1].length - m[2].length) : head;
      h = title.replace(/\s+$/, '').padEnd(w - nh.length) + nh;
    }
    np.push(h);
  }
  np.push(carried, '', ...lines);
  const bodyLen = hideHeader ? depth : depth - 1;
  while (np.length < bodyLen) np.push('');
  if (!hideHeader) {
    const fm = /#([A-J]+)$/.exec(String(page[page.length - 1]).replace(/\s+$/, ''));
    const num = fm ? Number(fm[1].split('').map((c) => (c.charCodeAt(0) - 64) % 10).join('')) : 0;
    np.push(fm ? rightJustify(brailleNumber(num + 1), w) : '');
  }
  return [...out, page, np];
}
// A multi-volume split: the transcriber pages (pageKinds 'transcriber', see applyTranscriberPageSeries)
// are taken out of the body run. UKAAF: they ride with volume 1 only, unchanged (`front`, below). BANA:
// KD round 2 Q7d (28 Sep 2026, questions-register.md) answered the open question — Special Symbols and
// Transcriber's Notes repeat in EVERY volume, each freshly built by formatVolumesFromBuild's BANA branch
// (renderTranscriberMatterPages), so `front` (this function's whole-document, single-pass rendering) is
// used for UKAAF only now; BANA ignores it. `bodyOrigIndex[k]` is the ORIGINAL whole-document body-page
// index (b.bodyPages/b.pageKinds/b.pagePlan space) of `body[k]`, used by formatVolumesFromBuild's BANA
// branch (via volumeChunks' `origIdx` and blocksForOrigPages) to scope a volume's Special Symbols page to
// only the symbols used in that volume's own content. The volume title page is t1 in every volume (F-57),
// so `front`'s pages are renumbered t2, t3 ... to follow it (UKAAF path only, see above).
function splitTranscriberPages(b, renum) {
  if (!b.pageKinds) return { front: [], body: b.bodyPages, bodyOrigIndex: b.bodyPages.map((_, i) => i) };
  const front = [], body = [], bodyOrigIndex = [];
  b.bodyPages.forEach((pg, i) => {
    if (b.pageKinds[i] === 'transcriber') front.push(renumberPageSeries(pg, front.length + 1, 'transcriber', front.length + 2, { ...renum, fromSeries: 'transcriber' }));
    else { body.push(pg); bodyOrigIndex.push(i); }
  });
  return { front, body, bodyOrigIndex };
}
// The DOCUMENT's content blocks (b.blocks, indices matching b.contentBlock) touched by any of the given
// ORIGINAL whole-document body-page indices (0-based, b.bodyPages/b.pageKinds/b.pagePlan space — see
// splitTranscriberPages's bodyOrigIndex). Used to scope collectSpecialSymbols to one volume (BANA 2.5.1:
// "symbols found in the volume"). Index positions not touched are left as `undefined` gaps
// (collectSpecialSymbols's own walk skips non-object entries) rather than removed, but nothing relies on
// the surviving positions — it is only ever passed straight into collectSpecialSymbols.
function blocksForOrigPages(b, origPageIndices) {
  if (!Array.isArray(origPageIndices) || !origPageIndices.length) return [];
  const { range } = planPages(b.pagePlan, b.content.length);
  const idxSet = new Set();
  for (const p of origPageIndices) {
    const [from, to] = range(p);
    for (let i = from; i < to; i++) {
      const bi = b.contentBlock[i];
      if (bi != null && bi >= 0) idxSet.add(bi);
    }
  }
  return b.blocks.map((blk, i) => (idxSet.has(i) ? blk : undefined));
}
// Independently paginated Special Symbols / Transcriber's Notes page(s) for ONE volume (BANA only, KD
// round 2 Q7d) — mirrors buildDocPagesFull's own content-build + applyPageBoundaries + assemble +
// applyTranscriberPageSeries sequence, reduced to just the transcriber-matter blocks this volume carries
// (already resolved/scoped by the caller): none of buildDocPagesFull's heading/TOC/title-page/verse
// handling applies to a sympage/tnpage block, so none of that machinery is needed here. `startAt` is the
// t-number the volume's own title page already claims (1 when hasTP, else 0 — same convention as
// applyTranscriberPageSeries's own call in buildDocPagesFull). Does not support o.translatePos (editor
// position tracking): formatVolumes/formatVolumesAsync is a whole-document export, not the live editor
// view, so this mirrors formatBlock's (not traceBlock's) dispatch to formatSymPage/formatTnPage.
function renderTranscriberMatterPages(pieces, o, doc, startAt) {
  const blocks = Array.isArray(pieces) ? pieces.filter(Boolean) : [];
  if (!blocks.length) return { pages: [], kinds: [] };
  const isBana = isBanaOpts(o);
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const hasPrintPages = !!o._hasPrintPages;
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, false);
  let content = [], contentBlock = [], contentCells = [], contentKeep = [];
  blocks.forEach((block, bi) => {
    const lines = block.type === 'sympage' ? formatSymPage(block, o) : block.type === 'tnpage' ? formatTnPage(block, o) : [];
    for (const l of lines) {
      if (l === '' && content.length && content[content.length - 1] === '') continue;
      content.push(l); contentBlock.push(bi); contentCells.push(null); contentKeep.push(null);
    }
  });
  if (!content.length) return { pages: [], kinds: [] };
  const asm = {
    title: docBrailleTitle(doc, o), width: o.width, depth: o.depth, mode: isBana ? 'bana' : 'ukaaf',
    translate: foreignTitleTranslate(doc, o), pageOneTitle: null,
    suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders, hasPrintPages, pilPrintPage: o.pilPrintPage,
    interpointOmitEven: o.interpointOmitEven, runningHeadKeyWords: doc?.runningHeadKeyWords,
  };
  let pagePlan;
  ({ content, contentBlock, contentCells, pagePlan } = applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana, contentKeep, o, asm));
  const bodyPages = assemble(content, asm);
  const tSeries = applyTranscriberPageSeries(bodyPages, content, contentBlock, blocks, pagePlan, o, startAt);
  return tSeries ? { pages: tSeries.pages, kinds: tSeries.kinds } : { pages: [], kinds: [] };
}
// K15 follow-up: which body pages (in the volume split's own order, transcriber pages taken out as splitTranscriberPages
// does) are the left-hand ('L') and right-hand ('R') pages of a facing-pages table, and the blank page ('pad') left before a
// left-hand page in interpoint — from the page plan applyPageBoundaries marked (placeFacingTable). null entries otherwise;
// all null when the plan does not line up with the pages.
function bodyFacingKinds(b) {
  const plan = Array.isArray(b.pagePlan) ? b.pagePlan : [];
  if (plan.length !== b.bodyPages.length) return b.bodyPages.map(() => null).filter((_, i) => !(b.pageKinds && b.pageKinds[i] === 'transcriber'));
  return plan.map((p) => (p && p.facing) || null).filter((_, i) => !(b.pageKinds && b.pageKinds[i] === 'transcriber'));
}
// The body pages of each volume, renumbered from braille page 1 (Formats §1.15.1d, B004 §7): at most maxV pages a volume,
// cut at a page boundary, except around a table set across facing pages (BANA 11.13, B004 App E):
//  - the two pages of a pair are never separated: a pair that does not fit what is left of a volume opens the next one
//    (11.13.1: the table is read across the two pages seen together — a volume boundary between them would put its left
//    and right halves in different books). A pair that alone does not fit maxV is kept whole, the volume one page longer.
//  - in interpoint the left-hand page stays an even page of its own volume (11.13.1: "Care must be taken to ensure that
//    the first page is on the left-hand page"; 11.13.1b: "the front side of the left facing page may be blank"). Each
//    volume's pages are numbered from 1, so a volume that begins after an odd number of pages flips the parity the whole
//    book was laid out with: the blank page placeFacingTable left before an odd left-hand page is then dropped, and one
//    is added where the left-hand page would otherwise fall on an odd page (a copy of the page before it, emptied: its
//    running head and braille page number kept, the number renumbered; in BANA its print page number is left off, since
//    the continuation letter it would need is the one the pages after it already carry).
// Without facing pages (or kinds all null) this is exactly the old fixed split every maxV pages.
// `origIdx` (optional, parallel to `pages`/`kinds`): the ORIGINAL whole-document body-page index of each
// entry (splitTranscriberPages' bodyOrigIndex) — threaded through so the return value's `volOrig` can
// tell formatVolumesFromBuild's BANA branch which original pages (and so which content blocks,
// blocksForOrigPages) ended up in each volume, to scope that volume's own Special Symbols page (KD round
// 2 Q7d). Returns { pages: <the old return value, unchanged>, volOrig: [[origIdx...], ...] per volume }.
function volumeChunks(pages, kinds, maxV, o, renum, origIdx, bodyStart = 1, reserve = null) {
  const interpoint = o.interpoint === true;
  const hideHeader = o.suppressHeader || o.pageHeaders === false;
  const bana = renum.mode === 'bana';
  const w = renum.width || 40;
  const orig = Array.isArray(origIdx) ? origIdx : pages.map((_, i) => i);
  const headOnly = (l) => {                                // BANA line 1 less its right-margin print page number
    const t = String(l).replace(/\s+$/, '');
    const m = t.length === w ? /(^|\s)[A-Z]*#[A-J]+$/.exec(t) : null;
    return m ? t.slice(0, m.index).replace(/\s+$/, '') : t;
  };
  const emptied = (pg) => pg.map((l, k) => (hideHeader ? '' : k === 0 ? (bana ? headOnly(l) : l) : (bana && k === pg.length - 1) ? l : ''));
  const vols = [];
  let cur = [];
  const close = () => { if (cur.length) vols.push(cur); cur = []; };
  // IMP-W3: `reserve(origPageIndexes)` = braille pages the volume's endnote section will take (BANA 16.9.2b: each volume ends
  // with the endnotes its text cites), counted against the volume's size. null = none (every book without an endnote section).
  const extra = (adding) => (reserve ? reserve([...cur.map((e) => e.orig), ...adding]) : 0);
  for (let i = 0; i < pages.length; i++) {
    const kind = kinds[i];
    if (kind === 'pad' && kinds[i + 1] === 'L') continue;                // decided at the left-hand page itself
    if (kind === 'L' && kinds[i + 1] === 'R') {
      const needPad = () => interpoint && cur.length % 2 === 0;           // the left-hand page would be odd
      if (cur.length && cur.length + (needPad() ? 1 : 0) + 2 + extra([orig[i], orig[i + 1]]) > maxV) close();
      if (needPad()) {
        const j = Math.max(0, i - 1);
        cur.push({ pg: kinds[j] === 'pad' && j < i ? pages[j] : emptied(pages[j]), from: j + 1, orig: orig[j] });
      }
      cur.push({ pg: pages[i], from: i + 1, orig: orig[i] }, { pg: pages[i + 1], from: i + 2, orig: orig[i + 1] });
      i++;
      continue;
    }
    if (cur.length && cur.length + 1 + extra([orig[i]]) > maxV) close();   // (no reserve: exactly `cur.length >= maxV`)
    cur.push({ pg: pages[i], from: i + 1, orig: orig[i] });
  }
  close();
  // `bodyStart` (default 1, unchanged): UK-9 follow-up, this brief — when every volume gets its own
  // standalone title page (+ UKAAF's accessible-copy notice), its body continues from bodyStart (3) in
  // EVERY volume rather than restarting at 1 right under them (formatVolumesFromBuild's own UKAAF+hasTP
  // branch passes 3; every other caller passes the default 1, so `bodyStart + k === k + 1`, byte-identical).
  return { pages: vols.map((v) => v.map((e, k) => renumberPage(e.pg, e.from, bodyStart + k, renum))), volOrig: vols.map((v) => v.map((e) => e.orig)) };
}
// ---- IMP-W3: the endnote section of a book of several volumes (BANA 16.9.2b) ----
// buildDocPages lays the whole book out once, with one endnote section at its end (b.endnotes). When the book splits into
// volumes, that section is taken off again and each volume ends with its own: the notes its text cites (`noteref` segments whose
// `idref` is the note's id), on a new page, under the same heading. An endnote nothing cites goes to the volume that holds the text
// nearest before it. A note cited in several volumes is repeated in each. The volume's section is laid out by the same builder as
// the book (a small document of a filler paragraph, the heading and the notes, so that the section's pages have the running head
// every later page has), then renumbered to follow the volume's body pages.
function endnoteSectionPlan(b) {
  if (!b || !b.endnotes || b.empty) return null;
  const { pageOf, range } = planPages(b.pagePlan, b.content.length);
  const line = b.content.findIndex((l, k) => b.contentBlock[k] === b.endnotes.headIdx && l !== '');
  if (line < 0) return null;
  const start = pageOf(line);
  const movedSet = new Set(b.endnotes.moved);
  const noteAt = new Map();
  b.endnotes.moved.forEach((bi) => { const id = b.blocks[bi] && b.blocks[bi].id; if (id != null && !noteAt.has(String(id))) noteAt.set(String(id), bi); });
  // Where each cited endnote is cited: the braille page of the LINE its reference falls on. A paragraph can run across a volume
  // boundary, so the page of the whole block would put its notes in both volumes: the reference's place in the paragraph's text
  // (as a fraction of it) picks the line. A reference deeper in a list, table or box has no such place: the block's first line.
  const linesOf = new Map();
  b.contentBlock.forEach((bi, k) => { if (bi >= 0 && b.content[k] !== '') (linesOf.get(bi) || linesOf.set(bi, []).get(bi)).push(k); });
  const notePages = new Map();                               // endnote block -> Set(original page index) of its references
  const cite = (nb, page) => (notePages.get(nb) || notePages.set(nb, new Set()).get(nb)).add(page);
  for (const [bi, lines] of linesOf) {
    const blk = b.blocks[bi];
    if (!blk || typeof blk !== 'object' || movedSet.has(bi)) continue;
    const json = JSON.stringify(blk);
    if (!json.includes('"noteref"')) continue;
    let flatOffsets = null;
    if (Array.isArray(blk.segments)) {
      let total = 0; const at = [];
      for (const g of blk.segments) { if (g && g.type === 'noteref' && g.idref != null) at.push([String(g.idref), total]); total += String((g && g.text) || '').length; }
      flatOffsets = total > 0 ? at.map(([id, off]) => [id, off / total]) : at.map(([id]) => [id, 0]);
    }
    const seen = new Set();
    for (const [id, frac] of flatOffsets || []) {
      const nb = noteAt.get(id); if (nb == null) continue;
      seen.add(nb);
      cite(nb, pageOf(lines[Math.min(lines.length - 1, Math.floor(frac * lines.length))]));
    }
    for (const m of json.matchAll(/"idref":"((?:[^"\\]|\\.)*)"/g)) {
      const nb = noteAt.get(String(JSON.parse(`"${m[1]}"`)));
      if (nb != null && !seen.has(nb)) cite(nb, pageOf(lines[0]));
    }
  }
  const blocksOfPage = (p) => { const [from, to] = range(p); const set = new Set(); for (let i = from; i < to; i++) { const bi = b.contentBlock[i]; if (bi != null && bi >= 0) set.add(bi); } return set; };
  const noteLines = new Map(b.endnotes.moved.map((bi) => [bi, 0]));
  b.contentBlock.forEach((bi, k) => { if (noteLines.has(bi) && b.content[k] !== '') noteLines.set(bi, noteLines.get(bi) + 1); });
  const headLines = 2 + (b.opts && b.opts._runningHead ? 1 : 0);
  return { start, notePages, blocksOfPage, noteLines, headLines, perPage: b.perPage };
}
function renderEndnoteVolumeSection(b, doc, o, noteIdx, isLast, firstNumber, renum) {
  if (!noteIdx.length) return [];
  const head = b.blocks[b.endnotes.headIdx];
  const o2 = { ...o, toc: false, _warnings: [], _forcePrintPages: !!b.hasPrintPages, docEndMarker: isLast ? o.docEndMarker : false, blockCache: undefined };
  delete o2.trace;
  // A note opens with the reference mark its text uses (16.2.1); the small document has no text, so the marks are read from the book.
  const marks = findNoteMarks(b.blocks);
  const noteBlocks = noteIdx.map((bi) => { const blk = b.blocks[bi]; return blk && blk.id != null && marks.has(String(blk.id)) ? { ...blk, noteMark: marks.get(String(blk.id)) } : blk; });
  const sub = buildDocPages({ ...doc, blocks: [{ type: 'para', text: 'x' }, head, ...noteBlocks] }, o2);
  if (sub.empty) return [];
  const first = sub.content.findIndex((l, k) => sub.contentBlock[k] === (sub.endnotes ? sub.endnotes.headIdx : 1) && l !== '');
  const { pageOf } = planPages(sub.pagePlan, sub.content.length);
  const p0 = first < 0 ? 1 : pageOf(first);
  return sub.bodyPages.slice(p0).map((pg, k) => renumberPageSeries(pg, p0 + k + 1, 'body', firstNumber + k, { ...renum, fromSeries: 'body' }));
}
// Split a document into braille volumes of at most o.volumePages *body* pages each
// (0/undefined = a single volume). We split AFTER assembly (so print page
// continuation letters etc. are already baked in) and then renumber each
// volume's pages from braille page 1: "Begin the main text of each volume with
// braille page 1" (Formats §1.15.1d); "Braille page numbering must always start
// at 1 (for each volume)" (B004 §7). The TOC prelim pages ride with volume 1
// (its entries for later volumes still cite whole-document page numbers). Returns
// [{ volume, of, brf, spineLabel }]. Splits on braille-page boundaries only.
// K29 Stage 1b / TP-5 / design §3.4: shared by formatVolumes and formatVolumesAsync once each has its own
// `b` (buildDocPagesFull(Async)'s result — its own titlePagePages, when the document has a `titlepage`
// block, is a volume=1/of=1 rendering: correct for the early (single-volume) return below, which prepends
// it same as formatDocument does). When the book actually splits into more than one volume, EVERY volume
// needs its OWN title page — different volume/of and different braille/print page ranges — so each one is
// rendered standalone (assembleTitlePage, the same function buildStandaloneTitlePage itself calls) rather
// than reusing `b.titlePagePages`, so all volumes go through one code path. TP-5: a document with NO
// titlepage block is completely unchanged (hasTP false keeps the original volumeTitlePage bolt-on).
function formatVolumesFromBuild(b, doc, o, title) {
  if (b.empty) return [{ volume: 1, of: 1, brf: '', spineLabel: `${title} - VOL 1/1` }];
  const hasTP = Array.isArray(doc?.blocks) && doc.blocks.some((bl) => bl && typeof bl === 'object' && bl.type === 'titlepage');
  const maxV = Math.max(0, o.volumePages | 0);
  if (!maxV || (b.pageKinds ? b.pageKinds.filter((k) => k === 'body').length : b.bodyPages.length) <= maxV) {
    const finalBodyPages = shiftUkBodyPages(b.bodyPages, b.pageKinds, b.ukTitleOffset, o);   // UK-9 follow-up: continuous Arabic numbering after a UKAAF title page (+ notice)
    const pages = [...(b.titlePagePages || []), ...b.tocPages, ...finalBodyPages];
    return [{ volume: 1, of: 1, brf: toBRF(o.endOfVolume ? addEndOfVolume(pages, 1, 1, o, b) : pages), spineLabel: `${title} - VOL 1/1` }];
  }
  const renum = { width: o.width, mode: (o.standard === 'bana' || o.mode === 'bana') ? 'bana' : 'ukaaf', suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders };
  const isBana = renum.mode === 'bana';
  // UK-9 follow-up (this brief): every volume gets its own title page (+ UKAAF's accessible-copy notice,
  // 2 pages) when hasTP, so its own body continues from page 3 — restart at 1 in EACH volume, not just
  // volume 1 (BANA is unaffected: isBana keeps this at the original 1, its title page is a separate t1).
  const ukVolBodyStart = (!isBana && hasTP) ? 3 : 1;
  const { front: tPagesLegacy, body: bodyOnly0, bodyOrigIndex: bodyOrigIndex0 } = splitTranscriberPages(b, renum);
  let bodyOnly = bodyOnly0, bodyOrigIndex = bodyOrigIndex0, facingKinds = bodyFacingKinds(b);
  // IMP-W3 / BANA 16.9.2b: the book's one endnote section comes off; each volume gets its own (below).
  const enPlan = endnoteSectionPlan(b);
  if (enPlan) {
    const cut = bodyOrigIndex.findIndex((i) => i >= enPlan.start);
    if (cut >= 0) { bodyOnly = bodyOnly.slice(0, cut); bodyOrigIndex = bodyOrigIndex.slice(0, cut); facingKinds = facingKinds.slice(0, cut); }
  }
  const citedOn = (origList) => {                            // the endnote blocks cited on these original pages
    const ids = new Set(), pages = new Set(origList);
    for (const [nb, ps] of enPlan.notePages) for (const p of ps) if (pages.has(p)) { ids.add(nb); break; }
    // #57c: the further paragraphs of a note (`noteCont`, the editor's one block per paragraph) go to the volume with the note.
    for (const nb of [...ids]) for (let j = nb + 1; b.blocks[j] && b.blocks[j].type === 'footnote' && b.blocks[j].noteCont && b.endnotes.moved.includes(j); j++) ids.add(j);
    return ids;
  };
  const pagesOfNotes = (ids) => {                            // braille pages a set of endnote blocks takes (the heading and the notes)
    if (!ids.size) return 0;
    let lines = enPlan.headLines;
    for (const bi of ids) lines += enPlan.noteLines.get(bi) || 1;
    return Math.ceil(lines / Math.max(1, enPlan.perPage));
  };
  const reserve = enPlan ? (origList) => pagesOfNotes(citedOn(origList)) : null;
  const { pages: chunks0, volOrig } = volumeChunks(bodyOnly, facingKinds, maxV, o, renum, bodyOrigIndex, ukVolBodyStart, reserve);   // Formats §1.15.1d / B004 §7; K15 facing pages
  let chunks = chunks0;
  let volNotes = chunks0.map(() => []);                      // per volume: its endnote blocks
  if (enPlan) {
    const volOfBlock = new Map();
    volOrig.forEach((list, v) => { for (const p of list) for (const bi of enPlan.blocksOfPage(p)) if (!volOfBlock.has(bi)) volOfBlock.set(bi, v); });
    const cited = volOrig.map((list) => citedOn(list));
    const citedAnywhere = new Set(cited.flatMap((c) => [...c]));
    b.endnotes.moved.forEach((bi) => {
      cited.forEach((c, v) => { if (c.has(bi)) volNotes[v].push(bi); });
      if (citedAnywhere.has(bi)) return;
      let v = 0;                                              // uncited: the volume holding the text nearest before it
      for (let j = bi - 1; j >= 0; j--) if (volOfBlock.has(j)) { v = volOfBlock.get(j); break; }
      volNotes[v].push(bi);
    });
    volNotes = volNotes.map((list) => [...new Set(list)].sort((x, y) => x - y));
    chunks = chunks0.map((chunk, v) => [...chunk, ...renderEndnoteVolumeSection(b, doc, o, volNotes[v], v === chunks0.length - 1, ukVolBodyStart + chunk.length, renum)]);
  }
  const of = chunks.length;

  if (!isBana) {
    // UKAAF: UNCHANGED (UK-8: no Special Symbols page; its "Note to Braille Edition" — the same tnpage
    // block/formatter as BANA's Transcriber's Notes, see tnpageHeading — rides with volume 1 only, exactly
    // as before KD round 2 Q7d). Left as-is deliberately; see this file's report for why.
    if (!hasTP) {
      return chunks.map((chunk, idx) => ({
        volume: idx + 1, of,
        spineLabel: `${title} - VOL ${idx + 1}/${of}`,
        brf: toBRF([volumeTitlePage(idx + 1, of, title, o), ...(idx === 0 ? [...tPagesLegacy, ...b.tocPages] : []), ...addEndOfVolume(chunk, idx + 1, of, o, b)]),
      }));
    }
    const tCountVol1 = tPagesLegacy.length + 1;   // +1: the title page itself, always separate from tPagesLegacy now
    return chunks.map((chunk, idx) => {
      const vol = idx + 1;
      const tCount = vol === 1 ? tCountVol1 : 1;
      const pCount = vol === 1 ? b.tocPages.length : 0;
      const braillePages = tpBraillePagesRange(tCount, pCount, chunk.length);
      const printPages = tpPrintPageRangeFromPages(chunk);
      const tpFields = { ...titlePageFieldsFrom(doc), volume: vol, volumeOf: of, volumeLabel: `Volume ${vol}`, braillePages, printPages };
      // UK-9 follow-up: assembleTitleAndNotice (not a bare assembleTitlePage call) — every volume gets its
      // own accessible-copy notice page too, straight after its own title page (previously missing here
      // entirely: only the whole-document/single-volume path, buildStandaloneTitlePage, added it).
      const tpPages = assembleTitleAndNotice({ type: 'titlepage', matter: 'transcriber', ...tpFields }, o);
      return {
        volume: vol, of,
        spineLabel: `${title} - VOL ${vol}/${of}`,
        brf: toBRF([...tpPages, ...(vol === 1 ? [...tPagesLegacy, ...b.tocPages] : []), ...addEndOfVolume(chunk, vol, of, o, b)]),
      };
    });
  }

  // BANA: KD round 2 Q7d (28 Sep 2026, questions-register.md round 2 Q7d) — the Special Symbols page and
  // the Transcriber's Notes page repeat in EVERY volume, each Special Symbols page listing only that
  // volume's own symbols (2.5.1 "symbols found in the volume"; 2.5.2a "SPECIAL SYMBOLS USED IN THIS
  // VOLUME"). A hand-edited (non-auto) Symbols page cannot be split by volume — Emboss has no way to know
  // which of its lines belong to which volume — so it repeats VERBATIM in every volume instead (reported).
  // Transcriber's Notes has no auto-derivation (its entries are always author-provided text, unlike
  // Special Symbols' collectSpecialSymbols): the same block/content repeats in every volume, matching
  // 2.6.1's own volume-scoped wording ("identifies special formats or usage throughout the volume").
  const origSymBlock = Array.isArray(doc?.blocks) ? doc.blocks.find((bl) => bl && typeof bl === 'object' && bl.type === 'sympage') : null;
  const symEdited = !!origSymBlock && sympageEntries(origSymBlock).length > 0;   // resolveSymPages' own "already has entries" test, applied to the ORIGINAL (pre-resolution) block
  const symTemplate = b.blocks.find((bl) => bl && typeof bl === 'object' && bl.type === 'sympage' && !bl.dormant) || null;
  const tnTemplate = b.blocks.find((bl) => bl && typeof bl === 'object' && bl.type === 'tnpage') || null;
  // Every volume's own title page — a real one (assembleTitlePage, hasTP) or the volumeTitlePage bolt-on
  // (!hasTP, same as before this brief) — always claims t1, so transcriber matter always starts at t2 here
  // (matches splitTranscriberPages' own +1 shift for the UKAAF/legacy path above, and the pre-existing
  // 'Multi-volume' expectation in transcriber_pages_tn.test.mjs).
  const startAt = 1;
  const matterPagesFor = (idx) => {
    const pieces = [];
    if (symTemplate) {
      let symBlock = null;
      if (symEdited) symBlock = symTemplate;   // verbatim repeat — Emboss cannot split a hand-edited page by volume
      else {
        const volBlocks = [...blocksForOrigPages(b, volOrig[idx] || []), ...(volNotes[idx] || []).map((bi) => b.blocks[bi])].filter((bl) => !(bl && bl.type === 'sympage'));   // IMP-W3: and the volume's own endnote section
        const derived = collectSpecialSymbols(volBlocks, o);
        if (derived.length) symBlock = { ...symTemplate, entries: [SYMPAGE_DOT_LOCATOR, ...derived.map((d) => ({ print: d.print, braille: d.braille, description: symbolMeaning(d) }))] };
        // else: this volume uses none of the document's transcriber-defined/unusual symbols — Appendix G
        // requires an entry only "if they are used within a braille volume", so no page at all (2.5.2f).
      }
      if (symBlock) pieces.push(symBlock);
    }
    if (tnTemplate) pieces.push(tnTemplate);   // same content, every volume (no per-volume derivation exists for notes)
    return pieces;
  };
  if (!hasTP) {
    return chunks.map((chunk, idx) => {
      const matterPages = renderTranscriberMatterPages(matterPagesFor(idx), o, doc, startAt).pages;
      return {
        volume: idx + 1, of,
        spineLabel: `${title} - VOL ${idx + 1}/${of}`,
        brf: toBRF([volumeTitlePage(idx + 1, of, title, o), ...matterPages, ...(idx === 0 ? b.tocPages : []), ...addEndOfVolume(chunk, idx + 1, of, o, b)]),
      };
    });
  }
  return chunks.map((chunk, idx) => {
    const vol = idx + 1;
    const matterPages = renderTranscriberMatterPages(matterPagesFor(idx), o, doc, startAt).pages;
    const tCount = matterPages.length + 1;   // +1: the volume's own title page
    const pCount = vol === 1 ? b.tocPages.length : 0;
    const braillePages = tpBraillePagesRange(tCount, pCount, chunk.length);
    const printPages = tpPrintPageRangeFromPages(chunk);
    const tpFields = { ...titlePageFieldsFrom(doc), volume: vol, volumeOf: of, volumeLabel: `Volume ${vol}`, braillePages, printPages };
    const tpPage = assembleTitlePage({ type: 'titlepage', matter: 'transcriber', ...tpFields }, o);
    return {
      volume: vol, of,
      spineLabel: `${title} - VOL ${vol}/${of}`,
      brf: toBRF([tpPage, ...matterPages, ...(vol === 1 ? b.tocPages : []), ...addEndOfVolume(chunk, vol, of, o, b)]),
    };
  });
}
function formatVolumes(doc, o) {
  const b = buildDocPagesFull(doc, o);
  o = b.opts;
  const title = doc?.title != null ? String(doc.title) : 'DOCUMENT';
  return formatVolumesFromBuild(b, doc, o, title);
}

async function formatVolumesAsync(doc, o) {
  const b = await buildDocPagesFullAsync(doc, o);
  o = b.opts;
  const title = doc?.title != null ? String(doc.title) : 'DOCUMENT';
  return formatVolumesFromBuild(b, doc, o, title);
}

// Reconstruct assemble()'s per-page row layout to label each output row with its
// source block. Must mirror assemble() + buildToc() exactly.
function traceRows(content, contentBlock, contentCells, tocPages, o, hasPrintPages = false, hasTitle = false, alphaMerged = null) {
  const rows = [], rowCells = [];
  const push = (b, c) => { rows.push(b); rowCells.push(c); };
  for (const page of tocPages) for (let i = 0; i < page.length; i++) push(-1, null);
  const hideHeader = o.suppressHeader || o.pageHeaders === false;
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hasFurniture = hasPrintPages || hasTitle;
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  
  let lineIdx = 0, pageIdx = -1;
  while (lineIdx < content.length) {
    pageIdx++;
    if (hideHeader) {
      const chunk = content.slice(lineIdx, lineIdx + perPage);
      for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
      lineIdx += perPage;
    } else if (isBana) {
      if (!hasFurniture) {
        const chunk = content.slice(lineIdx, lineIdx + perPage);
        for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
        for (let k = chunk.length; k < perPage; k++) push(-1, null);
        push(-1, null);
        lineIdx += perPage;
      } else {
        if (banaPageChangeNumber(content[lineIdx]) !== null) {   // top-of-page indicator → line 1 (mirror assemble)
          lineIdx += 1;
          if (alphaMerged && alphaMerged.has(pageIdx)) lineIdx += 1;   // F-49: spelled-out number merged onto line 1 (mirror assemble)
        }
        push(-1, null);                          // Line 1: print page / running head
        const chunk = content.slice(lineIdx, lineIdx + perPage);
        for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
        for (let k = chunk.length; k < perPage; k++) push(-1, null);
        push(-1, null);                          // Line 25: braille page number
        lineIdx += chunk.length;
      }
    } else {
      push(-1, null);                            // Line 1: running-head line
      const chunk = content.slice(lineIdx, lineIdx + perPage);
      for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
      lineIdx += perPage;
    }
  }
  return { rows, rowCells };
}

// ===================== eBraille flow (Emboss/format/ebraille.mjs) =====================
// The eBraille export is reflowable: no line has a fixed length, so the page layout (wrapping,
// pagination) is the one thing it must NOT take from the formatter. Everything else it does:
// the contractions, emphasis, maths, notes and margins the formatter works out are the braille of
// the book, and a second implementation of them in the exporter would drift (the same reason A39
// folded formatBlock into traceBlock). So the exporter asks the formatter for each block laid out
// at a width no block reaches (FLOW_WIDTH) and reads the result back as "one flowing string per
// paragraph plus the cells of margin it started with". These functions are that interface; none
// of them is used by formatBlock/traceBlock/buildDocPages in any other mode (the only changes
// those make are guarded by o.flowMarks / o._flowSink, which only these functions set).
const FLOW_WIDTH = 20000;
export const FLOW_MARKS = { open: FLOW_REF_OPEN, sep: FLOW_REF_SEP, close: FLOW_REF_CLOSE, tnOpen: TN_OPEN, tnClose: TN_CLOSE };

// Run `fn` with `o` set up for flow layout, then put `o` back exactly as it was (the very same
// object, not a copy, because the formatter keeps state on it: transcriber-defined symbols, warnings).
function withFlow(o, fn) {
  const keep = { width: o.width, translatePos: o.translatePos, flowMarks: o.flowMarks };
  o.width = FLOW_WIDTH;
  o.flowMarks = true;
  // A position map that maps nothing real: the cell trace only needs *some* map for the source
  // coordinates (`u`, the unit a cell belongs to) to be recorded; the exporter reads only `u`.
  o.translatePos = (text, tf) => { const b = String(o.translate(text, tf) ?? ''); return { braille: b, inputPos: Array.from(b, (_, i) => i) }; };
  try { return fn(); } finally { o.width = keep.width; o.translatePos = keep.translatePos; o.flowMarks = keep.flowMarks; }
}

/**
 * One block laid out for flow. Returns { lines, before, after }:
 *   lines  [{ text, indent, u, gap }]  the non-blank lines, BRF ASCII, with the cells of margin each
 *          began with (a centred line has a huge indent), `u` the unit (list item / cell) its first
 *          traced cell came from (null for decoration), `gap` the blank lines just above it;
 *   before / after  the blank lines the formatter put around the block.
 * `o` must be the options buildDocPages prepared (translate already guarded) - see flowDocument.
 */
export function flowLines(block, o, atStart = false) {
  const traced = withFlow(o, () => traceBlock(block, o, atStart));
  const lines = [];
  let before = 0, pending = 0;
  for (const t of traced) {
    const s = String(t.s ?? '');
    if (!s.trim()) { if (lines.length) pending++; else before++; continue; }
    const text = s.trim();
    const src = Array.isArray(t.src) ? t.src.find((p) => p && typeof p.u === 'number') : null;
    lines.push({ text, indent: s.length - s.trimStart().length, u: src ? src.u : null, gap: pending });
    pending = 0;
  }
  return { lines, before, after: pending };
}
/** The braille (BRF ASCII, note references fenced) of a run of segments, as formatted in flow. */
export function flowSegs(segs, o) {
  return withFlow(o, () => tcSegs(o, segs || [], 0).s.trim());
}
/** The braille of one table cell, as the table formatter sets it. */
export function flowCell(cell, o, dittoMarks = false) {
  return withFlow(o, () => tcCell(o, cell, 0, dittoMarks).s.trim());
}
/** True if the formatter would drop the blank lines between these two blocks (headings and their text, UKAAF). */
export function flowJoins(prev, block, o, nb) { return !!prev && !!block && joinsWithoutBlank(prev, block, o, nb); }
/** The heading's presentation: { centred, first, runover } in cells (BANA tiers by document, UKAAF by level). */
export function flowHeadingStyle(block, o) {
  const L = block.level || 1;
  if (isBanaOpts(o)) {
    const tier = block.tierOverride || banaTier(L, o);
    const dsp = block.displayed ? 2 : 0;
    if (tier === 'cell5') return { centred: false, first: 4 + dsp, runover: 4 + dsp };
    if (tier === 'cell7') return { centred: false, first: 6 + dsp, runover: 6 + dsp };
    return { centred: true, first: 0, runover: 0 };
  }
  if (L === 1) return { centred: true, first: 0, runover: 0 };
  if (L === 2 || L === 5 || L === 4) return { centred: false, first: 0, runover: 4 };
  return { centred: false, first: 2, runover: 4 };
}
/** First-line and runover margins of a list's items: item -> { first, runover } (the rule the list lays itself out by). */
export function flowListMargins(block, o) {
  const kind = block.kind, mkind = listMarginKind(kind), maxLevel = listMaxLevel(block);
  const shared = sharedMarginOf(block, o), pads = listBulletPads(block, o), compact = isCompactList(o);
  return (item) => {
    const lvl = (item && item.level) || 0;
    const nm = nestedMargins(mkind, lvl, maxLevel, o.mode, o.listStyle);
    const dOff = (block.displayed || block.translationPairs) && o.mode === 'bana' && kind !== 'toc' ? 2 : 0;
    const sc = shared != null ? sharedMarginCells(item, lvl, shared, maxLevel, o) : null;
    const first = sc ? sc.first : nm.first + dOff, runover = sc ? sc.runover : nm.runover + dOff;
    const pad = (compact || o.showBullets === false) ? 0 : (pads.get(lvl) || 0);
    return { first, runover: runover + pad };
  };
}
/** Runover margin of a non-list block (0 = the paragraph's lines all start at cell 1). */
export function flowRunover(block, o) {
  if (!block || typeof block !== 'object') return 0;
  switch (block.type) {
    case 'play': case 'dialogue': case 'verse': case 'poem': case 'poetry': {
      const isVerse = block.type !== 'play' && block.type !== 'dialogue' ? true : (block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem');
      const lvl = block.level || 0;
      const marginKind = (isVerse && o.mode === 'bana' && block.playVerse) ? 'play-verse' : 'poetry';
      const dsp = isVerse && block.displayedPoem && o.mode === 'bana' ? 2 : 0;
      const nm = isVerse ? nestedMargins(marginKind, lvl, block.maxLevel ?? lvl, o.mode) : { first: lvl === 0 ? 0 : 4, runover: 2 };
      return (block.poemRunover ?? nm.runover) + dsp;
    }
    case 'note': return tnMargins(o).runover;
    case 'footnote': return 2;
    case 'caption': case 'xref': return 4;
    case 'stage': return 6;
    case 'attribution': return Number.isFinite(block.attribCell) ? block.attribCell : 4;
    default: {
      const q = quoteMargins(block, o);
      if (q) return q.runover;
      const dm = directionsMargins(block, o) || hangingMargins(block);
      return dm ? dm.runover : 0;
    }
  }
}

/**
 * Prepare `doc` exactly as formatDocument does (note placement, endnote section, special symbols and
 * transcriber's notes pages, word lists, print page numbers, poems, emphasis context ...) and hand every
 * block, in the order the pages would carry it, to `sink` instead of paginating. `sink` gets
 * { bi, block, fb, o, atStart, blocks, isBana }: `fb` is the block with the document-level flags the
 * formatter would have given it, `o` the prepared options (pass THEM to flowLines/flowSegs/flowCell),
 * `blocks` the prepared list; it returns true if the block produced content (the formatter's atStart).
 */
export function flowDocument(doc, o, sink) {
  return buildDocPages(doc, { ...o, _flowSink: sink });
}

export { formatDocument, formatDocumentAsync, formatVolumes, formatVolumesAsync, formatBlock, traceBlock, getBlockSignature, centred, indicatorLine };
export { blockMatter, matterPageNumber, resolvePageNumbers, pageNumberText };
// K29 Stage 1c: additive-only export of the existing, unmodified titlePageFieldsFrom (Stage 1b) — the
// editor's Title Page card (editor.mjs) and the NIMAS exporter (input/nimas-export.mjs) reuse it (with
// field-registry.mjs's titlePageTemplateSegments/refreshTitlePageValues, the ONE shared Title Page
// template — see traceTitlePage's own comment) so a card's live field values, and now an edited page's
// braille too, are always exactly what traceTitlePage would braille, never a second, independently-
// computed copy.
export { titlePageFieldsFrom };
// The editor's live braille shows a block inside a list item as a block of its own (the editor's _inItem mark); it nests it as the
// list does (APH feedback 17 Oct 2026: its quotation was 2 cells left of the export's).
export { withListNestLevel };

// G8 stage 4 / BANA Formats §2.5.1, §2.5.2, §8.6.2b: the symbols a document uses that need an entry on the
// Special Symbols page. Pure: no formatting output depends on it yet.
// §2.5.2e "List symbols in braille order. See UEB, §1.1.2 ..." -> the seven-line table of UEB §1.1.2, cell by
// cell (a shorter sequence that is a prefix of a longer one sorts first), NOT order of first use.
const BRAILLE_ORDER_LINES = ['⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚', '⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞', '⠥⠧⠭⠽⠵⠯⠿⠷⠮⠾', '⠡⠣⠩⠹⠱⠫⠻⠳⠪⠺', '⠂⠆⠒⠲⠢⠖⠶⠦⠔⠴', '⠌⠬⠼⠜⠄⠤', '⠈⠘⠸⠐⠨⠰⠠'];
const BRAILLE_ORDER_RANK = new Map([...BRAILLE_ORDER_LINES.join('')].map((ch, i) => [ch.codePointAt(0) - 0x2800, i + 1]));
const ASCII_BRAILLE_DOTS = ' A1B\'K2L@CIF/MSP"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=';   // index = dot mask
const brailleOrderKey = (brl) => [...String(brl ?? '').replace(/\s+/g, '')].map((ch) => {
  const m = ASCII_BRAILLE_DOTS.indexOf(ch.toUpperCase());
  return String.fromCharCode(64 + (BRAILLE_ORDER_RANK.get(m < 0 ? 0 : m) || 0));
}).join('');
const BULLET_GLYPH_NAME = Object.fromEntries(Object.entries(BULLET_NAMES).map(([n, g]) => [g, n]));
// UEB 9.5.1: "List the transcriber-defined typeform indicator on the special symbols page
// or in a transcriber's note giving the print typeform it represents." Word-form indicator
// (BRF ASCII, see Emboss/engine/louis.mjs's TYPEFORM comment for how these were confirmed)
// per slot, 1-indexed. Slot 1 is the F-233 hyperlink indicator (HYPERLINK_OPEN/CLOSE above,
// BANA Sample 6-15, `seg.hyperlink`); slot 2 is Emboss's own strikethrough
// (`seg.transcriberTypeform === 'strike'`, UEB 9.5.1 crossed-out text — kept off slot 1 on
// purpose so a link and crossed-out text never look the same, Paul's decision). Any slot can
// ALSO arrive as BrailleBlaster's own bai-trans1..5 import (parse.mjs A24), whose print meaning
// Emboss does not know, so that gets a generic description instead — unless the slot is
// otherwise known (hyperlink/strike), in which case whichever use is found FIRST in document
// order wins the Special Symbols page entry ("first use wins", found.set is keyed by braille).
// A source combining bai-trans1 with an actual hyperlink is a genuine clash already present in
// the source (both are now the identical first-slot indicator, ambiguous in the finished
// braille); Emboss does not attempt to resolve it, only avoids crashing.
const TRANS_TF_WORD_BRL = { 1: '@#1', 2: '^#1', 3: '_#1', 4: '"#1', 5: '.#1' };
const TRANS_TF_ORDINAL = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', 5: 'Fifth' };
// PROVISIONAL wording (no transcriber-approved text yet, like SYMBOL_MEANINGS above).
function transTfDescription(n, strike) {
  return strike ? `${TRANS_TF_ORDINAL[n]} transcriber-defined typeform: crossed-out text` : `${TRANS_TF_ORDINAL[n]} transcriber-defined typeform`;
}
const HYPERLINK_TF_DESCRIPTION = `${TRANS_TF_ORDINAL[1]} transcriber-defined typeform: hyperlink`;   // F-233 / BANA Sample 6-15

// ---- K13 "List every braille symbol used" (doc.exhaustiveSymbols, field-registry.mjs) ----
// The entries above are what BANA Formats 2016 Appendix G REQUIRES on the Special Symbols page. Some agencies
// want every symbol explained regardless, so this adds the ordinary UEB indicators/punctuation Appendix G
// does NOT require: grade 1, numeric and capitals indicators (G-6/G-7 — "the letter sign" is UEB's own name
// for the grade 1 SYMBOL indicator), modified letter (accent) indicators (G-9), punctuation with a multi-cell
// braille form (G-2/G-3; single-cell punctuation, such as a comma or a hyphen, is not listed — a UEB reader
// is assumed to know those), and the standard typeform indicators (G-7 — not the transcriber-DEFINED ones
// above, which already have their own entries because their print meaning is otherwise unknown).
// braille-ASCII straight from Appendix G. Longest form first: `matchAll` below tries alternatives left to
// right, so a passage/word/terminator form is never miscounted as its own shorter prefix (;;; before ;; before ;).
// Grade 1/numeric/capitals/accents/punctuation are found by translating the document's own text (o.translate)
// and reading off whichever of these liblouis actually wrote (below) — not guessed from the print text. The
// standard typeform indicators are different: `o.translate(text, tf)` does not add them (word/passage-run
// insertion is document.mjs's own job, in formatBlock's segment grouping, not the translate function), so
// those are added directly from the tf bit on a run (TYPEFORM_WORD_INDICATORS below) — the word form shown as
// the representative one (the symbol/passage/terminator forms share the same second character, .2/.1/.7/.').
const EXHAUSTIVE_INDICATORS = [
  // Grade 1 (UEB §5.2-§5.5)
  { ascii: ';;;', description: 'Grade 1 passage indicator' },
  { ascii: ";'", description: 'Grade 1 terminator' },
  { ascii: ';;', description: 'Grade 1 word indicator' },
  { ascii: ';', description: 'Grade 1 symbol indicator (the letter sign)' },
  // Numeric (UEB §5.6, §6.1, §6.9)
  { ascii: '##', description: 'Numeric passage indicator' },
  { ascii: "#'", description: 'Numeric terminator' },
  { ascii: '#', description: 'Numeric indicator' },
  // Capitals (UEB §8.1-§8.6)
  { ascii: ',,,', description: 'Capitalized passage indicator' },
  { ascii: ",'", description: 'Capitals terminator' },
  { ascii: ',,', description: 'Capitalized word indicator' },
  { ascii: ',', description: 'Capitalized symbol indicator' },
  // Modified letter (accent) indicators (UEB §4.2)
  { ascii: '@*', description: 'Solidus overlay on the following letter' }, { ascii: '@3', description: 'Horizontal stroke overlay on the following letter' },
  { ascii: '@+', description: 'Breve above the following letter' }, { ascii: '@-', description: 'Macron above the following letter' },
  { ascii: '^&', description: 'Cedilla below the following letter' }, { ascii: '^*', description: 'Grave accent above the following letter' },
  { ascii: '^%', description: 'Circumflex above the following letter' }, { ascii: '^$', description: 'Ring above the following letter' },
  { ascii: '^]', description: 'Tilde above the following letter' }, { ascii: '^3', description: 'Diaeresis above the following letter' },
  { ascii: '^/', description: 'Acute accent above the following letter' }, { ascii: '^+', description: 'Caron above the following letter' },
  // Punctuation with a multi-cell braille form (UEB §7)
  { ascii: '444', description: 'Ellipsis' }, { ascii: '",-', description: 'Long dash' }, { ascii: ',-', description: 'Dash' },
  { ascii: '77', description: 'Double prime' }, { ascii: '33', description: 'Proportion' },
  { ascii: ',8', description: 'Opening single quotation mark' }, { ascii: ',0', description: 'Closing single quotation mark' },
  { ascii: '"<', description: 'Opening parenthesis' }, { ascii: '">', description: 'Closing parenthesis' },
  { ascii: '.<', description: 'Opening square bracket' }, { ascii: '.>', description: 'Closing square bracket' },
  { ascii: '@<', description: 'Opening angle bracket (or less-than sign)' }, { ascii: '@>', description: 'Closing angle bracket (or greater-than sign)' },
  { ascii: '_<', description: 'Opening curly bracket' }, { ascii: '_>', description: 'Closing curly bracket' },
  { ascii: '_/', description: 'Solidus (forward slash)' }, { ascii: '_*', description: 'Reverse solidus (backslash)' },
  { ascii: '"-', description: 'Minus' }, { ascii: '.-', description: 'Low line (underscore)' },
].sort((a, b) => b.ascii.length - a.ascii.length);
// One combined regex, longest alternative first (see above); braille-ASCII regex metacharacters escaped.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EXHAUSTIVE_RE = new RegExp(EXHAUSTIVE_INDICATORS.map((e) => escapeRe(e.ascii)).join('|'), 'g');
const EXHAUSTIVE_BY_ASCII = new Map(EXHAUSTIVE_INDICATORS.map((e) => [e.ascii, e]));
// Every plain-text string in the document, with the typeform (tf) it carries, if any — the exhaustive scan
// translates each one itself (o.translate) and reads off whichever indicators liblouis actually wrote, rather
// than guessing from the print text. Skips literal `brl` cells (already collected above; translating their
// `text` would not reproduce the literal cell), maths/noteref/linenum segments (not plain text), and the
// Transcriber's Notes / Special Symbols pages themselves.
function collectPlainText(blocks, depth = 0, withBullets = false) {
  const out = [];
  if (!Array.isArray(blocks) || depth > 14) return out;
  for (const n of blocks) {
    if (Array.isArray(n)) { for (const x of collectPlainText(n, depth + 1, withBullets)) out.push(x); continue; }
    if (typeof n === 'string') { if (n.trim()) out.push({ text: n, tf: 0 }); continue; }
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'tnpage' || n.type === 'sympage') continue;
    if (withBullets && typeof n.marker === 'string' && customBulletGlyph(n.marker)) out.push({ bullet: customBulletGlyph(n.marker) });   // IMP-W7: a list item's custom print bullet, in document order (preassignIconSymbols only)
    if (typeof n.text === 'string' && n.text.trim() && n.type !== 'brl') out.push({ text: n.text, tf: 0 });
    if (Array.isArray(n.segments)) {
      for (const sg of n.segments) {
        if (!sg || typeof sg !== 'object' || sg.type === 'brl' || sg.type === 'math' || sg.type === 'noteref' || sg.type === 'linenum') continue;
        if (typeof sg.text === 'string' && sg.text.trim()) out.push({ text: sg.text, tf: Number(sg.tf) || 0 });
      }
    }
    for (const key of ['blocks', 'entries', 'paragraphs', 'rows', 'cells', 'header', 'items']) if (Array.isArray(n[key])) for (const x of collectPlainText(n[key], depth + 1, withBullets)) out.push(x);   // (a loop: a spread of a huge array overflows the stack)
  }
  return out;
}
// TF bit (louis.TYPEFORM / editor.mjs) -> the standard typeform's word-form indicator (UEB §9, Appendix G G-7).
const TYPEFORM_WORD_INDICATORS = {
  1: { ascii: '.1', description: 'Italic indicator' },
  2: { ascii: '_1', description: 'Underlined indicator' },
  4: { ascii: '^1', description: 'Bold indicator' },
};
// ICON-1: the document's assigned icon symbols (preassignIconSymbols, or the lazy per-`o`
// assignment a direct formatBlock/traceBlock caller with no whole document to pre-scan still gets)
// that this BLOCKS subset actually uses — checked directly against the print text (no need to
// re-translate: the character itself, e.g. ☞, is what appears in the source, and o.translate has
// already been called on it by the time collectSpecialSymbols runs). Used both for the whole-
// document Special Symbols page (resolveSymPages) and for each volume's own page (KD round-2 Q7d:
// "each listing that volume's symbols" — formatVolumesFromBuild's BANA branch already re-derives
// collectSpecialSymbols per volume for bullets/typeforms; icons now do too, automatically).
function collectIconSymbols(blocks, o, add) {
  if (!o || !isBanaOpts(o) || !o._iconSymbols || !o._iconSymbols.size) return;
  const text = collectPlainText(blocks).map((t) => t.text).join('\n');
  if (!text) return;
  for (const entry of o._iconSymbols.values()) {
    if (text.includes(entry.char)) add({ print: entry.char, braille: entry.brl, kind: 'literal', description: entry.description, firstUse: [] });
  }
}
// Add every ordinary indicator/punctuation entry EXHAUSTIVE_RE finds in the document's own translated braille,
// plus one entry per standard typeform (italic/underline/bold) actually used (see the TF bit comment above).
// Runs after the required-symbol walk, so a hypothetical clash keeps the required entry (found.has wins first).
function collectExhaustiveSymbols(blocks, o, add) {
  if (typeof o?.translate !== 'function') return;   // no engine to hand (e.g. a unit test with a plain {} opts) — nothing to add
  const seenTf = new Set();
  for (const { text, tf } of collectPlainText(blocks)) {
    if (tf && TYPEFORM_WORD_INDICATORS[tf] && !seenTf.has(tf)) {
      seenTf.add(tf);
      const e = TYPEFORM_WORD_INDICATORS[tf];
      add({ print: '', braille: e.ascii, kind: 'exhaustive', description: e.description, firstUse: [] });
    }
    let brl;
    try { brl = String(o.translate(text) ?? ''); } catch { continue; }
    if (!brl) continue;
    for (const m of brl.matchAll(EXHAUSTIVE_RE)) {
      const e = EXHAUSTIVE_BY_ASCII.get(m[0]);
      if (e) add({ print: '', braille: e.ascii, kind: 'exhaustive', description: e.description, firstUse: [] });
    }
  }
}
// collectSpecialSymbols(blocks, o) -> [{ print, braille, kind: 'bullet'|'literal'|'typeform'|'exhaustive', name?, level?, firstUse: [index path] }]
// Bullet glyphs the formatter knows (BULLET_BRAILLE, primary bullet _4 excluded, §8.6.2b), literal-cell
// segments { type:'brl' } (transcriber-defined symbols etc.), the hyperlink indicator (`seg.hyperlink`,
// F-233) and any transcriber-defined typeform slot (transcriberTypeform) in use, one entry per slot
// (UEB 9.5.1, above). De-duplicated by braille; first use wins.
function collectSpecialSymbols(blocks, o) {
  const found = new Map();
  const add = (e) => { if (e.braille && !found.has(e.braille)) found.set(e.braille, e); };
  const segs = (list, path) => {
    if (!Array.isArray(list)) return;
    list.forEach((sg) => {
      if (sg && typeof sg === 'object' && sg.type === 'brl' && String(sg.brl ?? '').trim()) add({ print: String(sg.text ?? ''), braille: String(sg.brl).trim(), kind: 'literal', firstUse: path });
      // LINK-2: an underlined link (seg.tf carries TF_UNDERLINE) uses UEB's own underline
      // typeform instead of the transcriber-defined hyperlink slot (see groupSegments'
      // `linkUnderline` / HYPERLINK_OPEN's own comment) — no Special Symbols entry for it.
      if (sg && typeof sg === 'object' && sg.hyperlink && !((sg.tf || 0) & TF_UNDERLINE)) add({ print: '', braille: TRANS_TF_WORD_BRL[1], kind: 'typeform', description: HYPERLINK_TF_DESCRIPTION, firstUse: path });
      if (sg && typeof sg === 'object' && typeof sg.transcriberTypeform === 'string') {
        if (sg.transcriberTypeform === 'strike') {
          add({ print: '', braille: TRANS_TF_WORD_BRL[2], kind: 'typeform', description: transTfDescription(2, true), firstUse: path });
        } else {
          const m = /trans([1-5])$/.exec(sg.transcriberTypeform);
          if (m) { const n = Number(m[1]); add({ print: '', braille: TRANS_TF_WORD_BRL[n], kind: 'typeform', description: transTfDescription(n, false), firstUse: path }); }
        }
      }
    });
  };
  const walk = (list, base, depth) => {
    if (!Array.isArray(list) || depth > 12) return;
    list.forEach((n, i) => {
      if (Array.isArray(n)) { walk(n, [...base, i], depth + 1); return; }      // rows of cells
      if (!n || typeof n !== 'object') return;
      const path = [...base, i];
      segs(n.segments, path);
      if (Array.isArray(n.items)) {
        n.items.forEach((it, k) => {
          if (!it || typeof it !== 'object') return;
          const b = itemBullet(it, n, o);
          if (b && b.custom) {
            add({ print: b.custom.char, braille: b.brl, kind: 'bullet', description: b.custom.description, level: it.level || 0, firstUse: [...path, k] });   // IMP-W7: a custom print bullet
          } else if (b && b.brl !== UEB_BULLET) {
            let g = bulletGlyph(it.bullet) ?? (it.marker ? bulletGlyph(it.marker) : null);
            if ((g === '•' || g == null) && !it.bullet && (it.level || 0) > 0 && levelBulletsOn(n, o)) g = bulletGlyph(levelBulletGlyph(n, it.level || 0)) ?? g;   // level glyph (stage 1)
            add({ print: g ?? '', braille: b.brl, kind: 'bullet', name: BULLET_GLYPH_NAME[g] ?? '', level: it.level || 0, firstUse: [...path, k] });
          }
          segs(it.segments, [...path, k]);
          if (Array.isArray(it.blocks)) walk(it.blocks, [...path, k], depth + 1);
        });
      }
      for (const key of ['blocks', 'entries', 'paragraphs', 'rows', 'cells', 'header']) if (Array.isArray(n[key])) walk(n[key], path, depth + 1);
    });
  };
  walk(blocks, [], 0);
  collectForeignSigns(blocks, o, add);   // K16: foreign alphabet signs (BANA 21.6.3c, Appendix G; foreignText only)
  collectIconSymbols(blocks, o, add);   // ICON-1: icons (assigned by preassignIconSymbols/replaceUndefinedChar) this BLOCKS subset actually uses
  if (o?.exhaustiveSymbols === true) collectExhaustiveSymbols(blocks, o, add);   // K13: opt-in, everything above is still what BANA requires
  return [...found.values()].sort((a, b) => (brailleOrderKey(a.braille) < brailleOrderKey(b.braille) ? -1 : brailleOrderKey(a.braille) > brailleOrderKey(b.braille) ? 1 : 0));
}
export { collectSpecialSymbols };
export { customBulletGlyph };   // IMP-W7: tests/custom_bullets.test.mjs keeps it in step with input/nimas-export.mjs isCustomBulletMarker
export { symbolMeaning };

// ---- Suggested Transcriber's Notes entries (transcriber-pages-plan.md §9 row 5; Paul, 23 Sep 2026) ----
// suggestTranscriberNotes(blocks, o) -> [{ id, text, reason, source, provisional }]. Pure. Emboss OFFERS these when the
// Transcriber's Notes page is created; the transcriber accepts, edits or deletes each, and nothing reaches the page
// without an explicit accept. `id` is stable (no counts in it) so a dismissed suggestion stays dismissed.
// `source` is 'BANA' where the wording is BANA's own example, otherwise 'provisional': PROVISIONAL wording is Emboss's
// placeholder until the transcribers supply theirs (questions-round-2.md) -- replace the strings, keep the ids.
export function suggestTranscriberNotes(blocks, o = {}) {
  const found = new Map();
  const add = (id, text, reason, source) => { if (!found.has(id)) found.set(id, { id, text, reason, source, provisional: source !== 'BANA' }); };
  // UK-8 (28 Sep): "No suggestions are offered for it in UKAAF ... entirely the transcriber's page"
  // (James: the UK "Note to Braille Edition" is "entirely at the transcriber's discretion"). Read as
  // covering BANA's own detected-feature/Appendix-A-style heuristics below (picture-omitted, blocked-
  // paragraphs, table layout, typeforms, special symbols, print-page-numbers, foreign-list-letters,
  // poem-line-indicator) — every "Emboss noticed something, here is a note" suggestion, which stay
  // BANA-only. NOT read as reaching UK-3's quote-exchange note further down (26 Sep, docs/decisions.md
  // "UKAAF"): that one is not a heuristic but a note RUEB 7.6.4 itself REQUIRES once the transcriber
  // turns exchange quoting on — an already-shipped, already-tested UKAAF feature
  // (tests/ukaaf_uk1_uk3_uk4.test.mjs) UK-8's later, broader wording does not name, and which this
  // function would otherwise (and wrongly) also suppress. A judgement call where the two decisions
  // overlap, flagged for Paul to confirm — see this file's report.
  if (isBanaOpts(o)) {
    const cnt = { blocked: 0, ignoreFont: 0, omitEmph: 0, pic: 0, brl: 0, pn: {} };
    const tables = new Set();
    let poemLI = false;
    const walk = (list, depth) => {
      if (!Array.isArray(list) || depth > 12) return;
      for (const b of list) {
        if (!b || typeof b !== 'object' || b.type === 'tnpage' || b.type === 'sympage') continue;
        if (b.type === 'para' && b.blocked) cnt.blocked++;
        if (b.ignoreFont || (Array.isArray(b.segments) && b.segments.some((s) => s && s.ignoreFont)) || (Array.isArray(b.items) && b.items.some((it) => it && it.ignoreFont))) cnt.ignoreFont++;
        if (b.omitEmphasis || b.omitFullEmphasis) cnt.omitEmph++;
        if ((b.type === 'graphic' || b.type === 'tactile' || b.type === 'image') && isPrintImage(b)) {
          const p = printImageParts(b);
          if (!p.caption && !p.description && !p.citation) cnt.pic++;
        }
        if (b.type === 'table') {
          let layout = null;
          try { layout = tableLayout(b, o); } catch (e) { layout = null; }
          if (!layout && ['listed', 'vertical', 'facing', 'interchange', 'stairstep', 'linear'].includes(b.format)) layout = b.format;
          if (['listed', 'vertical', 'facing', 'interchange', 'stairstep', 'linear', 'paragraph'].includes(layout)) tables.add(layout);
        }
        if (b.type === 'pagenum') {
          if (b.implied) cnt.pn.implied = (cnt.pn.implied || 0) + 1;
          if (b.spelled) cnt.pn.spelled = (cnt.pn.spelled || 0) + 1;
          if (b.through || b.combineWithNext) cnt.pn.combined = (cnt.pn.combined || 0) + 1;
          if (b.unnumbered) cnt.pn.unnumbered = (cnt.pn.unnumbered || 0) + 1;
        }
        if (b.poemMethod === 'line-indicator') poemLI = true;
        for (const key of ['blocks', 'entries', 'paragraphs']) if (Array.isArray(b[key])) walk(b[key], depth + 1);
        if (Array.isArray(b.items)) for (const it of b.items) if (it && Array.isArray(it.blocks)) walk(it.blocks, depth + 1);
      }
    };
    walk(blocks, 0);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (cnt.pic) add('picture-omitted', 'Illustrations without captions are omitted.',
      `${plural(cnt.pic, 'picture has', 'pictures have')} no caption, description or alt text, so ${cnt.pic === 1 ? 'it is' : 'they are'} left out of the braille (BANA 6.4.1).`, 'BANA');   // BANA Sample 2-6-1d's own note
    if (cnt.blocked) add('blocked-paragraphs', 'Paragraphs are blocked (no first-line indent).',   // PROVISIONAL wording
      `${plural(cnt.blocked, 'paragraph is', 'paragraphs are')} set in blocked format (BANA 1.9.3) where print indents; BANA 15.9.3g asks for changes in print format to be noted.`, 'provisional');
    for (const layout of tables) {
      const names = { listed: 'listed', vertical: 'divided vertically', facing: 'across facing pages', interchange: 'with its columns and rows interchanged', stairstep: 'in stairstep format', linear: 'in linear format', paragraph: 'in paragraph form' };
      add(`table-${layout}`, `A table is ${layout === 'listed' ? 'shown in listed format' : layout === 'paragraph' ? 'shown in paragraph form' : `shown ${names[layout]}`}.`,   // PROVISIONAL wording
        (layout === 'interchange' ? 'A table is brailled with its print columns as rows and its print rows as columns (BANA 11.15, chosen by the transcriber); its own transcriber\'s note says so before the table, and BANA 15.9.3g asks for changes in print format to be noted.' : `A table is brailled ${layout} instead of columns like the print (too wide for the line, or chosen by the transcriber); BANA 15.9.3g asks for changes in print format to be noted.`), 'provisional');
    }
    if (cnt.ignoreFont || cnt.omitEmph) add('typeforms-not-shown', 'Print typeforms (italics, bold, and so on) are not shown in this braille.',   // PROVISIONAL wording
      `${plural(cnt.ignoreFont + cnt.omitEmph, 'block has', 'blocks have')} its print typeform marks left out (ignore-font or omitted emphasis).`, 'provisional');
    if (collectSpecialSymbols(blocks, o).some((s) => s.kind === 'literal')) add('special-symbols', 'Symbols defined by the transcriber are listed on the Special Symbols page.',   // PROVISIONAL wording
      'The document has literal braille cells (transcriber-defined symbols); the Special Symbols page explains them (BANA 2.5).', 'provisional');
    if (collectSpecialSymbols(blocks, o).some((s) => s.kind === 'typeform')) add('transcriber-typeform', 'Crossed-out (or otherwise specially marked) print uses a transcriber-defined typeform indicator, explained on the Special Symbols page.',   // PROVISIONAL wording
      'The document has print marked in a way UEB has no standard typeform indicator for (such as crossed-out text); a transcriber-defined typeform indicator (UEB 9.5.1) is used instead, and listed on the Special Symbols page.', 'provisional');
    const pnKinds = Object.keys(cnt.pn);
    if (pnKinds.length) add('print-page-numbers', 'Print page numbers are shown differently from the print: some are implied, spelled out, combined or omitted.',   // PROVISIONAL wording
      `Print page numbering changes were found (${pnKinds.join(', ')}); BANA 1.11 and 1.14 say how each is shown.`, 'provisional');
    if (o && (o.foreignText || o.doc?.foreignText)) {             // K16 / BANA 8.10, 10.1.6c: "Explain this usage in a transcriber's note."
      const lc = foreignListCounts(blocks);
      if (lc.foreign && lc.english) add('foreign-list-letters', 'Letters that identify list items, exercise items and answer choices are shown as English letters, with grade 1 indicators where UEB needs them, in the foreign-language lists as well as the English ones.',   // PROVISIONAL wording
        `The text has ${plural(lc.foreign, 'foreign-language list', 'foreign-language lists')} and ${plural(lc.english, 'English list', 'English lists')}; BANA 8.10 and 10.1.6c treat all identifying letters as English and ask for a transcriber's note.`, 'provisional');
    }
    if (poemLI) add('poem-line-indicator', 'Poems are written continuously, with a line indicator at the end of each line.',   // PROVISIONAL wording
      'A poem uses the UKAAF line-indicator method (B004 Appendix J), which differs from the print layout.', 'provisional');
  }
  // UK-3 (docs/decisions.md "UKAAF"): quoteStyle: 'exchange' (web/settings.mjs, format/text-style.mjs's
  // exchangeQuotes/styledTranslate) already implements RUEB 7.6.4's "use the double quotation sign for all
  // quotations" — this offers the note RUEB 7.6.4 itself requires when that choice is made: "Explain this
  // change in a transcriber's note." Like every other suggestion here, it is only OFFERED: nothing reaches
  // the Transcriber's Notes page without the transcriber's own explicit Add (TP-4). Deliberately OUTSIDE
  // the `isBanaOpts(o)` gate above — see the UK-8 comment at the top of this function.
  if (o && o.quoteStyle === 'exchange') add('quote-exchange', 'The double quotation sign is used for all quotations.',   // PROVISIONAL wording
    'This document uses the double-quote sign for every quotation, even where print used single quotes (RUEB 7.6.4 permits exchanging the double and single quotation-mark assignment, and asks for a transcriber\'s note explaining it).', 'provisional');
  return [...found.values()];
}
