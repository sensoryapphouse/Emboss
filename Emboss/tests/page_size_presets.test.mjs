// Feedback 30 Sep 2026, item 6 ("Paper size presets are confusing and seem wrong"; Paul, 1 Oct: do all four, and choose the
// standard from the browser / machine on the very first run):
//  - a BANA setup with no page size of its own gets BANA's 38x25 (PAGE-BANA-1), not the UK 38x27 the built-in defaults carry;
//  - the presets include US braille paper (11 x 11.5 in: 38x25, KD's usual, and 40x25, BANA 1.7.1's maximum) as well as the UK ones,
//    the current standard's first;
//  - the preset list can name the preset that matches the current Cells / Lines ('' = custom size);
//  - on the very first run (nothing saved yet) the standard comes from the browser's region (US / Canada -> BANA, any other region
//    -> UKAAF), or with no region from the time zone (America/... -> BANA), and is saved so it never changes by itself afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, MODE_GEOMETRY, PAGE_SIZE_PRESETS, UK_PAGE_SIZE_PRESETS, presetsFor, presetIdFor, machineStandard, loadSettings } from '../web/settings.mjs';

test('a BANA setup with no page size of its own gets 38x25; UKAAF 38x27; a saved size is kept', () => {
  assert.deepEqual([sanitizeSettings({ mode: 'bana' }).cells, sanitizeSettings({ mode: 'bana' }).lines], [38, 25]);
  assert.deepEqual([sanitizeSettings({ mode: 'ukaaf' }).cells, sanitizeSettings({ mode: 'ukaaf' }).lines], [38, 27]);
  assert.deepEqual([sanitizeSettings({}).mode, sanitizeSettings({}).lines], ['ukaaf', 27]);
  assert.equal(sanitizeSettings({ mode: 'bana', cells: 40, lines: 27 }).lines, 27, 'a saved size is never overridden');
  assert.equal(sanitizeSettings({ mode: 'bana', cells: 40, lines: 27 }).cells, 40);
  assert.deepEqual(MODE_GEOMETRY.bana, { cells: 38, lines: 25 });
});

test('the presets include US braille paper as well as the UK sizes, the current standard\'s first', () => {
  const ids = PAGE_SIZE_PRESETS.map((p) => p.id);
  for (const id of ['us-38x25', 'us-40x25', 'uk-38x27', 'uk-40x27', 'uk-28x27', 'uk-30x27']) assert.ok(ids.includes(id), id);
  assert.deepEqual(UK_PAGE_SIZE_PRESETS.map((p) => p.id), ['uk-38x27', 'uk-40x27', 'uk-28x27', 'uk-30x27']);
  assert.ok(presetsFor('bana').slice(0, 2).every((p) => p.id.startsWith('us-')), presetsFor('bana').map((p) => p.id).join());
  assert.ok(presetsFor('ukaaf').slice(0, 4).every((p) => p.id.startsWith('uk-')), presetsFor('ukaaf').map((p) => p.id).join());
  assert.equal(presetsFor('bana').length, PAGE_SIZE_PRESETS.length);
  const us = PAGE_SIZE_PRESETS.find((p) => p.id === 'us-40x25');
  assert.deepEqual([us.cells, us.lines], [40, 25]);
  assert.match(us.label, /11 × 11½ in/);
});

test('the preset matching the current Cells / Lines is found; none matching is a custom size', () => {
  assert.equal(presetIdFor(38, 25), 'us-38x25');
  assert.equal(presetIdFor(40, 25), 'us-40x25');
  assert.equal(presetIdFor('38', '27'), 'uk-38x27');
  assert.equal(presetIdFor(33, 25), '');
});

test('first run: the standard follows the browser region, else the time zone', () => {
  assert.equal(machineStandard({ languages: ['en-US'] }), 'bana');
  assert.equal(machineStandard({ languages: ['en-CA', 'fr-CA'] }), 'bana');
  assert.equal(machineStandard({ languages: ['es-US'] }), 'bana');
  assert.equal(machineStandard({ languages: ['en-GB'] }), 'ukaaf');
  assert.equal(machineStandard({ languages: ['en-IE'] }), 'ukaaf');
  assert.equal(machineStandard({ languages: ['en', 'en-GB'] }), 'ukaaf', 'the first language that names a region decides');
  assert.equal(machineStandard({ languages: ['en'] }, 'America/Chicago'), 'bana');
  assert.equal(machineStandard({ languages: ['en'] }, 'Europe/London'), 'ukaaf');
  assert.equal(machineStandard({ language: 'en-US' }), 'bana', 'navigator.language alone');
  assert.equal(machineStandard(null, undefined), 'ukaaf', 'no browser at all (Node): the built-in default');
});

test('first run: the chosen standard and its page size are saved, and later runs keep them', () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const had = { localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  const setNav = (languages) => Object.defineProperty(globalThis, 'navigator', { value: { languages, language: languages[0] }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  try {
    setNav(['en-US']);
    const first = loadSettings();
    assert.deepEqual([first.mode, first.cells, first.lines], ['bana', 38, 25]);
    assert.equal(JSON.parse(store.get('emboss-settings')).mode, 'bana', 'saved at once');
    setNav(['en-GB']);
    assert.equal(loadSettings().mode, 'bana', 'a later run keeps what the first run chose');
  } finally {
    for (const [k, d] of Object.entries(had)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
});
