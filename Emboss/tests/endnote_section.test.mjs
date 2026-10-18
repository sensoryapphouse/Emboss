// IMP-W3 (Paul, 30 Sep 2026, Emboss/docs/decisions.md "Word import"; import fix list #25): endnotes follow BANA Formats
// 16.9.2-16.9.3 and 16.10.1a. Every Word / ODT / RTF / .doc endnote used to be brailled right after the paragraph that cites it,
// like a footnote (the reader puts it there, kind 'endnote'). Now the formatter collects them into an ENDNOTE SECTION:
//   16.9.2b  at the end of the book, divided by volume: each volume ends with the endnotes referenced in that volume;
//   16.9.3a  the section begins on a new braille page;
//   16.9.3b  the heading NOTES in transcriber's note indicators on line 1, when print has no heading for the section;
//   16.9.3c  1-3 margins for each endnote (and no blank line between notes, Sample 16-11);
//   B004 D   UKAAF: "Notes which appear at the end of the book may appear at the end of the relevant braille volume";
//            "Write endnotes in list format ... cell 1 ... runovers in cell 3"; the section is entered in the contents (a heading).
// An endnote section that print itself places (a "Notes" heading followed by endnotes, e.g. at the end of a chapter, 16.9.2a
// "Follow print") stays where it is. Footnotes are untouched. Nothing in the editor's block list changes (the collecting is
// done by the formatter, like noteLayout's footnote moving), so the print view and click-linking are unaffected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const { formatDocument, formatDocumentAsync, formatVolumes, formatVolumesAsync } = await import(process.env.DOCUMENT_MJS || '../format/document.mjs');
const { parseDtbook, parseRtf } = await import('../input/parse.mjs');
const { exportToNimasXml } = await import('../input/nimas-export.mjs');

const up = (s) => String(s || '').toUpperCase();
const translatePos = (s) => ({ braille: up(s), inputPos: Array.from(String(s), (_, i) => i) });
const bana = (extra) => ({ mode: 'bana', standard: 'bana', width: 30, depth: 12, translate: up, suppressHeader: true, ...extra });
const ukaaf = (extra) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 30, depth: 12, translate: up, suppressHeader: true, docEndMarker: false, ...extra });
const pagesOf = (brf) => brf.split('\f').map((p) => p.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')));
const nonBlank = (page) => page.filter((l) => l !== '');

const para = (text, ...refs) => ({ type: 'para', segments: [{ type: 'text', text }, ...refs.map((r) => ({ type: 'noteref', idref: r, text: r.replace(/\D+/g, '') }))] });
const endnote = (id, text) => ({ type: 'footnote', kind: 'endnote', id, text });
const footnote = (id, text) => ({ type: 'footnote', id, text });
// A Word-shaped document: each endnote sits right after the paragraph that cites it.
const wordDoc = () => ({ title: null, blocks: [
  para('Alpha paragraph.', 'n1'), endnote('n1', 'First endnote text that is long enough to need a second line.'),
  para('Beta paragraph.', 'n2'), endnote('n2', 'Second endnote.'),
  para('Gamma paragraph without a note.'),
] });

test('BANA: endnotes are collected at the end, on a new braille page, under NOTES in transcriber\'s note indicators, 1-3 margins, no blanks between', () => {
  const pages = pagesOf(formatDocument(wordDoc(), bana()));
  assert.equal(pages.length, 2, JSON.stringify(pages));
  const body = nonBlank(pages[0]).join('\n');
  assert.match(body, /ALPHA PARAGRAPH/);
  assert.match(body, /BETA PARAGRAPH/);
  assert.match(body, /GAMMA PARAGRAPH/);
  assert.doesNotMatch(body, /ENDNOTE/, 'no endnote text among the paragraphs');
  const sec = pages[1];
  assert.equal(sec[0], ' '.repeat(Math.floor((30 - 11) / 2)) + '@.<NOTES@.>', 'line 1: the heading NOTES in transcriber\'s note indicators (16.9.3b)');
  assert.equal(sec[1], '', 'a blank line under the heading');
  const notes = sec.slice(2).filter((l) => l !== '');
  assert.ok(notes[0].startsWith(';91FIRST ENDNOTE'), notes[0]);          // 16.2.1: the note opens with the reference mark used in the text
  assert.ok(/^ {2}\S/.test(notes[1]) && /^ {2}\S/.test(notes[2]), 'runovers in cell 3: ' + notes.slice(1, 3).join(' | '));
  assert.ok(notes[3].startsWith(';92SECOND ENDNOTE'), notes[3]);
  const secLines = sec.slice(2);
  const firstNote = secLines.findIndex((l) => l.startsWith(';91'));
  const lastNote = secLines.findIndex((l) => l.startsWith(';92'));
  assert.ok(secLines.slice(firstNote, lastNote + 1).every((l) => l !== ''), 'no blank line between the notes (Sample 16-11)');
});

test('BANA: a heading already printed for the section is not doubled (16.9.3b): "Notes" + endnotes at the end of the book stay as they are', () => {
  const d = { title: null, blocks: [
    para('Alpha paragraph.', 'n1'),
    { type: 'heading', level: 1, text: 'Notes' }, endnote('n1', 'First endnote.'), endnote('n2', 'Second endnote.'),
  ] };
  const brf = formatDocument(d, bana());
  assert.doesNotMatch(brf, /@\.<NOTES@\.>/, 'the print heading is used, none is added');
  assert.equal((brf.match(/NOTES/g) || []).length, 1, brf);
});

test('BANA: footnotes are exactly as before (separation line, end of the print page) - only endnotes move', () => {
  const d = { title: null, blocks: [
    para('Alpha paragraph.', 'f1', 'n1'), footnote('f1', 'A footnote.'), endnote('n1', 'An endnote.'),
    { type: 'pagenum', page: '2', text: '2' },
    para('Beta paragraph.'),
  ] };
  const l = pagesOf(formatDocument(d, bana())).map(nonBlank);
  const flat = l.flat().join('\n');
  assert.ok(flat.indexOf('"333333') > -1 && flat.indexOf('A FOOTNOTE') > flat.indexOf('"333333'), 'footnote keeps its separation line: ' + flat);
  assert.ok(flat.indexOf('A FOOTNOTE') < flat.indexOf('BETA PARAGRAPH'), 'the footnote is still before the next print page');
  assert.ok(flat.indexOf('AN ENDNOTE') > flat.indexOf('BETA PARAGRAPH'), 'the endnote is after the whole text');
  assert.match(l[l.length - 1][0], /NOTES/);
});

test('UKAAF: the same collecting - a new page, a Notes heading (an entry in the contents), list format: cell 1, runover cell 3', () => {
  const pages = pagesOf(formatDocument(wordDoc(), ukaaf({ toc: false })));
  const last = pages[pages.length - 1];
  const all = pages.map(nonBlank);
  assert.ok(!/ENDNOTE/.test(all.slice(0, -1).flat().join('\n')), 'no endnote text before the section');
  const lines = last.filter((l) => l !== '');
  assert.match(lines[0], /^\s*NOTES\s*$/i, 'heading: ' + lines[0]);
  const at = lines.findIndex((l) => l.includes('FIRST ENDNOTE'));
  assert.ok(lines[at].startsWith(';91FIRST ENDNOTE'), lines[at]);
  assert.ok(/^ {2}\S/.test(lines[at + 1]), 'runover cell 3: ' + lines[at + 1]);
  const second = lines.findIndex((l) => l.includes('SECOND ENDNOTE'));
  assert.equal(second, at + 3, 'no blank line between notes (the first note takes three lines)');
});

test('UKAAF: the Notes heading is listed in the contents', () => {
  const d = { title: 'Book', blocks: [{ type: 'heading', level: 1, text: 'Chapter One' }, ...wordDoc().blocks] };
  const brf = formatDocument(d, ukaaf({ toc: true, suppressHeader: false }));
  const first = brf.split('\f')[0];
  assert.match(first, /NOTES/i, first);
});

test('an endnote the text never cites is collected too; a document with no endnote is unchanged', () => {
  const d = { title: null, blocks: [para('Alpha.'), endnote('z9', 'Orphan note.'), para('Beta.')] };
  const pages = pagesOf(formatDocument(d, bana()));
  assert.equal(pages.length, 2);
  assert.match(nonBlank(pages[1]).join('\n'), /ORPHAN NOTE/);
  const plain = { title: null, blocks: [para('Alpha.'), footnote('f1', 'Foot.'), para('Beta.')] };
  assert.equal(pagesOf(formatDocument(plain, bana())).length, 1);
});

test('the editor path (formatDocumentAsync with translatePos) gives the identical braille, and the section lines are linked to their endnote blocks', async () => {
  const d = wordDoc();
  const plain = formatDocument(d, bana());
  const trace = {};
  const traced = await formatDocumentAsync(d, bana({ translatePos, trace }));
  assert.equal(traced, plain);
  const last = pagesOf(traced).length;
  const rows = trace.rows || trace.trace?.rows;
  assert.ok(Array.isArray(rows) && rows.length, 'row map present');
  const inSection = new Set(rows.slice(rows.length - 12).filter((x) => x >= 0));
  assert.ok(inSection.has(1) && inSection.has(3), 'the notes\' rows map to the endnote blocks (indices 1 and 3): ' + [...inSection]);
  assert.equal(last, 2);
});

test('a saved NIMAS file keeps each endnote as an endnote, and reopening gives the same braille', () => {
  const d = wordDoc();
  const before = formatDocument(d, bana());
  const xml = exportToNimasXml(d);
  assert.equal((xml.match(/class="endnote"/g) || []).length, 2, 'both endnotes saved as <note class="endnote">');
  const again = parseDtbook(xml);
  assert.equal(formatDocument({ title: again.title, blocks: again.blocks }, bana()), before);
  assert.equal(formatDocument({ title: again.title, blocks: again.blocks }, ukaaf()), formatDocument(d, ukaaf()));
});

// ---- volumes: 16.9.2b ----
const longPara = (label, ...refs) => para(`${label} ${'text '.repeat(120)}`, ...refs);
function volumeDoc() {
  return { title: null, blocks: [
    longPara('One', 'n1'), endnote('n1', 'Note for volume one.'),
    longPara('Two', 'n2'), endnote('n2', 'Another for volume one.'),
    longPara('Three', 'n3'), endnote('n3', 'Note for the later volume.'),
    longPara('Four', 'n4'), endnote('n4', 'Last note.'),
  ] };
}

test('volumes: each volume ends with the endnotes referenced in it; the section begins on a new page; braille pages run on', () => {
  const o = bana({ volumePages: 6 });
  const vols = formatVolumes(volumeDoc(), o);
  assert.ok(vols.length >= 2, `volumes: ${vols.length}`);
  const text = vols.map((v) => v.brf);
  const seen = [];
  vols.forEach((v, i) => {
    const pages = pagesOf(v.brf);
    const n = pages.length;
    const last = pages[n - 1];
    const secStart = pages.findIndex((p) => p.some((l) => l.includes('@.<NOTES@.>')));
    assert.ok(secStart > 0, `volume ${i + 1} has a NOTES section on a page of its own: ${JSON.stringify(pages.map((p) => p[0]))}`);
    const secText = pages.slice(secStart).flat().join('\n');
    const mine = ['n1', 'n2', 'n3', 'n4'].map((id, k) => ['NOTE FOR VOLUME ONE', 'ANOTHER FOR VOLUME ONE', 'NOTE FOR THE LATER VOLUME', 'LAST NOTE'][k]).filter((t) => secText.includes(t));
    seen.push(mine);
    const bodyText = pages.slice(0, secStart).flat().join('\n');
    assert.ok(!/NOTE FOR VOLUME ONE|ANOTHER FOR VOLUME ONE|NOTE FOR THE LATER VOLUME|LAST NOTE/.test(bodyText), 'no endnote among the body pages');
    assert.ok(last.length > 0);
  });
  assert.deepEqual(seen.flat().sort(), ['ANOTHER FOR VOLUME ONE', 'LAST NOTE', 'NOTE FOR THE LATER VOLUME', 'NOTE FOR VOLUME ONE'], 'every note appears exactly once, in some volume: ' + JSON.stringify(seen));
  // a note sits in the volume whose text holds its reference: paragraphs One and Two (and the marks ;91 ;92) are in volume 1; the
  // reference of the long paragraph Three lies at its end, in volume 2, together with Four.
  const sec = (v) => { const pages = pagesOf(vols[v].brf); return pages.slice(pages.findIndex((p) => p.some((l) => l.includes('@.<NOTES@.>')))).flat().join('\n'); };
  assert.match(sec(0), /;91NOTE FOR VOLUME ONE/, 'each note opens with its reference mark (16.2.1)'); assert.match(sec(0), /;92ANOTHER FOR VOLUME ONE/);
  assert.doesNotMatch(sec(0), /LAST NOTE|NOTE FOR THE LATER VOLUME/);
  assert.match(sec(1), /NOTE FOR THE LATER VOLUME/); assert.match(sec(1), /LAST NOTE/);
  assert.doesNotMatch(sec(1), /VOLUME ONE/);
  // the volume size is kept: body pages + the section's pages fit volumePages
  vols.forEach((v) => assert.ok(pagesOf(v.brf).length - 1 <= 6, 'pages in volume (less its title page): ' + (pagesOf(v.brf).length - 1)));
});

test('volumes, UKAAF: the same split; the document end marker only after the last volume\'s section', () => {
  const vols = formatVolumes(volumeDoc(), ukaaf({ volumePages: 6, docEndMarker: true }));
  assert.equal(vols.length, 2);
  const tail = (v) => pagesOf(vols[v].brf).pop().filter((l) => l !== '');
  assert.match(tail(0)[0], /NOTES/i); assert.match(tail(0).join('\n'), /;91NOTE FOR VOLUME ONE/);
  assert.ok(!tail(0).some((l) => /^\s*"3+$/.test(l)), 'no end marker after volume 1');
  assert.match(tail(1).join('\n'), /;94LAST NOTE/);
  assert.ok(tail(1).some((l) => /^\s*"3+$/.test(l)), 'the end marker closes the last volume');
});

test('volumes: the async/editor path gives the same volumes', async () => {
  const o = () => bana({ volumePages: 6 });
  const a = formatVolumes(volumeDoc(), o());
  const b = await formatVolumesAsync(volumeDoc(), { ...o(), translatePos });
  assert.deepEqual(b.map((v) => v.brf), a.map((v) => v.brf));
});

test('volumes: a book that fits one volume has the one section at its end', () => {
  const vols = formatVolumes(wordDoc(), bana({ volumePages: 50 }));
  assert.equal(vols.length, 1);
  assert.match(vols[0].brf, /@\.<NOTES@\.>/);
});

// ---- the readers mark endnotes (kind 'endnote'); the formatter does the collecting ----
test('RTF: a footnote group with \\ftnalt is an endnote (RTF spec: "Indicates an endnote"), a plain \\footnote stays a footnote', () => {
  const rtf = '{\\rtf1\\ansi{\\pard First{\\super\\chftn{\\footnote\\ftnalt \\pard\\plain {\\super\\chftn} An endnote.}}\\par}'
    + '{\\pard Second{\\super\\chftn{\\footnote \\pard\\plain {\\super\\chftn} A footnote.}}\\par}}';
  const m = parseRtf(rtf);
  const notes = m.blocks.filter((b) => b.type === 'footnote');
  assert.deepEqual(notes.map((n) => n.kind || null), ['endnote', null], JSON.stringify(notes));
  const pages = pagesOf(formatDocument({ title: null, blocks: m.blocks }, bana()));
  assert.match(pages[pages.length - 1].join('\n'), /AN ENDNOTE/);
  assert.match(pages[0].join('\n'), /A FOOTNOTE/);
});
