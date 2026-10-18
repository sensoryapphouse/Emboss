// eBraille export: structured, reflowable and split into several content documents.
//
// Paul, 1 Oct 2026 (feedback: "Our exported eBraille does not fully exploit the eBraille file format for large
// documents as it is monolithic"): the export is built from the document model, not from the embosser pages. The old
// form - one XHTML per volume, every braille line a <p>, a contents list of one entry, no page list, no headings -
// is dropped, not kept as an option (BRF and PEF already cover embossing). This pins the new form:
//   - one content document per top-level section (level-1 heading; level 2 when there is no level 1; one for no
//     headings), the front matter in a document of its own, a very large section divided further;
//   - h1-h6 with ids, p, ul/ol with the marker inside each item (eBraille 1.0 6.2.2), table/th/td, footnotes linked
//     from their reference (role doc-noteref / doc-footnote), transcriber's notes, poetry, code;
//   - print page numbers as role="doc-pagebreak" markers and a page list whose entries carry the print number in a
//     title attribute (8.3.2), with schema:accessibilityFeature printPageNumbers declared (a11y:pageBreakSource, which the
//     spec's example shows, is not in the a11y vocabulary and the DAISY checker rejects it - OPF-027);
//   - a nested table of contents built from the headings; a stylesheet for the BANA or UKAAF layout;
//   - braille and whitespace only in every piece of text (the checker's EBR-030), and no wrapped lines.
// Run:  node Emboss/tests/ebraille_structure.test.mjs
import assert from 'node:assert/strict';
import { exportToEbraille } from '../format/ebraille.mjs';
import { unzip } from '../../Translate/unmxl.mjs';

let pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}`); console.error(e); process.exitCode = 1; }
}

const up = (s) => String(s).toUpperCase();
const opts = (mode = 'bana', extra = {}) => ({ mode, standard: mode, width: 40, depth: 25, translate: up, language: 'en-US', ...extra });
const dec = new TextDecoder();
const open = async (bytes) => {
  const files = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const text = (n) => { const d = files.get(n); return d ? dec.decode(d) : null; };
  const opf = text('package.opf');
  const manifest = {};
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]*)"/.exec(m[0])?.[1], href = /\bhref="([^"]*)"/.exec(m[0])?.[1], type = /media-type="([^"]*)"/.exec(m[0])?.[1];
    if (id) manifest[id] = { href, type };
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]*)"/g)].map((m) => manifest[m[1]].href);
  return { files, text, opf, manifest, spine, index: text('index.html'), docs: spine.map((h) => ({ href: h, html: text(h) })) };
};
// the rendered text of a page: everything outside tags, scripts, styles and the head
const bodyText = (html) => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '');
const brailleOnly = (t) => /^[⠀-⣿\s]*$/.test(t);

const BOOK = {
  title: 'Structure Test', author: 'A. Author',
  blocks: [
    { type: 'heading', level: 1, text: 'Chapter One' },
    { type: 'pagenum', page: '1', text: '1', id: 'p1' },
    { type: 'para', segments: [{ type: 'text', text: 'Hello world' }, { type: 'noteref', text: '1', idref: 'n1' }, { type: 'text', text: ' and more.' }], text: 'Hello world1 and more.' },
    { type: 'footnote', id: 'n1', text: '1 A note.', segments: [{ type: 'text', text: '1 A note.' }] },
    { type: 'list', items: [{ text: 'Apples', marker: '•' }, { text: 'Pears', marker: '•' }] },
    { type: 'list', items: [{ text: 'First', marker: '1.' }, { text: 'Second', marker: '2.' }] },
    { type: 'table', headers: ['Name', 'Age'], rows: [['Ann', '5'], ['Bob', '7']] },
    { type: 'heading', level: 2, text: 'A Section' },
    { type: 'para', text: 'Text of the section.' },
    { type: 'pagenum', page: '2', text: '2', id: 'p2' },
    { type: 'para', text: 'More text on page two.' },
    { type: 'heading', level: 1, text: 'Chapter Two' },
    { type: 'para', text: 'Chapter two begins.' },
    { type: 'note', text: "Transcriber's Note: a note." },
    { type: 'play', subtype: 'verse', text: 'Roses are red' },
    { type: 'play', subtype: 'verse', text: 'Violets are blue' },
    { type: 'code', text: 'a = 1\nb = 2' },
    { type: 'graphic', title: 'Circle', alt: 'A circle', svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' },
  ],
};

console.log('--- eBraille: structure ---');

await test('one content document per level-1 heading, the spine in order', async () => {
  const e = await open(exportToEbraille(structuredClone(BOOK), opts()));
  assert.ok(e.docs.length >= 2, `content documents: ${e.docs.length}`);
  const withH1 = e.docs.filter((d) => /<h1\b/.test(d.html));
  assert.equal(withH1.length, 2, 'Chapter One and Chapter Two each open a document');
  assert.ok(withH1.every((d) => (d.html.match(/<h1\b/g) || []).length === 1), 'a document holds one top-level section');
  assert.ok(!e.spine.includes('index.html'), 'the entry page is not in the spine');
});

await test('headings, lists, tables, notes, poetry, code and transcriber\'s notes are elements', async () => {
  const e = await open(exportToEbraille(structuredClone(BOOK), opts()));
  const all = e.docs.map((d) => d.html).join('\n');
  assert.match(all, /<h1\b[^>]*\bid="[^"]+"/);
  assert.match(all, /<h2\b[^>]*\bid="[^"]+"/);
  assert.match(all, /<ul\b/); assert.match(all, /<ol\b/); assert.match(all, /<li\b/);
  assert.match(all, /<table\b/); assert.match(all, /<th\b/); assert.match(all, /<td\b/);
  assert.match(all, /role="doc-noteref"/); assert.match(all, /role="doc-footnote"/);
  assert.match(all, /transcriber-note/);
  assert.match(all, /class="[^"]*poetry/);
  assert.match(all, /<img src="[^"]*graphic-1\.svg"/);
  // the reference links to the note
  const href = /<a\b[^>]*role="doc-noteref"[^>]*href="([^"]+)"|<a\b[^>]*href="([^"]+)"[^>]*role="doc-noteref"/.exec(all);
  assert.ok(href, 'a note reference is a link');
  const target = (href[1] || href[2]).split('#')[1];
  assert.ok(new RegExp(`id="${target}"`).test(all), `the note ${target} exists`);
});

await test('a list item carries its marker; the list is not left to CSS numbering', async () => {
  const e = await open(exportToEbraille(structuredClone(BOOK), opts()));
  const all = e.docs.map((d) => d.html).join('\n');
  const ol = /<ol\b[^>]*>([\s\S]*?)<\/ol>/.exec(all)[1];
  const items = [...ol.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => bodyText(m[1]).trim());
  assert.equal(items.length, 2);
  assert.ok(items[0].length > 'FIRST'.length, 'the numeral is inside the item (braille ⠼⠁ plus the text)');
});

await test('nested lists: a sub list sits inside its parent item, and a jump of levels never puts an <li> in an <li>', async () => {
  const items = [{ text: 'A', marker: '1.', level: 1 }, { text: 'B', marker: '2.', level: 0 }, { text: 'C', marker: 'a.', level: 1 }, { text: 'D', marker: 'i.', level: 3 }, { text: 'E', marker: '3.', level: 0 }];
  for (const mode of ['bana', 'ukaaf']) {
    const e = await open(exportToEbraille({ title: 'Lists', blocks: [{ type: 'list', items }] }, opts(mode)));
    const html = e.docs[0].html;
    assert.ok(!/<li\b[^>]*>\s*<li\b/.test(html), `${mode}: li in li`);
    assert.ok(/<li\b[^>]*>[^<]*<ol>/.test(html), `${mode}: a sub list opens inside its parent item`);
    assert.ok((html.match(/<li\b/g) || []).length >= 5, `${mode}: every item is there (a level the list starts at, or jumps to, gets an empty item to hold its list)`);
    assert.equal((html.match(/<ol\b/g) || []).length, (html.match(/<\/ol>/g) || []).length, `${mode}: balanced`);
  }
});

await test('text is not wrapped: a long paragraph is one <p>', async () => {
  const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const e = await open(exportToEbraille({ title: 'Long', blocks: [{ type: 'para', text: long }] }, opts()));
  const all = e.docs.map((d) => d.html).join('\n');
  const paras = [...all.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)];
  assert.equal(paras.length, 1, 'one paragraph, not one per braille line');
  assert.ok(bodyText(paras[0][1]).trim().length > 1500);
});

await test('print page numbers: markers in the text, a page list with title attributes, printPageNumbers declared', async () => {
  const e = await open(exportToEbraille(structuredClone(BOOK), opts()));
  const all = e.docs.map((d) => d.html).join('\n');
  assert.equal((all.match(/role="doc-pagebreak"/g) || []).length, 2);
  assert.match(e.index, /<nav\b[^>]*epub:type="page-list"[^>]*role="doc-pagelist"|<nav\b[^>]*role="doc-pagelist"[^>]*epub:type="page-list"/);
  const pl = /epub:type="page-list"[\s\S]*?<\/nav>/.exec(e.index)[0];
  assert.match(pl, /<a\b[^>]*title="1"/); assert.match(pl, /<a\b[^>]*title="2"/);
  assert.ok(!/<ol>[\s\S]*<ol>/.test(pl), 'a page list is not nested');
  assert.match(e.opf, /schema:accessibilityFeature">printPageNumbers</);
  assert.ok(!/pageBreakSource/.test(e.opf), 'a11y:pageBreakSource is not a defined property (checker OPF-027)');
  // every page-list target exists
  for (const m of pl.matchAll(/href="([^"]+)"/g)) {
    const [file, id] = m[1].split('#');
    assert.ok(e.docs.find((d) => d.href === file)?.html.includes(`id="${id}"`), `page-list target ${m[1]}`);
  }
});

await test('a nested table of contents from the headings, linking to their ids', async () => {
  const e = await open(exportToEbraille(structuredClone(BOOK), opts()));
  const toc = /<nav\b[^>]*role="doc-toc"[\s\S]*?<\/nav>/.exec(e.index)[0];
  assert.match(toc, /<li>\s*<a\b[^>]*>[^<]*<\/a>\s*<ol>/, 'the level-2 heading nests under its chapter');
  const links = [...toc.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 3, 'two chapters and a section');
  for (const l of links) {
    const [file, id] = l.split('#');
    const doc = e.docs.find((d) => d.href === file);
    assert.ok(doc, `TOC target file ${file}`);
    if (id) assert.ok(doc.html.includes(`id="${id}"`), `TOC target ${l}`);
  }
  assert.ok(brailleOnly(bodyText(toc)), 'TOC text is braille');
});

await test('every piece of rendered text is braille or whitespace', async () => {
  for (const mode of ['bana', 'ukaaf']) {
    const e = await open(exportToEbraille(structuredClone(BOOK), opts(mode)));
    for (const d of e.docs) assert.ok(brailleOnly(bodyText(d.html)), `${mode} ${d.href}`);
    assert.ok(brailleOnly(bodyText(e.index)), `${mode} index`);
    for (const m of e.docs.map((d) => d.html).join('').matchAll(/\b(?:alt|aria-label)="([^"]*)"/g)) assert.ok(brailleOnly(m[1]), `attribute ${m[1]}`);
  }
});

await test('a stylesheet for the layout is in the package and linked from every content document', async () => {
  for (const mode of ['bana', 'ukaaf']) {
    const e = await open(exportToEbraille(structuredClone(BOOK), opts(mode)));
    const css = Object.values(e.manifest).find((m) => m.type === 'text/css');
    assert.ok(css, 'a text/css item in the manifest');
    const sheet = e.text(css.href);
    // paragraphs 3-1, centred level-1 headings, hanging list items - without any text-* property, which the checker
    // (EBR-051) warns about, text-indent and text-align included
    assert.match(sheet, /\bp::before\s*\{[^}]*width:\s*2ch/);              // paragraphs 3-1: first line two cells in
    assert.match(sheet, /\.centered\s*\{[^}]*margin-left:\s*auto/);          // centred headings
    assert.match(sheet, /\bli::before\s*\{[^}]*margin-left:\s*-2ch/);        // hanging indent
    assert.ok(!/text-|font|color/.test(sheet), 'no text-*, font or colour properties (6.3.2; checker EBR-051)');
    assert.ok(!/[0-9]\s*(px|pt|cm|mm|in)\b/.test(sheet), 'font-relative lengths only (6.3.2)');
    for (const d of e.docs) assert.ok(d.html.includes(css.href.split('/').pop()), `${d.href} links ${css.href}`);
  }
});

await test('a document with no level-1 heading splits at level 2; with no headings it is one document', async () => {
  const h2 = { title: 'H2', blocks: [{ type: 'heading', level: 2, text: 'One' }, { type: 'para', text: 'a' }, { type: 'heading', level: 2, text: 'Two' }, { type: 'para', text: 'b' }] };
  assert.equal((await open(exportToEbraille(h2, opts()))).docs.length, 2);
  const none = { title: 'None', blocks: [{ type: 'para', text: 'a' }, { type: 'para', text: 'b' }] };
  assert.equal((await open(exportToEbraille(none, opts()))).docs.length, 1);
});

await test('front matter before the first top-level heading is a document of its own', async () => {
  const d = { title: 'Front', blocks: [{ type: 'para', text: 'Copyright line.' }, { type: 'heading', level: 1, text: 'One' }, { type: 'para', text: 'a' }, { type: 'heading', level: 1, text: 'Two' }, { type: 'para', text: 'b' }] };
  const e = await open(exportToEbraille(d, opts()));
  assert.equal(e.docs.length, 3);
  assert.ok(!/<h1\b/.test(e.docs[0].html) && e.docs[0].html.includes('<p'));
});

await test('a very large section is divided further, at print page breaks where it can', async () => {
  const blocks = [{ type: 'heading', level: 1, text: 'Big' }];
  for (let p = 1; p <= 40; p++) {
    blocks.push({ type: 'pagenum', page: String(p), text: String(p) });
    for (let k = 0; k < 20; k++) blocks.push({ type: 'para', text: `Page ${p} paragraph ${k} ` + 'lorem ipsum dolor sit amet '.repeat(30) });
  }
  const e = await open(exportToEbraille({ title: 'Big', blocks }, opts()));
  assert.ok(e.docs.length >= 3, `documents: ${e.docs.length}`);
  for (const d of e.docs) assert.ok(d.html.length < 600000, `${d.href} is ${d.html.length} bytes`);
  assert.equal(e.docs.filter((d) => /<h1\b/.test(d.html)).length, 1);
  assert.ok(e.docs.slice(1).every((d) => /^\s*(<div[^>]*role="doc-pagebreak"|<p)/.test(d.html.split('<body>')[1].trim())), 'a later part starts at a page break or a paragraph');
});

await test('the package still declares what the old export declared', async () => {
  const e = await open(exportToEbraille(structuredClone(BOOK), opts('bana', { brailleSystem: 'ueb grade2' })));
  assert.match(e.opf, /<dc:language>en-Brai-US<\/dc:language>/);
  assert.match(e.opf, /a11y:brailleSystem">ueb grade2</);
  assert.match(e.opf, /a11y:tactileGraphics">SVG</);
  assert.match(e.opf, /a11y:brailleCellType">6</);
  assert.match(e.index, /<link rel="publication" href="package\.opf"/);
});

await test('no silent default translator', () => {
  assert.throws(() => exportToEbraille({ title: 'x', blocks: [] }, { width: 40 }), /translate/);
});

console.log(`\n${pass} eBraille structure tests passed`);
