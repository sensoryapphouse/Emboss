// Browser maths engine: MathML -> braille via MathCAT (WASM), mapped to BRF ASCII.
// UKAAF mode -> UEB (Technical) maths; BANA mode -> Nemeth.
// Since audit batch S5b this file is only the browser bootstrap (loading the web WASM build of MathCAT and calling it); every pure step -
// the preparation of the MathML, the Nemeth code-switch wrap, empty-input detection, the rejected-equation contract (S2b), matrix row
// clean-up, LaTeX and segment entry points - is in ./maths-core.mjs, which the Node test wrapper (format/node-maths-helper.mjs) shares.
import init, { mathml_to_braille } from '/engine/mathcat/pkg-web/emboss_mathcat.js';
import { createMathsEngine, cleanMathCatBraille, isEmptyMathML } from './maths-core.mjs';   // relative: resolves the same in the browser (/engine/maths-core.mjs) and in Node

let ready = false;

export async function initMaths() {
  if (ready) return;
  await init();                         // fetches emboss_mathcat_bg.wasm (rules embedded)
  ready = true;
}

export const isMathsReady = () => ready;

const engine = createMathsEngine({
  callMathCat: (mathml, code) => mathml_to_braille(mathml, code),
  isReady: () => ready,
  getTemml: () => globalThis.temml,       // vendored, loaded via <script>
});

// Re-exported for the callers and tests that import them from this module.
export { isEmptyMathML, cleanMathCatBraille };
export const { mathmlToBrf, latexToBrf, mathToBrf } = engine;
