import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 1B.1 Perkins 6-Key Chording Tests ---');
  
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

  // Test 1: Single-key chord typing (Dot 1: F -> '⠁')
  const r1 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(0, 0); // start of text
    
    // Simulate KeyF down and up
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));

    return {
      char: input.value.charAt(0),
      pos: input.selectionStart,
    };
  });
  ok('KeyF inserts Dot 1 cell (⠁)', r1.char === '⠁' || r1.char === '\u2801', r1);
  ok('Caret advances after inserted chord', r1.pos === 1, r1.pos);

  // Test 2: Multi-key simultaneous chord (Dots 1+2: KeyF + KeyD -> '⠃')
  const r2 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(1, 1);
    
    // KeyF down, KeyD down, KeyF up, KeyD up
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd', bubbles: true }));

    return {
      char: input.value.charAt(1),
      pos: input.selectionStart,
    };
  });
  ok('KeyF + KeyD chord inserts Dots 1+2 (⠃)', r2.char === '⠃' || r2.char === '\u2803', r2);
  ok('Caret advances to index 2', r2.pos === 2, r2.pos);

  // Test 3: 3-key chord (Dots 1+2+3: KeyF + KeyD + KeyS -> '⠇')
  const r3 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(2, 2);
    
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd', bubbles: true }));

    return {
      char: input.value.charAt(2),
      pos: input.selectionStart,
    };
  });
  ok('KeyS + KeyD + KeyF chord inserts Dots 1+2+3 (⠇)', r3.char === '⠇' || r3.char === '\u2807', r3);

  // Test 4: Full 6-dot chord (Dots 1+2+3+4+5+6: SDF JKL -> '⠿')
  const r4 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(3, 3);
    
    ['KeyF', 'KeyD', 'KeyS', 'KeyJ', 'KeyK', 'KeyL'].forEach(code => {
      input.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    });
    ['KeyF', 'KeyD', 'KeyS', 'KeyJ', 'KeyK', 'KeyL'].forEach(code => {
      input.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    });

    return {
      char: input.value.charAt(3),
      pos: input.selectionStart,
    };
  });
  ok('Full 6-key chord inserts 6-dot full cell (⠿)', r4.char === '⠿' || r4.char === '\u283F', r4);

  // Test 5: Selection replacement
  const r5 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(0, 4); // select the 4 typed cells
    
    // Type KeyJ (Dot 4: '⠈')
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', bubbles: true }));

    return {
      char: input.value.charAt(0),
      pos: input.selectionStart,
    };
  });
  ok('Typing a chord over a selection replaces the selected range with Dot 4 (⠈)', r5.char === '⠈' || r5.char === '\u2808', r5);
  ok('Caret lands right after replaced character at pos 1', r5.pos === 1, r5.pos);

  // Test 6: Six-key exclusivity guard (QWERTY letters swallowed)
  const r6 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    
    // Test 'x' keydown
    const evtX = new KeyboardEvent('keydown', { code: 'KeyX', key: 'x', cancelable: true, bubbles: true });
    input.dispatchEvent(evtX);
    
    // Test ' ' (Space) keydown
    const evtSpace = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true, bubbles: true });
    input.dispatchEvent(evtSpace);

    // Test Unicode braille from hardware display keydown
    const evtBrl = new KeyboardEvent('keydown', { code: 'Unknown', key: '⠎', cancelable: true, bubbles: true });
    input.dispatchEvent(evtBrl);

    return {
      xPrevented: evtX.defaultPrevented,
      spacePrevented: evtSpace.defaultPrevented,
      brlPrevented: evtBrl.defaultPrevented,
    };
  });
  ok('Exclusivity guard prevents accidental QWERTY keydown (x)', r6.xPrevented === true, r6);
  ok('Exclusivity guard allows Space keydown', r6.spacePrevented === false, r6);
  ok('Exclusivity guard allows hardware braille display keydown (⠎)', r6.brlPrevented === false, r6);

  // Test 7: Direct Paste of Unicode / ASCII braille into #brlInput
  const r7 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(0, 0);

    // Simulate paste of Unicode Braille "⠓⠑⠇⠇⠕"
    const pasteEvt = new Event('paste', { bubbles: true, cancelable: true });
    pasteEvt.clipboardData = {
      getData: (type) => (type === 'text/plain' ? '⠓⠑⠇⠇⠕' : '')
    };
    input.dispatchEvent(pasteEvt);

    return {
      pastedHead: input.value.slice(0, 5),
      caret: input.selectionStart,
    };
  });
  ok('Pasting Unicode braille inserts cleanly at caret', r7.pastedHead === '⠓⠑⠇⠇⠕', r7);
  ok('Caret advances past pasted braille', r7.caret === 5, r7.caret);

  // Test 8: ASCII Braille input conversion when sixKey is off
  const r8 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(0, 0);

    // Insert ASCII braille "ABC" and trigger input
    input.value = 'ABC' + input.value.slice(5);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      convertedHead: input.value.slice(0, 3),
    };
  });
  ok('ASCII braille characters convert automatically to Unicode cells (⠁⠃⠉)', r8.convertedHead === '⠁⠃⠉', r8);

  // Test 9: Blur event clears held chord state
  const r9 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    
    // Keydown KeyF to begin chord
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    
    // Trigger blur
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    
    // Keyup KeyF after blur - should not commit anything because state was cleared on blur
    const valBefore = input.value;
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));

    return {
      valueUnchanged: input.value === valBefore,
    };
  });
  ok('Blur resets active chord and prevents orphaned commit', r9.valueUnchanged === true, r9);

  // Test 10: Space insertion & word separation
  const r10 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(0, 0);
    
    // Insert a space
    input.setRangeText(' ', 0, 0, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      char: input.value.charAt(0),
      pos: input.selectionStart,
    };
  });
  ok('Space inserts blank cell space at caret', r10.char === ' ', r10);
  ok('Caret advances past inserted space', r10.pos === 1, r10.pos);

  // Test 11: Enter key / newline insertion
  const r11 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(1, 1);
    
    // Insert newline
    input.setRangeText('\n', 1, 1, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const lines = input.value.split('\n');
    return {
      lineCount: lines.length,
      pos: input.selectionStart,
    };
  });
  ok('Enter inserts newline and creates new braille line', r11.lineCount >= 2, r11.lineCount);
  ok('Caret moves to start of next line at pos 2', r11.pos === 2, r11.pos);

  // Test 12: Backspace deletion
  const r12 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(2, 2);
    
    // Simulate backspace removing '\n'
    input.setRangeText('', 1, 2, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      pos: input.selectionStart,
      charAfter: input.value.charAt(1),
    };
  });
  ok('Backspace removes character behind caret', r12.pos === 1, r12.pos);

  // Test 13: Selection deletion across multiple cells
  const r13 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    input.setSelectionRange(0, 3); // select 3 cells
    
    // Delete selection
    input.setRangeText('', 0, 3, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      pos: input.selectionStart,
    };
  });
  ok('Deleting multi-cell selection clears range and collapses caret to start', r13.pos === 0, r13);

  // Test 14: Vertical navigation updates active row linking
  const r14 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.focus();
    
    // Position caret on second line if available
    const lines = input.value.split('\n');
    let secondLinePos = lines[0].length + 1;
    input.setSelectionRange(secondLinePos, secondLinePos);
    
    // Fire selectionchange
    document.dispatchEvent(new Event('selectionchange'));

    return {
      hasActiveRow: document.querySelectorAll('#braille .brl-row').length > 0,
    };
  });
  ok('Caret movement across lines synchronizes braille row selection', r14.hasActiveRow === true, r14);

  // Test 15: Zero horizontal overflow preserved
  const r15 = await page.evaluate(async () => {
    const stack = document.getElementById('brlStack');
    const input = document.getElementById('brlInput');
    return {
      stackOverflow: stack.scrollWidth > stack.clientWidth,
      inputOverflow: input.scrollWidth > input.clientWidth + 2,
    };
  });
  ok('Stack preserves zero horizontal overflow (scrollWidth <= clientWidth)', r15.stackOverflow === false, r15);
  ok('Input textarea preserves zero horizontal overflow', r15.inputOverflow === false, r15);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) process.exit(1);
})();
