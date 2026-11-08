import fs from 'node:fs';
import path from 'node:path';

// Word-by-word BRF comparison: Reference output vs Emboss output.
//
// Usage:
//   node scripts/verify-word-by-word-audit.mjs <input-dir> <output-dir> [ref.brf] [emboss.brf]
//
//   <input-dir>   directory holding the two .brf files to compare
//   <output-dir>  directory the report (word_by_word_diff_report.txt) is written to
//                 (created if missing)
//   [ref.brf]      basename of the Reference .brf inside <input-dir>
//   [emboss.brf]  basename of the Emboss .brf inside <input-dir>
//
// If the two basenames are omitted the script looks for exactly one pair of
// "<stem>_emboss.brf" + "<stem>.reference.brf" (or "<stem>-<digits>.brf",
// Reference's export naming) in <input-dir>. The committed fixture pair
// lives in tests/nimas_samples, e.g.:
//   node scripts/verify-word-by-word-audit.mjs tests/nimas_samples /tmp/audit \
//        9780544087507NIMAS.reference.brf 9780544087507NIMAS_emboss.brf
//
// Exit codes: 0 report written; 2 usage error (missing args / files not found).

function usage(msg) {
  if (msg) console.error(`ERROR: ${msg}\n`);
  console.error('Usage: node scripts/verify-word-by-word-audit.mjs <input-dir> <output-dir> [ref.brf] [emboss.brf]');
  console.error('  <input-dir>   directory containing the Reference and Emboss .brf files');
  console.error('  <output-dir>  directory to write word_by_word_diff_report.txt into');
  console.error('  [ref.brf]      optional basename of the Reference .brf in <input-dir>');
  console.error('  [emboss.brf]  optional basename of the Emboss .brf in <input-dir>');
  process.exit(2);
}

const [inputDirArg, outputDirArg, refNameArg, emNameArg] = process.argv.slice(2);
if (!inputDirArg || !outputDirArg) usage('both <input-dir> and <output-dir> are required');
const inputDir = path.resolve(inputDirArg);
const outputDir = path.resolve(outputDirArg);
if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) usage(`input dir not found: ${inputDir}`);

let refPath, emPath;
if (refNameArg || emNameArg) {
  if (!refNameArg || !emNameArg) usage('give both [ref.brf] and [emboss.brf] basenames, or neither');
  refPath = path.join(inputDir, refNameArg);
  emPath = path.join(inputDir, emNameArg);
} else {
  const files = fs.readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith('.brf'));
  const pairs = [];
  for (const f of files) {
    const m = f.match(/^(.*)_emboss\.brf$/i);
    if (!m) continue;
    const stem = m[1];
    const ref = files.find((g) => g !== f && (g === `${stem}.reference.brf` || (g.startsWith(`${stem}-`) && /-\d+\.brf$/i.test(g))));
    if (ref) pairs.push({ ref, em: f });
  }
  if (pairs.length !== 1) {
    usage(`expected exactly one <stem>_emboss.brf / <stem>.reference.brf pair in ${inputDir}, found ${pairs.length}${pairs.length ? ': ' + pairs.map((p) => p.em).join(', ') : ''} — pass the two basenames explicitly`);
  }
  refPath = path.join(inputDir, pairs[0].ref);
  emPath = path.join(inputDir, pairs[0].em);
}
if (!fs.existsSync(refPath)) usage(`Reference .brf not found: ${refPath}`);
if (!fs.existsSync(emPath)) usage(`Emboss .brf not found: ${emPath}`);
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'word_by_word_diff_report.txt');

console.log(`Reference BRF: ${refPath}`);
console.log(`Emboss BRF:         ${emPath}`);

const refBrf = fs.readFileSync(refPath, 'utf8');
const emBrf = fs.readFileSync(emPath, 'utf8');

// Extract clean words from braille text, stripping form feeds, line breaks, and page indicators
const cleanWords = (brf) => {
  return brf
    .replace(/\f/g, ' \n ')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^3{5,}$/.test(t) || /^7{5,}$/.test(t)) return false; // box borders
      if (/^---.*---$/.test(t)) return false; // print page separators
      if (/^#[A-J0-9]+$/i.test(t)) return false; // standalone page numbers
      return true;
    })
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
};

console.log('Tokenizing Reference BRF...');
const refWords = cleanWords(refBrf);
console.log(`Reference tokens: ${refWords.length}`);

console.log('Tokenizing Emboss BRF...');
const emWords = cleanWords(emBrf);
console.log(`Emboss tokens:         ${emWords.length}`);

// Normalize helper to compare actual braille word content without font indicator tags
const norm = (w) => w.replace(/\^[\x271-9]/g, '').replace(/^[,\.;:\?!"]+/, '').replace(/[,\.;:\?!"]+$/, '').trim();

let bi = 0, ei = 0;
let matchCount = 0;
let normMatchCount = 0;
const diffEntries = [];

while (bi < refWords.length && ei < emWords.length) {
  const bw = refWords[bi];
  const ew = emWords[ei];

  if (bw === ew) {
    matchCount++;
    normMatchCount++;
    bi++;
    ei++;
  } else if (norm(bw) === norm(ew)) {
    normMatchCount++;
    bi++;
    ei++;
  } else {
    // Look ahead in window up to 40 words to find realignment
    let found = false;
    for (let k = 1; k <= 40; k++) {
      if (bi + k < refWords.length && norm(refWords[bi + k]) === norm(ew)) {
        diffEntries.push({
          type: 'BB_EXTRA',
          refIndex: bi,
          emIndex: ei,
          refWords: refWords.slice(bi, bi + k).join(' '),
          sampleEmbossContext: emWords.slice(Math.max(0, ei - 2), ei + 3).join(' ')
        });
        bi += k;
        found = true;
        break;
      }
      if (ei + k < emWords.length && norm(bw) === norm(emWords[ei + k])) {
        diffEntries.push({
          type: 'EMBOSS_EXTRA',
          refIndex: bi,
          emIndex: ei,
          emWords: emWords.slice(ei, ei + k).join(' '),
          sampleBBContext: refWords.slice(Math.max(0, bi - 2), bi + 3).join(' ')
        });
        ei += k;
        found = true;
        break;
      }
    }

    if (!found) {
      diffEntries.push({
        type: 'WORD_MISMATCH',
        refIndex: bi,
        emIndex: ei,
        refWord: bw,
        emWord: ew
      });
      bi++;
      ei++;
    }
  }
}

const reportLines = [];
reportLines.push('================================================================================');
reportLines.push('EXHAUSTIVE WORD-BY-WORD COMPARISON AUDIT: EMBOSS vs REFERENCE');
reportLines.push(`Reference: ${path.basename(refPath)}`);
reportLines.push(`Emboss:         ${path.basename(emPath)}`);
reportLines.push(`Generated at: ${new Date().toISOString()}`);
reportLines.push('================================================================================\n');
reportLines.push(`Total Reference Word Tokens: ${refWords.length.toLocaleString()}`);
reportLines.push(`Total Emboss Word Tokens:         ${emWords.length.toLocaleString()}`);
reportLines.push(`Exact Token Matches:             ${matchCount.toLocaleString()} (${((matchCount / refWords.length) * 100).toFixed(2)}%)`);
reportLines.push(`Normalized Word Matches:         ${normMatchCount.toLocaleString()} (${((normMatchCount / refWords.length) * 100).toFixed(2)}%)\n`);
reportLines.push(`Total Alignment Differences:     ${diffEntries.length.toLocaleString()}\n`);
reportLines.push('--------------------------------------------------------------------------------');
reportLines.push('DETAILED LIST OF DIFFERENCES (FIRST 200 ENTRIES):');
reportLines.push('--------------------------------------------------------------------------------');

diffEntries.slice(0, 200).forEach((d, idx) => {
  reportLines.push(`\n[Diff #${idx + 1}] Type: ${d.type} (Reference Word #${d.refIndex} | Emboss Word #${d.emIndex})`);
  if (d.type === 'BB_EXTRA') {
    reportLines.push(`  Extra in Reference: "${d.refWords}"`);
    reportLines.push(`  Context in Emboss:       "... ${d.sampleEmbossContext} ..."`);
  } else if (d.type === 'EMBOSS_EXTRA') {
    reportLines.push(`  Extra in Emboss:         "${d.emWords}"`);
    reportLines.push(`  Context in Reference:           "... ${d.sampleBBContext} ..."`);
  } else {
    reportLines.push(`  Reference Word:     "${d.refWord}"`);
    reportLines.push(`  Emboss Word:             "${d.emWord}"`);
  }
});

fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');
console.log(`Full report saved to: ${reportPath}`);
