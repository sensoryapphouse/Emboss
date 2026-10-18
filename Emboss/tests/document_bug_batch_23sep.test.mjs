// Document-formatting bug batch, 23 Sep 2026. Of the ten findings queued (F-26, F-77, F-78,
// F-75, F-90, F-25, F-108, F-109, F-124, F-157) only F-75 needed a code change; the rest were
// already fixed elsewhere, are blocked on an open transcriber question (Q-26, Q-48), or have no
// vendored data to build on (F-157) — see Emboss/docs/standards-findings.md status lines.
// Every expected value below comes from the cited rule's own text or a gold worked example,
// never from Emboss's pre-fix output. One describe block per finding.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBlock, traceBlock, formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

let translate, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t, tf) => louis.translate(t, T, tf || null);
  translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
});
const banaOpts = (width = 40) => ({ mode: 'bana', standard: 'bana', width, depth: 25, translate, translatePos });
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

// ===========================================================================================
// F-75 — BANA 7.2.1e (contributing cause): "Do not leave a blank line between boxed material
// and any accompanying heading, caption, directions, or source citation."
// Finding: "A box's own title is always a fixed cell-5, plain-text heading — never centred,
// never emphasised". `formatBox` wrapped every box `title` in a synthetic
// `{type:'heading', level:2, text}`, so the title could never be centred and any emphasis in
// it was dropped (BANA §4.3.7's heading rule strips print emphasis; a box title is not a §4
// heading). Gold worked example: BANA Example 7-2 ("Boxed Columns"): the title 'Forms of be'
// (with 'be' italic in print) is CENTRED (15 leading cells at width 40) and carries the
// italics indicator: `               ,=MS ( .12`.
// ===========================================================================================
describe('F-75 — a box title can be centred and can keep its own emphasis (BANA 7.2.1e, Example 7-2)', () => {
  const kids = [{ type: 'para', text: 'Body text.' }];
  const titleLineOf = (lines) => lines[lines.findIndex((l) => /^7{10,}$/.test(l)) + 1];
  const italicBe = [{ type: 'text', text: 'Forms of ' }, { type: 'text', text: 'be', tf: 1 }];

  test('default (no title fields) is unchanged: cell-5, plain', () => {
    const o = banaOpts();
    const lines = formatBlock({ type: 'box', title: 'Forms of be', blocks: kids }, o);
    assert.equal(titleLineOf(lines), '    ,=MS ( 2');
  });

  test('titleAlign "centred" centres the title: 8-cell title at width 40 = floor((40-8)/2) = 16 leading cells', () => {
    const o = banaOpts();
    const lines = formatBlock({ type: 'box', title: 'Forms of be', titleAlign: 'centred', blocks: kids }, o);
    assert.equal(titleLineOf(lines), ' '.repeat(16) + ',=MS ( 2');
  });

  test('titleSegments keeps the italic on "be": Example 7-2 title line, exactly', () => {
    const o = banaOpts();
    const lines = formatBlock({ type: 'box', title: 'Forms of be', titleSegments: italicBe, titleAlign: 'centred', blocks: kids }, o);
    assert.equal(titleLineOf(lines), '               ,=MS ( .12');
  });

  test('titleSegments alone (no titleAlign) keeps the emphasis at the default cell-5', () => {
    const o = banaOpts();
    const lines = formatBlock({ type: 'box', title: 'Forms of be', titleSegments: italicBe, blocks: kids }, o);
    assert.equal(titleLineOf(lines), '    ,=MS ( .12');
  });

  test('the title is still followed by no blank line ahead of the top border and the box keeps its own blank lines', () => {
    const o = banaOpts();
    const lines = formatBlock({ type: 'box', title: 'Forms of be', titleSegments: italicBe, titleAlign: 'centred', blocks: kids }, o);
    assert.equal(lines[0], '');
    assert.match(lines[1], /^7+$/);
    assert.equal(lines.at(-1), '');
  });

  test('formatBlock and traceBlock agree for every combination', () => {
    const o = banaOpts();
    for (const extra of [{}, { titleAlign: 'centred' }, { titleSegments: italicBe }, { titleSegments: italicBe, titleAlign: 'centred' }]) {
      parity({ type: 'box', title: 'Forms of be', blocks: kids, ...extra }, o);
    }
  });

  test('page-boundary bookkeeping (boxHeadingLineCount) sees the same title lines: a document round trip keeps them', () => {
    const doc = { blocks: [{ type: 'box', title: 'Forms of be', titleSegments: italicBe, titleAlign: 'centred', blocks: kids }] };
    const out = formatDocument(doc, { ...banaOpts(), suppressHeader: true }).split(/\r?\n/);
    assert.ok(out.includes('               ,=MS ( .12'), JSON.stringify(out.slice(0, 8)));
  });
});
