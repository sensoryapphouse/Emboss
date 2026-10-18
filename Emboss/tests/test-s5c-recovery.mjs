// Batch S5c, item D1 (Paul, 15 Oct 2026): the question "Recover unsaved work from <time>?" no longer throws the backup away when it is
// closed without an answer. Escape and a click outside the box KEEP the backup (the box closes; the next load offers it again);
// only the Discard button deletes it. After each answer the keyboard is back in the document (tests/test-recover-focus.mjs, A89).
// A kept backup is not lost when the user then edits: autosave writes the new document under the tab's own key, and the kept backup
// stays in its own record, so it is offered again after the new document's backup (S5c: it is moved to a record of its own).
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=... for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8212 &   then   node Emboss/tests/test-s5c-recovery.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports './lib/launch-browser.mjs').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

// every backup record in IndexedDB: [{ key, text }] (the newest snapshot's xml, to see which document it holds)
const backups = (page) => page.evaluate(() => new Promise((resolve) => {
  const rq = indexedDB.open('emboss_autosave_db');
  rq.onerror = () => resolve([]);
  rq.onsuccess = () => {
    const db = rq.result;
    if (!db.objectStoreNames.contains('autosave_store')) { resolve([]); return; }
    const st = db.transaction('autosave_store').objectStore('autosave_store');
    const keys = st.getAllKeys(), vals = st.getAll();
    st.transaction.oncomplete = () => {
      resolve(keys.result.map((k, i) => ({ key: String(k), text: vals.result[i] && vals.result[i].snapshots ? vals.result[i].snapshots.map((s) => s.xml).join('\n') : '' }))
        .filter((r) => r.key.startsWith('doc:')));
    };
  };
}));
const focusIn = (page) => page.evaluate(() => (document.activeElement?.id || document.activeElement?.tagName));
const dialogOpen = (page) => page.evaluate(() => !!document.querySelector('#autosaveRecoverDialog[open]'));

async function fresh(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const URL_ = `http://localhost:${PORT}/web/editor/index.html`;
async function load(page, reload) {
  if (reload) await page.reload({ waitUntil: 'load' }); else await page.goto(URL_, { waitUntil: 'load' });
}
async function ready(page) {
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.importFile === 'function' && window.lastBrf, null, { timeout: 60000 });
  await page.waitForTimeout(800);
}
async function typeUnsaved(page, words) {
  await page.click('#editor p >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.type(' ' + words);
  await page.waitForTimeout(4000);                                   // the backup is written ~2 s after typing pauses
}
const editorText = (page) => page.evaluate(() => document.getElementById('editor').textContent);

for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  try {
    // ---- Escape and the backdrop keep the backup; Discard deletes it -----------------------------------------------------
    for (const how of ['Escape', 'backdrop', 'Discard']) {
      const { ctx, page } = await fresh(browser);
      try {
        const marker = 'alpha' + how.toLowerCase();
        await load(page, false); await ready(page);
        await typeUnsaved(page, marker);
        ok(`${engine} (${how}): a backup was written`, (await backups(page)).some((b) => b.text.includes(marker)));
        await load(page, true);
        await page.waitForSelector('#autosaveRecoverBtn', { state: 'visible', timeout: 30000 });
        if (how === 'Escape') await page.keyboard.press('Escape');
        else if (how === 'backdrop') await page.mouse.click(4, 4);
        else await page.click('#autosaveDiscardBtn');
        await ready(page);
        ok(`${engine} (${how}): the question has closed`, !(await dialogOpen(page)));
        ok(`${engine} (${how}): the keyboard is back in the document`, (await focusIn(page)) === 'editor', await focusIn(page));
        await page.keyboard.type('Q'); await page.waitForTimeout(300);
        ok(`${engine} (${how}): typing goes into the text`, (await editorText(page)).includes('Q'));
        ok(`${engine} (${how}): the recovered text was not loaded`, !(await editorText(page)).includes(marker));
        const after = await backups(page);
        if (how === 'Discard') ok(`${engine} (Discard): the backup is deleted`, !after.some((b) => b.text.includes(marker)), after.map((b) => b.key));
        else ok(`${engine} (${how}): the backup is still stored`, after.some((b) => b.text.includes(marker)), after.map((b) => b.key));
        // next load: offered again (Escape, backdrop) or not (Discard)
        await page.evaluate(async () => { window.markDocumentClean(); await window.__clearAutosaveSnapshot(); });   // the typed Q is not a backup; the kept record is not this tab's own key, so it stays
        await load(page, true); await page.waitForTimeout(3500);
        const offered = await dialogOpen(page);
        if (how === 'Discard') ok(`${engine} (Discard): the next load does not ask again`, !offered);
        else {
          ok(`${engine} (${how}): the next load offers the backup again`, offered);
          // and it can be recovered from there
          if (offered) {
            await page.click('#autosaveRecoverBtn'); await ready(page);
            ok(`${engine} (${how}): …and Recover then brings the text back`, (await editorText(page)).includes(marker));
          }
        }
      } finally { await ctx.close(); }
    }

    // ---- a kept backup survives the user editing something else (autosave writes more than 3 times) ----------------------
    {
      const { ctx, page } = await fresh(browser);
      try {
        await load(page, false); await ready(page);
        await typeUnsaved(page, 'omegakept');
        await load(page, true);
        await page.waitForSelector('#autosaveRecoverBtn', { state: 'visible', timeout: 30000 });
        await page.keyboard.press('Escape');
        await ready(page);
        for (let i = 0; i < 5; i++) {                                   // more writes than the ring buffer holds
          await page.click('#editor p >> nth=0');
          await page.keyboard.type(` newdoc${i}`);
          await page.evaluate(() => window.__forceAutosaveTick());
        }
        const b = await backups(page);
        ok(`${engine} (kept, then editing): the kept backup is still stored after 5 new autosaves`, b.some((x) => x.text.includes('omegakept')), b.map((x) => x.key));
        ok(`${engine} (kept, then editing): …in a record of its own, apart from the new document's`, b.length >= 2 && !b.some((x) => x.text.includes('omegakept') && x.text.includes('newdoc')), b.map((x) => x.key));
        await load(page, true);
        await page.waitForSelector('#autosaveRecoverBtn', { state: 'visible', timeout: 30000 });
        await page.click('#autosaveDiscardBtn');                        // the new document's backup (this tab's own, offered first)
        await page.waitForSelector('#autosaveRecoverBtn', { state: 'visible', timeout: 30000 });   // …and the kept one is offered next
        await page.click('#autosaveRecoverBtn'); await ready(page);
        ok(`${engine} (kept, then editing): after the new backup is discarded, the kept one is offered and recovers`, (await editorText(page)).includes('omegakept'));
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); }
}
console.log(`\n=== Recovery question kept on Escape [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
