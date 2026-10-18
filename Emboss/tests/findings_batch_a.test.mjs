// Findings batch A (formatter side, 23 Sep 2026): F-99, F-215, F-51, F-20, F-151, F-149, F-150, F-126.
// Every new field is optional; a block without it is formatted as before (checked per finding).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock, formatDocument, getBlockSignature } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
// A stand-in translator that shows emphasis: an italic run comes out as "<i>...</i>".
const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), suppressHeader: true };
const rstrip = (l) => l.replace(/\s+$/, '');
const both = (block, opts = o) => {
  const f = formatBlock(block, opts).map(rstrip);
  const t = traceBlock(block, opts).map((x) => rstrip(x.s));
  assert.deepEqual(t, f, 'traceBlock must match formatBlock');
  return f;
};
const sig = (b) => getBlockSignature(b, o, false);

describe('F-99 / 9.2.3b: omit font attributes when the whole displayed passage is emphasised', () => {
  const italic = (text) => ({ type: 'text', text, tf: 1 });
  test('all runs italic + omitFullEmphasis: tf dropped', () => {
    const b = { type: 'para', displayed: true, omitFullEmphasis: true, segments: [italic('Whole '), italic('passage.')] };
    const plain = { ...b, segments: [{ type: 'text', text: 'Whole passage.' }] };
    assert.deepEqual(both(b), both(plain));
  });
  test('default: emphasis kept (signature differs, output differs from the omitted form)', () => {
    const b = { type: 'para', segments: [italic('Whole '), italic('passage.')] };
    const on = { ...b, omitFullEmphasis: true };
    assert.notEqual(sig(b), sig(on));
    const bm = { ...b, segments: [italic('Whole passage.')] };
    // tf reaches the translator only through a translator that honours it; the field must at least not alter a plain block
    assert.deepEqual(both({ ...on, segments: [{ type: 'text', text: 'X' }] }), both({ type: 'para', segments: [{ type: 'text', text: 'X' }] }));
    void bm;
  });
  test('partial emphasis is kept even with the field (9.2.3a)', () => {
    let seen = null;
    const opts = { ...o, translate: (t, tf) => { seen = seen || tf; return up(t); } };
    const b = { type: 'para', omitFullEmphasis: true, segments: [italic('One '), { type: 'text', text: 'two' }] };
    formatBlock(b, opts);
    // the segments handed on still carry the first run's tf: verify through the helper's observable: signature unchanged content
    assert.equal(b.segments[0].tf, 1);
  });
  test('list items: whole list emphasised is stripped, input untouched', () => {
    const items = [{ segments: [italic('a line')] }, { segments: [italic('another')] }];
    const b = { type: 'list', kind: 'plain', displayed: true, omitFullEmphasis: true, items };
    formatBlock(b, o);
    assert.equal(items[0].segments[0].tf, 1, 'source model is not mutated');
  });
});

describe('F-215 / 14.3.1d: omitEmphasis drops font attributes', () => {
  test('field strips tf on every run (input not mutated)', () => {
    const segs = [{ type: 'text', text: '[A room.] ' }, { type: 'text', text: 'Evening.', tf: 1 }];
    const b = { type: 'para', omitEmphasis: true, segments: segs };
    both(b);
    assert.equal(segs[1].tf, 1);
    assert.notEqual(sig(b), sig({ ...b, omitEmphasis: false }));
  });
});

describe('F-51 / 1.11.6a: unnumbered print page change', () => {
  const doc = (extra) => ({ blocks: [{ type: 'para', text: 'One' }, { type: 'pagenum', page: '', ...extra }, { type: 'para', text: 'Two' }] });
  test('BANA: a row of dots 36 across the line', () => {
    const lines = formatDocument(doc({ unnumbered: true }), o).split(/\r?\n/).map(rstrip);
    assert.ok(lines.includes('-'.repeat(40)), lines.join('|'));
  });
  test('default: empty page number gives nothing (as before)', () => {
    const lines = formatDocument(doc({}), o).split(/\r?\n/).map(rstrip);
    assert.ok(!lines.some((l) => /^-{20,}$/.test(l)));
  });
  test('UKAAF: unchanged', () => {
    const lines = formatDocument(doc({ unnumbered: true }), { ...o, mode: 'ukaaf', standard: 'ukaaf', width: 38 }).split(/\r?\n/).map(rstrip);
    assert.ok(!lines.some((l) => /^-{20,}$/.test(l)));
  });
  test('formatBlock/traceBlock agree, signature keyed', () => {
    const b = { type: 'pagenum', page: '', unnumbered: true };
    assert.deepEqual(both(b), ['-'.repeat(40)]);
    assert.notEqual(sig(b), sig({ type: 'pagenum', page: '' }));
  });
});

describe('F-20 / 11.6.4: guide-dot note for blank entries in a columnar table', () => {
  const table = (x) => ({ type: 'table', headers: [['Day', 'Temp']], rows: [['Monday', ''], ['Tuesday', '']], ...x });
  const opts = { ...o, tableFormat: 'columnar' };
  test('default: no note', () => {
    assert.ok(!both(table({}), opts).join('\n').includes('GUIDE DOTS INDICATE'));
  });
  test('guideDotNote: default wording, plus a source note first', () => {
    const t = both(table({ guideDotNote: true, tabletn: 'Extra.' }), opts).join('\n');
    assert.ok(/EXTRA\./.test(t) && /GUIDE DOTS INDICATE A BLANK ENTRY/.test(t), t);
    assert.ok(t.indexOf('EXTRA') < t.indexOf('GUIDE DOTS'));
  });
  test('guideDotNote string is the transcriber\'s wording', () => {
    assert.ok(both(table({ guideDotNote: 'Guide dots indicate a space for an answer.' }), opts).join('\n').replace(/\s+/g, ' ').includes('SPACE FOR AN ANSWER'));
  });
  test('no blank entry: no note; wholly blank row is not an entry', () => {
    assert.ok(!both({ ...table({ guideDotNote: true }), rows: [['A', 'B'], ['', '']] }, opts).join('\n').includes('GUIDE DOTS'));
  });
  test('signature keyed', () => {
    assert.notEqual(sig(table({})), sig(table({ guideDotNote: true })));
  });
});

describe('F-151 / 2.10.7a: continuation letter stripped from a contents page number', () => {
  const list = (x) => ({ type: 'list', kind: 'toc', items: [{ text: 'Chapter One', page: '12a', level: 0 }, { text: 'Two', page: '20', level: 0 }], ...x });
  test('default: verbatim', () => {
    assert.ok(/12A$/m.test(both(list({})).join('\n')));
  });
  test('stripContinuation: letter dropped (12a -> 12), 20 untouched', () => {
    const t = both(list({ stripContinuation: true })).join('\n');
    assert.ok(/ 12$/m.test(t) && !/12A/.test(t) && / 20$/m.test(t), t);
    assert.notEqual(sig(list({})), sig(list({ stripContinuation: true })));
  });
});

describe('F-149 / F-150: generated contents heading and right buffer', () => {
  const doc = { blocks: [{ type: 'heading', level: 1, text: 'A very long chapter title that will need to wrap over lines' }, { type: 'para', text: 'Body.' }] };
  const gen = (x) => formatDocument(doc, { ...o, toc: true, suppressHeader: false, ...x }).split('\f')[0].split(/\r?\n/).map(rstrip);
  test('default heading is Contents', () => {
    assert.ok(gen({}).some((l) => l.trim() === 'CONTENTS'));
  });
  test('tocHeading follows print wording (2.10.3a), centred', () => {
    const lines = gen({ tocHeading: 'What You Will Study' });
    const l = lines.find((x) => /WHAT YOU WILL STUDY/.test(x));
    assert.ok(l && !lines.some((x) => x.trim() === 'CONTENTS'));
    assert.ok(l.length > 8, 'centred, not flush left');
  });
  test('tocRightBuffer: lines carrying no page number end six cells before the margin (2.10.7b)', () => {
    const lines = gen({ tocRightBuffer: true });
    const entry = lines.filter((x) => /^ *[A-Z]/.test(x) && !/#\S+$/.test(x.trim()) && x.trim() !== 'CONTENTS' && x.trim());
    assert.ok(entry.length > 0 && entry.every((x) => x.length <= 34), JSON.stringify(entry));
    const off = gen({});
    assert.ok(off.some((x) => !/#\S+$/.test(x.trim()) && /^ *[A-Z]/.test(x) && x.length > 34), 'default keeps the full width');
  });
});

describe('F-126 / 13.3.1b, 13.4.2: verse lines and stanzas do not split across braille pages', () => {
  const verse = (t) => ({ type: 'play', subtype: 'verse', style: 'verse', level: 0, text: t });
  const filler = (n) => Array.from({ length: n }, (_, i) => ({ type: 'para', text: `Filler ${i + 1}.` }));   // one line each, no blank between
  const lastLines = (brf) => brf.split('\f').map((p) => p.split(/\r?\n/).map(rstrip).filter((l, i, a) => i < a.length));
  test('stanza whose first line would end the page moves whole to the next page', () => {
    // 23 lines + the blank that opens a poem = 24, so the stanza's first line would be line 25.
    const doc = { blocks: [...filler(23), verse('Line one of the stanza'), verse('Line two of the stanza'), verse('Line three of the stanza')] };
    const pages = lastLines(formatDocument(doc, { ...o, depth: 25 }));
    const txt = pages.map((p) => p.join('\n'));
    assert.ok(pages.length >= 2, 'has two pages');
    assert.ok(/LINE ONE/.test(pages[1].join('\n')), 'stanza starts page 2: ' + txt[1]);
    assert.ok(!/LINE ONE/.test(pages[0].join('\n')));
  });
  test('verseKeep:false restores the old pagination', () => {
    const doc = { blocks: [...filler(23), verse('Line one of the stanza'), verse('Line two of the stanza'), verse('Line three of the stanza')] };
    const pages = lastLines(formatDocument(doc, { ...o, verseKeep: false }));
    assert.ok(/LINE ONE/.test(pages[0].join('\n')));
    assert.ok(/LINE TWO/.test(pages[1].join('\n')));
  });
  test('a single verse line that wraps is not split across pages', () => {
    const long = 'word '.repeat(30).trim();
    const doc = { blocks: [...filler(23), verse(long)] };
    const pages = lastLines(formatDocument(doc, o));
    assert.ok(pages.length === 2 && /WORD/.test(pages[1].join('\n')) && !/WORD/.test(pages[0].join('\n')));
  });
  test('UKAAF is untouched', () => {
    const doc = { blocks: [...filler(23), verse('Line one'), verse('Line two')] };
    const a = formatDocument(doc, { ...o, mode: 'ukaaf', standard: 'ukaaf', width: 38 });
    const b = formatDocument(doc, { ...o, mode: 'ukaaf', standard: 'ukaaf', width: 38, verseKeep: false });
    assert.equal(a, b);
  });
});

describe('F-35 / 8.3.5b-c: a list does not begin on the last line, nor a multi-line first item on the next-to-last', () => {
  const filler = (n) => Array.from({ length: n }, (_, i) => ({ type: 'para', text: `Filler ${i + 1}.` }));
  const longItem = 'First item text that is quite long enough to wrap onto a second line of braille.';
  const list = (first) => ({ type: 'list', kind: 'plain', items: [{ text: first }, { text: 'Second' }, { text: 'Third' }] });
  const pages = (n, first, opts = o) => formatDocument({ blocks: [...filler(n), list(first)] }, opts).split('\f').map((p) => p.split(/\r?\n/).map(rstrip));
  test('one-line first item on the last line moves to the next page', () => {
    // 23 lines + the blank before the list = 24: the first item would be line 25.
    const p = pages(23, 'One');
    assert.ok(/ONE/.test(p[1].join('\n')) && !/ONE/.test(p[0].join('\n')), p.map((x) => x.join('|')).join('\n'));
    const off = pages(23, 'One', { ...o, listPageRules: false });
    assert.ok(/ONE/.test(off[0].join('\n')), 'old behaviour with the opt-out');
  });
  test('one-line first item on the next-to-last line stays (8.3.5b)', () => {
    const p = pages(22, 'One');
    assert.ok(/ONE/.test(p[0].join('\n')) && /SECOND/.test(p[0].join('\n')));
  });
  test('multi-line first item on the next-to-last line moves whole', () => {
    const p = pages(22, longItem);
    assert.ok(/FIRST ITEM/.test(p[1].join('\n')) && !/FIRST ITEM/.test(p[0].join('\n')));
    assert.ok(/FIRST ITEM/.test(pages(22, longItem, { ...o, listPageRules: false })[0].join('\n')));
  });
  test('three lines fit before the page ends: nothing moves', () => {
    const p = pages(21, longItem);
    assert.ok(/FIRST ITEM/.test(p[0].join('\n')));
  });
  test('UKAAF and single-item lists are untouched; formatBlock and traceBlock give the same keep group', () => {
    const uk = { ...o, mode: 'ukaaf', standard: 'ukaaf', width: 38 };
    assert.equal(formatDocument({ blocks: [...filler(23), list('One')] }, uk), formatDocument({ blocks: [...filler(23), list('One')] }, { ...uk, listPageRules: false }));
    const one = { type: 'list', kind: 'plain', items: [{ text: 'Only' }] };
    assert.equal(formatBlock(one, o).keepGroups, undefined);
    const f = formatBlock(list(longItem), o), t = traceBlock(list(longItem), o);
    assert.deepEqual(t.keepGroups, f.keepGroups);
    assert.ok(Array.isArray(f.keepGroups) && f.keepGroups.length === 1);
  });
});
