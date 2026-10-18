// K29 Stage 1c: the Title Page block's own model -> NIMAS -> parse round trip (the editor's Lexical
// node is covered separately by tests/test-titlepage-editor.mjs, a Playwright suite — this file only
// exercises input/nimas-export.mjs's renderTitlePageLevel and input/parse.mjs's parseTitlePage against
// a plain `titlepage` block, the way buildModel() would hand one to the exporter).
//
// Two cases per design §5 row "1c": an UNEDITED (auto) page, whose content is always computed fresh
// from the document's book-detail fields (never stored on the block — design §3.2), and an EDITED page,
// whose block.segments (the transcriber's own line/chip structure) must round-trip byte-for-byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const EX = await import('../input/nimas-export.mjs');
const { parseDtbook } = await import('../input/parse.mjs');
const FR = await import('../format/field-registry.mjs');
const DOC = await import('../format/document.mjs');

const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
const EXPORT_OPTS = { uid: 'titlepage-roundtrip-test', date: '2026-01-01' };
const exportModel = (m) => quiet(() => EX.exportToNimasXml(m, EXPORT_OPTS));
const parse = (xml) => quiet(() => parseDtbook(xml));

// `tpBlock` defaults to an untouched (auto) page — {auto:true}, no stored content, per design §3.2 and
// the same convention as sympage's own `auto`/`entries` block shape (nodeToBlocks, editor.mjs). Pass
// `{ segments: [...] }` (no `auto`) for an edited page.
function bookModel(extraOptions = {}, tpBlock = { auto: true }) {
  return {
    title: 'Prentice Hall Literature',
    metadata: { docauthors: ['Jane Author'], publisher: 'Pearson', source: '978-0-13-123456-7' },
    tpTranscriber: 'Pat Transcriber',
    tpCountry: 'US',
    ...extraOptions,
    blocks: [
      { type: 'titlepage', matter: 'transcriber', ...tpBlock },
      { type: 'heading', level: 1, text: 'Prentice Hall Literature' },
      { type: 'para', text: 'Chapter one.' },
    ],
  };
}

test('titlepage: an unedited (auto) page exports full, current field content with the auto marker', () => {
  const model = bookModel();
  const xml = exportModel(model);
  assert.match(xml, /<level1 class="bana-title-page bana-tp-auto">/);
  assert.match(xml, /<div class="bana-tp-segment" title="Title">/);
  assert.match(xml, /<span class="bana-field" title="title">Prentice Hall Literature<\/span>/);
  assert.match(xml, /<div class="bana-tp-segment" title="Transcriber">/);
  assert.match(xml, /<span class="bana-field" title="transcriber">Pat Transcriber<\/span>/);
  // BANA addendum 2.3.6e: the US reproduction notice, computed from tpCountry with no override typed.
  assert.match(xml, /Any further reproduction or distribution other than in an accessible format is an infringement\./);
  // TP-11: a single-volume book states "In 1 Volume" unconditionally.
  assert.match(xml, /<span class="bana-field" title="totalVolumes">1<\/span> Volume/);
  assert.doesNotMatch(xml, /Volume 1<\/span>/);
});

// UK-9 (28 Sep, docs/decisions.md): a bug found and fixed while checking a real UKAAF save against
// daisy-validate.mjs — renderTitlePageLevel always computed an AUTO page's saved wording from
// titlePageTemplateSegments' BANA default, regardless of the document's own format mode (the editor
// card and the braille pane were already mode-aware; the exported XML was not). exportToNimasXml now
// reads `options.mode`/`options.standard` (editor.mjs passes `mode: settings.mode` at every call site)
// and threads it to renderTitlePageLevel, which only matters for an untouched/auto page — an edited
// page's own segments are replayed exactly regardless of mode, as the test below it confirms.
test('titlepage: an unedited (auto) UKAAF page saves UK-9\'s own content, not BANA\'s default', () => {
  const model = bookModel();   // same book details as the BANA test above, including tpTranscriber/tpCountry
  const xml = quiet(() => EX.exportToNimasXml(model, { ...EXPORT_OPTS, mode: 'ukaaf' }));
  assert.match(xml, /<level1 class="bana-title-page bana-tp-auto">/);
  assert.match(xml, /<div class="bana-tp-segment" title="Title">/);
  assert.match(xml, /<span class="bana-field" title="title">Prentice Hall Literature<\/span>/);
  // UK-9: no Transcriber SEGMENT on the title page itself, even though tpTranscriber IS set in book
  // details (it still round-trips as ordinary document metadata, <meta name="bana-tp-transcriber">,
  // same as every other book-detail field — UK-9 only hides it from the title page's own content).
  assert.doesNotMatch(xml, /<div class="bana-tp-segment" title="Transcriber">/);
  assert.match(xml, /<meta name="bana-tp-transcriber" content="Pat Transcriber" \/>/);
  // UK-9: the volume notice in WORDS ("In one volume"), not BANA's Arabic "In 1 Volume".
  assert.match(xml, /<span class="bana-field" title="totalVolumesWords">one<\/span> volume/);
  assert.doesNotMatch(xml, /title="totalVolumes">1<\/span> Volume/);
  // Without a `mode` option at all (every OTHER existing caller in this file/elsewhere), the default
  // stays BANA — this one option is additive, not a behaviour change for anyone who hasn't opted in.
  const defaultXml = exportModel(model);
  assert.match(defaultXml, /<div class="bana-tp-segment" title="Transcriber">/);
});

test('titlepage: an unedited page parses back to {auto:true}, no stored segments', () => {
  const xml = exportModel(bookModel());
  const parsed = parse(xml);
  const tp = parsed.blocks.find((b) => b.type === 'titlepage');
  assert.ok(tp, 'titlepage block round-trips');
  assert.equal(tp.auto, true);
  assert.equal(tp.segments, undefined);
  assert.equal(tp.matter, 'transcriber');
});

test('titlepage: an unedited page always sits first in <frontmatter>, before a Special Symbols page', () => {
  const model = bookModel();
  model.blocks.splice(1, 0, { type: 'sympage', matter: 'transcriber', auto: true });
  const xml = exportModel(model);
  const tpIdx = xml.indexOf('bana-title-page');
  const symIdx = xml.indexOf('bana-special-symbols');
  assert.ok(tpIdx >= 0 && symIdx >= 0 && tpIdx < symIdx, 'title page precedes the Special Symbols page');
  const parsed = parse(xml);
  assert.equal(parsed.blocks[0].type, 'titlepage');
  assert.equal(parsed.blocks[1].type, 'sympage');
});

test('titlepage: an edited page keeps its own wording/structure exactly, round trip, with live values (TP-6)', () => {
  const editedSegments = [
    { name: 'Title', lines: [{ parts: [{ fld: 'title', value: 'Prentice Hall Literature' }] }] },
    { name: 'Author', lines: [{ parts: [{ fld: 'authors', idx: 0, value: 'Jane Author' }] }] },
    {
      name: 'Publisher and copyright',
      lines: [
        { parts: [{ lit: 'With permission of ' }, { fld: 'publisher', value: 'Pearson' }] },   // the transcriber retyped "With permission of" over the auto "Published by"
        { parts: [{ lit: 'A note the transcriber added by hand, no field at all.' }] },
      ],
    },
    { name: 'Transcriber', lines: [{ parts: [{ lit: 'Transcribed ' }, { fld: 'transcriptionYear', value: '2026' }, { lit: ' into ' }, { fld: 'brailleCode', value: 'Unified English Braille' }, { lit: ' by ' }, { fld: 'transcriber', value: 'Pat Transcriber' }] }] },
    { name: 'Volume', lines: [{ parts: [{ lit: 'In ' }, { fld: 'totalVolumes', value: '1' }, { lit: ' Volume' }] }] },
  ];
  // A field value that no longer matches what was saved (TP-6: the SAVED FILE reflects the current
  // book details too, not only the editor's own in-memory card — see renderTitlePageLevel's comment).
  const model = bookModel({ tpTranscriber: 'A Later Transcriber' }, { segments: editedSegments });
  const xml = exportModel(model);
  assert.match(xml, /<level1 class="bana-title-page">/);   // no bana-tp-auto: edited
  assert.match(xml, /With permission of <span class="bana-field" title="publisher">Pearson<\/span>/);
  assert.match(xml, /<p>A note the transcriber added by hand, no field at all\.<\/p>/);
  assert.match(xml, /<span class="bana-field" title="authors:0">Jane Author<\/span>/, 'a list field (authors) carries its index as field:idx');
  assert.match(xml, /by <span class="bana-field" title="transcriber">A Later Transcriber<\/span>/, 'the transcriber chip reflects the CURRENT book details, not the stale saved value');

  const parsed = parse(xml);
  const tp = parsed.blocks.find((b) => b.type === 'titlepage');
  assert.ok(tp, 'titlepage block round-trips');
  assert.equal(tp.auto, undefined);
  const expected = editedSegments.map((s) => (s.name !== 'Transcriber' ? s : { name: 'Transcriber', lines: [{ parts: s.lines[0].parts.map((p) => (p.fld === 'transcriber' ? { ...p, value: 'A Later Transcriber' } : p)) }] }));
  assert.deepEqual(tp.segments, expected, 'the wording/structure is exactly as saved; only the live value differs');
});

test('titlepage: field-registry.titlePageTemplateSegments matches document.titlePageFieldsFrom (single source of the fields, TP-6 "always live")', () => {
  const doc = bookModel();
  const fields = DOC.titlePageFieldsFrom(doc);
  assert.equal(fields.title, 'Prentice Hall Literature');
  assert.equal(fields.transcriber, 'Pat Transcriber');
  assert.equal(fields.reproductionNotice, FR.REPRODUCTION_NOTICES.US);
  const segs = FR.titlePageTemplateSegments(fields);
  const titleSeg = segs.find((s) => s.name === 'Title');
  assert.deepEqual(titleSeg.lines[0].parts, [{ fld: 'title', value: 'Prentice Hall Literature' }]);
  const volSeg = segs.find((s) => s.name === 'Volume');
  assert.equal(volSeg.lines.length, 1);   // single volume default: only "In 1 Volume", TP-11
});

test('titlePageStructureSig ignores field VALUES but not structure (TP-6: values never count as an edit)', () => {
  const a = FR.titlePageTemplateSegments(DOC.titlePageFieldsFrom(bookModel()));
  const b = FR.titlePageTemplateSegments(DOC.titlePageFieldsFrom(bookModel({ tpTranscriber: 'A Different Name' })));
  assert.equal(FR.titlePageStructureSig(a), FR.titlePageStructureSig(b), 'a changed field value alone does not change the structural signature');
  const c = FR.titlePageTemplateSegments(DOC.titlePageFieldsFrom(bookModel({ tpTranscriber: '' })));   // drops the whole Transcriber line (2.3.7)
  assert.notEqual(FR.titlePageStructureSig(a), FR.titlePageStructureSig(c), 'a line appearing/disappearing DOES change the structural signature');
});

test('refreshTitlePageValues: an author no longer on the list resolves to empty, not stale text', () => {
  const segments = [{ name: 'Author', lines: [{ parts: [{ fld: 'authors', idx: 1, value: 'Second Author' }] }] }];
  const refreshed = FR.refreshTitlePageValues(segments, { authors: ['Only Author'] }, {});
  assert.equal(refreshed[0].lines[0].parts[0].value, '', 'index 1 no longer exists in a 1-author list');
});
