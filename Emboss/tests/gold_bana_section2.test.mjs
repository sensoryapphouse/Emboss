// Regression guard for the BANA Braille Formats 2016 §2 (Transcriber-Generated Pages
// and Front Matter) gold examples. Runs Emboss/scripts/gold-run.mjs in-process against
// every file in tests/gold/bana-formats-2016/section-2/*.json.
//
//  - If section-2/status.json exists (written by
//    `node Emboss/scripts/gold-run.mjs --section section-2 --update-status`), the same rules
//    as gold_bana_section4.test.mjs apply: a recorded "match" must still match; anything
//    else must not have silently changed status.
//  - Until a status.json is recorded, the baseline is: every sample with braille is
//    "not-representable" (the §2 gold has no print model and Emboss has no title / second
//    title / Special Symbols / Transcriber's Notes / t- and p-page-number features yet,
//    see Emboss/docs/transcriber-pages-plan.md), and every sample with no braille lines
//    is "no-braille". A sample that starts to match (or turns into a plain mismatch) fails
//    until status.json is updated to record it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.GOLD_RUN_SECTION = 'section-2';
const { loadSamples, runOne, STATUS_FILE } = await import('../scripts/gold-run.mjs');

const samples = loadSamples();
const status = fs.existsSync(STATUS_FILE) ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) : null;

test('gold §2 has 48 samples', () => {
  assert.equal(samples.length, 48);
});

if (status) {
  test('status.json has an entry for every gold §2 sample', () => {
    assert.deepEqual(Object.keys(status).sort(), samples.map((s) => s.sample.id).sort());
  });
}

for (const { sample } of samples) {
  test(`gold §2 ${sample.id}: status is the recorded one`, () => {
    const result = runOne(sample);
    const hasBraille = sample.braille && Array.isArray(sample.braille.lines) && sample.braille.lines.length > 0;
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
      const expected = hasBraille ? 'not-representable' : 'no-braille';
      assert.equal(result.status, expected,
        `${sample.id}: expected baseline "${expected}", got "${result.status}". ${result.diagnosis}`);
    }
    if (result.status === 'not-representable') {
      assert.ok(result.model.limitations.length > 0, `${sample.id}: not-representable needs a stated reason`);
    }
  });
}
