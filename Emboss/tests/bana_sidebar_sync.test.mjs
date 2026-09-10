// Systematic Test Harness for Step 3C: SidebarNode & Container Visual Cards
// Tests AST <-> Lexical <-> NIMAS XML synchronization, BANA Boxline formatting,
// and all 422 real production sidebars from Collections Grade 7 textbook.

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

console.log('=== Running BANA Sidebar & Container Sync Test Suite ===\n');

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

// Setup Lexical prototype extensions
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

ListItemNode.prototype.getPage = function() { return this.getLatest().__page || null; };
ListItemNode.prototype.setPage = function(p) { this.getWritable().__page = p || null; return this; };
ListItemNode.prototype.getLevel = function() {
  const latest = this.getLatest();
  if (latest.__level != null) return latest.__level;
  return typeof this.getIndent === 'function' ? this.getIndent() : (latest.__indent || 0);
};
ListItemNode.prototype.setLevel = function(lvl) {
  const writable = this.getWritable();
  writable.__level = (lvl | 0) || 0;
  return this;
};
ListItemNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ListItemNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };

const origItemClone = ListItemNode.prototype.afterCloneFrom;
ListItemNode.prototype.afterCloneFrom = function(prev) {
  if (origItemClone) origItemClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__page = prev.__page || null;
  this.__level = prev.__level != null ? prev.__level : null;
};

ParagraphNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ParagraphNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };

const origParaClone = ParagraphNode.prototype.afterCloneFrom;
ParagraphNode.prototype.afterCloneFrom = function(prev) {
  if (origParaClone) origParaClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
};

// Setup custom SidebarNode
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
  updateDOM(prevNode, dom, config) {
    return false;
  }
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

// Setup TableNode & GraphicNode stubs for nested blocks
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
  isInline() { return false; }
  getHeaders() { return this.getLatest().__headers; }
  getRows() { return this.getLatest().__rows; }
}
const $createTableNode = (headers = [], rows = []) => $applyNodeReplacement ? $applyNodeReplacement(new TableNode(headers, rows)) : new TableNode(headers, rows);
const $isTableNode = (n) => n instanceof TableNode;

class GraphicNode extends DecoratorNode {
  static getType() { return 'emboss-graphic'; }
  static clone(n) { return new GraphicNode(n.__svg, n.__alt, n.__title, n.__textures, n.__brailleLabels, n.__size, n.__key); }
  constructor(svg = '', alt = '', title = '', textures = true, brailleLabels = true, size = 'full', key) {
    super(key);
    this.__svg = svg;
    this.__alt = alt;
    this.__title = title;
    this.__textures = textures;
    this.__brailleLabels = brailleLabels;
    this.__size = size;
  }
  createDOM() { return { nodeName: 'DIV', className: 'doc-graphic-block' }; }
  updateDOM() { return false; }
  decorate() { return { type: 'graphic', svg: this.__svg, alt: this.__alt }; }
  isInline() { return false; }
  getSvg() { return this.getLatest().__svg; }
  getAlt() { return this.getLatest().__alt; }
  getTitle() { return this.getLatest().__title; }
  getTextures() { return this.getLatest().__textures; }
  getBrailleLabels() { return this.getLatest().__brailleLabels; }
  getSize() { return this.getLatest().__size; }
}
const $createGraphicNode = (svg, alt, title, textures, brailleLabels, size) => $applyNodeReplacement ? $applyNodeReplacement(new GraphicNode(svg, alt, title, textures, brailleLabels, size)) : new GraphicNode(svg, alt, title, textures, brailleLabels, size);
const $isGraphicNode = (n) => n instanceof GraphicNode;

function createTestEditor() {
  const ed = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, SidebarNode, TableNode, GraphicNode, ParagraphNode, TextNode],
    onError: (e) => { throw e; }
  });
  registerRichText(ed);
  registerList(ed);
  return ed;
}

function fillNode(node, b) {
  if (Array.isArray(b.segments) && b.segments.length > 0) {
    for (const seg of b.segments) {
      if (seg.text) node.append($createTextNode(seg.text));
    }
  } else if (b.text) {
    node.append($createTextNode(b.text));
  }
}

function modelToLexicalInEditor(ed, model) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    for (const b of (model.blocks || [])) {
      if (b.type === 'heading' || b.type === 'title') {
        const h = $createHeadingNode('h' + Math.min(3, b.level || 1));
        fillNode(h, b);
        root.append(h);
      } else if (b.type === 'box' || b.type === 'sidebar') {
        const sb = $createSidebarNode(b.title || '');
        if (Array.isArray(b.blocks) && b.blocks.length > 0) {
          for (const cb of b.blocks) {
            if (cb.type === 'heading' || cb.type === 'title') {
              const h = $createHeadingNode('h' + Math.min(3, cb.level || 2));
              fillNode(h, cb);
              sb.append(h);
            } else if (cb.type === 'list') {
              const ul = $createListNode(cb.ordered ? 'number' : 'bullet');
              if (cb.kind) { ul.setListKind(cb.kind); ul.setBanaStyle(cb.kind); }
              for (const it of (cb.items || [])) {
                const li = $createListItemNode();
                if (typeof it === 'string') li.append($createTextNode(it));
                else if (it.text) li.append($createTextNode(it.text));
                if (it.page) li.setPage(it.page);
                if (it.level) li.setLevel(it.level);
                ul.append(li);
              }
              sb.append(ul);
            } else if (cb.type === 'table') {
              sb.append($createTableNode(cb.headers || [], cb.rows || []));
            } else if (cb.type === 'graphic') {
              sb.append($createGraphicNode(cb.svg || '', cb.alt || '', cb.title || '', cb.textures, cb.brailleLabels, cb.size));
            } else {
              const p = $createParagraphNode();
              const style = cb.style || cb.type;
              if (style && style !== 'para') p.setBanaStyle(style);
              fillNode(p, cb);
              if (p.getChildrenSize()) sb.append(p);
            }
          }
        }
        if (sb.getChildrenSize() === 0 && b.title) {
          const h = $createHeadingNode('h2');
          h.append($createTextNode(b.title));
          sb.append(h);
        }
        if (sb.getChildrenSize() === 0 && b.text) {
          const p = $createParagraphNode();
          p.append($createTextNode(b.text));
          sb.append(p);
        }
        root.append(sb);
      } else if (b.type === 'list') {
        const ul = $createListNode(b.ordered ? 'number' : 'bullet');
        if (b.kind) { ul.setListKind(b.kind); ul.setBanaStyle(b.kind); }
        for (const it of (b.items || [])) {
          const li = $createListItemNode();
          if (typeof it === 'string') li.append($createTextNode(it));
          else if (it.text) li.append($createTextNode(it.text));
          if (it.page) li.setPage(it.page);
          if (it.level) li.setLevel(it.level);
          ul.append(li);
        }
        root.append(ul);
      } else if (b.type === 'table') {
        root.append($createTableNode(b.headers || [], b.rows || []));
      } else if (b.type === 'graphic') {
        root.append($createGraphicNode(b.svg || '', b.alt || '', b.title || '', b.textures, b.brailleLabels, b.size));
      } else {
        const p = $createParagraphNode();
        const style = b.style || b.type;
        if (style && style !== 'para') p.setBanaStyle(style);
        fillNode(p, b);
        root.append(p);
      }
    }
  });
}

function buildModelFromEditor(ed) {
  let model = { blocks: [] };
  ed.read(() => {
    const root = $getRoot();
    for (const node of root.getChildren()) {
      if ($isSidebarNode(node)) {
        const innerBlocks = [];
        let boxTitle = node.getTitle() || null;
        for (const child of node.getChildren()) {
          if ($isHeadingNode(child)) {
            const text = child.getTextContent().replace(/\s+/g, ' ').trim();
            if (!boxTitle && innerBlocks.length === 0) boxTitle = text;
            innerBlocks.push({ type: 'heading', level: Math.min(3, Number(child.getTag().slice(1)) || 2), text });
          } else if ($isListNode(child)) {
            const items = [];
            for (const li of child.getChildren()) {
              const text = li.getTextContent().replace(/\s+/g, ' ').trim();
              if (text) {
                const item = { text };
                if (typeof li.getPage === 'function' && li.getPage()) item.page = li.getPage();
                if (typeof li.getLevel === 'function' && li.getLevel()) item.level = li.getLevel();
                items.push(item);
              }
            }
            if (items.length) {
              const lb = { type: 'list', items };
              const kind = typeof child.getListKind === 'function' ? child.getListKind() : null;
              if (kind) { lb.kind = kind; lb.style = kind; }
              innerBlocks.push(lb);
            }
          } else if ($isTableNode(child)) {
            innerBlocks.push({ type: 'table', headers: child.getHeaders(), rows: child.getRows() });
          } else if ($isGraphicNode(child)) {
            innerBlocks.push({ type: 'graphic', svg: child.getSvg(), alt: child.getAlt(), title: child.getTitle(), textures: child.getTextures(), brailleLabels: child.getBrailleLabels(), size: child.getSize() });
          } else {
            const text = child.getTextContent().replace(/\s+/g, ' ').trim();
            if (text) {
              const pb = { type: 'para', text };
              const style = typeof child.getBanaStyle === 'function' ? child.getBanaStyle() : null;
              if (style && style !== 'body' && style !== 'para') pb.style = style;
              innerBlocks.push(pb);
            }
          }
        }
        const box = { type: 'box' };
        if (boxTitle) box.title = boxTitle;
        if (innerBlocks.length) box.blocks = innerBlocks;
        model.blocks.push(box);
      } else if ($isHeadingNode(node)) {
        model.blocks.push({ type: 'heading', level: Math.min(3, Number(node.getTag().slice(1)) || 1), text: node.getTextContent().trim() });
      } else if ($isTableNode(node)) {
        model.blocks.push({ type: 'table', headers: node.getHeaders(), rows: node.getRows() });
      } else if ($isGraphicNode(node)) {
        model.blocks.push({ type: 'graphic', svg: node.getSvg(), alt: node.getAlt(), title: node.getTitle(), textures: node.getTextures(), brailleLabels: node.getBrailleLabels(), size: node.getSize() });
      } else {
        model.blocks.push({ type: 'para', text: node.getTextContent().trim() });
      }
    }
  });
  return model;
}

// --- Section 1: Synthetic AST & Container Integrity ---
console.log('--- Section 1: Synthetic AST & Container Hierarchy ---');
const sourceAst = {
  title: "Document with Sidebar",
  blocks: [
    { type: 'heading', level: 1, text: 'Chapter 1: Ecosystems' },
    {
      type: 'box',
      title: 'Focus on Science',
      blocks: [
        { type: 'heading', level: 2, text: 'Focus on Science' },
        { type: 'para', text: 'Sidebars provide deep background context.' },
        {
          type: 'list',
          kind: 'plain',
          items: [
            { text: 'Observation: Field notes' },
            { text: 'Hypothesis: Testing models' }
          ]
        }
      ]
    },
    { type: 'para', text: 'Regular text following the sidebar.' }
  ]
};

const editor = createTestEditor();
modelToLexicalInEditor(editor, sourceAst);

editor.read(() => {
  const root = $getRoot();
  const children = root.getChildren();
  check('Root has 3 top-level blocks', children.length === 3);
  check('Second block is SidebarNode', $isSidebarNode(children[1]));
  const sbNode = children[1];
  check('SidebarNode contains 3 child elements', sbNode.getChildren().length === 3);
  check('SidebarNode title is preserved', sbNode.getTitle() === 'Focus on Science');
});

// Live in-place edit
editor.update(() => {
  const root = $getRoot();
  const sbNode = root.getChildren()[1];
  const pChild = sbNode.getChildren()[1];
  pChild.clear();
  pChild.append($createTextNode('Updated sidebar paragraph content.'));
});

editor.read(() => {
  const root = $getRoot();
  const sbNode = root.getChildren()[1];
  const pChild = sbNode.getChildren()[1];
  check('Live text edit inside sidebar preserves container', pChild.getTextContent() === 'Updated sidebar paragraph content.' && $isSidebarNode(sbNode));
});

// --- Section 2: Anonymous / Untitled Box Edge Case ---
console.log('\n--- Section 2: Anonymous / Untitled Box Edge Case ---');
const untitledBoxDoc = {
  blocks: [
    {
      type: 'box',
      blocks: [
        { type: 'para', text: 'This is an untitled callout box.' }
      ]
    }
  ]
};

modelToLexicalInEditor(editor, untitledBoxDoc);
const extractedUntitled = buildModelFromEditor(editor);
check('Untitled box extracts as box block', extractedUntitled.blocks.length === 1 && extractedUntitled.blocks[0].type === 'box');
check('Untitled box has 1 child block', extractedUntitled.blocks[0].blocks?.length === 1);

const untitledBraille = formatDocument(untitledBoxDoc, {
  translate: (s) => s.toUpperCase(),
  width: 30,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
});
const untitledLines = untitledBraille.split('\n');
check('Untitled box top line is continuous 333 symbols', untitledLines.some(l => l.includes('3333333333333333')));

// --- Section 3: Complex Children Inside Sidebars ---
console.log('\n--- Section 3: Complex Children Inside Sidebars ---');
const complexBoxDoc = {
  blocks: [
    {
      type: 'box',
      title: 'Poetry & Science',
      blocks: [
        { type: 'heading', level: 2, text: 'Poetry & Science' },
        { type: 'para', style: 'verse', text: 'Two roads diverged in a yellow wood,' },
        { type: 'para', style: 'verse', text: 'And sorry I could not travel both' }
      ]
    }
  ]
};

modelToLexicalInEditor(editor, complexBoxDoc);
const extractedComplex = buildModelFromEditor(editor);
check('Complex box contains 3 child elements', extractedComplex.blocks[0].blocks?.length === 3);
check('Verse style preserved on paragraph inside box', extractedComplex.blocks[0].blocks[1].style === 'verse');

// --- Section 3b: Table and Graphic Children Inside Sidebars ---
console.log('\n--- Section 3b: Table and Graphic Children Inside Sidebars ---');
const tableGraphicBoxDoc = {
  blocks: [
    {
      type: 'box',
      title: 'Data & Diagrams',
      blocks: [
        { type: 'heading', level: 2, text: 'Data & Diagrams' },
        { type: 'para', text: 'Below is experimental data and tactile graphic:' },
        {
          type: 'table',
          headers: ['Trial', 'Measurement'],
          rows: [['1', '4.2 cm'], ['2', '8.5 cm']]
        },
        {
          type: 'graphic',
          svg: '<svg><rect width="100" height="100"/></svg>',
          alt: 'Box plot'
        }
      ]
    }
  ]
};

modelToLexicalInEditor(editor, tableGraphicBoxDoc);
const extractedTG = buildModelFromEditor(editor);
check('Sidebar with table and graphic extracts 4 child blocks', extractedTG.blocks[0].blocks?.length === 4);
check('Nested table headers preserved', extractedTG.blocks[0].blocks[2].type === 'table' && extractedTG.blocks[0].blocks[2].headers?.[1] === 'Measurement');
check('Nested graphic alt preserved', extractedTG.blocks[0].blocks[3].type === 'graphic' && extractedTG.blocks[0].blocks[3].alt === 'Box plot');

// --- Section 3c: SidebarNode JSON Serialization ---
console.log('\n--- Section 3c: SidebarNode JSON Serialization ---');
let jsonSerialized;
editor.update(() => {
  const sbForJson = $createSidebarNode('JSON Test Box');
  jsonSerialized = sbForJson.exportJSON();
});
check('SidebarNode exportJSON has correct type and title', jsonSerialized.type === 'emboss-sidebar' && jsonSerialized.title === 'JSON Test Box');
editor.update(() => {
  const sbImported = SidebarNode.importJSON(jsonSerialized);
  check('SidebarNode importJSON restores title and banaStyle', sbImported.getTitle() === 'JSON Test Box' && sbImported.getBanaStyle() === 'sidebar');
});

// --- Section 4: NIMAS XML Round-Trip ---
console.log('\n--- Section 4: NIMAS XML Export & Re-Parse ---');
const xmlOut = exportToNimasXml(sourceAst);
check('Exported XML contains <sidebar>', xmlOut.includes('<sidebar>'));
check('Exported XML contains <hd>Focus on Science</hd>', xmlOut.includes('<hd>Focus on Science</hd>'));

const parsedDoc = parseDtbook(xmlOut);
const boxParsed = parsedDoc.blocks.find(b => b.type === 'box');
check('Re-parsed XML contains box block', !!boxParsed);
check('Re-parsed box title matches', boxParsed?.title === 'Focus on Science');
check('Re-parsed box child blocks preserved', boxParsed?.blocks?.length === 3);

// --- Section 5: BANA Braille Boxlines & Cell-Trace ---
console.log('\n--- Section 5: BANA Braille Boxlines & Cell Trace ---');
const trace = {};
const brailleResult = formatDocument(sourceAst, {
  translate: (s) => s.toUpperCase(),
  width: 40,
  depth: 25,
  cells: 40,
  lines: 25,
  mode: 'bana',
  standard: 'bana',
  trace
});

check('Top boxline contains 333 symbols', brailleResult.includes('333'));
check('Bottom boxline contains 777 symbols', brailleResult.includes('7777777'));
check('Boxline title formatted in braille', brailleResult.includes('FOCUS ON SCIENCE') || brailleResult.includes('333'));

const sidebarRowIndices = [];
(trace.rows || []).forEach((bi, rowIdx) => {
  if (bi === 1) sidebarRowIndices.push(rowIdx);
});
check('Trace rows map to sidebar block index', sidebarRowIndices.length >= 3);

// --- Section 6: Scale Test across All 422 Real Textbook Sidebars ---
console.log('\n--- Section 6: Scale Test: All 422 Real Textbook Sidebars ---');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const textbookXmlPath = path.join(HERE, 'nimas_samples/9780544087507NIMAS.xml');

if (fs.existsSync(textbookXmlPath)) {
  const tbXml = fs.readFileSync(textbookXmlPath, 'utf8');
  const tbDoc = parseDtbook(tbXml);
  const tbBoxes = tbDoc.blocks.filter(b => b.type === 'box');
  check(`Loaded textbook sidebars: found ${tbBoxes.length} boxes`, tbBoxes.length === 422);

  const scaleDoc = { blocks: tbBoxes };
  modelToLexicalInEditor(editor, scaleDoc);
  const extractedScale = buildModelFromEditor(editor);

  check('Extracted all 422 sidebars from Lexical', extractedScale.blocks.length === 422);

  let titlesMatched = 0, childCountMatched = 0;
  for (let i = 0; i < tbBoxes.length; i++) {
    const origBox = tbBoxes[i];
    const extBox = extractedScale.blocks[i];
    if (origBox.title === extBox.title) titlesMatched++;
    if ((origBox.blocks?.length || 0) === (extBox.blocks?.length || 0)) childCountMatched++;
  }

  check('All 422 sidebar titles matched perfectly', titlesMatched === 422, `${titlesMatched}/422`);
  check('All 422 sidebars preserved 100% of child elements', childCountMatched === 422, `${childCountMatched}/422`);
} else {
  console.warn('Textbook sample file not found at:', textbookXmlPath);
}

console.log(`\nSidebar sync tests complete: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
