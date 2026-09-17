// Production Benchmark & Validation Suite for Collections Grade 7 Textbook
// Target file: tests/nimas_samples/9780544087507NIMAS.xml (committed fixture; ~/Downloads copy is a fallback only)

import fs from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDtbook, parseNimasXml } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { cellPlainText } from '../format/cell-markup.mjs';
import { formatDocument } from '../format/document.mjs';
import {
  createEditor, $getRoot, $createTextNode, registerList, registerRichText,
  ListNode, ListItemNode, ParagraphNode, TextNode, HeadingNode, QuoteNode,
  $createHeadingNode, $createParagraphNode, ElementNode, DecoratorNode, $createListNode,
  $createListItemNode, $applyNodeReplacement, $isHeadingNode, $isListNode
} from '../web/editor/vendor-lexical.mjs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Primary source is the committed fixture; the Downloads copy is only a fallback if it exists.
const PRIMARY_PATH = path.join(__dirname, 'nimas_samples/9780544087507NIMAS.xml');
const FALLBACK_PATH = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
const TARGET_PATH = fs.existsSync(PRIMARY_PATH) ? PRIMARY_PATH : FALLBACK_PATH;

console.log(`=============================================================`);
console.log(`  Running Production Scale Test on:`);
console.log(`  ${TARGET_PATH}`);
console.log(`=============================================================\n`);

if (!fs.existsSync(TARGET_PATH)) {
  console.error(`ERROR: Target file not found at ${TARGET_PATH}`);
  process.exit(1);
}

const rawXml = fs.readFileSync(TARGET_PATH, 'utf8');
console.log(`File size: ${(rawXml.length / 1024).toFixed(2)} KB (${rawXml.length} bytes)`);

let pass = 0, fail = 0;
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

// -------------------------------------------------------------
// Section 1: AST Parsing & Block Type Breakdown
// -------------------------------------------------------------
console.log('\n--- Section 1: AST Parsing & Inventory ---');
const t0 = performance.now();
const doc1 = parseDtbook(rawXml);
const parseTime = performance.now() - t0;
console.log(`Parsed in ${parseTime.toFixed(2)} ms`);

check('Parsed document successfully', !!doc1 && Array.isArray(doc1.blocks) && doc1.blocks.length > 0);
console.log(`Total top-level blocks: ${doc1.blocks.length}`);

// Block type breakdown
const counts = {};
for (const b of doc1.blocks) {
  counts[b.type] = (counts[b.type] || 0) + 1;
}
console.log('Block type distribution:');
for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  - ${type.padEnd(14)}: ${count}`);
}

const getWordCount = (doc) => {
  let count = 0;
  const countText = (str) => {
    if (!str) return;
    const words = cellPlainText(str).trim().split(/\s+/).filter(Boolean);
    count += words.length;
  };
  const walkBlock = (b) => {
    if (b.text) countText(b.text);
    if (b.title) countText(b.title);
    if (b.caption) countText(b.caption);
    if (b.alt) countText(b.alt);
    if (b.headers) b.headers.forEach(countText);
    if (b.rows) b.rows.forEach(r => (Array.isArray(r) ? r : [r]).forEach(countText));
    if (b.items) b.items.forEach(it => {
      if (typeof it === 'string') countText(it);
      else {
        if (it.text) countText(it.text);
        if (it.title) countText(it.title);
        if (it.term) countText(it.term);
        if (it.def) countText(it.def);
      }
    });
    if (b.blocks) b.blocks.forEach(walkBlock);
  };
  (doc.blocks || []).forEach(walkBlock);
  return count;
};

const words1 = getWordCount(doc1);
console.log(`Total word count in AST: ${words1.toLocaleString()} words`);
check('Document contains substantial text (> 50,000 words)', words1 > 50000, `Actual: ${words1}`);

// -------------------------------------------------------------
// Section 2: NIMAS XML Lossless Round-Trip (Parse -> Export -> Parse)
// -------------------------------------------------------------
console.log('\n--- Section 2: NIMAS XML Lossless Round-Trip ---');
const t1 = performance.now();
const exportedXml = exportToNimasXml(doc1);
const exportTime = performance.now() - t1;
console.log(`Exported NIMAS XML in ${exportTime.toFixed(2)} ms (${(exportedXml.length / 1024).toFixed(2)} KB)`);

const t2 = performance.now();
const doc2 = parseDtbook(exportedXml);
const parse2Time = performance.now() - t2;
console.log(`Re-parsed exported XML in ${parse2Time.toFixed(2)} ms`);

check('Re-parsed block count matches exactly', doc2.blocks.length === doc1.blocks.length, `Orig: ${doc1.blocks.length}, Reparsed: ${doc2.blocks.length}`);

const words2 = getWordCount(doc2);
const wordDiff = Math.abs(words1 - words2);
check('Word count round-trips with zero loss (Diff = 0)', wordDiff === 0, `Diff: ${wordDiff} (AST1: ${words1}, AST2: ${words2})`);

// Compare block type parity
let blockTypeMatches = 0;
for (let i = 0; i < doc1.blocks.length; i++) {
  if (doc1.blocks[i].type === doc2.blocks[i]?.type) blockTypeMatches++;
}
check('100% of block types match across round-trip', blockTypeMatches === doc1.blocks.length, `${blockTypeMatches}/${doc1.blocks.length}`);

// -------------------------------------------------------------
// Section 3: Tables in the Textbook
// -------------------------------------------------------------
console.log('\n--- Section 3: Table Analysis & Formatting ---');
const tables = doc1.blocks.filter(b => b.type === 'table');
console.log(`Found ${tables.length} tables in the document`);

let tablesFormatted = 0;
tables.forEach((tbl, idx) => {
  const colCount = Math.max(tbl.headers?.length || 0, ...(tbl.rows?.map(r => r.length) || [0]));
  const rowCount = tbl.rows?.length || 0;
  
  // Test both spatial and listed formatting on real textbook tables
  const spatialBrl = formatDocument({ blocks: [tbl] }, {
    translate: (s) => s.toUpperCase(),
    width: 38,
    depth: 25,
    mode: 'bana',
    standard: 'bana',
    tableFormat: 'columnar'
  });
  
  const listedBrl = formatDocument({ blocks: [tbl] }, {
    translate: (s) => s.toUpperCase(),
    width: 38,
    depth: 25,
    mode: 'bana',
    standard: 'bana',
    tableFormat: 'listed'
  });

  if (spatialBrl.length > 0 && listedBrl.length > 0) tablesFormatted++;
});

check('All tables formatted successfully in both Spatial and Listed modes', tablesFormatted === tables.length, `${tablesFormatted}/${tables.length}`);

// -------------------------------------------------------------
// Section 4: Sidebars in the Textbook
// -------------------------------------------------------------
console.log('\n--- Section 4: Sidebar & Container Verification ---');
const sidebars = doc1.blocks.filter(b => b.type === 'box');
console.log(`Found ${sidebars.length} sidebars/callout boxes in the document`);
// 423 top-level sidebars (429 minus 6 nested); one inside a list item was dropped before A2.
check('Sidebars identified accurately', sidebars.length === 423, `Found ${sidebars.length}`);

let sidebarsWithTitles = 0;
let totalSidebarChildren = 0;
for (const sb of sidebars) {
  if (sb.title) sidebarsWithTitles++;
  totalSidebarChildren += (sb.blocks?.length || 0);
}
console.log(`Sidebars with explicit titles: ${sidebarsWithTitles}/${sidebars.length}`);
console.log(`Total nested blocks inside sidebars: ${totalSidebarChildren}`);

// -------------------------------------------------------------
// Section 5: Lexical Editor Synchronous Model Conversion
// -------------------------------------------------------------
console.log('\n--- Section 5: Lexical Editor Conversion Benchmark ---');
// Setup Lexical Node stubs
class SidebarNode extends ElementNode {
  static getType() { return 'emboss-sidebar'; }
  static clone(n) { return new SidebarNode(n.__title, n.__key); }
  constructor(title = '', key) {
    super(key);
    this.__title = title || '';
    this.__banaStyle = 'sidebar';
  }
  createDOM() { return { nodeName: 'ASIDE', className: 'emboss-sidebar-card' }; }
  updateDOM() { return false; }
  getTitle() { return this.getLatest().__title || ''; }
  setTitle(t) { this.getWritable().__title = t || ''; return this; }
  getBanaStyle() { return 'sidebar'; }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-sidebar', title: this.__title }; }
}
const $createSidebarNode = (t) => $applyNodeReplacement ? $applyNodeReplacement(new SidebarNode(t)) : new SidebarNode(t);
const $isSidebarNode = (n) => n instanceof SidebarNode;

class TableNode extends DecoratorNode {
  static getType() { return 'emboss-table'; }
  static clone(n) { return new TableNode([...(n.__headers || [])], (n.__rows || []).map(r => [...r]), n.__key); }
  constructor(headers = [], rows = [], key) {
    super(key);
    this.__headers = Array.isArray(headers) ? headers : [];
    this.__rows = Array.isArray(rows) ? rows : [];
  }
  createDOM() { return { nodeName: 'DIV', className: 'doc-table-block' }; }
  updateDOM() { return false; }
  decorate() { return { type: 'table', headers: this.__headers, rows: this.__rows }; }
  getHeaders() { return this.getLatest().__headers; }
  getRows() { return this.getLatest().__rows; }
}
const $createTableNode = (h, r) => $applyNodeReplacement ? $applyNodeReplacement(new TableNode(h, r)) : new TableNode(h, r);
const $isTableNode = (n) => n instanceof TableNode;

class GraphicNode extends DecoratorNode {
  static getType() { return 'emboss-graphic'; }
  static clone(n) { return new GraphicNode(n.__svg, n.__alt, n.__title, n.__key); }
  constructor(svg = '', alt = '', title = '', key) {
    super(key);
    this.__svg = svg;
    this.__alt = alt;
    this.__title = title;
  }
  createDOM() { return { nodeName: 'DIV', className: 'doc-graphic-block' }; }
  updateDOM() { return false; }
  decorate() { return { type: 'graphic', svg: this.__svg, alt: this.__alt }; }
}
const $createGraphicNode = (s, a, t) => $applyNodeReplacement ? $applyNodeReplacement(new GraphicNode(s, a, t)) : new GraphicNode(s, a, t);

const editor = createEditor({
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, SidebarNode, TableNode, GraphicNode, ParagraphNode, TextNode],
  onError: (e) => { throw e; }
});
registerRichText(editor);
registerList(editor);

const tLex = performance.now();
editor.update(() => {
  const root = $getRoot();
  root.clear();
  for (const b of doc1.blocks) {
    if (b.type === 'heading' || b.type === 'title') {
      const h = $createHeadingNode('h' + Math.min(3, b.level || 1));
      if (b.text) h.append($createTextNode(b.text));
      root.append(h);
    } else if (b.type === 'box') {
      const sb = $createSidebarNode(b.title || '');
      if (Array.isArray(b.blocks)) {
        for (const cb of b.blocks) {
          if (cb.type === 'heading') {
            const h = $createHeadingNode('h' + Math.min(3, cb.level || 2));
            if (cb.text) h.append($createTextNode(cb.text));
            sb.append(h);
          } else if (cb.type === 'table') {
            sb.append($createTableNode(cb.headers || [], cb.rows || []));
          } else {
            const p = $createParagraphNode();
            if (cb.text) p.append($createTextNode(cb.text));
            if (p.getChildrenSize()) sb.append(p);
          }
        }
      }
      if (sb.getChildrenSize() === 0 && b.text) {
        const p = $createParagraphNode();
        p.append($createTextNode(b.text));
        sb.append(p);
      }
      root.append(sb);
    } else if (b.type === 'table') {
      root.append($createTableNode(b.headers || [], b.rows || []));
    } else if (b.type === 'list') {
      const ul = $createListNode(b.ordered ? 'number' : 'bullet');
      for (const it of (b.items || [])) {
        const li = $createListItemNode();
        const text = typeof it === 'string' ? it : (it.text || it.title || '');
        if (text) li.append($createTextNode(text));
        ul.append(li);
      }
      root.append(ul);
    } else {
      const p = $createParagraphNode();
      if (b.text) p.append($createTextNode(b.text));
      root.append(p);
    }
  }
});
const lexTime = performance.now() - tLex;
console.log(`Converted entire document to Lexical editor state in ${lexTime.toFixed(2)} ms`);

let lexicalChildrenCount = 0;
editor.read(() => {
  lexicalChildrenCount = $getRoot().getChildren().length;
});
check('Lexical editor root holds all top-level blocks', lexicalChildrenCount === doc1.blocks.length, `${lexicalChildrenCount}/${doc1.blocks.length}`);

// -------------------------------------------------------------
// Section 6: Full Document BANA Braille Formatting Benchmark
// -------------------------------------------------------------
// Section 6: Full Document BANA Braille Formatting Benchmark
// -------------------------------------------------------------
console.log('\n--- Section 6: Full Document BANA Braille Formatting ---');
const tBrl = performance.now();
const brailleDoc = formatDocument(doc1, {
  translate: (s) => s.toUpperCase(),
  width: 40,
  depth: 25,
  cells: 40,
  lines: 25,
  mode: 'bana',
  standard: 'bana'
});
const brlTime = performance.now() - tBrl;
console.log(`Formatted full ${words1.toLocaleString()}-word document to BANA Braille in ${brlTime.toFixed(2)} ms`);

const pages = brailleDoc.split('\x0c');
console.log(`Total Braille pages generated: ${pages.length}`);
check('Full document formats to Braille without errors', pages.length > 500, `Generated ${pages.length} pages`);
check('Top boxlines present across Braille output', brailleDoc.includes('7777777'), 'Boxlines formatted');
check('Bottom boxlines present across Braille output', brailleDoc.includes('GGGGGGG'), 'Bottom boxlines formatted');

// -------------------------------------------------------------
// Section 7: TOC Coordinate Tracing & Word Sync Verification
// -------------------------------------------------------------
console.log('\n--- Section 7: TOC Coordinate Tracing & Word Sync ---');
const tTrace = performance.now();
const traceObj = {};
const brailleDocTraced = formatDocument(doc1, {
  translate: (s) => s.toUpperCase(),
  translatePos: (s) => ({ text: s.toUpperCase(), map: Array.from({ length: s.length }, (_, i) => i) }),
  width: 40,
  depth: 25,
  cells: 40,
  lines: 25,
  mode: 'bana',
  standard: 'bana',
  trace: traceObj
});
const traceTime = performance.now() - tTrace;
console.log(`Traced full document coordinates in ${traceTime.toFixed(2)} ms`);

check('Trace result generated rows and rowCells', Array.isArray(traceObj.rows) && Array.isArray(traceObj.rowCells));

// Find TOC list block with "Big Things Come in Small Packages"
let tocBlockIdx = -1;
let tocBlock = null;
for (let i = 0; i < doc1.blocks.length; i++) {
  const b = doc1.blocks[i];
  if (b.type === 'list' && b.kind === 'toc' && Array.isArray(b.items)) {
    const hasTarget = b.items.some(it => (it.title || it.text || '').includes('Big Things Come in Small Packages'));
    if (hasTarget) {
      tocBlockIdx = i;
      tocBlock = b;
      break;
    }
  }
}

check('Found target TOC list block with "Big Things Come in Small Packages"', tocBlockIdx >= 0, `Block ${tocBlockIdx}`);

if (tocBlockIdx >= 0) {
  // Find all rows corresponding to this TOC block
  const tocRows = [];
  for (let r = 0; r < traceObj.rows.length; r++) {
    if (traceObj.rows[r] === tocBlockIdx) {
      tocRows.push({ rowIdx: r, cells: traceObj.rowCells[r] });
    }
  }
  
  check('TOC block generated braille rows with coordinates', tocRows.length > 0, `${tocRows.length} rows`);
  
  let validCellCount = 0;
  let hasNullRow = false;
  for (const row of tocRows) {
    if (!row.cells || !Array.isArray(row.cells)) {
      hasNullRow = true;
    } else {
      for (const c of row.cells) {
        if (c && typeof c.u === 'number' && typeof c.c === 'number') {
          validCellCount++;
        }
      }
    }
  }
  
  check('TOC coordinate array is intact (no null / corrupted srcs)', !hasNullRow);
  check('TOC braille cells have valid character-level trace coordinates', validCellCount > 100, `${validCellCount} cells linked`);
}

console.log(`\n=============================================================`);
console.log(`  Production Scale Test Results: ${pass} passed, ${fail} failed.`);
console.log(`=============================================================\n`);
process.exit(fail ? 1 : 0);

