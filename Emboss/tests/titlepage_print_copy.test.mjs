// K29 Stage 1d: the "Print title page…" HTML builder (format/titlepage-print.mjs), written first against
// format/titlepage-print.mjs before it exists (this file's first run must fail with a module-not-found —
// see the report). Covers design docs/transcriber-pages-customisation-design.md §4/§5 row "1d Print
// copy" and KD's round-2 answer 5d (questions-register.md): the title page's own lines with current
// field values, both notices (BANA: copyright + reproduction notice, already lines of the Publisher
// segment), the Special Symbols and Transcriber's Notes page content for BANA, and UKAAF's "Note to
// Braille Edition" + notice page with no Symbols page (decisions.md UK-8/UK-9).
import test from 'node:test';
import assert from 'node:assert/strict';

const { buildTitlePagePrintPages, titlePagePrintHtml, escapeHtml } = await import('../format/titlepage-print.mjs');

function bookModel(extra = {}, tpBlock = { auto: true }, extraBlocks = []) {
  return {
    title: 'Prentice Hall Literature',
    metadata: { docauthors: ['Jane Author'], publisher: 'Pearson', source: '978-0-13-123456-7' },
    tpTranscriber: 'Pat Transcriber',
    tpCountry: 'US',
    tpPublishedBy: 'published',
    ...extra,
    blocks: [
      { type: 'titlepage', matter: 'transcriber', ...tpBlock },
      ...extraBlocks,
      { type: 'heading', level: 1, text: 'Prentice Hall Literature' },
      { type: 'para', text: 'Chapter one.' },
    ],
  };
}
const allLines = (pages) => pages.flatMap((p) => [p.heading, ...(p.lines || [])]).filter(Boolean).join('\n');

test('BANA: title page lines carry the book\'s current field values', () => {
  const doc = bookModel();
  const pages = buildTitlePagePrintPages(doc, { mode: 'bana' });
  const tp = pages.find((p) => p.id === 'titlepage');
  assert.ok(tp, 'a title page section exists');
  const text = tp.lines.join('\n');
  assert.match(text, /Prentice Hall Literature/);
  assert.match(text, /Jane Author/);
  assert.match(text, /Pearson/);
});

test('BANA: both notices (copyright and reproduction) appear on the title page', () => {
  const doc = bookModel({ tpCopyright: '© 2020 Pearson' });
  const pages = buildTitlePagePrintPages(doc, { mode: 'bana' });
  const tp = pages.find((p) => p.id === 'titlepage');
  const text = tp.lines.join('\n');
  assert.match(text, /2020 Pearson/);
  assert.match(text, /Any further reproduction or distribution other than in an accessible format is an infringement\./);
});

test('BANA: an edited title page\'s own wording is used, refreshed to current field values (TP-6)', () => {
  const editedSegments = [
    { name: 'Title', lines: [{ parts: [{ fld: 'title', value: 'stale title' }] }] },
  ];
  const doc = bookModel({}, { segments: editedSegments });
  const pages = buildTitlePagePrintPages(doc, { mode: 'bana' });
  const tp = pages.find((p) => p.id === 'titlepage');
  // The edited page kept only the Title line (its own structure); the VALUE is refreshed to the
  // document's current title, never the stale value captured when the line was first typed.
  assert.deepEqual(tp.lines, ['Prentice Hall Literature']);
});

test('BANA: the Special Symbols page content is included when the document has one', () => {
  const doc = bookModel({}, { auto: true }, [
    { type: 'sympage', matter: 'transcriber', entries: [{ print: '•', braille: '⠒', description: 'Bullet' }] },
  ]);
  const pages = buildTitlePagePrintPages(doc, { mode: 'bana' });
  const sym = pages.find((p) => p.id === 'symbols');
  assert.ok(sym, 'a symbols section exists');
  assert.equal(sym.heading, 'Special Symbols Used in This Volume');
  assert.ok(sym.lines.some((l) => l.includes('Bullet')));
});

test('BANA: the Transcriber’s Notes page content is included when the document has one', () => {
  const doc = bookModel({}, { auto: true }, [
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'Nemeth code is used for mathematics.' }] },
  ]);
  const pages = buildTitlePagePrintPages(doc, { mode: 'bana' });
  const notes = pages.find((p) => p.id === 'notes');
  assert.ok(notes, 'a notes section exists');
  assert.equal(notes.heading, 'Transcriber’s Notes');
  assert.ok(notes.lines.some((l) => l.includes('Nemeth code is used for mathematics.')));
});

test('BANA: no Symbols/Notes pages are produced when the document has none', () => {
  const doc = bookModel();
  const pages = buildTitlePagePrintPages(doc, { mode: 'bana' });
  assert.equal(pages.find((p) => p.id === 'symbols'), undefined);
  assert.equal(pages.find((p) => p.id === 'notes'), undefined);
});

test('UKAAF: uses the Note to Braille Edition page and has NO Special Symbols page (UK-8)', () => {
  const doc = bookModel({ tpCountry: undefined }, { auto: true }, [
    { type: 'sympage', matter: 'transcriber', entries: [{ print: '•', braille: '⠒', description: 'Bullet' }] },
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'This is entirely the transcriber’s own note.' }] },
  ]);
  const pages = buildTitlePagePrintPages(doc, { mode: 'ukaaf' });
  assert.equal(pages.find((p) => p.id === 'symbols'), undefined, 'UKAAF has no Special Symbols page (UK-8)');
  const notes = pages.find((p) => p.id === 'notes');
  assert.ok(notes, 'a notes section exists');
  assert.equal(notes.heading, 'Note to Braille Edition');
  assert.ok(notes.lines.some((l) => l.includes('own note')));
});

test('UKAAF: the accessible-copy notice appears on its own page after the title page (UK-9)', () => {
  const doc = bookModel({ tpCountry: undefined });
  const pages = buildTitlePagePrintPages(doc, { mode: 'ukaaf' });
  const notice = pages.find((p) => p.id === 'notice');
  assert.ok(notice, 'a notice section exists');
  assert.match(notice.lines.join(' '), /section 31B of the Copyright, Designs and Patents Act 1988/);
});

test('no title page block -> no pages at all (nothing to print)', () => {
  const doc = { title: 'No title page', blocks: [{ type: 'para', text: 'Hello.' }] };
  assert.deepEqual(buildTitlePagePrintPages(doc, { mode: 'bana' }), []);
});

test('escapeHtml escapes HTML-significant characters', () => {
  assert.equal(escapeHtml('<script>alert("hi")</script> & Tom & Jerry\'s'), '&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt; &amp; Tom &amp; Jerry&#39;s');
});

test('titlePagePrintHtml: transcriber-typed names are escaped in the rendered HTML', () => {
  const doc = bookModel({ metadata: { docauthors: ['<b>Evil</b> Author'], publisher: 'A & B Books', source: '978-0-13-123456-7' } });
  const html = titlePagePrintHtml(doc, { mode: 'bana' });
  assert.doesNotMatch(html, /<b>Evil<\/b>/);
  assert.match(html, /&lt;b&gt;Evil&lt;\/b&gt; Author/);
  assert.match(html, /A &amp; B Books/);
});

test('titlePagePrintHtml: one page each, plain markup, no app chrome', () => {
  const doc = bookModel({}, { auto: true }, [
    { type: 'sympage', matter: 'transcriber', entries: [{ print: '•', braille: '⠒', description: 'Bullet' }] },
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'A note.' }] },
  ]);
  const html = titlePagePrintHtml(doc, { mode: 'bana' });
  const pageCount = (html.match(/class="print-page"/g) || []).length;
  assert.equal(pageCount, 3, 'title page + symbols + notes, one section each');
  assert.match(html, /page-break-after/);
  assert.doesNotMatch(html, /toolbar|editor-header|emboss-sidebar-card/i, 'no app chrome leaks into the print copy');
});

test('titlePagePrintHtml returns a document with no print-page sections when there is no title page', () => {
  const doc = { title: 'No title page', blocks: [{ type: 'para', text: 'Hello.' }] };
  const html = titlePagePrintHtml(doc, { mode: 'bana' });
  assert.equal((html.match(/class="print-page"/g) || []).length, 0);
});
