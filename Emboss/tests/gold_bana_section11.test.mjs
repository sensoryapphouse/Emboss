// Regression guard for the BANA Braille Formats 2016 §11 gold examples
// (standards-testing.md, stage 4-5). Runs Emboss/scripts/gold-run.mjs
// in-process against every gold file in
// tests/gold/bana-formats-2016/section-11/*.json and checks the result
// against tests/gold/bana-formats-2016/section-11/status.json:
//
//  - every sample status.json calls "match" must still match today
//    (a silent regression on a previously-working sample fails the test);
//  - no sample status.json calls "mismatch" or "not-representable" may have
//    started matching without status.json being updated to say so (a fix
//    must record itself — status.json is produced by
//    `node Emboss/scripts/gold-run.mjs --update-status`, never hand-edited).
//
// This file does not itself decide what "should" match — status.json is the
// current recorded truth, produced by the runner. Re-run gold-run.mjs
// (optionally --update-status) whenever Emboss's table/box formatting
// changes, and update standards-findings.md/standards-map.md for anything
// that newly matches or newly breaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSamples, runOne, STATUS_FILE } from '../scripts/gold-run.mjs';

const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
const samples = loadSamples();

test('status.json has an entry for every gold §11 sample', () => {
  const ids = samples.map((s) => s.sample.id);
  assert.deepEqual(Object.keys(status).sort(), [...ids].sort());
});

for (const { sample } of samples) {
  test(`gold §11 ${sample.id}: matches iff status.json says it should`, () => {
    const recorded = status[sample.id];
    assert.ok(recorded, `${sample.id} has no status.json entry`);
    const result = runOne(sample);
    if (recorded.status === 'match') {
      assert.equal(result.status, 'match',
        `${sample.id} was recorded as "match" in status.json but no longer matches — ` +
        `regression. ${result.diagnosis}`);
    } else {
      // A recorded mismatch/not-representable/no-braille must not have
      // silently started matching: that would mean Emboss changed behaviour
      // (for better or worse) without status.json being updated to record
      // it (`node Emboss/scripts/gold-run.mjs --sample ${sample.id} --update-status`).
      assert.notEqual(result.status, 'match',
        `${sample.id} now matches but status.json still records "${recorded.status}" — ` +
        `re-run gold-run.mjs --update-status and record the fix in standards-findings.md.`);
      assert.equal(result.status, recorded.status,
        `${sample.id}'s status changed from "${recorded.status}" to "${result.status}" — ` +
        `re-run gold-run.mjs --update-status and record why in standards-findings.md.`);
    }
  });
}
