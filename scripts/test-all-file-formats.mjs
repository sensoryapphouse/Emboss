import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  parseFile, 
  parseText, 
  parseHtml, 
  parseNimasXml, 
  parseDocx, 
  parseMarkdown, 
  parseRtf, 
  parseOdt, 
  parseEpub, 
  parseNimasZip 
} from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { exportToPef } from '../format/pef.mjs';
import { exportToEbraille } from '../format/ebraille.mjs';
import { prepareEmbosserStream } from '../format/spooler.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

console.log('='.repeat(95));
console.log('COMPREHENSIVE ALL-FORMAT TEST SUITE FOR EMBOSS');
console.log('='.repeat(95));

const results = [];

function record(name, format, blocks, pages, lines, err = null) {
  const status = !err && (blocks > 0 || lines > 0) ? 'PASSED' : 'FAILED';
  results.push({ name, format, blocks, pages, lines, status, error: err || 'None' });
  console.log(`\n📄 [${format.toUpperCase()}] ${name}`);
  console.log(`   - Blocks Extracted: ${blocks}`);
  console.log(`   - BRF Pages / Lines: ${pages} pages, ${lines} lines`);
  console.log(`   - Status: ${status} ${err ? '(' + err + ')' : '✅'}`);
}

async function runTests() {
  // ----------------------------------------------------
  // 1. DOCX Test Suite (9 files from corpus/docx + test-fixtures)
  // ----------------------------------------------------
  const docxDir = path.join(ROOT, 'corpus/docx');
  const docxFiles = fs.readdirSync(docxDir).filter(f => f.endsWith('.docx'));
  for (const df of docxFiles) {
    try {
      const buf = fs.readFileSync(path.join(docxDir, df));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const model = await parseDocx(ab);
      const brf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });
      const pages = brf ? brf.split('\f').length : 0;
      const lines = brf ? brf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
      record(df, 'DOCX', model.blocks.length, pages, lines);
    } catch (e) {
      record(df, 'DOCX', 0, 0, 0, e.message);
    }
  }

  // Also test maths docx in test-fixtures
  try {
    const buf = fs.readFileSync(path.join(ROOT, 'test-fixtures/maths.docx'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const model = await parseDocx(ab);
    const brf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });
    const pages = brf ? brf.split('\f').length : 0;
    const lines = brf ? brf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
    record('maths.docx', 'DOCX', model.blocks.length, pages, lines);
  } catch (e) {
    record('maths.docx', 'DOCX', 0, 0, 0, e.message);
  }

  // ----------------------------------------------------
  // 2. HTML / XHTML Test Suite
  // ----------------------------------------------------
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Biology Chapter 1: Cells</title></head>
      <body>
        <h1>Cells and Organelles</h1>
        <p>Cells are the <strong>fundamental</strong> units of life. All living organisms consist of one or more cells.</p>
        <h2>Cell Anatomy</h2>
        <ul>
          <li>Cell Membrane: Outer protective barrier</li>
          <li>Nucleus: Genetic control center</li>
          <li>Mitochondria: Powerhouse of the cell producing ATP</li>
        </ul>
        <table border="1">
          <tr><th>Organelle</th><th>Function</th><th>Location</th></tr>
          <tr><td>Ribosome</td><td>Protein Synthesis</td><td>Cytoplasm</td></tr>
          <tr><td>Lysosome</td><td>Waste Digestion</td><td>Cytoplasm</td></tr>
        </table>
        <div class="box">
          <p>Important: Mitochondria possess their own independent circular DNA.</p>
        </div>
      </body>
    </html>
  `;
  try {
    const model = parseHtml(sampleHtml);
    const brf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });
    const pages = brf ? brf.split('\f').length : 0;
    const lines = brf ? brf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
    record('biology-cells.html', 'HTML', model.blocks.length, pages, lines);
  } catch (e) {
    record('biology-cells.html', 'HTML', 0, 0, 0, e.message);
  }

  // ----------------------------------------------------
  // 3. Markdown / CommonMark Test Suite
  // ----------------------------------------------------
  const sampleMd = `
# Chemistry: Acids and Bases

Acids are chemical agents that release hydrogen ions ($H^+$) in water.

## Properties of Acids
- Sour taste (e.g. citric acid)
- Turns blue litmus paper red
- Reacts with metals to produce hydrogen gas: $2HCl + Zn \\rightarrow ZnCl_2 + H_2$

### Common Solutions
1. Hydrochloric Acid: Stomach digestive fluid
2. Sulfuric Acid: Industrial battery fluid
3. Acetic Acid: Vinegar cooking solution

\`\`\`python
# pH calculation script
import math
def calculate_ph(h_concentration):
    return -math.log10(h_concentration)
\`\`\`
  `;
  try {
    const model = parseMarkdown(sampleMd);
    const brf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });
    const pages = brf ? brf.split('\f').length : 0;
    const lines = brf ? brf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
    record('acids-and-bases.md', 'MARKDOWN', model.blocks.length, pages, lines);
  } catch (e) {
    record('acids-and-bases.md', 'MARKDOWN', 0, 0, 0, e.message);
  }

  // ----------------------------------------------------
  // 4. Plain Text (.txt) Test Suite
  // ----------------------------------------------------
  const sampleTxt = `
General Astronomy Notes

The Solar System consists of our central Sun and eight planetary bodies orbiting in elliptical paths.

Terrestrial Planets:
Mercury, Venus, Earth, Mars.

Gas Giants and Ice Giants:
Jupiter, Saturn, Uranus, Neptune.
  `;
  try {
    const model = parseText(sampleTxt);
    const brf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });
    const pages = brf ? brf.split('\f').length : 0;
    const lines = brf ? brf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
    record('astronomy-notes.txt', 'TXT', model.blocks.length, pages, lines);
  } catch (e) {
    record('astronomy-notes.txt', 'TXT', 0, 0, 0, e.message);
  }

  // ----------------------------------------------------
  // 5. RTF Test Suite
  // ----------------------------------------------------
  const sampleRtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Courier;}}\\b Geography of Continents\\b0\\par Africa is the second largest continent in the world.\\par Asia contains the highest mountain peak, Mount Everest.}`;
  try {
    const model = parseRtf(sampleRtf);
    const brf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });
    const pages = brf ? brf.split('\f').length : 0;
    const lines = brf ? brf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
    record('continents.rtf', 'RTF', model.blocks.length, pages, lines);
  } catch (e) {
    record('continents.rtf', 'RTF', 0, 0, 0, e.message);
  }

  // ----------------------------------------------------
  // 6. Unified Dispatcher Test (parseFile)
  // ----------------------------------------------------
  try {
    const model = await parseFile('test.md', sampleMd);
    const brf = formatDocument(model, { mode: 'bana', width: 40, depth: 25, translate: t => t });
    const pages = brf ? brf.split('\f').length : 0;
    const lines = brf ? brf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
    record('unified-dispatcher-test.md', 'DISPATCHER', model.blocks.length, pages, lines);
  } catch (e) {
    record('unified-dispatcher-test.md', 'DISPATCHER', 0, 0, 0, e.message);
  }

  // ----------------------------------------------------
  // 7. Output Formats (PEF, eBraille, Spooler)
  // ----------------------------------------------------
  try {
    const docModel = { title: 'Test PEF', blocks: [{ type: 'para', text: 'Knowledge is power.' }] };
    const pefXml = exportToPef(docModel, { width: 40, depth: 25, translate: t => t });
    const pefLines = pefXml ? pefXml.split('\n').length : 0;
    record('test.pef', 'PEF-XML', 1, 1, pefLines);
  } catch (e) {
    record('test.pef', 'PEF-XML', 0, 0, 0, e.message);
  }

  try {
    const docModel = { title: 'Test eBraille', blocks: [{ type: 'para', text: 'Knowledge is power.' }] };
    const ebrl = exportToEbraille(docModel, { width: 40, depth: 25, translate: t => t });
    const isOcf = ebrl instanceof Uint8Array && ebrl[0] === 0x50 && ebrl[1] === 0x4b;
    record('test.ebrl', 'EBRAILLE-1.0', 1, 1, isOcf ? ebrl.length : 0, isOcf ? undefined : 'not an OCF container');
  } catch (e) {
    record('test.ebrl', 'EBRAILLE-1.0', 0, 0, 0, e.message);
  }

  try {
    const stream = prepareEmbosserStream(',! QK BR[N FOX\f,! SECOND PAGE', 'index');
    record('index-spooler-stream', 'SPOOLER', 1, 2, stream.length);
  } catch (e) {
    record('index-spooler-stream', 'SPOOLER', 0, 0, 0, e.message);
  }

  console.log('\n' + '='.repeat(95));
  console.log('SUMMARY TABLE FOR ALL FILE FORMATS:');
  console.table(results);
  console.log('='.repeat(95));
}

runTests();
