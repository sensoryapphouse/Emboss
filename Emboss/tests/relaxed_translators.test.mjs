// Relaxed braille, task 3 (A91): relaxTranslation (format/relaxed-braille.mjs) wired into the one place Emboss makes text braille,
// web/braille-table.mjs makeTranslators(louis, tableList, { relaxed }), behind an off-by-default switch (web/settings.mjs
// relaxedEnabled / activeRelaxedProfile). New file, so there is no earlier expectation to change. It was first run before the
// wiring existed and failed (the third argument was ignored, the settings functions were missing). Real liblouis tables, no stubs.
//
// What must hold:
//  - no option, relaxed null, or the All profile (a Set of every key): braille AND inputPos identical to today, over a sweep;
//  - a Set that leaves signs out, with the UEB grade 2 table: exactly relaxTranslation's output; translate = translatePos().braille;
//  - the grade 1 table and any other braille code are never relaxed;
//  - the switch: off unless ?relaxed=1 (remembered), ?relaxed=0 turns it off, profile null when off (Stage 2: the profile in use is the stored reader profile);
//  - a whole document formatted with the 'none' profile has no contraction cells in a sample sentence and is still laid out, in BANA
//    and UKAAF, and the classic path (formatDocument) and the editor path (formatDocumentAsync with translatePos) agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.join(HERE, '..');
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const { makeTranslators, UEB_TABLES } = await import('../web/braille-table.mjs');
const { relaxTranslation } = await import('../format/relaxed-braille.mjs');
const { UEB_CONTRACTION_SIGNS } = await import('../format/relaxed-signs.mjs');
const { CODES } = await import('../Translate/braille-codes.mjs');
const { editorTranslators } = await import('../format/node-translate-helper.mjs');
const { formatDocument, formatDocumentAsync } = await import('../format/document.mjs');

const ALL_KEYS = UEB_CONTRACTION_SIGNS.map((s) => s.key);
const ALL = new Set(ALL_KEYS);
const NONE = new Set();
const G2 = UEB_TABLES.g2;
const G1 = UEB_TABLES.g1;

const SWEEP = [
  'teacher', 'Teacher', 'TEACHER', 'children', 'Children', 'the', 'The quick brown fox', 'enough', 'dismiss.', '(children)', 'was', 'his,',
  'B', 'x', 'b', 'rabbit', 'accept', 'mother', 'Wednesday', 'together', "friend's", 'about', 'because', 'afternoon', '2024', 'a1', 'x-ray',
  'The teacher said that children should go through the garden.', 'He was, however, not known for his kindness; nor would he accept it.',
  'Wednesday afternoon, the little children went out to play with their mother.', '"Do you know," she asked, "whether it can be done?"',
  'COVID-19 is NOT a common cold', 'Dr. McDonald visited the C.A.T. lab at 3 p.m. with the iPhone', '', ' ', 'a', 'I',
];
const TF_TEXT = 'The teacher and the children';
const TF = [...TF_TEXT].map((c, i) => (i >= 4 && i < 11 ? 1 : 0));   // "teacher" in italic

test('no option, relaxed null and the All profile give today\'s braille and inputPos (sweep, typeform)', () => {
  const today = makeTranslators(louis, G2);
  for (const opt of [undefined, {}, { relaxed: null }, { relaxed: undefined }, { relaxed: ALL }]) {
    const tr = opt === undefined ? makeTranslators(louis, G2) : makeTranslators(louis, G2, opt);
    for (const s of SWEEP) {
      assert.equal(tr.translate(s), today.translate(s), `translate ${JSON.stringify(s)}`);
      assert.deepEqual(tr.translatePos(s), today.translatePos(s), `translatePos ${JSON.stringify(s)}`);
    }
    assert.equal(tr.translate(TF_TEXT, TF), today.translate(TF_TEXT, TF));
    assert.deepEqual(tr.translatePos(TF_TEXT, TF), today.translatePos(TF_TEXT, TF));
  }
});

test('"today" is the raw liblouis call (the baseline itself has not moved)', () => {
  const tr = makeTranslators(louis, G2);
  for (const s of SWEEP) assert.equal(tr.translate(s), louis.translate(s, G2, null), JSON.stringify(s));
});

test('with a profile that leaves signs out, the UEB grade 2 translators spell them out (= relaxTranslation)', () => {
  const profiles = { none: NONE, one: new Set(['strong_contractions:ch']), most: new Set(ALL_KEYS.filter((k) => k !== 'strong_contractions:ea')) };
  for (const [name, relaxed] of Object.entries(profiles)) {
    const tr = makeTranslators(louis, G2, { relaxed });
    const base = makeTranslators(louis, G2);
    for (const s of SWEEP) {
      const b = base.translatePos(s);
      const want = relaxTranslation(s, b, relaxed, { translatePos: (w) => base.translatePos(w) });
      const got = tr.translatePos(s);
      assert.equal(got.braille, want.braille, `${name}: braille of ${JSON.stringify(s)}`);
      assert.deepEqual(got.inputPos, want.inputPos, `${name}: inputPos of ${JSON.stringify(s)}`);
      assert.equal(tr.translate(s), want.braille, `${name}: translate of ${JSON.stringify(s)}`);
    }
  }
  // and it really did something
  const none = makeTranslators(louis, G2, { relaxed: NONE });
  assert.notEqual(none.translate('teacher'), makeTranslators(louis, G2).translate('teacher'));
  assert.equal(none.translate('teacher'), 'TEACHER');
  assert.equal(makeTranslators(louis, G2, { relaxed: new Set(['strong_contractions:ch']) }).translate('teacher'), 'TEA*ER');
});

test('liblouis translate(text) and translatePos(text).braille agree (so the relaxed translate is consistent)', () => {
  for (const s of SWEEP) assert.equal(louis.translate(s, G2, null), louis.translatePos(s, G2, null).braille, JSON.stringify(s));
  assert.equal(louis.translate(TF_TEXT, G2, TF), louis.translatePos(TF_TEXT, G2, TF).braille);
});

test('the grade 1 table and other braille codes are never relaxed', () => {
  const g1 = makeTranslators(louis, G1, { relaxed: NONE });
  const g1Today = makeTranslators(louis, G1);
  for (const s of SWEEP) {
    assert.equal(g1.translate(s), g1Today.translate(s));
    assert.deepEqual(g1.translatePos(s), g1Today.translatePos(s));
  }
  const g3 = CODES.find((c) => c.id === 'en-g3');
  assert.ok(g3 && g3.table && !/en-ueb-g2\.ctb/.test(g3.table));
  const other = makeTranslators(louis, g3.table, { relaxed: NONE });
  const otherToday = makeTranslators(louis, g3.table);
  for (const s of SWEEP.slice(0, 12)) {
    assert.equal(other.translate(s), otherToday.translate(s), s);
    assert.deepEqual(other.translatePos(s), otherToday.translatePos(s), s);
  }
  // a code listed with unicode.dis (the en-ueb-g2 code itself) IS relaxed, and the BRF conversion still happens
  const ueb = CODES.find((c) => c.id === 'en-ueb-g2');
  const r = makeTranslators(louis, ueb.table, { relaxed: NONE });
  assert.equal(r.translate('teacher'), 'TEACHER');
});

test('back-translation is untouched by the option, and reads spelled-out words back correctly', () => {
  const none = makeTranslators(louis, G2, { relaxed: NONE });
  const today = makeTranslators(louis, G2);
  assert.equal(none.backTranslate('TEA*ER'), today.backTranslate('TEA*ER'));
  for (const w of ['teacher', 'children', 'through', 'garden', 'mother', 'together', 'should', 'enough', 'because']) {
    assert.equal(none.backTranslate(none.translate(w)), w, `${w} read back from relaxed (none) braille`);
  }
});

// ---- the switch (web/settings.mjs) ------------------------------------------------------------------------------------------------

function withBrowserGlobals(search, store) {
  const saved = { location: globalThis.location, localStorage: globalThis.localStorage };
  globalThis.location = { search };
  globalThis.localStorage = {
    getItem: (k) => (Object.hasOwn(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  return () => { globalThis.location = saved.location; globalThis.localStorage = saved.localStorage; };
}

// STAGE 2 (Paul's plan, 3 Oct 2026) replaced the temporary ?profile= chooser by reader profiles; then PAUL, 2 NOV 2026: "relaxed braille is part of the
// template (one name)" - reader profiles stopped being separately named things, and the ticks in force are the setting `contractions` (web/settings.mjs:
// null = All, else a list of catalogue keys; a template carries them, web/templates.mjs). The two tests below were changed for that reason only: the switch
// (?relaxed=1 / ?relaxed=0) behaves exactly as before; the ticks now come from the settings' `contractions`, not from a stored reader profile.
const SETTINGS = (contractions) => JSON.stringify({ mode: 'bana', grade: 'g2', brailleCode: 'en-ueb-g2', contractions });
test('the switch: off by default; ?relaxed=1 turns it on and is remembered; ?relaxed=0 turns it off; the ticks are the settings\' contractions', async () => {
  const { relaxedEnabled, activeRelaxedProfile } = await import('../web/settings.mjs');
  const store = { 'emboss-settings': SETTINGS([]) };                          // a template with nothing ticked is in force (stored on this computer, the test's localStorage)
  let restore = withBrowserGlobals('', store);
  try {
    assert.equal(relaxedEnabled(), false);
    assert.equal(activeRelaxedProfile(), null, 'switched off: null (All) whatever ticks are in force');
    restore(); restore = withBrowserGlobals('?relaxed=1', store);
    assert.equal(relaxedEnabled(), true);
    const p = activeRelaxedProfile();
    assert.ok(p instanceof Set && p.size === 0, 'the ticks in force: the empty Set');
    restore(); restore = withBrowserGlobals('', store);                       // a later visit, no query: remembered
    assert.equal(relaxedEnabled(), true);
    assert.equal(activeRelaxedProfile().size, 0);
    restore(); restore = withBrowserGlobals('?relaxed=0', store);
    assert.equal(relaxedEnabled(), false);
    assert.equal(activeRelaxedProfile(), null, 'null (All) whatever is stored, when off');
    restore(); restore = withBrowserGlobals('', store);
    assert.equal(relaxedEnabled(), false, '?relaxed=0 is remembered too');
    assert.equal(activeRelaxedProfile(), null);
  } finally { restore(); }
});

test('activeRelaxedProfile follows the settings\' contractions: null = All, a list = its Set (the same Set while unchanged); ?profile= no longer does anything', async () => {
  const { activeRelaxedProfile, relaxedProfileKey } = await import('../web/settings.mjs');
  const store = {};
  const at = (q) => { const r = withBrowserGlobals(q, store); try { return activeRelaxedProfile(); } finally { r(); } };
  const strongKeys = UEB_CONTRACTION_SIGNS.filter((s) => s.group === 'strong_contractions' || s.group === 'strong_wordsigns').map((s) => s.key);
  const r0 = withBrowserGlobals('?relaxed=1', store);
  try {
    assert.equal(activeRelaxedProfile(), null, 'a fresh computer (no settings stored): All');
    store['emboss-settings'] = SETTINGS(null);
    assert.equal(activeRelaxedProfile(), null, 'settings with no ticks: All');
    store['emboss-settings'] = SETTINGS(strongKeys);
    assert.deepEqual([...activeRelaxedProfile()].sort(), [...strongKeys].sort());
    assert.equal(activeRelaxedProfile(), activeRelaxedProfile(), 'the same Set while the stored settings are unchanged');
    assert.equal(relaxedProfileKey(null), '');
    assert.notEqual(relaxedProfileKey(activeRelaxedProfile()), '');
    const keyBefore = relaxedProfileKey();
    store['emboss-settings'] = SETTINGS(strongKeys.slice(0, 2));
    assert.equal(activeRelaxedProfile().size, 2, 'changed ticks are read at once');
    assert.notEqual(relaxedProfileKey(), keyBefore, 'and the cache key follows them');
    store['emboss-settings'] = SETTINGS(UEB_CONTRACTION_SIGNS.map((s) => s.key));
    assert.equal(activeRelaxedProfile(), null, 'every contraction ticked is All');
    store['emboss-settings'] = '{not json';
    assert.equal(activeRelaxedProfile(), null, 'damaged settings: All');
    store['emboss-settings'] = SETTINGS(['strong_contractions:ch', 'nonsense']);
    assert.deepEqual([...activeRelaxedProfile()], ['strong_contractions:ch'], 'a key outside the catalogue is dropped');
    // the old reader-profile store is no longer read
    store['emboss-settings'] = SETTINGS(null);
    store['emboss-reader-profiles'] = JSON.stringify({ v: 1, profiles: [{ name: 'Old', keys: [] }] });
    store['emboss-reader-profile'] = 'Old';
    assert.equal(activeRelaxedProfile(), null, 'the old reader-profile keys are only read once, by the migration to templates (web/templates.mjs)');
  } finally { r0(); }
  store['emboss-settings'] = SETTINGS(['strong_contractions:ch']);
  assert.equal(at('?profile=none').size, 1, '?profile= is gone (it was the temporary chooser)');
  assert.equal(at('?profile=all').size, 1);
  store['emboss-settings'] = SETTINGS(null);
  assert.equal(at(''), null);
});

// ---- a whole document ---------------------------------------------------------------------------------------------------------------

const SENTENCE = 'The teacher said that children should go through the garden.';
const para = (text) => ({ type: 'paragraph', text, segments: [{ type: 'text', text }] });

test('a document formatted with the none profile is spelled out and still laid out (BANA and UKAAF, classic and editor paths)', async () => {
  const doc = { blocks: [para(SENTENCE)], title: 'Garden' };
  for (const mode of ['bana', 'ukaaf']) {
    const plain = editorTranslators(louis);
    const rel = editorTranslators(louis, { relaxed: NONE });
    const o = (t, extra = {}) => ({ mode, standard: mode, width: 38, depth: 25, paragraphStyle: 'indented', tableFormat: 'auto', listStyle: 'compact',
      translate: t.translate, translateG1: t.translateG1, ...extra });
    const base = formatDocument(doc, o(plain));
    const out = formatDocument(doc, o(rel));
    const bodyLines = (brf) => brf.split('\x0c')[0].split(/\r?\n/).filter((l) => /[A-Z]/.test(l) && l.trim());
    const baseBody = bodyLines(base).join(' ');
    const outBody = bodyLines(out).join(' ');
    assert.notEqual(outBody, baseBody, `${mode}: the relaxed page differs from the contracted one`);
    // contracted: the sentence uses contraction cells; relaxed 'none': only letters, the capital sign, spaces and the full stop
    const sentence = outBody.replace(/\s+/g, ' ').match(/,T[A-Z ,]*4/);
    assert.ok(sentence, `${mode}: the sentence is in the page: ${outBody}`);
    assert.equal(sentence[0], ',THE TEACHER SAID THAT CHILDREN SHOULD GO THROUGH THE GARDEN4', `${mode}: letters only`);
    assert.doesNotMatch(baseBody.replace(/\s+/g, ' '), /,T[A-Z ,]*4/, `${mode}: contracted braille has contraction cells`);
    for (const l of out.split(/[\r\n\x0c]+/)) assert.ok(l.length <= 38, `${mode}: a line within 38 cells (${l.length})`);
    assert.ok(out.split('\x0c').length >= 1);
    // the editor path (formatDocumentAsync + translatePos) lays it out exactly as the classic path does
    const editor = await formatDocumentAsync(doc, o(rel, { translatePos: rel.translatePos, trace: {} }));
    assert.equal(editor, out, `${mode}: classic and editor paths agree under the none profile`);
  }
});

test('a real book (the first 60 blocks of Alice) under the none profile: laid out, within the cell limit, both standards, both paths', async () => {
  if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
  if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
  const { parseFile } = await import('../input/parse.mjs');
  const file = path.join(EMBOSS, 'tests', 'real_samples', 'html', 'alice-in-wonderland-pg11.html');
  const model = await parseFile(path.basename(file), fs.readFileSync(file, 'utf8'));
  const doc = { ...model, blocks: model.blocks.slice(0, 60) };
  for (const mode of ['bana', 'ukaaf']) {
    const plain = editorTranslators(louis);
    const rel = editorTranslators(louis, { relaxed: NONE });
    const o = (t, extra = {}) => ({ mode, standard: mode, width: 38, depth: 25, paragraphStyle: 'indented', tableFormat: 'auto', listStyle: 'compact',
      translate: t.translate, translateG1: t.translateG1, ...extra });
    const base = formatDocument(doc, o(plain));
    const out = formatDocument(doc, o(rel));
    assert.ok(out.length > base.length, `${mode}: spelled out is longer than contracted (${out.length} vs ${base.length})`);
    for (const l of out.split(/[\r\n\x0c]+/)) assert.ok(l.length <= 38, `${mode}: a line within 38 cells (${l.length}: ${l})`);
    const pages = out.split('\x0c');
    assert.ok(pages.length >= base.split('\x0c').length, `${mode}: at least as many pages`);
    const editor = await formatDocumentAsync(doc, o(rel, { translatePos: rel.translatePos, trace: {} }));
    assert.equal(editor, out, `${mode}: classic and editor paths agree`);
  }
});
