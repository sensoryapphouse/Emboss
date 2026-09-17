#!/usr/bin/env node
// Validate DTBook / NIMAS files with the DAISY Pipeline 2 validators.
//
//   node Emboss/scripts/daisy-validate.mjs [options] <file.xml | package.opf> ...
//
// A .xml file runs `dtbook-validator` (RelaxNG + Schematron, NIMAS 1.1 rules on by
// default); a .opf file runs `nimas-fileset-validator` (the whole NIMAS package).
// Stricter than xmllint + DTD: it checks the NIMAS profile, not only element nesting.
//
// Options:
//   --no-nimas        DTBook rules only (no NIMAS 1.1 profile)
//   --mathml 2.0|3.0  MathML version to validate against (default 3.0)
//   --check-images    also check that referenced images exist on disk
//   --json            print one JSON summary per file instead of text
//   --keep-jobs       leave finished jobs in the engine (default: delete them)
//
// The engine: the official DAISY Pipeline engine zip (github.com/daisy/pipeline-assembly),
// unpacked to a path without spaces. Found via $DAISY_PIPELINE_HOME, else the newest
// ~/.local/share/daisy-pipeline-*. If no engine answers on $DAISY_PIPELINE_URL
// (default http://localhost:8181/ws) it is started in local mode and left running.
//
// Exit code: 0 all valid, 1 validation errors, 2 usage / engine problems.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WS = (process.env.DAISY_PIPELINE_URL || 'http://localhost:8181/ws').replace(/\/$/, '');
const NS = 'http://www.daisy.org/ns/pipeline/data';

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node Emboss/scripts/daisy-validate.mjs [--no-nimas] [--mathml 2.0|3.0] [--check-images] [--json] [--keep-jobs] <file.xml|package.opf> ...');
  process.exit(2);
}

const opts = { nimas: true, mathml: '3.0', checkImages: false, json: false, keepJobs: false };
const files = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--no-nimas') opts.nimas = false;
  else if (a === '--mathml') { opts.mathml = argv[++i]; if (!['2.0', '3.0'].includes(opts.mathml)) usage('--mathml must be 2.0 or 3.0'); }
  else if (a === '--check-images') opts.checkImages = true;
  else if (a === '--json') opts.json = true;
  else if (a === '--keep-jobs') opts.keepJobs = true;
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else files.push(a);
}
if (!files.length) usage('no input files');
for (const f of files) if (!fs.existsSync(f)) usage(`file not found: ${f}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function alive() {
  try {
    const r = await fetch(`${WS}/alive`);
    return r.ok;
  } catch {
    return false;
  }
}

function findEngineHome() {
  if (process.env.DAISY_PIPELINE_HOME) return process.env.DAISY_PIPELINE_HOME;
  const base = path.join(os.homedir(), '.local', 'share');
  const found = fs.existsSync(base)
    ? fs.readdirSync(base).filter((d) => /^daisy-pipeline-\d/.test(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  return found.length ? path.join(base, found[found.length - 1]) : null;
}

async function ensureEngine() {
  if (await alive()) return;
  const home = findEngineHome();
  if (!home || !fs.existsSync(path.join(home, 'bin', 'pipeline2'))) {
    console.error('DAISY Pipeline engine not running and not found. Set DAISY_PIPELINE_HOME or unpack');
    console.error('pipeline2-<version>_linux.zip (github.com/daisy/pipeline-assembly releases) to ~/.local/share/daisy-pipeline-<version>.');
    process.exit(2);
  }
  if (/\s/.test(home)) {
    console.error(`The engine launcher cannot run from a path containing spaces: ${home}`);
    process.exit(2);
  }
  const log = path.join(os.tmpdir(), 'daisy-pipeline-engine.log');
  const out = fs.openSync(log, 'a');
  const child = spawn(path.join(home, 'bin', 'pipeline2'), ['local'], { cwd: home, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  process.stderr.write(`Starting DAISY Pipeline engine (${path.basename(home)}; log ${log}) `);
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    if (await alive()) { process.stderr.write('ready\n'); return; }
    process.stderr.write('.');
  }
  console.error('\nThe engine did not start within 3 minutes; see the log above.');
  process.exit(2);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function jobRequest(file) {
  const isOpf = /\.opf$/i.test(file);
  const script = isOpf ? 'nimas-fileset-validator' : 'dtbook-validator';
  const url = pathToFileURL(path.resolve(file)).href;
  const options = [
    ['mathml-version', opts.mathml],
    ['check-images', String(opts.checkImages)],
  ];
  if (!isOpf) options.push(['nimas', String(opts.nimas)]);
  return {
    script,
    body: `<jobRequest xmlns="${NS}">
  <script href="${WS}/scripts/${script}"/>
  <input name="source"><item value="${xmlEsc(url)}"/></input>
${options.map(([k, v]) => `  <option name="${k}">${xmlEsc(v)}</option>`).join('\n')}
</jobRequest>`,
  };
}

async function runJob(file) {
  const { script, body } = jobRequest(file);
  const res = await fetch(`${WS}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body });
  const text = await res.text();
  const id = (text.match(/<job\b[^>]*\sid="([^"]+)"/) || [])[1];
  if (!id) throw new Error(`job was not accepted: ${text.replace(/<[^>]+>/g, ' ').trim().slice(0, 300)}`);
  let jobXml = '';
  let status = '';
  for (let i = 0; i < 600; i++) {
    jobXml = await (await fetch(`${WS}/jobs/${id}`)).text();
    status = (jobXml.match(/<job\b[^>]*\sstatus="([A-Z_]+)"/) || [])[1] || '';
    if (status && status !== 'RUNNING' && status !== 'IDLE') break;
    await sleep(1000);
  }
  // The raw report is on port "report" (dtbook-validator) or "result" zip (fileset);
  // fetch the XML report file by its per-file href.
  const hrefs = [...jobXml.matchAll(/<result\b[^>]*\shref="([^"]+\.xml)"[^>]*\/>/g)].map((m) => m[1]);
  // A job can return several reports: nimas-fileset-validator gives one for the package
  // document (OPF) and one for the DTBook, each also repeated per file. Read them all —
  // reading only the first let OPF errors go unreported (found with A4).
  const reportHrefs = hrefs.filter((h) => /report\.xml$/.test(h));
  const reports = [];
  for (const h of (reportHrefs.length ? reportHrefs : hrefs.slice(0, 1))) reports.push(await (await fetch(h)).text());
  const report = reports.join('\n');
  const engineErrors = [...jobXml.matchAll(/<message\b[^>]*\slevel="ERROR"[^>]*\scontent="([^"]*)"/g)].map((m) => m[1]);
  if (!opts.keepJobs) await fetch(`${WS}/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
  return { script, status, report, engineErrors };
}

// Known false positives in the DAISY rules themselves. Each is matched exactly and shown
// as "suppressed" instead of counted as an error.
//  - dtbook.mathml.nimas.sch, pattern dtbook_NimasHeadMeta (pipeline-modules
//    dtbook-utils): `<rule context="dtb:meta"><assert test="count(*) > 0">The meta
//    element must be empty.</assert>` — the test is inverted relative to its message and
//    to the DTD (meta is EMPTY), so every correctly empty <meta> fails. DAISY's own NIMAS
//    reference sample (NIMAS_valid_baseline.xml) fails it too; publisher files pass only
//    because they have no <head>.
const KNOWN_FALSE_POSITIVES = [
  { kind: 'schematron', message: 'The meta element must be empty.', test: 'count(*) > 0' },
];
const isKnownFalsePositive = (i) => KNOWN_FALSE_POSITIVES.some((k) => k.kind === i.kind && k.message === i.message && k.test === i.test);

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// One summary over every validated document in the job's reports, each document counted
// once (keyed by its path) however many reports repeat it.
function summariseAll(report) {
  const docs = new Map();
  for (const m of report.matchAll(/<d:document-validation-report\b[\s\S]*?<\/d:document-validation-report>/g)) {
    const docPath = ((m[0].match(/<d:document-path>([\s\S]*?)<\/d:document-path>/) || [])[1] || '').trim() || `doc${docs.size}`;
    if (!docs.has(docPath)) docs.set(docPath, summarise(m[0]));
  }
  if (!docs.size) return summarise(report);
  const all = [...docs.values()];
  return {
    docType: [...new Set(all.map((d) => d.docType).filter(Boolean))].join(' + '),
    errorCount: all.reduce((n, d) => n + d.errorCount, 0),
    issues: all.flatMap((d) => d.issues),
  };
}

function summarise(report) {
  const issues = [];
  for (const rep of report.matchAll(/<d:report\b[^>]*type="([^"]*)"[^>]*>([\s\S]*?)<\/d:report>/g)) {
    const kind = rep[1];
    for (const e of rep[2].matchAll(/<d:(error|warn)\b[^>]*>([\s\S]*?)<\/d:\1>/g)) {
      const severity = e[1] === 'warn' ? 'warning' : 'error';
      let desc = decode(((e[2].match(/<d:desc>([\s\S]*?)<\/d:desc>/) || [])[1] || e[2]).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      let line = Number((e[2].match(/<d:location\b[^>]*\sline="(\d+)"/) || [])[1]) || null;
      const sax = desc.match(/lineNumber: (\d+); columnNumber: (\d+); (.*)$/);
      if (sax) { line = Number(sax[1]); desc = sax[3]; }
      desc = desc.replace(/(expected [^"]*"[^"]+"(?:, "[^"]+"){3})(, "[^"]+")+/, '$1, …');
      issues.push({ kind, severity, line, message: desc });
    }
    // Schematron (NIMAS profile) results are SVRL: failed asserts and successful reports.
    for (const f of rep[2].matchAll(/<svrl:(failed-assert|successful-report)\b([^>]*)>([\s\S]*?)<\/svrl:\1>/g)) {
      const attrs = f[2];
      const role = ((attrs.match(/\srole="([^"]*)"/) || [])[1] || '').toLowerCase();
      const severity = /warn|info/.test(role) ? 'warning' : 'error';
      const text = decode(((f[3].match(/<svrl:text>([\s\S]*?)<\/svrl:text>/) || [])[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      const loc = decode((attrs.match(/\slocation="([^"]*)"/) || [])[1] || '')
        .replace(/\*:(\w+)\[namespace-uri\(\)='[^']*'\]/g, '$1')
        .replace(/\[1\]/g, '');
      const test = decode((attrs.match(/\stest="([^"]*)"/) || [])[1] || '');
      issues.push({ kind, severity, line: null, message: text || `failed: ${test}`, location: loc, test });
    }
  }
  const docType = decode((report.match(/<d:document-type>([\s\S]*?)<\/d:document-type>/) || [])[1] || '').trim();
  const count = Number((report.match(/<d:error-count>(\d+)<\/d:error-count>/) || [])[1]);
  return { docType, errorCount: Number.isFinite(count) ? count : issues.filter((i) => i.severity === 'error').length, issues };
}

await ensureEngine();
let anyInvalid = false;
for (const file of files) {
  let out;
  try {
    const job = await runJob(file);
    const s = summariseAll(job.report);
    const suppressed = s.issues.filter(isKnownFalsePositive);
    const issues = s.issues.filter((i) => !isKnownFalsePositive(i));
    const errors = Math.max(0, s.errorCount - suppressed.filter((i) => i.severity === 'error').length);
    // The engine marks the job FAIL on any assertion, including suppressed ones.
    const valid = (job.status === 'SUCCESS' || job.status === 'FAIL') && errors === 0 && !job.engineErrors.length && job.report !== '';
    out = { file, script: job.script, status: job.status, valid, documentType: s.docType, errors, suppressed: suppressed.length, issues, engineErrors: job.engineErrors };
  } catch (err) {
    out = { file, status: 'ERROR', valid: false, errors: null, issues: [], engineErrors: [String(err.message || err)] };
  }
  if (!out.valid) anyInvalid = true;
  if (opts.json) { console.log(JSON.stringify(out)); continue; }
  console.log(`\n${out.valid ? 'VALID  ' : 'INVALID'}  ${file}`);
  console.log(`  ${out.script || ''} · ${out.documentType || 'unknown type'} · ${opts.nimas ? 'NIMAS 1.1 rules' : 'DTBook rules'} · ${out.errors ?? '?'} error(s)${out.suppressed ? ` · ${out.suppressed} suppressed (known DAISY rule bug: empty <meta>)` : ''}`);
  const groups = new Map();
  for (const i of out.issues) {
    const k = `${i.severity} [${i.kind}] ${i.message}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i.line);
  }
  const locs = new Map();
  for (const i of out.issues) {
    if (!i.location) continue;
    const k = `${i.severity} [${i.kind}] ${i.message}`;
    if (!locs.has(k)) locs.set(k, []);
    locs.get(k).push(i.location);
  }
  for (const [k, lines] of groups) {
    const ls = lines.filter(Boolean);
    const where = ls.length ? ` (line${ls.length > 1 ? 's' : ''} ${ls.slice(0, 8).join(', ')}${ls.length > 8 ? ', …' : ''})` : '';
    console.log(`  ${lines.length > 1 ? `${lines.length}× ` : ''}${k.slice(0, 260)}${where}`);
    const at = locs.get(k);
    if (at && at.length) console.log(`      at ${at.slice(0, 3).join('  |  ')}${at.length > 3 ? '  | …' : ''}`);
  }
  for (const m of out.engineErrors) console.log(`  engine: ${m.slice(0, 300)}`);
}
process.exitCode = anyInvalid ? 1 : 0;
