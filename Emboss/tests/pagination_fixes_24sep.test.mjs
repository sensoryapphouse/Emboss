// Pagination fixes from the real-book validation of 24 Sep 2026 (docs/real-book-validation-24sep.md), one describe
// block per bug, in the order they were fixed. Every expectation comes from the rule quoted with it, or from the
// invariant that the page planner (applyPageBoundaries, format/document.mjs) and the page assembler (assemble,
// format/page.mjs) agree line for line - never from Emboss's own earlier output.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { formatDocument, formatDocumentAsync, formatBlock, traceBlock, tableLayout } from '../format/document.mjs';
import { banaPageChangeNumber } from '../format/page.mjs';
import * as louis from '../engine/louis.mjs';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

// ---- fake translate (structural tests: which line goes on which page) ----------------------------------------------
const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(String(s), (_, i) => i) });
const bana = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: upPos, ...extra });
const ukaaf = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: up, translatePos: upPos, ...extra });
const rstrip = (l) => String(l).replace(/\s+$/, '');
const splitPages = (brf) => brf.split('\f').map((p) => p.split('\r\n').slice(0, -1));
const PER_PAGE = 23;                                         // BANA 25 lines, line 1 (print page / running head) and line 25 (page number)
const body = (page) => page.slice(1, 1 + PER_PAGE);
const lastText = (lines) => { for (let k = lines.length - 1; k >= 0; k--) if (lines[k].trim()) return k; return -1; };
const firstText = (lines) => lines.findIndex((l) => l.trim());
const isPageChange = (l) => banaPageChangeNumber(rstrip(l)) !== null;

const words = (n, tag = 'w') => Array.from({ length: n }, (_, i) => tag + (i % 10)).join(' ');
const para = (n, tag) => ({ type: 'para', text: words(n, tag) });
const pn = (page, extra = {}) => ({ type: 'pagenum', page, text: page, ...extra });
const twoLineFirstItem = () => ({ type: 'list', kind: 'plain', items: [
  { text: 'First item of the list, long enough that it needs a runover line in braille.' }, { text: 'Second item.' }, { text: 'Third item.' }] });

// Format with a trace and return { pages, trace }.
function run(doc, o) {
  const trace = {};
  const brf = formatDocument(doc, { ...o, trace });
  return { brf, pages: splitPages(brf), trace };
}

// The invariant (bug 1): the lines applyPageBoundaries planned for every page are exactly the body lines assemble put on
// it, and a planned "free" top line (lifted onto line 1) is the page change indicator whose number line 1 shows.
function assertPlanMatches({ pages, trace }, perPage = PER_PAGE, label = '') {
  const { pages: plan, lines } = trace.pagePlan;
  assert.equal(plan.length, pages.length, `${label}: planned ${plan.length} pages, assembled ${pages.length}`);
  plan.forEach((pg, p) => {
    const end = p + 1 < plan.length ? plan[p + 1].start : lines.length;
    const planned = lines.slice(pg.start + pg.free, end).map(rstrip);
    if (p + 1 < plan.length) assert.equal(planned.length, perPage, `${label}: page ${p + 1} planned ${planned.length} body lines`);
    else assert.ok(planned.length <= perPage, `${label}: last page planned ${planned.length} body lines`);
    while (planned.length < perPage) planned.push('');
    assert.deepEqual(pages[p].slice(1, 1 + perPage).map(rstrip), planned, `${label}: page ${p + 1} body differs from the plan`);
    if (pg.free) assert.ok(rstrip(pages[p][0]).endsWith(banaPageChangeNumber(rstrip(lines[pg.start]))), `${label}: page ${p + 1} line 1 does not carry the lifted indicator`);
  });
}

// ====================================================================================================================
// Bug 1 - page-fit drift. applyPageBoundaries treated EVERY page change line met at the top of a page as costing no
// line; assemble lifts only the FIRST line of a page onto line 1 (Formats 1.11.2), so after two stacked indicators every
// later keep decision was 1-3 lines off (anthology p343 to the end). The planner now uses assemble's own line-1 rule
// (page.mjs banaLineOne) and counts the free line once per page.
// ====================================================================================================================
describe('bug 1: the page plan agrees with the assembled pages (stacked page change lines)', () => {
  test('two stacked indicators at a page top: plan == assembled pages, and no list starts on the last line (8.3.5c)', () => {
    let stackedTops = 0;
    for (let a = 250; a <= 330; a += 4) {
      for (let c = 60; c <= 200; c += 10) {
        // R1 and R2 are lettered numbers, which bug 10's combining leaves alone, so the two indicators stay stacked.
        const doc = { title: 'Drift', blocks: [pn('1'), para(a), pn('R1'), pn('R2'), para(c), twoLineFirstItem()] };
        const r = run(doc, bana());
        assertPlanMatches(r, PER_PAGE, `a=${a} c=${c}`);
        r.trace.pagePlan.pages.forEach((pg) => { if (pg.free && isPageChange(r.trace.pagePlan.lines[pg.start + 1] || '')) stackedTops++; });
        for (const page of r.pages) {
          const li = body(page).findIndex((l) => /^1\. FIRST ITEM/.test(l.trim()));
          // 8.3.5b-c: "A list may not begin on the last line of a page"; a first item of two lines never on the next-to-last.
          if (li >= 0) assert.ok(li < PER_PAGE - 2, `a=${a} c=${c}: the list's two-line first item starts on body line ${li + 1}`);
        }
      }
    }
    assert.ok(stackedTops > 0, 'the sweep must include a page that opens with two stacked indicators');
  });

  test('the second stacked indicator takes a body line: it is line 2, not lifted', () => {
    for (let a = 250; a <= 330; a += 2) {
      const r = run({ title: 'Drift', blocks: [pn('1'), para(a), pn('R1'), pn('R2'), para(100)] }, bana());
      const p = r.pages.findIndex((pg) => rstrip(pg[0]).endsWith('R1'));
      if (p < 0 || !isPageChange(r.pages[p][1])) continue;
      assert.equal(banaPageChangeNumber(rstrip(r.pages[p][1])), 'R2');
      assertPlanMatches(r);
      return;
    }
    assert.fail('no layout put R1 at the top of a page');
  });

  test('a spelled-out number merged onto line 1 (1.14.1c) is also counted once, as assemble does', () => {
    for (let a = 250; a <= 330; a += 3) assertPlanMatches(run({ blocks: [pn('1'), para(a), pn('89', { spelled: 'eighty-nine' }), para(200)] }, bana()), PER_PAGE, `a=${a}`);
  });

  test('with suppressHeader nothing is lifted onto line 1, and the plan still matches', () => {
    for (let a = 250; a <= 330; a += 4) {
      const r = run({ blocks: [pn('1'), para(a), pn('2'), para(200)] }, bana({ suppressHeader: true }));
      const { pages: plan } = r.trace.pagePlan;
      assert.ok(plan.every((pg) => pg.free === 0));
      plan.forEach((pg, p) => {
        const end = p + 1 < plan.length ? plan[p + 1].start : r.trace.pagePlan.lines.length;
        assert.deepEqual(r.pages[p].slice(0, end - pg.start).map(rstrip), r.trace.pagePlan.lines.slice(pg.start, end).map(rstrip));
      });
    }
  });
});

// ====================================================================================================================
// Bug 6 - BANA 1.11.4: "Begin the new print page on the next braille page when there is not enough room for the page
// change indicator and one line of text (other than a heading)." A page change line just before a block that moves to
// the next page (the list rule F-35, a box, a forced glossary page F-204) moves with it.
// ====================================================================================================================
describe('bug 6: a page change line is never left as the last line of a page (1.11.4)', () => {
  test('page change line before a list whose first item moves', () => {
    let fired = 0;
    for (let a = 200; a <= 320; a += 2) {
      const r = run({ blocks: [pn('1'), para(a), pn('2'), twoLineFirstItem()] }, bana());
      assertPlanMatches(r, PER_PAGE, `a=${a}`);
      r.pages.slice(0, -1).forEach((page, p) => {
        const b = body(page), k = lastText(b);
        assert.ok(k < 0 || !isPageChange(b[k]), `a=${a}: page ${p + 1} ends with the page change line ${b[k]}`);
      });
      if (r.pages.some((pg) => rstrip(pg[0]) === ' '.repeat(39) + '2' || rstrip(pg[0]).endsWith(' 2'))) fired++;
    }
    assert.ok(fired > 0, 'some layout must carry the indicator to the top of the next page (line 1 shows 2)');
  });

  test('page change line before a forced glossary page (21.2.1a) goes to the new page', () => {
    for (let a = 20; a <= 300; a += 20) {
      const doc = { blocks: [pn('1'), para(a), pn('2'), { type: 'heading', level: 1, text: 'Glossary' },
        { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'Alpha', def: 'The first letter.' }, { term: 'Beta', def: 'The second letter.' }] }] };
      const r = run(doc, bana());
      assertPlanMatches(r, PER_PAGE, `a=${a}`);
      const g = r.pages.findIndex((pg) => body(pg).some((l) => l.includes('GLOSSARY')));
      assert.ok(g > 0);
      assert.ok(rstrip(r.pages[g][0]).endsWith(' 2'), `a=${a}: the glossary page shows print page 2 on line 1: ${r.pages[g][0]}`);
      const prev = body(r.pages[g - 1]);
      assert.ok(!isPageChange(prev[lastText(prev)]), `a=${a}: the page before the glossary ends with its page change line`);
    }
  });
});

// ====================================================================================================================
// Bug 8 - BANA 4.1.3 (a heading is followed on the same braille page by at least one line of the text it introduces)
// and 8.3.5d: when the list, graphic or box after a heading moves to the next page as a unit, the heading goes with it.
// ====================================================================================================================
describe('bug 8: a heading is not left alone at the foot of a page', () => {
  const noHeadingAtFoot = (r, label) => r.pages.slice(0, -1).forEach((page, p) => {
    const b = body(page), k = lastText(b);
    assert.ok(k < 0 || !/PRACTICE PROBLEMS/.test(b[k]), `${label}: page ${p + 1} ends with the heading`);
  });
  test('heading before a list whose first item moves', () => {
    for (let a = 200; a <= 320; a += 2) {
      const r = run({ blocks: [pn('1'), para(a), { type: 'heading', level: 2, text: 'Practice Problems' }, twoLineFirstItem()] }, bana());
      assertPlanMatches(r, PER_PAGE, `a=${a}`);
      noHeadingAtFoot(r, `list a=${a}`);
    }
  });
  test('heading before a described graphic that moves whole', () => {
    const graphic = { type: 'graphic', src: 'x.png', alt: words(40, 'pic') };
    for (let a = 200; a <= 320; a += 2) {
      const r = run({ blocks: [pn('1'), para(a), { type: 'heading', level: 2, text: 'Practice Problems' }, graphic] }, bana());
      assertPlanMatches(r, PER_PAGE, `a=${a}`);
      noHeadingAtFoot(r, `graphic a=${a}`);
    }
  });
});

// ====================================================================================================================
// Bug 10 - BANA 1.11.8d: "When a page is blank or has only an uncaptioned illustration, combine that/those page(s) with
// the next page on which text occurs." 1.11.8: "Do not combine different types of numbering systems."
// ====================================================================================================================
describe('bug 10: blank and picture-only print pages are combined with the next (1.11.8d)', () => {
  const pcLines = (brf) => splitPages(brf).flatMap((pg) => [rstrip(pg[0]).split(/\s+/).pop(), ...body(pg).filter(isPageChange).map((l) => banaPageChangeNumber(rstrip(l)))]);
  test('a page holding only an undescribed image: one indicator 2-3', () => {
    const doc = { blocks: [pn('1'), para(30), pn('2'), { type: 'graphic', src: 'x.jpg', alt: '' }, pn('3'), para(30)] };
    const lines = splitPages(formatDocument(doc, bana())).flat().map(rstrip);
    assert.ok(lines.some((l) => /^-+2-3$/.test(l)), lines.join('\n'));
    assert.ok(!lines.some((l) => /^-+2$/.test(l) || /^-+3$/.test(l)));
  });
  test('blank pages 3 and 4 before page 5: 3-5 (the math workbook, p3)', () => {
    const doc = { blocks: [pn('1'), para(30), pn('3'), pn('4'), pn('5'), para(30)] };
    assert.ok(pcLines(formatDocument(doc, bana())).includes('3-5'));
  });
  test('a described image, lettered numbers and mixed systems are not combined', () => {
    const described = { blocks: [pn('1'), para(30), pn('2'), { type: 'graphic', src: 'x.jpg', alt: 'A map' }, pn('3'), para(30)] };
    assert.deepEqual(pcLines(formatDocument(described, bana())).filter((x) => /2|3/.test(x)), ['2', '3']);
    const lettered = { blocks: [pn('1'), para(30), pn('R1'), pn('R2'), para(30)] };
    assert.deepEqual(pcLines(formatDocument(lettered, bana())).filter((x) => /R/.test(x)), ['R1', 'R2']);
    const mixed = { blocks: [pn('i'), para(30), pn('ii'), pn('1'), para(30)] };
    assert.ok(pcLines(formatDocument(mixed, bana())).includes('1'));
  });
  test('UKAAF is not affected, and block indexes (the editor row map) are kept', () => {
    const doc = { blocks: [pn('1'), para(30), pn('2'), { type: 'graphic', src: 'x.jpg', alt: '' }, pn('3'), para(30, 'z')] };
    assert.ok(!formatDocument(doc, ukaaf()).includes('2-3'));
    const r = run(doc, bana());
    const zRows = r.trace.rows.filter((bi, k) => bi === 5);
    assert.ok(zRows.length > 0, 'the last paragraph still maps to its own block index 5');
  });
});

// ====================================================================================================================
// Bug 11 - the verse keep rule (F-126, 13.3.1b "A line of poetry may not be divided between braille pages") counted the
// blank line after a poem as part of its last line, so a one-line last line that fitted the last line of a page moved.
// ====================================================================================================================
describe('bug 11: a poem\'s last line is not pushed alone onto the next page', () => {
  test('the last verse line stays on line 24 when it fits there', () => {
    const verse = (k) => ({ type: 'play', subtype: 'verse', text: `Line ${k} of the poem` });
    let onLast = 0;
    for (let a = 200; a <= 320; a += 1) {
      const doc = { blocks: [pn('1'), para(a), verse(1), verse(2), verse(3), verse(4), para(40)] };
      const r = run(doc, bana());
      assertPlanMatches(r, PER_PAGE, `a=${a}`);
      r.pages.forEach((page, p) => {
        const b = body(page);
        if (rstrip(b[PER_PAGE - 1]) === 'LINE 4 OF THE POEM') onLast++;
        if (p === 0 || rstrip(b[firstText(b)]) !== 'LINE 4 OF THE POEM') return;
        const prev = body(r.pages[p - 1]);
        assert.ok(prev[PER_PAGE - 1].trim(), `a=${a}: the last line moved to page ${p + 1} although line 24 of page ${p} was free`);
      });
    }
    assert.ok(onLast > 0, 'some layout must put the last line on line 24 (it moved before the fix)');
  });
});

// ====================================================================================================================
// Bug 12 - BANA 11.2.6d: "If necessary, a table may be divided between pages ... Insert the page break at the
// beginning of a new row if possible." A vertically divided table's section headings, separation line and first row
// are kept together, so a section heading never ends a page.
// Bug 13 - BANA 11.4.4b: "Insert a blank line between a running head and the repeated headings" - only a running
// head, not a line 1 that holds just the print page number because the title is too long.
// ====================================================================================================================
describe('bugs 12 and 13: tables', () => {
  const wide = { type: 'table', format: 'vertical', headers: ['Row', 'Volume of popcorn in ounces', 'Price of the bag in dollars', 'Proportional or not'],
    rows: [['Row 1', '10', '6', 'yes'], ['Row 2', '20', '12', 'yes'], ['Row 3', '35', '15', 'no'], ['Row 4', '48', '18', 'no']] };
  test('the fixture is a vertically divided table; formatBlock and traceBlock agree, keep groups included (A39)', () => {
    assert.equal(tableLayout(wide, bana()), 'vertical');
    const f = formatBlock(wide, bana()), t = traceBlock(wide, bana());
    assert.deepEqual(t.map((x) => rstrip(x.s)), f.map(rstrip));
    assert.ok(Array.isArray(f.keepGroups) && f.keepGroups.length >= 2);
    assert.deepEqual(t.keepGroups, f.keepGroups);
    assert.equal(formatBlock(wide, ukaaf()).keepGroups, undefined, 'BANA only');
  });
  test('a section heading is never the last line of a page', () => {
    for (let a = 150; a <= 330; a += 2) {
      const r = run({ blocks: [pn('1'), para(a), wide] }, bana());
      assertPlanMatches(r, PER_PAGE, `a=${a}`);
      r.pages.slice(0, -1).forEach((page, p) => {
        const nb = body(r.pages[p + 1]), k = firstText(nb);
        assert.ok(k < 0 || !/^\s*"3/.test(nb[k]), `a=${a}: page ${p + 2} opens with a separation line (its heading was left on page ${p + 1})`);
      });
    }
  });
  test('repeated column headings: blank line under a running head only (11.4.4b)', () => {
    const table = { type: 'table', headers: ['Name', 'Value'], rows: Array.from({ length: 40 }, (_, i) => [`Item ${i}`, String(i)]) };
    const shortT = splitPages(formatDocument({ title: 'Short', blocks: [table] }, bana()));
    const longT = splitPages(formatDocument({ title: 'A title far too long to fit as a running head at all', blocks: [table] }, bana()));
    assert.ok(rstrip(shortT[1][0]).includes('SHORT'));
    assert.equal(rstrip(shortT[1][1]), '', 'blank line under the running head');
    assert.ok(/NAME/.test(shortT[1][2]));
    assert.equal(rstrip(longT[1][0]), '', 'no running head fits');
    assert.ok(/NAME/.test(longT[1][1]), `repeated headings start on line 2: ${longT[1].slice(0, 3).join(' | ')}`);
  });
});

// ====================================================================================================================
// Parity: buildDocPages and buildDocPagesAsync paginate the same way.
// ====================================================================================================================
describe('sync and async pagination agree', () => {
  test('synthetic documents', async () => {
    const docs = [
      { title: 'Drift', blocks: [pn('1'), para(290), pn('R1'), pn('R2'), para(120), twoLineFirstItem()] },
      { blocks: [pn('1'), para(250), pn('2'), twoLineFirstItem(), pn('3'), { type: 'graphic', src: 'x', alt: '' }, pn('4'), para(40)] },
    ];
    for (const d of docs) assert.equal(await formatDocumentAsync(d, bana()), formatDocument(d, bana()));
  });
});

// ====================================================================================================================
// The three real books of the validation (BANA 40x25, UEB grade 2, page numbers on): the invariant holds on every page,
// and the layout faults the validation counted are gone.
// ====================================================================================================================
describe('real books: the plan matches the assembled pages on every page', () => {
  let translate, translateG1, parseFile;
  before(async () => {
    await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
    translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
    translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
    ({ parseFile } = await import('../input/parse.mjs'));
  });
  for (const bk of ['9781946636171', '9780076996285', '9780544087507']) {
    test(bk, async () => {
      const f = path.join(EMBOSS, 'tests', 'nimas_samples', `${bk}NIMAS.xml`);
      const model = await parseFile(path.basename(f), fs.readFileSync(f, 'utf8'));
      const r = run(model, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1 });
      assertPlanMatches(r, PER_PAGE, bk);
      r.pages.slice(0, -1).forEach((page, p) => {
        const b = body(page), k = lastText(b);
        if (k < 0) return;
        const bi = r.trace.rows[p * 25 + 1 + k];
        assert.ok(!(model.blocks[bi] && model.blocks[bi].type === 'heading' && r.trace.rows[(p + 1) * 25 + 1 + firstText(body(r.pages[p + 1]))] !== bi), `${bk}: page ${p + 1} ends with a heading`);
        const f0 = firstText(b);
        if (p === 0) return;
        // BANA 11.4.4b: "Insert a blank line between a running head and the repeated headings" - the one blank line a page
        // may open with: a table continued from the previous page, its headings repeated under a running head (anthology
        // p1160, the grammar handbook's "Present-Tense Verb Forms" table).
        const ti = r.trace.rows[p * 25 + 1 + f0];
        // (a table inside a list item, item.blocks since 25 Sep, repeats its headings the same way)
        const hasTable = (b) => !!b && (b.type === 'table' || (b.type === 'list' && (b.items || []).some((it) => it && (it.blocks || []).some((x) => x && x.type === 'table'))));
        const repeat = f0 === 1 && hasTable(model.blocks[ti]) && r.trace.rows.slice((p - 1) * 25, p * 25).includes(ti) && rstrip(page[0]).trim().length > 0;
        // K23 / BANA 1.18 (March 2024 Updates): "When rules determine that a blank line follows text ... and that text ends on
        // line 24 or 25 of a braille page, the required blank line is placed at the top of the next braille page; ... line 2
        // if a running head is used" - one blank line under a running head, after a page whose last body line is text.
        const carried = f0 === 1 && rstrip(body(r.pages[p - 1])[PER_PAGE - 1] || '') !== '' && rstrip(page[0]).trim().length > 0;
        // K15 / BANA 11.13 (facing pages): the right-hand page of a table read across facing pages is blank opposite the
        // left-hand page's note and heading, so its top box line and rows are level with the left-hand page's (11.13.1e/g).
        const facingRight = hasTable(model.blocks[ti]) && r.pages[p - 1].join('\n').includes('R1D ACR FAC+') && r.trace.rows.slice((p - 1) * 25, p * 25).includes(ti);
        if (!repeat && !carried && !facingRight) assert.equal(f0, 0, `${bk}: page ${p + 1} starts with ${f0} blank line(s)`);
      });
    });
  }
});

// ====================================================================================================================
// Follow-up (24 Sep). (1) The anthology p1160 failure of the real-book test above was not a plan/assemble disagreement
// (the plan matched on every page): the page opens with the blank line BANA 11.4.4b puts between a running head and a
// table's repeated headings, which the "no page starts with a blank line" check did not allow for. Minimal repro: a
// titled document whose table's heading group ends a page, so its next row opens the next page. (2) Contents page
// numbers and the transcriber page series came from `line / perPage`, but a BANA page whose page change line is lifted
// onto line 1 (1.11.2) holds perPage + 1 output lines: they now come from the page plan. (3) resolvePageNumbers keeps a
// combined (`combineWithNext`) page as an empty placeholder, so block indexes (trace.rows) do not shift (F-46).
// ====================================================================================================================
describe('follow-up: repeated table headings, contents and transcriber page numbers, combined page indexes', () => {
  const table = { type: 'table', headers: ['Present-Tense Verb Forms'],
    rows: [['Singular', 'Plural'], ['I sleep', 'we sleep'], ['you sleep', 'you sleep'], ['she, he, it sleeps', 'they sleep']] };
  // The anthology's shape (9780544087507, grammar handbook 11.1, braille p1159-1160): a one-cell heading row spanning the
  // table ("Present-Tense Verb Forms") and a bold first row. The heading group (heading, separation line, first row) ends
  // p1159 and the next row opens p1160, so the headings are repeated there, under the running head, after a blank line.
  // A table that OPENS a page (its whole heading group moved there) gets no blank line: 11.4.4b is for repeats only.
  test('a table continued under a running head: blank line + repeated headings; a table opening a page: none (11.4.4b)', () => {
    let repeats = 0, opens = 0;
    const tableLine = (l) => /PRESENT-TENSE VERB FORMS|SINGULAR|SLEEP/.test(l);
    for (let a = 150; a <= 330; a += 1) {
      const r = run({ title: 'Short', blocks: [pn('1'), para(a), table] }, bana());
      assertPlanMatches(r, PER_PAGE, `a=${a}`);
      r.pages.forEach((page, p) => {
        const b = body(page), f0 = firstText(b);
        if (p === 0) return;
        const continued = body(r.pages[p - 1]).some(tableLine);
        if (f0 === 0) {
          if (rstrip(b[0]) === 'PRESENT-TENSE VERB FORMS') { assert.ok(!continued, `a=${a}: page ${p + 1} repeats the headings without the blank line`); opens++; }
          return;
        }
        assert.equal(f0, 1, `a=${a}: page ${p + 1} opens with ${f0} blank lines`);
        assert.ok(continued, `a=${a}: page ${p + 1} opens with a blank line but continues no table`);
        assert.ok(rstrip(page[0]).includes('SHORT'), `a=${a}: page ${p + 1} has a blank first line but no running head`);
        assert.equal(rstrip(b[1]), 'PRESENT-TENSE VERB FORMS', `a=${a}: page ${p + 1}: the blank is not above the repeated headings`);
        assert.ok(/^"3+$/.test(rstrip(b[2])));
        repeats++;
      });
    }
    assert.ok(repeats > 0, 'some layout must continue the table on a new page');
    assert.ok(opens > 0, 'some layout must open a page with the whole table');
  });

  // Headings after page change lines and after blocks carried to the next page (bug 6/8 carries), with page change lines
  // lifted onto line 1. The contents page number of every heading is the braille page (line 25) it is printed on.
  const headingPages = (brf) => {
    const pages = splitPages(brf);
    const first = pages.findIndex((pg) => /^ +#A$/.test(rstrip(pg[24] || '')));   // body page 1 (contents pages are p-numbered)
    const toc = new Map(), at = new Map();
    for (const pg of pages.slice(0, first)) for (const l of pg) { const m = /^\s*(PART [A-Z]+)\b.*\s(#[A-J]+)$/.exec(rstrip(l)); if (m) toc.set(m[1], m[2]); }
    pages.slice(first).forEach((pg) => body(pg).forEach((l) => { const t = l.trim(); if (/^PART [A-Z]+$/.test(t) && !at.has(t)) at.set(t, rstrip(pg[24]).trim()); }));
    return { toc, at };
  };
  test('contents page numbers are the pages the headings are on (page change lines lifted, blocks carried)', () => {
    const names = Array.from({ length: 12 }, (_, k) => 'Part ' + String.fromCharCode(65 + k) + String.fromCharCode(65 + (k * 7) % 26));
    let lifted = 0;
    for (let a = 120; a <= 300; a += 9) {
      const blocks = [];
      names.forEach((nm, k) => blocks.push(pn(String(k + 1)), para(a + k * 13, 'p' + k), pn(String(k + 1) + 'x'), { type: 'heading', level: 2, text: nm }, twoLineFirstItem()));
      const doc = { blocks };
      const trace = {};
      const brf = formatDocument(doc, { ...bana({ toc: true }), trace });
      const plain = run(doc, bana());
      lifted += plain.trace.pagePlan.pages.filter((pg) => pg.free).length;
      const { toc, at } = headingPages(brf);
      assert.equal(toc.size, names.length, `a=${a}: ${toc.size} contents entries`);
      for (const nm of names.map((x) => x.toUpperCase())) assert.equal(toc.get(nm), at.get(nm), `a=${a}: contents says ${nm} is on ${toc.get(nm)}, it is on ${at.get(nm)}`);
    }
    assert.ok(lifted > 0, 'some page must open with a lifted page change line');
  });

  test('transcriber page series: exactly the pages holding the transcriber block are t-numbered', () => {
    let checked = 0;
    for (let a = 150; a <= 330; a += 7) for (let t = 150; t <= 260; t += 11) {
      const blocks = [];
      for (let k = 1; k <= 6; k++) blocks.push(pn(String(k)), para(a + k * 17, 'b' + k));
      blocks.push({ type: 'para', text: words(t, 'tn'), matter: 'transcriber' }, pn('7'), para(60, 'z'));
      const pages = splitPages(formatDocument({ blocks }, bana()));
      let n = 0;
      pages.forEach((pg, p) => {
        const isTn = body(pg).some((l) => /^\s*TN\d/.test(l));
        const num = rstrip(pg[24]).trim();
        if (isTn) { assert.match(num, /^T#/, `a=${a} t=${t}: page ${p + 1} holds the transcriber block but is numbered ${num}`); checked++; }
        else { n++; assert.equal(num, '#' + String(n).split('').map((d) => 'JABCDEFGHI'[Number(d)]).join(''), `a=${a} t=${t}: page ${p + 1} is body page ${n}, numbered ${num}`); }
      });
    }
    assert.ok(checked > 0);
  });

  test('a combined page (combineWithNext) keeps its block index: trace.rows still maps later blocks (F-46)', () => {
    const doc = { blocks: [pn('1'), para(30), pn('2', { combineWithNext: true }), pn('3'), para(30, 'z')] };
    for (const o of [bana(), ukaaf()]) {
      const r = run(doc, o);
      assert.ok(r.trace.rows.includes(4), `${o.mode}: the last paragraph maps to its own block index 4`);
      assert.ok(!r.trace.rows.includes(5));
      assert.ok(splitPages(r.brf).flat().some((l) => /(#B-#C|2-3)$/.test(rstrip(l))), `${o.mode}: one combined indicator 2-3`);
    }
  });

  test('sync and async agree on contents and transcriber pages', async () => {
    const blocks = [];
    for (let k = 1; k <= 5; k++) blocks.push(pn(String(k)), para(200 + k * 23, 'q' + k), { type: 'heading', level: 2, text: 'Part Q' + String.fromCharCode(65 + k) }, twoLineFirstItem());
    blocks.push({ type: 'para', text: words(180, 'tn'), matter: 'transcriber' }, pn('9'), para(40));
    const d = { blocks };
    assert.equal(await formatDocumentAsync(d, bana({ toc: true })), formatDocument(d, bana({ toc: true })));
  });
});
