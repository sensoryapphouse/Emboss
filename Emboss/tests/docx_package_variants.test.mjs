// Word files that came in completely empty (import fix list #1, 30 Sep 2026): Strict Open XML (Word's "Strict Open XML
// Document" save type — purl.oclc.org namespaces and measurements with units) and a main document part not called
// word/document.xml. Each variant (tests/fixtures/docx-packages/, made by make-docx-package-variants.py from the
// import-audit fixtures) must read exactly like the ordinary file it was made from. Also Pandoc's own Strict test file
// (references/pandoc-src/test/command/7691.docx) when the reference clone is present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDocx } from '../input/parse.mjs';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAR = path.join(HERE, 'fixtures', 'docx-packages');
const SRC = path.join(HERE, 'fixtures', 'import-audit', 'docx');
const ab = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const read = async (f) => JSON.stringify((await parseDocx(ab(f))).blocks);
const ORIGINAL = { w00: 'w00-paul-test-word-doc-2.docx', w08: 'w08-lists.docx', w12: 'w12-tables.docx', w02: 'w02-inline.docx' };

for (const [key, src] of Object.entries(ORIGINAL)) {
  test(`${src}: the Strict Open XML copy reads exactly like the original`, async () => {
    const want = await read(path.join(SRC, src));
    assert.ok(want.length > 100, 'the original has content');
    assert.equal(await read(path.join(VAR, `strict-${key}.docx`)), want);
  });
  test(`${src}: the copy with a renamed main part reads exactly like the original`, async () => {
    assert.equal(await read(path.join(VAR, `renamed-${key}.docx`)), await read(path.join(SRC, src)));
  });
}

const PANDOC_7691 = path.join(HERE, '..', '..', 'references', 'pandoc-src', 'test', 'command', '7691.docx');
test("Pandoc's Strict test file (7691) is not empty", { skip: !fs.existsSync(PANDOC_7691) }, async () => {
  assert.match(await read(PANDOC_7691), /Some text/);
});
