// <cite>/<author> inside running text are inline: no space may be added before the
// following punctuation ("…Romance of Science ." → "…Romance of Science."; A27c). As
// direct children of a blockquote they are still separate attribution lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';

globalThis.DOMParser = DOMParser;
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);

test('a cite inside a note paragraph keeps the full stop tight', () => {
  const d = doc(`<note id="n1"><p>1. From <cite>Broca's Brain: Reflections</cite>.</p></note>`);
  const note = d.blocks.find((b) => /Broca/.test(b.text || ''));
  assert.equal(note.text, "1. From Broca's Brain: Reflections.");
});

test('a cite directly inside a blockquote is still its own attribution line', () => {
  const d = doc(`<blockquote><p>Science is a way of thinking.</p><cite>Carl Sagan</cite></blockquote>`);
  assert.ok(d.blocks.some((b) => b.type === 'attribution' && /Carl Sagan/.test(b.text)), JSON.stringify(d.blocks));
});
