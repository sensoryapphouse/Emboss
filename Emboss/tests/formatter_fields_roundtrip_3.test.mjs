// Third batch of optional formatter fields (document.mjs) carried through DTBook: model -> export -> re-import.
// Storage forms: nimas-export.mjs (BANA_FLAG_FIELDS, BANA_TEXT_FIELDS, BANA_DOC_OPTIONS, the table and pagenum cases).
// A field is written ONLY when set, so a document that uses none of them exports exactly as before.
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

// Each entry: a model block using the field(s); after export and re-import the block must equal the original.
const CASES = {
  diagram: { type: 'para', text: 'The dog ran.', diagram: true },
  hangingMargins: { type: 'para', text: 'Key sentence with a hanging indent.', hangingMargins: true },
  arrowLines: { type: 'para', text: 'The dog ran.', arrowLines: ['#$%', '  ,-=>'] },
  arrowAndLnNote: { type: 'para', text: 'Two text fields.', arrowLines: ['"7"'], lnNoteText: 'Line numbers & such.', diagram: true },
  noteKeyList: { type: 'note', render: 'required', text: 'Key:\n@a = alpha\n@b = beta', keyList: true, keyLocator: true },
  noteCell5: { type: 'note', render: 'required', text: 'Column heading', cell5: true },
  noteMention: { type: 'note', render: 'required', text: 'The symbol 8 represents eight.', mentionSymbols: ['8', '@'] },
  noteMentionAndPrefix: { type: 'note', render: 'required', text: 'Cartoon of an 8.', enclosePrefix: 'Cartoon', mentionSymbols: ['8'], cell5: true },
  boxNoLines: { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'Inside.' }], boxLines: false },
  tableCitation: { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], citation: 'Source: Census & Co., 1999' },
  tableCitationInside: { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], citation: { text: 'Source: Inside', position: 'inside-box' } },
  tableTotals: { type: 'table', headers: ['Item', 'Qty'], rows: [['a', '1'], ['b', '2'], ['Total', '3']], totalRows: [2], format: 'spatial', style: 'table-spatial' },
  tableSubheadings: { type: 'table', headers: ['Item', 'Qty'], rows: [['a', '1'], ['b', '2'], ['c', '3']], rowSubheadings: [{ row: 0, text: 'Fruit' }, { row: 2, text: 'Veg & Nuts' }] },
  tableAll: { type: 'table', headers: ['Item', 'Qty'], rows: [['a', '1'], ['b', '2'], ['Total', '3']], totalRows: [1, 2], rowSubheadings: [{ row: 1, text: 'Second' }], citation: 'Cite', tabletn: 'A note' },
  pagenumImplied: { type: 'pagenum', page: '5', text: '5', implied: true },
  pagenumImpliedNoValue: { type: 'pagenum', implied: true },
  pagenumThrough: { type: 'pagenum', page: 'i', text: 'i', through: 'v' },
  pagenumCombine: { type: 'pagenum', page: '24', text: '24', combineWithNext: true },
  pagenumSpelled: { type: 'pagenum', page: '89', text: '89', spelled: 'eighty-nine' },
  pagenumBoth: { type: 'pagenum', page: '44', text: '44', through: '45', spelled: 'forty-four-forty-five', implied: true },
};

for (const [name, block] of Object.entries(CASES)) {
  test(`field ${name}: export then re-import gives the same block`, () => {
    const { out, back } = one(block);
    const got = back.blocks.find((b, i) => i > 0 && b.type === block.type);
    assert.ok(got, `no ${block.type} block came back\n${out}`);
    const want = strip(block), have = strip(got);
    for (const k of Object.keys(want)) {
      if (k === 'rows' || k === 'headers' || k === 'blocks' || k === 'tabletn') continue;            // parts import always rebuilds
      if (k === 'text' && block.type === 'note') { assert.equal(have.text.replace(/\s+/g, ' '), want.text.replace(/\s+/g, ' '), k); continue; }
      assert.deepEqual(have[k], want[k], `${k}\n${out}`);
    }
    // parse -> export -> parse is identical from then on
    const out2 = exportToNimas(back);
    assert.deepEqual(strip(parseDtbook(out2).blocks), strip(back.blocks));
    assert.equal(exportToNimas(parseDtbook(out2)), out2);
  });
}

test('box boxLines false: the token is on the <sidebar>', () => {
  assert.match(serializeBlock({ type: 'box', render: 'required', blocks: [{ type: 'para', text: 'x' }], boxLines: false }, 0), /^<sidebar render="required" class="bana-no-box-lines">/);
  assert.equal(serializeBlock({ type: 'box', render: 'required', blocks: [{ type: 'para', text: 'x' }], boxLines: true }, 0).includes('bana-'), false);
});

test('key list note keeps its lines', () => {
  const { back } = one(CASES.noteKeyList);
  const n = back.blocks[1];
  assert.equal(n.keyList, true);
  assert.match(n.text, /@a = alpha/);
  assert.match(n.text, /@b = beta/);
});

test('table extras: citation is a <tfoot> row, totals and subheadings are <tr> classes', () => {
  const xml = serializeBlock(CASES.tableAll, 0);
  assert.match(xml, /<tfoot>\s*<tr class="bana-table-citation">\s*<td>Cite<\/td>/);
  assert.match(xml, /<tr class="bana-subheading">\s*<td>Second<\/td>/);
  assert.equal((xml.match(/<tr class="bana-total">/g) || []).length, 2);
  const inside = serializeBlock(CASES.tableCitationInside, 0);
  assert.match(inside, /<tr class="bana-table-citation bana-citation-inside">/);
  // out-of-range rows are not written
  assert.equal(/bana-total|bana-subheading/.test(serializeBlock({ type: 'table', rows: [['a']], totalRows: [5], rowSubheadings: [{ row: 9, text: 'x' }] }, 0)), false);
});

test('imgnote.spanTypeform round trips (with and without uncontracted), in prose and in an exercise item', () => {
  const segs = [{ type: 'text', text: 'See ' }, { type: 'imgnote', text: 'x', prodnote: true, render: 'optional', spanTypeform: true }, { type: 'text', text: ' and ' }, { type: 'imgnote', text: 'y', prodnote: true, render: 'optional', spanTypeform: true, uncontracted: true }];
  const { out, back } = one({ type: 'para', text: 'See x and y', segments: segs });
  assert.match(out, /class="bana-span-typeform"/);
  assert.match(out, /class="bana-uncontracted bana-span-typeform"/);
  const notes = back.blocks[1].segments.filter((g) => g.type === 'imgnote');
  assert.deepEqual(notes.map((g) => [g.spanTypeform, !!g.uncontracted]), [[true, false], [true, true]]);
  const item = one({ type: 'list', kind: 'exercise', style: 'exercise', items: [{ text: 'a b', segments: [{ type: 'text', text: 'a ' }, { type: 'imgnote', text: 'crossed', spanTypeform: true }, { type: 'text', text: ' b' }] }] });
  assert.equal(item.back.blocks[1].items[0].segments.find((g) => g.type === 'imgnote').spanTypeform, true);
});

test('an inline page turn inside a paragraph keeps its fields', () => {
  const { back } = one({ type: 'para', text: 'ab', segments: [{ type: 'text', text: 'a' }, { type: 'pagenum', block: { type: 'pagenum', page: '7', text: '7', through: '8' } }, { type: 'text', text: 'b' }] });
  const pn = back.blocks.find((b) => b.type === 'pagenum');
  assert.ok(pn, JSON.stringify(back.blocks));
  assert.equal(pn.through, '8');
});

// UK-7 (28 Sep, James / decisions.md "UKAAF"): pilPrintPage now defaults to true (on by default in
// UKAAF; James answered Q-17), so it uses the same "off" meta encoding as verseKeep/listPageRules —
// an explicit `false` is what gets written (`content="0"`); `true` (the default) writes nothing.
test('document option pilPrintPage rides on <meta name="bana-pil-print-page"> (off = 0, since it now defaults on)', () => {
  const { out, back } = one({ type: 'para', text: 'x' }, { pilPrintPage: false });
  assert.match(out, /<meta name="bana-pil-print-page" content="0" \/>/);
  assert.equal(back.pilPrintPage, false);
  assert.equal(exportToNimas(back), out);
  const plain = one({ type: 'para', text: 'x' }, { pilPrintPage: true });
  assert.equal(/bana-pil/.test(plain.out), false, 'true is the default, nothing to write');
  assert.equal('pilPrintPage' in plain.back, false);
});

test('a document that uses none of the new fields exports without any of their tokens', () => {
  const model = { title: 'T', blocks: [
    { type: 'heading', level: 1, text: 'H' }, { type: 'para', text: 'P', arrowLines: [], diagram: false, hangingMargins: false },
    { type: 'note', render: 'required', text: 'N', keyList: false, cell5: false, mentionSymbols: [] },
    { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'in' }], boxLines: true },
    { type: 'table', headers: ['a'], rows: [['1'], ['2']], totalRows: [], rowSubheadings: [], citation: '  ' },
    { type: 'pagenum', page: '3', text: '3', implied: false, through: '', spelled: null, combineWithNext: false },
  ] };
  const out = exportToNimas(model);
  assert.equal(/bana-/.test(out), false, out);
  assert.equal(/title="/.test(out), false);
  assert.equal(/tfoot/.test(out), false);
});

test('serializeBlock writes each new field only when set', () => {
  assert.equal(serializeBlock({ type: 'para', text: 'P', diagram: false }, 0), '<p>P</p>');
  assert.equal(serializeBlock({ type: 'para', text: 'P', arrowLines: ['x'] }, 0), '<p class="bana-arrows" title="x">P</p>');
  assert.match(serializeBlock({ type: 'pagenum', page: '5', implied: true }, 0), /<pagenum id="p-5" page="normal" class="bana-implied">5<\/pagenum>/);
});

// ---- every field together -----------------------------------------------------------------------------------------
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DTD_DIR = path.join(ROOT, 'references', 'dtd');
export const ALL_MODEL = {
  title: 'All fields 3', pilPrintPage: true, spacedEllipsis: true,
  blocks: [{ type: 'heading', level: 1, text: 'All fields 3' }, ...Object.values(CASES).map((b) => structuredClone(b)),
    { type: 'para', text: 'Seg', segments: [{ type: 'text', text: 'See ' }, { type: 'imgnote', text: 'x', prodnote: true, render: 'optional', spanTypeform: true }, { type: 'pagenum', block: { type: 'pagenum', page: '9', text: '9', through: '10', implied: true } }] }],
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
  const tmp = path.join(os.tmpdir(), `emboss_fields3_${process.pid}.xml`);
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

test('the export using every field can be written to a file for daisy-validate (EMBOSS_FIELDS3_OUT)', () => {
  if (process.env.EMBOSS_FIELDS3_OUT) fs.writeFileSync(process.env.EMBOSS_FIELDS3_OUT, exportToNimas(parseDtbook(exportToNimas(ALL_MODEL))));
});
