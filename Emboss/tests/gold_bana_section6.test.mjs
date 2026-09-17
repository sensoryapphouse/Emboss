// Regression guard for the BANA Braille Formats 2016 §6 (Illustrative Materials) gold
// examples (standards-testing.md, stage 4-5). Runs Emboss/scripts/gold-run.mjs in-process
// against every gold file in tests/gold/bana-formats-2016/section-6/*.json and checks the
// result against tests/gold/bana-formats-2016/section-6/status.json:
//
//  - every sample status.json calls "match" must still match today
//    (a silent regression on a previously-working sample fails the test);
//  - no sample status.json calls "mismatch"/"not-representable"/"no-braille" may have
//    started matching without status.json being updated to say so (a fix must record
//    itself — status.json is produced by
//    `node Emboss/scripts/gold-run.mjs --section section-6 --update-status`,
//    never hand-edited).
//
// This file does not itself decide what "should" match — status.json is the current
// recorded truth, produced by the runner. Re-run gold-run.mjs (optionally --update-status)
// whenever Emboss's image/note/list/table/box formatting changes, and update
// standards-findings.md/standards-map.md for anything that newly matches or newly breaks.
// See tests/gold/bana-formats-2016/section-6/README.md for how the gold files were built
// (two independent transcription runs of the same underlying model, reconciled against the
// primary source text and PDF page images — never against each other) and what this
// section's own known, documented mismatches are (standards-findings.md F-168 through F-171,
// F-222, and F-225; the book's own "444" excerpt-truncation marker appearing throughout this
// section's own worked examples has no print-side input to build from — an expected,
// documented limitation, not an Emboss defect).
//
// gold-run.mjs resolves which section to run from `--section` on argv, or (for exactly this
// use — a test file that runs with no CLI args) the GOLD_RUN_SECTION env var, read at import
// time; it must be set BEFORE the module is evaluated, hence the dynamic import below rather
// than a static top-of-file one (a static import is hoisted and would run before this line).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.GOLD_RUN_SECTION = 'section-6';
const { loadSamples, runOne, STATUS_FILE } = await import('../scripts/gold-run.mjs');

const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
const samples = loadSamples();

test('status.json has an entry for every gold §6 sample', () => {
  const ids = samples.map((s) => s.sample.id);
  assert.deepEqual(Object.keys(status).sort(), [...ids].sort());
});

for (const { sample } of samples) {
  test(`gold §6 ${sample.id}: matches iff status.json says it should`, () => {
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
      // it (`node Emboss/scripts/gold-run.mjs --section section-6 --sample ${sample.id} --update-status`).
      assert.notEqual(result.status, 'match',
        `${sample.id} now matches but status.json still records "${recorded.status}" — ` +
        `re-run gold-run.mjs --update-status and record the fix in standards-findings.md.`);
      assert.equal(result.status, recorded.status,
        `${sample.id}'s status changed from "${recorded.status}" to "${result.status}" — ` +
        `re-run gold-run.mjs --update-status and record why in standards-findings.md.`);
    }
  });
}
