// Relaxed braille, Stage 4 (A91; Paul 3 Oct 2026, decision H "help teachers choose"): the pure part of the profile manager's two new aids -
// the contractions a profile LEAVES OUT of the open document, commonest first (format/relaxed-report.mjs), and the built-in sample
// sentence. New file, so no earlier expectation changes. Written before the module existed: it failed (no such module).
//
// Method under test: the document's distinct words are translated ONCE in full contracted UEB (translatePos + identifySigns, as
// relaxTranslation does) and the signs counted per catalogue key; for any profile the list is just the counted signs not in its Set, so
// ticking a box needs no new translation. A whole-word sign and a groupsign are different entries ("be" the word and "be-" at the start
// of a word; "child" and "ch"). Real liblouis tables, no stubs.
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
const { UEB_CONTRACTION_SIGNS, UEB_CONTRACTION_GROUPS, signByKey } = await import('../format/relaxed-signs.mjs');
const report = await import('../format/relaxed-report.mjs');
const { countSigns, leftOut, signUse, textSignature, DEFAULT_SAMPLE } = report;

const ALL = new Set(UEB_CONTRACTION_SIGNS.map((s) => s.key));
const NONE = new Set();
const baseTP = makeTranslators(louis, UEB_TABLES.g2).translatePos;          // the page's own translator, unrelaxed
const count = (text, opts) => countSigns(text, baseTP, opts);
const obj = (m) => Object.fromEntries([...m.counts.entries()]);

test('counts per catalogue key: wordsigns, groupsigns, shortforms, with the number of times each occurs', async () => {
  const r = await count('the the the child children teacher');
  const c = obj(r);
  assert.equal(c['strong_wordsigns:the'], 3);
  assert.equal(c['strong_contraction_wordsigns:child'], 1, 'child, the whole word: the wordsign');
  assert.equal(c['shortforms:children'], 1);
  assert.deepEqual([c['lower_contractions:ea'], c['strong_contractions:ch'], c['strong_contractions:er']], [1, 1, 1], 'teacher = t ea ch er');
  assert.equal(r.words, 6, 'six words');
  assert.equal(r.distinctWords, 4);
  for (const k of Object.keys(c)) assert.ok(signByKey(k), `${k} is a catalogue key`);
});

test('a whole-word sign and a groupsign are different entries: child / ch, be / be-', async () => {
  const c = obj(await count('child teacher be begin'));
  assert.equal(c['strong_contraction_wordsigns:child'], 1);
  assert.equal(c['strong_contractions:ch'], 1, 'only teacher holds the groupsign ch');
  assert.equal(c['lower_wordsigns:be'], 1, 'be, the word');
  assert.equal(c['lower_contractions:be'], 1, 'be- at the start of "begin"');
});

test('capitals, punctuation and typeform do not change what is counted', async () => {
  const c = obj(await count('The, THE (the) "The" the. the; the!'));
  assert.equal(c['strong_wordsigns:the'], 7);
  const d = obj(await count('Teacher TEACHER teacher, (teacher)'));
  assert.equal(d['strong_contractions:ch'], 4);
  assert.equal(d['strong_contractions:er'], 4);
  assert.equal(d['lower_contractions:ea'], 4);
  const e = obj(await count('12 3.5 -- ... !? 2024'));
  assert.deepEqual(e, {}, 'words with no letters hold no contractions');
});

test('a sign used twice in one word is counted twice; each occurrence of a word counts', async () => {
  const c = obj(await count('knocking knocking'));
  assert.equal(c['strong_contractions:ing'], 2);
  const g = obj(await count('garden garden garden'));
  assert.deepEqual([g['strong_contractions:ar'], g['lower_contractions:en']], [3, 3]);
});

test('the count agrees with what a profile really spells out: the empty profile on a passage', async () => {
  const text = 'The children were knocking on the door of the old farmhouse, because their father had gone out. The teacher said that children should go through the garden.';
  const r = await count(text);
  const spelled = makeTranslators(louis, UEB_TABLES.g2, { relaxed: NONE }).translatePos(text).spelledOut;
  const tally = {};
  for (const s of spelled) tally[s.sign] = (tally[s.sign] || 0) + 1;
  assert.deepEqual(obj(r), tally, 'sign for sign the same as relaxTranslation with nothing ticked');
});

test('leftOut: the counted signs not in the profile, commonest first; All and a full Set leave nothing out', async () => {
  const r = await count('the the the the and and child teacher');
  assert.deepEqual(leftOut(r.counts, null), []);
  assert.deepEqual(leftOut(r.counts, ALL), []);
  const none = leftOut(r.counts, NONE);
  assert.equal(none[0].key, 'strong_wordsigns:the');
  assert.equal(none[0].count, 4);
  assert.equal(none[1].key, 'strong_wordsigns:and');
  assert.equal(none[1].count, 2);
  for (let i = 1; i < none.length; i++) assert.ok(none[i - 1].count >= none[i].count, 'sorted by count, highest first');
  assert.equal(none.reduce((n, x) => n + x.count, 0), [...r.counts.values()].reduce((n, x) => n + x, 0), 'every counted sign');
  const noThe = leftOut(r.counts, new Set(['strong_wordsigns:the']));
  assert.ok(!noThe.some((x) => x.key === 'strong_wordsigns:the'), 'a ticked sign is not left out');
  assert.equal(noThe[0].key, 'strong_wordsigns:and');
  assert.ok(noThe.every((x) => x.sign && x.sign.key === x.key), 'each entry carries its catalogue sign');
  // an array of keys is accepted like a Set; ties keep the catalogue's order
  assert.deepEqual(leftOut(r.counts, [...ALL]), []);
  const ties = leftOut(new Map([['shortforms:children', 2], ['alphabetic_wordsigns:but', 2]]), NONE).map((x) => x.key);
  assert.deepEqual(ties, ['alphabetic_wordsigns:but', 'shortforms:children']);
});

test('signUse says in words where a sign is used', () => {
  assert.equal(signUse(signByKey('strong_contraction_wordsigns:child')), 'whole');
  assert.equal(signUse(signByKey('shortforms:children')), 'whole');
  assert.equal(signUse(signByKey('strong_contractions:ch')), 'part');
  assert.equal(signUse(signByKey('lower_contractions:be')), 'part');
  assert.equal(signUse(signByKey('lower_wordsigns:be')), 'whole');
  assert.equal(signUse(signByKey('strong_wordsigns:the')), 'either', 'the, and, for, of, with: the whole word or inside a longer word');
  assert.equal(signUse(signByKey('initial_contractions:father')), 'either', 'initial contractions stand for the word itself and begin longer words');
  assert.equal(signUse(signByKey('final_contractions:ment')), 'part', 'final contractions only end longer words');
});

test('counting runs in the background: it gives the page the floor between slices and can be stopped', async () => {
  const words = [];
  for (let i = 0; i < 4000; i++) words.push('word' + i + 'teacher'.slice(0, i % 7));
  const text = words.join(' ');
  let yields = 0;
  const r = await count(text, { sliceMs: 1, yieldFn: async () => { yields++; } });
  assert.ok(yields > 3, `yielded ${yields} times`);
  assert.equal(r.words, 4000);
  // stop part-way: null, and no more work is done afterwards
  let slices = 0;
  const stopped = await count(text, { sliceMs: 1, yieldFn: async () => { slices++; }, isCancelled: () => slices >= 2 });
  assert.equal(stopped, null);
  assert.ok(slices <= 3, `stopped after ${slices} slices`);
  // progress is reported between 0 and 1
  const seen = [];
  await count(text, { sliceMs: 1, yieldFn: async () => {}, onProgress: (f) => seen.push(f) });
  assert.ok(seen.length > 1 && seen.every((f) => f >= 0 && f <= 1) && seen[seen.length - 1] > seen[0]);
});

test('a translator that fails on a word does not stop the count; empty and odd texts', async () => {
  const flaky = (w) => { if (w === 'bad') throw new Error('boom'); return baseTP(w); };
  const r = await countSigns('the bad the', flaky);
  assert.equal(obj(r)['strong_wordsigns:the'], 2);
  assert.equal(r.words, 3);
  assert.deepEqual(obj(await count('')), {});
  assert.deepEqual(obj(await count('   \n\t ')), {});
  assert.deepEqual(obj(await count(null)), {});
  assert.equal((await count('')).words, 0);
});

test('textSignature: the same text gives the same signature, a changed text a different one', () => {
  assert.equal(textSignature('abc def'), textSignature('abc def'));
  assert.notEqual(textSignature('abc def'), textSignature('abc deg'));
  assert.notEqual(textSignature('abc def'), textSignature('abc def '));
  assert.equal(typeof textSignature(''), 'string');
});

test('the built-in sample sentence uses all nine groups of contractions, and braille differs with the ticks', () => {
  const groups = new Set();
  const spelled = makeTranslators(louis, UEB_TABLES.g2, { relaxed: NONE }).translatePos(DEFAULT_SAMPLE).spelledOut;
  for (const s of spelled) groups.add(s.sign.split(':')[0]);
  assert.deepEqual([...groups].sort(), UEB_CONTRACTION_GROUPS.map((g) => g.id).sort(), 'every group appears in the sample');
  assert.ok(spelled.length >= 20, `${spelled.length} signs`);
  assert.ok(DEFAULT_SAMPLE.length < 200 && /^[A-Z]/.test(DEFAULT_SAMPLE) && /[.]$/.test(DEFAULT_SAMPLE));
  const full = makeTranslators(louis, UEB_TABLES.g2).translate(DEFAULT_SAMPLE);
  const spelledOut = makeTranslators(louis, UEB_TABLES.g2, { relaxed: NONE }).translate(DEFAULT_SAMPLE);
  assert.notEqual(full, spelledOut);
  assert.ok(spelledOut.length > full.length);
});

// ---- a whole book -----------------------------------------------------------------------------------------------------------------
const NIMAS = path.join(EMBOSS, 'tests', 'nimas_samples', '9780544087507NIMAS.xml');
const bookText = () => fs.readFileSync(NIMAS, 'utf8').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ');

test('50,000 words of a real NIMAS book are counted in a sane time', async () => {
  const words = bookText().split(/\s+/).filter(Boolean).slice(0, 50000);
  const text = words.join(' ');
  const t0 = performance.now();
  const r = await count(text);
  const ms = performance.now() - t0;
  console.log(`      50,000 words: ${r.distinctWords} distinct, ${r.counts.size} different signs, ${(ms / 1000).toFixed(2)} s`);
  assert.equal(r.words, words.filter((w) => /\p{L}/u.test(w)).length);
  assert.ok(r.counts.size > 60, 'many different signs');
  assert.ok(ms < 60000, `${ms} ms`);
  const top = leftOut(r.counts, NONE).slice(0, 5).map((x) => `${x.sign.learnKey} ${x.count}`).join(', ');
  console.log(`      commonest with nothing ticked: ${top}`);
  // the same counts a second time: the whole of the book's profile list is instant
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) leftOut(r.counts, new Set(['strong_wordsigns:the']));
  assert.ok((performance.now() - t1) / 100 < 5, 'leftOut for a changed tick is instant');
});

test('the whole book (about 158,000 tokens) - time only', async () => {
  const text = bookText();
  const t0 = performance.now();
  const r = await count(text);
  console.log(`      whole book: ${r.words} words, ${r.distinctWords} distinct, ${r.counts.size} signs, ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  assert.ok(r.words > 100000);
});
