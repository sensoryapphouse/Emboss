// Save then re-open must not change the braille: parse -> exportToNimasXml -> parse -> format gives the same
// lines as formatting the first parse. One small synthetic document per cause found in the pre-deploy audit
// (9 of 16 real books changed), then a few real files. A fake (upper-case) translator is enough: every cause
// was structural (title page, list bullets, heading level, code lines, numbering), not a translation difference.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatDocument } from '../format/document.mjs';
import { parseDtbook, parseFile } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const up = (s) => String(s).toUpperCase();
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
const braille = (doc) => formatDocument(structuredClone(doc), opts);
const save = (doc) => exportToNimasXml(structuredClone(doc));
const reopen = (doc) => parseDtbook(save(doc));
const same = (doc, why) => assert.equal(braille(reopen(doc)), braille(doc), why);
const strip = (x) => x.replace(/emboss-\d+/g, 'emboss-X').replace(/name="dc:Date" content="[^"]*"/, '');

describe('save and re-open keeps the braille', () => {
  test('a document with no title gets no title page from the placeholder title', () => {
    const doc = { title: null, blocks: [{ type: 'heading', level: 2, text: 'First heading' }, { type: 'para', text: 'Body text.' }] };
    const back = reopen(doc);
    assert.equal(back.title, null);
    same(doc, 'no title page appears');
  });

  test('a real title survives', () => {
    const doc = { title: 'My Book', blocks: [{ type: 'heading', level: 1, text: 'One' }, { type: 'para', text: 'Text.' }] };
    assert.equal(reopen(doc).title, 'My Book');
    same(doc);
  });

  test('a bulleted list keeps its bullets', () => {
    const doc = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'one', marker: '•' }, { text: 'two', marker: '•' }] }] };
    same(doc);
  });

  test('an unnumbered item inside a numbered list stays unnumbered', () => {
    const doc = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'Reference one', marker: '1.' }, { text: 'RATIONALE: because.' }] }] };
    const back = reopen(doc);
    assert.equal(back.blocks[0].items[1].marker, undefined);
    same(doc);
  });

  test('a title block stays a title block, not a level-1 heading', () => {
    const doc = { title: 'Doc', blocks: [{ type: 'title', text: 'The Big Title' }, { type: 'para', text: 'Text.' }] };
    assert.equal(reopen(doc).blocks[0].type, 'title');
    same(doc);
  });

  test('a heading inside a box keeps its level', () => {
    const doc = { title: 'T', blocks: [{ type: 'heading', level: 3, text: 'Section' },
      { type: 'box', render: 'required', blocks: [{ type: 'heading', level: 3, text: 'Materials' }, { type: 'para', text: 'Some gloves.' }] }] };
    const back = reopen(doc);
    assert.equal(back.blocks[1].blocks[0].level, 3);
    same(doc);
  });

  test('a plain code block keeps its lines', () => {
    const doc = { title: 'T', blocks: [{ type: 'para', text: 'Before.' }, { type: 'code', text: 'let a = 1;\nlet b = 2;\nprintln!(a + b);' }, { type: 'para', text: 'After.' }] };
    const back = reopen(doc);
    assert.equal(back.blocks[1].type, 'code');
    assert.equal(back.blocks[1].text, 'let a = 1;\nlet b = 2;\nprintln!(a + b);');
    same(doc);
  });

  test('metadata with a newline saves the same twice', () => {
    const doc = { title: 'T', metadata: { identifier: 'ISBN :\n     978-2-200' }, blocks: [{ type: 'para', text: 'x' }] };
    const once = strip(save(doc));
    assert.equal(strip(save(parseDtbook(once))), once);
  });

  test('a list whose items have no bullet saves as a plain list and re-opens with none', () => {
    const doc = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'a' }, { text: 'b' }] }] };
    const xml = save(doc);
    assert.match(xml, /<list type="pl">/);
    assert.doesNotMatch(xml, /<list type="ul">/);
    const back = reopen(doc);
    assert.ok(back.blocks[0].items.every((it) => !it.marker));
    same(doc);
  });

  test('a list with bullet markers stays a bullet list', () => {
    const doc = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'a', marker: '\u2022' }, { text: 'b', marker: '\u2022' }] }] };
    assert.match(save(doc), /<list type="ul">/);
    same(doc);
  });

  test('a sub-list of unbulleted items under a bulleted item stays unbulleted', () => {
    const doc = { title: 'T', blocks: [{ type: 'list', items: [{ text: 'a', marker: '\u2022', level: 0 }, { text: 'sub', level: 1 }, { text: 'sub2', level: 1 }] }] };
    same(doc);
  });

  test('a saved file saves the same again (export is stable)', () => {
    const doc = { title: null, blocks: [{ type: 'title', text: 'A' }, { type: 'list', items: [{ text: 'x' }] }, { type: 'code', text: 'a\nb' },
      { type: 'box', blocks: [{ type: 'heading', level: 4, text: 'H' }, { type: 'para', text: 'p' }] }] };
    const once = strip(save(doc));
    assert.equal(strip(save(parseDtbook(once))), once);
  });
});

describe('save and re-open keeps the braille of real files', () => {
  const files = [
    ['tests/real_samples/odt/model-services-contract-core-terms.odt', 'odt'],
    ['tests/real_samples/docx/statutory-guidance-probation-roles.docx', 'docx'],
    ['tests/real_samples/docx/fungal-skin-nail-infections-guidance.docx', 'docx'],
    ['tests/real_samples/md/ch08-01-vectors.md', 'md'],
    ['tests/real_samples/rtf/inclusive-accessible-stadia-report.rtf', 'rtf'],
    ['web/test_samples/glossary.xml', 'xml'],
    ['web/test_samples/9780076996285NIMAS.xml', 'xml'],
  ];
  for (const [rel, kind] of files) {
    const file = path.join(HERE, '..', rel);
    test(path.basename(rel), { skip: !fs.existsSync(file) }, async () => {
      const buf = fs.readFileSync(file);
      const input = /^(xml|md|rtf)$/.test(kind) ? buf.toString('utf8') : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const model = await parseFile(path.basename(file), input);
      const back = await parseFile('saved.xml', save(model));
      assert.equal(braille(back), braille(model));
    });
  }
});

describe('the first save is already stable (export is a fixed point after one parse)', () => {
  const stripUid = (x) => x.replace(/emboss-\d+/g, 'emboss-X').replace(/name="dc:Date" content="[^"]*"/, '');
  for (const rel of ['tests/nimas_samples/9780544087507NIMAS.xml', 'web/test_samples/glossary.xml', 'web/large-nimas.xml']) {
    const file = path.join(HERE, '..', rel);
    test(path.basename(rel), { skip: !fs.existsSync(file) }, async () => {
      const first = stripUid(save(await parseFile(path.basename(file), fs.readFileSync(file, 'utf8'))));
      const second = stripUid(save(await parseFile('saved.xml', first)));
      assert.equal(second, first);
    });
  }
  test('a link between two spaces in prose leaves one space each side', () => {
    const xml = '<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1><h1>H</h1><p>see ( <a href="#p1">\n  16\n </a> ) end</p></level1></bodymatter></book></dtbook>';
    const once = stripUid(save(parseDtbook(xml)));
    assert.equal(stripUid(save(parseDtbook(once))), once);
    assert.doesNotMatch(once, /\(\s{2,}/);
  });
});
