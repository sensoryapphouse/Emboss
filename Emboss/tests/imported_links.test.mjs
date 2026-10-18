// Paul's decision (25 Sep 2026): a link out of an imported document (web, email, ftp) gets the hyperlink indicator
// (F-233) automatically, in every import format except DTBook/NIMAS (Emboss's own saved files keep the transcriber's
// choice). Internal jump links are not marked.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseFile } = await import('../input/parse.mjs');
const { formatBlock } = await import('../format/document.mjs');
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const OPTS = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, suppressHeader: true };

const linkSegs = (model) => {
  const out = [];
  const walk = (v) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) return v.forEach(walk); if (v.type === 'text' && v.href) out.push(v); for (const k in v) if (k !== 'resources') walk(v[k]); };
  walk(model.blocks);
  return out;
};

const HTML = '<html><body><p>See <a href="https://example.com">our site</a>, <a href="#top">the top</a> and <a href="mailto:a@b.c">email us</a>.</p></body></html>';

test('HTML: external and email links are marked, an internal link is not', async () => {
  const segs = linkSegs(await parseFile('t.html', HTML));
  const by = Object.fromEntries(segs.map((s) => [s.text.trim(), !!s.hyperlink]));
  assert.equal(by['our site'], true);
  assert.equal(by['email us'], true);
  assert.equal(by['the top'] || false, false);
});

test('Markdown: a link is marked', async () => {
  const segs = linkSegs(await parseFile('t.md', 'Go to [the site](https://example.org) now.'));
  assert.ok(segs.length && segs.every((s) => s.hyperlink), JSON.stringify(segs));
});

test('DTBook/NIMAS: links are left as saved (no automatic indicator)', async () => {
  const xml = '<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="t"/></head><book><bodymatter><level1><p>See <a href="https://example.com">our site</a>.</p></level1></bodymatter></book></dtbook>';
  const segs = linkSegs(await parseFile('t.xml', xml));
  assert.ok(segs.every((s) => !s.hyperlink), JSON.stringify(segs));
});

test('the marked link brailles with the hyperlink indicator', async () => {
  const model = await parseFile('t.html', HTML);
  const para = model.blocks.find((b) => b.segments);
  const withInd = formatBlock(para, OPTS).join('\n');
  const plain = formatBlock({ ...para, segments: para.segments.map((s) => ({ ...s, hyperlink: false })) }, OPTS).join('\n');
  assert.notEqual(withInd, plain);
  assert.ok(withInd.length > plain.length);
});
