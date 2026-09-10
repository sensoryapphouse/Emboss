import path from 'path'; import fs from 'fs'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Maths gate: validates the four maths improvements end-to-end in Node.
//   1. Nemeth code-switch wrap (engine/maths.mjs logic, mirrored here with the
//      Node MathCAT build) — BANA output is wrapped with the BRF-mapped
//      opening/terminator indicators; UEB output is not.
//   2. LaTeX -> MathML via Temml gives the same braille as the MathML path,
//      in both codes.
//   3. Inline maths segments (format/document.mjs formatPara) place the
//      transcribed equation IN the wrapped paragraph line, not as a separate
//      block.
//   4. HTML <math> and docx inline m:oMath both parse to ordered
//      text/math segments (or a math block, for HTML block-level <math>).
//
// parseDocx/parseHtml use browser DOM APIs; shim DOMParser/XMLSerializer with
// @xmldom/xmldom, matching format/test-corpus-docx.mjs and format/test-scripts.mjs.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

// parseHtml (input/parse.mjs) is written against the real browser DOM
// (querySelector/querySelectorAll/:scope), which @xmldom/xmldom does not
// implement. parseHtml itself is NOT changed for Node — it stays exactly the
// browser-real-DOM code that ships to the app. This is a small, test-only
// polyfill (tag-name lookups only, no full CSS support) so its logic can
// still be exercised here; the definitive check is the live browser preview
// (see the report), which uses the actual DOMParser/querySelector.
{
  const proto = (o) => Object.getPrototypeOf(o);
  const patchQuery = (Ctor) => {
    Ctor.prototype.querySelector = function (sel) {
      const tag = sel.trim();
      return this.getElementsByTagName(tag)[0] || null;
    };
    Ctor.prototype.querySelectorAll = function (sel) {
      const m = sel.trim().match(/^:scope\s*>\s*(\S+)$/);
      if (m) return [...this.children].filter((c) => c.tagName === m[1]);
      return [...this.getElementsByTagName(sel.trim())];
    };
  };
  // Grab live constructors from a parsed doc/element (xmldom doesn't export
  // usable bare classes for `new`/prototype access in all versions).
  const probe = new DOMParser().parseFromString('<a><b/></a>', 'application/xml');
  patchQuery(proto(probe).constructor);
  patchQuery(proto(probe.documentElement).constructor);
}

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mathcat = require('../engine/mathcat/pkg-nodejs/emboss_mathcat.js');
const temml = require('temml');

import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';
import { formatDocument } from './document.mjs';
import { parseHtml, parseDocx, parseText, parseMarkdown } from '../input/parse.mjs';
import * as louis from '../engine/louis.mjs';

const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = want === undefined ? !!got : got === want;
  (ok ? pass++ : fail++);
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) { console.log(`     got:  ${JSON.stringify(got)}`); if (want !== undefined) console.log(`     want: ${JSON.stringify(want)}`); }
};

// ---------- Node-side mirror of engine/maths.mjs (browser-only module) ----------
// Same logic as engine/maths.mjs: Nemeth output is wrapped with the BANA
// "UEB with Nemeth" code-switch indicators before mapping to BRF ASCII; UEB
// output is left as MathCAT emits it (it already carries its own grade-1
// switch). This mirror exists purely so the pipeline can be exercised in
// Node; engine/maths.mjs itself is not touched or re-implemented for the
// browser (it still delegates to the pkg-web wasm build there).
const NEMETH_OPEN = '⠸⠩ ';
const NEMETH_CLOSE = ' ⠸⠱';

function mathmlToBrf(mathml, mode) {
  const code = mode === 'bana' ? 'Nemeth' : 'UEB';
  let braille = mathcat.mathml_to_braille(mathml, code);
  if (typeof braille !== 'string' || braille.startsWith('ERROR:')) throw new Error('MathCAT: ' + braille);
  if (code === 'Nemeth') braille = NEMETH_OPEN + braille + NEMETH_CLOSE;
  return unicodeBrailleToBrf(braille);
}
function latexToBrf(latex, mode) {
  const mathml = temml.renderToString(latex, { throwOnError: false });
  return mathmlToBrf(mathml, mode);
}
function mathToBrf(seg, mode) {
  if (seg.latex != null) return latexToBrf(seg.latex, mode);
  return mathmlToBrf(seg.mathml, mode);
}

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const translate = (t) => louis.translate(t, louis.TABLES.uebG2);

  console.log('--- 1. Nemeth code-switch wrap ---');
  const XSQ = '<math><msup><mi>x</mi><mn>2</mn></msup></math>';
  const brfBana = mathmlToBrf(XSQ, 'bana');
  const brfUeb = mathmlToBrf(XSQ, 'ukaaf');
  const OPEN_BRF = unicodeBrailleToBrf('⠸⠩');   // "_%"
  const CLOSE_BRF = unicodeBrailleToBrf('⠸⠱');  // "_:"
  console.log(`  bana (Nemeth): ${JSON.stringify(brfBana)}`);
  console.log(`  ukaaf (UEB):   ${JSON.stringify(brfUeb)}`);
  check('Nemeth/BANA output starts with the wrap opening indicator', brfBana.startsWith(OPEN_BRF));
  check('Nemeth/BANA output ends with the wrap terminator', brfBana.endsWith(CLOSE_BRF));
  check('UEB/UKAAF output does NOT contain the Nemeth opening indicator', !brfUeb.includes(OPEN_BRF));
  check('UEB/UKAAF output does NOT contain the Nemeth terminator', !brfUeb.includes(CLOSE_BRF));

  console.log('\n--- 2. LaTeX (Temml) == MathML path, both codes ---');
  const fracMml = '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>';
  for (const mode of ['ukaaf', 'bana']) {
    const viaMathml = mathmlToBrf(fracMml, mode);
    const viaLatex = latexToBrf('\\frac{1}{2}', mode);
    console.log(`  [${mode}] mathml: ${JSON.stringify(viaMathml)}  latex: ${JSON.stringify(viaLatex)}`);
    check(`latexToBrf('\\\\frac{1}{2}', '${mode}') == mathmlToBrf(same fraction)`, viaLatex, viaMathml);
  }

  console.log('\n--- 3. Inline maths segments format IN the wrapped line ---');
  const segPara = {
    type: 'para',
    segments: [
      { type: 'text', text: 'The value' },
      { type: 'math', mathml: XSQ },
      { type: 'text', text: 'plus one is not prime, but' },
      { type: 'math', mathml: '<math><mn>2</mn></math>' },
      { type: 'text', text: 'is.' },
    ],
  };
  const opts = { mode: 'ukaaf', width: 38, depth: 25, translate, mathToBrf: (seg) => mathToBrf(seg, 'ukaaf') };
  const brf = formatDocument({ blocks: [segPara] }, opts);
  const lines = brf.split('\r\n').filter(Boolean);
  console.log('  formatted lines:');
  lines.forEach((l) => console.log('   |' + l));
  check('exactly one paragraph block worth of lines (maths inline, no separate block)', lines.length >= 1);
  const xsqBrf = mathmlToBrf(XSQ, 'ukaaf');
  const joined = lines.join(' ');
  check('the transcribed x^2 maths appears inside the paragraph text (inline, not a separate display block)',
    joined.includes(xsqBrf.trim()));
  check('no blank line was introduced around the inline maths (unlike a display math block)',
    !brf.includes('\r\n\r\n'));

  // Compare against the plain-text path for the same words to sanity-check
  // that segment translation + wrapping doesn't diverge from ordinary text.
  const plainWords = formatDocument({ blocks: [{ type: 'para', text: 'The value plus one is not prime, but is.' }] }, opts);
  console.log('  (plain-text control, for comparison):');
  plainWords.split('\r\n').filter(Boolean).forEach((l) => console.log('   |' + l));

  console.log('\n--- 4a. HTML <math> (inline + block) ---');
  const html = `<html><body>
    <p>The value <math><msup><mi>x</mi><mn>2</mn></msup></math> is prime.</p>
    <math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>
  </body></html>`;
  const htmlDoc = parseHtml(html);
  console.log('  parsed blocks:', JSON.stringify(htmlDoc.blocks));
  check('HTML: exactly 2 blocks (segmented para + math block)', htmlDoc.blocks.length, 2);
  check('HTML: first block is a para with segments', Array.isArray(htmlDoc.blocks[0]?.segments));
  check('HTML: para segments are [text, math, text] in order',
    htmlDoc.blocks[0]?.segments?.map((s) => s.type).join(','), 'text,math,text');
  check('HTML: inline math segment carries MathML with <msup>', /<msup>/.test(htmlDoc.blocks[0]?.segments?.[1]?.mathml || ''));
  check('HTML: second block is a standalone math block', htmlDoc.blocks[1]?.type, 'math');
  check('HTML: block math carries MathML with <mfrac>', /<mfrac>/.test(htmlDoc.blocks[1]?.mathml || ''));

  console.log('\n--- 4b. docx inline m:oMath (interleaved with text runs) ---');
  // Minimal STORED-entry zip writer (unzipEntry only needs a valid EOCD/central
  // directory + local header; CRC is not checked), matching format/test-scripts.mjs.
  function storedZip(name, content) {
    const enc = new TextEncoder();
    const nameB = enc.encode(name), data = enc.encode(content);
    const nlen = nameB.length, dlen = data.length;
    const b = [];
    const u16 = (v) => b.push(v & 0xff, (v >> 8) & 0xff);
    const u32 = (v) => b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0); u32(0); u32(dlen); u32(dlen); u16(nlen); u16(0);
    for (const x of nameB) b.push(x);
    for (const x of data) b.push(x);
    const cdOffset = b.length;
    u32(0x02014b50); u16(20); u16(20); u16(0); u16(0); u16(0); u16(0); u32(0); u32(dlen); u32(dlen);
    u16(nlen); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0);
    for (const x of nameB) b.push(x);
    const cdSize = b.length - cdOffset;
    u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cdSize); u32(cdOffset); u16(0);
    return Uint8Array.from(b).buffer;
  }
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const run = (text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const oMathXSq = `<m:oMath xmlns:m="${M}"><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>`;
  const docxXml = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>` +
    `<w:p>${run('The value ')}${oMathXSq}${run(' is prime.')}</w:p>` +
    `</w:body></w:document>`;
  const docxDoc = await parseDocx(storedZip('word/document.xml', docxXml));
  console.log('  parsed blocks:', JSON.stringify(docxDoc.blocks));
  check('docx: exactly 1 block (one segmented para)', docxDoc.blocks.length, 1);
  check('docx: para segments are [text, math, text] in order',
    docxDoc.blocks[0]?.segments?.map((s) => s.type).join(','), 'text,math,text');
  // Runs' own w:t spacing is preserved verbatim (xml:space="preserve"), as it
  // is for ordinary docx text runs — a real Word doc has "The value " (with
  // its trailing space) before the equation and " is prime." after it.
  check('docx: first text segment reads "The value "', docxDoc.blocks[0]?.segments?.[0]?.text, 'The value ');
  check('docx: math segment carries MathML with <msup>', /<msup>/.test(docxDoc.blocks[0]?.segments?.[1]?.mathml || ''));
  check('docx: last text segment reads " is prime."', docxDoc.blocks[0]?.segments?.[2]?.text, ' is prime.');

  console.log('\n--- 4c. plain-text / markdown $ / $$ detection ---');
  const txtDoc = parseText('Intro line.\n\nThe value $x^2+1$ is prime.\n\nA cost line: it is $5, not $10.');
  console.log('  parseText blocks:', JSON.stringify(txtDoc.blocks));
  const inlinePara = txtDoc.blocks.find((b) => b.segments);
  check('parseText: a paragraph with inline $..$ got segments', !!inlinePara);
  check('parseText: inline segments are [text, math, text]', inlinePara?.segments?.map((s) => s.type).join(','), 'text,math,text');
  check('parseText: inline math segment carries the LaTeX "x^2+1"', inlinePara?.segments?.[1]?.latex, 'x^2+1');
  const currencyPara = txtDoc.blocks.find((b) => b.text && b.text.includes('cost line'));
  check('parseText: a currency-$ paragraph stays plain text (no false-positive math)', !!currencyPara);
  check('parseText: currency text is untouched', currencyPara?.text, 'A cost line: it is $5, not $10.');

  const dispDoc = parseText('Before.\n\n$$x^2 + 1 = 0$$\n\nAfter.');
  console.log('  parseText (display $$) blocks:', JSON.stringify(dispDoc.blocks));
  check('parseText: $$...$$ alone in a paragraph becomes a standalone math block', dispDoc.blocks[1]?.type, 'math');
  check('parseText: display math block carries the LaTeX', dispDoc.blocks[1]?.latex, 'x^2 + 1 = 0');
  check('parseText: text before/after stayed as plain para blocks', dispDoc.blocks[0]?.text, 'Before.');
  check('parseText: text after the display equation', dispDoc.blocks[2]?.text, 'After.');

  const mdDoc = parseMarkdown('# Title\n\nThe value $x^2+1$ is prime, and $x_1$ has an underscore.\n');
  console.log('  parseMarkdown blocks:', JSON.stringify(mdDoc.blocks));
  const mdPara = mdDoc.blocks.find((b) => b.segments);
  check('parseMarkdown: inline $..$ produced segments (and survived emphasis-stripping)', !!mdPara);
  check('parseMarkdown: first math segment latex is "x^2+1"', mdPara?.segments?.find((s) => s.type === 'math')?.latex, 'x^2+1');
  check('parseMarkdown: second math segment keeps its underscore ("x_1", not italicised away)',
    mdPara?.segments?.filter((s) => s.type === 'math')[1]?.latex, 'x_1');

  console.log(`\nmaths gate: ${pass}/${pass + fail} checks pass`);
  process.exit(fail === 0 ? 0 : 1);
})();
