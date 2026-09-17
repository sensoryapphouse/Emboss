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

// Line-count tolerance vs BrailleBlaster. Measured 2026-09: deltas ranged
// +1.8% .. +13.6% (relativity_einstein.epub is the worst). 15% is the gate;
// a book outside it is a formatting regression (or an unexplained improvement
// worth re-baselining), and the run exits 1.
const TOLERANCE_PCT = 15;

const results = [];
const failures = [];
const skippedBooks = [];

for (const book of testBooks) {
  const filePath = path.join(ROOT, 'tests/broad_corpus', book);
  if (!fs.existsSync(filePath)) { skippedBooks.push(`${book} (file missing)`); continue; }
  
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

  const bb = bbMap.get(book);
  if (!bb || !(bb.bb_lines > 0)) {
    skippedBooks.push(`${book} (no BrailleBlaster line count in bb_broad_corpus_audit.jsonl)`);
    results.push({ book: book.padEnd(28, ' '), 'BB Pages (G2)': 0, 'EM Pages (G2)': emPages, 'BB Lines (G2)': 0, 'EM Lines (G2)': emLines, 'Diff %': 'N/A', 'Within ±15%': 'SKIPPED' });
    continue;
  }
  const diffNum = ((emLines - bb.bb_lines) / bb.bb_lines) * 100;
  const diffPct = diffNum.toFixed(1);
  const withinTolerance = Math.abs(diffNum) <= TOLERANCE_PCT;
  if (!withinTolerance) failures.push(`${book}: Emboss ${emLines} vs BB ${bb.bb_lines} lines (${diffNum > 0 ? '+' : ''}${diffPct}%)`);

  results.push({
    book: book.padEnd(28, ' '),
    'BB Pages (G2)': bb.bb_pages,
    'EM Pages (G2)': emPages,
    'BB Lines (G2)': bb.bb_lines,
    'EM Lines (G2)': emLines,
    'Diff %': (diffNum > 0 ? '+' : '') + diffPct + '%',
    'Within ±15%': withinTolerance ? 'yes' : 'NO'
  });
}

if (results.length === 0) {
  console.log(`SKIPPED: no broad-corpus EPUBs found under ${path.join(ROOT, 'tests/broad_corpus')} — nothing to gate.`);
  for (const s of skippedBooks) console.log(`  SKIPPED: ${s}`);
  process.exit(0);
}

console.table(results);
for (const s of skippedBooks) console.log(`SKIPPED: ${s}`);
const gated = results.filter((r) => r['Within ±15%'] !== 'SKIPPED');
if (failures.length > 0) {
  console.error(`FAIL: ${failures.length}/${gated.length} EPUB(s) outside ±${TOLERANCE_PCT}% of BrailleBlaster line count:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log(`OK: all ${gated.length} gated EPUB(s) within ±${TOLERANCE_PCT}% of BrailleBlaster line count.`);
}
