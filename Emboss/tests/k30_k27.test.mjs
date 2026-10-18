// K30 / K27 (EMBOSS-TASKS.md section K, 26 Sep 2026).
//
// K30 registers two formatter fields the K1 work (Emboss/format/document.mjs: keepEmphasis,
// dedication, headingEmphasisOf, decorativeEmphasisOf, emphasisContext) already reads but never
// saved: `keepEmphasis` (BANA 8.1.4b, Example 8-6 — the transcriber says a list/table's shared
// print emphasis is NOT decorative, so keep it) and `dedication` (BANA 2.9.1f — this paragraph
// is part of a dedication/acknowledgement, judged together with its neighbours for decorative
// emphasis). Both are added to the field registry (save/load as DTBook class tokens, a Braille
// formatting dialog control, editor carry) — field_registry.test.mjs already exercises every
// registered field's round trip, cache-key and UI wiring generically, so this file does not
// repeat that; it covers what is new and NOT generic: readers that set `dedication` from how
// the SOURCE document itself marks a dedication (DTBook/NIMAS <dedication> and class, EPUB
// epub:type="dedication", HTML role="doc-dedication", a Word paragraph styled "Dedication").
//
// K27 / BANA June 2024 9.2.6 ("Displayed Foreign Language Material Paired with Translations"):
// a new list-level flag `translationPairs`. Read 9.2.6 exactly (references/_text/
// Changes_Foreign_Language_Sections_Braille_Formats_2016.txt):
//   a. format as a nested list, using the margins for displayed material; never columnar.
//   b. follow print for blank lines between groups of pairs; otherwise none are needed.
//   c. omit typeform from both the foreign material and its translation, UNLESS it is used
//      for an individual word emphasised within one language (partial emphasis is kept).
// This file tests the formatter behaviour (columnedListPlan/formatList/decorativeEmphasisOf
// in document.mjs) directly, since it depends on more than one flag firing together.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { formatBlock, traceBlock, getBlockSignature } from '../format/document.mjs';
import { parseDtbook, parseHtml, parseDocx } from '../input/parse.mjs';
import { parseDoc } from '../input/doc.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { writeDoc, writeDocx } from './helpers/doc-writer.mjs';
import * as R from '../format/field-registry.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const OPTS = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos, suppressHeader: true };
const s = (text, tf) => (tf ? { type: 'text', text, tf } : { type: 'text', text });
const rtrim = (l) => l.replace(/\s+$/, '');
function block(b) {
  const lines = formatBlock(b, OPTS).map(rtrim);
  assert.deepEqual(traceBlock(b, OPTS).map((t) => rtrim(t.s)), lines, 'traceBlock must match formatBlock');
  return lines;
}
function leadSpaces(lines) { const l = lines.find((x) => x.trim()); return l ? l.length - l.trimStart().length : -1; }

// ------------------------------------------------------------------------------------------------
// K30: registry wiring (the parts field_registry.test.mjs's generic checks don't cover).
// ------------------------------------------------------------------------------------------------
describe('K30: field registry', () => {
  test('keepEmphasis, dedication and translationPairs are registered as transcriber fields', () => {
    for (const key of ['keepEmphasis', 'dedication', 'translationPairs']) {
      const f = R.fieldByKey(key);
      assert.ok(f, `${key} is registered`);
      assert.equal(f.audience, 'transcriber', `${key} audience`);
      assert.ok(f.affectsBraille, `${key} affectsBraille`);
    }
    assert.deepEqual(R.fieldByKey('keepEmphasis').where.slice().sort(), ['list', 'table']);
    assert.deepEqual(R.fieldByKey('dedication').where, ['para']);
    assert.deepEqual(R.fieldByKey('translationPairs').where, ['list']);
  });
  test('getBlockSignature already keys keepEmphasis/dedication (K1) and now keys translationPairs (K27)', () => {
    const list = { type: 'list', items: [{ text: 'one' }, { text: 'two' }] };
    assert.notEqual(getBlockSignature(list, OPTS, false), getBlockSignature({ ...list, translationPairs: true }, OPTS, false));
    assert.notEqual(getBlockSignature(list, OPTS, false), getBlockSignature({ ...list, keepEmphasis: true }, OPTS, false));
    const para = { type: 'para', text: 'To my mother.' };
    assert.notEqual(getBlockSignature(para, OPTS, false), getBlockSignature({ ...para, dedication: true }, OPTS, false));
  });
});

// ------------------------------------------------------------------------------------------------
// K30: NIMAS save/load round trip for a document using all three fields together.
// ------------------------------------------------------------------------------------------------
test('K30/K27: model -> DTBook -> model keeps keepEmphasis, dedication and translationPairs', () => {
  const model = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'list', kind: 'toc', items: [{ text: 'a', page: '1' }], keepEmphasis: true },
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], keepEmphasis: true },
      { type: 'para', text: 'To my mother.', dedication: true },
      { type: 'para', text: 'and my father.', dedication: true },
      { type: 'list', items: [{ text: 'Bonjour' }, { text: 'Hello', level: 1 }], translationPairs: true },
    ],
  };
  const xml = exportToNimasXml(JSON.parse(JSON.stringify(model)), { uid: 'k30-k27', date: '2026-01-01' });
  assert.match(xml, /class="[^"]*\bbana-keep-emphasis\b/);
  assert.match(xml, /class="[^"]*\bbana-dedication\b/);
  assert.match(xml, /class="[^"]*\bbana-translation-pairs\b/);
  const reopened = parseDtbook(xml);
  const toc = reopened.blocks.find((b) => b.type === 'list' && b.kind === 'toc');
  const table = reopened.blocks.find((b) => b.type === 'table');
  const ded = reopened.blocks.filter((b) => b.type === 'para' && b.dedication);
  const tp = reopened.blocks.find((b) => b.type === 'list' && b.kind !== 'toc');
  assert.equal(toc.keepEmphasis, true);
  assert.equal(table.keepEmphasis, true);
  assert.equal(ded.length, 2, JSON.stringify(reopened.blocks));
  assert.equal(tp.translationPairs, true);
});

// ------------------------------------------------------------------------------------------------
// K30: readers set `dedication` from how the SOURCE document marks a dedication.
// ------------------------------------------------------------------------------------------------
describe('K30: readers set `dedication` from the source', () => {
  test('DTBook/NIMAS <dedication> (frontmatter) element, and a class="dedication" fallback', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <dedication><p>To my mother.</p><p>and my father.</p></dedication>
      <div class="dedication"><p>Also to Rex the dog.</p></div>
      <level1><h1>Chapter</h1><p>Body text.</p></level1>
    </bodymatter>
  </book>
</dtbook>`;
    const model = parseDtbook(xml);
    const ded = model.blocks.filter((b) => b.type === 'para' && b.dedication).map((b) => b.text);
    assert.deepEqual(ded, ['To my mother.', 'and my father.', 'Also to Rex the dog.'], JSON.stringify(model.blocks));
    const body = model.blocks.find((b) => b.text === 'Body text.');
    assert.ok(body && !body.dedication);
  });

  test('HTML class="dedication", ARIA role="doc-dedication", EPUB epub:type="dedication"', () => {
    const m1 = parseHtml('<div class="dedication"><p>To my mother.</p></div><p>Body.</p>');
    assert.equal(m1.blocks.find((b) => b.text === 'To my mother.')?.dedication, true, JSON.stringify(m1.blocks));
    assert.ok(!m1.blocks.find((b) => b.text === 'Body.')?.dedication);

    const m2 = parseHtml('<aside role="doc-dedication"><p>For Rex.</p></aside>');
    assert.equal(m2.blocks.find((b) => b.text === 'For Rex.')?.dedication, true, JSON.stringify(m2.blocks));

    // Real EPUB XHTML always declares the epub: namespace on the root <html> (xmldom's
    // text/html mode rejects an unbound prefix — the shape parseEpub's own chapter reader,
    // above, actually receives from a real .epub's OPS content documents).
    const m3 = parseHtml('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><section epub:type="dedication"><p>In memory.</p></section></body></html>');
    assert.equal(m3.blocks.find((b) => b.text === 'In memory.')?.dedication, true, JSON.stringify(m3.blocks));
  });

  test('Word paragraph styled "Dedication" — .doc and .docx parity', async () => {
    const spec = {
      styles: [{ name: 'Dedication', type: 'para' }],
      body: [{ p: 'To my mother.', style: 'Dedication' }, { p: 'Body text.' }],
    };
    const doc = await parseDoc(writeDoc(spec));
    const docx = await parseDocx(await writeDocx(spec));
    for (const [label, m] of [['doc', doc], ['docx', docx]]) {
      const ded = m.blocks.find((b) => b.text === 'To my mother.');
      const body = m.blocks.find((b) => b.text === 'Body text.');
      assert.ok(ded && ded.dedication, `${label}: ${JSON.stringify(m.blocks)}`);
      assert.ok(body && !body.dedication, `${label}: body must not be marked dedication`);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// K27: formatter behaviour (BANA June 2024 9.2.6).
// ------------------------------------------------------------------------------------------------
describe('K27: translation pairs (BANA 9.2.6)', () => {
  test('9.2.6a: never columnar, even when `columns` is set — a nested list, one pair per line', () => {
    const items = [{ text: 'un' }, { text: 'deux' }, { text: 'trois' }, { text: 'quatre' }];
    const columnar = block({ type: 'list', columns: 2, items }).filter((l) => l.trim());
    const tp = block({ type: 'list', columns: 2, translationPairs: true, items }).filter((l) => l.trim());
    assert.equal(columnar.length, 2, JSON.stringify(columnar));     // packed 2x2 columns
    assert.equal(tp.length, 4, JSON.stringify(tp));                 // one line per item, no columns
  });

  test('9.2.6a: uses the displayed-material margin, exactly as `displayed` does', () => {
    const item = { text: 'Bonjour' };
    const plain = leadSpaces(formatBlock({ type: 'list', items: [item] }, OPTS));
    const displayed = leadSpaces(formatBlock({ type: 'list', displayed: true, items: [item] }, OPTS));
    const tp = leadSpaces(formatBlock({ type: 'list', translationPairs: true, items: [item] }, OPTS));
    assert.equal(tp, displayed, 'translationPairs must use the same displayed-material offset');
    assert.equal(tp, plain + 2);
  });

  test('9.2.6c: typeform marking a WHOLE item (one language) is omitted', () => {
    const withTf = [{ segments: [s('apples', 1)] }, { text: 'x' }];
    const withoutTf = [{ segments: [s('apples')] }, { text: 'x' }];
    assert.deepEqual(
      block({ type: 'list', translationPairs: true, items: withTf }),
      block({ type: 'list', translationPairs: true, items: withoutTf }),
      'a whole-item typeform must be stripped, same output as no typeform at all',
    );
  });

  test('9.2.6c: a word emphasised for another reason WITHIN one item (partial) is kept', () => {
    const partial = [{ segments: [s('green '), s('apples', 1)] }, { text: 'x' }];
    const plain = [{ segments: [s('green '), s('apples')] }, { text: 'x' }];
    assert.notDeepEqual(
      block({ type: 'list', translationPairs: true, items: partial }),
      block({ type: 'list', translationPairs: true, items: plain }),
      'partial emphasis within an item must survive translationPairs (9.2.6c exception)',
    );
  });

  test('keepEmphasis (K30) still overrides translationPairs (K27) when the transcriber sets it', () => {
    const withTf = [{ segments: [s('apples', 1)] }, { text: 'x' }];
    const kept = block({ type: 'list', translationPairs: true, keepEmphasis: true, items: withTf });
    const omitted = block({ type: 'list', translationPairs: true, items: withTf });
    assert.notDeepEqual(kept, omitted, 'keepEmphasis must stop the 9.2.6c whole-item typeform omission');
  });
});
