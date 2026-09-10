import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 3A.1 Reconciliation Mutex & Sync Tests ---');
  
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.argv.includes('--show'),
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  
  await context.addInitScript(() => {
    try {
      localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'ukaaf', grade: 'g2', cells: 40, lines: 25 }));
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.detectBrailleBufferChanges === 'function',
                'editor and reconciliation engine to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: Initial Mutex State & Buffer Tracking
  const r1 = await page.evaluate(() => {
    const isReconciling = window.isReconcilingBrailleToPrint?.();
    const lastRendered = window.getLastRenderedBrailleText?.();
    const input = document.getElementById('brlInput');
    return {
      isReconciling,
      hasLastRendered: typeof lastRendered === 'string' && lastRendered.length > 0,
      matchesInput: lastRendered === input?.value,
      hasDetectFn: typeof window.detectBrailleBufferChanges === 'function',
      hasReconcileFn: typeof window.reconcileBrailleChangeToPrint === 'function',
    };
  });
  ok('isReconcilingBrailleToPrint starts false', r1.isReconciling === false, r1);
  ok('lastRenderedBrailleText tracks initial braille input buffer', r1.hasLastRendered && r1.matchesInput, r1);
  ok('detectBrailleBufferChanges and reconcileBrailleChangeToPrint functions are exported', r1.hasDetectFn && r1.hasReconcileFn, r1);

  // Test 2: Synchronized Highlighting in Unicode Braille Mode
  const r2 = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    const firstCell = document.querySelector('#braille .bcell[data-char]');
    let printHlCount = 0;
    let brailleHlCount = 0;
    if (firstCell) {
      firstCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      printHlCount = editor.querySelectorAll('.print-linked').length;
      brailleHlCount = document.querySelectorAll('#braille .cell-hl').length;
    }
    return { printHlCount, brailleHlCount };
  });
  ok('Clicking a Unicode braille cell illuminates corresponding print block on LHS', r2.printHlCount > 0, r2);
  ok('Clicking a Unicode braille cell paints cell in gold', r2.brailleHlCount > 0, r2);

  // Test 3: Synchronized Highlighting in BRF ASCII Mode
  const r3 = await page.evaluate(() => {
    const btn = document.getElementById('btnBrlAscii');
    const editor = document.getElementById('editor');
    
    // Toggle to BRF ASCII mode:
    btn.click();
    const isAscii = btn.getAttribute('aria-pressed') === 'true';

    const firstCell = document.querySelector('#braille .bcell[data-char]');
    let printHlCount = 0;
    let brailleHlCount = 0;
    if (firstCell) {
      firstCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      printHlCount = editor.querySelectorAll('.print-linked').length;
      brailleHlCount = document.querySelectorAll('#braille .cell-hl').length;
    }

    // Toggle back to Unicode mode:
    btn.click();
    const isBackToUni = btn.getAttribute('aria-pressed') === 'false';

    return { isAscii, printHlCount, brailleHlCount, isBackToUni };
  });
  ok('Clicking a cell in BRF ASCII mode illuminates print block on LHS', r3.isAscii && r3.printHlCount > 0, r3);
  ok('Clicking a cell in BRF ASCII mode paints cell in gold', r3.brailleHlCount > 0, r3);
  ok('Toggling back to Unicode mode preserves parity', r3.isBackToUni, r3);

  // Test 4: Change Detection without edits
  const r4 = await page.evaluate(() => {
    return window.detectBrailleBufferChanges();
  });
  ok('detectBrailleBufferChanges returns hasChanges: false when buffer is unchanged', r4.hasChanges === false, r4);

  // Test 5: Change Detection with single-line modification
  const r5 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const origVal = input.value;
    const lines = origVal.split('\n');
    lines[0] = lines[0] + '⠁⠃⠉';
    input.value = lines.join('\n');

    const changes = window.detectBrailleBufferChanges();
    // restore
    input.value = origVal;
    return changes;
  });
  ok('detectBrailleBufferChanges detects line 0 modification and maps targetBlockIndex 0', r5.hasChanges === true && r5.startLine === 0 && r5.targetBlockIndex === 0, r5);

  // Test 6: Change Detection on middle line
  const r6 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const origVal = input.value;
    const lines = origVal.split('\n');
    if (lines.length > 2) {
      lines[2] = lines[2] + '⠙⠑';
      input.value = lines.join('\n');
    }
    const changes = window.detectBrailleBufferChanges();
    input.value = origVal;
    return changes;
  });
  ok('detectBrailleBufferChanges detects middle line change', r6.hasChanges === true && r6.startLine === 2, r6);

  // Test 7: Reconcile Execution & Loop-Free Mutex Transition
  const r7 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    const origVal = input.value;
    const lines = origVal.split('\n');
    lines[0] = lines[0] + '⠇⠍⠝';
    input.value = lines.join('\n');

    const result = window.reconcileBrailleChangeToPrint();
    const isReconcilingAfter = window.isReconcilingBrailleToPrint();
    const lastRenderedAfter = window.getLastRenderedBrailleText();

    // Verify input was not overwritten by a circular forward render
    const inputValRetained = input.value.includes('⠇⠍⠝');

    input.value = origVal;
    window.reconcileBrailleChangeToPrint();

    return {
      hasResult: !!result,
      isReconcilingAfter,
      inputValRetained,
      lastRenderedUpdated: lastRenderedAfter.includes('⠇⠍⠝'),
    };
  });
  ok('reconcileBrailleChangeToPrint executes successfully without throw', r7.hasResult, r7);
  ok('isReconcilingBrailleToPrint resets to false after execution', r7.isReconcilingAfter === false, r7);
  ok('Lexical update does not trigger circular overwrite of brlInput', r7.inputValRetained && r7.lastRenderedUpdated, r7);

  // Test 8: Debounced Reverse Sync Triggering on Input Event
  const r8 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    const origVal = input.value;
    input.value = origVal + '\n⠏⠟';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait for debounced timer (300ms)
    await new Promise((r) => setTimeout(r, 350));

    const lastRendered = window.getLastRenderedBrailleText();
    const synced = lastRendered.includes('⠏⠟');

    input.value = origVal;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));

    return { synced };
  });
  ok('Input event triggers debounced reconciliation and updates lastRenderedBrailleText', r8.synced, r8);

  // Test 9: Rapid Bi-Directional Typing Stress / No Deadlocks
  const r9 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    let threw = false;
    try {
      for (let i = 0; i < 10; i++) {
        input.value = input.value + '⠁';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        window.reconcileBrailleChangeToPrint();
      }
    } catch (e) {
      threw = true;
    }
    return { threw, isReconciling: window.isReconcilingBrailleToPrint() };
  });
  ok('Rapid bi-directional updates execute without deadlocks or throws', !r9.threw && r9.isReconciling === false, r9);

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  await browser.close();

  if (failures.length > 0) {
    process.exit(1);
  }
})();
