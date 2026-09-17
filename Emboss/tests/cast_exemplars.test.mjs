// CAST AEM NIMAS exemplars (A29), kept locally in web/test_corpus_cast (educational use, not
// to be re-posted, so not in git): skipped when the folder is absent.
//  - "All About Coyotes" (9781930583733): images, glossary, full package (OPF + PDF).
//  - "NIMAS and MathML 3" (9780000000000).
// Glossary entries braille as "term: definition" whether or not the parts carry segments
// (BANA Formats Sample 21-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const here = path.dirname(fileURLToPath(import.meta.url));
const CAST = path.join(here, '..', 'web', 'test_corpus_cast');
const up = (s) => String(s).toUpperCase();
const opts = { mode: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };

test('glossary entries braille alike with or without segments', () => {
  const plain = { type: 'list', kind: 'glossary', items: [{ term: 'anxious', def: 'Worried.', text: 'anxious — Worried.' }] };
  const segd = { type: 'list', kind: 'glossary', items: [{ term: 'anxious', def: 'Worried.', text: 'anxious — Worried.', termSegments: [{ type: 'text', text: 'anxious' }], defSegments: [{ type: 'text', text: 'Worried.' }], segments: [{ type: 'text', text: 'anxious — Worried.' }] }] };
  const a = formatBlock(plain, opts), b = formatBlock(segd, opts);
  assert.deepEqual(a, b);
  assert.ok(a.includes('ANXIOUS: WORRIED.'), JSON.stringify(a));
  assert.deepEqual(traceBlock(segd, opts).map((t) => t.s), b);
  const bold = { type: 'list', kind: 'glossary', items: [{ term: 'anxious', def: 'Worried.', termSegments: [{ type: 'text', text: 'anxious', tf: 4 }], defSegments: [{ type: 'text', text: 'Worried.' }] }] };
  assert.ok(formatBlock(bold, opts).some((l) => l.includes(': WORRIED.')));
});

const books = [
  ['9781930583733NIMAS', { title: 'All About Coyotes', images: true, glossary: true }],
  ['9780000000000NIMAS', { title: 'Exemplar 12: MathML 3 for NIMAS 1.1', maths: true }],
];
for (const [id, want] of books) {
  const file = path.join(CAST, id, `${id}.xml`);
  test(`CAST exemplar ${id}: loads, keeps its content and saves again`, { skip: !fs.existsSync(file) && 'CAST exemplars not downloaded (web/test_corpus_cast)' }, () => {
    const src = fs.readFileSync(file, 'utf8');
    const d = parseDtbook(src);
    assert.equal(d.title, want.title);
    const xml = exportToNimasXml(d);
    if (want.images) {
      assert.equal((xml.match(/<img /g) || []).length, (src.match(/<img /g) || []).length, 'every image saved');
      assert.ok(d.blocks.some((b) => b.type === 'graphic' && b.caption), 'image captions kept');
    }
    if (want.glossary) assert.ok(d.blocks.some((b) => b.type === 'list' && b.kind === 'glossary' && b.items.every((i) => i.term && i.def)));
    if (want.maths) assert.equal((xml.match(/<m:math\b/g) || []).length, (src.match(/<m:math\b|<math\b/g) || []).length);
    assert.equal(parseDtbook(xml).blocks.length, d.blocks.length, 'the save re-reads to the same number of blocks');
  });
}
