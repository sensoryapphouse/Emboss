// The "words to check" badge (round-trip proofreading, web/proofread.mjs) on Collections, Grade 7 (tests/nimas_samples/
// 9780544087507NIMAS.xml) showed 16 words, none of them wrong braille (Paul, 31 Oct 2026: "fix both"):
//   1. The check brailled each bold or italic run on its own, so a word split between runs was brailled as two words: a bold
//      drop-cap ("**I**n the days", "**O**n the depot platform") read back as "Ition", an italic that ends inside a word ("My *unio*n.")
//      as "uniotion", and a lone italic "were" / "was" became a lower wordsign that read back as something else. The braille itself
//      (format/document.mjs segmentsToBraille) translates a line's runs together with one typeform array; the check now does too.
//   2. A word next to a note reference was skipped only with at most one punctuation mark between them, so "Eden,”²" (comma and
//      closing quote) and "palings,”⁷" were flagged; a word next to a margin line number ("right,”580") was not skipped at all.
// Written first: against the pre-change proofread.mjs every test below except the last fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { makeTranslators, UEB_TABLES } from '../web/braille-table.mjs';
import { proofread } from '../web/proofread.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const tr = makeTranslators(louis, UEB_TABLES.g2);
const g1 = makeTranslators(louis, UEB_TABLES.g1);
const BOLD = 4, ITALIC = 1;

const words = (segments) => proofread({ blocks: [{ type: 'para', segments }] }, tr.translate, tr.backTranslate, (s, tf) => g1.translate(s, tf)).issues.map((i) => i.word);
const text = (t, tf) => (tf ? { type: 'text', text: t, tf } : { type: 'text', text: t });

test('a bold first letter (drop cap) is brailled with the rest of its word', () => {
  assert.deepEqual(words([text('I', BOLD), text('n the days following the fire, city officials sifted through the rubble.')]), []);
  assert.deepEqual(words([text('O', BOLD), text('n the depot platform everybody stood waiting, listening.')]), []);
});

test('an italic run that ends inside a word is brailled with the rest of the word', () => {
  assert.deepEqual(words([text('Bella', ITALIC), text(', she thought. My other friends. '), text('My sisters. My comrades. My unio', ITALIC), text('n.')]), []);
});

test('a lone italic lower-wordsign word (were, was) is brailled in its line, as the braille does', () => {
  assert.deepEqual(words([text('Note especially that the pronoun '), text('you', ITALIC), text(' takes the forms '), text('are', ITALIC), text(' and '), text('were', ITALIC), text(', regardless of whether it is singular or plural.')]), []);
  assert.deepEqual(words([text('It is singular and must take the singular verb '), text('was', ITALIC), text('.')]), []);
});

test('a word with two punctuation marks before a note reference is not flagged', () => {
  assert.deepEqual(words([text('So was a “Garden of Eden,”'), { type: 'noteref', text: '2' }, text(' as the scientists called it.')]), []);
  assert.deepEqual(words([text('Several struck the sharp-tipped palings,”'), { type: 'noteref', text: '7' }, text(' the New York paper reported.')]), []);
});

test('a word next to a margin line number is not flagged', () => {
  assert.deepEqual(words([text('“I’ve got to make sure Harriet and Millicent are all right,”'), { type: 'linenum', text: '580' }, text(' Jane panted behind her.')]), []);
});

test('the check still flags a word whose braille does not read back (liblouis reads \\RVS back as "ourvs")', () => {
  assert.deepEqual(words([text('We hope you are reading it (otherwise we are talking to ourselves).')]), ['ourselves']);
});
