// Finding F-4 — BANA Formats 2016 §11: a table's HEADING (its own title, §11.3.1a,
// centred) vs its CAPTION (§11.2.8, an explanatory blurb, 7-5 margins, never centred);
// where the heading sits relative to an enclosing box's top line (§11.3.1b/c/d); and the
// related column gap (BANA 11.2.5b: two blank cells; the one-cell narrowing once read from the
// gold §11 samples, F-10/Q-7, was withdrawn in K33 — a text-dump artefact). Standard first: every rule used below is
// quoted from `Emboss/docs/standards-map.md`/`standards-findings.md`, both of which cite the
// line numbers in `references/_text/braille-formats-2016.txt`.
//
// Before this fix: formatTable's own centred-title code path (block.title) was reachable
// only from a unit test that set `.title` by hand — no parser/editor code path ever set it
// on a real table, so every real caption/heading took formatCaption's 7-5, non-centred path
// regardless of which BANA meant (standards-findings.md F-4). This file tests the REAL code
// paths that now set/read it: formatBlock/traceBlock (document.mjs) for rendering parity,
// and parseTable/exportToNimasXml (parse.mjs/nimas-export.mjs) for the round trip — not a
// reimplemented stand-in (see F-5, about the editor's own TableNode: the real editor.mjs
// cannot be imported under plain Node — it uses browser-style absolute imports resolved by
// the app's own dev server — so its TableNode.__title/__titlePosition plumbing is reviewed
// by hand against the identical getFormat/setFormat/decorate/exportJSON pattern it mirrors,
// not unit-tested here; this is a pre-existing constraint on that file, not one this fix
// introduces or should paper over with a mock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, formatDocument, traceBlock } from '../format/document.mjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (width = 40) => ({
  mode: 'bana', standard: 'bana', width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const findTable = (blocks) => {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'table') return b;
    if (Array.isArray(b.blocks)) { const r = findTable(b.blocks); if (r) return r; }
  }
  return null;
};

// BANA 11.3.1a: "Center table headings."
test('F-4: block.title centres a table heading (unboxed)', () => {
  const block = { type: 'table', title: 'Vocabulary Terms Table', headers: ['A', 'B'], rows: [['1', '2']] };
  const lines = clean(formatBlock(block, opts()));
  assert.ok(lines.some((l) => l.trim() === 'VOCABULARY TERMS TABLE' && l.startsWith('  ')),
    `heading should be centred, not left-blocked: ${JSON.stringify(lines)}`);
});

// BANA 11.2.8b: "Use 7-5 margins" for a caption — never centred. block.caption set directly
// on the table object (the legacy dual-purpose field F-4 found) must take the CAPTION
// treatment, not the heading one — this is the actual bug F-4 reported (formatTable's
// formatTitle used to read `block.title || block.caption` and always centre either).
test('F-4: block.caption on the table object is NOT centred (regression for the bug F-4 found)', () => {
  const block = { type: 'table', caption: 'An explanatory note about the table.', headers: ['A', 'B'], rows: [['1', '2']] };
  const lines = clean(formatBlock(block, opts()));
  assert.ok(!lines.some((l) => l.trim() === 'AN EXPLANATORY NOTE ABOUT THE TABLE.' && l.startsWith('  ')),
    `a caption on the table object must not take the centred heading path: ${JSON.stringify(lines)}`);
  // Nothing renders it at all (a real caption is the standalone 'caption' sibling block,
  // never a field read off the table by formatTable) — confirms the fallback was removed,
  // not merely reformatted.
  assert.ok(!lines.some((l) => l.includes('EXPLANATORY')), JSON.stringify(lines));
});

// BANA Example 11-4 ("Table 9.5" / "Smoking Among Americans by Age and Sex"): a heading with
// more than one hard print line break centres EACH line independently and never joins them,
// even where they'd fit together (gold-verified, BANA Sample 11-2 the same way).
test('F-4: a multi-line block.title (array) centres each print line independently', () => {
  const block = { type: 'table', title: ['Table 9.5', 'Smoking'], headers: ['A'], rows: [['1']] };
  const lines = clean(formatBlock(block, opts()));
  const t1 = lines.findIndex((l) => l.trim() === 'TABLE 9.5');
  const t2 = lines.findIndex((l) => l.trim() === 'SMOKING');
  assert.ok(t1 >= 0 && t2 === t1 + 1, `each print line its own centred line, in order: ${JSON.stringify(lines)}`);
});

// BANA 11.3.1b/c/d: "Follow print for the placement of table headings ... which may be
// before or after a top box line ... Do not leave a blank line between a table heading and
// a following box line [or] between a box line and a following table heading." Gold-
// verified: BANA Sample 11-4 places the heading AFTER the top box line (titlePosition
// 'in-box', the default), no blank either side of the border.
test("F-4: titlePosition 'in-box' (default) puts the heading right after the top box line, no blank either side", () => {
  const block = { type: 'box', blocks: [{ type: 'table', title: 'Minimum Viable Population Levels', titlePosition: 'in-box', headers: ['A'], rows: [['1']] }] };
  const lines = clean(formatBlock(block, opts()));
  const topIdx = lines.findIndex((l) => /^7+$/.test(l));
  assert.ok(topIdx >= 0, `top box line expected: ${JSON.stringify(lines)}`);
  assert.equal(lines[topIdx + 1].trim(), 'MINIMUM VIABLE POPULATION LEVELS', JSON.stringify(lines));
  assert.notEqual(lines[topIdx + 1], '', 'no blank line between the top box line and the heading');
});

// Gold-verified: BANA Sample 11-26 ("Vietnam War") places its heading BEFORE the top box
// line, again with no blank between them either side.
test("F-4: titlePosition 'before-box' hoists the heading out, ahead of the top box line, no blank either side", () => {
  const block = { type: 'box', blocks: [{ type: 'table', title: 'Vietnam War', titlePosition: 'before-box', headers: ['A'], rows: [['1']] }] };
  const lines = clean(formatBlock(block, opts()));
  const titleIdx = lines.findIndex((l) => l.trim() === 'VIETNAM WAR');
  const topIdx = lines.findIndex((l) => /^7+$/.test(l));
  assert.ok(titleIdx >= 0 && topIdx === titleIdx + 1, `heading immediately before the top box line, no blank: ${JSON.stringify(lines)}`);
  // The table's own internal rendering must not also render the (already-hoisted) title a
  // second time inside the box.
  assert.equal(lines.filter((l) => l.trim() === 'VIETNAM WAR').length, 1, JSON.stringify(lines));
});

// formatBlock/traceBlock parity (the project's own rule): every case above must trace
// identically, character for character — using the real formatTable/formatBox/traceTable
// code paths this fix changed, not a mirror written only for this test.
test('F-4: formatBlock and traceBlock agree for in-box and before-box headings', () => {
  for (const titlePosition of ['in-box', 'before-box']) {
    const block = { type: 'box', blocks: [{ type: 'table', title: ['Table 9.5', 'Long Title Here'], titlePosition, headers: ['A', 'B'], rows: [['1', '2']] }] };
    const formatted = clean(formatBlock(block, opts()));
    const traced = clean(traceBlock(block, opts(), false, 0).map((t) => t.s));
    assert.deepEqual(traced, formatted, `${titlePosition}: ${JSON.stringify({ formatted, traced })}`);
  }
});

// --- Gutter (BANA 11.2.5b; K33) -------------------------------------------------------

// BANA 11.2.5b: "Each column is separated from a following column by two blank cells" — on
// every line. K33 (26 Sep 2026): these tests used to pin a gutter narrowed to one cell where
// an entry or its guide dots filled the column (F-10/Q-7, read from Example 11-2 and Sample
// 11-1); that reading came from a gold transcription taken from a text dump that had
// collapsed two blank cells to one. The book's page images show two cells (Example 11-2
// `"mosquito  #cj  "ds`, Sample 11-1 `,daily """""""""  #e4ci.0`); transcriber KD confirms.
test('11.2.5b: two blank cells after an entry that exactly fills its column (K33)', () => {
  const block = { type: 'table', headers: ['Animal', 'X'], rows: [['mosquito', 'a'], ['gorilla', 'b']] };
  const lines = clean(formatBlock(block, opts(30)));
  // "MOSQUITO" (8 cells) exactly fills column 1 — still two cells before column 2's "A".
  assert.ok(lines.some((l) => l.startsWith('MOSQUITO  A')), JSON.stringify(lines));
  // "GORILLA" (7 cells) pads one cell to the column's width, then the two-cell gap: "B" lines up under "A".
  assert.ok(lines.some((l) => l.startsWith('GORILLA   B')), JSON.stringify(lines));
});

test('11.2.5b / 11.6.1f: two blank cells after a guide-dot run that reaches the column edge (K33)', () => {
  // Column 1's width (12) is set by "SEMIANNUALLY", so "DAILY" is followed by a guide-dot run to the column's edge.
  const block = { type: 'table', headers: [], rows: [['Daily', '10'], ['Semiannually', '20']] };
  const lines = clean(formatBlock(block, opts(30)));
  const row = lines.find((l) => l.startsWith('DAILY'));
  assert.ok(row, JSON.stringify(lines));
  const dotsThenNum = row.match(/"+ +1/);
  assert.ok(dotsThenNum, `expected a guide-dot run then the number: ${JSON.stringify(row)}`);
  assert.equal(dotsThenNum[0].replace(/"+/, ''), '  1', `exactly two blank cells between the guide dots and the number: ${JSON.stringify(row)}`);
  assert.equal(row.indexOf('#') < 0 ? row.indexOf('1') : row.indexOf('#'), lines.find((l) => l.startsWith('SEMIANNUALLY')).indexOf('2'), 'both rows start column 2 in the same cell');
});

test('11.4.2b / 11.2.5b: the separation line runs are two blank cells apart (K33)', () => {
  const block = { type: 'table', headers: ['Name', 'Age'], rows: [['Ann', '3'], ['Bob', '5']] };
  const lines = clean(formatBlock(block, opts(30)));
  assert.ok(lines.some((l) => l === '"333  "33'), `expected a two-cell gap in the separator line: ${JSON.stringify(lines)}`);
});

test('11.2.5b: formatBlock and traceBlock agree on the two-cell gutter', () => {
  const block = { type: 'table', headers: ['Animal', 'X'], rows: [['mosquito', 'a'], ['gorilla', 'b']] };
  const formatted = clean(formatBlock(block, opts(30)));
  const traced = clean(traceBlock(block, opts(30), false, 0).map((t) => t.s));
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

// --- Round trip (parse.mjs / nimas-export.mjs) -----------------------------------------

// BANA 11.3.1a vs 11.2.8: a <caption class="bana-heading"> is this table's HEADING (block
// .title, centred formatTitle path); a plain <caption> (no class) stays its CAPTION
// (standalone 'caption' block, 7-5, never centred) — real parseTable/exportToNimasXml, the
// code this fix actually changed (not a reimplementation).
test('F-4: <caption class="bana-heading"> round-trips to block.title, not a sibling caption block', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <table>
      <caption class="bana-heading">Table 9.5<br/>Smoking Among Americans</caption>
      <thead><tr><th>A</th></tr></thead>
      <tbody><tr><td>1</td></tr></tbody>
    </table>
  </level1></bodymatter></book>
</dtbook>`;
  const doc = parseDtbook(xml);
  const tbl = findTable(doc.blocks);
  assert.ok(tbl, 'table block found');
  assert.deepEqual(tbl.title, ['Table 9.5', 'Smoking Among Americans'], JSON.stringify(tbl));
  assert.equal(tbl.titlePosition, 'in-box', JSON.stringify(tbl));
  assert.ok(!doc.blocks.some((b) => b.type === 'caption'), 'no sibling caption block for a heading');

  const xml2 = exportToNimasXml(doc);
  assert.ok(xml2.includes('<caption class="bana-heading">Table 9.5<br/>Smoking Among Americans</caption>'), xml2);
});

test('F-4: <caption class="bana-heading bana-heading-before-box"> round-trips titlePosition', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <sidebar render="required">
      <table>
        <caption class="bana-heading bana-heading-before-box">Vietnam War</caption>
        <thead><tr><th>A</th></tr></thead>
        <tbody><tr><td>1</td></tr></tbody>
      </table>
    </sidebar>
  </level1></bodymatter></book>
</dtbook>`;
  const doc = parseDtbook(xml);
  const tbl = findTable(doc.blocks);
  assert.equal(tbl.title, 'Vietnam War', JSON.stringify(tbl));
  assert.equal(tbl.titlePosition, 'before-box', JSON.stringify(tbl));

  const xml2 = exportToNimasXml(doc);
  assert.ok(xml2.includes('<caption class="bana-heading bana-heading-before-box">Vietnam War</caption>'), xml2);
});

// A plain <caption> (no class) is unaffected — the pre-existing caption behaviour (F-3's
// ordering, formatCaption's 7-5 margins) must still work exactly as before this fix.
test('F-4: a plain <caption> (no class) still parses as a standalone caption block, unchanged', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <table>
      <caption>An explanatory note.</caption>
      <thead><tr><th>A</th></tr></thead>
      <tbody><tr><td>1</td></tr></tbody>
    </table>
  </level1></bodymatter></book>
</dtbook>`;
  const doc = parseDtbook(xml);
  const tbl = findTable(doc.blocks);
  assert.equal(tbl.title, undefined, JSON.stringify(tbl));
  const capIdx = doc.blocks.findIndex((b) => b.type === 'caption');
  const tblIdx = doc.blocks.findIndex((b) => b.type === 'table');
  assert.ok(capIdx >= 0 && capIdx < tblIdx, 'caption block precedes the table, per BANA 11.2.8a');
  assert.equal(doc.blocks[capIdx].text, 'An explanatory note.');
});

// End-to-end: formatDocument on the round-tripped 'in-box' document actually centres the
// heading right after the box's top line (ties parse.mjs's signal to document.mjs's
// rendering, not just the intermediate AST shape).
test('F-4: end-to-end — a class-signalled heading renders centred, in-box, after parse+format', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <sidebar render="required">
      <table>
        <caption class="bana-heading">Populations</caption>
        <thead><tr><th>A</th></tr></thead>
        <tbody><tr><td>1</td></tr></tbody>
      </table>
    </sidebar>
  </level1></bodymatter></book>
</dtbook>`;
  const doc = parseDtbook(xml);
  const brf = formatDocument(doc, { ...opts(), suppressHeader: true });
  const lines = brf.split('\r\n');
  const topIdx = lines.findIndex((l) => /^7+$/.test(l));
  assert.ok(topIdx >= 0, JSON.stringify(lines));
  assert.equal(lines[topIdx + 1].trim(), 'POPULATIONS', JSON.stringify(lines));
});

// --- 11.4.3a overhang (Change 2, Paul's decision 17 Sep 2026) --------------------------
//
// BANA Formats 2016 §11.4.3a: "Insert a separation line after the primary heading. The
// line starts at the left margin of the primary and secondary sub-column headings and
// ends at the right margin of the last sub-column. The separation line is the width of
// the primary heading when it is wider than all of the sub-column headings."
//
// Before this fix, `computeTableColumns` always widened the group's own last sub-column
// (via a "widestWord" shortfall) whenever a primary heading was wider than its span — the
// sub-columns beneath were never left alone. Paul's decision: a primary heading wider than
// its span OVERHANGS unwrapped, without touching the sub-columns, whenever the whole table
// still fits the line with that overhang; the separation line then takes the heading's own
// (full, unwrapped) width, and the next column starts two cells after the wider of the
// heading and its span. Only when the overhang would not fit the page does the heading
// wrap within the span (the pre-existing behaviour, span widened only to its own widest
// word). No gold sample in this section has a primary heading wider than its own span
// (standards-findings.md F-12's own status update), so both branches below are
// synthetic, derived directly from the rule text — standards-questions.md carries the
// remaining open question to a transcriber.
test('11.4.3a: an overhanging primary heading stays unwrapped when the whole table still fits', () => {
  const block = {
    type: 'table',
    headerGroups: [{ text: 'Overhanging Heading', from: 0, to: 1 }],
    headers: ['X', 'Y', 'Z'],
    rows: [['1', '22', 'zz']],
  };
  const lines = clean(formatBlock(block, opts(40)));
  assert.deepEqual(lines, [
    '',
    'OVERHANGING HEADING',
    '"333333333333333333',
    'X  Y                 Z',   // K33: two cells between X and Y (11.2.5b), so the span is the 5 cells the plan counts
    '"  "3                "3',
    '1  22                ZZ',
    '',
  ], JSON.stringify(lines));
  // The separation line is exactly the heading's own (unwrapped) width, per 11.4.3a.
  assert.equal(lines[2].length, 'OVERHANGING HEADING'.length, JSON.stringify(lines));
  // The un-grouped column ("Z"/"ZZ") starts at the same cell on every row after the
  // group (sub-tier heading row and data row alike) — two cells after the overhang
  // padding ends: "heading width + 2" (K33: every column gap is two cells, 11.2.5b, so the
  // group's span is exactly the width the plan counts). The overhang is never guide-dotted,
  // and every row after the group lines up with every other row.
  assert.equal(lines[3].indexOf('Z'), lines[5].indexOf('ZZ'), 'column Z lines up between the heading row and the data row');
  assert.equal(lines[3].indexOf('Z'), 'OVERHANGING HEADING'.length + 2, 'column Z starts two cells after the overhanging heading (K33)');
  assert.ok(!/["]/.test(lines[3].slice(lines[3].indexOf('Y') + 1, lines[3].indexOf('Z'))), 'the overhang padding itself is plain blank, never guide-dotted (11.6.1g\'s reasoning)');
  // The sub-columns themselves are untouched: column 0 ("X"/"1") and column 1 ("Y"/"22")
  // keep their own natural widths (1 and 2), never widened for the heading's sake.
  assert.ok(lines[3].startsWith('X  Y'), JSON.stringify(lines));
});

test('11.4.3a: an overhanging primary heading wraps within its span when the overhang would not fit the page', () => {
  const block = {
    type: 'table',
    headerGroups: [{ text: 'Overhanging Heading', from: 0, to: 1 }],
    headers: ['X', 'Y'],
    rows: [['1', '22']],
  };
  const lines = clean(formatBlock(block, opts(15)));
  assert.deepEqual(lines, [
    '',
    'OVERHANGING',
    'HEADING',
    '"3333333333',
    'X  Y',   // two cells between columns (11.2.5b, K33)
    '"  "3333333',
    '1  22',
    '',
  ], JSON.stringify(lines));
  // Wrapped within the span — never a single unwrapped 19-cell line at this width.
  assert.ok(!lines.some((l) => l === 'OVERHANGING HEADING'), JSON.stringify(lines));
  // The span (and hence every line's own width) widened only to the heading's own
  // widest word ("OVERHANGING", 11) — not the whole 19-cell unwrapped heading.
  assert.equal(lines[3].length, 1 + 10, JSON.stringify(lines));
});

test('11.4.3a: formatBlock and traceBlock agree for both the overhang and the wrap branch', () => {
  const overhangBlock = {
    type: 'table',
    headerGroups: [{ text: 'Overhanging Heading', from: 0, to: 1 }],
    headers: ['X', 'Y', 'Z'],
    rows: [['1', '22', 'zz']],
  };
  const wrapBlock = {
    type: 'table',
    headerGroups: [{ text: 'Overhanging Heading', from: 0, to: 1 }],
    headers: ['X', 'Y'],
    rows: [['1', '22']],
  };
  for (const [block, width] of [[overhangBlock, 40], [wrapBlock, 15]]) {
    const formatted = clean(formatBlock(block, opts(width)));
    const traced = clean(traceBlock(block, opts(width), false, 0).map((t) => t.s));
    assert.deepEqual(traced, formatted, JSON.stringify({ width, formatted, traced }));
  }
});
