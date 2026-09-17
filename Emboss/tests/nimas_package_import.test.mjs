// NIMAS package (zip) import (A3): parseNimasZip must pick the DTBook out of the OPF
// manifest (falling back to a bare <dtbook> .xml when the OPF is absent or lies about the
// book file), fold OEB/OPF dc-metadata into model.metadata without overriding whatever the
// DTBook <head> already set, and pull the package's images into model.resources with the
// graphic's src normalised to a path relative to the DTBook's own folder.
// Node-only; shims DOMParser with @xmldom/xmldom (as the other input/tests/*.test.mjs do)
// and builds test packages with the STORE-only writer in web/zip.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
import { parseNimasZip } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CAST_ZIPS = path.join(here, '..', 'web', 'test_corpus_cast', 'zips');

const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const bufFromFile = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const graphicsOf = (blocks) => {
  const out = [];
  const seen = new Set();
  (function deep(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.type === 'graphic') out.push(v);
    for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]);
  })(blocks);
  return out;
};

test('OEB-style OPF: dtbook in a subfolder, an image, DTBook head wins over OPF metadata', async () => {
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const opf = `<?xml version="1.0"?>
<package xmlns="http://openebook.org/namespaces/oeb-package/1.0/" unique-identifier="uid">
  <metadata>
    <dc-metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:Title>OPF Title</dc:Title>
      <dc:Creator role="author">OPF Author</dc:Creator>
      <dc:Publisher>OPF Publisher</dc:Publisher>
      <dc:Date>2020-01-01</dc:Date>
      <dc:Identifier id="uid">OPFID123</dc:Identifier>
      <dc:Language>en</dc:Language>
      <dc:Rights>OPF Rights</dc:Rights>
      <dc:Source>OPF Source</dc:Source>
      <dc:Subject>OPF Subject</dc:Subject>
      <dc:Format>NIMAS 1.1</dc:Format>
    </dc-metadata>
    <x-metadata>
      <meta name="nimas-SourceEdition" content="1st"/>
    </x-metadata>
  </metadata>
  <manifest>
    <item id="book1" href="doc/book.xml" media-type="application/x-dtbook+xml"/>
    <item id="img1" href="doc/images/a.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="book1"/></spine>
</package>`;
  const dtbook = `<?xml version="1.0"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3">
  <head><meta name="dc:Title" content="DTBook Title"/></head>
  <book><bodymatter><level1>
    <h1>Chapter</h1>
    <p>Text</p>
    <img src="./images/a.png" alt="A"/>
  </level1></bodymatter></book>
</dtbook>`;
  const buf = await zipBuf([
    { name: 'pkg/content.opf', text: opf },
    { name: 'pkg/doc/book.xml', text: dtbook },
    { name: 'pkg/doc/images/a.png', data: pngBytes },
  ]);
  const model = await parseNimasZip(buf);

  // DTBook <head> set title/metadata.title; the OPF's dc:Title must not override it.
  assert.equal(model.title, 'DTBook Title');
  assert.equal(model.metadata.title, 'DTBook Title');
  // Everything else came only from the OPF.
  assert.equal(model.metadata.creator, 'OPF Author');
  assert.equal(model.metadata.publisher, 'OPF Publisher');
  assert.equal(model.metadata.date, '2020-01-01');
  assert.equal(model.metadata.identifier, 'OPFID123');
  assert.equal(model.metadata.rights, 'OPF Rights');
  assert.equal(model.metadata.source, 'OPF Source');
  assert.equal(model.metadata.subject, 'OPF Subject');
  assert.equal(model.metadata.format, 'NIMAS 1.1');
  assert.equal(model.metadata.nimas['nimas-SourceEdition'], '1st');
  assert.deepEqual(model.metadata.package, { opf: 'pkg/content.opf', book: 'pkg/doc/book.xml' });

  // The image: kept once, src normalised relative to the DTBook's own folder (no "./").
  const graphics = graphicsOf(model.blocks);
  assert.equal(graphics.length, 1);
  assert.equal(graphics[0].src, 'images/a.png');
  assert.equal(model.resources.length, 1);
  const [res] = model.resources;
  assert.equal(res.path, 'images/a.png');
  assert.equal(res.mime, 'image/png');
  assert.deepEqual(Array.from(res.bytes), Array.from(pngBytes));
  assert.equal(model.warnings, undefined);
});

test('no OPF: falls back to the .xml entry whose root is <dtbook>', async () => {
  const notTheBook = `<?xml version="1.0"?><foo><bar>not a book</bar></foo>`;
  const dtbook = `<?xml version="1.0"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3">
  <book><frontmatter><doctitle>No-OPF Book</doctitle></frontmatter>
  <bodymatter><level1><h1>H</h1><p>Body</p></level1></bodymatter></book>
</dtbook>`;
  const buf = await zipBuf([
    { name: 'other.xml', text: notTheBook },
    { name: 'content.xml', text: dtbook },
  ]);
  const model = await parseNimasZip(buf);
  assert.equal(model.title, 'No-OPF Book');
  assert.deepEqual(model.metadata.package, { opf: null, book: 'content.xml' });
});

test('a package with only an OPF and a PDF (manifest lies about the book file): clear error', async () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://openebook.org/namespaces/oeb-package/1.0/">
  <metadata><dc-metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:Title>T</dc:Title></dc-metadata></metadata>
  <manifest>
    <item id="book1" href="book.xml" media-type="application/x-dtbook+xml"/>
    <item id="pdf1" href="book.pdf" media-type="application/pdf"/>
  </manifest>
  <spine><itemref idref="book1"/></spine>
</package>`;
  const buf = await zipBuf([
    { name: 'book.pdf', data: Uint8Array.from([1, 2, 3]) },
    { name: 'book.opf', text: opf },
  ]);
  await assert.rejects(
    () => parseNimasZip(buf),
    (err) => {
      assert.equal(err.message, "This package has no DTBook book file (it contains: book.pdf, book.opf). A NIMAS package must include the book's .xml file.");
      return true;
    },
  );
});

test('an image the book references but the package does not include: one warning, others still kept', async () => {
  const dtbook = `<?xml version="1.0"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3">
  <book><bodymatter><level1>
    <h1>H</h1>
    <img src="images/present.jpg" alt="Present"/>
    <img src="images/absent.jpg" alt="Absent"/>
  </level1></bodymatter></book>
</dtbook>`;
  const buf = await zipBuf([
    { name: 'book.xml', text: dtbook },
    { name: 'images/present.jpg', data: Uint8Array.from([9, 9, 9]) },
  ]);
  const model = await parseNimasZip(buf);
  assert.equal(model.resources.length, 1);
  assert.equal(model.resources[0].path, 'images/present.jpg');
  assert.deepEqual(model.warnings, ['1 image referenced by the book is missing from the package']);
});

// CAST AEM NIMAS zips (A29/A3), kept locally in web/test_corpus_cast/zips (educational use,
// not to be re-posted, so not in git): skipped when the folder is absent.
const coyotesZip = path.join(CAST_ZIPS, '9781930583733NIMAS.zip');
test('CAST "All About Coyotes" package: title, publisher, every referenced image kept', { skip: !fs.existsSync(coyotesZip) && 'CAST corpus zips not present (web/test_corpus_cast/zips)' }, async () => {
  const model = await parseNimasZip(bufFromFile(coyotesZip));
  assert.equal(model.title, 'All About Coyotes');
  assert.equal(model.metadata.publisher, 'CAST, Inc.');
  const graphics = graphicsOf(model.blocks);
  const images = model.resources.filter((r) => r.role !== 'source-pdf');
  // Every graphic's src is a package image, and each is pulled into model.resources once.
  assert.ok(graphics.length > 0, 'has graphics');
  assert.equal(images.length, graphics.length, 'one resource per distinct referenced image');
  assert.ok(images.every((r) => r.path.startsWith('images/') && r.bytes.length > 0));
  assert.equal(model.warnings, undefined, 'no images missing from the package');
  // A4: the package's own source PDF is also kept, so a round-trip save can write it back.
  const pdfs = model.resources.filter((r) => r.role === 'source-pdf');
  assert.equal(pdfs.length, 1);
  assert.equal(pdfs[0].path, '9781930583733NIMAS.pdf');
  assert.equal(pdfs[0].mime, 'application/pdf');
  assert.ok(pdfs[0].bytes.length > 0);
});

const exemplarZip = path.join(CAST_ZIPS, 'nimasopfexemplar_092020.zip');
test('CAST opf-exemplar package (OPF + PDF, no book): clear error names the files it does have', { skip: !fs.existsSync(exemplarZip) && 'CAST corpus zips not present (web/test_corpus_cast/zips)' }, async () => {
  await assert.rejects(
    () => parseNimasZip(bufFromFile(exemplarZip)),
    (err) => {
      assert.equal(err.message, "This package has no DTBook book file (it contains: 9780544441576NIMAS.pdf, 9780544441576NIMAS_exemplar.opf). A NIMAS package must include the book's .xml file.");
      return true;
    },
  );
});
