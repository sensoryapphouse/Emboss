// TF-1 (Paul, 28 Sep 2026, from KD's round-2 answer) — EMBOSS-TASKS row A77.
// The June 2024 Changes to Foreign Language Sections of Braille Formats 2016 do not reprint old BANA 5.3.3-5.3.11
// (part-of-speech abbreviations, book/poem/play titles as a complete heading, visual-enhancement font, vocabulary
// lists, scene settings/stage directions [still governed separately by §14.4.1c, untouched by the June 2024
// changes], numbers/letters beginning exercise material, quoted matter, entry words in alphabetic references).
// Formats now reprints only 5.3.1 (decorative emphasis in headings/TOC/dedications/titles/lists, dropped unless
// only part is emphasised) and 5.3.2 (English letters and word parts standing alone, transcriber's note). Per
// Paul's decision, old 5.3.3-5.3.11 are withdrawn: Emboss must stop DROPPING print emphasis for the cases those
// old rules covered on their own account; new 5.4.1 ("Follow print for the meaningful use of italics, bold, color,
// etc.") applies instead. See Emboss/docs/decisions.md (TF-1, 28 Sep) and Emboss/docs/expectation-changes.md.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
// A stand-in translator that shows emphasis: an emphasised run comes out as "{...}" (mirrors findings_batch_b.test.mjs).
const mark = (t, tf) => {
  const s = up(t);
  if (Array.isArray(tf)) { let r = '', open = false; for (let i = 0; i < s.length; i++) { const on = !!tf[i]; if (on && !open) r += '{'; if (!on && open) r += '}'; open = on; r += s[i]; } return open ? r + '}' : r; }
  return tf ? `{${s}}` : s;
};
const markPos = (s, tf) => { const b = mark(s, tf); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(s).length - 1))) }; };
const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: mark, translatePos: markPos, suppressHeader: true };
const rstrip = (l) => l.replace(/\s+$/, '');
const ob = { ...o, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
// Checks formatBlock/traceBlock parity (A39) and returns the formatBlock lines.
const both = (block, opts = o) => {
  const f = formatBlock(block, opts).map(rstrip);
  const t = traceBlock(block, ob).map((x) => rstrip(x.s));
  assert.deepEqual(t, formatBlock(block, ob).map(rstrip), 'traceBlock must match formatBlock');
  return f;
};
const it = (text) => ({ type: 'text', text, tf: 1 });
const pl = (text) => ({ type: 'text', text });

describe('TF-1: old 5.3.3-5.3.11 withdrawn, 5.4.1 follow-print applies', () => {
  test('an italic book title in running text keeps its italic (old 5.3.5 withdrawn; nothing ever stripped a plain paragraph, still true)', () => {
    const b = { type: 'para', segments: [pl('Have you read '), it('The State of America’s Children'), pl(' yet?')] };
    const out = both(b).join(' ');
    assert.ok(out.includes('{THE STATE'), out);
  });

  test('italic quoted matter keeps it (old 5.3.10 withdrawn; a plain paragraph was never auto-stripped)', () => {
    const b = { type: 'para', segments: [it('“All my globes and world maps seem to indicate that.”')] };
    const out = both(b).join(' ');
    assert.ok(out.includes('{“ALL MY GLOBES'), out);
  });

  test('a bold glossary entry word keeps it when the rest of the glossary is plain (old 5.3.11 withdrawn; BANA 21.2.2 only drops a mask shared by EVERY entry word)', () => {
    const b = { type: 'glossary', items: [
      { termSegments: [it('accuse')], defSegments: [pl('to blame')] },       // bold: distinctive (e.g. foreign/technical term)
      { termSegments: [pl('adapt')], defSegments: [pl('to adjust')] },       // plain
      { termSegments: [pl('bias')], defSegments: [pl('a leaning')] },        // plain
    ] };
    const out = both(b).join(' ');
    assert.ok(out.includes('{ACCUSE}'), out);
  });

  test('BANA 21.2.2 still drops the shared mask when every entry word in the glossary is emphasised the same way', () => {
    const b = { type: 'glossary', items: [
      { termSegments: [it('accuse')], defSegments: [pl('to blame')] },
      { termSegments: [it('adapt')], defSegments: [pl('to adjust')] },
    ] };
    const out = both(b).join(' ');
    assert.ok(!out.includes('{ACCUSE}') && !out.includes('{ADAPT}'), out);
  });

  test('a decorative heading still drops emphasis that covers the whole heading (5.3.1, reprinted, still in force)', () => {
    const b = { type: 'heading', level: 1, segments: [it('A Tale of Two Cities')] };
    const out = both(b).join(' ');
    assert.ok(!out.includes('{'), out);
  });

  test('a heading only partly emphasised keeps that emphasis (5.3.1\'s own partial-emphasis exception, unaffected)', () => {
    const b = { type: 'heading', level: 1, segments: [pl('From '), it('A Tale of Two Cities')] };
    const out = both(b).join(' ');
    assert.ok(out.includes('{A TALE'), out);
  });

  test('a letter standing alone still drops it via the transcriber’s segment.ignoreFont (5.3.2, reprinted, still in force)', () => {
    const b = { type: 'para', segments: [{ ...it('h'), ignoreFont: true }, pl(' isn’t helpful in exceptions.')] };
    const out = both(b).join(' ');
    assert.ok(!out.includes('{H}') && out.includes('H '), out);
  });

  test('an explicit block.ignoreFont still drops every run (the transcriber’s own choice, unaffected by TF-1)', () => {
    const b = { type: 'para', ignoreFont: true, segments: [it('Dedicated '), pl('to '), it('you')] };
    const out = both(b).join(' ');
    assert.ok(!out.includes('{'), out);
  });

  test('a part-of-speech abbreviation in a glossary definition now keeps its emphasis (old 5.3.4 withdrawn)', () => {
    const b = { type: 'glossary', items: [{ termSegments: [pl('accuse')], defSegments: [it('v.'), pl(' blame')] }] };
    const out = both(b).join(' ');
    assert.ok(out.includes('{V.}'), out);
  });

  test('a bold identifier at the start of a list item now keeps its emphasis (old 5.3.9 withdrawn; "Step 1. Draw a box.")', () => {
    const b = { type: 'list', items: [
      { segments: [it('Step 1.'), pl(' Draw a box.')] },
      { segments: [it('Step 2.'), pl(' Place a triangle near the box.')] },
    ] };
    const out = both(b).join(' ');
    assert.ok(out.includes('{STEP 1.}') && out.includes('{STEP 2.}'), out);
  });
});
