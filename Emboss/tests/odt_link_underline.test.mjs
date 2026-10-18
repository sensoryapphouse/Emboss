// A79 (LINK-2, docs/decisions.md): ODT links carry their own underline. odtInlineSegments
// (input/parse.mjs) used to read a <text:a>'s href but never its OWN text:style-name — only a
// nested <text:span> inside the link was ever resolved for bold/italic/underline — so a real
// LibreOffice document, whose "Internet_20_link" character style IS the underline (styles.xml,
// style:text-underline-style="solid"), always fell through to LINK-1's transcriber-defined
// typeform, even for a print-underlined link. format/document.mjs's own decision on what to DO
// with an underlined link (UEB's ordinary underline indicator, no Special-Symbols entry) is
// already covered by tests/link_underline.test.mjs; this file only covers the ODT READER: does
// the link segment come out of odtInlineSegments with TYPEFORM.underline (tf bit 2) set.
//
// buildOdtStyleMap/resolveOdtStyleLinkUnderline (parse.mjs, new in this task) walk the link
// style's parent-style-name chain the same "nearest style that explicitly says either way wins"
// order the DOCX reader's charStyleLinkUnderline already uses for w:basedOn — proven here with a
// three-style chain (direct/inherited/overridden), not just a single flat style.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseOdt } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

const UL = 2; // engine/louis.mjs TYPEFORM.underline — confirmed against the compiled table in tests/link_underline.test.mjs; not re-confirmed here to avoid loading the wasm engine twice for a reader-only test.

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';

async function odtModel(automaticStylesXml, bodyXml, stylesXmlAutoStyles = null) {
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>${automaticStylesXml || ''}</office:automatic-styles><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`;
  const files = [{ name: 'content.xml', data: new TextEncoder().encode(content) }];
  if (stylesXmlAutoStyles) {
    const stylesXml = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>${stylesXmlAutoStyles}</office:styles></office:document-styles>`;
    files.push({ name: 'styles.xml', data: new TextEncoder().encode(stylesXml) });
  }
  return parseOdt(await makeZip(files).arrayBuffer());
}
function linkSeg(model) {
  const p = model.blocks.find((b) => b.type === 'para');
  return (p.segments || []).find((s) => s.href);
}

describe('ODT reader: a <text:a> carries its own style\'s underline onto the link segment (A79/LINK-2)', () => {
  test('link style with style:text-underline-style="solid" (LibreOffice\'s real "Internet_20_link" shape) -> underline tf bit set', async () => {
    const styles = '<style:style style:name="Internet_20_link" style:family="text"><style:text-properties fo:color="#000080" style:text-underline-style="solid" style:text-underline-color="font-color"/></style:style>';
    const body = '<text:p>before <text:a xlink:href="https://example.com" text:style-name="Internet_20_link">linked text</text:a> after</text:p>';
    const model = await odtModel(styles, body);
    const seg = linkSeg(model);
    assert.ok(seg, 'expected a segment with href');
    assert.equal(seg.href, 'https://example.com');
    assert.ok((seg.tf || 0) & UL, `expected underline tf bit on the link segment: ${JSON.stringify(seg)}`);
  });

  test('link with NO text:style-name at all keeps the transcriber-defined typeform (LINK-1 default, no underline bit)', async () => {
    const body = '<text:p>before <text:a xlink:href="https://example.com">linked text</text:a> after</text:p>';
    const model = await odtModel(null, body);
    const seg = linkSeg(model);
    assert.ok(seg);
    assert.ok(!((seg.tf || 0) & UL), `expected no underline tf bit: ${JSON.stringify(seg)}`);
  });

  test('link style with style:text-underline-style="none" (author removed the underline) stays plain', async () => {
    const styles = '<style:style style:name="NoUnderlineLink" style:family="text"><style:text-properties style:text-underline-style="none"/></style:style>';
    const body = '<text:p><text:a xlink:href="https://example.com" text:style-name="NoUnderlineLink">linked text</text:a></text:p>';
    const model = await odtModel(styles, body);
    const seg = linkSeg(model);
    assert.ok(seg);
    assert.ok(!((seg.tf || 0) & UL), `expected no underline tf bit: ${JSON.stringify(seg)}`);
  });

  test('link style inherits underline from its parent-style-name chain (own style says nothing about underline)', async () => {
    // Mirrors LibreOffice's real shape: a document-local automatic style with NO underline
    // properties of its own, parented to the underlined built-in style in styles.xml.
    const autoStyles = '<style:style style:name="WPS1" style:family="text" style:parent-style-name="Internet_20_link"><style:text-properties fo:color="#000080"/></style:style>';
    const builtIn = '<style:style style:name="Internet_20_link" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>';
    const body = '<text:p><text:a xlink:href="https://example.com" text:style-name="WPS1">linked text</text:a></text:p>';
    const model = await odtModel(autoStyles, body, builtIn);
    const seg = linkSeg(model);
    assert.ok(seg);
    assert.ok((seg.tf || 0) & UL, `expected underline tf bit inherited from parent style: ${JSON.stringify(seg)}`);
  });

  test('nearest style in the chain wins: a direct override of "none" beats an underlined parent', async () => {
    const autoStyles = '<style:style style:name="WPS2" style:family="text" style:parent-style-name="Internet_20_link"><style:text-properties style:text-underline-style="none"/></style:style>';
    const builtIn = '<style:style style:name="Internet_20_link" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>';
    const body = '<text:p><text:a xlink:href="https://example.com" text:style-name="WPS2">linked text</text:a></text:p>';
    const model = await odtModel(autoStyles, body, builtIn);
    const seg = linkSeg(model);
    assert.ok(seg);
    assert.ok(!((seg.tf || 0) & UL), `nearest override should win over the underlined parent: ${JSON.stringify(seg)}`);
  });

  test('a nested <text:span> inside a non-underlined link can still add its own underline (span-level tf untouched)', async () => {
    const styles = '<style:style style:name="EmphSpan" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>';
    const body = '<text:p><text:a xlink:href="https://example.com"><text:span text:style-name="EmphSpan">linked</text:span></text:a></text:p>';
    const model = await odtModel(styles, body);
    const seg = linkSeg(model);
    assert.ok(seg);
    assert.ok((seg.tf || 0) & UL, `expected the nested span's own underline to still apply: ${JSON.stringify(seg)}`);
  });

  // A separate bold+underline style on the LINK itself: only the underline crosses over onto
  // the segment; a bold/italic bit on the link's own character style is deliberately left alone
  // (format/document.mjs's groupSegments only branches on the underline bit for LINK-2 — see
  // tests/link_underline.test.mjs) rather than silently changing what the transcriber-defined
  // hyperlink wrap looks like when the link stays plain (non-underlined).
  test('bold + underlined link style: underline crosses over, bold does not', async () => {
    const styles = '<style:style style:name="BoldLink" style:family="text"><style:text-properties fo:font-weight="bold" style:text-underline-style="solid"/></style:style>';
    const body = '<text:p><text:a xlink:href="https://example.com" text:style-name="BoldLink">linked</text:a></text:p>';
    const model = await odtModel(styles, body);
    const seg = linkSeg(model);
    assert.ok(seg);
    const TF_BOLD = 4;
    assert.ok((seg.tf || 0) & UL, 'underline bit set');
    assert.ok(!((seg.tf || 0) & TF_BOLD), 'bold bit from the link\'s own style is NOT carried over (only underline is, per task scope)');
  });
});
