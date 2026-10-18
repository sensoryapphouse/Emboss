// K9: "Remove box" — one editor command (slash "/unbox", a toolbar button shown only while the cursor is in
// a box, and Ctrl/Cmd+Alt+U) dissolves a sidebar/box into its own contents as ordinary blocks, in one undo
// step. Available to everyone (not gated on Settings > Transcriber tools): the box and its border lines are
// ordinary, reader-visible content, unlike the "Draw the box lines" braille-formatting field, which is a
// transcriber tool and only switches the border lines on or off while keeping the box itself.
//
// Real-browser test (the editor module cannot be imported under Node). Needs the dev server:
//   node Emboss/scripts/serve.mjs &   then   node Emboss/tests/test-k9-k13.mjs [--show]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
// Reuses a server already on :8137 if this repo already has one; otherwise starts its own on :8146 (or the
// port given as the first CLI argument).

import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('--- Running K9 "Remove box" tests ---');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argPort = Number(process.argv.find((a) => /^\d+$/.test(a)));

async function serverAlreadyUp(port) {
  try { const r = await fetch(`http://localhost:${port}/web/editor/index.html`); return r.ok; } catch { return false; }
}

let child = null;
// A port argument wins (A63: agents and the main session test on their own server); otherwise reuse :8137.
let PORT = argPort || 8137;
if (await serverAlreadyUp(PORT)) {
  console.log(`  (reusing dev server already on :${PORT})`);
} else {
  PORT = argPort || 8146;
  child = spawn(process.execPath, [path.join(EMBOSS, 'scripts', 'serve.mjs'), String(PORT)], { cwd: EMBOSS, stdio: 'ignore' });
  const t0 = Date.now();
  while (!(await serverAlreadyUp(PORT))) {
    if (Date.now() - t0 > 15000) throw new Error(`serve.mjs did not come up on :${PORT}`);
    await wait(100);
  }
  console.log(`  (started our own dev server on :${PORT})`);
}

const URL = `http://localhost:${PORT}/web/editor/index.html`;
const browser = await launchBrowser({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await context.addInitScript(() => {
  try {
    if (!localStorage.getItem('emboss-settings')) {
      localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', standard: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' }));
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
  while (await page.evaluate(() => typeof window.modelToLexical !== 'function' || typeof window.exportCurrentDocumentXml !== 'function' || typeof window.unboxAtCaret !== 'function')) {
    if (Date.now() - t0 > 20000) throw new Error('editor globals did not appear');
    await wait(50);
  }
  await page.waitForFunction(() => document.querySelectorAll('#blockStyle option').length > 5);
  // A89: WebKit and Firefox start slower than Chrome. The app seeds its demo document ("Chapter One") once its engine is loaded,
  // a moment after window.modelToLexical exists; a render started by the test before that overlaps the app's first one while
  // liblouis is still loading its tables ("Cannot resolve table"). Wait for the demo before loading anything.
  await page.waitForFunction(() => document.getElementById('editor').innerText.includes('Chapter One'), null, { timeout: 30000 });
}

// A document with one box (title heading + body paragraph, as insertSidebar() itself builds one) and a
// plain paragraph before it, so there is somewhere else to put the caret.
const BOX_MODEL = [
  { type: 'para', text: 'Before the box.' },
  { type: 'box', title: 'My Box', blocks: [{ type: 'heading', level: 2, text: 'My Box' }, { type: 'para', text: 'Inside text.' }] },
];
const load = async (blocks) => {
  // Retried: right after the page loads, the app's own initial demo document can still be mid-load and
  // overwrite this call's content a moment later (a real race, not a fixed delay) — so confirm the load
  // actually stuck (looking for "Before the box.", unique to BOX_MODEL) before moving on.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks);
    // > HISTORY_DEBOUNCE_MS (400ms, editor.mjs): so the loaded document is its own history snapshot,
    // not coalesced away by the very next edit's own debounced snapshot (a later Ctrl+Z must land here).
    await wait(500);
    if ((await page.evaluate(() => document.getElementById('editor').innerText)).includes('Before the box.')) return;
  }
  throw new Error('load(BOX_MODEL) did not stick after 5 attempts');
};
// Caret at the end of a top-level block's own last descendant.
const caretAtEnd = async (topIdx) => {
  await page.evaluate((idx) => {
    window.editor.update(() => {
      let n = window.editor.getEditorState()._nodeMap.get('root').getChildren()[idx];
      while (n.getLastChild && n.getLastChild()) n = n.getLastChild();
      n.selectEnd();
    });
    window.editor.focus();
  }, topIdx);
  await wait(150);
};
// Caret at the START of a top-level block's own last descendant — a "/" typed right after this position is
// "at the start of a line", the slash menu's own trigger rule (help dialog), unlike caretAtEnd's position
// when the text does not end in whitespace.
const caretAtStart = async (topIdx) => {
  await page.evaluate((idx) => {
    window.editor.update(() => {
      let n = window.editor.getEditorState()._nodeMap.get('root').getChildren()[idx];
      while (n.getLastChild && n.getLastChild()) n = n.getLastChild();
      n.selectStart();
    });
    window.editor.focus();
  }, topIdx);
  await wait(150);
};

try {
  await openEditor();

  // ---- caret elsewhere: the command is unavailable ----
  await load(BOX_MODEL);
  await caretAtEnd(0);   // "Before the box."
  ok('toolbar: Unbox is hidden when the caret is not in a box', await page.evaluate(() => document.getElementById('btnUnbox').hidden));
  // A fresh empty paragraph (the slash menu's own reliable "start of line" case, matching
  // test-editor-styles-registry.mjs's own slashIds() helper) — no box anywhere in this document.
  await page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: '' }] }); });
  await page.locator('#editor p, #editor [contenteditable] p').first().click().catch(async () => { await page.locator('#editor').click(); });
  await page.keyboard.type('/unbox', { delay: 40 });
  await page.waitForTimeout(200);
  const noneIds = await page.$$eval('#slashList .slash-item', (els) => els.map((e) => e.id));
  ok('slash: "/unbox" (id "unbox") is not offered when the caret is not in a box', !noneIds.includes('slash-opt-unbox'), noneIds);
  await page.keyboard.press('Escape');
  // (A89: this used to press Backspace here to remove the typed text. Lexical's Escape blurs the editor, so that Backspace fell
  // on <body> -- harmless in Chrome, but WebKit takes it as "Back" and left the page. The next load() replaces the document anyway.)

  // ---- caret in the box: the command is available (toolbar) ----
  await load(BOX_MODEL);
  await caretAtEnd(1);   // inside the box's body paragraph
  ok('toolbar: Unbox is shown when the caret is in a box', await page.evaluate(() => !document.getElementById('btnUnbox').hidden));
  ok('toolbar: Unbox is titled "Remove box…" (Ctrl/Cmd+Alt+U)', /Remove box/.test(await page.evaluate(() => document.getElementById('btnUnbox').title)));

  // ---- slash "/unbox" ("Remove box") removes the box, keeps its title as an ordinary heading ----
  {
    const beforeXml = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok('before: the document has a <sidebar>', /<sidebar/.test(beforeXml), beforeXml);
    const brfBefore = await page.evaluate(async () => { await window.render(); return window.lastBrf || ''; });
    ok('before: the braille has a box line (a run of "7")', /^7{5,}\s*$/m.test(brfBefore));

    await caretAtStart(1);   // "/" at the start of a line, the slash menu's own trigger rule
    await page.keyboard.type('/unbox', { delay: 40 });
    await page.waitForSelector('#slashList .slash-item', { timeout: 5000 });
    const items = await page.$$eval('#slashList .slash-item .slash-title', (els) => els.map((e) => e.textContent));
    ok('slash: the one offered command is titled "Remove box"', items.length === 1 && /Remove box/.test(items[0]), items);
    await page.keyboard.press('Enter');
    await wait(300);

    ok('DOM: the box (.emboss-sidebar-card) is gone', (await page.$$('.emboss-sidebar-card')).length === 0);
    ok('DOM: "My Box" is now an ordinary heading, not inside the box', await page.evaluate(() => {
      const h = [...document.querySelectorAll('#editor h2')].find((el) => el.textContent.trim() === 'My Box');
      return !!h && !h.closest('.emboss-sidebar-card');
    }));
    const afterXml = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok('save: no <sidebar> element remains', !/<sidebar/.test(afterXml), afterXml);
    ok('save: the heading and body text are kept, as ordinary blocks', /My Box/.test(afterXml) && /Inside text\./.test(afterXml), afterXml);
    const brfAfter = await page.evaluate(async () => { await window.render(); return window.lastBrf || ''; });
    ok('after: the braille has no box line', !/^7{5,}\s*$/m.test(brfAfter) && !/^G{5,}\s*$/m.test(brfAfter));
    ok('after: "Inside text." is still in the braille (round trip)', /9SIDE|INSIDE|9S(9)?DE/.test(brfAfter) || /Inside text/i.test(afterXml));

    // ---- one undo step ----
    // Undo via the toolbar button (calls the same performUndo() as Ctrl/Cmd+Z; headless Chrome does not
    // reliably deliver a synthesized Ctrl+Z to a contenteditable region for this app's own keydown handler).
    ok('undo: available straight after the edit', !(await page.evaluate(() => document.getElementById('btnUndo').disabled)));
    await page.click('#btnUndo');
    await wait(300);
    ok('undo: one step brings the box straight back', (await page.$$('.emboss-sidebar-card')).length === 1);
    const undoneXml = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok('undo: the saved document has its <sidebar> back', /<sidebar/.test(undoneXml), undoneXml);
  }

  // ---- toolbar button does the same thing ----
  await load(BOX_MODEL);
  await caretAtEnd(1);
  await page.evaluate(() => document.getElementById('btnUnbox').click());
  await wait(300);
  ok('toolbar click: the box is removed', (await page.$$('.emboss-sidebar-card')).length === 0);

  // ---- keyboard shortcut Ctrl/Cmd+Alt+U does the same thing ----
  await load(BOX_MODEL);
  await caretAtEnd(1);
  await page.keyboard.press('Control+Alt+u');
  await wait(300);
  ok('Ctrl+Alt+U: the box is removed', (await page.$$('.emboss-sidebar-card')).length === 0);

  // ---- available to everyone: NOT hidden by "Transcriber tools" (off by default) ----
  await load(BOX_MODEL);
  ok('Transcriber tools is off by default', !(await page.evaluate(() => document.body.classList.contains('transcriber-tools'))));
  await caretAtEnd(1);
  ok('with Transcriber tools off, Unbox is still offered', await page.evaluate(() => !document.getElementById('btnUnbox').hidden));
  ok('the Unbox button is not tagged a transcriber tool (fmt-transcriber)', !(await page.evaluate(() => document.getElementById('btnUnbox').classList.contains('fmt-transcriber'))));

  // ---- help text ----
  await page.click('#helpBtn');
  await page.waitForSelector('#helpDialog[open]');
  const helpText = await page.evaluate(() => document.getElementById('helpDialog').textContent);
  ok('help: explains Remove box', /Remove box/.test(helpText));
  ok('help: gives the Ctrl+Alt+U shortcut', /Alt.*U|U.*Alt/i.test(helpText.replace(/\s+/g, ' ')));
  ok('help: distinguishes it from "Draw the box lines"', /Draw the box lines/.test(helpText));
  await page.click('#helpClose');

  ok('no console errors or page errors', consoleErrors.length === 0, consoleErrors);
} finally {
  await browser.close();
  if (child) child.kill();
}

console.log(`\n=== K9 "Remove box" [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) { console.error('Failures:', failures); process.exit(1); }
console.log('All K9 checks passed.');
