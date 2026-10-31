// Class names (and ids) in a document are matched as WHOLE WORDS (Paul, 23 Oct 2026).
//
// The reader used String.includes on class and id strings, so a substring anywhere counted:
// <p class="headline"> and <p class="outline"> ("line") and <p class="universe"> ("verse") were
// read as verse and saved as <p class="bai-verse">; "toc" / "index" inside a longer word
// ("photocopy", "reindexed", id="autoc1") turned an ordinary list into a contents or index
// list. DTBook made from PDF/OCR or by other tools carries arbitrary class names.
//
// The rule (hasClassWord in input/load-audit.mjs, re-exported by input/parse.mjs): a wanted
// name matches only as a whole word of a class token. Words are separated by whitespace, '-'
// or '_'; case is ignored. A hyphenated needle ('bana-heading') matches when those words are
// consecutive inside one token ('bana-heading', 'bana-heading-before-box').
//
// Where a rule requires an EXISTING expectation to change: none. Every positive here (verse,
// poem-verse, Emboss's own bana-* / bai-* classes, real contents and index lists) is unchanged;
// only the false positives go.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const P = await import('../input/parse.mjs');
const { exportToNimasXml } = await import('../input/nimas-export.mjs');
const { parseDtbook } = P;

const wrap = (body, lvlAttrs = '') => `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1 ${lvlAttrs}><h1>T</h1>${body}</level1></bodymatter></book></dtbook>`;
const blocksOf = (body, lvlAttrs) => parseDtbook(wrap(body, lvlAttrs)).blocks.slice(1);   // without the heading
const saved = (body) => exportToNimasXml(parseDtbook(wrap(body)));

// ---------- the helper itself ----------
test('hasClassWord: the wanted name must be a whole word of a class token', () => {
  const has = P.hasClassWord;
  assert.equal(typeof has, 'function', 'hasClassWord is exported');
  // positives
  for (const c of ['verse', 'poem-verse', 'verse_line', 'Verse', 'VERSE', 'a verse b', 'x\tverse', 'verse-1', 'my_verse_here']) {
    assert.equal(has(c, 'verse'), true, `"${c}" has the word verse`);
  }
  // false positives of a plain substring test
  for (const c of ['headline', 'outline', 'inline', 'lines', 'universe', 'versed', 'reverse', 'inverse', 'diverse', 'versel', 'verse2']) {
    assert.equal(has(c, 'verse') || has(c, 'line'), false, `"${c}" is not verse or line`);
  }
  assert.equal(has('verse-line', 'line'), true);
  assert.equal(has('line-1', 'line'), true);
  assert.equal(has('headline', 'line'), false);
  assert.equal(has('outline', 'line'), false);
  assert.equal(has('lined', 'line'), false);
  // a needle in upper case is matched too
  assert.equal(has('poem-verse', 'VERSE'), true);
  // words belong to one token: two separate tokens do not make a hyphenated needle
  assert.equal(has('bana-heading', 'bana-heading'), true);
  assert.equal(has('bana-heading-before-box', 'bana-heading'), true);
  assert.equal(has('x bana-heading y', 'bana-heading'), true);
  assert.equal(has('bana-heading-before-box', 'bana-heading-before-box'), true);
  assert.equal(has('bana-heading', 'bana-heading-before-box'), false);
  assert.equal(has('urbana-heading', 'bana-heading'), false);
  assert.equal(has('bana heading', 'bana-heading'), false);
  assert.equal(has('bana-x-heading', 'bana-heading'), false);
  assert.equal(has('bana-headings', 'bana-heading'), false);
  assert.equal(has('bana_heading', 'bana-heading'), true);   // '_' and '-' are both separators
  // toc / index as a class or an id
  assert.equal(has('toc', 'toc'), true);
  assert.equal(has('toc-text', 'toc'), true);
  assert.equal(has('bai-toc-entry', 'toc-entry'), true);
  assert.equal(has('photocopy', 'toc'), false);
  assert.equal(has('autoc1', 'toc'), false);
  assert.equal(has('reindexed', 'index'), false);
  assert.equal(has('indexing', 'index'), false);
  assert.equal(has('index-of-terms', 'index'), true);
  // nothing to match
  assert.equal(has('', 'verse'), false);
  assert.equal(has(null, 'verse'), false);
  assert.equal(has(undefined, 'verse'), false);
  assert.equal(has('verse', ''), false);
  assert.equal(has('verse', null), false);
});

// ---------- false positives: an ordinary paragraph stays a paragraph ----------
for (const cls of ['headline', 'outline', 'universe', 'versed', 'inline', 'reverse', 'subline', 'poemlike']) {
  test(`<p class="${cls}"> stays an ordinary paragraph (not verse, not bai-verse)`, () => {
    const b = blocksOf(`<p class="${cls}">Some ordinary words here</p>`);
    assert.deepEqual(b, [{ type: 'para', text: 'Some ordinary words here' }], JSON.stringify(b));
    assert.ok(!/bai-verse/.test(saved(`<p class="${cls}">Some ordinary words here</p>`)), 'not saved as bai-verse');
  });
}

test('words that merely contain speaker / stage / quote / author / byline stay ordinary paragraphs', () => {
  for (const cls of ['backstage', 'stagehand', 'requote', 'unquoted', 'authority', 'coauthored', 'bylines', 'extracted', 'blockedin', 'loudspeakers']) {
    const b = blocksOf(`<p class="${cls}">Plain words.</p>`);
    assert.deepEqual(b, [{ type: 'para', text: 'Plain words.' }], `${cls}: ${JSON.stringify(b)}`);
  }
});

test('a div whose class merely contains poem / verse / stanza / sidebar is not a poem or a box', () => {
  for (const cls of ['universe', 'headline', 'stanzas', 'sidebarlike', 'poemlike']) {
    const b = blocksOf(`<div class="${cls}"><p>Words in a div.</p></div>`);
    assert.ok(b.every((x) => x.type === 'para' && x.text === 'Words in a div.' && !x.bareLinegroup && !x.blockKind), `${cls}: ${JSON.stringify(b)}`);
    assert.ok(!b.some((x) => x.type === 'box' || x.type === 'sidebar' || x.type === 'play' || x.type === 'poem'), `${cls}: ${JSON.stringify(b)}`);
  }
});

// ---------- false positives: an ordinary list stays ordinary ----------
const LIST = (attrs) => `<list type="pl" ${attrs}><li>alpha 3</li><li>beta 5</li></list>`;
test('a list whose class or id merely contains toc or index is an ordinary list', () => {
  const plain = blocksOf(LIST(''));
  assert.notEqual(plain[0].kind, 'toc');
  assert.notEqual(plain[0].kind, 'index');
  for (const attrs of ['class="photocopy"', 'id="autoc1"', 'class="reindexed"', 'id="indexing"', 'class="stockton"', 'id="outdexterity"']) {
    assert.deepEqual(blocksOf(LIST(attrs)), plain, attrs);
  }
});

test('a list inside a container whose class or id merely contains toc or index is ordinary', () => {
  const plain = blocksOf(LIST(''));
  assert.deepEqual(blocksOf(LIST(''), 'class="photocopy"'), plain);
  assert.deepEqual(blocksOf(LIST(''), 'id="autoc1"'), plain);
  assert.deepEqual(blocksOf(LIST(''), 'class="reindexed"'), plain);
});

test('a contents entry is made only by a component whose class has the word page (not homepage)', () => {
  // (the second component's text is not a bare page number, so only its class can make this a contents entry)
  const entry = (cls) => `<list type="pl"><li><lic>Chapter one</lic><lic class="${cls}">page twelve</lic></li></list>`;
  const real = blocksOf(entry('toc-page'))[0];
  assert.equal(real.kind, 'toc');
  const homepage = blocksOf(entry('homepage'))[0];
  assert.notEqual(homepage.kind, 'toc', JSON.stringify(homepage));
});

test('a table whose class merely contains listed / vertical / spatial keeps its default format', () => {
  const t = (cls) => blocksOf(`<table class="${cls}"><tr><td>a</td><td>b</td></tr></table>`)[0];
  const plain = t('');
  for (const cls of ['unlisted', 'nonvertical', 'aspatial', 'verticals']) {
    assert.equal(t(cls).format, plain.format, `${cls}: ${t(cls).format}`);
  }
});

test('a linenum test is on the word, not a substring of a class', () => {
  const b = blocksOf('<p>Words before <span class="outlinenumbers">12</span> and after.</p>');
  assert.equal(JSON.stringify(b).includes('linenum'), false, JSON.stringify(b));
  const real = blocksOf('<p>Words before <span class="linenum">12</span> and after.</p>');
  assert.equal(JSON.stringify(real).includes('linenum'), true, JSON.stringify(real));
});

// ---------- positives still work ----------
test('class="verse", "poem-verse", "Verse" and "line" are verse lines; bai-verse is a verse-play line', () => {
  for (const cls of ['verse', 'poem-verse', 'Verse', 'poem', 'line', 'verse_line']) {
    const b = blocksOf(`<p class="${cls}">Roses are red</p>`);
    assert.equal(b.length, 1, cls);
    assert.equal(b[0].type, 'play', cls);
    assert.equal(b[0].subtype, 'verse', cls);
    assert.ok(!b[0].playVerse, `${cls}: only the Emboss class marks a verse play`);
  }
  for (const cls of ['bai-verse', 'play-verse']) {
    const b = blocksOf(`<p class="${cls}">Roses are red</p>`);
    assert.equal(b[0].subtype, 'verse', cls);
    assert.equal(b[0].playVerse, true, cls);
  }
  assert.match(saved('<p class="verse">Roses are red</p>'), /<p class="bai-verse">Roses are red<\/p>/);
});

// "byline" contains "line", and the verse test ran before the byline test, so every
// <p class="byline"> was read as a verse line (found by this sweep, 23 Oct 2026).
test('<p class="byline"> / "author" / "attribution" are attributions, not verse lines', () => {
  for (const cls of ['byline', 'author', 'attribution', 'book-author']) {
    const b = blocksOf(`<p class="${cls}">By Jo Bloggs</p>`);
    assert.equal(b[0].type, 'attribution', `${cls}: ${JSON.stringify(b)}`);
  }
});

test('the other class words still work: speaker, stage, quote, blocked, stanza-break', () => {
  assert.equal(blocksOf('<p class="speaker">HAMLET</p>')[0].style, 'play-speaker');
  assert.equal(blocksOf('<p class="bai-play">HAMLET</p>')[0].style, 'play-speaker');
  assert.equal(blocksOf('<p class="stage-direction">Exit</p>')[0].type, 'stage');
  assert.equal(blocksOf('<p class="bai-stage">Exit</p>')[0].type, 'stage');
  assert.equal(blocksOf('<p class="block-quote">Quoted words.</p>')[0].style, 'quote');
  assert.equal(blocksOf('<p class="extract">Quoted words.</p>')[0].style, 'quote');
  assert.equal(blocksOf('<p class="blocked">Words.</p>')[0].blocked, true);
  assert.equal(blocksOf('<p class="stanza-break"></p>')[0].kind, 'line');
  assert.equal(blocksOf('<p class="bai-stanza-break"></p>')[0].kind, 'line');
});

test('a real contents list and a real index are still recognised (class, id, container, heading)', () => {
  assert.equal(blocksOf(LIST('class="toc"'))[0].kind, 'toc');
  assert.equal(blocksOf(LIST('id="my-toc"'))[0].kind, 'toc');
  assert.equal(blocksOf(LIST('id="toc"'))[0].kind, 'toc');
  assert.equal(blocksOf(LIST('class="book_toc main"'))[0].kind, 'toc');
  assert.equal(blocksOf(LIST(''), 'class="toc"')[0].kind, 'toc');
  assert.equal(blocksOf(LIST('class="index"'))[0].kind, 'index');
  assert.equal(blocksOf(LIST('id="subject-index"'))[0].kind, 'index');
  assert.equal(blocksOf(LIST(''), 'id="index"')[0].kind, 'index');
  // by its own rule a name that has the word index IS an index, however long the id
  assert.equal(blocksOf(LIST('id="index-of-terms-something"'))[0].kind, 'index');
  // contents entries read their own text and page components
  const e = blocksOf('<list type="pl" class="toc"><li class="toc-entry"><lic class="toc-text">Chapter one</lic><lic class="toc-page">12</lic></li></list>')[0];
  assert.equal(e.kind, 'toc');
  assert.equal(e.items[0].text, 'Chapter one');
  assert.equal(String(e.items[0].page), '12');
  // headings name them too
  const afterHeading = parseDtbook(wrap('<hd>Contents</hd>' + LIST(''))).blocks.find((b) => b.type === 'list');
  assert.ok(afterHeading);
  const idx = blocksOf('<list type="pl"><li><lic class="index-line">alpha</lic><lic class="index-pg">3</lic></li></list>')[0];
  assert.equal(idx.kind, 'index');
});

test('page components: page, pagenum, pg, pageno as words of a component class', () => {
  const entry = (cls) => `<list type="pl"><li><lic class="title">Chapter one</lic><lic class="${cls}">page twelve</lic></li></list>`;
  for (const cls of ['page', 'pagenum', 'pg', 'pageno', 'toc-pg', 'toc_page', 'page-number', 'Page']) {
    assert.equal(blocksOf(entry(cls))[0].kind, 'toc', cls);
  }
});

// Emboss's own bana-* / bai-* classes survive a save and reopen.
test('Emboss\'s own bana-* / bai-* classes round-trip through exportToNimasXml -> parseDtbook', () => {
  const src = wrap(
    '<p class="bai-play">HAMLET</p><p class="bai-verse">To be, or not to be</p><p class="bai-stage">Exit</p>'
    + '<table class="bana-listed"><tr><td>a</td><td>b</td></tr></table>'
    + '<table class="bana-vertical"><tr><td>a</td><td>b</td></tr></table>'
    + '<table class="bana-stairstep"><tr><td>a</td><td>b</td></tr></table>'
    + '<table class="bana-linear"><tr><td>a</td><td>b</td></tr></table>'
    + '<table class="bana-facing"><tr><td>a</td><td>b</td></tr></table>'
    + '<table class="bana-interchange"><tr><td>a</td><td>b</td></tr></table>'
    + '<table class="bana-spatial"><tr><td>a</td><td>b</td></tr></table>'
    + '<list type="pl" class="toc"><li class="bai-toc-entry"><lic class="bai-toc-text">Chapter one</lic><lic class="bai-toc-page">12</lic></li></list>'
    + '<list type="pl" class="bai-index"><li class="bai-index">alpha, 3</li><li class="bai-index">beta, 5</li></list>'
    + '<p class="bana-break-asterisks"></p><p class="bana-break-dot2s"></p>'
    + '<sidebar><hd>Box title</hd><p>Inside the box.</p><p class="blocked">Blocked paragraph.</p></sidebar>',
  );
  const d1 = parseDtbook(src);
  const kinds1 = d1.blocks.filter((b) => b.type === 'table').map((b) => b.format);
  assert.deepEqual(kinds1, ['listed', 'vertical', 'stairstep', 'linear', 'facing', 'interchange', 'spatial']);
  const xml = exportToNimasXml(d1);
  const d2 = parseDtbook(xml);
  assert.deepEqual(d2.blocks.filter((b) => b.type === 'table').map((b) => b.format), kinds1);
  assert.deepEqual(d2.blocks.filter((b) => b.type === 'list').map((b) => b.kind), d1.blocks.filter((b) => b.type === 'list').map((b) => b.kind));
  assert.deepEqual(d2.blocks.filter((b) => b.type === 'play').map((b) => [b.style, !!b.playVerse]), d1.blocks.filter((b) => b.type === 'play').map((b) => [b.style, !!b.playVerse]));
  assert.deepEqual(d2.blocks.filter((b) => b.type === 'break').map((b) => b.kind), ['asterisks', 'dot2s']);
  assert.deepEqual(d2.blocks.map((b) => b.type), d1.blocks.map((b) => b.type));
  assert.equal(JSON.stringify(d2.blocks), JSON.stringify(d1.blocks));
});

// An unrelated phrase inside a class must not be read as Emboss's own class either.
test('a class that merely contains bana- inside a longer word is not an Emboss class', () => {
  const b = blocksOf('<p class="urbana-heading">Words.</p>');
  assert.deepEqual(b, [{ type: 'para', text: 'Words.' }]);
});
