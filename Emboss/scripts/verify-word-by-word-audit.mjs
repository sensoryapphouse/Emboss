import fs from 'node:fs';

const bbPath = '/Users/paulblenkhorn/Downloads/Example/9780544087507NIMAS-13206938299211938699.brf';
const emPath = '/Users/paulblenkhorn/Downloads/Example/9780544087507NIMAS_emboss.brf';
const reportPath = '/Users/paulblenkhorn/Downloads/Example/word_by_word_diff_report.txt';

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
reportLines.push('Document: Collections, Grade 7 (NIMAS XML)');
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
