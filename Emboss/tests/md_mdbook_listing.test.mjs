// Overnight question 5, import fix list #53 (Paul, 1 Oct 2026: go with the recommendation): mdBook's
// <Listing number="8-1" caption="Creating a new, empty vector to hold values of type `i32`"> … </Listing> (the Rust book) was an
// unknown tag to the Markdown reader, so its caption was not shown. It is now read as a caption block after the listing's
// contents, where mdBook shows it ("Listing 8-1: …"), its Markdown (inline code) read as Markdown; the code inside is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
const { parseFile } = await import('../input/parse.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const flat = (b) => (b.segments ? b.segments.map((s) => s.text || '').join('') : b.text || '');

test('a Listing gives its code, then a caption "Listing N: caption"', async () => {
  const md = 'Before.\n\n<Listing number="8-1" caption="Creating a new, empty vector to hold values of type `i32`">\n\n```rust\nlet v: Vec<i32> = Vec::new();\n```\n\n</Listing>\n\nAfter.\n';
  const m = await parseFile('a.md', md);
  const types = m.blocks.map((b) => b.type);
  assert.deepEqual(types, ['para', 'code', 'caption', 'para'], JSON.stringify(m.blocks));
  assert.equal(flat(m.blocks[2]), 'Listing 8-1: Creating a new, empty vector to hold values of type i32');
  assert.ok((m.blocks[2].segments || []).some((s) => s.text === 'i32' && s.uncontracted), 'the inline code stays a code span (uncontracted, as in body text)');
  assert.doesNotMatch(JSON.stringify(m.blocks), /<\/?Listing|[-]/);
});

test('a Listing with a number only, entities in the caption, and a Listing inside a code fence left alone', async () => {
  const m1 = await parseFile('a.md', '<Listing number="10-3">\n\n```rust\nfn main() {}\n```\n\n</Listing>\n');
  assert.equal(flat(m1.blocks.find((b) => b.type === 'caption')), 'Listing 10-3');
  const m2 = await parseFile('a.md', '<Listing caption="Tom &amp; Jerry &quot;quoted&quot;">\n\ntext\n\n</Listing>\n');
  assert.equal(flat(m2.blocks.find((b) => b.type === 'caption')), 'Listing: Tom & Jerry "quoted"');
  const m3 = await parseFile('a.md', '```html\n<Listing number="1" caption="x">\n</Listing>\n```\n');
  assert.deepEqual(m3.blocks.map((b) => b.type), ['code']);
  assert.match(m3.blocks[0].text, /<Listing number="1" caption="x">/);
});

test('the real Rust book chapter (ch08-01) has its listing captions', async () => {
  const src = fs.readFileSync(path.join(HERE, 'real_samples', 'md', 'ch08-01-vectors.md'), 'utf8');
  const m = await parseFile('ch08-01-vectors.md', src);
  const caps = m.blocks.filter((b) => b.type === 'caption').map(flat);
  assert.ok(caps.length >= 5, caps.join(' | '));
  assert.equal(caps[0], 'Listing 8-1: Creating a new, empty vector to hold values of type i32');
});
