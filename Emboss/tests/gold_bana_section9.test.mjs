// Regression guard for the BANA Braille Formats 2016 §9 (Displayed Material,
// Attributions, and Source Information) gold examples (standards-testing.md,
// stage 4-5). Runs Emboss/scripts/gold-run.mjs in-process against every gold file
// in tests/gold/bana-formats-2016/section-9/*.json and checks the result against
// tests/gold/bana-formats-2016/section-9/status.json:
//
//  - every sample status.json calls "match" must still match today (a silent
//    regression on a previously-working sample fails the test);
//  - no sample status.json calls "mismatch"/"not-representable"/"no-braille" may
//    have started matching without status.json being updated to say so (a fix
//    must record itself — status.json is produced by
//    `node Emboss/scripts/gold-run.mjs --section section-9 --update-status`,
//    never hand-edited).
//
// This file does not itself decide what "should" match — status.json is the
// current recorded truth, produced by the runner. Re-run gold-run.mjs
// (optionally --update-status) whenever Emboss's displayed-material/attribution/
// source-citation formatting changes, and update standards-findings.md/
// standards-map.md for anything that newly matches or newly breaks. See
// tests/gold/bana-formats-2016/section-9/README.md and differences.md (this
// reconciliation's own working notes, in scratch) for how the gold files were
// built and what this section's known, documented mismatches are:
// standards-findings.md F-78 through F-81 (new, found by this reconciliation),
// plus F-D1 through F-D13 (displayed-writeup.md, not yet merged into
// standards-findings.md — cited by those ids in differences.md), F-36 (section-8's
// blank-fill gap, reused for sample-9-04's answer chart), and F-D6/F-D9's
// pre-existing word-list/source-citation-style gaps — plus a plain-paragraph
// margin difference (this gold corpus's own worked examples use BANA's "block"
// paragraph style; this whole runner's shared OPTS defaults to "indented") that
// is a harness/measurement artifact, not a standards violation.
//
// gold-run.mjs resolves which section to run from `--section` on argv, or (for
// exactly this use — a test file that runs with no CLI args) the
// GOLD_RUN_SECTION env var, read at import time; it must be set BEFORE the
// module is evaluated, hence the dynamic import below rather than a static
// top-of-file one (a static import is hoisted and would run before this line).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.GOLD_RUN_SECTION = 'section-9';
const { loadSamples, runOne, STATUS_FILE } = await import('../scripts/gold-run.mjs');

const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
const samples = loadSamples();

test('status.json has an entry for every gold §9 sample', () => {
  const ids = samples.map((s) => s.sample.id);
  assert.deepEqual(Object.keys(status).sort(), [...ids].sort());
});

for (const { sample } of samples) {
  test(`gold §9 ${sample.id}: matches iff status.json says it should`, () => {
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
      // it (`node Emboss/scripts/gold-run.mjs --section section-9 --sample ${sample.id} --update-status`).
      assert.notEqual(result.status, 'match',
        `${sample.id} now matches but status.json still records "${recorded.status}" — ` +
        `re-run gold-run.mjs --update-status and record the fix in standards-findings.md.`);
      assert.equal(result.status, recorded.status,
        `${sample.id}'s status changed from "${recorded.status}" to "${result.status}" — ` +
        `re-run gold-run.mjs --update-status and record why in standards-findings.md.`);
    }
  });
}
