import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 3B.1 Margin Pattern & Structure Sync Tests ---');
  
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

  // Test 1: Unit Pattern Detection Tests
  const r1 = await page.evaluate(() => {
    const fn = window.detectBrailleBlockStyle;
    const center = window.centerBrailleText('⠠⠉⠓⠁⠏⠞⠑⠗⠀⠠⠕⠝⠑', 40);
    const sCenter = fn([center], { cells: 40 });
    const sH2 = fn(['    ⠠⠎⠑⠉⠞⠊⠕⠝⠀⠠⠕⠝⠑'], { cells: 40 });
    const sH3 = fn(['      ⠠⠞⠕⠏⠊⠉⠀⠠⠁'], { cells: 40 });
    const sP31 = fn(['  ⠠⠹⠊⠎⠀⠊⠎⠀⠁⠀⠏⠁⠗⠁⠛⠗⠁⠏⠓⠄'], { cells: 40 });
    const sP11 = fn(['⠠⠹⠊⠎⠀⠊⠎⠀⠋⠇⠥⠱⠀⠇⠑⠋⠞⠄'], { cells: 40 });
    return { sCenter, sH2, sH3, sP31, sP11 };
  });

  ok('Centered line detects as h1', r1.sCenter.style === 'h1' && r1.sCenter.isHeading === true, r1.sCenter);
  ok('4-space indent detects as h2', r1.sH2.style === 'h2' && r1.sH2.isHeading === true, r1.sH2);
  ok('6-space indent detects as h3', r1.sH3.style === 'h3' && r1.sH3.isHeading === true, r1.sH3);
  ok('2-space indent detects as body (3-1)', r1.sP31.style === 'body' && r1.sP31.isHeading === false, r1.sP31);
  ok('0-space indent detects as body (1-1)', r1.sP11.style === 'body' && r1.sP11.isHeading === false, r1.sP11);

  // Test 2: Live Reverse Sync for Centered Heading (h1)
  const r2 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    const centeredText = window.centerBrailleText('⠠⠉⠓⠁⠏⠞⠑⠗⠀⠠⠕⠝⠑', 40);
    brlInput.value = centeredText;
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const h1El = editorEl.querySelector('h1');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      hasH1: !!h1El,
      h1Text: h1El?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('Reconcile detects centered heading', r2.hasChanges === true && r2.detectedStyle === 'h1', r2);
  ok('LHS print panel creates <h1> node', r2.hasH1 === true, r2);
  ok('LHS print <h1> text contains Chapter One', r2.h1Text.toLowerCase().includes('chapter one'), r2);
  ok('LHS toolbar dropdown reflects h1', r2.blockStyleVal === 'h1', r2);

  // Test 3: Live Reverse Sync for Cell-5 Heading (h2)
  const r3 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    brlInput.value = '    ⠠⠎⠑⠉⠞⠊⠕⠝⠀⠠⠕⠝⠑';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const h2El = editorEl.querySelector('h2');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      hasH2: !!h2El,
      h2Text: h2El?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('4-space indent creates <h2> node in LHS print panel', r3.hasH2 === true, r3);
  ok('LHS print <h2> text contains Section One', r3.h2Text.toLowerCase().includes('section one'), r3);
  ok('LHS toolbar dropdown reflects h2', r3.blockStyleVal === 'h2', r3);

  // Test 4: Live Reverse Sync for Cell-7 Heading (h3)
  const r4 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    brlInput.value = '      ⠠⠞⠕⠏⠊⠉⠀⠠⠁';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const h3El = editorEl.querySelector('h3');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      hasH3: !!h3El,
      h3Text: h3El?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('6-space indent creates <h3> node in LHS print panel', r4.hasH3 === true, r4);
  ok('LHS print <h3> text contains Topic A', r4.h3Text.toLowerCase().includes('topic a'), r4);
  ok('LHS toolbar dropdown reflects h3', r4.blockStyleVal === 'h3', r4);

  // Test 5: Live Reverse Sync mutating Heading back to Paragraph
  const r5 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    brlInput.value = '  ⠠⠹⠊⠎⠀⠊⠎⠀⠁⠀⠏⠁⠗⠁⠛⠗⠁⠏⠓⠄';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const block0El = editorEl.querySelector('[data-block-idx="0"]') || editorEl.children[0];
    const isParagraph = block0El ? (block0El.tagName === 'P' || block0El.classList.contains('ed-p')) : false;
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      isParagraph,
      block0Tag: block0El?.tagName,
      block0OuterHTML: block0El?.outerHTML,
      pText: block0El?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('Heading mutates back to <p> paragraph node', r5.isParagraph === true, r5);
  ok('LHS print paragraph contains text', r5.pText.toLowerCase().includes('paragraph'), r5);
  ok('LHS toolbar dropdown resets to p', r5.blockStyleVal === 'p', r5);

  // Test 6: 3-Way Panel Synchronization
  const r6 = await page.evaluate(() => {
    const editorEl = document.getElementById('editor');
    const brlInput = document.getElementById('brlInput');

    const rows = Array.from(document.querySelectorAll('#braille .brl-row'));
    const rowWithBlock = rows.find(r => r.hasAttribute('data-block')) || rows[0];
    let printLinkedCount = 0;
    if (rowWithBlock) {
      const cell = rowWithBlock.querySelector('.bcell') || rowWithBlock;
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      printLinkedCount = editorEl.querySelectorAll('.print-linked').length;
    }

    return {
      printLinkedCount,
      inputPreserved: brlInput.value.length > 0,
      isReconciling: window.isReconcilingBrailleToPrint(),
    };
  });

  ok('Clicking braille cell illuminates print block', r6.printLinkedCount > 0, r6);
  ok('#brlInput remains populated and synchronized', r6.inputPreserved === true, r6);
  ok('Mutex is false after structure reconciliation', r6.isReconciling === false, r6);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
