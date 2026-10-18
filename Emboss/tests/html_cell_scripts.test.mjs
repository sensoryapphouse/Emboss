// Import fix list #54 (found by the Markdown agent, 1 Oct 2026): a plain HTML table cell holding a subscript or superscript
// (<td>H<sub>2</sub>O</td>) came in as "H2O" — the cell's flat text was used and the level markers (format/text-style.mjs
// SCRIPT_MARKS) were lost, so the braille read "H2O" as the number 2 between two letters. A paragraph and a formatted cell
// kept them. Now a plain cell keeps them too, as the Markdown, Word and DTBook readers do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml } from '../input/parse.mjs';
import { SCRIPT_MARKS as M } from '../format/text-style.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const H2O = `H${M.subOpen}2${M.end}O`, X2 = `x${M.supOpen}2${M.end}`;
const text = (v) => (v && typeof v === 'object' ? v.text : v);

test('#54: a plain cell keeps its subscript and superscript levels; a formatted cell still does', () => {
  const t = parseHtml(`<table><tr><th>Formula</th><th>Power</th><th>Both</th></tr><tr><td>H<sub>2</sub>O</td><td>${'x<sup>2</sup>'}</td><td>x<sup>2</sup> <b>bold</b></td></tr></table>`).blocks.find((b) => b.type === 'table');
  assert.equal(text(t.rows[0][0]), H2O);
  assert.equal(text(t.rows[0][1]), X2);
  assert.equal(text(t.rows[0][2]), `${X2} bold`);
});

test('#54: a header cell keeps its level too; a cell with no script is unchanged', () => {
  const t = parseHtml('<table><tr><th>CO<sub>2</sub></th><th>Plain</th></tr><tr><td>a</td><td>b c</td></tr></table>').blocks.find((b) => b.type === 'table');
  assert.equal(text(t.headers[0]), `CO${M.subOpen}2${M.end}`);
  assert.equal(text(t.headers[1]), 'Plain');
  assert.equal(text(t.rows[0][1]), 'b c');
});
