// A26: print images and displayed maths survive the editor and the save.
//  - <imggroup> → one graphic block with caption (inline segments kept) and description;
//    the save writes <imggroup><img/><caption/><prodnote/></imggroup> back.
//  - Braille (BANA Formats §6.2–6.4): caption in 7-5, a TN label when print does not identify
//    the illustration, description in a TN on the next line; decorative images omitted.
//  - Editor: ImageNode keeps src/alt/caption/description; a paragraph holding only one
//    equation is saved as a math block (display="block").
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
const up = (s) => String(s).toUpperCase();
const opts = (mode) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>T</h1>${body}</level1></bodymatter></book></dtbook>`);

const GROUP = `<imggroup><img src="a.png" alt="A map"/><caption>Map of <em>Europe</em><noteref idref="#f1">1</noteref></caption><prodnote render="optional">The map shows countries.</prodnote></imggroup><note id="f1"><p>1 Note.</p></note><img src="cover.png" alt=""/>`;

test('parser: an image group is one graphic with caption and description', () => {
  const d = doc(GROUP);
  const [g, , cover] = d.blocks.slice(1);
  assert.equal(g.type, 'graphic');
  assert.equal(g.caption, 'Map of Europe1');
  assert.deepEqual(g.captionSegments.map((x) => x.type), ['text', 'text', 'noteref']);
  assert.equal(g.description, 'The map shows countries.');
  assert.ok(!d.blocks.some((b) => b.type === 'note'), 'no made-up "Image:" note');
  assert.deepEqual([cover.type, cover.src, cover.alt], ['graphic', 'cover.png', '']);
});

test('save: the image group is written back and re-reads identically', () => {
  const d = doc(GROUP);
  const xml = exportToNimasXml(d);
  assert.match(xml, /<imggroup><img src="a\.png" alt="A map"\/><caption>Map of <em>Europe<\/em><noteref idref="#f1">1<\/noteref><\/caption><prodnote render="optional">The map shows countries\.<\/prodnote><\/imggroup>/);
  assert.match(xml, /<img src="cover\.png" alt=""\/>/);
  assert.deepEqual(parseDtbook(xml).blocks, d.blocks);
});

test('braille: caption, label, description; decorative image omitted', () => {
  const o = opts('bana');
  const cases = [
    [{ type: 'graphic', src: 'a', alt: 'A', caption: 'Figure 2. Balloon', description: 'A red balloon.' }, ['      FIGURE 2. BALLOON', '      @.<A RED BALLOON.@.>']],
    [{ type: 'graphic', src: 'a', alt: 'Portrait', caption: 'Lincoln in 1860' }, ['      @.<ILLUSTRATION@.> LINCOLN IN 1860', '      @.<PORTRAIT@.>']],
    [{ type: 'graphic', src: 'a', alt: 'A portrait' }, ['      @.<ILLUSTRATION@.>', '      @.<A PORTRAIT@.>']],
    [{ type: 'graphic', src: 'cover.png', alt: '' }, []],
  ];
  for (const [b, want] of cases) {
    assert.deepEqual(formatBlock(b, o), want, JSON.stringify(b));
    assert.deepEqual(traceBlock(b, o).map((t) => t.s), want);
  }
  assert.deepEqual(formatBlock(cases[0][0], opts('ukaaf')), ['    FIGURE 2. BALLOON', '    @.<A RED BALLOON.@.>']);
});

test('editor: ImageNode registered; equation-only paragraph saved as a math block (source check)', () => {
  const ed = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  assert.match(ed, /nodes: \[[^\]]*ImageNode/);
  assert.match(ed, /parent\.append\(\$createImageNode\(b\)\)/);
  assert.match(ed, /solid\.length === 1 && solid\[0\]\.type === 'math'/);
  assert.doesNotMatch(ed, /\[Tactile graphic: \$\{b\.alt \|\| 'Diagram'\}\]/, 'no text placeholder for print images');
});

test('editor keeps what it loads (source checks; verified in Chrome with scripts/compare-editor-model.mjs)', () => {
  const ed = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  // one recursive path for the document and sidebars (nested sidebars, pagenums, maths inside)
  assert.match(ed, /for \(const cb of b\.blocks\) appendBlock\(sidebar, cb\);/);
  assert.match(ed, /for \(const child of node\.getChildren\(\)\) nodeToBlocks\(child, innerBlocks\);/);
  // line breaks survive, in the surrounding form
  assert.match(ed, /if \(\$isLineBreakNode\(child\)\) \{/);
  assert.match(ed, /String\(s\.text\)\.split\('\\n'\)/);
  // list markers from print, markerless items, adjacent lists kept apart, print bullets restored
  assert.match(ed, /li\.setMarker\(it\.marker \|\| NO_MARKER\)/);
  assert.match(ed, /if \(prev && \$isListNode\(prev\)\) parent\.append\(\$createParagraphNode\(\)\);/);
  assert.match(ed, /if \(ordered && !isPlain\) blk\.ordered = true;/);
  assert.match(ed, /put the print bullet back, in its own form/);
  // glossary term/definition, uncontracted runs, table 'auto', pagenum and sidebar source ids
  assert.match(ed, /if \(listKind === 'glossary'\) item = glossaryItem\(runs\) \|\| item;/);
  assert.match(ed, /unc = child\.hasFormat\('code'\);/);
  assert.match(ed, /b\.format \|\| 'auto'/);
  assert.match(ed, /\$createPrintPageNode\(b\.page \|\| b\.text \|\| '1', b\)/);
  assert.match(ed, /if \(b\.id \|\| b\.render\) sidebar\.setSource\(b\);/);
});

// A29: images inside headings, list items and sidebar paragraphs were dropped; an image
// group with only a production note saved an empty <img src="">.
test('parser: images in headings, list items and sidebars are kept; no empty img is saved', () => {
  const d = parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
    <h1>Title <imggroup><img src="h.png" alt="H"/><caption>Cap</caption></imggroup></h1>
    <list type="ul"><li>Item <imggroup><img src="l.png" alt="L"/></imggroup></li></list>
    <sidebar><p><sent>See <img src="s.png" alt="S"/></sent></p></sidebar>
    <imggroup><prodnote render="optional">A described figure.</prodnote></imggroup>
  </level1></bodymatter></book></dtbook>`);
  const heading = d.blocks.find((b) => b.type === 'heading');
  assert.equal(heading.text.trim(), 'Title');
  const xml = exportToNimasXml(d);
  for (const src of ['h.png', 'l.png', 's.png']) assert.ok(xml.includes(`src="${src}"`), src);
  assert.ok(d.blocks.some((b) => b.type === 'graphic' && b.src === 'h.png' && b.caption === 'Cap'));
  assert.doesNotMatch(xml, /src=""/);
  assert.match(xml, /<imggroup><prodnote render="optional">A described figure\.<\/prodnote><\/imggroup>/);
});
