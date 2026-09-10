import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 5.2 Poetry, Drama, Attribution & Stage Direction Reverse Sync Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.detectBrailleBlockStyle === 'function' && typeof window.stripStageIndicators === 'function',
                'editor and detection helpers to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // -------------------------------------------------------------------------
  // Part 1: Unit tests for indicator stripping
  // -------------------------------------------------------------------------
  const u1 = await page.evaluate(() => {
    return {
      stageBracket: window.stripStageIndicators('[stage: Exeunt omnes.]'),
      stageDirection: window.stripStageIndicators('(stage direction: Setting sun behind castle)'),
      stagePrefix: window.stripStageIndicators('⠠⠎⠞⠁⠛⠑: ⠠⠑⠭⠑⠥⠝⠞⠀⠕⠍⠝⠑⠎⠲'),

      poemBracket: window.stripPoemIndicators('[poem: Two roads diverged in a yellow wood]'),
      poemPrefix: window.stripPoemIndicators('⠠⠏⠕⠑⠍: ⠠⠞⠺⠕⠀⠗⠕⠁⠙⠎'),
      versePrefix: window.stripPoemIndicators('verse: Stanza text content'),

      dialogueBracket: window.stripDialogueIndicators('[dialogue: HAMLET: To be, or not to be.]'),
      dialoguePrefix: window.stripDialogueIndicators('⠠⠙⠊⠁⠇⠕⠛⠥⠑: HAMLET: Line'),

      attributionBracket: window.stripAttributionIndicators('[attribution: William Shakespeare]'),
      attributionSource: window.stripAttributionIndicators('[source: First Folio 1623]'),
      attributionPrefix: window.stripAttributionIndicators('⠠⠁⠞⠞⠗⠊⠃⠥⠞⠊⠕⠝: Author name'),

      captionBracket: window.stripCaptionIndicators('[caption: Figure 1. Diagram of the cell.]'),
      captionPrefix: window.stripCaptionIndicators('Caption: Figure 1. Diagram of the cell.'),
      captionFigurePrefix: window.stripCaptionIndicators('Figure 2: Structure model.'),

      quoteBracket: window.stripQuoteIndicators('[quote: The only thing we have to fear is fear itself.]'),
      quoteGt: window.stripQuoteIndicators('> Be the change you wish to see in the world.'),
    };
  });

  ok('stripStageIndicators strips [stage: ...]', u1.stageBracket === 'Exeunt omnes.', u1.stageBracket);
  ok('stripStageIndicators strips (stage direction: ...)', u1.stageDirection === 'Setting sun behind castle', u1.stageDirection);
  ok('stripStageIndicators strips ⠠⠎⠞⠁⠛⠑: prefix', u1.stagePrefix === '⠠⠑⠭⠑⠥⠝⠞⠀⠕⠍⠝⠑⠎⠲', u1.stagePrefix);

  ok('stripPoemIndicators strips [poem: ...]', u1.poemBracket === 'Two roads diverged in a yellow wood', u1.poemBracket);
  ok('stripPoemIndicators strips ⠠⠏⠕⠑⠍: prefix', u1.poemPrefix === '⠠⠞⠺⠕⠀⠗⠕⠁⠙⠎', u1.poemPrefix);
  ok('stripPoemIndicators strips verse: prefix', u1.versePrefix === 'Stanza text content', u1.versePrefix);

  ok('stripDialogueIndicators strips [dialogue: ...]', u1.dialogueBracket === 'HAMLET: To be, or not to be.', u1.dialogueBracket);
  ok('stripDialogueIndicators strips ⠠⠙⠊⠁⠇⠕⠛⠥⠑: prefix', u1.dialoguePrefix === 'HAMLET: Line', u1.dialoguePrefix);

  ok('stripAttributionIndicators strips [attribution: ...]', u1.attributionBracket === 'William Shakespeare', u1.attributionBracket);
  ok('stripAttributionIndicators strips [source: ...]', u1.attributionSource === 'First Folio 1623', u1.attributionSource);
  ok('stripAttributionIndicators strips ⠠⠁⠞⠞⠗⠊⠃⠥⠞⠊⠕⠝: prefix', u1.attributionPrefix === 'Author name', u1.attributionPrefix);

  ok('stripCaptionIndicators strips [caption: ...]', u1.captionBracket === 'Figure 1. Diagram of the cell.', u1.captionBracket);
  ok('stripCaptionIndicators strips Caption: prefix', u1.captionPrefix === 'Figure 1. Diagram of the cell.', u1.captionPrefix);
  ok('stripCaptionIndicators strips Figure 2: prefix', u1.captionFigurePrefix === 'Structure model.', u1.captionFigurePrefix);

  ok('stripQuoteIndicators strips [quote: ...]', u1.quoteBracket === 'The only thing we have to fear is fear itself.', u1.quoteBracket);
  ok('stripQuoteIndicators strips > prefix', u1.quoteGt === 'Be the change you wish to see in the world.', u1.quoteGt);

  // -------------------------------------------------------------------------
  // Part 2: Unit tests for detectBrailleBlockStyle
  // -------------------------------------------------------------------------
  const u2 = await page.evaluate(() => {
    const detect = window.detectBrailleBlockStyle;
    return {
      stage1: detect(['[stage: Exeunt omnes.]']),
      stage2: detect(['      (Enter HAMLET)']),
      stage3: detect(['      [Exit GHOST]']),
      dialogue1: detect(['[dialogue: HAMLET: Line]']),
      dialogue2: detect(['HAMLET: To be, or not to be.']),
      dialogue3: detect(['⠠⠓⠠⠁⠠⠍⠠⠇⠠⠑⠠⠞⠒ ⠠⠞⠕⠀⠃⠑']),
      poem1: detect(['[poem: Two roads diverged]']),
      poem2: detect(['[verse: Golden daffodils]']),
      caption1: detect(['[caption: Figure 1. Cell structure]']),
      caption2: detect(['Caption: Overview of the architecture']),
      attribution1: detect(['[attribution: William Shakespeare]']),
      attribution2: detect(['— Shakespeare']),
      quote1: detect(['[quote: Knowledge is power.]']),
      quote2: detect(['> Stay hungry, stay foolish.']),
    };
  });

  ok('detectBrailleBlockStyle detects [stage: ...]', u2.stage1.style === 'stage' && u2.stage1.isStage === true, u2.stage1);
  ok('detectBrailleBlockStyle detects Cell 7 (parenthetical) as stage', u2.stage2.style === 'stage' && u2.stage2.isStage === true, u2.stage2);
  ok('detectBrailleBlockStyle detects Cell 7 [bracketed] as stage', u2.stage3.style === 'stage' && u2.stage3.isStage === true, u2.stage3);

  ok('detectBrailleBlockStyle detects [dialogue: ...]', u2.dialogue1.style === 'dialogue' && u2.dialogue1.isDialogue === true, u2.dialogue1);
  ok('detectBrailleBlockStyle detects ASCII SPEAKER: line as dialogue', u2.dialogue2.style === 'dialogue' && u2.dialogue2.isDialogue === true, u2.dialogue2);
  ok('detectBrailleBlockStyle detects Unicode SPEAKER: line as dialogue', u2.dialogue3.style === 'dialogue' && u2.dialogue3.isDialogue === true, u2.dialogue3);

  ok('detectBrailleBlockStyle detects [poem: ...]', u2.poem1.style === 'poem' && u2.poem1.isPoem === true, u2.poem1);
  ok('detectBrailleBlockStyle detects [verse: ...]', u2.poem2.style === 'poem' && u2.poem2.isPoem === true, u2.poem2);

  ok('detectBrailleBlockStyle detects [caption: ...]', u2.caption1.style === 'caption' && u2.caption1.isCaption === true, u2.caption1);
  ok('detectBrailleBlockStyle detects Caption: prefix', u2.caption2.style === 'caption' && u2.caption2.isCaption === true, u2.caption2);

  ok('detectBrailleBlockStyle detects [attribution: ...]', u2.attribution1.style === 'attribution' && u2.attribution1.isAttribution === true, u2.attribution1);
  ok('detectBrailleBlockStyle detects — dash prefix as attribution', u2.attribution2.style === 'attribution' && u2.attribution2.isAttribution === true, u2.attribution2);

  ok('detectBrailleBlockStyle detects [quote: ...]', u2.quote1.style === 'quote' && u2.quote1.isQuote === true, u2.quote1);
  ok('detectBrailleBlockStyle detects > prefix as quote', u2.quote2.style === 'quote' && u2.quote2.isQuote === true, u2.quote2);

  // -------------------------------------------------------------------------
  // Part 3: Live End-to-End Reverse Sync: Play Dialogue (HAMLET: ...)
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Dialogue: ⠠⠓⠠⠁⠠⠍⠠⠇⠠⠑⠠⠞⠒ ⠠⠞⠕⠀⠃⠑⠂⠀⠕⠗⠀⠝⠕⠞⠀⠞⠕⠀⠃⠑⠲ (HAMLET: To be, or not to be.)
    brlEl.value = '⠠⠓⠠⠁⠠⠍⠠⠇⠠⠑⠠⠞⠒ ⠠⠞⠕⠀⠃⠑⠂⠀⠕⠗⠀⠝⠕⠞⠀⠞⠕⠀⠃⠑⠲';
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
    };
  });

  ok('Reverse sync sets banaStyle="dialogue" on Lexical Paragraph DOM dataset', r3.banaDataset === 'dialogue', r3.banaDataset);
  ok('Reverse sync adds class "bana-style-dialogue" to DOM', r3.classList.includes('bana-style-dialogue'), r3.classList);
  ok('Reverse sync decodes speaker line into Print', r3.textContent.includes('HAMLET: To be'), r3.textContent);
  ok('buildModel extracts block type as "play" with style "dialogue"', r3.modelType === 'play' && r3.modelStyle === 'dialogue', r3);

  // -------------------------------------------------------------------------
  // Part 4: Live End-to-End Reverse Sync: Stage Direction ([stage: ...])
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Stage direction: [stage: ⠠⠑⠭⠑⠥⠝⠞⠀⠕⠍⠝⠑⠎⠲] (Exeunt omnes.)
    brlEl.value = '[stage: ⠠⠑⠭⠑⠥⠝⠞⠀⠕⠍⠝⠑⠎⠲]';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r4 = await page.evaluate(() => {
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

  ok('Reverse sync sets banaStyle="stage" on Lexical Paragraph DOM dataset', r4.banaDataset === 'stage', r4.banaDataset);
  ok('Reverse sync adds class "bana-style-stage" to DOM', r4.classList.includes('bana-style-stage'), r4.classList);
  ok('Reverse sync strips stage indicator from Print text', r4.textContent.includes('Exeunt omnes'), r4.textContent);
  ok('buildModel extracts block type as "stage"', r4.modelType === 'stage', r4.modelType);

  // -------------------------------------------------------------------------
  // Part 5: Live End-to-End Reverse Sync: Poetry / Verse ([poem: ...])
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Poetry verse: [poem: ⠠⠞⠺⠕⠀⠗⠕⠁⠙⠎⠀⠙⠊⠧⠑⠗⠛⠑⠙] (Two roads diverged)
    brlEl.value = '[poem: ⠠⠞⠺⠕⠀⠗⠕⠁⠙⠎⠀⠙⠊⠧⠑⠗⠛⠑⠙]';
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
      modelSubtype: model.blocks[0]?.subtype,
      modelStyle: model.blocks[0]?.style,
    };
  });

  ok('Reverse sync sets banaStyle="poem" on Lexical Paragraph DOM dataset', r5.banaDataset === 'poem', r5.banaDataset);
  ok('Reverse sync adds class "bana-style-poem" to DOM', r5.classList.includes('bana-style-poem'), r5.classList);
  ok('Reverse sync strips poem indicator from Print text', r5.textContent.includes('Two roads diverged'), r5.textContent);
  ok('buildModel extracts block type as "play" with subtype "verse"', r5.modelType === 'play' && r5.modelSubtype === 'verse', r5);

  // -------------------------------------------------------------------------
  // Part 6: Live End-to-End Reverse Sync: Caption & Attribution
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Caption: [caption: ⠠⠙⠊⠁⠛⠗⠁⠍⠀⠷⠀⠉⠑⠇⠇⠲] (Diagram of cell.)
    brlEl.value = '[caption: ⠠⠙⠊⠁⠛⠗⠁⠍⠀⠷⠀⠉⠑⠇⠇⠲]';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r6a = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      classList: firstP ? Array.from(firstP.classList) : [],
      textContent: firstP ? firstP.textContent.trim() : '',
      modelType: model.blocks[0]?.type,
    };
  });

  ok('Reverse sync sets banaStyle="caption" on Lexical Paragraph DOM dataset', r6a.banaDataset === 'caption', r6a.banaDataset);
  ok('Reverse sync adds class "bana-style-caption" to DOM', r6a.classList.includes('bana-style-caption'), r6a.classList);
  ok('Reverse sync strips caption indicator from Print text', r6a.textContent.includes('Diagram of cell'), r6a.textContent);
  ok('buildModel extracts block type as "caption"', r6a.modelType === 'caption', r6a.modelType);

  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Attribution: [attribution: ⠠⠺⠊⠇⠇⠊⠁⠍⠀⠠⠎⠓⠁⠅⠑⠎⠏⠑⠁⠗⠑] (William Shakespeare)
    brlEl.value = '[attribution: ⠠⠺⠊⠇⠇⠊⠁⠍⠀⠠⠎⠓⠁⠅⠑⠎⠏⠑⠁⠗⠑]';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r6b = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      classList: firstP ? Array.from(firstP.classList) : [],
      textContent: firstP ? firstP.textContent.trim() : '',
      modelType: model.blocks[0]?.type,
    };
  });

  ok('Reverse sync sets banaStyle="attribution" on Lexical Paragraph DOM dataset', r6b.banaDataset === 'attribution', r6b.banaDataset);
  ok('Reverse sync adds class "bana-style-attribution" to DOM', r6b.classList.includes('bana-style-attribution'), r6b.classList);
  ok('Reverse sync strips attribution indicator from Print text', r6b.textContent.includes('William Shakespeare'), r6b.textContent);
  ok('buildModel extracts block type as "attribution"', r6b.modelType === 'attribution', r6b.modelType);

  // -------------------------------------------------------------------------
  // Part 7: Live End-to-End Reverse Sync: Quote ([quote: ...])
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    // Quote: [quote: ⠠⠅⠝⠕⠺⠇⠑⠙⠛⠑⠀⠊⠎⠀⠏⠕⠺⠑⠗⠲] (Knowledge is power.)
    brlEl.value = '[quote: ⠠⠅⠝⠕⠺⠇⠑⠙⠛⠑⠀⠊⠎⠀⠏⠕⠺⠑⠗⠲]';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r7 = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      classList: firstP ? Array.from(firstP.classList) : [],
      textContent: firstP ? firstP.textContent.trim() : '',
      modelStyle: model.blocks[0]?.style,
    };
  });

  ok('Reverse sync sets banaStyle="quote" on Lexical Paragraph DOM dataset', r7.banaDataset === 'quote', r7.banaDataset);
  ok('Reverse sync adds class "bana-style-quote" to DOM', r7.classList.includes('bana-style-quote'), r7.classList);
  ok('Reverse sync strips quote indicator from Print text', r7.textContent.includes('Knowledge is power'), r7.textContent);
  ok('buildModel extracts block style as "quote"', r7.modelStyle === 'quote', r7.modelStyle);

  // -------------------------------------------------------------------------
  // Part 8: Preserving existing style during live Braille edits
  // -------------------------------------------------------------------------
  // Set up poem style first
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    brlEl.value = '[poem: ⠠⠞⠺⠕⠀⠗⠕⠁⠙⠎⠀⠙⠊⠧⠑⠗⠛⠑⠙]';
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 200));

  // Edit the braille text without [poem: ] prefix
  await page.evaluate(() => {
    const brlEl = document.getElementById('brlInput');
    brlEl.value = '⠠⠁⠝⠙⠀⠎⠕⠗⠗⠽⠀⠠⠊⠀⠉⠕⠥⠇⠙⠀⠝⠕⠞⠀⠞⠗⠁⠧⠑⠇⠀⠃⠕⠞⠓'; // And sorry I could not travel both
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const r8 = await page.evaluate(() => {
    const editorEl = document.querySelector('#editor');
    const firstP = editorEl.querySelector('p');
    const model = window.buildModel();
    return {
      banaDataset: firstP ? firstP.dataset.banaStyle : null,
      textContent: firstP ? firstP.textContent.trim() : '',
      modelType: model.blocks[0]?.type,
      modelSubtype: model.blocks[0]?.subtype,
    };
  });

  ok('Editing existing poem line preserves banaStyle="poem"', r8.banaDataset === 'poem', r8.banaDataset);
  ok('Updated line reconciles cleanly to Print', r8.textContent.includes('sorry I could not travel both'), r8.textContent);
  ok('model block type remains "play" with subtype "verse"', r8.modelType === 'play' && r8.modelSubtype === 'verse', r8);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
