#!/usr/bin/env node
// The Emboss release check (S5a; audit 15 Oct 2026, "Release gates need enforceable revision-specific evidence").
//
//   node Emboss/scripts/release-check.mjs [commit|HEAD] [--beta|--plus] [--fresh] [--keep] [--only a,b] [--wait-limit SEC]
//
// Runs every check AGENTS.md requires before a deploy, on a CLEAN copy of one exact commit, and writes an evidence manifest that
// deploy.mjs insists on (a deploy of a commit is refused unless a passing manifest for exactly that commit, no older than 24 hours,
// exists; --skip-release-check overrides, loudly). Nothing here deploys, tags, pushes, or touches gold status or corpus baselines.
//
//   commit            Commit-ish to check (default HEAD). The copy is a detached `git worktree` in the OS temp directory,
//                     linked to the ignored build inputs by the same helper deploy.mjs uses (lib/worktree-inputs.mjs).
//   --beta            Build the beta build (EMBOSS_BETA=1) — use it when the deploy will be `--beta`; the manifest records which.
//   --plus            Build Emboss Plus (EMBOSS_PLUS=1) — for a `deploy --plus`. Plus needs only run-all-tests, build-dist and
//                     offline-dist (Paul, 17 Oct 2026); layout-parity and extreme-documents are for the beta and the public site.
//   --fresh           Run every check again, reusing nothing (see REUSE below).
//   --keep            Keep the clean copy and the logs (default: removed when everything passes; the logs are kept when anything fails).
//   --only a,b        Run just those checks (names below). The manifest is then PARTIAL and can never satisfy a deploy. For
//                     developing this command; offline-dist needs build-dist.
//   --wait-limit SEC  How long a heavy step waits for the machine load to fall (default 0 = never wait: go now, with fewer jobs
//                     when busy, and rerun alone anything that only ran out of time — Paul, 16 Oct 2026, "start it now").
//
// The checks, in this order (names are the manifest's keys):
//   run-all-tests      node Emboss/scripts/run-all-tests.mjs --jobs 3 --timeout 400000 (jobs 2 if the machine is still busy)
//   layout-parity      node Emboss/scripts/check-layout-parity.mjs
//   extreme-documents  node Emboss/scripts/check-extreme-documents.mjs   (expected: all units pass but the ones in
//                      ALLOWED_EXTREME_FAILURES — lib/release-check-core.mjs — the known Node-only nest-5000-html-table)
//   build-dist         node Emboss/scripts/build-dist.mjs (which runs check-dist), on a copy git says is clean; the build must
//                      be identified by the commit alone (not "-dirty")
//   offline-dist       serves that dist/ on a free port and runs Emboss/tests/test-offline-dist.mjs (Chrome)
// They run one after another, never at the same time: the machine is shared with other sessions, and parallel heavy work made
// time limits fail that pass alone.
//
// LOAD (Paul, 15 Oct 2026: other sessions put the load average at 20-70 on 10 cores, and big extreme documents and
// extreme_documents.test.mjs then timed out although they pass alone):
//   - before each heavy step (run-all-tests, layout-parity, extreme-documents, and before every rerun) the 1-minute load average
//     is read; above 2 x the CPU count the step WAITS (polling every 15 s, up to --wait-limit), and then goes ahead whatever the
//     load, with 2 jobs instead of 3 if the load is still above 1 x the CPU count (the extreme set is always 1 job);
//   - a test file or extreme unit that failed ONLY by timeout is run once more, alone, and only that second result counts;
//   - any real failure (assertion, crash, wrong output, out of memory) fails the check at once, with no second try;
//   - the allowed failure list is one named list (ALLOWED_EXTREME_FAILURES), with the reason beside each entry.
// Waits, loads, reruns and the reason for each are written into the manifest.
//
// REUSE (Paul, 17 Oct 2026, "make the release check cheaper"): run-all-tests, layout-parity and extreme-documents test the commit's
// source, not the kind of build, so one that passed for this commit in the last 12 hours — in a beta, Plus or public run — is
// copied into this run's manifest (marked "reused", with its own finish time) instead of being run again. build-dist and
// offline-dist always run, for the kind of build asked for. So a beta and a Plus deploy of one commit run the slow checks once.
//
// EVIDENCE: <common .git dir>/release-evidence/<full commit>[.beta|.plus].json (see lib/release-evidence.mjs for why there). Exit code 0 only
// when every check passed (a --only run that passed exits 0 too, but says it is partial).
import { execFileSync, spawn } from 'child_process';
import { promises as fs, createWriteStream, readFileSync } from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { linkBuildInputs } from './lib/worktree-inputs.mjs';
import {
  REQUIRED_CHECKS, SOURCE_CHECKS, requiredChecks, reusableChecks, ALLOWED_EXTREME_FAILURES, LOAD_WAIT_LIMIT_SEC, LOAD_POLL_SEC,
  loadLevel, jobsForLoad, parseRunAllTests, decideTestFile, parseParity, parseExtremeOutput, decideExtremeUnit,
  parseBuild, parseOffline, offlineTimedOutOnly,
} from './lib/release-check-core.mjs';
import { SCHEMA, evidenceDir, writeManifest, readAllManifests, distDigest } from './lib/release-evidence.mjs';
import { findEngineHome, killEngineProcesses } from './daisy-validate.mjs';

const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EMBOSS_DIR, '..');
const NODE = process.execPath;
const CPUS = os.cpus().length;

const say = (msg) => console.log(`release-check: ${msg}`);
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (n) => Math.round(n * 10) / 10;
const load1 = () => os.loadavg()[0];

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const a = { ref: 'HEAD', keep: false, beta: false, plus: false, fresh: false, only: null, waitLimit: LOAD_WAIT_LIMIT_SEC };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--keep') a.keep = true;
    else if (k === '--beta') a.beta = true;
    else if (k === '--plus') a.plus = true;   // Emboss Plus build (EMBOSS_PLUS=1) — for a `deploy --plus`
    else if (k === '--fresh') a.fresh = true;
    else if (k === '--only') a.only = (argv[++i] || '').split(',').filter(Boolean);
    else if (k === '--wait-limit') a.waitLimit = Number(argv[++i]);
    else if (k === '--help' || k === '-h') { console.log(fs_readHeader()); process.exit(0); }
    else if (!k.startsWith('--')) a.ref = k;
    else { console.error(`release-check: unknown flag ${k} (try --help)`); process.exit(2); }
  }
  if (a.beta && a.plus) { console.error('release-check: --beta and --plus cannot be combined'); process.exit(2); }
  if (!Number.isFinite(a.waitLimit) || a.waitLimit < 0) { console.error('release-check: --wait-limit needs a number of seconds'); process.exit(2); }
  if (a.only) {
    const bad = a.only.filter((n) => !REQUIRED_CHECKS.includes(n));
    if (bad.length || !a.only.length) { console.error(`release-check: --only names must be among ${REQUIRED_CHECKS.join(', ')} (got ${bad.join(', ') || 'nothing'})`); process.exit(2); }
    if (a.only.includes('offline-dist') && !a.only.includes('build-dist')) { console.error('release-check: offline-dist needs build-dist in --only'); process.exit(2); }
  }
  return a;
}
function fs_readHeader() {
  return readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l) => l.startsWith('//')).slice(0, 60).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}
const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------- processes we start (and only those)
// Each child leads its own process group, so stopping it also stops what it started (the extreme set's workers, a browser);
// nothing else is ever signalled.
const children = new Set();
function stopGroup(child, sig = 'SIGTERM') {
  try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* already gone */ } }
}
function stopAll() { for (const c of children) stopGroup(c, 'SIGKILL'); children.clear(); }

// Runs a command, logging everything to logFile, printing a heartbeat every minute. Resolves (never rejects).
function run(label, cmd, cmdArgs, { cwd, env = {}, logFile, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const log = createWriteStream(logFile);
    const chunks = [];
    let size = 0;
    const keep = (d) => { log.write(d); if (size < 40e6) { chunks.push(d); size += d.length; } };
    const child = spawn(cmd, cmdArgs, { cwd, env: { ...process.env, FORCE_COLOR: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const killer = setTimeout(() => { timedOut = true; stopGroup(child, 'SIGKILL'); }, timeoutMs);
    const beat = setInterval(() => say(`  [${label}] still running, ${Math.round((Date.now() - t0) / 60000)} min, load ${round1(load1())}`), 60000);
    child.on('error', (e) => keep(Buffer.from(`\nspawn error: ${e.message}\n`)));
    child.on('close', (code, signal) => {
      clearTimeout(killer); clearInterval(beat); children.delete(child);
      log.end();
      resolve({ code, signal, timedOut, output: Buffer.concat(chunks).toString('utf8'), sec: round1((Date.now() - t0) / 1000), logFile });
    });
  });
}

// ---------------------------------------------------------------- the DAISY validator's engine (S5A-Q2)
// Stops the engine's java process(es) (found by its install folder, as daisy-validate's own recovery does) and waits until it no longer answers;
// the rerun's daisy-validate then starts a fresh one. Returns { engineHome, killed: [pids] }.
async function restartDaisyEngine() {
  const engineHome = findEngineHome();
  const killed = engineHome ? await killEngineProcesses(engineHome) : [];
  const alive = () => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 8181, path: '/ws/alive', timeout: 2000 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  for (let i = 0; i < 30 && (await alive()); i++) await sleep(1000);
  // start the fresh engine now, with one small validation, so the rerun does not spend its own time limit starting it (a cold start with
  // nine books ran past books_roundtrip's limit: the very "no verdict" this recovers from)
  const warm = await run('daisy-warm-up', NODE, [path.join(EMBOSS_DIR, 'scripts', 'daisy-validate.mjs'), path.join(EMBOSS_DIR, 'tests', 'fixtures', 'feedback-17oct', 'small-nimas-test.xml')],
    { cwd: ROOT, logFile: path.join(logs, 'daisy-warm-up.log'), timeoutMs: 6 * 60000 });
  return { engineHome: engineHome || null, killed, warmUpSec: warm.sec, engineUp: await alive() };
}

// ---------------------------------------------------------------- load handling
const loadNotes = [];
async function waitForLoad(label) {
  const thr = 2 * CPUS;
  const first = load1();
  const note = { before: label, loadAtArrival: round1(first), waitedSec: 0, gaveUp: false };
  if (loadLevel(first, CPUS) !== 'high') { loadNotes.push(note); return loadLevel(first, CPUS); }
  say(`load average ${round1(first)} is above ${thr} (2 x ${CPUS} CPUs); waiting before "${label}" for it to fall (every ${LOAD_POLL_SEC} s, up to ${Math.round(args.waitLimit / 60)} min)…`);
  let waited = 0;
  while (loadLevel(load1(), CPUS) === 'high' && waited < args.waitLimit) {
    await sleep(LOAD_POLL_SEC * 1000);
    waited += LOAD_POLL_SEC;
    if (waited % 60 === 0) say(`  still waiting before "${label}": load ${round1(load1())}, ${waited / 60} min so far`);
  }
  note.waitedSec = waited;
  note.loadAfterWait = round1(load1());
  note.gaveUp = loadLevel(load1(), CPUS) === 'high';
  loadNotes.push(note);
  say(note.gaveUp
    ? `waited ${Math.round(waited / 60)} min and the load is still ${note.loadAfterWait}; going ahead with fewer jobs.`
    : `load fell to ${note.loadAfterWait} after ${waited} s; going ahead.`);
  return loadLevel(load1(), CPUS);
}

// ---------------------------------------------------------------- the clean copy
let tmp = null, worktree = null, logs = null, worktreeAdded = false;
async function makeCleanCopy(commit) {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), `emboss-release-check-${commit.slice(0, 8)}-`));
  worktree = path.join(tmp, 'wt');
  logs = path.join(tmp, 'logs');
  await fs.mkdir(logs, { recursive: true });
  git(['worktree', 'add', '-q', '--detach', worktree, commit]);
  worktreeAdded = true;
  await linkBuildInputs(ROOT, worktree, { testData: true });
}
async function removeCleanCopy({ keepLogs }) {
  if (worktreeAdded && !args.keep) {
    try { git(['worktree', 'remove', '--force', worktree]); worktreeAdded = false; }
    catch (e) { console.error(`release-check: warning — could not remove the clean copy ${worktree}: ${e.message}`); }
  }
  if (tmp && !args.keep && !keepLogs && !worktreeAdded) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

// ---------------------------------------------------------------- the checks
const embossScript = (rel) => path.join(worktree, 'Emboss', rel);

async function checkRunAllTests() {
  const level = await waitForLoad('run-all-tests');
  const jobs = jobsForLoad(level);
  const logDir = path.join(logs, 'run-all-logs');
  const r = await run('run-all-tests', NODE, [embossScript('scripts/run-all-tests.mjs'), '--jobs', String(jobs), '--timeout', '400000', '--logs', logDir],
    { cwd: worktree, logFile: path.join(logs, 'run-all-tests.log'), timeoutMs: 90 * 60000 });
  const p = parseRunAllTests(r.output);
  const out = { result: 'fail', durationSec: r.sec, jobs, loadLevel: level, exitCode: r.code, counts: { total: p.total, passedFirstTime: p.passed, problemsFirstTime: p.failed }, reruns: [], failures: [] };
  if (r.timedOut) { out.failures.push('run-all-tests did not finish within 90 minutes'); return out; }
  if (!p.summaryFound || p.total === 0) { out.failures.push('run-all-tests printed no summary (it crashed or found no tests)'); return out; }
  if (p.problems.length !== p.failed) out.failures.push(`the summary says ${p.failed} failed but ${p.problems.length} are listed`);
  if (r.code !== 0 && p.problems.length === 0) out.failures.push(`run-all-tests exited ${r.code} with no failing file listed`);
  const toRerun = [];
  for (const f of p.problems) {
    let logText = '';
    try { logText = await fs.readFile(path.join(logDir, f.file.replace(/[\/\\]/g, '__') + '.log'), 'utf8'); } catch { /* no log */ }
    const d = decideTestFile({ status: f.status, logText });
    if (d.action === 'fail') out.failures.push(`${f.file}: ${d.why}`);
    else toRerun.push({ file: f.file, firstStatus: f.status, why: d.why, daisy: d.action === 'rerun-daisy' });
  }
  if (out.failures.length) { out.result = 'fail'; return out; }     // a real failure fails at once: no reruns
  for (const t of toRerun) {
    let restarted = null;
    if (t.daisy) {   // S5A-Q2 (Paul, 17 Oct): the validator gave no verdict - restart its engine first (daisy-validate starts a fresh one)
      say(`${t.file}: ${t.why}.`);
      restarted = await restartDaisyEngine();
      say(restarted.killed.length ? `  stopped the DAISY engine (${restarted.killed.join(', ')}); the rerun starts a fresh one.` : '  no DAISY engine process was found to stop; the rerun starts one if needed.');
    } else say(`${t.file} timed out under load (${t.why}); running it once more, alone.`);
    const lvl = await waitForLoad(`rerun of ${t.file}`);
    const rr = await run('rerun', NODE, [embossScript('scripts/run-all-tests.mjs'), '--filter', t.file, '--jobs', '1', '--timeout', '400000', '--logs', path.join(logs, 'rerun-logs')],
      { cwd: worktree, logFile: path.join(logs, `rerun-${t.file.replace(/[\/\\]/g, '__')}.log`), timeoutMs: 15 * 60000 });
    const rp = parseRunAllTests(rr.output);
    const mine = rp.files.find((x) => x.file === t.file);
    const ok = !!mine && mine.status === 'pass';
    out.reruns.push({ file: t.file, firstStatus: t.firstStatus, why: t.why, loadLevelAtRerun: lvl, rerunResult: ok ? 'pass' : (mine ? mine.status : 'not run'), rerunSec: mine ? mine.sec : null, ...(restarted ? { daisyEngineRestarted: restarted } : {}) });
    if (!ok && t.daisy) {
      let again = '';
      try { again = await fs.readFile(path.join(logs, 'rerun-logs', t.file.replace(/[\/\\]/g, '__') + '.log'), 'utf8'); } catch { /* no log */ }
      if (decideTestFile({ status: 'fail', logText: again }).action === 'rerun-daisy') { out.failures.push(`${t.file}: the DAISY validator still gave no verdict after its engine was restarted - the validator, not Emboss, is at fault (see EMBOSS-TASKS A50), so this release is not checked against it; restart the engine by hand and run the check again`); continue; }
    }
    if (!ok) out.failures.push(`${t.file}: failed again when run alone (${mine ? mine.status + (mine.note ? ': ' + mine.note : '') : 'the rerun did not run it'})`);
  }
  out.result = out.failures.length ? 'fail' : 'pass';
  out.counts.passedFinally = p.total - out.failures.length;
  return out;
}

async function checkLayoutParity() {
  const level = await waitForLoad('layout-parity');
  const jobs = jobsForLoad(level);
  const r = await run('layout-parity', NODE, [embossScript('scripts/check-layout-parity.mjs'), '--jobs', String(jobs)],
    { cwd: worktree, logFile: path.join(logs, 'layout-parity.log'), timeoutMs: 60 * 60000 });
  const p = parseParity(r.output, r.code);
  const out = { result: p.pass ? 'pass' : 'fail', durationSec: r.sec, jobs, loadLevel: level, exitCode: r.code, counts: { documents: p.documents, blocks: p.blocks, blockChecks: p.blockChecks, pageChecks: p.pageChecks, differences: p.differences }, failures: [] };
  if (!p.pass) out.failures.push(r.timedOut ? 'check-layout-parity did not finish within 60 minutes' : !p.summaryFound ? 'check-layout-parity printed no summary (it crashed or found no documents)' : p.differences ? `${p.differences} parity difference(s)` : `check-layout-parity failed (exit ${r.code})`);
  return out;
}

async function checkExtremeDocuments() {
  const level = await waitForLoad('extreme-documents');
  const outDir = path.join(logs, 'extreme-out');
  const r = await run('extreme-documents', NODE, [embossScript('scripts/check-extreme-documents.mjs'), '--jobs', '1', '--out', outDir],
    { cwd: worktree, logFile: path.join(logs, 'extreme-documents.log'), timeoutMs: 120 * 60000 });
  const p = parseExtremeOutput(r.output);
  const out = { result: 'fail', durationSec: r.sec, loadLevel: level, exitCode: r.code, counts: { total: p.total, passedFirstTime: p.passed, failedFirstTime: p.failed }, allowedFailures: [], reruns: [], failures: [] };
  if (r.timedOut) { out.failures.push('check-extreme-documents did not finish within 2 hours'); return out; }
  if (!p.summaryFound || p.total === 0) { out.failures.push('check-extreme-documents printed no summary (it crashed or found no units)'); return out; }
  if (p.failedUnits.length !== p.failed) out.failures.push(`the summary says ${p.failed} units failed but ${p.failedUnits.length} are listed`);
  // each failed unit's reasons, from the per-unit log the tool writes under --out
  const reasonsById = new Map();
  try {
    for (const f of await fs.readdir(path.join(outDir, 'logs'))) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(await fs.readFile(path.join(outDir, 'logs', f), 'utf8'));
      reasonsById.set(j.id, (j.failures || []).map((x) => x.reason));
    }
  } catch { /* no logs: every failed unit then fails for want of a reason */ }
  const toRerun = [];
  for (const id of p.failedUnits) {
    const d = decideExtremeUnit(id, reasonsById.get(id));
    if (d.action === 'allowed') out.allowedFailures.push({ id, reason: d.why });
    else if (d.action === 'fail') out.failures.push(`${id}: ${d.why}`);
    else toRerun.push({ id, why: d.why });
  }
  if (out.failures.length) return out;                               // a real failure fails at once: no reruns
  for (const t of toRerun) {
    say(`extreme unit ${t.id} timed out under load (${t.why}); running it once more, alone.`);
    const lvl = await waitForLoad(`rerun of ${t.id}`);
    const dir = path.join(logs, `extreme-rerun-${t.id.replace(/[^A-Za-z0-9._-]+/g, '_')}`);
    const rr = await run('rerun', NODE, [embossScript('scripts/check-extreme-documents.mjs'), '--filter', t.id, '--jobs', '1', '--out', dir],
      { cwd: worktree, logFile: path.join(logs, `${path.basename(dir)}.log`), timeoutMs: 30 * 60000 });
    const rp = parseExtremeOutput(rr.output);
    const mine = /^\[\s*\d+\/\d+\]\s+(\S+)\s+(pass|FAIL)/m;
    let result = 'not run';
    for (const line of rr.output.split('\n')) { const m = mine.exec(line); if (m && m[1] === t.id) result = m[2] === 'pass' ? 'pass' : 'fail'; }
    out.reruns.push({ id: t.id, why: t.why, loadLevelAtRerun: lvl, rerunResult: result, rerunSec: rp.wallSec });
    if (result !== 'pass') out.failures.push(`${t.id}: failed again when run alone (${result})`);
  }
  out.result = out.failures.length ? 'fail' : 'pass';
  out.counts.passedFinally = p.total - out.allowedFailures.length - out.failures.length;
  return out;
}

let builtInfo = null;
async function checkBuildDist(commit) {
  const out = { result: 'fail', durationSec: 0, failures: [] };
  // The checks above must not have left anything in the clean copy, or the build would call itself "-dirty".
  const dirty = git(['status', '--porcelain'], worktree);
  if (dirty) { out.failures.push(`the clean copy is not clean after the earlier checks (they left: ${dirty.split('\n').slice(0, 5).join('; ')})`); return out; }
  const r = await run('build-dist', NODE, [embossScript('scripts/build-dist.mjs')],
    { cwd: worktree, env: { EMBOSS_BETA: args.beta ? '1' : '', EMBOSS_PLUS: args.plus ? '1' : '' }, logFile: path.join(logs, 'build-dist.log'), timeoutMs: 15 * 60000 });
  out.durationSec = r.sec; out.exitCode = r.code;
  const b = parseBuild(r.output);
  if (r.code !== 0 || !b.summaryFound) { out.failures.push(r.timedOut ? 'build-dist did not finish within 15 minutes' : `build-dist failed (exit ${r.code})`); return out; }
  if (!b.checkDistOk) out.failures.push('check-dist did not report "ok"');
  const short = commit.slice(0, 8);
  if (b.buildId !== short) out.failures.push(`the build calls itself "${b.buildId}", not the commit ${short} (a dirty or wrong checkout?)`);
  if (b.plus !== args.plus) out.failures.push(`the build is ${b.plus ? '' : 'not '}Emboss Plus but ${args.plus ? '--plus' : 'no --plus'} was asked for`);
  if (b.beta !== args.beta) out.failures.push(`the build is ${b.beta ? 'a beta' : 'not a beta'} but ${args.beta ? '--beta' : 'no --beta'} was asked for`);
  const dist = path.join(worktree, 'dist');
  builtInfo = { buildId: b.buildId, cacheId: b.cacheId, date: b.date, beta: b.beta, plus: b.plus, precachedAssets: b.precachedAssets, distDigest: await distDigest(dist) };
  out.build = builtInfo;
  out.result = out.failures.length ? 'fail' : 'pass';
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
function httpOk(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/build-info.json', timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function checkOfflineDist() {
  const out = { result: 'fail', durationSec: 0, failures: [], engine: 'chrome' };
  const dist = path.join(worktree, 'dist');
  const port = await freePort();
  const serverLog = createWriteStream(path.join(logs, 'serve.log'));
  const server = spawn(NODE, ['serve.mjs', String(port)], { cwd: dist, env: { ...process.env, NO_OPEN: '1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.add(server);
  server.stdout.pipe(serverLog, { end: false }); server.stderr.pipe(serverLog, { end: false });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { up = await httpOk(port); if (!up) await sleep(500); }
    if (!up) { out.failures.push(`the built dist/ did not start serving on port ${port}`); return out; }
    out.port = port;
    let attempt = 0, parsed = null, r = null;
    for (;;) {
      attempt++;
      r = await run('offline-dist', NODE, [embossScript('tests/test-offline-dist.mjs'), String(port)],
        { cwd: worktree, env: { EMBOSS_ENGINE: 'chrome' }, logFile: path.join(logs, attempt === 1 ? 'offline-dist.log' : `offline-dist-rerun.log`), timeoutMs: 15 * 60000 });
      out.durationSec = round1(out.durationSec + r.sec);
      parsed = parseOffline(r.output, r.code);
      if (parsed.pass || attempt === 2 || !(r.timedOut || offlineTimedOutOnly(r.output))) break;
      say('the offline test ran out of time under load (no assertion failed); running it once more.');
      out.rerun = { why: r.timedOut ? 'killed at its time limit' : 'a browser step timed out and no assertion failed' };
      await waitForLoad('rerun of offline-dist');
    }
    out.exitCode = r.code;
    out.counts = { passed: parsed.passed, failed: parsed.failed };
    out.result = parsed.pass ? 'pass' : 'fail';
    if (!parsed.pass) out.failures.push(r.timedOut ? 'the offline test did not finish within 15 minutes' : !parsed.summaryFound ? `the offline test printed no summary (exit ${r.code})` : `${parsed.failed} offline check(s) failed`);
    return out;
  } finally { stopGroup(server); children.delete(server); serverLog.end(); }
}

// ---------------------------------------------------------------- main
async function main() {
  let commit;
  try { commit = git(['rev-parse', '--verify', `${args.ref}^{commit}`]); }
  catch { console.error(`release-check: "${args.ref}" is not a commit in this repository`); process.exit(2); }
  const subject = git(['log', '-1', '--format=%s', commit]);
  const selected = args.only || requiredChecks({ plus: args.plus });
  const startedAt = new Date();
  const manifest = {
    schema: SCHEMA, tool: 'release-check', commit, commitShort: commit.slice(0, 8), subject,
    startedAt: startedAt.toISOString(), finishedAt: null, durationSec: 0,
    complete: !args.only, options: { beta: args.beta, plus: args.plus, only: args.only, fresh: args.fresh },
    node: { version: process.version, arch: process.arch, execPath: process.execPath },
    machine: { platform: process.platform, cpus: CPUS, loadAtStart: os.loadavg().map(round1), loadThresholdHigh: 2 * CPUS },
    loadHandling: loadNotes, checks: {}, build: null, overall: 'fail', failures: [],
  };
  say(`checking ${manifest.commitShort} ("${subject}") on node ${process.version} ${process.arch}; ${CPUS} CPUs, load ${manifest.machine.loadAtStart.join(' ')}; checks: ${selected.join(', ')}${args.beta ? '; BETA build' : args.plus ? '; PLUS build' : ''}`);
  let crashed = null;
  try {
    // REUSE: source checks that passed for this commit in the last 12 hours, in any kind of run (see the header).
    const reuse = args.fresh ? {} : reusableChecks(await readAllManifests(evidenceDir(ROOT), commit), { commit, now: Date.now(), needed: selected.filter((n) => SOURCE_CHECKS.includes(n)) });
    await waitForLoad('start');
    await makeCleanCopy(commit);
    say(`clean copy of ${manifest.commitShort} at ${worktree}`);
    const steps = {
      'run-all-tests': checkRunAllTests, 'layout-parity': checkLayoutParity, 'extreme-documents': checkExtremeDocuments,
      'build-dist': () => checkBuildDist(commit), 'offline-dist': checkOfflineDist,
    };
    let n = 0;
    for (const name of REQUIRED_CHECKS) {
      if (!selected.includes(name)) continue;
      n++;
      say(`[${n}/${selected.length}] ${name} …`);
      if (reuse[name]) { manifest.checks[name] = reuse[name]; say(`[${n}/${selected.length}] ${name}: PASS — reused from ${reuse[name].reused.from}, finished ${reuse[name].finishedAt} (--fresh runs it again)`); continue; }
      if ((name === 'offline-dist') && !builtInfo) { manifest.checks[name] = { result: 'fail', failures: ['no passing build to serve'] }; say(`[${n}/${selected.length}] ${name}: FAIL (no build)`); continue; }
      const res = await steps[name]();
      res.finishedAt = new Date().toISOString();
      manifest.checks[name] = res;
      const extra = [res.counts && res.counts.total ? `${res.counts.passedFinally ?? res.counts.passedFirstTime}/${res.counts.total}` : '', res.reruns && res.reruns.length ? `${res.reruns.length} rerun(s)` : '', res.allowedFailures && res.allowedFailures.length ? `${res.allowedFailures.length} allowed failure(s)` : ''].filter(Boolean).join(', ');
      say(`[${n}/${selected.length}] ${name}: ${res.result.toUpperCase()}${extra ? ` (${extra})` : ''} in ${Math.round(res.durationSec)} s`);
      for (const f of res.failures || []) say(`    - ${f}`);
      if (res.result !== 'pass') manifest.failures.push(...(res.failures || []).map((f) => `${name}: ${f}`));
    }
    manifest.build = builtInfo;
  } catch (e) {
    crashed = e;
    manifest.failures.push(`release-check itself failed: ${(e && e.stack) || e}`);
  } finally {
    stopAll();
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000);
  manifest.loadHandling = loadNotes;
  manifest.knownAllowedFailureList = ALLOWED_EXTREME_FAILURES;
  const ran = Object.values(manifest.checks);
  const allPass = !crashed && selected.every((n) => manifest.checks[n] && manifest.checks[n].result === 'pass');
  manifest.overall = allPass ? 'pass' : 'fail';
  const file = await writeManifest(evidenceDir(ROOT), manifest);
  await removeCleanCopy({ keepLogs: !allPass });
  say(`${manifest.overall.toUpperCase()}${manifest.complete ? '' : ' (PARTIAL: --only; this cannot satisfy a deploy)'} — ${ran.length} check(s) in ${Math.round(manifest.durationSec / 60)} min ${manifest.durationSec % 60} s`);
  say(`evidence: ${file}`);
  if (!allPass) say(`logs kept in ${logs}`);
  else if (args.keep) say(`clean copy and logs kept in ${tmp} (remove the copy with: git worktree remove --force "${worktree}")`);
  process.exitCode = allPass ? 0 : 1;
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  console.error(`\nrelease-check: ${sig} — stopping what it started and removing the clean copy.`);
  stopAll();
  try { if (worktreeAdded && !args.keep) git(['worktree', 'remove', '--force', worktree]); } catch { /* best effort */ }
  process.exit(130);
});
await main();
