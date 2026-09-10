import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 2B Braille Slash Command Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && !!document.getElementById('brlSlashMenu'),
                'editor and brlSlashMenu to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Test 1: Registry and Initial DOM structure
  const r1 = await page.evaluate(() => {
    const menu = document.getElementById('brlSlashMenu');
    const list = document.getElementById('brlSlashList');
    const cmds = window.BRL_SLASH_COMMANDS || [];
    return {
      menuExists: !!menu,
      listExists: !!list,
      hidden: menu.hidden,
      display: window.getComputedStyle(menu).display,
      role: menu.getAttribute('role'),
      label: menu.getAttribute('aria-label'),
      cmdCount: cmds.length,
      hasRequiredCmds: ['slash', 'p', 'center', 'h2', 'h3', 'list', 'ex', 'box', 'page', 'tn', 'brf', '6key', 'ins'].every(id => cmds.some(c => c.id === id)),
    };
  });
  ok('brlSlashMenu exists in DOM with listbox role and label', r1.menuExists && r1.role === 'listbox' && r1.label === 'Braille Commands', r1);
  ok('brlSlashMenu is hidden on load', r1.hidden && r1.display === 'none', r1);
  ok('BRL_SLASH_COMMANDS contains all 13 braille commands', r1.cmdCount >= 13 && r1.hasRequiredCmds, r1);

  // Test 2: Triggering Slash Menu via Physical "/" Key
  const r2 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const menu = document.getElementById('brlSlashMenu');
    const list = document.getElementById('brlSlashList');
    input.focus();
    input.value = '';
    
    // Type physical slash:
    input.value = '/';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const isVisible = !menu.hidden && window.getComputedStyle(menu).display !== 'none';
    const itemCount = list.children.length;
    const firstOpt = list.children[0];
    const selected = firstOpt?.getAttribute('aria-selected');
    const activedescendant = menu.getAttribute('aria-activedescendant');

    return {
      isVisible,
      itemCount,
      selected,
      activedescendant,
      firstOptId: firstOpt?.id,
    };
  });
  ok('Typing physical "/" opens brlSlashMenu with all options', r2.isVisible && r2.itemCount >= 13, r2);
  ok('First option is selected with correct aria-selected and aria-activedescendant', r2.selected === 'true' && r2.activedescendant === r2.firstOptId, r2);

  // Test 3: Arrow Navigation & Accessibility in Slash Menu
  const r3 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const menu = document.getElementById('brlSlashMenu');
    const list = document.getElementById('brlSlashList');

    // Press ArrowDown
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const opt1Selected = list.children[1]?.getAttribute('aria-selected');
    const desc1 = menu.getAttribute('aria-activedescendant');

    // Press ArrowDown again
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const opt2Selected = list.children[2]?.getAttribute('aria-selected');

    // Press ArrowUp
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const opt1SelectedAgain = list.children[1]?.getAttribute('aria-selected');

    return {
      opt1Selected,
      desc1,
      opt2Selected,
      opt1SelectedAgain,
      opt1Id: list.children[1]?.id,
    };
  });
  ok('ArrowDown navigates to option 1', r3.opt1Selected === 'true' && r3.desc1 === r3.opt1Id, r3);
  ok('ArrowDown navigates to option 2 and ArrowUp navigates back to option 1', r3.opt2Selected === 'true' && r3.opt1SelectedAgain === 'true', r3);

  // Test 4: Escape Dismissal
  const r4 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const menu = document.getElementById('brlSlashMenu');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return {
      hidden: menu.hidden,
      display: window.getComputedStyle(menu).display,
    };
  });
  ok('Escape key closes brlSlashMenu cleanly', r4.hidden && r4.display === 'none', r4);

  // Test 5: Triggering via Perkins 6-Key Chord (Dots 3-4 -> S + J)
  const r5 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const menu = document.getElementById('brlSlashMenu');
    input.focus();
    input.value = '';

    // Turn 6-key ON
    window.toggleBrlSixKey(true);

    // Chord S + J (Dots 3-4 -> ⠌ or /)
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', bubbles: true }));

    const isVisible = !menu.hidden && window.getComputedStyle(menu).display !== 'none';
    const val = input.value;
    return { isVisible, val };
  });
  ok('Chording Perkins Dots 3-4 (S + J) inputs braille slash and opens brlSlashMenu', r5.isVisible && (r5.val === '⠌' || r5.val === '/'), r5);

  // Test 6: Filtering Menu via 6-Key Chords (Chording P / ⠏)
  const r6 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const list = document.getElementById('brlSlashList');

    // Chord Dots 1-2-3-4 (F + D + S + J -> ⠏ / P)
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', bubbles: true }));

    const itemCount = list.children.length;
    const titles = Array.from(list.querySelectorAll('.slash-title')).map(t => t.textContent.trim());
    return { itemCount, titles, val: input.value };
  });
  ok('Chording ⠏ (P) filters menu to Paragraph and Page Break', r6.itemCount === 2 && r6.titles.includes('Paragraph (3-1)') && r6.titles.includes('Page Break'), r6);

  // Test 7: Executing Command on Enter (Paragraph 3-1)
  const r7 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    const menu = document.getElementById('brlSlashMenu');

    // Press Enter to apply Paragraph (3-1)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    return {
      val: input.value,
      marginStyle: window.getBrlMarginStyle(),
      menuHidden: menu.hidden,
      selBrlMarginVal: document.getElementById('selBrlMargin')?.value,
    };
  });
  ok('Executing Paragraph command removes slash query, sets body margin, and indents 2 spaces', r7.val === '  ' && r7.marginStyle === 'body' && r7.menuHidden, r7);

  // Test 8: Executing Centered Heading Command
  const r8 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.value = '⠓⠑⠇⠇⠕ /center';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Press Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    const val = input.value;
    const isCentered = val.startsWith(' ') && val.includes('⠓⠑⠇⠇⠕') && !val.includes('/center');
    return { val, isCentered };
  });
  ok('Executing /center centers the braille text and removes query', r8.isCentered, r8);

  // Test 9: Executing Boxline Command
  const r9 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.value = '/box';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Press Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    const val = input.value;
    const isBox = val.startsWith('⠒⠒⠒') && val.length >= 38;
    return { val, isBox, len: val.length };
  });
  ok('Executing /box inserts full-width line of border cells', r9.isBox, r9);

  // Test 10: Executing Transcriber Note Command
  const r10 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.value = '/tn';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Press Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    const val = input.value;
    const hasTn = val.includes('⠸⠸') && val.includes('⠸⠄');
    return { val, hasTn, caret: input.selectionStart };
  });
  ok('Executing /tn inserts transcriber note with open/close indicators and places caret inside', r10.hasTn && r10.caret > 6, r10);

  // Test 11: Executing Toggle BRF Mode Command
  const r11 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.value = '/brf';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    const btn = document.getElementById('btnBrlAscii');
    const isPressed = btn?.getAttribute('aria-pressed') === 'true';
    return { isPressed };
  });
  ok('Executing /brf toggles BRF ASCII mode', r11.isPressed, r11);

  // Test 12: Executing Toggle 6-Key Mode Command
  const r12 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.value = '/6key';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    const btn = document.getElementById('btnBrlSixKey');
    const isPressed = btn?.getAttribute('aria-pressed');
    return { isPressed };
  });
  ok('Executing /6key toggles 6-key Perkins mode', r12.isPressed === 'false', r12);

  // Test 13: Executing Toggle Overwrite Mode Command
  const r13 = await page.evaluate(async () => {
    const input = document.getElementById('brlInput');
    input.value = '/ins';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    const btn = document.getElementById('btnBrlInsertMode');
    const text = btn?.textContent.trim();
    return { text };
  });
  ok('Executing /ins toggles Overwrite (OVR) mode', r13.text === 'OVR', r13);

  // Test 14: Dynamic Positioning (No Drift & Visible in Pane)
  const r14 = await page.evaluate(() => {
    const input = document.getElementById('brlInput');
    const menu = document.getElementById('brlSlashMenu');
    input.focus();
    input.value = '\n\n/p';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const menuRect = menu.getBoundingClientRect();
    const pane = input.closest('.pane');
    const paneRect = pane.getBoundingClientRect();

    const insidePane = menuRect.left >= paneRect.left - 5 &&
                       menuRect.right <= paneRect.right + 5 &&
                       menuRect.top >= paneRect.top &&
                       menuRect.bottom <= paneRect.bottom + 50;

    return {
      menuRect: { top: menuRect.top, left: menuRect.left, width: menuRect.width, height: menuRect.height },
      paneRect: { top: paneRect.top, left: paneRect.left, width: paneRect.width, height: paneRect.height },
      insidePane,
    };
  });
  ok('brlSlashMenu is positioned accurately within RHS pane bounds', r14.insidePane, r14);

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  await browser.close();

  if (failures.length > 0) {
    process.exit(1);
  }
})();
