// Paul, 17 Oct 2026, feedback item 9a: Quick Mode's Settings had drifted from the editor's (it still offered "Interline Print View", removed from the editor's).
// Both pages now make <dialog id="settingsDialog"> from ONE source, web/settings-panes.mjs; the editor wires its controls in editor.mjs and Quick Mode wires the
// shared ones with bindSettingsDialog. These checks, which need no browser, hold that so it cannot drift again: neither page carries a copy of the markup, every
// control is wired by the editor and (unless it is an editor-only control, listed in one place) by Quick Mode's binder, and every label has its words in en.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const PANES = read('web/settings-panes.mjs');
const EDITOR = read('web/editor/index.html');
const QUICK = read('web/index.html');
const EDITOR_JS = read('web/editor/editor.mjs');
const APP_JS = read('web/app.mjs');
const EN = JSON.parse(read('web/locales/en.json'));
const html = PANES.slice(PANES.indexOf('SETTINGS_DIALOG_HTML = `') + 'SETTINGS_DIALOG_HTML = `'.length, PANES.indexOf('`;\n\n// Controls that only the editor has'));
const ids = [...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
const controls = ids.filter((i) => /^set-/.test(i));
const editorOnly = new Set([...PANES.match(/EDITOR_ONLY_IDS = \[([^\]]*)\]/)[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]));

test('both pages have an empty Settings dialog and make it from the one source', () => {
  for (const [name, page] of [['editor/index.html', EDITOR], ['index.html', QUICK]]) {
    assert.match(page, /<dialog id="settingsDialog" class="dialog"><\/dialog>/, `${name}: an empty dialog, filled by settings-panes.mjs`);
    assert.ok(!/id="set-(?:language|mode|cells|lines|pageSize|uiLanguage)"/.test(page), `${name} carries no copy of the Settings controls`);
    assert.ok(!/id="(?:language|mode|cells|lines|pageSize|quoteStyle|listStyle|tableFormat|embosser|interline|simpleMode)"/.test(page.replace(/<script[\s\S]*?<\/script>/g, '')), `${name}: none of Quick Mode's old control ids`);
  }
  assert.match(EDITOR_JS, /mountSettingsDialog\(document\.getElementById\('settingsDialog'\), \{ page: 'editor' \}\)/);
  assert.match(APP_JS, /mountSettingsDialog\(document\.getElementById\('settingsDialog'\), \{ page: 'quick' \}\)/);
  assert.match(APP_JS, /bindSettingsDialog\(el\.settingsDialog/);
});

test('Interline Print View is gone from Quick Mode (it was removed from the editor\'s Settings)', () => {
  assert.ok(!/interline/i.test(html), 'not in the shared markup');
  assert.ok(!/interline/i.test(QUICK.replace(/<script[\s\S]*?<\/script>/g, '')), 'not in Quick Mode\'s page');
  assert.ok(!/el\.interline|\$\('interline'\)/.test(APP_JS));
});

test('the markup keeps the editor\'s sections, in the editor\'s order, and adds "Start in Quick Mode" and "Show the explanation bar"', () => {
  assert.deepEqual([...html.matchAll(/id="(tab-[\w]+)" class="settings-panel/g)].map((m) => m[1]), ['tab-rules', 'tab-hardware', 'tab-display', 'tab-document']);
  assert.ok(controls.includes('set-simpleMode') && controls.includes('set-showExplanationBar'));
  const order = ['set-language', 'set-mathCode', 'set-mode', 'set-paragraphStyle', 'set-quoteStyle', 'set-listStyle', 'set-tableFormat'];
  const at = order.map((id) => ids.indexOf(id));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'Rules & Translation Standards in the editor\'s order');
});

test('every control is wired by the editor, and by Quick Mode\'s binder unless it is an editor-only control', async () => {
  const unwiredEditor = controls.filter((id) => !new RegExp(`['"]${id}['"]`).test(EDITOR_JS));
  // (set-...Help are the small help lines under a control, not controls)
  assert.deepEqual(unwiredEditor.filter((id) => !/^set-\w+Help$/.test(id)), [], 'the editor wires them all');
  const unwiredQuick = controls.filter((id) => !editorOnly.has(id) && !new RegExp(`['"]${id}['"]`).test(PANES) );
  assert.deepEqual(unwiredQuick.filter((id) => !/^set-\w+Help$/.test(id)), [], 'bindSettingsDialog wires every shared control');
  // the editor-only ones are exactly those inside an element marked data-scope="editor" in the markup (its controls, buttons and fieldset)
  const { JSDOM } = await import('jsdom');
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  const inside = new Set();
  for (const holder of doc.querySelectorAll('[data-scope="editor"]')) {
    if (holder.id) inside.add(holder.id);
    for (const e of holder.querySelectorAll('[id]')) inside.add(e.id);
  }
  const named = [...editorOnly];
  assert.deepEqual([...inside].filter((i) => /^(set-|btn|docOptions)/.test(i)).sort(), named.sort(), 'EDITOR_ONLY_IDS is exactly the marked controls');
});

test('every label, hint and option text in the shared markup has its words in en.json (other languages fall back to them)', () => {
  const get = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), EN);
  const keys = [...html.matchAll(/data-i18n(?:-title|-aria)?="([\w.]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 60, `${keys.length} keys`);
  const missing = [...new Set(keys)].filter((k) => typeof get(k) !== 'string');
  assert.deepEqual(missing, []);
});

test('settings.mjs stays the single store: the new setting has its default and is sanitised there', () => {
  const S = read('web/settings.mjs');
  assert.match(S, /showExplanationBar: true,/);
  assert.match(S, /clean\.showExplanationBar = clean\.showExplanationBar !== false;/);
  assert.match(S, /simpleMode: true,/);
});

// ---- Templates (X1; Paul, 1 Nov 2026, decision 1: the first view is the template picker plus the personal settings) ----
test('the first tab is the Template tab: the picker, its buttons, a name form in the page, and the braille settings in a closed "Template settings" disclosure', async () => {
  const { JSDOM } = await import('jsdom');
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  const rules = doc.getElementById('tab-rules');
  for (const id of ['tplSelect', 'tplState', 'tplStatus', 'tplRevert', 'tplSave', 'tplSaveAs', 'tplRename', 'tplDelete', 'tplExport', 'tplImport', 'tplImportFile', 'tplAsk', 'tplAskName', 'tplAskError', 'tplAskOk', 'tplAskCancel']) assert.ok(rules.querySelector('#' + id), id);
  assert.ok(doc.querySelector('label[for="tplSelect"]'), 'the picker has a label');
  assert.equal(doc.getElementById('tplStatus').getAttribute('role'), 'status', 'messages are in a live region');
  assert.ok(doc.getElementById('tplAsk').hidden, 'the name form starts closed');
  const details = doc.getElementById('tplSettings');
  assert.equal(details.tagName, 'DETAILS');
  assert.equal(details.hasAttribute('open'), false, 'closed by default');
  assert.equal(details.firstElementChild.tagName, 'SUMMARY');
  // everything that shapes the braille is inside it; nothing of it is left on the other tabs
  // Paul, 4 Nov 2026: one Emboss (EMBOSS-TASKS section P): "Made for" (P-J), the embosser model (P-K) and interpoint / single-sided (P-L) are template settings now.
  for (const id of ['set-language', 'set-mathCode', 'set-mode', 'set-embosser', 'set-embosserDuplex', 'set-paragraphStyle', 'set-quoteStyle', 'set-listStyle', 'set-tableFormat', 'set-pageSize', 'set-cells', 'set-lines', 'set-volumePages', 'docOptionsGroup']) {
    assert.ok(details.querySelector('#' + id), `${id} is in Template settings`);
  }
  for (const id of ['set-uiLanguage', 'set-asciiBraille', 'set-simpleMode', 'set-voice', 'set-connectionType', 'set-transcriberTools']) assert.ok(!details.querySelector('#' + id), `${id} is personal: not in the template`);
  // Paul, 4 Nov 2026: one Emboss: the Transcriber tools switch is in User Interface and the Advanced Production tab shows only while it is on (it was .beta-hide); List Format and Table Layout show for everyone
  assert.equal(doc.querySelector('.tab-btn[data-tab="tab-document"]').classList.contains('fmt-transcriber'), true, 'the Advanced Production tab shows only while Transcriber tools is on');
  assert.ok(doc.getElementById('tab-display').querySelector('#set-transcriberTools'), 'the switch is in User Interface');
  assert.ok(!doc.getElementById('tab-document').querySelector('#set-transcriberTools'));
  assert.equal(doc.querySelector('.beta-hide'), null, 'no beta-hidden settings are left');
  assert.ok(!doc.getElementById('set-listStyle').closest('.field').classList.contains('fmt-transcriber') && !doc.getElementById('set-tableFormat').closest('.field').classList.contains('fmt-transcriber'));
  // Paul, 4 Nov 2026 (coordinator's change to the brief): the embosser model shows to EVERYONE under Made for: Paper - teachers need it too
  assert.ok(!doc.getElementById('embosserField').classList.contains('fmt-transcriber'), 'the embosser model is for everyone');
  // Paul, 4 Nov 2026 (interface question 3, answer B): "Made for" sits beside the template picker, not inside Template settings - it is still a template
  // setting (saved with the template), but a Monarch or DotPad user should see it without opening the disclosure
  const madeFor = doc.getElementById('set-madeFor');
  assert.ok(!details.contains(madeFor), 'Made for is not inside the Template settings disclosure');
  assert.equal(doc.getElementById('tplState').nextElementSibling, madeFor.closest('.field'), 'Made for comes straight after the template picker and its state line');
  assert.ok(!doc.getElementById('set-madeFor').closest('.field').classList.contains('fmt-transcriber') && !doc.getElementById('duplexField').classList.contains('fmt-transcriber'), 'Made for and interpoint are for everyone');
  assert.equal(doc.getElementById('tab-hardware').querySelector('#set-embosser, #set-embosserDuplex, #set-tactileRip'), null, 'the hardware tab no longer holds them (and the RIP setting is gone)');
  assert.ok(!doc.getElementById('tab-document').querySelector('#set-cells, #set-pageSize, #set-volumePages, #docOptionsGroup'));
});

test('every English word the template code asks for is in en.json, and the new module is in the offline build', () => {
  const get = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), EN);
  const used = new Set();
  for (const m of PANES.matchAll(/\btx\('([\w]+)'/g)) used.add(`templates.${m[1]}`);
  for (const m of PANES.matchAll(/\[\s*'([a-z_]+)',\s*'[^']*'\s*\]/g)) used.add(`templates.${m[1]}`);   // problemWords / importWords
  for (const m of EDITOR_JS.matchAll(/tOr\('(templates\.[\w]+)'/g)) used.add(m[1]);
  for (const k of ['changed', 'modified', 'from_document']) used.add(`templates.${k}`);
  for (const k of ['mode', 'brailleCode', 'mathCode', 'cells', 'lines', 'quoteStyle', 'listStyle', 'paragraphStyle', 'tableFormat', 'volumePages', 'toc']) used.add(`templates.field_${k}`);
  assert.ok(used.size > 30, `${used.size} keys`);
  assert.deepEqual([...used].filter((k) => typeof get(k) !== 'string'), []);
  assert.ok(typeof get('settings.tab_template') === 'string');
  assert.match(read('web/sw.js'), /'\/web\/templates\.mjs'/, 'the service worker precaches it');
  assert.match(read('scripts/build-dist.mjs'), /\['web\/templates\.mjs', 'templates\.mjs'\]/, 'the build copies it');
});
