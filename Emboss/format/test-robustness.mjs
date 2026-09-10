import path from "path"; import { fileURLToPath } from "url"; const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Robustness/hardening gate: the pipeline must never throw uncaught on
// edge/malformed input. Covers: empty document, empty paragraph, a heading
// with no text, a list with one item (and a list with none/malformed
// items), a very long word exceeding the line width, an unknown block type,
// malformed/null blocks, malformed/empty text-family inputs (txt/md/rtf),
// degenerate geometry (depth<=1, width<=0), and non-braille characters
// (emoji, CJK, zero-width, control chars). See BUILD_LOG / the QA session
// report for how each was found.
//
// Usage: node format/test-robustness.mjs

import * as louis from '../engine/louis.mjs';
import { formatDocument } from './document.mjs';
import { wrapCells } from './layout.mjs';
import { assemble } from './page.mjs';
import { parseText, parseMarkdown, parseRtf } from '../input/parse.mjs';

import fs from 'fs';
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let failures = 0;
function check(name, fn) {
  try {
    const result = fn();
    console.log(`  PASS: ${name}` + (result !== undefined ? ` (${result})` : ''));
  } catch (e) {
    failures++;
    console.log(`  FAIL: ${name} — threw: ${e.constructor.name}: ${e.message}`);
  }
}

// Wrap an async check (awaits the timeout race below in the caller).
async function checkTimed(name, fn, timeoutMs = 2000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms (possible infinite loop)`)), timeoutMs));
  try {
    const result = await Promise.race([Promise.resolve().then(fn), timeout]);
    console.log(`  PASS: ${name}` + (result !== undefined ? ` (${result})` : ''));
  } catch (e) {
    failures++;
    console.log(`  FAIL: ${name} — ${e.message}`);
  }
}

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const translate = (t) => louis.translate(t, louis.TABLES.uebG2);
  const opts = { mode: 'ukaaf', width: 38, depth: 25, translate };

  console.log('--- format/document.mjs: formatDocument edge cases ---');
  check('empty document (null blocks)', () => { formatDocument({ title: null }, opts); return 'ok'; });
  check('empty document (empty blocks array)', () => { formatDocument({ title: null, blocks: [] }, opts); return 'ok'; });
  check('null doc', () => { formatDocument(null, opts); return 'ok'; });
  check('empty paragraph', () => {
    const brf = formatDocument({ title: null, blocks: [{ type: 'para', text: '' }] }, opts);
    return `len=${brf.length}`;
  });
  check('paragraph with undefined text', () => {
    formatDocument({ title: null, blocks: [{ type: 'para' }] }, opts); return 'ok';
  });
  check('heading with no text', () => {
    const brf = formatDocument({ title: null, blocks: [{ type: 'heading', level: 1, text: '' }] }, opts);
    return `len=${brf.length}`;
  });
  check('heading with undefined text', () => {
    formatDocument({ title: null, blocks: [{ type: 'heading', level: 2 }] }, opts); return 'ok';
  });
  check('title with undefined text', () => {
    formatDocument({ title: null, blocks: [{ type: 'title' }] }, opts); return 'ok';
  });
  check('list with one item', () => {
    const brf = formatDocument({ title: null, blocks: [{ type: 'list', items: [{ text: 'one item' }] }] }, opts);
    return `len=${brf.length}`;
  });
  check('list with no items array', () => {
    formatDocument({ title: null, blocks: [{ type: 'list' }] }, opts); return 'ok';
  });
  check('list with empty items array', () => {
    formatDocument({ title: null, blocks: [{ type: 'list', items: [] }] }, opts); return 'ok';
  });
  check('list with a null item', () => {
    formatDocument({ title: null, blocks: [{ type: 'list', items: [null, { text: 'ok' }] }] }, opts); return 'ok';
  });
  check('a very long word exceeding the line width', () => {
    const longWord = 'x'.repeat(200);
    const brf = formatDocument({ title: null, blocks: [{ type: 'para', text: longWord }] }, opts);
    const lines = brf.split('\r\n');
    return `longest line=${Math.max(...lines.map((l) => l.length))} cells`;
  });
  check('unknown block type', () => {
    const brf = formatDocument({ title: null, blocks: [{ type: 'frobnicate', text: 'text' }] }, opts);
    return `len=${brf.length}`;
  });
  check('null block in blocks array', () => {
    formatDocument({ title: null, blocks: [null, { type: 'para', text: 'ok' }] }, opts); return 'ok';
  });
  check('undefined block in blocks array', () => {
    formatDocument({ title: null, blocks: [undefined, { type: 'para', text: 'ok' }] }, opts); return 'ok';
  });
  check('non-object block (string) in blocks array', () => {
    formatDocument({ title: null, blocks: ['not a block'] }, opts); return 'ok';
  });
  check('math block with no mathToBrf configured', () => {
    formatDocument({ title: null, blocks: [{ type: 'math', mathml: '<math/>' }] }, { ...opts, mathToBrf: undefined });
    return 'ok';
  });
  check('math block with a mathToBrf that throws', () => {
    formatDocument({ title: null, blocks: [{ type: 'math', mathml: '<math/>' }] },
      { ...opts, mathToBrf: () => { throw new Error('boom'); } });
    return 'ok';
  });
  check('math block with missing mathml', () => {
    formatDocument({ title: null, blocks: [{ type: 'math' }] }, { ...opts, mathToBrf: (m) => m }); return 'ok';
  });
  check('non-braille characters (emoji, CJK, zero-width, control chars)', () => {
    const text = 'emoji \u{1F600} chinese 中文 zerowidth ​‌ control  end';
    const brf = formatDocument({ title: null, blocks: [{ type: 'para', text }] }, opts);
    return `len=${brf.length}`;
  });

  console.log('\n--- format/page.mjs: degenerate geometry ---');
  await checkTimed('depth = 1 (would otherwise infinite-loop)', () => {
    assemble(['a', 'b', 'c'], { width: 38, depth: 1, mode: 'ukaaf', translate });
    return 'ok';
  });
  await checkTimed('depth = 0', () => {
    assemble(['a'], { width: 38, depth: 0, mode: 'ukaaf', translate });
    return 'ok';
  });
  await checkTimed('depth = -5', () => {
    assemble(['a'], { width: 38, depth: -5, mode: 'ukaaf', translate });
    return 'ok';
  });
  check('width = 0', () => { wrapCells('HELLO WORLD', 0, 0, 0); return 'ok'; });
  check('width = -5', () => { wrapCells('HELLO WORLD', -5, 0, 0); return 'ok'; });
  check('assemble with empty content', () => { assemble([], { width: 38, depth: 25, mode: 'ukaaf', translate }); return 'ok'; });

  console.log('\n--- input/parse.mjs: malformed/empty text-family input ---');
  check('parseText(null)', () => JSON.stringify(parseText(null)));
  check('parseText(undefined)', () => JSON.stringify(parseText(undefined)));
  check('parseText("")', () => JSON.stringify(parseText('')));
  check('parseText(whitespace only)', () => JSON.stringify(parseText('   \n\n   ')));
  check('parseMarkdown(null)', () => JSON.stringify(parseMarkdown(null)));
  check('parseMarkdown("")', () => JSON.stringify(parseMarkdown('')));
  check('parseRtf(null)', () => JSON.stringify(parseRtf(null)));
  check('parseRtf("")', () => JSON.stringify(parseRtf('')));
  check('parseRtf(malformed/truncated control words)', () => JSON.stringify(parseRtf('{\\rtf1\\ansi{\\fonttbl')));
  check('parseRtf(very-negative \\uN — was RangeError)', () => JSON.stringify(parseRtf('{\\rtf1 \\u-70000 x}')));
  check('parseRtf(large positive \\uN)', () => JSON.stringify(parseRtf('{\\rtf1 \\u999999999 x}')));
  check('parseMarkdown(raw NUL placeholder collision — must not inject "undefined")', () => {
    const r = JSON.stringify(parseMarkdown('a \x0099\x00 b'));
    if (/undefined/.test(r)) throw new Error('injected literal "undefined": ' + r);
    return r;
  });

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} — robustness gate`);
  process.exit(failures === 0 ? 0 : 1);
})();
