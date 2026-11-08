import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNimasXml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';
import { editorTranslators } from '../format/node-translate-helper.mjs';
import { DOMParser } from '@xmldom/xmldom';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : rootDir;

async function main() {
  console.log('========================================================================================');
  console.log('       EXHAUSTIVE DEEP COMPARISON: EMBOSS vs REFERENCE (1.45 MB NIMAS XML)         ');
  console.log('       File: Collections, Grade 7 (9780544087507NIMAS.xml)                              ');
  console.log('========================================================================================\n');

  const xmlPath = path.join(rootDir, 'tests/nimas_samples/9780544087507NIMAS.xml');
  const refBrfPath = path.join(rootDir, 'tests/nimas_samples/9780544087507NIMAS.reference.brf');
  const outEmbossBrfPath = path.join(rootDir, 'tests/nimas_samples/9780544087507NIMAS_emboss.brf');

  if (!fs.existsSync(xmlPath)) {
    console.error('XML file not found:', xmlPath);
    process.exit(1);
  }

  // 1. Initialize Liblouis
  const tablesDir = path.join(projectRoot, 'liblouis/tables');
  await louis.init(tablesDir);
  // Quick Mode's own translators (liblouis inside styledTranslate, plus the grade 1 translator the app passes) - import fix list #55.
  const { translate, translateG1 } = editorTranslators(louis);

  // 2. Read and Parse XML with Emboss
  console.log('Step 1: Reading and parsing 1.45 MB NIMAS XML with Emboss...');
  const t0 = performance.now();
  const xmlStr = fs.readFileSync(xmlPath, 'utf8');
  const docModel = parseNimasXml(xmlStr);
  const t1 = performance.now();
  console.log(`-> Parsed ${docModel.blocks.length.toLocaleString()} blocks in ${(t1 - t0).toFixed(1)}ms. Title: "${docModel.title}"`);

  // Block breakdown
  const blockTypes = {};
  for (const b of docModel.blocks) {
    blockTypes[b.type] = (blockTypes[b.type] || 0) + 1;
  }
  console.log('-> Block type distribution in Emboss model:');
  for (const [type, count] of Object.entries(blockTypes)) {
    console.log(`   * ${type.padEnd(14)}: ${count.toLocaleString()}`);
  }

  // 3. Format with Emboss in BANA mode (standard US NIMAS textbook configuration: 40x25, BANA rules, UEB G2)
  console.log('\nStep 2: Formatting document into BRF with Emboss (BANA mode, 40x25, UEB Grade 2)...');
  const t2 = performance.now();
  const emBrf = formatDocument(docModel, {
    mode: 'bana',
    width: 40,
    depth: 25,
    listStyle: 'spaced',
    translate, translateG1,
  });
  const t3 = performance.now();
  console.log(`-> Formatted into BRF in ${(t3 - t2).toFixed(1)}ms.`);
  fs.writeFileSync(outEmbossBrfPath, emBrf, 'utf8');
  console.log(`-> Saved Emboss BRF to: ${outEmbossBrfPath} (${(Buffer.byteLength(emBrf, 'utf8') / 1024).toFixed(1)} KB)`);

  // 4. Load Reference BRF
  console.log('\nStep 3: Loading Reference baseline BRF...');
  const refBrf = fs.readFileSync(refBrfPath, 'utf8');
  console.log(`-> Loaded Reference BRF: ${refBrfPath} (${(Buffer.byteLength(refBrf, 'utf8') / 1024).toFixed(1)} KB)`);

  // 5. Macro Metrics & High-Level Comparison
  console.log('\n========================================================================================');
  console.log('                                1. MACRO METRICS & SIZES                                ');
  console.log('========================================================================================');

  const refPages = refBrf.split('\f').filter(Boolean);
  const emPages = emBrf.split('\f').filter(Boolean);

  const refLines = refBrf.split(/\r?\n/);
  const emLines = emBrf.split(/\r?\n/);

  const refNonEmptyLines = refLines.filter((l) => l.trim().length > 0);
  const emNonEmptyLines = emLines.filter((l) => l.trim().length > 0);

  const tokenize = (str) => str.split(/\s+/).filter(Boolean);
  const refWords = tokenize(refBrf);
  const emWords = tokenize(emBrf);

  console.log(`Total Braille Pages:        Reference: ${refPages.length.toLocaleString().padStart(6)} | Emboss: ${emPages.length.toLocaleString().padStart(6)} | Diff: ${(emPages.length - refPages.length > 0 ? '+' : '')}${(emPages.length - refPages.length)} (${(((emPages.length - refPages.length) / refPages.length) * 100).toFixed(1)}%)`);
  console.log(`Total Braille Lines:        Reference: ${refLines.length.toLocaleString().padStart(6)} | Emboss: ${emLines.length.toLocaleString().padStart(6)} | Diff: ${(emLines.length - refLines.length > 0 ? '+' : '')}${(emLines.length - refLines.length)} (${(((emLines.length - refLines.length) / refLines.length) * 100).toFixed(1)}%)`);
  console.log(`Non-Empty Content Lines:    Reference: ${refNonEmptyLines.length.toLocaleString().padStart(6)} | Emboss: ${emNonEmptyLines.length.toLocaleString().padStart(6)} | Diff: ${(emNonEmptyLines.length - refNonEmptyLines.length > 0 ? '+' : '')}${(emNonEmptyLines.length - refNonEmptyLines.length)} (${(((emNonEmptyLines.length - refNonEmptyLines.length) / refNonEmptyLines.length) * 100).toFixed(1)}%)`);
  console.log(`Total Translated Words:     Reference: ${refWords.length.toLocaleString().padStart(6)} | Emboss: ${emWords.length.toLocaleString().padStart(6)} | Diff: ${(emWords.length - refWords.length > 0 ? '+' : '')}${(emWords.length - refWords.length)} (${(((emWords.length - refWords.length) / refWords.length) * 100).toFixed(1)}%)`);
  console.log(`Average Lines / Page:       Reference: ${(refNonEmptyLines.length / refPages.length).toFixed(2).padStart(6)} | Emboss: ${(emNonEmptyLines.length / emPages.length).toFixed(2).padStart(6)}`);

  // 6. Vocabulary & Lexical Alignment
  console.log('\n========================================================================================');
  console.log('                          2. VOCABULARY & TRANSLATION OVERLAP                           ');
  console.log('========================================================================================');

  const refVocab = new Set(refWords);
  const emVocab = new Set(emWords);

  let sharedWords = 0;
  for (const w of emVocab) {
    if (refVocab.has(w)) sharedWords++;
  }
  const jaccard = ((sharedWords / (refVocab.size + emVocab.size - sharedWords)) * 100).toFixed(2);

  console.log(`Unique Vocabulary Tokens:   Reference: ${refVocab.size.toLocaleString().padStart(6)} | Emboss: ${emVocab.size.toLocaleString().padStart(6)}`);
  console.log(`Shared Vocabulary Tokens:   ${sharedWords.toLocaleString().padStart(6)}`);
  console.log(`Jaccard Lexical Similarity: ${jaccard}%`);

  // 7. Structural Features & Formatting Parity Breakdown
  console.log('\n========================================================================================');
  console.log('                   3. DETAILED STRUCTURAL & FORMATTING COMPARISON                        ');
  console.log('========================================================================================');

  const countMatches = (text, regex) => (text.match(regex) || []).length;

  const refTopBoxes = countMatches(refBrf, /3333333333/g);
  const emTopBoxes = countMatches(emBrf, /3333333333/g);

  const refBottomBoxes = countMatches(refBrf, /7777777777/g);
  const emBottomBoxes = countMatches(emBrf, /7777777777/g);

  console.log(`\nA. Boxlines & Sidebars:`);
  console.log(`   - Top Borders (333...):    Reference: ${refTopBoxes.toLocaleString().padStart(5)} | Emboss: ${emTopBoxes.toLocaleString().padStart(5)}`);
  console.log(`   - Bottom Borders (777...): Reference: ${refBottomBoxes.toLocaleString().padStart(5)} | Emboss: ${emBottomBoxes.toLocaleString().padStart(5)}`);

  // Typeforms indicators
  const refItalicWords = countMatches(refBrf, /\^1|\.1/g);
  const emItalicWords = countMatches(emBrf, /\^1|\.1/g);

  const refBoldWords = countMatches(refBrf, /\^7|\.7/g);
  const emBoldWords = countMatches(emBrf, /\^7|\.7/g);

  const refUnderlineWords = countMatches(refBrf, /\^2|\.2/g);
  const emUnderlineWords = countMatches(emBrf, /\^2|\.2/g);

  console.log(`\nB. Inline Typeforms (UEB Rulebook §9):`);
  console.log(`   - Italic Indicators:       Reference: ${refItalicWords.toLocaleString().padStart(5)} | Emboss: ${emItalicWords.toLocaleString().padStart(5)}`);
  console.log(`   - Bold Indicators:         Reference: ${refBoldWords.toLocaleString().padStart(5)} | Emboss: ${emBoldWords.toLocaleString().padStart(5)}`);
  console.log(`   - Underline Indicators:    Reference: ${refUnderlineWords.toLocaleString().padStart(5)} | Emboss: ${emUnderlineWords.toLocaleString().padStart(5)}`);

  // Table structures
  const refTableNotes = countMatches(refBrf, /Table: Listed Table Format|Table: Listed Format/gi);
  const emTableNotes = countMatches(emBrf, /Table: Listed Table Format|Table: Listed Format/gi);
  const refTableGridLines = countMatches(refBrf, /--\s+--/g);
  const emTableGridLines = countMatches(emBrf, /--\s+--/g);

  console.log(`\nC. Table Structures:`);
  console.log(`   - Listed Table Notes:      Reference: ${refTableNotes.toLocaleString().padStart(5)} | Emboss: ${emTableNotes.toLocaleString().padStart(5)}`);
  console.log(`   - Columnar Table Grid Seps:Reference: ${refTableGridLines.toLocaleString().padStart(5)} | Emboss: ${emTableGridLines.toLocaleString().padStart(5)}`);

  // Transcriber notes & Footnotes
  const refTNQuotes = countMatches(refBrf, /'\s|\s'/g);
  const emTNQuotes = countMatches(emBrf, /'\s|\s'/g);
  const refUEBTN = countMatches(refBrf, /\.\s,|,\./g);
  const emUEBTN = countMatches(emBrf, /\.\s,|,\./g);

  console.log(`\nD. Transcriber Notes & Indicators:`);
  console.log(`   - BANA TN Quotes (' ... '):Reference: ${refTNQuotes.toLocaleString().padStart(5)} | Emboss: ${emTNQuotes.toLocaleString().padStart(5)}`);
  console.log(`   - UEB TN Quotes (., ... ,.):Reference: ${refUEBTN.toLocaleString().padStart(5)} | Emboss: ${emUEBTN.toLocaleString().padStart(5)}`);

  // Dot leaders
  const refDotLeaders = countMatches(refBrf, /"{3,}/g);
  const emDotLeaders = countMatches(emBrf, /"{3,}/g);

  console.log(`\nE. TOC & Guide Dot Leaders:`);
  console.log(`   - Dot-5 Leaders ("""):     Reference: ${refDotLeaders.toLocaleString().padStart(5)} | Emboss: ${emDotLeaders.toLocaleString().padStart(5)}`);

  // Print page numbers
  const refPrintPageNums = countMatches(refBrf, /---\s+.*?\s+---/g);
  const emPrintPageNums = countMatches(emBrf, /---\s+.*?\s+---/g);

  console.log(`\nF. Print Page Number Indicators:`);
  console.log(`   - Print Page Lines:        Reference: ${refPrintPageNums.toLocaleString().padStart(5)} | Emboss: ${emPrintPageNums.toLocaleString().padStart(5)}`);

  // 8. Detailed Sample Comparison Across Chapters
  console.log('\n========================================================================================');
  console.log('                          4. CHAPTER & PASSAGE EXCERPT COMPARISON                       ');
  console.log('========================================================================================');

  console.log('\n--- Page 1 Comparison ---');
  console.log('Reference Page 1:');
  console.log((refPages[0] || '').split(/\r?\n/).slice(0, 15).join('\n'));
  console.log('\nEmboss Page 1:');
  console.log((emPages[0] || '').split(/\r?\n/).slice(0, 15).join('\n'));

  console.log('\n--- Page 50 Comparison ---');
  console.log('Reference Page 50:');
  console.log((refPages[49] || '').split(/\r?\n/).slice(0, 15).join('\n'));
  console.log('\nEmboss Page 50:');
  console.log((emPages[49] || '').split(/\r?\n/).slice(0, 15).join('\n'));

  console.log('\n--- Page 200 Comparison ---');
  console.log('Reference Page 200:');
  console.log((refPages[199] || '').split(/\r?\n/).slice(0, 15).join('\n'));
  console.log('\nEmboss Page 200:');
  console.log((emPages[199] || '').split(/\r?\n/).slice(0, 15).join('\n'));

  console.log('\n========================================================================================');
  console.log('                                 COMPARISON COMPLETE                                    ');
  console.log('========================================================================================');
}

main().catch(console.error);
