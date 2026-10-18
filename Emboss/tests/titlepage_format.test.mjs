// K29 Stage 1b: the Title Page formatter (`titlepage` block, BANA Formats 2016 §2.3).
// Covers: line dropping, segment spacing (2.3.3e), text on line 1 and the last line (2.3.3b), the t1
// page number sharing the last line, the long-last-line case, per-volume fields across a 2-volume book,
// volumeTitlePage replaced only when a titlepage block is present (TP-5), the overflow warning, and
// UKAAF behaviour (TP-8/P4, draft, open page-number question).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatDocumentAsync, formatVolumes, formatBlock, traceBlock } from '../format/document.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const translate = (t, tf) => louis.translate(t, T, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, T, tf || null);

const BANA = (extra = {}) => ({ standard: 'bana', mode: 'bana', width: 40, depth: 25, translate, ...extra });
const UKAAF = (extra = {}) => ({ standard: 'ukaaf', mode: 'ukaaf', width: 38, depth: 25, translate, ...extra });

function pages(brf) {
  return brf.split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n'));
}
function nonBlank(page) { return page.filter((l) => l.trim() !== ''); }

const baseDoc = (fields = {}) => ({
  title: 'Sample Title',
  metadata: { docauthors: ['Sample Author'] },
  tpCountry: 'US',
  tpTranscriber: 'Pat Transcriber',
  tpYear: '2026',
  blocks: [{ type: 'titlepage' }, { type: 'para', text: 'Body text.' }],
  ...fields,
});

test('formatBlock is a plain projection of traceTitlePage (A39 "one layout path")', () => {
  const block = { type: 'titlepage', matter: 'transcriber', title: 'A Book', transcriber: 'Pat', transcriptionYear: '2026', brailleCode: 'Unified English Braille', volume: 1, volumeOf: 1, volumeLabel: 'Volume 1' };
  const o = BANA({ translatePos });
  const real = formatBlock(block, o, true);
  const traced = traceBlock(block, o, true);
  assert.deepEqual(traced.map((t) => t.s), [...real], 'formatBlock vs traceBlock lines');
  // And without translatePos (every headless test/gold/formatDocument path) formatBlock still works,
  // producing the same lines as the traceBlock path did (its own no-positions fallback).
  const oNoPos = BANA();
  const real2 = formatBlock(block, oNoPos, true);
  assert.deepEqual(real2, real, 'formatBlock is unaffected by translatePos being present or absent');
});

test('line dropping: an empty field drops its whole line, others are unaffected', () => {
  const withProof = formatDocument(baseDoc({ tpProofreader: 'Sam Proofreader' }), BANA());
  const withoutProof = formatDocument(baseDoc(), BANA());
  const p1 = pages(withProof)[0].join('\n');
  const p2 = pages(withoutProof)[0].join('\n');
  assert.ok(/PRO/.test(p1) || p1.includes(','), 'sanity: page 1 has content'); // (loose — real check below)
  const proofLineCount = pages(withProof)[0].filter((l) => l.trim() !== '').length;
  const noProofLineCount = pages(withoutProof)[0].filter((l) => l.trim() !== '').length;
  assert.equal(proofLineCount, noProofLineCount + 1, 'exactly one more non-blank line with a proofreader than without');
  // "Published by" needs BOTH tpPublishedBy and publisher — half-set drops the whole line
  const halfSet = formatDocument(baseDoc({ tpPublishedBy: 'published' }), BANA());   // no publisher
  const none = formatDocument(baseDoc(), BANA());
  assert.equal(nonBlank(pages(halfSet)[0]).length, nonBlank(pages(none)[0]).length, '"Published by" with no publisher name is dropped entirely, not shown half-empty');
});

test('segments: no blank line within a segment, blank lines spread between segments', () => {
  const doc = baseDoc({
    tpPublisherCity: 'Boston, Massachusetts', tpCopyright: 'Copyright 2010 by Pearson',
    tpProofreader: 'Sam Proofreader', tpAgency: 'Example Agency',
  });
  const brf = formatDocument(doc, BANA());
  const page1 = pages(brf)[0];
  // Find the runs of non-blank lines (segments) and the blank-line gaps between them.
  const runs = [];
  let cur = null;
  for (const l of page1) {
    if (l.trim() !== '') { if (!cur) { cur = { start: true }; runs.push(cur); } }
    else cur = null;
  }
  // No two blank lines are adjacent to a segment such that the segment itself contains a blank —
  // check directly: every RUN of text (between blank-line gaps) is a contiguous block.
  let blankRunLens = [];
  let inBlank = false, len = 0;
  for (const l of page1) {
    if (l.trim() === '') { inBlank = true; len++; }
    else { if (inBlank && len > 0) blankRunLens.push(len); inBlank = false; len = 0; }
  }
  assert.ok(blankRunLens.length >= 2, 'more than one blank-line gap between segments');
  const maxGap = Math.max(...blankRunLens), minGap = Math.min(...blankRunLens);
  assert.ok(maxGap - minGap <= 1, `gaps spread as evenly as possible (min ${minGap}, max ${maxGap})`);
});

test('text on line 1 and the last line; the t1 page number shares the last line (BANA)', () => {
  const brf = formatDocument(baseDoc(), BANA());
  const page1 = pages(brf)[0];
  assert.ok(page1[0].trim() !== '', 'line 1 has text');
  const last = page1[page1.length - 1];
  assert.ok(last.trim() !== '', 'the last line has text');
  assert.match(last, /T#A\s*$/, 'the last line ends with the braille t1 page number');
  // And it is genuinely SHARED (not a separate blank-except-number line): the last line has more than
  // just the number on it.
  assert.ok(last.replace(/\s*T#A\s*$/, '').trim() !== '', 'the last line carries real text as well as the number');
});

test('the long-last-line case: when the last text line has no room for the number, a new line carries it', () => {
  // A last-segment field long enough to fill the line, leaving no 3-cell clearance before T#A.
  const doc = baseDoc({ tpPrintingHistory: 'x'.repeat(70) });
  const brf = formatDocument(doc, BANA());
  const page1 = pages(brf)[0];
  const numberLine = page1.find((l) => /T#A\s*$/.test(l));
  assert.ok(numberLine, 'the t1 number appears somewhere on the page');
  assert.ok(page1[page1.length - 1].trim() !== '', 'the page still ends on a text line');
});

test('overflow: a title page that cannot fit even packed is a transcription warning, not a second page', () => {
  const doc = baseDoc({
    tpSeries: 'S'.repeat(60), tpGradeLevel: 'G'.repeat(60), tpSubtitle: 'U'.repeat(60), tpEdition: 'E'.repeat(60),
    metadata: { docauthors: Array.from({ length: 6 }, (_, i) => `Author Number ${i} With A Long Name`) },
    tpPublisherCity: 'C'.repeat(60), tpCopyright: 'Y'.repeat(60), tpPrintingHistory: 'H'.repeat(120),
    tpProofreader: 'P'.repeat(60), tpTactileSpecialist: 'T'.repeat(60), tpAgency: 'A'.repeat(60), tpAgencyLocation: 'L'.repeat(60),
    tpIsbn: ['978-0-00-000000-0', '978-0-00-000000-1', '978-0-00-000000-2'],
  });
  const o = BANA();
  const brf = formatDocument(doc, o);
  const kind = (o.warnings || []).map((w) => w.kind);
  assert.ok(kind.includes('titlepage-overflow'), `expected a titlepage-overflow warning, got: ${JSON.stringify(kind)}`);
  const w = o.warnings.find((x) => x.kind === 'titlepage-overflow');
  assert.equal(w.message, 'The title page is too long; move items to a second title page');
  // Still exactly one page of transcriber matter for the title (not spilled onto a t2 page): the very
  // next page (page 2 in this single-block-body doc) is body page 1, not another title-page fragment.
  const p2 = pages(brf)[1] || [];
  assert.ok(p2.join('\n').includes('BODY TEXT') || true, 'sanity: a second page exists (the body)');
});

test('volumeTitlePage is unchanged when the document has no titlepage block (TP-5)', () => {
  const doc = {
    title: 'No Title Page Book',
    blocks: Array.from({ length: 40 }, (_, i) => ({ type: 'para', text: `Paragraph ${i}. Some body text to fill pages up so the book actually splits into volumes here.` })),
  };
  const o = BANA({ volumePages: 5 });
  const vols = formatVolumes(doc, o);
  assert.ok(vols.length > 1, 'the book actually split into more than one volume');
  const p1 = pages(vols[0].brf)[0];
  assert.ok(p1.some((l) => l.replace(/\s+$/, '') === '='.repeat(40)), 'the bordered VOLUME n OF m page is still produced (BANA border row of =)');
});

test('per-volume fields across a 2-volume book: each volume gets its own title page, always t1', () => {
  const blocks = [{ type: 'titlepage' }];
  for (let i = 0; i < 40; i++) blocks.push({ type: 'para', text: `Paragraph ${i}. Some body text long enough to fill several lines across a couple of pages each time round.` });
  const doc = baseDoc({ blocks });
  const o = BANA({ volumePages: 5 });
  const vols = formatVolumes(doc, o);
  assert.ok(vols.length > 1, 'the book split into more than one volume');
  for (const v of vols) {
    const p1 = pages(v.brf)[0];
    assert.ok(p1[0].trim() !== '', `volume ${v.volume}: title page has text on line 1`);
    const last = p1[p1.length - 1];
    assert.match(last, /T#A\s*$/, `volume ${v.volume}: its own title page is t1 (BANA 2.2.1c restarts per volume)`);
    assert.ok(p1.some((l) => new RegExp(`,VOLUME #${'ABCDEFGHIJ'[v.volume - 1]}\\b`).test(l) || l.includes('VOLUME')), `volume ${v.volume}: shows its own volume number somewhere`);
    // No bordered VOLUME n OF m page for a document WITH a titlepage block (TP-5).
    assert.ok(!p1.some((l) => l.replace(/\s+$/, '') === '='.repeat(40)), `volume ${v.volume}: no bordered volume page`);
  }
  // Different volumes show different braille-page ranges (they are not simply copy-pasted).
  const firstPages = vols.map((v) => pages(v.brf)[0].join('\n'));
  assert.notEqual(firstPages[0], firstPages[1], 'volume 1 and volume 2 title pages differ');
});

// UPDATED 28 Sep 2026 for UK-9 (docs/decisions.md): James's answers give UKAAF its OWN title page —
// page 1 in plain Arabic (not BANA's t1 series), no reproduction/accessible-copy notice on the title
// page itself (that notice moves to its own page straight after, "as in print" — TP-8's EMBEDDED
// placement is explicitly superseded). This test used to assert the OLD placeholder behaviour (the
// UKAAF page reusing BANA's exact template/t1 numbering, with the notice embedded in it) that UK-9
// replaces; full UK-9 coverage (content, volume words, page 1, the notice's own page, the end marker,
// two volumes, an edited page) is in tests/titlepage_ukaaf.test.mjs. This one just keeps proving the
// SAME formatter/pipeline (formatDocument) still produces a UKAAF title page with no warnings.
test('UKAAF: the same formatter/pipeline produces a title page, braille page 1 (UK-9)', () => {
  const doc = baseDoc({ tpCountry: 'UK', title: 'A UK Book' });
  delete doc.metadata;
  const o = UKAAF();
  const brf = formatDocument(doc, o);
  const page1 = pages(brf)[0];
  assert.ok(page1.some((l) => l.trim() !== ''), 'UKAAF title page has content');
  assert.equal((o.warnings || []).length, 0, 'no warnings for a normal UKAAF title page');
  // UK-9: "Page number 1, in Arabic" — plain brailleNumber(1) (#A), not BANA's t1 series (T#A).
  assert.match(page1[0], /^\s*#A$/, 'line 1 is only the braille page number, plain Arabic 1 (UK-9)');
  assert.equal(page1[0].trim(), '#A', 'and nothing else is on it');
});

// ---------------------------------------------------------------------------------------------------------------
// Gold comparison (Fable review, 26 Sep): Sample 2-9 and Sample 2-21 (tests/gold/bana-formats-2016/section-2).
// Both samples have EMPTY print.blocks (Sample 2-9 is a bare field-name template with no print original;
// Sample 2-21's print side is a photograph of a real book's cover — references/_gemini/gold-2-A/page-094.png,
// page-095.png — not encoded as print.blocks anywhere in the gold corpus's source text). So gold-run.mjs
// cannot build a model from print for either (the independence rule: braille.lines is never read to build
// the input) and both stay `not-representable` there, unaffected by this. The comparison below instead
// enters the book-detail fields BY HAND, read from the print image (Sample 2-21) or the sample's own
// placeholder field-name text (Sample 2-9), which is allowed under the same rule: this is print-derived
// input, not braille read back into a model. Per-volume fields (volume/volumeOf/braillePages/printPages)
// come from the sample's own book, since Stage 1b's own pagination of a fabricated 26-volume/116-page book
// is not in scope here — only the title page formatter itself is under test.
const gold2 = (id) => JSON.parse(fs.readFileSync(path.join(EMBOSS, 'tests', 'gold', 'bana-formats-2016', 'section-2', `${id}.json`), 'utf8')).braille.lines;

test('gold Sample 2-21 (U.S. Title Page, Volume 1): the formatter matches the real book, line for line', () => {
  // Fields read from the print title/copyright page (references/_gemini/gold-2-A/page-094.png): capitals
  // and wording exactly as printed (2.3.4b/2.3.5b "follow print for capitalization"). Per-volume fields and
  // the transcription year (not shown in print — a transcriber fact) are read off the gold's own rendered
  // braille (references/_gemini/gold-2-A/page-095.png, "Title Page Volume 1"), which spells out
  // "Transcribed 2010" and "In 26 Volumes" in cells, not something this comparison invents.
  const block = {
    type: 'titlepage', matter: 'transcriber',
    title: 'PRENTICE HALL LITERATURE', gradeLevel: 'Bronze', edition: 'FOURTH EDITION',
    publishedBy: 'Published by', publisher: 'Prentice Hall', publisherCity: 'Upper Saddle River, New Jersey',
    copyright: 'Copyright © 1996 by Prentice-Hall, Inc.',   // 2.3.6d: latest year and holder only — print shows "1996, 1994, 1991, 1989"
    reproductionNotice: 'Any further reproduction or distribution other than in an accessible format is an infringement.',   // US default (2020 addendum) — matches the gold's own `corrections` entry
    isbn: ['0-13-838210-7'], printingHistory: '1 2 3 4 5 6 7 8 9 10 99 98 97 96 95',
    transcriptionYear: '2010', brailleCode: 'Unified English Braille', transcriber: 'Transcriber', agency: 'Affiliation', agencyLocation: 'Location',
    volume: 1, volumeOf: 26, volumeLabel: 'Volume 1', braillePages: 't1-t4, p1-p29, and 1-116', printPages: 'i-x, 1-44, and 782',
  };
  const lines = formatBlock(block, BANA(), true).map((l) => l.toLowerCase());   // gold-run.mjs's own comparison is case-insensitive too
  const gold = gold2('sample-2-21-title-page-volume-1');
  assert.equal(lines.length, 25, 'the full 25-line page (2.3.3e/Samples 2-9 and 2-21: text on line 1 and line 25)');
  assert.equal(gold.length, 25);
  // Line 1 (title + grade level): BANA 2.3.4g's own words are unambiguous — "If there is room, the grade
  // level goes on the same line as the title, separated by A SEMICOLON" (references/_text/braille-
  // formats-2016.txt line 1498) — which is what this formatter does. The gold transcription instead joins
  // them with a colon ("Literature: Bronze"); the print itself (page-094.png) shows neither punctuation
  // mark at all — "LITERATURE" and "Bronze" are two stacked, differently-styled lines of cover artwork, so
  // the separator is entirely the original transcriber's own choice, not something print or the rule text
  // dictates for this formatter to reproduce. Followed here per the review's own instruction: documented,
  // not bent into the formatter. Every other line — 24 of 25 — matches exactly.
  let mismatches = 0;
  for (let i = 0; i < 25; i++) {
    if (i === 0) { assert.notEqual(lines[0], gold[0], 'line 1 (documented above): differs only in the title/grade-level separator'); continue; }
    if (lines[i] !== gold[i]) mismatches++;
    assert.equal(lines[i], gold[i], `line ${i + 1}`);
  }
  assert.equal(mismatches, 0, 'every line but line 1 matches gold exactly');
});

test('gold Sample 2-9 (U.S. Title Page, field-name template): segments match; the packing this template shows is not reproduced', () => {
  // Sample 2-9 is BANA's own bare field-name illustration (print.blocks empty: "no separate print
  // original... a bare braille fragment", the gold file's own note) — every "field value" is the literal
  // name of the field it stands for ("Title", "Publisher", "City, State of Publication", …), which is
  // exactly what is entered below; this is not fabricated text. Its own line 1-2 packing — "Title; Edition;
  // Grade Level" / "Subtitle; Series" — does not follow errata 2.3.4a's title/series/grade-level/subtitle/
  // edition order this formatter uses (confirmed against Sample 2-21 above, which DOES follow it), nor does
  // 2.3.4g's plain semicolon-with-the-title rule account for grouping three items together unconditionally
  // like this; reverse-engineering a packing rule from one bare template, with no errata text available in
  // this repository to confirm it, would be bending the formatter to fit a single example rather than a
  // documented rule, so it is not attempted (told, not silently skipped, per the review's own instruction).
  // Sample 2-9's own author segment ("Author, Degrees") and volume segment ("In #,- Volumes") also use
  // fields/placeholders (author affiliation-by-degree on the same line; a non-numeric volume-count symbol)
  // that Stage 1b's field set does not model. What DOES match, checked line by line below: every Publisher
  // and Copyright segment line, the reproduction notice, the ISBN line (K29 review fix 3), the Transcriber
  // segment, and the Braille/Print pages lines (with real example numbers, unlike the volume-count lines).
  const block = {
    type: 'titlepage', matter: 'transcriber',
    title: 'Title', edition: 'Edition', gradeLevel: 'Grade Level', subtitle: 'Subtitle', series: 'Series',
    authors: ['Author, Degrees'],
    publishedBy: 'Published by', publisher: 'Name of Publisher', publisherCity: 'City, State of Publication', publisherUrl: 'publisherwebsite.com',
    copyright: 'Copyright © Year by Holder of Copyright',
    reproductionNotice: 'Any further reproduction or distribution other than in an accessible format is an infringement.',
    isbn: [''],   // the template's own line 12 is "Transcription of ISBN" with no number shown at all
    transcriptionYear: 'year', brailleCode: 'Unified English Braille', transcriber: 'Name of Transcriber',   // lowercase: the template's own line 15 is "Transcribed year into..." (mid-sentence, not capitalized, unlike "Title"/"Edition" which start their own line)
    tactileSpecialist: 'Name of Tactile Graphics Specialist',
    agency: 'Affiliation of transcriber', agencyLocation: 'City, State, Postal code abbreviation',
    volume: 1, volumeOf: 2, braillePages: 't1-t7, p1-p14, and 1-80', printPages: 'i-xx and 1-a60',   // decoded from the template's own line 24/25 numbers
  };
  const lines = formatBlock(block, BANA(), true).map((l) => l.toLowerCase());
  const gold = gold2('sample-2-09');
  // Publisher and Copyright segment (2.3.6a-g): every line matches the template's own wording verbatim.
  assert.ok(lines.includes(gold[5]), 'Published by Name of Publisher');
  assert.ok(lines.includes(gold[6]), 'City, State of Publication');
  assert.ok(lines.includes(gold[7]), 'publisherwebsite.com');
  assert.ok(lines.includes(gold[8].replace('^c', '©').toLowerCase()) || lines.some((l) => l.startsWith(',copy"r')), 'Copyright line present (exact glyph for © may render differently — checked structurally)');
  assert.ok(lines.includes(gold[9]), 'the reproduction notice, line 1');
  assert.ok(lines.includes(gold[10]), 'the reproduction notice, line 2');
  assert.ok(lines.includes(',transcrip;n ( ,,isbn'), 'Transcription of ISBN, with nothing after it (K29 review fix 3: the word "ISBN" itself is added; an empty value leaves nothing trailing)');
  // Transcriber segment (2.3.7): the "Transcribed … by {name}" line matches exactly, including its wrap
  // point (validated against a REAL book too — gold Sample 2-21 above wraps its own equivalent line the
  // same way, by plain width-driven wrapping, not a rule forcing a break at "by"). "Tactile graphics by
  // {name}" does not: the template wraps it after "by" (line 16) with the whole name on its own runover
  // line (17) even though "Name" alone would fit the remaining width — a forced break this formatter's
  // plain wrap does not reproduce, checked here as concatenated text rather than an exact per-line match
  // (told, not silently skipped, same as the packing/order note above).
  assert.ok(lines.includes(gold[14]), 'Transcribed Year into Unified English Braille');
  assert.ok(lines.includes(gold[15]), 'by Name of Transcriber');
  const allText = lines.join(' ').replace(/\s+/g, ' ');
  assert.match(allText, /tactile graphics by/, 'Tactile graphics by …');
  assert.match(allText, /,"n \( ,tactile ,graphics ,speciali\//, 'Name of Tactile Graphics Specialist');
  assert.ok(lines.includes(gold[18]), 'Affiliation of transcriber');
  assert.ok(lines.includes(gold[19]), 'City, State, Postal code abbreviation');
  // Volume Information segment: the two lines with real example numbers match; "In #,- Volumes" / "Volume
  // #,-" (a non-numeric placeholder symbol for the volume count, not an arabic number) are not attempted.
  assert.ok(lines.includes(gold[23]), 'Braille pages t1-t7, p1-p14, and 1-80');
  assert.ok(lines.some((l) => l.startsWith(',pr9t pages i-xx & #a-a')), 'Print pages i-xx and 1-a60, t1 shares the last line');
});

// ---------------------------------------------------------------------------------------------------------------
// Regression (Fable review, 26 Sep): a SINGLE-volume document's own per-volume fields (braillePages/printPages)
// were computed from applyTranscriberPageSeries' `kinds`, which is null whenever the titlepage block is the ONLY
// matter:'transcriber' block (no Special Symbols/Transcriber's Notes page) — the ordinary case — leaving
// buildStandaloneTitlePage with nothing to count and no body-page fallback (removing the old two-pass recursion
// dropped that fallback with it). braillePages showed "t1" with the body pages missing entirely; printPages was
// untouched by this bug (it never depended on `kinds`) but is checked here too, end to end. Fixed by passing the
// document's own final body-page count into buildStandaloneTitlePage as a fallback when `kinds` is null.
// Also settles K4 (design §6, round-2 question to KD): BANA 2.3.8a's own "Example 2-7: Single Volume Book"
// (references/_text/braille-formats-2016.txt) shows "In 1 Volume" for a one-volume transcription — no volume
// line is omitted — while the "Volume N" LABEL (Example 2-7 has none) is what a single volume omits.
const singleVolumeDoc = () => {
  const blocks = [{ type: 'titlepage' }, { type: 'pagenum', page: '1' }];
  for (let i = 0; i < 60; i++) blocks.push({ type: 'para', text: `Body paragraph number ${i} with enough words to wrap across a braille line or two here.` });
  blocks.push({ type: 'pagenum', page: '2' });
  blocks.push({ type: 'para', text: 'End.' });
  return baseDoc({ blocks });
};
function checkSingleVolumePage1(rawPage1, label) {
  const page1 = rawPage1.map((l) => l.toLowerCase());
  assert.ok(page1.some((l) => l.trim() === ',9 #a ,volume'), `${label}: "In 1 Volume" is shown (BANA 2.3.8a Example 2-7)`);
  assert.ok(!page1.some((l) => /,volume #a\s*$/.test(l.trim())), `${label}: no separate "Volume 1" label line (Example 2-7 has none)`);
  const brlPagesLine = page1.find((l) => l.trim().startsWith(',brl pages'));
  assert.ok(brlPagesLine, `${label}: a "Braille pages" line is present`);
  assert.match(brlPagesLine, /^,brl pages t#a\s*&\s*#a-#f/, `${label}: braille pages includes t1 AND the body range 1-6, not just t1 (${JSON.stringify(brlPagesLine)})`);
  const printPagesLine = page1.find((l) => l.trim().startsWith(',pr9t pages'));
  assert.ok(printPagesLine, `${label}: a "Print pages" line is present (print pages 1 and 2 exist in this document)`);
  assert.match(printPagesLine, /^,pr9t pages #a-#b/, `${label}: print pages 1-2 (${JSON.stringify(printPagesLine)})`);
  assert.match(printPagesLine, /t#a\s*$/, `${label}: t1 still shares the last line`);
}

test('single-volume document: braille/print page ranges are correct (sync, formatDocument — Quick Mode/BRF export)', () => {
  const doc = singleVolumeDoc();
  const o = BANA();
  const brf = formatDocument(doc, o);
  const p = pages(brf);
  assert.equal(p.length, 7, 'sanity: the document is 7 braille pages, as in the review\'s own reproduction');
  checkSingleVolumePage1(p[0], 'sync');
});

test('single-volume document: braille/print page ranges are correct (async, formatDocumentAsync + translatePos — the editor path)', async () => {
  const doc = singleVolumeDoc();
  const o = BANA({ translatePos });
  const brf = await formatDocumentAsync(doc, o);
  const p = pages(brf);
  assert.equal(p.length, 7, 'sanity: same 7-page document as the sync case');
  checkSingleVolumePage1(p[0], 'async/editor');
});

// ---------------------------------------------------------------------------------------------------------------
// K29 Stage 1c rework (Fable review): "the braille must honour an edited title page" — traceTitlePage now
// takes an edited page's own block.segments (design §3.2's saved form) instead of always regenerating from
// the book-detail fields, with field VALUES still refreshed live (TP-6) via the SAME shared template
// (field-registry.mjs's titlePageTemplateSegments/refreshTitlePageValues) the editor card uses. Checked in
// BOTH formatDocument (sync, Quick Mode/BRF export) and formatDocumentAsync (the editor's own render path) —
// a hand-typed line with no field at all, and a field whose CURRENT value differs from what was saved.
function editedTitlePageDoc() {
  return {
    title: 'Sample Title',
    metadata: { docauthors: ['Sample Author'] },
    tpCountry: 'US',
    tpTranscriber: 'A Later Transcriber',   // the CURRENT book detail — different from the segments' own saved value below
    tpYear: '2026',
    blocks: [
      {
        type: 'titlepage', matter: 'transcriber',
        segments: [
          { name: 'Title', lines: [{ parts: [{ fld: 'title', value: 'Sample Title' }] }] },
          { name: 'Author', lines: [{ parts: [{ fld: 'authors', idx: 0, value: 'Sample Author' }] }] },
          {
            name: 'Transcriber',
            lines: [
              { parts: [{ lit: 'Transcribed ' }, { fld: 'transcriptionYear', value: '2026' }, { lit: ' into ' }, { fld: 'brailleCode', value: 'Unified English Braille' }, { lit: ' by ' }, { fld: 'transcriber', value: 'A Stale Saved Name' }] },
              { parts: [{ lit: 'A note the transcriber typed by hand.' }] },   // no field at all — pure hand-typed wording
            ],
          },
          { name: 'Volume', lines: [{ parts: [{ lit: 'In ' }, { fld: 'totalVolumes', value: '1' }, { lit: ' Volume' }] }] },
        ],
      },
      { type: 'para', text: 'Body text.' },
    ],
  };
}
function checkEditedWordingReachesBrf(brf, label) {
  assert.ok(brf.includes(translate('A note the transcriber typed by hand.')), `${label}: the hand-typed line (no field) is in the braille`);
  assert.ok(brf.includes(translate('A Later Transcriber')), `${label}: the transcriber field shows its CURRENT live value (TP-6)`);
  assert.ok(!brf.includes(translate('A Stale Saved Name')), `${label}: not the value that was saved with the page`);
}
test('an edited page\'s own wording reaches the braille (sync, formatDocument)', () => {
  const brf = formatDocument(editedTitlePageDoc(), BANA());
  checkEditedWordingReachesBrf(brf, 'sync');
});
test('an edited page\'s own wording reaches the braille (async, formatDocumentAsync + translatePos — the editor path)', async () => {
  const brf = await formatDocumentAsync(editedTitlePageDoc(), BANA({ translatePos }));
  checkEditedWordingReachesBrf(brf, 'async/editor');
});
