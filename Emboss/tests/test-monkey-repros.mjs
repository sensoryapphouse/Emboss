// A89: every problem random-action testing has found and Emboss has fixed is kept here as its replay file
// (tests/fixtures/monkey-repro/<date>-<seed>-<engine>-s<session>-<problem>/repro.json, with the documents it loads), and replayed
// in the engine it was found in: none may come back. Each replay is the exact list of keys, clicks and menu choices that showed
// the problem (scripts/monkey-test.mjs --replay), so this checks the very case, not an approximation of it. Add a folder for each
// new problem fixed (copy repro.json and docs/ from the run's failure folder).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-monkey-repros.mjs [port]   (EMBOSS_ENGINE=… for one engine)
// run-all-tests.mjs lists this as "browser (not run)" (it imports './lib/launch-browser.mjs').
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENGINE, ENGINE_SET } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'fixtures', 'monkey-repro');
const MONKEY = path.join(HERE, '..', 'scripts', 'monkey-test.mjs');
let pass = 0;
const failures = [];
for (const name of readdirSync(DIR).sort()) {
  const repro = path.join(DIR, name, 'repro.json');
  if (!existsSync(repro)) continue;
  const engine = JSON.parse(readFileSync(repro, 'utf8')).engine || 'chrome';
  if (ENGINE_SET && engine !== ENGINE) continue;
  const r = spawnSync(process.execPath, [MONKEY, '--port', String(PORT), '--engines', engine, '--replay', repro, '--repeat', '1'], { encoding: 'utf8', timeout: 600000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const m = /REPRODUCED (\d+)\/(\d+)/.exec(out);
  const clean = m && m[1] === '0';
  const why = clean ? '' : (out.match(/run 1\/1: .*/) || [m ? m[0] : `no result (exit ${r.status})`])[0].slice(0, 300);
  if (clean) { pass++; console.log(`  ✓ ok    ${name}`); } else { failures.push({ name, why }); console.error(`  ✖ FAIL  ${name}: ${why}`); }
}
console.log(`\n=== Random-action problems stay fixed [${ENGINE_SET ? ENGINE : 'each in its own engine'}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
