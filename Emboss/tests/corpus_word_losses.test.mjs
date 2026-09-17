// Content losses found by the word-by-word check in scripts/run_1000_corpus_benchmark.mjs (A28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;
const wrap = (front, body) => `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><frontmatter>${front}</frontmatter><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`;
const all = (d) => JSON.stringify(d);

test('a title with line breaks keeps its words apart; every docauthor is kept and saved', () => {
  const d = parseDtbook(wrap('<doctitle>INTRODUCTION<br/>À<br/>L\'ÉTUDE</doctitle><docauthor>First Author</docauthor><docauthor>Second Author</docauthor>', '<p>x</p>'));
  assert.equal(d.title, "INTRODUCTION À L'ÉTUDE");
  assert.deepEqual(d.metadata.docauthors, ['First Author', 'Second Author']);
  const xml = exportToNimasXml(d);
  assert.match(xml, /<docauthor>First Author<\/docauthor>\s*<docauthor>Second Author<\/docauthor>/);
});

test('a poem keeps its dateline, epigraph, images and captions', () => {
  const d = parseDtbook(wrap('', `<poem><title>T</title><dateline>3 March 2011</dateline><epigraph>Testing epigraphs</epigraph>
    <imggroup><img src="a.jpg" alt="alt"/><caption>so many pictures</caption></imggroup><line>Ahem</line></poem>`));
  const s = all(d);
  for (const w of ['3 March 2011', 'Testing epigraphs', 'so many pictures', 'Ahem']) assert.ok(s.includes(w), w);
  assert.ok(d.blocks.some((b) => b.type === 'graphic' && b.caption === 'so many pictures'));
});

test('an inline production note is separated from the text after it', () => {
  const d = parseDtbook(wrap('', '<p>Part A <code><prodnote>note</prodnote>This is code</code> Part B</p>'));
  assert.match(d.blocks[0].text, /note This is code/);
  assert.ok(d.blocks[0].segments.some((g) => /note This/.test(g.text || '')), JSON.stringify(d.blocks[0]));
});

test('every <thead> row is kept (the first as headers, the rest leading the body)', () => {
  const d = parseDtbook(wrap('', '<table><thead><tr><th>A</th><th>B</th></tr><tr><th>Sub a</th><th>Sub b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'));
  const t = d.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers, ['A', 'B']);
  assert.deepEqual(t.rows, [['Sub a', 'Sub b'], ['1', '2']]);
});

test('a contents entry takes its own page, not a nested entry\'s ("toc-pg" is a page class)', () => {
  const d = parseDtbook(wrap('', `<list class="toc" type="pl"><li><lic class="toc-line">Chapter VI</lic><lic class="toc-pg">155</lic>
    <list type="pl"><li><lic class="toc-line">Section A</lic><lic class="toc-pg">155</lic></li><li><lic class="toc-line">Section B</lic><lic class="toc-pg">183</lic></li></list></li></list>`));
  const items = d.blocks.filter((b) => b.type === 'list').flatMap((b) => b.items);
  assert.deepEqual(items.map((i) => [i.text, i.page]), [['Chapter VI', '155'], ['Section A', '155'], ['Section B', '183']]);
});
