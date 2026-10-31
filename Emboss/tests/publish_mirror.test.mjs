// The public Emboss repository (github.com/sensoryapphouse/Emboss) follows the public beta (Paul, 18 Oct 2026: "make the deploy run
// it"). It had been left a month behind because publishing was a separate step. A beta deploy (the public site) now publishes the
// deployed commit to it with publish-emboss.sh; Plus deploys, previews, dry runs and --check-release-only do not, and --no-publish
// skips it. Also checked: the publish script publishes the commit it is given, not whatever is checked out.
// Nothing here deploys or pushes: the decision is a pure function, and the script is read, not run.
// Written first: before this change there is no lib/publish-mirror.mjs, so every test below fails on the import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldPublishMirror, publishCommand } from '../scripts/lib/publish-mirror.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = { beta: false, plus: false, preview: null, dryRun: false, checkReleaseOnly: false, noPublish: false };

test('a beta deploy publishes the public repository', () => {
  assert.equal(shouldPublishMirror({ ...base, beta: true }), true);
});

test('Plus, previews, dry runs, --check-release-only and --no-publish do not', () => {
  assert.equal(shouldPublishMirror({ ...base, plus: true }), false);
  assert.equal(shouldPublishMirror({ ...base, beta: true, preview: 'relaxed-braille' }), false);
  assert.equal(shouldPublishMirror({ ...base, preview: 'relaxed-braille' }), false);
  assert.equal(shouldPublishMirror({ ...base, beta: true, dryRun: true }), false);
  assert.equal(shouldPublishMirror({ ...base, beta: true, checkReleaseOnly: true }), false);
  assert.equal(shouldPublishMirror({ ...base, beta: true, noPublish: true }), false);
});

test('a non-beta deploy to the public site (no --beta, no --plus) does not publish either: only the beta is the public build', () => {
  assert.equal(shouldPublishMirror({ ...base }), false);
});

test('the command publishes exactly the deployed commit, pushing as the sensoryapphouse account', () => {
  const c = publishCommand({ root: ROOT, commit: 'd30508d90884155c518766bf562c1aea3944e3c0' });
  assert.equal(c.cmd, 'bash');
  assert.deepEqual(c.args, [path.join(ROOT, 'publish-emboss.sh'), '--push', '--commit', 'd30508d90884155c518766bf562c1aea3944e3c0']);
  assert.equal(c.env.GIT_CONFIG_COUNT, '2');
  assert.equal(c.env.GIT_CONFIG_VALUE_1, '!gh auth git-credential');
});

test('publish-emboss.sh archives the commit it is given (--commit), HEAD only when none is given', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'publish-emboss.sh'), 'utf8');
  assert.match(sh, /--commit\)/);
  assert.match(sh, /git archive "\$COMMIT"/);
  assert.doesNotMatch(sh, /git archive HEAD\b/);
});
