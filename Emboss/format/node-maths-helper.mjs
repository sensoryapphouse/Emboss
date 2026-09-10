// Node-only maths helper for the test harness (format/test-corpus.mjs).
// NOT part of the shipped browser pipeline (that's engine/maths.mjs, which
// imports the *web* MathCAT build via an absolute browser path and is out of
// scope to modify). This just wires the CommonJS pkg-nodejs MathCAT build +
// the shared engine/brf-ascii.mjs mapping so the harness can exercise `math`
// blocks in Node without a browser.
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mathcat = require(path.join(__dirname, '..', 'engine', 'mathcat', 'pkg-nodejs', 'emboss_mathcat.js'));

// Returns a mathToBrf(mathml) function bound to the given mode ('ukaaf'|'bana').
export function makeMathToBrf(mode) {
  const code = mode === 'bana' ? 'Nemeth' : 'UEB';
  return function mathToBrf(mathml) {
    let braille;
    try {
      braille = mathcat.mathml_to_braille(mathml, code);
      if (typeof braille !== 'string' || braille.startsWith('ERROR:')) {
        return unicodeBrailleToBrf('⠌⠼'); // Graceful fallback
      }
    } catch {
      return unicodeBrailleToBrf('⠌⠼');
    }
    return unicodeBrailleToBrf(braille);
  };
}
