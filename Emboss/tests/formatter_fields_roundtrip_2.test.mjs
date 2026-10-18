// Second batch of optional formatter fields (document.mjs) carried through DTBook: model -> export -> re-import.
// Storage forms: nimas-export.mjs (BANA_FLAG_FIELDS, BANA_TEXT_FIELDS, BANA_DOC_OPTIONS, itemLabelXml, dtBanaAttrs).
// Also G8 stage 2: item.enum / item.start (per sibling group), top-level letter runs, HTML <ol type>, block.symbols.
// A field is written ONLY when set, so a document that uses none of them exports exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook, parseHtml } from '../input/parse.mjs';
import { exportToNimas, serializeBlock } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;

const strip = (v) => JSON.parse(JSON.stringify(v));
const reimport = (model) => { const out = exportToNimas(model); return { out, back: parseDtbook(out) }; };
const one = (block) => reimport({ title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, block] });
const blockOf = (back, pred) => back.blocks.find(pred);

// Each entry: a model block using the field(s); after export and re-import the block must equal the original.
const CASES = {
  paraNumber: { type: 'para', text: '1 First paragraph.', paraNumber: true },
  countedWords: { type: 'para', text: 'Counted words here.', countedWords: true },
  lnNoteBeforeHeading: { type: 'para', text: 'Line one.', lnNoteBeforeHeading: true },
  songInfo: { type: 'para', text: 'Music by Somebody.', songInfo: true },
  wordGaps: { type: 'para', text: 'dah dit dah', wordGaps: true },
  paragraphAll: { type: 'para', text: 'All para flags.', paraNumber: true, countedWords: true, lnNoteBeforeHeading: true, songInfo: true, wordGaps: true },
  verse: { type: 'play', subtype: 'verse', style: 'verse', level: 0, playVerse: true, text: 'A verse line', rhymeLetters: true, wideSpaces: true, uncontractedPoem: true, displayedPoem: true },
  footnoteNone: { type: 'footnote', id: 'n1', text: 'A note.', noteMarkPlacement: 'none' },
  footnoteInline: { type: 'footnote', id: 'n2', text: 'Another note.', noteMarkPlacement: 'inline' },
  listFlags: { type: 'list', afterNote: true, wordList: true, items: [{ text: 'one', marker: '•' }, { text: 'two', marker: '•' }] },
  itemExample: { type: 'list', kind: 'exercise', style: 'exercise', items: [{ text: 'Add 2 and 3.', example: true, label: 'Example:' }, { text: 'Add 4 and 5.' }] },
  itemLabelSegments: { type: 'list', kind: 'exercise', style: 'exercise', items: [{ text: 'Say it.', example: true, labelSegments: [{ type: 'text', text: 'Model', tf: 4 }, { type: 'text', text: ':' }], segments: [{ type: 'text', text: 'Say it.' }] }] },
  itemLabelPlainList: { type: 'list', ordered: true, items: [{ text: 'the answer', marker: '1.', label: 'Sample', example: true }, { text: 'next', marker: '2.' }] },
  glossaryFlags: { type: 'list', kind: 'glossary', style: 'glossary', thesaurus: true, dictionary: true, alphabeticMargins: true, sharedMargin: true, items: [{ term: 'el gato', def: 'the cat', text: 'el gato — the cat', lead: 'el', termSup: '1' }, { term: 'perro', def: 'dog', text: 'perro — dog', termSup: '2' }, { term: 'casa', def: 'house', text: 'casa — house', lead: 'la' }] },
  entryWord: { type: 'heading', level: 2, text: 'apple', entryWord: true },
  guideDots: { type: 'table', rows: [['a', 'b'], ['c', 'd']], guideDots: false },
  code: { type: 'code', text: 'ab cd\nef gh', dotLocator: true, keepSpaces: true, spaceLetters: true },
  codeOne: { type: 'code', text: 'w o r d', spaceLetters: true },
  citation: { type: 'graphic', src: 'a.png', alt: 'A picture', citation: 'Photo: Someone, 1999' },
  citationGroup: { type: 'graphic', src: 'b.png', alt: 'Another', caption: 'Cap', citation: 'Source: X & Y' },
  symbols: { type: 'list', symbols: ['•', '◦', '▪'], items: [{ text: 'top', marker: '•' }, { text: 'sub', marker: '•', level: 1 }, { text: 'subsub', marker: '•', level: 2 }] },
};

// The fields a case sets (block level, and per item) must come back equal; the parts import always adds (markers of an
// ordered exercise, headers of a table, segments of a glossary entry) are not part of the comparison.
const ITEM_FIELDS = ['example', 'label', 'labelSegments', 'lead', 'termSup', 'enum', 'start', 'marker', 'level', 'text', 'term', 'def'];
for (const [name, block] of Object.entries(CASES)) {
  test(`field ${name}: export then re-import gives the same block`, () => {
    const { out, back } = one(block);
    const got = back.blocks.find((b, i) => i > 0 && b.type === block.type);
    assert.ok(got, `no ${block.type} block came back\n${out}`);
    const want = strip(block), have = strip(got);
    for (const k of Object.keys(want)) {
      if (k === 'items') {
        want.items.forEach((it, i) => { for (const f of ITEM_FIELDS) if (f in it) assert.deepEqual(have.items[i][f], it[f], `${k}[${i}].${f}\n${out}`); });
      } else if (k !== 'rows') assert.deepEqual(have[k], want[k], `${k}\n${out}`);
    }
    // parse -> export -> parse is identical from then on
    const out2 = exportToNimas(back);
    assert.deepEqual(strip(parseDtbook(out2).blocks), strip(back.blocks));
    assert.equal(exportToNimas(parseDtbook(out2)), out2);
  });
}

test('table guideDots false: the token is on the <table>, not the tabletn prodnote', () => {
  const xml = serializeBlock({ type: 'table', rows: [['a']], guideDots: false, tabletn: 'Note' }, 0);
  assert.match(xml, /<table class="bana-no-guide-dots">/);
  assert.match(xml, /<prodnote render="optional" class="tabletn">/);
});

test('inline segments: imgnote.uncontracted and literal braille cells round trip', () => {
  const block = { type: 'para', text: 'See x note and 7', segments: [
    { type: 'text', text: 'See ' },
    { type: 'imgnote', text: 'x', prodnote: true, render: 'optional', uncontracted: true },
    { type: 'text', text: ' note and ' },
    { type: 'brl', brl: ';?', text: '7' },
    { type: 'brl', brl: '.=', text: '' },
  ] };
  const { out, back } = one(block);
  assert.match(out, /<span class="bana-brl" title=";\?">7<\/span>/);
  assert.match(out, /class="bana-uncontracted"/);
  const got = back.blocks[1];
  const segs = strip(got.segments);
  assert.deepEqual(segs.filter((g) => g.type !== 'text'), strip(block.segments.filter((g) => g.type !== 'text')));
  assert.equal(segs.find((g) => g.type === 'imgnote').uncontracted, true);
  const out2 = exportToNimas(back);
  assert.deepEqual(strip(parseDtbook(out2).blocks), strip(back.blocks));
});

test('an image note inside an exercise item keeps uncontracted', () => {
  const block = { type: 'list', kind: 'exercise', style: 'exercise', items: [{ text: 'a b', segments: [{ type: 'text', text: 'a ' }, { type: 'imgnote', text: 'crossed', uncontracted: true }, { type: 'text', text: ' b' }] }] };
  const { back } = one(block);
  const it = back.blocks[1].items[0];
  assert.equal(it.segments.find((g) => g.type === 'imgnote').uncontracted, true);
});

test('document options ride on <meta name="bana-…"> and come back on the model', () => {
  const model = { title: 'T', blocks: [{ type: 'para', text: 'x' }], spacedEllipsis: true, elisionApostrophe: true, typeformWordPunct: true };
  const { out, back } = reimport(model);
  for (const m of ['bana-spaced-ellipsis', 'bana-elision-apostrophe', 'bana-typeform-word-punct']) assert.match(out, new RegExp(`<meta name="${m}" content="1" />`));
  assert.equal(back.spacedEllipsis, true);
  assert.equal(back.elisionApostrophe, true);
  assert.equal(back.typeformWordPunct, true);
  const plain = reimport({ title: 'T', blocks: [{ type: 'para', text: 'x' }] });
  assert.equal(/bana-/.test(plain.out), false);
  assert.equal('spacedEllipsis' in plain.back, false);
  assert.equal(exportToNimas(back), out);
  const one1 = reimport({ title: 'T', blocks: [{ type: 'para', text: 'x' }], spacedEllipsis: true });
  assert.equal(one1.back.spacedEllipsis, true);
  assert.equal('elisionApostrophe' in one1.back, false);
});

test('a document that uses none of the new fields exports without any of their tokens', () => {
  const model = { title: 'T', blocks: [
    { type: 'heading', level: 1, text: 'H' }, { type: 'para', text: 'P' },
    { type: 'play', subtype: 'verse', style: 'verse', text: 'V' },
    { type: 'footnote', id: 'n', text: 'F' },
    { type: 'list', items: [{ text: 'a', marker: '•' }] },
    { type: 'list', kind: 'exercise', style: 'exercise', items: [{ text: 'q' }] },
    { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 't', def: 'd', text: 't — d' }] },
    { type: 'table', rows: [['a']] }, { type: 'code', text: 'x y' }, { type: 'graphic', src: 'a.png', alt: 'A' },
  ] };
  const out = exportToNimas(model);
  // identity markers added by the save-reopen fix (a code block stays code; an unnumbered item in a list stays unnumbered) are not 'new field' tokens
  assert.equal(/bana-/.test(out.replace(/bana-code|bana-no-marker/g, '')), false, out);
  assert.match(out, /<p( class="bana-code")?>x y<\/p>/);   // a code block with no flag: the class only marks it as code so it reopens as code (save-reopen fix, 24 Sep)
  assert.equal(/title="/.test(out), false);
});

test('serializeBlock writes each new field only when set', () => {
  assert.equal(serializeBlock({ type: 'para', text: 'P', paraNumber: false, songInfo: false }, 0), '<p>P</p>');
  assert.equal(serializeBlock({ type: 'table', rows: [['a']], guideDots: true }, 0).includes('bana-'), false);
  assert.equal(serializeBlock({ type: 'footnote', id: 'n', text: 'F', noteMarkPlacement: 'bogus' }, 0).includes('bana-'), false);
  assert.match(serializeBlock({ type: 'graphic', src: 'a.png', alt: 'A', citation: 'C' }, 0), /^<img src="a.png" alt="A" class="bana-citation" title="C"\/>$/);
});

// ---- G8 stage 2 -------------------------------------------------------------------------------------------------
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>Doc</h1>${body}</level1></bodymatter></book></dtbook>`;
const rt = (xml) => { const a = parseDtbook(xml); const out = exportToNimas(a); return { a, out, b: parseDtbook(out) }; };

test('G8: enum and start are kept on the first item of each sibling group', () => {
  const { a, out, b } = rt(wrap('<list type="ol" enum="a" start="3"><li>x<list type="ol" enum="i"><li>y</li><li>z</li></list></li><li>w</li></list>'));
  const items = a.blocks[1].items;
  assert.deepEqual([items[0].enum, items[0].start], ['a', 3]);
  assert.deepEqual([items[0].marker, items[1].marker, items[2].marker, items[3].marker], ['c.', 'i.', 'ii.', 'd.']);
  assert.equal(items[1].enum, 'i');
  assert.equal(items[3].enum, undefined);
  assert.match(out, /<list type="ol" enum="a" start="3">/);
  assert.match(out, /<list type="ol" enum="i">/);
  assert.deepEqual(strip(b.blocks), strip(a.blocks));
  assert.equal(exportToNimas(b), out);
});

test('G8: ul inside ol inside ul survives, and save-reload-save is stable', () => {
  const { a, out, b } = rt(wrap('<list type="ul"><li>a<list type="ol"><li>b<list type="ul"><li>c</li></list></li><li>d</li></list></li></list>'));
  assert.deepEqual(a.blocks[1].items.map((i) => [i.level || 0, i.marker]), [[0, '•'], [1, '1.'], [2, '•'], [1, '2.']]);
  assert.deepEqual(strip(b.blocks), strip(a.blocks));
  assert.equal(exportToNimas(b), out);
});

test('G8: explicit enum/start on a model with no marker text is written', () => {
  const { out, back } = one({ type: 'list', ordered: true, items: [{ text: 'a', enum: 'a', start: 3 }, { text: 'b' }] });
  assert.match(out, /<list type="ol" enum="a" start="3">/);
  assert.deepEqual(back.blocks[1].items.map((i) => i.marker), ['c.', 'd.']);
});

test('G8: an explicit enum that disagrees with the markers is ignored (markers stay the truth)', () => {
  const { out } = one({ type: 'list', ordered: true, items: [{ text: 'a', marker: '5.', enum: 'a' }, { text: 'b', marker: '6.' }] });
  assert.match(out, /<list type="ol" start="5">/);
});

test('G8: a top-level list of letters becomes enum + start, not literal markers', () => {
  const { out, back } = one({ type: 'list', ordered: true, items: [{ text: 'first', marker: 'b.' }, { text: 'second', marker: 'c.' }] });
  assert.match(out, /<list type="ol" enum="a" start="2">/);
  assert.equal(/<li>b\./.test(out), false);
  assert.deepEqual(back.blocks[1].items.map((i) => i.marker), ['b.', 'c.']);
  const rom = one({ type: 'list', ordered: true, items: [{ text: 'a', marker: 'i.' }, { text: 'b', marker: 'ii.' }] });
  assert.match(rom.out, /<list type="ol" enum="i">/);
});

test('G8: class level-N plus nesting still round trips', () => {
  const { a, out, b } = rt(wrap('<list type="ol" enum="A"><li>x<list type="ol"><li class="level-3">deep</li></list></li></list>'));
  assert.deepEqual(strip(b.blocks), strip(a.blocks));
  assert.equal(exportToNimas(b), out);
});

test('G8: HTML <ol type> gives letters and roman numerals from start', () => {
  const m = parseHtml('<ol type="a" start="3"><li>x</li><li>y</li></ol><ol type="I"><li>p</li><li>q</li></ol><ol><li>n</li></ol>');
  const lists = m.blocks.filter((b) => b.type === 'list');
  assert.deepEqual(lists[0].items.map((i) => i.marker), ['c.', 'd.']);
  assert.deepEqual(lists[1].items.map((i) => i.marker), ['I.', 'II.']);
  assert.deepEqual(lists[2].items.map((i) => i.marker), ['1.']);
  assert.equal(lists[2].items[0].enum, undefined);
  const out = exportToNimas(m);
  assert.match(out, /<list type="ol" enum="a" start="3">/);
  assert.match(out, /<list type="ol" enum="I">/);
});

test('G8: block.symbols round trips as one class token and is written only when set', () => {
  const { out, back } = one(CASES.symbols);
  assert.match(out, /<list type="ul" class="bana-symbols-dot_ring_small-square">/);
  assert.deepEqual(back.blocks[1].symbols, ['•', '◦', '▪']);
  assert.equal(/bana-symbols/.test(exportToNimas({ title: 'T', blocks: [{ type: 'list', items: [{ text: 'a', marker: '•' }] }] })), false);
  // a glyph with no name is not written (rather than invented)
  assert.equal(/bana-symbols/.test(serializeBlock({ type: 'list', symbols: ['★'], items: [{ text: 'a', marker: '•' }] }, 0)), false);
});

// ---- every field together: DTD validity (offline, as scripts/run_800_nimas_benchmark.mjs does) ------------------------
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DTD_DIR = path.join(ROOT, 'references', 'dtd');
const ALL_MODEL = {
  title: 'All fields', spacedEllipsis: true, elisionApostrophe: true, typeformWordPunct: true,
  blocks: [{ type: 'heading', level: 1, text: 'All fields' }, ...Object.values(CASES).map((b) => structuredClone(b)),
    { type: 'para', text: 'Seg', segments: CASES.paraNumber && [{ type: 'text', text: 'See ' }, { type: 'imgnote', text: 'x', prodnote: true, render: 'optional', uncontracted: true }, { type: 'brl', brl: ';?', text: '7' }] }],
};
test('export using every field: parse, export, parse are identical', () => {
  const out = exportToNimas(ALL_MODEL);
  const a = parseDtbook(out);
  const out2 = exportToNimas(a);
  const a2 = parseDtbook(out2);
  assert.deepEqual(strip(a2), strip(a));
  assert.equal(exportToNimas(a2), out2);
});

test('export using every field is valid against the official DTBook DTD (xmllint, offline)', (t) => {
  try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch { t.skip('xmllint not installed'); return; }
  const tmp = path.join(os.tmpdir(), `emboss_fields2_${process.pid}.xml`);
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

// Regression: an ordered list split around a page turn, whose later chunks start inside a sub-list or continue a number
// run, keeps the same enum/start on every load (the first load grouped only level-0 siblings; a save writes flat level-N <li>s).
const NIMAS_SPLIT_LIST = `<?xml version="1.0" encoding="UTF-8"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1><h1>T</h1>
<list type="ol">
<li>Explain the first part:
<list type="ol">
<li>How many invitations should Tyler make each day?</li>
<li>Use the diagram to write an equation.</li>
<li>Show how to solve it.</li>
</list>
</li>
<pagenum id="p62" page="normal">62</pagenum>
<li>Noah and his sister are making prize bags.
<list type="ol">
<li>Explain the diagram.<pagenum id="p63" page="normal">63</pagenum></li>
<li>Noah writes the equation.</li>
<li>List some other possible prices.</li>
<li>Write an inequality.</li>
</list>
</li>
</list>
</level1></bodymatter></book></dtbook>`;
test('split ordered list: parse, export, parse gives the same blocks', () => {
  const a = parseDtbook(NIMAS_SPLIT_LIST);
  const out = exportToNimas(a);
  const a2 = parseDtbook(out);
  assert.deepEqual(strip(a2.blocks), strip(a.blocks));
  assert.equal(exportToNimas(a2), out);
});
