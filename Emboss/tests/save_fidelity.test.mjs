// A19 / A20 / A21 / A22 — save fidelity. See Emboss/docs/wip/A19-save-fidelity.md for the
// staged plan this file follows: one `describe` per stage, added in order as each stage is
// tackled. Each test proves a save -> reload round trip keeps content the exporter used to drop
// (poems as <poem>/<linegroup>/<line>, <a href>, <cite>, <div class>, <docauthor>, imported
// <prodnote render>) instead of silently discarding it.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimas, exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;

describe('A19/A21 Stage 2: poems save as <poem>/<linegroup>/<line>, not <p class="bai-verse">', () => {
  test('a <poem> with two <linegroup>s of <line>s round-trips as <poem>/<linegroup>/<line>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>Nature</h2>
        <poem>
          <linegroup>
            <line>Nature is what we see&#8212;</line>
            <line>The Hill&#8212;the Afternoon&#8212;</line>
          </linegroup>
          <linegroup>
            <line>Nature is what we hear&#8212;</line>
            <line>The Bobolink&#8212;the Sea&#8212;</line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

    const doc1 = parseDtbook(xml);
    const verseBlocks = doc1.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks.length, 4, 'all 4 lines parsed');
    assert.ok(verseBlocks.every((b) => b.fromPoem), 'lines read from <poem> are tagged fromPoem so the exporter can tell them apart from bai-verse drama');

    const exportedXml = exportToNimas(doc1);
    assert.ok(exportedXml.includes('<poem>'), `exported XML should contain <poem>:\n${exportedXml}`);
    assert.ok(exportedXml.includes('<linegroup>'), 'exported XML should contain <linegroup>');
    assert.match(exportedXml, /<line[ >][^]*?Nature is what we see/, 'exported XML should contain <line> for the first verse');
    assert.equal(exportedXml.includes('<p class="bai-verse'), false, 'a genuine poem must no longer be saved as <p class="bai-verse"> (A19/A21)');

    // Two separate <linegroup> elements (the stanza break) round-trip losslessly.
    const doc2 = parseDtbook(exportedXml);
    const verseBlocks2 = doc2.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks2.length, 4, 'round trip keeps all 4 lines');
    const indicators2 = doc2.blocks.filter((b) => b.type === 'indicator');
    const indicators1 = doc1.blocks.filter((b) => b.type === 'indicator');
    assert.equal(indicators2.length, indicators1.length, 'stanza break survives the round trip');
    for (let i = 0; i < verseBlocks.length; i++) {
      assert.equal(verseBlocks2[i].text, verseBlocks[i].text, `line ${i} text matches after round trip`);
    }
  });

  test('inline formatting (<em>/<strong>/<span class="underline">) inside a poem line survives as <line>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <poem>
          <linegroup>
            <line>Listen, my children, and <em>you shall hear</em></line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const exportedXml = exportToNimas(doc);
    assert.ok(exportedXml.includes('<poem>'), 'still exported as <poem>');
    assert.ok(exportedXml.includes('<em>you shall hear</em>'), 'em survives inside the <line>');
  });

  test('verse *drama* — a bare <p class="bai-verse"> outside any <poem> — still saves as <p class="bai-verse"> (D5)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p class="bai-play">HAMLET: To be, or not to be.</p>
        <p class="bai-verse">that is the question, spoken in verse mid-scene</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const verseBlocks = doc.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks.length, 1);
    assert.equal(!!verseBlocks[0].fromPoem, false, 'not read from a <poem>, so not tagged fromPoem');

    const exportedXml = exportToNimas(doc);
    assert.ok(exportedXml.includes('<p class="bai-verse">that is the question'), 'BrailleBlaster\'s bai-verse (verse drama, D5) is unchanged by the poem fix');
    assert.equal(exportedXml.includes('<poem>'), false, 'verse drama must not be wrapped in <poem>');
  });

  test('a synthetic AST play/verse block with no fromPoem flag (as produced by hand-built ASTs) keeps its old <p class="bai-verse"> shape', () => {
    // Guards the existing nimas_roundtrip.test.mjs synthetic-AST case, which builds
    // { type: 'play', subtype: 'verse', ... } directly without going through parseDtbook.
    const doc = { blocks: [{ type: 'play', subtype: 'verse', style: 'verse', text: 'Two roads diverged in a yellow wood,' }] };
    const xml = exportToNimasXml(doc);
    assert.ok(xml.includes('<p class="bai-verse">Two roads diverged'), 'unflagged verse blocks keep exporting as <p class="bai-verse">');
  });
});

describe('A19 Stage 3: links (<a href>) survive a save', () => {
  test('a simple <a href> inside a paragraph round-trips with its href', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>See <a href="http://example.com/page">the example page</a> for more.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const para = doc1.blocks.find((b) => b.type === 'para' || b.type === 'p');
    assert.ok(para, 'a paragraph block was parsed');
    assert.ok(Array.isArray(para.segments), 'paragraph has segments');
    const linkSeg = para.segments.find((s) => s.href === 'http://example.com/page');
    assert.ok(linkSeg, `a segment carries the href:\n${JSON.stringify(para.segments)}`);
    assert.equal(linkSeg.text, 'the example page', 'the link text is kept as ordinary text');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<a href="http:\/\/example\.com\/page">the example page<\/a>/, `exported XML should contain the <a href>:\n${exportedXml}`);

    const doc2 = parseDtbook(exportedXml);
    const para2 = doc2.blocks.find((b) => b.type === 'para' || b.type === 'p');
    const linkSeg2 = para2.segments.find((s) => s.href === 'http://example.com/page');
    assert.ok(linkSeg2, 'href survives a full save -> reload round trip');
    assert.equal(linkSeg2.text, 'the example page');
  });

  test('a formatted run inside a link (<a href><em>...</em></a>) keeps both the href and the emphasis', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>Read <a href="http://example.com/x"><em>this</em> now</a>.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const exportedXml = exportToNimas(doc);
    assert.match(exportedXml, /<a href="http:\/\/example\.com\/x"><em>this<\/em> now<\/a>/, `both segments of the link stay inside one <a>:\n${exportedXml}`);
  });

  test('an <a> with no href is unaffected (unwrapped as plain text, as before)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>See <a>the anchor</a> here.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const exportedXml = exportToNimas(doc);
    assert.equal(exportedXml.includes('<a>'), false, 'an href-less <a> is still unwrapped, unchanged from before this fix');
    assert.ok(exportedXml.includes('the anchor'), 'its text is still kept');
  });
});

describe('A19 Stage 4: <cite> survives a save', () => {
  test('an inline <cite> inside a paragraph round-trips', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>As noted in <cite>The Origin of Species</cite>, evolution proceeds slowly.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const para = doc1.blocks.find((b) => b.type === 'para' || b.type === 'p');
    assert.ok(Array.isArray(para.segments), 'paragraph has segments');
    const citeSeg = para.segments.find((s) => s.cite === true);
    assert.ok(citeSeg, `a segment is marked cite:\n${JSON.stringify(para.segments)}`);
    assert.equal(citeSeg.text, 'The Origin of Species');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<cite>The Origin of Species<\/cite>/, `exported XML should contain <cite>:\n${exportedXml}`);

    const doc2 = parseDtbook(exportedXml);
    const para2 = doc2.blocks.find((b) => b.type === 'para' || b.type === 'p');
    const citeSeg2 = para2.segments.find((s) => s.cite === true);
    assert.ok(citeSeg2, 'cite survives a full save -> reload round trip');
    assert.equal(citeSeg2.text, 'The Origin of Species');
  });
});

describe('A19 Stage 5: <div class> survives a save', () => {
  test('a plain <div class="…"> around two paragraphs round-trips as one <div class="…">', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <div class="callout">
          <p>First paragraph.</p>
          <p>Second paragraph.</p>
        </div>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const paras = doc1.blocks.filter((b) => b.type === 'para');
    assert.equal(paras.length, 2, 'both paragraphs parsed');
    assert.ok(paras.every((b) => b.divClass === 'callout'), `both paragraphs are tagged with the div's class:\n${JSON.stringify(paras)}`);

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<div class="callout">\s*<p>First paragraph\.<\/p>\s*<p>Second paragraph\.<\/p>\s*<\/div>/, `exported XML should contain one <div class="callout">:\n${exportedXml}`);
    assert.equal((exportedXml.match(/<div class="callout">/g) || []).length, 1, 'the two paragraphs stay inside one <div>, not two');

    const doc2 = parseDtbook(exportedXml);
    const paras2 = doc2.blocks.filter((b) => b.type === 'para');
    assert.equal(paras2.length, 2, 'round trip keeps both paragraphs');
    assert.ok(paras2.every((b) => b.divClass === 'callout'), 'the div class survives a full save -> reload round trip');
  });

  test('two separate, adjacent <div class="…"> elements with the same class stay two <div>s, not merged into one', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <div class="callout"><p>A</p></div>
        <div class="callout"><p>B</p></div>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const paras = doc1.blocks.filter((b) => b.type === 'para');
    assert.equal(paras.length, 2);
    assert.notEqual(paras[0].divId, paras[1].divId, 'each div gets its own instance id so they are not merged');

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<div class="callout">/g) || []).length, 2, `two separate <div>s stay separate:\n${exportedXml}`);
  });

  test('a <div> with no class is unaffected (still unwrapped transparently, as before)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <div><p>Plain text.</p></div>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const para = doc.blocks.find((b) => b.type === 'para');
    assert.equal(para.divClass, undefined, 'a classless div leaves no divClass');

    const exportedXml = exportToNimas(doc);
    assert.equal(exportedXml.includes('<div>'), false, 'a classless div is still unwrapped, unchanged from before this fix');
    assert.ok(exportedXml.includes('Plain text.'));
  });
});

describe('A22 Stage 7: an imported <prodnote render="required"> keeps its value', () => {
  test('a body-level <prodnote render="required"> keeps render="required" through a save', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>Some text.</p>
        <prodnote render="required">Caution: hot surface.</prodnote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const note = doc1.blocks.find((b) => b.type === 'note');
    assert.ok(note, 'the prodnote was parsed as a note block');
    assert.equal(note.render, 'required', `the source render="required" is captured onto block.render:\n${JSON.stringify(note)}`);

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<prodnote render="required">Caution: hot surface\.<\/prodnote>/, `exported XML keeps render="required":\n${exportedXml}`);

    const doc2 = parseDtbook(exportedXml);
    const note2 = doc2.blocks.find((b) => b.type === 'note');
    assert.equal(note2.render, 'required', 'render="required" survives a full save -> reload round trip');
  });

  test('a <prodnote render="optional"> keeps its own value through a save (A22/A43, fixed 23 Sep)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <prodnote render="optional">A minor aside.</prodnote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const note = doc.blocks.find((b) => b.type === 'note');
    // parse.mjs now records an explicit 'optional' as well as 'required', so an imported note
    // is no longer indistinguishable from one Emboss created itself (A22's rule), and only the
    // latter takes D6's required-by-default on export (A43).
    assert.equal(note.render, 'optional', "render=\"optional\" is captured as the block's own value");
    const exportedXml = exportToNimas(doc);
    assert.match(exportedXml, /<prodnote render="optional">A minor aside\.<\/prodnote>/);
  });

  test('a list-level <prodnote render="required"> (A2) keeps its value too', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <list type="ul">
          <li>Item one</li>
          <prodnote render="required">List-level warning.</prodnote>
        </list>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const note = doc1.blocks.find((b) => b.type === 'note');
    assert.equal(note.render, 'required');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<prodnote render="required">List-level warning\.<\/prodnote>/, `exported XML:\n${exportedXml}`);
  });

  test('an <imggroup> image description (<prodnote render="required"> inside it) keeps its render value', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <imggroup>
          <img src="./photo.jpg" alt="A photo"/>
          <prodnote imgref="x" render="required">A detailed description of the photo.</prodnote>
        </imggroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const graphic = doc1.blocks.find((b) => b.type === 'graphic');
    assert.equal(graphic.description, 'A detailed description of the photo.');
    assert.equal(graphic.descriptionRender, 'required', `the source render="required" is captured:\n${JSON.stringify(graphic)}`);

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<prodnote render="required">A detailed description of the photo\.<\/prodnote>/, `exported XML:\n${exportedXml}`);
  });

  test('the tableOfContents.xml anomaly (stage 1): a <prodnote> whose text lives only in a description="…" attribute, with no element content, is no longer dropped entirely', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <imggroup>
          <img alt="Star" src="./star.jpg"/>
          <prodnote description="This is a test description" id="x" imgref="y" render="optional"/>
        </imggroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const graphic = doc.blocks.find((b) => b.type === 'graphic');
    assert.equal(graphic.description, 'This is a test description', `the description attribute is read as a fallback (was dropped entirely before this fix):\n${JSON.stringify(graphic)}`);

    const exportedXml = exportToNimas(doc);
    assert.match(exportedXml, /<prodnote render="optional">This is a test description<\/prodnote>/);
  });

  test('an Emboss-created transcriber\'s note (no source render) now defaults to required, per D6 (A43 — see that describe block)', () => {
    // D6: a note block Emboss itself builds (e.g. programmatically, with no `.render` field
    // at all) defaults to render="required", not "optional" — A43 fixed `case 'note':`, which
    // previously fell through to "optional" unconditionally. See the dedicated "A43" describe
    // block below for the full set of cases (including the import-side limitation this
    // necessarily shares).
    const doc = { blocks: [{ type: 'note', text: 'A transcriber note Emboss created.' }] };
    const xml = exportToNimasXml(doc);
    assert.match(xml, /<prodnote render="required">A transcriber note Emboss created\.<\/prodnote>/);
  });
});

describe('A34: an <imggroup> with several <prodnote>s keeps each one separate, not merged into one', () => {
  test('two <prodnote>s (9780076996285NIMAS.xml shape) round-trip as two <prodnote>s, not merged', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <imggroup>
          <img id="img-039" src="./images/p014_001.jpg" alt="An illustration of the organisms in the pond ecosystem."/>
          <prodnote imgref="img-039" render="optional">Production note: this image crosses the gutter to appear both on page 14 and page 15 in the print version.</prodnote>
          <prodnote imgref="img-039" render="optional">Production note: captions associated with this image are labels that correspond to text within the image.</prodnote>
          <caption imgref="img-039" class="label">A Pond Ecosystem</caption>
        </imggroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const graphic = doc1.blocks.find((b) => b.type === 'graphic');
    assert.ok(graphic, 'the imggroup parsed as a graphic block');
    // graphic.description stays the merged text — every existing reader (braille formatter,
    // docx export, the editor's own display) keeps working unchanged off this single field.
    assert.equal(graphic.description,
      'Production note: this image crosses the gutter to appear both on page 14 and page 15 in the print version. Production note: captions associated with this image are labels that correspond to text within the image.',
      `graphic.description stays the joined text for every existing reader:\n${JSON.stringify(graphic)}`);
    // But the two source notes are also kept apart.
    assert.ok(Array.isArray(graphic.descriptions), `graphic.descriptions is an array:\n${JSON.stringify(graphic)}`);
    assert.equal(graphic.descriptions.length, 2, 'both source prodnotes kept as separate entries');
    assert.equal(graphic.descriptions[0].text, 'Production note: this image crosses the gutter to appear both on page 14 and page 15 in the print version.');
    assert.equal(graphic.descriptions[1].text, 'Production note: captions associated with this image are labels that correspond to text within the image.');

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<prodnote/g) || []).length, 2, `both source prodnotes stay separate elements on export:\n${exportedXml}`);
    assert.match(exportedXml, /<prodnote render="optional">Production note: this image crosses the gutter[^<]*<\/prodnote>\s*<prodnote render="optional">Production note: captions associated[^<]*<\/prodnote>/, `each note keeps its own text and boundary:\n${exportedXml}`);

    // Round trip: the exported XML, reparsed, still has two separate prodnotes worth of content.
    const doc2 = parseDtbook(exportedXml);
    const graphic2 = doc2.blocks.find((b) => b.type === 'graphic');
    assert.equal(graphic2.descriptions.length, 2, 'both notes survive a full save -> reload round trip');
  });

  test('each <prodnote> keeps its own render value on export', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <imggroup>
          <img src="./photo.jpg" alt="A photo"/>
          <prodnote render="required">Essential: read this aloud.</prodnote>
          <prodnote render="optional">A minor aside about the photo.</prodnote>
        </imggroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const graphic = doc1.blocks.find((b) => b.type === 'graphic');
    assert.equal(graphic.descriptions[0].render, 'required');
    assert.notEqual(graphic.descriptions[1].render, 'required');
    // The merged description's own render flag stays "any note required -> required" (D6/A22
    // shape), for the single-field readers that only ever look at descriptionRender.
    assert.equal(graphic.descriptionRender, 'required');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<prodnote render="required">Essential: read this aloud\.<\/prodnote>\s*<prodnote render="optional">A minor aside about the photo\.<\/prodnote>/, `each note's own render value is written, not the merged one:\n${exportedXml}`);
  });

  test('a single <prodnote> (the common case) is unaffected — still one <prodnote>, descriptions has one entry', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <imggroup>
          <img src="./photo.jpg" alt="A photo"/>
          <prodnote render="required">A single description.</prodnote>
        </imggroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const graphic = doc1.blocks.find((b) => b.type === 'graphic');
    assert.equal(graphic.description, 'A single description.');
    assert.equal(graphic.descriptions.length, 1);

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<prodnote/g) || []).length, 1, `still exactly one <prodnote>:\n${exportedXml}`);
    assert.match(exportedXml, /<prodnote render="required">A single description\.<\/prodnote>/);
  });

  test('an Emboss-created description with no source <prodnote> at all (no descriptions array) still exports as one <prodnote>, unaffected', () => {
    // Guards the hand-built-AST / editor-created case: no parseImgGroup involved, so no
    // block.descriptions array exists at all — the old single-description shape must still work.
    const doc = { blocks: [{ type: 'graphic', src: './x.jpg', alt: 'x', description: 'Emboss wrote this description.' }] };
    const xml = exportToNimasXml(doc);
    assert.equal((xml.match(/<prodnote/g) || []).length, 1);
    assert.match(xml, /<prodnote render="optional">Emboss wrote this description\.<\/prodnote>/);
  });
});

describe('A19 Stage 6: <docauthor> survives a save (checked first — already worked)', () => {
  test('a single <docauthor> round-trips through metadata.docauthor', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <frontmatter>
      <doctitle>Valentin Ha&#252;y</doctitle>
      <docauthor>Beatrice Christensen Sk&#246;ld</docauthor>
    </frontmatter>
    <bodymatter>
      <level1><p>Body text.</p></level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    assert.equal(doc.metadata && doc.metadata.docauthor, 'Beatrice Christensen Sköld', 'parser reads <docauthor> into metadata.docauthor');

    const exportedXml = exportToNimas(doc);
    assert.ok(exportedXml.includes('<docauthor>Beatrice Christensen Sköld</docauthor>'), `exporter writes <docauthor> back:\n${exportedXml}`);

    const doc2 = parseDtbook(exportedXml);
    assert.equal(doc2.metadata.docauthor, doc.metadata.docauthor, 'docauthor survives a full save -> reload round trip');
  });

  test('several <docauthor> elements (a book may have more than one author, A28) all round-trip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <frontmatter>
      <doctitle>Two Authors</doctitle>
      <docauthor>Author One</docauthor>
      <docauthor>Author Two</docauthor>
    </frontmatter>
    <bodymatter>
      <level1><p>Body text.</p></level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    assert.deepEqual(doc.metadata.docauthors, ['Author One', 'Author Two']);

    const exportedXml = exportToNimas(doc);
    const doc2 = parseDtbook(exportedXml);
    assert.deepEqual(doc2.metadata.docauthors, doc.metadata.docauthors, 'both authors survive a save -> reload round trip');
  });
});

describe('A35: verse lines that are not inside a <poem> survive a save as <line>, not <p class="bai-verse">', () => {
  test('a <blockquote> mixing <line>s with a <p> (a quoted letter, hauy_history_valid.xml dtb380 shape) round-trips as one <blockquote> with real <line> elements', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>The title page reads:</p>
        <blockquote>
          <line>To the KING OF FRANCE</line>
          <line>SIRE,</line>
          <p>THE Protection with which your Majesty honours distinguished Talents.</p>
          <line>I am, with the profoundest respect,</line>
          <line>Sire,</line>
        </blockquote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const lineBlocks = doc1.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse' && b.fromLineTag);
    assert.equal(lineBlocks.length, 4, `all 4 <line>s parsed and tagged fromLineTag:\n${JSON.stringify(doc1.blocks)}`);
    assert.ok(lineBlocks.every((b) => b.fromBlockquoteLines), 'each is also tagged as belonging to a blockquote-lines run');
    const quotePara = doc1.blocks.find((b) => b.type === 'para' && b.style === 'quote');
    assert.ok(quotePara, 'the <p> inside the blockquote still parses as a quote paragraph');
    assert.ok(quotePara.fromBlockquoteLines, 'the <p> is tagged into the same blockquote run as the lines around it');

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<line[\s>]/g) || []).length, 4, `exported XML keeps all 4 <line> elements:\n${exportedXml}`);
    assert.equal(exportedXml.includes('<p class="bai-verse">'), false, 'no line collapses to <p class="bai-verse">');
    assert.equal((exportedXml.match(/<blockquote/g) || []).length, 1, `all of dtb380's content stays inside one <blockquote>:\n${exportedXml}`);
    assert.match(exportedXml, /<blockquote>\s*<line>To the KING OF FRANCE<\/line>\s*<line>SIRE,<\/line>\s*<p>THE Protection[^<]*<\/p>\s*<line>I am, with the profoundest respect,<\/line>\s*<line>Sire,<\/line>\s*<\/blockquote>/, `blockquote content keeps source order and shape:\n${exportedXml}`);

    const doc2 = parseDtbook(exportedXml);
    const lineBlocks2 = doc2.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse' && b.fromLineTag);
    assert.equal(lineBlocks2.length, 4, 'all 4 lines survive a full save -> reload round trip');
  });

  test('a bare <line> run outside any <blockquote> (a quoted song lyric among plain paragraphs, NIMAS_valid_baseline.xml shape) round-trips as <line>, not <p class="bai-verse">', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>One of the most popular songs of the era was "Pennies From Heaven":</p>
        <line>A long time ago</line>
        <line>A million years B.C.</line>
        <cite>Written by Johnny Burke and Arthur Johnston.</cite>
        <p>Other types of entertainment slipped in to help society refocus.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const lineBlocks = doc1.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse' && b.fromLineTag);
    assert.equal(lineBlocks.length, 2, `both bare <line>s parsed and tagged fromLineTag:\n${JSON.stringify(doc1.blocks)}`);
    assert.ok(lineBlocks.every((b) => !b.fromBlockquoteLines), 'not part of any blockquote run — there is no <blockquote> in this source');

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<line[\s>]/g) || []).length, 2, `exported XML keeps both <line> elements:\n${exportedXml}`);
    assert.equal(exportedXml.includes('<p class="bai-verse">'), false, 'no line collapses to <p class="bai-verse">');
    assert.equal(exportedXml.includes('<blockquote'), false, 'no spurious <blockquote> is introduced for a source with none');

    const doc2 = parseDtbook(exportedXml);
    const lineBlocks2 = doc2.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse' && b.fromLineTag);
    assert.equal(lineBlocks2.length, 2, 'both lines survive a full save -> reload round trip');
  });

  test('an ordinary paragraph-only <blockquote> (the common case) is unaffected — still <blockquote class="quote"><p class="quote">', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <blockquote>
          <p>A quoted paragraph, no verse lines involved.</p>
        </blockquote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const quotePara = doc.blocks.find((b) => b.type === 'para' && b.style === 'quote');
    assert.ok(quotePara, 'still parses as a quote paragraph');
    assert.equal(quotePara.fromBlockquoteLines, undefined, 'a paragraph-only blockquote is not routed through the new A35 path');

    const exportedXml = exportToNimas(doc);
    assert.match(exportedXml, /<blockquote class="quote"><p class="quote">/, `unchanged from before this fix:\n${exportedXml}`);
  });

  test('a bare <line>/<ln> reparsed from an editor-created <p class="bai-verse"> (verse drama, D5, no source <line>) is unaffected', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p class="bai-verse">A line of verse drama.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const block = doc.blocks.find((b) => b.type === 'play' && b.subtype === 'verse');
    assert.ok(block, 'parses as a verse block');
    assert.equal(block.fromLineTag, undefined, 'not tagged fromLineTag — it never came from a real <line> element');
    assert.equal(block.playVerse, true, 'still keeps playVerse (D5) so it round-trips as <p class="bai-verse">, unchanged from before this fix');

    const exportedXml = exportToNimas(doc);
    assert.ok(exportedXml.includes('<p class="bai-verse">'), `unchanged from before this fix:\n${exportedXml}`);
  });
});

describe('A36: a TOC/index page-number link keeps its href on save', () => {
  test('a <li class="toc-page"><a href> page number (9780076996285NIMAS.xml shape) round-trips with its href', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>Table of Contents</h2>
        <list type="pl">
          <li class="toc-entry">Encounter the Phenomenon</li><li class="toc-page"><a href="#p2">2</a></li>
        </list>
        <pagenum id="p2" page="normal">2</pagenum>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const listBlock = doc1.blocks.find((b) => b.type === 'list');
    assert.ok(listBlock, `a list block was parsed:\n${JSON.stringify(doc1.blocks)}`);
    assert.equal(listBlock.items.length, 1, 'the toc-page sibling <li> attaches its page to the previous entry, not a separate item');
    const item = listBlock.items[0];
    assert.equal(item.page, '2', 'the visible page number is kept, as before this fix');
    assert.equal(item.pageHref, '#p2', 'the page number\'s own href is now kept alongside it');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<lic class="bai-toc-page"><a href="#p2">2<\/a><\/lic>/, `exported page column wraps the number in its href:\n${exportedXml}`);
    assert.equal((exportedXml.match(/<a\s[^>]*\bhref=/g) || []).length, 1, `exactly one <a href> in the export:\n${exportedXml}`);

    const doc2 = parseDtbook(exportedXml);
    const item2 = doc2.blocks.find((b) => b.type === 'list').items[0];
    assert.equal(item2.page, '2', 'page number survives a full save -> reload round trip');
    assert.equal(item2.pageHref, '#p2', 'href survives a full save -> reload round trip');
  });

  test('a <lic class="bai-toc-page"><p><a href> page number (9780544087507NIMAS.xml shape) round-trips with its href', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>Contents</h2>
        <list type="pl">
          <li class="toc-page"><p><a href="#p3">3</a></p></li>
        </list>
        <pagenum id="p3" page="normal">3</pagenum>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    // Alone, a toc-page <li> has no preceding entry to attach to — pair it with one, matching
    // the real sample's shape (a toc-entry <li> immediately followed by its toc-page sibling).
    const xml2 = xml.replace('<list type="pl">', '<list type="pl"><li class="toc-entry">Introduction</li>');
    const doc1 = parseDtbook(xml2);
    const item = doc1.blocks.find((b) => b.type === 'list').items[0];
    assert.equal(item.page, '3');
    assert.equal(item.pageHref, '#p3');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<lic class="bai-toc-page"><a href="#p3">3<\/a><\/lic>/, `exported page column wraps the number in its href:\n${exportedXml}`);
  });

  test('an index entry (<li class="page">, bai-index shape) page number keeps its href too', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>Index</h2>
        <list type="pl" class="index">
          <li class="bai-index"><lic class="bai-index-text">Accessibility</lic><lic class="bai-index-page"><a href="#p42">42</a></lic></li>
        </list>
        <pagenum id="p42" page="normal">42</pagenum>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const item = doc1.blocks.find((b) => b.type === 'list').items[0];
    assert.equal(item.page, '42');
    assert.equal(item.pageHref, '#p42');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<lic class="bai-index-page"><a href="#p42">42<\/a><\/lic>/, `exported index page column wraps the number in its href:\n${exportedXml}`);
  });

  test('a plain (unlinked) page number is unaffected — no pageHref, no <a> introduced', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>Table of Contents</h2>
        <list type="pl">
          <li class="toc-entry">Plain Entry</li><li class="toc-page">7</li>
        </list>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const item = doc1.blocks.find((b) => b.type === 'list').items[0];
    assert.equal(item.page, '7');
    assert.equal(item.pageHref, undefined, 'no href in the source, so none is invented');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<lic class="bai-toc-page">7<\/lic>/, `unchanged from before this fix:\n${exportedXml}`);
    assert.equal(exportedXml.includes('<a '), false, 'no spurious <a> introduced for a source with no link');
  });
});

describe('A40: a multi-paragraph <blockquote> saves as one <blockquote>, not one per paragraph', () => {
  test('a <blockquote> with two plain <p> children (hauy_history_valid.xml dtb725 shape) round-trips as one <blockquote>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <blockquote>
          <p>It is urgent</p>
          <p>that you appoint in my place Mr. Protopopoff, an honest family man.</p>
        </blockquote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const quoteParas = doc1.blocks.filter((b) => b.type === 'para' && b.style === 'quote');
    assert.equal(quoteParas.length, 2, `both paragraphs parsed as quote paragraphs:\n${JSON.stringify(doc1.blocks)}`);
    assert.ok(quoteParas[0].blockquoteId != null, 'tagged with a blockquote run id, same shape as A35');
    assert.equal(quoteParas[0].blockquoteId, quoteParas[1].blockquoteId, 'both paragraphs belong to the same blockquote run');
    assert.equal(quoteParas[0].fromBlockquoteLines, undefined, 'this blockquote has no <line> — the general A40 case, not A35\'s');

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<blockquote/g) || []).length, 1, `both paragraphs stay inside one <blockquote>:\n${exportedXml}`);
    assert.match(exportedXml, /<blockquote>\s*<p>It is urgent<\/p>\s*<p>that you appoint[^<]*<\/p>\s*<\/blockquote>/, `blockquote content keeps source order and shape (no class in the source, none invented):\n${exportedXml}`);

    const doc2 = parseDtbook(exportedXml);
    const quoteParas2 = doc2.blocks.filter((b) => b.type === 'para' && b.style === 'quote');
    assert.equal(quoteParas2.length, 2, 'both paragraphs survive a full save -> reload round trip');
  });

  test('two separate, adjacent multi-paragraph <blockquote>s stay two, not merged into one', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <blockquote>
          <p>First quote, paragraph one.</p>
          <p>First quote, paragraph two.</p>
        </blockquote>
        <blockquote>
          <p>Second quote, paragraph one.</p>
          <p>Second quote, paragraph two.</p>
        </blockquote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const quoteParas = doc1.blocks.filter((b) => b.type === 'para' && b.style === 'quote');
    assert.equal(quoteParas.length, 4);
    assert.equal(quoteParas[0].blockquoteId, quoteParas[1].blockquoteId, 'first blockquote\'s two paragraphs share one id');
    assert.equal(quoteParas[2].blockquoteId, quoteParas[3].blockquoteId, 'second blockquote\'s two paragraphs share one id');
    assert.notEqual(quoteParas[1].blockquoteId, quoteParas[2].blockquoteId, 'the two blockquotes get different ids so they are not merged');

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<blockquote/g) || []).length, 2, `two separate <blockquote>s stay separate:\n${exportedXml}`);
  });

  test('a <blockquote class="…"> keeps the source class', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <blockquote class="letter">
          <p>Dear Sir,</p>
          <p>Yours faithfully,</p>
        </blockquote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const quoteParas = doc1.blocks.filter((b) => b.type === 'para' && b.style === 'quote');
    assert.equal(quoteParas.every((b) => b.blockquoteClass === 'letter'), true, 'the source class is kept on every block in the run');

    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<blockquote class="letter">\s*<p>Dear Sir,<\/p>\s*<p>Yours faithfully,<\/p>\s*<\/blockquote>/, `class kept, still one <blockquote>:\n${exportedXml}`);
  });

  test('a single-paragraph <blockquote> (the common case) is unaffected — still <blockquote class="quote"><p class="quote">', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <blockquote>
          <p>A single quoted paragraph, the common case.</p>
        </blockquote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc = parseDtbook(xml);
    const quotePara = doc.blocks.find((b) => b.type === 'para' && b.style === 'quote');
    assert.ok(quotePara);
    assert.equal(quotePara.blockquoteId, undefined, 'a single-paragraph blockquote is not routed through the multi-block run path');

    const exportedXml = exportToNimas(doc);
    assert.match(exportedXml, /<blockquote class="quote"><p class="quote">/, `unchanged from before this fix:\n${exportedXml}`);
  });
});

describe('A42: a bare <linegroup> (no <poem> around it) round-trips without gaining a <poem> wrapper', () => {
  test('a bare <linegroup> of <line>s (dontworrybehappy.xml shape) saves back as <linegroup>, not <poem>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h1>Introductio</h1>
        <linegroup>
          <line>Here is a little song I wrote</line>
          <line>Don't worry be happy</line>
        </linegroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const verseBlocks = doc1.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks.length, 2, 'both lines parsed');
    assert.ok(verseBlocks.every((b) => b.fromPoem), 'still tagged fromPoem — it is still poem-shaped verse');
    assert.ok(verseBlocks.every((b) => b.bareLinegroup === true), 'but tagged bareLinegroup — the source had no <poem> wrapper');

    const exportedXml = exportToNimas(doc1);
    assert.ok(exportedXml.includes('<linegroup>'), `exported XML should contain <linegroup>:\n${exportedXml}`);
    assert.equal(exportedXml.includes('<poem>'), false, `a bare linegroup must not gain a <poem> wrapper it never had:\n${exportedXml}`);
    assert.match(exportedXml, /<line[ >][^]*?Here is a little song I wrote/, 'line content survives');

    const doc2 = parseDtbook(exportedXml);
    const verseBlocks2 = doc2.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks2.length, 2, 'both lines survive a full save -> reload round trip');
  });

  test('a <poem> containing a <linegroup> still gets wrapped in <poem> (regression guard)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <poem>
          <linegroup>
            <line>Nature is what we see&#8212;</line>
            <line>The Hill&#8212;the Afternoon&#8212;</line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const verseBlocks = doc1.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks.every((b) => !b.bareLinegroup), true, 'a real <poem> source is not tagged bareLinegroup');

    const exportedXml = exportToNimas(doc1);
    assert.ok(exportedXml.includes('<poem>'), `a genuine <poem> keeps its wrapper:\n${exportedXml}`);
    assert.equal((exportedXml.match(/<poem>/g) || []).length, 1, 'exactly one <poem>');
  });

  test('two separate, adjacent bare <linegroup>s (no stanza-break between them) stay two, not merged into one', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <linegroup>
          <line>First linegroup, line one.</line>
        </linegroup>
        <linegroup>
          <line>Second linegroup, line one.</line>
        </linegroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const verseBlocks = doc1.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.equal(verseBlocks.length, 2);
    assert.notEqual(verseBlocks[0].bareLinegroupId, verseBlocks[1].bareLinegroupId, 'the two linegroups get different run ids so they are not merged');

    const exportedXml = exportToNimas(doc1);
    assert.equal((exportedXml.match(/<linegroup>/g) || []).length, 2, `two separate <linegroup>s stay separate:\n${exportedXml}`);
    assert.equal(exportedXml.includes('<poem>'), false, 'still no invented <poem> wrapper');
  });
});

describe('A41', () => {
  test('a dangling #id link (target not in the saved document) is unwrapped and its text is kept', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>See <a href="#missing">the missing target</a> for more.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.equal(exportedXml.includes('href="#missing"'), false, `a link to an id that is not in the saved document must drop its href:\n${exportedXml}`);
    assert.equal(exportedXml.includes('<a '), false, `no <a> at all should remain for a dangling internal link:\n${exportedXml}`);
    assert.ok(exportedXml.includes('the missing target'), 'the link text is kept');

    const doc2 = parseDtbook(exportedXml);
    const para2 = doc2.blocks.find((b) => b.type === 'para' || b.type === 'p');
    assert.ok(para2, 'the paragraph still round-trips');
    const stillHasHref = Array.isArray(para2.segments) && para2.segments.some((s) => s.href);
    assert.equal(stillHasHref, false, 'no segment carries a href after reload');
  });

  test('a link to an id that does exist in the document is kept', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>See <a href="#p5">page 5</a> for more.</p>
        <pagenum id="p5" page="normal">5</pagenum>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<a href="#p5">page 5<\/a>/, `a link to an id present in the saved document must be kept, byte-identical:\n${exportedXml}`);
    assert.ok(exportedXml.includes('<pagenum id="p5"'), 'the target pagenum survives, keeping its id');
  });

  test('an external https:// link is kept, regardless of any ids in the document', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>See <a href="https://example.org/">the example site</a> for more.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<a href="https:\/\/example\.org\/">the example site<\/a>/, `an external link is never touched by the dangling-#id check:\n${exportedXml}`);
  });

  test('a link whose target id appears later in the document is kept (forward reference)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>Jump to <a href="#pLater">page 9</a> now.</p>
        <p>Some text in between.</p>
        <pagenum id="pLater" page="normal">9</pagenum>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<a href="#pLater">page 9<\/a>/, `a forward reference to an id later in the document must be kept:\n${exportedXml}`);
    assert.ok(exportedXml.includes('<pagenum id="pLater"'), 'the later target pagenum is present');
  });
});

describe('A49: a table\'s caption stays paired with its table when a transcriber\'s note sits between them', () => {
  test('body-level table: caption is nested inside <table>, not written as a stray <imggroup><caption>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>Populations</h2>
        <table>
          <caption>Table 1: City populations</caption>
          <tabletn>Figures are rounded to the nearest hundred.</tabletn>
          <tr><th>City</th><th>Population</th></tr>
          <tr><td>Anytown</td><td>1,200</td></tr>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    // Sanity check on the parse side (F-3, already shipped, parse.mjs untouched by this fix):
    // the caption is pushed before the tabletn note, which is pushed before the table itself.
    const capIdx = doc1.blocks.findIndex((b) => b.type === 'caption');
    const noteIdx = doc1.blocks.findIndex((b) => b.type === 'note' && b.kind === 'tabletn');
    const tableIdx = doc1.blocks.findIndex((b) => b.type === 'table');
    assert.ok(capIdx !== -1 && noteIdx !== -1 && tableIdx !== -1, 'caption, tabletn note and table all parsed');
    assert.ok(capIdx < noteIdx && noteIdx < tableIdx, `parse order is caption, note, table:\n${JSON.stringify(doc1.blocks.map((b) => b.type))}`);

    const exportedXml = exportToNimas(doc1);
    assert.equal(exportedXml.includes('<imggroup>'), false, `the caption must not be exported as an orphan <imggroup><caption>:\n${exportedXml}`);
    assert.match(
      exportedXml,
      /<prodnote class="tabletn" render="required">Figures are rounded to the nearest hundred\.<\/prodnote>\s*<table>\s*<caption>Table 1: City populations<\/caption>/,
      `the note stays a sibling immediately before <table>, and the caption is <table>'s own first child (DTD: table (caption?, ...) has no room for a prodnote):\n${exportedXml}`
    );

    // On reparse, the tabletn note (now a plain sibling before <table>) and the caption (now
    // <table>'s own first child, read back as parseTable's usual leading caption block) both
    // survive — the caption is directly adjacent to its table again, so this is not a second
    // A49 case; it is simply DTD-forced reordering (see the top-level comment on
    // tableIndexForCaption): every table's caption always round-trips this way, note or not.
    // A49 (23 Sep): parse.mjs restores BANA 11.2.5f's own order on reparse — caption, then
    // the tabletn note, then the table — so a save and reload gives back exactly the block
    // order the source had, and the braille does not change under a round trip.
    const doc2 = parseDtbook(exportedXml);
    const table2Idx = doc2.blocks.findIndex((b) => b.type === 'table');
    assert.ok(table2Idx > 1, 'the table round-trips');
    assert.equal(doc2.blocks[table2Idx - 1]?.type, 'note', 'the tabletn note sits between the caption and its table, as in the source');
    assert.equal(doc2.blocks[table2Idx - 2]?.type, 'caption', 'the caption comes first, per BANA 11.2.5f');
    assert.equal(doc2.blocks[table2Idx - 2]?.text, 'Table 1: City populations');
    assert.ok(doc2.blocks.some((b) => b.type === 'note' && b.kind === 'tabletn' && b.text === 'Figures are rounded to the nearest hundred.'), 'the tabletn note also survives the round trip');
  });

  test('a table inside a sidebar keeps the same caption/note pairing (case \'box\'/\'sidebar\')', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar>
          <table>
            <caption>Table 2: Boxed data</caption>
            <tabletn>A note about the boxed table.</tabletn>
            <tr><th>Key</th><th>Value</th></tr>
            <tr><td>A</td><td>1</td></tr>
          </table>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.equal(exportedXml.includes('<imggroup>'), false, `the sidebar's table caption must not become an orphan <imggroup><caption>:\n${exportedXml}`);
    assert.match(
      exportedXml,
      /<prodnote class="tabletn" render="required">A note about the boxed table\.<\/prodnote>\s*<table>\s*<caption>Table 2: Boxed data<\/caption>/,
      `inside a sidebar, the note stays before <table> and the caption nests inside it, same as the body-level case:\n${exportedXml}`
    );
  });

  test('regression: a caption immediately followed by its table (no note) still pairs, unaffected', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <table>
          <caption>Table 3: No note here</caption>
          <tr><th>A</th></tr>
          <tr><td>1</td></tr>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.equal(exportedXml.includes('<imggroup>'), false);
    assert.match(exportedXml, /<table>\s*<caption>Table 3: No note here<\/caption>/, `unaffected direct-adjacency case:\n${exportedXml}`);
  });

  test('regression: a tabletn note with no caption still renders as a plain sibling before <table>, unaffected', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <table>
          <tabletn>A note with no caption above it.</tabletn>
          <tr><th>A</th></tr>
          <tr><td>1</td></tr>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.match(
      exportedXml,
      /<prodnote class="tabletn" render="required">A note with no caption above it\.<\/prodnote>\s*<table>/,
      `unaffected note-only case:\n${exportedXml}`
    );
  });
});

describe('A43: an Emboss-created transcriber\'s note defaults to render="required" (D6), not "optional"', () => {
  test('a hand-built note block with no source render value at all saves as required', () => {
    // D6: Emboss's own transcriber's notes save as render="required" by default — the DTD
    // treats this as essential content, and BANA §3 says a transcriber's note is always
    // brailled. A note built directly by Emboss (never read from an imported source at all,
    // so it carries no render value of its own) must get this default, not the old
    // "optional" fallback.
    const doc = { blocks: [{ type: 'note', text: 'A transcriber note Emboss created.' }] };
    const xml = exportToNimasXml(doc);
    assert.match(xml, /<prodnote render="required">A transcriber note Emboss created\.<\/prodnote>/, `an Emboss-created note must default to required (D6):\n${xml}`);
  });

  test('a hand-built table-transcriber note (kind: tabletn) with no source render value also defaults to required', () => {
    const doc = { blocks: [{ type: 'note', kind: 'tabletn', text: 'A table note Emboss created.' }] };
    const xml = exportToNimasXml(doc);
    assert.match(xml, /<prodnote class="tabletn" render="required">A table note Emboss created\.<\/prodnote>/, `an Emboss-created tabletn note must also default to required:\n${xml}`);
  });

  test('an imported note whose source explicitly said render="required" still keeps required (A22, unaffected)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <prodnote render="required">Caution: hot surface.</prodnote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const doc1 = parseDtbook(xml);
    const exportedXml = exportToNimas(doc1);
    assert.match(exportedXml, /<prodnote render="required">Caution: hot surface\.<\/prodnote>/, `an imported render="required" note is unaffected by A43's new default:\n${exportedXml}`);
  });

  // Known limitation (found while fixing A43, not fixable within nimas-export.mjs alone):
  // parse.mjs only ever captures an imported prodnote's render value when the source says
  // "required" (see e.g. its `renderAttr === 'required' ? { ...,render:'required'} : {...}`
  // shape at every prodnote call site) — an imported note whose source explicitly says
  // render="optional", or omits the attribute, comes out of parseDtbook as
  // `{type:'note', text}` with no `.render` field at all: byte-for-byte the same shape as a
  // note Emboss creates itself with no source information. nimas-export.mjs's case 'note'
  // cannot tell these two apart, so A43's new required-by-default necessarily also applies
  // to this case (the block model must be able to record an explicit "optional" — capturing
  // `renderAttr === 'optional'` too, alongside the existing 'required' capture, at each of
  // parse.mjs's prodnote call sites — for that to change; parse.mjs is out of scope for this
  // task). case 'note' already honours an explicit block.render === 'optional' should
  // parse.mjs ever start setting one (forward-compatible, see nimas-export.mjs's case 'note').
  test('an imported note whose source said render="optional" keeps that value, and is not confused with an Emboss-created note (A22 + A43, both honoured since 23 Sep)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <prodnote render="optional">Imported, optional.</prodnote>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;
    const imported = parseDtbook(xml);
    assert.match(exportToNimas(imported), /<prodnote render="optional">Imported, optional\.<\/prodnote>/,
      "an imported note keeps its source's own value (A22)");

    const embossMade = { title: 'T', blocks: [{ type: 'note', text: 'Emboss wrote this.' }] };
    assert.match(exportToNimas(embossMade), /<prodnote render="required">Emboss wrote this\.<\/prodnote>/,
      'a note Emboss created, with no source value at all, takes D6\'s required (A43)');
  });
});
