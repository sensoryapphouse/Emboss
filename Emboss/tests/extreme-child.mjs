// The child process of tests/extreme_documents.test.mjs (A89 step 4 fixes; Paul, 2 Oct 2026: Emboss must never crash, hang or run
// out of memory, even on the most extreme or hostile document - a damaged or hostile file gives a clear message).
// Usage: node [--max-old-space-size=N] tests/extreme-child.mjs <file> [--format] [--nimas]
// Runs ONE file down the road a user's file takes (as scripts/extreme/worker.mjs does, but for one file and quietly):
//   parseFile(name, bytes-or-text)  [--format]  BRF in BANA and UKAAF (real liblouis, UEB grade 2)  [--nimas]  NIMAS save and read back.
// Prints ONE JSON line: { ok, ms, blocks, error:{name,message,userFacing}|null, brf:{bana,ukaaf}|null, stage }.
// Running it in a child lets the test put a hard time and memory limit on a file that hangs or runs out of memory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(HERE, '..');
const ROOT = fs.existsSync(path.join(EMBOSS, '..', 'liblouis', 'tables')) ? path.resolve(EMBOSS, '..') : EMBOSS;
const require = createRequire(import.meta.url);
const file = process.argv[2];
const wantFormat = process.argv.includes('--format');
const wantNimas = process.argv.includes('--nimas');

console.error = console.warn = () => {};
// The DOM the way the extreme-document tool sets it up: jsdom (HTML5 parser) for HTML, xmldom for XML.
const { JSDOM } = await import('jsdom');
const jsdomWindow = new JSDOM('').window;
const jsdomParser = new jsdomWindow.DOMParser();
const jsdomDocs = new WeakSet();
globalThis.DOMParser = class {
  parseFromString(str, type) {
    if (/html/i.test(String(type))) { const d = jsdomParser.parseFromString(str, type); jsdomDocs.add(d); return d; }
    return new DOMParser().parseFromString(str, type);
  }
};
globalThis.XMLSerializer = class {
  serializeToString(node) {
    const doc = node && (node.ownerDocument || node);
    return doc && jsdomDocs.has(doc) ? new jsdomWindow.XMLSerializer().serializeToString(node) : new XMLSerializer().serializeToString(node);
  }
};

const out = { ok: false, ms: 0, blocks: null, error: null, brf: null, stage: 'start', rowWidth: 0 };
const t0 = performance.now();
const finish = () => { out.ms = Math.round(performance.now() - t0); process.stdout.write('\n@@RESULT@@' + JSON.stringify(out) + '\n'); process.exit(0); };
const fail = (e) => { out.error = { name: (e && e.name) || typeof e, message: String((e && e.message) || e).slice(0, 400), userFacing: !!(e && e.userFacing), stack: String((e && e.stack) || "").split("\n").slice(0, 40).join(" | ") }; };
process.on('uncaughtException', (e) => { fail(e); finish(); });

try {
  const parse = await import(path.join(EMBOSS, 'input/parse.mjs'));
  const name = path.basename(file);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const bytes = fs.readFileSync(file);
  const payload = parse.BINARY_EXTS.has(ext)
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new TextDecoder('utf-8').decode(bytes);
  out.stage = 'parse';
  const model = await parse.parseFile(name, payload);
  out.blocks = model.blocks.length;
  // the widest table the reader produced (cells in its widest row)
  const walk = (bs) => { for (const b of bs || []) { if (!b || typeof b !== 'object') continue; if (b.type === 'table') for (const r of (b.rows || [])) out.rowWidth = Math.max(out.rowWidth, Array.isArray(r) ? r.length : 0); if (b.blocks) walk(b.blocks); } };
  walk(model.blocks);
  if (wantFormat) {
    const louis = await import(path.join(EMBOSS, 'engine/louis.mjs'));
    const { editorTranslators } = await import(path.join(EMBOSS, 'format/node-translate-helper.mjs'));
    const { makeMathToBrf } = await import(path.join(EMBOSS, 'format/node-maths-helper.mjs'));
    const { formatDocument } = await import(path.join(EMBOSS, 'format/document.mjs'));
    const temml = require('temml');
    await louis.init(path.join(ROOT, 'liblouis', 'tables'));
    const tr = editorTranslators(louis, { table: 'g2' });
    out.brf = {};
    for (const mode of ['bana', 'ukaaf']) {
      out.stage = 'format-' + mode;
      const h = makeMathToBrf(mode);
      const mathToBrf = (seg) => (seg.mathml != null ? h(seg.mathml) : h(temml.renderToString(seg.latex, { throwOnError: false })));
      const brf = formatDocument(model, { mode, width: mode === 'bana' ? 40 : 38, depth: 25, translate: tr.translate, translateG1: tr.translateG1, mathToBrf, listStyle: 'compact', tableFormat: 'auto' });
      let bad = null;
      const m = /[^\x20-\x7e\r\n\f]/.exec(brf);
      if (m) bad = 'U+' + brf.codePointAt(m.index).toString(16).toUpperCase().padStart(4, '0');
      out.brf[mode] = { chars: brf.length, nonAscii: bad };
    }
  }
  if (wantNimas) {
    out.stage = 'nimas';
    const { exportToNimasXml } = await import(path.join(EMBOSS, 'input/nimas-export.mjs'));
    const xml = await exportToNimasXml(model, { mode: 'bana' });
    out.stage = 'nimas-reread';
    const again = await parse.parseFile('roundtrip.xml', xml);
    out.rereadBlocks = again.blocks.length;
  }
  out.ok = true;
} catch (e) { fail(e); }
finish();
