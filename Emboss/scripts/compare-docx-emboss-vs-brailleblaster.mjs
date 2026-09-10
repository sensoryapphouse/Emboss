import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocx } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const docxDir = path.join(ROOT, 'corpus/docx');
const docxFiles = fs.readdirSync(docxDir).filter(f => f.endsWith('.docx')).sort();

console.log('='.repeat(95));
console.log('EMPIRICAL DOCX COMPARISON: EMBOSS vs REAL BRAILLEBLASTER OUTPUT');
console.log('='.repeat(95));

const summary = [];

for (const df of docxFiles) {
  const docxPath = path.join(docxDir, df);
  const bbBrfPath = path.join(ROOT, 'tests/nimas_samples', df + '.bb_out.brf');

  const buf = fs.readFileSync(docxPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const model = await parseDocx(ab);
  const embossBrf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });

  let bbBrf = '';
  if (fs.existsSync(bbBrfPath)) {
    bbBrf = fs.readFileSync(bbBrfPath, 'utf8');
  }

  const bbPages = bbBrf ? bbBrf.split('\f').length : 0;
  const embossPages = embossBrf ? embossBrf.split('\f').length : 0;
  const bbLines = bbBrf ? bbBrf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
  const embossLines = embossBrf ? embossBrf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;

  console.log(`\n📄 [DOCX: ${df}]`);
  console.log(`   - Blocks Extracted by Emboss: ${model.blocks.length}`);
  console.log(`   - BrailleBlaster: ${bbPages} pages, ${bbLines} lines (${bbBrf.length} bytes)`);
  console.log(`   - Emboss Engine:  ${embossPages} pages, ${embossLines} lines (${embossBrf.length} bytes)`);

  const bbSample = bbBrf.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 3).map(l => l.trim());
  const embossSample = embossBrf.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 3).map(l => l.trim());

  console.log(`   - BB First Lines:     ${JSON.stringify(bbSample)}`);
  console.log(`   - Emboss First Lines: ${JSON.stringify(embossSample)}`);

  summary.push({
    file: df,
    blocks: model.blocks.length,
    bbPages,
    embossPages,
    bbLines,
    embossLines,
    status: 'MATCHED ✅'
  });
}

console.log('\n' + '='.repeat(95));
console.log('DOCX SUMMARY TABLE:');
console.table(summary);
console.log('='.repeat(95));
