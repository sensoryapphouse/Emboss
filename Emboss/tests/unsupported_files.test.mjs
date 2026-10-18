// Feedback 30 Sep 2026, item 2 (Paul, 1 Oct: keep every format; refuse what Emboss cannot read): a file of a kind Emboss does not
// read fell through to the plain-text reader — a dropped PDF (the file a teacher is most likely to have) was "transcribed" as its raw
// bytes ("%PDF-1.4 1 0 obj…"), with Braille ready and a Download button. Drag-and-drop skips the file picker's own type list. Now
// such a file is refused with a plain message (a userFacing error, shown as it is by Quick Mode and the editor); a text file with
// another extension (.csv, none) is still read as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseFile } from '../input/parse.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const bytes = (...b) => new Uint8Array([...b, ...new Array(64).fill(0)]).buffer;
const refused = async (name, data, re) => {
  await assert.rejects(parseFile(name, data), (e) => { assert.equal(e.userFacing, true, name); assert.match(e.message, re, name); return true; });
};

test('a PDF is refused with a plain message, by extension or by its content', async () => {
  await refused('lesson.pdf', '%PDF-1.4\n1 0 obj<<>>endobj\n', /can't read PDF files.*Word/s);
  await refused('lesson.pdf', bytes(0x25, 0x50, 0x44, 0x46, 0x2d), /can't read PDF files/);
  await refused('lesson', '%PDF-1.7\n%âãÏÓ\n', /can't read PDF files/);
});

test('pictures, spreadsheets, presentations, Apple files and other binary files are refused', async () => {
  await refused('photo.jpg', bytes(0xff, 0xd8, 0xff, 0xe0), /picture, not a document/);
  await refused('scan.png', bytes(0x89, 0x50, 0x4e, 0x47), /picture, not a document/);
  for (const n of ['marks.xlsx', 'talk.pptx', 'essay.pages', 'slides.key', 'data.numbers', 'old.xls', 'deck.ppt', 'sheet.ods', 'show.odp']) await refused(n, bytes(0x50, 0x4b, 0x03, 0x04), /can't read .* files/);
  await refused('thing.bin', bytes(0x00, 0x01, 0x02, 0x03, 0xfe), /can't read this kind of file/);
});

test('text files are still read as text', async () => {
  for (const [n, t] of [['notes.txt', 'Hello there.'], ['marks.csv', 'name,mark\nAnn,7'], ['README', 'Read me.'], ['a.log', 'line one']]) {
    const m = await parseFile(n, t);
    assert.ok(m.blocks.length > 0, n);
  }
});
