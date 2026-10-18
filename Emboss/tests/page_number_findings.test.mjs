// Print page number findings F-45, F-46/F-47, F-49, F-66. Every field is optional; without it output is unchanged.
//  - pagenum.implied (BANA 1.11.5): the number is inferred from the previous print page;
//  - pagenum.through / combineWithNext (1.11.8, 1.12.1): combined, omitted and facing-page numbers;
//  - pagenum.spelled (1.14.1): the print's spelled-out number after the numeric indicator;
//  - o.pilPrintPage (UKAAF B004 6/7): print page number on the page information line.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatBlock, traceBlock, getBlockSignature, formatDocument, resolvePageNumbers } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const { runningHead } = await import(path.join(EMBOSS, 'format', 'page.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const bana = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, suppressHeader: true };
const ukaaf = { mode: 'ukaaf', standard: 'ukaaf', width: 38, depth: 25, translate };
const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const both = (block, o = bana) => {
  const a = clean(formatBlock(block, o));
  assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), a, 'traceBlock differs from formatBlock');
  return a;
};
const P = (text) => ({ type: 'para', text });
const pn = (page, extra = {}) => ({ type: 'pagenum', page, ...extra });
const pages = (doc, o) => formatDocument(doc, o).split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n'));

test('no new field: the page number indicator is unchanged', () => {
  assert.deepEqual(both(pn('22')), ['-'.repeat(37) + '#BB']);
  assert.deepEqual(both(pn('22'), ukaaf), [both(pn('22'), ukaaf)[0]]);
  assert.match(both(pn('22'), ukaaf)[0], /^ +"3#BB$/);
});

// ---- F-45 implied page numbers ----
test('implied print page numbers are inferred from the previous page (1.11.5)', () => {
  const blocks = resolvePageNumbers([pn('41'), P('a'), pn('', { implied: true }), P('b'), pn('43')]);
  assert.equal(blocks[2].page, '42');
  assert.deepEqual(blocks.filter((b) => b.type === 'pagenum').map((b) => b.page), ['41', '42', '43']);
  const r = resolvePageNumbers([pn('iii'), pn('', { implied: true }), pn('IX'), pn(null, { implied: true })]);
  assert.deepEqual(r.map((b) => b.page), ['iii', 'iv', 'IX', 'X']);
  // no previous number, or a number that cannot be counted from: nothing is invented
  assert.equal(resolvePageNumbers([pn('', { implied: true })])[0].page, '');
  assert.equal(resolvePageNumbers([pn('S1-7'), pn('', { implied: true })])[1].page, '');
  // an implied page whose number the transcriber supplies renders as given
  assert.equal(resolvePageNumbers([pn('4', { implied: true })])[0].page, '4');
  // end to end: the inferred number appears as an ordinary indicator line
  const out = formatDocument({ blocks: [P('One.'), pn('41'), P('Two.'), pn('', { implied: true }), P('Three.')] }, bana);
  assert.ok(out.includes('#DB'), out);
  assert.equal(out.split('\r\n').filter((l) => /^-+#D[AB]$/.test(l)).length, 2);
  // no field: the array is returned as is
  const plain = [pn('1'), P('x')]; assert.equal(resolvePageNumbers(plain), plain);
});

// ---- F-46 / F-47 combined, omitted and facing pages ----
test('through combines pages into one number (1.11.8a, 1.11.8c, 1.12.1)', () => {
  assert.deepEqual(both(pn('i', { through: 'v' })), both(pn('i-v')));
  assert.deepEqual(both(pn('44', { through: '45' })), both(pn('44-45')));
  assert.deepEqual(both(pn('25', { through: '29' })), both(pn('25-29')));
  // roman and arabic are never combined (1.11.8)
  assert.deepEqual(both(pn('viii', { through: '1' })), both(pn('viii')));
  assert.deepEqual(both(pn('1', { through: 'v' })), both(pn('1')));
  assert.deepEqual(both(pn('44', { through: '45' }), ukaaf), both(pn('44-45'), ukaaf));
  assert.notEqual(getBlockSignature(pn('44', { through: '45' }), bana, false), getBlockSignature(pn('44'), bana, false));
});

test('a blank page is combined with the next page that has text (1.11.8d)', () => {
  // 24 Sep follow-up (F-46): a combined page is no longer dropped but kept as an empty pagenum (no number, so no line),
  // so the blocks keep their indexes for the editor's row map (trace.rows). These expectations pinned the dropping: they
  // now read the placeholders in place (same length as the input) and the combined number on the next page with text.
  const r = resolvePageNumbers([pn('23', { combineWithNext: true }), pn('24', { combineWithNext: true }), pn('25'), P('t')]);
  assert.equal(r.length, 4);
  assert.deepEqual(r.filter((b) => b.type === 'pagenum').map((b) => b.page), ['', '', '23-25']);
  assert.deepEqual(r.filter((b) => b.type === 'pagenum' && b.page).map((b) => b.page), ['23-25']);
  const r2 = resolvePageNumbers([pn('44', { combineWithNext: true }), pn('45', { through: '46' })]);
  assert.equal(r2[0].page, '');
  assert.equal(r2[1].page, '44-46');
  assert.equal(r2[1].through, undefined);
  // trailing blank pages keep their own number; a different numbering system is not combined
  assert.equal(resolvePageNumbers([pn('9', { combineWithNext: true })])[0].page, '9');
  assert.equal(resolvePageNumbers([pn('x', { combineWithNext: true }), pn('1')])[1].page, 'x');
});

// ---- F-49 spelled-out page numbers ----
test('spelled-out page number follows the numeric indicator (1.14.1c, Example 1-16)', () => {
  const out = both(pn('89', { spelled: 'eighty-nine' }));
  assert.equal(out.length, 2);
  assert.equal(out[0], '-'.repeat(37) + '#HI');
  assert.equal(out[1], '------' + clean([translate('eighty-nine')])[0]);
  // a long spelled number: runovers in cell 7, first line stops short of the numeric number (1-17)
  const long = both(pn('1375', { spelled: 'one-thousand three hundred seventy-five' }));
  assert.ok(long.length >= 3, long.join('\n'));
  assert.ok(long[1].startsWith('------') && long.slice(2).every((l) => /^ {6}\S/.test(l)), long.join('\n'));
  assert.ok(long[1].length + 1 + 5 <= 40, 'first line leaves room for #ACGE');
  // UKAAF has no such rule: unchanged
  assert.deepEqual(both(pn('89', { spelled: 'eighty-nine' }), ukaaf), both(pn('89'), ukaaf));
  assert.notEqual(getBlockSignature(pn('89', { spelled: 'x' }), bana, false), getBlockSignature(pn('89'), bana, false));
});

test('spelled-out number at the top of a page: line 1 with no running head, line 2 with one (1.14.1c, Examples 1-14, 1-15, 1-17)', () => {
  const o = { ...bana, suppressHeader: false };
  const fill = (n, t) => Array.from({ length: n }, (_, i) => P(t + i));
  // 22 body lines fill braille page 1 (line 1 head, line 25 number), so the print page turn opens page 2
  const doc = (title, spelled) => ({ title, blocks: [pn('88'), ...fill(title ? 21 : 22, 'w'), pn('1375', { spelled }), ...fill(4, 'x')] });
  const spelled = 'one-thousand three hundred seventy-five';
  const noHead = pages(doc(null, spelled), o)[1];
  assert.match(noHead[0], /^------\S.*\s#ACGE$/, noHead.join('\n'));
  assert.equal(noHead[0].length, 40);
  assert.match(noHead[1], /^ {6}\S/);                       // runover in cell 7
  assert.ok(!/^-{6}/.test(noHead[2]));
  const withHead = pages(doc('Running Head', spelled), o)[1];
  assert.match(withHead[0], /#ACGE$/);
  assert.ok(!/------[^-]/.test(withHead[0]), 'no running head line is not overwritten');
  assert.match(withHead[1], /^------\S.*\S$/);              // spelled-out number on line 2
  // the numeric page is on the same braille page as the spelled-out one when the turn is mid-page (1.14.1b)
  const mid = pages(doc(null, spelled), o)[0].concat(pages(doc(null, spelled), o)[1]);
  assert.ok(mid.some((l) => /^-+#ACGE$|#ACGE$/.test(l)));
  // no spelled field: page 2 opens as before
  assert.ok(!pages(doc(null, undefined), o)[1].some((l) => /^------[^-]/.test(l)));
  // the trace agrees with the formatting on row count
  const t = { rows: null }; formatDocument(doc(null, spelled), { ...o, trace: t });
  assert.equal(t.rows.length, formatDocument(doc(null, spelled), o).split('\x0c').reduce((n, p) => n + p.replace(/\r\n$/, '').split('\r\n').length, 0));
});

// ---- F-66 UKAAF print page number on the PIL ----
test('UKAAF page information line can carry the print page number top left (B004 6/7)', () => {
  const fill = (n, t) => Array.from({ length: n }, (_, i) => P(t + i));
  const doc = { title: 'Common Native Trees', blocks: [pn('60'), ...fill(30, 'a'), pn('61'), ...fill(30, 'b')] };
  const off = pages(doc, ukaaf), on = pages(doc, { ...ukaaf, pilPrintPage: true });
  assert.equal(off.length, on.length);
  for (let i = 0; i < off.length; i++) assert.deepEqual(on[i].slice(1), off[i].slice(1), 'body unchanged');
  assert.match(on[0][0], /^#FJ +#A$/, on[0][0]);
  // a page carrying two print pages shows the later one (B004 7 N.B.)
  const later = on.find((p, i) => i > 0 && p.some((l) => /^\s+"3#FA$/.test(l)));
  assert.ok(later, on.map((p) => p[0]).join('\n'));
  assert.match(later[0], /^#FA /);
  // runningHead: title dropped when it would not clear the print number
  const clash = runningHead(2, 'a long title here', 38, '#FA');
  assert.ok(clash.startsWith('#FA') && clash.endsWith('#B'));
  assert.equal(runningHead(2, 'title', 38, '#FA' + 'J'.repeat(14)).includes('title'), false, 'title dropped when it would not clear the print number');
  assert.equal(runningHead(2, 'title', 38), runningHead(2, 'title', 38, null));
});
