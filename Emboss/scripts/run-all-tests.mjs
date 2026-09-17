#!/usr/bin/env node
// Runs every headless Emboss test file and prints one pass/fail table.
//
//   node Emboss/scripts/run-all-tests.mjs [--jobs N] [--timeout MS] [--filter SUBSTR] [--list] [--logs DIR]
//
// What is run (all paths relative to Emboss/, which is also the cwd for every child):
//   tests/*.test.mjs, tests/test-printpage.mjs, tests/test_nimas_production.mjs
//   format/test-*.mjs
//   input/*.test.mjs
//   scripts/test-nimas-suite.mjs, scripts/test-all-file-formats.mjs, scripts/detailed-verification-suite.mjs
//
// Runner choice is decided per file by reading its source: a file that imports
// 'node:test' is run with `node --test <file>`; anything else is run with plain
// `node <file>` and judged by its exit code.
//
// Browser (Playwright) suites — files that import 'playwright' or reference
// localhost:8137 — are listed as "browser (not run)" and never executed here;
// run them individually (they need a served build).
//
// Every file gets a 120 s timeout (override with --timeout). The process exits
// 1 if any file fails or times out. Full stdout/stderr of every file is written
// to the log directory (default: <os tmpdir>/emboss-test-logs-<timestamp>).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf(name);
  if (i === -1) return dflt;
  return argv[i + 1];
}
const JOBS = Math.max(1, parseInt(flag('--jobs', String(Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))))), 10) || 1);
const TIMEOUT_MS = parseInt(flag('--timeout', '120000'), 10) || 120000;
const FILTER = flag('--filter', null);
const LIST_ONLY = argv.includes('--list');
const LOG_DIR = flag('--logs', path.join(os.tmpdir(), `emboss-test-logs-${new Date().toISOString().replace(/[:.]/g, '-')}`));

// ---------------------------------------------------------------------------
// Enumerate candidate files
// ---------------------------------------------------------------------------
function listDir(rel, pred) {
  const dir = path.join(EMBOSS, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(pred).sort().map((f) => path.join(rel, f));
}

const HEADLESS_SET = [
  ...listDir('tests', (f) => f.endsWith('.test.mjs')),
  'tests/test-printpage.mjs',
  'tests/test_nimas_production.mjs',
  ...listDir('format', (f) => /^test-.*\.mjs$/.test(f)),
  ...listDir('input', (f) => f.endsWith('.test.mjs')),
  'scripts/test-nimas-suite.mjs',
  'scripts/test-all-file-formats.mjs',
  'scripts/detailed-verification-suite.mjs',
];

// Files we deliberately do not run here but want to account for so nothing is
// silently forgotten: the Playwright suites under tests/test-*.mjs and
// scripts/test-*.mjs, and the slow broad-corpus gate.
const OTHER_CANDIDATES = [
  ...listDir('tests', (f) => /^test-.*\.mjs$/.test(f) && f !== 'test-printpage.mjs'),
  ...listDir('scripts', (f) => /^test-.*\.mjs$/.test(f)),
].filter((f) => !HEADLESS_SET.includes(f));

const SLOW_SEPARATE = new Set([
  // WASM liblouis over 10 full EPUBs; several minutes. Run on its own:
  //   node scripts/test-emboss-g2-broad-corpus.mjs
  'scripts/test-emboss-g2-broad-corpus.mjs',
]);

function classify(rel) {
  const abs = path.join(EMBOSS, rel);
  if (!fs.existsSync(abs)) return { kind: 'missing' };
  const src = fs.readFileSync(abs, 'utf8');
  const isBrowser = /from\s+['"]playwright['"]|require\(['"]playwright['"]\)|localhost:8137|from\s+['"]puppeteer['"]/.test(src);
  if (isBrowser) return { kind: 'browser' };
  if (SLOW_SEPARATE.has(rel)) return { kind: 'slow' };
  const usesNodeTest = /from\s+['"]node:test['"]|require\(['"]node:test['"]\)/.test(src);
  return { kind: 'headless', runner: usesNodeTest ? 'node --test' : 'node' };
}

const entries = [];
for (const rel of [...new Set([...HEADLESS_SET, ...OTHER_CANDIDATES])]) {
  if (FILTER && !rel.includes(FILTER)) continue;
  entries.push({ file: rel, ...classify(rel) });
}

const toRun = entries.filter((e) => e.kind === 'headless');
const notRun = entries.filter((e) => e.kind !== 'headless');

if (LIST_ONLY) {
  for (const e of entries) console.log(`${e.kind.padEnd(9)} ${e.runner ? e.runner.padEnd(11) : ''.padEnd(11)} ${e.file}`);
  console.log(`\n${toRun.length} headless file(s) would run; ${notRun.length} listed but not run.`);
  process.exit(0);
}

fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Run one file
// ---------------------------------------------------------------------------
function runOne(entry) {
  return new Promise((resolve) => {
    const args = entry.runner === 'node --test' ? ['--test', entry.file] : [entry.file];
    const logPath = path.join(LOG_DIR, entry.file.replace(/[\/\\]/g, '__') + '.log');
    const chunks = [];
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: EMBOSS, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      fs.writeFileSync(logPath, output);
      const ms = Date.now() - started;
      let status;
      if (timedOut) status = 'TIMEOUT';
      else if (code === 0) status = 'PASS';
      else status = 'FAIL';
      // Pull a short reason for the table: the last non-empty line, or a node:test summary.
      const lines = output.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
      let note = '';
      if (status === 'PASS') {
        const m = output.match(/^# pass (\d+)\s*$/m);
        note = m ? `${m[1]} node:test cases` : '';
      } else if (status === 'TIMEOUT') {
        note = `killed after ${Math.round(TIMEOUT_MS / 1000)} s`;
      } else {
        const failLine = [...lines].reverse().find((l) => /fail|error|✗|assert/i.test(l));
        note = (failLine || lines[lines.length - 1] || `exit ${code ?? signal}`).slice(0, 90);
      }
      resolve({ ...entry, status, code: timedOut ? null : code, ms, note, logPath, output });
    });
  });
}

async function runAll() {
  const results = new Array(toRun.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(JOBS, toRun.length) }, async () => {
    while (next < toRun.length) {
      const i = next++;
      const r = await runOne(toRun[i]);
      results[i] = r;
      const mark = r.status === 'PASS' ? 'ok  ' : r.status === 'TIMEOUT' ? 'T/O ' : 'FAIL';
      console.log(`[${String(i + 1).padStart(3)}/${toRun.length}] ${mark} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.file}${r.status !== 'PASS' ? `  -- ${r.note}` : ''}`);
    }
  });
  await Promise.all(workers);
  return results;
}

console.log(`Emboss test runner: ${toRun.length} headless file(s), ${notRun.length} listed-not-run, jobs=${JOBS}, timeout=${TIMEOUT_MS} ms`);
console.log(`Logs: ${LOG_DIR}\n`);

const started = Date.now();
const results = await runAll();
const totalMs = Date.now() - started;

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.status === 'PASS');
const failed = results.filter((r) => r.status !== 'PASS');

console.log('\n' + '='.repeat(100));
console.log('EMBOSS TEST RESULTS');
console.log('='.repeat(100));
const w = Math.max(...results.map((r) => r.file.length), ...notRun.map((e) => e.file.length), 4);
console.log(`${'file'.padEnd(w)}  ${'runner'.padEnd(11)}  ${'status'.padEnd(7)}  ${'time'.padStart(7)}  note`);
console.log('-'.repeat(100));
for (const r of results) {
  console.log(`${r.file.padEnd(w)}  ${r.runner.padEnd(11)}  ${r.status.padEnd(7)}  ${((r.ms / 1000).toFixed(1) + 's').padStart(7)}  ${r.note}`);
}
for (const e of notRun) {
  const label = e.kind === 'browser' ? 'browser (not run)' : e.kind === 'slow' ? 'slow (run separately)' : e.kind === 'missing' ? 'MISSING' : e.kind;
  console.log(`${e.file.padEnd(w)}  ${'-'.padEnd(11)}  ${label}`);
}
console.log('-'.repeat(100));
console.log(`headless: ${passed.length} passed, ${failed.length} failed/timed out, of ${results.length}  (${(totalMs / 1000).toFixed(0)} s wall, jobs=${JOBS})`);
console.log(`not run:  ${notRun.filter((e) => e.kind === 'browser').length} browser suite(s), ${notRun.filter((e) => e.kind === 'slow').length} slow gate(s)`);

if (failed.length) {
  console.log('\n' + '='.repeat(100));
  console.log('FAILURE DETAIL (last 25 lines of each failing file; full log path shown)');
  console.log('='.repeat(100));
  for (const r of failed) {
    console.log(`\n--- ${r.file} [${r.status}${r.code != null ? ` exit ${r.code}` : ''}] log: ${r.logPath}`);
    const tail = r.output.split(/\r?\n/).filter((l) => l.trim()).slice(-25);
    for (const l of tail) console.log(`    ${l.slice(0, 200)}`);
  }
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
