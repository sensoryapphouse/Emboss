// Audit batch S3a (ChatGPT audit 15 Oct 2026, docs/chatgpt-audit-15oct.md): engine and layout items #12, #13, #14, #15, #16, #31.
//  #12 a table whose included file failed to download once is retried (engine/louis-browser.mjs ensureTables)
//  #13 init() is ready only after the startup tables are in; a rejected init can be retried (louis-browser.mjs)
//  #14 UKAAF manual/imported contents entries carry the Title Page offset (format/document.mjs tocPageMap)
//  #15 cached block warnings are re-pointed at the block's CURRENT index on every reuse (format/document.mjs)
//  #16 Korean NFC and NFD give the same contracted braille, in both wrappers (engine/unicode-nfc.mjs)
//  #31 a long unbroken token wraps in linear time, byte-identical output (format/layout.mjs)
//
// louis-browser.mjs is exercised in Node: its wasmFactory is the Node-loadable emscripten glue and `fetch` is a stub that serves the
// real tables (or small virtual ones) from memory, so a failing or paused download can be arranged. Every scenario imports a FRESH copy
// of the module (a query string makes a new module instance), because the module keeps its engine in module-level state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLES_DIR = path.join(EMBOSS, 'liblouis', 'tables');
const require = createRequire(import.meta.url);
const createLiblouis = require(path.join(EMBOSS, 'engine', 'liblouis-wasm.js'));

// ---------------------------------------------------------------------------------------------------------------------------------
// the browser wrapper, in Node
let instance = 0;
async function freshBrowserEngine() {
  return import(pathToFileURL(path.join(EMBOSS, 'engine', 'louis-browser.mjs')).href + '?s3a=' + (++instance));
}
// A fetch stub. `virtual`: name -> text served instead of a file; `failures`: name -> how many times to answer 503 before succeeding;
// `hold`: a promise every request waits for first. `log`: every requested name, in order.
function makeFetch({ virtual = {}, failures = {}, hold = null } = {}) {
  const log = [];
  const left = { ...failures };
  const stub = async (url) => {
    const name = String(url).split('/').pop();
    log.push(name);
    if (stub.hold) await stub.hold;
    if (left[name] > 0) { left[name]--; return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }; }
    let bytes = null;
    if (name in virtual) bytes = Buffer.from(virtual[name], 'utf8');
    else { try { bytes = fs.readFileSync(path.join(TABLES_DIR, name)); } catch { /* not found */ } }
    if (!bytes) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  stub.log = log;
  stub.hold = hold;
  stub.count = (name) => log.filter((n) => n === name).length;
  return stub;
}
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });
const initOpts = { tablesBaseUrl: 'mem:', wasmFactory: () => createLiblouis() };

// A tiny table graph: custom.ctb includes mid.uti includes leaf.uti; leaf.uti defines a and b as letters.
const GRAPH = {
  'custom.ctb': 'include mid.uti\n',
  'mid.uti': 'include leaf.uti\n',
  'leaf.uti': 'letter a 1\nletter b 12\n',
};
const CUSTOM = '/tables/unicode.dis,/tables/custom.ctb';

// ---------------------------------------------------------------------------------------------------------------------------------
// #12
test('#12 a table whose included file failed once is fetched again on retry, installed and usable', async () => {
  const f = globalThis.fetch = makeFetch({ virtual: GRAPH, failures: { 'leaf.uti': 1 } });
  const louis = await freshBrowserEngine();
  await louis.init(initOpts);
  await assert.rejects(louis.ensureTables(CUSTOM), /leaf\.uti/);
  assert.equal(f.count('leaf.uti'), 1);
  const got = await louis.ensureTables(CUSTOM);                       // retry, no reload
  assert.equal(f.count('leaf.uti'), 2, 'the dependency is requested again');
  assert.ok(got.includes('leaf.uti'), 'and reported as fetched');
  assert.equal(louis.translate('ab', CUSTOM), '⠁⠃', 'and the table compiles and translates');
  const third = await louis.ensureTables(CUSTOM);                     // now fully ready: nothing more to fetch
  assert.deepEqual(third, []);
  assert.equal(f.count('leaf.uti'), 2);
});

test('#12 two requests at once while a nested include fails once: the second repairs it (A89 serialisation kept)', async () => {
  const f = globalThis.fetch = makeFetch({ virtual: GRAPH, failures: { 'leaf.uti': 1 } });
  const louis = await freshBrowserEngine();
  await louis.init(initOpts);
  const first = louis.ensureTables(CUSTOM).then(() => 'ok', (e) => 'failed: ' + e.message);
  const second = louis.ensureTables(CUSTOM).then(() => 'ok', (e) => 'failed: ' + e.message);
  const [a, b] = await Promise.all([first, second]);
  assert.match(a, /^failed: .*leaf\.uti/);
  assert.equal(b, 'ok', 'the queued request retried the failed part');
  assert.equal(louis.translate('ab', CUSTOM), '⠁⠃');
});

test('#12 a mid-level include that failed once is retried and its own includes are then followed', async () => {
  const f = globalThis.fetch = makeFetch({ virtual: GRAPH, failures: { 'mid.uti': 1 } });
  const louis = await freshBrowserEngine();
  await louis.init(initOpts);
  await assert.rejects(louis.ensureTables(CUSTOM), /mid\.uti/);
  await louis.ensureTables(CUSTOM);
  assert.equal(f.count('mid.uti'), 2);
  assert.equal(f.count('leaf.uti'), 1);
  assert.equal(louis.translate('ab', CUSTOM), '⠁⠃');
});

test('#12 cyclic includes still terminate, each file fetched once; a permanent 404 fails every time, not just the first', async () => {
  const f = globalThis.fetch = makeFetch({ virtual: { 'cyc-a.ctb': 'include cyc-b.uti\n', 'cyc-b.uti': 'include cyc-a.ctb\n', 'gone.ctb': 'include missing.uti\n' } });
  const louis = await freshBrowserEngine();
  await louis.init(initOpts);
  await louis.ensureTables('/tables/cyc-a.ctb');
  assert.equal(f.count('cyc-a.ctb'), 1);
  assert.equal(f.count('cyc-b.uti'), 1);
  await louis.ensureTables('/tables/cyc-a.ctb');
  assert.equal(f.count('cyc-b.uti'), 1, 'a table that is ready is not fetched again');
  await assert.rejects(louis.ensureTables('/tables/gone.ctb'), /missing\.uti/);
  await assert.rejects(louis.ensureTables('/tables/gone.ctb'), /missing\.uti/);   // used to "succeed" the second time
  assert.equal(f.count('missing.uti'), 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// #13
test('#13 init() called again while the startup tables are still loading does not report ready early', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const f = globalThis.fetch = makeFetch({ hold });
  const louis = await freshBrowserEngine();
  const p1 = louis.init(initOpts);
  // let the wasm instance come up and the table requests start, so the engine exists but its tables are not in
  for (let i = 0; i < 50 && f.log.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(f.log.length > 0, 'the startup table requests have started');
  let secondDone = false;
  const p2 = louis.init(initOpts).then((v) => { secondDone = true; return v; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(secondDone, false, 'the second caller is still waiting while the tables are loading');
  release();
  const [v1, v2] = await Promise.all([p1, p2]);
  assert.equal(v1, v2);
  assert.equal(louis.translate('hello world'), louis.translate('hello world'));
  assert.ok(louis.translate('hello world').length > 0, 'every caller finds a usable engine with the UEB tables');
});

test('#13 a failed startup preload leaves the engine unusable, and init() can be retried', async () => {
  const f = globalThis.fetch = makeFetch({ failures: { 'spaces.uti': 1 } });
  const louis = await freshBrowserEngine();
  await assert.rejects(louis.init(initOpts), /spaces\.uti/);
  assert.throws(() => louis.translate('a'), /init/, 'a failed init is not published as a ready engine');
  const before = f.log.length;
  const v = await louis.init(initOpts);                                // retry
  assert.ok(f.log.length > before, 'the retry goes back to the network');
  assert.match(String(v), /\d/);
  assert.equal(louis.translate('hello'), louis.translate('hello'));
  assert.ok(louis.translate('hello').length > 0);
  const afterRetry = f.log.length;
  await louis.init(initOpts);                                          // once ready, a further call costs nothing
  assert.equal(f.log.length, afterRetry);
});

test('#13 callers that start together share one init and all see the same engine', async () => {
  const f = globalThis.fetch = makeFetch();
  const louis = await freshBrowserEngine();
  const [a, b, c] = await Promise.all([louis.init(initOpts), louis.init(initOpts), louis.init(initOpts)]);
  assert.equal(a, b); assert.equal(b, c);
  assert.equal(f.count('unicode.dis'), 1, 'the startup tables were fetched once, not once per caller');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// #16
const KO_TABLE = '/tables/unicode.dis,/tables/ko-g2.ctb';
const KO_CASES = [
  ['a syllable', '\uac00'],
  ['a two-syllable word', '\ud55c\uae00'],
  ['a sentence', '\ud55c\uae00\uc740 \ub300\ud55c\ubbfc\uad6d\uc758 \ubb38\uc790\uc785\ub2c8\ub2e4.'],
  ['Latin with composed accents', 'G\u00e9n\u00e9ral'],
  ['mixed', 'abc \ud55c\uae00 G\u00e9n\u00e9ral xyz'],
];
const nfd = (s) => s.normalize('NFD');
const nfc = (s) => s.normalize('NFC');

async function koWrappers() {
  const node = await import(pathToFileURL(path.join(EMBOSS, 'engine', 'louis.mjs')).href);
  await node.init(TABLES_DIR);
  globalThis.fetch = makeFetch();
  const browser = await freshBrowserEngine();
  await browser.init(initOpts);
  await browser.ensureTables(KO_TABLE);
  return { node, browser };
}

test('#16 Korean and accented text: NFC and NFD give the same braille, in both wrappers, with and without positions', async () => {
  const { node, browser } = await koWrappers();
  for (const [name, w] of [['louis.mjs', node], ['louis-browser.mjs', browser]]) {
    for (const [what, text] of KO_CASES) {
      const table = what.startsWith('Latin') ? w.TABLES.uebG2 : KO_TABLE;
      assert.equal(w.translate(nfd(text), table), w.translate(nfc(text), table), `${name} translate: ${what}`);
      const d = w.translatePos(nfd(text), table), c = w.translatePos(nfc(text), table);
      assert.equal(d.braille, c.braille, `${name} translatePos: ${what}`);
      assert.equal(d.braille, w.translate(nfc(text), table), `${name}: translatePos braille is translate's: ${what}`);
    }
  }
});

test('#16 Korean: inputPos maps back to the ORIGINAL (decomposed) characters', async () => {
  const { node, browser } = await koWrappers();
  const text = '\u1112\u1161\u11ab\u1100\u1173\u11af';                // \ud55c\uae00 as six Jamo
  assert.equal(text.length, 6);
  for (const [name, w] of [['louis.mjs', node], ['louis-browser.mjs', browser]]) {
    const { braille, inputPos } = w.translatePos(text, KO_TABLE);
    assert.equal(inputPos.length, braille.length, name);
    assert.ok(inputPos.every((p) => Number.isInteger(p) && p >= 0 && p < text.length), `${name}: every position is an index into the source ${JSON.stringify(inputPos)}`);
    // the first syllable is the first three Jamo, the second syllable the last three
    const first = nfc('\u1112\u1161\u11ab'), second = nfc('\u1100\u1173\u11af');
    const cellsOfFirst = w.translatePos(first, KO_TABLE).braille.length;
    assert.ok(inputPos.slice(0, cellsOfFirst).every((p) => p < 3), `${name}: the first syllable's cells point into its Jamo ${JSON.stringify(inputPos)}`);
    assert.ok(inputPos.slice(cellsOfFirst).every((p) => p >= 3), `${name}: the second syllable's cells point into its Jamo ${JSON.stringify(inputPos)}`);
    assert.equal(second.length, 1);
  }
  // an NFC string is untouched: positions are the plain ones
  for (const w of [node, browser]) assert.deepEqual(w.translatePos('\uac00', KO_TABLE).inputPos, [0]);
});

test('#16 accented Latin keeps its position map in both wrappers (decomposed e + acute)', async () => {
  const { node, browser } = await koWrappers();
  const text = 'Ge\u0301ne\u0301ral';                                      // decomposed: 9 code units for 7 letters
  for (const w of [node, browser]) {
    const { braille, inputPos } = w.translatePos(text, w.TABLES.uebG2);
    assert.equal(braille, w.translate('G\u00e9n\u00e9ral', w.TABLES.uebG2));
    assert.ok(Math.max(...inputPos) <= text.length - 1);
    assert.equal(inputPos[inputPos.length - 1], text.length - 1, 'the last cell is the final "l"');
  }
});

test('#16 the shared normaliser: output is always String.normalize("NFC"), the map points at the source cluster', async () => {
  const { normalizeNfc } = await import(pathToFileURL(path.join(EMBOSS, 'engine', 'unicode-nfc.mjs')).href);
  const cases = ['', 'plain ascii', 'Ge\u0301ne\u0301ral', '\u1112\u1161\u11ab\u1100\u1173\u11af', 'a\u0323\u0301', 'a\u0301\u0323', '\u1100\u1161\u11a8x', '\uac00\u11a8', 'no\u0308\u0308 effect', '\u{1F4A1}e\u0301'];
  for (const s of cases) {
    const r = normalizeNfc(s, null);
    assert.equal(r.text, s.normalize('NFC'), JSON.stringify(s));
    if (r.text === s) { assert.equal(r.map, null); continue; }
    assert.equal(r.map.length, r.text.length, JSON.stringify(s));
    assert.ok(r.map.every((p, i) => p >= 0 && p < s.length && (i === 0 || p >= r.map[i - 1])), `monotone, inside the source: ${JSON.stringify(s)} ${JSON.stringify(r.map)}`);
  }
  const hangul = normalizeNfc('\u1112\u1161\u11ab\u1100\u1173\u11af', null);
  assert.deepEqual(hangul.map, [0, 3]);
  const tf = normalizeNfc('\u1112\u1161\u11ab\u1100\u1173\u11af', [1, 1, 1, 2, 2, 2]);
  assert.deepEqual(tf.typeform, [1, 2], 'a typeform array follows the composed characters');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// #31
const layout = await import(pathToFileURL(path.join(EMBOSS, 'format', 'layout.mjs')).href);

test('#31 hard-wrapping one huge token: 400,000 cells, output unchanged (the speed is checked by growth below)', () => {
  const N = 400000, W = 40;
  const braille = 'A'.repeat(N);
  const src = Array.from({ length: N }, (_, i) => i);
  let t0 = performance.now();
  const r = layout.wrapCellsSrc(braille, src, W, 2, 0);
  const tSrc = performance.now() - t0;
  // content: every cell exactly once, in order, in lines no wider than W; the first line is indented by 2
  assert.equal(r.lines.length, 1 + Math.ceil((N - (W - 2)) / W));
  assert.equal(r.lines[0], '  ' + 'A'.repeat(W - 2));
  assert.ok(r.lines.slice(1, -1).every((l) => l === 'A'.repeat(W)));
  assert.equal(r.lines.join('').replace(/ /g, '').length, N);
  const flat = r.srcs.flat().filter((x) => x !== null);
  assert.equal(flat.length, N);
  assert.ok(flat.every((x, i) => x === i), 'the source positions come out in order, once each');
  assert.ok(r.srcs.every((s, i) => s.length === r.lines[i].length), 'srcs stay parallel to lines');

  t0 = performance.now();
  const plain = layout.wrapCells(braille, W, 2, 0);
  const tPlain = performance.now() - t0;
  assert.deepEqual(plain, r.lines, 'the traced and the plain wrapper agree');

  t0 = performance.now();
  const num = layout.wrapNumbered(braille, src, W, 2, 0, 3);
  const tNum = performance.now() - t0;
  assert.equal(num.lines.join('').replace(/ /g, '').length, N);
  const numFlat = num.srcs.flat().filter((x) => x !== null);
  assert.ok(numFlat.length === N && numFlat.every((x, i) => x === i));

  t0 = performance.now();
  const cnt = layout.wrapCounted(braille, src, W, 2, 0, 3);
  const tCnt = performance.now() - t0;
  const cntFlat = cnt.srcs.flat().filter((x) => x !== null);
  assert.ok(cntFlat.length === N && cntFlat.every((x, i) => x === i));
});

// Speed by GROWTH, not wall-clock (a fixed 300 ms limit failed on a loaded machine, S5b run): 4x the cells must take well under
// 8x the time (linear work grows ~4x; the old quadratic re-slicing grew ~16x). Best of three runs at each size.
test('#31 hard-wrapping grows linearly: 4x the cells takes less than 8x the time, for all four wrappers', () => {
  const W = 40;
  const best = (fn) => { let t = Infinity; for (let k = 0; k < 3; k++) { const t0 = performance.now(); fn(); t = Math.min(t, performance.now() - t0); } return t; };
  const make = (n) => ({ b: 'A'.repeat(n), s: Array.from({ length: n }, (_, i) => i) });
  const small = make(100000), big = make(400000);
  const cases = {
    wrapCellsSrc: (d) => layout.wrapCellsSrc(d.b, d.s, W, 2, 0),
    wrapCells: (d) => layout.wrapCells(d.b, W, 2, 0),
    wrapNumbered: (d) => layout.wrapNumbered(d.b, d.s, W, 2, 0, 3),
    wrapCounted: (d) => layout.wrapCounted(d.b, d.s, W, 2, 0, 3),
  };
  // Up to three measurements per wrapper: one quiet one showing linear growth is enough (a release check on a machine loaded at
  // 100+ measured 6 ms / 49 ms = 8.9x once); quadratic code (the old one grew 19x) never shows a ratio under 8.
  for (const [name, fn] of Object.entries(cases)) {
    const seen = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const ts = best(() => fn(small)), tb = best(() => fn(big));
      seen.push(`${ts.toFixed(0)} ms -> ${tb.toFixed(0)} ms (${(tb / Math.max(ts, 1)).toFixed(1)}x)`);
      if (tb / Math.max(ts, 1) < 8) break;
    }
    const last = seen[seen.length - 1];
    assert.ok(Number(last.match(/\(([\d.]+)x\)$/)[1]) < 8, `${name}: 100,000 -> 400,000 cells never grew under 8x: ${seen.join('; ')} (quadratic would be ~16x)`);
  }
});

test('#31 chunking of long words among short ones: exact lines and parallel source positions', () => {
  const braille = 'AB ' + 'C'.repeat(25) + ' D ' + 'E'.repeat(10);
  const src = Array.from({ length: braille.length }, (_, i) => 100 + i);
  const r = layout.wrapCellsSrc(braille, src, 10, 2, 1);
  assert.deepEqual(r.lines, ['  AB', ' CCCCCCCCC', ' CCCCCCCCC', ' CCCCCCC D', ' EEEEEEEEE', ' E']);
  assert.deepEqual(layout.wrapCells(braille, 10, 2, 1), r.lines);
  // source positions: indent and joins are null, every cell keeps its own position
  assert.deepEqual(r.srcs[0], [null, null, 100, 101]);
  assert.deepEqual(r.srcs[1], [null, ...Array.from({ length: 9 }, (_, k) => 103 + k)]);
  assert.deepEqual(r.srcs[3], [null, ...Array.from({ length: 7 }, (_, k) => 121 + k), null, 129]);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// formatter items
const { formatDocument, formatDocumentAsync } = await import(pathToFileURL(process.env.DOCUMENT_MJS || path.join(EMBOSS, 'format', 'document.mjs')).href);   // DOCUMENT_MJS: run the same tests against a pre-change copy
const up = (s) => String(s).toUpperCase();
const posOf = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const fopts = (mode, extra = {}) => ({ mode, width: 40, depth: 25, translate: up, translatePos: posOf, ...extra });
const brlNum = (n) => '#' + String(n).replace(/\d/g, (d) => 'JABCDEFGHI'[d]);

// #14
const filler = (n) => Array.from({ length: n }, (_, i) => ({ type: 'para', text: `Paragraph ${i} with enough words to fill a braille line or two here.` }));
function ukContentsDoc(fill) {
  return { title: 'A Book', blocks: [{ type: 'titlepage' }, { type: 'pagenum', page: '1', text: '1' },
    { type: 'list', kind: 'toc', items: [{ text: 'Chapter One', page: '1' }] },
    ...filler(fill), { type: 'heading', level: 1, text: 'Chapter One' }, { type: 'para', text: 'Body text of chapter one.' }] };
}
function contentsAgainstActual(brf) {
  const pages = brf.replace(/\r/g, '').split('\f');
  let actual = 0;
  pages.forEach((p, i) => { if (p.split('\n').some((l) => l.trim() === 'CHAPTER ONE')) actual = i + 1; });   // the heading, centred on its own line
  let cited = null;
  for (const p of pages) for (const l of p.split('\n')) { const m = l.match(/^CHAPTER ONE -+\s+\S+\s+(#\S+)$/); if (m) cited = m[1]; }
  return { actual, cited };
}
for (const fill of [0, 40]) {
  test(`#14 UKAAF Title Page + manual contents (${fill} paragraphs before the chapter): the entry cites the page the chapter is on, one-pass and async`, async () => {
    const doc = ukContentsDoc(fill);
    const sync = contentsAgainstActual(formatDocument(doc, fopts('ukaaf')));
    assert.ok(sync.actual >= 3, 'the Title Page (1) and notice (2) come first');
    assert.equal(sync.cited, brlNum(sync.actual), 'one-pass formatter');
    const asyn = contentsAgainstActual(await formatDocumentAsync(doc, fopts('ukaaf')));
    assert.equal(asyn.actual, sync.actual);
    assert.equal(asyn.cited, brlNum(asyn.actual), 'async formatter (the editor path)');
  });
}
test('#14 a Transcriber\'s Note page (its own T-series) ahead of the chapter: the manual contents cites the number printed on the chapter\'s page', async () => {
  const doc = ukContentsDoc(40);
  doc.blocks.splice(1, 0, { type: 'para', text: 'A transcriber note.', matter: 'transcriber' });
  for (const [label, brf] of [['one-pass', formatDocument(doc, fopts('ukaaf'))], ['async', await formatDocumentAsync(doc, fopts('ukaaf'))]]) {
    const pages = brf.replace(/\r/g, '').split('\f');
    assert.ok(pages.some((p) => /^\s*T#/.test(p.split('\n')[0])), 'there is a T-series page');
    const head = pages.find((p, i) => i > 2 && p.split('\n').some((l) => l.trim() === 'CHAPTER ONE'));
    const printed = head.split('\n')[0].trim().split(/\s+/).pop();
    const cited = pages.join('\n').match(/^CHAPTER ONE -+\s+\S+\s+(#\S+)$/m)[1];
    assert.equal(cited, printed, label);
  }
});
test('#14 without a Title Page nothing changes: the manual contents cites the plain page', () => {
  const doc = ukContentsDoc(40);
  doc.blocks = doc.blocks.slice(1);
  const r = contentsAgainstActual(formatDocument(doc, fopts('ukaaf')));
  assert.equal(r.cited, brlNum(r.actual));
});

// #15
const pic = (src) => ({ type: 'graphic', src, alt: '' });
for (const [label, withPos, async_] of [['one-pass', false, false], ['one-pass with positions', true, false], ['async (editor path)', true, true]]) {
  test(`#15 cached warnings point at the block's current index after an insert before it — ${label}`, async () => {
    const extra = withPos ? {} : { translatePos: undefined };
    const cache = new Map();
    const run = async (blocks) => {
      const o = fopts('bana', { blockCache: cache, ...extra });
      if (async_) await formatDocumentAsync({ blocks }, o); else formatDocument({ blocks }, o);
      return o.warnings.filter((w) => w.kind === 'picture-no-description');
    };
    const A = { type: 'para', text: 'First paragraph.' };
    const P = pic('one.png');
    let w = await run([A, P]);
    assert.deepEqual(w.map((x) => x.blockIndex), [1]);
    w = await run([A, { type: 'para', text: 'Inserted before.' }, P]);       // P is block 2 now, its layout comes from the cache
    assert.deepEqual(w.map((x) => x.blockIndex), [2], 'warning follows the block');
    w = await run([P, A, { type: 'para', text: 'Inserted before.' }]);         // moved to the front
    assert.deepEqual(w.map((x) => x.blockIndex), [0]);
    w = await run([A, P, { ...P }]);                                            // a duplicate of the same block: each warning names itself
    assert.deepEqual(w.map((x) => x.blockIndex).sort(), [1, 2]);
  });
}
test('#15 cached warning objects are not shared between reuses (editing one render\'s warning does not touch the next)', async () => {
  const cache = new Map();
  const blocks = [{ type: 'para', text: 'x' }, pic('a.png')];
  const o1 = fopts('bana', { blockCache: cache });
  formatDocument({ blocks }, o1);
  o1.warnings.forEach((w) => { w.blockIndex = 99; w.message = 'mutated'; });
  const o2 = fopts('bana', { blockCache: cache });
  formatDocument({ blocks }, o2);
  assert.deepEqual(o2.warnings.map((w) => [w.blockIndex, w.message === 'mutated']), [[1, false]]);
});
