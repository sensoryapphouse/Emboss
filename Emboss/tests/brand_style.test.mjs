// Feedback 30 Sep 2026, item 18: Paramveer's Paige brand pass on Translate (PaigeBraille/translate#10, merged 13 Sep) — "make these
// consistent with Emboss" (Paul, 2 Oct: yes). Emboss follows the same visual rules:
//  - the brand palette: body text #444444 (never black), Paige yellow #f5b800, the word highlight #fcedbf, Paige dark blue #0d2e80 for
//    blue text that is read, #e9f2fc for it on dark; white grounds, not a tinted gradient;
//  - no button is filled with colour (Translate has none; Paul, 17 Oct 2026 — this replaces --accent-fill, #1f6fd1, under white text);
//  - every colour Emboss's stylesheets use is one Translate's own stylesheet uses (Paul, 17 Oct 2026: "make the colour scheme of Emboss
//    exactly the same as that of Translate");
//  - no decorative drop shadows (inset lines and plain rings that mark a selection or focus stay); no hover "lift";
//  - no pill shapes: buttons 8px corners, chips and badges 4px, boxes and the explanation bar 16px;
//  - icons are Iconoir line icons that follow the text colour (web/icons.mjs), never emoji, which some phones draw as coloured pictures.
// What is NOT copied from #10: Tab wrapping around the whole page (screen-reader users expect Tab to leave the page), and #warn in
// 4.1:1 blue (it fails AA; Paramveer flags it himself).
// Feedback 10 Oct 2026, item 6 (Paul: "Menu bar should match on Translate/Emboss — I am happy with Translate's"): Quick Mode's buttons, menu bar,
// Download menu, warning boxes and icon sprite follow Translate's too — the last tests below. The hover TEXT stays --accent-text (12:1) where
// Translate's is --accent (4.1:1, below AA for read text), and Emboss keeps its own logo and name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const STYLE = read('web/style.css');
const QUICK = read('web/index.html');
const EDITOR = read('web/editor/index.html');
const EDITOR_JS = read('web/editor/editor.mjs');
const RENDER_JS = read('web/braille-render.mjs');
const APP_JS = read('web/app.mjs');
const TACTILE_JS = read('web/tactile-browser.mjs');
const PANES_JS = read('web/settings-panes.mjs');
const styleBlocks = (html) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const CSS = { 'style.css': STYLE, 'index.html': styleBlocks(QUICK) + '\n' + [...QUICK.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';\n'),
  'editor/index.html': styleBlocks(EDITOR) + '\n' + [...EDITOR.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';\n') };

// the custom properties a rule block sets (the first block whose selector matches `sel` exactly)
function tokens(css, sel) {
  const re = new RegExp(`(?:^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  assert.ok(m, `no ${sel} block`);
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim().toLowerCase()]));
}

test('the brand palette: light', () => {
  for (const [name, css] of [['style.css', STYLE], ['editor/index.html', styleBlocks(EDITOR)]]) {
    const t = tokens(css, ':root');
    assert.equal(t['--ink'], '#444444', `${name} --ink`);
    if (t['--accent-text']) assert.equal(t['--accent-text'], '#0d2e80', `${name} --accent-text`);
    if (t['--link']) assert.equal(t['--link'], '#fcedbf', `${name} --link`);
    if (t['--linkb']) assert.equal(t['--linkb'], '#f5b800', `${name} --linkb`);
    assert.equal(t['--bg'], '#ffffff', `${name} --bg`);
    for (const k of ['--bg-grad', '--pane-bg', '--panel', '--panel-head']) if (t[k]) assert.match(t[k], /^(#ffffff|#fff|var\(--bg\))$/, `${name} ${k} is white: ${t[k]}`);
  }
  const t = tokens(STYLE, ':root');
  assert.equal(t['--accent-text'], '#0d2e80');
  assert.equal(t['--link'], '#fcedbf');
  assert.equal(t['--linkb'], '#f5b800');
  // Changed from --accent-fill #1f6fd1 to none (Paul, 17 Oct 2026, "exactly the same as Translate"): Translate fills no button with colour.
  assert.equal(t['--accent-fill'], undefined, 'no colour fill for buttons, as Translate');
});

test('the brand palette: dark', () => {
  for (const [name, css] of [['style.css', STYLE], ['editor/index.html', styleBlocks(EDITOR)]]) {
    for (const sel of [':root.dark', ':root:not(.light)']) {
      const t = tokens(css, sel);
      assert.equal(t['--accent-text'], '#e9f2fc', `${name} ${sel} --accent-text`);
      // Translate's Focus Mode dark (its only dark mode): the pale brand blue for lines and rings, highlights kept light
      assert.equal(t['--accent'], '#e9f2fc', `${name} ${sel} --accent`);
      assert.equal(t['--link'], '#fcedbf', `${name} ${sel} --link`);
      assert.equal(t['--bg-grad'], '#0d1117', `${name} ${sel} --bg-grad: a plain ground, no gradient`);
    }
  }
});

// box-shadow values: allowed only when none, inset, or a plain ring (no offset, no blur)
function shadowLayers(v) {
  const out = []; let depth = 0, cur = '';
  for (const ch of v) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const decorative = (v) => {
  v = v.replace(/!important/, '').trim();
  if (/^(none|inherit|initial|unset)$/.test(v)) return false;
  return shadowLayers(v).some((layer) => !/\binset\b/.test(layer) && !/^0(px)?\s+0(px)?\s+0(px)?\s+[\d.]+px/.test(layer));
};

test('no decorative drop shadows (rings and inset lines stay)', () => {
  const bad = [];
  for (const [name, src] of [['style.css', STYLE], ['index.html', QUICK], ['editor/index.html', EDITOR], ['editor.mjs', EDITOR_JS], ['braille-render.mjs', RENDER_JS], ['app.mjs', APP_JS]]) {
    for (const m of src.matchAll(/box-shadow\s*:\s*([^;}"'`]+)/g)) if (decorative(m[1])) bad.push(`${name}: box-shadow:${m[1].trim()}`);
    for (const m of src.matchAll(/\.boxShadow\s*=\s*['"`]([^'"`]*)['"`]/g)) if (decorative(m[1])) bad.push(`${name}: boxShadow=${m[1]}`);
  }
  assert.deepEqual(bad, []);
});

test('no hover lift, no pill shapes', () => {
  const bad = [];
  for (const [name, css] of Object.entries(CSS)) {
    for (const m of css.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)) if (/translateY\(\s*-/.test(m[2])) bad.push(`${name}: ${m[1].trim()} lifts`);
    for (const m of css.matchAll(/border-radius\s*:\s*([^;}]*)/g)) if (/\b9{2,}px/.test(m[1])) bad.push(`${name}: border-radius:${m[1].trim()}`);
  }
  assert.deepEqual(bad, []);
});

test('dialogs: no browser border, 16px corners, the page colours', () => {
  for (const [name, css] of [['style.css', STYLE]]) {
    const m = css.match(/(?:^|\n)\s*dialog\s*\{([^}]*)\}/);
    assert.ok(m, `${name}: a rule for every <dialog>`);
    assert.match(m[1], /border\s*:\s*(none|0)/);
    assert.match(m[1], /border-radius\s*:\s*16px/);
    assert.match(m[1], /color\s*:\s*var\(--ink\)/);
  }
});

// Characters that some systems draw as coloured emoji pictures (Emoji_Presentation), plus the symbols Emboss used as icons
const EMOJI_ICON = /[\p{Emoji_Presentation}⚙⚠✕▼▶⏹⬇\u{1F5D1}\u{1F5A8}\u{1F5BC}\u{1F3F7}✍\u{1F5D2}]/u;
const markup = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');

test('no emoji or symbol-font icons in the pages, the slash menu, or the code that builds buttons', () => {
  for (const [name, html] of [['index.html', QUICK], ['editor/index.html', EDITOR]]) {
    const hits = [...markup(html).matchAll(new RegExp(EMOJI_ICON.source, 'gu'))].map((m) => m[0]);
    assert.deepEqual(hits, [], name);
  }
  const slashIcons = [...EDITOR_JS.matchAll(/icon: '([^']*)'/g)].map((m) => m[1]).filter((i) => EMOJI_ICON.test(i));
  assert.deepEqual(slashIcons, [], 'slash menu icons');
  // anywhere in the code that builds the interface, outside comments: labels, status messages, the style list, table layouts …
  for (const [name, src] of [['editor.mjs', EDITOR_JS], ['braille-render.mjs', RENDER_JS], ['app.mjs', APP_JS]]) {
    const lines = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*(\/\/|\*)/.test(l) && EMOJI_ICON.test(l));
    assert.deepEqual(lines.map(([n, l]) => `${n}: ${l.trim().slice(0, 100)}`), [], name);
  }
});

test('the interface strings carry no emoji icons (in every language)', () => {
  const dir = path.join(ROOT, 'web/locales');
  const bad = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const walk = (o, p) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v, `${p}${k}.`); else if (typeof v === 'string' && /^[\p{Emoji_Presentation}⚠⚙✕⬇]/u.test(v.trim())) bad.push(`${f} ${p}${k}`); } };
    walk(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), '');
  }
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} strings start with an emoji`);
});

test('every icon used is in web/icons.mjs, and Iconoir is credited', async () => {
  const { ICONS, iconSvg } = await import('../web/icons.mjs');
  const used = new Set();
  for (const src of [QUICK, EDITOR]) for (const m of src.matchAll(/href="#icon-([\w-]+)"/g)) used.add(m[1]);
  for (const src of [EDITOR_JS, RENDER_JS, APP_JS]) for (const m of src.matchAll(/icon(?:Svg|El)\('([\w-]+)'/g)) used.add(m[1]);
  for (const m of EDITOR_JS.matchAll(/icon: 'i:([\w-]+)'/g)) used.add(m[1]);
  assert.ok(used.size >= 10, `icons used: ${[...used].join(', ')}`);
  for (const name of used) assert.ok(ICONS[name], `icon "${name}" is not in icons.mjs`);
  assert.match(iconSvg('xmark'), /^<svg [^>]*class="icon"[^>]*aria-hidden="true"[^>]*>.*<\/svg>$/s);
  assert.match(iconSvg('xmark'), /stroke="currentColor"/);
  assert.ok(existsSync(path.join(ROOT, '../licences/Iconoir-MIT.txt')));
  assert.match(read('../licences/NOTICE-EMBOSS.md'), /Iconoir/);
  assert.match(read('web/sw.js'), /'\/web\/icons\.mjs'/, 'cached for offline use');
  assert.match(read('scripts/build-dist.mjs'), /'web\/icons\.mjs'/, 'copied into the build');
});

// ---------------------------------------------------------------------------------------------------------------------
// Tester feedback 10 Oct 2026, item 6 (Paul: "Menu bar should match on Translate/Emboss — I am happy with Translate's"): Quick Mode takes Translate's
// button vocabulary, its menu bar and its icon sprite, and none of Paige's identity (Emboss keeps its own logo and name). The browser checks are
// tests/test-quickmode-menubar.mjs; these are the rules held in the source, so a change that undoes them fails without a browser.
// ---------------------------------------------------------------------------------------------------------------------

test('Quick Mode: the inline icon sprite is icons.mjs\'s own, and icons.mjs completes it without repeating a symbol', async () => {
  const { ICONS, installIconSprite } = await import('../web/icons.mjs');
  const sprite = QUICK.match(/<svg id="emboss-icon-sprite"[^>]*>([\s\S]*?)<\/svg>/);
  assert.ok(sprite, 'an inline <svg id="emboss-icon-sprite"> at the top of the body');
  assert.ok(QUICK.indexOf('emboss-icon-sprite') < QUICK.indexOf('<header>'), 'before the header, so the icons are there at first paint');
  const symbols = [...sprite[1].matchAll(/<symbol id="icon-([\w-]+)" ([^>]*)>([\s\S]*?)<\/symbol>/g)];
  const used = new Set([...QUICK.matchAll(/href="#icon-([\w-]+)"/g)].map((m) => m[1]));
  assert.deepEqual(new Set(symbols.map((m) => m[1])), used, 'exactly the symbols the page\'s markup refers to');
  for (const [, name, attrs, body] of symbols) {
    assert.equal(body, ICONS[name], `${name}: icons.mjs's path data`);
    assert.match(attrs, /viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/);
  }
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body>${sprite[0]}<p>x</p></body>`);
  installIconSprite(dom.window.document);
  installIconSprite(dom.window.document);   // twice, as a module imported by two scripts might
  const ids = [...dom.window.document.querySelectorAll('[id^="icon-"]')].map((e) => e.id);
  assert.equal(dom.window.document.querySelectorAll('#emboss-icon-sprite').length, 1, 'one sprite');
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  assert.equal(ids.length, Object.keys(ICONS).length, 'every icon, in the one sprite');
  const bare = new JSDOM('<!doctype html><body><p>x</p></body>');
  installIconSprite(bare.window.document);
  assert.equal(bare.window.document.querySelectorAll('[id^="icon-"]').length, Object.keys(ICONS).length, 'a page with no sprite (the editor) still gets the whole set');
});

const quickMarkup = markup(QUICK);
const rule = (css, sel) => { const m = css.match(new RegExp(`(?:^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')); return m ? m[1] : null; };
const QM = 'body:not(.editor-page)';   // the scope of every Quick Mode vocabulary rule: the editor page has its own copy and is not changed

test('Quick Mode: every action is a pill or an icon button, with no fill of its own', () => {
  const buttons = [...quickMarkup.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  // Changed 17 Oct 2026 (Paul, feedback items 8b and 9b): Read, Emboss and the drop zone's Emboss button are gone from Quick Mode (Emboss is Export's
  // "Send to embosser" item); Load is new in the header.
  const own = ['advancedBtn', 'helpBtn', 'settingsBtn', 'chooseBtn', 'downloadBtn'];
  for (const id of own) {
    const tag = buttons.find((b) => b.includes(`id="${id}"`));
    assert.ok(tag, id);
    assert.match(tag, /class="[^"]*\b(pill-btn|icon-btn)\b/, `${id} is a pill-btn or an icon-btn`);
    assert.ok(!/style="/.test(tag), `${id} carries no inline style (it used to carry its own blue or green fill)`);
  }
  assert.ok(!/\badv-btn\b|\bicon-btn-lg\b|\btb-btn\b/.test(quickMarkup), 'the old header classes are gone');
  // (the Settings dialog is built by web/settings-panes.mjs since 17 Oct 2026, one source for both pages: its Done is looked for there)
  assert.match([...PANES_JS.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).find((b) => b.includes('value="close"') && b.includes('class="pill-btn"')), /data-i18n|class="pill-btn"/, 'Settings\' Done is a pill');
  assert.match(PANES_JS, /<button formnovalidate value="close" class="pill-btn" data-i18n="common\.done">/);
  const pill = rule(STYLE, `${QM} .pill-btn`);
  assert.ok(pill, 'a scoped .pill-btn rule');
  assert.match(pill, /border:\s*1px solid var\(--line\)/);
  assert.match(pill, /border-radius:\s*8px/);
  assert.match(pill, /background:\s*var\(--pill-bg\)/);
  assert.match(pill, /font-weight:\s*400/);
  assert.ok(!/accent-fill|#137a3b/.test(pill), 'not a blue or green fill');
  assert.ok(!/(^|[}\s])#chooseBtn\s*\{[^}]*background/m.test(STYLE), 'no blue fill rule left for Choose file');
  assert.match(rule(STYLE, `${QM} .pill-btn:hover`), /border-color:\s*var\(--accent\)/);
  assert.match(rule(STYLE, `${QM} .pill-btn:hover`), /color:\s*var\(--accent-text\)/, 'the hover TEXT is --accent-text (12:1), not Translate\'s --accent (4.1:1, below AA for read text)');
  const ring = STYLE.match(new RegExp(`${QM.replace(/[.()]/g, '\\$&')} \\.pill-btn:focus-visible,\\s*${QM.replace(/[.()]/g, '\\$&')} \\.icon-btn:focus-visible\\s*\\{([^}]*)\\}`));
  assert.ok(ring && /outline:\s*2px solid var\(--accent\)/.test(ring[1]) && /outline-offset:\s*2px/.test(ring[1]), 'a 2px accent focus ring two pixels out, on both');
  assert.ok(!/transition:\s*all/.test(pill), 'the transition names its properties, so the focus ring is not animated in');
});

test('Quick Mode: one pale-yellow look for every warning and notice, light and dark', () => {
  const t = tokens(STYLE, ':root');
  assert.equal(t['--warn-bg'], '#fcedbf');
  assert.equal(t['--warn-ink'], '#444444');
  for (const sel of [':root.dark', ':root:not(.light)']) assert.equal(tokens(STYLE, sel)['--warn-ink'], '#0d1117', `${sel}: dark ink on the same yellow (16:1)`);
  for (const sel of ['.warn-badge', '.export-warn-notice', '.status.warn']) {
    const r = rule(STYLE, sel);
    assert.ok(r, sel);
    assert.match(r, /background:\s*var\(--warn-bg\)/, `${sel} background`);
    assert.match(r, /color:\s*var\(--warn-ink\)/, `${sel} ink`);
    assert.ok(!/#3a2a06|#ffe8b3|#fde8e8|#9a2222|#8a5d00/.test(r), `${sel}: none of the old dark-brown, pink or amber`);
  }
  assert.match(rule(STYLE, '.export-warn-notice'), /border-radius:\s*6px/);
  assert.match(rule(STYLE, '.status.warn'), /border-radius:\s*6px/);
  // the ring on the badge and the notice's Dismiss is Quick Mode's only: the editor carries its own badge and notice, with its own focus style
  assert.match(STYLE, /body:not\(\.editor-page\) \.export-warn-notice button:focus-visible,\s*body:not\(\.editor-page\) \.warn-badge:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  assert.ok(!/(^|\n)\.warn-badge:focus-visible|(^|\n)\.export-warn-notice button:focus-visible,\s*\.warn-badge/.test(STYLE), 'no unscoped focus rule for the badge');
});

test('Quick Mode: the header is a named toolbar: Advanced Editor, Load, Export, Help, then the gear', async () => {
  // Changed 17 Oct 2026 (Paul, feedback item 9b): the header was Advanced Editor, Help, Settings, with a Read / Emboss / Download toolbar above the braille;
  // it is now Advanced Editor, Load, Export ▾, Help, Settings, and that second toolbar is gone (its functions moved into Export).
  const head = quickMarkup.match(/<div class="head-right" id="headRight"[^>]*>([\s\S]*?)\n      <\/div>\n    <\/div>/);
  assert.ok(head, 'a #headRight toolbar');
  assert.match(head[0], /role="toolbar"/);
  assert.match(head[0], /aria-label="[^"]+"/);
  assert.match(head[0], /data-i18n-aria="app\.header\.toolbar_aria"/);
  // no Load in Quick Mode's header (Paul, 18 Oct 2026: drag and drop, or Choose file)
  assert.deepEqual([...head[1].matchAll(/<button[^>]*id="(\w+)"/g)].map((m) => m[1]).filter((id) => !/Item$/.test(id)), ['advancedBtn', 'downloadBtn', 'helpBtn', 'settingsBtn'], 'Advanced Editor, Load, Export, Help, then the gear last (Translate: Help before Settings)');
  assert.ok(!/id="resultActions"|id="readBtn"|id="embossBtn"|id="dzEmbossBtn"|id="fileActions"/.test(quickMarkup), 'the Read / Emboss / Download row and the drop zone\'s Emboss are gone');
  assert.match(quickMarkup, /id="downloadEmbossItem"[^>]*>/, 'Send to embosser is an item of the Export menu');
  assert.match(quickMarkup.match(/<button[^>]*id="downloadEmbossItem"[^>]*>/)[0], /hardware-expert-only/, 'shown only once the hardware controls are revealed (a beta build keeps them off)');
  const en = JSON.parse(read('web/locales/en.json'));
  assert.ok(en.app.header.toolbar_aria, 'the name is in en.json (other languages fall back to it)');
  const help = quickMarkup.match(/<button[^>]*id="helpBtn"[^>]*>([^<]*)<\/button>/);
  assert.ok(help && help[1].trim() === 'Help', 'Help carries its own word');
  assert.ok(!/id="helpBtn"[^>]*aria-label/.test(quickMarkup), 'no aria-label that could disagree with the visible word');
  assert.match(APP_JS, /wireToolbar\(\$\('headRight'\)/);
  assert.ok(!/wireToolbar\(\$\('resultActions'\)/.test(APP_JS));
  assert.match(APP_JS, /e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey/, 'a key held with a modifier is left to the browser');
  assert.match(APP_JS, /direction === 'rtl'/, 'the arrows follow the screen in a right-to-left language');
  assert.match(APP_JS, /closeDownloadMenu\(true\)/, 'Escape and a chosen item put the focus back on the button');
  assert.ok(!/downloadBtn\.addEventListener\('click', \(e\) => \{\s*e\.stopPropagation/.test(APP_JS), 'the button no longer stops the click');
});

test('Quick Mode: Emboss keeps its own logo (the look was ported, not Paige\'s identity)', () => {
  assert.match(QUICK, /<img class="app-logo" src="\/web\/logo\.svg"/, 'its own logo');
  assert.ok(!/paige-icon/.test(QUICK + STYLE + APP_JS), 'not Paige\'s icon, which is Translate\'s');
});

// Paul, 17 Oct 2026: "make the colour scheme of Emboss exactly the same as that of Translate". Every colour value in Emboss's own
// stylesheets (style.css, the <style> blocks and style="" attributes of both pages) and in the tactile-graphics dialog, which builds
// its own styles, must be one that Translate's stylesheet itself uses (read from Translate/index.html now, so this follows Translate
// if its palette changes). Translate's comments are not its stylesheet: a colour it only mentions does not count.
test('every colour Emboss uses is one of Translate\'s', () => {
  const RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;
  const norm = (c) => { c = c.toLowerCase().replace(/\s+/g, ''); if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + [...c.slice(1)].map((x) => x + x).join(''); return c.replace(/,0\./g, ',.'); };
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const pageCss = (html) => styleBlocks(html) + '\n' + [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';\n');
  const TR_HTML = readFileSync(path.join(ROOT, '..', 'Translate', 'index.html'), 'utf8');
  const translate = new Set((strip(pageCss(TR_HTML)).match(RE) || []).map(norm));
  assert.ok(translate.has('#444444') && translate.has('#fcedbf') && translate.size > 20, 'Translate\'s palette was read');
  const sources = { 'style.css': STYLE, 'index.html': pageCss(QUICK), 'editor/index.html': pageCss(EDITOR), 'tactile-browser.mjs': read('web/tactile-browser.mjs'), 'settings-panes.mjs': read('web/settings-panes.mjs') };
  for (const [name, text] of Object.entries(sources)) {
    const off = [...new Set((strip(text).match(RE) || []).map(norm))].filter((c) => !translate.has(c));
    assert.deepEqual(off, [], `${name} uses colours Translate does not: ${off.join(' ')}`);
  }
});

// =====================================================================================================================
// 17 Oct 2026, Paul's decisions on the APH testers' feedback (items 1, 3 and 4): the editor's menu bar as Translate's, Iconoir icons everywhere (no emoji or
// symbols as icons, the tactile library dialog included), no dashed or dotted line anywhere, and the same blue line on all four sides of a box.
// =====================================================================================================================

const SYMBOL_ICONS = /[\p{Emoji_Presentation}⚙⚠✕▼▲▶⏹⬇▴▾↗←→⁂⇥⇤¶•“≡∑\u{1F5D1}\u{1F5A8}\u{1F5BC}\u{1F3F7}]/u;

test('the tactile library dialog and the Settings dialog draw their icons with Iconoir, not emoji or symbols (item 3)', () => {
  // tactile-browser.mjs builds its own markup: no emoji, no symbol used as an icon (the "×", "–", "·" and "…" in its words are not icons)
  const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  for (const [name, src] of [['tactile-browser.mjs', TACTILE_JS], ['settings-panes.mjs', PANES_JS]]) {
    const hits = code(src).map((l, i) => [i, l]).filter(([, l]) => SYMBOL_ICONS.test(l.replace(/\s→\s|&larr;|&rarr;/g, '')) || /&larr;|&rarr;/.test(l)).map(([, l]) => l.trim().slice(0, 100));
    assert.deepEqual(hits.filter((l) => !/data-i18n|<option|help|hint|—/.test(l)), [], `${name}: emoji or symbol icons`);
  }
  assert.match(TACTILE_JS, /import \{ iconSvg \} from '\/web\/icons\.mjs'/, 'the dialog uses icons.mjs');
  for (const n of ['media-image', 'xmark', 'prohibition', 'search', 'printer', 'page', 'nav-arrow-left', 'nav-arrow-right', 'ruler', 'flask', 'tools', 'leaf', 'graduation-cap', 'apple', 'globe', 'home']) assert.match(TACTILE_JS, new RegExp(`iconSvg\\('${n}'`), `the dialog draws ${n}`);
  const shadows = [...TACTILE_JS.matchAll(/box-shadow\s*:\s*([^;}"'`]+)/g)].filter((m) => decorative(m[1])).map((m) => m[1]);
  assert.deepEqual(shadows, [], 'no decorative shadow in the dialog either');
});

test('the slash menu, the style button and the Table of Contents box use Iconoir icons (item 3)', async () => {
  const { ICONS } = await import('../web/icons.mjs');
  const icons = [...EDITOR_JS.matchAll(/\{ (?:id|value): '[\w-]+'[^\n]*? icon: '([^']*)'/g)].map((m) => m[1]);
  assert.ok(icons.length > 25, `${icons.length} slash and style entries`);
  for (const i of icons) assert.ok(i.startsWith('i:') || /^[A-Za-z0-9/.=]+$/.test(i), `slash icon "${i}" is an Iconoir icon (i:NAME) or lettering such as H1, 1., B`);
  for (const i of icons.filter((x) => x.startsWith('i:'))) assert.ok(ICONS[i.slice(2)], `${i} is in icons.mjs`);
  for (const [label, want] of [['p', 'i:text'], ['bullet', 'i:list'], ['plain', 'i:align-left'], ['quote', 'i:quote'], ['code', 'i:code']]) assert.match(EDITOR_JS, new RegExp(`value: '${label}'[^\\n]*icon: '${want}'`), `${label} style`);
  for (const [id, want] of [['indent', 'arrow-right'], ['outdent', 'arrow-left'], ['continue', 'arrow-down-left'], ['math', 'sigma-function'], ['break', 'asterisk']]) assert.match(EDITOR_JS, new RegExp(`id: '${id}'[^\\n]*icon: 'i:${want}'`), `${id} command`);
  // the labels of the style list no longer start with the pilcrow, bullet, quote mark or ≡ that stood for an icon
  assert.ok(!/full: \(\) => `[¶•“≡]|full: \(\) => `<\/>/.test(EDITOR_JS), 'the style labels carry no symbol icon');
  assert.ok(!/ [▾▴]`/.test(EDITOR_JS), 'the contents box\'s Shrink / Expand carry no ▾ ▴');
  assert.ok(!/tick\.textContent = '✓'/.test(EDITOR_JS) && /tick\.append\(iconEl\('check'/.test(EDITOR_JS), 'the style list\'s selected tick is the Iconoir check, not a ✓');
  assert.ok(!/<span class="ri-note generated-line-note"[^>]*>ℹ/.test(EDITOR_JS), 'the note on a line Emboss adds carries the Iconoir info icon, not ℹ');
  assert.match(EDITOR_JS, /iconSvg\(isTocBoxCollapsed \? 'nav-arrow-down' : 'nav-arrow-up'/, 'nav-arrow icons for Shrink and Expand');
  assert.match(EDITOR, /id="styleBtnIcon"/, 'the style button has a place for the style\'s icon');
  assert.ok(!/<span class="style-btn-lbl" id="styleBtnLabel">¶/.test(EDITOR), 'the style button\'s label has no pilcrow');
  assert.ok(!/↗/.test(markup(EDITOR)), 'the outside links carry no ↗');
  assert.ok((markup(EDITOR).match(/icon-open-new-window/g) || []).length >= 3, 'the three outside links carry the Iconoir open-new-window icon');
  assert.ok(!/⚠/.test(EDITOR.match(/<script>[\s\S]*?<\/script>/)[0]), 'the load-error banner script uses the word "Error:", not ⚠');
  assert.match(EDITOR.match(/<script>[\s\S]*?<\/script>/)[0], /'Error: '/);
});

test('MathLive\'s own keyboard toggle is hidden and Emboss\'s button, with Iconoir\'s keypad icon, takes its place (item 3b)', () => {
  assert.match(STYLE, /math-field::part\(virtual-keyboard-toggle\)/, 'MathLive\'s toggle is hidden');
  assert.match(EDITOR_JS, /btnKb\.className = 'math-kb-btn'/);
  assert.match(EDITOR_JS, /iconEl\('dots-grid-3x3'/);
  assert.match(EDITOR_JS, /executeCommand\('toggleVirtualKeyboard'\)/, 'the same toggle MathLive\'s own button runs');
  assert.match(EDITOR_JS, /btnKb\.addEventListener\('mousedown', \(e\) => e\.preventDefault\(\)\)/, 'the equation keeps the focus');
});

test('no border or outline anywhere in Emboss is dashed or dotted (Paul, 17 Oct 2026, item 4)', () => {
  const sources = { 'style.css': STYLE, 'index.html': QUICK, 'editor/index.html': EDITOR };
  for (const f of ['editor.mjs', 'app.mjs', 'braille-render.mjs', 'tactile-browser.mjs', 'settings-panes.mjs', 'proofread.mjs', 'problem-report.mjs', 'export-formats.mjs']) sources[f] = read(`web/${f.startsWith('editor.mjs') ? 'editor/' : ''}${f}`);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bad = [];
  for (const [name, text] of Object.entries(sources)) {
    for (const m of strip(text).matchAll(/(?:border|outline)(?:-[a-z]+)*\s*:[^;}"'`]*\b(?:dashed|dotted)\b|(?:border|outline)(?:-[a-z]+)*-style\s*:\s*(?:dashed|dotted)\b/g)) bad.push(`${name}: ${m[0].trim()}`);
  }
  assert.deepEqual(bad, []);
  // and the specific rules Paul named are solid
  assert.match(rule(STYLE, '.dropzone'), /border:\s*1px solid var\(--line\)/);
  assert.match(rule(STYLE, '.dropzone.drag'), /border-color:\s*var\(--accent\)[\s\S]*background:\s*var\(--sel\)/);
  assert.match(EDITOR, /\.emboss-selected \{ outline: 2px solid var\(--accent/);
  assert.match(EDITOR, /\.doc-image-block \{[^}]*border:1px solid var\(--line\)/);
  assert.match(EDITOR, /#dropHint \{[^}]*border:2px solid var\(--accent\)/);
});

test('a box has the same blue line on all four sides, light and dark (Paul, 17 Oct 2026, item 4)', () => {
  for (const [name, css, pre] of [['style.css', STYLE, ''], ['editor/index.html', styleBlocks(EDITOR), '\\.editor ']]) {
    const m = css.match(new RegExp(`${pre}\\.emboss-sidebar-card,\\s*${pre}aside\\.bana-style-sidebar,\\s*${pre}\\[data-bana-style="sidebar"\\]\\s*\\{([^}]*)\\}`));
    assert.ok(m, `${name}: the box rule`);
    assert.match(m[1], /border:\s*2\.5px solid var\(--accent\)/, `${name}: one border, the accent blue`);
    assert.ok(!/border-(left|top|bottom|right)\s*:/.test(m[1]), `${name}: no side of its own`);
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const darks = [...bare.matchAll(/:root[^{]*\.(?:emboss-sidebar-card|bana-style-sidebar)[^{]*\{([^}]*)\}|\[data-bana-style="sidebar"\]\s*\{([^}]*)\}/g)].map((x) => x[1] || x[2]).filter((b) => /border-color/.test(b || '') && !/^\s*border:/m.test(b));
    for (const d of darks) assert.ok(/border-color:\s*var\(--accent\)/.test(d) && !/border-(left|top|bottom)-color/.test(d) && !/border-color:\s*(#30363d|var\(--line\))/.test(d), `${name}: a dark rule keeps the one accent line: ${d.trim().slice(0, 100)}`);
  }
});

test('the editor\'s menu bar is Translate\'s: Clear in red on the right, a Help button, Export, "Text" and "Braille" in sentence case (Paul, 17 Oct 2026, item 1)', () => {
  const head = EDITOR.slice(EDITOR.indexOf('<header>'), EDITOR.indexOf('</header>'));
  const left = head.slice(head.indexOf('head-col-left'), head.indexOf('head-col-center'));
  const right = head.slice(head.indexOf('head-col-right'));
  assert.ok(!/id="btnClear"/.test(left), 'Clear is not with the document actions on the left');
  assert.match(right, /id="btnClear" class="pill-btn danger"/, 'Clear is in the right-hand group, a danger pill');
  const order = [...right.matchAll(/<button[^>]*id="(\w+)"/g)].map((m) => m[1]).filter((id) => !/Item$/.test(id));
  assert.deepEqual(order.filter((id) => ['btnClear', 'helpBtn', 'embossBtn', 'downloadBtn', 'settingsBtn'].includes(id)), ['btnClear', 'helpBtn', 'embossBtn', 'downloadBtn', 'settingsBtn'], 'DOM order is the visual order: Clear, Help, (Emboss), Export, Settings');
  assert.match(right, /<button[^>]*id="helpBtn"[^>]*class="pill-btn"[^>]*>Help<\/button>/, 'Help is a text pill, not a "?"');
  assert.ok(!/id="helpBtn" class="icon-btn"/.test(head));
  assert.match(right, /data-i18n="toolbar\.export">Export</, 'the download menu is Export');
  assert.ok(!/data-i18n="toolbar\.braille">Braille<\/span> <svg class="icon icon-caret/.test(right), 'no "Braille ▾" menu');
  // the look: Translate's pill (regular weight), its red Clear, its menu metrics, sentence-case pane titles
  const css = styleBlocks(EDITOR);
  assert.match(css, /\.pill-btn \{ height:34px;[^}]*font-weight:400;/, 'the editor\'s pill is Translate\'s: 34px, regular weight');
  assert.match(rule(css, '.pill-btn.danger'), /color:\s*var\(--danger\)[\s\S]*border-color:\s*var\(--danger-line\)/);
  assert.match(rule(css, '.pill-btn.danger:hover'), /background:\s*var\(--danger-wash\)/);
  assert.match(rule(css, '.menu-dropdown'), /border-radius:\s*10px[\s\S]*padding:\s*4px[\s\S]*min-width:\s*220px/);
  assert.match(rule(css, '.pane-label'), /text-transform:\s*none/);
  assert.match(rule(css, '.pane-label'), /font-size:\s*\.8rem[\s\S]*font-weight:\s*600/);
  assert.match(css, /\.tb-btn \{ height:34px;[^}]*border-radius:8px;/, 'the text tools are Translate\'s 34px, 8px-cornered buttons');
  const en = JSON.parse(read('web/locales/en.json'));
  assert.equal(en.toolbar.export, 'Export');
});

// 18 Oct 2026 (Paul: "Click on a word … doesn't highlight anymore - or at least I can't see it"): with every colour Translate's, the word
// clicked and its line were both --link, so the word could not be seen. The word (print and braille cells) and its line must differ.
test('the word clicked stands out from its highlighted line, in the print and the braille', () => {
  const editorCss = styleBlocks(EDITOR) + '\n' + STYLE;
  const bg = (sel) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*?background:\\s*([^;}]+)').exec(editorCss); return m ? m[1].trim() : null; };
  const word = bg('::highlight(link-word)'), cells = bg('.braille .bcell.cell-hl'), line = bg('.print-linked'), rows = bg('.braille .brl-row.brl-linked');
  assert.ok(word && line && cells && rows, JSON.stringify({ word, line, cells, rows }));
  assert.notEqual(word, line, 'the print word and its paragraph');
  assert.notEqual(cells, rows, 'the braille cells and their line');
});
