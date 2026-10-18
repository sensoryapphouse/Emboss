// The pure parts of Emboss/scripts/release-check.mjs: reading each check's output, deciding "timed out only" against
// "really failed", and the one named list of failures the release check allows. No file, process or clock access here, so
// Emboss/tests/release_check.test.mjs can feed it saved real outputs (tests/fixtures/release-check/).
//
// The rule that matters (Paul, 15 Oct 2026; S5a): on a heavily loaded machine a big test file or extreme document can run past
// its time limit although it passes alone. So
//   - a test file or extreme unit that failed ONLY by timeout is run once more, alone, and counted only then;
//   - anything else (an assertion, a crash, a wrong output, out of memory) fails the release check at once, with no second go.

// ---------------------------------------------------------------- the one list of allowed failures
// Each entry: an extreme-document unit id that may fail, and why that is acceptable. Nothing else is allowed.
// check-extreme-documents.mjs's own header says the same: depth 5000 is beyond what a browser builds.
export const ALLOWED_EXTREME_FAILURES = Object.freeze([
  Object.freeze({
    id: '08-hostile:nest-5000-html-table',
    reason: 'A 5,000-deep HTML table nest exists only in Node\'s jsdom; a browser\'s HTML parser stops at about 512 levels, so no transcriber can meet it (AGENTS.md, check-extreme-documents expected result 127/128).',
  }),
]);
export const allowedExtremeFailure = (unitId) => ALLOWED_EXTREME_FAILURES.find((a) => a.id === unitId) || null;

// Every check, in the order release-check runs them; a beta or public deploy needs all of them, each passing.
export const REQUIRED_CHECKS = Object.freeze(['run-all-tests', 'layout-parity', 'extreme-documents', 'build-dist', 'offline-dist']);
// Emboss Plus needs only the tests, the build and the offline test (Paul, 17 Oct 2026, "make the release check cheaper"): the
// slow layout-parity and extreme-document checks are kept for the beta and the public site.
export const PLUS_CHECKS = Object.freeze(['run-all-tests', 'build-dist', 'offline-dist']);
export const requiredChecks = ({ plus = false } = {}) => (plus ? PLUS_CHECKS : REQUIRED_CHECKS);

// ---------------------------------------------------------------- reuse across kinds of build (Paul, 17 Oct 2026)
// These three test the commit's source, not the kind of build (beta, Plus, public), so a pass in any kind of run of the same
// commit counts for the others for REUSE_MAX_AGE_MS. build-dist and offline-dist are never reused: they test the build itself.
export const SOURCE_CHECKS = Object.freeze(['run-all-tests', 'layout-parity', 'extreme-documents']);
export const REUSE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// Pure. entries: [{ file, manifest }] (earlier manifests of any kind). Returns { name: check } for each needed check that passed
// for exactly this commit within the age limit — the newest such pass — copied, with its own finish time and where it came from.
export function reusableChecks(entries, { commit, now, needed, maxAgeMs = REUSE_MAX_AGE_MS }) {
  const out = {};
  for (const name of needed || []) {
    if (!SOURCE_CHECKS.includes(name)) continue;
    let best = null;
    for (const { file, manifest: m } of entries || []) {
      if (!m || m.tool !== 'release-check' || m.commit !== commit) continue;
      const c = m.checks && m.checks[name];
      if (!c || c.result !== 'pass') continue;
      const finishedAt = c.finishedAt || m.finishedAt;
      const t = Date.parse(finishedAt);
      if (!Number.isFinite(t) || t > now + 5 * 60 * 1000 || now - t > maxAgeMs) continue;
      if (!best || t > best.t) best = { t, check: { ...c, finishedAt, reused: c.reused || { from: file, finishedAt } } };
    }
    if (best) out[name] = best.check;
  }
  return out;
}

// ---------------------------------------------------------------- machine load
// Heavy work may wait while the 1-minute load average is above 2 x the CPU count (other sessions share this machine; load 20-70
// has been seen on 10 cores), but by default it does not (Paul, 16 Oct 2026, "start it now"): it goes ahead with fewer jobs
// if the machine is busy (above 1 x CPUs), and anything that only ran out of time is rerun alone. --wait-limit SEC turns the wait on.
export const LOAD_WAIT_LIMIT_SEC = 0;
export const LOAD_POLL_SEC = 15;
export function loadLevel(load1, cpus) {
  if (!(cpus > 0)) cpus = 1;
  if (load1 > 2 * cpus) return 'high';
  if (load1 > cpus) return 'busy';
  return 'ok';
}
// jobs for run-all-tests and check-layout-parity: 3 normally, 2 when the machine is still busy afterwards.
export const jobsForLoad = (level) => (level === 'ok' ? 3 : 2);

// ---------------------------------------------------------------- run-all-tests.mjs output
// Progress lines:   [  2/7] FAIL    0.9s  tests/b.test.mjs  -- note        ("ok  ", "T/O ", "FAIL")
// Summary line:     headless: 2 passed, 5 failed/timed out, of 7  (4 s wall, jobs=2)
export function parseRunAllTests(text) {
  const files = [];
  const lineRe = /^\[\s*(\d+)\/(\d+)\]\s+(ok|T\/O|FAIL)\s+([\d.]+)s\s+(\S+)(?:\s+--\s+(.*))?$/;
  for (const line of String(text).split(/\r?\n/)) {
    const m = lineRe.exec(line);
    if (m) files.push({ file: m[5], status: m[3] === 'ok' ? 'pass' : m[3] === 'T/O' ? 'timeout' : 'fail', sec: Number(m[4]), note: (m[6] || '').trim() });
  }
  const s = /^headless:\s+(\d+) passed,\s+(\d+) failed\/timed out,\s+of (\d+)\s+\((\d+) s wall, jobs=(\d+)\)/m.exec(String(text));
  return {
    summaryFound: !!s,
    passed: s ? Number(s[1]) : 0,
    failed: s ? Number(s[2]) : 0,
    total: s ? Number(s[3]) : 0,
    wallSec: s ? Number(s[4]) : 0,
    jobs: s ? Number(s[5]) : 0,
    files,
    problems: files.filter((f) => f.status !== 'pass'),
  };
}

// A node --test log (spec reporter) lists each failure under "failing tests:" as a block that starts "test at FILE:L:C".
// Each block's message is the lines before the first stack line ("    at ..."). A block is a TIMEOUT when its message names a
// time limit being passed; NEUTRAL when it only says that sub-tests failed (the sub-tests have their own blocks); anything else is REAL.
const TIMEOUT_RE = /still running after \d+(\.\d+)? ?s|\(hang\)|took \d+(\.\d+)? ?(ms|s)\b.{0,12}\blimit|too slow|timed out|time budget|exceeded the time|Timeout \d+ ?ms exceeded|\bTimeoutError\b/i;
const NEUTRAL_RE = /^\s*\d+ subtests? failed\s*$/i;
export function classifyTestLog(logText) {
  const text = String(logText);
  const head = /^\s*(?:✖\s+)?failing tests:\s*$/m.exec(text);
  if (!head) return { failures: [], timeoutOnly: false, why: 'no "failing tests" section in the log' };
  const section = text.slice(head.index + head[0].length);
  const chunks = section.split(/^\s*(?:test|suite) at .*$/m).map((c) => c.trim()).filter(Boolean);
  const failures = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    const nameLine = lines.findIndex((l) => /^\s*✖ /.test(l));
    const name = nameLine >= 0 ? lines[nameLine].replace(/^\s*✖ /, '').replace(/\s*\([\d.]+m?s\)\s*$/, '') : '(unnamed)';
    const body = [];
    for (const l of lines.slice(nameLine + 1)) {
      if (/^\s+at \S/.test(l) || /^\s*\{\s*$/.test(l) || /^\s*generatedMessage:/.test(l)) break;
      body.push(l.trim());
    }
    const message = body.filter(Boolean).join(' ').slice(0, 400);
    const kind = TIMEOUT_RE.test(message) ? 'timeout' : (NEUTRAL_RE.test(message.replace(/^[A-Za-z]*Error[^:]*:\s*/, '')) || message === '') ? 'neutral' : 'other';
    failures.push({ name, message, kind });
  }
  const real = failures.filter((f) => f.kind === 'other');
  const timeouts = failures.filter((f) => f.kind === 'timeout');
  return { failures, timeoutOnly: failures.length > 0 && real.length === 0 && timeouts.length > 0, why: real.length ? `a real failure: ${real[0].name}: ${real[0].message}` : timeouts.length ? 'only time-limit failures' : 'no failure message found' };
}

// S5A-Q2 (Paul, 17 Oct 2026): the DAISY validator gave NO verdict at all - books_roundtrip's "one verdict per file: 0 !== N" - because its engine
// stopped answering (seen 15 and 17 Oct). That is the validator's fault, not Emboss's: release-check restarts the engine and runs the file once
// more, alone. Only when that is the file's ONLY real failure; a book DAISY reports INVALID (a verdict) is a real failure as ever.
const DAISY_NO_VERDICT_RE = /one verdict per file:?\s*0 !== \d+/;
export function isDaisyNoVerdictLog(logText) {
  const real = classifyTestLog(logText).failures.filter((f) => f.kind === 'other');
  return real.length > 0 && real.every((f) => /DAISY/.test(f.name) && DAISY_NO_VERDICT_RE.test(f.message));
}

// One test file's verdict: 'rerun' (timed out only: run it once more, alone), 'rerun-daisy' (only the DAISY validator gave no verdict: restart
// its engine, then run the file once more, alone) or 'fail' (a real failure: fails the check at once).
// A runner TIMEOUT (the file was killed) is a timeout; a FAIL is one only if its log says every failing test passed its time limit.
export function decideTestFile({ status, logText }) {
  if (status === 'timeout') return { action: 'rerun', why: 'the runner killed it at its time limit' };
  if (status === 'fail') {
    const c = classifyTestLog(logText || '');
    if (isDaisyNoVerdictLog(logText || '')) return { action: 'rerun-daisy', why: 'the DAISY validator gave no verdict at all (its engine did not answer); the engine is restarted and the file run once more, alone' };
    if (c.timeoutOnly) return { action: 'rerun', why: `only time limits were passed (${c.failures.filter((f) => f.kind === 'timeout').map((f) => f.name).slice(0, 3).join('; ')})` };
    return { action: 'fail', why: c.why };
  }
  return { action: 'none', why: 'passed' };
}

// ---------------------------------------------------------------- check-layout-parity.mjs output
//   === check-layout-parity: 12 documents, 3456 blocks (flattened), 20000 block-level checks, 30 page-level checks, 4567 ms ===
//   No parity differences found.
export function parseParity(text, exitCode) {
  const t = String(text);
  const s = /=== check-layout-parity: (\d+) documents, (\d+) blocks \(flattened\), (\d+) block-level checks, (\d+) page-level checks, (\d+) ms ===/.exec(t);
  const clean = /^No parity differences found\.$/m.test(t);
  return {
    summaryFound: !!s,
    documents: s ? Number(s[1]) : 0,
    blocks: s ? Number(s[2]) : 0,
    blockChecks: s ? Number(s[3]) : 0,
    pageChecks: s ? Number(s[4]) : 0,
    clean,
    differences: Number((/--- (\d+) PARITY DIFFERENCE/.exec(t) || [])[1] || 0),
    pass: exitCode === 0 && clean && !!s && Number(s[1]) > 0,
  };
}

// ---------------------------------------------------------------- check-extreme-documents.mjs output
//   [3/128] 05-headings:5000-md      pass 7/7      12.3 s   211 MB
//   2/2 units passed, 0 failed; 0 min 26 s
export function parseExtremeOutput(text) {
  const rows = [];
  const re = /^\[\s*(\d+)\/(\d+)\]\s+(\S+)\s+(pass|FAIL)\b/;
  for (const line of String(text).split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) rows.push({ id: m[3], status: m[4] === 'pass' ? 'pass' : 'fail' });
  }
  const s = /^(\d+)\/(\d+) units passed, (\d+) failed; (\d+) min (\d+) s/m.exec(String(text));
  return {
    summaryFound: !!s,
    passed: s ? Number(s[1]) : 0,
    total: s ? Number(s[2]) : 0,
    failed: s ? Number(s[3]) : 0,
    wallSec: s ? Number(s[4]) * 60 + Number(s[5]) : 0,
    failedUnits: rows.filter((r) => r.status === 'fail').map((r) => r.id),
  };
}

// Failures of one extreme unit (the "reason" strings from its logs/<unit>.json) that are only a time limit being passed:
//   "timeout: the whole unit passed its 30 s budget ...", "hang/timeout: no result after 25 s ...", "too slow: 31.0 s against a limit of 30 s",
//   "took 31 s, budget 30 s", "not run: the unit's time budget of 30 s was used up by the items before it".
// "out of memory", "the process died", a parse/format stage error, "peak memory ... over this unit's budget" are real.
const EXTREME_TIMEOUT_RE = /^(timeout:|hang\/timeout:|too slow:|took \d+ s, budget \d+ s|not run: the unit's time budget)/;
export const isExtremeTimeoutReason = (reason) => EXTREME_TIMEOUT_RE.test(String(reason).trim());
export function decideExtremeUnit(unitId, reasons) {
  const allowed = allowedExtremeFailure(unitId);
  if (allowed) return { action: 'allowed', why: allowed.reason };
  const list = (reasons || []).map(String);
  if (!list.length) return { action: 'fail', why: 'the unit failed but its log gave no reason' };
  const real = list.find((r) => !isExtremeTimeoutReason(r));
  if (real) return { action: 'fail', why: `a real failure: ${real.split('\n')[0].slice(0, 200)}` };
  return { action: 'rerun', why: 'only a time limit was passed: ' + list[0].split('\n')[0].slice(0, 120) };
}

// ---------------------------------------------------------------- build-dist.mjs output
//   build-info: 6d71f654 (2026-10-15); sw.js cache "emboss-6d71f654", 123 precached assets
//   check-dist: ok
export function parseBuild(text) {
  const t = String(text);
  const m = /^build-info: (\S+) \((\d{4}-\d{2}-\d{2})\)(.*?); sw\.js cache "([^"]+)", (\d+) precached assets/m.exec(t);
  return {
    summaryFound: !!m,
    buildId: m ? m[1] : null,
    date: m ? m[2] : null,
    beta: !!(m && /BETA build/.test(m[3])),
    plus: !!(m && /PLUS build/.test(m[3])),
    cacheId: m ? m[4] : null,
    precachedAssets: m ? Number(m[5]) : 0,
    checkDistOk: /^check-dist: ok$/m.test(t),
  };
}

// ---------------------------------------------------------------- tests/test-offline-dist.mjs output
//   === Offline (built app) [Chrome]: 41 passed, 0 failed ===
export function parseOffline(text, exitCode) {
  const t = String(text);
  const m = /^=== Offline \(built app\) \[([^\]]*)\]: (\d+) passed, (\d+) failed ===/m.exec(t);
  return {
    summaryFound: !!m,
    engine: m ? m[1] : null,
    passed: m ? Number(m[2]) : 0,
    failed: m ? Number(m[3]) : 0,
    pass: exitCode === 0 && !!m && Number(m[3]) === 0 && Number(m[2]) > 0,
  };
}
// A browser step that ran out of time under load ends the script with Playwright's TimeoutError and prints no "✖ FAIL" line.
export function offlineTimedOutOnly(text) {
  const t = String(text);
  return /TimeoutError|Timeout \d+ ?ms exceeded/.test(t) && !/✖ FAIL/.test(t);
}
