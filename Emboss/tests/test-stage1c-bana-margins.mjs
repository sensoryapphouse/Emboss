import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 1C.1 BANA Margin Presets & Enter Indentation Tests ---');
  
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.argv.includes('--show'),
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  
  await context.addInitScript(() => {
    try {
      localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'ukaaf', grade: 'g2' }));
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && !!document.getElementById('brlInput') && document.getElementById('brlInput').value.length > 20,
                'editor and braille to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: Paragraph (3-1) Enter indentation
  const r1 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('body');
    input.value = '⠁⠃⠉';
    input.focus();
    input.setSelectionRange(0, 0);

    // Press Enter (First line of paragraph starts at Cell 3 -> 2 leading spaces)
    const enterEvt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(enterEvt);

    return {
      head: input.value.slice(0, 3), // Expect "\n  "
      pos: input.selectionStart,
    };
  });
  ok('Paragraph 3-1 Enter inserts newline with 2 leading spaces (Cell 3)', r1.head === '\n  ', r1);
  ok('Caret lands at Cell 3 index (pos 3)', r1.pos === 3, r1.pos);

  // Test 2: Paragraph (3-1) Shift+Enter runover indentation
  const r2 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('body');
    input.value = '⠁⠃⠉';
    input.focus();
    input.setSelectionRange(3, 3);

    // Press Shift+Enter (Runover of paragraph starts at Cell 1 -> 0 leading spaces)
    const shiftEnterEvt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, cancelable: true, bubbles: true });
    input.dispatchEvent(shiftEnterEvt);

    return {
      head: input.value.slice(3, 4), // Expect "\n"
      pos: input.selectionStart,
    };
  });
  ok('Paragraph 3-1 Shift+Enter inserts runover at Cell 1 with 0 spaces', r2.head === '\n', r2);
  ok('Caret lands at pos 4', r2.pos === 4, r2.pos);

  // Test 3: List (1-3) Enter & Shift+Enter
  const r3 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('list-bullet');
    input.value = '⠁⠃⠉';
    input.focus();
    input.setSelectionRange(3, 3);

    // Enter on list -> First line is Cell 1 (0 spaces)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true, bubbles: true }));
    const p1 = input.selectionStart;
    const c1 = input.value.slice(3, 4);

    // Shift+Enter on list -> Runover is Cell 3 (2 spaces)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, cancelable: true, bubbles: true }));
    const p2 = input.selectionStart;
    const c2 = input.value.slice(4, 7);

    return { p1, c1, p2, c2 };
  });
  ok('List 1-3 Enter inserts line starting at Cell 1 (0 spaces)', r3.c1 === '\n' && r3.p1 === 4, r3);
  ok('List 1-3 Shift+Enter inserts runover starting at Cell 3 (2 spaces)', r3.c2 === '\n  ' && r3.p2 === 7, r3);

  // Test 4: Exercise (1-5) Enter & Shift+Enter
  const r4 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('exercise');
    input.value = '⠁⠃⠉';
    input.focus();
    input.setSelectionRange(3, 3);

    // Enter on exercise -> First line is Cell 1 (0 spaces)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true, bubbles: true }));
    const p1 = input.selectionStart;
    const c1 = input.value.slice(3, 4);

    // Shift+Enter on exercise -> Runover is Cell 5 (4 spaces)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, cancelable: true, bubbles: true }));
    const p2 = input.selectionStart;
    const c2 = input.value.slice(4, 9);

    return { p1, c1, p2, c2 };
  });
  ok('Exercise 1-5 Enter starts at Cell 1', r4.c1 === '\n' && r4.p1 === 4, r4);
  ok('Exercise 1-5 Shift+Enter indents 4 spaces for Cell 5 runover', r4.c2 === '\n    ' && r4.p2 === 9, r4);

  // Test 5: Subheading (5-5) Enter
  const r5 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('h2');
    input.value = '⠁⠃⠉';
    input.focus();
    input.setSelectionRange(3, 3);

    // Enter on Heading 2 -> Cell 5 (4 spaces)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true, bubbles: true }));

    return {
      head: input.value.slice(3, 8),
      pos: input.selectionStart,
    };
  });
  ok('Heading 2 (5-5) Enter starts at Cell 5 with 4 spaces', r5.head === '\n    ' && r5.pos === 8, r5);

  // Test 6: Auto-Centering calculation
  const r6 = await page.evaluate(async () => {
    const centered = window.centerBrailleText('⠠⠓⠑⠁⠙⠊⠝⠛', 40); // 7 chars in 40 width -> padLeft = Math.floor((40-7)/2) = 16
    return {
      centered,
      leadingSpaces: centered.length - centered.trimStart().length,
    };
  });
  ok('centerBrailleText centers text across 40 cells with 16 leading spaces', r6.leadingSpaces === 16, r6);

  // Test 7: Auto-Centering boundary limit
  const r7 = await page.evaluate(async () => {
    const longText = '⠁'.repeat(36);
    const centered = window.centerBrailleText(longText, 40);
    return {
      leadingSpaces: centered.length - centered.trimStart().length,
    };
  });
  ok('centerBrailleText ensures 3-cell safety margin for long headings', r7.leadingSpaces === 3, r7);

  // Test 9: Paragraph (3-1) Word-Wrap at 40 cells
  const r9 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('body');
    input.focus();
    
    // Create a 35-character first line + space + 8-char word (total 44 chars)
    const line35 = '  ' + '⠁'.repeat(33); // 35 chars
    const word8 = '⠃'.repeat(8);
    input.value = line35 + ' ' + word8;
    input.setSelectionRange(input.value.length, input.value.length);
    
    // Trigger word-wrap
    window.applyBrlWordWrap(input, 40);
    
    const lines = input.value.split('\n');
    return {
      line1Len: lines[0].length,
      line2: lines[1],
      caret: input.selectionStart,
    };
  });
  ok('Paragraph 3-1 wraps word exceeding 40 cells to line 2', r9.line1Len === 35, r9);
  ok('Paragraph 3-1 line 2 starts at Cell 1 (0 spaces)', r9.line2 === '⠃'.repeat(8), r9);

  // Test 10: List (1-3) Word-Wrap at 40 cells with Cell 3 runover
  const r10 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('list-bullet');
    input.focus();
    
    const line36 = '⠁'.repeat(36);
    const word8 = '⠉'.repeat(8);
    input.value = line36 + ' ' + word8;
    input.setSelectionRange(input.value.length, input.value.length);
    
    window.applyBrlWordWrap(input, 40);
    
    const lines = input.value.split('\n');
    return {
      line1Len: lines[0].length,
      line2: lines[1],
    };
  });
  ok('List 1-3 wraps word exceeding 40 cells to line 2', r10.line1Len === 36, r10);
  ok('List 1-3 line 2 starts with 2 leading spaces (Cell 3 runover)', r10.line2 === '  ' + '⠉'.repeat(8), r10);

  // Test 11: Exercise (1-5) Word-Wrap at 40 cells with Cell 5 runover
  const r11 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('exercise');
    input.focus();
    
    const line36 = '⠁'.repeat(36);
    const word8 = '⠙'.repeat(8);
    input.value = line36 + ' ' + word8;
    input.setSelectionRange(input.value.length, input.value.length);
    
    window.applyBrlWordWrap(input, 40);
    
    const lines = input.value.split('\n');
    return {
      line1Len: lines[0].length,
      line2: lines[1],
    };
  });
  ok('Exercise 1-5 wraps word exceeding 40 cells to line 2', r11.line1Len === 36, r11);
  ok('Exercise 1-5 line 2 starts with 4 leading spaces (Cell 5 runover)', r11.line2 === '    ' + '⠙'.repeat(8), r11);

  // Test 12: Unbroken 50-character string hard chunks at cell 40
  const r12 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    window.setBrlMarginStyle('body');
    input.focus();
    
    const long50 = '⠿'.repeat(50);
    input.value = long50;
    input.setSelectionRange(50, 50);
    
    window.applyBrlWordWrap(input, 40);
    
    const lines = input.value.split('\n');
    return {
      line1Len: lines[0].length,
      line2Len: lines[1].length,
    };
  });
  ok('Unbroken string wraps exactly at cell 40', r12.line1Len === 40 && r12.line2Len === 10, r12);

  // Test 13: Caret tracking and zero overflow
  const r13 = await page.evaluate(async () => {
    const stack = document.getElementById('brlStack');
    const input = document.getElementById('brlInput');
    return {
      stackOverflow: stack.scrollWidth > stack.clientWidth,
      inputOverflow: input.scrollWidth > input.clientWidth + 2,
    };
  });
  ok('Zero horizontal overflow preserved across word-wrapped text', r13.stackOverflow === false && r13.inputOverflow === false, r13);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) process.exit(1);
})();
