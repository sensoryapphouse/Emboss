// Import fix list #50 (1 Oct 2026), the Word and .doc side: a paragraph in a poem / verse style keeps its Shift+Enter lines as verse
// lines (IMP-W2). Untagged, they were saved as <p class="bai-verse">, which the DTBook reader reads back as verse drama (D5), so the
// BANA braille changed on reopening (a runover line moved from cell 3 to cell 5). They are poetry, so they are tagged fromPoem, as
// the DTBook reader's <poem> lines and the HTML reader's <p class="poem"> lines are, and a save writes a <poem>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseDocx } from '../input/parse.mjs';
import { parseDoc } from '../input/doc.mjs';
import { makeZip } from '../web/zip.mjs';
import { upperOptions, brailleLines, saveAndReopen, firstDifference } from './helpers/nimas-braille.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const { writeDoc } = await import('./helpers/doc-writer.mjs');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LONG = 'A first line of the poem that is quite long and will wrap round';
const r = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

async function wordPoem() {
  const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Poem"><w:name w:val="Poem"/></w:style></w:styles>`;
  const p = `<w:p><w:pPr><w:pStyle w:val="Poem"/></w:pPr>${r(LONG)}<w:r><w:br/></w:r>${r('the second line')}<w:r><w:br/></w:r><w:r><w:br/></w:r>${r('a second stanza')}</w:p>`;
  const doc = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p>${r('Before.')}</w:p>${p}<w:p>${r('After.')}</w:p></w:body></w:document>`;
  return parseDocx(await makeZip([{ name: 'word/document.xml', text: doc }, { name: 'word/styles.xml', text: styles }]).arrayBuffer());
}
const docPoem = async () => parseDoc(writeDoc({ styles: [{ name: 'Poem', type: 'para', basedOn: 'Normal' }],
  body: [{ p: 'Before.' }, { p: [LONG, { br: true }, 'the second line'], style: 'Poem' }, { p: 'After.' }] }));

for (const [name, read] of [['.docx', wordPoem], ['.doc', docPoem]]) {
  test(`#50 ${name}: a poem-style paragraph's lines are poem lines, saved as a <poem>, and reopen to the same braille`, async () => {
    const m = await read();
    const verse = m.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.ok(verse.length >= 2 && verse.every((b) => b.fromPoem === true), JSON.stringify(m.blocks));
    const { xml, back } = await saveAndReopen(m);
    assert.match(xml, /<poem>[\s\S]*<line>A first line of the poem/);
    assert.doesNotMatch(xml, /bai-verse/);
    for (const mode of ['bana', 'ukaaf']) {
      const d = firstDifference(brailleLines(m, upperOptions(mode)), brailleLines(back, upperOptions(mode)));
      assert.equal(d, null, `${mode}: ${d}`);
    }
  });
}
