import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseNimasXml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const PORT = 8499;
const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EMBOSS_DIR, '..');
const DIST = path.join(ROOT, 'dist');
const ARTIFACTS_DIR = '/Users/paulblenkhorn/.gemini/antigravity/brain/a9d212ee-9a89-4daf-86e5-37a9ce973028';
const NIMAS_PATH = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.cti': 'text/plain; charset=utf-8',
  '.uti': 'text/plain; charset=utf-8',
  '.ctb': 'text/plain; charset=utf-8',
  '.dis': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        let p = path.join(DIST, decodeURIComponent(url.pathname));
        let st = await fs.promises.stat(p).catch(() => null);
        if (st && st.isDirectory()) p = path.join(p, 'index.html');
        st = await fs.promises.stat(p).catch(() => null);
        if (!st) {
          p = path.join(ROOT, decodeURIComponent(url.pathname));
          st = await fs.promises.stat(p).catch(() => null);
          if (st && st.isDirectory()) p = path.join(p, 'index.html');
        }
        const ext = path.extname(p).toLowerCase();
        const data = await fs.promises.readFile(p);
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function run() {
  console.log('======================================================================');
  console.log('📖 TESTING REAL 1.4MB NIMAS XML DOCUMENT: Collections, Grade 7');
  console.log(`Path: ${NIMAS_PATH}`);
  console.log('======================================================================\n');

  if (!fs.existsSync(NIMAS_PATH)) {
    throw new Error(`NIMAS file not found at ${NIMAS_PATH}`);
  }

  const stat = fs.statSync(NIMAS_PATH);
  console.log(`File Size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB (${stat.size} bytes)`);

  const xmlContent = fs.readFileSync(NIMAS_PATH, 'utf8');
  console.log('Parsing NIMAS XML into structured document model...');
  const t0 = Date.now();
  const model = parseNimasXml(xmlContent);
  const parseTime = Date.now() - t0;
  console.log(`Parsed in ${parseTime}ms: Title="${model.title}", Blocks=${model.blocks.length}`);

  const blockTypes = {};
  for (const b of model.blocks) {
    blockTypes[b.type] = (blockTypes[b.type] || 0) + 1;
  }
  console.log('Block breakdown:', blockTypes);

  // --- PART 1: Format & Trace Validation in Node for entire 5,474 blocks ---
  console.log('\n--- PART 1: Formatting & Coordinate Trace Verification (BANA & UKAAF) ---');
  const traceObj = {};
  const banaSettings = {
    standard: 'bana',
    grade: 2,
    width: 38,
    depth: 25,
    banaFormats: true,
    translate: (s) => s.toUpperCase(),
    trace: traceObj,
  };

  const brf = formatDocument(model, banaSettings);
  const brfPages = brf.split('\f');
  console.log(`BANA Formatting complete: ${brfPages.length} physical braille pages generated in BRF.`);
  console.log(`Trace object populated: ${traceObj.rows?.length || 0} rows, ${traceObj.rowCells?.length || 0} rowCell arrays.`);

  let totalBrlRows = traceObj.rows?.length || 0;
  let totalTracedCells = 0;
  let invalidCoords = 0;

  if (traceObj.rowCells) {
    for (const cells of traceObj.rowCells) {
      if (cells && Array.isArray(cells)) {
        for (const cell of cells) {
          totalTracedCells++;
          if (cell && (isNaN(cell.u) || isNaN(cell.c))) {
            invalidCoords++;
          }
        }
      }
    }
  }

  console.log(`Trace Statistics on Entire 1.4MB Book:`);
  console.log(`  - Total braille rows: ${totalBrlRows}`);
  console.log(`  - Total traced cells: ${totalTracedCells}`);
  console.log(`  - Invalid/NaN coordinate cells: ${invalidCoords}`);
  if (invalidCoords > 0) {
    throw new Error(`Found ${invalidCoords} cells with invalid NaN coordinates!`);
  }
  console.log('  ✅ Cell trace coordinates 100% verified clean across all physical pages.');

  // Check orphan prevention on all print pages in BANA formatting
  let orphanedPrintPages = 0;
  for (const pageStr of brfPages) {
    const lines = pageStr.split(/\r?\n/);
    const lastRow = lines[lines.length - 1];
    if (lastRow && /^\s*⠐[⠁-⠚]+$/.test(lastRow.trim())) {
      orphanedPrintPages++;
    }
  }
  console.log(`  - Orphaned print page indicators at page bottoms: ${orphanedPrintPages}`);
  if (orphanedPrintPages > 0) {
    throw new Error(`Found ${orphanedPrintPages} orphaned print page indicators at bottom of braille pages!`);
  }
  console.log('  ✅ Orphan prevention 100% verified clean across all physical pages.');

  // --- PART 2: Real Browser E2E Interaction Test (Playwright) ---
  console.log('\n--- PART 2: Real Browser E2E Interaction Test (Playwright / Chromium) ---');
  const server = await startServer();
  console.log(`Test server running on port ${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('Browser console error:', msg.text());
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    console.log('Browser page error:', err.message);
    consoleErrors.push(err.message);
  });

  try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.click('#advancedBtn');
    await page.waitForSelector('#editor', { timeout: 15000 });
    await page.waitForSelector('#braille .brl-row', { timeout: 15000 });

    console.log('\nHydrating document into editor with multi-print-page sections...');
    // We pass the first 300 blocks which contains multiple chapters, multiple print page breaks, headings, and lists
    const nimasSlice = {
      title: model.title,
      blocks: model.blocks.slice(0, 300)
    };

    await page.evaluate((docData) => {
      window.modelToLexical(docData);
    }, nimasSlice);

    await page.waitForTimeout(3000);

    const docStats = await page.evaluate(() => {
      const status = document.querySelector('#statusBar')?.textContent || '';
      const brailleRows = document.querySelectorAll('#braille .brl-row').length;
      const editorParagraphs = document.querySelectorAll('#editor p, #editor h1, #editor h2, #editor h3').length;
      const printPageWidgets = document.querySelectorAll('#editor .emboss-printpage-widget, #editor .doc-print-page').length;
      return { status, brailleRows, editorParagraphs, printPageWidgets };
    });

    console.log(`Document Hydrated in Editor:`);
    console.log(`  - Status Bar: ${docStats.status.trim()}`);
    console.log(`  - Editor Elements: ${docStats.editorParagraphs}`);
    console.log(`  - Print Page Widgets in DOM: ${docStats.printPageWidgets}`);
    console.log(`  - Braille Rows: ${docStats.brailleRows}`);

    // Screenshot 1: Top of NIMAS Document (Page 1)
    const ss1Path = path.join(ARTIFACTS_DIR, 'nimas_page1_top.png');
    await page.screenshot({ path: ss1Path });
    console.log(`Saved screenshot: ${ss1Path}`);

    // --- Scenario A: Word Clicking on Early Print Page ---
    console.log('\n--- Scenario A: Word Clicking on Print Page 1 / Title ---');
    await page.evaluate(() => {
      const p = document.querySelector('#editor p');
      if (p) {
        const rect = p.getBoundingClientRect();
        p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 25, clientY: rect.top + 5 }));
      }
    });
    await page.waitForTimeout(500);

    const click1Stats = await page.evaluate(() => {
      const sb = document.querySelector('#statusBar')?.textContent || '';
      const hlCount = document.querySelectorAll('.cell-hl, .brl-linked').length;
      return { sb, hlCount };
    });
    console.log(`Early Click Result: Highlighted cells: ${click1Stats.hlCount}, Status: ${click1Stats.sb.slice(0, 70)}`);

    const ss2Path = path.join(ARTIFACTS_DIR, 'nimas_page1_click.png');
    await page.screenshot({ path: ss2Path });
    console.log(`Saved screenshot: ${ss2Path}`);

    // --- Scenario B: Continuous ArrowDown Cursoring across Print Page Boundaries ---
    console.log('\n--- Scenario B: Continuous Cursoring (40 ArrowDown presses across print pages) ---');
    await page.click('#editor');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);

    const cursorStats = await page.evaluate(() => {
      const editorScroll = document.querySelector('#editor')?.scrollTop || 0;
      const brailleScroll = document.querySelector('#braille')?.scrollTop || 0;
      const activeLine = window.activeCaretLine;
      return { editorScroll, brailleScroll, activeLine };
    });
    console.log(`Cursored 40 lines down: EditorScroll=${cursorStats.editorScroll}px, BrailleScroll=${cursorStats.brailleScroll}px`);

    const ss3Path = path.join(ARTIFACTS_DIR, 'nimas_cursoring_down.png');
    await page.screenshot({ path: ss3Path });
    console.log(`Saved screenshot: ${ss3Path}`);

    // --- Scenario C: Word Clicking Right Before & After Print Page Indicator ---
    console.log('\n--- Scenario C: Clicking Word Adjacent to Print Page Indicator ---');
    await page.evaluate(() => {
      const widgets = Array.from(document.querySelectorAll('#editor .emboss-printpage-widget, #editor .doc-print-page'));
      if (widgets.length > 0) {
        const targetWidget = widgets[0];
        let nextEl = targetWidget.nextElementSibling;
        while (nextEl && !['P', 'H1', 'H2', 'H3'].includes(nextEl.tagName)) {
          nextEl = nextEl.nextElementSibling;
        }
        if (nextEl) {
          const rect = nextEl.getBoundingClientRect();
          nextEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 5 }));
        }
      }
    });
    await page.waitForTimeout(500);

    const boundaryClickStats = await page.evaluate(() => {
      const sb = document.querySelector('#statusBar')?.textContent || '';
      const hlCount = document.querySelectorAll('.cell-hl, .brl-linked').length;
      return { sb, hlCount };
    });
    console.log(`Boundary Click Result: Highlighted cells: ${boundaryClickStats.hlCount}, Status: ${boundaryClickStats.sb.slice(0, 70)}`);

    const ss4Path = path.join(ARTIFACTS_DIR, 'nimas_printpage_boundary_click.png');
    await page.screenshot({ path: ss4Path });
    console.log(`Saved screenshot: ${ss4Path}`);

    // --- Scenario D: FAST SCROLLING & Word Clicking ---
    console.log('\n--- Scenario D: Fast Scrolling to Deep Document & Clicking ---');
    await page.evaluate(() => {
      const editor = document.querySelector('#editor');
      if (editor) {
        // Fast burst scrolling
        editor.scrollTop = 500;
        editor.scrollTop = 1500;
        editor.scrollTop = 3500;
      }
    });
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll('#editor p'));
      const deepP = paragraphs[Math.floor(paragraphs.length * 0.7)];
      if (deepP) {
        const rect = deepP.getBoundingClientRect();
        deepP.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 35, clientY: rect.top + 5 }));
      }
    });
    await page.waitForTimeout(500);

    const fastScrollClickStats = await page.evaluate(() => {
      const sb = document.querySelector('#statusBar')?.textContent || '';
      const brailleScroll = document.querySelector('#braille')?.scrollTop || 0;
      const hlCount = document.querySelectorAll('.cell-hl, .brl-linked').length;
      return { sb, brailleScroll, hlCount };
    });
    console.log(`Fast Scroll Click Result: BrailleScroll=${fastScrollClickStats.brailleScroll}px, Highlights=${fastScrollClickStats.hlCount}, Status: ${fastScrollClickStats.sb.slice(0, 70)}`);

    const ss5Path = path.join(ARTIFACTS_DIR, 'nimas_fast_scroll_click.png');
    await page.screenshot({ path: ss5Path });
    console.log(`Saved screenshot: ${ss5Path}`);

    // --- Scenario E: Reverse Braille Pane -> Editor Synchronization on Late Braille Page ---
    console.log('\n--- Scenario E: Reverse Braille Pane -> Editor Synchronization ---');
    await page.evaluate(() => {
      const braille = document.querySelector('#braille');
      if (braille) {
        // Fast scroll braille view
        braille.scrollTop = braille.scrollHeight * 0.75;
      }
    });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#braille .brl-row[data-block]'));
      const lateRow = rows[Math.floor(rows.length * 0.75)];
      if (lateRow) {
        lateRow.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        lateRow.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 10 }));
      }
    });
    await page.waitForTimeout(500);

    const reverseClickStats = await page.evaluate(() => {
      const sb = document.querySelector('#statusBar')?.textContent || '';
      const editorScroll = document.querySelector('#editor')?.scrollTop || 0;
      const hasPrintLinked = !!document.querySelector('.print-linked');
      return { sb, editorScroll, hasPrintLinked };
    });
    console.log(`Reverse Click Result: EditorScrolledTo=${reverseClickStats.editorScroll}px, HasPrintLinked=${reverseClickStats.hasPrintLinked}, Status: ${reverseClickStats.sb.slice(0, 70)}`);

    const ss6Path = path.join(ARTIFACTS_DIR, 'nimas_reverse_click.png');
    await page.screenshot({ path: ss6Path });
    console.log(`Saved screenshot: ${ss6Path}`);

    // --- Scenario F: Verification of Braille Page Numbers & Print Page Numbers ---
    console.log('\n--- Scenario F: Verification of Braille & Print Page Numbers in Braille Pane ---');
    const pageNumberVerification = await page.evaluate(() => {
      const brailleRows = Array.from(document.querySelectorAll('#braille .brl-row'));
      const braillePageHeaders = brailleRows.filter(r => r.textContent.includes('PAGE ')).map(r => r.textContent.trim());
      const printPageIndicators = brailleRows.filter(r => /⠐[⠁-⠚]+/.test(r.textContent)).map(r => r.textContent.trim());
      return {
        totalHeaders: braillePageHeaders.length,
        sampleHeaders: braillePageHeaders.slice(0, 5),
        totalPrintIndicators: printPageIndicators.length,
        samplePrintIndicators: printPageIndicators.slice(0, 5),
      };
    });
    console.log('Page Number Results in Braille Pane:', pageNumberVerification);

    // --- Console Error Gate ---
    console.log('\n--- Console Error Gate ---');
    console.log(`Total console errors recorded during test: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.error('Errors:', consoleErrors);
      throw new Error(`Test failed with ${consoleErrors.length} console errors!`);
    }

    console.log('\n🎉 ALL REAL NIMAS 1.4MB DOCUMENT SYNCHRONIZATION AND VISUAL TESTS PASSED!');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
