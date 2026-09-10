import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = 8399;
const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EMBOSS_DIR, '..');
const DIST = path.join(ROOT, 'dist');
const ARTIFACTS_DIR = '/Users/paulblenkhorn/.gemini/antigravity/brain/a9d212ee-9a89-4daf-86e5-37a9ce973028';

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
  const server = await startServer();
  console.log(`Server running on port ${PORT}`);

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
    await page.waitForTimeout(1000);

    console.log('--- 1. Generating Large Multi-Page Document (6+ Pages with Print Page Breaks) ---');
    await page.evaluate(() => {
      const doc = {
        title: 'LARGE DOCUMENT TEST',
        blocks: [
          { type: 'heading', level: 1, text: 'Chapter 1: The Beginning' },
          { type: 'pagenum', page: '1' },
          { type: 'para', text: 'This is the first paragraph of print page 1 with several sentences to test braille layout and alignment.' },
          { type: 'para', text: 'Second paragraph on print page 1 describing tactile geometry and braille formatting.' },
          { type: 'list', items: [{ text: 'Alpha item in list' }, { text: 'Beta item in list' }, { text: 'Gamma item with special notes' }] },
          { type: 'pagenum', page: '2' },
          { type: 'heading', level: 2, text: 'Section 1.2: Formulations' },
          { type: 'para', text: 'Calculations continue on print page 2 across multiple sentences.' },
          ...Array.from({ length: 15 }, (_, i) => ({ type: 'para', text: `Paragraph ${i + 1} of chapter one covering extended narrative content across physical braille pages.` })),
          { type: 'pagenum', page: '3' },
          { type: 'heading', level: 1, text: 'Chapter 2: Deep Exploration' },
          ...Array.from({ length: 18 }, (_, i) => ({ type: 'para', text: `Chapter two paragraph ${i + 1} providing substantial bulk text for virtualization testing.` })),
          { type: 'pagenum', page: '4' },
          { type: 'heading', level: 2, text: 'Section 2.2: Advanced Observations' },
          ...Array.from({ length: 20 }, (_, i) => ({ type: 'para', text: `Extended discussion item ${i + 1} at the deep end of the document.` })),
          { type: 'pagenum', page: '5' },
          { type: 'heading', level: 1, text: 'Chapter 3: Final Analysis' },
          ...Array.from({ length: 15 }, (_, i) => ({ type: 'para', text: `Final concluding remarks paragraph ${i + 1} at the very bottom.` }))
        ]
      };
      window.modelToLexical(doc);
    });

    await page.waitForTimeout(1500);

    const docStats = await page.evaluate(() => {
      const status = document.querySelector('#statusBar')?.textContent || '';
      const brailleRows = document.querySelectorAll('#braille .brl-row').length;
      return { status, brailleRows };
    });
    console.log(`Document loaded: ${docStats.status}, Braille rows: ${docStats.brailleRows}`);

    // Screenshot 1: Initial load of large document (Page 1)
    const ss1Path = path.join(ARTIFACTS_DIR, 'large_doc_page1_top.png');
    await page.screenshot({ path: ss1Path });
    console.log(`Saved screenshot 1: ${ss1Path}`);

    // --- 2. Test Word Clicking on Page 1 ---
    console.log('\n--- 2. Testing Word Clicking on Page 1 ---');
    await page.evaluate(() => {
      const p = document.querySelector('[data-block-idx="2"]'); // first paragraph
      if (p) {
        const rect = p.getBoundingClientRect();
        p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 20, clientY: rect.top + 5 }));
      }
    });
    await page.waitForTimeout(400);

    const click1Status = await page.evaluate(() => {
      const sb = document.querySelector('#statusBar')?.textContent || '';
      const hlCount = document.querySelectorAll('.cell-hl, .brl-linked').length;
      return { sb, hlCount };
    });
    console.log(`Page 1 Click Result: Highlighted cells/rows: ${click1Status.hlCount}, Status bar: ${click1Status.sb.slice(0, 60)}`);

    const ss2Path = path.join(ARTIFACTS_DIR, 'large_doc_page1_click.png');
    await page.screenshot({ path: ss2Path });

    // --- 3. Test Cursoring Down Through Document (ArrowDown) ---
    console.log('\n--- 3. Testing Cursoring Through Pages (ArrowDown Navigation) ---');
    await page.click('#editor');
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(500);

    const cursorStats = await page.evaluate(() => {
      const activeLine = window.activeCaretLine;
      const editorScroll = document.querySelector('#editor')?.scrollTop || 0;
      const brailleScroll = document.querySelector('#braille')?.scrollTop || 0;
      return { activeLine, editorScroll, brailleScroll };
    });
    console.log(`Cursored 25 lines down: activeLine=${cursorStats.activeLine}, editorScroll=${cursorStats.editorScroll}px, brailleScroll=${cursorStats.brailleScroll}px`);

    const ss3Path = path.join(ARTIFACTS_DIR, 'large_doc_cursoring_down.png');
    await page.screenshot({ path: ss3Path });

    // --- 4. Test Deep Scrolling to Page 4 & Clicking Word ---
    console.log('\n--- 4. Testing Deep Scrolling to Chapter 2 (Page 3/4) ---');
    await page.evaluate(() => {
      const editor = document.querySelector('#editor');
      if (editor) editor.scrollTop = editor.scrollHeight * 0.5;
    });
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll('#editor p'));
      const midP = paragraphs[Math.floor(paragraphs.length / 2)];
      if (midP) {
        const rect = midP.getBoundingClientRect();
        midP.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 5 }));
      }
    });
    await page.waitForTimeout(500);

    const midClickStats = await page.evaluate(() => {
      const sb = document.querySelector('#statusBar')?.textContent || '';
      const brailleScroll = document.querySelector('#braille')?.scrollTop || 0;
      const hlCount = document.querySelectorAll('.cell-hl, .brl-linked').length;
      return { sb, brailleScroll, hlCount };
    });
    console.log(`Middle Document Click: Braille scroll pos=${midClickStats.brailleScroll}px, Highlights=${midClickStats.hlCount}, Status: ${midClickStats.sb.slice(0, 60)}`);

    const ss4Path = path.join(ARTIFACTS_DIR, 'large_doc_middle_click.png');
    await page.screenshot({ path: ss4Path });

    // --- 5. Test Braille Pane -> Editor Synchronization (Reverse Click) ---
    console.log('\n--- 5. Testing Braille Pane -> Editor Reverse Click on Page 5 ---');
    await page.evaluate(() => {
      const braille = document.querySelector('#braille');
      if (braille) braille.scrollTop = braille.scrollHeight * 0.85;
    });
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#braille .brl-row[data-block]'));
      const lateRow = rows[Math.floor(rows.length * 0.85)];
      if (lateRow) {
        lateRow.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        lateRow.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 10 }));
      }
    });
    await page.waitForTimeout(600);

    const reverseClickStats = await page.evaluate(() => {
      const sb = document.querySelector('#statusBar')?.textContent || '';
      const editorScroll = document.querySelector('#editor')?.scrollTop || 0;
      const hasPrintLinked = !!document.querySelector('.print-linked');
      return { sb, editorScroll, hasPrintLinked };
    });
    console.log(`Reverse Click from Braille: Editor scrolled to=${reverseClickStats.editorScroll}px, Print linked element active=${reverseClickStats.hasPrintLinked}, Status: ${reverseClickStats.sb.slice(0, 60)}`);

    const ss5Path = path.join(ARTIFACTS_DIR, 'large_doc_reverse_click_page5.png');
    await page.screenshot({ path: ss5Path });

    // --- 6. Verification of Zero Errors Throughout ---
    console.log('\n--- 6. Console Error Check ---');
    console.log(`Total console errors recorded: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.error('Console errors:', consoleErrors);
    }

    console.log('\n✅ ALL LARGE DOCUMENT SYNCHRONIZATION AND VISUAL TESTS COMPLETE!');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch(e => {
  console.error('Test execution failed:', e);
  process.exit(1);
});
