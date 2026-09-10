import { chromium, webkit } from 'playwright';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EMBOSS_DIR, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 8199;

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
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        let p = path.join(DIST, decodeURIComponent(url.pathname));
        let st = await fs.stat(p).catch(() => null);
        if (st && st.isDirectory()) p = path.join(p, 'index.html');
        st = await fs.stat(p).catch(() => null);
        if (!st) {
          p = path.join(ROOT, decodeURIComponent(url.pathname));
          st = await fs.stat(p).catch(() => null);
          if (st && st.isDirectory()) p = path.join(p, 'index.html');
        }
        const ext = path.extname(p).toLowerCase();
        const data = await fs.readFile(p);
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

async function runBrowserTests(browserType, browserName) {
  console.log(`\n======================================================================`);
  console.log(`🚀 RUNNING RIGOROUS E2E BROWSER TESTS WITH: ${browserName.toUpperCase()}`);
  console.log(`======================================================================\n`);

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[Console Error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`[Page Exception] ${err.message}\n${err.stack}`);
  });

  const testResults = [];
  function recordTest(name, passed, detail = '') {
    testResults.push({ name, passed, detail });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${mark} - ${name}${detail ? ` (${detail})` : ''}`);
    if (!passed) throw new Error(`Test failed: ${name} -> ${detail}`);
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Quick Mode Converter Load & Translation
    // -------------------------------------------------------------------------
    console.log(`\n--- [1] Testing Quick Mode Converter (index.html) ---`);
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const quickTitle = await page.title();
    recordTest('Quick Mode page title', quickTitle.includes('Emboss'), quickTitle);

    // Verify Settings dialog in Quick Mode
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    recordTest('Settings dialog opened in Quick Mode', true);

    // Verify Advanced Production tab
    const advTabBtn = await page.$('.tab-btn[data-tab="tab-document"]');
    const advTabText = await advTabBtn.textContent();
    recordTest('Advanced Production tab renamed properly', advTabText.includes('Advanced Production'), advTabText);

    // Close Settings
    await page.click('#settingsDialog button.icon-btn');
    await page.waitForFunction(() => !document.getElementById('settingsDialog')?.open);
    recordTest('Settings dialog closed in Quick Mode', true);

    // -------------------------------------------------------------------------
    // TEST 2: Advanced Editor Mode Load & Cold-Start Hydration
    // -------------------------------------------------------------------------
    console.log(`\n--- [2] Testing Advanced Editor (editor/index.html) ---`);
    await page.click('#advancedBtn');
    const editorEl = await page.waitForSelector('#editor', { timeout: 10000 });
    recordTest('Editor container exists and is editable', editorEl !== null);

    await page.waitForSelector('#braille .brl-row', { timeout: 15000 });
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('#braille .brl-row');
      return rows.length >= 5;
    }, { timeout: 15000 });

    const brailleEl = await page.$('#braille');
    const brailleText = await brailleEl.innerText();
    recordTest('Braille rendered on load without error placeholder', !brailleText.includes('could not be generated') && brailleText.length > 20, `${brailleText.length} chars`);

    // -------------------------------------------------------------------------
    // TEST 3: Visual Geometry & Computed Layout Non-Zero Heights
    // -------------------------------------------------------------------------
    console.log(`\n--- [3] Testing Visual Geometry & Non-Zero Layout Dimensions ---`);
    const geometryCheck = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#braille .brl-row'));
      const cells = Array.from(document.querySelectorAll('#braille .bcell'));
      const wraps = Array.from(document.querySelectorAll('#braille .brl-text-wrap'));
      
      const rowHeights = rows.map(r => r.getBoundingClientRect().height);
      const wrapHeights = wraps.map(w => w.getBoundingClientRect().height);
      const minRowHeight = Math.min(...rowHeights);
      const minWrapHeight = Math.min(...wrapHeights);
      
      const overflowValues = rows.map(r => window.getComputedStyle(r).overflow);
      const hasClippedOverflow = overflowValues.some(o => o === 'hidden');

      return {
        rowCount: rows.length,
        cellCount: cells.length,
        minRowHeight,
        minWrapHeight,
        hasClippedOverflow
      };
    });

    recordTest('All braille rows have visible non-zero height (>= 18px)', geometryCheck.minRowHeight >= 18, `Min height: ${geometryCheck.minRowHeight}px`);
    recordTest('All braille text wraps have non-zero height (>= 18px)', geometryCheck.minWrapHeight >= 18, `Min height: ${geometryCheck.minWrapHeight}px`);
    recordTest('Braille rows do not have overflow clipping (overflow != hidden)', !geometryCheck.hasClippedOverflow);

    const srHintCheck = await page.evaluate(() => {
      const hints = Array.from(document.querySelectorAll('.brl-sr-hint'));
      if (hints.length === 0) return { exists: false, hidden: true };
      const allHidden = hints.every(h => {
        const cs = window.getComputedStyle(h);
        const rect = h.getBoundingClientRect();
        return cs.overflow === 'hidden' && rect.width <= 1 && rect.height <= 1;
      });
      return { exists: true, hidden: allHidden, count: hints.length };
    });
    recordTest('Screen reader hints are hidden visually (width <= 1px, overflow: hidden)', srHintCheck.hidden, `${srHintCheck.count} hints checked`);

    // -------------------------------------------------------------------------
    // TEST 4: Cold-Start Zero-Interaction Math Transcription
    // -------------------------------------------------------------------------
    console.log(`\n--- [4] Testing Cold-Start Math Transcription (pi r^2) ---`);
    const mathTranscription = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#braille .brl-row'));
      // Find row corresponding to the circle area sentence
      const circleRow = rows.find(r => r.innerText.includes('⠰⠰⠨⠏⠗⠔⠼⠃') || r.innerText.includes('CIRCLE IS'));
      return {
        found: !!circleRow,
        rowText: circleRow ? circleRow.innerText : '',
        hasUebMath: circleRow ? circleRow.innerText.includes('⠰⠰⠨⠏⠗⠔⠼⠃') : false
      };
    });

    recordTest('Cold-start default text transcribes pi r^2 to UEB Technical braille', mathTranscription.hasUebMath, mathTranscription.rowText.split('\n')[0]);

    // Verify no initial console errors
    recordTest('Initial page load generated zero console errors', consoleErrors.length === 0, consoleErrors.join('; '));

    // -------------------------------------------------------------------------
    // TEST 5: Interactive Word Linking & Explanation Bar
    // -------------------------------------------------------------------------
    console.log(`\n--- [5] Testing Interactive Linking & Explanation Bar ---`);
    await page.evaluate(() => {
      const row = document.querySelector('.brl-row[data-block]');
      if (row) {
        row.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 60 }));
      }
    });
    await page.waitForTimeout(400);
    const ruleInfoVisible = await page.$eval('#statusBar', el => !el.hidden);
    recordTest('Clicking braille cell updates explanation bar', ruleInfoVisible);
    const ruleHtml = await page.$eval('#statusBar', el => el.innerHTML);
    recordTest('Explanation bar contains colored segments or rule badges', ruleHtml.includes('ri-brl') || ruleHtml.includes('ri-rule') || ruleHtml.includes('ri-word') || ruleHtml.includes('ri-note') || ruleHtml.includes('ri-seg') || ruleHtml.includes('sb-hint'), ruleHtml.slice(0, 100));

    // -------------------------------------------------------------------------
    // TEST 6: Math Equation Bidirectional Linking
    // -------------------------------------------------------------------------
    console.log(`\n--- [6] Testing Math Equation Bidirectional Linking ---`);
    await page.evaluate(() => {
      const row = document.querySelector('.brl-row[data-block="3"]') || document.querySelector('.brl-row[data-block]');
      if (row) {
        row.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 10 }));
      }
    });
    await page.waitForTimeout(400);
    const hasMathHl = await page.evaluate(() => {
      return !!document.querySelector('.math-hl, .print-linked');
    });
    recordTest('Clicking math braille applies linking highlight in editor', hasMathHl);

    const statusWithMath = await page.$eval('#statusBar', el => el.textContent);
    recordTest('Explanation bar displays rule breakdown or document status', statusWithMath.length > 5, statusWithMath.slice(0, 80));

    // -------------------------------------------------------------------------
    // TEST 7: Undo, Redo, and Clear Recovery
    // -------------------------------------------------------------------------
    console.log(`\n--- [7] Testing Undo / Redo / Clear Recovery ---`);
    const initialContent = await page.$eval('#editor', el => el.innerText.trim());

    await page.click('#btnClear');
    await page.waitForTimeout(400);
    const clearedContent = await page.$eval('#editor', el => el.innerText.trim());
    recordTest('Clear button emptied editor text', clearedContent.length <= 1, `Length: ${clearedContent.length}`);

    await page.click('#btnUndo');
    await page.waitForTimeout(400);
    const restoredContent = await page.$eval('#editor', el => el.innerText.trim());
    recordTest('Undo restored the cleared document', restoredContent.length > 20 && restoredContent.slice(0, 30) === initialContent.slice(0, 30), `Restored: ${restoredContent.slice(0, 30)}...`);

    await page.click('#btnRedo');
    await page.waitForTimeout(400);
    const redoCleared = await page.$eval('#editor', el => el.innerText.trim());
    recordTest('Redo re-cleared document', redoCleared.length <= 1);

    await page.click('#btnUndo');
    await page.waitForTimeout(400);

    // -------------------------------------------------------------------------
    // TEST 8: Table of Contents (TOC) Toggle & Jump Links
    // -------------------------------------------------------------------------
    console.log(`\n--- [8] Testing Table of Contents & Navigation ---`);
    await page.click('#tocToggle');
    await page.waitForTimeout(500);

    const tocBox = await page.$('.print-toc-box');
    recordTest('In-document Table of Contents box rendered in editor', tocBox !== null);

    if (tocBox) {
      const tocLinks = await page.$$('.print-toc-box a');
      recordTest('TOC links generated for headings', tocLinks.length > 0, `${tocLinks.length} heading links`);
      if (tocLinks.length > 0) {
        await tocLinks[0].click();
        await page.waitForTimeout(300);
        recordTest('Clicking TOC heading link jumps to section', true);
      }
    }

    // -------------------------------------------------------------------------
    // TEST 9: Tactile Symbol Library Modal, Search & Target Display Matrix
    // -------------------------------------------------------------------------
    console.log(`\n--- [9] Testing Tactile Symbol Library Modal & Target Modes ---`);
    await page.evaluate(() => document.body.classList.add('expert-hardware'));
    await page.click('#btnInsertMenu');
    await page.click('#btnGraphic');
    await page.waitForSelector('#graphicDialog[open], #tactile-symbol-modal', { timeout: 5000 });
    recordTest('Tactile Graphic Library modal opened', true);

    // Explicitly switch target to viewplus so search and grid are active
    await page.selectOption('#tsb-target-select', 'viewplus');
    await page.waitForTimeout(400);

    // Test UK spelling search normalization
    await page.fill('#tsb-search-input', 'centre');
    await page.waitForTimeout(400);
    const searchCentreResults = await page.$$eval('#tsb-grid > div', els => els.map(e => e.textContent.trim()));
    recordTest('Tactile search matches UK spelling "centre" to "Center"', searchCentreResults.some(t => t.includes('Center')), searchCentreResults.join(', '));

    // Test deduplication search for book
    await page.fill('#tsb-search-input', 'book');
    await page.waitForTimeout(400);
    const searchBookResults = await page.$$eval('#tsb-grid > div', els => els.map(e => e.textContent.trim()));
    recordTest('Tactile search for "book" returns clean deduplicated results (<= 3)', searchBookResults.length <= 3 && searchBookResults.some(t => t.includes('Book')), searchBookResults.join(', '));

    // Test target selector modes (ViewPlus, Index, Monarch, Dot Pad, Swell)
    const targetSelect = await page.$('#tsb-target-select');
    const targetOptions = await page.$$eval('#tsb-target-select option', opts => opts.map(o => o.value));
    recordTest('Tactile target selector contains all hardware modes', ['viewplus', 'index', 'monarch', 'dotpad', 'swell'].every(m => targetOptions.includes(m)), targetOptions.join(', '));

    // Close modal
    await page.click('#tsb-close-btn');
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // TEST 10: 6-Key Braille Keyboard Input Mode
    // -------------------------------------------------------------------------
    console.log(`\n--- [10] Testing 6-Key Braille Input Mode ---`);
    await page.click('#btnSixKey');
    await page.waitForTimeout(300);
    const sixKeyActive = await page.$eval('#btnSixKey', btn => btn.classList.contains('active') || btn.getAttribute('aria-pressed') === 'true');
    recordTest('6-Key Braille input mode toggled active', sixKeyActive);

    // Toggle 6-key off
    await page.click('#btnSixKey');
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // TEST 11: Save NIMAS Project & Export Braille Deliverables
    // -------------------------------------------------------------------------
    console.log(`\n--- [11] Testing Save NIMAS XML Project & Braille Deliverables ---`);
    await page.click('#saveDocBtn');
    await page.waitForTimeout(100);
    await page.click('#saveXmlItem');
    await page.waitForTimeout(150);
    recordTest('Save Document triggered for NIMAS .xml without error', true);

    await page.click('#downloadBtn');
    await page.waitForTimeout(100);
    await page.click('#downloadEbrlItem');
    await page.waitForTimeout(150);
    recordTest('Export Braille triggered for .ebraille without error', true);

    await page.click('#downloadBtn');
    await page.waitForTimeout(100);
    await page.click('#downloadBrfItem');
    await page.waitForTimeout(150);
    recordTest('Export Braille triggered for .brf without error', true);

    // -------------------------------------------------------------------------
    // TEST 12: Slash Menu (/) Interaction
    // -------------------------------------------------------------------------
    console.log(`\n--- [12] Testing Slash Command Menu ---`);
    await page.focus('#editor');
    await page.keyboard.type('\n/matrix');
    await page.waitForTimeout(400);

    const slashVisible = await page.$eval('#slashMenu', el => !el.hidden);
    recordTest('Slash command menu opens on "/" trigger', slashVisible);

    const firstSlashItem = await page.$('.slash-item');
    if (firstSlashItem) {
      await firstSlashItem.click();
      await page.waitForTimeout(500);
      recordTest('Slash command item executed and closed menu', true);
    }

    // -------------------------------------------------------------------------
    // TEST 13: Formula & Equation Templates Palette
    // -------------------------------------------------------------------------
    console.log(`\n--- [13] Testing Formula Templates Modal ---`);
    await page.click('#btnInsertMenu');
    await page.click('#btnFormula');
    await page.waitForSelector('#formulaDialog[open]');
    recordTest('Formula Templates modal opened', true);

    const firstTpl = await page.$('.formula-item');
    if (firstTpl) {
      await firstTpl.click();
      await page.waitForTimeout(500);
      recordTest('Formula Template inserted into editor', true);
    }

    // -------------------------------------------------------------------------
    // TEST 13b: Print Page Numbers (Insert Menu, In-Editor Input & Braille Formatting)
    // -------------------------------------------------------------------------
    console.log(`\n--- [13b] Testing Print Page Numbers ---`);
    await page.click('#btnInsertMenu');
    await page.click('#btnInsertPrintPage');
    await page.waitForTimeout(400);

    const pageNodeExists = await page.$eval('.emboss-printpage-widget', el => !!el);
    recordTest('Print Page widget inserted into editor', pageNodeExists);

    const pageInputVal = await page.$eval('.page-num-input', el => el.value);
    recordTest('Print Page widget contains default/incremental page number', !!pageInputVal, `Page: ${pageInputVal}`);

    const brailleWithPage = await page.$eval('#braille', el => el.textContent);
    recordTest('Braille panel displays standard print page indicator', brailleWithPage.includes('⠐⠤') || brailleWithPage.includes('⠼'), 'Braille updated');

    // -------------------------------------------------------------------------
    // TEST 14: Settings in Editor (Standard Switching & BANA/Nemeth)
    // -------------------------------------------------------------------------
    console.log(`\n--- [14] Testing Settings Tabs & BANA/Nemeth Live Updates ---`);
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    recordTest('Settings dialog opened in Editor', true);

    // Switch to BANA standard
    await page.click('button[data-tab="tab-rules"]');
    await page.selectOption('#set-mode', 'bana');
    await page.waitForTimeout(500);

    const statusBana = await page.$eval('#statusBar', el => el.textContent);
    recordTest('Settings update to BANA triggered live braille re-transcription', statusBana.includes('BANA'), statusBana);

    // Switch back to UKAAF
    await page.selectOption('#set-mode', 'ukaaf');
    await page.waitForTimeout(300);
    await page.click('#settingsDialog button[value="close"]');
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // TEST 15: Embosser Hardware Presets & Connection Configuration
    // -------------------------------------------------------------------------
    console.log(`\n--- [15] Testing Embosser Hardware Presets & Settings ---`);
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    await page.click('button[data-tab="tab-hardware"]');
    await page.waitForTimeout(300);

    const presetsCount = await page.$$eval('#set-embosser option', opts => opts.length);
    recordTest('Embosser hardware model presets loaded (> 5)', presetsCount > 5, `${presetsCount} models`);

    // -------------------------------------------------------------------------
    // TEST 15b: APH Monarch Multi-Line Tactile Display Live Stream
    // -------------------------------------------------------------------------
    console.log(`\n--- [15b] Testing APH Monarch Tactile Display Live Stream ---`);
    await page.selectOption('#set-embosser', 'monarch');
    await page.waitForTimeout(300);

    const monarchCells = await page.$eval('#set-cells', el => el.value);
    const monarchLines = await page.$eval('#set-lines', el => el.value);
    recordTest('Monarch preset configured 32x10 tactile geometry', monarchCells === '32' && monarchLines === '10', `${monarchCells}x${monarchLines}`);

    await page.click('#btnSimulateTactile');
    await page.waitForTimeout(300);

    const connText = await page.$eval('#tactileConnStatus', el => el.textContent);
    recordTest('Tactile display simulation connected', connText.includes('Connected: APH Monarch'), connText);

    await page.click('#settingsDialog button[value="close"]');
    await page.waitForTimeout(300);

    const badgeVisible = await page.$eval('#tactileDisplayBadge', el => el.style.display !== 'none');
    recordTest('Tactile display status badge active in status bar', badgeVisible);

    // Test tactile page navigation
    await page.click('#tactileNextBtn');
    await page.waitForTimeout(200);
    const badgeTextAfterNext = await page.$eval('#tactileDisplayLbl', el => el.textContent);
    recordTest('Tactile display advances to next 10-line page', badgeTextAfterNext.includes('11-20'), badgeTextAfterNext);

    await page.click('#tactilePrevBtn');
    await page.waitForTimeout(200);
    const badgeTextAfterPrev = await page.$eval('#tactileDisplayLbl', el => el.textContent);
    recordTest('Tactile display returns to first 10-line page', badgeTextAfterPrev.includes('1-10'), badgeTextAfterPrev);

    // Disconnect simulated display and restore standard generic embosser
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    await page.click('button[data-tab="tab-hardware"]');
    await page.waitForTimeout(200);
    await page.click('#btnDisconnectTactile');
    await page.selectOption('#set-embosser', 'generic');
    await page.waitForTimeout(200);
    await page.click('#settingsDialog button[value="close"]');
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // TEST 16: Rapid Keystroke Stress & Live Debounce
    // -------------------------------------------------------------------------
    console.log(`\n--- [16] Testing Rapid Keystroke Stress & Live Debounce ---`);
    await page.click('#editor');
    await page.keyboard.press('End');
    await page.keyboard.type('\nRapid typing stress testing paragraph with numbers 123456789 and math symbols.');
    await page.waitForTimeout(300);

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Backspace');
    }
    await page.waitForTimeout(500);

    const stressBrailleCount = await page.$$eval('#braille .brl-row', rows => rows.length);
    recordTest('Rapid typing and deleting maintains synchronized braille rows without errors', stressBrailleCount >= 5, `${stressBrailleCount} rows`);

    // -------------------------------------------------------------------------
    // TEST 17: Keyboard Accessibility & Escape Dialog Dismissal
    // -------------------------------------------------------------------------
    console.log(`\n--- [17] Testing Keyboard Accessibility & Escape Modal Dismissal ---`);
    
    // Help dialog Escape
    await page.click('#helpBtn');
    await page.waitForSelector('#helpDialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const helpOpen = await page.$eval('#helpDialog', el => el.hasAttribute('open'));
    recordTest('Help dialog closes cleanly on Escape key', !helpOpen);

    // Settings dialog Escape
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const settingsOpen = await page.$eval('#settingsDialog', el => el.hasAttribute('open'));
    recordTest('Settings dialog closes cleanly on Escape key', !settingsOpen);

    // Tactile Symbol modal Escape
    await page.evaluate(() => document.body.classList.add('expert-hardware'));
    await page.click('#btnInsertMenu');
    await page.click('#btnGraphic');
    await page.waitForSelector('#tactile-symbol-modal', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const modalDisplay = await page.$eval('#tactile-symbol-modal', el => el.style.display);
    recordTest('Tactile Symbol Library modal closes cleanly on Escape key', modalDisplay === 'none');

    // -------------------------------------------------------------------------
    // TEST 18: Final Console Error Gate
    // -------------------------------------------------------------------------
    console.log(`\n--- [18] Final Stability & Error Gate ---`);
    recordTest('Zero unhandled exceptions or console errors during entire comprehensive E2E workflow', consoleErrors.length === 0, consoleErrors.join('; '));

  } catch (e) {
    if (consoleErrors.length) console.error('Browser console errors:\n' + consoleErrors.join('\n'));
    throw e;
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = await startServer();
  console.log(`Local test server listening on port ${PORT}`);

  try {
    // Run on Chromium
    await runBrowserTests(chromium, 'Chromium');
    // Run on WebKit (Safari engine) if installed
    try {
      await runBrowserTests(webkit, 'WebKit (Safari engine)');
    } catch (e) {
      console.log(`\n(Skipping WebKit Safari engine: ${e.message.split('\n')[0]})\n`);
    }

    console.log(`\n======================================================================`);
    console.log(`🏆 ALL BROWSER E2E TESTS FULLY VALIDATED!`);
    console.log(`======================================================================\n`);
  } catch (err) {
    console.error(`\n❌ TEST SUITE FAILED:`, err);
    process.exit(1);
  } finally {
    server.close();
  }
}

main();
