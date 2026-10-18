// Import-fix-list row 1a: a NIMAS package whose book is split over several DTBook content files.
// NIMAS allows it; parseNimasZip used to read only the first manifest item of type dtbook, so every
// later file was lost without a word. Now every content file the OPF manifest lists
// (application/x-dtbook+xml) is read, in SPINE order (manifest items the spine does not list follow,
// in manifest order), and joined into one model: front matter from the first file, rear matter from
// the last (they fall there by order), metadata from the OPF and the first file, each file's note
// ids and image paths resolved against that file's own folder. A package with ONE file is
// unchanged (the existing nimas_package_import.test.mjs checks that).
// The fixture package is in tests/fixtures/nimas-multifile-package/pkg (part1.xml, text/part2.xml,
// part3.xml and the OPF, whose MANIFEST order is deliberately not the spine order); the images are
// made here (distinct bytes each) and go in a subfolder of the first file, and of the second.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
import { parseNimasZip } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';
import { buildNimasPackageZip } from '../input/nimas-package.mjs';
import { saveAndReopen, upperOptions, brailleLines, firstDifference } from './helpers/nimas-braille.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(here, 'fixtures', 'nimas-multifile-package', 'pkg');
const png = (n) => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, n, n + 1, n + 2]);
const FIG1 = png(10), FIG2 = png(20), FIG3 = png(30);

/** The fixture package as zip entries (under one top folder); `edit` may change / drop entries by name. */
function fixtureFiles(edit = (x) => x) {
  const read = (p) => fs.readFileSync(path.join(PKG, p), 'utf8');
  const entries = {
    '9780000000001.opf': read('9780000000001.opf'),
    'part1.xml': read('part1.xml'),
    'text/part2.xml': read('text/part2.xml'),
    'part3.xml': read('part3.xml'),
    'images/fig1.png': FIG1,
    'text/art/fig2.png': FIG2,
    'images/fig3.png': FIG3,
  };
  const out = edit(entries) || entries;
  return Object.entries(out).filter(([, v]) => v != null).map(([name, v]) => (typeof v === 'string' ? { name: `pkg/${name}`, text: v } : { name: `pkg/${name}`, data: v }));
}
const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const open = async (edit) => parseNimasZip(await zipBuf(fixtureFiles(edit)));
const allText = (blocks) => JSON.stringify(blocks);
const graphicsOf = (blocks) => {
  const out = [], seen = new Set();
  (function deep(v) { if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v); if (v.type === 'graphic') out.push(v); for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]); })(blocks);
  return out;
};

test('1a every content file in the OPF is read, in spine order (not manifest order), front matter first and rear matter last', async () => {
  const model = await open();
  const all = allText(model.blocks);
  for (const w of ['Dedication one', 'Chapter one', 'Words of chapter one', 'Chapter two', 'Words of chapter two', 'Chapter three', 'Words of chapter three', 'Glossary', 'Meaning of the term']) {
    assert.ok(all.includes(w), `${w} is in the model`);
  }
  const at = (w) => all.indexOf(w);
  assert.ok(at('Dedication one') < at('Chapter one') && at('Chapter one') < at('Chapter two') && at('Chapter two') < at('Chapter three') && at('Chapter three') < at('Glossary'),
    'front matter, chapters one to three, then the rear matter, in spine order');
  assert.equal(model.warnings, undefined, 'nothing missing, nothing to warn about');
});

test('1a metadata: OPF and the first file; the package remembers every content file', async () => {
  const model = await open();
  assert.equal(model.title, 'Multi-file Fixture Book');
  assert.equal(model.metadata.docauthor, 'Fixture Author');
  assert.equal(model.metadata.creator, 'Fixture Author');
  assert.equal(model.metadata.publisher, 'Fixture Press');
  assert.equal(model.metadata.identifier, '9780000000001');
  assert.equal(model.metadata.nimas['nimas-SourceEdition'], 'First');
  assert.equal(model.metadata.package.opf, 'pkg/9780000000001.opf');
  assert.equal(model.metadata.package.book, 'pkg/part1.xml');
  assert.deepEqual(model.metadata.package.books, ['pkg/part1.xml', 'pkg/text/part2.xml', 'pkg/part3.xml']);
});

test('1a images: each file\'s paths are resolved against that file\'s own folder; a picture two files share is kept once', async () => {
  const model = await open();
  const srcs = graphicsOf(model.blocks).map((g) => g.src);
  assert.deepEqual(srcs, ['images/fig1.png', 'images/fig1.png', 'text/art/fig2.png', 'images/fig3.png'], 'paths relative to the first file\'s folder');
  const byPath = Object.fromEntries(model.resources.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(byPath).sort(), ['images/fig1.png', 'images/fig3.png', 'text/art/fig2.png']);
  assert.deepEqual(Array.from(byPath['images/fig1.png'].bytes), Array.from(FIG1));
  assert.deepEqual(Array.from(byPath['text/art/fig2.png'].bytes), Array.from(FIG2), 'the picture in the subfolder of the second file');
  assert.deepEqual(Array.from(byPath['images/fig3.png'].bytes), Array.from(FIG3));
  assert.equal(byPath['text/art/fig2.png'].mime, 'image/png');
  assert.equal(model.warnings, undefined, 'no missing-image warning');
});

test('1a notes: two files that both use the id "n1" keep their own note each', async () => {
  const model = await open();
  const notes = model.blocks.filter((b) => b.type === 'footnote');
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0].id, notes[1].id, 'the ids no longer collide');
  const refs = [];
  (function deep(v) { if (!v || typeof v !== 'object') return; if (v.type === 'noteref') refs.push(v); for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]); })(model.blocks);
  assert.equal(refs.length, 2);
  const textOfNote = (id) => notes.find((n) => n.id === id)?.text;
  assert.equal(textOfNote(refs[0].idref), 'Note text of part one.');
  assert.equal(textOfNote(refs[1].idref), 'Note text of part two.');
});

test('1a the joined book saves and reopens to the same braille (BANA and UKAAF)', async () => {
  const model = await open();
  const { back } = await saveAndReopen(model);
  for (const mode of ['bana', 'ukaaf']) {
    const d = firstDifference(brailleLines(model, upperOptions(mode)), brailleLines(back, upperOptions(mode)));
    assert.equal(d, null, `${mode}: ${d}`);
  }
  const text = brailleLines(model, upperOptions('bana')).join('\n');
  assert.ok(text.includes('NOTE TEXT OF PART ONE.') && text.includes('NOTE TEXT OF PART TWO.'), 'both notes are in the braille');
  assert.ok(text.includes('WORDS OF CHAPTER THREE') && text.includes('MEANING OF THE TERM'));
});

test('1a the joined book saved as a NIMAS package (one content file) reopens to the same text, notes, pictures and braille', async () => {
  const model = await open();
  const zip = await buildNimasPackageZip(model);
  const back = await parseNimasZip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
  assert.equal(back.metadata.package.books, undefined, 'the saved package has one content file');
  assert.deepEqual(graphicsOf(back.blocks).map((g) => g.src), graphicsOf(model.blocks).map((g) => g.src));
  assert.deepEqual(back.resources.map((r) => r.path).sort(), model.resources.map((r) => r.path).sort());
  for (const mode of ['bana', 'ukaaf']) {
    const d = firstDifference(brailleLines(model, upperOptions(mode)), brailleLines(back, upperOptions(mode)));
    assert.equal(d, null, `${mode}: ${d}`);
  }
});

test('1a a content file the manifest lists but the zip lacks: the others are read and a warning says so', async () => {
  const model = await open((e) => { delete e['text/part2.xml']; return e; });
  const all = allText(model.blocks);
  assert.ok(all.includes('Chapter one') && all.includes('Chapter three') && !all.includes('Chapter two'));
  assert.ok(model.warnings.some((w) => /1 content file/.test(w) && /missing/.test(w)), JSON.stringify(model.warnings));
  assert.deepEqual(model.metadata.package.books, ['pkg/part1.xml', 'pkg/part3.xml']);
});

test('1a a later content file that is not readable: the others are read and a warning names it', async () => {
  const model = await open((e) => { e['text/part2.xml'] = '<dtbook><book><bodymatter><level1><h1>Broken'; return e; });
  const all = allText(model.blocks);
  assert.ok(all.includes('Chapter one') && all.includes('Chapter three'));
  assert.ok(model.warnings.some((w) => /part2\.xml/.test(w)), JSON.stringify(model.warnings));
});

test('1a a dtbook item the spine does not list is still read, after the spine items; with no spine the manifest order is used', async () => {
  const noPart3InSpine = (e) => { e['9780000000001.opf'] = e['9780000000001.opf'].replace('<itemref idref="part3"/>', ''); return e; };
  const m1 = await open(noPart3InSpine);
  const a1 = allText(m1.blocks);
  assert.ok(a1.includes('Chapter three'), 'not in the spine, still read');
  assert.ok(a1.indexOf('Chapter two') < a1.indexOf('Chapter three'));
  const noSpine = (e) => { e['9780000000001.opf'] = e['9780000000001.opf'].replace(/<spine>[\s\S]*<\/spine>/, ''); return e; };
  const m2 = await open(noSpine);
  assert.deepEqual(m2.metadata.package.books, ['pkg/part3.xml', 'pkg/part1.xml', 'pkg/text/part2.xml'], 'manifest order');
  assert.ok(allText(m2.blocks).includes('Chapter two'));
});

test('1a a package with ONE content file is read exactly as before (no "books" list)', async () => {
  const model = await open((e) => {
    e['9780000000001.opf'] = e['9780000000001.opf'].replace(/<item id="part3"[^>]*>/, '').replace(/<item id="part2"[^>]*>/, '').replace('<itemref idref="part2"/>', '').replace('<itemref idref="part3"/>', '');
    return e;
  });
  assert.deepEqual(model.metadata.package, { opf: 'pkg/9780000000001.opf', book: 'pkg/part1.xml' });
  const all = allText(model.blocks);
  assert.ok(all.includes('Chapter one') && !all.includes('Chapter two') && !all.includes('Chapter three'));
});
