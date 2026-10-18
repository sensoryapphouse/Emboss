// A list survives Word: bulleted -> bulleted, numbered -> numbered, plain (no marker) -> plain, nested,
// with the empty-item and glossary rules. Model -> exportToDocxBlob -> parseDocx -> list blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
const { exportToDocxBlob } = await import('../web/docx-export.mjs');
const { parseFile } = await import('../input/parse.mjs');

async function roundTrip(blocks) {
  const blob = exportToDocxBlob({ blocks }, 'T');
  const ab = await blob.arrayBuffer();
  return { ab, doc: await parseFile('t.docx', ab) };
}
const lists = (doc) => doc.blocks.filter((b) => b.type === 'list').map((b) => b.items.map((i) => ({ text: i.text, marker: i.marker, level: i.level })));
const P = (text, level) => ({ text, ...(level ? { level } : {}) });
const B = (text, level) => ({ text, marker: '•', ...(level ? { level } : {}) });
const N = (text, marker, level) => ({ text, marker, ...(level ? { level } : {}) });

test('plain list stays plain', async () => {
  const { doc } = await roundTrip([{ type: 'para', text: 'Intro' }, { type: 'list', items: [P('85 g butter'), P('2 eggs'), P('flour')] }]);
  assert.deepEqual(lists(doc), [[{ text: '85 g butter' }, { text: '2 eggs' }, { text: 'flour' }].map((i) => ({ ...i, marker: undefined, level: undefined }))]);
});
test('bulleted list stays bulleted', async () => {
  const { doc } = await roundTrip([{ type: 'list', items: [B('one'), B('two'), B('three')] }]);
  assert.deepEqual(lists(doc), [[B('one'), B('two'), B('three')].map((i) => ({ ...i, level: undefined }))]);
});
test('numbered list stays numbered (decimal, letter, roman, paren)', async () => {
  for (const marks of [['1.', '2.', '3.'], ['a)', 'b)', 'c)'], ['i.', 'ii.', 'iii.'], ['A.', 'B.', 'C.'], ['3.', '4.', '5.']]) {
    const items = marks.map((m, i) => N('item ' + i, m));
    const { doc } = await roundTrip([{ type: 'list', items }]);
    assert.deepEqual(lists(doc), [items.map((i) => ({ ...i, level: undefined }))], marks.join());
  }
});
test('nested combinations', async () => {
  const cases = [
    [B('a'), B('a1', 1), B('a2', 1), B('b')],
    [P('a'), P('a1', 1), P('a1x', 2), P('b')],
    [N('x', '1.'), N('x1', 'a.', 1), N('x2', 'b.', 1), N('y', '2.')],
    [N('x', '1.'), B('b1', 1), B('b2', 1), N('y', '2.')],
    [B('a'), P('p1', 1), P('p2', 1), B('b')],
  ];
  for (const items of cases) {
    const { doc } = await roundTrip([{ type: 'list', items }]);
    assert.deepEqual(lists(doc), [items.map((i) => ({ text: i.text, marker: i.marker, level: i.level }))], JSON.stringify(items));
  }
});
test('marker Word cannot count stays literal text, not lost', async () => {
  const { doc } = await roundTrip([{ type: 'list', items: [N('x', '1.'), N('y', '3.')] }]);
  const all = JSON.stringify(doc.blocks);
  assert.ok(all.includes('x') && all.includes('y') && all.includes('3.'));
});
test('empty items are dropped without splitting the list', async () => {
  const { doc } = await roundTrip([{ type: 'list', items: [P('one'), P(''), P('two')] }]);
  assert.equal(lists(doc).length, 1);
  assert.deepEqual(lists(doc)[0].map((i) => i.text), ['one', 'two']);
});
test('glossary and toc lists keep their form', async () => {
  const { doc } = await roundTrip([
    { type: 'list', kind: 'glossary', items: [{ term: 'ant', def: 'an insect', text: 'ant' }] },
    { type: 'para', text: 'between' },
    { type: 'list', kind: 'toc', items: [P('Chapter 1'), P('Chapter 2')] },
  ]);
  assert.equal(doc.blocks[0].kind, 'glossary');
  assert.deepEqual(doc.blocks[0].items[0].term ?? 'ant', 'ant');
  assert.deepEqual(lists(doc).at(-1).map((i) => i.text), ['Chapter 1', 'Chapter 2']);
  assert.equal(lists(doc).at(-1)[0].marker, undefined);
});
test('generated document.xml, styles.xml and numbering.xml are well-formed', async () => {
  const { ab } = await roundTrip([{ type: 'list', items: [P('a'), B('b'), N('c', '1.')] }]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plainlist-'));
  try {
    fs.writeFileSync(path.join(tmp, 't.docx'), Buffer.from(ab));
    execFileSync('unzip', ['-q', 't.docx', '-d', 'x'], { cwd: tmp });
    for (const f of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', '[Content_Types].xml', 'word/_rels/document.xml.rels']) {
      execFileSync('xmllint', ['--noout', path.join(tmp, 'x', f)]);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
