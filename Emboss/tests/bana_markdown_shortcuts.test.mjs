// Systematic Test Harness for Phase 5C: Markdown Shortcut Triggers
// Verifies auto-formatting on line-start input (#, ##, ###, *, -, +, 1., 1), >, ---, [tn, Q1., Speaker:),
// negative false-positive avoidance, AST fidelity, and BANA textbook coverage.

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

const $isParagraphNode = (n) => n instanceof ParagraphNode;

import { STYLE_DEFINITIONS, getStyleMargins } from '../format/styles.mjs';
import { formatDocument, formatBlock } from '../format/document.mjs';
import { parseDtbook, parseNimasXml } from '../input/parse.mjs';

console.log('=== Running BANA Markdown Shortcut Triggers Test Suite (Phase 5C) ===\n');

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

// ----------------------------------------------------------------------------
// Lexical Prototype Extensions & Custom Nodes (Mirroring editor.mjs)
// ----------------------------------------------------------------------------

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
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, ParagraphNode, TextNode, BreakNode],
    onError: (e) => { throw e; }
  });
  registerRichText(ed);
  registerList(ed);
  return ed;
}

// ----------------------------------------------------------------------------
// Section 1: Markdown Shortcut Transformer Logic
// ----------------------------------------------------------------------------
console.log('--- Section 1: Markdown Shortcut Transformation Rules ---');

function applyMarkdownShortcut(node) {
  if (!$isParagraphNode(node)) return null;
  const firstChild = node.getFirstChild();
  if (!(firstChild instanceof TextNode)) return null;

  const text = firstChild.getTextContent();

  // 1. Heading 1-3: # , ## , ### 
  const headingMatch = text.match(/^(#{1,3})\s(.*)$/s);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const tag = `h${level}`;
    const restText = headingMatch[2];
    const heading = $createHeadingNode(tag);
    if (restText) heading.append($createTextNode(restText));
    node.replace(heading);
    return { type: 'heading', level, node: heading };
  }

  // 2. Blockquote: > 
  const quoteMatch = text.match(/^>\s(.*)$/s);
  if (quoteMatch) {
    const restText = quoteMatch[1];
    const p = $createParagraphNode();
    p.setBanaStyle('quote');
    if (restText) p.append($createTextNode(restText));
    node.replace(p);
    return { type: 'quote', node: p };
  }

  // 3. Bullet list: * , - , + 
  const bulletMatch = text.match(/^([*\-+])\s(.*)$/s);
  if (bulletMatch) {
    const restText = bulletMatch[2];
    const list = $createListNode('bullet');
    const li = $createListItemNode();
    if (restText) li.append($createTextNode(restText));
    list.append(li);
    node.replace(list);
    return { type: 'list-bullet', node: list };
  }

  // 4. Numbered list: 1. , 1) 
  const numberMatch = text.match(/^1[.)]\s(.*)$/s);
  if (numberMatch) {
    const restText = numberMatch[1];
    const list = $createListNode('number');
    const li = $createListItemNode();
    if (restText) li.append($createTextNode(restText));
    list.append(li);
    node.replace(list);
    return { type: 'list-number', node: list };
  }

  // 5. Exercise question: Q1. , Ex1. 
  const exMatch = text.match(/^(?:Q\d+|Ex\d*|Exercise\s*\d*)[.)]\s(.*)$/is);
  if (exMatch) {
    const restText = exMatch[1];
    const list = $createListNode('number');
    list.setListKind('exercise');
    list.setBanaStyle('exercise');
    const li = $createListItemNode();
    if (restText) li.append($createTextNode(restText));
    list.append(li);
    node.replace(list);
    return { type: 'exercise', node: list };
  }

  // 6. Transcriber's Note: [TN , [tn , [TN: , [tn: , @.< 
  const tnMatch = text.match(/^(?:\[tn:?|\[transcriber(?:'s)?\s*note:?|@\.<)\s*(.*?)(?:\]|@\.>)?$/is);
  if (tnMatch) {
    const restText = tnMatch[1];
    const p = $createBanaParagraphNode('note');
    if (restText) p.append($createTextNode(restText));
    node.replace(p);
    return { type: 'note', node: p };
  }

  // 7. Horizontal Divider Break: ---, ***, ___
  const hrMatch = text.match(/^(\-{3,}|\*{3,}|_{3,})$/);
  if (hrMatch) {
    const brk = $createBreakNode();
    const nextP = $createParagraphNode();
    node.replace(brk);
    brk.insertAfter(nextP);
    return { type: 'break', node: brk, nextNode: nextP };
  }

  // 8. Drama Dialogue: Speaker name with colon (e.g. HAMLET: or DOCTOR:)
  const dialogueMatch = text.match(/^([A-Z][A-Z0-9_\s]{1,20}):\s(.*)$/s);
  if (dialogueMatch && !node.getBanaStyle()) {
    node.setBanaStyle('dialogue');
    return { type: 'dialogue', node };
  }

  return null;
}

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

const ed = createTestEditor();

// ----------------------------------------------------------------------------
// Section 2: Heading Triggers (#, ##, ###)
// ----------------------------------------------------------------------------
console.log('\n--- Section 2: Heading Shortcut Triggers ---');

const HEADING_CASES = [
  { input: '# Main Heading 1', expectedLevel: 1, expectedText: 'Main Heading 1' },
  { input: '## Section Subheading 2', expectedLevel: 2, expectedText: 'Section Subheading 2' },
  { input: '### Minor Subsection 3', expectedLevel: 3, expectedText: 'Minor Subsection 3' },
];

for (const hc of HEADING_CASES) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    p.append($createTextNode(hc.input));
    root.append(p);

    const res = applyMarkdownShortcut(p);
    check(`Shortcut for "${hc.input}" returned result`, !!res && res.type === 'heading');
  });

  ed.read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    check(`Created HeadingNode for "${hc.input}"`, $isHeadingNode(first));
    const ast = nodeToASTBlock(first);
    check(`AST type is heading`, ast && ast.type === 'heading');
    check(`AST level is ${hc.expectedLevel}`, ast && ast.level === hc.expectedLevel);
    check(`AST text is "${hc.expectedText}" (prefix stripped)`, ast && ast.text === hc.expectedText);
  });
}

// ----------------------------------------------------------------------------
// Section 3: List Shortcut Triggers (*, -, +, 1., 1))
// ----------------------------------------------------------------------------
console.log('\n--- Section 3: List Shortcut Triggers ---');

const LIST_CASES = [
  { input: '* Bullet with asterisk', expectedType: 'list', expectedKind: null, expectedText: 'Bullet with asterisk' },
  { input: '- Bullet with hyphen', expectedType: 'list', expectedKind: null, expectedText: 'Bullet with hyphen' },
  { input: '+ Bullet with plus', expectedType: 'list', expectedKind: null, expectedText: 'Bullet with plus' },
  { input: '1. Numbered with dot', expectedType: 'list', expectedKind: null, expectedText: 'Numbered with dot' },
  { input: '1) Numbered with paren', expectedType: 'list', expectedKind: null, expectedText: 'Numbered with paren' },
];

for (const lc of LIST_CASES) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    p.append($createTextNode(lc.input));
    root.append(p);

    const res = applyMarkdownShortcut(p);
    check(`Shortcut for "${lc.input}" returned result`, !!res && (res.type === 'list-bullet' || res.type === 'list-number'));
  });

  ed.read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    check(`Created ListNode for "${lc.input}"`, $isListNode(first));
    const ast = nodeToASTBlock(first);
    check(`AST type is list`, ast && ast.type === 'list');
    check(`AST item text is "${lc.expectedText}"`, ast && ast.items && ast.items[0]?.text === lc.expectedText);
  });
}

// ----------------------------------------------------------------------------
// Section 4: Blockquote & Transcriber's Notes (> , [tn, @.<)
// ----------------------------------------------------------------------------
console.log('\n--- Section 4: Blockquotes & Transcriber Notes ---');

const BANA_STYLE_CASES = [
  { input: '> This is an indented blockquote passage.', expectedASTType: 'para', expectedStyle: 'quote', expectedText: 'This is an indented blockquote passage.' },
  { input: '[tn Note on diagram: braille graphics omitted]', expectedASTType: 'note', expectedStyle: 'note', expectedText: 'Note on diagram: braille graphics omitted' },
  { input: '[TN: Transcriber remark with colon]', expectedASTType: 'note', expectedStyle: 'note', expectedText: 'Transcriber remark with colon' },
  { input: '@.< Note opening with BANA dots indicator', expectedASTType: 'note', expectedStyle: 'note', expectedText: 'Note opening with BANA dots indicator' },
];

for (const sc of BANA_STYLE_CASES) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    p.append($createTextNode(sc.input));
    root.append(p);

    const res = applyMarkdownShortcut(p);
    check(`Shortcut for "${sc.input}" returned result`, !!res);
  });

  ed.read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    check(`Created ParagraphNode for "${sc.input}"`, first instanceof ParagraphNode);
    const ast = nodeToASTBlock(first);
    check(`AST block type is "${sc.expectedASTType}"`, ast && ast.type === sc.expectedASTType);
    check(`AST style is "${sc.expectedStyle}"`, ast && ast.style === sc.expectedStyle);
    check(`AST text is "${sc.expectedText}"`, ast && ast.text === sc.expectedText);
  });
}

// ----------------------------------------------------------------------------
// Section 5: Document Breaks & Exercise Questions (---, ***, ___, Q1., Ex1.)
// ----------------------------------------------------------------------------
console.log('\n--- Section 5: Document Breaks & Exercises ---');

const BREAK_CASES = ['---', '***', '___', '------'];
for (const bc of BREAK_CASES) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    p.append($createTextNode(bc));
    root.append(p);

    const res = applyMarkdownShortcut(p);
    check(`Break shortcut for "${bc}" returned result`, !!res && res.type === 'break');
  });

  ed.read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    check(`Created BreakNode for "${bc}"`, $isBreakNode(first));
    const ast = nodeToASTBlock(first);
    check(`AST type is break`, ast && ast.type === 'break');
  });
}

const EXERCISE_CASES = [
  { input: 'Q1. What is the derivative of x^2?', expectedKind: 'exercise', expectedText: 'What is the derivative of x^2?' },
  { input: 'Ex2. Find the area of the triangle.', expectedKind: 'exercise', expectedText: 'Find the area of the triangle.' },
  { input: 'Exercise 3. Solve the system of linear equations.', expectedKind: 'exercise', expectedText: 'Solve the system of linear equations.' },
];

for (const ec of EXERCISE_CASES) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    p.append($createTextNode(ec.input));
    root.append(p);

    const res = applyMarkdownShortcut(p);
    check(`Exercise shortcut for "${ec.input}" returned result`, !!res && res.type === 'exercise');
  });

  ed.read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    check(`Created ListNode for "${ec.input}"`, $isListNode(first));
    const ast = nodeToASTBlock(first);
    check(`AST list kind is "exercise"`, ast && ast.kind === 'exercise');
    check(`AST item text is "${ec.expectedText}"`, ast && ast.items && ast.items[0]?.text === ec.expectedText);
  });
}

// ----------------------------------------------------------------------------
// Section 6: Drama Dialogue Auto-Detection (SPEAKER: speech)
// ----------------------------------------------------------------------------
console.log('\n--- Section 6: Drama Dialogue Auto-Detection ---');

const DIALOGUE_CASES = [
  { input: 'HAMLET: To be, or not to be, that is the question.', expectedText: 'HAMLET: To be, or not to be, that is the question.' },
  { input: 'LADY MACBETH: Out, damned spot! out, I say!', expectedText: 'LADY MACBETH: Out, damned spot! out, I say!' },
  { input: 'DOCTOR: Were I from Dunsinane away and clear.', expectedText: 'DOCTOR: Were I from Dunsinane away and clear.' },
];

for (const dc of DIALOGUE_CASES) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    p.append($createTextNode(dc.input));
    root.append(p);

    const res = applyMarkdownShortcut(p);
    check(`Dialogue shortcut for "${dc.input}" returned result`, !!res && res.type === 'dialogue');
  });

  ed.read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    check(`Retained ParagraphNode with dialogue style`, first instanceof ParagraphNode && first.getBanaStyle() === 'dialogue');
    const ast = nodeToASTBlock(first);
    check(`AST block type is play`, ast && ast.type === 'play');
    check(`AST style is dialogue`, ast && ast.style === 'dialogue');
    check(`AST full text preserved`, ast && ast.text === dc.expectedText);
  });
}

// ----------------------------------------------------------------------------
// Section 7: Negative False-Positive Avoidance
// ----------------------------------------------------------------------------
console.log('\n--- Section 7: Negative False-Positive Avoidance ---');

const NEGATIVE_CASES = [
  '#5 is my favorite jersey number',
  '>5 is strictly greater than four',
  '10. This is item ten, not item one',
  '-- Two dashes are not a horizontal divider',
  'Text with * inside the body of the paragraph',
  'Regular paragraph without any trigger prefix',
];

for (const nc of NEGATIVE_CASES) {
  ed.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    p.append($createTextNode(nc));
    root.append(p);

    const res = applyMarkdownShortcut(p);
    check(`No transformation for "${nc}" (null returned)`, res === null);
  });

  ed.read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    check(`Remained unchanged ParagraphNode for "${nc}"`, first instanceof ParagraphNode);
    check(`No accidental banaStyle applied`, first.getBanaStyle() === null);
  });
}

// ----------------------------------------------------------------------------
// Section 8: Real-World NIMAS XML Textbook Validation
// ----------------------------------------------------------------------------
console.log('\n--- Section 8: Real-World NIMAS XML Textbook Coverage ---');

// Primary source is the committed fixture; the Downloads copy is only a fallback if it exists.
const TEXTBOOK_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nimas_samples/9780544087507NIMAS.xml');
const TEXTBOOK_DOWNLOADS = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
const xmlPath = fs.existsSync(TEXTBOOK_FIXTURE) ? TEXTBOOK_FIXTURE : TEXTBOOK_DOWNLOADS;
if (fs.existsSync(xmlPath)) {
  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  const parsed = parseNimasXml(xmlContent);
  const blocks = parsed.blocks || [];

  check(`Parsed ${blocks.length} blocks from large textbook`, blocks.length > 5000, `Found: ${blocks.length}`);

  let headingCount = 0, listCount = 0, quoteCount = 0, noteCount = 0;
  for (const b of blocks) {
    if (b.type === 'heading') headingCount++;
    if (b.type === 'list') listCount++;
    if (b.type === 'note' || b.style === 'note' || (b.type === 'graphic' && b.description)) noteCount++;   // image descriptions are transcriber's notes in braille (A26)
    if (b.style === 'quote') quoteCount++;
  }

  check(`Textbook contains headings (${headingCount}) representable via # / ## / ###`, headingCount > 0);
  check(`Textbook contains lists (${listCount}) representable via * / 1.`, listCount > 0);
  check(`Textbook contains notes (${noteCount}) representable via [tn`, noteCount > 0);
} else {
  skipped++;
  console.warn(`SKIPPED: Section 8 (textbook coverage) — textbook XML not found at ${xmlPath}`);
}

console.log(`\n=============================================`);
console.log(`Phase 5C Test Results: ${pass} passed, ${fail} failed, ${skipped} skipped`);
console.log(`=============================================\n`);

if (fail > 0) {
  process.exit(1);
}
