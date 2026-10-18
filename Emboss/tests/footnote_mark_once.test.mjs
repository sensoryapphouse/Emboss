// Found 1 Oct 2026 by the eBraille agent, fixed the same day (Paul: fix before the deploy): a NIMAS footnote whose own text begins
// with its number set as a superscript (<note><p><sup>1</sup> hydrography: …</p></note>, the 9780544087507 book) got its reference
// mark twice — ;9#A;9#A — in the BRF and eBraille. BANA 16.5.1 / 16.2.1: the note begins with the same reference mark used in the
// text, once. noteBodyStartsWithMark compared the raw text, whose first character is the superscript marker, so it did not see
// that the body already starts with the mark and the formatter added it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument } from '../format/document.mjs';
import { styledTranslate, SCRIPT_MARKS } from '../format/text-style.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));
const translate = styledTranslate((t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null), 'faithful');
const { supOpen, end } = SCRIPT_MARKS;
const doc = (lead) => ({ title: null, blocks: [
  { type: 'para', segments: [{ type: 'text', text: 'Naval hydrography' }, { type: 'noteref', text: '1', idref: 'n1' }, { type: 'text', text: ' studies.' }] },
  { type: 'footnote', id: 'n1', segments: [{ type: 'text', text: lead }, { type: 'text', text: 'hydrography: the study of water.' }] },
] });
const noteLine = (brf) => brf.split(/\r?\n/).find((l) => /HYDROGRAPHY3/.test(l)) || '';

for (const mode of ['bana', 'ukaaf']) {
  test(`${mode}: a note that begins with its superscript number has the mark once`, () => {
    const brf = formatDocument(doc(`${supOpen}1${end} `), { mode, width: 40, depth: 25, translate, suppressHeader: true });
    const line = noteLine(brf);
    assert.ok(line, brf);
    assert.equal((line.match(/;9#A/g) || []).length, 1, line);
    assert.doesNotMatch(line, /;9#A;9#A/);
  });
  test(`${mode}: a note without its number still gets the mark, once`, () => {
    const line = noteLine(formatDocument(doc(''), { mode, width: 40, depth: 25, translate, suppressHeader: true }));
    assert.equal((line.match(/;9#A/g) || []).length, 1, line);
  });
}

// A89 (random-action testing, seed 614743370, WebKit and Firefox): a note whose own number "1" had been made italic in the editor
// got the mark added again (;9#A.2#A4 …) while the caret stood in it — the editor keeps an empty piece of text where the caret is,
// so the note's first run was "" (or a space) and the check saw no number — but not after a save and reopen. The leading runs are read together.
const noteDoc = (segments) => ({ title: null, blocks: [
  { type: 'para', segments: [{ type: 'text', text: 'Naval hydrography' }, { type: 'noteref', text: '1', idref: 'n1' }, { type: 'text', text: ' studies.' }] },
  { type: 'footnote', id: 'n1', segments },
] });
for (const mode of ['bana', 'ukaaf']) {
  test(`${mode}: an empty run before a note's own number does not add the mark again`, () => {
    const fmt = (segs) => noteLine(formatDocument(noteDoc(segs), { mode, width: 40, depth: 25, translate, suppressHeader: true }));
    const body = [{ type: 'text', text: '1', tf: 1 }, { type: 'text', text: '. hydrography: the study of water.' }];
    assert.equal(fmt([{ type: 'text', text: '' }, ...body]), fmt(body));
    assert.equal(fmt([{ type: 'text', text: '' }, { type: 'text', text: '' }, ...body]), fmt(body));
    // …and a space before it, in a run of its own (the replay's own note: " " then italic "1")
    assert.equal((fmt([{ type: 'text', text: ' ' }, ...body]).match(/;9#A/g) || []).length, 0, fmt([{ type: 'text', text: ' ' }, ...body]));
  });
}

// A89 (the nightly random-action run, seed 1763563818, Firefox): an empty footnote (its text deleted in the editor) brailled a note
// separation line with nothing under it, in BANA; a save drops the empty note, so the reopened braille differed. An empty note is
// left out of the braille, as a save leaves it out.
for (const mode of ['bana', 'ukaaf']) {
  test(`${mode}: an empty footnote adds no separation line or blank line`, () => {
    const body = [{ type: 'para', segments: [{ type: 'text', text: 'With.' }, { type: 'noteref', text: '1', idref: 'n1' }] }, { type: 'para', text: 'The next paragraph.' }];
    const f = (blocks) => formatDocument({ title: null, blocks }, { mode, width: 40, depth: 25, translate, suppressHeader: true });
    assert.equal(f([...body, { type: 'footnote', id: 'n1', text: '' }]), f(body));
    assert.equal(f([...body, { type: 'footnote', id: 'n1', text: '', segments: [{ type: 'text', text: ' ' }] }]), f(body));
  });
}
