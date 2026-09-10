import fs from 'node:fs';
import path from 'node:path';
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
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : ROOT;

// Polyfill fetch for local table loading in Node
globalThis.fetch = async (url) => {
  const filename = path.basename(url);
  const tablePath = fs.existsSync(path.join(projectRoot, 'liblouis/tables', filename))
    ? path.join(projectRoot, 'liblouis/tables', filename)
    : path.join(ROOT, 'dist/tables', filename);
  const data = fs.readFileSync(tablePath);
  return {
    ok: true,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
};

await louis.init({ tablesBaseUrl: 'http://localhost/tables' });
console.log('Liblouis WASM initialized version:', louis.version());

const testBooks = [
  'the_republic_plato.epub',
  'origin_of_species_darwin.epub',
  'relativity_einstein.epub',
  'dracula.epub',
  'frankenstein.epub',
  'pride_and_prejudice.epub',
  'treasure_island.epub',
  'the_war_of_the_worlds.epub',
  'the_time_machine.epub',
  'jane_eyre.epub'
];

console.log('\nTesting Emboss with full UEB Grade 2 contracted braille vs BrailleBlaster:');

const auditPath = path.join(ROOT, 'tests/bb_broad_corpus_audit.jsonl');
const bbAudit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const bbMap = new Map(bbAudit.map(r => [r.file, r]));

const results = [];

for (const book of testBooks) {
  const filePath = path.join(ROOT, 'tests/broad_corpus', book);
  if (!fs.existsSync(filePath)) continue;
  
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const model = await parseFile(book, ab);

  const embossBrfG2 = formatDocument(model, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (text) => louis.translate(text, louis.TABLES.uebG2)
  });

  const emPages = embossBrfG2.split('\f').length;
  const emLines = embossBrfG2.split(/\r?\n/).filter(l => l.trim().length > 0).length;

  const bb = bbMap.get(book) || { bb_pages: 0, bb_lines: 0 };
  const diffPct = bb.bb_lines > 0 ? (((emLines - bb.bb_lines) / bb.bb_lines) * 100).toFixed(1) : 'N/A';

  results.push({
    book: book.padEnd(28, ' '),
    'BB Pages (G2)': bb.bb_pages,
    'EM Pages (G2)': emPages,
    'BB Lines (G2)': bb.bb_lines,
    'EM Lines (G2)': emLines,
    'Diff %': (diffPct > 0 ? '+' : '') + diffPct + '%'
  });
}

console.table(results);
