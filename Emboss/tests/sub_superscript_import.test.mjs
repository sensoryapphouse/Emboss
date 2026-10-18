// Subscript and superscript from a Word file, end to end (Paul, 30 Sep 2026: "Subscript and superscript not
// supported"). The Word reader brackets a sub/superscript run with private-use markers (format/text-style.mjs
// SCRIPT_MARKS). Found: the markers were saved raw into the NIMAS file, a multi-letter run got a level sign that covered
// only its first symbol, and Word's raised space before a footnote number became a stray level sign.
// Rules of UEB 11.4.1 (a level sign covers the next item) and 3.4 (example: mass with subscript "sun" is
// ⠍⠁⠎⠎⠰⠰⠢⠣⠎⠥⠝⠜).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDocx, parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml, scriptMarkersToXml } from '../input/nimas-export.mjs';
import { styledTranslate, SCRIPT_MARKS as M } from '../format/text-style.mjs';
import { makeZip } from '../web/zip.mjs';
import { parseCellMarkup } from '../format/cell-markup.mjs';
import { segmentsToCellHtml, cellHtmlToSegments } from '../format/cell-dom.mjs';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const g2 = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const g1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const tr = styledTranslate(g2, 'faithful', g1);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text, va) => `<w:r>${va ? `<w:rPr><w:vertAlign w:val="${va}"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const docx = async (paras) => makeZip([{ name: 'word/document.xml', text: `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paras.map((p) => `<w:p>${p}</w:p>`).join('')}</w:body></w:document>` }]).arrayBuffer();

test('braille: a run that is one item keeps the level sign alone (RUEB 3.24.1: H2O, Wm)', () => {
  assert.equal(tr(`CO${M.subOpen}2${M.end}`), ',,CO;5#B');
  assert.equal(tr(`paper${M.supOpen}56${M.end} which`), 'PAP];9#EF :');
});

test('braille: a run of more than one item is grouped, the rest of its word in grade 1 (RUEB 3.4, 11.4.3)', () => {
  assert.equal(tr(`mass${M.subOpen}sun${M.end}`), 'MASS;;5<SUN>');                 // ⠍⠁⠎⠎⠰⠰⠢⠣⠎⠥⠝⠜
  assert.equal(tr(`x${M.supOpen}2y${M.end}`), ';;X9<#BY>');                           // ⠰⠰⠭⠔⠣⠼⠃⠽⠜
  assert.equal(tr(`Subscript${M.subOpen}Subscript${M.end}`), ',SUBSCRIPT;;5<,SUBSCRIPT>');
});

test('braille: a raised or lowered space is only a space', () => {
  assert.equal(tr(`guidance${M.supOpen} ${M.end}next`), tr('guidance next'));
});

test('Word import: sub/superscript runs are marked; a raised space is not', async () => {
  const m = await parseDocx(await docx([
    run('Subscript') + run('Subscript', 'subscript'),
    run('guidance') + run(' ', 'superscript') + run('next'),
  ]));
  assert.equal(m.blocks[0].text ?? m.blocks[0].segments.map((s) => s.text).join(''), `Subscript${M.subOpen}Subscript${M.end}`);
  const second = m.blocks[1].text ?? m.blocks[1].segments.map((s) => s.text).join('');
  assert.equal(second, 'guidance next');
});

test('save writes <sub>/<sup>, never the markers, and reopening reads them back', () => {
  const doc = { title: 'T', blocks: [{ type: 'para', text: `Subscript${M.subOpen}Subscript${M.end}` }, { type: 'para', text: `x${M.supOpen}2${M.end} and H${M.subOpen}2${M.end}O` }] };
  const xml = exportToNimasXml(doc, { title: 'T' });
  assert.doesNotMatch(xml, /[-]/);
  assert.match(xml, /Subscript<sub>Subscript<\/sub>/);
  assert.match(xml, /x<sup>2<\/sup> and H<sub>2<\/sub>O/);
  const back = parseDtbook(xml);
  const texts = back.blocks.map((b) => (b.segments ? b.segments.map((s) => s.text).join('') : b.text));   // the formatter reads segments when a block has them
  assert.ok(texts.includes(`Subscript${M.subOpen}Subscript${M.end}`), JSON.stringify(texts));
  assert.ok(texts.includes(`x${M.supOpen}2${M.end} and H${M.subOpen}2${M.end}O`), JSON.stringify(texts));
});

test('reopen: a superscript after italic text stays with its own text; a list item with a subscript stays one item', () => {
  const x = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><p>a<em>b</em><sup>2</sup></p><list type="ul"><li>CO<sub>2</sub> levels</li></list></level1></bodymatter></book></dtbook>`;
  const blocks = parseDtbook(x).blocks;
  assert.deepEqual(blocks[0].segments.map((s) => s.text), ['a', 'b', `${M.supOpen}2${M.end}`]);
  const item = blocks[1].items[0];
  assert.ok(!item.blocks, 'no extra paragraphs');
  assert.equal(item.segments ? item.segments.map((s) => s.text).join('') : item.text, `CO${M.subOpen}2${M.end} levels`);
});

test('save: markers across an inline tag stay properly nested; none left in attributes', () => {
  assert.equal(scriptMarkersToXml(`<p>x<em>${M.supOpen}2</em>${M.end} y</p>`), '<p>x<em><sup>2</sup></em> y</p>');
  assert.equal(scriptMarkersToXml(`<img alt="a${M.subOpen}b${M.end}"/>`), '<img alt="ab"/>');
  assert.equal(scriptMarkersToXml(`<p>a${M.supOpen} ${M.end}b</p>`), '<p>a b</p>');
});

test('a table cell keeps its sub/superscript markers, and escaped markup characters still come back (import audit, 30 Sep)', () => {
  const text = parseCellMarkup(`x${M.supOpen}2${M.end} and \\* star`).map((g) => g.text).join('');
  assert.equal(text, `x${M.supOpen}2${M.end} and * star`);   // was "x_2` and * star": cells parked escapes at U+E000 too
});

test('reopening a saved file with H2O raises no "word could not be loaded" warning (load check, 30 Sep)', () => {
  const xml = exportToNimasXml({ title: 'T', blocks: [{ type: 'para', text: `Water is H${M.subOpen}2${M.end}O.` }] }, { title: 'T' });
  const back = parseDtbook(xml);
  assert.ok(!(back.warnings || []).some((w) => /could not be loaded/i.test(String(w.message || w.text || w))), JSON.stringify(back.warnings));
});

test('an editor table cell shows sub/superscript as <sub>/<sup> and reads them back exactly (30 Sep)', () => {
  const segs = [{ type: 'text', text: `alphaCellsup${M.supOpen}2${M.end} and H${M.subOpen}2${M.end}O` }, { type: 'text', text: `bold${M.supOpen}x${M.end}`, tf: 4 }];
  const html = segmentsToCellHtml(segs);
  assert.equal(html, 'alphaCellsup<sup>2</sup> and H<sub>2</sub>O<strong>bold<sup>x</sup></strong>');
  assert.deepEqual(cellHtmlToSegments(html), segs);
});

test('an editor table cell shows strikethrough and keeps it when edited (import audit w19, 30 Sep)', () => {
  const segs = [{ type: 'text', text: 'plain ' }, { type: 'text', text: 'alphaCellstrike', transcriberTypeform: 'strike' }, { type: 'text', text: ' bold', tf: 4 }];
  const html = segmentsToCellHtml(segs);
  assert.equal(html, 'plain <s>alphaCellstrike</s><strong> bold</strong>');
  assert.deepEqual(cellHtmlToSegments(html), segs);
});
