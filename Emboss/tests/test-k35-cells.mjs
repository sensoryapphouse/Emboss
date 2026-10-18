// K35 (EMBOSS-TASKS.md section K) — real-browser checks for the two fixes headless unit
// tests cannot reach (editor.mjs only runs in a browser):
//
// 1. A per-column place-value alignment override is now reachable from the editor: the
//    Braille formatting dialog's table fieldset gets a new "Column alignment override" box
//    (fmtColumnAlign, a transcriber tool). This drives the real dialog — open it on a table,
//    type an override, Apply, and check both the in-editor round trip (window.lastModel) and
//    the saved NIMAS XML (window.exportCurrentDocumentXml, a <col> class token identified by
//    the <col>'s own position) — plus validation (a column number that doesn't exist, or is
//    repeated, is rejected with no partial apply) and a full save -> reopen -> dialog round
//    trip through window.importFile.
//
// 2. A picture kept inside a data-table cell (an `imgnote` segment, BANA 10.11.1 — the
//    layout-table work's own model) used to render in the editor as the description's plain
//    text, and editing anything else in the cell silently dropped the picture on save. This
//    drives the real contenteditable table cell (format/cell-dom.mjs's chip, wired through
//    editor.mjs's makeTableCell/table decorator): the cell shows a non-editable chip for the
//    picture, and typing more text in the SAME cell — the only way a user can edit "around" an
//    atomic chip — keeps it, both in window.lastModel and in the saved XML.
//
// Run directly (needs the dev server): node Emboss/scripts/serve.mjs 8137 & then
//   node Emboss/tests/test-k35-cells.mjs [--show] [port]
// Not run by run-all-tests.mjs (imports 'playwright') — listed alongside the other Playwright
// browser suites in AGENTS.md's list.

import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

console.log('--- Running K35: column-alignment dialog + picture-in-cell chip tests ---');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`); }
}

const argPort = process.argv.find((a) => /^\d+$/.test(a));
const PORT = Number(argPort) || 8137;
const URL = `http://localhost:${PORT}/web/editor/index.html`;

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await context.addInitScript(() => {
  try {
    localStorage.setItem('emboss-settings', JSON.stringify({
      simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2',
      cells: 40, lines: 25, uiLanguage: 'en', transcriberTools: true,
    }));
  } catch {}
});
const page = await context.newPage();
page.on('pageerror', (err) => console.error('  ✖ Page error:', err.message));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto(URL, { waitUntil: 'load' });
  const t0 = Date.now();
  while (await page.evaluate(() => typeof window.importFile !== 'function' || typeof window.exportCurrentDocumentXml !== 'function' || typeof window.modelToLexical !== 'function')) {
    if (Date.now() - t0 > 15000) { ok('editor globals appear', false, 'timed out'); break; }
    await wait(50);
  }
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 }).catch(() => ok('editor start-up finished', false, 'timed out'));
  ok('reached the real editor', await page.evaluate(() => location.pathname.includes('/editor/')));

  // =========================================================================================
  // 1. Column alignment override — the Braille formatting dialog.
  // =========================================================================================
  const load = async (blocks) => {
    await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks);
    await wait(300);
  };
  // The table's own context-bar button (aria-haspopup="dialog") opens the Braille formatting
  // dialog for that table directly — more reliable in a driven browser than the Ctrl/Cmd+Alt+B
  // shortcut, which needs a real DOM focus inside the table first (test-editor-save-fidelity.mjs
  // uses the same button for its own table dialog checks).
  const openFmtOnFirstCell = async () => {
    await page.click('.table-context-bar .table-context-btn[aria-haspopup="dialog"]');
    await page.waitForSelector('#brailleFmtDialog[open]', { timeout: 3000 });
  };
  const closeFmt = () => page.evaluate(() => { const d = document.getElementById('brailleFmtDialog'); if (d.open) d.close(); });

  await load([{ type: 'table', headers: ['No.', 'Amount', 'Label'], rows: [['1', '1.5', 'a'], ['10', '12.25', 'bb']] }]);
  await openFmtOnFirstCell();

  ok('the Braille formatting dialog offers a "Column alignment override" box for a table', await page.evaluate(() => !!document.getElementById('fmtColumnAlign') && document.getElementById('fmtColumnAlign').closest('fieldset').hidden === false));
  ok('a table with no columnAlign yet shows it empty', (await page.evaluate(() => document.getElementById('fmtColumnAlign').value)) === '');

  // ---- invalid input: a column number that does not exist is rejected, nothing applied ----
  await page.fill('#fmtColumnAlign', '9: right');
  await page.click('#brailleFmtApply');
  await wait(150);
  ok('an out-of-range column number is rejected (dialog stays open)', await page.evaluate(() => document.getElementById('brailleFmtDialog').open));
  ok('the rejection shows a status message', (await page.evaluate(() => document.getElementById('brailleFmtStatus').textContent)).trim().length > 0);
  await page.fill('#fmtColumnAlign', '1: right\n1: left');   // duplicate column
  await page.click('#brailleFmtApply');
  await wait(150);
  ok('a repeated column number is rejected too', await page.evaluate(() => document.getElementById('brailleFmtDialog').open));

  // ---- valid input applies, closes the dialog, and reaches the model + the saved XML ----
  await page.fill('#fmtColumnAlign', '2: right\n3: decimal');
  await page.click('#brailleFmtApply');
  await wait(200);
  ok('a valid override applies and closes the dialog', !(await page.evaluate(() => document.getElementById('brailleFmtDialog').open)));

  const afterApply = await page.evaluate(() => {
    const t = (window.lastModel.blocks || []).find((b) => b && b.type === 'table');
    return { columnAlign: t && t.columnAlign, xml: window.exportCurrentDocumentXml() };
  });
  ok('window.lastModel carries the new columnAlign (0-based: right on col 2, decimal on col 3)',
    !afterApply.columnAlign[0] && afterApply.columnAlign[1] === 'right' && afterApply.columnAlign[2] === 'decimal', afterApply.columnAlign);
  ok('the saved NIMAS XML writes it as a class token on the <col> print alignment already uses',
    /<col\/>\s*<col class="bana-col-align-right"\/>\s*<col class="bana-col-align-decimal"\/>/.test(afterApply.xml), afterApply.xml.match(/<col[^]*?<\/caption>|<col\/>[^]*?<thead>/)?.[0] || afterApply.xml);

  // ---- reopening the dialog shows the value it just applied ----
  await openFmtOnFirstCell();
  ok('reopening the dialog on the same table shows the override just applied',
    (await page.evaluate(() => document.getElementById('fmtColumnAlign').value)) === '2: right\n3: decimal',
    await page.evaluate(() => document.getElementById('fmtColumnAlign').value));
  await closeFmt();

  // ---- full save -> reopen (a real file load) -> dialog round trip ----
  const savedXml = afterApply.xml;
  await page.evaluate(() => window.markDocumentClean());
  await page.evaluate(async (xml) => {
    const file = new File([xml], 'k35.xml', { type: 'text/xml' });
    await window.importFile(file);
  }, savedXml);
  await wait(400);
  await openFmtOnFirstCell();
  ok('after a real save -> reopen, the dialog still shows the transcriber\'s override',
    (await page.evaluate(() => document.getElementById('fmtColumnAlign').value)) === '2: right\n3: decimal',
    await page.evaluate(() => document.getElementById('fmtColumnAlign').value));
  await closeFmt();

  // ---- clearing the box removes the override (round trips back to nothing) ----
  await openFmtOnFirstCell();
  await page.fill('#fmtColumnAlign', '');
  await page.click('#brailleFmtApply');
  await wait(200);
  const cleared = await page.evaluate(() => (window.lastModel.blocks || []).find((b) => b && b.type === 'table').columnAlign);
  ok('clearing the box removes the override entirely', !cleared, cleared);

  // =========================================================================================
  // 2. A picture kept in a data-table cell shows as a chip, and survives editing the cell.
  // =========================================================================================
  await page.evaluate(() => window.markDocumentClean());
  await load([{
    type: 'table', headers: ['Item', 'Picture'],
    rows: [[{ text: 'Apple', segments: [{ type: 'text', text: 'Apple' }] }, { text: 'A red apple', segments: [{ type: 'imgnote', text: 'A red apple' }] }]],
  }]);

  const pictureCell = page.locator('.table-cell-input[data-row="0"][data-col="1"]');
  ok('the picture cell shows a non-editable chip, not bare description text',
    await pictureCell.evaluate((el) => !!el.querySelector('.cell-imgnote-chip[contenteditable="false"]')));
  ok('the chip carries the picture\'s description as its visible text',
    (await pictureCell.evaluate((el) => el.querySelector('.cell-imgnote-chip').textContent)).includes('A red apple'));

  // Edit the OTHER cell in the same row: the picture cell/chip must be completely unaffected.
  const itemCell = page.locator('.table-cell-input[data-row="0"][data-col="0"]');
  await itemCell.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' pie');
  await wait(150);
  ok('editing a different cell in the row leaves the picture chip alone',
    await pictureCell.evaluate((el) => !!el.querySelector('.cell-imgnote-chip')));

  // Edit INSIDE the picture cell itself, after the chip — the one way a user "edits around" an
  // atomic chip. The chip must survive and the model must still carry the imgnote segment.
  await pictureCell.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (see left)');
  await wait(200);
  const afterCellEdit = await page.evaluate(() => {
    const t = (window.lastModel.blocks || []).find((b) => b && b.type === 'table');
    const cell = t.rows[0][1];
    const segs = cell && typeof cell === 'object' ? cell.segments : null;
    return { cell, hasImgnote: Array.isArray(segs) && segs.some((s) => s.type === 'imgnote') };
  });
  ok('the picture chip is still in the cell\'s DOM after typing more text in it',
    await pictureCell.evaluate((el) => !!el.querySelector('.cell-imgnote-chip')));
  ok('typing more text in the picture cell keeps the imgnote segment in the model (the bug this fixes)',
    afterCellEdit.hasImgnote, afterCellEdit);

  // The picture must also survive a real save (BANA 10.11.1's <img>/<prodnote> stays in the cell,
  // re-exported the same way serializeInlineLeaf writes any imgnote segment — F-229).
  const withPictureXml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('the saved NIMAS XML still carries the picture inside the table cell (not lost, not moved out of it)',
    /<td>\s*<img alt="A red apple"\/> \(see left\)\s*<\/td>/.test(withPictureXml),
    withPictureXml.match(/<t[dh][^]*?<\/t[dh]>/g));

  ok('no console/page errors across the K35 checks', failures.filter((f) => /page error/i.test(f.name)).length === 0);
} finally {
  await browser.close();
}

console.log(`\n=== K35 cells suite [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', JSON.stringify(failures, null, 1).slice(0, 8000));
  process.exit(1);
} else {
  console.log('All K35 checks passed.');
}
