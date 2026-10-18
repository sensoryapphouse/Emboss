// Simple, zero-dependency IndexedDB helper for transferring large documents
// between Quick Mode and the Advanced Editor without hitting sessionStorage 5MB quotas.
//
// Audit batch S2a, item 4 (ChatGPT audit of 15 Oct 2026): every transfer used to share ONE origin-wide key
// ('pending_editor_doc'), so two tabs changing mode at the same moment could swap documents (the second write replaced
// the first, and the first destination to read took, and deleted, whatever was there). Now:
//   * every transfer has its own id; the document is stored under `handoff:<id>`;
//   * the id travels to the destination in the URL hash (`#handoff=<id>`), and the destination reads only its own id;
//   * reading does NOT delete: the stored copy stays until the destination has loaded the document and calls
//     confirmHandoff(), so a destination that fails or is reloaded half-way can still read it again;
//   * a write is reported as stored only when the IndexedDB transaction has COMPLETED (an abort or a failed commit
//     after put() succeeded is "not stored");
//   * a transfer nobody confirmed is swept away after a day;
//   * the braille already made travels with the document (feedback 17 Oct 2026, item 13): the BRF, and a key (brailleKey) that names exactly the document
//     and the settings it was made from; the destination uses it only if its own key for the document it has just read is the same, and brailles
//     the document itself otherwise;
//   * a transfer started by an older version of Emboss (the fixed key, with no id in the URL) is still read - once -
//     so an update that lands between the two pages of a mode switch loses nothing.

const DB_NAME = 'emboss_db';
const DB_VERSION = 1;
const STORE_NAME = 'handoff_store';
const LEGACY_KEY = 'pending_editor_doc';           // the one shared key older versions used
const KEY_PREFIX = 'handoff:';                      // `handoff:<id>` - one record per transfer
const SS_PREFIX = 'emboss-editor-doc:';             // sessionStorage fallback, per transfer
const SS_LEGACY = 'emboss-editor-doc';
const MAX_AGE_MS = 24 * 3600 * 1000;                // an unconfirmed transfer older than this is removed on the next write

/** A new transfer id: unguessable enough that two tabs never share one. */
export function newHandoffId() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
}
/** The hash a destination page's URL carries: '#handoff=<id>'. */
export function handoffHash(id) { return '#handoff=' + id; }
/** The transfer id in a URL hash ('#handoff=<id>', possibly among other parameters), or null. */
export function handoffIdFromHash(hash) {
  const m = /(?:^#|&)handoff=([\w-]{8,80})(?:&|$)/.exec(String(hash || ''));
  return m ? m[1] : null;
}

// 18 Oct 2026 (Paul: "sometimes Emboss doesn't let me go back to Quick Mode and won't reload properly"): a browser can leave an IndexedDB open
// unanswered (Safari does, now and then; or another tab blocks it), and everything waiting on it waited for ever - the Quick Mode button did
// nothing, and the editor never finished loading. The open now gives up after OPEN_TIMEOUT_MS (or at once when the browser says it is
// blocked) and its callers carry on without it.
export const OPEN_TIMEOUT_MS = 4000;
function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('IndexedDB did not answer')); } }, OPEN_TIMEOUT_MS);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onblocked = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('IndexedDB is blocked by another tab')); } };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      if (settled) { try { db.close(); } catch { /* */ } return; }   // too late: it was given up on
      settled = true; clearTimeout(timer); resolve(db);
    };
    req.onerror = (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e.target.error); } };
  });
}

// Runs `work(store, done)` in one transaction and resolves with whatever `work` passes to done() once the transaction has
// COMPLETED (so a resolved write is a durable write); rejects if it errors or aborts. `work` may throw (e.g. a
// DataCloneError from put()): that rejects too.
async function inTransaction(mode, work) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      let result;
      const tx = db.transaction(STORE_NAME, mode);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('handoff transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('handoff transaction failed'));
      work(tx.objectStore(STORE_NAME), (v) => { result = v; });
    });
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

// The key of a braille: a hash of the document (its blocks and fields, not its pictures' bytes, nor the mark that its edits are unsaved) and of every
// setting and flag the formatter reads. `flags` is { brailleCode, quoteStyle, mode, cells, lines, paragraphStyle, listStyle, tableFormat, interpoint,
// mathCode, titleInBraille, toc, suppressHeader, mathsReady }; a flag the sender and the receiver do not both have the same value for makes the keys
// differ, which is the safe outcome (the receiver brailles the document itself). Resolves a hex string, or null when it cannot be worked out.
// `settings` is every saved setting as well (main session, review): both pages read the one store, so the whole of it costs nothing to compare and a
// setting the formatter reads that the list above forgets can never let braille made under other settings through.
const KEY_FLAGS = ['brailleCode', 'quoteStyle', 'mode', 'cells', 'lines', 'paragraphStyle', 'listStyle', 'tableFormat', 'interpoint', 'mathCode', 'titleInBraille', 'toc', 'suppressHeader', 'mathsReady', 'settings'];
export async function brailleKey(doc, flags) {
  try {
    const f = {};
    for (const k of KEY_FLAGS) f[k] = flags && flags[k] !== undefined ? flags[k] : null;
    const body = JSON.stringify(doc, (k, v) => (k === 'resources' || k === '_unsavedEdits' || k === 'keys' || k === 'warnings' ? undefined : v));
    const data = new TextEncoder().encode('emboss-braille-key-1\n' + JSON.stringify(f) + '\n' + body);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

// The flags of brailleKey for a page's saved settings (both pages build them here, so they cannot disagree about what a flag means). `extra` carries what
// is not a saved setting: titleInBraille (whether a title is added to the braille), toc, suppressHeader, and mathsReady (the maths engine was up).
export function brailleFlags(s, extra = {}) {
  return {
    brailleCode: s.brailleCode, quoteStyle: s.quoteStyle, mode: s.mode, cells: Number(s.cells), lines: Number(s.lines),
    paragraphStyle: s.paragraphStyle, listStyle: s.listStyle, tableFormat: s.tableFormat, interpoint: s.embosserDuplex !== 'single', mathCode: s.mathCode,
    titleInBraille: !!extra.titleInBraille, toc: !!extra.toc, suppressHeader: !!extra.suppressHeader, mathsReady: extra.mathsReady !== false,
    settings: Object.fromEntries(Object.entries(s || {}).filter(([k]) => k !== 'simpleMode').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

/** Stores `doc` as the transfer `id` (and, optionally, `braille`: { key, brf, warnings } made from it, see brailleKey). Resolves true only when it is
 *  safely in IndexedDB (the transaction completed); false otherwise (a copy of the document is then tried in sessionStorage, which the destination
 *  tab also reads, but it is not called stored; the braille is not copied there). */
export async function setHandoffDoc(doc, id, braille = null) {
  if (!id) return false;
  try {
    await inTransaction('readwrite', (store) => {
      try {
        const cur = store.openCursor(IDBKeyRange.bound(KEY_PREFIX, KEY_PREFIX + '￿'));
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          if (c.value && c.value.createdAt && Date.now() - c.value.createdAt > MAX_AGE_MS) c.delete();
          c.continue();
        };
      } catch { /* sweeping is housekeeping only */ }
      store.put({ v: 2, id, createdAt: Date.now(), doc, braille: braille || null }, KEY_PREFIX + id);
    });
    return true;
  } catch (err) {
    // Fallback to sessionStorage if IndexedDB fails (it stays in this tab, which is the one that navigates)
    try {
      if (doc) sessionStorage.setItem(SS_PREFIX + id, JSON.stringify(doc));
    } catch { /* quota / private mode */ }
    return false;
  }
}

/** Reads the transfer `id` (default: the one in this page's URL hash) WITHOUT removing it. With no id at all it reads the
 *  fixed key an older version used, once (that one is removed as it is read). Resolves { id, doc, legacy } or null. */
export async function readHandoff(id = handoffIdFromHash(globalThis.location && location.hash)) {
  const legacy = !id;
  let doc = null, braille = null;
  try {
    const got = await inTransaction(legacy ? 'readwrite' : 'readonly', (store, done) => {
      const req = store.get(legacy ? LEGACY_KEY : KEY_PREFIX + id);
      req.onsuccess = () => {
        const val = req.result || null;
        if (legacy && val) store.delete(LEGACY_KEY);
        done(val ? (val.v === 2 ? { doc: val.doc, braille: val.braille || null } : { doc: val, braille: null }) : null);
      };
    });
    doc = got ? got.doc : null;
    braille = got ? got.braille : null;
  } catch {
    doc = null;
  }

  // Fallback to sessionStorage if not found in IndexedDB
  if (!doc) {
    try {
      const s = sessionStorage.getItem(legacy ? SS_LEGACY : SS_PREFIX + id);
      if (s) {
        doc = JSON.parse(s);
        if (legacy) sessionStorage.removeItem(SS_LEGACY);
      }
    } catch { /* */ }
  }

  return doc ? { id: id || null, doc, legacy, braille } : null;
}

/** The destination has loaded the document: remove the stored copy and take the id out of the address. */
export async function confirmHandoff(h) {
  if (!h || !h.id) return true;
  let removed = true;
  try {
    await inTransaction('readwrite', (store) => { store.delete(KEY_PREFIX + h.id); });
  } catch { removed = false; }
  try { sessionStorage.removeItem(SS_PREFIX + h.id); } catch { /* */ }
  try {
    if (handoffIdFromHash(location.hash) === h.id) history.replaceState(history.state, '', location.pathname + location.search);
  } catch { /* */ }
  return removed;
}
