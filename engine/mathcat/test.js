// Node test for the emboss_mathcat wasm-pack (nodejs target) package.
// Run with: node test.js

const mathcat = require('./pkg-nodejs/emboss_mathcat.js');

function hr() {
  console.log('-'.repeat(60));
}

console.log('MathCAT version:', mathcat.mathcat_version());
console.log('Supported braille codes:', mathcat.supported_braille_codes());
hr();

const samples = [
  {
    label: 'x^2 + 1',
    mathml: '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>',
  },
  {
    label: '1/2 (fraction)',
    mathml: '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
  },
];

const codes = ['Nemeth', 'UEB'];

let allNonEmpty = true;
const results = {};

for (const sample of samples) {
  results[sample.label] = {};
  console.log(`MathML: ${sample.mathml}`);
  for (const code of codes) {
    const braille = mathcat.mathml_to_braille(sample.mathml, code);
    results[sample.label][code] = braille;
    console.log(`  [${code}] -> "${braille}"`);
    if (!braille || braille.length === 0 || braille.startsWith('ERROR')) {
      allNonEmpty = false;
      console.error(`  !! Problem with ${sample.label} / ${code}: "${braille}"`);
    }
  }
  hr();
}

let allDiffer = true;
for (const sample of samples) {
  const nemeth = results[sample.label]['Nemeth'];
  const ueb = results[sample.label]['UEB'];
  if (nemeth === ueb) {
    allDiffer = false;
    console.error(`!! Nemeth and UEB outputs are IDENTICAL for ${sample.label}: "${nemeth}"`);
  }
}

console.log('All outputs non-empty and error-free:', allNonEmpty);
console.log('Nemeth output differs from UEB output for each sample:', allDiffer);

if (!allNonEmpty || !allDiffer) {
  process.exitCode = 1;
} else {
  console.log('TEST PASSED');
}
