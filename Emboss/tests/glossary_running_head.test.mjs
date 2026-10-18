// K34 (EMBOSS-TASKS.md, found by K32): a print page's REPEATED RUNNING HEAD ("Glossary of
// Literary and Informational Terms") sometimes rides along with a page turn INSIDE a DTBook
// <dl> glossary entry's own <dd> — not at the end of an entry the way K32 found for an index
// <li>, but in the MIDDLE of the definition, with the definition's own words continuing right
// after it. Fixture below copies the anthology's own shape verbatim (9780544087507NIMAS.xml,
// entry "Biography", page turn pR65):
//   <dt><strong>Biography</strong></dt> <dd>A biography is the true account of a person's
//   life, written by another person.<pagenum id="pR65"/><br/><strong><em>Glossary of Literary
//   and Informational Terms</em></strong><br/>As such, biographies are usually told from a
//   third-person point of view. ...</dd>
// Before this fix, parseDefinitionList's hoistPagenums/segsWithoutPagenums only ever pulled the
// <pagenum> itself out of the run; the running head's own bold+italic words stayed in `rest`
// and were spliced straight into the middle of the definition's own prose ("...written by
// another person. Glossary of Literary and Informational Terms As such, biographies...").
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';

globalThis.DOMParser = DOMParser;

const DTBOOK_NS = 'http://www.daisy.org/z3986/2005/dtbook/';
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<dtbook xmlns="${DTBOOK_NS}" version="2005-3"><head><meta name="dtb:uid" content="t"/></head><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`;

test('a running head riding a page turn in the MIDDLE of a <dd> is not spliced into the definition, but the definition continues after it (anthology "Biography", page R65)', () => {
  const xml = wrap(`
    <h1>Glossary of Literary and Informational Terms</h1>
    <dl>
      <dt><strong>Bias</strong></dt> <dd>In a piece of writing, the author's bias is the side of an issue that he or she favors.</dd>
      <dt><strong>Biography</strong></dt> <dd>A biography is the true account of a person's life, written by another person.
      <pagenum id="pR65" page="special">R65</pagenum><br/><strong><em>Glossary of Literary and Informational Terms</em></strong><br/>As such, biographies are usually told from a third-person point of view. The writer of a biography usually researches his or her subject in order to present accurate information.</dd>
      <dt><strong>Bibliography</strong></dt> <dd>A bibliography is a list of related books and other materials used to write a text.</dd>
    </dl>
  `);
  const d = parseDtbook(xml);
  assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));

  const lists = d.blocks.filter((b) => b.type === 'list' && b.kind === 'glossary');
  // Bug 4 already splits the glossary around a page turn (before this fix and after): one chunk
  // up to and including "Biography", the pagenum, then a further chunk resuming with
  // "Bibliography".
  assert.ok(lists.length >= 2, JSON.stringify(d.blocks.map((b) => b.type)));

  const allItems = lists.flatMap((l) => l.items);
  const bio = allItems.find((it) => it.term === 'Biography');
  assert.ok(bio, JSON.stringify(allItems));

  // The running head's own words must not appear inside the entry's definition text.
  assert.ok(!/Glossary of Literary and Informational Terms/i.test(bio.def || ''), `running head leaked into def: ${JSON.stringify(bio.def)}`);
  assert.ok(!/Glossary of Literary and Informational Terms/i.test(bio.text || ''), `running head leaked into text: ${JSON.stringify(bio.text)}`);

  // The definition's own words, on EITHER side of the running head, must both survive, joined
  // as one continuous sentence (not glued to the running head, not dropped).
  assert.ok(/written by another person\./.test(bio.def), JSON.stringify(bio.def));
  assert.ok(/As such, biographies are usually told/.test(bio.def), JSON.stringify(bio.def));
  assert.ok(/person\.\s+As such/.test(bio.def), `the two halves must read as one continuous sentence: ${JSON.stringify(bio.def)}`);

  // Fidelity (load-audit.mjs's "nothing lost" check, same principle as K32): the running head's
  // own words are kept somewhere in the model, as this item's own trailing block.
  assert.ok(bio.blocks && bio.blocks.some((b) => /Glossary of Literary and Informational Terms/i.test(b.text || '')), `running head text must be kept (fidelity): ${JSON.stringify(bio.blocks)}`);

  // The page number itself is untouched: still recorded, splitting the glossary exactly as
  // before this fix (Bug 4).
  const pn = d.blocks.find((b) => b.type === 'pagenum' && b.page === 'R65');
  assert.ok(pn, JSON.stringify(d.blocks.filter((b) => b.type === 'pagenum')));

  // The neighbouring entries are untouched.
  const bias = allItems.find((it) => it.term === 'Bias');
  const biblio = allItems.find((it) => it.term === 'Bibliography');
  assert.ok(bias && /favors\.$/.test(bias.def));
  assert.ok(biblio && /materials used to write a text\.$/.test(biblio.def));
});

test('a running head riding a page turn at the END of a <dd> (no further definition text) is kept for fidelity, not appended to the definition (anthology "Database", page R67)', () => {
  // Anthology shape: the running head sits in its own trailing <p>, with nothing else after it
  // in the same <dd> — the entry's definition simply ends; there is no continuation to stitch.
  const xml = wrap(`
    <h1>Glossary of Literary and Informational Terms</h1>
    <dl>
      <dt><strong>Database</strong></dt> <dd>A database is a collection of information that can be quickly and easily accessed and searched.
      <pagenum id="pR67" page="special">R67</pagenum>
      <p><strong><em>Glossary of Literary and Informational Terms</em></strong></p></dd>
      <dt><strong>Debate</strong></dt> <dd>A debate is basically an argument.</dd>
    </dl>
  `);
  const d = parseDtbook(xml);
  assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));

  const lists = d.blocks.filter((b) => b.type === 'list' && b.kind === 'glossary');
  const allItems = lists.flatMap((l) => l.items);
  const db = allItems.find((it) => it.term === 'Database');
  assert.ok(db, JSON.stringify(allItems));

  assert.ok(!/Glossary of Literary and Informational Terms/i.test(db.def || ''), `running head must not be appended to the definition: ${JSON.stringify(db.def)}`);
  assert.ok(/easily accessed and searched\.$/.test(db.def), JSON.stringify(db.def));
  assert.ok(db.blocks && db.blocks.some((b) => /Glossary of Literary and Informational Terms/i.test(b.text || '')), `running head text must be kept (fidelity): ${JSON.stringify(db.blocks)}`);

  const pn = d.blocks.find((b) => b.type === 'pagenum' && b.page === 'R67');
  assert.ok(pn, JSON.stringify(d.blocks.filter((b) => b.type === 'pagenum')));

  const debate = allItems.find((it) => it.term === 'Debate');
  assert.ok(debate && debate.def === 'A debate is basically an argument.');
});

test('an ordinary mid-entry page turn with NO running head is unaffected (regression guard)', () => {
  const xml = wrap(`
    <h1>Glossary of Literary and Informational Terms</h1>
    <dl>
      <dt><strong>Claim</strong></dt> <dd>In an argument, a claim is the writer's position on an issue or problem.
      <pagenum id="pR66" page="special">R66</pagenum></dd>
      <dt><strong>Clarify</strong></dt> <dd>Clarifying is a reading strategy that helps readers understand what they are reading.</dd>
    </dl>
  `);
  const d = parseDtbook(xml);
  assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));
  const allItems = d.blocks.filter((b) => b.type === 'list' && b.kind === 'glossary').flatMap((l) => l.items);
  const claim = allItems.find((it) => it.term === 'Claim');
  assert.ok(claim && claim.def === "In an argument, a claim is the writer's position on an issue or problem.", JSON.stringify(claim));
  assert.ok(!claim.blocks, 'no running head here, so no extra trailing block');
  const pn = d.blocks.find((b) => b.type === 'pagenum' && b.page === 'R66');
  assert.ok(pn);
});
