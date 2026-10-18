// F9 batch 2 (first beta feedback, APH, 9 Oct 2026; Paul's decisions, same day): behaviour fixes, checked in a real browser.
//   A    The "N words to check" badge always goes to a word. After any edit Emboss re-checks the whole document (several seconds on
//        the 1,275-page "Collections, Grade 7"); during that time the badge still showed the old count but its list had been
//        emptied, so a click did nothing. It now uses what the old and the new pass know.
//   B    Undo and Redo far down a long document keep the view where the change is (they used to jump to the top).
//   D1   The Settings dialog's title never carries the word-link highlight or the words-to-check underline (CSS Custom Highlight
//        ranges left pointing at text that the dialog's translation had replaced).
//   E2a  (Paul's decision, 9 Oct) With the Title field hidden, no title is added to the braille: not on page 1, not in the running
//        heads (BANA), not UKAAF's running head. The text's own heading stays. Quick Mode: the same unless Transcriber tools is on.
//        BRF downloads follow what is shown. A NIMAS save still keeps the title (document metadata, not braille).
//   Q1b  (Paul's decision F9-Q1b, 9 Oct) The toolbar's six-key button remembers its last state between visits (saved setting
//        `sixKeyOn`); a new user, or an old saved setup that only has `sixKeyInput`, starts with it off.
//   K    The print highlight covers exactly the word clicked, over the whole of the large NIMAS book (a sample), not a few letters out.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-f9-behaviour.mjs [port]
// Runs in Chrome by default; EMBOSS_ENGINE=webkit|firefox for another (tests/lib/launch-browser.mjs).
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(HERE, 'nimas_samples', '9780544087507NIMAS.xml');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE_SETTINGS = { simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' };
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const want = (k) => !only || only.split(',').includes(k);

const browser = await launchBrowser();
const errors = [];

async function openEditor({ settings = BASE_SETTINGS, viewport = { width: 1400, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'en-US', acceptDownloads: true });
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('f9b')) { sessionStorage.setItem('f9b', '1'); localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} }, settings);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`editor: ${String(e).slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(30000);
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.render === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}
async function loadBook(page) {
  await page.evaluate(() => { window.markDocumentClean(); window.__prevModel = window.lastModel; });
  await page.setInputFiles('#loadFileInput', BOOK);
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel && window.lastModel.blocks.length > 1000, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
}
// The proofreading pass over the whole book has finished (window.proofreadBusy is false and the badge is showing).
async function proofSettled(page) {
  await page.waitForFunction(() => typeof window.proofreadBusy === 'function' && !window.proofreadBusy() && !document.getElementById('proofBadge').hidden, null, { timeout: 180000 }).catch(() => {});
}

try {
  const { ctx, page } = await openEditor();
  const needsBook = want('A') || want('B') || want('K') || want('D2');
  if (needsBook) await loadBook(page);

  // ---------------- Q1b ----------------
  if (want('Q1b')) {
    const pressed = (pg) => pg.evaluate(() => document.getElementById('btnSixKey').getAttribute('aria-pressed') === 'true');
    const reload = async (pg) => { await pg.evaluate(() => window.markDocumentClean()); await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 }); await wait(800); };
    const ctxF = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    // "fresh" except that the page is the editor (a new profile opens Quick Mode): nothing about six-key is saved
    await ctxF.addInitScript(() => { try { if (!sessionStorage.getItem('q1b')) { sessionStorage.setItem('q1b', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false })); } } catch {} });
    const pg = await ctxF.newPage();
    pg.on('pageerror', (e) => errors.push(`q1b: ${String(e).slice(0, 200)}`));
    await pg.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await wait(800);
    ok('Q1b: a fresh profile starts with the six-key button off', !(await pressed(pg)));
    await pg.locator('#btnSixKey').click();
    ok('Q1b: clicking turns it on', await pressed(pg));
    await reload(pg);
    ok('Q1b: after a reload it is still on', await pressed(pg));
    const quiet = await pg.evaluate(() => (document.getElementById('announce')?.textContent || '').trim());
    ok('Q1b: nothing is announced on load', !/six-key|perkins/i.test(quiet), quiet);
    await pg.locator('#btnSixKey').click();
    ok('Q1b: clicking again turns it off', !(await pressed(pg)));
    await reload(pg);
    ok('Q1b: after a reload it is still off', !(await pressed(pg)));
    await ctxF.close();
    const ctxO = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    await ctxO.addInitScript(() => { try { if (!sessionStorage.getItem('q1b')) { sessionStorage.setItem('q1b', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', sixKeyInput: true })); } } catch {} });
    const po = await ctxO.newPage();
    await po.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await po.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await wait(800);
    ok('Q1b: an old saved setup (sixKeyInput: true, no sixKeyOn) starts with it off', !(await pressed(po)));
    await ctxO.close();
  }

  // ---------------- E2a ----------------
  if (want('E2a')) {
    // A document with a title of its own and several braille pages, so that BANA's page-1 title and both standards' running heads show.
    const HTML = '<html><head><title>Quixotic Zebra Saga</title></head><body><h1>Chapter One</h1>' + Array.from({ length: 70 }, (_, i) => `<p>Paragraph ${i} has some words to fill a line or two of braille.</p>`).join('') + '</body></html>';
    // the title in the braille: "Quixotic" brailled (no contraction), on line 1 of page 1 (BANA) or of pages 2+ (the running head)
    const letters = (l) => /QUIXOTIC/.test(String(l || '').replace(/\r/g, ''));
    const analyse = (brf) => { const pg = brf.split('\f'); return { pages: pg.length, p1: letters(pg[0].split('\n')[0]), heads: pg.slice(1).filter((x) => letters(x.split('\n')[0])).length }; };
    const readDownload = async (page, menuBtn, item) => {
      await page.click(menuBtn);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(item)]);
      const { readFile } = await import('node:fs/promises');
      return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
    };
    const editorBrf = async (mode, extra, { beta = false } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US', acceptDownloads: true });
      await ctx.addInitScript(([s, b]) => { try { if (b) window.EMBOSS_BETA = true; if (!sessionStorage.getItem('e2a')) { sessionStorage.setItem('e2a', '1'); localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} }, [{ simpleMode: false, mode, grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', ...extra }, beta]);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`e2a: ${String(e).slice(0, 200)}`));
      page.on('dialog', (d) => d.accept());
      await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.render === 'function', null, { timeout: 60000 });
      await wait(1000);
      await page.evaluate(async (h) => { window.markDocumentClean(); await window.importFile(new File([h], 'book.html', { type: 'text/html' })); }, HTML);
      let prev = null;
      for (let k = 0; k < 40; k++) { await wait(400); const b = await page.evaluate(() => window.lastBrf || ''); if (b.length > 1500 && b === prev) break; prev = b; }
      return { ctx, page };
    };
    const SHOWN = (mode, a) => (mode === 'bana' ? a.p1 && a.heads >= 1 : a.heads >= 1);
    for (const mode of ['bana', 'ukaaf']) {
      for (const [what, extra, shown] of [['Title field shown (setting ticked)', { showTitleField: true }, true], ['Title field hidden (Transcriber tools off)', {}, false], ['Title field hidden by its setting, Transcriber tools on', { transcriberTools: true, showTitleField: false }, false]]) {
        const { ctx, page } = await editorBrf(mode, extra);
        const brf = await page.evaluate(() => window.lastBrf || '');
        const a = analyse(brf);
        if (shown) ok(`E2a [editor ${mode}]: ${what}: the title is in the braille (${mode === 'bana' ? 'page 1 and ' : ''}the running heads), as today`, a.pages >= 2 && SHOWN(mode, a), a);
        else ok(`E2a [editor ${mode}]: ${what}: no title anywhere in the braille (no page-1 title, no running head)`, a.pages >= 2 && !a.p1 && a.heads === 0, a);
        ok(`E2a [editor ${mode}]: ${what}: the text itself is still brailled (its heading stays)`, /,CHAPTER ,ONE|,\*APT\] ,ONE/.test(brf) || (brf.match(/PARAGRAPH/g) || []).length === 0 && brf.length > 1500 || /ONE/.test(brf), brf.slice(0, 150));
        const dl = await readDownload(page, '#downloadBtn', '#downloadBrfItem');
        const ad = analyse(dl.text);
        ok(`E2a [editor ${mode}]: ${what}: the BRF download follows what is shown`, shown ? SHOWN(mode, ad) : (!ad.p1 && ad.heads === 0), { name: dl.name, ...ad });
        const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
        ok(`E2a [editor ${mode}]: ${what}: a NIMAS save still keeps the title`, /<doctitle>Quixotic Zebra Saga<\/doctitle>/.test(xml), (xml.match(/<doctitle>[^<]*<\/doctitle>/) || [])[0]);
        await ctx.close();
      }
    }
    {
      // ticking "Show the Title field" in Settings brings the title back when Settings closes; unticking takes it away
      const { ctx, page } = await editorBrf('bana', {});
      const state = () => page.evaluate(() => { const pg = (window.lastBrf || '').split('\f'); const l = (x) => /QUIXOTIC/.test((x || '').replace(/\r/g, '')); return l(pg[0].split('\n')[0]); });
      ok('E2a [editor]: Title field hidden to start with: no title in the braille', !(await state()));
      await page.click('#settingsBtn');
      await page.click('#settingsDialog .tab-btn[data-tab="tab-display"]');
      await page.check('#set-showTitleField');
      await page.click('#settingsDialog button:has-text("Done")');
      await page.waitForFunction(() => { const pg = (window.lastBrf || '').split('\f'); return /QUIXOTIC/.test((pg[0].split('\n')[0] || '')); }, null, { timeout: 30000 }).catch(() => {});
      ok('E2a [editor]: ticking "Show the Title field above the text" puts the title in the braille', await state());
      await page.click('#settingsBtn');
      await page.click('#settingsDialog .tab-btn[data-tab="tab-display"]');
      await page.uncheck('#set-showTitleField');
      await page.click('#settingsDialog button:has-text("Done")');
      await page.waitForFunction(() => { const pg = (window.lastBrf || '').split('\f'); return !/QUIXOTIC/.test((pg[0].split('\n')[0] || '')); }, null, { timeout: 30000 }).catch(() => {});
      ok('E2a [editor]: unticking takes it out again', !(await state()));
      await ctx.close();
    }
    // Quick Mode: no Title field; the title is not added unless Transcriber tools is on (and this is not a beta build)
    for (const [what, extra, beta, shown] of [['Transcriber tools off', {}, false, false], ['Transcriber tools on', { transcriberTools: true }, false, true], ['a beta build with Transcriber tools saved on', { transcriberTools: true }, true, false]]) {
      for (const mode of ['bana', 'ukaaf']) {
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US', acceptDownloads: true });
        await ctx.addInitScript(([s, b]) => { try { if (b) window.EMBOSS_BETA = true; localStorage.setItem('emboss-settings', JSON.stringify(s)); } catch {} }, [{ simpleMode: true, mode, grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', ...extra }, beta]);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`quick: ${String(e).slice(0, 200)}`));
        await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
        await page.setInputFiles('#fileInput', { name: 'book.html', mimeType: 'text/html', buffer: Buffer.from(HTML) });
        await page.waitForFunction(() => !document.getElementById('downloadBtn')?.disabled, null, { timeout: 60000 }).catch(() => {});
        await wait(2500);
        const dl = await readDownload(page, '#downloadBtn', '#downloadBrfItem');
        const a = analyse(dl.text);
        ok(`E2a [Quick Mode ${mode}]: ${what}: the title is ${shown ? '' : 'not '}in the BRF`, a.pages >= 2 && (shown ? SHOWN(mode, a) : (!a.p1 && a.heads === 0)), a);
        await ctx.close();
      }
    }
  }

  // ---------------- A (cursor in an equation) ----------------
  if (want('A') || want('Aeq')) {
    const { ctx: c2, page: pg } = await openEditor();
    await pg.evaluate(async () => { window.markDocumentClean(); const t = await (await fetch('/tests/fixtures/import-audit/html/h03-lists.html')).text(); await window.importFile(new File([t.replace('</body>', '<p>Solve <math><mi>x</mi><mo>=</mo><mn>2</mn></math> now.</p></body>')], 'h03-eq.html', { type: 'text/html' })); });
    await pg.waitForFunction(() => !document.getElementById('proofBadge').hidden && typeof window.proofreadBusy === 'function' && !window.proofreadBusy(), null, { timeout: 60000 });
    await pg.locator('#editor math-field').first().click();
    await wait(400);
    const inMath = await pg.evaluate(() => !!document.activeElement && (document.activeElement.tagName === 'MATH-FIELD' || !!document.activeElement.closest('math-field')));
    await pg.evaluate(() => { window.activeWordHighlight = null; });
    await pg.locator('#proofBadge').click();
    await pg.waitForFunction(() => !!window.activeWordHighlight, null, { timeout: 15000 }).catch(() => {});
    await wait(500);
    const r = await pg.evaluate(() => ({ ah: window.activeWordHighlight, bar: document.getElementById('ruleInfoBody').innerText.slice(0, 60) }));
    ok(`A: the badge goes to a word with the cursor in an equation (cursor in the equation: ${inMath})`, inMath && !!r.ah && /Word \d+ of \d+ to check/.test(r.bar), r);
    await c2.close();
  }

  // ---------------- D1 ----------------
  if (want('D1')) {
    const { ctx: c1, page: pg } = await openEditor();
    await pg.evaluate(async () => { window.markDocumentClean(); const t = await (await fetch('/tests/fixtures/import-audit/html/h03-lists.html')).text(); await window.importFile(new File([t], 'h03-lists.html', { type: 'text/html' })); });
    await pg.waitForFunction(() => !document.getElementById('proofBadge').hidden && typeof window.proofreadBusy === 'function' && !window.proofreadBusy(), null, { timeout: 60000 });
    await pg.locator('#proofBadge').click();
    await wait(1500);
    const names = () => pg.evaluate(() => [...CSS.highlights.keys()].sort());
    ok('D1: with a word picked out by the badge, the document has both highlights (link-word and proof-warn-word)', JSON.stringify(await names()) === JSON.stringify(['link-word', 'proof-warn-word']), await names());
    // paint check: yellow pixels (the link highlight) or the blue wavy underline inside the dialog title's box
    const titlePaint = async () => {
      const r = await pg.evaluate(() => { const h = document.querySelector('#settingsDialog h2, #settingsDialog .dialog-title, #settingsDialog [role="heading"]') || document.querySelector('#settingsDialog h1'); const b = h.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, tag: h.tagName }; });
      const buf = await pg.screenshot({ clip: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.w), height: Math.ceil(r.h) } });
      return pg.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0); const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let yellow = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 170 && d[i + 2] < 120) yellow++;
        return { yellow, px: d.length / 4 };
      }, buf.toString('base64'));
    };
    await pg.click('#settingsBtn');
    await wait(600);
    const held = await pg.evaluate(() => window.__highlightsHeld && window.__highlightsHeld());
    ok('D1: while Settings is open, no highlight is registered on the page (they are set aside)', (await names()).length === 0 && held && held.dialogs === 1 && held.held.includes('link-word'), { names: await names(), held });
    const tp = await titlePaint();
    ok(`D1: the title "Settings" has no word-link highlight painted on it (${ENGINE_LABEL}; yellow pixels: ${tp.yellow} of ${tp.px})`, tp.yellow === 0, tp);
    // text of the dialog is its own: highlights never cover it, also after a language-style re-translation
    await pg.evaluate(() => window.translateDOM(document.getElementById('settingsDialog')));
    await wait(200);
    const tp2 = await titlePaint();
    ok('D1: ... nor after the dialog\'s text has been translated again', tp2.yellow === 0 && (await names()).length === 0, tp2);
    await pg.click('#settingsDialog button:has-text("Done")');
    await pg.waitForFunction(() => typeof window.proofreadBusy === 'function' && !window.proofreadBusy() && [...CSS.highlights.keys()].includes('proof-warn-word'), null, { timeout: 30000 }).catch(() => {});
    const after = await pg.evaluate(() => ({ ...window.__highlightsHeld() }));
    ok('D1: when Settings closes the words-to-check underline is back on the document text, nothing is left held', after.dialogs === 0 && after.held.length === 0 && after.shown.includes('proof-warn-word'), after);
    // another dialog (Help) the same
    await pg.locator('#proofBadge').click(); await wait(1200);
    await pg.click('#helpBtn'); await wait(500);
    ok('D1: the Help dialog sets them aside too', (await names()).length === 0, await names());
    await pg.click('#helpClose'); await wait(500);
    ok('D1: ... and they come back when it closes', (await names()).includes('proof-warn-word'), await names());
    await c1.close();
  }

  // ---------------- D2 ----------------
  if (want('D2')) {
    await proofSettled(page);
    await page.waitForFunction(() => window.renderIsIdle && window.renderIsIdle(), null, { timeout: 120000 });
    await wait(2000);
    // time an action to the next painted frame, then until the page has finished any render it caused; count the renders
    const timed = (js) => page.evaluate(async (js) => {
      window.__embossPerf = [];
      const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t0 = performance.now();
      (0, eval)(js);
      await raf2();
      const paint = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 400));          // a render scheduled by the action starts within 200 ms
      while (!window.renderIsIdle()) await new Promise((r) => setTimeout(r, 25));
      return { paint: Math.round(paint), idle: Math.round(performance.now() - t0), renders: window.__embossPerf.filter((m) => m[0] === 'render:start').length };
    }, js);
    const DONE = "document.querySelector('#settingsDialog .dialog-foot button').click()";
    const open1 = await timed("document.getElementById('settingsBtn').click()");
    const doneSame = await timed(DONE);
    const open2 = await timed("document.getElementById('settingsBtn').click()");
    const change = await timed("const s=document.getElementById('set-listStyle'); s.value = s.value==='compact'?'spaced':'compact'; s.dispatchEvent(new Event('change',{bubbles:true}))");
    const doneChanged = await timed(DONE);
    console.log(`  D2 [${ENGINE_LABEL}] ms (to painted / until idle / renders): open ${open1.paint}/${open1.idle}/${open1.renders}; Done, nothing changed ${doneSame.paint}/${doneSame.idle}/${doneSame.renders}; change a setting ${change.paint}/${change.idle}/${change.renders}; Done after a change ${doneChanged.paint}/${doneChanged.idle}/${doneChanged.renders}`);
    ok('D2: Settings opens within 2 s on the big book', open1.paint < 2000, open1);
    ok('D2: closing Settings with nothing changed does not braille the book again (no render)', doneSame.renders === 0 && doneSame.paint < 1000, doneSame);
    ok('D2: a changed setting brailles the book once; closing Settings after it does not do it again', change.renders === 1 && doneChanged.renders === 0, { change, doneChanged });
    // behaviour unchanged: the change is in the braille and in the saved settings
    const st = await page.evaluate(() => ({ list: JSON.parse(localStorage.getItem('emboss-settings')).listStyle, idle: window.renderIsIdle() }));
    ok('D2: ... and the change was applied and saved', st.idle && (st.list === 'spaced' || st.list === 'compact'), st);
    // a change made and Settings closed at once (before the 200 ms render timer) still gets its render
    await page.evaluate(() => document.getElementById('settingsBtn').click());
    await wait(300);
    const r = await page.evaluate(async () => {
      const before = window.lastBrf; window.__embossPerf = [];
      const s = document.getElementById('set-listStyle'); s.value = s.value === 'compact' ? 'spaced' : 'compact'; s.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#settingsDialog .dialog-foot button').click();
      await new Promise((r) => setTimeout(r, 500));
      while (!window.renderIsIdle()) await new Promise((r) => setTimeout(r, 50));
      return { renders: window.__embossPerf.filter((m) => m[0] === 'render:start').length, changed: window.lastBrf !== before };
    });
    ok('D2: a setting changed and Settings closed at once is still brailled (one render)', r.renders === 1, r);
  }

  // ---------------- K ----------------
  if (want('K')) {
    await page.waitForFunction(() => window.renderIsIdle && window.renderIsIdle(), null, { timeout: 120000 });
    await wait(1500);
    // the tester's paragraph (a plain-list item whose print bullet "•" is hidden in the editor but is part of the model's text)
    const NEEDLE = 'convince them to agree with you';
    const loc = await page.evaluate((needle) => {
      const key = Object.keys(window.cellText).find((k) => window.cellText[k].includes(needle));
      if (!key) return null;
      const [b, u] = key.split(':').map(Number);
      const el = document.querySelector(`#editor [data-block-idx="${b}"]`);
      const li = el.querySelectorAll('li')[u];
      return { key, b, u, model: window.cellText[key], dom: li.textContent };
    }, NEEDLE);
    ok('K: the paragraph is found, and its model text has the bullet the print pane hides', !!loc && /^•\s/.test(loc.model) && !/^•/.test(loc.dom), loc);
    if (loc) {
      await page.locator(`#editor [data-block-idx="${loc.b}"] li`).nth(loc.u).scrollIntoViewIfNeeded();
      await wait(500);
      for (const word of ['convince', 'What', 'claim?', 'you?']) {
        const rect = await page.evaluate(({ b, u, word }) => {
          const li = document.querySelectorAll(`#editor [data-block-idx="${b}"] li`)[u];
          const tn = li.firstChild.firstChild || li.firstChild;
          const node = (function find(n) { if (n.nodeType === 3) return n; for (const c of n.childNodes) { const r = find(c); if (r) return r; } return null; })(li);
          const i = node.nodeValue.lastIndexOf(word);
          const r = document.createRange(); r.setStart(node, i + Math.floor(word.length / 2)); r.setEnd(node, i + Math.floor(word.length / 2) + 1);
          const q = r.getBoundingClientRect();
          return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
        }, { b: loc.b, u: loc.u, word });
        await page.mouse.click(rect.x, rect.y);
        await wait(500);
        const got = await page.evaluate(() => {
          const h = CSS.highlights.get('link-word'); const r = h && [...h][0];
          const a = window.activeWordHighlight; const t = a ? window.cellText[`${a.block}:${a.unit}`] : null;
          return { printHighlight: r ? r.toString() : null, brailleWord: a && t ? t.slice(a.s, a.e) : null };
        });
        ok(`K: a click in "${word}" highlights exactly that word in the print (${got.printHighlight}) and the braille is the same word's (${got.brailleWord})`, got.printHighlight === word && got.brailleWord === word, got);
      }
    }
    // the whole book: for every word of the model's text the print Range covers exactly that word, and every character the print shows maps to
    // the same character of the model's text (every 3rd character; every word)
    const t0 = Date.now();
    const rep = await page.evaluate(() => window.__printLinkCheck({ stride: 3, maxReport: 20 }));
    console.log(`  K: whole-book check: ${rep.units} units, ${rep.words} words, ${rep.charsChecked} characters, ${rep.hiddenWords} bullets print does not show; ${Date.now() - t0} ms`);
    ok('K: every word of the whole book (all units; 150,000+ words) has its print highlight on exactly that word', rep.words > 100000 && rep.badWords === 0, rep.mismatches.slice(0, 5));
    ok('K: and every character the print shows maps back to the same character of the model text', rep.charsChecked > 50000 && rep.badChars === 0, rep.mismatches.filter((m) => m.kind === 'char').slice(0, 5));
  }

  // ---------------- A ----------------
  if (want('A')) {
    await proofSettled(page);
    const badge = await page.evaluate(() => document.getElementById('proofBadge').textContent);
    ok('A: the big book shows a "words to check" badge', /\d+ words? to check/.test(badge), badge);
    const click = async () => {
      await page.evaluate(() => { window.activeWordHighlight = null; document.getElementById('ruleInfoBody').textContent = ''; });
      await page.locator('#proofBadge').click();
      // after a change the jump waits for the render (several seconds on this book), then goes to the word
      await page.waitForFunction(() => !!window.activeWordHighlight, null, { timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(700);
      return page.evaluate(() => ({ ah: window.activeWordHighlight, bar: document.getElementById('ruleInfoBody').innerText.slice(0, 80) }));
    };
    const places = [
      ['the picture card\'s description box', async () => { await page.locator('textarea.doc-image-alt').first().click(); await page.keyboard.type('Logo'); }],
      ['ordinary text', async () => { await page.locator('#editor [data-block-idx="2"]').first().click(); await page.keyboard.type('x'); }],
      ['a table cell', async () => { await page.locator('#editor .table-cell-input').first().click(); await page.keyboard.type('x'); }],
    ];
    for (const [where, edit] of places) {
      await edit();
      // the edit starts a new pass over the whole book; click while it runs (the old list is what it had)
      await page.waitForFunction(() => typeof window.proofreadBusy === 'function' && window.proofreadBusy(), null, { timeout: 15000 }).catch(() => {});
      await wait(300);
      const busy = await page.evaluate(() => window.proofreadBusy && window.proofreadBusy());
      const r = await click();
      ok(`A: the badge goes to a word while the re-check runs (cursor in ${where}; re-check running: ${busy})`, !!r.ah && /Word \d+ of \d+ to check/.test(r.bar), { busy, ...r });
      await proofSettled(page);
      const r2 = await click();
      ok(`A: ... and when the re-check has finished (cursor in ${where})`, !!r2.ah && /Word \d+ of \d+ to check/.test(r2.bar), r2);
    }
  }

  // ---------------- B ----------------
  if (want('B')) {
    await proofSettled(page);
    const view = async (idx) => {
      // the page tags its blocks (data-block-idx) when the render that follows an edit has finished (seconds, on this book)
      await page.waitForFunction((i) => document.querySelector(`#editor [data-block-idx="${i}"]`), idx, { timeout: 60000 }).catch(() => {});
      await wait(300);
      return view1(idx);
    };
    const view1 = (idx) => page.evaluate((i) => {
      const ed = document.getElementById('editor'); const er = ed.getBoundingClientRect();
      const el = ed.querySelector(`[data-block-idx="${i}"]`); const r = el && el.getBoundingClientRect();
      return { top: ed.scrollTop, h: ed.clientHeight, visible: !!r && r.bottom > er.top && r.top < er.bottom, text: el ? (el.textContent.match(/ZZZ|YYY/) || [''])[0] : null };
    }, idx);
    const IDX = 2500;
    const target = page.locator(`#editor [data-block-idx="${IDX}"]`).first();
    await target.scrollIntoViewIfNeeded();
    await wait(600);
    await target.click();
    await page.keyboard.type('ZZZ');
    await wait(1500);                                   // the history snapshot (400 ms) and the render
    const before = await view(IDX);
    ok('B: the edit is in the paragraph, far down the book, and on screen', before.top > 50000 && before.visible && before.text === 'ZZZ', before);
    for (const how of ['the Undo button', 'Ctrl+Z (Cmd+Z on a Mac)']) {
      if (how.startsWith('Ctrl')) { await target.click(); await page.keyboard.type('YYY'); await wait(1500); }
      if (how === 'the Undo button') await page.locator('#btnUndo').click(); else await page.keyboard.press('ControlOrMeta+z');
      await wait(2500);
      const u = await view(IDX);
      ok(`B: Undo (${how}) removes the change and keeps the place: the paragraph is still on screen`, u.top > 50000 && u.visible && !u.text, { before, u });
      await page.locator('#btnRedo').click();
      await wait(2500);
      const r = await view(IDX);
      ok(`B: Redo (after ${how}) puts the change back and keeps the place`, r.top > 50000 && r.visible && !!r.text, { r });
      await page.locator('#btnUndo').click();
      await wait(1500);
    }
  }
  await ctx.close();
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== F9 behaviour batch 2 [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
