// The release-check command (S5a; audit 15 Oct 2026, "Release gates need enforceable revision-specific evidence").
//
// What is tested here is the part that decides things — and that needs no machine load, browser or ten-minute run to test:
//   - reading each check's output (run-all-tests, check-layout-parity, check-extreme-documents, build-dist, test-offline-dist);
//     the inputs are SAVED REAL OUTPUTS in tests/fixtures/release-check/ (the run-all, extreme and log fixtures come from real runs
//     of the real tools — run-all-mixed.txt and log-*.txt from a scratch copy of run-all-tests.mjs over small test files made to
//     pass, fail an assertion, hang, and fail on a time limit; the extreme-* files from `--filter … --time-scale …` runs of
//     check-extreme-documents.mjs; parity-pass.txt, build-dist.txt and offline-dist.txt from the real tools);
//   - the rule "a test file or extreme unit that failed ONLY by timeout is run once more, alone; any real failure fails at once";
//   - the one named list of allowed failures (the Node-only 08-hostile:nest-5000-html-table);
//   - the evidence manifest: where it is written, that a partial run cannot stand in for a full one, and deploy.mjs's rule that a
//     passing manifest for exactly that commit, no older than 24 hours, for the same kind of build, must exist (a pure function,
//     plus `deploy.mjs --check-release-only`, which prints the verdict and exits: it builds, uploads and tags NOTHING).
// Nothing here deploys. Written first: against the code before this change (no lib/release-check-core.mjs, no
// lib/release-evidence.mjs, no deploy.mjs gate) every test below fails — the imports cannot be resolved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_EXTREME_FAILURES, allowedExtremeFailure, REQUIRED_CHECKS, loadLevel, jobsForLoad, LOAD_WAIT_LIMIT_SEC,
  PLUS_CHECKS, SOURCE_CHECKS, requiredChecks, reusableChecks, REUSE_MAX_AGE_MS,
  parseRunAllTests, classifyTestLog, decideTestFile, isDaisyNoVerdictLog, parseParity, parseExtremeOutput, decideExtremeUnit, isExtremeTimeoutReason,
  parseBuild, parseOffline, offlineTimedOutOnly,
} from '../scripts/lib/release-check-core.mjs';
import {
  SCHEMA, MAX_AGE_MS, evidenceDir, evidenceFile, writeManifest, readManifest, evaluateEvidence, releaseGate, digestProblem, distDigest,
  kindOf, readAllManifests,
} from '../scripts/lib/release-evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(HERE, '..');
const ROOT = path.resolve(EMBOSS, '..');
const FX = path.join(HERE, 'fixtures', 'release-check');
const fx = (name) => fs.readFileSync(path.join(FX, name), 'utf8');
const fxJson = (name) => JSON.parse(fx(name));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-release-check-test-'));
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

// ======================================================================================================= run-all-tests
test('run-all-tests output: counts, jobs and every non-passing file with its kind', () => {
  const p = parseRunAllTests(fx('run-all-mixed.txt'));
  assert.equal(p.summaryFound, true);
  assert.deepEqual([p.total, p.passed, p.failed, p.jobs], [7, 2, 5, 2]);
  assert.deepEqual(p.files.map((f) => [f.file, f.status]), [
    ['tests/b_real_fail.test.mjs', 'fail'], ['tests/a_ok.test.mjs', 'pass'], ['tests/d_inner_timeout.test.mjs', 'fail'],
    ['tests/e_mixed.test.mjs', 'fail'], ['tests/c_hang.test.mjs', 'timeout'], ['format/test-plain-fail.mjs', 'fail'], ['format/test-plain-ok.mjs', 'pass'],
  ]);
  assert.equal(p.problems.length, 5);
  assert.equal(parseRunAllTests('garbage\n').summaryFound, false, 'no summary line: not a result');
});

test('a node:test log: time-limit failures are told from real ones', () => {
  const real = classifyTestLog(fx('log-real-fail.txt'));
  assert.equal(real.timeoutOnly, false);
  assert.equal(real.failures[0].kind, 'other');
  const inner = classifyTestLog(fx('log-inner-timeout.txt'));
  assert.equal(inner.timeoutOnly, true, 'both failing tests passed a time limit ("still running after 90 s (hang)", "took 71234 ms (limit 60000)")');
  assert.deepEqual(inner.failures.map((f) => f.kind), ['timeout', 'timeout']);
  const mixed = classifyTestLog(fx('log-mixed.txt'));
  assert.equal(mixed.timeoutOnly, false, 'one time-limit failure and one real failure: real wins');
  assert.deepEqual(mixed.failures.map((f) => f.kind), ['timeout', 'other']);
  assert.equal(classifyTestLog('ok\nℹ pass 3\n').timeoutOnly, false, 'a log with no failing-tests section is not a timeout');
});

test('a test file that failed only by timeout is rerun once; a real failure fails at once', () => {
  assert.equal(decideTestFile({ status: 'pass' }).action, 'none');
  assert.equal(decideTestFile({ status: 'timeout', logText: '' }).action, 'rerun', 'killed by the runner at its limit');
  assert.equal(decideTestFile({ status: 'fail', logText: fx('log-inner-timeout.txt') }).action, 'rerun');
  assert.equal(decideTestFile({ status: 'fail', logText: fx('log-real-fail.txt') }).action, 'fail');
  assert.equal(decideTestFile({ status: 'fail', logText: fx('log-mixed.txt') }).action, 'fail');
  assert.equal(decideTestFile({ status: 'fail', logText: '' }).action, 'fail', 'a plain-node script that exited non-zero, or no log: real');
  assert.match(decideTestFile({ status: 'fail', logText: fx('log-real-fail.txt') }).why, /wrong braille/);
});

// S5A-Q2 (Paul, 17 Oct 2026): a DAISY validator that gives no verdict at all (books_roundtrip "one verdict per file: 0 !== 9", the real log of
// release check a7042790, 17 Oct) is the validator's fault, not Emboss's: the engine is restarted and the file rerun once, alone. A book DAISY
// reports INVALID, or any other failure in the same file, still fails at once.
test('S5A-Q2: a DAISY validator with no verdict at all -> restart the engine and rerun once; an INVALID book or another failure -> fail', () => {
  const noVerdict = fx('log-daisy-no-verdict.txt');
  assert.ok(isDaisyNoVerdictLog(noVerdict), 'the real log is recognised');
  const d = decideTestFile({ status: 'fail', logText: noVerdict });
  assert.equal(d.action, 'rerun-daisy', d.why);
  assert.match(d.why, /DAISY/);
  const invalid = noVerdict.replace(/one verdict per file:[\s\S]*?0 !== 9/, 'every book VALID: section-3-daisy.xml: INVALID (2 errors)\n\n  false !== true');
  assert.equal(isDaisyNoVerdictLog(invalid), false);
  assert.equal(decideTestFile({ status: 'fail', logText: invalid }).action, 'fail', 'an INVALID verdict is a real failure');
  const plus = noVerdict + '\ntest at tests/books/books_roundtrip.test.mjs:9:1\n✖ section-9: something else (1ms)\n  AssertionError [ERR_ASSERTION]: wrong braille\n      at x (file:///a.mjs:1:1)\n';
  assert.equal(decideTestFile({ status: 'fail', logText: plus }).action, 'fail', 'another real failure in the same file still fails');
  assert.equal(isDaisyNoVerdictLog(fx('log-real-fail.txt')), false);
});

// ======================================================================================================= layout parity
test('check-layout-parity: passes only on exit 0 with the clean line and a non-empty summary', () => {
  const out = fx('parity-pass.txt');
  const ok = parseParity(out, 0);
  assert.equal(ok.pass, true);
  assert.deepEqual([ok.documents, ok.blocks, ok.blockChecks, ok.pageChecks], [19, 10267, 24208, 76]);
  assert.equal(parseParity(out, 1).pass, false, 'a non-zero exit is a failure whatever the text says');
  assert.equal(parseParity('crashed\n', 1).pass, false);
  assert.equal(parseParity(out.replace('No parity differences found.', ''), 0).pass, false, 'no clean line');
  assert.equal(parseParity(out.replace(/ 19 documents,/, ' 0 documents,'), 0).pass, false, 'zero documents checked proves nothing');
  const diff = '=== check-layout-parity: 3 documents, 10 blocks (flattened), 40 block-level checks, 6 page-level checks, 99 ms ===\n\n--- 2 PARITY DIFFERENCE(S) (formatBlock/formatDocument vs traceBlock/editor path) ---\n';
  const d = parseParity(diff, 1);
  assert.equal(d.pass, false);
  assert.equal(d.differences, 2);
});

// ======================================================================================================= extreme documents
test('check-extreme-documents output: the summary and the failed units', () => {
  const pass = parseExtremeOutput(fx('extreme-pass.txt'));
  assert.deepEqual([pass.summaryFound, pass.total, pass.passed, pass.failed, pass.failedUnits], [true, 2, 2, 0, []]);
  const known = parseExtremeOutput(fx('extreme-known-failure.txt'));
  assert.deepEqual([known.total, known.failed, known.failedUnits], [1, 1, ['08-hostile:nest-5000-html-table']]);
  assert.equal(parseExtremeOutput('nothing useful').summaryFound, false);
});

test('the allowed-failure list is one named list, every entry with its reason', () => {
  assert.ok(Object.isFrozen(ALLOWED_EXTREME_FAILURES));
  assert.deepEqual(ALLOWED_EXTREME_FAILURES.map((a) => a.id), ['08-hostile:nest-5000-html-table']);
  for (const a of ALLOWED_EXTREME_FAILURES) assert.ok(a.reason && a.reason.length > 40, `${a.id} has no reason`);
  assert.match(allowedExtremeFailure('08-hostile:nest-5000-html-table').reason, /jsdom/);
  assert.equal(allowedExtremeFailure('08-hostile:nest-5000-html-div'), null, 'its neighbours are not allowed to fail');
  assert.equal(allowedExtremeFailure('08-hostile:nest-5000-html-table-x'), null, 'by exact id');
});

test('an extreme unit: allowed, rerun (only a time limit passed) or fail (anything real)', () => {
  const known = fxJson('extreme-unit-known.json');
  // the known failure is itself reported as a "timeout:" — it is allowed BEFORE the rerun rule, so it is never rerun
  assert.ok(isExtremeTimeoutReason(known.failures[0].reason));
  assert.equal(decideExtremeUnit(known.id, known.failures.map((f) => f.reason)).action, 'allowed');
  // the same timeout in any other unit is rerun, once
  assert.equal(decideExtremeUnit('05-headings:5000-md', fxJson('extreme-unit-timeouts.json').failures.map((f) => f.reason)).action, 'rerun');
  assert.equal(decideExtremeUnit('05-headings:5000-txt', fxJson('extreme-unit-notrun.json').failures.map((f) => f.reason)).action, 'rerun');
  // real failures (the wording check-extreme-documents.mjs gives each): at once
  for (const reason of [
    'out of memory: the JavaScript heap passed its 1024 MB limit during "parse"\nFATAL ERROR: Reached heap limit',
    'the process died (SIGSEGV) during "bana-g2"\nsomething',
    'parse: RangeError: Maximum call stack size exceeded',
    'nimas-reread: the saved NIMAS file did not read back',
    "peak memory 1200 MB is over this unit's budget of 800 MB",
    'no result was produced',
    'Emboss fetched an external address named in the file (http://127.0.0.1:1/x): external entities must never be fetched',
  ]) {
    const d = decideExtremeUnit('02-equations:xml', [reason]);
    assert.equal(d.action, 'fail', reason);
  }
  assert.equal(decideExtremeUnit('02-equations:xml', ['timeout: the whole unit passed its 60 s budget during "parse" (item running: x)', 'parse: TypeError: x']).action, 'fail', 'a timeout beside a real failure is real');
  assert.equal(decideExtremeUnit('02-equations:xml', []).action, 'fail', 'no reason given: not a timeout');
  assert.equal(decideExtremeUnit('02-equations:xml', undefined).action, 'fail');
});

// ======================================================================================================= build and offline
test('build-dist output: the build id, the cache id and check-dist', () => {
  const b = parseBuild(fx('build-dist.txt'));
  assert.equal(b.summaryFound, true);
  assert.match(b.buildId, /^[0-9a-f]{8}$/);
  assert.equal(b.cacheId, `emboss-${b.buildId}`);
  assert.ok(b.precachedAssets > 50);
  assert.equal(b.checkDistOk, true);
  assert.equal(b.beta, false);
  const beta = parseBuild(fx('build-dist.txt').replace(/\(\d{4}-\d{2}-\d{2}\);/, '$& — BETA build (Transcriber tools and hardware controls locked; ?tools=1 unlocks);').replace('); — BETA', ') — BETA'));
  assert.equal(beta.summaryFound, true);
  assert.equal(beta.beta, true);
  assert.equal(beta.plus, false);
  assert.equal(b.plus, false);
  // Emboss Plus (Paul, 16 Oct 2026): build-dist says "— PLUS build (…)"; it is told apart from beta
  const plus = parseBuild(fx('build-dist.txt').replace(/\(\d{4}-\d{2}-\d{2}\)/, '$& — PLUS build (the full build; Transcriber tools on for a first visit)'));
  assert.equal(plus.summaryFound, true);
  assert.equal(plus.plus, true);
  assert.equal(plus.beta, false);
  assert.equal(parseBuild('nothing').summaryFound, false);
  assert.equal(parseBuild(fx('build-dist.txt').replace('check-dist: ok', '')).checkDistOk, false);
});

test('offline test output: passes only on exit 0 and no failures; a timeout alone is told from a failed check', () => {
  const out = fx('offline-dist.txt');
  const o = parseOffline(out, 0);
  assert.equal(o.pass, true);
  assert.equal(o.failed, 0);
  assert.ok(o.passed > 10);
  assert.equal(o.engine, 'Chrome');
  assert.equal(parseOffline(out, 1).pass, false);
  assert.equal(parseOffline(out.replace(/ 0 failed ===/, ' 2 failed ==='), 1).pass, false);
  assert.equal(offlineTimedOutOnly(out), false);
  assert.equal(offlineTimedOutOnly('page.waitForSelector: Timeout 30000ms exceeded.\n  at ...'), true);
  assert.equal(offlineTimedOutOnly('✖ FAIL  Quick Mode brailles\npage.waitForSelector: Timeout 30000ms exceeded.'), false, 'an assertion failed too: real');
});

// ======================================================================================================= load
test('machine load: waits above 2 x CPUs, fewer jobs when still busy', () => {
  assert.equal(loadLevel(19.9, 10), 'busy');
  assert.equal(loadLevel(20.1, 10), 'high');
  assert.equal(loadLevel(34.35, 10), 'high');
  assert.equal(loadLevel(9.9, 10), 'ok');
  assert.equal(loadLevel(3, 0), 'high', 'an unreadable CPU count is treated as one CPU');
  assert.equal(jobsForLoad('ok'), 3);
  assert.equal(jobsForLoad('busy'), 2);
  assert.equal(jobsForLoad('high'), 2);
  // Changed from 1200 (20 minutes) to 0: by default the release check no longer waits for the load to fall (Paul, 16 Oct 2026,
  // "why does it have to wait for the load to be below 20 - why not just go now?" / "start it now"). Reruns of timeouts remain.
  assert.equal(LOAD_WAIT_LIMIT_SEC, 0);
});

// ======================================================================================================= the manifest
const COMMIT = 'a'.repeat(40);
const NOW = Date.parse('2026-10-15T20:00:00Z');
function goodManifest(over = {}) {
  const checks = {};
  for (const n of REQUIRED_CHECKS) checks[n] = { result: 'pass', durationSec: 10 };
  return {
    schema: SCHEMA, tool: 'release-check', commit: COMMIT, commitShort: COMMIT.slice(0, 8), complete: true, overall: 'pass',
    startedAt: '2026-10-15T19:00:00Z', finishedAt: '2026-10-15T19:50:00Z', options: { beta: false, only: null },
    checks, build: { buildId: COMMIT.slice(0, 8), cacheId: `emboss-${COMMIT.slice(0, 8)}`, beta: false, distDigest: 'd'.repeat(64) },
    ...over,
  };
}
const verdict = (m, o = {}) => evaluateEvidence(m, { commit: COMMIT, now: NOW, ...o });

test('deploy rule: Emboss Plus evidence only for an Emboss Plus deploy, and the reverse (Paul, 16 Oct 2026)', () => {
  const plusM = goodManifest({ build: { ...goodManifest().build, plus: true } });
  assert.deepEqual(verdict(plusM, { plus: true }), { ok: true, reasons: [] });
  assert.match(verdict(plusM).reasons.join(), /Emboss Plus build but this deploy is not Emboss Plus/);
  assert.match(verdict(goodManifest(), { plus: true }).reasons.join(), /non-Plus build but this deploy is Emboss Plus/);
});

test('deploy rule: a passing manifest for exactly this commit, fresh, for the same kind of build', () => {
  assert.deepEqual(verdict(goodManifest()), { ok: true, reasons: [] });
  assert.match(verdict(null).reasons[0], /no release evidence exists for commit/);
  assert.match(verdict(goodManifest({ commit: 'b'.repeat(40) })).reasons.join(), /not aaaaaaaa|is for commit b+/, 'another commit\'s evidence');
  assert.equal(verdict(goodManifest({ overall: 'fail' })).ok, false);
  assert.equal(verdict(goodManifest({ complete: false })).ok, false, 'a --only run');
  assert.match(verdict(goodManifest({ complete: false })).reasons.join(), /partial/);
  assert.equal(verdict(goodManifest({ schema: 99 })).ok, false);
  assert.equal(verdict(goodManifest({ tool: 'someone-else' })).ok, false);
  // one check failed, or is missing, even though "overall" says pass (a hand-edited or damaged file)
  const failed = goodManifest(); failed.checks['layout-parity'].result = 'fail';
  assert.match(verdict(failed).reasons.join(), /"layout-parity" did not pass/);
  const missing = goodManifest(); delete missing.checks['offline-dist'];
  assert.match(verdict(missing).reasons.join(), /no result for "offline-dist"/);
  for (const n of ['run-all-tests', 'layout-parity', 'extreme-documents', 'build-dist', 'offline-dist']) assert.ok(REQUIRED_CHECKS.includes(n), n);
  assert.equal(REQUIRED_CHECKS.length, 5);
});

test('deploy rule: freshness — no older than 24 hours, not from the future', () => {
  const at = (iso) => goodManifest({ finishedAt: iso });
  assert.equal(MAX_AGE_MS, 24 * 3600 * 1000);
  assert.equal(verdict(at('2026-10-14T20:30:00Z')).ok, true, '23.5 hours old');
  const old = verdict(at('2026-10-14T19:00:00Z'));
  assert.equal(old.ok, false, '25 hours old');
  assert.match(old.reasons.join(), /25\.0 hours old/);
  assert.equal(verdict(at('2026-10-15T20:03:00Z')).ok, true, 'a few minutes of clock difference is allowed');
  assert.match(verdict(at('2026-10-15T21:00:00Z')).reasons.join(), /in the future/);
  assert.match(verdict(at('yesterday')).reasons.join(), /no valid finish time/);
  assert.match(verdict(goodManifest({ finishedAt: undefined })).reasons.join(), /no valid finish time/);
});

test('deploy rule: the evidence is for the same kind of build (beta or not) and names its build', () => {
  assert.equal(verdict(goodManifest(), { beta: true }).ok, false);
  assert.match(verdict(goodManifest(), { beta: true }).reasons.join(), /non-beta build but this deploy is a beta/);
  const beta = goodManifest(); beta.build.beta = true;
  assert.equal(verdict(beta, { beta: true }).ok, true);
  assert.match(verdict(beta, { beta: false }).reasons.join(), /beta build but this deploy is non-beta/);
  const nodigest = goodManifest(); delete nodigest.build.distDigest;
  assert.match(verdict(nodigest).reasons.join(), /does not identify the build/);
  assert.equal(verdict(goodManifest({ build: null })).ok, false);
});

test('the dist about to ship must be the one the checks ran against', () => {
  const m = goodManifest();
  assert.equal(digestProblem(m, 'd'.repeat(64)), null);
  assert.match(digestProblem(m, 'e'.repeat(64)), /not the one the release check ran against/);
  assert.match(digestProblem(null, 'e'), /no evidence/);
});

test('distDigest ignores build-info.json (the date) and nothing else', async () => {
  const mk = (name, files) => {
    const d = path.join(TMP, name);
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
    return d;
  };
  const a = mk('dist-a', { 'index.html': '<p>x</p>', 'sw.js': 'cache', 'tables/a.cti': 'abc', 'build-info.json': '{"date":"2026-10-14"}' });
  const b = mk('dist-b', { 'index.html': '<p>x</p>', 'sw.js': 'cache', 'tables/a.cti': 'abc', 'build-info.json': '{"date":"2026-10-15"}' });
  const c = mk('dist-c', { 'index.html': '<p>x</p>', 'sw.js': 'cache', 'tables/a.cti': 'abd', 'build-info.json': '{"date":"2026-10-14"}' });
  const e = mk('dist-e', { 'index.html': '<p>x</p>', 'sw.js': 'cache', 'tables/a.cti': 'abc', 'extra.txt': '1' });
  assert.equal(await distDigest(a), await distDigest(b), 'only the date differs');
  assert.notEqual(await distDigest(a), await distDigest(c), 'one byte of one file differs');
  assert.notEqual(await distDigest(a), await distDigest(e), 'an extra file');
  assert.match(await distDigest(a), /^[0-9a-f]{64}$/);
});

test('manifest files: inside the git directory, a partial run never replaces a full one', async () => {
  const prev = process.env.EMBOSS_RELEASE_EVIDENCE_DIR;
  delete process.env.EMBOSS_RELEASE_EVIDENCE_DIR;
  try {
    const real = evidenceDir(ROOT);
    const common = path.resolve(ROOT, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim());
    assert.equal(real, path.join(common, 'release-evidence'), 'under the repository\'s common .git directory, which git itself never tracks');
    assert.ok(path.relative(common, real) === 'release-evidence', 'a folder inside the git directory, which git never tracks or checks out over');
  } finally { if (prev !== undefined) process.env.EMBOSS_RELEASE_EVIDENCE_DIR = prev; }
  const dir = path.join(TMP, 'evidence');
  assert.equal(await readManifest(dir, COMMIT), null, 'nothing there yet');
  const full = goodManifest();
  const f1 = await writeManifest(dir, full);
  assert.equal(f1, evidenceFile(dir, COMMIT));
  const partial = goodManifest({ complete: false, overall: 'pass' });
  const f2 = await writeManifest(dir, partial);
  assert.equal(f2, evidenceFile(dir, COMMIT, true));
  assert.notEqual(f1, f2);
  assert.equal((await readManifest(dir, COMMIT)).complete, true, 'the partial run left the full one alone');
  assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0, 'no temp files left');
  fs.writeFileSync(evidenceFile(dir, 'c'.repeat(40)), '{ not json');
  await assert.rejects(readManifest(dir, 'c'.repeat(40)), /cannot be read/, 'a damaged file is an error, not "no evidence"');
});

test('releaseGate: preview needs nothing, dry-run reports, a real deploy is refused, --skip-release-check is loud', async () => {
  const dir = path.join(TMP, 'gate-evidence');
  process.env.EMBOSS_RELEASE_EVIDENCE_DIR = dir;
  try {
    const gate = (o) => releaseGate({ root: ROOT, commit: COMMIT, now: NOW, ...o });
    const text = (g) => g.lines.map((l) => l.text).join('\n');
    // no evidence at all
    const refused = await gate({});
    assert.equal(refused.proceed, false);
    assert.ok(refused.lines.every((l) => l.level === 'error'));
    assert.match(text(refused), /no release evidence exists/);
    assert.match(text(refused), /release-check\.mjs aaaaaaaa/);
    assert.match(text((await gate({ beta: true }))), /release-check\.mjs aaaaaaaa --beta/);
    // a preview is not a release
    const preview = await gate({ preview: 'relaxed-braille' });
    assert.deepEqual([preview.proceed, preview.skipped], [true, false]);
    assert.match(text(preview), /preview "relaxed-braille": no release check required/);
    // dry-run: reported, never stops
    const dry = await gate({ enforce: false });
    assert.equal(dry.proceed, true);
    assert.match(text(dry), /would be REFUSED/);
    // skip: proceeds, loudly, and says so
    const skip = await gate({ skip: true });
    assert.deepEqual([skip.proceed, skip.skipped, skip.evidence], [true, true, null]);
    assert.ok(skip.lines.every((l) => l.level === 'warn'));
    assert.match(text(skip), /WARNING: --skip-release-check/);
    assert.match(text(skip), /no release evidence exists/);
    // good evidence: proceeds with it, and --skip-release-check is not needed
    await writeManifest(dir, goodManifest({ finishedAt: new Date(NOW - 3600e3).toISOString() }));
    const ok = await gate({});
    assert.deepEqual([ok.proceed, ok.skipped], [true, false]);
    assert.equal(ok.evidence.commit, COMMIT);
    assert.match(text(ok), /passed on 2026-10-15T19:00:00\.000Z/);
    assert.match(text(await gate({ skip: true })), /evidence is good, so it is being used/);
    // the same evidence, 25 hours on
    const stale = await releaseGate({ root: ROOT, commit: COMMIT, now: NOW + 25 * 3600e3 });
    assert.equal(stale.proceed, false);
    assert.match(text(stale), /hours old/);
    // evidence for a non-beta build does not serve a beta deploy
    assert.equal((await gate({ beta: true })).proceed, false);
  } finally { delete process.env.EMBOSS_RELEASE_EVIDENCE_DIR; }
});

// ======================================================================================================= deploy.mjs itself
// --check-release-only evaluates the rule for a ref and exits before anything else happens: no worktree, no build, no upload, no tag.
test('deploy.mjs --check-release-only: refuses without evidence, allows with it, previews and --skip-release-check as stated', async () => {
  const dir = path.join(TMP, 'deploy-evidence');
  fs.mkdirSync(dir, { recursive: true });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const run = (...a) => spawnSync(process.execPath, [path.join(EMBOSS, 'scripts/deploy.mjs'), head, '--check-release-only', ...a], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, env: { ...process.env, EMBOSS_RELEASE_EVIDENCE_DIR: dir },
  });
  const r1 = run();
  assert.equal(r1.status, 1, r1.stdout + r1.stderr);
  assert.match(r1.stderr, /no release evidence exists for commit/);
  assert.match(r1.stderr, /release-check\.mjs/);
  assert.doesNotMatch(r1.stdout + r1.stderr, /uploading|tagged|building/);

  const r2 = run('--skip-release-check');
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /WARNING: --skip-release-check/);

  const r3 = run('--preview=my-branch');
  assert.equal(r3.status, 0, r3.stdout + r3.stderr);
  assert.match(r3.stdout, /no release check required/);

  const m = goodManifest({ commit: head, commitShort: head.slice(0, 8), finishedAt: new Date(Date.now() - 3600e3).toISOString() });
  m.build.cacheId = `emboss-${head.slice(0, 8)}`;
  await writeManifest(dir, m);
  const r4 = run();
  assert.equal(r4.status, 0, r4.stdout + r4.stderr);
  assert.match(r4.stdout, /release check: commit .* passed on/);
  assert.match(r4.stdout, /would be allowed/);

  const r5 = run('--beta');                       // the evidence is for a non-beta build
  assert.equal(r5.status, 1, r5.stdout + r5.stderr);
  assert.match(r5.stderr, /non-beta build but this deploy is a beta/);

  await writeManifest(dir, { ...m, finishedAt: new Date(Date.now() - 26 * 3600e3).toISOString() });
  const r6 = run();
  assert.equal(r6.status, 1, r6.stdout + r6.stderr);
  assert.match(r6.stderr, /hours old/);

  await writeManifest(dir, { ...m, overall: 'fail' });
  assert.equal(run().status, 1);
});

// ======================================================================================================= cheaper (Paul, 17 Oct 2026)
// "make the release check cheaper": Emboss Plus needs only the tests, the build and the offline test; the source checks
// (run-all-tests, layout-parity, extreme-documents) that passed for a commit in one kind of run count for the others for 12 hours.
test('Emboss Plus needs run-all-tests, build-dist and offline-dist; beta and public need all five', () => {
  assert.deepEqual([...PLUS_CHECKS], ['run-all-tests', 'build-dist', 'offline-dist']);
  assert.deepEqual([...requiredChecks({ plus: true })], [...PLUS_CHECKS]);
  assert.deepEqual([...requiredChecks({})], [...REQUIRED_CHECKS]);
  const plusOnly = goodManifest({ options: { plus: true }, build: { ...goodManifest().build, plus: true } });
  delete plusOnly.checks['layout-parity']; delete plusOnly.checks['extreme-documents'];
  assert.deepEqual(verdict(plusOnly, { plus: true }), { ok: true, reasons: [] }, 'a Plus run without the two slow checks serves a Plus deploy');
  const noOffline = structuredClone(plusOnly); delete noOffline.checks['offline-dist'];
  assert.match(verdict(noOffline, { plus: true }).reasons.join(), /no result for "offline-dist"/);
  const publicShort = goodManifest(); delete publicShort.checks['extreme-documents'];
  assert.match(verdict(publicShort).reasons.join(), /no result for "extreme-documents"/, 'a public deploy still needs every check');
});

test('each check must itself be under 24 hours old (a reused one keeps its own finish time)', () => {
  const m = goodManifest({ finishedAt: '2026-10-15T19:50:00Z' });
  m.checks['run-all-tests'] = { result: 'pass', finishedAt: '2026-10-14T18:00:00Z', reused: { from: `${COMMIT}.beta.json`, finishedAt: '2026-10-14T18:00:00Z' } };
  const v = verdict(m);
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(), /"run-all-tests" is 26\.0 hours old \(reused from a+\.beta\.json\)/);
  m.checks['run-all-tests'].finishedAt = '2026-10-15T10:00:00Z';
  assert.equal(verdict(m).ok, true);
});

test('reusableChecks: a source check that passed for this commit in the last 12 hours, from any kind of run', () => {
  const at = (h) => new Date(NOW - h * 3600e3).toISOString();
  const beta = goodManifest({ finishedAt: at(2), options: { beta: true } });
  for (const n of REQUIRED_CHECKS) beta.checks[n].finishedAt = at(2.5);
  beta.checks['layout-parity'] = { result: 'fail', finishedAt: at(2.4) };
  const older = goodManifest({ finishedAt: at(5) });
  for (const n of REQUIRED_CHECKS) older.checks[n].finishedAt = at(5);
  const stale = goodManifest({ finishedAt: at(13) });
  const other = goodManifest({ commit: 'b'.repeat(40), finishedAt: at(1) });
  const entries = [{ file: 'old.json', manifest: older }, { file: 'beta.json', manifest: beta }, { file: 'stale.json', manifest: stale }, { file: 'other.json', manifest: other }];
  const r = reusableChecks(entries, { commit: COMMIT, now: NOW, needed: [...REQUIRED_CHECKS] });
  assert.deepEqual(Object.keys(r).sort(), ['extreme-documents', 'layout-parity', 'run-all-tests'], 'never build-dist or offline-dist');
  assert.equal(r['run-all-tests'].reused.from, 'beta.json', 'the newest pass');
  assert.equal(r['run-all-tests'].finishedAt, at(2.5));
  assert.equal(r['layout-parity'].reused.from, 'old.json', 'a failed check is not reused; an older pass is');
  assert.equal(REUSE_MAX_AGE_MS, 12 * 3600e3);
  assert.deepEqual(reusableChecks([{ file: 'stale.json', manifest: stale }], { commit: COMMIT, now: NOW, needed: ['run-all-tests'] }), {}, 'over 12 hours old');
  assert.deepEqual(Object.keys(reusableChecks(entries, { commit: COMMIT, now: NOW, needed: ['run-all-tests'] })), ['run-all-tests'], 'only what is needed');
  // a check reused once and reused again keeps where it first came from and its first finish time
  const second = goodManifest({ finishedAt: at(1) });
  second.checks['run-all-tests'] = { ...r['run-all-tests'] };
  const again = reusableChecks([{ file: 'second.json', manifest: second }], { commit: COMMIT, now: NOW, needed: ['run-all-tests'] });
  assert.equal(again['run-all-tests'].reused.from, 'beta.json');
  assert.equal(again['run-all-tests'].finishedAt, at(2.5));
  assert.deepEqual([...SOURCE_CHECKS], ['run-all-tests', 'layout-parity', 'extreme-documents']);
});

test('manifest files: one per kind of build; a beta or Plus deploy falls back to an older shared file', async () => {
  const dir = path.join(TMP, 'kinds');
  assert.deepEqual([kindOf({}), kindOf({ beta: true }), kindOf({ plus: true })], ['', 'beta', 'plus']);
  assert.equal(path.basename(evidenceFile(dir, COMMIT, false, 'plus')), `${COMMIT}.plus.json`);
  assert.equal(path.basename(evidenceFile(dir, COMMIT, true, 'beta')), `${COMMIT}.beta.partial.json`);
  const legacyBeta = goodManifest({ options: { beta: true }, build: { ...goodManifest().build, beta: true } });
  legacyBeta.options = { beta: false };   // written as <commit>.json, as every run was before per-kind files
  await writeManifest(dir, legacyBeta);
  assert.equal((await readManifest(dir, COMMIT, 'beta')).build.beta, true, 'no .beta.json yet: the shared file is read');
  const plus = goodManifest({ options: { plus: true }, build: { ...goodManifest().build, plus: true } });
  assert.equal(path.basename(await writeManifest(dir, plus)), `${COMMIT}.plus.json`);
  assert.equal((await readManifest(dir, COMMIT, 'plus')).build.plus, true);
  assert.equal((await readManifest(dir, COMMIT)).build.plus, undefined, 'the Plus run left the shared file alone');
  const all = await readAllManifests(dir, COMMIT);
  assert.deepEqual(all.map((e) => e.file).sort(), [`${COMMIT}.json`, `${COMMIT}.plus.json`]);
});

test('releaseGate: a Plus deploy reads the Plus file and says how long a Plus check takes', async () => {
  const dir = path.join(TMP, 'gate-plus');
  process.env.EMBOSS_RELEASE_EVIDENCE_DIR = dir;
  try {
    const text = (g) => g.lines.map((l) => l.text).join('\n');
    const none = await releaseGate({ root: ROOT, commit: COMMIT, now: NOW, plus: true });
    assert.equal(none.proceed, false);
    assert.match(text(none), /release-check\.mjs aaaaaaaa --plus +\(about 5-10 minutes/);
    const m = goodManifest({ finishedAt: new Date(NOW - 3600e3).toISOString(), options: { plus: true }, build: { ...goodManifest().build, plus: true } });
    delete m.checks['layout-parity']; delete m.checks['extreme-documents'];
    m.checks['run-all-tests'].reused = { from: `${COMMIT}.beta.json`, finishedAt: m.finishedAt };
    await writeManifest(dir, m);
    const ok = await releaseGate({ root: ROOT, commit: COMMIT, now: NOW, plus: true });
    assert.equal(ok.proceed, true, text(ok));
    assert.match(text(ok), /run-all-tests reused from an earlier run/);
    assert.equal((await releaseGate({ root: ROOT, commit: COMMIT, now: NOW })).proceed, false, 'Plus evidence never serves a public deploy');
  } finally { delete process.env.EMBOSS_RELEASE_EVIDENCE_DIR; }
});
