// Import fix list #57c (Paul, 1 Oct 2026): a footnote or endnote of several paragraphs in the editor.
//
// The readers make such a note as ONE block: { type:'footnote', id, kind?, blocks:[para, para] }, and formatFootnote lays its paragraphs
// out in 1-3 margins for the first and 5-3 for the others (BANA Formats 16.5.1d; UKAAF has no second rule, B004 D). The editor keeps
// one footnote block per paragraph instead (so that click-to-link and the caret find the right paragraph): each carries the note's id,
// and the second and later are marked `noteCont` (editor.mjs markNoteParts). The formatter must lay that run out exactly as the
// reader's single block -- same lines, same place at the end of the print page, same endnote section, same volumes -- and the
// block-by-block trace must still say which block each line belongs to.
//
// Rule: BANA Formats 16.5.1d ("Use 1-3 margins; for additional paragraphs in a note, use 5-3 margins."); 16.5.1a (the separation line
// only before the first note of a run); 16.9.3c (endnotes in 1-3 margins, no blank line between).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const { formatDocument, formatDocumentAsync, formatVolumes, formatBlock, traceBlock } = await import(process.env.DOCUMENT_MJS || '../format/document.mjs');
const { parseDtbook } = await import('../input/parse.mjs');
const { exportToNimasXml, mergeNoteGroups } = await import(process.env.NIMAS_EXPORT_MJS || '../input/nimas-export.mjs');

const up = (s) => String(s || '').toUpperCase();
const translatePos = (s) => ({ braille: up(s), inputPos: Array.from(String(s), (_, i) => i) });
const bana = (extra) => ({ mode: 'bana', standard: 'bana', width: 30, depth: 14, translate: up, suppressHeader: true, ...extra });
const ukaaf = (extra) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 30, depth: 14, translate: up, suppressHeader: true, docEndMarker: false, ...extra });
const pagesOf = (brf) => brf.split('\f').map((p) => p.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')));

const ref = (idref, text) => ({ type: 'noteref', idref, text });
const para = (text, ...refs) => ({ type: 'para', segments: [{ type: 'text', text }, ...refs.map((r) => ref(r, r.replace(/\D+/g, '')))] });
// the reader's shape: one block, the paragraphs in .blocks
const note = (id, texts, extra) => ({ type: 'footnote', id, blocks: texts.map((t) => ({ type: 'para', text: t })), ...extra });
const oneNote = (id, text, extra) => ({ type: 'footnote', id, text, ...extra });
// the editor's shape: one block per paragraph, the later ones marked noteCont
const explode = (blocks) => blocks.flatMap((b) => {
  if (!b || b.type !== 'footnote' || !Array.isArray(b.blocks)) return [b];
  const { blocks: ps, ...rest } = b;
  return ps.map((p, i) => ({ ...rest, text: p.text, ...(p.segments ? { segments: p.segments } : {}), ...(i > 0 ? { noteCont: true } : {}) }));
});
const both = (blocks) => [{ title: null, blocks }, { title: null, blocks: explode(blocks) }];

const LONG = 'the note goes on for long enough to run over to a second line and a third';
const docs = {
  'two notes, one of two paragraphs, at the end of the print page': [
    para('First paragraph.', 'n1'), para('Second paragraph.', 'n2'),
    note('n1', ['Note one first paragraph. ' + LONG, 'Note one second paragraph. ' + LONG]),
    oneNote('n2', 'Note two.'),
    { type: 'pagenum', page: '2', text: '2' },
    para('Beta paragraph.'),
  ],
  'a three-paragraph note in the middle of the text, no print page change': [
    para('Alpha.', 'n1'), note('n1', ['One. ' + LONG, 'Two.', 'Three ' + LONG]), para('Beta.'),
  ],
  'an unreferenced two-paragraph note keeps its place': [
    para('Alpha.'), note('z', ['Orphan first.', 'Orphan second.']), para('Beta.'),
  ],
  'a note referenced from a table is placed before the table (16.8.1a)': [
    para('Intro.'),
    { type: 'table', headers: ['A', 'B'], rows: [[{ segments: [{ type: 'text', text: 'x' }, ref('t1', '1')] }, 'y']] },
    note('t1', ['Table note first.', 'Table note second.']),
    para('After.'),
  ],
  'a note followed by a heading': [
    para('Alpha.', 'n1'), note('n1', ['First.', 'Second.']), { type: 'heading', level: 1, text: 'Next' }, para('Beta.'),
  ],
  'with emphasis in the second paragraph': [
    para('Alpha.', 'n1'),
    note('n1', ['First.', 'Plain then bold.'], {}),
  ],
};
docs['with emphasis in the second paragraph'][1].blocks[1] = { type: 'para', segments: [{ type: 'text', text: 'Plain then ' }, { type: 'text', text: 'bold', tf: 1 }, { type: 'text', text: '.' }] };

test('the editor\'s one-block-per-paragraph run brailles exactly as the reader\'s single block, BANA and UKAAF', () => {
  for (const [name, blocks] of Object.entries(docs)) {
    const [m, u] = both(blocks);
    for (const [mode, o] of [['bana', bana], ['ukaaf', ukaaf]]) {
      assert.equal(formatDocument(u, o()), formatDocument(m, o()), `${name} (${mode})`);
    }
  }
});

test('the second paragraph of a note starts in cell 5, the first in cell 1; one separation line and no blank line inside the note (BANA 16.5.1a, 16.5.1d)', () => {
  const [, u] = both(docs['two notes, one of two paragraphs, at the end of the print page']);
  const lines = pagesOf(formatDocument(u, bana())).flat().filter((l) => l !== '');
  const at = lines.findIndex((l) => l.startsWith(';91NOTE ONE FIRST'));
  assert.ok(at > 0, lines.join('\n'));
  assert.equal(lines[at - 1], '"333333', 'the separation line only before the first note');
  const second = lines.findIndex((l) => /^ {4}NOTE ONE SECOND/.test(l));
  assert.ok(second > at, 'the second paragraph opens in cell 5: ' + lines.join('\n'));
  assert.ok(lines.slice(at, second + 1).every((l) => !/^"333333/.test(l)), 'no second separation line inside the note');
  assert.ok(lines.findIndex((l) => l.startsWith(';92NOTE TWO')) > second, 'the next note follows');
  // UKAAF: no 5-3 rule; the continuation paragraph is on its own line in 1-3 like the first, and only the note has the blank line before it
  const [m2, u2] = both(docs['a three-paragraph note in the middle of the text, no print page change']);
  const uk = pagesOf(formatDocument(u2, ukaaf())).flat();
  assert.equal(uk.join('\n'), pagesOf(formatDocument(m2, ukaaf())).flat().join('\n'));
  assert.ok(uk.some((l) => /^TWO\./.test(l)), 'UKAAF: the further paragraph starts in cell 1: ' + uk.join('|'));
});

test('the editor path (formatDocumentAsync with translatePos) is the same braille, and each line belongs to its own paragraph block', async () => {
  for (const [name, blocks] of Object.entries(docs)) {
    const [, u] = both(blocks);
    for (const o of [bana, ukaaf]) {
      const plain = formatDocument(u, o());
      const trace = {};
      const traced = await formatDocumentAsync(u, o({ translatePos, trace }));
      assert.equal(traced, plain, name);
    }
  }
  const [, u] = both(docs['a three-paragraph note in the middle of the text, no print page change']);
  const trace = {};
  const brf = await formatDocumentAsync(u, bana({ translatePos, trace }));
  const all = []; brf.split('\f').forEach((pg) => { const ls = pg.split(/\r\n|\n/); if (ls.length && ls[ls.length - 1] === '') ls.pop(); all.push(...ls); });
  const idx = (re) => u.blocks.findIndex((b) => b.type === 'footnote' && re.test(b.text));
  const rowsOf = (bi) => trace.rows.map((r, k) => (r === bi ? all[k] : null)).filter((x) => x != null);
  assert.ok(rowsOf(idx(/^One/)).some((l) => l.startsWith(';91ONE.')), JSON.stringify(rowsOf(idx(/^One/))));
  assert.ok(/^ {4}TWO\./.test(rowsOf(idx(/^Two/))[0]), 'the second paragraph\'s line is linked to the second block: ' + JSON.stringify(rowsOf(idx(/^Two/))));
  assert.ok(rowsOf(idx(/^Three/)).length >= 2 && /^ {4}THREE/.test(rowsOf(idx(/^Three/))[0]), JSON.stringify(rowsOf(idx(/^Three/))));
});

test('formatBlock and traceBlock agree on a further paragraph of a note (A39: the two layout paths), in both modes, with text, segments and an empty one', () => {
  const cases = [
    { type: 'footnote', id: 'n', noteCont: true, text: 'A further paragraph that is long enough to run over onto a second line of braille.' },
    { type: 'footnote', id: 'n', noteCont: true, segments: [{ type: 'text', text: 'Plain then ' }, { type: 'text', text: 'bold', tf: 1 }, { type: 'text', text: ' words.' }] },
    { type: 'footnote', id: 'n', kind: 'endnote', noteCont: true, text: 'An endnote paragraph.' },
    { type: 'footnote', id: 'n', noteCont: true, text: '' },
    { type: 'footnote', id: 'n', noteCont: true, noteMark: '1', noteRunStart: true, text: 'Ignores the mark and the separation line.' },
  ];
  for (const b of cases) for (const o of [bana({ translatePos }), ukaaf({ translatePos })]) {
    const f = formatBlock(b, o, false);
    const t = traceBlock(b, o, false).map((x) => x.s);
    assert.deepEqual(t, f, JSON.stringify(b) + ' ' + o.mode);
  }
  const f = formatBlock(cases[0], bana(), false);
  assert.ok(/^ {4}\S/.test(f[0]) && f.slice(1).every((l) => /^ {2}\S/.test(l)), f.join('|'));
  assert.deepEqual(formatBlock(cases[0], ukaaf(), false)[0].startsWith('A FURTHER'), true);
  assert.deepEqual(formatBlock(cases[3], bana(), false), []);
  assert.ok(!formatBlock(cases[4], bana(), false).some((l) => l.includes('"333333') || l.startsWith(';91')), 'a further paragraph takes neither the separation line nor the mark');
});

// ---- endnotes ----
const endDoc = () => [
  para('Alpha paragraph.', 'n1'), note('n1', ['First endnote opens here.', 'First endnote closes here.'], { kind: 'endnote' }),
  para('Beta paragraph.', 'n2'), oneNote('n2', 'Second endnote.', { kind: 'endnote' }),
  para('Gamma.'),
];

test('endnotes: a two-paragraph endnote reaches the NOTES section with its second paragraph in cell 5, same as the reader\'s block', () => {
  const [m, u] = both(endDoc());
  for (const o of [bana, ukaaf]) assert.equal(formatDocument(u, o()), formatDocument(m, o()), o().mode);
  const sec = pagesOf(formatDocument(u, bana())).pop().filter((l) => l !== '');
  const a = sec.findIndex((l) => l.startsWith(';91FIRST ENDNOTE OPENS'));
  assert.ok(a > 0 && /^ {4}FIRST ENDNOTE CLOSES/.test(sec[a + 1]) && sec[a + 2].startsWith(';92SECOND ENDNOTE'), sec.join('\n'));
});

test('endnotes in a book of several volumes: the further paragraphs go with the note to its volume', () => {
  const long = (label, ...refs) => para(`${label} ${'text '.repeat(120)}`, ...refs);
  const blocks = [
    long('One', 'n1'), note('n1', ['Volume one note, first paragraph.', 'Volume one note, second paragraph.'], { kind: 'endnote' }),
    long('Two', 'n2'), oneNote('n2', 'Another for volume one.', { kind: 'endnote' }),
    long('Three', 'n3'), long('Four', 'n4'), oneNote('n4', 'Last note.', { kind: 'endnote' }),
    // a note stands far from its reference (as in an EPUB or HTML book): it still goes with the text that cites it
    note('n3', ['Later note, first paragraph.', 'Later note, second paragraph.', 'Later note, third paragraph.'], { kind: 'endnote' }),
    note('n1b', ['Cited early, standing last, first paragraph.', 'Cited early, standing last, second paragraph.'], { kind: 'endnote' }),
  ];
  blocks[0].segments.push(ref('n1b', '9'));
  const [m, u] = both(blocks);
  const o = () => bana({ volumePages: 6 });
  const mv = formatVolumes(m, o()), uv = formatVolumes(u, o());
  assert.ok(mv.length >= 2, `volumes: ${mv.length}`);
  assert.deepEqual(uv.map((v) => v.brf), mv.map((v) => v.brf));
  const all = uv.map((v) => v.brf).join('\f').replace(/\s*\r?\n\s*/g, ' ');   // lines wrap at width 30
  for (const t of ['VOLUME ONE NOTE, SECOND PARAGRAPH', 'LATER NOTE, SECOND PARAGRAPH', 'LATER NOTE, THIRD PARAGRAPH', 'CITED EARLY, STANDING LAST, SECOND PARAGRAPH']) assert.ok(all.includes(t), t + ' is in some volume');
  // the second paragraph is in the same volume as the first
  const volOf = (t) => uv.findIndex((v) => v.brf.replace(/\s*\r?\n\s*/g, ' ').includes(t));
  assert.equal(volOf('CITED EARLY, STANDING LAST, SECOND PARAGRAPH'), volOf('CITED EARLY, STANDING LAST, FIRST PARAGRAPH'));
  assert.equal(volOf('CITED EARLY, STANDING LAST, FIRST PARAGRAPH'), 0, 'cited in the first volume, so it is in the first volume although it stands last');
  const ukm = formatVolumes(m, ukaaf({ volumePages: 6 })), uku = formatVolumes(u, ukaaf({ volumePages: 6 }));
  assert.deepEqual(uku.map((v) => v.brf), ukm.map((v) => v.brf));
});

// ---- the save: the one-block-per-paragraph run is one <note> with several <p> again ----
test('nimas-export folds the run back into one <note> with a <p> per paragraph (footnote and endnote), and a lone paragraph is unchanged', () => {
  const blocks = explode([para('Alpha.', 'n1'), note('n1', ['First.', 'Second.', 'Third.']), para('Beta.', 'e1'), note('e1', ['E one.', 'E two.'], { kind: 'endnote' }), oneNote('s', 'Single.')]);
  const xml = exportToNimasXml({ title: 'T', blocks });
  assert.match(xml, /<note id="n1" class="footnote"><p>First\.<\/p><p>Second\.<\/p><p>Third\.<\/p><\/note>/);
  assert.match(xml, /<note id="e1" class="endnote"><p>E one\.<\/p><p>E two\.<\/p><\/note>/);
  assert.match(xml, /<note id="s" class="footnote"><p>Single\.<\/p><\/note>/);
  assert.doesNotMatch(xml, /<br\/>/);
  // the same file saved from the reader's single block is the same XML
  const direct = exportToNimasXml({ title: 'T', blocks: [para('Alpha.', 'n1'), note('n1', ['First.', 'Second.', 'Third.']), para('Beta.', 'e1'), note('e1', ['E one.', 'E two.'], { kind: 'endnote' }), oneNote('s', 'Single.')] });
  assert.equal(xml.replace(/uid="[^"]*"|<dc:Identifier[^<]*<\/dc:Identifier>|content="emboss-\d+"/g, ''), direct.replace(/uid="[^"]*"|<dc:Identifier[^<]*<\/dc:Identifier>|content="emboss-\d+"/g, ''));
  // save -> reopen: the DTBook reader gives the note back as the one block with its paragraphs, and the same braille
  const again = parseDtbook(xml);
  const back = again.blocks.filter((b) => b.type === 'footnote');
  assert.deepEqual(back.map((b) => (b.blocks ? b.blocks.map((p) => p.text) : [b.text])), [['First.', 'Second.', 'Third.'], ['E one.', 'E two.'], ['Single.']]);
  assert.equal(formatDocument({ title: null, blocks: again.blocks }, bana()), formatDocument({ title: null, blocks }, bana()), 'a saved and reopened note brailles as the editor\'s run did');
  // emphasis in a further paragraph survives
  const em = explode([note('n1', ['First.', 'x'])]);
  em[1] = { type: 'footnote', id: 'n1', noteCont: true, segments: [{ type: 'text', text: 'Plain ' }, { type: 'text', text: 'bold', tf: 1 }] };
  const emx = exportToNimasXml({ title: 'T', blocks: em });
  assert.match(emx, /<note id="n1" class="footnote"><p>First\.<\/p><p>Plain <em>bold<\/em><\/p><\/note>/);
  // an orphan further paragraph (its first paragraph is gone) is just a note
  const orphan = mergeNoteGroups([{ type: 'footnote', id: 'n1', noteCont: true, text: 'Only.' }]);
  assert.deepEqual(orphan, [{ type: 'footnote', id: 'n1', text: 'Only.' }]);
});
