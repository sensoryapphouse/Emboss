// F-213: an untranslatable print character never leaks a liblouis hex escape (BANA 17.5.1) - full cell + o.untranslatable record.
// F-237: a print blank space for an omitted word (segment `blank:true`) -> three dot 5s (BANA 10.6.1).
// F-36 (8.8.2 part): a list item with no text and `blank:true` (skeleton-outline blank) -> marker + three dot 5s.
// Every field is optional; without it output is unchanged. formatBlock and traceBlock agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatBlock, traceBlock, getBlockSignature, untranslatableNoteText } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const mk = () => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true });
const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const fmt = (b, o = mk()) => clean(formatBlock(b, o));
const trc = (b, o = mk()) => clean(traceBlock(b, o).map((t) => t.s));
const both = (b, o = mk()) => { const a = fmt(b, o); assert.deepEqual(trc(b, o), a, 'traceBlock differs from formatBlock'); return a; };
const T = (text, extra = {}) => ({ type: 'text', text, ...extra });

// ICON-1 (Paul, 28 Sep 2026): in BANA mode ★ and ✏ (like any other character liblouis has no
// braille cell for) now become their own transcriber-defined print symbols instead of the full
// cell — see Emboss/tests/print_icons.test.mjs for that behaviour. These F-213 tests are about the
// underlying "never leak a raw hex escape" / full-cell / o.untranslatable mechanism itself, which
// still applies unchanged in UKAAF (UK-8: no Special Symbols page there) — forced here by using
// UKAAF mode so the assertions below keep exercising exactly what they always have.
const mkUkaaf = () => ({ ...mk(), mode: 'ukaaf', standard: 'ukaaf' });
test('F-213: an untranslatable icon becomes a full cell, never a hex escape; recorded (UKAAF)', () => {
  const o = mkUkaaf();
  const out = both({ type: 'para', text: 'a ★ b and ✏.' }, o);
  const joined = out.join('\n');
  assert.ok(!/\\X|\\x/i.test(joined), joined);
  assert.ok(joined.includes('='), joined);
  assert.deepEqual(o.untranslatable.map((e) => e.codePoint).sort(), [0x2605, 0x270F]);
  assert.match(untranslatableNoteText(o.untranslatable), /Untranslatable print symbols: U\+2605, U\+270F/);
  // list marker and translatePos path
  const l = both({ type: 'list', items: [{ marker: '★', text: 'one' }] }, mkUkaaf());
  assert.ok(!/\\X/i.test(l.join('\n')));
  const r = (() => { const oo = mkUkaaf(); formatBlock({ type: 'para', text: 'x' }, oo); return oo.translatePos('a ★ b'); })();
  assert.ok(!/\\X/i.test(r.braille)); assert.equal(r.braille.length, r.inputPos.length);
});

test('F-213: translatable text is byte-identical', () => {
  const o = mk();
  const t = 'Hello, world! It is a fine day: 12 apples ½ and café.';
  assert.deepEqual(fmt({ type: 'para', text: t }, o), clean(formatBlock({ type: 'para', text: t }, { ...mk() })));
  assert.equal(o.untranslatable, undefined);
});

test('F-237: a blank segment is three dot 5s between the words (10.6.1)', () => {
  const p = (blank) => ({ type: 'para', segments: [T('It is '), ...(blank ? [{ type: 'text', text: '', blank: true }] : []), T(" o'clock.")] });
  assert.match(both(p(true))[0], /IS """ O'CLOCK4$/);
  assert.doesNotMatch(both(p(false))[0], /"""/);   // no field, no dot 5s
  assert.notEqual(getBlockSignature(p(true), mk(), false), getBlockSignature(p(false), mk(), false));
});

test('F-36 (8.8.2): a blank outline division is three dot 5s after its marker', () => {
  const list = (blank) => ({ type: 'list', items: [{ marker: 'I.', text: 'Fruit' }, { marker: 'A.', text: '', ...(blank ? { blank: true } : {}) }] });
  const out = both(list(true));
  assert.ok(out.some((l) => /^#?.*"""$/.test(l) && l.includes('"""')), out.join('\n'));
  assert.ok(out.some((l) => l.startsWith(',a4 """') || /^,A4 """$/i.test(l) || / """$/.test(l)), out.join('\n'));
  assert.ok(!both(list(false)).join('\n').includes('"""'));
  assert.notEqual(getBlockSignature(list(true), mk(), false), getBlockSignature(list(false), mk(), false));
});

test('F-213: formatDocument hands the untranslatable list back on the caller options (UKAAF — ICON-1, 28 Sep 2026: BANA now makes ★ a transcriber-defined symbol instead, see print_icons.test.mjs)', async () => {
  const { formatDocument } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
  const o = mkUkaaf();
  const brf = formatDocument({ title: null, blocks: [{ type: 'para', text: 'A ★ star.' }] }, o);
  assert.ok(!/\\X/i.test(brf));
  assert.deepEqual((o.untranslatable || []).map((e) => e.codePoint), [0x2605]);
});
