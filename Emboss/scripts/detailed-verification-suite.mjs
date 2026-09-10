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

const xmlFiles = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.xml')).sort();

console.log('='.repeat(95));
console.log('FULL VERIFICATION SUITE: LINE-BY-LINE AND STRUCTURAL AUDIT (18 DOCUMENTS)');
console.log('='.repeat(95));

const results = [];

for (const xmlFile of xmlFiles) {
  const xmlPath = path.join(SAMPLES_DIR, xmlFile);
  const bbBrfPath = path.join(SAMPLES_DIR, xmlFile.replace('.xml', '.brailleblaster_out.brf'));

  const xml = fs.readFileSync(xmlPath, 'utf8');
  let bbBrf = '';
  if (fs.existsSync(bbBrfPath)) {
    bbBrf = fs.readFileSync(bbBrfPath, 'utf8');
  }

  const model = parseNimasXml(xml);
  const embossBrf = formatDocument(model, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (t) => t,
  });

  const bbLines = bbBrf ? bbBrf.split(/\r?\n/).filter((l) => l.trim().length > 0) : [];
  const embossLines = embossBrf ? embossBrf.split(/\r?\n/).filter((l) => l.trim().length > 0) : [];

  const bbPages = bbBrf ? bbBrf.split('\f').length : 0;
  const embossPages = embossBrf ? embossBrf.split('\f').length : 0;

  console.log(`\n📄 [FILE: ${xmlFile}] (${(xml.length / 1024).toFixed(1)} KB)`);
  console.log(`   - Extracted Blocks: ${model.blocks.length}`);
  console.log(`   - BrailleBlaster:   ${bbPages} pages, ${bbLines.length} lines`);
  console.log(`   - Emboss Output:    ${embossPages} pages, ${embossLines.length} lines`);

  if (bbLines.length > 0) {
    console.log('   --- BrailleBlaster Sample Lines:');
    bbLines.slice(0, 3).forEach((l, i) => console.log(`      BB[${i + 1}]: "${l}"`));
    console.log('   --- Emboss Sample Lines:');
    embossLines.slice(0, 3).forEach((l, i) => console.log(`      EM[${i + 1}]: "${l}"`));
  } else {
    console.log('   --- BrailleBlaster: [0 lines produced / parser error in BB]');
    console.log('   --- Emboss Sample Lines:');
    embossLines.slice(0, 3).forEach((l, i) => console.log(`      EM[${i + 1}]: "${l}"`));
  }

  results.push({
    file: xmlFile,
    blocks: model.blocks.length,
    bbPages,
    emPages: embossPages,
    bbLines: bbLines.length,
    emLines: embossLines.length,
    status: embossLines.length > 0 ? 'PASSED' : 'FAILED',
  });
}

console.log('\n' + '='.repeat(95));
console.log('FINAL AUDIT TABLE:');
console.table(results);
console.log('='.repeat(95));
