// Audit batch S2b, item 11 (ChatGPT audit 15 Oct 2026, Emboss/docs/chatgpt-audit-15oct.md): an equation MathCAT REJECTS (a non-empty
// MathML it cannot read, here a fraction with one child) used to come back from the maths wrapper as '' and the formatter treated that as
// "nothing to braille": the equation vanished from the braille with no warning. Now the wrapper throws a typed failure (mathRejected) for
// a rejected non-empty equation, and the formatter - inline in a paragraph and as a display block, in the one-pass and the async path
// alike - puts the existing transcriber's note "Equation could not be read" where the equation stood and raises a transcription warning
// (kind math-unreadable). A genuinely empty equation stays nothing.
//
// Real MathCAT throughout. The browser wrapper (engine/maths.mjs imports the WASM build from an absolute browser URL) is run in Node the way
// the audit did: its source with only the two bootstrap imports swapped for the Node build of the same MathCAT. The Node test helper
// (format/node-maths-helper.mjs, used by the parity check and the corpus) must follow the same contract for this case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatDocument, formatDocumentAsync } from '../format/document.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';
import { loadBrowserWrapper as loadBrowserWrapperShared } from './lib/browser-maths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const NS = 'xmlns="http://www.w3.org/1998/Math/MathML"';
const BAD = `<math ${NS}><mfrac><mn>1</mn></mfrac></math>`;          // MathCAT: "mfrac should have 2 children"
const GOOD = `<math ${NS}><mn>7</mn></math>`;
const EMPTY = `<math ${NS}><mrow/></math>`;

// ---- the browser wrapper, bootstrapped for Node: tests/lib/browser-maths.mjs (moved there for audit batch S5b, which shares it) ----
const loadBrowserWrapper = loadBrowserWrapperShared;

const up = (s) => String(s).toUpperCase();
const optsFor = (mode, mathToBrf) => ({
  mode, standard: mode, width: 40, depth: 25,
  translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
  mathToBrf,
});
const unreadable = (o) => (o.warnings || []).filter((w) => w.kind === 'math-unreadable');
const flat = (brf) => brf.replace(/[\r\n\f]/g, '');
const NOTE_CELLS = '@.<';          // the transcriber's-note opener (TN_OPEN), as save_reopen_empty_edge_tex.test.mjs checks it

const wrapper = await loadBrowserWrapper();
const impls = {
  'browser wrapper': (mode) => (seg) => wrapper.mathToBrf(seg, mode === 'bana' ? 'nemeth' : 'ueb'),
  'node helper': (mode) => makeMathToBrf(mode),
};

for (const [name, make] of Object.entries(impls)) {
  for (const mode of ['bana', 'ukaaf']) {
    test(`${name} [${mode}]: a rejected non-empty equation throws a typed failure, never returns ''`, () => {
      const f = make(mode);
      let err = null, out;
      try { out = f({ mathml: BAD }); } catch (e) { err = e; }
      assert.ok(err, `it threw (returned ${JSON.stringify(out)})`);
      assert.equal(err.mathRejected, true, 'the failure is marked mathRejected');
      assert.match(String(err.message), /mfrac|MathCAT|equation/i);
    });
    test(`${name} [${mode}]: a good equation is braille; a genuinely empty one is nothing and is not an error`, () => {
      const f = make(mode);
      assert.ok(f({ mathml: GOOD }).length > 0, 'a good equation is braille');
      assert.equal(f({ mathml: EMPTY }), '', 'an empty equation is nothing');   // both paths since audit batch S5b (the Node helper used to return a stray cell and was only required not to throw)
    });

    const formatters = { 'formatDocument': (m, o) => formatDocument(m, o), 'formatDocumentAsync': (m, o) => formatDocumentAsync(m, o) };
    for (const [fname, fmt] of Object.entries(formatters)) {
      test(`${name} [${mode}] ${fname}: a rejected DISPLAY equation keeps the text round it, shows the note and raises one warning`, async () => {
        const o = optsFor(mode, make(mode));
        const out = flat(await fmt({ title: null, blocks: [{ type: 'para', text: 'BEFORE' }, { type: 'math', mathml: BAD }, { type: 'para', text: 'AFTER' }] }, o));
        assert.ok(out.includes('BEFORE') && out.includes('AFTER'), 'surrounding text kept');
        assert.ok(out.includes(NOTE_CELLS), `the "equation could not be read" note stands for it: ${out}`);
        const w = unreadable(o);
        assert.equal(w.length, 1, `one warning: ${JSON.stringify(o.warnings)}`);
        assert.equal(w[0].blockIndex, 1);
        assert.match(w[0].message, /equation/i);
        assert.ok(!(o.warnings || []).some((x) => x.kind === 'block-skipped'), 'not reported as a skipped block as well');
      });
      test(`${name} [${mode}] ${fname}: a rejected INLINE equation keeps the paragraph, shows the note and raises one warning`, async () => {
        const o = optsFor(mode, make(mode));
        const para = { type: 'para', segments: [{ type: 'text', text: 'BEFORE ' }, { type: 'math', mathml: BAD }, { type: 'text', text: ' AFTER' }] };
        const out = flat(await fmt({ title: null, blocks: [para] }, o));
        assert.ok(out.includes('BEFORE') && out.includes('AFTER'), 'surrounding text kept');
        assert.ok(out.includes(NOTE_CELLS), `the note stands where the equation was: ${out}`);
        assert.equal(unreadable(o).length, 1, `one warning: ${JSON.stringify(o.warnings)}`);
      });
      test(`${name} [${mode}] ${fname}: two different rejected equations in one paragraph are two warnings; a good one is still braille`, async () => {
        const o = optsFor(mode, make(mode));
        const BAD2 = `<math ${NS}><mfrac><mn>2</mn></mfrac></math>`;
        const para = { type: 'para', segments: [{ type: 'text', text: 'A ' }, { type: 'math', mathml: BAD }, { type: 'text', text: ' B ' }, { type: 'math', mathml: GOOD }, { type: 'text', text: ' C ' }, { type: 'math', mathml: BAD2 }, { type: 'text', text: ' D' }] };
        const out = flat(await fmt({ title: null, blocks: [para] }, o));
        assert.equal(unreadable(o).length, 2, JSON.stringify(o.warnings));
        assert.equal(out.split(NOTE_CELLS).length - 1, 2, 'two notes');
        assert.ok(/A.*B.*C.*D/.test(out));
      });
      test(`${name} [${mode}] ${fname}: a genuinely empty equation is nothing and raises no warning`, async () => {
        const o = optsFor(mode, make(mode));
        const out = flat(await fmt({ title: null, blocks: [{ type: 'para', text: 'BEFORE' }, { type: 'math', mathml: EMPTY }, { type: 'para', text: 'AFTER' }] }, o));
        assert.ok(!out.includes(NOTE_CELLS));   // both paths since audit batch S5b
        assert.equal(unreadable(o).length, 0);
        assert.equal((o.warnings || []).filter((x) => x.kind === 'block-skipped').length, 0);
      });
    }
  }
}

test('the one-pass and the async formatter agree on the braille and the warnings for a rejected equation', async () => {
  const model = { title: null, blocks: [{ type: 'para', segments: [{ type: 'text', text: 'X ' }, { type: 'math', mathml: BAD }, { type: 'text', text: ' Y' }] }, { type: 'math', mathml: BAD }] };
  for (const mode of ['bana', 'ukaaf']) {
    const f = impls['browser wrapper'](mode);
    const o1 = optsFor(mode, f), o2 = optsFor(mode, f);
    const a = formatDocument(structuredClone(model), o1);
    const b = await formatDocumentAsync(structuredClone(model), o2);
    assert.equal(a, b, `${mode}: same braille`);
    assert.deepEqual(unreadable(o1).map((w) => [w.blockIndex, w.message]), unreadable(o2).map((w) => [w.blockIndex, w.message]), `${mode}: same warnings`);
    assert.equal(unreadable(o1).length, 2, `${mode}: one warning per equation`);
  }
});

test('an engine that is not ready (a plain error, not a rejection) is still a skipped equation with the old warning', () => {
  const o = optsFor('ukaaf', () => { throw new Error('maths engine not initialised'); });
  const out = flat(formatDocument({ title: null, blocks: [{ type: 'para', text: 'BEFORE' }, { type: 'math', mathml: GOOD }, { type: 'para', text: 'AFTER' }] }, o));
  assert.ok(out.includes('BEFORE') && out.includes('AFTER'));
  assert.ok((o.warnings || []).some((w) => w.kind === 'block-skipped'), JSON.stringify(o.warnings));
});
