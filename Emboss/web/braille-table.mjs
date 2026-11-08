// One decider for "which liblouis table list is in force, and how does its output
// become BRF". Quick Mode (web/app.mjs) and the Advanced editor (web/editor/editor.mjs)
// both import this so a braille code chosen in one is honoured by the other.
//
// Why the BRF conversion lives here: the 142 codes in Translate/braille-codes.mjs are
// listed with the `unicode.dis` display table, so liblouis returns Unicode braille
// (U+2800–U+28FF) for them, not North-American Braille ASCII. Everything downstream —
// the layout engine, the .brf download, the embosser spooler — is BRF ASCII, so the
// translation is normalised here, once, and a wrong display table can never leak
// Unicode into a .brf again. Dots 7/8 (8-dot computer codes) are masked to six dots,
// which is all a BRF cell can carry.
import { CODES } from '../Translate/braille-codes.mjs';
import { unicodeBrailleToBrf, brfToUnicodeBraille } from '../engine/brf-ascii.mjs';
import { relaxTranslation, allowsEverything } from '../format/relaxed-braille.mjs';

export const UEB_TABLES = {
  g1: '/tables/en-us-brf.dis,/tables/en-ueb-g1.ctb',
  g2: '/tables/en-us-brf.dis,/tables/en-ueb-g2.ctb',
};

// The table list for the persisted settings: the selected braille code's own list,
// else English UEB at the selected grade.
export function resolveTable(settings) {
  const code = settings && settings.brailleCode ? CODES.find((c) => c.id === settings.brailleCode) : null;
  if (code && code.table) return code.table;
  return settings && settings.grade === 'g1' ? UEB_TABLES.g1 : UEB_TABLES.g2;
}

// S3b #17 (ChatGPT audit 15 Oct 2026): the eBraille export declares the braille system of the braille it holds. Quick Mode had this mapping
// (web/app.mjs registryName); the editor passed nothing, so every editor eBraille said "ueb grade2". It lives here, beside resolveTable, so both
// modes ask the same question of the same settings. The Braille Codes Registry names UEB by grade; every other code has no registered name yet, so
// its own id is written (the spec says values SHOULD come from the registry, not MUST). A code this build does not know is brailled with the UEB
// table of the selected grade (resolveTable), so that is what is declared.
export function registryName(settings) {
  const known = settings && settings.brailleCode ? CODES.find((c) => c.id === settings.brailleCode) : null;
  const code = known ? known.id : (settings && settings.grade === 'g1' ? 'en-ueb-g1' : 'en-ueb-g2');
  if (/ueb/i.test(code) && /g1|grade ?1|uncontracted/i.test(code)) return 'ueb grade1';
  if (/ueb/i.test(code)) return 'ueb grade2';
  return code;
}

// The settings that name the braille actually made: the code whose table list is `tableList` (the table the translator ran with, which is not
// always the one the settings ask for - the previous table stays active when a code cannot be loaded). The eBraille export derives its
// declared system and language from this, in Quick Mode and in the editor alike.
export function settingsForTable(tableList) {
  if (tableList === UEB_TABLES.g1) return { brailleCode: 'en-ueb-g1', grade: 'g1' };
  if (tableList === UEB_TABLES.g2) return { brailleCode: 'en-ueb-g2', grade: 'g2' };
  const code = CODES.find((c) => c.table === tableList);
  return code ? { brailleCode: code.id } : {};
}

// The language the selected braille code is written for (the code's own `lang`; English for UEB and for a code this build does not know).
// eBraille's language (S3b #18, Paul B1): the document's own, then this, then the browser's.
export function codeLanguage(settings) {
  const known = settings && settings.brailleCode ? CODES.find((c) => c.id === settings.brailleCode) : null;
  return (known && known.lang) || 'en';
}

export function isUnicodeTable(tableList) { return /unicode\.dis/.test(String(tableList)); }

// Relaxed braille (A91, task 3; Paul 3 Oct 2026): UEB contracted braille using only the contractions a reader has learned, the rest
// spelled out in letters (format/relaxed-braille.mjs). It applies to the UEB grade 2 table ONLY: the grade 1 table, every other
// braille code and all maths (MathCAT, never these translators) are left exactly as they are.
export const RELAXABLE_TABLE_RE = /en-ueb-g2\.ctb/;
// True when `relaxed` (a Set of the catalogue keys a reader holds; null / undefined = All) changes the braille of this table list.
export function relaxedApplies(tableList, relaxed) {
  return relaxed != null && RELAXABLE_TABLE_RE.test(String(tableList)) && !allowsEverything(relaxed);
}

// Wrap the raw engine so every caller gets BRF ASCII out and can hand BRF ASCII back
// in, whatever display table the code was listed with. translatePos keeps its
// cell→source map valid because the conversion is one character per cell.
//
// options.relaxed (A91): a Set of contraction keys to KEEP (format/relaxed-signs.mjs UEB_CONTRACTION_SIGNS[].key), or null = All.
// With a Set that leaves signs out AND the UEB grade 2 table, translate / translatePos translate in full contracted UEB as always,
// then spell out each contraction not in the Set (relaxTranslation). In every other case - no option, null, the All Set, grade 1,
// another braille code - both are exactly what they were. translate(text) = translatePos(text).braille when relaxed (the two
// liblouis calls give the same braille; tests/relaxed_translators.test.mjs checks it). translatePos's result then also carries
// `spelledOut` and `unresolved` (relaxTranslation's lists, for the status bar).
export function makeTranslators(louis, tableList, options) {
  const uni = isUnicodeTable(tableList);
  const relaxed = options && options.relaxed;
  const basePos = (text, typeform) => {
    const r = louis.translatePos(text, tableList, typeform);
    return { braille: unicodeBrailleToBrf(r.braille), inputPos: r.inputPos };
  };
  const relax = relaxedApplies(tableList, relaxed)
    ? (text, typeform) => relaxTranslation(text, basePos(text, typeform), relaxed, { translatePos: (w) => basePos(w, null) })
    : null;
  return {
    table: tableList,
    translate: relax
      ? (text, typeform) => relax(text, typeform).braille
      : (text, typeform) => unicodeBrailleToBrf(louis.translate(text, tableList, typeform)),
    translatePos: relax
      ? (text, typeform) => relax(text, typeform)
      : (text, typeform) => basePos(text, typeform),
    backTranslate: (brf) => louis.backTranslate(uni ? brfToUnicodeBraille(brf) : brf, tableList),
    backTranslateRuns: (brf) => {
      const input = uni ? brfToUnicodeBraille(brf) : brf;
      if (typeof louis.backTranslateRuns === 'function') {
        return louis.backTranslateRuns(input, tableList);
      }
      const plain = louis.backTranslate(input, tableList);
      return { text: plain, tfArray: new Array(plain.length).fill(0), runs: [{ type: 'text', text: plain, tf: 0 }] };
    },
  };
}
