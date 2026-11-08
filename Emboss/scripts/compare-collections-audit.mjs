import fs from 'node:fs';

const refBrf = fs.readFileSync('/Users/paulblenkhorn/Downloads/Example/9780544087507NIMAS-13206938299211938699.brf', 'utf8');
const emBrf = fs.readFileSync('/Users/paulblenkhorn/Downloads/Example/9780544087507NIMAS_emboss.brf', 'utf8');

// Extract words (tokens separated by whitespace)
const tokenize = (text) => text.split(/\s+/).filter(Boolean);

const refWords = tokenize(refBrf);
const emWords = tokenize(emBrf);

console.log('=== TOKEN & VOCABULARY AUDIT ===');
console.log('Total tokens in Reference BRF:', refWords.length.toLocaleString());
console.log('Total tokens in Emboss BRF:        ', emWords.length.toLocaleString());
console.log('Token Difference:                  ', `${(emWords.length - refWords.length)} (${(((emWords.length - refWords.length) / refWords.length) * 100).toFixed(2)}%)`);

// Unique word set overlap
const refSet = new Set(refWords);
const emSet = new Set(emWords);

let common = 0;
for (const w of emSet) {
  if (refSet.has(w)) common++;
}

console.log('Unique vocabulary in Reference:', refSet.size.toLocaleString());
console.log('Unique vocabulary in Emboss:        ', emSet.size.toLocaleString());
console.log('Vocabulary Overlap:                 ', common.toLocaleString());
console.log('Jaccard Vocabulary Similarity:      ', `${((common / (refSet.size + emSet.size - common)) * 100).toFixed(2)}%`);

// Line density analysis
const refPages = refBrf.split('\f').filter(Boolean);
const emPages = emBrf.split('\f').filter(Boolean);

const avgLinesPerPageRef = (refBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).length / refPages.length).toFixed(2);
const avgLinesPerPageEM = (emBrf.split(/\r?\n/).filter((l) => l.trim().length > 0).length / emPages.length).toFixed(2);

console.log('\n=== PAGE & LINE DENSITY AUDIT ===');
console.log('Average non-empty lines per page in Reference:', avgLinesPerPageRef);
console.log('Average non-empty lines per page in Emboss:        ', avgLinesPerPageEM);

// Check boxline count and table formatting differences
const refBoxTopCount = (refBrf.match(/3333333333/g) || []).length;
const emBoxTopCount = (emBrf.match(/3333333333/g) || []).length;
console.log('\n=== STRUCTURAL ELEMENTS AUDIT ===');
console.log('Boxline top borders (333...): Reference:', refBoxTopCount, '| Emboss:', emBoxTopCount);

const refTableTNs = (refBrf.match(/Table/gi) || []).length;
const emTableTNs = (emBrf.match(/Table/gi) || []).length;
console.log('Table references:            Reference:', refTableTNs, '| Emboss:', emTableTNs);
