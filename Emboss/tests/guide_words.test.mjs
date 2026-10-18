// K12: braille page guide words in alphabetic references (BANA Braille Formats 2016 §21.3.2, and the March 2024
// Updates [21.3.2k]), built as a post-pass over the assembled pages in format/document.mjs (applyGuideWords).
// Every expectation comes from the rule text (references/_text/braille-formats-2016.txt, 21.3.2a-j and Samples 21-1,
// 21-3, 21-4), never from Emboss's own earlier output:
//   a  "Guide words indicate the first and last main entries on the braille page."
//   b  "Do not generate guide words for subentries."
//   c  "Center guide words on the last line of every braille page."
//   d  "At least three blank cells must precede the first guide word."
//   e  "Leave at least three blank cells between the last guide word and braille page number."
//   f  "Leave at least three blank cells after the second guide word when there is no braille page number on
//      interpoint even pages."
//   g  "Do not include punctuation attached to the end of the entry word in the guide word text."
//   h  "Use a dash to connect guide words."            (Example 21-9: aborig9al,--agogy)
//   i  "Shorten guide words when entry words are too long to fit."
//   j  "Use the last guide word from the previous page(s) followed by "(cont.)" when there are no new main entry
//      words on a braille page."                       (Example 21-11: keep "<3t4">)
// UKAAF B004 has no guide words (its page information line, §6, carries the section name), so UKAAF is unchanged.
// Emboss's own choice (K12 brief): an alphabetic reference that fits on one braille page gets none.
// Uses the real liblouis engine: guide words are contracted braille (Sample 21-3's "ac" is the shortform of according).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const W = 40;
const BANA = { mode: 'bana', standard: 'bana', width: W, depth: 25, translate, translateG1 };

const pagesOf = (brf) => brf.split('\f').map((p) => { const ls = p.split('\r\n'); if (ls[ls.length - 1] === '') ls.pop(); return ls; });
function format(doc, extra = {}) {
  const plain = formatDocument(doc, { ...BANA, ...extra });
  const traced = formatDocument(doc, { ...BANA, translatePos, ...extra });   // A39: the traced (editor) path lays out the same
  assert.equal(traced, plain, 'traced layout differs from the plain one');
  return pagesOf(plain);
}
const tr = (s) => translate(s).trim();
const lastLine = (page) => page[page.length - 1];
const numOf = (page) => lastLine(page).trim().split(/\s+/).pop();
// The guide-word text on a page's last line (the braille page number removed), or '' when there is none.
function guideOf(page) {
  const l = lastLine(page).replace(/\s+$/, '');
  const m = /^(\s*)(.*?)\s{3,}(#[A-J]+)$/.exec(l);
  if (m) return m[2];
  return /^#[A-J]+$/.test(l.trim()) ? '' : l.trim();
}
const long = (i) => `The meaning of this word number ${i} is written out at some length so that it runs over onto a second braille line.`;
const glossaryDoc = (terms, extra = {}) => ({
  title: 'Science Words',
  blocks: [
    { type: 'para', text: 'Chapter text before the glossary.' },
    { type: 'heading', level: 1, text: 'Glossary' },
    { type: 'list', kind: 'glossary', style: 'glossary', items: terms.map((t, i) => ({ term: t, def: long(i) })), ...extra },
  ],
});
const TERMS = ['Absorb', 'Acid', 'Adapt', 'Air', 'Algae', 'Amber', 'Angle', 'Atom', 'Axis', 'Bacteria', 'Balance', 'Battery', 'Bone', 'Cell', 'Climate', 'Comet', 'Crust', 'Current', 'Delta', 'Density', 'Desert', 'Energy', 'Erosion', 'Fossil', 'Friction', 'Gas', 'Gravity'];

// Which main entries start on each page: the lines that begin in cell 1 and start with an entry word's braille.
function entriesByPage(pages, terms) {
  return pages.map((p) => p.slice(1, -1).filter((l) => l && l[0] !== ' ').map((l) => terms.find((t) => l.startsWith(tr(t)))).filter(Boolean));
}
// 21.3.2c-e: centred, >= 3 blank cells before it, >= 3 between it and the page number.
function assertPlaced(page) {
  const l = lastLine(page);
  const num = numOf(page);
  const g = guideOf(page);
  assert.ok(g, `no guide words on: ${JSON.stringify(l)}`);
  const at = l.indexOf(g);
  assert.equal(at, Math.floor((W - g.length) / 2), `centred: ${JSON.stringify(l)}`);
  assert.ok(at >= 3, '21.3.2d: three blank cells before the first guide word');
  assert.ok(W - num.length - (at + g.length) >= 3, '21.3.2e: three blank cells before the braille page number');
  assert.ok(l.endsWith(num) && l.length === W, 'the braille page number stays at the right margin');
}

test('21.3.2a/c/h: a multi-page glossary gets its first and last main entry words, dash-joined, centred on line 25 of every page', () => {
  const pages = format(glossaryDoc(TERMS));
  const byPage = entriesByPage(pages, TERMS);
  const refPages = byPage.map((e, p) => (e.length ? p : -1)).filter((p) => p >= 0);
  assert.ok(refPages.length >= 2, `the glossary spans ${refPages.length} pages`);
  for (const p of refPages) {
    const e = byPage[p];
    assert.equal(guideOf(pages[p]), tr(`${e[0]}–${e[e.length - 1]}`), `page ${p + 1}`);
    assert.ok(guideOf(pages[p]).includes(',-'), '21.3.2h: the dash');
    assertPlaced(pages[p]);
  }
  // the glossary's first page: its title, then Absorb ... ; line 25 reads ",absorb,-,<last>"
  assert.ok(guideOf(pages[refPages[0]]).startsWith(`${tr('Absorb')},-`));
  // the page before the glossary (chapter text) has no guide words
  assert.equal(guideOf(pages[0]), '');
});

test('guide words go on the page-number line only: no page break or other line changes (compared with guide words off)', () => {
  const doc = glossaryDoc(TERMS);
  const on = format(doc), off = format(doc, { guideWords: false });
  assert.ok(on.some((p) => guideOf(p) !== ''), 'on by default in BANA');
  assert.equal(on.length, off.length);
  on.forEach((p, i) => {
    assert.deepEqual(p.slice(0, -1), off[i].slice(0, -1), `page ${i + 1} body`);
    assert.equal(numOf(p), numOf(off[i]));
  });
  assert.ok(off.every((p) => guideOf(p) === ''), 'guideWords: false turns them off');
  // the document option works from the model too (doc.guideWords, as the editor and a saved file carry it)
  assert.ok(format({ ...doc, guideWords: false }).every((p) => guideOf(p) === ''));
});

test('trace rows: the guide-word line is page furniture (no print source); every row still lines up', () => {
  const doc = glossaryDoc(TERMS);
  const trace = {};
  const brf = formatDocument(doc, { ...BANA, translatePos, trace });
  const pages = pagesOf(brf);
  const total = pages.reduce((n, p) => n + p.length, 0);
  assert.equal(trace.rows.length, total);
  assert.ok(pages.some((p) => guideOf(p) !== ''), 'the traced (editor) layout has the guide words');
  let row = 0;
  for (const p of pages) { row += p.length; assert.equal(trace.rows[row - 1], -1, 'line 25 has no source block'); assert.equal(trace.rowCells[row - 1], null); }
});

// Guards (pass before K12 too, and must keep passing): the cases that must NOT get guide words.
test('guard: a reference on one braille page gets no guide words', () => {
  const pages = format(glossaryDoc(['Acid', 'Base', 'Cell']));
  for (const p of pages) assert.equal(guideOf(p), '', JSON.stringify(lastLine(p)));
});

test('guard: UKAAF: no guide words (B004 has none); suppressHeader: no page-number line, nothing added', () => {
  const doc = glossaryDoc(TERMS);
  const uk = formatDocument(doc, { ...BANA, mode: 'ukaaf', standard: 'ukaaf' });
  for (const t of ['Absorb', 'Acid']) assert.ok(!uk.includes(`${tr(t)},-`), 'no dash-joined guide words in UKAAF');
  assert.equal(uk, formatDocument(doc, { ...BANA, mode: 'ukaaf', standard: 'ukaaf', guideWords: false }));
  assert.equal(formatDocument(doc, { ...BANA, suppressHeader: true }), formatDocument(doc, { ...BANA, suppressHeader: true, guideWords: false }));
});

test('an index: main entries only, without their page references (21.3.2a-b, 21.4.4); indexGuideWords: false omits them', () => {
  const items = [];
  const heads = ['Aegean Sea', 'Africa', 'Agriculture', 'Alphabet', 'Ancient Greece', 'Aqueducts', 'Athens', 'Babylon', 'Byzantium', 'Carthage', 'China', 'Crete'];
  heads.forEach((h, i) => {
    items.push({ text: `${h}, ${100 + i}, ${200 + i}, R${10 + i}` });
    for (let k = 0; k < 4; k++) items.push({ text: `subtopic ${k} of the ${h.toLowerCase()} entry, ${300 + k}`, level: 1 });
  });
  const doc = { title: 'History', blocks: [{ type: 'heading', level: 1, text: 'Index' }, { type: 'list', kind: 'index', items }] };
  const pages = format(doc);
  const byPage = entriesByPage(pages, heads);
  const refPages = byPage.map((e, p) => (e.length ? p : -1)).filter((p) => p >= 0);
  assert.ok(refPages.length >= 2);
  for (const p of refPages) {
    const e = byPage[p];
    const g = guideOf(pages[p]);
    assert.equal(g, tr(e.length > 1 ? `${e[0]}–${e[e.length - 1]}` : e[0]), `page ${p + 1}`);
    assert.ok(!/#/.test(g), 'no page references in the guide words');
    assert.ok(!/SUBTOPIC/i.test(g), '21.3.2b: no subentries');
    assertPlaced(pages[p]);
  }
  const noIdx = format(doc, { indexGuideWords: false });
  assert.ok(noIdx.every((p) => guideOf(p) === ''), 'an agency may omit them in indexes');
  // ... but a glossary keeps them with indexGuideWords off
  assert.ok(format(glossaryDoc(TERMS), { indexGuideWords: false }).some((p) => guideOf(p) !== ''));
});

test('21.3.2j: a page with no new main entry shows the last guide word followed by (cont.)', () => {
  // an index entry with so many subentries that a whole braille page holds nothing but them
  const items = [{ text: 'Keep, 12' }];
  for (let k = 0; k < 70; k++) items.push({ text: `keeping item number ${k}, ${20 + k}`, level: 1 });
  items.push({ text: 'Kettle, 44' });
  const doc = { title: 'House', blocks: [{ type: 'heading', level: 1, text: 'Index' }, { type: 'list', kind: 'index', items }] };
  const pages = format(doc);
  const byPage = entriesByPage(pages, ['Keep', 'Kettle']);
  const contPages = byPage.map((e, p) => (!e.length && pages[p].some((l) => /^\s{2}\S/.test(l)) ? p : -1)).filter((p) => p > 0);
  assert.ok(contPages.length >= 1, 'a page of subentries only');
  for (const p of contPages) {
    assert.equal(guideOf(pages[p]), tr('Keep (cont.)'), `page ${p + 1}`);
    assertPlaced(pages[p]);
  }
  assert.equal(guideOf(pages[contPages[0]]), `${tr('Keep')} "<3t4">`.toUpperCase(), 'Example 21-11: keep "<3t4">');
  // a glossary definition longer than a page: the page it runs onto (no new entry) is "(cont.)" too
  const huge = Array.from({ length: 60 }, (_, i) => `sentence ${i} of a very long definition.`).join(' ');
  const g = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'Glossary' }, { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'Keep', def: huge }, { term: 'Kettle', def: 'a pot.' }] }] };
  const gp = format(g);
  const k = entriesByPage(gp, ['Keep', 'Kettle']).findIndex((e) => e.includes('Keep'));
  assert.ok(k >= 0 && gp.length >= k + 3);
  assert.equal(guideOf(gp[k]), tr('Keep'), 'the page where Keep starts: one entry - one guide word');
  assert.equal(guideOf(gp[k + 1]), tr('Keep (cont.)'), 'the next page: the definition continues, no new entry');
});

test('21.3.2g and capitals/emphasis: capitals kept, emphasis and attached end punctuation dropped, no passage terminator', () => {
  const terms = TERMS.map((t, i) => (i === 0 ? 'Absorb:' : t));
  const items = terms.map((t, i) => ({ term: t, def: long(i), termSegments: [{ type: 'text', text: t, tf: 2 }] }));   // bold entry words
  items[items.length - 1] = { term: 'GRAVITY WELL OF EARTH', def: long(99) };
  const doc = { title: 'W', blocks: [{ type: 'heading', level: 1, text: 'Glossary' }, { type: 'list', kind: 'glossary', style: 'glossary', items }] };
  const pages = format(doc);
  const guides = pages.map(guideOf).filter(Boolean);
  assert.ok(guides.length >= 2);
  assert.ok(guides[0].startsWith(`${tr('Absorb')},-`), `no colon after Absorb: ${guides[0]}`);
  assert.ok(guides.every((g) => !g.includes('^2')), 'no bold indicators');
  const last = guides[guides.length - 1];
  assert.ok(last.includes(',,,'), 'the capitals passage of an all-capitals entry word is kept');
  assert.ok(!last.endsWith(",'"), 'Updates 21.3.2k: the capitals passage is not terminated');
});

test('bilingual glossary: the guide word is the entry word in the language the glossary is organised by (Sample 21-4)', () => {
  const pairs = ['anomie/desmandado', 'apathy/apatía', 'apprehension/aprensión', 'archive/archivo', 'argument/argumento', 'arid/árido', 'aroma/aroma', 'artist/artista', 'aspect/aspecto', 'atlas/atlas', 'author/autor', 'avenue/avenida', 'award/premio', 'axis/eje'];
  const items = pairs.map((p, i) => ({ term: p, def: long(i) }));
  const doc = { title: 'G', blocks: [{ type: 'heading', level: 1, text: 'Glossary' }, { type: 'list', kind: 'glossary', style: 'glossary', bilingual: true, items }] };
  const pages = format(doc);
  const g = pages.map(guideOf).filter(Boolean);
  assert.ok(g.length >= 2);
  assert.ok(g[0].startsWith(`${tr('anomie')},-`), g[0]);
  assert.ok(g.every((x) => !x.includes('_/')), 'no slash / second-language word');
});

test('21.3.2i: long entry words are shortened to fit, still centred with three blank cells either side', () => {
  const terms = TERMS.map((t, i) => (i === 0 ? 'Acetylsalicylic acid preparations' : (i === TERMS.length - 1 ? 'Acquired immune deficiency syndrome' : `${t} and its many relations`)));
  const pages = format(glossaryDoc(terms));
  const withGuides = pages.filter((p) => guideOf(p));
  assert.ok(withGuides.length >= 2);
  for (const p of withGuides) {
    assertPlaced(p);
    assert.ok(!/4$/.test(guideOf(p)), '"Do not add a period"');
  }
  assert.ok(guideOf(withGuides[0]).startsWith(tr('Acetyl')), guideOf(withGuides[0]));
});

test('21.3.2f / BANA 1.15.1f: with even page numbers omitted the guide words still appear, three blank cells clear of the right margin', () => {
  const pages = format(glossaryDoc(TERMS), { interpointOmitEven: true });
  const even = pages.filter((_, i) => i % 2 === 1 && guideOf(pages[i]));
  assert.ok(even.length >= 1);
  for (const p of even) {
    const l = lastLine(p);
    const g = l.trim();
    assert.ok(!/#[A-J]+$/.test(l), 'no braille page number');
    assert.equal(l.indexOf(g), Math.floor((W - g.length) / 2));
    assert.ok(W - l.length >= 3);
  }
});

test('a glossary split at print page turns is one reference: guide words continue across the pieces; a later paragraph ends it', () => {
  const half = Math.floor(TERMS.length / 2);
  const doc = {
    title: 'Science Words',
    blocks: [
      { type: 'heading', level: 1, text: 'Glossary' },
      { type: 'list', kind: 'glossary', style: 'glossary', items: TERMS.slice(0, half).map((t, i) => ({ term: t, def: long(i) })) },
      { type: 'pagenum', page: '201', text: '201' },
      { type: 'list', kind: 'glossary', style: 'glossary', items: TERMS.slice(half).map((t, i) => ({ term: t, def: long(i) })) },
      { type: 'heading', level: 1, text: 'Acknowledgments' },
      ...Array.from({ length: 30 }, (_, i) => ({ type: 'para', text: `Thanks to contributor number ${i} for help.` })),
    ],
  };
  const pages = format(doc);
  const byPage = entriesByPage(pages, TERMS);
  for (let p = 0; p < pages.length; p++) {
    const e = byPage[p];
    if (e.length) assert.equal(guideOf(pages[p]), tr(e.length > 1 ? `${e[0]}–${e[e.length - 1]}` : e[0]), `page ${p + 1}`);
  }
  const lastRef = byPage.map((e, p) => (e.length ? p : -1)).filter((p) => p >= 0).pop();
  for (let p = lastRef + 1; p < pages.length; p++) assert.equal(guideOf(pages[p]), '', `page ${p + 1} (acknowledgments) has none`);
});

test('guard: a bibliography (a plain list under its own heading) is not an alphabetic reference: no guide words', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ text: `Author${String.fromCharCode(65 + (i % 26))}, Name. A Book With A Longish Title Number ${i}. City: Publisher, 20${10 + (i % 10)}.` }));
  const pages = format({ title: 'B', blocks: [{ type: 'heading', level: 1, text: 'Bibliography' }, { type: 'list', items }] });
  assert.ok(pages.length >= 2);
  assert.ok(pages.every((p) => guideOf(p) === ''));
});

// ---------------------------------------------------------------------------------------------------------------
// K16 / BANA 21.9.4 "Guide Words in Foreign Language Texts" (Formats 2016 p. 21-23; unchanged by the June 2024 changes):
//   a  "Omit articles, reflexive pronouns, or other elements that precede foreign entry words when choosing guide-word text."
//   b  "Use only the initial entry word as a guide word when an entry consists of two or more foreign words. Use the first
//      two words of an entry when two or more consecutive entries have the same initial word."
// and 21.6.3b/d: a foreign entry word is uncontracted with the language's foreign alphabet signs ("canción" -> canci+n,
// Appendix D.4 ó = +), and "The language by which the glossary is organized should be used for guide words".
// A Spanish-organised bilingual reference (21.9.2) in an ordinary English book (no document option).
const es = (text) => ({ type: 'text', text, lang: 'es' });
const SPANISH = [
  ['el abrazo', 'abrazo'], ['la abuela', 'abuela'], ['el agua', 'agua'], ['el/la artista', 'artista', 'el/la'],
  ['la bota', 'bota'], ['las botas', 'botas'], ['el bote', 'bote'], ['el bote de vela', 'bote de'], ['el brazo', 'brazo'],
  ['la canción', 'canción'], ['la carta', 'carta'], ['la casa', 'casa'], ['la casa de campo', 'casa de'], ['el chico', 'chico'],
  ['la cuerda', 'cuerda'], ['pasear en bote', 'pasear'], ['el perro', 'perro'], ['la puerta', 'puerta'], ['la tienda', 'tienda'],
  ['la ventana', 'ventana'],
];
// Uncontracted braille of these words (BRF): plain letters, Spanish ó = + (Appendix D.4). Contracted they would differ:
// cuerda cu]da, carta c>ta, chico *ico, perro p]ro, puerta pu]ta, tienda ti5da, ventana v5tana, canción canci^/on.
const unc = (w) => w.toUpperCase().replace('Ó', '+').replace('/', '_/');
const spanishDoc = (extra = {}) => ({
  title: 'Spanish for Travellers',
  blocks: [
    { type: 'para', text: 'Chapter text before the glossary.' },
    { type: 'heading', level: 1, text: 'Glossary' },
    { type: 'list', kind: 'glossary', style: 'glossary', ...extra,
      items: SPANISH.map(([term, , lead], i) => ({ term, termSegments: [es(term)], def: long(i), ...(lead ? { lead } : {}) })) },
  ],
});
const spanishByPage = (pages) => pages.map((p) => p.slice(1, -1).filter((l) => l && l[0] !== ' ')
  .map((l) => [...SPANISH].sort((x, y) => y[0].length - x[0].length).find(([t]) => l.startsWith(unc(t) + ' ') || l === unc(t))).filter(Boolean));

test('21.9.4a-b: a bilingual reference - articles omitted, one foreign word (two when consecutive entries share it), uncontracted', () => {
  const pages = format(spanishDoc({ bilingual: true }));
  const byPage = spanishByPage(pages);
  const refPages = byPage.map((e, p) => (e.length ? p : -1)).filter((p) => p >= 0);
  assert.ok(refPages.length >= 2, `the reference spans ${refPages.length} pages`);
  assert.equal(byPage.flat().length, SPANISH.length, 'every entry starts in cell 1, uncontracted (21.6.3b)');
  const seen = [];
  for (const p of refPages) {
    const e = byPage[p];
    const a = e[0][1], b = e[e.length - 1][1];
    assert.equal(guideOf(pages[p]), a === b ? unc(a) : `${unc(a)},-${unc(b)}`, `page ${p + 1}`);
    assertPlaced(pages[p]);
    seen.push(guideOf(pages[p]));
  }
  // the rule's own cases are all on some page's line 25 or in the body between: check the words 21.9.4 chose
  assert.ok(seen[0].startsWith('ABRAZO,-'), `21.9.4a: "el" omitted: ${seen[0]}`);
  // guard: the same reference with no language recorded is English - contracted, articles kept (as before)
  const english = spanishDoc({ bilingual: true });
  for (const it of english.blocks[2].items) delete it.termSegments;
  const ge = format(english).map(guideOf).filter(Boolean);
  assert.ok(ge[0].startsWith(`${tr('el abrazo')},-`), ge[0]);
});
test('21.9.4: the guide-word choices, entry by entry (a: el / la / las / el/la omitted; b: "bote de", "casa de", "pasear")', () => {
  // Every entry on a page of its own (a long definition each): each page's guide word is that one entry's.
  const vlong = (i) => Array.from({ length: 9 }, () => long(i)).join(' ');
  const doc = spanishDoc({ bilingual: true });
  doc.blocks[2].items.forEach((it, i) => { it.def = vlong(i); });
  const pages = format(doc);
  const got = pages.map(guideOf).filter(Boolean);
  const want = SPANISH.map(([, g]) => unc(g));
  // each page shows its first and last entry; with one entry per page (plus runovers) that entry, or "X (cont.)"
  const words = new Set(got.flatMap((g) => g.replace(/ "<3T4">$/, '').split(',-')));
  for (const w of want) assert.ok(words.has(w), `${w} among ${[...words].join(' | ')}`);
  assert.ok(!got.some((g) => /(^|,-)(EL|LA|LAS) /.test(g)), 'no article in any guide word');
  assert.ok(!got.some((g) => /BOTE DE VELA|CASA DE CAMPO|PASEAR EN/.test(g)), '21.9.4b: never three words');
});
test('21.6.3d without 21.9: an English book\'s ordinary glossary with Spanish entries - guide words uncontracted Spanish, articles kept', () => {
  const pages = format(spanishDoc());
  const byPage = spanishByPage(pages);
  const refPages = byPage.map((e, p) => (e.length ? p : -1)).filter((p) => p >= 0);
  assert.ok(refPages.length >= 2);
  for (const p of refPages) {
    const e = byPage[p];
    const a = e[0][0], b = e[e.length - 1][0];
    assert.equal(guideOf(pages[p]), a === b ? unc(a) : `${unc(a)},-${unc(b)}`, `page ${p + 1}`);
  }
});
