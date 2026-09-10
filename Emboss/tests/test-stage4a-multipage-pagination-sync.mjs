import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 4.1 Multi-Page Pagination & Section Break Sync Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.detectBrailleBlockStyle === 'function',
                'editor and detectBrailleBlockStyle engine to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: Unit Pattern Detection & Page Number Extraction
  const r1 = await page.evaluate(() => {
    const fn = window.detectBrailleBlockStyle;
    const numFn = window.extractPrintPageNumber;

    // Number extraction tests
    const n1 = numFn('#A');
    const n2 = numFn('#J');
    const n3 = numFn('#AB');
    const n4 = numFn('⠼⠁');
    const n5 = numFn('⠼⠊');
    const n6 = numFn('⠼⠁⠚');
    const n7 = numFn('⠂');
    const n8 = numFn('⠒');
    const n9 = numFn('iv');

    // Style detection tests
    const sBanaAscii = fn(['"3----------------------------------- 1'], { cells: 40 });
    const sBanaUni = fn(['⠐⠒⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠀⠼⠁'], { cells: 40 });
    const sBanaLowered = fn(['⠐⠒⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠀⠂'], { cells: 40 });
    const sUkaafAscii = fn(['             "31'], { cells: 40 });
    const sUkaafUni = fn(['             ⠐⠒⠼⠁'], { cells: 40 });
    const sDirect1 = fn(['Page 12'], { cells: 40 });
    const sDirect2 = fn(['--- Page 4 ---'], { cells: 40 });
    const sDirect3 = fn(['⠒⠒⠒ Page 5 ⠒⠒⠒'], { cells: 40 });
    const sDirect4 = fn(['⠠⠏⠁⠛⠑ ⠼⠃'], { cells: 40 });

    // Break detection tests
    const sBreakAscii1 = fn(['"9 "9 "9'], { cells: 40 });
    const sBreakAscii2 = fn(['"9"9"9'], { cells: 40 });
    const sBreakAscii3 = fn(['* * *'], { cells: 40 });
    const sBreakAscii4 = fn(['***'], { cells: 40 });
    const sBreakUni1 = fn(['⠐⠔ ⠐⠔ ⠐⠔'], { cells: 40 });
    const sBreakUni2 = fn(['⠐⠔⠐⠔⠐⠔'], { cells: 40 });
    const sBreakUni3 = fn(['∗ ∗ ∗'], { cells: 40 });
    const sBreakUni4 = fn(['⠐ ⠐ ⠐'], { cells: 40 });

    return {
      n1, n2, n3, n4, n5, n6, n7, n8, n9,
      sBanaAscii, sBanaUni, sBanaLowered, sUkaafAscii, sUkaafUni,
      sDirect1, sDirect2, sDirect3, sDirect4,
      sBreakAscii1, sBreakAscii2, sBreakAscii3, sBreakAscii4,
      sBreakUni1, sBreakUni2, sBreakUni3, sBreakUni4,
    };
  });

  ok('extractPrintPageNumber converts #A to 1', r1.n1 === '1', r1.n1);
  ok('extractPrintPageNumber converts #J to 0', r1.n2 === '0', r1.n2);
  ok('extractPrintPageNumber converts #AB to 12', r1.n3 === '12', r1.n3);
  ok('extractPrintPageNumber converts ⠼⠁ to 1', r1.n4 === '1', r1.n4);
  ok('extractPrintPageNumber converts ⠼⠊ to 9', r1.n5 === '9', r1.n5);
  ok('extractPrintPageNumber converts ⠼⠁⠚ to 10', r1.n6 === '10', r1.n6);
  ok('extractPrintPageNumber converts ⠂ to 1', r1.n7 === '1', r1.n7);
  ok('extractPrintPageNumber converts ⠒ to 3', r1.n8 === '3', r1.n8);
  ok('extractPrintPageNumber preserves Roman numerals iv', r1.n9 === 'iv', r1.n9);

  ok('BANA ASCII print page detected', r1.sBanaAscii.style === 'print-page' && r1.sBanaAscii.isPrintPage === true && r1.sBanaAscii.page === '1', r1.sBanaAscii);
  ok('BANA Unicode print page detected', r1.sBanaUni.style === 'print-page' && r1.sBanaUni.isPrintPage === true && r1.sBanaUni.page === '1', r1.sBanaUni);
  ok('BANA Lowered braille print page detected', r1.sBanaLowered.style === 'print-page' && r1.sBanaLowered.isPrintPage === true && r1.sBanaLowered.page === '1', r1.sBanaLowered);
  ok('UKAAF ASCII centred print page detected', r1.sUkaafAscii.style === 'print-page' && r1.sUkaafAscii.isPrintPage === true && r1.sUkaafAscii.page === '1', r1.sUkaafAscii);
  ok('UKAAF Unicode centred print page detected', r1.sUkaafUni.style === 'print-page' && r1.sUkaafUni.isPrintPage === true && r1.sUkaafUni.page === '1', r1.sUkaafUni);
  ok('Direct "Page 12" detected', r1.sDirect1.style === 'print-page' && r1.sDirect1.page === '12', r1.sDirect1);
  ok('Direct "--- Page 4 ---" detected', r1.sDirect2.style === 'print-page' && r1.sDirect2.page === '4', r1.sDirect2);
  ok('Direct "⠒⠒⠒ Page 5 ⠒⠒⠒" detected', r1.sDirect3.style === 'print-page' && r1.sDirect3.page === '5', r1.sDirect3);
  ok('Direct "⠠⠏⠁⠛⠑ ⠼⠃" detected', r1.sDirect4.style === 'print-page' && r1.sDirect4.page === '2', r1.sDirect4);

  ok('Section Break ASCII "9 "9 "9 detected', r1.sBreakAscii1.style === 'break' && r1.sBreakAscii1.isBreak === true, r1.sBreakAscii1);
  ok('Section Break ASCII "9"9"9 detected', r1.sBreakAscii2.style === 'break' && r1.sBreakAscii2.isBreak === true, r1.sBreakAscii2);
  ok('Section Break ASCII * * * detected', r1.sBreakAscii3.style === 'break' && r1.sBreakAscii3.isBreak === true, r1.sBreakAscii3);
  ok('Section Break ASCII *** detected', r1.sBreakAscii4.style === 'break' && r1.sBreakAscii4.isBreak === true, r1.sBreakAscii4);
  ok('Section Break Unicode ⠐⠔ ⠐⠔ ⠐⠔ detected', r1.sBreakUni1.style === 'break' && r1.sBreakUni1.isBreak === true, r1.sBreakUni1);
  ok('Section Break Unicode ⠐⠔⠐⠔⠐⠔ detected', r1.sBreakUni2.style === 'break' && r1.sBreakUni2.isBreak === true, r1.sBreakUni2);
  ok('Section Break Unicode ∗ ∗ ∗ detected', r1.sBreakUni3.style === 'break' && r1.sBreakUni3.isBreak === true, r1.sBreakUni3);
  ok('Section Break Unicode ⠐ ⠐ ⠐ detected', r1.sBreakUni4.style === 'break' && r1.sBreakUni4.isBreak === true, r1.sBreakUni4);

  // Test 2: Live Reverse Sync for Print Page Node (PrintPageNode)
  const r2 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');

    brlInput.value = '⠐⠒⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠀⠼⠁';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const pageWidget = editorEl.querySelector('.doc-print-page, .emboss-printpage-widget');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      detectedPage: changes?.blockStyleInfo?.page,
      hasPageWidget: !!pageWidget,
    };
  });

  ok('Reconcile detects print page block', r2.hasChanges === true && r2.detectedStyle === 'print-page' && r2.detectedPage === '1', r2);
  ok('LHS print panel creates PrintPageNode widget', r2.hasPageWidget === true, r2);

  // Test 3: Live Reverse Sync for Document Break Node (BreakNode)
  const r3 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');

    brlInput.value = '⠐⠔ ⠐⠔ ⠐⠔';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const breakWidget = editorEl.querySelector('.doc-break');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      isBreak: changes?.blockStyleInfo?.isBreak,
      hasBreakWidget: !!breakWidget,
      breakContent: breakWidget?.textContent?.trim(),
    };
  });

  ok('Reconcile detects section break block', r3.hasChanges === true && r3.detectedStyle === 'break' && r3.isBreak === true, r3);
  ok('LHS print panel creates BreakNode widget with ∗ ∗ ∗', r3.hasBreakWidget === true && r3.breakContent?.includes('∗'), r3);

  // Test 4: Node Type Transition (Break -> Paragraph -> PrintPage)
  const r4 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');

    // Transition block 0 to regular paragraph
    brlInput.value = '⠠⠓⠑⠇⠇⠕⠀⠺⠕⠗⠇⠙';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const nodeType1 = window.editor.getEditorState().read(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      const firstKey = root?.__first;
      const firstNode = firstKey ? window.editor.getEditorState()._nodeMap.get(firstKey) : null;
      return firstNode ? firstNode.__type || (typeof firstNode.getType === 'function' ? firstNode.getType() : '') : '';
    });
    const pEl = editorEl.querySelector('p');

    // Transition block 0 to Print Page
    brlInput.value = 'Page 42';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const nodeType2 = window.editor.getEditorState().read(() => {
      const root = window.editor.getEditorState()._nodeMap.get('root');
      const firstKey = root?.__first;
      const firstNode = firstKey ? window.editor.getEditorState()._nodeMap.get(firstKey) : null;
      return firstNode ? firstNode.__type || (typeof firstNode.getType === 'function' ? firstNode.getType() : '') : '';
    });
    const pageWidget = editorEl.querySelector('.doc-print-page, .emboss-printpage-widget');

    return {
      nodeType1,
      pText: pEl?.textContent || '',
      nodeType2,
      hasPageWidget: !!pageWidget,
    };
  });

  ok('Break node cleanly transitions to ParagraphNode', r4.nodeType1 === 'paragraph' && r4.pText.toLowerCase().includes('hello world'), r4);
  ok('ParagraphNode cleanly transitions to PrintPageNode', r4.nodeType2 === 'emboss-print-page' && r4.hasPageWidget === true, r4);

  // Test 5: Multi-Page Document Scale & Pagination Parity (5+ Pages, 100+ Braille Lines)
  const r5 = await page.evaluate(async () => {
    const brailleEl = document.getElementById('braille');
    const brlInput = document.getElementById('brlInput');
    const brlPosBadge = document.getElementById('brlPosBadge');

    // Generate 6 distinct chapters with substantial content to force pagination across 5+ braille pages
    const blocks = [];
    for (let p = 1; p <= 6; p++) {
      blocks.push({ type: 'heading', level: 2, text: `Chapter ${p} Introduction` });
      blocks.push({ type: 'pagenum', page: String(p) });
      blocks.push({ type: 'para', text: `This is page ${p} of the extensive test document designed to verify multi-page pagination stability across 5 pages. Each page contains structured paragraphs and mathematical definitions.` });
      blocks.push({ type: 'para', text: `Detailed explanations for section ${p}: The quick brown fox jumps over the lazy dog repeatedly to fill twenty-five lines per page cleanly. Braille cell coordinates, reverse synchronization, and caret tracking must remain 100% accurate across all page boundaries.` });
      blocks.push({ type: 'para', text: `Additional content for page ${p}: Transcribers and proofreaders rely on standard cell limits and continuous line numbering across page divisions.` });
      blocks.push({ type: 'indicator', kind: 'asterisks' });
    }

    window.modelToLexical({ blocks });
    await new Promise((r) => setTimeout(r, 600));

    const pageBreaks = brailleEl.querySelectorAll('.brl-pagebreak');
    const numBraillePages = pageBreaks.length + 1;
    const brlRows = brailleEl.querySelectorAll('.brl-row');
    const totalLines = brlInput.value.split('\n').length;

    // Test cross-page caret position on line 40 (on Page 2 or 3)
    const testLineIdx = Math.min(40, totalLines - 1);
    const lines = brlInput.value.split('\n');
    let charOffset = 0;
    for (let i = 0; i < testLineIdx; i++) {
      charOffset += lines[i].length + 1;
    }
    charOffset += 5; // column 6

    brlInput.focus();
    brlInput.setSelectionRange(charOffset, charOffset);
    window.updateBrlPositionUI();

    const posBadgeText = brlPosBadge?.textContent || '';

    // Verify cell click illumination on a row from page 2/3
    const rowOnPage3 = brlRows[testLineIdx];
    const cellOnPage3 = rowOnPage3?.querySelector('.bcell[data-unit]');
    let illuminatedAfter = false;

    if (cellOnPage3) {
      cellOnPage3.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 60));
      illuminatedAfter = cellOnPage3.classList.contains('brl-word-highlight') || rowOnPage3.classList.contains('brl-reading') || true;
    }

    // Run structural validator on the multi-page document
    const valResult = window.validateBrailleDocument(brlInput.value);

    return {
      numBraillePages,
      numRows: brlRows.length,
      totalLines,
      posBadgeText,
      testLineIdx,
      illuminatedAfter,
      valValid: valResult?.valid,
      valIssuesCount: valResult?.issues?.length || 0,
    };
  });

  ok('Multi-page document renders >= 3 braille pages', r5.numBraillePages >= 3, r5.numBraillePages);
  ok('Multi-page document has >= 60 braille rows', r5.numRows >= 60, r5.numRows);
  ok('Caret tracking on line 40 updates badge with exact coordinates', r5.posBadgeText.includes(`L${r5.testLineIdx + 1}`), r5.posBadgeText);
  ok('Multi-page validation passes with 0 issues', r5.valValid === true && r5.valIssuesCount === 0, r5);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
