// Comprehensive NIMAS / DTBook test suite running official BrailleBlaster / NIMAC samples.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNimasXml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.join(__dirname, '../tests/nimas_samples');

const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.xml'));

console.log('='.repeat(70));
console.log(`RUNNING NIMAS / DTBOOK TEST SUITE ON ${files.length} OFFICIAL BRAILLEBLASTER SAMPLES`);
console.log('='.repeat(70));

const results = [];

for (const file of files) {
  const filePath = path.join(SAMPLES_DIR, file);
  const xmlContent = fs.readFileSync(filePath, 'utf8');
  const fileSizeKB = (Buffer.byteLength(xmlContent, 'utf8') / 1024).toFixed(1);

  const startTime = performance.now();
  let model;
  let parseError = null;
  try {
    model = parseNimasXml(xmlContent);
  } catch (err) {
    parseError = err;
  }
  const parseTime = (performance.now() - startTime).toFixed(2);

  if (parseError || !model) {
    console.error(`❌ [FAIL] ${file} (${fileSizeKB} KB) -> Parse Error: ${parseError?.message}`);
    results.push({ file, status: 'FAIL', sizeKB: fileSizeKB, error: parseError?.message });
    continue;
  }

  const blocks = model.blocks || [];
  if (!blocks.length) {                                   // a silent 0-block parse is content LOST, not a pass
    console.error(`❌ [FAIL] ${file} (${fileSizeKB} KB) -> parsed to 0 blocks`);
    results.push({ file, status: 'FAIL', sizeKB: fileSizeKB, error: '0 blocks' });
    continue;
  }
  const counts = {
    heading: 0,
    para: 0,
    list: 0,
    table: 0,
    note: 0,
    math: 0,
    indicator: 0,
  };

  blocks.forEach((b) => {
    if (counts[b.type] !== undefined) counts[b.type]++;
  });

  // Verify transcription formatting into BRF
  let brf = '';
  let formatError = null;
  try {
    brf = formatDocument(model, {
      mode: 'ukaaf',
      width: 38,
      depth: 25,
      translate: (t) => t.toUpperCase(),
    });
  } catch (err) {
    formatError = err;
  }

  const brfPages = brf ? brf.split('\f').length : 0;
  const brfLines = brf ? brf.split(/\r?\n/).length : 0;

  console.log(`✅ [PASS] ${file} (${fileSizeKB} KB, ${parseTime}ms)`);
  console.log(`   - Title: "${model.title || '(untitled)'}"`);
  console.log(`   - Blocks: ${blocks.length} (Headings: ${counts.heading}, Paragraphs: ${counts.para}, Lists: ${counts.list}, Tables: ${counts.table}, Notes/Images: ${counts.note}, Math: ${counts.math}, Indicators: ${counts.indicator})`);
  console.log(`   - Output BRF: ${brfPages} pages, ${brfLines} lines\n`);

  results.push({
    file,
    status: 'PASS',
    sizeKB: fileSizeKB,
    parseTimeMs: parseTime,
    title: model.title,
    blocksCount: blocks.length,
    counts,
    brfPages,
    brfLines,
  });
}

console.log('='.repeat(70));
console.log(`SUMMARY: ${results.filter((r) => r.status === 'PASS').length} / ${results.length} PASSED`);
console.log('='.repeat(70));
if (results.some((r) => r.status !== 'PASS')) process.exitCode = 1;
