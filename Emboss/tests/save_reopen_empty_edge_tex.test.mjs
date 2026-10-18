// A89 (random-action testing, `save-reopen` check; Paul, 2 Oct 2026): three ways a saved NIMAS file reopened to
// different braille or a different model. Paul's decisions:
//   6. EMPTY BLOCKS ("Empty paragraphs: yes"): an empty paragraph, an empty list item and an empty table row are saved and read
//      back as the same empty blocks. (They matter to the braille: an empty paragraph between two print page numbers keeps the
//      two page-number lines apart in BANA; an empty list item is a numbered line with no text; an empty table row is a blank
//      row.) A saved empty block is marked class="bana-empty" so that the writer's own DTD filler (<p></p> in an otherwise empty
//      level) and an unmarked <p/> in somebody else's file are read as before (sample files such as 9781946636171NIMAS.xml have
//      82 of them; reading those as blank blocks would change their braille - reported to Paul, not decided here).
//   7. EDGE SPACES: a space at the start or end of a paragraph, heading, list item or cell, or of a bold/italic run at such an
//      edge, is saved as xml:space="preserve" on the element (valid DTBook: coreattrs) and kept on reading; an element without
//      it is read as before (incidental whitespace in a pretty-printed file is still trimmed).
//   8. EQUATIONS HOLDING ONLY THEIR TeX SOURCE (<semantics><annotation encoding="TeX">, no presentation MathML; the generated
//      "Large Academic Textbook" corpus has 11,000): the TeX is converted to MathML with Temml, as for $...$ maths, and
//      brailled through MathCAT like any equation. TeX Temml cannot convert is braille as a transcriber's note "equation could
//      not be read" and flagged in the transcription warnings (kind math-unreadable), like a picture without a description.
//      The saved file keeps the TeX annotation AND the MathML, so reopening gives the same braille.
//
// Node only (formatDocument): the editor's real save -> reopen of the same cases is Emboss/tests/test-editor-save-reopen-a89.mjs.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { editorTranslators } from '../format/node-translate-helper.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';
import { parseFile, parseDtbook, exportToNimasXml, formatDocument, upperOptions, brailleLines, firstDifference, saveAndReopen } from './helpers/nimas-braille.mjs';

const require = createRequire(import.meta.url);
const temml = require('temml');
const here = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['bana', 'ukaaf'];
const T = (text, tf) => (tf ? { type: 'text', text, tf } : { type: 'text', text });
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1><h1>H</h1>${body}</level1></bodymatter></book></dtbook>`;

async function sameBraille(model, label) {
  const { back, xml } = await saveAndReopen(model);
  for (const mode of MODES) {
    const d = firstDifference(brailleLines(model, upperOptions(mode)), brailleLines(back, upperOptions(mode)));
    assert.equal(d, null, `${label} (${mode}): ${d}`);
  }
  return { back, xml };
}

// ------------------------------------------------------------------------------------------------------------ 6. empty blocks
describe('A89 6: empty paragraphs, list items and table rows survive save -> reopen', () => {
  test('an empty paragraph between two print page numbers keeps them on two lines (BANA), as before the save', async () => {
    const model = { title: null, blocks: [{ type: 'para', text: 'a' }, { type: 'pagenum', page: '3' }, { type: 'para', text: '' }, { type: 'pagenum', page: '1' }, { type: 'para', text: 'b' }] };
    const before = brailleLines(model, upperOptions('bana')).join('|');
    assert.ok(!/-3-1/.test(before), 'sanity: with the empty paragraph the two page numbers stay on two lines');
    const { back } = await sameBraille(model, 'empty paragraph');
    assert.deepEqual(back.blocks.map((b) => b.type), ['para', 'pagenum', 'para', 'pagenum', 'para']);
    assert.equal(back.blocks[2].text, '');
  });

  test('an empty list item stays an (empty) numbered item', async () => {
    const model = { title: null, blocks: [{ type: 'list', ordered: true, items: [{ text: 'a', marker: '1.' }, { text: '', marker: '2.' }, { text: 'c', marker: '3.' }] }] };
    const { back } = await sameBraille(model, 'empty list item');
    const items = back.blocks.find((b) => b.type === 'list').items;
    assert.deepEqual(items.map((i) => [i.text, i.marker]), [['a', '1.'], ['', '2.'], ['c', '3.']]);
  });

  // Found replaying the random-action run (WebKit, the model services contract): in a list whose numbers are kept as printed
  // (some items unnumbered), an empty item was saved as its number alone, "iii. ", with no empty mark, and the reader dropped it.
  test('an empty item in a list whose numbers are kept as printed keeps its number', async () => {
    const model = { title: null, blocks: [{ type: 'list', ordered: true, items: [{ text: 'pay any sums due', level: 2 }, { text: 'the date set out', marker: '(a)', level: 3 }, { text: 'pay all sums', level: 2 }, { text: '', marker: 'iii.', level: 2 }] }, { type: 'pagenum', page: '6' }, { type: 'para', text: 'After.' }] };
    const { back, xml } = await sameBraille(model, 'empty item with a printed number');
    assert.deepEqual(back.blocks.find((b) => b.type === 'list').items.map((i) => [i.text, i.marker || null, i.level || 0]), [['pay any sums due', null, 2], ['the date set out', '(a)', 3], ['pay all sums', null, 2], ['', 'iii.', 2]]);
    assert.match(xml, /<li class="[^"]*bana-empty[^"]*">iii\.<\/li>/);
  });

  // Found by random-action testing (seed 1982326777, WebKit; a generated document, no edits): an unnumbered list (type="pl")
  // with numbered and bulleted lists inside it is read as one plain list whose inner items keep their "1." / "•"; the save
  // wrote it all as one unnumbered list, so the reopened document lost every inner number and bullet.
  test('numbered and bulleted lists inside an unnumbered list keep their numbers and bullets', async () => {
    const xml = wrap(`<list type="pl"><li>Plain top item.</li><li>Second plain item.<list type="ol" enum="1"><li>First inner.<list type="ul"><li>Bullet a.</li><li>Bullet b.</li></list></li><li>Second inner.</li></list></li><li>Last plain item.</li></list>`);
    const model = await parseFile('in.xml', xml);
    const list = model.blocks.find((b) => b.type === 'list');
    assert.ok(list.items.some((i) => i.marker === '1.') && list.items.some((i) => i.marker === '•'), 'sanity: the inner markers are read');
    const { back } = await sameBraille(model, 'lists inside an unnumbered list');
    assert.deepEqual(back.blocks.find((b) => b.type === 'list').items.map((i) => [i.marker || null, i.level || 0]), list.items.map((i) => [i.marker || null, i.level || 0]));
  });

  // Found by random-action testing (seed 1982326777, WebKit): bold put into a table's transcriber's note ("Tab" + bold "le") was
  // saved (<prodnote class="tabletn">Tab <strong>le</strong> …) but read back as plain text, so the reopened braille lost it.
  test('emphasis in a one-paragraph transcriber\'s note survives save -> reopen', async () => {
    const model = { title: null, blocks: [{ type: 'note', kind: 'tabletn', style: 'note', text: 'Tab le note.', segments: [T('Tab '), T('le', 4), T(' note.')] }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }, { type: 'note', text: 'A plain note with an italic word.', segments: [T('A plain note with an '), T('italic', 1), T(' word.')] }] };
    const { back } = await sameBraille(model, 'emphasis in a transcriber note');
    assert.ok(back.blocks.filter((b) => b.type === 'note').every((b) => Array.isArray(b.segments) && b.segments.some((g) => g.tf)), JSON.stringify(back.blocks));
  });

  // Found by random-action testing (seed 1982326777, Firefox): a bulleted list given the Exercise style keeps its bullets (and
  // nested numbering) in the editor, but a save wrote an exercise list as bare items, which the reader numbered 1, 2, 3 … .
  test('an exercise list keeps markers that are not simply 1, 2, 3 …', async () => {
    const items = [{ text: 'Top bullet.', marker: '•', level: 1 }, { text: 'Inner one.', marker: '1.', level: 2 }, { text: 'Inner two.', marker: '2.', level: 2 }, { text: 'No marker.' }, { text: 'Last bullet.', marker: '•' }];
    const model = { title: null, blocks: [{ type: 'list', kind: 'exercise', style: 'exercise', items }] };
    const { back } = await sameBraille(model, 'exercise list markers');
    assert.deepEqual(back.blocks.find((b) => b.type === 'list').items.map((i) => [i.marker || null, i.level || 0]), items.map((i) => [i.marker || null, i.level || 0]));
  });
  test('an empty exercise item is kept, as in any list', async () => {
    const model = { title: null, blocks: [{ type: 'list', kind: 'exercise', style: 'exercise', ordered: true, items: [{ text: 'One.', marker: '1.' }, { text: '', marker: '2.' }, { text: 'Three.', marker: '3.' }] }] };
    const { back, xml } = await sameBraille(model, 'empty exercise item');
    assert.match(xml, /<li class="bai-exercise bana-empty"><\/li>/);
    const it = back.blocks.find((b) => b.type === 'list').items;
    assert.equal(it.length, 3); assert.ok(it[1].keptEmpty, JSON.stringify(it[1]));
  });
  test('a plain exercise list (1, 2, 3 …) is saved as before, with no markers written', async () => {
    const model = { title: null, blocks: [{ type: 'list', kind: 'exercise', style: 'exercise', ordered: true, items: [{ text: 'One.', marker: '1.' }, { text: 'Two.', marker: '2.' }] }] };
    const { xml } = await sameBraille(model, 'plain exercise list');
    assert.match(xml, /<li class="bai-exercise">One\.<\/li>/);
  });

  // Found by random-action testing (seed 1081764635, Firefox; tests/real_samples/md/ch08-01-vectors.md): an attribution the user
  // puts straight after a heading was saved as <byline>, which the reader takes as a second heading (K2 / BANA 4.3.3: an author's
  // name under a title). The save marks its own attribution there, and the reader keeps it an attribution; an unmarked <byline>
  // under a heading in a source file is still a heading.
  test('an attribution straight after a heading stays an attribution', async () => {
    const model = { title: null, blocks: [{ type: 'heading', level: 2, text: 'Vectors' }, { type: 'attribution', text: 'The first collection type.' }, { type: 'para', text: 'After.' }] };
    const { back } = await sameBraille(model, 'attribution after a heading');
    assert.deepEqual(back.blocks.map((b) => b.type), ['heading', 'attribution', 'para']);
    const src = await parseFile('in.xml', wrap('<h2>Title</h2><byline>Author Name</byline><p>After.</p>'));
    assert.equal(src.blocks.filter((b) => b.type === 'heading').length, 3, 'a source byline under a heading is still a heading (K2)');
  });

  // Found by the nightly random-action run (seed 1763563818, Chrome): after Clear, an empty document was saved with its default
  // title as a paragraph ("Emboss Document"), so the reopened document brailled it. An empty document saves as empty.
  test('an empty document saves as empty and reopens with nothing to braille', async () => {
    for (const model of [{ title: null, blocks: [] }, { title: 'A Title', blocks: [] }]) {
      const { xml, back } = await saveAndReopen(model);
      assert.doesNotMatch(xml.slice(xml.indexOf('<bodymatter')), /Emboss Document|A Title/);
      assert.equal(back.blocks.filter((b) => b.type !== 'pagenum').length, 0, JSON.stringify(back.blocks));
    }
  });

  // Found by the nightly random-action run (seed 1763563818, WebKit): a caption with formatting (the editor's runs, no plain text —
  // "Table " + bold "1" + ".1: …") in front of a table was folded into the table as its caption from the caption's plain text, which
  // it did not have, so the caption vanished on save. A caption with formatting is written as a caption of its own.
  test('a formatted caption in front of a table survives save -> reopen', async () => {
    const T2 = (text, tf) => (tf ? { type: 'text', text, tf } : { type: 'text', text });
    for (const between of [[], [{ type: 'note', kind: 'tabletn', text: 'Table note: values normalized.' }]]) {
      const model = { title: null, blocks: [{ type: 'para', text: 'Before.' }, { type: 'caption', segments: [T2('Table '), T2('1', 4), T2('.1: Empirical Measurements')] }, ...between, { type: 'table', format: 'listed', headers: ['A', 'B'], rows: [['1', '2']] }] };
      const { xml } = await sameBraille(model, 'formatted caption');
      assert.match(xml, /Empirical Measurements/);
    }
    // a plain caption is still folded into its table, as before
    const { xml } = await saveAndReopen({ title: null, blocks: [{ type: 'caption', text: 'Table 2.1: Plain' }, { type: 'table', headers: ['A'], rows: [['1']] }] });
    assert.match(xml, /<table[^>]*>\s*<caption>Table 2\.1: Plain<\/caption>/);
  });

  test('an empty item in a bulleted list, and one at the end of the list', async () => {
    const model = { title: null, blocks: [{ type: 'list', ordered: false, items: [{ text: 'a', marker: '•' }, { text: '', marker: '•' }] }, { type: 'para', text: 'after' }] };
    const { back } = await sameBraille(model, 'empty bullet item');
    assert.equal(back.blocks.find((b) => b.type === 'list').items.length, 2);
  });

  test('an empty table row stays a blank row', async () => {
    const model = { title: null, blocks: [{ type: 'table', headers: ['H1', 'H2'], rows: [['a', 'b'], ['', ''], ['c', 'd']], format: 'spatial', style: 'table-spatial' }] };
    const { back } = await sameBraille(model, 'empty table row');
    assert.deepEqual(back.blocks[0].rows, [['a', 'b'], ['', ''], ['c', 'd']]);
  });

  test('the saved empties are marked class="bana-empty"; saving the reopened file gives the same file', async () => {
    const model = { title: null, blocks: [{ type: 'para', text: 'x' }, { type: 'para', text: '' }, { type: 'list', ordered: false, items: [{ text: '', marker: '•' }, { text: 'k', marker: '•' }] }, { type: 'table', headers: [], rows: [['a'], ['']], format: 'spatial' }] };
    const { xml, back } = await saveAndReopen(model);
    assert.match(xml, /<p class="bana-empty"><\/p>/);
    assert.match(xml, /<li class="bana-empty"><\/li>/);
    assert.match(xml, /<tr class="bana-empty">/);
    assert.equal(exportToNimasXml(structuredClone(back)), xml, 'a second save is the same file');
  });

  test('an unmarked empty <p/>, <li/> or <tr> in a file, and the writer\'s own DTD filler paragraph, are read as before (no blank block)', async () => {
    const m = parseDtbook(wrap('<p>one</p><p/><p></p><p>two</p><list type="ul"><li>a</li><li/><li>c</li></list><table><tbody><tr><td>a</td></tr><tr><td/></tr></tbody></table>'));
    assert.deepEqual(m.blocks.map((b) => b.type), ['heading', 'para', 'para', 'list', 'table']);
    assert.equal(m.blocks[3].items.length, 2);
    assert.equal(m.blocks[4].rows.length, 1);
    const { back } = await saveAndReopen({ title: 'T', blocks: [{ type: 'heading', level: 2, text: 'Only a heading' }] });
    assert.deepEqual(back.blocks.map((b) => b.type), ['heading'], 'the filler <p></p> the writer puts in an otherwise empty level is not read back as an empty paragraph');
  });

  test('an empty paragraph, and a padded one, inside a box (sidebar)', async () => {
    const model = { title: null, blocks: [{ type: 'sidebar', title: 'Box', blocks: [{ type: 'para', text: 'in' }, { type: 'para', text: '' }, { type: 'para', text: ' padded ' }] }] };
    const { back } = await saveAndReopen(model);
    assert.deepEqual(back.blocks[0].blocks.slice(1).map((b) => b.text), ['in', '', ' padded ']);
  });

  test('a marked empty paragraph is read as a blank block', () => {
    const m = parseDtbook(wrap('<p>one</p><p class="bana-empty"/><p>two</p>'));
    assert.deepEqual(m.blocks.slice(1).map((b) => b.text), ['one', '', 'two']);
  });

  // xmllint, as tests/nimas_dtd_validation.test.mjs: the official DTD with the MathML extension.
  const HAS_XMLLINT = !spawnSync('xmllint', ['--version'], { encoding: 'utf8' }).error;
  test('the saved file is valid DTBook (xmllint against the official DTD)', { skip: HAS_XMLLINT ? false : 'xmllint is not installed' }, async () => {
    const root = path.resolve(here, '..', '..');
    const dtdDir = path.join(root, 'references', 'dtd');
    const model = { title: 'T', blocks: [
      { type: 'para', text: 'x' }, { type: 'para', text: '' },
      { type: 'list', ordered: true, items: [{ text: '', marker: '1.' }, { text: 'k', marker: '2.' }] },
      { type: 'table', headers: ['A', 'B'], rows: [['a', 'b'], ['', '']], format: 'spatial' },
      { type: 'para', segments: [T(' lead ', 1), T('b')] }, { type: 'heading', level: 1, segments: [T('h'), T(' ', 1)] },
      { type: 'list', ordered: false, items: [{ text: ' padded ', marker: '•' }] },
      { type: 'table', headers: [], rows: [[' x ', 'y']], format: 'spatial' },
    ] };
    const xml = exportToNimasXml(model);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-a89-'));
    const file = path.join(dir, 'saved.xml');
    fs.writeFileSync(file, xml);
    const r = spawnSync('xmllint', ['--noout', '--nonet', '--valid', file], { cwd: root, encoding: 'utf8', env: { ...process.env, XML_CATALOG_FILES: pathToFileURL(path.join(dtdDir, 'catalog.xml')).href } });
    assert.equal(r.status, 0, (r.stderr || '').split('\n').slice(0, 20).join('\n'));
  });
});

// ------------------------------------------------------------------------------------------------------------ 7. edge spaces
describe('A89 7: a space at the edge of a paragraph, heading, list item, cell or run is kept', () => {
  const textsOf = (b) => (Array.isArray(b.segments) ? b.segments.map((s) => (s.type === 'math' ? 'M' : s.text)) : [b.text]);
  // the runs of one typeform, adjacent ones joined (the reader joins a space-only run to the run before it: the same text, the same braille)
  const runsOf = (segs) => segs.reduce((out, s) => { const last = out[out.length - 1]; if (last && s.type !== 'math' && last[1] === (s.tf || 0)) last[0] += s.text; else out.push([s.type === 'math' ? 'M' : s.text, s.tf || 0]); return out; }, []);
  const cases = {
    'a plain paragraph with a leading and a trailing space': { type: 'para', text: ' lead and trail ' },
    'a paragraph whose first bold run starts with a space': { type: 'para', segments: [T(' lead', 1), T('x')] },
    'a paragraph whose last bold run ends with a space': { type: 'para', segments: [T('x'), T('trail ', 1)] },
    'a paragraph that starts with " / " before a bold word': { type: 'para', segments: [T(' / '), T('any', 4), T(' word here')] },
    'a paragraph with space-only runs at both edges': { type: 'para', segments: [T(' '), T('b', 1), T(' ')] },
    'a heading ending in a space after a bold run': { type: 'heading', level: 1, segments: [T('quick '), T('b', 4), T(' ')] },
    'a plain heading with a trailing space': { type: 'heading', level: 2, text: 'Heading ' },
  };
  for (const [label, block] of Object.entries(cases)) {
    test(label, async () => {
      const model = { title: null, blocks: [{ type: 'para', text: 'zz' }, block, { type: 'para', text: 'yy' }] };
      const { back } = await sameBraille(model, label);
      if (block.segments) assert.deepEqual(runsOf(back.blocks[1].segments), runsOf(block.segments));
      else assert.equal(back.blocks[1].text, block.text);
    });
  }

  test('a list item and a table cell with edge spaces', async () => {
    const model = { title: null, blocks: [
      { type: 'list', ordered: false, items: [{ text: ' lead item', marker: '•' }, { segments: [T('a ', 1), T('b'), T(' ')], marker: '•' }] },
      { type: 'table', headers: [], rows: [[' a ', 'b ']], format: 'spatial' },
    ] };
    const { back } = await sameBraille(model, 'list item and cell');
    const items = back.blocks[0].items;
    assert.equal(items[0].text, ' lead item');
    assert.deepEqual(runsOf(items[1].segments), [['a ', 1], ['b ', 0]]);
    assert.deepEqual(back.blocks[1].rows, [[' a ', 'b ']]);
  });

  test('only an element with an edge space gets xml:space="preserve"', async () => {
    const { xml } = await saveAndReopen({ title: null, blocks: [{ type: 'para', text: 'one' }, { type: 'para', text: 'two ' }, { type: 'para', segments: [T('x'), T('y', 1)] }, { type: 'list', ordered: false, items: [{ text: 'a', marker: '•' }, { text: 'b ', marker: '•' }] }] });
    assert.equal((xml.match(/xml:space="preserve"/g) || []).length, 2, xml.slice(xml.indexOf('<bodymatter')));
    assert.match(xml, /<p>one<\/p>/);
    assert.match(xml, /<p xml:space="preserve">two <\/p>/);
    assert.match(xml, /<li xml:space="preserve">b <\/li>/);
  });

  test('incidental whitespace in a file without xml:space is trimmed as before', () => {
    const m = parseDtbook(wrap('<p>\n     indented text \n   </p><p> <strong>bold </strong> </p><h2>  Heading  </h2><list type="ul"><li>\n   item \n</li></list>'));
    assert.equal(m.blocks[1].text, 'indented text');
    assert.deepEqual(textsOf(m.blocks[2]), ['bold']);
    assert.equal(m.blocks[3].text, 'Heading');
    assert.equal(m.blocks[4].items[0].text, 'item');
  });

  test('xml:space="preserve" keeps the edge spaces', () => {
    const m = parseDtbook(wrap('<p xml:space="preserve"> kept </p><p xml:space="preserve"><strong>bold </strong></p>'));
    assert.equal(m.blocks[1].text, ' kept ');
    assert.deepEqual(textsOf(m.blocks[2]), ['bold ']);
  });
});

// ------------------------------------------------------------------------------------------------------------ 8. TeX-only equations
describe('A89 8: an equation that holds only its TeX source is converted with Temml and brailled', () => {
  const TEX = 'f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx';
  const TEX_ONLY = (tex) => `<m:math alttext="${tex}"><m:semantics><m:annotation encoding="application/x-tex">${tex}</m:annotation></m:semantics></m:math>`;
  let tr;
  const mathFns = {};
  const optionsFor = (mode, extra = {}) => ({
    mode, standard: mode, width: mode === 'bana' ? 40 : 38, depth: 25,
    translate: tr.translate, translateG1: tr.translateG1, translatePos: tr.translatePos,
    mathToBrf: mathFns[mode], ...extra,
  });
  const brf = (model, mode, extra) => formatDocument(structuredClone(model), optionsFor(mode, extra));

  test('setup', async () => {
    await louis.init(path.resolve(here, '..', '..', 'liblouis', 'tables'));
    tr = editorTranslators(louis);
    for (const mode of MODES) {
      const h = makeMathToBrf(mode);
      // the maths engine's own rule for a segment: MathML first, else Temml from the LaTeX (engine/maths.mjs mathToBrf)
      mathFns[mode] = (seg) => (seg.mathml != null ? h(seg.mathml) : h(temml.renderToString(seg.latex, { throwOnError: false })));
    }
  });

  test('read: the MathML is real maths now, with the TeX kept; the braille is that of the same equation as presentation MathML or $...$', async () => {
    const m = parseDtbook(wrap(TEX_ONLY(TEX)));
    const eq = m.blocks[1];
    assert.equal(eq.type, 'math');
    assert.equal(eq.latex, TEX);
    assert.match(eq.mathml, /<(?:m:)?msubsup|<(?:m:)?msup|<(?:m:)?mo\b/, 'presentation MathML');
    assert.match(eq.mathml, /annotation/, 'the TeX annotation is kept');
    for (const mode of MODES) {
      const got = brf({ title: null, blocks: [eq] }, mode);
      const asLatex = brf({ title: null, blocks: [{ type: 'math', latex: TEX }] }, mode);                                    // $$...$$
      const asMathml = brf({ title: null, blocks: [{ type: 'math', mathml: temml.renderToString(TEX) }] }, mode);            // presentation MathML
      assert.equal(got, asMathml, `${mode}: same as the equation given as presentation MathML`);
      assert.equal(got, asLatex, `${mode}: same as the equation given as LaTeX`);
      assert.notEqual(got, brf({ title: null, blocks: [] }, mode), `${mode}: the equation is brailled (it was left out before)`);
      assert.ok(got.replace(/[\r\n\f\s]/g, '').length > brf({ title: null, blocks: [] }, mode).replace(/[\r\n\f\s]/g, '').length + 15, `${mode}: a whole equation's cells are there`);
    }
  });

  test('an inline TeX-only equation in a paragraph is brailled the same way', () => {
    const m = parseDtbook(wrap(`<p>Take <m:math alttext="x^2"><m:semantics><m:annotation encoding="application/x-tex">x^2+1</m:annotation></m:semantics></m:math> as given.</p>`));
    const same = { title: null, blocks: [{ type: 'para', segments: [T('Take '), { type: 'math', mathml: temml.renderToString('x^2+1'), latex: 'x^2+1' }, T(' as given.')] }] };
    for (const mode of MODES) assert.equal(brf({ title: null, blocks: [m.blocks[1]] }, mode), brf(same, mode), mode);
  });

  test('save -> reopen: the same braille, the TeX annotation and the MathML both in the saved file', async () => {
    const m = parseDtbook(wrap(TEX_ONLY(TEX) + `<p>Inline <m:math><m:semantics><m:annotation encoding="application/x-tex">a_1+b</m:annotation></m:semantics></m:math> end.</p>`));
    const xml = exportToNimasXml(structuredClone(m));
    assert.match(xml, /<m:annotation encoding="application\/x-tex">f\(x\) = \\int_/, 'the TeX source is kept');
    assert.match(xml, /<m:msubsup|<m:msup|<m:mo>/, 'and the converted MathML');
    assert.ok(!/<m:mtext>f\(x\)/.test(xml), 'the TeX is not written as the equation text');
    const back = await parseFile('saved.xml', xml);
    for (const mode of MODES) assert.equal(brf(back, mode), brf(m, mode), `${mode}: reopened`);
    assert.equal(exportToNimasXml(structuredClone(back)), xml, 'a second save is the same file');
  });

  test('a TeX-only equation whose TeX Temml cannot convert is brailled as one Emboss could not read, and flagged', async () => {
    const bad = '\\frac{a}{b';
    const m = parseDtbook(wrap(`<p>before</p>${TEX_ONLY(bad)}<p>after</p>`));
    for (const mode of MODES) {
      const o = optionsFor(mode);
      const out = formatDocument(structuredClone(m), o);
      const w = (o.warnings || []).filter((x) => x.kind === 'math-unreadable');
      assert.equal(w.length, 1, `${mode}: one warning ${JSON.stringify(o.warnings)}`);
      assert.match(w[0].message, /could not (be )?read/i);
      assert.equal(w[0].blockIndex, 2);
      assert.ok(out.replace(/[\r\n\f]/g, '').includes('@.<'), `${mode}: a transcriber's note stands for it`);
    }
    // saved and reopened: still unreadable, still flagged, same braille
    const xml = exportToNimasXml(structuredClone(m));
    assert.match(xml, new RegExp('annotation encoding="application/x-tex">' + bad.replace(/[\\{}]/g, '\\$&')), 'the TeX source is kept');
    const back = await parseFile('saved.xml', xml);
    for (const mode of MODES) {
      const o1 = optionsFor(mode), o2 = optionsFor(mode);
      assert.equal(formatDocument(structuredClone(back), o2), formatDocument(structuredClone(m), o1), `${mode}: same braille`);
      assert.equal((o2.warnings || []).filter((x) => x.kind === 'math-unreadable').length, 1, `${mode}: still flagged`);
    }
  });

  test('an inline unreadable equation is flagged once and does not stop the rest of the paragraph', () => {
    const m = parseDtbook(wrap(`<p>Take <m:math><m:semantics><m:annotation encoding="application/x-tex">\\badcmd{x}</m:annotation></m:semantics></m:math> now.</p>`));
    const o = optionsFor('ukaaf');
    const out = formatDocument(structuredClone(m), o);
    assert.equal((o.warnings || []).filter((x) => x.kind === 'math-unreadable').length, 1);
    const flat = out.replace(/[\r\n\f]/g, '');
    assert.ok(flat.includes('@.<') && flat.includes('@.>'), 'the note stands where the equation was');
    assert.ok(flat.indexOf('@.<') > 3 && /[A-Z]/.test(flat.slice(flat.indexOf('@.>'))), 'text before and after it');
  });

  // Found by random-action testing (seed 1081764635, Chrome): the editor's TeX converter (MathLive) writes some symbols as HTML
  // named characters (<mo>&ne;</mo>, &alpha;, &times; …), which XML does not know; a save wrote them as they were and the reopened
  // equation brailled "&ne;" as text. A save now writes the characters themselves.
  test('HTML named characters in an equation are saved as the characters', async () => {
    const mathml = '<mrow><msup><mn>102</mn><mn>9</mn></msup><mo>&ne;</mo><mn>38</mn><mo>&times;</mo><mi>&alpha;</mi><mo>&nbsp;</mo><mi>&Omega;</mi><mo>&lt;</mo><mn>1</mn></mrow>';
    const model = { title: null, blocks: [{ type: 'math', mathml, latex: '102^{9}\\ne 38' }] };
    const { xml, back } = await saveAndReopen(model);
    assert.ok(!/&(ne|times|alpha|nbsp|Omega);/.test(xml), xml.slice(xml.indexOf('<m:math'), xml.indexOf('</m:math>') + 9));
    assert.match(xml, /≠/); assert.match(xml, /α/); assert.match(xml, /Ω/); assert.match(xml, /&lt;/);
    const m = back.blocks.find((b) => b.type === 'math');
    assert.ok(m && /≠/.test(m.mathml) && /×/.test(m.mathml), JSON.stringify(m));
  });

  test('an equation with real presentation MathML is untouched', () => {
    const mathml = '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:semantics><m:mrow><m:mi>x</m:mi><m:mo>+</m:mo><m:mn>1</m:mn></m:mrow><m:annotation encoding="application/x-tex">x+1</m:annotation></m:semantics></m:math>';
    const m = parseDtbook(wrap(mathml));
    assert.equal(m.blocks[1].mathml.includes('<m:mrow><m:mi>x</m:mi><m:mo>+</m:mo><m:mn>1</m:mn></m:mrow>'), true);
  });
});
