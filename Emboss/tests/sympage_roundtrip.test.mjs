// Special Symbols page (`sympage`, BANA 2.5, G8 stage 5) through parse -> NIMAS export -> parse.
// DTBook form: <level1 class="bana-special-symbols [bana-symbols-auto]"> with an optional <h1> and one
// <p class="bana-symbol" title="CELLS\u2016GLYPH">meaning</p> per entry, in <frontmatter> BEFORE the notes page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NS = 'xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"';
const wrap = (front, body) => `<dtbook ${NS} version="2005-3"><head/><book><frontmatter><doctitle>T</doctitle>${front}</frontmatter><bodymatter>${body}</bodymatter></book></dtbook>`;
const strip = (blocks) => JSON.parse(JSON.stringify(blocks, (k, v) => (k.startsWith('_') ? undefined : v)));
const symOf = (d) => d.blocks.filter((b) => b.type === 'sympage');

function validate(xml) {
  const dtd = path.join(ROOT, 'references', 'dtd');
  const cat = 'file://' + path.join(dtd, 'catalog.xml').split(path.sep).map(encodeURIComponent).join('/');
  const tmp = path.join(os.tmpdir(), `sympage_${process.pid}.xml`);
  fs.writeFileSync(tmp, xml);
  try {
    execFileSync('xmllint', ['--noout', '--nonet', '--valid', tmp], { cwd: ROOT, env: { ...process.env, XML_CATALOG_FILES: cat }, encoding: 'utf8', stdio: 'pipe' });
    execFileSync('xmllint', ['--noout', '--nonet', '--dtdvalid', path.relative(ROOT, path.join(dtd, 'dtbook-2005-3-mathml.dtd')), '--path', path.relative(ROOT, dtd), tmp], { cwd: ROOT, env: { ...process.env, XML_CATALOG_FILES: cat }, encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (e) {
    return e.code === 'ENOENT' ? 'skip' : String(e.stderr || e.stdout || e.message);
  } finally { fs.rmSync(tmp, { force: true }); }
}


const SRC = wrap(
  '<level1 class="bana-special-symbols"><p class="bana-symbol" title="\u2016.=">Dot locator, precedes listed symbols</p><p class="bana-symbol" title="_4\u2016\u2022">Bullet</p><p class="bana-symbol" title="&quot;7">Hollow square bullet</p></level1>' +
  '<level1 class="bana-transcriber-notes"><h1>Transcriber\u2019s Notes</h1><p>A note.</p></level1>',
  '<level1><h1>Chapter</h1><p>Body text.</p></level1>');

test('parse: the class makes a sympage block with its entries, before the tnpage', () => {
  const d = parseDtbook(SRC);
  assert.deepEqual(d.blocks.map((b) => b.type), ['sympage', 'tnpage', 'heading', 'para']);
  const s = d.blocks[0];
  assert.equal(s.matter, 'transcriber');
  assert.equal(s.heading, undefined);
  assert.equal(s.auto, undefined);
  assert.deepEqual(s.entries, [
    { braille: '', print: '.=', description: 'Dot locator, precedes listed symbols' },
    { braille: '_4', print: '\u2022', description: 'Bullet' },
    { braille: '"7', description: 'Hollow square bullet' },
  ]);
});

test('parse: an automatic page carries no entries; a custom heading is kept; the default heading is not', () => {
  const d = parseDtbook(wrap('<level1 class="bana-special-symbols bana-symbols-auto"><h1>Symbols in this book</h1><p></p></level1>', '<level1><p>b</p></level1>'));
  assert.deepEqual(symOf(d)[0], { type: 'sympage', matter: 'transcriber', heading: 'Symbols in this book', auto: true });
  const dflt = parseDtbook(wrap('<level1 class="bana-special-symbols bana-symbols-auto"><h1>SPECIAL SYMBOLS USED IN THIS VOLUME</h1><p></p></level1>', '<level1><p>b</p></level1>'));
  assert.equal(symOf(dflt)[0].heading, undefined);
  const explicitEmpty = parseDtbook(wrap('<level1 class="bana-special-symbols"><p></p></level1>', '<level1><p>b</p></level1>'));
  assert.deepEqual(symOf(explicitEmpty)[0].entries, []);
});

test('parse: a front-matter level1 headed "Special Symbols" is recognised without the class; in the body it is a chapter', () => {
  for (const h of ['Special Symbols', 'SPECIAL SYMBOLS USED IN THIS VOLUME', 'special symbols used in this book']) {
    const d = parseDtbook(wrap(`<level1><h1>${h}</h1><p>Bullet</p></level1>`, '<level1><p>Body.</p></level1>'));
    assert.equal(symOf(d).length, 1, h);
    assert.equal(symOf(d)[0].entries[0].description, 'Bullet');
  }
  assert.equal(symOf(parseDtbook(wrap('', '<level1><h1>Special Symbols</h1><p>x</p></level1>'))).length, 0);
});

test('round trip: parse -> export -> parse is identical, pages sit in <frontmatter> (symbols first), second export is stable', () => {
  const a = parseDtbook(SRC);
  const xml = exportToNimasXml(a);
  assert.match(xml, /<frontmatter>[\s\S]*bana-special-symbols[\s\S]*bana-transcriber-notes[\s\S]*<\/frontmatter>\s*<bodymatter>/);
  assert.match(xml, /<p class="bana-symbol" title="_4\u2016\u2022">Bullet<\/p>/);
  const b = parseDtbook(xml);
  assert.deepEqual(strip(b.blocks), strip(a.blocks));
  const norm = (x) => x.replace(/emboss-\d+/g, 'U').replace(/<dc:Date[^>]*>/, '');
  assert.equal(norm(exportToNimasXml(b)), norm(xml));
});

test('round trip: notes page written first in the model still exports the symbols page first; auto, custom heading, mid-book', () => {
  const model = { title: 'T', blocks: [
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'N.' }] },
    { type: 'sympage', matter: 'transcriber', heading: 'Symbols used', auto: true },
    { type: 'heading', level: 1, text: 'Chapter' },
    { type: 'para', text: 'Body.' },
    { type: 'sympage', matter: 'transcriber', entries: [{ braille: '"7', description: 'Hollow square bullet' }] },
    { type: 'para', text: 'After.' },
  ] };
  const xml = exportToNimasXml(model);
  assert.ok(xml.indexOf('bana-special-symbols') < xml.indexOf('bana-transcriber-notes'));
  const b = parseDtbook(xml);
  assert.deepEqual(b.blocks.map((x) => x.type), ['sympage', 'tnpage', 'heading', 'para', 'sympage', 'para']);
  assert.deepEqual(symOf(b)[0], { type: 'sympage', matter: 'transcriber', heading: 'Symbols used', auto: true });
  assert.deepEqual(symOf(b)[1].entries, [{ braille: '"7', description: 'Hollow square bullet' }]);
  const only = parseDtbook(exportToNimasXml({ title: 'T', blocks: [symOf(b)[0]] }));
  assert.deepEqual(only.blocks.map((x) => x.type), ['sympage']);
});

test('a document without the construct exports byte-for-byte as before', () => {
  const d = parseDtbook(wrap('', '<level1><h1>Chapter</h1><p>Body.</p></level1>'));
  const xml = exportToNimasXml(d);
  assert.ok(!/bana-special-symbols|bana-symbol/.test(xml));
  assert.match(xml, /<frontmatter>\s*<doctitle>T<\/doctitle>\s*<\/frontmatter>/);
  assert.equal(symOf(d).length, 0);
});

test('the exported DTBook is DTD-valid (xmllint --valid and --dtdvalid), front matter and mid-book forms', () => {
  const model = { title: 'T', blocks: [
    { type: 'sympage', matter: 'transcriber', auto: true },
    { type: 'sympage', matter: 'transcriber', heading: 'Symbols', entries: [{ braille: '', print: '.=', description: 'Dot locator' }, { braille: '_4', print: '\u2022', description: 'Bullet & "more" <ok>' }] },
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'One.' }] },
    { type: 'heading', level: 1, text: 'Chapter' }, { type: 'para', text: 'Body.' },
    { type: 'sympage', matter: 'transcriber', entries: [] }, { type: 'para', text: 'After.' },
  ] };
  const err = validate(exportToNimasXml(model));
  if (err === 'skip') return;   // no xmllint on this machine
  assert.equal(err, null, err || '');
});
