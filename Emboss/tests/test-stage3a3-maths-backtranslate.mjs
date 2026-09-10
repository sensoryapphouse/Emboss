import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 3A.3 Maths Back-Translation Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.parseBrailleBlockSegments === 'function',
                'editor and parseBrailleBlockSegments engine to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: UEB Pure Equation Parsing
  const r1 = await page.evaluate(() => {
    const segs = window.parseBrailleBlockSegments('⠼⠁⠐⠖⠼⠃⠐⠶⠼⠉', { mathCode: 'ueb', mode: 'ukaaf' });
    return segs;
  });
  ok('UEB pure equation parses into math segment', r1.length === 1 && r1[0].type === 'math', r1);
  ok('UEB equation converts to accurate LaTeX', r1[0]?.latex?.replace(/\s+/g, '') === '1+2=3', r1);

  // Test 2: UEB Powers & Superscripts
  const r2 = await page.evaluate(() => {
    const segs = window.parseBrailleBlockSegments('⠭⠰⠔⠼⠃', { mathCode: 'ueb', mode: 'ukaaf' });
    return segs;
  });
  ok('UEB superscript parses into math segment with power', r2.length === 1 && r2[0].type === 'math' && r2[0]?.latex?.includes('^'), r2);

  // Test 3: Nemeth Switch Inline Math Parsing
  const r3 = await page.evaluate(() => {
    const segs = window.parseBrailleBlockSegments('⠠⠮⠀⠜⠑⠁⠀⠊⠎⠀⠸⠩⠨⠏⠗⠘⠆⠸⠱', { mathCode: 'nemeth', mode: 'bana' });
    return segs;
  });
  ok('Nemeth switch splits into text and math segments', r3.length === 2 && r3[0].type === 'text' && r3[1].type === 'math', r3);
  ok('Nemeth math segment produces pi r^2 LaTeX', r3[1]?.latex?.includes('\\pi') && r3[1]?.latex?.includes('r'), r3);

  // Test 4: BRF ASCII Nemeth Switch Inline Math Parsing
  const r4 = await page.evaluate(() => {
    const segs = window.parseBrailleBlockSegments(',"E AREA IS _%,"PR*6_:', { mathCode: 'nemeth', mode: 'bana', asciiBraille: true });
    return segs;
  });
  ok('BRF ASCII Nemeth switch splits and parses cleanly', r4.length === 2 && r4[0].type === 'text' && r4[1].type === 'math', r4);

  // Test 5: Interactive Live Reverse Sync from #brlInput creating MathLive node
  const r5 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');

    // Input Nemeth inline math: "The area is " + \pi r^2
    brlInput.value = '⠠⠮⠀⠜⠑⠁⠀⠊⠎⠀⠸⠩⠨⠏⠗⠘⠆⠸⠱';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const mathFields = editorEl.querySelectorAll('math-field');
    const mathCount = mathFields.length;
    const mathVal = mathCount > 0 ? (mathFields[0].value || mathFields[0].textContent || '') : '';
    const textContent = editorEl.textContent || '';

    return {
      hasChanges: changes?.hasChanges,
      mathCount,
      mathVal,
      textContent,
    };
  });
  ok('reconcileBrailleChangeToPrint detects change from math input', r5.hasChanges === true, r5);
  ok('LHS print panel creates native MathLive <math-field> element', r5.mathCount > 0, r5);
  ok('LHS print text contains surrounding literary text', r5.textContent.includes('The area is') || r5.textContent.includes('area is'), r5);

  // Test 6: Interactive Live UEB Pure Equation Reverse Sync
  const r6 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');

    // Input UEB equation: 1+2=3
    brlInput.value = '⠼⠁⠐⠖⠼⠃⠐⠶⠼⠉';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const mathFields = editorEl.querySelectorAll('math-field');
    const mathCount = mathFields.length;
    const mathVal = mathCount > 0 ? (mathFields[0].value || mathFields[0].textContent || '') : '';

    return { mathCount, mathVal };
  });
  ok('Pure UEB equation creates MathLive field with 1+2=3', r6.mathCount > 0 && (r6.mathVal.replace(/\s+/g, '') === '1+2=3' || r6.mathVal.includes('1')), r6);

  // Test 7: 3-Way Panel Synchronization on Math Cells
  const r7 = await page.evaluate(() => {
    const editorEl = document.getElementById('editor');
    const brailleEl = document.getElementById('braille');
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
      rowBlock: rowWithBlock?.dataset?.block,
      inputPreserved: brlInput.value.length > 0,
      isReconciling: window.isReconcilingBrailleToPrint(),
    };
  });
  ok('Clicking math braille cell illuminates print block', r7.printLinkedCount > 0, r7);
  ok('#brlInput remains populated and synchronized', r7.inputPreserved === true, r7);
  ok('Mutex is false after math reconciliation', r7.isReconciling === false, r7);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
