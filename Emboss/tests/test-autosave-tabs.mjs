// A80 (EMBOSS-TASKS.md): autosave across several editor tabs.
//
// Before A80, autosave.mjs kept ONE IndexedDB record (key `current_doc`) shared by every editor
// tab of the origin: opening a second tab offered to recover the first tab's unsaved work, and
// whichever tab autosaved last overwrote the other's backup. Now each tab keeps its own backup
// (key `doc:<tabId>`, tab id in sessionStorage), an open tab says so (a Web Lock named after its
// tab id; a localStorage heartbeat where Web Locks do not exist), and recovery is offered only for
// a backup no open tab owns.
//
// "Two tabs" here = two Playwright pages in ONE browser context: they share IndexedDB,
// localStorage and Web Locks (as two real tabs do) but each has its own sessionStorage. The
// rules these tests pin (Paul's decisions: none — the task text of A80 plus the brief):
//   1. an open tab's backup is never offered to another tab, and never overwritten by it;
//   2. each tab's backup lives under its own key;
//   3. a backup whose tab is gone (closed / killed) is offered to the next tab that starts;
//   4. a reloaded tab is offered its own backup;
//   5. an old-format `current_doc` record (before A80) is offered once, then gone;
//   6. an explicit Save / Clear removes only that tab's own backup;
//   plus: two tabs starting at once do not both offer the same orphan; a duplicated tab (copied
//   sessionStorage) takes a fresh id; the no-Web-Locks fallback; orphans older than 30 days are
//   cleared; the other orphans are kept for the next start.
//
// Uses window.__forceAutosaveTick instead of waiting 30 s. Reads IndexedDB directly to see which
// backups exist (the module's own storage format is what is under test).
//
// Needs the dev server:  node Emboss/scripts/serve.mjs 8295 &
//   node Emboss/tests/test-autosave-tabs.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail !== '' ? ': ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};

const SETTINGS_JSON = JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
const isMac = process.platform === 'darwin';
const END_OF_DOC = isMac ? 'Meta+End' : 'Control+End';
const TAB_ID_KEY = 'emboss-autosave-tab-id';   // sessionStorage key autosave.mjs keeps a tab's id under (tests copy it to fake a duplicated tab)

const browser = await launchBrowser({ args: ['--no-sandbox'] });

async function freshContext({ noLocks = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await ctx.addInitScript((json) => { try { localStorage.setItem('emboss-settings', json); } catch {} }, SETTINGS_JSON);
  if (noLocks) await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); } catch {} });
  return ctx;
}

const READY = () => typeof window.lastBrf === 'string' && window.lastBrf.length > 0 && typeof window.__forceAutosaveTick === 'function';

// Waits for either the recovery dialog or a ready editor, whichever comes first.
async function settle(page, timeout = 40000) {
  const outcome = await Promise.race([
    page.waitForSelector('#autosaveRecoverDialog', { state: 'attached', timeout }).then(() => 'dialog').catch(() => null),
    page.waitForFunction(READY, null, { timeout }).then(() => 'ready').catch(() => null),
  ]);
  if (outcome === 'dialog') return true;
  await page.waitForFunction(READY, null, { timeout });
  return false;
}

// A new tab. If the recovery dialog appears and `onDialog` is 'discard'/'recover' it is answered
// (so a failing run, where the dialog should not have appeared, can still carry on); otherwise
// the dialog is left open and `sawDialog` says so.
async function openTab(ctx, { onDialog = null, prep = null } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());      // the Clear button's "are you sure" confirm
  if (prep) await prep(page);
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  const sawDialog = await settle(page);
  if (sawDialog && onDialog) {
    await page.click(onDialog === 'recover' ? '#autosaveRecoverBtn' : '#autosaveDiscardBtn');
    await page.waitForFunction(READY, null, { timeout: 40000 });
  }
  return { page, sawDialog, errors };
}

async function reload(page) {
  await page.reload({ waitUntil: 'load' });
  return settle(page);
}

async function typeParagraph(page, text) {
  const prev = (await page.evaluate(() => window.lastBrf || '')).length;
  await page.click('#editor');
  await page.keyboard.press(END_OF_DOC);
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await page.waitForFunction((n) => (window.lastBrf || '').length !== n, prev, { timeout: 10000 });
}

const tick = (page) => page.evaluate(() => window.__forceAutosaveTick());
const tabIdOf = (page) => page.evaluate((k) => sessionStorage.getItem(k), TAB_ID_KEY);

// Raw view of the backup store: [{ key, savedAt, xmls: [...] }] for every non-claim record.
async function dump(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('emboss_autosave_db', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const store = db.transaction('autosave_store', 'readonly').objectStore('autosave_store');
      const keys = store.getAllKeys();
      const vals = store.getAll();
      vals.onsuccess = () => {
        const out = [];
        keys.result.forEach((k, i) => {
          const v = vals.result[i];
          if (String(k).startsWith('claim:')) return;
          out.push({ key: String(k), savedAt: v && v.snapshots && v.snapshots[0] ? v.snapshots[0].savedAt : null, xmls: ((v && v.snapshots) || []).map((s) => s.xml) });
        });
        db.close();
        resolve(out);
      };
      vals.onerror = () => reject(vals.error);
    };
  }));
}
const keysWith = async (page, marker) => (await dump(page)).filter((r) => r.xmls.some((x) => x.includes(marker))).map((r) => r.key);

// Writes a record straight into the store (old-format `current_doc`, or a fake old orphan).
async function putRaw(page, key, value) {
  await page.evaluate(({ key, value }) => new Promise((resolve, reject) => {
    const req = indexedDB.open('emboss_autosave_db', 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('autosave_store')) req.result.createObjectStore('autosave_store'); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('autosave_store', 'readwrite');
      tx.objectStore('autosave_store').put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { key, value });
}

// Closing a tab releases its Web Lock a moment later; give that a (bounded) moment so "tab C opens
// after tab A closed" is not a race in the test itself.
const settleClose = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ==================================================================================
console.log('--- 1. A second tab does not offer the first tab\'s backup, and leaves it untouched ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  ok('tab A: opens with no dialog', a.sawDialog === false);
  const mA = 'Tab A unsaved words alpha.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  const keysA = await keysWith(a.page, mA);
  ok('tab A: its backup exists', keysA.length === 1, keysA);

  const b = await openTab(ctx, { onDialog: 'discard' });
  ok('tab B (A still open): no recovery dialog', b.sawDialog === false);
  const after = await keysWith(b.page, mA);
  ok('tab B: A\'s backup is still there, untouched', after.length === 1 && after[0] === keysA[0], { before: keysA, after });
  const idA = await tabIdOf(a.page), idB = await tabIdOf(b.page);
  ok('the two tabs have different tab ids', !!idA && !!idB && idA !== idB, { idA, idB });
  ok('no page errors', !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]);
  await ctx.close();
}

// ==================================================================================
console.log('--- 2. Both tabs autosave: neither overwrites the other ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  const mA = 'First tab text zebra.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  const b = await openTab(ctx, { onDialog: 'discard' });
  const mB = 'Second tab text quokka.';
  await typeParagraph(b.page, mB);
  await tick(b.page);
  const kA = await keysWith(a.page, mA), kB = await keysWith(a.page, mB);
  ok('A\'s backup holds A\'s text', kA.length === 1, kA);
  ok('B\'s backup holds B\'s text', kB.length === 1, kB);
  ok('they are different records', kA[0] && kB[0] && kA[0] !== kB[0], { kA, kB });
  // A saves again after B did: still its own record.
  await typeParagraph(a.page, 'A again.');
  await tick(a.page);
  ok('after A autosaves again, B\'s backup still holds B\'s text', (await keysWith(a.page, mB)).length === 1);
  ok('after A autosaves again, A\'s backup holds A\'s text', (await keysWith(a.page, mA)).length === 1);
  await ctx.close();
}

// ==================================================================================
console.log('--- 3. A tab closed without saving: its work is offered to the next tab ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  const mA = 'Closed tab work heron.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  const oldKey = (await keysWith(a.page, mA))[0];
  const keeper = await openTab(ctx, { onDialog: 'discard' });   // a second, still-open tab (clean)
  ok('setup: a second tab is open and clean', keeper.sawDialog === false);
  await a.page.close();
  await settleClose();

  const c = await openTab(ctx);
  ok('tab C: offered A\'s unsaved work (A is gone)', c.sawDialog === true);
  if (c.sawDialog) {
    await c.page.click('#autosaveRecoverBtn');
    await c.page.waitForFunction(READY, null, { timeout: 40000 });
    const xml = await c.page.evaluate(() => window.exportCurrentDocumentXml());
    ok('tab C: Recover restores A\'s text', xml.includes(mA));
    ok('tab C: the recovered document counts as unsaved', (await c.page.evaluate(() => window.isDocumentDirty())) === true);
    const keys = await keysWith(c.page, mA);
    ok('the recovered backup now lives under tab C\'s own key (A\'s old record is not left to be offered again)',
      keys.length === 1 && keys[0] !== oldKey, { keys, oldKey });
    // And a further new tab offers nothing: C owns that backup now.
    const d = await openTab(ctx, { onDialog: 'discard' });
    ok('tab D (C open and holding the recovered work): no dialog', d.sawDialog === false);
  }
  await ctx.close();
}

// ==================================================================================
console.log('--- 3b. Several orphans: newest offered, the rest kept for the next start; open tabs never offered ---');
{
  const ctx = await freshContext();
  const live = await openTab(ctx);
  const mLive = 'Live tab words never offered.';
  await typeParagraph(live.page, mLive);
  await tick(live.page);

  const o1 = await openTab(ctx, { onDialog: 'discard' });
  const m1 = 'Older orphan work first.';
  await typeParagraph(o1.page, m1);
  await tick(o1.page);
  await new Promise((r) => setTimeout(r, 50));
  const o2 = await openTab(ctx, { onDialog: 'discard' });
  const m2 = 'Newer orphan work second.';
  await typeParagraph(o2.page, m2);
  await tick(o2.page);
  await o1.page.close(); await o2.page.close();
  await settleClose();

  const c = await openTab(ctx);
  ok('new tab: dialog offered', c.sawDialog === true);
  if (c.sawDialog) {
    await c.page.click('#autosaveRecoverBtn');
    await c.page.waitForFunction(READY, null, { timeout: 40000 });
    const xml = await c.page.evaluate(() => window.exportCurrentDocumentXml());
    ok('the NEWEST orphan was offered (second tab\'s text)', xml.includes(m2) && !xml.includes(m1) && !xml.includes(mLive), xml.slice(0, 300));
    ok('the older orphan is still stored (kept, not cleared)', (await keysWith(c.page, m1)).length === 1);
    ok('the live tab\'s backup is untouched', (await keysWith(c.page, mLive)).length === 1);
  }
  // Next start: the older orphan is offered (it was kept). First tab C saves its recovered work
  // (which removes C's own backup) and closes, so what is left on disk is only the older orphan.
  await c.page.click('#saveDocBtn');
  await c.page.waitForTimeout(400);
  await c.page.close();
  await settleClose();
  const d = await openTab(ctx);
  ok('the next new tab is offered the older orphan', d.sawDialog === true);
  if (d.sawDialog) {
    await d.page.click('#autosaveRecoverBtn');
    await d.page.waitForFunction(READY, null, { timeout: 40000 });
    ok('...and it holds the older orphan\'s text', (await d.page.evaluate(() => window.exportCurrentDocumentXml())).includes(m1));
  }
  await ctx.close();
}

// ==================================================================================
console.log('--- 4. A reloaded dirty tab is offered its own work ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  const mA = 'Reloaded tab own work ibis.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  const idBefore = await tabIdOf(a.page);
  const keyBefore = (await keysWith(a.page, mA))[0];

  // Another tab with its own, newer, unsaved work stays open throughout.
  const b = await openTab(ctx, { onDialog: 'discard' });
  const mB = 'Other open tab work newer.';
  await typeParagraph(b.page, mB);
  await tick(b.page);

  const sawDialog = await reload(a.page);
  ok('reload: the tab is offered recovery', sawDialog === true);
  if (sawDialog) {
    await a.page.click('#autosaveRecoverBtn');
    await a.page.waitForFunction(READY, null, { timeout: 40000 });
    const xml = await a.page.evaluate(() => window.exportCurrentDocumentXml());
    ok('reload: it is its OWN work (not the other open tab\'s)', xml.includes(mA) && !xml.includes(mB), xml.slice(0, 300));
    ok('reload: the tab keeps its tab id', (await tabIdOf(a.page)) === idBefore);
    ok('reload: it continues under the same key', (await keysWith(a.page, mA))[0] === keyBefore);
  }
  ok('the other tab\'s backup was not touched', (await keysWith(a.page, mB)).length === 1);
  await ctx.close();
}

// ==================================================================================
console.log('--- 5. An old-format `current_doc` record is offered once, then gone ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  const mOld = 'Written by the single-slot autosave.';
  await typeParagraph(a.page, mOld);
  const xml = await a.page.evaluate(() => window.exportCurrentDocumentXml());
  await a.page.evaluate(() => window.markDocumentClean());
  await putRaw(a.page, 'current_doc', { snapshots: [{ savedAt: Date.now() - 60000, xml, title: null, metadata: null, resources: [] }] });
  await a.page.close();
  await settleClose();

  const b = await openTab(ctx);
  ok('old record: offered', b.sawDialog === true);
  if (b.sawDialog) {
    await b.page.click('#autosaveRecoverBtn');
    await b.page.waitForFunction(READY, null, { timeout: 40000 });
    ok('old record: Recover restores its text', (await b.page.evaluate(() => window.exportCurrentDocumentXml())).includes(mOld));
    const d = await dump(b.page);
    ok('old record: `current_doc` is gone after recovery', !d.some((r) => r.key === 'current_doc'), d.map((r) => r.key));
    ok('old record: the work is kept under the tab\'s own key', d.some((r) => r.key !== 'current_doc' && r.xmls.some((x) => x.includes(mOld))), d.map((r) => r.key));
  }
  await ctx.close();

  // A discarded old record is not offered again either.
  const ctx2 = await freshContext();
  const x = await openTab(ctx2);
  await typeParagraph(x.page, mOld);
  const xml2 = await x.page.evaluate(() => window.exportCurrentDocumentXml());
  await x.page.evaluate(() => window.markDocumentClean());
  await putRaw(x.page, 'current_doc', { snapshots: [{ savedAt: Date.now() - 60000, xml: xml2, title: null, metadata: null, resources: [] }] });
  await x.page.close();
  await settleClose();
  const y = await openTab(ctx2);
  ok('old record: offered (discard case)', y.sawDialog === true);
  if (y.sawDialog) {
    await y.page.click('#autosaveDiscardBtn');
    await y.page.waitForFunction(READY, null, { timeout: 40000 });
    ok('old record: Discard removes it', !(await dump(y.page)).some((r) => r.key === 'current_doc'));
  }
  const z = await openTab(ctx2);
  ok('old record: not offered a second time', z.sawDialog === false);
  await ctx2.close();
}

// ==================================================================================
console.log('--- 6. Save and Clear remove only the tab\'s own backup ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  const mA = 'Tab A will save this.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  const b = await openTab(ctx, { onDialog: 'discard' });
  const mB = 'Tab B will clear this.';
  await typeParagraph(b.page, mB);
  await tick(b.page);
  ok('setup: two backups', (await keysWith(a.page, mA)).length === 1 && (await keysWith(a.page, mB)).length === 1);

  await a.page.click('#saveDocBtn');
  await a.page.waitForTimeout(400);
  ok('Save in A: A\'s backup is gone', (await keysWith(a.page, mA)).length === 0);
  ok('Save in A: B\'s backup is still there', (await keysWith(a.page, mB)).length === 1);

  await b.page.click('#btnClear');
  await b.page.waitForTimeout(400);
  ok('Clear in B: B\'s backup is gone', (await keysWith(a.page, mB)).length === 0);
  ok('no page errors', !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]);
  await ctx.close();
}

// ==================================================================================
console.log('--- 7. Two tabs starting together: the same orphan is offered to one only ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  const mA = 'Orphan raced for by two tabs.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  await a.page.close();
  await settleClose();

  const pages = await Promise.all([openTab(ctx), openTab(ctx), openTab(ctx)]);
  const dialogs = pages.filter((p) => p.sawDialog).length;
  ok('exactly one of three simultaneous tabs is offered the orphan', dialogs === 1, dialogs);
  await ctx.close();
}

// ==================================================================================
console.log('--- 8. A duplicated tab (copied sessionStorage) takes a fresh tab id ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  const mA = 'Original tab words.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  const idA = await tabIdOf(a.page);
  const dup = await openTab(ctx, { prep: (page) => page.addInitScript(([k, v]) => { try { sessionStorage.setItem(k, v); } catch {} }, [TAB_ID_KEY, idA]), onDialog: 'discard' });
  ok('duplicate: no recovery dialog (the original is open)', dup.sawDialog === false);
  const idD = await tabIdOf(dup.page);
  ok('duplicate: took a fresh tab id', !!idD && idD !== idA, { idA, idD });
  const mD = 'Duplicate tab words.';
  await typeParagraph(dup.page, mD);
  await tick(dup.page);
  ok('duplicate: both backups exist separately', (await keysWith(a.page, mA)).length === 1 && (await keysWith(a.page, mD)).length === 1);
  await ctx.close();
}

// ==================================================================================
console.log('--- 9. Without Web Locks (heartbeat fallback) ---');
{
  const ctx = await freshContext({ noLocks: true });
  const a = await openTab(ctx);
  ok('setup: this context really has no Web Locks', (await a.page.evaluate(() => typeof navigator.locks)) === 'undefined');
  const mA = 'Fallback tab A words.';
  await typeParagraph(a.page, mA);
  await tick(a.page);
  const b = await openTab(ctx, { onDialog: 'discard' });
  ok('fallback: second tab, no dialog while A is open', b.sawDialog === false);
  ok('fallback: A\'s backup untouched', (await keysWith(b.page, mA)).length === 1);
  await a.page.close();
  await settleClose();
  const c = await openTab(ctx);
  ok('fallback: after A closes, its work is offered', c.sawDialog === true);
  await ctx.close();
}

// ==================================================================================
console.log('--- 10. Orphans older than 30 days are cleared; recent ones are kept ---');
{
  const ctx = await freshContext();
  const a = await openTab(ctx);
  await typeParagraph(a.page, 'Seed text for xml.');
  const xml = await a.page.evaluate(() => window.exportCurrentDocumentXml());
  await a.page.evaluate(() => window.markDocumentClean());
  const day = 24 * 3600 * 1000;
  await putRaw(a.page, 'doc:ancient-dead-tab', { tabId: 'ancient-dead-tab', snapshots: [{ savedAt: Date.now() - 40 * day, xml, title: null, metadata: null, resources: [] }] });
  await a.page.close();
  await settleClose();
  const b = await openTab(ctx);
  ok('a 40-day-old orphan is not offered', b.sawDialog === false);
  ok('...and is cleared', !(await dump(b.page)).some((r) => r.key === 'doc:ancient-dead-tab'));
  await putRaw(b.page, 'doc:recent-dead-tab', { tabId: 'recent-dead-tab', snapshots: [{ savedAt: Date.now() - 3 * day, xml, title: null, metadata: null, resources: [] }] });
  const c = await openTab(ctx);
  ok('a 3-day-old orphan is offered', c.sawDialog === true);
  await ctx.close();
}

await browser.close();
console.log(`\n=== autosave tabs [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All autosave-tab checks passed.');
}
