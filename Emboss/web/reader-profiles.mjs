// Reader profiles for relaxed braille (A91, Stage 2; Paul 3 Oct 2026). A profile is a name and the list of contractions a reader has
// learned (catalogue keys, format/relaxed-signs.mjs). Emboss spells out every other contraction (format/relaxed-braille.mjs).
//
// PAUL, 2 Nov 2026: "relaxed braille is part of the template (one name)". Reader profiles are no longer separately named things: a
// template holds the ticks (web/templates.mjs, web/contractions-ui.mjs), and the ticks in force are the setting `contractions` of
// web/settings.mjs. THIS STORE IS NOW USED ONLY ONCE: web/templates.mjs adoptReaderProfiles reads the profiles an earlier preview
// stored (below) and makes each one a template. Nothing writes these two keys any more; they are left in place, never deleted.
// What this file still gives the rest of Emboss are the pure helpers at the top (cleanKeys, cleanContractions, describeCells,
// groupTickState). The old decisions, for the record: B saved, loaded, edited and deleted from Settings; C on THIS computer only
// (no export - replaced: a template, with its ticks, is exported); D not saved with a document (replaced: the document records its
// template and the template's ticks); E no reading-scheme presets; J "All" is full contracted braille.
//
// STORAGE (two localStorage values, read by the one-time migration):
//   emboss-reader-profiles  {"v":1,"profiles":[{"name":"Sam – Dot-to-Dot 6","keys":["strong_contractions:ch", ...]}, ...]}
//   emboss-reader-profile   the name of the profile in use, as plain text; absent = All
// Damaged or missing data means "no profiles, All in use"; keys outside the catalogue are dropped. With no usable storage the store
// works in memory for the page.
//
// Pure: no DOM. The storage is passed in (a Storage-like object, null for memory only, or - by default - the page's localStorage).
import { UEB_CONTRACTION_SIGNS } from '../format/relaxed-signs.mjs';

export const PROFILES_KEY = 'emboss-reader-profiles';
export const ACTIVE_KEY = 'emboss-reader-profile';
export const ALL_NAME = 'All';
export const MAX_NAME = 60;

const ALL_KEYS = UEB_CONTRACTION_SIGNS.map((s) => s.key);
const ORDER = new Map(ALL_KEYS.map((k, i) => [k, i]));

/** The keys that are in the catalogue, once each, in catalogue order. Accepts an array or a Set; anything else is "none". */
export function cleanKeys(keys) {
  if (!keys || typeof keys[Symbol.iterator] !== 'function' || typeof keys === 'string') return [];
  const seen = new Set();
  for (const k of keys) if (typeof k === 'string' && ORDER.has(k)) seen.add(k);
  return [...seen].sort((a, b) => ORDER.get(a) - ORDER.get(b));
}

/**
 * The ticks of a template (Paul, 2 Nov 2026): null = All (every contraction: ordinary braille), else the sorted list of catalogue keys the
 * reader holds (an empty list = none ticked: every contraction spelled out). Anything that is not a list is All; a list with every key is All.
 */
export function cleanContractions(value) {
  if (value == null || typeof value === 'string' || typeof value[Symbol.iterator] !== 'function') return null;
  const keys = cleanKeys(value);
  return keys.length === ALL_KEYS.length ? null : keys;
}
/** The ticks as what makeTranslators(louis, table, { relaxed }) takes: a Set of keys, or null for All. */
export function contractionsSet(value) {
  const c = cleanContractions(value);
  return c ? new Set(c) : null;
}
/** How many contractions are ticked (All = every one), and how many there are. */
export function contractionsCount(value) { const c = cleanContractions(value); return c ? c.length : ALL_KEYS.length; }
export const CONTRACTIONS_TOTAL = ALL_KEYS.length;

/** A profile name as stored: control characters and runs of spaces become one space, then trimmed. */
export function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
}

/**
 * Why `name` cannot be used, or null: 'empty', 'reserved' (All, any case), 'toolong', 'duplicate' (another profile has it, any case).
 * `except` is the profile's own current name when renaming, so only changing the case of its own name is allowed.
 */
export function nameProblem(name, existingNames, except = null) {
  const n = cleanName(name);
  if (!n) return 'empty';
  if (n.toLowerCase() === ALL_NAME.toLowerCase()) return 'reserved';
  if ([...n].length > MAX_NAME) return 'toolong';
  const exceptLower = except == null ? null : cleanName(except).toLowerCase();
  for (const e of existingNames || []) {
    const el = cleanName(e).toLowerCase();
    if (el === n.toLowerCase() && el !== exceptLower) return 'duplicate';
  }
  return null;
}

/** The dots of one braille cell (Unicode braille), e.g. '⠡' -> [1, 6]. */
function dotsOf(ch) {
  const code = ch.codePointAt(0) - 0x2800;
  const dots = [];
  if (code < 0 || code > 0xff) return dots;
  for (let i = 0; i < 6; i++) if (code & (1 << i)) dots.push(i + 1);
  return dots;
}
/** A spoken description of braille cells: '⠡' -> 'dots 1 6'; '⠐⠙' -> 'dot 5, then dots 1 4 5'. */
export function describeCells(cells) {
  return [...String(cells || '')].map((ch) => {
    const d = dotsOf(ch);
    return d.length === 0 ? 'blank' : `${d.length === 1 ? 'dot' : 'dots'} ${d.join(' ')}`;
  }).join(', then ');
}

/** 'all', 'none' or 'some' of a group's signs are in `keys` (a Set). Drives the group checkbox and its mixed state. */
export function groupTickState(keys, group) {
  let n = 0;
  for (const s of group.signs) if (keys.has(s.key)) n++;
  return n === 0 ? 'none' : (n === group.signs.length ? 'all' : 'some');
}

function parseProfiles(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  let data;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.profiles)) return [];
  const out = [];
  const seen = new Set();
  for (const p of data.profiles) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string') continue;
    const name = cleanName(p.name);
    if (nameProblem(name, []) ) continue;                       // empty, All, too long
    if (seen.has(name.toLowerCase())) continue;                 // a duplicate keeps the first
    seen.add(name.toLowerCase());
    out.push({ name, keys: cleanKeys(p.keys) });
  }
  return out;
}

/**
 * The store. `storage`: omitted = the page's localStorage (looked up at each call), a Storage-like object, or null = memory only.
 */
export function createProfileStore(storage) {
  const getStorage = storage === undefined ? () => globalThis.localStorage : () => storage;
  const mem = new Map();
  const getStore = () => { try { return getStorage() || null; } catch { return null; } };
  const read = (k) => {
    const st = getStore();
    if (st) { try { return st.getItem(k); } catch { /* unreadable: fall through to memory */ } }
    return mem.has(k) ? mem.get(k) : null;
  };
  // true = stored; false = the storage is readable but refused the write (full, or write-blocked)
  const write = (k, v) => {
    const st = getStore();
    if (!st) { mem.set(k, v); return true; }
    try { st.setItem(k, v); mem.delete(k); return true; } catch { /* below */ }
    try { st.getItem(k); return false; } catch { mem.set(k, v); return true; }
  };
  const erase = (k) => {
    mem.delete(k);
    const st = getStore();
    if (st) { try { st.removeItem(k); } catch { /* nothing to do */ } }
  };

  const profiles = () => parseProfiles(read(PROFILES_KEY));
  const writeProfiles = (list) => write(PROFILES_KEY, JSON.stringify({ v: 1, profiles: list.map((p) => ({ name: p.name, keys: p.keys })) }));
  const isAll = (name) => cleanName(name).toLowerCase() === ALL_NAME.toLowerCase();
  const allProfile = () => ({ name: ALL_NAME, keys: [...ALL_KEYS], locked: true });
  const withLocked = (p) => ({ name: p.name, keys: [...p.keys], locked: false });

  let memo = { sig: null, value: null };
  const store = {
    /** All first, then the saved profiles in the order they were made: [{ name, keys, locked }]. */
    list() { return [allProfile(), ...profiles().map(withLocked)]; },
    names() { return store.list().map((p) => p.name); },
    get(name) { return store.list().find((p) => p.name === name) || null; },
    /** The name of the profile in use: All unless a saved profile of that name exists. */
    activeName() {
      const a = read(ACTIVE_KEY);
      return a && profiles().some((p) => p.name === a) ? a : ALL_NAME;
    },
    /** Make a profile the one in use. false (and nothing changes) if there is no such profile. */
    setActive(name) {
      if (name === ALL_NAME) { erase(ACTIVE_KEY); return true; }
      if (!profiles().some((p) => p.name === name)) return false;
      return write(ACTIVE_KEY, name);
    },
    /** The profile in use as what makeTranslators takes: a Set of keys, or null for All. The same Set while nothing has changed. */
    activeKeys() {
      const rawP = read(PROFILES_KEY), rawA = read(ACTIVE_KEY);
      const sig = `${rawP}\u0000${rawA}`;
      if (memo.sig === sig) return memo.value;
      const a = rawA && parseProfiles(rawP).find((p) => p.name === rawA);
      memo = { sig, value: a ? new Set(a.keys) : null };
      return memo.value;
    },
    /** Replace the contractions of a saved profile. { ok } or { ok: false, error: 'locked' | 'missing' | 'storage' }. */
    save(name, keys) {
      if (isAll(name)) return { ok: false, error: 'locked' };
      const list = profiles();
      const p = list.find((x) => x.name === name);
      if (!p) return { ok: false, error: 'missing' };
      p.keys = cleanKeys(keys);
      return writeProfiles(list) ? { ok: true } : { ok: false, error: 'storage' };
    },
    /** Make a new profile. { ok, name } (the cleaned name) or { ok: false, error: 'empty' | 'reserved' | 'toolong' | 'duplicate' | 'storage' }. */
    saveAs(name, keys) {
      const list = profiles();
      const problem = nameProblem(name, list.map((p) => p.name));
      if (problem) return { ok: false, error: problem };
      const clean = cleanName(name);
      list.push({ name: clean, keys: cleanKeys(keys) });
      return writeProfiles(list) ? { ok: true, name: clean } : { ok: false, error: 'storage' };
    },
    /** Give a saved profile a new name (the profile in use stays in use). */
    rename(oldName, newName) {
      if (isAll(oldName)) return { ok: false, error: 'locked' };
      const list = profiles();
      const p = list.find((x) => x.name === oldName);
      if (!p) return { ok: false, error: 'missing' };
      const problem = nameProblem(newName, list.map((x) => x.name), oldName);
      if (problem) return { ok: false, error: problem };
      const wasActive = read(ACTIVE_KEY) === oldName;
      p.name = cleanName(newName);
      if (!writeProfiles(list)) return { ok: false, error: 'storage' };
      if (wasActive) write(ACTIVE_KEY, p.name);
      return { ok: true, name: p.name };
    },
    /** Delete a saved profile. If it was in use, All is. */
    remove(name) {
      if (isAll(name)) return { ok: false, error: 'locked' };
      const list = profiles();
      const i = list.findIndex((x) => x.name === name);
      if (i < 0) return { ok: false, error: 'missing' };
      const wasActive = read(ACTIVE_KEY) === name;
      list.splice(i, 1);
      if (!writeProfiles(list)) return { ok: false, error: 'storage' };
      if (wasActive) erase(ACTIVE_KEY);
      return { ok: true };
    },
  };
  return store;
}

/** The page's own store (localStorage, looked up at each call). */
export const readerProfiles = createProfileStore();
