// Browser maths engine: MathML -> braille via MathCAT (WASM), mapped to BRF ASCII.
// UKAAF mode -> UEB (Technical) maths; BANA mode -> Nemeth.
import init, { mathml_to_braille } from '/engine/mathcat/pkg-web/emboss_mathcat.js';
import { unicodeBrailleToBrf } from '/engine/brf-ascii.mjs';

let ready = false;

export async function initMaths() {
  if (ready) return;
  await init();                         // fetches emboss_mathcat_bg.wasm (rules embedded)
  ready = true;
}

export const isMathsReady = () => ready;

// BANA "UEB with Nemeth" code-switch (a Nemeth passage embedded in a UEB/print
// document): opening Nemeth Code indicator ⠸⠩ (dots 4-5-6, dots 1-4-6) then a
// space, the Nemeth braille, a space, then the terminator ⠸⠱ (dots 4-5-6,
// dots 1-5-6). Per the BANA "Nemeth Code within UEB Contexts" guidance. UEB maths
// needs no wrap: MathCAT already emits the UEB grade-1 switch (⠰⠰⠰ … ⠰⠄).
const NEMETH_OPEN = '⠸⠩ ';   // ⠸⠩ + space
const NEMETH_CLOSE = ' ⠸⠱'; // space + ⠸⠱

// Convert a MathML string to BRF-ASCII braille for the given mode/mathCode.
export function mathmlToBrf(mathml, mode) {
  if (!ready) throw new Error('maths engine not initialised');
  const code = (mode === 'nemeth' || mode === 'bana') ? 'Nemeth' : 'UEB';
  let braille;
  try {
    braille = mathml_to_braille(mathml, code);
  } catch (e) {
    console.warn('MathCAT translation error:', e);
    return unicodeBrailleToBrf('⠌⠼');
  }
  if (typeof braille !== 'string' || braille.startsWith('ERROR:')) {
    console.warn('MathCAT translation warning:', braille);
    return unicodeBrailleToBrf('⠌⠼');
  }
  if (!braille) return '';                          // empty/degenerate MathML → nothing (not an empty Nemeth wrapper)
  if (code === 'Nemeth') braille = NEMETH_OPEN + braille + NEMETH_CLOSE;
  return unicodeBrailleToBrf(braille);
}

// Convert a LaTeX string to BRF-ASCII braille for the given mode, via Temml
// (LaTeX -> MathML). Node callers pass their own `temml` (require('temml'));
// browser callers rely on globalThis.temml (vendored, loaded via <script>).
export function latexToBrf(latex, mode, temmlLib) {
  const temml = temmlLib || globalThis.temml;
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
export function mathToBrf(seg, mode) {
  if (!seg) throw new Error('mathToBrf: missing segment');
  if (seg.mathml != null) return mathmlToBrf(seg.mathml, mode);
  if (seg.latex != null) return latexToBrf(seg.latex, mode);
  throw new Error('mathToBrf: segment has neither mathml nor latex');
}
