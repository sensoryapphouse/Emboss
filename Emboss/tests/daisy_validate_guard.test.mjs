// A50 — the DAISY validator (Emboss/scripts/daisy-validate.mjs) used to be able to answer
// "alive" while the engine's job database was corrupted, print nothing at all for every file,
// and exit 0 — read by two agents on 23 Sep as "the validator is just busy". This tests the
// guard logic added to fix that: the engine-health check, "no report" detection, the per-job
// timeout, the concurrency limit, and the run-to-run lock — all as small pure/DI'd functions,
// so none of this needs a real DAISY Pipeline engine. What still needs a live engine (the real
// HTTP polling in pollJob/runJob, and an actual wedged-database repro) is exercised by hand
// instead — see the task's final report.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateJobsHealth,
  checkEngineJobsHealthy,
  describeMissingReport,
  hasTimedOut,
  resolveTimeoutMs,
  parseEngineJobLimit,
  readEngineJobLimit,
  mapWithConcurrency,
  isPidAlive,
  acquireLock,
  releaseLock,
  DEFAULT_JOB_TIMEOUT_MS,
} from '../scripts/daisy-validate.mjs';

describe('A50: engine health check (evaluateJobsHealth / checkEngineJobsHealthy)', () => {
  test('HTTP 200 with a <jobs> root is healthy', () => {
    const r = evaluateJobsHealth(200, '<?xml version="1.0"?><jobs xmlns="http://www.daisy.org/ns/pipeline/data" href="http://localhost:8181/ws/jobs"/>');
    assert.equal(r.healthy, true);
    assert.equal(r.reason, null);
  });

  test('HTTP 200 with a namespace-prefixed <ns:jobs> root is healthy', () => {
    const r = evaluateJobsHealth(200, '<pipeline:jobs xmlns:pipeline="http://www.daisy.org/ns/pipeline/data"><pipeline:job id="1"/></pipeline:jobs>');
    assert.equal(r.healthy, true);
  });

  test('HTTP 500 (the corrupted-database symptom) is unhealthy, and says so', () => {
    const r = evaluateJobsHealth(500, 'Internal Server Error');
    assert.equal(r.healthy, false);
    assert.match(r.reason, /HTTP 500/);
  });

  test('HTTP 200 with a body that is not a job list is unhealthy', () => {
    const r = evaluateJobsHealth(200, '<html><body>not the pipeline</body></html>');
    assert.equal(r.healthy, false);
    assert.match(r.reason, /not a job list/);
  });

  test('checkEngineJobsHealthy healthy path uses the injected fetch and reports healthy', async () => {
    const fakeFetch = async (url) => {
      assert.equal(url, 'http://example.invalid/ws/jobs');
      return { status: 200, text: async () => '<jobs xmlns="http://www.daisy.org/ns/pipeline/data"/>' };
    };
    const r = await checkEngineJobsHealthy('http://example.invalid/ws/jobs', fakeFetch);
    assert.equal(r.healthy, true);
  });

  test('checkEngineJobsHealthy reports unhealthy on an HTTP error status', async () => {
    const fakeFetch = async () => ({ status: 500, text: async () => 'boom' });
    const r = await checkEngineJobsHealthy('http://example.invalid/ws/jobs', fakeFetch);
    assert.equal(r.healthy, false);
    assert.match(r.reason, /HTTP 500/);
  });

  test('checkEngineJobsHealthy reports unhealthy when the request itself fails (engine unreachable)', async () => {
    const fakeFetch = async () => { throw new Error('connect ECONNREFUSED'); };
    const r = await checkEngineJobsHealthy('http://example.invalid/ws/jobs', fakeFetch);
    assert.equal(r.healthy, false);
    assert.match(r.reason, /ECONNREFUSED/);
  });
});

describe('A50: "no report" detection (describeMissingReport)', () => {
  test('a job with a non-empty report is not flagged', () => {
    assert.equal(describeMissingReport({ status: 'SUCCESS', report: '<d:document-validation-report/>' }), null);
  });

  test('a job with an empty-string report is flagged, naming the status', () => {
    const msg = describeMissingReport({ status: 'SUCCESS', report: '' });
    assert.match(msg, /no validation report/);
    assert.match(msg, /SUCCESS/);
  });

  test('a job with a whitespace-only report is flagged', () => {
    assert.match(describeMissingReport({ status: 'FAIL', report: '   \n  ' }), /no validation report/);
  });

  test('a job with no status at all still gets a clear (UNKNOWN) message, never silently passes', () => {
    const msg = describeMissingReport({ report: '' });
    assert.match(msg, /UNKNOWN/);
  });

  test('an entirely missing job object is flagged', () => {
    assert.match(describeMissingReport(null), /no result was returned/);
  });
});

describe('A50: per-job timeout (hasTimedOut / resolveTimeoutMs)', () => {
  test('hasTimedOut is false before the limit and true at/after it', () => {
    assert.equal(hasTimedOut(1000, 1999, 1000), false);
    assert.equal(hasTimedOut(1000, 2000, 1000), true);
    assert.equal(hasTimedOut(1000, 5000, 1000), true);
  });

  test('resolveTimeoutMs defaults to DEFAULT_JOB_TIMEOUT_MS (10 minutes) when nothing is set', () => {
    assert.equal(resolveTimeoutMs({}), DEFAULT_JOB_TIMEOUT_MS);
    assert.equal(DEFAULT_JOB_TIMEOUT_MS, 600_000);
  });

  test('resolveTimeoutMs prefers the flag over the env var', () => {
    assert.equal(resolveTimeoutMs({ flagValue: '5000', envValue: '9000' }), 5000);
  });

  test('resolveTimeoutMs falls back to the env var when there is no flag', () => {
    assert.equal(resolveTimeoutMs({ envValue: '9000' }), 9000);
  });

  test('resolveTimeoutMs ignores a non-numeric or non-positive flag/env and falls through', () => {
    assert.equal(resolveTimeoutMs({ flagValue: 'soon', envValue: '9000' }), 9000);
    assert.equal(resolveTimeoutMs({ flagValue: '-5', envValue: '0' }), DEFAULT_JOB_TIMEOUT_MS);
  });
});

describe('A50: engine concurrency limit (parseEngineJobLimit / readEngineJobLimit)', () => {
  test('parses an uncommented org.daisy.pipeline.procs=N', () => {
    assert.equal(parseEngineJobLimit('org.daisy.pipeline.procs=4\n'), 4);
  });

  test('a commented-out line (the shipped default) falls back to 2', () => {
    assert.equal(parseEngineJobLimit('## Maximum allowed number of jobs running simultaneously (default "2")\n#org.daisy.pipeline.procs=2\n'), 2);
  });

  test('missing text or missing property falls back to the given default', () => {
    assert.equal(parseEngineJobLimit(undefined, 3), 3);
    assert.equal(parseEngineJobLimit('org.daisy.pipeline.ws.port=8181\n'), 2);
  });

  test('a non-numeric or zero value falls back rather than disabling concurrency', () => {
    assert.equal(parseEngineJobLimit('org.daisy.pipeline.procs=0\n'), 2);
  });

  test('readEngineJobLimit reads via the injected readFile', () => {
    const n = readEngineJobLimit('/fake/engine/home', { readFile: (p) => {
      assert.equal(p, path.join('/fake/engine/home', 'etc', 'pipeline.properties'));
      return 'org.daisy.pipeline.procs=5\n';
    } });
    assert.equal(n, 5);
  });

  test('readEngineJobLimit falls back to the default if the file cannot be read', () => {
    const n = readEngineJobLimit('/fake/engine/home', { readFile: () => { throw new Error('ENOENT'); } });
    assert.equal(n, 2);
  });

  test('readEngineJobLimit falls back to the default with no engine home at all', () => {
    assert.equal(readEngineJobLimit(null), 2);
  });
});

describe('A50: queue limit in practice (mapWithConcurrency)', () => {
  test('never runs more than `limit` workers at once, and preserves input order in the results', async () => {
    const items = [1, 2, 3, 4, 5];
    let running = 0;
    let maxRunning = 0;
    const order = [1, 2, 3, 4, 5].reverse(); // finish in reverse order of submission
    const worker = async (item) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      // items finish out of submission order, to prove result ordering doesn't depend on it
      await new Promise((r) => setTimeout(r, order.indexOf(item) * 5 + 1));
      running--;
      return item * 10;
    };
    const results = await mapWithConcurrency(items, 2, worker);
    assert.ok(maxRunning <= 2, `at most 2 workers should run at once, saw ${maxRunning}`);
    assert.deepEqual(results, [10, 20, 30, 40, 50]);
  });

  test('a limit larger than the item count is clamped, not over-scheduled', async () => {
    let concurrent = 0, maxConcurrent = 0;
    const worker = async (x) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 1));
      concurrent--;
      return x;
    };
    const results = await mapWithConcurrency([1, 2], 10, worker);
    assert.equal(maxConcurrent, 2);
    assert.deepEqual(results, [1, 2]);
  });

  test('an empty item list resolves immediately with an empty result array', async () => {
    let called = false;
    const results = await mapWithConcurrency([], 2, async () => { called = true; });
    assert.deepEqual(results, []);
    assert.equal(called, false);
  });
});

describe('A50: lock so two runs do not collide (acquireLock / releaseLock / isPidAlive)', () => {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daisy-validate-lock-test-'));
  let n = 0;
  const freshLockPath = () => path.join(lockDir, `lock-${n++}.pid`);

  test('isPidAlive is true for this process itself', () => {
    assert.equal(isPidAlive(process.pid), true);
  });

  test('isPidAlive is false for a bogus/unassigned pid', () => {
    assert.equal(isPidAlive(999999), false);
  });

  test('a fresh path is acquired cleanly', () => {
    const p = freshLockPath();
    const r = acquireLock(p);
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(p, 'utf8'), String(process.pid));
  });

  test('a lock held by a still-running process is refused with its pid', () => {
    const p = freshLockPath();
    fs.writeFileSync(p, '4242');
    const r = acquireLock(p, { isAlive: (pid) => { assert.equal(pid, 4242); return true; } });
    assert.equal(r.ok, false);
    assert.equal(r.holderPid, 4242);
  });

  test('a lock held by a pid that is gone is stolen', () => {
    const p = freshLockPath();
    fs.writeFileSync(p, '4242');
    const r = acquireLock(p, { pid: 7777, isAlive: () => false });
    assert.equal(r.ok, true);
    assert.equal(r.stoleFrom, 4242);
    assert.equal(fs.readFileSync(p, 'utf8'), '7777');
  });

  test('releaseLock removes the file only when it still holds our own pid', () => {
    const p = freshLockPath();
    fs.writeFileSync(p, String(process.pid));
    releaseLock(p);
    assert.equal(fs.existsSync(p), false);
  });

  test('releaseLock leaves a lock alone if it belongs to someone else (e.g. it was stolen from us)', () => {
    const p = freshLockPath();
    fs.writeFileSync(p, '424242');
    releaseLock(p, { pid: process.pid });
    assert.equal(fs.existsSync(p), true);
    fs.unlinkSync(p);
  });

  test('releaseLock on a lock path that does not exist is a no-op, not a crash', () => {
    assert.doesNotThrow(() => releaseLock(freshLockPath()));
  });
});
