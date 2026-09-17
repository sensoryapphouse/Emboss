// nextPrintPage (web/editor/editor.mjs): the number given to a newly inserted print page is
// the page *before the insertion point* + 1 (G14). editor.mjs cannot be imported headless
// (it mounts the editor at load), so the helper's source is extracted and evaluated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
const start = src.indexOf('const ROMAN = [');
const end = src.indexOf('function insertPrintPage(');
assert.ok(start > 0 && end > start, 'helper block found in editor.mjs');
const block = src.slice(start, end).replace('export function nextPrintPage', 'function nextPrintPage');
const nextPrintPage = new Function(`${block}; return nextPrintPage;`)();

test('arabic numbers increment, keeping prefixes and zero padding', () => {
  assert.equal(nextPrintPage('95'), '96');
  assert.equal(nextPrintPage('9'), '10');
  assert.equal(nextPrintPage('R64'), 'R65');
  assert.equal(nextPrintPage('A-9'), 'A-10');
  assert.equal(nextPrintPage('007'), '008');
  assert.equal(nextPrintPage(' 12 '), '13');
});

test('roman numerals stay roman, in the same case', () => {
  assert.equal(nextPrintPage('xiv'), 'xv');
  assert.equal(nextPrintPage('iv'), 'v');
  assert.equal(nextPrintPage('viii'), 'ix');
  assert.equal(nextPrintPage('XIX'), 'XX');
  assert.equal(nextPrintPage('xxxix'), 'xl');
});

test('single letters advance; anything else gives an empty string', () => {
  assert.equal(nextPrintPage('a'), 'b');
  assert.equal(nextPrintPage('B'), 'C');
  assert.equal(nextPrintPage('z'), '');
  assert.equal(nextPrintPage(''), '');
  assert.equal(nextPrintPage('Cover'), '');
});

test('insertPrintPage numbers from the page before the cursor, not the last page in the document', () => {
  const fn = src.slice(end, src.indexOf('window.insertPrintPage = insertPrintPage;'));
  assert.match(fn, /previous = node\.getPage\(\)/);
  assert.match(fn, /node\.is\(stopAt\)\) break/);
  assert.match(fn, /nextPrintPage\(previous\)/);
});
