import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 3C Proof Status, Cell Counter & Structural Validation Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.validateBrailleDocument === 'function',
                'editor and validation engine to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: Cursor Position Tracking (L X, C Y / Max)
  const r1 = await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const posBadge = document.getElementById('brlPosBadge');

    brlInput.value = '⠠⠉⠓⠁⠏⠞⠑⠗⠀⠠⠕⠝⠑\n⠠⠎⠑⠉⠞⠊⠕⠝⠀⠠⠕⠝⠑';
    // Position at start of line 1 (index 0) -> Line 1, Cell 1
    brlInput.setSelectionRange(0, 0);
    window.updateBrlPositionUI();
    const tStart = posBadge?.textContent || '';

    // Position on Line 2 (Line 1 length is 13 + 1 newline = 14).
    // Index 19 is 5 chars into Line 2 -> Line 2, Cell 6 (1-indexed)
    brlInput.setSelectionRange(19, 19);
    window.updateBrlPositionUI();
    const tLine2 = posBadge?.textContent || '';

    return { tStart, tLine2 };
  });

  ok('Position badge shows L1, C1 at start', r1.tStart.includes('L1, C1'), r1.tStart);
  ok('Position badge shows L2, C6 on second line', r1.tLine2.includes('L2, C6'), r1.tLine2);

  // Test 2: Cell Width Overflow Warning
  const r2 = await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const posBadge = document.getElementById('brlPosBadge');

    // Create a 45-cell line which exceeds 40-cell limit
    brlInput.value = '⠁'.repeat(45);
    brlInput.setSelectionRange(45, 45);
    window.updateBrlPositionUI();
    const hasOverflow = posBadge?.classList.contains('brl-pos-overflow');
    const overText = posBadge?.textContent || '';

    // Now reset to 20 cells
    brlInput.value = '⠁'.repeat(20);
    brlInput.setSelectionRange(20, 20);
    window.updateBrlPositionUI();
    const noOverflow = !posBadge?.classList.contains('brl-pos-overflow');

    return { hasOverflow, overText, noOverflow };
  });

  ok('Position badge adds brl-pos-overflow class when line exceeds max cells', r2.hasOverflow === true, r2);
  ok('Position badge text reflects C46/40', r2.overText.includes('C46/40'), r2.overText);
  ok('Position badge clears overflow class when within limit', r2.noOverflow === true, r2);

  // Test 3: Live Sync Status Lifecycle Transitions
  const r3 = await page.evaluate(async () => {
    const syncStatus = document.getElementById('brlSyncStatus');
    
    // Initial state: synced
    window.updateBrlSyncStatus('synced');
    const isSyncedInitial = syncStatus?.classList.contains('synced') && syncStatus?.textContent.includes('Synced');

    // Editing state:
    window.updateBrlSyncStatus('editing');
    const isEditing = syncStatus?.classList.contains('editing') && syncStatus?.textContent.includes('Editing');

    // Syncing state:
    window.updateBrlSyncStatus('syncing');
    const isSyncing = syncStatus?.classList.contains('syncing') && syncStatus?.textContent.includes('Syncing');

    // Complete reconciliation:
    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 60));
    const isSyncedFinal = syncStatus?.classList.contains('synced') && syncStatus?.textContent.includes('Synced');

    return { isSyncedInitial, isEditing, isSyncing, isSyncedFinal };
  });

  ok('Sync status starts as Synced', r3.isSyncedInitial === true, r3);
  ok('Sync status transitions to Editing...', r3.isEditing === true, r3);
  ok('Sync status transitions to Syncing...', r3.isSyncing === true, r3);
  ok('Sync status settles back to Synced after reconciliation', r3.isSyncedFinal === true, r3);

  // Test 4: Structural Validation Unit Tests (validateBrailleDocument)
  const r4 = await page.evaluate(() => {
    const fn = window.validateBrailleDocument;

    // 4a. Valid braille document
    const vValid = fn('⠠⠉⠓⠁⠏⠞⠑⠗⠀⠠⠕⠝⠑\n  ⠠⠹⠊⠎⠀⠊⠎⠀⠁⠀⠏⠁⠗⠁⠛⠗⠁⠏⠓⠄', { cells: 40 });

    // 4b. Unclosed Nemeth switch (Unicode)
    const vNemUnclosed = fn('⠠⠍⠁⠞⠓⠀⠸⠩⠼⠁⠬⠼⠃', { cells: 40 });

    // 4c. Unmatched closing Nemeth switch
    const vNemUnmatchedClose = fn('⠠⠞⠑⠭⠞⠀⠸⠱', { cells: 40 });

    // 4d. Balanced Nemeth switch
    const vNemBalanced = fn('⠠⠍⠁⠞⠓⠀⠸⠩⠼⠁⠬⠼⠃⠸⠱', { cells: 40 });

    // 4e. Unclosed boxline (Unicode)
    const vBoxUnclosed = fn('⠒⠒⠒⠀⠠⠝⠕⠞⠑⠀⠒⠒⠒\n  ⠠⠎⠊⠙⠑⠃⠁⠗⠀⠞⠑⠭⠞⠄', { cells: 40 });

    // 4f. Balanced boxline (Unicode)
    const vBoxBalanced = fn('⠒⠒⠒⠀⠠⠝⠕⠞⠑⠀⠒⠒⠒\n  ⠠⠎⠊⠙⠑⠃⠁⠗⠀⠞⠑⠭⠞⠄\n⠒⠒⠒⠒⠒⠒⠒⠒⠒⠒', { cells: 40 });

    // 4g. Line overflow (> 40 cells)
    const vOverflow = fn('⠁'.repeat(45), { cells: 40 });

    // 4h. ASCII Nemeth switches
    const vAsciiNemValid = fn('Math _%1+2_:', { cells: 40, asciiBraille: true });
    const vAsciiNemUnclosed = fn('Math _%1+2', { cells: 40, asciiBraille: true });

    return {
      vValid,
      vNemUnclosed,
      vNemUnmatchedClose,
      vNemBalanced,
      vBoxUnclosed,
      vBoxBalanced,
      vOverflow,
      vAsciiNemValid,
      vAsciiNemUnclosed,
    };
  });

  ok('Valid document returns valid: true', r4.vValid.valid === true && r4.vValid.issues.length === 0, r4.vValid);
  ok('Unclosed Nemeth switch is flagged', r4.vNemUnclosed.valid === false && r4.vNemUnclosed.issues.some(i => i.type === 'unclosed-nemeth'), r4.vNemUnclosed);
  ok('Unmatched closing Nemeth switch is flagged', r4.vNemUnmatchedClose.valid === false && r4.vNemUnmatchedClose.issues.some(i => i.type === 'unmatched-nemeth-close'), r4.vNemUnmatchedClose);
  ok('Balanced Nemeth switch returns valid: true', r4.vNemBalanced.valid === true && r4.vNemBalanced.issues.length === 0, r4.vNemBalanced);
  ok('Unclosed sidebar boxline is flagged', r4.vBoxUnclosed.valid === false && r4.vBoxUnclosed.issues.some(i => i.type === 'unclosed-box'), r4.vBoxUnclosed);
  ok('Balanced sidebar boxline returns valid: true', r4.vBoxBalanced.valid === true && r4.vBoxBalanced.issues.length === 0, r4.vBoxBalanced);
  ok('Line exceeding 40 cells is flagged as line-overflow', r4.vOverflow.valid === false && r4.vOverflow.issues.some(i => i.type === 'line-overflow'), r4.vOverflow);
  ok('ASCII Nemeth switch balanced returns valid: true', r4.vAsciiNemValid.valid === true, r4.vAsciiNemValid);
  ok('ASCII Nemeth switch unclosed is flagged', r4.vAsciiNemUnclosed.valid === false, r4.vAsciiNemUnclosed);

  // Test 5: Live UI Validation Badge & Navigation
  const r5 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const valBadge = document.getElementById('brlValidationBadge');

    // Document with error on line 2 (unclosed Nemeth switch)
    brlInput.value = '⠠⠉⠓⠁⠏⠞⠑⠗⠀⠠⠕⠝⠑\n⠠⠍⠁⠞⠓⠀⠸⠩⠼⠁\n⠠⠎⠑⠉⠕⠝⠙⠀⠇⠊⠝⠑';
    brlInput.setSelectionRange(0, 0);
    window.runBrailleValidation();

    const badgeHasError = valBadge?.classList.contains('error') || valBadge?.classList.contains('warn');
    const badgeText = valBadge?.textContent || '';

    // Click badge to navigate to the issue
    window.jumpToBrailleIssue();
    const selAfter = brlInput.selectionStart;
    const linesBefore = brlInput.value.slice(0, selAfter).split('\n');
    const lineIndexAfter = linesBefore.length;

    return { badgeHasError, badgeText, selAfter, lineIndexAfter };
  });

  ok('Validation badge displays issue count with error styling', r5.badgeHasError === true && r5.badgeText.includes('1 issue'), r5);
  ok('Clicking validation badge navigates caret to the offending line (Line 2)', r5.lineIndexAfter === 2, r5);

  // Test 6: Mutex Safety & 3-Way Synchronization
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
  process.exit(0);
})();
