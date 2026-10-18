// Save -> reopen must not change the braille (PERMANENT regression test).
//
// NIMAS DTBook XML is Emboss's own save format, so a file Emboss saves must reopen to the SAME braille.
// For every file below: read it with the real parser, format the model in BANA and in UKAAF mode, save
// it with exportToNimasXml, read the saved XML with the same parser, format again — the braille must be
// identical, line for line. Files:
//   - every tests/nimas_samples/*.xml (real NIMAS books and BrailleBlaster test files)
//   - every tests/fixtures/import-audit/dtbook/*.xml and tests/fixtures/nimas-import-fixes/*.xml
//   - every other tests/fixtures/import-audit file (docx, doc, odt, rtf, html, md, epub): those exercise the
//     EXPORT of each reader's model shapes, which a DTBook file never reaches
// A plain upper-casing translator is used (every cause found so far was structural — headings, lists,
// tables, line breaks — not a difference in the contraction tables) plus one real liblouis run on a few
// small files. Runs headless in a few seconds.
//
// KNOWN EXCEPTIONS are listed by name with the reason, below. They are NOT skipped: each one is asserted to
// still differ in the modes named (so the day it is fixed this test fails and the entry must be removed),
// and the modes not named must still match. Never add a file here to hide a new difference.
//
// Causes found and fixed while writing this test (each has a small test further down; the fixture that showed it is named):
//   poem title/author saved outside the <poem>        d01-features.xml, nimas-import-fixes/poems.xml
//   plain-text forced line break saved as a raw newline r01-inline.rtf
//   legal numbering "1.1" saved in the item text, read back with a second, counted number  w08-lists.docx, lo-w08-lists.rtf/.doc
//   a bare "1" marker in a bullet list dropped, a bullet inside a numbered list read as text   textedit-lists.rtf, m02-lists.md
//   a cell whose only richness is a sub/superscript read back as plain text  w19-rich-contexts.docx
//   a wholly bold first row with no heading row promoted to a heading on reopening  lo-w12-tables.odt
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { SCRIPT_MARKS } from '../format/text-style.mjs';
import { parseFile, parseDtbook, exportToNimasXml, upperOptions, brailleLines, firstDifference, saveAndReopen } from './helpers/nimas-braille.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['bana', 'ukaaf'];

// ---------------------------------------------------------------------------------------------------------- known exceptions
// key: path under tests/ ; modes: the modes that still differ ; why: the cause, and whose it is.
const KNOWN_EXCEPTIONS = {
  // (h03-lists.html, a quotation inside a list item, was a known exception until 1 Oct 2026: import fix list #50)
  // (h06-web-page-css.html, a list inside a blockquote not marked displayed by the HTML reader, was one too until 1 Oct 2026: #50)
};

// ---------------------------------------------------------------------------------------------------------- the file list
const listDir = (rel, exts) => {
  const dir = path.join(here, rel);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => exts.test(f)).sort().map((f) => path.join(rel, f)) : [];
};
const DTBOOK_FILES = [
  ...listDir('nimas_samples', /\.xml$/i),
  ...listDir('fixtures/import-audit/dtbook', /\.xml$/i),
  ...listDir('fixtures/nimas-import-fixes', /\.xml$/i),
];
const OTHER_FILES = ['docx', 'doc', 'odt', 'rtf', 'html', 'md', 'epub'].flatMap((d) => listDir(`fixtures/import-audit/${d}`, /\.(docx|doc|odt|rtf|html|md|epub)$/i));
// Two real Project Gutenberg books (1 Oct 2026, import fix list #50: Alice's <p class="poem"> verse reopened as verse drama, its
// runover lines indented 4 cells instead of 2).
OTHER_FILES.push('real_samples/html/alice-in-wonderland-pg11.html', 'real_samples/html/sherlock-holmes-pg1661.html');

async function openFile(rel) {
  const buf = fs.readFileSync(path.join(here, rel));
  const isText = /\.(xml|md|rtf|html?)$/i.test(rel);
  return parseFile(path.basename(rel), isText ? buf.toString('utf8') : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** The modes (of BANA, UKAAF) in which the braille changes on reopening, with the first difference of each. */
async function differences(model, optionsFor) {
  const { back } = await saveAndReopen(model);
  const out = {};
  for (const mode of MODES) {
    const d = firstDifference(brailleLines(model, optionsFor(mode)), brailleLines(back, optionsFor(mode)));
    if (d) out[mode] = d;
  }
  return out;
}

describe('save -> reopen gives the same braille (plain translator, BANA and UKAAF)', () => {
  for (const rel of [...DTBOOK_FILES, ...OTHER_FILES]) {
    const exception = KNOWN_EXCEPTIONS[rel.split(path.sep).join('/')];
    if (!exception) {
      test(rel, async () => {
        const model = await openFile(rel);
        const diff = await differences(model, (mode) => upperOptions(mode));
        assert.deepEqual(Object.keys(diff), [], `the braille changed on reopening in ${Object.keys(diff).join(' and ')}:\n${Object.values(diff)[0]}`);
      });
    } else {
      test(`${rel} (KNOWN EXCEPTION: ${exception.why.slice(0, 70)}...)`, async () => {
        const model = await openFile(rel);
        const diff = await differences(model, (mode) => upperOptions(mode));
        assert.deepEqual(Object.keys(diff).sort(), [...exception.modes].sort(),
          `the known exception for ${rel} no longer matches (modes that differ: ${Object.keys(diff).join(', ') || 'none'}): if it is fixed, remove it from KNOWN_EXCEPTIONS`);
      });
    }
  }
  test('the file lists are not empty (the fixtures are where the test looks for them)', () => {
    assert.ok(DTBOOK_FILES.length >= 20, `only ${DTBOOK_FILES.length} DTBook files found`);
    assert.ok(OTHER_FILES.length >= 40, `only ${OTHER_FILES.length} other fixtures found`);
    for (const k of Object.keys(KNOWN_EXCEPTIONS)) assert.ok(OTHER_FILES.includes(k) || DTBOOK_FILES.includes(k), `${k} is not a file this test reads`);
  });
});

// ---------------------------------------------------------------------------------------------------------- real liblouis
describe('save -> reopen gives the same braille (real liblouis, contracted UEB)', async () => {
  await louis.init(path.join(here, '..', 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2, T1 = louis.TABLES.uebG1;
  const realOptions = (mode) => ({
    mode, standard: mode, width: 38, depth: 25, paragraphStyle: 'indented', tableFormat: 'auto', listStyle: 'spaced', toc: true,
    translate: (t, tf) => louis.translate(t, T, tf || null),
    translatePos: (t, tf) => louis.translatePos(t, T, tf || null),
    translateG1: (t) => louis.translate(t, T1, null),
  });
  for (const rel of ['fixtures/nimas-import-fixes/poems.xml', 'fixtures/nimas-import-fixes/nested-table-q.xml', 'fixtures/import-audit/dtbook/d01-features.xml', 'nimas_samples/basicDTBook.xml', 'nimas_samples/glossary.xml']) {
    test(rel, async () => {
      const model = await openFile(rel);
      const diff = await differences(model, realOptions);
      assert.deepEqual(Object.keys(diff), [], `the braille changed on reopening in ${Object.keys(diff).join(' and ')}:\n${Object.values(diff)[0]}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------- one small test per cause
// Models built by hand (what the readers produce), so each cause stays covered whatever happens to the big fixtures.
const same = async (model, why) => {
  const diff = await differences(model, (mode) => upperOptions(mode));
  assert.deepEqual(Object.keys(diff), [], `${why}: ${Object.values(diff)[0] || ''}`);
};

describe('causes found by this test', () => {
  test('a forced line break in plain paragraph text is saved as <br/> and read back as a line break', async () => {
    const model = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'H' }, { type: 'para', text: 'Line one\nline two' }] };
    const { xml, back } = await saveAndReopen(model);
    assert.match(xml, /<p>Line one<br\/>line two<\/p>/);
    const b = back.blocks[1];
    assert.equal((b.segments || [{ text: b.text }]).map((s) => s.text).join(''), 'Line one\nline two', 'the line break is in the reopened paragraph');
    await same(model, 'forced line break');
  });

  test('legal numbering (1, 1.1, 1.1.1) keeps each item\'s own number, and only that', async () => {
    const model = { title: 'T', blocks: [{ type: 'list', items: [
      { text: 'one', marker: '1.' },
      { text: 'one one', marker: '1.1', level: 1 },
      { text: 'one one one', marker: '1.1.1', level: 2 },
      { text: 'one one two', marker: '1.1.2', level: 2 },
      { text: 'one two', marker: '1.2', level: 1 },
      { text: 'two', marker: '2.' },
    ] }] };
    const { xml, back } = await saveAndReopen(model);
    assert.match(xml, /<li class="bana-marker" title="1\.1">1\.1 one one/);
    assert.deepEqual(back.blocks[0].items.map((i) => [i.marker, i.text]), model.blocks[0].items.map((i) => [i.marker, i.text]));
    await same(model, 'legal numbering');
  });

  test('a bare number ("1", no full stop) beside bullets keeps its number', async () => {
    const model = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'bullet', marker: '•' }, { text: 'first', marker: '1' }, { text: 'second', marker: '2' }] }] };
    const { back } = await saveAndReopen(model);
    assert.deepEqual(back.blocks[0].items.map((i) => [i.marker, i.text]), [['•', 'bullet'], ['1', 'first'], ['2', 'second']]);
    await same(model, 'mixed bullets and bare numbers');
  });

  test('a bullet among numbered items stays a bullet (it does not take the next number)', async () => {
    const model = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'one', marker: '1.' }, { text: 'interrupt', marker: '•' }, { text: 'two', marker: '2.' }] }] };
    const { back } = await saveAndReopen(model);
    assert.deepEqual(back.blocks[0].items.map((i) => [i.marker, i.text]), [['1.', 'one'], ['•', 'interrupt'], ['2.', 'two']]);
    await same(model, 'bullet inside a numbered list');
  });

  test('a cell whose only richness is a superscript keeps the level', async () => {
    const model = { title: 'T', blocks: [{ type: 'table', headers: ['Head A', 'Head B'], rows: [[`x${SCRIPT_MARKS.supOpen}2${SCRIPT_MARKS.end}`, 'plain'], [`H${SCRIPT_MARKS.subOpen}2${SCRIPT_MARKS.end}O`, 'more']] }] };
    const { back } = await saveAndReopen(model);
    assert.deepEqual(back.blocks[0].rows, model.blocks[0].rows, 'the level markers are still in the cells');
    await same(model, 'sub/superscript in a cell');
  });

  test('a table whose first row is all bold but is not a heading row stays without a heading row', async () => {
    const bold = (t) => ({ text: t, segments: [{ type: 'text', text: t, tf: 4 }] });
    const model = { title: 'T', blocks: [{ type: 'table', headers: [], rows: [[bold('Bold one'), bold('Bold two')], ['plain', 'cells']] }] };
    const { xml, back } = await saveAndReopen(model);
    assert.match(xml, /<tr class="bana-body-row">/);
    assert.equal(back.blocks[0].headers.length, 0, 'no heading row is invented');
    assert.equal(back.blocks[0].rows.length, 2);
    await same(model, 'bold first row');
  });

  test('a real heading row is still a heading row (the data-row class is only for a headerless table)', async () => {
    const model = { title: 'T', blocks: [{ type: 'table', headers: ['Name', 'Value'], rows: [['a', '1'], ['b', '2']] }] };
    const { xml, back } = await saveAndReopen(model);
    assert.doesNotMatch(xml, /bana-body-row/);
    assert.deepEqual(back.blocks[0].headers, ['Name', 'Value']);
  });

  test('a bold first row in print with no heading row, in a file that does not say so, is still read as a heading (Bug 2, BANA 11.16.1d-e)', () => {
    const xml = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1><h1>H</h1><table><tbody><tr><td><strong>Word</strong></td><td><strong>Meaning</strong></td></tr><tr><td>a</td><td>b</td></tr></tbody></table></level1></bodymatter></book></dtbook>`;
    const model = parseDtbook(xml);
    const t = model.blocks.find((b) => b.type === 'table');
    assert.equal(t.headers.length, 2);
    assert.equal(t.rows.length, 1);
  });

  test('a file saved twice is the same file (the export is stable)', async () => {
    const model = await openFile('fixtures/nimas-import-fixes/poems.xml');
    const strip = (x) => x.replace(/emboss-\d+/g, 'emboss-X').replace(/name="dc:Date" content="[^"]*"/, '');
    const once = strip(exportToNimasXml(structuredClone(model)));
    const twice = strip(exportToNimasXml(structuredClone(parseDtbook(once))));
    assert.equal(twice, once);
  });
});
