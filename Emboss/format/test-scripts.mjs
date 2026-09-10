import path from 'path'; import fs from 'fs'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Validate docx subscript/superscript (w:vertAlign) support end-to-end:
//   parseDocx reads run vertical alignment and brackets the run with script
//   markers; styledTranslate turns them into the UEB level indicators; the
//   result reproduces the gold subscript sign ";5#B" for CO2 in sample3.brf.
// Runs the REAL parseDocx over a hand-built (stored/uncompressed) .docx zip, so
// the whole path — unzip, DOM walk, run detection, block model — is exercised.

import * as louis from '../engine/louis.mjs';
import { styledTranslate, SCRIPT_MARKS } from './text-style.mjs';
import { formatDocument } from './document.mjs';

import { DOMParser } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;                       // parseDocx uses new DOMParser()
const { parseDocx } = await import('../input/parse.mjs');
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

// --- minimal ZIP writer: one STORED (method 0) entry; unzipEntry ignores CRC ---
function storedZip(name, content) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name), data = enc.encode(content);
  const nlen = nameB.length, dlen = data.length;
  const b = [];
  const u16 = (v) => b.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  // local file header + name + data
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0); u32(0); u32(dlen); u32(dlen); u16(nlen); u16(0);
  for (const x of nameB) b.push(x);
  for (const x of data) b.push(x);
  const cdOffset = b.length;
  // central directory header + name
  u32(0x02014b50); u16(20); u16(20); u16(0); u16(0); u16(0); u16(0); u32(0); u32(dlen); u32(dlen);
  u16(nlen); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0);
  for (const x of nameB) b.push(x);
  const cdSize = b.length - cdOffset;
  // end of central directory
  u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cdSize); u32(cdOffset); u16(0);
  return Uint8Array.from(b).buffer;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// A docx paragraph "limiting CO<sub>2</sub> emissions." — the CO2 of sample3.
const docx = (runsXml) => storedZip('word/document.xml',
  `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p>${runsXml}</w:p></w:body></w:document>`);
const run = (text, valign) => `<w:r>${valign ? `<w:rPr><w:vertAlign w:val="${valign}"/></w:rPr>` : ''}` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  (ok ? pass++ : fail++);
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) { console.log(`     got:  ${JSON.stringify(got)}`); console.log(`     want: ${JSON.stringify(want)}`); }
};

await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
const rawG2 = (t) => louis.translate(t, louis.TABLES.uebG2);
const translate = styledTranslate(rawG2, 'faithful');
const { subOpen, supOpen, end } = SCRIPT_MARKS;

// 1. Parser reads w:vertAlign="subscript" and brackets that run only.
const co2 = await parseDocx(docx(run('limiting CO') + run('2', 'subscript') + run(' emissions.')));
check('parseDocx brackets the subscript run',
  co2.blocks[0]?.text, `limiting CO${subOpen}2${end} emissions.`);

// 2. The gold sign exists in the corpus and we reproduce it exactly.
const gold = fs.readFileSync(path.join(projectRoot, 'corpus', 'ukaaf', 'sample3.brf'), 'latin1');
check('gold sample3.brf contains the ";5#B" subscript sign', gold.includes(',,CO;5#B'), true);
check('translate(parsed CO2 paragraph) == gold line',
  translate(co2.blocks[0].text), 'LIMIT+ ,,CO;5#B EMIS.NS4');

// 3. formatDocument (full block formatter) emits the subscript sign.
const brf = formatDocument({ blocks: [{ type: 'para', text: co2.blocks[0].text }] },
  { mode: 'ukaaf', width: 38, depth: 25, translate });
check('formatDocument output contains ",,CO;5#B"', brf.includes(',,CO;5#B'), true);

// 4. The two level indicators, in isolation, are the correct UEB signs: the
//    subscript sign ";5" (== the gold CO2 sign) and the superscript sign ";9"
//    (== the sign in liblouis's own precomposed "²" -> "X;9#B"). (Isolating the
//    indicator avoids the baseline letter's own grade-1 context, which — as with
//    any contraction — is not shared across a script boundary.)
const sup = await parseDocx(docx(run('x') + run('2', 'superscript')));
check('parseDocx brackets the superscript run', sup.blocks[0]?.text, `x${supOpen}2${end}`);
check('subscript sign is ";5#B"', translate(`${subOpen}2${end}`), ';5#B');
check('superscript sign is ";9#B" (as in liblouis x²)',
  translate(`${supOpen}2${end}`), rawG2('x²').slice(1));

// 5. Adjacent same-alignment runs share one indicator (H<sub>2</sub> ... one pair per run-group).
const h2 = await parseDocx(docx(run('H') + run('2', 'subscript') + run('0', 'subscript') + run('O')));
check('adjacent subscript runs share one marker pair',
  h2.blocks[0]?.text, `H${subOpen}20${end}O`);

// 6. A paragraph with no vertAlign runs yields plain concatenated text with no
//    markers (ordinary docx parsing is unchanged; runs join in document order).
const plainDoc = await parseDocx(docx(run('The ') + run('Great ') + run('Barrier Reef')));
check('plain multi-run paragraph has no markers',
  plainDoc.blocks[0]?.text, 'The Great Barrier Reef');

// 7. No markers -> byte-identical to a plain translate (marker-free docs unaffected).
const plain = 'The report says that the Great Barrier Reef can recover.';
check('marker-free text unchanged vs raw translate', translate(plain), rawG2(plain));

console.log(`\ndocx sub/superscript: ${pass}/${pass + fail} checks pass`);
process.exit(fail === 0 ? 0 : 1);
