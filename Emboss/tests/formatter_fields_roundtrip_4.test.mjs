// Fourth batch of optional formatter fields (findings batches A and B) carried through DTBook: model -> export -> re-import.
// Storage forms: nimas-export.mjs (BANA_FLAG_FIELDS, BANA_TEXT_FIELDS, BANA_DOC_OPTIONS, the run span, the list item class, the
// verse <line> class, the pagenum case). A field is written ONLY when set, so a document that uses none exports exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimas, serializeBlock } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;

const strip = (v) => JSON.parse(JSON.stringify(v));
const one = (block, extra = {}) => { const model = { title: 'T', ...extra, blocks: [{ type: 'heading', level: 1, text: 'T' }, block] }; const out = exportToNimas(model); return { out, back: parseDtbook(out) }; };
const segs = (...a) => a.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x));
const tbl = (extra) => ({ type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], ...extra });

const CASES = {
  ignoreFontHeading: { type: 'heading', level: 2, text: 'Dedication', ignoreFont: true },
  ignoreFontPara: { type: 'para', text: 'To my mother.', ignoreFont: true },
  ignoreFontNote: { type: 'note', render: 'required', text: 'A note.', ignoreFont: true },
  ignoreFontList: { type: 'list', items: [{ text: 'one' }, { text: 'two' }], ignoreFont: true },
  ignoreFontItem: { type: 'list', items: [{ text: 'one', ignoreFont: true }, { text: 'two' }] },
  ignoreFontItemRun: { type: 'list', items: [{ text: 'a b c', segments: segs('a ', { type: 'text', text: 'b', tf: 1, ignoreFont: true }, ' c') }, { text: 'two' }] },
  ignoreFontRun: { type: 'para', text: 'The letter x standing for itself.', segments: segs('The letter ', { type: 'text', text: 'x', tf: 1, ignoreFont: true }, ' standing for itself.') },
  ignoreFontRunOnly: { type: 'para', text: 'Plain then bold. marked', segments: segs('Plain then ', { type: 'text', text: 'bold', tf: 4 }, '.', { type: 'text', text: ' marked', ignoreFont: true }) },
  diacritic: { type: 'para', text: 'The word café.', diacriticNotation: true },
  diacriticHeading: { type: 'heading', level: 2, text: 'Stress marks', diacriticNotation: true },
  omitFull: { type: 'para', text: 'All italic.', segments: segs({ type: 'text', text: 'All italic.', tf: 1 }), omitFullEmphasis: true },
  omitEmph: { type: 'para', text: 'Some bold here.', segments: segs('Some ', { type: 'text', text: 'bold', tf: 4 }, ' here.'), omitEmphasis: true },
  omitEmphList: { type: 'list', items: [{ text: 'a b', segments: segs({ type: 'text', text: 'a', tf: 1 }, ' b') }], omitEmphasis: true, omitFullEmphasis: true },
  pbbPara: { type: 'para', text: 'Starts a new page.', pageBreakBefore: true },
  pbbHeading: { type: 'heading', level: 1, text: 'Contents', pageBreakBefore: true },
  pbbList: { type: 'list', items: [{ text: 'a' }, { text: 'b' }], pageBreakBefore: true },
  pbbTable: tbl({ pageBreakBefore: true }),
  pbbBox: { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'Inside.' }], pageBreakBefore: true },
  pbbNote: { type: 'note', render: 'required', text: 'A note.', pageBreakBefore: true },
  pbbGraphic: { type: 'graphic', src: 'a.png', alt: 'A picture', pageBreakBefore: true },
  pbbVerse: { type: 'play', subtype: 'verse', style: 'verse', text: 'A line of verse', pageBreakBefore: true },
  pagenumUnnumbered: { type: 'pagenum', unnumbered: true },
  pagenumUnnumberedValue: { type: 'pagenum', page: '5', text: '5', unnumbered: true },
  guideDotNoteTrue: tbl({ guideDotNote: true }),
  guideDotNoteText: tbl({ guideDotNote: 'Guide dots (dots 5 and 2) lead to the entry.' }),
  repeatHeadingsOn: tbl({ repeatHeadings: true }),
  repeatHeadingsOff: tbl({ repeatHeadings: false }),
  continuedNoteOff: tbl({ continuedNote: false }),
  continuedNoteOn: tbl({ continuedNote: true }),
  continuedNoteText: tbl({ continuedNote: 'Table 3 (continued)' }),
  tableMany: tbl({ guideDotNote: 'Own words', repeatHeadings: false, continuedNote: 'Cont.', pageBreakBefore: true }),
  stripContinuation: { type: 'list', kind: 'toc', items: [{ text: 'Chapter one', page: '12a' }, { text: 'Chapter two', page: '14' }], stripContinuation: true },
  poemLineIndicator: { type: 'play', subtype: 'verse', style: 'verse', text: 'A line of verse', poemMethod: 'line-indicator' },
  poemStanza: { type: 'play', subtype: 'verse', style: 'verse', text: 'A line of verse', poemMethod: 'stanza-cell3' },
};

for (const [name, block] of Object.entries(CASES)) {
  test(`field ${name}: export then re-import gives the same block`, () => {
    const { out, back } = one(block);
    const got = back.blocks.find((b, i) => i > 0 && b.type === block.type);
    assert.ok(got, `no ${block.type} block came back\n${out}`);
    const want = strip(block), have = strip(got);
    for (const k of Object.keys(want)) {
      if (k === 'rows' || k === 'headers' || k === 'blocks' || k === 'kind' || k === 'style' || k === 'subtype') continue;
      if (k === 'items' && block.type === 'list') { assert.deepEqual(have.items.map((it) => !!it.ignoreFont), want.items.map((it) => !!it.ignoreFont), `${k} ignoreFont\n${out}`); const w = want.items.map((it) => it.segments ? it.segments.map((g) => [g.text, g.tf || 0, !!g.ignoreFont]) : null), h = have.items.map((it) => (it.segments ? it.segments.map((g) => [g.text, g.tf || 0, !!g.ignoreFont]) : null)); assert.deepEqual(h, w, `${k} segments\n${out}`); continue; }
      if (k === 'items') continue;
      if (k === 'segments') { assert.deepEqual(have.segments.map((g) => [g.text, g.tf || 0, !!g.ignoreFont]), want.segments.map((g) => [g.text, g.tf || 0, !!g.ignoreFont]), `${k}\n${out}`); continue; }
      assert.deepEqual(have[k], want[k], `${k}\n${out}`);
    }
    // parse -> export -> parse is identical from then on
    const out2 = exportToNimas(back);
    assert.deepEqual(strip(parseDtbook(out2).blocks), strip(back.blocks));
    assert.equal(exportToNimas(parseDtbook(out2)).replace(/name="dtb:uid" content="[^"]*"/, ''), out2.replace(/name="dtb:uid" content="[^"]*"/, ''));
  });
}

test('an unset table option comes back unset (repeatHeadings, continuedNote, guideDotNote)', () => {
  const { back } = one(tbl({}));
  const t = back.blocks.find((b) => b.type === 'table');
  for (const k of ['repeatHeadings', 'continuedNote', 'guideDotNote', 'pageBreakBefore']) assert.equal(k in t, false, k);
});

test('storage forms: run span, item class, table title, verse line class', () => {
  assert.match(serializeBlock(CASES.ignoreFontRun, 0), /<span class="bana-ignore-font"><em>x<\/em><\/span>/);
  assert.match(serializeBlock(CASES.ignoreFontItem, 0), /<li class="bana-ignore-font">one<\/li>/);
  assert.match(serializeBlock(CASES.guideDotNoteText, 0), /<table class="bana-guide-dot-note bana-guide-dot-note-text" title="Guide dots/);
  assert.match(serializeBlock(CASES.guideDotNoteTrue, 0), /<table class="bana-guide-dot-note">/);
  assert.match(serializeBlock(CASES.pagenumUnnumbered, 0), /<pagenum id="p-unnumbered" page="special" class="bana-unnumbered"><\/pagenum>/);
  assert.match(serializeBlock(CASES.poemLineIndicator, 0), /<p class="bai-verse bana-poem-line-indicator">/);
  const poem = exportToNimas({ title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'play', subtype: 'verse', style: 'verse', fromPoem: true, text: 'Line one', poemMethod: 'stanza-cell3' }, { type: 'play', subtype: 'verse', style: 'verse', fromPoem: true, text: 'Line two', poemMethod: 'stanza-cell3', pageBreakBefore: true }] });
  assert.match(poem, /<line class="bana-page-break-before bana-poem-stanza-cell3">|<line class="bana-poem-stanza-cell3">/);
  const back = parseDtbook(poem).blocks.filter((b) => b.type === 'play');
  assert.deepEqual(back.map((b) => [b.poemMethod, !!b.pageBreakBefore]), [['stanza-cell3', false], ['stanza-cell3', true]]);
});

const OPTS = { verseKeep: false, listPageRules: false, interpointOmitEven: true, endOfVolume: true, tocRightBuffer: true, nestedBullets: true, tocHeading: 'Table of Contents & Lists', lineIndicator: '_/', runningHeadKeyWords: 'Moby Dick' };
test('document options ride on <meta name="bana-…"> in the head and come back with their values', () => {
  const { out, back } = one({ type: 'para', text: 'x' }, OPTS);
  assert.match(out, /<meta name="bana-verse-keep" content="0" \/>/);
  assert.match(out, /<meta name="bana-toc-heading" content="Table of Contents &amp; Lists" \/>/);
  for (const [k, v] of Object.entries(OPTS)) assert.equal(back[k], v, k);
  assert.equal(exportToNimas(back).replace(/name="dtb:uid" content="[^"]*"/, ''), out.replace(/name="dtb:uid" content="[^"]*"/, ''));
});
test('document options: unset, blank and default values write nothing (verseKeep true, listPageRules true, empty text)', () => {
  const { out, back } = one({ type: 'para', text: 'x' }, { verseKeep: true, listPageRules: true, interpointOmitEven: false, endOfVolume: false, tocHeading: '  ', lineIndicator: '', runningHeadKeyWords: '' });
  assert.equal(/bana-/.test(out), false, out);
  for (const k of Object.keys(OPTS)) assert.equal(k in back, false, k);
});

test('a document that uses none of the new fields exports without any of their tokens', () => {
  const model = { title: 'T', blocks: [
    { type: 'heading', level: 1, text: 'H', ignoreFont: false, diacriticNotation: false, pageBreakBefore: false }, { type: 'para', text: 'P', segments: segs('P'), omitEmphasis: false, omitFullEmphasis: false },
    { type: 'list', items: [{ text: 'a', ignoreFont: false }, { text: 'b' }], stripContinuation: false },
    { type: 'table', headers: ['a'], rows: [['1'], ['2']], guideDotNote: false, continuedNote: '  ' },
    { type: 'pagenum', page: '3', text: '3', unnumbered: false },
    { type: 'play', subtype: 'verse', style: 'verse', text: 'v', poemMethod: null },
  ] };
  const out = exportToNimas(model);
  assert.equal(/bana-/.test(out), false, out);
  assert.equal(/title="/.test(out), false);
});

// ---- every field together -----------------------------------------------------------------------------------------
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DTD_DIR = path.join(ROOT, 'references', 'dtd');
export const ALL_MODEL = {
  title: 'All fields 4', ...OPTS,
  blocks: [{ type: 'heading', level: 1, text: 'All fields 4' }, ...Object.values(CASES).map((b) => structuredClone(b)),
    { type: 'play', subtype: 'verse', style: 'verse', fromPoem: true, text: 'Line one', poemMethod: 'line-indicator', ignoreFont: true },
    { type: 'play', subtype: 'verse', style: 'verse', fromPoem: true, text: 'Line two', poemMethod: 'line-indicator', pageBreakBefore: true }],
};
test('export using every field: parse, export, parse are identical', () => {
  const out = exportToNimas(ALL_MODEL);
  const a = parseDtbook(out);
  const out2 = exportToNimas(a);
  const a2 = parseDtbook(out2);
  assert.deepEqual(strip(a2), strip(a));
  assert.equal(exportToNimas(a2).replace(/name="dtb:uid" content="[^"]*"/, ''), out2.replace(/name="dtb:uid" content="[^"]*"/, ''));
});

test('export using every field is valid against the official DTBook DTD (xmllint, offline)', (t) => {
  try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch { t.skip('xmllint not installed'); return; }
  const tmp = path.join(os.tmpdir(), `emboss_fields4_${process.pid}.xml`);
  fs.writeFileSync(tmp, exportToNimas(ALL_MODEL));
  const catalog = path.join(DTD_DIR, 'catalog.xml');
  const env = { ...process.env, XML_CATALOG_FILES: `file://${catalog.split(path.sep).map(encodeURIComponent).join('/')}` };
  const wrapper = path.relative(ROOT, path.join(DTD_DIR, 'dtbook-2005-3-mathml.dtd'));
  try {
    execFileSync('xmllint', ['--noout', '--nonet', '--dtdvalid', wrapper, tmp], { cwd: ROOT, env, stdio: 'pipe' });
  } catch (e) {
    assert.fail(String(e.stderr || e.message).split('\n').slice(0, 12).join('\n'));
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('the export using every field can be written to a file for daisy-validate (EMBOSS_FIELDS4_OUT)', () => {
  if (process.env.EMBOSS_FIELDS4_OUT) fs.writeFileSync(process.env.EMBOSS_FIELDS4_OUT, exportToNimas(parseDtbook(exportToNimas(ALL_MODEL))));
});
