// G8 stage 5: the Special Symbols page (block `sympage`, BANA 2.5.1-2.5.2, numbered in the t series 2.2.1b).
// Symbol names are the shape alone, without "bullet" (KD, round 2 Q7b, 28 Sep 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatVolumes, formatBlock, traceBlock, getBlockSignature } from '../format/document.mjs';

const translate = (t) => (t ? String(t).toUpperCase() : '');
const translatePos = (t) => { const b = translate(t); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(t).length - 1))) }; };
const bana = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos };
const ukaaf = { mode: 'ukaaf', width: 38, depth: 25, translate, translatePos };
const pagesOf = (brf) => brf.split('\x0c').map((p) => { const l = p.split('\r\n'); if (l[l.length - 1] === '') l.pop(); return l; });

const sp = (extra) => ({ type: 'sympage', matter: 'transcriber', ...extra });
const tn = () => ({ type: 'tnpage', matter: 'transcriber', entries: [{ text: 'The atlas is omitted.' }] });
const para = (t) => ({ type: 'para', text: t });
const nested = { type: 'list', kind: 'bullet', symbols: ['•', '◦', '▪'], items: [{ text: 'top', marker: '•' }, { text: 'sub', marker: '•', level: 1 }, { text: 'subsub', marker: '•', level: 2 }] };

test('explicit entries: centred heading, blank, then .=symbol meaning lines with 1-3 margins', () => {
  const b = sp({ entries: [{ braille: '', description: 'Dot locator, precedes listed symbols' }, { braille: '^1', description: 'Boldface word indicator, which is a rather long meaning that must wrap onto a runover line' }] });
  const lines = formatBlock(b, bana, true);
  assert.equal(lines[0].trim() + ' ' + lines[1].trim(), 'SPECIAL SYMBOLS USED IN THIS VOLUME'.replace(/ USED/, ' USED'));  // two-line centred heading
  assert.ok(lines[0].startsWith(' ') && lines[1].startsWith(' '), 'heading centred');
  assert.equal(lines[2], '');
  assert.equal(lines[3], '.= DOT LOCATOR, PRECEDES LISTED SYMBOLS');
  assert.ok(lines[4].startsWith('.=^1 BOLDFACE WORD'));
  assert.ok(lines[5].startsWith('  ') && !lines[5].startsWith('   '), 'runover at cell 3');
  assert.ok(lines.every((l) => l.length <= 40));
});

test('auto entries come from a nested-bullet list: dot locator first, primary bullet excluded, braille order', () => {
  const doc = { title: null, blocks: [sp({ auto: true }), nested] };
  const pages = pagesOf(formatDocument(doc, { ...bana, nestedBullets: true }));
  const p = pages[0].join('\n');
  assert.match(p, /\.= DOT LOCATOR, PRECEDES LISTED SYMBOLS/);
  assert.match(p, /\.=;\$= HOLLOW CIRCLE/);
  assert.match(p, /\.=_\$#D SOLID SQUARE/);
  assert.ok(!/\.=_4/.test(p), 'primary bullet not listed');
  assert.ok(p.indexOf('.= DOT LOCATOR') < p.indexOf('.=;$=') , 'dot locator first');
  assert.ok(p.indexOf('.=_$#D') < p.indexOf('.=;$='), 'braille order (dots 456 sign _ sorts before dots 56 sign ;)');
});

test('an explicit entries array wins over auto; an untouched page (no entries) regenerates', () => {
  const kept = formatDocument({ title: null, blocks: [sp({ auto: true, entries: [{ braille: '^7', description: 'Mine' }] }), nested] }, { ...bana, nestedBullets: true });
  assert.match(kept, /\.=\^7 MINE/);
  assert.ok(!/HOLLOW CIRCLE/.test(kept));
  const regen = formatDocument({ title: null, blocks: [sp({}), nested] }, { ...bana, nestedBullets: true });
  assert.match(regen, /HOLLOW CIRCLE/);
});

test('empty: no symbols and auto gives no page, no forced break, no t number', () => {
  const doc = { title: null, blocks: [para('One.'), sp({ auto: true }), para('Two.')] };
  const pages = pagesOf(formatDocument(doc, bana));
  assert.equal(pages.length, 1);
  assert.ok(!/T#/.test(pages[0].join('\n')));
  assert.equal(formatDocument({ title: null, blocks: [para('One.'), para('Two.')] }, bana), formatDocument(doc, bana));
});

test('own page, t number, body then starts at #A', () => {
  const doc = { title: null, blocks: [sp({ entries: [{ braille: '^1', description: 'Boldface' }] }), para('Body text.')] };
  const pages = pagesOf(formatDocument(doc, bana));
  assert.equal(pages.length, 2);
  assert.match(pages[0][0], /SPECIAL/);
  assert.match(pages[0][pages[0].length - 1], /T#A$/);
  assert.match(pages[1].join('\n'), /BODY TEXT/);
  assert.match(pages[1][pages[1].length - 1], /#A$/);
  assert.equal(pagesOf(formatDocument(doc, ukaaf)).length, 2);   // UKAAF uses the same page
});

test('order: the Special Symbols page comes before the Transcriber\'s Notes page even if authored after it', () => {
  const s = sp({ entries: [{ braille: '^1', description: 'Boldface' }] });
  for (const blocks of [[s, tn(), para('Body.')], [tn(), s, para('Body.')]]) {
    const pages = pagesOf(formatDocument({ title: null, blocks }, bana));
    assert.equal(pages.length, 3);
    assert.match(pages[0][0], /SPECIAL/);
    assert.match(pages[0][pages[0].length - 1], /T#A$/);
    assert.match(pages[1][0], /TRANSCRIBER.S NOTES/);
    assert.match(pages[1][pages[1].length - 1], /T#B$/);
  }
});

// KD round 2 Q7d (28 Sep 2026): BANA repeats the Special Symbols page in EVERY volume (2.5.1 "symbols
// found in the volume"), not volume 1 only as before this answer. A hand-edited (explicit `entries`,
// non-auto) page like this one cannot be split by volume, so it repeats VERBATIM in every volume.
test('multi-volume: a hand-edited Special Symbols page repeats verbatim in every volume', () => {
  const body = Array.from({ length: 60 }, (_, i) => para(`Paragraph ${i} of the body text that fills the pages of the volume nicely.`));
  const vols = formatVolumes({ title: 'T', blocks: [sp({ entries: [{ braille: '^1', description: 'Boldface' }] }), ...body] }, { ...bana, volumePages: 2 });
  assert.ok(vols.length > 1);
  for (const v of vols) {
    assert.match(v.brf, /SPECIAL/, `volume ${v.volume} carries its own Special Symbols page`);
    assert.match(v.brf, /BOLDFACE/, `volume ${v.volume}'s page repeats the same hand-authored entry`);
  }
});

test('A39 parity: traceBlock emits the same lines as formatBlock', () => {
  const cases = [
    sp({ entries: [{ braille: '', description: 'Dot locator, precedes listed symbols' }, { braille: '^1', description: 'A long meaning that goes over several lines of the braille page so wrapping is exercised' }, { braille: ';$=' }] }),
    sp({ heading: 'A VERY LONG CUSTOM HEADING FOR THE SPECIAL SYMBOLS PAGE OF THIS BOOK', entries: [{ braille: '^7', description: 'X' }] }),
    sp({ dormant: true }),
  ];
  for (const width of [40, 30]) for (const b of cases) {
    const o = { ...bana, width };
    assert.deepEqual(traceBlock(b, o, true).map((t) => t.s), formatBlock(b, o, true));
  }
});

test('getBlockSignature: entries and heading are part of the cache key', () => {
  const a = getBlockSignature(sp({ entries: [{ braille: '^1', description: 'One' }] }), bana, true);
  assert.notEqual(a, getBlockSignature(sp({ entries: [{ braille: '^1', description: 'Two' }] }), bana, true));
  assert.notEqual(a, getBlockSignature(sp({ heading: 'X', entries: [{ braille: '^1', description: 'One' }] }), bana, true));
  assert.equal(a, getBlockSignature(sp({ entries: [{ braille: '^1', description: 'One' }] }), bana, true));
});

test('a document without a sympage is unchanged (UKAAF and BANA)', () => {
  const doc = { title: 'X', blocks: [para('One.'), nested, para('Two.')] };
  for (const o of [bana, ukaaf]) assert.equal(formatDocument(doc, o), formatDocument({ ...doc, blocks: [...doc.blocks] }, o));
});
