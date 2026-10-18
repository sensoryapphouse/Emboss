// Ordinary letters typed in a Symbol or Wingdings run of a Word .docx (Format > Font on typed "ab"): print shows that font's
// shapes — Symbol "ab" is αβ, as the .doc reader now reads it (D15, doc_import_30sep.test.mjs). The .docx reader converted only
// the private-use form (U+F061) that Insert > Symbol writes, so the same text typed and re-fonted stayed "ab" (found by the .doc
// agent, 1 Oct 2026). Only the run's ASCII font (w:rFonts w:ascii) counts, only Symbol and Wingdings, never spaces or digits'
// shape changes other than the font's own (Symbol keeps digits).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDocx } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text, font) => `<w:r>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const docx = async (paras) => makeZip([{ name: 'word/document.xml', text: `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paras.map((p) => `<w:p>${p}</w:p>`).join('')}</w:body></w:document>` }]).arrayBuffer();
const flat = (b) => b.text ?? (b.segments || []).map((s) => s.text || '').join('');

test('ordinary letters in a Symbol run are Greek (ab = αβ, ABC = ΑΒΧ); digits and spaces stay; another font is left alone', async () => {
  const m = await parseDocx(await docx([run('Greek: ') + run('ab', 'Symbol') + run(' and ') + run('ABC 12', 'Symbol') + run(' but ') + run('ab', 'Arial')]));
  assert.equal(flat(m.blocks[0]), 'Greek: αβ and ΑΒΧ 12 but ab');
  assert.equal(m.warnings, undefined);
});

test('ordinary characters in a Wingdings run are shapes; an unmapped one is U+FFFD and named in the load warning', async () => {
  const m = await parseDocx(await docx([run('x ') + run('l ', 'Wingdings') + run('y')]));
  assert.equal(flat(m.blocks[0]), 'x � y');
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /1 symbol typed in a symbol font \(Wingdings F06C\)/);
});

test('the private-use form (Insert > Symbol) is read as before', async () => {
  const m = await parseDocx(await docx([run('', 'Symbol')]));
  assert.equal(flat(m.blocks[0]), 'αβ');
});
