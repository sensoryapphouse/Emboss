// Extreme and hostile documents (A89 step 4; Paul, 2 Oct 2026): Emboss must never crash, hang or run out of memory, even on the most
// extreme or hostile document; a damaged or hostile file gives a clear message, never a raw error, a hang or an out-of-memory.
// These tests are the fixes for the failures scripts/check-extreme-documents.mjs found. Each file runs in a CHILD process
// (tests/extreme-child.mjs: parseFile -> BRF in BANA and UKAAF -> NIMAS save and read back) with a hard time and memory limit, so a
// file that hangs or runs out of memory is one failed test, not a stopped run. The minimal inputs are in
// tests/fixtures/extreme-repro/ (made by that tool); the rest are generated here.
//
// The rules a test enforces (see each group):
//   - no raw error (TypeError / RangeError / stack overflow / "Offset is outside the bounds of the DataView"): a file Emboss cannot
//     read ends with an error that is e.userFacing (the editor and Quick Mode show its message as it is), in plain English;
//   - a document Emboss CAN read (a table with an absurd span, a very deeply nested one) is read, with the excess clamped or
//     flattened, inside a time limit, and its BRF is pure BRF ASCII.
//
// Limits (all in input/parse.mjs, input/omml.mjs, engine/maths.mjs), chosen far beyond anything a real document has:
//   table span (colspan, gridSpan, number-columns-spanned, <col span>) 1,000 columns (browsers allow 1,000); rowspan 65,534 (browsers')
//   one deflated part of a zip, inflated 512 MB; all the parts of one archive 1 GB; entity expansion 32 MB; <text:s> 1,000 spaces
//   nesting: RTF groups 200 (deeper: read flat, text kept, load notice); ODT lists 200 (deeper: plain items, load notice); ODT text 300
//   elements; OMML equations 50 (deeper: its text as plain tokens); MathML for MathCAT: 8 scripts in a chain of bases, 200 elements in all
//   (MathCAT takes 4 times as long for every further script in a chain of bases); Word table description 20 tables down.
//   No limit is needed for Word content controls and nested tables (read in a loop / with a bounded description), nor for HTML nested
//   tables (copied without the tables below them). A last net in parseFile turns any remaining stack overflow into a clear message.
// The tests were run against the code before these fixes (2 Oct 2026): all but the few "nothing changes" checks failed, each by the
// failure the tool had found (raw RangeError, hang, out of memory, too slow, non-ASCII BRF).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { makeZip } from '../web/zip.mjs';
import { rawZip } from '../scripts/extreme/hostile.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, 'extreme-child.mjs');
const FIX = path.join(HERE, 'fixtures', 'extreme-repro');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-extreme-test-'));
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

// ---- running a file in a child, at most 4 children at once ----
let running = 0;
const waiting = [];
const slot = () => new Promise((resolve) => { const go = () => { running++; resolve(); }; if (running < 4) go(); else waiting.push(go); });
const release = () => { running--; const next = waiting.shift(); if (next) next(); };
async function run(file, { format = false, nimas = false, heapMB = 1536, timeoutMs = 90000 } = {}) {
  await slot();
  try {
    return await new Promise((resolve) => {
      const args = [`--max-old-space-size=${heapMB}`, CHILD, file];
      if (format) args.push('--format');
      if (nimas) args.push('--nimas');
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '', done = false;
      const t0 = Date.now();
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ ...r, wallMs: Date.now() - t0 }); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, error: { name: 'Timeout', message: `still running after ${timeoutMs / 1000} s (hang)`, userFacing: false }, timedOut: true }); }, timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code, sig) => {
        const m = /@@RESULT@@(.*)\n/.exec(out);
        if (m) finish(JSON.parse(m[1]));
        else finish({ ok: false, error: { name: 'Crash', message: `child ended with ${sig || 'code ' + code} and no result: ${(err.split('\n').find((l) => /out of memory|heap|RangeError|Error/i.test(l)) || err).slice(0, 200)}`, userFacing: false } });
      });
    });
  } finally { release(); }
}
const write = (name, data) => { const f = path.join(TMP, name); fs.writeFileSync(f, data); return f; };
const fixture = (name) => path.join(FIX, name);

// what a raw (non-user-facing) error looks like, whatever its wording
const RAW_RE = /RangeError|TypeError|ReferenceError|SyntaxError|Maximum call stack|Invalid (array|string|typed array) length|out of memory|outside the bounds|EOCD|Z_DATA_ERROR|undefined|\[object|Offset is/i;
function assertClearError(r, messageRe, what) {
  assert.ok(r.error, `${what}: expected a clear error, but the file was read (${r.blocks} blocks)`);
  assert.equal(r.error.userFacing, true, `${what}: the error is not user-facing (it would reach the user raw): ${r.error.name}: ${r.error.message}`);
  assert.doesNotMatch(r.error.message, RAW_RE, `${what}: the message is technical: ${r.error.message}`);
  assert.match(r.error.message, messageRe, `${what}: ${r.error.message}`);
}
function assertRead(r, what, { maxMs = 60000 } = {}) {
  assert.equal(r.error, null, `${what}: ${r.error && r.error.name + ': ' + r.error.message}${r.timedOut ? '' : ' (at ' + r.stage + ')'}`);
  assert.equal(r.ok, true, what);
  assert.ok(r.ms < maxMs, `${what}: took ${r.ms} ms (limit ${maxMs})`);
  if (r.brf) for (const m of Object.keys(r.brf)) assert.equal(r.brf[m].nonAscii, null, `${what}: the ${m} BRF holds a character that is not BRF ASCII (${r.brf[m].nonAscii})`);
}

// ======================================================================================
// 1. Absurd table spans (HTML colspan, NIMAS colspan, DOCX gridSpan, ODT number-columns-spanned): clamped to 1,000
// ======================================================================================
const SPAN_MAX = 1000;
for (const kind of ['html-colspan', 'nimas-colspan', 'docx-gridspan', 'odt-colspan']) {
  for (const n of ['100000', '1000000', '100000000', '4294967296']) {
    const name = fs.readdirSync(FIX).find((f) => f.startsWith(`${kind}-${n}.`));
    test(`${kind} ${n}: read, the span clamped to ${SPAN_MAX} columns, BRF made in time`, async () => {
      assert.ok(name, `fixture ${kind}-${n} is missing`);
      const r = await run(fixture(name), { format: true, nimas: true });
      assertRead(r, name);
      // the fixtures are one cell with the absurd span plus one ordinary cell: 1,000 + 1
      assert.ok(r.rowWidth >= 2 && r.rowWidth <= SPAN_MAX + 1, `${name}: widest row has ${r.rowWidth} cells (want 2..${SPAN_MAX + 1})`);
    });
  }
}

test('a modest colspan still works as before (colspan="3" gives three cells)', async () => {
  const { parseHtml } = await import('../input/parse.mjs');
  const d = parseHtml('<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td colspan="3">wide</td></tr></table>');
  const t = d.blocks.find((b) => b.type === 'table');
  assert.ok(t, 'a table block');
  assert.equal(t.rows[0].length, 3);
});

test('an absurd rowspan (4294967296) is read, the cell covering the rows below it; an absurd <col span> is clamped', async () => {
  const { parseHtml } = await import('../input/parse.mjs');
  const t0 = Date.now();
  const d = parseHtml('<table><colgroup><col span="4294967296"></colgroup><tr><th>A</th><th>B</th></tr><tr><td rowspan="4294967296">x</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>');
  const t = d.blocks.find((b) => b.type === 'table');
  assert.ok(t, 'a table block');
  assert.equal(t.rows.length, 3);
  assert.ok(t.rows.every((r) => r.length === 2), JSON.stringify(t.rows));
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
});

test('a negative or zero span is read as 1, not as a hole in the row', async () => {
  const { parseHtml } = await import('../input/parse.mjs');
  const d = parseHtml('<table><tr><th>A</th><th>B</th></tr><tr><td colspan="-5">x</td><td colspan="0">y</td></tr></table>');
  const t = d.blocks.find((b) => b.type === 'table');
  assert.ok(t);
  assert.equal(t.rows[0].length, 2);
});

// ======================================================================================
// 2. Damaged zip directory; 3. corrupt deflate stream: the "damaged or incomplete" message, never a raw error
// ======================================================================================
for (const name of ['zip-central-directory-offset-past-end.docx', 'zip-central-directory-offset-past-end.odt', 'zip-central-directory-offset-past-end.epub', 'docx-entry-extra-length-65535.docx', 'docx-entry-name-length-65535.docx', 'docx-corrupt-deflate-stream.docx']) {
  test(`${name}: a clear "damaged or incomplete" message`, async () => {
    const r = await run(fixture(name));
    assertClearError(r, /damaged or incomplete/i, name);
  });
}

test('a corrupt deflate stream in an ODT and in an EPUB gives the same clear message', async () => {
  const odtBase = rawZip([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'content.xml', data: Buffer.alloc(0), precompressed: Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 131 + 7) & 255)), method: 8, claimUncompressed: 5000, crc: 0 },
  ]);
  const epub = rawZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: Buffer.alloc(0), precompressed: Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 131 + 7) & 255)), method: 8, claimUncompressed: 5000, crc: 0 },
  ]);
  assertClearError(await run(write('badflate.odt', odtBase)), /damaged or incomplete/i, 'odt');
  assertClearError(await run(write('badflate.epub', epub)), /damaged or incomplete/i, 'epub');
});

test('a truncated deflate stream (cut short) is damaged, not a raw zlib error', async () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + '<w:p><w:r><w:t>hello hello hello</w:t></w:r></w:p>'.repeat(400) + '</w:body></w:document>';
  const comp = zlib.deflateRawSync(Buffer.from(xml)).subarray(0, 60);
  const z = rawZip([{ name: 'word/document.xml', data: Buffer.alloc(0), precompressed: comp, method: 8, claimUncompressed: xml.length, crc: 0 }]);
  assertClearError(await run(write('cut.docx', z)), /damaged or incomplete/i, 'cut-short deflate');
});

// ======================================================================================
// 4. Zip bomb: a part that inflates far beyond its file is refused with a clear message, not inflated whole
// ======================================================================================
const BOMB_BYTES = 600 * 1024 * 1024;   // above the 512 MB limit for one part
let bombCompressed = null;
const makeBomb = (head, tail) => new Promise((resolve) => {
  const d = zlib.createDeflateRaw({ level: 9 });
  const chunks = [];
  d.on('data', (c) => chunks.push(c));
  const chunk = Buffer.alloc(1 << 20, 0x20);
  d.write(head);
  for (let i = 0; i < BOMB_BYTES / chunk.length; i++) d.write(chunk);
  d.end(tail);
  d.on('end', () => resolve(Buffer.concat(chunks)));
});
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
for (const kind of ['docx', 'odt', 'epub']) {
  test(`zip bomb in a ${kind} (one part inflates to over 600 MB): refused with a clear message`, async () => {
    const head = { docx: `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>start</w:t></w:r></w:p>`, odt: '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>start</text:p>', epub: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>start</p>' }[kind];
    const tail = { docx: '</w:body></w:document>', odt: '</office:text></office:body></office:document-content>', epub: '</body></html>' }[kind];
    const comp = await makeBomb(head, tail);                       // (same bytes each time; about 600 KB)
    const bomb = { name: { docx: 'word/document.xml', odt: 'content.xml', epub: 'OEBPS/chap-1.xhtml' }[kind], data: Buffer.alloc(0), precompressed: comp, method: 8, claimUncompressed: 1 << 30, crc: 0 };
    const files = kind === 'epub' ? [
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OEBPS/content.opf', data: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="c1" href="chap-1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
      bomb,
    ] : [bomb];
    const r = await run(write(`bomb.${kind}`, rawZip(files)), { timeoutMs: 60000 });
    assertClearError(r, /expands to far more data/i, `${kind} bomb`);
    assert.ok(r.wallMs < 50000, `took ${r.wallMs} ms to refuse it`);
  });
}

// ======================================================================================
// 5. Entity blow-up: one large entity used thousands of times
// ======================================================================================
test('an entity used thousands of times (125 KB file that would expand to over 100 MB) is refused with a clear message', async () => {
  const r = await run(fixture('nimas-entity-quadratic-blowup.xml'), { timeoutMs: 60000 });
  assertClearError(r, /entit/i, 'entity blow-up');
});

test('ordinary DTD entities still expand once and are not expanded again (no nested re-expansion)', async () => {
  const { parseNimasXml } = await import('../input/parse.mjs');
  const xml = `<?xml version="1.0"?><!DOCTYPE dtbook [<!ENTITY myent "Zed"><!ENTITY outer "[&myent;]">]>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>H</h1><p>A &myent; B &outer; &nbsp;C</p></level1></bodymatter></book></dtbook>`;
  const d = parseNimasXml(xml);
  const p = d.blocks.find((b) => b.type === 'para');
  assert.ok(p, 'a paragraph');
  assert.match(p.text, /^A Zed B /);
  assert.doesNotMatch(p.text, /\[Zed\]/, 'the entity inside an entity is not expanded a second time');
});

// ======================================================================================
// 6. Markdown: linear time
// ======================================================================================
for (const name of ['md-unclosed-images-100000.md', 'md-front-matter-unterminated-100000-lines.md']) {
  test(`${name}: read in a few seconds`, async () => {
    const r = await run(fixture(name), { timeoutMs: 60000 });
    assertRead(r, name, { maxMs: 8000 });
  });
}
test('markdown: a hard break (two or more trailing spaces) and a soft break are still told apart', async () => {
  const { parseMarkdown } = await import('../input/parse.mjs');
  const jb = (md) => JSON.stringify(parseMarkdown(md).blocks);
  assert.notEqual(jb('a  \nb'), jb('a \nb'), 'two trailing spaces is a hard break, one is not');
  assert.equal(jb('a   \nb'), jb('a  \nb'), 'any number of two or more is a hard break');
  assert.equal(jb('a \nb'), jb('a\nb'), 'a single trailing space is dropped at a soft break');
  assert.notEqual(jb('a\\\nb'), jb('a\nb'), 'a backslash at the end of a line is a hard break');
});
test('markdown: a text of 200,000 unclosed image openings and 200,000 lines of two-space breaks is read in linear time', async () => {
  const { parseMarkdown } = await import('../input/parse.mjs');
  const t0 = Date.now();
  parseMarkdown('![a]('.repeat(200000));
  parseMarkdown('](()'.repeat(100000));
  parseMarkdown('[a](x "'.repeat(50000));
  parseMarkdown(('word  \n').repeat(100000));
  parseMarkdown(('word' + ' '.repeat(40) + '\n').repeat(20000));
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
});

// ======================================================================================
// 7. RTF: nested groups, unbalanced braces
// ======================================================================================
const rtf = (s) => Buffer.from(s, 'latin1');
test('RTF: 4,000 balanced nested groups and 3,000 unclosed braces are read (the text kept), not a stack overflow', async () => {
  for (const name of ['rtf-nested-groups-4000-balanced.rtf', 'rtf-open-braces-3000.rtf']) assertRead(await run(fixture(name), { format: true, nimas: true }), name);
});
test('RTF: the text of a very deeply nested group is kept (flattened below the depth limit)', async () => {
  const f = write('deep.rtf', rtf('{\\rtf1\\ansi ' + '{\\b '.repeat(4000) + 'DEEPTEXT' + '}'.repeat(4000) + ' after}'));
  const r = await run(f, { format: true });
  assertRead(r, 'rtf 4000 deep');
  assert.ok(r.blocks >= 1);
});
test('RTF: nothing changes below the depth limit; deeper than 200 levels the text is kept and the load notice says so', async () => {
  const { parseRtf } = await import('../input/parse.mjs');
  const shallow = parseRtf('{\\rtf1\\ansi ' + '{\\b '.repeat(50) + 'SHALLOW' + '}'.repeat(50) + '}');
  assert.match(JSON.stringify(shallow.blocks), /SHALLOW/);
  assert.equal((shallow.warnings || []).length, 0, 'no notice for a normal document');
  const deep = parseRtf('{\\rtf1\\ansi ' + '{\\b '.repeat(4000) + 'DEEPTEXT' + '}'.repeat(4000) + ' tail}');
  assert.match(JSON.stringify(deep.blocks), /DEEPTEXT/);
  assert.match(JSON.stringify(deep.blocks), /tail/);
  assert.match((deep.warnings || []).join(' '), /nested far deeper than any real document/);
});
test('RTF: 4,000 nested groups of every destination kind (footnote, field, picture, list table, shape, info) do not overflow the stack', async () => {
  const kinds = ['\\footnote ', '\\field{\\*\\fldinst x}{\\fldrslt ', '\\pict\\pngblip ', '\\listtable\\list ', '\\shp{\\*\\shpinst ', '\\info{\\title ', '\\*\\foo ', '\\object ', '\\mmath ', '\\header ', '\\stylesheet '];
  const fs2 = [];
  for (const k of kinds) fs2.push(write(`k${fs2.length}.rtf`, rtf('{\\rtf1\\ansi before ' + `{${k}`.repeat(4000) + 'DEEP' + '}'.repeat(4000) + ' after}')));
  fs2.push(write('mf.rtf', rtf('{\\rtf1\\ansi before {\\mmath{\\moMath' + '{\\mf{\\mnum '.repeat(2000) + '{\\mr x}' + '}}'.repeat(2000) + '}} after}')));
  fs2.push(write('shpnest.rtf', rtf('{\\rtf1\\ansi before ' + '{\\shp{\\*\\shpinst{\\sp{\\sn x}{\\sv y}}'.repeat(2000) + '}}'.repeat(4000) + ' after}')));
  fs2.push(write('fn.rtf', rtf('{\\rtf1\\ansi before ' + '{\\footnote note '.repeat(2000) + 'DEEP' + '}'.repeat(2000) + ' after}')));
  for (const f of fs2) {
    const r = await run(f, { timeoutMs: 40000 });
    if (r.error) assert.equal(r.error.userFacing, true, `${path.basename(f)}: ${r.error.name}: ${r.error.message}`);
    assert.ok(!r.timedOut, `${path.basename(f)} hung`);
  }
});

// ======================================================================================
// 8. Deep Word / ODT structures
// ======================================================================================
const docxOf = (body, extraNs = '') => makeZip([{ name: 'word/document.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"${extraNs}><w:body>${body}</w:body></w:document>` }]).arrayBuffer().then((b) => Buffer.from(b));
const P = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
test('Word: 3,000 nested content controls are read', async () => {
  const r = await run(fixture('docx-nested-content-controls-3000.docx'), { format: true, nimas: true });
  assertRead(r, 'sdt 3000');
  assert.ok(r.blocks >= 1, 'the paragraph at the bottom of the 3,000 controls is kept');
});
test('Word: 1,000 nested tables are read in a few seconds', async () => {
  assertRead(await run(fixture('docx-nested-tables-1000.docx'), { format: true, nimas: true }), 'tables 1000', { maxMs: 8000 });   // (15-18 s before the fix: every table's description read everything below it)
});
test('Word: 3,000 nested tables, and 3,000 nested equations, are read', async () => {
  let s = P('core');
  for (let i = 0; i < 3000; i++) s = `<w:tbl><w:tr><w:tc>${s}</w:tc></w:tr></w:tbl>`;
  assertRead(await run(write('t3000.docx', await docxOf(s)), { format: true }), 'tables 3000', { maxMs: 30000 });
  const eq = `<w:p><m:oMath>${'<m:sSup><m:e>'.repeat(3000)}<m:r><m:t>x</m:t></m:r>${'</m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>'.repeat(3000)}</m:oMath></w:p>${P('after')}`;
  assertRead(await run(write('eq3000.docx', await docxOf(eq)), { format: true }), 'equations 3000', { maxMs: 30000 });
});
test('Word: 3,000 deeply nested m:f (fractions) and radicals are read', async () => {
  const frac = `<w:p><m:oMath>${'<m:f><m:num>'.repeat(3000)}<m:r><m:t>1</m:t></m:r>${'</m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>'.repeat(3000)}</m:oMath></w:p>`;
  assertRead(await run(write('frac3000.docx', await docxOf(frac)), { format: true }), 'fractions 3000', { maxMs: 30000 });
});
test('ODT: 3,000 nested lists are read (the items kept); an absurd text:s count is clamped', async () => {
  assertRead(await run(fixture('odt-lists-nested-3000.odt'), { format: true }), 'odt lists 3000', { maxMs: 20000 });
  assertRead(await run(fixture('odt-spaces-repeated-2000000000.odt'), { format: true }), 'odt spaces');
});
test('NIMAS and HTML nested 5,000 deep (more than a browser builds, a hostile file in Node): a clear message or read, never a raw stack overflow', async () => {
  const deepXml = (open, close, n, inner = 'deep') => `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${open.repeat(n)}${inner}${close.repeat(n)}</level1></bodymatter></book></dtbook>`;
  const files = [
    write('n5000-level.xml', deepXml('<level>', '</level>', 5000, '<h1>deep</h1><p>text</p>')),
    write('n5000-list.xml', deepXml('<list type="ul"><li>x', '</li></list>', 5000)),
    write('n5000-table.xml', deepXml('<table><tbody><tr><td>', '</td></tr></tbody></table>', 5000)),
    write('n5000-bq.html', '<html><body>' + '<blockquote>'.repeat(5000) + 'deep' + '</blockquote>'.repeat(5000) + '</body></html>'),
    write('n5000-font.html', '<body>' + '<font>'.repeat(5000) + 'text'),
  ];
  for (const f of files) {
    const r = await run(f, { timeoutMs: 40000 });
    assert.ok(!r.timedOut, `${path.basename(f)} hung`);
    if (r.error) assertClearError(r, /nested far more deeply/, path.basename(f));
  }
});
test('HTML: 400 nested tables are read in a few seconds', async () => {
  const html = '<html><body>' + '<table><tr><td>'.repeat(400) + 'deep' + '</td></tr></table>'.repeat(400) + '</body></html>';
  assertRead(await run(write('t400.html', html), { format: true }), 'html tables 400', { maxMs: 8000 });
});

// ======================================================================================
// 9. Characters that are not BRF ASCII never reach the BRF
// ======================================================================================
test('U+FFFF (and other non-characters) never reach the BRF', async () => {
  const r = await run(fixture('txt-noncharacter-uffff.txt'), { format: true });
  assertRead(r, 'U+FFFF');
});
test('unicodeBrailleToBrf: braille cells map as before, ASCII and line ends pass, anything else is a blank cell', () => {
  assert.equal(unicodeBrailleToBrf('\u2801\u2803 \u283f\n\r\f'), 'AB =\n\r\f');
  assert.equal(unicodeBrailleToBrf('a\uFFFFb'), 'a b');
  assert.equal(unicodeBrailleToBrf('a\uFFFEb\u{10FFFF}c\u0000d\u0007e\u00e9f'), 'a b c d e f');
  for (let cp = 0x2800; cp <= 0x28ff; cp++) assert.match(unicodeBrailleToBrf(String.fromCodePoint(cp)), /^[\x20-\x7e]$/);
});

// ======================================================================================
// 10. MathCAT: deeply left-nested superscripts (x^2^2^2 ...) must not take minutes
// ======================================================================================
for (const n of [20, 40]) {
  test(`MathCAT: ${n} left-nested superscripts are brailled in a few seconds`, async () => {
    const r = await run(fixture(`docx-left-nested-superscripts-${n}.docx`), { format: true, timeoutMs: 100000 });
    assertRead(r, `left-nested superscripts ${n}`, { maxMs: 30000 });
    assert.ok(r.wallMs < 40000, `took ${r.wallMs} ms`);
  });
}

test('limitMathMLNesting: every real equation comes back as the same string; an over-deep script chain or tree is flattened', async () => {
  const { limitMathMLNesting, MATHML_MAX_SCRIPT_BASE_CHAIN, MATHML_MAX_DEPTH } = await import('../input/omml.mjs');
  const real = [
    '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msub><mi>y</mi><mn>1</mn></msub><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
    '<math><msubsup><mo>&#x222B;</mo><mn>0</mn><mn>1</mn></msubsup><msup><mrow><mo>(</mo><msup><mi>a</mi><mn>2</mn></msup><mo>)</mo></mrow><mn>3</mn></msup></math>',
    '<math>' + '<msup><mi>x</mi>'.repeat(30) + '<mn>2</mn>' + '</msup>'.repeat(30) + '</math>',                    // a tower of exponents: linear in MathCAT, kept
    '<math>' + '<mfrac><mn>1</mn>'.repeat(40) + '<mn>2</mn>' + '</mfrac>'.repeat(40) + '</math>',                  // a continued fraction
    '<math>' + '<msup>'.repeat(MATHML_MAX_SCRIPT_BASE_CHAIN) + '<mi>x</mi>' + '<mn>2</mn></msup>'.repeat(MATHML_MAX_SCRIPT_BASE_CHAIN) + '</math>',   // exactly at the limit
  ];
  for (const r of real) assert.equal(limitMathMLNesting(r), r);
  const deep = '<math>' + '<msup>'.repeat(40) + '<mi>x</mi>' + '<mn>2</mn></msup>'.repeat(40) + '</math>';
  const cut = limitMathMLNesting(deep);
  assert.notEqual(cut, deep);
  assert.ok((cut.match(/<msup>/g) || []).length <= MATHML_MAX_SCRIPT_BASE_CHAIN, 'the chain is cut at the limit');
  assert.match(cut, /<mi>x<\/mi>/, 'the letter is kept as plain text');
  const through = '<math>' + '<msup><mrow>'.repeat(40) + '<mi>x</mi>' + '</mrow><mn>2</mn></msup>'.repeat(40) + '</math>';     // the base nested through <mrow>s
  assert.ok((limitMathMLNesting(through).match(/<msup>/g) || []).length <= MATHML_MAX_SCRIPT_BASE_CHAIN);
  const tall = '<math>' + '<mrow>'.repeat(MATHML_MAX_DEPTH + 50) + '<mi>x</mi>' + '</mrow>'.repeat(MATHML_MAX_DEPTH + 50) + '</math>';
  assert.ok((limitMathMLNesting(tall).match(/<mrow>/g) || []).length <= MATHML_MAX_DEPTH + 1);
  assert.equal(limitMathMLNesting('<math><msup><mi>x</mi>'), '<math><msup><mi>x</mi>', 'not well-formed: left to MathCAT as before');
});

test('ODT: lists nested 3,000 deep keep all their items (below 200 levels as plain items, with a notice); a 5-level list is read as before', async () => {
  const { parseFile } = await import('../input/parse.mjs');
  const buf = fs.readFileSync(fixture('odt-lists-nested-3000.odt'));
  const d = await parseFile('x.odt', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const list = d.blocks.find((b) => b.type === 'list');
  assert.ok(list, 'a list');
  assert.ok(list.items.length >= 3000, `${list.items.length} items`);
  assert.ok(list.items.some((i) => i.text === 'core'), 'the innermost item is kept');
  assert.match((d.warnings || []).join(' '), /nested far deeper than any real document/);
  const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const nest = (n) => { let s = '<text:list-item><text:p>core</text:p></text:list-item>'; for (let i = 0; i < n; i++) s = `<text:list-item><text:p>x${i}</text:p><text:list>${s}</text:list></text:list-item>`; return `<text:list>${s}</text:list>`; };
  const z = await makeZip([{ name: 'content.xml', text: `<?xml version="1.0"?><office:document-content xmlns:office="${OFFICE}" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${nest(5)}</office:text></office:body></office:document-content>` }]).arrayBuffer();
  const d5 = await parseFile('y.odt', z);
  const l5 = d5.blocks.find((b) => b.type === 'list');
  assert.equal(l5.items.length, 6);
  assert.deepEqual(l5.items.map((i) => i.level || 0), [0, 1, 2, 3, 4, 5]);
  assert.equal((d5.warnings || []).length, 0);
});

test('MathCAT through Emboss: 40 left-nested superscripts, in UEB and in Nemeth, come out in well under a second', async () => {
  const { makeMathToBrf } = await import('../format/node-maths-helper.mjs');
  const deep = '<math>' + '<msup>'.repeat(40) + '<mi>x</mi>' + '<mn>2</mn></msup>'.repeat(40) + '</math>';
  for (const mode of ['ukaaf', 'bana']) {
    const t0 = Date.now();
    const brf = makeMathToBrf(mode)(deep);
    assert.ok(Date.now() - t0 < 3000, `${mode}: ${Date.now() - t0} ms`);
    assert.match(brf, /^[\x20-\x7e\r\n\f]+$/);
  }
});
