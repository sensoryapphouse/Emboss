// Equations must survive load → editor → save (G6 / A1).
//  - Parser: a list item that also contains a nested list keeps its own maths (14 equations
//    in 9781946636171NIMAS.xml were dropped), and a table cell keeps its maths and
//    emphasis as { text, segments } (A25; the 27 equations inside <td>/<th> were dropped).
//  - Editor (web/editor/editor.mjs): MathNode keeps the original MathML and saves it while
//    the equation is unedited; an edited equation is converted from LaTeX; a failed
//    conversion keeps the LaTeX instead of dropping the equation. editor.mjs cannot be
//    imported headless, so its logic is checked in the source (and verified in Chrome).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;
const here = path.dirname(fileURLToPath(import.meta.url));

const countMath = (xml) => (xml.match(/<(?:m:)?math\b/g) || []).length;

test('a list item with a sub-list keeps its maths', () => {
  const doc = parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><book><bodymatter><level1>
    <list type="ol"><li>Solve <m:math><m:mi>x</m:mi><m:mo>+</m:mo><m:mn>1</m:mn></m:math>
      <list type="ol"><li>then <m:math><m:mi>y</m:mi></m:math></li></list></li></list>
  </level1></bodymatter></book></dtbook>`);
  const list = doc.blocks.find((b) => b.type === 'list');
  const mathSegs = list.items.flatMap((i) => (i.segments || []).filter((s) => s.type === 'math'));
  assert.equal(mathSegs.length, 2, JSON.stringify(list.items));
  assert.equal(countMath(exportToNimasXml(doc)), 2);
});

test('9781946636171NIMAS.xml: every equation, including the 27 in table cells, survives parse → export', () => {
  const src = fs.readFileSync(path.join(here, 'nimas_samples', '9781946636171NIMAS.xml'), 'utf8');
  const dom = new DOMParser().parseFromString(src, 'text/xml');
  const inCells = [...dom.getElementsByTagName('m:math')].filter((m) => {
    for (let p = m.parentNode; p && p.nodeType === 1; p = p.parentNode) if (p.localName === 'td' || p.localName === 'th') return true;
    return false;
  }).length;
  assert.equal(countMath(src), 852);
  assert.equal(inCells, 27);
  assert.equal(countMath(exportToNimasXml(parseDtbook(src))), 852);
});

test('editor MathNode keeps the source MathML and only converts edited equations', () => {
  const ed = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  assert.match(ed, /getSourceMathml\(\)\s*\{[^}]*__latex === n\.__srcLatex/);
  assert.match(ed, /const source = child\.getSourceMathml\(\);/, 'nodeToRuns prefers the source MathML');
  assert.match(ed, /runs\.push\(mathml \? \{ type: 'math', mathml, latex \} : \{ type: 'math', latex \}\)/, 'a failed conversion keeps the LaTeX');
  assert.doesNotMatch(ed, /if \(mathml\) \{\s*runs\.push\(\{ type: 'math', mathml, latex \}\);/, 'the old drop-on-failure path is gone');
  assert.match(ed, /exportJSON\(\)\s*\{[\s\S]{0,200}j\.mathml = this\.__mathml/, 'undo history keeps the MathML');
  assert.match(ed, /if \(b\.type === 'math' && !b\.segments\)/, 'display maths inside a sidebar is loaded');
  assert.match(ed, /setLatex\(l\) \{ if \(l !== this\.getLatest\(\)\.__latex\)/, 'setting the same value is not an edit');
});
