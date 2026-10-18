// EMBOSS-TASKS A69: a single Delete at the end of the block before a table (or Backspace at the
// start of the block after it) deleted the whole table -- cell content included -- with no
// confirmation. TableNode is a Lexical DecoratorNode; Lexical's own default Backspace/Delete next
// to a decorator whose caret is directly adjacent (LexicalSelection.ts's $deleteCharacter,
// the SiblingCaret/$isDecoratorNode branch) just calls `caret.origin.remove()` -- there is no
// "select first" safety net for a decorator hit this way (the safety net that IS built in,
// converting the RangeSelection into a NodeSelection instead of deleting, only fires when a
// separate ElementNode sibling was traversed first -- state.type === 'merge-next-block' -- which
// direct paragraph/table adjacency never is). The same risk applies to every other content-bearing
// DecoratorNode: ImageNode (a print picture), GraphicNode (a tactile diagram) and MathNode (an
// equation, when the caret is in adjacent text rather than inside the math-field itself).
//
// Fixed in editor.mjs by extending the KEY_BACKSPACE_COMMAND/KEY_DELETE_COMMAND handler that
// already exists for the box/tnpage/sympage container boundary (registered at
// COMMAND_PRIORITY_HIGH, above registerRichText's own): a collapsed caret sitting at the boundary
// next to one of these decorators is now turned into a NodeSelection on the decorator (Lexical's
// own "selected object" pattern) instead of removing it outright, with an announce() telling a
// screen-reader user what happened. A second Backspace/Delete, now that the decorator is already
// NodeSelection'd, falls through to registerRichText's own DELETE_CHARACTER_COMMAND handler,
// which already calls `selection.deleteNodes()` for a NodeSelection -- so the second-press-deletes
// half of this needed no new code, only letting Lexical's own existing path run unobstructed.
//
// BrlNode (a literal-braille "chip") is a TextNode in Lexical 'token' mode, not a DecoratorNode:
// token mode already makes Lexical delete the whole chip in one keystroke without touching
// anything around it (LexicalSelection.ts's own token-node handling) -- exactly the "small inline
// item deletes like a character" behaviour the brief says is normal, so it is exercised here for
// documentation but not changed.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-decorator-delete.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/web/editor/index.html`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
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
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) consoleErrors.push(`console: ${m.text()}`); });

async function openEditor() {
  await page.goto(URL, { waitUntil: 'load' });
  const t0 = Date.now();
  while (await page.evaluate(() => typeof window.modelToLexical !== 'function' || typeof window.exportCurrentDocumentXml !== 'function')) {
    if (Date.now() - t0 > 20000) throw new Error('editor globals did not appear');
    await wait(50);
  }
  await page.waitForFunction(() => document.querySelectorAll('#blockStyle option').length > 5);
  // A89: WebKit and Firefox start slower than Chrome. The app seeds its demo document ("Chapter One") once its engine is loaded,
  // a moment after window.modelToLexical exists, and its first render then overlaps a render started by the test (liblouis
  // "lou_translateString failed"). Wait for the demo before loading anything.
  await page.waitForFunction(() => document.getElementById('editor').innerText.includes('Chapter One'), null, { timeout: 30000 });
}
// Same retry as test-empty-containers.mjs's load(): the app's own initial demo document can still
// be mid-load right after the page loads and overwrite this call's content a moment later.
const load = async (blocks, marker) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks);
    await wait(500);   // > HISTORY_DEBOUNCE_MS so this load is its own history snapshot
    if ((await page.evaluate((m) => document.getElementById('editor').innerText, marker)).includes(marker)) return;
  }
  throw new Error('load() did not stick after 5 attempts, marker=' + marker);
};
const clearAnnounce = () => page.evaluate(() => { const a = document.getElementById('announce'); if (a) a.textContent = ''; });
const waitForAnnounce = async (timeoutMs = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.evaluate(() => document.getElementById('announce')?.textContent || '');
    if (text) return text;
    await wait(50);
  }
  return '';
};
const count = (sel) => page.locator(sel).count();
const editorText = () => page.evaluate(() => document.getElementById('editor').innerText);
async function undo() { await page.click('#btnUndo'); await wait(300); }

// Places the caret at the very end of the FIRST top-level paragraph (index 0) or the very start of
// the LAST top-level paragraph, the same programmatic way test-empty-containers.mjs does it --
// robust against the decorator's own contenteditable=false / custom-element internals swallowing a
// plain mouse click.
async function caretAtEndOfFirstBlock() {
  await page.evaluate(() => {
    window.editor.update(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      root.getChildren()[0].selectEnd();
    });
    window.editor.focus();
  });
  await wait(100);
}
async function caretAtStartOfLastBlock() {
  await page.evaluate(() => {
    window.editor.update(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      const kids = root.getChildren();
      kids[kids.length - 1].selectStart();
    });
    window.editor.focus();
  });
  await wait(100);
}

const DECORATORS = [
  {
    label: 'table',
    cardSel: '.doc-table-block',
    contentMarker: 'CellMarker',
    model: (marker) => [
      { type: 'para', text: 'Before the table.' },
      { type: 'table', headers: ['H1', 'H2'], rows: [[marker, 'B1']] },
      { type: 'para', text: 'After the table.' },
    ],
    announceRe: /table.*selected.*delete again/i,
  },
  {
    label: 'image',
    cardSel: '.doc-image-block',
    contentMarker: 'ImageAltMarker',
    model: (marker) => [
      { type: 'para', text: 'Before the image.' },
      { type: 'graphic', src: 'not-a-real-src.png', alt: marker },
      { type: 'para', text: 'After the image.' },
    ],
    announceRe: /picture.*selected.*delete again/i,
  },
  {
    label: 'graphic',
    cardSel: '.doc-graphic-block',
    contentMarker: null,   // the SVG itself has no visible text marker; presence/absence of the card is the check
    model: () => [
      { type: 'para', text: 'Before the graphic.' },
      { type: 'graphic', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>', alt: 'GraphicMarkerAlt' },
      { type: 'para', text: 'After the graphic.' },
    ],
    announceRe: /diagram.*selected.*delete again/i,
  },
  {
    label: 'equation',
    cardSel: '.math-embed',
    contentMarker: null,   // MathLive owns the field's shadow DOM; presence/absence of the card is the check
    model: () => [
      { type: 'para', text: 'Before the equation.' },
      { type: 'math', latex: 'x^2+y^2' },
      { type: 'para', text: 'After the equation.' },
    ],
    announceRe: /equation.*selected.*delete again/i,
  },
  {
    // Added in review: a print-page marker drives the braille print page numbers, so losing one
    // silently renumbers every later print page.
    label: 'print page',
    cardSel: '.doc-print-page',
    contentMarker: null,
    model: () => [
      { type: 'para', text: 'Before the print page.' },
      { type: 'pagenum', page: '12' },
      { type: 'para', text: 'After the print page.' },
    ],
    announceRe: /print page.*selected.*delete again/i,
  },
];

try {
  await openEditor();

  for (const d of DECORATORS) {
    console.log(`\n--- ${d.label}: Delete at the end of the block BEFORE it ---`);
    const MARKER = d.contentMarker || '';
    await load(d.model(MARKER), 'Before the ' + d.label + '.');
    ok(`${d.label}: loaded (present once)`, await count(d.cardSel) === 1);

    await caretAtEndOfFirstBlock();
    await clearAnnounce();
    await page.keyboard.press('Delete');
    await wait(250);
    ok(`${d.label}: first Delete does NOT remove it`, await count(d.cardSel) === 1, await editorText());
    const a1 = await waitForAnnounce();
    ok(`${d.label}: announce() reports it is selected, second press removes it`, d.announceRe.test(a1), a1);

    await page.keyboard.press('Delete');
    await wait(250);
    ok(`${d.label}: second Delete removes it`, await count(d.cardSel) === 0, await editorText());
    const afterText = await editorText();
    ok(`${d.label}: the surrounding paragraphs are kept as two separate blocks`,
      afterText === `Before the ${d.label}.\n\nAfter the ${d.label}.`, afterText);

    console.log(`--- ${d.label}: undo restores it (and its content) in one step ---`);
    await undo();
    ok(`${d.label}: one undo brings it back`, await count(d.cardSel) === 1, await editorText());
    if (MARKER) {
      // Since 1 Oct 2026 (feedback item 8) a picture's description is in an editable box on its card, whose value is not part of
      // the editor's text — so the boxes' values are read as well.
      const restoredText = (await editorText()) + ' ' + (await page.evaluate(() => [...document.querySelectorAll('#editor textarea')].map((t) => t.value).join(' ')));
      ok(`${d.label}: the undone ${d.label} has its content back too`, restoredText.includes(MARKER), restoredText);
    }

    console.log(`\n--- ${d.label}: Backspace at the start of the block AFTER it ---`);
    await load(d.model(MARKER), 'Before the ' + d.label + '.');
    ok(`${d.label}: reloaded (present once)`, await count(d.cardSel) === 1);

    await caretAtStartOfLastBlock();
    await clearAnnounce();
    await page.keyboard.press('Backspace');
    await wait(250);
    ok(`${d.label}: first Backspace does NOT remove it`, await count(d.cardSel) === 1, await editorText());
    const a2 = await waitForAnnounce();
    ok(`${d.label}: announce() reports it is selected (Backspace direction)`, d.announceRe.test(a2), a2);

    await page.keyboard.press('Backspace');
    await wait(250);
    ok(`${d.label}: second Backspace removes it`, await count(d.cardSel) === 0, await editorText());

    console.log(`--- ${d.label}: undo (Backspace path) restores it too ---`);
    await undo();
    ok(`${d.label}: one undo brings it back (Backspace path)`, await count(d.cardSel) === 1, await editorText());
  }

  // ---- BrlNode ("literal braille" chip): a small inline TextNode in 'token' mode. Per the brief,
  // a small inline item deleting on one keypress like a character is normal -- this documents that
  // it behaves that way (and is unaffected by the fix above, since it is not a DecoratorNode). ----
  console.log('\n--- brl chip: a small inline literal-braille token deletes in one keypress (normal, unchanged) ---');
  await load([{ type: 'para', segments: [{ text: 'Before ' }, { type: 'brl', text: '#a', brl: '#a' }, { text: ' after.' }] }], 'Before');
  ok('brl chip: loaded', (await editorText()).includes('#a'));
  // Caret right after the chip (end of the paragraph's second text run would be simplest, but the
  // chip is the interesting boundary): select the whole paragraph's end, then step Backspace once
  // -- token-mode text nodes are removed as a whole unit by ONE Backspace when the caret is
  // immediately after them, same as any other 'token' node in Lexical.
  await page.evaluate(() => {
    window.editor.update(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      const p = root.getChildren()[0];
      const kids = p.getChildren();
      const brl = kids.find((n) => typeof n.getBrl === 'function');
      if (brl) brl.selectNext(0, 0);   // caret placed just after the chip
    });
    window.editor.focus();
  });
  await wait(100);
  await page.keyboard.press('Backspace');
  await wait(200);
  const afterBrl = await editorText();
  ok('brl chip: one Backspace removes the whole chip (token mode), not just one braille cell', !afterBrl.includes('#a') && afterBrl.includes('Before') && afterBrl.includes('after.'), afterBrl);

  // ---- Sanity: normal in-block editing elsewhere is unaffected (no false-positive arming). ----
  console.log('\n--- sanity: plain paragraph-to-paragraph Backspace is untouched by the decorator-arming logic ---');
  await load([{ type: 'para', text: 'Alpha.' }, { type: 'para', text: 'Beta.' }], 'Alpha.');
  await page.locator('#editor p').first().click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await wait(200);
  const plainMerge = await editorText();
  ok('sanity: two plain paragraphs still merge normally (Lexical default, untouched)', plainMerge === 'Beta.' || plainMerge === '.Beta.' || /Beta\.$/.test(plainMerge), plainMerge);

  console.log('\n--- sanity: a table with real content is not removed if the caret is not actually at the boundary ---');
  await load([{ type: 'para', text: 'Before the table. More text.' }, { type: 'table', headers: ['H'], rows: [['X']] }, { type: 'para', text: 'After.' }], 'Before the table.');
  // Put the caret mid-text directly (a mouse click can land before the editor registers it on a
  // loaded machine, leaving the arrow keys to act on a stale selection).
  await page.evaluate(() => {
    window.editor.update(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      const text = root.getChildren()[0].getFirstChild();
      text.select(1, 1);   // after the "B"
    });
    window.editor.focus();
  });
  await wait(100);
  await clearAnnounce();
  await page.keyboard.press('Delete');
  await wait(200);
  ok('sanity: Delete mid-paragraph just edits text, table untouched', await count('.doc-table-block') === 1 && (await editorText()).startsWith('Bfore'), await editorText());

  // Found in review (26 Sep): a table selected some other way than by the first Delete (here the
  // editor's own node selection, as the arrow keys make) must still take two presses, announced.
  console.log('\n--- a table selected another way (arrow keys / click) still needs an announced first press ---');
  await load([{ type: 'para', text: 'Before the table.' }, { type: 'table', headers: ['H'], rows: [['X']] }, { type: 'para', text: 'After.' }], 'Before the table.');
  await page.evaluate(() => {
    window.editor.update(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      const table = root.getChildren()[1];
      const sel = window.__createNodeSelectionForTest ? window.__createNodeSelectionForTest() : null;
      if (sel) { sel.add(table.getKey()); window.__setSelectionForTest(sel); }
    });
    window.editor.focus();
  });
  await wait(100);
  await clearAnnounce();
  await page.keyboard.press('Delete');
  await wait(250);
  ok('selected-by-other-means table: the first Delete does NOT remove it', await count('.doc-table-block') === 1, await editorText());
  ok('selected-by-other-means table: the first Delete announces it', /table.*selected.*delete again/i.test(await waitForAnnounce()));
  await page.keyboard.press('Delete');
  await wait(250);
  ok('selected-by-other-means table: the second Delete removes it', await count('.doc-table-block') === 0, await editorText());

  // Found in real Chrome (28 Sep): (1) a screen-reader user waits for the announcement, and by then Chrome had turned
  // the table's selection back into the caret, so the second press was treated as a first; (2) a click elsewhere while
  // armed left the editor with no caret, so the next key acted at the start of the document. The first press now
  // leaves the caret where it is and outlines the table; a second press from that same caret deletes it, and any
  // other click or key cancels. Lexical's caret can also lag a very quick key or click, so these presses are sent
  // without pauses too.
  const TABLE_MODEL = [{ type: 'para', text: 'Before the table.' }, { type: 'table', headers: ['H'], rows: [['X']] }, { type: 'para', text: 'After.' }];
  const armState = () => page.evaluate(() => ({ key: window.__armStateForTest ? window.__armStateForTest().key : null, outlined: document.querySelectorAll('.emboss-armed').length }));
  const lastParagraph = () => page.locator('#editor > p').last();
  const LINE_START = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home';   // Home does not move the caret in Chrome on a Mac

  console.log('\n--- armed table: outline shown, a pause before the second press, then Undo ---');
  await load(TABLE_MODEL, 'Before the table.');
  await caretAtEndOfFirstBlock();
  await page.keyboard.press('Delete');
  await wait(250);
  const armed1 = await armState();
  ok('armed: the table is outlined', armed1.key != null && armed1.outlined === 1, armed1);
  await wait(1500);
  await page.keyboard.press('Delete');
  await wait(250);
  ok('armed: the second press after a pause still removes it', await count('.doc-table-block') === 0, await editorText());
  ok('armed: the outline is gone once it is removed', (await armState()).outlined === 0);
  await undo();
  ok('armed: one undo brings it back', await count('.doc-table-block') === 1, await editorText());

  console.log('\n--- armed table: a click elsewhere cancels, and the next key edits where the click was ---');
  await load(TABLE_MODEL, 'Before the table.');
  await caretAtEndOfFirstBlock();
  await page.keyboard.press('Delete');
  await wait(250);
  await lastParagraph().click();
  await wait(250);
  ok('click-cancel: the outline is gone', (await armState()).outlined === 0);
  await page.keyboard.press(LINE_START);
  await page.keyboard.press('Delete');
  await wait(250);
  const afterClick = await editorText();
  ok('click-cancel: the table is kept', await count('.doc-table-block') === 1, afterClick);
  ok('click-cancel: Delete edited the clicked paragraph, not the start of the document', afterClick.startsWith('Before the table.') && /\bfter\.$/.test(afterClick) && !afterClick.includes('After.'), afterClick);

  console.log('\n--- quick keys: a click then Home and Delete with no pause ---');
  await load(TABLE_MODEL, 'Before the table.');
  await caretAtEndOfFirstBlock();
  await page.keyboard.press('Delete');
  await wait(250);
  await lastParagraph().click();
  await page.keyboard.press(LINE_START);
  await page.keyboard.press('Delete');
  await wait(250);
  const afterQuick = await editorText();
  ok('quick click-cancel: the table is kept', await count('.doc-table-block') === 1, afterQuick);
  ok('quick click-cancel: Delete edited the clicked paragraph', /\bfter\.$/.test(afterQuick) && !afterQuick.includes('After.'), afterQuick);

  console.log('\n--- quick keys: Home then Backspace with no pause arms, a second Backspace removes ---');
  await load(TABLE_MODEL, 'Before the table.');
  await page.evaluate(() => {
    window.editor.update(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      root.getChildren()[2].getFirstChild().select(3, 3);   // mid-text in "After."
    });
    window.editor.focus();
  });
  await wait(100);
  await page.keyboard.press(LINE_START);
  await page.keyboard.press('Backspace');
  await wait(250);
  ok('quick Home+Backspace: the first press arms (table kept, outlined)', await count('.doc-table-block') === 1 && (await armState()).outlined === 1, await editorText());
  await page.keyboard.press('Backspace');
  await wait(250);
  ok('quick Home+Backspace: the second press removes it', await count('.doc-table-block') === 0, await editorText());

  ok('no console errors or page errors', consoleErrors.length === 0, consoleErrors);
} finally {
  await browser.close();
}

console.log(`\n=== Decorator delete [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) { console.error('Failures:', failures); process.exit(1); }
console.log('All decorator-delete checks passed.');
