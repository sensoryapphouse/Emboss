import { chromium } from 'playwright';
import { unzip } from '../../Translate/unmxl.mjs';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 4.2 Production Deliverables & Multi-Volume Export Tests ---');
  
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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.exportTextDocument === 'function',
                'editor and export engine to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // Set up standard multi-page test document in Lexical
  await page.evaluate(() => {
    const blocks = [
      { type: 'heading', level: 1, text: 'BIOLOGY GRADE 8' },
      { type: 'pagenum', page: '10' },
      { type: 'para', text: 'Cells are the fundamental units of all living organisms. Plant and animal cells possess distinct organelles.' },
      { type: 'heading', level: 2, text: 'Cellular Respiration' },
      { type: 'para', text: 'Mitochondria generate adenosine triphosphate through aerobic metabolism.' },
      { type: 'indicator', kind: 'asterisks' },
      { type: 'pagenum', page: '11' },
      { type: 'heading', level: 2, text: 'Key Organelles' },
      { type: 'list', items: [{ text: 'Nucleus containing genomic DNA', marker: '1.' }, { text: 'Mitochondria for energy production', marker: '2.' }, { text: 'Ribosomes synthesizing proteins', marker: '3.' }] },
      { type: 'box', title: 'Summary Note', blocks: [{ type: 'para', text: 'All cell functions require coordinated membrane transport systems.' }] }
    ];
    window.modelToLexical({ title: 'BIOLOGY GRADE 8', blocks });
  });

  await new Promise((r) => setTimeout(r, 600));

  // Helper to capture blob saved by window.saveBlob
  await page.evaluate(() => {
    window._capturedDownloads = [];
    window.saveBlob = (blob, name) => {
      const entry = {
        name,
        type: blob?.type || '',
        size: blob?.size || 0,
        blob
      };
      window._capturedDownloads.push(entry);
    };
  });

  // Test 1: Single-Volume BRF Deliverable Export
  const r1 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    window.triggerDownloadFormat('brf');
    await new Promise((r) => setTimeout(r, 150));
    const dl = window._capturedDownloads[0];
    return dl;
  });

  ok('Single-volume BRF export creates .brf file', r1 && r1.name.endsWith('.brf'), r1?.name);
  ok('Single-volume BRF is non-empty', r1 && r1.size > 100, r1?.size);

  // Test 2: Multi-Volume BRF Deliverable Export (Zipped volumes)
  const r2 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    // Load a very long multi-chapter model and set volumePages = 1
    const blocks = [];
    for (let p = 1; p <= 6; p++) {
      blocks.push({ type: 'heading', level: 2, text: `Chapter ${p}` });
      blocks.push({ type: 'pagenum', page: String(p) });
      blocks.push({ type: 'para', text: `This is chapter ${p} paragraph with sufficient lines to trigger multi-volume splitting.` });
      blocks.push({ type: 'para', text: `Additional sentences for chapter ${p} to ensure page limit exceeds 25 lines.` });
    }
    // Set volumePages to 1 to force volume split
    const oldVol = window.settings.volumePages;
    window.settings.volumePages = 1;
    window.modelToLexical({ title: 'Multi Volume Test', blocks });
    await new Promise((r) => setTimeout(r, 500));
    window.triggerDownloadFormat('brf');
    await new Promise((r) => setTimeout(r, 200));
    window.settings.volumePages = oldVol;
    const dl = window._capturedDownloads[0];
    return dl;
  });

  ok('Multi-volume BRF export creates zip archive', r2 && r2.name.includes('.zip'), r2?.name);
  ok('Multi-volume zip archive is non-empty', r2 && r2.size > 200, r2?.size);

  // Test 3: PEF 1.0 XML Deliverable Export
  const r3 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    window.triggerDownloadFormat('pef');
    await new Promise((r) => setTimeout(r, 150));
    const dl = window._capturedDownloads[0];
    return dl;
  });

  ok('PEF export creates .pef XML file', r3 && r3.name.endsWith('.pef'), r3?.name);
  ok('PEF export mime-type is application/x-pef+xml', r3 && r3.type === 'application/x-pef+xml', r3?.type);

  // Test 4: eBraille 1.0 Package Export (.ebraille)
  const r4 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    window.triggerDownloadFormat('ebraille');
    await new Promise((r) => setTimeout(r, 250));
    const dl = window._capturedDownloads[0];
    return dl;
  });

  ok('eBraille export creates .ebraille package', r4 && r4.name.endsWith('.ebraille'), r4?.name);
  ok('eBraille package mime-type is application/epub+zip', r4 && r4.type === 'application/epub+zip', r4?.type);
  ok('eBraille package is non-empty', r4 && r4.size > 500, r4?.size);

  // Test 5: NIMAS XML Project Document Export (.xml)
  const r5 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    window.exportTextDocument('xml');
    await new Promise((r) => setTimeout(r, 150));
    const dl = window._capturedDownloads[0];
    return dl;
  });

  ok('NIMAS export creates .xml file', r5 && r5.name.endsWith('.xml'), r5?.name);
  ok('NIMAS export mime-type is application/xml', r5 && r5.type.includes('application/xml'), r5?.type);

  // Test 6: Word Document Export (.docx)
  const r6 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    window.exportTextDocument('docx');
    await new Promise((r) => setTimeout(r, 150));
    const dl = window._capturedDownloads[0];
    return dl;
  });

  ok('Word export creates .docx file', r6 && r6.name.endsWith('.docx'), r6?.name);
  ok('Word docx blob is non-empty', r6 && r6.size > 500, r6?.size);

  // Test 7: Native Project JSON Export (.json)
  const r7 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    window.exportTextDocument('json');
    await new Promise((r) => setTimeout(r, 150));
    const dl = window._capturedDownloads[0];
    return dl;
  });

  ok('Project JSON export creates .json file', r7 && r7.name.endsWith('.json'), r7?.name);
  ok('Project JSON mime-type is application/json', r7 && r7.type.includes('application/json'), r7?.type);

  // Test 8: Markdown Export (.md) and Plain Text (.txt)
  const r8 = await page.evaluate(async () => {
    window._capturedDownloads = [];
    window.exportTextDocument('md');
    window.exportTextDocument('txt');
    window.exportTextDocument('html');
    await new Promise((r) => setTimeout(r, 150));
    const dls = window._capturedDownloads;
    return {
      hasMd: dls.some(d => d.name.endsWith('.md')),
      hasTxt: dls.some(d => d.name.endsWith('.txt')),
      hasHtml: dls.some(d => d.name.endsWith('.html')),
    };
  });

  ok('Markdown export creates .md file', r8.hasMd === true, r8);
  ok('Plain text export creates .txt file', r8.hasTxt === true, r8);
  ok('HTML export creates .html file', r8.hasHtml === true, r8);

  // Test 9: UI Save Button & Braille Dropdown Menu Interactions
  const r9 = await page.evaluate(async () => {
    const saveBtn = document.getElementById('saveDocBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadMenu = document.getElementById('downloadMenu');

    // Check save button is a direct action button
    const hasSaveBtn = !!saveBtn;
    const saveTitle = saveBtn?.getAttribute('title') || '';

    // Click download button to toggle braille download menu
    downloadBtn.click();
    const downloadOpen = !downloadMenu.hidden;
    const downloadItemsCount = downloadMenu.querySelectorAll('.menu-dropdown-item').length;

    return {
      hasSaveBtn,
      saveTitle,
      downloadOpen,
      downloadItemsCount,
    };
  });

  ok('Save button is present as a direct 1-click action', r9.hasSaveBtn === true, r9);
  ok('Save button indicates NIMAS project save', r9.saveTitle.includes('NIMAS'), r9.saveTitle);
  ok('Braille deliverable dropdown menu opens on button click', r9.downloadOpen === true, r9);
  ok('Braille deliverable menu has 3 format items (BRF, PEF, eBraille)', r9.downloadItemsCount === 3, r9.downloadItemsCount);

  await browser.close();

  console.log(`\nResults: ${pass} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error('Failed tests:', failures);
    process.exit(1);
  }
})();
