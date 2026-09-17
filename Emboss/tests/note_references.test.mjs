// Note references and notes (A5 / A27m).
//  - Parser: <noteref>/<annoref> is a segment { type: 'noteref', text, idref }; every
//    DTBook <note> is a footnote (kind 'endnote' when classed so) and keeps its id.
//  - Save: <noteref idref="#…"> points at the note's final id; a reference whose note is
//    not in the document is kept as <span class="noteref"> (no dangling idref), which reads
//    back as a note reference (A2: as plain text the mark ran into the word before it).
//  - Braille: BANA Formats §16.2.2 superscript marks (;9#a, ;9b; asterisk/dagger symbols);
//    §16.5.1 notes follow a separation line ("333333) and move to the end of the print page
//    where they are referenced; UKAAF keeps notes in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const up = (s) => String(s).toUpperCase();
const opts = (mode) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);
const lines = (brf) => brf.replace(/\r/g, '').split('\n');

const SRC = `<p>Text<noteref idref="#n1" class="Footnote">1</noteref> and more<noteref idref="#n2">*</noteref>.</p>
  <pagenum page="normal" id="p2">2</pagenum>
  <p>Page two<noteref idref="#missing">b</noteref>.</p>
  <note id="n1" class="Footnote"><p>1 First note.</p></note>
  <note id="n2"><p>* Second note.</p></note>
  <note id="e1" class="endnote"><p>An endnote.</p></note>`;

test('parser: references are segments, notes are footnotes with ids', () => {
  const d = doc(SRC);
  const p = d.blocks[0];
  assert.deepEqual(p.segments.filter((g) => g.type === 'noteref'), [{ type: 'noteref', text: '1', idref: 'n1' }, { type: 'noteref', text: '*', idref: 'n2' }]);
  const notes = d.blocks.filter((b) => b.type === 'footnote');
  assert.deepEqual(notes.map((n) => [n.id, n.kind || null]), [['n1', null], ['n2', null], ['e1', 'endnote']]);
});

test('save: linked references keep their target; a missing target stays a marked reference', () => {
  const xml = exportToNimasXml(doc(SRC));
  assert.match(xml, /Text<noteref idref="#n1">1<\/noteref>/);
  assert.match(xml, /<noteref idref="#n2">\*<\/noteref>/);
  assert.match(xml, /Page two<span class="noteref">b<\/span>\./);
  assert.doesNotMatch(xml, /#missing/);
  const again = parseDtbook(xml).blocks.flatMap((b) => b.segments || []).filter((g) => g.type === 'noteref').map((g) => g.text);
  assert.ok(again.includes('b'), JSON.stringify(again));
  assert.match(xml, /<note id="e1" class="endnote">/);
});

test('BANA: superscript marks, separation line, notes at the end of the print page', () => {
  const out = lines(formatDocument(doc(SRC), opts('bana')));
  const body = out.join('\n');
  assert.match(body, /TEXT;91 AND MORE"9\./);                // the test translator leaves digits as they are (liblouis: ;9#A)
  const sep = out.indexOf('"333333');
  assert.ok(sep > 0, body);
  const pageTwo = out.findIndex((l) => l.includes('PAGE TWO'));
  assert.ok(sep < pageTwo, 'the page-1 notes come before print page 2');
  assert.ok(out[sep + 1].startsWith('#A FIRST NOTE') || out[sep + 1].startsWith('1 FIRST NOTE'), out[sep + 1]);
  assert.equal(out.filter((l) => l === '"333333').length, 1, 'one separation line for the run of two notes');
  assert.ok(out.findIndex((l) => l.includes('AN ENDNOTE')) > pageTwo, 'the endnote keeps its place');
});

test('UKAAF: notes stay in place, no separation line; marks superscripted', () => {
  const out = lines(formatDocument(doc(SRC), opts('ukaaf')));
  assert.ok(!out.includes('"333333'));
  assert.ok(out.join('\n').includes('TEXT;91'));
  assert.ok(out.findIndex((l) => l.includes('FIRST NOTE')) > out.findIndex((l) => l.includes('PAGE TWO')));
});

test('marks: letters, capitals and daggers; trace matches', () => {
  for (const [mark, want] of [['b', ';9B'], ['C', ';9,C'], ['†', '@,?'], ['‡', '@,]'], ['**', '"9"9']]) {
    const b = { type: 'para', segments: [{ type: 'text', text: 'Word' }, { type: 'noteref', text: mark, idref: 'x' }] };
    const f = formatBlock(b, opts('bana'));
    assert.ok(f.join('').includes(`WORD${want}`), `${mark}: ${JSON.stringify(f)}`);
    assert.deepEqual(traceBlock(b, opts('bana')).map((t) => t.s), f);
  }
  const fn = { type: 'footnote', text: '1 A note.', id: 'n1', noteRunStart: true };
  assert.deepEqual(traceBlock(fn, opts('bana')).map((t) => t.s), formatBlock(fn, opts('bana')));
});

test('a note inside a list item is split out as its own footnote and stays linked', () => {
  const d = doc(`<p>See<noteref idref="#f1">1</noteref>.</p><list type="ul"><li>Item one<note id="f1" class="Footnote"><p>1 The note.</p></note></li><li>Item two</li></list>`);
  assert.deepEqual(d.blocks.map((b) => b.type), ['para', 'list', 'footnote', 'list']);
  assert.equal(d.blocks[1].items[0].text, 'Item one');
  assert.match(exportToNimasXml(d), /<noteref idref="#f1">1<\/noteref>/);
});
