// Formatter fixes found by running the BANA Formats section 21 gold set (23 Sep 2026):
//  1. the forced new page for an alphabetic reference goes before the heading run that introduces
//     the list, and a centred division letter joins its list with no blank line (21.2.1a, 21.2.3c; A8/F-191/F-204);
//  2. a definition that starts with an enclosure symbol gets one blank cell, and mixed entry styles
//     get two blank cells throughout (21.5.1c, 21.5.1e; F-194).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.GOLD_RUN_SECTION = 'section-21';
const { loadSamples, runOne } = await import('../scripts/gold-run.mjs');
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);

function pages(blocks) {
  const brf = formatDocument({ title: null, blocks }, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, suppressHeader: true }) || '';
  return brf.split('\x0c').map((p) => p.split('\r\n').map((l) => l.replace(/\s+$/, '')));
}
const idx = (n) => ({ type: 'list', kind: 'index', items: [{ level: 1, text: n, page: '1' }] });

test('gold section 21: these examples match', () => {
  const want = ['BANA Example 21-2', 'BANA Example 21-17'];
  const byId = new Map(loadSamples().map((s) => [s.sample.id, s.sample]));
  for (const id of want) assert.equal(runOne(byId.get(id)).status, 'match', id);
});

test('index: title, headnote and division letter stay on one page with the list; no blank after the letter', () => {
  const p = pages([
    { type: 'heading', level: 1, text: 'Words to Know' },
    { type: 'para', text: 'Go to the page number.' },
    { type: 'heading', level: 1, text: 'A' },
    idx('abominably,'),
  ]);
  assert.equal(p.length, 1);
  const l = p[0];
  const a = l.findIndex((x) => /,A$/.test(x));
  assert.ok(a > 0 && l[a + 1] !== '');
});

test('index preceded by body text starts a new page at its heading; a later division does not', () => {
  const p = pages([
    { type: 'para', text: 'Some body text before the index.' },
    { type: 'heading', level: 1, text: 'Index' },
    { type: 'heading', level: 1, text: 'A' },
    idx('apple,'),
    { type: 'heading', level: 1, text: 'B' },
    idx('bear,'),
  ]);
  assert.equal(p.length, 2);
  assert.match(p[1].join('\n'), /,B/);
  assert.match(p[1].join('\n'), /,A/);
});

test('glossary separator: enclosure starts one cell; mixed styles two cells throughout', () => {
  const g = (items) => pages([{ type: 'list', kind: 'glossary', items }])[0].filter(Boolean);
  const one = g([{ term: 'antique', def: '(n.) a relic', level: 0 }]);
  assert.match(one[0], /^ANTIQUE \S/);
  const mixed = g([{ term: 'daft', def: 'crazy, silly', level: 0 }, { term: 'daily (dailies)', def: 'occurring every day', level: 0 }]);
  assert.match(mixed[0], /^DAFT {2}\S/);
  assert.match(mixed[1], /DAILIES">  \S/);
});
