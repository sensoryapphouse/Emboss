// Malformed and hostile inputs for the extreme-document test set (A89 step 4; see ../check-extreme-documents.mjs, case 8).
// Everything is built from a small valid document of each format (made by ./emit.mjs) that is then cut, bent, lied about or
// replaced by a bomb. Deterministic for a given seed. Each group is a list of { id, name, data, [solo], [expect], [extra] }:
//   name   the file name the user would give it (the extension picks the reader, as in the app)
//   solo   true: run in a child of its own (a bomb, or something that may well hang), not in the group's battery
//   extra  fields merged into the worker item (mustNotContain, maxModelChars, ...)
import zlib from 'node:zlib';
import { makeRng, bookBlocks, toArray, randomLetters } from './content.mjs';
import { emitNimas, emitHtml, emitMarkdown, emitText, emitDocx, emitOdt, emitEpub, emitRtf, esc } from './emit.mjs';

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };

// ---------- zip: read any simple zip, write one with real deflate and optional lies ----------
export function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(off + 10), comp = buf.readUInt32LE(off + 20), nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32), lo = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nl);
    const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + comp);
    out.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });
    off += 46 + nl + el + cl;
  }
  return out;
}
// entries: [{ name, data, store?, claimUncompressed?, claimCompressed?, method? }]
export function rawZip(entries, { comment = 0 } = {}) {
  const locals = [], centrals = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const stored = e.store || data.length < 64;
    const comp = e.precompressed || (stored ? data : zlib.deflateRawSync(data));
    const method = e.method ?? (stored ? 0 : 8);
    const crc = e.crc ?? zlib.crc32(data);
    const cs = e.claimCompressed ?? comp.length, us = e.claimUncompressed ?? data.length;
    const lh = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0x21), u32(crc), u32(cs), u32(us), u16(name.length), u16(0), name]);
    locals.push(lh, comp);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0x21), u32(crc), u32(cs), u32(us), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name]));
    off += lh.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(off), u16(comment)]);
  return Buffer.concat([...locals, cd, eocd]);
}
const rezip = (buf, extra = (e) => e) => rawZip(readZip(buf).map(extra));
// Finds the EOCD and the first central-directory entry, for the field-level lies.
function zipOffsets(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  return { eocd, cd: buf.readUInt32LE(eocd + 16) };
}
const patch = (buf, fn) => { const b = Buffer.from(buf); fn(b, zipOffsets(b)); return b; };

// ---------- valid base documents ----------
export async function baseDocs(seed) {
  const blocks = toArray(bookBlocks(makeRng(seed), { targetChars: 20000 }));
  return {
    blocks,
    xml: emitNimas(blocks), html: emitHtml(blocks), md: emitMarkdown(blocks), txt: emitText(blocks), rtf: emitRtf(blocks),
    docx: rezip(await emitDocx(blocks)), odt: rezip(await emitOdt(blocks)), epub: rezip(await emitEpub(blocks)),
  };
}

const CUTS = [['0', 0], ['1b', 1], ['20b', 20], ['100b', 100], ['10pct', 0.1], ['33pct', 0.33], ['50pct', 0.5], ['75pct', 0.75], ['95pct', 0.95], ['minus1', -1], ['minus22', -22], ['minus30', -30]];
const cut = (buf, c) => (c === 0 ? buf.subarray(0, 0) : c < 0 ? buf.subarray(0, Math.max(0, buf.length + c)) : c < 1 ? buf.subarray(0, Math.floor(buf.length * c)) : buf.subarray(0, c));
function truncations(prefix, ext, buf) {
  return CUTS.map(([tag, c]) => ({ id: `${prefix}-truncated-${tag}`, name: `${prefix}.${ext}`, data: Buffer.from(cut(buf, c)) }));
}
// invalid UTF-8: overwrite some stretches with bytes that can never occur in UTF-8
function badUtf8(buf, rng) {
  const b = Buffer.from(buf);
  const bad = [[0xff], [0xfe, 0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf8, 0x88, 0x80, 0x80, 0x80], [0x80], [0xe2, 0x82]];
  for (let i = 0; i < 40; i++) { const at = rng.int(0, Math.max(0, b.length - 8)); const seq = rng.pick(bad); for (let k = 0; k < seq.length; k++) b[at + k] = seq[k]; }
  return b;
}
const repl = (buf, from, to) => Buffer.from(buf.toString('utf8').split(from).join(to), 'utf8');
const replFirst = (buf, from, to) => Buffer.from(buf.toString('utf8').replace(from, to), 'utf8');
const DT = '<?xml version="1.0" encoding="UTF-8"?>\n<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>';
const DT_END = '</level1></bodymatter></book></dtbook>';

// ---------- the groups ----------
export async function hostileGroups(seed, { canaryPath, httpBase }) {
  const rng = makeRng(seed + 7919);
  const B = await baseDocs(seed);
  const G = {};

  // ===== NIMAS / DTBook XML =====
  G.xml = [
    ...truncations('nimas', 'xml', B.xml),
    { id: 'nimas-invalid-utf8', name: 'bad.xml', data: badUtf8(B.xml, rng) },
    { id: 'nimas-latin1-bytes', name: 'latin1.xml', data: Buffer.from(B.xml.toString('utf8').replace(/the/g, 'thé'), 'latin1') },
    { id: 'nimas-utf16le-bom', name: 'utf16.xml', data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(B.xml.toString('utf8'), 'utf16le')]) },
    { id: 'zero-bytes', name: 'empty.xml', data: Buffer.alloc(0) },
    { id: 'only-bom', name: 'bom.xml', data: Buffer.from([0xef, 0xbb, 0xbf]) },
    { id: 'random-binary', name: 'random.xml', data: Buffer.from(Array.from({ length: 20000 }, () => rng.int(0, 255))) },
    { id: 'html-with-xml-extension', name: 'lies.xml', data: B.html },
    { id: 'docx-with-xml-extension', name: 'lies2.xml', data: B.docx },
    { id: 'mismatched-end-tags', name: 'mismatch.xml', data: repl(B.xml, '</p>', '</q>') },
    { id: 'unterminated-comment', name: 'comment.xml', data: Buffer.from(DT + '<p>x</p><!-- never closed ' + 'a'.repeat(2000) + DT_END) },
    { id: 'unterminated-cdata', name: 'cdata.xml', data: Buffer.from(DT + '<p><![CDATA[never closed ' + 'a'.repeat(2000) + '</p>' + DT_END) },
    { id: 'bad-character-references', name: 'charref.xml', data: Buffer.from(DT + '<p>a &#xFFFFFFFF; b &#0; c &#x110000; d &#xD800; e &#55357; f &bogus; g &#; h &#x; i &amp j</p>' + DT_END) },
    { id: 'duplicate-and-valueless-attributes', name: 'attrs.xml', data: Buffer.from(DT + '<p id="a" id="b" class>text</p><p "oops">more</p>' + DT_END) },
    { id: 'ten-thousand-attributes', name: 'manyattrs.xml', data: Buffer.from(DT + '<p ' + Array.from({ length: 10000 }, (_, i) => `a${i}="v"`).join(' ') + '>text</p>' + DT_END) },
    { id: 'raw-less-than-in-text', name: 'lt.xml', data: Buffer.from(DT + '<p>if a < b and c > d & e</p>' + DT_END) },
    { id: 'two-roots-and-trailing-garbage', name: 'roots.xml', data: Buffer.from(DT + '<p>one</p>' + DT_END + '<dtbook/>garbage after the end') },
    { id: 'declared-encoding-lies', name: 'enc.xml', data: replFirst(B.xml, 'encoding="UTF-8"', 'encoding="ISO-8859-1"') },
    { id: 'declared-encoding-nonsense', name: 'enc2.xml', data: replFirst(B.xml, 'encoding="UTF-8"', 'encoding="klingon-9"') },
    { id: 'dtbook-with-no-book', name: 'nobook.xml', data: Buffer.from('<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"></dtbook>') },
    { id: 'dtbook-empty-book', name: 'emptybook.xml', data: Buffer.from('<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book/></dtbook>') },
    { id: 'not-dtbook-root', name: 'root.xml', data: Buffer.from('<?xml version="1.0"?><note><to>x</to></note>') },
    { id: 'text-only-in-xml', name: 'plain.xml', data: Buffer.from('this is not xml at all\n'.repeat(500)) },
    { id: 'entity-reference-loop', name: 'loop.xml', data: Buffer.from('<?xml version="1.0"?>\n<!DOCTYPE dtbook [<!ENTITY a "&b;"><!ENTITY b "&a;">]>\n<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><p>&a;</p></level1></bodymatter></book></dtbook>') },
    { id: 'doctype-huge-internal-subset', name: 'subset.xml', data: Buffer.from('<?xml version="1.0"?>\n<!DOCTYPE dtbook [' + Array.from({ length: 20000 }, (_, i) => `<!ENTITY e${i} "v${i}">`).join('') + ']>\n<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><p>&e1; &e19999;</p></level1></bodymatter></book></dtbook>') },
    { id: 'ten-thousand-sibling-paragraphs-no-whitespace', name: 'siblings.xml', data: Buffer.from(DT + '<p>x</p>'.repeat(100000) + DT_END) },
  ];

  // ===== HTML =====
  const nest = (open, close, n, inner = 'deep') => Buffer.from('<html><body>' + open.repeat(n) + inner + close.repeat(n) + '</body></html>');
  G.html = [
    ...truncations('page', 'html', B.html),
    { id: 'html-invalid-utf8', name: 'bad.html', data: badUtf8(B.html, rng) },
    { id: 'html-zero-bytes', name: 'empty.html', data: Buffer.alloc(0) },
    { id: 'html-lone-less-than', name: 'lt.html', data: Buffer.from('<') },
    { id: 'html-hundred-thousand-less-than', name: 'lts.html', data: Buffer.from('<'.repeat(100000)) },
    { id: 'html-unterminated-comment', name: 'comment.html', data: Buffer.from('<p>a</p><!-- ' + 'x'.repeat(5000)) },
    { id: 'html-unterminated-script', name: 'script.html', data: Buffer.from('<p>a</p><script>var x = "' + 'x'.repeat(5000)) },
    { id: 'html-unterminated-style-1mb', name: 'style.html', data: Buffer.from('<style>p { color: red; ' + 'a{'.repeat(500000)) },
    { id: 'html-css-200000-rules', name: 'rules.html', data: Buffer.from('<style>' + Array.from({ length: 200000 }, (_, i) => `.c${i}{color:red}`).join('\n') + '</style><p class="c1">x</p>') },
    { id: 'html-css-selector-100000-long', name: 'selector.html', data: Buffer.from('<style>' + 'a b '.repeat(25000) + '{color:red}</style><p>x</p>') },
    { id: 'html-css-import-and-url-bombs', name: 'imp.html', data: Buffer.from('<style>@import url(http://127.0.0.1:1/x.css); p{background:url(' + 'x'.repeat(100000) + ')}</style><p>x</p>') },
    { id: 'html-attribute-10mb', name: 'attr.html', data: Buffer.from('<p title="' + 'x'.repeat(10 * 1024 * 1024) + '">text</p>') },
    { id: 'html-3000-attributes', name: 'attrs.html', data: Buffer.from('<p ' + Array.from({ length: 3000 }, (_, i) => `a${i}=1`).join(' ') + '>text</p>') },
    { id: 'html-nested-div-400-browser-depth', name: 'div400.html', data: nest('<div>', '</div>', 400) },
    { id: 'html-nested-b-400-browser-depth', name: 'b400.html', data: nest('<b>', '</b>', 400) },
    { id: 'html-nested-ul-li-250', name: 'ul250.html', data: nest('<ul><li>', '</li></ul>', 250) },
    { id: 'html-nested-table-250', name: 'table250.html', data: nest('<table><tr><td>', '</td></tr></table>', 250) },
    { id: 'html-nested-blockquote-400', name: 'bq400.html', data: nest('<blockquote>', '</blockquote>', 400) },
    { id: 'html-100000-siblings', name: 'siblings.html', data: Buffer.from('<body>' + '<span>x</span>'.repeat(100000)) },
    { id: 'html-100000-br', name: 'br.html', data: Buffer.from('<p>' + '<br>'.repeat(100000) + 'x</p>') },
    { id: 'html-unclosed-p-20000', name: 'unclosedp.html', data: Buffer.from('<body>' + '<p>text '.repeat(20000)) },
    { id: 'html-unclosed-li-20000', name: 'unclosedli.html', data: Buffer.from('<ul>' + '<li>item '.repeat(20000)) },
    { id: 'html-entity-storm', name: 'ent.html', data: Buffer.from('<p>' + '&amp;&lt;&#x1F600;&#128512;&nbsp;&bogus;&#xFFFFFFFF;'.repeat(50000) + '</p>') },
    { id: 'html-base64-image-truncated', name: 'img.html', data: Buffer.from('<p>before</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA' + 'AAAA'.repeat(100) + '" alt="x"><img src="data:image/svg+xml;base64,PHN2ZyB4bW"><p>after</p>') },
    { id: 'html-svg-bomb', name: 'svg.html', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="99999999" height="99999999">' + '<g>'.repeat(450) + '<text>x</text>' + '</g>'.repeat(450) + '</svg><p>after</p>') },
    { id: 'html-math-garbage', name: 'math.html', data: Buffer.from('<p>a<math><mfrac><mn>1</mn></mfrac><msup/><mroot><mi>x</mi></mroot><mtable><mtr><mtd/></mtr></mtable></math>b<math>' + '<mrow>'.repeat(500) + '<mi>x</mi>' + '</mrow>'.repeat(500) + '</math></p>') },
    { id: 'html-math-450-deep', name: 'mathdeep.html', data: Buffer.from('<p><math>' + '<msup><mi>x</mi>'.repeat(450) + '<mn>2</mn>' + '</msup>'.repeat(450) + '</math></p>') },
    { id: 'html-bidi-and-controls-in-attributes', name: 'attrctl.html', data: Buffer.from('<p title="‮\u0000\ud800" lang="\u0000">text ‮</p>') },
  ];

  // ===== Markdown =====
  const md = (s) => Buffer.from(s, 'utf8');
  G.md = [
    { id: 'md-zero-bytes', name: 'empty.md', data: Buffer.alloc(0) },
    { id: 'md-one-million-newlines', name: 'nl.md', data: md('\n'.repeat(1000000)) },
    { id: 'md-blockquote-100000-deep', name: 'bq.md', data: md('>'.repeat(100000) + ' x') },
    { id: 'md-list-nested-5000-by-indent', name: 'nest.md', data: md(Array.from({ length: 5000 }, (_, i) => ' '.repeat(i * 2) + '- item').join('\n')) },
    { id: 'md-list-nested-1000-by-indent', name: 'nest1k.md', data: md(Array.from({ length: 1000 }, (_, i) => ' '.repeat(i * 2) + '- item').join('\n')) },
    { id: 'md-one-million-asterisks', name: 'star.md', data: md('*'.repeat(1000000)) },
    { id: 'md-emphasis-redos', name: 'redos.md', data: md('*a '.repeat(50000) + '\n\n' + '_'.repeat(50000) + 'x\n\n' + '**a_b '.repeat(20000)) },
    { id: 'md-200000-open-brackets', name: 'bracket.md', data: md('['.repeat(200000)) },
    { id: 'md-links-unclosed-100000', name: 'link.md', data: md('[a](b '.repeat(100000)) },
    { id: 'md-images-unclosed-100000', name: 'image.md', data: md('![a]('.repeat(100000)) },
    { id: 'md-one-million-backticks', name: 'tick.md', data: md('`'.repeat(1000000)) },
    { id: 'md-code-fence-unclosed-200kb', name: 'fence.md', data: md('```\n' + 'code line\n'.repeat(20000)) },
    { id: 'md-table-with-20000-columns', name: 'wide.md', data: md('|' + ' a |'.repeat(20000) + '\n|' + ' - |'.repeat(20000) + '\n|' + ' b |'.repeat(20000)) },
    { id: 'md-table-with-8000-rows', name: 'tall.md', data: md('| a | b |\n| - | - |\n' + '| 1 | 2 |\n'.repeat(8000)) },
    { id: 'md-200000-dollars', name: 'dollar.md', data: md('$'.repeat(200000)) },
    { id: 'md-latex-deep-braces', name: 'brace.md', data: md('$' + '{'.repeat(5000) + 'x' + '}'.repeat(5000) + '$ and $' + '\\frac{'.repeat(2000) + 'x' + '}{1}'.repeat(2000) + '$') },
    { id: 'md-latex-unknown-commands', name: 'latex.md', data: md('$\\nonexistentcommand{x}\\\\ \\begin{foo} \\end{bar} \\frac{1}$ and $$\\sum_{' + '}'.repeat(50) + '$$') },
    { id: 'md-200000-backslashes', name: 'bs.md', data: md('\\'.repeat(200000)) },
    { id: 'md-200000-less-than', name: 'lt.md', data: md('<'.repeat(200000)) },
    { id: 'md-heading-line-250kb', name: 'h.md', data: md('# ' + 'word '.repeat(50000)) },
    { id: 'md-numbered-list-20000-items', name: 'ol.md', data: md(Array.from({ length: 20000 }, (_, i) => `${i + 1}. item`).join('\n')) },
    { id: 'md-link-reference-definitions-100000', name: 'refs.md', data: md(Array.from({ length: 100000 }, (_, i) => `[r${i}]: http://example.com/${i}`).join('\n') + '\n\n[r5] [r99999] [nope]') },
    { id: 'md-html-block-unclosed-5000', name: 'rawhtml.md', data: md('<div>'.repeat(5000) + 'x') },
    { id: 'md-footnotes-undefined-and-cyclic', name: 'fn.md', data: md('a[^1] b[^2] c[^missing]\n\n[^1]: see[^2]\n[^2]: see[^1]\n') },
    { id: 'md-front-matter-unterminated', name: 'front.md', data: md('---\ntitle: x\n' + 'k: v\n'.repeat(100000)) },
    { id: 'md-crlf-cr-lf-mixed', name: 'eol.md', data: md('# a\r\rb\r\n\nc\n\r\nd\r'.repeat(5000)) },
  ];

  // ===== plain text =====
  G.txt = [
    { id: 'txt-zero-bytes', name: 'empty.txt', data: Buffer.alloc(0) },
    { id: 'txt-whitespace-only', name: 'ws.txt', data: md(' \t\n\r\n   　 \n'.repeat(1000)) },
    { id: 'txt-one-million-newlines', name: 'nl.txt', data: md('\n'.repeat(1000000)) },
    { id: 'txt-one-million-tabs', name: 'tab.txt', data: md('\t'.repeat(1000000)) },
    { id: 'txt-single-line-1mb-with-spaces', name: 'line.txt', data: md('word '.repeat(200000)) },
    { id: 'txt-nul-only', name: 'nul.txt', data: Buffer.alloc(5000) },
    { id: 'txt-random-binary-1mb', name: 'rand.txt', data: Buffer.from(Array.from({ length: 1 << 20 }, () => rng.int(0, 255))) },
    { id: 'txt-pdf-inside', name: 'pdf.txt', data: md('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' + '\u0000\u0001\u0002'.repeat(100)) },
    { id: 'txt-png-inside', name: 'png.txt', data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(Array.from({ length: 5000 }, () => rng.int(0, 255)))]) },
    { id: 'txt-invalid-utf8', name: 'bad.txt', data: badUtf8(B.txt, rng) },
    { id: 'txt-cr-only-line-ends', name: 'cr.txt', data: md('line one\rline two\r\rpara two\r'.repeat(5000)) },
    { id: 'txt-1000-dollar-signs-with-latex-junk', name: 'latex.txt', data: md('$\\frac{'.repeat(1000) + ' $$ ' + '$x$ '.repeat(4000)) },
    { id: 'txt-200000-one-character-lines', name: 'chars.txt', data: md('a\n'.repeat(200000)) },
  ];

  // ===== RTF =====
  const rtf = (s) => Buffer.from(s, 'latin1');
  G.rtf = [
    ...truncations('doc', 'rtf', B.rtf),
    { id: 'rtf-zero-bytes', name: 'empty.rtf', data: Buffer.alloc(0) },
    { id: 'rtf-no-header', name: 'nohdr.rtf', data: rtf('just text, no rtf header at all') },
    { id: 'rtf-100000-open-braces', name: 'open.rtf', data: rtf('{\\rtf1 ' + '{'.repeat(100000) + 'x') },
    { id: 'rtf-100000-close-braces', name: 'close.rtf', data: rtf('{\\rtf1 x' + '}'.repeat(100000)) },
    { id: 'rtf-nested-groups-2000-balanced', name: 'bal2k.rtf', data: rtf('{\\rtf1 ' + '{\\b '.repeat(2000) + 'deep' + '}'.repeat(2000) + '}') },
    { id: 'rtf-nested-groups-50000-balanced', name: 'bal50k.rtf', data: rtf('{\\rtf1 ' + '{\\b '.repeat(50000) + 'deep' + '}'.repeat(50000) + '}') },
    { id: 'rtf-destinations-10000-deep', name: 'dest.rtf', data: rtf('{\\rtf1 ' + '{\\*\\x '.repeat(10000) + 'y' + '}'.repeat(10000) + ' visible}') },
    { id: 'rtf-bin-claims-2gb', name: 'bin.rtf', data: rtf('{\\rtf1 before \\bin2147483647 abcd after}') },
    { id: 'rtf-bin-negative', name: 'binneg.rtf', data: rtf('{\\rtf1 before \\bin-5 abcd after}') },
    { id: 'rtf-unicode-escapes-out-of-range', name: 'uni.rtf', data: rtf('{\\rtf1 \\u99999999? \\u-99999? \\u55357? \\u56832? \\u0? \\uc99999 \\u65? \\uc0\\u65 x}') },
    { id: 'rtf-hex-escapes-truncated', name: 'hex.rtf', data: rtf('{\\rtf1 a\\\'b \\\'zz \\\' \\\'4' + ' \\\'e9'.repeat(50000) + '}') },
    { id: 'rtf-control-word-5000-digit-parameter', name: 'param.rtf', data: rtf('{\\rtf1 \\li' + '9'.repeat(5000) + ' \\fs-999999999999 text\\par}') },
    { id: 'rtf-control-word-name-100000-long', name: 'name.rtf', data: rtf('{\\rtf1 \\' + 'a'.repeat(100000) + ' text}') },
    { id: 'rtf-one-million-par', name: 'par.rtf', data: rtf('{\\rtf1 ' + '\\par'.repeat(1000000) + ' end}') },
    { id: 'rtf-picture-10mb-hex', name: 'pict.rtf', data: rtf('{\\rtf1 {\\pict\\wmetafile8\\picw100\\pich100 ' + 'ab'.repeat(5 * 1024 * 1024) + '} after}') },
    { id: 'rtf-table-unclosed-100000-rows', name: 'trowd.rtf', data: rtf('{\\rtf1 ' + '\\trowd\\cellx1000 \\intbl x\\cell '.repeat(100000) + '}') },
    { id: 'rtf-table-cellx-huge', name: 'cellx.rtf', data: rtf('{\\rtf1 \\trowd\\cellx2147483647\\cellx-5\\cellx0 \\intbl a\\cell b\\cell c\\cell\\row end}') },
    { id: 'rtf-fonttbl-unterminated', name: 'font.rtf', data: rtf('{\\rtf1{\\fonttbl{\\f0 ' + 'Times;'.repeat(50000)) },
    { id: 'rtf-listtable-self-referencing', name: 'list.rtf', data: rtf('{\\rtf1{\\*\\listtable{\\list\\listid1{\\listlevel\\levelnfc0}}}{\\*\\listoverridetable{\\listoverride\\listid1\\ls1}}\\pard\\ls1\\ilvl99999 item\\par\\ls999999 other\\par}') },
  ];

  // ===== DOCX =====
  const docxXml = (bodyInner, { styles, numbering, extraRels = '', extraParts = [] } = {}) => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    const parts = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${styles ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' : ''}${numbering ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' : ''}${extraRels}</Relationships>` },
      { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${bodyInner}</w:body></w:document>` },
    ];
    if (styles) parts.push({ name: 'word/styles.xml', data: `<?xml version="1.0"?><w:styles ${W}>${styles}</w:styles>` });
    if (numbering) parts.push({ name: 'word/numbering.xml', data: `<?xml version="1.0"?><w:numbering ${W}>${numbering}</w:numbering>` });
    return rawZip([...parts, ...extraParts]);
  };
  const P = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const tbl = (inner) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc>${inner}<w:p/></w:tc></w:tr></w:tbl>`;
  const nestTbl = (n) => { let s = P('core'); for (let i = 0; i < n; i++) s = tbl(s); return s; };
  const nestSdt = (n) => { let s = P('core'); for (let i = 0; i < n; i++) s = `<w:sdt><w:sdtContent>${s}</w:sdtContent></w:sdt>`; return s; };
  const nestOmml = (n) => `<w:p><m:oMath>${'<m:sSup><m:e>'.repeat(n)}<m:r><m:t>x</m:t></m:r>${'</m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>'.repeat(n)}</m:oMath></w:p>`;
  G.docx = [
    ...truncations('book', 'docx', B.docx),
    { id: 'docx-zero-bytes', name: 'empty.docx', data: Buffer.alloc(0) },
    { id: 'docx-twenty-one-bytes', name: 'tiny.docx', data: Buffer.alloc(21, 0x50) },
    { id: 'docx-not-a-zip-text', name: 'text.docx', data: md('This is a plain text file that someone renamed to .docx.\n'.repeat(200)) },
    { id: 'docx-not-a-zip-random-binary', name: 'random.docx', data: Buffer.from(Array.from({ length: 50000 }, () => rng.int(0, 255))) },
    { id: 'docx-pk-signature-only', name: 'pk.docx', data: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
    { id: 'docx-empty-zip', name: 'emptyzip.docx', data: rawZip([]) },
    { id: 'docx-no-document-part', name: 'nodoc.docx', data: rawZip([{ name: 'hello.txt', data: 'hi' }]) },
    { id: 'docx-document-part-is-garbage', name: 'garbage.docx', data: rawZip([{ name: 'word/document.xml', data: 'not xml \u0000\u0001 <<<<' }]) },
    { id: 'docx-document-part-empty', name: 'emptydoc.docx', data: rawZip([{ name: 'word/document.xml', data: '' }]) },
    { id: 'docx-document-part-wrong-root', name: 'root.docx', data: rawZip([{ name: 'word/document.xml', data: '<?xml version="1.0"?><foo><bar/></foo>' }]) },
    { id: 'docx-cfb-signature-password-protected', name: 'locked.docx', data: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(2000)]) },
    { id: 'docx-eocd-claims-65535-entries', name: 'count.docx', data: patch(B.docx, (b, z) => b.writeUInt16LE(65535, z.eocd + 10)) },
    { id: 'docx-central-directory-offset-past-end', name: 'cdoff.docx', data: patch(B.docx, (b, z) => b.writeUInt32LE(b.length + 1000, z.eocd + 16)) },
    { id: 'docx-central-directory-offset-near-end', name: 'cdoff2.docx', data: patch(B.docx, (b, z) => b.writeUInt32LE(b.length - 10, z.eocd + 16)) },
    { id: 'docx-entry-name-length-65535', name: 'namelen.docx', data: patch(B.docx, (b, z) => b.writeUInt16LE(65535, z.cd + 28)) },
    { id: 'docx-entry-extra-length-65535', name: 'extralen.docx', data: patch(B.docx, (b, z) => b.writeUInt16LE(65535, z.cd + 30)) },
    { id: 'docx-entry-local-offset-past-end', name: 'localoff.docx', data: patch(B.docx, (b, z) => b.writeUInt32LE(b.length + 5, z.cd + 42)) },
    { id: 'docx-entry-compressed-size-4gb', name: 'compsize.docx', data: patch(B.docx, (b, z) => b.writeUInt32LE(0xffffffff, z.cd + 20)) },
    { id: 'docx-unsupported-compression-method-99', name: 'method.docx', data: patch(B.docx, (b, z) => b.writeUInt16LE(99, z.cd + 10)) },
    { id: 'docx-deflate-stream-corrupted', name: 'badflate.docx', data: rawZip(readZip(B.docx).map((e) => (e.name === 'word/document.xml' ? { ...e, precompressed: Buffer.from(Array.from({ length: 400 }, () => rng.int(0, 255))), claimUncompressed: e.data.length, method: 8 } : e))) },
    { id: 'docx-deflate-stream-cut-short', name: 'shortflate.docx', data: rawZip(readZip(B.docx).map((e) => (e.name === 'word/document.xml' ? { ...e, precompressed: zlib.deflateRawSync(e.data).subarray(0, 50), claimUncompressed: e.data.length, method: 8 } : e))) },
    { id: 'docx-header-claims-1gb-uncompressed-but-is-small', name: 'liar.docx', data: rawZip(readZip(B.docx).map((e) => ({ ...e, store: false, claimUncompressed: 1 << 30 }))) },
    { id: 'docx-central-and-local-names-disagree', name: 'names.docx', data: patch(B.docx, (b, z) => { b.write('xord/document.xml', z.cd + 46); }) },
    { id: 'docx-odt-with-docx-extension', name: 'wrongkind.docx', data: B.odt },
    { id: 'docx-epub-with-docx-extension', name: 'wrongkind2.docx', data: B.epub },
    { id: 'docx-html-with-docx-extension', name: 'wrongkind3.docx', data: B.html },
    { id: 'docx-rtf-with-docx-extension', name: 'wrongkind4.docx', data: B.rtf },
    { id: 'docx-grid-span-negative-and-text', name: 'span2.docx', data: docxXml(`<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:tcPr><w:gridSpan w:val="-5"/></w:tcPr>${P('a')}</w:tc><w:tc><w:tcPr><w:gridSpan w:val="abc"/></w:tcPr>${P('b')}</w:tc><w:tc><w:tcPr><w:gridSpan w:val="0"/></w:tcPr>${P('c')}</w:tc></w:tr></w:tbl>${P('after')}`) },
    { id: 'docx-vertical-merge-continue-without-restart-2000-rows', name: 'vmerge.docx', data: docxXml(`<w:tbl><w:tblPr/><w:tblGrid/>${'<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>'.repeat(2000)}</w:tbl>${P('after')}`) },
    { id: 'docx-table-with-no-rows-no-grid', name: 'norows.docx', data: docxXml(`<w:tbl></w:tbl><w:tbl><w:tr/></w:tbl><w:tbl><w:tr><w:tc/></w:tr></w:tbl>${P('after')}`) },
    { id: 'docx-list-level-2147483647', name: 'ilvl.docx', data: docxXml(`<w:p><w:pPr><w:numPr><w:ilvl w:val="2147483647"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="-4"/><w:numId w:val="99999"/></w:numPr></w:pPr><w:r><w:t>item2</w:t></w:r></w:p>`, { numbering: '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' }) },
    { id: 'docx-list-numbering-start-huge', name: 'start.docx', data: docxXml(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>b</w:t></w:r></w:p>`, { numbering: '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="2147483647"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="99999999999"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' }) },
    { id: 'docx-style-based-on-itself-and-in-a-cycle', name: 'cycle.docx', data: docxXml('<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>one</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>two</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="C"/></w:pPr><w:r><w:rPr><w:rStyle w:val="R1"/></w:rPr><w:t>three</w:t></w:r></w:p>', { styles: '<w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:name w:val="B"/><w:basedOn w:val="A"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Heading1"/></w:style><w:style w:type="paragraph" w:styleId="C"><w:name w:val="C"/><w:basedOn w:val="C"/><w:link w:val="C"/><w:next w:val="C"/></w:style><w:style w:type="character" w:styleId="R1"><w:name w:val="R1"/><w:basedOn w:val="R2"/></w:style><w:style w:type="character" w:styleId="R2"><w:name w:val="R2"/><w:basedOn w:val="R1"/></w:style>' }) },
    { id: 'docx-nested-tables-300', name: 'tbl300.docx', data: docxXml(nestTbl(300)) },
    { id: 'docx-nested-tables-3000', name: 'tbl3000.docx', data: docxXml(nestTbl(3000)) },
    { id: 'docx-nested-content-controls-3000', name: 'sdt3000.docx', data: docxXml(nestSdt(3000)) },
    { id: 'docx-equation-nested-300-deep', name: 'omml300.docx', data: docxXml(nestOmml(300)) },
    { id: 'docx-equation-nested-3000-deep', name: 'omml3000.docx', data: docxXml(nestOmml(3000)) },
    { id: 'docx-field-codes-begin-never-ended-50000', name: 'fld.docx', data: docxXml(`<w:p>${'<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "http://x" </w:instrText></w:r>'.repeat(50000)}<w:r><w:t>text</w:t></w:r></w:p>`) },
    { id: 'docx-200000-empty-runs-in-one-paragraph', name: 'runs.docx', data: docxXml(`<w:p>${'<w:r/>'.repeat(200000)}<w:r><w:t>text</w:t></w:r></w:p>`) },
    { id: 'docx-200000-paragraphs', name: 'paras.docx', data: docxXml('<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(200000)) },
    { id: 'docx-references-to-missing-parts', name: 'missing.docx', data: docxXml('<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><a:pic><a:blipFill><a:blip r:embed="rId99"/></a:blipFill></a:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:hyperlink r:id="rId77"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:r><w:footnoteReference w:id="12345"/></w:r><w:r><w:endnoteReference w:id="-3"/></w:r></w:p>' + P('after'), { extraRels: '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="../../../../etc/passwd" TargetMode="External"/>' }) },
    { id: 'docx-image-part-is-not-an-image', name: 'badimg.docx', data: docxXml('<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><a:pic><a:blipFill><a:blip r:embed="rId5"/></a:blipFill></a:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' + P('after'), { extraRels: '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/>', extraParts: [{ name: 'word/media/a.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]) }] }) },
    { id: 'docx-absurd-measurements-and-values', name: 'absurd.docx', data: docxXml('<w:p><w:pPr><w:ind w:left="99999999999999999999" w:hanging="-4294967296"/><w:spacing w:before="abc" w:after="NaN" w:line="Infinity"/><w:jc w:val="sideways"/></w:pPr><w:r><w:rPr><w:sz w:val="NaN"/><w:color w:val="ZZZZZZ"/><w:vertAlign w:val="nowhere"/></w:rPr><w:t>text</w:t></w:r></w:p>' + P('after')) },
    { id: 'docx-deleted-and-moved-text-nested', name: 'del.docx', data: docxXml(`<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="a"/></w:rPr></w:pPr>${'<w:del w:id="2" w:author="a"><w:r><w:delText>gone</w:delText></w:r>'.repeat(500)}${'</w:del>'.repeat(500)}</w:p><w:p><w:r><w:t>kept</w:t></w:r></w:p>`) },
    { id: 'docx-xml-with-doctype-and-entities', name: 'doctype.docx', data: rawZip([{ name: 'word/document.xml', data: '<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY a "AAAA">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&a;&a;</w:t></w:r></w:p></w:body></w:document>' }]) },
  ];

  // ===== ODT =====
  const odtXml = (bodyInner) => rawZip([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'META-INF/manifest.xml', data: '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>' },
    { name: 'content.xml', data: `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body><office:text>${bodyInner}</office:text></office:body></office:document-content>` },
  ]);
  const nestList = (n) => { let s = '<text:list-item><text:p>core</text:p></text:list-item>'; for (let i = 0; i < n; i++) s = `<text:list-item><text:p>x</text:p><text:list>${s}</text:list></text:list-item>`; return `<text:list>${s}</text:list>`; };
  G.odt = [
    ...truncations('book', 'odt', B.odt),
    { id: 'odt-zero-bytes', name: 'empty.odt', data: Buffer.alloc(0) },
    { id: 'odt-not-a-zip', name: 'text.odt', data: md('plain text renamed to odt\n'.repeat(200)) },
    { id: 'odt-empty-zip', name: 'emptyzip.odt', data: rawZip([]) },
    { id: 'odt-no-content-part', name: 'nocontent.odt', data: rawZip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' }]) },
    { id: 'odt-content-part-is-garbage', name: 'garbage.odt', data: rawZip([{ name: 'content.xml', data: 'garbage <<< \u0000' }]) },
    { id: 'odt-deflate-stream-corrupted', name: 'badflate.odt', data: rawZip(readZip(B.odt).map((e) => (e.name === 'content.xml' ? { ...e, precompressed: Buffer.from(Array.from({ length: 300 }, () => rng.int(0, 255))), method: 8 } : e))) },
    { id: 'odt-central-directory-offset-past-end', name: 'cdoff.odt', data: patch(B.odt, (b, z) => b.writeUInt32LE(b.length + 1000, z.eocd + 16)) },
    { id: 'odt-docx-with-odt-extension', name: 'wrongkind.odt', data: B.docx },
    { id: 'odt-lists-nested-300', name: 'list300.odt', data: odtXml(nestList(300)) },
    { id: 'odt-lists-nested-3000', name: 'list3000.odt', data: odtXml(nestList(3000)) },
    { id: 'odt-table-columns-repeated-1000000000', name: 'colrep.odt', data: odtXml('<table:table table:name="T"><table:table-column table:number-columns-repeated="1000000000"/><table:table-row><table:table-cell table:number-columns-repeated="1000000000"><text:p>a</text:p></table:table-cell></table:table-row></table:table>') },
    { id: 'odt-table-rows-repeated-1000000000', name: 'rowrep.odt', data: odtXml('<table:table table:name="T"><table:table-column/><table:table-row table:number-rows-repeated="1000000000"><table:table-cell><text:p>a</text:p></table:table-cell></table:table-row></table:table>') },
    { id: 'odt-table-rows-spanned-negative', name: 'rowspan.odt', data: odtXml('<table:table table:name="T"><table:table-column/><table:table-row><table:table-cell table:number-rows-spanned="-5" table:number-columns-spanned="0"><text:p>a</text:p></table:table-cell></table:table-row></table:table>') },
    { id: 'odt-spaces-repeated-2000000000', name: 'spaces.odt', data: odtXml('<text:p>a<text:s text:c="2000000000"/>b</text:p><text:p>c<text:s text:c="-5"/>d<text:tab/></text:p>') },
    { id: 'odt-heading-level-999999', name: 'level.odt', data: odtXml('<text:h text:outline-level="999999">x</text:h><text:h text:outline-level="-3">y</text:h><text:h text:outline-level="abc">z</text:h><text:p>after</text:p>') },
    { id: 'odt-draw-frames-missing-images', name: 'frame.odt', data: odtXml('<text:p><draw:frame><draw:image xlink:href="Pictures/missing.png"/></draw:frame><draw:frame><draw:image xlink:href="../../../etc/passwd"/></draw:frame>after</text:p>') },
  ];

  // ===== EPUB =====
  const epubWith = (over) => rawZip(readZip(B.epub).map((e) => over(e)).filter(Boolean));
  const readText = (e) => e.data.toString('utf8');
  G.epub = [
    ...truncations('book', 'epub', B.epub),
    { id: 'epub-zero-bytes', name: 'empty.epub', data: Buffer.alloc(0) },
    { id: 'epub-not-a-zip', name: 'text.epub', data: md('plain text renamed to epub\n'.repeat(200)) },
    { id: 'epub-empty-zip', name: 'emptyzip.epub', data: rawZip([]) },
    { id: 'epub-no-container-xml', name: 'nocontainer.epub', data: epubWith((e) => (e.name === 'META-INF/container.xml' ? null : e)) },
    { id: 'epub-container-points-to-missing-package', name: 'missingopf.epub', data: epubWith((e) => (e.name === 'META-INF/container.xml' ? { ...e, data: Buffer.from(readText(e).replace('OEBPS/content.opf', 'nowhere/missing.opf')) } : e)) },
    { id: 'epub-package-with-no-spine', name: 'nospine.epub', data: epubWith((e) => (e.name === 'OEBPS/content.opf' ? { ...e, data: Buffer.from(readText(e).replace(/<spine>[\s\S]*<\/spine>/, '<spine/>')) } : e)) },
    { id: 'epub-spine-refers-to-missing-items', name: 'badspine.epub', data: epubWith((e) => (e.name === 'OEBPS/content.opf' ? { ...e, data: Buffer.from(readText(e).replace(/<spine>[\s\S]*<\/spine>/, '<spine><itemref idref="ghost"/><itemref idref="ghost2"/></spine>')) } : e)) },
    { id: 'epub-manifest-paths-escape-the-package', name: 'escape.epub', data: epubWith((e) => (e.name === 'OEBPS/content.opf' ? { ...e, data: Buffer.from(readText(e).replace(/href="chap-1.xhtml"/, 'href="../../../../etc/passwd"').replace('href="nav.xhtml"', 'href="/absolute/nav.xhtml"')) } : e)) },
    { id: 'epub-package-is-garbage', name: 'garbageopf.epub', data: epubWith((e) => (e.name === 'OEBPS/content.opf' ? { ...e, data: Buffer.from('<<<< not xml \u0000') } : e)) },
    { id: 'epub-chapter-is-binary', name: 'binarychap.epub', data: epubWith((e) => (e.name === 'OEBPS/chap-1.xhtml' ? { ...e, data: Buffer.from(Array.from({ length: 5000 }, () => rng.int(0, 255))) } : e)) },
    { id: 'epub-chapter-truncated', name: 'cutchap.epub', data: epubWith((e) => (e.name === 'OEBPS/chap-1.xhtml' ? { ...e, data: e.data.subarray(0, Math.floor(e.data.length / 2)) } : e)) },
    { id: 'epub-chapter-nested-400-deep', name: 'deepchap.epub', data: epubWith((e) => (e.name === 'OEBPS/chap-1.xhtml' ? { ...e, data: Buffer.from(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${'<div>'.repeat(400)}x${'</div>'.repeat(400)}</body></html>`) } : e)) },
    { id: 'epub-1000-chapters', name: 'many.epub', data: (() => {
      const items = Array.from({ length: 1000 }, (_, i) => i);
      return rawZip([
        { name: 'mimetype', data: 'application/epub+zip' },
        { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
        { name: 'c.opf', data: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>many</dc:title></metadata><manifest>${items.map((i) => `<item id="i${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${items.map((i) => `<itemref idref="i${i}"/>`).join('')}</spine></package>` },
        ...items.map((i) => ({ name: `c${i}.xhtml`, data: `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter ${i}</h1><p>text ${i}</p></body></html>` })),
      ]);
    })() },
    { id: 'epub-spine-lists-the-same-chapter-20-times', name: 'repeat.epub', data: epubWith((e) => (e.name === 'OEBPS/content.opf' ? { ...e, data: Buffer.from(readText(e).replace(/<spine>[\s\S]*<\/spine>/, '<spine>' + '<itemref idref="c1"/>'.repeat(20) + '</spine>')) } : e)) },
    { id: 'epub-central-directory-offset-past-end', name: 'cdoff.epub', data: patch(B.epub, (b, z) => b.writeUInt32LE(b.length + 1000, z.eocd + 16)) },
    { id: 'epub-docx-with-epub-extension', name: 'wrongkind.epub', data: B.docx },
    { id: 'epub-note-links-cycle', name: 'notes.epub', data: epubWith((e) => (e.name === 'OEBPS/chap-1.xhtml' ? { ...e, data: Buffer.from(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><p>a<a epub:type="noteref" href="#n1">1</a></p><aside id="n1" epub:type="footnote"><p>see <a epub:type="noteref" href="#n1">1</a> and <a epub:type="noteref" href="#n2">2</a></p></aside><aside id="n2" epub:type="footnote"><p>back <a epub:type="noteref" href="#n1">1</a></p></aside></body></html>`) } : e)) },
  ];

  // ===== extension lies and zero-byte files of every extension =====
  const lies = [];
  const sources = { docx: B.docx, odt: B.odt, epub: B.epub, html: B.html, rtf: B.rtf, md: B.md, txt: B.txt, xml: B.xml };
  const claimed = ['txt', 'html', 'md', 'rtf', 'xml', 'docx', 'odt', 'epub', 'zip', 'doc', 'ebrl'];
  for (const [real, data] of Object.entries(sources)) for (const as of claimed) {
    if (real === as) continue;
    if ((real === 'html' || real === 'md' || real === 'txt') && ['html', 'md', 'txt'].includes(as)) continue;     // those are all just text: not a lie worth a child
    lies.push({ id: `${real}-contents-named-.${as}`, name: `lie.${as}`, data });
  }
  G.lies = lies;
  const EXTS = ['xml', 'nimas', 'dtbook', 'html', 'htm', 'xhtml', 'md', 'markdown', 'txt', 'rtf', 'docx', 'docm', 'dotx', 'doc', 'dot', 'odt', 'ott', 'fodt', 'epub', 'ebrl', 'ebraille', 'zip', 'pdf', 'png', 'xlsx', 'unknownext', 'noext'];
  G.zero = [];
  for (const ext of EXTS) {
    G.zero.push({ id: `0-bytes-.${ext}`, name: ext === 'noext' ? 'noext' : `zero.${ext}`, data: Buffer.alloc(0) });
    G.zero.push({ id: `1-byte-.${ext}`, name: ext === 'noext' ? 'noext' : `one.${ext}`, data: Buffer.from('x') });
  }

  // ===== SOLO items: bombs, entity expansion, XXE, nesting depth =====
  const solo = [];
  const zip1gb = (kind) => {
    // A real deflate bomb: one part that inflates to 1 GiB (a valid prefix, then spaces), a few KB-1 MB on disk.
    const GB = 1 << 30;
    const head = kind === 'docx' ? '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>start</w:t></w:r></w:p>' : kind === 'odt' ? '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>start</text:p>' : '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>start</p>';
    const tail = kind === 'docx' ? '</w:body></w:document>' : kind === 'odt' ? '</office:text></office:body></office:document-content>' : '</body></html>';
    const inflater = zlib.createDeflateRaw({ level: 9 });
    const chunks = [];
    inflater.on('data', (c) => chunks.push(c));
    const chunk = Buffer.alloc(1 << 20, 0x20);
    inflater.write(head);
    for (let i = 0; i < GB / chunk.length; i++) inflater.write(chunk);
    inflater.end(tail);
    return new Promise((resolve) => inflater.on('end', () => {
      const comp = Buffer.concat(chunks);
      const part = kind === 'docx' ? 'word/document.xml' : kind === 'odt' ? 'content.xml' : 'OEBPS/chap-1.xhtml';
      const base = kind === 'docx' ? readZip(B.docx) : kind === 'odt' ? readZip(B.odt) : readZip(B.epub);
      resolve(rawZip(base.map((e) => (e.name === part ? { name: e.name, data: Buffer.alloc(0), precompressed: comp, method: 8, claimUncompressed: GB, crc: 0 } : e))));
    }));
  };
  for (const kind of ['docx', 'odt', 'epub']) solo.push({ id: `zip-bomb-1gb-inflates-in-${kind}`, name: `bomb.${kind}`, make: () => zip1gb(kind), solo: true });

  // Billion laughs and its quadratic cousin
  const laughs = (rootOpen, rootClose, inner) => {
    const lv = ['<!ENTITY l0 "ha">'];
    for (let i = 1; i <= 9; i++) lv.push(`<!ENTITY l${i} "${`&l${i - 1};`.repeat(10)}">`);
    return `<?xml version="1.0"?>\n<!DOCTYPE ${rootOpen.match(/<([\w:]+)/)[1]} [${lv.join('')}]>\n${rootOpen}${inner.replace('@@', '&l9;')}${rootClose}`;
  };
  const quad = (rootOpen, rootClose, inner) => `<?xml version="1.0"?>\n<!DOCTYPE ${rootOpen.match(/<([\w:]+)/)[1]} [<!ENTITY big "${'x'.repeat(100000)}">]>\n${rootOpen}${inner.replace('@@', '&big;'.repeat(5000))}${rootClose}`;
  const NS_DT = '<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>';
  const NS_DT_END = '</level1></bodymatter></book></dtbook>';
  const W_OPEN = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  solo.push({ id: 'entity-billion-laughs-in-nimas', name: 'laughs.xml', data: Buffer.from(laughs(NS_DT, NS_DT_END, '<p>@@</p>')), solo: true, extra: { maxModelChars: 2000000 } });
  solo.push({ id: 'entity-quadratic-blowup-in-nimas', name: 'quad.xml', data: Buffer.from(quad(NS_DT, NS_DT_END, '<p>@@</p>')), solo: true, extra: { maxModelChars: 2000000 } });
  solo.push({ id: 'entity-billion-laughs-in-html', name: 'laughs.html', data: Buffer.from(laughs('<html xmlns="http://www.w3.org/1999/xhtml"><body>', '</body></html>', '<p>@@</p>')), solo: true, extra: { maxModelChars: 2000000 } });
  solo.push({ id: 'entity-billion-laughs-in-docx', name: 'laughs.docx', data: rawZip([{ name: 'word/document.xml', data: laughs(W_OPEN, '</w:body></w:document>', '<w:p><w:r><w:t>@@</w:t></w:r></w:p>') }]), solo: true, extra: { maxModelChars: 2000000 } });
  solo.push({ id: 'entity-billion-laughs-in-odt', name: 'laughs.odt', data: rawZip([{ name: 'content.xml', data: laughs('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>', '</office:text></office:body></office:document-content>', '<text:p>@@</text:p>') }]), solo: true, extra: { maxModelChars: 2000000 } });
  solo.push({ id: 'entity-billion-laughs-in-epub-chapter', name: 'laughs.epub', data: epubWith((e) => (e.name === 'OEBPS/chap-1.xhtml' ? { ...e, data: Buffer.from(laughs('<html xmlns="http://www.w3.org/1999/xhtml"><body>', '</body></html>', '<p>@@</p>')) } : e)), solo: true, extra: { maxModelChars: 2000000 } });
  // XXE: a file the test owns (the canary), a local HTTP address the test listens on, a parameter entity, XInclude
  const canaryUrl = 'file://' + canaryPath;
  const CANARY = 'EXTREME-XXE-CANARY';
  const xxe = (id, name, make, token) => solo.push({ id, name, data: make(), solo: true, token, extra: { mustNotContain: [CANARY] } });
  xxe('xxe-file-entity-in-nimas', 'xxe.xml', () => Buffer.from(`<?xml version="1.0"?>\n<!DOCTYPE dtbook [<!ENTITY x SYSTEM "${canaryUrl}">]>\n${NS_DT}<p>before &x; after</p>${NS_DT_END}`));
  xxe('xxe-http-entity-in-nimas', 'xxe2.xml', () => Buffer.from(`<?xml version="1.0"?>\n<!DOCTYPE dtbook [<!ENTITY x SYSTEM "${httpBase}/nimas-entity">]>\n${NS_DT}<p>before &x; after</p>${NS_DT_END}`), 'nimas-entity');
  xxe('xxe-external-dtd-in-nimas', 'xxe3.xml', () => Buffer.from(`<?xml version="1.0"?>\n<!DOCTYPE dtbook SYSTEM "${httpBase}/evil.dtd">\n${NS_DT}<p>text</p>${NS_DT_END}`), 'evil.dtd');
  xxe('xxe-parameter-entity-in-nimas', 'xxe4.xml', () => Buffer.from(`<?xml version="1.0"?>\n<!DOCTYPE dtbook [<!ENTITY % p SYSTEM "${httpBase}/param.dtd"> %p;]>\n${NS_DT}<p>text</p>${NS_DT_END}`), 'param.dtd');
  xxe('xxe-xinclude-in-nimas', 'xxe5.xml', () => Buffer.from(`<?xml version="1.0"?>\n<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:xi="http://www.w3.org/2001/XInclude"><book><bodymatter><level1><p><xi:include href="${canaryUrl}" parse="text"/></p><xi:include href="${httpBase}/xinclude"/></level1></bodymatter></book></dtbook>`), 'xinclude');
  xxe('xxe-file-entity-in-html', 'xxe.html', () => Buffer.from(`<?xml version="1.0"?>\n<!DOCTYPE html [<!ENTITY x SYSTEM "${canaryUrl}">]>\n<html xmlns="http://www.w3.org/1999/xhtml"><body><p>before &x; after</p><img src="${httpBase}/img-src"/><link rel="stylesheet" href="${httpBase}/css-link"/><iframe src="${httpBase}/iframe"></iframe></body></html>`), ['img-src', 'css-link', 'iframe']);
  xxe('xxe-file-entity-in-docx', 'xxe.docx', () => rawZip([{ name: 'word/document.xml', data: `<?xml version="1.0"?>\n<!DOCTYPE w:document [<!ENTITY x SYSTEM "${canaryUrl}"><!ENTITY y SYSTEM "${httpBase}/docx-entity">]>\n${W_OPEN}<w:p><w:r><w:t>before &x; &y; after</w:t></w:r></w:p></w:body></w:document>` }]), 'docx-entity');
  xxe('xxe-file-entity-in-odt', 'xxe.odt', () => rawZip([{ name: 'content.xml', data: `<?xml version="1.0"?>\n<!DOCTYPE c [<!ENTITY x SYSTEM "${canaryUrl}"><!ENTITY y SYSTEM "${httpBase}/odt-entity">]>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>before &x; &y; after</text:p></office:text></office:body></office:document-content>` }]), 'odt-entity');
  xxe('xxe-file-entity-in-epub-package', 'xxe.epub', () => epubWith((e) => (e.name === 'OEBPS/chap-1.xhtml' ? { ...e, data: Buffer.from(`<?xml version="1.0"?>\n<!DOCTYPE html [<!ENTITY x SYSTEM "${canaryUrl}"><!ENTITY y SYSTEM "${httpBase}/epub-entity">]>\n<html xmlns="http://www.w3.org/1999/xhtml"><body><p>before &x; &y; after</p></body></html>`) } : e)), 'epub-entity');

  // Nesting depth. 400 is within what a browser's own parser will hand over (HTML5 parsers stop at about 512 open elements);
  // 5000 is the task's number: only xmldom in Node produces a tree that deep, and the readers still must not crash.
  const deepXml = (open, close, n, inner = 'deep') => Buffer.from(`<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${open.repeat(n)}${inner}${close.repeat(n)}</level1></bodymatter></book></dtbook>`);
  for (const n of [400, 5000]) {
    const X = n === 5000 ? { extra: { unreachableNote: 'depth 5000 is beyond what a browser builds (its HTML parser stops at about 512 levels, its XML parser at about 2,000); only the Node DOM makes a tree this deep, so this is not a failure a transcriber can meet today' } } : {};
    solo.push({ id: `nest-${n}-nimas-level`, name: `level${n}.xml`, data: deepXml('<level>', '</level>', n, '<h1>deep</h1><p>text</p>'), solo: true, ...X });
    solo.push({ id: `nest-${n}-nimas-list`, name: `list${n}.xml`, data: deepXml('<list type="ul"><li>x', '</li></list>', n), solo: true, ...X });
    solo.push({ id: `nest-${n}-nimas-inline-em`, name: `em${n}.xml`, data: deepXml('<p>', '</p>', 1, '<em>'.repeat(n) + 'deep' + '</em>'.repeat(n)), solo: true, ...X });
    solo.push({ id: `nest-${n}-nimas-blockquote`, name: `bq${n}.xml`, data: deepXml('<blockquote>', '</blockquote>', n, '<p>deep</p>'), solo: true, ...X });
    solo.push({ id: `nest-${n}-nimas-table`, name: `tbl${n}.xml`, data: deepXml('<table><tbody><tr><td>', '</td></tr></tbody></table>', n), solo: true, ...X });
    solo.push({ id: `nest-${n}-nimas-mathml`, name: `math${n}.xml`, data: Buffer.from(`<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><book><bodymatter><level1><p><m:math>${'<m:mrow>'.repeat(n)}<m:mi>x</m:mi>${'</m:mrow>'.repeat(n)}</m:math></p></level1></bodymatter></book></dtbook>`), solo: true, ...X });
    solo.push({ id: `nest-${n}-html-div`, name: `div${n}.html`, data: nest('<div>', '</div>', n), solo: true, ...X });
    solo.push({ id: `nest-${n}-html-span`, name: `span${n}.html`, data: nest('<span>', '</span>', n), solo: true, ...X });
    solo.push({ id: `nest-${n}-html-list`, name: `list${n}.html`, data: nest('<ul><li>', '</li></ul>', n), solo: true, ...X });
    solo.push({ id: `nest-${n}-html-table`, name: `table${n}.html`, data: nest('<table><tr><td>', '</td></tr></table>', n), solo: true, ...X });
    solo.push({ id: `nest-${n}-html-blockquote`, name: `bq${n}.html`, data: nest('<blockquote>', '</blockquote>', n), solo: true, ...X });
    solo.push({ id: `nest-${n}-html-font-unclosed`, name: `font${n}.html`, data: Buffer.from('<body>' + '<font>'.repeat(n) + 'text'), solo: true, ...X });
  }
  G.solo = solo;
  return G;
}

export const CANARY_TEXT = 'EXTREME-XXE-CANARY';
