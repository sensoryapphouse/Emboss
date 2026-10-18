// EMBOSS-TASKS section K, small items (K2, K10, K11, K17) — KD's answers (round 1), recorded
// 25 Sep 2026 in Emboss/docs/transcription-policy.md. Each test below fails against the
// pre-change code (kept for comparison under the k-small scratch directory for this task).
//  - K2  / BANA 4.3.3, Example 4-2 (G1/13b): a title and its author's name are two separate
//    items — a <byline> right under a heading becomes a second centred heading with the
//    ordinary blank line kept, not a cell-5 attribution nor a connected heading joined with
//    no blank (document.mjs's HEADING_JOIN_TIERS, parse.mjs's <byline> handling).
//  - K10 / BANA 4.3.6 (Q-10, "only the literal case"): a heading is not preceded by a blank
//    line ONLY when it directly follows a single-note run (the note that itself carries the
//    separation line). A heading after a run of two or more notes keeps its blank line.
//  - K11 / BANA 14.10.4b, Example 14-10: a single-frame cartoon's caption runs straight on
//    from its own scene-setting note, no blank line — via the `afterNote` field, now also
//    valid on a caption block (field-registry.mjs), not just a list.
//  - K17 / BANA 16.2.2: the hollow-dot note reference mark (°, ○, ◦, •) maps to the rule's
//    fixed symbol ;9"0, exactly like asterisk/dagger/double-dagger — already implemented
//    (NOTE_SYMBOLS, document.mjs); this locks the behaviour in with a regression test.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const { parseDtbook } = await import(path.join(EMBOSS, 'input', 'parse.mjs'));
const { exportToNimasXml } = await import(path.join(EMBOSS, 'input', 'nimas-export.mjs'));
const R = await import(path.join(EMBOSS, 'format', 'field-registry.mjs'));

const up = (s) => String(s).toUpperCase();
const opts = { mode: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), suppressHeader: true };
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);
const lines = (brf) => brf.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));

// ---------------------------------------------------------------------------------------------
// K2 — title and author are two separate items (BANA 4.3.3, Example 4-2)
// ---------------------------------------------------------------------------------------------
test('K2: a <byline> right under a heading becomes a second centred heading, blank line kept', () => {
  const d = doc('<h1>By Any Other Name</h1><byline>Santha Rama Rau</byline><p>Story text.</p>');
  assert.equal(d.blocks.find((b) => b.type === 'attribution'), undefined, 'no attribution: not folded into a cell-5 byline');
  const authorHeading = d.blocks.find((b) => b.type === 'heading' && b.text === 'Santha Rama Rau');
  assert.ok(authorHeading, 'author becomes its own heading block');
  assert.equal(authorHeading.level, 1);
  assert.equal(authorHeading.notConnected, true, 'opts out of the centred>centred connected-heading join');

  const out = lines(formatDocument(d, opts));
  const ti = out.findIndex((l) => l.includes('BY ANY OTHER NAME'));
  const ai = out.findIndex((l) => l.includes('SANTHA RAMA RAU'));
  assert.ok(ti >= 0 && ai === ti + 2, `title and author should be exactly one blank line apart, got lines ${JSON.stringify(out)}`);
  assert.equal(out[ti + 1], '', 'blank line between title and author (Example 4-2)');
});

test('K2: a genuinely connected pair of centred headings (no <byline>) still joins with no blank line', () => {
  // Sanity check: two ordinary same-level headings (e.g. a chapter number + title, Example 4-3)
  // must NOT be affected by the K2 change — only a <byline> right under a heading is.
  const d = { blocks: [{ type: 'heading', level: 1, text: 'Theme 1' }, { type: 'heading', level: 1, text: 'Transitions' }, { type: 'para', text: 'Body.' }] };
  const out = lines(formatDocument(d, opts));
  const ti = out.findIndex((l) => l.includes('THEME 1'));
  const si = out.findIndex((l) => l.includes('TRANSITIONS'));
  assert.equal(si, ti + 1, 'connected headings still run on with no blank line between them');
});

test('K2: a <byline> that does not directly follow a heading keeps its ordinary attribution role', () => {
  // Scoped narrowly: only a <byline> whose immediately preceding block is a heading is
  // affected. One that follows a paragraph (e.g. a poem's byline after its own first line) is
  // unaffected -- still an attribution, cell-5 style.
  const d = doc('<h1>Heading</h1><p>Some text.</p><byline>By Someone</byline>');
  assert.equal(d.blocks.find((b) => b.type === 'heading' && b.text === 'By Someone'), undefined);
  const bylineBlock = d.blocks.find((b) => b.type === 'attribution');
  assert.ok(bylineBlock, '<byline> not directly under a heading is still an attribution');
  assert.equal(bylineBlock.text, 'By Someone');
});

// ---------------------------------------------------------------------------------------------
// K10 — no blank line before a heading straight after the note separation line (BANA 4.3.6,
// literal case only — KD's answer to Q-10, not "after a whole run of notes")
// ---------------------------------------------------------------------------------------------
test('K10: a heading directly after a single-note run has no blank line before it', () => {
  const d = { blocks: [
    { type: 'para', text: 'Body text.' },
    { type: 'footnote', id: 'n1', text: 'A note.', noteRunStart: true },
    { type: 'heading', level: 2, text: 'Next Section' },
  ] };
  const out = lines(formatDocument(d, opts));
  const sep = out.indexOf('"333333');
  const hi = out.findIndex((l) => l.includes('NEXT SECTION'));
  assert.ok(sep >= 0 && hi > sep, JSON.stringify(out));
  assert.notEqual(out[hi - 1], '', 'no blank line: the heading directly follows the single-note run');
});

test('K10: a heading after a run of TWO OR MORE notes keeps its blank line (unchanged — not "the whole run")', () => {
  const d = { blocks: [
    { type: 'para', text: 'Body text.' },
    { type: 'footnote', id: 'n1', text: 'A note.', noteRunStart: true },
    { type: 'footnote', id: 'n2', text: 'Second note.' },
    { type: 'heading', level: 2, text: 'Next Section' },
  ] };
  const out = lines(formatDocument(d, opts));
  const hi = out.findIndex((l) => l.includes('NEXT SECTION'));
  assert.equal(out[hi - 1], '', 'blank line kept: default behaviour for a run of several notes');
});

test('K10: an endnote (no separation line) is unaffected', () => {
  const d = { blocks: [
    { type: 'para', text: 'Body text.' },
    { type: 'footnote', id: 'n1', kind: 'endnote', text: 'An endnote.', noteRunStart: true },
    { type: 'heading', level: 2, text: 'Next Section' },
  ] };
  const out = lines(formatDocument(d, opts));
  const hi = out.findIndex((l) => l.includes('NEXT SECTION'));
  assert.equal(out[hi - 1], '', 'endnotes never carry the separation line, so 4.3.6 does not apply');
});

// ---------------------------------------------------------------------------------------------
// K11 — single-frame cartoon: no blank line between the scene-setting note and its caption
// (BANA 14.10.4b, Example 14-10)
// ---------------------------------------------------------------------------------------------
test('K11: a caption with afterNote runs straight on from the note before it, no blank line', () => {
  const d = { blocks: [
    { type: 'note', text: 'Scene setting describing the cartoon.' },
    { type: 'caption', text: 'Caption text', afterNote: true },
  ] };
  const out = lines(formatDocument(d, opts));
  const ni = out.findIndex((l) => l.includes('SCENE SETTING'));
  const ci = out.findIndex((l) => l.includes('CAPTION TEXT'));
  assert.ok(ni >= 0 && ci > ni, JSON.stringify(out));
  for (let i = ni + 1; i < ci; i++) assert.notEqual(out[i], '', `no blank line between the note and its caption, got ${JSON.stringify(out)}`);
});

test('K11: an ordinary caption (no afterNote) still opens with its usual blank line', () => {
  const d = { blocks: [
    { type: 'note', text: 'Some other note.' },
    { type: 'caption', text: 'Caption text' },
  ] };
  const out = lines(formatDocument(d, opts));
  const ci = out.findIndex((l) => l.includes('CAPTION TEXT'));
  assert.equal(out[ci - 1], '', 'default caption behaviour is unchanged');
});

test('K11: getBlockSignature keys on a caption\'s afterNote (formatBlock cache correctness)', () => {
  const a = { type: 'caption', text: 'Caption text' };
  const b = { ...a, afterNote: true };
  assert.notEqual(getBlockSignature(a, opts, false), getBlockSignature(b, opts, false));
  assert.deepEqual(traceBlock(b, opts).map((t) => t.s), formatBlock(b, opts));
});

test('K11: field-registry afterNote applies to both list and caption', () => {
  const f = R.FIELDS.find((x) => x.key === 'afterNote');
  assert.ok(f, 'afterNote field exists');
  assert.ok(f.where.includes('list') && f.where.includes('caption'), JSON.stringify(f.where));
});

test('K11: afterNote round-trips through save/reopen on a caption block', () => {
  const model = { title: 'T', blocks: [
    { type: 'heading', level: 1, text: 'T' },
    { type: 'note', text: 'Scene setting.' },
    { type: 'caption', text: 'Caption text', afterNote: true },
  ] };
  const xml = exportToNimasXml(model, { uid: 'k11-roundtrip', date: '2026-01-01' });
  const reopened = parseDtbook(xml);
  const cap = reopened.blocks.find((b) => b.type === 'caption');
  assert.ok(cap, 'caption block survives the round trip');
  assert.equal(cap.afterNote, true, 'afterNote flag survives the round trip');
});

// ---------------------------------------------------------------------------------------------
// K17 — hollow-dot note reference marks (BANA 16.2.2): ○, ◦, ° (and • per the rule's own
// symbol table) map to the fixed superscript symbol ;9"0, exactly like asterisk/dagger.
// ---------------------------------------------------------------------------------------------
test('K17: hollow-dot marks (°, ○, ◦, •) all map to the fixed BANA 16.2.2 symbol', () => {
  for (const mark of ['°', '○', '◦', '•']) {
    const b = { type: 'para', segments: [{ type: 'text', text: 'craft' }, { type: 'noteref', text: mark, idref: 'x' }] };
    const f = formatBlock(b, opts);
    assert.ok(f.join('').includes('CRAFT;9"0'), `${mark}: ${JSON.stringify(f)}`);
    assert.deepEqual(traceBlock(b, opts).map((t) => t.s), f);
  }
});

test('K17: a hollow-dot mark parsed from a DTBook <noteref> formats correctly end to end (Example 16-2 shape)', () => {
  for (const mark of ['°', '○', '◦']) {
    const d = doc(`<p>(craft<noteref idref="#n1">${mark}</noteref>)</p><note id="n1"><p>craft${mark}.</p></note>`);
    const ref = d.blocks[0].segments.find((g) => g.type === 'noteref');
    assert.equal(ref.text, mark, 'the parser keeps the source glyph verbatim');
    const out = lines(formatDocument(d, opts));
    const body = out.join('\n');
    assert.match(body, /CRAFT;9"0/, `${mark}: ${body}`);
  }
});
