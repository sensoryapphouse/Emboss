// A89 step 3 (robustness programme; Paul, 2 Oct: "It is vital that Emboss is robust … transcribers lost confidence in
// BrailleBlaster because it crashed"): never lose work. Autosave used to write every 30 s and when the tab was hidden or closed;
// a tab that crashed or hung lost up to 30 s of typing, because a crashed or frozen page runs no closing code. Now the editor
// saves a backup about 2 s after the typing pauses, and at least every 30 s while it does not pause (Paul, 2 Oct).
//
// Proved here the hard way, with nothing forced: type, wait, then CRASH the tab (Chrome's renderer is killed through the
// DevTools protocol — no pagehide, no beforeunload), open Emboss again in a new tab, and Recover must bring the typing back.
// Also a tab that hangs (an endless loop) before it crashes, and typing that never pauses for 33 s. In WebKit (which cannot be
// crashed from a test) the backup is read straight from IndexedDB within seconds of typing, with the tab still open; Firefox the same.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-autosave-crash.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
const SETTINGS_JSON = JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

async function openEditor(ctx) {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await Promise.race([
    page.waitForSelector('#autosaveRecoverDialog[open]', { timeout: 30000 }),
    page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 30000 }),
  ]).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}
async function startTyping(page, text) {
  await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Start of the document.' }] }); await window.render(); });
  await page.click('#editor p.ed-p >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}
// every backup text held in IndexedDB, read from a page of the same browser profile
const backups = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('emboss_autosave_db');
  req.onerror = () => resolve([]);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('autosave_store')) { resolve([]); return; }
    const all = db.transaction('autosave_store', 'readonly').objectStore('autosave_store').getAll();
    all.onsuccess = () => resolve((all.result || []).flatMap((r) => (r?.snapshots || (r?.xml ? [r] : [])).map((s) => s.xml || '')));
    all.onerror = () => resolve([]);
  };
}));
// crash the tab: no pagehide, no beforeunload, no closing code at all
async function crash(page) {
  const cdp = await page.context().newCDPSession(page);
  const crashed = new Promise((res) => page.once('crash', res));
  cdp.send('Page.crash').catch(() => {});        // never answers: the renderer is gone
  await Promise.race([crashed, new Promise((res) => setTimeout(res, 5000))]);
  await new Promise((res) => setTimeout(res, 300));
}
// a new tab: the recovery offer, Recover, the editor's text afterwards
async function recoverInNewTab(ctx) {
  const page = await openEditor(ctx);
  const offered = await page.evaluate(() => !!document.querySelector('#autosaveRecoverDialog[open]'));
  if (offered) { await page.click('#autosaveRecoverBtn'); await page.waitForTimeout(2500); }
  const text = await page.evaluate(() => document.getElementById('editor')?.textContent || '');
  return { page, offered, text };
}

// Crashing a tab needs Chrome's DevTools protocol (Page.crash): those cases run in Chrome only, and say so in the others.
const crashChecks = !ENGINE_SET || ENGINE === 'chrome';
if (!crashChecks) console.log(`  - skipped in ${LABELS[ENGINE]}: the crash cases (crashing a tab needs Chrome's DevTools protocol)`);
const chrome = crashChecks ? await launchBrowser({}, 'chrome') : null;
if (chrome) try {
  console.log('--- Chrome: crash after a pause in the typing ---');
  let ctx = await chrome.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', s); } catch {} }, SETTINGS_JSON);
  let page = await openEditor(ctx);
  await startTyping(page, ' Typed just before the crash, alpha bravo.');
  await page.waitForTimeout(3500);
  await crash(page);
  let r = await recoverInNewTab(ctx);
  ok('Chrome: after a crash, Emboss offers to recover', r.offered);
  ok('Chrome: …and Recover brings back what was typed 3.5 s before the crash', r.text.includes('alpha bravo'), r.text.slice(0, 200));
  await ctx.close();

  console.log('--- Chrome: the tab freezes ---');
  // A frozen tab (an endless loop) runs no closing code and cannot even be told to crash; when the person gives up on it,
  // Chrome's "Page unresponsive › Exit page" kills it, which is the crash case above. What matters is that, while it is
  // frozen, what was typed is already on disk: read from a second tab while the first is stuck.
  ctx = await chrome.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', s); } catch {} }, SETTINGS_JSON);
  page = await openEditor(ctx);
  await startTyping(page, ' Typed before the tab froze, charlie delta.');
  await page.waitForTimeout(3500);
  await page.evaluate(() => { setTimeout(() => { for (;;) { /* frozen */ } }, 0); });
  await new Promise((res) => setTimeout(res, 1000));
  const other = await ctx.newPage();
  await other.goto(`${BASE}/web/editor/index.html?frozen-check`, { waitUntil: 'domcontentloaded' });
  const held = await backups(other);
  ok('Chrome: while a tab is frozen, what was typed before is already in its backup', held.some((x) => x.includes('charlie delta')), held.map((x) => x.length));
  await ctx.close().catch(() => {});

  console.log('--- Chrome: typing that never pauses, then a crash ---');
  ctx = await chrome.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', s); } catch {} }, SETTINGS_JSON);
  page = await openEditor(ctx);
  await startTyping(page, ' Early words echo foxtrot');
  for (let i = 0; i < 110; i++) { await page.keyboard.type(' w'); await page.waitForTimeout(300); }   // 33 s without a pause
  await crash(page);
  r = await recoverInNewTab(ctx);
  ok('Chrome: typing that never paused for 33 s is still backed up (at least every 30 s)', r.offered && r.text.includes('echo foxtrot'), { offered: r.offered, text: r.text.slice(0, 200) });
  await ctx.close();
} finally {
  await chrome.close();
}

for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const launch = () => launchBrowser({}, key);
  console.log(`--- ${engine}: the backup is written within seconds, the tab still open ---`);
  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', s); } catch {} }, SETTINGS_JSON);
    const page = await openEditor(ctx);
    await startTyping(page, ' Golf hotel india.');
    await page.waitForTimeout(3500);
    const held = await backups(page);
    ok(`${engine}: 3.5 s after the typing paused, the backup holds it`, held.some((x) => x.includes('Golf hotel india')), held.map((x) => x.length));
    await ctx.close();
  } finally {
    await b.close();
  }
}
console.log(`\n=== Autosave survives a crash [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
