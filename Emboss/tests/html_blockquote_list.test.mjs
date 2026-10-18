// Import fix list #50 (found by the save -> reopen braille test, h06-web-page-css.html): a list inside an HTML <blockquote> is
// displayed material (BANA 9.1.2: "Lists within displayed material ... must use adjusted margins"). The DTBook reader marks such
// a list displayed (K6); the HTML reader marked only headings, so the braille of the list changed once the file was saved and
// reopened. Now both readers mark it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml } from '../input/parse.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

test('#50: a list inside a blockquote (directly or in a <div>) is displayed; a list outside is not', () => {
  const m = parseHtml('<blockquote><p>Quoted.</p><ul><li>in one</li></ul><div><ol><li>in two</li></ol></div></blockquote><ul><li>outside</li></ul>');
  const lists = m.blocks.filter((b) => b.type === 'list');
  assert.deepEqual(lists.map((l) => [l.items[0].text, !!l.displayed]), [['in one', true], ['in two', true], ['outside', false]]);
});
