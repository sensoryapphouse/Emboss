import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Direct Braille Editor Formatting Reverse Sync Tests (Bold, Italic, Underline) ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.backTranslateBrailleRuns === 'function',
                'editor and backTranslateBrailleRuns engine to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // -------------------------------------------------------------------------
  // Test 1: Unit tests on backTranslateBrailleRuns for Unicode & ASCII typeforms
  // -------------------------------------------------------------------------
  const r1 = await page.evaluate(() => {
    const fn = window.backTranslateBrailleRuns;

    // Unicode bold, italic, underline
    const uBold = fn('⠘⠂⠊⠍⠏⠕⠗⠞⠁⠝⠞'); // bold "important"
    const uItal = fn('⠨⠂⠑⠍⠏⠓⠁⠎⠊⠎⠫'); // italic "emphasised"
    const uUndl = fn('⠸⠂⠐⠥⠇⠔⠫');         // underline "underlined"

    // ASCII bold, italic, underline
    const aBold = fn('^1IMPORTANT');
    const aItal = fn('.1EMPHASIS$');
    const aUndl = fn('_1"UL9$');

    // Mixed sentence in Unicode
    const mixedUni = fn('⠠⠹⠀⠘⠺⠀⠊⠎⠀⠘⠂⠊⠍⠏⠕⠗⠞⠁⠝⠞⠘⠄⠂⠀⠯⠀⠹⠀⠊⠎⠀⠨⠂⠑⠍⠏⠓⠁⠎⠊⠎⠫⠨⠄⠂⠀⠯⠀⠹⠀⠊⠎⠀⠸⠂⠐⠥⠇⠔⠫⠸⠄⠲');

    return {
      uBold,
      uItal,
      uUndl,
      aBold,
      aItal,
      aUndl,
      mixedUni,
    };
  });

  ok('Unicode bold word decodes with tf=4 (bold)', r1.uBold.length === 1 && r1.uBold[0].text === 'important' && r1.uBold[0].tf === 4, r1.uBold);
  ok('Unicode italic word decodes with tf=1 (italic)', r1.uItal.length === 1 && r1.uItal[0].text === 'emphasised' && r1.uItal[0].tf === 1, r1.uItal);
  ok('Unicode underline word decodes with tf=2 (underline)', r1.uUndl.length === 1 && r1.uUndl[0].text === 'underlined' && r1.uUndl[0].tf === 2, r1.uUndl);

  ok('ASCII bold word decodes with tf=4 (bold)', r1.aBold.length === 1 && r1.aBold[0].text === 'important' && r1.aBold[0].tf === 4, r1.aBold);
  ok('ASCII italic word decodes with tf=1 (italic)', r1.aItal.length === 1 && r1.aItal[0].text === 'emphasised' && r1.aItal[0].tf === 1, r1.aItal);
  ok('ASCII underline word decodes with tf=2 (underline)', r1.aUndl.length === 1 && r1.aUndl[0].text === 'underlined' && r1.aUndl[0].tf === 2, r1.aUndl);

  ok('Mixed Unicode sentence decodes all 3 emphasis styles in sequence',
    r1.mixedUni.some(r => r.text === 'important' && r.tf === 4) &&
    r1.mixedUni.some(r => r.text === 'emphasised' && r.tf === 1) &&
    r1.mixedUni.some(r => r.text === 'underlined' && r.tf === 2),
    r1.mixedUni);

  // -------------------------------------------------------------------------
  // Test 2: Live end-to-end reconciliation of bold/italic/underline edits in Lexical
  // -------------------------------------------------------------------------
  
  // Set up initial document with formatted paragraph
  await page.evaluate(() => {
    const blocks = [
      {
        type: 'para',
        segments: [
          { type: 'text', text: 'This word is ' },
          { type: 'text', text: 'important', tf: 4 }, // bold
          { type: 'text', text: ', and this is ' },
          { type: 'text', text: 'emphasised', tf: 1 }, // italic
          { type: 'text', text: ', and this is ' },
          { type: 'text', text: 'underlined', tf: 2 }, // underline
          { type: 'text', text: '.' }
        ]
      }
    ];
    window.modelToLexical({ title: 'Formatting Test', blocks });
  });

  await new Promise((r) => setTimeout(r, 600));

  // Verify initial rendered braille in brlInput contains the indicators
  const initialBraille = await page.evaluate(() => document.getElementById('brlInput').value);
  ok('Initial braille contains bold indicator ⠘⠂ or ^1', initialBraille.includes('⠘⠂') || initialBraille.includes('^1'), initialBraille);
  ok('Initial braille contains italic indicator ⠨⠂ or .1', initialBraille.includes('⠨⠂') || initialBraille.includes('.1'), initialBraille);
  ok('Initial braille contains underline indicator ⠸⠂ or _1', initialBraille.includes('⠸⠂') || initialBraille.includes('_1'), initialBraille);

  // Edit the braille buffer: replace "important" with "crucial" while keeping bold indicator
  // In UEB: crucial = ⠉⠗⠥⠉⠊⠁⠇ (CRUCIAL) -> bold = ⠘⠂⠉⠗⠥⠉⠊⠁⠇ or ^1CRUCIAL
  const r2 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const isAscii = !/[\u2800-\u28FF]/.test(brlInput.value);
    
    // Replace the bold word in braille buffer
    let nextBrl;
    if (isAscii) {
      nextBrl = brlInput.value.replace(/\^1IMPORTANT/, '^1CRUCIAL');
    } else {
      nextBrl = brlInput.value.replace(/⠘⠂⠊⠍⠏⠕⠗⠞⠁⠝⠞/, '⠘⠂⠉⠗⠥⠉⠊⠁⠇');
    }
    brlInput.value = nextBrl;
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Trigger reconciliation
    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 400));

    const model = window.buildModel();
    const para = model?.blocks?.[0];
    return {
      paraSegments: para?.segments || [],
    };
  });

  const boldNode = r2.paraSegments.find(c => c.text === 'crucial' || c.text.includes('crucial'));
  const italicNode = r2.paraSegments.find(c => c.text === 'emphasised' || c.text.includes('emphasised'));
  const underlineNode = r2.paraSegments.find(c => c.text === 'underlined' || c.text.includes('underlined'));

  ok('Edited word "crucial" maintains bold formatting (tf & 4 === 4)', boldNode && (boldNode.tf & 4) === 4 && (boldNode.tf & 1) === 0, boldNode);
  ok('Adjacent italic word "emphasised" maintains italic formatting (tf & 1 === 1)', italicNode && (italicNode.tf & 1) === 1 && (italicNode.tf & 4) === 0, italicNode);
  ok('Adjacent underline word "underlined" maintains underline formatting (tf & 2 === 2)', underlineNode && (underlineNode.tf & 2) === 2, underlineNode);

  // -------------------------------------------------------------------------
  // Test 3: Changing formatting directly in braille (e.g. from italic to bold)
  // -------------------------------------------------------------------------
  const r3 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const isAscii = !/[\u2800-\u28FF]/.test(brlInput.value);

    // Change the italic indicator on "emphasised" to bold indicator
    let nextBrl;
    if (isAscii) {
      nextBrl = brlInput.value.replace(/\.1EMPHASIS\$/, '^1EMPHASIS$');
    } else {
      nextBrl = brlInput.value.replace(/⠨⠂⠑⠍⠏⠓⠁⠎⠊⠎⠫/, '⠘⠂⠑⠍⠏⠓⠁⠎⠊⠎⠫');
    }
    brlInput.value = nextBrl;
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 400));

    const model = window.buildModel();
    const para = model?.blocks?.[0];
    return {
      paraSegments: para?.segments || [],
    };
  });

  const changedNode = r3.paraSegments.find(c => c.text === 'emphasised' || c.text.includes('emphasised'));
  ok('Changing braille indicator from italic to bold updates Lexical format to bold (tf=4, not italic)',
    changedNode && (changedNode.tf & 4) === 4 && (changedNode.tf & 1) === 0, changedNode);

  // -------------------------------------------------------------------------
  // Test 4: Combined bold + italic word in braille syncs both formats
  // -------------------------------------------------------------------------
  const r4 = await page.evaluate(async () => {
    const brlInput = document.getElementById('brlInput');
    const isAscii = !/[\u2800-\u28FF]/.test(brlInput.value);

    let nextBrl;
    if (isAscii) {
      nextBrl = brlInput.value.replace(/\^1EMPHASIS\$/, '^1.1SUPER');
    } else {
      nextBrl = brlInput.value.replace(/⠘⠂⠑⠍⠏⠓⠁⠎⠊⠎⠫/, '⠘⠂⠨⠂⠎⠥⠏⠑⠗');
    }
    brlInput.value = nextBrl;
    brlInput.dispatchEvent(new Event('input', { bubbles: true }));

    window.reconcileBrailleChangeToPrint();
    await new Promise((r) => setTimeout(r, 400));

    const model = window.buildModel();
    const para = model?.blocks?.[0];
    return {
      paraSegments: para?.segments || [],
    };
  });

  const superNode = r4.paraSegments.find(c => c.text && (c.text === 'super' || c.text.includes('super')));
  ok('Combined bold+italic in braille sets both bold and italic formats (tf=5)',
    superNode && (superNode.tf & 4) === 4 && (superNode.tf & 1) === 1, superNode);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
