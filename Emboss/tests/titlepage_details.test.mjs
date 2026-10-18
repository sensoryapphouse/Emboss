// K29 Stage 1a: Title Page "Book details". Registry entries and bana-tp-* meta, parse/export, ISBN from
// dc:Source, and the dc:* pre-fills the Book details dialog uses (titlepageBookDetails, format/field-registry.mjs).
// This is a dedicated round-trip/pre-fill test file, alongside field_registry.test.mjs's generic per-field
// round-trip loop (which also covers every new field one at a time via its own `sample`/`samples`).
//
// Stage 1a builds ONLY the registry + save/load + dialog (design doc §5): no titlepage block, no formatter,
// no editor card. So these fields never affect braille output (affectsBraille: false) and there is nothing to
// format yet — this file checks the model <-> DTBook round trip and the pre-fill helper only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const R = await import('../format/field-registry.mjs');
const EX = await import('../input/nimas-export.mjs');
const { parseDtbook } = await import('../input/parse.mjs');

const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
const EXPORT_OPTS = { uid: 'titlepage-details-test', date: '2026-01-01' };
const exportModel = (m) => quiet(() => EX.exportToNimasXml(m, EXPORT_OPTS));
const parse = (xml) => quiet(() => parseDtbook(xml));

const plainDoc = () => ({
  title: 'Alice in Wonderland',
  blocks: [{ type: 'heading', level: 1, text: 'Alice in Wonderland' }, { type: 'para', text: 'Chapter one.' }],
});

// ---------------------------------------------------------------------------------------------------------------
// The full field list from design §4 / §3.1 (document-level book-details fields only; the per-volume fields
// (volume, totalVolumes, volumesWord, volumeLabel, customBraille, braillePages, printPages) are computed by the
// Stage 1b formatter, not stored, and are out of scope here).
const TP_KEYS = ['tpSeries', 'tpGradeLevel', 'tpSubtitle', 'tpEdition', 'tpTranslator', 'tpEditors', 'tpPublishedBy',
  'tpPublisherCity', 'tpPublisherUrl', 'tpCopyright', 'tpCountry', 'tpReproductionNotice', 'tpIsbn', 'tpPrintingHistory',
  'tpYear', 'tpTranscriber', 'tpProofreader', 'tpTactileSpecialist', 'tpAgency', 'tpAgencyLocation'];

test('registry: every Book details field exists, audience transcriber, does not affect braille yet', () => {
  for (const key of TP_KEYS) {
    const f = R.fieldByKey(key);
    assert.ok(f, `${key} is registered`);
    assert.equal(f.audience, 'transcriber', `${key} audience`);
    assert.equal(f.affectsBraille, false, `${key} affectsBraille (Stage 1a has no formatter yet)`);
    assert.ok(f.where.includes('doc'), `${key} is document-level`);
    assert.ok(f.save.some((s) => s.meta && s.meta.startsWith('bana-tp-')), `${key} saves as a bana-tp-* meta`);
  }
});

test('book details: every field round-trips together, export -> parse -> export is stable', () => {
  const doc = {
    ...plainDoc(),
    tpSeries: 'Prentice Hall Literature',
    tpGradeLevel: 'Grade 9',
    tpSubtitle: 'The British Tradition',
    tpEdition: '2010 Edition',
    tpTranslator: 'Jane Translator',
    tpEditors: ['Ann Editor', 'Bob Editor'],
    tpPublishedBy: 'published',
    tpPublisherCity: 'Boston, Massachusetts',
    tpPublisherUrl: 'https://example.com',
    tpCopyright: 'Copyright © 2010 by Pearson',
    tpCountry: 'US',
    tpReproductionNotice: 'Any further reproduction or distribution other than in an accessible format is an infringement.',
    tpIsbn: ['978-0-13-123456-7', '978-0-13-123457-4'],
    tpPrintingHistory: 'First printing 2010',
    tpYear: '2026',
    tpTranscriber: 'Pat Transcriber',
    tpProofreader: 'Sam Proofreader',
    tpTactileSpecialist: 'Robin Tactile',
    tpAgency: 'Example Braille Agency',
    tpAgencyLocation: 'Boston, Massachusetts',
  };
  const x1 = exportModel(doc);
  const m1 = parse(x1);
  for (const key of TP_KEYS) assert.deepEqual(m1[key], doc[key], `${key} after one save and reopen`);
  const x2 = exportModel(m1);
  const m2 = parse(x2);
  for (const key of TP_KEYS) assert.deepEqual(m2[key], doc[key], `${key} after a second save and reopen`);
  assert.equal(x2, exportModel(m2), 'save -> reopen -> save is stable');
});

test('book details: a document with no book details writes no bana-tp- meta (default output unchanged)', () => {
  const xml = exportModel(plainDoc());
  assert.ok(!/<meta name="bana-tp-/.test(xml), 'no bana-tp- meta for a plain document');
});

test('book details: an empty string / empty list field writes no meta for that field, others untouched', () => {
  const xml = exportModel({ ...plainDoc(), tpSeries: '', tpEditors: [], tpTranscriber: 'Pat Transcriber' });
  assert.ok(!/<meta name="bana-tp-series"/.test(xml));
  assert.ok(!/<meta name="bana-tp-editors"/.test(xml));
  assert.match(xml, /<meta name="bana-tp-transcriber" content="Pat Transcriber"/);
});

// ---------------------------------------------------------------------------------------------------------------
// titlepageBookDetails(model): the pure pre-fill helper the Book details dialog uses (design §4: "values computed
// from the document marked 'from the document'"). Shared here so the ISBN/dc:* pre-fill rules are Node-testable
// without a browser.
test('book details: ISBN pre-fills from dc:Source when bana-tp-isbn is absent', () => {
  const withSource = { ...plainDoc(), metadata: { source: '978-3-16-148410-0' } };
  const d = R.titlepageBookDetails(withSource);
  assert.deepEqual(d.isbn.value, ['978-3-16-148410-0']);
  assert.equal(d.isbn.computed, true, 'marked as computed / from the document');
});

test('book details: an explicit tpIsbn wins over dc:Source', () => {
  const withBoth = { ...plainDoc(), tpIsbn: ['978-1-11-111111-1'], metadata: { source: '978-3-16-148410-0' } };
  const d = R.titlepageBookDetails(withBoth);
  assert.deepEqual(d.isbn.value, ['978-1-11-111111-1']);
  assert.equal(d.isbn.computed, false);
});

test('book details: dc:Source that does not look like an ISBN is not offered', () => {
  const d = R.titlepageBookDetails({ ...plainDoc(), metadata: { source: 'Scanned from a library copy' } });
  assert.deepEqual(d.isbn.value, []);
});

test('book details: title, authors, publisher and copyright pre-fill from existing dc:* meta', () => {
  const d = R.titlepageBookDetails({
    title: 'Alice in Wonderland',
    metadata: { docauthors: ['Lewis Carroll'], publisher: 'Macmillan', rights: 'Copyright 1865, public domain' },
  });
  assert.equal(d.title.value, 'Alice in Wonderland');
  assert.deepEqual(d.authors.value, ['Lewis Carroll']);
  assert.equal(d.publisher.value, 'Macmillan');
  assert.equal(d.copyright.value, 'Copyright 1865, public domain');
  assert.equal(d.copyright.computed, true);
});

test('book details: an explicit tpCopyright wins over dc:Rights', () => {
  const d = R.titlepageBookDetails({ ...plainDoc(), tpCopyright: 'Copyright © 2010 by Pearson', metadata: { rights: 'Should not be used' } });
  assert.equal(d.copyright.value, 'Copyright © 2010 by Pearson');
  assert.equal(d.copyright.computed, false);
});

test("book details: Emboss's own publisher fallback (\"Emboss Braille Editor\") is not offered as a pre-fill", () => {
  const d = R.titlepageBookDetails({ ...plainDoc(), metadata: { publisher: 'Emboss Braille Editor' } });
  assert.equal(d.publisher.value, '');
});

test('book details: a document with nothing set gets blank pre-fills, not throw', () => {
  const d = R.titlepageBookDetails({});
  for (const seg of ['title', 'authors', 'publisher', 'copyright', 'isbn']) assert.ok(seg in d);
});

// ---------------------------------------------------------------------------------------------------------------
// The US reproduction notice (TP-7 / P3: editable, with a warning) and the UK draft (TP-8 / P4).
test('book details: REPRODUCTION_NOTICES holds the confirmed 2020 US wording', () => {
  assert.equal(R.REPRODUCTION_NOTICES.US, 'Any further reproduction or distribution other than in an accessible format is an infringement.');
});

test('book details: the UK accessible-copy statement names the work and is marked a draft in the doc, not in the wording', () => {
  const s = R.ukAccessibleCopyStatement({ title: 'Alice in Wonderland', authors: ['Lewis Carroll'] });
  assert.match(s, /Alice in Wonderland/);
  assert.ok(!/unverified/i.test(s), 'the braille wording itself must not carry the draft warning');
});
