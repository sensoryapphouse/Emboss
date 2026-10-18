// Optional formatter fields (document.mjs) carried through DTBook: parse -> export -> parse.
// Storage forms are documented in nimas-export.mjs (BANA_FLAG_FIELDS). A field is exported only
// when set, so a document without any of them must serialize exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimas, serializeBlock } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;

const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>Doc</h1>${body}</level1></bodymatter></book></dtbook>`;
const roundTrip = (xml) => { const a = parseDtbook(xml); const out = exportToNimas(a); return { a, out, b: parseDtbook(out) }; };
const strip = (blocks) => JSON.parse(JSON.stringify(blocks));

test('every field: import, export, re-import gives the same blocks', () => {
  const xml = wrap(`
    <h2 class="bana-not-connected">By A. Writer</h2>
    <h2 class="bana-accompanies-box">Facts</h2>
    <sidebar render="required"><hd>In a box</hd><p class="bana-directions">Inside directions.</p></sidebar>
    <p class="bana-directions">Read and answer.</p>
    <p class="bana-directions bana-directions-continued">More directions.</p>
    <p class="bana-directions bana-directions-labelled">A. Use each word.</p>
    <p class="bai-play bana-speaker-gap">HAMLET</p>
    <p class="bai-verse bana-ln-margin">Verse line</p>
    <p class="bana-ln-note" title="Line numbers are in the margin.">Numbered 1</p>
    <p class="bana-ln-note-off">Numbered 2</p>
    <prodnote render="required" class="bana-enclose-prefix" title="Cartoon">Cartoon by Craig</prodnote>
    <prodnote render="optional" class="bana-xref" title="See also">Turn to page 9.</prodnote>
    <prodnote render="optional" class="bana-xref">No heading here.</prodnote>
    <list type="ul" class="bana-columns-3"><li>a</li><li>b</li><li>c</li></list>
    <list type="ul"><li>□ hollow</li><li>■ solid</li><li>○ circle</li><li>▲ tri</li><li>✓ check</li><li>• dot</li><li>- dash</li></list>
    <list type="ol"><li class="bana-bullet-triangle">first</li><li class="bana-bullet-hollow-square">second</li></list>
    <list type="ul"><li class="bana-bullet-checkmark">bare check</li></list>`);
  const { a, out, b } = roundTrip(xml);
  const A = a.blocks;
  const find = (pred) => A.find(pred);
  assert.ok(find((x) => x.type === 'heading' && x.notConnected && x.text === 'By A. Writer'), 'notConnected');
  assert.ok(find((x) => x.type === 'heading' && x.accompaniesBox), 'accompaniesBox');
  assert.ok(find((x) => x.type === 'box').blocks.some((x) => x.type === 'para' && x.directions), 'directions inside a box');
  assert.ok(find((x) => x.type === 'para' && x.directions && !x.directionsContinued && !x.directionsLabelled));
  assert.ok(find((x) => x.type === 'para' && x.directionsContinued));
  assert.ok(find((x) => x.type === 'para' && x.directionsLabelled));
  assert.ok(find((x) => x.type === 'play' && x.speakerGap && x.text === 'HAMLET'), 'speakerGap');
  assert.ok(find((x) => x.type === 'play' && x.lnMargin), 'lnMargin');
  assert.ok(find((x) => x.lnNoteText === 'Line numbers are in the margin.'), 'lnNoteText');
  assert.ok(find((x) => x.lnNoteOff), 'lnNoteOff');
  assert.ok(find((x) => x.type === 'note' && x.enclosePrefix === 'Cartoon'), 'enclosePrefix');
  assert.ok(find((x) => x.type === 'xref' && x.heading === 'See also' && x.text === 'Turn to page 9.'), 'xref with heading');
  assert.ok(find((x) => x.type === 'xref' && !x.heading), 'xref without heading');
  assert.equal(find((x) => x.type === 'list' && x.columns === 3).items.length, 3, 'columns');
  const glyphList = A.find((x) => x.type === 'list' && x.items.some((i) => i.text === 'hollow'));
  assert.deepEqual(glyphList.items.map((i) => i.marker), ['□', '■', '○', '▲', '✓', '•', '•'], 'five glyphs survive import; the dot-like ones fold to the dot; a leading square-root sign is not a bullet');
  assert.deepEqual(glyphList.items.map((i) => i.text), ['hollow', 'solid', 'circle', 'tri', 'check', 'dot', 'dash']);
  const ol = A.find((x) => x.type === 'list' && x.items[0].text === 'first');
  assert.deepEqual(ol.items.map((i) => [i.marker, i.bullet]), [['1.', 'triangle'], ['2.', 'hollow square']], 'bullet beside an ordinal');
  const bare = A.find((x) => x.type === 'list' && x.items[0].text === 'bare check');
  assert.deepEqual([bare.items[0].bullet, bare.items[0].marker], ['checkmark', undefined], 'bullet-only item via class');
  // export -> re-import is lossless for every field
  assert.deepEqual(strip(b.blocks), strip(A), 'blocks identical after export and re-import');
  // and a second export is byte-identical to the first
  assert.equal(exportToNimas(b), out);
});

test('a document that uses none of the fields exports exactly as before (no tokens)', () => {
  const xml = wrap('<h2>Plain</h2><p>Para</p><list type="ul"><li>• a</li><li>b</li></list><prodnote render="required">Note</prodnote><list type="ol"><li>x</li></list>');
  const out = exportToNimas(parseDtbook(xml));
  assert.equal(/bana-/.test(out), false, out);
  assert.equal(/title="/.test(out), false);
  assert.equal(/[□■○▲✓√]/.test(out), false);
});

test('serializeBlock writes a field only when it is set', () => {
  assert.equal(serializeBlock({ type: 'heading', level: 2, text: 'H' }, 0), '<h2>H</h2>');
  assert.equal(serializeBlock({ type: 'heading', level: 2, text: 'H', notConnected: true }, 0), '<h2 class="bana-not-connected">H</h2>');
  assert.equal(serializeBlock({ type: 'heading', level: 2, text: 'H', notConnected: false }, 0), '<h2>H</h2>');
  assert.equal(serializeBlock({ type: 'para', text: 'P', directions: true, blocked: true }, 0), '<p class="blocked bana-directions">P</p>');
  assert.match(serializeBlock({ type: 'xref', text: 'x', heading: 'A & B' }, 0), /^<prodnote render="optional" class="bana-xref" title="A &amp; B">x<\/prodnote>$/);
  assert.match(serializeBlock({ type: 'list', columns: 2, items: [{ text: 'a', marker: '•' }, { text: 'b', marker: '•' }] }, 0), /^<list type="ul" class="bana-columns-2">/);
  assert.equal(/bana-columns/.test(serializeBlock({ type: 'list', columns: 1, items: [{ text: 'a' }] }, 0)), false);
});

test('a bullet item written from the model keeps its glyph or class', () => {
  const xml = serializeBlock({ type: 'list', items: [{ text: 'a', marker: '▲' }, { text: 'b', bullet: 'hollow circle', level: 0 }] }, 0);
  assert.match(xml, /<li>▲ a<\/li>/);
  assert.match(xml, /<li class="bana-bullet-hollow-circle">b<\/li>/);
});

test('a hyphen or star bullet still folds to the dot; text that merely starts with a glyph but has no space is kept', () => {
  const { a } = roundTrip(wrap('<list type="ul"><li>* star</li><li>▲no space</li></list>'));
  const items = a.blocks.find((x) => x.type === 'list').items;
  assert.deepEqual(items.map((i) => i.marker), ['•', '•']);
  assert.equal(items[1].text, '▲no space');
});
