// Import fix list #4 (audit h04-head2): an HTML table's second <thead> row was dropped silently (only the first head row was
// read). The DTBook reader (parseTable) already reads both: two head rows of <th> where the first has a spanning cell are a
// two-tier heading (BANA 11.4.3: headerGroups over the column headings), and any other further head rows lead the body (A28),
// so no text is lost. The HTML reader now does the same; a merged heading cell repeats its text (IMP-W5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml, parseDtbook } from '../input/parse.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const table = (html) => parseHtml(html).blocks.find((b) => b.type === 'table');

test('#4: two <th> head rows with a spanning group heading are a two-tier heading (BANA 11.4.3), as the DTBook reader reads them', () => {
  const t = table('<table><thead><tr><th colspan="2">alphaGroup</th></tr><tr><th>alphaSub1</th><th>alphaSub2</th></tr></thead><tbody><tr><td>x1</td><td>x2</td></tr></tbody></table>');
  assert.deepEqual(t.headers, ['alphaSub1', 'alphaSub2']);
  assert.deepEqual(t.headerGroups, [{ text: 'alphaGroup', from: 0, to: 1 }]);
  assert.deepEqual(t.rows, [['x1', 'x2']]);
  const d = parseDtbook('<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><table><thead><tr><th colspan="2">alphaGroup</th></tr><tr><th>alphaSub1</th><th>alphaSub2</th></tr></thead><tbody><tr><td>x1</td><td>x2</td></tr></tbody></table></level1></bodymatter></book></dtbook>').blocks.find((b) => b.type === 'table');
  assert.deepEqual({ headers: t.headers, headerGroups: t.headerGroups, rows: t.rows }, { headers: d.headers, headerGroups: d.headerGroups, rows: d.rows });
});

test('#4: a heading that spans both head rows (rowspan) stands beside the group, over its own column', () => {
  const t = table('<table><thead><tr><th rowspan="2">Year</th><th colspan="2">Sales</th></tr><tr><th>North</th><th>South</th></tr></thead><tbody><tr><td>2020</td><td>1</td><td>2</td></tr></tbody></table>');
  assert.deepEqual(t.headers, ['Year', 'North', 'South']);
  assert.deepEqual(t.headerGroups, [{ text: 'Sales', from: 1, to: 2 }]);
});

test('#4: further head rows with no spanning heading lead the body, in order (nothing lost)', () => {
  const t = table('<table><thead><tr><th>A</th><th>B</th></tr><tr><th>a2</th><th>b2</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.deepEqual(t.headers, ['A', 'B']);
  assert.deepEqual(t.rows, [['a2', 'b2'], ['1', '2']]);
  assert.equal(t.headerGroups, undefined);
});

test('#4: a one-row <thead> is read as before', () => {
  const t = table('<table><thead><tr><th>A</th><th colspan="2">B</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>');
  assert.deepEqual(t.headers, ['A', 'B', 'B']);
  assert.deepEqual(t.rows, [['1', '2', '3']]);
});
