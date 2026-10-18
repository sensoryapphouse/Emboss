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
  assert.deepEqual(unwiredEditor.filter((id) => !['set-transcriberToolsHelp'].includes(id)), [], 'the editor wires them all');
  const unwiredQuick = controls.filter((id) => !editorOnly.has(id) && !new RegExp(`['"]${id}['"]`).test(PANES) );
  assert.deepEqual(unwiredQuick.filter((id) => !['set-transcriberToolsHelp'].includes(id)), [], 'bindSettingsDialog wires every shared control');
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
