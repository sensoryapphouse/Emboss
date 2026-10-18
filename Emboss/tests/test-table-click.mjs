// Table click-to-link regression suite (Paul, 25 Sep 2026): "Clicking in tables doesn't work
// very well — it should just highlight the clicked entry." Drives the real editor exactly as
// test-editor-save-fidelity.mjs does (window.importFile, the real DOM, real clicks) and checks
// that clicking a print table cell highlights exactly that cell's braille entry (not the whole
// row/table/page), and clicking a braille entry highlights exactly the matching print cell and
// places the caret there — across every table layout Emboss can produce (tableFormat: auto,
// listed, columnar, vertical, interchange, stairstep, linear).
//
// Three bugs were found and fixed in Emboss/web/editor/editor.mjs (no document.mjs / braille
// output change — format/test-corpus.mjs stays byte-identical):
//  1. The generic print-pane click handler (`editorEl.addEventListener('click', ...)`) had no
//     table-cell awareness: resolveBlockUnit() falls through to unit 0 / the whole table's
//     container for any click inside a table cell, so it fired AFTER the table cell's own
//     correct pointerup/focus handling and clobbered it — every click ended up highlighting the
//     table's first cell, with the caret jumping there too. Fixed by skipping this handler when
//     the click target is inside a `.table-cell-input` (matching the isTableCellEl guard that
//     syncCaretWithBraille/describeCaretWord already had).
//  2. clearWordLink() cleared a stale table-cell highlight with `input.table-cell-hl`, but a
//     table cell is a contenteditable <div>, not an <input> (G15) — the selector never matched,
//     so old highlights were never removed and piled up across clicks ("stuck" highlight).
//  3. linkByBlock() painted '.brl-linked'/'.print-linked' over every row of the WHOLE block —
//     fine for a short paragraph, but a table can be dozens of rows or several pages, so any
//     click inside it washed the entire table in the "linked" tint. Skipped for table blocks;
//     the per-cell highlight already shows the clicked entry precisely.
//  4. highlightWord()'s braille -> print path calls pe.focus() to place the caret in the target
//     cell; that div's own 'focus' listener re-entered handleTableCellEvent and repainted the
//     highlight for word-at-caret-0 (nothing has been clicked yet at that point), clobbering the
//     correct braille-triggered highlight. Fixed with a small re-entrancy guard.
//
// Run directly (needs the dev server): node Emboss/scripts/serve.mjs 8137 & then
//   node Emboss/tests/test-table-click.mjs [--show]
// Not run by run-all-tests.mjs (imports 'playwright') — list it alongside the other Playwright
// browser suites in AGENTS.md's list.

import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);   // A63: a port argument, for agents on their own dev server

console.log('--- Running table click-to-link regression suite ---');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ok    ${name}`);
  } else {
    failures.push({ name, detail });
    console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`);
  }
}

const XML = readFileSync(path.join(HERE, 'nimas_samples', 'TablesTestXml.xml'), 'utf8');

const browser = await launchBrowser({ args: ['--no-sandbox'] });

async function openWithFormat(tableFormat) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript((tf) => {
    try {
      localStorage.setItem('emboss-settings', JSON.stringify({
        simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2',
        cells: 40, lines: 25, uiLanguage: 'en', transcriberTools: true,
        tableFormat: tf,
      }));
    } catch {}
  }, tableFormat);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  const t0 = Date.now();
  while (await page.evaluate(() => typeof window.importFile !== 'function')) {
    if (Date.now() - t0 > 15000) throw new Error('importFile never appeared');
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  await page.evaluate(async (xmlText) => {
    const file = new File([xmlText], 'TablesTestXml.xml', { type: 'text/xml' });
    await window.importFile(file);
  }, XML);
  await page.waitForTimeout(600);
  return { context, page, pageErrors };
}

// Every table block Emboss actually rendered, with its DOM table-cell-input elements
// (dom order == unit order, verified below).
async function tableBlocks(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#editor [data-block-idx]').forEach((be) => {
      const inputs = Array.from(be.querySelectorAll('.table-cell-input'));
      if (!inputs.length) return;
      out.push({
        block: Number(be.dataset.blockIdx),
        cells: inputs.map((inp) => ({ unit: Number(inp.dataset.unit), row: inp.dataset.row, col: inp.dataset.col, text: inp.textContent })),
      });
    });
    return out;
  });
}

function highlightState(page) {
  return page.evaluate(() => {
    const tableCellHl = Array.from(document.querySelectorAll('#editor .table-cell-hl')).map((el) => ({
      unit: Number(el.dataset.unit), row: el.dataset.row, col: el.dataset.col,
      blockIdx: Number(el.closest('[data-block-idx]')?.dataset.blockIdx),
    }));
    const printLinked = document.querySelectorAll('#editor .print-linked').length;
    const brlLinked = document.querySelectorAll('.braille .brl-row.brl-linked').length;
    const cellHl = Array.from(document.querySelectorAll('.braille .bcell.cell-hl')).map((el) => ({
      unit: Number(el.dataset.unit), char: Number(el.dataset.char),
      row: Number(el.closest('.brl-row')?.dataset.row),
      block: Number(el.closest('.brl-row[data-block]')?.dataset.block),
    }));
    return { tableCellHl, printLinked, brlLinked, cellHl };
  });
}

async function clickPrintCell(page, block, unit) {
  await page.click(`#editor [data-block-idx="${block}"] .table-cell-input[data-unit="${unit}"]`);
  await page.waitForTimeout(120);
}

async function clickBrailleCellForUnit(page, block, unit) {
  await page.evaluate((b) => {
    document.querySelectorAll(`.braille .brl-row[data-block="${b}"]`).forEach((r) => {
      r.dispatchEvent(new Event('pointerover', { bubbles: true }));
    });
  }, block);
  const found = await page.evaluate(({ block, unit }) => {
    const cells = Array.from(document.querySelectorAll(`.braille .brl-row[data-block="${block}"] .bcell[data-unit="${unit}"]`));
    if (!cells.length) return null;
    const c = cells[0];
    return { row: c.closest('.brl-row').dataset.row, char: c.dataset.char };
  }, { block, unit });
  if (!found) return null;
  const locator = page.locator(`.braille .brl-row[data-row="${found.row}"] .bcell[data-unit="${unit}"][data-char="${found.char}"]`).first();
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: true });
  await page.waitForTimeout(120);
  return found;
}

const FORMATS = ['auto', 'listed', 'columnar', 'vertical', 'interchange', 'stairstep', 'linear'];   // interchange: BANA 11.15 (braille entries traced back to the print cells they came from)

for (const tableFormat of FORMATS) {
  console.log(`\n-- tableFormat: ${tableFormat} --`);
  const { context, page, pageErrors } = await openWithFormat(tableFormat);

  ok(`[${tableFormat}] editor loaded with no console/page errors`, pageErrors.length === 0, pageErrors);

  const blocks = await tableBlocks(page);
  ok(`[${tableFormat}] TablesTestXml.xml's tables rendered as table blocks in the editor`, blocks.length > 0, blocks.map((b) => b.block));

  for (const tb of blocks) {
    // Sample cells: every header cell (row -1), plus up to 4 data cells spread across the
    // table (first/second/mid/last), so both header and body units are exercised without
    // making the suite click every single cell of a pathological (e.g. huge colspan) table.
    const headerCells = tb.cells.filter((c) => c.row === '-1');
    const dataCells = tb.cells.filter((c) => c.row !== '-1');
    const sample = [...headerCells, ...dataCells.filter((_, i) => i % Math.max(1, Math.floor(dataCells.length / 4)) === 0).slice(0, 4)];

    for (const cell of sample) {
      if (!cell.text.trim()) continue; // blank cells covered separately below
      await clickPrintCell(page, tb.block, cell.unit);
      const hl = await highlightState(page);

      ok(`[${tableFormat}] block ${tb.block} unit ${cell.unit}: clicking the print cell highlights exactly that cell (no stale/extra cell)`,
        hl.tableCellHl.length === 1 && hl.tableCellHl[0].unit === cell.unit && hl.tableCellHl[0].blockIdx === tb.block,
        hl.tableCellHl);

      ok(`[${tableFormat}] block ${tb.block} unit ${cell.unit}: no whole-block print tint ('.print-linked')`,
        hl.printLinked === 0, hl.printLinked);

      ok(`[${tableFormat}] block ${tb.block} unit ${cell.unit}: no whole-table braille tint ('.brl-linked')`,
        hl.brlLinked === 0, hl.brlLinked);

      const wrongUnit = hl.cellHl.filter((c) => c.unit !== cell.unit || c.block !== tb.block);
      ok(`[${tableFormat}] block ${tb.block} unit ${cell.unit}: every highlighted braille cell belongs to the clicked cell's own unit (not another cell/row)`,
        hl.cellHl.length > 0 && wrongUnit.length === 0, { cellHl: hl.cellHl, wrongUnit });

      // Round trip: click one of the highlighted braille cells and confirm it maps back to
      // the SAME print cell (unit) and places the caret inside it.
      if (hl.cellHl.length > 0) {
        const clicked = await clickBrailleCellForUnit(page, tb.block, cell.unit);
        if (clicked) {
          const hl2 = await highlightState(page);
          ok(`[${tableFormat}] block ${tb.block} unit ${cell.unit}: clicking its braille entry highlights exactly the originating print cell`,
            hl2.tableCellHl.length === 1 && hl2.tableCellHl[0].unit === cell.unit && hl2.tableCellHl[0].blockIdx === tb.block,
            hl2.tableCellHl);
          const selInfo = await page.evaluate(() => {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return null;
            const r = sel.getRangeAt(0);
            const node = r.startContainer;
            const cellEl = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.table-cell-input');
            return cellEl ? Number(cellEl.dataset.unit) : null;
          });
          ok(`[${tableFormat}] block ${tb.block} unit ${cell.unit}: the caret lands inside the matching print cell (not the table's first cell)`,
            selInfo === cell.unit, selInfo);
          ok(`[${tableFormat}] block ${tb.block} unit ${cell.unit}: braille round trip leaves no whole-table tint either`,
            hl2.printLinked === 0 && hl2.brlLinked === 0, hl2);
        }
      }
    }

    // Stuck-highlight regression: highlight one real cell, then click a BLANK cell (if any) —
    // the first cell's highlight must fully clear, not persist alongside the new one.
    const blankCell = tb.cells.find((c) => !c.text.trim());
    const firstRealCell = sample.find((c) => c.text.trim());
    if (blankCell && firstRealCell) {
      await clickPrintCell(page, tb.block, firstRealCell.unit);
      await clickPrintCell(page, tb.block, blankCell.unit);
      const hlAfterBlank = await highlightState(page);
      const staleForFirst = hlAfterBlank.tableCellHl.filter((c) => c.unit === firstRealCell.unit);
      ok(`[${tableFormat}] block ${tb.block}: clicking a blank cell clears the previous cell's highlight (no stuck highlight)`,
        staleForFirst.length === 0, hlAfterBlank.tableCellHl);
      ok(`[${tableFormat}] block ${tb.block}: clicking a blank cell never highlights the whole table`,
        hlAfterBlank.printLinked === 0 && hlAfterBlank.brlLinked === 0, hlAfterBlank);
    }
  }

  await context.close();
}

await browser.close();

console.log(`\n=== Table click-to-link regression suite [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', JSON.stringify(failures, null, 1).slice(0, 8000));
  process.exit(1);
} else {
  console.log('All table click-to-link checks passed.');
}
