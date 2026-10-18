// Shared helpers for the NIMAS save -> reopen tests (nimas_save_reopen_braille.test.mjs,
// nimas_dtbook_import_fixes.test.mjs): format a model in BANA or UKAAF mode with a plain
// upper-casing translator (fast, and any difference is a difference in STRUCTURE, not in the
// contraction tables), save it with exportToNimasXml, and open the saved XML again.
// Not a test file (no .test.mjs suffix), so run-all-tests.mjs does not run it on its own.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
const { formatDocument } = await import('../../format/document.mjs');
const { parseFile, parseDtbook } = await import('../../input/parse.mjs');
const { exportToNimasXml } = await import('../../input/nimas-export.mjs');

export { parseFile, parseDtbook, exportToNimasXml, formatDocument };

const up = (s) => String(s).toUpperCase();
/** Formatter options with a plain upper-casing translator (the same shape the editor passes). */
export function upperOptions(mode, extra = {}) {
  return {
    mode, standard: mode, width: 40, depth: 25,
    translate: up,
    translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
    ...extra,
  };
}

/** The braille lines of a model (the model is cloned first: formatting must not change it). */
export function brailleLines(model, options) {
  return formatDocument(structuredClone(model), options).split('\r\n');
}

/** Save a model as NIMAS XML and read the XML back with the same parser the editor uses. */
export async function saveAndReopen(model) {
  const xml = exportToNimasXml(structuredClone(model));
  const back = await parseFile('saved.xml', xml);
  return { xml, back };
}

/** The first difference between two line lists, as a short readable string (null when equal). */
export function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const ctx = (l) => JSON.stringify(l.slice(Math.max(0, i - 2), i + 3));
      return `line ${i} of ${a.length}/${b.length}\n  before save: ${ctx(a)}\n  after reopen: ${ctx(b)}`;
    }
  }
  return null;
}
