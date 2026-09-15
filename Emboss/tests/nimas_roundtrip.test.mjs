// Systematic Round-Trip Test Harness for NIMAS / DTBook XML (ANSI/NISO Z39.86-2005).
// Invariant Pipeline: XML1 -> parseDtbook -> AST1 -> exportToNimasXml -> XML2 -> parseDtbook -> AST2
// Asserts deep structural equivalence between AST1 and AST2 across all styles.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(HERE, 'nimas_samples');

let pass = 0;
let fail = 0;

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

/**
 * Normalizes inline segments by collapsing adjacent text runs with identical formatting.
 */
function normalizeSegments(segments) {
  if (!segments || !Array.isArray(segments)) return undefined;
  const collapsed = [];
  for (const s of segments) {
    if (!s) continue;
    if (s.type === 'math') {
      const copy = { ...s };
      if (copy.mathml) copy.mathml = copy.mathml.replace(/\s*xmlns:m="[^"]*"/g, '').replace(/\s*altimg="[^"]*"/g, '').replace(/\s*alttext="[^"]*"/g, '').replace(/\s+/g, ' ').trim();
      if (!copy.latex && copy.mathml) {
        const m = copy.mathml.match(/alttext="([^"]+)"/) || copy.mathml.match(/<annotation[^>]*>([^<]+)<\/annotation>/);
        if (m) copy.latex = m[1].trim();
      }
      collapsed.push(copy);
      continue;
    }

    const textClean = (s.text != null) ? s.text.replace(/\s+/g, ' ') : null;
    const last = collapsed[collapsed.length - 1];

    if (s.type === 'text' && !textClean?.trim()) {
      if (last && last.type === 'text') {
        last.text = (last.text + ' ' + (s.text || '')).replace(/\s+/g, ' ');
      }
      continue;
    }

    const isText = s.type === 'text';
    const lastIsText = last && last.type === 'text';
    const sameFormat = lastIsText && isText && (last.tf || 0) === (s.tf || 0) && Boolean(last.uncontracted) === Boolean(s.uncontracted);
    
    if (sameFormat) {
      const glue = (last.text && !last.text.endsWith(' ') && textClean && !textClean.startsWith(' ')) ? ' ' : '';
      last.text = (last.text + glue + textClean).replace(/\s+/g, ' ');
    } else {
      const copy = { ...s };
      if (copy.text != null) copy.text = textClean;
      if (copy.text || copy.mathml || copy.latex) collapsed.push(copy);
    }
  }
  return collapsed.length ? collapsed : undefined;
}

/**
 * Normalizes an AST block for canonical comparison.
 */
function normalizeBlock(b) {
  if (!b) return null;
  const copy = { ...b };
  if (copy.text) copy.text = copy.text.replace(/\s+/g, ' ').trim();
  if (copy.title) copy.title = copy.title.replace(/\s+/g, ' ').trim();
  if (copy.level === 0) delete copy.level; // Level 0 is default base level
  if (copy.kind === 'image') delete copy.kind; // XML round-trip standardizes prodnotes
  
  if (copy.type === 'list') {
    if (copy.kind && !copy.style) copy.style = copy.kind;
    if (copy.style && !copy.kind) copy.kind = copy.style;
    if (copy.kind === 'exercise') copy.ordered = true;
  }
  if (copy.type === 'play') {
    if (copy.subtype === 'prose' && !copy.style) copy.style = 'play-speaker';
    if (copy.subtype === 'verse' && !copy.style) copy.style = 'verse';
  }
  if (copy.type === 'stage' && !copy.style) {
    copy.style = 'play-stage';
  }
  if (copy.type === 'box') {
    if (copy.blocks && copy.blocks.length > 0 && copy.blocks[0]?.type === 'heading') {
      copy.title = copy.blocks[0].text;
      copy.blocks[0] = { ...copy.blocks[0], level: 2 };
    }
  }
  if (copy.type === 'math') {
    if (copy.mathml) copy.mathml = copy.mathml.replace(/\s*xmlns:m="[^"]*"/g, '').replace(/\s*altimg="[^"]*"/g, '').replace(/\s*alttext="[^"]*"/g, '').replace(/\s+/g, ' ').trim();
    if (!copy.latex && copy.mathml) {
      const m = copy.mathml.match(/alttext="([^"]+)"/) || copy.mathml.match(/<annotation[^>]*>([^<]+)<\/annotation>/);
      if (m) copy.latex = m[1].trim();
    }
    if (copy.latex === 'math expression') delete copy.latex;
  }
  if (copy.segments) {
    copy.segments = normalizeSegments(copy.segments);
    if (!copy.segments) {
      delete copy.segments;
    } else if (copy.segments.length === 1 && copy.segments[0].type === 'text' && !copy.segments[0].tf && !copy.segments[0].uncontracted && !copy.segments[0].text.includes('\n')) {
      copy.text = copy.segments[0].text;
      delete copy.segments;
    } else {
      delete copy.text; // Segmented blocks are canonically compared on segments
    }
  }
  if (copy.items) {
    copy.items = copy.items.map(it => {
      const itc = { ...it };
      if (itc.text) itc.text = itc.text.replace(/\s+/g, ' ').trim();
      if (itc.term) itc.term = itc.term.replace(/\s+/g, ' ').trim();
      if (itc.def) itc.def = itc.def.replace(/\s+/g, ' ').trim();
      if (itc.level === 0) delete itc.level;
      if (itc.segments) {
        itc.segments = normalizeSegments(itc.segments);
        if (!itc.segments) {
          delete itc.segments;
        } else if (itc.segments.length === 1 && itc.segments[0].type === 'text' && !itc.segments[0].tf && !itc.segments[0].uncontracted && !itc.segments[0].text.includes('\n')) {
          itc.text = itc.segments[0].text;
          delete itc.segments;
        } else {
          delete itc.text;
        }
      }
      if (itc.termSegments) {
        itc.termSegments = normalizeSegments(itc.termSegments);
        if (!itc.termSegments) delete itc.termSegments;
      }
      if (itc.defSegments) {
        itc.defSegments = normalizeSegments(itc.defSegments);
        if (!itc.defSegments) delete itc.defSegments;
      }
      delete itc.marker; // Ordered list markers are computed deterministically on layout
      return itc;
    });
  }
  if (copy.blocks) {
    copy.blocks = copy.blocks.map(normalizeBlock);
  }
  if (copy.rows) {
    copy.rows = copy.rows.map(r => r.map(c => (c || '').replace(/\s+/g, ' ').trim()));
  }
  if (copy.headers) {
    copy.headers = copy.headers.map(h => (h || '').replace(/\s+/g, ' ').trim());
  }
  return copy;
}

/**
 * Performs deep equality comparison between two structured AST nodes.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a).filter(k => a[k] !== undefined);
  const keysB = Object.keys(b).filter(k => b[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Compares two ASTs and returns { match: boolean, diff?: string }
 */
function compareAsts(ast1, ast2) {
  const b1 = (ast1.blocks || []).map(normalizeBlock);
  const b2 = (ast2.blocks || []).map(normalizeBlock);

  if (b1.length !== b2.length) {
    return {
      match: false,
      diff: `Block count mismatch: AST1 has ${b1.length} blocks, AST2 has ${b2.length} blocks`
    };
  }

  for (let i = 0; i < b1.length; i++) {
    if (!deepEqual(b1[i], b2[i])) {
      return {
        match: false,
        diff: `Block #${i} mismatch:\n  AST1: ${JSON.stringify(b1[i]).slice(0, 200)}\n  AST2: ${JSON.stringify(b2[i]).slice(0, 200)}`
      };
    }
  }

  return { match: true };
}

console.log('\n=== NIMAS XML Round-Trip Test Suite ===\n');

// Section 1: Synthetic AST Structures Round-Trip
console.log('--- Section 1: Synthetic AST Block Types ---');
{
  const syntheticAst = {
    title: 'Synthetic Test Document',
    blocks: [
      { type: 'heading', level: 1, text: 'Chapter 1: The Beginning' },
      { type: 'heading', level: 2, text: 'Section 1.1: Overview' },
      { type: 'heading', level: 3, text: 'Subsection 1.1.1: Details' },
      { type: 'para', text: 'This is a standard body paragraph with plain text.' },
      {
        type: 'para',
        text: 'Paragraph with bold, italic, and math x^2 + y^2 = r^2.',
        segments: [
          { type: 'text', text: 'Paragraph with ' },
          { type: 'text', text: 'bold', tf: 4 },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'italic', tf: 1 },
          { type: 'text', text: ', and math ' },
          { type: 'math', latex: 'x^2 + y^2 = r^2', mathml: '<m:math alttext="x^2 + y^2 = r^2" altimg="math.png"><m:semantics><m:mrow><m:mtext>x^2 + y^2 = r^2</m:mtext></m:mrow><m:annotation encoding="application/x-tex">x^2 + y^2 = r^2</m:annotation></m:semantics></m:math>' },
          { type: 'text', text: '.' }
        ]
      },
      {
        type: 'list',
        kind: 'toc',
        items: [
          { text: 'Unit 1: Exploration', page: '1' },
          { text: 'Unit 2: Science', page: '45' }
        ]
      },
      {
        type: 'list',
        items: [
          { text: 'First bullet point' },
          { text: 'Second bullet point' }
        ]
      },
      {
        type: 'list',
        kind: 'exercise',
        items: [
          { text: '1. What is gravity?', level: 0 },
          { text: 'a. A force of attraction', level: 1 }
        ]
      },
      {
        type: 'box',
        title: 'Important Note',
        blocks: [
          { type: 'heading', level: 2, text: 'Important Note' },
          { type: 'para', text: 'Inside sidebar box.' }
        ]
      },
      {
        type: 'table',
        headers: ['Word', 'Definition'],
        rows: [
          ['Atom', 'The smallest unit of ordinary matter.'],
          ['Molecule', 'A group of two or more atoms.']
        ]
      },
      { type: 'play', subtype: 'prose', text: 'HAMLET: To be, or not to be.' },
      { type: 'play', subtype: 'verse', style: 'verse', text: 'Two roads diverged in a yellow wood,' },
      { type: 'stage', text: 'Exeunt Ghost and Hamlet.' },
      { type: 'caption', text: 'Figure 1. Diagram of the solar system.' },
      { type: 'attribution', text: '— William Shakespeare' },
      { type: 'footnote', text: '1. See reference on page 102.' },
      { type: 'note', kind: 'tabletn', text: 'Table note: data collected in 2024.' },
      { type: 'pagenum', text: '14' }
    ]
  };

  const xmlOut = exportToNimasXml(syntheticAst);
  const astRound = parseDtbook(xmlOut);
  const res = compareAsts(syntheticAst, astRound);
  check('Synthetic AST all block types round-trip perfectly', res.match, res.diff);
}

// Section 2: NIMAS Samples Directory Round-Trip
console.log('\n--- Section 2: NIMAS Sample Files Round-Trip ---');
if (fs.existsSync(SAMPLES_DIR)) {
  const sampleFiles = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.xml'));
  for (const file of sampleFiles) {
    const fullPath = path.join(SAMPLES_DIR, file);
    try {
      const xml1 = fs.readFileSync(fullPath, 'utf8');
      const ast1 = parseDtbook(xml1);
      const xml2 = exportToNimasXml(ast1);
      const ast2 = parseDtbook(xml2);
      const res = compareAsts(ast1, ast2);
      check(`Sample file ${file} (${ast1.blocks.length} blocks)`, res.match, res.diff);
    } catch (e) {
      check(`Sample file ${file}`, false, e.message);
    }
  }
}

// Section 3: Large NIMAS Document Round-Trip
console.log('\n--- Section 3: Full 1.45 MB Textbook Round-Trip ---');
const largeCandidates = [
  path.join(HERE, '../web/large-nimas.xml'),
  path.join(HERE, '../dist/large-nimas.xml'),
  path.join(HERE, '../test-nimas.xml'),
];
const largeFile = largeCandidates.find(f => fs.existsSync(f));
if (largeFile) {
  try {
    const xml1 = fs.readFileSync(largeFile, 'utf8');
    const startParse = Date.now();
    const ast1 = parseDtbook(xml1);
    const parseTime = Date.now() - startParse;

    const startExport = Date.now();
    const xml2 = exportToNimasXml(ast1);
    const exportTime = Date.now() - startExport;

    const startParse2 = Date.now();
    const ast2 = parseDtbook(xml2);
    const parseTime2 = Date.now() - startParse2;

    const res = compareAsts(ast1, ast2);
    
    // Count words in AST1 and AST2
    const countWords = (ast) => {
      let count = 0;
      const walkBlocks = (blocks) => {
        for (const b of blocks || []) {
          if (b.blocks && Array.isArray(b.blocks) && b.blocks.length > 0) {
            walkBlocks(b.blocks);
            continue;
          }
          if (b.text) count += b.text.trim().split(/\s+/).filter(Boolean).length;
          if (b.title) count += b.title.trim().split(/\s+/).filter(Boolean).length;
          if (b.items) for (const it of b.items) if (it.text) count += it.text.trim().split(/\s+/).filter(Boolean).length;
          if (b.rows) for (const r of b.rows) for (const c of r) if (c) count += c.trim().split(/\s+/).filter(Boolean).length;
        }
      };
      walkBlocks(ast.blocks);
      return count;
    };

    const w1 = countWords(ast1);
    const w2 = countWords(ast2);

    console.log(`  Stats: ${ast1.blocks.length} blocks, ${w1} words`);
    console.log(`  Performance: Parse1=${parseTime}ms, Export=${exportTime}ms, Parse2=${parseTime2}ms`);
    console.log(`  Word count: AST1=${w1}, AST2=${w2} (Diff = ${w1 - w2})`);

    check(`Large textbook (${path.basename(largeFile)}) round-trip match`, res.match && w1 === w2, res.diff || `w1: ${w1}, w2: ${w2}`);
  } catch (e) {
    check('Large textbook round-trip', false, e.message);
  }
} else {
  console.log('  (Large textbook file not found, checked paths)');
}

console.log(`\nRound-Trip Test Results: ${pass} passed, ${fail} failed.\n`);
process.exit(fail ? 1 : 0);
