// Written FIRST (AGENTS.md rule 5), shown to fail against the pre-change copy of document.mjs kept in
// this session's scratch folder (uk-numbering/document.mjs.orig), before the format/document.mjs
// changes described below.
//
// Task 1 (UK-9 follow-up): a UKAAF document with a title page got TWO braille page 1s — assembleTitlePage
// gives the title page brailleNumber(1) (UK-9: plain Arabic, not BANA's t1 series), but buildDocPages/
// buildDocPagesAsync numbered the body independently, starting its own sequence at 1 too. Fixed so UKAAF
// numbering is one continuous Arabic sequence per volume: title page 1, accessible-copy notice page 2
// (assembleUkTitleNoticePage, UK-9 — always present for UKAAF), then the body continuing from 3. Restarts
// at 1 in every volume (formatVolumesFromBuild), including the multi-volume split, which previously gave
// every volume's own title page (assembleTitlePage) with no notice page at all and body restarting at 1
// right under it. BANA is completely unaffected (isBana always keeps offset 0): its title page is t1 in
// the SEPARATE transcriber series (2.2.1b), and the body starts at 1 by BANA's own rule. A UKAAF document
// with NO title page is unaffected too (offset 0 there as well).
//
// Task 2 (A74 / UK-5): UK-5 ("UKAAF carries no blank lines at all, except before a sub-heading") is
// implemented for the top-level document flow via joinsWithoutBlank (buildDocPages/buildDocPagesAsync's
// own call), but a box's children were laid out through a hand-rolled loop (traceBlockCore's 'box' case)
// that never consulted it (only the narrow BANA §10.2.3 "directions" case, P5, was mirrored there) — so a
// UKAAF box kept every blank line between its own children. Fixed by consulting joinsWithoutBlank for
// every sibling pair inside a box too, UKAAF only; BANA's box layout is unchanged (still only the P5 case).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatVolumes, formatBlock } from '../format/document.mjs';

const upper = (s) => String(s).toUpperCase();
const identity = (s) => upper(s);
const UKAAF = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 38, depth: 25, translate: identity, toc: false, docEndMarker: false, ...extra });
const BANA = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: identity, toc: false, ...extra });

function pages(brf) {
  return brf.split('\x0c').map((p) => { const a = p.replace(/\r\n$/, '').split('\r\n'); return a; });
}
const trim0 = (page) => (page[0] || '').trim();
const trimLast = (page) => (page[page.length - 1] || '').trim();
// The braille page number at the end of line 1 (UKAAF's own running-head placement) — from page 2 of a
// body run onward the running head may also carry the (translated) book title, so a plain trim0()
// equality check only works on the FIRST page of a run (no title shown there — runningHead's own
// pageNum>1 rule, unaffected by this brief: still keyed to the first page of THIS assemble() call, not
// to the printed number). num0() reads just the trailing number, regardless of any title text before it.
const num0 = (page) => { const m = /(#[A-J]+)\s*$/.exec(page[0] || ''); return m ? m[1] : null; };

// A body with enough paragraphs to span several UKAAF braille pages (depth 25 -> 24 content lines/page).
function longBodyBlocks(n = 60) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ type: 'para', text: `Paragraph number ${i} with a little filler text so it wraps.` });
  return out;
}
// Longer paragraphs (matches tests/titlepage_ukaaf.test.mjs's own two-volume fixture) — enough real
// content per paragraph that o.volumePages actually forces more than one volume.
function volumeBodyBlocks(n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ type: 'para', text: `Paragraph ${i}. Enough body text that this book actually splits into more than one UKAAF volume once each one is limited to a few pages.` });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Task 1: continuous Arabic numbering, single volume.
// ---------------------------------------------------------------------------------------------------
test('UKAAF + title page: title=1, notice=2, body continues from 3 (single volume)', () => {
  const doc = { title: 'A Book', blocks: [{ type: 'titlepage' }, ...longBodyBlocks(60)] };
  const brf = formatDocument(doc, UKAAF());
  const ps = pages(brf);
  assert.ok(ps.length >= 4, `expected title + notice + at least 2 body pages, got ${ps.length}`);
  assert.equal(trim0(ps[0]), '#A', 'page 1: title page');
  assert.equal(trim0(ps[1]), '#B', 'page 2: accessible-copy notice page');
  assert.equal(num0(ps[2]), '#C', 'page 3: first body page continues the SAME sequence, not restarted at 1');
  assert.equal(num0(ps[3]), '#D', 'page 4: second body page');
});

test('UKAAF + title page: a short document (title+notice+ONE body page) still numbers the body page 3', () => {
  const doc = { title: 'A Book', blocks: [{ type: 'titlepage' }, { type: 'para', text: 'Just one short paragraph.' }] };
  const ps = pages(formatDocument(doc, UKAAF()));
  assert.equal(ps.length, 3, 'title + notice + one body page');
  assert.equal(trim0(ps[0]), '#A');
  assert.equal(trim0(ps[1]), '#B');
  assert.equal(trim0(ps[2]), '#C', 'the only body page is page 3, not page 1');
});

// ---------------------------------------------------------------------------------------------------
// Task 1: two volumes — restart at 1 in EACH volume (title=1, notice=2, body from 3), including the
// notice page, which the multi-volume split previously omitted entirely for every volume.
// ---------------------------------------------------------------------------------------------------
test('UKAAF + title page, two volumes: each volume restarts at 1 (title=1, notice=2, body from 3)', () => {
  const doc = { title: 'A Book', blocks: [{ type: 'titlepage' }, ...volumeBodyBlocks(40)] };
  const vols = formatVolumes(doc, UKAAF({ volumePages: 5 }));
  assert.ok(vols.length > 1, 'the book actually split into more than one volume');
  for (const v of vols) {
    const ps = pages(v.brf);
    assert.ok(ps.length >= 3, `volume ${v.volume}: title + notice + at least one body page`);
    assert.equal(trim0(ps[0]), '#A', `volume ${v.volume}: title page is page 1`);
    assert.equal(trim0(ps[1]), '#B', `volume ${v.volume}: notice page is page 2 (previously missing here)`);
    assert.equal(num0(ps[2]), '#C', `volume ${v.volume}: body continues from page 3, not restarted at 1`);
  }
});

// ---------------------------------------------------------------------------------------------------
// Task 1: a UKAAF document with NO title page is unaffected — body still starts at page 1.
// ---------------------------------------------------------------------------------------------------
test('UKAAF, no title page: body numbering is unchanged, starts at 1', () => {
  const doc = { blocks: longBodyBlocks(60) };   // no doc.title: keeps the running head plain (title-in-header is a separate, unrelated UKAAF behaviour, unaffected by this brief)
  const ps = pages(formatDocument(doc, UKAAF()));
  assert.equal(trim0(ps[0]), '#A', 'first (and only) page series starts at 1, exactly as before');
  assert.equal(trim0(ps[1]), '#B', 'second page is page 2, the ordinary sequential count');
});

// ---------------------------------------------------------------------------------------------------
// Task 1: BANA is completely unaffected — its title page is t1 (separate series), body starts at 1.
// ---------------------------------------------------------------------------------------------------
test('BANA + title page: body still starts at braille page 1 (BANA\'s own rule, untouched)', () => {
  const doc = { title: 'A Book', blocks: [{ type: 'titlepage' }, ...longBodyBlocks(60)] };
  const brf = formatDocument(doc, BANA());
  const ps = pages(brf);
  assert.ok(ps.length >= 3, 'title page + at least 2 body pages');
  // BANA's braille page number sits on the LAST line, bottom-right (Formats §1.15.1a).
  assert.match(trimLast(ps[0]), /(?:^|\s)T#A$/, 'title page is t1, the transcriber series');
  assert.match(trimLast(ps[1]), /(?:^|\s)#A$/, 'first body page is plain #A — page 1, BANA\'s own rule');
  assert.doesNotMatch(trimLast(ps[1]), /T#A$/, 'not t-prefixed');
});

// ---------------------------------------------------------------------------------------------------
// Task 2 (A74 / UK-5): a UKAAF box's own children join without a blank line, same as the top-level
// document flow.
// ---------------------------------------------------------------------------------------------------
test('UK-5 in a box: a UKAAF box with paragraphs and a list inside has no blank lines between them', () => {
  const block = {
    type: 'box',
    blocks: [
      { type: 'para', text: 'Before.' },
      { type: 'list', items: [{ text: 'Apples' }, { text: 'Pears' }] },
      { type: 'para', text: 'After.' },
    ],
  };
  const lines = formatBlock(block, UKAAF(), true).map((l) => l.trim());
  const before = lines.indexOf(upper('Before.'));
  assert.ok(before >= 0, `'Before.' not found in ${JSON.stringify(lines)}`);
  assert.equal(lines[before + 1], upper('Apples'), `no blank line before the list, inside the box: ${JSON.stringify(lines)}`);
  const pears = lines.indexOf(upper('Pears'));
  assert.equal(lines[pears + 1], upper('After.'), `no blank line after the list, inside the box: ${JSON.stringify(lines)}`);
});

// A list carries no blank margin of its own in UKAAF (the 'compact' style, UK-5's own default) —
// the test above passes even without this brief's fix, since there is no blank line to strip in the
// first place. A table DOES carry its own leading/trailing blank line in every mode (formatTable's own
// unconditional blank surround — confirmed with a standalone probe: formatBlock({type:'table',...},
// UKAAF-opts) returns ["", "FRUIT", "APPLE", ...end marker..., ""]), so a box with a table genuinely
// exercises the fix: before it, only the narrow P5 (BANA para+directions) case stripped anything here,
// so a UKAAF box's table kept its blank margin exactly like BANA's.
test('UK-5 in a box: a UKAAF box with a table inside has no blank lines around it either', () => {
  const block = {
    type: 'box',
    blocks: [
      { type: 'para', text: 'Before.' },
      { type: 'table', headers: ['Fruit'], rows: [['Apple']] },
      { type: 'para', text: 'After.' },
    ],
  };
  const lines = formatBlock(block, UKAAF({ tableEndMarker: false }), true).map((l) => l.trim());
  const before = lines.indexOf(upper('Before.'));
  assert.ok(before >= 0, `'Before.' not found in ${JSON.stringify(lines)}`);
  assert.equal(lines[before + 1], upper('Fruit'), `no blank line before the table, inside the box: ${JSON.stringify(lines)}`);
  const lastRow = lines.indexOf(upper('Apple'));
  assert.equal(lines[lastRow + 1], upper('After.'), `no blank line after the table, inside the box: ${JSON.stringify(lines)}`);
});

// ---------------------------------------------------------------------------------------------------
// Task 2: BANA box layout is unchanged (byte-identical) — a plain paragraph/table/paragraph box still
// carries its ordinary blank lines between children (only the narrow §10.2.3 "directions" case, P5,
// ever drops one).
// ---------------------------------------------------------------------------------------------------
test('UK-5 in a box: BANA box layout is unchanged — blank lines around a table are kept', () => {
  const block = {
    type: 'box',
    blocks: [
      { type: 'para', text: 'Before.' },
      { type: 'table', headers: ['Fruit'], rows: [['Apple']] },
      { type: 'para', text: 'After.' },
    ],
  };
  const lines = formatBlock(block, BANA(), true).map((l) => l.trim());
  const before = lines.indexOf(upper('Before.'));
  assert.ok(before >= 0, `'Before.' not found in ${JSON.stringify(lines)}`);
  assert.equal(lines[before + 1], '', `BANA still keeps its blank line before the table, inside the box: ${JSON.stringify(lines)}`);
});
