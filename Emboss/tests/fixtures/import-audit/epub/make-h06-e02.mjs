// Writes the two fixtures of the HTML / EPUB import fixes (30 Sep 2026): html/h06-web-page-css.html and epub/e02-nonlinear-notes.epub.
//   node Emboss/tests/fixtures/import-audit/epub/make-h06-e02.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from '../../../../web/zip.mjs';
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const html = `<!DOCTYPE html>
<html lang="en" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8">
<title>Audit HTML web page CSS</title>
<!-- What Google Docs and Word write when a document is saved as a web page: the look is in style rules and style attributes. -->
<style type="text/css">
.c1 { font-weight: 700 }
.c2 { font-style: italic; text-decoration: underline }
.c3 { text-transform: uppercase }
.c4 { font-variant: small-caps }
.c5 { font-weight: 400; font-style: normal }
.c9 { display: none }
h2 { font-weight: bold }
@media print { .c1 { font-weight: 400 } }
</style>
</head>
<body>
<b style="font-weight:normal;" id="docs-internal-guid-audit">
<h2>Web page CSS heading alphacssheading</h2>
<p dir="ltr"><span class="c1">alphac1bold</span> <span class="c2">alphac2italicunder</span> <span class="c3">alphac3upper</span> <span class="c4">alphac4smallcaps</span> <span class="c5">alphac5plain</span></p>
<p style="font-weight:bold">alphapbold whole paragraph with <i>italic</i> inside</p>
<div style="font-style:italic"><p>alphadivitalic first</p><p>alphadivitalic second</p></div>
<p>Inline <span style="font-weight:600">alphaw600</span>, <span style="font-style:oblique">alphaoblique</span>, <ins>alphains</ins>, <cite>alphacitedfn</cite>, <q>alphaquote <q>alphainner</q></q>.</p>
<p class="c9">alphahiddenclass is not transcribed</p>
<p>Visible <span class="c9">alphahiddenspan </span>text <span style="visibility:hidden">alphavisibilityhidden </span>after <span aria-hidden="true">alphaariahiddenspan </span>hidden things.</p>
<blockquote><p>alphabqpara quoted paragraph.</p><footer>alphabqfooter, <cite>alphabqcite</cite></footer></blockquote>
<blockquote><div>alphabqdiv first</div><ul><li>alphabqli1</li><li>alphabqli2</li></ul></blockquote>
<p>A line<br>alphabrsecondline<br>alphabrthirdline</p>
<pre>alphaprefirst
    alphapreindented
alphaprethird</pre>
<ol reversed><li>alphaolrev1</li><li>alphaolrev2</li><li>alphaolrev3</li></ol>
<ol start="7"><li>alphaolstart1</li><li value="20">alphaolvalue</li><li>alphaolafter</li></ol>
<dl><dt>alphadlterm</dt><dd>alphadldef1</dd><dd>alphadldef2</dd></dl>
<ul><li><input type="checkbox" checked disabled> alphataskdone</li><li><input type="checkbox"> alphataskopen</li></ul>
<p>Footnote<sup><a role="doc-noteref" href="#fnaudit1" id="rnaudit1">1</a></sup> reference, then a page break<span epub:type="pagebreak" role="doc-pagebreak" id="pgaudit" title="9"></span> inside the paragraph.</p>
<aside role="doc-footnote" id="fnaudit1"><p>alphafootnotebody <a role="doc-backlink" href="#rnaudit1">&#8617;</a></p></aside>
<svg width="30" height="30" role="img" aria-labelledby="svgt"><title id="svgt">alphasvgtitle</title><circle cx="15" cy="15" r="10"/></svg>
<table><tr><th>alphahead1</th><th>alphahead2</th></tr><tr><td><p>alphacellp1</p><p>alphacellp2</p></td><td>alphacell<br>alphabr</td></tr></table>
</b>
</body>
</html>
`;
fs.writeFileSync(`${FIX}/html/h06-web-page-css.html`, html);

// ---- the EPUB: a non-linear cover (image only, in an svg) and a non-linear notes file, notes referenced from two chapters,
// XHTML empty elements for the page breaks, and a style sheet that hides and bolds.
const X = '<?xml version="1.0" encoding="utf-8"?>\n';
const xhtml = (title, body) => `${X}<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${title}</title><link rel="stylesheet" type="text/css" href="../css/book.css"/></head><body>${body}</body></html>`;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
const files = [
  { name: 'mimetype', text: 'application/epub+zip' },
  { name: 'META-INF/container.xml', text: `${X}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
  { name: 'EPUB/package.opf', text: `${X}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:aaaaaaaa-bbbb-cccc-dddd-000000000002</dc:identifier><dc:title>Audit non-linear notes</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-30T00:00:00Z</meta></metadata><manifest><item id="nav" href="xhtml/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="css/book.css" media-type="text/css"/><item id="cover" href="xhtml/cover.xhtml" media-type="application/xhtml+xml" properties="svg"/><item id="coverimg" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="ch1" href="xhtml/ch1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="xhtml/ch2.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="xhtml/notes.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover" linear="no"/><itemref idref="nav" linear="no"/><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="notes" linear="no"/></spine></package>` },
  { name: 'EPUB/css/book.css', text: '@charset "utf-8";\n.hidden { display: none; }\n.lead { font-variant: small-caps; }\n.em { font-style: italic; }\n.strong { font-weight: bold; }\nh1 { font-weight: bold; text-align: center; }\n' },
  { name: 'EPUB/images/cover.png', data: PNG },
  { name: 'EPUB/xhtml/nav.xhtml', text: xhtml('Contents', '<nav epub:type="toc"><h1>Contents alphanavtitle</h1><ol><li><a href="ch1.xhtml">Chapter one alphanavch1</a></li></ol></nav>') },
  { name: 'EPUB/xhtml/cover.xhtml', text: xhtml('Cover', '<section epub:type="cover"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet"><title>alphacovertitle</title><image width="10" height="10" xlink:href="../images/cover.png"/></svg></section>') },
  { name: 'EPUB/xhtml/ch1.xhtml', text: xhtml('Chapter one', '<section epub:type="chapter"><h1>Chapter one alphach1</h1><p class="lead">alphaleadwords of the first paragraph<a epub:type="noteref" role="doc-noteref" href="notes.xhtml#en1" id="rn1"><sup>1</sup></a> continue here<span epub:type="pagebreak" role="doc-pagebreak" id="pg2" title="2"/> and after the page break.</p><p class="hidden">alphaepubhidden</p><p>Second<a epub:type="noteref" href="notes.xhtml#en2" id="rn2">2</a> paragraph with <span class="strong">alphaboldclass</span> and <span class="em">alphaitalicclass</span>.</p></section>') },
  { name: 'EPUB/xhtml/ch2.xhtml', text: xhtml('Chapter two', '<section epub:type="chapter"><h1>Chapter two alphach2</h1><p>Third note<a epub:type="noteref" href="notes.xhtml#en3" id="rn3">3</a> here.</p></section>') },
  { name: 'EPUB/xhtml/notes.xhtml', text: xhtml('Notes', '<section epub:type="endnotes"><h1>Notes alphanotestitle</h1><ol><li id="en1" epub:type="endnote"><p>alphaendnote1 <a href="ch1.xhtml#rn1">back</a></p></li><li id="en2" epub:type="endnote"><p>alphaendnote2 <a href="ch1.xhtml#rn2" epub:type="backlink">↩</a></p></li><li id="en3" epub:type="endnote"><p>alphaendnote3 <a href="ch2.xhtml#rn3">back</a></p></li></ol></section>') },
];
const blob = makeZip(files);
fs.writeFileSync(`${FIX}/epub/e02-nonlinear-notes.epub`, Buffer.from(await blob.arrayBuffer()));
console.log('written');
