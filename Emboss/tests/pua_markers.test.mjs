// Sub/superscript markers (private-use U+E000..U+E002, format/text-style.mjs SCRIPT_MARKS) must never reach
// liblouis: they were skipped when a typeform was passed, so "M<sup>r.</sup>" showed as full cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { styledTranslate, SCRIPT_MARKS } from '../format/text-style.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));

const seen = [];
const spy = (table) => (t, tf) => { if (/[-]/.test(t)) seen.push(t); return louis.translate(t, table, tf || null); };
const OPTS = () => ({
  mode: 'bana', standard: 'bana', width: 40, depth: 25, suppressHeader: true,
  translate: styledTranslate(spy(louis.TABLES.uebG2)),
  translateG1: styledTranslate(spy(louis.TABLES.uebG1)),
});
const fmt = (html) => { seen.length = 0; return formatDocument(parseHtml(html), OPTS()); };

test('superscript in plain text: markers resolved before translation', () => {
  const brf = fmt('<p>Mr. &amp; Mrs. Bennet and M<sup>r.</sup> &amp; M<sup>rs.</sup> Long</p>');
  assert.equal(seen.length, 0, seen.join('|'));
  assert.ok(!/[-]/.test(brf));
  assert.ok(brf.includes(';9'), brf);
});

test('superscript inside emphasised (typeform) text: markers resolved too', () => {
  const brf = fmt('<p>Plain <em>see M<sup>rs.</sup> Long</em> and <b>x<sub>2</sub></b> end</p>');
  assert.equal(seen.length, 0, seen.join('|'));
  assert.ok(brf.includes(';9') && brf.includes(';5'), brf);
});

test('styledTranslate with a per-character typeform array keeps emphasis aligned across a marker', () => {
  const { supOpen, end } = SCRIPT_MARKS;
  const calls = [];
  const tr = styledTranslate((t, tf) => { calls.push([t, tf]); return t; });
  const text = 'ab' + supOpen + 'cd' + end + 'ef';
  const out = tr(text, [1, 1, 1, 1, 1, 1, 0, 0]);
  // A86 (RUEB 3.24.1, 5.6, 6.5): a chunk touching a script is translated with a stand-in "²" beside it (so its letters are
  // not "standing alone") and that context's braille is cut off again; the context character carries typeform 0, so
  // every chunk's own characters keep their emphasis (was: [['ab', [1, 1]], ['cd', [1, 1]], ['ef', [0, 0]]]).
  assert.deepEqual(calls, [['²', undefined], ['ab²', [1, 1, 0]], ['²cd', [0, 1, 1]], ['²ef', [0, 0, 0]]]);
  assert.equal(out, 'ab;9<cd>ef');                  // "cd" is not one item: grouping signs (RUEB 11.4.1; no grade-1 translator given)
});
