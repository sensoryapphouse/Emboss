#!/usr/bin/env node
// Measures save fidelity: for every DTBook sample in Emboss/tests/nimas_samples/,
// loads it (parseDtbook), exports it straight back out (exportToNimasXml), and
// counts a fixed set of elements in the XML text before and after.
//
// This is a *measurement* tool (A19/A20/A21/A22), not a pass/fail test — it exists
// so the numbers in Emboss/docs/wip/A19-save-fidelity.md are reproducible evidence,
// not a one-off manual count. See that file for what each count means.
//
//   node Emboss/scripts/measure-save-fidelity.mjs [--file NAME.xml]
//
// Counts are done on the raw XML text with tag-boundary regexes (not by walking
// the parsed AST), so the "before" count reflects exactly what the source file
// contains, independent of anything the parser itself already loses.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(HERE, '..', 'tests', 'nimas_samples');

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}
const ONLY_FILE = flag('--file');

// --- element counters (tag-boundary regex over raw XML text) ---------------
function count(xml, re) {
  const m = xml.match(re);
  return m ? m.length : 0;
}

function countAll(xml) {
  return {
    poem: count(xml, /<poem[\s>]/g),
    linegroup: count(xml, /<linegroup[\s>]/g),
    line: count(xml, /<line[\s>]/g),              // <line>, not <linegroup>/<linenum> (both excluded by the boundary char)
    a_href: count(xml, /<a\s[^>]*\bhref=/g),
    cite: count(xml, /<cite[\s>]/g),
    div_class: count(xml, /<div\s[^>]*\bclass=/g),
    blockquote: count(xml, /<blockquote[\s>]/g),
    docauthor: count(xml, /<docauthor[\s>]/g),
    prodnote: count(xml, /<prodnote[\s>]/g),
    prodnote_render_required: count(xml, /<prodnote\s[^>]*\brender="required"/g),
    prodnote_render_optional: count(xml, /<prodnote\s[^>]*\brender="optional"/g),
  };
}

const LABELS = {
  poem: '<poem>',
  linegroup: '<linegroup>',
  line: '<line>',
  a_href: '<a href>',
  cite: '<cite>',
  div_class: '<div class>',
  blockquote: '<blockquote>',
  docauthor: '<docauthor>',
  prodnote: '<prodnote>',
  prodnote_render_required: '  - render="required"',
  prodnote_render_optional: '  - render="optional"',
};

function diffSign(before, after) {
  if (after === before) return '=';
  return after < before ? 'LOSS' : '+';
}

function main() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.error(`Samples directory not found: ${SAMPLES_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith('.xml'))
    .filter((f) => !ONLY_FILE || f === ONLY_FILE)
    .sort();

  const totals = {};
  const totalsAfter = {};
  for (const key of Object.keys(LABELS)) { totals[key] = 0; totalsAfter[key] = 0; }

  let anyLoss = false;
  const perFileRows = [];

  for (const file of files) {
    const fullPath = path.join(SAMPLES_DIR, file);
    const xmlBefore = fs.readFileSync(fullPath, 'utf8');
    let xmlAfter = '';
    let error = null;
    try {
      const doc = parseDtbook(xmlBefore);
      xmlAfter = exportToNimasXml(doc);
    } catch (e) {
      error = e;
    }

    if (error) {
      perFileRows.push({ file, error: error.message });
      continue;
    }

    const before = countAll(xmlBefore);
    const after = countAll(xmlAfter);
    let fileHasLoss = false;
    for (const key of Object.keys(LABELS)) {
      totals[key] += before[key];
      totalsAfter[key] += after[key];
      if (after[key] < before[key]) fileHasLoss = true;
    }
    perFileRows.push({ file, before, after, fileHasLoss });
    if (fileHasLoss) anyLoss = true;
  }

  console.log('=== Save-fidelity element counts (before -> after a parse/export round trip) ===\n');
  for (const row of perFileRows) {
    if (row.error) {
      console.log(`${row.file}: ERROR ${row.error}`);
      continue;
    }
    const interesting = Object.keys(LABELS).some((k) => row.before[k] > 0);
    if (!interesting) continue; // skip samples with none of the tracked elements
    console.log(`${row.file}${row.fileHasLoss ? '  *** LOSS ***' : ''}`);
    for (const key of Object.keys(LABELS)) {
      if (row.before[key] === 0 && row.after[key] === 0) continue;
      const sign = diffSign(row.before[key], row.after[key]);
      console.log(`  ${LABELS[key].padEnd(24)} ${row.before[key]} -> ${row.after[key]}  ${sign}`);
    }
    console.log('');
  }

  console.log('=== Totals across all samples ===\n');
  for (const key of Object.keys(LABELS)) {
    if (totals[key] === 0 && totalsAfter[key] === 0) continue;
    const sign = diffSign(totals[key], totalsAfter[key]);
    console.log(`  ${LABELS[key].padEnd(24)} ${totals[key]} -> ${totalsAfter[key]}  ${sign}`);
  }
  console.log('');
  console.log(anyLoss ? 'RESULT: losses found (see *** LOSS *** rows above).' : 'RESULT: no losses in the tracked elements.');
  process.exit(0); // measurement tool: always exits 0, the numbers are the point
}

main();
