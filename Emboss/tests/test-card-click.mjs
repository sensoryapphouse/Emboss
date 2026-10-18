// A89 step 3, found by random-action testing (all three browsers): (1) a click on a ⁂ break or a print page marker selected
// nothing, and in WebKit left the caret inside the card, where nothing can be typed (and Backspace went "Back" a page in
// Playwright's WebKit); (2) after a button on a table's bar or the Braille menu's Download BRF, the keyboard focus fell to the
// page itself, so the keys did nothing until the text was clicked again. Now a click anywhere on a card, not on one of its
// controls, selects the card (as a click on a picture has since item 9), and the focus goes back to the text when it has fallen
// to the page while the caret is still in the text.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs). Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-card-click.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const CARDS = '#editor .doc-break, #editor .doc-print-page';
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const launch = () => launchBrowser({}, key);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  let navigated = false;
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && !f.url().includes('/web/editor/')) navigated = true; });
  page.on('dialog', (d) => d.accept());
  const state = () => page.evaluate(() => {
    const s = getSelection(); const n = s.anchorNode; const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const card = el?.closest?.('[data-lexical-decorator="true"]');
    return { selected: document.querySelector('#editor .emboss-selected')?.className.split(' ')[0] || null, caretInCard: !!card && s.isCollapsed && !el.closest('[contenteditable="true"]:not(#editor), textarea, input'), active: document.activeElement === document.body ? 'body' : document.activeElement.id || document.activeElement.className.split(' ')[0] };
  });
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => { const t = await (await fetch('/web/test_samples/nimas_comprehensive_structures_sample.xml')).text(); window.markDocumentClean(); await window.importFile(new File([t], 's.xml')); });
    await page.waitForTimeout(3000);
    const kinds = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.className.split(' ')[0]), CARDS);
    for (let i = 0; i < kinds.length; i++) {
      const pt = await page.evaluate(({ sel, i }) => { const el = document.querySelectorAll(sel)[i]; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40) }; }, { sel: CARDS, i });
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(250);
      const s = await state();
      ok(`${engine}: a click on ${kinds[i]} #${i + 1} selects it, with the keys still in the text`, s.selected === kinds[i] && !s.caretInCard && s.active === 'editor', s);
    }
    // A89 (the nightly random-action run, seed 1763563818, WebKit): a picture inside a box (the contract's own pictures) — a click on
    // it left the caret inside the card; only cards at the top level of the document were selected by a click
    {
      const odt = await (await import('node:fs')).promises.readFile(new URL('./real_samples/odt/model-services-contract-core-terms.odt', import.meta.url));
      await page.evaluate(async (a) => { window.markDocumentClean(); await window.importFile(new File([new Uint8Array(a)], 'c.odt')); }, [...odt]);
      await page.waitForTimeout(3000);
      const n = await page.evaluate(() => document.querySelectorAll('#editor aside figure.doc-image-block').length);
      ok(`${engine}: the contract has pictures inside boxes`, n > 0, n);
      for (let i = 0; i < Math.min(n, 3); i++) {
        // the picture's file-name line, where the random test clicked (Playwright's click waits until nothing — the contents panel,
        // say — lies over it)
        await page.locator('#editor aside figure.doc-image-block').nth(i).locator('.doc-image-src').click({ timeout: 10000 });
        await page.waitForTimeout(250);
        const st = await state();
        ok(`${engine}: a click on a picture inside a box (#${i + 1}) selects it, with the keys still in the text`, st.selected === 'doc-image-block' && !st.caretInCard && st.active === 'editor', st);
      }
      await page.evaluate(async () => { const t = await (await fetch('/web/test_samples/nimas_comprehensive_structures_sample.xml')).text(); window.markDocumentClean(); await window.importFile(new File([t], 's.xml')); });
      await page.waitForTimeout(2000);
      const first = await page.evaluate((sel) => { const el = document.querySelectorAll(sel)[0]; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40) }; }, CARDS);
      await page.mouse.click(first.x, first.y); await page.waitForTimeout(250);
    }

    // Backspace on a selected card: never leaves the page
    await page.keyboard.press('Backspace'); await page.waitForTimeout(300);
    ok(`${engine}: Backspace on a selected card does not leave the page`, !navigated && page.url().includes('/web/editor/'), page.url());

    // a table bar button, then the keys still work
    await page.click('#editor .table-context-bar button >> visible=true >> nth=0');
    await page.waitForTimeout(400);
    let s = await state();
    ok(`${engine}: after a button on a table's bar, the keys are not lost to the page`, s.active !== 'body', s);

    // Braille menu › Download BRF, then the keys still work
    await page.click('#editor p.ed-p >> nth=1');
    await page.click('#downloadBtn');
    await page.waitForTimeout(200);
    const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await page.click('#downloadBrfItem');
    await dl;
    await page.waitForTimeout(400);
    s = await state();
    ok(`${engine}: after Download BRF from the Braille menu, the keys are not lost to the page`, s.active !== 'body', s);
    ok(`${engine}: no page errors`, errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Card clicks and focus [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
