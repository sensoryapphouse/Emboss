// Stage 4 (standards programme): test books and round trips for BANA Formats sections 10-22.
// One small DTBook per section (tests/books/section-N/book.xml) and 2-3 broken inputs
// (section-N/broken/*.xml). Table-driven. See Emboss/docs/wip/stage4-findings-sections-10-22.md
// for every finding marked below as `todo` (the test still runs; a failure does not fail the suite).
//
// Routes with a writer in the app: NIMAS XML, NIMAS package (zip), DOCX. There is no writer
// for EPUB, HTML, Markdown or ODT (only parsers), so those routes are recorded as skipped.
//
// DAISY Pipeline validation of the exported XML is slow (needs the Java engine), so it runs
// only with DAISY_VALIDATE=1 (all books) - see the findings file for the last result.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDtbook, parseNimasZip, parseDocx } from '../../input/parse.mjs';
import { exportToNimasXml } from '../../input/nimas-export.mjs';
import { buildNimasPackageZip } from '../../input/nimas-package.mjs';
import { formatDocument, formatBlock, traceBlock } from '../../format/document.mjs';
import * as louis from '../../engine/louis.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(EMBOSS, '..');
const SECTIONS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

// Findings that make a check `todo` (key: `<section>:<check>`). Ids are in the findings file.
const TODO = {   // F4-04 (23 Sep 2026): DOCX writer text loss fixed for sections 11, 13, 15, 16 (and the note text in 19); the rest is a check limit, below
};
const todo = (n, check) => (TODO[`${n}:${check}`] ? { todo: TODO[`${n}:${check}`] } : {});

// docx-export.mjs imports './zip.mjs' (F4-03: it was the browser URL '/web/zip.mjs'); the DOCX
// route is still skipped, with the reason, if it ever fails to load.
let exportToDocxBlob = null, docxSkip = null;
try { ({ exportToDocxBlob } = await import('../../web/docx-export.mjs')); } catch (e) { docxSkip = `web/docx-export.mjs does not load under Node (${String(e.message).split('\n')[0].slice(0, 80)})`; }

let translate, translateG1, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
  translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
  translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
});
const OPTS = () => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true });
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));

// --- helpers ---------------------------------------------------------------------------
// Drop generated ids (block ids, note ids and the idrefs pointing at them, poem run ids).
const ID_KEYS = new Set(['id', 'idref', 'runId', 'ref', 'noteId']);
function stripIds(v) {
  if (Array.isArray(v)) return v.map(stripIds);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!ID_KEYS.has(k) && x !== undefined) o[k] = stripIds(x);
    return o;
  }
  return v;
}
const comparable = (m) => stripIds({ title: m.title, blocks: m.blocks });
const firstDiff = (a, b) => {
  const A = JSON.stringify(a.blocks), B = JSON.stringify(b.blocks);
  const i = [...A].findIndex((c, k) => c !== B[k]);
  return `first difference at char ${i}: ...${A.slice(Math.max(0, i - 60), i + 80)}\n   vs ...${B.slice(Math.max(0, i - 60), i + 80)}`;
};

const DTD_DIR = path.join(ROOT, 'references', 'dtd');
const CATALOG = path.join(DTD_DIR, 'catalog.xml');
const XMLLINT_ENV = { ...process.env, XML_CATALOG_FILES: `file://${CATALOG.split(path.sep).map(encodeURIComponent).join('/')}` };
const WRAPPER_REL = path.relative(ROOT, path.join(DTD_DIR, 'dtbook-2005-3-mathml.dtd'));
const DTD_DIR_REL = path.relative(ROOT, DTD_DIR);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'books10-22-'));
function xmllint(xml, tag, args) {
  const f = path.join(TMP, `${tag}.xml`);
  fs.writeFileSync(f, xml);
  const r = spawnSync('xmllint', ['--noout', '--nonet', ...args, f], { encoding: 'utf8', cwd: ROOT, env: XMLLINT_ENV, timeout: 30000 });
  return (String(r.stdout || '') + String(r.stderr || '')).trim().split(f).join('<file>');
}
const haveXmllint = spawnSync('xmllint', ['--version']).status !== null;

const books = SECTIONS.map((n) => {
  const dir = path.join(HERE, `section-${n}`);
  const broken = fs.existsSync(path.join(dir, 'broken')) ? fs.readdirSync(path.join(dir, 'broken')).filter((f) => f.endsWith('.xml')).sort() : [];
  return { n, dir, xml: fs.readFileSync(path.join(dir, 'book.xml'), 'utf8'), broken };
});

test('there is a book for every section 10-22', () => {
  assert.equal(books.length, 13);
  for (const b of books) assert.ok(b.broken.length >= 2, `section-${b.n} needs 2-3 broken inputs`);
});

for (const b of books) {
  describe(`section-${b.n} book`, () => {
    let model, exported;
    before(() => { model = parseDtbook(b.xml); exported = exportToNimasXml(model); });

    test('parses to a non-empty model', () => {
      assert.ok(Array.isArray(model.blocks) && model.blocks.length >= 2, `blocks: ${model.blocks?.length}`);
    });

    test('route NIMAS XML -> model -> NIMAS XML -> model is stable', todo(b.n, 'roundtrip-xml'), () => {
      const again = parseDtbook(exported);
      const A = comparable(model), B = comparable(again);
      assert.deepEqual(B, A, firstDiff(A, B));
      // and the export itself is a fixed point
      assert.equal(exportToNimasXml(again).replace(/<meta name="dtb:uid"[^>]*>/, '').replace(/<meta name="dc:Date"[^>]*>/g, ''),
        exported.replace(/<meta name="dtb:uid"[^>]*>/, '').replace(/<meta name="dc:Date"[^>]*>/g, ''), 'second export differs from first');
    });

    test('route NIMAS package zip -> model is stable', todo(b.n, 'roundtrip-zip'), async () => {
      const zip = await buildNimasPackageZip(model);
      const again = await parseNimasZip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
      const A = comparable(model), B = comparable(again);
      assert.deepEqual(B, A, firstDiff(A, B));
    });

    test('route DOCX export -> parseDocx keeps the text (lossy route: text only)', { skip: docxSkip || false, ...todo(b.n, 'roundtrip-docx') }, async () => {
      const blob = exportToDocxBlob(model, model.title || 'Book');
      const again = await parseDocx(await blob.arrayBuffer());
      const blockText = (x) => (x.text ?? (Array.isArray(x.segments) ? x.segments.map((g) => g.text ?? '').join('') : ''));   // a segmented paragraph (emphasis/uncontracted runs) carries its text in segments
      const words = (m) => JSON.stringify(m.blocks.map(blockText)).replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
      const A = words(model), B = new Set(words(again));
      const missing = A.filter((w) => !B.has(w));
      assert.deepEqual(missing, [], `words lost: ${missing.slice(0, 15)}`);
    });

    test('EPUB / HTML / Markdown / ODT routes', { skip: 'no writer for these formats in Emboss/input or Emboss/web (parsers only)' }, () => {});

    test('BANA 40x25: formatBlock and traceBlock agree for every block; no line exceeds 40 cells', todo(b.n, 'parity'), () => {
      const o = OPTS();
      const problems = [];
      model.blocks.forEach((blk, i) => {
        const f = clean(formatBlock(blk, o, i === 0));
        const t = clean(traceBlock(blk, o, i === 0).map((x) => x.s));
        if (JSON.stringify(f) !== JSON.stringify(t)) problems.push(`block ${i} (${blk.type}): formatBlock ${f.length} lines vs traceBlock ${t.length}\n  ${JSON.stringify(f)}\n  ${JSON.stringify(t)}`);
        const long = f.find((l) => l.length > 40);
        if (long !== undefined) problems.push(`block ${i} (${blk.type}): formatBlock line of ${long.length} cells`);
      });
      assert.deepEqual(problems, []);
    });

    test('formatDocument: no page line exceeds 40 cells, page depth <= 25, trace rows match the output', todo(b.n, 'document'), () => {
      const o = { ...OPTS(), trace: {} };
      const brf = formatDocument(structuredClone(model), o);
      assert.ok(brf.length > 0, 'empty output');
      const pages = brf.split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n'));
      const bad = [];
      pages.forEach((pg, pi) => {
        if (pg.length > 25) bad.push(`page ${pi + 1} has ${pg.length} lines`);
        pg.forEach((l, li) => { if (l.length > 40) bad.push(`page ${pi + 1} line ${li + 1}: ${l.length} cells`); });
      });
      assert.deepEqual(bad, []);
      if (o.trace.rows) {
        const outLines = pages.flat();
        const rowTexts = o.trace.rows.map((r) => (typeof r === 'string' ? r : r.s ?? '').replace(/\s+$/, ''));
        assert.equal(rowTexts.length, outLines.length, `trace rows ${rowTexts.length} vs output lines ${outLines.length}`);
      }
    });

    test('exported XML is valid against the DTBook DTD (xmllint --valid and --dtdvalid)', { skip: haveXmllint ? false : 'xmllint not installed', ...todo(b.n, 'dtd') }, () => {
      assert.equal(xmllint(exported, `s${b.n}-v`, ['--valid']), '');
      assert.equal(xmllint(exported, `s${b.n}-d`, ['--dtdvalid', WRAPPER_REL, '--path', DTD_DIR_REL]), '');
    });

    test('exported XML passes the DAISY Pipeline validator (DAISY_VALIDATE=1)', { skip: process.env.DAISY_VALIDATE ? false : 'set DAISY_VALIDATE=1 (needs the DAISY Pipeline engine; ~10 s per book)', timeout: 300000, ...todo(b.n, 'daisy') }, () => {
      const f = path.join(TMP, `daisy-${b.n}.xml`);
      fs.writeFileSync(f, exported);
      const r = spawnSync('node', [path.join(EMBOSS, 'scripts', 'daisy-validate.mjs'), f], { encoding: 'utf8', timeout: 280000 });
      const out = String(r.stdout) + String(r.stderr);
      assert.equal(r.status, 0, out.slice(-1500));
      assert.match(out, /VALID/);
      assert.doesNotMatch(out, /INVALID/, out.slice(-1500));
    });
  });

  describe(`section-${b.n} broken inputs degrade safely`, () => {
    for (const name of b.broken) {
      const xml = fs.readFileSync(path.join(b.dir, 'broken', name), 'utf8');
      test(name, todo(b.n, `broken:${name}`), () => {
        let model;
        try { model = parseDtbook(xml); }
        catch (e) {
          // A thrown error is acceptable only if it is a clear Error with a message (no hang, no crash of another kind).
          assert.ok(e instanceof Error && String(e.message).length > 5, `unclear error: ${e}`);
          return;
        }
        assert.ok(model && Array.isArray(model.blocks), 'parse must return a model with blocks');
        // Whatever parsed must export, re-parse, and format without throwing, and the export must be well-formed XML.
        const exported = exportToNimasXml(model);
        if (haveXmllint) assert.equal(xmllint(exported, `s${b.n}-${name}-wf`, []), '', 'export of a broken input is not well-formed');
        const again = parseDtbook(exported);
        assert.ok(Array.isArray(again.blocks));
        const o = OPTS();
        model.blocks.forEach((blk, i) => { formatBlock(blk, o, i === 0); traceBlock(blk, o, i === 0); });
        const brf = formatDocument(structuredClone(model), o);
        assert.equal(typeof brf, 'string');
        for (const l of brf.split(/\x0c|\r\n/)) assert.ok(l.length <= 40, `line of ${l.length} cells`);
      });
    }
  });
}
