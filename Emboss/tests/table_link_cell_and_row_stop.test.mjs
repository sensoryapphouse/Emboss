// A61 and A62, Paul's decisions of 26 Sep 2026.
//
// A61: a table cell whose whole content is a link keeps the hyperlink indicator in every table
//      format (LINK-1, 25 Sep: imported hyperlinks get the first transcriber-defined typeform,
//      `@#7`...`@#'`). Columnar tables treated a one-run cell as plain text and dropped it.
// A62: paragraph-form tables (B004 §12, the UKAAF fallback) end each row with a full stop,
//      but not when the row's last entry already ends with . ? or ! (a doubled stop, `44`).
// Both layout paths (formatBlock and traceBlock) are checked, as in layout_parity_fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const translate = (t, tf) => louis.translate(t, T, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
// UK-6 (28 Sep, James / decisions.md "UKAAF"): tableEndMarker defaults true, adding a dot-2s line
// after the table that `rowLine`'s "last non-empty line" pick would otherwise catch instead of the
// row itself — turned off here since this file pins row-stop punctuation, not end markers.
const opts = (mode) => ({ mode, standard: mode, width: 40, depth: 25, paragraphStyle: 'indented', tableFormat: 'auto', listStyle: 'spaced', toc: true, translate, translatePos, tableEndMarker: false });

function bothPaths(block, o) {
  const real = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false);
  assert.deepEqual(traced.map((t) => t.s), [...real], `${o.mode}: formatBlock vs traceBlock lines`);
  return real.join('\n');
}

const linkOnly = { text: 'the width', segments: [{ type: 'text', text: 'the width', href: 'https://example.org/b', hyperlink: true }] };
const linkTable = (format) => ({ type: 'table', format, headers: ['Name', 'See'], rows: [['A', linkOnly], ['B', 'plain']] });

test('A61: a link-only cell keeps the hyperlink indicator in every table format (both modes)', () => {
  for (const mode of ['bana', 'ukaaf']) {
    for (const format of ['columnar', 'listed', 'paragraph', 'auto']) {
      const text = bothPaths(linkTable(format), opts(mode));
      assert.ok(text.includes("@#7! WID?@#'"), `${mode}/${format}: link-only cell wrapped in the indicator\n${text}`);
    }
  }
});

const stopTable = (last) => ({ type: 'table', format: 'paragraph', headers: ['Item', 'Price'], rows: [['Tea', last]] });

// The row line: paragraph form puts each row on its own paragraph, the last non-empty line here.
const rowLine = (text) => text.split('\n').filter(Boolean).pop();

test('A62: paragraph form adds the row-ending full stop only when the last entry lacks one (both modes)', () => {
  for (const mode of ['bana', 'ukaaf']) {
    const plain = rowLine(bothPaths(stopTable('US$44'), opts(mode)));
    assert.ok(plain.endsWith('#DD4'), `${mode}: a stop is added after "US$44": ${plain}`);
    const stopped = rowLine(bothPaths(stopTable('Sold out.'), opts(mode)));
    assert.ok(stopped.endsWith('\\4') && !stopped.endsWith('44'), `${mode}: one stop after "Sold out.": ${stopped}`);
    const question = rowLine(bothPaths(stopTable('Why?'), opts(mode)));
    assert.ok(question.endsWith('8'), `${mode}: no stop after "Why?": ${question}`);
    const quoted = rowLine(bothPaths(stopTable('It said "Done."'), opts(mode)));
    assert.ok(quoted.endsWith('40'), `${mode}: no stop after a closing quote that follows a stop: ${quoted}`);
  }
});
