// DTD validation gate for the NIMAS / DTBook 2005-3 exporter.
//
// Every document produced by exportToNimasXml must validate against the
// *official* DTBook 2005-3 DTD (vendored under references/dtd/) with the
// DAISY MathML-in-DTBook modular extension. Validation is performed with
// xmllint in two forms:
//   1. `--valid` + XML catalog: honours the document's own DOCTYPE and
//      internal subset (the real-world check).
//   2. `--dtdvalid references/dtd/dtbook-2005-3-mathml.dtd --path references/dtd`:
//      validates against the wrapper DTD (the form that ignores the internal
//      subset, so it proves the extension declarations are self-consistent).
// Tests are skipped with a clear message when xmllint is not installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml, escapeXml, toNCName, IdAllocator, normalizeMathMl } from '../input/nimas-export.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DTD_DIR = path.join(REPO_ROOT, 'references', 'dtd');
const DTD_FILE = path.join(DTD_DIR, 'dtbook-2005-3.dtd');
const WRAPPER_DTD = path.join(DTD_DIR, 'dtbook-2005-3-mathml.dtd');
const CATALOG_URL = pathToFileURL(path.join(DTD_DIR, 'catalog.xml')).href;
const SAMPLES_DIR = path.join(HERE, 'nimas_samples');

const xmllintProbe = spawnSync('xmllint', ['--version'], { encoding: 'utf8' });
const HAS_XMLLINT = !xmllintProbe.error && xmllintProbe.status === 0;
const SKIP_REASON = HAS_XMLLINT ? false : 'xmllint is not installed (install libxml2) — DTD validation skipped';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emboss-nimas-dtd-'));

function writeTmp(name, xml) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, xml, 'utf8');
  return file;
}

// libxml2 cannot resolve entities relative to a DTD whose path contains spaces,
// so DTD paths are passed relative to REPO_ROOT (the temp XML path is absolute).
const WRAPPER_DTD_REL = path.relative(REPO_ROOT, WRAPPER_DTD);
const DTD_DIR_REL = path.relative(REPO_ROOT, DTD_DIR);

function runXmllint(args) {
  return spawnSync('xmllint', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, XML_CATALOG_FILES: CATALOG_URL },
  });
}

/** Validates an XML string both ways; throws an assertion with xmllint's output on failure. */
function assertValid(xml, name) {
  assert.ok(fs.existsSync(DTD_FILE), `official DTD missing: ${DTD_FILE}`);
  assert.ok(fs.existsSync(WRAPPER_DTD), `wrapper DTD missing: ${WRAPPER_DTD}`);
  const file = writeTmp(`${name}.xml`, xml);

  const viaDoctype = runXmllint(['--noout', '--nonet', '--valid', file]);
  assert.equal(
    viaDoctype.status,
    0,
    `xmllint --valid (catalog) rejected ${name}:\n${(viaDoctype.stderr || '').split('\n').slice(0, 25).join('\n')}`,
  );

  const viaDtd = runXmllint(['--noout', '--nonet', '--dtdvalid', WRAPPER_DTD_REL, '--path', DTD_DIR_REL, file]);
  assert.equal(
    viaDtd.status,
    0,
    `xmllint --dtdvalid ${path.relative(REPO_ROOT, WRAPPER_DTD)} rejected ${name}:\n${(viaDtd.stderr || '').split('\n').slice(0, 25).join('\n')}`,
  );
  return { file, viaDoctype, viaDtd };
}

const TACTILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><title>Right triangle</title><polygon points="10,50 90,50 90,10" fill="none" stroke="#000" stroke-width="2"/></svg>';

/** A model exercising every structure the exporter maps. */
function representativeModel() {
  return {
    title: 'Grade 9 Geometry — Validation Fixture',
    metadata: {
      uid: 'emboss-dtd-fixture-001',
      lang: 'en-US',
      author: 'A. Transcriber',
      creator: 'A. Transcriber',
      identifier: 'urn:isbn:9780000000001',
      language: 'en-US',
      publisher: 'Example Press',
      source: 'Print edition, 2024',
      rights: 'Copyright 2024 Example Press',
      nimas: { 'nimas-SourceEdition': '2nd', 'nimas-SourceDate': '2024' },
    },
    blocks: [
      { type: 'heading', level: 1, text: 'Chapter 1: Triangles' },
      { type: 'pagenum', page: '1' },
      {
        type: 'para',
        text: 'A triangle has three sides.',
        segments: [
          { text: 'A ' },
          { text: 'triangle', tf: 4 },
          { text: ' has ' },
          { text: 'three', tf: 1 },
          { text: ' sides (control char stripped).' },
        ],
      },
      { type: 'heading', level: 2, text: 'Kinds of triangle' },
      {
        type: 'list',
        ordered: false,
        items: [
          { text: 'Equilateral' },
          { text: 'All sides equal', level: 2 },
          { text: 'Isosceles' },
          { text: 'Two sides equal', level: 2 },
        ],
      },
      { type: 'heading', level: 3, text: 'Measurements' },
      { type: 'caption', text: 'Table 1.1: Side lengths' },
      {
        type: 'table',
        headers: ['Triangle', 'a', 'b', 'c'],
        rows: [['T1', '3', '4', '5'], ['T2', '5', '12', '13']],
        tabletn: 'Columns give the three side lengths.',
      },
      { type: 'heading', level: 4, text: 'Did you know?' },
      {
        type: 'box',
        id: 'sb-1',
        blocks: [
          { type: 'heading', level: 2, text: 'Pythagoras' },
          { type: 'para', text: 'The theorem is over 2,500 years old.' },
          { type: 'caption', text: 'Figure S1: Bust of Pythagoras' },
        ],
      },
      { type: 'note', text: 'Transcriber note: diagrams follow the text.' },
      { type: 'footnote', text: 'See the appendix for proofs.' },
      {
        type: 'para',
        text: 'Inline math: a^2 + b^2 = c^2.',
        segments: [
          { text: 'Inline math: ' },
          {
            type: 'math',
            latex: 'a^2 + b^2 = c^2',
            mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup><mo>=</mo><msup><mi>c</mi><mn>2</mn></msup></mrow></math>',
          },
          { text: '.' },
        ],
      },
      {
        type: 'math',
        latex: 'c = \\sqrt{a^2 + b^2}',
        mathml: '<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML" id="1 bad id"><mml:semantics><mml:annotation encoding="application/x-tex">c = \\sqrt{a^2 + b^2}</mml:annotation></mml:semantics></mml:math>',
      },
      { type: 'graphic', alt: 'Right triangle with legs a and b and hypotenuse c', svg: TACTILE_SVG },
      { type: 'graphic', src: 'images/fig2.png', alt: 'Isosceles triangle' },
      { type: 'caption', text: 'Figure 1.2: A loose figure caption' },
      { type: 'quote', text: 'Geometry is knowledge of the eternally existent.' },
      { type: 'list', kind: 'glossary', items: [{ term: 'Hypotenuse', def: 'The side opposite the right angle.' }] },
      { type: 'pagenum', page: 'ii' },
    ],
  };
}

test('representative model exports to DTBook 2005-3 that validates against the official DTD', { skip: SKIP_REASON }, () => {
  const model = representativeModel();
  const xml = exportToNimasXml(model);

  // Structural expectations that the DTD fixes forced.
  assert.ok(!xml.includes('<tabletn'), 'never emits the non-existent <tabletn> element');
  assert.ok(!xml.includes('<!ELEMENT'), 'no home-grown element declarations in the internal subset');
  assert.ok(xml.includes('<!ENTITY % externalFlow "| m:math">'), 'uses the DAISY MathML-in-DTBook extension');
  assert.ok(xml.includes('<sidebar id="sb-1" render="required">'), 'sidebar render is always present');
  assert.ok(xml.includes('<prodnote render="optional" class="tabletn">'), 'table TN is a prodnote with render');
  assert.ok(xml.includes('<docauthor>A. Transcriber</docauthor>'));
  assert.ok(xml.includes('<meta name="dc:Creator" content="A. Transcriber" />'));
  assert.ok(xml.includes('<meta name="dc:Identifier" content="urn:isbn:9780000000001" />'));
  assert.ok(xml.includes('<meta name="nimas-SourceEdition" content="2nd" />'));
  assert.ok(xml.includes('<p><m:math'), 'block math is wrapped in <p>');
  assert.ok(xml.includes('display="block"'), 'block math carries display="block"');
  assert.ok(xml.includes('<m:msup><m:mi>a</m:mi>'), 'unprefixed MathML is normalised to the m: prefix');
  assert.ok(!xml.includes('<mml:'), 'mml: prefix is normalised away');
  assert.ok(xml.includes('id="id_1_bad_id"'), 'MathML ids are coerced to NCNames');
  assert.ok(xml.includes('<imggroup><img src="data:image/svg+xml;base64,'), 'svg-only graphic is embedded as a data URI inside imggroup');
  assert.ok(xml.includes('<prodnote render="required">Right triangle with legs a and b and hypotenuse c</prodnote>'));
  assert.ok(xml.includes('<img src="images/fig2.png" alt="Isosceles triangle"/>'));
  assert.ok(xml.includes('<imggroup><caption>Figure 1.2: A loose figure caption</caption></imggroup>'), 'orphan caption is a figure caption');
  assert.ok(xml.includes('<imggroup><caption>Figure S1: Bust of Pythagoras</caption></imggroup>'), 'orphan caption inside sidebar is a figure caption');
  assert.ok(xml.includes('<caption>Table 1.1: Side lengths</caption>'), 'caption before a table becomes the table caption');
  assert.ok(!xml.includes(''), 'XML-illegal control characters are stripped');

  const { file, viaDoctype, viaDtd } = assertValid(xml, 'representative');
  console.log(`xmllint --valid ${path.basename(file)}: exit ${viaDoctype.status}${viaDoctype.stderr ? '\n' + viaDoctype.stderr : ' (no output)'}`);
  console.log(`xmllint --dtdvalid dtbook-2005-3-mathml.dtd ${path.basename(file)}: exit ${viaDtd.status}${viaDtd.stderr ? '\n' + viaDtd.stderr : ' (no output)'}`);
});

test('tactile graphic svg survives export -> parse (data URI decoded back to block.svg)', () => {
  const xml = exportToNimasXml(representativeModel());
  const round = parseDtbook(xml);
  const graphic = round.blocks.find((b) => b.type === 'graphic' && b.svg);
  assert.ok(graphic, 'a graphic block with svg was restored');
  assert.equal(graphic.svg, TACTILE_SVG);
  assert.equal(graphic.alt, 'Right triangle with legs a and b and hypotenuse c');
  assert.ok(graphic.src.startsWith('data:image/svg+xml;base64,'));
  // The plain <img> keeps its src and gains no svg.
  const plain = round.blocks.find((b) => b.type === 'graphic' && b.src === 'images/fig2.png');
  assert.ok(plain && !plain.svg);
  // Loose captions come back as caption blocks (not paragraphs).
  assert.ok(round.blocks.some((b) => b.type === 'caption' && b.text === 'Figure 1.2: A loose figure caption'));
  const box = round.blocks.find((b) => b.type === 'box');
  assert.ok(box && box.blocks.some((b) => b.type === 'caption' && b.text === 'Figure S1: Bust of Pythagoras'));
});

test('metadata round-trips: dtb:uid, xml:lang and Dublin Core survive parse -> export', () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3" xml:lang="en-GB">
  <head>
    <meta name="dtb:uid" content="TPB-C00000"/>
    <meta name="dc:Title" content="Sample"/>
    <meta name="dc:Creator" content="B. Author"/>
    <meta name="dc:Identifier" content="C00000"/>
    <meta name="dc:Language" content="en-GB"/>
    <meta name="dc:Source" content="ISBN 1-2345-6789-0"/>
    <meta name="dc:Rights" content="Public domain"/>
    <meta name="dc:Format" content="ANSI/NISO Z39.86-2005"/>
    <meta name="nimas-SourceEdition" content="3"/>
  </head>
  <book><bodymatter><level1><h1>One</h1><p>Text.</p></level1></bodymatter></book>
</dtbook>`;
  const model = parseDtbook(src);
  assert.equal(model.metadata.uid, 'TPB-C00000');
  assert.equal(model.metadata.lang, 'en-GB');
  assert.equal(model.metadata.creator, 'B. Author');
  assert.equal(model.metadata.identifier, 'C00000');
  assert.equal(model.metadata.language, 'en-GB');
  assert.equal(model.metadata.source, 'ISBN 1-2345-6789-0');
  assert.equal(model.metadata.rights, 'Public domain');
  assert.deepEqual(model.metadata.nimas, { 'nimas-SourceEdition': '3' });

  const xml = exportToNimasXml(model);
  assert.ok(xml.includes('xml:lang="en-GB"'));
  assert.ok(xml.includes('<meta name="dtb:uid" content="TPB-C00000" />'));
  assert.ok(xml.includes('<meta name="dc:Creator" content="B. Author" />'));
  assert.ok(xml.includes('<meta name="dc:Identifier" content="C00000" />'));
  assert.ok(xml.includes('<meta name="dc:Language" content="en-GB" />'));
  assert.ok(xml.includes('<meta name="dc:Source" content="ISBN 1-2345-6789-0" />'));
  assert.ok(xml.includes('<meta name="dc:Rights" content="Public domain" />'));
  assert.ok(xml.includes('<meta name="nimas-SourceEdition" content="3" />'));
});

for (const sample of ['NIMAS_valid_baseline.xml', 'hauy_history_valid.xml']) {
  test(`${sample} round-trips through parse -> export and validates against the official DTD`, { skip: SKIP_REASON }, () => {
    const srcPath = path.join(SAMPLES_DIR, sample);
    assert.ok(fs.existsSync(srcPath), `missing sample ${srcPath}`);
    const model = parseDtbook(fs.readFileSync(srcPath, 'utf8'));
    assert.ok(model.blocks.length > 0, 'sample parsed to a non-empty model');
    const xml = exportToNimasXml(model);
    const { viaDoctype, viaDtd } = assertValid(xml, sample.replace(/\.xml$/, '-roundtrip'));
    console.log(`xmllint --valid ${sample} (round-trip): exit ${viaDoctype.status}${viaDoctype.stderr ? '\n' + viaDoctype.stderr : ' (no output)'}`);
    console.log(`xmllint --dtdvalid ${sample} (round-trip): exit ${viaDtd.status}${viaDtd.stderr ? '\n' + viaDtd.stderr : ' (no output)'}`);
  });
}

test('escapeXml strips XML-illegal characters and lone surrogates from text and attribute values', () => {
  assert.equal(escapeXml('a bcdef'), 'abcdef');
  assert.equal(escapeXml('tab\tnl\ncr\r'), 'tab\tnl\ncr\r', 'TAB/LF/CR are legal and kept');
  assert.equal(escapeXml('x￾y￿z'), 'xyz');
  assert.equal(escapeXml('lone\uD800high'), 'lonehigh');
  assert.equal(escapeXml('lone\uDC00low'), 'lonelow');
  assert.equal(escapeXml('pair😀ok'), 'pair😀ok', 'valid surrogate pairs are kept');
  assert.equal(escapeXml('Tom & Jerry <friends> "forever"'), 'Tom &amp; Jerry &lt;friends&gt; &quot;forever&quot;');
});

test('IdAllocator sanitises ids to NCNames and honours ids registered from MathML', () => {
  assert.equal(toNCName('1 bad id'), 'id_1_bad_id');
  assert.equal(toNCName('L001.001.P001'), 'L001.001.P001');
  assert.equal(toNCName(''), 'id');
  const alloc = new IdAllocator();
  assert.equal(alloc.getId('note 1', 'note'), 'note_1');
  assert.equal(alloc.getId('note 1', 'note'), 'note_1-1');
  alloc.register('eq1');
  assert.equal(alloc.getId('eq1', 'id'), 'eq1-1');
  assert.equal(alloc.getId(null, 'p-42'), 'p-42');
});

test('normalizeMathMl anchors on any math prefix and never corrupts <mathml:math>', () => {
  const out = normalizeMathMl('<mathml:math xmlns:mathml="http://www.w3.org/1998/Math/MathML"><mathml:mi>x</mathml:mi></mathml:math>', 'x');
  assert.equal(out, '<m:math alttext="x" altimg="math.png"><m:mi>x</m:mi></m:math>');
  const kept = normalizeMathMl('<m:math altimg="eq.png" alttext="y" display="block"><m:mi>y</m:mi></m:math>');
  assert.equal(kept, '<m:math altimg="eq.png" alttext="y" display="block"><m:mi>y</m:mi></m:math>');
});

// Regression (found by saving from the real editor in Chrome): the editor's maths nodes
// carry presentation fragments with no <math> root, in paragraphs and list items. Those
// were written out bare (<mrow>, <mo>…) and failed the DTD by the thousand.
test('editor-style MathML fragments (no <math> root) are wrapped and validate', { skip: SKIP_REASON }, () => {
  assert.equal(
    normalizeMathMl('<mrow><mi>x</mi><mo>+</mo><mn>3</mn></mrow>', 'x+3'),
    '<m:math alttext="x+3" altimg="math.png"><m:mrow><m:mi>x</m:mi><m:mo>+</m:mo><m:mn>3</m:mn></m:mrow></m:math>',
  );
  assert.equal(normalizeMathMl('x + 3'), 'x + 3', 'plain text is not wrapped');
  const frag = (mathml, latex) => ({ type: 'math', mathml, latex });
  const xml = exportToNimasXml({
    title: 'Editor maths',
    blocks: [
      { type: 'heading', level: 1, text: 'Editor maths' },
      { type: 'para', segments: [{ type: 'text', text: 'We wrote ' }, frag('<mrow><mi>x</mi><mo>+</mo><mn>3</mn><mo>=</mo><mn>8</mn></mrow>', 'x+3=8'), { type: 'text', text: ' earlier.' }] },
      { type: 'list', items: [{ text: 'y', segments: [frag('<mi>y</mi>', 'y')] }, { text: 'plain item' }] },
      { type: 'math', mathml: '<mfrac><mn>1</mn><mn>2</mn></mfrac>', latex: '\\frac{1}{2}' },
    ],
  });
  assert.ok(!/<(mrow|mi|mo|mn|mfrac)\b/.test(xml), 'no unprefixed MathML elements');
  assertValid(xml, 'editor-math-fragments');
});
