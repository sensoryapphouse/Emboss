// getBlockSignature (format/document.mjs, o.blockCache's per-block cache key) used to be built from
// ~80 hand-picked block fields; a new field had to be added by hand every time, and misses have
// happened (repeatHeadings, figureType, blocked, the page-turn flags — missed until 24 Sep 2026; see
// the comment above getBlockSignature). This file is the test suite for the replacement: a canonical
// whole-block serialisation for the block's own fields (so a new field can never be missed again),
// plus a short explicit "context key" for everything genuinely read by formatBlock/traceBlock that is
// NOT a property of the block (atStart, o.* options).
//
//   1. Field coverage — every field-registry.mjs field marked cache:'key'/'nested' changes the key
//      (they are literal block/item/segment fields, so the whole-block serialisation must see them
//      change); a hand list of non-registry block fields (core/structural fields field-registry.mjs
//      does not track, plus the per-instance fields buildDocPages merges onto a block's own copy
//      before calling formatBlock/traceBlock — A23 attribCell, K1/K4 tfRun/structTf, K15
//      _facingPerPage) is checked the same way.
//   2. _key is excluded (editor node-identity tag, never read by the formatter) and key order does
//      not matter (deterministic serialisation).
//   3. Context inputs — atStart and the o.* fields this review's audit found formatBlock/traceBlock
//      (and everything they call) actually read, including two genuine misses the OLD key did not
//      have: o._boxDepth (K15, facingContext — a nested table's facing-page plan) and
//      o.listPageRules (F-35, withListKeep — a BANA list's keep-together groups).
//   4. Cache correctness over a real corpus — formatting with a shared warm blockCache, after
//      mutating a block (including a preceding block that changes a later attribution's computed
//      attribCell), must equal formatting from cold.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = await import('../format/field-registry.mjs');
const { getBlockSignature, formatDocument } = await import('../format/document.mjs');
const { parseFile } = await import('../input/parse.mjs');
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const OPTS = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };

const clone = (x) => JSON.parse(JSON.stringify(x));
const sig = (b, o = OPTS, atStart = false) => getBlockSignature(clone(b), o, atStart);

// ---------------------------------------------------------------------------------------------------------------
// 1a. Every registry field that is a real property of the block/item/segment (cache:'key' or
// cache:'nested') must change the key. (cache:'doc' fields are o.* document options, not block
// fields — some are covered separately in section 3; cache:'page' fields affect page ASSEMBLY, after
// formatBlock/traceBlock have already run, so they are correctly outside getBlockSignature's scope.)
const samplesOf = (f) => (f.samples || (f.sample ? [f.sample] : []));
function blockPair(f, s) {
  const key = f.modelKey || f.key;
  const req = f.requires || {};
  if (s.item) { const h = clone(s.item); h.items = h.items.map((it) => ({ ...it })); const off = clone(h); off.items.forEach((it) => delete it[key]); return [Object.assign(h, req), Object.assign(off, req)]; }
  if (s.segment) { const h = clone(s.segment); const off = clone(h); off.segments.forEach((g) => delete g[key]); return [Object.assign(h, req), Object.assign(off, req)]; }
  const h = { ...clone(s), ...req };
  const off = { ...h };
  delete off[key];
  return [h, off];
}
for (const f of R.FIELDS) {
  if (f.cache !== 'key' && f.cache !== 'nested') continue;
  samplesOf(f).forEach((s, i) => {
    if (s.doc) return;   // a doc-level option, not a block field — see section 3
    test(`block signature: registry field '${f.key}'${samplesOf(f).length > 1 ? ` #${i + 1}` : ''} (cache:${f.cache}) changes the key`, () => {
      const [on, off] = blockPair(f, s);
      assert.notEqual(sig(on), sig(off), `${f.key} is a cache:'${f.cache}' registry field but does not change getBlockSignature`);
    });
  });
}

// 1b. Non-registry block fields: core/structural fields (always present, so field-registry.mjs does
// not track them as "optional") plus the per-instance fields merged onto a block's own copy before
// getBlockSignature is called. block.attribCell/tfRun/structTf/_facingPerPage are set by buildDocPages
// via `fb = { ...fb, someField }` (document.mjs, around the two blockCache call sites) BEFORE
// getBlockSignature(fb, o, atStart) runs — genuinely own, enumerable properties of the object the
// function receives, so the whole-block serialisation sees them for free, same as any other field.
const NON_REGISTRY_FIELDS = [
  { block: { type: 'para', text: 'a' }, field: 'text', on: 'a', off: 'b' },
  { block: { type: 'heading', level: 1, text: 'a' }, field: 'level', on: 1, off: 2 },
  { block: { type: 'para', text: 'a', style: 's1' }, field: 'style', on: 's1', off: 's2' },
  { block: { type: 'code', text: 'a', subtype: 'x' }, field: 'subtype', on: 'x', off: 'y' },
  { block: { type: 'table', headers: ['A'], rows: [['1']], format: 'f1' }, field: 'format', on: 'f1', off: 'listed' },
  { block: { type: 'list', items: [{ text: 'a', marker: 'm1' }] }, field: 'marker', on: undefined, off: undefined, custom: true },
  { block: { type: 'para', text: 'a', segments: [{ type: 'text', text: 'a' }] }, field: 'segments', on: [{ type: 'text', text: 'a' }], off: [{ type: 'text', text: 'b' }] },
  { block: { type: 'list', items: [{ text: 'a' }] }, field: 'items', on: [{ text: 'a' }], off: [{ text: 'b' }] },
  { block: { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'a' }] }, field: 'blocks', on: [{ type: 'para', text: 'a' }], off: [{ type: 'para', text: 'b' }] },
  { block: { type: 'table', headers: ['A'], rows: [['1']] }, field: 'headers', on: ['A'], off: ['B'] },
  { block: { type: 'table', headers: ['A'], rows: [['1']] }, field: 'rows', on: [['1']], off: [['2']] },
  { block: { type: 'para', text: 'a', title: 't1' }, field: 'title', on: 't1', off: 't2' },
  // per-instance fields merged onto fb by buildDocPages before the cache key is computed (A23, K1/K4, K15)
  { block: { type: 'attribution', text: 'a' }, field: 'attribCell', on: 4, off: 8 },
  { block: { type: 'para', text: 'a' }, field: 'tfRun', on: { m: 1, o: 1, c: 1 }, off: { m: 2, o: 2, c: 2 } },
  { block: { type: 'para', text: 'a' }, field: 'structTf', on: 1, off: 2 },
  { block: { type: 'table', headers: ['A'], rows: [['1']] }, field: '_facingPerPage', on: 20, off: 24 },
  { block: { type: 'table', headers: ['A'], rows: [['1']] }, field: '_interchangeTn', on: 'x', off: 'y' },
];
for (const c of NON_REGISTRY_FIELDS) {
  test(`block signature: non-registry field '${c.field}' (${c.block.type}) changes the key`, () => {
    if (c.custom) {
      const on = clone(c.block);
      const off = clone(c.block);
      off.items[0].marker = 'm2';
      assert.notEqual(sig(on), sig(off));
      return;
    }
    const on = { ...clone(c.block), [c.field]: c.on };
    const off = { ...clone(c.block), [c.field]: c.off };
    assert.notEqual(sig(on), sig(off));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 2. _key is dropped (Lexical node-identity tag; never read by formatBlock/traceBlock or anything
// they call — confirmed by grepping document.mjs for `block._`/`fb._`/`b._`: only _facingPerPage,
// _interchangeTn and _key exist, and _key is read nowhere except the old getBlockSignature itself).
// Key order must not matter, so two logically identical blocks built by different code paths (e.g.
// import vs. paste vs. undo, which can insert the same fields in a different order) never miss.
test('block signature: _key does not change the key (editor node identity, not braille)', () => {
  const a = { type: 'para', text: 'Same content.', _key: 'k1' };
  const b = { type: 'para', text: 'Same content.', _key: 'k2' };
  assert.equal(sig(a), sig(b));
});
test('block signature: field insertion order does not change the key (deterministic serialisation)', () => {
  const a = { type: 'para', text: 'x', directions: true, wordGaps: true };
  const b = { wordGaps: true, directions: true, text: 'x', type: 'para' };
  assert.equal(sig(a), sig(b));
  // nested objects too (segments)
  const c = { type: 'para', text: 'x', segments: [{ type: 'text', text: 'x', tf: 1 }] };
  const d = { type: 'para', text: 'x', segments: [{ tf: 1, text: 'x', type: 'text' }] };
  assert.equal(sig(c), sig(d));
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Context inputs: atStart plus the o.* fields this review found formatBlock/traceBlock (and
// everything they call — formatTable/traceTable, withListKeep, tcSegs, headingTierKey...) genuinely
// read, via a full audit (a Proxy over `o` run across a real corpus, cross-checked line by line in
// document.mjs for every o.* occurrence — see the comment above getBlockSignature). Two were found to
// be read but NOT in the OLD key — genuine misses, fixed by this change:
//   - o._boxDepth: facingContext (called from formatTable/traceTable) zeroes a table's facing-page
//     plan when the table is inside a box (K15, BANA 11.14.1's facing-page rule is for a top-level
//     table only) — read directly, not only via the already-keyed block._facingPerPage.
//   - o.listPageRules: withListKeep (called from both formatBlock and traceBlock) sets/omits a BANA
//     list's keep-together `lines.keepGroups` side channel (F-35, BANA 8.3.5b-c) depending on
//     `o.listPageRules === false`.
test('block signature: atStart changes the key', () => {
  const b = { type: 'para', text: 'x' };
  assert.notEqual(sig(b, OPTS, true), sig(b, OPTS, false));
});
test('block signature: o.width/mode/tableFormat/paragraphStyle/listStyle/trace change the key', () => {
  const b = { type: 'para', text: 'x' };
  const t = { type: 'table', headers: ['A'], rows: [['1']] };
  const l = { type: 'list', items: [{ text: 'a' }] };
  assert.notEqual(sig(b, { ...OPTS, width: 30 }), sig(b));
  assert.notEqual(sig(b, { ...OPTS, mode: 'ukaaf', standard: 'ukaaf' }), sig(b));
  assert.notEqual(sig(t, { ...OPTS, tableFormat: 'listed' }), sig(t));
  assert.notEqual(sig(b, { ...OPTS, paragraphStyle: 'block' }), sig(b));
  assert.notEqual(sig(l, { ...OPTS, listStyle: 'spaced' }), sig(l, { ...OPTS, listStyle: 'compact' }));
  assert.notEqual(sig(b, { ...OPTS, trace: {} }), sig(b));
});
test('block signature: o._boxDepth changes the key for a table (K15 miss found in this review)', () => {
  const t = { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] };
  assert.notEqual(sig(t, { ...OPTS, _boxDepth: 1 }), sig(t, { ...OPTS, _boxDepth: 0 }));
});
test('block signature: o.listPageRules changes the key for a BANA list (F-35 miss found in this review)', () => {
  const l = { type: 'list', items: [{ text: 'one' }, { text: 'two' }] };
  assert.notEqual(sig(l, { ...OPTS, listPageRules: false }), sig(l, OPTS));
});
test('block signature: o.lineNumberWidth / o.lineIndicator / o.nestedBullets / o.spacedEllipsis / o.typeformWordPunct / o.elisionApostrophe / o.foreignText / o._boxColorsUniform change the key', () => {
  const b = { type: 'para', text: 'x' };
  const l = { type: 'list', items: [{ text: 'a' }] };
  const box = { type: 'box', render: 'required', boxColor: 'blue', blocks: [] };
  assert.notEqual(sig(b, { ...OPTS, lineNumberWidth: 2 }), sig(b));
  assert.notEqual(sig(b, { ...OPTS, lineIndicator: '_/' }), sig(b));
  assert.notEqual(sig(l, { ...OPTS, nestedBullets: true }), sig(l));
  assert.notEqual(sig(b, { ...OPTS, spacedEllipsis: true }), sig(b));
  assert.notEqual(sig(b, { ...OPTS, typeformWordPunct: true }), sig(b));
  assert.notEqual(sig(b, { ...OPTS, elisionApostrophe: true }), sig(b));
  assert.notEqual(sig(b, { ...OPTS, foreignText: true }), sig(b));
  assert.notEqual(sig(box, { ...OPTS, _boxColorsUniform: true }), sig(box, { ...OPTS, _boxColorsUniform: false }));
});
test('block signature: heading tiers (o.headingTiers) and toc page numbers (o.tocBrlPagesKey/_hasPrintPages) change the key', () => {
  const h = { type: 'heading', level: 1, text: 'x' };
  assert.notEqual(sig(h, { ...OPTS, headingTiers: { 1: 'a' } }), sig(h, { ...OPTS, headingTiers: { 1: 'b' } }));
  const toc = { type: 'list', kind: 'toc', items: [{ text: 'a', page: '1' }] };
  assert.notEqual(sig(toc, { ...OPTS, tocBrlPagesKey: 'a' }), sig(toc, { ...OPTS, tocBrlPagesKey: 'b' }));
  assert.notEqual(sig(toc, { ...OPTS, _hasPrintPages: true }), sig(toc, { ...OPTS, _hasPrintPages: false }));
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Cache correctness over a real corpus (same nimas_samples fixtures scripts/check-layout-parity.mjs
// walks; not imported directly — that script runs its own main() as a side effect of being imported).
// Formatting with a shared warm blockCache, after mutating a block, must equal formatting from cold.
function flattenBlocks(blocks, out = []) {
  for (const b of blocks || []) {
    if (!b || typeof b !== 'object') continue;
    out.push(b);
    if (Array.isArray(b.blocks)) flattenBlocks(b.blocks, out);
    if (Array.isArray(b.items)) for (const it of b.items) if (it && Array.isArray(it.blocks)) flattenBlocks(it.blocks, out);
  }
  return out;
}
// A bounded subset of tests/nimas_samples (by file size, smallest first): full-corpus, every-block
// cache-vs-cold parity is scripts/check-layout-parity.mjs's job (run separately, see this review's
// report); this test's job is to prove the general mutate-and-compare mechanism works on a handful of
// real, structurally varied documents while staying comfortably inside run-all-tests.mjs's per-file
// timeout even under a loaded machine (run-all-tests.mjs runs several test files concurrently).
const SAMPLE_DIR = path.join(EMBOSS, 'tests', 'nimas_samples');
const MAX_SAMPLE_BYTES = 10000;
const sampleFiles = fs.existsSync(SAMPLE_DIR)
  ? fs.readdirSync(SAMPLE_DIR).filter((f) => f.endsWith('.xml')).map((f) => path.join(SAMPLE_DIR, f)).filter((f) => fs.statSync(f).size <= MAX_SAMPLE_BYTES)
  : [];

// A 'para' block's visible text comes from `.segments` when present (formatPara prefers segments
// over the plain `.text` mirror) — edit whichever one actually drives the output, appending to the
// last text-ish segment so the edit is guaranteed visible.
function editVisibleText(block, suffix) {
  if (Array.isArray(block.segments) && block.segments.length) {
    for (let i = block.segments.length - 1; i >= 0; i--) {
      const g = block.segments[i];
      if (g && typeof g.text === 'string') { g.text += suffix; return () => { g.text = g.text.slice(0, -suffix.length); }; }
    }
  }
  if (typeof block.text === 'string') { const orig = block.text; block.text += suffix; return () => { block.text = orig; }; }
  return null;
}

test('cache correctness: warm blockCache after mutating a block equals a cold render', async () => {
  assert.ok(sampleFiles.length, 'expected tests/nimas_samples/*.xml fixtures');
  for (const file of sampleFiles) {
    let model;
    try {
      model = await parseFile(path.basename(file), fs.readFileSync(file, 'utf8'));
    } catch { continue; }
    if (!model || !Array.isArray(model.blocks) || !model.blocks.length) continue;
    const flat = flattenBlocks(model.blocks);
    const candidates = flat.filter((b) => b && b.type === 'para' && typeof b.text === 'string' && b.text.trim().length > 5).slice(0, 8);
    if (!candidates.length) continue;
    for (const mode of ['bana', 'ukaaf']) {
      const baseO = { ...OPTS, mode, standard: mode };
      let warmBefore, warmAfter, cold, used = false;
      try {
        // warm the cache with the unmutated document, then edit one block's text and re-render on
        // the SAME warm cache (exactly what the editor does on every keystroke). Try candidates in
        // turn until one produces a visible change (a block whose text change happens not to move
        // any braille — e.g. it is overridden elsewhere — proves nothing either way).
        const shared = { ...baseO, blockCache: new Map() };
        warmBefore = formatDocument(model, shared);
        for (const target of candidates) {
          const restore = editVisibleText(target, ' Edited.');
          if (!restore) continue;
          warmAfter = formatDocument(model, shared);
          if (warmAfter !== warmBefore) { used = true; cold = formatDocument(model, { ...baseO, blockCache: new Map() }); restore(); break; }
          restore();
        }
      } catch (e) {
        // A file this suite cannot format at all (e.g. missing mathToBrf) is not this test's concern —
        // check-layout-parity.mjs / gold-run.mjs already cover full formatting correctness.
        continue;
      }
      assert.ok(used, `${path.basename(file)} (${mode}): none of the first ${candidates.length} paragraphs' edits had a visible effect — test fixture problem, not a cache bug`);
      assert.equal(warmAfter, cold, `${path.basename(file)} (${mode}): warm-cache render after an edit differs from a cold render of the same document`);
    }
  }
});

// A23 / BANA 9.4.1b specifically: an attribution's own attribCell is computed from the PRECEDING
// line's indent, so editing an earlier block can change a later attribution's braille even though the
// attribution block itself is untouched. A stale warm-cache hit here was exactly the kind of bug this
// review's cache-key redesign targets (attribCell is one of the "per-instance values buildDocPages
// computes" the brief calls out by name).
test('cache correctness: editing a block before an attribution changes the attribution (attribCell, A23)', async () => {
  const model = {
    title: 'A23 attribCell', blocks: [
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'para', style: 'quote', text: 'A short quotation.', displayed: true },
      { type: 'attribution', text: 'Author Name' },
    ],
  };
  const o = { ...OPTS, blockCache: new Map() };
  const before = formatDocument(model, o);
  // Lengthen the quoted paragraph so its last braille line's indent (and so the attribution's
  // computed attribCell) is very likely to change, on the SAME warm cache.
  model.blocks[1].text = 'A short quotation that runs on for rather longer than the first one did, wrapping onto more than one braille line so the previous line has a different indent from before.';
  const afterWarm = formatDocument(model, o);
  const cold = formatDocument({ ...model, blocks: model.blocks.map((b) => ({ ...b })) }, { ...OPTS, blockCache: new Map() });
  assert.equal(afterWarm, cold, 'warm-cache render after editing the paragraph before an attribution differs from a cold render');
  assert.notEqual(before, afterWarm, 'the edit was expected to change the rendered document');
});
