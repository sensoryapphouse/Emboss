// Audit batch S2a (ChatGPT audit of 15 Oct 2026, items 1-5; Paul: security first, then wrong-document / wrong-output):
// the braille you download, emboss or hand to another page must be the braille of the document you are looking at.
//
//   #1 Quick Mode: a second file chosen before the first has finished loading must not be replaced by the first.
//   #2 Editor: Download (BRF, PEF, eBraille) and Emboss during the 200 ms wait before the braille updates, during a slow
//      update, or right after a settings change, use the CURRENT document and settings (they wait for the update).
//   #3 Editor: after an update that failed as a whole, the previous document's braille is not downloadable or embossable;
//      a paragraph that fails alone (marked in the braille, A89) stays downloadable; a successful retry restores output.
//   #4 Two tabs changing mode at the same moment (editor <-> Quick Mode) each get their own document: one handoff per
//      transfer id, kept until the destination confirms, written only once the IndexedDB transaction has completed.
//   #5 A picture description still being typed is in the autosave backup, the NIMAS save and the Quick Mode transfer.
//
// Usage: node Emboss/scripts/serve.mjs 8201 &   then   node Emboss/tests/test-s2a-output.mjs [port]
// EMBOSS_ENGINE=webkit|firefox runs it in another engine (the tab-crash cases are Chrome-only).
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { readFile } from 'node:fs/promises';
import { launchBrowser, ENGINE, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail !== '' ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const errors = [];

const browser = await launchBrowser({ args: ['--no-sandbox'] });
// A fresh context per section: its own localStorage / IndexedDB, no service worker (so page.route sees every request).
const newCtx = async (settings, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, serviceWorkers: 'block', locale: 'en-US', ...extra });
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('s2a-init')) { sessionStorage.setItem('s2a-init', '1'); if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} }, settings);
  return ctx;
};
const watch = (page, label) => { page.on('pageerror', (e) => errors.push(`${label}: ${String(e).slice(0, 200)}`)); page.on('dialog', (d) => d.accept().catch(() => {})); return page; };
const download = async (page, itemId, { timeout = 20000 } = {}) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), page.evaluate((id) => document.getElementById(id).click(), itemId)]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
};
const noDownload = async (page, itemId, ms = 2500) => {
  let got = null;
  const h = (d) => { got = d.suggestedFilename(); };
  page.on('download', h);
  await page.evaluate((id) => document.getElementById(id).click(), itemId);
  await sleep(ms);
  page.off('download', h);
  return got;   // null when nothing was downloaded
};
const text = (b) => b.toString('utf8');

// ------------------------------------------------------------------------------------------------------------------
// #1 Quick Mode: overlapping imports
// ------------------------------------------------------------------------------------------------------------------
console.log('--- #1 Quick Mode: a second file chosen while the first is loading ---');
{
  const ctx = await newCtx({ simpleMode: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const page = watch(await ctx.newPage(), 'quick');
  const open = async () => {
    // the editor test above left "Simple mode" off in this profile's settings: turn it back on before opening Quick Mode
    await page.evaluate(() => { try { window.markDocumentClean?.(); const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}'); s.simpleMode = true; localStorage.setItem('emboss-settings', JSON.stringify(s)); } catch {} }).catch(() => {});
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => /^Ready/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
    // reading a file whose name starts "slow-" takes 1.5 s longer: the order the reads finish in is the test's to choose
    await page.evaluate(() => {
      for (const m of ['text', 'arrayBuffer']) {
        const orig = File.prototype[m];
        File.prototype[m] = async function () { const r = await orig.call(this); if (this.name.startsWith('slow-')) await new Promise((res) => setTimeout(res, 1500)); return r; };
      }
    });
  };
  const choose = (name, body, type = 'text/plain') => page.setInputFiles('#fileInput', { name, mimeType: type, buffer: Buffer.isBuffer(body) ? body : Buffer.from(body) });
  const resultReady = (name) => page.waitForFunction((n) => !document.getElementById('result').hidden && document.getElementById('fileName').textContent === n && (document.getElementById('preview').textContent || '').length > 0, name, { timeout: 30000 });
  const view = () => page.evaluate(() => ({ name: document.getElementById('fileName').textContent, preview: document.getElementById('preview').textContent, hidden: document.getElementById('result').hidden, status: document.getElementById('status').textContent }));
  const FIRST = 'FIRST document apple.', SECOND = 'SECOND document zebra.';

  await open();
  await choose('fast-second.txt', SECOND); await resultReady('fast-second.txt');
  const baseSecond = { view: await view(), dl: await (async () => { await page.click('#downloadBtn'); return download(page, 'downloadBrfItem'); })() };
  await open();
  await choose('slow-first.txt', FIRST); await resultReady('slow-first.txt');
  const baseFirst = { view: await view(), dl: await (async () => { await page.click('#downloadBtn'); return download(page, 'downloadBrfItem'); })() };
  ok('baselines differ (the two files give different braille)', baseFirst.view.preview !== baseSecond.view.preview && text(baseFirst.dl.bytes) !== text(baseSecond.dl.bytes));

  // the audit's reproduction: slow first, fast second
  await open();
  await choose('slow-first.txt', FIRST);
  await sleep(200);
  await choose('fast-second.txt', SECOND);
  await resultReady('fast-second.txt');
  await sleep(2600);   // the slow read has finished by now
  let v = await view();
  ok('#1: the name shown is the second file', v.name === 'fast-second.txt', v.name);
  ok('#1: the braille shown is the second file\'s, not the first\'s', v.preview === baseSecond.view.preview, { shown: v.preview.slice(0, 60), want: baseSecond.view.preview.slice(0, 60) });
  await page.click('#downloadBtn');
  const dl = await download(page, 'downloadBrfItem');
  ok('#1: the download is named for the second file', dl.name === 'fast-second.brf', dl.name);
  ok('#1: the download holds the second file\'s braille', text(dl.bytes) === text(baseSecond.dl.bytes), text(dl.bytes).slice(0, 80));
  // the editor handoff
  await Promise.all([page.waitForURL(/\/web\/editor\/index\.html/, { timeout: 30000 }), page.evaluate(() => document.getElementById('advancedBtn').click())]);
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0 && typeof window.isDocumentDirty === 'function', null, { timeout: 60000 });
  const edText = await page.evaluate(() => (window.lastModel?.blocks || []).map((b) => b.text || '').join(' '));
  ok('#1: the editor receives the second file', /SECOND document zebra/.test(edText) && !/FIRST/.test(edText), edText);
  await page.evaluate(() => window.markDocumentClean());

  // an older import that FAILS after the newer one succeeded must not touch it (a damaged .docx, and a .doc that is not Word)
  for (const [badName, badType] of [['slow-bad.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['slow-bad.doc', 'application/msword']]) {
    await open();
    await choose(badName, Buffer.from('this is not really a word file at all, just text'), badType);
    await sleep(200);
    await choose('fast-second.txt', SECOND);
    await resultReady('fast-second.txt');
    await sleep(2600);
    v = await view();
    ok(`#1: an older failing import (${badName}) arriving later changes nothing: name`, v.name === 'fast-second.txt', v);
    ok(`#1: ... the braille is still the second file's`, v.preview === baseSecond.view.preview && !v.hidden, { hidden: v.hidden, preview: v.preview.slice(0, 40) });
    ok(`#1: ... and the status is not the old file's error`, !/could not read|not a Word|damaged/i.test(v.status), v.status);
  }

  // the previous result is not usable while the new file is still loading
  await open();
  await choose('fast-second.txt', SECOND); await resultReady('fast-second.txt');
  await choose('slow-first.txt', FIRST);
  await sleep(300);
  v = await view();
  ok('#1: while the next file is loading the old result is withdrawn (not shown)', v.hidden === true, v);
  const early = await noDownload(page, 'downloadBrfItem', 600);
  ok('#1: ... and the old document cannot be downloaded then', early === null, early);
  await resultReady('slow-first.txt');
  v = await view();
  ok('#1: once loaded, name and braille are the new file\'s together', v.name === 'slow-first.txt' && v.preview === baseFirst.view.preview, v.name);
  // a hard failure (userFacing) of the LATEST file leaves the previous document and result as they were (existing rule)
  await choose('bad.docx', Buffer.from('this is not really a word file at all, just text'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await page.waitForFunction(() => /damaged|incomplete|not a Word/i.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  v = await view();
  ok('#1: a latest file that cannot be read keeps the previous document and its name', v.name === 'slow-first.txt' && !v.hidden && v.preview === baseFirst.view.preview, v);
  await ctx.close();
}

// ------------------------------------------------------------------------------------------------------------------
// #2 and #3: editor output is the current document
// ------------------------------------------------------------------------------------------------------------------
const EMBOSSER = { host: 'embosser.test', port: 9100 };
const editorCtx = () => newCtx({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', connectionType: 'network', networkHost: EMBOSSER.host, networkPort: EMBOSSER.port });
const openEditor = async (ctx, label) => {
  const page = watch(await ctx.newPage(), label);
  const posts = [];
  await page.route(`http://${EMBOSSER.host}:${EMBOSSER.port}/**`, async (route) => {
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    posts.push((route.request().postDataBuffer() || Buffer.alloc(0)).toString('latin1'));
    return route.fulfill({ status: 200, headers: h, body: 'ok' });
  });
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.render === 'function', null, { timeout: 60000 });
  await sleep(1500);
  return { page, posts };
};
const setDoc = (page, t) => page.evaluate(async (txt) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: txt }] }); await window.render(); }, t);
const status = (page) => page.evaluate(() => document.getElementById('docStats')?.textContent || '');
const firstLine = (brf) => (brf.split(/\r?\n/).map((l) => l.trim()).find((l) => l) || '');
const rowsOf = (pef) => [...pef.matchAll(/<row[^>]*>([^<]*)<\/row>/g)].map((m) => m[1]).join('\n');
const dotRuns = (b) => (text(b).match(/[⠀-⣿]+/g) || []).join('|');
const OLDT = 'OLD document apple.', NEWT = 'NEW document zebra.';

console.log('--- #2 editor: Download and Emboss use the current document ---');
{
  const ctx = await editorCtx();
  const { page, posts } = await openEditor(ctx, 'editor');
  await setDoc(page, OLDT);
  const oldBrf = text((await download(page, 'downloadBrfItem')).bytes);
  const oldPef = rowsOf(text((await download(page, 'downloadPefItem')).bytes));
  const oldEbrl = dotRuns((await download(page, 'downloadEbrlItem')).bytes);
  await setDoc(page, NEWT);
  const newBrf = text((await download(page, 'downloadBrfItem')).bytes);
  const newPef = rowsOf(text((await download(page, 'downloadPefItem')).bytes));
  const newEbrl = dotRuns((await download(page, 'downloadEbrlItem')).bytes);
  ok('baselines: OLD and NEW give different BRF, PEF rows and eBraille', oldBrf !== newBrf && oldPef !== newPef && oldEbrl !== newEbrl && newBrf.length > 0 && newPef.length > 0 && newEbrl.length > 0, { oldBrf, newBrf, oldPef: oldPef.slice(0, 50), newPef: newPef.slice(0, 50) });

  // (a) edit, then download before the 200 ms wait is over
  await setDoc(page, OLDT);
  for (const [fmt, id, pick, want, old] of [['BRF', 'downloadBrfItem', (b) => text(b), newBrf, oldBrf], ['PEF', 'downloadPefItem', (b) => rowsOf(text(b)), newPef, oldPef], ['eBraille', 'downloadEbrlItem', dotRuns, newEbrl, oldEbrl]]) {
    await setDoc(page, OLDT);
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.evaluate((i) => { window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); document.getElementById(i).click(); }, id),
    ]);
    const got = pick(await readFile(await dl.path()));
    ok(`#2: ${fmt} downloaded straight after an edit is the NEW document`, got === want && got !== old, got.slice(0, 80));
  }

  // (b) the same during a deliberately slow update (2 s of formatting)
  await setDoc(page, OLDT);
  await page.evaluate(() => { window.__embossTestFormatDelay = 2000; });
  const t0 = Date.now();
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); document.getElementById('downloadBrfItem').click(); }),
  ]);
  const slowText = text(await readFile(await dl2.path()));
  ok('#2: a BRF requested during a slow update is the NEW document (it waited)', slowText === newBrf && Date.now() - t0 > 1500, { ms: Date.now() - t0, slowText });
  // the "Preparing braille…" status shows during a noticeable wait
  await setDoc(page, OLDT);
  const prep = await page.evaluate(async () => {
    window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] });
    document.getElementById('downloadBrfItem').click();
    const seenS = [];
    for (let k = 0; k < 40; k++) { seenS.push(document.getElementById('docStats').textContent); await new Promise((r) => setTimeout(r, 100)); }
    return seenS;
  });
  ok('#2: a wait longer than a moment says "Preparing braille…"', prep.some((s) => s === 'Preparing braille…'), prep.slice(0, 12));
  await page.evaluate(() => { window.__embossTestFormatDelay = 0; });

  // (c) Emboss straight after an edit, and during a slow update
  await setDoc(page, OLDT);
  posts.length = 0;
  await page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); document.getElementById('embossBtn').click(); });
  await page.waitForFunction(() => /Sent|Could not|rejected/.test(document.getElementById('docStats').textContent), null, { timeout: 30000 }).catch(() => {});
  await sleep(500);
  ok('#2: Emboss straight after an edit sends the NEW document', posts.length === 1 && posts[0].includes(firstLine(newBrf)) && !posts[0].includes(firstLine(oldBrf)), { n: posts.length, body: (posts[0] || '').slice(0, 100), want: firstLine(newBrf) });
  await setDoc(page, OLDT);
  posts.length = 0;
  await page.evaluate(() => { window.__embossTestFormatDelay = 1500; window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); document.getElementById('embossBtn').click(); });
  await page.waitForFunction(() => /Sent|Could not|rejected/.test(document.getElementById('docStats').textContent), null, { timeout: 30000 }).catch(() => {});
  await sleep(500);
  ok('#2: Emboss during a slow update sends the NEW document', posts.length === 1 && posts[0].includes(firstLine(newBrf)) && !posts[0].includes(firstLine(oldBrf)), { n: posts.length, body: (posts[0] || '').slice(0, 100) });
  await page.evaluate(() => { window.__embossTestFormatDelay = 0; });

  // (d) a settings change (page width 40 -> 30 cells) followed at once by a download: the geometry is the new one
  await setDoc(page, 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega alpha beta gamma delta.');
  const wide = text((await download(page, 'downloadBrfItem')).bytes);
  const widest = (b) => Math.max(...b.split(/\r?\n/).map((l) => l.replace(/\f/g, '').length));
  const [dl3] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => { const c = document.getElementById('set-cells'); c.value = '30'; c.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('downloadBrfItem').click(); }),
  ]);
  const narrow = text(await readFile(await dl3.path()));
  ok('#2: a BRF downloaded straight after a page-width change has the new width', widest(wide) > 30 && widest(narrow) <= 30, { before: widest(wide), after: widest(narrow) });
  // put the page width back for the next section
  await page.evaluate(() => { const c = document.getElementById('set-cells'); c.value = '40'; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(600);
  await page.evaluate(() => window.markDocumentClean());
  await ctx.close();
}

console.log('--- #3 editor: nothing from a document whose braille failed ---');
{
  const ctx = await editorCtx();
  const { page, posts } = await openEditor(ctx, 'editor-fail');
  await setDoc(page, OLDT);
  const oldBrf = text((await download(page, 'downloadBrfItem')).bytes);
  await setDoc(page, NEWT);
  const newBrf = text((await download(page, 'downloadBrfItem')).bytes);

  // the whole update fails for the replacement document
  await setDoc(page, OLDT);
  await page.evaluate(async () => { window.__embossTestBreakBlock = () => true; window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); await window.render(); });
  await sleep(300);
  const pane = await page.evaluate(() => document.getElementById('braille').textContent);
  ok('setup: the braille pane shows the failure', /could not be generated/i.test(pane), pane.slice(0, 120));
  const got = await noDownload(page, 'downloadBrfItem', 2500);
  ok('#3: Download BRF is refused after a failed update (the old document is not downloaded)', got === null, got);
  const st = await status(page);
  ok('#3: ... and says why', /Nothing was downloaded/.test(st) && /could not be made/.test(st), st);
  ok('#3: PEF and eBraille are refused too', (await noDownload(page, 'downloadPefItem', 1500)) === null && (await noDownload(page, 'downloadEbrlItem', 1500)) === null);
  posts.length = 0;
  await page.evaluate(() => document.getElementById('embossBtn').click());
  await sleep(2000);
  ok('#3: Emboss sends nothing after a failed update', posts.length === 0, posts.map((p) => p.slice(0, 60)));
  ok('#3: ... and says why', /Nothing was sent to the embosser/.test(await status(page)), await status(page));
  // still editable
  await page.click('#editor p >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.type(' typed after the failure');
  ok('#3: the document stays editable after a failed update', /typed after the failure/.test(await page.evaluate(() => document.getElementById('editor').textContent)));
  ok('#3: ... and a further download is still refused', (await noDownload(page, 'downloadBrfItem', 1500)) === null);

  // a successful retry restores output for the replacement
  await page.evaluate(() => { window.__embossTestBreakBlock = null; });
  await setDoc(page, NEWT);
  await page.evaluate(() => { window.__embossTestBreakBlock = () => true; });
  await page.evaluate(async () => { window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); await window.render(); });
  await page.evaluate(() => { window.__embossTestBreakBlock = null; });
  const retried = await download(page, 'downloadBrfItem');
  ok('#3: once the cause is gone, Download retries the update and gives the current document', text(retried.bytes) === newBrf, text(retried.bytes).slice(0, 60));

  // failure, then an edit that brailles again
  await page.evaluate(async () => { window.__embossTestBreakBlock = () => true; window.modelToLexical({ blocks: [{ type: 'para', text: 'OLD document apple.' }] }); await window.render(); });
  await page.evaluate(() => { window.__embossTestBreakBlock = null; window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); });
  const afterEdit = await download(page, 'downloadBrfItem');
  ok('#3: an edit after a failure, then Download, gives the edited document', text(afterEdit.bytes) === newBrf && text(afterEdit.bytes) !== oldBrf, text(afterEdit.bytes).slice(0, 60));
  posts.length = 0;
  await page.evaluate(() => document.getElementById('embossBtn').click());
  await page.waitForFunction(() => /Sent|Could not|rejected/.test(document.getElementById('docStats').textContent), null, { timeout: 20000 }).catch(() => {});
  await sleep(400);
  ok('#3: Emboss works again once the update has succeeded', posts.length === 1 && posts[0].includes(firstLine(newBrf)), { n: posts.length });

  // a failure caused by a settings change
  await setDoc(page, NEWT);
  await page.evaluate(async () => { window.__embossTestBreakBlock = () => true; const c = document.getElementById('set-cells'); c.value = '36'; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(1200);
  ok('#3: a failure after a settings change also refuses Download', (await noDownload(page, 'downloadBrfItem', 1500)) === null);
  await page.evaluate(() => { window.__embossTestBreakBlock = null; const c = document.getElementById('set-cells'); c.value = '40'; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(800);

  // a paragraph that fails ALONE is marked and the rest stays downloadable (A89, tests/test-block-failure.mjs)
  await page.evaluate(async () => {
    window.markDocumentClean();
    window.modelToLexical({ blocks: [{ type: 'para', text: 'First paragraph about cats.' }, { type: 'para', text: 'Second paragraph BREAK ME here.' }, { type: 'para', text: 'Third paragraph about dogs.' }] });
    window.__embossTestBreakBlock = (b) => JSON.stringify(b).includes('BREAK ME');
    await window.render();
  });
  const partial = await download(page, 'downloadBrfItem');
  ok('a paragraph that fails alone does not stop the download: the rest is in it', /CATS/i.test(text(partial.bytes)) && /DOGS/i.test(text(partial.bytes)), text(partial.bytes).slice(0, 100));
  await page.evaluate(() => { window.__embossTestBreakBlock = null; window.markDocumentClean(); });
  await ctx.close();
}

// ------------------------------------------------------------------------------------------------------------------
// #4 two tabs changing mode at the same moment
// ------------------------------------------------------------------------------------------------------------------
console.log('--- #4 two tabs switching mode at the same moment ---');
{
  // editor -> Quick Mode, both navigations held until both tabs have stored their document
  const ctx = await newCtx({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const pages = [];
  for (const [label, title, word] of [['A', 'Alpha Title', 'alpha'], ['B', 'Beta Title', 'beta']]) {
    const page = watch(await ctx.newPage(), `tab${label}`);
    await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await sleep(1200);
    await page.evaluate(async ([ti, w]) => { window.markDocumentClean(); window.modelToLexical({ title: ti, blocks: [{ type: 'heading', level: 1, text: ti }, { type: 'para', text: `Paragraph about the ${w} document.` }] }); await window.render(); }, [title, word]);
    pages.push({ page, title, word });
  }
  let arrived = 0, release;
  const gate = new Promise((r) => { release = r; });
  for (const p of pages) await p.page.route('**/web/index.html', async (route) => { arrived++; if (arrived >= 2) release(); await gate; await route.continue(); });
  await Promise.all(pages.map((p) => p.page.evaluate(() => { document.getElementById('backToSimple').click(); })));
  await Promise.all(pages.map((p) => p.page.waitForURL(/\/web\/index\.html/, { timeout: 30000 })));
  await Promise.all(pages.map((p) => p.page.waitForFunction(() => document.getElementById('fileName')?.textContent && document.getElementById('fileName').textContent !== '' && !document.getElementById('result').hidden, null, { timeout: 30000 }).catch(() => {})));
  for (const p of pages) {
    const got = await p.page.evaluate(() => ({ name: document.getElementById('fileName').textContent, preview: document.getElementById('preview').textContent }));
    ok(`#4: editor -> Quick Mode, tab with "${p.title}" receives its own document`, got.name.includes(p.title), got);
  }
  await ctx.close();
}
{
  // Quick Mode -> editor, the same
  const ctx = await newCtx({ simpleMode: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const pages = [];
  for (const [label, body, marker] of [['A', 'Quick alpha paragraph.', 'alpha'], ['B', 'Quick beta paragraph.', 'beta']]) {
    const page = watch(await ctx.newPage(), `quick${label}`);
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => /^Ready/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
    await page.setInputFiles('#fileInput', { name: `quick-${marker}.txt`, mimeType: 'text/plain', buffer: Buffer.from(body) });
    await page.waitForFunction((n) => document.getElementById('fileName').textContent === n && !document.getElementById('result').hidden, `quick-${marker}.txt`, { timeout: 30000 });
    pages.push({ page, marker });
  }
  let arrived = 0, release;
  const gate = new Promise((r) => { release = r; });
  for (const p of pages) await p.page.route('**/web/editor/index.html', async (route) => { arrived++; if (arrived >= 2) release(); await gate; await route.continue(); });
  await Promise.all(pages.map((p) => p.page.evaluate(() => document.getElementById('advancedBtn').click())));
  await Promise.all(pages.map((p) => p.page.waitForURL(/\/web\/editor\/index\.html/, { timeout: 30000 })));
  await Promise.all(pages.map((p) => p.page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0 && typeof window.isDocumentDirty === 'function', null, { timeout: 60000 }).catch(() => {})));
  await sleep(500);
  for (const p of pages) {
    const got = await p.page.evaluate(() => (window.lastModel?.blocks || []).map((b) => b.text || '').join(' '));
    ok(`#4: Quick Mode -> editor, tab with the "${p.marker}" file receives its own document`, got.includes(`Quick ${p.marker} paragraph`), got);
  }
  for (const p of pages) await p.page.evaluate(() => window.markDocumentClean && window.markDocumentClean()).catch(() => {});
  await ctx.close();
}
{
  // the handoff module itself
  const ctx = await newCtx({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const page = watch(await ctx.newPage(), 'handoff-api');
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const out = {};
    const api = await import('/web/handoff-db.mjs');
    out.hasApi = ['newHandoffId', 'setHandoffDoc', 'readHandoff', 'confirmHandoff'].every((n) => typeof api[n] === 'function');
    if (!out.hasApi) return out;
    const A = { blocks: [{ type: 'para', text: 'doc A' }] }, B = { blocks: [{ type: 'para', text: 'doc B' }] };
    const idA = api.newHandoffId(), idB = api.newHandoffId();
    out.distinct = idA !== idB && /^[\w-]{8,}$/.test(idA);
    // two sources store, then the destinations read: each gets its own
    out.setA = await api.setHandoffDoc(A, idA);
    out.setB = await api.setHandoffDoc(B, idB);
    const gotA = await api.readHandoff(idA), gotB = await api.readHandoff(idB);
    out.interleave = [gotA?.doc?.blocks?.[0]?.text, gotB?.doc?.blocks?.[0]?.text];
    // an interrupted transfer: read without confirming leaves the document there; confirming removes it
    const again = await api.readHandoff(idA);
    out.keptUntilConfirm = again?.doc?.blocks?.[0]?.text;
    await api.confirmHandoff(gotA);
    out.goneAfterConfirm = (await api.readHandoff(idA)) === null;
    out.otherUntouched = (await api.readHandoff(idB))?.doc?.blocks?.[0]?.text;
    await api.confirmHandoff(gotB);
    // an id nobody stored
    out.unknownId = (await api.readHandoff('no-such-transfer')) === null;
    // persistence that fails: put() throws
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('simulated', 'DataCloneError'); };
    try { out.failedPut = await api.setHandoffDoc(A, api.newHandoffId()); } finally { IDBObjectStore.prototype.put = origPut; }
    // persistence that is reported and then rolled back: the transaction aborts after put() succeeded
    IDBObjectStore.prototype.put = function (...a) { const rq = origPut.apply(this, a); queueMicrotask(() => { try { this.transaction.abort(); } catch {} }); return rq; };
    let idAbort;
    try { idAbort = api.newHandoffId(); out.abortedPut = await api.setHandoffDoc(A, idAbort); } finally { IDBObjectStore.prototype.put = origPut; }
    // (readHandoff would find the sessionStorage copy a failed write leaves for this tab, so look in IndexedDB itself)
    out.abortedNotStored = await new Promise((res) => { const q = indexedDB.open('emboss_db', 1); q.onsuccess = () => { const g = q.result.transaction('handoff_store', 'readonly').objectStore('handoff_store').get('handoff:' + idAbort); g.onsuccess = () => res(g.result ?? null); }; q.onerror = () => res('error'); });
    sessionStorage.clear();
    // a transfer started by the OLD version: one fixed key, read once
    await new Promise((res, rej) => {
      const q = indexedDB.open('emboss_db', 1);
      q.onsuccess = () => { const tx = q.result.transaction('handoff_store', 'readwrite'); tx.objectStore('handoff_store').put({ blocks: [{ type: 'para', text: 'legacy doc' }] }, 'pending_editor_doc'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); };
      q.onerror = () => rej(q.error);
    });
    const leg = await api.readHandoff(null);
    out.legacy = leg?.doc?.blocks?.[0]?.text;
    if (leg) await api.confirmHandoff(leg);
    out.legacyOnce = (await api.readHandoff(null)) === null;
    return out;
  });
  ok('#4: the handoff module has newHandoffId / setHandoffDoc / readHandoff / confirmHandoff', r.hasApi === true, r);
  if (r.hasApi) {
    ok('#4: transfer ids are distinct', r.distinct === true, r);
    ok('#4: two stored transfers are each read back as their own document', r.setA === true && r.setB === true && r.interleave[0] === 'doc A' && r.interleave[1] === 'doc B', r);
    ok('#4: reading does not remove the document (kept until the destination confirms)', r.keptUntilConfirm === 'doc A', r);
    ok('#4: confirming removes it and leaves the other transfer alone', r.goneAfterConfirm === true && r.otherUntouched === 'doc B', r);
    ok('#4: an id nobody stored reads as nothing', r.unknownId === true, r);
    ok('#4: a failed write is reported as not stored', r.failedPut === false, r);
    ok('#4: a transaction that aborts after put() is reported as not stored (waits for oncomplete)', r.abortedPut === false && r.abortedNotStored === null, r);
    ok('#4: a transfer from the old version (the fixed key) is still read, once', r.legacy === 'legacy doc' && r.legacyOnce === true, r);
  }
  await ctx.close();
}

// ------------------------------------------------------------------------------------------------------------------
// #5 a picture description still being typed
// ------------------------------------------------------------------------------------------------------------------
console.log('--- #5 a picture description being typed is backed up, saved and carried to Quick Mode ---');
const backups = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('emboss_autosave_db');
  req.onerror = () => resolve([]);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('autosave_store')) { resolve([]); return; }
    const all = db.transaction('autosave_store', 'readonly').objectStore('autosave_store').getAll();
    all.onsuccess = () => resolve((all.result || []).flatMap((rec) => (rec?.snapshots || (rec?.xml ? [rec] : [])).map((s) => s.xml || '')));
    all.onerror = () => resolve([]);
  };
}));
const MARKER = 'UNSAVED DESCRIPTION MARKER';
const typeDescription = async (page) => {
  await page.evaluate(async (src) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Before the picture.' }, { type: 'graphic', src, alt: 'ORIGINAL DESCRIPTION' }, { type: 'para', text: 'After it.' }] }); await window.render(); }, PNG);
  await sleep(600);
  await page.evaluate(() => window.markDocumentClean());
  await page.click('#editor .doc-image-block textarea.doc-image-alt');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type(MARKER);
};
{
  const ctx = await newCtx({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const page = watch(await ctx.newPage(), 'desc');
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
  await sleep(1500);
  await typeDescription(page);
  ok('setup: the box still has the focus and the document is reported unsaved', await page.evaluate(() => document.activeElement?.classList.contains('doc-image-alt') && window.isDocumentDirty()));
  // the audit's reproduction: the same snapshot tick the crash tests use, focus still in the box
  await page.evaluate(() => window.__forceAutosaveTick());
  let b = await backups(page);
  ok('#5: the autosave snapshot taken while the box is still being typed in has the new description', b.some((x) => x.includes(MARKER)), b.map((x) => x.slice(x.indexOf('alt='), x.indexOf('alt=') + 60)));
  ok('#5: ... and not only the old one', !b.some((x) => x.includes('ORIGINAL DESCRIPTION') && !x.includes(MARKER)), b.length);
  // a NIMAS save while still typing
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('#5: a save while the box is still being typed in has the new description', xml.includes(MARKER) && !xml.includes('ORIGINAL DESCRIPTION'), xml.slice(xml.indexOf('<img'), xml.indexOf('<img') + 160));
  // leaving the box still works (the old path)
  await page.keyboard.press('Tab');
  await sleep(500);
  ok('#5: leaving the box still commits the description to the document', await page.evaluate(() => /UNSAVED DESCRIPTION MARKER/.test(window.exportCurrentDocumentXml())));
  // autosave is scheduled by the typing itself (no forced tick, no leaving the box)
  await page.evaluate(async (src) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Before.' }, { type: 'graphic', src, alt: 'ORIGINAL DESCRIPTION' }] }); await window.render(); await window.__clearAutosaveSnapshot?.(); }, PNG);
  await sleep(600);
  await page.evaluate(() => window.markDocumentClean());
  await page.click('#editor .doc-image-block textarea.doc-image-alt');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type('TYPED AND NOT FORCED');
  await sleep(4200);   // AUTOSAVE_QUIET_MS is 2 s
  b = await backups(page);
  ok('#5: typing in the box schedules an autosave by itself (a backup within seconds, nothing forced)', b.some((x) => x.includes('TYPED AND NOT FORCED')), b.map((x) => x.length));
  await page.evaluate(() => window.markDocumentClean());
  await ctx.close();
}
{
  // carried to Quick Mode while the box still has the focus
  const ctx = await newCtx({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const page = watch(await ctx.newPage(), 'desc-qm');
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
  await sleep(1500);
  await typeDescription(page);
  await Promise.all([page.waitForURL(/\/web\/index\.html/, { timeout: 30000 }), page.evaluate(() => document.getElementById('backToSimple').click())]);   // click() leaves the focus in the box
  await page.waitForFunction(() => !document.getElementById('result')?.hidden && (document.getElementById('preview')?.textContent || '').length > 0, null, { timeout: 60000 });
  // ... and back to the editor from Quick Mode: the description box holds the text that was being typed
  await Promise.all([page.waitForURL(/\/web\/editor\/index\.html/, { timeout: 30000 }), page.evaluate(() => document.getElementById('advancedBtn').click())]);
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0 && typeof window.isDocumentDirty === 'function', null, { timeout: 60000 });
  await sleep(500);
  const alt = await page.evaluate(() => document.querySelector('#editor .doc-image-block textarea.doc-image-alt')?.value ?? null);
  ok('#5: a description being typed goes to Quick Mode with the document (and comes back)', alt === MARKER, alt);
  await page.evaluate(() => window.markDocumentClean());
  await ctx.close();
}
if (ENGINE === 'chrome') {
  // crash the tab while the box is still being typed in, and recover in a new tab (as tests/test-autosave-crash.mjs does)
  const ctx = await newCtx({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const page = watch(await ctx.newPage(), 'desc-crash');
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
  await sleep(1500);
  await typeDescription(page);
  await sleep(4200);   // autosave runs (nothing forced); the box still has the focus
  const cdp = await ctx.newCDPSession(page);
  const crashed = new Promise((res) => page.once('crash', res));
  cdp.send('Page.crash').catch(() => {});
  await Promise.race([crashed, sleep(5000)]);
  await sleep(300);
  const p2 = watch(await ctx.newPage(), 'desc-recover');
  await p2.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await p2.waitForSelector('#autosaveRecoverDialog[open]', { timeout: 30000 }).catch(() => {});
  const offered = await p2.evaluate(() => !!document.querySelector('#autosaveRecoverDialog[open]'));
  if (offered) { await p2.click('#autosaveRecoverBtn'); await sleep(2500); }
  const alt = await p2.evaluate(() => document.querySelector('#editor .doc-image-block textarea.doc-image-alt')?.value ?? null);
  ok('#5: after a crash with the box still being typed in, Recover brings the new description back', offered && alt === MARKER, { offered, alt });
  await p2.evaluate(() => window.markDocumentClean && window.markDocumentClean()).catch(() => {});
  await ctx.close();
} else {
  console.log(`  - skipped in ${ENGINE_LABEL}: the tab-crash case (crashing a tab needs Chrome's DevTools protocol)`);
}

ok('no page errors', errors.length === 0, errors);
await browser.close();
console.log(`\n=== S2a output [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
