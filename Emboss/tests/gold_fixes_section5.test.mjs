// Formatter/builder fixes found by running the BANA Formats section 5 gold set (23 Sep 2026):
//  1. 5.3.9: a bold numeral that begins a list item is the item's marker, never emphasised text
//     (BANA Example 5-9 matches) — this is gold-fixture marker syntax (a structural field, never
//     part of the item's own emphasised text) and is unaffected by TF-1's withdrawal of the
//     font-attribute-dropping rule 5.3.9 itself; see gold-run.mjs's own comment at the marker regex;
//  2. TF-1 (Paul, 28 Sep 2026): old 5.3.4 ("ignore font attributes on a part-of-speech abbreviation")
//     is withdrawn (one of the old 5.3.3-5.3.11 the June 2024 changes do not reprint) — a part-of-speech
//     abbreviation's print font attribute is no longer stripped; it follows print like the rest of the
//     definition (5.4.1). Former expectation (stripped) logged in Emboss/docs/expectation-changes.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.GOLD_RUN_SECTION = 'section-5';
const { loadSamples, runOne } = await import('../scripts/gold-run.mjs');
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);

const brf = (blocks) => formatDocument({ title: null, blocks }, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, suppressHeader: true });

test('gold section 5: these examples match', () => {
  const want = ['example-5-9'];
  const byId = new Map(loadSamples().map((s) => [s.sample.id, s.sample]));
  for (const id of want) assert.equal(runOne(byId.get(id)).status, 'match', id);
});

const gloss = (defSegments) => [{ type: 'glossary', items: [{ term: 'accuse', def: 'v. blame', termSegments: [{ type: 'text', text: 'accuse' }], defSegments }] }];

test('TF-1 / old 5.3.4 withdrawn: an emphasised part-of-speech abbreviation in a glossary entry keeps it', () => {
  const plain = brf(gloss([{ type: 'text', text: 'v.' }, { type: 'text', text: ' blame' }]));
  const italic = brf(gloss([{ type: 'text', text: 'v.', tf: 1 }, { type: 'text', text: ' blame' }]));
  assert.notEqual(italic, plain);
});

test('5.3.4 (withdrawn) / 5.4.1 (follow print): other emphasised definition words keep their attribute', () => {
  const plain = brf(gloss([{ type: 'text', text: 'v.' }, { type: 'text', text: ' blame' }]));
  const kept = brf(gloss([{ type: 'text', text: 'v.' }, { type: 'text', text: ' blame', tf: 1 }]));
  assert.notEqual(kept, plain);
});
