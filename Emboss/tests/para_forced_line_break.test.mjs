// Import fix list #58 (1 Oct 2026): a forced line break ('\n': Shift+Enter, <br>, RTF \line — Paul's IMP-W2) in a paragraph with no
// formatting must be a line break in braille, as it is in a paragraph with segments. The plain text went to liblouis whole, and
// liblouis turns a newline into a space, so in Quick Mode (and any braille made straight from a reader) the two lines ran together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument } from '../format/document.mjs';

// as liblouis: a newline in the text comes back as a space
const louisLike = (s) => String(s).toUpperCase().replace(/\n/g, ' ');
const lines = (blocks, mode) => formatDocument({ title: 'T', blocks }, { mode, width: 40, depth: 25, translate: louisLike }).split(/\r?\n/).filter((l) => /LINE/.test(l));

test('#58: a plain paragraph with a forced line break breaks the line, as the same paragraph with segments does', () => {
  for (const mode of ['bana', 'ukaaf']) {
    const plain = lines([{ type: 'para', text: 'Breaks: line one\nline two' }], mode);
    const segs = lines([{ type: 'para', segments: [{ type: 'text', text: 'Breaks: line one' }, { type: 'text', text: '\nline two' }] }], mode);
    assert.equal(plain.length, 2, `${mode}: ${JSON.stringify(plain)}`);
    assert.deepEqual(plain, segs, mode);
  }
});

test('#58: a paragraph with no line break is unchanged', () => {
  assert.deepEqual(lines([{ type: 'para', text: 'Just one line here' }], 'bana'), ['  JUST ONE LINE HERE']);
});
