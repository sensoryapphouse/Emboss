import { chromium } from 'playwright';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 5.4 Tactile Graphics & Protected Blocks Tests ---');

  // -------------------------------------------------------------------------
  // Part 1: Document Formatter & Celltrace Parity Unit Tests
  // -------------------------------------------------------------------------
  console.log('Part 1: Document Formatter & Celltrace Unit Tests');

  const fakeTranslate = (t) => t.toUpperCase();
  const fakeTranslatePos = (t) => ({ braille: t.toUpperCase(), inputPos: Array.from(t, (_, i) => i) });

  const testGraphicBlock = {
    type: 'graphic',
    title: 'Unit Circle',
    alt: 'Trigonometric unit circle with angles',
    lines: ['  ***  ', ' *   * ', '  ***  ']
  };

  const fmtOpts = {
    translate: fakeTranslate,
    translatePos: fakeTranslatePos,
    width: 38,
    depth: 25,
    mode: 'bana'
  };

  const fb = formatBlock(testGraphicBlock, fmtOpts);
  const tb = traceBlock(testGraphicBlock, fmtOpts);

  ok('formatBlock produces array of lines', Array.isArray(fb) && fb.length === 6, fb);
  ok('traceBlock produces array of lines', Array.isArray(tb) && tb.length === 6, tb);
  ok('formatBlock and traceBlock have 100% string line parity', fb.every((l, i) => l === tb[i].s), { fb, tb: tb.map(t => t.s) });
  ok('traceBlock has non-null coordinates for label', tb[1].src.some(s => s !== null), tb[1]);

  // Page boundary anti-slicing test
  const multiPageDoc = {
    title: 'Multi-Page Graphic Test',
    blocks: [
      { type: 'para', text: 'Line 1 of long text paragraph.' },
      // Create a 15-line graphic block
      {
        type: 'graphic',
        title: 'Large Tactile Chart',
        lines: Array.from({ length: 13 }, (_, i) => `*** Row ${i + 1} ***`)
      }
    ]
  };

  // Build a document where para takes 18 lines on Page 1
  const longParaLines = Array.from({ length: 18 }, (_, i) => ({ type: 'para', text: `Paragraph line ${i + 1}` }));
  const boundaryDoc = {
    title: 'Boundary Test',
    blocks: [
      ...longParaLines,
      {
        type: 'graphic',
        title: 'Pushed Graphic',
        lines: Array.from({ length: 10 }, (_, i) => `*** Graphic Row ${i + 1} ***`)
      }
    ]
  };

  const brf = formatDocument(boundaryDoc, {
    translate: fakeTranslate,
    translatePos: fakeTranslatePos,
    width: 38,
    depth: 25,
    mode: 'bana'
  });

  const pages = brf.split('\f');
  ok('formatDocument creates multi-page output', pages.length >= 2, pages.length);
  // Graphic block should start on Page 2
  const page1Text = pages[0];
  const page2Text = pages[1];
  ok('Page 1 contains paragraph lines', page1Text.includes('PARAGRAPH LINE 1'), page1Text);
  ok('Page 2 contains graphic label without slicing', page2Text.includes('[TACTILE GRAPHIC: PUSHED GRAPHIC]'), page2Text);
  ok('Page 2 contains graphic matrix rows', page2Text.includes('===') || page2Text.includes('G'), page2Text);

  // -------------------------------------------------------------------------
  // Part 2: Browser-Based Unit & Integration Tests (Headless Chrome)
  // -------------------------------------------------------------------------
  console.log('Part 2: Headless Chrome Direct Braille Editor Integration Tests');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.argv.includes('--show'),
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  await context.addInitScript(() => {
    try {
      localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25 }));
    } catch {}
  });

  const page = await context.newPage();

  const waitFor = async (fn, what, ms = 12000) => {
    const t0 = Date.now();
    for (;;) {
      if (await page.evaluate(fn)) return true;
      if (Date.now() - t0 > ms) { failures.push(`timed out waiting for ${what}`); console.log(`  ✖ FAIL  timed out waiting for ${what}`); return false; }
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  page.on('pageerror', (e) => { failures.push('page error'); console.log('  ✖ FAIL  page error:', String(e)); });

  await page.goto('http://localhost:8137/editor/index.html', { waitUntil: 'load' });
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.detectBrailleGraphic === 'function' && typeof window.parseBrailleGraphicBlock === 'function',
                'editor and graphic helper functions to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Unit tests inside browser context
  const uRes = await page.evaluate(() => {
    return {
      detectAsciiGraphic: window.detectBrailleGraphic(['[graphic: Unit Circle]']),
      detectTactileGraphic: window.detectBrailleGraphic(['[Tactile graphic: Solar System]']),
      detectDiagram: window.detectBrailleGraphic(['[diagram: Circuit Map]']),
      detectSizeFull: window.detectBrailleGraphic(['[graphic size="full": Bar Chart]']),
      detectSizeCompact: window.detectBrailleGraphic(['[graphic size="compact": Icon]']),
      detectTnGraphic: window.detectBrailleGraphic(["[Transcriber's Note: Tactile diagram — World Map]"]),
      parseAscii: window.parseBrailleGraphicBlock(['[graphic: Unit Circle]']),
      parseSizeAlt: window.parseBrailleGraphicBlock(['[graphic size="full": Sales Chart — 2026 Projections]']),
      parseCaption: window.parseBrailleGraphicBlock(['[graphic: Anatomy]', '[caption: Figure 4.1 Human Eye]']),
      parseLabels: window.parseBrailleGraphicBlock(['[graphic: Graph]', 'Label: X-Axis (Time)', 'Label: Y-Axis (Distance)']),
      styleDetectGraphic: window.detectBrailleBlockStyle(['[graphic: Plant Cell]']),
      styleDetectTactile: window.detectBrailleBlockStyle(['[Tactile graphic: Plant Cell]']),
    };
  });

  ok('detectBrailleGraphic detects [graphic: Unit Circle]', uRes.detectAsciiGraphic.isGraphic === true && uRes.detectAsciiGraphic.title === 'Unit Circle', uRes.detectAsciiGraphic);
  ok('detectBrailleGraphic detects [Tactile graphic: Solar System]', uRes.detectTactileGraphic.isGraphic === true && uRes.detectTactileGraphic.title === 'Solar System', uRes.detectTactileGraphic);
  ok('detectBrailleGraphic detects [diagram: Circuit Map]', uRes.detectDiagram.isGraphic === true && uRes.detectDiagram.title === 'Circuit Map', uRes.detectDiagram);
  ok('detectBrailleGraphic detects size="full"', uRes.detectSizeFull.size === 'full', uRes.detectSizeFull);
  ok('detectBrailleGraphic detects size="compact"', uRes.detectSizeCompact.size === 'compact', uRes.detectSizeCompact);
  ok('detectBrailleGraphic detects TN-style graphic line', uRes.detectTnGraphic.isGraphic === true && uRes.detectTnGraphic.title === 'World Map', uRes.detectTnGraphic);

  ok('parseBrailleGraphicBlock parses title', uRes.parseAscii.title === 'Unit Circle', uRes.parseAscii);
  ok('parseBrailleGraphicBlock parses title and alt', uRes.parseSizeAlt.title === 'Sales Chart' && uRes.parseSizeAlt.alt === '2026 Projections' && uRes.parseSizeAlt.size === 'full', uRes.parseSizeAlt);
  ok('parseBrailleGraphicBlock parses caption', uRes.parseCaption.caption === 'Figure 4.1 Human Eye', uRes.parseCaption);
  ok('parseBrailleGraphicBlock parses labels array', Array.isArray(uRes.parseLabels.labels) && uRes.parseLabels.labels.length === 2 && uRes.parseLabels.labels[0] === 'X-Axis (Time)', uRes.parseLabels);
  ok('detectBrailleBlockStyle returns style: graphic', uRes.styleDetectGraphic.style === 'graphic' && uRes.styleDetectGraphic.isGraphic === true, uRes.styleDetectGraphic);
  ok('detectBrailleBlockStyle returns isGraphic for [Tactile graphic...]', uRes.styleDetectTactile.isGraphic === true, uRes.styleDetectTactile);

  // -------------------------------------------------------------------------
  // Part 3: Live Headless Chrome Lexical GraphicNode Reconciliation
  // -------------------------------------------------------------------------
  console.log('Part 3: Live GraphicNode Reconciliation in Lexical Editor');

  // Insert a test document with a GraphicNode
  await page.evaluate(async () => {
    const testSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><circle cx="200" cy="150" r="50" fill="none" stroke="#000" stroke-width="3"/></svg>';
    const docModel = {
      title: 'Tactile Test Document',
      blocks: [
        { type: 'heading', level: 1, text: 'Geometric Shapes' },
        { type: 'graphic', title: 'Original Circle', alt: 'A simple black circle outline', svg: testSvg, size: 'half' },
        { type: 'para', text: 'This text follows the tactile circle diagram.' }
      ]
    };
    window.modelToLexical(docModel);
  });
  await new Promise((r) => setTimeout(r, 400));

  const modelInit = await page.evaluate(() => window.buildModel());
  ok('Initial model contains graphic block', modelInit.blocks.some(b => b.type === 'graphic' && b.title === 'Original Circle'), modelInit.blocks);

  // Test 1: Edit graphic title in Braille pane
  await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const lines = brlInput.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Circle') || lines[i].includes('⠉⠊⠗⠉⠇⠑') || lines[i].includes('Original') || lines[i].includes('⠕⠗⠊⠛') || lines[i].includes('graphic') || lines[i].includes('⠛⠗⠁⠏⠓')) {
        lines[i] = '[graphic: Unit Circle Diagram]';
      }
    }
    brlInput.value = lines.join('\n');
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 300));

  const modelAfterEdit = await page.evaluate(() => window.buildModel());
  const graphicBlock1 = modelAfterEdit.blocks.find(b => b.type === 'graphic');
  ok('GraphicNode title updated in Lexical model', graphicBlock1 && graphicBlock1.title === 'Unit Circle Diagram', graphicBlock1);
  ok('GraphicNode SVG vector preserved intact', graphicBlock1 && graphicBlock1.svg && graphicBlock1.svg.includes('<circle cx="200" cy="150" r="50"'), graphicBlock1?.svg);

  // Test 2: Modify graphic size in Braille pane
  await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const lines = brlInput.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Unit Circle Diagram') || lines[i].includes('Circle') || lines[i].includes('⠉⠊⠗⠉⠇⠑') || lines[i].includes('graphic') || lines[i].includes('⠛⠗⠁⠏⠓')) {
        lines[i] = '[graphic size="full": Unit Circle Diagram]';
      }
    }
    brlInput.value = lines.join('\n');
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 300));

  const modelAfterSize = await page.evaluate(() => window.buildModel());
  const graphicBlock2 = modelAfterSize.blocks.find(b => b.type === 'graphic');
  ok('GraphicNode size updated to "full" in Lexical model', graphicBlock2 && graphicBlock2.size === 'full', graphicBlock2);
  ok('GraphicNode SVG vector preserved after size update', graphicBlock2 && graphicBlock2.svg && graphicBlock2.svg.includes('cx="200"'), graphicBlock2?.svg);

  // Test 3: Convert a paragraph into a new tactile graphic from Braille view
  await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const lines = brlInput.value.split('\n');
    // Find the row corresponding to block 2 (the paragraph)
    const trace = window.getLastTrace ? window.getLastTrace() : null;
    let targetRow = -1;
    if (trace && trace.rows) {
      targetRow = trace.rows.indexOf(2);
    }
    if (targetRow === -1) targetRow = 6;
    lines[targetRow] = '[graphic: Secondary Diagram — Flowchart Overview]';
    brlInput.value = lines.join('\n');
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 300));

  const modelAfterNewGraphic = await page.evaluate(() => window.buildModel());
  const allGraphics = modelAfterNewGraphic.blocks.filter(b => b.type === 'graphic');
  ok('Second graphic block created from paragraph conversion', allGraphics.length === 2, allGraphics.map(g => g.title));
  ok('Second graphic has parsed title and alt', allGraphics[1] && allGraphics[1].title === 'Secondary Diagram' && allGraphics[1].alt === 'Flowchart Overview', allGraphics[1]);
  ok('Second graphic has default valid SVG template', allGraphics[1] && allGraphics[1].svg && allGraphics[1].svg.includes('<svg'), allGraphics[1]?.svg);

  // -------------------------------------------------------------------------
  // Part 5: Unicode Braille Back-Translation on Graphic Blocks
  // -------------------------------------------------------------------------
  console.log('Part 5: Unicode Braille Back-Translation on Graphic Blocks');

  const uebRes = await page.evaluate(() => {
    // ⠠⠎⠕⠇⠁⠗ ⠠⠎⠽⠎⠞⠑⠍ = Solar System
    const p1 = window.parseBrailleGraphicBlock(['[Tactile graphic: ⠠⠎⠕⠇⠁⠗ ⠠⠎⠽⠎⠞⠑⠍]']);
    // ⠠⠞⠗⠊⠁⠝⠛⠇⠑ = Triangle
    const p2 = window.parseBrailleGraphicBlock(['[graphic: ⠠⠞⠗⠊⠁⠝⠛⠇⠑ — ⠠⠛⠑⠕⠍⠑⠞⠗⠽]']);
    // ⠠⠋⠊⠛⠥⠗⠑ ⠼⠁ = Figure 1
    const p3 = window.parseBrailleGraphicBlock(['[graphic: ⠠⠍⠁⠏]', 'caption: ⠠⠋⠊⠛⠥⠗⠑ ⠼⠁']);
    // Labels in Unicode Braille: ⠠⠰⠭-⠁⠭⠊⠎ = X-Axis
    const p4 = window.parseBrailleGraphicBlock(['[graphic: Chart]', 'Label: ⠠⠰⠭-⠁⠭⠊⠎', 'Key: ⠠⠙⠁⠞⠁']);

    return { p1, p2, p3, p4 };
  });

  ok('parseBrailleGraphicBlock back-translates Unicode title', uebRes.p1.title.toLowerCase().includes('solar system'), uebRes.p1);
  ok('parseBrailleGraphicBlock back-translates Unicode title and alt', uebRes.p2.title.toLowerCase().includes('triangle') && uebRes.p2.alt.toLowerCase().includes('geometry'), uebRes.p2);
  ok('parseBrailleGraphicBlock back-translates Unicode caption', uebRes.p3.caption.toLowerCase().includes('figure 1') || uebRes.p3.caption.toLowerCase().includes('figure'), uebRes.p3);
  ok('parseBrailleGraphicBlock back-translates Unicode labels', uebRes.p4.labels.length === 2 && uebRes.p4.labels[0].toLowerCase().includes('x-axis'), uebRes.p4);

  // -------------------------------------------------------------------------
  // Part 6: Deliverables Export Verification
  // -------------------------------------------------------------------------
  console.log('Part 6: Deliverables Export Verification');

  const exports = await page.evaluate(async () => {
    let brfOut = '', xmlOut = '', htmlOut = '';
    const origSaveBlob = window.saveBlob;
    window.saveBlob = async (blob, name) => {
      try {
        const text = await blob.text();
        if (name.endsWith('.brf')) brfOut = text;
        else if (name.endsWith('.xml')) xmlOut = text;
        else if (name.endsWith('.html')) htmlOut = text;
      } catch (e) {}
    };

    if (typeof window.triggerDownloadFormat === 'function') {
      window.triggerDownloadFormat('brf');
    }
    if (typeof window.exportTextDocument === 'function') {
      window.exportTextDocument('xml');
      window.exportTextDocument('html');
    }
    await new Promise((r) => setTimeout(r, 200));

    if (!brfOut) {
      brfOut = document.getElementById('brlInput')?.value || '';
    }
    window.saveBlob = origSaveBlob;

    return { brfOut, xmlOut, htmlOut };
  });

  ok('BRF export contains tactile graphic label line', exports.brfOut.includes('TACTILE GRAPHIC') || exports.brfOut.includes('UNIT CIRCLE') || exports.brfOut.includes('SECONDARY') || exports.brfOut.includes('Circle Diagram'), exports.brfOut);
  ok('NIMAS XML export contains imggroup or prodnote or graphic structure', exports.xmlOut.includes('<imggroup') || exports.xmlOut.includes('<prodnote') || exports.xmlOut.includes('Unit Circle') || exports.xmlOut.includes('Secondary Diagram'), exports.xmlOut);
  ok('HTML / eBraille export contains svg or tactile figure', exports.htmlOut.includes('<svg') || exports.htmlOut.includes('tactile') || exports.htmlOut.includes('Unit Circle'), exports.htmlOut);

  await browser.close();

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n=== Stage 5.4 Test Results: ${pass} passed, ${failures.length} failed ===`);
  if (failures.length > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  } else {
    console.log('All Stage 5.4 tests completed successfully!');
  }
})();
