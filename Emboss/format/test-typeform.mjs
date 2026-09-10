// Typeform (bold/italic/underline) emphasis gate. Verifies against the REAL
// liblouis engine that the emphasis bits produce the correct UEB indicators,
// and that the segmented-paragraph formatter emits them in place.
import path from 'path'; import { fileURLToPath } from 'url';
import * as louis from '../engine/louis.mjs';
import { formatDocument } from './document.mjs';
import { styledTranslate } from './text-style.mjs';

import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`); }
};

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  const tf = (word, bits) => Array(word.length).fill(bits);

  // ---- 1. engine level: emphasis bits -> UEB word indicators ----
  const plain = louis.translate('important', T);
  const bold = louis.translate('important', T, tf('important', louis.TYPEFORM.bold));
  const ital = louis.translate('important', T, tf('important', louis.TYPEFORM.italic));
  const undl = louis.translate('important', T, tf('important', louis.TYPEFORM.underline));
  check('plain has no emphasis prefix', plain === 'IMPORTANT', JSON.stringify(plain));
  check('bold -> UEB bold word indicator "^1"', bold === '^1IMPORTANT', JSON.stringify(bold));
  check('italic -> UEB italic word indicator ".1"', ital === '.1IMPORTANT', JSON.stringify(ital));
  check('underline -> UEB underline word indicator "_1"', undl === '_1IMPORTANT', JSON.stringify(undl));
  check('no typeform arg == plain (backward compatible)', louis.translate('important', T) === plain);

  // ---- 2. formatter path: a paragraph with an emphasised run ----
  const translate = styledTranslate((t, tfArr) => louis.translate(t, T, tfArr), 'faithful');
  const model = { title: null, blocks: [{
    type: 'para',
    segments: [
      { type: 'text', text: 'This word is ' },
      { type: 'text', text: 'important', tf: louis.TYPEFORM.bold },
      { type: 'text', text: ', and this is ' },
      { type: 'text', text: 'emphasised', tf: louis.TYPEFORM.italic },
      { type: 'text', text: '.' },
    ],
  }] };
  const brf = formatDocument(model, { mode: 'ukaaf', width: 38, depth: 25, listStyle: 'spaced', translate });
  const body = brf.replace(/\r\n/g, ' ');
  check('formatter emits bold indicator before "important"', /\^1IMPORTANT/.test(body), body);
  check('formatter emits italic indicator before "emphasised"', /\.1EMPHASIS/.test(body), body);
  check('punctuation stays tight after emphasis (no spurious space)', /IMPORTANT1/.test(body), body);

  // ---- 3. a plain paragraph (text, not segments) is byte-identical with/without the tf-aware translate ----
  const plainModel = { title: null, blocks: [{ type: 'para', text: 'This word is important, and this is emphasised.' }] };
  const brfPlain = formatDocument(plainModel, { mode: 'ukaaf', width: 38, depth: 25, listStyle: 'spaced', translate });
  check('plain paragraph has no emphasis indicators', !/\^1|\.1|_1/.test(brfPlain.replace(/\r\n/g, ' ')), brfPlain);

  console.log(`\ntypeform gate: ${pass}/${pass + fail} checks pass`);
  process.exit(fail ? 1 : 0);
})();
