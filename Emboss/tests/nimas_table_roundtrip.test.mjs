// Systematic Round-Trip Test Suite for Phase 4B: NIMAS XML Table Serialization
// Tests AST <-> DTBook XML serialization across synthetic cases and all 154 production textbook tables.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDtbook, parseNimasXml } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

console.log('=== Running NIMAS Table Serialization & Round-Trip Test Suite (Phase 4B) ===\n');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name}`);
    if (detail) console.error(`    Detail: ${detail}`);
  }
}

// --- Section 1: Synthetic Listed Table Round-Trip ---
console.log('--- Section 1: Synthetic Listed Table Serialization ---');
const listedTableDoc = {
  title: 'Document with Listed Table',
  blocks: [
    {
      type: 'table',
      format: 'listed',
      style: 'table-listed',
      caption: 'Table 1: Vocabulary Words',
      tabletn: 'Listed format used for narrow margins',
      headers: ['Word', 'Part of Speech', 'Definition'],
      rows: [
        ['aspect', 'noun', 'a particular part or feature of something'],
        ['trait', 'noun', 'a distinguishing quality or characteristic']
      ]
    }
  ]
};

const xmlListed = exportToNimasXml(listedTableDoc);
check('Exported XML contains <table class="bana-listed">', xmlListed.includes('<table class="bana-listed">'));
check('Exported XML contains <caption>', xmlListed.includes('<caption>Table 1: Vocabulary Words</caption>'));
check('Exported XML contains <tabletn> or <prodnote class="tabletn">', xmlListed.includes('<tabletn>') || (xmlListed.includes('<prodnote') && xmlListed.includes('class="tabletn"')));
check('Exported XML contains <thead> and <th>', xmlListed.includes('<th>Word</th>') && xmlListed.includes('<th>Part of Speech</th>'));
check('Exported XML contains <tbody> and <td>', xmlListed.includes('<td>aspect</td>') && xmlListed.includes('<td>noun</td>'));

const parsedListed = parseDtbook(xmlListed);
const tblListed = parsedListed.blocks.find(b => b.type === 'table');
check('Re-parsed AST holds table block', !!tblListed);
check('Re-parsed table preserves format: listed', tblListed?.format === 'listed');
check('Re-parsed table headers match', tblListed?.headers?.length === 3 && tblListed.headers[0] === 'Word');
check('Re-parsed table rows match', tblListed?.rows?.length === 2 && tblListed.rows[0][0] === 'aspect');

// --- Section 2: Synthetic Spatial Table Round-Trip ---
console.log('\n--- Section 2: Synthetic Spatial Table Serialization ---');
const spatialTableDoc = {
  blocks: [
    {
      type: 'table',
      format: 'spatial',
      style: 'table-spatial',
      headers: ['Trial', 'Result A', 'Result B'],
      rows: [
        ['1', '10.5', '12.0'],
        ['2', '11.0', '13.5']
      ]
    }
  ]
};

const xmlSpatial = exportToNimasXml(spatialTableDoc);
check('Exported XML contains <table class="bana-spatial">', xmlSpatial.includes('<table class="bana-spatial">'));

const parsedSpatial = parseDtbook(xmlSpatial);
const tblSpatial = parsedSpatial.blocks.find(b => b.type === 'table');
check('Re-parsed spatial table preserves format: spatial', tblSpatial?.format === 'spatial');
check('Re-parsed spatial table rows match', tblSpatial?.rows?.length === 2 && tblSpatial.rows[1][1] === '11.0');

// --- Section 3: Row Headers and Colspan Alignment ---
console.log('\n--- Section 3: Row Headers & Colspan Handling ---');
const complexXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <table>
          <thead>
            <tr><th>Product</th><th>Q1</th><th>Q2</th><th>Q3</th></tr>
          </thead>
          <tbody>
            <tr><th>Widgets</th><td colspan="2">Merged</td><td>45</td></tr>
            <tr><th>Gadgets</th><td>10</td><td>20</td><td>30</td></tr>
          </tbody>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

const parsedComplex = parseDtbook(complexXml);
const complexTbl = parsedComplex.blocks.find(b => b.type === 'table');
check('Parsed table with row headers and colspans', !!complexTbl);
check('Headers parsed correctly', complexTbl?.headers?.length === 4 && complexTbl.headers[0] === 'Product');
check('Row 1 row-header and colspan padded', complexTbl?.rows[0]?.length === 4 && complexTbl.rows[0][0] === 'Widgets' && complexTbl.rows[0][1] === 'Merged' && complexTbl.rows[0][2] === '');
check('Row 2 row-header and cells aligned', complexTbl?.rows[1]?.length === 4 && complexTbl.rows[1][0] === 'Gadgets' && complexTbl.rows[1][3] === '30');

// --- Section 4: Scale Test: All 154 Real Production Tables ---
console.log('\n--- Section 4: Production Scale Test (All 154 Tables in Grade 7 Textbook) ---');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIMARY_PATH = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
const FALLBACK_PATH = path.join(__dirname, 'nimas_samples/9780544087507NIMAS.xml');
const TARGET_PATH = fs.existsSync(PRIMARY_PATH) ? PRIMARY_PATH : FALLBACK_PATH;

if (fs.existsSync(TARGET_PATH)) {
  const rawXml = fs.readFileSync(TARGET_PATH, 'utf8');
  const tbDoc = parseDtbook(rawXml);
  const tbTables = tbDoc.blocks.filter(b => b.type === 'table');
  check(`Extracted all production tables: found ${tbTables.length} tables`, tbTables.length === 154);

  // Roundtrip all tables
  const scaleDoc = { blocks: tbTables };
  const scaleXml = exportToNimasXml(scaleDoc);
  const reParsedDoc = parseDtbook(scaleXml);
  const reParsedTables = reParsedDoc.blocks.filter(b => b.type === 'table');

  check('Re-parsed table count matches exactly 154', reParsedTables.length === 154);

  let headerMatches = 0, rowMatches = 0, cellMatches = 0, totalCells = 0;
  for (let i = 0; i < tbTables.length; i++) {
    const orig = tbTables[i];
    const rep = reParsedTables[i];

    // Check headers
    if (JSON.stringify(orig.headers || []) === JSON.stringify(rep.headers || [])) {
      headerMatches++;
    }

    // Check rows
    if ((orig.rows?.length || 0) === (rep.rows?.length || 0)) {
      rowMatches++;
      let allCellsMatch = true;
      for (let r = 0; r < (orig.rows?.length || 0); r++) {
        const origRow = orig.rows[r] || [];
        const repRow = rep.rows[r] || [];
        totalCells += origRow.length;
        if (JSON.stringify(origRow) !== JSON.stringify(repRow)) {
          allCellsMatch = false;
        }
      }
      if (allCellsMatch) cellMatches++;
    }
  }

  check('100% of table headers match across round-trip', headerMatches === 154, `${headerMatches}/154`);
  check('100% of table row structures match across round-trip', rowMatches === 154, `${rowMatches}/154`);
  check('100% of table cell contents match across round-trip', cellMatches === 154, `${cellMatches}/154 (${totalCells} cells verified)`);
} else {
  console.warn('Production sample file not found at:', TARGET_PATH);
}

console.log(`\nTable round-trip tests complete: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
