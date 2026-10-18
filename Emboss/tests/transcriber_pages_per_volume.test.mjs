// KD round 2 Q7d (28 Sep 2026, Emboss/docs/questions-register.md): in a multi-volume BANA book, the
// Special Symbols page and the Transcriber's Notes page appear in EVERY volume — each Special Symbols
// page listing only that volume's own symbols (2.5.1 "symbols found in the volume"; 2.5.2a "SPECIAL
// SYMBOLS USED IN THIS VOLUME") — not volume 1 only, as `splitTranscriberPages` (format/document.mjs)
// did before this answer. UKAAF is untouched (UK-8: no Special Symbols page; its "Note to Braille
// Edition" — the same tnpage block — still rides with volume 1 only, as before).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatVolumes } from '../format/document.mjs';

const translate = (t) => (t ? String(t).toUpperCase() : '');
const translatePos = (t) => { const b = translate(t); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(t).length - 1))) }; };
const bana = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos };
const ukaaf = { mode: 'ukaaf', width: 38, depth: 25, translate, translatePos };
const pagesOf = (brf) => brf.split('\x0c').map((p) => { const l = p.split('\r\n'); if (l[l.length - 1] === '') l.pop(); return l; });

const para = (t) => ({ type: 'para', text: t });
// A paragraph carrying one transcriber-defined literal-cell symbol (collectSpecialSymbols' `kind: 'literal'`
// case, document.mjs's segs()), so each group below registers its own distinct Special Symbols entry.
const marker = (brl, name) => ({ type: 'para', segments: [{ type: 'brl', text: name, brl }, { type: 'text', text: ' marker paragraph text goes here for testing purposes.' }] });
const filler = (n) => Array.from({ length: n }, (_, i) => para(`Paragraph ${i} with several words of ordinary running text to fill lines nicely and reliably for the test.`));
const group = (brl, name) => [marker(brl, name), ...filler(16)];

// Three groups of body content, each with its OWN transcriber-defined symbol (^7/widget, ;$=/gadget,
// _%/doohickey), long enough (with volumePages:3) to spread across three volumes.
const threeVolumeBlocks = () => [
  { type: 'sympage', matter: 'transcriber', auto: true },
  { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'Notes text here.' }] },
  ...group('^7', 'widget'),
  ...group(';$=', 'gadget'),
  ...group('_%', 'doohickey'),
];

test('BANA multi-volume: each Special Symbols page lists only that volume\'s own symbols', () => {
  const vols = formatVolumes({ title: 'Book', blocks: threeVolumeBlocks() }, { ...bana, volumePages: 3 });
  assert.equal(vols.length, 3, 'this fixture is tuned to split into exactly 3 volumes');

  // Volume 1's page range covers group 1 (and a little of group 2's opening, at the page boundary):
  // its Special Symbols page shows WIDGET, never DOOHICKEY (group 3, far away — the clean case).
  assert.match(vols[0].brf, /SPECIAL SYMBOLS/);
  assert.match(vols[0].brf, /\.=\^7 WIDGET/);
  assert.ok(!/DOOHICKEY/.test(vols[0].brf), 'volume 1 does not list volume 3\'s symbol');

  // Volume 2's page range covers group 3 (doohickey) only: its Special Symbols page shows DOOHICKEY and
  // NEITHER of the other volumes' symbols — the clean, unambiguous proof of per-volume scoping.
  assert.match(vols[1].brf, /SPECIAL SYMBOLS/);
  assert.match(vols[1].brf, /\.=_% DOOHICKEY/);
  assert.ok(!/WIDGET/.test(vols[1].brf) && !/GADGET/.test(vols[1].brf), 'volume 2 lists only its own symbol');

  // Volume 3's page range has no NEW transcriber-defined symbol in it (BANA Appendix G: a symbol is
  // required only "if they are used within a braille volume") — so it gets no Special Symbols page at
  // all, exactly like an ordinary document with no symbols (2.5.2f).
  assert.ok(!/SPECIAL SYMBOLS/.test(vols[2].brf), 'volume 3 has no Special Symbols page: none of its own content uses one');
});

test('BANA multi-volume: the Transcriber\'s Notes page repeats in every volume, and t-numbering restarts after each volume\'s own title page', () => {
  const vols = formatVolumes({ title: 'Book', blocks: threeVolumeBlocks() }, { ...bana, volumePages: 3 });
  assert.equal(vols.length, 3);
  for (const v of vols) assert.match(v.brf, /TRANSCRIBER.S NOTES/, `volume ${v.volume} carries its own Notes page`);
  for (const v of vols) assert.match(v.brf, /NOTES TEXT HERE\./, `volume ${v.volume}'s Notes page repeats the same author-provided text`);

  const lastLines = (brf) => pagesOf(brf).map((p) => p[p.length - 1].trim());
  // Volume 1 and 2: title (t1) + Special Symbols (t2) + Notes (t3), then body restarts at braille page 1.
  assert.deepEqual(lastLines(vols[0].brf).slice(0, 3), ['T#A', 'T#B', 'T#C']);
  assert.equal(lastLines(vols[0].brf)[3], '#A');
  assert.deepEqual(lastLines(vols[1].brf).slice(0, 3), ['T#A', 'T#B', 'T#C']);
  assert.equal(lastLines(vols[1].brf)[3], '#A');
  // Volume 3: title (t1) + Notes only (t2, no Special Symbols page) — t-numbering still restarts at t1
  // for the title page and t2 for the one transcriber-matter page that volume actually has.
  assert.deepEqual(lastLines(vols[2].brf).slice(0, 2), ['T#A', 'T#B']);
  assert.equal(lastLines(vols[2].brf)[2], '#A');
});

test('BANA multi-volume: a hand-edited (non-auto) Special Symbols page cannot be split by volume, so it repeats VERBATIM in every volume', () => {
  const blocks = [
    { type: 'sympage', matter: 'transcriber', entries: [{ braille: '^1', description: 'Boldface' }] },   // explicit entries, not auto: the 'edited page' case
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'Notes text here.' }] },
    ...filler(60),
  ];
  const vols = formatVolumes({ title: 'Book', blocks }, { ...bana, volumePages: 2 });
  assert.ok(vols.length > 1);
  for (const v of vols) {
    assert.match(v.brf, /SPECIAL SYMBOLS/, `volume ${v.volume} repeats the hand-edited page`);
    assert.match(v.brf, /BOLDFACE/, `volume ${v.volume} repeats it verbatim (same entry text)`);
  }
});

test('a single-volume document is unchanged: byte-identical to formatDocument, same as before this change', () => {
  const blocks = [
    { type: 'sympage', matter: 'transcriber', auto: true },
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'Notes text here.' }] },
    marker('^7', 'widget'),
    ...filler(6),
  ];
  const doc = { title: 'Book', blocks };
  const whole = formatDocument(doc, bana);
  const single = formatVolumes(doc, { ...bana, volumePages: 0 });
  assert.equal(single.length, 1);
  assert.equal(single[0].brf, whole, 'volumePages:0 (a single volume) is byte-identical to formatDocument, exactly as before KD round 2 Q7d');
});

test('UKAAF multi-volume: unchanged — the Note to Braille Edition (tnpage) still rides with volume 1 only', () => {
  const blocks = [{ type: 'tnpage', matter: 'transcriber', entries: [{ text: 'Notes text here.' }] }, ...filler(60)];
  const vols = formatVolumes({ title: 'Book', blocks }, { ...ukaaf, volumePages: 3 });
  assert.ok(vols.length > 1);
  assert.match(vols[0].brf, /NOTE TO BRAILLE EDITION/);
  assert.ok(!/NOTE TO BRAILLE EDITION/.test(vols[1].brf), 'UKAAF: the notes-equivalent page is not repeated (unchanged behaviour)');
});
