// Finding F-39 — BANA Braille Formats 2016 §1.9:
//
//   1.9.2  "Use 3-1 margins for indented paragraphs."
//   1.9.3  "Use 1-1 margins for blocked paragraphs. A blank line precedes each blocked
//          paragraph, unless it follows a cell-5 or cell-7 heading."
//          Exception: "Use indented paragraphs when an entire text is printed in blocked
//          paragraphs. Note this change on the Transcriber's Notes page."
//
// Before this fix, `formatPara`/`formatSegmentedPara` (Emboss/format/document.mjs) had no
// per-paragraph signal for "this paragraph is blocked in print" — the only way to get a
// flush (0-indent) first line was the document-wide `o.paragraphStyle === 'block'` toggle,
// which also adds its blank line AFTER (not before) every paragraph, the wrong shape for
// §1.9.3. This tests the real code paths the fix touches: formatPara/formatSegmentedPara
// and joinsWithoutBlank (document.mjs) for the margins/blank-line rule; formatBlock/
// traceBlock for rendering parity; parseDtbook/exportToNimasXml (parse.mjs/nimas-export.mjs)
// for the `<p class="blocked">` round trip (both the top-level parser and the sidebar/box
// parser, which is a separate code path — see Example 4-6 in the §4 gold corpus); and
// loadWarnings (load-audit.mjs) for the whole-text exception, surfaced as a warning rather
// than silently auto-applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, formatDocument, traceBlock } from '../format/document.mjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { loadWarnings } from '../input/load-audit.mjs';

const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 38, depth: 25, translate: up, suppressHeader: true, ...extra });
const bodyLines = (doc) => formatDocument(doc, opts()).split('\f')[0].split(/\r?\n/);

// --- 1-1 margins (§1.9.3) ---------------------------------------------------------------

test('F-39: a blocked paragraph gets 1-1 margins (flush first line AND runover)', () => {
  const long = 'This blocked paragraph is deliberately long enough that it must wrap onto at least two braille lines so the runover margin can be checked too.';
  const lines = formatBlock({ type: 'para', text: long, blocked: true }, opts());
  assert.ok(lines.length >= 2, JSON.stringify(lines));
  // Drop the paragraph's own leading blank (added per §1.9.3, checked separately below).
  const body = lines.filter((l) => l !== '');
  assert.ok(body.length >= 2, JSON.stringify(lines));
  for (const l of body) assert.ok(!l.startsWith(' '), `expected flush (0-indent), got ${JSON.stringify(l)}`);
});

test('F-39: an ordinary (non-blocked) paragraph keeps the 3-1 margin, unchanged', () => {
  const long = 'This ordinary paragraph is also long enough to wrap onto at least two braille lines for the runover check.';
  const lines = formatBlock({ type: 'para', text: long }, opts());
  assert.ok(lines.length >= 2, JSON.stringify(lines));
  assert.ok(lines[0].startsWith('  '), `first line should be cell-3 (2-space indent): ${JSON.stringify(lines)}`);
  assert.ok(!lines[1].startsWith(' '), `runover should be cell-1 (flush): ${JSON.stringify(lines)}`);
});

test('F-39: a segmented (rich-text) blocked paragraph also gets 1-1 margins', () => {
  const segments = [{ type: 'text', text: 'A ' }, { type: 'text', text: 'bold', tf: 4 }, { type: 'text', text: ' lead-in phrase makes this paragraph long enough to wrap onto a second braille line for the runover check.' }];
  const lines = formatBlock({ type: 'para', segments, blocked: true }, opts());
  const body = lines.filter((l) => l !== '');
  assert.ok(body.length >= 2, JSON.stringify(lines));
  for (const l of body) assert.ok(!l.startsWith(' '), `expected flush (0-indent), got ${JSON.stringify(l)}`);
});

// --- Blank line precedes a blocked paragraph, with the cell-5/cell-7 exception ----------

test('F-39: a blank line precedes a blocked paragraph that follows an ordinary paragraph', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', text: 'An ordinary paragraph.' },
    { type: 'para', text: 'A blocked paragraph.', blocked: true },
  ] });
  const i = lines.findIndex((l) => l.trim() === 'A BLOCKED PARAGRAPH.');
  assert.ok(i > 0, JSON.stringify(lines));
  assert.equal(lines[i - 1], '', `blank line should precede the blocked paragraph: ${JSON.stringify(lines)}`);
});

test('F-39: a blank line precedes a blocked paragraph that follows a centred heading', () => {
  const lines = bodyLines({ blocks: [
    { type: 'heading', level: 1, text: 'Chapter Heading' },
    { type: 'para', text: 'A blocked paragraph.', blocked: true },
  ] });
  const iHead = lines.findIndex((l) => l.trim() === 'CHAPTER HEADING');
  const iPara = lines.findIndex((l) => l.trim() === 'A BLOCKED PARAGRAPH.');
  assert.ok(iHead >= 0 && iPara > iHead, JSON.stringify(lines));
  // The centred heading's own trailing blank (§4.4.1) and the paragraph's own leading
  // blank (§1.9.3) collapse to exactly one blank line, not two.
  assert.equal(lines[iPara - 1], '', JSON.stringify(lines));
  assert.equal(iPara, iHead + 2, `exactly one blank line between them: ${JSON.stringify(lines)}`);
});

test('F-39: NO blank line before a blocked paragraph that follows a cell-5 heading', () => {
  const lines = bodyLines({ blocks: [
    { type: 'heading', level: 2, text: 'Section Heading' },
    { type: 'para', text: 'A blocked paragraph.', blocked: true },
  ] });
  const iHead = lines.findIndex((l) => l.trim() === 'SECTION HEADING');
  const iPara = lines.findIndex((l) => l.trim() === 'A BLOCKED PARAGRAPH.');
  assert.ok(iHead >= 0 && iPara >= 0, JSON.stringify(lines));
  assert.equal(iPara, iHead + 1, `no blank line after a cell-5 heading: ${JSON.stringify(lines)}`);
  assert.ok(!lines[iPara].startsWith(' '), `still flush: ${JSON.stringify(lines)}`);
});

test('F-39: NO blank line before a blocked paragraph that follows a cell-7 heading', () => {
  const lines = bodyLines({ blocks: [
    { type: 'heading', level: 3, text: 'Sub Heading' },
    { type: 'para', text: 'A blocked paragraph.', blocked: true },
  ] });
  const iHead = lines.findIndex((l) => l.trim() === 'SUB HEADING');
  const iPara = lines.findIndex((l) => l.trim() === 'A BLOCKED PARAGRAPH.');
  assert.ok(iHead >= 0 && iPara >= 0, JSON.stringify(lines));
  assert.equal(iPara, iHead + 1, `no blank line after a cell-7 heading: ${JSON.stringify(lines)}`);
});

// A non-blocked (ordinary) paragraph after a cell-5/cell-7 heading is unaffected by this
// fix — the exception in joinsWithoutBlank is gated on `block.blocked`, not on tier alone.
test('F-39 regression: an ordinary paragraph after a cell-5 heading still gets its default blank line', () => {
  const lines = bodyLines({ blocks: [
    { type: 'heading', level: 2, text: 'Section Heading' },
    { type: 'para', text: 'An ordinary paragraph.' },
  ] });
  const iHead = lines.findIndex((l) => l.trim() === 'SECTION HEADING');
  const iPara = lines.findIndex((l) => l.trim() === 'AN ORDINARY PARAGRAPH.');
  assert.ok(iHead >= 0 && iPara >= 0, JSON.stringify(lines));
  assert.equal(iPara, iHead + 1, `unblocked body text still joins immediately after a heading (pre-existing behaviour): ${JSON.stringify(lines)}`);
});

// --- formatBlock/traceBlock parity -------------------------------------------------------

test('F-39: formatBlock/traceBlock parity for a blocked plain-text paragraph', () => {
  const o = { ...opts(), translatePos: upPos };
  const block = { type: 'para', text: 'A blocked paragraph long enough to wrap onto a second line for good measure.', blocked: true };
  const formatted = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

test('F-39: formatBlock/traceBlock parity for a blocked segmented paragraph', () => {
  const o = { ...opts(), translatePos: upPos };
  const segments = [{ type: 'text', text: 'A ' }, { type: 'text', text: 'bold', tf: 4 }, { type: 'text', text: ' lead-in phrase, long enough to wrap onto a second line.' }];
  const block = { type: 'para', segments, blocked: true };
  const formatted = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

test('F-39: formatBlock/traceBlock parity for a blocked paragraph directly after a cell-5 heading', () => {
  const o = { ...opts(), translatePos: upPos };
  const doc = { blocks: [
    { type: 'heading', level: 2, text: 'Section Heading' },
    { type: 'para', text: 'A blocked paragraph.', blocked: true },
  ] };
  for (const b of doc.blocks) {
    const formatted = formatBlock(b, o, false);
    const traced = traceBlock(b, o, false).map((t) => t.s);
    assert.deepEqual(traced, formatted, JSON.stringify({ block: b, formatted, traced }));
  }
});

// --- Round trip (parse.mjs / nimas-export.mjs) -------------------------------------------

test('F-39: <p class="blocked"> round-trips to block.blocked, top-level paragraph', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <h1>Heading</h1>
    <p class="blocked">A blocked paragraph.</p>
  </level1></bodymatter></book>
</dtbook>`;
  const doc = parseDtbook(xml);
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para, JSON.stringify(doc.blocks));
  assert.equal(para.blocked, true, JSON.stringify(para));

  const xml2 = exportToNimasXml(doc);
  assert.ok(xml2.includes('<p class="blocked">A blocked paragraph.</p>'), xml2);
});

test('F-39: a plain <p> (no class) does not round-trip as blocked, unchanged', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <p>An ordinary paragraph.</p>
  </level1></bodymatter></book>
</dtbook>`;
  const doc = parseDtbook(xml);
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para, JSON.stringify(doc.blocks));
  assert.ok(!para.blocked, JSON.stringify(para));

  const xml2 = exportToNimasXml(doc);
  assert.ok(xml2.includes('<p>An ordinary paragraph.</p>'), xml2);
  assert.ok(!xml2.includes('class="blocked"'), xml2);
});

// A `level-N` class (nested quote depth) must still combine correctly with `blocked` on
// export — nothing else that writes a bare <p class="..."> should be clobbered.
test('F-39: block.blocked combines with an existing level-N class on export', () => {
  const doc = { blocks: [{ type: 'para', text: 'Nested and blocked.', blocked: true, level: 2 }] };
  const xml = exportToNimasXml(doc);
  assert.ok(xml.includes('<p class="blocked level-2">Nested and blocked.</p>'), xml);
});

// Example 4-6 in the §4 gold corpus: a blocked paragraph inside a box/sidebar goes through
// parseSidebar's OWN copy of makeP (Emboss/input/parse.mjs), a separate code path from the
// top-level parser exercised above.
test('F-39: <p class="blocked"> round-trips inside a <sidebar> box (parseSidebar\'s own makeP)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <sidebar render="required">
      <hd>Take Care of a Nosebleed</hd>
      <p class="blocked">Sit upright and lean forward.</p>
    </sidebar>
  </level1></bodymatter></book>
</dtbook>`;
  const doc = parseDtbook(xml);
  const findPara = (blocks) => {
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'para') return b;
      if (Array.isArray(b.blocks)) { const r = findPara(b.blocks); if (r) return r; }
    }
    return null;
  };
  const para = findPara(doc.blocks);
  assert.ok(para, JSON.stringify(doc.blocks));
  assert.equal(para.blocked, true, JSON.stringify(para));

  const xml2 = exportToNimasXml(doc);
  assert.ok(xml2.includes('<p class="blocked">Sit upright and lean forward.</p>'), xml2);
});

// --- Whole-text exception (§1.9.3's own exception clause) ---------------------------------

test('F-39: loadWarnings flags a document where every paragraph is blocked', () => {
  const dom = new DOMParser().parseFromString(`<?xml version="1.0"?><d><p>Alpha one.</p><p>Beta two.</p></d>`, 'text/xml');
  const doc = { blocks: [
    { type: 'para', text: 'Alpha one.', blocked: true },
    { type: 'para', text: 'Beta two.', blocked: true },
  ] };
  const warnings = loadWarnings(dom, doc);
  assert.ok(warnings.some((w) => /blocked paragraph/i.test(w) && /1\.9\.3/.test(w)), JSON.stringify(warnings));
});

test('F-39: loadWarnings does NOT flag a document with a mix of blocked and ordinary paragraphs', () => {
  const dom = new DOMParser().parseFromString(`<?xml version="1.0"?><d><p>Alpha one.</p><p>Beta two.</p></d>`, 'text/xml');
  const doc = { blocks: [
    { type: 'para', text: 'Alpha one.', blocked: true },
    { type: 'para', text: 'Beta two.' },
  ] };
  const warnings = loadWarnings(dom, doc);
  assert.ok(!warnings.some((w) => /blocked paragraph/i.test(w)), JSON.stringify(warnings));
});

test('F-39: loadWarnings does NOT flag a single-paragraph document (below the noise threshold)', () => {
  const dom = new DOMParser().parseFromString(`<?xml version="1.0"?><d><p>Alpha one.</p></d>`, 'text/xml');
  const doc = { blocks: [{ type: 'para', text: 'Alpha one.', blocked: true }] };
  const warnings = loadWarnings(dom, doc);
  assert.ok(!warnings.some((w) => /blocked paragraph/i.test(w)), JSON.stringify(warnings));
});

// A styled paragraph (quote) ignores its own `blocked` flag entirely (formatPara's
// quoteMargins path takes precedence) — it must not count toward "every paragraph blocked".
test('F-39: loadWarnings ignores styled (e.g. quote) paragraphs when checking the whole-text exception', () => {
  const dom = new DOMParser().parseFromString(`<?xml version="1.0"?><d><p>Alpha one.</p><p>Beta two.</p></d>`, 'text/xml');
  const doc = { blocks: [
    { type: 'para', text: 'Alpha one.', blocked: true },
    { type: 'para', text: 'Beta two.', style: 'quote', blocked: true },
  ] };
  const warnings = loadWarnings(dom, doc);
  assert.ok(!warnings.some((w) => /blocked paragraph/i.test(w)), JSON.stringify(warnings));
});
