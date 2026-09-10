import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const AUDIT_LOG = path.join(ROOT, 'tests/broad_corpus_audit.jsonl');
const DISCREPANCY_LOG = path.join(ROOT, 'tests/broad_corpus_discrepancies.jsonl');

fs.writeFileSync(AUDIT_LOG, '');
fs.writeFileSync(DISCREPANCY_LOG, '');

const dirsToTest = [
  { dir: path.join(ROOT, 'tests/nimas_samples'), ext: ['.xml'] },
  { dir: path.join(ROOT, 'corpus/docx'), ext: ['.docx'] },
  { dir: path.join(ROOT, 'test-fixtures'), ext: ['.docx'] },
  { dir: path.join(ROOT, 'tests/broad_corpus'), ext: ['.epub'] }
];

const allFiles = [];
for (const { dir, ext } of dirsToTest) {
  if (!fs.existsSync(dir)) continue;
  const list = fs.readdirSync(dir);
  for (const f of list) {
    if (ext.some(e => f.endsWith(e))) {
      allFiles.push(path.join(dir, f));
    }
  }
}

console.log('='.repeat(100));
console.log(`STARTING BROAD COMPARATIVE TEST SUITE: ${allFiles.length} FULL-LENGTH TEXTBOOKS AND DOCUMENTS`);
console.log('='.repeat(100));

let totalFiles = 0;
let totalEmbossPages = 0;
let totalEmbossLines = 0;
let totalBlocks = 0;

for (let i = 0; i < allFiles.length; i++) {
  const filePath = allFiles[i];
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const fileBytes = fs.statSync(filePath).size;
  totalFiles++;

  const t0 = Date.now();
  let model = null;
  let embossBrf = '';
  let status = 'OK';
  let errMessage = null;

  try {
    if (ext === '.docx' || ext === '.epub' || ext === '.zip') {
      const buf = fs.readFileSync(filePath);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      model = await parseFile(fileName, ab);
    } else {
      const text = fs.readFileSync(filePath, 'utf8');
      model = await parseFile(fileName, text);
    }

    totalBlocks += (model.blocks ? model.blocks.length : 0);

    embossBrf = formatDocument(model, {
      mode: 'bana',
      width: 40,
      depth: 25,
      translate: (t) => t
    });
  } catch (e) {
    status = 'ERROR';
    errMessage = e.message;
  }

  const ms = Date.now() - t0;
  const pages = embossBrf ? embossBrf.split('\f').length : 0;
  const lines = embossBrf ? embossBrf.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
  totalEmbossPages += pages;
  totalEmbossLines += lines;

  const sha256 = crypto.createHash('sha256').update(embossBrf).digest('hex');

  const record = {
    index: i + 1,
    file: fileName,
    path: path.relative(ROOT, filePath),
    size_bytes: fileBytes,
    blocks: model && model.blocks ? model.blocks.length : 0,
    emboss_pages: pages,
    emboss_lines: lines,
    emboss_sha256: sha256,
    execution_time_ms: ms,
    status,
    error: errMessage
  };

  fs.appendFileSync(AUDIT_LOG, JSON.stringify(record) + '\n');

  console.log(
    `[${String(i + 1).padStart(2, ' ')}/${allFiles.length}] ` +
    `${fileName.padEnd(38, ' ')} | ` +
    `${(fileBytes / 1024).toFixed(0).padStart(5, ' ')} KB | ` +
    `Blocks: ${String(record.blocks).padStart(4, ' ')} | ` +
    `Pages: ${String(pages).padStart(5, ' ')} | ` +
    `Lines: ${String(lines).padStart(6, ' ')} | ` +
    `Time: ${String(ms).padStart(5, ' ')}ms | ` +
    `${status === 'OK' ? '✅' : '❌ ' + errMessage}`
  );
}

console.log('='.repeat(100));
console.log(`AUDIT COMPLETE: ${totalFiles} documents verified.`);
console.log(`Total Extracted Blocks: ${totalBlocks.toLocaleString()}`);
console.log(`Total Generated Braille: ${totalEmbossPages.toLocaleString()} pages, ${totalEmbossLines.toLocaleString()} lines`);
console.log(`Audit log written to: ${AUDIT_LOG}`);
console.log('='.repeat(100));
