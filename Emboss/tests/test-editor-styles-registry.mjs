// G1 — the slash menu and the style dropdown are built from one registry (BLOCK_STYLES in
// editor.mjs), the tactile-graphics / graph-plot slash commands are hidden behind the
// Ctrl/Cmd+Shift+\ toggle, and that toggle is remembered across reloads.
// Section 7: the "Transcriber tools" setting (24 Sep 2026) -- off by default, it hides the transcriber page styles,
// the dialog controls tagged 'transcriber' in format/field-registry.mjs and the document options, never the braille,
// and the plain notice about unfamiliar symbols offers a one-line explanation.
//
// Real-browser test (the editor module cannot be imported under Node). Needs the dev server:
//   node Emboss/scripts/serve.mjs &   then   node Emboss/tests/test-editor-styles-registry.mjs [--show]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').

import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);   // A63: a port argument, for agents on their own dev server

console.log('--- Running G1: style registry / slash menu / expert toggle tests ---');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`); }
}

const URL = `http://localhost:${PORT}/web/editor/index.html`;
const browser = await launchBrowser({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
// Seed the settings only the first time, so what the page itself saves (expertHardware)
// survives the reloads below.
await context.addInitScript(() => {
  try {
    if (!localStorage.getItem('emboss-settings')) {
      localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' }));
    }
  } catch {}
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });

async function openEditor() {
  await page.goto(URL, { waitUntil: 'load' });
  const t0 = Date.now();
  while (await page.evaluate(() => typeof window.modelToLexical !== 'function' || typeof window.exportCurrentDocumentXml !== 'function')) {
    if (Date.now() - t0 > 20000) throw new Error('editor globals did not appear');
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.waitForFunction(() => document.querySelectorAll('#blockStyle option').length > 5);
  // A89 (WebKit and Firefox are slower to start than Chrome): the app seeds its demo document once its engine is loaded, a moment
  // after window.modelToLexical exists; a document loaded before that is overwritten by the demo, and the "/" below then lands in
  // the demo instead of the empty paragraph. Wait for the demo ("Chapter One") before loading anything.
  // A reload part-way through: the editor backs the document up within seconds of a change (A89 step 3, Paul 2 Oct), so on the
  // reload it rightly offers "Recover unsaved work?" — Discard it, as a person would for this throwaway document; the demo then loads.
  const t1 = Date.now();
  while (Date.now() - t1 < 30000) {
    const st = await page.evaluate(() => ({ offer: !!document.querySelector('#autosaveRecoverDialog[open]'), demo: document.getElementById('editor').innerText.includes('Chapter One') }));
    if (st.demo) break;
    if (st.offer) await page.click('#autosaveDiscardBtn');
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => document.getElementById('editor').innerText.includes('Chapter One'), null, { timeout: 30000 });
}

// The slash ids the menu offers right now ("/" typed into an empty paragraph).
async function slashIds() {
  await page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: '' }] }); });
  await page.locator('#editor p, #editor [contenteditable] p').first().click().catch(async () => { await page.locator('#editor').click(); });
  await page.keyboard.type('/');
  await page.waitForSelector('#slashList .slash-item', { timeout: 5000 });
  const ids = await page.$$eval('#slashList .slash-item', (els) => els.map((e) => e.id.replace('slash-opt-', '')));
  const titles = await page.$$eval('#slashList .slash-title', (els) => els.map((e) => e.textContent));
  await page.keyboard.press('Escape');
  // Lexical's Escape blurs the editor, so the Backspace this used to press to remove the "/" fell on <body> -- harmless in Chrome,
  // but WebKit takes Backspace outside a text field as "Back" and left the page (A89). Empty the paragraph directly instead.
  await page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: '' }] }); });
  return { ids, titles };
}
const dropdown = () => page.$$eval('#blockStyle option', (os) => os.map((o) => ({ value: o.value, text: o.textContent, hidden: o.hidden })));

try {
  await openEditor();
  const opts = await dropdown();
  // Options hidden by the "Transcriber tools" setting (off by default: the Transcriber's Notes / Special Symbols page
  // styles, 24 Sep 2026) are not offered, in the dropdown or the slash menu; section 7 checks them with the setting on.
  const optValues = opts.filter((o) => !o.hidden).map((o) => o.value);
  console.log('  dropdown:', optValues.join(', '));

  // ---- 1. both menus list the same styles ----
  const off = await slashIds();
  console.log('  slash (toggle off):', off.ids.join(', '));
  // slash ids that stand for a dropdown value
  const SLASH_TO_VALUE = { ul: 'bullet', ol: 'number', table: 'table-spatial', listedtable: 'table-listed' };
  const NON_STYLE = new Set(['slash', 'bold', 'italic', 'underline', 'indent', 'outdent', 'matrix', 'math', 'formula', 'plot', 'graphic', 'break', 'page']);
  const slashStyleValues = off.ids.filter((id) => !NON_STYLE.has(id)).map((id) => SLASH_TO_VALUE[id] || id);
  ok('every dropdown style is in the slash menu', optValues.every((v) => slashStyleValues.includes(v)), optValues.filter((v) => !slashStyleValues.includes(v)));
  ok('every slash style is in the dropdown', slashStyleValues.every((v) => optValues.includes(v)), slashStyleValues.filter((v) => !optValues.includes(v)));
  ok('no duplicate options in the dropdown', new Set(optValues).size === optValues.length);
  ok('no duplicate ids in the slash menu', new Set(off.ids).size === off.ids.length);

  // ---- 2. Index Entry, Plain List, Attribution offered; Computer Code not (no support) ----
  // Since 26 Sep (Paul) these are transcriber styles: present in the dropdown (hidden while Transcriber tools is off)
  // and out of the slash menu until the setting is on (section 7 turns it on).
  for (const v of ['index', 'plain', 'attribution']) {
    // Changed 30 Sep 2026 (Paul: Safari's dropdown lists hidden options): left out of the dropdown while the setting is
    // off, rather than present but hidden; section 5 uses them with the setting on.
    ok(`"${v}" is not in the dropdown while Transcriber tools is off`, !opts.some((o) => o.value === v));
    ok(`"${v}" is not offered in the slash menu while Transcriber tools is off`, !off.ids.includes(v));
  }
  ok('no separate Byline style in the dropdown', !optValues.includes('byline') && !opts.some((o) => /byline/i.test(o.text)), opts.map((o) => o.text));
  ok('no separate Byline style in the slash menu', !off.ids.includes('byline') && !off.titles.some((x) => /byline/i.test(x)), off.titles);
  ok('Computer Code is not offered (the editor has no code block)', !off.ids.includes('code') && !optValues.includes('code'));

  // ---- 3. tactile graphics / plot hidden until the toggle is on; maths inserts stay ----
  ok('toggle off: Tactile Graphic is hidden', !off.ids.includes('graphic'));
  ok('toggle off: Plot Tactile Graph is hidden', !off.ids.includes('plot'));
  for (const id of ['math', 'matrix', 'formula']) ok(`toggle off: maths insert "${id}" is still visible`, off.ids.includes(id));
  ok('toggle off: body has no expert-hardware class', !(await page.evaluate(() => document.body.classList.contains('expert-hardware'))));

  await page.keyboard.press('Control+Shift+Backslash');
  ok('Ctrl+Shift+\\ turns the expert class on', await page.evaluate(() => document.body.classList.contains('expert-hardware')));
  const on = await slashIds();
  ok('toggle on: Tactile Graphic is offered', on.ids.includes('graphic'), on.ids);
  ok('toggle on: Plot Tactile Graph is offered', on.ids.includes('plot'), on.ids);
  for (const id of ['math', 'matrix', 'formula']) ok(`toggle on: maths insert "${id}" is offered`, on.ids.includes(id));
  ok('toggle on adds exactly graphic + plot', on.ids.length === off.ids.length + 2, { off: off.ids.length, on: on.ids.length });

  // ---- 4. the toggle is remembered across a reload ----
  ok('the toggle is saved in settings (expertHardware)', await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings') || '{}').expertHardware === true));
  await openEditor();
  ok('after a reload the expert class is still on', await page.evaluate(() => document.body.classList.contains('expert-hardware')));
  const onAfterReload = await slashIds();
  ok('after a reload Tactile Graphic / Plot are still offered', onAfterReload.ids.includes('graphic') && onAfterReload.ids.includes('plot'), onAfterReload.ids);

  await page.keyboard.press('Control+Shift+Backslash');
  ok('toggling off again removes the class', !(await page.evaluate(() => document.body.classList.contains('expert-hardware'))));
  ok('toggling off is saved', await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings') || '{}').expertHardware === false));
  await openEditor();
  ok('after a reload the toggle is still off', !(await page.evaluate(() => document.body.classList.contains('expert-hardware'))));
  const offAfterReload = await slashIds();
  ok('after a reload with the toggle off, Tactile Graphic / Plot are hidden', !offAfterReload.ids.includes('graphic') && !offAfterReload.ids.includes('plot'), offAfterReload.ids);

  // ---- 5. the styles really apply and save (Attribution -> <byline>, Plain, Index) ----
  const setTools = async (on) => {
    await page.evaluate(() => document.getElementById('settingsBtn').click());
    await page.waitForSelector('#settingsDialog[open]');
    const isOn = await page.evaluate(() => document.getElementById('set-transcriberTools').checked);
    if (isOn !== on) await page.evaluate(() => document.getElementById('set-transcriberTools').click());
    await page.evaluate(() => document.getElementById('settingsDialog').close());
    await new Promise((r) => setTimeout(r, 200));
  };
  // These are transcriber styles: since 30 Sep they are not in the dropdown at all while Transcriber tools is off
  // (Safari lists hidden options), so the setting is on for this section, as it would be for a user choosing them.
  await setTools(true);
  async function applyAndSave(value, text) {
    await page.evaluate((tx) => { window.modelToLexical({ blocks: [{ type: 'para', text: tx }] }); }, text);
    await new Promise((r) => setTimeout(r, 300));
    // Put the caret at the end of the paragraph through Lexical itself (a mouse click on the
    // text sometimes lands the selection on the root, which is a test-driving quirk, not the
    // feature under test), then pick the style from the dropdown like a user would.
    await page.evaluate(() => {
      window.editor.update(() => { window.editor.getEditorState()._nodeMap.get('root').getFirstChild().selectEnd(); });
      window.editor.focus();
    });
    await page.selectOption('#blockStyle', value);
    await new Promise((r) => setTimeout(r, 200));
    return page.evaluate(() => window.exportCurrentDocumentXml());
  }
  const attrXml = await applyAndSave('attribution', 'Jane Austen');
  ok('Attribution saves as <byline>', /<byline>Jane Austen<\/byline>/.test(attrXml), attrXml.match(/<byline[^]*?<\/byline>|<p>Jane[^]*?<\/p>/)?.[0]);
  const plainXml = await applyAndSave('plain', 'Apples');
  ok('Plain List saves as <list type="pl"> (not an index, not a bullet list)', /<list type="pl">\s*<li>Apples<\/li>/.test(plainXml) && !/bai-index/.test(plainXml), plainXml.match(/<list[^]*?<\/list>/)?.[0]);
  const indexXml = await applyAndSave('index', 'Apples, 12');
  ok('Index Entry saves as <list type="pl" class="bai-index">', /<list type="pl" class="bai-index">/.test(indexXml), indexXml.match(/<list[^]*?<\/list>/)?.[0]);
  // and the slash command applies the same style — Attribution is a transcriber style since 26 Sep (Paul), so the
  // setting is switched on for this step and off again afterwards (section 7 expects it off).
  await setTools(true);
  await page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: '' }] }); });
  await page.locator('#editor').click();
  await page.keyboard.type('/attribution');
  await page.waitForSelector('#slashList .slash-item');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.type('Mary Shelley');
  const slashAttrXml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('/attribution applies Attribution (saves as <byline>)', /<byline>Mary Shelley<\/byline>/.test(slashAttrXml), slashAttrXml.match(/<byline[^]*?<\/byline>|<p>[^]*?<\/p>/)?.[0]);
  await setTools(false);

  // ---- 6. localised labels re-apply on a language change without breaking the dropdown ----
  const before = (await dropdown()).length;
  await page.evaluate(async () => { if (window.setLocale) await window.setLocale('fr'); });
  await new Promise((r) => setTimeout(r, 400));
  const after = await dropdown();
  ok('a language change keeps every dropdown option', after.length === before && after.every((o) => o.text.trim().length > 0), after.length);
  await page.evaluate(async () => { if (window.setLocale) await window.setLocale('en'); });

  // ---- 7. "Transcriber tools" (Paul's decision 24 Sep 2026, docs/transcriber-tools-setting.md) ----
  {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const load = async (blocks) => { await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks); await wait(300); };
    const shown = (id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && el.getClientRects().length > 0; }, id);
    // caret at the end of top-level block `i`, then the dialog (as test-editor-save-fidelity.mjs drives it)
    const openFmtAt = async (i) => {
      await page.evaluate((idx) => { window.editor.update(() => { let n = window.editor.getEditorState()._nodeMap.get('root').getChildren()[idx]; while (n.getLastChild && n.getLastChild()) n = n.getLastChild(); n.selectEnd(); }); window.editor.focus(); }, i);
      await wait(150);
      await page.keyboard.press('Control+Alt+KeyB');
      await page.waitForSelector('#brailleFmtDialog[open]', { timeout: 3000 }).catch(() => {});
    };
    const closeFmt = () => page.evaluate(() => { const d = document.getElementById('brailleFmtDialog'); if (d.open) d.close(); });
    ok('transcriber tools: off by default (no body class, not in settings)', !(await page.evaluate(() => document.body.classList.contains('transcriber-tools'))) && !(await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings') || '{}').transcriberTools)));
    // Paul, 26 Sep 2026 (supersedes 24 Sep's "only the two page styles"): with the setting off the dropdown offers only
    // the everyday styles — body text, headings, bulleted and numbered lists, tables — and the slash menu likewise.
    const EVERYDAY = ['bullet', 'h1', 'h2', 'h3', 'number', 'p', 'table-spatial'];
    // caret in an ordinary paragraph (in a block with a transcriber style, that style stays listed — checked below)
    await load([{ type: 'para', text: 'An ordinary paragraph.' }]);
    await page.evaluate(() => { window.editor.update(() => { window.editor.getEditorState()._nodeMap.get('root').getChildren()[0].selectEnd(); }); window.editor.focus(); });
    await wait(250);
    const shownOpts = (await dropdown()).filter((o) => !o.hidden).map((o) => o.value).sort();
    ok('transcriber tools off: the dropdown offers only the everyday styles', JSON.stringify(shownOpts) === JSON.stringify(EVERYDAY), shownOpts);
    // Changed 30 Sep 2026 (Paul: Safari's dropdown still listed them): the other styles are now taken out of the select
    // rather than marked hidden, since Safari ignores `hidden` on an option. Was "hidden, not removed".
    const listedOpts = (await dropdown()).map((o) => o.value);
    ok('transcriber tools off: the other styles are left out of the dropdown (Safari lists hidden options)', !['sidebar', 'poem', 'tnpage', 'sympage', 'titlepage', 'quote', 'table-listed', 'plain'].some((v) => listedOpts.includes(v)), listedOpts);
    ok('transcriber tools off: /tnpage, /sympage, /sidebar, /poem are not in the slash menu', !['tnpage', 'sympage', 'titlepage', 'sidebar', 'poem', 'dialogue', 'listedtable'].some((id) => off.ids.includes(id)), off.ids);
    ok('transcriber tools off: /h1, /ul, /ol, /table are in the slash menu', ['h1', 'ul', 'ol', 'table'].every((id) => off.ids.includes(id)), off.ids);
    ok('transcriber tools off: Insert has no "Sidebar Box"', !(await page.evaluate(() => { const b = document.getElementById('btnSidebar'); return !!b && getComputedStyle(b).display !== 'none'; })));
    // A block that already has a transcriber style: the dropdown shows it while the caret is there, and it can be changed.
    await load([{ type: 'para', text: 'Plain paragraph.' }, { type: 'poem', lines: ['A line of verse'] }]);
    await page.evaluate(() => { window.editor.update(() => { let n = window.editor.getEditorState()._nodeMap.get('root').getChildren()[1]; while (n.getLastChild && n.getLastChild()) n = n.getLastChild(); n.selectEnd(); }); window.editor.focus(); });
    await wait(250);
    const inPoem = await page.evaluate(() => { const s = document.getElementById('blockStyle'); const o = s.selectedOptions[0]; return { value: s.value, hidden: o ? o.hidden : null }; });
    ok('a poem block shows "Poetry / Verse" in the dropdown while the caret is in it', inPoem.value === 'poem' && inPoem.hidden === false, inPoem);
    await page.selectOption('#blockStyle', 'p');
    await wait(250);
    const changed = await page.evaluate(() => ({ value: document.getElementById('blockStyle').value, poemListed: [...document.getElementById('blockStyle').options].some((o) => o.value === 'poem') }));
    ok('the user can change it to an everyday style, after which the poem style leaves the dropdown again', changed.value === 'p' && changed.poemListed === false, changed);
    // dialog: everyday heading control shown, formal-book ones hidden
    // Paul, 25 Sep 2026: Layout (the Braille formatting dialog) is itself a transcriber tool — with the setting off the
    // button is hidden and Ctrl/Cmd+Alt+B does not open the dialog.
    await load([{ type: 'heading', level: 2, text: 'Plants' }, { type: 'para', text: 'Body.' }]);
    ok('transcriber tools off: the Layout button is hidden', !(await shown('btnBrailleFmt')));
    await openFmtAt(0);
    ok('transcriber tools off: Ctrl/Cmd+Alt+B does not open the Braille formatting dialog', !(await page.evaluate(() => document.getElementById('brailleFmtDialog').open)));
    await closeFmt();
    // a document that already carries a transcriber field keeps it through the save
    await load([{ type: 'heading', level: 2, text: 'Boxed', accompaniesBox: true }, { type: 'para', text: 'Body.' }]);
    await wait(300);
    ok('transcriber tools off: a hidden field already in the document survives and saves', /bana-accompanies-box/.test(await page.evaluate(() => window.exportCurrentDocumentXml())));
    // a document with a notes page shows and saves it; the Notes… button (a transcriber tool) stays hidden
    await load([{ type: 'tnpage', entries: [{ text: 'The atlas is omitted.' }] }, { type: 'heading', level: 1, text: 'Chapter' }]);
    ok('transcriber tools off: an existing Transcriber\'s Notes page still shows', await page.evaluate(() => !!document.querySelector('#editor .emboss-tnpage-card')));
    ok('transcriber tools off: ... and still saves', /bana-transcriber-notes/.test(await page.evaluate(() => window.exportCurrentDocumentXml())));
    ok('transcriber tools off: the Notes… button is hidden', await page.evaluate(() => document.getElementById('btnTnSuggest').hidden));
    const brfOff = await page.evaluate(() => window.lastBrf);
    // plain notice: a document with a symbol a reader may not know
    await load([{ type: 'heading', level: 1, text: 'Fruit' }, { type: 'list', items: [{ text: 'Apples', bullet: 'triangle' }, { text: 'Pears', bullet: 'triangle' }] }]);
    ok('symbol notice: shown for a triangle bullet while Transcriber tools is off', await page.evaluate(() => !document.getElementById('symbolNoticeBanner').hidden && /▲/.test(document.getElementById('symbolNoticeText').textContent)));
    await page.click('#symbolNoticeAdd');
    await wait(400);
    const firstParas = await page.evaluate(() => window.lastModel.blocks.slice(0, 2).map((b) => `${b.type}:${b.text || ''}`));
    ok('symbol notice: "Add a line" inserts one ordinary paragraph after the title', firstParas[1] === 'para:Symbols used: ▲ triangle.'   /* KD round 2 Q7b: shape names without "bullet" */, firstParas);
    ok('symbol notice: hidden after adding the line', await page.evaluate(() => document.getElementById('symbolNoticeBanner').hidden));
    // turn the setting on from Settings
    await load([{ type: 'tnpage', entries: [{ text: 'The atlas is omitted.' }] }, { type: 'heading', level: 1, text: 'Chapter' }]);
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    await page.click('.tab-btn[data-tab="tab-document"]');
    ok('settings: Transcriber tools checkbox is labelled and explained', await page.evaluate(() => { const c = document.getElementById('set-transcriberTools'); return !!c && !c.checked && /Transcriber tools/.test(document.querySelector('label[for="set-transcriberTools"]').textContent) && /formal braille books/.test(document.getElementById('set-transcriberToolsHelp').textContent); }));
    ok('settings: with it off, the document options group is hidden', !(await shown('docOptionsGroup')));
    // Addendum (Paul, 24 Sep 2026): title page (Tactile Volume Covers), running head (the
    // registry's Running head key words, checked above via docOptionsGroup) and volume-splitting
    // (Volume Split Interval) are transcriber-only too -- hidden with the rest, never removed.
    ok('settings: with it off, Volume Split Interval is hidden', !(await shown('set-volumePages')));
    ok('settings: with it off, Tactile Volume Covers is hidden', !(await shown('set-includeCovers')));
    await page.click('#set-transcriberTools');
    await wait(200);
    ok('settings: turning it on shows the document options group', await shown('docOptionsGroup'));
    ok('settings: turning it on shows Volume Split Interval', await shown('set-volumePages'));
    ok('settings: turning it on shows Tactile Volume Covers', await shown('set-includeCovers'));
    ok('settings: the choice is saved (transcriberTools)', await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings') || '{}').transcriberTools === true));
    // F9 E2a (PAUL'S DECISION, 9 Oct 2026): the Title field follows Transcriber tools, and with the field shown the document's title is added
    // to the braille (hidden: it is not). So turning the tools on would change the braille by the title; this check is about the tools
    // themselves changing nothing, so the Title field is kept hidden (its own setting, unticked) while they are on.
    await page.evaluate(() => { const b = document.getElementById('set-showTitleField'); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.evaluate(() => document.getElementById('settingsDialog').close());
    await page.evaluate(async () => { await window.render(); });
    ok('transcriber tools on: the braille is unchanged', (await page.evaluate(() => window.lastBrf)) === brfOff);
    ok('transcriber tools on: the Notes… button is shown for the page', await page.evaluate(() => !document.getElementById('btnTnSuggest').hidden));
    ok('transcriber tools on: the page styles are offered in the dropdown', (await dropdown()).filter((o) => o.hidden).length === 0);
    const onIds = await slashIds();
    ok('transcriber tools on: /tnpage and /sympage are in the slash menu', onIds.ids.includes('tnpage') && onIds.ids.includes('sympage'), onIds.ids);
    await load([{ type: 'heading', level: 2, text: 'Plants' }, { type: 'para', text: 'Body.' }]);
    await openFmtAt(0);
    ok('transcriber tools on: heading dialog shows every heading and font control', (await shown('fmtAccompaniesBox')) && (await shown('fmtEntryWord')) && (await shown('fmtIgnoreFont')));
    await closeFmt();
    await load([{ type: 'heading', level: 1, text: 'Fruit' }, { type: 'list', items: [{ text: 'Apples', bullet: 'triangle' }] }]);
    ok('symbol notice: not shown while Transcriber tools is on', await page.evaluate(() => document.getElementById('symbolNoticeBanner').hidden));
    await openEditor();
    ok('after a reload Transcriber tools is still on', await page.evaluate(() => document.body.classList.contains('transcriber-tools')));
  }

  ok('no console errors or page errors', consoleErrors.length === 0, consoleErrors);
} finally {
  await browser.close();
}

console.log(`\n=== G1 style registry / slash menu / expert toggle [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) { console.error('Failures:', failures); process.exit(1); }
console.log('All G1 checks passed.');
