import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  createEditor, $getRoot, $createTextNode, registerList, registerRichText,
  ListNode, ListItemNode, ParagraphNode, TextNode, HeadingNode, QuoteNode,
  $createListNode, $createListItemNode, $isListNode, $isListItemNode
} from '../web/editor/vendor-lexical.mjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
if (!globalThis.document) globalThis.document = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');

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
  const dom = origListCreateDOM ? origListCreateDOM.call(this, config) : document.createElement('ul');
  const style = this.getBanaStyle() || this.getListKind();
  const listType = this.getListType();
  if (listType === 'plain' || style === 'toc' || style === 'index' || style === 'plain') {
    dom.classList?.add?.('emboss-plain-list');
  }
  if (style) {
    dom.classList?.add?.(`bana-style-${style}`);
    if (dom.dataset) dom.dataset.banaStyle = style;
    else dom.setAttribute('data-bana-style', style);
  }
  const kind = this.getListKind();
  if (kind) {
    if (dom.dataset) dom.dataset.listKind = kind;
    else dom.setAttribute('data-list-kind', kind);
  }
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

const origItemCreateDOM = ListItemNode.prototype.createDOM;
ListItemNode.prototype.createDOM = function(config) {
  const dom = origItemCreateDOM ? origItemCreateDOM.call(this, config) : document.createElement('li');
  const style = this.getBanaStyle();
  if (style) {
    dom.classList?.add?.(`bana-style-${style}`);
    if (dom.dataset) dom.dataset.banaStyle = style;
    else dom.setAttribute('data-bana-style', style);
  }
  const page = this.getPage();
  if (page) {
    if (dom.dataset) dom.dataset.page = String(page);
    else dom.setAttribute('data-page', String(page));
  }
  const lvl = this.getLevel();
  if (lvl) {
    if (dom.dataset) dom.dataset.level = String(lvl);
    else dom.setAttribute('data-level', String(lvl));
  }
  return dom;
};

const origItemUpdateDOM = ListItemNode.prototype.updateDOM;
ListItemNode.prototype.updateDOM = function(prevNode, dom, config) {
  let updated = origItemUpdateDOM ? origItemUpdateDOM.call(this, prevNode, dom, config) : false;
  const prevLvl = prevNode ? prevNode.getLevel() : null;
  const nextLvl = this.getLevel();
  if (prevLvl !== nextLvl) {
    if (nextLvl) {
      if (dom.dataset) dom.dataset.level = String(nextLvl);
      else dom.setAttribute('data-level', String(nextLvl));
    } else {
      if (dom.dataset) delete dom.dataset.level;
      else dom.removeAttribute('data-level');
    }
    updated = true;
  }
  return updated;
};

describe('Nested List Creation & Indentation Suite', () => {
  test('Multi-level nested list items preserve levels and DOM datasets', () => {
    const editor = createEditor({
      nodes: [ListNode, ListItemNode, HeadingNode, QuoteNode, ParagraphNode],
    });
    registerRichText(editor);
    registerList(editor);

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const ol = $createListNode('number');

      const li1 = $createListItemNode();
      li1.append($createTextNode('First main point'));
      li1.setLevel(0);
      ol.append(li1);

      const li1a = $createListItemNode();
      li1a.append($createTextNode('First sub-point'));
      li1a.setLevel(1);
      ol.append(li1a);

      const li1b = $createListItemNode();
      li1b.append($createTextNode('Second sub-point'));
      li1b.setLevel(1);
      ol.append(li1b);

      const li1bi = $createListItemNode();
      li1bi.append($createTextNode('Sub-sub-point i'));
      li1bi.setLevel(2);
      ol.append(li1bi);

      const li2 = $createListItemNode();
      li2.append($createTextNode('Second main point'));
      li2.setLevel(0);
      ol.append(li2);

      root.append(ol);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const list = root.getFirstChild();
      assert($isListNode(list));
      const items = list.getChildren();
      assert.equal(items.length, 5);

      assert.equal(items[0].getLevel(), 0);
      assert.equal(items[1].getLevel(), 1);
      assert.equal(items[2].getLevel(), 1);
      assert.equal(items[3].getLevel(), 2);
      assert.equal(items[4].getLevel(), 0);

      // Verify DOM attributes
      const dom0 = items[0].createDOM({ theme: {} });
      assert.equal(dom0.getAttribute('data-level'), null);

      const dom1 = items[1].createDOM({ theme: {} });
      assert.equal(dom1.getAttribute('data-level'), '1');

      const dom3 = items[3].createDOM({ theme: {} });
      assert.equal(dom3.getAttribute('data-level'), '2');
    });
  });

  test('Hierarchical marker generation produces 1. -> a. -> i. -> 2.', () => {
    const itemsRaw = [
      { text: 'Main 1', level: 0 },
      { text: 'Sub 1.a', level: 1 },
      { text: 'Sub 1.b', level: 1 },
      { text: 'Deep 1.b.i', level: 2 },
      { text: 'Deep 1.b.ii', level: 2 },
      { text: 'Sub 1.c', level: 1 },
      { text: 'Main 2', level: 0 },
      { text: 'Sub 2.a', level: 1 },
    ];

    const counters = [0, 0, 0, 0, 0];
    const items = [];
    for (const it of itemsRaw) {
      const lvl = it.level || 0;
      counters[lvl]++;
      for (let l = lvl + 1; l < counters.length; l++) counters[l] = 0;
      const count = counters[lvl];
      let marker = null;
      if (lvl === 0) marker = `${count}.`;
      else if (lvl === 1) marker = `${String.fromCharCode(96 + ((count - 1) % 26 + 1))}.`;
      else if (lvl === 2) {
        const romans = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
        marker = `${romans[count - 1] || count}.`;
      } else if (lvl === 3) marker = `${String.fromCharCode(64 + ((count - 1) % 26 + 1))}.`;
      else marker = `(${count})`;

      items.push({ ...it, marker });
    }

    assert.equal(items[0].marker, '1.');
    assert.equal(items[1].marker, 'a.');
    assert.equal(items[2].marker, 'b.');
    assert.equal(items[3].marker, 'i.');
    assert.equal(items[4].marker, 'ii.');
    assert.equal(items[5].marker, 'c.');
    assert.equal(items[6].marker, '2.');
    assert.equal(items[7].marker, 'a.');
  });

  test('BANA Braille Formatter applies stepped margins: 1-3 for lvl 0, 3-5 for lvl 1, 5-7 for lvl 2', () => {
    const listBlock = {
      type: 'list',
      ordered: true,
      items: [
        { marker: '1.', text: 'Main Item One', level: 0 },
        { marker: 'a.', text: 'Sub-item Alpha', level: 1 },
        { marker: 'i.', text: 'Sub-sub-item Roman', level: 2 },
        { marker: '2.', text: 'Main Item Two', level: 0 },
      ]
    };

    const brf = formatDocument({ blocks: [listBlock] }, { cells: 38, lines: 25, grade: 2, translate: s => s });
    assert(brf.length > 0);

    const lines = brf.split('\n').filter(l => l.trim().length > 0);
    assert(lines.length >= 4);

    const l0 = lines.find(l => l.includes('1.'));
    const l1 = lines.find(l => l.includes('a.'));
    const l2 = lines.find(l => l.includes('i.'));

    assert(l0, 'Found level 0 line');
    assert(l1, 'Found level 1 line');
    assert(l2, 'Found level 2 line');

    assert(l0.startsWith('1.'), 'Level 0 starts at Cell 1');
    assert(l1.startsWith('  a.'), 'Level 1 starts at Cell 3 (2 leading spaces)');
    assert(l2.startsWith('    i.'), 'Level 2 starts at Cell 5 (4 leading spaces)');
  });

  test('NIMAS Round-trip preserves nested list levels perfectly', () => {
    const doc = {
      type: 'document',
      title: 'Nested List Parity Test',
      blocks: [
        {
          type: 'list',
          ordered: true,
          items: [
            { text: 'Primary question item', level: 0 },
            { text: 'Secondary question sub-item', level: 1 },
            { text: 'Tertiary question sub-sub-item', level: 2 },
          ]
        }
      ]
    };

    const xml = exportToNimasXml(doc);
    assert(xml.includes('level="1"'), 'XML exports level="1"');
    assert(xml.includes('level="2"'), 'XML exports level="2"');

    const parsed = parseNimasXml(xml);
    const list = parsed.blocks.find(b => b.type === 'list');
    assert(list);
    assert.equal(list.items.length, 3);
    assert.equal(list.items[0].level || 0, 0);
    assert.equal(list.items[1].level, 1);
    assert.equal(list.items[2].level, 2);
  });
});
