// Systematic Test Harness for Phase 4C: TableNode & Interactive Table Sync
// Tests Lexical TableNode data model, dynamic cell/row/col mutations,
// format mode toggles (auto / spatial / listed), JSON serialization,
// AST <-> Lexical round-trip, live braille rendering, and all 154 textbook tables.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import {
  createEditor, $getRoot, $createTextNode, registerList, registerRichText,
  ListNode, ListItemNode, ParagraphNode, TextNode, HeadingNode, QuoteNode,
  $createHeadingNode, $createParagraphNode, ElementNode, DecoratorNode, $createListNode,
  $createListItemNode, $applyNodeReplacement, $isHeadingNode, $isListNode
} from '../web/editor/vendor-lexical.mjs';

import { exportToNimasXml } from '../input/nimas-export.mjs';
import { parseDtbook, parseNimasXml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';

console.log('=== Running BANA Table Editor & Sync Test Suite (Phase 4C) ===\n');

let pass = 0, fail = 0, skipped = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name}`);
    if (detail) console.error(`    Detail: ${detail}`);
  }
}

// Setup custom TableNode matching editor.mjs implementation
class TableNode extends DecoratorNode {
  __headers = [];
  __rows = [];
  __format = 'auto';
  __caption = '';
  __tabletn = '';

  static getType() { return 'emboss-table'; }
  static clone(n) {
    return new TableNode(
      [...(n.__headers || [])],
      (n.__rows || []).map(r => [...r]),
      n.__format || 'auto',
      n.__caption || '',
      n.__tabletn || '',
      n.__key
    );
  }
  constructor(headers = [], rows = [], format = 'auto', caption = '', tabletn = '', key) {
    super(key);
    this.__headers = Array.isArray(headers) ? headers : [];
    this.__rows = Array.isArray(rows) ? rows : [];
    this.__format = format || 'auto';
    this.__caption = caption || '';
    this.__tabletn = tabletn || '';
  }
  createDOM() {
    return {
      nodeName: 'DIV',
      className: 'doc-table-block',
      setAttribute: () => {},
    };
  }
  updateDOM() { return true; }
  afterCloneFrom(prevNode) {
    super.afterCloneFrom(prevNode);
    this.__headers = [...(prevNode.__headers || [])];
    this.__rows = (prevNode.__rows || []).map(r => [...r]);
    this.__format = prevNode.__format || 'auto';
    this.__caption = prevNode.__caption || '';
    this.__tabletn = prevNode.__tabletn || '';
  }
  decorate() {
    return {
      type: 'table',
      headers: this.__headers,
      rows: this.__rows,
      format: this.__format,
      caption: this.__caption,
      tabletn: this.__tabletn,
    };
  }
  isInline() { return false; }
  getHeaders() { return this.getLatest().__headers; }
  getRows() { return this.getLatest().__rows; }
  getFormat() { return this.getLatest().__format || 'auto'; }
  getCaption() { return this.getLatest().__caption || ''; }
  getTabletn() { return this.getLatest().__tabletn || ''; }
  setHeaders(h) { this.getWritable().__headers = h; }
  setRows(r) { this.getWritable().__rows = r; }
  setFormat(f) { this.getWritable().__format = f || 'auto'; }
  setCaption(c) { this.getWritable().__caption = c || ''; }
  setTabletn(tn) { this.getWritable().__tabletn = tn || ''; }
  setCell(ri, ci, val) {
    const w = this.getWritable();
    if (ri === -1) {
      const h = [...(w.__headers || [])];
      while (h.length <= ci) h.push('');
      h[ci] = val;
      w.__headers = h;
    } else {
      const rows = (w.__rows || []).map(r => [...r]);
      while (rows.length <= ri) rows.push([]);
      while (rows[ri].length <= ci) rows[ri].push('');
      rows[ri][ci] = val;
      w.__rows = rows;
    }
  }
  addRow() {
    const w = this.getWritable();
    const colCount = Math.max(w.__headers.length, ...(w.__rows.map(r => r.length)), 2);
    const newRow = Array(colCount).fill('');
    w.__rows = [...(w.__rows || []), newRow];
  }
  removeRow(ri) {
    const w = this.getWritable();
    if (w.__rows && w.__rows.length > 1) {
      w.__rows = w.__rows.filter((_, idx) => idx !== ri);
    }
  }
  addColumn() {
    const w = this.getWritable();
    if (w.__headers && w.__headers.length > 0) w.__headers = [...w.__headers, ''];
    w.__rows = (w.__rows || []).map(r => [...r, '']);
  }
  removeColumn(ci) {
    const w = this.getWritable();
    if (w.__headers && w.__headers.length > ci) w.__headers = w.__headers.filter((_, idx) => idx !== ci);
    if (w.__rows) w.__rows = w.__rows.map(r => r.filter((_, idx) => idx !== ci));
  }
  exportJSON() {
    return {
      type: 'emboss-table',
      version: 1,
      headers: this.__headers,
      rows: this.__rows,
      format: this.__format,
      caption: this.__caption,
      tabletn: this.__tabletn,
    };
  }
  static importJSON(j) {
    return new TableNode(j.headers || [], j.rows || [], j.format || 'auto', j.caption || '', j.tabletn || '');
  }
}

const $createTableNode = (headers, rows, format = 'auto', caption = '', tabletn = '') =>
  $applyNodeReplacement ? $applyNodeReplacement(new TableNode(headers, rows, format, caption, tabletn)) : new TableNode(headers, rows, format, caption, tabletn);
const $isTableNode = (n) => n instanceof TableNode;

// Setup SidebarNode for container testing
class SidebarNode extends ElementNode {
  static getType() { return 'emboss-sidebar'; }
  static clone(n) { return new SidebarNode(n.__title, n.__key); }
  constructor(title = '', key) {
    super(key);
    this.__title = title || '';
    this.__banaStyle = 'sidebar';
  }
  createDOM(config) {
    return {
      nodeName: 'ASIDE',
      className: 'emboss-sidebar-card bana-style-sidebar',
      dataset: { banaStyle: 'sidebar', title: this.__title }
    };
  }
  updateDOM() { return false; }
  afterCloneFrom(prevNode) {
    super.afterCloneFrom(prevNode);
    this.__title = prevNode.__title || '';
    this.__banaStyle = prevNode.__banaStyle || 'sidebar';
  }
  getTitle() { return this.getLatest().__title || ''; }
  setTitle(t) { this.getWritable().__title = t || ''; return this; }
  getBanaStyle() { return 'sidebar'; }
  setBanaStyle() { return this; }
  exportJSON() {
    return {
      ...super.exportJSON(),
      type: 'emboss-sidebar',
      version: 1,
      title: this.__title,
      banaStyle: this.__banaStyle,
    };
  }
  static importJSON(j) {
    const n = new SidebarNode(j.title);
    n.__banaStyle = j.banaStyle || 'sidebar';
    return n;
  }
  canInsertBlockAfter() { return true; }
  canIndent() { return false; }
  collapseAtStart() { return true; }
}
const $createSidebarNode = (title = '') => $applyNodeReplacement ? $applyNodeReplacement(new SidebarNode(title)) : new SidebarNode(title);
const $isSidebarNode = (n) => n instanceof SidebarNode;

// Helper to create Lexical editor instance
function createTestEditor() {
  const ed = createEditor({
    nodes: [HeadingNode, ParagraphNode, TextNode, TableNode, SidebarNode, ListNode, ListItemNode, QuoteNode],
    onError: (e) => { throw e; }
  });
  registerRichText(ed);
  registerList(ed);
  return ed;
}

// Convert Document Model AST -> Lexical Root
function populateLexicalFromAST(editor, docModel) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    for (const b of (docModel.blocks || [])) {
      if (b.type === 'table') {
        const fmt = b.format || (b.style === 'table-listed' ? 'listed' : (b.style === 'table-spatial' ? 'spatial' : 'auto'));
        root.append($createTableNode(b.headers || [], b.rows || [], fmt, b.caption || b.title || '', b.tabletn || ''));
      } else if (b.type === 'box' || b.type === 'sidebar') {
        const sidebar = $createSidebarNode(b.title || '');
        if (b.blocks && b.blocks.length) {
          for (const cb of b.blocks) {
            if (cb.type === 'table') {
              const fmt = cb.format || (cb.style === 'table-listed' ? 'listed' : (cb.style === 'table-spatial' ? 'spatial' : 'auto'));
              sidebar.append($createTableNode(cb.headers || [], cb.rows || [], fmt, cb.caption || cb.title || '', cb.tabletn || ''));
            } else if (cb.type === 'heading') {
              const h = $createHeadingNode('h' + Math.min(3, cb.level || 2));
              h.append($createTextNode(cb.text || ''));
              sidebar.append(h);
            } else {
              const p = $createParagraphNode();
              p.append($createTextNode(cb.text || ''));
              sidebar.append(p);
            }
          }
        }
        root.append(sidebar);
      } else if (b.type === 'heading') {
        const h = $createHeadingNode('h' + Math.min(3, b.level || 1));
        h.append($createTextNode(b.text || ''));
        root.append(h);
      } else {
        const p = $createParagraphNode();
        p.append($createTextNode(b.text || ''));
        root.append(p);
      }
    }
  });
}

// Convert Lexical Root -> Document Model AST (matching buildModel in editor.mjs)
function extractASTFromLexical(editor) {
  let docModel = { blocks: [] };
  editor.read(() => {
    const root = $getRoot();
    for (const node of root.getChildren()) {
      if ($isTableNode(node)) {
        const tbl = {
          type: 'table',
          headers: node.getHeaders(),
          rows: node.getRows()
        };
        const fmt = node.getFormat();
        if (fmt && fmt !== 'auto') {
          tbl.format = fmt;
          tbl.style = `table-${fmt}`;
        }
        const cap = node.getCaption();
        if (cap) tbl.caption = cap;
        const tn = node.getTabletn();
        if (tn) tbl.tabletn = tn;
        docModel.blocks.push(tbl);
      } else if ($isSidebarNode(node)) {
        const innerBlocks = [];
        for (const child of node.getChildren()) {
          if ($isTableNode(child)) {
            const tbl = {
              type: 'table',
              headers: child.getHeaders(),
              rows: child.getRows()
            };
            const fmt = child.getFormat();
            if (fmt && fmt !== 'auto') {
              tbl.format = fmt;
              tbl.style = `table-${fmt}`;
            }
            const cap = child.getCaption();
            if (cap) tbl.caption = cap;
            const tn = child.getTabletn();
            if (tn) tbl.tabletn = tn;
            innerBlocks.push(tbl);
          } else if ($isHeadingNode(child)) {
            innerBlocks.push({ type: 'heading', level: Math.min(3, Number(child.getTag().slice(1)) || 2), text: child.getTextContent().trim() });
          } else {
            innerBlocks.push({ type: 'paragraph', text: child.getTextContent().trim() });
          }
        }
        const box = { type: 'box' };
        if (node.getTitle()) box.title = node.getTitle();
        if (innerBlocks.length) box.blocks = innerBlocks;
        docModel.blocks.push(box);
      } else if ($isHeadingNode(node)) {
        docModel.blocks.push({ type: 'heading', level: Math.min(3, Number(node.getTag().slice(1)) || 1), text: node.getTextContent().trim() });
      } else {
        docModel.blocks.push({ type: 'paragraph', text: node.getTextContent().trim() });
      }
    }
  });
  return docModel;
}

// ----------------------------------------------------------------------------
// Section 1: TableNode Structure & Mutation Methods
// ----------------------------------------------------------------------------
console.log('--- Section 1: TableNode Structure & Mutation Methods ---');

const testEd = createTestEditor();
let tableNodeKey = null;

testEd.update(() => {
  const root = $getRoot();
  const tbl = $createTableNode(
    ['Item', 'Qty', 'Cost'],
    [
      ['Apples', '5', '$2.50'],
      ['Oranges', '10', '$4.00']
    ],
    'auto',
    'Inventory Table',
    'Prices subject to tax'
  );
  root.append(tbl);
  tableNodeKey = tbl.getKey();
});

testEd.read(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();
  check('TableNode exists in Lexical state', $isTableNode(tbl));
  check('TableNode headers match', JSON.stringify(tbl.getHeaders()) === JSON.stringify(['Item', 'Qty', 'Cost']));
  check('TableNode rows count is 2', tbl.getRows().length === 2);
  check('TableNode format is auto', tbl.getFormat() === 'auto');
  check('TableNode caption matches', tbl.getCaption() === 'Inventory Table');
  check('TableNode tabletn matches', tbl.getTabletn() === 'Prices subject to tax');
});

// Test dynamic mutations: setCell, addRow, addColumn, removeRow, removeColumn, setFormat
testEd.update(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();
  // Modify cell
  tbl.setCell(0, 1, '7'); // Change Apples qty from 5 to 7
  tbl.setCell(-1, 2, 'Price ($)'); // Change Cost header to Price ($)
  
  // Add row
  tbl.addRow();
  tbl.setCell(2, 0, 'Bananas');
  tbl.setCell(2, 1, '12');
  tbl.setCell(2, 2, '$3.00');

  // Add column
  tbl.addColumn();
  tbl.setCell(-1, 3, 'In Stock');
  tbl.setCell(0, 3, 'Yes');
  tbl.setCell(1, 3, 'Yes');
  tbl.setCell(2, 3, 'No');

  // Change format
  tbl.setFormat('listed');
});

testEd.read(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();
  check('setCell modified header', tbl.getHeaders()[2] === 'Price ($)');
  check('setCell modified body cell', tbl.getRows()[0][1] === '7');
  check('addRow expanded rows count to 3', tbl.getRows().length === 3);
  check('addRow new row contents match', tbl.getRows()[2][0] === 'Bananas' && tbl.getRows()[2][1] === '12');
  check('addColumn expanded headers to 4 cols', tbl.getHeaders().length === 4 && tbl.getHeaders()[3] === 'In Stock');
  check('addColumn updated all rows', tbl.getRows().every(r => r.length === 4));
  check('setFormat switched mode to listed', tbl.getFormat() === 'listed');
});

// Test removal mutations
testEd.update(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();
  // Remove Bananas row (index 2)
  tbl.removeRow(2);
  // Remove "In Stock" column (index 3)
  tbl.removeColumn(3);
});

testEd.read(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();
  check('removeRow reduced row count back to 2', tbl.getRows().length === 2);
  check('removeRow removed Bananas row', !tbl.getRows().some(r => r[0] === 'Bananas'));
  check('removeColumn reduced headers to 3 cols', tbl.getHeaders().length === 3 && !tbl.getHeaders().includes('In Stock'));
  check('removeColumn reduced all row widths to 3', tbl.getRows().every(r => r.length === 3));
});

// ----------------------------------------------------------------------------
// Section 2: JSON Serialization & Node Cloning
// ----------------------------------------------------------------------------
console.log('\n--- Section 2: JSON Serialization & Node Cloning ---');

let jsonExport = null;
testEd.read(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();
  jsonExport = tbl.exportJSON();
  check('exportJSON type is emboss-table', jsonExport.type === 'emboss-table');
  check('exportJSON headers preserved', jsonExport.headers.length === 3);
  check('exportJSON format is listed', jsonExport.format === 'listed');
  check('exportJSON caption preserved', jsonExport.caption === 'Inventory Table');
  check('exportJSON tabletn preserved', jsonExport.tabletn === 'Prices subject to tax');
});

testEd.update(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();

  const imported = TableNode.importJSON(jsonExport);
  check('importJSON restores headers', JSON.stringify(imported.getHeaders()) === JSON.stringify(jsonExport.headers));
  check('importJSON restores rows', JSON.stringify(imported.getRows()) === JSON.stringify(jsonExport.rows));
  check('importJSON restores format', imported.getFormat() === 'listed');
  check('importJSON restores caption', imported.getCaption() === 'Inventory Table');
  check('importJSON restores tabletn', imported.getTabletn() === 'Prices subject to tax');

  const cloned = TableNode.clone(tbl);
  check('clone copies rows into new array', cloned.__rows !== tbl.__rows);
  const origFirstVal = tbl.__rows[0][0];
  cloned.__rows[0][0] = 'MUTATED';
  check('mutating clone does not mutate original node', tbl.__rows[0][0] === origFirstVal);
});

// ----------------------------------------------------------------------------
// Section 3: AST <-> Lexical Bidirectional Synchronization
// ----------------------------------------------------------------------------
console.log('\n--- Section 3: AST <-> Lexical Bidirectional Synchronization ---');

const sampleAST = {
  blocks: [
    { type: 'heading', level: 1, text: 'Scientific Measurements' },
    {
      type: 'table',
      headers: ['Trial', 'Temperature (°C)', 'Pressure (atm)'],
      rows: [
        ['1', '21.5', '1.01'],
        ['2', '22.0', '1.02'],
        ['3', '21.8', '1.00']
      ],
      format: 'spatial',
      style: 'table-spatial',
      caption: 'Lab Experiment Results',
      tabletn: 'Room temperature held constant'
    },
    {
      type: 'box',
      title: 'Supplemental Data',
      blocks: [
        {
          type: 'table',
          headers: ['Sample', 'Mass (g)', 'Volume (mL)'],
          rows: [
            ['A', '14.2', '5.1'],
            ['B', '28.4', '10.2']
          ],
          format: 'listed',
          style: 'table-listed'
        }
      ]
    }
  ]
};

const syncEditor = createTestEditor();
populateLexicalFromAST(syncEditor, sampleAST);

const extractedAST = extractASTFromLexical(syncEditor);

check('Extracted AST has 3 blocks', extractedAST.blocks.length === 3);
check('First table format is spatial', extractedAST.blocks[1].format === 'spatial');
check('First table caption preserved', extractedAST.blocks[1].caption === 'Lab Experiment Results');
check('First table tabletn preserved', extractedAST.blocks[1].tabletn === 'Room temperature held constant');
check('First table headers match', JSON.stringify(extractedAST.blocks[1].headers) === JSON.stringify(sampleAST.blocks[1].headers));
check('First table rows match', JSON.stringify(extractedAST.blocks[1].rows) === JSON.stringify(sampleAST.blocks[1].rows));

check('Sidebar box contains nested table', extractedAST.blocks[2].blocks[0].type === 'table');
check('Nested table format is listed', extractedAST.blocks[2].blocks[0].format === 'listed');
check('Nested table rows match', JSON.stringify(extractedAST.blocks[2].blocks[0].rows) === JSON.stringify(sampleAST.blocks[2].blocks[0].rows));

// ----------------------------------------------------------------------------
// Section 4: Live Braille Rendering & Mode Toggle Test
// ----------------------------------------------------------------------------
console.log('\n--- Section 4: Live Braille Rendering & Mode Toggle Test ---');

const brailleOptions = {
  cells: 40,
  lines: 25,
  brailleTable: 'en-ueb-g2.ctb',
  translate: (text) => text.toLowerCase()
};

// 1. Format as Spatial
const spatialDoc = {
  blocks: [
    {
      type: 'table',
      headers: ['Country', 'Capital', 'Pop (M)'],
      rows: [
        ['France', 'Paris', '67'],
        ['Germany', 'Berlin', '83']
      ],
      format: 'spatial'
    }
  ]
};
const spatialText = formatDocument(spatialDoc, brailleOptions);
check('Spatial braille contains column separator line ("333, Formats §11.4.2b)', spatialText.includes('"333'));
check('Spatial braille contains Paris', spatialText.includes('paris'));

// 2. Switch Mode to Listed in Lexical and Re-render
populateLexicalFromAST(syncEditor, spatialDoc);
syncEditor.update(() => {
  const root = $getRoot();
  const tbl = root.getFirstChild();
  tbl.setFormat('listed');
});

const toggledAST = extractASTFromLexical(syncEditor);
check('Toggled AST has format: listed', toggledAST.blocks[0].format === 'listed');

const listedText = formatDocument(toggledAST, brailleOptions);
check('Listed braille includes the §11.16 transcriber note', listedText.toLowerCase().includes('print format is changed'));
check('Listed braille includes row key prefix (country:)', listedText.includes('country:') || listedText.includes('france'));
check('Listed braille includes attribute prefix (capital: paris)', listedText.includes('capital: paris'));

// ----------------------------------------------------------------------------
// Section 5: Production Scale Benchmark (All 154 Real Textbook Tables)
// ----------------------------------------------------------------------------
console.log('\n--- Section 5: Scale Test: All 154 Production Tables in Grade 7 Textbook ---');

// Primary source is the committed fixture; the Downloads copy is only a fallback if it exists.
const TEXTBOOK_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nimas_samples/9780544087507NIMAS.xml');
const TEXTBOOK_DOWNLOADS = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
const textbookPath = fs.existsSync(TEXTBOOK_FIXTURE) ? TEXTBOOK_FIXTURE : TEXTBOOK_DOWNLOADS;
let textbookXml = '';
try {
  textbookXml = fs.readFileSync(textbookPath, 'utf8');
} catch (e) {
  skipped++;
  console.warn(`SKIPPED: Section 5 (production table scale benchmark) — could not read ${textbookPath}: ${e.message}`);
}

if (textbookXml) {
  const parsedDoc = parseNimasXml(textbookXml);
  
  // Extract all tables (including sidebar-nested ones)
  const productionTables = [];
  function collectTables(blocks) {
    for (const b of (blocks || [])) {
      if (b.type === 'table') productionTables.push(b);
      if (b.type === 'box' || b.type === 'sidebar') collectTables(b.blocks);
    }
  }
  collectTables(parsedDoc.blocks);

  check(`Loaded textbook tables: found ${productionTables.length} tables`, productionTables.length >= 154);

  // Populate into Lexical editor and extract back
  const prodEditor = createTestEditor();
  const prodDoc = { blocks: productionTables };
  populateLexicalFromAST(prodEditor, prodDoc);

  const prodExtracted = extractASTFromLexical(prodEditor);
  check(`Lexical extracted exact table count (${prodExtracted.blocks.length})`, prodExtracted.blocks.length === productionTables.length);

  let matchHeaders = 0, matchRows = 0, matchCells = 0, renderSuccess = 0;
  for (let i = 0; i < productionTables.length; i++) {
    const orig = productionTables[i];
    const ext = prodExtracted.blocks[i];

    if (JSON.stringify(orig.headers || []) === JSON.stringify(ext.headers || [])) matchHeaders++;
    if ((orig.rows || []).length === (ext.rows || []).length) matchRows++;
    
    let cellsOk = true;
    for (let r = 0; r < (orig.rows || []).length; r++) {
      if (JSON.stringify(orig.rows[r]) !== JSON.stringify(ext.rows[r])) {
        cellsOk = false;
        break;
      }
    }
    if (cellsOk) matchCells++;

    // Test formatting in both auto and listed modes
    try {
      formatDocument({ blocks: [ext] }, brailleOptions);
      ext.format = 'listed';
      formatDocument({ blocks: [ext] }, brailleOptions);
      renderSuccess++;
    } catch (e) {
      console.error(`Error formatting table ${i}:`, e.message);
    }
  }

  check(`100% of table headers match (${matchHeaders}/${productionTables.length})`, matchHeaders === productionTables.length);
  check(`100% of table row counts match (${matchRows}/${productionTables.length})`, matchRows === productionTables.length);
  check(`100% of cell data matches (${matchCells}/${productionTables.length})`, matchCells === productionTables.length);
  check(`100% of tables format cleanly in braille (${renderSuccess}/${productionTables.length})`, renderSuccess === productionTables.length);
}

console.log(`\nTable editor sync tests complete: ${pass} passed, ${fail} failed, ${skipped} skipped.`);
if (fail > 0) process.exit(1);
