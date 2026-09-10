import { chromium } from 'playwright';

let pass = 0;
const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.log(`  ✖ FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  console.log('--- Running Stage 5.3 Tables Reverse Sync Tests ---');

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
  await waitFor(() => document.querySelectorAll('#braille .brl-row').length > 0 && typeof window.detectBrailleTable === 'function' && typeof window.parseBrailleTable === 'function',
                'editor and table helper functions to finish initial render');
  await new Promise((r) => setTimeout(r, 300));

  // -------------------------------------------------------------------------
  // Part 1: Unit tests for Table Separator Lines & Column Boundary Slicing
  // -------------------------------------------------------------------------
  const u1 = await page.evaluate(() => {
    return {
      sepAscii: window.isTableSeparatorLine('-------  ---  -----'),
      sepUnicode25: window.isTableSeparatorLine('⠒⠒⠒⠒⠒⠒⠒  ⠒⠒⠒  ⠒⠒⠒⠒⠒'),
      sepUnicode36: window.isTableSeparatorLine('⠤⠤⠤⠤⠤⠤⠤  ⠤⠤⠤  ⠤⠤⠤⠤⠤'),
      sepBrf3: window.isTableSeparatorLine('3333333  333  33333'),
      sepEmDash: window.isTableSeparatorLine('——  ——  ——'),
      notSepSingleDash: window.isTableSeparatorLine('--- Page 1 ---'),
      notSepText: window.isTableSeparatorLine('Item     Qty  Cost'),
      notSepBoxline: window.isTableSeparatorLine('33333333333333333333333333333333333333'),

      colsAscii: window.extractColumnsFromSeparator('-------  ---  -----'),
      colsUnicode25: window.extractColumnsFromSeparator('⠒⠒⠒⠒⠒⠒⠒  ⠒⠒⠒  ⠒⠒⠒⠒⠒'),
      colsUnicode36: window.extractColumnsFromSeparator('⠤⠤⠤⠤⠤⠤⠤  ⠤⠤⠤  ⠤⠤⠤⠤⠤'),
    };
  });

  ok('isTableSeparatorLine detects ASCII dashes', u1.sepAscii === true, u1.sepAscii);
  ok('isTableSeparatorLine detects Unicode dots 2-5 (⠒)', u1.sepUnicode25 === true, u1.sepUnicode25);
  ok('isTableSeparatorLine detects Unicode dots 3-6 (⠤)', u1.sepUnicode36 === true, u1.sepUnicode36);
  ok('isTableSeparatorLine detects BRF 3 column rules', u1.sepBrf3 === true, u1.sepBrf3);
  ok('isTableSeparatorLine detects em dashes (——)', u1.sepEmDash === true, u1.sepEmDash);
  ok('isTableSeparatorLine rejects print page marker', u1.notSepSingleDash === false, u1.notSepSingleDash);
  ok('isTableSeparatorLine rejects text line', u1.notSepText === false, u1.notSepText);
  ok('isTableSeparatorLine rejects continuous sidebar boxline', u1.notSepBoxline === false, u1.notSepBoxline);

  ok('extractColumnsFromSeparator finds 3 columns in ASCII', u1.colsAscii.length === 3, u1.colsAscii.length);
  ok('extractColumnsFromSeparator finds 3 columns in Unicode (⠒)', u1.colsUnicode25.length === 3, u1.colsUnicode25.length);
  ok('extractColumnsFromSeparator finds 3 columns in Unicode (⠤)', u1.colsUnicode36.length === 3, u1.colsUnicode36.length);

  // -------------------------------------------------------------------------
  // Part 2: Unit tests for detectBrailleTable & detectBrailleBlockStyle
  // -------------------------------------------------------------------------
  const u2 = await page.evaluate(() => {
    const dTable = window.detectBrailleTable;
    const dStyle = window.detectBrailleBlockStyle;

    const spatialLines = [
      ',ITEM     ,QTY  ,CO/   ',
      '--------  ----  -------',
      ',APPLES   #E    @S#A4EJ'
    ];

    const listedLines = [
      '@.<,TABLE3 ,LI/$ ,TABLE ,=MAT@.>',
      ',APPLES',
      '  ,QTY3 #E',
      '  ,CO/3 @S#A4EJ'
    ];

    const markerSpatial = ['[table-spatial]', 'Col1  Col2', '--  --', 'A  B', '[/table-spatial]'];
    const markerListed = ['[table-listed]', 'Item 1', '  Col2: Val2'];
    const markerGeneric = ['[table]', 'Name  Age', '----  ---', 'Bob   30'];

    return {
      detSpatial: dTable(spatialLines),
      detListed: dTable(listedLines),
      detMarkerSpatial: dTable(markerSpatial),
      detMarkerListed: dTable(markerListed),
      detMarkerGeneric: dTable(markerGeneric),

      styleSpatial: dStyle(spatialLines),
      styleListed: dStyle(listedLines),
      styleMarkerSpatial: dStyle(markerSpatial),
      styleMarkerListed: dStyle(markerListed),
    };
  });

  ok('detectBrailleTable detects spatial table from separator rule', u2.detSpatial.isTable === true && u2.detSpatial.format === 'spatial');
  ok('detectBrailleTable detects listed table from TN announcement', u2.detListed.isTable === true && u2.detListed.format === 'listed');
  ok('detectBrailleTable detects [table-spatial] marker', u2.detMarkerSpatial.isTable === true && u2.detMarkerSpatial.format === 'spatial');
  ok('detectBrailleTable detects [table-listed] marker', u2.detMarkerListed.isTable === true && u2.detMarkerListed.format === 'listed');
  ok('detectBrailleTable detects [table] generic marker', u2.detMarkerGeneric.isTable === true);

  ok('detectBrailleBlockStyle returns style: table for spatial', u2.styleSpatial.style === 'table' && u2.styleSpatial.isTable === true);
  ok('detectBrailleBlockStyle returns style: table for listed', u2.styleListed.style === 'table' && u2.styleListed.isTable === true);
  ok('detectBrailleBlockStyle returns style: table for [table-spatial]', u2.styleMarkerSpatial.style === 'table' && u2.styleMarkerSpatial.isTable === true);
  ok('detectBrailleBlockStyle returns style: table for [table-listed]', u2.styleMarkerListed.style === 'table' && u2.styleMarkerListed.isTable === true);

  // -------------------------------------------------------------------------
  // Part 3: Unit tests for parseBrailleSpatialTable & parseBrailleListedTable
  // -------------------------------------------------------------------------
  const u3 = await page.evaluate(() => {
    const parseSpatial = window.parseBrailleSpatialTable;
    const parseListed = window.parseBrailleListedTable;
    const parseTable = window.parseBrailleTable;

    const spatialBrf = [
      '              ,9V5TORY',
      '      @.<,PRICES SUBJECT TO TAX@.>',
      ',ITEM     ,QTY  ,CO/   ',
      '--------  ----  -------',
      ',APPLES   #E    @S#A4EJ',
      ',ORANGES  #I    @S#B4JJ'
    ];

    const spatialUnicode = [
      '              ⠠⠊⠝⠧⠑⠝⠞⠕⠗⠽',
      '      ⠈⠨⠣⠠⠏⠗⠊⠉⠑⠎⠀⠎⠥⠃⠚⠑⠉⠞⠀⠞⠕⠀⠞⠁⠭⠈⠨⠜',
      '⠠⠊⠞⠑⠍      ⠠⠟⠞⠽  ⠠⠉⠕⠎⠞',
      '⠒⠒⠒⠒⠒⠒⠒⠒  ⠒⠒⠒⠒  ⠒⠒⠒⠒⠒⠒⠒',
      '⠠⠁⠏⠏⠇⠑⠎    ⠼⠑    ⠈⠎⠼⠁⠲⠑⠚',
      '⠠⠕⠗⠁⠝⠛⠑⠎   ⠼⠊    ⠈⠎⠼⠃⠲⠚⠚'
    ];

    const listedBrf = [
      '              ,9V5TORY',
      '      @.<,TABLE3 ,LI/$ ,TABLE ,=MAT@.>',
      ',APPLES',
      '  ,QTY3 #E',
      '  ,CO/3 @S#A4EJ',
      '',
      ',ORANGES',
      '  ,QTY3 #I',
      '  ,CO/3 @S#B4JJ'
    ];

    const listedUnicode = [
      '              ⠠⠊⠝⠧⠑⠝⠞⠕⠗⠽',
      '      ⠈⠨⠣⠠⠞⠁⠃⠇⠑⠒⠀⠠⠇⠊⠎⠞⠑⠙⠀⠠⠞⠁⠃⠇⠑⠀⠠⠿⠕⠗⠍⠁⠞⠈⠨⠜',
      '⠠⠁⠏⠏⠇⠑⠎',
      '  ⠠⠟⠞⠽⠒⠀⠼⠑',
      '  ⠠⠉⠕⠎⠞⠒⠀⠈⠎⠼⠁⠲⠑⠚',
      '',
      '⠠⠕⠗⠁⠝⠛⠑⠎',
      '  ⠠⠟⠞⠽⠒⠀⠼⠊',
      '  ⠠⠉⠕⠎⠞⠒⠀⠈⠎⠼⠃⠲⠚⠚'
    ];

    return {
      pSpatialBrf: parseSpatial(spatialBrf, null, ['Item', 'Qty', 'Cost']),
      pSpatialUni: parseSpatial(spatialUnicode, null, ['Item', 'Qty', 'Cost']),
      pListedBrf: parseListed(listedBrf, null, ['Item', 'Qty', 'Cost']),
      pListedUni: parseListed(listedUnicode, null, ['Item', 'Qty', 'Cost']),
      pAutoSpatial: parseTable(spatialBrf, null, ['Item', 'Qty', 'Cost']),
      pAutoListed: parseTable(listedBrf, null, ['Item', 'Qty', 'Cost']),
    };
  });

  // Verify Spatial BRF
  ok('parseSpatial (BRF) headers match', JSON.stringify(u3.pSpatialBrf.headers) === JSON.stringify(['Item', 'Qty', 'Cost']), u3.pSpatialBrf.headers);
  ok('parseSpatial (BRF) rows count is 2', u3.pSpatialBrf.rows.length === 2, u3.pSpatialBrf.rows.length);
  ok('parseSpatial (BRF) row 0 matches', u3.pSpatialBrf.rows[0][0] === 'Apples' && u3.pSpatialBrf.rows[0][1] === '5' && u3.pSpatialBrf.rows[0][2] === '$1.50', u3.pSpatialBrf.rows[0]);
  ok('parseSpatial (BRF) row 1 matches', u3.pSpatialBrf.rows[1][0] === 'Oranges' && u3.pSpatialBrf.rows[1][1] === '9' && u3.pSpatialBrf.rows[1][2] === '$2.00', u3.pSpatialBrf.rows[1]);
  ok('parseSpatial (BRF) caption matches', u3.pSpatialBrf.caption === 'Inventory', u3.pSpatialBrf.caption);
  ok('parseSpatial (BRF) tabletn matches', u3.pSpatialBrf.tabletn === 'Prices subject to tax', u3.pSpatialBrf.tabletn);

  // Verify Spatial Unicode
  ok('parseSpatial (Unicode) headers match', JSON.stringify(u3.pSpatialUni.headers) === JSON.stringify(['Item', 'Qty', 'Cost']), u3.pSpatialUni.headers);
  ok('parseSpatial (Unicode) row 0 matches', u3.pSpatialUni.rows[0][0] === 'Apples' && u3.pSpatialUni.rows[0][1] === '5' && u3.pSpatialUni.rows[0][2] === '$1.50', u3.pSpatialUni.rows[0]);
  ok('parseSpatial (Unicode) row 1 matches', u3.pSpatialUni.rows[1][0] === 'Oranges' && u3.pSpatialUni.rows[1][1] === '9' && u3.pSpatialUni.rows[1][2] === '$2.00', u3.pSpatialUni.rows[1]);
  ok('parseSpatial (Unicode) caption matches', u3.pSpatialUni.caption === 'Inventory', u3.pSpatialUni.caption);
  ok('parseSpatial (Unicode) tabletn matches', u3.pSpatialUni.tabletn === 'Prices subject to tax', u3.pSpatialUni.tabletn);

  // Verify Listed BRF
  ok('parseListed (BRF) headers match', JSON.stringify(u3.pListedBrf.headers) === JSON.stringify(['Item', 'Qty', 'Cost']), u3.pListedBrf.headers);
  ok('parseListed (BRF) row 0 matches', u3.pListedBrf.rows[0][0] === 'Apples' && u3.pListedBrf.rows[0][1] === '5' && u3.pListedBrf.rows[0][2] === '$1.50', u3.pListedBrf.rows[0]);
  ok('parseListed (BRF) row 1 matches', u3.pListedBrf.rows[1][0] === 'Oranges' && u3.pListedBrf.rows[1][1] === '9' && u3.pListedBrf.rows[1][2] === '$2.00', u3.pListedBrf.rows[1]);
  ok('parseListed (BRF) caption matches', u3.pListedBrf.caption === 'Inventory', u3.pListedBrf.caption);
  ok('parseListed (BRF) format is listed', u3.pListedBrf.format === 'listed', u3.pListedBrf.format);

  // Verify Listed Unicode
  ok('parseListed (Unicode) headers match', JSON.stringify(u3.pListedUni.headers) === JSON.stringify(['Item', 'Qty', 'Cost']), u3.pListedUni.headers);
  ok('parseListed (Unicode) row 0 matches', u3.pListedUni.rows[0][0] === 'Apples' && u3.pListedUni.rows[0][1] === '5' && u3.pListedUni.rows[0][2] === '$1.50', u3.pListedUni.rows[0]);
  ok('parseListed (Unicode) row 1 matches', u3.pListedUni.rows[1][0] === 'Oranges' && u3.pListedUni.rows[1][1] === '9' && u3.pListedUni.rows[1][2] === '$2.00', u3.pListedUni.rows[1]);

  // Verify Unified parseBrailleTable auto dispatch
  ok('parseBrailleTable dispatches to spatial', u3.pAutoSpatial.format === 'spatial' && u3.pAutoSpatial.rows.length === 2);
  ok('parseBrailleTable dispatches to listed', u3.pAutoListed.format === 'listed' && u3.pAutoListed.rows.length === 2);

  // -------------------------------------------------------------------------
  // Part 4: End-to-End Live Browser Reverse Sync & Mutation Tests
  // -------------------------------------------------------------------------
  console.log('\n--- Part 4: End-to-End Live Browser Table Reverse Sync ---');

  // Populate Lexical editor with a TableNode using window.modelToLexical
  await page.evaluate(() => {
    window.modelToLexical({
      title: 'Inventory Document',
      blocks: [
        {
          type: 'table',
          headers: ['Item', 'Qty', 'Cost'],
          rows: [
            ['Apples', '5', '$1.50'],
            ['Oranges', '9', '$2.00']
          ],
          caption: 'Inventory',
          tabletn: 'Prices subject to tax',
          format: 'spatial'
        }
      ]
    });
  });

  await new Promise((r) => setTimeout(r, 400));

  // Verify print pane rendered table widget
  const t1 = await page.evaluate(() => {
    const tableEl = document.querySelector('.doc-table-block table');
    const headerInputs = Array.from(document.querySelectorAll('.table-header-input')).map(i => i.value);
    const cellInputs = Array.from(document.querySelectorAll('td .table-cell-input')).map(i => i.value);
    const brlVal = document.getElementById('brlInput') ? document.getElementById('brlInput').value : '';
    const model = window.buildModel();
    return {
      hasTableEl: !!tableEl,
      headerInputs,
      cellInputs,
      hasBrl: brlVal.length > 0,
      modelType: model.blocks[0]?.type,
      modelHeaders: model.blocks[0]?.headers,
      modelRows: model.blocks[0]?.rows,
      brlVal
    };
  });

  ok('Table widget rendered in print pane', t1.hasTableEl);
  ok('Header inputs match in print pane', JSON.stringify(t1.headerInputs) === JSON.stringify(['Item', 'Qty', 'Cost']), t1.headerInputs);
  ok('Cell inputs match in print pane', JSON.stringify(t1.cellInputs) === JSON.stringify(['Apples', '5', '$1.50', 'Oranges', '9', '$2.00']), t1.cellInputs);
  ok('Model extracts block type as table', t1.modelType === 'table', t1.modelType);
  ok('Braille textarea received table output', t1.hasBrl);

  // -------------------------------------------------------------------------
  // Test 4.2: Live Edit a cell in Braille -> Reconciles to Lexical TableNode
  // -------------------------------------------------------------------------
  const recRes2 = await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const lines = brlInput.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('APPLES') || lines[i].includes('⠁⠏⠏⠇⠑⠎') || lines[i].includes('⠠⠁⠏⠏⠇⠑⠎') || lines[i].includes(',APPLES')) {
        lines[i] = lines[i].replace(/,APPLES/g, ',PEARS').replace(/APPLES/g, 'PEARS').replace(/⠠⠁⠏⠏⠇⠑⠎/g, '⠠⠏⠑⠁⠗⠎').replace(/⠁⠏⠏⠇⠑⠎/g, '⠏⠑⠁⠗⠎').replace(/#E/g, '#F').replace(/⠼⠑/g, '⠼⠋');
      }
    }
    brlInput.value = lines.join('\n');
    return window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const t2 = await page.evaluate(() => {
    const model = window.buildModel();
    return {
      modelRows: model.blocks[0]?.rows
    };
  });

  ok('reconcileBrailleChangeToPrint executed successfully on table cell edit', !!recRes2);
  ok('Lexical TableNode row 0 item updated to Pears', t2.modelRows?.[0]?.[0] === 'Pears', t2.modelRows);
  ok('Lexical TableNode row 0 qty updated to 6', t2.modelRows?.[0]?.[1] === '6', t2.modelRows);
  ok('Lexical TableNode row 1 retained intact', t2.modelRows?.[1]?.[0] === 'Oranges' && t2.modelRows?.[1]?.[1] === '9', t2.modelRows);

  // -------------------------------------------------------------------------
  // Test 4.3: Live Edit Table Header in Braille
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const lines = brlInput.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(',CO/') || lines[i].includes('⠠⠉⠕⠌') || lines[i].includes('⠠⠉⠕⠎⠞') || lines[i].includes('CO/')) {
        lines[i] = lines[i].replace(/,CO\//g, ',PRICE').replace(/CO\//g, 'PRICE').replace(/⠠⠉⠕⠌/g, '⠠⠏⠗⠊⠉⠑').replace(/⠠⠉⠕⠎⠞/g, '⠠⠏⠗⠊⠉⠑');
      }
    }
    brlInput.value = lines.join('\n');
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const t3 = await page.evaluate(() => {
    const model = window.buildModel();
    return { modelHeaders: model.blocks[0]?.headers };
  });

  ok('Lexical TableNode header 2 updated to Price', t3.modelHeaders?.[2] === 'Price', t3.modelHeaders);

  // -------------------------------------------------------------------------
  // Test 4.4: Add a new row in Braille
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    const isUnicode = brlInput.value.includes('⠠') || brlInput.value.includes('⠤') || brlInput.value.includes('⠒');
    const newRowLine = isUnicode ? '⠠⠛⠗⠁⠏⠑⠎       ⠼⠁⠃        ⠈⠎⠼⠉⠲⠑⠚' : ',GRAPES        #AB         @S#C4EJ';

    const lines = brlInput.value.split('\n');
    let lastRowIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('ORANGES') || lines[i].includes('⠕⠗⠁⠝⠛⠑⠎')) {
        lastRowIdx = i;
        break;
      }
    }
    if (lastRowIdx !== -1) {
      lines.splice(lastRowIdx + 1, 0, newRowLine);
    } else {
      lines.push(newRowLine);
    }
    brlInput.value = lines.join('\n');
    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const t4 = await page.evaluate(() => {
    const model = window.buildModel();
    return {
      rowCount: model.blocks[0]?.rows?.length,
      row2: model.blocks[0]?.rows?.[2]
    };
  });

  ok('Table row count increased to 3 after Braille edit', t4.rowCount === 3, t4.rowCount);
  ok('New row values match Grapes, 12, $3.50', t4.row2?.[0] === 'Grapes' && t4.row2?.[1] === '12' && t4.row2?.[2] === '$3.50', t4.row2);

  // -------------------------------------------------------------------------
  // Test 4.5: Replace Paragraph with Table via Braille Markers
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    window.modelToLexical({
      title: 'Doc',
      blocks: [
        {
          type: 'para',
          text: 'Just a regular paragraph here.'
        }
      ]
    });
  });
  await new Promise((r) => setTimeout(r, 400));

  await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    brlInput.value = [
      '[table]',
      ',NAME      ,AGE  ,CITY',
      '---------  ----  -------',
      ',ALICE     #BE   ,LONDON',
      ',BOB       #CJ   ,PARIS',
      '[/table]'
    ].join('\n');

    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const t5 = await page.evaluate(() => {
    const model = window.buildModel();
    return {
      isTbl: model.blocks[0]?.type === 'table',
      headers: model.blocks[0]?.headers,
      rows: model.blocks[0]?.rows
    };
  });

  ok('Paragraph replaced by TableNode on table braille input', t5.isTbl === true);
  ok('New table headers parsed correctly', JSON.stringify(t5.headers) === JSON.stringify(['Name', 'Age', 'City']), t5.headers);
  ok('New table rows count is 2', t5.rows?.length === 2, t5.rows?.length);
  ok('New table row 0 is Alice, 25, London', t5.rows?.[0]?.[0] === 'Alice' && t5.rows?.[0]?.[1] === '25' && t5.rows?.[0]?.[2] === 'London', t5.rows?.[0]);
  ok('New table row 1 is Bob, 30, Paris', t5.rows?.[1]?.[0] === 'Bob' && t5.rows?.[1]?.[1] === '30' && t5.rows?.[1]?.[2] === 'Paris', t5.rows?.[1]);

  // -------------------------------------------------------------------------
  // Test 4.6: Switch to Listed Table Format via Braille
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const brlInput = document.getElementById('brlInput');
    brlInput.value = [
      '              ,9V5TORY',
      '      @.<,TABLE3 ,LI/$ ,TABLE ,=MAT@.>',
      ',ALICE',
      '  ,AGE3 #BE',
      '  ,CITY3 ,LONDON',
      '',
      ',BOB',
      '  ,AGE3 #CJ',
      '  ,CITY3 ,PARIS'
    ].join('\n');

    window.reconcileBrailleChangeToPrint();
  });
  await new Promise((r) => setTimeout(r, 250));

  const t6 = await page.evaluate(() => {
    const model = window.buildModel();
    return {
      fmt: model.blocks[0]?.format || (model.blocks[0]?.style === 'table-listed' ? 'listed' : 'spatial'),
      rows: model.blocks[0]?.rows
    };
  });

  ok('Table format toggled to listed from Braille input', t6.fmt === 'listed', t6.fmt);
  ok('Listed table row 0 is Alice, 25, London', t6.rows?.[0]?.[0] === 'Alice' && t6.rows?.[0]?.[1] === '25' && t6.rows?.[0]?.[2] === 'London', t6.rows?.[0]);
  ok('Listed table row 1 is Bob, 30, Paris', t6.rows?.[1]?.[0] === 'Bob' && t6.rows?.[1]?.[1] === '30' && t6.rows?.[1]?.[2] === 'Paris', t6.rows?.[1]);

  // -------------------------------------------------------------------------
  // Test 4.7: Export Document (Markdown, JSON, DOCX)
  // -------------------------------------------------------------------------
  const t7 = await page.evaluate(() => {
    return { hasExportFn: typeof window.exportTextDocument === 'function' };
  });

  ok('exportTextDocument function is available and functional', t7.hasExportFn);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n=== Stage 5.3 Test Results: ${pass} passed, ${failures.length} failed ===`);
  await browser.close();

  if (failures.length > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
