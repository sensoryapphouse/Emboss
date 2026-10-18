// Tester feedback 10 Oct 2026, item 6 (Paul: "Menu bar should match on Translate/Emboss — I am happy with Translate's"): Quick Mode takes Translate's
// button vocabulary and its menu bar behaviour, without any of Paige's identity (the logo and the name stay Emboss's). This checks, in a real browser:
// CHANGED 17 Oct 2026 (Paul's decisions, feedback items 8b and 9b): Quick Mode's header is now Advanced Editor, Load, Export ▾, Help, Settings; the Read /
// Emboss / Download row above the braille is gone (Read is removed from Quick Mode; Emboss became Export's "Send to embosser"; Download became Export ▾,
// which is in the header and disabled until there is braille). The assertions below that named the old buttons are changed to the new ones.
//  - the header is role="toolbar" with a name; Left, Right, Home and End move between its buttons, wrapping, following the screen in a right-to-left
//    language, and leaving Alt/Cmd+Arrow to the browser; Tab still reaches each button on its own; the order is Advanced Editor, Load, Export, Help,
//    Settings (the gear last, as in Translate); every control keeps an accessible name;
//  - Export behaves as Translate's Export menu: it opens onto its first item; Down and Up move and wrap, skipping the hidden PEF item; Escape closes
//    it and puts the focus back on the button (it used to leave it on an item that had just disappeared); Tab closes it; a click elsewhere closes it;
//    choosing an item downloads and puts the focus back on the button;
//  - the buttons are Translate's pills (white, a hairline border, 8px corners, regular weight, blue border and text on hover, a 2px blue focus ring), with
//    no filled button left on the page's own controls, light and dark;
//  - the warning badge, the export notice and the status line are the one pale-yellow look, with dark ink in dark colours;
//  - at 375px nothing runs off the screen and every button is at least 24px (WCAG 2.5.8);
//  - the icons the page's markup uses are in the page before its script has loaded (the inline sprite), and an axe-core WCAG 2 A/AA scan finds nothing
//    with the Export menu open.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-quickmode-menubar.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright'); run-browser-suites.mjs runs it in Chrome, WebKit and Firefox.
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
const AXE = fileURLToPath(new URL('./vendor/axe-core/axe.min.js', import.meta.url));
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail !== '' ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const SETTINGS = (extra = {}) => JSON.stringify({ simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en', ...extra });
const YELLOW = 'rgb(252, 237, 191)';

const browser = await launchBrowser();
const errors = [];
const newPage = async (opts = {}, settings = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', acceptDownloads: true, ...opts });
  await ctx.addInitScript((s) => { try { localStorage.setItem('emboss-settings', s); } catch {} }, SETTINGS(settings));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
};
const ready = async (page) => { await page.waitForFunction(() => /Ready/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 }); };
const load = async (page, name, text) => {
  await page.setInputFiles('#fileInput', { name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.waitForFunction(() => !document.getElementById('result').hidden && (window.lastBrf || '').trim().length > 5 && document.querySelector('#preview .brl-row'), null, { timeout: 60000 });
  await page.waitForTimeout(300);
};
const active = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || '');
const press = async (page, key) => { await page.keyboard.press(key); await page.waitForTimeout(120); };

try {
  // ---------------------------------------------------------------- the menu bar: roles, names, order
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await ready(page);
    const head = await page.locator('#headRight').ariaSnapshot().catch((e) => String(e));
    // Changed 17 Oct 2026 (Paul, item 9b): Advanced Editor, Load, Export, Help, Settings; 18 Oct (Paul): no Load (drag and drop, or Choose file)
    ok('the header is a toolbar with a name, holding Advanced Editor, Export, Help and Settings in that order (the gear last, as in Translate)',
      /toolbar "[^"]+"/.test(head) && !/button "Load"/.test(head) && /button "Advanced Editor"[\s\S]*button "Export"[\s\S]*button "Help"[\s\S]*button "Settings"/.test(head), head);
    const names = await page.evaluate(() => [...document.querySelectorAll('button, [role=button], a[href], input, select, summary')]
      .filter((e) => e.offsetParent !== null || e.getClientRects().length)
      .filter((e) => !(e.type === 'file' || e.type === 'hidden'))
      .map((e) => ({ id: e.id || e.className || e.tagName, name: (e.getAttribute('aria-label') || e.labels?.[0]?.textContent || e.textContent || e.title || '').trim() }))
      .filter((x) => !x.name));
    ok('every visible control has a name (light, before a document)', names.length === 0, names);

    // Tab order and arrow keys in the header
    // Export is disabled until there is braille, so it is not a stop (a disabled button takes no focus): Advanced Editor, Load, Help, Settings
    await page.focus('#advancedBtn');
    await press(page, 'Tab');
    const t1 = await active(page);
    await press(page, 'Tab');
    const t2 = await active(page);
    await press(page, 'Tab');
    const t3 = await active(page);
    // Changed 18 Oct 2026 (Paul): Quick Mode's header has no Load button (drag and drop, or Choose file).
    ok('Tab walks Advanced Editor, (Export is off until there is braille), Help, Settings, one stop each', t1 === 'helpBtn' && t2 === 'settingsBtn' && t3 !== 'helpBtn', { t1, t2, t3 });
    await page.focus('#advancedBtn');
    await press(page, 'ArrowRight'); const r1 = await active(page);
    await press(page, 'ArrowRight'); const r2 = await active(page);
    await press(page, 'ArrowRight'); const r3 = await active(page);
    await press(page, 'ArrowRight'); const r4 = await active(page);
    ok('Right moves Advanced Editor → Help → Settings and wraps to the first', r1 === 'helpBtn' && r2 === 'settingsBtn' && r3 === 'advancedBtn' && r4 === 'helpBtn', { r1, r2, r3, r4 });
    ok('Export is disabled, with its reason in its title, until a document is brailled', await page.evaluate(() => { const b = document.getElementById('downloadBtn'); return b.disabled && /Export/.test(b.title); }));
    await page.focus('#advancedBtn');
    await press(page, 'ArrowLeft'); const l1 = await active(page);
    await press(page, 'End'); const e1 = await active(page);
    await press(page, 'Home'); const h1 = await active(page);
    ok('Left wraps to the last; End goes to the last; Home to the first', l1 === 'settingsBtn' && e1 === 'settingsBtn' && h1 === 'advancedBtn', { l1, e1, h1 });
    await press(page, 'Alt+ArrowRight'); const a1 = await active(page);
    await press(page, 'Shift+ArrowRight'); const a2 = await active(page);
    ok('a key held with Alt or Shift is left to the browser (Alt+Left is Back)', a1 === 'advancedBtn' && a2 === 'advancedBtn', { a1, a2 });
    // right-to-left: the arrows follow the screen, so Left is the next button in the document
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await page.focus('#advancedBtn');
    await press(page, 'ArrowLeft'); const rl1 = await active(page);
    await press(page, 'ArrowRight'); const rl2 = await active(page);
    ok('in a right-to-left language Left goes to the next button and Right to the previous', rl1 === 'helpBtn' && rl2 === 'advancedBtn', { rl1, rl2 });
    await page.evaluate(() => { document.documentElement.dir = 'ltr'; });

    // the first-paint sprite is checked below with the script held back; here, the whole set is in by now
    const sprite = await page.evaluate(() => ({ count: document.querySelectorAll('#emboss-icon-sprite').length, ids: [...document.querySelectorAll('[id^="icon-"]')].map((e) => e.id) }));
    ok('one sprite, and no icon id twice, once the script has added the rest', sprite.count === 1 && new Set(sprite.ids).size === sprite.ids.length && sprite.ids.length > 20, sprite);
    await ctx.close();
  }

  // ---------------------------------------------------------------- the workflow toolbar and the Download menu
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await ready(page);
    await load(page, 'sample.txt', 'Hello world. This is a short document for the braille.');
    ok('there is no Read / Emboss / Download row above the braille any more (Paul, 17 Oct 2026)', await page.evaluate(() => !document.getElementById('resultActions') && !document.getElementById('readBtn') && !document.getElementById('embossBtn') && !document.getElementById('dzEmbossBtn')));
    ok('Export is enabled now that there is braille', await page.evaluate(() => !document.getElementById('downloadBtn').disabled));
    await page.focus('#advancedBtn');
    await press(page, 'ArrowRight'); const w1 = await active(page);
    await press(page, 'ArrowRight'); const w2 = await active(page);
    await press(page, 'End'); const w3 = await active(page);
    await press(page, 'Home'); const w4 = await active(page);
    ok('the header\'s arrow keys now take in Export', w1 === 'downloadBtn' && w2 === 'helpBtn' && w3 === 'settingsBtn' && w4 === 'advancedBtn', { w1, w2, w3, w4 });
    // reveal the hardware controls (Ctrl/Cmd+Shift+\): "Send to embosser" joins the Export menu
    ok('"Send to embosser" is not offered until the hardware controls are revealed', await page.evaluate(() => document.getElementById('downloadEmbossItem').offsetParent === null));
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('Backslash'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    const shown = await page.evaluate(() => document.getElementById('downloadEmbossItem').offsetParent !== null);
    if (shown) {
      ok('revealed, "Send to embosser" is the last item of the Export menu', await page.evaluate(() => { const items = [...document.querySelectorAll('#downloadMenu [role=menuitem]')].filter((b) => b.offsetParent !== null); return items[items.length - 1].id === 'downloadEmbossItem'; }));
      await press(page, 'Escape');
      await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('Backslash'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    } else { await press(page, 'Escape'); console.log(`  skipped in ${ENGINE_LABEL}: the hardware shortcut did not reveal Send to embosser here`); }

    const open = () => page.evaluate(() => ({ hidden: document.getElementById('downloadMenu').hidden, expanded: document.getElementById('downloadBtn').getAttribute('aria-expanded'), active: document.activeElement?.id || document.activeElement?.tagName }));
    ok('the menu is labelled by its button and the button names it', await page.evaluate(() => document.getElementById('downloadMenu').getAttribute('aria-labelledby') === 'downloadBtn' && document.getElementById('downloadBtn').getAttribute('aria-controls') === 'downloadMenu'));
    const pefHidden = await page.evaluate(() => document.getElementById('downloadPefItem').hidden);

    await page.click('#downloadBtn'); await page.waitForTimeout(200);
    let o = await open();
    ok('clicking Export opens the menu and puts the focus on its first item', !o.hidden && o.expanded === 'true' && o.active === 'downloadBrfItem', o);
    await press(page, 'ArrowDown'); const d1 = await active(page);
    await press(page, 'ArrowDown'); const d2 = await active(page);
    await press(page, 'ArrowUp'); const d3 = await active(page);
    ok('Down and Up move between the items and wrap' + (pefHidden ? ', skipping the hidden PEF item' : ''), d1 === 'downloadEbrlItem' && d2 === 'downloadBrfItem' && d3 === 'downloadEbrlItem', { d1, d2, d3, pefHidden });
    await press(page, 'Escape'); o = await open();
    ok('Escape closes the menu and puts the focus back on the Export button', o.hidden && o.expanded === 'false' && o.active === 'downloadBtn', o);

    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    await page.focus('#downloadBtn'); await press(page, 'Escape'); o = await open();
    ok('Escape closes it when the focus is on the button too', o.hidden && o.active === 'downloadBtn', o);

    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    await press(page, 'ArrowDown'); await press(page, 'Tab'); o = await open();
    const afterTab = await page.evaluate(() => ({ inMenu: !!document.activeElement?.closest?.('#downloadMenu'), id: document.activeElement?.id || document.activeElement?.tagName }));
    ok('Tab closes the menu and the focus goes on, not into the hidden menu', o.hidden && o.expanded === 'false' && !afterTab.inMenu, { o, afterTab });
    console.log(`        (after Tab from the last item the focus is on: ${afterTab.id})`);

    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    await press(page, 'Shift+Tab'); o = await open();
    ok('Shift+Tab closes it too, and the focus goes back to the Export button', o.hidden && o.expanded === 'false' && o.active === 'downloadBtn', o);

    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    await page.click('#resultMeta'); await page.waitForTimeout(150); o = await open();
    ok('a click elsewhere closes it', o.hidden && o.expanded === 'false', o);

    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    await page.click('#downloadBtn'); await page.waitForTimeout(150); o = await open();
    ok('clicking Export again closes it, with the focus on the button', o.hidden && o.active === 'downloadBtn', o);

    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    const axeOpen = await (async () => {
      if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
      const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
      return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }));
    })();
    ok('an axe-core WCAG 2 A/AA scan finds nothing with the Export menu open', axeOpen.length === 0, axeOpen);
    await press(page, 'Escape');

    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#downloadBrfItem')]);
    await page.waitForTimeout(250); o = await open();
    ok('choosing Braille (BRF) downloads a .brf, closes the menu and puts the focus back on the Export button', /\.brf$/.test(dl.suggestedFilename()) && o.hidden && o.active === 'downloadBtn', { file: dl.suggestedFilename(), o });
    await ctx.close();
  }

  // ---------------------------------------------------------------- the look: Translate's pills, light and dark
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await newPage({ colorScheme: scheme });
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await ready(page);
    await load(page, 'sample.txt', 'Hello world.');
    const look = await page.evaluate(() => {
      const out = {};
      for (const id of ['advancedBtn', 'helpBtn', 'chooseBtn', 'downloadBtn', 'settingsBtn']) {
        const s = getComputedStyle(document.getElementById(id));
        out[id] = { bg: s.backgroundColor, color: s.color, radius: s.borderTopLeftRadius, border: `${s.borderTopWidth} ${s.borderTopStyle}`, weight: s.fontWeight, shadow: s.boxShadow, w: document.getElementById(id).getBoundingClientRect().width, h: document.getElementById(id).getBoundingClientRect().height };
      }
      out.page = getComputedStyle(document.body).backgroundColor;
      out.pill = getComputedStyle(document.documentElement).getPropertyValue('--pill-bg').trim();
      return out;
    });
    const ACCENT_FILL = 'rgb(31, 111, 209)';
    const pills = ['advancedBtn', 'helpBtn', 'chooseBtn', 'downloadBtn'];
    ok(`[${scheme}] the page's own buttons are pills: no filled blue, no green, no shadow, 8px corners, a 1px border`,
      pills.every((id) => look[id].bg !== ACCENT_FILL && look[id].bg !== 'rgb(19, 122, 59)' && look[id].shadow === 'none' && look[id].radius === '8px' && look[id].border === '1px solid'), look);
    if (scheme === 'light') ok('[light] a pill is white with ink text and regular weight, like Translate\'s', pills.every((id) => look[id].bg === 'rgb(255, 255, 255)' && look[id].color === 'rgb(68, 68, 68)' && look[id].weight === '400'), look);
    ok(`[${scheme}] the gear is a 34px square icon button`, Math.round(look.settingsBtn.w) === 34 && Math.round(look.settingsBtn.h) === 34 && look.settingsBtn.radius === '8px', look.settingsBtn);

    // hover and keyboard focus
    await page.hover('#helpBtn'); await page.waitForTimeout(350);
    const hov = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('helpBtn')); return { border: s.borderTopColor, color: s.color }; });
    const token = (name) => page.evaluate((n) => { const d = document.createElement('i'); d.style.color = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, name);
    const accent = await token('--accent');
    const accentText = await token('--accent-text');
    // the border takes the brand blue; the TEXT takes --accent-text (12:1), not Translate's --accent, which is 4.1:1 on white and fails AA for read text
    ok(`[${scheme}] on hover a pill's border turns the accent blue and its text --accent-text (AA)`, hov.border === accent && hov.color === accentText, { hov, accent, accentText });
    await page.mouse.move(5, 400);
    await page.focus('#advancedBtn'); await press(page, 'ArrowRight'); await press(page, 'ArrowRight');   // keyboard focus on Help (Advanced Editor, Export, Help)
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('helpBtn')); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, offset: s.outlineOffset }; });
    ok(`[${scheme}] keyboard focus draws a 2px accent ring two pixels out`, ring.style === 'solid' && ring.width === '2px' && ring.color === accent && ring.offset === '2px', { ring, accent });
    const ringIcon = await (async () => { await press(page, 'ArrowRight'); return page.evaluate(() => { const s = getComputedStyle(document.getElementById('settingsBtn')); return { style: s.outlineStyle, width: s.outlineWidth }; }); })();
    ok(`[${scheme}] the gear shows the same focus ring`, ringIcon.style === 'solid' && ringIcon.width === '2px', ringIcon);
    await ctx.close();
  }

  // ---------------------------------------------------------------- warnings: one look (UKAAF: a star symbol makes a transcription warning)
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await newPage({ colorScheme: scheme }, { mode: 'ukaaf', cells: 30, lines: 25 });
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await ready(page);
    await load(page, 'star.txt', 'A star symbol: ★ here.');
    const badge = await page.evaluate(() => { const b = document.getElementById('quickWarnBadge'); if (!b || b.hidden) return null; const s = getComputedStyle(b); return { bg: s.backgroundColor, color: s.color }; });
    const INK = scheme === 'dark' ? 'rgb(13, 17, 23)' : 'rgb(68, 68, 68)';
    ok(`[${scheme}] the warning badge is the pale-yellow look`, !!badge && badge.bg === YELLOW && badge.color === INK, badge);
    await page.click('#downloadBtn'); await page.waitForTimeout(150);
    await page.click('#downloadBrfItem'); await page.waitForTimeout(500);
    // the status line's own 'warn' state is checked on its style: setStatus(msg, 'warn') is overwritten by 'Exported …' in the same call, so it is never on screen
    await page.evaluate(() => { const st = document.getElementById('status'); st.className = 'status warn'; st.textContent = 'Emboss had to skip or change 1 thing.'; });
    const notice = await page.evaluate(() => {
      const n = document.getElementById('exportWarnNotice'); const st = document.getElementById('status');
      const a = getComputedStyle(n), b = getComputedStyle(st);
      return { shown: !n.hidden, noticeBg: a.backgroundColor, noticeColor: a.color, noticeRadius: a.borderTopLeftRadius, statusClass: st.className, statusBg: b.backgroundColor, statusColor: b.color, statusRadius: b.borderTopLeftRadius };
    });
    ok(`[${scheme}] the export notice is the same yellow, 6px corners, ink text`, notice.shown && notice.noticeBg === YELLOW && notice.noticeColor === INK && notice.noticeRadius === '6px', notice);
    ok(`[${scheme}] a warning in the status line is the same yellow box, not amber text`, /warn/.test(notice.statusClass) && notice.statusBg === YELLOW && notice.statusColor === INK && notice.statusRadius === '6px', notice);
    await ctx.close();
  }

  // ---------------------------------------------------------------- a phone: nothing runs off the screen, every button is big enough
  {
    const { ctx, page } = await newPage({ viewport: { width: 375, height: 812 } });
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await ready(page);
    await load(page, 'sample.txt', 'Hello world.');
    const fit = await page.evaluate(() => {
      const tooWide = document.documentElement.scrollWidth > window.innerWidth;
      const out = [];
      // a phone is Quick Mode only (Paul, 18 Oct 2026): no Advanced Editor button at 375 px - the others must all be on screen
      const adv = document.getElementById('advancedBtn');
      if (adv && adv.getClientRects().length > 0) out.push({ id: 'advancedBtn', shown: true });
      for (const id of ['helpBtn', 'settingsBtn', 'chooseBtn', 'downloadBtn']) {
        const r = document.getElementById(id).getBoundingClientRect();
        if (r.right > window.innerWidth + 0.5 || r.left < -0.5 || r.width < 24 || r.height < 24) out.push({ id, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) });
      }
      return { tooWide, out };
    });
    ok('at 375px the page does not scroll sideways and every button is on screen and at least 24px', !fit.tooWide && fit.out.length === 0, fit);
    await page.click('#downloadBtn'); await page.waitForTimeout(200);
    const menu = await page.evaluate(() => { const r = document.getElementById('downloadMenu').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: window.innerWidth }; });
    ok('at 375px the open Export menu is inside the screen', menu.left >= 0 && menu.right <= menu.w, menu);
    await ctx.close();
  }

  // ---------------------------------------------------------------- the icons are there before the script is
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => { try { localStorage.setItem('emboss-settings', s); } catch {} }, SETTINGS());
    const page = await ctx.newPage();
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route('**/web/app.mjs*', async (route) => { await held; await route.continue(); });
    page.goto(`${BASE}/web/index.html`, { waitUntil: 'commit' }).catch(() => {});
    await page.waitForSelector('#settingsBtn', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(400);
    const early = await page.evaluate(() => {
      const use = document.querySelector('#settingsBtn use');
      const sym = document.getElementById('icon-settings');
      const box = document.querySelector('#settingsBtn svg').getBoundingClientRect();
      return { symbols: document.querySelectorAll('#emboss-icon-sprite symbol').length, hasGear: !!sym, hasUse: !!use, w: Math.round(box.width) };
    });
    // 4 symbols (was 5): Load's folder icon went with Load (Paul, 18 Oct 2026)
    ok('with the script still loading, the page already holds the symbols its markup uses and the gear has a size', early.symbols === 4 && early.hasGear && early.w > 0, early);
    release();
    await page.waitForFunction(() => document.querySelectorAll('#emboss-icon-sprite symbol').length > 20, null, { timeout: 30000 });
    await ctx.close();
  }

  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== Quick Mode menu bar [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
