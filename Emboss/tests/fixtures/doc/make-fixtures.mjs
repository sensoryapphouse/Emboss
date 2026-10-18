// Regenerates the synthetic .doc fixtures (and their .docx twins) in this folder:
//   node Emboss/tests/fixtures/doc/make-fixtures.mjs
// The cocoa-*.doc files are NOT made here: they were written by macOS's own Word writer
// (`textutil -convert doc`, from cocoa-*.html / Emboss's test-fixtures/sample.docx) and are
// kept as an independent, real-writer check on the reader.
import { writeFileSync } from 'node:fs';
import { writeDoc, writeDocx } from '../../helpers/doc-writer.mjs';
import { basics, objects, extras, tables, numbering, tiny } from './specs.mjs';

const here = new URL('./', import.meta.url);
const out = (name, bytes) => writeFileSync(new URL(name, here), bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

out('basics.doc', writeDoc(basics));
out('basics.docx', await writeDocx(basics));
out('objects.doc', writeDoc(objects));
out('objects.docx', await writeDocx(objects));
out('extras.doc', writeDoc(extras));
out('tables.doc', writeDoc(tables));
out('tables.docx', await writeDocx(tables));
out('numbering.doc', writeDoc(numbering));
out('numbering.docx', await writeDocx(numbering));
out('basics-8bit.doc', writeDoc(basics, { compressed: true }));                        // cp1252 "compressed" piece
out('basics-pieces.doc', writeDoc(basics, { splitAt: 97 }));                           // two pieces, stored out of order
out('basics-prm.doc', writeDoc(basics, { splitAt: 97, secondPiecePrm: true }));        // second piece carries a Prm (bold)
out('objects-txid.doc', writeDoc(objects, { textboxLidZero: true }));                   // text box found through lTxid
out('word6.doc', writeDoc(tiny, { nFib: 101 }));
out('encrypted.doc', writeDoc(tiny, { encrypted: true }));
console.log('fixtures written to', here.pathname);
