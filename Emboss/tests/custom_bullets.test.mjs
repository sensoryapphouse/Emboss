// IMP-W7 (Paul, 30 Sep 2026, Emboss/docs/decisions.md "Word import"): "Custom bullets (arrow, en dash...) keep
// their print symbol, listed on the Special Symbols page as icons are (ICON-1)."
//  - Word (and RTF) numbering keeps the print bullet glyph as the item's marker when it is not one of the bullets that
//    already have a UEB sign (BANA 8.6.2a: dot, hollow/solid square, hollow circle, triangle, checkmark); the small
//    dot-like shapes (. o . . . . . small squares, black circle) stay the ordinary bullet.
//  - BANA (8.6.2a: "If the print symbol does not have a corresponding symbol in braille, devise a symbol using a
//    transcriber-defined symbol indicator", UEB 3.26; 8.6.2b: list it on the Special Symbols page): the bullet is braille
//    with the next free transcriber-defined symbol (the same pool and order as ICON-1's icons) and the Special Symbols page
//    lists it, with "Arrow bullet" / "Dash bullet" ... as its meaning.
//  - UKAAF (UK-8: no Special Symbols page; B004 section 10, N.B.: "if the bullet symbol is obscure it can be substituted"):
//    the ordinary bullet, as before; nothing is listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatDocumentAsync, customBulletGlyph } = await import(process.env.DOCUMENT_MJS || path.join(EMBOSS, 'format', 'document.mjs'));
const { parseDocx, parseRtf, parseDtbook } = await import(process.env.PARSE_MJS || path.join(EMBOSS, 'input', 'parse.mjs'));
const { exportToNimasXml, isCustomBulletMarker, isBulletMarker, isNonDotBulletMarker } = await import(path.join(EMBOSS, 'input', 'nimas-export.mjs'));
const { makeZip } = await import(path.join(EMBOSS, 'web', 'zip.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const rawTranslate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const rawTranslatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);

const ARROW = '➢', DASH = '–', STAR = '★';
const base = { width: 40, depth: 25, translate: rawTranslate, translatePos: rawTranslatePos, suppressHeader: true };
const bana = (extra) => ({ ...base, mode: 'bana', standard: 'bana', ...extra });
const ukaaf = (extra) => ({ ...base, mode: 'ukaaf', standard: 'ukaaf', docEndMarker: false, ...extra });
const list = (marker, ...names) => ({ type: 'list', items: names.map((t) => ({ marker, text: t })) });
const at = (cells, text) => `${cells} ${rawTranslate(text)}`;   // a braille line: bullet cells, a space, the text
const lines = (brf) => brf.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
const symLines = (brf) => lines(brf).filter((l) => l.startsWith('.=') && !l.startsWith('.= '));   // the listed symbols (not the dot locator's own line)

test('IMP-W7 BANA: an arrow bullet is a transcriber-defined symbol, on every item, and is listed on the Special Symbols page', () => {
  const model = { title: null, blocks: [list(ARROW, 'Apples', 'Pears'), { type: 'sympage', auto: true }] };
  const brf = formatDocument(model, bana());
  const l = lines(brf);
  assert.ok(l.includes(at(';?', 'Apples')) && l.includes(at(';?', 'Pears')), l.join('\n'));
  assert.ok(!l.includes(at('_4', 'Apples')), 'not the ordinary bullet');
  const s = symLines(brf);
  assert.deepEqual(s, [`.=;? ${rawTranslate('Arrow bullet')}`], s.join('\n'));
});

test('IMP-W7 BANA: an en dash bullet is its own symbol; two shapes take the first two symbols in order of appearance; a repeated shape reuses its symbol', () => {
  const model = { title: null, blocks: [list(ARROW, 'One'), list(DASH, 'Two'), list(ARROW, 'Three'), { type: 'sympage', auto: true }] };
  const brf = formatDocument(model, bana());
  const l = lines(brf);
  assert.ok(l.includes(at(';?', 'One')) && l.includes(at('#?', 'Two')) && l.includes(at(';?', 'Three')), l.join('\n'));
  const s = symLines(brf);
  assert.equal(s.length, 2, s.join('\n'));
  assert.ok(s.includes(`.=;? ${rawTranslate('Arrow bullet')}`) && s.includes(`.=#? ${rawTranslate('Dash bullet')}`), s.join('\n'));
});

test('IMP-W7 BANA: other shapes (star, hyphen, em dash) are symbols too; bullets that already have a UEB sign are unchanged', () => {
  const same = [['•', '_4'], ['□', ';$#D'], ['■', '_$#D'], ['○', ';$='], ['▲', ';$#C'], ['✓', '@%']];
  for (const [g, cells] of same) {
    const brf = formatDocument({ title: null, blocks: [list(g, 'Item'), { type: 'sympage', auto: true }] }, bana());
    assert.ok(lines(brf).includes(at(cells, 'Item')), `${g}: ${lines(brf).join('|')}`);
    assert.ok(!symLines(brf).some((x) => x.startsWith('.=;? ')), `${g} takes no transcriber-defined symbol`);
  }
  for (const g of [STAR, '-', '—']) {
    const brf = formatDocument({ title: null, blocks: [list(g, 'Item'), { type: 'sympage', auto: true }] }, bana());
    assert.ok(lines(brf).includes(at(';?', 'Item')), `${g}: ${lines(brf).join('|')}`);
    assert.equal(symLines(brf).length, 1, `${g}: ${symLines(brf).join('|')}`);
  }
});

test('IMP-W7 BANA: the same shape used as a bullet and as an inline icon is one symbol', () => {
  const model = { title: null, blocks: [
    { type: 'para', text: `See ☞ here.` },
    list('☞', 'Pointer item'),
    { type: 'sympage', auto: true }] };
  const brf = formatDocument(model, bana());
  assert.equal(symLines(brf).length, 1, symLines(brf).join('\n'));
  assert.ok(lines(brf).includes(at(';?', 'Pointer item')), lines(brf).join('\n'));
});

test('IMP-W7 BANA: the 8th distinct custom bullet has no symbol left: ordinary bullet and a warning', () => {
  const shapes = ['\u27A2', '\u2013', '\u2605', '\u2756', '\u27A4', '\u2726', '\u2727', '\u2740'];   // seven symbols exist (RUEB 3.26)
  const blocks = shapes.map((g, i) => list(g, `Item ${String.fromCharCode(97 + i)}`));
  const o = bana();
  const l = lines(formatDocument({ title: null, blocks }, o));
  assert.ok(l.slice(0, 7).every((x) => !x.startsWith('_4 ')), l.join('\n'));
  assert.equal(l[7], at('_4', 'Item h'), l.join('\n'));
  assert.equal((o.warnings || []).filter((w) => w.kind === 'bullet-symbol-overflow').length, 1, JSON.stringify(o.warnings));
});

test('IMP-W7 UKAAF: the ordinary bullet stands for any custom one (B004 section 10 N.B.), and no Symbols page is listed', () => {
  const model = { title: null, blocks: [list(ARROW, 'Apples'), list(DASH, 'Pears'), { type: 'sympage', auto: true }] };
  const brf = formatDocument(model, ukaaf({ listStyle: 'spaced' }));
  const l = lines(brf);
  assert.ok(l.includes(at('_4', 'Apples')) && l.includes(at('_4', 'Pears')), l.join('\n'));
  assert.ok(!/SPECIAL SYMBOLS|arrow/i.test(brf));
});

test('IMP-W7: the editor path (translatePos) lays a custom-bullet list out exactly as the plain path does', async () => {
  const model = { title: null, blocks: [list(ARROW, 'One', 'Two'), { type: 'para', text: 'Between' }, list(DASH, 'Three')] };
  const plain = formatDocument(model, bana());
  const traced = await formatDocumentAsync(model, bana());
  assert.equal(traced, plain);
});

// ---- Word / RTF: what the reader keeps ----
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const numbering = (glyph, font) => `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${glyph}"/><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const item = (t) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
async function docxMarker(glyph, font) {
  const buf = await zipBuf([
    { name: 'word/document.xml', text: `<?xml version="1.0"?><w:document ${W}><w:body>${item('Apples')}${item('Pears')}</w:body></w:document>` },
    { name: 'word/numbering.xml', text: numbering(glyph, font) },
  ]);
  const m = await parseDocx(buf);
  const l = m.blocks.find((b) => b.type === 'list');
  return { model: m, markers: l.items.map((i) => i.marker) };
}

test('IMP-W7 (Word): an arrow, a dash, a star keep their glyph; Wingdings arrowhead/arrow are the arrow glyph; dots stay the dot', async () => {
  const keep = [[ARROW, 'Segoe UI Symbol', ARROW], [DASH, 'Calibri', DASH], ['-', 'Calibri', '-'], ['—', 'Calibri', '—'], [STAR, 'Segoe UI Symbol', STAR],
    ['', 'Wingdings', ARROW], ['', 'Wingdings', '➔']];
  for (const [glyph, font, want] of keep) {
    const { markers } = await docxMarker(glyph, font);
    assert.deepEqual(markers, [want, want], `${font} U+${glyph.codePointAt(0).toString(16)}`);
  }
  const dots = [['', 'Symbol'], ['•', 'Arial'], ['●', 'Arial'], ['◦', 'Arial'], ['▪', 'Arial'], ['·', 'Arial'], ['', 'Wingdings'], ['‣', 'Arial']];
  for (const [glyph, font] of dots) {
    const { markers } = await docxMarker(glyph, font);
    assert.deepEqual(markers, ['•', '•'], `${font} U+${glyph.codePointAt(0).toString(16)} stays the ordinary bullet`);
  }
  for (const [glyph, font, want] of [['', 'Wingdings', '■'], ['', 'Wingdings', '□'], ['', 'Wingdings', '✓'], ['o', 'Courier New', '○']]) {
    const { markers } = await docxMarker(glyph, font);
    assert.deepEqual(markers, [want, want], `${font} U+${glyph.codePointAt(0).toString(16)} (already has a UEB sign)`);
  }
});

test('IMP-W7 (Word, end to end): an arrow-bullet list braille as a transcriber-defined symbol in BANA, the ordinary bullet in UKAAF', async () => {
  const { model } = await docxMarker('', 'Wingdings');
  const b = formatDocument({ title: null, blocks: [...model.blocks, { type: 'sympage', auto: true }] }, bana());
  assert.ok(lines(b).includes(at(';?', 'Apples')), lines(b).join('\n'));
  assert.deepEqual(symLines(b).length, 1);
  const u = formatDocument({ title: null, blocks: model.blocks }, ukaaf({ listStyle: 'spaced' }));
  assert.ok(lines(u).includes(at('_4', 'Apples')), lines(u).join('\n'));
});

test('IMP-W7 (RTF): an en dash / arrow list-text bullet keeps its glyph', () => {
  const rtf = (g) => `{\\rtf1{\\pard{\\listtext\\f3 ${g}\\tab}Apple\\par}{\\pard{\\listtext\\f3 ${g}\\tab}Pear\\par}}`;
  for (const [g, want] of [[`\\u8211?`, DASH], [`\\u10146?`, ARROW]]) {
    const m = parseRtf(rtf(g));
    assert.deepEqual(m.blocks.find((b) => b.type === 'list').items.map((i) => i.marker), [want, want], g);
  }
});

// ---- Save and reopen ----
test('IMP-W7: a saved NIMAS file keeps the custom bullet, and reopening gives the same braille', async () => {
  const model = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'Chapter' }, list(ARROW, 'Apples', 'Pears'), list(DASH, 'Plums')] };
  const before = formatDocument(model, bana());
  const xml = exportToNimasXml(model);
  const reopened = parseDtbook(xml);
  const after = formatDocument({ title: reopened.title, blocks: reopened.blocks }, bana());
  assert.equal(after, before);
});

test('IMP-W7: the formatter and the reader/save agree on what a custom bullet is', () => {
  for (let cp = 0x20; cp < 0x3000; cp++) {
    const ch = String.fromCodePoint(cp);
    assert.equal(!!customBulletGlyph(ch), isCustomBulletMarker(ch), `U+${cp.toString(16)}`);
  }
  for (const cp of [0x2B50, 0x1F449, 0x1F4A1]) assert.equal(!!customBulletGlyph(String.fromCodePoint(cp)), isCustomBulletMarker(String.fromCodePoint(cp)));
  assert.ok(isBulletMarker(ARROW) && !isNonDotBulletMarker(ARROW), 'a custom bullet is a bullet (so a list of them is a bullet list) but is kept by class, not written into the item text');
  for (const dot of ['\u2022', '\u25E6', '\u25AA', '\u25CF', '\u00B7', '*']) assert.ok(!isCustomBulletMarker(dot), dot);
  for (const not of ['A', '1', '1.', '(a)', '']) assert.ok(!isBulletMarker(not), `${not} is an ordinary marker, not a bullet`);
});
