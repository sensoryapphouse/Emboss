// The public Emboss repository, github.com/sensoryapphouse/Emboss, follows the public beta (Paul, 18 Oct 2026: "make the deploy run
// it"; it had been left a month behind when publishing was a separate step). deploy.mjs calls these after a beta deploy has been
// uploaded and tagged; publish-emboss.sh (repo root) does the publishing: a curated copy of the deployed commit, committed and pushed
// to the mirror clone at ../Emboss. Tests: tests/publish_mirror.test.mjs.
import { execFileSync } from 'child_process';
import path from 'path';

// Only a beta deploy publishes: the beta is the public site, so its code is the public code. Plus (the full build), previews,
// dry runs and --check-release-only never do; --no-publish skips it.
export function shouldPublishMirror({ beta, plus, preview, dryRun, checkReleaseOnly, noPublish }) {
  return !!beta && !plus && preview == null && !dryRun && !checkReleaseOnly && !noPublish;
}

// The command that publishes `commit`. It pushes as the sensoryapphouse GitHub account, as deploy's own push command does (the
// default credential cannot see the private repository); the token itself is added by publishMirror, not here.
export function publishCommand({ root, commit }) {
  return {
    cmd: 'bash',
    args: [path.join(root, 'publish-emboss.sh'), '--push', '--commit', commit],
    env: { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '', GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '!gh auth git-credential' },
  };
}

// Runs it. Resolves true when it published (or nothing had changed), false when it failed; the deploy is live either way, so a
// failure is reported, not thrown.
export function publishMirror({ root, commit, log = console.log, warn = console.error }) {
  const c = publishCommand({ root, commit });
  let token = '';
  try { token = execFileSync('gh', ['auth', 'token', '--user', 'sensoryapphouse'], { encoding: 'utf8' }).trim(); } catch { /* the push will say */ }
  try {
    log(`deploy: publishing ${commit.slice(0, 8)} to the public repository github.com/sensoryapphouse/Emboss…`);
    execFileSync(c.cmd, c.args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...c.env, ...(token ? { GH_TOKEN: token } : {}) } });
    return true;
  } catch (e) {
    warn(`deploy: *** WARNING: the deploy is live, but publishing to github.com/sensoryapphouse/Emboss failed (${e.message.split('\n')[0]}). Publish it with:`);
    warn(`    GH_TOKEN=$(gh auth token --user sensoryapphouse) GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1='!gh auth git-credential' bash publish-emboss.sh --push --commit ${commit}`);
    return false;
  }
}
