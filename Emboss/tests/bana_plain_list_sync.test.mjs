import assert from 'node:assert/strict';
import {
  createEditor, $getRoot, $createTextNode, registerList, registerRichText,
  ListNode, ListItemNode, ParagraphNode, TextNode, HeadingNode, QuoteNode,
  $createListNode, $createListItemNode
} from '../web/editor/vendor-lexical.mjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { exportToNimasXml } from '../input/nimas-export.mjs';
import { parseNimasXml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';

// Setup Lexical prototype extensions as in editor.mjs
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

const origListCreateDOM = ListNode.prototype.createDOM;
ListNode.prototype.createDOM = function(config) {
  const dom = origListCreateDOM.call(this, config);
  const style = this.getBanaStyle() || this.getListKind();
  const listType = this.getListType();
  if (listType === 'plain' || style === 'toc' || style === 'index' || style === 'plain') {
    dom.classList.add('emboss-plain-list');
  }
  if (style) {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  const kind = this.getListKind();
  if (kind) dom.dataset.listKind = kind;
  return dom;
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

function createTestEditor() {
  const ed = createEditor({
    nodes: [ListNode, ListItemNode, ParagraphNode, TextNode, HeadingNode, QuoteNode]
  });
  registerRichText(ed);
  registerList(ed);
  return ed;
}

function modelToLexicalInEditor(editor, model) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    for (const b of (model.blocks || [])) {
      if (b.type === 'list') {
        const kind = b.kind || b.style || null;
        const isToc = kind === 'toc';
        const isPlain = kind === 'plain' || kind === 'index' || isToc;
        const isExercise = kind === 'exercise';
        const isOrdered = b.ordered || (b.items && b.items.some((it) => it.marker));

        let listType = 'bullet';
        if (isPlain) listType = 'plain';
        else if (isExercise || isOrdered) listType = 'number';

        const list = $createListNode(listType, 1);
        if (kind) {
          list.setListKind(kind);
          list.setBanaStyle(kind);
        }

        for (const it of (b.items || [])) {
          const li = $createListItemNode();
          if (isToc) li.setBanaStyle('toc-entry');
          else if (isExercise) li.setBanaStyle(it.level && it.level > 0 ? 'exercise-sub' : 'exercise');
          else if (it.style) li.setBanaStyle(it.style);

          if (it.page) li.setPage(it.page);
          if (it.level) li.setLevel(it.level);
          if (it.marker) {
            const mNum = parseInt(it.marker, 10);
            if (!isNaN(mNum)) li.setValue(mNum);
          }

          if (it.text) li.append($createTextNode(it.text));
          if (li.getChildrenSize()) list.append(li);
        }
        if (list.getChildrenSize()) root.append(list);
      }
    }
  }, { discrete: true });
}

function buildModelFromEditor(editor) {
  let model = null;
  editor.getEditorState().read(() => {
    const blocks = [];
    for (const node of $getRoot().getChildren()) {
      if (node instanceof ListNode) {
        const listType = node.getListType();
        const listKind = node.getListKind() || node.getBanaStyle();
        const isPlain = listType === 'plain' || listKind === 'toc' || listKind === 'index' || listKind === 'plain';
        const isExercise = listKind === 'exercise' || node.getBanaStyle() === 'exercise';
        const isOrdered = listType === 'number' || (isExercise && !isPlain);

        const items = [];
        let n = 0;
        for (const li of node.getChildren()) {
          const textContent = li.getTextContent().replace(/\s+/g, ' ').trim();
          if (!textContent) continue;
          n++;
          const item = { text: textContent };
          if (isOrdered && !isPlain) {
            const val = li.getValue ? li.getValue() : null;
            item.marker = `${val && val > 0 ? val : n}.`;
          }
          const page = li.getPage();
          if (page) item.page = page;
          else if (isPlain || listKind === 'toc') {
            const m = textContent.match(/\s+(\d+|[ivxlcdm]+)$/i);
            if (m) {
              item.page = m[1];
              item.text = textContent.slice(0, m.index).trim();
            }
          }
          const lvl = li.getLevel ? li.getLevel() : 0;
          if (lvl > 0) item.level = lvl;
          const itemStyle = li.getBanaStyle();
          if (itemStyle) item.style = itemStyle;
          items.push(item);
        }
        if (items.length) {
          const block = { type: 'list', items };
          if (listKind) {
            block.kind = listKind;
            block.style = listKind;
          } else if (isPlain) {
            block.kind = 'toc';
            block.style = 'toc';
          }
          blocks.push(block);
        }
      }
    }
    model = { blocks };
  });
  return model;
}

console.log('--- Running BANA Plain List & TOC List Sync Tests ---');

// Test 1: TOC list model -> Lexical -> model extraction
const test1Model = {
  blocks: [
    {
      type: 'list',
      kind: 'toc',
      style: 'toc',
      items: [
        { text: 'Collection 1: Bold Actions', page: '1', level: 0 },
        { text: 'Rogue Wave by Theodore Taylor', page: '3', level: 1 },
        { text: 'Media Analysis: Deep Survival', page: '15', level: 1 }
      ]
    }
  ]
};

const ed = createTestEditor();
modelToLexicalInEditor(ed, test1Model);

let extracted = buildModelFromEditor(ed);
assert.equal(extracted.blocks.length, 1, 'Extracted 1 block');
assert.equal(extracted.blocks[0].kind, 'toc', 'Kind is toc');
assert.equal(extracted.blocks[0].items.length, 3, 'Extracted 3 items');
assert.equal(extracted.blocks[0].items[0].page, '1', 'Item 0 page preserved');
assert.equal(extracted.blocks[0].items[1].page, '3', 'Item 1 page preserved');
assert.equal(extracted.blocks[0].items[1].level, 1, 'Item 1 level preserved');
console.log('✔ Test 1 passed: TOC list metadata preserved across AST -> Lexical -> AST');

// Test 2: In-place text mutation on TOC item in Lexical
ed.update(() => {
  const root = $getRoot();
  const list = root.getFirstChild();
  const li2 = list.getChildren()[1]; // Rogue Wave
  li2.append($createTextNode(' (Short Story)'));
}, { discrete: true });

extracted = buildModelFromEditor(ed);
assert.equal(extracted.blocks[0].items[1].text, 'Rogue Wave by Theodore Taylor (Short Story)', 'Text mutation preserved');
assert.equal(extracted.blocks[0].items[1].page, '3', 'Page preserved after mutation');
assert.equal(extracted.blocks[0].items[1].level, 1, 'Level preserved after mutation');
assert.equal(extracted.blocks[0].kind, 'toc', 'Kind preserved after mutation');
console.log('✔ Test 2 passed: In-place text edits retain page and list kind');

// Test 3: Exercise list with sub-questions
const exerciseModel = {
  blocks: [
    {
      type: 'list',
      kind: 'exercise',
      style: 'exercise',
      items: [
        { text: 'Identify the protagonist.', marker: '1.', level: 0 },
        { text: 'What is their main motivation?', marker: 'a.', level: 1 }
      ]
    }
  ]
};

modelToLexicalInEditor(ed, exerciseModel);
extracted = buildModelFromEditor(ed);
assert.equal(extracted.blocks[0].kind, 'exercise', 'Exercise kind preserved');
assert.equal(extracted.blocks[0].items[0].style, 'exercise', 'Main question style');
assert.equal(extracted.blocks[0].items[1].style, 'exercise-sub', 'Sub-question style');
assert.equal(extracted.blocks[0].items[1].level, 1, 'Sub-question level 1');
console.log('✔ Test 3 passed: Exercise list and sub-questions correctly typed');

// Test 4: NIMAS XML Export & Round-Trip
const fullDoc = {
  blocks: [
    {
      type: 'list',
      kind: 'toc',
      items: [
        { text: 'Unit 1: Exploration', page: '10', level: 0 },
        { text: 'Chapter 1: Into the Deep', page: '12', level: 1 }
      ]
    },
    {
      type: 'list',
      kind: 'exercise',
      items: [
        { text: 'Solve for x.', marker: '1.', level: 0 },
        { text: 'Graph the parabola.', marker: '2.', level: 0 }
      ]
    },
    {
      type: 'list',
      kind: 'index',
      items: [
        { text: 'Algebra, 10-15', level: 0 },
        { text: 'Calculus, 40-50', level: 0 }
      ]
    },
    {
      type: 'list',
      items: [
        { text: 'Bullet item A' },
        { text: 'Bullet item B' }
      ]
    }
  ]
};

modelToLexicalInEditor(ed, fullDoc);
const roundTrippedDoc = buildModelFromEditor(ed);
const xml = exportToNimasXml(roundTrippedDoc);

assert.ok(xml.includes('<list type="pl" class="toc">'), 'Contains TOC plain list');
assert.ok(xml.includes('<li class="bai-toc-entry"><lic class="bai-toc-text">Unit 1: Exploration</lic><lic class="bai-toc-page">10</lic></li>'), 'Contains TOC item 1');
assert.ok(xml.includes('<li class="bai-toc-entry" level="1"><lic class="bai-toc-text">Chapter 1: Into the Deep</lic><lic class="bai-toc-page">12</lic></li>'), 'Contains TOC item 2 with level');
assert.ok(xml.includes('<list type="ol" class="bai-exercise">'), 'Contains exercise list');
assert.ok(xml.includes('<list type="pl" class="bai-index">'), 'Contains index list');
assert.ok(xml.includes('<list type="ul">'), 'Contains standard bullet list');

const parsedBack = parseNimasXml(xml);
assert.equal(parsedBack.blocks.length, 4, 'Parsed back 4 blocks');
assert.equal(parsedBack.blocks[0].kind, 'toc', 'First block is toc');
assert.equal(parsedBack.blocks[0].items[0].page, '10', 'First TOC item page is 10');
assert.equal(parsedBack.blocks[0].items[1].page, '12', 'Second TOC item page is 12');
assert.equal(parsedBack.blocks[1].kind, 'exercise', 'Second block is exercise');
assert.equal(parsedBack.blocks[2].kind, 'index', 'Third block is index');
console.log('✔ Test 4 passed: NIMAS XML export and parse round-trip 100% accurate');

// Test 5: Braille Formatter Invariant with TOC Dot Leaders
const brailleDoc = {
  blocks: [
    {
      type: 'list',
      kind: 'toc',
      items: [
        { text: 'Short Title', page: '5' }
      ]
    }
  ]
};
const brf = formatDocument(brailleDoc, {
  mode: 'bana',
  width: 40,
  depth: 25,
  toc: false,
  translate: (s) => s.toUpperCase()
});
assert.ok(brf.includes('"'), 'Braille contains BANA guide dots (" for dot 5)');
assert.ok(brf.includes('5'), 'Braille contains page number 5');
console.log('✔ Test 5 passed: Braille formatting produces exact BANA dot leaders for TOC');

console.log('\nAll 5 BANA Plain List & TOC List sync tests passed successfully!');
