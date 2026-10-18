// Node maths wrapper for the test harness (format/test-corpus.mjs, scripts/check-layout-parity.mjs, the maths tests).
// NOT part of the shipped browser pipeline: that is engine/maths.mjs, which imports the *web* MathCAT build via an absolute browser path.
// Since audit batch S5b the two share every pure step (engine/maths-core.mjs: preparation of the MathML, the Nemeth code-switch wrap,
// empty-input detection, the rejected-equation contract, matrix row clean-up, LaTeX and segment entry points) and differ only here, in
// how MathCAT is loaded - the CommonJS pkg-nodejs build of the same MathCAT - and called. So the braille this produces is the product's.
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createMathsEngine } from '../engine/maths-core.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mathcat = require(path.join(__dirname, '..', 'engine', 'mathcat', 'pkg-nodejs', 'emboss_mathcat.js'));

let temmlLib;   // Temml for a LaTeX-only segment, as the browser's globalThis.temml; looked up once, null if not installed
function nodeTemml() {
  if (temmlLib === undefined) { try { temmlLib = require('temml'); } catch { temmlLib = null; } }
  return temmlLib;
}

const engine = createMathsEngine({
  callMathCat: (mathml, code) => mathcat.mathml_to_braille(mathml, code),
  isReady: () => true,                       // the Node build is loaded synchronously above
  getTemml: nodeTemml,
});

// Returns a mathToBrf(seg) function bound to the given mode ('ukaaf'|'bana'; BANA -> Nemeth, anything else UEB). The formatter passes the
// equation's segment ({ mathml } and/or { latex }); the probes in the parity check pass the MathML string itself.
export function makeMathToBrf(mode) {
  return function mathToBrf(arg) {
    return engine.mathToBrf(typeof arg === 'string' ? { mathml: arg } : arg, mode);
  };
}
