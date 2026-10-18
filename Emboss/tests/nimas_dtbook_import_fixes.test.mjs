// DTBook / NIMAS import and save -> reopen fixes (import-fix-list rows 30d, nested tables, <q>).
// NIMAS DTBook XML is Emboss's own save format, so a file Emboss saves must reopen to the SAME
// braille. Each test below was written to FAIL on the code as it stood before the fix.
//
//  30d   A poem's own <title> and <author> are kept INSIDE the <poem> on save (DTD: poem (title |
//        author | hd | dateline | epigraph | byline | linegroup | line | pagenum | img | imggroup |
//        sidebar)*), so the reopened file reads to the same model and the same braille. Before, the
//        title was saved as a section heading (<level2><h2>) and the author as a <byline> after it,
//        which the reader takes as "a second, unconnected centred heading" (BANA 4.3.3, Example 4-2).
//  W6    (Paul, IMP-W6) a table nested in a table cell: the outer table stays a table, its cell
//        holds "(table follows)", the inner table follows as a table of its own.
//  <q>   print shows quotation marks around <q> text: the reader draws them (as the HTML reader
//        does); the save writes them as text, so reopening does not add them twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPT_MARKS } from '../format/text-style.mjs';
import { parseDtbook, parseFile, saveAndReopen, upperOptions, brailleLines, firstDifference, exportToNimasXml } from './helpers/nimas-braille.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', 'nimas-import-fixes', name), 'utf8');
const wrap = (inner) => `<?xml version="1.0" encoding="UTF-8"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head>
<book><bodymatter><level1><h1>Chapter</h1>${inner}</level1></bodymatter></book></dtbook>`;
const texts = (blocks) => blocks.map((b) => `${b.type}:${b.text ?? ''}`);

function sameBrailleAfterSave(model, label) {
  return saveAndReopen(model).then(({ back }) => {
    for (const mode of ['bana', 'ukaaf']) {
      const d = firstDifference(brailleLines(model, upperOptions(mode)), brailleLines(back, upperOptions(mode)));
      assert.equal(d, null, `${label} (${mode}): braille changed on reopening — ${d}`);
    }
    return back;
  });
}

// ------------------------------------------------------------------------------------------ 30d
test('30d poem: title and author are saved inside the <poem> (as <title>/<author>), not as a section heading and a byline', async () => {
  const model = parseDtbook(fixture('poems.xml'));
  const { xml } = await saveAndReopen(model);
  assert.match(xml, /<poem>\s*<title>Poem One Title<\/title>\s*<author>Poet One<\/author>\s*<linegroup>/, 'the poem keeps its own title and author');
  assert.doesNotMatch(xml, /<h2>Poem One Title<\/h2>/, 'the poem title is not a section heading');
  assert.doesNotMatch(xml, /<byline>Poet One<\/byline>/, 'the author is not a byline outside the poem');
  assert.doesNotMatch(xml, /<level2>/, 'no section is opened for a poem title');
  // a poem with a title only, an author only, a byline after its lines, a title and nothing else
  assert.match(xml, /<poem>\s*<title>Only A Title<\/title>\s*<linegroup>/);
  assert.match(xml, /<poem>\s*<author>Only An Author<\/author>\s*<linegroup>/);
  assert.match(xml, /<\/linegroup>\s*<byline>Byline after the lines<\/byline>\s*<\/poem>|<\/linegroup>\s*<author>Byline after the lines<\/author>\s*<\/poem>/);
  assert.match(xml, /<poem>\s*<title>Title Only Poem<\/title>\s*<\/poem>/);
});

test('30d poem: save -> reopen gives the same model and the same BANA and UKAAF braille', async () => {
  const model = parseDtbook(fixture('poems.xml'));
  const back = await sameBrailleAfterSave(model, 'poems.xml');
  assert.deepEqual(texts(back.blocks), texts(model.blocks), 'the same blocks, in the same order, after reopening');
  // the title is still a heading and the author is still an attribution (not a second heading)
  const i = back.blocks.findIndex((b) => b.text === 'Poem One Title');
  assert.equal(back.blocks[i].type, 'heading');
  assert.equal(back.blocks[i + 1].type, 'attribution');
  assert.equal(back.blocks[i + 1].text, 'Poet One');
});

test('30d poem: two poems in a row each keep their own title and author', async () => {
  const model = parseDtbook(fixture('poems.xml'));
  const { xml } = await saveAndReopen(model);
  const poems = xml.match(/<poem>[\s\S]*?<\/poem>/g);
  const x = poems.find((p) => p.includes('Adjacent Poem X'));
  const y = poems.find((p) => p.includes('Adjacent Poem Y'));
  assert.ok(x && y && x !== y, 'two separate <poem> elements');
  assert.ok(x.includes('Poet X') && !x.includes('Poet Y'));
  assert.ok(y.includes('Poet Y') && !y.includes('Adjacent X line'));
});

test('30d poem: the editor keeps a verse line\'s fromPoem but not the poemRole/poemId of the title and author above it — the braille still does not change on reopening', async () => {
  // editor.mjs carries `fromPoem` on a paragraph node (ParagraphNode.__fromPoem) and nothing for a heading or attribution, so a
  // file opened and saved in the editor reaches exportToNimasXml with those two fields gone.
  const model = parseDtbook(fixture('poems.xml'));
  for (const b of model.blocks) { delete b.poemRole; delete b.poemId; }
  const { xml } = await saveAndReopen(model);
  assert.match(xml, /<poem>\s*<author>Poet One<\/author>\s*<linegroup>/, 'the author is written inside its poem');
  assert.doesNotMatch(xml, /<\/h2>\s*<byline>Poet One<\/byline>/, 'no <byline> straight after a heading: it would read back as a second heading');
  await sameBrailleAfterSave(model, 'poems.xml without poemRole');
  // the same with a title above the author (the DTBook sample d01-features.xml)
  const d01 = parseDtbook(fs.readFileSync(path.join(here, 'fixtures', 'import-audit', 'dtbook', 'd01-features.xml'), 'utf8'));
  for (const b of d01.blocks) { delete b.poemRole; delete b.poemId; }
  await sameBrailleAfterSave(d01, 'd01-features.xml without poemRole');
});

test('30d poem: a title written at another level (an <h3> in the poem) keeps its level through save and reopen', async () => {
  const model = parseDtbook(wrap('<poem><h3>Level Three Title</h3><author>Poet Three</author><linegroup><line>One line</line></linegroup></poem>'));
  const t = model.blocks.find((b) => b.text === 'Level Three Title');
  assert.equal(t.level, 3);
  const { xml, back } = await saveAndReopen(model);
  assert.doesNotMatch(xml, /<h3>Level Three Title/, 'still inside the poem');
  assert.equal(back.blocks.find((b) => b.text === 'Level Three Title').level, 3);
  await sameBrailleAfterSave(model, 'h3 poem title');
});

test('30d poem: a file Emboss saved EARLIER in the old shape (<level2><h2>title</h2><byline>author</byline><poem>) still opens, with every word', async () => {
  const old = wrap('<level2><h2>Old Shape Title</h2><byline>Old Shape Author</byline><poem><linegroup><line>Old line one</line><line>Old line two</line></linegroup></poem></level2>');
  const model = await parseFile('old.xml', old);
  const words = texts(model.blocks).join(' ');
  for (const w of ['Old Shape Title', 'Old Shape Author', 'Old line one', 'Old line two']) assert.ok(words.includes(w), `${w} is kept`);
  // and it is stable from here on: saved again it opens to the same braille
  await sameBrailleAfterSave(model, 'old-shape poem');
});

// ------------------------------------------------------------------------------------------ W6
const NESTED = `<table><tbody><tr><td>Outer A</td><td><table><tbody><tr><td>In1</td><td>In2</td></tr><tr><td>In3</td><td>In4</td></tr></tbody></table></td></tr><tr><td>Outer B</td><td>Outer C</td></tr></tbody></table>`;

test('W6 nested table (DTBook): the outer table stays a table, its cell says "(table follows)", the inner table follows as a table of its own', () => {
  const model = parseDtbook(wrap(NESTED));
  const tables = model.blocks.filter((b) => b.type === 'table');
  assert.equal(tables.length, 2, 'the outer table and the inner table');
  const [outer, inner] = tables;
  assert.deepEqual(outer.rows, [['Outer A', '(table follows)'], ['Outer B', 'Outer C']], 'the inner rows are not repeated in the outer table');
  assert.deepEqual(inner.rows, [['In1', 'In2'], ['In3', 'In4']]);
  assert.equal(model.blocks.indexOf(inner), model.blocks.indexOf(outer) + 1, 'the inner table follows the outer');
  assert.equal(model.warnings, undefined, 'no "table could not be loaded" warning');
});

test('W6 nested table (DTBook): tables nested two deep follow in order, and a nested table with a caption keeps it', () => {
  const xml = wrap(`<table><tbody><tr><td>L0</td><td><table><caption>Inner caption</caption><tbody><tr><td>L1</td><td><table><tbody><tr><td>L2a</td><td>L2b</td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>`);
  const model = parseDtbook(xml);
  const tables = model.blocks.filter((b) => b.type === 'table');
  assert.equal(tables.length, 3);
  assert.deepEqual(tables[0].rows, [['L0', '(table follows)']]);
  assert.deepEqual(tables[1].rows, [['L1', '(table follows)']]);
  assert.deepEqual(tables[2].rows, [['L2a', 'L2b']]);
  assert.ok(model.blocks.some((b) => b.type === 'caption' && b.text === 'Inner caption'));
  assert.equal(model.warnings, undefined);
});

test('W6 nested table (DTBook): save -> reopen gives the same tables and the same braille', async () => {
  const model = parseDtbook(wrap(NESTED));
  const { back } = await saveAndReopen(model);
  assert.deepEqual(back.blocks.filter((b) => b.type === 'table').map((b) => b.rows), model.blocks.filter((b) => b.type === 'table').map((b) => b.rows));
  await sameBrailleAfterSave(model, 'nested table');
  assert.equal(back.warnings, undefined);
});

// ------------------------------------------------------------------------------------------ <q>
test('<q> (DTBook): quotation marks are drawn round the text, single marks inside one', () => {
  const model = parseDtbook(wrap('<p>He said <q>hello <q>inner</q> there</q> and left.</p>'));
  assert.equal(model.blocks[1].text, 'He said “hello ‘inner’ there” and left.');
});

test('<q> (DTBook): marks already in the text are not doubled', () => {
  const model = parseDtbook(wrap('<p>A <q>“already marked”</q> and <q>"straight marked"</q> and <q>‘single’</q> end.</p>'));
  assert.equal(model.blocks[1].text, 'A “already marked” and "straight marked" and ‘single’ end.');
  // the real NIMAS file nimas_samples/NIMAS_valid_baseline.xml: the marks open the <q> and the closing one is not last (a citation follows)
  const cited = parseDtbook(wrap('<p>See <q>"Quoted words here." (Source, 1930.)</q></p>'));
  assert.equal(cited.blocks[1].text, 'See "Quoted words here." (Source, 1930.)');
});

test('<q> (DTBook): marks the file writes just outside the <q> are not doubled either (main-session review, 1 Oct)', () => {
  const model = parseDtbook(wrap('<p>A “<q>outside curly</q>” and "<q>outside straight</q>" end.</p>'));
  assert.equal(model.blocks[1].text, 'A “outside curly” and "outside straight" end.');
});

test('<q> (DTBook): in a heading, a list item, a table cell and a line of verse', () => {
  const model = parseDtbook(wrap('<h2>On <q>Quoting</q></h2><list type="ul"><li>Item <q>one</q></li></list><table><tbody><tr><td><q>cell</q></td><td>x</td></tr></tbody></table><poem><linegroup><line>A <q>verse</q> line</line></linegroup></poem>'));
  const all = JSON.stringify(model.blocks);
  for (const s of ['On “Quoting”', 'Item “one”', '“cell”', 'A “verse” line']) assert.ok(all.includes(s), s);
});

test('<q> (DTBook): save -> reopen does not add the marks twice, and the braille is unchanged', async () => {
  const model = parseDtbook(wrap('<p>He said <q>hello <q>inner</q> there</q> and <q>“marked”</q> left.</p>'));
  const { xml, back } = await saveAndReopen(model);
  assert.equal(back.blocks[1].text, 'He said “hello ‘inner’ there” and “marked” left.');
  assert.doesNotMatch(xml, /““|””|‘‘|’’/, 'no doubled marks in the saved file');
  await sameBrailleAfterSave(model, '<q> paragraph');
  // and again: a second save and reopen changes nothing
  const again = await saveAndReopen(back);
  assert.equal(again.back.blocks[1].text, back.blocks[1].text);
});

test('<q> (DTBook): the fixture file with <q>, a nested table and <abbr> saves and reopens to the same braille; abbreviations keep their print text', async () => {
  const model = parseDtbook(fixture('nested-table-q.xml'));
  const all = JSON.stringify(model.blocks);
  assert.ok(all.includes('“these are ‘quoted words’ indeed”'));
  assert.ok(all.includes('NATO'), 'the abbreviation keeps its print text');
  assert.ok(!all.includes('North Atlantic'), 'the abbr title is not expanded');
  await sameBrailleAfterSave(model, 'nested-table-q.xml');
});

// ------------------------------------------------------------------------------------------ sub/superscript (checklist section 8)
test('sub/superscript (DTBook): a saved <sub>/<sup> reopens with its level and without a false "word could not be loaded" warning', async () => {
  // The checklist listed this as PARTIAL (a spurious warning "1 word of the file could not be loaded (H2O)"); the 30 Sep sub/superscript
  // work fixed it. This test keeps it fixed.
  const model = parseDtbook(wrap('<p>Water H<sub>2</sub>O and x<sup>2</sup> end.</p>'));
  const joined = (b) => (b.segments || [{ text: b.text }]).map((s) => s.text).join('');
  assert.ok(joined(model.blocks[1]).includes(SCRIPT_MARKS.subOpen) && joined(model.blocks[1]).includes(SCRIPT_MARKS.supOpen));
  const { back } = await saveAndReopen(model);
  assert.equal(joined(back.blocks[1]), joined(model.blocks[1]));
  assert.equal(back.warnings, undefined);
  assert.equal(model.warnings, undefined);
});

test('sub/superscript (DTBook): a <sub>/<sup> in a table cell keeps its level (it was read as plain digits)', async () => {
  // Not covered by the checklist row above: found by the save -> reopen braille test (w19-rich-contexts.docx) and in two files of web/test_corpus_1000.
  const model = parseDtbook(wrap('<table><thead><tr><th>Head</th><th>Other</th></tr></thead><tbody><tr><td>x<sup>2</sup></td><td>H<sub>2</sub>O and <strong>bold</strong></td></tr></tbody></table>'));
  const t = model.blocks.find((b) => b.type === 'table');
  const textOf = (c) => (typeof c === 'string' ? c : (c.segments || [{ text: c.text }]).map((g) => g.text).join(''));
  assert.equal(textOf(t.rows[0][0]), `x${SCRIPT_MARKS.supOpen}2${SCRIPT_MARKS.end}`);
  assert.ok(textOf(t.rows[0][1]).includes(SCRIPT_MARKS.subOpen), 'a cell that is also bold keeps the level too');
  const { back } = await saveAndReopen(model);
  assert.equal(textOf(back.blocks.find((b) => b.type === 'table').rows[0][0]), textOf(t.rows[0][0]));
});

// Found merging the Markdown reader (1 Oct): a code block among a list item's further blocks (item.blocks) is saved as
// <p class="bana-code">, but the list-item reader read that back as an ordinary paragraph (the top-level reader turns it
// into a code block), so the braille lost its grade-1 passage on reopening.
test('a code block inside a list item is saved as <p class="bana-code"> and read back as a code block, lines and all', async () => {
  const model = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'first', marker: '•', blocks: [{ type: 'para', text: 'second paragraph' }, { type: 'code', text: 'let x = 1;\n  y()' }] }, { text: 'next', marker: '•' }] }] };
  const back = parseDtbook(exportToNimasXml(structuredClone(model)));
  const item = back.blocks.find((b) => b.type === 'list').items[0];
  assert.deepEqual(item.blocks, [{ type: 'para', text: 'second paragraph' }, { type: 'code', text: 'let x = 1;\n  y()' }]);
  await sameBrailleAfterSave(model, 'code block in a list item');
});

// Import fix list #50 (a named exception in nimas_save_reopen_braille.test.mjs, h03-lists.html): a quotation paragraph among a list
// item's blocks is saved as <blockquote><p class="quote"> inside the <li>, but the list-item reader read it back as an ordinary
// paragraph (the quote style lost, and with it the braille's quotation layout).
test('a quotation inside a list item is saved as <blockquote> and read back as a quotation, formatting and all', async () => {
  const model = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'item', marker: '•', blocks: [{ type: 'para', style: 'quote', text: 'quoted words' }, { type: 'para', style: 'quote', text: 'a bold word', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'bold', tf: 4 }, { type: 'text', text: ' word' }] }] }, { text: 'next', marker: '•' }] }] };
  const back = parseDtbook(exportToNimasXml(structuredClone(model)));
  const item = back.blocks.find((b) => b.type === 'list').items[0];
  assert.deepEqual(item.blocks.map((b) => [b.type, b.style, b.text]), [['para', 'quote', 'quoted words'], ['para', 'quote', 'a bold word']]);
  assert.ok(item.blocks[1].segments && item.blocks[1].segments.some((g) => g.text === 'bold' && (g.tf & 4)), JSON.stringify(item.blocks[1]));
  await sameBrailleAfterSave(model, 'quotation in a list item');
});
