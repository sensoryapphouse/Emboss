// Found 1 Oct 2026 (merging import fix list #4): in UKAAF the print page number shown top left (B004 §6/§7 good practice) is read
// from the page's print-page-turn lines ('"3' + the page number, B004 §8). A table's column separation line ('"' + dots 25,
// BANA 11.4.2b) that runs unbroken — the line under a two-tier heading group (§11.4.3), or a one-column table's — has the same
// '"3…' shape, so its 3s were taken for a page number: the page's top line showed "3333333…" instead of the running title. UK-6
// already set aside the end markers (ten 3s or ten 1s); a real page number is a translated number or letters, never a run of
// only 3s (colons) or only 1s (commas), so any such run is set aside now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const doc = {
  title: 'Audit Tables',
  blocks: [
    { type: 'para', text: 'Before the page turn.' },
    { type: 'pagenum', page: '7' },
    { type: 'para', text: 'After the page turn, before the table.' },
    { type: 'table', headers: ['Sub one', 'Sub two'], headerGroups: [{ text: 'Group', from: 0, to: 1 }], rows: [['x1', 'x2']] },
    { type: 'table', headers: ['Only column'], rows: [['one'], ['two']] },
  ],
};

test('UKAAF: a table separator line is not read as a print page number; a real page turn still is', () => {
  const pages = formatDocument(structuredClone(doc), { mode: 'ukaaf', width: 38, depth: 27, translate: up }).split('\f').map((p) => p.split(/\r?\n/));
  const tops = pages.map((p) => p[0]);
  assert.ok(!tops.some((l) => /3{5,}/.test(l)), JSON.stringify(tops));
  assert.match(tops[0], /^7\s/, 'the real page turn ("37) is the print page number shown top left');
  assert.ok(pages.flat().some((l) => /^\s*"3{12,}\s*$/.test(l)), 'the separator line is still in the braille');
});
