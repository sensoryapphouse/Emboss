// Table editing shows real formatting in cells, and warns when a table is too wide for
// columns (G15). Three things are covered here:
//  - format/cell-dom.mjs: segments <-> the small HTML string a contenteditable table cell
//    shows and edits (segmentsToCellHtml/cellHtmlToSegments/cellFromEditableHtml).
//  - format/document.mjs's tableLayout: the layout formatTable actually uses for a table
//    ('columnar', or the over-wide fallback), shared with formatTable itself.
//  - source checks that the editor uses contenteditable cells (not <input>) and shows the
//    too-wide warning badge, since editor.mjs itself only runs in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  segmentsToCellHtml, cellHtmlToSegments, cellToEditableHtml, cellFromEditableHtml,
} from '../format/cell-dom.mjs';
import { formatBlock, tableLayout } from '../format/document.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// The chip's own rendered/visible content (after its opening tag's attributes, which
// include the escaped *original* MathML in data-mathml — assertions about what actually
// renders must look past that, not the whole span).
const chipContent = (html) => /<span class="cell-(?:math|noteref)-chip"[^>]*>([\s\S]*?)<\/span>/.exec(html)[1];

// ---- segments <-> cell HTML --------------------------------------------------------

test('segmentsToCellHtml renders real tags, not markup characters', () => {
  const html = segmentsToCellHtml([
    { type: 'text', text: 'plain ' },
    { type: 'text', text: 'bold', tf: 4 },
    { type: 'text', text: ' and ', tf: 0 },
    { type: 'text', text: 'italic-underline', tf: 3 },
    { type: 'text', text: ' code', uncontracted: true },
  ]);
  assert.doesNotMatch(html, /[*_`]/, 'no markdown-style markup characters leak into the DOM');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em><u>italic-underline<\/u><\/em>/);
  assert.match(html, /<span class="cell-code"> code<\/span>/);
});

test('a maths segment becomes an atomic, non-editable chip that keeps its MathML', () => {
  const html = segmentsToCellHtml([{ type: 'math', latex: 'x+1', mathml: '<m:math><m:mi>x</m:mi></m:math>' }]);
  assert.match(html, /class="cell-math-chip"/);
  assert.match(html, /contenteditable="false"/);
  assert.match(html, /data-latex="x\+1"/);
  const back = cellHtmlToSegments(html);
  assert.deepEqual(back, [{ type: 'math', latex: 'x+1', mathml: '<m:math><m:mi>x</m:mi></m:math>' }]);
});

// ---- maths chip rendering: un-prefixed MathML, Chrome's native renderer (G15 follow-up) --

test('a maths chip renders un-prefixed MathML — the form Chrome recognises as foreign content', () => {
  const mathml = '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML" alttext="x+1" altimg="math.png">'
    + '<m:mrow><m:mi>x</m:mi><m:mo>+</m:mo><m:mn>1</m:mn></m:mrow></m:math>';
  const html = segmentsToCellHtml([{ type: 'math', latex: 'x+1', mathml }]);
  // The rendered content is bare (no m: prefix, no dangling xmlns:m) …
  const rendered = chipContent(html);
  assert.match(rendered, /<math\b[^>]*><mrow><mi>x<\/mi><mo>\+<\/mo><mn>1<\/mn><\/mrow><\/math>/);
  assert.doesNotMatch(rendered, /<m:math|xmlns:m/, 'the rendered copy carries no m: prefix or namespace declaration');
  // … but data-mathml keeps the *original*, unprocessed MathML exactly, for the save.
  assert.match(html, /data-mathml="&lt;m:math xmlns:m=/);
  const back = cellHtmlToSegments(html);
  assert.equal(back[0].mathml, mathml, 'the saved segment gets the original, unprocessed MathML back');
});

test('a maths chip carries an aria-label/title with the LaTeX, for screen readers and hover', () => {
  const html = segmentsToCellHtml([{ type: 'math', latex: 'x+1', mathml: '<math><mi>x</mi></math>' }]);
  assert.match(html, /aria-label="equation x\+1"/);
  assert.match(html, /title="equation x\+1"/);
});

test('a maths chip without LaTeX falls back to the MathML\'s own alttext for its label', () => {
  const html = segmentsToCellHtml([{ type: 'math', mathml: '<m:math alttext="x plus 1"><m:mi>x</m:mi></m:math>' }]);
  assert.match(html, /aria-label="equation x plus 1"/);
});

test('a maths chip falls back to the LaTeX text when there is no MathML', () => {
  const html = segmentsToCellHtml([{ type: 'math', latex: 'y-2' }]);
  assert.doesNotMatch(html, /<math[\s>]/, 'no <math> element when the segment has no MathML');
  assert.match(html, />y-2<\/span>/);
});

test('a maths chip falls back to the LaTeX text when the MathML is malformed', () => {
  const html = segmentsToCellHtml([{ type: 'math', latex: 'z', mathml: '<m:math><m:mi>unterminated' }]);
  assert.doesNotMatch(html, /<math[\s>]/);
  assert.match(html, />z<\/span>/);
});

test('a maths chip strips a script smuggled through an HTML-integration-point annotation', () => {
  const html = segmentsToCellHtml([{
    type: 'math', latex: 'bad',
    mathml: '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>',
  }]);
  assert.doesNotMatch(html, /<script/i, 'no <script> ever reaches the rendered chip content');
  // Sanitising leaves nothing usable inside <math>…</math>, so it falls back to the LaTeX text.
  assert.doesNotMatch(html, /<math[\s>][^<]*<\/math>|<math><\/math>/);
  assert.match(html, />bad<\/span>/);
  // The original (still escaped, never executed) is kept in data-mathml for the round trip.
  assert.match(html, /data-mathml="&lt;math&gt;&lt;annotation-xml/);
});

test('a maths chip strips inline event-handler attributes from the MathML it renders', () => {
  const html = segmentsToCellHtml([{ type: 'math', latex: 'x', mathml: '<math><mi onmouseover="alert(1)">x</mi></math>' }]);
  const rendered = chipContent(html);
  assert.doesNotMatch(rendered, /onmouseover/);
  assert.match(rendered, /<math\b[^>]*><mi>x<\/mi><\/math>/);
});

test('cellHtmlToSegments skips over nested MathML markup inside the chip without misparsing it as cell tags', () => {
  const mathml = '<m:math><m:mrow><m:mi>x</m:mi></m:mrow></m:math>';
  const html = segmentsToCellHtml([
    { type: 'text', text: 'before ' },
    { type: 'math', latex: 'x', mathml },
    { type: 'text', text: ' after', tf: 4 },
  ]);
  const back = cellHtmlToSegments(html);
  assert.deepEqual(back, [
    { type: 'text', text: 'before ' },
    { type: 'math', latex: 'x', mathml },
    { type: 'text', text: ' after', tf: 4 },
  ]);
});

test('a note reference becomes a chip and keeps its idref/annoref', () => {
  const html = segmentsToCellHtml([{ type: 'noteref', text: '1', idref: 'n1', annoref: true }]);
  assert.match(html, /class="cell-noteref-chip"/);
  const back = cellHtmlToSegments(html);
  assert.deepEqual(back, [{ type: 'noteref', text: '1', idref: 'n1', annoref: true }]);
});

test('bold/italic/underline round-trip through the HTML in every combination', () => {
  for (let tf = 0; tf < 8; tf++) {
    const segs = [{ type: 'text', text: 'x', ...(tf ? { tf } : {}) }];
    const back = cellHtmlToSegments(segmentsToCellHtml(segs));
    assert.deepEqual(back, segs, `tf=${tf}`);
  }
});

test('editing without any formatting round-trips through cellToEditableHtml/cellFromEditableHtml', () => {
  assert.equal(cellFromEditableHtml(cellToEditableHtml('plain text')), 'plain text');
  // A literal markup character must not be misread once other code (cellToMarkup, the
  // markdown/HTML export) reads this cell back — cellFromSegments keeps it as an object.
  const withStar = cellFromEditableHtml(cellToEditableHtml('5 * 3'));
  assert.deepEqual(withStar, { text: '5 * 3', segments: [{ type: 'text', text: '5 * 3' }] });
});

test('cellFromEditableHtml keeps an unedited maths chip\'s MathML exactly', () => {
  const cell = { text: 'x+1', segments: [{ type: 'math', latex: 'x+1', mathml: '<m:math/>' }] };
  const html = cellToEditableHtml(cell);
  // The user edits unrelated text elsewhere in the same cell; the chip itself is untouched.
  const edited = html + segmentsToCellHtml([{ type: 'text', text: ' more' }]);
  const result = cellFromEditableHtml(edited);
  assert.equal(result.segments[0].mathml, '<m:math/>', 'MathML survives an edit to the rest of the cell');
  assert.equal(result.segments[1].text, ' more');
});

// ---- tableLayout: shares formatTable's own width computation (G15) -----------------

const opts = (mode, width) => ({ mode, width, depth: 25, translate: (s) => String(s) });

test('a narrow table lays out as columnar in both modes', () => {
  const block = { type: 'table', headers: ['Name', 'Age'], rows: [['Ann', '3'], ['Bob', '5']] };
  assert.equal(tableLayout(block, opts('bana', 30)), 'columnar');
  assert.equal(tableLayout(block, opts('ukaaf', 30)), 'columnar');
});

// Same fixture as tests/table_no_word_division.test.mjs: long, undividable words that
// cannot fit even squeezed to the 2-cell minimum (fitColumnWidths, A27b).
const wideBlock = {
  type: 'table', format: 'columnar',
  headers: ['Substance', 'Formula', 'Classification'],
  rows: [
    ['Hydrochlorofluorocarbon', 'CHClF2 refrigerant gas', 'Ozone-depleting'],
    ['Polytetrafluoroethylene', 'C2F4 polymer', 'Fluoropolymer'],
  ],
};

test('a table too wide for columns falls back to listed (BANA) / paragraph (UKAAF), matching formatTable', () => {
  assert.equal(tableLayout(wideBlock, opts('bana', 30)), 'listed');
  assert.equal(tableLayout(wideBlock, opts('ukaaf', 30)), 'paragraph');
  // tableLayout must never disagree with what formatBlock (formatTable) actually renders.
  const banaLines = formatBlock(wideBlock, opts('bana', 30));
  assert.ok(banaLines.some((l) => l.includes('@.<')), 'BANA fallback carries its transcriber\'s note');
  const ukaafLines = formatBlock(wideBlock, opts('ukaaf', 30));
  assert.ok(ukaafLines.some((l) => l.toLowerCase().includes('paragraph form')), 'UKAAF fallback names paragraph form');
});

test('an explicit listed table reports listed regardless of width', () => {
  const block = { type: 'table', format: 'listed', headers: ['Name', 'Age'], rows: [['Ann', '3']] };
  assert.equal(tableLayout(block, opts('bana', 30)), 'listed');
});

test('a table with no columns is columnar (nothing to warn about)', () => {
  assert.equal(tableLayout({ type: 'table', headers: [], rows: [] }, opts('bana', 30)), 'columnar');
});

// ---- editor source checks (editor.mjs only runs in a browser) ----------------------

test('the editor uses contenteditable table cells, not <input>, and shows the too-wide badge', () => {
  const src = fs.readFileSync(path.join(here, '../web/editor/editor.mjs'), 'utf8');
  assert.match(src, /contentEditable = 'true'/, 'table cells are contenteditable');
  assert.match(src, /'table-cell-input/, 'the cell class name is kept for existing CSS/linking hooks');
  assert.doesNotMatch(src, /input\.className = 'table-cell-input/, 'no more <input> cell construction');
  assert.match(src, /table-warn-badge/, 'the too-wide warning badge is built');
  assert.match(src, /tableLayout\(/, 'the badge is driven by tableLayout, sharing formatTable\'s width logic');
  assert.match(src, /cellToEditableHtml|cellFromEditableHtml|cellHtmlToSegments/, 'cell content goes through format/cell-dom.mjs');
});

test('the editor CSS styles the rich cell, its chips and the warning badge in both themes', () => {
  const src = fs.readFileSync(path.join(here, '../web/editor/index.html'), 'utf8');
  assert.match(src, /\.table-cell-input\s*\{/);
  assert.match(src, /\.cell-math-chip/);
  assert.match(src, /\.table-warn-badge/);
  assert.match(src, /:root\.dark \.table-warn-badge|:root:not\(\.light\) \.table-warn-badge/, 'the badge has a dark-theme variant');
});
