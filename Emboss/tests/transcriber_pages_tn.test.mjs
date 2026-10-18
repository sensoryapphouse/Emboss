// Transcriber pages, Stages 2 and 3 (Emboss/docs/transcriber-pages-plan.md §8): the forced page
// break for transcriber pages (BANA 2.2.1a) and the Transcriber's Notes page renderer (`tnpage`,
// BANA 2.6.1a-b, numbered in the t series 2.2.1b).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument, formatVolumes, formatBlock, traceBlock, getBlockSignature } from '../format/document.mjs';

const translate = (t) => (t ? String(t).toUpperCase() : '');
const translatePos = (t) => { const b = translate(t); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(t).length - 1))) }; };
const bana = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos };
const ukaaf = { mode: 'ukaaf', width: 38, depth: 25, translate, translatePos };
const pagesOf = (brf) => brf.split('\x0c').map((p) => { const l = p.split('\r\n'); if (l[l.length - 1] === '') l.pop(); return l; });
const GOLD = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'gold/bana-formats-2016/section-2/sample-2-21-transcribers-notes.json'), 'utf8'));

const tn = (entries) => ({ type: 'tnpage', matter: 'transcriber', entries: entries || [{ text: 'The atlas is omitted.' }] });
const para = (t) => ({ type: 'para', text: t });

test('Stage 2: a tnpage after ordinary content that leaves room still starts a new page, and the next block another', () => {
  const doc = { title: null, blocks: [para('Ordinary text.'), tn(), para('After the notes.')] };
  const pages = pagesOf(formatDocument(doc, bana));
  assert.equal(pages.length, 3);
  assert.equal(pages[0][0].trim(), 'ORDINARY TEXT.'.replace(/^/, '  ').trim());
  assert.match(pages[1][0], /TRANSCRIBER.S NOTES/);
  assert.match(pages[2][0], /AFTER THE NOTES/);
  assert.ok(!pages[1].some((l) => /AFTER THE NOTES|ORDINARY/.test(l)), 'the notes page holds only the notes');
  // UKAAF too (not BANA-only)
  assert.equal(pagesOf(formatDocument(doc, ukaaf)).length, 3);
});

test('Stage 2: a tnpage that already opens the document adds no blank page; a plain matter:transcriber block is forced too', () => {
  const first = pagesOf(formatDocument({ title: null, blocks: [tn(), para('Body.')] }, bana));
  assert.equal(first.length, 2);
  assert.match(first[0][0], /TRANSCRIBER.S NOTES/);
  const generic = pagesOf(formatDocument({ title: null, blocks: [para('A'), { type: 'para', text: 'Special.', matter: 'transcriber' }, para('C')] }, bana));
  assert.equal(generic.length, 3);
  assert.match(generic[1][0], /SPECIAL/);
  assert.match(generic[1][generic[1].length - 1], /T#A$/);
});

test('Ordinary documents are unchanged: no tnpage, no matter -> plain body numbering, no forced breaks', () => {
  const blocks = [para('One.'), para('Two.'), para('Three.')];
  const pages = pagesOf(formatDocument({ title: null, blocks }, bana));
  assert.equal(pages.length, 1);
  assert.match(pages[0][pages[0].length - 1], /^\s+#A$/);
});

test('Stage 3 (2.6.1a-b): centred heading on line 1, blank line, entries as 3-1 paragraphs with no TN indicators', async () => {
  const louis = await import('../engine/louis.mjs');
  await louis.init(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'liblouis', 'tables'));
  const real = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
  const o = { ...bana, translate: real, translatePos: undefined };
  const lines = formatBlock(tn([{ text: 'The atlas is omitted.' }, { text: 'Illustrations without captions are omitted, and this longer entry wraps over more than one line of the page.' }]), o, true);
  // heading and the one sentence BANA states in print form (2.6.1d) reproduce the gold's own lines (Sample 2-21)
  const gold = GOLD.braille.lines.map((l) => l.toLowerCase());
  assert.equal(lines[0].toLowerCase(), gold.find((l) => /transcrib/.test(l)));
  assert.equal(lines[1], '');
  assert.equal(lines[2].toLowerCase(), gold.find((l) => /atlas/.test(l)));
  assert.match(lines[3], /^ {2}\S/, 'each entry starts in cell 3');
  assert.ok(lines.slice(4).every((l) => /^\S/.test(l)), 'runover lines start in cell 1');
  assert.ok(!lines.slice(2).includes(''), '3-1 paragraphs have no blank line between them');
  assert.ok(!lines.join('\n').includes('@.<') && !lines.join('\n').includes('@.>'), 'no transcriber-note indicators (2.6.1b)');
});

test('Stage 3: entry paragraphs (F-164) and segments each become a 3-1 paragraph; empty entries are dropped', () => {
  const lines = formatBlock(tn([{ text: 'First.', paragraphs: [{ text: 'Second.' }, { segments: [{ type: 'text', text: 'Third ' }, { type: 'text', text: 'one.' }] }] }, { text: '   ' }]), bana, true);
  assert.deepEqual(lines.slice(2), ['  FIRST.', '  SECOND.', '  THIRD ONE.']);
  assert.deepEqual(formatBlock(tn([{ text: 'x' }]), { ...bana, width: 30 }, true)[0].trim(), 'TRANSCRIBER’S NOTES');
  assert.equal(formatBlock({ ...tn(), heading: 'NOTES' }, bana, true)[0].trim(), 'NOTES');
});

test('A39 parity: traceBlock emits the same lines as formatBlock for a tnpage', () => {
  const cases = [
    tn(),
    tn([{ text: 'A long entry that goes over several lines of the braille page so that the wrapping is exercised properly here.' }, { text: 'Second entry.', paragraphs: [{ text: 'Extra paragraph.' }] }]),
    tn([{ segments: [{ type: 'text', text: 'Segmented ' }, { type: 'text', text: 'entry.', tf: 1 }] }]),
    { ...tn(), heading: 'A VERY LONG CUSTOM HEADING FOR THE TRANSCRIBERS NOTES PAGE OF THIS BOOK' },
  ];
  for (const width of [40, 30]) for (const b of cases) {
    const o = { ...bana, width };
    assert.deepEqual(traceBlock(b, o, true).map((t) => t.s), formatBlock(b, o, true));
  }
});

test('getBlockSignature: entries and heading are part of the cache key', () => {
  const a = getBlockSignature(tn([{ text: 'One.' }]), bana, true);
  assert.notEqual(a, getBlockSignature(tn([{ text: 'Two.' }]), bana, true));
  assert.notEqual(a, getBlockSignature({ ...tn([{ text: 'One.' }]), heading: 'X' }, bana, true));
  assert.notEqual(a, getBlockSignature(tn([{ text: 'One.', paragraphs: [{ text: 'p' }] }]), bana, true));
  assert.equal(a, getBlockSignature(tn([{ text: 'One.' }]), bana, true));
});

test('Stage 3 (2.2.1b): the notes page is numbered t1, t2 ...; the book then starts at #A', () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ text: `Entry ${i} which is long enough to take a line or two of the page.` }));
  const doc = { title: null, blocks: [tn(long), { type: 'heading', level: 1, text: 'Chapter One' }, para('Body text.')] };
  const pages = pagesOf(formatDocument(doc, bana));
  const numbers = pages.map((p) => p[p.length - 1].trim());
  assert.deepEqual(numbers, ['T#A', 'T#B', 'T#C', '#A']);   // 30 entries fill three notes pages
  assert.match(pages[0][0], /TRANSCRIBER.S NOTES/);
  assert.ok(!pages[1].some((l) => /TRANSCRIBER.S NOTES/.test(l)), 'heading not repeated on later pages (2.6.1a)');
  assert.match(pages[3].join('\n'), /CHAPTER ONE/);
});

test('Stage 3: the generated contents page cites the body page number, not the position after the t pages', () => {
  const doc = { title: null, blocks: [tn(), { type: 'heading', level: 1, text: 'Chapter One' }, para('Body text.')] };
  const pages = pagesOf(formatDocument(doc, { ...bana, toc: true }));
  const toc = pages.find((p) => p.some((l) => /CHAPTER ONE/.test(l)) && p.some((l) => /CONTENTS/i.test(l)));
  assert.ok(toc, 'a contents page exists');
  assert.match(toc.find((l) => /CHAPTER ONE/.test(l)), /#A$/);
});

test('Stage 3: UKAAF puts the t number at the end of line 1; suppressed page furniture: no number', () => {
  const doc = { title: null, blocks: [tn(), para('Body.')] };
  const u = pagesOf(formatDocument(doc, ukaaf));
  assert.match(u[0][0], /T#A$/);
  assert.match(u[1][0], / #A$/);
  const bare = pagesOf(formatDocument(doc, { ...bana, suppressHeader: true }));
  assert.ok(!bare.flat().some((l) => /T#/.test(l)));
});

// KD round 2 Q7d (28 Sep 2026): the Transcriber's Notes page repeats in EVERY volume (2.6.1's own
// volume-scoped wording, "...throughout the volume"), not volume 1 only as before this answer — so
// volume 2's own title page (t1) is now followed by its OWN Notes page (t2) too, before its body restarts
// at braille page 1.
test('Multi-volume: the volume title page keeps t1; the notes page follows as t2 in EVERY volume; body restarts at 1 in each volume', () => {
  const blocks = [tn(), ...Array.from({ length: 120 }, (_, i) => para(`Paragraph ${i} with several words of ordinary running text to fill lines.`))];
  const vols = formatVolumes({ title: 'Book', blocks }, { ...bana, volumePages: 3 });
  assert.ok(vols.length >= 2);
  const v1 = pagesOf(vols[0].brf).map((p) => p[p.length - 1].trim());
  assert.deepEqual(v1.slice(0, 2), ['T#A', 'T#B']);
  assert.deepEqual(v1.slice(2), ['#A', '#B', '#C']);
  const v2 = pagesOf(vols[1].brf).map((p) => p[p.length - 1].trim());
  assert.deepEqual(v2.slice(0, 2), ['T#A', 'T#B']);
  assert.deepEqual(v2.slice(2), ['#A', '#B', '#C']);
});

test('Gold runner: the Sample 2-21 Transcriber\'s Notes component is not-representable with a specific reason; nothing else in 2-21 is reported as newly matching', async () => {
  process.env.GOLD_RUN_SECTION = 'section-2';
  const { loadSamples, runOne } = await import('../scripts/gold-run.mjs');
  const rows = loadSamples().filter((s) => s.sample.id.startsWith('sample-2-21'));
  assert.equal(rows.length, 6);
  const res = Object.fromEntries(rows.map(({ sample }) => [sample.id, runOne(sample)]));
  const t = res['sample-2-21-transcribers-notes'];
  assert.equal(t.status, 'not-representable');
  assert.match(JSON.stringify(t), /tnpage renderer/);
  assert.match(JSON.stringify(t), /no print wording/);
  for (const r of Object.values(res)) assert.notEqual(r.status, 'match');
});
