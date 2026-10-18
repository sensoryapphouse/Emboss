// Extreme-document test set (A89 step 4 of the robustness programme; Paul, 2 Oct 2026).
//
// WHY: transcribers lost confidence in BrailleBlaster because it crashed. "Every aspect needs to be bullet proof and properly deal
// with even the most extreme documents." This script proves that Emboss never crashes, hangs or runs out of memory on the most
// extreme documents a transcriber could give it, and turns any failure into a clear report (what, where, how to repeat it).
//
// HOW: a seeded generator (deterministic: --seed N always makes the same bytes) writes each case as NIMAS XML, HTML, Markdown,
// plain text and DOCX (RTF, ODT and EPUB for a subset). Each file is processed in a CHILD process that takes the road a user's
// file takes: parseFile (as web/app.mjs acceptFile does) -> BRF in BANA and in UKAAF (UEB grade 2; grade 1 and the editor's
// formatDocumentAsync path for some) -> the NIMAS save (exportToNimasXml) read back with parseFile (the block count should be
// stable; differences are reported, not failed) -> eBraille / PEF export for some. The child gets its case's heap budget as
// --max-old-space-size and a hard wall-clock limit (the parent kills it), so an out-of-memory crash, a hang or a stack overflow
// becomes one FAIL row instead of stopping the run. The malformed-input case runs hundreds of small files in a few "battery"
// children; if one hangs or crashes, the parent names the culprit and carries on with a fresh child for the rest.
//
// THE CASES (see extreme/cases.mjs):
//   01 big book (NIMAS about 10 MB; --heavy adds 60 MB)   02 10,000 inline equations   03 500 tables (wide, tall, span chaos, nested)
//   04 lists nested 20 and 200 deep   05 5,000 headings; a 10,000-character heading   06 a 1 MB paragraph with no spaces, a
//   100,000-letter word, 50,000 one-character paragraphs   07 scripts and Unicode (bidi, Zalgo, emoji, astral, controls, lone
//   surrogates, ...)   08 malformed and hostile input in every reader (truncated, bad bytes, lying zips, zip bombs, billion laughs,
//   XXE, 5,000-deep nesting, extension lies, empty files).
//
// PASS for a unit means: no uncaught exception (the reader's own clear message, or e.userFacing, is a PASS for malformed input; a raw
// TypeError / RangeError / stack overflow is a FAIL); inside its time budget; peak memory inside its budget; the BRF is non-empty for
// non-empty content and holds only BRF ASCII; the NIMAS file Emboss saves holds no character XML forbids and Emboss can read it back.
//
// LIMITS TO KNOW: the DOM in Node is @xmldom/xmldom (as every Node test in this repo uses), not the browser's own parser, so an
// HTML tree that a browser would stop at about 512 levels (nest-5000-html-*) can only be met here; the nest-400 units are depths a
// browser can deliver. Nothing here starts a browser or a server.
//
// USAGE: node Emboss/scripts/check-extreme-documents.mjs [--list] [--filter SUBSTR[,SUBSTR]] [--heavy] [--seed N] [--jobs N]
//                                                       [--out DIR] [--time-scale F] [--keep]
//        node Emboss/scripts/check-extreme-documents.mjs --file PATH [--expect content|tolerant]    (one file of your own; the extension picks the reader)
//   --list         print the units and exit             --filter     only units whose id contains SUBSTR (comma = or)
//   --heavy        add the 60 MB book and other very big units (an hour or more)
//   --seed N       generator seed (default 20261002)    --jobs N     children at once (default 1; memory-hungry units fight each other)
//   --out DIR      keep generated inputs and per-unit logs there (default: a temp dir, removed when everything passes)
//   --time-scale F multiply every time budget (a loaded machine)      --keep   keep passing units' inputs too
//   --file PATH    run one file through the whole road (parse, BANA, UKAAF, NIMAS round trip) in a child (limit 120 s, 2 GB heap; --time-scale 0.25 makes it 30 s):
//                  the way to repeat a failure from its saved input; --expect content also demands a non-empty BRF
// Exit status 1 when any unit FAILs.
// TIME (2 Oct 2026, 10-core Mac, load about 5 from other sessions, --jobs 1): the default run is 128 units; the units that PASS add up to
// about 8 minutes, so a run with no failures takes about 8 minutes. While Emboss still hangs or crashes on some inputs the failing
// units wait out their limits (25-30 s per hung item) and the whole run took 16 minutes. --heavy adds five units, about 7 minutes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCases } from './extreme/cases.mjs';
import { hostileGroups } from './extreme/hostile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'extreme', 'worker.mjs');

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const a = { file: null, expect: 'tolerant', list: false, filter: null, heavy: false, seed: 20261002, jobs: 1, out: null, timeScale: 1, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { if (i + 1 >= argv.length) { console.error(`${k} needs a value`); process.exit(2); } return argv[++i]; };
    if (k === '--list') a.list = true;
    else if (k === '--heavy') a.heavy = true;
    else if (k === '--keep') a.keep = true;
    else if (k === '--filter') a.filter = val().split(',').map((s) => s.toLowerCase()).filter(Boolean);
    else if (k === '--file') a.file = path.resolve(val());
    else if (k === '--expect') a.expect = val();
    else if (k === '--seed') a.seed = Number(val());
    else if (k === '--jobs') a.jobs = Math.max(1, Number(val()) | 0);
    else if (k === '--out') a.out = path.resolve(val());
    else if (k === '--time-scale') a.timeScale = Number(val());
    else if (k === '--help' || k === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
    else { console.error(`unknown option ${k} (try --help)`); process.exit(2); }
  }
  if (!Number.isFinite(a.seed) || !Number.isFinite(a.timeScale) || a.timeScale <= 0) { console.error('--seed and --time-scale must be numbers'); process.exit(2); }
  return a;
}
const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------- environment for the XXE items
const outDir = args.out || fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-extreme-'));
fs.mkdirSync(path.join(outDir, 'inputs'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'logs'), { recursive: true });
const canaryPath = path.join(outDir, 'xxe-canary.txt');
fs.writeFileSync(canaryPath, 'EXTREME-XXE-CANARY (if this text appears in a braille file, Emboss read an external file)\n');
const hits = [];                                                   // every request our local listener receives
let server = null, httpBase = 'http://127.0.0.1:9';
const startServer = () => new Promise((resolve) => {
  server = http.createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('EXTREME-XXE-CANARY via http'); });
  server.listen(0, '127.0.0.1', () => { httpBase = `http://127.0.0.1:${server.address().port}`; resolve(); });
});

// ---------------------------------------------------------------- cases and units
let hostileP = null;
const hostile = () => (hostileP ||= hostileGroups(args.seed, { canaryPath, httpBase }));
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 90);

function selectUnits() {
  if (args.file) {                                              // one file of the user's own: the way to repeat a failure from a saved input
    const name = path.basename(args.file);
    const unit = { id: `file:${name}`, caseId: 'file', label: name, ext: (name.split('.').pop() || 'bin'), budget: { timeSec: 120, heapMB: 2048, rssMB: 4000 }, pipe: { modes: ['bana', 'ukaaf'], roundTrip: true, expect: args.expect }, gen: () => fs.readFileSync(args.file), fileName: name, modelJson: /\.model\.json$/.test(name) };
    return { cases: [{ id: 'file', title: 'a single file', units: [unit] }], units: [unit] };
  }
  const cases = buildCases({ seed: args.seed, heavy: args.heavy, hostile, canaryInfo: { canaryPath } });
  let units = cases.flatMap((c) => c.units.map((u) => ({ ...u, caseTitle: c.title })));
  if (args.filter) units = units.filter((u) => args.filter.some((f) => u.id.toLowerCase().includes(f)));
  return { cases, units };
}

// ---------------------------------------------------------------- running one unit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function lastProgress(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    let item = null, itemT = 0, stage = null;
    for (const l of lines) {
      const m = /^(\d+) (item|stage) (.*)$/.exec(l);
      if (!m) continue;
      if (m[2] === 'item') { item = m[3]; itemT = Number(m[1]); stage = null; } else stage = m[3];
    }
    return { item, itemT, stage };
  } catch { return { item: null, itemT: 0, stage: null }; }
}

// Runs one child over `items` (already on disk). Returns what happened to it.
function runChild(unit, items, dir, attempt, secondsLeft) {
  return new Promise((resolve) => {
    const resultFile = path.join(dir, `result-${attempt}.json`);
    const progressFile = resultFile + '.progress';
    const specFile = path.join(dir, `job-${attempt}.json`);
    fs.writeFileSync(specFile, JSON.stringify({ resultFile, items }));
    const t0 = Date.now();
    const child = spawn(process.execPath, [`--max-old-space-size=${unit.budget.heapMB}`, WORKER, specFile], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-120000); });
    let killed = null;
    const byId = new Map(items.map((it) => [it.id, it]));
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - t0 > secondsLeft * 1000) { killed = { why: 'unit-timeout', limit: secondsLeft }; child.kill('SIGKILL'); return; }
      const p = lastProgress(progressFile);
      const it = p.item && byId.get(p.item);
      if (it && it.timeSec && p.itemT && now - p.itemT > it.timeSec * 1000 + 3000 && !killed) { killed = { why: 'item-timeout', limit: it.timeSec, item: p.item }; child.kill('SIGKILL'); }
    }, 250);
    child.on('close', (code, signal) => {
      clearInterval(timer);
      let result = { items: {} };
      try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch { /* the child died before its first save */ }
      const p = lastProgress(progressFile);
      resolve({ result, code, signal, killed, stderr, wall: (Date.now() - t0) / 1000, current: p.item, stage: p.stage });
    });
  });
}

async function runUnit(unit, index, total) {
  const dir = path.join(outDir, 'inputs', safe(unit.id));
  fs.mkdirSync(dir, { recursive: true });
  const row = { unit, status: 'pass', items: [], timeSec: 0, peakMB: 0, genSec: 0, failures: [], warns: [], notes: [], dir };
  const tg = Date.now();
  // 1. generate the files
  let defs;
  try {
    defs = unit.battery ? await unit.items() : [{ id: unit.label, name: unit.fileName || `${safe(unit.label)}.${unit.ext}`, make: unit.gen, pipe: unit.pipe, modelJson: unit.modelJson }];
  } catch (e) { row.status = 'FAIL'; row.failures.push({ item: '(generator)', reason: `the test set could not make this unit: ${e.stack || e}` }); return row; }
  const jobItems = [];
  let n = 0;
  for (const d of defs) {
    if (!d) { row.status = 'FAIL'; row.failures.push({ item: '(generator)', reason: 'the generator has no item for this id' }); continue; }
    let data;
    try { data = d.data || await d.make(); } catch (e) { row.status = 'FAIL'; row.failures.push({ item: d.id, reason: `the test set could not make this input: ${e.stack || e}` }); continue; }
    const nameExt = d.modelJson ? 'model.json' : String(d.name).includes('.') ? String(d.name).split('.').pop() : '';          // the saved file keeps the extension, so --file picks the same reader
    const file = path.join(dir, `${String(++n).padStart(3, '0')}-${safe(d.id)}${nameExt && !safe(d.id).endsWith('.' + nameExt) ? '.' + nameExt : ''}`);
    fs.writeFileSync(file, data);
    jobItems.push({ ...d.pipe, ...(d.extra || {}), id: d.id, name: d.name, file, modelJson: !!d.modelJson, mustNotContain: d.extra?.mustNotContain || d.mustNotContain, timeSec: Math.ceil((d.timeSec || unit.itemSec || unit.budget.timeSec) * args.timeScale), token: d.token, bytes: data.length, unreachableNote: d.extra?.unreachableNote });
  }
  row.genSec = (Date.now() - tg) / 1000;
  row.inputBytes = jobItems.reduce((s, j) => s + j.bytes, 0);

  // 2. run them, restarting after any item that kills its child
  const budgetSec = unit.budget.timeSec * args.timeScale;
  let pending = jobItems.slice(), attempt = 0;
  const results = {};
  const culprits = {};
  while (pending.length) {
    const left = budgetSec - row.timeSec;
    if (left <= 1) { for (const it of pending) culprits[it.id] = `not run: the unit's time budget of ${Math.round(budgetSec)} s was used up by the items before it`; break; }
    const run = await runChild(unit, pending, dir, attempt++, left);
    row.timeSec += run.wall;
    Object.assign(results, run.result.items);
    row.peakMB = Math.max(row.peakMB, run.result.peakRssMB || 0);
    const remaining = pending.filter((it) => !results[it.id]);
    if (!remaining.length) break;
    const bad = remaining[0];
    const heapOom = /heap out of memory|Reached heap limit|JavaScript heap/i.test(run.stderr);
    const where = run.stage ? ` during "${run.stage}"` : '';
    let why;
    if (run.killed && run.killed.why === 'unit-timeout') why = `timeout: the whole unit passed its ${Math.round(budgetSec)} s budget${where} (item running: ${run.current || bad.id})`;
    else if (run.killed) why = `hang/timeout: no result after ${run.killed.limit} s${where}`;
    else if (heapOom) why = `out of memory: the JavaScript heap passed its ${unit.budget.heapMB} MB limit${where}\n${run.stderr.split('\n').filter((l) => /FATAL ERROR|Reached heap limit/.test(l)).slice(0, 1).join('\n').slice(0, 160)}`;
    else why = `the process died (${run.signal || 'exit ' + run.code})${where}\n${run.stderr.trim().split('\n').filter((l) => !/^\s*\d+: 0x/.test(l)).slice(-5).join('\n').slice(0, 400)}`;
    // when the hung item was not the first remaining one (progress names it), blame the named one
    const named = remaining.find((it) => it.id === run.current) || bad;
    culprits[named.id] = why;
    if (heapOom) row.peakMB = Math.max(row.peakMB, unit.budget.heapMB);
    pending = remaining.filter((it) => it !== named);          // a fresh child takes the rest
  }

  // 3. judge each item
  for (const it of jobItems) {
    const r = results[it.id];
    const entry = { id: it.id, file: it.file, status: 'pass', reasons: [], warns: [], notes: [] };
    if (culprits[it.id]) { entry.status = 'FAIL'; entry.reasons.push(culprits[it.id]); }
    else if (!r) { entry.status = 'FAIL'; entry.reasons.push('no result was produced'); }
    else {
      for (const f of r.failures) entry.reasons.push(`${f.stage}: ${f.message}${f.stack ? '\n' + f.stack : ''}`);
      if (r.totalMs > it.timeSec * 1000) entry.reasons.push(`too slow: ${(r.totalMs / 1000).toFixed(1)} s against a limit of ${it.timeSec} s`);
      entry.warns = r.warns || [];
      entry.notes = r.notes || [];
      entry.ms = r.totalMs; entry.blocks = r.blocks; entry.types = r.types; entry.stages = r.stages; entry.roundTrip = r.roundTrip; entry.brf = r.brf; entry.parseError = r.parseError;
      if (entry.reasons.length) entry.status = 'FAIL';
    }
    if (entry.reasons.length && it.unreachableNote) entry.reasons[0] += `\n(NOTE: ${it.unreachableNote})`;
    // XXE: did the program under test go to the network?
    const tokens = [].concat(it.token || []);
    for (const t of tokens) if (hits.some((u) => u.includes(t))) { entry.status = 'FAIL'; entry.reasons.push(`Emboss fetched an external address named in the file (${httpBase}/${t}): external entities must never be fetched`); }
    row.items.push(entry);
  }
  const rssBudget = unit.budget.rssMB;
  for (const e of row.items) {
    if (e.status === 'FAIL') for (const reason of e.reasons) row.failures.push({ item: e.id, reason, file: e.file });
    row.warns.push(...e.warns.map((w) => ({ item: e.id, text: w })));
    row.notes.push(...e.notes.map((w) => ({ item: e.id, text: w })));
  }
  if (row.peakMB > rssBudget) row.failures.push({ item: '(unit)', reason: `peak memory ${row.peakMB} MB is over this unit's budget of ${rssBudget} MB` });
  if (!unit.battery && row.timeSec > budgetSec) row.failures.push({ item: '(unit)', reason: `took ${row.timeSec.toFixed(0)} s, budget ${Math.round(budgetSec)} s` });
  if (row.failures.length) row.status = 'FAIL';
  const failedItems = row.items.filter((e) => e.status === 'FAIL').length;
  row.summary = unit.battery ? `${row.items.length - failedItems}/${row.items.length}` : '';
  try { fs.writeFileSync(path.join(outDir, 'logs', `${safe(unit.id)}.json`), JSON.stringify({ id: unit.id, budget: unit.budget, status: row.status, timeSec: row.timeSec, peakMB: row.peakMB, failures: row.failures, warns: row.warns, notes: row.notes, items: row.items }, null, 1)); } catch { /* ignore */ }
  if (row.status === 'pass' && !args.out && !args.keep) fs.rmSync(dir, { recursive: true, force: true });
  return row;
}

// ---------------------------------------------------------------- report
const pad = (s, n) => (String(s).length >= n ? String(s) : String(s) + ' '.repeat(n - String(s).length));
const padL = (s, n) => (String(s).length >= n ? String(s) : ' '.repeat(n - String(s).length) + String(s));
const oneLine = (r) => {                                   // the first failure of a unit, short enough for the table
  const f = r.failures[0];
  if (!f) return '';
  const t = f.reason.split('\n')[0].replace(/^(parse|bana-g2|ukaaf-g2[a-z-]*|nimas-export|nimas-reread|ebraille|pef|inspect): /, (m) => m).replace(/the JavaScript heap passed its \d+ MB limit/, 'heap limit passed');
  return `${r.failures.length > 1 ? `(+${r.failures.length - 1}) ` : ''}${f.item === r.unit.label || f.item === '(unit)' ? '' : f.item + ': '}${t}`.slice(0, 110);
};
function printTable(rows) {
  const w = Math.max(12, ...rows.map((r) => r.unit.id.length));
  console.log('\n' + pad('UNIT (case:format)', w) + '  ' + pad('RESULT', 22) + padL('TIME s', 8) + padL('PEAK MB', 9) + padL('INPUT', 9) + padL('BUDGET s/MB', 14) + '  WHY (first failure)');
  console.log('-'.repeat(w + 66 + 22));
  for (const r of rows) {
    const res = r.status === 'pass' ? `pass${r.summary ? ' ' + r.summary : ''}${r.warns.length ? ` (${r.warns.length} warn)` : ''}` : `FAIL${r.summary ? ' ' + r.summary : ''}`;
    const kb = r.inputBytes >= 1048576 ? `${(r.inputBytes / 1048576).toFixed(1)} MB` : `${Math.round((r.inputBytes || 0) / 1024)} KB`;
    console.log(pad(r.unit.id, w) + '  ' + pad(res, 22) + padL(r.timeSec.toFixed(1), 8) + padL(r.peakMB || '-', 9) + padL(kb, 9) + padL(`${Math.round(r.unit.budget.timeSec * args.timeScale)}/${r.unit.budget.rssMB}`, 14) + (r.status === 'FAIL' ? '  ' + oneLine(r) : ''));
  }
}
function printDetails(rows) {
  const bad = rows.filter((r) => r.status === 'FAIL');
  if (bad.length) {
    console.log(`\nFAILURES (${bad.reduce((n, r) => n + r.failures.length, 0)} in ${bad.length} unit(s))`);
    for (const r of bad) {
      console.log(`\n* ${r.unit.id}`);
      for (const f of r.failures) {
        const text = f.reason.split('\n');
        console.log(`    ${f.item === r.unit.label ? '' : `[${f.item}] `}${text[0]}`);
        for (const l of text.slice(1, 7)) console.log(`        ${l}`);
        if (f.file) console.log(`        input: ${f.file}`);
      }
      if (r.unit.caseId !== 'file') console.log(`    repeat: node Emboss/scripts/check-extreme-documents.mjs --filter "${r.unit.id}" --out <dir>${args.seed !== 20261002 ? ` --seed ${args.seed}` : ''}`);
      const first = r.failures.find((f) => f.file);
      if (first) console.log(`    one input alone: node Emboss/scripts/check-extreme-documents.mjs --file "${first.file}"`);
    }
  }
  const diffs = rows.flatMap((r) => r.notes.filter((n) => /round trip/.test(n.text)).map((n) => `${r.unit.id}${r.unit.battery ? ` [${n.item}]` : ''}: ${n.text}`));
  if (diffs.length) { console.log(`\nNIMAS ROUND-TRIP DIFFERENCES (reported, not failed; ${diffs.length})`); for (const d of diffs.slice(0, 40)) console.log('  ' + d); if (diffs.length > 40) console.log(`  ... and ${diffs.length - 40} more (see the logs)`); }
  const warns = rows.flatMap((r) => r.warns.map((n) => `${r.unit.id}${r.unit.battery ? ` [${n.item}]` : ''}: ${n.text}`));
  if (warns.length) { console.log(`\nWARNINGS (do not fail the run; ${warns.length})`); for (const d of warns.slice(0, 40)) console.log('  ' + d); if (warns.length > 40) console.log(`  ... and ${warns.length - 40} more (see the logs)`); }
}

// ---------------------------------------------------------------- main
const { cases, units } = selectUnits();
if (args.list) {
  for (const c of cases) {
    const us = units.filter((u) => u.caseId === c.id);
    if (!us.length) continue;
    console.log(`${c.id}  ${c.title}`);
    for (const u of us) console.log(`    ${pad(u.id, 52)} ${u.battery ? 'battery' : u.ext}  budget ${u.budget.timeSec}s / heap ${u.budget.heapMB} MB / rss ${u.budget.rssMB} MB`);
  }
  console.log(`\n${units.length} units${args.heavy ? ' (including --heavy)' : ''}`);
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(0);
}
if (!fs.existsSync(path.resolve(HERE, '..', '..', 'liblouis', 'tables'))) { console.error('liblouis/tables is missing: see AGENTS.md "Working in your own worktree"'); process.exit(2); }
if (!units.length) { console.error('no unit matches --filter'); process.exit(2); }

await startServer();
console.log(`Extreme-document test set: ${units.length} unit(s), seed ${args.seed}, ${args.jobs} job(s), time scale ${args.timeScale}${args.heavy ? ', HEAVY' : ''}`);
console.log(`node ${process.version}, ${os.cpus().length} cpus, load ${os.loadavg().map((x) => x.toFixed(1)).join(' ')}, ${Math.round(os.totalmem() / 1073741824)} GB RAM`);
console.log(`working folder: ${outDir}`);
const started = Date.now();
const rows = new Array(units.length);
let next = 0, finished = 0;
const live = new Set();
process.on('SIGINT', () => { console.log('\ninterrupted; inputs kept in ' + outDir); process.exit(130); });
async function lane() {
  while (next < units.length) {
    const i = next++;
    const u = units[i];
    live.add(u.id);
    let row;
    try { row = await runUnit(u, i, units.length); }
    catch (e) { row = { unit: u, status: 'FAIL', items: [], timeSec: 0, peakMB: 0, failures: [{ item: '(runner)', reason: `the test runner itself failed: ${e.stack || e}` }], warns: [], notes: [] }; }
    live.delete(u.id);
    rows[i] = row;
    finished++;
    console.log(`[${padL(finished, String(units.length).length)}/${units.length}] ${pad(u.id, 52)} ${pad(row.status === 'pass' ? 'pass' + (row.summary ? ' ' + row.summary : '') : 'FAIL' + (row.summary ? ' ' + row.summary : ''), 14)} ${padL(row.timeSec.toFixed(1), 7)} s ${padL(row.peakMB || '-', 6)} MB`);
  }
}
await Promise.all(Array.from({ length: Math.min(args.jobs, units.length) }, lane));
server.close();
printTable(rows);
printDetails(rows);
const failedUnits = rows.filter((r) => r.status === 'FAIL').length;
const total = (Date.now() - started) / 1000;
console.log(`\n${units.length - failedUnits}/${units.length} units passed, ${failedUnits} failed; ${Math.floor(total / 60)} min ${Math.round(total % 60)} s`);
if (!failedUnits && !args.out && !args.keep) { try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ } }
else console.log(`inputs and logs kept in ${outDir}`);
process.exit(failedUnits ? 1 : 0);
