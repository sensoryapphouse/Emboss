// Transcriber's Notes page (`tnpage`) through parse -> NIMAS export -> parse
// (Emboss/docs/transcriber-pages-plan.md stage 3, F-137/F-167). The DTBook form is
// <level1 class="bana-transcriber-notes"> with an <h1> and one <p> per entry paragraph, written
// in <frontmatter> when it leads the document (see nimas-export.mjs renderTnPageLevel).
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
const tnOf = (d) => d.blocks.filter((b) => b.type === 'tnpage');

const SRC = wrap(
  '<level1 class="bana-transcriber-notes"><h1>Transcriber’s Notes</h1><p>The atlas is omitted.</p><p>Second <em>entry</em> here.</p><p class="bana-tn-continued">A further paragraph of it.</p></level1>',
  '<level1><h1>Chapter</h1><p>Body text.</p></level1>');

function validate(xml) {
  const dtd = path.join(ROOT, 'references', 'dtd');
  const cat = 'file://' + path.join(dtd, 'catalog.xml').split(path.sep).map(encodeURIComponent).join('/');
  const tmp = path.join(os.tmpdir(), `tnpage_${process.pid}.xml`);
  fs.writeFileSync(tmp, xml);
  try {
    execFileSync('xmllint', ['--noout', '--nonet', '--valid', tmp], { cwd: ROOT, env: { ...process.env, XML_CATALOG_FILES: cat }, encoding: 'utf8', stdio: 'pipe' });
    execFileSync('xmllint', ['--noout', '--nonet', '--dtdvalid', path.relative(ROOT, path.join(dtd, 'dtbook-2005-3-mathml.dtd')), '--path', path.relative(ROOT, dtd), tmp], { cwd: ROOT, env: { ...process.env, XML_CATALOG_FILES: cat }, encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (e) {
    return e.code === 'ENOENT' ? 'skip' : String(e.stderr || e.stdout || e.message);
  } finally { fs.rmSync(tmp, { force: true }); }
}

test('parse: a level1 class="bana-transcriber-notes" becomes a tnpage block, in document order', () => {
  const d = parseDtbook(SRC);
  assert.equal(d.blocks[0].type, 'tnpage');
  const t = d.blocks[0];
  assert.equal(t.matter, 'transcriber');
  assert.equal(t.heading, undefined, 'the default heading is not stored');
  assert.equal(t.entries.length, 2);
  assert.equal(t.entries[0].text, 'The atlas is omitted.');
  assert.ok(t.entries[1].segments, 'emphasis kept as segments');
  assert.deepEqual(t.entries[1].paragraphs.map((p) => p.text), ['A further paragraph of it.']);
  assert.equal(d.blocks[1].type, 'heading');
  assert.ok(!d.blocks.some((b) => b.type === 'heading' && /transcriber/i.test(b.text)), 'no stray heading block');
});

test('parse: a front-matter level1 headed "Transcriber\'s Notes" (any case/apostrophe) is recognised without the class', () => {
  for (const h of ["Transcriber's Notes", 'TRANSCRIBER’S NOTES', 'transcribers notes']) {
    const d = parseDtbook(wrap(`<level1><h1>${h}</h1><p>One.</p></level1>`, '<level1><p>Body.</p></level1>'));
    assert.equal(tnOf(d).length, 1, h);
    assert.equal(tnOf(d)[0].entries[0].text, 'One.');
    assert.equal(tnOf(d)[0].heading, undefined);
  }
  // in the body, without the class, the same heading is an ordinary chapter
  const body = parseDtbook(wrap('', "<level1><h1>Transcriber's Notes</h1><p>One.</p></level1>"));
  assert.equal(tnOf(body).length, 0);
  // a custom heading is kept
  const custom = parseDtbook(wrap('<level1 class="bana-transcriber-notes"><h1>Notes on this volume</h1><p>x</p></level1>', '<level1><p>b</p></level1>'));
  assert.equal(tnOf(custom)[0].heading, 'Notes on this volume');
});

test('round trip: parse -> export -> parse is identical, page sits in <frontmatter>, second export is stable', () => {
  const a = parseDtbook(SRC);
  const xml = exportToNimasXml(a);
  assert.match(xml, /<frontmatter>[\s\S]*<level1 class="bana-transcriber-notes">[\s\S]*<\/frontmatter>\s*<bodymatter>/);
  assert.match(xml, /<p class="bana-tn-continued">A further paragraph of it\.<\/p>/);
  const b = parseDtbook(xml);
  assert.deepEqual(strip(b.blocks), strip(a.blocks));
  assert.equal(exportToNimasXml(b).replace(/emboss-\d+/g, 'U').replace(/<dc:Date[^>]*>/, ''), xml.replace(/emboss-\d+/g, 'U').replace(/<dc:Date[^>]*>/, ''));
});

test('round trip: a custom heading, an empty page, a page mid-book and a page-only document', () => {
  const model = { title: 'T', blocks: [
    { type: 'tnpage', matter: 'transcriber', heading: 'Notes on this volume', entries: [{ text: 'One.', paragraphs: [{ text: 'Two.' }] }] },
    { type: 'heading', level: 1, text: 'Chapter' },
    { type: 'para', text: 'Body.' },
    { type: 'heading', level: 2, text: 'Section' },
    { type: 'tnpage', matter: 'transcriber', entries: [] },
    { type: 'para', text: 'After.' },
  ] };
  const b = parseDtbook(exportToNimasXml(model));
  const tns = tnOf(b);
  assert.equal(tns.length, 2);
  assert.equal(tns[0].heading, 'Notes on this volume');
  assert.deepEqual(tns[0].entries, [{ text: 'One.', paragraphs: [{ text: 'Two.' }] }]);
  assert.deepEqual(tns[1].entries, []);
  assert.deepEqual(b.blocks.map((x) => x.type), ['tnpage', 'heading', 'para', 'heading', 'tnpage', 'para']);
  const only = parseDtbook(exportToNimasXml({ title: 'T', blocks: [tns[0]] }));
  assert.deepEqual(only.blocks.map((x) => x.type), ['tnpage']);
});

test('a document without the construct exports byte-for-byte as before (no frontmatter level, no class)', () => {
  const d = parseDtbook(wrap('', '<level1><h1>Chapter</h1><p>Body.</p></level1>'));
  const xml = exportToNimasXml(d);
  assert.ok(!/bana-transcriber-notes|bana-tn-continued/.test(xml));
  assert.match(xml, /<frontmatter>\s*<doctitle>T<\/doctitle>\s*<\/frontmatter>/);
  assert.equal(d.blocks.filter((b) => b.type === 'tnpage').length, 0);
});

test('the exported DTBook is DTD-valid (xmllint --valid and --dtdvalid), front matter and mid-book forms', () => {
  const model = { title: 'T', blocks: [
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'One.', segments: [{ type: 'text', text: 'One ', tf: 0 }, { type: 'text', text: 'bold', tf: 1 }], paragraphs: [{ text: 'More.' }] }] },
    { type: 'heading', level: 1, text: 'Chapter' }, { type: 'para', text: 'Body.' },
    { type: 'tnpage', matter: 'transcriber', entries: [] }, { type: 'para', text: 'After.' },
  ] };
  const err = validate(exportToNimasXml(model));
  if (err === 'skip') return;   // no xmllint on this machine
  assert.equal(err, null, err || '');
});
