import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 3B.2 List & Sidebar Box Pattern & Structure Sync Tests ---');
  
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

  // Test 1: Unit Pattern Detection Tests for Lists & Sidebars
  const r1 = await page.evaluate(() => {
    const fn = window.detectBrailleBlockStyle;
    const sBulletUni = fn(['⠸⠲⠀⠠⠋⠊⠗⠎⠞⠀⠊⠞⠑⠍'], { cells: 40 });
    const sBulletAscii = fn(['_4 First item'], { cells: 40 });
    const sBulletSymbol = fn(['• First item'], { cells: 40 });
    const sNumUni = fn(['⠼⠁⠄⠀⠠⠎⠑⠉⠕⠝⠙⠀⠊⠞⠑⠍'], { cells: 40 });
    const sNumAscii = fn(['1. First item'], { cells: 40 });
    const sTocUni = fn(['⠠⠉⠓⠁⠏⠞⠑⠗⠀⠠⠕⠝⠑⠐⠐⠐⠐⠼⠁'], { cells: 40 });
    const sTocAscii = fn(['Chapter One""""1'], { cells: 40 });
    const sSidebarUni = fn(['⠒⠒⠒⠀⠠⠝⠕⠞⠑⠀⠒⠒⠒', '  ⠠⠎⠊⠙⠑⠃⠁⠗⠀⠞⠑⠭⠞⠄', '⠒⠒⠒⠒⠒⠒⠒⠒⠒⠒'], { cells: 40 });
    const sSidebarAscii = fn(['333 Note 333', '  Sidebar text.', '3333333333'], { cells: 40 });
    return { sBulletUni, sBulletAscii, sBulletSymbol, sNumUni, sNumAscii, sTocUni, sTocAscii, sSidebarUni, sSidebarAscii };
  });

  ok('Unicode bullet list item detects as list-bullet', r1.sBulletUni.style === 'list-bullet' && r1.sBulletUni.isList === true, r1.sBulletUni);
  ok('ASCII bullet list item (_4) detects as list-bullet', r1.sBulletAscii.style === 'list-bullet' && r1.sBulletAscii.isList === true, r1.sBulletAscii);
  ok('Symbol bullet list item (•) detects as list-bullet', r1.sBulletSymbol.style === 'list-bullet' && r1.sBulletSymbol.isList === true, r1.sBulletSymbol);
  ok('Unicode numbered list item detects as list-number', r1.sNumUni.style === 'list-number' && r1.sNumUni.isList === true, r1.sNumUni);
  ok('ASCII numbered list item (1.) detects as list-number', r1.sNumAscii.style === 'list-number' && r1.sNumAscii.isList === true, r1.sNumAscii);
  ok('Unicode TOC dot leaders detect as toc', r1.sTocUni.style === 'toc' && r1.sTocUni.isList === true, r1.sTocUni);
  ok('ASCII TOC dot leaders detect as toc', r1.sTocAscii.style === 'toc' && r1.sTocAscii.isList === true, r1.sTocAscii);
  ok('Unicode sidebar boxlines detect as sidebar', r1.sSidebarUni.style === 'sidebar' && r1.sSidebarUni.isSidebar === true && r1.sSidebarUni.title.toLowerCase().includes('note'), r1.sSidebarUni);
  ok('ASCII sidebar boxlines detect as sidebar', r1.sSidebarAscii.style === 'sidebar' && r1.sSidebarAscii.isSidebar === true, r1.sSidebarAscii);

  // Test 2: Live Reverse Sync for Bullet List (<ul><li>)
  const r2 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    brlInput.value = '⠸⠲⠀⠠⠋⠊⠗⠎⠞⠀⠊⠞⠑⠍';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const ulEl = editorEl.querySelector('ul');
    const liEl = editorEl.querySelector('ul li');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      hasUl: !!ulEl,
      hasLi: !!liEl,
      liText: liEl?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('Reconcile detects bullet list item', r2.hasChanges === true && r2.detectedStyle === 'list-bullet', r2);
  ok('LHS print panel creates <ul><li> node', r2.hasUl === true && r2.hasLi === true, r2);
  ok('LHS print <li> text contains "First item"', r2.liText.toLowerCase().includes('first item'), r2);
  ok('LHS toolbar dropdown reflects bullet', r2.blockStyleVal === 'bullet', r2);

  // Test 3: Live Reverse Sync for Numbered List (<ol><li>)
  const r3 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    brlInput.value = '⠼⠁⠄⠀⠠⠎⠑⠉⠕⠝⠙⠀⠊⠞⠑⠍';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const olEl = editorEl.querySelector('ol');
    const liEl = editorEl.querySelector('ol li');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      hasOl: !!olEl,
      hasLi: !!liEl,
      liText: liEl?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('Numbered braille creates <ol><li> node in LHS print panel', r3.hasOl === true && r3.hasLi === true, r3);
  ok('LHS print <li> text contains "Second item"', r3.liText.toLowerCase().includes('second item'), r3);
  ok('LHS toolbar dropdown reflects number', r3.blockStyleVal === 'number', r3);

  // Test 4: Live Reverse Sync for TOC Entry
  const r4 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    brlInput.value = '⠠⠉⠓⠁⠏⠞⠑⠗⠀⠠⠕⠝⠑⠐⠐⠐⠐⠼⠁';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const liEl = editorEl.querySelector('li');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      hasLi: !!liEl,
      liText: liEl?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('TOC braille with dot leaders creates TOC list entry', r4.hasLi === true, r4);
  ok('LHS toolbar dropdown reflects toc', r4.blockStyleVal === 'toc', r4);

  // Test 5: Live Reverse Sync for Sidebar Box (<aside class="emboss-sidebar-card">)
  const r5 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const styleInspector = document.getElementById('styleInspector');

    brlInput.value = '⠒⠒⠒⠀⠠⠝⠕⠞⠑⠀⠒⠒⠒\n  ⠠⠹⠊⠎⠀⠊⠎⠀⠊⠝⠎⠊⠙⠑⠀⠮⠀⠃⠕⠭⠄\n⠒⠒⠒⠒⠒⠒⠒⠒⠒⠒';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const asideEl = editorEl.querySelector('aside.emboss-sidebar-card') || editorEl.querySelector('aside');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      hasAside: !!asideEl,
      asideTitle: asideEl?.dataset?.title || '',
      asideText: asideEl?.textContent || '',
      inspectorText: styleInspector?.textContent || '',
    };
  });

  ok('Boxlines create <aside class="emboss-sidebar-card"> in LHS print panel', r5.hasAside === true, r5);
  ok('Sidebar title is extracted into data-title', r5.asideTitle.toLowerCase().includes('note'), r5);
  ok('Sidebar inner text contains "inside the box"', r5.asideText.toLowerCase().includes('inside the box'), r5);
  ok('Style inspector reflects sidebar box', r5.inspectorText.toLowerCase().includes('sidebar'), r5);

  // Test 6: Live Reverse Mutation — Sidebar mutating back to Paragraph
  const r6 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const editorEl = document.getElementById('editor');
    const blockStyle = document.getElementById('blockStyle');

    brlInput.value = '  ⠠⠹⠊⠎⠀⠊⠎⠀⠝⠕⠺⠀⠁⠀⠏⠁⠗⠁⠛⠗⠁⠏⠓⠄';
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    const changes = window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 80));

    const block0El = editorEl.querySelector('[data-block-idx="0"]') || editorEl.children[0];
    const isParagraph = block0El ? (block0El.tagName === 'P' || block0El.classList.contains('ed-p')) : false;
    const hasAside = !!editorEl.querySelector('aside');
    return {
      hasChanges: changes?.hasChanges,
      detectedStyle: changes?.blockStyleInfo?.style,
      isParagraph,
      hasAside,
      pText: block0El?.textContent || '',
      blockStyleVal: blockStyle?.value,
    };
  });

  ok('Sidebar mutates back to <p> paragraph node and aside is removed', r6.isParagraph === true && r6.hasAside === false, r6);
  ok('LHS print paragraph contains text', r6.pText.toLowerCase().includes('paragraph'), r6);
  ok('LHS toolbar dropdown resets to p', r6.blockStyleVal === 'p', r6);

  // Test 7: 3-Way Panel Synchronization
  const r7 = await page.evaluate(() => {
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

  ok('Clicking braille cell illuminates print block', r7.printLinkedCount > 0, r7);
  ok('#brlInput remains populated and synchronized', r7.inputPreserved === true, r7);
  ok('Mutex is false after structure reconciliation', r7.isReconciling === false, r7);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
  process.exit(0);
})();
