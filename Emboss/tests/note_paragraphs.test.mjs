// F-164 / BANA 3.2.1a-b: a <prodnote> with several <p> is one transcriber's note of several
// paragraphs. Parse keeps them (note.blocks), export writes one <prodnote> with several <p>,
// the formatter opens @.< on the first and closes @.> on the last, and the editor's
// note-group run (note blocks sharing noteGroup + tnPart) formats and exports the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml, mergeNoteGroups } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const up = (s) => String(s).toUpperCase();
const opts = (mode) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);
const MULTI = '<prodnote render="required"><p>First paragraph of the note.</p><p>Second <em>paragraph</em> here.</p><p>Third.</p></prodnote>';
const notes = (d) => d.blocks.filter((b) => b.type === 'note');

test('parse: several <p> keep their boundaries; a single <p> is unchanged', () => {
  const [n] = notes(doc(MULTI));
  assert.equal(n.blocks.length, 3);
  assert.deepEqual(n.blocks.map((b) => b.text), ['First paragraph of the note.', 'Second paragraph here.', 'Third.']);
  assert.equal(n.render, 'required');
  assert.ok(n.blocks[1].segments, 'emphasis kept on the paragraph');
  const single = notes(doc('<prodnote render="required"><p>Only one.</p></prodnote>'))[0];
  assert.deepEqual(single, { type: 'note', text: 'Only one.', render: 'required' });
  const bare = notes(doc('<prodnote>Bare text.</prodnote>'))[0];
  assert.deepEqual(bare, { type: 'note', text: 'Bare text.' });
});

test('export: one <prodnote> with one <p> each, and parse -> export -> parse is stable', () => {
  const d1 = doc(MULTI);
  const xml = exportToNimasXml(d1);
  assert.equal((xml.match(/<prodnote/g) || []).length, 1);
  assert.match(xml, /<prodnote render="required"><p>First paragraph of the note\.<\/p><p>Second <em>paragraph<\/em> here\.<\/p><p>Third\.<\/p><\/prodnote>/);
  const d2 = doc(xml.slice(xml.indexOf('<prodnote'), xml.indexOf('</prodnote>') + 11));
  assert.deepEqual(notes(d2)[0], notes(d1)[0]);
  assert.equal(exportToNimasXml(d2).includes('<p>Third.</p></prodnote>'), true);
});

test('format: @.< on the first paragraph, @.> on the last, none between; trace mirrors format', () => {
  for (const mode of ['bana', 'ukaaf']) {
    const o = opts(mode);
    const [n] = notes(doc(MULTI));
    const lines = formatBlock(n, o);
    const flat = lines.join('\n');
    assert.equal(flat.split('@.<').length - 1, 1, mode);
    assert.equal(flat.split('@.>').length - 1, 1, mode);
    assert.ok(lines[0].trimStart().startsWith('@.<FIRST'), lines[0]);
    assert.ok(lines[lines.length - 1].trimEnd().endsWith('THIRD.@.>'), lines[lines.length - 1]);
    assert.ok(lines.some((l) => l.trimStart().startsWith('SECOND')), 'second paragraph starts its own line');
    assert.ok(lines.every((l) => l.trim() !== ''), 'no blank line inside the note (3.2.1c)');
    const tr = traceBlock(n, o);
    const tl = Object.values(tr).map((l) => l.s.replace(/\s+$/, ''));
    assert.deepEqual(tl, lines.map((x) => x.replace(/\s+$/, '')), mode);
  }
});

test('single-paragraph note formats exactly as before', () => {
  const [n] = notes(doc('<prodnote><p>Short note.</p></prodnote>'));
  assert.deepEqual(formatBlock(n, opts('bana')), ['      @.<SHORT NOTE.@.>']);
});

test('editor note-group run: tnPart formats like the multi-paragraph note, and folds back to one <prodnote>', () => {
  const [n] = notes(doc(MULTI));
  const o = opts('bana');
  const run = n.blocks.map((b, i) => ({ type: 'note', style: 'note', text: b.text, ...(b.segments ? { segments: b.segments } : {}), render: 'required', noteGroup: 7, tnPart: i === 0 ? 'first' : i === n.blocks.length - 1 ? 'last' : 'mid' }));
  const viaRun = run.flatMap((b) => formatBlock(b, o));
  assert.deepEqual(viaRun, formatBlock(n, o));
  const folded = mergeNoteGroups(run);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].blocks.length, 3);
  const xml = exportToNimasXml({ title: 't', blocks: run });
  assert.equal((xml.match(/<prodnote/g) || []).length, 1);
  assert.equal((xml.match(/<p>/g) || []).length, 3);
});
