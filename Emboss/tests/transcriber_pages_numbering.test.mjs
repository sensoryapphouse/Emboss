// Transcriber pages, Stage 1: the t/p braille page-number series (BANA 2.2.1b, 2.7.1b) + F-57.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVolumes, formatDocument, blockMatter, matterPageNumber } from '../format/document.mjs';
import { seriesPageNumber, brailleNumber } from '../format/page.mjs';

const translate = (t) => (t ? String(t).toUpperCase() : '');
const bana = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate };

function twoVolumeDoc() {
  const blocks = [{ type: 'heading', level: 1, text: 'The Great Novel' }];
  for (let i = 0; i < 120; i++) blocks.push({ type: 'para', text: `Paragraph ${i} with several words of ordinary running text to fill lines.` });
  return { title: 'Test Book', blocks };
}
const pagesOf = (brf) => brf.split('\x0c').map((p) => p.split('\r\n').filter((_, i, a) => i < a.length - (p.endsWith('\r\n') ? 1 : 0)));

test('series primitive: t and p prefixes, body unprefixed', () => {
  assert.equal(seriesPageNumber('transcriber', 1), 'T#A');
  assert.equal(seriesPageNumber('transcriber', 10), 'T#AJ');
  assert.equal(seriesPageNumber('front', 2), 'P#B');
  assert.equal(seriesPageNumber('body', 3), brailleNumber(3));
  assert.throws(() => seriesPageNumber('nope', 1));
});

test('matter: blocks default to body; transcriber/front map to their series', () => {
  assert.equal(blockMatter({ type: 'para' }), 'body');
  assert.equal(blockMatter({ type: 'para', matter: 'front' }), 'front');
  assert.equal(blockMatter({ type: 'para', matter: 'bogus' }), 'body');
  assert.equal(blockMatter(null), 'body');
  assert.equal(matterPageNumber('transcriber', 2), 'T#B');
  assert.equal(matterPageNumber('front', 1), 'P#A');
  assert.equal(matterPageNumber('body', 1), '#A');
});

test('F-57: BANA volume title page ends with t1 on the last line, in every volume', () => {
  const vols = formatVolumes(twoVolumeDoc(), { ...bana, volumePages: 3 });
  assert.ok(vols.length >= 2);
  for (const v of vols) {
    const first = pagesOf(v.brf)[0];
    assert.equal(first.length, 25, 'title page still fills the page');
    assert.match(first[24], /^\s+T#A$/);
    assert.equal(first[24].length, 40, 'right-justified to the line width');
    assert.equal(first[0], '='.repeat(40));
    assert.equal(first[23], '='.repeat(40));
    assert.ok(first.some((l) => l.includes(`VOLUME ${v.volume} OF ${v.of}`)));
  }
});

test('body numbering unchanged: each volume body still starts at #A with no prefix', () => {
  const vols = formatVolumes(twoVolumeDoc(), { ...bana, volumePages: 3 });
  for (const v of vols) {
    const pages = pagesOf(v.brf).slice(1);
    pages.forEach((p, i) => assert.equal(p[p.length - 1].trim(), brailleNumber(i + 1)));
  }
});

test('suppressed page furniture: title page carries no number line', () => {
  const vols = formatVolumes(twoVolumeDoc(), { ...bana, volumePages: 3, suppressHeader: true });
  const first = pagesOf(vols[0].brf)[0];
  assert.ok(!first.some((l) => /T#/.test(l)));
  assert.equal(first.length, 25);
});

test('UKAAF volume title page is unchanged (no t number; prefix rule is BANA)', () => {
  const vols = formatVolumes(twoVolumeDoc(), { mode: 'ukaaf', width: 38, depth: 25, translate, volumePages: 3 });
  assert.ok(!/T#/.test(pagesOf(vols[0].brf)[0].join('\n')));
});

test('contents pages stay on the p series (BANA 2.7.1b) unless tocPageSeries opts into t', () => {
  const doc = twoVolumeDoc();
  const p = formatDocument(doc, { ...bana, toc: true });
  assert.match(p, /P#A\r\n/);
  const t = formatDocument(doc, { ...bana, toc: true, tocPageSeries: 'transcriber' });
  assert.match(t, /T#A\r\n/);
  assert.ok(!/P#A\r\n/.test(t.split('\x0c')[0]));
});
