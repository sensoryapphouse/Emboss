// The CHILD process of the extreme-document test set (A89 step 4; see ../check-extreme-documents.mjs).
// Usage (the parent does this, with --max-old-space-size set to the case's heap budget):
//   node --max-old-space-size=N worker.mjs spec.json
// spec.json = { resultFile, items:[ item, ... ] }. The items run one after another in this one process (a "battery" of small
// malformed files shares one start-up; a big case is a battery of one). The result file is rewritten after EVERY item, so if
// the process hangs, runs out of memory or crashes, the parent still has the finished items' results and knows which item
// was running (the .progress file). Each item takes one input file down the road a user's file takes:
//   parseFile(name, bytes-or-text)          exactly as web/app.mjs acceptFile does (BINARY_EXTS -> ArrayBuffer, else file.text())
//   formatDocument(model, opts)             Quick Mode's options, for each mode in item.modes (BANA / UKAAF, UEB grade 2; grade 1 on request)
//   formatDocumentAsync(... translatePos)   the editor's call (item.editor)
//   exportToNimasXml -> parseFile again     the NIMAS save and read-back (the block count should be stable)
//   exportToEbraille / exportToPef          the other two exports (item.ebraille / item.pef)
// Every failure is classified:
//   raw    a TypeError / RangeError / ReferenceError / SyntaxError (or a stack overflow): a crash the user would meet as "undefined is not ..."
//   error  a plain Error with the reader's own message (e.userFacing, "malformed XML: ...", "not a zip"): fine for malformed input
//   zlib   zlib's own error passed up unchanged (a bit-flipped deflate stream gives "TypeError"): FAIL, it is not the reader's own message
//   bad    an invariant broken (BRF empty / not BRF ASCII, NIMAS export carrying characters XML forbids, ...)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(HERE, '..', '..');
const ROOT = fs.existsSync(path.join(EMBOSS, '..', 'liblouis', 'tables')) ? path.resolve(EMBOSS, '..') : EMBOSS;
const require = createRequire(import.meta.url);

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const progressFile = job.resultFile + '.progress';
const mark = (s) => { try { fs.appendFileSync(progressFile, `${Date.now()} ${s}\n`); } catch { /* ignore */ } };
const out = { items: {}, peakRssMB: 0 };
let cur = null;                                           // the item result being built

// xmldom (as the Node tests use) is chatty about recoverable markup problems; count them, keep the first few.
let chatter = { n: 0, first: [] };
console.error = console.warn = (...a) => { chatter.n++; if (chatter.first.length < 4) chatter.first.push(a.map(String).join(' ').slice(0, 160)); };
// The DOM. A browser parses HTML with the HTML5 algorithm (<p> closes <p>, tables are repaired, ...) and XML with a strict XML parser.
// Node has neither, so: text/html goes to jsdom (parse5, the HTML5 algorithm, as a browser's tree comes out) and XML to @xmldom/xmldom
// (what every other Node test in this repo uses). Documents jsdom made are serialised by jsdom's XMLSerializer, the rest by xmldom's.
const { JSDOM } = await import('jsdom');
const jsdomWindow = new JSDOM('').window;
const jsdomParser = new jsdomWindow.DOMParser();
const jsdomDocs = new WeakSet();
class DispatchParser {
  parseFromString(str, type) {
    if (/html/i.test(String(type))) { const d = jsdomParser.parseFromString(str, type); jsdomDocs.add(d); return d; }
    return new DOMParser().parseFromString(str, type);
  }
}
class DispatchSerializer {
  serializeToString(node) {
    const doc = node && (node.ownerDocument || node);
    return doc && jsdomDocs.has(doc) ? new jsdomWindow.XMLSerializer().serializeToString(node) : new XMLSerializer().serializeToString(node);
  }
}
globalThis.DOMParser = DispatchParser;
globalThis.XMLSerializer = DispatchSerializer;

const save = () => {
  out.peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
  fs.writeFileSync(job.resultFile + '.tmp', JSON.stringify(out));
  fs.renameSync(job.resultFile + '.tmp', job.resultFile);
};
const RAW = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError']);
const ZLIBISH = /incorrect header check|invalid stored block|invalid distance|invalid code|invalid block type|unexpected end of file|too many length|invalid literal|Z_DATA_ERROR|Z_BUF_ERROR/i;
function classify(e) {
  const name = (e && e.name) || typeof e;
  const message = String((e && e.message) || e);
  const stack = String((e && e.stack) || '').split('\n').slice(0, 7).join('\n');
  if (e && e.userFacing) return { kind: 'error', name, message };
  if (/Maximum call stack|Invalid (array|string|typed array) length|Array buffer allocation failed|out of memory|Cannot allocate/i.test(message)) return { kind: 'raw', name, message, stack };
  if (e && ZLIBISH.test(message + ' ' + (e.code || ''))) return { kind: 'zlib', name, message };
  if (RAW.has(name)) return { kind: 'raw', name, message, stack };
  return { kind: 'error', name, message };
}
const fail = (stage, kind, message, extra = {}) => cur.failures.push({ stage, kind, message, ...extra });
const failRaw = (stage, e) => { const c = classify(e); fail(stage, c.kind === 'raw' ? 'raw' : 'bad', `${c.name}: ${c.message}`, { stack: c.stack }); };

process.on('uncaughtException', (e) => { if (cur) { const c = classify(e); fail('uncaught', 'raw', `${c.name}: ${c.message}`, { stack: c.stack }); } save(); process.exit(0); });
process.on('unhandledRejection', (e) => { if (cur) { const c = classify(e); fail('uncaught', 'raw', `unhandled rejection ${c.name}: ${c.message}`, { stack: c.stack }); } save(); process.exit(0); });

async function timed(name, fn) {
  mark(`stage ${name}`);
  const t = performance.now();
  try { return await fn(); }
  finally { cur.stages.push({ name, ms: Math.round(performance.now() - t) }); }
}

const BRF_BAD = /[^\x20-\x7e\r\n\f]/;
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const louis = await import(path.join(EMBOSS, 'engine/louis.mjs'));
const { editorTranslators } = await import(path.join(EMBOSS, 'format/node-translate-helper.mjs'));
const { makeMathToBrf } = await import(path.join(EMBOSS, 'format/node-maths-helper.mjs'));
const parse = await import(path.join(EMBOSS, 'input/parse.mjs'));
const { formatDocument, formatDocumentAsync } = await import(path.join(EMBOSS, 'format/document.mjs'));
const { exportToNimasXml } = await import(path.join(EMBOSS, 'input/nimas-export.mjs'));
const temml = require('temml');
await louis.init(path.join(ROOT, 'liblouis', 'tables'));

const mathHelper = {};
const mathToBrfFor = (mode) => {
  const h = mathHelper[mode] || (mathHelper[mode] = makeMathToBrf(mode));
  return (seg) => {
    if (!seg) throw new Error('mathToBrf: missing segment');
    if (seg.mathml != null) return h(seg.mathml);
    if (seg.latex != null) return h(temml.renderToString(seg.latex, { throwOnError: false }));
    throw new Error('mathToBrf: segment has neither mathml nor latex');
  };
};
const trCache = {};
const mkOpts = (mode, grade, pos = false) => {
  const tr = trCache[grade] || (trCache[grade] = editorTranslators(louis, { table: grade === 'g1' ? 'g1' : 'g2' }));
  const o = { mode, width: mode === 'bana' ? 40 : 38, depth: 25, translate: tr.translate, translateG1: tr.translateG1, mathToBrf: mathToBrfFor(mode), listStyle: 'compact', tableFormat: 'auto' };
  if (pos) o.translatePos = tr.translatePos;
  return o;
};

async function runItem(spec) {
  const t0 = performance.now();
  const result = cur = { id: spec.id, name: spec.name, failures: [], warns: [], notes: [], stages: [], blocks: null, brf: {}, totalMs: 0 };
  chatter = { n: 0, first: [] };
  mark(`item ${spec.id}`);
  try {
    await body(spec, result);
  } catch (e) { failRaw('worker', e); }
  result.totalMs = Math.round(performance.now() - t0);
  result.peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
  if (chatter.n) result.notes.push(`${chatter.n} console warning(s), e.g. ${chatter.first[0]}`);
  out.items[spec.id] = result;
  cur = null;
  save();
}

async function body(spec, result) {
  // ---- 1. parse ----
  const bytes = fs.readFileSync(spec.file);
  let model;
  if (spec.modelJson) {
    model = JSON.parse(bytes.toString('utf8'));
    result.notes.push('model supplied directly (no reader)');
  } else {
    const ext = (spec.name.split('.').pop() || '').toLowerCase();
    const payload = parse.BINARY_EXTS.has(ext)
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)       // file.arrayBuffer()
      : new TextDecoder('utf-8').decode(bytes);                                          // file.text(): BOM stripped, bad bytes -> U+FFFD
    try { model = await timed('parse', () => parse.parseFile(spec.name, payload)); }
    catch (e) {
      const c = classify(e);
      result.parseError = `${c.name}: ${c.message}`.slice(0, 300);
      if (c.kind === 'raw') fail('parse', 'raw', `${c.name}: ${c.message}`, { stack: c.stack });
      else if (c.kind === 'zlib') fail('parse', 'unclear', `a library error reaches the user as the message "${c.name}: ${c.message}"${e && e.code ? ' (code ' + e.code + ')' : ''}: not the reader's own plain message`, { stack: c.stack });
      else if (spec.expect === 'content') fail('parse', 'bad', `the reader refused a valid document: ${c.message}`);
      else result.notes.push(`reader error (clean): ${c.message.slice(0, 160)}`);
      return;                                                                            // nothing to format
    }
  }
  if (!model || !Array.isArray(model.blocks)) { fail('parse', 'bad', 'the reader returned no model.blocks array'); return; }
  result.blocks = model.blocks.length;
  { const types = {}; let inlineMath = 0;
    for (const b of model.blocks) { const k = (b && b.type) || '?'; types[k] = (types[k] || 0) + 1; if (b && Array.isArray(b.segments)) for (const g of b.segments) if (g && g.type === 'math') inlineMath++; }
    result.types = types; result.inlineMath = inlineMath; }
  if (spec.expect === 'content' && model.blocks.length === 0) fail('parse', 'bad', 'the reader found no blocks in a document that has content');
  if (spec.minInlineMath && result.inlineMath < spec.minInlineMath) fail('parse', 'bad', `only ${result.inlineMath} inline equations were read, expected at least ${spec.minInlineMath}`);
  if (spec.minBlocks && model.blocks.length < spec.minBlocks) fail('parse', 'bad', `only ${model.blocks.length} blocks read, expected at least ${spec.minBlocks}`);
  if (model.warnings && model.warnings.length) result.notes.push(`${model.warnings.length} load warning(s): ${String(model.warnings[0]).slice(0, 100)}`);

  // ---- 2. braille ----
  const checkBrf = (label, brf, width) => {
    if (typeof brf !== 'string') { fail(label, 'bad', `the formatter returned ${typeof brf}, not a string`); return null; }
    const info = { chars: brf.length };
    if (spec.expect === 'content' && !brf.trim()) fail(label, 'bad', 'the BRF is empty for a document with content');
    const bad = BRF_BAD.exec(brf);
    if (bad) {
      let n = 0; for (const ch of brf) if (BRF_BAD.test(ch)) n++;
      fail(label, 'bad', `the BRF holds ${n} character(s) that are not BRF ASCII (first U+${brf.codePointAt(bad.index).toString(16).toUpperCase().padStart(4, '0')})`);
    }
    let longest = 0, lines = 0, pages = 1;
    for (let i = 0, start = 0; i <= brf.length; i++) {
      const c = i < brf.length ? brf.charCodeAt(i) : 10;
      if (c === 10 || c === 13 || c === 12) {
        if (i - start > longest) longest = i - start;
        if (c === 10) lines++;
        if (c === 12) pages++;
        start = i + 1;
      }
    }
    info.lines = lines; info.pages = pages; info.longest = longest;
    if (longest > width) result.warns.push(`${label}: a line of ${longest} cells is longer than the ${width}-cell page`);
    return info;
  };
  const doFormat = async (label, mode, grade, async = false) => {
    const o = mkOpts(mode, grade, async);
    try {
      const brf = await timed(label, async ? () => formatDocumentAsync(model, o) : () => formatDocument(model, o));
      result.brf[label] = checkBrf(label, brf, o.width);
      return brf;
    } catch (e) { failRaw(label, e); return null; }
  };
  const modes = spec.modes || ['bana', 'ukaaf'];
  let sync = null;
  for (const mode of modes) sync = await doFormat(`${mode}-g2`, mode, 'g2');
  if (spec.g1) await doFormat('ukaaf-g1', 'ukaaf', 'g1');
  if (spec.editor) {
    const asyncBrf = await doFormat(`${modes[0]}-g2-editor`, modes[0], 'g2', true);
    if (asyncBrf != null && result.brf[`${modes[0]}-g2`]) {
      let syncBrf = null; try { syncBrf = formatDocument(model, mkOpts(modes[0], 'g2')); } catch { /* already reported above */ }
      if (syncBrf != null && asyncBrf !== syncBrf) result.warns.push(`editor path (formatDocumentAsync+translatePos) differs from the Quick Mode path (${asyncBrf.length} vs ${syncBrf.length} chars)`);
    }
  }

  // ---- 3. NIMAS save + read-back ----
  if (spec.roundTrip !== false) {
    let xml = null;
    try { xml = await timed('nimas-export', () => exportToNimasXml(model, { mode: 'bana' })); }
    catch (e) { failRaw('nimas-export', e); }
    if (typeof xml === 'string') {
      const ill = ILLEGAL_XML.exec(xml);
      if (ill) fail('nimas-export', 'bad', `the saved NIMAS file holds a character XML forbids (U+${xml.charCodeAt(ill.index).toString(16).toUpperCase().padStart(4, '0')} at offset ${ill.index}), so other tools cannot read it`);
      if (!xml.includes('<dtbook')) fail('nimas-export', 'bad', 'the saved file is not a DTBook');
      try {
        const again = await timed('nimas-reread', () => parse.parseFile('roundtrip.xml', xml));
        result.roundTrip = { before: model.blocks.length, after: again.blocks.length, xmlBytes: xml.length };
        // (an empty document saves as a file holding one placeholder paragraph: not worth a line)
        if (again.blocks.length !== model.blocks.length && !(model.blocks.length === 0 && again.blocks.length === 1)) result.notes.push(`NIMAS round trip: ${model.blocks.length} blocks became ${again.blocks.length} (reported, not failed)`);
      } catch (e) {
        const c = classify(e);
        fail('nimas-reread', c.kind === 'raw' ? 'raw' : 'bad', `Emboss cannot read back the NIMAS file it just saved: ${c.name}: ${c.message}`, { stack: c.stack });
      }
    }
  }

  // ---- 4. other exports ----
  if (spec.ebraille) {
    const { exportToEbraille } = await import(path.join(EMBOSS, 'format/ebraille.mjs'));
    try {
      const o = await timed('ebraille', () => exportToEbraille(model, mkOpts('ukaaf', 'g2')));
      if (!(o instanceof Uint8Array) || o[0] !== 0x50 || o[1] !== 0x4b) fail('ebraille', 'bad', 'the eBraille export is not a zip container');
      else result.ebrailleBytes = o.length;
    } catch (e) { failRaw('ebraille', e); }
  }
  if (spec.pef) {
    const { exportToPef } = await import(path.join(EMBOSS, 'format/pef.mjs'));
    try {
      const o = await timed('pef', () => exportToPef(model, mkOpts('ukaaf', 'g2')));
      if (typeof o !== 'string' || !o.includes('<pef')) fail('pef', 'bad', 'the PEF export is not a PEF document');
    } catch (e) { failRaw('pef', e); }
  }
  // ---- 5. extra assertions on what the reader produced (XXE / entity expansion checks) ----
  if (spec.mustNotContain) {
    const modelText = JSON.stringify(model.blocks);
    for (const s of spec.mustNotContain) if ((sync && sync.includes(s)) || modelText.includes(s)) fail('inspect', 'bad', `the output contains "${s}": external content was read`);
  }
  if (spec.maxModelChars) {
    const size = JSON.stringify(model.blocks).length;
    if (size > spec.maxModelChars) fail('inspect', 'bad', `the model is ${size} characters long: an entity expanded (limit ${spec.maxModelChars})`);
  }
}

for (const item of job.items) await runItem(item);
save();
process.exit(0);
