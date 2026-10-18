#!/usr/bin/env node
// Validate DTBook / NIMAS files with the DAISY Pipeline 2 validators.
//
//   node Emboss/scripts/daisy-validate.mjs [options] <file.xml | package.opf> ...
//
// A .xml file runs `dtbook-validator` (RelaxNG + Schematron, NIMAS 1.1 rules on by
// default); a .opf file runs `nimas-fileset-validator` (the whole NIMAS package).
// Stricter than xmllint + DTD: it checks the NIMAS profile, not only element nesting.
//
// Options:
//   --no-nimas             DTBook rules only (no NIMAS 1.1 profile)
//   --mathml 2.0|3.0       MathML version to validate against (default 3.0)
//   --check-images         also check that referenced images exist on disk
//   --json                 print one JSON summary per file instead of text
//   --keep-jobs            leave finished jobs in the engine (default: delete them)
//   --timeout MS           per-job time limit (default 600000 = 10 min); also
//                          $DAISY_VALIDATE_JOB_TIMEOUT_MS
//   --jobs-health-url URL  URL polled to check the engine is healthy before submitting
//                          anything (default "$DAISY_PIPELINE_URL/jobs"); also
//                          $DAISY_VALIDATE_JOBS_URL. Mainly for testing the guard itself
//                          against a URL that is expected to fail.
//   --no-recover           do not attempt the automatic one-time engine recovery (kill +
//                          reset job database + restart) when the health check fails; fail
//                          immediately instead, as before this option existed
//
// The engine: the official DAISY Pipeline engine zip (github.com/daisy/pipeline-assembly),
// unpacked to a path without spaces. Found via $DAISY_PIPELINE_HOME, else the newest
// ~/.local/share/daisy-pipeline-*. If no engine answers on $DAISY_PIPELINE_URL
// (default http://localhost:8181/ws) it is started in local mode and left running.
//
// Before submitting anything, this script (added for A50, after the engine's job database
// corrupted under concurrent validations on 23 Sep — /ws/alive stayed "200 OK" but /ws/jobs
// came back HTTP 500, and every run then printed "ready" and silently produced nothing, exit 0):
//   - takes a lock (a pid file in the OS temp dir) so a second run on this machine does not
//     hit the engine at the same time; if the lock's holder process is gone, it is stolen; if
//     it is held by a live process, this run WAITS for it (polling), up to 5 minutes, rather
//     than failing immediately — concurrent runs queue instead of colliding
//   - starts the engine if it is not already up (GET /ws/alive, 10s timeout per attempt)
//   - confirms GET <jobs-health-url> (/ws/jobs, 10s timeout) actually returns a job list; if
//     not — a hang or an HTTP 500, the wedged-database symptom hit 24 Sep after a few dozen
//     validations — it makes ONE automatic recovery attempt (kill the engine's java process,
//     move data/db and data/jobs aside to a timestamped backup directory under data/ — never
//     deleted — recreate an empty data/jobs, restart the engine) and re-checks health once;
//     only if it is still unhealthy after that does it fail loudly with the likely cause and
//     the fix, instead of quietly submitting into a wedged engine. Pass --no-recover to disable
//     the automatic recovery attempt and fail on the first unhealthy check instead.
//   - runs at most N jobs at once (N read from the engine's own etc/pipeline.properties
//     org.daisy.pipeline.procs, default 2 — see AGENTS.md/EMBOSS-TASKS.md A50) and queues the rest
//   - gives each job up to --timeout to finish; a job that does not is killed and reported as
//     a clear failure for that file, never silently dropped
//   - a job that returns no report is likewise reported as a clear failure, never as "0 errors"
//
// Exit code: 0 all valid, 1 validation errors (also used for a per-file timeout or missing
// report — see above), 2 usage / engine / lock problems.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WS = (process.env.DAISY_PIPELINE_URL || 'http://localhost:8181/ws').replace(/\/$/, '');
const NS = 'http://www.daisy.org/ns/pipeline/data';

// Ten minutes: the engine's own default web-service request timeout
// (org.daisy.pipeline.ws.maxrequesttime in etc/pipeline.properties is 600000ms) and comfortably
// enough for a real book-length NIMAS document's RelaxNG + Schematron + MathML checks. This was
// also the script's previous *implicit* limit (600 one-second polls) — the default behaviour is
// unchanged, it is just explicit and overridable now.
export const DEFAULT_JOB_TIMEOUT_MS = 600_000;

export const LOCK_PATH = process.env.DAISY_VALIDATE_LOCK || path.join(os.tmpdir(), 'daisy-validate.lock');

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node Emboss/scripts/daisy-validate.mjs [--no-nimas] [--mathml 2.0|3.0] [--check-images] [--json] [--keep-jobs] [--timeout MS] [--jobs-health-url URL] [--no-recover] <file.xml|package.opf> ...');
  process.exit(2);
}

// opts is module-scope (not local to main()) because jobRequest()/runJob()/processFile() close
// over it; main() fills it in from argv before anything else runs. Tests never call main(), so
// they only ever see these defaults.
const opts = {
  nimas: true,
  mathml: '3.0',
  checkImages: false,
  json: false,
  keepJobs: false,
  timeoutMs: DEFAULT_JOB_TIMEOUT_MS,
  jobsHealthUrl: undefined,
  recover: true,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Health check timeout (item 4a): both /ws/alive and /ws/jobs are given 10s to answer, so a
// hung connection (the wedged-engine symptom) is discovered promptly instead of hanging this
// script forever on a plain, un-timed-out fetch.
export const HEALTH_CHECK_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(url, { timeoutMs = HEALTH_CHECK_TIMEOUT_MS, fetchImpl = fetch, init } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...(init || {}), signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function alive(timeoutMs = HEALTH_CHECK_TIMEOUT_MS) {
  try {
    const r = await fetchWithTimeout(`${WS}/alive`, { timeoutMs });
    return r.ok;
  } catch {
    return false;
  }
}

export function findEngineHome() {
  if (process.env.DAISY_PIPELINE_HOME) return process.env.DAISY_PIPELINE_HOME;
  const base = path.join(os.homedir(), '.local', 'share');
  const found = fs.existsSync(base)
    ? fs.readdirSync(base).filter((d) => /^daisy-pipeline-\d/.test(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  return found.length ? path.join(base, found[found.length - 1]) : null;
}

async function ensureEngine() {
  if (await alive()) return;
  const home = findEngineHome();
  if (!home || !fs.existsSync(path.join(home, 'bin', 'pipeline2'))) {
    console.error('DAISY Pipeline engine not running and not found. Set DAISY_PIPELINE_HOME or unpack');
    console.error('pipeline2-<version>_linux.zip (github.com/daisy/pipeline-assembly releases) to ~/.local/share/daisy-pipeline-<version>.');
    process.exit(2);
  }
  if (/\s/.test(home)) {
    console.error(`The engine launcher cannot run from a path containing spaces: ${home}`);
    process.exit(2);
  }
  const log = path.join(os.tmpdir(), 'daisy-pipeline-engine.log');
  const out = fs.openSync(log, 'a');
  const child = spawn(path.join(home, 'bin', 'pipeline2'), ['local'], { cwd: home, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  process.stderr.write(`Starting DAISY Pipeline engine (${path.basename(home)}; log ${log}) `);
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    if (await alive()) { process.stderr.write('ready\n'); return; }
    process.stderr.write('.');
  }
  console.error('\nThe engine did not start within 3 minutes; see the log above.');
  process.exit(2);
}

// --- A50 guard: engine health -----------------------------------------------------------
//
// A healthy engine answers GET /ws/jobs with HTTP 200 and a <jobs> (or namespaced
// d:jobs/pipeline:jobs — the DAISY schema uses no fixed prefix) root element, even with zero
// jobs queued. The corrupted-database failure mode seen 23 Sep answered /ws/alive fine but
// /ws/jobs with HTTP 500; evaluateJobsHealth() also treats "200 but not actually a job list"
// (e.g. an HTML error page from a reverse proxy) as unhealthy, since that is just as untrustworthy.
export function evaluateJobsHealth(status, bodyText) {
  if (status !== 200) return { healthy: false, reason: `GET /ws/jobs returned HTTP ${status}` };
  if (typeof bodyText !== 'string' || !/<(?:[\w.-]+:)?jobs\b/.test(bodyText)) {
    return { healthy: false, reason: 'GET /ws/jobs returned HTTP 200 but not a job list' };
  }
  return { healthy: true, reason: null };
}

export async function checkEngineJobsHealthy(jobsUrl, fetchImpl = fetch, { timeoutMs = HEALTH_CHECK_TIMEOUT_MS } = {}) {
  let res;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    res = await fetchImpl(jobsUrl, { signal: ac.signal });
  } catch (err) {
    return { healthy: false, reason: `GET ${jobsUrl} failed: ${err && err.message ? err.message : err}` };
  } finally {
    clearTimeout(t);
  }
  let text = '';
  try { text = await res.text(); } catch { /* fall through with empty body */ }
  return evaluateJobsHealth(res.status, text);
}

// --- A50 guard: "no report" detection ---------------------------------------------------
//
// A job can finish (or be judged) with an empty report for reasons that have nothing to do
// with the document being valid — most notably the wedged-engine failure mode. Treat that as
// its own kind of failure, distinct from "validated, and it has errors", so the printed line
// never reads like a false "0 error(s)" pass.
export function describeMissingReport(job) {
  if (!job) return 'no result was returned for this file';
  if (typeof job.report === 'string' && job.report.trim() !== '') return null;
  return `the engine returned no validation report (job status: ${job.status || 'UNKNOWN'})`;
}

// --- A50 guard: per-job timeout ----------------------------------------------------------
export function hasTimedOut(startedAtMs, nowMs, timeoutMs) {
  return (nowMs - startedAtMs) >= timeoutMs;
}

// Precedence: an explicit --timeout flag wins, then $DAISY_VALIDATE_JOB_TIMEOUT_MS, then the
// default. Anything that doesn't parse to a positive number is ignored rather than crashing the
// run over a typo'd env var.
export function resolveTimeoutMs({ flagValue, envValue, fallback = DEFAULT_JOB_TIMEOUT_MS } = {}) {
  for (const raw of [flagValue, envValue]) {
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

// --- A50 guard: don't overload the engine -------------------------------------------------
//
// The engine's own concurrency cap lives in etc/pipeline.properties as
// org.daisy.pipeline.procs=N (commented out means its documented default, 2 — see the file's
// own comment). Read it if we can; otherwise fall back to that same default of 2, which is
// also this script's own long-standing assumption (AGENTS.md / EMBOSS-TASKS.md A50).
export function parseEngineJobLimit(propertiesText, fallback = 2) {
  if (typeof propertiesText !== 'string') return fallback;
  const m = propertiesText.match(/^\s*org\.daisy\.pipeline\.procs\s*=\s*(\d+)\s*$/m);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readEngineJobLimit(engineHome, { fallback = 2, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  if (!engineHome) return fallback;
  try {
    return parseEngineJobLimit(readFile(path.join(engineHome, 'etc', 'pipeline.properties')), fallback);
  } catch {
    return fallback;
  }
}

// Runs `worker` over `items` with at most `limit` in flight at once, queueing the rest. Results
// are returned in input order regardless of completion order, so printed output stays in the
// order the files were given (unaffected by which job happens to finish first).
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  if (!items.length) return results;
  const n = Math.max(1, Math.min(limit | 0 || 1, items.length));
  let next = 0;
  async function runOne() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, runOne));
  return results;
}

// --- A50 guard: lock, so two runs do not collide ------------------------------------------
//
// Deliberately simple: a pid file. A second run either finds it held by a still-running
// process (and exits with a clear message rather than waiting indefinitely for an unattended
// script) or finds the holder gone (crashed, killed, machine rebooted) and steals it.
export function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but is owned by someone else — still alive, just not ours to see.
    return err && err.code === 'EPERM';
  }
}

export function acquireLock(lockPath, { pid = process.pid, isAlive = isPidAlive } = {}) {
  try {
    fs.writeFileSync(lockPath, String(pid), { flag: 'wx' });
    return { ok: true };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  let holderPid = null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    holderPid = raw ? Number(raw) : null;
  } catch { /* raced away between the two calls above — try again below */ }
  if (holderPid && isAlive(holderPid)) return { ok: false, holderPid };
  // Stale (holder gone, or the file was empty/unreadable) — steal it.
  try {
    fs.writeFileSync(lockPath, String(pid));
    return { ok: true, stoleFrom: holderPid || null };
  } catch (err) {
    return { ok: false, holderPid, error: String(err.message || err) };
  }
}

export function releaseLock(lockPath, { pid = process.pid } = {}) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    if (Number(raw) === pid) fs.unlinkSync(lockPath);
  } catch { /* already gone, or never ours */ }
}

// A run that finds the lock held by a still-live process now WAITS for it (polling
// acquireLock) instead of failing immediately, so two agents validating at the same time queue
// up rather than one of them just giving up. Capped at 5 minutes so a genuinely stuck holder
// still produces a clear, bounded failure rather than hanging this run forever.
export const LOCK_MAX_WAIT_MS = 5 * 60 * 1000;

export async function waitForLock(lockPath, { pid = process.pid, isAlive = isPidAlive, maxWaitMs = LOCK_MAX_WAIT_MS, pollMs = 2000, now = Date.now, wait = sleep, onWaiting } = {}) {
  const start = now();
  let announced = false;
  for (;;) {
    const res = acquireLock(lockPath, { pid, isAlive });
    if (res.ok) return res;
    if (!announced) { announced = true; if (onWaiting) onWaiting(res.holderPid); }
    if (now() - start >= maxWaitMs) return { ok: false, holderPid: res.holderPid, timedOut: true };
    await wait(pollMs);
  }
}

// --- item 4b: automatic one-time recovery from a wedged job database ---------------------
//
// Symptom (hit 23/24 Sep after a few dozen validations): GET /ws/jobs hangs or returns HTTP
// 500 while /ws/alive still answers fine. The known fix is: stop the engine, move its job
// database out of the way (never delete it — kept as a timestamped backup), recreate an empty
// jobs directory, restart. This automates exactly that, once per run, before giving up.

function timestampForBackup() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Finds pids of processes whose command line mentions the engine's install directory — the
// java process(es) started by <engineHome>/bin/pipeline2. Best-effort: if `pgrep` is
// unavailable or nothing matches, returns an empty list rather than throwing, so a recovery
// attempt on a platform without pgrep just falls through to "restart" (ensureEngine still
// starts a fresh engine; it just could not kill an old wedged one first).
export async function findEnginePids(engineHome, { exec = execFileSync } = {}) {
  if (!engineHome) return [];
  try {
    const out = exec('pgrep', ['-f', engineHome], { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n !== process.pid);
  } catch {
    return [];
  }
}

export async function killEngineProcesses(engineHome, { findPids = findEnginePids, kill = (pid) => process.kill(pid, 'SIGKILL') } = {}) {
  const pids = await findPids(engineHome);
  const killed = [];
  for (const pid of pids) {
    try { kill(pid); killed.push(pid); } catch { /* already gone */ }
  }
  return killed;
}

// Moves data/db and data/jobs aside into a single timestamped backup directory under data/
// (created, never overwritten — a fresh timestamp per call) and recreates an empty data/jobs
// so the restarted engine has somewhere to write. Uses rename (a move), never a delete.
export function backupAndResetJobDb(engineHome, { rename = fs.renameSync, mkdir = (p) => fs.mkdirSync(p, { recursive: true }), exists = fs.existsSync } = {}) {
  const backupDir = path.join(engineHome, 'data', `daisy-validate-recovery-${timestampForBackup()}`);
  mkdir(backupDir);
  const moved = [];
  for (const name of ['db', 'jobs']) {
    const src = path.join(engineHome, 'data', name);
    if (exists(src)) {
      const dest = path.join(backupDir, name);
      rename(src, dest);
      moved.push({ from: src, to: dest });
    }
  }
  mkdir(path.join(engineHome, 'data', 'jobs'));
  return { backupDir, moved };
}

async function recoverEngine(engineHome, { log = (m) => console.error(m) } = {}) {
  log('DAISY Pipeline engine health check failed. Attempting one-time automatic recovery: kill the engine, move its job database aside, restart (pass --no-recover to disable this).');
  if (!engineHome) {
    log('  no engine install directory found; skipping kill/backup, just trying to (re)start the engine.');
  } else {
    const killed = await killEngineProcesses(engineHome);
    log(killed.length ? `  killed engine process(es): ${killed.join(', ')}` : '  no matching engine process found to kill (it may already be down).');
    if (killed.length) await sleep(2000); // give the OS a moment to release the port
    const { backupDir, moved } = backupAndResetJobDb(engineHome);
    for (const m of moved) log(`  moved ${m.from} -> ${m.to}`);
    log(`  backup kept (not deleted) at ${backupDir}`);
  }
  await ensureEngine();
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function jobRequest(file) {
  const isOpf = /\.opf$/i.test(file);
  const script = isOpf ? 'nimas-fileset-validator' : 'dtbook-validator';
  const url = pathToFileURL(path.resolve(file)).href;
  const options = [
    ['mathml-version', opts.mathml],
    ['check-images', String(opts.checkImages)],
  ];
  if (!isOpf) options.push(['nimas', String(opts.nimas)]);
  return {
    script,
    body: `<jobRequest xmlns="${NS}">
  <script href="${WS}/scripts/${script}"/>
  <input name="source"><item value="${xmlEsc(url)}"/></input>
${options.map(([k, v]) => `  <option name="${k}">${xmlEsc(v)}</option>`).join('\n')}
</jobRequest>`,
  };
}

// Polls /ws/jobs/<id> until it reaches a terminal status or timeoutMs elapses. Each individual
// poll request also carries its own short deadline (capped at 30s) so a single hung connection
// — exactly the wedged-engine symptom that used to make this script print nothing forever —
// cannot block the overall timeout from ever being reached.
async function pollJob(id, timeoutMs) {
  const startedAt = Date.now();
  let jobXml = '';
  let status = '';
  for (;;) {
    const elapsed = Date.now() - startedAt;
    if (hasTimedOut(startedAt, Date.now(), timeoutMs)) return { timedOut: true, jobXml, status, waitedMs: elapsed };
    const perRequestMs = Math.max(1000, Math.min(30000, timeoutMs - elapsed));
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), perRequestMs);
      let text;
      try {
        const r = await fetch(`${WS}/jobs/${id}`, { signal: ac.signal });
        text = await r.text();
      } finally {
        clearTimeout(t);
      }
      jobXml = text;
      status = (jobXml.match(/<job\b[^>]*\sstatus="([A-Z_]+)"/) || [])[1] || '';
      if (status && status !== 'RUNNING' && status !== 'IDLE') return { timedOut: false, jobXml, status, waitedMs: Date.now() - startedAt };
    } catch {
      // Transient (aborted slow request, connection reset, ...) — keep polling until the
      // overall timeout, rather than failing the file on one bad request.
    }
    await sleep(1000);
  }
}

async function runJob(file, timeoutMs) {
  const { script, body } = jobRequest(file);
  const res = await fetch(`${WS}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body });
  const text = await res.text();
  const id = (text.match(/<job\b[^>]*\sid="([^"]+)"/) || [])[1];
  if (!id) throw new Error(`job was not accepted: ${text.replace(/<[^>]+>/g, ' ').trim().slice(0, 300)}`);
  const poll = await pollJob(id, timeoutMs);
  if (poll.timedOut) {
    await fetch(`${WS}/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error(`timed out after ${Math.round(poll.waitedMs / 1000)}s waiting for the job to finish (limit ${Math.round(timeoutMs / 1000)}s — raise it with --timeout MS or $DAISY_VALIDATE_JOB_TIMEOUT_MS)`);
  }
  const { jobXml, status } = poll;
  // The raw report is on port "report" (dtbook-validator) or "result" zip (fileset);
  // fetch the XML report file by its per-file href.
  const hrefs = [...jobXml.matchAll(/<result\b[^>]*\shref="([^"]+\.xml)"[^>]*\/>/g)].map((m) => m[1]);
  // A job can return several reports: nimas-fileset-validator gives one for the package
  // document (OPF) and one for the DTBook, each also repeated per file. Read them all —
  // reading only the first let OPF errors go unreported (found with A4).
  const reportHrefs = hrefs.filter((h) => /report\.xml$/.test(h));
  const reports = [];
  for (const h of (reportHrefs.length ? reportHrefs : hrefs.slice(0, 1))) reports.push(await (await fetch(h)).text());
  const report = reports.join('\n');
  const engineErrors = [...jobXml.matchAll(/<message\b[^>]*\slevel="ERROR"[^>]*\scontent="([^"]*)"/g)].map((m) => m[1]);
  if (!opts.keepJobs) await fetch(`${WS}/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
  return { script, status, report, engineErrors };
}

// Known false positives in the DAISY rules themselves. Each is matched exactly and shown
// as "suppressed" instead of counted as an error.
//  - dtbook.mathml.nimas.sch, pattern dtbook_NimasHeadMeta (pipeline-modules
//    dtbook-utils): `<rule context="dtb:meta"><assert test="count(*) > 0">The meta
//    element must be empty.</assert>` — the test is inverted relative to its message and
//    to the DTD (meta is EMPTY), so every correctly empty <meta> fails. DAISY's own NIMAS
//    reference sample (NIMAS_valid_baseline.xml) fails it too; publisher files pass only
//    because they have no <head>.
const KNOWN_FALSE_POSITIVES = [
  { kind: 'schematron', message: 'The meta element must be empty.', test: 'count(*) > 0' },
];
const isKnownFalsePositive = (i) => KNOWN_FALSE_POSITIVES.some((k) => k.kind === i.kind && k.message === i.message && k.test === i.test);

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// One summary over every validated document in the job's reports, each document counted
// once (keyed by its path) however many reports repeat it.
function summariseAll(report) {
  const docs = new Map();
  for (const m of report.matchAll(/<d:document-validation-report\b[\s\S]*?<\/d:document-validation-report>/g)) {
    const docPath = ((m[0].match(/<d:document-path>([\s\S]*?)<\/d:document-path>/) || [])[1] || '').trim() || `doc${docs.size}`;
    if (!docs.has(docPath)) docs.set(docPath, summarise(m[0]));
  }
  if (!docs.size) return summarise(report);
  const all = [...docs.values()];
  return {
    docType: [...new Set(all.map((d) => d.docType).filter(Boolean))].join(' + '),
    errorCount: all.reduce((n, d) => n + d.errorCount, 0),
    issues: all.flatMap((d) => d.issues),
  };
}

function summarise(report) {
  const issues = [];
  for (const rep of report.matchAll(/<d:report\b[^>]*type="([^"]*)"[^>]*>([\s\S]*?)<\/d:report>/g)) {
    const kind = rep[1];
    for (const e of rep[2].matchAll(/<d:(error|warn)\b[^>]*>([\s\S]*?)<\/d:\1>/g)) {
      const severity = e[1] === 'warn' ? 'warning' : 'error';
      let desc = decode(((e[2].match(/<d:desc>([\s\S]*?)<\/d:desc>/) || [])[1] || e[2]).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      let line = Number((e[2].match(/<d:location\b[^>]*\sline="(\d+)"/) || [])[1]) || null;
      const sax = desc.match(/lineNumber: (\d+); columnNumber: (\d+); (.*)$/);
      if (sax) { line = Number(sax[1]); desc = sax[3]; }
      desc = desc.replace(/(expected [^"]*"[^"]+"(?:, "[^"]+"){3})(, "[^"]+")+/, '$1, …');
      issues.push({ kind, severity, line, message: desc });
    }
    // Schematron (NIMAS profile) results are SVRL: failed asserts and successful reports.
    for (const f of rep[2].matchAll(/<svrl:(failed-assert|successful-report)\b([^>]*)>([\s\S]*?)<\/svrl:\1>/g)) {
      const attrs = f[2];
      const role = ((attrs.match(/\srole="([^"]*)"/) || [])[1] || '').toLowerCase();
      const severity = /warn|info/.test(role) ? 'warning' : 'error';
      const text = decode(((f[3].match(/<svrl:text>([\s\S]*?)<\/svrl:text>/) || [])[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      const loc = decode((attrs.match(/\slocation="([^"]*)"/) || [])[1] || '')
        .replace(/\*:(\w+)\[namespace-uri\(\)='[^']*'\]/g, '$1')
        .replace(/\[1\]/g, '');
      const test = decode((attrs.match(/\stest="([^"]*)"/) || [])[1] || '');
      issues.push({ kind, severity, line: null, message: text || `failed: ${test}`, location: loc, test });
    }
  }
  const docType = decode((report.match(/<d:document-type>([\s\S]*?)<\/d:document-type>/) || [])[1] || '').trim();
  const count = Number((report.match(/<d:error-count>(\d+)<\/d:error-count>/) || [])[1]);
  return { docType, errorCount: Number.isFinite(count) ? count : issues.filter((i) => i.severity === 'error').length, issues };
}

async function processFile(file) {
  try {
    const job = await runJob(file, opts.timeoutMs);
    const missingReport = describeMissingReport(job);
    if (missingReport) {
      return { file, script: job.script, status: job.status, valid: false, documentType: '', errors: null, suppressed: 0, issues: [], engineErrors: job.engineErrors, missingReport };
    }
    const s = summariseAll(job.report);
    const suppressed = s.issues.filter(isKnownFalsePositive);
    const issues = s.issues.filter((i) => !isKnownFalsePositive(i));
    const errors = Math.max(0, s.errorCount - suppressed.filter((i) => i.severity === 'error').length);
    // The engine marks the job FAIL on any assertion, including suppressed ones.
    const valid = (job.status === 'SUCCESS' || job.status === 'FAIL') && errors === 0 && !job.engineErrors.length;
    return { file, script: job.script, status: job.status, valid, documentType: s.docType, errors, suppressed: suppressed.length, issues, engineErrors: job.engineErrors };
  } catch (err) {
    return { file, status: 'ERROR', valid: false, errors: null, issues: [], engineErrors: [String(err.message || err)] };
  }
}

function printResult(out) {
  if (opts.json) { console.log(JSON.stringify(out)); return; }
  console.log(`\n${out.valid ? 'VALID  ' : 'INVALID'}  ${out.file}`);
  if (out.missingReport) {
    console.log(`  ${out.script || ''} · NO REPORT: ${out.missingReport}`);
  } else {
    console.log(`  ${out.script || ''} · ${out.documentType || 'unknown type'} · ${opts.nimas ? 'NIMAS 1.1 rules' : 'DTBook rules'} · ${out.errors ?? '?'} error(s)${out.suppressed ? ` · ${out.suppressed} suppressed (known DAISY rule bug: empty <meta>)` : ''}`);
  }
  const groups = new Map();
  for (const i of out.issues) {
    const k = `${i.severity} [${i.kind}] ${i.message}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i.line);
  }
  const locs = new Map();
  for (const i of out.issues) {
    if (!i.location) continue;
    const k = `${i.severity} [${i.kind}] ${i.message}`;
    if (!locs.has(k)) locs.set(k, []);
    locs.get(k).push(i.location);
  }
  for (const [k, lines] of groups) {
    const ls = lines.filter(Boolean);
    const where = ls.length ? ` (line${ls.length > 1 ? 's' : ''} ${ls.slice(0, 8).join(', ')}${ls.length > 8 ? ', …' : ''})` : '';
    console.log(`  ${lines.length > 1 ? `${lines.length}× ` : ''}${k.slice(0, 260)}${where}`);
    const at = locs.get(k);
    if (at && at.length) console.log(`      at ${at.slice(0, 3).join('  |  ')}${at.length > 3 ? '  | …' : ''}`);
  }
  for (const m of out.engineErrors) console.log(`  engine: ${m.slice(0, 300)}`);
}

async function main() {
  const files = [];
  let timeoutFlag;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-nimas') opts.nimas = false;
    else if (a === '--mathml') { opts.mathml = argv[++i]; if (!['2.0', '3.0'].includes(opts.mathml)) usage('--mathml must be 2.0 or 3.0'); }
    else if (a === '--check-images') opts.checkImages = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--keep-jobs') opts.keepJobs = true;
    else if (a === '--timeout') timeoutFlag = argv[++i];
    else if (a === '--jobs-health-url') opts.jobsHealthUrl = argv[++i];
    else if (a === '--no-recover') opts.recover = false;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else files.push(a);
  }
  if (!files.length) usage('no input files');
  for (const f of files) if (!fs.existsSync(f)) usage(`file not found: ${f}`);
  opts.timeoutMs = resolveTimeoutMs({ flagValue: timeoutFlag, envValue: process.env.DAISY_VALIDATE_JOB_TIMEOUT_MS });

  const lock = await waitForLock(LOCK_PATH, {
    onWaiting: (holderPid) => {
      console.error(`Another daisy-validate.mjs run (pid ${holderPid ?? '?'}) is using the DAISY Pipeline engine (lock file: ${LOCK_PATH}).`);
      console.error(`Waiting for it to finish (up to ${Math.round(LOCK_MAX_WAIT_MS / 1000)}s) so this run queues instead of colliding with it...`);
    },
  });
  if (!lock.ok) {
    console.error(`Timed out after ${Math.round(LOCK_MAX_WAIT_MS / 1000)}s still waiting for pid ${lock.holderPid ?? '?'} to release the DAISY Pipeline engine lock (${LOCK_PATH}).`);
    console.error('If that process no longer exists, delete the lock file and try again.');
    process.exit(2);
  }
  process.on('exit', () => releaseLock(LOCK_PATH));

  await ensureEngine();
  const engineHome = findEngineHome();

  const jobsHealthUrl = opts.jobsHealthUrl || process.env.DAISY_VALIDATE_JOBS_URL || `${WS}/jobs`;
  let health = await checkEngineJobsHealthy(jobsHealthUrl);
  let recoveryAttempted = false;
  if (!health.healthy && opts.recover) {
    recoveryAttempted = true;
    try {
      await recoverEngine(engineHome);
    } catch (err) {
      console.error(`Automatic recovery itself failed: ${err && err.message ? err.message : err}`);
    }
    health = await checkEngineJobsHealthy(jobsHealthUrl);
  }
  if (!health.healthy) {
    const dbPath = engineHome ? path.join(engineHome, 'data', 'db') : '<engine home>/data/db';
    const jobsPath = engineHome ? path.join(engineHome, 'data', 'jobs') : '<engine home>/data/jobs';
    console.error(`The DAISY Pipeline engine's job list looks unhealthy: ${health.reason}.`);
    console.error('This is the signature of a corrupted job database (hit 23 Sep, after several agents validated at once — see EMBOSS-TASKS.md A50).');
    if (recoveryAttempted) {
      console.error('Automatic recovery (kill engine, back up + reset job database, restart) was already attempted once for this run and the engine is still unhealthy; not trying a second time automatically.');
    } else if (!opts.recover) {
      console.error('Automatic recovery is disabled (--no-recover).');
    }
    console.error(`Fix by hand: stop the engine, move ${dbPath} and ${jobsPath} aside (a timestamped backup, not a delete), recreate an empty ${jobsPath}, then restart (or just re-run this script without --no-recover, which does this itself).`);
    process.exit(2);
  }

  const limit = readEngineJobLimit(engineHome);
  const results = await mapWithConcurrency(files, limit, processFile);

  let anyInvalid = false;
  for (const out of results) {
    if (!out.valid) anyInvalid = true;
    printResult(out);
  }
  process.exitCode = anyInvalid ? 1 : 0;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 2;
  });
}
