// K23-K25: BANA's March 2024 "Updates to Braille Formats 2016" (blank lines, exercise keep-together) and June 2024
// "Changes to the Foreign Language Sections" (the definition-list / bilingual-reference separator), as built in
// format/document.mjs. Every expectation comes from the rule quoted with it (references/_text/Updates_Braille_Formats_2016.txt,
// references/_text/Changes_Foreign_Language_Sections_Braille_Formats_2016.txt), never from Emboss's own earlier output.
// A few checks marked "guard" pin behaviour that was already right and must stay so (e.g. no blank line at the top of a
// page before a heading); every other test fails against the code before K23-K25.
//
// Structural tests use a fake translator (uppercase text, one cell per character), as pagination_fixes_24sep.test.mjs does:
// the rules are about which line goes where, not about contractions. Each layout is also run through the traced path
// (translatePos -> traceBlock) and must be identical to the plain one (formatBlock / traceBlock parity, A39).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(String(s), (_, i) => i) });
const bana = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, ...extra });
const splitPages = (brf) => brf.split('\f').map((p) => p.split('\r\n'));
const rstrip = (l) => String(l).replace(/\s+$/, '');

// Format both ways (plain and traced) and require the same braille.
function pagesOf(doc, extra = {}) {
  const plain = formatDocument(doc, bana(extra));
  const traced = formatDocument(doc, bana({ ...extra, translatePos: upPos }));
  assert.equal(traced, plain, 'traced layout (traceBlock) differs from the plain one (formatBlock)');
  return splitPages(plain).map((p) => p.map(rstrip));
}
// Where a line is: [{ page, line }] (0-based page, 0-based line index on the page) for every line equal to `text`.
const where = (pages, text) => pages.flatMap((p, pi) => p.map((l, li) => (l === text ? { page: pi, line: li } : null)).filter(Boolean));
const onePageOf = (pages, texts) => new Set(texts.map((t) => { const w = where(pages, t); assert.equal(w.length, 1, `"${t}" appears ${w.length} times`); return w[0].page; }));
const fill = (k, tag = 'Line') => Array.from({ length: k }, (_, i) => ({ type: 'para', text: `${tag} ${i}` }));   // k one-line paragraphs

// =====================================================================================================================
describe('K23: blank lines (March 2024 Updates)', () => {
  // 1.9.3: "A blank line precedes blocked paragraphs, unless they follows a cell-5 heading, a cell-7 heading, an open box
  // line, or directions."
  test('1.9.3: no blank line between directions and a blocked paragraph', () => {
    const [p] = pagesOf({ blocks: [{ type: 'para', directions: true, text: 'Read the passage and answer.' }, { type: 'para', blocked: true, text: 'A blocked paragraph follows.' }] }, { suppressHeader: true });
    assert.deepEqual(p.slice(0, 2), ['    READ THE PASSAGE AND ANSWER.', 'A BLOCKED PARAGRAPH FOLLOWS.']);
  });
  test('1.9.3 guard: an ordinary paragraph before a blocked paragraph still leaves the blank line', () => {
    const [p] = pagesOf({ blocks: [{ type: 'para', text: 'Ordinary text.' }, { type: 'para', blocked: true, text: 'Blocked.' }] }, { suppressHeader: true });
    assert.deepEqual(p.slice(0, 3), ['  ORDINARY TEXT.', '', 'BLOCKED.']);
  });

  // 3.2.1c, 4.3.1: "If a transcriber's note comes between two items that do not require a blank line between them, e.g.
  // directions and exercise material or a cell 5 heading and a blocked paragraph, no blank line is required preceding or
  // following the transcriber's note."
  test('3.2.1c: cell-5 heading, transcriber\'s note, blocked paragraph - no blank line either side of the note', () => {
    const [p] = pagesOf({ blocks: [{ type: 'heading', level: 1, text: 'Title' }, { type: 'heading', level: 2, text: 'Cell five' }, { type: 'note', text: 'A note.' }, { type: 'para', blocked: true, text: 'Blocked para.' }] }, { suppressHeader: true });
    const h = p.indexOf('    CELL FIVE');
    assert.deepEqual(p.slice(h, h + 3), ['    CELL FIVE', '      @.<A NOTE.@.>', 'BLOCKED PARA.']);
  });
  test('3.2.1c: directions, transcriber\'s note, blocked paragraph - no blank line either side of the note', () => {
    const [p] = pagesOf({ blocks: [{ type: 'para', directions: true, text: 'Do this.' }, { type: 'note', text: 'A note.' }, { type: 'para', blocked: true, text: 'Blocked para.' }] }, { suppressHeader: true });
    assert.deepEqual(p.slice(0, 3), ['    DO THIS.', '      @.<A NOTE.@.>', 'BLOCKED PARA.']);
  });
  test('3.2.1c guard: a note between items that do need a blank line keeps it', () => {
    const [p] = pagesOf({ blocks: [{ type: 'para', text: 'Ordinary text.' }, { type: 'note', text: 'A note.' }, { type: 'para', blocked: true, text: 'Blocked.' }] }, { suppressHeader: true });
    assert.deepEqual(p.slice(0, 4), ['  ORDINARY TEXT.', '      @.<A NOTE.@.>', '', 'BLOCKED.']);
  });

  // 1.18: "When rules determine that a blank line follows text (e.g., a list, box or poem) and that text ends on line 24 or
  // 25 of a braille page, the required blank line is placed at the top of the next braille page; line 1 if there is no
  // running head or line 2 if a running head is used."
  const list = () => ({ type: 'list', items: [{ text: 'item one' }, { text: 'item two' }] });
  // The page layouts where the list's last line is line 24 (index 23), found by filling the page with k one-line paragraphs.
  function listEndingOn24(mk, extra = {}) {
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf(mk(k), extra);
      const w = where(pages, 'ITEM TWO');
      if (w.length === 1 && w[0].line === 23 && pages[w[0].page + 1]) return { pages, p: w[0].page };
    }
    throw new Error('no layout puts the list on line 24');
  }
  test('1.18: with a running head, the list\'s blank line goes to line 2 of the next page', () => {
    const { pages, p } = listEndingOn24((k) => ({ title: 'Book', blocks: [...fill(k), list(), { type: 'para', text: 'After the list.' }] }));
    assert.equal(pages[p + 1][1], '', 'line 2 is the carried blank line');
    assert.equal(pages[p + 1][2], '  AFTER THE LIST.');
  });
  test('1.18: with no running head (and no print page numbers), it goes to line 1', () => {
    const { pages, p } = listEndingOn24((k) => ({ blocks: [...fill(k), list(), { type: 'para', text: 'After the list.' }] }));
    assert.equal(pages[p + 1][0], '', 'line 1 is the carried blank line');
    assert.equal(pages[p + 1][1], '  AFTER THE LIST.');
  });
  test('1.18 guard: line 1 holding only the print page number is itself the blank line', () => {
    const { pages, p } = listEndingOn24((k) => ({ blocks: [{ type: 'pagenum', page: '5', text: '5' }, ...fill(k), list(), { type: 'para', text: 'After the list.' }] }));
    assert.equal(pages[p + 1][1], '  AFTER THE LIST.');
  });
  test('1.18 guard: a blank line that precedes the next item (before a heading) is still not carried', () => {
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), { type: 'heading', level: 2, text: 'Next' }, { type: 'para', text: 'Body.' }] });
      for (let pi = 1; pi < pages.length; pi++) assert.notEqual(pages[pi][1], '', `fill ${k}: page ${pi + 1} opens with a blank line`);
    }
  });
  test('1.18 guard: the carried blank never stands alone on a page (a block that needs the whole next page drops it)', () => {
    // An exercise question 23 lines long (a whole BANA body page with a running head) after the list: it moves to the top of
    // the page on its own (K24), so the carried blank line is dropped, not left as the only line of a page.
    const longQ = { type: 'list', kind: 'exercise', items: [{ text: '1. ' + Array.from({ length: 290 }, (_, i) => 'w' + (i % 10)).join(' ') }] };
    assert.equal(formatBlock(longQ, bana()).filter((l) => l !== '').length, 23, 'the question fills a whole body page');
    const { pages, p } = listEndingOn24((k) => ({ title: 'Book', blocks: [...fill(k), list(), longQ] }));
    const next = pages[p + 1].slice(1, 24);
    assert.ok(next.some((l) => l !== ''), 'the page after the list is not blank');
    assert.notEqual(next[0], '', 'the question opens the page');
  });
  test('1.18: a stanza ending on line 24 is followed by a blank line at the top of the next page (13.4.1d)', () => {
    const verse = (t) => ({ type: 'play', subtype: 'verse', style: 'verse', text: t });
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), verse('First stanza line one'), verse('First stanza line two'), { type: 'indicator', kind: 'line' }, verse('Second stanza line one'), verse('Second stanza line two')] });
      const w = where(pages, 'FIRST STANZA LINE TWO');
      if (w.length === 1 && w[0].line === 23 && pages[w[0].page + 1]) {
        assert.equal(pages[w[0].page + 1][1], '');
        assert.equal(pages[w[0].page + 1][2], 'SECOND STANZA LINE ONE');
        return;
      }
    }
    assert.fail('no layout puts the stanza end on line 24');
  });
});

// =====================================================================================================================
describe('K24: exercise keep-together (March 2024 Updates)', () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => tag + (i % 10)).join(' ');
  // 10.4: "Exercise questions without answer choices should be kept on a single braille page if possible."
  test('10.4: a question without answer choices is never divided between pages', () => {
    for (let k = 5; k <= 30; k++) {
      const q2 = '2. ' + words(40, 'q');   // four braille lines
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), { type: 'list', kind: 'exercise', items: [{ text: '1. First question.' }, { text: q2 }, { text: '3. Third question.' }] }] });
      const lines = formatBlock({ type: 'list', kind: 'exercise', items: [{ text: q2 }] }, bana()).filter((l) => l !== '');
      assert.equal(lines.length, 4);
      assert.equal(onePageOf(pages, lines).size, 1, `fill ${k}: question 2 divided between pages`);
    }
  });
  // 10.3: "Directions for questions without answer choices should be on the same braille page as at least one of the
  // questions to which it applies." (10.3.1a: the directions and at least one question on the same page.)
  test('10.3: directions share a page with the first question', () => {
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), { type: 'para', directions: true, text: 'Answer each question in a complete sentence of your own.' },
        { type: 'list', kind: 'exercise', items: [{ text: '1. ' + words(12, 'a') }, { text: '2. Second question.' }] }] });
      const dir = where(pages, '    ANSWER EACH QUESTION IN A COMPLETE');
      const q1 = where(pages, '1. A0 A1 A2 A3 A4 A5 A6 A7 A8 A9 A0 A1');
      assert.equal(dir.length, 1); assert.equal(q1.length, 1);
      assert.equal(dir[0].page, q1[0].page, `fill ${k}: the directions are on page ${dir[0].page + 1}, the first question on page ${q1[0].page + 1}`);
    }
  });
  test('10.3: directions stay with the first question when it has answer choices (the stem)', () => {
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), { type: 'para', directions: true, text: 'Choose the best answer.' },
        { type: 'list', kind: 'exercise', items: [{ text: '1. Which one is right?' }, { level: 1, text: 'a. this' }, { level: 1, text: 'b. that' }] }] });
      const dir = where(pages, '    CHOOSE THE BEST ANSWER.'), q1 = where(pages, '1. WHICH ONE IS RIGHT?');
      assert.equal(dir[0].page, q1[0].page, `fill ${k}`);
    }
  });
  // 8.4.1c: "Keep a columned list on a single page when possible." (repeated in the Updates)
  test('8.4.1c: a list set in columns stays on one page', () => {
    const items = ['ant', 'bee', 'cat', 'dog', 'eel', 'fox', 'gnu', 'hen'].map((t) => ({ text: t }));
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), { type: 'list', columns: 2, items }] });
      const rows = where(pages, 'ANT  EEL').concat(where(pages, 'DOG  HEN'));
      assert.equal(rows.length, 2, 'the list is set in two columns');
      assert.equal(rows[0].page, rows[1].page, `fill ${k}: the columned list is divided between pages`);
    }
  });
  test('10.3 / 10.4 keep groups are the same on the plain and the traced path', () => {
    const block = { type: 'list', kind: 'exercise', items: [{ text: '1. One ' + words(20, 'x') }, { text: '2. Two' }, { level: 1, text: 'a. choice' }, { text: '3. Three' }] };
    const o = bana({ translatePos: upPos });
    const plain = formatBlock(block, bana());
    const traced = traceBlock(block, o, false);
    assert.deepEqual(traced.map((t) => t.s), plain);
    assert.deepEqual(traced.keepGroups, plain.keepGroups);
    // K31: the 'q' group now spans the question AND its answer-choice item(s) - "2. Two" through "a. choice" - not
    // just the question's own stem line, so it is kept together as a whole (10.3.1b-c) like every other keep group.
    const qg = plain.keepGroups.find((g) => g.length === 3 && /^q/.test(g[2]));
    assert.ok(qg, 'a question with choices is marked');
    assert.equal(plain[qg[0]], '2. TWO');
    assert.equal(plain[qg[1]], '  A. CHOICE');
  });
  // K31 / BANA 10.3.1b-c: "Place the question and its corresponding answer choices together on the same page" and
  // "Place all answer choices for a given question together on the same page." Previously exerciseKeep only tagged
  // the question's own stem (documented in standards-findings.md/transcription-policy.md as "not built"); the group
  // now spans every answer-choice item that follows and applyPageBoundaries moves it whole, the same as any other
  // keep-together group (a table row, a verse line, …), when it would not fit here but does fit on one page.
  test('10.3.1b: a question and its answer choices move to the next page together', () => {
    const q = { type: 'list', kind: 'exercise', items: [
      { text: '1. Which one is right?' }, { level: 1, text: 'a. this' }, { level: 1, text: 'b. that' }, { level: 1, text: 'c. the other' },
    ] };
    const stemLines = formatBlock(q, bana()).filter((l) => l !== '');
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), q] });
      assert.equal(onePageOf(pages, stemLines).size, 1, `fill ${k}: question and choices divided between pages`);
    }
  });
  test('10.3.1c: several questions with answer choices - each question stays with its own choices', () => {
    const mk = (n) => ({ text: `${n}. Question ${n}?` });
    const ch = (n, l) => ({ level: 1, text: `${l}. choice ${n}` });
    const list = { type: 'list', kind: 'exercise', items: [
      mk(1), ch(1, 'a'), ch(1, 'b'),
      mk(2), ch(2, 'a'), ch(2, 'b'), ch(2, 'c'),
      mk(3), ch(3, 'a'), ch(3, 'b'),
    ] };
    const q2Lines = formatBlock({ type: 'list', kind: 'exercise', items: [mk(2), ch(2, 'a'), ch(2, 'b'), ch(2, 'c')] }, bana()).filter((l) => l !== '');
    for (let k = 5; k <= 30; k++) {
      const pages = pagesOf({ title: 'Book', blocks: [...fill(k), list] });
      assert.equal(onePageOf(pages, q2Lines).size, 1, `fill ${k}: question 2 and its choices divided between pages`);
    }
  });
  // 10.8.6 (as updated): "When a label (such as Example) is followed by more than one sentence, each sentence begins in the
  // appropriate cell for the applicable exercise: ... margins 1-3, the example sentences begin in cell 1." Sample 10-9's
  // print gives the label and two sentences; the gold builder now puts the label on its own line (10.8.5's numbered case,
  // Sample 10-8, uses the same mechanism).
  test('10.8.6: gold Samples 10-9 and 10-8 match (label on its own line, sentences in cell 1)', () => {
    for (const id of ['sample-10-9', 'sample-10-8']) {
      const out = execFileSync(process.execPath, [path.join(EMBOSS, 'scripts', 'gold-run.mjs'), '--section', 'section-10', '--sample', id], { encoding: 'utf8' });
      assert.match(out, /— MATCH ===/, `${id}:\n${out.slice(0, 800)}`);
    }
  });
  test('10.8.6 guard: in a 1-5/3-5 exercise the example sentences (level 1) begin in cell 3, runovers in cell 5', () => {
    const lines = formatBlock({ type: 'list', kind: 'exercise', items: [
      { text: 'A. Use each word in a sentence.' },
      { level: 1, example: true, label: 'Example:', text: 'The cat sat on the mat and looked out of the window for a long time.' },
      { level: 1, example: true, text: 'Then it slept.' },
      { level: 1, text: '1. house' }] }, bana());
    const s1 = lines.findIndex((l) => l.startsWith('  THE CAT'));
    assert.ok(s1 > 0, lines.join('\n'));
    assert.match(lines[s1 + 1], /^ {4}\S/, 'runover in cell 5');
    assert.ok(lines.includes('  THEN IT SLEPT.'));
  });
});

// =====================================================================================================================
describe('K25: definition-list and bilingual-reference separator (June 2024 changes)', () => {
  const gl = (items, extra = {}) => ({ type: 'list', kind: 'glossary', style: 'glossary', items, ...extra });
  const body = (block) => formatBlock(block, bana()).filter((l) => l !== '');
  // 17.6.1b-c (June 2024): "Leave one blank cell between an entry word or phrase and its definition when the entry is
  // followed by punctuation." "Leave two blank cells between entries and definitions if entries are not followed by
  // punctuation." (The 2016 "or if the definition starts with an uppercase letter" is gone.)
  test('17.6.1c: an unpunctuated entry takes two blank cells even before a capitalised definition', () => {
    assert.deepEqual(body(gl([{ term: 'heart', def: 'The organ that pumps blood' }], { definitionList: true })), ['HEART  THE ORGAN THAT PUMPS BLOOD']);
  });
  test('17.6.1b guard: a punctuated entry takes one blank cell', () => {
    assert.deepEqual(body(gl([{ term: 'heart:', def: 'the organ' }], { definitionList: true })), ['HEART: THE ORGAN']);
  });
  test('17.6.1: no enclosure test and no 21.5.1e mixed-style rule - each entry follows its own punctuation', () => {
    assert.deepEqual(body(gl([{ term: 'noun', def: '(n.) a naming word' }, { term: 'verb,', def: 'a doing word' }], { definitionList: true })),
      ['NOUN  (N.) A NAMING WORD', 'VERB, A DOING WORD']);
  });
  // 21.9.2c (June 2024): "Follow print for punctuation after an entry word or subentry word that is followed by a
  // translation. If no punctuation appears in print, leave two blank cells between the entry or subentry word and its
  // translation."
  test('21.9.2c: a bilingual entry with no punctuation takes two blank cells', () => {
    assert.deepEqual(body(gl([{ term: 'la casa', def: 'House' }, { term: 'el perro,', def: 'dog' }], { bilingual: true })), ['LA CASA  HOUSE', 'EL PERRO, DOG']);
  });
  // 21.5.1c (unchanged): "one blank cell ... when the entry word is followed by punctuation, capitalization, or enclosure
  // symbols" - a glossary without the flags keeps the capital-letter test.
  test('21.5.1c guard: a glossary (no flag) keeps the capital-letter test', () => {
    assert.deepEqual(body(gl([{ term: 'alpha waves', def: 'The slow brain waves' }])), ['ALPHA WAVES THE SLOW BRAIN WAVES']);
  });
  test('K25: the flags are in the block cache key and the traced path agrees', () => {
    const b = gl([{ term: 'heart', def: 'The organ' }]);
    const doc = (x) => ({ blocks: [x] });
    const cache = new Map();
    const a1 = formatDocument(doc(b), bana({ blockCache: cache, suppressHeader: true }));
    const a2 = formatDocument(doc({ ...b, definitionList: true }), bana({ blockCache: cache, suppressHeader: true }));
    assert.notEqual(a1, a2);
    const t = traceBlock({ ...b, bilingual: true }, bana({ translatePos: upPos }), false).map((x) => x.s);
    assert.deepEqual(t, formatBlock({ ...b, bilingual: true }, bana()));
  });
});
