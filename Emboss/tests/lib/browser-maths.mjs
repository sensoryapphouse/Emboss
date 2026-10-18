// The browser maths wrapper (engine/maths.mjs) run in Node: its source with only the MathCAT bootstrap import swapped for the Node build
// of the same MathCAT, and its absolute/relative module imports made absolute file URLs (the wrapper is loaded from a temporary folder).
// First written for audit batch S2b (tests/s2b_rejected_maths.test.mjs); shared since audit batch S5b (tests/s5b_maths_parity.test.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.join(here, '..', '..');

export async function loadBrowserWrapper() {
  const src = fs.readFileSync(path.join(EMBOSS, 'engine', 'maths.mjs'), 'utf8');
  const pkg = path.join(EMBOSS, 'engine', 'mathcat', 'pkg-nodejs', 'emboss_mathcat.js');
  const url = (...p) => pathToFileURL(path.join(EMBOSS, ...p)).href;
  const adapted = src
    .replace(/import init, \{ mathml_to_braille \} from '[^']+';/, `import { createRequire as __cr } from 'node:module'; const __m = __cr(${JSON.stringify(pathToFileURL(pkg).href)})(${JSON.stringify(pkg)}); const mathml_to_braille = __m.mathml_to_braille; const init = async () => {};`)
    .replace(/from '\/engine\/brf-ascii\.mjs'/, `from '${url('engine', 'brf-ascii.mjs')}'`)
    .replace(/from '\.\.\/input\/omml\.mjs'/, `from '${url('input', 'omml.mjs')}'`)
    .replace(/from '\.\/maths-core\.mjs'/, `from '${url('engine', 'maths-core.mjs')}'`);   // present since S5b
  assert.notEqual(adapted, src, 'the bootstrap imports were found');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-browser-maths-'));
  const file = path.join(dir, 'maths-node.mjs');
  fs.writeFileSync(file, adapted);
  try {
    const mod = await import(pathToFileURL(file).href);
    await mod.initMaths();
    return mod;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
