import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTranscriberNotes } from '../format/document.mjs';

const o = { mode: 'bana', width: 40, translate: (t) => t };
const ids = (b, opts = o) => suggestTranscriberNotes(b, opts).map((s) => s.id);

test('nothing detected gives []', () => {
  assert.deepEqual(suggestTranscriberNotes([{ type: 'para', text: 'Hello' }], o), []);
  assert.deepEqual(suggestTranscriberNotes([], o), []);
  assert.deepEqual(suggestTranscriberNotes(null, o), []);
});
test('blocked paragraph is suggested, wording provisional', () => {
  const s = suggestTranscriberNotes([{ type: 'para', text: 'A', blocked: true }, { type: 'para', text: 'B', blocked: true }], o);
  assert.equal(s.length, 1);
  assert.equal(s[0].id, 'blocked-paragraphs');
  assert.equal(s[0].provisional, true);
  assert.equal(s[0].source, 'provisional');
  assert.match(s[0].reason, /2 paragraphs are/);
});
test('a table forced to listed format is suggested', () => {
  const t = { type: 'table', format: 'listed', headers: ['A', 'B'], rows: [['1', '2']] };
  assert.deepEqual(ids([t]), ['table-listed']);
});
test('an ordinary columnar table is not', () => {
  const t = { type: 'table', format: 'auto', headers: ['A', 'B'], rows: [['1', '2']] };
  assert.deepEqual(ids([t]), []);
});
test('omitted picture uses BANA own wording', () => {
  const s = suggestTranscriberNotes([{ type: 'graphic', alt: '' }], o);
  assert.equal(s.length, 1);
  assert.equal(s[0].id, 'picture-omitted');
  assert.equal(s[0].text, 'Illustrations without captions are omitted.');
  assert.equal(s[0].source, 'BANA');
  assert.equal(s[0].provisional, false);
  assert.deepEqual(ids([{ type: 'graphic', alt: 'A pond.' }]), []);
});
test('UKAAF line-indicator poem, typeforms, symbols, page numbers', () => {
  assert.deepEqual(ids([{ type: 'play', subtype: 'verse', segments: [{ type: 'text', text: 'x' }], poemMethod: 'line-indicator' }]), ['poem-line-indicator']);
  assert.deepEqual(ids([{ type: 'para', text: 'x', ignoreFont: true }]), ['typeforms-not-shown']);
  assert.deepEqual(ids([{ type: 'para', segments: [{ type: 'brl', text: '@', brl: '@' }] }]), ['special-symbols']);
  assert.deepEqual(ids([{ type: 'pagenum', page: '4', implied: true }, { type: 'pagenum', page: '5', spelled: 'five' }]), ['print-page-numbers']);
});
test('ids are stable and unique; text does not depend on counts', () => {
  const a = suggestTranscriberNotes([{ type: 'para', text: 'A', blocked: true }], o);
  const b = suggestTranscriberNotes([{ type: 'para', text: 'A', blocked: true }, { type: 'para', text: 'B', blocked: true }], o);
  assert.equal(a[0].id, b[0].id);
  assert.equal(a[0].text, b[0].text);
  const many = suggestTranscriberNotes([{ type: 'para', text: 'A', blocked: true }, { type: 'graphic' }, { type: 'para', ignoreFont: true }], o);
  assert.equal(new Set(many.map((s) => s.id)).size, many.length);
  for (const s of many) assert.ok(s.text && s.reason);
});
test('every non-BANA wording is flagged provisional', () => {
  const all = suggestTranscriberNotes([{ type: 'para', blocked: true, ignoreFont: true }, { type: 'graphic' }, { type: 'pagenum', page: '1', implied: true }], o);
  for (const s of all) assert.equal(s.provisional, s.source !== 'BANA');
});
