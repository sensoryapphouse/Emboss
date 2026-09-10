// docx-path gold test: run the generated corpus/docx/*.docx through the REAL
// pipeline (parseDocx -> formatDocument) and require the result to match the
// gold-validated corpus model formatted the same way. Because the model-path is
// gold-validated (format/test-corpus.mjs + the QA review), docx == model proves
// the docx PARSER faithfully recovers the structure => the docx path is gold-
// validated by transitivity.
//
// parseDocx uses browser DOM APIs; we shim DOMParser with @xmldom/xmldom (Node
// already provides DecompressionStream/Blob/Response).
import { DOMParser } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from '../input/parse.mjs';
import { formatDocument } from './document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

const SAMPLES = ['sample1', 'sample2', 'sample3', 'sample4', 'sample5', 'sample6', 'sample7', 'sample7a', 'sample8'];
const geom = (s) => (s === 'sample7a' ? { width: 38, depth: 27 } : { width: 38, depth: 25 });

const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const translate = (t) => louis.translate(t, louis.TABLES.uebG2);

  let pass = 0, total = 0;
  for (const s of SAMPLES) {
    total++;
    const mod = await import(`./corpus-models/${s}.mjs`);
    const model = Object.values(mod).find((v) => typeof v === 'function')();
    const docxDoc = await parseFile(`${s}.docx`, toAB(fs.readFileSync(path.join(projectRoot, 'corpus', 'docx', `${s}.docx`))));
    const { width, depth } = geom(s);
    const opts = { mode: 'ukaaf', width, depth, translate };
    const brfModel = formatDocument(model, opts);
    const brfDocx = formatDocument(docxDoc, opts);

    // Blocks that cannot survive a docx round-trip via the current pipeline:
    //  - 'math': the docx generator can't reverse MathML -> Word OMML;
    //  - 'indicator'/'blank': formatter artifacts; a print '* * *' break is not
    //    recovered as a centred indicator by parseDocx (it would read as text).
    const NON_ROUNDTRIP = new Set(['math', 'indicator', 'blank']);
    const omitted = model.blocks.some((b) => NON_ROUNDTRIP.has(b.type));
    if (brfModel === brfDocx) {
      pass++;
      console.log(`✅ ${s.padEnd(9)} docx path == gold-validated model (identical BRF)`);
    } else if (omitted) {
      const stripped = { ...model, blocks: model.blocks.filter((b) => !NON_ROUNDTRIP.has(b.type)) };
      const ok = formatDocument(stripped, opts) === brfDocx;
      if (ok) { pass++; console.log(`✅ ${s.padEnd(9)} docx path == model (equation/indicator omitted from docx, as expected)`); }
      else { console.log(`❌ ${s.padEnd(9)} differs beyond the non-round-trippable blocks`); }
    } else {
      console.log(`❌ ${s.padEnd(9)} docx path != model — parser did not recover the structure`);
      const a = brfModel.split('\r\n'), b = brfDocx.split('\r\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { console.log(`   first diff line ${i + 1}:\n     model: ${JSON.stringify(a[i])}\n     docx : ${JSON.stringify(b[i])}`); break; }
      }
    }
  }
  console.log(`\ndocx-path gold test: ${pass}/${total} samples reproduce the gold-validated model via the real docx parser`);
  process.exit(pass === total ? 0 : 1);
})();
