#!/usr/bin/env node
// Layout parity checker (Fable review #2, interim step — Emboss/docs/fable-review-26sep.md
// recommendation 2): Emboss lays a block out TWICE, by two hand-maintained code paths that
// must produce byte-identical output but are proven to agree only on a hand-picked set of
// synthetic blocks (tests/single_pass_layout.test.mjs):
//
//   - formatBlock/traceBlock (format/document.mjs) — traceBlock is a "mirror" of
//     formatBlock's own switch, case for case (167 "mirror"/"A39" comments in
//     document.mjs), that additionally carries a source-offset per cell. buildDocPages
//     (A39) already prefers traceBlock's own lines as the formatted output whenever
//     o.translatePos is set — which is always, in the editor — instead of calling
//     formatBlock too and throwing its result away. Every headless test and the gold
//     runner (scripts/gold-run.mjs) call formatBlock/formatDocument WITHOUT
//     translatePos, so they only ever exercise the OTHER path. A block type or branch
//     missing from traceBlock's switch (as dialogue/code both once were — see
//     single_pass_layout.test.mjs's own header comment) silently changes what the
//     editor shows without any headless test or gold sample ever noticing.
//   - formatDocument (no o.translatePos — the test/gold path) vs the exact call the
//     editor makes to lay out a page (web/editor/editor.mjs's render():
//     `formatDocumentAsync(model, { ...opts, translatePos, trace })` — confirmed by
//     reading editor.mjs directly, not assumed).
//
// This script re-runs that comparison — the same method single_pass_layout.test.mjs
// uses (formatBlock vs traceBlock on the same block+opts+atStart) — but over every
// block of a broad, real corpus instead of a hand-picked set, plus the page-level
// formatDocument-vs-editor comparison single_pass_layout.test.mjs does not attempt at
// all. It does NOT fix anything it finds (Paul's brief for this task): a difference
// found here is a real bug the editor shows that no other test sees, to be triaged and
// fixed separately.
//
// Corpus (every document, every block):
//   - every tests/nimas_samples/*.xml (19 files, including the three real NIMAS books)
//   - every tests/real_samples/**/* (docx/odt/epub/html/md/rtf real-world files)
//   - every tests/fixtures/libreoffice/*.{doc,docx,odt,rtf} (the .emf fixture is not a
//     document — parseFile has nothing to build from it — and is skipped)
//   - every gold section's built document model (scripts/gold-run.mjs's own
//     buildModel/MODEL_BUILDERS, exported from that file for this script — see its
//     header comment for why a cache-busted dynamic import is needed to pull more than
//     one section's models in a single process)
//
// What is compared, and why each axis is scoped the way it is (reading the actual
// code, not guessing — see the comment above each check below for the grep that
// justifies the scope):
//   1. Per block (recursively flattened: a box/sidebar/footnote's own .blocks, and a
//      list/glossary item's own .blocks, are real blocks the same formatBlock/
//      traceBlock switch dispatches on): formatBlock(block,o,atStart) vs
//      traceBlock(block,o,atStart) — line-for-line text, and the non-enumerable
//      `keepGroups` side channel (single_pass_layout.test.mjs checks this too — it
//      carries no visible text of its own, so a lines-only comparison can't see it).
//      Run in BOTH modes (bana, ukaaf). atStart:true is exercised once per document
//      (its first flattened block, both modes) — matching real usage: buildDocPages
//      tracks one running atStart flag per document that flips false after the first
//      block that produces output, so no block ever sees atStart:true more than once
//      per document in practice.
//   2. Table-format sweep: for every 'table' block (wherever it occurs, including
//      nested in a box), additionally tried at every selectable format (auto, listed,
//      columnar, paragraph, vertical, stairstep, linear, facing, interchange — the
//      full menu resolveTableLayout/tableFormatMode recognise) by overriding
//      block.format, both modes. Scoped to table blocks only: format/document.mjs's
//      table code is the only per-block code that reads a table-format setting at
//      all, and is also much the most expensive per-block check (column-width
//      fitting tries several layouts internally), which is why it is not applied to
//      every block.
//   3. Page-level, per document: formatDocument(doc,o) — the classic path, no
//      translatePos, what scripts/gold-run.mjs and every headless test call — against
//      formatDocumentAsync(doc, { ...o, translatePos, trace: {} }) — the exact editor
//      call (web/editor/editor.mjs render(): `const fo = { ...o, trace }; const brf =
//      await formatDocumentAsync(model, fo);`, with translatePos already on o from
//      currentFormatOpts()). Compared as plain strings; a difference is reported by
//      its first differing page/line. Run in both modes and with o.suppressHeader
//      both false and true (the "page-number settings" axis: suppressHeader/
//      pageHeaders gates header/TOC/page-numbering machinery shared by both call
//      paths — grepping document.mjs shows it is read only in page-assembly
//      functions (applyTranscriberPageSeries, applyGuideWords, the TOC page builder)
//      and the editor-only `tableLayout` helper, never inside formatBlock/
//      traceBlock's own per-block switches — so it cannot itself change whether the
//      two paths in check 1 agree, but it is a real, common deploy setting and is
//      cheap to include once per document at the page level, where it does matter).
//      NOT swept across every table format at the page level too (that would mean
//      reformatting every real book up to 9 extra times each) — table-format
//      coverage lives in check 2, which reaches the same table-rendering code far
//      more cheaply, one block at a time.
//
// Performance: parsing/building every document (~24,000 flattened blocks across ~80
// documents/gold sections) is cheap (a few seconds) and done once, up front, in the
// main thread. The formatBlock/traceBlock/formatDocument/formatDocumentAsync calls
// are the expensive part (a table block's 9-format sweep costs roughly 150-200x a
// plain block's single comparison; a whole real book's page-level check costs
// several seconds on its own) — those are what gets sharded across worker_threads,
// at BLOCK granularity (not one shard per document), because a handful of very large
// real books and table-heavy gold sections would otherwise starve the rest of a
// per-document sharding. See packTasks below for the weighting.
//
// Usage:
//   node Emboss/scripts/check-layout-parity.mjs [--jobs N] [--filter SUBSTR] [--list]
//
//   --jobs N        worker_threads count (default: min(8, cpus-1), floor 1).
//   --filter SUBSTR only check documents whose id (a file's path relative to Emboss/,
//                    or "gold/<section>/<sample id>") contains SUBSTR.
//   --list          print the corpus (document ids and block counts) and exit,
//                    without formatting anything.
//
// Exit code: 0 if every comparison agreed; 1 on any difference OR any unexpected
// throw while building/formatting a document (a script bug or a real crash both need
// looking at, so both fail the run). Prints total wall time and the check counts run,
// so a future change to the corpus can be judged against today's numbers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const __filename_ = fileURLToPath(import.meta.url);
const EMBOSS = path.resolve(path.dirname(__filename_), '..');

// Every selectable table format resolveTableLayout/tableFormatMode recognise (format/
// document.mjs: resolveTableLayout's own if-chain, plus 'interchange' handled earlier in
// formatTable). The task brief asks for {auto, listed, vertical, stairstep, linear,
// facing, interchange}; columnar and paragraph are the two resolveTableLayout can also be
// forced into directly and cost little extra to include (table blocks are a small share
// of the corpus), so all nine are swept.
const TABLE_FORMATS = ['auto', 'listed', 'columnar', 'paragraph', 'vertical', 'stairstep', 'linear', 'facing', 'interchange'];
const MODES = ['bana', 'ukaaf'];
const BINARY_EXTS = new Set(['docx', 'doc', 'odt', 'epub']);
const FILE_EXTS = new Set(['xml', 'docx', 'doc', 'odt', 'epub', 'rtf', 'html', 'htm', 'md']);

function flattenBlocks(blocks, out = []) {
  for (const b of blocks || []) {
    if (!b || typeof b !== 'object') continue;
    out.push(b);
    if (Array.isArray(b.blocks)) flattenBlocks(b.blocks, out);
    if (Array.isArray(b.items)) {
      for (const it of b.items) if (it && Array.isArray(it.blocks)) flattenBlocks(it.blocks, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Main thread: parse every document once, build the task list, shard by weight, spawn
// workers, aggregate, report.
// ---------------------------------------------------------------------------------------
function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const sub of fs.readdirSync(dir)) {
    const full = path.join(dir, sub);
    const st = fs.statSync(full);
    if (st.isDirectory()) { out.push(...listFilesRecursive(full)); continue; }
    const ext = path.extname(sub).slice(1).toLowerCase();
    if (FILE_EXTS.has(ext)) out.push(full);
  }
  return out;
}

async function buildDocuments(filter) {
  if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
  if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
  const { parseFile } = await import(pathToFileURL(path.join(EMBOSS, 'input', 'parse.mjs')).href);

  const docs = [];   // { docId, doc, errors: [] }
  const errors = [];

  const files = [
    ...listFilesRecursive(path.join(EMBOSS, 'tests', 'nimas_samples')).filter((f) => path.extname(f).toLowerCase() === '.xml'),
    ...listFilesRecursive(path.join(EMBOSS, 'tests', 'real_samples')),
    ...listFilesRecursive(path.join(EMBOSS, 'tests', 'fixtures', 'libreoffice')),
  ];
  for (const full of files) {
    const docId = path.relative(EMBOSS, full);
    if (filter && !docId.includes(filter)) continue;
    const ext = path.extname(full).slice(1).toLowerCase();
    let data, model;
    try {
      data = BINARY_EXTS.has(ext) ? fs.readFileSync(full) : fs.readFileSync(full, 'utf8');
      model = await parseFile(path.basename(full), data);
    } catch (e) {
      errors.push({ docId, reason: `parseFile threw: ${(e && e.stack) || e}` });
      continue;
    }
    if (model && Array.isArray(model.blocks)) docs.push({ docId, doc: model });
  }

  // Gold sections: cache-busted dynamic import per section — see gold-run.mjs's own
  // header comment on GOLD_RUN_SECTION / this pattern (copied from
  // gold_bana_section4.test.mjs, which needs the same trick for the same reason).
  const goldRunUrl = pathToFileURL(path.join(EMBOSS, 'scripts', 'gold-run.mjs')).href;
  process.env.GOLD_RUN_SECTION = 'section-11';
  const probe = await import(`${goldRunUrl}?enum=probe`);
  for (const section of Object.keys(probe.MODEL_BUILDERS)) {
    // Not pre-filtered on `gold/<section>` here: a sample-id filter (e.g. --filter
    // sample-11-06) must still reach loadSamples() below, so filtering happens per
    // sample, not per section.
    process.env.GOLD_RUN_SECTION = section;
    let mod;
    try { mod = await import(`${goldRunUrl}?enum=${encodeURIComponent(section)}`); }
    catch (e) { errors.push({ docId: `gold/${section}`, reason: `importing gold-run.mjs threw: ${(e && e.stack) || e}` }); continue; }
    let samples;
    try { samples = mod.loadSamples(); }
    catch (e) { errors.push({ docId: `gold/${section}`, reason: `loadSamples threw: ${(e && e.stack) || e}` }); continue; }
    for (const { sample } of samples) {
      const docId = `gold/${section}/${sample.id}`;
      if (filter && !docId.includes(filter)) continue;
      let model;
      try { model = mod.buildModel(sample); }
      catch (e) { errors.push({ docId, reason: `buildModel threw: ${(e && e.stack) || e}` }); continue; }
      if (model && model.doc && Array.isArray(model.doc.blocks)) docs.push({ docId, doc: model.doc });
    }
  }

  return { docs, errors };
}

// Greedy longest-processing-time bin-packing across `jobs` shards.
function packTasks(tasks, jobs) {
  const shards = Array.from({ length: jobs }, () => ({ items: [], total: 0 }));
  const sorted = [...tasks].sort((a, b) => b.weight - a.weight);
  for (const t of sorted) {
    let best = shards[0];
    for (const s of shards) if (s.total < best.total) best = s;
    best.items.push(t);
    best.total += t.weight;
  }
  return shards.map((s) => s.items).filter((items) => items.length);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const JOBS = Math.max(1, parseInt(flag('--jobs') ?? String(Math.max(1, Math.min(8, os.cpus().length - 1))), 10) || 1);
  const FILTER = flag('--filter');
  const LIST_ONLY = argv.includes('--list');

  const t0 = Date.now();
  const { docs, errors: buildErrors } = await buildDocuments(FILTER);
  if (!docs.length) {
    console.error(FILTER ? `No corpus document matches --filter ${FILTER}` : 'No corpus documents found.');
    for (const e of buildErrors) console.error(`  ${e.docId}: ${e.reason}`);
    process.exit(2);
  }

  // Build the task list: one entry per flattened block (weighted heavier for tables,
  // which trigger the 9-format sweep and are individually far more expensive to lay
  // out), plus one page-level entry per document (weighted by its own block count, a
  // cheap proxy for how long formatDocument/formatDocumentAsync will take on it).
  const blockTasks = [];
  const pageTasks = [];
  let totalBlocks = 0;
  for (const { docId, doc } of docs) {
    const flat = flattenBlocks(doc.blocks);
    totalBlocks += flat.length;
    flat.forEach((block, blockIndex) => {
      blockTasks.push({ kind: 'block', docId, blockIndex, block, atStart: blockIndex === 0, weight: block.type === 'table' ? 200 : 1 });
    });
    pageTasks.push({ kind: 'page', docId, doc, weight: Math.max(1, flat.length) * 2 });
  }

  if (LIST_ONLY) {
    for (const { docId, doc } of docs) console.log(docId.padEnd(70), 'blocks=' + flattenBlocks(doc.blocks).length);
    console.log(`\n${docs.length} documents/gold samples, ${totalBlocks} flattened blocks total.`);
    return;
  }

  const allTasks = [...blockTasks, ...pageTasks];
  const shards = packTasks(allTasks, Math.min(JOBS, Math.max(1, allTasks.length)));
  console.log(`check-layout-parity: ${docs.length} documents/gold samples, ${totalBlocks} flattened blocks, ${pageTasks.length} page-level checks, ${shards.length} worker(s).`);

  const results = await Promise.all(shards.map((items, i) => runShard(items, i)));

  const diffs = [...buildErrors.map((e) => ({ ...e, isBuildError: true }))];
  const errors = [];
  let blockChecks = 0, pageChecks = 0;
  for (const r of results) {
    diffs.push(...r.diffs);
    errors.push(...r.errors);
    blockChecks += r.blockChecks;
    pageChecks += r.pageChecks;
  }

  const elapsed = Date.now() - t0;
  console.log(`\n=== check-layout-parity: ${docs.length} documents, ${totalBlocks} blocks (flattened), ${blockChecks} block-level checks, ${pageChecks} page-level checks, ${elapsed} ms ===\n`);

  if (errors.length) {
    console.log(`--- ${errors.length} error(s) building/formatting a document ---`);
    for (const e of errors) console.log(`  ${e.docId}: ${e.reason}`);
    console.log('');
  }

  const realDiffs = diffs.filter((d) => !d.isBuildError);
  if (realDiffs.length) {
    console.log(`--- ${realDiffs.length} PARITY DIFFERENCE(S) (formatBlock/formatDocument vs traceBlock/editor path) ---\n`);
    for (const d of realDiffs) {
      console.log(`${d.docId}  block #${d.blockIndex ?? '-'} (${d.blockType ?? '-'})  mode=${d.mode}  atStart=${d.atStart}  variant=${d.variant}`);
      console.log(`  ${d.reason}`);
      if (d.firstDiff != null) console.log(`  first differing line ${d.firstDiff}: expected ${JSON.stringify(d.expected ?? null)} vs actual ${JSON.stringify(d.actual ?? null)}`);
      console.log('');
    }
  } else {
    console.log('No parity differences found.');
  }

  process.exit((realDiffs.length || errors.length || buildErrors.length) ? 1 : 0);
}

function runShard(items, jobId) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename_, { workerData: { items, EMBOSS, jobId } });
    w.on('message', (msg) => resolve(msg));
    w.on('error', reject);
    w.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker ${jobId} exited with code ${code}`));
    });
  });
}

// ---------------------------------------------------------------------------------------
// Worker thread: given its shard's block/page tasks (already-parsed block/doc objects —
// no re-parsing needed), runs the actual formatBlock/traceBlock/formatDocument/
// formatDocumentAsync comparisons.
// ---------------------------------------------------------------------------------------
async function workerMain() {
  const { items, EMBOSS: EMBOSS_DIR } = workerData;

  const louis = await import(pathToFileURL(path.join(EMBOSS_DIR, 'engine', 'louis.mjs')).href);
  await louis.init(path.join(EMBOSS_DIR, 'liblouis', 'tables'));
  // The translators the editor builds in currentFormatOpts() (web/editor/editor.mjs) - liblouis inside styledTranslate for
  // `translate`, inside styledTranslatePos for the position trace, and the raw grade 1 translator - through
  // format/node-translate-helper.mjs (import fix list #55, 1 Oct 2026). Before, all three were bare liblouis calls, so the
  // editor's own house style (sub/superscript level signs, quote exchange, invisible-character clean-up) was never compared
  // between the two layout paths; the grade 1 translator also dropped the typeform that the app passes.
  const { editorTranslators } = await import(pathToFileURL(path.join(EMBOSS_DIR, 'format', 'node-translate-helper.mjs')).href);
  const { translate, translatePos, translateG1 } = editorTranslators(louis);

  const { formatBlock, traceBlock, formatDocument, formatDocumentAsync } =
    await import(pathToFileURL(path.join(EMBOSS_DIR, 'format', 'document.mjs')).href);

  let mathToBrfBana = null, mathToBrfUkaaf = null;
  try {
    const { makeMathToBrf } = await import(pathToFileURL(path.join(EMBOSS_DIR, 'format', 'node-maths-helper.mjs')).href);
    mathToBrfBana = makeMathToBrf('bana');
    mathToBrfUkaaf = makeMathToBrf('ukaaf');
    mathToBrfBana('<math xmlns="http://www.w3.org/1998/Math/MathML"><mn>1</mn></math>');
  } catch { mathToBrfBana = null; mathToBrfUkaaf = null; }

  function baseOpts(mode, extra = {}) {
    return {
      mode, standard: mode, width: 38, depth: 25,
      paragraphStyle: 'indented', tableFormat: 'auto', listStyle: 'spaced', toc: true,
      translate, translatePos, translateG1,
      mathToBrf: mode === 'bana' ? mathToBrfBana : mathToBrfUkaaf,
      ...extra,
    };
  }

  const msg = (e) => (e && e.stack) || String(e);

  // Same comparison single_pass_layout.test.mjs makes for one hand-picked block: lines,
  // then the keepGroups side channel.
  function compareBlock(block, o, atStart) {
    let real, traced;
    try { real = formatBlock(block, o, atStart); } catch (e) { return { ok: false, reason: `formatBlock threw: ${msg(e)}` }; }
    try { traced = traceBlock(block, o, atStart); } catch (e) { return { ok: false, reason: `traceBlock threw: ${msg(e)}` }; }
    const tLines = traced.map((t) => t.s);
    if (tLines.length !== real.length) {
      const i = Math.min(real.length, tLines.length);
      return { ok: false, reason: `line count differs (formatBlock ${real.length}, traceBlock ${tLines.length})`, firstDiff: i, expected: real[i], actual: tLines[i] };
    }
    for (let i = 0; i < real.length; i++) {
      if (tLines[i] !== real[i]) return { ok: false, reason: `line ${i} text differs`, firstDiff: i, expected: real[i], actual: tLines[i] };
    }
    const kgReal = real.keepGroups, kgTraced = traced.keepGroups;
    if (JSON.stringify(kgReal ?? null) !== JSON.stringify(kgTraced ?? null)) {
      return { ok: false, reason: 'keepGroups differ', expected: kgReal ?? null, actual: kgTraced ?? null };
    }
    return { ok: true };
  }

  const diffs = [];
  const errors = [];
  let blockChecks = 0, pageChecks = 0;

  for (const task of items) {
    if (task.kind === 'block') {
      const { docId, blockIndex, block, atStart } = task;
      for (const mode of MODES) {
        const o = baseOpts(mode);
        blockChecks++;
        const r = compareBlock(block, o, false);
        if (!r.ok) diffs.push({ docId, blockIndex, blockType: block.type, mode, atStart: false, variant: 'base', ...r });
        if (atStart) {
          blockChecks++;
          const r2 = compareBlock(block, o, true);
          if (!r2.ok) diffs.push({ docId, blockIndex, blockType: block.type, mode, atStart: true, variant: 'base', ...r2 });
        }
        if (block.type === 'table') {
          for (const fmt of TABLE_FORMATS) {
            const variant = { ...block, format: fmt };
            blockChecks++;
            const r3 = compareBlock(variant, o, false);
            if (!r3.ok) diffs.push({ docId, blockIndex, blockType: 'table', mode, atStart: false, variant: `tableFormat:${fmt}`, ...r3 });
          }
        }
      }
      continue;
    }
    // page-level task
    const { docId, doc } = task;
    for (const mode of MODES) {
      for (const suppressHeader of [false, true]) {
        pageChecks++;
        const oClassic = baseOpts(mode, suppressHeader ? { suppressHeader: true } : {});
        const oEditor = { ...oClassic, translatePos, trace: {} };
        let classic, editorBrf;
        try { classic = formatDocument(doc, oClassic) || ''; }
        catch (e) { diffs.push({ docId, mode, atStart: '-', variant: `page:suppressHeader=${suppressHeader}`, reason: `formatDocument threw: ${msg(e)}` }); continue; }
        try { editorBrf = await formatDocumentAsync(doc, oEditor) || ''; }
        catch (e) { diffs.push({ docId, mode, atStart: '-', variant: `page:suppressHeader=${suppressHeader}`, reason: `formatDocumentAsync (editor path) threw: ${msg(e)}` }); continue; }
        if (classic !== editorBrf) {
          const cLines = classic.split(/\r\n|\n|\f/), eLines = editorBrf.split(/\r\n|\n|\f/);
          let fd = -1;
          for (let i = 0; i < Math.max(cLines.length, eLines.length); i++) { if (cLines[i] !== eLines[i]) { fd = i; break; } }
          diffs.push({ docId, mode, atStart: '-', variant: `page:suppressHeader=${suppressHeader}`, reason: 'formatDocument (classic/gold path) vs formatDocumentAsync (editor path) differ', firstDiff: fd, expected: cLines[fd], actual: eLines[fd] });
        }
      }
    }
  }

  parentPort.postMessage({ diffs, errors, blockChecks, pageChecks });
}

if (isMainThread) {
  main().catch((e) => { console.error((e && e.stack) || e); process.exit(1); });
} else {
  workerMain().catch((e) => {
    // Report through parentPort rather than throwing, so a bug in one shard doesn't
    // just crash silently — the 'error' listener in runShard would reject the whole
    // run, which is still correct (a script bug and a real crash both need looking at).
    parentPort.postMessage({ diffs: [], errors: [{ docId: '(worker)', reason: (e && e.stack) || String(e) }], blockChecks: 0, pageChecks: 0 });
  });
}
