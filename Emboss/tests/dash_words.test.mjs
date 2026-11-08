// Paul, 4 Nov 2026: in the editor, "She waited—and waited—until the morning came." (em dash, no spaces, as books print it) lit up
// "waited—until" as ONE word in print and braille, and the explanation bar described it as one word of 12 cells. A dash is a word boundary.
// The braille must not change: UEB writes the dash unspaced (,-), so the dash is NOT turned into a hyphen or given spaces.
// This tests the pure part (format/text-style.mjs clipWordAtDashes, which the editor's wordRangeAt uses), what the proofreading
// "words to check" does with words beside a dash, and that the braille is the same. The editor itself: tests/test-dash-words.mjs.
// Written first: against the pre-change text-style.mjs the clip tests fail (no such export).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { makeTranslators, UEB_TABLES } from '../web/braille-table.mjs';
import { proofread } from '../web/proofread.mjs';
import * as textStyle from '../format/text-style.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const tr = makeTranslators(louis, UEB_TABLES.g2);
const g1 = makeTranslators(louis, UEB_TABLES.g1);

// the whitespace-delimited token round pos, as the editor's wordRangeAt finds it before the dash rule
const token = (text, pos) => { let s = pos, e = pos + 1; while (s > 0 && !/\s/.test(text[s - 1])) s--; while (e < text.length && !/\s/.test(text[e])) e++; return [s, e]; };
const wordAt = (text, pos) => { const [s, e] = token(text, pos); const r = textStyle.clipWordAtDashes(text, pos, s, e); return text.slice(r[0], r[1]); };

for (const [name, d] of [['em dash U+2014', '—'], ['en dash U+2013', '–'], ['two-em dash U+2E3A', '⸺'], ['three-em dash U+2E3B', '⸻'], ['horizontal bar U+2015', '―']]) {
  test(`${name}: the words either side and the dash are separate words`, () => {
    const t = `She waited${d}and waited${d}until the morning came.`;
    assert.equal(wordAt(t, t.indexOf('waited')), 'waited');
    assert.equal(wordAt(t, t.indexOf('and') + 1), 'and');
    assert.equal(wordAt(t, t.lastIndexOf('waited') + 2), 'waited');
    assert.equal(wordAt(t, t.indexOf('until') + 3), 'until');
    assert.equal(wordAt(t, t.indexOf(d)), d);
    assert.equal(wordAt(t, t.lastIndexOf(d)), d);
  });
}

test('a run of dashes is one dash; a dash with spaces round it, a hyphen and an ordinary word are unchanged', () => {
  assert.equal(wordAt('so——then', 3), '——');
  assert.equal(wordAt('it — and the other', 3), '—');
  assert.equal(wordAt('a well-known word', 5), 'well-known');
  assert.equal(wordAt('plain words', 1), 'plain');
  assert.deepEqual(textStyle.clipWordAtDashes('', 0, 0, 0), [0, 0]);
});

test('a dash at the start or end of a token leaves the word beside it whole', () => {
  assert.equal(wordAt('and— then', 1), 'and');
  assert.equal(wordAt('and —then', 6), 'then');
});

test('the braille of an unspaced dash is unchanged: the dash is brailled as the dash, unspaced', () => {
  const b = tr.translate('She waited—and waited—until the morning came.');
  assert.match(b, /,-/, 'the dash is written ,- (UEB)');
  assert.ok(!/ ,- | ,-$/.test(b), 'with no spaces added round it');
  assert.equal(tr.translate('—'), ',-', 'a dash on its own is ,-');
});

test('words beside an unspaced dash are not flagged as "words to check"', () => {
  const issues = (t) => proofread({ blocks: [{ type: 'para', text: t }] }, tr.translate, tr.backTranslate, (s, tf) => g1.translate(s, tf)).issues.map((i) => i.word);
  for (const d of ['—', '–']) {
    assert.deepEqual(issues(`She waited${d}and waited${d}until the morning came.`), []);
    assert.deepEqual(issues(`It was Monday${d}or perhaps Tuesday${d}when the post came.`), []);
  }
});
