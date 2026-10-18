// Import fix list #51 (found by the .doc agent, 1 Oct 2026): a Word legacy form field — a check box (FORMCHECKBOX) or a
// drop-down (FORMDROPDOWN) — has no result text; Word draws it from the field's w:ffData (ECMA-376 17.16.17 checkBox:
// w:checked, else w:default; 17.16.9 ddList: w:result, else w:default, an index into the w:listEntry items). The .docx reader
// read nothing for it; the .doc reader now gives "[x]" / "[ ]" and the selected item (D15), as the HTML reader writes a
// check box and a <select>. A text field (FORMTEXT) keeps its result text as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDocx } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const r = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const field = (ffData, instr, result = '') => `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="F"/><w:enabled/>${ffData}</w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const box = (inner) => field(`<w:checkBox><w:sizeAuto/>${inner}</w:checkBox>`, 'FORMCHECKBOX');
const drop = (inner) => field(`<w:ddList>${inner}<w:listEntry w:val="Apple"/><w:listEntry w:val="Banana"/><w:listEntry w:val="Cherry"/></w:ddList>`, 'FORMDROPDOWN');
const docx = async (paras) => makeZip([{ name: 'word/document.xml', text: `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paras.map((p) => `<w:p>${p}</w:p>`).join('')}</w:body></w:document>` }]).arrayBuffer();
const flat = (b) => b.text ?? (b.segments || []).map((s) => s.text || '').join('');

test('#51: a check box is [x] when ticked and [ ] when not, where it stands; w:default applies when w:checked is absent', async () => {
  const m = await parseDocx(await docx([
    r('Before: ') + box('<w:checked/>') + r(' ticked then ') + box('') + r(' empty.'),
    box('<w:checked w:val="false"/><w:default w:val="1"/>') + r(' explicitly clear'),
    box('<w:default w:val="1"/>') + r(' default on'),
    box('<w:default w:val="0"/>') + r(' default off'),
  ]));
  assert.deepEqual(m.blocks.map(flat), ['Before: [x] ticked then [ ] empty.', '[ ] explicitly clear', '[x] default on', '[ ] default off']);
});

test('#51: a drop-down is its selected item (w:result, else w:default, else the first); a text field keeps its result', async () => {
  const m = await parseDocx(await docx([
    r('Fruit: ') + drop('<w:result w:val="1"/>') + r(' end.'),
    r('Default: ') + drop('<w:default w:val="2"/>') + r(' end.'),
    r('None: ') + drop('') + r(' end.'),
    r('Name: ') + field('<w:textInput/>', 'FORMTEXT', r('Typed answer')) + r(' done.'),
  ]));
  assert.deepEqual(m.blocks.map(flat), ['Fruit: Banana end.', 'Default: Cherry end.', 'None: Apple end.', 'Name: Typed answer done.']);
});
