// UK-9 (28 Sep 2026, James via Paul, docs/decisions.md): a UKAAF title page. PROVISIONAL — no RNIB
// Braillists' Manual seen (see document.mjs's/field-registry.mjs's own UK-9 comments for what was
// checked and the choices made where James's answer left room). Also covers UK-8 (the UKAAF "Note to
// Braille Edition" page, and no suggestions for it).
//
// Written FIRST (AGENTS.md rule 5), then shown to fail against a pre-change copy of document.mjs/
// field-registry.mjs kept in the scratch folder, before the format/field-registry.mjs and
// format/document.mjs changes that make it pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatVolumes, formatBlock, indicatorLine, suggestTranscriberNotes } from '../format/document.mjs';
import { tpNumberWords } from '../format/field-registry.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const translate = (t, tf) => louis.translate(t, T, tf || null);

const BANA = (extra = {}) => ({ standard: 'bana', mode: 'bana', width: 40, depth: 25, translate, ...extra });
const UKAAF = (extra = {}) => ({ standard: 'ukaaf', mode: 'ukaaf', width: 38, depth: 25, translate, ...extra });

function pages(brf) {
  return brf.split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n'));
}

const baseDoc = (fields = {}) => ({
  title: 'A UK Book',
  tpSubtitle: 'A Subtitle',
  tpTranscriber: 'Pat Transcriber',   // present in book details, to prove UK-9 really OMITS it, not just "never had one"
  tpYear: '2026',
  metadata: { docauthors: ['Jane Author'], publisher: 'Example Press', date: '2010-05-01' },
  blocks: [{ type: 'titlepage' }, { type: 'para', text: 'Body text.' }],
  ...fields,
});

// ---------------------------------------------------------------------------------------------------
// tpNumberWords (field-registry.mjs): the small helper UK-9 asked for, words from one to at least 99.
// ---------------------------------------------------------------------------------------------------
test('tpNumberWords: cardinal number words 0-99', () => {
  assert.equal(tpNumberWords(0), 'zero');
  assert.equal(tpNumberWords(1), 'one');
  assert.equal(tpNumberWords(2), 'two');
  assert.equal(tpNumberWords(13), 'thirteen');
  assert.equal(tpNumberWords(19), 'nineteen');
  assert.equal(tpNumberWords(20), 'twenty');
  assert.equal(tpNumberWords(21), 'twenty-one');
  assert.equal(tpNumberWords(45), 'forty-five');
  assert.equal(tpNumberWords(90), 'ninety');
  assert.equal(tpNumberWords(99), 'ninety-nine');
  // Outside the documented range: the plain digit string, not a guessed compound form.
  assert.equal(tpNumberWords(100), '100');
  assert.equal(tpNumberWords(-1), '-1');
});

// ---------------------------------------------------------------------------------------------------
// Content present / absent (UK-9's own list).
// ---------------------------------------------------------------------------------------------------
test('UK-9: content present — title, subtitle, author, publisher and year', () => {
  const brf = formatDocument(baseDoc(), UKAAF());
  const page1 = pages(brf)[0].join('\n');
  assert.ok(page1.includes(translate('A UK Book')), 'title shown');
  assert.ok(page1.includes(translate('A Subtitle')), 'subtitle shown');
  assert.ok(page1.includes(translate('Jane Author')), 'author shown');
  assert.ok(page1.includes(translate('Example Press')), 'publisher shown');
  assert.ok(page1.includes(translate('2010')), 'publication year shown (from the document\'s own dc:Date/metadata.date)');
});

test('UK-9: content absent — transcriber name, braille code, print page range', () => {
  const brf = formatDocument(baseDoc(), UKAAF());
  const page1 = pages(brf)[0].join('\n');
  assert.ok(!page1.includes(translate('Pat Transcriber')), 'transcriber name NOT shown, though it is set in book details');
  assert.ok(!page1.includes(translate('Unified English Braille')), 'braille code NOT shown');
  assert.ok(!page1.includes(translate('Print pages')), 'no print-page-range line at all');
  // For comparison, BANA's own title page (same book details) DOES show the transcriber segment —
  // proving the absence above is UK-9's own rule, not a formatter bug that drops the field everywhere.
  const banaPage1 = pages(formatDocument(baseDoc({ tpCountry: 'US' }), BANA()))[0].join('\n');
  assert.ok(banaPage1.includes(translate('Pat Transcriber')), 'sanity: BANA DOES show the transcriber');
});

// ---------------------------------------------------------------------------------------------------
// Volume notice, in words.
// ---------------------------------------------------------------------------------------------------
test('UK-9: volume notice in words — a single volume says "In one volume", no separate "Volume one" line', () => {
  const brf = formatDocument(baseDoc(), UKAAF());
  const page1 = pages(brf)[0].join('\n');
  assert.ok(page1.includes(translate('In one volume')), 'single volume: "In one volume"');
  assert.ok(!page1.includes(translate('Volume one')), 'single volume: no separate "Volume one" line (mirrors TP-11\'s BANA rule)');
});

test('UK-9: two volumes — "In two volumes" on both, "Volume one" / "Volume two" on their own title pages', () => {
  const blocks = [{ type: 'titlepage' }];
  for (let i = 0; i < 40; i++) blocks.push({ type: 'para', text: `Paragraph ${i}. Enough body text that this book actually splits into more than one UKAAF volume once each one is limited to a few pages.` });
  const doc = baseDoc({ blocks });
  const vols = formatVolumes(doc, UKAAF({ volumePages: 5 }));
  assert.ok(vols.length > 1, 'the book actually split into more than one volume');
  const p1v1 = pages(vols[0].brf)[0].join('\n');
  const p1v2 = pages(vols[1].brf)[0].join('\n');
  assert.ok(p1v1.includes(translate('In two volumes')), 'volume 1: "In two volumes"');
  assert.ok(p1v1.includes(translate('Volume one')), 'volume 1: "Volume one"');
  assert.ok(p1v2.includes(translate('In two volumes')), 'volume 2: "In two volumes"');
  assert.ok(p1v2.includes(translate('Volume two')), 'volume 2: "Volume two"');
  // B004 §7: braille page numbering restarts at 1 in EVERY volume — including volume 2's own title page.
  assert.equal(pages(vols[1].brf)[0][0].trim(), '#A', 'volume 2\'s own title page is also braille page 1');
});

// ---------------------------------------------------------------------------------------------------
// Page 1, in Arabic (not BANA's t1 series).
// ---------------------------------------------------------------------------------------------------
test('UK-9: the title page is braille page 1, plain Arabic', () => {
  const page1 = pages(formatDocument(baseDoc(), UKAAF()))[0];
  assert.equal(page1[0].trim(), '#A', 'line 1 is the plain Arabic braille number 1, not BANA\'s T#A');
});

// ---------------------------------------------------------------------------------------------------
// The accessible-copy notice: its own page, straight after the title page (supersedes TP-8's placement).
// ---------------------------------------------------------------------------------------------------
test('UK-9: the accessible-copy notice is on its OWN page straight after the title page, braille page 2', () => {
  const ps = pages(formatDocument(baseDoc({ tpCountry: 'UK' }), UKAAF()));
  assert.ok(ps.length >= 3, 'title page + notice page + at least one body page');
  const page1Text = ps[0].join(' ');
  const page2 = ps[1];
  // Joined with a space, not '\n': the notice wraps across several lines (word-wrap drops the space at
  // each break), so a space-joined re-read reconstructs the original translated text at word boundaries.
  const page2Text = page2.join(' ');
  assert.equal(page2[0].trim(), '#B', 'the notice page is braille page 2');
  assert.ok(page2Text.includes(translate('Patents Act')), 'the notice text is on page 2');
  assert.ok(!page1Text.includes(translate('Patents Act')), 'and NOT embedded in the title page itself');
});

test('UK-9: the notice page appears even when tpCountry was never set (the format MODE decides, not the book-detail field)', () => {
  const ps = pages(formatDocument(baseDoc(), UKAAF()));   // no tpCountry at all
  assert.equal(ps[1][0].trim(), '#B', 'still gets a sensible default notice page in UKAAF mode');
});

// ---------------------------------------------------------------------------------------------------
// Real UKAAF BRF evidence (28 Sep, references/ukaaf/{home-nation-languages,foreign-language-
// guidelines-28x27}.brf): page 1 of each is "#A" alone on line 1, an EMPTY line 2, then the centred
// title block from line 3 — and the colons marker, where used, sits DIRECTLY under the preceding
// content line, no blank line before it.
// ---------------------------------------------------------------------------------------------------
test('UK-9: line 1 is the page number alone, line 2 is blank, the title starts on line 3', () => {
  const page1 = pages(formatDocument(baseDoc(), UKAAF()))[0];
  assert.equal(page1[0].trim(), '#A');
  assert.equal(page1[1], '', 'line 2 is blank (real UKAAF BRF evidence)');
  assert.ok(page1[2].trim() !== '', 'line 3 has real content');
});

// ---------------------------------------------------------------------------------------------------
// End marker: the colons marker, at the foot of the title page, directly after the content.
// ---------------------------------------------------------------------------------------------------
test('UK-9: the colons end marker is at the foot of the title page, with no blank line before it', () => {
  const page1 = pages(formatDocument(baseDoc(), UKAAF()))[0];
  const expected = indicatorLine('colons', 38);
  assert.equal(page1[page1.length - 1].replace(/\s+$/, ''), expected, 'the last line is the colons end marker');
  assert.ok(page1[page1.length - 2].trim() !== '', 'the line before it is real content, not a blank (real UKAAF BRF evidence)');
});

// ---------------------------------------------------------------------------------------------------
// An edited UK page's own wording reaches the braille (TP-6 "fields stay live" applies here too).
// ---------------------------------------------------------------------------------------------------
function editedUkTitlePageDoc() {
  return {
    title: 'A UK Book',
    metadata: { docauthors: ['Jane Author'] },   // the CURRENT author — different from the segment's own saved value below
    blocks: [
      {
        type: 'titlepage', matter: 'transcriber',
        segments: [
          { name: 'Title', lines: [{ parts: [{ fld: 'title', value: 'A UK Book' }] }] },
          { name: 'Author', lines: [{ parts: [{ fld: 'authors', idx: 0, value: 'A Stale Saved Author' }] }] },
          { name: 'Publisher', lines: [{ parts: [{ lit: 'A hand-typed publisher line.' }] }] },
          { name: 'Volume', lines: [{ parts: [{ lit: 'In ' }, { fld: 'totalVolumesWords', value: 'one' }, { lit: ' volume' }] }] },
        ],
      },
      { type: 'para', text: 'Body text.' },
    ],
  };
}
test('UK-9: an edited UK title page\'s own wording (and live fields) reach the braille', () => {
  const brf = formatDocument(editedUkTitlePageDoc(), UKAAF());
  assert.ok(brf.includes(translate('A hand-typed publisher line.')), 'the hand-typed line (no field at all) is in the braille');
  assert.ok(brf.includes(translate('Jane Author')), 'the author field shows its CURRENT live value (TP-6)');
  assert.ok(!brf.includes(translate('A Stale Saved Author')), 'not the value that was saved with the page');
  assert.ok(brf.includes(indicatorLine('colons', 38)), 'the end marker is still added, even to an edited page (it is document furniture, not the transcriber\'s own wording)');
});

// ---------------------------------------------------------------------------------------------------
// UK-8: the "Note to Braille Edition" page (UKAAF's equivalent of BANA's Transcriber's Notes page),
// and no suggestions for it.
// ---------------------------------------------------------------------------------------------------
const stubTranslate = (t) => (t ? String(t).toUpperCase() : '');
const stubBana = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: stubTranslate };
const stubUkaaf = { mode: 'ukaaf', width: 38, depth: 25, translate: stubTranslate };

test('UK-8: the notes page heading is "TRANSCRIBER\'S NOTES" in BANA, "NOTE TO BRAILLE EDITION" in UKAAF', () => {
  const block = { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'A note.' }] };
  const banaLines = formatBlock(block, stubBana, true);
  const ukaafLines = formatBlock(block, stubUkaaf, true);
  assert.match(banaLines[0], /TRANSCRIBER.S NOTES/);
  assert.match(ukaafLines[0], /NOTE TO BRAILLE EDITION/);
});

test('UK-8: an explicit block.heading still overrides either default', () => {
  const block = { type: 'tnpage', matter: 'transcriber', heading: 'A Custom Heading', entries: [{ text: 'A note.' }] };
  const ukaafLines = formatBlock(block, stubUkaaf, true);
  assert.match(ukaafLines[0], /A CUSTOM HEADING/);
  assert.ok(!/NOTE TO BRAILLE EDITION/.test(ukaafLines[0]));
});

test('UK-8: suggestTranscriberNotes returns nothing in UKAAF; BANA still offers suggestions', () => {
  const blocks = [{ type: 'para', blocked: true, text: 'A blocked paragraph.' }];
  const banaSuggestions = suggestTranscriberNotes(blocks, BANA());
  const ukaafSuggestions = suggestTranscriberNotes(blocks, UKAAF());
  assert.ok(banaSuggestions.length > 0, 'sanity: BANA gets a suggestion for this document');
  assert.equal(ukaafSuggestions.length, 0, 'UKAAF gets none — "entirely the transcriber\'s page" (UK-8)');
});
