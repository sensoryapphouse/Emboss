// Audit batch S3b (ChatGPT audit 15 Oct 2026, docs/chatgpt-audit-15oct.md): eBraille export items #17, #18, #19, #20.
//  #17 the declared braille system follows the braille code of the output (UEB grade 1, grade 2, any other code), and a maths code
//      (Nemeth / UEB maths) is declared as well when the document has maths in it. One shared mapping (web/braille-table.mjs registryName)
//      for Quick Mode and the editor.
//  #18 author, language, identifier and publisher come from the document's own metadata (Paul's decision B1, 15 Oct: the document's language,
//      then the language of the selected braille code, then the browser's, last); an EPUB import keeps its OPF metadata.
//  #19 blank lines in computer code and blank rows of a tactile raster graphic are kept (the formatter drops the code's blank lines from
//      its page lines, and records a raster's as a later row's `gap`; the exporter now puts both back).
//  #20 a table cell, header or label that cannot be brailled becomes a transcriber's-note marker (Paul's decision C1, 15 Oct), a warning
//      comes back with the package (bytes.warnings), and the package no longer says completeTranscription true.
// Every test builds a real .ebrl and unzips it.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { exportToEbraille } from '../format/ebraille.mjs';
import * as brailleTable from '../web/braille-table.mjs';
// namespace import: a missing export fails its own tests, not the whole file
const registryName = (s) => brailleTable.registryName(s);
const codeLanguage = (s) => brailleTable.codeLanguage(s);
import { parseEpub, parseDtbook } from '../input/parse.mjs';
import fs from 'node:fs';
import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';
import { makeZip } from '../web/zip.mjs';
import { unzip } from '../../Translate/unmxl.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const up = (s) => String(s).toUpperCase();
const opts = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: up, language: 'en-US', ...extra });
const dec = new TextDecoder();
async function open(bytes) {
  const files = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const text = (n) => { const d = files.get(n); return d ? dec.decode(d) : null; };
  const opf = text('package.opf');
  const manifest = {};
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]*)"/.exec(m[0])?.[1], href = /\bhref="([^"]*)"/.exec(m[0])?.[1];
    if (id) manifest[id] = href;
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]*)"/g)].map((m) => manifest[m[1]]);
  return { files, text, opf, index: text('index.html'), html: spine.map(text).join('\n') };
}
const systemsOf = (opf) => [...opf.matchAll(/<meta property="a11y:brailleSystem">([^<]*)<\/meta>/g)].map((m) => m[1]);
const dc = (opf, name) => (new RegExp(`<dc:${name}[^>]*>([^<]*)</dc:${name}>`).exec(opf) || [])[1];
const complete = (opf) => /<meta property="a11y:completeTranscription">([^<]*)</.exec(opf)[1];
const BLANK = '⠀';                                 // U+2800, the blank braille cell
const U = (brf) => brfToUnicodeBraille(brf).replace(/⠀/g, ' ');   // single spaces stay spaces in the file (cells() in format/ebraille.mjs)
// the <p> rows of the first <div class="..."> with this class
const rows = (html, cls) => {
  const m = new RegExp(`<div class="${cls}[^"]*">([\\s\\S]*?)</div>`).exec(html);
  assert.ok(m, `no div.${cls} in: ${html.slice(0, 600)}`);
  return [...m[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((x) => x[1]);
};

// ---------------------------------------------------------------------------------------------------------------------------------
describe('#17 the declared braille system', () => {
  test('registryName: UEB grade 1, UEB grade 2, any other code (its own id), an unknown code follows the grade', () => {
    assert.equal(registryName({ brailleCode: 'en-ueb-g1' }), 'ueb grade1');
    assert.equal(registryName({ brailleCode: 'en-ueb-g2' }), 'ueb grade2');
    assert.equal(registryName({ brailleCode: 'de-g2' }), 'de-g2');
    assert.equal(registryName({ brailleCode: 'no-such-code', grade: 'g1' }), 'ueb grade1');   // the table in force is UEB grade 1
    assert.equal(registryName({ brailleCode: 'no-such-code', grade: 'g2' }), 'ueb grade2');
    assert.equal(registryName({}), 'ueb grade2');
  });

  test('settingsForTable: the code a table list belongs to (UEB tables, a listed code, an unknown list)', () => {
    const sft = (t) => brailleTable.settingsForTable(t);
    assert.equal(registryName(sft(brailleTable.UEB_TABLES.g1)), 'ueb grade1');
    assert.equal(registryName(sft(brailleTable.UEB_TABLES.g2)), 'ueb grade2');
    const de = brailleTable.resolveTable({ brailleCode: 'de-g2' });
    assert.equal(registryName(sft(de)), 'de-g2');
    assert.equal(codeLanguage(sft(de)), 'de');
    assert.equal(registryName(sft('/tables/unknown.ctb')), 'ueb grade2');
  });

  for (const [code, want] of [['en-ueb-g1', 'ueb grade1'], ['en-ueb-g2', 'ueb grade2'], ['de-g2', 'de-g2']]) {
    test(`a package made for ${code} declares ${want}`, async () => {
      const bytes = exportToEbraille({ title: 'T', blocks: [{ type: 'para', text: 'Hello' }] }, opts({ brailleSystem: registryName({ brailleCode: code }) }));
      assert.deepEqual(systemsOf((await open(bytes)).opf), [want]);
    });
  }

  const mathDoc = { title: 'T', blocks: [{ type: 'para', segments: [{ type: 'text', text: 'Solve ' }, { type: 'math', latex: 'x^2' }, { type: 'text', text: ' now.' }], text: 'Solve x^2 now.' }] };
  const mathTableDoc = { title: 'T', blocks: [{ type: 'table', headers: ['A'], rows: [[{ segments: [{ type: 'math', latex: 'y' }], text: 'y' }]] }] };
  const mathToBrf = () => '#B';
  test('Nemeth maths in the document: the text system AND Nemeth are declared', async () => {
    const e = await open(exportToEbraille(structuredClone(mathDoc), opts({ brailleSystem: 'ueb grade2', mathCode: 'nemeth', mathToBrf })));
    assert.deepEqual(systemsOf(e.opf), ['ueb grade2', 'Nemeth no-grade math']);
  });
  test('UEB maths in the document: UEB technical (grade 1) is declared as well as the contracted text', async () => {
    const e = await open(exportToEbraille(structuredClone(mathDoc), opts({ brailleSystem: 'ueb grade2', mathCode: 'ueb', mathToBrf })));
    assert.deepEqual(systemsOf(e.opf), ['ueb grade2', 'ueb grade1']);
  });
  test('UEB maths in an uncontracted UEB document adds nothing (grade 1 is already declared once)', async () => {
    const e = await open(exportToEbraille(structuredClone(mathDoc), opts({ brailleSystem: 'ueb grade1', mathCode: 'ueb', mathToBrf })));
    assert.deepEqual(systemsOf(e.opf), ['ueb grade1']);
  });
  test('with no maths code named, the layout standard decides (BANA Nemeth, UKAAF UEB), as effectiveMathCode does', async () => {
    const bana = await open(exportToEbraille(structuredClone(mathDoc), opts({ mode: 'bana', standard: 'bana', brailleSystem: 'ueb grade2', mathToBrf })));
    assert.deepEqual(systemsOf(bana.opf), ['ueb grade2', 'Nemeth no-grade math']);
  });
  test('maths inside a table cell counts too', async () => {
    const e = await open(exportToEbraille(structuredClone(mathTableDoc), opts({ brailleSystem: 'ueb grade2', mathCode: 'nemeth', mathToBrf })));
    assert.deepEqual(systemsOf(e.opf), ['ueb grade2', 'Nemeth no-grade math']);
  });
  test('no maths in the document: only the text system, even when a maths code is in force', async () => {
    const e = await open(exportToEbraille({ title: 'T', blocks: [{ type: 'para', text: 'No maths here.' }] }, opts({ brailleSystem: 'ueb grade2', mathCode: 'nemeth', mathToBrf })));
    assert.deepEqual(systemsOf(e.opf), ['ueb grade2']);
  });
  test('maths that cannot be brailled (no maths engine) is not declared', async () => {
    const e = await open(exportToEbraille(structuredClone(mathDoc), opts({ brailleSystem: 'ueb grade2', mathCode: 'nemeth' })));
    assert.deepEqual(systemsOf(e.opf), ['ueb grade2']);
  });
  test('no brailleSystem given: still "ueb grade2" (the old default)', async () => {
    const e = await open(exportToEbraille({ title: 'T', blocks: [{ type: 'para', text: 'Hi' }] }, opts()));
    assert.deepEqual(systemsOf(e.opf), ['ueb grade2']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('#18 author, language, identifier, publisher (Paul B1)', () => {
  const book = (metadata, extra = {}) => ({ title: 'Ein Buch', blocks: [{ type: 'para', text: 'Hallo' }], metadata, ...extra });

  test('the audit reproduction: creator Known Author, language de-DE, in an English browser', async () => {
    const e = await open(exportToEbraille(book({ creator: 'Known Author', language: 'de-DE' }), opts({ language: 'en-US' })));
    assert.equal(dc(e.opf, 'creator'), 'Known Author');
    assert.equal(dc(e.opf, 'language'), 'de-Brai-DE');
  });
  test('identifier and publisher of the document are kept; the producer stays ours', async () => {
    const e = await open(exportToEbraille(book({ creator: 'A', identifier: 'urn:isbn:9781234567897', publisher: 'Verlag X' }), opts()));
    assert.equal(dc(e.opf, 'identifier'), 'urn:isbn:9781234567897');
    assert.equal(dc(e.opf, 'publisher'), 'Verlag X');
    assert.match(e.opf, /<meta property="a11y:producer">Sensory App House Ltd</);
  });
  test('without imported metadata the old values stand: publisher is ours, identifier is made from the content', async () => {
    const e = await open(exportToEbraille(book(undefined), opts()));
    assert.equal(dc(e.opf, 'publisher'), 'Sensory App House Ltd');
    assert.match(dc(e.opf, 'identifier'), /^urn:uuid:/);
    assert.equal(dc(e.opf, 'creator'), 'Unknown');
  });
  test('author precedence: the model\'s own author/creator, then metadata.creator, metadata.author, docauthor', async () => {
    const name = async (doc) => dc((await open(exportToEbraille(doc, opts()))).opf, 'creator');
    assert.equal(await name(book({ creator: 'M' }, { author: 'Own' })), 'Own');
    assert.equal(await name(book({ creator: 'M', author: 'N', docauthor: 'D' })), 'M');
    assert.equal(await name(book({ author: 'N', docauthor: 'D' })), 'N');
    assert.equal(await name(book({ docauthor: 'D', docauthors: ['D', 'E'] })), 'D');
    assert.equal(await name(book({ docauthors: ['F', 'G'] })), 'F');
  });
  test('language precedence: the document, then the selected braille code, then the browser (last)', async () => {
    const lang = async (doc, o) => dc((await open(exportToEbraille(doc, opts(o)))).opf, 'language');
    assert.equal(await lang(book({ language: 'de-DE' }), { codeLanguage: 'fr', language: 'en-US' }), 'de-Brai-DE');
    assert.equal(await lang(book({ lang: 'nl' }), { codeLanguage: 'fr', language: 'en-US' }), 'nl-Brai');
    assert.equal(await lang(book(undefined), { codeLanguage: 'fr', language: 'en-US' }), 'fr-Brai');             // the code's, not the browser's
    assert.equal(await lang(book(undefined), { language: 'en-GB' }), 'en-Brai-GB');                               // the browser's: the last fallback
    assert.equal(await lang(book(undefined), { codeLanguage: 'en', language: 'en-GB' }), 'en-Brai-GB');          // same language: the browser's region is kept
    assert.equal(await lang(book(undefined), { codeLanguage: 'de', language: 'en-GB' }), 'de-Brai');
  });
  test('a script subtag in the document\'s language does not become a second script (zh-Hans-CN -> zh-Brai-CN)', async () => {
    const e = await open(exportToEbraille(book({ language: 'zh-Hans-CN' }), opts()));
    assert.equal(dc(e.opf, 'language'), 'zh-Brai-CN');
  });
  test('codeLanguage: the language of a braille code (en for UEB, de for German, en when unknown)', () => {
    assert.equal(codeLanguage({ brailleCode: 'en-ueb-g2' }), 'en');
    assert.equal(codeLanguage({ brailleCode: 'de-g2' }), 'de');
    assert.equal(codeLanguage({ brailleCode: 'no-such-code' }), 'en');
    assert.equal(codeLanguage({}), 'en');
  });

  test('NIMAS import: the DTBook head\'s author, language, identifier and publisher reach the eBraille', async () => {
    const xml = fs.readFileSync(new URL('./nimas_samples/NIMAS_valid_baseline.xml', import.meta.url), 'utf8');
    const e = await open(exportToEbraille(parseDtbook(xml), opts({ codeLanguage: 'fr', language: 'en-US' })));
    assert.equal(dc(e.opf, 'creator'), 'Beatrice Christensen Sköld');
    assert.equal(dc(e.opf, 'language'), 'en-Brai-GB');
    assert.equal(dc(e.opf, 'identifier'), 'C00000');
    assert.equal(dc(e.opf, 'publisher'), 'TPB');
  });

  // an EPUB import keeps what the OPF says about the book
  test('EPUB import: creator, language, identifier, publisher and title reach the model and the eBraille', async () => {
    const CONTAINER = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
    const opf = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
      + '<dc:title>Emma</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en-GB</dc:language><dc:identifier id="id">urn:isbn:9780141439587</dc:identifier><dc:publisher>Penguin</dc:publisher>'
      + '</metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>';
    const page = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><h1>One</h1><p>Text.</p></body></html>';
    const buf = await makeZip([{ name: 'META-INF/container.xml', text: CONTAINER }, { name: 'OEBPS/content.opf', text: opf }, { name: 'OEBPS/c1.xhtml', text: page }]).arrayBuffer();
    const model = await parseEpub(buf);
    assert.equal(model.title, 'Emma');
    assert.equal(model.metadata?.creator, 'Jane Austen');
    assert.equal(model.metadata?.language, 'en-GB');
    assert.equal(model.metadata?.identifier, 'urn:isbn:9780141439587');
    assert.equal(model.metadata?.publisher, 'Penguin');
    assert.equal(model.metadata?.package, undefined, 'an EPUB is not a NIMAS package: no package marker');
    const e = await open(exportToEbraille(model, opts({ codeLanguage: 'fr', language: 'de-DE' })));
    assert.equal(dc(e.opf, 'creator'), 'Jane Austen');
    assert.equal(dc(e.opf, 'language'), 'en-Brai-GB');
    assert.equal(dc(e.opf, 'identifier'), 'urn:isbn:9780141439587');
    assert.equal(dc(e.opf, 'publisher'), 'Penguin');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('#19 blank lines of code and blank rows of a raster graphic', () => {
  const code = async (text) => rows((await open(exportToEbraille({ title: 'T', blocks: [{ type: 'code', text }] }, opts()))).html, 'code');
  const OPEN = U(';;;'), CLOSE = U(";'");
  test('code without blank lines is as before', async () => {
    assert.deepEqual(await code('alpha\nbeta'), [OPEN, U('ALPHA'), U('BETA'), CLOSE]);
  });
  test('an internal blank line stays a blank line', async () => {
    assert.deepEqual(await code('alpha\n\nbeta'), [OPEN, U('ALPHA'), BLANK, U('BETA'), CLOSE]);
  });
  test('several blank lines, and leading and trailing blank lines, are all kept', async () => {
    assert.deepEqual(await code('\nalpha\n\n\nbeta\n\n'), [OPEN, BLANK, U('ALPHA'), BLANK, BLANK, U('BETA'), BLANK, BLANK, CLOSE]);
  });
  test('a blank line holding only blanks is a blank line too (its spaces are not code)', async () => {
    assert.deepEqual(await code('alpha\n   \nbeta'), [OPEN, U('ALPHA'), BLANK, U('BETA'), CLOSE]);
  });

  const raster = async (type, lines) => rows((await open(exportToEbraille({ title: 'T', blocks: [{ type, title: 'G', lines }] }, opts()))).html, 'tactile-raster');
  const TITLE = U('[TACTILE GRAPHIC: G]');
  test('a raster graphic keeps an internal blank row', async () => {
    assert.deepEqual(await raster('tactile', ['⠁', '', '⠃']), [TITLE, U('A'), BLANK, U('B')]);
  });
  test('leading, internal and trailing blank rows of a raster are kept', async () => {
    assert.deepEqual(await raster('graphic', ['', '⠁', '', '', '⠃', '']), [TITLE, BLANK, U('A'), BLANK, BLANK, U('B'), BLANK]);
  });
  test('a raster without blank rows is as before', async () => {
    assert.deepEqual(await raster('tactile', ['⠁', '⠃']), [TITLE, U('A'), U('B')]);
  });
  test('ordinary paragraphs are unchanged: no blank-cell paragraph appears', async () => {
    const e = await open(exportToEbraille({ title: 'T', blocks: [{ type: 'para', text: 'one' }, { type: 'para', text: 'two' }] }, opts()));
    assert.ok(!e.html.includes(`<p>${BLANK}</p>`), e.html);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('#20 a table cell or label that cannot be brailled (Paul C1)', () => {
  // succeeds for everything but the text BAD
  const picky = (s) => { if (/BAD/.test(String(s))) throw new Error('cannot braille ' + s); return up(s); };
  const MARK = U('@.<' + up('Cell could not be brailled') + '@.>');
  const table = { type: 'table', headers: ['OK', 'BAD'], rows: [['OK', 'BAD'], ['BAD', 'OK']] };
  const cellsOf = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);

  test('a failing header and failing data cells show the marker, return warnings and make the package incomplete', async () => {
    const bytes = exportToEbraille({ title: 'T', blocks: [structuredClone(table)] }, opts({ translate: picky }));
    const e = await open(bytes);
    assert.deepEqual(cellsOf(e.html, 'th'), [U('OK'), MARK]);
    assert.deepEqual(cellsOf(e.html, 'td'), [U('OK'), MARK, MARK, U('OK')]);
    assert.equal(complete(e.opf), 'false');
    assert.equal(bytes.warnings.length, 3);
    assert.deepEqual(bytes.warnings.map((w) => w.where).sort(), ['table cell', 'table cell', 'table header']);
    for (const w of bytes.warnings) { assert.equal(w.kind, 'ebraille-untranslated'); assert.match(w.message, /could not be brailled/i); }
  });
  test('one failing header alone', async () => {
    const e = await open(exportToEbraille({ title: 'T', blocks: [{ type: 'table', headers: ['BAD'], rows: [['OK']] }] }, opts({ translate: picky })));
    assert.deepEqual(cellsOf(e.html, 'th'), [MARK]);
    assert.deepEqual(cellsOf(e.html, 'td'), [U('OK')]);
    assert.equal(complete(e.opf), 'false');
  });
  test('one failing data cell alone', async () => {
    const bytes = exportToEbraille({ title: 'T', blocks: [{ type: 'table', headers: ['OK'], rows: [['BAD']] }] }, opts({ translate: picky }));
    const e = await open(bytes);
    assert.deepEqual(cellsOf(e.html, 'td'), [MARK]);
    assert.equal(complete(e.opf), 'false');
    assert.equal(bytes.warnings.length, 1);
  });
  test('a failing label (the landmark label, the page list heading) is marked, warned and makes the package incomplete', async () => {
    const failLabel = (s) => { if (/START OF BODY MATTER|PAGE LIST/i.test(String(s))) throw new Error('no label'); return up(s); };
    const doc = { title: 'T', blocks: [{ type: 'para', text: 'Front matter.' }, { type: 'heading', level: 1, text: 'One' }, { type: 'pagenum', page: '1', text: '1' }, { type: 'para', text: 'Body.' }] };
    const bytes = exportToEbraille(doc, opts({ translate: failLabel }));
    const e = await open(bytes);
    assert.equal(complete(e.opf), 'false');
    assert.ok(bytes.warnings.length >= 1 && bytes.warnings.every((w) => w.where === 'label'), JSON.stringify(bytes.warnings));
    const LMARK = U('@.<' + up('Label could not be brailled') + '@.>');
    assert.ok(e.index.includes(LMARK), 'the marker stands where the label was');
    assert.ok(!/<a [^>]*>\s*<\/a>/.test(e.index), 'no empty link');
  });
  test('a clean export has no warnings and says complete', async () => {
    const bytes = exportToEbraille({ title: 'T', blocks: [{ type: 'table', headers: ['OK'], rows: [['OK']] }] }, opts({ translate: picky }));
    assert.deepEqual(bytes.warnings, []);
    assert.equal(complete((await open(bytes)).opf), 'true');
  });
  test('the bytes are still a plain Uint8Array', () => {
    const bytes = exportToEbraille({ title: 'T', blocks: [{ type: 'para', text: 'x' }] }, opts());
    assert.ok(bytes instanceof Uint8Array);
  });
});
