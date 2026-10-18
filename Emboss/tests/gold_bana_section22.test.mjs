// Regression guard for the BANA Braille Formats 2016 §22 (Bibliographies) gold examples. Runs
// Emboss/scripts/gold-run.mjs in-process against every file in
// tests/gold/bana-formats-2016/section-22/*.json.
//
//  - If section-22/status.json exists (written by
//    `node Emboss/scripts/gold-run.mjs --section section-22 --update-status`), the same rules as
//    gold_bana_section2.test.mjs apply: a recorded "match" must still match; anything else must
//    not have silently changed status.
//  - Until a status.json is recorded, the baseline below (the status each example had when the
//    builder was written; see Emboss/docs/wip/gold-diagnosis-section-20-22.md) is used: an example
//    that starts to match, or changes status, fails until status.json is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.GOLD_RUN_SECTION = 'section-22';
const { loadSamples, runOne, STATUS_FILE } = await import('../scripts/gold-run.mjs');

const BASELINE = {
  'example-22-1': 'match',
  'example-22-2': 'mismatch',
  'example-22-3': 'mismatch',
  'example-22-4': 'mismatch'
};

const samples = loadSamples();
const status = fs.existsSync(STATUS_FILE) ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) : null;

test('gold §22 has 4 samples', () => {
  assert.equal(samples.length, 4);
});

if (status) {
  test('status.json has an entry for every gold §22 sample', () => {
    assert.deepEqual(Object.keys(status).sort(), samples.map((s) => s.sample.id).sort());
  });
}

for (const { sample } of samples) {
  test(`gold §22 ${sample.id}: status is the recorded one`, () => {
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
