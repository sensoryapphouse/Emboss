// K1 and K4 (EMBOSS-TASKS.md section K; transcriber KD, round 1, Q-25 and Q-26), braille-level.
//
// K1 — BANA Braille Formats 5.3.1, restated in the June 2024 changes: "Print font attributes may be ignored when
// they are used for decorative purposes ... In general, font attributes in tables of contents, headings (centered,
// cell-5, cell-7), dedications, titles, lists, etc., do not reinforce learning ... When these items are partially
// emphasized, however, font attributes must be retained." Also 8.1.4a ("Omit emphasis when the entire list uses the
// same print font attribute"), 8.1.4b, 2.10.8b-c, 2.9.1f, 4.3.7 (Example 4-7). KD: "If every bit
// of content within a list (or table or dedication or etc.) has an emphasis (e.g., bold), then it is 99% of the time
// safe to ignore that bold entirely"; otherwise follow print. UKAAF B004 §5 keeps all heading emphasis out.
//
// K4 — BANA 5.6.1-5.6.2 / UEB 9.9.1: "each text element is preceded by the typeform passage indicator and the
// typeform is terminated only at the point where the typeform changes"; the March 2024 Updates: no need to terminate
// for the print page number (1.11.3e), the running head (1.8.2f) or the braille page number (1.15.1h); terminate
// before a transcriber's note (3.1.4) and before reference notes at a print page change (16.5.1j).
//
// Expected braille comes from the rules and BANA's own worked examples, never from Emboss's earlier output.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBlock, traceBlock, formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const translate = (t, tf) => louis.translate(t, T, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
const opts = (mode = 'bana', extra = {}) => ({ mode, standard: mode, width: 40, depth: 25, translate, suppressHeader: true, ...extra });
const s = (text, tf) => (tf ? { type: 'text', text, tf } : { type: 'text', text });
const rtrim = (l) => l.replace(/\s+$/, '');
// formatBlock and traceBlock must agree (A39) — every block below is checked both ways.
function block(b, mode = 'bana') {
  const lines = formatBlock(b, opts(mode)).map(rtrim);
  assert.deepEqual(traceBlock(b, opts(mode, { translatePos })).map((t) => rtrim(t.s)), lines, 'traceBlock must match formatBlock');
  return lines.filter((l) => l !== '');
}
// The document's lines (all pages), blank lines and page-change lines dropped.
const docLines = (doc, mode = 'bana', extra = {}) => formatDocument(doc, opts(mode, extra)).split(/\f|\r\n/).map(rtrim).filter((l) => l !== '' && !/^-{10,}/.test(l));

// ------------------------------------------------------------------------------------------------ K1: headings
// TF-1 (Paul, 28 Sep 2026): old 5.3.5 ("ignore font attributes for titles of books, poems, plays ... that appear as
// a complete heading") is withdrawn (one of the old 5.3.3-5.3.11 not reprinted by the June 2024 changes) and no
// longer cited as a separate reason. Example 5-4's wholly-italic poem-title heading still drops the italic below,
// but only because it is wholly, uniformly emphasised — 5.3.1's own general "titles ... do not reinforce learning"
// test, unaffected by TF-1.
test('K1 heading: partial emphasis is kept (BANA 5.3.1, 4.3.7, Example 4-7), a wholly emphasised heading drops it (5.3.1, Example 5-4)', () => {
  // Example 4-7, centred heading "Henrik Ibsen, A Doll's House" with only the play title in italics.
  assert.deepEqual(block({ type: 'heading', level: 1, segments: [s('Henrik Ibsen, '), s("A Doll's House", 1)] }).map((l) => l.trim()), [",H5RIK ,IBS51 .7,A ,DOLL'S ,H\\SE.'"]);
  // Example 5-4, the italic poem title "Eyes and Tears" standing as a complete heading.
  assert.deepEqual(block({ type: 'heading', level: 1, segments: [s('Eyes and Tears', 1)] }).map((l) => l.trim()), [',EYES & ,TE>S']);
  // A wholly italic heading followed by plain punctuation is still wholly emphasised (UEB 9.7.2).
  assert.deepEqual(block({ type: 'heading', level: 2, segments: [s('Summary', 1), s(':')] }).map((l) => l.trim()), [',SUMM>Y3']);
});

test('K1 heading: judged per typeform — a bold heading with one italic word loses the bold and keeps the italic', () => {
  const lines = block({ type: 'heading', level: 2, segments: [s('Chapter 1: ', 4), s('Storm', 5)] });
  assert.deepEqual(lines.map((l) => l.trim()), [',*APT] #A3 .1,/ORM']);
});

test('K1 heading: UKAAF keeps B004 §5 (no emphasis in headings, partial or not); the same heading keeps it in BANA', () => {
  const h = { type: 'heading', level: 2, segments: [s('Henrik Ibsen, '), s("A Doll's House", 1)] };
  assert.deepEqual(block(h, 'ukaaf').map((l) => l.trim()), [",H5RIK ,IBS51 ,A ,DOLL'S ,H\\SE"]);
  assert.deepEqual(block(h, 'bana').map((l) => l.trim()), [",H5RIK ,IBS51 .7,A ,DOLL'S ,H\\SE.'"]);
});

// ------------------------------------------------------------------------------------------------ K1: lists
test('K1 list: one bold item keeps its bold (8.1.4b, KD) while an all-bold list drops it (8.1.4a)', () => {
  const oneBold = block({ type: 'list', items: [{ segments: [s('apples', 4)] }, { text: 'pears' }, { text: 'plums' }] });
  assert.deepEqual(oneBold, ['^1APPLES', 'PE>S', 'PLUMS']);
  const allBold = block({ type: 'list', items: [{ segments: [s('apples', 4)] }, { segments: [s('pears', 4)] }, { segments: [s('plums', 4)] }] });
  assert.deepEqual(allBold, ['APPLES', 'PE>S', 'PLUMS']);
});

test('K1 list: one bold word inside one item is kept; nested items and further paragraphs belong to the same list', () => {
  const partWord = block({ type: 'list', items: [{ segments: [s('green '), s('apples', 4)] }, { text: 'pears' }] });
  assert.deepEqual(partWord, ['GRE5 ^1APPLES', 'PE>S']);
  // A nested (level 1) item in plain type keeps the top-level bold items as print shows them ...
  const nested = block({ type: 'list', items: [{ segments: [s('fruit', 4)] }, { level: 1, text: 'pears' }, { segments: [s('nuts', 4)] }] });
  assert.ok(nested.includes('^1FRUIT') && nested.includes('^1NUTS'), JSON.stringify(nested));
  // ... and with every item bold, nested ones included, the bold goes throughout.
  const nestedAll = block({ type: 'list', items: [{ segments: [s('fruit', 4)] }, { level: 1, segments: [s('pears', 4)] }, { segments: [s('nuts', 4)] }] });
  assert.ok(!nestedAll.some((l) => l.includes('^')), JSON.stringify(nestedAll));
});

test('K1 list: mixed typeforms — all bold with one italic word drops the bold, keeps the italic', () => {
  const lines = block({ type: 'list', items: [{ segments: [s('ripe ', 4), s('apples', 5)] }, { segments: [s('pears', 4)] }] });
  assert.deepEqual(lines, ['RIPE .1APPLES', 'PE>S']);
});

test('K1 list: the transcriber overrides still win (keepEmphasis for titles, 8.1.4b / Example 8-6; ignoreFont)', () => {
  const titles = { type: 'list', items: [{ segments: [s('Bowdrie', 1)] }, { segments: [s('Flint', 1)] }] };
  assert.deepEqual(block(titles), [',B[DRIE', ',FL9T']);
  assert.deepEqual(block({ ...titles, keepEmphasis: true }), ['.1,B[DRIE', '.1,FL9T']);   // Example 8-6: ".1,b[drie", ".1,fl9t"
  assert.deepEqual(block({ type: 'list', ignoreFont: true, items: [{ segments: [s('apples', 4)] }, { text: 'pears' }] }), ['APPLES', 'PE>S']);
});

// ------------------------------------------------------------------------------------------------ K1: contents
test('K1 contents: entries whose title is italic after a plain author keep the italics (2.10.8b, Example 2-18); an all-bold contents drops the bold', () => {
  const kept = block({ type: 'list', kind: 'toc', items: [
    { segments: [s('WILLIAM SHAKESPEARE, '), s('Let Me Not to the Marriage of True Minds', 1)], page: '7-6' },
    { segments: [s('ANNE BRADSTREET, '), s('To My Dear and Loving Husband', 1)], page: '7-7' },
  ] }).join('\n');
  assert.ok(kept.includes(",,WILLIAM ,,%AKESPE>E1 .7,LET") && kept.includes("M9DS.'"), kept);
  assert.ok(kept.includes(',,ANNE ,,BRAD/REET1 .7,TO ,MY') && kept.includes(",HUSB&.'"), kept);
  const allBold = block({ type: 'list', kind: 'toc', items: [{ segments: [s('Chapter One', 4)], page: '1' }, { segments: [s('Chapter Two', 4)], page: '9' }] });
  assert.ok(allBold.every((l) => !l.includes('^')) && allBold[0].startsWith(',*APT] ,"O'), JSON.stringify(allBold));
});

test('K1 contents: contents lists separated only by print page changes are one structure', () => {
  const bold = (t, p) => ({ segments: [s(t, 4)], page: p });
  // Together: one plain entry anywhere keeps the bold in both lists.
  const together = docLines({ blocks: [
    { type: 'list', kind: 'toc', items: [bold('Unit One', '1'), bold('Unit Two', '9')] },
    { type: 'pagenum', page: 'iv' },
    { type: 'list', kind: 'toc', items: [{ text: 'Glossary', page: '99' }] },
  ] });
  assert.ok(together.some((l) => l.startsWith('^7,UNIT ,"O')) || together.some((l) => l.startsWith('^1,UNIT')), JSON.stringify(together));
  // Separated by other material: each list is judged on its own, so the all-bold one drops its bold.
  const apart = docLines({ blocks: [
    { type: 'list', kind: 'toc', items: [bold('Unit One', '1'), bold('Unit Two', '9')] },
    { type: 'para', text: 'Other matter.' },
    { type: 'list', kind: 'toc', items: [{ text: 'Glossary', page: '99' }] },
  ] });
  assert.ok(apart.some((l) => l.startsWith(',UNIT ,"O')) && !apart.some((l) => l.includes('^')), JSON.stringify(apart));
});

// ------------------------------------------------------------------------------------------------ K1: tables
test('K1 table: every cell bold drops the bold; bold column headings over plain entries keep it', () => {
  const all = block({ type: 'table', headers: ['**Fruit**', '**Colour**'], rows: [['**apple**', '**red**'], ['**pear**', '**green**']] });
  assert.ok(!all.some((l) => l.includes('^')), JSON.stringify(all));
  assert.ok(all.some((l) => /^,FRUIT +,COL\\R$/.test(l)), JSON.stringify(all));
  const heads = block({ type: 'table', headers: ['**Fruit**', '**Colour**'], rows: [['apple', 'red'], ['pear', 'green']] });
  assert.ok(heads.some((l) => /^\^1,FRUIT +\^1,COL\\R$/.test(l)), JSON.stringify(heads));
});

// ------------------------------------------------------------------------------------------------ K1: dedications
test('K1 dedication: a wholly italic dedication drops the italics (2.9.1f); one italic word is kept; consecutive dedication paragraphs are one structure', () => {
  const whole = block({ type: 'para', dedication: true, segments: [s('For my mother, who taught me to read.', 1)] });
  assert.deepEqual(whole, ['  ,= MY "M1 :O TAU<T ME TO R1D4']);
  const word = block({ type: 'para', dedication: true, segments: [s('For my mother, who read me '), s('Heidi', 1), s('.')] });
  assert.ok(word.join(' ').includes('.1,HEIDI'), JSON.stringify(word));
  const two = docLines({ blocks: [
    { type: 'para', dedication: true, segments: [s('For my mother,', 1)] },
    { type: 'para', dedication: true, segments: [s('and for my father.')] },
  ] });
  assert.ok(two.some((l) => l.includes('.1,=') || l.includes('.7,=')), JSON.stringify(two));
});

// ------------------------------------------------------------------------------------------------ K4
const ital = (t) => ({ type: 'para', segments: [s(t, 1)] });

test('K4: a passage over several paragraphs opens every paragraph and is terminated once, after the last (UEB 9.9.1, BANA 5.6.2)', () => {
  const lines = docLines({ blocks: [ital('The first paragraph is italic.'), ital('Yes.'), ital('The last one ends the passage.')] });
  assert.deepEqual(lines, ['  .7,! F/ P>AGRAPH IS ITALIC4', '  .7,YES4', ".7,! LA/ \"O 5DS ! PASSAGE4.'".replace(/^/, '  ')]);
});

test('K4: a print page change does not interrupt the passage (Updates 1.11.3e); a paragraph continued over it does not reopen', () => {
  const lines = docLines({ blocks: [ital('Before the page change.'), { type: 'pagenum', page: '5' }, ital('After the page change.')] });
  assert.deepEqual(lines, ['  .7,2F ! PAGE *ANGE4', ".7,AF ! PAGE *ANGE4.'".replace(/^/, '  ')]);
  const split = docLines({ blocks: [{ ...ital('A paragraph that runs'), continued: true }, { type: 'pagenum', page: '5' }, { ...ital('over the page change.'), continuation: true }] });
  assert.deepEqual(split, ['  .7,A P>AGRAPH T RUNS', "OV] ! PAGE *ANGE4.'"]);
});

test('K4: an interrupted run is terminated before the interruption (heading, transcriber\'s note 3.1.4, plain paragraph, list)', () => {
  const lines = docLines({ blocks: [
    ital('One italic paragraphs.'), ital('Two italic paragraphs.'),
    { type: 'heading', level: 2, text: 'Next' },
    ital('Three italic paragraphs.'), ital('Four italic paragraphs.'),
    { type: 'note', text: 'A note.' },
    ital('Five alone here now.'),
    { type: 'para', segments: [s('Six is '), s('partly', 1), s(' italic.')] },
    ital('Seven alone here now.'),
  ] });
  const find = (t) => lines.find((l) => l.includes(t));
  assert.equal(find(',"O ITALIC'), '  .7,"O ITALIC P>AGRAPHS4');
  assert.equal(find(',TWO ITALIC'), "  .7,TWO ITALIC P>AGRAPHS4.'");
  assert.equal(find(',?REE ITALIC'), '  .7,?REE ITALIC P>AGRAPHS4');
  assert.equal(find(',F\\R ITALIC'), "  .7,F\\R ITALIC P>AGRAPHS4.'");
  assert.equal(find(',FIVE'), "  .7,FIVE AL\"O \"H N[4.'");
  assert.equal(find(',SEV5'), "  .7,SEV5 AL\"O \"H N[4.'");
});

test('K4: runs are per typeform and paragraphs only (list items are separate text elements, Updates 8.1.4)', () => {
  const lines = docLines({ blocks: [
    { type: 'para', segments: [s('Bold and italic here.', 5)] },
    ital('Only italic here now.'),
  ] });
  // italics run over both paragraphs; bold is on the first only and is closed there
  assert.deepEqual(lines, ['  .7^7,BOLD & ITALIC "H4^\'', ".7,ONLY ITALIC \"H N[4.'".replace(/^/, '  ')]);
  const list = block({ type: 'list', items: [{ segments: [s('first item here', 1)] }, { segments: [s('second item here', 1), s(' and more')] }] });
  assert.deepEqual(list, [".7F/ ITEM \"H.'", ".7SECOND ITEM \"H.' & M"]);
});

test('K4 applies in UKAAF mode too (UEB 9.9.1; B004 says nothing different)', () => {
  const lines = docLines({ blocks: [ital('The first paragraph is italic.'), ital('The last one ends the passage.')] }, 'ukaaf');
  assert.ok(lines.includes('  .7,! F/ P>AGRAPH IS ITALIC4') && lines.includes(".7,! LA/ \"O 5DS ! PASSAGE4.'".replace(/^/, '  ')), JSON.stringify(lines));
});

test('K4 caching: a paragraph\'s braille depends on its neighbours, and the block cache knows it', () => {
  const cache = new Map();
  const a = { blocks: [ital('The first paragraph is italic.'), ital('The last one ends the passage.')] };
  const b = { blocks: [ital('The first paragraph is italic.'), { type: 'para', text: 'Plain paragraph.' }] };
  const run = (doc) => formatDocument(doc, opts('bana', { blockCache: cache }));
  const aOut = run(a), bOut = run(b), aAgain = run(a);
  assert.equal(bOut, formatDocument(b, opts('bana')));
  assert.equal(aAgain, aOut);
  assert.ok(bOut.includes(".7,! F/ P>AGRAPH IS ITALIC4.'"), bOut);
  assert.ok(aOut.includes('.7,! F/ P>AGRAPH IS ITALIC4\r\n'), aOut);   // in the run it is not terminated
  // and the editor's path (translatePos: traceBlock lays the blocks out) gives the same braille
  assert.equal(formatDocument(a, opts('bana', { translatePos })), aOut);
});

test('K4: reference notes placed at a print page change end the passage (Updates 16.5.1j), which reopens after them', () => {
  const lines = docLines({ blocks: [
    { type: 'para', segments: [s('See the note.'), { type: 'noteref', idref: 'n1', text: '1' }] },
    ital('Italic before the notes.'),
    { type: 'pagenum', page: '5' },
    ital('Italic after the notes.'),
    ital('And more italic.'),
    { type: 'footnote', id: 'n1', text: '1 The note.' },
  ] });
  const at = (t) => lines.findIndex((l) => l.includes(t));
  assert.ok(at('NOTES') >= 0 && at(',! NOTE4') > at(',ITALIC 2F'), JSON.stringify(lines));   // the note sits between the two paragraphs
  assert.equal(lines[at(',ITALIC 2F')], "  .7,ITALIC 2F ! NOTES4.'");
  assert.equal(lines[at(',ITALIC AF')], '  .7,ITALIC AF ! NOTES4');   // reopened after the notes, and the run goes on
  assert.equal(lines[at(',& M')], "  .7,& M ITALIC4.'");
});

// ------------------------------------------------------------------------------------------------ TF-1 (was K1 / 5.3.9)
// TF-1 (Paul, 28 Sep 2026, from KD's round-2 answer): old BANA 5.3.9 ("Ignore font attributes for numbers/letters
// beginning exercise material ... This includes any associated punctuation and/or labels used in conjunction with
// identifiers", March 2024 Updates) is one of the old 5.3.3-5.3.11 the June 2024 Changes to Foreign Language
// Sections do not reprint, so it is withdrawn: a bold identifier and its label at the start of an item now KEEP the
// bold, like any other print emphasis (5.4.1 "follow print"). Old expectation (identifier bold dropped) is gone;
// see Emboss/docs/expectation-changes.md.
test('TF-1 / old BANA 5.3.9 withdrawn: a bold identifier and its label at the start of an item keep the bold ("Step 1. Draw a box.")', () => {
  const steps = block({ type: 'list', items: [
    { segments: [s('Step 1.', 4), s(' Draw a box.')] },
    { segments: [s('Step 2.', 4), s(' Place a triangle near the box.')] },
  ] });
  assert.deepEqual(steps, ['^1,/EP ^1#A4 ,DRAW A BOX4', '^1,/EP ^1#B4 ,PLACE A TRIANGLE NE> !', '  BOX4']);
  const numbers = block({ type: 'list', kind: 'exercise', items: [{ segments: [s('1.', 4), s(' Name a '), s('noun', 1), s('.')] }, { segments: [s('(b)', 4), s(' Name a verb.')] }] }).join(' ');
  assert.ok(numbers.includes('^1#A4') && numbers.includes('^1"<;B">') && numbers.includes('.1N\\N'), numbers);   // the identifier's bold AND the other emphasis in the item both stay
  // A bold word that is the item's own text (not an identifier): kept, as print shows (unaffected either way).
  assert.deepEqual(block({ type: 'list', items: [{ segments: [s('Warning', 4), s(': hot.')] }, { text: 'Cool.' }] }), ["^1,W>N+^'3 HOT4", ',COOL4']);
  // UKAAF: B004 has no such rule — print is followed (unaffected: this was already true before TF-1).
  assert.ok(block({ type: 'list', items: [{ segments: [s('Step 1.', 4), s(' Draw a box.')] }, { text: 'Done.' }] }, 'ukaaf').join(' ').includes('^'));
});
