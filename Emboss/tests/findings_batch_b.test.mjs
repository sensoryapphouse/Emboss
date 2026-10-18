// Findings batch B (formatter side, 23 Sep 2026): F-145/F-83/F-159 (ignore font attributes), F-147 (contents list on a new
// page), F-64 (interpoint: no even page number), F-61 (running-head key words), F-54 (end-of-volume statements).
// Every new field is optional; a document or block without it is formatted as before (checked per finding).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock, formatDocument, formatVolumes, getBlockSignature } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
// A stand-in translator that shows emphasis: an emphasised run comes out as "{...}".
const mark = (t, tf) => {
  const s = up(t);
  if (Array.isArray(tf)) { let r = '', open = false; for (let i = 0; i < s.length; i++) { const on = !!tf[i]; if (on && !open) r += '{'; if (!on && open) r += '}'; open = on; r += s[i]; } return open ? r + '}' : r; }
  return tf ? `{${s}}` : s;
};
// document.mjs's own header comment requires o.translatePos to mirror o.translate exactly
// ("o.translatePos... mirrors o.translate"); since the "one layout path" stage 2 task routes
// formatBlock's 'para'/'heading'/'list'/'box' cases through traceBlockCore too, formatBlock
// itself now prefers translatePos over translate whenever the caller supplies one
// (previously formatPara/formatHeading/formatList/formatBox never looked at translatePos at
// all, so a typeform-blind stand-in was harmless here). `mark` must be mirrored, not just `up`.
const markPos = (s, tf) => { const b = mark(s, tf); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(s).length - 1))) }; };
const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: mark, translatePos: markPos, suppressHeader: true };
const rstrip = (l) => l.replace(/\s+$/, '');
// traceBlock's own translator (translatePos) cannot see typeforms via traceBlock's editor call
// shape (typeformWordPunct precedes it), so parity is checked against a typeform-blind twin of `o`.
const ob = { ...o, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
const both = (block, opts = o) => {
  const f = formatBlock(block, opts).map(rstrip);
  const t = traceBlock(block, ob).map((x) => rstrip(x.s));
  assert.deepEqual(t, formatBlock(block, ob).map(rstrip), 'traceBlock must match formatBlock');
  return f;
};
const sig = (b) => getBlockSignature(b, o, false);
const it = (text) => ({ type: 'text', text, tf: 1 });
const pl = (text) => ({ type: 'text', text });

describe('F-145 / F-83 / F-159: ignore font attributes on a marker', () => {
  const segs = [it('Dedicated '), pl('to '), it('you')];
  test('default: emphasis kept', () => {
    assert.ok(both({ type: 'para', segments: segs }).join('').includes('{'));
  });
  test('block.ignoreFont drops every run (2.9.1f dedication)', () => {
    const b = { type: 'para', ignoreFont: true, segments: segs };
    const plain = { type: 'para', segments: segs.map((s) => ({ type: 'text', text: s.text })) };
    assert.deepEqual(both(b), both(plain));
    assert.equal(b.segments[0].tf, 1, 'input not mutated');
    assert.notEqual(sig(b), sig({ type: 'para', segments: segs }));
  });
  test('segment.ignoreFont drops that run only (the transcriber\'s own judgement call, e.g. 5.3.2 — TF-1, 28 Sep 2026: no longer 5.3.11, withdrawn)', () => {
    const b = { type: 'para', segments: [{ ...it('dis-'), ignoreFont: true }, it('other')] };
    const out = both(b).join(' ');
    assert.ok(out.includes('DIS-') && !out.includes('{DIS-}'));
    assert.ok(out.includes('{OTHER}'));
  });
  test('item.ignoreFont and item segment marker in a list', () => {
    const b = { type: 'list', items: [{ level: 0, segments: [it('one')], ignoreFont: true }, { level: 0, segments: [it('two')] }] };
    const out = both(b).join(' ');
    assert.ok(!out.includes('{ONE}') && out.includes('{TWO}'), out);
  });
  test('diacriticNotation drops the font attribute of runs that carry a stress mark only (20.4.2)', () => {
    const b = { type: 'para', diacriticNotation: true, segments: [it('māz'), it('plain')] };
    const out = both(b).join(' ');
    assert.ok(!out.includes('{MA'), out);
    assert.ok(out.includes('{PLAIN}'), out);
    assert.notEqual(sig(b), sig({ ...b, diacriticNotation: false }));
  });
  test('math runs and a block with no font marks are untouched', () => {
    const b = { type: 'para', segments: [it('x')] };
    assert.deepEqual(both(b), both({ ...b, ignoreFont: false }));
  });
  test('F-120: a line number in a note never carries a font attribute already', () => {
    const b = { type: 'para', segments: [{ type: 'linenum', text: '5', tf: 1 }, pl('text')] };
    assert.ok(!both(b).join('').includes('{5}'));
  });
});

const filler = Array.from({ length: 6 }, (_, i) => ({ type: 'para', text: `filler paragraph ${i}` }));
const docOpts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up };
const pagesOf = (brf) => brf.replace(/\r/g, '').split('\f').map((p) => p.replace(/\n$/, '').split('\n'));

describe('F-147 / BANA 2.10.2b: a block can open a new braille page', () => {
  const toc = { type: 'list', kind: 'toc', items: [{ level: 0, text: 'Chapter one', page: '1' }] };
  test('default: the contents list follows the paragraph on the same page', () => {
    const ps = pagesOf(formatDocument({ title: 'T', blocks: [...filler, toc] }, docOpts));
    assert.equal(ps.length, 1);
  });
  test('pageBreakBefore: it starts page 2', () => {
    const ps = pagesOf(formatDocument({ title: 'T', blocks: [...filler, { ...toc, pageBreakBefore: true }] }, docOpts));
    assert.equal(ps.length, 2);
    assert.ok(ps[1].join('\n').includes('CHAPTER ONE'));
    assert.ok(!ps[0].join('\n').includes('CHAPTER ONE'));
  });
  test('a block that already opens a page gets no blank page', () => {
    const ps = pagesOf(formatDocument({ title: 'T', blocks: [{ ...toc, pageBreakBefore: true }, ...filler] }, docOpts));
    assert.equal(ps.length, 1);
  });
  test('field is in the cache key', () => {
    assert.notEqual(sig(toc), sig({ ...toc, pageBreakBefore: true }));
  });
});

describe('F-64 / BANA 1.15.1f: interpoint, no even braille page number', () => {
  const many = Array.from({ length: 90 }, (_, i) => ({ type: 'para', text: `line ${i}` }));
  const footer = (page) => page[page.length - 1];
  test('default: every page carries its number', () => {
    const ps = pagesOf(formatDocument({ title: 'T', blocks: many }, docOpts));
    assert.ok(ps.length >= 4);
    ps.forEach((p, i) => assert.match(footer(p).trim(), /#[A-J]+$/, `page ${i + 1}`));
  });
  test('interpointOmitEven: odd pages keep the number, even pages have none; body text unchanged', () => {
    const base = pagesOf(formatDocument({ title: 'T', blocks: many }, docOpts));
    const ps = pagesOf(formatDocument({ title: 'T', blocks: many }, { ...docOpts, interpointOmitEven: true }));
    assert.equal(ps.length, base.length);
    ps.forEach((p, i) => {
      if ((i + 1) % 2 === 1) assert.equal(footer(p), footer(base[i]));
      else assert.equal(footer(p).trim(), '', `page ${i + 1}`);
      assert.deepEqual(p.slice(0, -1), base[i].slice(0, -1));
    });
  });
  test('UKAAF ignores the field', () => {
    const uk = { mode: 'ukaaf', width: 38, depth: 25, translate: up };
    assert.equal(formatDocument({ title: 'T', blocks: many }, { ...uk, interpointOmitEven: true }), formatDocument({ title: 'T', blocks: many }, uk));
  });
});

describe('F-61 / BANA 1.8.2e: running head from the transcriber\'s key words', () => {
  const long = 'The Extraordinary Adventures of a Very Long Titled Person in Many Lands';
  const many = Array.from({ length: 90 }, (_, i) => ({ type: 'para', text: `line ${i}` }));
  test('default: an over-long title is omitted from the running head', () => {
    const ps = pagesOf(formatDocument({ title: long, blocks: many }, docOpts));
    assert.ok(!ps[1][0].includes('ADVENTURES'));
  });
  test('runningHeadKeyWords: used when the full title does not fit; a fitting title is left alone', () => {
    const ps = pagesOf(formatDocument({ title: long, runningHeadKeyWords: 'Adventures', blocks: many }, docOpts));
    assert.ok(ps[1][0].includes('ADVENTURES'), ps[1][0]);
    const ps2 = pagesOf(formatDocument({ title: 'Short', runningHeadKeyWords: 'Other', blocks: many }, docOpts));
    assert.ok(ps2[1][0].includes('SHORT') && !ps2[1][0].includes('OTHER'));
  });
});

describe('F-54 / BANA 1.6.5: end-of-volume statements', () => {
  const eov = { ...docOpts, endOfVolume: true, volumePages: 1 };
  const lines = (n, w = 'L') => Array.from({ length: n }, (_, i) => ({ type: 'para', continuation: true, blocked: true, text: `${w}${i}` }));
  const brk = (t) => ({ type: 'para', continuation: true, blocked: true, pageBreakBefore: true, text: t });
  const doc = (n, tail = 3) => ({ title: 'T', blocks: [...lines(n), brk('NEXT'), ...lines(tail, 'M')] });
  const lastPage = (v) => pagesOf(v.brf).pop();
  const stmtRe = /^@\.<END OF VOLUME \d@\.>$/;
  test('default: no statement anywhere', () => {
    const vs = formatVolumes(doc(10), { ...docOpts, volumePages: 1 });
    assert.ok(!vs.some((v) => v.brf.includes('@.<')));
  });
  test('(a)(b)(c): blank line, centred statement in note indicators; The End only in the final volume', () => {
    const vs = formatVolumes(doc(10), eov);
    const p1 = pagesOf(vs[0].brf).pop();
    const i = p1.findIndex((l) => l.includes('@.<'));
    assert.equal(p1[i - 1].trim(), '', 'blank line before');
    assert.equal(p1[i - 2], 'L9');
    assert.match(p1[i].trim(), stmtRe);
    assert.ok(p1[i].startsWith(' '), 'centred');
    assert.ok(!vs[0].brf.includes('THE END'));
    const pl = lastPage(vs[vs.length - 1]);
    const j = pl.findIndex((l) => l.includes('@.<'));
    assert.match(pl[j].trim(), /^@\.<END OF VOLUME 2@\.>$/);
    assert.match(pl[j + 1].trim(), /^@\.<THE END@\.>$/);
    assert.ok(pl[j].startsWith(' ') && pl[j + 1].startsWith(' '));
  });
  test('(d): text ends on the next-to-last line, statement goes on the last line', () => {
    const vs = formatVolumes(doc(21), eov);   // page 1 also holds the book title and a blank line
    const p1 = pagesOf(vs[0].brf).pop();
    assert.equal(p1[22].trim(), 'L20');
    assert.match(p1[23].trim(), stmtRe);
    assert.match(p1[24].trim(), /#A$/, 'page number line intact');
  });
  test('(e): text on the last line, statement on the same line after three blank cells', () => {
    const vs = formatVolumes(doc(22), eov);
    const p1 = pagesOf(vs[0].brf).pop();
    assert.match(p1[23], /^L21 {3}@\.<END OF VOLUME 1@\.>$/);
  });
  test('(f): no room even on that line, one line of text is carried to a new page with the statement', () => {
    const long = { type: 'para', continuation: true, blocked: true, text: 'a line of text that fills the row' };
    const d = { title: 'T', blocks: [...lines(21), long, brk('NEXT'), ...lines(3, 'M')] };
    const vs = formatVolumes(d, eov);
    const ps = pagesOf(vs[0].brf);
    const full = ps[ps.length - 2], carry = ps[ps.length - 1];
    assert.equal(full[23], '', 'carried line leaves its page');
    assert.match(full[24].trim(), /#A$/);
    assert.equal(carry[0].trim(), 'T', 'running head kept');
    assert.equal(carry[1], 'A LINE OF TEXT THAT FILLS THE ROW');
    assert.equal(carry[2], '');
    assert.match(carry[3].trim(), stmtRe);
    assert.match(carry[24].trim(), /#B$/);
    assert.equal(carry.length, 25);
  });
  test('(f) with a print page number: the carried page takes the next continuation letter', () => {
    const long = { type: 'para', continuation: true, blocked: true, text: 'a line of text that fills the row' };
    const d = { title: 'T', blocks: [{ type: 'pagenum', page: '5', text: '5' }, ...lines(20), long, brk('NEXT'), ...lines(3, 'M')] };
    const ps = pagesOf(formatVolumes(d, eov)[0].brf);
    const full = ps[ps.length - 2], carry = ps[ps.length - 1];
    assert.ok(full.some((l) => /^-+5$/.test(l.trim())), 'print page change on page 1');
    assert.match(carry[0].trimEnd(), /(^|\s)A5$/);
    assert.match(carry[carry.length - 1].trim(), /#B$/);
    assert.ok(carry.some((l) => /@\.<END OF VOLUME 1@\.>/.test(l)));
  });
  // KD, round 2 Q10b (28 Sep 2026): a one-volume book carries "The End" only, not "End of Volume 1".
  test('a single volume gets "The End" only when the option is on', () => {
    const vs = formatVolumes({ title: 'T', blocks: lines(5) }, { ...docOpts, endOfVolume: true });
    assert.equal(vs.length, 1);
    assert.ok(vs[0].brf.includes('THE END') && !vs[0].brf.includes('END OF VOLUME'));
  });
  test('UKAAF ignores the field', () => {
    const uk = { mode: 'ukaaf', width: 38, depth: 25, translate: up, volumePages: 1 };
    const a = formatVolumes(doc(10), uk), b = formatVolumes(doc(10), { ...uk, endOfVolume: true });
    assert.deepEqual(b.map((v) => v.brf), a.map((v) => v.brf));
  });
});
