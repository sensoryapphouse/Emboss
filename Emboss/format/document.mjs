// Document formatter: a structured document model -> content lines -> BRF.
// Block layout follows the Rule Register (SETUP_AND_VALIDATION.md), switchable
// by mode ('ukaaf' | 'bana'). Paragraph wrapping and page assembly are the
// gold-validated primitives from layout.js / page.js.
import { formatParagraph, wrapCells, wrapCellsSrc, LN_OPEN, LN_CLOSE, hasLineNumbers, stripLineNumbers, wrapNumbered } from './layout.mjs';
import { assemble, toBRF, brailleNumber, linesPerPage, banaPageChangeNumber, renumberPage } from './page.mjs';
import { unicodeBrailleToBrf, BRF64 } from '../engine/brf-ascii.mjs';
import { cellSegments, cellPlainText, cellIsBlank } from './cell-markup.mjs';
import { STYLE_DEFINITIONS, getStyleMargins, isListStyle, resolveStyleFromXml } from './styles.mjs';

export { STYLE_DEFINITIONS, getStyleMargins, isListStyle, resolveStyleFromXml };

const rightJustify = (text, width) => ' '.repeat(Math.max(0, width - text.length)) + text;

// BRF indicators concatenated AFTER translation (never fed to the print translator):
// UEB transcriber's note @.< … @.> (dots 4,46,126 / 4,46,345; UEB §3.27, used by
// both B004 and Formats §3.2); grade-1 passage ;;; … ;' and grade-1 word ;; (UEB §5).
const TN_OPEN = '@.<', TN_CLOSE = '@.>';
const G1_PASSAGE_OPEN = ';;;', G1_TERMINATOR = ";'", G1_WORD = ';;';
// Any string that must land in the BRF as cells: Unicode braille is mapped to BRF
// ASCII (dots 7/8 masked) and anything else outside the 64-cell set becomes a blank.
const BRF_CHARS = new Set(BRF64);
const toBrfCells = (str) => unicodeBrailleToBrf(String(str ?? '')).split('').map((c) => (BRF_CHARS.has(c) ? c : ' ')).join('');

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
  if (mode !== 'bana') {
    if (kind === 'list' || kind === 'exercise') {
      if (listStyle === 'compact') return { first: 4 + lvl * 2, runover: 0 };       // B004 §10 Ex2 / App C Ex2
      if (deepest === 0) return { first: 0, runover: 2 };                            // B004 §10 Ex1
      return { first: lvl * 2, runover: lvl * 2 + 4 };                               // B004 App C Ex1
    }
    if (kind === 'poetry') return { first: lvl * 2, runover: Math.max(4, deepest * 2 + 2) };   // B004 App J
  }
  return { first: lvl * 2, runover: deepest * 2 + 2 };
}
// The B004 §10 Ex2 'compact' list style is a UKAAF house style; Formats §8 has no
// equivalent, so the option is ignored in BANA mode.
const isCompactList = (o) => o.listStyle === 'compact' && o.mode !== 'bana';

// Formats §4.3.7 (and B004 §5's "maximise the use of space"): font attributes are
// ignored in centred, cell-5 and cell-7 headings; §14.4.1c: likewise in stage
// directions. Drop `tf` from the text runs before translation, keeping uncontracted
// (grade 1) runs and inline maths as they are.
const stripEmphasis = (segments) => (Array.isArray(segments)
  ? segments.map((s) => (s && s.type !== 'math' && s.tf) ? { ...s, tf: undefined } : s)
  : segments);

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
//                         connected headings" (Examples 4-2/4-3/4-4 are each one
//                         conceptual heading split across two centred lines: title +
//                         author, chapter number + title, unit number + title — all
//                         same-tier).
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
function joinsWithoutBlank(prev, block, o) {
  if (o.mode !== 'bana' || !prev || !block || prev.type !== 'heading') return false;
  if (block.type === 'heading') return HEADING_JOIN_TIERS.has(`${banaTier(prev.level, o)}>${banaTier(block.level, o)}`);
  const prevTier = banaTier(prev.level, o);
  if (prevTier === 'centred') return false;
  // §1.9.3's own exception, having failed the centred check above `prevTier` is now either
  // cell-5 or cell-7: "[a blank line precedes each blocked paragraph] unless it follows a
  // cell-5 or cell-7 heading" — drop the blocked paragraph's own leading blank (F-39).
  if (block.type === 'para' && block.blocked) return true;
  return block.type === 'list' || block.type === 'glossary' || isVerseBlock(block);
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
//  Font attributes are ignored in all levels (Formats §4.3.7; see stripEmphasis), except
//  the synthetic bold UKAAF adds at L4/L6 (see forceBold).
function formatHeading(block, o, atStart) {
  const w = o.width;
  const L = block.level || 1;
  const out = [];
  const plainT = () => (block.segments ? segmentsToBraille(stripEmphasis(block.segments), o) : o.translate(block.text ?? ''));
  const boldT = () => {
    if (block.segments) return segmentsToBraille(forceBold(stripEmphasis(block.segments)), o);
    const text = block.text ?? '';
    return o.translate(text, Array(text.length).fill(TF_BOLD));
  };
  if (o.mode === 'bana') {
    const tier = banaTier(L, o);                                                          // §4.2.1-2, see banaHeadingTiers
    if (tier === 'cell5') { out.push('', ...wrapCells(plainT(), w, 4, 4)); }              // cell-5 (§4.5)
    else if (tier === 'cell7') { out.push('', ...wrapCells(plainT(), w, 6, 6)); }         // cell-7 (§4.6)
    else { out.push('', ...centredHeadingBlock(plainT(), w, Math.max(1, w - 6)), ''); }   // centred (§4.4.1-2, §4.4.3)
  } else {
    // §5: an L1 heading is centred and preceded by an indicator line. The indicator is an
    // "end marker … placed after a section is complete" (B004 R17), so there is nothing for
    // it to close at the very top of a document — emit the heading alone (and no leading
    // blank line) when it opens the document.
    if (L === 1) {
      if (atStart) out.push(...centredBlock(plainT(), w));
      else out.push('', indicatorLine('dot2s', w), ...centredBlock(plainT(), w));
    } else if (L === 2 || L === 5) { out.push('', ...wrapCells(plainT(), w, 0, 4)); }      // cell 1 / runover 5 (§5 L2; App A L5)
    else if (L === 3) { out.push('', ...wrapCells(plainT(), w, 2, 4)); }                  // cell 3 / runover 5 (§5 L3)
    else if (L === 4) { out.push('', ...wrapCells(boldT(), w, 0, 4)); }                   // App A L4: cell 1 / runover 5, bold
    else { out.push('', ...wrapCells(boldT(), w, 2, 4)); }                                // App A L6: cell 3 / runover 5, bold
  }
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Centred title used once at the top of a document (B004 §5 / Formats §2.10).
// Wrapped + each line centred independently if longer than the page width
// (see centredBlock; gold-verified against sample3's multi-line headline).
function formatTitle(block, o) {
  return centredBlock(o.translate(block.text ?? ''), o.width).map((l) => l.replace(/\s+$/, ''));
}

// List (B004 §10, R2/R3; Formats §8). Two standard house styles, chosen by o.listStyle:
//   'spaced' (default, B004 §10 Ex1 / Formats §8.3): blank line before & after; entry
//       cell 1, runover cell 3 (1-3); print marker kept in cell 1; nested levels per
//       nestedMargins (Formats §8.5.1b / B004 App C Ex1).
//   'compact'  (B004 §10 Ex2, UKAAF only): entry cell 5, runover cell 1 (5-1); print
//       markers ignored; no blank lines; nested further indents cell 7, 9 (5/1, 7/1, 9/1).
// kind 'exercise' (Formats §10.4), 'index' (§21.2.1b / B004 App I) and 'toc' (§2.10.6b)
// take the same nested pattern via nestedMargins. A '•' print bullet is retained as the
// UEB bullet _4 (dots 456, 256; Formats §8.6.2a), added after translation.
const UEB_BULLET = '_4';
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
  const pages = (block.items || []).filter((it) => it && it.page).map((it) => tr(String(it.page).trim()));
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
  const key = tocKey(item.title ?? item.text);
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
  const comma = /[,:;.]$/.test(plain) ? '' : o.translate(',').trim();
  return comma + ' ' + o.translate(page).trim();
}
const tocInColumns = (kind, item, cols, o) => kind === 'toc' && item.page && (cols || isBanaOpts(o));

function formatList(block, o) {
  const items = block.items ?? [];
  if (!items.length) return [];
  if (block.kind === 'glossary' || block.style === 'glossary') return formatGlossary(block, o);
  const compact = isCompactList(o);
  const kind = block.kind;
  const mkind = listMarginKind(kind);
  const maxLevel = listMaxLevel(block);                // the whole block sets the runover position
  const out = [...lineNumberNote(block, o), ...(compact ? [] : [''])];   // Ex1 has a blank line before
  const tocCols = kind === 'toc' ? tocColumns(block, o) : null;
  let tocHeaderDone = false;
  for (const item of items) {
    if (!item) continue;
    const lvl = item.level || 0;
    const { first, runover } = nestedMargins(mkind, lvl, maxLevel, o.mode, o.listStyle);
    if (tocInColumns(kind, item, tocCols, o)) {
      const transTitle = (item.segments
        ? segmentsToBraille(item.segments, o)
        : o.translate(item.title ?? item.text ?? '')).replace(/\s+/g, ' ').trim();
      const transPage = o.translate(item.page).trim();
      const nul = (str) => ({ s: str, src: Array.from(str, () => null) });
      if (tocCols && !tocHeaderDone) { out.push(...tocCols.header); tocHeaderDone = true; }
      out.push(...tocEntryLines(o, nul(transTitle), nul(transPage), tocBraillePage(item, o), tocCols, first, runover).map((l) => l.s));
      continue;
    }
    const pageBrl = pageSuffix(item, o);

    const marker = compact ? '' : (item.marker ? item.marker + ' ' : '');  // Ex2 ignores markers
    let body;
    if (marker && item.marker === '•') {                                   // §8.6.2a: the bullet is a BRF indicator
      body = UEB_BULLET + ' ' + (item.segments ? segmentsToBraille(item.segments, o) : o.translate(item.text ?? ''));
    } else if (item.segments) {                                            // list item with inline maths
      body = (marker ? o.translate(marker).trim() + ' ' : '') + segmentsToBraille(item.segments, o, true);
    } else {
      body = o.translate(marker + (item.text ?? ''));
    }
    if (pageBrl) body = body.replace(/\s+$/, '') + pageBrl;
    out.push(...wrapBody(body, o, o.width, first, runover));
  }
  if (!compact) out.push('');                          // Ex1 has a blank line after
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Displayed / quoted material: a `para` whose style is quote-like (the parser emits
// {type:'para', style:'quote'} for <blockquote> / class="quote" / "extract"; an
// epigraph is set the same way). Returns the margins and blank-line rule, or null
// for body text. Shared by formatPara / formatSegmentedPara and traceBlock.
//  BANA (Formats §9.2.2): the adjusted left margin is 2 cells to the right of the
//    runover position of the surrounding text — cell 3 for body text — and
//    paragraphs are blocked at it (§9.2.2d), i.e. 3-3. A blank line precedes and
//    follows displayed material (§9.2.2a) but none separates the paragraphs of one
//    displayed passage (§9.2.2b): every quote paragraph carries both blanks and the
//    block loop in buildDocPages collapses the adjacent pair between two quote
//    paragraphs to a single blank. Nested displayed matter (block.level, e.g. a
//    quote inside a list) moves a further 2 cells per level (§9.2.2 example).
//  UKAAF (B004 App. B "Good practice example of paragraph layout" / App. G Ex. 2):
//    a set-out quoted passage is indented 4 cells — "new paragraphs start in cell 7
//    with runover lines in cell 5" (7-5) — and "otherwise, no blank lines are used"
//    (a blank line only between two separate extracts, which the model cannot tell
//    from two paragraphs of one extract, so none is emitted).
const QUOTE_STYLES = new Set(['quote', 'blockquote', 'extract', 'epigraph', 'displayed']);
function quoteMargins(block, o) {
  if (!block || !QUOTE_STYLES.has(String(block.style ?? '').toLowerCase())) return null;
  const nest = Math.max(0, Number(block.level) || 0) * 2;
  return o.mode === 'bana'
    ? { first: 2 + nest, runover: 2 + nest, blank: true }
    : { first: 6 + nest, runover: 4 + nest, blank: false };
}
const withQuoteBlanks = (lines, q) => (q.blank ? ['', ...lines, ''] : lines);
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
function formatPara(block, o) {
  const q = quoteMargins(block, o);
  if (block.segments) return formatSegmentedPara(block.segments, o, block, q);
  const text = block.text ?? '';
  if (!text.trim()) return [];                          // empty paragraph -> no lines
  if (q) return quoteLines(formatParagraph(text, o.translate, { width: o.width, first: block.continuation ? q.runover : q.first, runover: q.runover }), q, block);
  const blocked = !!block.blocked;
  const isBlock = o.paragraphStyle === 'block';
  const first = (blocked || isBlock || block.continuation) ? 0 : 2;
  const lines = formatParagraph(text, o.translate, { width: o.width, first, runover: 0 });
  if (blocked && !block.continuation) lines.unshift(''); // §1.9.3: blank line precedes (dropped by joinsWithoutBlank after cell-5/7)
  else if (isBlock && !block.continued) lines.push('');       // the paragraph has not ended yet
  return lines;
}

// Group inline segments for translation: adjacent contracted text segments form ONE run
// with a per-character typeform array, so liblouis sees the whole symbols-sequence —
// translated one segment at a time it never saw the unemphasised punctuation after a bold
// word and dropped the terminator (UEB §9: `^1emphasis^'1`, not `^1emphasis1`; A27a).
// Maths and uncontracted (grade 1) segments stay separate. `len` is each group's length
// in the flat text (maths counts as `$latex$`), which the cell trace uses for positions.
function groupSegments(segments) {
  const groups = [];
  for (const seg of segments || []) {
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
    const t = String(seg.text ?? '').replace(/[^\S\n]+/g, ' ');    // collapse horizontal space runs; keep \n
    if (!t) continue;
    const last = groups[groups.length - 1];
    if (!seg.uncontracted && last && last.text != null && !last.uncontracted) {
      last.text += t;
      for (let i = 0; i < t.length; i++) last.tf.push(seg.tf || 0);
    } else {
      groups.push({ text: t, tf: Array(t.length).fill(seg.tf || 0), uncontracted: !!seg.uncontracted });
    }
    groups[groups.length - 1].len = groups[groups.length - 1].text.length;
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
const NOTE_SYMBOLS = { '*': '"9', '∗': '"9', '†': '@,?', '‡': '@,]' };
function noterefBraille(seg, o) {
  const mark = String(seg.text ?? '').trim();
  if (!mark) return '';
  if ([...mark].every((ch) => NOTE_SYMBOLS[ch])) return [...mark].map((ch) => NOTE_SYMBOLS[ch]).join('');
  if (/^[a-z]+$/.test(mark)) return `;9${mark.toUpperCase()}`;
  if (/^[A-Z]$/.test(mark)) return `;9,${mark}`;
  return `;9${o.translate(mark).trim()}`;
}

// A print line number (A30) in the braille stream: a word of its own (see wrapNumbered).
const lineNumberWord = (seg, o) => {
  const t = String(seg.text ?? '').trim();
  return t ? ` ${LN_OPEN}${o.translate(t).trim()}${LN_CLOSE} ` : '';
};
// Wrap a paragraph or list item: line-numbered text (BANA Formats §15.3–15.4) takes the
// numbered wrap; the document's widest number (o.lineNumberWidth) sets the text width.
function wrapBody(braille, o, width, first, runover) {
  if (!hasLineNumbers(braille)) return wrapCells(braille, width, first, runover);
  return wrapNumbered(braille, null, width, first, runover, o.lineNumberWidth || 0).lines;
}
function tcWrapBody(o, tr, width, first, runover) {         // mirror wrapBody
  if (!hasLineNumbers(tr.s)) return tcWrap(o, tr, width, first, runover);
  const { lines, srcs } = wrapNumbered(tr.s, tr.src, width, first, runover, o.lineNumberWidth || 0);
  return lines.map((line, i) => tcRstrip({ s: line, src: srcs[i] }));
}
// The transcriber's note before the first line-numbered text (BANA Formats §15.4.1d):
// only the lines print numbers are numbered, so the reader is told (A30).
const LINE_NUMBER_NOTE = 'Line numbers are shown at the right margin where print numbers a line. Three blank cells within a braille line show where that print line begins.';
function lineNumberNote(block, o) {
  if (!block.lnNote) return [];
  const { first, runover } = tnMargins(o);
  return wrapCells(TN_OPEN + o.translate(LINE_NUMBER_NOTE).trim() + TN_CLOSE, o.width || 38, first, runover).map((l) => l.replace(/\s+$/, ''));
}

// Render a mixed run of text/math segments into one braille string (no wrapping).
// Shared by paragraphs, list items and headings that contain inline maths.
function segmentsToBraille(segments, o, lineNumbers = false) {
  let braille = '';
  const translateLine = (str, tf, isUncontracted) => {
    if (!str) return '';
    if (isUncontracted) {
      // Uncontracted (grade 1) run inside grade-2 text: translate with the G1 table
      // when the caller supplies one, then mark it with the UEB grade-1 word
      // indicator (single word) or passage indicator + terminator (UEB §5.4-5.5).
      const g1 = o.translateG1 || o.translateUncontracted;
      const tr = g1 ? g1(str) : (tf ? o.translate(str, tf) : o.translate(str));
      return str.includes(' ') ? `${G1_PASSAGE_OPEN}${tr}${G1_TERMINATOR}` : `${G1_WORD}${tr}`;
    }
    return tf ? o.translate(str, tf) : o.translate(str);
  };
  for (const g of groupSegments(segments)) {
    if (g.noteref) { braille += noterefBraille(g.noteref, o); continue; }
    if (g.linenum) { if (lineNumbers) braille += lineNumberWord(g.linenum, o); continue; }
    if (g.math) {
      if (!o.mathToBrf) continue;
      try { const brf = o.mathToBrf(g.math); if (brf) braille += brf; }
      catch (e) { if (typeof console !== 'undefined') console.warn('[maths] inline equation skipped:', (e && e.message) || e); }
      continue;
    }
    braille += g.lines.map((l) => translateLine(l.text, l.tf, g.uncontracted)).join('\n');
  }
  return braille.replace(/^[^\S\n]+|[^\S\n]+$/g, '');          // trim boundary spaces, keep newlines
}

function formatSegmentedPara(segments, o, block = null, q = null) {
  const braille = segmentsToBraille(segments, o, true);
  if (!stripLineNumbers(braille)) return [];
  const note = block ? lineNumberNote(block, o) : [];
  if (q) return [...note, ...quoteLines(wrapBody(braille, o, o.width, block?.continuation ? q.runover : q.first, q.runover), q, block)];
  const blocked = !!block?.blocked;                      // see formatPara's comment (F-39 / §1.9.3)
  const isBlock = o.paragraphStyle === 'block';
  const first = (blocked || isBlock || block?.continuation) ? 0 : 2;
  const lines = wrapBody(braille, o, o.width, first, 0);
  if (blocked && !block?.continuation) lines.unshift('');
  else if (isBlock && !block?.continued) lines.push('');
  return [...note, ...lines];
}

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
  return { segs: segs.filter((g) => g.type === 'math' || g.text), offset };
}
function formatTranscriberNote(block, o) {
  const w = o.width || 38;
  const inner = segmentsToBraille(tnContent(block).segs, o).trim();
  if (!inner) return [];
  const formatted = TN_OPEN + inner + TN_CLOSE;   // indicators are BRF, added after translation
  const { first, runover } = tnMargins(o);
  return wrapCells(formatted, w, first, runover).map((l) => l.replace(/\s+$/, ''));
}

// Footnote / Endnote formatting per BANA Formats §12 (1-3 margin: first cell 1, runover cell 3)
// BANA Formats §16.5.1a: a run of notes at the end of a print page follows a note
// separation line ("333333), which "cannot be on the last line of the braille page" (kept
// with the first note line); no blank line before it or between notes. Endnote sections
// (§16.9) and UKAAF (B004 D) keep a blank line before each note.
const NOTE_SEPARATOR = '"333333';
const noteLead = (block, o) => (isBanaOpts(o) && block.kind !== 'endnote' ? (block.noteRunStart ? [NOTE_SEPARATOR] : []) : ['']);
function formatFootnote(block, o) {
  const w = o.width || 38;
  const out = noteLead(block, o);
  if (Array.isArray(block.blocks) && block.blocks.length) {
    for (const cb of block.blocks) {
      const lines = formatBlock(cb, o);
      for (const l of lines) {
        if (l !== '') out.push(l);
      }
    }
  } else if (Array.isArray(block.segments)) {
    const body = segmentsToBraille(block.segments, o);
    out.push(...wrapCells(body, w, 0, 2));
  } else if (block.text != null && String(block.text).trim()) {
    out.push(...wrapCells(o.translate(String(block.text)), w, 0, 2));
  }
  const lines = out.map((l) => l.replace(/\s+$/, ''));
  if (lines[0] === NOTE_SEPARATOR && lines.length > 1) Object.defineProperty(lines, 'keepGroups', { value: [[0, 1]] });
  return lines;
}

// Attribution (Formats §9.4.1): blocked "in the fifth cell to the right of the beginning
// of the previous line" (§9.4.1b — approximated as the fixed cell 5, i.e. 4-4, since the
// last line of the quoted matter begins in cell 1 or, for BANA displayed material, cell 3);
// no blank line before it (it belongs to the text it follows, §9.4.1a) and "always leave a
// blank line following an attribution" (§9.4.1d). Mirrored in traceBlock.
function formatAttribution(block, o) {
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  const w = o.width || 38;
  const out = [...wrapCells(body, w, 4, 4), ''];
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Caption formatting per BANA Formats §5 & §11 (7-5 margin: cell 7 first, cell 5 runover)
function formatCaption(block, o) {
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  const w = o.width || 38;
  const first = o.mode === 'bana' ? 6 : 4;
  const runover = o.mode === 'bana' ? 4 : 4;
  const out = ['', ...wrapCells(body, w, first, runover)];
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Play / Drama Dialogue / Verse formatting per BANA Formats §13 / §14. A verse line
// takes the poem-wide nested pattern (Formats §13.3.1; B004 App J): `block.maxLevel`
// is the deepest level in the poem, supplied by buildDocPages for parsed line-per-block
// poems (a lone block falls back to its own level).
function formatPlay(block, o) {
  const isVerse = block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem';
  const lvl = block.level || 0;
  const { first, runover } = isVerse
    ? nestedMargins('poetry', lvl, block.maxLevel ?? lvl, o.mode)
    : { first: lvl === 0 ? 0 : 4, runover: 2 };
  const w = o.width || 38;
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  return wrapCells(body, w, first, runover).map((l) => l.replace(/\s+$/, ''));
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
  return { segs, open: add ? '[' : '', close: add ? ']' : '' };
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
  return exterior ? { top: '='.repeat(w), bottom: '='.repeat(w) } : { top: '7'.repeat(w), bottom: 'G'.repeat(w) };
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
function formatBox(block, o) {
  const w = o.width || 38;
  const text = String(block.text ?? '');
  const rawTitle = block.title != null ? String(block.title).trim() : '';    // the BOX's own heading (unrelated to a child table's block.title below)
  const { top, bottom } = boxBorders(block, o, w);
  const inner = { ...o, _boxDepth: (o._boxDepth || 0) + 1 };
  const body = [];
  const add = (lines) => { for (const l of lines) { if (l === '' && (!body.length || body[body.length - 1] === '')) continue; body.push(l); } };
  const kids = Array.isArray(block.blocks) ? block.blocks : [];
  const hasTitleHeading = !!rawTitle && kids.some((cb) => cb && typeof cb === 'object' && cb.type === 'heading' && String(cb.text ?? '').trim() === rawTitle);
  if (rawTitle && !hasTitleHeading) add(formatHeading({ type: 'heading', level: 2, text: rawTitle }, inner, false));

  // BANA Formats §11.3.1b: "Follow print for the placement of table headings ... which may
  // be before or after a top box line." A table nested directly in this box whose own
  // heading (block.title, §11.3.1a) is marked titlePosition:'before-box' is hoisted OUT
  // ahead of the top border instead of rendering, as it normally does (formatTable's own
  // formatTitle), as the box's first interior line ('in-box', the default — gold-verified,
  // BANA Sample 11-4: the top box line comes first, the centred heading right after it with
  // no blank between). Either placement, §11.3.1c/d forbid a blank line between the heading
  // and the box line beside it (gold-verified for 'before-box' too, BANA Sample 11-26: the
  // title's last line is followed immediately by the top box line, no blank) — satisfied
  // here either by add()'s own blank-line dedupe (in-box: the table's leading '' collapses
  // against the still-empty body) or by splicing the hoisted title directly before `top`
  // with no blank of its own (before-box, below).
  let hoistedTitle = [];
  const renderKids = kids.map((cb) => {
    if (!hoistedTitle.length && cb && typeof cb === 'object' && cb.type === 'table' && cb.title && cb.titlePosition === 'before-box') {
      hoistedTitle = tableTitleLines(cb.title, inner, w);
      return { ...cb, title: null };
    }
    return cb;
  });
  if (renderKids.some((cb) => cb && typeof cb === 'object')) {
    for (const cb of renderKids) {
      if (!cb || typeof cb !== 'object') continue;
      add(formatBlock(cb, inner));
    }
  } else if (text.trim()) {
    add(wrapCells(o.translate(text), w, 0, 2));
  }
  while (body.length && body[body.length - 1] === '') body.pop();
  return ['', ...hoistedTitle, top, ...body, bottom, ''].map((l) => l.replace(/\s+$/, ''));
}

// Glossary definition list formatting per BANA Formats §19 (1-3 runover, 3-5 nested)
// A glossary entry as segments: "term: definition" (BANA Formats Sample 21-1), whether or not
// the parts carry emphasis — the parser keeps segments for every <dt>/<dd>, the editor only
// for formatted ones, and both must braille alike. Entries with no term/def keep their own.
function glossarySegments(it) {
  const term = it.term != null ? String(it.term).trim() : '';
  const def = it.def != null ? String(it.def).trim() : '';
  const termSegs = Array.isArray(it.termSegments) && it.termSegments.length ? it.termSegments : (term ? [{ type: 'text', text: term }] : []);
  const defSegs = Array.isArray(it.defSegments) && it.defSegments.length ? it.defSegments : (def ? [{ type: 'text', text: def }] : []);
  if (term && def) {
    const sep = /[:—-]$/.test(term) ? ' ' : ': ';
    return [...termSegs, { type: 'text', text: sep }, ...defSegs];
  }
  if (Array.isArray(it.segments) && it.segments.length) return it.segments;
  if (it.text != null && String(it.text).trim()) return [{ type: 'text', text: String(it.text) }];
  return term ? termSegs : defSegs;
}

function formatGlossary(block, o) {
  const items = block.items || [];
  if (!items.length) return [];
  const out = [''];
  const w = o.width || 38;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const lvl = it.level || 0;
    const first = lvl === 0 ? 0 : 2 + (lvl - 1) * 2;
    const runover = 2 + lvl * 2;
    const segs = glossarySegments(it);
    const body = segs.length ? segmentsToBraille(segs, o) : '';
    if (body) out.push(...wrapCells(body, w, first, runover));
  }
  out.push('');
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Print page number indicator line per UKAAF B004 §8 and BANA Formats §1.6
function formatPageNum(block, o) {
  const p = String(block.page ?? block.text ?? '').trim();
  if (!p) return [];
  const w = o.width || 38;
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const pageBrl = o.translate ? o.translate(p).trim() : p;
  if (isBana) {
    // BANA Formats 2016 §1.11.3 / Example 1-9: the page change indicator is "a
    // line of unspaced dots 36 ... starting at the left margin and ending with
    // the new page number at the right margin. There is no space between the
    // page change indicator and the first symbol of the print page number" —
    // e.g. `-------------------------------------#bb`. No `"3` prefix (that is
    // the UKAAF form, below). page.mjs's banaPageChangeNumber() recognises it.
    const num = pageBrl.slice(0, Math.max(1, w - 3));
    return ['-'.repeat(w - num.length) + num];
  } else {
    // UKAAF B004 §8: Centred line with dot 5, dots 25 ("3) immediately followed by the page number in braille
    const indicator = '"3' + pageBrl;
    return [centred(indicator, w).replace(/\s+$/, '')];
  }
}

// ---- Table helpers, shared by formatTable and traceTable so the cell trace cannot drift ----
const TABLE_GUIDE = '"';                                   // guide dot: dot 5
// Column separation line under the column headings (Formats §11.4.2b): "3333 — dot 5
// followed by a series of dots 25 — "extends across the full width of the column"
// (Example 11-6: `"333333333333 "3333333 "333333333`). One dot-run per column, always
// exactly the column's own width by construction — so by the same "no room left for a
// guide-dot run" reasoning as colGutter/F-10/Q-7, the gap between two dot-runs is always
// the single narrowed cell, never the nominal two (gold-verified: BANA Example 11-2's own
// separation line, `"3333333 "33333333333333333`, has one blank cell between runs, not two).
// `overhangWidths` (BANA §11.4.3a, Change 2 — see padOverhang below): extra blank cells
// after a specific column, when a grouped column's own separator run must line up with
// an overhanging primary heading above it instead of the plain narrowed 1-cell gap.
const tableSeparator = (widths, gutter, overhangWidths) => {
  const cols = widths.map((cw) => TABLE_GUIDE + '3'.repeat(Math.max(0, cw - 1)));
  if (!overhangWidths || !overhangWidths.some(Boolean)) return cols.join(' ');
  const exactFill = cols.map((_, ci) => !overhangWidths[ci]);
  return joinTableRow(padOverhang(cols, overhangWidths), exactFill, gutter);
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
//  Numbers (§11.6.1c/d; B004 "guide dots … are left short of the aligned column of
//    figures") are place-value padded on the left and never trailed by guide dots.
function tableCellFill(text, cw, { firstLine, lastCol, numPad }) {
  const len = text.length;
  if (len >= cw) return { pre: '', post: '' };
  if (!len) return { pre: '', post: firstLine ? TABLE_GUIDE.repeat(cw) : ' '.repeat(cw) };
  if (numPad >= 0) {
    const pre = ' '.repeat(Math.min(numPad, cw - len));
    return { pre, post: ' '.repeat(cw - len - pre.length) };
  }
  const gap = cw - len;
  if (firstLine && !lastCol && gap >= 3) return { pre: '', post: ' ' + TABLE_GUIDE.repeat(gap - 1) };
  return { pre: '', post: ' '.repeat(gap) };
}
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
function renderVerticalSection(headers, rows, widths, numPlans, gutter, w) {
  const colCount = widths.length;
  const out = [];
  if (headers.some((h) => h.trim())) {
    const headerWrapped = headers.map((h, ci) => wrapCells(h, widths[ci], 0, 0));
    const maxHdrLines = Math.max(1, ...headerWrapped.map((l) => l.length));
    for (let li = 0; li < maxHdrLines; li++) {
      const raw = headerWrapped.map((lines) => lines[li] || '');
      const lineCols = raw.map((t, ci) => t.padEnd(widths[ci], ' '));
      const exactFill = raw.map((t, ci) => t.length >= widths[ci]);
      out.push(joinTableRow(lineCols, exactFill, gutter).slice(0, w));
    }
    const sepCols = widths.map((cw, ci) => (headers[ci].trim() ? (TABLE_GUIDE + '3'.repeat(Math.max(0, cw - 1))) : ' '.repeat(cw)));
    const sepExactFill = widths.map((_, ci) => !!headers[ci].trim());
    out.push(joinTableRow(sepCols, sepExactFill, gutter).slice(0, w));
  }
  const plans = numPlans.map((p, c) => (p && widths[c] >= p.width ? p : null));
  const rowWrappedData = rows.map((row) => row.map((cell, ci) => wrapCells(cell, widths[ci], 0, 2)));
  rowWrappedData.forEach((cellWrapped, ri) => {
    const maxLines = Math.max(1, ...cellWrapped.map((l) => l.length));
    for (let li = 0; li < maxLines; li++) {
      const exactFill = [];
      const lineCols = cellWrapped.map((lines, ci) => {
        const t = lines[li] || '';
        const { pre, post } = tableCellFill(t, widths[ci], { firstLine: li === 0, lastCol: ci === colCount - 1, numPad: plans[ci] ? plans[ci].pads[ri] : -1 });
        const cell = pre + t + post;
        exactFill.push(t !== '' && !cell.endsWith(' '));
        return cell;
      });
      out.push(joinTableRow(lineCols, exactFill, gutter).slice(0, w));
    }
  });
  return out;
}
// The transcriber's note announcing a vertically divided table (BANA 11.14.1c sample
// wording): "Table is divided vertically into 2 sections." — pluralised count (always
// >= 2 sections by computeVerticalSections' own construction).
const verticalDivisionTn = (n) => `Table is divided vertically into ${n} sections.`;
// BANA Formats §11.16 Listed Table Format: the transcriber's note explaining the change to
// print format (l, sample wording), the note for blank entries (h), and the three unspaced
// guide dots (dot 5) that stand for a blank entry.
const LISTED_TN = 'Print format is changed. Row headings are blocked in cell 5; column headings begin in cell 1. All headings are repeated for clarity. A colon separates headings from table entries.';
const LISTED_BLANK_TN = 'A series of three guide dots indicates a blank entry in print.';
const LISTED_BLANK = '"""';
// The note's paragraphs (a source table note first), each in 7-5 inside one TN (Sample 11-24).
function listedTnParagraphs(block, rawRows, colCount, has) {
  const paras = [];
  if (block.tabletn || block.note) paras.push(String(block.tabletn || block.note));
  paras.push(LISTED_TN);
  if (rawRows.some((r) => Array.from({ length: colCount }, (_, ci) => r[ci]).some((v, ci) => ci > 0 && !has(v)))) paras.push(LISTED_BLANK_TN);
  return paras;
}

// The transcriber's note that opens the UKAAF paragraph-form table (B004 §12 Example 2:
// "[The following table is brailled in paragraph form. Each entry gives: Date;
// Description; Money out; Money in; Balance.]").
const paragraphFormTn = (names) => `The following table is brailled in paragraph form. Each entry gives: ${names.join('; ')}.`;

// Cell segments with whitespace collapsed and the ends trimmed.
function trimSegs(segs) {
  const out = segs.map((g) => (g.type === 'text' ? { ...g, text: String(g.text || '').replace(/\s+/g, ' ') } : g));
  if (out[0] && out[0].type === 'text') out[0].text = out[0].text.replace(/^ /, '');
  const n = out.length - 1;
  if (n >= 0 && out[n].type === 'text') out[n].text = out[n].text.replace(/ $/, '');
  return out.filter((g) => g.type !== 'text' || g.text);
}

// a + plain separator + b, merging adjacent plain runs so plain cells stay one translate call.
function joinSegs(a, sep, b) {
  const out = [];
  const push = (g) => {
    const last = out[out.length - 1];
    if (g.type === 'text' && !g.tf && !g.uncontracted && last && last.type === 'text' && !last.tf && !last.uncontracted) last.text += g.text;
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
  if (!(colCount > 0)) return { rawHeaders, rawRows, w, mode, colCount: 0, bana: o.mode === 'bana' };

  // Translate all cells. A cell is a markup string or { text, segments } (format/cell-markup.mjs).
  const has = (v) => !cellIsBlank(v);
  const segsBraille = (segs) => {
    const rich = segs.length > 1 || (segs[0] && (segs[0].tf || segs[0].uncontracted || segs[0].type === 'math'));
    if (rich) return segmentsToBraille(segs, o).replace(/\s+$/, '');
    return o.translate(segs.map((g) => g.text || '').join('')).replace(/\s+$/, '');
  };
  const tr = (v) => (has(v) ? segsBraille(cellSegments(v)) : '');

  const headers = rawHeaders.map(tr);
  while (headers.length < colCount) headers.push('');
  const rows = rawRows.map((r) => {
    const row = r.map(tr);
    while (row.length < colCount) row.push('');
    return row;
  });

  // Natural column widths. A numeric column (§11.6.1d) is at least as wide as its
  // place-value-aligned entries (widest integer part + longest fraction).
  const numPlans = Array.from({ length: colCount }, (_, c) => numericColumnPlan(rawRows.map((r) => cellPlainText(r[c])), rows.map((r) => r[c])));
  const colWidths = Array(colCount).fill(1);
  for (let c = 0; c < colCount; c++) {
    if (headers[c]) colWidths[c] = Math.max(colWidths[c], headers[c].length);
    for (const r of rows) {
      if (r[c]) colWidths[c] = Math.max(colWidths[c], r[c].length);
    }
    if (numPlans[c]) colWidths[c] = Math.max(colWidths[c], numPlans[c].width);
  }

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
  //     formatGroupedHeaderRows/formatColumnar via padOverhang — never guide-dotted,
  //     11.6.1g's reasoning) so every later column still starts two cells after the
  //     wider of the heading and its span.
  //  2. WRAP (the pre-existing behaviour, when the overhang would not fit the page):
  //     the heading wraps within its span (formatGroupedHeaderRows, unchanged), the
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

  return { rawHeaders, rawRows, w, mode, colCount, has, segsBraille, tr, headers, rows, numPlans, colWidths, gutter, totalSpatialWidth, headerGroups, overhangWidths, bana: o.mode === 'bana' };
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
    return actualWidths ? { layout: 'columnar', actualWidths } : { layout: fallbackLayout };
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
  if (c.mode === 'columnar') return tryColumnar();
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
  if (vertical) return vertical;
  return { layout: fallbackLayout };
}

// Which layout a table will actually braille as, without rendering it: 'columnar', or the
// over-wide fallback ('listed' in BANA, 'paragraph' in UKAAF). The editor's table toolbar
// uses this to warn when a 'spatial'/'auto' table falls back (G15) — it calls formatTable's
// own width computation (computeTableColumns/resolveTableLayout) so the warning can never
// disagree with what actually gets brailled.
export function tableLayout(block, o) {
  const c = computeTableColumns(block, o);
  if (!(c.colCount > 0)) return 'columnar';
  return resolveTableLayout(c).layout;
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
    out.push(...centredBlock(o.translate(s), w));
  }
  return out.map((l) => l.replace(/\s+$/, ''));
}

// BANA Formats §11.2.5b: "Each column is separated from a following column by two blank
// cells." Paul's reading of the standard's own worked examples (standards-findings.md F-10,
// standards-questions.md Q-7): the printed gutter narrows to ONE blank cell wherever a
// column's rendered content, on that particular line, already reaches the column's full
// width WITHOUT a plain-space filler as the last thing added — i.e. the column's own text,
// or a run of guide dots, sits right at its edge — two cells only when the last thing added
// to reach that width is plain blank padding, which still needs the full gap to read as
// separation. Gold-verified two ways: BANA Example 11-2 (`"mosquito #cj "ds` — a data entry
// that reaches its column's edge on its own, no fill at all, cf. `"gorilla   #ej ye>s"`
// which pads with a space first, kept at two cells) and BANA Sample 11-1 (`,daily
// """"""""" #e4ci.0` — a guide-dot RUN reaching the column's edge narrows exactly the same
// way, even though tableCellFill's guide-dot branch still returns a non-empty `post`).
// `exactFill` is whether the column's fully padded text on this line does NOT end in a
// plain space (a header's own pad-to-width included).
const colGutter = (exactFill, gutter) => (exactFill ? 1 : gutter);
// Assemble one output line from column strings, joining each boundary with colGutter's
// width instead of a single uniform gutter (Array.join can't vary per boundary).
function joinTableRow(colTexts, exactFill, gutter) {
  let s = '';
  for (let ci = 0; ci < colTexts.length; ci++) {
    s += colTexts[ci];
    if (ci < colTexts.length - 1) s += ' '.repeat(colGutter(exactFill[ci], gutter));
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
// content) and always followed by the standard 2-cell gutter, never the narrowed one
// (`overhangExactFill` forces `exactFill` false there) — together giving exactly "the next
// column starts two cells after the wider of the heading and its span." A no-op (returns
// its input unchanged) whenever no column has an overhang, so it is safe to call
// unconditionally from formatColumnar/traceColumnar's general row-rendering code, whether
// or not the table has a two-tier header at all.
const padOverhang = (colTexts, overhangWidths) => (
  (overhangWidths && overhangWidths.some(Boolean))
    ? colTexts.map((t, ci) => (overhangWidths[ci] ? t + ' '.repeat(overhangWidths[ci]) : t))
    : colTexts
);
const overhangExactFill = (exactFill, overhangWidths) => (
  (overhangWidths && overhangWidths.some(Boolean))
    ? exactFill.map((e, ci) => (overhangWidths[ci] ? false : e))
    : exactFill
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

// BANA §11.4.3: Complex Tables with Column and Sub-column Headings. `headerGroups`
// carries the primary heading row; `headers` (unchanged) stays the flat sub-column/
// single-tier row. Gold-derived from the section's only four worked two-tier-header
// samples (11-2, 11-9, 11-13, 11-15 — standards-findings.md F-12):
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
function formatGroupedHeaderRows(headers, headerGroups, actualWidths, gutter, w, overhangWidths = null) {
  const colCount = actualWidths.length;
  const groupOf = groupColumnMap(colCount, headerGroups);
  const overhang = overhangWidths || Array(colCount).fill(0);

  const ownWrapped = headers.map((h, ci) => wrapCells(h, actualWidths[ci], 0, 0));
  // BANA §11.4.3a overhang: a group flagged `.overhang` (computeTableColumns) stays
  // UNWRAPPED, one line, at its own full width — the sub-columns beneath are never
  // widened for it (see padOverhang/`overhang` below instead).
  const groupWrapped = headerGroups.map((g) => (g.overhang ? [g.text] : wrapCells(g.text, groupSpanWidth(g, actualWidths, gutter), 0, 0)));

  const primaryTierHeight = Math.max(1, ...groupWrapped.map((l) => l.length));
  const groupedCols = [...Array(colCount).keys()].filter((ci) => groupOf[ci] != null);
  const subTierHeight = Math.max(1, ...groupedCols.map((ci) => ownWrapped[ci].length));
  const extra = Array(colCount).fill(0);
  for (let ci = 0; ci < colCount; ci++) {
    if (groupOf[ci] == null) extra[ci] = Math.max(0, ownWrapped[ci].length - subTierHeight);
  }
  const maxExtra = Math.max(0, ...extra);

  const out = [];

  // One "slot" per group (spanning its whole width, plus any overhang past its last
  // sub-column) or per ungrouped column — used by the primary row and its separation
  // line, the only two rows where a group's text spans more than one real column.
  const slots = [];
  for (let ci = 0; ci < colCount;) {
    const gi = groupOf[ci];
    if (gi != null) {
      const g = headerGroups[gi];
      slots.push({ width: groupSpanWidth(g, actualWidths, gutter) + (g.overhang ? overhang[g.to] : 0), groupIndex: gi });
      ci = g.to + 1;
    } else { slots.push({ width: actualWidths[ci] }); ci++; }
  }

  for (let li = 0; li < primaryTierHeight; li++) {
    const raw = slots.map((s) => (s.groupIndex != null ? (groupWrapped[s.groupIndex][li] || '') : ''));
    const lineCols = raw.map((t, si) => t.padEnd(slots[si].width, ' '));
    const exactFill = raw.map((t, si) => t.length >= slots[si].width);
    out.push(joinTableRow(lineCols, exactFill, gutter).slice(0, w));
  }
  {
    const raw = slots.map((s) => (s.groupIndex != null ? TABLE_GUIDE + '3'.repeat(Math.max(0, s.width - 1)) : ' '.repeat(s.width)));
    const exactFill = slots.map((s) => s.groupIndex != null);
    out.push(joinTableRow(raw, exactFill, gutter).slice(0, w));
  }

  // Extra rows: only when some ungrouped column's own heading needs more lines than
  // the sub-tier row height (BANA §11.4.1's generic two-line cap on a single-tier
  // heading beside a two-tier group — gold Sample 11-2's "Fiscal"/"Year"). Overhang
  // padding is still applied so a column after the group keeps lining up.
  for (let li = 0; li < maxExtra; li++) {
    const raw = Array.from({ length: colCount }, (_, ci) => {
      if (groupOf[ci] != null || extra[ci] === 0) return '';
      const padTop = maxExtra - extra[ci];
      return li >= padTop ? (ownWrapped[ci][li - padTop] || '') : '';
    });
    const lineCols = padOverhang(raw.map((t, ci) => t.padEnd(actualWidths[ci], ' ')), overhang);
    const exactFill = overhangExactFill(raw.map((t, ci) => t.length >= actualWidths[ci]), overhang);
    out.push(joinTableRow(lineCols, exactFill, gutter).slice(0, w));
  }

  // Sub-tier row(s) + separation line: the plain single-tier header loop's own
  // mechanics (unchanged), fed a per-column line array that is either the grouped
  // column's own sub-heading wrap, or an ungrouped column's own heading bottom-aligned
  // against this block. Overhang padding keeps every later column aligned with the
  // (wider) primary row/separator above.
  const subTierWrapped = Array.from({ length: colCount }, (_, ci) => {
    if (groupOf[ci] != null) return ownWrapped[ci];
    const own = ownWrapped[ci];
    const padTop = subTierHeight - own.length;
    return padTop > 0 ? [...Array(padTop).fill(''), ...own] : own.slice(own.length - subTierHeight);
  });
  for (let li = 0; li < subTierHeight; li++) {
    const raw = subTierWrapped.map((lines) => lines[li] || '');
    const lineCols = padOverhang(raw.map((t, ci) => t.padEnd(actualWidths[ci], ' ')), overhang);
    const exactFill = overhangExactFill(raw.map((t, ci) => t.length >= actualWidths[ci]), overhang);
    out.push(joinTableRow(lineCols, exactFill, gutter).slice(0, w));
  }
  out.push(tableSeparator(actualWidths, gutter, overhang).slice(0, w));

  return out;
}

// Table formatting: Spatial Columnar Table (BANA §11 / B004 §12 tabular form), the BANA
// Listed Table Format (§11.9) or, in UKAAF mode, B004 paragraph form for a table too wide
// for the line.
function formatTable(block, o) {
  const c = computeTableColumns(block, o);
  if (!(c.colCount > 0)) return [];
  const { rawHeaders, rawRows, w, colCount, has, segsBraille, headers, rows, numPlans, colWidths, gutter } = c;

  // Title helper (§11.3.1a; see tableTitleLines). A table's CAPTION (§11.2.8) is never
  // stored on the table object in the real parse/editor pipeline — it is always the
  // standalone 'caption' sibling block (formatCaption, 7-5 margins, not centred) pushed
  // immediately before this table block, per BANA 11.2.8a. Reading block.caption here too
  // (as before this fix) made a genuine caption take the centred heading path whenever a
  // test or the editor happened to set it directly on the table object — F-4.
  const title = block.title;
  const formatTitle = () => tableTitleLines(title, o, w);

  // UKAAF paragraph form (B004 §12b and Example 2): a transcriber's note naming the
  // column order, then each row as one 3-1 paragraph — its entries "separated by
  // punctuation rather than being aligned" (semicolons, closed by a full stop), a blank
  // entry shown as a dash as in the example. "Particularly useful for wide tables (since
  // there is no limit to row length)", so it is the UKAAF fallback for an over-wide table.
  const formatParagraphForm = () => {
    const out = [''];
    const titleLines = formatTitle();
    if (titleLines.length) out.push(...titleLines, '');
    if (block.tabletn || block.note) {
      out.push(...wrapCells(TN_OPEN + o.translate(block.tabletn || block.note).trim() + TN_CLOSE, w, 2, 0));
    }
    const names = Array.from({ length: colCount }, (_, ci) => (has(rawHeaders[ci]) ? cellPlainText(rawHeaders[ci]).trim() : `Column ${ci + 1}`));
    out.push(...wrapCells(TN_OPEN + o.translate(paragraphFormTn(names)).trim() + TN_CLOSE, w, 2, 0));
    // Each row is one print string translated as a whole (a ";" translated on its own
    // would pick up a grade-1 indicator); inline cell markup keeps its typeform segments,
    // adjacent plain runs are merged so a plain row is a single translate call.
    const dash = '–';                                        // blank entry, as in the B004 example
    const pushPlain = (segs, text) => {
      const last = segs[segs.length - 1];
      if (last && last.type === 'text' && !last.tf && !last.uncontracted) last.text += text;
      else segs.push({ type: 'text', text });
    };
    for (const rawRow of rawRows) {
      const segs = [];
      for (let ci = 0; ci < colCount; ci++) {
        if (ci) pushPlain(segs, '; ');
        if (!has(rawRow[ci])) { pushPlain(segs, dash); continue; }
        for (const sg of trimSegs(cellSegments(rawRow[ci]))) {
          if (sg.type === 'text' && !sg.tf && !sg.uncontracted) pushPlain(segs, sg.text); else segs.push({ ...sg });
        }
      }
      pushPlain(segs, '.');
      out.push(...wrapCells(segmentsToBraille(segs, o), w, 2, 0));
    }
    out.push('');
    return out;
  };
  // Listed Table Format (Formats §11.9 / B004 §8): a TN announcing the format, then
  // each row as its first cell (label in 1-3) followed by "header: value" lines (3-5).
  // Listed Table Format (BANA Formats §11.16): a TN explaining the format; then, for each
  // row after a blank line, "first column heading: row heading" as a cell-5 heading and
  // each other column as "heading: entry" in 1-3 (a blank entry is three guide dots).
  const formatListed = () => {
    const out = [''];
    const titleLines = formatTitle();
    if (titleLines.length) out.push(...titleLines, '');

    const paras = listedTnParagraphs(block, rawRows, colCount, has);
    paras.forEach((p, i) => {
      const text = (i === 0 ? TN_OPEN : '') + o.translate(p).trim() + (i === paras.length - 1 ? TN_CLOSE : '');
      out.push(...wrapCells(text, w, 6, 4));
    });

    const keepGroups = [];                                   // §11.16j: each row on one braille page when possible
    rawRows.forEach((rawRow, ri) => {
      out.push('');
      const rowStart = out.length;
      const label = has(rawRow[0]) ? trimSegs(cellSegments(rawRow[0])) : [{ type: 'text', text: `Row ${ri + 1}` }];
      const heading = has(rawHeaders[0]) ? joinSegs(trimSegs(cellSegments(rawHeaders[0])), ': ', label) : label;
      out.push(...wrapCells(segsBraille(heading), w, 4, 4));
      for (let ci = 1; ci < colCount; ci++) {
        // "heading: entry" is translated as one string, keeping each side's own segments.
        const h = has(rawHeaders[ci]) ? trimSegs(cellSegments(rawHeaders[ci])) : [{ type: 'text', text: `Col ${ci + 1}` }];
        const line = has(rawRow[ci])
          ? segsBraille(joinSegs(h, ': ', trimSegs(cellSegments(rawRow[ci]))))
          : `${segsBraille(joinSegs(h, ':', []))} ${LISTED_BLANK}`;
        out.push(...wrapCells(line, w, 0, 2));
      }
      keepGroups.push([rowStart, out.length - 1]);
    });
    out.push('');
    Object.defineProperty(out, 'keepGroups', { value: keepGroups });   // non-enumerable: lines still compare as plain arrays
    return out;
  };

  // `actualWidths` is already resolved by resolveTableLayout (never slicing columns off
  // the right edge — an unfittable table takes the fallback format instead, decided there).
  const formatColumnar = (actualWidths) => {
    // Place-value alignment only where the column kept its aligned width (a squeezed
    // numeric column wraps like text instead).
    const plans = numPlans.map((p, c) => (p && actualWidths[c] >= p.width ? p : null));

    const out = [''];
    const titleLines = formatTitle();
    if (titleLines.length) out.push(...titleLines, '');

    // If there is an explicit transcriber note for the spatial table
    if (block.tabletn || block.note) {
      out.push(...wrapCells(TN_OPEN + o.translate(block.tabletn || block.note).trim() + TN_CLOSE, w, 6, 4), '');
    }

    // Column headings: left-justified above their columns, wrapped within the column,
    // no guide dots between headings (§11.4.1b/c); then the separation line (§11.4.2).
    // A complex (two-tier) header (§11.4.3, F-12) takes its own renderer.
    if (c.headerGroups.length) {
      out.push(...formatGroupedHeaderRows(headers, c.headerGroups, actualWidths, gutter, w, c.overhangWidths));
    } else if (headers.some((h) => h.trim())) {
      const headerWrapped = headers.map((h, ci) => wrapCells(h, actualWidths[ci], 0, 0));
      const maxHdrLines = Math.max(...headerWrapped.map((l) => l.length));
      for (let li = 0; li < maxHdrLines; li++) {
        const raw = headerWrapped.map((lines) => lines[li] || '');
        const lineCols = raw.map((t, ci) => t.padEnd(actualWidths[ci], ' '));
        const exactFill = raw.map((t, ci) => t.length >= actualWidths[ci]);   // F-10/Q-7
        out.push(joinTableRow(lineCols, exactFill, gutter).slice(0, w));
      }
      out.push(tableSeparator(actualWidths, gutter).slice(0, w));
    }

    // Column entries: runovers indented 2 cells inside the column (§11.6.1a).
    const rowWrappedData = rows.map((row) => row.map((cell, ci) => wrapCells(cell, actualWidths[ci], 0, 2)));

    // Render Data Rows: each entry line filled to its column with guide dots / place-value
    // padding (tableCellFill: §11.6.1f/g, §11.6.4, §11.6.1d).
    rowWrappedData.forEach((cellWrapped, ri) => {
      const maxLines = Math.max(1, ...cellWrapped.map((l) => l.length));
      for (let li = 0; li < maxLines; li++) {
        const exactFill = [];
        const lineCols = cellWrapped.map((lines, ci) => {
          const t = lines[li] || '';
          const { pre, post } = tableCellFill(t, actualWidths[ci], { firstLine: li === 0, lastCol: ci === colCount - 1, numPad: plans[ci] ? plans[ci].pads[ri] : -1 });
          const cell = pre + t + post;
          // F-10/Q-7's evidence is always a real, non-empty entry (short or exactly-fitting)
          // bridged to its column's edge — never BANA §11.6.4's OWN "blank space" cell
          // (entirely guide-dotted, `t === ''`), which stays a deliberate full-width
          // placeholder and must line up with the un-blank rows around it (table_rowspan.
          // test.mjs's rowspan alignment check: a rowspanned row's blank area must line up
          // under the row above it, which a narrowed gutter here would break).
          exactFill.push(t !== '' && !cell.endsWith(' '));
          return cell;
        });
        // BANA §11.4.3a overhang (Change 2): data rows keep lining up under a group
        // whose heading overhangs its span (padOverhang/overhangExactFill — no-op when
        // c.overhangWidths has nothing set, i.e. every table without this rule in play).
        out.push(joinTableRow(padOverhang(lineCols, c.overhangWidths), overhangExactFill(exactFill, c.overhangWidths), gutter).slice(0, w));
      }
    });

    out.push('');
    return out;
  };

  // BANA §11.14 Wide Tables: Vertical Division (T4). `resolveTableLayout` has already
  // divided the DATA columns into sections that each fit the line at their natural width
  // (computeVerticalSections); this repeats column 0 (the row heading, §11.5.1) in every
  // section (11.14.1b) with a blank line between sections and the rule's own transcriber's
  // note (11.14.1c) before the first one.
  const formatVertical = (sections) => {
    const out = [''];
    const titleLines = formatTitle();
    if (titleLines.length) out.push(...titleLines, '');
    if (block.tabletn || block.note) {
      out.push(...wrapCells(TN_OPEN + o.translate(block.tabletn || block.note).trim() + TN_CLOSE, w, 6, 4), '');
    }
    out.push(...wrapCells(TN_OPEN + o.translate(verticalDivisionTn(sections.length)).trim() + TN_CLOSE, w, 6, 4), '');
    sections.forEach((cols, si) => {
      const allCols = [0, ...cols];
      const subHeaders = allCols.map((ci) => headers[ci]);
      const subRows = rows.map((row) => allCols.map((ci) => row[ci]));
      const subWidths = allCols.map((ci) => colWidths[ci]);
      const subPlans = allCols.map((ci) => numPlans[ci]);
      out.push(...renderVerticalSection(subHeaders, subRows, subWidths, subPlans, gutter, w));
      if (si < sections.length - 1) out.push('');
    });
    out.push('');
    return out;
  };

  const resolved = resolveTableLayout(c);
  if (resolved.layout === 'listed') return formatListed();
  if (resolved.layout === 'paragraph') return formatParagraphForm();
  if (resolved.layout === 'vertical') return formatVertical(resolved.sections);
  return formatColumnar(resolved.actualWidths);
}

// Computer Code Block formatting with UEB indicators
function formatCodeBlock(block, o) {
  const text = String(block.text ?? '');
  if (!text.trim()) return [];
  const w = o.width || 38;
  const lines = text.split('\n');
  // Displayed computer code is a grade-1 passage (UEB Technical §17): the passage
  // indicator and terminator stand on their own lines around the code, which is
  // translated uncontracted when the caller supplies a grade-1 translate.
  const g1 = o.translateG1 || o.translateUncontracted || o.translate;
  const out = ['', G1_PASSAGE_OPEN];
  lines.forEach((l) => {
    if (l.trim()) out.push(...wrapCells(g1(l), w, 0, 2));
  });
  out.push(G1_TERMINATOR, '');
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
function printImageParts(block) {
  const caption = String(block.caption ?? '').trim();
  const captionSegs = caption ? (Array.isArray(block.captionSegments) && block.captionSegments.length ? block.captionSegments : [{ type: 'text', text: caption }]) : [];
  const description = String(block.description ?? '').trim() || String(block.alt ?? '').trim();
  const label = !caption || !IDENTIFIED_RE.test(caption);
  return { caption, captionSegs, description, label };
}
const imageMargins = (o) => (isBanaOpts(o) ? { first: 6, runover: 4 } : { first: 4, runover: 4 });
function traceOrFormatPrintImage(block, o, unit) {
  if (typeof o.translatePos !== 'function') {                // formatBlock may be called with translate only
    o = { ...o, translatePos: (t, tf) => { const b = o.translate(t, tf); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(t).length - 1))) }; } };
  }
  const parts = printImageParts(block);
  if (!parts.caption && !parts.description) return [];
  const w = o.width || 38;
  const { first, runover } = imageMargins(o);
  const tn = (text) => `${TN_OPEN}${o.translate(text).trim()}${TN_CLOSE}`;
  const out = [];
  if (parts.caption || parts.label) {
    const labelStr = parts.label ? tn('Illustration') + (parts.caption ? ' ' : '') : '';
    const cap = parts.caption ? tcJoined(o, [{ segs: parts.captionSegs, unit }]) : { s: '', src: [] };
    const line = { s: labelStr + cap.s, src: [...Array.from(labelStr, () => null), ...cap.src] };
    out.push(...tcWrap(o, line, w, first, runover));
  }
  if (parts.description) {
    const d = tn(parts.description);
    out.push(...tcWrap(o, tcDeco(d), w, first, runover));
  }
  return out.map((x) => tcRstrip(x));
}

// Tactile Graphic raster / BRF placeholder rendering
function formatTactileGraphic(block, o) {
  if (isPrintImage(block)) return traceOrFormatPrintImage(block, o, 0).map((x) => x.s);
  const w = o.width || 38;
  const tr = typeof o?.translate === 'function' ? o.translate : (t) => t;
  const desc = String(block.title || block.alt || 'Tactile Graphic');
  const label = `[Tactile graphic: ${desc}]`;
  const brl = tr(label);
  const out = ['', ...wrapCells(brl, w, 0, 2)];

  if (block.lines && Array.isArray(block.lines) && block.lines.length) {
    block.lines.forEach((l) => {
      // '*' = a full cell (dots 123456 = '=' in BRF); Unicode braille is mapped to
      // BRF ASCII; anything else becomes a blank; the row is clamped to the width.
      const cells = toBrfCells(String(l ?? '').replace(/\*/g, '=')).replace(/\s/g, ' ').slice(0, w);
      out.push(centred(cells, w).replace(/\s+$/, ''));
    });
  }
  out.push('');
  return out;
}

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
    block.lines.forEach((l) => {
      const cells = toBrfCells(String(l ?? '').replace(/\*/g, '=')).replace(/\s/g, ' ').slice(0, w);
      out.push(tcDeco(centred(cells, w).replace(/\s+$/, '')));
    });
  }
  out.push(tcBlank);
  return out.map((x) => tcRstrip(x));
}

// Maths: transcribe the MathML via the maths engine (UEB/Nemeth per mode) to BRF
// ASCII, then set it off as a displayed block (blank line before; blocked at
// cell 1, runover cell 3). Requires o.mathToBrf (maths engine ready); if absent
// or it errors, the equation is skipped rather than breaking the document.
function formatMath(block, o) {
  if (!o.mathToBrf || (!block.mathml && !block.latex)) return [];
  let brf;
  try { brf = o.mathToBrf(block); } catch { return []; }
  if (!brf) return [];
  return ['', ...wrapCells(brf, o.width, 0, 2)].map((l) => l.replace(/\s+$/, ''));
}

// A malformed block (null/undefined, or missing a usable `type`) is skipped
// rather than thrown on — one bad block in a document shouldn't take down
// the whole conversion.
function formatBlock(block, o, atStart) {
  if (!block || typeof block !== 'object') return [];
  try {
    return formatBlockUnguarded(block, o, atStart);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn(`[format] ${block.type ?? 'para'} block skipped:`, (e && e.message) || e);
    return [];
  }
}
function formatBlockUnguarded(block, o, atStart) {
  switch (block.type) {
    case 'title': return formatTitle(block, o);
    case 'heading': return formatHeading(block, o, atStart);
    case 'para': return formatPara(block, o);
    case 'list': return formatList(block, o);
    case 'glossary': return formatGlossary(block, o);
    case 'box':
    case 'sidebar': return formatBox(block, o);
    case 'pagenum': return formatPageNum(block, o);
    case 'attribution': return formatAttribution(block, o);
    case 'caption': return formatCaption(block, o);
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
    case 'footnote': return formatFootnote(block, o);
    case 'table': return formatTable(block, o);
    case 'code': return formatCodeBlock(block, o);
    case 'graphic': case 'tactile': return formatTactileGraphic(block, o);
    case 'math': return formatMath(block, o);
    // A 'break' (the editor's "Document Break", <hr>) is the same thing as an
    // 'indicator': a blank line, or a centred print break symbol (Formats
    // §1.9.5: "Center the braille equivalent on a separate line ... place a
    // space between each symbol"). It used to fall through to formatPara and
    // vanish.
    case 'break':
    case 'indicator':
      if (block.kind === 'line' || block.kind === 'stanza') return [''];
      if (block.text) return wrapCells(o.translate(block.text), o.width, 0, 0);
      return [...tdSymbolNote(block, o), indicatorLine(block.kind || 'dot2s', o.width, isBanaOpts(o) ? 'bana' : 'ukaaf')];
    case 'blank': return [''];
    default: return formatPara(block, o);
  }
}

// ===================== cell trace (editor word/cell linking) =====================
// Parallel to formatBlock: every cell carries a source coordinate {u,c} (u = unit
// index — 0 for a block, item index for a list; c = char index into that unit's
// flat text) or null for a decoration/space cell. traceBlock returns [{ s, src }]
// per content line; its `s` is asserted === formatBlock's line before the map is
// used (buildDocPages guard + test-celltrace), so a drift can only fall back to
// block-level linking, never mis-tag. o.translatePos(text, tf) → { braille,
// inputPos } is supplied by the caller (the editor) and mirrors o.translate.
function tcRstrip(o) { let b = o.s.length; while (b > 0 && o.s[b - 1] === ' ') b--; return { s: o.s.slice(0, b), src: o.src.slice(0, b) }; }
function tcTrimBoth(s, src) { let a = 0, b = s.length; while (a < b && s[a] === ' ') a++; while (b > a && s[b - 1] === ' ') b--; return { s: s.slice(a, b), src: src.slice(a, b) }; }
function tcRun(o, text, tf, unit, base) {                    // one translated text run
  const res = o.translatePos(text, tf || null);
  const braille = (typeof res === 'object' && res !== null) ? (res.braille ?? res.text ?? '') : (typeof res === 'string' ? res : '');
  const inputPos = (typeof res === 'object' && res !== null) ? (res.inputPos ?? res.map ?? Array.from({ length: braille.length }, (_, i) => i)) : Array.from({ length: braille.length }, (_, i) => i);
  return { s: braille, src: inputPos.map((p) => ({ u: unit, c: base + (typeof p === 'number' ? p : 0) })) };
}
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
    for (const g of segs || []) {
      if (!g) continue;
      if (g.type === 'math' || g.type === 'noteref' || g.type === 'linenum') {
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
  for (const g of groupSegments(flat)) {
    if (g.linenum) {
      const brl = lineNumbers ? lineNumberWord(g.linenum, o) : '';
      s += brl;
      for (let i = 0; i < brl.length; i++) src.push(null);
      pos += g.len;
      continue;
    }
    if (g.noteref) {
      const brl = noterefBraille(g.noteref, o);
      s += brl;
      for (let i = 0; i < brl.length; i++) src.push(charSrc[pos + Math.min(i, Math.max(0, g.len - 1))] ?? null);
      pos += g.len;
      continue;
    }
    if (g.math) {
      if (o.mathToBrf) {
        let brf = ''; try { brf = o.mathToBrf(g.math) || ''; } catch { brf = ''; }
        s += brf;
        for (let i = 0; i < brf.length; i++) src.push(charSrc[pos + Math.min(i, g.len - 1)] ?? null);
      }
      pos += g.len;
      continue;
    }
    g.lines.forEach((l, li) => {
      if (li > 0) { s += '\n'; src.push(null); }
      if (!l.text) return;
      const at = pos + l.start;
      if (g.uncontracted) {                                  // grade-1 run: indicators have no source of their own
        const brl = segmentsToBraille([{ type: 'text', text: l.text, uncontracted: true, tf: l.tf ? l.tf[0] : 0 }], o);
        s += brl;
        for (let i = 0; i < brl.length; i++) src.push(charSrc[at + Math.min(i, l.text.length - 1)] ?? null);
        return;
      }
      const res = o.translatePos(l.text, l.tf);
      const braille = (typeof res === 'object' && res !== null) ? (res.braille ?? res.text ?? '') : (typeof res === 'string' ? res : '');
      const inputPos = (typeof res === 'object' && res !== null) ? (res.inputPos ?? res.map ?? Array.from({ length: braille.length }, (_, i) => i)) : Array.from({ length: braille.length }, (_, i) => i);
      s += braille;
      for (const p of inputPos) src.push(charSrc[at + (typeof p === 'number' ? p : 0)] ?? null);
    });
    pos += g.len;
  }
  return tcTrimBoth(s, src);
}
const segsAreRich = (segs) => segs.length > 1 || !!(segs[0] && (segs[0].tf || segs[0].uncontracted || segs[0].type === 'math'));
function tcCell(o, cell, unit) {                             // mirror formatTable's tr()
  const segs = cellSegments(cell);
  if (segsAreRich(segs)) return tcRstrip(tcJoined(o, [{ segs, unit }]));
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
    out.push(...tcCentredBlock(o, tcRun(o, s, null, 0, 0), w));
  }
  return out;
}
// Traced mirror of formatGroupedHeaderRows (BANA §11.4.3, F-12) — see that function's
// own comment for the gold-derived row layout this reproduces. `headerTrs[ci]` is
// already the traced {s,src} for column ci's flat (sub-column/single-tier) heading;
// `headerGroups[gi].tr` is the traced {s,src} for the group's own primary heading
// (translated once in traceTable's setup).
function traceGroupedHeaderRows(headerTrs, headerGroups, actualWidths, gutter, w, overhangWidths = null) {
  const colCount = actualWidths.length;
  const groupOf = groupColumnMap(colCount, headerGroups);
  const overhang = overhangWidths || Array(colCount).fill(0);
  // BANA §11.4.3a overhang (Change 2) — traced mirror of the same helper in
  // formatGroupedHeaderRows/padOverhang: append extra blank cells (null src) after a
  // specific column's part, forcing exactFill false there.
  const padPartOverhang = (part, ci) => (overhang[ci] ? { s: part.s + ' '.repeat(overhang[ci]), src: [...part.src, ...Array(overhang[ci]).fill(null)], exactFill: false } : part);

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
      if (i < parts.length - 1) { const g = colGutter(parts[i].exactFill, gutter); s += ' '.repeat(g); for (let k = 0; k < g; k++) src.push(null); }
    }
    return { s: s.slice(0, w), src: src.slice(0, w) };
  };

  for (let li = 0; li < primaryTierHeight; li++) {
    const parts = slots.map((sl) => {
      if (sl.groupIndex == null) return { s: ' '.repeat(sl.width), src: Array(sl.width).fill(null), exactFill: false };
      const wc = groupWrapped[sl.groupIndex];
      const lineS = wc.lines[li] || ''; const lineSrc = wc.srcs[li] || [];
      return { ...padTr(lineS, lineSrc, sl.width), exactFill: lineS.length >= sl.width };
    });
    out.push(joinSlotLine(parts));
  }
  {
    const parts = slots.map((sl) => {
      if (sl.groupIndex == null) return { s: ' '.repeat(sl.width), src: Array(sl.width).fill(null), exactFill: false };
      const dots = TABLE_GUIDE + '3'.repeat(Math.max(0, sl.width - 1));
      return { s: dots, src: Array(dots.length).fill(null), exactFill: true };
    });
    out.push(joinSlotLine(parts));
  }

  for (let li = 0; li < maxExtra; li++) {
    const parts = Array.from({ length: colCount }, (_, ci) => {
      if (groupOf[ci] != null || extra[ci] === 0) return padPartOverhang({ s: ' '.repeat(actualWidths[ci]), src: Array(actualWidths[ci]).fill(null), exactFill: false }, ci);
      const padTop = maxExtra - extra[ci];
      const wc = ownWrapped[ci];
      const idx = li - padTop;
      const lineS = (idx >= 0 ? wc.lines[idx] : '') || '';
      const lineSrc = (idx >= 0 ? wc.srcs[idx] : []) || [];
      return padPartOverhang({ ...padTr(lineS, lineSrc, actualWidths[ci]), exactFill: lineS.length >= actualWidths[ci] }, ci);
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
      return padPartOverhang({ ...padTr(lineS, lineSrc, actualWidths[ci]), exactFill: lineS.length >= actualWidths[ci] }, ci);
    });
    out.push(joinSlotLine(parts));
  }
  out.push(tcDeco(tableSeparator(actualWidths, gutter, overhang).slice(0, w)));

  return out;
}
function traceBlock(block, o, atStart, unit = 0) {
  if (!block || typeof block !== 'object') return [];
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
    const first = (blocked || isBlock || block.continuation) ? 0 : 2;
    const res = tcWrap(o, tcRun(o, text, null, unit, 0), w, first, 0);
    if (blocked && !block.continuation) res.unshift(tcBlank);
    else if (isBlock && !block.continued) res.push(tcBlank);
    return res;
  };
  switch (block.type) {
    case 'title': return tcCentredBlock(o, tcRun(o, block.text ?? '', null, unit, 0), w).map((x) => tcRstrip(x));
    case 'heading': {
      // §4.3.7 / forceBold, as formatHeading — see formatHeading's comment for the full
      // BANA §4.2.1 / UKAAF Appendix A reading behind levels 4-6.
      const plainTr = () => (block.segments ? tcSegs(o, stripEmphasis(block.segments), unit) : tcRun(o, block.text ?? '', null, unit, 0));
      const boldTr = () => {
        if (block.segments) return tcSegs(o, forceBold(stripEmphasis(block.segments)), unit);
        const text = block.text ?? '';
        return tcRun(o, text, Array(text.length).fill(TF_BOLD), unit, 0);
      };
      const L = block.level || 1; const out = [];
      if (o.mode === 'bana') {
        const tier = banaTier(L, o);                     // mirror formatHeading
        if (tier === 'cell5') out.push(tcBlank, ...tcWrap(o, plainTr(), w, 4, 4));
        else if (tier === 'cell7') out.push(tcBlank, ...tcWrap(o, plainTr(), w, 6, 6));
        else out.push(tcBlank, ...tcCentredHeadingBlock(o, plainTr(), w, Math.max(1, w - 6)), tcBlank);
      } else {
        if (L === 1) {                                   // mirror formatHeading: no end marker at the document start
          if (atStart) out.push(...tcCentredBlock(o, plainTr(), w));
          else out.push(tcBlank, tcDeco(indicatorLine('dot2s', w)), ...tcCentredBlock(o, plainTr(), w));
        } else if (L === 2 || L === 5) out.push(tcBlank, ...tcWrap(o, plainTr(), w, 0, 4));
        else if (L === 3) out.push(tcBlank, ...tcWrap(o, plainTr(), w, 2, 4));
        else if (L === 4) out.push(tcBlank, ...tcWrap(o, boldTr(), w, 0, 4));
        else out.push(tcBlank, ...tcWrap(o, boldTr(), w, 2, 4));
      }
      return out.map((x) => tcRstrip(x));
    }
    case 'para': {
      if (block.segments) {
        const tr = tcSegs(o, block.segments, unit, true);
        if (!stripLineNumbers(tr.s)) return [];
        const note = lineNumberNote(block, o).map(tcDeco);
        const q = quoteMargins(block, o);              // mirror formatSegmentedPara
        if (q) {
          const res = tcWrapBody(o, tr, w, block.continuation ? q.runover : q.first, q.runover);
          return [...note, ...quoteLines(res, q, block).map((x) => (x === '' ? tcBlank : x))];
        }
        const blocked = !!block.blocked;                 // mirror formatSegmentedPara (F-39 / §1.9.3)
        const isBlock = o.paragraphStyle === 'block';
        const first = (blocked || isBlock || block.continuation) ? 0 : 2;   // a paragraph resumed after a page turn: cell 1
        const res = tcWrapBody(o, tr, w, first, 0);
        if (blocked && !block.continuation) res.unshift(tcBlank);
        else if (isBlock && !block.continued) res.push(tcBlank);
        return [...note, ...res];
      }
      return paraLike(block);
    }
    case 'attribution': {
      const tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, block.text || '', null, unit, 0);
      if (!tr.s) return [];
      return [...tcWrap(o, tr, w, 4, 4), tcBlank].map((x) => tcRstrip(x));   // §9.4.1d blank after
    }
    case 'caption': {
      const first = o.mode === 'bana' ? 6 : 4;
      const runover = o.mode === 'bana' ? 4 : 4;
      const tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, block.text || '', null, unit, 0);
      if (!tr.s) return [];
      return [tcBlank, ...tcWrap(o, tr, w, first, runover)].map((x) => tcRstrip(x));
    }
    case 'play': {
      const isVerse = block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem';
      const lvl = block.level || 0;
      const { first, runover } = isVerse                                   // mirror formatPlay
        ? nestedMargins('poetry', lvl, block.maxLevel ?? lvl, o.mode)
        : { first: lvl === 0 ? 0 : 4, runover: 2 };
      const tr = block.segments ? tcSegs(o, block.segments, unit) : tcRun(o, block.text || '', null, unit, 0);
      if (!tr.s) return [];
      return tcWrap(o, tr, w, first, runover).map((x) => tcRstrip(x));
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
    case 'note': {
      const text = String(block.text ?? '');
      if (!text.trim() && !block.segments) return [];
      const w = o.width || 38;
      const openDeco = tcDeco(TN_OPEN);
      const closeDeco = tcDeco(TN_CLOSE);
      const tn = tnContent(block);                     // mirror formatTranscriberNote
      const tr = tcJoined(o, [{ segs: tn.segs, unit, base: tn.offset }]);
      const trimmedLen = tr.s.trim().length;
      const full = {
        s: openDeco.s + tr.s.trim() + closeDeco.s,
        src: [...openDeco.src, ...tr.src.slice(0, trimmedLen), ...closeDeco.src]
      };
      const { first, runover } = tnMargins(o);         // mirror formatTranscriberNote
      return tcWrap(o, full, w, first, runover).map((x) => tcRstrip(x));
    }
    case 'footnote': {
      const w = o.width || 38;
      const out = noteLead(block, o).map((l) => (l ? tcDeco(l) : tcBlank));
      if (block.blocks && block.blocks.length) {
        for (const cb of block.blocks) {
          const clines = traceBlock(cb, o, false, unit);
          for (const cl of clines) {
            if (cl && cl.s !== '') out.push(cl);
          }
        }
      } else if (block.segments) {
        const seg = tcSegs(o, block.segments, unit);
        out.push(...tcWrap(o, seg, w, 0, 2));
      } else if (block.text && block.text.trim()) {
        const tr = tcRun(o, block.text, null, unit, 0);
        out.push(...tcWrap(o, tr, w, 0, 2));
      }
      return out.map((x) => tcRstrip(x));
    }
    case 'list': {
      if (block.kind === 'glossary' || block.style === 'glossary') {
        return traceBlock({ ...block, type: 'glossary' }, o, atStart, unit);
      }
      const items = block.items ?? []; if (!items.length) return [];
      const compact = isCompactList(o); const out = [...lineNumberNote(block, o).map(tcDeco), ...(compact ? [] : [tcBlank])];
      const kind = block.kind;
      const mkind = listMarginKind(kind);
      const maxLevel = listMaxLevel(block);
      const tocCols = kind === 'toc' ? tocColumns(block, o) : null;
      let tocHeaderDone = false;
      items.forEach((item, ui) => {
        if (!item) return;
        const lvl = item.level || 0;
        const { first, runover } = nestedMargins(mkind, lvl, maxLevel, o.mode, o.listStyle);   // mirror formatList
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
          const runPage = tcRun(o, String(item.page ?? '').trim(), null, ui, titleLen);
          const pageTc = tcTrimBoth(runPage.s, runPage.src);
          if (tocCols && !tocHeaderDone) { out.push(...tocCols.header.map(tcDeco)); tocHeaderDone = true; }
          out.push(...tocEntryLines(o, titleBody, pageTc, tocBraillePage(item, o), tocCols, first, runover));
          return;
        }

        const itemUnit = unit ? (unit * 1000 + ui) : ui;
        const marker = compact ? '' : (item.marker ? item.marker + ' ' : '');
        const markerStr = !marker ? ''
          : item.marker === '•' ? UEB_BULLET + ' '                                            // §8.6.2a, as formatList
          : (item.segments ? o.translate(marker).trim() + ' ' : o.translate(marker));
        const markerSrc = Array.from(markerStr, () => null);
        const tr = item.segments ? tcSegs(o, item.segments, itemUnit, true) : tcRun(o, item.text ?? '', null, itemUnit, 0);
        let full = markerStr ? { s: markerStr + tr.s, src: [...markerSrc, ...tr.src] } : tr;
        const pageBrl = pageSuffix(item, o);                 // mirror formatList
        if (pageBrl) {
          const t = tcRstrip(full);
          full = { s: t.s + pageBrl, src: [...t.src, ...Array.from(pageBrl, () => null)] };
        }
        out.push(...tcWrapBody(o, full, w, first, runover));
      });
      if (!compact) out.push(tcBlank);
      return out.map((x) => tcRstrip(x));
    }
    case 'glossary': {
      const items = block.items || [];
      if (!items.length) return [];
      const out = [tcBlank];
      items.forEach((it, ui) => {
        if (!it) return;
        const lvl = it.level || 0;
        const first = lvl === 0 ? 0 : 2 + (lvl - 1) * 2;
        const runover = 2 + lvl * 2;
        const segs = glossarySegments(it);               // mirror formatGlossary
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
      const rawTitle = block.title != null ? String(block.title).trim() : '';
      const { top, bottom } = boxBorders(block, o, w);
      const inner = { ...o, _boxDepth: (o._boxDepth || 0) + 1 };
      const body = [];
      const add = (lines) => { for (const l of lines) { if (!l) continue; if (l.s === '' && (!body.length || body[body.length - 1].s === '')) continue; body.push(l); } };
      const kids = Array.isArray(block.blocks) ? block.blocks : [];
      const hasTitleHeading = !!rawTitle && kids.some((cb) => cb && typeof cb === 'object' && cb.type === 'heading' && String(cb.text ?? '').trim() === rawTitle);
      if (rawTitle && !hasTitleHeading) add(traceBlock({ type: 'heading', level: 2, text: rawTitle }, inner, false, 0));
      // BANA §11.3.1b/c/d — mirror formatBox's before-box title hoist (see there for the rule).
      let hoistedTitle = [];
      const renderKids = kids.map((cb) => {
        if (!hoistedTitle.length && cb && typeof cb === 'object' && cb.type === 'table' && cb.title && cb.titlePosition === 'before-box') {
          hoistedTitle = traceTableTitleLines(cb.title, inner, w);
          return { ...cb, title: null };
        }
        return cb;
      });
      if (renderKids.some((cb) => cb && typeof cb === 'object')) {
        renderKids.forEach((cb, u) => {
          if (!cb || typeof cb !== 'object') return;
          add(traceBlock(cb, inner, false, u));
        });
      } else if (text.trim()) {
        const { braille, inputPos } = o.translatePos(text, null);
        add(tcWrap(o, { s: braille, src: inputPos.map((p) => ({ u: 0, c: p })) }, w, 0, 2));
      }
      while (body.length && body[body.length - 1].s === '') body.pop();
      return [tcBlank, ...hoistedTitle, tcDeco(top), ...body, tcDeco(bottom), tcBlank].map((x) => tcRstrip(x));
    }
    case 'pagenum': {
      const p = String(block.page ?? block.text ?? '').trim();
      if (!p) return [];
      const isBana = (o.standard === 'bana' || o.mode === 'bana');
      const pageBrl = o.translate ? o.translate(p).trim() : p;
      if (isBana) {                                        // mirror formatPageNum (Formats §1.11.3)
        const num = pageBrl.slice(0, Math.max(1, w - 3));
        return [tcDeco('-'.repeat(w - num.length) + num)];
      } else {
        const indicator = '"3' + pageBrl;
        return [tcDeco(centred(indicator, w).replace(/\s+$/, ''))];
      }
    }
    case 'math': {
      if (!o.mathToBrf || (!block.mathml && !block.latex)) return [];
      let brf; try { brf = o.mathToBrf(block); } catch { return []; }
      if (!brf) return [];
      return [tcBlank, ...tcWrap(o, tcDeco(brf), w, 0, 2)].map((x) => tcRstrip(x));
    }
    case 'break':
    case 'indicator':
      if (block.kind === 'line' || block.kind === 'stanza') return [tcBlank];
      if (block.text) return tcWrap(o, tcRun(o, block.text, null, unit, 0), w, 0, 0);
      return [...tdSymbolNote(block, o).map(tcDeco), tcDeco(indicatorLine(block.kind || 'dot2s', w, isBanaOpts(o) ? 'bana' : 'ukaaf'))];
    case 'blank': return [tcBlank];
    case 'table': return traceTable(block, o);
    case 'graphic': case 'tactile': return traceTactileGraphic(block, o);
    default: return paraLike(block);
  }
}

// Traced counterpart to formatTable for character-to-cell coordinate mapping
function traceTable(block, o) {
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
      headerTrs.push(tcCell(o, rawH, ci));
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
        row.push(tcCell(o, rawCell, unit));
      } else {
        row.push({ s: '', src: [] });
      }
    }
    rowTrs.push(row);
  });

  const headers = headerTrs.map((h) => h.s);
  const rows = rowTrs.map((r) => r.map((c) => c.s));

  // mirror formatTable: numeric plans widen a column to its place-value-aligned width
  const numPlans = Array.from({ length: colCount }, (_, c) => numericColumnPlan(rawRows.map((r) => cellPlainText(r[c])), rows.map((r) => r[c])));
  const colWidths = Array(colCount).fill(1);
  for (let c = 0; c < colCount; c++) {
    if (headers[c]) colWidths[c] = Math.max(colWidths[c], headers[c].length);
    for (const r of rows) {
      if (r[c]) colWidths[c] = Math.max(colWidths[c], r[c].length);
    }
    if (numPlans[c]) colWidths[c] = Math.max(colWidths[c], numPlans[c].width);
  }

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

  // mirror formatParagraphForm (B004 §12 paragraph form)
  const traceParagraphForm = () => {
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);
    if (block.tabletn || block.note) out.push(...tcWrap(o, traceTn(block.tabletn || block.note, 0), w, 2, 0));
    const names = Array.from({ length: colCount }, (_, ci) => (has(rawHeaders[ci]) ? cellPlainText(rawHeaders[ci]).trim() : `Column ${ci + 1}`));
    out.push(...tcWrap(o, traceTn(paragraphFormTn(names), null), w, 2, 0));
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
      parts.push(deco('.'));
      out.push(...tcWrap(o, tcJoined(o, parts), w, 2, 0));
    });
    out.push(tcBlank);
    return out;
  };
  const traceFallback = () => (o.mode === 'bana' ? traceListed() : traceParagraphForm());

  const traceListed = () => {                               // mirror formatListed (§11.16)
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);

    const paras = listedTnParagraphs(block, rawRows, colCount, has);
    paras.forEach((p, i) => {
      const text = (i === 0 ? TN_OPEN : '') + o.translate(p).trim() + (i === paras.length - 1 ? TN_CLOSE : '');
      out.push(...tcWrap(o, tcDeco(text), w, 6, 4));
    });

    const sep = (text) => ({ segs: [{ type: 'text', text }], unit: null });
    rawRows.forEach((rawRow, ri) => {
      out.push(tcBlank);
      const unit0 = headerCount + ri * colCount;
      const label = has(rawRow[0]) ? { segs: trimSegs(cellSegments(rawRow[0])), unit: unit0 } : sep(`Row ${ri + 1}`);
      const heading = has(rawHeaders[0]) ? [{ segs: trimSegs(cellSegments(rawHeaders[0])), unit: 0 }, sep(': '), label] : [label];
      out.push(...tcWrap(o, tcRstrip(tcJoined(o, heading)), w, 4, 4));
      for (let ci = 1; ci < colCount; ci++) {
        const hPart = has(rawHeaders[ci]) ? { segs: trimSegs(cellSegments(rawHeaders[ci])), unit: ci } : sep(`Col ${ci + 1}`);
        const unit = headerCount + ri * colCount + ci;
        let line;
        if (has(rawRow[ci])) {
          line = tcJoined(o, [hPart, sep(': '), { segs: trimSegs(cellSegments(rawRow[ci])), unit }]);
        } else {
          const head = tcJoined(o, [hPart, sep(':')]);
          const dots = tcDeco(` ${LISTED_BLANK}`);
          line = { s: head.s + dots.s, src: [...head.src, ...dots.src] };
        }
        out.push(...tcWrap(o, line, w, 0, 2));
      }
    });
    out.push(tcBlank);
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
    const traceRow = (cellTrList, ri) => {
      const isData = ri != null;
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
          let exactFill;
          if (isData) {
            const { pre, post } = tableCellFill(cellLine, targetW, { firstLine: li === 0, lastCol: ci === colCountSub - 1, numPad: numPlansSub[ci] ? numPlansSub[ci].pads[ri] : -1 });
            lineStr += pre + cellLine + post;
            for (let k = 0; k < pre.length; k++) lineSrc.push(null);
            lineSrc.push(...cellSrc);
            for (let k = 0; k < post.length; k++) lineSrc.push(null);
            const cell = pre + cellLine + post;
            exactFill = cellLine !== '' && !cell.endsWith(' ');
          } else {
            lineStr += cellLine.padEnd(targetW, ' ');
            lineSrc.push(...cellSrc);
            for (let k = cellLine.length; k < targetW; k++) lineSrc.push(null);
            exactFill = cellLine.length >= targetW;
          }
          if (ci < colCountSub - 1) {
            const g = colGutter(exactFill, gutter);
            lineStr += ' '.repeat(g);
            for (let k = 0; k < g; k++) lineSrc.push(null);
          }
        }
        rowOut.push({ s: lineStr.slice(0, w), src: lineSrc.slice(0, w) });
      }
      return rowOut;
    };
    if (headerStrs.some((h) => h.trim())) {
      out.push(...traceRow(headerTrsSub, null));
      const sepCols = widths.map((cw, ci) => (headerStrs[ci].trim() ? (TABLE_GUIDE + '3'.repeat(Math.max(0, cw - 1))) : ' '.repeat(cw)));
      const sepExactFill = widths.map((_, ci) => !!headerStrs[ci].trim());
      out.push(tcDeco(joinTableRow(sepCols, sepExactFill, gutter).slice(0, w)));
    }
    rowTrsSub.forEach((r, ri) => out.push(...traceRow(r, ri)));
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
    sections.forEach((cols, si) => {
      const allCols = [0, ...cols];
      out.push(...traceVerticalSection(
        allCols.map((ci) => headerTrs[ci]),
        rowTrs.map((r) => allCols.map((ci) => r[ci])),
        allCols.map((ci) => colWidths[ci]),
        allCols.map((ci) => numPlans[ci]),
      ));
      if (si < sections.length - 1) out.push(tcBlank);
    });
    out.push(tcBlank);
    return out;
  };

  const traceColumnar = () => {
    const actualWidths = fitColumnWidths(colWidths, w, gutter, columnMinWidths(headers, rows, colCount));
    if (!actualWidths) return traceFallback();
    const plans = numPlans.map((p, c) => (p && actualWidths[c] >= p.width ? p : null));

    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);

    if (block.tabletn || block.note) {
      const tnText = block.tabletn || block.note;
      const openDeco = tcDeco(TN_OPEN);
      const closeDeco = tcDeco(TN_CLOSE);
      const tnRun = tcRun(o, tnText.trim(), null, 0, 0);
      const tnFull = {
        s: openDeco.s + tnRun.s + closeDeco.s,
        src: [...openDeco.src, ...tnRun.src, ...closeDeco.src]
      };
      out.push(...tcWrap(o, tnFull, w, 6, 4), tcBlank);
    }

    // ri == null: a heading row (runover 0, space-padded); else a data row (runover 2,
    // guide dots / place-value padding via tableCellFill) — mirror formatColumnar.
    const formatTracedRow = (cellTrList, ri = null) => {
      const isData = ri != null;
      const wrappedCells = cellTrList.map((cTr, ci) => wrapCellsSrc(cTr.s, cTr.src, actualWidths[ci], 0, isData ? 2 : 0));
      const maxLines = Math.max(1, ...wrappedCells.map((wc) => wc.lines.length));
      const rowOut = [];

      for (let li = 0; li < maxLines; li++) {
        let lineStr = '';
        const lineSrc = [];
        for (let ci = 0; ci < colCount; ci++) {
          const wc = wrappedCells[ci];
          const cellLine = (wc.lines[li] || '');
          const cellSrc = (wc.srcs[li] || []);
          const targetW = actualWidths[ci];

          let exactFill;
          if (isData) {
            const { pre, post } = tableCellFill(cellLine, targetW, { firstLine: li === 0, lastCol: ci === colCount - 1, numPad: plans[ci] ? plans[ci].pads[ri] : -1 });
            lineStr += pre + cellLine + post;
            for (let k = 0; k < pre.length; k++) lineSrc.push(null);
            lineSrc.push(...cellSrc);
            for (let k = 0; k < post.length; k++) lineSrc.push(null);
            const cell = pre + cellLine + post;
            exactFill = cellLine !== '' && !cell.endsWith(' ');   // F-10/Q-7 — mirror formatColumnar
          } else {
            lineStr += cellLine.padEnd(targetW, ' ');
            lineSrc.push(...cellSrc);
            for (let k = cellLine.length; k < targetW; k++) lineSrc.push(null);
            exactFill = cellLine.length >= targetW;
          }

          // BANA §11.4.3a overhang (Change 2) — mirror formatColumnar's padOverhang: a
          // no-op except on the specific column a group's heading overhangs past
          // (overhangWidths is all zero for a table with no headerGroups).
          if (overhangWidths[ci]) {
            lineStr += ' '.repeat(overhangWidths[ci]);
            for (let k = 0; k < overhangWidths[ci]; k++) lineSrc.push(null);
            exactFill = false;
          }

          if (ci < colCount - 1) {
            const g = colGutter(exactFill, gutter);
            lineStr += ' '.repeat(g);
            for (let k = 0; k < g; k++) lineSrc.push(null);
          }
        }
        rowOut.push({
          s: lineStr.slice(0, w),
          src: lineSrc.slice(0, w)
        });
      }
      return { lines: rowOut, maxLines };
    };

    if (headerGroups.length) {
      out.push(...traceGroupedHeaderRows(headerTrs, headerGroups, actualWidths, gutter, w, overhangWidths));
    } else if (headers.some((h) => h.trim())) {
      const hdrFormatted = formatTracedRow(headerTrs);
      out.push(...hdrFormatted.lines);

      out.push(tcDeco(tableSeparator(actualWidths, gutter).slice(0, w)));   // §11.4.2b "3333
    }

    const rowFormatted = rowTrs.map((r, ri) => formatTracedRow(r, ri));

    rowFormatted.forEach((rf) => {
      out.push(...rf.lines);
    });

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
  if (mode === 'columnar') return traceColumnar();
  // T9 — mirror resolveTableLayout: 'auto' always tries the squeeze first (never gated
  // on the unsqueezed natural width, as before this fix) and accepts columnar only when
  // it fits AND every entry, headers included, stays within two lines (BANA §11.6.1).
  // traceColumnar recomputes this identical fitColumnWidths call, so this pre-check
  // can never disagree with what it actually renders.
  const autoWidths = fitColumnWidths(colWidths, w, gutter, columnMinWidths(headers, rows, colCount));
  if (autoWidths && fitsTwoLines(headers, rows, autoWidths)) return traceColumnar();
  // T4 — mirror resolveTableLayout: try vertical division before falling back to
  // Listed/paragraph, which stays the last resort.
  if (!headerGroups.length) {
    const sections = computeVerticalSections(colWidths, gutter, w, colCount);
    if (sections) return traceVertical(sections);
  }
  return traceFallback();
}

// Collapse a leading blank line at the very top (nothing to separate from).
function trimLeadingBlank(lines) {
  while (lines.length && lines[0] === '') lines.shift();
  return lines;
}

// A Table of Contents from the document's headings and their braille page
// numbers, as preliminary page(s) numbered with a 'p' prefix (a separate
// sequence, so the body still starts at braille page 1 — the braille convention
// that avoids the TOC-length-changes-body-numbers circularity). Entry indent by
// heading level; page number right-justified after guide dots (BANA) / a hyphen lead line (UKAAF).
function buildToc(headings, o) {
  if (!headings.length) return [];
  const w = o.width;
  const lines = [...centredBlock(o.translate('Contents'), w).map((l) => l.replace(/\s+$/, '')), ''];
  const maxLevel = headings.reduce((m, h) => Math.max(m, (h.level || 1) - 1), 0);
  for (const h of headings) {
    const num = brailleNumber(h.page);
    // Nested contents pattern (Formats §2.10.6b: runovers two cells right of the
    // deepest sub-level, e.g. 1-5, 3-5). Wrap a long entry so it never overflows
    // the page; put the page number right-justified on the last line, or on its
    // own line if it won't fit there.
    const { first: indent, runover } = nestedMargins('toc', (h.level || 1) - 1, maxLevel, o.mode);
    const wrapped = wrapCells(o.translate(h.text), w, indent, runover);
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
    const pnum = 'P' + brailleNumber(pages.length + 1);          // preliminary page number, e.g. P#A
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
    if (b.type === 'para') scan(b.segments, bi);
    if (b.type === 'list') for (const it of b.items || []) scan(it && it.segments, bi);
  });
  return { first, width };
}

function getBlockSignature(block, o, atStart) {
  if (!block) return '';
  const key = block._key ?? '';
  const type = block.type ?? 'para';
  const text = block.text ?? '';
  const title = block.title ?? '';
  const lvl = block.level ?? 0;
  const maxLevel = block.maxLevel ?? '';                 // poem-wide level tag (verseRunLevels)
  const kind = `${block.kind ?? ''}${block.tdNote ? '+tn' : ''}${block.lnNote ? '+ln' : ''}${block.noteRunStart ? '+sep' : ''}|ln${o.lineNumberWidth || 0}`;
  const marker = block.marker ?? '';
  const style = block.style ?? '';
  const subtype = block.subtype ?? '';
  const format = block.format ?? '';
  const latex = block.latex ?? '';
  const mathml = block.mathml ?? '';
  const segs = block.segments ? JSON.stringify(block.segments) : '';
  const items = block.items ? JSON.stringify(block.items) : '';
  const subBlocks = block.blocks ? JSON.stringify(block.blocks) : '';
  const headers = block.headers ? JSON.stringify(block.headers) : '';
  const rows = block.rows ? JSON.stringify(block.rows) : '';
  const w = o.width || 38;
  const pStyle = o.paragraphStyle ?? '';
  const lStyle = o.listStyle ?? '';
  const mode = o.mode ?? '';
  const tForm = o.tableFormat ?? '';
  const trace = o.trace ? '1' : '0';
  const tiers = headingTierKey(o);                       // BANA heading tiers depend on the whole document
  const tocPagesKey = block.kind === 'toc' ? `${o.tocBrlPagesKey || ''}|${o._hasPrintPages ? 1 : 0}` : '';
  return `${key}|${type}|${title}|${lvl}|${maxLevel}|${kind}|${marker}|${style}|${subtype}|${format}|${latex}|${mathml}|${atStart ? '1' : '0'}|${w}|${pStyle}|${lStyle}|${mode}|${tForm}|${trace}|${tiers}|${tocPagesKey}|${text}|${segs}|${items}|${subBlocks}|${headers}|${rows}`;
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
function noteLayout(blocks, isBana) {
  const n = blocks.length;
  const isNote = (b) => !!b && typeof b === 'object' && b.type === 'footnote' && b.kind !== 'endnote';
  const releasedBy = new Map();                              // referencing bi -> [note bi]
  const moved = new Set();
  if (isBana) {
    const noteAt = new Map();
    blocks.forEach((b, bi) => { if (isNote(b) && b.id && !noteAt.has(b.id)) noteAt.set(b.id, bi); });
    if (noteAt.size) {
      blocks.forEach((b, bi) => {
        if (!b || typeof b !== 'object' || isNote(b)) return;
        const json = JSON.stringify(b);
        if (!json.includes('"noteref"')) return;
        for (const m of json.matchAll(/"idref":"((?:[^"\\]|\\.)*)"/g)) {
          const nb = noteAt.get(JSON.parse(`"${m[1]}"`));
          if (nb == null || moved.has(nb)) continue;
          moved.add(nb);
          if (!releasedBy.has(bi)) releasedBy.set(bi, []);
          releasedBy.get(bi).push(nb);
        }
      });
    }
  }
  const order = [];
  const pending = [];
  const flush = () => { order.push(...pending); pending.length = 0; };
  for (let bi = 0; bi < n; bi++) {
    if (moved.has(bi)) continue;                             // placed after its reference instead
    const b = blocks[bi];
    if (b && typeof b === 'object' && b.type === 'pagenum') flush();
    order.push(bi);
    const notes = releasedBy.get(bi);
    if (notes) pending.push(...notes);
  }
  flush();
  const runStart = new Set();
  if (isBana) order.forEach((bi, k) => { if (isNote(blocks[bi]) && !(k > 0 && isNote(blocks[order[k - 1]]))) runStart.add(bi); });
  return { order, runStart };
}

// A block's keep-together groups (lines.keepGroups = [[first, last], …] line indexes, set by
// formatListed) as a per-line group number, or null.
function keepGroupIndex(lines) {
  if (!lines || !Array.isArray(lines.keepGroups) || !lines.keepGroups.length) return null;
  const of = Array(lines.length).fill(null);
  lines.keepGroups.forEach(([a, b], g) => { for (let i = a; i <= b && i < lines.length; i++) of[i] = g; });
  return of;
}
function applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana = false, contentKeep = []) {
  const n = content.length;
  const out = [], outBlock = [], outCells = [];
  const push = (l, b, c) => { out.push(l); outBlock.push(b === TITLE_LINE ? -1 : b); outCells.push(c); };
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
  
  let bodyPos = 0;
  for (let i = 0; i < n; i++) {
    if (bodyPos === 0 && content[i] === '' && contentBlock[i] !== TITLE_LINE) continue;   // no blank at the top of a page (the title's own blank line stays)
    const bi = contentBlock[i];
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
      if (bodyPos > 0 && need > perPage - bodyPos && need <= perPage) {
        while (bodyPos < perPage) {
          push('', -1, null);
          bodyPos++;
        }
        bodyPos = 0;
      }
    }
    // Keep-together groups (a listed-table row, Formats §11.16j): a group that would run
    // past the page and fits on one page moves to the next page.
    const kg = contentKeep[i];
    if (kg && content[i] !== '' && !seenBoundaryBlock.has(kg)) {
      seenBoundaryBlock.add(kg);
      let end = i; while (end + 1 < n && contentKeep[end + 1] === kg) end++;
      const need = end - i + 1;
      if (bodyPos > 0 && need > perPage - bodyPos && need <= perPage) {
        while (bodyPos < perPage) { push('', -1, null); bodyPos++; }
        bodyPos = 0;
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
      boxNeed = (next < n ? next : i) - i + 1;
    } else if (kind !== 'bottom' && content[i] !== '' && boxLineKind(i + 1) === 'bottom') {
      let end = i + 1; while (boxLineKind(end + 1) === 'bottom') end++;
      boxNeed = end - i + 1;
    }
    if (boxNeed && bodyPos > 0 && boxNeed > perPage - bodyPos && boxNeed <= perPage) {
      while (bodyPos < perPage) {
        push('', -1, null);
        bodyPos++;
      }
      bodyPos = 0;
    }
    push(content[i], bi, contentCells[i]);
    if (isBana && isPageNum(bi) && bodyPos === 0) {
      // In BANA mode, top-of-page transition line moves to Line 1 running head and takes 0 body lines
    } else {
      bodyPos++;
      if (bodyPos === perPage) bodyPos = 0;
    }
  }
  return { content: out, contentBlock: outBlock, contentCells: outCells };
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
    o.translateG1 = (text) => rawG1(cleanForTranslate(text));
  }
  o.width = Math.max(10, Math.min(60, Number(o.width) || 38));
  o.depth = Math.max(10, Math.min(45, Number(o.depth) || 25));
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  const hasPrintPages = blocks.some((b) => b && typeof b === 'object' && b.type === 'pagenum');
  o._hasPrintPages = hasPrintPages;                      // UKAAF contents: print page column only when print pages are shown
  const hasTitle = !!(doc?.title && String(doc.title).trim());
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  const headings = [];
  if (isBana) o.headingTiers = banaHeadingTiers(blocks); // document-wide heading tiers (Formats §4.2.1)
  const verseMax = verseRunLevels(blocks);              // poem-wide indentation (Formats §13.3.1)
  const lineNumbers = lineNumberInfo(blocks, o);
  o.lineNumberWidth = lineNumbers.width;                 // the text of every numbered line ends 2 cells before the widest number
  const firstAsterism = isBana ? blocks.findIndex((b) => b && (b.type === 'break' || b.type === 'indicator') && b.kind === 'asterism' && !b.text) : -1;
  const { order, runStart } = noteLayout(blocks, isBana);
  let content = [], contentBlock = [], contentCells = [], contentKeep = [];
  let atStart = true;
  for (const bi of order) {
    const block = blocks[bi];
    if (!block || typeof block !== 'object') continue;
    let fb = verseMax.has(bi) ? { ...block, maxLevel: verseMax.get(bi) } : block;   // verse line tagged with its poem's depth
    if (bi === firstAsterism) fb = { ...fb, tdNote: true };                             // explain the symbol at first use
    if (bi === lineNumbers.first) fb = { ...fb, lnNote: true };                         // explain line numbers at first use (A30)
    if (runStart.has(bi)) fb = { ...fb, noteRunStart: true };                           // note separation line (§16.5.1a)
    let lines = null, srcs = null;
    const cacheKey = o.blockCache ? getBlockSignature(fb, o, atStart) : null;
    if (cacheKey && o.blockCache.has(cacheKey)) {
      const cached = o.blockCache.get(cacheKey);
      lines = cached.lines;
      srcs = cached.srcs;
      if (lines.length) atStart = false;
    }
    if (lines === null) {
      lines = formatBlock(fb, o, atStart);
      if (o.translatePos) {
        try {
          const tr = traceBlock(fb, o, atStart);
          if (tr.length === lines.length && tr.every((t, i) => t.s === lines[i])) {
            srcs = tr.map((t) => t.src);
          }
        } catch { srcs = null; }
      }
      if (lines.length) atStart = false;
      if (o.blockCache && cacheKey && (!o.translatePos || srcs !== null)) {
        o.blockCache.set(cacheKey, { lines, srcs });
      }
    }

    const headingText = block.text || (block.segments ? block.segments.map(s => s.text || '').join('') : '');
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
    if (lines.length && content.length && joinsWithoutBlank(blocks[contentBlock[contentBlock.length - 1]], block, o)) {
      const pbi = contentBlock[contentBlock.length - 1];
      while (content.length && content[content.length - 1] === '' && contentBlock[contentBlock.length - 1] === pbi) {
        content.pop(); contentBlock.pop(); contentCells.pop(); contentKeep.pop();
      }
      while (li0 < lines.length && lines[li0] === '') li0++;
    }
    const keepOf = keepGroupIndex(lines);
    for (let li = li0; li < lines.length; li++) {
      if (lines[li] === '' && content.length && content[content.length - 1] === '') continue;
      content.push(lines[li]); contentBlock.push(bi); contentCells.push(srcs ? srcs[li] : null);
      contentKeep.push(keepOf && keepOf[li] != null ? `${bi}:${keepOf[li]}` : null);
    }
  }
  const preLen = content.length;
  trimLeadingBlank(content);
  const shift = preLen - content.length;
  if (shift) { contentBlock.splice(0, shift); contentCells.splice(0, shift); contentKeep.splice(0, shift); }
  if (!content.length) return { empty: true, opts: o };
  if (isBana) ({ content, contentBlock, contentCells, contentKeep } = singleBlankAroundPageChange(content, contentBlock, contentCells, blocks, contentKeep));
  const pageOne = bookTitleLines(doc, o, isBana, hideHeader);
  if (pageOne.rest.length) {
    content.unshift(...pageOne.rest); contentBlock.unshift(...pageOne.rest.map(() => TITLE_LINE));
    contentCells.unshift(...pageOne.rest.map(() => null)); contentKeep.unshift(...pageOne.rest.map(() => null));
  }
  ({ content, contentBlock, contentCells } = applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana, contentKeep));
  const bodyPages = assemble(content, {
    title: doc?.title ?? null, width: o.width, depth: o.depth, mode: isBana ? 'bana' : 'ukaaf', translate: o.translate, pageOneTitle: pageOne.first,
    suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders, hasPrintPages,
  });
  let tocPages = [];
  if (o.toc && headings.length) {
    for (const h of headings) {
      let line = contentBlock.indexOf(h.bi);
      while (line >= 0 && line + 1 < content.length && content[line] === '' && contentBlock[line + 1] === h.bi) line++;
      h.line = Math.max(0, line);
      h.page = Math.floor(h.line / perPage) + 1;
    }
    tocPages = buildToc(headings, o);
  }
  return { empty: false, content, contentBlock, contentCells, headings, tocPages, bodyPages, hasPrintPages, hasTitle, perPage, blocks, opts: o };
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
    o.translateG1 = (text) => rawG1(cleanForTranslate(text));
  }
  o.width = Math.max(10, Math.min(60, Number(o.width) || 38));
  o.depth = Math.max(10, Math.min(45, Number(o.depth) || 25));
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  const hasPrintPages = blocks.some((b) => b && typeof b === 'object' && b.type === 'pagenum');
  o._hasPrintPages = hasPrintPages;                      // UKAAF contents: print page column only when print pages are shown
  const hasTitle = !!(doc?.title && String(doc.title).trim());
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  const headings = [];
  if (isBana) o.headingTiers = banaHeadingTiers(blocks); // document-wide heading tiers (Formats §4.2.1)
  const verseMax = verseRunLevels(blocks);              // poem-wide indentation (Formats §13.3.1)
  const lineNumbers = lineNumberInfo(blocks, o);
  o.lineNumberWidth = lineNumbers.width;                 // the text of every numbered line ends 2 cells before the widest number
  const firstAsterism = isBana ? blocks.findIndex((b) => b && (b.type === 'break' || b.type === 'indicator') && b.kind === 'asterism' && !b.text) : -1;
  const { order, runStart } = noteLayout(blocks, isBana);
  let content = [], contentBlock = [], contentCells = [], contentKeep = [];
  let atStart = true;
  for (let oi = 0; oi < order.length; oi++) {
    const bi = order[oi];
    if (oi > 0 && oi % 150 === 0) {
      if (typeof o.onProgress === 'function') {
        o.onProgress(bi, blocks.length);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    const block = blocks[bi];
    if (!block || typeof block !== 'object') continue;
    let fb = verseMax.has(bi) ? { ...block, maxLevel: verseMax.get(bi) } : block;   // verse line tagged with its poem's depth
    if (bi === firstAsterism) fb = { ...fb, tdNote: true };                             // explain the symbol at first use
    if (bi === lineNumbers.first) fb = { ...fb, lnNote: true };                         // explain line numbers at first use (A30)
    if (runStart.has(bi)) fb = { ...fb, noteRunStart: true };                           // note separation line (§16.5.1a)
    let lines = null, srcs = null;
    const cacheKey = o.blockCache ? getBlockSignature(fb, o, atStart) : null;
    if (cacheKey && o.blockCache.has(cacheKey)) {
      const cached = o.blockCache.get(cacheKey);
      lines = cached.lines;
      srcs = cached.srcs;
      if (lines.length) atStart = false;
    }
    if (lines === null) {
      lines = formatBlock(fb, o, atStart);
      if (o.translatePos) {
        try {
          const tr = traceBlock(fb, o, atStart);
          if (tr.length === lines.length && tr.every((t, i) => t.s === lines[i])) {
            srcs = tr.map((t) => t.src);
          }
        } catch { srcs = null; }
      }
      if (lines.length) atStart = false;
      if (o.blockCache && cacheKey && (!o.translatePos || srcs !== null)) {
        o.blockCache.set(cacheKey, { lines, srcs });
      }
    }

    const headingText = block.text || (block.segments ? block.segments.map(s => s.text || '').join('') : '');
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
    if (lines.length && content.length && joinsWithoutBlank(blocks[contentBlock[contentBlock.length - 1]], block, o)) {
      const pbi = contentBlock[contentBlock.length - 1];
      while (content.length && content[content.length - 1] === '' && contentBlock[contentBlock.length - 1] === pbi) {
        content.pop(); contentBlock.pop(); contentCells.pop(); contentKeep.pop();
      }
      while (li0 < lines.length && lines[li0] === '') li0++;
    }
    const keepOf = keepGroupIndex(lines);
    for (let li = li0; li < lines.length; li++) {
      if (lines[li] === '' && content.length && content[content.length - 1] === '') continue;
      content.push(lines[li]); contentBlock.push(bi); contentCells.push(srcs ? srcs[li] : null);
      contentKeep.push(keepOf && keepOf[li] != null ? `${bi}:${keepOf[li]}` : null);
    }
  }
  const preLen = content.length;
  trimLeadingBlank(content);
  const shift = preLen - content.length;
  if (shift) { contentBlock.splice(0, shift); contentCells.splice(0, shift); contentKeep.splice(0, shift); }
  if (!content.length) return { empty: true, opts: o };
  if (isBana) ({ content, contentBlock, contentCells, contentKeep } = singleBlankAroundPageChange(content, contentBlock, contentCells, blocks, contentKeep));
  const pageOne = bookTitleLines(doc, o, isBana, hideHeader);
  if (pageOne.rest.length) {
    content.unshift(...pageOne.rest); contentBlock.unshift(...pageOne.rest.map(() => TITLE_LINE));
    contentCells.unshift(...pageOne.rest.map(() => null)); contentKeep.unshift(...pageOne.rest.map(() => null));
  }
  ({ content, contentBlock, contentCells } = applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana, contentKeep));
  const bodyPages = assemble(content, {
    title: doc?.title ?? null, width: o.width, depth: o.depth, mode: isBana ? 'bana' : 'ukaaf', translate: o.translate, pageOneTitle: pageOne.first,
    suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders, hasPrintPages,
  });
  let tocPages = [];
  if (o.toc && headings.length) {
    for (const h of headings) {
      let line = contentBlock.indexOf(h.bi);
      while (line >= 0 && line + 1 < content.length && content[line] === '' && contentBlock[line + 1] === h.bi) line++;
      h.line = Math.max(0, line);
      h.page = Math.floor(h.line / perPage) + 1;
    }
    tocPages = buildToc(headings, o);
  }
  return { empty: false, content, contentBlock, contentCells, headings, tocPages, bodyPages, hasPrintPages, hasTitle, perPage, blocks, opts: o };
}

// BANA Formats §1.8.1: the complete book title, in print capitalization, centred on line 1
// of braille page 1 "and other lines as necessary", followed by a blank line. `first` goes on
// line 1 (assemble); `rest` (further title lines and the blank line) opens the body.
const TITLE_LINE = -2;                                     // contentBlock marker: page-1 title lines (kept, then -1)
function bookTitleLines(doc, o, isBana, hideHeader) {
  const title = doc?.title != null ? String(doc.title).trim() : '';
  if (!isBana || hideHeader || !title || typeof o.translate !== 'function') return { first: null, rest: [] };
  const w = o.width || 40;
  const lines = wrapCells(o.translate(title).trim(), Math.max(10, w - 10), 0, 0).map((l) => l.trim()).filter(Boolean);
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
  b.contentBlock.forEach((bi, line) => {
    if (seen.has(bi) || b.content[line] === '') return;
    const blk = b.blocks[bi];
    if (!blk || blk.type !== 'heading') return;
    seen.add(bi);
    const text = blk.text || (blk.segments ? blk.segments.map((g) => g.text || '').join('') : '');
    const key = tocKey(text);
    if (key && !map.has(key)) map.set(key, Math.floor(line / b.perPage) + 1);
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
  if (o.trace) { const t = traceRows(b.content, b.contentBlock, b.contentCells, b.tocPages, b.opts, b.hasPrintPages, b.hasTitle); o.trace.rows = t.rows; o.trace.rowCells = t.rowCells; }
  return toBRF([...b.tocPages, ...b.bodyPages]);
}

async function formatDocumentAsync(doc, o) {
  const b = await buildDocPagesFullAsync(doc, o);
  if (b.empty) return '';
  if (o.trace) { const t = traceRows(b.content, b.contentBlock, b.contentCells, b.tocPages, b.opts, b.hasPrintPages, b.hasTitle); o.trace.rows = t.rows; o.trace.rowCells = t.rowCells; }
  return toBRF([...b.tocPages, ...b.bodyPages]);
}

// Print a braille page with a centered title, a volume number, and border rows
// top and bottom. Standard UK/US library prelim layout.
function volumeTitlePage(vol, of, title, o) {
  const w = o.width, depth = o.depth;
  const tr = (s) => o.translate(s);
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  if (isBana) {
    const border = '='.repeat(w);
    const lines = [border, ''];
    if (title) { for (const l of centredBlock(tr(title), w)) lines.push(l.replace(/\s+$/, '')); lines.push(''); }
    for (const l of centredBlock(tr(`VOLUME ${vol} OF ${of}`), w)) lines.push(l.replace(/\s+$/, ''));
    while (lines.length < depth - 1) lines.push('');
    while (lines.length > depth - 1) lines.splice(lines.length - 1, 1);   // over-long title: trim above the bottom border
    lines.push(border);
    return lines;
  }
  const lines = [''];
  if (title) { for (const l of centredBlock(tr(title), w)) lines.push(l.replace(/\s+$/, '')); lines.push(''); lines.push(''); }
  for (const l of centredBlock(tr(`Volume ${vol} of ${of}`), w)) lines.push(l.replace(/\s+$/, ''));
  return lines.slice(0, depth);
}

// Split a document into braille volumes of at most o.volumePages *body* pages each
// (0/undefined = a single volume). We split AFTER assembly (so print page
// continuation letters etc. are already baked in) and then renumber each
// volume's pages from braille page 1: "Begin the main text of each volume with
// braille page 1" (Formats §1.15.1d); "Braille page numbering must always start
// at 1 (for each volume)" (B004 §7). The TOC prelim pages ride with volume 1
// (its entries for later volumes still cite whole-document page numbers). Returns
// [{ volume, of, brf, spineLabel }]. Splits on braille-page boundaries only.
function formatVolumes(doc, o) {
  const b = buildDocPagesFull(doc, o);
  o = b.opts;
  const title = doc?.title != null ? String(doc.title) : 'DOCUMENT';
  if (b.empty) return [{ volume: 1, of: 1, brf: '', spineLabel: `${title} - VOL 1/1` }];
  const maxV = Math.max(0, o.volumePages | 0);
  if (!maxV || b.bodyPages.length <= maxV) {
    return [{ volume: 1, of: 1, brf: toBRF([...b.tocPages, ...b.bodyPages]), spineLabel: `${title} - VOL 1/1` }];
  }
  const renum = { width: o.width, mode: (o.standard === 'bana' || o.mode === 'bana') ? 'bana' : 'ukaaf', suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders };
  const chunks = [];
  for (let i = 0; i < b.bodyPages.length; i += maxV) {
    chunks.push(b.bodyPages.slice(i, i + maxV).map((pg, k) => renumberPage(pg, i + k + 1, k + 1, renum)));   // Formats §1.15.1d / B004 §7
  }
  const of = chunks.length;
  return chunks.map((chunk, idx) => ({
    volume: idx + 1, of,
    spineLabel: `${title} - VOL ${idx + 1}/${of}`,
    brf: toBRF([volumeTitlePage(idx + 1, of, title, o), ...(idx === 0 ? b.tocPages : []), ...chunk]),
  }));
}

async function formatVolumesAsync(doc, o) {
  const b = await buildDocPagesFullAsync(doc, o);
  o = b.opts;
  const title = doc?.title != null ? String(doc.title) : 'DOCUMENT';
  if (b.empty) return [{ volume: 1, of: 1, brf: '', spineLabel: `${title} - VOL 1/1` }];
  const maxV = Math.max(0, o.volumePages | 0);
  if (!maxV || b.bodyPages.length <= maxV) {
    return [{ volume: 1, of: 1, brf: toBRF([...b.tocPages, ...b.bodyPages]), spineLabel: `${title} - VOL 1/1` }];
  }
  const renum = { width: o.width, mode: (o.standard === 'bana' || o.mode === 'bana') ? 'bana' : 'ukaaf', suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders };
  const chunks = [];
  for (let i = 0; i < b.bodyPages.length; i += maxV) {
    chunks.push(b.bodyPages.slice(i, i + maxV).map((pg, k) => renumberPage(pg, i + k + 1, k + 1, renum)));   // Formats §1.15.1d / B004 §7
  }
  const of = chunks.length;
  return chunks.map((chunk, idx) => ({
    volume: idx + 1, of,
    spineLabel: `${title} - VOL ${idx + 1}/${of}`,
    brf: toBRF([volumeTitlePage(idx + 1, of, title, o), ...(idx === 0 ? b.tocPages : []), ...chunk]),
  }));
}

// Reconstruct assemble()'s per-page row layout to label each output row with its
// source block. Must mirror assemble() + buildToc() exactly.
function traceRows(content, contentBlock, contentCells, tocPages, o, hasPrintPages = false, hasTitle = false) {
  const rows = [], rowCells = [];
  const push = (b, c) => { rows.push(b); rowCells.push(c); };
  for (const page of tocPages) for (let i = 0; i < page.length; i++) push(-1, null);
  const hideHeader = o.suppressHeader || o.pageHeaders === false;
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hasFurniture = hasPrintPages || hasTitle;
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  
  let lineIdx = 0;
  while (lineIdx < content.length) {
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

export { formatDocument, formatDocumentAsync, formatVolumes, formatVolumesAsync, formatBlock, traceBlock, getBlockSignature, centred, indicatorLine };
