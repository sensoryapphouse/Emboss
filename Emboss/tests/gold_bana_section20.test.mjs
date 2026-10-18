// Regression guard for the BANA Braille Formats 2016 §20 (Pronunciation) gold examples. Runs
// Emboss/scripts/gold-run.mjs in-process against every file in
// tests/gold/bana-formats-2016/section-20/*.json.
//
//  - If section-20/status.json exists (written by
//    `node Emboss/scripts/gold-run.mjs --section section-20 --update-status`), the same rules as
//    gold_bana_section2.test.mjs apply: a recorded "match" must still match; anything else must
//    not have silently changed status.
//  - Until a status.json is recorded, the baseline below (the status each example had when the
//    builder was written; see Emboss/docs/wip/gold-diagnosis-section-20-22.md) is used: an example
//    that starts to match, or changes status, fails until status.json is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.GOLD_RUN_SECTION = 'section-20';
const { loadSamples, runOne, STATUS_FILE } = await import('../scripts/gold-run.mjs');

const BASELINE = {
  'example-20-1': 'match',
  'example-20-2': 'match',
  'example-20-3': 'match',
  'example-20-4': 'match',
  'example-20-5': 'match',
  'example-20-6': 'match',
  'example-20-7': 'match',
  'example-20-8': 'mismatch',
  'example-20-9': 'not-representable',
  'example-20-10': 'mismatch',
  'example-20-11': 'mismatch',
  'example-20-12': 'mismatch',
  'example-20-13': 'not-representable',
  'example-20-14': 'not-representable',
  'example-20-15': 'not-representable',
  'example-20-16': 'mismatch',
  'example-20-17': 'mismatch',
  'example-20-18': 'mismatch',
  'example-20-19': 'mismatch',
  'example-20-20': 'mismatch',
  'example-20-21': 'mismatch',
  'example-20-22': 'mismatch',
  'example-20-23': 'mismatch',
  'example-20-24': 'mismatch',
  'example-20-25': 'mismatch',
  'example-20-26': 'mismatch',
  'example-20-27': 'not-representable',
  'example-20-28': 'not-representable',
  'example-20-29': 'mismatch',
  'example-20-30': 'mismatch',
  'example-20-31': 'mismatch',
  'sample-20-01': 'no-braille',
  'sample-20-02': 'no-braille',
  'sample-20-03': 'no-braille',
  'sample-20-04': 'not-representable',
  'sample-20-7-3c': 'no-braille'
};

const samples = loadSamples();
const status = fs.existsSync(STATUS_FILE) ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) : null;

test('gold §20 has 36 samples', () => {
  assert.equal(samples.length, 36);
});

if (status) {
  test('status.json has an entry for every gold §20 sample', () => {
    assert.deepEqual(Object.keys(status).sort(), samples.map((s) => s.sample.id).sort());
  });
}

for (const { sample } of samples) {
  test(`gold §20 ${sample.id}: status is the recorded one`, () => {
    const result = runOne(sample);
    if (status) {
      const recorded = status[sample.id];
      assert.ok(recorded, `${sample.id} has no status.json entry`);
      if (recorded.status === 'match') {
        assert.equal(result.status, 'match', `${sample.id} regressed from match. ${result.diagnosis}`);
      } else {
        assert.notEqual(result.status, 'match',
          `${sample.id} now matches but status.json records "${recorded.status}" — update status.json.`);
        assert.equal(result.status, recorded.status,
          `${sample.id} changed from "${recorded.status}" to "${result.status}" — update status.json.`);
      }
    } else {
      const expected = BASELINE[sample.id];
      assert.ok(expected, `${sample.id} has no baseline entry`);
      assert.equal(result.status, expected,
        `${sample.id}: baseline is "${expected}", got "${result.status}". ${result.diagnosis}`);
    }
    if (result.status === 'not-representable') {
      assert.ok(result.model.limitations.length > 0, `${sample.id}: not-representable needs a stated reason`);
    }
  });
}
