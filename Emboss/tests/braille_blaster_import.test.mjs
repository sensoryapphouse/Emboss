// A24 — read BrailleBlaster's own elements on import. BrailleBlaster writes elements that are
// not valid DTBook (`<bai-play level="N">`, `<bai-verse level="N">`, `<bai-stage level="N">`,
// `<bai-tabletn>`, `<bai-trans1>`…`<bai-trans5>`) instead of Emboss's own `<p class="bai-*">`
// (D5, EMBOSS-TASKS.md). Emboss must read them on import, but a save must keep writing valid
// DTBook — never BrailleBlaster's own `<bai-*>` elements. See Emboss/docs/nimas-style-mapping.md
// ("Class names — Decided (D5)") for what each element means; follows the style of
// save_fidelity.test.mjs (one `describe` per element/case).

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;

// A save must never contain a literal `<bai-…` element (attribute values like
// class="bai-play" are fine and expected — only the element-name spelling `<bai-` is checked).
function assertNoBaiElements(xml) {
  assert.doesNotMatch(xml, /<bai-[a-z0-9]+[ >/]/i, `saved XML must not contain a BrailleBlaster <bai-*> element:\n${xml}`);
}

// The exported XML is well-formed (xmldom's DOMParser throws/records errors on unclosed or
// mismatched tags), which is a necessary (not sufficient) condition for DTBook validity — the
// full NIMAS 1.1 check is `node Emboss/scripts/daisy-validate.mjs`, run separately (not part of
// this fast unit suite).
function assertWellFormed(xml) {
  let errored = false;
  const parser = new DOMParser({
    onError: (level) => { if (level === 'error' || level === 'fatalError') errored = true; },
  });
  const dom = parser.parseFromString(xml, 'text/xml');
  assert.ok(dom && dom.documentElement, 'saved XML parses back to a document');
  assert.equal(errored, false, `saved XML must be well-formed:\n${xml}`);
}

describe('A24: <bai-play level="N">, <bai-verse level="N">, <bai-stage level="N">', () => {
  test('<bai-play level="1"> parses as the play/dialogue block, with its level', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <bai-play level="1">HAMLET: To be, or not to be, that is the question.</bai-play>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const playBlocks = doc.blocks.filter((b) => b.type === 'play' && b.subtype === 'prose');
    assert.equal(playBlocks.length, 1, 'one play/dialogue block parsed');
    assert.equal(playBlocks[0].text, 'HAMLET: To be, or not to be, that is the question.');
    assert.equal(playBlocks[0].level, 1, 'level="1" is read onto the block\'s level field');

    const exportedXml = exportToNimas(doc);
    assertNoBaiElements(exportedXml);
    assertWellFormed(exportedXml);
    assert.ok(exportedXml.includes('<p class="bai-play level-1">'), `saved as valid DTBook <p class="bai-play level-1">:\n${exportedXml}`);
  });

  test('<bai-play> with no level attribute parses with level 0 (no class="level-N" written back)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <bai-play>OPHELIA: My lord, I have remembrances of yours.</bai-play>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const playBlocks = doc.blocks.filter((b) => b.type === 'play' && b.subtype === 'prose');
    assert.equal(playBlocks.length, 1);
    assert.equal(playBlocks[0].level, 0);

    const exportedXml = exportToNimas(doc);
    assertNoBaiElements(exportedXml);
    assert.ok(exportedXml.includes('<p class="bai-play">'), `no level- class when there was no level:\n${exportedXml}`);
  });

  test('<bai-verse level="2"> parses as verse *drama* (playVerse), not a poem', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <bai-verse level="2">Get thee to a nunnery, go.</bai-verse>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const verseBlocks = doc.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks.length, 1, 'one verse-drama block parsed');
    assert.equal(verseBlocks[0].text, 'Get thee to a nunnery, go.');
    assert.equal(verseBlocks[0].level, 2);
    assert.equal(verseBlocks[0].playVerse, true, 'D5: bai-verse means verse drama, so playVerse must be set (not a <poem> line)');
    assert.equal(!!verseBlocks[0].fromPoem, false, 'not read from a <poem>');

    const exportedXml = exportToNimas(doc);
    assertNoBaiElements(exportedXml);
    assertWellFormed(exportedXml);
    assert.ok(exportedXml.includes('<p class="bai-verse level-2">'), `saved as valid DTBook <p class="bai-verse level-2">:\n${exportedXml}`);
    assert.equal(exportedXml.includes('<poem>'), false, 'verse drama must not be wrapped in <poem> (D5)');
  });

  test('<bai-stage level="1"> parses as the stage-direction block, with its level', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <bai-stage level="1">Enter Ghost and Hamlet.</bai-stage>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const stageBlocks = doc.blocks.filter((b) => b.type === 'stage');
    assert.equal(stageBlocks.length, 1, 'one stage-direction block parsed');
    assert.equal(stageBlocks[0].text, 'Enter Ghost and Hamlet.');
    assert.equal(stageBlocks[0].level, 1);

    const exportedXml = exportToNimas(doc);
    assertNoBaiElements(exportedXml);
    assertWellFormed(exportedXml);
    assert.ok(exportedXml.includes('<p class="bai-stage level-1">'), `saved as valid DTBook <p class="bai-stage level-1">:\n${exportedXml}`);
  });
});

describe('A24: <bai-tabletn> — a table\'s transcriber\'s note', () => {
  test('a standalone <bai-tabletn> parses as a tabletn note', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <bai-tabletn>Column headings abbreviated for width.</bai-tabletn>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const notes = doc.blocks.filter((b) => b.type === 'note' && b.kind === 'tabletn');
    assert.equal(notes.length, 1, 'one tabletn note parsed');
    assert.equal(notes[0].text, 'Column headings abbreviated for width.');

    const exportedXml = exportToNimas(doc);
    assertNoBaiElements(exportedXml);
    assertWellFormed(exportedXml);
    assert.ok(exportedXml.includes('<prodnote class="tabletn"'), `saved as valid DTBook <prodnote class="tabletn">:\n${exportedXml}`);
  });

  test('a <bai-tabletn> following a table\'s caption is kept, table body untouched', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <table>
          <caption>Population by year</caption>
          <bai-tabletn>Figures rounded to the nearest thousand.</bai-tabletn>
          <tbody>
            <tr><th>Year</th><th>Population</th></tr>
            <tr><td>2020</td><td>1,000</td></tr>
          </tbody>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const notes = doc.blocks.filter((b) => b.type === 'note' && b.kind === 'tabletn');
    assert.equal(notes.length, 1, 'the table\'s bai-tabletn is parsed');
    assert.equal(notes[0].text, 'Figures rounded to the nearest thousand.');
    const tables = doc.blocks.filter((b) => b.type === 'table');
    assert.equal(tables.length, 1, 'the table itself still parses');

    const exportedXml = exportToNimas(doc);
    assertNoBaiElements(exportedXml);
    assertWellFormed(exportedXml);
  });
});

describe('A24: <bai-trans1>…<bai-trans5> — transcriber-defined typeform runs', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    test(`<bai-trans${n}> inside a paragraph keeps its text and records the loss`, () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>Please see the <bai-trans${n}>Special Notice</bai-trans${n}> on the next page.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
      const doc = parseDtbook(xml);
      const paras = doc.blocks.filter((b) => b.type === 'para');
      assert.equal(paras.length, 1, 'one paragraph parsed');
      assert.equal(paras[0].text, 'Please see the Special Notice on the next page.', 'the run\'s text is kept, not dropped');

      // The loss (Emboss has no trans1-5 typeform to represent this in) is recorded on the
      // produced text segment(s), not silently swallowed.
      const tagged = (paras[0].segments || []).filter((s) => s.transcriberTypeform === `bai-trans${n}`);
      assert.ok(tagged.length >= 1, `at least one segment records it came from <bai-trans${n}>`);
      const taggedText = tagged.map((s) => s.text).join('');
      assert.equal(taggedText, 'Special Notice', 'the tagged segment carries the run\'s own text');

      const exportedXml = exportToNimas(doc);
      assertNoBaiElements(exportedXml);
      assertWellFormed(exportedXml);
      assert.ok(exportedXml.includes('Please see the Special Notice on the next page.'), `text survives the save even though the typeform is lost:\n${exportedXml}`);
    });
  }
});

describe('A24: a whole small BrailleBlaster-shaped document round-trips', () => {
  test('play, verse drama, stage direction, a table transcriber\'s note and a trans1 run all survive parse -> export', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <frontmatter>
      <doctitle>Hamlet, Act 3 Scene 1 (excerpt)</doctitle>
    </frontmatter>
    <bodymatter>
      <level1>
        <h1>Act 3, Scene 1</h1>
        <bai-stage level="0">Enter Hamlet.</bai-stage>
        <bai-play level="0">HAMLET: To be, or not to be, that is the question.</bai-play>
        <bai-verse level="1">Whether &#8217;tis nobler in the mind to suffer</bai-verse>
        <p>A note on staging: see the <bai-trans1>Folio</bai-trans1> variant.</p>
        <table>
          <caption>Editions consulted</caption>
          <bai-tabletn>Dates are first-publication years.</bai-tabletn>
          <tbody>
            <tr><th>Edition</th><th>Year</th></tr>
            <tr><td>First Quarto</td><td>1603</td></tr>
          </tbody>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

    const doc = parseDtbook(xml);
    assert.equal(doc.blocks.filter((b) => b.type === 'stage').length, 1, 'stage direction parsed');
    assert.equal(doc.blocks.filter((b) => b.type === 'play' && b.subtype === 'prose').length, 1, 'dialogue parsed');
    assert.equal(doc.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse').length, 1, 'verse drama parsed');
    assert.equal(doc.blocks.filter((b) => b.type === 'note' && b.kind === 'tabletn').length, 1, 'table transcriber\'s note parsed');
    assert.equal(doc.blocks.filter((b) => b.type === 'table').length, 1, 'table parsed');

    const exportedXml = exportToNimas(doc);
    assertNoBaiElements(exportedXml);
    assertWellFormed(exportedXml);
    assert.ok(exportedXml.includes('<p class="bai-stage">'), 'stage direction saved as valid DTBook');
    assert.ok(exportedXml.includes('<p class="bai-play">'), 'dialogue saved as valid DTBook');
    assert.ok(exportedXml.includes('<p class="bai-verse level-1">'), 'verse drama saved as valid DTBook');
    assert.ok(exportedXml.includes('<prodnote class="tabletn"'), 'table transcriber\'s note saved as valid DTBook');

    // Re-parsing the exported XML (a second load) recovers the same block shapes — the
    // BrailleBlaster-only spelling was only ever needed on the way in.
    const doc2 = parseDtbook(exportedXml);
    assert.equal(doc2.blocks.filter((b) => b.type === 'stage').length, 1);
    assert.equal(doc2.blocks.filter((b) => b.type === 'play' && b.subtype === 'prose').length, 1);
    assert.equal(doc2.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse').length, 1);
    assert.equal(doc2.blocks.filter((b) => b.type === 'note' && b.kind === 'tabletn').length, 1);
  });
});
