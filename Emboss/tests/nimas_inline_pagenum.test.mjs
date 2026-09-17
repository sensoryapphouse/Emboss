// Print page turns (<pagenum>) inside running text — DTBook allows them inside <p>, <h2>,
// <li>, <td>… The parser must lift them out as pagenum blocks (never glue "xxix" into the
// text), split paragraphs around them so the formatter resumes in cell 1 (BANA §1.11.3,
// B004 §8), and the exporter must rejoin the split paragraph into one <p>.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const here = path.dirname(fileURLToPath(import.meta.url));

const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
${body}
</level1></bodymatter></book></dtbook>`;

const types = (blocks) => blocks.map((b) => b.type);
const allBlocks = (blocks) => blocks.flatMap((b) => (b && b.type === 'box' && Array.isArray(b.blocks) ? [b, ...allBlocks(b.blocks)] : [b]));
const pagenums = (blocks) => allBlocks(blocks).filter((b) => b && b.type === 'pagenum');
const upper = (s) => String(s).toUpperCase();

test('pagenum inside a paragraph splits it; text resumes in cell 1; export rejoins one <p>', () => {
  const doc = parseDtbook(wrap('<h1>Ch</h1><p>Before the turn, <pagenum id="p12" page="normal">12</pagenum>after the turn.</p>'));
  assert.deepEqual(types(doc.blocks), ['heading', 'para', 'pagenum', 'para']);
  const [, a, pn, b] = doc.blocks;
  assert.equal(a.text, 'Before the turn,');
  assert.equal(a.continued, true);
  assert.deepEqual(pn, { type: 'pagenum', text: '12', page: '12', id: 'p12', pageType: 'normal' });
  assert.equal(b.text, 'after the turn.');
  assert.equal(b.continuation, true);
  assert.ok(!doc.blocks.some((blk) => /12after|,12/.test(blk.text || '')), 'page number must not be glued into text');

  // Formatter: the continuation starts at cell 1 (no paragraph indent) in both modes.
  for (const mode of ['bana', 'ukaaf']) {
    const brf = String(formatDocument(doc, { mode, width: 40, depth: 25, translate: upper }));
    const lines = brf.split(/\r?\n/);
    const idx = lines.findIndex((l) => l.startsWith('AFTER THE TURN.'));
    assert.ok(idx > 0, `${mode}: continuation line should start in cell 1, got:\n${brf}`);
    assert.ok(lines[idx - 1].includes('12') || lines[idx - 1].includes('#'), `${mode}: page change indicator precedes the continuation`);
  }

  // Exporter: one <p> with the <pagenum> inline, and the round trip reproduces the split.
  const xml = exportToNimasXml(doc);
  assert.match(xml, /<p>Before the turn, <pagenum id="p12" page="normal">12<\/pagenum> after the turn\.<\/p>/);
  assert.equal((xml.match(/<p[ >]/g) || []).length, 1, 'exactly one <p>');
  const again = parseDtbook(xml);
  assert.deepEqual(types(again.blocks), ['heading', 'para', 'pagenum', 'para']);
  assert.equal(again.blocks[1].continued, true);
  assert.equal(again.blocks[3].continuation, true);
});

test('pagenum with emphasis on both sides keeps segments and typeforms', () => {
  const doc = parseDtbook(wrap('<p><em>Alpha</em> beta <pagenum id="p2" page="normal">2</pagenum>gamma <strong>delta</strong></p>'));
  assert.deepEqual(types(doc.blocks), ['para', 'pagenum', 'para']);
  assert.ok(doc.blocks[0].segments.some((s) => s.tf), 'first piece keeps italic');
  assert.ok(doc.blocks[2].segments.some((s) => s.tf), 'second piece keeps bold');
  const xml = exportToNimasXml(doc);
  assert.match(xml, /<p><em>Alpha<\/em> beta <pagenum id="p2" page="normal">2<\/pagenum> gamma <strong>delta<\/strong><\/p>/);
});

test('pagenum inside a heading is hoisted: leading → before, otherwise after; heading text stays clean', () => {
  const lead = parseDtbook(wrap('<h2><pagenum id="p5" page="normal">5</pagenum>Chapter Five</h2><p>x</p>'));
  assert.deepEqual(types(lead.blocks), ['pagenum', 'heading', 'para']);
  assert.equal(lead.blocks[1].text, 'Chapter Five');
  const trail = parseDtbook(wrap('<h2>Chapter Six<pagenum id="p6" page="normal">6</pagenum></h2><p>x</p>'));
  assert.deepEqual(types(trail.blocks), ['heading', 'pagenum', 'para']);
  assert.equal(trail.blocks[0].text, 'Chapter Six');
});

test('pagenum inside a list item splits the list around the item', () => {
  const doc = parseDtbook(wrap(`<list type="ol">
    <li>One</li>
    <li>Two <pagenum id="p9" page="normal">9</pagenum></li>
    <li>Three</li>
  </list>`));
  assert.deepEqual(types(doc.blocks), ['list', 'pagenum', 'list']);
  assert.deepEqual(doc.blocks[0].items.map((i) => i.text), ['One', 'Two']);
  assert.deepEqual(doc.blocks[2].items.map((i) => i.text), ['Three']);
  assert.ok(doc.blocks[0].ordered && doc.blocks[2].ordered);
});

test('pagenum inside a nested list item is handed up to the parent list', () => {
  const doc = parseDtbook(wrap(`<list type="ul">
    <li>Top<list type="ul"><li>Sub A</li><li><pagenum id="p3" page="normal">3</pagenum>Sub B</li></list></li>
    <li>Last</li>
  </list>`));
  assert.deepEqual(types(doc.blocks), ['list', 'pagenum', 'list']);
  assert.deepEqual(doc.blocks[0].items.map((i) => i.text), ['Top', 'Sub A']);
  assert.deepEqual(doc.blocks[2].items.map((i) => i.text), ['Sub B', 'Last']);
});

test('pagenum inside a table cell is placed after the table; cell text stays clean', () => {
  const doc = parseDtbook(wrap(`<table><thead><tr><th>H1</th><th>H2</th></tr></thead>
    <tbody><tr><td>a</td><td>b<pagenum id="p7" page="normal">7</pagenum></td></tr></tbody></table>`));
  assert.deepEqual(types(doc.blocks), ['table', 'pagenum']);
  assert.deepEqual(doc.blocks[0].rows, [['a', 'b']]);
});

test('pagenum inside a sidebar paragraph and a poem line', () => {
  const doc = parseDtbook(wrap(`<sidebar render="required"><hd>Box</hd><p>In box <pagenum id="p20" page="normal">20</pagenum>still in box</p></sidebar>
    <poem><linegroup><line>First line</line><line><pagenum id="p21" page="normal">21</pagenum>Second line</line></linegroup></poem>`));
  const box = doc.blocks.find((b) => b.type === 'box');
  assert.deepEqual(types(box.blocks), ['heading', 'para', 'pagenum', 'para']);
  assert.equal(box.blocks[1].continued, true);
  const poemTypes = types(doc.blocks.filter((b) => b.type !== 'box'));
  assert.deepEqual(poemTypes, ['play', 'pagenum', 'play']);
  assert.equal(doc.blocks.filter((b) => b.type === 'play')[1].text, 'Second line');
});

test('empty <pagenum/> takes its number from the id; @page type is preserved', () => {
  const doc = parseDtbook(wrap('<pagenum id="page_45" page="normal"/><p>a</p><pagenum id="p-xiv" page="front">xiv</pagenum><p>b</p><pagenum id="s1" page="special">A-1</pagenum><p>c</p>'));
  const pns = pagenums(doc.blocks);
  assert.deepEqual(pns.map((p) => [p.text, p.pageType]), [['45', 'normal'], ['xiv', 'front'], ['A-1', 'special']]);
  const xml = exportToNimasXml(doc);
  assert.match(xml, /<pagenum id="p-xiv" page="front">xiv<\/pagenum>/);
  assert.match(xml, /page="special">A-1</);
});

test('real textbooks: every source <pagenum> reaches the model and none is glued into text', () => {
  const samples = [
    path.join(here, 'nimas_samples', '9781946636171NIMAS.xml'),
    path.join(here, '..', 'web', 'large-nimas.xml'),
  ].filter((f) => fs.existsSync(f));
  assert.ok(samples.length, 'sample textbooks present');
  for (const file of samples) {
    const xml = fs.readFileSync(file, 'utf8');
    const src = new DOMParser().parseFromString(xml, 'text/xml');
    const srcPns = [...src.getElementsByTagName('pagenum')];
    const doc = parseDtbook(xml);
    const modelPns = pagenums(doc.blocks);
    assert.equal(modelPns.length, srcPns.length, `${path.basename(file)}: all ${srcPns.length} page turns should be in the model (got ${modelPns.length})`);
    // No block text may contain the page value glued to the words that surround it in the
    // source ("know, xxixtake"): take the word before and after each inline pagenum.
    const texts = allBlocks(doc.blocks).filter((b) => b.type !== 'pagenum').flatMap((b) => [b.text, ...(b.items || []).map((i) => i.text)]).filter(Boolean);
    const sideText = (node, dir) => {
      let s = '';
      for (let n = node[dir]; n && s.replace(/\s+/g, '').length < 12; n = n[dir]) s = dir === 'previousSibling' ? (n.textContent || '') + s : s + (n.textContent || '');
      return s;
    };
    let checked = 0;
    for (const p of srcPns) {
      const v = (p.textContent || '').trim();
      const before = sideText(p, 'previousSibling').match(/(\S+)\s*$/);
      const after = sideText(p, 'nextSibling').match(/^\s*(\S+)/);
      if (!v || !before || !after) continue;                  // block-level pagenum, nothing to glue to
      const glued = before[1] + v + after[1];
      assert.ok(!texts.some((t) => t.includes(glued)), `${path.basename(file)}: "${glued}" — page number glued into text`);
      checked++;
    }
    assert.ok(checked > 0, `${path.basename(file)}: expected some inline page turns to check`);
  }
});
