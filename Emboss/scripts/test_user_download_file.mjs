import fs from 'node:fs';
import path from 'node:path';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const targetPath = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';

if (!fs.existsSync(targetPath)) {
  console.error(`File not found at: ${targetPath}`);
  process.exit(1);
}

console.log(`\n======================================================`);
console.log(`TESTING USER FILE: ${targetPath}`);
console.log(`======================================================\n`);

const sourceXml = fs.readFileSync(targetPath, 'utf8');
console.log(`1. Source XML Size: ${(sourceXml.length / (1024 * 1024)).toFixed(2)} MB (${sourceXml.length} bytes)`);

// 1. Parse Source XML -> AST1
const startParse1 = Date.now();
const ast1 = parseDtbook(sourceXml);
const timeParse1 = Date.now() - startParse1;
console.log(`2. Parsed to AST1 in ${timeParse1}ms: ${ast1.blocks.length} blocks, title="${ast1.title}"`);

// 2. Export AST1 -> Saved XML
const startExport = Date.now();
const savedXml = exportToNimasXml(ast1, {
  title: ast1.title,
  lang: 'en-US'
});
const timeExport = Date.now() - startExport;
console.log(`3. Serialized to Saved XML in ${timeExport}ms: ${(savedXml.length / (1024 * 1024)).toFixed(2)} MB (${savedXml.length} bytes)`);

// 3. Parse Saved XML -> AST2
const startParse2 = Date.now();
const ast2 = parseDtbook(savedXml);
const timeParse2 = Date.now() - startParse2;
console.log(`4. Re-parsed Saved XML to AST2 in ${timeParse2}ms: ${ast2.blocks.length} blocks, title="${ast2.title}"`);

// 4. Block-by-block structural comparison
console.log(`\n--- Structural AST Comparison ---`);
console.log(`AST1 Blocks: ${ast1.blocks.length}`);
console.log(`AST2 Blocks: ${ast2.blocks.length}`);

// Count words and block types
function analyzeAst(ast) {
  let words = 0;
  const typeCounts = {};
  const walk = (blocks) => {
    for (const b of blocks || []) {
      typeCounts[b.type] = (typeCounts[b.type] || 0) + 1;
      if (b.blocks && Array.isArray(b.blocks) && b.blocks.length > 0) {
        walk(b.blocks);
        continue;
      }
      if (b.text) words += b.text.trim().split(/\s+/).filter(Boolean).length;
      if (b.title) words += b.title.trim().split(/\s+/).filter(Boolean).length;
      if (b.items) for (const it of b.items) if (it.text) words += it.text.trim().split(/\s+/).filter(Boolean).length;
      if (b.rows) for (const r of b.rows) for (const c of r) if (c) words += c.trim().split(/\s+/).filter(Boolean).length;
    }
  };
  walk(ast.blocks);
  return { words, typeCounts };
}

const stats1 = analyzeAst(ast1);
const stats2 = analyzeAst(ast2);

console.log(`\nWord Count in AST1: ${stats1.words.toLocaleString()}`);
console.log(`Word Count in AST2: ${stats2.words.toLocaleString()}`);
console.log(`Word Variance: ${stats1.words - stats2.words} words (${(((stats1.words - stats2.words) / stats1.words) * 100).toFixed(4)}%)`);

console.log(`\nBlock Type Breakdown:`);
const allTypes = Array.from(new Set([...Object.keys(stats1.typeCounts), ...Object.keys(stats2.typeCounts)]));
for (const t of allTypes) {
  const c1 = stats1.typeCounts[t] || 0;
  const c2 = stats2.typeCounts[t] || 0;
  const match = c1 === c2 ? 'MATCH' : 'MISMATCH';
  console.log(`  - ${t.padEnd(12)}: AST1=${String(c1).padStart(5)} | AST2=${String(c2).padStart(5)} [${match}]`);
}

// 5. XML-level Comparison (Source vs Saved)
console.log(`\n--- XML Source vs Saved Document Comparison ---`);
console.log(`Source XML characters: ${sourceXml.length.toLocaleString()}`);
console.log(`Saved XML characters:  ${savedXml.length.toLocaleString()}`);
console.log(`Size Difference:       ${(savedXml.length - sourceXml.length).toLocaleString()} characters`);
console.log(`\nWhy XML byte size differs:`);
console.log(`  - Source XML contains publisher DTD headers, vendor comments, and raw formatting whitespace.`);
console.log(`  - Saved XML is normalized with standard 2-space indentation and canonical DTBook 2005-3 DOCTYPE.`);

// Save sample output for user inspection
const outputDumpPath = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS_saved_test.xml';
fs.writeFileSync(outputDumpPath, savedXml, 'utf8');
console.log(`\nSaved re-serialized XML to: ${outputDumpPath}`);
