// Audit batch S4 (Emboss/docs/chatgpt-audit-15oct.md, items #29 and #30): the REAL web/sw.js is loaded into a small harness
// (mocked self, caches, fetch, Request) and its install, activate and fetch handlers are run.
//   #29 activation deleted every cache not equal to the current one, including other applications' caches on the same origin;
//       and the fetch handler searched every cache on the origin (caches.match) instead of its own.
//   #30 install succeeded even if every required asset failed (each precache error was caught and logged), so a later
//       activation could delete the previous, working cache.
// EMBOSS_SW=<path> runs the same tests against another copy of the worker (a built dist/sw.js, or the pre-change copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SW_PATH = process.env.EMBOSS_SW || fileURLToPath(new URL('../web/sw.js', import.meta.url));
const SRC = readFileSync(SW_PATH, 'utf8');
const ORIGIN = 'https://emboss.test';

class MockRequest {
  constructor(input, init = {}) { this.url = typeof input === 'string' ? new URL(input, ORIGIN).href : input.url; this.method = init.method || 'GET'; this.mode = init.mode || 'cors'; this.cache = init.cache; }
}
const pathOf = (u) => new URL(u).pathname;
const keyOf = (r, ignoreSearch) => { const u = new URL(typeof r === 'string' ? new URL(r, ORIGIN).href : r.url); return ignoreSearch ? u.origin + u.pathname : u.href; };

// An in-memory CacheStorage. `failOpen` makes caches.open reject (cache storage itself failing).
function makeCaches(initial = {}) {
  const store = new Map();
  const makeCache = (name) => ({
    name,
    async add(req) { const res = await env.fetch(req); if (!res || !res.ok) throw new TypeError('Request failed ' + keyOf(req)); store.get(name).set(keyOf(req), res); },
    async put(req, res) { store.get(name).set(keyOf(req), res); },
    async match(req, opts = {}) { const m = store.get(name); if (!m) return undefined; if (!opts.ignoreSearch) return m.get(keyOf(req)); for (const [k, v] of m) if (k.split('?')[0] === keyOf(req, true)) return v; return undefined; },
  });
  for (const [n, entries] of Object.entries(initial)) store.set(n, new Map(Object.entries(entries).map(([u, body]) => [keyOf(u), { ok: true, body, clone() { return this; } }])));
  const api = {
    store, failOpen: false,
    async open(name) { if (api.failOpen) throw new Error('QuotaExceededError'); if (!store.has(name)) store.set(name, new Map()); return makeCache(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    async match(req, opts = {}) { for (const n of store.keys()) { const hit = await makeCache(n).match(req, opts); if (hit) return hit; } return undefined; },
  };
  return api;
}

const env = { fetch: null };

// Loads the worker. `failing` maps a URL path to how many fetches of it should fail (Infinity = always).
function loadWorker({ caches = makeCaches(), failing = {}, net = {} } = {}) {
  const handlers = {};
  const attempts = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { self.skipped = true; },
    clients: { claim: async () => { self.claimed = true; } },
  };
  env.fetch = async (req) => {
    const p = pathOf(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);
    attempts[p] = (attempts[p] || 0) + 1;
    if ((failing[p] || 0) >= attempts[p]) throw new TypeError('Failed to fetch ' + p);
    if (p in net) return { ok: true, body: net[p], clone() { return this; } };
    return { ok: true, body: 'body of ' + p, clone() { return this; } };
  };
  const ctx = vm.createContext({ self, caches, fetch: (r) => env.fetch(r), Request: MockRequest, URL, console: { warn() {}, log() {}, error() {} }, setTimeout, clearTimeout, Promise });   // clearTimeout: sw.js's shell wait (18 Oct 2026; a service worker has both)
  const { CACHE, ASSETS } = vm.runInContext(SRC + '\n;({ CACHE, ASSETS })', ctx);
  const dispatch = async (type, ev = {}) => { let p; ev.waitUntil = (x) => { p = x; }; handlers[type](ev); return p; };
  return { self, caches, CACHE, ASSETS, attempts, handlers, install: () => dispatch('install'), activate: () => dispatch('activate'),
    fetchEvent: (url, extra = {}) => { let p; const ev = { request: new MockRequest(url, extra), respondWith: (x) => { p = x; } }; handlers.fetch(ev); return p; } };
}

const rooted = (w, re) => w.ASSETS.find((u) => re.test(u));

// ---------------- #29 ----------------
test('#29: activation deletes only OLD Emboss caches (prefix emboss-), never another application\'s', async () => {
  const w0 = loadWorker();
  const old = 'emboss-oldbuild1';
  const caches = makeCaches({ [w0.CACHE]: {}, [old]: {}, 'emboss-v1': {}, 'unrelated-app-cache': {}, 'translate-v226': {}, 'xemboss-lookalike': {}, 'workbox-precache': {} });
  const w = loadWorker({ caches });
  await w.activate();
  const left = [...caches.store.keys()].sort();
  assert.deepEqual(left, [w.CACHE, 'translate-v226', 'unrelated-app-cache', 'workbox-precache', 'xemboss-lookalike'].sort());
  assert.ok(w.self.claimed, 'still takes over the open pages (clients.claim)');
});

test('#29: the fetch handler answers from its own cache, not from other caches on the origin', async () => {
  const probe = loadWorker();
  const wasm = rooted(probe, /liblouis-wasm\.wasm$/);
  const shell = rooted(probe, /index\.html$/);
  const caches = makeCaches({
    [probe.CACHE]: {},
    'emboss-previous': { [wasm]: 'OLD BUILD WASM', [shell]: 'OLD SHELL' },
    'unrelated-app-cache': { [wasm]: 'FOREIGN WASM', [shell]: 'FOREIGN SHELL' },
  });
  // cache-first branch (WASM): a hit in someone else's cache must not be served
  let w = loadWorker({ caches, net: { [wasm]: 'NEW WASM' } });
  let res = await w.fetchEvent(wasm);
  assert.equal(res.body, 'NEW WASM');
  // shell branch offline: only the worker's own cache may answer
  w = loadWorker({ caches, failing: { [shell]: Infinity } });
  const miss = await w.fetchEvent(shell, { mode: 'navigate' }).catch(() => undefined);
  assert.ok(!miss, 'nothing from another cache (a miss, so the browser shows its offline error)');
  // and its own cache does answer, offline and online
  const own = makeCaches({ [probe.CACHE]: { [wasm]: 'OWN WASM', [shell]: 'OWN SHELL' }, 'unrelated-app-cache': { [wasm]: 'FOREIGN WASM' } });
  w = loadWorker({ caches: own });
  assert.equal((await w.fetchEvent(wasm)).body, 'OWN WASM');
  w = loadWorker({ caches: own, failing: { [shell]: Infinity } });
  assert.equal((await w.fetchEvent(shell, { mode: 'navigate' })).body, 'OWN SHELL');
});

// ---------------- #30 ----------------
test('#30: the required / optional split — the app shell, engine and default tables are required; fonts and sounds are not', () => {
  const w = loadWorker();
  // (the failure tests below prove each of these is required; this proves the precache list names them)
  for (const re of [/index\.html$/, /editor\/index\.html$/, /liblouis-wasm\.wasm$/, /liblouis-wasm\.js$/, /emboss_mathcat_bg\.wasm$/, /en-ueb-g2\.ctb$/, /en-ueb-math\.ctb$/, /en\.json$/, /editor\.mjs$/, /app\.mjs$/]) {
    assert.ok(w.ASSETS.some((u) => re.test(u)), 'precache lists ' + re);
  }
});

async function failureOf(failing) {
  const caches = makeCaches({ 'emboss-previous': { '/index.html': 'PREVIOUS SHELL' } });
  const w = loadWorker({ caches, failing });
  let error = null;
  try { await w.install(); } catch (e) { error = e; }
  return { error, caches, w };
}

test('#30: a required asset that fails once is retried and the install succeeds', async () => {
  const probe = loadWorker();
  for (const re of [/index\.html$/, /liblouis-wasm\.wasm$/, /en-ueb-g2\.ctb$/, /emboss_mathcat_bg\.wasm$/, /editor\.mjs$/]) {
    const u = rooted(probe, re);
    const { error, caches, w } = await failureOf({ [u]: 1 });
    assert.equal(error, null, `${u} failing once must not fail the install`);
    assert.equal(w.attempts[u], 2, 'fetched twice');
    assert.ok(caches.store.get(w.CACHE).has(keyOf(u)), 'and cached');
  }
});

test('#30: a required asset that always fails makes the install fail and leaves the previous cache alone', async () => {
  const probe = loadWorker();
  for (const re of [/index\.html$/, /editor\/index\.html$/, /editor\.mjs$/, /liblouis-wasm\.wasm$/, /liblouis-wasm\.js$/, /emboss_mathcat_bg\.wasm$/, /en-ueb-g2\.ctb$/, /en\.json$/]) {
    const u = rooted(probe, re);
    const { error, caches, w } = await failureOf({ [u]: Infinity });
    assert.ok(error, `${u} always failing must reject the install`);
    assert.equal(w.attempts[u], 2, 'retried exactly once before giving up');
    assert.ok(caches.store.has('emboss-previous'), 'previous cache kept');
    assert.equal(caches.store.get('emboss-previous').size, 1);
  }
});

test('#30: every required asset failing makes the install fail', async () => {
  const probe = loadWorker();
  const failing = Object.fromEntries(probe.ASSETS.map((u) => [u, Infinity]));
  const { error, caches } = await failureOf(failing);
  assert.ok(error, 'install must reject');
  assert.ok(caches.store.has('emboss-previous'));
});

test('#30: cache storage itself failing makes the install fail', async () => {
  const caches = makeCaches({ 'emboss-previous': {} });
  caches.failOpen = true;
  const w = loadWorker({ caches });
  await assert.rejects(() => w.install());
  assert.ok(caches.store.has('emboss-previous'));
});

test('#30: an optional asset (MathLive font / sound, page font) that always fails does not block the install', async () => {
  const probe = loadWorker();
  const optional = probe.ASSETS.filter((u) => /\.(woff2?|ttf|wav)$/.test(u));
  const wanted = optional.length ? optional : ['/web/fonts/inter-latin.woff2'];
  assert.ok(optional.length > 0, 'the worker precaches some fonts');
  const { error, caches, w } = await failureOf(Object.fromEntries(wanted.map((u) => [u, Infinity])));
  assert.equal(error, null);
  const cached = caches.store.get(w.CACHE);
  for (const u of w.ASSETS) if (!wanted.includes(u)) assert.ok(cached.has(keyOf(u)), u + ' cached');
  for (const u of wanted) assert.ok(!cached.has(keyOf(u)), u + ' skipped');
});

test('#30: a fully working install caches every asset, and a new build still takes over on request (SKIP_WAITING)', async () => {
  const { error, caches, w } = await failureOf({});
  assert.equal(error, null);
  assert.equal(caches.store.get(w.CACHE).size, new Set(w.ASSETS).size);
  assert.ok(!w.self.skipped, 'no automatic skipWaiting at install (the page asks via the toast)');
  w.handlers.message({ data: { type: 'SKIP_WAITING' } });
  assert.ok(w.self.skipped);
});
