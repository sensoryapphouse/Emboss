// A89 (the nightly random-action run, seed 1763563818, WebKit, Quick Mode): Markdown's displayed equation ($$1$$ on a line of its
// own) was read as a paragraph holding one equation, while the editor (and the NIMAS reader) take a paragraph that is only one
// equation as displayed maths, so a trip to the Advanced editor and back changed Quick Mode's braille (the equation's margin).
// A Markdown paragraph that is only one equation is now a displayed equation, as in the editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from './helpers/nimas-braille.mjs';

test('a Markdown paragraph that is only an equation ($$…$$ or $…$) is a displayed equation', async () => {
  const m = await parseFile('d.md', 'Before.\n\n$$1$$\n\n$x^2$\n\nText with $y$ in it.\n');
  assert.deepEqual(m.blocks.map((b) => b.type), ['para', 'math', 'math', 'para'], JSON.stringify(m.blocks));
  assert.equal(m.blocks[1].latex, '1');
  assert.ok(m.blocks[3].segments.some((g) => g.type === 'math'), 'an equation in running text stays inline');
});
