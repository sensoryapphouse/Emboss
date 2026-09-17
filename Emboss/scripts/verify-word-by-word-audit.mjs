import fs from 'node:fs';
import path from 'node:path';

// Word-by-word BRF comparison: BrailleBlaster output vs Emboss output.
//
// Usage:
//   node scripts/verify-word-by-word-audit.mjs <input-dir> <output-dir> [bb.brf] [emboss.brf]
//
//   <input-dir>   directory holding the two .brf files to compare
//   <output-dir>  directory the report (word_by_word_diff_report.txt) is written to
//                 (created if missing)
//   [bb.brf]      basename of the BrailleBlaster .brf inside <input-dir>
//   [emboss.brf]  basename of the Emboss .brf inside <input-dir>
//
// If the two basenames are omitted the script looks for exactly one pair of
// "<stem>_emboss.brf" + "<stem>.brailleblaster_out.brf" (or "<stem>-<digits>.brf",
// BrailleBlaster's export naming) in <input-dir>. The committed fixture pair
// lives in tests/nimas_samples, e.g.:
//   node scripts/verify-word-by-word-audit.mjs tests/nimas_samples /tmp/audit \
//        9780544087507NIMAS.brailleblaster_out.brf 9780544087507NIMAS_emboss.brf
//
// Exit codes: 0 report written; 2 usage error (missing args / files not found).

function usage(msg) {
  if (msg) console.error(`ERROR: ${msg}\n`);
  console.error('Usage: node scripts/verify-word-by-word-audit.mjs <input-dir> <output-dir> [bb.brf] [emboss.brf]');
  console.error('  <input-dir>   directory containing the BrailleBlaster and Emboss .brf files');
  console.error('  <output-dir>  directory to write word_by_word_diff_report.txt into');
  console.error('  [bb.brf]      optional basename of the BrailleBlaster .brf in <input-dir>');
  console.error('  [emboss.brf]  optional basename of the Emboss .brf in <input-dir>');
  process.exit(2);
}

const [inputDirArg, outputDirArg, bbNameArg, emNameArg] = process.argv.slice(2);
if (!inputDirArg || !outputDirArg) usage('both <input-dir> and <output-dir> are required');
const inputDir = path.resolve(inputDirArg);
const outputDir = path.resolve(outputDirArg);
if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) usage(`input dir not found: ${inputDir}`);

let bbPath, emPath;
if (bbNameArg || emNameArg) {
  if (!bbNameArg || !emNameArg) usage('give both [bb.brf] and [emboss.brf] basenames, or neither');
  bbPath = path.join(inputDir, bbNameArg);
  emPath = path.join(inputDir, emNameArg);
} else {
  const files = fs.readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith('.brf'));
  const pairs = [];
  for (const f of files) {
    const m = f.match(/^(.*)_emboss\.brf$/i);
    if (!m) continue;
    const stem = m[1];
    const bb = files.find((g) => g !== f && (g === `${stem}.brailleblaster_out.brf` || (g.startsWith(`${stem}-`) && /-\d+\.brf$/i.test(g))));
    if (bb) pairs.push({ bb, em: f });
  }
  if (pairs.length !== 1) {
    usage(`expected exactly one <stem>_emboss.brf / <stem>.brailleblaster_out.brf pair in ${inputDir}, found ${pairs.length}${pairs.length ? ': ' + pairs.map((p) => p.em).join(', ') : ''} — pass the two basenames explicitly`);
  }
  bbPath = path.join(inputDir, pairs[0].bb);
  emPath = path.join(inputDir, pairs[0].em);
}
if (!fs.existsSync(bbPath)) usage(`BrailleBlaster .brf not found: ${bbPath}`);
if (!fs.existsSync(emPath)) usage(`Emboss .brf not found: ${emPath}`);
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'word_by_word_diff_report.txt');

console.log(`BrailleBlaster BRF: ${bbPath}`);
console.log(`Emboss BRF:         ${emPath}`);

const bbBrf = fs.readFileSync(bbPath, 'utf8');
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

console.log('Tokenizing BrailleBlaster BRF...');
const bbWords = cleanWords(bbBrf);
console.log(`BrailleBlaster tokens: ${bbWords.length}`);

console.log('Tokenizing Emboss BRF...');
const emWords = cleanWords(emBrf);
console.log(`Emboss tokens:         ${emWords.length}`);

// Normalize helper to compare actual braille word content without font indicator tags
const norm = (w) => w.replace(/\^[\x271-9]/g, '').replace(/^[,\.;:\?!"]+/, '').replace(/[,\.;:\?!"]+$/, '').trim();

let bi = 0, ei = 0;
let matchCount = 0;
let normMatchCount = 0;
const diffEntries = [];

while (bi < bbWords.length && ei < emWords.length) {
  const bw = bbWords[bi];
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
      if (bi + k < bbWords.length && norm(bbWords[bi + k]) === norm(ew)) {
        diffEntries.push({
          type: 'BB_EXTRA',
          bbIndex: bi,
          emIndex: ei,
          bbWords: bbWords.slice(bi, bi + k).join(' '),
          sampleEmbossContext: emWords.slice(Math.max(0, ei - 2), ei + 3).join(' ')
        });
        bi += k;
        found = true;
        break;
      }
      if (ei + k < emWords.length && norm(bw) === norm(emWords[ei + k])) {
        diffEntries.push({
          type: 'EMBOSS_EXTRA',
          bbIndex: bi,
          emIndex: ei,
          emWords: emWords.slice(ei, ei + k).join(' '),
          sampleBBContext: bbWords.slice(Math.max(0, bi - 2), bi + 3).join(' ')
        });
        ei += k;
        found = true;
        break;
      }
    }

    if (!found) {
      diffEntries.push({
        type: 'WORD_MISMATCH',
        bbIndex: bi,
        emIndex: ei,
        bbWord: bw,
        emWord: ew
      });
      bi++;
      ei++;
    }
  }
}

const reportLines = [];
reportLines.push('================================================================================');
reportLines.push('EXHAUSTIVE WORD-BY-WORD COMPARISON AUDIT: EMBOSS vs BRAILLEBLASTER');
reportLines.push(`BrailleBlaster: ${path.basename(bbPath)}`);
reportLines.push(`Emboss:         ${path.basename(emPath)}`);
reportLines.push(`Generated at: ${new Date().toISOString()}`);
reportLines.push('================================================================================\n');
reportLines.push(`Total BrailleBlaster Word Tokens: ${bbWords.length.toLocaleString()}`);
reportLines.push(`Total Emboss Word Tokens:         ${emWords.length.toLocaleString()}`);
reportLines.push(`Exact Token Matches:             ${matchCount.toLocaleString()} (${((matchCount / bbWords.length) * 100).toFixed(2)}%)`);
reportLines.push(`Normalized Word Matches:         ${normMatchCount.toLocaleString()} (${((normMatchCount / bbWords.length) * 100).toFixed(2)}%)\n`);
reportLines.push(`Total Alignment Differences:     ${diffEntries.length.toLocaleString()}\n`);
reportLines.push('--------------------------------------------------------------------------------');
reportLines.push('DETAILED LIST OF DIFFERENCES (FIRST 200 ENTRIES):');
reportLines.push('--------------------------------------------------------------------------------');

diffEntries.slice(0, 200).forEach((d, idx) => {
  reportLines.push(`\n[Diff #${idx + 1}] Type: ${d.type} (BB Word #${d.bbIndex} | Emboss Word #${d.emIndex})`);
  if (d.type === 'BB_EXTRA') {
    reportLines.push(`  Extra in BrailleBlaster: "${d.bbWords}"`);
    reportLines.push(`  Context in Emboss:       "... ${d.sampleEmbossContext} ..."`);
  } else if (d.type === 'EMBOSS_EXTRA') {
    reportLines.push(`  Extra in Emboss:         "${d.emWords}"`);
    reportLines.push(`  Context in BB:           "... ${d.sampleBBContext} ..."`);
  } else {
    reportLines.push(`  BrailleBlaster Word:     "${d.bbWord}"`);
    reportLines.push(`  Emboss Word:             "${d.emWord}"`);
  }
});

fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');
console.log(`Full report saved to: ${reportPath}`);
