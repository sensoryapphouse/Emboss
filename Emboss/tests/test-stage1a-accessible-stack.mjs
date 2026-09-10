import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 1A Accessible Braille Stack Tests on http://localhost:8137/editor/index.html ---');
  
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.argv.includes('--show'),
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  
  // Set correct localStorage key 'emboss-settings' to ensure editor mode stays active
  await context.addInitScript(() => {
    try {
      localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'ukaaf', grade: 'g2', cells: 38, lines: 25 }));
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
                'the editor and braille to finish initial render');
  await new Promise((r) => setTimeout(r, 400)); // settle

  // Check 1: DOM Structure & Accessible ARIA Labels
  const c1 = await page.evaluate(() => {
    const stack = document.getElementById('brlStack');
    const input = document.getElementById('brlInput');
    const braille = document.getElementById('braille');
    return {
      stackTag: stack?.tagName.toLowerCase(),
      inputTag: input?.tagName.toLowerCase(),
      inputAriaLabel: input?.getAttribute('aria-label'),
      brailleAriaHidden: braille?.getAttribute('aria-hidden'),
    };
  });
  ok('stack element is a div', c1.stackTag === 'div', c1.stackTag);
  ok('input element is a textarea', c1.inputTag === 'textarea', c1.inputTag);
  ok('input element has accessible aria-label', c1.inputAriaLabel === 'Braille document text', c1.inputAriaLabel);
  ok('underlying braille presentation layer is aria-hidden', c1.brailleAriaHidden === 'true', c1.brailleAriaHidden);

  // Check 2: Layout Invariant & Zero Horizontal Scrollbar
  const c2 = await page.evaluate(() => {
    const stack = document.getElementById('brlStack');
    const braille = document.getElementById('braille');
    const input = document.getElementById('brlInput');
    return {
      stackScrollW: stack.scrollWidth,
      stackClientW: stack.clientWidth,
      hasHorizontalScroll: stack.scrollWidth > stack.clientWidth,
      inputPosition: getComputedStyle(input).position,
      inputColor: getComputedStyle(input).color,
      inputCaretColor: getComputedStyle(input).caretColor,
      inputFontSize: getComputedStyle(input).fontSize,
      brailleFontSize: getComputedStyle(braille).fontSize,
    };
  });
  ok('braille stack has zero horizontal scrollbar (scrollWidth === clientWidth)', !c2.hasHorizontalScroll, c2);
  ok('brlInput overlay is position: absolute', c2.inputPosition === 'absolute', c2.inputPosition);
  ok('brlInput text color is transparent', c2.inputColor === 'rgba(0, 0, 0, 0)', c2.inputColor);
  ok('brlInput and braille layer share identical font-size', c2.inputFontSize === c2.brailleFontSize, c2);

  // Check 3: Buffer Synchronization
  const c3 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const rows = document.querySelectorAll('#braille .brl-row');
    const lines = input.value.split('\n');
    return {
      inputLineCount: lines.length,
      brailleRowCount: rows.length,
      hasContent: input.value.length > 50,
    };
  });
  ok('brlInput line count matches braille row count', c3.inputLineCount === c3.brailleRowCount, c3);
  ok('brlInput contains rendered braille characters', c3.hasContent, c3);

  // Check 4: RHS Braille Click → LHS Print Highlight & Status Rule Inspector
  const c4 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const editor = document.getElementById('editor');
    const status = document.getElementById('status');
    
    // Click at offset 77 (inside 'important')
    input.focus();
    input.setSelectionRange(77, 77);
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const printLinked = Array.from(editor.querySelectorAll('.print-linked')).map(el => el.textContent);
    const highlightedCells = document.querySelectorAll('#braille .cell-hl').length;
    const statusText = status ? status.textContent : '';

    return {
      activeElementId: document.activeElement ? document.activeElement.id : null,
      selectionStart: input.selectionStart,
      printLinkedCount: printLinked.length,
      highlightedCells,
      statusText,
    };
  });
  ok('brlInput retains focus on click', c4.activeElementId === 'brlInput', c4.activeElementId);
  ok('clicking braille illuminates print block on LHS', c4.printLinkedCount >= 1, c4.printLinkedCount);
  ok('clicking braille highlights cell dots in gold', c4.highlightedCells >= 1, c4.highlightedCells);

  // Check 5: LHS Print Click → RHS Braille Caret & Cells
  const c5 = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    const input = document.getElementById('brlInput');

    const p = Array.from(editor.querySelectorAll('p')).find(el => el.textContent.includes('important'));
    if (p) {
      let textNode = null;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes('important')) {
          textNode = walker.currentNode;
          break;
        }
      }
      if (textNode) {
        const idx = textNode.textContent.indexOf('important');
        const range = document.createRange();
        range.setStart(textNode, idx + 2);
        range.setEnd(textNode, idx + 2);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }

    return {
      inputSelStart: input.selectionStart,
      highlightedCells: document.querySelectorAll('#braille .cell-hl').length,
    };
  });
  // Check 6: Zero Horizontal Caret Drift Across All Cells (Col 0 to Col 37)
  const c6 = await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const braille = document.getElementById('braille');
    const firstRow = braille.querySelector('.brl-row');
    const cells = firstRow ? Array.from(firstRow.querySelectorAll('.bcell')) : [];

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${window.getComputedStyle(brlInput).fontSize} ${window.getComputedStyle(brlInput).fontFamily}`;
    const charWidthNormal = ctx.measureText('⠁').width;

    let maxDrift = 0;
    cells.forEach((cell, i) => {
      const cellRect = cell.getBoundingClientRect();
      const expectedInputX = 14 + (i * charWidthNormal); // 14px padding
      const actualBrailleX = cellRect.left - braille.getBoundingClientRect().left;
      const drift = Math.abs(actualBrailleX - expectedInputX);
      if (drift > maxDrift) maxDrift = drift;
    });

    return {
      cellCount: cells.length,
      charWidthNormal,
      maxDrift,
    };
  });
  ok('zero horizontal caret drift across all cells (maxDrift <= 0.05px)', c6.maxDrift <= 0.05, c6);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) process.exit(1);
})();
