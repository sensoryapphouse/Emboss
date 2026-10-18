// Batch S5c, item S3B-Q2 (Paul, 15 Oct 2026): an eBraille file records the exact braille table it was made with.
// Translate's writer already writes `sah:brailleCode` (TR-03) when the package spec carries a `brailleCode`; Emboss's adapter
// (format/ebraille.mjs) now passes it on. The value is the braille code id of the table list in force
// (web/braille-table.mjs settingsForTable(table).brailleCode), the same value Translate's reader adopts on opening; that id names
// exactly one liblouis table list (Translate/braille-codes.mjs), which this test checks for each code.
// The registry value a11y:brailleSystem stays as S3b #17 made it.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { exportToEbraille } from '../format/ebraille.mjs';
import { UEB_TABLES, settingsForTable, registryName } from '../web/braille-table.mjs';
import { CODES } from '../../Translate/braille-codes.mjs';
import { unzip } from '../../Translate/unmxl.mjs';
import { readEbraille } from '../../Translate/ebraille.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const doc = { title: 'T', blocks: [{ type: 'paragraph', text: 'Hello world.' }] };
const dec = new TextDecoder();
async function opfOf(bytes) {
  const files = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return dec.decode(files.get('package.opf'));
}
// what the two app call sites pass (web/app.mjs, web/editor/editor.mjs): the code of the table the translator ran with
const optsFor = (table) => ({
  mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: (s) => String(s).toUpperCase(), language: 'en-GB',
  brailleSystem: registryName(settingsForTable(table)), brailleCode: settingsForTable(table).brailleCode,
});
const codeMeta = (opf) => [...opf.matchAll(/<meta property="sah:brailleCode">([^<]*)<\/meta>/g)].map((m) => m[1]);

describe('S3B-Q2 sah:brailleCode in the package', () => {
  for (const [label, table, id, system] of [
    ['UEB grade 2', UEB_TABLES.g2, 'en-ueb-g2', 'ueb grade2'],
    ['UEB grade 1', UEB_TABLES.g1, 'en-ueb-g1', 'ueb grade1'],
    ['a non-UEB code (French, uncontracted)', CODES.find((c) => c.id === 'fr-bfu-comp6').table, 'fr-bfu-comp6', 'fr-bfu-comp6'],
  ]) {
    test(`${label}: the OPF carries sah:brailleCode ${id}, once, beside the unchanged a11y:brailleSystem`, async () => {
      const opf = await opfOf(exportToEbraille(doc, optsFor(table)));
      assert.deepEqual(codeMeta(opf), [id]);
      assert.match(opf, new RegExp(`<meta property="a11y:brailleSystem">${system}</meta>`));
      assert.match(opf, /prefix="[^"]*\bsah: https:\/\/sensoryapphouse\.com\/ns\/braille#/);   // the sah: prefix is declared
    });
    test(`${label}: the code id names exactly the table list in force`, () => {
      const known = CODES.find((c) => c.id === id);
      const table2 = id === 'en-ueb-g2' ? UEB_TABLES.g2 : id === 'en-ueb-g1' ? UEB_TABLES.g1 : known.table;
      assert.equal(settingsForTable(table2).brailleCode, id);
      assert.equal(table, table2);
    });
    test(`${label}: Translate's reader finds the same code in the file`, async () => {
      const bytes = exportToEbraille(doc, optsFor(table));
      const r = await readEbraille(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      assert.equal(r.brailleCode ?? (r.meta && r.meta.brailleCode), id);
    });
  }
  test('no code named: no sah:brailleCode is written (the property is never invented)', async () => {
    const o = optsFor(UEB_TABLES.g2); delete o.brailleCode;
    assert.deepEqual(codeMeta(await opfOf(exportToEbraille(doc, o))), []);
  });
});
