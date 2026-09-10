import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';
import * as louis from '../engine/louis-browser.mjs';
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

// Load BrailleBlaster audit logs
const bbEpubAudit = fs.existsSync('tests/bb_broad_corpus_audit.jsonl')
  ? fs.readFileSync('tests/bb_broad_corpus_audit.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  : [];
const bbMap = new Map(bbEpubAudit.map(r => [r.file, r]));

const corpusDir = path.join(ROOT, 'tests/broad_corpus');
const files = fs.readdirSync(corpusDir).filter(f => f.endsWith('.epub'));

console.log('='.repeat(110));
console.log(`RUNNING FULL COMPARATIVE TEST: EMBOSS (UEB Grade 2, BANA 3-1) vs BRAILLEBLASTER across ${files.length} EPUBs`);
console.log('='.repeat(110));

const rows = [];
let totalBbPages = 0;
let totalEmPages = 0;
let totalBbLines = 0;
let totalEmLines = 0;
let totalEmbossTime = 0;
let totalBbTime = 0;

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
      translate: (t) => louis.translate(t, louis.TABLES.uebG2)
    });
    emPages = emBrf ? emBrf.split('\f').length : 0;
    emLines = emBrf ? emBrf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
  } catch (e) {
    status = 'ERROR';
    errMsg = e.message;
  }

  const emTime = Date.now() - t0;
  totalEmbossTime += emTime;

  const bb = bbMap.get(file) || { bb_pages: 0, bb_lines: 0, ms: 0, status: 'NOT_RUN' };
  totalBbPages += bb.bb_pages;
  totalEmPages += emPages;
  totalBbLines += bb.bb_lines;
  totalEmLines += emLines;
  totalBbTime += bb.ms || 0;

  const pageDiff = bb.bb_pages > 0 ? (((emPages - bb.bb_pages) / bb.bb_pages) * 100).toFixed(1) + '%' : 'N/A';
  const lineDiff = bb.bb_lines > 0 ? (((emLines - bb.bb_lines) / bb.bb_lines) * 100).toFixed(1) + '%' : 'N/A';

  rows.push({
    file: file.length > 32 ? file.slice(0, 29) + '...' : file,
    'BB Pages': bb.bb_pages,
    'EM Pages (G2)': emPages,
    'Page Diff%': pageDiff,
    'BB Lines': bb.bb_lines,
    'EM Lines (G2)': emLines,
    'Line Diff%': lineDiff,
    'BB Time': (bb.ms || 0) + 'ms',
    'EM Time': emTime + 'ms'
  });
}

console.table(rows);

console.log('='.repeat(110));
console.log(`TOTALS ACROSS ALL ${files.length} FULL-LENGTH BOOKS:`);
console.log(`BrailleBlaster Total Pages: ${totalBbPages.toLocaleString()}`);
console.log(`Emboss (G2) Total Pages:    ${totalEmPages.toLocaleString()}`);
console.log(`BrailleBlaster Total Lines: ${totalBbLines.toLocaleString()}`);
console.log(`Emboss (G2) Total Lines:    ${totalEmLines.toLocaleString()}`);
console.log(`Line Count Agreement:       ${(((totalBbLines / totalEmLines)) * 100).toFixed(1)}%`);
console.log(`Total BB Run Time:          ${(totalBbTime / 1000).toFixed(1)}s`);
console.log(`Total Emboss Run Time:      ${(totalEmbossTime / 1000).toFixed(1)}s (${(totalBbTime / totalEmbossTime).toFixed(0)}x faster)`);
console.log('='.repeat(110));
