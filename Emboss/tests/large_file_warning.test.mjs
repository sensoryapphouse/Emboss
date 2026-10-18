// A89 / A90 (Paul, 2 Oct: "I would like to avoid a crash if [a very large book] is found — this is a precaution"): a book big
// enough to run a browser tab out of memory (measured: a 10 MB book brailles at ~1.2 GB, a 60 MB one needs ~5 GB) is not opened
// silently. Above 20 MB for a text format (NIMAS XML, HTML, Markdown, text, RTF), or 100 MB for a packaged one (Word, ODT, EPUB, a
// zipped NIMAS book — pictures make those big without adding braille), Emboss asks first. Real books are 1–5 MB of text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { largeFileWarning, LARGE_TEXT_FILE_BYTES, LARGE_PACKAGE_FILE_BYTES } from '../web/settings.mjs';

const MB = 1024 * 1024;
test('the limits', () => {
  assert.equal(LARGE_TEXT_FILE_BYTES, 20 * MB);
  assert.equal(LARGE_PACKAGE_FILE_BYTES, 100 * MB);
});
test('text formats: asked above 20 MB', () => {
  for (const name of ['book.xml', 'book.html', 'book.htm', 'book.md', 'book.txt', 'book.rtf', 'book.xhtml', 'book.dtbook']) {
    assert.equal(largeFileWarning(name, 19 * MB), null, name);
    const w = largeFileWarning(name, 21 * MB);
    assert.ok(w && w.mb === 21, name);
  }
});
test('packaged formats: asked above 100 MB, not at 50 MB', () => {
  for (const name of ['book.docx', 'book.odt', 'book.epub', 'book.zip', 'book.doc', 'BOOK.EPUB']) {
    assert.equal(largeFileWarning(name, 50 * MB), null, name);
    assert.ok(largeFileWarning(name, 120 * MB), name);
  }
});
test('a real-sized book and an unknown size are never questioned', () => {
  assert.equal(largeFileWarning('large-nimas.xml', 1.4 * MB), null);
  assert.equal(largeFileWarning('x.xml', undefined), null);
});
