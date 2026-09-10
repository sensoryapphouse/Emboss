import fs from 'node:fs';

const bbBrf = fs.readFileSync('/Users/paulblenkhorn/Downloads/Example/9780544087507NIMAS-13206938299211938699.brf', 'utf8');
const emBrf = fs.readFileSync('/Users/paulblenkhorn/Downloads/Example/9780544087507NIMAS_emboss.brf', 'utf8');

// Extract words (tokens separated by whitespace)
const tokenize = (text) => text.split(/\s+/).filter(Boolean);

const bbWords = tokenize(bbBrf);
const emWords = tokenize(emBrf);

console.log('=== TOKEN & VOCABULARY AUDIT ===');
console.log('Total tokens in BrailleBlaster BRF:', bbWords.length.toLocaleString());
console.log('Total tokens in Emboss BRF:        ', emWords.length.toLocaleString());
console.log('Token Difference:                  ', `${(emWords.length - bbWords.length)} (${(((emWords.length - bbWords.length) / bbWords.length) * 100).toFixed(2)}%)`);

// Unique word set overlap
const bbSet = new Set(bbWords);
const emSet = new Set(emWords);

let common = 0;
for (const w of emSet) {
  if (bbSet.has(w)) common++;
}

console.log('Unique vocabulary in BrailleBlaster:', bbSet.size.toLocaleString());
console.log('Unique vocabulary in Emboss:        ', emSet.size.toLocaleString());
console.log('Vocabulary Overlap:                 ', common.toLocaleString());
console.log('Jaccard Vocabulary Similarity:      ', `${((common / (bbSet.size + emSet.size - common)) * 100).toFixed(2)}%`);

// Line density analysis
const bbPages = bbBrf.split('\f').filter(Boolean);
const emPages = emBrf.split('\f').filter(Boolean);

const avgLinesPerPageBB = (bbBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).length / bbPages.length).toFixed(2);
const avgLinesPerPageEM = (emBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).length / emPages.length).toFixed(2);

console.log('\n=== PAGE & LINE DENSITY AUDIT ===');
console.log('Average non-empty lines per page in BrailleBlaster:', avgLinesPerPageBB);
console.log('Average non-empty lines per page in Emboss:        ', avgLinesPerPageEM);

// Check boxline count and table formatting differences
const bbBoxTopCount = (bbBrf.match(/3333333333/g) || []).length;
const emBoxTopCount = (emBrf.match(/3333333333/g) || []).length;
console.log('\n=== STRUCTURAL ELEMENTS AUDIT ===');
console.log('Boxline top borders (333...): BrailleBlaster:', bbBoxTopCount, '| Emboss:', emBoxTopCount);

const bbTableTNs = (bbBrf.match(/Table/gi) || []).length;
const emTableTNs = (emBrf.match(/Table/gi) || []).length;
console.log('Table references:            BrailleBlaster:', bbTableTNs, '| Emboss:', emTableTNs);
