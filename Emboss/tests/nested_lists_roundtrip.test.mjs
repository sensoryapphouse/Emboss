// A31: a list's structure and numbering must survive save -> reload. nimas-export
// now writes a nested <li> level as a real nested <list> (DTBook 2005-3 allows
// <list> inside <li>) instead of flat class="level-N" siblings for an ordinary
// (non-toc/exercise/index/plain/glossary) list, so a bulleted sub-list inside a
// numbered list can't come back numbered, and per-level numbering can't run on
// across levels. Every case here does one parse -> export -> parse round trip and
// checks the re-parsed items (text, level, marker, page) and block kind match the
// first parse exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNimasXml } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function wrap(fragment) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h1>Test</h1>
        ${fragment}
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
}

function getListBlocks(doc) {
  return (doc.blocks || []).filter((b) => b.type === 'list');
}

function normItems(items) {
  return items.map((it) => ({
    text: it.text || '',
    level: it.level || 0,
    marker: it.marker || null,
    page: it.page || null,
  }));
}

// Parses `xml`, exports it back to NIMAS, re-parses the export, and asserts every
// list block's kind and items (text/level/marker/page) survived unchanged.
function assertListsRoundTrip(xml, label) {
  const doc1 = parseNimasXml(xml);
  const xml2 = exportToNimasXml(doc1);
  const doc2 = parseNimasXml(xml2);
  const lists1 = getListBlocks(doc1);
  const lists2 = getListBlocks(doc2);
  assert.equal(lists2.length, lists1.length, `${label}: same number of list blocks`);
  for (let i = 0; i < lists1.length; i++) {
    assert.equal(lists2[i].kind || null, lists1[i].kind || null, `${label}: list ${i} kind`);
    assert.deepEqual(normItems(lists2[i].items), normItems(lists1[i].items), `${label}: list ${i} items`);
  }
  return { doc1, xml2, doc2 };
}

test('ordered list with an unordered sub-list: the sub-list does not come back numbered', () => {
  const xml = wrap(`
    <list type="ol">
      <li>1. Preheat the oven.</li>
      <li>2. Mix the ingredients.
        <list type="ul">
          <li>Flour</li>
          <li>Sugar</li>
          <li>Eggs</li>
        </list>
      </li>
      <li>3. Bake for 20 minutes.</li>
    </list>`);
  const { doc1, xml2 } = assertListsRoundTrip(xml, 'ol-with-ul-sub');
  const items = getListBlocks(doc1)[0].items;
  assert.equal(items.filter((it) => it.level === 1).length, 3, 'three sub-items at level 1');
  // F-33/A6, BANA Formats 2016 §8.6.2 ("Retain bullets whenever they are used in
  // lists"): a plain `<list type="ul">` sub-list with no literal bullet character now
  // gets Emboss's primary bullet marker ('•', not a numeric one) — it must still never
  // come back NUMBERED (that would mean the outer list's numbering leaked across
  // levels, the bug this test otherwise guards against).
  assert.ok(items.every((it) => (it.level === 1 ? it.marker === '•' : true)), 'sub-items carry the bullet marker, never a numeric one');
  // The sub-list must be a real nested <list type="ul">, not a sibling <li class="level-1">.
  assert.match(xml2, /<list type="ol">[\s\S]*<li>Mix the ingredients\.[\s\S]*<list type="ul">[\s\S]*<\/list>[\s\S]*<\/li>[\s\S]*<\/list>/);
  assert.ok(!xml2.includes('level-1'), 'no flat class="level-1" fallback');
});

test('bullets three levels deep nest as real <list> elements', () => {
  const xml = wrap(`
    <list type="ul">
      <li>Fruits
        <list type="ul">
          <li>Citrus
            <list type="ul">
              <li>Orange</li>
              <li>Lemon</li>
            </list>
          </li>
          <li>Berries</li>
        </list>
      </li>
      <li>Vegetables</li>
    </list>`);
  const { doc1, xml2 } = assertListsRoundTrip(xml, 'bullets-3-deep');
  const items = getListBlocks(doc1)[0].items;
  assert.deepEqual(items.map((it) => it.level || 0), [0, 1, 2, 2, 1, 0]);
  assert.equal((xml2.match(/<list type="ul">/g) || []).length, 3, 'three nested <list type="ul"> elements');
});

test('lettered sub-list (a, b, c) round-trips through enum="a"', () => {
  const xml = wrap(`
    <list type="ol">
      <li>1. Question one
        <list type="ol" enum="a">
          <li>a. Option one</li>
          <li>b. Option two</li>
          <li>c. Option three</li>
        </list>
      </li>
      <li>2. Question two</li>
    </list>`);
  const { doc1, xml2 } = assertListsRoundTrip(xml, 'lettered-sub-list');
  const items = getListBlocks(doc1)[0].items;
  assert.deepEqual(items.filter((it) => it.level === 1).map((it) => it.marker), ['a.', 'b.', 'c.']);
  assert.match(xml2, /<list type="ol" enum="a">/);
  // A clean run is implicit numbering, not literal marker text in the item.
  assert.ok(!xml2.includes('>a. Option one'), 'marker text is not duplicated in the item body');
});

test('roman-numeral sub-list (i, ii) round-trips through enum="i"', () => {
  const xml = wrap(`
    <list type="ol">
      <li>1. Step one
        <list type="ol" enum="i">
          <li>i. Detail one</li>
          <li>ii. Detail two</li>
        </list>
      </li>
    </list>`);
  const { doc1, xml2 } = assertListsRoundTrip(xml, 'roman-sub-list');
  const items = getListBlocks(doc1)[0].items;
  assert.deepEqual(items.filter((it) => it.level === 1).map((it) => it.marker), ['i.', 'ii.']);
  assert.match(xml2, /<list type="ol" enum="i">/);
});

test('a list whose numbering starts at 4 keeps start="4" on reload', () => {
  const xml = wrap(`
    <list type="ol" start="4">
      <li>4. Fourth item</li>
      <li>5. Fifth item</li>
    </list>`);
  const { doc1, xml2 } = assertListsRoundTrip(xml, 'start-at-4');
  const items = getListBlocks(doc1)[0].items;
  assert.deepEqual(items.map((it) => it.marker), ['4.', '5.']);
  assert.match(xml2, /<list type="ol" start="4">/);
});

test('a jump of two levels still nests, with an explicit level override', () => {
  const xml = wrap(`
    <list type="ul">
      <li>Top item
        <list type="ul">
          <li level="2">Deeply nested item</li>
        </list>
      </li>
    </list>`);
  const { doc1, xml2 } = assertListsRoundTrip(xml, 'two-level-jump');
  const items = getListBlocks(doc1)[0].items;
  assert.deepEqual(items.map((it) => it.level || 0), [0, 2]);
  // DTBook's <li> has no @level attribute, so the jump is recorded as class="level-2".
  assert.match(xml2, /<li class="level-2">Deeply nested item<\/li>/);
});

test('contents (toc) entries with pages and nested sub-entries round-trip', () => {
  const xml = wrap(`
    <list type="pl" class="toc">
      <li class="bai-toc-entry"><lic class="bai-toc-text">Chapter 1</lic><lic class="bai-toc-page">1</lic></li>
      <li class="bai-toc-entry" level="1"><lic class="bai-toc-text">Section 1.1</lic><lic class="bai-toc-page">3</lic></li>
      <li class="bai-toc-entry" level="1"><lic class="bai-toc-text">Section 1.2</lic><lic class="bai-toc-page">5</lic></li>
      <li class="bai-toc-entry"><lic class="bai-toc-text">Chapter 2</lic><lic class="bai-toc-page">10</lic></li>
    </list>`);
  const { doc1 } = assertListsRoundTrip(xml, 'toc-with-sub-entries');
  const list = getListBlocks(doc1)[0];
  assert.equal(list.kind, 'toc');
  assert.deepEqual(list.items.map((it) => [it.level || 0, it.page]), [[0, '1'], [1, '3'], [1, '5'], [0, '10']]);
});

test('an index with sub-entries round-trips', () => {
  const xml = wrap(`
    <list type="pl" class="bai-index">
      <li class="bai-index">Aerodynamics, 1-5</li>
      <li class="bai-index" level="1">boundary layer, 3</li>
      <li class="bai-index">Biology, 20</li>
    </list>`);
  const { doc1 } = assertListsRoundTrip(xml, 'index-with-sub-entries');
  const list = getListBlocks(doc1)[0];
  assert.equal(list.kind, 'index');
  assert.deepEqual(list.items.map((it) => it.level || 0), [0, 1, 0]);
});

test('file_0043 corpus file: every list survives a save/reload round trip', () => {
  const file = path.join(__dirname, '..', 'web', 'test_corpus_1000', 'file_0043_MathML_Sample2-copy.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const doc1 = parseNimasXml(xml);
  const xml2 = exportToNimasXml(doc1);
  const doc2 = parseNimasXml(xml2);
  const lists1 = getListBlocks(doc1);
  const lists2 = getListBlocks(doc2);
  assert.equal(lists2.length, lists1.length, 'same number of list blocks');
  assert.ok(lists1.length > 0, 'file_0043 has list blocks');
  let mismatches = 0;
  for (let i = 0; i < lists1.length; i++) {
    try {
      assert.deepEqual(normItems(lists2[i].items), normItems(lists1[i].items));
    } catch {
      mismatches++;
      console.error(`  list ${i} mismatch:`, JSON.stringify(normItems(lists1[i].items)), 'vs', JSON.stringify(normItems(lists2[i].items)));
    }
  }
  assert.equal(mismatches, 0, `${mismatches} of ${lists1.length} list blocks lost items/levels/markers on reload`);
});
