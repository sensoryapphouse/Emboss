// Deploy Emboss to Cloudflare Pages from a CLEAN checkout of a committed
// revision — never the working folder (Fable review #3, 26 Sep 2026:
// deploy-emboss.sh used to run `wrangler pages deploy … --commit-dirty=true`
// straight on the working tree, so with several agents mid-edit a deploy
// could ship half-finished code that matched no commit).
//
// Run via ./deploy-emboss.sh (a thin wrapper) — see that file and AGENTS.md's
// "Deploying" section for the day-to-day recipe. Direct use:
//
//   node Emboss/scripts/deploy.mjs [ref] [--dry-run] [--allow-dirty-other] [--beta | --plus] [--preview=NAME]
//                                  [--skip-release-check] [--check-release-only]
//
//   ref                   Commit-ish to deploy (default: HEAD).
//   --dry-run             Do everything except the wrangler upload and the
//                         git tag: build in the scratch worktree, run
//                         check-dist, then report what would have shipped.
//   --beta                A beta build: Transcriber tools and the hardware controls are locked
//                         off and hidden unless a link with ?tools=1 unlocks them on that
//                         computer (feedback 30 Sep item 15, Paul 2 Oct; build-dist.mjs).
//   --plus                Deploy to Emboss Plus, https://emboss-plus.pages.dev (Paul, 16 Oct 2026): a separate Cloudflare
//                         Pages project carrying the FULL build — Transcriber tools and the hardware controls (Ctrl+Shift+\)
//                         available, as without --beta. Never with --beta. Its own tag series, emboss-plus-YYYY-MM-DD-vNNN.
//   --preview=NAME        A PREVIEW deploy, for trying work in progress without touching the beta (Paul, 3 Oct
//                         2026): uploads to Cloudflare Pages' preview branch NAME, served at
//                         https://NAME.emboss-aqx.pages.dev — never the production branch (main, the
//                         public site), and no release tag. NAME: lower-case letters, digits and hyphens,
//                         not "main". Usually with the work's own branch as ref:
//                           ./deploy-emboss.sh relaxed-braille --preview=relaxed-braille
//   --allow-dirty-other   Proceed even though files OUTSIDE the build's own
//                         inputs (Emboss/, Translate/, liblouis/tables) are
//                         uncommitted. Uncommitted changes INSIDE those trees
//                         always abort — see checkWorkingTree() below — this
//                         flag can never waive that, only the "something else
//                         in this monorepo is mid-edit" case.
//
//   --skip-release-check  Deploy a commit WITHOUT valid release-check evidence (S5a, Paul 15 Oct 2026). Without this flag a
//                         deploy of a commit (not a preview) is REFUSED unless `node Emboss/scripts/release-check.mjs <commit>`
//                         (with --beta for a beta deploy, --plus for Plus) has left a passing manifest for exactly that commit
//                         and kind of build, finished no more than 24 hours ago (lib/release-evidence.mjs). Plus needs only
//                         run-all-tests, build-dist and offline-dist; a source check that passed for the commit in another kind
//                         of run in the last 12 hours is reused (Paul, 17 Oct 2026). With it, the deploy goes ahead under a loud warning
//                         that is also written into the release tag. Only with Paul's say-so.
//   --check-release-only  Evaluate that rule for this ref and flags, print the verdict, and exit (0 = a deploy would be
//                         allowed, 1 = refused). Builds nothing, uploads nothing, tags nothing.
//
// A PREVIEW (--preview=NAME) needs no release-check evidence; --dry-run reports the verdict but is never stopped by it.
//
// What it does:
//   0. Checks the release-check evidence for the commit (above).
//   1. Refuses unless the build's own inputs are fully committed (see above).
//   2. Resolves `ref` to a commit and creates a scratch git worktree there —
//      so the build reads ONLY committed history, never the working tree.
//   3. Links the ignored build inputs into that worktree (node_modules,
//      liblouis, MathCAT's pkg-web/pkg-nodejs — see AGENTS.md "Working in
//      your own worktree"; the one helper is lib/worktree-inputs.mjs, shared with release-check.mjs).
//   4. Runs build-dist.mjs (which itself runs check-dist.mjs as its last
//      step — see that file), then checks that dist/ is byte-identical (lib/release-evidence.mjs distDigest) to the
//      dist/ the release check ran its offline test on.
//   5. Deploys dist/ with wrangler, tagging the exact commit and message
//      (never --commit-dirty).
//   6. Tags the commit `emboss-YYYY-MM-DD-vNNN`, removes the scratch
//      worktree, and prints (but does not run) the push command.
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { linkBuildInputs } from './lib/worktree-inputs.mjs';
import { releaseGate, distDigest, digestProblem } from './lib/release-evidence.mjs';

const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EMBOSS_DIR, '..');
const NODE = '/opt/homebrew/bin/node'; // see AGENTS.md: a wrong-architecture node is on PATH at /opt/local/bin
const WRANGLER = path.join(ROOT, 'tools/wrangler/node_modules/wrangler/bin/wrangler.js');
// The two Cloudflare Pages projects: the beta (emboss, served at emboss-aqx) and Emboss Plus (the full build, Paul 16 Oct 2026).
const PROJECTS = {
  emboss: { project: 'emboss', url: 'https://emboss-aqx.pages.dev', tagPrefix: 'emboss' },
  plus: { project: 'emboss-plus', url: 'https://emboss-plus.pages.dev', tagPrefix: 'emboss-plus' },
};

// The directories build-dist.mjs actually reads from (see its resolveSrc):
// Emboss/ by default, plus Translate/ and liblouis/ for the shared modules
// and tables it also copies in. Dirty files here would make the deploy not
// match any commit, so this check is never waivable by any flag.
const BUILD_INPUT_PATHS = ['Emboss', 'Translate', 'liblouis'];

function die(msg) {
  console.error(`deploy: ${msg}`);
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function parseArgs(argv) {
  const out = { ref: 'HEAD', dryRun: false, allowDirtyOther: false, beta: false, plus: false, preview: null, skipReleaseCheck: false, checkReleaseOnly: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--preview=')) out.preview = a.slice('--preview='.length);
    else if (a === '--beta') out.beta = true;   // feedback item 15: a beta build (build-dist.mjs, EMBOSS_BETA=1)
    else if (a === '--plus') out.plus = true;   // Emboss Plus: the full build to emboss-plus.pages.dev (Paul, 16 Oct 2026)
    else if (a === '--allow-dirty-other') out.allowDirtyOther = true;
    else if (a === '--skip-release-check') out.skipReleaseCheck = true;   // S5a: deploy without release-check evidence (loud; Paul's say-so only)
    else if (a === '--check-release-only') out.checkReleaseOnly = true;   // S5a: print the evidence verdict and exit
    else if (!a.startsWith('--')) out.ref = a;
    else die(`unknown flag: ${a}`);
  }
  if (out.preview != null && (!/^[a-z0-9][a-z0-9-]{0,27}$/.test(out.preview) || out.preview === 'main' || out.preview === 'production')) {
    die(`--preview needs a name of lower-case letters, digits and hyphens, and not "main" (got "${out.preview}")`);
  }
  if (out.plus && out.beta) die('--plus is the full build: it cannot also be --beta');
  return out;
}

// Refuse if the build's own inputs aren't committed; warn (and by default
// abort — override with --allow-dirty-other) if something else in this
// monorepo is mid-edit; warn if the branch looks like it won't push cleanly.
function checkWorkingTree(allowDirtyOther) {
  const dirtyBuildInputs = git(['status', '--porcelain', '--', ...BUILD_INPUT_PATHS])
    .split('\n').filter(Boolean);
  if (dirtyBuildInputs.length) {
    console.error('deploy: uncommitted changes in the build\'s own inputs — this would deploy something that matches no commit:');
    for (const line of dirtyBuildInputs) console.error('  ' + line);
    die('commit or stash them first (see AGENTS.md — never run this over a dirty tree).');
  }

  const dirtyOther = git(['status', '--porcelain', '--', '.', ...BUILD_INPUT_PATHS.map((p) => `:!${p}`)])
    .split('\n').filter(Boolean);
  if (dirtyOther.length && !allowDirtyOther) {
    console.error('deploy: uncommitted changes elsewhere in the repo (outside Emboss/Translate/liblouis):');
    for (const line of dirtyOther.slice(0, 20)) console.error('  ' + line);
    if (dirtyOther.length > 20) console.error(`  … and ${dirtyOther.length - 20} more`);
    die('these do not affect the Emboss build, but a deploy while other work is mid-edit wants a deliberate decision — re-run with --allow-dirty-other once you\'ve checked.');
  } else if (dirtyOther.length) {
    console.log(`deploy: --allow-dirty-other: proceeding with ${dirtyOther.length} uncommitted change(s) elsewhere in the repo (not part of this build).`);
  }

  // "pushed-able": informational only — the push itself is left to the
  // printed command at the end, so a real conflict surfaces there, not here.
  try {
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    const [ahead, behind] = git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).split(/\s+/);
    if (Number(behind) > 0) console.log(`deploy: note — HEAD is ${behind} commit(s) behind ${upstream}; a later push may need a merge/rebase first.`);
    if (Number(ahead) > 0) console.log(`deploy: HEAD is ${ahead} commit(s) ahead of ${upstream} (unpushed).`);
  } catch {
    console.log('deploy: note — no upstream configured for the current branch; cannot check push status.');
  }
}

// Each project numbers its own releases: emboss-YYYY-MM-DD-vNNN (the beta) or emboss-plus-YYYY-MM-DD-vNNN (Emboss Plus).
function nextTag(dateStr, prefix = 'emboss') {
  const tags = git(['tag', '-l', `${prefix}-*-v*`]).split('\n').filter(Boolean)
    .filter((t) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}-v\\d+$`).test(t));
  let max = 0;
  for (const t of tags) {
    const m = t.match(/-v(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${dateStr}-v${max + 1}`;
}

async function main() {
  const { ref, dryRun, allowDirtyOther, beta, plus, preview, skipReleaseCheck, checkReleaseOnly } = parseArgs(process.argv.slice(2));
  const { project: PROJECT, url: PAGES_URL, tagPrefix } = plus ? PROJECTS.plus : PROJECTS.emboss;

  if (git(['rev-parse', '--is-inside-work-tree']).trim() !== 'true') die('not a git repository');
  const resolvedCommit = git(['rev-parse', ref]);
  const headCommit = git(['rev-parse', 'HEAD']);
  const commitSubject = git(['log', '-1', '--format=%s', resolvedCommit]);
  const shortHash = git(['rev-parse', '--short=8', resolvedCommit]);

  // S5a: a deploy of a commit needs passing release-check evidence for exactly this commit (a preview does not; --dry-run only reports).
  const gate = await releaseGate({ root: ROOT, commit: resolvedCommit, beta, plus, preview, enforce: !dryRun || checkReleaseOnly, skip: skipReleaseCheck });
  for (const l of gate.lines) (l.level === 'info' ? console.log : console.error)(`deploy: ${l.text}`);
  if (!gate.proceed) process.exit(1);
  if (checkReleaseOnly) { console.log(`deploy: --check-release-only: a deploy of ${shortHash} would be allowed.`); return; }
  let releaseNote = preview ? '' : gate.skipped ? ' [release-check SKIPPED]' : gate.evidence ? ` [release-check passed ${gate.evidence.finishedAt}]` : '';

  // The dirty-tree check only means anything when deploying "the current
  // state of HEAD" — an explicit historical ref builds purely from git
  // history regardless of what the working tree looks like right now.
  if (resolvedCommit === headCommit) checkWorkingTree(allowDirtyOther);
  else console.log(`deploy: deploying explicit ref ${ref} (${shortHash}), not HEAD — working-tree cleanliness is not checked.`);

  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'emboss-deploy-'));
  console.log(`deploy: building ${shortHash} ("${commitSubject}") in scratch worktree ${worktree}`);
  let worktreeAdded = false;
  try {
    git(['worktree', 'add', '--detach', worktree, resolvedCommit]);
    worktreeAdded = true;

    await linkBuildInputs(ROOT, worktree);

    console.log('deploy: running build-dist.mjs (which runs check-dist.mjs as its last step)…');
    execFileSync(NODE, ['scripts/build-dist.mjs'], { cwd: worktree, stdio: 'inherit', env: { ...process.env, EMBOSS_BETA: beta ? '1' : '', EMBOSS_PLUS: plus ? '1' : '' } });

    const distDir = path.join(worktree, 'dist');
    const buildInfo = JSON.parse(await fs.readFile(path.join(distDir, 'build-info.json'), 'utf8'));
    // S5a: the dist/ about to ship must be the one the release check's offline test ran on.
    if (gate.evidence) {
      const problem = digestProblem(gate.evidence, await distDigest(distDir));
      if (problem && !skipReleaseCheck) die(`${problem} — run release-check again${beta ? ' with --beta' : plus ? ' with --plus' : ''} (or --skip-release-check, with Paul's say-so).`);
      if (problem) { console.error(`deploy: *** WARNING: ${problem}; continuing only because of --skip-release-check. ***`); releaseNote = ' [release-check SKIPPED: dist differs from the checked build]'; }
      else console.log(`deploy: the build is byte-identical to the one release-check tested (digest ${gate.evidence.build.distDigest.slice(0, 12)}).`);
    }
    if (buildInfo.hash.endsWith('-dirty')) die(`internal error: build-info.json reports a dirty build (${buildInfo.hash}) from a worktree that should be clean`);

    if (dryRun) {
      const tagPreview = nextTag(new Date().toISOString().slice(0, 10), tagPrefix);
      console.log('deploy: --dry-run — built and checked dist/ successfully; stopping before wrangler and the git tag.');
      console.log(`deploy: would deploy commit ${shortHash} and tag it ${tagPreview}${releaseNote}`);
      return;
    }

    console.log(`deploy: uploading dist/ with wrangler${preview ? ` to the PREVIEW branch "${preview}" (not the public site)` : ''}…`);
    execFileSync(NODE, [
      WRANGLER, 'pages', 'deploy', 'dist',
      `--project-name=${PROJECT}`, `--branch=${preview || 'main'}`,
      `--commit-hash=${resolvedCommit}`, `--commit-message=${preview ? `[preview ${preview}] ` : ''}${beta ? '[beta] ' : plus ? '[plus] ' : ''}${commitSubject}`,
    ], { cwd: worktree, stdio: 'inherit' });

    if (preview) {
      // A preview is not a release: no tag, nothing to push for it.
      console.log(`deploy: PREVIEW deployed — ${PAGES_URL.replace('https://', `https://${preview}.`)} (the public site ${PAGES_URL} is unchanged; no tag made)`);
      return;
    }

    const tag = nextTag(new Date().toISOString().slice(0, 10), tagPrefix);
    if (git(['tag', '-l', tag])) die(`tag ${tag} already exists — refusing to move it`);
    git(['tag', '-a', tag, resolvedCommit, '-m', `Emboss ${beta ? 'BETA ' : plus ? 'PLUS ' : ''}deploy of ${shortHash}: ${commitSubject}${releaseNote}`]);
    if (gate.skipped) console.error('deploy: *** WARNING: this deploy skipped the release check (--skip-release-check); the tag says so. ***');
    console.log(`deploy: tagged ${tag} -> ${shortHash}`);
    console.log(`deploy: deployed to ${PAGES_URL}`);
    console.log('deploy: NOT pushed. Push the commit and tag with:');
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    // origin is the private sensoryapphouse/brlit: push as the sensoryapphouse GitHub account (the default
    // credential is PaulBlenkhorn, which cannot see it and gets "Repository not found").
    console.log(`    GH_TOKEN=$(gh auth token --user sensoryapphouse) git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin ${branch} --follow-tags`);
  } finally {
    if (worktreeAdded) {
      try { git(['worktree', 'remove', '--force', worktree]); }
      catch (e) { console.error(`deploy: warning — could not remove scratch worktree ${worktree}: ${e.message}`); }
    } else {
      await fs.rm(worktree, { recursive: true, force: true }).catch(() => {});
    }
  }
}

await main();
