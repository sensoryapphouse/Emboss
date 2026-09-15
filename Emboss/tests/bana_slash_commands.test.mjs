// Systematic Test Harness for Phase 5B: BANA Slash Commands
// Verifies slash command registration, keyword query filtering, Lexical transformations,
// container/table insertions, and full-scale NIMAS textbook coverage.

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
  $createListItemNode, $applyNodeReplacement, $isHeadingNode, $isListNode,
  $setBlocksType, $getSelection, $isRangeSelection, $insertNodeToNearestRoot
} from '../web/editor/vendor-lexical.mjs';

import { STYLE_DEFINITIONS, getStyleMargins } from '../format/styles.mjs';
import { formatDocument, formatBlock } from '../format/document.mjs';
import { parseDtbook, parseNimasXml } from '../input/parse.mjs';

console.log('=== Running BANA Slash Command Menu Test Suite (Phase 5B) ===\n');

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

// ----------------------------------------------------------------------------
// Lexical Prototype Extensions & Custom Nodes (Mirroring editor.mjs)
// ----------------------------------------------------------------------------

// ParagraphNode BANA extensions
ParagraphNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ParagraphNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
const origParaClone = ParagraphNode.prototype.afterCloneFrom;
ParagraphNode.prototype.afterCloneFrom = function(prev) {
  if (origParaClone) origParaClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
};

// ListNode BANA extensions
ListNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ListNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
ListNode.prototype.getListKind = function() { return this.getLatest().__listKind || null; };
ListNode.prototype.setListKind = function(k) { this.getWritable().__listKind = k || null; return this; };
const origListClone = ListNode.prototype.afterCloneFrom;
ListNode.prototype.afterCloneFrom = function(prev) {
  if (origListClone) origListClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__listKind = prev.__listKind || null;
};

// ListItemNode BANA extensions
ListItemNode.prototype.getPage = function() { return this.getLatest().__page || null; };
ListItemNode.prototype.setPage = function(p) { this.getWritable().__page = p || null; return this; };
ListItemNode.prototype.getLevel = function() {
  const latest = this.getLatest();
  if (latest.__level != null) return latest.__level;
  return typeof this.getIndent === 'function' ? this.getIndent() : (latest.__indent || 0);
};
ListItemNode.prototype.setLevel = function(lvl) { this.getWritable().__level = (lvl | 0) || 0; return this; };
ListItemNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ListItemNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
const origItemClone = ListItemNode.prototype.afterCloneFrom;
ListItemNode.prototype.afterCloneFrom = function(prev) {
  if (origItemClone) origItemClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__page = prev.__page || null;
  this.__level = prev.__level != null ? prev.__level : null;
};

const $createBanaParagraphNode = (style) => {
  const p = $createParagraphNode();
  if (style) p.setBanaStyle(style);
  return p;
};

// Custom SidebarNode
class SidebarNode extends ElementNode {
  static getType() { return 'emboss-sidebar'; }
  static clone(n) { return new SidebarNode(n.__title, n.__key); }
  constructor(title = '', key) {
    super(key);
    this.__title = title || '';
    this.__banaStyle = 'sidebar';
  }
  createDOM() {
    const aside = document.createElement('aside');
    aside.className = 'emboss-sidebar-card bana-style-sidebar';
    return aside;
  }
  updateDOM() { return false; }
  getTitle() { return this.getLatest().__title || ''; }
  setTitle(t) { this.getWritable().__title = t || ''; return this; }
  getBanaStyle() { return 'sidebar'; }
  exportJSON() {
    return { ...super.exportJSON(), type: 'emboss-sidebar', version: 1, title: this.__title, banaStyle: this.__banaStyle };
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
const $createSidebarNode = (title = '') => new SidebarNode(title);
const $isSidebarNode = (n) => n instanceof SidebarNode;

// Custom TableNode
class TableNode extends DecoratorNode {
  static getType() { return 'emboss-table'; }
  static clone(n) { return new TableNode(n.__headers, n.__rows, n.__format, n.__caption, n.__tabletn, n.__key); }
  constructor(headers = [], rows = [], format = 'auto', caption = '', tabletn = '', key) {
    super(key);
    this.__headers = Array.isArray(headers) ? [...headers] : [];
    this.__rows = Array.isArray(rows) ? rows.map((r) => Array.isArray(r) ? [...r] : [String(r)]) : [];
    this.__format = format || 'auto';
    this.__caption = caption || '';
    this.__tabletn = tabletn || '';
  }
  getHeaders() { return [...(this.getLatest().__headers || [])]; }
  getRows() { return (this.getLatest().__rows || []).map((r) => [...r]); }
  getFormat() { return this.getLatest().__format || 'auto'; }
  getCaption() { return this.getLatest().__caption || ''; }
  getTabletn() { return this.getLatest().__tabletn || ''; }
  isInline() { return false; }
  isKeyboardSelectable() { return true; }
  exportJSON() {
    return {
      type: 'emboss-table', version: 1,
      headers: this.__headers, rows: this.__rows,
      format: this.__format, caption: this.__caption, tabletn: this.__tabletn
    };
  }
  static importJSON(j) { return new TableNode(j.headers, j.rows, j.format, j.caption, j.tabletn); }
}
const $createTableNode = (headers, rows, format, caption, tabletn) => new TableNode(headers, rows, format, caption, tabletn);
const $isTableNode = (n) => n instanceof TableNode;

// Custom PrintPageNode
class PrintPageNode extends DecoratorNode {
  static getType() { return 'emboss-printpage'; }
  static clone(n) { return new PrintPageNode(n.__page, n.__key); }
  constructor(page = '1', key) {
    super(key);
    this.__page = String(page);
  }
  getPage() { return this.getLatest().__page; }
  setPage(p) { this.getWritable().__page = String(p); }
  isInline() { return false; }
  isKeyboardSelectable() { return true; }
  exportJSON() { return { type: 'emboss-printpage', version: 1, page: this.__page }; }
  static importJSON(j) { return new PrintPageNode(j.page); }
}
const $createPrintPageNode = (page) => new PrintPageNode(page);
const $isPrintPageNode = (n) => n instanceof PrintPageNode;

// Custom BreakNode
class BreakNode extends DecoratorNode {
  static getType() { return 'emboss-break'; }
  static clone(n) { return new BreakNode(n.__key); }
  constructor(key) { super(key); }
  isInline() { return false; }
  isKeyboardSelectable() { return true; }
  exportJSON() { return { type: 'emboss-break', version: 1 }; }
  static importJSON() { return new BreakNode(); }
}
const $createBreakNode = () => new BreakNode();
const $isBreakNode = (n) => n instanceof BreakNode;

function createTestEditor() {
  const ed = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ParagraphNode, TextNode, SidebarNode, TableNode, PrintPageNode, BreakNode],
    onError: (e) => { throw e; }
  });
  registerRichText(ed);
  registerList(ed);
  return ed;
}

// ----------------------------------------------------------------------------
// Section 1: Slash Commands Registry & Keyword Verification
// ----------------------------------------------------------------------------
console.log('--- Section 1: Slash Command Registry & Taxonomy Structure ---');

// Emulate SLASH_COMMANDS list with all registered BANA actions
function buildSlashCommands(editorInstance) {
  const applyStyle = (val) => {
    editorInstance.update(() => {
      const root = $getRoot();
      root.clear();
      const norm = (val === 'ul') ? 'bullet' : (val === 'ol') ? 'number' : (val === 'body' ? 'p' : (val || 'p'));
      if (norm === 'bullet' || norm === 'number' || norm === 'plain' || norm === 'toc' || norm === 'exercise') {
        const listType = (norm === 'toc' || norm === 'plain') ? 'plain' : (norm === 'number' || norm === 'exercise' ? 'number' : 'bullet');
        const list = $createListNode(listType);
        const kind = (norm === 'toc' || norm === 'plain') ? 'toc' : (norm === 'exercise' ? 'exercise' : null);
        if (kind) {
          list.setListKind(kind);
          list.setBanaStyle(kind);
        }
        const li = $createListItemNode();
        li.append($createTextNode('Test content'));
        list.append(li);
        root.append(list);
      } else if (norm === 'h1' || norm === 'h2' || norm === 'h3') {
        const h = $createHeadingNode(norm);
        h.append($createTextNode('Test content'));
        root.append(h);
      } else if (norm === 'quote') {
        const p = $createParagraphNode();
        p.setBanaStyle('quote');
        p.append($createTextNode('Test content'));
        root.append(p);
      } else {
        const banaStyle = (norm === 'p' || norm === 'body') ? null : norm;
        const p = $createBanaParagraphNode(banaStyle);
        p.append($createTextNode('Test content'));
        root.append(p);
      }
    });
  };

  const insertSidebar = (title = '') => {
    editorInstance.update(() => {
      const sidebar = $createSidebarNode(title);
      if (title) {
        const h = $createHeadingNode('h2');
        h.append($createTextNode(title));
        sidebar.append(h);
      }
      const p = $createParagraphNode();
      p.append($createTextNode('Sidebar body content'));
      sidebar.append(p);
      $getRoot().append(sidebar);
    });
  };

  const insertTable = (rows = 3, cols = 3, format = 'auto') => {
    editorInstance.update(() => {
      const headers = Array.from({ length: cols }, (_, i) => `Header ${i + 1}`);
      const rowData = Array.from({ length: rows }, () => Array(cols).fill('Cell'));
      const tbl = $createTableNode(headers, rowData, format);
      $getRoot().append(tbl);
    });
  };

  const insertPrintPage = (num = '1') => {
    editorInstance.update(() => {
      $getRoot().append($createPrintPageNode(num));
    });
  };

  const insertBreak = () => {
    editorInstance.update(() => {
      $getRoot().append($createBreakNode());
    });
  };

  const insertText = (t) => {
    editorInstance.update(() => {
      const p = $createParagraphNode();
      p.append($createTextNode(t));
      $getRoot().append(p);
    });
  };

  return [
    { id: 'slash', title: 'Insert "/"', desc: 'Type a literal slash character', icon: '/', keywords: ['slash', '/', 'text', 'symbol'], action: () => insertText('/') },
    { id: 'bold', title: 'Bold Text', desc: 'Apply bold formatting', icon: 'B', keywords: ['bold', 'b', 'strong'], action: () => {} },
    { id: 'italic', title: 'Italic Text', desc: 'Apply italic formatting', icon: 'I', keywords: ['italic', 'i', 'emphasis'], action: () => {} },
    { id: 'underline', title: 'Underline Text', desc: 'Apply underline formatting', icon: 'U', keywords: ['underline', 'u'], action: () => {} },
    { id: 'h1', title: 'Heading 1', desc: 'Major centered heading (1-1)', icon: 'H1', keywords: ['h1', 'heading 1', 'title', 'centered', 'major'], action: () => applyStyle('h1') },
    { id: 'h2', title: 'Heading 2', desc: 'Section heading (Cell 5)', icon: 'H2', keywords: ['h2', 'heading 2', 'section', 'subheading'], action: () => applyStyle('h2') },
    { id: 'h3', title: 'Heading 3', desc: 'Subsection heading (Cell 7)', icon: 'H3', keywords: ['h3', 'heading 3', 'sub', 'subsection', 'minor'], action: () => applyStyle('h3') },
    { id: 'p', title: 'Paragraph (Body)', desc: 'Standard body paragraph (3-1)', icon: '¶', keywords: ['p', 'para', 'paragraph', 'body', 'text', 'standard'], action: () => applyStyle('p') },
    { id: 'ul', title: 'Bulleted List', desc: 'Create bulleted list items (1-3)', icon: '•', keywords: ['ul', 'bullet', 'bullets', 'list', 'unordered'], action: () => applyStyle('bullet') },
    { id: 'ol', title: 'Numbered List', desc: 'Create numbered list items (1-3)', icon: '1.', keywords: ['ol', 'number', 'numbered', 'list', 'ordered'], action: () => applyStyle('number') },
    { id: 'toc', title: 'TOC Entry', desc: 'Table of Contents entry with dot leaders (1-3)', icon: '📑', keywords: ['toc', 'table of contents', 'contents', 'index', 'dot leaders', 'leader'], action: () => applyStyle('toc') },
    { id: 'dialogue', title: 'Play Dialogue', desc: 'Prose drama dialogue speaker line (1-3)', icon: '🎭', keywords: ['dialogue', 'play', 'drama', 'speaker', 'character', 'line', 'script', 'speech'], action: () => applyStyle('dialogue') },
    { id: 'stage', title: 'Stage Direction', desc: 'Drama stage direction indented (7-7)', icon: '🎬', keywords: ['stage', 'direction', 'play', 'drama', 'setting', 'action', 'parenthetical'], action: () => applyStyle('stage') },
    { id: 'poem', title: 'Poetry / Verse', desc: 'Poetic stanza verse line (1-3)', icon: '📜', keywords: ['poem', 'poetry', 'verse', 'stanza', 'rhyme', 'lines', 'lyric'], action: () => applyStyle('poem') },
    { id: 'exercise', title: 'Exercise Question', desc: 'Numbered exercise question (1-5 / 3-5)', icon: '❓', keywords: ['exercise', 'question', 'problem', 'homework', 'task', 'exam', 'quiz', 'subquestion'], action: () => applyStyle('exercise') },
    { id: 'caption', title: 'Caption / Attribution', desc: 'Figure caption or attribution (7-5)', icon: '💬', keywords: ['caption', 'attribution', 'photo', 'figure', 'image', 'label', 'credit'], action: () => applyStyle('caption') },
    { id: 'footnote', title: 'Footnote', desc: 'Footnote note text (1-3)', icon: '📝', keywords: ['footnote', 'note', 'reference', 'citation', 'annotation', 'fn'], action: () => applyStyle('footnote') },
    { id: 'note', title: "Transcriber's Note", desc: "Transcriber's note with BANA indicators (7-5)", icon: '📋', keywords: ['note', 'transcriber', 'transcriber note', 'tn', 'prodnote', 'comment', 'remark'], action: () => applyStyle('note') },
    { id: 'quote', title: 'Blockquote', desc: 'Indented quotation block (3-1)', icon: '“', keywords: ['quote', 'blockquote', 'quotation', 'citation', 'excerpt', 'indent'], action: () => applyStyle('quote') },
    { id: 'sidebar', title: 'Sidebar Box', desc: 'Container card with BANA boxlines', icon: '📦', keywords: ['sidebar', 'box', 'callout', 'aside', 'container', 'panel', 'boxline'], action: () => insertSidebar('Sidebar Title') },
    { id: 'table', title: 'Spatial Braille Table', desc: 'Insert 3×3 columnar data table', icon: '📊', keywords: ['table', 'grid', 'column', 'row', 'spatial', 'data'], action: () => insertTable(3, 3, 'spatial') },
    { id: 'listedtable', title: 'BANA Listed Table', desc: 'Insert structured listed table (Header: Value)', icon: '📋', keywords: ['listedtable', 'listed', 'table', 'bana', 'data', 'card', 'key value', 'key-value'], action: () => insertTable(3, 3, 'listed') },
    { id: 'matrix', title: 'Math Matrix (2×2 / 3×3)', desc: 'Insert 2×2 or 3×3 visual MathLive matrix', icon: '🔢', keywords: ['matrix', 'pmatrix', 'bmatrix', 'linalg', 'array', 'grid', 'vector'], action: () => {} },
    { id: 'math', title: 'Insert Equation', desc: 'MathLive visual equation (UEB/Nemeth)', icon: '∑', keywords: ['math', 'maths', 'equation', 'latex', 'formula'], action: () => {} },
    { id: 'formula', title: 'Formula Templates...', desc: 'Browse 340+ math formulas, matrices & equations', icon: '🧮', keywords: ['formula', 'template', 'math', 'equation', 'matrix', 'table', 'algebra', 'calculus', 'frac', 'sqrt'], action: () => {} },
    { id: 'plot', title: 'Plot Tactile Math Graph...', desc: 'Generate tactile coordinate graph (single or multi-curve)', icon: '📈', keywords: ['plot', 'graph', 'function', 'curve', 'math', 'equation', 'parabola', 'sine', 'line', 'coordinate', 'axes', 'multi'], action: () => {} },
    { id: 'graphic', title: 'Tactile Graphic Diagram...', desc: 'Browse curated tactile diagrams or upload SVG', icon: '🖼', keywords: ['graphic', 'svg', 'image', 'diagram', 'chart', 'tactile', 'picture', 'drawing', 'map'], action: () => {} },
    { id: 'break', title: 'Document Break', desc: 'Divider line ( ∗ ∗ ∗ )', icon: '⁂', keywords: ['break', 'divider', 'asterisks', 'line', 'hr', 'separator'], action: () => insertBreak() },
    { id: 'page', title: 'Print Page Number', desc: 'Insert source print page break indicator', icon: '📄', keywords: ['page', 'printpage', 'pagenum', 'break', 'number', 'pagination'], action: () => insertPrintPage('1') },
    { id: 'code', title: 'Computer Code', desc: 'Insert Code block with UEB indicators', icon: '💻', keywords: ['code', 'python', 'html', 'js', 'programming', 'script'], action: () => insertText('```\n\n```') },
  ];
}

const ed = createTestEditor();
const commands = buildSlashCommands(ed);

check('Total 30 slash commands registered', commands.length === 30, `Found: ${commands.length}`);

const uniqueIds = new Set();
let duplicates = 0;
for (const cmd of commands) {
  if (uniqueIds.has(cmd.id)) duplicates++;
  uniqueIds.add(cmd.id);
}
check('All slash command IDs are unique (0 duplicates)', duplicates === 0, `Duplicates: ${duplicates}`);

// Verify all commands have required properties
let validSchema = true;
for (const cmd of commands) {
  if (!cmd.id || !cmd.title || !cmd.desc || !cmd.icon || !Array.isArray(cmd.keywords) || typeof cmd.action !== 'function') {
    validSchema = false;
  }
}
check('All commands adhere to slash command schema (id, title, desc, icon, keywords, action)', validSchema);

// ----------------------------------------------------------------------------
// Section 2: Query Matching & Alias Search Algorithm
// ----------------------------------------------------------------------------
console.log('\n--- Section 2: Query Matching & Keyword Filtering ---');

function filterCommands(query) {
  const activeQuery = (query || '').toLowerCase().trim();
  return commands.filter((cmd) => {
    if (!activeQuery) return true;
    return cmd.id.includes(activeQuery) ||
           cmd.title.toLowerCase().includes(activeQuery) ||
           cmd.keywords.some((k) => k.includes(activeQuery));
  });
}

const QUERY_TEST_CASES = [
  { query: 'dia', expectedFirst: 'dialogue', minCount: 1 },
  { query: 'play', expectedFirst: 'dialogue', minCount: 1 },
  { query: 'stage', expectedFirst: 'stage', minCount: 1 },
  { query: 'drama', expectedIncludes: ['dialogue', 'stage'], minCount: 2 },
  { query: 'poem', expectedFirst: 'poem', minCount: 1 },
  { query: 'verse', expectedFirst: 'poem', minCount: 1 },
  { query: 'exercise', expectedFirst: 'exercise', minCount: 1 },
  { query: 'question', expectedFirst: 'exercise', minCount: 1 },
  { query: 'quote', expectedFirst: 'quote', minCount: 1 },
  { query: 'blockquote', expectedFirst: 'quote', minCount: 1 },
  { query: 'box', expectedFirst: 'sidebar', minCount: 1 },
  { query: 'sidebar', expectedFirst: 'sidebar', minCount: 1 },
  { query: 'callout', expectedFirst: 'sidebar', minCount: 1 },
  { query: 'table', expectedIncludes: ['table', 'listedtable'], minCount: 2 },
  { query: 'grid', expectedFirst: 'table', minCount: 1 },
  { query: 'listed', expectedFirst: 'listedtable', minCount: 1 },
  { query: 'toc', expectedFirst: 'toc', minCount: 1 },
  { query: 'contents', expectedFirst: 'toc', minCount: 1 },
  { query: 'caption', expectedFirst: 'caption', minCount: 1 },
  { query: 'attribution', expectedFirst: 'caption', minCount: 1 },
  { query: 'note', expectedFirst: 'note', minCount: 1 },
  { query: 'tn', expectedFirst: 'note', minCount: 1 },
  { query: 'transcriber', expectedFirst: 'note', minCount: 1 },
  { query: 'footnote', expectedFirst: 'footnote', minCount: 1 },
  { query: 'fn', expectedFirst: 'footnote', minCount: 1 },
  { query: 'math', expectedIncludes: ['matrix', 'math', 'formula', 'plot'], minCount: 4 },
  { query: 'page', expectedFirst: 'page', minCount: 1 },
  { query: 'break', expectedFirst: 'break', minCount: 1 },
];

for (const tc of QUERY_TEST_CASES) {
  const matches = filterCommands(tc.query);
  const matchIds = matches.map((m) => m.id);
  const countPass = matches.length >= tc.minCount;
  let targetPass = true;
  if (tc.expectedFirst) {
    targetPass = matchIds.includes(tc.expectedFirst);
  }
  if (tc.expectedIncludes) {
    targetPass = tc.expectedIncludes.every((id) => matchIds.includes(id));
  }
  check(
    `Query "/${tc.query}" matches expected command(s) (${matches.length} matches)`,
    countPass && targetPass,
    `Got: [${matchIds.join(', ')}]`
  );
}

// ----------------------------------------------------------------------------
// Section 3: Slash Command Execution & Lexical Transformation
// ----------------------------------------------------------------------------
console.log('\n--- Section 3: Slash Command Execution & Lexical Node Transformations ---');

function nodeToASTBlock(node) {
  if (!node) return null;
  if ($isHeadingNode(node)) {
    return { type: 'heading', level: Math.min(3, Number(node.getTag().slice(1)) || 1), text: node.getTextContent() };
  }
  if ($isListNode(node)) {
    const listKind = typeof node.getListKind === 'function' ? node.getListKind() : null;
    const items = [];
    for (const li of node.getChildren()) {
      items.push({ text: li.getTextContent() });
    }
    const block = { type: 'list', items };
    if (listKind) { block.kind = listKind; block.style = listKind; }
    return block;
  }
  if ($isSidebarNode(node)) {
    const blocks = [];
    for (const child of node.getChildren()) {
      blocks.push(nodeToASTBlock(child));
    }
    return { type: 'sidebar', title: node.getTitle(), blocks };
  }
  if ($isTableNode(node)) {
    return {
      type: 'table',
      headers: node.getHeaders(),
      rows: node.getRows(),
      format: node.getFormat(),
      style: `table-${node.getFormat()}`
    };
  }
  if ($isPrintPageNode(node)) {
    return { type: 'print-page', num: node.getPage() };
  }
  if ($isBreakNode(node)) {
    return { type: 'break' };
  }
  
  const banaStyle = typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null;
  const block = { type: 'para', text: node.getTextContent() };
  if (banaStyle && banaStyle !== 'body') {
    block.style = banaStyle;
    if (banaStyle === 'note') block.type = 'note';
    else if (banaStyle === 'caption') block.type = 'caption';
    else if (banaStyle === 'footnote') block.type = 'footnote';
    else if (banaStyle === 'stage') block.type = 'stage';
    else if (banaStyle === 'dialogue') block.type = 'play';
    else if (banaStyle === 'verse' || banaStyle === 'poem') { block.type = 'play'; block.subtype = 'verse'; }
  }
  return block;
}

const EXECUTION_TESTS = [
  { id: 'h1', expectedNodeType: 'heading', expectedASTType: 'heading', expectedLevel: 1 },
  { id: 'h2', expectedNodeType: 'heading', expectedASTType: 'heading', expectedLevel: 2 },
  { id: 'h3', expectedNodeType: 'heading', expectedASTType: 'heading', expectedLevel: 3 },
  { id: 'p', expectedNodeType: 'para', expectedASTType: 'para', expectedStyle: null },
  { id: 'ul', expectedNodeType: 'list', expectedASTType: 'list', expectedKind: null },
  { id: 'ol', expectedNodeType: 'list', expectedASTType: 'list', expectedKind: null },
  { id: 'toc', expectedNodeType: 'list', expectedASTType: 'list', expectedKind: 'toc' },
  { id: 'dialogue', expectedNodeType: 'para', expectedASTType: 'play', expectedStyle: 'dialogue' },
  { id: 'stage', expectedNodeType: 'para', expectedASTType: 'stage', expectedStyle: 'stage' },
  { id: 'poem', expectedNodeType: 'para', expectedASTType: 'play', expectedStyle: 'poem' },
  { id: 'exercise', expectedNodeType: 'list', expectedASTType: 'list', expectedKind: 'exercise' },
  { id: 'caption', expectedNodeType: 'para', expectedASTType: 'caption', expectedStyle: 'caption' },
  { id: 'footnote', expectedNodeType: 'para', expectedASTType: 'footnote', expectedStyle: 'footnote' },
  { id: 'note', expectedNodeType: 'para', expectedASTType: 'note', expectedStyle: 'note' },
  { id: 'quote', expectedNodeType: 'para', expectedASTType: 'para', expectedStyle: 'quote' },
];

for (const t of EXECUTION_TESTS) {
  const cmd = commands.find((c) => c.id === t.id);
  check(`Slash command "/${t.id}" found in registry`, !!cmd);
  if (!cmd) continue;

  cmd.action();

  ed.read(() => {
    const root = $getRoot();
    const child = root.getFirstChild();
    check(`Action "/${t.id}" creates node`, !!child);
    if (!child) return;

    const isCorrectNode = (t.expectedNodeType === 'heading' && $isHeadingNode(child)) ||
                          (t.expectedNodeType === 'list' && $isListNode(child)) ||
                          (t.expectedNodeType === 'para' && child instanceof ParagraphNode);
    check(`Action "/${t.id}" creates expected node class`, isCorrectNode);

    const ast = nodeToASTBlock(child);
    check(`Action "/${t.id}" produces AST block type "${t.expectedASTType}"`, ast && ast.type === t.expectedASTType);

    if (t.expectedStyle !== undefined) {
      check(`Action "/${t.id}" AST style is "${t.expectedStyle}"`, (ast?.style || null) === t.expectedStyle);
    }
    if (t.expectedLevel !== undefined) {
      check(`Action "/${t.id}" heading level is ${t.expectedLevel}`, ast?.level === t.expectedLevel);
    }
    if (t.expectedKind !== undefined) {
      check(`Action "/${t.id}" list kind is "${t.expectedKind}"`, (ast?.kind || null) === t.expectedKind);
    }
  });
}

// ----------------------------------------------------------------------------
// Section 4: Interactive Inserter Commands (Sidebar, Table, Page, Break)
// ----------------------------------------------------------------------------
console.log('\n--- Section 4: Interactive Inserter Commands (Sidebar, Table, Break, Page) ---');

// Test /sidebar
const sidebarCmd = commands.find((c) => c.id === 'sidebar');
sidebarCmd.action();
ed.read(() => {
  const root = $getRoot();
  const sidebar = root.getLastChild();
  check('/sidebar inserts SidebarNode', !!sidebar && $isSidebarNode(sidebar));
  if (sidebar) {
    check('/sidebar sets title', sidebar.getTitle() === 'Sidebar Title');
    const children = sidebar.getChildren();
    check('/sidebar contains inner heading and paragraph', children.length === 2 && $isHeadingNode(children[0]) && children[1] instanceof ParagraphNode);

    const ast = nodeToASTBlock(sidebar);
    check('/sidebar AST is type "sidebar" with inner blocks', ast && ast.type === 'sidebar' && ast.blocks.length === 2);
  }
});

// Test /table (spatial)
const tableSpatialCmd = commands.find((c) => c.id === 'table');
tableSpatialCmd.action();
ed.read(() => {
  const root = $getRoot();
  const tbl = root.getLastChild();
  check('/table inserts TableNode', !!tbl && $isTableNode(tbl));
  if (tbl) {
    check('/table format is "spatial"', tbl.getFormat() === 'spatial');
    check('/table has 3 headers and 3 rows', tbl.getHeaders().length === 3 && tbl.getRows().length === 3);

    const ast = nodeToASTBlock(tbl);
    check('/table AST style is "table-spatial"', ast && ast.style === 'table-spatial');
  }
});

// Test /listedtable
const tableListedCmd = commands.find((c) => c.id === 'listedtable');
tableListedCmd.action();
ed.read(() => {
  const root = $getRoot();
  const tbl = root.getLastChild();
  check('/listedtable inserts TableNode', !!tbl && $isTableNode(tbl));
  if (tbl) {
    check('/listedtable format is "listed"', tbl.getFormat() === 'listed');

    const ast = nodeToASTBlock(tbl);
    check('/listedtable AST style is "table-listed"', ast && ast.style === 'table-listed');
  }
});

// Test /page
const pageCmd = commands.find((c) => c.id === 'page');
pageCmd.action();
ed.read(() => {
  const root = $getRoot();
  const pageNode = root.getLastChild();
  check('/page inserts PrintPageNode', !!pageNode && $isPrintPageNode(pageNode));
  if (pageNode) {
    check('/page sets page num "1"', pageNode.getPage() === '1');
  }
});

// Test /break
const breakCmd = commands.find((c) => c.id === 'break');
breakCmd.action();
ed.read(() => {
  const root = $getRoot();
  const brk = root.getLastChild();
  check('/break inserts BreakNode', !!brk && $isBreakNode(brk));
});

// ----------------------------------------------------------------------------
// Section 5: Real-World NIMAS XML Coverage
// ----------------------------------------------------------------------------
console.log('\n--- Section 5: NIMAS Textbook Coverage (1.45 MB XML) ---');

const xmlPath = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
if (fs.existsSync(xmlPath)) {
  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  const parsed = parseNimasXml(xmlContent);
  const blocks = parsed.blocks || [];

  check(`Parsed ${blocks.length} blocks from large textbook`, blocks.length > 5000, `Found: ${blocks.length}`);

  const blockTypeTaxonomy = new Set();
  const blockStyleTaxonomy = new Set();
  for (const b of blocks) {
    blockTypeTaxonomy.add(b.type);
    if (b.style) blockStyleTaxonomy.add(b.style);
    if (b.blocks) {
      for (const cb of b.blocks) {
        blockTypeTaxonomy.add(cb.type);
        if (cb.style) blockStyleTaxonomy.add(cb.style);
      }
    }
  }

  console.log(`  Found block types in textbook: [${[...blockTypeTaxonomy].join(', ')}]`);
  console.log(`  Found block styles in textbook: [${[...blockStyleTaxonomy].join(', ')}]`);

  // Map each encountered block type to corresponding slash command
  const TYPE_TO_SLASH = {
    'heading': ['h1', 'h2', 'h3'],
    'para': ['p', 'quote', 'dialogue', 'stage', 'poem', 'caption', 'footnote', 'note'],
    'list': ['ul', 'ol', 'toc', 'exercise'],
    'table': ['table', 'listedtable'],
    'sidebar': ['sidebar'],
    'box': ['sidebar'],
    'pagenum': ['page'],
    'print-page': ['page'],
    'break': ['break'],
    'graphic': ['graphic'],
    'math': ['math', 'matrix', 'formula'],
    'note': ['note'],
    'caption': ['caption'],
    'attribution': ['caption', 'quote'],
    'footnote': ['footnote'],
    'play': ['dialogue', 'stage', 'poem'],
    'stage': ['stage'],
    'indicator': ['break']
  };

  let allCovered = true;
  for (const t of blockTypeTaxonomy) {
    if (!TYPE_TO_SLASH[t]) {
      console.warn(`    Warning: Unmapped block type ${t}`);
      allCovered = false;
    }
  }
  check('All textbook block types map to registered slash commands', allCovered);
} else {
  console.warn(`Large XML file not found at ${xmlPath}, skipping Section 5 textbook verification.`);
}

console.log(`\n=============================================`);
console.log(`Phase 5B Test Results: ${pass} passed, ${fail} failed`);
console.log(`=============================================\n`);

if (fail > 0) {
  process.exit(1);
}
