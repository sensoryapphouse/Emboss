// Feedback 30 Sep 2026, item 18 (Paul, 2 Oct: yes): Emboss follows Paramveer's Paige brand pass on Translate (PaigeBraille/translate#10)
// — see tests/brand_style.test.mjs for the rules. This checks them in a real browser, on Quick Mode and the editor, light and dark:
//  - an automated WCAG 2 A/AA scan (axe-core 4.13, vendored in tests/vendor/axe-core, MPL-2.0; test-only, never shipped) finds nothing,
//    with a document loaded, a word clicked (the explanation bar's coloured chips showing) and the Help dialog open;
//  - body text is #444444 in light; a dialog has no browser border and 16px corners;
//  - every icon is drawn (its <use> finds its symbol and has a size);
//  - a menu opened with the mouse has no item lit up until the keyboard moves into it (:focus-visible, as #10).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-brand-style.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const AXE = fileURLToPath(new URL('./vendor/axe-core/axe.min.js', import.meta.url));
const SAMPLE = '/web/test_samples/nimas_comprehensive_structures_sample.xml';
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 1500) : ''}`); }
};

async function axeScan(page) {
  await page.evaluate(() => document.fonts.ready);
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
  // KNOWN, NOT EMBOSS'S TO FIX: MathLive's <math-field> is focusable and so is the keyboard sink inside its shadow root (the
  // library's own design — the sink takes the focus, and Emboss names it, so aria-input-field-name passes). axe calls that
  // "nested-interactive"; it is left to MathLive.
  const known = (id, n) => id === 'nested-interactive' && n.target.join(' ').includes('math-field');
  return r.violations
    .map((v) => ({ id: v.id, nodes: v.nodes.filter((n) => !known(v.id, n)) }))
    .filter((v) => v.nodes.length)
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message || n.failureSummary || '').slice(0, 140)}`) }));
}
const iconsDrawn = (page) => page.evaluate(() => {
  const bad = [];
  for (const use of document.querySelectorAll('svg use')) {
    const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
    if (!href.startsWith('#icon-')) continue;
    const svg = use.closest('svg');
    if (!document.getElementById(href.slice(1))) bad.push(`${href}: no symbol`);
    else if (svg.getClientRects().length && svg.getBoundingClientRect().width === 0 && svg.checkVisibility?.()) bad.push(`${href}: zero size`);
  }
  return { count: document.querySelectorAll('svg use[href^="#icon-"]').length, bad };
});

const browser = await launchBrowser();
const errors = [];
try {
  for (const scheme of ['light', 'dark']) {
    // ---- Quick Mode, with a document converted
    {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, locale: 'en-US' });
      await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`quick ${scheme}: ${e}`));
      page.on('dialog', (d) => d.accept());
      await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
      await page.waitForTimeout(2000);
      ok(`Quick Mode [${scheme}]: nothing to fix before a document is loaded`, (await axeScan(page)).length === 0, await axeScan(page));
      const text = await page.evaluate(async (u) => (await fetch(u)).text(), SAMPLE);
      await page.setInputFiles('#fileInput, input[type=file] >> nth=0', { name: 'sample.xml', mimeType: 'text/xml', buffer: Buffer.from(text) });
      await page.waitForFunction(() => (document.getElementById('preview')?.textContent || '').trim().length > 50, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      ok(`Quick Mode [${scheme}]: nothing to fix with a document converted`, (await axeScan(page)).length === 0, await axeScan(page));
      if (scheme === 'light') ok('Quick Mode: body text is #444444', (await page.evaluate(() => getComputedStyle(document.body).color)) === 'rgb(68, 68, 68)', await page.evaluate(() => getComputedStyle(document.body).color));
      const ic = await iconsDrawn(page);
      ok(`Quick Mode [${scheme}]: every icon is drawn`, ic.count >= 3 && ic.bad.length === 0, ic);
      await page.click('#helpBtn'); await page.waitForTimeout(400);
      const dlg = await page.evaluate(() => { const d = [...document.querySelectorAll('dialog')].find((x) => x.open); if (!d) return null; const s = getComputedStyle(d); return { border: s.borderTopStyle, radius: s.borderTopLeftRadius, shadow: s.boxShadow }; });
      ok(`Quick Mode [${scheme}]: the Help dialog has no browser border, 16px corners, no drop shadow`, dlg && dlg.border === 'none' && dlg.radius === '16px' && dlg.shadow === 'none', dlg);
      ok(`Quick Mode [${scheme}]: nothing to fix with Help open`, (await axeScan(page)).length === 0, await axeScan(page));
      await ctx.close();
    }
    // ---- the editor, with a document loaded and a word clicked
    {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, locale: 'en-US' });
      await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`editor ${scheme}: ${e}`));
      page.on('dialog', (d) => d.accept());
      await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      await page.evaluate(async (u) => { const t = await (await fetch(u)).text(); window.markDocumentClean(); await window.importFile(new File([t], 'sample.xml')); }, SAMPLE);
      await page.waitForTimeout(4000);
      await page.click('#braille .brl-row >> nth=12');   // a word clicked in the braille: the explanation bar's chips
      await page.waitForTimeout(800);
      const chips = await page.evaluate(() => document.querySelectorAll('#statusBar .ri-seg, #statusBar .ri-rule').length);
      ok(`editor [${scheme}]: the explanation bar shows its chips`, chips > 0, chips);
      ok(`editor [${scheme}]: nothing to fix with a document loaded and a word clicked`, (await axeScan(page)).length === 0, await axeScan(page));
      // Paul, 18 Oct 2026: 24px of space round Clear (it had been 8px from Help since Clear moved beside it on 17 Oct)
      if (scheme === 'light') {
        const sp = await page.evaluate(() => {
          const c = document.getElementById('btnClear').getBoundingClientRect(), h = document.getElementById('helpBtn').getBoundingClientRect();
          const left = [...document.querySelectorAll('header button, header label')].filter((b) => b.getClientRects().length && b.getBoundingClientRect().right <= c.left && Math.abs(b.getBoundingClientRect().top - c.top) < 20).map((b) => b.getBoundingClientRect().right);
          return { toHelp: Math.round(h.left - c.right), fromLeft: left.length ? Math.round(c.left - Math.max(...left)) : null };
        });
        ok('editor: 24px between Clear and Help, and at least 24px before Clear', sp.toHelp === 24 && (sp.fromLeft === null || sp.fromLeft >= 24), sp);
      }
      if (scheme === 'light') ok('editor: body text is #444444', (await page.evaluate(() => getComputedStyle(document.body).color)) === 'rgb(68, 68, 68)', await page.evaluate(() => getComputedStyle(document.body).color));
      const ic = await iconsDrawn(page);
      ok(`editor [${scheme}]: every icon is drawn`, ic.count >= 8 && ic.bad.length === 0, ic);
      // a menu opened by the mouse: no item lit up
      await page.click('#downloadBtn'); await page.waitForTimeout(300);
      const lit = await page.evaluate(() => { const m = document.getElementById('downloadMenu'); const items = [...m.querySelectorAll('[role=menuitem]')].filter((b) => b.offsetParent); return items.filter((b) => { const bg = getComputedStyle(b).backgroundColor; return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== getComputedStyle(m).backgroundColor; }).map((b) => b.id || b.textContent.trim()); });
      ok(`editor [${scheme}]: a menu opened with the mouse has no item lit up`, lit.length === 0, lit);
      await page.keyboard.press('Escape');
      await page.click('#helpBtn'); await page.waitForTimeout(400);
      const dlg = await page.evaluate(() => { const d = [...document.querySelectorAll('dialog')].find((x) => x.open); if (!d) return null; const s = getComputedStyle(d); return { border: s.borderTopStyle, radius: s.borderTopLeftRadius, shadow: s.boxShadow }; });
      ok(`editor [${scheme}]: the Help dialog has no browser border, 16px corners, no drop shadow`, dlg && dlg.border === 'none' && dlg.radius === '16px' && dlg.shadow === 'none', dlg);
      ok(`editor [${scheme}]: nothing to fix with Help open`, (await axeScan(page)).length === 0, await axeScan(page));
      await ctx.close();
    }
  }
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== Brand style [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
