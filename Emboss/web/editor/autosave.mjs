// Emboss editor: autosave & crash recovery (Fable review #7, docs/fable-review-26sep.md; one
// backup per tab since A80, 1 Oct 2026).
//
// Before this, the editor's only safety net against losing unsaved work was the beforeunload
// guard in editor.mjs (window.confirm on close) — no help at all against a crash, a killed tab
// or an accidental "Leave" that the guard doesn't catch. This module snapshots the current
// document (the same NIMAS XML editor.mjs's own Save writes, plus its loaded image resources,
// title and package/xml metadata) to IndexedDB roughly every 30s and on visibilitychange→hidden
// / pagehide, but ONLY while the document is dirty — see editor.mjs's isDocumentDirty(). On the
// next load, if a backup is still there (it is deleted on every explicit save or Clear — see
// clearSnapshot()), that means a session ended dirty: checkForRecovery() offers
// "Recover unsaved work from <time>?" before the document loads.
//
// ONE BACKUP PER TAB (A80). Before, every editor tab of the origin shared one record, so a second
// tab offered to recover the first tab's live work and whichever tab saved last overwrote the
// other's backup. Now:
//   * Each tab has an id, kept in sessionStorage (it survives a reload of that tab; a new tab gets
//     a new one). Its backup is the IndexedDB record `doc:<tabId>` ({ tabId, snapshots }) in db
//     `emboss_autosave_db` / store `autosave_store` — a tab only ever writes or deletes its own.
//     The record holds the same small ring buffer of up to MAX_SNAPSHOTS entries, newest first
//     (a second chance if the very latest write was itself interrupted and fails to parse back).
//   * An open tab says so. Primary: it holds a Web Lock named `emboss-autosave-tab:<tabId>` for
//     the life of the page; navigator.locks.query() lists every held lock, so "is tab X open?" is
//     answered exactly, and the browser releases the lock the moment the page goes (closed,
//     crashed, killed) — no timers, so a tab throttled or hung in the background still counts as
//     open. Fallback where Web Locks do not exist (insecure contexts such as a LAN http address,
//     very old browsers): a localStorage heartbeat `emboss-autosave-alive:<tabId>` refreshed every
//     HEARTBEAT_MS and removed on pagehide; a heartbeat younger than HEARTBEAT_TTL_MS counts as open.
//   * Recovery is offered only for a backup no OTHER open tab owns: this tab's own backup after a
//     reload (offered first), then backups of tabs that are gone, newest first. One is offered at
//     a time; Discard drops that one and moves on to the next, Recover loads it and stops (the
//     rest are kept and offered at the next start — never deleted unseen, except that a backup
//     whose newest snapshot is older than ORPHAN_MAX_AGE_MS is cleared). Recovering another tab's
//     backup moves it (one atomic transaction) to this tab's own key. A short-lived `claim:<key>`
//     record, valid only while its claimant tab is open, stops two tabs that start at the same
//     moment (a browser session restore) from both offering the same backup.
//   * Escape or a click outside the message (S5c / D1, Paul 15 Oct 2026) is "not now": the message closes, the backup is KEPT (a
//     backup of this tab's own is moved to a record of its own so editing cannot push it out; see keepBackup()) and no further
//     backup is offered until the next load. Only the Discard button deletes a backup.
//   * clearSnapshot() (explicit save, Clear, a new file loaded) removes this tab's own backup only.
//   * The single record this module used to keep (`current_doc`) is still read: offered once, as
//     a backup no tab owns, then removed (Recover moves it to the tab's own key like any other).
//   * A duplicated tab (Chrome copies sessionStorage) finds its id's lock already held and takes a
//     fresh id, so two live tabs never share a backup key. (With the heartbeat fallback this cannot
//     be told apart from a reload within the heartbeat window, so it is not attempted: there a
//     duplicated tab shares its original's key until it is reloaded.)
//
// Not a document-lifetime lock: a tab that Chrome discards or freezes (Memory Saver) has no page
// and no lock, so from then on its backup looks abandoned and a newly opened tab may be offered
// it. That never loses work (the offer is a Recover/Discard choice; the discarded tab, when
// revisited, reloads and is offered its own backup if nobody took it first).
//
// Decoupled from editor.mjs on purpose (Lexical/editor internals never appear here) so it stays
// a self-contained module: editor.mjs supplies small callbacks (isDirty, isLoading, buildSnapshot)
// instead of this module reaching into editor state directly.

import { parseFile } from '/input/parse.mjs';
import { t } from '/web/i18n.mjs';   // same specifier as editor.mjs's own import, so both share the one initialised i18n module instance

const DB_NAME = 'emboss_autosave_db';
const DB_VERSION = 1;
const STORE_NAME = 'autosave_store';
const LEGACY_KEY = 'current_doc';                  // the single shared record this module kept before A80
const DOC_PREFIX = 'doc:';                         // `doc:<tabId>` — one backup per tab
const CLAIM_PREFIX = 'claim:';                     // `claim:<record key>` — "this tab is offering that backup right now"

const TAB_ID_STORAGE_KEY = 'emboss-autosave-tab-id';        // sessionStorage: this tab's id
const LOCK_PREFIX = 'emboss-autosave-tab:';                 // Web Lock held by every open editor tab
const ALIVE_PREFIX = 'emboss-autosave-alive:';              // localStorage heartbeat (no-Web-Locks fallback)

export const AUTOSAVE_INTERVAL_MS = 30000;
// A89 step 3 (Paul, 2 Oct: never lose work): a crashed or frozen tab runs no closing code, so the 30 s timer alone could lose
// up to 30 s of typing. Each change now also asks for a backup AUTOSAVE_QUIET_MS after the typing pauses (as Google Docs and
// Word's AutoSave do, within seconds), and no later than AUTOSAVE_MAX_WAIT_MS after the first unsaved change however long the
// typing goes on (Paul, 2 Oct: 30 s is enough for that rare case). A backup of the large book takes ~140 ms.
export const AUTOSAVE_QUIET_MS = 2000;
export const AUTOSAVE_MAX_WAIT_MS = 30000;
const MAX_SNAPSHOTS = 3;                          // ring buffer: a fallback if the newest write is itself corrupt
const MAX_RESOURCE_BYTES = 20 * 1024 * 1024;       // per-snapshot cap on embedded image bytes (quota safety valve)
const ORPHAN_MAX_AGE_MS = 30 * 24 * 3600 * 1000;   // an abandoned backup older than this is cleared (A80 decision: 30 days, not 7 — err towards keeping work)
const HEARTBEAT_MS = 10000;                        // fallback only. Background tabs are throttled to ~1 timer a minute,
const HEARTBEAT_TTL_MS = 150000;                   //   so the TTL has to outlast that or a hidden-but-open tab looks closed.
const OWN_LOCK_WAIT_MS = 1500;                     // a reload's old page may still hold the tab's lock for a moment

// 18 Oct 2026 (Paul: "sometimes Emboss doesn't let me go back to Quick Mode and won't reload properly"): a browser can leave an IndexedDB open
// unanswered (Safari does, now and then; or another tab blocks it), and everything waiting on it waited for ever - the Quick Mode button did
// nothing, and the editor never finished loading. The open now gives up after OPEN_TIMEOUT_MS (or at once when the browser says it is
// blocked) and its callers carry on without it.
const OPEN_TIMEOUT_MS = 4000;
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
    let settled = false;
    const fail = (err) => { if (settled) return; settled = true; dbPromise = null; reject(err); };   // the next call tries again
    const timer = setTimeout(() => fail(new Error('IndexedDB did not answer')), OPEN_TIMEOUT_MS);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onblocked = () => { clearTimeout(timer); fail(new Error('IndexedDB is blocked by another tab')); };
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) idb.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => {
      const idb = e.target.result;
      if (settled) { try { idb.close(); } catch { /* */ } return; }   // too late: it was given up on
      settled = true; clearTimeout(timer);
      idb.onversionchange = () => { idb.close(); dbPromise = null; };   // never block a deleteDatabase / upgrade from another tab
      idb.onclose = () => { dbPromise = null; };
      resolve(idb);
    };
    req.onerror = (e) => { clearTimeout(timer); fail(e.target.error); };
  });
  return dbPromise;
}

// Runs `work(store, done)` in one transaction; resolves with whatever `work` passes to done()
// once the transaction has COMMITTED (so a resolved write is a durable write). `work` must only
// issue IndexedDB requests (no awaiting anything else, or the transaction would auto-commit).
async function withStore(mode, work) {
  const idb = await openDb();
  return new Promise((resolve, reject) => {
    let result;
    const tx = idb.transaction(STORE_NAME, mode);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('autosave transaction aborted'));
    work(tx.objectStore(STORE_NAME), (v) => { result = v; });
  });
}

const getRecord = (key) => withStore('readonly', (s, done) => { const r = s.get(key); r.onsuccess = () => done(r.result || null); });
const listKeys = () => withStore('readonly', (s, done) => { const r = s.getAllKeys(); r.onsuccess = () => done(r.result || []); });
const putRecord = (key, rec) => withStore('readwrite', (s) => { s.put(rec, key); });
const deleteKeys = (keys) => withStore('readwrite', (s) => { for (const k of keys) s.delete(k); });

// ---- Tab identity & "is that tab open?" ---------------------------------------------------

let identityPromise = null;
let myTabId = null;
let liveMode = 'locks';             // 'locks' | 'heartbeat'

function newTabId() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function readStoredTabId() {
  try {
    const v = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
    return v && /^[\w-]{6,80}$/.test(v) ? v : null;
  } catch { return null; }
}
function storeTabId(id) { try { sessionStorage.setItem(TAB_ID_STORAGE_KEY, id); } catch { /* an in-memory id still works for this page's life */ } }

// Tries to take the tab's lock and hold it for the life of the page. Resolves true if taken,
// false if another page already holds it; rejects if Web Locks cannot be used at all.
function tryHoldLock(tabId) {
  return new Promise((resolve, reject) => {
    try {
      navigator.locks.request(LOCK_PREFIX + tabId, { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return undefined; }
        resolve(true);
        return new Promise(() => {});      // never settles: the browser releases the lock when the page goes
      }).catch(reject);
    } catch (e) { reject(e); }
  });
}

function beat(tabId) { try { localStorage.setItem(ALIVE_PREFIX + tabId, String(Date.now())); } catch { /* storage blocked — no fallback liveness */ } }
function startHeartbeat(tabId) {
  beat(tabId);
  setInterval(() => beat(tabId), HEARTBEAT_MS);
  window.addEventListener('pagehide', () => { try { localStorage.removeItem(ALIVE_PREFIX + tabId); } catch { /* best effort */ } });
  window.addEventListener('pageshow', (e) => { if (e.persisted) beat(tabId); });   // restored from the back/forward cache
}

// Idempotent. Resolves to this tab's id once the tab has said it is open (so anything that
// asks "who is open?" afterwards sees it).
function establishIdentity() {
  if (identityPromise) return identityPromise;
  identityPromise = (async () => {
    let id = readStoredTabId() || newTabId();
    let held = false;
    if (globalThis.navigator && navigator.locks && typeof navigator.locks.request === 'function') {
      try {
        // A reload's old page can still be releasing the tab's lock when this one starts: wait
        // briefly for it before deciding the id is genuinely held by another live tab (a
        // duplicated tab, whose sessionStorage — and so id — was copied from a tab still open).
        const deadline = Date.now() + OWN_LOCK_WAIT_MS;
        for (;;) {
          held = await tryHoldLock(id);
          if (held || Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!held) { id = newTabId(); held = await tryHoldLock(id); }
      } catch (e) {
        console.warn('[autosave] Web Locks unusable — using the heartbeat fallback:', e);
        held = false;
      }
    }
    liveMode = held ? 'locks' : 'heartbeat';
    if (!held) startHeartbeat(id);
    myTabId = id;
    storeTabId(id);
    return id;
  })();
  return identityPromise;
}

// The tab ids of every open editor tab (this one included).
async function liveTabIds() {
  const live = new Set();
  if (liveMode === 'locks') {
    try {
      const q = await navigator.locks.query();
      for (const l of (q && q.held) || []) {
        if (l && typeof l.name === 'string' && l.name.startsWith(LOCK_PREFIX)) live.add(l.name.slice(LOCK_PREFIX.length));
      }
    } catch (e) { console.warn('[autosave] navigator.locks.query failed:', e); }
  } else {
    try {
      const now = Date.now();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(ALIVE_PREFIX)) continue;
        const ts = Number(localStorage.getItem(k));
        if (Number.isFinite(ts) && now - ts < HEARTBEAT_TTL_MS) live.add(k.slice(ALIVE_PREFIX.length));
        else localStorage.removeItem(k);          // a crashed tab's leftover heartbeat
      }
    } catch { /* storage blocked */ }
  }
  if (myTabId) live.add(myTabId);
  return live;
}

// ---- Write path ------------------------------------------------------------------------------

// Writes and clears go through one queue, in call order, so a clearSnapshot() (Save, Clear, a
// new document) can never be overtaken by an autosave write that was already in flight: the
// write finishes, then the clear removes it.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.catch(() => {}).then(fn);
  queue = run;
  return run;
}

/** Removes THIS tab's autosave backup (and only this tab's — other tabs' backups are never
 *  touched). Called after an explicit save or Clear — see the hook lines in editor.mjs
 *  (exportTextDocument's xml/package branches, btnClear, importFile). Safe to call when nothing
 *  is stored. */
export async function clearSnapshot() {
  try {
    await serial(async () => {
      const id = await establishIdentity();
      await deleteKeys([DOC_PREFIX + id]);
    });
  } catch { /* nothing stored, or storage unavailable — fine either way */ }
}

function resourceByteLength(r) {
  if (!r || !r.bytes) return 0;
  return r.bytes.byteLength ?? r.bytes.length ?? 0;
}

const warned = new Set();
function warnOnce(hooks, kind, msg) {
  if (warned.has(kind)) return;
  warned.add(kind);
  if (hooks && typeof hooks.onWarn === 'function') { try { hooks.onWarn(msg); } catch { /* a broken warning UI must not break autosave */ } }
}

let tickHooks = null;
let started = false;

// The actual snapshot write. Never runs on the keystroke path — only from the 30s interval and
// the visibilitychange/pagehide listeners below — and does nothing unless the document is
// currently dirty, so a clean document (including one with autosave simply idle) costs nothing.
async function runTick() {
  const hooks = tickHooks;
  if (!hooks) return;
  try {
    if (hooks.isLoading && hooks.isLoading()) return;      // never autosave mid-import (importFile's `importing`)
    if (!hooks.isDirty || !hooks.isDirty()) return;
    // An emptied document is nothing to recover (feedback 30 Sep item 17, Paul 2 Oct): the backup goes, rather than a backup of the
    // text the user deleted being offered again later. Undo still brings the text back while the page is open.
    if (hooks.isEmpty && hooks.isEmpty()) { await clearSnapshot(); return; }
    let snap;
    try { snap = hooks.buildSnapshot(); } catch (e) { console.warn('[autosave] buildSnapshot failed:', e); return; }
    if (!snap || typeof snap.xml !== 'string' || !snap.xml) return;

    let resources = Array.isArray(snap.resources) ? snap.resources : [];
    const totalResourceBytes = resources.reduce((n, r) => n + resourceByteLength(r), 0);
    if (totalResourceBytes > MAX_RESOURCE_BYTES) {
      // Still autosave the text — just not images too big to store safely.
      resources = [];
      warnOnce(hooks, 'images', t('app.autosave.images_skipped'));
    }

    const entry = {
      savedAt: Date.now(),
      xml: snap.xml,
      title: snap.title || null,
      metadata: snap.metadata || null,
      resources,
    };
    await serial(async () => {
      const id = await establishIdentity();
      const key = DOC_PREFIX + id;
      const rec = await getRecord(key).catch(() => null);
      const snapshots = rec && Array.isArray(rec.snapshots) ? rec.snapshots.slice(0, MAX_SNAPSHOTS - 1) : [];
      snapshots.unshift(entry);
      await putRecord(key, { tabId: id, snapshots });
    });
  } catch (e) {
    // Most likely a QuotaExceededError. The document itself is never at risk — this only ever
    // affects the IndexedDB backup — so warn once and keep the editor working normally.
    warnOnce(hooks, 'quota', t('app.autosave.quota_warning'));
    console.warn('[autosave] snapshot write failed:', e);
  }
}

/** Forces an autosave write right now (still a no-op unless the document is dirty), instead of
 *  waiting for the next 30s tick or a hide/pagehide event. Exposed on window as
 *  window.__forceAutosaveTick so Playwright tests don't have to wait out the real interval. */
export async function forceAutosaveTick() {
  return runTick();
}

let quietTimer = null;
let firstUnsavedChange = 0;
/** The document changed: a backup follows AUTOSAVE_QUIET_MS after the changes pause, or AUTOSAVE_MAX_WAIT_MS after the first
 *  change not yet backed up, whichever comes first. Cheap to call on every change. */
export function noteChange() {
  if (!started) return;
  const now = Date.now();
  if (!firstUnsavedChange) firstUnsavedChange = now;
  clearTimeout(quietTimer);
  const wait = Math.max(0, Math.min(AUTOSAVE_QUIET_MS, firstUnsavedChange + AUTOSAVE_MAX_WAIT_MS - now));
  quietTimer = setTimeout(() => { firstUnsavedChange = 0; quietTimer = null; runTick(); }, wait);
}

/** Starts the 30s timer and the visibilitychange/pagehide listeners, and marks this tab as open
 *  (so no other tab offers its backup). Call once, at startup.
 *  `hooks`: { isDirty(): bool, isLoading?(): bool, isEmpty?(): bool, buildSnapshot(): {xml, title, metadata, resources} | null, onWarn?(message) } */
export function initAutosave(hooks) {
  tickHooks = hooks || {};
  if (started) return;
  started = true;
  establishIdentity().catch((e) => console.warn('[autosave] could not establish the tab identity:', e));
  setInterval(runTick, AUTOSAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') runTick();
  });
  window.addEventListener('pagehide', () => runTick());
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function relativeTime(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins <= 0) return t('app.autosave.time_just_now');
  if (mins === 1) return t('app.autosave.time_minute_ago');
  if (mins < 60) return t('app.autosave.time_minutes_ago', { n: mins });
  try { return new Date(ts).toLocaleString(); } catch { return t('app.autosave.time_a_while_ago'); }
}

// Built and inserted only when there is actually something to recover, so a normal start-up
// (the common case) never touches the DOM for this at all. Reuses the shared .dialog / .dialog-
// body / .dialog-head / .dialog-foot / .fmt-help classes (web/style.css) that every other editor
// dialog uses, so it matches them without needing its own CSS. role="alertdialog" plus
// aria-labelledby/aria-describedby, and a native <dialog> (showModal traps focus and is announced
// by screen readers on its own) makes it keyboard- and screen-reader-usable: Tab cycles the two
// buttons, Enter activates the focused one. Escape (the dialog's native "cancel" event) and a click on the backdrop mean
// "not now": the message closes and the backup is KEPT, offered again at the next load; only the Discard button deletes it
// (S5c / D1, Paul 15 Oct 2026; before, Escape and the backdrop discarded it).
function buildDialog(timeLabel) {
  const dlg = document.createElement('dialog');
  dlg.id = 'autosaveRecoverDialog';
  dlg.className = 'dialog';
  dlg.setAttribute('role', 'alertdialog');
  dlg.setAttribute('aria-labelledby', 'autosaveRecoverTitle');
  dlg.setAttribute('aria-describedby', 'autosaveRecoverHint');
  dlg.innerHTML = `
    <div class="dialog-body">
      <div class="dialog-head">
        <h2 id="autosaveRecoverTitle">${escapeHtml(t('app.autosave.title'))}</h2>
      </div>
      <p id="autosaveRecoverHint" class="fmt-help">${escapeHtml(t('app.autosave.hint', { time: timeLabel }))}</p>
      <div class="dialog-foot" style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px; padding-top:10px; border-top:1px solid var(--line);">
        <button type="button" id="autosaveDiscardBtn">${escapeHtml(t('app.autosave.discard'))}</button>
        <button type="button" id="autosaveRecoverBtn" class="primary" autofocus>${escapeHtml(t('app.autosave.recover'))}</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  return dlg;
}

function showRecoveryDialog(savedAt) {
  return new Promise((resolve) => {
    const dlg = buildDialog(relativeTime(savedAt));
    let done = false;
    const finish = (choice) => {
      if (done) return;
      done = true;
      try { dlg.close(); } catch { /* already closed via the native cancel event */ }
      dlg.remove();
      resolve(choice);
    };
    dlg.querySelector('#autosaveRecoverBtn').addEventListener('click', () => finish('recover'));
    dlg.querySelector('#autosaveDiscardBtn').addEventListener('click', () => finish('discard'));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish('keep'); });   // Escape: close, keep the backup (S5c / D1)
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish('keep'); });  // backdrop click: the same
    dlg.showModal();
  });
}

// ---- Which backups can this tab offer? ---------------------------------------------------------

// Every stored backup that no OTHER open tab owns, as { key, own, rec, savedAt }, this tab's own
// first and then newest first. Tidies on the way: an abandoned backup past ORPHAN_MAX_AGE_MS, an
// empty/unreadable record, and a claim whose backup is gone are deleted. Backups of open tabs
// are never even read (they can be many MB).
async function findOrphans(id) {
  const [rawKeys, live] = await Promise.all([listKeys(), liveTabIds()]);
  const keys = rawKeys.map(String);
  const keySet = new Set(keys);
  const toDelete = keys.filter((k) => k.startsWith(CLAIM_PREFIX) && !keySet.has(k.slice(CLAIM_PREFIX.length)));
  const found = [];
  for (const key of keys) {
    let owner;
    if (key === LEGACY_KEY) owner = null;                       // pre-A80 single slot: no tab owns it
    else if (key.startsWith(DOC_PREFIX)) owner = key.slice(DOC_PREFIX.length);
    else continue;
    if (owner !== null && owner !== id && live.has(owner)) continue;    // another open tab's backup: not ours to offer
    let rec = null;
    try { rec = await getRecord(key); } catch { rec = null; }
    const snaps = rec && Array.isArray(rec.snapshots) ? rec.snapshots.filter((s) => s && typeof s.xml === 'string') : [];
    if (!snaps.length) { toDelete.push(key, CLAIM_PREFIX + key); continue; }
    const savedAt = Number(snaps[0].savedAt) || 0;
    if (savedAt && Date.now() - savedAt > ORPHAN_MAX_AGE_MS) { toDelete.push(key, CLAIM_PREFIX + key); continue; }
    found.push({ key, own: key === DOC_PREFIX + id, rec: { ...rec, snapshots: snaps }, savedAt });
  }
  if (toDelete.length) { try { await deleteKeys(toDelete); } catch { /* tidying is best-effort */ } }
  found.sort((a, b) => (a.own === b.own ? b.savedAt - a.savedAt : (a.own ? -1 : 1)));
  return found;
}

// Marks a backup as "being offered by this tab", unless it is gone or another OPEN tab already
// claimed it. A claim by a tab that has since closed is void. Atomic (one transaction).
async function tryClaim(key, id) {
  const live = await liveTabIds();
  return withStore('readwrite', (s, done) => {
    const exists = s.count(key);
    exists.onsuccess = () => {
      if (!exists.result) { done(false); return; }
      const cur = s.get(CLAIM_PREFIX + key);
      cur.onsuccess = () => {
        const c = cur.result;
        if (c && c.by !== id && live.has(c.by)) { done(false); return; }
        s.put({ by: id, at: Date.now() }, CLAIM_PREFIX + key);
        done(true);
      };
    };
  });
}

// The user chose Recover: the backup becomes this tab's own (moved in one transaction, so there
// is never a moment with neither copy), ahead of anything this tab already had stored.
function adoptBackup(cand, snapshots, id) {
  const own = DOC_PREFIX + id;
  return withStore('readwrite', (s) => {
    if (cand.key !== own) {
      const g = s.get(own);
      g.onsuccess = () => {
        const existing = g.result && Array.isArray(g.result.snapshots) ? g.result.snapshots : [];
        s.put({ tabId: id, snapshots: snapshots.concat(existing).slice(0, MAX_SNAPSHOTS) }, own);
        s.delete(cand.key);
      };
    }
    s.delete(CLAIM_PREFIX + cand.key);
  });
}

// The user closed the message without choosing (Escape, a click outside): the backup stays. Our claim on it is let go, and a backup
// that is THIS tab's own is moved to a key of its own, `doc:<new id>` that no open tab holds, in one transaction. Otherwise the
// first autosave of whatever is edited next would write into `doc:<this tab's id>`, push the kept backup down the MAX_SNAPSHOTS
// ring and lose it after a few writes (and an explicit Save / Clear of the new document would delete it). Moved, it is an
// ordinary abandoned backup: offered again at the next load, its own Recover / Discard, cleared only by Discard or the
// existing ORPHAN_MAX_AGE_MS rule. A backup of another tab (already not this tab's key) only loses the claim.
function keepBackup(cand) {
  return withStore('readwrite', (s) => {
    s.delete(CLAIM_PREFIX + cand.key);
    if (!cand.own) return;
    const g = s.get(cand.key);
    g.onsuccess = () => {
      const rec = g.result;
      if (!rec) return;
      const keptId = 'kept-' + newTabId();
      s.put({ ...rec, tabId: keptId }, DOC_PREFIX + keptId);
      s.delete(cand.key);
    };
  });
}

/** Call once at start-up, before deciding what to load (a Quick Mode handoff doc or the blank
 *  seed document). Resolves to a ready-to-load model (setLoadedDocInfo/modelToLexical) if the
 *  user chose to recover, or null if there was nothing to recover, the stored snapshot(s) all
 *  failed to parse, or the user chose Discard for every backup offered, or closed the message with Escape / a click outside (the backup is KEPT and
 *  offered again next time; S5c / D1).
 *  Never shows a dialog when there is nothing stored for this tab to offer (a document with no
 *  unsaved work at close, a browser start-up with no snapshot record, or only the backups of
 *  other open tabs prompts nothing). */
export async function checkForRecovery(opts = {}) {
  const { onStatus } = opts;   // optional: (message) => void, for a status line / screen-reader announcement
  let id, candidates;
  try {
    id = await establishIdentity();
    candidates = await findOrphans(id);
  } catch (e) {
    console.warn('[autosave] recovery check failed:', e);
    return null;
  }

  for (const cand of candidates) {
    let chosenIdx = -1, model = null;
    for (let i = 0; i < cand.rec.snapshots.length; i++) {
      try {
        const m = await parseFile('recovered-autosave.xml', cand.rec.snapshots[i].xml);
        if (m && Array.isArray(m.blocks) && m.blocks.length) { chosenIdx = i; model = m; break; }
      } catch (e) {
        console.warn('[autosave] a stored snapshot failed to parse — trying an older one:', e);
      }
    }
    if (!model) {   // every stored snapshot was corrupt: nothing usable to offer
      try { await deleteKeys([cand.key, CLAIM_PREFIX + cand.key]); } catch { /* best-effort */ }
      continue;
    }

    let claimed = false;
    try { claimed = await tryClaim(cand.key, id); } catch { claimed = true; }   // if claiming itself fails, offering is still the safe choice
    if (!claimed) continue;     // another open tab is offering it, or it has just gone

    const chosen = cand.rec.snapshots[chosenIdx];
    const choice = await showRecoveryDialog(chosen.savedAt);
    if (typeof opts.onAnswered === 'function') opts.onAnswered(choice);   // the caller puts the keyboard back in the document (A89)
    if (choice === 'keep') {
      try { await keepBackup(cand); } catch (e) { console.warn('[autosave] could not release the kept backup (it stays where it was):', e); }
      if (onStatus) { try { onStatus(t('app.autosave.kept_status')); } catch { /* status UI is best-effort */ } }
      return null;            // "not now" ends the questions: any other backups are offered at the next load too
    }
    if (choice !== 'recover') {
      try { await deleteKeys([cand.key, CLAIM_PREFIX + cand.key]); } catch { /* best-effort */ }
      if (onStatus) { try { onStatus(t('app.autosave.discarded_status')); } catch { /* status UI is best-effort */ } }
      continue;               // offer the next backup, if there is one
    }
    try { await adoptBackup(cand, cand.rec.snapshots.slice(chosenIdx), id); }
    catch (e) { console.warn('[autosave] could not move the recovered backup to this tab (it stays where it was):', e); }
    if (chosen.resources && chosen.resources.length) model.resources = chosen.resources;
    if (chosen.metadata) model.metadata = chosen.metadata;
    if (chosen.title) model.title = chosen.title;
    if (onStatus) { try { onStatus(t('app.autosave.recovered_status', { time: relativeTime(chosen.savedAt) })); } catch { /* status UI is best-effort */ } }
    return model;
  }
  return null;
}
