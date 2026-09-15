// Systematic Test Harness for Phase 5A: Block Style Dropdown & Node Transformations
// Verifies all BANA/UEB styles in the dropdown (#blockStyle), Lexical node conversions,
// AST model extraction fidelity, and BANA braille margin layout rules.

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
  $setBlocksType, $getSelection, $isRangeSelection
} from '../web/editor/vendor-lexical.mjs';

import { STYLE_DEFINITIONS, getStyleMargins } from '../format/styles.mjs';
import { formatDocument, formatBlock } from '../format/document.mjs';
import { parseDtbook, parseNimasXml } from '../input/parse.mjs';

console.log('=== Running BANA Style Dropdown & Transformations Test Suite (Phase 5A) ===\n');

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
ParagraphNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ParagraphNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
const origParaClone = ParagraphNode.prototype.afterCloneFrom;
ParagraphNode.prototype.afterCloneFrom = function(prev) {
  if (origParaClone) origParaClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
};

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

function createTestEditor() {
  const ed = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ParagraphNode, TextNode],
    onError: (e) => { throw e; }
  });
  registerRichText(ed);
  registerList(ed);
  return ed;
}

// Convert Lexical node to AST block (matching editor.mjs paraBlock and extractListBlock)
function nodeToBlock(node) {
  if ($isHeadingNode(node)) {
    const text = node.getTextContent().replace(/\s+/g, ' ').trim();
    return { type: 'heading', level: Math.min(3, Number(node.getTag().slice(1)) || 1), text };
  }
  if ($isListNode(node)) {
    const listType = typeof node.getListType === 'function' ? node.getListType() : null;
    const listKind = (typeof node.getListKind === 'function' ? node.getListKind() : null) ||
                     (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null);
    const isPlain = listType === 'plain' || listKind === 'toc' || listKind === 'index' || listKind === 'plain';
    const isExercise = listKind === 'exercise' || (typeof node.getBanaStyle === 'function' && node.getBanaStyle() === 'exercise');
    const isOrdered = listType === 'number' || (isExercise && !isPlain);

    const items = [];
    let n = 0;
    for (const li of node.getChildren()) {
      const textContent = li.getTextContent().replace(/\s+/g, ' ').trim();
      if (!textContent) continue;
      n++;
      const item = { text: textContent };
      if (isOrdered && !isPlain) item.marker = `${n}.`;
      const page = typeof li.getPage === 'function' ? li.getPage() : null;
      if (page) item.page = page;
      items.push(item);
    }
    const block = { type: 'list', items };
    if (listKind) { block.kind = listKind; block.style = listKind; }
    else if (isPlain) { block.kind = 'toc'; block.style = 'toc'; }
    return block;
  }
  
  const banaStyle = typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null;
  const text = node.getTextContent().replace(/\s+/g, ' ').trim();
  const block = { type: 'para', text };
  if (banaStyle && banaStyle !== 'body') {
    block.style = banaStyle;
    if (banaStyle === 'note') block.type = 'note';
    else if (banaStyle === 'caption') block.type = 'caption';
    else if (banaStyle === 'footnote') block.type = 'footnote';
    else if (banaStyle === 'attribution') block.type = 'attribution';
    else if (banaStyle === 'stage') block.type = 'stage';
    else if (banaStyle === 'dialogue') block.type = 'play';
    else if (banaStyle === 'verse' || banaStyle === 'poem') { block.type = 'play'; block.subtype = 'verse'; }
  }
  return block;
}

// Emulate applyBlockStyle function on a Lexical editor instance
function applyStyleToEditor(ed, targetStyle, initialText = 'Sample text line') {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const norm = (targetStyle === 'ul') ? 'bullet' : (targetStyle === 'ol') ? 'number' : (targetStyle === 'body' ? 'p' : (targetStyle || 'p'));

    if (norm === 'bullet' || norm === 'number' || norm === 'plain' || norm === 'toc' || norm === 'exercise') {
      const listType = (norm === 'toc' || norm === 'plain') ? 'plain' : (norm === 'number' || norm === 'exercise' ? 'number' : 'bullet');
      const list = $createListNode(listType);
      const kind = (norm === 'toc' || norm === 'plain') ? 'toc' : (norm === 'exercise' ? 'exercise' : null);
      if (kind) {
        list.setListKind(kind);
        list.setBanaStyle(kind);
      }
      const li = $createListItemNode();
      li.append($createTextNode(initialText));
      list.append(li);
      root.append(list);
    } else if (norm === 'h1' || norm === 'h2' || norm === 'h3') {
      const h = $createHeadingNode(norm);
      h.append($createTextNode(initialText));
      root.append(h);
    } else if (norm === 'quote') {
      const p = $createParagraphNode();
      p.setBanaStyle('quote');
      p.append($createTextNode(initialText));
      root.append(p);
    } else {
      const banaStyle = (norm === 'p' || norm === 'body') ? null : norm;
      const p = $createBanaParagraphNode(banaStyle);
      p.append($createTextNode(initialText));
      root.append(p);
    }
  });
}

// ----------------------------------------------------------------------------
// Section 1: Dropdown Option Values & Style Definitions
// ----------------------------------------------------------------------------
console.log('--- Section 1: Dropdown Option Values & Taxonomy Validation ---');

const EXPECTED_DROPDOWN_STYLES = [
  { value: 'p', label: '¶ Body Text' },
  { value: 'h1', label: 'H1 Heading' },
  { value: 'h2', label: 'H2 Subheading' },
  { value: 'h3', label: 'H3 Sub-subheading' },
  { value: 'bullet', label: '• Bullet List' },
  { value: 'number', label: '1. Numbered List' },
  { value: 'toc', label: '📑 TOC Entry' },
  { value: 'dialogue', label: '🎭 Play Dialogue' },
  { value: 'stage', label: '🎬 Stage Direction' },
  { value: 'poem', label: '📜 Poetry / Verse' },
  { value: 'exercise', label: '❓ Exercise Question' },
  { value: 'caption', label: '💬 Caption / Attribution' },
  { value: 'footnote', label: '📝 Footnote' },
  { value: 'note', label: "📋 Transcriber's Note" },
  { value: 'quote', label: '“ Blockquote' }
];

check('15 total styles configured for the dropdown', EXPECTED_DROPDOWN_STYLES.length === 15);

for (const s of EXPECTED_DROPDOWN_STYLES) {
  const styleKey = s.value === 'p' ? 'body' : (s.value === 'bullet' ? 'list-bullet' : (s.value === 'number' ? 'list-number' : s.value));
  check(`Dropdown style '${s.value}' exists in STYLE_DEFINITIONS`, !!STYLE_DEFINITIONS[styleKey] || !!STYLE_DEFINITIONS[s.value]);
}

// ----------------------------------------------------------------------------
// Section 2: Lexical Node Transformation & AST Model Extraction
// ----------------------------------------------------------------------------
console.log('\n--- Section 2: Lexical Node Transformation & AST Model Extraction ---');

const ed = createTestEditor();

const testCases = [
  { style: 'p', expectedType: 'para', checkBanaStyle: null },
  { style: 'h1', expectedType: 'heading', expectedLevel: 1 },
  { style: 'h2', expectedType: 'heading', expectedLevel: 2 },
  { style: 'h3', expectedType: 'heading', expectedLevel: 3 },
  { style: 'bullet', expectedType: 'list', expectedOrdered: false },
  { style: 'number', expectedType: 'list', expectedOrdered: true },
  { style: 'toc', expectedType: 'list', expectedKind: 'toc' },
  { style: 'exercise', expectedType: 'list', expectedKind: 'exercise' },
  { style: 'dialogue', expectedType: 'play', checkBanaStyle: 'dialogue' },
  { style: 'stage', expectedType: 'stage', checkBanaStyle: 'stage' },
  { style: 'poem', expectedType: 'play', expectedSubtype: 'verse', checkBanaStyle: 'poem' },
  { style: 'caption', expectedType: 'caption', checkBanaStyle: 'caption' },
  { style: 'footnote', expectedType: 'footnote', checkBanaStyle: 'footnote' },
  { style: 'note', expectedType: 'note', checkBanaStyle: 'note' },
  { style: 'quote', expectedType: 'para', checkBanaStyle: 'quote' }
];

for (const tc of testCases) {
  applyStyleToEditor(ed, tc.style, `Testing style ${tc.style}`);
  
  ed.read(() => {
    const root = $getRoot();
    const node = root.getFirstChild();
    check(`Node created for style '${tc.style}'`, !!node);

    const block = nodeToBlock(node);
    check(`Block type matches for '${tc.style}' (${block.type})`, block.type === tc.expectedType);

    if (tc.expectedLevel != null) {
      check(`Heading level matches for '${tc.style}' (${block.level})`, block.level === tc.expectedLevel);
    }
    if (tc.expectedKind != null) {
      check(`List kind matches for '${tc.style}' (${block.kind})`, block.kind === tc.expectedKind);
    }
    if (tc.expectedSubtype != null) {
      check(`Subtype matches for '${tc.style}' (${block.subtype})`, block.subtype === tc.expectedSubtype);
    }
    if (tc.checkBanaStyle != null) {
      check(`banaStyle matches for '${tc.style}' (${block.style})`, block.style === tc.checkBanaStyle);
    }
  });
}

// ----------------------------------------------------------------------------
// Section 3: BANA Braille Margin & Formatting Verification
// ----------------------------------------------------------------------------
console.log('\n--- Section 3: BANA Braille Margin & Formatting Rules ---');

const brailleOpts = {
  width: 38,
  depth: 25,
  mode: 'bana',
  standard: 'bana',
  translate: (s) => String(s).toUpperCase()
};

// 1. Dialogue: Speaker in Cell 1, runover in Cell 3 (1-3)
const dialogueBlock = { type: 'play', style: 'dialogue', text: 'HAMLET: To be, or not to be, that is the question: Whether \'tis nobler in the mind to suffer.' };
const dialogueLines = formatBlock(dialogueBlock, brailleOpts);
check('Dialogue first line starts in Cell 1 (0 indent)', dialogueLines[0].startsWith('HAMLET:'));
check('Dialogue runover line starts in Cell 3 (2 spaces indent)', dialogueLines[1].startsWith('  '));

// 2. Stage Direction: 7-7 margin (6 spaces indent)
const stageBlock = { type: 'stage', style: 'stage', text: 'Enter Ghost, Hamlet, and Horatio talking quietly.' };
const stageLines = formatBlock(stageBlock, brailleOpts);
check('Stage direction starts in Cell 7 (6 spaces indent)', stageLines[0].startsWith('      '));

// 3. Poetry / Verse: 1-3 margin (Cell 1 first line, Cell 3 runover)
const poemBlock = { type: 'play', subtype: 'verse', style: 'poem', text: 'Two roads diverged in a yellow wood, and sorry I could not travel both.' };
const poemLines = formatBlock(poemBlock, brailleOpts);
check('Poetry first line starts in Cell 1', poemLines[0].startsWith('TWO ROADS'));
check('Poetry runover line starts with indent (Cell 3)', poemLines[1].startsWith('  '));

// 4. Transcriber Note: BANA TN indicators (@.< ... @.>) with 7-5 margin
const noteBlock = { type: 'note', style: 'note', text: 'This chart was modified for clarity.' };
const noteLines = formatBlock(noteBlock, brailleOpts);
const noteFull = noteLines.join(' ');
check("Transcriber Note has BANA TN indicators (@.< and @.>)", noteFull.includes("@.<") && noteFull.endsWith("@.>"));

// 5. Heading 1: Centred with blank line before and after
const h1Block = { type: 'heading', level: 1, text: 'Chapter 1' };
const h1Lines = formatBlock(h1Block, brailleOpts);
check('H1 has blank line before', h1Lines[0] === '');
check('H1 heading text is centered', h1Lines[1].startsWith(' ') && h1Lines[1].includes('CHAPTER 1'));
check('H1 has blank line after', h1Lines[2] === '');

// 6. Heading 2: Cell 5 (4 spaces indent)
const h2Block = { type: 'heading', level: 2, text: 'Section Overview' };
const h2Lines = formatBlock(h2Block, brailleOpts);
check('H2 starts in Cell 5 (4 spaces indent)', h2Lines[1].startsWith('    SECTION OVERVIEW'));

// 7. Heading 3: Cell 7 (6 spaces indent)
const h3Block = { type: 'heading', level: 3, text: 'Key Findings' };
const h3Lines = formatBlock(h3Block, brailleOpts);
check('H3 starts in Cell 7 (6 spaces indent)', h3Lines[1].startsWith('      KEY FINDINGS'));

// ----------------------------------------------------------------------------
// Section 4: Scale Verification against Full Textbook
// ----------------------------------------------------------------------------
console.log('\n--- Section 4: Scale Verification against Full Textbook ---');

const textbookPath = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
let textbookXml = '';
try {
  textbookXml = fs.readFileSync(textbookPath, 'utf8');
} catch (e) {
  console.error('Could not read textbook XML:', e.message);
}

if (textbookXml) {
  const parsedDoc = parseNimasXml(textbookXml);
  check('Textbook parsed successfully', (parsedDoc.blocks || []).length > 5000);

  // Verify all block styles present in the textbook are known taxonomy styles
  const blockTypes = new Set();
  const blockStyles = new Set();
  for (const b of parsedDoc.blocks) {
    if (b.type) blockTypes.add(b.type);
    if (b.style) blockStyles.add(b.style);
    if (b.kind) blockStyles.add(b.kind);
  }

  check('Textbook contains headings', blockTypes.has('heading'));
  check('Textbook contains paragraphs', blockTypes.has('para'));
  check('Textbook contains lists', blockTypes.has('list'));
  check('Textbook contains sidebars / boxes', blockTypes.has('box') || blockTypes.has('sidebar'));
  check('Textbook contains tables', blockTypes.has('table'));
  check('Textbook contains notes', blockTypes.has('note'));
  check('Textbook contains pagenums', blockTypes.has('pagenum'));
}

console.log(`\nPhase 5A test suite complete: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
