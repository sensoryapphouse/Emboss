// F-13 — table pagination (BANA Formats §11.2.6c-e, §11.3.2b, §11.4.4).
//   §11.2.6d  "If necessary, a table may be divided between pages at the most appropriate place... Insert the page break at
//             the beginning of a new row if possible."
//   §11.4.4a  "Repeat the column headings (with accompanying separation lines) at the top of each succeeding page."
//   §11.4.4b  "Insert a blank line between a running head and the repeated headings."
//   §11.3.2b  "When a sequentially numbered table is longer than one braille page, repeat and center the table number on
//             line 25 of each succeeding braille page, followed by "(cont.)". When a table occupies only one page, do not
//             put the table number on line 25."
// block.repeatHeadings (true/false) overrides the default: ON in BANA, OFF in UKAAF (B004 is silent).
// block.continuedNote (false / string / true) overrides the automatic "Table n (cont.)" (BANA, bare "Table n" title line).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

await louis.init(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const translate = (t, tf) => louis.translate(t, T, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
const opts = (mode, extra = {}) => ({ mode, standard: mode, width: 40, depth: 25, translate, translatePos, listStyle: 'spaced', ...extra });
const pagesOf = (brf) => brf.replace(/\r/g, '').split('\f').map((p) => { const l = p.split('\n'); if (l[l.length - 1] === '') l.pop(); return l; });

const HEAD = translate('Name'), SEP = '"333333';
// 60 rows; every 7th row has a long description that wraps to 2-3 lines.
const rows = Array.from({ length: 60 }, (_, i) => [`Item ${i + 1}`, i % 7 === 3 ? `Long description of the item number ${i + 1} with extra words` : `d${i + 1}`, `${i * 3}`]);
const big = (extra = {}) => ({ type: 'table', title: ['Table 9.5', 'Big table'], headers: ['Name', 'Description', 'Count'], rows, ...extra });
const fmt = (block, mode = 'bana', extra = {}) => pagesOf(formatDocument({ title: 'Book', blocks: [block] }, opts(mode, extra)));
// header lines are recognisable: the first heading line starts with the translated "Name"
const isHead = (l) => l.trimStart().startsWith(HEAD);

test('BANA: a 60-row table spans several pages and repeats headings + separation line on each', () => {
  const ps = fmt(big());
  assert.ok(ps.length >= 3, 'several pages');
  const firstHead = ps[0].findIndex(isHead);
  assert.ok(firstHead > 0, 'headings on page 1');
  const sep = ps[0][firstHead + 1];
  assert.ok(sep.startsWith(SEP.slice(0, 3)), 'separation line under the headings');
  ps.slice(1).forEach((p, k) => {
    const hi = p.findIndex(isHead);
    assert.equal(hi, 2, `page ${k + 2}: running head, blank line (§11.4.4b), then the headings`);
    assert.equal(p[0].trim().length > 0, true, 'running head on line 1');
    assert.equal(p[1], '', 'blank line under the running head');
    assert.equal(p[hi + 1], sep, `page ${k + 2}: separation line repeated`);
  });
});

const ROW = translate('Item');
test('BANA: every row appears exactly once and each page opens with a row start, never a runover', () => {
  const ps = fmt(big());
  const all = ps.flat();
  for (let i = 1; i <= 60; i++) {
    const hits = all.filter((l) => l.startsWith(translate(`Item ${i}`) + ' '));
    assert.equal(hits.length, 1, `row ${i} appears once`);
  }
  ps.slice(1).forEach((p, k) => {
    assert.ok(p[p.findIndex(isHead) + 2].startsWith(ROW), `page ${k + 2}: first row line is a row start`);
  });
});

test('BANA: keep groups are honoured for multi-line rows wherever the table starts on the page', () => {
  let wrapped = 0;
  for (let lead = 0; lead < 14; lead++) {
    const filler = Array.from({ length: lead }, (_, i) => ({ type: 'para', text: `Filler ${i}.` }));
    const ps = pagesOf(formatDocument({ blocks: [...filler, { type: 'table', headers: ['Name', 'Description', 'Count'], rows }] }, opts('bana')));
    ps.forEach((p, k) => {
      // a runover line (leading blanks) may never be the first body line of a page, nor follow the headings on a continuation
      const hi = p.findIndex(isHead);
      const bodyFirst = k === 0 ? p.findIndex((l) => l.trim()) : (hi >= 0 ? hi + 2 : 0);
      if (bodyFirst >= 0 && k > 0) assert.ok(!/^ +\S/.test(p[bodyFirst]) || p[bodyFirst].startsWith(ROW), `lead ${lead} page ${k + 1}: opens with a row start`);
      // a row's wrapped lines stay together: a runover is never the first line after a page's headings or top
      for (let li = 1; li < p.length - 1; li++) if (/^ {2,}\S/.test(p[li]) && !p[li - 1].trim()) wrapped++;
    });
  }
  assert.equal(wrapped, 0, 'no runover line ever follows a blank/top of page');
});

test('BANA: page count with repeated headings equals the count without plus the lines they use, and never fewer rows', () => {
  const on = fmt(big());
  const off = fmt(big({ repeatHeadings: false }));
  assert.ok(on.length >= off.length, 'repeating headings never shortens the table');
  assert.ok(on.length - off.length <= 2, 'and costs at most a couple of pages');
  assert.equal(off.slice(1).flat().filter(isHead).length, 0, 'repeatHeadings:false keeps the old behaviour: no repeat');
});

test('a short table (one page) is unchanged', () => {
  const short = { type: 'table', title: ['Table 1'], headers: ['Name', 'Count'], rows: rows.slice(0, 5).map((r) => [r[0], r[2]]) };
  for (const mode of ['bana', 'ukaaf']) {
    const a = formatDocument({ title: 'Book', blocks: [short] }, opts(mode));
    const b = formatDocument({ title: 'Book', blocks: [{ ...short, repeatHeadings: false, continuedNote: false }] }, opts(mode));
    assert.equal(a, b, mode);
  }
});

test('UKAAF: unchanged by default (B004 says nothing); repeatHeadings:true repeats', () => {
  const dflt = fmt(big(), 'ukaaf');
  const off = fmt(big({ repeatHeadings: false }), 'ukaaf');
  assert.deepEqual(dflt, off);
  assert.equal(dflt.slice(1).flat().filter(isHead).length, 0);
  const on = fmt(big({ repeatHeadings: true }), 'ukaaf');
  on.slice(1).forEach((p, k) => assert.ok(p.some(isHead), `UKAAF page ${k + 2} repeats the headings`));
  assert.ok(!on.flat().some((l) => /\(CONT|"<3T4">/i.test(l)), 'no (cont.) note in UKAAF');
});

test('BANA §11.3.2b: "Table 9.5 (cont.)" centred on line 25 of each succeeding page, beside the page number', () => {
  const ps = fmt(big());
  const note = translate('Table 9.5 (cont.)');
  assert.ok(!ps[0][ps[0].length - 1].includes(note), 'not on the first page');
  ps.slice(1).forEach((p, k) => {
    const last = p[p.length - 1];
    assert.ok(last.includes(note), `page ${k + 2} line 25 carries the note`);
    const at = last.indexOf(note);
    assert.ok(at >= 8 && at <= 14, 'roughly centred');
    assert.ok(last.length <= 40 && /#\S+$/.test(last) || /\S$/.test(last), 'page number still at the right');
  });
  const off = fmt(big({ continuedNote: false }));
  assert.ok(!off.flat().some((l) => l.includes(note)), 'continuedNote:false switches it off');
  const custom = fmt(big({ continuedNote: 'Table 9.5, continued' }));
  assert.ok(custom.slice(1).every((p) => p[p.length - 1].includes(translate('Table 9.5, continued'))), 'custom text');
  const single = fmt({ ...big(), rows: rows.slice(0, 5) });
  assert.ok(!single.flat().some((l) => l.includes(note)), 'a one-page table has no line-25 note');
  const titled = fmt(big({ title: ['Population by region'] }));
  assert.ok(!titled.flat().some((l) => l.includes(translate('(cont.)'))), 'a title that is not a bare "Table n" gets no automatic note');
});

test('formatBlock and traceBlock give the same lines and the same keep groups', () => {
  for (const mode of ['bana', 'ukaaf']) {
    for (const rh of [undefined, true, false]) {
      const block = big(rh === undefined ? {} : { repeatHeadings: rh });
      const o = opts(mode);
      const real = formatBlock(block, o, false);
      const traced = traceBlock(block, o, false);
      assert.deepEqual(traced.map((t) => t.s), [...real], `${mode}/${rh}: lines`);
      assert.deepEqual(traced.keepGroups || null, real.keepGroups || null, `${mode}/${rh}: keepGroups`);
    }
  }
  const real = formatBlock(big(), opts('bana'), false);
  assert.equal(real.keepGroups.length, 60);
  assert.match(real.keepGroups[0][2], /^H\d+$/, 'first group carries the heading length');
});

test('editor path (traceRows) still labels every row: page count and row totals agree', () => {
  const trace = {};
  const brf = formatDocument({ title: 'Book', blocks: [big()] }, opts('bana', { trace }));
  const ps = pagesOf(brf);
  assert.equal(trace.rows.length, ps.reduce((n, p) => n + p.length, 0));
});
