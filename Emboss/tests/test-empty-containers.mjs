// Paul's 26 Sep bug report: "If you delete all the text in a sidebar then the sidebar is not
// removed and in fact it seems to be impossible to delete it. This may also apply to other
// styles." Confirmed for the three container ElementNodes the editor has (SidebarNode/"box",
// TnPageNode/"tnpage", SymPageNode/"sympage") and traced to two separate defects in editor.mjs:
//
//  1. Triple-clicking (or dragging) to select "all the text" of the container's only paragraph is
//     a well-known contenteditable quirk: the browser's own selection actually extends to the very
//     START of the NEXT sibling paragraph, not just to the end of the container's own text.
//     Lexical's default Backspace/Delete has no notion that a box/page is a boundary, so it
//     deleted the selected text AND merged the following paragraph's content bodily INSIDE the
//     container — which then looked empty in the print pane but never actually was (it had
//     adopted its neighbour's text), so no further Backspace ever removed it. Fixed by a
//     KEY_BACKSPACE_COMMAND/KEY_DELETE_COMMAND handler (editor.mjs, registered above
//     registerRichText's own) that clamps such a selection to stay on one side of the boundary.
//  2. Once a container is genuinely emptied (by any path), nothing ever removed it: SidebarNode/
//     TnPageNode/SymPageNode have no canBeEmpty()/collapseAtStart() override, so Lexical's default
//     handling just leaves an empty container sitting in the document. Fixed by an update listener
//     (editor.mjs) that removes a container the instant it transitions from having real content to
//     having none (compared against prevEditorState, so a freshly-inserted still-empty page is
//     never touched), in the same undo step (tag 'history-merge').
//
// Usage: node Emboss/scripts/serve.mjs 8257 &   then   node Emboss/tests/test-empty-containers.mjs [port]
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
  // a moment after window.modelToLexical exists; a render started by the test before that overlaps the app's first one while
  // liblouis is still loading its tables ("Cannot resolve table"). Wait for the demo before loading anything.
  await page.waitForFunction(() => document.getElementById('editor').innerText.includes('Chapter One'), null, { timeout: 30000 });
}
// Retried the same way test-k9-k13.mjs's load() is: right after the page loads, the app's own
// initial demo document can still be mid-load and overwrite this call's content a moment later.
const load = async (blocks, marker) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks);
    await wait(500);   // > HISTORY_DEBOUNCE_MS so this load is its own history snapshot (a later Ctrl+Z lands here, not mid-edit)
    if ((await page.evaluate((m) => document.getElementById('editor').innerText, marker)).includes(marker)) return;
  }
  throw new Error('load() did not stick after 5 attempts, marker=' + marker);
};
const counts = () => page.evaluate(() => ({
  sidebar: document.querySelectorAll('.emboss-sidebar-card:not(.emboss-tnpage-card):not(.emboss-sympage-card)').length,
  tnpage: document.querySelectorAll('.emboss-tnpage-card').length,
  sympage: document.querySelectorAll('.emboss-sympage-card').length,
  text: document.getElementById('editor').innerText,
}));
const brf = () => page.evaluate(async () => { await window.render(); return window.lastBrf || ''; });
const clearAnnounce = () => page.evaluate(() => { const a = document.getElementById('announce'); if (a) a.textContent = ''; });
// announce() (editor.mjs) clears then re-sets on a ~30ms debounce, and a previous action's own
// announce can still be in flight when the next one starts -- poll instead of a fixed wait/read.
const waitForAnnounce = async (timeoutMs = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.evaluate(() => document.getElementById('announce')?.textContent || '');
    if (text) return text;
    await wait(50);
  }
  return '';
};

async function undo() {
  await page.click('#btnUndo');
  await wait(300);
}

const CONTAINERS = [
  {
    label: 'box',
    cardSel: '.emboss-sidebar-card',
    countKey: 'sidebar',
    model: (marker) => [
      { type: 'para', text: 'Before the box.' },
      { type: 'box', title: '', blocks: [{ type: 'para', text: marker }] },
      { type: 'para', text: 'After the box.' },
    ],
    announceRe: /box removed/i,
  },
  {
    label: 'tnpage',
    cardSel: '.emboss-tnpage-card',
    countKey: 'tnpage',
    model: (marker) => [
      { type: 'para', text: 'Before the tnpage.' },
      { type: 'tnpage', heading: '', entries: [{ text: marker }] },
      { type: 'para', text: 'After the tnpage.' },
    ],
    announceRe: /transcriber.s notes page removed/i,
  },
  {
    label: 'sympage',
    cardSel: '.emboss-sympage-card',
    countKey: 'sympage',
    // A sympage entry is { braille, print?, description? } ($fillSymPage/$symEntryOfParagraph,
    // editor.mjs) -- braille is the atomic BrlNode (the symbol itself), description is the
    // plain-text meaning that follows it. Not to be confused with the model's OWN sympage-block
    // shape used elsewhere (which nests entries the same way).
    model: (marker) => [
      { type: 'para', text: 'Before the sympage.' },
      { type: 'sympage', heading: '', auto: false, entries: [{ braille: '#', description: marker }] },
      { type: 'para', text: 'After the sympage.' },
    ],
    announceRe: /special symbols page removed/i,
  },
];

try {
  await openEditor();

  for (const c of CONTAINERS) {
    console.log(`\n--- ${c.label}: select all its text (triple-click), Backspace, then Backspace again ---`);
    const MARKER = 'Inside text.';
    await load(c.model(MARKER), 'Before the ' + c.label + '.');
    await page.locator(`${c.cardSel} p`).first().click({ clickCount: 3 });   // native "select this paragraph's text"
    await wait(100);
    await clearAnnounce();
    await page.keyboard.press('Backspace');
    await wait(250);
    const after1 = await counts();
    ok(`${c.label}: one Backspace over the selected text removes the container (not just its text)`, after1[c.countKey] === 0, after1);
    ok(`${c.label}: the surrounding paragraphs are kept, as two separate blocks (not merged into one)`,
      after1.text === `Before the ${c.label}.\n\nAfter the ${c.label}.`, after1.text);
    ok(`${c.label}: no stray content adopted from the following paragraph`, !after1.text.includes('After the ' + c.label + '.After'), after1.text);
    const a1 = await waitForAnnounce();
    ok(`${c.label}: announce() reports the removal`, c.announceRe.test(a1), a1);
    const brf1 = await brf();
    ok(`${c.label}: the braille pane has no leftover box/page border lines`, !/^[7G]{5,}\s*$/m.test(brf1), brf1);

    // A further Backspace, now that the container is already gone, must not error or do anything odd.
    await page.keyboard.press('Backspace');
    await wait(150);
    const after2 = await counts();
    ok(`${c.label}: a further Backspace afterwards is harmless (just edits the now-plain paragraph)`, after2[c.countKey] === 0, after2);

    console.log(`--- ${c.label}: undo restores the container AND its content in one step ---`);
    await undo();
    const afterUndo = await counts();
    ok(`${c.label}: one Ctrl/undo step brings the container back`, afterUndo[c.countKey] === 1, afterUndo);
    ok(`${c.label}: the undone container has its content back too`, afterUndo.text.includes(MARKER) || afterUndo.text.replace(/\s+/g, ' ').includes(MARKER), afterUndo.text);
  }

  for (const c of CONTAINERS) {
    console.log(`\n--- ${c.label}: caret in an ALREADY-EMPTY container, Backspace once removes it ---`);
    const EMPTY_MODEL = c.label === 'box'
      ? [{ type: 'para', text: 'Before the box.' }, { type: 'box', title: '', blocks: [{ type: 'para', text: '' }] }, { type: 'para', text: 'After the box.' }]
      : c.label === 'tnpage'
      ? [{ type: 'para', text: 'Before the tnpage.' }, { type: 'tnpage', heading: '', entries: [{ text: '' }] }, { type: 'para', text: 'After the tnpage.' }]
      : [{ type: 'para', text: 'Before the sympage.' }, { type: 'sympage', heading: '', auto: false, entries: [] }, { type: 'para', text: 'After the sympage.' }];
    await load(EMPTY_MODEL, 'Before the ' + c.label + '.');
    const loaded = await counts();
    ok(`${c.label}: the already-empty container loaded (still present, empty)`, loaded[c.countKey] === 1, loaded);
    // Place the caret inside the container's own (empty) paragraph via a real click, then Backspace.
    await page.locator(`${c.cardSel} p`).first().click();
    await page.keyboard.press('Backspace');
    await wait(250);
    const afterEmpty = await counts();
    ok(`${c.label}: Backspace in the empty container removes it`, afterEmpty[c.countKey] === 0, afterEmpty);
    ok(`${c.label}: the surrounding paragraph break is kept`, afterEmpty.text === `Before the ${c.label}.\n\nAfter the ${c.label}.`, afterEmpty.text);

    console.log(`--- ${c.label}: caret at the end of the block before it, Delete removes it ---`);
    await load(EMPTY_MODEL, 'Before the ' + c.label + '.');
    await page.locator('#editor p').first().click();
    await page.evaluate(() => {
      window.editor.update(() => {
        const p = window.editor.getEditorState()._nodeMap.get('root').getChildren()[0];
        p.selectEnd();
      });
      window.editor.focus();
    });
    await wait(100);
    await page.keyboard.press('Delete');
    await wait(250);
    const afterDelete = await counts();
    ok(`${c.label}: Delete from the end of the previous block removes the empty container`, afterDelete[c.countKey] === 0, afterDelete);
    ok(`${c.label}: the surrounding paragraph break is kept (Delete)`, afterDelete.text === `Before the ${c.label}.\n\nAfter the ${c.label}.`, afterDelete.text);
  }

  // ---- A container that still has real text is NOT silently emptied by this fix -- normal
  // in-container editing must go on working exactly as before. ----
  console.log('\n--- box: normal editing inside a non-empty box is unaffected ---');
  await load(CONTAINERS[0].model('Inside text.'), 'Before the box.');
  await page.locator('.emboss-sidebar-card p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More.');
  await wait(200);
  const edited = await counts();
  ok('box: typing inside a non-empty box just edits it (box stays)', edited.sidebar === 1 && edited.text.includes('Inside text. More.'), edited);

  // ---- Sanity: an ordinary (non-container) paragraph delete across two plain paragraphs still
  // works the normal way -- the boundary-clamp must never fire outside a container. ----
  console.log('\n--- sanity: plain paragraph-to-paragraph merge (no container involved) is untouched ---');
  await load([{ type: 'para', text: 'Alpha.' }, { type: 'para', text: 'Beta.' }], 'Alpha.');
  await page.locator('#editor p').first().click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await wait(200);
  const plainMerge = await page.evaluate(() => document.getElementById('editor').innerText);
  ok('sanity: selecting one plain paragraph and Backspace still merges normally (Lexical default, untouched)', plainMerge === 'Beta.' || plainMerge === '.Beta.' || /Beta\.$/.test(plainMerge), plainMerge);

  ok('no console errors or page errors', consoleErrors.length === 0, consoleErrors);
} finally {
  await browser.close();
}

console.log(`\n=== Empty containers [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) { console.error('Failures:', failures); process.exit(1); }
console.log('All empty-container checks passed.');
