// Import fix list #41 (found re-running the audit, 1 Oct 2026): every ODT bullet came in as "•", whatever the list style's
// text:bullet-char was. The Word reader keeps the print bullet (Paul's IMP-W7: a custom bullet — arrow, tick, dash — keeps
// its shape, and BANA brailles it as a transcriber-defined symbol listed on the Special Symbols page), so the same Word
// document saved as .odt by LibreOffice must give the same markers as the .docx: the Symbol-font dot "•", Courier New "o"
// "○", Wingdings U+F0A7 "■", and the literal ➢ ✓ – of a custom list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseOdt, parseDocx } from '../input/parse.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const bytes = (f) => { const b = fs.readFileSync(path.join(HERE, 'fixtures', 'import-audit', f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const markers = (model) => {
  const out = {};
  const walk = (items, lvl) => { for (const it of items || []) { const t = String(it.text ?? (it.segments || []).map((s) => s.text || '').join('')).trim(); if (/^alpha(bullet|custom)\d$/.test(t)) out[t] = it.marker; walk(it.children, lvl + 1); walk(it.items, lvl + 1); } };
  for (const b of model.blocks) if (b.type === 'list') walk(b.items, 0);
  return out;
};

test('#41: a LibreOffice .odt keeps the bullet glyphs of its list styles, the same markers as the Word original', async () => {
  const odt = markers(await parseOdt(bytes('odt/lo-w08-lists.odt')));
  const docx = markers(await parseDocx(bytes('docx/w08-lists.docx')));
  assert.equal(odt.alphabullet1, '•');
  // Changed 17 Oct 2026 (APH feedback point 15, Paul: 15a): Word's default nested bullets - Courier "o" at level 2, Wingdings' square at level 3 - are the ordinary bullet at those levels (were the hollow circle and the solid square).
  assert.equal(odt.alphabullet2, '•');          // Courier New "o", at level 2
  assert.equal(odt.alphabullet3, '•');          // Wingdings U+F0A7, at level 3
  assert.equal(odt.alphacustom1, '➢');
  assert.equal(odt.alphacustom2, '✓');
  assert.equal(odt.alphacustom3, '–');
  for (const k of Object.keys(docx)) assert.equal(odt[k], docx[k], `${k}: .odt ${odt[k]} vs .docx ${docx[k]}`);
});
