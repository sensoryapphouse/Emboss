// F9 batch 1 (first beta feedback, APH, 9 Oct 2026; Paul's decisions, same day): look-and-layout fixes, checked in a real browser.
//   C1  The paragraph-style list is a menu with an icon per style, the Insert menu's own look (Paul: "give the style menu icons, so the two
//       menus are one style"). It stays usable by keyboard and screen reader: a button that opens a listbox, Up/Down/Home/End, Enter,
//       Esc (focus back on the button), the current style marked, one menu open at a time. The <select id="blockStyle"> stays in the
//       page, out of sight, as the model the editor code and the other test suites use.
//   C2  Insert > "Templates" is "Equation Templates", and so is its dialog's title.
//   E1  No "Perkins 6-Key Input" checkbox in Settings > User Interface; the toolbar's six-key button toggles (and an old saved
//       "sixKeyInput: false" no longer hides it: the checkbox that could undo that has gone).
//   H   Quick Mode has one Read button, the one above the braille.   (17 Oct 2026, Paul: Read is removed from Quick Mode; H now checks there is none.)
//   I   "Loading braille engine…" is a calm spinner + words in the page's own font (not monospace), gone as soon as braille shows,
//       still for reduced motion, announced once to screen readers. Editor braille pane and Quick Mode.
//   J   The Unbox toolbar button looks and sizes like the other text buttons and overlaps nothing, at wide and narrow widths.
//   L   A table's narrow first column never writes "Header 1" one letter per line.
//   M   The on-screen maths keyboard closes when the last equation is deleted, and has a visible Close button while open.
// Plus an axe-core WCAG 2 A/AA scan of the open style menu and of the loading state (axe is vendored in tests/vendor/axe-core, test-only).
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-f9-look.mjs [port]
// Runs in Chrome by default; EMBOSS_ENGINE=webkit|firefox for another (tests/lib/launch-browser.mjs).
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const AXE = fileURLToPath(new URL('./vendor/axe-core/axe.min.js', import.meta.url));
const SAMPLE = '/web/test_samples/nimas_comprehensive_structures_sample.xml';
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE_SETTINGS = { simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' };

async function axeScan(page, { mathlive = false } = {}) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
  // MathLive's own (see test-brand-style.mjs). With mathlive: true also its virtual keyboard's markup (.MLK__*, .ML__*) and the typing
  // area of a focused equation (aria-input-field-name on .ML__keyboard-sink: found here, not caused by this batch; reported to Paul).
  const known = (id, n) => (id === 'nested-interactive' && n.target.join(' ').includes('math-field')) || (mathlive && /MLK__|ML__|math-field/.test(n.target.join(' ')));
  return r.violations
    .map((v) => ({ id: v.id, nodes: v.nodes.filter((n) => !known(v.id, n)) }))
    .filter((v) => v.nodes.length)
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message || n.failureSummary || '').slice(0, 140)}`) }));
}

const browser = await launchBrowser();
const errors = [];

// A page in the editor with a settings object stored once (a sessionStorage flag, so a reload keeps what the page itself later saves).
async function openEditor({ settings = BASE_SETTINGS, viewport = { width: 1400, height: 900 }, colorScheme = 'light', reducedMotion = 'no-preference', slowWasm = 0, extraInit = null } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion, locale: 'en-US' });
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('f9')) { sessionStorage.setItem('f9', '1'); localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} }, settings);
  if (extraInit) await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`editor: ${String(e).slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(8000);
  if (slowWasm) await page.route('**/*.wasm', async (route) => { await wait(slowWasm); try { await route.continue(); } catch {} });
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  return { ctx, page };
}
async function editorReady(page) {
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.render === 'function', null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('#blockStyle option').length > 5 && document.getElementById('editor').innerText.includes('Chapter One'), null, { timeout: 60000 });
  await page.waitForTimeout(500);
}
async function loadModel(page, blocks, needle) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks);
    await wait(500);
    if ((await page.evaluate(() => document.getElementById('editor').innerText)).includes(needle)) return;
  }
  throw new Error('model did not stick: ' + needle);
}

try {
  // =============================== the editor, wide ===============================
  {
    const { ctx, page } = await openEditor();
    await editorReady(page);
    await loadModel(page, [{ type: 'para', text: 'Some plain text here.' }, { type: 'para', text: 'A second paragraph.' }], 'Some plain text');
    await page.click('#editor p >> nth=0');
    await wait(300);

    // ---- C1: the style menu
    ok('C1: the style list is a button that opens a menu (#btnStyleMenu, #styleDropdown)', await page.evaluate(() => !!document.getElementById('btnStyleMenu') && !!document.getElementById('styleDropdown')));
    ok('C1: the button shows the current style', /Body Text/.test(await page.evaluate(() => document.getElementById('btnStyleMenu')?.textContent || '')), await page.evaluate(() => document.getElementById('btnStyleMenu')?.textContent));
    ok('C1: the button has an accessible name that includes the style', /Paragraph style.*Body Text/.test(await page.evaluate(() => document.getElementById('btnStyleMenu')?.getAttribute('aria-label') || '')));
    await page.click('#btnStyleMenu').catch(() => {});
    await wait(250);
    const menu = await page.evaluate(() => {
      const dd = document.getElementById('styleDropdown');
      if (!dd) return null;
      const items = [...dd.querySelectorAll('[role=option]')];
      return {
        visible: !dd.hidden && dd.offsetParent !== null,
        role: dd.getAttribute('role'),
        expanded: document.getElementById('btnStyleMenu')?.getAttribute('aria-expanded'),
        n: items.length,
        selects: document.querySelectorAll('#blockStyle option').length,
        iconless: items.filter((i) => { const ic = i.querySelector('.insert-icon'); return !ic || !(ic.querySelector('svg') || (ic.textContent || '').trim()); }).map((i) => i.textContent.trim()),
        selected: items.filter((i) => i.getAttribute('aria-selected') === 'true').map((i) => i.dataset.value),
        labels: items.map((i) => i.querySelector('.insert-lbl')?.textContent.trim()),
        focused: document.activeElement?.dataset?.value || document.activeElement?.id,
      };
    });
    ok('C1: opening it shows a listbox, aria-expanded true', !!menu && menu.visible && menu.role === 'listbox' && menu.expanded === 'true', menu);
    ok('C1: one row per style the old list offered (7 everyday styles)', !!menu && menu.n === menu.selects && menu.n >= 7, menu);
    ok('C1: every row has an icon', !!menu && menu.n > 0 && menu.iconless.length === 0, menu?.iconless);
    ok('C1: the current style (Body Text) is the one marked', !!menu && menu.selected.join() === 'p', menu?.selected);
    ok('C1: Body Text, Heading, Bullet List, Numbered List and Table are in the menu', !!menu && ['Body Text', 'Heading', 'Bullet List', 'Numbered List', 'Table (Spatial)'].every((w) => menu.labels.includes(w)), menu?.labels);
    ok('C1: opening it puts the keyboard on the current style', !!menu && menu.focused === 'p', menu?.focused);
    // the same look as Insert
    const look = async (ddId, itemSel) => page.evaluate(([d, s]) => {
      const dd = document.getElementById(d); const it = dd?.querySelector(s);
      if (!dd || !it) return null;
      const a = getComputedStyle(dd), b = getComputedStyle(it);
      return { radius: a.borderTopLeftRadius, bg: a.backgroundColor, border: a.borderTopWidth + a.borderTopStyle, itemFont: b.fontSize + '/' + b.fontWeight, gap: b.columnGap, pad: b.padding, iconW: getComputedStyle(it.querySelector('.insert-icon')).width };
    }, [ddId, itemSel]);
    const styleLook = await look('styleDropdown', '[role=option]');
    // axe on the open style menu
    ok('C1: nothing for axe to flag with the style menu open (WCAG 2 A/AA)', (await axeScan(page)).length === 0, await axeScan(page));
    await page.keyboard.press('Escape'); await wait(200);
    ok('C1: Esc closes the menu and the keyboard is back on the button', await page.evaluate(() => document.getElementById('styleDropdown')?.hidden === true && document.activeElement?.id === 'btnStyleMenu' && document.getElementById('btnStyleMenu')?.getAttribute('aria-expanded') === 'false'));
    await page.click('#btnInsertMenu'); await wait(250);
    const insertLook = await look('insertDropdown', '.insert-item');
    ok('C1: the style menu looks like the Insert menu (corners, background, border, item text, gap, padding, icon box)', !!styleLook && !!insertLook && JSON.stringify(styleLook) === JSON.stringify(insertLook), { styleLook, insertLook });
    await page.click('#btnStyleMenu').catch(() => {}); await wait(250);
    ok('C1: opening the style menu closes Insert (one menu open at a time)', await page.evaluate(() => document.getElementById('insertDropdown').hidden && document.getElementById('styleDropdown')?.hidden === false));
    await page.click('#btnInsertMenu'); await wait(250);
    ok('C1: opening Insert closes the style menu', await page.evaluate(() => !document.getElementById('insertDropdown').hidden && document.getElementById('styleDropdown')?.hidden === true));
    await page.keyboard.press('Escape'); await wait(150);

    // keyboard: open with Down, Down again, Enter -> Heading
    await page.focus('#btnStyleMenu').catch(() => {});
    await page.keyboard.press('ArrowDown'); await wait(200);
    ok('C1 keyboard: Down on the button opens the menu on the current style', await page.evaluate(() => document.getElementById('styleDropdown')?.hidden === false && document.activeElement?.dataset?.value === 'p'));
    await page.keyboard.press('ArrowDown'); await wait(100);
    ok('C1 keyboard: Down moves to the next style', await page.evaluate(() => document.activeElement?.dataset?.value === 'h1'), await page.evaluate(() => document.activeElement?.dataset?.value));
    await page.keyboard.press('End'); await wait(100);
    const last = await page.evaluate(() => document.activeElement?.dataset?.value);
    await page.keyboard.press('Home'); await wait(100);
    ok('C1 keyboard: End and Home go to the last and first style', last && last !== 'p' && (await page.evaluate(() => document.activeElement?.dataset?.value)) === 'p', last);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await wait(500);
    const afterPick = await page.evaluate(() => ({ value: document.getElementById('blockStyle').value, h1: document.querySelectorAll('#editor h1').length, closed: document.getElementById('styleDropdown')?.hidden === true, label: document.getElementById('btnStyleMenu')?.textContent.trim(), name: document.getElementById('btnStyleMenu')?.getAttribute('aria-label'), active: document.activeElement?.closest('#editor') ? 'editor' : (document.activeElement?.id || document.activeElement?.tagName) }));
    ok('C1 keyboard: Enter picks the style: the paragraph becomes a Heading 1, the menu closes, the keyboard goes back to the text', afterPick.value === 'h1' && afterPick.h1 >= 1 && afterPick.closed && afterPick.active === 'editor', afterPick);
    ok('C1: the button now names the new style', /H1 Heading/.test(afterPick.label) && /H1 Heading/.test(afterPick.name || ''), afterPick);
    // mouse: pick Bullet List from the menu
    await page.click('#btnStyleMenu').catch(() => {}); await wait(250);
    await page.click('#styleDropdown [role=option][data-value="bullet"]').catch(() => {}); await wait(500);
    ok('C1 mouse: clicking Bullet List makes a list', await page.evaluate(() => document.getElementById('blockStyle').value === 'bullet' && document.querySelectorAll('#editor ul li, #editor li').length >= 1), await page.evaluate(() => document.getElementById('blockStyle').value));
    // the native select is out of sight and out of the accessibility tree, but still the model
    const sel = await page.evaluate(() => { const s = document.getElementById('blockStyle'); const r = s.getBoundingClientRect(); return { w: r.width, h: r.height, hidden: s.getAttribute('aria-hidden'), tab: s.tabIndex }; });
    ok('C1: the native <select> stays as the model, hidden from sight and from screen readers', sel.w <= 2 && sel.h <= 2 && sel.hidden === 'true' && sel.tab === -1, sel);

    // ---- C2: Equation Templates
    await page.click('#btnInsertMenu'); await wait(250);
    ok('C2: the Insert menu item is "Equation Templates"', (await page.evaluate(() => document.getElementById('btnFormula').textContent.replace(/\s+/g, ' ').trim())) === 'Equation Templates', await page.evaluate(() => document.getElementById('btnFormula').textContent));
    await page.click('#btnFormula'); await wait(800);
    ok('C2: its dialog is titled "Equation Templates"', (await page.evaluate(() => document.getElementById('formulaTitle').textContent.trim())) === 'Equation Templates', await page.evaluate(() => document.getElementById('formulaTitle').textContent));
    await page.keyboard.press('Escape'); await wait(300);

    // ---- E1: Settings has no six-key checkbox; the toolbar button toggles
    await page.click('#settingsBtn'); await wait(500);
    ok('E1: no "Perkins 6-Key Input" checkbox in Settings', await page.evaluate(() => !document.getElementById('set-sixkey') && !/Perkins/i.test(document.getElementById('settingsDialog').textContent)), await page.evaluate(() => /Perkins/i.test(document.getElementById('settingsDialog').textContent)));
    await page.keyboard.press('Escape'); await wait(300);
    await page.click('#btnSixKey'); await wait(200);
    const on = await page.evaluate(() => document.getElementById('btnSixKey').getAttribute('aria-pressed'));
    await page.click('#btnSixKey'); await wait(200);
    const off = await page.evaluate(() => document.getElementById('btnSixKey').getAttribute('aria-pressed'));
    ok('E1: the toolbar six-key button still toggles', on === 'true' && off === 'false', { on, off });
    await ctx.close();
  }

  // =============================== E1: an old "six-key off" setting no longer hides the button ===============================
  {
    const { ctx, page } = await openEditor({ settings: { ...BASE_SETTINGS, sixKeyInput: false } });
    await editorReady(page);
    ok('E1: with an old saved sixKeyInput:false the toolbar six-key button is still there', await page.evaluate(() => { const b = document.getElementById('btnSixKey'); return !!b && b.offsetParent !== null && getComputedStyle(b).display !== 'none'; }));
    await page.click('#btnSixKey', { timeout: 3000 }).catch(() => {}); await wait(200);
    ok('E1: …and it works (no "turned off in Settings" refusal)', (await page.evaluate(() => document.getElementById('btnSixKey').getAttribute('aria-pressed'))) === 'true');
    await ctx.close();
  }

  // =============================== J: the Unbox button, wide and narrow ===============================
  for (const width of [1400, 900, 700]) {
    const { ctx, page } = await openEditor({ viewport: { width, height: 900 } });
    await editorReady(page);
    await loadModel(page, [{ type: 'para', text: 'Before the box.' }, { type: 'box', title: 'My Box', blocks: [{ type: 'heading', level: 2, text: 'My Box' }, { type: 'para', text: 'Inside text.' }] }], 'Before the box');
    await page.evaluate(() => {
      window.editor.update(() => { let n = window.editor.getEditorState()._nodeMap.get('root').getChildren()[1]; while (n.getLastChild && n.getLastChild()) n = n.getLastChild(); n.selectEnd(); });
      window.editor.focus();
    });
    await wait(700);
    const r = await page.evaluate(() => {
      const btn = document.getElementById('btnUnbox');
      if (!btn || btn.hidden) return { shown: false };
      const rect = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      const me = rect(btn);
      const overlaps = [...document.querySelectorAll('#toolbar > *')].filter((e) => e !== btn && e.offsetParent !== null && e.getBoundingClientRect().width > 0 && getComputedStyle(e).position !== 'absolute')
        .filter((e) => { const o = rect(e); return o.l < me.r - 0.5 && o.r > me.l + 0.5 && o.t < me.b - 0.5 && o.b > me.t + 0.5; }).map((e) => e.id || e.className);
      const ref = document.getElementById('btnBrailleFmt'); const cs = getComputedStyle(btn), rs = getComputedStyle(ref);
      return { shown: true, me, overlaps, textFits: btn.scrollWidth <= btn.clientWidth + 1, h: cs.height, refH: rs.height, font: cs.fontSize + '/' + cs.fontWeight, refFont: rs.fontSize + '/' + rs.fontWeight, radius: cs.borderTopLeftRadius, refRadius: rs.borderTopLeftRadius, border: cs.borderTopWidth, refBorder: rs.borderTopWidth, pad: cs.paddingLeft, wide: me.w > 36 };
    });
    ok(`J [${width}px]: Unbox is shown with the caret in a box`, r.shown, r);
    ok(`J [${width}px]: Unbox overlaps no other toolbar control`, r.shown && r.overlaps.length === 0, r.overlaps);
    ok(`J [${width}px]: its word fits inside the button, which is wider than a 30px icon button`, r.shown && r.textFits && r.wide, r.me);
    ok(`J [${width}px]: it is sized and styled like the other text buttons (height, font, corners, border)`, r.shown && r.h === r.refH && r.font === r.refFont && r.radius === r.refRadius && r.border === r.refBorder, r);
    await ctx.close();
  }

  // =============================== L: a narrow first table column ===============================
  {
    const { ctx, page } = await openEditor();
    await editorReady(page);
    const longText = 'The introduction is appealing and informative. The topic is well developed with relevant facts, concrete details, interesting quotations, and examples that make the point clear to the reader.';
    await loadModel(page, [{ type: 'para', text: 'Before the table.' }, { type: 'table', format: 'spatial', headers: ['Header 1', 'Ideas and Evidence', 'Organization', 'Language'], rows: [['Advanced', longText, longText, longText], ['Proficient', longText, longText, longText]] }], 'Before the table');
    await wait(600);
    const t = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('#editor .editor-table-widget .table-cell-input')];
      const first = cells.find((c) => /Header 1/.test(c.textContent));
      if (!first) return { found: false };
      const range = document.createRange(); range.selectNodeContents(first);
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      const col = first.closest('th, td'); const rows = [...first.closest('table').rows].map((r) => r.cells[0].getBoundingClientRect().width);
      const adv = cells.find((c) => /Advanced/.test(c.textContent)); const r2 = document.createRange(); r2.selectNodeContents(adv);
      const tops2 = new Set([...r2.getClientRects()].map((r) => Math.round(r.top)));
      return { found: true, lines: tops.size, width: col.getBoundingClientRect().width, advancedLines: tops2.size, colWidths: rows, tableW: first.closest('table').getBoundingClientRect().width };
    });
    ok('L: the table is there', t.found, t);
    ok('L: "Header 1" is on one line, or two at the space, never a letter a line', t.found && t.lines <= 2, t);
    ok('L: the first column is at least 60px wide', t.found && t.width >= 60, t);
    ok('L: a short word in a first-column cell ("Advanced") is not broken either', t.found && t.advancedLines <= 1, t);
    await ctx.close();
  }

  // =============================== M: the maths keyboard ===============================
  {
    const { ctx, page } = await openEditor();
    await editorReady(page);
    await loadModel(page, [{ type: 'para', text: 'An equation follows.' }], 'An equation');
    await page.click('#editor p >> nth=0'); await wait(200);
    await page.click('#btnInsertMenu'); await page.click('#btnMath'); await wait(900);
    await page.evaluate(() => document.querySelector('#editor math-field').setValue('x^2+1'));
    ok('M: an equation is in the document', (await page.evaluate(() => document.querySelectorAll('#editor math-field').length)) === 1);
    await page.evaluate(() => window.mathVirtualKeyboard.show()); await wait(700);
    ok('M: the maths keyboard opens', await page.evaluate(() => window.mathVirtualKeyboard.visible));
    const closeBtn = await page.evaluate(() => { const b = document.getElementById('mathKbClose'); if (!b) return null; const r = b.getBoundingClientRect(); const k = window.mathVirtualKeyboard.boundingRect; return { hidden: b.hidden, shown: b.offsetParent !== null || getComputedStyle(b).position === 'fixed', bottom: r.bottom, kTop: k.top, w: r.width, name: b.getAttribute('aria-label') || b.textContent.trim(), inView: r.top >= 0 && r.right <= innerWidth }; });
    ok('M: while it is open there is a visible Close button, named, above the keyboard and on screen', !!closeBtn && !closeBtn.hidden && closeBtn.w > 20 && closeBtn.bottom <= closeBtn.kTop + 1 && closeBtn.inView && /close/i.test(closeBtn.name), closeBtn);
    ok('M: nothing for axe to flag with the maths keyboard and its Close button showing (WCAG 2 A/AA)', (await axeScan(page, { mathlive: true })).length === 0, await axeScan(page, { mathlive: true }));
    await page.click('#mathKbClose').catch(() => {}); await wait(600);
    ok('M: the Close button closes the keyboard', !(await page.evaluate(() => window.mathVirtualKeyboard.visible)));
    ok('M: …and the Close button is gone with it', await page.evaluate(() => { const b = document.getElementById('mathKbClose'); return !b || b.hidden; }));
    // delete the last equation with the keyboard open: it closes by itself
    await page.evaluate(() => window.mathVirtualKeyboard.show()); await wait(600);
    await page.evaluate(() => document.querySelector('#editor math-field').focus());
    // S1 #24 (MathLive 0.111.1): a programmatic focus() of the field, with the maths keyboard just re-opened, takes effect a moment
    // later (0.101.2 did it at once), so a key pressed in the same instant went to the text, not the equation. A user's click is not
    // affected. The test waits for the focus it asked for.
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'MATH-FIELD', null, { timeout: 5000 }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await wait(800);
    const left = await page.evaluate(() => document.querySelectorAll('math-field').length);
    ok('M: the equation is deleted', left === 0, left);
    ok('M: with no equation left the maths keyboard closes by itself', !(await page.evaluate(() => window.mathVirtualKeyboard.visible)));
    await ctx.close();
  }

  // =============================== H: Quick Mode has one Read button ===============================
  for (const scheme of ['light']) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, locale: 'en-US' });
    await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`quick: ${String(e).slice(0, 200)}`));
    await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => /Ready/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
    const text = await page.evaluate(async (u) => (await fetch(u)).text(), SAMPLE);
    await page.setInputFiles('#fileInput', { name: 'sample.xml', mimeType: 'text/xml', buffer: Buffer.from(text) });
    await page.waitForFunction(() => (window.lastBrf || '').trim().length > 50 && document.querySelector('#preview .brl-row'), null, { timeout: 60000 });
    await wait(800);
    const reads = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && /Read Aloud|Read\b/.test(b.textContent)).map((b) => b.id));
    // CHANGED 17 Oct 2026 (Paul's decision, feedback item 8b): Read is removed from Quick Mode altogether (the one Read button above the braille, which this used to
    // check, is gone; reading aloud is the editor's). What stays checked: there is no Read button, and the old drop-area one is still gone.
    ok('H: Quick Mode has no Read button after a document is loaded', reads.length === 0, reads);
    ok('H: neither the result bar\'s Read button nor the drop area\'s (#readBtn, #dzReadBtn) exists', await page.evaluate(() => !document.getElementById('readBtn') && !document.getElementById('dzReadBtn')));
    await ctx.close();
  }

  // =============================== I: the loading state ===============================
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openEditor({
      colorScheme: scheme, reducedMotion: scheme === 'dark' ? 'reduce' : 'no-preference', slowWasm: 3500,
      extraInit: () => {
        window.__f9announced = [];
        document.addEventListener('DOMContentLoaded', () => {
          const a = document.getElementById('announce'); if (!a) return;
          new MutationObserver(() => { const tx = a.textContent; if (tx && /oading/.test(tx)) window.__f9announced.push(tx); }).observe(a, { childList: true, characterData: true, subtree: true });
        });
      },
    });
    await page.waitForFunction(() => !!document.querySelector('#braille .engine-loading, #braille') && /oading/.test(document.getElementById('braille')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
    await wait(400);
    const ld = await page.evaluate(() => {
      const el = document.querySelector('#braille .engine-loading');
      if (!el) return { found: false, text: document.getElementById('braille')?.textContent, font: getComputedStyle(document.getElementById('braille')).fontFamily };
      const cs = getComputedStyle(el), sp = el.querySelector('.engine-spinner'), ss = sp && getComputedStyle(sp);
      return { found: true, text: el.textContent.trim(), font: cs.fontFamily, color: cs.color, bodyBg: getComputedStyle(document.body).backgroundColor, spinner: !!sp, spinnerHidden: sp?.getAttribute('aria-hidden'), anim: ss && ss.animationName, animDur: ss && ss.animationDuration, ariaLive: el.getAttribute('aria-live') || el.closest('[aria-live]')?.id || null };
    });
    ok(`I [${scheme}]: the editor's braille pane shows a styled loading state while the engine loads`, ld.found && /oading/.test(ld.text), ld);
    ok(`I [${scheme}]: it is in the page's own font, not monospace`, ld.found && !/mono|APHfont|Braille/i.test(ld.font), ld.font);
    ok(`I [${scheme}]: it has a spinner, hidden from screen readers`, ld.found && ld.spinner && ld.spinnerHidden === 'true', ld);
    if (scheme === 'dark') ok('I [dark, reduced motion]: the spinner does not spin', ld.found && (ld.anim === 'none' || ld.animDur === '0s'), ld);
    else ok('I [light]: the spinner spins when motion is allowed', ld.found && ld.anim && ld.anim !== 'none' && ld.animDur !== '0s', ld);
    ok(`I [${scheme}]: its colour stands out from the page background`, ld.found && ld.color !== ld.bodyBg, ld);
    ok(`I [${scheme}]: nothing for axe to flag while it shows (WCAG 2 A/AA)`, (await axeScan(page)).length === 0, await axeScan(page));
    await editorReady(page);
    await page.waitForFunction(() => document.querySelectorAll('#braille .brl-row').length > 3, null, { timeout: 30000 });
    ok(`I [${scheme}]: it is gone once braille shows`, await page.evaluate(() => !document.querySelector('#braille .engine-loading') && !/oading/.test(document.getElementById('braille').textContent)));
    const heard = await page.evaluate(() => window.__f9announced);
    ok(`I [${scheme}]: it was announced politely once, not repeatedly`, heard.length === 1, heard);
    await ctx.close();
  }
  {
    // Quick Mode: the same
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light', locale: 'en-US' });
    await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`quick: ${String(e).slice(0, 200)}`));
    await page.route('**/*.wasm', async (route) => { await wait(3500); try { await route.continue(); } catch {} });
    await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
    await wait(1200);
    const q = await page.evaluate(() => {
      const st = document.getElementById('status'); const el = st.querySelector('.engine-loading');
      return { found: !!el, text: st.textContent.trim(), spinner: !!st.querySelector('.engine-spinner'), font: getComputedStyle(st).fontFamily, role: st.getAttribute('role') };
    });
    ok('I [Quick Mode]: the status line shows the same spinner + words while the engine loads', q.found && q.spinner && /oading/.test(q.text) && !/mono/i.test(q.font), q);
    ok('I [Quick Mode]: nothing for axe to flag while it shows (WCAG 2 A/AA)', (await axeScan(page)).length === 0, await axeScan(page));
    await page.waitForFunction(() => /Ready/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
    ok('I [Quick Mode]: it is gone when the engine is ready', await page.evaluate(() => !document.querySelector('#status .engine-loading') && !document.querySelector('#status .engine-spinner')));
    await ctx.close();
  }

  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== F9 look batch 1 [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
