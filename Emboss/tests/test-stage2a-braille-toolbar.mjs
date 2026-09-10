import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 2A RHS Braille Toolbar Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && !!document.getElementById('brailleToolbar'),
                'editor and brailleToolbar to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: Toolbar presence and initial placement in title bar
  const r1 = await page.evaluate(() => {
    const tb = document.getElementById('brailleToolbar');
    const header = document.getElementById('brailleLabel');
    return {
      exists: !!tb,
      inHeader: header.contains(tb),
      visible: window.getComputedStyle(tb).display !== 'none',
    };
  });
  ok('RHS braille toolbar exists in title bar header', r1.exists && r1.inHeader, r1);
  ok('RHS braille toolbar is visible on load', r1.visible, r1);

  // Test 2: Perkins 6-key button (⠼⠋) toggle
  const r2 = await page.evaluate(() => {
    const btn = document.getElementById('btnBrlSixKey');
    const label = btn.textContent.trim();
    const initPressed = btn.getAttribute('aria-pressed');
    
    // Toggle off
    btn.click();
    const pressedAfter1 = btn.getAttribute('aria-pressed');
    
    // Toggle back on
    btn.click();
    const pressedAfter2 = btn.getAttribute('aria-pressed');

    return { label, initPressed, pressedAfter1, pressedAfter2 };
  });
  ok('btnBrlSixKey uses exact ⠼⠋ glyph matching LHS toolbar', r2.label === '⠼⠋', r2);
  ok('btnBrlSixKey toggles aria-pressed state', r2.initPressed === 'true' && r2.pressedAfter1 === 'false' && r2.pressedAfter2 === 'true', r2);

  // Test 3: BRF ASCII Braille toggle & Synchronized Highlighting in ASCII Mode
  const r3 = await page.evaluate(() => {
    const btn = document.getElementById('btnBrlAscii');
    const input = document.getElementById('brlInput');
    const editor = document.getElementById('editor');
    const label1 = btn.textContent.trim();
    const initPressed = btn.getAttribute('aria-pressed');

    // Toggle to ASCII
    btn.click();
    const pressedAfter1 = btn.getAttribute('aria-pressed');
    const isMonoFont = input.style.fontFamily.includes('monospace');
    const bcellsAscii = document.querySelectorAll('#braille .bcell');
    const asciiContent = input.value;

    // Test 1: Click braille cell in ASCII mode -> LHS print highlight
    const firstCellWithChar = document.querySelector('#braille .bcell[data-char]');
    let printHighlightedCount = 0;
    let brailleHlCount = 0;
    if (firstCellWithChar) {
      firstCellWithChar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      printHighlightedCount = editor.querySelectorAll('.print-linked').length;
      brailleHlCount = document.querySelectorAll('#braille .cell-hl').length;
    }

    // Test 2: Horizontal and Vertical alignment in ASCII mode
    const firstRow = document.querySelector('#braille .brl-row');
    const rowCells = firstRow ? Array.from(firstRow.querySelectorAll('.bcell')) : [];
    const cellWidth = rowCells[0] ? rowCells[0].getBoundingClientRect().width : 12.75;

    let maxDriftX = 0;
    rowCells.forEach((cell, i) => {
      const cellRect = cell.getBoundingClientRect();
      const expectedInputX = 14 + (i * cellWidth);
      const actualBrailleX = cellRect.left - document.getElementById('braille').getBoundingClientRect().left;
      const drift = Math.abs(actualBrailleX - expectedInputX);
      if (drift > maxDriftX) maxDriftX = drift;
    });

    // Toggle back to Unicode
    btn.click();
    const pressedAfter2 = btn.getAttribute('aria-pressed');

    return {
      label1,
      initPressed,
      pressedAfter1,
      isMonoFont,
      hasBcells: bcellsAscii.length > 20,
      printHighlightedCount,
      brailleHlCount,
      maxDriftX,
      pressedAfter2,
    };
  });
  ok('btnBrlAscii label is BRF', r3.label1 === 'BRF', r3);
  ok('btnBrlAscii toggles aria-pressed and applies monospace font', r3.initPressed === 'false' && r3.pressedAfter1 === 'true' && r3.isMonoFont, r3);
  ok('ASCII mode renders rich interactive bcell spans', r3.hasBcells, r3);
  ok('Clicking a cell in ASCII mode synchronizes print and braille highlights', r3.printHighlightedCount >= 1 && r3.brailleHlCount >= 1, r3);
  ok('Zero horizontal caret drift in ASCII mode (maxDrift <= 0.05px)', r3.maxDriftX <= 0.05, r3);
  ok('btnBrlAscii toggles back to Unicode', r3.pressedAfter2 === 'false', r3);

  // Test 4: Insert / Overwrite toggle (INS vs OVR)
  const r4 = await page.evaluate(() => {
    const btn = document.getElementById('btnBrlInsertMode');
    const label1 = btn.textContent.trim();

    // Toggle to OVR
    btn.click();
    const label2 = btn.textContent.trim();

    return { label1, label2 };
  });
  ok('btnBrlInsertMode initial label is INS', r4.label1 === 'INS', r4);
  ok('btnBrlInsertMode toggles to OVR', r4.label2 === 'OVR', r4);

  // Test 5: Overwrite mode functionality (6-key chording)
  const r5 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    input.value = '⠁⠃⠉';
    input.focus();
    input.setSelectionRange(1, 1); // at '⠃'

    // Type Dot 4 (KeyJ -> '⠈') with 6-key
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', bubbles: true }));

    // Reset back to INS mode
    document.getElementById('btnBrlInsertMode').click();

    return {
      value: input.value,
      pos: input.selectionStart,
    };
  });
  ok('Overwrite mode (OVR) replaces cell at caret with ⠈', r5.value === '⠁⠈⠉', r5);
  ok('Caret advances to index 2 after overwrite', r5.pos === 2, r5);

  // Test 5B: Direct non-chord typing and universal overwrite when 6-key is OFF
  const r5b = await page.evaluate(() => {
    const btnSixKey = document.getElementById('btnBrlSixKey');
    const btnInsert = document.getElementById('btnBrlInsertMode');
    const input = document.getElementById('brlInput');

    // Turn 6-key OFF
    btnSixKey.click(); // six-key is now false

    // Direct type 'd' -> should convert to '⠙'
    input.value = '';
    input.focus();
    input.value = 'd';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const valDirect = input.value;

    // Enable Overwrite mode
    btnInsert.click(); // OVR mode
    input.setSelectionRange(0, 0); // at '⠙'

    // Universal overwrite keydown on Space
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    const selAfterOvrKeydown = { start: input.selectionStart, end: input.selectionEnd };

    // Turn 6-key back ON and OVR back to INS
    btnInsert.click(); // back to INS
    btnSixKey.click(); // back to ON

    return { valDirect, selAfterOvrKeydown };
  });
  ok('Direct typing when 6-key is OFF converts ASCII to braille (d -> ⠙)', r5b.valDirect === '⠙', r5b);
  ok('Universal Overwrite selects target cell forward [0, 1] on keydown', r5b.selAfterOvrKeydown.start === 0 && r5b.selAfterOvrKeydown.end === 1, r5b);

  // Test 5C: Real-time visual re-rendering of #braille dot layer
  const r5c = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const braille = document.getElementById('braille');

    input.value = '⠇⠕⠧⠑'; // 'love'
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const bcells = braille.querySelectorAll('.bcell');
    return {
      cellCount: bcells.length,
      hasCells: bcells.length >= 4,
    };
  });
  ok('Typing in brlInput immediately updates visual #braille SVG dot cells', r5c.hasCells, r5c);

  // Test 6: Margin Dropdown selector
  const r6 = await page.evaluate(() => {
    const sel = document.getElementById('selBrlMargin');
    const optionValues = [...sel.options].map(o => o.value);
    
    sel.value = 'exercise';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    const activeStyle = window.getBrlMarginStyle();
    
    // Reset back to body
    sel.value = 'body';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    return { activeStyle, optionValues };
  });
  ok('selBrlMargin contains body, h1 (Centered Heading), h2, h3, list-bullet, exercise', r6.optionValues.includes('h1') && r6.optionValues.includes('body') && r6.optionValues.length === 6, r6);
  ok('selBrlMargin updates active margin preset to exercise', r6.activeStyle === 'exercise', r6);

  // Test 7: Dropdown Centered Heading (h1) selection centers active line
  const r7 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const sel = document.getElementById('selBrlMargin');
    input.value = '⠠⠓⠑⠁⠙'; // 5 chars
    input.focus();
    input.setSelectionRange(2, 2);

    // Select Centered Heading
    sel.value = 'h1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    const leadingSpaces = input.value.length - input.value.trimStart().length;

    // Press Enter on h1 -> resets to body with Cell 3 (2 spaces) indent
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const valAfterEnter = input.value;
    const styleAfterEnter = window.getBrlMarginStyle();

    return {
      leadingSpaces,
      valAfterEnter,
      styleAfterEnter,
    };
  });
  ok('Selecting h1 in selBrlMargin centers active line across 40 cells (17 spaces)', r7.leadingSpaces === 17, r7);
  ok('Pressing Enter on h1 automatically returns to body style with Cell 3 indent', r7.styleAfterEnter === 'body' && r7.valAfterEnter.endsWith('\n  '), r7);

  // Test 8: Tab switching hides toolbar on DotPad and restores on Braille
  const r8 = await page.evaluate(() => {
    const tb = document.getElementById('brailleToolbar');
    const tabDotPad = document.getElementById('tabViewDotPad');
    const tabBraille = document.getElementById('tabViewBraille');

    tabDotPad.style.display = 'inline-flex';
    tabDotPad.click();
    const displayDotPad = tb.style.display;

    tabBraille.click();
    const displayBraille = tb.style.display;
    tabDotPad.style.display = 'none';

    return { displayDotPad, displayBraille };
  });
  ok('Switching to DotPad hides brailleToolbar', r8.displayDotPad === 'none', r8);
  ok('Switching to Braille View restores brailleToolbar', r8.displayBraille === 'inline-flex', r8);

  // Test 9: Zero horizontal overflow in header and braille stack
  const r9 = await page.evaluate(() => {
    const header = document.getElementById('brailleLabel');
    const stack = document.getElementById('brlStack');
    return {
      headerOverflow: header.scrollWidth > header.clientWidth,
      stackOverflow: stack.scrollWidth > stack.clientWidth,
    };
  });
  ok('Zero horizontal overflow in title bar header', r9.headerOverflow === false, r9);
  ok('Zero horizontal overflow in braille stack', r9.stackOverflow === false, r9);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) process.exit(1);
})();
