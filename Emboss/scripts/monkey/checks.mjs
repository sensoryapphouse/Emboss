// The slower invariants of the monkey test (A89 step 3, Paul 2 Oct 2026), run by the 'check' action every 15-25 actions and once
// at the end of a session (Emboss/scripts/monkey-test.mjs, monkey/session.mjs, monkey/actions-wide.mjs):
//
//   save-reopen   window.exportCurrentDocumentXml() -> loaded into a fresh editor (a new browser context, the same settings) ->
//                 window.lastBrf is identical to the first editor's, once both have settled. On a difference: the first
//                 differing lines of the two BRFs.
//   recovery      ~4 s after the last change (the editor backs up ~2 s after typing pauses) the page is reloaded; the
//                 "Recover unsaved work?" offer is accepted; the recovered document's saved XML equals the one before the reload
//                 (after normaliseXml). A document with unsaved changes that is not offered at all is 'recovery-missing'.
//   heap-growth   (Chrome) usedJSHeapSize after a forced GC (Chrome is started with --js-flags=--expose-gc), sampled at every
//                 check: the latest sample more than --heap-mb (default 300) above the lowest earlier one.
//   settle-slow   the time the braille takes to settle after a one-letter edit (typed, then deleted; the smaller of the two), sampled
//                 at every check: more than 3x the first sample taken on this document (and more than 800 ms above it, and
//                 confirmed by two more measurements), unless the braille itself has grown to twice its size since.
import { pageInit } from './pageinit.mjs';
import { settleEditor } from './settle.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(`timeout after ${ms} ms: ${what}`), { isTimeout: true })), ms))]);
const EDITOR_URL = '/web/editor/index.html';

// ---------------------------------------------------------------- comparing saved XML
// Volatile parts of exportCurrentDocumentXml() that legitimately differ between two saves of the same document, and so are
// blurred before two saves are compared (recovery check). Each entry says why.
//   - dtb:uid / dc:Identifier   a fresh identifier is made for a document saved without one
//   - dc:Date / dtb:date / ISO dates and times in <meta> and in attributes (modified, created, savedAt)   the time of the save
//   - generator / version strings   which build wrote the file
export function normaliseXml(xml) {
  return String(xml)
    .replace(/<meta\s+name="(dtb:uid|dc:Identifier|dc:Date|dtb:date|dtb:generator|dtb:modified|dcterms:modified)"[^>]*>/gi, '<meta name="$1" content="~"/>')
    .replace(/\b(dtb:uid|dc:Identifier)="[^"]*"/gi, '$1="~"')
    .replace(/\b(modified|created|savedAt|date)="\d{4}-\d{2}-\d{2}[^"]*"/gi, '$1="~"')
    .replace(/\r\n/g, '\n');
}
function xmlLines(x) { return String(x).replace(/></g, '>\n<').split('\n'); }
// the first few lines where two texts differ: [{ n, a, b }]
export function firstDiffs(a, b, split = (x) => String(x).split('\n'), max = 3) {
  const A = split(a), B = split(b);
  const out = [];
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n && out.length < max; i++) if (A[i] !== B[i]) out.push({ n: i + 1, a: A[i] === undefined ? '(no such line)' : A[i], b: B[i] === undefined ? '(no such line)' : B[i] });
  return { diffs: out, la: A.length, lb: B.length };
}
const cut = (s, n = 150) => { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const showDiffs = (d, labelA, labelB) => `${labelA} has ${d.la} lines, ${labelB} has ${d.lb}; first differences: ` + d.diffs.map((x) => `line ${x.n}: ${labelA} ${JSON.stringify(cut(x.a))} / ${labelB} ${JSON.stringify(cut(x.b))}`).join(' | ');

// ---------------------------------------------------------------- a second page
async function editorReady(page, ms = 60000) {
  await page.waitForFunction(() => typeof window.importFile === 'function' && window.lastModel && window.__mk, null, { timeout: ms });
  await sleep(700);
}
// The text of a console message. Playwright prints an object argument as "JSHandle@object" (Firefox does that for console.error(error));
// the message, stack or JSON of the objects is fetched instead, so the failure says what the page reported.
export async function consoleText(m) {
  const t = m.text();
  if (!/JSHandle@/.test(t)) return t;
  try {
    const parts = await Promise.all(m.args().map((a) => a.evaluate((x) => {
      if (x && typeof x === 'object') return String(x.stack || x.message || JSON.stringify(x, Object.getOwnPropertyNames(x)));
      return String(x);
    }).catch(() => '?')));
    return parts.join(' ');
  } catch { return t; }
}
export function hookErrors(page, sink, tag) {
  page.on('pageerror', (e) => sink.push({ src: 'pageerror', msg: `[${tag}] ` + String((e && e.stack) || e).slice(0, 1200) }));
  page.on('console', async (m) => { if (m.type() === 'error') sink.push({ src: 'console.error', msg: `[${tag}] ` + (await consoleText(m)).slice(0, 600) + (m.location() && m.location().url ? `  [${m.location().url}:${m.location().lineNumber}]` : '') }); });
  page.on('crash', () => sink.push({ src: 'crash', msg: `[${tag}] the page crashed` }));
  page.on('dialog', (d) => d.accept().catch(() => {}));
}

// The block signatures (pageinit.mjs blockSigs) without the empty paragraphs, empty list items and empty table rows.
function stripEmpty(sigs) {
  const cellEmpty = (c) => (typeof c === 'string' ? !c.trim() : !c || (!(c.text || '').trim() && !(c.segments && c.segments.some((s) => (s.text || '').trim() || s.type === 'math'))));
  const out = [];
  for (const s of sigs) {
    const i = s.indexOf('|');
    const type = s.slice(0, i);
    if (type !== 'list' && type !== 'table' && type !== 'para') { out.push(s); continue; }
    let j;
    try { j = JSON.parse(s.slice(i + 1)); } catch { out.push(s); continue; }   // cut short: left as it is
    if (type === 'para') { if (cellEmpty(j)) continue; out.push(s); continue; }   // an empty paragraph
    if (type === 'list' && Array.isArray(j.items)) {
      j.items = j.items.filter((it) => !cellEmpty(it));
      if (!j.items.length) continue;
    } else if (type === 'table' && Array.isArray(j.rows)) j.rows = j.rows.filter((r) => Array.isArray(r) && r.some((c) => !cellEmpty(c)));
    out.push(type + '|' + JSON.stringify(j));
  }
  return out;
}

// ---------------------------------------------------------------- save / reopen
export async function saveReopenCheck(env, o) {
  const res = { viol: [], note: '' };
  const { page } = env;
  const big = env.large;
  const first = await page.evaluate(() => {
    try { return { xml: window.exportCurrentDocumentXml(), brf: window.lastBrf, settings: localStorage.getItem('emboss-settings'), blocks: window.__mk.blockSigs() }; } catch (e) { return { thrown: String((e && e.stack) || e).slice(0, 400) }; }
  });
  if (first.thrown) { res.viol.push({ inv: 'save-export', msg: 'the save (exportCurrentDocumentXml) threw: ' + first.thrown }); return res; }
  if (typeof first.brf !== 'string') return res;           // brf-missing is reported by the state check
  const vp = page.viewportSize() || { width: 1300, height: 900 };
  let ctx2;
  try {
    ctx2 = await withTimeout(env.browser.newContext({ viewport: vp, acceptDownloads: true, locale: 'en-US', serviceWorkers: 'block' }), 30000, 'newContext (reopen)');
    await ctx2.addInitScript(pageInit, first.settings || '{}');
    const p2 = await ctx2.newPage();
    hookErrors(p2, env.errors, 'reopened tab');
    await p2.goto(`http://localhost:${o.port}${EDITOR_URL}`, { waitUntil: 'load', timeout: 60000 });
    await editorReady(p2);
    const env2 = { page: p2, renderBias: 0 };
    const loaded = await withTimeout(p2.evaluate(async (xml) => {
      if (window.markDocumentClean) window.markDocumentClean();
      try { await window.importFile(new File([xml], 'saved.xml')); return null; } catch (e) { return String((e && e.stack) || e).slice(0, 400); }
    }, first.xml), big ? 180000 : 90000, 'importFile (reopen)');
    if (loaded) { res.viol.push({ inv: 'save-reopen', msg: 'loading the saved file into a fresh editor threw: ' + loaded }); return res; }
    await sleep(400);
    const s2 = await settleEditor(env2, big ? 120000 : 40000, 350);
    const second = await p2.evaluate(() => ({ brf: window.lastBrf, blocks: window.__mk.blockSigs(), failed: /Braille could not be generated/.test((document.getElementById('braille') || {}).textContent || '') }));
    res.note = `${first.brf.length} / ${typeof second.brf === 'string' ? second.brf.length : '?'} chars${s2.settled ? '' : ' (reopened tab not settled: ' + s2.why + ')'}`;
    if (!s2.settled) return res;                         // cannot compare a braille that has not finished: not a finding here
    if (typeof second.brf !== 'string') { res.viol.push({ inv: 'save-reopen', msg: 'the reopened editor has no braille (window.lastBrf is ' + typeof second.brf + ')' }); return res; }
    if (second.brf !== first.brf) {
      const d = firstDiffs(first.brf, second.brf);
      // which block changed first (the model's blocks, ignoring the ids and attributes that only a saved file adds): its type tells
      // the kinds of fault apart, so one kind (say, equations) does not hide the others in the run's list of distinct problems
      const rawA = first.blocks || [], rawB = second.blocks || [];
      const firstDiff = (X, Y) => { for (let i = 0; i < Math.max(X.length, Y.length); i++) if (X[i] !== Y[i]) return i; return -1; };
      // an empty paragraph, empty list item or empty table row is not kept by a save: that is its own (lesser) kind of fault, so it
      // does not hide the others; the first difference is looked for among the blocks without such empties
      const A = stripEmpty(rawA), B = stripEmpty(rawB);
      const at = firstDiff(A, B);
      let kind = at >= 0 ? `${(A[at] || B[at] || '?|').split('|')[0]}` : firstDiff(rawA, rawB) >= 0 ? 'empty-content-not-saved' : 'no block differs';
      // an equation that holds only a TeX annotation (<m:semantics><m:annotation>, no presentation MathML: the generated corpus has
      // many) is its own kind of fault, so it does not hide other equation faults
      if (kind === 'math' && /<semantics>\s*<annotation/.test(A[at] || '')) kind = 'math-annotation-only';
      // the two blocks differ only in spaces (a space at the edge of a paragraph or of a bold run is trimmed by a save)
      else if (at >= 0 && A[at] && B[at] && A[at].replace(/\s+/g, '') === B[at].replace(/\s+/g, '')) kind += '-whitespace';
      // a first tab with no braille at all (after "Clear", say) reopens as a new document does, with its title page: its own kind
      if (!first.brf.replace(/[\s\f]/g, '')) kind = 'first-tab-has-no-braille';
      const where = at < 0 ? (rawA.length !== rawB.length ? `${rawA.length} blocks, reopened ${rawB.length}` : 'blocks equal') : `block #${at} not counting empty ones, ${A[at] ? A[at].split('|')[0] : '(none)'} / ${B[at] ? B[at].split('|')[0] : '(none)'}`;
      res.viol.push({ inv: 'save-reopen', msg: `the saved file reopens to different braille [first differing block: ${kind}] (${where}): ` + showDiffs(d, 'first tab', 'reopened tab') });
      // EMBOSS_MONKEY_DUMP=DIR keeps the saved file and both braille files of a save-reopen difference, to look at it closely
      if (process.env.EMBOSS_MONKEY_DUMP) {
        const fs = await import('node:fs'); const dir = process.env.EMBOSS_MONKEY_DUMP;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${dir}/saved.xml`, first.xml); fs.writeFileSync(`${dir}/first-tab.brf`, first.brf); fs.writeFileSync(`${dir}/reopened-tab.brf`, second.brf);
        const fresh = await page.evaluate(async () => { if (window.clearTranslationCache) window.clearTranslationCache(); await window.render(); return window.lastBrf; }).catch(() => null);
        if (typeof fresh === 'string') fs.writeFileSync(`${dir}/first-tab-fresh.brf`, fresh);
        const fm = await page.evaluate(() => JSON.stringify(window.lastModel)).catch(() => null);
        if (fm) fs.writeFileSync(`${dir}/first-tab-model.json`, fm);
        const rm = await p2.evaluate(() => JSON.stringify(window.lastModel)).catch(() => null);
        if (rm) fs.writeFileSync(`${dir}/reopened-tab-model.json`, rm);
      }
    }
  } finally {
    if (ctx2) { try { await withTimeout(ctx2.close(), 15000, 'ctx2.close'); } catch { /* gone */ } }
  }
  return res;
}

// The XML a fresh editor (a new browser context, `settings` in its local storage) gives back for `xml`: loaded, settled, saved again.
async function freshEditorExport(env, o, xml, settings) {
  const vp = env.page.viewportSize() || { width: 1300, height: 900 };
  const ctx2 = await withTimeout(env.browser.newContext({ viewport: vp, locale: 'en-US', serviceWorkers: 'block' }), 30000, 'newContext (reference)');
  try {
    await ctx2.addInitScript(pageInit, settings || '{}');
    const p2 = await ctx2.newPage();
    hookErrors(p2, env.errors, 'reference tab');
    await p2.goto(`http://localhost:${o.port}${EDITOR_URL}`, { waitUntil: 'load', timeout: 60000 });
    await editorReady(p2);
    await withTimeout(p2.evaluate(async (x) => { if (window.markDocumentClean) window.markDocumentClean(); await window.importFile(new File([x], 'saved.xml')); }, xml), 90000, 'importFile (reference)');
    await sleep(400);
    await settleEditor({ page: p2, renderBias: 0 }, 40000, 350);
    return await p2.evaluate(() => window.exportCurrentDocumentXml());
  } finally { try { await withTimeout(ctx2.close(), 15000, 'ctx2.close'); } catch { /* gone */ } }
}

// ---------------------------------------------------------------- recovery
export async function recoveryCheck(env, o) {
  const res = { viol: [], note: '' };
  const { page } = env;
  const before = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const textOf = (e) => { const c = e.cloneNode(true); c.querySelectorAll('button,math-field,svg').forEach((x) => x.remove()); return c.textContent || ''; };
    const emptyKid = (e) => !textOf(e).trim() && [...e.querySelectorAll('math-field')].every((m) => !String(m.value || '').trim()) && !e.querySelector('img:not([data-lexical-managed-linebreak]),table,.doc-image-block,.doc-table-block,.doc-break,.doc-print-page') && !/doc-image-block|doc-table-block|doc-break|doc-print-page/.test(e.className || '');
    const titleTyped = !!((document.getElementById('docTitleInput') || {}).value || '').trim();
    let xml = null, thrown = null;
    try { xml = window.exportCurrentDocumentXml(); } catch (e) { thrown = String((e && e.stack) || e).slice(0, 300); }
    return { settings: localStorage.getItem('emboss-settings'), dirty: !!(window.isDocumentDirty && window.isDocumentDirty()), empty: !titleTyped && [...ed.children].every(emptyKid), xml, thrown };
  });
  if (before.thrown) { res.viol.push({ inv: 'save-export', msg: 'the save (exportCurrentDocumentXml) threw: ' + before.thrown }); return res; }
  const expect = before.dirty && !before.empty;
  if (!expect) { res.note = before.empty ? 'empty document: nothing to recover' : 'no unsaved changes: nothing to recover'; return res; }   // (a reload would only lose the document the session is working on)
  // A phone-sized screen (the 'phone' action; in a test browser the screen follows the window) is Quick Mode only (Paul, 18 Oct 2026): a reload of the
  // editor there goes to Quick Mode, as it should, so this reload check waits for the next one at a computer's size.
  if (await page.evaluate(() => Math.min(screen.width, screen.height) < 500).catch(() => false)) { res.note = 'phone-sized screen: a reload goes to Quick Mode (Quick Mode only on a phone); not checked here'; return res; }
  await sleep(4000);                                      // the backup follows ~2 s after the last change
  env.navOk = true;
  try {
    await withTimeout(page.reload({ waitUntil: 'load', timeout: 60000 }), 70000, 'reload');
    env.renderBias = 0;
    if (!page.url().includes('/web/editor/')) {
      res.viol.push({ inv: 'navigated-away', msg: `reloading the editor page opened ${page.url()} instead (the settings in the browser: ${await page.evaluate(() => localStorage.getItem('emboss-settings')).catch(() => '?')})` });
      return res;
    }
    // (the editor starts after the offer is answered, so wait for the editor OR the offer)
    await page.waitForFunction(() => (typeof window.importFile === 'function' && window.lastModel && window.__mk) || (document.getElementById('autosaveRecoverBtn') && document.getElementById('autosaveRecoverBtn').offsetWidth > 0), null, { timeout: 60000 });
    // At phone width a reloaded editor first offers Quick Mode (feedback 30 Sep item 12) with "Go to Quick Mode" ready for Enter;
    // the session goes on in the editor, as when it started (session.mjs) — found 3 Oct: the next Enter left for Quick Mode.
    const phoneAnyway = () => page.evaluate(() => { const n = document.getElementById('phoneNotice'); const b = document.getElementById('phoneNoticeAnyway'); if (n && !n.hidden && b && n.offsetWidth > 0) b.click(); }).catch(() => {});
    await phoneAnyway();
    let offered = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (await page.evaluate(() => { const b = document.getElementById('autosaveRecoverBtn'); return !!(b && b.offsetWidth > 0); })) { offered = true; break; }
      await sleep(150);
    }
    if (!offered) {
      res.note = 'no offer';
      res.viol.push({ inv: 'recovery-missing', msg: 'the document had unsaved changes, and about 4 s later (after a reload) the editor offered no "Recover unsaved work?"' });
      return res;
    }
    await page.click('#autosaveRecoverBtn', { timeout: 5000 });
    await sleep(500);
    await phoneAnyway();
    // another backup (a closed second tab's) may be offered after the first: not this document's, so discard it
    for (let k = 0; k < 3; k++) {
      const more = await page.evaluate(() => { const b = document.getElementById('autosaveDiscardBtn'); return !!(b && b.offsetWidth > 0); });
      if (!more) break;
      await page.click('#autosaveDiscardBtn', { timeout: 3000 }).catch(() => {});
      await sleep(400);
    }
    const s = await settleEditor(env, env.large ? 120000 : 40000, 350);
    const after = await page.evaluate(() => { try { return { xml: window.exportCurrentDocumentXml() }; } catch (e) { return { thrown: String((e && e.stack) || e).slice(0, 300) }; } });
    if (after.thrown) { res.viol.push({ inv: 'save-export', msg: 'after recovering, the save (exportCurrentDocumentXml) threw: ' + after.thrown }); return res; }
    const a = normaliseXml(before.xml), b = normaliseXml(after.xml);
    res.note = `recovered; ${before.xml.length} / ${after.xml.length} chars${s.settled ? '' : ' (not settled)'}`;
    if (a !== b) {
      // Recovery brings the backup back through the same XML reader as a saved file, so a difference that a plain save + reopen of
      // the document before the reload gives too is a fault of saving (reported by save-reopen, whatever its cause), not of
      // recovery: compare with what a fresh editor makes of the XML from before.
      let ref = null;
      try { ref = await freshEditorExport(env, o, before.xml, before.settings); } catch { /* cannot tell: report the difference */ }
      if (ref != null && normaliseXml(ref) === b) res.note += '; differs from before as a save + reopen does';
      else {
        const d = firstDiffs(a, b, xmlLines);
        res.viol.push({ inv: 'recovery-differs', msg: 'the recovered document is not the one before the reload' + (ref != null ? ' (nor what a save + reopen of it gives)' : '') + ': ' + showDiffs(d, 'before', 'recovered') });
      }
    }
  } finally {
    env.navOk = false;
  }
  return res;
}

// ---------------------------------------------------------------- long session: heap and settle time
export async function perfCheck(env, o) {
  const res = { viol: [], note: '' };
  const { page } = env;
  const P = env.perf || (env.perf = { heap: [], base: null, n: 0 });
  const bits = [];
  if (env.engine === 'chrome') {
    const mb = await page.evaluate(() => { try { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null; } catch { return null; } });
    if (mb != null) {
      const prior = P.heap.length ? Math.min(...P.heap.map((h) => h.mb)) : null;
      P.heap.push({ i: P.n, mb });
      bits.push(`heap ${mb.toFixed(0)} MB`);
      const limit = o.heapMb || 300;
      if (prior != null && mb - prior > limit) res.viol.push({ inv: 'heap-growth', msg: `the JS heap after a forced garbage collection is ${mb.toFixed(0)} MB, ${(mb - prior).toFixed(0)} MB above its lowest earlier value in this session (${prior.toFixed(0)} MB; limit ${limit} MB)` });
    }
  }
  const sig = await page.evaluate(() => window.__mk.sig());
  if (sig.startsWith('c:') && (await page.evaluate(() => document.activeElement === document.getElementById('editor')))) {
    const timed = async (press) => {
      const r = await page.evaluate(() => window.__mk.renders());
      const t0 = Date.now();
      await press();
      while (Date.now() - t0 < 3000 && (await page.evaluate(() => window.__mk.renders()))[0] === r[0]) await sleep(20);
      await settleEditor(env, 60000, 120);
      return Date.now() - t0;
    };
    const one = async () => Math.min(await timed(() => page.keyboard.type('x')), await timed(() => page.keyboard.press('Backspace')));
    const brfLen = await page.evaluate(() => (typeof window.lastBrf === 'string' ? window.lastBrf.length : 0));
    let ms = await one();
    bits.push(`edit settles in ${ms} ms`);
    if (!P.base) P.base = { ms, brf: brfLen };
    else if (ms > 3 * P.base.ms && ms - P.base.ms > 800 && brfLen < 2 * P.base.brf) {
      ms = Math.min(ms, await one(), await one());      // confirm: the smallest of three more
      if (ms > 3 * P.base.ms && ms - P.base.ms > 800) res.viol.push({ inv: 'settle-slow', msg: `after a one-letter edit the braille takes ${ms} ms to settle; the first measurement on this document was ${P.base.ms} ms (more than 3x; the braille is ${brfLen} characters, was ${P.base.brf})` });
    }
  }
  P.n++;
  res.note = bits.join(', ');
  return res;
}
