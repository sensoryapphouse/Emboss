// Parity gate: WASM liblouis must byte-match the native lou_translate oracle.
const path = require('path');
const { execFileSync } = require('child_process');
const createLiblouis = require('./liblouis-wasm.js');

const BR = '/Users/paulblenkhorn/Documents/Development/PWAs/To do next/Braille';
const TABLES = path.join(BR, 'liblouis', 'tables');
const ORACLE = path.join(BR, 'oracle', 'lou_translate');
const TABLELIST_NATIVE = 'en-us-brf.dis,en-ueb-g2.ctb';
const TABLELIST_WASM = '/tables/en-us-brf.dis,/tables/en-ueb-g2.ctb';

// native oracle translation for a line
function native(text) {
  return execFileSync(ORACLE, [TABLELIST_NATIVE], {
    input: text, env: { ...process.env, LOUIS_TABLEPATH: TABLES }, encoding: 'utf8',
  }).replace(/\r?\n$/, '');
}

const BATTERY = [
  'Knowledge is power.',
  'Once upon a time a poor woodman lived with his wife in the middle of a forest.',
  'The quick brown fox jumps over the lazy dog.',
  'Chapter 1: Introduction',
  'hello world',
  'It was the best of times, it was the worst of times.',
  "It's a lovely day, isn't it?",
  '1234567890 and 3.14159',
  'ACCESSIBILITY for ALL',
  'Every good boy deserves fruit; the others do not.',
  'She said, "Braille matters."',
  'antidisestablishmentarianism',
];

createLiblouis().then((M) => {
  // mount the project tables read-only into the WASM FS at /tables
  M.FS.mkdir('/tables');
  M.FS.mount(M.FS.filesystems.NODEFS, { root: TABLES }, '/tables');

  const version = M.ccall('lou_version', 'string', [], []);
  const charSize = M.ccall('lou_charSize', 'number', [], []);
  console.log('WASM liblouis version:', version, ' charSize:', charSize, '(expect 2 = UTF-16)');
  if (charSize !== 2) { console.error('UNEXPECTED charSize — wrapper assumes 16-bit widechar'); process.exit(2); }

  function wasmTranslate(tableList, text) {
    const inLen = text.length;                       // UTF-16 code units
    const inPtr = M._malloc(Math.max(inLen, 1) * 2);
    for (let i = 0; i < inLen; i++) M.setValue(inPtr + i * 2, text.charCodeAt(i), 'i16');
    const outCap = inLen * 4 + 256;                  // generous
    const outPtr = M._malloc(outCap * 2);
    const inLenPtr = M._malloc(4); M.setValue(inLenPtr, inLen, 'i32');
    const outLenPtr = M._malloc(4); M.setValue(outLenPtr, outCap, 'i32');
    const rc = M.ccall('lou_translateString', 'number',
      ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [tableList, inPtr, inLenPtr, outPtr, outLenPtr, 0, 0, 0]);
    let out = null;
    if (rc) {
      const outLen = M.getValue(outLenPtr, 'i32');
      out = '';
      for (let i = 0; i < outLen; i++) out += String.fromCharCode(M.getValue(outPtr + i * 2, 'i16') & 0xffff);
    }
    M._free(inPtr); M._free(outPtr); M._free(inLenPtr); M._free(outLenPtr);
    return out;
  }

  let pass = 0;
  for (const text of BATTERY) {
    const w = wasmTranslate(TABLELIST_WASM, text);
    const n = native(text);
    const ok = w === n;
    if (ok) pass++;
    console.log(`${ok ? '✅' : '❌'} ${JSON.stringify(text)}`);
    if (!ok) { console.log(`   wasm:   ${JSON.stringify(w)}`); console.log(`   native: ${JSON.stringify(n)}`); }
  }
  console.log(`\nPARITY: ${pass}/${BATTERY.length} byte-identical to native oracle`);
  process.exit(pass === BATTERY.length ? 0 : 1);
}).catch((e) => { console.error('module load failed:', e); process.exit(3); });
