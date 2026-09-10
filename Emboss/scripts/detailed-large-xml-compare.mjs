import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNimasXml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';
import { DOMParser } from '@xmldom/xmldom';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : rootDir;

async function main() {
  console.log('========================================================================================');
  console.log('       EXHAUSTIVE DEEP COMPARISON: EMBOSS vs BRAILLEBLASTER (1.45 MB NIMAS XML)         ');
  console.log('       File: Collections, Grade 7 (9780544087507NIMAS.xml)                              ');
  console.log('========================================================================================\n');

  const xmlPath = path.join(rootDir, 'tests/nimas_samples/9780544087507NIMAS.xml');
  const bbBrfPath = path.join(rootDir, 'tests/nimas_samples/9780544087507NIMAS.brailleblaster_out.brf');
  const outEmbossBrfPath = path.join(rootDir, 'tests/nimas_samples/9780544087507NIMAS_emboss.brf');

  if (!fs.existsSync(xmlPath)) {
    console.error('XML file not found:', xmlPath);
    process.exit(1);
  }

  // 1. Initialize Liblouis
  const tablesDir = path.join(projectRoot, 'liblouis/tables');
  await louis.init(tablesDir);

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
    translate: (text, typeform) => louis.translate(text, louis.TABLES.uebG2, typeform),
    translateG1: (text) => louis.translate(text, louis.TABLES.uebG1),
  });
  const t3 = performance.now();
  console.log(`-> Formatted into BRF in ${(t3 - t2).toFixed(1)}ms.`);
  fs.writeFileSync(outEmbossBrfPath, emBrf, 'utf8');
  console.log(`-> Saved Emboss BRF to: ${outEmbossBrfPath} (${(Buffer.byteLength(emBrf, 'utf8') / 1024).toFixed(1)} KB)`);

  // 4. Load BrailleBlaster BRF
  console.log('\nStep 3: Loading BrailleBlaster baseline BRF...');
  const bbBrf = fs.readFileSync(bbBrfPath, 'utf8');
  console.log(`-> Loaded BrailleBlaster BRF: ${bbBrfPath} (${(Buffer.byteLength(bbBrf, 'utf8') / 1024).toFixed(1)} KB)`);

  // 5. Macro Metrics & High-Level Comparison
  console.log('\n========================================================================================');
  console.log('                                1. MACRO METRICS & SIZES                                ');
  console.log('========================================================================================');

  const bbPages = bbBrf.split('\f').filter(Boolean);
  const emPages = emBrf.split('\f').filter(Boolean);

  const bbLines = bbBrf.split(/\r?\n/);
  const emLines = emBrf.split(/\r?\n/);

  const bbNonEmptyLines = bbLines.filter((l) => l.trim().length > 0);
  const emNonEmptyLines = emLines.filter((l) => l.trim().length > 0);

  const tokenize = (str) => str.split(/\s+/).filter(Boolean);
  const bbWords = tokenize(bbBrf);
  const emWords = tokenize(emBrf);

  console.log(`Total Braille Pages:        BrailleBlaster: ${bbPages.length.toLocaleString().padStart(6)} | Emboss: ${emPages.length.toLocaleString().padStart(6)} | Diff: ${(emPages.length - bbPages.length > 0 ? '+' : '')}${(emPages.length - bbPages.length)} (${(((emPages.length - bbPages.length) / bbPages.length) * 100).toFixed(1)}%)`);
  console.log(`Total Braille Lines:        BrailleBlaster: ${bbLines.length.toLocaleString().padStart(6)} | Emboss: ${emLines.length.toLocaleString().padStart(6)} | Diff: ${(emLines.length - bbLines.length > 0 ? '+' : '')}${(emLines.length - bbLines.length)} (${(((emLines.length - bbLines.length) / bbLines.length) * 100).toFixed(1)}%)`);
  console.log(`Non-Empty Content Lines:    BrailleBlaster: ${bbNonEmptyLines.length.toLocaleString().padStart(6)} | Emboss: ${emNonEmptyLines.length.toLocaleString().padStart(6)} | Diff: ${(emNonEmptyLines.length - bbNonEmptyLines.length > 0 ? '+' : '')}${(emNonEmptyLines.length - bbNonEmptyLines.length)} (${(((emNonEmptyLines.length - bbNonEmptyLines.length) / bbNonEmptyLines.length) * 100).toFixed(1)}%)`);
  console.log(`Total Translated Words:     BrailleBlaster: ${bbWords.length.toLocaleString().padStart(6)} | Emboss: ${emWords.length.toLocaleString().padStart(6)} | Diff: ${(emWords.length - bbWords.length > 0 ? '+' : '')}${(emWords.length - bbWords.length)} (${(((emWords.length - bbWords.length) / bbWords.length) * 100).toFixed(1)}%)`);
  console.log(`Average Lines / Page:       BrailleBlaster: ${(bbNonEmptyLines.length / bbPages.length).toFixed(2).padStart(6)} | Emboss: ${(emNonEmptyLines.length / emPages.length).toFixed(2).padStart(6)}`);

  // 6. Vocabulary & Lexical Alignment
  console.log('\n========================================================================================');
  console.log('                          2. VOCABULARY & TRANSLATION OVERLAP                           ');
  console.log('========================================================================================');

  const bbVocab = new Set(bbWords);
  const emVocab = new Set(emWords);

  let sharedWords = 0;
  for (const w of emVocab) {
    if (bbVocab.has(w)) sharedWords++;
  }
  const jaccard = ((sharedWords / (bbVocab.size + emVocab.size - sharedWords)) * 100).toFixed(2);

  console.log(`Unique Vocabulary Tokens:   BrailleBlaster: ${bbVocab.size.toLocaleString().padStart(6)} | Emboss: ${emVocab.size.toLocaleString().padStart(6)}`);
  console.log(`Shared Vocabulary Tokens:   ${sharedWords.toLocaleString().padStart(6)}`);
  console.log(`Jaccard Lexical Similarity: ${jaccard}%`);

  // 7. Structural Features & Formatting Parity Breakdown
  console.log('\n========================================================================================');
  console.log('                   3. DETAILED STRUCTURAL & FORMATTING COMPARISON                        ');
  console.log('========================================================================================');

  const countMatches = (text, regex) => (text.match(regex) || []).length;

  const bbTopBoxes = countMatches(bbBrf, /3333333333/g);
  const emTopBoxes = countMatches(emBrf, /3333333333/g);

  const bbBottomBoxes = countMatches(bbBrf, /7777777777/g);
  const emBottomBoxes = countMatches(emBrf, /7777777777/g);

  console.log(`\nA. Boxlines & Sidebars:`);
  console.log(`   - Top Borders (333...):    BrailleBlaster: ${bbTopBoxes.toLocaleString().padStart(5)} | Emboss: ${emTopBoxes.toLocaleString().padStart(5)}`);
  console.log(`   - Bottom Borders (777...): BrailleBlaster: ${bbBottomBoxes.toLocaleString().padStart(5)} | Emboss: ${emBottomBoxes.toLocaleString().padStart(5)}`);

  // Typeforms indicators
  const bbItalicWords = countMatches(bbBrf, /\^1|\.1/g);
  const emItalicWords = countMatches(emBrf, /\^1|\.1/g);

  const bbBoldWords = countMatches(bbBrf, /\^7|\.7/g);
  const emBoldWords = countMatches(emBrf, /\^7|\.7/g);

  const bbUnderlineWords = countMatches(bbBrf, /\^2|\.2/g);
  const emUnderlineWords = countMatches(emBrf, /\^2|\.2/g);

  console.log(`\nB. Inline Typeforms (UEB Rulebook §9):`);
  console.log(`   - Italic Indicators:       BrailleBlaster: ${bbItalicWords.toLocaleString().padStart(5)} | Emboss: ${emItalicWords.toLocaleString().padStart(5)}`);
  console.log(`   - Bold Indicators:         BrailleBlaster: ${bbBoldWords.toLocaleString().padStart(5)} | Emboss: ${emBoldWords.toLocaleString().padStart(5)}`);
  console.log(`   - Underline Indicators:    BrailleBlaster: ${bbUnderlineWords.toLocaleString().padStart(5)} | Emboss: ${emUnderlineWords.toLocaleString().padStart(5)}`);

  // Table structures
  const bbTableNotes = countMatches(bbBrf, /Table: Listed Table Format|Table: Listed Format/gi);
  const emTableNotes = countMatches(emBrf, /Table: Listed Table Format|Table: Listed Format/gi);
  const bbTableGridLines = countMatches(bbBrf, /--\s+--/g);
  const emTableGridLines = countMatches(emBrf, /--\s+--/g);

  console.log(`\nC. Table Structures:`);
  console.log(`   - Listed Table Notes:      BrailleBlaster: ${bbTableNotes.toLocaleString().padStart(5)} | Emboss: ${emTableNotes.toLocaleString().padStart(5)}`);
  console.log(`   - Columnar Table Grid Seps:BrailleBlaster: ${bbTableGridLines.toLocaleString().padStart(5)} | Emboss: ${emTableGridLines.toLocaleString().padStart(5)}`);

  // Transcriber notes & Footnotes
  const bbTNQuotes = countMatches(bbBrf, /'\s|\s'/g);
  const emTNQuotes = countMatches(emBrf, /'\s|\s'/g);
  const bbUEBTN = countMatches(bbBrf, /\.\s,|,\./g);
  const emUEBTN = countMatches(emBrf, /\.\s,|,\./g);

  console.log(`\nD. Transcriber Notes & Indicators:`);
  console.log(`   - BANA TN Quotes (' ... '):BrailleBlaster: ${bbTNQuotes.toLocaleString().padStart(5)} | Emboss: ${emTNQuotes.toLocaleString().padStart(5)}`);
  console.log(`   - UEB TN Quotes (., ... ,.):BrailleBlaster: ${bbUEBTN.toLocaleString().padStart(5)} | Emboss: ${emUEBTN.toLocaleString().padStart(5)}`);

  // Dot leaders
  const bbDotLeaders = countMatches(bbBrf, /"{3,}/g);
  const emDotLeaders = countMatches(emBrf, /"{3,}/g);

  console.log(`\nE. TOC & Guide Dot Leaders:`);
  console.log(`   - Dot-5 Leaders ("""):     BrailleBlaster: ${bbDotLeaders.toLocaleString().padStart(5)} | Emboss: ${emDotLeaders.toLocaleString().padStart(5)}`);

  // Print page numbers
  const bbPrintPageNums = countMatches(bbBrf, /---\s+.*?\s+---/g);
  const emPrintPageNums = countMatches(emBrf, /---\s+.*?\s+---/g);

  console.log(`\nF. Print Page Number Indicators:`);
  console.log(`   - Print Page Lines:        BrailleBlaster: ${bbPrintPageNums.toLocaleString().padStart(5)} | Emboss: ${emPrintPageNums.toLocaleString().padStart(5)}`);

  // 8. Detailed Sample Comparison Across Chapters
  console.log('\n========================================================================================');
  console.log('                          4. CHAPTER & PASSAGE EXCERPT COMPARISON                       ');
  console.log('========================================================================================');

  console.log('\n--- Page 1 Comparison ---');
  console.log('BrailleBlaster Page 1:');
  console.log((bbPages[0] || '').split(/\r?\n/).slice(0, 15).join('\n'));
  console.log('\nEmboss Page 1:');
  console.log((emPages[0] || '').split(/\r?\n/).slice(0, 15).join('\n'));

  console.log('\n--- Page 50 Comparison ---');
  console.log('BrailleBlaster Page 50:');
  console.log((bbPages[49] || '').split(/\r?\n/).slice(0, 15).join('\n'));
  console.log('\nEmboss Page 50:');
  console.log((emPages[49] || '').split(/\r?\n/).slice(0, 15).join('\n'));

  console.log('\n--- Page 200 Comparison ---');
  console.log('BrailleBlaster Page 200:');
  console.log((bbPages[199] || '').split(/\r?\n/).slice(0, 15).join('\n'));
  console.log('\nEmboss Page 200:');
  console.log((emPages[199] || '').split(/\r?\n/).slice(0, 15).join('\n'));

  console.log('\n========================================================================================');
  console.log('                                 COMPARISON COMPLETE                                    ');
  console.log('========================================================================================');
}

main().catch(console.error);
