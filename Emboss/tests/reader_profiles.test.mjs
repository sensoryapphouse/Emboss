// Relaxed braille, Stage 2 (A91; Paul 3 Oct 2026): reader profiles - the store (web/reader-profiles.mjs) and the pure helpers the
// Settings table uses. New file, so no earlier expectation changes. Written before the module existed: it failed (no such module).
//
// Decisions under test (Relaxed_Braille.md): B  a profile = a name and the contractions it holds; C  stored on this computer only,
// no export / import; D  not saved with a document (nothing here touches a document); E  no reading-scheme presets (only "All" is
// built in); J  "All" is full contracted braille and cannot be edited, renamed or deleted, and Emboss returns to All when the
// profile in use is deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProfileStore, PROFILES_KEY, ACTIVE_KEY, ALL_NAME, MAX_NAME, cleanKeys, cleanName, describeCells, groupTickState, nameProblem,
} from '../web/reader-profiles.mjs';
import { UEB_CONTRACTION_SIGNS, UEB_CONTRACTION_GROUPS } from '../format/relaxed-signs.mjs';

const ALL_KEYS = UEB_CONTRACTION_SIGNS.map((s) => s.key);
const memoryStorage = (init = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (Object.hasOwn(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
};
const strongKeys = UEB_CONTRACTION_SIGNS.filter((s) => s.group === 'strong_contractions').map((s) => s.key);

test('a fresh store has only All: locked, holding every contraction, in use, and activeKeys() is null', () => {
  const s = createProfileStore(memoryStorage());
  const list = s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, ALL_NAME);
  assert.equal(list[0].locked, true);
  assert.deepEqual(list[0].keys, ALL_KEYS);
  assert.equal(s.activeName(), ALL_NAME);
  assert.equal(s.activeKeys(), null);
});

test('saveAs creates a profile (name trimmed, keys kept in catalogue order, unknown keys dropped); setActive makes it the one in use', () => {
  const st = memoryStorage();
  const s = createProfileStore(st);
  const r = s.saveAs('  Sam   – Dot-to-Dot 6 ', [...strongKeys].reverse().concat(['nonsense:key', 'strong_contractions:ch']));
  assert.deepEqual(r, { ok: true, name: 'Sam – Dot-to-Dot 6' });
  assert.deepEqual(s.get('Sam – Dot-to-Dot 6').keys, strongKeys);
  assert.equal(s.get('Sam – Dot-to-Dot 6').locked, false);
  assert.deepEqual(s.list().map((p) => p.name), [ALL_NAME, 'Sam – Dot-to-Dot 6']);
  assert.equal(s.activeName(), ALL_NAME, 'saveAs alone does not change the profile in use');
  assert.equal(s.setActive('Sam – Dot-to-Dot 6'), true);
  assert.equal(s.activeName(), 'Sam – Dot-to-Dot 6');
  const k = s.activeKeys();
  assert.ok(k instanceof Set);
  assert.deepEqual([...k], strongKeys);
  assert.equal(s.activeKeys(), k, 'the same Set while nothing has changed (the editor asks on every render)');
});

test('storage format: one JSON value of profiles (v 1; name and keys) and the active name as plain text', () => {
  const st = memoryStorage();
  const s = createProfileStore(st);
  s.saveAs('Sam', ['strong_contractions:ch', 'strong_contractions:sh']);
  s.setActive('Sam');
  assert.deepEqual(JSON.parse(st.data[PROFILES_KEY]), { v: 1, profiles: [{ name: 'Sam', keys: ['strong_contractions:ch', 'strong_contractions:sh'] }] });
  assert.equal(st.data[ACTIVE_KEY], 'Sam');
  // a second store over the same storage (another page, another tab) sees the same
  const s2 = createProfileStore(st);
  assert.equal(s2.activeName(), 'Sam');
  assert.deepEqual([...s2.activeKeys()], ['strong_contractions:ch', 'strong_contractions:sh']);
  s.setActive(ALL_NAME);
  assert.equal(s2.activeKeys(), null, 'a change made by one page is read by the other on its next ask');
  assert.equal(ACTIVE_KEY in st.data, false, 'All in use is stored as nothing');
});

test('names: empty, All (any case), too long and duplicates (any case) are refused; nothing is stored', () => {
  const st = memoryStorage();
  const s = createProfileStore(st);
  assert.deepEqual(s.saveAs('   ', []), { ok: false, error: 'empty' });
  assert.deepEqual(s.saveAs('all', []), { ok: false, error: 'reserved' });
  assert.deepEqual(s.saveAs(' ALL ', []), { ok: false, error: 'reserved' });
  assert.deepEqual(s.saveAs('x'.repeat(MAX_NAME + 1), []), { ok: false, error: 'toolong' });
  assert.equal(PROFILES_KEY in st.data, false);
  assert.equal(s.saveAs('Sam', strongKeys).ok, true);
  assert.deepEqual(s.saveAs('sam ', []), { ok: false, error: 'duplicate' });
  assert.deepEqual(s.saveAs('Sam', []), { ok: false, error: 'duplicate' });
  assert.equal(s.list().length, 2);
  assert.deepEqual(s.get('Sam').keys, strongKeys, 'a refused Save as did not touch the existing profile');
  // the check is also available without saving (the dialog shows the problem next to the name field)
  assert.equal(nameProblem('Sam', s.names()), 'duplicate');
  assert.equal(nameProblem('Sally', s.names()), null);
  assert.equal(cleanName('  a \t b\n c  '), 'a b c');
});

test('save replaces a profile\'s contractions; All is locked; a missing profile is refused', () => {
  const s = createProfileStore(memoryStorage());
  s.saveAs('Sam', strongKeys);
  assert.deepEqual(s.save('Sam', ['lower_contractions:ea']), { ok: true });
  assert.deepEqual(s.get('Sam').keys, ['lower_contractions:ea']);
  assert.deepEqual(s.save(ALL_NAME, []), { ok: false, error: 'locked' });
  assert.deepEqual(s.save('all', []), { ok: false, error: 'locked' });
  assert.deepEqual(s.save('Nobody', []), { ok: false, error: 'missing' });
  assert.deepEqual(s.get(ALL_NAME).keys, ALL_KEYS, 'All is unchanged');
  // an empty profile is allowed (every contraction spelled out)
  assert.equal(s.save('Sam', []).ok, true);
  assert.ok(s.get('Sam').keys.length === 0);
});

test('rename: the new name is checked like any name; the profile in use follows its new name; All cannot be renamed or a profile renamed to All', () => {
  const s = createProfileStore(memoryStorage());
  s.saveAs('Sam', strongKeys); s.saveAs('Kim', []);
  s.setActive('Sam');
  assert.deepEqual(s.rename('Sam', ' Sam J '), { ok: true, name: 'Sam J' });
  assert.deepEqual(s.list().map((p) => p.name), [ALL_NAME, 'Sam J', 'Kim']);
  assert.equal(s.activeName(), 'Sam J');
  assert.deepEqual(s.get('Sam J').keys, strongKeys);
  assert.deepEqual(s.rename('Sam J', 'kim'), { ok: false, error: 'duplicate' });
  assert.deepEqual(s.rename('Sam J', ''), { ok: false, error: 'empty' });
  assert.deepEqual(s.rename('Sam J', 'All'), { ok: false, error: 'reserved' });
  assert.deepEqual(s.rename(ALL_NAME, 'Everything'), { ok: false, error: 'locked' });
  assert.deepEqual(s.rename('Nobody', 'X'), { ok: false, error: 'missing' });
  assert.deepEqual(s.rename('Kim', 'KIM'), { ok: true, name: 'KIM' }, 'changing only the case of its own name is allowed');
});

test('delete: All cannot be deleted; deleting the profile in use goes back to All (J); deleting another keeps the one in use', () => {
  const st = memoryStorage();
  const s = createProfileStore(st);
  s.saveAs('Sam', strongKeys); s.saveAs('Kim', []);
  s.setActive('Sam');
  assert.deepEqual(s.remove(ALL_NAME), { ok: false, error: 'locked' });
  assert.deepEqual(s.remove('Nobody'), { ok: false, error: 'missing' });
  assert.deepEqual(s.remove('Kim'), { ok: true });
  assert.equal(s.activeName(), 'Sam');
  assert.deepEqual(s.remove('Sam'), { ok: true });
  assert.equal(s.activeName(), ALL_NAME);
  assert.equal(s.activeKeys(), null);
  assert.deepEqual(s.list().map((p) => p.name), [ALL_NAME]);
  assert.equal(ACTIVE_KEY in st.data, false);
});

test('an active name that no longer exists (deleted in another tab, or damaged) means All', () => {
  const st = memoryStorage();
  const s = createProfileStore(st);
  s.saveAs('Sam', strongKeys); s.setActive('Sam');
  const other = createProfileStore(st);
  other.remove('Sam');
  assert.equal(s.activeName(), ALL_NAME);
  assert.equal(s.activeKeys(), null);
  assert.equal(s.setActive('Nobody'), false, 'choosing a profile that is not there is refused');
  assert.equal(s.activeName(), ALL_NAME);
});

test('bad or missing stored data gives All and a usable store (not JSON, wrong shape, bad entries, keys outside the catalogue)', () => {
  const bads = [
    '{not json', 'null', '42', '"text"', '[]', '{"v":1}', '{"v":1,"profiles":"x"}', '{"v":1,"profiles":[null,1,"a",{},{"name":5},{"name":"  "},{"name":"All","keys":[]}]}',
  ];
  for (const raw of bads) {
    const s = createProfileStore(memoryStorage({ [PROFILES_KEY]: raw, [ACTIVE_KEY]: 'Sam' }));
    assert.deepEqual(s.list().map((p) => p.name), [ALL_NAME], `profiles from ${raw}`);
    assert.equal(s.activeName(), ALL_NAME);
    assert.equal(s.activeKeys(), null);
    assert.equal(s.saveAs('Sam', strongKeys).ok, true, 'a damaged store is still usable');
  }
  // good entries are kept beside bad ones; duplicates (any case) keep the first; keys are cleaned; keys not an array = none
  const raw = JSON.stringify({ v: 1, profiles: [
    { name: 'Sam', keys: ['strong_contractions:ch', 'strong_contractions:ch', 'gone:away', 7, null, 'lower_contractions:ea'] },
    { name: 'sam', keys: ['strong_contractions:sh'] },
    { name: 'Kim', keys: 'oops' },
    'junk',
  ] });
  const s = createProfileStore(memoryStorage({ [PROFILES_KEY]: raw, [ACTIVE_KEY]: 'Sam' }));
  assert.deepEqual(s.list().map((p) => p.name), [ALL_NAME, 'Sam', 'Kim']);
  assert.deepEqual(s.get('Sam').keys, ['strong_contractions:ch', 'lower_contractions:ea']);
  assert.deepEqual(s.get('Kim').keys, []);
  assert.equal(s.activeName(), 'Sam');
});

test('no storage at all (blocked or throwing): the store still works for the session, in memory; a write that fails is reported', () => {
  const s = createProfileStore(null);
  assert.equal(s.saveAs('Sam', strongKeys).ok, true);
  s.setActive('Sam');
  assert.equal(s.activeName(), 'Sam');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const t = createProfileStore(throwing);
  assert.equal(t.activeKeys(), null);
  assert.equal(t.list().length, 1);
  assert.equal(t.saveAs('Sam', strongKeys).ok, true, 'reading blocked: held in memory');
  const quota = memoryStorage();
  quota.setItem = () => { throw new Error('quota'); };
  const q = createProfileStore(quota);
  assert.deepEqual(q.saveAs('Sam', strongKeys), { ok: false, error: 'storage' });
  assert.deepEqual(q.list().map((p) => p.name), [ALL_NAME], 'a profile that could not be stored is not pretended to exist');
});

test('cleanKeys: catalogue order, no duplicates, nothing outside the catalogue, accepts a Set', () => {
  assert.deepEqual(cleanKeys(new Set(['strong_contractions:sh', 'strong_contractions:ch', 'x:y'])), ['strong_contractions:ch', 'strong_contractions:sh']);
  assert.deepEqual(cleanKeys(null), []);
  assert.deepEqual(cleanKeys(ALL_KEYS), ALL_KEYS);
});

test('describeCells: dot numbers for a screen reader ("ch, dots 1 6"), one cell or several', () => {
  assert.equal(describeCells('⠡'), 'dots 1 6');
  assert.equal(describeCells('⠃'), 'dots 1 2');
  assert.equal(describeCells('⠐⠙'), 'dot 5, then dots 1 4 5');
  assert.equal(describeCells('⠨⠙'), 'dots 4 6, then dots 1 4 5');
  assert.equal(describeCells('⠁'), 'dot 1');
  assert.equal(describeCells('⠻'), 'dots 1 2 4 5 6');
  assert.equal(describeCells(''), '');
  // every sign of the catalogue can be described
  for (const sg of UEB_CONTRACTION_SIGNS) assert.match(describeCells(sg.braille), /^dots? [1-6]( [1-6])*(, then dots? [1-6]( [1-6])*)*$/, sg.key);
});

test('groupTickState: all / none / some, for a group of the catalogue', () => {
  const g = UEB_CONTRACTION_GROUPS.find((x) => x.id === 'strong_contractions');
  assert.equal(groupTickState(new Set(), g), 'none');
  assert.equal(groupTickState(new Set(strongKeys), g), 'all');
  assert.equal(groupTickState(new Set([strongKeys[0]]), g), 'some');
  assert.equal(groupTickState(new Set(ALL_KEYS), g), 'all');
  assert.equal(groupTickState(new Set(['lower_contractions:ea']), g), 'none');
});

test('localisation: every English word of the dialog is in locales/en.json (app.relaxed.*) with the same text, and nothing else is there', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { CONTRACTIONS_WORDS } = await import('../web/contractions-ui.mjs');   // Paul, 2 Nov 2026: web/reader-profile-ui.mjs became web/contractions-ui.mjs (relaxed braille is part of the template)
  const en = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'locales', 'en.json'), 'utf8'));
  const inFile = en.app.relaxed;
  assert.ok(inFile && typeof inFile === 'object', 'en.json has app.relaxed');
  const fromModule = Object.fromEntries(Object.entries(CONTRACTIONS_WORDS).filter(([k]) => k.startsWith('app.relaxed.')).map(([k, v]) => [k.replace('app.relaxed.', ''), v]));   // (templates.* words are the template's own, with their own file)
  assert.deepEqual(inFile, fromModule);
  // every {placeholder} the dialog fills in is one the words have
  for (const [k, v] of Object.entries(inFile)) assert.ok(!/\{[^}]*[^\w}][^}]*\}/.test(v), `${k}: placeholders are plain names`);
});
