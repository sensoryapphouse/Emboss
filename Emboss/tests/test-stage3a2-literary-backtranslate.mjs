import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 3A.2 Literary Text Back-Translation Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.backTranslateBrailleText === 'function',
                'editor and backTranslateBrailleText engine to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: Direct Liblouis back-translation helper in Grade 1
  const r1 = await page.evaluate(() => {
    const g1Uni = window.backTranslateBrailleText('⠓⠑⠇⠇⠕', { grade: 'g1' });
    const g1Ascii = window.backTranslateBrailleText('HELLO', { grade: 'g1' });
    const g1Cap = window.backTranslateBrailleText('⠠⠓⠑⠇⠇⠕', { grade: 'g1' });
    return { g1Uni, g1Ascii, g1Cap };
  });
  ok('Grade 1 Unicode braille back-translates to print text', r1.g1Uni.toLowerCase() === 'hello', r1);
  ok('Grade 1 ASCII braille back-translates to print text', r1.g1Ascii.toLowerCase() === 'hello', r1);
  ok('Grade 1 capitalized braille back-translates with capital letter', r1.g1Cap === 'Hello', r1);

  // Test 2: Direct Liblouis back-translation helper in Grade 2 (Contractions)
  const r2 = await page.evaluate(() => {
    const thePeople = window.backTranslateBrailleText('⠞⠓⠑ ⠏⠑⠕⠏⠇⠑', { grade: 'g2' });
    const little = window.backTranslateBrailleText('⠇⠇', { grade: 'g2' });
    const you = window.backTranslateBrailleText('⠽', { grade: 'g2' });
    const can = window.backTranslateBrailleText('⠉', { grade: 'g2' });
    const asciiContractions = window.backTranslateBrailleText('! P', { grade: 'g2' });
    return { thePeople, little, you, can, asciiContractions };
  });
  ok('Grade 2 UEB full word back-translates accurately', r2.thePeople.toLowerCase() === 'the people', r2);
  ok('Grade 2 shortform "ll" back-translates to "little"', r2.little.toLowerCase() === 'little', r2);
  ok('Grade 2 single-letter contraction "y" back-translates to "you"', r2.you.toLowerCase() === 'you', r2);
  ok('Grade 2 single-letter contraction "c" back-translates to "can"', r2.can.toLowerCase() === 'can', r2);
  ok('Grade 2 ASCII braille contractions back-translate cleanly', r2.asciiContractions.toLowerCase() === 'the people', r2);

  // Test 3: Interactive Reverse Sync from #brlInput to #editor in Unicode Mode
  const r3 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    
    // Set a known braille phrase in #brlInput: "Welcome to braille"
    // "⠠⠺⠑⠇⠉⠕⠍⠑ ⠞⠕ ⠃⠗⠁⠊⠇⠇⠑"
    brlInput.value = '⠠⠺⠑⠇⠉⠕⠍⠑ ⠞⠕ ⠃⠗⠁⠊⠇⠇⠑';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 60));
    const printText = editorEl.textContent || '';
    const isReconciling = window.isReconcilingBrailleToPrint();

    return {
      hasChanges: changes?.hasChanges,
      targetBlockIndex: changes?.targetBlockIndex,
      printText,
      isReconciling,
      changes,
    };
  });
  ok('reconcileBrailleChangeToPrint detects change from #brlInput', r3.hasChanges === true, r3);
  ok('LHS print panel updates to reflect back-translated text', r3.printText.includes('Welcome to braille'), r3);
  ok('Mutex resets to false after reconciliation completes', r3.isReconciling === false, r3);

  // Test 4: Multi-line Wrapped Paragraph with BANA 2-Space Runover
  const r4 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');

    // Multi-line braille with BANA 2-space margin indent:
    // Line 1: "⠠⠞⠓⠊⠎ ⠊⠎ ⠇⠊⠝⠑ ⠕⠝⠑" (This is line one)
    // Line 2: "  ⠁⠝⠙ ⠇⠊⠝⠑ ⠞⠺⠕" (  and line two)
    brlInput.value = '⠠⠞⠓⠊⠎ ⠊⠎ ⠇⠊⠝⠑ ⠕⠝⠑\n  ⠁⠝⠙ ⠇⠊⠝⠑ ⠞⠺⠕';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 60));
    const printText = editorEl.textContent || '';

    return { printText };
  });
  ok('BANA 2-space margin indent is stripped and multi-line paragraph joins into continuous print sentence',
     r4.printText.includes('This is line one and line two'), r4);

  // Test 5: Interactive Reverse Sync in BRF ASCII Mode
  const r5 = await page.evaluate(async () => {
    const btnAscii = document.getElementById('btnBrlAscii');
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');

    // Switch to BRF ASCII mode:
    btnAscii.click();

    // Set ASCII braille: ",HELLO WORLD" -> "Hello world"
    brlInput.value = ',HELLO WORLD';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 60));
    const printText = editorEl.textContent || '';

    // Switch back to Unicode mode:
    btnAscii.click();

    return { printText };
  });
  ok('BRF ASCII mode back-translates and updates print panel accurately',
     r5.printText.includes('Hello world') || r5.printText.includes('HELLO WORLD') || r5.printText.toLowerCase().includes('hello world'), r5);

  // Test 6: 3-Way Panel Synchronization (Print Caret -> Braille Highlight -> Click to Link)
  const r6 = await page.evaluate(() => {
    const editorEl = document.getElementById('editor');
    const brailleEl = document.getElementById('braille');
    const brlInput = document.getElementById('brlInput');

    // Click on a braille cell in #braille:
    const firstCell = brailleEl.querySelector('.bcell[data-char]');
    let printHl = 0;
    if (firstCell) {
      firstCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      printHl = editorEl.querySelectorAll('.print-linked').length;
    }

    const brailleMatchesInput = brlInput.value.length > 0;
    return { printHl, brailleMatchesInput };
  });
  ok('3-way synchronization: clicking braille cell links to print block', r6.printHl > 0, r6);
  ok('3-way synchronization: #brlInput remains populated and synchronized', r6.brailleMatchesInput === true, r6);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
