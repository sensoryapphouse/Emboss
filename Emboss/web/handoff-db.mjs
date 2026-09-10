// Simple, zero-dependency IndexedDB helper for transferring large documents
// between Quick Mode and the Advanced Editor without hitting sessionStorage 5MB quotas.

const DB_NAME = 'emboss_db';
const DB_VERSION = 1;
const STORE_NAME = 'handoff_store';
const DOC_KEY = 'pending_editor_doc';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function setHandoffDoc(doc) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(doc, DOC_KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
    return true;
  } catch (err) {
    // Fallback to sessionStorage if IndexedDB fails
    try {
      if (doc) sessionStorage.setItem('emboss-editor-doc', JSON.stringify(doc));
    } catch { /* quota / private mode */ }
    return false;
  }
}

export async function getAndClearHandoffDoc() {
  let doc = null;
  try {
    const db = await openDb();
    doc = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(DOC_KEY);
      req.onsuccess = () => {
        const val = req.result;
        if (val) store.delete(DOC_KEY);
        resolve(val || null);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  } catch {
    doc = null;
  }

  // Fallback to sessionStorage if not found in IndexedDB
  if (!doc) {
    try {
      const s = sessionStorage.getItem('emboss-editor-doc');
      if (s) {
        doc = JSON.parse(s);
        sessionStorage.removeItem('emboss-editor-doc');
      }
    } catch { /* */ }
  }

  return doc;
}
