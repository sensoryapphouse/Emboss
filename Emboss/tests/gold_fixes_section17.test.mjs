// Formatter fixes found by running the BANA Formats section 17 gold set (23 Sep 2026):
//  1. a grade-1 indicator is written only where the letters could be misread (UEB 5.1-5.2), so a
//     spelling word or an uncontracted word list shows none (Samples 17-1..17-3, Examples 17-3, 17-7, 17-8);
//  2. directions take 5-5 margins and join a following list / a preceding cell-5 heading with no
//     blank line (BANA 10.3.2, 10.2.3, 4.5.3; F-174 / F-235; Samples 17-2, 17-4, 17-11 ...);
//  3. a definition list puts one blank cell after a punctuated entry word or before a capitalised
//     definition, and two blank cells otherwise, never an invented colon (17.6.1b-c, 21.5.1c-d; F-183/F-194).
// The gold results are pinned through gold-run; the rules themselves through small direct documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.GOLD_RUN_SECTION = 'section-17';
const { loadSamples, runOne } = await import('../scripts/gold-run.mjs');
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);

function lines(blocks, opts = {}) {
  const brf = formatDocument({ title: null, blocks }, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, suppressHeader: true, ...opts }) || '';
  return brf.split('\x0c')[0].split('\r\n').map((l) => l.replace(/\s+$/, ''));
}
const seg = (text, uncontracted) => ({ type: 'text', text, ...(uncontracted ? { uncontracted: true } : {}) });

test('gold section 17: these examples match', () => {
  const want = ['BANA Example 17-3', 'BANA Example 17-7', 'BANA Example 17-8',
    'BANA Sample 17-1', 'BANA Sample 17-2', 'BANA Sample 17-3', 'BANA Sample 17-4', 'BANA Sample 17-8'];
  const byId = new Map(loadSamples().map((s) => [s.sample.id, s.sample]));
  for (const id of want) assert.equal(runOne(byId.get(id)).status, 'match', id);
});

test('grade-1 indicator: none for unambiguous letters, kept for a lone letter, a shortform, digits', () => {
  const one = (t) => lines([{ type: 'para', continuation: true, segments: [seg(t, true)] }]).filter(Boolean)[0];
  assert.equal(one('their'), 'THEIR');
  assert.equal(one('en er gy'), 'EN ER GY');
  assert.equal(one('ge-r'), 'GE-R');
  assert.match(one('b'), /^;;/);            // b = but
  assert.match(one('ab'), /^;;/);           // ab = about
  assert.match(one('a1'), /;;/);            // digits
  assert.match(one('ab cd ef'), /^;;;/);    // passage form kept when any word is ambiguous
});

test('directions paragraph: 5-5 margins, no blank line before a list or after a cell-5 heading', () => {
  const l = lines([
    { type: 'heading', level: 2, text: 'Using Patterns' },
    { type: 'para', directions: true, text: 'Write these words in alphabetical order please and keep going until the line wraps.' },
    { type: 'list', kind: 'list', items: [{ segments: [seg('past', true)] }, { segments: [seg('flood', true)] }] },
  ]);
  const at = l.findIndex((x) => x.startsWith('    ,WRITE'));
  assert.ok(at > 0 && l[at - 1].trim().length > 0, 'no blank between the cell-5 heading and the directions');
  assert.ok(l[at + 1].startsWith('    '), 'runover also in cell 5');
  const listAt = l.indexOf('PAST');
  assert.ok(listAt > at && l[listAt - 1] !== '', 'no blank line between the directions and the list');
});

test('directions paragraph in UKAAF mode keeps the ordinary paragraph margins', () => {
  const l = lines([{ type: 'para', directions: true, text: 'Write these words.' }], { mode: 'ukaaf', standard: 'ukaaf' });
  assert.ok(l.some((x) => x.startsWith('  ,WRITE') && !x.startsWith('    ')));
});

test('definition list spacing: two blanks, or one after punctuation / before a capital, no colon', () => {
  const g = (term, def) => lines([{ type: 'list', kind: 'glossary', style: 'glossary', items: [{ term, def }] }]).filter(Boolean)[0];
  assert.equal(g('doctor', 'a physician'), 'DOCTOR  A PHYSICIAN');
  assert.equal(g('advice, advise:', 'a noun'), 'ADVICE1 ADVISE3 A N\\N');
  assert.match(g('alpha waves', 'The slow waves'), /^ALPHA WAVES ,!/);
  assert.ok(!g('cat', 'small animal').includes('3'));
});

test('definition list: the two blank cells survive a wrap and are dropped at a line break', () => {
  const l = lines([{ type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'heart', def: 'organ that pumps blood throughout the body and more words here' }] }]).filter(Boolean);
  assert.ok(l[0].startsWith('HE>T  ORGAN'));
  for (const x of l) assert.ok(!x.includes('\u0001') && x.length <= 40);
});
