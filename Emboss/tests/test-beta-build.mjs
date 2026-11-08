// ONE EMBOSS (Paul, 4 Nov 2026: EMBOSS-TASKS.md section P, "One Emboss — bringing Plus into the beta"). This file used to test the beta lock (feedback 30 Sep 2026,
// item 15: a page marked <meta name="emboss-beta"> hid Transcriber tools and the hardware controls unless a link had ?tools=1). There is one build now, so it tests that:
//   - a page marked emboss-beta or emboss-plus (the deploy scripts still write the marker) behaves exactly like an unmarked one;
//   - everyone starts in everyday braille mode: a first visit saves Transcriber tools OFF, asks no question, and a new user's Settings are Template and User Interface;
//   - ?tools=1 (links out with testers) turns Transcriber tools on and keeps them on, ?tools=0 turns them off;
//   - Settings > User Interface > "Show transcriber tools" reveals the Advanced Production tab, the transcriber settings and the tactile graphics, and hides them again;
//   - writing to devices is put aside: no Emboss button, no Embosser & Hardware tab, Ctrl/Cmd+Shift+\ does nothing;
//   - "Made for" (Paper / Monarch / DotPad, a template setting): Monarch is 32 x 10 and DotPad 20 x 10, their emulator tab shows beside the braille with Transcriber tools OFF;
//   - the embosser model shows for everyone (Transcriber tools off too; Paul, 4 Nov 2026) under Made for: Paper and no longer sets the page size; List Format and Table Layout show for everyone;
//   - "Made for", the embosser model and interpoint / single-sided are saved with a template, the exported template file and the saved document, and come back.
// The window.EMBOSS_BETA / EMBOSS_PLUS globals and the markers are simulated here only to show the pages ignore them.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-beta-build.mjs [port]      (EMBOSS_ENGINE=webkit for Safari's engine)
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { readFileSync } from 'node:fs';
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const browser = await launchBrowser();
// marker: '' | 'beta' | 'plus' - the old build markers, simulated (window global and <meta>); settings: saved in this browser (null = a first visit)
const open = async (marker, settings) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(({ marker, settings }) => {
    if (marker === 'beta') window.EMBOSS_BETA = true;
    if (marker === 'plus') window.EMBOSS_PLUS = true;
    if (marker) {
      const add = () => { if (document.head && !document.querySelector('meta[name="emboss-' + marker + '"]')) { const m = document.createElement('meta'); m.name = 'emboss-' + marker; m.content = '1'; document.head.appendChild(m); } };
      new MutationObserver(add).observe(document, { childList: true, subtree: true }); add();
    }
    try { if (!sessionStorage.getItem('ob')) { sessionStorage.setItem('ob', '1'); if (settings) localStorage.setItem('emboss-settings', JSON.stringify(settings)); else localStorage.removeItem('emboss-settings'); } } catch {}
  }, { marker, settings });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, errors };
};
const EDITOR = '/web/editor/index.html';
const QUICK = '/web/index.html';
const goEditor = async (page, q = '') => { await page.goto(BASE + EDITOR + q, { waitUntil: 'load' }); await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 30000 }); await page.waitForTimeout(1200); };
const goQuick = async (page, q = '') => { await page.goto(BASE + QUICK + q, { waitUntil: 'load' }); await page.waitForFunction(() => !!document.getElementById('tplSelect'), null, { timeout: 30000 }); await page.waitForTimeout(1200); };
const saved = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('emboss-settings') || 'null'); } catch { return null; } });
const store = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('emboss-templates') || 'null'); } catch { return null; } });
// what a person would see of a thing: not display:none (the dialog may be closed, so its own state, not whether it is on screen)
const shown = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && (!e.closest('.field') || getComputedStyle(e.closest('.field')).display !== 'none'); }, sel);
const tabs = (page) => page.evaluate(() => [...document.querySelectorAll('#settingsDialog .settings-nav .tab-btn')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()));
const state = (page) => page.evaluate(() => ({ tt: document.body.classList.contains('transcriber-tools'), expert: document.body.classList.contains('expert-hardware'), betaClass: document.body.classList.contains('beta-locked') }));
const pressHardwareToggle = (page) => page.evaluate(() => { const ev = new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }); return window.dispatchEvent(ev) === true; });   // true = nobody took the key
const openSettings = async (page) => { if (!(await page.evaluate(() => document.getElementById('settingsDialog').open))) await page.click('#settingsBtn'); };
const openTpl = async (page) => { await openSettings(page); await page.click('.settings-nav .tab-btn[data-tab="tab-rules"]'); if (!(await page.evaluate(() => document.getElementById('tplSettings').open))) await page.click('#tplSettings > summary'); };
const closeSettings = async (page) => { if (await page.evaluate(() => document.getElementById('settingsDialog').open)) await page.click('#settingsDialog .dialog-foot button'); await page.waitForTimeout(200); };
const switchTools = async (page, on) => {
  await openSettings(page);
  await page.click('.settings-nav .tab-btn[data-tab="tab-display"]');
  const now = await page.isChecked('#set-transcriberTools');
  if (now !== on) await page.click('label[for="set-transcriberTools"]');
  await page.waitForTimeout(500);
};

try {
  // ------------------------------------------------------------------------------------------------ the old markers change nothing
  for (const marker of ['', 'beta', 'plus']) {
    const label = marker ? `marked emboss-${marker}` : 'unmarked';
    console.log(`--- a page ${label}, an everyday user (${ENGINE_LABEL}) ---`);
    const { ctx, page, errors } = await open(marker, { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
    await goEditor(page);
    const s = await state(page);
    ok(`${label}: Transcriber tools are off, no beta lock`, !s.tt && !s.betaClass, s);
    ok(`${label}: Settings has the Template and User Interface tabs only`, (await tabs(page)).join('|') === 'Template|User Interface', await tabs(page));
    ok(`${label}: no Emboss button, no Embosser & Hardware tab`, !(await shown(page, '#embossBtn')) && !(await shown(page, '.tab-btn[data-tab="tab-hardware"]')));
    ok(`${label}: Ctrl/Cmd+Shift+\\ does nothing (the key is not even taken)`, (await pressHardwareToggle(page)) === true && !(await state(page)).expert);
    await page.waitForTimeout(200);
    ok(`${label}: ... and nothing was saved for it`, !((await saved(page)) || {}).expertHardware, await saved(page));
    ok(`${label}: no page errors (editor)`, errors.length === 0, errors);
    await ctx.close();
  }
  console.log(`--- Quick Mode: a first visit, and no hardware (${ENGINE_LABEL}) ---`);
  for (const marker of ['', 'beta', 'plus']) {
    const { ctx, page, errors } = await open(marker, null);
    await goQuick(page);
    const st = await saved(page);
    ok(`first visit (${marker || 'unmarked'}): Transcriber tools are saved OFF, and no question is asked`, st && st.transcriberTools === false && (await page.evaluate(() => document.querySelectorAll('dialog[open]').length)) === 0, st);
    ok(`first visit (${marker || 'unmarked'}): Quick Mode shows no Emboss item and Ctrl/Cmd+Shift+\\ does nothing`, !(await shown(page, '#downloadEmbossItem')) && (await pressHardwareToggle(page)) === true && !(await state(page)).expert);
    ok(`first visit (${marker || 'unmarked'}): Settings has Template and User Interface only`, (await tabs(page)).join('|') === 'Template|User Interface', await tabs(page));
    ok(`first visit (${marker || 'unmarked'}): no page errors`, errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------ ?tools=1
  console.log(`--- ?tools=1 and ?tools=0 (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open('beta', { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
    await goEditor(page);
    ok('before the link: Transcriber tools are off', !(await state(page)).tt);
    await goEditor(page, '?tools=1');
    ok('?tools=1 turns Transcriber tools on, and saves the choice', (await state(page)).tt && (await saved(page)).transcriberTools === true);
    ok('... the Advanced Production tab shows, and the switch in User Interface is ticked', (await tabs(page)).join('|') === 'Template|User Interface|Advanced Production' && (await page.evaluate(() => document.getElementById('set-transcriberTools').checked)), await tabs(page));
    await goEditor(page);
    ok('... and a later visit without the link keeps it on (it is a saved choice, not a lock)', (await state(page)).tt);
    await goEditor(page, '?tools=0');
    ok('?tools=0 turns them off again', !(await state(page)).tt && (await saved(page)).transcriberTools === false);
    ok('no page errors (links)', errors.length === 0, errors);
    await ctx.close();
    const q = await open('', null);
    await goQuick(q.page, '?tools=1');
    ok('Quick Mode: ?tools=1 on a first visit turns Transcriber tools on (paragraph style shows)', (await state(q.page)).tt && (await saved(q.page)).transcriberTools === true && (await shown(q.page, '#set-paragraphStyle')));
    await q.ctx.close();
  }

  // ------------------------------------------------------------------------------------------------ the switch in User Interface
  console.log(`--- Show transcriber tools (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open('', { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
    await goEditor(page);
    await openSettings(page);
    await page.click('.settings-nav .tab-btn[data-tab="tab-display"]');
    const sw = await page.evaluate(() => { const e = document.getElementById('set-transcriberTools'); const l = e.closest('label'); return { inUI: !!e.closest('#tab-display'), label: l.textContent.replace(/\s+/g, ' ').trim(), described: !!document.getElementById(e.getAttribute('aria-describedby')), checked: e.checked }; });
    ok('the switch is in User Interface, labelled "Show transcriber tools", with one line saying what it adds, and off', sw.inUI && /^Show transcriber tools/.test(sw.label) && /formal braille books/.test(sw.label) && sw.described && !sw.checked, sw);
    ok('with it off: no Advanced Production tab, no paragraph style, no Insert > Graphic, no Book details', !(await shown(page, '.tab-btn[data-tab="tab-document"]')) && !(await shown(page, '#set-paragraphStyle')) && !(await shown(page, '#btnGraphic')) && !(await shown(page, '#btnTitlepageDetails')));
    await page.click('label[for="set-transcriberTools"]');
    await page.waitForTimeout(500);
    ok('ticking it: the Advanced Production tab appears (Template, User Interface, Advanced Production)', (await tabs(page)).join('|') === 'Template|User Interface|Advanced Production', await tabs(page));
    ok('... and the transcriber settings, Insert > Graphic and Book details show', (await shown(page, '#set-paragraphStyle')) && (await shown(page, '#btnGraphic')) && (await shown(page, '#btnTitlepageDetails')));
    ok('... and it is saved', (await saved(page)).transcriberTools === true);
    await page.click('.settings-nav .tab-btn[data-tab="tab-document"]');
    ok('Advanced Production holds Book details and the covers (not the switch)', (await shown(page, '#btnTitlepageDetails')) && !(await page.evaluate(() => !!document.querySelector('#tab-document #set-transcriberTools'))));
    await page.click('.settings-nav .tab-btn[data-tab="tab-display"]');
    await page.click('label[for="set-transcriberTools"]');
    await page.waitForTimeout(500);
    ok('unticking it hides them all again', (await tabs(page)).join('|') === 'Template|User Interface' && !(await shown(page, '#set-paragraphStyle')) && !(await shown(page, '#btnGraphic')));
    // unticking while Advanced Production is the open tab goes back to User Interface (the tab disappears under the user)
    await page.click('label[for="set-transcriberTools"]');
    await page.waitForTimeout(300);
    await page.click('.settings-nav .tab-btn[data-tab="tab-document"]');
    await page.evaluate(() => { document.getElementById('set-transcriberTools').click(); });   // from outside the tab: the page must not leave an empty panel
    await page.waitForTimeout(400);
    ok('... if Advanced Production was open it is left, for User Interface (no empty panel)', await page.evaluate(() => document.querySelector('#settingsDialog .tab-btn.active')?.getAttribute('data-tab') === 'tab-display'));
    ok('no page errors (switch)', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------ List Format / Table Layout, Quick Mode too
  console.log(`--- List Format and Table Layout show for everyone (${ENGINE_LABEL}) ---`);
  for (const [label, go] of [['editor', goEditor], ['Quick Mode', goQuick]]) {
    const { ctx, page, errors } = await open('beta', { simpleMode: label === 'Quick Mode', mode: 'bana', grade: 'g2', uiLanguage: 'en' });
    await go(page);
    await openTpl(page);
    ok(`${label}: List Format and Table Layout show; paragraph style and volume size stay transcriber settings`, (await shown(page, '#set-listStyle')) && (await shown(page, '#set-tableFormat')) && !(await shown(page, '#set-paragraphStyle')) && !(await shown(page, '#set-volumePages')));
    ok(`${label}: Made for, the embosser model and Interpoint / single-sided show for everyone (Transcriber tools off)`, (await shown(page, '#set-madeFor')) && (await shown(page, '#set-embosser')) && (await shown(page, '#set-embosserDuplex')));
    const labels = await page.evaluate(() => ({ made: document.querySelector('label[for="set-madeFor"]').textContent.trim(), duplex: document.querySelector('label[for="set-embosserDuplex"]').textContent.trim(), simple: document.querySelector('[data-i18n="settings.simple_mode_label"]').textContent.trim(), code: document.querySelector('label[for="set-language"]').textContent.trim() }));
    ok(`${label}: plain labels ("Made for", "Interpoint or single-sided", "Braille code", "Start in Quick Mode")`, labels.made === 'Made for' && labels.duplex === 'Interpoint or single-sided' && labels.code === 'Braille code' && labels.simple === 'Start in Quick Mode', labels);
    ok(`${label}: no page errors`, errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------ Made for
  console.log(`--- Made for (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open('', { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
    await goEditor(page);
    ok('Transcriber tools are off for this part', !(await state(page)).tt);
    ok('on Paper there is no Monarch or DotPad tab, and the braille pane has a plain label', !(await shown(page, '#tabViewMonarch')) && !(await shown(page, '#tabViewDotPad')) && (await page.evaluate(() => !document.getElementById('brailleSoloLabel').hidden)));
    await openTpl(page);
    ok('Made for offers Paper, APH Monarch and DotPad', await page.evaluate(() => [...document.querySelectorAll('#set-madeFor option')].map((o) => o.value).join('|') === 'paper|monarch|dotpad'));
    await page.selectOption('#set-madeFor', 'monarch');
    await page.waitForTimeout(700);
    let st = await saved(page);
    ok('Made for Monarch sets the page to 32 x 10', st.madeFor === 'monarch' && st.cells === 32 && st.lines === 10 && (await page.inputValue('#set-cells')) === '32' && (await page.inputValue('#set-lines')) === '10', st);
    ok('... the Monarch tab shows beside the braille with Transcriber tools OFF', (await shown(page, '#tabViewMonarch')) && !(await shown(page, '#tabViewDotPad')) && (await page.evaluate(() => !document.querySelector('.braille-view-tabs').hidden && document.getElementById('brailleSoloLabel').hidden)));
    ok('... the page size fields are fixed (with a line saying why), and the paper-only choices go', await page.evaluate(() => document.getElementById('set-cells').disabled && document.getElementById('set-lines').disabled && document.getElementById('set-pageSize').disabled && !document.getElementById('pageSizeFixed').hidden && getComputedStyle(document.getElementById('duplexField')).display === 'none'));
    ok('... and the template says it changed (Made for, the page size)', await page.evaluate(() => /made for/.test(document.getElementById('tplState').textContent) && /\(modified\)/.test(document.getElementById('tplSelect').selectedOptions[0].textContent)), await page.textContent('#tplState'));
    await closeSettings(page);
    await page.click('#tabViewMonarch');
    ok('the Monarch tab can be opened (its emulator shows)', await page.evaluate(() => getComputedStyle(document.getElementById('monarchPanel')).display !== 'none' && document.getElementById('tabViewMonarch').getAttribute('aria-selected') === 'true'));
    await page.click('#tabViewBraille');
    await openTpl(page);
    await page.selectOption('#set-madeFor', 'dotpad');
    await page.waitForTimeout(700);
    st = await saved(page);
    ok('Made for DotPad sets 20 x 10, and its tab (not the Monarch\'s) shows', st.cells === 20 && st.lines === 10 && (await shown(page, '#tabViewDotPad')) && !(await shown(page, '#tabViewMonarch')), st);
    await page.selectOption('#set-madeFor', 'paper');
    await page.waitForTimeout(700);
    st = await saved(page);
    ok('back on Paper: the standard\'s usual page (BANA 38 x 25) returns, the fields are free, the tabs go', st.madeFor === 'paper' && st.cells === 38 && st.lines === 25 && !(await page.evaluate(() => document.getElementById('set-cells').disabled)) && !(await shown(page, '#tabViewDotPad')) && !(await shown(page, '#tabViewMonarch')), st);
    await page.selectOption('#set-pageSize', 'uk-40x27');
    await page.waitForTimeout(500);
    st = await saved(page);
    ok('on Paper the page size presets still choose the page (40 x 27)', st.cells === 40 && st.lines === 27, st);
    ok('no page errors (made for)', errors.length === 0, errors);
    await ctx.close();
    // Quick Mode has no emulator, but the page size follows
    const q = await open('', { simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
    await goQuick(q.page);
    await openTpl(q.page);
    await q.page.selectOption('#set-madeFor', 'monarch');
    await q.page.waitForTimeout(600);
    st = await saved(q.page);
    ok('Quick Mode: Made for Monarch sets 32 x 10 there too, and the fields are fixed', st.madeFor === 'monarch' && st.cells === 32 && st.lines === 10 && (await q.page.evaluate(() => document.getElementById('set-cells').disabled)), st);
    ok('Quick Mode: no page errors', q.errors.length === 0, q.errors);
    await q.ctx.close();
  }

  // ------------------------------------------------------------------------------------------------ the embosser model
  console.log(`--- the embosser model (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open('', { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' });
    await goEditor(page);
    await openTpl(page);
    // Paul, 4 Nov 2026 (changed brief): the embosser model is for everyone, not only transcribers
    ok('Transcriber tools off: the embosser model is shown under Made for: Paper, with its names', (await shown(page, '#set-embosser')) && await page.evaluate(() => [...document.querySelectorAll('#set-embosser option')].map((o) => o.value).join('|') === 'generic|custom|aph|viewplus|braillo|index|romeo'));
    await page.selectOption('#set-embosser', 'viewplus');
    await page.waitForTimeout(600);
    let st = await saved(page);
    ok('choosing a ViewPlus keeps the page size (it no longer sets it)', st.embosser === 'viewplus' && st.cells === 38 && st.lines === 25, st);
    ok('... and the template says the embosser model changed', await page.evaluate(() => /embosser model/.test(document.getElementById('tplState').textContent)), await page.textContent('#tplState'));
    await page.selectOption('#set-madeFor', 'monarch');
    await page.waitForTimeout(500);
    ok('Made for a Monarch: the embosser model goes (it is a paper choice)', !(await shown(page, '#set-embosser')));
    ok('no page errors (embosser model)', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------ saved with the template, the file and the document
  console.log(`--- saved with a template, its file and the document (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open('', { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', transcriberTools: true });
    await goEditor(page);
    await openTpl(page);
    await page.selectOption('#set-embosserDuplex', 'single');
    await page.selectOption('#set-embosser', 'index');
    await page.selectOption('#set-madeFor', 'dotpad');
    await page.waitForTimeout(600);
    await page.click('#tplSaveAs');
    await page.fill('#tplAskName', 'Dot job');
    await page.click('#tplAskOk');
    await page.waitForTimeout(500);
    const st = await store(page);
    const t = st && st.list.find((x) => x.name === 'Dot job');
    ok('Save as keeps Made for, the embosser model and single-sided in the template (and the page the device fixes)', t && t.settings.madeFor === 'dotpad' && t.settings.embosser === 'index' && t.settings.embosserDuplex === 'single' && t.settings.cells === 20 && t.settings.lines === 10, t && t.settings);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tplExport')]);
    const file = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    ok('the exported template file carries them', file.settings.madeFor === 'dotpad' && file.settings.embosser === 'index' && file.settings.embosserDuplex === 'single', file.settings);
    await closeSettings(page);
    const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
    const meta = (name) => { const m = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(xml); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null; };
    const rec = JSON.parse(meta('emboss-template-settings') || 'null');
    ok('the saved document records them with its template', meta('emboss-template') === 'Dot job' && rec && rec.madeFor === 'dotpad' && rec.embosser === 'index' && rec.embosserDuplex === 'single', { name: meta('emboss-template'), rec });
    // back to a paper template, then open the document: its settings come back
    await openTpl(page);
    await page.selectOption('#tplSelect', 'bana');
    await page.waitForTimeout(600);
    let now = await saved(page);
    ok('choosing BANA again puts Paper, the generic embosser and interpoint back (38 x 25)', now.madeFor === 'paper' && now.embosser === 'generic' && now.embosserDuplex === 'double' && now.cells === 38 && now.lines === 25, now);
    await closeSettings(page);
    await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'dot.xml', { type: 'application/xml' })); }, xml);
    await page.waitForTimeout(1500);
    now = await saved(page);
    ok('opening the document brings back Made for DotPad, the model and single-sided', now.madeFor === 'dotpad' && now.embosser === 'index' && now.embosserDuplex === 'single' && now.cells === 20, now);
    ok('... and the DotPad tab shows (Transcriber tools on or off)', await shown(page, '#tabViewDotPad'));
    ok('no page errors (saved)', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------ an older setup
  console.log(`--- an older saved setup (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open('', { simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', embosser: 'monarch', cells: 32, lines: 10, expertHardware: true, tactileRip: true });
    await goEditor(page);
    ok('"embosser: Monarch" from the old Settings becomes Made for Monarch: its tab shows; an old hardware switch does nothing', (await shown(page, '#tabViewMonarch')) && !(await state(page)).expert && !(await shown(page, '#embossBtn')));
    await openTpl(page);
    ok('... Settings shows Made for Monarch, the paper model back at generic, page 32 x 10', (await page.inputValue('#set-madeFor')) === 'monarch' && (await page.inputValue('#set-embosser')) === 'generic' && (await page.inputValue('#set-cells')) === '32' && (await page.inputValue('#set-lines')) === '10');
    ok('no page errors (older setup)', errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) {
  ok('the run completed', false, String((e && e.stack) || e));
} finally {
  await browser.close();
}
console.log(`\n=== One build [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
