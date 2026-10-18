// Random-action ("monkey") testing of the Emboss editor and Quick Mode, in Chrome, WebKit (Safari's engine) and Firefox.
//
// Why (A89 step 3, Paul 2 Oct 2026): transcribers lost confidence in BrailleBlaster because it crashed, and the worst bugs a
// tester finds are the ones nobody wrote a test for — the Down key that stuck on every line with an equation in Safari
// (feedback 30 Sep item 19) was found by hand. This script presses keys, clicks, types, pastes, undoes, resizes the window,
// opens menus and dialogs, changes settings and loads documents at random, for minutes at a time, and after EVERY action checks
// that the page is still sound. A failed check is a bug. The script then shrinks the action list to the shortest one that still
// fails (delta debugging) and saves it as a replay file, so the bug can be reproduced with one command.
//
// Usage (needs a dev server: node Emboss/scripts/serve.mjs 8292 &):
//   node Emboss/scripts/monkey-test.mjs --port 8292 [--engines chrome,webkit,firefox] [--minutes 10] [--seed 12345]
//        [--docs nimas,docx-maths,empty,large | file paths] [--sources generated,corpus,...] [--extra-docs DIR]
//        [--page editor|quick|both] [--out DIR] [--summary FILE] [--ignore INV,INV] [--heap-mb 300] [--scale 1.5]
//   node Emboss/scripts/monkey-test.mjs --port 8292 --replay DIR/repro.json [--repeat 3]
//   node Emboss/scripts/monkey-test.mjs --list-pool        (what the sessions draw their documents from)
// The seed is printed first (a nightly run without --seed takes a random one); the same seed (and options) gives the same sessions
// and the same actions on every run (the run is as reproducible as the browser's timing allows; session k has the same documents,
// settings and actions in every engine). --minutes is the time spent on random sessions per engine; shrinking a failure takes extra
// time (--shrink-minutes, default 6 per distinct failure). Exit code 1 if there was any violation (or a harness error), 0 otherwise.
//
// Documents (monkey/docs.mjs, monkey/gendoc.mjs): each session starts from one drawn at random from -- every readable file under
// tests/fixtures/import-audit, tests/real_samples, tests/nimas_samples, tests/fixtures/libreoffice and web/test_samples (found by
// walking the folders at start-up, so new samples are picked up); web/test_corpus_1000 (if present); a FRESHLY GENERATED random
// document per session (headings, lists to depth 6, tables with spans, equations, notes, a poem, a sidebar, print pages, pictures,
// other scripts; NIMAS XML, HTML or Markdown; saved under <out>/generated/); every file of --extra-docs DIR (or the environment
// variable EMBOSS_MONKEY_DOCS) -- the extreme documents and testers' real books go there; the old fixed list; and an empty document.
// Files over 1 MB are drawn rarely and get fewer actions. A failure folder keeps a copy of every document its replay loads.
// --docs overrides all of this with a fixed list (keys of the old list, 'empty', or file paths); --sources restricts the pool to the
// named sources (generated, import-audit, real-samples, nimas-samples, libreoffice, test-samples, corpus, extra, curated, empty).
// --summary FILE: a short plain-text summary (seed, per-engine sessions / actions / violations, every distinct problem with its replay
// command), rewritten after each failure and at the end, for the nightly job to mail.
//
// What is checked after each action (a violation of any is reported with its invariant name):
//   page-error / console-error   an uncaught error or console.error (except the few harmless ones in monkey/session.mjs, with reasons)
//   crash / hang / unresponsive  the page crashed; an action never finished; page.evaluate(() => 1) took over 5 s
//   navigated-away               the page went somewhere else
//   braille-failed, brf-missing, model-missing, braille-pane-empty   (editor) after the render settles, window.lastBrf is a string,
//                                window.lastModel.blocks exists, and the braille pane does not say "Braille could not be generated"
//   block-count                  (editor) the model's block count and the text pane's top-level block count agree (empty paragraphs aside)
//   caret-lost                   (editor) after a click into the text the focus / caret is not lost to document.body
//   stuck                        (editor) an arrow key pressed 3 times in a row with a collapsed caret, away from the document's
//                                edge, never moved the caret
//   save-export                  (editor) window.exportCurrentDocumentXml() threw or returned XML that does not parse
//   download-empty / download-missing   a BRF / saved file that comes out empty, or does not come at all although there is a document
//   quick-error, quick-preview-empty    (Quick Mode) the status line shows an error; a result with an empty preview
//   caret-in-card                (editor) a collapsed caret inside a card that cannot be typed in, with no card selected
//   selection-jump               (editor) one Shift+Up / Shift+Down moved the end of the selection by more than 4 top-level blocks
// and, every 15-25 actions (the 'check' action) and at the end of each editor session (monkey/checks.mjs):
//   save-reopen                  the saved XML (exportCurrentDocumentXml), loaded into a fresh editor, gives the same window.lastBrf
//   recovery-missing / recovery-differs   ~4 s after a change, reload: "Recover unsaved work?" is offered, and the recovered
//                                document's saved XML equals the one before the reload (volatile ids / dates blurred)
//   heap-growth                  (Chrome) the JS heap after a forced GC is > --heap-mb (300) above its lowest earlier value
//   settle-slow                  the braille takes > 3x the first time (and > 800 ms more) to settle after a one-letter edit
//   roundtrip-differs / roundtrip-quick-empty / roundtrip-editor-empty   the document does not survive ← Quick Mode and back
//
// Actions (monkey/actions.mjs, monkey/actions-wide.mjs): keys, arrow runs, clicks, typing, paste, undo/redo, menus, dialogs, slash
// commands, selections across blocks followed by cut / copy + paste / delete / typing over / a style change, dragging selected
// text, every Insert item and slash command (by index; 1 session in 5 is a "sweep"), 10-30 undos in a row, settings changed in
// the middle of editing through the Settings dialog (standard, grade, maths code, page size, Transcriber tools, interface language
// including right-to-left ones, then back), light/dark, a phone-width window and back, browser zoom (keys, or CSS), ← Quick Mode
// and back, a second tab (edit in it, close it), and the slow checks.
//
// Output: DIR (default: a monkey-out folder in the system temp directory) gets one folder per distinct failure: screenshot,
// the action log, the seed, the page's HTML for the text and braille panes, window.lastModel as JSON, window.lastBrf, docs/ (every
// document the replay loads), REPLAY.txt (the command), and repro.json (the shortest action list found), which --replay runs.
// Files: Emboss/scripts/monkey/*.mjs (random numbers, documents, generator, actions, checks, the session runner and the shrinker).
import { chromium, webkit, firefox } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashSeed, makeRng } from './monkey/prng.mjs';
import { DEFAULT_DOCS, resolveDoc, buildPool, pickDoc, writeGenerated, registerDoc, isLargeDoc, docSource, docFile, docFeatures, checkReaderExts } from './monkey/docs.mjs';
import { fmtAction } from './monkey/actions.mjs';
import { genActionsWide } from './monkey/actions-wide.mjs';
import { guardedRun, minimise } from './monkey/session.mjs';

// ---------------------------------------------------------------- command line
function parseArgs(argv) {
  const o = { engines: ['chrome', 'webkit', 'firefox'], minutes: 10, shrinkMinutes: 6, page: 'both', docs: null, out: null, seed: null, port: null, replay: null, repeat: 1, verbose: false, ignore: [], extraDocs: process.env.EMBOSS_MONKEY_DOCS || null, summary: null, sources: null, heapMb: 300, scale: 1, listPool: false };
  const need = (i) => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = Number(need(i++));
    else if (a === '--engines') o.engines = need(i++).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--minutes') o.minutes = Number(need(i++));
    else if (a === '--shrink-minutes') o.shrinkMinutes = Number(need(i++));
    else if (a === '--seed') o.seed = need(i++);
    else if (a === '--docs') o.docs = need(i++).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--page') o.page = need(i++);
    else if (a === '--out') o.out = need(i++);
    else if (a === '--replay') o.replay = need(i++);
    else if (a === '--repeat') o.repeat = Number(need(i++));
    else if (a === '--ignore') o.ignore = need(i++).split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--extra-docs') o.extraDocs = need(i++);
    else if (a === '--summary') o.summary = need(i++);
    else if (a === '--sources') o.sources = need(i++).split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--heap-mb') o.heapMb = Number(need(i++));
    else if (a === '--scale') o.scale = Number(need(i++));
    else if (a === '--list-pool') o.listPool = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.port && !o.listPool) throw new Error('--port N is required (a running server: node Emboss/scripts/serve.mjs N &)');
  for (const e of o.engines) if (!['chrome', 'webkit', 'firefox'].includes(e)) throw new Error(`unknown engine ${e}`);
  if (!['editor', 'quick', 'both'].includes(o.page)) throw new Error('--page must be editor, quick or both');
  return o;
}
const LAUNCH = {
  chrome: () => chromium.launch({ channel: 'chrome', headless: true, args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] }),   // gc() and exact heap sizes for the heap-growth check
  webkit: () => webkit.launch({ headless: true }),
  firefox: () => firefox.launch({ headless: true }),
};

// ---------------------------------------------------------------- sessions
// The session list is a function of (seed, index) only (and of the sample folders), so it is the same in every engine and on every run.
function makeSpec(opts, runSeed, index, engine, pool, outDir) {
  const rng = makeRng(hashSeed(runSeed, 'session', index));
  const kind = opts.page === 'both' ? rng.weighted([[65, 'editor'], [35, 'quick']]) : opts.page;
  // a generated document has its own rng, so the draws that follow do not depend on whether one was made
  const gen = (j) => () => writeGenerated(makeRng(hashSeed(runSeed, 'gen', index, j)), outDir, `${runSeed}-s${index}${j === 0 ? '' : '-l' + j}`);
  let doc, loadDocs;
  if (opts.docs) {
    doc = rng.pick(opts.docs);
    loadDocs = opts.docs.filter((k) => !isLargeDoc(k) && k !== 'empty');
  } else {
    doc = pickDoc(rng, pool, { makeGenerated: gen(0) });
    loadDocs = Array.from({ length: 6 }, (_, j) => pickDoc(rng, pool, { allowBig: false, allowEmpty: false, makeGenerated: gen(j + 1) }));
  }
  if (!loadDocs.length) loadDocs = ['nimas'];
  const large = isLargeDoc(doc);
  const mode = rng.pick(['bana', 'ukaaf']);
  const grade = rng.chance(0.2) ? 'g1' : 'g2';
  const settings = { simpleMode: kind === 'quick', mode, standard: mode, grade, brailleCode: grade === 'g1' ? 'en-ueb-g1' : 'en-ueb-g2', uiLanguage: 'en', transcriberTools: rng.chance(0.35) };
  const [w, h] = rng.pick([[1300, 900], [1300, 900], [1300, 900], [1000, 700], [1600, 1000], [800, 800], [1300, 900], [390, 844]]);
  const sweep = kind === 'editor' && !large && rng.chance(0.2);
  const base = large ? rng.range(15, 30) : kind === 'quick' ? rng.range(30, 70) : sweep ? rng.range(80, 130) : rng.range(70, 150);
  const n = Math.max(5, Math.round(base * (opts.scale || 1)));
  const actions = genActionsWide(rng, kind, n, loadDocs, { sweep, checks: !large });
  return { engine, kind, doc, settings, viewport: { width: w, height: h }, actions, runSeed, index, large, sweep, loadDocs };
}

const safe = (s) => String(s).replace(/[^a-z0-9_.-]+/gi, '_').slice(0, 60);
const mb = (b) => (b / 1048576).toFixed(b > 1048576 * 9.95 ? 0 : 1);

// every document a list of actions loads (the first document included)
function docsOf(doc, actions) {
  const keys = new Set();
  if (doc && doc !== 'empty') keys.add(doc);
  for (const a of actions) {
    if ((a.t === 'load' || a.t === 'drop') && a.doc && a.doc !== 'empty') keys.add(a.doc);
    if (a.t === 'secondTab') for (const op of a.ops || []) if (op.k === 'load' && op.doc) keys.add(op.doc);
  }
  return [...keys];
}
// copies the documents a replay loads into <dir>/docs and returns { key: 'docs/NN-name' }
function keepDocs(dir, keys) {
  const map = {};
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  keys.forEach((k, i) => {
    const f = docFile(k);
    if (!f || !fs.existsSync(f)) return;
    const rel = path.join('docs', `${String(i).padStart(2, '0')}-${path.basename(f)}`);
    try { fs.copyFileSync(f, path.join(dir, rel)); map[k] = rel; } catch { /* disk */ }
  });
  return map;
}

function replayCommand(opts, engine, reproPath) {
  return `node Emboss/scripts/monkey-test.mjs --port ${opts.port} --engines ${engine} --replay ${reproPath} --repeat 3`;
}

function writeSummary(opts, runSeed, outDir, summary, startedAt, done) {
  if (!opts.summary) return;
  const L = [];
  L.push(`Emboss random-action test: seed ${runSeed}${done ? '' : ' (still running)'}`);
  L.push(`started ${new Date(startedAt).toISOString()}, ${((Date.now() - startedAt) / 60000).toFixed(0)} min so far; engines ${opts.engines.join(', ')}; page ${opts.page}; port ${opts.port}`);
  L.push(`artefacts: ${outDir}`);
  L.push(`rerun the same sessions: node Emboss/scripts/monkey-test.mjs --port ${opts.port} --seed ${runSeed}${opts.extraDocs ? ' --extra-docs ' + opts.extraDocs : ''} --minutes ${opts.minutes}`);
  let total = 0;
  for (const [engine, S] of Object.entries(summary)) {
    const nv = [...S.failures.values()].reduce((a, f) => a + f.count, 0);
    total += nv + S.harness.length;
    L.push('');
    L.push(`${engine}: ${S.sessions} sessions (${S.editorSessions} editor, ${S.quickSessions} quick), ${S.actions} actions, ${nv} violating sessions, ${S.failures.size} distinct problem(s)${S.harness.length ? `, ${S.harness.length} harness problem(s)` : ''}`);
    for (const f of S.failures.values()) {
      L.push(`  * ${f.inv} (x${f.count}; ${f.kind}; document ${f.doc})`);
      L.push(`    ${f.msg.split('\n')[0].slice(0, 300)}`);
      if (f.examples && f.examples.length > 1) for (const e of f.examples.slice(1, 6)) L.push(`    also: session ${e.session}, ${e.doc}: ${e.msg.split('\n')[0].slice(0, 200)}`);
      if (f.repro) L.push(`    replay (${f.minimalLength} actions${f.reproducible ? '' : ', flaky'}): ${replayCommand(opts, engine, f.repro)}`);
    }
    for (const h of S.harness) L.push(`  harness problem: ${h}`);
  }
  L.push('');
  L.push(done ? (total ? `${total} problem(s).` : 'No violations.') : 'Not finished.');
  try { fs.mkdirSync(path.dirname(path.resolve(opts.summary)), { recursive: true }); fs.writeFileSync(opts.summary, L.join('\n') + '\n'); } catch (e) { console.log(`  (could not write the summary file: ${e.message})`); }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.replay) return replayMain(opts);
  const pool = buildPool({ extraDir: opts.extraDocs ? path.resolve(opts.extraDocs) : null, only: opts.sources });
  if (opts.listPool) {
    console.log('Document pool (source: files, weight):');
    for (const src of pool.sources) console.log(`  ${src.name}: ${src.files ? src.files.length + ' files' : '(made per session)'}, weight ${src.weight}${src.files ? `, ${src.files.filter((f) => f.large).length} over 1 MB` : ''}`);
    const w = await checkReaderExts(); if (w) console.log('  WARNING: ' + w);
    return;
  }
  const runSeed = opts.seed != null ? opts.seed : String(Math.floor(Math.random() * 2 ** 31));
  const outDir = path.resolve(opts.out || path.join(os.tmpdir(), `monkey-out-${runSeed}`));
  fs.mkdirSync(outDir, { recursive: true });
  const startedAt = Date.now();
  console.log(`Emboss monkey test — seed ${runSeed}, port ${opts.port}, engines ${opts.engines.join(',')}, ${opts.minutes} min each, page ${opts.page}`);
  console.log(opts.docs ? `  documents: ${opts.docs.join(', ')}` : `  documents: ${pool.sources.map((s) => `${s.name} ${s.files ? s.files.length : s.name === 'generated' ? 'one per session' : 'none loaded'}`).join(', ')}`);
  console.log(`  artefacts: ${outDir}`);
  const warn = await checkReaderExts(); if (warn) console.log('  WARNING: ' + warn);
  if (opts.ignore.length) console.log(`  IGNORING invariants: ${opts.ignore.join(', ')}`);
  const summary = {};
  let anyViolation = false;

  for (const engine of opts.engines) {
    const S = summary[engine] = { sessions: 0, actions: 0, editorSessions: 0, quickSessions: 0, failures: new Map(), harness: [], observations: new Map(), skippedActions: 0, ms: 0, docsBySource: new Map(), heapMax: 0 };
    console.log(`\n=== ${engine} ===`);
    const ref = { browser: null, launch: LAUNCH[engine] };
    const t0 = Date.now();
    const deadline = t0 + opts.minutes * 60000;
    try {
      ref.browser = await LAUNCH[engine]();
    } catch (e) {
      console.log(`  could not start ${engine}: ${e.message.split('\n')[0]}`);
      S.harness.push(`could not start: ${e.message.split('\n')[0]}`);
      anyViolation = true;
      continue;
    }
    for (let index = 0; Date.now() < deadline; index++) {
      const spec = makeSpec(opts, runSeed, index, engine, pool, outDir);
      const tag = `${engine}-s${index}`;
      const dir = path.join(outDir, `${tag}-pending`);
      const dsrc = docSource(spec.doc);
      let dsize = ''; try { dsize = resolveDoc(spec.doc).size ? `, ${mb(resolveDoc(spec.doc).size)} MB` : ''; } catch { /* unknown */ }
      const label = `session ${index}: ${spec.kind}, ${spec.doc} [${dsrc}${dsize}], ${spec.settings.mode}/${spec.settings.grade}${spec.settings.transcriberTools ? '/tools' : ''}, ${spec.viewport.width}x${spec.viewport.height}, ${spec.actions.length} actions${spec.sweep ? ', sweep' : ''}`;
      process.stdout.write(`  ${label} ... `);
      const r = await guardedRun(ref, spec, { port: opts.port, heapMb: opts.heapMb, ignore: new Set(opts.ignore), artefactDir: dir, onLog: opts.verbose ? (l) => console.log('     ' + l) : null });
      S.sessions++; S.actions += r.done;
      S.docsBySource.set(dsrc, (S.docsBySource.get(dsrc) || 0) + 1);
      if (r.perf && r.perf.heap) for (const h of r.perf.heap) S.heapMax = Math.max(S.heapMax, h.mb);
      if (spec.kind === 'editor') S.editorSessions++; else S.quickSessions++;
      for (const ob of r.observations || []) {
        const o2 = S.observations.get(ob.type) || { count: 0, first: null };
        o2.count++;
        if (!o2.first) o2.first = `session ${index} action ${ob.index}: ${ob.msg}`;
        S.observations.set(ob.type, o2);
      }
      S.skippedActions += r.log.filter((l) => /\(skipped:/.test(l)).length;
      if (!r.violation) { console.log(`ok (${r.done} actions, ${(r.ms / 1000).toFixed(0)} s)`); fs.rmSync(dir, { recursive: true, force: true }); continue; }
      const v = r.violation;
      anyViolation = true;
      if (v.inv === 'harness') { console.log(`HARNESS ERROR: ${v.msg}`); S.harness.push(`${label}: ${v.msg}`); fs.rmSync(dir, { recursive: true, force: true }); writeSummary(opts, runSeed, outDir, summary, startedAt, false); continue; }
      console.log(`VIOLATION ${v.inv} at action ${v.index}: ${v.msg.split('\n')[0].slice(0, 160)}`);
      const known = S.failures.get(v.key);
      if (known) {
        known.count++;
        known.sessions.push(index);
        known.examples.push({ session: index, doc: spec.doc, msg: v.msg });
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`     (already seen in session ${known.sessions[0]}; not shrunk again)`);
        writeSummary(opts, runSeed, outDir, summary, startedAt, false);
      } else {
        const finalDir = path.join(outDir, `${tag}-${safe(v.inv)}`);
        fs.rmSync(finalDir, { recursive: true, force: true });
        fs.renameSync(dir, finalDir);
        const entry = { inv: v.inv, msg: v.msg, key: v.key, count: 1, sessions: [index], dir: finalDir, doc: spec.doc, kind: spec.kind, repro: null, examples: [{ session: index, doc: spec.doc, msg: v.msg }] };
        S.failures.set(v.key, entry);
        console.log(`     shrinking (up to ${opts.shrinkMinutes} min) ...`);
        const m = await minimise(ref, spec, v, { port: opts.port, heapMb: opts.heapMb, ignore: new Set(opts.ignore) }, Date.now() + opts.shrinkMinutes * 60000);
        const docKeys = docsOf(spec.doc, m.actions);
        const docsMap = keepDocs(finalDir, docKeys);
        const repro = {
          version: 2, runSeed, session: index, engine, kind: spec.kind, doc: spec.doc, docSource: dsrc, docFeatures: docFeatures(spec.doc), docs: docsMap, settings: spec.settings, viewport: spec.viewport,
          invariant: v.inv, key: v.key, message: v.msg, reproducedWhenShrinking: m.reproducible, shrinkTests: m.tests, originalActions: v.index + 1,
          actions: m.actions,
        };
        entry.repro = path.join(finalDir, 'repro.json');
        entry.reproducible = m.reproducible;
        entry.minimalLength = m.actions.length;
        fs.writeFileSync(entry.repro, JSON.stringify(repro, null, 1));
        fs.writeFileSync(path.join(finalDir, 'repro-actions.txt'), m.actions.map((a, i) => `#${i} ${fmtAction(a)}`).join('\n') + '\n');
        fs.writeFileSync(path.join(finalDir, 'REPLAY.txt'), [
          `Run: ${runSeed}, session ${index}, ${engine}, ${spec.kind}; document ${spec.doc} (${dsrc}); violation ${v.inv}`,
          `Replay: ${replayCommand(opts, engine, entry.repro)}`,
          `The document(s) are copied to docs/ (repro.json "docs" maps each key to its copy); the settings, window size and actions are in repro.json.`,
          `Dev server: node Emboss/scripts/serve.mjs ${opts.port}   (from the repository root, with Emboss/liblouis and the mathcat pkg-web / pkg-nodejs folders in place)`,
          `Message: ${v.msg}`, '',
        ].join('\n'));
        console.log(m.reproducible
          ? `     shrunk ${v.index + 1} -> ${m.actions.length} actions in ${m.tests} replays${m.timedOut ? ' (time limit)' : ''}: ${entry.repro}`
          : `     did NOT reproduce when replayed with the same actions (flaky); saved as is: ${entry.repro}`);
        if (m.reproducible) {
          // artefacts of the minimal run too
          await guardedRun(ref, { ...spec, actions: m.actions }, { port: opts.port, heapMb: opts.heapMb, ignore: new Set(opts.ignore), artefactDir: path.join(finalDir, 'minimal') });
        }
        writeSummary(opts, runSeed, outDir, summary, startedAt, false);
      }
    }
    S.ms = Date.now() - t0;
    try { await ref.browser.close(); } catch { /* already gone */ }
  }

  // ---- summary
  console.log('\n================ SUMMARY ================');
  console.log(`seed ${runSeed}; artefacts in ${outDir}`);
  let total = 0;
  for (const [engine, S] of Object.entries(summary)) {
    const nv = [...S.failures.values()].reduce((a, f) => a + f.count, 0);
    total += nv + S.harness.length;
    console.log(`\n${engine}: ${S.sessions} sessions (${S.editorSessions} editor, ${S.quickSessions} quick), ${S.actions} actions (${S.skippedActions} skipped as not possible at the time), ${nv} violating sessions, ${S.failures.size} distinct, ${(S.ms / 60000).toFixed(1)} min`);
    console.log(`  documents by source: ${[...S.docsBySource].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}${engine === 'chrome' && S.heapMax ? `; highest JS heap after GC ${S.heapMax.toFixed(0)} MB` : ''}`);
    const byInv = new Map();
    for (const f of S.failures.values()) byInv.set(f.inv, (byInv.get(f.inv) || []).concat(f));
    for (const [inv, fs_] of byInv) {
      console.log(`  ${inv}:`);
      for (const f of fs_) {
        console.log(`    x${f.count} (${f.kind}, ${f.doc}; sessions ${f.sessions.join(',')}) ${f.msg.split('\n')[0].slice(0, 200)}`);
        console.log(`       ${f.dir}${f.repro ? `\n       repro (${f.minimalLength} actions${f.reproducible ? '' : ', flaky'}): ${f.repro}` : ''}`);
      }
    }
    for (const [type, ob] of S.observations) console.log(`  observation ${type}: ${ob.count} time(s) (not a violation; first: ${ob.first})`);
    for (const h of S.harness) console.log(`  harness problem: ${h}`);
  }
  console.log(total ? `\n${total} problem(s).` : '\nNo violations.');
  writeSummary(opts, runSeed, outDir, summary, startedAt, true);
  process.exit(anyViolation ? 1 : 0);
}

// ---------------------------------------------------------------- --replay
async function replayMain(opts) {
  const repro = JSON.parse(fs.readFileSync(opts.replay, 'utf8'));
  const engine = opts.engines.length === 1 ? opts.engines[0] : repro.engine;
  // the documents the failure folder kept win over the sample folders (which may have changed since)
  for (const [key, rel] of Object.entries(repro.docs || {})) {
    const f = path.resolve(path.dirname(path.resolve(opts.replay)), rel);
    if (fs.existsSync(f)) registerDoc(key, f, 'repro');
  }
  const spec = { engine, kind: repro.kind, doc: repro.doc, settings: repro.settings, viewport: repro.viewport, actions: repro.actions, runSeed: repro.runSeed, index: repro.session, large: isLargeDoc(repro.doc) };
  console.log(`Replaying ${opts.replay}: ${engine}, ${spec.kind}, ${spec.doc}, ${spec.actions.length} actions, expecting ${repro.invariant}`);
  console.log(spec.actions.map((a, i) => `  #${i} ${fmtAction(a)}`).join('\n'));
  const ref = { browser: await LAUNCH[engine](), launch: LAUNCH[engine] };
  let hits = 0;
  const messages = [];
  for (let k = 0; k < opts.repeat; k++) {
    const r = await guardedRun(ref, spec, { port: opts.port, heapMb: opts.heapMb, ignore: new Set(opts.ignore), artefactDir: opts.out ? path.join(path.resolve(opts.out), `replay-${k}`) : null, onLog: opts.verbose ? (l) => console.log('     ' + l) : null });
    const v = r.violation;
    const same = !!(v && v.key === repro.key);
    if (same) hits++;
    messages.push(v ? `${v.inv}: ${v.msg.split('\n')[0].slice(0, 200)}${same ? '' : '   (a different violation from the expected one)'}` : 'no violation');
    console.log(`  run ${k + 1}/${opts.repeat}: ${messages[messages.length - 1]}`);
  }
  await ref.browser.close();
  console.log(`REPRODUCED ${hits}/${opts.repeat}`);
  process.exit(hits ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
