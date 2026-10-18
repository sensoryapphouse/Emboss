// Overnight question 4, import fix list #47 (Paul, 1 Oct 2026: go with the recommendation): the text inside an HTML <video> or
// <audio> is the browser's fallback ("Your browser does not support the video tag"), shown only when the player cannot be; it is
// not print content and is no longer transcribed. The fallback inside <object>, <canvas> or <iframe> can be real content (a
// description, a transcript, alternative text) and is kept, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
const { parseFile } = await import('../input/parse.mjs');

const html = (body) => `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;
const text = (m) => JSON.stringify(m.blocks);

test('<video> and <audio> fallback text is left out', async () => {
  const m = await parseFile('a.html', html('<p>Before.</p><video controls src="a.mp4">Your browser does not support the video tag.</video><audio controls><source src="a.mp3"/>No audio support here.</audio><p>After.</p>'));
  assert.doesNotMatch(text(m), /does not support|No audio support/);
  assert.match(text(m), /Before\./);
  assert.match(text(m), /After\./);
});

test('the same inside a paragraph, with the paragraph\'s own words kept', async () => {
  const m = await parseFile('a.html', html('<p>Watch this: <video controls>fallback words</video> then read on.</p>'));
  assert.doesNotMatch(text(m), /fallback words/);
  assert.match(text(m), /Watch this:/);
  assert.match(text(m), /then read on\./);
});

test('<object> and <canvas> fallback is still transcribed (it can be real content)', async () => {
  const m = await parseFile('a.html', html('<p><canvas>A chart of rainfall by month.</canvas> <object data="x.pdf">The full report as a PDF.</object></p>'));
  assert.match(text(m), /A chart of rainfall by month\./);
  assert.match(text(m), /The full report as a PDF\./);
});
