// K5 (EMBOSS-TASKS.md section K): the UEB script typeform (Rules of UEB, 3rd edition, §9).
// Unlike bold/italic/underline (also in §9, and unlike the five transcriber-defined typeforms
// of §9.5, which have no fixed print meaning), script has UEB's own fixed indicators —
// symbol ⠈⠆, word ⠈⠂, passage ⠈⠶, terminator ⠈⠄ — and RUEB 3rd ed. §9.1.2 says in so many
// words that it "does NOT need a transcriber-defined typeform". Model: `segment.tf` gets a
// fourth bit, TF_SCRIPT = 8 (format/cell-markup.mjs, engine/louis.mjs's TYPEFORM.script — the
// liblouis en-ueb-g1/g2.ctb tables' own `emphclass script`, dot patterns confirmed directly
// against the compiled tables below), combinable with TF_BOLD/TF_ITALIC/TF_UNDERLINE exactly
// the way those three already combine with each other. Because script rides the SAME `tf`
// field as bold/italic/underline (not a separate field like transcriberTypeform), every rule
// that already inspects `seg.tf` generically — stripEmphasis, forceBold, the "whole list is one
// typeform" checks, segTf/groupSegments, getBlockSignature's block.segments cache key — needed
// NO change at all; this file exists to prove that, not just assert it.
//
// One describe block per reader (HTML/EPUB, DOCX, .doc, DTBook — the round-trip shape), then
// the braille-output matrix (word / passage / single letter / mid-word / combined with bold,
// grade 1 and grade 2), the table-cell markup/contenteditable round trip, a "script never
// appears on the Special Symbols page" regression guard (opposite of strikethrough — §9.1.2's
// whole point), and the NIMAS export/import round trip.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
import { parseHtml, parseEpub, parseDocx, parseDtbook } from '../input/parse.mjs';
import { parseDoc } from '../input/doc.mjs';
import { formatDocument, collectSpecialSymbols, suggestTranscriberNotes } from '../format/document.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { makeZip } from '../web/zip.mjs';
import { writeDoc } from './helpers/doc-writer.mjs';
import { TF_ITALIC, TF_UNDERLINE, TF_BOLD, TF_SCRIPT, parseCellMarkup, cellToMarkup, cellFromSegments } from '../format/cell-markup.mjs';
import { segmentsToCellHtml, cellHtmlToSegments } from '../format/cell-dom.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));

const translateG2 = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const OPTS_G2 = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: translateG2, translateG1, suppressHeader: true };
const OPTS_G1 = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: translateG1, suppressHeader: true };

function firstParaLine(model, opts = OPTS_G2) {
  return formatDocument({ blocks: model.blocks, title: model.title }, opts).split(/\r?\n/).map((l) => l.trimEnd()).find((l) => l.trim());
}
function scriptSegs(segments) {
  return (segments || []).filter((s) => s && s.type === 'text' && (s.tf || 0) & TF_SCRIPT);
}

// Confirm the compiled table's script dot patterns/BRF-ASCII independently (task requirement),
// rather than only trusting format/document.mjs's own generic segTf handling.
const SCRIPT_BIT = louis.TYPEFORM.script;
assert.equal(SCRIPT_BIT, 8, 'TF_SCRIPT must match engine TYPEFORM.script exactly');
assert.equal(louis.translate('x', louis.TABLES.uebG2, [SCRIPT_BIT]), '@2;X', 'script SYMBOL form');
assert.ok(louis.translate('xy', louis.TABLES.uebG2, [SCRIPT_BIT, SCRIPT_BIT]).startsWith('@1'), 'script WORD form');
{
  const passage = louis.translate('a b c', louis.TABLES.uebG2, Array(5).fill(SCRIPT_BIT));
  assert.ok(passage.startsWith('@7'), `script PASSAGE opening indicator: ${passage}`);
  assert.ok(passage.endsWith("@'"), `script PASSAGE terminator: ${passage}`);
}

const SCRIPT_WORD = '@1', SCRIPT_SYMBOL = '@2', SCRIPT_PASSAGE = '@7', SCRIPT_END = "@'";

// ---------------------------------------------------------------------------------------------
describe('readers: HTML/EPUB, DOCX, .doc, DTBook — each sets tf|=TF_SCRIPT', () => {
  test('HTML <span class="script">', () => {
    const m = parseHtml('<p>before <span class="script">scripted</span> after</p>');
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = scriptSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'scripted');
  });

  test('HTML style="font-family: cursive" (the CSS generic family)', () => {
    const m = parseHtml('<p>before <span style="font-family: cursive">scripted</span> after</p>');
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(scriptSegs(p.segments).length, 1);
  });

  test('HTML style="font-family: \'Segoe Script\', cursive" (a quoted, named script font)', () => {
    const m = parseHtml('<p>before <span style="font-family: \'Segoe Script\', cursive">scripted</span> after</p>');
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(scriptSegs(p.segments).length, 1);
  });

  test('HTML class="description" is NOT read as script (the "script" substring trap)', () => {
    const m = parseHtml('<p>before <span class="description">plain</span> after</p>');
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(p.segments, undefined, 'no segments at all: nothing here was ever read as emphasis');
    assert.equal(p.text, 'before plain after');
  });

  test('HTML font-family "Comic Sans MS" is NOT read as script (casual, not a script/cursive face)', () => {
    const m = parseHtml('<p>before <span style="font-family: \'Comic Sans MS\'">plain</span> after</p>');
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(p.segments, undefined);
  });

  test('HTML <span class="script"> combined with <b>: both survive on the same segment', () => {
    const m = parseHtml('<p><b><span class="script">wow</span></b></p>');
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = scriptSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].tf & TF_BOLD, TF_BOLD);
  });

  test('EPUB (shares parseHtml under the hood)', async () => {
    const html = '<html><body><p>before <span class="script">scripted</span> after</p></body></html>';
    const zip = makeZip([
      { name: 'mimetype', text: 'application/epub+zip' },
      { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OEBPS/content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
      { name: 'OEBPS/ch1.xhtml', text: html },
    ]);
    const buf = await zip.arrayBuffer();
    const m = await parseEpub(buf);
    const p = m.blocks.find((b) => b.type === 'para' && scriptSegs(b.segments).length);
    assert.ok(p, `no script paragraph found: ${JSON.stringify(m.blocks)}`);
  });

  test('DOCX: a run\'s direct w:rFonts naming a script font', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bodyXml = `<w:p><w:r><w:t>before </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Brush Script MT"/></w:rPr><w:t>scripted</w:t></w:r><w:r><w:t> after</w:t></w:r></w:p>`;
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
    const buf = await makeZip([{ name: 'word/document.xml', text: docXml }]).arrayBuffer();
    const m = await parseDocx(buf);
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = scriptSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'scripted');
  });

  test('DOCX: a plain body font (Calibri) is NOT read as script', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bodyXml = `<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>plain</w:t></w:r></w:p>`;
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
    const buf = await makeZip([{ name: 'word/document.xml', text: docXml }]).arrayBuffer();
    const m = await parseDocx(buf);
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(scriptSegs(p.segments).length, 0);
  });

  test('.doc: a run\'s direct font-table entry naming a script font', async () => {
    const bytes = writeDoc({ body: [{ p: ['before ', { text: 'scripted', font: 'Brush Script MT' }, ' after'] }] });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const m = await parseDoc(buf);
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = scriptSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'scripted');
  });

  test('.doc: script combined with bold on the same run', async () => {
    const bytes = writeDoc({ body: [{ p: [{ text: 'wow', b: true, font: 'Lucida Handwriting' }] }] });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const m = await parseDoc(buf);
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = scriptSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].tf & TF_BOLD, TF_BOLD);
  });

  test('DTBook: Emboss\'s own <span class="script"> (NIMAS round-trip shape) reads as TF_SCRIPT', () => {
    const xml = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><p>before <span class="script">scripted</span> after</p></level1></bodymatter></book></dtbook>`;
    const m = parseDtbook(xml);
    const p = m.blocks.find((b) => b.type === 'para');
    const hit = scriptSegs(p.segments);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'scripted');
  });

  test('DTBook: a bare <script> tag is read leniently the same way', () => {
    const xml = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><p>before <script>scripted</script> after</p></level1></bodymatter></book></dtbook>`;
    const m = parseDtbook(xml);
    const p = m.blocks.find((b) => b.type === 'para');
    assert.equal(scriptSegs(p.segments).length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('braille output: word / passage / single letter / mid-word / combined with bold', () => {
  test('a single script word gets the WORD indicator', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'This is ' }, { type: 'text', text: 'scripted', tf: TF_SCRIPT }, { type: 'text', text: ' out.' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(SCRIPT_WORD), `expected the script word indicator ${SCRIPT_WORD} in: ${line}`);
  });

  test('a script passage of 3+ words gets the PASSAGE indicator and terminator', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'one two three', tf: TF_SCRIPT }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(SCRIPT_PASSAGE), `expected the script passage indicator ${SCRIPT_PASSAGE} in: ${line}`);
    assert.ok(line.includes(SCRIPT_END), `expected the script terminator ${SCRIPT_END} in: ${line}`);
  });

  test('a single script letter gets the SYMBOL indicator', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'x', tf: TF_SCRIPT }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(SCRIPT_SYMBOL), `expected the script symbol indicator ${SCRIPT_SYMBOL} in: ${line}`);
  });

  test('script starting inside a word (partial-word emphasis) opens and closes mid-word', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'un', tf: TF_SCRIPT }, { type: 'text', text: 'happy' }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(SCRIPT_WORD), `expected an opening script indicator in: ${line}`);
    assert.ok(line.includes(SCRIPT_END), `expected a mid-word terminator before "happy" in: ${line}`);
  });

  test('script combined with bold: both indicators appear', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'strong', tf: TF_BOLD | TF_SCRIPT }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(SCRIPT_WORD), `expected the script indicator in: ${line}`);
    assert.ok(/[~^]1/.test(line) || line.includes('~1') || line.includes('^1'), `expected a bold word indicator too in: ${line}`);
  });

  test('script combined with italic and underline all at once', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'strong', tf: TF_BOLD | TF_ITALIC | TF_UNDERLINE | TF_SCRIPT }] }] };
    const line = firstParaLine(doc);
    assert.ok(line.includes(SCRIPT_WORD), `expected the script indicator in: ${line}`);
  });

  test('grade 1 (uncontracted): the same script word indicator appears', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'This is ' }, { type: 'text', text: 'scripted', tf: TF_SCRIPT }, { type: 'text', text: ' out.' }] }] };
    const line = firstParaLine(doc, OPTS_G1);
    assert.ok(line.includes(SCRIPT_WORD), `expected the script word indicator in grade 1: ${line}`);
  });

  test('grade 1 (uncontracted): a script passage gets the PASSAGE indicator and terminator', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'one two three', tf: TF_SCRIPT }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc, OPTS_G1);
    assert.ok(line.includes(SCRIPT_PASSAGE), `expected the script passage indicator in grade 1: ${line}`);
    assert.ok(line.includes(SCRIPT_END), `expected the script terminator in grade 1: ${line}`);
  });

  test('grade 1 (uncontracted): a script letter gets the SYMBOL indicator', () => {
    const doc = { blocks: [{ type: 'para', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'x', tf: TF_SCRIPT }, { type: 'text', text: ' b' }] }] };
    const line = firstParaLine(doc, OPTS_G1);
    assert.ok(line.includes(SCRIPT_SYMBOL), `expected the script symbol indicator in grade 1: ${line}`);
  });

  test('plain text (tf 0) is unaffected', () => {
    const doc = { blocks: [{ type: 'para', text: 'Nothing scripted here at all.' }] };
    const line = firstParaLine(doc);
    assert.ok(!line.includes(SCRIPT_WORD) && !line.includes(SCRIPT_SYMBOL) && !line.includes(SCRIPT_PASSAGE));
  });
});

// ---------------------------------------------------------------------------------------------
describe('headings and lists drop script the same way they drop bold/italic/underline (§4.3.7/8.1.4a)', () => {
  test('a centred heading in script has its typeform stripped, same as bold/italic/underline', () => {
    const plainDoc = { blocks: [{ type: 'heading', level: 1, style: 'centered', text: 'Chapter One' }] };
    const scriptDoc = { blocks: [{ type: 'heading', level: 1, style: 'centered', segments: [{ type: 'text', text: 'Chapter One', tf: TF_SCRIPT }] }] };
    assert.equal(firstParaLine(scriptDoc), firstParaLine(plainDoc), 'stripEmphasis already treats any tf bit the same way — no script-specific gap');
  });
});

// ---------------------------------------------------------------------------------------------
describe('table cells: markup, contenteditable HTML, and combinations', () => {
  test('parseCellMarkup reads <script>…</script> into tf|=TF_SCRIPT', () => {
    const segs = parseCellMarkup('before <script>scripted</script> after');
    const hit = segs.filter((s) => (s.tf || 0) & TF_SCRIPT);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'scripted');
  });

  test('cellToMarkup round-trips a script segment back to the same markup', () => {
    const segs = parseCellMarkup('before <script>scripted</script> after');
    const cell = cellFromSegments('before scripted after', segs);
    assert.equal(cellToMarkup(cell), 'before <script>scripted</script> after');
  });

  test('segmentsToCellHtml / cellHtmlToSegments round-trip a script run', () => {
    const segments = [{ type: 'text', text: 'before ' }, { type: 'text', text: 'scripted', tf: TF_SCRIPT }, { type: 'text', text: ' after' }];
    const html = segmentsToCellHtml(segments);
    assert.match(html, /<span class="cell-script">scripted<\/span>/);
    const back = cellHtmlToSegments(html);
    const hit = back.filter((s) => (s.tf || 0) & TF_SCRIPT);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].text, 'scripted');
  });

  test('a table cell run combining bold and script keeps both bits through the HTML round trip', () => {
    const html = segmentsToCellHtml([{ type: 'text', text: 'wow', tf: TF_BOLD | TF_SCRIPT }]);
    const back = cellHtmlToSegments(html);
    assert.equal(back.length, 1);
    assert.equal(back[0].tf, TF_BOLD | TF_SCRIPT);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Special Symbols page: script is a STANDARD UEB indicator, never listed (opposite of strikethrough)', () => {
  const scriptBlocks = [{ type: 'para', segments: [{ type: 'text', text: 'before ' }, { type: 'text', text: 'scripted', tf: TF_SCRIPT }, { type: 'text', text: ' after' }] }];

  test('collectSpecialSymbols lists no entry at all for a script run (RUEB §9.1.2: no transcriber-defined typeform needed)', () => {
    const found = collectSpecialSymbols(scriptBlocks, OPTS_G2);
    assert.ok(!found.some((s) => s.kind === 'typeform'), `script must not appear on the Special Symbols page: ${JSON.stringify(found)}`);
  });

  test('suggestTranscriberNotes offers nothing about a transcriber-defined typeform for plain script', () => {
    const suggestions = suggestTranscriberNotes(scriptBlocks, OPTS_G2);
    assert.ok(!suggestions.some((s) => s.id === 'transcriber-typeform'), JSON.stringify(suggestions));
  });

  test('script alongside a genuine transcriber-defined typeform (strikethrough) still lists only the strikethrough entry', () => {
    const mixed = [{ type: 'para', segments: [
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'scripted', tf: TF_SCRIPT },
      { type: 'text', text: ' b ' },
      { type: 'text', text: 'struck', transcriberTypeform: 'strike' },
    ] }];
    const found = collectSpecialSymbols(mixed, OPTS_G2).filter((s) => s.kind === 'typeform');
    assert.equal(found.length, 1, `expected only the strikethrough entry: ${JSON.stringify(found)}`);
    assert.match(found[0].description, /crossed-out/i);
  });
});

// ---------------------------------------------------------------------------------------------
describe('round trip: HTML -> NIMAS export -> DTBook re-import -> same braille', () => {
  test('a script word survives save and reload, and brailles the same both times', () => {
    const m = parseHtml('<p>before <span class="script">scripted</span> after</p>');
    const model = { title: 'T', blocks: m.blocks };
    const before = firstParaLine(model);
    assert.ok(before.includes(SCRIPT_WORD));

    const xml = exportToNimasXml(model, { uid: 'script-roundtrip', date: '2026-01-01' });
    assert.ok(xml.includes('<span class="script">'), `exporter should write class="script":\n${xml}`);
    assert.doesNotMatch(xml, /<bai-[a-z0-9]+[ >/]/i, 'never a literal BrailleBlaster element');

    const reloaded = parseDtbook(xml);
    const p = reloaded.blocks.find((b) => b.type === 'para' && /scripted/.test(b.text || ''));
    assert.ok(p, 'the scripted paragraph survived reload');
    const hit = scriptSegs(p.segments);
    assert.equal(hit.length, 1);

    const after = firstParaLine({ title: 'T', blocks: reloaded.blocks });
    assert.equal(after, before, 'braille is identical before and after the round trip');
  });

  test('a second save/reload is stable (idempotent)', () => {
    const m = parseHtml('<p><span class="script">scripted</span></p>');
    const xml1 = exportToNimasXml({ title: 'T', blocks: m.blocks }, { uid: 'x', date: '2026-01-01' });
    const reloaded1 = parseDtbook(xml1);
    const xml2 = exportToNimasXml({ title: 'T', blocks: reloaded1.blocks }, { uid: 'x', date: '2026-01-01' });
    assert.equal(xml1, xml2);
  });

  test('script and strikethrough together survive the round trip distinctly', () => {
    const m = parseHtml('<p><span class="script">scripted</span> and <s>struck</s></p>');
    const xml = exportToNimasXml({ title: 'T', blocks: m.blocks }, { uid: 'y', date: '2026-01-01' });
    assert.ok(xml.includes('<span class="script">'));
    assert.ok(xml.includes('<span class="strikethrough">'));
    const reloaded = parseDtbook(xml);
    const p = reloaded.blocks.find((b) => b.type === 'para');
    assert.equal(scriptSegs(p.segments).length, 1);
    assert.equal((p.segments || []).filter((s) => s.transcriberTypeform === 'strike').length, 1);
  });
});
