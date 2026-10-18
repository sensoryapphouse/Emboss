// S5d: one editor model holding every block type buildModel() can give (editor.mjs nodeToBlocks / paraBlock), used by
// tests/s5d_exports.test.mjs and its round trips. Segments are the shapes nodeToRuns gives: tf is the liblouis bitmask
// (italic 1, underline 2, bold 4), a sub/superscript run is bracketed by U+E000/U+E001 .. U+E002 (format/text-style.mjs SCRIPT_MARKS).
import { createRequire } from 'node:module';
const temml = createRequire(import.meta.url)('temml');
export const latexToMathml = (latex) => temml.renderToString(latex, { throwOnError: false });
export const PNG_1PX = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAGklEQVR4nGO4o6FBFcQwatCoQaMGjRpEGQIA3r3CEG0ftIUAAAAASUVORK5CYII=', 'base64'));

const T = (text, extra = {}) => ({ type: 'text', text, ...extra });
const M = (latex) => ({ type: 'math', latex, mathml: latexToMathml(latex) });

export function richModel() {
  return {
    title: 'The Test Book',
    metadata: { creator: 'Ada Author', language: 'en-GB' },
    resources: [{ path: 'images/pic1.png', mime: 'image/png', bytes: PNG_1PX }],
    blocks: [
      { type: 'title', text: 'The Test Book\nA Subtitle' },
      { type: 'heading', level: 1, text: 'Chapter One' },
      { type: 'heading', level: 2, segments: [T('A '), T('bold', { tf: 4 }), T(' heading with '), T('a link', { href: 'https://example.org/h' })], text: 'A bold heading with a link' },
      { type: 'heading', level: 3, text: 'Third level' },
      { type: 'heading', level: 4, text: 'Fourth level' },
      { type: 'heading', level: 5, text: 'Fifth level' },
      { type: 'heading', level: 6, text: 'Sixth level' },
      { type: 'para', segments: [
        T('Plain, '), T('bold', { tf: 4 }), T(', '), T('italic', { tf: 1 }), T(', '), T('underlined', { tf: 2 }), T(' and '),
        T('a link', { href: 'https://example.org/a?b=1&c=2' }), T(' and a citation '), T('Moby Dick', { cite: true }), T(' and H' + '2' + '' + 'O and x' + '2' + ' and '),
        T('code_text', { uncontracted: true }), T(' and an equation '), M('x^{2}+\\frac{a}{b}'), T(' and a note'),
        { type: 'noteref', text: '1', idref: 'fn1' }, T('.'),
      ] },
      { type: 'footnote', id: 'fn1', text: 'The footnote text.' },
      { type: 'para', segments: [T('An endnote reference'), { type: 'noteref', text: 'i', idref: 'en1' }, T(' follows.')] },
      { type: 'footnote', id: 'en1', kind: 'endnote', text: 'The endnote text.' },
      { type: 'list', items: [
        { text: 'Apples', marker: '•' },
        { text: 'Pears', marker: '•' },
        { text: 'Green pears', marker: '•', level: 1 },
        { text: 'Plums', marker: '•' },
      ] },
      { type: 'list', ordered: true, items: [
        { text: 'First', marker: '1.' }, { text: 'Second', marker: '2.' }, { text: 'Sub a', marker: 'a.', level: 1 }, { text: 'Third', marker: '3.' },
      ] },
      { type: 'list', items: [
        { text: 'Item with a block', marker: '•', blocks: [{ type: 'para', text: 'A paragraph inside the item.' }] },
        { marker: '•', blocks: [{ type: 'para', text: 'An item holding only a nested block.' }] },
      ] },
      { type: 'list', kind: 'glossary', style: 'glossary', items: [
        { term: 'Atom', def: 'the smallest unit', text: 'Atom — the smallest unit' },
        { term: 'Bit', def: 'a binary digit', text: 'Bit — a binary digit' },
      ] },
      { type: 'list', items: [{ text: '85 g butter' }, { text: '2 eggs' }] },
      { type: 'table', title: 'Fruit prices', caption: 'Prices in pence', headers: ['Fruit', 'Price'], rows: [['Apple', '40'], [{ text: 'Pear', segments: [T('Pear', { tf: 4 })] }, '55']], tabletn: 'Prices rounded.' },
      { type: 'box', title: 'A side box', blocks: [{ type: 'heading', level: 3, text: 'A side box' }, { type: 'para', text: 'Text inside the box.' }] },
      { type: 'note', text: 'A transcriber note.' },
      { type: 'play', subtype: 'verse', fromPoem: true, text: 'Roses are red,' },
      { type: 'play', subtype: 'verse', fromPoem: true, text: 'Violets are blue.' },
      { type: 'indicator', kind: 'line', fromPoem: true },
      { type: 'play', subtype: 'verse', fromPoem: true, text: 'Sugar is sweet.' },
      { type: 'play', subtype: 'prose', text: 'HAMLET. To be or not to be.' },
      { type: 'stage', text: 'Exit, pursued by a bear.' },
      { type: 'code', text: 'function f(x) {\n  return x  +  1;\n}' },
      { type: 'para', style: 'quote', text: 'A quoted line.' },
      { type: 'para', style: 'quote', text: 'Another quoted line.' },
      { type: 'attribution', text: 'A. Source' },
      { type: 'pagenum', page: '12' },
      { type: 'graphic', src: 'images/pic1.png', alt: 'A tiny red dot', caption: 'Figure 1. A dot.', description: 'The dot is one pixel.' },
      { type: 'math', latex: '\\sqrt{a^2+b^2}', mathml: latexToMathml('\\sqrt{a^2+b^2}') },
      { type: 'indicator', kind: 'asterisks' },
      { type: 'para', text: 'The last paragraph.' },
    ],
  };
}
