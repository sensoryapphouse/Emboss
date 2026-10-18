// Audit batch S2b (ChatGPT audit 15 Oct 2026, Emboss/docs/chatgpt-audit-15oct.md), items 6, 7, 8, 9, 10 and 21. Every test was written before
// the fix and fails against the pre-change parse.mjs / nimas-package.mjs (the report lists the results). No existing expectation changed.
//
//   #6  Saving a NIMAS package: two pictures can no longer get the same file name (images/emboss-1.png restarted at 1 each save and ignored
//       the resources already in the package). One allocator names every output resource; duplicate entry names and manifest hrefs are refused.
//   #7  A picture (or source PDF) reached by a parent-relative path (../../image.png from a nested source XML) is saved inside the package
//       root and survives a reopen; an absolute or parent-escaping final path is refused.
//   #8  A Word file whose word/document.xml is damaged (a mismatched tag) was read by a browser as HTML and came back as an empty,
//       successful document. It is a damaged-file error now. (Node's xmldom throws; a browser's DOMParser does not: jsdom stands in for it.)
//   #9  EPUB: every spine item is accounted for; a chapter missing from the archive, a spine id missing from the manifest, a chapter whose
//       data is damaged: each is named in a warning; a book with no usable chapter is an error, never an empty success.
//   #10 EPUB chapter hrefs with ./ or ../ (or %-encoding, or a #fragment) are resolved against the OPF's folder.
//   #21 ZIP extraction checks the CRC-32 and the size of every part, stored or deflated; an unsupported compression or encryption is a clear
//       error; a damaged part is named.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { JSDOM } from 'jsdom';
import { parseFile, parseDocx, parseEpub, parseNimasZip } from '../input/parse.mjs';
import { buildNimasPackage, buildNimasPackageZip } from '../input/nimas-package.mjs';

globalThis.DOMParser = XmlDomParser;

// ------------------------------------------------------------------------------------------------ a ZIP writer with every fault on offer
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; } return t; })();
const crc32 = (u8) => { let c = -1; for (let i = 0; i < u8.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ u8[i]) & 0xFF]; return (c ^ -1) >>> 0; };
const enc = new TextEncoder();
const bytesOf = (v) => (v instanceof Uint8Array ? v : enc.encode(String(v)));
/**
 * entries: [{ name, data, method: 'store'|'deflate' (default store), crc, size (the declared uncompressed size), rawMethod, flags, corruptStored }]
 * `crc` / `size` override what the directory declares; `corruptStored(bytes)` changes the stored bytes AFTER the CRC was taken.
 */
function zipOf(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const data = bytesOf(e.data ?? '');
    const nameB = enc.encode(e.name);
    const deflate = e.method === 'deflate';
    let body = deflate ? new Uint8Array(zlib.deflateRawSync(data)) : data;
    if (e.corruptStored) body = e.corruptStored(Uint8Array.from(body));
    const crc = e.crc !== undefined ? e.crc : crc32(data);
    const size = e.size !== undefined ? e.size : data.length;
    const method = e.rawMethod !== undefined ? e.rawMethod : (deflate ? 8 : 0);
    const flags = e.flags || 0;
    const local = new Uint8Array(30 + nameB.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, flags, true); lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, size, true); lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    parts.push(local, body);
    const c = new Uint8Array(46 + nameB.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, flags, true); cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, size, true); cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true);
    c.set(nameB, 46);
    central.push(c);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out.buffer;
}
/** The entry names of a zip, read from its central directory. */
function namesOf(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = u8.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const names = [];
  for (let i = 0; i < count; i++) {
    const n = dv.getUint16(off + 28, true), x = dv.getUint16(off + 30, true), c = dv.getUint16(off + 32, true);
    names.push(new TextDecoder().decode(u8.subarray(off + 46, off + 46 + n)));
    off += 46 + n + x + c;
  }
  return names;
}
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// ------------------------------------------------------------------------------------------------ small packages
const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const docxZip = (documentXml, extra = [], method = 'store') => zipOf([
  { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
  { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
  { name: 'word/document.xml', data: documentXml, method },
  ...extra,
]);
const docBody = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WNS}"><w:body>${inner}</w:body></w:document>`;
const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const textOf = (blocks) => JSON.stringify(blocks);

const xhtml = (body) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
/** An EPUB zip. `manifest`: [{id, href, type}], `spine`: [idref], `files`: {path: content}, `opf`: where the OPF is. */
function epubZip({ opf = 'OEBPS/book.opf', manifest, spine, files, method = 'store', damage = {} }) {
  const opfXml = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Broken book</dc:title><dc:language>en</dc:language><dc:identifier id="id">x</dc:identifier></metadata><manifest>${manifest.map((m) => `<item id="${m.id}" href="${m.href}" media-type="${m.type || 'application/xhtml+xml'}"${m.props ? ` properties="${m.props}"` : ''}/>`).join('')}</manifest><spine>${spine.map((s) => `<itemref idref="${s}"/>`).join('')}</spine></package>`;
  return zipOf([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opf}" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: opf, data: opfXml },
    ...Object.entries(files).map(([name, data]) => ({ name, data, method, ...(damage[name] || {}) })),
  ]);
}

// ================================================================================================ #21 ZIP integrity
describe('#21 ZIP parts are checked against their CRC-32 and size', () => {
  test('a stored part whose bytes changed but whose CRC did not (CAT -> BAT) is a damaged file, naming the part', async () => {
    const zip = docxZip(docBody(para('CAT')));
    const u8 = new Uint8Array(zip);
    const at = Buffer.from(u8).indexOf('CAT');
    assert.ok(at > 0);
    u8.set(enc.encode('BAT'), at);                       // the CRC in the headers is still that of CAT
    await assert.rejects(() => parseFile('cat.docx', zip), (e) => {
      assert.equal(e.userFacing, true, 'a plain message, not a raw error');
      assert.match(e.message, /damaged or incomplete/i);
      assert.match(e.message, /word\/document\.xml/, 'the part is named');
      return true;
    });
  });
  test('a deflated part that inflates cleanly but to the wrong CRC is a damaged file', async () => {
    const zip = docxZip(docBody(para('Hello')), [], 'deflate');
    const u8 = new Uint8Array(zip);
    const dv = new DataView(zip);
    // flip the CRC in the central directory (the one the reader trusts) AND the local header
    for (let i = 0; i + 4 < u8.length; i++) {
      if (dv.getUint32(i, true) === 0x02014b50 || dv.getUint32(i, true) === 0x04034b50) {
        const nameAt = dv.getUint32(i, true) === 0x04034b50 ? i + 30 : i + 46;
        const nameLen = dv.getUint16(i + (dv.getUint32(i, true) === 0x04034b50 ? 26 : 28), true);
        if (new TextDecoder().decode(u8.subarray(nameAt, nameAt + nameLen)) === 'word/document.xml') dv.setUint32(i + (dv.getUint32(i, true) === 0x04034b50 ? 14 : 16), 0x12345678, true);
      }
    }
    await assert.rejects(() => parseFile('crc.docx', zip), (e) => { assert.equal(e.userFacing, true); assert.match(e.message, /damaged or incomplete/i); assert.match(e.message, /word\/document\.xml/); return true; });
  });
  test('a deflated part whose declared size is not what it inflates to is a damaged file', async () => {
    const zip = zipOf([{ name: 'word/document.xml', data: docBody(para('Hello')), method: 'deflate', size: 7 }]);
    await assert.rejects(() => parseFile('size.docx', zip), (e) => { assert.match(e.message, /damaged or incomplete/i); return true; });
  });
  test('a stored part whose declared size is not its length is a damaged file', async () => {
    const zip = docxZip(docBody(para('Hello')));
    const bad = zipOf([{ name: 'word/document.xml', data: docBody(para('Hello')), size: 5 }]);
    await assert.rejects(() => parseFile('size2.docx', bad), (e) => { assert.match(e.message, /damaged or incomplete/i); return true; });
    assert.ok((await parseFile('ok.docx', zip)).blocks.length, 'the same file with its true size reads');
  });
  test('stored and deflated parts that are what they say read as before', async () => {
    for (const method of ['store', 'deflate']) {
      const m = await parseFile('ok.docx', docxZip(docBody(para('Fine text')), [], method));
      assert.match(textOf(m.blocks), /Fine text/, method);
      assert.equal(m.warnings, undefined, `${method}: no warning`);
    }
  });
  test('a part in a compression Emboss does not support is a clear error, not "damaged"', async () => {
    const zip = zipOf([{ name: 'word/document.xml', data: docBody(para('x')), rawMethod: 99 }]);
    await assert.rejects(() => parseFile('lzma.docx', zip), (e) => { assert.equal(e.userFacing, true); assert.match(e.message, /compress/i); assert.match(e.message, /word\/document\.xml/); assert.doesNotMatch(e.message, /damaged or incomplete/i); return true; });
  });
  test('an encrypted part is a clear error naming it', async () => {
    const zip = zipOf([{ name: 'word/document.xml', data: docBody(para('x')), flags: 1 }]);
    await assert.rejects(() => parseFile('enc.docx', zip), (e) => { assert.equal(e.userFacing, true); assert.match(e.message, /encrypted|password/i); assert.match(e.message, /word\/document\.xml/); return true; });
  });
  test('an optional part (styles.xml) with a bad CRC is left out, and a warning names it', async () => {
    const zip = docxZip(docBody(para('Body text')), [{ name: 'word/styles.xml', data: `<w:styles xmlns:w="${WNS}"/>`, crc: 1 }]);
    const m = await parseFile('opt.docx', zip);
    assert.match(textOf(m.blocks), /Body text/);
    assert.ok((m.warnings || []).some((w) => /word\/styles\.xml/.test(w) && /damaged/i.test(w)), JSON.stringify(m.warnings));
  });
});

// ================================================================================================ #8 damaged Word XML
describe('#8 a Word file whose main XML is damaged is an error, never an empty success', () => {
  const MISMATCH = docBody(`<w:p><w:r><w:t>Important text</w:r></w:p>`);                      // </w:r> where </w:t> belongs
  const useBrowserParser = () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const saved = { DOMParser: globalThis.DOMParser, document: globalThis.document };
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.document = dom.window.document;          // parseXml falls back to HTML parsing "in a browser" (typeof document !== 'undefined')
    return () => { globalThis.DOMParser = saved.DOMParser; if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document; };
  };
  test('a browser-like DOMParser (HTML recovery available): mismatched tags are a damaged-file error', async () => {
    const restore = useBrowserParser();
    try {
      await assert.rejects(() => parseFile('bad.docx', docxZip(MISMATCH)), (e) => { assert.equal(e.userFacing, true); assert.match(e.message, /Word document is damaged or incomplete/i); return true; });
    } finally { restore(); }
  });
  test('Node\'s xmldom (it throws on its own): the same plain message, not "Opening and ending tag mismatch"', async () => {
    await assert.rejects(() => parseFile('bad.docx', docxZip(MISMATCH)), (e) => { assert.equal(e.userFacing, true); assert.match(e.message, /Word document is damaged or incomplete/i); return true; });
  });
  test('well-formed XML that is not a Word body (no w:body) is a damaged-file error in both parsers', async () => {
    const nobody = `<?xml version="1.0"?><w:document xmlns:w="${WNS}"><w:p><w:r><w:t>Important text</w:t></w:r></w:p></w:document>`;
    const html = '<html><body><p>Important text</p></body></html>';
    for (const [label, restore] of [['xmldom', () => {}], ['browser-like', useBrowserParser()]]) {
      try {
        for (const xml of [nobody, html]) await assert.rejects(() => parseFile('nobody.docx', docxZip(xml)), (e) => { assert.match(e.message, /damaged or incomplete/i, label); return true; });
      } finally { restore(); }
    }
  });
  test('a document that really is empty (a w:body with nothing in it) is still an empty document, not an error', async () => {
    const restore = useBrowserParser();
    try {
      const m = await parseFile('empty.docx', docxZip(docBody('')));
      assert.deepEqual(m.blocks, []);
    } finally { restore(); }
  });
  test('a good document reads the same in both parsers', async () => {
    const good = docxZip(docBody(para('Important text')));
    const a = await parseFile('good.docx', good);
    const restore = useBrowserParser();
    try { const b = await parseFile('good.docx', good); assert.equal(textOf(b.blocks), textOf(a.blocks)); assert.match(textOf(b.blocks), /Important text/); }
    finally { restore(); }
  });
});

// ================================================================================================ #9 / #10 EPUB spine accounting and paths
describe('#9 every EPUB spine item is accounted for', () => {
  const two = (over = {}) => epubZip({
    manifest: [{ id: 'a', href: 'a.xhtml' }, { id: 'b', href: 'b.xhtml' }],
    spine: ['a', 'b'],
    files: { 'OEBPS/a.xhtml': xhtml('<p>Chapter A text</p>'), 'OEBPS/b.xhtml': xhtml('<p>Chapter B text</p>') },
    ...over,
  });
  const without = (name) => epubZip({ manifest: [{ id: 'a', href: 'a.xhtml' }, { id: 'b', href: 'b.xhtml' }], spine: ['a', 'b'], files: Object.fromEntries(Object.entries({ 'OEBPS/a.xhtml': xhtml('<p>Chapter A text</p>'), 'OEBPS/b.xhtml': xhtml('<p>Chapter B text</p>') }).filter(([k]) => k !== name)) });

  test('a complete book reads with no warning', async () => {
    const m = await parseEpub(two());
    assert.match(textOf(m.blocks), /Chapter A text/); assert.match(textOf(m.blocks), /Chapter B text/);
    assert.equal(m.warnings, undefined);
  });
  test('one chapter missing from the archive: the other is kept and a warning names the missing one', async () => {
    const m = await parseEpub(without('OEBPS/b.xhtml'));
    assert.match(textOf(m.blocks), /Chapter A text/);
    assert.ok(!/Chapter B text/.test(textOf(m.blocks)));
    assert.ok((m.warnings || []).some((w) => /b\.xhtml/.test(w) && /missing/i.test(w)), JSON.stringify(m.warnings));
  });
  test('every chapter missing: a clear error, never {blocks: []}', async () => {
    const zip = epubZip({ manifest: [{ id: 'a', href: 'a.xhtml' }, { id: 'b', href: 'b.xhtml' }], spine: ['a', 'b'], files: {} });
    await assert.rejects(() => parseEpub(zip), (e) => { assert.equal(e.userFacing, true); assert.match(e.message, /no (readable )?chapters|damaged or incomplete/i); return true; });
    await assert.rejects(() => parseFile('broken.epub', zip), (e) => { assert.equal(e.userFacing, true); return true; });
  });
  test('a spine id that is not in the manifest is named in a warning', async () => {
    const m = await parseEpub(two({ spine: ['a', 'ghost', 'b'] }));
    assert.match(textOf(m.blocks), /Chapter B text/);
    assert.ok((m.warnings || []).some((w) => /ghost/.test(w)), JSON.stringify(m.warnings));
  });
  test('a chapter whose data is damaged is named in a warning, the rest is kept', async () => {
    const m = await parseEpub(two({ damage: { 'OEBPS/b.xhtml': { crc: 5 } } }));
    assert.match(textOf(m.blocks), /Chapter A text/);
    assert.ok((m.warnings || []).some((w) => /b\.xhtml/.test(w) && /damaged/i.test(w)), JSON.stringify(m.warnings));
  });
  test('every chapter damaged is still the damaged-file error', async () => {
    await assert.rejects(() => parseEpub(two({ damage: { 'OEBPS/a.xhtml': { crc: 5 }, 'OEBPS/b.xhtml': { crc: 6 } } })), (e) => { assert.match(e.message, /damaged or incomplete/i); return true; });
  });
  test('the navigation document is not a missing chapter, and a book of only nav + one chapter has no warning', async () => {
    const zip = epubZip({ manifest: [{ id: 'nav', href: 'nav.xhtml', props: 'nav' }, { id: 'a', href: 'a.xhtml' }], spine: ['nav', 'a'], files: { 'OEBPS/a.xhtml': xhtml('<p>Chapter A text</p>') } });
    const m = await parseEpub(zip);
    assert.equal(m.warnings, undefined);
  });
  test('the warning for missing chapters says how many, in plain words', async () => {
    const m = await parseEpub(epubZip({ manifest: [{ id: 'a', href: 'a.xhtml' }, { id: 'b', href: 'b.xhtml' }, { id: 'c', href: 'c.xhtml' }], spine: ['a', 'b', 'c'], files: { 'OEBPS/a.xhtml': xhtml('<p>Chapter A text</p>') } }));
    assert.ok((m.warnings || []).some((w) => /b\.xhtml/.test(w) && /c\.xhtml/.test(w)), JSON.stringify(m.warnings));
  });
});

describe('#10 EPUB chapter hrefs with ./, ../, %-encoding and #fragments are resolved', () => {
  const one = (href, path, opf = 'OEBPS/book.opf') => epubZip({ opf, manifest: [{ id: 'a', href }], spine: ['a'], files: { [path]: xhtml('<p>Chapter text</p>') } });
  const cases = [
    ['./chapter.xhtml beside the OPF', './chapter.xhtml', 'OEBPS/chapter.xhtml', 'OEBPS/book.opf'],
    ['../chapter.xhtml at the archive root', '../chapter.xhtml', 'chapter.xhtml', 'OEBPS/book.opf'],
    ['a/../chapter.xhtml', 'text/../chapter.xhtml', 'OEBPS/chapter.xhtml', 'OEBPS/book.opf'],
    ['./text/./c.xhtml', './text/./c.xhtml', 'OEBPS/text/c.xhtml', 'OEBPS/book.opf'],
    ['a %-encoded name', 'my%20chapter.xhtml', 'OEBPS/my chapter.xhtml', 'OEBPS/book.opf'],
    ['a %-encoded name with ./', './my%20chapter.xhtml', 'OEBPS/my chapter.xhtml', 'OEBPS/book.opf'],
    ['a #fragment', 'chapter.xhtml#sec2', 'OEBPS/chapter.xhtml', 'OEBPS/book.opf'],
    ['../ with a #fragment', '../chapter.xhtml#top', 'chapter.xhtml', 'OEBPS/book.opf'],
    ['an OPF at the root with ./', './ch.xhtml', 'ch.xhtml', 'book.opf'],
  ];
  for (const [label, href, path, opf] of cases) {
    test(`${label}: the chapter is read and there is no warning`, async () => {
      const m = await parseEpub(one(href, path, opf));
      assert.match(textOf(m.blocks), /Chapter text/);
      assert.equal(m.warnings, undefined, JSON.stringify(m.warnings));
    });
  }
  test('a %-encoded name where the archive keeps the literal % still works', async () => {
    const m = await parseEpub(one('100%25.xhtml', 'OEBPS/100%.xhtml'));
    assert.match(textOf(m.blocks), /Chapter text/);
  });
});

// ================================================================================================ #6 / #7 saving pictures
describe('#6 two pictures never share a saved file name', () => {
  const PNG = (n) => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, n, n, n, n]);
  const dataUri = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
  const graphics = (blocks) => { const out = []; (function deep(v) { if (!v || typeof v !== 'object') return; if (v.type === 'graphic') out.push(v); for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]); })(blocks); return out; };
  const bytesAt = (model, g) => Array.from(model.resources.find((r) => r.path === g.src).bytes);

  test('an existing images/emboss-1.png and a new data-URI picture: two entries, two names, each keeps its own bytes through a reopen', async () => {
    const A = PNG(10), B = PNG(20);
    const model = { title: 'T', blocks: [{ type: 'graphic', src: 'images/emboss-1.png', alt: 'old' }, { type: 'graphic', src: dataUri(B), alt: 'new' }], resources: [{ path: 'images/emboss-1.png', mime: 'image/png', bytes: A }], metadata: { identifier: 'pkg1' } };
    const { files } = buildNimasPackage(model);
    const names = files.map((f) => f.name);
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `unique entry names: ${names}`);
    const zip = await buildNimasPackageZip(model);
    assert.equal(new Set(namesOf(ab(zip))).size, namesOf(ab(zip)).length, 'unique names in the zip itself');
    const back = await parseNimasZip(ab(zip));
    const [g1, g2] = graphics(back.blocks);
    assert.notEqual(g1.src, g2.src, 'the two pictures point at two files');
    assert.deepEqual(bytesAt(back, g1), Array.from(A), 'the old picture keeps its bytes');
    assert.deepEqual(bytesAt(back, g2), Array.from(B), 'the new picture keeps its bytes');
    assert.equal(back.warnings, undefined);
  });
  test('save, reopen, add another picture, save, reopen: every picture keeps its own bytes and names stay unique', async () => {
    const pics = [PNG(1), PNG(2), PNG(3)];
    let model = { title: 'T', blocks: [{ type: 'graphic', src: dataUri(pics[0]), alt: 'one' }], metadata: { identifier: 'pkg2' } };
    let back = await parseNimasZip(ab(await buildNimasPackageZip(model)));
    back.blocks.push({ type: 'graphic', src: dataUri(pics[1]), alt: 'two' });
    back = await parseNimasZip(ab(await buildNimasPackageZip(back)));
    back.blocks.push({ type: 'graphic', src: dataUri(pics[2]), alt: 'three' });
    const zip = ab(await buildNimasPackageZip(back));
    const names = namesOf(zip);
    assert.equal(new Set(names).size, names.length, `unique: ${names}`);
    const last = await parseNimasZip(zip);
    const gs = graphics(last.blocks);
    assert.equal(gs.length, 3);
    assert.equal(new Set(gs.map((g) => g.src)).size, 3, 'three different files');
    gs.forEach((g, i) => assert.deepEqual(bytesAt(last, g), Array.from(pics[i]), `picture ${i + 1}`));
  });
  test('two existing resources that differ only in letter case (images/A.png, images/a.png) are two files', () => {
    const model = { title: 'T', blocks: [{ type: 'graphic', src: 'images/A.png', alt: '' }, { type: 'graphic', src: 'images/a.png', alt: '' }], resources: [{ path: 'images/A.png', mime: 'image/png', bytes: PNG(1) }, { path: 'images/a.png', mime: 'image/png', bytes: PNG(2) }], metadata: { identifier: 'pkg3' } };
    const { files } = buildNimasPackage(model);
    const names = files.map((f) => f.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, names.join(', '));
  });
  test('a resource called like the book itself is not allowed to replace it', () => {
    const model = { title: 'T', blocks: [{ type: 'graphic', src: 'pkg4.xml', alt: '' }], resources: [{ path: 'pkg4.xml', mime: 'image/png', bytes: PNG(1) }], metadata: { identifier: 'pkg4' } };
    const { files } = buildNimasPackage(model);
    const names = files.map((f) => f.name);
    assert.equal(new Set(names).size, names.length, names.join(', '));
    assert.ok(names.includes('pkg4/pkg4.xml') && names.includes('pkg4/pkg4.opf'));
  });
  test('a resource name is never changed when it is already fine (the saved src is the imported src)', () => {
    const model = { title: 'T', blocks: [{ type: 'graphic', src: 'images/fig1.png', alt: '' }], resources: [{ path: 'images/fig1.png', mime: 'image/png', bytes: PNG(1) }], metadata: { identifier: 'pkg5' } };
    const { files } = buildNimasPackage(model);
    assert.ok(files.some((f) => f.name === 'pkg5/images/fig1.png'));
  });
  test('the package builder refuses duplicate entry names and unsafe paths (exported checks)', async () => {
    const { checkPackagePaths } = await import('../input/nimas-package.mjs');
    assert.throws(() => checkPackagePaths([{ name: 'p/a.png' }, { name: 'p/a.png' }]), /duplicate/i);
    assert.throws(() => checkPackagePaths([{ name: 'p/A.png' }, { name: 'p/a.png' }]), /duplicate/i);
    assert.throws(() => checkPackagePaths([{ name: 'p/../../x.png' }]), /outside|parent|unsafe/i);
    assert.throws(() => checkPackagePaths([{ name: '/abs/x.png' }]), /absolute|unsafe/i);
    assert.throws(() => checkPackagePaths([{ name: 'p/a\\b.png' }]), /unsafe/i);
    assert.doesNotThrow(() => checkPackagePaths([{ name: 'p/a.png' }, { name: 'p/b/c.png' }]));
  });
});

describe('#7 a parent-relative picture or PDF is saved inside the package and survives a reopen', () => {
  const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 7, 7, 7]);
  const PDF = enc.encode('%PDF-1.4 source');
  const DT = (img) => `<?xml version="1.0" encoding="UTF-8"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3" xml:lang="en"><head><meta name="dc:Title" content="Nested"/><meta name="dtb:uid" content="nested1"/></head><book><frontmatter><doctitle>Nested</doctitle></frontmatter><bodymatter><level1><h1>One</h1><p>Words.</p><imggroup><img src="${img}" alt="A picture"/></imggroup></level1></bodymatter></book></dtbook>`;
  const graphics = (blocks) => { const out = []; (function deep(v) { if (!v || typeof v !== 'object') return; if (v.type === 'graphic') out.push(v); for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]); })(blocks); return out; };

  test('a/b/book.xml with ../../image.png: the import keeps the picture, the saved zip has no ".." and reopens with the picture', async () => {
    const src = zipOf([{ name: 'a/b/book.xml', data: DT('../../image.png') }, { name: 'image.png', data: PNG }]);
    const model = await parseNimasZip(src);
    assert.equal(model.warnings, undefined, 'the import found the picture');
    assert.equal(model.resources.length, 1);
    const zip = ab(await buildNimasPackageZip(model));
    const names = namesOf(zip);
    for (const n of names) {
      assert.ok(!n.split('/').includes('..') && !n.startsWith('/') && !n.includes('\\'), `inside the package root: ${n}`);
    }
    const back = await parseNimasZip(zip);
    assert.equal(back.warnings, undefined, JSON.stringify(back.warnings));
    const [g] = graphics(back.blocks);
    const res = back.resources.find((r) => r.path === g.src);
    assert.ok(res, `the reopened book has the picture (${g.src})`);
    assert.deepEqual(Array.from(res.bytes), Array.from(PNG));
  });
  test('the same when the picture sits above and another beside the source file, and the saved manifest lists only safe hrefs', async () => {
    const PNG2 = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9]);
    const xml = DT('../up.png').replace('<p>Words.</p>', '<p>Words.</p><imggroup><img src="beside.png" alt="Beside"/></imggroup>');
    const model = await parseNimasZip(zipOf([{ name: 'x/book.xml', data: xml }, { name: 'up.png', data: PNG }, { name: 'x/beside.png', data: PNG2 }]));
    const { files } = buildNimasPackage(model);
    const opf = new TextDecoder().decode(files.find((f) => f.name.endsWith('.opf')).data);
    for (const h of [...opf.matchAll(/href="([^"]*)"/g)].map((m) => m[1])) assert.ok(!h.split('/').includes('..') && !h.startsWith('/'), `manifest href ${h}`);
    const back = await parseNimasZip(ab(await buildNimasPackageZip(model)));
    assert.equal(back.warnings, undefined, JSON.stringify(back.warnings));
    const gs = graphics(back.blocks);
    assert.equal(gs.length, 2);
    const got = gs.map((g) => Array.from(back.resources.find((r) => r.path === g.src).bytes));
    assert.deepEqual(got, [Array.from(PNG2), Array.from(PNG)], 'the picture beside the source file comes first in the book, the one above it second');
  });
  test('a source PDF reached through ../ is saved inside the package too', async () => {
    const src = zipOf([{ name: 'a/b/book.xml', data: DT('pic.png') }, { name: 'a/b/pic.png', data: PNG }, { name: 'a/b/pkg.opf', data: '<?xml version="1.0"?><package xmlns="http://openebook.org/namespaces/oeb-package/1.0/"><metadata><dc-metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:Title>N</dc:Title></dc-metadata></metadata><manifest><item id="x" href="book.xml" media-type="application/x-dtbook+xml"/><item id="p" href="../../source.pdf" media-type="application/pdf"/></manifest><spine><itemref idref="x"/></spine></package>' }, { name: 'source.pdf', data: PDF }]);
    const model = await parseNimasZip(src);
    assert.ok(model.resources.some((r) => r.role === 'source-pdf'), 'the import found the PDF');
    const zip = ab(await buildNimasPackageZip(model));
    for (const n of namesOf(zip)) assert.ok(!n.split('/').includes('..') && !n.startsWith('/'), n);
    const back = await parseNimasZip(zip);
    const pdf = back.resources.find((r) => r.role === 'source-pdf');
    assert.ok(pdf, 'the PDF survives a reopen');
    assert.deepEqual(Array.from(pdf.bytes), Array.from(PDF));
  });
  test('an absolute or parent-escaping resource path in the model never reaches the zip', () => {
    const model = { title: 'T', blocks: [{ type: 'graphic', src: '/etc/pic.png', alt: '' }, { type: 'graphic', src: '../../../out.png', alt: '' }], resources: [{ path: '/etc/pic.png', mime: 'image/png', bytes: PNG }, { path: '../../../out.png', mime: 'image/png', bytes: Uint8Array.from([1, 2, 3]) }], metadata: { identifier: 'esc1' } };
    const { files } = buildNimasPackage(model);
    for (const f of files) assert.ok(!f.name.split('/').includes('..') && !f.name.slice('esc1/'.length - 1).startsWith('//') && !/^\//.test(f.name), f.name);
    assert.equal(new Set(files.map((f) => f.name)).size, files.length);
  });
});
