// Regression guard for the BANA Braille Formats 2016 §13 (Poetry and Song Lyrics) AND UKAAF
// B004 Appendix J (Poetry) gold examples (standards-testing.md, stage 4-5). Runs
// Emboss/scripts/gold-run.mjs in-process against every gold file in both
// tests/gold/bana-formats-2016/section-13/*.json and
// tests/gold/ukaaf-b004/appendix-j/*.json, and checks each result against that section's own
// status.json:
//
//  - every sample status.json calls "match" must still match today
//    (a silent regression on a previously-working sample fails the test);
//  - no sample status.json calls "mismatch"/"not-representable"/"no-braille"
//    may have started matching without status.json being updated to say so (a
//    fix must record itself — status.json is produced by
//    `node Emboss/scripts/gold-run.mjs --section <name> --update-status`,
//    never hand-edited).
//
// This file does not itself decide what "should" match — each section's own status.json is
// the current recorded truth, produced by the runner. Re-run gold-run.mjs (optionally
// --update-status) whenever Emboss's poem/verse formatting changes, and update
// standards-findings.md/standards-map.md for anything that newly matches or newly breaks. See
// tests/gold/bana-formats-2016/section-13/README.md and
// tests/gold/ukaaf-b004/appendix-j/README.md (how the gold files were built, and what each
// section's known, documented mismatches/limitations are — F-P1 through F-P10, merged into
// standards-findings.md from assess-13/poetry-writeup.md) and this reconciliation's own
// differences.md (kept in the session's scratch folder per the task instructions, not in the
// repository).
//
// gold-run.mjs resolves which section to run from `--section` on argv, or (for exactly this
// use — a test file that runs with no CLI args) the GOLD_RUN_SECTION env var, read at import
// time; it must be set BEFORE the module is evaluated. Because gold-run.mjs is a single module
// whose SECTION (and derived GOLD_DIR/OPTS) are fixed at import time, this file dynamically
// imports it TWICE under two different `import(...)` specifiers (a `?section=` query suffix,
// ignored by Node's resolution but sufficient to force a fresh module instance per section) so
// the two sections' own GOLD_RUN_SECTION values don't collide within one process — matching
// gold_bana_section16.test.mjs's own precedent exactly (BANA §16 + UKAAF B004 §11).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

async function loadSection(sectionId, cacheBust) {
  process.env.GOLD_RUN_SECTION = sectionId;
  const mod = await import(`../scripts/gold-run.mjs?${cacheBust}`);
  return mod;
}

const SECTIONS = [
  { id: 'section-13', label: 'BANA §13' },
  { id: 'b004-appendix-j', label: 'UKAAF B004 Appendix J' },
];

for (const { id: sectionId, label } of SECTIONS) {
  const { loadSamples, runOne, STATUS_FILE } = await loadSection(sectionId, sectionId);
  const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  const samples = loadSamples();

  test(`status.json has an entry for every gold ${label} sample`, () => {
    const ids = samples.map((s) => s.sample.id);
    assert.deepEqual(Object.keys(status).sort(), [...ids].sort());
  });

  for (const { sample } of samples) {
    test(`gold ${label} ${sample.id}: matches iff status.json says it should`, () => {
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
        // it (`node Emboss/scripts/gold-run.mjs --section ${sectionId} --sample ${sample.id} --update-status`).
        assert.notEqual(result.status, 'match',
          `${sample.id} now matches but status.json still records "${recorded.status}" — ` +
          `re-run gold-run.mjs --update-status and record the fix in standards-findings.md.`);
        assert.equal(result.status, recorded.status,
          `${sample.id}'s status changed from "${recorded.status}" to "${result.status}" — ` +
          `re-run gold-run.mjs --update-status and record why in standards-findings.md.`);
      }
    });
  }
}
