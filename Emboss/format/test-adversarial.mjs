// Adversarial / lateral testing: throw varied and pathological documents at the
// full formatter (real liblouis) and assert invariants — no crash, line width,
// valid BRF bytes, determinism. Surfaces layout bugs the gold corpus can't.
import path from 'path'; import { fileURLToPath } from 'url';
import * as louis from '../engine/louis.mjs';
import { formatDocument } from './document.mjs';
import { styledTranslate } from './text-style.mjs';
import { BRF64 } from '../engine/brf-ascii.mjs';

import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;
const BRF_SET = new Set((BRF64 + '\r\n\x0c').split(''));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`); }
};

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  const translate = styledTranslate((t, tf) => louis.translate(t, T, tf), 'faithful');

  // battery of documents
  const longWord = 'x'.repeat(120);
  const nested = (lvl) => Array.from({ length: 3 }, (_, i) => ({ text: `item ${lvl}.${i}`, level: lvl }));
  const cases = {
    empty: { blocks: [] },
    nullBlocks: { blocks: [null, undefined, {}, { type: 'para' }] },
    whitespacePara: { blocks: [{ type: 'para', text: '     \t   ' }] },
    singleLongWord: { blocks: [{ type: 'para', text: longWord }] },
    longWordInText: { blocks: [{ type: 'para', text: 'see ' + longWord + ' here' }] },
    hugeHeading: { blocks: [{ type: 'heading', level: 1, text: 'This Is An Extremely Long Heading That Certainly Exceeds The Braille Page Width And Must Wrap And Centre On Multiple Lines Correctly' }] },
    deepList: { blocks: [{ type: 'list', items: [...nested(0), ...nested(1), ...nested(2), ...nested(3), ...nested(4)] }] },
    manyHeadings: { blocks: Array.from({ length: 40 }, (_, i) => [{ type: 'heading', level: (i % 3) + 1, text: `Heading ${i + 1}` }, { type: 'para', text: `Body text under heading ${i + 1}. `.repeat(3) }]).flat() },
    specialChars: { blocks: [{ type: 'para', text: 'Café — “quotes”, ½ + ¾, 100% ≈ £5.50, e.g. #hashtag & <tags> © 2026.' }] },
    numbersHeavy: { blocks: [{ type: 'para', text: '1234567890 '.repeat(20) }] },
    allCaps: { blocks: [{ type: 'para', text: 'SHOUTING '.repeat(30) }] },
    emphasisSegments: { blocks: [{ type: 'para', segments: [
      { type: 'text', text: 'plain ' }, { type: 'text', text: 'bold', tf: louis.TYPEFORM.bold },
      { type: 'text', text: ' and ' }, { type: 'text', text: 'italic', tf: louis.TYPEFORM.italic }, { type: 'text', text: '.' },
    ] }] },
    mixedModeBana: { blocks: [{ type: 'heading', level: 1, text: 'Chapter' }, { type: 'para', text: 'Some body text here.' }] },
    emptyStringsEverywhere: { blocks: [{ type: 'heading', level: 2, text: '' }, { type: 'para', text: '' }, { type: 'list', items: [{ text: '' }, { text: 'ok' }] }] },
    // negative / absurd levels must not crash (bad ODT outline-level etc.)
    negativeLevels: { blocks: [{ type: 'heading', level: -1, text: 'Neg heading' }, { type: 'list', items: [{ text: 'a', level: -2 }, { text: 'b', level: 99 }] }, { type: 'para', text: 'after' }] },
    // an over-long document title must not corrupt the running-head page number
    longTitle: { title: 'An Unusually Long Book Title That Certainly Exceeds The Braille Page Width', blocks: Array.from({ length: 40 }, (_, i) => ({ type: 'para', text: `Body paragraph ${i + 1}.` })) },
  };

  for (const [name, doc] of Object.entries(cases)) {
    for (const mode of ['ukaaf', 'bana']) {
      for (const toc of [false, true]) {
        const opts = { mode, width: mode === 'bana' ? 40 : 38, depth: 25, listStyle: 'spaced', toc, translate };
        let brf, threw = null;
        try { brf = formatDocument(doc, opts); } catch (e) { threw = e; }
        const tag = `${name}/${mode}${toc ? '+toc' : ''}`;
        check(`no crash: ${tag}`, threw === null, threw && threw.message);
        if (threw) continue;

        // determinism
        const brf2 = formatDocument(doc, opts);
        check(`deterministic: ${tag}`, brf === brf2);

        // per-page line checks
        for (const page of brf.split('\x0c')) {
          const lines = page.split('\r\n');
          for (const line of lines) {
            // valid BRF bytes only
            const bad = [...line].find((c) => !BRF_SET.has(c));
            check(`valid BRF chars: ${tag}`, bad === undefined, bad && `char ${JSON.stringify(bad)} in ${JSON.stringify(line.slice(0, 30))}`);
            // no trailing whitespace (toBRF right-strips)
            check(`no trailing space: ${tag}`, line === line.replace(/\s+$/, ''), JSON.stringify(line.slice(-8)));
            // width: line <= width, UNLESS it is a single unbreakable word (known, correct)
            const trimmed = line.replace(/^ +/, '');
            const singleWord = !trimmed.includes(' ');
            check(`line within width: ${tag}`, line.length <= opts.width || singleWord, `len ${line.length} > ${opts.width}: ${JSON.stringify(line)}`);
          }
        }
      }
    }
  }

  console.log(`\nadversarial gate: ${pass}/${pass + fail} invariant checks pass across ${Object.keys(cases).length} docs × 2 modes × 2 toc`);
  process.exit(fail ? 1 : 0);
})();
