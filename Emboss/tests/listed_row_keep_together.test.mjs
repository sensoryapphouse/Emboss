// BANA Formats §11.16j: "Place all columns in the row on the same braille page whenever
// possible." A listed-table row that would run past the page starts the next page (A27b3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const table = {
  type: 'table', format: 'listed',
  headers: ['Substance', 'Formula', 'Molar mass', 'Melting point'],
  rows: [['Sodium chloride', 'NaCl', '58.44', '801'], ['Sucrose', 'C12H22O11', '342.30', '186'], ['Ethanol', 'C2H5OH', '46.07', '-114']],
};
const pages = (brf) => brf.replace(/\r/g, '').split('\f').map((p) => p.split('\n'));

for (const mode of ['bana', 'ukaaf']) {
  test(`${mode}: no listed row is split across braille pages`, () => {
    for (let lead = 0; lead < 14; lead++) {
      const blocks = [...Array.from({ length: lead }, (_, i) => ({ type: 'para', text: `Filler paragraph ${i}.` })), table];
      const ps = pages(formatDocument({ blocks }, { mode, width: 40, depth: 25, translate: up }));
      for (const row of ['SUCROSE', 'ETHANOL', 'SODIUM CHLORIDE']) {
        const where = ps.map((p) => p.some((l) => l.includes(`SUBSTANCE: ${row}`)));
        const pi = where.indexOf(true);
        assert.ok(pi >= 0, `${row} heading found (lead ${lead})`);
        const text = ps[pi].join('\n');
        assert.ok(text.includes('MELTING POINT:') && text.indexOf('MELTING POINT:', text.indexOf(`SUBSTANCE: ${row}`)) > 0,
          `${mode}, ${lead} paragraphs before: the ${row} row ends on the page it starts on`);
      }
    }
  });
}
