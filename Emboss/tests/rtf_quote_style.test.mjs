// Import fix list #43 (found re-running the audit, 1 Oct 2026, r01-quote): an RTF paragraph in Word's Quote style (or
// Intense Quote, Block Text, LibreOffice's Quotations, or a style based on one of them) came in as an ordinary paragraph.
// The Word (.docx, .doc) and ODT readers make it a quotation paragraph ({ type: 'para', style: 'quote' }, BANA 9, K6);
// the RTF reader now does the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRtf } from '../input/parse.mjs';

const rtf = (body) => `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}{\\stylesheet{\\s0 Normal;}{\\s15\\sbasedon0 Quote;}{\\s16\\sbasedon15 My Quote;}{\\s17\\sbasedon0 Intense Quote;}{\\s18\\sbasedon0 Quotations;}{\\s19\\sbasedon0 Heading 2;}}
${body}}`;
const para = (s, t) => `\\pard\\plain\\s${s} ${t}\\par\n`;

test('#43: Quote, a style based on Quote, Intense Quote and Quotations are quotation paragraphs', () => {
  const m = parseRtf(rtf(para(0, 'Plain alphaplain.') + para(15, 'Quoted alphaquote.') + para(16, 'Based on quote alphabased.') + para(17, 'Intense alphaintense.') + para(18, 'LibreOffice alphalo.') + para(19, 'Heading alphahead')));
  const by = (w) => m.blocks.find((b) => JSON.stringify(b).includes(w));
  assert.equal(by('alphaplain').style, undefined);
  for (const w of ['alphaquote', 'alphabased', 'alphaintense', 'alphalo']) { assert.equal(by(w).type, 'para', w); assert.equal(by(w).style, 'quote', w); }
  assert.equal(by('alphahead').type, 'heading');
});

test('#43: formatting inside a quotation paragraph is kept', () => {
  const m = parseRtf(rtf(para(15, 'Quoted {\\b alphabold} text.')));
  const q = m.blocks.find((b) => JSON.stringify(b).includes('alphabold'));
  assert.equal(q.style, 'quote');
  assert.ok(q.segments.some((s) => s.text === 'alphabold' && (s.tf & 4)), JSON.stringify(q));
});
