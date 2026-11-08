import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';
import * as louis from '../engine/louis-browser.mjs';
import { editorTranslators } from '../format/node-translate-helper.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createLiblouis = require('../engine/liblouis-wasm.js');

globalThis.DOMParser = DOMParser;
globalThis.createLiblouis = createLiblouis;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// Polyfill fetch for local table loading in Node
globalThis.fetch = async (url) => {
  const filename = path.basename(url);
  const tablePath = path.join(ROOT, 'dist/tables', filename);
  const data = fs.readFileSync(tablePath);
  return {
    ok: true,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
};

await louis.init({ tablesBaseUrl: 'http://localhost/tables' });
console.log('Liblouis WASM initialized version:', louis.version());
// Quick Mode's own translators (liblouis inside styledTranslate, plus the grade 1 translator the app passes) - import fix
// list #55; a bare liblouis call here never exercised the sub/superscript, quote-exchange and invisible-character handling.
const { translate, translateG1 } = editorTranslators(louis);

// Load Reference audit logs
const refEpubAudit = fs.existsSync('tests/reference_broad_corpus_audit.jsonl')
  ? fs.readFileSync('tests/reference_broad_corpus_audit.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  : [];
const refMap = new Map(refEpubAudit.map(r => [r.file, r]));

const corpusDir = path.join(ROOT, 'tests/broad_corpus');
const files = fs.readdirSync(corpusDir).filter(f => f.endsWith('.epub'));

console.log('='.repeat(110));
console.log(`RUNNING FULL COMPARATIVE TEST: EMBOSS (UEB Grade 2, BANA 3-1) vs REFERENCE across ${files.length} EPUBs`);
console.log('='.repeat(110));

const rows = [];
let totalRefPages = 0;
let totalEmPages = 0;
let totalRefLines = 0;
let totalEmLines = 0;
let totalEmbossTime = 0;
let totalRefTime = 0;

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const filePath = path.join(corpusDir, file);
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const t0 = Date.now();
  let emPages = 0;
  let emLines = 0;
  let emBrf = '';
  let status = 'OK';
  let errMsg = '';

  try {
    const model = await parseFile(file, ab);
    emBrf = formatDocument(model, {
      mode: 'bana',
      width: 40,
      depth: 25,
      paragraphStyle: 'indented',
      listStyle: 'spaced',
      translate, translateG1
    });
    emPages = emBrf ? emBrf.split('\f').length : 0;
    emLines = emBrf ? emBrf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
  } catch (e) {
    status = 'ERROR';
    errMsg = e.message;
  }

  const emTime = Date.now() - t0;
  totalEmbossTime += emTime;

  const ref = refMap.get(file) || { ref_pages: 0, ref_lines: 0, ms: 0, status: 'NOT_RUN' };
  totalRefPages += ref.ref_pages;
  totalEmPages += emPages;
  totalRefLines += ref.ref_lines;
  totalEmLines += emLines;
  totalRefTime += ref.ms || 0;

  const pageDiff = ref.ref_pages > 0 ? (((emPages - ref.ref_pages) / ref.ref_pages) * 100).toFixed(1) + '%' : 'N/A';
  const lineDiff = ref.ref_lines > 0 ? (((emLines - ref.ref_lines) / ref.ref_lines) * 100).toFixed(1) + '%' : 'N/A';

  rows.push({
    file: file.length > 32 ? file.slice(0, 29) + '...' : file,
    'Reference Pages': ref.ref_pages,
    'EM Pages (G2)': emPages,
    'Page Diff%': pageDiff,
    'Reference Lines': ref.ref_lines,
    'EM Lines (G2)': emLines,
    'Line Diff%': lineDiff,
    'Reference Time': (ref.ms || 0) + 'ms',
    'EM Time': emTime + 'ms'
  });
}

console.table(rows);

console.log('='.repeat(110));
console.log(`TOTALS ACROSS ALL ${files.length} FULL-LENGTH BOOKS:`);
console.log(`Reference Total Pages: ${totalRefPages.toLocaleString()}`);
console.log(`Emboss (G2) Total Pages:    ${totalEmPages.toLocaleString()}`);
console.log(`Reference Total Lines: ${totalRefLines.toLocaleString()}`);
console.log(`Emboss (G2) Total Lines:    ${totalEmLines.toLocaleString()}`);
console.log(`Line Count Agreement:       ${(((totalRefLines / totalEmLines)) * 100).toFixed(1)}%`);
console.log(`Total Reference Run Time:          ${(totalRefTime / 1000).toFixed(1)}s`);
console.log(`Total Emboss Run Time:      ${(totalEmbossTime / 1000).toFixed(1)}s (${(totalRefTime / totalEmbossTime).toFixed(0)}x faster)`);
console.log('='.repeat(110));
