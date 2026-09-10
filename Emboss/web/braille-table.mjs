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

export function isUnicodeTable(tableList) { return /unicode\.dis/.test(String(tableList)); }

// Wrap the raw engine so every caller gets BRF ASCII out and can hand BRF ASCII back
// in, whatever display table the code was listed with. translatePos keeps its
// cell→source map valid because the conversion is one character per cell.
export function makeTranslators(louis, tableList) {
  const uni = isUnicodeTable(tableList);
  return {
    table: tableList,
    translate: (text, typeform) => unicodeBrailleToBrf(louis.translate(text, tableList, typeform)),
    translatePos: (text, typeform) => {
      const r = louis.translatePos(text, tableList, typeform);
      return { braille: unicodeBrailleToBrf(r.braille), inputPos: r.inputPos };
    },
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
