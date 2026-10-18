// Paul's UKAAF decisions UK-5, UK-6, UK-7 and UK-10 (docs/decisions.md "UKAAF"), from James's answers
// (28 Sep 2026, docs/questions-register.md "UKAAF — answered 28 Sep 2026 by James").
//
// UK-5: UKAAF carries NO blank lines at all, except before a "sub-heading" (a cell-1/runover-cell-5
//   heading — levels 2, 4 and 5 in Emboss's mapping, not 3/6) that does not directly follow a centred
//   (level-1) heading; footnotes run together; the 'compact' list style (5-1, sub-items 7-1) becomes the
//   UKAAF default, 'spaced' stays available.
// UK-6: end markers, in UEB form (colons: dot 5, dots 2-5, then ten colons; dot-2s: dot 5, dots 2-5, then
//   ten dot-2s) — a colons marker at the end of the document (on by default, last volume only), a dot-2s
//   marker after every table (on by default), and a colons marker before every later level-1 heading (the
//   existing `endMarkers`/`endMarkerBefore` fields, now colons instead of dot-2s, still off by default).
// UK-7: UKAAF's own default page is 38x27 (not the US 40x25); UK page-size presets (38x27, 40x27 12in
//   paper; 28x27, 30x27 A4); pilPrintPage (print page number on the page-information line) on by default
//   in UKAAF; saved settings are never overridden.
// UK-10: a "Show bullets" document option, default on; off drops an UNORDERED bullet cell entirely (a
//   numbered/lettered marker is unaffected), in both modes.
//
// BANA must be byte-identical throughout: every UK-5/UK-6/UK-10 mechanism is gated `o.mode !== 'bana'`
// (UK-7's page-geometry/preset changes are UKAAF-only data, and pilPrintPage is read only by UKAAF's own
// running-head code, page.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument, formatVolumes, formatBlock, traceBlock, getBlockSignature } from '../format/document.mjs';
import { MODE_GEOMETRY, UK_PAGE_SIZE_PRESETS, DEFAULTS, sanitizeSettings } from '../web/settings.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const upper = (s) => String(s).toUpperCase();
const identity = (s) => upper(s);
const opts = (mode, extra = {}) => ({ mode, standard: mode, width: 38, depth: 25, translate: identity, toc: false, ...extra });
const allLines = (brf) => brf.split('\x0c').flatMap((p) => { const a = p.split('\r\n'); a.pop(); return a; });
const trimmed = (brf) => allLines(brf).map((l) => l.trim());
const DOT2S = '"31111111111';    // indicatorLine('dot2s', 38) trimmed
const COLONS = '"33333333333';   // indicatorLine('colons', 38) trimmed

// -------------------------------------------------------------------------------------------------------
// UK-5: no blank lines, except before a sub-heading not directly after a centred heading
// -------------------------------------------------------------------------------------------------------
test('UK-5: no blank line before or after a list in UKAAF', () => {
  const blocks = [
    { type: 'para', text: 'Before.' },
    { type: 'list', items: [{ text: 'Apples' }, { text: 'Pears' }] },
    { type: 'para', text: 'After.' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false, listStyle: 'spaced' })));
  const before = lines.indexOf(upper('Before.'));
  assert.ok(before >= 0);
  assert.equal(lines[before + 1], upper('Apples'), `no blank before the list: ${JSON.stringify(lines)}`);
  const after = lines.indexOf(upper('After.'));
  assert.equal(lines[after - 1], upper('Pears'), `no blank after the list: ${JSON.stringify(lines)}`);
});

test('UK-5: no blank line before or after a table in UKAAF', () => {
  const blocks = [
    { type: 'para', text: 'Before.' },
    { type: 'table', headers: ['Fruit'], rows: [['Apple']] },
    { type: 'para', text: 'After.' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false, tableEndMarker: false })));
  const before = lines.indexOf(upper('Before.'));
  assert.ok(before >= 0);
  assert.equal(lines[before + 1], upper('Fruit'), `no blank before the table: ${JSON.stringify(lines)}`);
  const after = lines.indexOf(upper('After.'));
  assert.equal(lines[after - 1], upper('Apple'), `no blank after the table: ${JSON.stringify(lines)}`);
});

test('UK-5: footnotes run together — no blank line between consecutive notes', () => {
  const blocks = [
    { type: 'footnote', id: 'n1', text: 'First note.' },
    { type: 'footnote', id: 'n2', text: 'Second note.' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const first = lines.indexOf(upper('First note.'));
  assert.ok(first >= 0);
  assert.equal(lines[first + 1], upper('Second note.'), `no blank between notes: ${JSON.stringify(lines)}`);
});

test('UK-5: no blank line before a later centred (level-1) heading', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Chapter One' },
    { type: 'para', text: 'Body one.' },
    { type: 'heading', level: 1, text: 'Chapter Two' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const body = lines.indexOf(upper('Body one.'));
  assert.ok(body >= 0);
  assert.equal(lines[body + 1], upper('Chapter Two'), `no blank before the later L1 heading: ${JSON.stringify(lines)}`);
});

test('UK-5: a sub-heading (level 2, cell-1/runover-5) keeps its blank line when it does not follow a centred heading', () => {
  const blocks = [
    { type: 'para', text: 'Body one.' },
    { type: 'heading', level: 2, text: 'A subsection' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const body = lines.indexOf(upper('Body one.'));
  assert.ok(body >= 0);
  assert.equal(lines[body + 1], '', `blank line kept before the sub-heading: ${JSON.stringify(lines)}`);
  assert.equal(lines[body + 2], upper('A subsection'));
});

test('UK-5: that same sub-heading has NO blank line when it directly follows a centred (level-1) heading', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Chapter One' },
    { type: 'heading', level: 2, text: 'A subsection' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const h1 = lines.indexOf(upper('Chapter One'));
  assert.ok(h1 >= 0);
  assert.equal(lines[h1 + 1], upper('A subsection'), `no blank line straight after the centred heading (UK-4/UK-5): ${JSON.stringify(lines)}`);
});

test('UK-5: level 3 (cell-3/runover-5) is NOT a sub-heading — no blank-line exception for it', () => {
  const blocks = [
    { type: 'para', text: 'Body one.' },
    { type: 'heading', level: 3, text: 'A cell-3 heading' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const body = lines.indexOf(upper('Body one.'));
  assert.ok(body >= 0);
  assert.equal(lines[body + 1], upper('A cell-3 heading'), `level 3 gets no blank-line exception: ${JSON.stringify(lines)}`);
});

test('UK-5: levels 4 and 6 follow the same cell-1(keeps blank)/cell-3(no blank) split as 2/3', () => {
  const kept = trimmed(formatDocument({ blocks: [{ type: 'para', text: 'Body.' }, { type: 'heading', level: 4, text: 'L4' }] }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const b1 = kept.indexOf(upper('Body.'));
  assert.equal(kept[b1 + 1], '', `level 4 (cell-1/runover-5) keeps its blank line: ${JSON.stringify(kept)}`);
  const dropped = trimmed(formatDocument({ blocks: [{ type: 'para', text: 'Body.' }, { type: 'heading', level: 6, text: 'L6' }] }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const b2 = dropped.indexOf(upper('Body.'));
  assert.equal(dropped[b2 + 1], upper('L6'), `level 6 (cell-3/runover-5) has no blank-line exception: ${JSON.stringify(dropped)}`);
});

test('UK-5: BANA blank lines are completely unaffected', () => {
  const blocks = [
    { type: 'para', text: 'Before.' },
    { type: 'list', items: [{ text: 'Apples' }, { text: 'Pears' }] },
    { type: 'para', text: 'After.' },
  ];
  const before = formatDocument({ blocks }, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: identity, suppressHeader: true, toc: false });
  const lines = trimmed(before);
  const b = lines.indexOf(upper('Before.'));
  assert.equal(lines[b + 1], '', 'BANA keeps its own blank line before a list (Formats §8.3.3)');
});

// -------------------------------------------------------------------------------------------------------
// UK-6: end markers
// -------------------------------------------------------------------------------------------------------
test('UK-6: a colons marker is the last line of the document by default', () => {
  const blocks = [{ type: 'para', text: 'Only paragraph.' }];
  const brf = formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true }));
  const lines = trimmed(brf).filter((l) => l !== '');
  assert.equal(lines[lines.length - 1], COLONS, `colons marker is the true last line: ${JSON.stringify(lines)}`);
});

test('UK-6: docEndMarker: false turns the document-end colons marker off', () => {
  const blocks = [{ type: 'para', text: 'Only paragraph.' }];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  assert.ok(!lines.includes(COLONS), `no colons marker anywhere: ${JSON.stringify(lines)}`);
});

test('UK-6: a dot-2s marker follows every table by default, before resuming normal text', () => {
  const blocks = [
    { type: 'table', headers: ['Fruit'], rows: [['Apple']] },
    { type: 'para', text: 'After.' },
  ];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const apple = lines.indexOf(upper('Apple'));
  assert.ok(apple >= 0);
  assert.equal(lines[apple + 1], DOT2S, `dot-2s marker right after the table's last line: ${JSON.stringify(lines)}`);
  assert.equal(lines[apple + 2], upper('After.'), 'no blank line between the marker and the text that resumes');
});

test('UK-6: the after-table dot-2s marker comes after the below-table citation, when there is one', () => {
  const blocks = [{ type: 'table', headers: ['Fruit'], rows: [['Apple']], citation: 'Source: a book' }];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  const cite = lines.findIndex((l) => l.includes(upper('Source')));
  assert.ok(cite >= 0, `citation present: ${JSON.stringify(lines)}`);
  assert.equal(lines[cite + 1], DOT2S, `marker after the citation: ${JSON.stringify(lines)}`);
});

test('UK-6: tableEndMarker: false turns the after-table marker off', () => {
  const blocks = [{ type: 'table', headers: ['Fruit'], rows: [['Apple']] }];
  const lines = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false, tableEndMarker: false })));
  assert.ok(!lines.includes(DOT2S), `no dot-2s marker: ${JSON.stringify(lines)}`);
});

test('UK-6: endMarkers (chapter marker) is the colons form now, still off by default', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'First' },
    { type: 'para', text: 'Body.' },
    { type: 'heading', level: 1, text: 'Second' },
  ];
  const off = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false })));
  assert.ok(!off.includes(COLONS), `off by default: ${JSON.stringify(off)}`);
  const on = trimmed(formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false, endMarkers: true })));
  assert.ok(on.includes(COLONS), `endMarkers:true adds the colons marker: ${JSON.stringify(on)}`);
});

test('UK-6: in a multi-volume book the document-end marker lands in the LAST volume only', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Chapter One' },
    ...Array.from({ length: 20 }, (_, i) => ({ type: 'para', text: `Line ${i}.` })),
    { type: 'heading', level: 1, text: 'Chapter Two' },
    ...Array.from({ length: 20 }, (_, i) => ({ type: 'para', text: `More ${i}.` })),
  ];
  const vols = formatVolumes({ blocks }, opts('ukaaf', { suppressHeader: true, depth: 8, volumePages: 1 }));
  assert.ok(vols.length >= 2, `test doc must actually split into 2+ volumes: got ${vols.length}`);
  for (let i = 0; i < vols.length - 1; i++) assert.ok(!trimmed(vols[i].brf).includes(COLONS), `no marker in volume ${i + 1}/${vols.length}`);
  assert.ok(trimmed(vols[vols.length - 1].brf).includes(COLONS), 'marker present in the last volume');
});

test('UK-6: BANA never gets any of the three UK-6 markers', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'First' },
    { type: 'table', headers: ['Fruit'], rows: [['Apple']] },
    { type: 'heading', level: 1, text: 'Second' },
  ];
  const bo = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: identity, suppressHeader: true, toc: false, endMarkers: true };
  const lines = trimmed(formatDocument({ blocks }, bo));
  assert.ok(!lines.includes(DOT2S) && !lines.includes(COLONS), `BANA gets neither marker even with endMarkers:true: ${JSON.stringify(lines)}`);
});

test('UK-6: formatBlock and traceBlock agree on the table end marker (A39 dual-path)', () => {
  const block = { type: 'table', headers: ['Fruit'], rows: [['Apple']] };
  for (const tableEndMarker of [true, false]) {
    const o = opts('ukaaf', { tableEndMarker });
    const real = formatBlock(block, o, false);
    const traced = traceBlock(block, o, false);
    assert.equal(traced.length, real.length, `tableEndMarker=${tableEndMarker}: same line count`);
    traced.forEach((t, i) => assert.equal(t.s, real[i], `tableEndMarker=${tableEndMarker} line ${i}: traceBlock drift`));
  }
});

// -------------------------------------------------------------------------------------------------------
// UK-7: page geometry, presets, print page number, saved settings untouched
// -------------------------------------------------------------------------------------------------------
test('UK-7: UKAAF default page geometry is 38 cells x 27 lines', () => {
  assert.deepEqual(MODE_GEOMETRY.ukaaf, { cells: 38, lines: 27 });
  assert.equal(DEFAULTS.mode, 'ukaaf', 'ukaaf is the default mode, so DEFAULTS itself must carry the 27-line default');
  assert.equal(DEFAULTS.lines, 27);
});

test('UK-7: BANA default page geometry is unchanged (40 x 25)', () => {
  assert.deepEqual(MODE_GEOMETRY.bana, { cells: 38, lines: 25 });   // PAGE-BANA-1 (Paul, 28 Sep): 38, KD's usual width; 1.7.1's 40 is a maximum
});

test('UK-7: the four UK page-size presets are offered (12in paper and A4)', () => {
  const byCells = (cells, lines) => UK_PAGE_SIZE_PRESETS.find((p) => p.cells === cells && p.lines === lines);
  assert.ok(byCells(38, 27), '38x27 (12in paper)');
  assert.ok(byCells(40, 27), '40x27 (12in paper)');
  assert.ok(byCells(28, 27), '28x27 (A4)');
  assert.ok(byCells(30, 27), '30x27 (A4)');
});

test('UK-7: a saved 38x25 setting is kept exactly — the new 27-line default never overrides it', () => {
  const saved = sanitizeSettings({ mode: 'ukaaf', cells: 38, lines: 25 });
  assert.equal(saved.cells, 38);
  assert.equal(saved.lines, 25, 'an explicitly saved value must survive the DEFAULTS change');
});

test('UK-7: print page number on the page-information line is ON by default in UKAAF', () => {
  const blocks = [
    { type: 'pagenum', text: '1' },
    { type: 'para', text: 'Body.' },
  ];
  const on = formatDocument({ blocks }, opts('ukaaf', { docEndMarker: false }));
  const off = formatDocument({ blocks }, opts('ukaaf', { docEndMarker: false, pilPrintPage: false }));
  assert.notEqual(on, off, 'pilPrintPage defaults true (differs from an explicit false) in UKAAF');
});

test('UK-7: pilPrintPage never affects BANA output (irrelevant there)', () => {
  const blocks = [{ type: 'para', text: 'Body.' }];
  const bo = (extra) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: identity, suppressHeader: true, toc: false, ...extra });
  const withIt = formatDocument({ blocks }, bo({ pilPrintPage: true }));
  const withoutIt = formatDocument({ blocks }, bo({}));
  assert.equal(withIt, withoutIt, 'BANA output is byte-identical regardless of pilPrintPage');
});

// -------------------------------------------------------------------------------------------------------
// UK-10: "Show bullets" document option
// -------------------------------------------------------------------------------------------------------
// The 'compact' list style (UK-5's own new default) ignores print markers/bullets entirely by
// design (B004 §10 Ex2 — "print markers ignored"), so these use 'spaced', where a bullet is
// ordinarily shown, to isolate showBullets' own effect from listStyle's.
test('UK-10: showBullets defaults to true — a bulleted item shows its bullet cell', () => {
  const block = { type: 'list', items: [{ text: 'Apples', bullet: '•' }] };
  const lines = formatBlock(block, opts('ukaaf', { listStyle: 'spaced' }), false);
  assert.ok(lines.some((l) => l.includes('_4')), `bullet cell (_4) present by default: ${JSON.stringify(lines)}`);
});

test('UK-10: showBullets: false drops the bullet cell — the item lays out as a plain item', () => {
  const block = { type: 'list', items: [{ text: 'Apples', bullet: '•' }] };
  const withBullets = formatBlock(block, opts('ukaaf', { listStyle: 'spaced' }), false);
  const without = formatBlock(block, opts('ukaaf', { listStyle: 'spaced', showBullets: false }), false);
  assert.ok(!without.some((l) => l.includes('_4')), `no bullet cell: ${JSON.stringify(without)}`);
  const plain = formatBlock({ type: 'list', items: [{ text: 'Apples' }] }, opts('ukaaf', { listStyle: 'spaced' }), false);
  assert.deepEqual(without, plain, 'a suppressed-bullet item lays out exactly like an ordinary unmarked item');
  assert.notDeepEqual(withBullets, without);
});

test('UK-10: showBullets: false leaves numbered and lettered markers untouched', () => {
  const block = { type: 'list', items: [{ text: 'First', marker: '1.' }, { text: 'Second', marker: '2.' }] };
  const withB = formatBlock(block, opts('ukaaf', { listStyle: 'compact', showBullets: true }), false);
  const withoutB = formatBlock(block, opts('ukaaf', { listStyle: 'compact', showBullets: false }), false);
  assert.deepEqual(withB, withoutB, 'numbered markers are unaffected by showBullets');
});

test('UK-10: showBullets: false applies in BANA too', () => {
  const block = { type: 'list', items: [{ text: 'Apples', bullet: '•' }] };
  const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: identity };
  const withBullets = formatBlock(block, o, false);
  const without = formatBlock(block, { ...o, showBullets: false }, false);
  assert.ok(withBullets.some((l) => l.includes('_4')));
  assert.ok(!without.some((l) => l.includes('_4')), `BANA: no bullet cell either: ${JSON.stringify(without)}`);
});

test('UK-10: formatBlock and traceBlock agree on showBullets (A39 dual-path)', () => {
  const block = { type: 'list', items: [{ text: 'Apples', bullet: '•' }, { text: 'Pears', marker: '2.' }] };
  for (const showBullets of [true, false]) {
    const o = opts('ukaaf', { listStyle: 'compact', showBullets });
    const real = formatBlock(block, o, false);
    const traced = traceBlock(block, o, false);
    assert.equal(traced.length, real.length, `showBullets=${showBullets}: same line count`);
    traced.forEach((t, i) => assert.equal(t.s, real[i], `showBullets=${showBullets} line ${i}: traceBlock drift`));
  }
});

test('UK-10: getBlockSignature keys showBullets (blockCache correctness)', () => {
  const block = { type: 'list', items: [{ text: 'Apples', bullet: '•' }] };
  const sigOn = getBlockSignature(block, opts('ukaaf', { showBullets: true }), false);
  const sigOff = getBlockSignature(block, opts('ukaaf', { showBullets: false }), false);
  assert.notEqual(sigOn, sigOff, 'showBullets changes the list layout but was left out of the cache key');
});

// -------------------------------------------------------------------------------------------------------
// Field registry: the four new/changed doc options exist with the right defaults
// -------------------------------------------------------------------------------------------------------
test('field-registry: tableEndMarker, docEndMarker and showBullets are doc options, default on; pilPrintPage default on', async () => {
  const { FIELDS } = await import(path.join(EMBOSS, 'format', 'field-registry.mjs'));
  const byKey = (k) => FIELDS.find((f) => f.key === k);
  for (const key of ['tableEndMarker', 'docEndMarker', 'showBullets', 'pilPrintPage']) {
    const f = byKey(key);
    assert.ok(f, `${key} is registered`);
    assert.equal(f.default, true, `${key} defaults to true`);
    assert.equal(f.audience, 'transcriber', `${key} is a transcriber-audience option`);
    assert.ok(f.save.some((s) => s.off === true), `${key} is saved as an "off" flag (absence = on)`);
  }
});
