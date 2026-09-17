// Table cells keep emphasis and maths (A25): parser → { text, segments }, exporter writes
// them as inline DTBook, the braille formatter and its cell trace agree, and the editor's
// cell markup round-trips (format/cell-markup.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { parseCellMarkup, cellSegments, cellPlainText, cellToMarkup, cellFromEdit, cellFromSegments } from '../format/cell-markup.mjs';

globalThis.DOMParser = DOMParser;

const SRC = `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><book><bodymatter><level1>
  <table><thead><tr><th><strong>Term</strong></th><th>Value</th></tr></thead>
  <tbody><tr><td>Area <em>A</em></td><td><m:math><m:mi>x</m:mi><m:mo>+</m:mo><m:mn>1</m:mn></m:math></td></tr>
  <tr><td>plain</td><td>5 * 3</td></tr></tbody></table>
</level1></bodymatter></book></dtbook>`;

test('parser keeps emphasis and maths in cells; plain cells stay strings', () => {
  const t = parseDtbook(SRC).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers[0], { text: 'Term', segments: [{ type: 'text', text: 'Term', tf: 4 }] });
  assert.equal(t.headers[1], 'Value');
  assert.equal(t.rows[0][0].segments[1].tf, 1);
  assert.equal(t.rows[0][1].segments[0].type, 'math');
  assert.equal(t.rows[1][0], 'plain');
  // A literal "*" would be misread as markup, so that cell is kept as an object.
  assert.deepEqual(t.rows[1][1], { text: '5 * 3', segments: [{ type: 'text', text: '5 * 3' }] });
});

test('exporter writes cell segments as inline DTBook and they survive a re-parse', () => {
  const doc = parseDtbook(SRC);
  const xml = exportToNimasXml(doc);
  assert.match(xml, /<th><strong>Term<\/strong><\/th>/);
  assert.match(xml, /<td>Area <em>A<\/em><\/td>/);
  assert.match(xml, /<td><m:math\b[\s\S]*?<\/m:math><\/td>/);
  assert.match(xml, /<td>5 \* 3<\/td>/);
  const again = parseDtbook(xml).blocks.find((b) => b.type === 'table');
  assert.deepEqual(again.rows[1], doc.blocks.find((b) => b.type === 'table').rows[1]);
  assert.equal(again.rows[0][1].segments[0].type, 'math');
});

test('editor markup: parse, escape and round-trip', () => {
  assert.deepEqual(parseCellMarkup('a **b** \\* $x$'), [
    { type: 'text', text: 'a ' }, { type: 'text', text: 'b', tf: 4 }, { type: 'text', text: ' * ' }, { type: 'math', latex: 'x' },
  ]);
  const cell = cellFromSegments('x+1 and 5*', [{ type: 'math', mathml: '<m:math/>', latex: 'x+1' }, { type: 'text', text: ' and 5*', tf: 1 }]);
  const markup = cellToMarkup(cell);
  assert.equal(markup, '$x+1$* and 5\\**');
  assert.equal(cellFromEdit(markup, cell), cell, 'unchanged markup keeps the object (and its MathML)');
  assert.equal(cellFromEdit(markup + '!', cell), markup + '!', 'an edit stores the markup string');
  assert.deepEqual(cellSegments(markup).map((g) => g.text ?? g.latex), ['x+1', ' and 5*']);
  assert.equal(cellPlainText(cell), 'x+1 and 5*');
  assert.equal(cellPlainText('**b** \\$'), 'b $');
  assert.equal(cellFromSegments('plain', null), 'plain');
});
