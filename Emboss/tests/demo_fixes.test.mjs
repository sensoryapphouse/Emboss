// Three demo-build bugs, each proved against a gold sample already in the repository.
// Expected results come from the quoted rule text / the gold JSON's own `braille.lines`,
// never from Emboss's own prior output (per Emboss/docs/standards-testing.md).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

const up = (s) => String(s).toUpperCase();
const opts = (mode, extra) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), ...extra });
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);
const lines = (brf) => brf.replace(/\r/g, '').split('\n');

let realTranslate = null;
async function getRealTranslate() {
  if (realTranslate) return realTranslate;
  const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const TABLES = louis.TABLES.uebG2;
  realTranslate = (t, tf) => louis.translate(t, TABLES, tf || null);
  return realTranslate;
}

// =====================================================================================
// Bug 1 — F-156: BANA 16.5.1/16.2.1, a note's body must begin with its own reference mark.
//   Example 16-1: text ",hamlet"9" / note ""9,o!llo"; numbered notes open ";9#a" (16.2.1).
//   Gold: tests/gold/bana-formats-2016/section-16/example-16-1.json, sample-16-01.json.
// =====================================================================================
describe('F-156 — a note body opens with the same reference mark used in the text', () => {
  test('FAILS pre-fix / PASSES post-fix: a real DTBook <note> gets its mark prepended', () => {
    // The finding's own reproduction (standards-findings.md F-156): a plain <note> with no
    // mark baked into its own text, referenced by an asterisk noteref.
    const d = doc('<p>Hamlet<noteref idref="#n1">*</noteref></p><note id="n1" class="Footnote"><p>Othello</p></note>');
    const out = lines(formatDocument(d, opts('bana'))).join('\n');
    assert.match(out, /HAMLET"9/);
    // BANA 16.2.1: the note repeats the SAME mark before the word — not bare text.
    assert.match(out, /"9OTHELLO/, `note body must open with the repeated mark:\n${out}`);
    assert.doesNotMatch(out, /\n\s*OTHELLO/, `note body must not appear WITHOUT its mark:\n${out}`);
  });

  test('BANA Example 16-1 wording, against the real liblouis translator (gold example-16-1.json)', async () => {
    const translate = await getRealTranslate();
    const d = doc('<p>Hamlet<noteref idref="#n1">*</noteref></p><note id="n1" class="Footnote"><p>Othello</p></note>');
    const out = lines(formatDocument(d, { mode: 'bana', width: 40, depth: 25, translate })).join('\n');
    // Gold example-16-1.json braille.lines: [",hamlet\"9", "\"9,o!llo"] (Emboss's own
    // convention capitalises the alphabet, see this repo's established uppercase-vs-gold
    // -lowercase note in gold-run.mjs; the symbols themselves are identical).
    assert.match(out, /,HAMLET"9/);
    assert.match(out, /"9,O!LLO/, out);
  });

  test('numbered note: mark ";9#a" (BANA 16.2.1) repeated before the note body', () => {
    const d = doc('<p>See<noteref idref="#n1">1</noteref> the text.</p><note id="n1" class="Footnote"><p>A numbered note.</p></note>');
    const out = lines(formatDocument(d, opts('bana'))).join('\n');
    assert.match(out, /;91 THE TEXT/);              // in-text mark (stub translate leaves digits alone)
    assert.match(out, /"333333\n;91A NUMBERED NOTE/, `note body must open with the same mark:\n${out}`);
  });

  test('multi-paragraph note (F-113): only the OPENING paragraph gets the repeated mark', () => {
    // noteMark is attached by buildDocPages (via findNoteMarks/idref matching), so this
    // exercises the full pipeline, not formatBlock in isolation.
    const SRC = '<p>Word<noteref idref="#n1">1</noteref>.</p><note id="n1" class="Footnote"><p>First paragraph.</p><p>Second paragraph.</p></note>';
    const out = lines(formatDocument(doc(SRC), opts('bana')));
    const p1 = out.find((l) => l.includes('FIRST PARAGRAPH'));
    const p2 = out.find((l) => l.includes('SECOND PARAGRAPH'));
    assert.ok(p1 && p2, JSON.stringify(out));
    assert.match(p1, /^;91FIRST PARAGRAPH/, JSON.stringify(out));
    assert.doesNotMatch(p2, /;91/, `continuation paragraph must not repeat the mark:\n${JSON.stringify(out)}`);
  });

  test('a note already transcribed with its own mark as literal text is not double-marked (note_references.test.mjs convention)', () => {
    // <note id="n1"><p>1 First note.</p></note> — the print source itself restates "1"
    // as the note's own leading word; Emboss must not ALSO prepend a computed ";91".
    const d = doc('<p>Text<noteref idref="#n1" class="Footnote">1</noteref>.</p><note id="n1" class="Footnote"><p>1 First note.</p></note>');
    const out = lines(formatDocument(d, opts('bana'))).join('\n');
    assert.match(out, /\n1 FIRST NOTE\./, `existing literal mark must be left alone, not doubled:\n${out}`);
    assert.doesNotMatch(out, /;91 ?1 FIRST NOTE/, out);
  });

  test('formatBlock/traceBlock parity for a marked single-paragraph note', () => {
    const note = { type: 'footnote', text: 'Single note.', id: 'n1', noteMark: '1', noteRunStart: true };
    const f = formatBlock(note, opts('bana'));
    assert.deepEqual(traceBlock(note, opts('bana')).map((t) => t.s), f, JSON.stringify(f));
    assert.ok(f.some((l) => l.startsWith(';91SINGLE NOTE')), JSON.stringify(f));
  });

  test('formatBlock/traceBlock parity for a marked multi-paragraph note (segments form)', () => {
    const note = {
      type: 'footnote', id: 'n1', noteMark: '*',
      blocks: [{ type: 'para', segments: [{ type: 'text', text: 'First.' }] }, { type: 'para', text: 'Second.' }],
    };
    const f = formatBlock(note, opts('bana'));
    assert.deepEqual(traceBlock(note, opts('bana')).map((t) => t.s), f, JSON.stringify(f));
  });

  test('gold §16 status: example-16-1 and sample-16-01 no longer show the missing-mark symptom', async () => {
    // gold-run.mjs is owned by other agents and must not be edited (task constraint); this
    // asserts the specific F-156 symptom is gone by re-running the same rule text directly.
    const translate = await getRealTranslate();
    const d = doc('<p>Five<noteref idref="#n1">*</noteref>\n[ref:**]</p><note id="n1" class="Footnote"><p>Orwell was writing in 1936.</p></note>');
    const out = lines(formatDocument(d, { mode: 'bana', width: 40, depth: 25, translate })).join('\n');
    assert.match(out, /"9,ORWELL/, out);
  });
});

// =====================================================================================
// Bug 2 — F-33/A6: BANA 8.6.2 ("Retain bullets whenever they are used in lists"). A
//   <list type="ul"> item with no literal bullet character must still get a bullet marker.
//   Gold: tests/gold/bana-formats-2016/section-8/sample-8-13/14/15.json (marker: '•' -> '_4').
// =====================================================================================
describe('F-33/A6 — an unordered list with no literal bullet glyph still gets a bullet marker', () => {
  test('FAILS pre-fix / PASSES post-fix: <list type="ul"><li>Apple</li></list> parses with a marker', () => {
    const d = doc('<list type="ul"><li>Apple</li><li>Pear</li></list>');
    const list = d.blocks.find((b) => b.type === 'list');
    assert.ok(list, JSON.stringify(d.blocks));
    assert.deepEqual(list.items.map((it) => it.marker), ['•', '•'], JSON.stringify(list.items));
  });

  test('BANA 8.6.2a: formats with the primary bullet symbol "_4" (gold sample-8-14.json)', () => {
    const d = doc('<list type="ul"><li>Coffee</li><li>Tea</li><li>Milk</li></list>');
    const out = lines(formatDocument(d, opts('bana')));
    // Gold sample-8-14.json braille.lines: "_4 ,C(FEE" / "_4 ,TEA" / "_4 ,MILK" (stub
    // translate leaves the word itself as-is, so only the fixed marker "_4" is checked).
    assert.ok(out.some((l) => l.trim() === '_4 COFFEE'), JSON.stringify(out));
    assert.ok(out.some((l) => l.trim() === '_4 TEA'), JSON.stringify(out));
    assert.ok(out.some((l) => l.trim() === '_4 MILK'), JSON.stringify(out));
  });

  test('a literal print bullet is still recognised and marked exactly as before (no regression)', () => {
    const d = doc('<list type="ul"><li>• Apple</li></list>');
    const list = d.blocks.find((b) => b.type === 'list');
    assert.equal(list.items[0].marker, '•');
    assert.equal(list.items[0].text, 'Apple');
  });

  test('a <list type="pl"> (BANA/DTBook "plain", explicitly no enumerator) is NOT given a bullet', () => {
    const d = doc('<list type="pl"><li>Line one</li><li>Line two</li></list>');
    const list = d.blocks.find((b) => b.type === 'list');
    assert.deepEqual(list.items.map((it) => it.marker), [undefined, undefined], JSON.stringify(list.items));
  });

  test('export round-trip: no literal bullet glyph is written into the DTBook XML', () => {
    const d = doc('<list type="ul"><li>Apple</li><li>Pear</li></list>');
    const xml = exportToNimasXml(d);
    const listXml = xml.match(/<list[\s\S]*?<\/list>/)[0];
    assert.match(listXml, /type="ul"/);
    assert.doesNotMatch(listXml, /•/, `must not bake a literal bullet into print text:\n${listXml}`);
    assert.match(listXml, /<li>Apple<\/li>/, listXml);   // no "• " prefix written
    // Reloading regenerates the marker from type="ul" alone, the signal this fix uses.
    const again = parseDtbook(xml).blocks.find((b) => b.type === 'list');
    assert.deepEqual(again.items.map((it) => it.marker), ['•', '•'], JSON.stringify(again.items));
  });
});

// =====================================================================================
// Bug 3 — F-229: BANA §10.11.1 ("An embedded transcriber's note (TN) with a brief
//   description is used in material that is partially or totally pictures"). Example 10-31:
//   ",! @.<butt]fly@.> flew s\? = ! w9t]4" for print "The [picture of a] butterfly flew
//   south for the winter." (references/_text/braille-formats-2016.txt lines 7853-7855).
// =====================================================================================
describe('F-229 — an image inside a bai-exercise item becomes an embedded transcriber\'s note', () => {
  const SRC = '<list type="ol" class="bai-exercise"><li class="bai-exercise">The <img src="butterfly.jpg" alt="butterfly"/> flew south for the winter.</li></list>';

  test('FAILS pre-fix / PASSES post-fix: the image is not silently dropped, and no alt text is lost', () => {
    const d = doc(SRC);
    const list = d.blocks.find((b) => b.type === 'list');
    const item = list.items[0];
    assert.ok(item.segments, JSON.stringify(item));
    const note = item.segments.find((s) => s.type === 'imgnote');
    assert.ok(note, `image must survive as an embedded-note segment: ${JSON.stringify(item)}`);
    assert.equal(note.text, 'butterfly');
    // The image must not ALSO be split out as its own standalone graphic block (F-229's
    // reproduction: "the image is silently gone" would otherwise become "the image is
    // silently duplicated").
    assert.ok(!d.blocks.some((b) => b.type === 'graphic'), JSON.stringify(d.blocks));
  });

  test('coordinator repro: class="bai-exercise" on the <list> itself (not the <li>), type="ol", plain <li>', () => {
    // Reported: this exact markup parsed as an ORDINARY ordered list (marker "1."), with
    // no exercise kind on the block, because the exercise-item dispatch only ever checked
    // the <li>'s own class — never the <list>'s. That silently dropped the image (split
    // out as a standalone graphic block instead), so the fix never fired on this real
    // parse.mjs path even though the unit test above (bai-exercise class on the <li>) was
    // green. Fixed by also recognising class="bai-exercise" on the <list> element itself.
    const SRC2 = '<list class="bai-exercise" type="ol"><li>The <img src="b.jpg" alt="Butterfly"/> flew south for the winter.</li></list>';
    const d = doc(SRC2);
    assert.ok(!d.blocks.some((b) => b.type === 'graphic'), `image must not be split out as a standalone graphic block: ${JSON.stringify(d.blocks)}`);
    const list = d.blocks.find((b) => b.type === 'list');
    assert.ok(list, JSON.stringify(d.blocks));
    const item = list.items[0];
    assert.ok(item.segments, `item must keep the image as an inline note, not drop it: ${JSON.stringify(item)}`);
    const note = item.segments.find((s) => s.type === 'imgnote');
    assert.ok(note, `image must survive as an embedded-note segment: ${JSON.stringify(item)}`);
    assert.equal(note.text, 'Butterfly');
    // BANA §10.4: the print numbering must not be lost when the exercise routing kicks in
    // via the <list>'s own class (a regression this fix's first pass introduced: the
    // exercise-item builder never synthesised a marker the way the ordinary ordered-list
    // branch does).
    assert.equal(item.marker, '1.', `item must keep its synthesised print number: ${JSON.stringify(item)}`);
    for (const mode of ['bana', 'ukaaf']) {
      const out = lines(formatDocument(d, opts(mode))).join('\n');
      assert.match(out, /^1\. THE @\.<BUTTERFLY@\.> FLEW SOUTH FOR/m,
        `${mode}: the number must lead, and the note must sit INLINE where the picture was:\n${out}`);
      assert.doesNotMatch(out, /\n\s*@\.<BUTTERFLY@\.>\s*\n/, `${mode}: no standalone note line:\n${out}`);
    }
  });

  test('coordinator repro 2: markers are not lost for a multi-item bai-exercise list marked at the <list> level', () => {
    // Reported regression: after the <list>-level class fix above, exercise items got NO
    // marker at all (not even the ordinary synthesised "1."/"2." an <list type="ol"> would
    // otherwise carry) — the exercise-item builder never called synthesizeOrderedMarker.
    const SRC2 = '<list class="bai-exercise" type="ol"><li>The <img src="b.jpg" alt="Butterfly"/> flew south.</li><li>Name two insects.</li></list>';
    const d = doc(SRC2);
    const list = d.blocks.find((b) => b.type === 'list');
    assert.ok(list, JSON.stringify(d.blocks));
    assert.deepEqual(list.items.map((it) => it.marker), ['1.', '2.'], JSON.stringify(list.items));
    const note = list.items[0].segments.find((s) => s.type === 'imgnote');
    assert.ok(note, JSON.stringify(list.items[0]));
    for (const mode of ['bana', 'ukaaf']) {
      const out = lines(formatDocument(d, opts(mode))).join('\n');
      assert.match(out, /1\. THE @\.<BUTTERFLY@\.> FLEW SOUTH\./, `${mode}:\n${out}`);
      assert.match(out, /2\. NAME TWO INSECTS\./, `${mode}:\n${out}`);
    }
  });

  test('an original-convention bai-exercise item with a literal marker baked into its text is unaffected (no double marker)', () => {
    // gold-run.mjs's own documented convention (Emboss/scripts/gold-run.mjs, buildBlocks10):
    // a real bai-exercise item's print number is usually already part of its own text
    // ("1. Which…"), kept verbatim with NO separate item.marker — this must still hold, or
    // the marker-synthesis fix above would double-number every already-numbered item.
    const d = doc('<list type="ol" class="bai-exercise"><li class="bai-exercise">1. Which of these is correct?</li><li class="bai-exercise">2. None of the above.</li></list>');
    const list = d.blocks.find((b) => b.type === 'list');
    assert.deepEqual(list.items.map((it) => [it.marker, it.text]), [
      [undefined, '1. Which of these is correct?'],
      [undefined, '2. None of the above.'],
    ], JSON.stringify(list.items));
  });

  test('BANA Example 10-31, against the real liblouis translator', async () => {
    const translate = await getRealTranslate();
    const d = doc(SRC);
    const out = lines(formatDocument(d, { mode: 'bana', width: 40, depth: 25, translate })).join('\n');
    // references/_text/braille-formats-2016.txt line 7855: ",! @.<butt]fly@.> flew s\? = ! w9t]4"
    assert.match(out, /,! @\.<BUTT\]FLY@\.> FLEW S\\\? = ! W9T]4/, out);
  });

  test('export/reimport round-trip keeps the image as an <img> in place, not bare text', () => {
    const d = doc(SRC);
    const xml = exportToNimasXml(d);
    const listXml = xml.match(/<list[\s\S]*?<\/list>/)[0];
    assert.match(listXml, /<img[^>]*alt="butterfly"/, listXml);
    assert.doesNotMatch(listXml, />\s*The butterfly flew/, `alt text must not leak into plain print text:\n${listXml}`);
    const again = parseDtbook(xml).blocks.find((b) => b.type === 'list');
    const note = again.items[0].segments.find((s) => s.type === 'imgnote');
    assert.ok(note, JSON.stringify(again));
    assert.equal(note.text, 'butterfly');
  });

  test('a decorative image with no alt text is still just a word boundary (no empty TN)', () => {
    const d = doc('<list type="ol" class="bai-exercise"><li class="bai-exercise">Look at the <img src="deco.jpg" alt=""/> picture.</li></list>');
    const out = lines(formatDocument(d, opts('bana'))).join('\n');
    assert.doesNotMatch(out, /@\.<@\.>/, out);
    assert.match(out, /LOOK AT THE PICTURE/, out);
  });

  test('formatBlock/traceBlock parity for a list item carrying an imgnote segment', () => {
    const list = doc(SRC).blocks.find((b) => b.type === 'list');
    const f = formatBlock(list, opts('bana'));
    assert.deepEqual(traceBlock(list, opts('bana')).map((t) => t.s), f, JSON.stringify(f));
    assert.ok(f.some((l) => l.includes('@.<BUTTERFLY@.>')), JSON.stringify(f));
  });
});
