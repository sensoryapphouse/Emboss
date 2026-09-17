// A30: line-numbered prose (BANA Formats §15.3–15.4; Paul, 16 Sep: option 2).
// DTBook marks only the print lines that are numbered, so Emboss shows those numbers and
// does not invent the others:
//  - the number stands at the right margin of the braille line on which its print line
//    begins, with the numeric indicator (§15.3.1b); it is not repeated on runovers (§15.3.1d);
//  - numbered text ends at least two cells before the document's widest number (§15.3.1c);
//  - a numbered print line beginning mid braille line is preceded by three blank cells
//    (§15.4.1c); two numbered print lines never start on one braille line (§15.4.1e);
//  - a transcriber's note before the first numbered text says so (§15.4.1d);
//  - page numbers are on their own lines in both modes, so §15.3.1a holds by construction;
//  - paragraphs without numbers keep the full width (§15.3.1f).
// Parser: <span class="linenum"> / <linenum> outside verse → { type: 'linenum' } segment;
// the save writes <span class="linenum"> back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock, formatDocument } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const up = (s) => String(s).toUpperCase();
// A stand-in translator: digits become the UEB numeric form so numbers look like braille.
const DIG = 'JABCDEFGHI';
const tr = (s) => up(s).replace(/\d+/g, (d) => '#' + [...d].map((c) => DIG[c]).join(''));
const opts = (mode, extra = {}) => ({ mode, width: 40, depth: 25, translate: tr, translatePos: (s) => ({ braille: tr(s), inputPos: Array.from(tr(s), (_, i) => Math.min(i, s.length - 1)) }), ...extra });
const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');
const para = (...parts) => ({ type: 'para', segments: parts.map((p) => (typeof p === 'string' ? { type: 'text', text: p } : { type: 'linenum', text: String(p.n) })) });

test('parser keeps prose line numbers as segments and the save writes them back', () => {
  const src = `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>T</h1><p>She swam down and <span class="linenum">270</span> opened the doors.</p></level1></bodymatter></book></dtbook>`;
  const d = parseDtbook(src);
  const p = d.blocks.find((b) => b.type === 'para');
  assert.deepEqual(p.segments, [{ type: 'text', text: 'She swam down and ' }, { type: 'linenum', text: '270' }, { type: 'text', text: ' opened the doors.' }]);
  assert.equal(p.text, 'She swam down and opened the doors.');
  const xml = exportToNimasXml(d);
  assert.match(xml, /and <span class="linenum">270<\/span> opened/);
  assert.deepEqual(parseDtbook(xml).blocks.find((b) => b.type === 'para').segments, p.segments);
});

test('the number is at the right margin of the line where its print line begins', () => {
  const b = para(words(3), { n: 10 }, words(12, 'next'));
  for (const mode of ['bana', 'ukaaf']) {
    const o = opts(mode);
    const lines = formatBlock(b, o);
    const numbered = lines.filter((l) => /#AJ$/.test(l));
    assert.equal(numbered.length, 1, JSON.stringify(lines));                         // not repeated (§15.3.1d)
    const l = numbered[0];
    assert.equal(l.length, 40);                                                          // right margin
    assert.match(l, /WORD {3}NEXT/, 'three blank cells before a print line that begins mid line');
    assert.ok(lines.every((x) => x.replace(/ +#[A-J]+$/, '').length <= 40 - 3 - 2), 'text ends two cells before the number');
    assert.deepEqual(traceBlock(b, o).map((t) => t.s), lines);
  }
});

test('two numbered print lines never start on one braille line; unnumbered text keeps full width', () => {
  const b = para('one ', { n: 5 }, 'two ', { n: 10 }, 'three ', { n: 15 }, 'four');
  const lines = formatBlock(b, opts('bana'));
  assert.deepEqual(lines.map((l) => l.replace(/ {2,}(#[A-J]+)$/, ' |$1')), ['  ONE   TWO |#E', 'THREE |#AJ', 'FOUR |#AE']);
  const plain = formatBlock(para(words(20)), opts('bana', { lineNumberWidth: 3 }));
  assert.ok(plain.some((l) => l.length > 35), 'a paragraph without numbers uses the full line');
});

test('the widest number in the document sets the text width', () => {
  const b = para(words(20), { n: 5 });
  const narrow = formatBlock(b, opts('bana'));
  const wide = formatBlock(b, opts('bana', { lineNumberWidth: 5 }));
  assert.ok(Math.max(...wide.map((l) => l.replace(/ +#[A-J]+$/, '').length)) <= 40 - 5 - 2);
  assert.notDeepEqual(narrow, wide);
});

test('a transcriber’s note precedes the first line-numbered text only', () => {
  const doc = { title: '', blocks: [{ type: 'para', text: 'Intro.' }, para('Start ', { n: 1 }, 'of the text'), para('More ', { n: 2 }, 'text')] };
  for (const mode of ['bana', 'ukaaf']) {
    const brf = formatDocument(doc, opts(mode));
    const notes = brf.split('\r\n').filter((l) => l.includes('@.<'));
    assert.equal(notes.length, 1, brf);
    assert.match(brf, /LINE NUMBERS ARE SHOWN/);
    assert.ok(brf.indexOf('@.<') < brf.indexOf('START'));
  }
});

test('list items keep their line numbers too', () => {
  const b = { type: 'list', items: [{ text: 'An item', segments: [{ type: 'text', text: 'An item ' }, { type: 'linenum', text: '30' }, { type: 'text', text: 'continues' }] }] };
  const lines = formatBlock(b, opts('bana'));
  assert.ok(lines.some((l) => /#CJ$/.test(l) && l.length === 40), JSON.stringify(lines));
  assert.deepEqual(traceBlock(b, opts('bana')).map((t) => t.s), lines);
});

test('elsewhere (headings, cells) a line number is left out of the braille', () => {
  const h = { type: 'heading', level: 2, text: 'Head', segments: [{ type: 'text', text: 'Head ' }, { type: 'linenum', text: '5' }] };
  assert.ok(formatBlock(h, opts('bana')).every((l) => !l.includes(String.fromCharCode(1)) && !/#E/.test(l)));
});
