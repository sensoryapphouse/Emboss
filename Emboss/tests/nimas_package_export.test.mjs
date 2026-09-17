// NIMAS package (zip) export (A4): the save-side counterpart to nimas_package_import.test.mjs
// (A3) — buildNimasOpf's OPF content/manifest, buildNimasPackage's id/file-naming and
// data:-graphic handling, and the full round trip parseNimasZip(buildNimasPackageZip(model)).
// Node-only; shims DOMParser with @xmldom/xmldom (as parse.mjs's own tests do).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
import { parseNimasZip } from '../input/parse.mjs';
import { buildNimasOpf, buildNimasPackage, buildNimasPackageZip } from '../input/nimas-package.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CAST_ZIPS = path.join(here, '..', 'web', 'test_corpus_cast', 'zips');

// A tiny 1x1 red-pixel PNG (valid bytes, not that it matters to the test).
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const dec = (bytes) => new TextDecoder().decode(bytes);

function graphicsOf(blocks) {
  const out = [];
  const seen = new Set();
  (function deep(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.type === 'graphic') out.push(v);
    for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]);
  })(blocks);
  return out;
}

// The full set of x-metadata entries NIMAS's package-doc-common.sch requires to exist
// (see nimas-package.mjs's REQUIRED_NIMAS_METAS/REQUIRED_DCTERMS_METAS and the A4 DAISY
// validation notes) — asserted against directly so a future edit that drops one is caught.
const REQUIRED_X_METAS = [
  'nimas-SourceDate', 'DCTERMS.description.note', 'DCTERMS.date.dateCopyrighted',
  'DCTERMS.description.version', 'DCTERMS.audience.educationLevel', 'DCTERMS.publisher.place',
  'DCTERMS.date.issued',
];

test('buildNimasOpf: OPF content and manifest', () => {
  const model = {
    title: 'Ignored (metadata.title wins)',
    blocks: [],
    metadata: {
      title: 'A Test Book', creator: 'Jane Author', identifier: '9781111111111NIMAS',
      language: 'en', date: '2024-05-01', publisher: 'Test Press', format: 'NIMAS 1.1',
      rights: 'All rights reserved.', source: '9781111111111', subject: 'Testing',
      dcAttrs: { dateEvent: 'DCTERMS.created', creatorRole: 'author', identifierScheme: 'NIMAS' },
      nimas: { 'nimas-SourceEdition': '2nd', 'nimas-SourceDate': '2023' },
      // A repeated x-metadata meta (parse.mjs's readOpfMetadata stores it as an array) must
      // be written back as one <meta> per value, in order — the CAST corpus has exactly
      // this shape for DCTERMS.description.note.
      opfMeta: { 'DCTERMS.description.note': ['First note.', 'Second note.'], 'DCTERMS.publisher.place': 'Wakefield, MA' },
    },
  };
  const items = [
    { id: 'cover', href: 'images/cover.jpg', mediaType: 'image/jpeg' },
    { id: 'titlepage', href: '9781111111111NIMAS.pdf', mediaType: 'application/pdf' },
  ];
  const opf = buildNimasOpf(model, { bookFile: '9781111111111NIMAS.xml', items });

  assert.match(opf, /<!DOCTYPE package PUBLIC "\+\/\/ISBN 0-9673008-1-9\/\/DTD OEB 1.2 Package\/\/EN"/);
  assert.match(opf, /<package xmlns="http:\/\/openebook\.org\/namespaces\/oeb-package\/1\.0\/" unique-identifier="id_9781111111111NIMAS" xml:lang="en">/);
  assert.match(opf, /<dc:Title>A Test Book<\/dc:Title>/);
  assert.match(opf, /<dc:Creator role="author">Jane Author<\/dc:Creator>/);
  assert.match(opf, /<dc:Identifier id="id_9781111111111NIMAS" scheme="NIMAS">9781111111111NIMAS<\/dc:Identifier>/);
  assert.match(opf, /<dc:Date event="DCTERMS\.created">2024-05-01<\/dc:Date>/);
  assert.match(opf, /<dc:Language>en<\/dc:Language>/);
  assert.match(opf, /<dc:Publisher>Test Press<\/dc:Publisher>/);
  assert.match(opf, /<dc:Format>NIMAS 1\.1<\/dc:Format>/);
  assert.match(opf, /<dc:Rights>All rights reserved\.<\/dc:Rights>/);
  assert.match(opf, /<dc:Source>9781111111111<\/dc:Source>/);
  assert.match(opf, /<dc:Subject>Testing<\/dc:Subject>/);
  assert.match(opf, /<meta name="nimas-SourceDate" content="2023"\/>/);
  assert.match(opf, /<meta name="nimas-SourceEdition" content="2nd"\/>/);
  // Both values of the repeated meta, in order, as two separate <meta> elements.
  assert.match(opf, /<meta name="DCTERMS\.description\.note" content="First note\."\/>\s*<meta name="DCTERMS\.description\.note" content="Second note\."\/>/);
  assert.match(opf, /<meta name="DCTERMS\.publisher\.place" content="Wakefield, MA"\/>/);
  // The rest of the required x-metadata set was topped up (empty content — not supplied above).
  for (const name of ['DCTERMS.date.dateCopyrighted', 'DCTERMS.description.version', 'DCTERMS.audience.educationLevel', 'DCTERMS.date.issued']) {
    assert.match(opf, new RegExp(`<meta name="${name.replace(/\./g, '\\.')}" content=""/>`), `${name} present (empty) when not supplied`);
  }
  assert.match(opf, /<item id="nimasxmlfile" href="9781111111111NIMAS\.xml" media-type="application\/x-dtbook\+xml"\/>/);
  assert.match(opf, /<item id="cover" href="images\/cover\.jpg" media-type="image\/jpeg"\/>/);
  assert.match(opf, /<item id="titlepage" href="9781111111111NIMAS\.pdf" media-type="application\/pdf"\/>/);
  assert.match(opf, /<itemref idref="nimasxmlfile"\/>/);
});

test('buildNimasOpf: a document typed from scratch is still structurally NIMAS-complete (required dc:/x-metadata present, empty where unknown)', () => {
  const model = { title: 'My Notes', blocks: [] };
  const opf = buildNimasOpf(model, { bookFile: 'x.xml', items: [], identifier: 'emboss-fixed-id' });
  assert.match(opf, /<dc:Title>My Notes<\/dc:Title>/);
  assert.match(opf, /<dc:Identifier id="emboss-fixed-id" scheme="NIMAS">emboss-fixed-id<\/dc:Identifier>/);
  assert.match(opf, /<dc:Language>en<\/dc:Language>/);
  assert.match(opf, /<dc:Date event="DCTERMS\.created">\d{4}-\d{2}-\d{2}<\/dc:Date>/);
  assert.match(opf, /<dc:Format>NIMAS 1\.1<\/dc:Format>/);
  assert.match(opf, /<dc:Publisher>Emboss Braille Editor<\/dc:Publisher>/);
  // NIMAS requires these dc: elements to exist; no sensible value is known, so empty.
  assert.match(opf, /<dc:Rights><\/dc:Rights>/);
  assert.match(opf, /<dc:Source><\/dc:Source>/);
  assert.match(opf, /<dc:Subject><\/dc:Subject>/);
  // ...and every required x-metadata entry, likewise empty.
  for (const name of REQUIRED_X_METAS) {
    assert.match(opf, new RegExp(`<meta name="${name.replace(/\./g, '\\.')}" content=""/>`), `${name} present (empty)`);
  }
});

test('buildNimasOpf: a custom dc:Date/@event, dc:Creator/@role or dc:Identifier/@scheme from the source survives', () => {
  const model = {
    title: 'T', blocks: [],
    metadata: { title: 'T', identifier: 'X1', creator: 'A. Editor', dcAttrs: { dateEvent: 'dc:created', creatorRole: 'editor', identifierScheme: 'ISBN' } },
  };
  const opf = buildNimasOpf(model, { bookFile: 'x.xml', items: [] });
  assert.match(opf, /<dc:Date event="dc:created">/);
  assert.match(opf, /<dc:Creator role="editor">A\. Editor<\/dc:Creator>/);
  assert.match(opf, /<dc:Identifier id="X1" scheme="ISBN">X1<\/dc:Identifier>/);
});

test('buildNimasPackage: ids are consistent across folder, filenames, dtb:uid and dc:Identifier', () => {
  const model = {
    blocks: [{ type: 'title', text: 'T' }],
    metadata: { title: 'T', identifier: '9781930583733NIMAS' },
  };
  const pkg = buildNimasPackage(model);
  assert.equal(pkg.id, '9781930583733NIMAS');
  assert.equal(pkg.zipName, '9781930583733NIMAS.zip');
  const names = pkg.files.map((f) => f.name);
  assert.ok(names.includes('9781930583733NIMAS/9781930583733NIMAS.xml'));
  assert.ok(names.includes('9781930583733NIMAS/9781930583733NIMAS.opf'));
  const dec = new TextDecoder();
  const xml = dec.decode(pkg.files.find((f) => f.name.endsWith('.xml')).data);
  const opf = dec.decode(pkg.files.find((f) => f.name.endsWith('.opf')).data);
  assert.match(xml, /<meta name="dtb:uid" content="9781930583733NIMAS"\s*\/>/);
  assert.match(opf, /<dc:Identifier id="[^"]+" scheme="NIMAS">9781930583733NIMAS<\/dc:Identifier>/);
});

test('buildNimasPackage: a data: SVG graphic becomes a file, and the live model is left untouched', () => {
  const dataUri = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8').toString('base64');
  const model = {
    blocks: [{ type: 'title', text: 'T' }, { type: 'graphic', src: dataUri, alt: 'A tactile graphic' }],
    metadata: { title: 'T', identifier: 'emboss-svg-test' },
  };
  const before = JSON.parse(JSON.stringify(model));
  const pkg = buildNimasPackage(model);

  assert.deepEqual(model, before, 'buildNimasPackage must not mutate the model it was given');
  assert.equal(pkg.imageCount, 1);
  const imgFile = pkg.files.find((f) => f.name === 'emboss-svg-test/images/emboss-1.svg');
  assert.ok(imgFile, 'the data: graphic was written out as a file');
  assert.equal(dec(imgFile.data), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  const xml = dec(pkg.files.find((f) => f.name.endsWith('.xml')).data);
  assert.match(xml, /src="images\/emboss-1\.svg"/);
  assert.ok(!xml.includes('data:image/svg+xml'), 'the saved XML no longer carries the raw data: URI');
});

test('buildNimasPackage: a resource no graphic refers to any more is dropped', () => {
  const model = {
    blocks: [
      { type: 'title', text: 'T' },
      { type: 'graphic', src: 'images/kept.png', alt: 'Kept' },
    ],
    metadata: { title: 'T', identifier: 'emboss-drop-test' },
    resources: [
      { path: 'images/kept.png', mime: 'image/png', bytes: PNG_BYTES },
      { path: 'images/orphaned.png', mime: 'image/png', bytes: PNG_BYTES },
    ],
  };
  const pkg = buildNimasPackage(model);
  const names = pkg.files.map((f) => f.name);
  assert.ok(names.includes('emboss-drop-test/images/kept.png'));
  assert.ok(!names.includes('emboss-drop-test/images/orphaned.png'));
  assert.equal(pkg.imageCount, 1);
});

test('round trip: parseNimasZip(buildNimasPackageZip(model)) keeps blocks, image bytes, source PDF and metadata', async () => {
  const model = {
    blocks: [
      { type: 'title', text: 'Round Trip Book' },
      { type: 'heading', level: 1, text: 'Chapter One' },
      { type: 'para', text: 'Some body text.' },
      { type: 'graphic', src: 'images/pic.png', alt: 'A picture' },
    ],
    metadata: {
      title: 'Round Trip Book', identifier: '9782222222222NIMAS', language: 'en',
      publisher: 'Round Trip Press', date: '2024-01-01',
    },
    resources: [
      { path: 'images/pic.png', mime: 'image/png', bytes: PNG_BYTES },
      { path: '9782222222222NIMAS.pdf', mime: 'application/pdf', bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]), role: 'source-pdf' },
    ],
  };

  const zipBytes = await buildNimasPackageZip(model);
  const reparsed = await parseNimasZip(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength));

  assert.equal(reparsed.title, 'Round Trip Book');
  assert.equal(reparsed.metadata.identifier, '9782222222222NIMAS');
  assert.equal(reparsed.metadata.publisher, 'Round Trip Press');
  // title + heading + para + graphic block — same shape the original model had.
  assert.equal(reparsed.blocks.filter((b) => b.type === 'title' || b.type === 'heading' || b.type === 'para').length, 3);
  const graphics = graphicsOf(reparsed.blocks);
  assert.equal(graphics.length, 1);

  const images = reparsed.resources.filter((r) => r.role !== 'source-pdf');
  assert.equal(images.length, 1);
  assert.deepEqual(Array.from(images[0].bytes), Array.from(PNG_BYTES));

  const pdfs = reparsed.resources.filter((r) => r.role === 'source-pdf');
  assert.equal(pdfs.length, 1);
  assert.equal(pdfs[0].path, '9782222222222NIMAS.pdf');
  assert.deepEqual(Array.from(pdfs[0].bytes), [0x25, 0x50, 0x44, 0x46]);
});

// CAST AEM NIMAS zip (A29/A3/A4), kept locally in web/test_corpus_cast/zips (educational use,
// not to be re-posted, so not in git): skipped when the folder is absent.
const coyotesZip = path.join(CAST_ZIPS, '9781930583733NIMAS.zip');
test('CAST "All About Coyotes" round trip: parse, re-package, re-parse keeps blocks/images/PDF/metadata',
  { skip: !fs.existsSync(coyotesZip) && 'CAST corpus zips not present (web/test_corpus_cast/zips)' },
  async () => {
    const buf = fs.readFileSync(coyotesZip);
    const original = await parseNimasZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

    // Sanity: the CAST source really does have a repeated x-metadata meta (this is what
    // motivated readOpfMetadata's array-on-repeat, and the DCTERMS.created/dc:Rights/dc:Source/
    // dc:Subject/required-x-metadata fixes below — DAISY's nimas-fileset-validator failed all
    // of these on the saved package before A4's follow-up fix).
    assert.ok(Array.isArray(original.metadata.opfMeta['DCTERMS.description.note']), 'source has a repeated DCTERMS.description.note');

    const pkg = buildNimasPackage(original);
    const opf = dec(pkg.files.find((f) => f.name.endsWith('.opf')).data);
    assert.match(opf, /<dc:Date event="DCTERMS\.created">/, 'dc:Date keeps its required @event');
    assert.match(opf, /<dc:Rights>[^<]+<\/dc:Rights>/, 'dc:Rights is present (and non-empty: known from the source)');
    assert.match(opf, /<dc:Source>[^<]+<\/dc:Source>/, 'dc:Source is present (and non-empty: known from the source)');
    assert.match(opf, /<dc:Subject>[^<]+<\/dc:Subject>/, 'dc:Subject is present (and non-empty: known from the source)');
    for (const name of REQUIRED_X_METAS) {
      assert.match(opf, new RegExp(`<meta name="${name.replace(/\./g, '\\.')}" content="[^"]*"/>`), `${name} present`);
    }
    const noteMatches = [...opf.matchAll(/<meta name="DCTERMS\.description\.note" content="([^"]*)"\/>/g)];
    assert.equal(noteMatches.length, 2, 'both DCTERMS.description.note values were written back, not just the first');

    const zipBytes = await buildNimasPackageZip(original);
    const reparsed = await parseNimasZip(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength));

    assert.equal(reparsed.title, original.title);
    assert.equal(reparsed.metadata.publisher, original.metadata.publisher);
    assert.equal(reparsed.blocks.length, original.blocks.length);
    // The repeated meta survives the full round trip too (same two values, same order).
    assert.deepEqual(reparsed.metadata.opfMeta['DCTERMS.description.note'], original.metadata.opfMeta['DCTERMS.description.note']);

    const origImages = original.resources.filter((r) => r.role !== 'source-pdf');
    const newImages = reparsed.resources.filter((r) => r.role !== 'source-pdf');
    assert.equal(newImages.length, origImages.length);
    const byPath = new Map(newImages.map((r) => [r.path, r]));
    for (const r of origImages) {
      assert.ok(byPath.has(r.path), `image kept: ${r.path}`);
      assert.deepEqual(Array.from(byPath.get(r.path).bytes), Array.from(r.bytes));
    }

    const origPdf = original.resources.find((r) => r.role === 'source-pdf');
    const newPdf = reparsed.resources.find((r) => r.role === 'source-pdf');
    assert.ok(origPdf, 'sanity: the CAST package has a source PDF');
    assert.ok(newPdf, 'the source PDF round-tripped');
    assert.equal(newPdf.path, origPdf.path);
    assert.deepEqual(Array.from(newPdf.bytes), Array.from(origPdf.bytes));
  });

// The editor wires the package save into both Ctrl+S/the Save button and the Download menu.
test('editor.mjs wires the NIMAS package save into the Save button/Ctrl+S and the Download menu', () => {
  const editorSrc = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  assert.match(editorSrc, /import\s*\{\s*buildNimasPackage\s*\}\s*from\s*'\/input\/nimas-package\.mjs(\?[^']*)?'/);
  assert.match(editorSrc, /if \(format === 'package'\) \{/);
  assert.ok(editorSrc.includes("saveBlob(makeZip(pkg.files), pkg.zipName)"));
  assert.ok(editorSrc.includes("t('app.save.package'"));
  assert.ok(editorSrc.includes('function saveFormat()'));
  assert.ok(editorSrc.includes("exportTextDocument(saveFormat())"), 'Save/Ctrl+S must pick the format dynamically');
  assert.ok(editorSrc.includes("$id('downloadPackageItem')"), 'the Download menu must wire the package item');

  const indexHtml = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('id="downloadPackageItem"'), 'the Download menu markup must have the package item');
  assert.ok(indexHtml.includes('data-i18n="app.save.package_item"'));

  const en = JSON.parse(fs.readFileSync(path.join(here, '..', 'web', 'locales', 'en.json'), 'utf8'));
  assert.equal(typeof en.app.save.package, 'string');
  assert.equal(typeof en.app.save.package_item, 'string');
});
