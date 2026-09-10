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

const bbFiles = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.brailleblaster_out.brf'));

console.log('='.repeat(90));
console.log(`DIRECT EMPIRICAL COMPARISON: EMBOSS OUTPUT vs REAL BRAILLEBLASTER GENERATED OUTPUT`);
console.log('='.repeat(90));

const summary = [];

for (const bbFile of bbFiles) {
  const xmlFile = bbFile.replace('.brailleblaster_out.brf', '.xml');
  const xmlPath = path.join(SAMPLES_DIR, xmlFile);
  const bbBrfPath = path.join(SAMPLES_DIR, bbFile);

  if (!fs.existsSync(xmlPath)) continue;

  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  const bbBrf = fs.readFileSync(bbBrfPath, 'utf8');

  // Run Emboss on the exact same XML
  let embossModel;
  try {
    embossModel = parseNimasXml(xmlContent);
  } catch (e) {
    console.log(`❌ [FAIL PARSE] ${xmlFile}: ${e.message}`);
    continue;
  }

  let embossBrf = '';
  try {
    embossBrf = formatDocument(embossModel, {
      mode: 'bana',
      width: 40,
      depth: 25,
      translate: (s) => s, // or liblouis
    });
  } catch (e) {
    console.log(`❌ [FAIL FORMAT] ${xmlFile}: ${e.message}`);
    continue;
  }

  const bbPages = bbBrf ? bbBrf.split('\f').length : 0;
  const embossPages = embossBrf ? embossBrf.split('\f').length : 0;

  const bbLines = bbBrf ? bbBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0;
  const embossLines = embossBrf ? embossBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0;

  console.log(`📄 File: ${xmlFile.padEnd(30)}`);
  console.log(`   - BrailleBlaster: ${bbPages} pages, ${bbLines} non-empty lines (${bbBrf.length} bytes)`);
  console.log(`   - Emboss Engine:  ${embossPages} pages, ${embossLines} non-empty lines (${embossBrf.length} bytes)`);

  // Sample comparison of first 3 lines of actual content
  const bbSample = bbBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 3).map((l) => l.trim());
  const embossSample = embossBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 3).map((l) => l.trim());

  console.log(`   - BB First Lines:     ${JSON.stringify(bbSample)}`);
  console.log(`   - Emboss First Lines: ${JSON.stringify(embossSample)}`);
  console.log('');

  summary.push({
    xmlFile,
    bbPages,
    embossPages,
    bbLines,
    embossLines,
    matchRatio: (Math.min(bbLines, embossLines) / Math.max(bbLines, embossLines) * 100).toFixed(1) + '%',
  });
}

console.log('='.repeat(90));
console.log('SUMMARY TABLE:');
console.table(summary);
console.log('='.repeat(90));
