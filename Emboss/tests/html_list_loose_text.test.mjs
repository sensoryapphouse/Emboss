// Import fix list #46 (audit h03-loose, 1 Oct 2026): text written straight inside an HTML <ul>/<ol>, between its items
// (invalid HTML, but browsers show it, at the list's indentation with no bullet), was dropped. It is now kept as an item with
// no marker of its own, in its place, as the DTBook reader keeps loose text in a <list> (A2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml, parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

test('#46: loose text between list items is an unmarked item, in its place; whitespace alone adds nothing', () => {
  const list = parseHtml('<ul><li>alphatext</li>loose text alphaloose<li>alphaafterloose</li>\n  </ul>').blocks.find((b) => b.type === 'list');
  assert.deepEqual(list.items, [{ text: 'alphatext', marker: '•' }, { text: 'loose text alphaloose' }, { text: 'alphaafterloose', marker: '•' }]);
});

test('#46: in a numbered list the loose text takes no number and the count goes on', () => {
  const list = parseHtml('<ol><li>one</li>between<li>two</li></ol>').blocks.find((b) => b.type === 'list');
  assert.deepEqual(list.items, [{ text: 'one', marker: '1.' }, { text: 'between' }, { text: 'two', marker: '2.' }]);
});

test('#46: saved and reopened, the loose text is still an unmarked item (class="bana-no-marker"), not a new bullet', () => {
  for (const h of ['<ul><li>alphatext</li>loose text alphaloose<li>alphaafterloose</li></ul>', '<ul><li>a<ul><li>b</li>loose<li>c</li></ul></li></ul>']) {
    const m = parseHtml(h);
    const back = parseDtbook(exportToNimasXml(structuredClone(m)));
    assert.deepEqual(back.blocks.find((b) => b.type === 'list').items, m.blocks.find((b) => b.type === 'list').items, h);
  }
});
