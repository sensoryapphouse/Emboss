#!/usr/bin/env node
// Runs every Emboss Playwright browser suite in Chrome, WebKit (Safari's engine) and Firefox, and prints one suite x engine table.
// A89 step 1 (Paul, 2 Oct 2026): 44 of 45 browser suites only ever ran in Chrome, and a Safari-only fault (the Down key stuck on
// lines with equations) reached a tester. Each suite launches its browser through tests/lib/launch-browser.mjs, which reads the
// EMBOSS_ENGINE variable this script sets for every run.
//
//   node Emboss/scripts/run-browser-suites.mjs [--port N] [--engines chrome,webkit,firefox] [--filter SUBSTR]
//                                              [--timeout MS] [--logs DIR] [--list]
//
//   --port N       use the dev server already running on port N (node Emboss/scripts/serve.mjs N). Without it, this script starts
//                  Emboss/scripts/serve.mjs on a free port itself and stops it at the end.
//   --engines      comma-separated, from chrome, webkit, firefox (default: all three)
//   --filter       only suites whose path contains SUBSTR
//   --timeout MS   per suite and engine (default 600000). A suite that overruns is killed and reported as "timeout".
//   --logs DIR     where each run's full output goes, as <suite>.<engine>.log, plus summary.txt (default: a new folder under the
//                  OS temp dir; the path is printed)
//   --list         print the suites and exit
//
// The suite list is the "browser" entries of `run-all-tests.mjs --list` (files that import 'playwright' or name localhost:8137),
// so there is one definition of what a browser suite is. Suites run one at a time and the engines one after another, because the
// machine is shared and the suites reload pages and read the clock. scripts/test-e2e-suite.mjs, test-large-document-sync.mjs and
// test-real-nimas-doc.mjs ignore the port: they serve the built dist/ on ports of their own (8199, 8399, 8499), so build it first
// (node Emboss/scripts/build-dist.mjs) and do not run two copies at once. Exit code 1 if any run failed or timed out.
//
// A check that cannot run in one engine must say so: a line "skipped in <Engine>: <reason>" in the suite's output is counted and
// shown beside "pass" (see tests/lib/launch-browser.mjs for how the engines differ).

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');
const LABELS = { chrome: 'Chrome', webkit: 'WebKit', firefox: 'Firefox' };

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i === -1 ? dflt : argv[i + 1]; };
const ENGINES = String(flag('--engines', 'chrome,webkit,firefox')).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
for (const e of ENGINES) if (!LABELS[e]) { console.error(`Unknown engine "${e}" (use chrome, webkit, firefox)`); process.exit(2); }
const FILTER = flag('--filter', null);
const TIMEOUT_MS = parseInt(flag('--timeout', '600000'), 10) || 600000;
const LOG_DIR = flag('--logs', path.join(os.tmpdir(), `emboss-browser-suites-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const GIVEN_PORT = flag('--port', null);

// The one definition of "browser suite": whatever run-all-tests.mjs classifies as 'browser'.
const listing = execFileSync(process.execPath, [path.join(__dirname, 'run-all-tests.mjs'), '--list'], { cwd: EMBOSS, encoding: 'utf8' });
const SUITES = listing.split('\n').map((l) => /^browser\s+(\S+)/.exec(l)?.[1]).filter(Boolean).filter((f) => !FILTER || f.includes(FILTER));
if (!SUITES.length) { console.error('No browser suites matched.'); process.exit(2); }
if (argv.includes('--list')) { for (const s of SUITES) console.log(s); console.log(`\n${SUITES.length} browser suite(s) x ${ENGINES.length} engine(s)`); process.exit(0); }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
async function waitForServer(port) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://localhost:${port}/web/index.html`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the dev server did not answer on port ${port}`);
}

let server = null;
let PORT;
if (GIVEN_PORT) PORT = Number(GIVEN_PORT);
else {
  PORT = await freePort();
  server = spawn(process.execPath, [path.join(__dirname, 'serve.mjs'), String(PORT)], { cwd: EMBOSS, stdio: 'ignore' });
  await waitForServer(PORT);
}
const stopServer = () => { if (server && !server.killed) server.kill('SIGTERM'); };
process.on('SIGINT', () => { stopServer(); process.exit(130); });

fs.mkdirSync(LOG_DIR, { recursive: true });
console.log(`Dev server: port ${PORT}${server ? ' (started here)' : ' (already running)'}`);
console.log(`Logs: ${LOG_DIR}`);
console.log(`${SUITES.length} suite(s) x ${ENGINES.map((e) => LABELS[e]).join(', ')}\n`);

function runOne(suite, engine) {
  return new Promise((resolve) => {
    const log = path.join(LOG_DIR, `${suite.replace(/[\/\\]/g, '__')}.${engine}.log`);
    const chunks = [];
    const started = Date.now();
    const child = spawn(process.execPath, [suite, String(PORT)], { cwd: EMBOSS, env: { ...process.env, EMBOSS_ENGINE: engine, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString('utf8');
      fs.writeFileSync(log, out);
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      const last = [...lines].reverse().find((l) => /\d+ (?:checks )?passed|\d+ failed|FULLY VALIDATED|TESTS? (?:COMPLETE|PASSED)|COMPLETE|PASSED/i.test(l)) || lines[lines.length - 1] || '';
      resolve({
        suite, engine, ms: Date.now() - started, log,
        status: timedOut ? 'timeout' : code === 0 ? 'pass' : 'FAIL',
        skipped: lines.filter((l) => /\bskipped in (Chrome|WebKit|Firefox)\b/.test(l)).length,
        last: last.replace(/^=+\s*|\s*=+$/g, '').slice(0, 110),
      });
    });
  });
}

const results = [];
for (const suite of SUITES) {
  for (const engine of ENGINES) {
    process.stdout.write(`  ${suite} [${LABELS[engine]}] ... `);
    const r = await runOne(suite, engine);
    results.push(r);
    console.log(`${r.status}${r.skipped ? ` (${r.skipped} skipped)` : ''}  ${(r.ms / 1000).toFixed(1)}s`);
  }
}
stopServer();

const cell = (r) => (r ? r.status + (r.skipped ? ` (${r.skipped} skipped)` : '') : '-');
const nameW = Math.max(5, ...SUITES.map((s) => s.length));
const colW = Math.max(...ENGINES.map((e) => LABELS[e].length), 'timeout (99 skipped)'.length);
const lines = [];
lines.push(`${'Suite'.padEnd(nameW)}  ${ENGINES.map((e) => LABELS[e].padEnd(colW)).join('  ')}`);
lines.push(`${'-'.repeat(nameW)}  ${ENGINES.map(() => '-'.repeat(colW)).join('  ')}`);
for (const suite of SUITES) {
  lines.push(`${suite.padEnd(nameW)}  ${ENGINES.map((e) => cell(results.find((r) => r.suite === suite && r.engine === e)).padEnd(colW)).join('  ')}`);
}
lines.push('', 'Last summary line of each run:');
for (const r of results) lines.push(`  ${r.status.padEnd(7)} ${r.suite} [${LABELS[r.engine]}]  ${r.last}`);
const bad = results.filter((r) => r.status !== 'pass');
lines.push('', ...ENGINES.map((e) => `${LABELS[e]}: ${results.filter((r) => r.engine === e && r.status === 'pass').length} of ${results.filter((r) => r.engine === e).length} suites pass`));
if (bad.length) { lines.push('', 'Not passing (full output in the log):'); for (const r of bad) lines.push(`  ${r.status} ${r.suite} [${LABELS[r.engine]}]  ${r.log}`); }
const text = lines.join('\n');
fs.writeFileSync(path.join(LOG_DIR, 'summary.txt'), text + '\n');
console.log('\n' + text);
console.log(`\nLogs and summary.txt: ${LOG_DIR}`);
process.exit(bad.length ? 1 : 0);
