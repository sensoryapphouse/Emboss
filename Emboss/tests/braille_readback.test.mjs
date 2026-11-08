// Braille proofreading aloud (Paul, 4 Nov 2026): the pure part, web/braille-readback.mjs - turning one braille word, back-translated
// to text, into the words a speech engine should say. New file, so there is no earlier expectation to change. Written before the
// module existed (it failed: the module was missing); real liblouis tables for the UEB grade 2 cases, no stubs.
//
// Paul's decisions: "cap" before EVERY capital letter, so a word in capitals is spelled letter by letter ("NASA" -> "cap N cap A
// cap S cap A", "London" -> "cap London", "McDonald" -> "Mc cap Donald"); punctuation is named ("comma", "full stop", "open quote",
// "close quote"); full stop in UKAAF, period in BANA. Braille that does not back-translate is spoken as its dots.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.join(HERE, '..');
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const { makeTranslators, UEB_TABLES } = await import('../web/braille-table.mjs');
const { speakText, dotsPhrase, readbackWord, DEFAULT_WORDS } = await import('../web/braille-readback.mjs');

const UK = { standard: 'ukaaf' };
const US = { standard: 'bana' };

test('capitals: cap before every capital letter', () => {
  assert.equal(speakText('London', UK), 'cap London');
  assert.equal(speakText('NASA', UK), 'cap N cap A cap S cap A');
  // Paul's example said "Mc cap Donald"; his rule is a cap before EVERY capital, and the M is one, so it is "cap Mc cap Donald" (question A in the report).
  assert.equal(speakText('McDonald', UK), 'cap Mc cap Donald');
  assert.equal(speakText('iPhone', UK), 'i cap Phone');
  assert.equal(speakText('I', UK), 'cap I');
  assert.equal(speakText('A', UK), 'cap A');
  assert.equal(speakText('london', UK), 'london');
  assert.equal(speakText('Élan', UK), 'cap Élan');
});

test('punctuation is named, and keeps its place', () => {
  assert.equal(speakText('said,', UK), 'said comma');
  assert.equal(speakText('ready;', UK), 'ready semicolon');
  assert.equal(speakText('why?', UK), 'why question mark');
  assert.equal(speakText('Stop:', UK), 'cap Stop colon');
  assert.equal(speakText('Dr.', UK), 'cap Dr full stop');
  assert.equal(speakText('Dr.', US), 'cap Dr period');
  assert.equal(speakText('dollars!', UK), 'dollars exclamation mark');
  assert.equal(speakText('dollars!', US), 'dollars exclamation point');
  assert.equal(speakText('(quite)', UK), 'open bracket quite close bracket');
  assert.equal(speakText('(quite)', US), 'open parenthesis quite close parenthesis');
  assert.equal(speakText('[x]', UK), 'open square bracket x close square bracket');
  assert.equal(speakText('[x]', US), 'open bracket x close bracket');
  assert.equal(speakText('{x}', US), 'open brace x close brace');
  assert.equal(speakText('a-b', UK), 'a hyphen b');
  assert.equal(speakText('a\u2014b', UK), 'a dash b');
  assert.equal(speakText('ok\u2026', UK), 'ok ellipsis');
  assert.equal(speakText('ok...', UK), 'ok ellipsis');
  assert.equal(speakText('a/b', UK), 'a slash b');
  assert.equal(speakText('100%', UK), '100 percent');
  assert.equal(speakText('@home', UK), 'at home');
});

test('quotes: open and close by position, straight or curly', () => {
  assert.equal(speakText('"NASA', UK), 'open quote cap N cap A cap S cap A');
  assert.equal(speakText('dollars!"', UK), 'dollars exclamation mark close quote');
  assert.equal(speakText('\u201cHello\u201d', UK), 'open quote cap Hello close quote');
  assert.equal(speakText("'Yes'", UK), 'open single quote cap Yes close single quote');
  assert.equal(speakText('\u2018Yes\u2019', UK), 'open single quote cap Yes close single quote');
  assert.equal(speakText('("Hi")', UK), 'open bracket open quote cap Hi close quote close bracket');
});

test('apostrophes inside a word are named; numbers keep their decimal point and commas', () => {
  assert.equal(speakText("isn't", UK), 'isn apostrophe t');
  assert.equal(speakText("It's", UK), 'cap It apostrophe s');
  assert.equal(speakText("dogs'", UK), 'dogs apostrophe');
  assert.equal(speakText('3.5', UK), '3.5');
  assert.equal(speakText('1,000.', UK), '1,000 full stop');
  assert.equal(speakText('1984', UK), '1984');
});

test('cells with no text: liblouis dot escapes and empty results are spoken as dots', () => {
  assert.equal(speakText('\\4/', UK), 'dots 4');
  assert.equal(speakText('\\145/', UK), 'dots 1 4 5');
  assert.equal(speakText('this\\5/', UK), 'this dots 5');
  assert.equal(speakText('\\12345678/', UK), 'dots 1 2 3 4 5 6 7 8');
  assert.equal(dotsPhrase(',', UK), 'dots 6');
  assert.equal(dotsPhrase('AB', UK), 'dots 1, dots 1 2');
  assert.equal(dotsPhrase('A B', UK), 'dots 1, blank, dots 1 2');
  assert.equal(dotsPhrase('#', UK), 'dots 3 4 5 6');
  // a word whose back-translation is empty (a lone capital or number sign) is spoken as its dots, so a stray indicator is heard
  assert.equal(readbackWord(',', '', UK), 'dots 6');
  assert.equal(readbackWord('#', '  ', UK), 'dots 3 4 5 6');
  assert.equal(readbackWord('AB', 'ab', UK), 'ab');
});

test('the words come from a dictionary, so they can be translated', () => {
  const fr = { ...DEFAULT_WORDS, cap: 'majuscule', comma: 'virgule' };
  assert.equal(speakText('Paris,', { standard: 'ukaaf', words: fr }), 'majuscule Paris virgule');
});

test('every spoken word is in en.json under app.readback', () => {
  const en = JSON.parse(fs.readFileSync(path.join(EMBOSS, 'web', 'locales', 'en.json'), 'utf8'));
  const dict = en.app && en.app.readback;
  assert.ok(dict, 'en.json has app.readback');
  for (const [k, v] of Object.entries(DEFAULT_WORDS)) assert.equal(dict[k], v, `app.readback.${k}`);
});

test('UEB grade 2: braille words are back-translated, then spoken', () => {
  const tr = makeTranslators(louis, UEB_TABLES.g2);
  const say = (print) => tr.translate(print).split(' ').filter(Boolean).map((w) => readbackWord(w, tr.backTranslate(w), UK)).join(' ');
  // contractions back to words, capitals and punctuation spoken
  assert.equal(say('London, said Dr. McDonald, is NASA ready?'),
    'cap London comma said cap Dr full stop cap Mc cap Donald comma is cap N cap A cap S cap A ready question mark');
  // "the", "and", "for" are wordsigns/contractions: the braille says them, so the proofreader hears them
  assert.equal(say('the dog and the cat'), 'the dog and the cat');
  assert.equal(say('The children went through.'), 'cap The children went through full stop');
  // a mistake in the braille is heard: the letter "g" where the contraction should be, a missing capital sign
  assert.equal(readbackWord('LONDON', tr.backTranslate('LONDON'), UK), 'london');
  assert.equal(readbackWord(',LONDON', tr.backTranslate(',LONDON'), UK), 'cap London');
  assert.equal(readbackWord(',,LONDON', tr.backTranslate(',,LONDON'), UK), 'cap L cap O cap N cap D cap O cap N');
  // an unmapped cell is spoken as its dots
  assert.equal(readbackWord('`', tr.backTranslate('`'), UK), 'dots 4');
  assert.equal(readbackWord('~', tr.backTranslate('~'), UK), 'dots 4 5');
});

test('a decorative line (under a list or table) is recognised, so it is not read cell by cell', async () => {
  const { isRuleToken } = await import('../web/braille-readback.mjs');
  assert.equal(isRuleToken('"31111111111'), true);
  assert.equal(isRuleToken('"33333333333'), true);
  assert.equal(isRuleToken('------'), true);
  assert.equal(isRuleToken('London'), false);
  assert.equal(isRuleToken('"31'), false);
  assert.equal(isRuleToken(''), false);
  assert.equal(DEFAULT_WORDS.rule_line, 'line');
});

// A word inside brackets: liblouis misreads contractions there ("(quickly)" -> "(qkly)", "(it)" -> "(x)"); backTranslateWord takes the
// brackets off, back-translates the word, and puts them back, so the proofreader hears the print and only a real braille mistake.
test('UEB: a word inside brackets is read as the print says it', async () => {
  const { backTranslateWord } = await import('../web/braille-readback.mjs');
  const tr = makeTranslators(louis, UEB_TABLES.g2);
  const bt = (b) => backTranslateWord(b, tr.backTranslate, { ueb: true });
  for (const print of ['(quickly)', '(quite)', '(children)', '(it)', '(x)', '(the)', '(and)', '(for)', '(Dr.)', '(3)', '(a)', '(NASA)', '[quickly]', '[it]', '(quickly),', '(children).', '(London);', '(quickly', 'quickly)', 'children)', 'plain', 'plain,', '"quickly"']) {
    const b = tr.translate(print);
    assert.equal(bt(b), print, `${print} -> ${b}`);
  }
  // other braille codes are left to their own back-translation
  assert.equal(backTranslateWord('"<QKLY">', tr.backTranslate, { ueb: false }), tr.backTranslate('"<QKLY">'));
  // spoken: the brackets named, the word as the print has it
  assert.equal(readbackWord('"<QKLY">', bt('"<QKLY">'), UK), 'open bracket quickly close bracket');
});
