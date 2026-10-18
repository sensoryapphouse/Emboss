// The maths engine's pure steps, shared by the browser wrapper (engine/maths.mjs) and the Node test wrapper (format/node-maths-helper.mjs).
// Audit batch S5b (15 Oct 2026, "Maths in Node checks differs from maths in the product"): the two wrappers used to prepare the MathML and
// tidy the braille separately, so the parity check and the corpus braille'd maths differently from the product (a BANA number lacked the
// Nemeth code-switch wrap, an empty equation was a stray cell). Now everything except loading MathCAT and calling it lives here; the two
// wrappers differ only in how they bootstrap MathCAT and what they pass to createMathsEngine as `callMathCat`.
//
// No import of MathCAT here, and only relative imports: this file loads unchanged in the browser (/engine/maths-core.mjs) and in Node.
import { unicodeBrailleToBrf } from './brf-ascii.mjs';
import { spacingAccentsInMathML, uebFunctionSpaceInMathML, limitMathMLNesting, tidyMathMLForBraille, isEmptyMathML, mathRejectedError } from '../input/omml.mjs';

// UKAAF mode -> UEB (Technical) maths; BANA mode -> Nemeth. The wrappers' callers say 'nemeth' or 'bana' for Nemeth, anything else is UEB.
export function mathCodeForMode(mode) {
  return (mode === 'nemeth' || mode === 'bana') ? 'Nemeth' : 'UEB';
}

// BANA "UEB with Nemeth" code-switch (a Nemeth passage embedded in a UEB/print
// document): opening Nemeth Code indicator ⠸⠩ (dots 4-5-6, dots 1-4-6) then a
// space, the Nemeth braille, a space, then the terminator ⠸⠱ (dots 4-5-6,
// dots 1-5-6). Per the BANA "Nemeth Code within UEB Contexts" guidance. UEB maths
// needs no wrap: MathCAT already emits the UEB grade-1 switch (⠰⠰⠰ … ⠰⠄).
export const NEMETH_OPEN = '⠸⠩ ';   // ⠸⠩ + space
export const NEMETH_CLOSE = ' ⠸⠱'; // space + ⠸⠱

// ---- Empty MathML (audit E-3) ----
// An equation with no content in print is nothing in braille (no ⠿/⠬ wrapper): isEmptyMathML lives in input/omml.mjs; re-exported here
// (and from engine/maths.mjs) for the callers and tests that import it from the maths modules.
export { isEmptyMathML };

// ---- MathCAT output clean-up (audit E-1) ----
// MathCAT's Nemeth rules mark the start of every matrix row after the first
// with U+28CD (⣍, dots 1-3-4-7-8) — an 8-dot cell that no 6-dot BRF map can
// represent; brf-ascii.mjs masks it to dots 1-3-4 and an `M` appeared inside
// the matrix. Rows must go on separate braille lines, so the separator becomes
// a newline (dropping the braille blank MathCAT puts before it, which would
// otherwise trail the line); wrapCells / segmentsToBraille already split
// braille on '\n'. The full spatial layout (enlarged brackets down each row)
// is a formatter concern, not done here.
//
// Any OTHER dots-7/8 cell (U+2840–U+28FF) is unexpected — MathCAT uses the
// upper dots only for internal markers — so it is reported once per
// translation, naming the code point(s), and the cell is reduced to its 6-dot
// part rather than silently masked.
const NEMETH_ROW_SEP_RE = /[⠀ ]*⣍[⠀ ]*/g;   // U+2800 = braille blank
const EIGHT_DOT_RE = /[⡀-⣿]/g;                  // any cell with dot 7 or 8 set
export function cleanMathCatBraille(braille) {
  let s = braille.replace(NEMETH_ROW_SEP_RE, '\n');
  if (EIGHT_DOT_RE.test(s)) {
    const seen = new Set();
    s = s.replace(EIGHT_DOT_RE, (ch) => {
      const cp = ch.codePointAt(0);
      seen.add('U+' + cp.toString(16).toUpperCase());
      return String.fromCharCode(0x2800 + (cp & 0x3f));
    });
    console.warn(`MathCAT emitted unexpected dots-7/8 braille cell(s) ${[...seen].join(', ')}; dots 7/8 stripped for 6-dot output`);
  }
  return s;
}

// The MathML as MathCAT is given it, for the code ('UEB' | 'Nemeth'): tidy (a bare editor fragment / loose text, as a save would write it, A89);
// a combining accent in an <mo> -> its spacing form (#44: MathCAT has no braille for the combining one); nesting MathCAT cannot take (about
// 4 times the time per level of a script nested in a script base) flattened first (A89 step 4); and UEB's space before a function after a
// script ending in a letter (A84), for every reader.
export function prepareMathMLForCode(mathml, code) {
  const prepared = limitMathMLNesting(spacingAccentsInMathML(tidyMathMLForBraille(mathml)));
  return code === 'UEB' ? uebFunctionSpaceInMathML(prepared) : prepared;
}

// Builds the maths entry points around one MathCAT caller.
//   callMathCat(mathml, code) -> the unicode braille string, or a string starting 'ERROR:' (a throw is the same as that). Only this and
//   isReady differ between the browser (the web WASM build) and Node (the CommonJS build of the same MathCAT).
//   isReady() -> boolean; while it is false every translation throws 'maths engine not initialised'.
//   getTemml() -> the Temml library for LaTeX segments, or null (browser: globalThis.temml, vendored and loaded via <script>).
export function createMathsEngine({ callMathCat, isReady, getTemml }) {
  // Convert a MathML string to BRF-ASCII braille for the given mode/mathCode.
  // Returns '' only for an equation that is genuinely empty in print. An equation with content that MathCAT cannot translate THROWS
  // (audit batch S2b, item 11): an error marker cell in the braille would be indistinguishable from real maths to the reader, and an
  // empty string was taken by the formatter for "nothing here", so the equation vanished with no warning. The error is marked
  // `mathRejected`; the formatter puts the transcriber's note "Equation could not be read" in its place and raises a warning.
  function mathmlToBrf(mathml, mode) {
    if (!isReady()) throw new Error('maths engine not initialised');
    const code = mathCodeForMode(mode);
    if (isEmptyMathML(mathml)) return '';              // nothing in print → nothing in braille (no ⠿/⠬ wrapper)
    let braille;
    try {
      braille = callMathCat(prepareMathMLForCode(mathml, code), code);
    } catch (e) {
      console.warn('MathCAT translation error (equation rejected):', e);
      throw mathRejectedError((e && e.message) || e);
    }
    if (typeof braille !== 'string' || braille.startsWith('ERROR:')) {
      console.warn('MathCAT translation failed (equation rejected):', braille);
      throw mathRejectedError(braille);
    }
    braille = cleanMathCatBraille(braille);
    if (!braille.trim()) return '';                    // degenerate MathML → nothing (not an empty Nemeth wrapper)
    if (code === 'Nemeth') braille = NEMETH_OPEN + braille + NEMETH_CLOSE;
    return unicodeBrailleToBrf(braille);
  }

  // Convert a LaTeX string to BRF-ASCII braille for the given mode, via Temml (LaTeX -> MathML). Callers may pass their own `temml`.
  function latexToBrf(latex, mode, temmlLib) {
    const temml = temmlLib || (getTemml && getTemml());
    if (!temml) throw new Error('temml not available');
    const mathml = temml.renderToString(latex, { throwOnError: false });
    return mathmlToBrf(mathml, mode);
  }

  // Single entry point for a maths segment/block: { mathml } and/or { latex }.
  // PREFER MathML — it's canonical and needs no Temml. The editor and the docx path
  // both supply mathml (the editor converts LaTeX→MathML via MathLive), and a segment
  // carrying BOTH must NOT take the Temml path: Temml isn't loaded in the editor, so it
  // would throw and the equation would be silently dropped by the formatter. Fall back
  // to LaTeX (via Temml) only when there is no MathML (e.g. md/txt `$…$` input).
  function mathToBrf(seg, mode) {
    if (!seg) throw new Error('mathToBrf: missing segment');
    if (seg.mathml != null) return mathmlToBrf(seg.mathml, mode);
    if (seg.latex != null) return latexToBrf(seg.latex, mode);
    throw new Error('mathToBrf: segment has neither mathml nor latex');
  }

  return { mathmlToBrf, latexToBrf, mathToBrf };
}
