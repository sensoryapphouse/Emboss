// Comprehensive Formatting Serialization & Roundtrip Test Suite
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import * as louis from '../engine/louis.mjs';
import { formatDocument } from '../format/document.mjs';
import { styledTranslate } from '../format/text-style.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  console.log('=== Running Formatting Serialization & Roundtrip Test Suite ===\n');

  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  const translate = styledTranslate((t, tfArr) => louis.translate(t, T, tfArr), 'faithful');
  const formatOpts = { mode: 'bana', standard: 'bana', width: 38, depth: 25, listStyle: 'spaced', translate };

  // 1. Construct multi-style formatted master document
  const testDoc = {
    title: 'Master Formatting Preservation Document',
    blocks: [
      {
        type: 'heading',
        level: 1,
        segments: [
          { type: 'text', text: 'Unit 1: ' },
          { type: 'text', text: 'Important Discoveries', tf: 4 }, // Bold
        ],
      },
      {
        type: 'para',
        segments: [
          { type: 'text', text: 'This text contains ' },
          { type: 'text', text: 'crucial emphasis', tf: 1 }, // Italic
          { type: 'text', text: ' and an ' },
          { type: 'text', text: 'underlined phrase', tf: 2 }, // Underline
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'note',
        segments: [
          { type: 'text', text: 'Transcriber note with ' },
          { type: 'text', text: 'bold note word', tf: 4 },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'list',
        kind: 'bullet',
        items: [
          {
            segments: [
              { type: 'text', text: 'Item 1 with ' },
              { type: 'text', text: 'bold item', tf: 4 },
            ],
          },
          {
            segments: [
              { type: 'text', text: 'Item 2 with ' },
              { type: 'text', text: 'italic item', tf: 1 },
            ],
          },
        ],
      },
      {
        type: 'box',
        title: 'Sidebar Box',
        blocks: [
          {
            type: 'heading',
            level: 2,
            segments: [
              { type: 'text', text: 'Sidebar ' },
              { type: 'text', text: 'Bold Heading', tf: 4 },
            ],
          },
          {
            type: 'para',
            segments: [
              { type: 'text', text: 'Sidebar body with ' },
              { type: 'text', text: 'italicized note', tf: 1 },
            ],
          },
        ],
      },
    ],
  };

  // Generate initial BRF
  const initialBrf = formatDocument(testDoc, formatOpts);

  // 2. Export to NIMAS DTBook XML
  const nimasXml = exportToNimasXml(testDoc, { standard: 'bana', publisher: 'Emboss Test Suite' });
  check('NIMAS XML export generates valid XML string', typeof nimasXml === 'string' && nimasXml.includes('<dtbook'), nimasXml.slice(0, 100));
  check('NIMAS XML contains <strong> or strong tag for bold', nimasXml.includes('<strong>') || nimasXml.includes('<strong ') || nimasXml.includes('<strong>Important Discoveries</strong>') || nimasXml.includes('<strong>bold'), nimasXml);
  check('NIMAS XML contains <em> or em tag for italic', nimasXml.includes('<em>') || nimasXml.includes('<em ') || nimasXml.includes('<em>crucial emphasis</em>') || nimasXml.includes('<em>italic'), nimasXml);

  // 3. Parse NIMAS XML back to AST
  const parsedDoc = parseDtbook(nimasXml);
  check('parseDtbook parses exported XML into blocks array', Array.isArray(parsedDoc.blocks) && parsedDoc.blocks.length > 0, JSON.stringify(parsedDoc));

  // 4. Inspect parsed AST segments for typeforms
  const h1Block = parsedDoc.blocks.find((b) => b.type === 'heading');
  check('Parsed Heading retains segments with tf=4 (bold)', h1Block && Array.isArray(h1Block.segments) && h1Block.segments.some((s) => s.tf === 4 || s.tf === louis.TYPEFORM.bold), JSON.stringify(h1Block));

  const paraBlock = parsedDoc.blocks.find((b) => b.type === 'para');
  check('Parsed Para retains segments with tf=1 (italic) and tf=2 (underline)', paraBlock && Array.isArray(paraBlock.segments) && paraBlock.segments.some((s) => s.tf === 1) && paraBlock.segments.some((s) => s.tf === 2), JSON.stringify(paraBlock));

  // 5. Generate roundtripped BRF
  const roundtrippedBrf = formatDocument(parsedDoc, formatOpts);
  check('Roundtripped BRF retains UEB bold indicators (^1)', roundtrippedBrf.includes('^1'), roundtrippedBrf);
  check('Roundtripped BRF retains UEB italic indicators (.1)', roundtrippedBrf.includes('.1'), roundtrippedBrf);
  check('Roundtripped BRF retains UEB underline indicators (_1)', roundtrippedBrf.includes('_1'), roundtrippedBrf);

  console.log(`\n==================================================`);
  console.log(`SERIALIZATION ROUNDTRIP RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log(`==================================================\n`);
  process.exit(fail ? 1 : 0);
})();
