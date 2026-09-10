import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 5.1 Transcriber Notes & Footnotes Reverse Sync Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.detectBrailleBlockStyle === 'function' && typeof window.stripTranscriberNoteIndicators === 'function',
                'editor and detection helpers to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // -------------------------------------------------------------------------
  // Part 1: Unit tests for indicator stripping (Unicode, ASCII, Legacy)
  // -------------------------------------------------------------------------
  const u1 = await page.evaluate(() => {
    const stripTN = window.stripTranscriberNoteIndicators;
    const stripFN = window.stripFootnoteIndicators;

    return {
      tnAscii: stripTN('@.<Transcriber note text@.>'),
      tnUnicode: stripTN('⠈⠨⠣⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑⠈⠨⠜'),
      tnLegacyAscii1: stripTN(",'Legacy TN7"),
      tnLegacyAscii2: stripTN(",'Legacy TN,'"),
      tnLegacyUni: stripTN('⠐⠇⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑⠐⠂'),
      tnMarker1: stripTN('[TN: Special note content]'),
      tnMarker2: stripTN("[transcriber's note: Detail remark]"),

      fnMarker1: stripFN('[fn: 1. Footnote explanation]'),
      fnMarker2: stripFN('[footnote: 2. Extended reference source]'),
      fnPrefix: stripFN('Footnote: 1. Footnote explanation'),
      fnUnicodePrefix: stripFN('⠠⠿⠕⠕⠞⠝⠕⠞⠑ ⠼⠁⠄ ⠠⠋⠕⠕⠞⠝⠕⠞⠑⠀⠞⠑⠭⠞'),
    };
  });

  ok('stripTN strips ASCII @.< ... @.>', u1.tnAscii === 'Transcriber note text', u1.tnAscii);
  ok('stripTN strips Unicode ⠈⠨⠣ ... ⠈⠨⠜', u1.tnUnicode === '⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑', u1.tnUnicode);
  ok("stripTN strips legacy ASCII ,' ... 7", u1.tnLegacyAscii1 === 'Legacy TN', u1.tnLegacyAscii1);
  ok("stripTN strips legacy ASCII ,' ... ,'", u1.tnLegacyAscii2 === 'Legacy TN', u1.tnLegacyAscii2);
  ok('stripTN strips legacy Unicode ⠐⠇ ... ⠐⠂', u1.tnLegacyUni === '⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑', u1.tnLegacyUni);
  ok('stripTN strips [TN: ...]', u1.tnMarker1 === 'Special note content', u1.tnMarker1);
  ok("stripTN strips [transcriber's note: ...]", u1.tnMarker2 === 'Detail remark', u1.tnMarker2);

  ok('stripFN strips [fn: ...]', u1.fnMarker1 === '1. Footnote explanation', u1.fnMarker1);
  ok('stripFN strips [footnote: ...]', u1.fnMarker2 === '2. Extended reference source', u1.fnMarker2);
  ok('stripFN strips Footnote: prefix', u1.fnPrefix === '1. Footnote explanation', u1.fnPrefix);
  ok('stripFN strips Unicode ⠠⠿⠕⠕⠞⠝⠕⠞⠑ prefix', u1.fnUnicodePrefix === '⠼⠁⠄ ⠠⠋⠕⠕⠞⠝⠕⠞⠑⠀⠞⠑⠭⠞', u1.fnUnicodePrefix);

  // -------------------------------------------------------------------------
  // Part 2: Unit tests for detectBrailleBlockStyle (TNs, Footnotes, Headings)
  // -------------------------------------------------------------------------
  const u2 = await page.evaluate(() => {
    const detect = window.detectBrailleBlockStyle;

    const tnAscii = detect(['@.<Transcriber note block@.>']);
    const tnUnicode = detect(['⠈⠨⠣⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑⠈⠨⠜']);
    const tnMultiLine = detect([
      '⠈⠨⠣⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑⠀⠞⠓⠁⠞⠀⠉⠕⠝⠞⠊⠝⠥⠑⠎',
      '⠀⠀⠀⠕⠝⠀⠞⠓⠑⠀⠝⠑⠭⠞⠀⠇⠊⠝⠑⠲⠈⠨⠜'
    ]);
    const tnCell7 = detect([
      '      @.<Transcriber note on cell 7',
      '    runover on cell 5@.>'
    ]);
    const tnLegacy = detect([",'Legacy note text7"]);
    const tnLegacyUni = detect(['⠐⠇⠠⠞⠝⠐⠂']);
    const tnBracket = detect(['[TN: Bracket note]']);

    const fnBracket = detect(['[fn: 1. Scholarly reference footnote]']);
    const fnWord = detect(['Footnote: 1. Scholarly reference footnote']);
    const fnUnicodeWord = detect(['⠠⠿⠕⠕⠞⠝⠕⠞⠑ ⠼⠁⠄ ⠠⠎⠉⠓⠕⠇⠁⠗⠇⠽']);

    return {
      tnAscii,
      tnUnicode,
      tnMultiLine,
      tnCell7,
      tnLegacy,
      tnLegacyUni,
      tnBracket,
      fnBracket,
      fnWord,
      fnUnicodeWord,
    };
  });

  ok('detectBrailleBlockStyle detects single-line ASCII TN', u2.tnAscii.style === 'note' && u2.tnAscii.isNote === true, u2.tnAscii);
  ok('detectBrailleBlockStyle detects single-line Unicode TN', u2.tnUnicode.style === 'note' && u2.tnUnicode.isNote === true, u2.tnUnicode);
  ok('detectBrailleBlockStyle detects multi-line Unicode TN', u2.tnMultiLine.style === 'note' && u2.tnMultiLine.isNote === true, u2.tnMultiLine);
  ok('detectBrailleBlockStyle prioritises TN over Cell 7 heading for 7-5 margin TNs', u2.tnCell7.style === 'note' && u2.tnCell7.isNote === true && !u2.tnCell7.isHeading, u2.tnCell7);
  ok('detectBrailleBlockStyle detects legacy ASCII TN', u2.tnLegacy.style === 'note' && u2.tnLegacy.isNote === true, u2.tnLegacy);
  ok('detectBrailleBlockStyle detects legacy Unicode TN', u2.tnLegacyUni.style === 'note' && u2.tnLegacyUni.isNote === true, u2.tnLegacyUni);
  ok('detectBrailleBlockStyle detects [TN: ...]', u2.tnBracket.style === 'note' && u2.tnBracket.isNote === true, u2.tnBracket);

  ok('detectBrailleBlockStyle detects [fn: ...]', u2.fnBracket.style === 'footnote' && u2.fnBracket.isFootnote === true, u2.fnBracket);
  ok('detectBrailleBlockStyle detects Footnote: prefix', u2.fnWord.style === 'footnote' && u2.fnWord.isFootnote === true, u2.fnWord);
  ok('detectBrailleBlockStyle detects Unicode ⠠⠿⠕⠕⠞⠝⠕⠞⠑ prefix', u2.fnUnicodeWord.style === 'footnote' && u2.fnUnicodeWord.isFootnote === true, u2.fnUnicodeWord);

  // -------------------------------------------------------------------------
  // Part 3: Live End-to-End Reverse Sync (Transcriber Note Unicode -> Lexical)
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    // Populate editor with initial simple paragraph
    const p = window.modelToLexical([
      { type: 'para', text: 'Normal text before.' }
    ]);
  });
  await new Promise((r) => setTimeout(r, 200));

  // Modify Braille textarea to contain a Unicode Transcriber Note
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Unicode TN: ⠈⠨⠣⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑⠈⠨⠜
    brlEl.value = '⠈⠨⠣⠠⠞⠗⠁⠝⠎⠉⠗⠊⠃⠑⠗⠀⠝⠕⠞⠑⠈⠨⠜';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r3 = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      classList: firstP ? Array.from(firstP.classList) : [],
      textContent: firstP ? firstP.textContent.trim() : '',
      modelType: model.blocks[0]?.type,
      modelStyle: model.blocks[0]?.style,
      modelText: model.blocks[0]?.text,
    };
  });

  ok('Reverse sync sets banaStyle="note" on Lexical Paragraph DOM dataset', r3.banaDataset === 'note', r3.banaDataset);
  ok('Reverse sync adds class "bana-style-note" to DOM', r3.classList.includes('bana-style-note'), r3.classList);
  ok('Reverse sync strips outer TN brackets from Print text', r3.textContent === 'Transcriber note', r3.textContent);
  ok('buildModel extracts block type as "note"', r3.modelType === 'note', r3.modelType);

  // -------------------------------------------------------------------------
  // Part 4: Live End-to-End Reverse Sync (Transcriber Note with Bold/Italic)
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // TN with bold "important": ⠈⠨⠣⠠⠹⠀⠊⠎⠀⠘⠂⠊⠍⠏⠕⠗⠞⠁⠝⠞⠘⠄⠂⠈⠨⠜
    brlEl.value = '⠈⠨⠣⠠⠹⠀⠊⠎⠀⠘⠂⠊⠍⠏⠕⠗⠞⠁⠝⠞⠘⠄⠂⠈⠨⠜';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r4 = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const strongEl = firstP ? firstP.querySelector('strong') : null;
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      hasStrong: !!strongEl,
      strongText: strongEl ? strongEl.textContent : '',
      fullText: firstP ? firstP.textContent.trim() : '',
      modelSegments: model.blocks[0]?.segments,
    };
  });

  ok('Reverse sync maintains banaStyle="note" with formatted content', r4.banaDataset === 'note', r4.banaDataset);
  ok('Formatted text inside TN decodes bold word element', r4.hasStrong && r4.strongText === 'important', r4);
  ok('Segments in model retain bold tf=4 inside note block', r4.modelSegments?.some(s => s.text === 'important' && s.tf === 4), r4.modelSegments);

  // -------------------------------------------------------------------------
  // Part 5: Live End-to-End Reverse Sync (Footnotes)
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Footnote marker: ⠠⠋⠕⠕⠞⠝⠕⠞⠑ ⠼⠁⠲ ⠠⠗⠑⠋⠑⠗⠑⠝⠉⠑⠀⠝⠕⠞⠑⠲ (Footnote 1. Reference note.)
    brlEl.value = '⠠⠋⠕⠕⠞⠝⠕⠞⠑ ⠼⠁⠲ ⠠⠗⠑⠋⠑⠗⠑⠝⠉⠑⠀⠝⠕⠞⠑⠲';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r5 = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      classList: firstP ? Array.from(firstP.classList) : [],
      textContent: firstP ? firstP.textContent.trim() : '',
      modelType: model.blocks[0]?.type,
      modelStyle: model.blocks[0]?.style,
    };
  });

  ok('Reverse sync sets banaStyle="footnote" on Lexical Paragraph DOM dataset', r5.banaDataset === 'footnote', r5.banaDataset);
  ok('Reverse sync adds class "bana-style-footnote" to DOM', r5.classList.includes('bana-style-footnote'), r5.classList);
  ok('Reverse sync strips Footnote indicator prefix from Print text', r5.textContent.includes('Reference note'), r5.textContent);
  ok('buildModel extracts block type as "footnote"', r5.modelType === 'footnote', r5.modelType);

  // -------------------------------------------------------------------------
  // Part 6: Editing existing footnote in Braille preserves footnote style
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Edit the text starting with number (simulating editing in braille pane): ⠼⠁⠲ ⠠⠥⠏⠙⠁⠞⠑⠙⠀⠋⠕⠕⠞⠝⠕⠞⠑⠲
    brlEl.value = '⠼⠁⠲ ⠠⠥⠏⠙⠁⠞⠑⠙⠀⠋⠕⠕⠞⠝⠕⠞⠑⠲';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r6 = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      textContent: firstP ? firstP.textContent.trim() : '',
      modelType: model.blocks[0]?.type,
    };
  });

  ok('Editing existing footnote in Braille preserves banaStyle="footnote"', r6.banaDataset === 'footnote', r6.banaDataset);
  ok('Updated text is cleanly reconciled to Print', r6.textContent.includes('Updated footnote'), r6.textContent);
  ok('model block type remains "footnote"', r6.modelType === 'footnote', r6.modelType);

  // -------------------------------------------------------------------------
  // Part 7: Removing TN indicators reverts node to body paragraph
  // -------------------------------------------------------------------------
  // Setup note first
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    brlEl.value = '⠈⠨⠣⠠⠞⠑⠍⠏⠕⠗⠁⠗⠽⠀⠝⠕⠞⠑⠈⠨⠜';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 200));

  // Now delete TN indicators in Braille
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    brlEl.value = '⠠⠉⠕⠝⠧⠑⠗⠞⠑⠙⠀⠃⠕⠙⠽⠀⠏⠁⠗⠁⠛⠗⠁⠏⠓⠲';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r7 = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      textContent: firstP ? firstP.textContent.trim() : '',
      modelType: model.blocks[0]?.type,
    };
  });

  ok('Removing TN indicators reverts banaStyle to null (body paragraph)', r7.banaDataset == null, r7.banaDataset);
  ok('Text content updates cleanly as body paragraph', r7.textContent.includes('Converted body paragraph'), r7.textContent);
  ok('model block type becomes "para"', r7.modelType === 'para', r7.modelType);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
