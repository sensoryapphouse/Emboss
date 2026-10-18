// Standards programme, stage 4 (docs/standards-testing.md): a small test book per BANA Formats
// section (1-9 here), saved and reloaded across every route Emboss has, formatted, validated,
// plus broken inputs that must degrade safely. Table-driven over Emboss/tests/books/section-N/book.xml.
//
// Routes: NIMAS XML -> model -> NIMAS XML -> model; the file loader (parseFile); a second export
// (idempotence); the NIMAS package zip (buildNimasPackageZip -> parseNimasZip). There is no
// EPUB/HTML/Markdown/ODT/RTF writer in Emboss/input (those are import-only), and the only DOCX
// writer (web/docx-export.mjs) imports '/web/zip.mjs', a browser-only URL, so it cannot be
// loaded in Node: those routes are skipped with a note below.
//
// Findings are in docs/wip/stage4-findings-sections-1-9.md; a test that demonstrates one is
// marked `todo` with its id, so the suite stays green while the bug is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(EMBOSS, '..');
const { parseDtbook, parseFile, parseNimasZip } = await import('../../input/parse.mjs');
const { exportToNimasXml } = await import('../../input/nimas-export.mjs');
const { buildNimasPackageZip } = await import('../../input/nimas-package.mjs');
const { formatDocument, formatBlock, traceBlock } = await import('../../format/document.mjs');
const louis = await import('../../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));

// BANA options exactly as scripts/gold-run.mjs builds them, plus translatePos for traceBlock.
const OPTS = {
  mode: 'bana', standard: 'bana', width: 40, depth: 25,
  translate: (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null),
  translateG1: (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null),
  translatePos: (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null),
  suppressHeader: true,
};
const EXPORT_OPTS = { uid: 'roundtrip-test', date: '2026-01-01' };
const clone = (x) => JSON.parse(JSON.stringify(x));
// Generated ids (pagenum ids, note ids) are not part of the comparison.
const noIds = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' ? undefined : v)));

// --- DTD validation, offline, as scripts/run_800_nimas_benchmark.mjs does it --------------
const DTD_DIR = path.join(ROOT, 'references', 'dtd');
const CATALOG = path.join(DTD_DIR, 'catalog.xml');
const XMLLINT_ENV = { ...process.env, XML_CATALOG_FILES: `file://${CATALOG.split(path.sep).map(encodeURIComponent).join('/')}` };
const WRAPPER_REL = path.relative(ROOT, path.join(DTD_DIR, 'dtbook-2005-3-mathml.dtd'));
const DTD_DIR_REL = path.relative(ROOT, DTD_DIR);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-books-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });
let hasXmllint = true;
try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch { hasXmllint = false; }
function xmllint(file, args) {
  const r = spawnSync('xmllint', ['--noout', '--nonet', ...args, file], { cwd: ROOT, env: XMLLINT_ENV, encoding: 'utf8', timeout: 20000 });
  return `${r.stdout || ''}${r.stderr || ''}`.trim();
}
function dtdErrors(xml, name) {
  const f = path.join(TMP, `${name}.xml`);
  fs.writeFileSync(f, xml);
  return xmllint(f, ['--valid']) || xmllint(f, ['--dtdvalid', WRAPPER_REL, '--path', DTD_DIR_REL]);
}

// --- helpers -------------------------------------------------------------------------------
const SECTIONS = fs.readdirSync(HERE).filter((d) => /^section-[1-9]$/.test(d) && fs.existsSync(path.join(HERE, d, 'book.xml'))).sort();
const readBook = (s) => fs.readFileSync(path.join(HERE, s, 'book.xml'), 'utf8');
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

function formatLines(doc) {
  const brf = formatDocument(doc, OPTS) || '';
  return brf.split('\x0c').flatMap((p) => p.replace(/\r\n$/, '').split('\r\n'));
}

// Known open findings, keyed by test-name suffix; see docs/wip/stage4-findings-sections-1-9.md
const FINDING = {
  'F-S4-01': 'exportToNimasXml mutates its input model (a caption block is copied into the following table.caption)',
  'F-S4-02': 'an inline <prodnote> inside a <p> (embedded transcriber\'s note, BANA 3.2.3) is flattened to plain text on import',
  'F-S4-03': '<pagenum> without @page: pageType is absent on first parse but "normal" after export and re-parse',
  'F-S4-04': 'exportToNimasXml throws on a table whose rows contain null',
  'F-S4-05': 'exportToNimasXml throws on a list whose items contain null',
  'F-S4-06': 'formatDocument throws on a paragraph whose segments contain null',
};

// =============================================================================================
// 1. Round trips over every route, per book
// =============================================================================================
for (const s of SECTIONS) {
  const src = readBook(s);

  test(`${s}: NIMAS XML -> model -> NIMAS -> model gives an equal model`, () => {
    const m1 = parseDtbook(src);
    assert.ok(m1.blocks.length > 0, 'book parses to blocks');
    const before = clone(m1);                                 // exportToNimasXml mutates (F-S4-01)
    const xml = exportToNimasXml(m1, EXPORT_OPTS);
    const m2 = parseDtbook(xml);
    assert.deepEqual(noIds(m2.blocks), noIds(before.blocks));
    assert.equal(m2.title, before.title);
  });

  test(`${s}: export twice is stable (XML of the re-parsed export equals the first export)`, () => {
    const m1 = parseDtbook(src);
    const xml1 = exportToNimasXml(m1, EXPORT_OPTS);
    const xml2 = exportToNimasXml(parseDtbook(xml1), EXPORT_OPTS);
    assert.equal(xml2, xml1);
  });

  test(`${s}: the file loader (parseFile) reads the book as parseDtbook does`, async () => {
    const viaLoader = await parseFile('book.xml', src);
    assert.deepEqual(noIds(viaLoader.blocks), noIds(parseDtbook(src).blocks));
  });

  test(`${s}: NIMAS package zip -> parseNimasZip gives an equal model`, async () => {
    const m1 = parseDtbook(src);
    const before = clone(m1);
    const zip = await buildNimasPackageZip(m1, EXPORT_OPTS);
    const m2 = await parseNimasZip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
    assert.deepEqual(noIds(m2.blocks), noIds(before.blocks));
  });

  // =========================================================================================
  // 2. BANA formatting: parity of formatBlock and traceBlock, widths
  // =========================================================================================
  test(`${s}: BANA 40x25 formatting - formatBlock/traceBlock parity for every block, no line over 40 cells`, () => {
    const doc = parseDtbook(src);
    let total = 0;
    doc.blocks.forEach((b, i) => {
      const f = formatBlock(b, OPTS, i === 0);
      const t = traceBlock(b, OPTS, i === 0, 0).map((x) => x.s);
      assert.deepEqual(t, f, `block ${i} (${b.type}) formatBlock vs traceBlock`);
      for (const line of f) assert.ok(line.length <= OPTS.width, `block ${i} (${b.type}) line over ${OPTS.width}: "${line}"`);
      total += f.length;
    });
    assert.ok(total > 0, 'document produces braille');
    const lines = formatLines(doc);
    assert.ok(lines.length > 0);
    for (const l of lines) assert.ok(l.length <= OPTS.width, `page line over ${OPTS.width}: "${l}"`);
    assert.ok(lines.length <= total + doc.blocks.length * 4 + 25, 'whole-document line count is consistent with the per-block total');
  });

  // =========================================================================================
  // 3. Exported XML is valid DTBook (xmllint against the vendored DTD)
  // =========================================================================================
  test(`${s}: exported XML validates against the DTBook 2005-3 DTD (xmllint, offline)`, { skip: hasXmllint ? false : 'xmllint not installed' }, () => {
    const xml = exportToNimasXml(parseDtbook(src), EXPORT_OPTS);
    assert.equal(dtdErrors(xml, s), '');
  });
}

// DAISY Pipeline validation: one engine call over the exports of every book (VALID/INVALID + exit code).
const DAISY_HOME = process.env.DAISY_PIPELINE_HOME || (() => {
  const d = path.join(os.homedir(), '.local', 'share');
  try { return fs.readdirSync(d).some((x) => x.startsWith('daisy-pipeline-') && !x.includes('backup')); } catch { return false; }
})();
const DAISY_URL = process.env.DAISY_PIPELINE_URL || 'http://localhost:8181/ws';
async function engineUsable() {
  // Engine up but its job list unhealthy (the A50 corrupted-database signature) => not usable now.
  const get = async (p) => { try { return (await fetch(`${DAISY_URL}${p}`, { signal: AbortSignal.timeout(4000) })).status; } catch { return 0; } };
  if ((await get('/alive')) !== 200) return true;              // not running: daisy-validate starts it
  return (await get('/jobs')) === 200;
}
test('DAISY Pipeline 2 (dtbook-validator, NIMAS 1.1 rules) reports every exported book VALID', { skip: DAISY_HOME ? false : 'no DAISY Pipeline engine installed', timeout: 360000 }, async (t) => {
  if (!(await engineUsable())) { t.skip('DAISY engine is up but its job list is unhealthy (GET /ws/jobs fails; see EMBOSS-TASKS A50)'); return; }
  // An engine that is not running is started by daisy-validate, which with nine books took longer than the 110 s this call had: it was cut off
  // with no verdict at all (release checks of 15 and 17 Oct; S5A-Q2). A cold start gets 330 s.
  const cold = await (async () => { try { return (await fetch(`${DAISY_URL}/alive`, { signal: AbortSignal.timeout(4000) })).status !== 200; } catch { return true; } })();
  const files = SECTIONS.map((s) => {
    const f = path.join(TMP, `${s}-daisy.xml`);
    fs.writeFileSync(f, exportToNimasXml(parseDtbook(readBook(s)), { ...EXPORT_OPTS, uid: `${s}-daisy` }));
    return f;
  });
  const r = spawnSync('node', [path.join(EMBOSS, 'scripts', 'daisy-validate.mjs'), ...files], { encoding: 'utf8', timeout: cold ? 330000 : 110000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const verdicts = out.split('\n').filter((l) => /^(VALID|INVALID)\s/.test(l));
  assert.equal(verdicts.length, files.length, `one verdict per file:\n${out}`);
  const bad = verdicts.filter((l) => l.startsWith('INVALID'));
  assert.deepEqual(bad, [], out);
  assert.equal(r.status, 0, `exit code:\n${out}`);
});

// =============================================================================================
// 4. Broken inputs, per section (files under section-N/broken/*.xml)
// =============================================================================================
const wordsOf = (str) => (str.match(/[A-Za-z]{4,}/g) || []).map((w) => w.toLowerCase());
for (const s of SECTIONS) {
  const dir = path.join(HERE, s, 'broken');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort() : [];
  for (const f of files) {
    test(`${s}/broken/${f}: degrades safely (clear error for malformed XML, else no throw and no lost text)`, () => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const t0 = Date.now();
      let doc;
      const origErr = console.error; console.error = () => {};      // xmldom logs to console before throwing
      try {
        try { doc = quiet(() => parseDtbook(src)); }
        catch (e) {
          // malformed XML: a thrown Error with a message is the accepted "clear error"
          assert.ok(e instanceof Error && String(e.message).length > 0, 'parse error carries a message');
          return;
        }
      } finally { console.error = origErr; }
      assert.ok(Array.isArray(doc.blocks));
      const xml = quiet(() => exportToNimasXml(clone(doc), EXPORT_OPTS));
      const doc2 = quiet(() => parseDtbook(xml));
      assert.ok(Array.isArray(doc2.blocks));
      doc.blocks.forEach((b, i) => {
        quiet(() => formatBlock(b, OPTS, i === 0));
        quiet(() => traceBlock(b, OPTS, i === 0, 0));
      });
      quiet(() => formatDocument(doc, OPTS));
      // no silent loss: every word of 4+ letters in the body text survives into the model
      const body = src.slice(src.indexOf('<bodymatter>'));
      const inModel = new Set(wordsOf(JSON.stringify(doc.blocks)));
      const lost = wordsOf(body.replace(/<[^>]*>/g, ' ')).filter((w) => !inModel.has(w) && !['level'].includes(w));
      assert.deepEqual(lost, [], 'words lost on import');
      if (hasXmllint) assert.equal(dtdErrors(xml, `${s}-broken-${f}`), '', 'export of broken input is valid DTBook');
      assert.ok(Date.now() - t0 < 5000, 'no hang');
    });
  }
}

// Model-level broken blocks (a block missing a required field, null items ...): what the editor
// or a bad import could hand to export/format. Each block sits between two good blocks.
const BROKEN_MODEL = {
  'section-1': [
    ['table with no rows', { type: 'table', rows: [] }],
    ['table without headers or rows', { type: 'table' }],
    ['table with empty header row and null cells', { type: 'table', headers: [[]], rows: [[null, undefined, 'x']] }],
    ['table whose row is null', { type: 'table', rows: [null] }],
    ['pagenum with no text', { type: 'pagenum' }],
    ['heading with absurd level', { type: 'heading', level: 99, text: 'x' }],
  ],
  'section-2': [
    ['tnpage with null entries', { type: 'tnpage', entries: null }],
    ['tnpage with null entry and null paragraph', { type: 'tnpage', entries: [null, { paragraphs: [null] }] }],
    ['toc list with a null item', { type: 'list', kind: 'toc', items: [null, {}] }],
  ],
  'section-3': [
    ['note with no text', { type: 'note' }],
    ['note with unknown render', { type: 'note', text: null, render: 'weird' }],
    ['footnote with empty paragraph', { type: 'footnote', id: 'x', blocks: [{ type: 'para', text: '' }] }],
    ['footnote with nothing', { type: 'footnote' }],
  ],
  'section-4': [
    ['heading with no text', { type: 'heading' }],
    ['heading level 0', { type: 'heading', level: 0, text: 'x' }],
    ['heading level as a string', { type: 'heading', level: 'two', text: 'y' }],
  ],
  'section-5': [
    ['empty segments', { type: 'para', segments: [] }],
    ['typeform bits set to every value and markup characters', { type: 'para', segments: [{ type: 'text', text: '<&>', tf: 7 }, { type: 'text', text: 'a', tf: 99 }] }],
    ['segments containing null', { type: 'para', segments: [{ type: 'text', text: 'a' }, null] }],
  ],
  'section-6': [
    ['graphic with nothing', { type: 'graphic' }],
    ['graphic with null src and numeric caption', { type: 'graphic', src: null, caption: 5 }],
    ['caption with no text', { type: 'caption' }],
  ],
  'section-7': [
    ['box with null blocks', { type: 'box', blocks: null }],
    ['box containing null and an unknown block type', { type: 'box', blocks: [null, { type: 'nonsense' }] }],
    ['box nested 50 deep', (() => { let d = { type: 'para', text: 'core' }; for (let i = 0; i < 50; i++) d = { type: 'box', blocks: [d] }; return d; })()],
  ],
  'section-8': [
    ['list with null items', { type: 'list', items: null }],
    ['list with a null item', { type: 'list', kind: 'plain', items: [null, { text: 'x' }] }],
    ['list items with null text and negative level', { type: 'list', items: [{ text: null }, { text: 'x', level: -3 }] }],
    ['glossary entry with null term', { type: 'list', kind: 'glossary', items: [{ term: null }] }],
  ],
  'section-9': [
    ['attribution with no text', { type: 'attribution' }],
    ['empty quote paragraph', { type: 'para', style: 'quote', text: '' }],
    ['epigraph with no text', { type: 'para', style: 'epigraph' }],
  ],
};
for (const [s, cases] of Object.entries(BROKEN_MODEL)) {
  for (const [label, block, finding] of cases) {
    const model = () => ({ title: 'T', blocks: [{ type: 'heading', level: 1, text: 'H' }, clone(block), { type: 'para', text: 'after' }] });
    const opts = {};
    test(`${s}/broken model: ${label} - export, reload, format and trace without throwing`, opts, () => {
      const m = model();
      const xml = quiet(() => exportToNimasXml(m, EXPORT_OPTS));
      const back = quiet(() => parseDtbook(xml));
      assert.ok(Array.isArray(back.blocks));
      quiet(() => formatBlock(m.blocks[1], OPTS, false));
      quiet(() => traceBlock(m.blocks[1], OPTS, false, 0));
      quiet(() => formatDocument(model(), OPTS));
      if (hasXmllint) assert.equal(dtdErrors(xml, `${s}-model-${label.replace(/\W+/g, '-')}`), '');
    });
  }
}

// =============================================================================================
// 5. Findings (each is a todo test that states the correct behaviour)
// =============================================================================================
test('F-S4-01 exportToNimasXml leaves its input model unchanged', () => {
  const xml = '<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>T</h1><table><caption>Table 1</caption><tr><td>a</td></tr></table></level1></bodymatter></book></dtbook>';
  const m = parseDtbook(xml);
  const before = clone(m);
  exportToNimasXml(m, EXPORT_OPTS);
  assert.deepEqual(m, before);
});

test('F-S4-02 an embedded transcriber\'s note (<prodnote> inside <p>) is kept as a note on import', () => {
  const xml = '<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>T</h1><p>Electrical energy <prodnote render="required">right arrow</prodnote> light</p></level1></bodymatter></book></dtbook>';
  const m = parseDtbook(xml);
  const json = JSON.stringify(m.blocks);
  assert.ok(m.blocks.some((b) => b.type === 'note') || /"(note|tn|prodnote)"/.test(json), `embedded note lost: ${json}`);
  // it round-trips as an inline <prodnote> inside the <p>, and formats as an embedded transcriber's note
  const xml2 = exportToNimasXml(m, EXPORT_OPTS);
  assert.match(xml2, /<p>Electrical energy <prodnote render="required">right arrow<\/prodnote> light<\/p>/);
  assert.deepEqual(noIds(parseDtbook(xml2).blocks), noIds(m.blocks));
  const brl = formatLines(m).join('\n');
  assert.ok(brl.includes(';<') || brl.includes('@.<') || brl.includes('.<'), `no TN enclosure in: ${brl}`);
});

test('F-S4-03 a <pagenum> with no @page parses the same before and after a save', () => {
  const xml = '<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>T</h1><pagenum id="p5">5</pagenum><p>x</p></level1></bodymatter></book></dtbook>';
  const m1 = parseDtbook(xml);
  const before = clone(m1);
  const m2 = parseDtbook(exportToNimasXml(m1, EXPORT_OPTS));
  assert.deepEqual(noIds(m2.blocks), noIds(before.blocks));
});

// The routes that do not exist (documented, not failing):
test('routes without a writer: EPUB, HTML, Markdown, ODT, RTF (import-only)', { skip: 'no writer for these formats in Emboss/input or Emboss/web (the DOCX writer loads under Node since F4-03 and is tested in books_roundtrip_10_22.test.mjs)' }, () => {});
