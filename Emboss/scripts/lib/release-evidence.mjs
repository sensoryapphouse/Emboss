// The evidence manifest that release-check.mjs writes and deploy.mjs reads (audit 15 Oct 2026, "Release gates need enforceable
// revision-specific evidence"; S5a).
//
// WHERE: <the repository's common git directory>/release-evidence/<full 40-character commit>[.beta|.plus].json — one file per
// kind of build (a public, beta and Plus run of one commit no longer overwrite each other) — inside .git, so git ignores it
// by nature, every worktree of the repository (the main checkout, an agent's worktree, the scratch worktree a deploy makes) sees
// the same files, and `git worktree remove` or a clean checkout never deletes it. A run that did not cover every required check
// (--only) is written as <commit>[.kind].partial.json and can never satisfy a deploy.
//
// WHAT deploy.mjs requires (evaluateEvidence below, a pure function): a manifest for exactly the commit being deployed, from this
// tool (schema 1), complete, overall "pass", every required check for that kind of build present and "pass" (Plus: run-all-tests,
// build-dist, offline-dist; beta and public: all five — release-check-core.mjs requiredChecks), the manifest AND each check
// finished no more than 24 hours ago (a check reused from an earlier run keeps its own finish time), not in the future, made for
// the same kind of build (beta, Plus or neither). After its own build, deploy.mjs also requires the built dist/ to
// be byte-identical (distDigest below) to the dist/ the checks ran against.
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { requiredChecks } from './release-check-core.mjs';

export const SCHEMA = 1;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// EMBOSS_RELEASE_EVIDENCE_DIR points both tools at another folder (the tests use it; nothing else should).
export function evidenceDir(root) {
  if (process.env.EMBOSS_RELEASE_EVIDENCE_DIR) return path.resolve(process.env.EMBOSS_RELEASE_EVIDENCE_DIR);
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  return path.join(path.resolve(root, common), 'release-evidence');
}
export const KINDS = Object.freeze(['', 'beta', 'plus']);
export const kindOf = ({ beta = false, plus = false } = {}) => (beta ? 'beta' : plus ? 'plus' : '');
export const evidenceFile = (dir, commit, partial = false, kind = '') => path.join(dir, `${commit}${kind ? `.${kind}` : ''}${partial ? '.partial' : ''}.json`);

export async function writeManifest(dir, manifest) {
  await fs.mkdir(dir, { recursive: true });
  const file = evidenceFile(dir, manifest.commit, !manifest.complete, kindOf(manifest.options || {}));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(tmp, file);
  return file;
}
// The manifest for one kind of build. A beta or Plus deploy with no file of its own reads <commit>.json — where every run was
// written before 17 Oct 2026 — and evaluateEvidence then checks that it is for the right kind.
export async function readManifest(dir, commit, kind = '') {
  for (const file of kind ? [evidenceFile(dir, commit, false, kind), evidenceFile(dir, commit)] : [evidenceFile(dir, commit)]) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error(`the release evidence for ${commit} cannot be read: ${e.message}`); }
  }
  return null;
}
// Every manifest of this commit, any kind, full or partial, for release-check's reuse; a missing or damaged file is skipped.
export async function readAllManifests(dir, commit) {
  const out = [];
  for (const kind of KINDS) for (const partial of [false, true]) {
    const file = evidenceFile(dir, commit, partial, kind);
    try { out.push({ file: path.basename(file), manifest: JSON.parse(await fs.readFile(file, 'utf8')) }); } catch { /* none, or damaged */ }
  }
  return out;
}

// Pure. Returns { ok, reasons[] }; reasons are plain sentences, shown to the person whose deploy was refused.
export function evaluateEvidence(manifest, { commit, now = Date.now(), beta = false, plus = false, maxAgeMs = MAX_AGE_MS } = {}) {
  const reasons = [];
  if (!manifest) return { ok: false, reasons: [`no release evidence exists for commit ${commit}`] };
  if (manifest.schema !== SCHEMA || manifest.tool !== 'release-check') reasons.push('the evidence file is not a release-check manifest this deploy understands');
  if (manifest.commit !== commit) reasons.push(`the evidence is for commit ${manifest.commit}, not ${commit}`);
  if (manifest.complete !== true) reasons.push('the evidence is from a partial run (--only), not every required check');
  if (manifest.overall !== 'pass') reasons.push(`the evidence records an overall result of "${manifest.overall}", not "pass"`);
  const checks = manifest.checks || {};
  for (const name of requiredChecks({ plus })) {
    const c = checks[name];
    if (!c) { reasons.push(`the evidence has no result for "${name}"`); continue; }
    if (c.result !== 'pass') reasons.push(`"${name}" did not pass (${c.result})`);
    const t = Date.parse(c.finishedAt);
    if (c.finishedAt && Number.isFinite(t) && now - t > maxAgeMs) reasons.push(`"${name}" is ${((now - t) / 3600000).toFixed(1)} hours old${c.reused ? ` (reused from ${c.reused.from})` : ''} (limit ${(maxAgeMs / 3600000).toFixed(0)} hours)`);
  }
  const finished = Date.parse(manifest.finishedAt);
  if (!Number.isFinite(finished)) reasons.push('the evidence has no valid finish time');
  else if (finished - now > CLOCK_SKEW_MS) reasons.push(`the evidence claims to have finished in the future (${manifest.finishedAt})`);
  else if (now - finished > maxAgeMs) reasons.push(`the evidence is ${((now - finished) / 3600000).toFixed(1)} hours old (limit ${(maxAgeMs / 3600000).toFixed(0)} hours; finished ${manifest.finishedAt})`);
  const mb = manifest.build || {};
  if (!mb.cacheId || !mb.distDigest) reasons.push('the evidence does not identify the build it checked (no cache id or dist digest)');
  if (!!mb.plus !== !!plus) reasons.push(`the evidence is for ${mb.plus ? 'an Emboss Plus' : 'a non-Plus'} build but this deploy is ${plus ? 'Emboss Plus' : 'not Emboss Plus'} (run release-check ${plus ? 'with' : 'without'} --plus)`);
  if (!!mb.beta !== !!beta) reasons.push(`the evidence is for a ${mb.beta ? 'beta' : 'non-beta'} build but this deploy is ${beta ? 'a beta' : 'non-beta'} (run release-check ${beta ? 'with' : 'without'} --beta)`);
  return { ok: reasons.length === 0, reasons };
}

// A fingerprint of a built dist/: SHA-256 over every file's path and content, sorted, EXCEPT build-info.json (it carries the
// build date, which is not part of what ships being different). Two builds of the same commit and kind give the same digest.
export async function distDigest(dist) {
  const entries = [];
  async function walk(dir, rel) {
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(abs, r);
      else if (e.isFile() || e.isSymbolicLink()) {
        if (r === 'build-info.json') continue;
        entries.push(`${r}\0${createHash('sha256').update(await fs.readFile(abs)).digest('hex')}`);
      }
    }
  }
  await walk(dist, '');
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

// What deploy.mjs does with the evidence, as one function so it can be tested without deploying anything.
//   preview  -> a preview is not a release: proceeds, no evidence needed (previews stay as they were).
//   enforce  -> false for --dry-run (it builds and reports, it ships nothing): the verdict is printed but never stops it.
//   skip     -> --skip-release-check: proceeds even without good evidence, with a loud warning that deploy.mjs also writes into the tag.
// Returns { proceed, skipped, evidence (the manifest, when it is valid), lines: [{ level: 'info'|'warn'|'error', text }] }.
export async function releaseGate({ root, commit, beta = false, plus = false, preview = null, enforce = true, skip = false, now = Date.now() }) {
  const lines = [];
  if (preview) {
    lines.push({ level: 'info', text: `preview "${preview}": no release check required (a preview is not a release).` });
    return { proceed: true, skipped: false, evidence: null, lines };
  }
  const dir = evidenceDir(root);
  const manifest = await readManifest(dir, commit, kindOf({ beta, plus }));
  const verdict = evaluateEvidence(manifest, { commit, now, beta, plus });
  if (verdict.ok) {
    const reused = Object.entries(manifest.checks || {}).filter(([, c]) => c.reused).map(([n]) => n);
    lines.push({ level: 'info', text: `release check: commit ${commit.slice(0, 8)} passed on ${manifest.finishedAt} (${manifest.checks ? Object.keys(manifest.checks).length : 0} checks${reused.length ? `, ${reused.join(', ')} reused from an earlier run` : ''}, build ${manifest.build.cacheId}, ${manifest.build.beta ? 'beta' : manifest.build.plus ? 'Emboss Plus' : 'non-beta'}); evidence ${evidenceFile(dir, commit)}` });
    if (skip) lines.push({ level: 'info', text: '--skip-release-check was given but the evidence is good, so it is being used.' });
    return { proceed: true, skipped: false, evidence: manifest, lines };
  }
  if (skip) {
    lines.push({ level: 'warn', text: '*** WARNING: --skip-release-check — THIS DEPLOY HAS NO VALID RELEASE-CHECK EVIDENCE. ***' });
    for (const r of verdict.reasons) lines.push({ level: 'warn', text: `    - ${r}` });
    lines.push({ level: 'warn', text: '*** The layout-parity, extreme-document, offline and full test checks were NOT shown to pass for this commit. The tag will say so. ***' });
    return { proceed: true, skipped: true, evidence: null, lines };
  }
  const head = `release check: no valid evidence for commit ${commit.slice(0, 8)}:`;
  if (!enforce) {
    lines.push({ level: 'warn', text: `${head} (--dry-run: reported only; a real deploy would be REFUSED)` });
    for (const r of verdict.reasons) lines.push({ level: 'warn', text: `    - ${r}` });
    return { proceed: true, skipped: false, evidence: null, lines };
  }
  lines.push({ level: 'error', text: head });
  for (const r of verdict.reasons) lines.push({ level: 'error', text: `    - ${r}` });
  lines.push({ level: 'error', text: `run:  node Emboss/scripts/release-check.mjs ${commit.slice(0, 8)}${beta ? ' --beta' : plus ? ' --plus' : ''}   (${plus ? 'about 5-10 minutes' : 'about half an hour, longer when the machine is loaded'}; a few minutes when this commit's tests already passed in the last 12 hours), then deploy again within 24 hours.` });
  lines.push({ level: 'error', text: 'Only with Paul\'s say-so: --skip-release-check deploys anyway (loud warning; recorded in the tag).' });
  return { proceed: false, skipped: false, evidence: null, lines };
}

// After deploy.mjs's own build: is dist/ the one the checks ran against? Returns null when it is, else a sentence.
export function digestProblem(manifest, digest) {
  if (!manifest || !manifest.build) return 'there is no evidence to compare the build with';
  return manifest.build.distDigest === digest ? null
    : `the dist/ just built (digest ${digest.slice(0, 12)}) is not the one the release check ran against (digest ${String(manifest.build.distDigest).slice(0, 12)}, cache ${manifest.build.cacheId})`;
}
