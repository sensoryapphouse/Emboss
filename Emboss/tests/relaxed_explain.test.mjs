// Relaxed braille, Stage 3 (A91; Paul 3 Oct 2026, decisions F and I): making the profile in use visible - the pure helpers
// (web/relaxed-explain.mjs). New file, so no earlier expectation changes. Written before the module existed: it failed (no such module).
//
//  F  the profile in use is shown where braille is made - only with relaxed braille on, a UEB contracted code, and a profile that is
//     not All (All = normal braille: nothing to flag);
//  I  the status bar says which contractions of the word under the cursor were spelled out, from the spelledOut list relaxTranslation
//     returns. Stage 4 wording (Paul's answers Q1 and Q2, 3 Oct 2026; the Stage 3 words were "ea, ch and er spelled out (not in the
//     “Sam” profile)"): Q1 - the profile is named as "Not in profile: Sam." (the name exactly as stored, no quotes);
//     Q2 - shorter is better: when the whole word is ONE sign that was spelled out (child, children, through, the, and) the word is
//     not repeated: just "Spelled out. Not in profile: Sam."
//
// PAUL, 2 NOV 2026: "relaxed braille is part of the template (one name)" - the old decisions F and I are now by template. The expectations changed
// for that reason only: the label is shown when the active template relaxes something (not "a profile that is not All"), and the status bar names the
// template: "Spelled out. Not in template: Sam – Year 2." (was "Not in profile: ..."). Everything else (Q1: the name as stored, no quotes; Q2: the
// whole word is not repeated) is as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spelledOutPrints, joinList, spelledOutNote, templateLabelShown } from '../web/relaxed-explain.mjs';
import { UEB_CONTRACTION_SIGNS } from '../format/relaxed-signs.mjs';
import fs from 'node:fs';
import { editorTranslators } from '../format/node-translate-helper.mjs';
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'liblouis', 'tables'));

// the English words, as the pages have them (web/contractions-ui.mjs tr(), which fills {placeholders})
const WORDS = {
  'app.relaxed.and': 'and',
  'app.relaxed.spelled_out': '{signs} spelled out. Not in template: {name}.',                 // Q1
  'app.relaxed.spelled_out_word': 'Spelled out. Not in template: {name}.',                    // Q2
};
const tr = (key, vars) => (WORDS[key] || key).replace(/\{(\w+)\}/g, (m, n) => (n in (vars || {}) ? String(vars[n]) : m));
const so = (chars, start) => ({ start, end: start + chars.length, chars, sign: 'x:' + chars, wordStart: 0, wordEnd: 20 });

test('joinList: one, two, three and four items', () => {
  assert.equal(joinList([]), '');
  assert.equal(joinList(['ea']), 'ea');
  assert.equal(joinList(['ea', 'er']), 'ea and er');
  assert.equal(joinList(['ea', 'ch', 'er']), 'ea, ch and er');
  assert.equal(joinList(['a', 'b', 'c', 'd']), 'a, b, c and d');
  assert.equal(joinList(['ea', 'er'], 'et'), 'ea et er', 'the joining word is a parameter (localisation)');
});

test('spelledOutPrints: the print of each sign in word order, lower case, each once', () => {
  assert.deepEqual(spelledOutPrints([]), []);
  assert.deepEqual(spelledOutPrints(undefined), []);
  assert.deepEqual(spelledOutPrints([so('ea', 1), so('er', 5)]), ['ea', 'er']);
  assert.deepEqual(spelledOutPrints([so('er', 5), so('ea', 1)]), ['ea', 'er'], 'word order, whatever the order of the list');
  assert.deepEqual(spelledOutPrints([so('er', 2), so('er', 6)]), ['er'], 'a sign used twice is named once');
  assert.deepEqual(spelledOutPrints([so('Ea', 1), so('ER', 5), so('ea', 9)]), ['ea', 'er'], 'case is ignored');
});

test('spelledOutNote: the sentence for the status bar, with the template named; nothing when nothing was spelled out', () => {
  // Q1 (Paul, 3 Oct 2026): "Not in profile: Sam." replaced "(not in the “Sam” profile)"; Paul, 2 Nov 2026: it names the template - "Not in template: Sam."
  assert.equal(spelledOutNote([], 'Sam', tr), '');
  assert.equal(spelledOutNote(undefined, 'Sam', tr), '');
  assert.equal(spelledOutNote([so('ea', 1)], 'Sam', tr), 'ea spelled out. Not in template: Sam.');
  assert.equal(spelledOutNote([so('ea', 1), so('er', 5)], 'Sam', tr), 'ea and er spelled out. Not in template: Sam.');
  assert.equal(spelledOutNote([so('ea', 1), so('ch', 3), so('er', 5)], 'Sam – Dot-to-Dot 6', tr), 'ea, ch and er spelled out. Not in template: Sam – Dot-to-Dot 6.', 'the name exactly as stored, no quotes');
});

test('spelledOutNote: when the whole word is ONE spelled-out sign the word is not repeated (Q2, Paul 3 Oct 2026)', () => {
  const whole = (chars, wordStart = 0) => ({ start: wordStart, end: wordStart + chars.length, chars, sign: 'x:' + chars, wordStart, wordEnd: wordStart + chars.length });
  assert.equal(spelledOutNote([whole('child')], 'Sam', tr), 'Spelled out. Not in template: Sam.');
  assert.equal(spelledOutNote([whole('the')], 'Sam', tr), 'Spelled out. Not in template: Sam.');
  // punctuation or a capital round the word does not matter: with the word given, only its letters have to be covered
  const comma = { start: 0, end: 3, chars: 'the', sign: 'x:the', wordStart: 0, wordEnd: 4 };
  assert.equal(spelledOutNote([comma], 'Sam', tr, 'the,'), 'Spelled out. Not in template: Sam.');
  assert.equal(spelledOutNote([comma], 'Sam', tr), 'the spelled out. Not in template: Sam.', 'without the word given, an attached comma cannot be told: the sign is named (never a guess)');
  // a sign that is only PART of the word still names itself
  assert.equal(spelledOutNote([so('ea', 1)], 'Sam', tr, 'teacher'), 'ea spelled out. Not in template: Sam.');
  const part = { start: 0, end: 3, chars: 'the', sign: 'x:the', wordStart: 0, wordEnd: 5 };
  assert.equal(spelledOutNote([part], 'Sam', tr, 'theme'), 'the spelled out. Not in template: Sam.', '"the" at the start of "theme" is a part, not the word');
});

test('templateLabelShown: only with relaxed braille on, a UEB contracted code and a template that relaxes something (Paul, 2 Nov 2026)', () => {
  assert.equal(templateLabelShown({ enabled: true, relaxable: true, relaxes: true }), true);
  assert.equal(templateLabelShown({ enabled: false, relaxable: true, relaxes: true }), false, 'switched off');
  assert.equal(templateLabelShown({ enabled: true, relaxable: false, relaxes: true }), false, 'grade 1 or another code');
  assert.equal(templateLabelShown({ enabled: true, relaxable: true, relaxes: false }), false, 'All ticked is normal braille: nothing to flag');
  assert.equal(templateLabelShown({ enabled: true, relaxable: true }), false);
});

test('with the real engine: "teacher" in a strong-only profile, the empty profile, and All', () => {
  const STRONG = new Set(UEB_CONTRACTION_SIGNS.filter((x) => x.group === 'strong_contractions' || x.group === 'strong_wordsigns').map((x) => x.key));
  const note = (relaxed, word) => spelledOutNote(editorTranslators(louis, { relaxed }).translatePos(word).spelledOut, 'Sam', tr, word);
  assert.equal(note(STRONG, 'teacher'), 'ea spelled out. Not in template: Sam.');
  assert.equal(note(new Set(), 'teacher'), 'ea, ch and er spelled out. Not in template: Sam.');
  assert.equal(note(new Set(), 'Teacher,'), 'ea, ch and er spelled out. Not in template: Sam.', 'a capital and attached punctuation do not matter');
  assert.equal(note(new Set(), 'garden'), 'ar and en spelled out. Not in template: Sam.');
  // Q2: the whole word is one sign -> "Spelled out." alone
  for (const w of ['child', 'children', 'through', 'the', 'and', 'The', 'the,', '(children)', 'CHILDREN']) {
    assert.equal(note(new Set(), w), 'Spelled out. Not in template: Sam.', w);
  }
  assert.equal(note(new Set(), 'theme'), 'the spelled out. Not in template: Sam.', 'the + me: "the" is only part of the word');
  assert.equal(note(STRONG, 'the'), '', 'a sign the profile holds is not mentioned');
  assert.equal(note(null, 'teacher'), '', 'All: nothing spelled out, nothing said');
  assert.equal(note(undefined, 'teacher'), '');
});

test('the English words the pages use are the ones pinned here (locales/en.json and the page\'s own fallback)', async () => {
  const en = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'locales', 'en.json'), 'utf8')).app.relaxed;
  assert.equal(en.spelled_out, '{signs} spelled out. Not in template: {name}.');         // Q1
  assert.equal(en.spelled_out_word, 'Spelled out. Not in template: {name}.');            // Q2
  const { CONTRACTIONS_WORDS } = await import('../web/contractions-ui.mjs');
  assert.equal(CONTRACTIONS_WORDS['app.relaxed.spelled_out'], en.spelled_out);
  assert.equal(CONTRACTIONS_WORDS['app.relaxed.spelled_out_word'], en.spelled_out_word);
});
