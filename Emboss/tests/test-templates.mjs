// Templates (task X1; Paul, 1 Nov 2026: "go with your suggestions"; plan docs/templates-design.md, build step 3), in the browser.
//   node Emboss/scripts/serve.mjs 8461 &   then   node Emboss/tests/test-templates.mjs 8461      (EMBOSS_ENGINE=webkit for Safari's engine)
// The rules themselves are tested without a browser in tests/templates.test.mjs; this checks the Settings controls on both pages:
//   - the first tab is "Template": the picker (BANA, UKAAF, your own), "(modified)" and what changed, Undo changes, Save, Save as, Rename, Delete, Export, Import;
//   - the braille settings sit in the "Template settings" disclosure, closed at first; the name box is a small form in the page (no browser prompt), Escape closes
//     only the box, the keyboard goes somewhere sensible afterwards, and every message is in the dialog's own live region;
//   - applying BANA or UKAAF gives today's settings exactly; a template carries the document's Braille formatting options (editor);
//   - a saved document remembers its template and reopens with it, in the editor and in Quick Mode;
//   - settings already changed become the first own template, "My settings"; a beta build shows the picker and no empty tab; no raw key ever shows.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openSuite, openEditor, openTemplateSettings, URL_BASE } from './lib/suite.mjs';

const BANA = { simpleMode: false, mode: 'bana' };
const s = await openSuite('Templates', { settings: BANA });
const { page, ok } = s;
const wait = (ms) => page.waitForTimeout(ms);
const ls = (k) => page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, k);
const picker = () => page.evaluate(() => { const sel = document.getElementById('tplSelect'); return { shown: sel.options[sel.selectedIndex]?.textContent, value: sel.value, options: [...sel.options].map((o) => o.textContent), state: document.getElementById('tplState').textContent.trim(), status: document.getElementById('tplStatus').textContent.trim() }; });
// Shown to the eye: not hidden, not display:none, and not inside a closed <details> (a closed disclosure still has client rects in Chrome).
const shown = (id) => page.evaluate((i) => { const e = document.getElementById(i); if (!e || e.hidden || getComputedStyle(e).display === 'none' || e.getClientRects().length === 0) return false; const d = e.closest('details'); return !(d && !d.open && !(e.parentElement === d && e.tagName === 'SUMMARY')); }, id);
const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const settingsOf = () => ls('emboss-settings');
const KEYS = ['mode', 'brailleCode', 'mathCode', 'cells', 'lines', 'quoteStyle', 'listStyle', 'paragraphStyle', 'tableFormat', 'volumePages', 'toc'];
const subset = (o) => Object.fromEntries(KEYS.map((k) => [k, o[k]]));
const BANA_VALUES = { mode: 'bana', brailleCode: 'en-ueb-g2', mathCode: 'auto', cells: 38, lines: 25, quoteStyle: 'faithful', listStyle: 'compact', paragraphStyle: 'indented', tableFormat: 'auto', volumePages: 0, toc: false };
const UKAAF_VALUES = { ...BANA_VALUES, mode: 'ukaaf', lines: 27 };
const settle = async () => { await wait(900); };
const setNumber = async (id, v) => { await page.fill('#' + id, String(v)); await page.press('#' + id, 'Tab'); await settle(); };

try {
  // ---------------------------------------------------------------- the editor
  console.log('--- the editor ---');
  await openEditor(page);
  await page.click('#settingsBtn');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#settingsDialog .settings-nav .tab-btn')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()));
  ok('the first tab is called Template', tabs[0] === 'Template' && !tabs.includes('Rules & Standards'), tabs);
  let p = await picker();
  ok('the picker offers BANA and UKAAF and shows BANA, not modified', p.options.join('|') === 'BANA|UKAAF' && p.shown === 'BANA', p);
  ok('Undo changes, Save, Rename and Delete are not offered on a built-in; Save as, Export and Import are', !(await shown('tplRevert')) && !(await shown('tplSave')) && !(await shown('tplRename')) && !(await shown('tplDelete')) && (await shown('tplSaveAs')) && (await shown('tplExport')) && (await shown('tplImport')));
  ok('the braille settings are behind "Template settings", closed at first', !(await shown('set-cells')) && !(await shown('set-language')) && !(await page.evaluate(() => document.getElementById('tplSettings').open)));
  ok('the disclosure is a details element with a summary', await page.evaluate(() => { const d = document.getElementById('tplSettings'); return d.tagName === 'DETAILS' && d.firstElementChild.tagName === 'SUMMARY' && d.firstElementChild.textContent.trim() === 'Template settings'; }));
  ok('the picker has a real label', await page.evaluate(() => document.querySelector('label[for="tplSelect"]')?.textContent.trim() === 'Template'));
  await page.click('#tplSettings > summary');
  ok('opening it shows the braille code, standard, page size and volume controls', (await shown('set-language')) && (await shown('set-mode')) && (await shown('set-pageSize')) && (await shown('set-cells')));
  // the Layout Standard etc. are still the editor's controls, with their old ids
  ok('the Advanced Production tab no longer holds the page size', await page.evaluate(() => !document.getElementById('tab-document').querySelector('#set-cells, #set-pageSize, #set-volumePages, #docOptionsGroup')));
  await page.click('#settingsDialog .dialog-foot button');
  await wait(300);

  // ---- choosing a template
  console.log('--- choosing ---');
  await openTemplateSettings(page);
  await page.selectOption('#tplSelect', 'ukaaf');
  await settle();
  let st = await settingsOf();
  ok('choosing UKAAF puts the UKAAF values in force', JSON.stringify(subset(st)) === JSON.stringify(UKAAF_VALUES), subset(st));
  ok('... the controls follow (38 x 27)', (await page.inputValue('#set-cells')) === '38' && (await page.inputValue('#set-lines')) === '27' && (await page.inputValue('#set-mode')) === 'ukaaf');
  p = await picker();
  ok('... the picker says so, in the dialog\'s live region', p.shown === 'UKAAF' && /UKAAF/.test(p.status) && /is on/.test(p.status), p);
  await page.selectOption('#tplSelect', 'bana');
  await settle();
  st = await settingsOf();
  ok('choosing BANA gives exactly the BANA defaults (38 x 25; Nemeth maths by the standard)', JSON.stringify(subset(st)) === JSON.stringify(BANA_VALUES), subset(st));

  // ---- modified
  console.log('--- modified ---');
  await setNumber('set-cells', 40);
  p = await picker();
  ok('a changed setting shows as "BANA (modified)"', p.shown === 'BANA (modified)', p);
  ok('... and the picker says what changed', /cells per line/.test(p.state), p.state);
  ok('Undo changes is offered; Save is not (a built-in)', (await shown('tplRevert')) && !(await shown('tplSave')));
  await page.click('#tplRevert');
  await settle();
  p = await picker();
  st = await settingsOf();
  ok('Undo changes puts the template back', p.shown === 'BANA' && st.cells === 38 && (await page.inputValue('#set-cells')) === '38', { p, cells: st.cells });
  ok('... and the keyboard goes to the picker, not to the page behind', (await focused()) === 'tplSelect', await focused());

  // ---- Save as
  console.log('--- Save as ---');
  await setNumber('set-cells', 36);
  await page.click('#tplSaveAs');
  ok('Save as opens a small name box (no browser prompt), focused on the name', (await shown('tplAsk')) && (await focused()) === 'tplAskName');
  ok('the name box has a label and is a group', await page.evaluate(() => { const g = document.getElementById('tplAsk'); return g.getAttribute('role') === 'group' && document.getElementById(g.getAttribute('aria-labelledby')).textContent.trim() === 'Name for the new template' && document.querySelector('label[for="tplAskName"]') !== null; }));
  await page.click('#tplAskOk');
  ok('an empty name is refused, with the reason, and the box stays', (await shown('tplAsk')) && /Type a name/.test(await page.textContent('#tplAskError')));
  await page.fill('#tplAskName', 'BANA');
  await page.press('#tplAskName', 'Enter');
  ok('"BANA" is refused (built in); Enter in the box does not close Settings', /built in/.test(await page.textContent('#tplAskError')) && (await page.evaluate(() => document.getElementById('settingsDialog').open)));
  await page.fill('#tplAskName', 'House style');
  await page.press('#tplAskName', 'Enter');
  await settle();
  p = await picker();
  ok('a name of its own saves the settings in force as a new template, now active, not modified', p.shown === 'House style' && p.options.join('|') === 'BANA|UKAAF|House style', p);
  ok('... announced in the dialog', /Saved as the new template/.test(p.status) && /House style/.test(p.status), p.status);
  ok('... and the keyboard is back on the Save as button', (await focused()) === 'tplSaveAs', await focused());
  ok('Save, Rename and Delete are now offered (Save waits for a change)', (await shown('tplSave')) && (await shown('tplRename')) && (await shown('tplDelete')) && (await page.evaluate(() => document.getElementById('tplSave').disabled)));
  let store = await ls('emboss-templates');
  ok('the store holds it', store.list.length === 1 && store.list[0].name === 'House style' && store.list[0].settings.cells === 36 && store.active === store.list[0].id && /^u-[0-9a-z]+$/.test(store.active), store);
  await setNumber('set-cells', 34);
  p = await picker();
  ok('changing it shows "House style (modified)" and enables Save', p.shown === 'House style (modified)' && !(await page.evaluate(() => document.getElementById('tplSave').disabled)), p);
  await page.click('#tplSave');
  p = await picker();
  store = await ls('emboss-templates');
  ok('Save keeps the change in the template', p.shown === 'House style' && store.list[0].settings.cells === 34 && /Saved the template/.test(p.status), { p, cells: store.list[0].settings.cells });

  // ---- Rename, with Escape
  console.log('--- Rename and Escape ---');
  await page.click('#tplRename');
  ok('Rename starts with the old name in the box', (await page.inputValue('#tplAskName')) === 'House style');
  await page.keyboard.press('Escape');
  await wait(200);
  ok('Escape closes only the name box: Settings stays, and the keyboard is back on Rename', !(await shown('tplAsk')) && (await page.evaluate(() => document.getElementById('settingsDialog').open)) && (await focused()) === 'tplRename', { ask: await shown('tplAsk'), open: await page.evaluate(() => document.getElementById('settingsDialog').open), focus: await focused() });
  await page.click('#tplRename');
  await page.fill('#tplAskName', 'Agency');
  await page.click('#tplAskOk');
  await settle();
  p = await picker();
  ok('Rename changes the name and keeps the template active', p.shown === 'Agency' && p.options.join('|') === 'BANA|UKAAF|Agency' && /Renamed to/.test(p.status), p);

  // ---- Export and Import
  console.log('--- Export and Import ---');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#tplExport')]);
  const fileName = download.suggestedFilename();
  const path = await download.path();
  const exported = JSON.parse(readFileSync(path, 'utf8'));
  ok('Export saves NAME.emboss-template.json with the name and the settings', fileName === 'Agency.emboss-template.json' && exported.format === 'emboss-template' && exported.version === 1 && exported.name === 'Agency' && exported.settings.cells === 34 && exported.settings.mode === 'bana', { fileName, exported });
  ok('... and says so', /Agency\.emboss-template\.json/.test((await picker()).status), (await picker()).status);
  await page.setInputFiles('#tplImportFile', { name: 'Agency.emboss-template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await settle();
  p = await picker();
  ok('Import adds it, renamed on a clash, and makes it active', p.shown === 'Agency (2)' && p.options.includes('Agency') && /already here/.test(p.status), p);
  await page.setInputFiles('#tplImportFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('this is not json') });
  await settle();
  p = await picker();
  ok('a file that is not a template gets a clear message and changes nothing', /not a template file/.test(p.status) && p.shown === 'Agency (2)', p);
  await page.setInputFiles('#tplImportFile', { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await settle();
  ok('... a JSON file of something else too', /not an Emboss template/.test((await picker()).status));
  await page.setInputFiles('#tplImportFile', { name: 'new.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'emboss-template', version: 7, name: 'x', settings: {} })) });
  await settle();
  ok('... and a template from a newer Emboss', /newer version/.test((await picker()).status));

  // ---- Delete
  console.log('--- Delete ---');
  await page.click('#tplDelete');
  ok('Delete asks first, in the page, with the keyboard on Cancel', (await shown('tplAsk')) && !(await shown('tplAskName')) && (await focused()) === 'tplAskCancel' && /Delete the template “Agency \(2\)”/.test(await page.textContent('#tplAskLabel')));
  await page.click('#tplAskCancel');
  ok('Cancel deletes nothing and returns to the Delete button', (await picker()).options.includes('Agency (2)') && (await focused()) === 'tplDelete', await focused());
  await page.click('#tplDelete');
  await page.click('#tplAskOk');
  await settle();
  p = await picker();
  st = await settingsOf();
  ok('Delete removes it and returns to the built-in of its standard, with its values in force', p.shown === 'BANA' && !p.options.includes('Agency (2)') && p.options.includes('Agency') && JSON.stringify(subset(st)) === JSON.stringify(BANA_VALUES) && /Deleted the template/.test(p.status), { p, st: subset(st) });
  ok('... and the keyboard is on the picker', (await focused()) === 'tplSelect', await focused());

  // ---- the document part and the document
  console.log('--- a document remembers its template ---');
  await page.click('#settingsDialog .dialog-foot button');
  await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('emboss-settings')); l.transcriberTools = true; localStorage.setItem('emboss-settings', JSON.stringify(l)); });
  await openEditor(page);
  await openTemplateSettings(page);
  ok('with Transcriber tools on, the document\'s Braille formatting options are in the disclosure', await shown('docEndMarkers'));
  await setNumber('set-cells', 36);
  await page.check('#docEndMarkers');
  p = await picker();
  ok('a document option changes the template state', /modified/.test(p.shown) && /End markers/.test(p.state), p);
  await page.click('#tplSaveAs');
  await page.fill('#tplAskName', 'With markers');
  await page.click('#tplAskOk');
  await settle();
  store = await ls('emboss-templates');
  const mk = store.list.find((t) => t.name === 'With markers');
  ok('Save as keeps the document part', mk && mk.doc.endMarkers === true && mk.settings.cells === 36, mk);
  await page.selectOption('#tplSelect', 'ukaaf');
  await settle();
  ok('choosing another template replaces the document options with its own (none)', !(await page.isChecked('#docEndMarkers')) && !/bana-end-markers/.test(await page.evaluate(() => window.exportCurrentDocumentXml())));
  await page.selectOption('#tplSelect', mk.id);
  await settle();
  const xml1 = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('choosing it again brings them back, and the saved file has them', (await page.isChecked('#docEndMarkers')) && /<meta name="bana-end-markers"/.test(xml1));
  ok('the saved file records the template: its name and the settings in force', /<meta name="emboss-template" content="With markers" \/>/.test(xml1) && /<meta name="emboss-template-settings" content="[^"]*&quot;cells&quot;:36/.test(xml1), xml1.match(/<meta name="emboss-template[^>]*>/g));
  await page.click('#settingsDialog .dialog-foot button');

  // reopen it under a different template
  await openTemplateSettings(page);
  await page.selectOption('#tplSelect', 'ukaaf');
  await settle();
  await page.click('#settingsDialog .dialog-foot button');
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'saved.xml', { type: 'application/xml' })); }, xml1);
  await wait(1500);
  await openTemplateSettings(page);
  p = await picker();
  st = await settingsOf();
  ok('reopening it makes its template active again, with the settings it was saved with', p.shown === 'With markers' && st.cells === 36 && st.mode === 'bana', { p, cells: st.cells, mode: st.mode });
  ok('... and its document options', await page.isChecked('#docEndMarkers'));
  await page.click('#settingsDialog .dialog-foot button');

  // a template nobody here has
  const xml2 = xml1.replace('content="With markers"', 'content="Elsewhere house style"');
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'elsewhere.xml', { type: 'application/xml' })); }, xml2);
  await wait(1500);
  await openTemplateSettings(page);
  p = await picker();
  ok('a template this computer does not have shows as "NAME (from document)"', p.shown === 'Elsewhere house style (from document)' && p.options.includes('Elsewhere house style (from document)') && /saved with/.test(p.state), p);
  await page.click('#tplSaveAs');
  await page.fill('#tplAskName', 'Elsewhere house style');
  await page.click('#tplAskOk');
  await settle();
  p = await picker();
  ok('Save as keeps it under its name', p.shown === 'Elsewhere house style' && !p.options.some((o) => /from document/.test(o)), p);
  await page.click('#settingsDialog .dialog-foot button');
  // a document with no template leaves the settings alone
  const before = await settingsOf();
  const plain = xml1.replace(/\s*<meta name="emboss-template[^>]*>/g, '');
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'plain.xml', { type: 'application/xml' })); }, plain);
  await wait(1200);
  ok('a document with no template changes no setting', JSON.stringify(subset(await settingsOf())) === JSON.stringify(subset(before)));

  // ---- the producer part (Paul, 2 Nov 2026): agency, place, country, notice and the people's names travel with a template
  console.log('--- the producer part ---');
  const bookDetails = async (fields) => {
    await page.click('#settingsBtn');
    await page.click('.settings-nav .tab-btn[data-tab="tab-document"]');
    await page.click('#btnTitlepageDetails');
    await page.waitForSelector('#titlepageDetailsDialog[open]', { timeout: 10000 });
    for (const [id, v] of Object.entries(fields)) await page.fill('#' + id, v);
    await page.press('#' + Object.keys(fields)[0], 'Enter');
    await page.waitForFunction(() => !document.getElementById('titlepageDetailsDialog').open, null, { timeout: 10000 });
    await wait(500);
  };
  const metaOf = (xml, name) => (new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(xml) || [])[1];
  await openEditor(page);
  await bookDetails({ tpAgency: 'Template Agency', tpTranscriber: 'Ann Transcriber' });
  await openTemplateSettings(page);
  await page.click('#tplSaveAs');
  await page.fill('#tplAskName', 'Agency job');
  await page.click('#tplAskOk');
  await settle();
  store = await ls('emboss-templates');
  const job = store.list.find((t) => t.name === 'Agency job');
  ok('Save as takes the open document\'s agency and the transcriber into the template', job && job.producer.tpAgency === 'Template Agency' && job.producer.tpTranscriber === 'Ann Transcriber', job && job.producer);
  const doc2 = { ...(await ls('emboss-settings')) };
  await page.click('#settingsDialog .dialog-foot button');
  // a different agency in the document does not make the template "modified"
  await bookDetails({ tpAgency: 'Another Agency' });
  await openTemplateSettings(page);
  p = await picker();
  ok('a document with another agency does not mark the template modified', p.shown === 'Agency job', p);
  await page.click('#settingsDialog .dialog-foot button');
  // a new document (the page starts again) is given the agency from the active template
  // the edit above (Another Agency) is unsaved: mark it clean and drop its backup first, or the reload rightly offers to recover it (Firefox does) and no new document starts
  await page.evaluate(async () => { window.markDocumentClean(); await window.__clearAutosaveSnapshot?.(); sessionStorage.setItem('suite-init', '1'); });
  await openEditor(page);
  let xml3 = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('a new document gets the agency and the transcriber from the template', metaOf(xml3, 'bana-tp-agency') === 'Template Agency' && metaOf(xml3, 'bana-tp-transcriber') === 'Ann Transcriber', xml3.match(/<meta name="bana-tp-[^>]*>/g));
  // applying a template to a document that has its own agency keeps it
  await bookDetails({ tpAgency: 'Own Agency', tpTranscriber: '' });
  await openTemplateSettings(page);
  await page.selectOption('#tplSelect', 'ukaaf');
  await settle();
  await page.selectOption('#tplSelect', job.id);
  await settle();
  xml3 = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('a document with its own agency keeps it when the template is applied; its empty transcriber is filled', metaOf(xml3, 'bana-tp-agency') === 'Own Agency' && metaOf(xml3, 'bana-tp-transcriber') === 'Ann Transcriber', xml3.match(/<meta name="bana-tp-[^>]*>/g));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#tplExport')]);
  const file2 = readFileSync(await dl2.path(), 'utf8');
  ok('the exported file has the agency but not the transcriber\'s name', /Template Agency/.test(file2) && !/Ann Transcriber|tpTranscriber/.test(file2), file2.slice(0, 400));
  await page.click('#settingsDialog .dialog-foot button');
  // opening a document never changes its producer fields
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'own.xml', { type: 'application/xml' })); }, xml3.replace(/<meta name="bana-tp-agency" content="[^"]*" \/>/, '<meta name="bana-tp-agency" content="Opened Agency" />').replace(/<meta name="bana-tp-transcriber"[^>]*\/>/, ''));
  await wait(1200);
  const xml4 = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('opening a document leaves its producer fields as they were (a missing transcriber stays missing)', metaOf(xml4, 'bana-tp-agency') === 'Opened Agency' && metaOf(xml4, 'bana-tp-transcriber') === undefined, xml4.match(/<meta name="bana-tp-[^>]*>/g));

  // ---------------------------------------------------------------- Quick Mode
  console.log('--- Quick Mode ---');
  await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('emboss-settings')); l.simpleMode = true; l.transcriberTools = false; localStorage.setItem('emboss-settings', JSON.stringify(l)); });
  await page.goto(`${URL_BASE}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('tplSelect') && document.getElementById('tplSelect').options.length >= 2, null, { timeout: 20000 });
  await wait(1200);
  await openTemplateSettings(page);
  p = await picker();
  ok('Quick Mode has the same picker, with the same templates', p.options.includes('BANA') && p.options.includes('UKAAF') && p.options.includes('Agency'), p);
  ok('... and no document part (the document\'s Braille formatting options are the editor\'s)', !(await page.evaluate(() => !!document.getElementById('docOptionsGroup'))));
  await page.selectOption('#tplSelect', 'ukaaf');
  await settle();
  st = await settingsOf();
  ok('choosing UKAAF in Quick Mode puts its values in force', JSON.stringify(subset(st)) === JSON.stringify(UKAAF_VALUES), subset(st));
  ok('... the header summary follows', /UKAAF/.test(await page.textContent('#settingsSummary')), await page.textContent('#settingsSummary'));
  await page.click('#settingsDialog .dialog-foot button');
  await page.setInputFiles('#fileInput', { name: 'saved.xml', mimeType: 'application/xml', buffer: Buffer.from(xml1) });
  await page.waitForFunction(() => window.lastBrf, null, { timeout: 30000 });
  await wait(800);
  st = await settingsOf();
  ok('a saved document dropped on Quick Mode applies its template', st.mode === 'bana' && st.cells === 36 && /BANA/.test(await page.textContent('#settingsSummary')), { mode: st.mode, cells: st.cells });
  await openTemplateSettings(page);
  p = await picker();
  ok('... and the picker shows it', p.shown === 'With markers', p);
  await page.click('#settingsDialog .dialog-foot button');

  // ---------------------------------------------------------------- accessibility: an axe WCAG 2 A/AA scan of the Template tab, light and dark
  console.log('--- axe ---');
  const AXE = fileURLToPath(new URL('./vendor/axe-core/axe.min.js', import.meta.url));
  for (const scheme of ['light', 'dark']) {
    for (const [label, url, ready] of [['editor', '/web/editor/index.html', () => typeof window.modelToLexical === 'function'], ['Quick Mode', '/web/index.html', () => !!document.getElementById('tplSelect')]]) {
      const ctx = await s.browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme });
      await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana', transcriberTools: true })); } } catch { /* no storage */ } });
      const pg = await ctx.newPage();
      await pg.goto(`${URL_BASE}${url}`, { waitUntil: 'load' });
      await pg.waitForFunction(ready, null, { timeout: 30000 });
      await pg.waitForTimeout(1500);
      await pg.click('#settingsBtn');
      await pg.click('#tplSettings > summary');
      await pg.fill('#set-cells', '36'); await pg.press('#set-cells', 'Tab');   // modified: Undo changes, the sentence about what changed
      await pg.click('#tplSaveAs');                                              // the name box open
      const scan = async () => {
        await pg.evaluate(() => document.fonts.ready);
        if (!(await pg.evaluate(() => typeof window.axe === 'object'))) await pg.addScriptTag({ path: AXE });
        const r = await pg.evaluate(() => window.axe.run(document.getElementById('settingsDialog'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
        return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message || '').slice(0, 140)}`) }));
      };
      const v = await scan();
      ok(`${label} [${scheme}]: Settings, Template tab, name box open and a change made: nothing to fix`, v.length === 0, v);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- nothing lost on upgrade, a language with no words, a beta
  console.log('--- upgrade, translation, beta ---');
  const ctx2 = await s.browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx2.addInitScript(() => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', cells: 40, lines: 25, paragraphStyle: 'block', uiLanguage: 'fr' })); } } catch { /* no storage */ } });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(String(e)));
  await p2.goto(`${URL_BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await p2.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 30000 });
  await p2.waitForTimeout(1500);
  await p2.click('#settingsBtn');
  const up = await p2.evaluate(() => { const sel = document.getElementById('tplSelect'); return { shown: sel.options[sel.selectedIndex]?.textContent, options: [...sel.options].map((o) => o.textContent), text: document.getElementById('settingsDialog').innerText }; });
  ok('settings that already differ from the built-in become the first own template, "My settings", active', up.shown === 'My settings' && up.options.join('|') === 'BANA|UKAAF|My settings', up);
  ok('with a language that has no template words, English shows and no raw key does', !/\b(?:templates|settings|app)\.[a-z_]+/i.test(up.text) && /Template settings/.test(up.text), up.text.slice(0, 300));
  ok('no page errors (upgrade, French)', errs2.length === 0, errs2);
  await ctx2.close();

  const ctx3 = await s.browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx3.addInitScript(() => { window.EMBOSS_BETA = true; try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana' })); } } catch { /* no storage */ } });
  let p3 = null;
  const errs3 = [];
  // one page per address: a fetch cut short by navigating away is not a page error
  for (const [label, url, ready] of [['editor', '/web/editor/index.html', () => typeof window.modelToLexical === 'function'], ['Quick Mode', '/web/index.html', () => !!document.getElementById('tplSelect')]]) {
    p3 = await ctx3.newPage(); const onErr = (e) => { errs3.push(label + ': ' + String(e)); }; p3.on('pageerror', onErr);
    await p3.goto(`${URL_BASE}${url}`, { waitUntil: 'load' });
    await p3.waitForFunction(ready, null, { timeout: 30000 });
    await p3.waitForTimeout(1500);
    await p3.click('#settingsBtn');
    await p3.click('#tplSettings > summary');   // Paul, 4 Nov 2026 (one Emboss, EMBOSS-TASKS section P): List Format and Table Layout show for everyone, inside the (now opened) Template settings
    const b = await p3.evaluate(() => {
      const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
      const tabs = [...document.querySelectorAll('#settingsDialog .settings-nav .tab-btn')].filter(vis).map((x) => x.textContent.trim());
      return { tabs, picker: vis(document.getElementById('tplSelect')), listStyle: vis(document.getElementById('set-listStyle')?.closest('.field')), tableFormat: vis(document.getElementById('set-tableFormat')?.closest('.field')), paragraph: vis(document.getElementById('set-paragraphStyle')?.closest('.field')), volume: vis(document.getElementById('set-volumePages')?.closest('.field')) };
    });
    // Paul, 4 Nov 2026: one Emboss (EMBOSS-TASKS section P). The beta marker (window.EMBOSS_BETA) is ignored now; a new user's Settings are Template and User Interface only,
    // List Format and Table Layout show for everyone (they were beta-hidden), paragraph style and volume size stay Transcriber tools.
    ok(`everyday start (${label}): the template picker shows for everyone`, b.picker, b);
    ok(`everyday start (${label}): the tabs are Template and User Interface only`, b.tabs.join('|') === 'Template|User Interface', b.tabs);
    ok(`everyday start (${label}): List Format and Table Layout show; paragraph style and volume size stay transcriber settings`, b.listStyle && b.tableFormat && !b.paragraph && !b.volume, b);
    ok(`everyday start (${label}): the page size is reachable in Template settings`, await p3.evaluate(() => { const e = document.getElementById('set-cells'); return getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; }));
    await p3.click('#settingsDialog .dialog-foot button');
    p3.off('pageerror', onErr);   // fetches still running when the page is closed fail by design
    await p3.close();
  }
  ok('no page errors (beta)', errs3.length === 0, errs3);
  await ctx3.close();
} finally {
  await s.finish();
}
