// Markdown import (30 Sep 2026, import fix list rows 15f, 28, 37; Emboss/docs/import-feature-checklist.md section 5).
// parseMarkdown reads CommonMark / GitHub-Flavoured Markdown (plus front matter, Pandoc footnotes and `$` maths) and
// builds the SAME model shapes as the HTML reader (parseHtml): where a check can, it compares the two readers' blocks
// directly, so the formatter, the editor and the NIMAS save treat Markdown content exactly like HTML content.
// Sources of the expectations: CommonMark 0.31 (spec examples are cited by number), GFM (tables, task lists,
// strikethrough), Pandoc's Markdown (`$` maths rule, footnotes, `^[inline notes]`), and the decisions IMP-W1..W12
// (docs/decisions.md): a hard break is a forced line break '\n' as the HTML `<br>` now is, a task-list box is "[x]" / "[ ]"
// as in the HTML reader, a picture keeps its description, a footnote is a footnote.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml, parseMarkdown, parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { SCRIPT_MARKS } from '../format/text-style.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const { subOpen, supOpen, end } = SCRIPT_MARKS;
const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
const md = (s) => parseMarkdown(s).blocks;
const html = (s) => parseHtml(s).blocks;
const segsOf = (b) => b.segments || [{ type: 'text', text: b.text }];
const flat = (b) => segsOf(b).map((s) => (s.type === 'math' ? `$${s.latex}$` : s.text || '')).join('');
const allText = (blocks) => JSON.stringify(blocks);

describe('#15f entities and thematic breaks', () => {
  test('named and numeric entities are decoded (CommonMark 6.2 "Entity and numeric character references")', () => {
    const [p] = md('AT&amp;T &copy; 2026 &#8364;5 &#x20AC;6 &lt;b&gt; &hellip;');
    assert.equal(flat(p), 'AT&T © 2026 €5 €6 <b> …');
  });
  test('an entity is literal text: it never starts markup, and an unknown name stays as typed', () => {
    const [p] = md('&ast;not italic&ast; and &notanentity; and &#0;');
    assert.equal(flat(p), '*not italic* and &notanentity; and \uFFFD');
    assert.equal(segsOf(p).some((s) => s.tf), false);
  });
  test('entities are not decoded inside code spans or code blocks', () => {
    const [p, c] = md('Use `&amp;` here.\n\n```\n&copy; &amp;\n```\n');
    assert.ok(segsOf(p).some((s) => s.uncontracted && s.text === '&amp;'));
    assert.equal(c.type, 'code');
    assert.equal(c.text, '&copy; &amp;');
  });
  test('&nbsp; is a space, as the HTML reader reads it', () => {
    assert.equal(flat(md('a&nbsp;b')[0]), flat(html('<p>a&nbsp;b</p>')[0]));
  });
  for (const hr of ['---', '***', '___', '- - -', '* * *', '_ _ _', '-----', '  ***  ']) {
    test(`thematic break "${hr}" is a break block between paragraphs (CommonMark 4.1)`, () => {
      const b = md(`Before\n\n${hr}\n\nAfter`);
      assert.deepEqual(b.map((x) => x.type), ['para', 'break', 'para'], JSON.stringify(b));
      assert.deepEqual(b[1], { type: 'break', kind: 'line' });
    });
  }
  test('"---" under a paragraph line is a setext heading, not a break (CommonMark 4.3)', () => {
    const b = md('Heading text\n---\n\nBody');
    assert.deepEqual(b.map((x) => x.type), ['heading', 'para']);
    assert.equal(b[0].level, 2);
    assert.equal(b[0].text, 'Heading text');
  });
  test('"***" and "___" under a paragraph line are breaks (only - and = underline a heading)', () => {
    assert.deepEqual(md('Text\n***').map((x) => x.type), ['para', 'break']);
    assert.deepEqual(md('Text\n___').map((x) => x.type), ['para', 'break']);
  });
  test('"---" at the very top opens YAML front matter, which gives the title; it is not a break', () => {
    const m = parseMarkdown('---\ntitle: My Title\nauthor: Me\n---\n\nBody text');
    assert.equal(m.title, 'My Title');
    assert.deepEqual(m.blocks.map((x) => x.type), ['para']);
  });
  test('a top "---" with no closing line is a break (there is no front matter)', () => {
    assert.deepEqual(md('---\n\nBody').map((x) => x.type), ['break', 'para']);
  });
  test('"---" inside a fenced code block stays code', () => {
    assert.deepEqual(md('```\n---\n```').map((x) => [x.type, x.text]), [['code', '---']]);
  });
});

describe('#28 inline HTML', () => {
  test('<br> is a forced line break, as the HTML reader makes it', () => {
    assert.deepEqual(md('one<br>two<br/>three<br />four'), html('<p>one<br>two<br/>three<br />four</p>'));
    assert.equal(segsOf(md('one<br>two')[0])[0].text, 'one\ntwo');
  });
  test('<sub> and <sup> are the script markers U+E000 / U+E001 / U+E002', () => {
    const b = md('H<sub>2</sub>O and x<sup>2</sup>');
    assert.deepEqual(b, html('<p>H<sub>2</sub>O and x<sup>2</sup></p>'));
    assert.equal(b[0].segments[0].text, `H${subOpen}2${end}O and x${supOpen}2${end}`);
  });
  test('<em> <i> <strong> <b> <u> give the typeform bits; combined by nesting', () => {
    const b = md('<em>a</em> <i>b</i> <strong>c</strong> <b>d</b> <u>e</u> <b><i>f</i></b>');
    const want = html('<p><em>a</em> <i>b</i> <strong>c</strong> <b>d</b> <u>e</u> <b><i>f</i></b></p>');
    assert.deepEqual(b, want);
    const tfOf = (t) => b[0].segments.find((s) => s.text === t)?.tf;
    assert.equal(tfOf('a'), TF_ITALIC);
    assert.equal(tfOf('c'), TF_BOLD);
    assert.equal(tfOf('e'), TF_UNDERLINE);
    assert.equal(tfOf('f'), TF_BOLD | TF_ITALIC);
  });
  test('<s> <del> <strike> are struck through (UEB 9.5.1 transcriber-defined typeform), as in HTML', () => {
    assert.deepEqual(md('a <s>b</s> <del>c</del> <strike>d</strike>'), html('<p>a <s>b</s> <del>c</del> <strike>d</strike></p>'));
    assert.equal(md('<s>b</s>')[0].segments[0].transcriberTypeform, 'strike');
  });
  test('<code> and <kbd> are code text (uncontracted), like a Markdown code span', () => {
    const segs = md('Press <kbd>Ctrl</kbd> then <code>run()</code>.')[0].segments;
    assert.ok(segs.some((s) => s.text === 'Ctrl' && s.uncontracted));
    assert.ok(segs.some((s) => s.text === 'run()' && s.uncontracted));
  });
  test('<span> is just its text; an unknown tag is dropped and its text kept', () => {
    assert.equal(allText(md('a <span class="x">b</span> <foo attr="1">c</foo> <mark>d</mark>')), allText(html('<p>a <span class="x">b</span> <foo attr="1">c</foo> <mark>d</mark></p>')));
    assert.equal(flat(md('a <span class="x">b</span> <foo attr="1">c</foo>')[0]), 'a b c');
  });
  test('<a href> is a link, as in HTML', () => {
    assert.deepEqual(md('See <a href="https://x.org/a">the page</a> now'), html('<p>See <a href="https://x.org/a">the page</a> now</p>'));
  });
  test('HTML comments are removed: inline, on their own line, and across lines', () => {
    assert.equal(flat(md('a <!-- hidden --> b')[0]), 'a b');
    assert.deepEqual(md('before\n\n<!-- a comment\nover two lines -->\n\nafter').map(flat), ['before', 'after']);
    assert.equal(flat(md('x <!-- one\ntwo --> y')[0]), 'x y');
  });
  test('a comment inside fenced code is code', () => {
    assert.equal(md('```\n<!-- keep me -->\n```')[0].text, '<!-- keep me -->');
  });
  test('a lang attribute on inline HTML keeps a foreign-language run (input/lang.mjs)', () => {
    const b = md('On the long road to the coast she said <span lang="fr">bonjour mes amis</span> twice to the people who were waiting for the train.');
    const fr = b[0].segments.find((s) => s.lang);
    assert.ok(fr && fr.text === 'bonjour mes amis' && fr.lang === 'fr', JSON.stringify(b));
    assert.equal(flat(b[0]), 'On the long road to the coast she said bonjour mes amis twice to the people who were waiting for the train.');
  });
  test('prose that only looks like a tag keeps its words: "a<b and c>d", "Vec<T>", "x < y", "if a<b, c>d"', () => {
    assert.equal(flat(md('if a<b and c>d then Vec<T> holds x < y')[0]), 'if a<b and c>d then Vec<T> holds x < y');
    assert.equal(flat(md('when a<b, c>d')[0]), 'when a<b, c>d');
  });
  test('a tag with a quoted attribute containing spaces is still a tag', () => {
    assert.equal(flat(md('see <span title="a b c" class=x>words</span> here')[0]), 'see words here');
    assert.equal(flat(md('<Widget size="big">inner</Widget> text')[0]), 'inner text');
  });
  test('an inline tag never prints as literal text', () => {
    const t = allText(md('x <kbd>k</kbd> <u>u</u> <br> <sup>s</sup> <custom-el>c</custom-el>'));
    assert.doesNotMatch(t, /<\/?(kbd|u|br|sup|custom-el)/);
  });
});

describe('#28 HTML blocks are read by the HTML reader', () => {
  test('a <div> block is read as HTML (its text, not literal tags)', () => {
    const b = md('<div class="note">HTML block text</div>');
    assert.deepEqual(b, html('<div class="note">HTML block text</div>'));
    assert.doesNotMatch(allText(b), /<div/);
  });
  test('a <table> block becomes a table, including blank lines inside it', () => {
    const src = '<table>\n<tr><th>A</th><th>B</th></tr>\n\n<tr><td>1</td><td><b>2</b></td></tr>\n</table>';
    const b = md(src);
    assert.deepEqual(b, html(src));
    assert.equal(b[0].type, 'table');
    assert.deepEqual(b[0].headers, ['A', 'B']);
  });
  test('<details><summary> keeps the summary and the Markdown inside after a blank line', () => {
    const b = md('<details>\n<summary>More</summary>\n\nHidden *words* here\n\n</details>');
    assert.ok(allText(b).includes('More'));
    const p = b.find((x) => flat(x).includes('Hidden'));
    assert.ok(p.segments.some((s) => s.text === 'words' && s.tf === TF_ITALIC));
  });
  test('<figure> with <img> and <figcaption> keeps the picture and its caption', () => {
    const src = '<figure>\n<img src="a.png" alt="A cat">\n<figcaption>My cat</figcaption>\n</figure>';
    assert.deepEqual(md(src), html(src));
  });
  test('an HTML block does not swallow the Markdown after its blank line', () => {
    const b = md('<div>inside</div>\n\n# Heading\n\nAfter');
    assert.deepEqual(b.map((x) => x.type), ['para', 'title', 'para']);
  });
  test('<hr> in an HTML block is a break block', () => {
    assert.deepEqual(md('<hr>').map((x) => x.type), ['break']);
    assert.deepEqual(md('<div>a</div>\n<hr/>\n<div>b</div>').map((x) => x.type), ['para', 'break', 'para']);
  });
  test('a <script> or <style> block is dropped with its content', () => {
    const b = md('<style>\np { color: red }\n</style>\n\nVisible');
    assert.deepEqual(b.map(flat), ['Visible']);
  });
  test('<pre> is a code block with its lines kept', () => {
    const b = md('<pre>\nline one\n  line two\n</pre>');
    assert.deepEqual(b.map((x) => [x.type, x.text]), [['code', 'line one\n  line two']]);
  });
});

describe('#28 images', () => {
  test('![alt](src "title") is a picture block whose description is the alt text, as HTML <img alt>', () => {
    const b = md('![A red bicycle](images/bike.png "My bike")');
    assert.deepEqual(b, [{ type: 'graphic', src: 'images/bike.png', alt: 'A red bicycle' }]);
    assert.deepEqual(b, html('<p><img src="images/bike.png" alt="A red bicycle"></p>'));
  });
  test('a base64 data: image is a picture; its data is never text', () => {
    const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DwnwEJMGFzAGIhAgQSz9RoAAAAAElFTkSuQmCC';
    const b = md(`Before ![tiny dot](${data} "a title") and ![](${data}) after`);
    const pics = b.filter((x) => x.type === 'graphic');
    assert.equal(pics.length, 2);
    assert.equal(pics[0].alt, 'tiny dot');
    assert.equal(pics[0].src, data);
    const text = b.filter((x) => x.type !== 'graphic').map(allText).join('');
    assert.doesNotMatch(text, /iVBOR|base64/);
    assert.equal(flat(b.find((x) => x.type === 'para')), 'Before and after');
  });
  test('an image in the middle of a paragraph: the picture block, then the paragraph without it (as HTML)', () => {
    assert.deepEqual(md('Text ![inline](b.png) more'), html('<p>Text <img src="b.png" alt="inline"> more</p>'));
  });
  test('an image alone in its paragraph is only a picture block', () => {
    assert.deepEqual(md('![only](o.png)').map((x) => x.type), ['graphic']);
  });
  test('an image inside a link: the picture, and no link text is invented', () => {
    const b = md('[![Build status](badge.svg)](https://ci.example/run)');
    assert.deepEqual(b, [{ type: 'graphic', src: 'badge.svg', alt: 'Build status' }]);
  });
  test('an image in a link with words: the words stay a link', () => {
    const b = md('[see ![chart](c.png) here](https://x.org)');
    assert.deepEqual(b.map((x) => x.type), ['graphic', 'para']);
    assert.ok(b[1].segments.every((s) => s.href === 'https://x.org'));
    assert.equal(flat(b[1]), 'see here');
  });
  test('an image with no alt but a title uses the title as its description (nothing is lost)', () => {
    assert.equal(md('![](p.png "A sunset over hills")')[0].alt, 'A sunset over hills');
  });
  test('a reference-style image', () => {
    assert.deepEqual(md('![logo][l]\n\n[l]: img/logo.png "Logo"'), [{ type: 'graphic', src: 'img/logo.png', alt: 'logo' }]);
  });
  test('an image in a heading comes before it; in a list item it goes with that item; the text stays', () => {
    const b = md('# Title ![i](i.png)\n\n- item ![j](j.png)\n');
    assert.deepEqual(b.map((x) => x.type), ['graphic', 'title', 'list']);
    assert.equal(b[0].alt, 'i');
    assert.equal(b[1].text, 'Title');
    const item = b[2].items[0];
    assert.equal(item.text, 'item');
    assert.deepEqual(item.blocks, [{ type: 'graphic', src: 'j.png', alt: 'j' }]);
  });
  test('an HTML <img> inline is the same picture', () => {
    assert.deepEqual(md('a <img src="x.png" alt="pic"> b'), html('<p>a <img src="x.png" alt="pic"> b</p>'));
  });
});

describe('#28 footnotes', () => {
  const noteOf = (blocks, k = 0) => blocks.filter((x) => x.type === 'footnote')[k];
  test('[^1] with its definition: a noteref in the text and a footnote block right after the citing paragraph', () => {
    const b = md('Some claim[^1] is made.\n\nNext paragraph.\n\n[^1]: The source of the claim.\n');
    assert.deepEqual(b.map((x) => x.type), ['para', 'footnote', 'para']);
    const ref = b[0].segments.find((s) => s.type === 'noteref');
    assert.equal(ref.text, '1');
    assert.ok(ref.idref);
    assert.equal(b[1].id, ref.idref);
    assert.equal(b[1].text, 'The source of the claim.');
    assert.equal(flat(b[0]).replace(/\d/, ''), 'Some claim is made.');
  });
  test('the same shapes as the HTML reader: { type:"noteref", text, idref } and { type:"footnote", text, id }', () => {
    const b = md('A[^n] B.\n\n[^n]: Note text.');
    const h = html('<p>A<a class="footnote-ref" href="#fn1">1</a> B.</p><aside role="doc-footnote" id="fn1"><p>Note text.</p></aside>');
    assert.deepEqual(Object.keys(b[0].segments.find((s) => s.type === 'noteref')).sort(), Object.keys(h[0].segments.find((s) => s.type === 'noteref')).sort());
    assert.deepEqual(Object.keys(b[1]).sort(), Object.keys(h[1]).sort());
    assert.equal(b[1].type, h[1].type);
  });
  test('notes are numbered in order of first reference; a label need not be a number', () => {
    const b = md('One[^b] two[^a].\n\n[^a]: Alpha.\n[^b]: Beta.');
    const refs = b[0].segments.filter((s) => s.type === 'noteref');
    assert.deepEqual(refs.map((r) => r.text), ['1', '2']);
    assert.equal(noteOf(b, 0).text, 'Beta.');
    assert.equal(noteOf(b, 1).text, 'Alpha.');
  });
  test('a continuation line (indented) joins the definition; a second indented paragraph makes a two-paragraph note', () => {
    const b = md('Text[^1] and more[^2].\n\n[^1]: First line\n    continued here.\n[^2]: Para one.\n\n    Para two.\n\nAfter.');
    assert.equal(noteOf(b, 0).text, 'First line continued here.');
    const n2 = noteOf(b, 1);
    assert.deepEqual(n2.blocks.map((p) => p.text), ['Para one.', 'Para two.']);
    assert.equal(b.at(-1).text, 'After.');
  });
  test('a note keeps its own emphasis', () => {
    const n = noteOf(md('x[^1]\n\n[^1]: A *stressed* word.'));
    assert.equal(n.segments.find((s) => s.text === 'stressed').tf, TF_ITALIC);
  });
  test('a Pandoc inline note ^[text] is a note as well', () => {
    const b = md('Claim^[An inline note.] continues.');
    assert.deepEqual(b.map((x) => x.type), ['para', 'footnote']);
    assert.equal(b[1].text, 'An inline note.');
    assert.equal(b[0].segments.find((s) => s.type === 'noteref').idref, b[1].id);
  });
  test('a definition nobody refers to is kept as a note (nothing is lost)', () => {
    const b = md('Plain paragraph.\n\n[^orphan]: Unreferenced note text.');
    assert.equal(noteOf(b).text, 'Unreferenced note text.');
  });
  test('[^x] with no definition is literal text', () => {
    assert.equal(flat(md('Text[^x] here.')[0]), 'Text[^x] here.');
  });
  test('a reference in a list item or a table cell places the note after that block', () => {
    const b = md('- item[^1]\n- other\n\nAfter\n\n[^1]: Note.');
    assert.deepEqual(b.map((x) => x.type), ['list', 'footnote', 'para']);
    const t = md('| a | b |\n|---|---|\n| c[^1] | d |\n\n[^1]: Note.');
    assert.deepEqual(t.map((x) => x.type), ['table', 'footnote']);
  });
  test('the footnote text is not repeated as a paragraph and "[^" never appears in the model', () => {
    const b = md('A[^1]\n\n[^1]: Words of the note.');
    assert.equal(allText(b).includes('[^'), false);
    assert.equal(b.filter((x) => x.type === 'para').length, 1);
  });
  test('the save writes the note and reads it back', () => {
    const xml = exportToNimasXml(parseMarkdown('Claim[^1] made.\n\n[^1]: The note.'));
    assert.match(xml, /<note/);
    assert.match(xml, /The note\./);
    const back = parseDtbook(xml);
    assert.ok(allText(back.blocks).includes('The note.'));
  });
});

describe('#28 emphasis, escapes, code, maths (CommonMark 6.2 - 6.4)', () => {
  const segs = (s) => md(s)[0].segments;
  test('***x*** is bold italic with no asterisks left', () => {
    const s = segs('a ***x*** b');
    assert.deepEqual(s.map((g) => [g.text, g.tf || 0]), [['a ', 0], ['x', TF_BOLD | TF_ITALIC], [' b', 0]]);
  });
  test('bold inside italic and italic inside bold', () => {
    assert.deepEqual(segs('*one **two** three*').map((g) => [g.text, g.tf]), [['one ', TF_ITALIC], ['two', TF_ITALIC | TF_BOLD], [' three', TF_ITALIC]]);
    assert.deepEqual(segs('**one *two* three**').map((g) => [g.text, g.tf]), [['one ', TF_BOLD], ['two', TF_BOLD | TF_ITALIC], [' three', TF_BOLD]]);
    assert.deepEqual(segs('_one __two__ three_').map((g) => [g.text, g.tf]), [['one ', TF_ITALIC], ['two', TF_ITALIC | TF_BOLD], [' three', TF_ITALIC]]);
  });
  test('an underscore inside a word is literal: snake_case_name, 2_000_000, file_name.txt', () => {
    const p = md('Call snake_case_name or use 2_000_000 in file_name.txt now.')[0];
    assert.equal(p.text, 'Call snake_case_name or use 2_000_000 in file_name.txt now.');
  });
  test('an asterisk inside a word does emphasise (CommonMark): un*frigging*believable', () => {
    assert.equal(segs('un*frigging*believable').find((g) => g.tf)?.text, 'frigging');
  });
  test('a spaced star is literal: 2 * 3 * 4', () => {
    assert.equal(md('2 * 3 * 4')[0].text, '2 * 3 * 4');
  });
  test('backslash escapes give the literal character with no backslash', () => {
    const p = md('\\*not italic\\* \\_x\\_ \\# \\[a\\] \\\\ \\` \\< \\! 1\\. \\~')[0];
    assert.equal(p.text, '*not italic* _x_ # [a] \\ ` < ! 1. ~');
  });
  test('a backslash before an ordinary letter stays (C:\\path)', () => {
    assert.equal(md('C:\\path\\to')[0].text, 'C:\\path\\to');
  });
  test('an escaped character is not markup: \\*a\\* is text, \\*\\*b\\*\\* is text, \\[x\\](y) is no link', () => {
    assert.equal(md('\\*\\*b\\*\\* \\[x\\](y)')[0].text, '**b** [x](y)');
  });
  test('a backslash at the end of a line is a hard break; two trailing spaces too; both a forced line break "\\n"', () => {
    const p = md('first\\\nsecond  \nthird\nfourth')[0];
    assert.equal(p.segments.map((s) => s.text).join(''), 'first\nsecond\nthird fourth');
  });
  test('a hard break in a heading or table cell reads as a space (as in the HTML reader)', () => {
    assert.equal(md('A\\\nB\n===')[0].text, 'A B');
    assert.equal(md('| a | b |\n|---|---|\n| x<br>y | z |')[0].rows[0][0], 'x y');
  });
  test('formatting inside link text', () => {
    const s = segs('[a **bold** and *italic* link](https://x.org/p)');
    assert.deepEqual(s.map((g) => [g.text, g.tf || 0, g.href]), [['a ', 0, 'https://x.org/p'], ['bold', TF_BOLD, 'https://x.org/p'], [' and ', 0, 'https://x.org/p'], ['italic', TF_ITALIC, 'https://x.org/p'], [' link', 0, 'https://x.org/p']]);
  });
  test('a link title is not part of the address', () => {
    assert.equal(segs('[t](https://x.org/a "the title") and [u](<https://x.org/b c> \'t2\')').find((g) => g.text === 't').href, 'https://x.org/a');
    assert.equal(segs('[u](https://x.org/b "t2")').find((g) => g.text === 'u').href, 'https://x.org/b');
  });
  test('an autolink <https://...> is a link whose text is the address, without the brackets', () => {
    const s = segs('See <https://example.org/auto> and <me@example.org>.');
    assert.ok(s.some((g) => g.text === 'https://example.org/auto' && g.href === 'https://example.org/auto'));
    assert.ok(s.some((g) => g.text === 'me@example.org' && g.href === 'mailto:me@example.org'));
  });
  test('code spans: double backticks hold a backtick; one space at each end is dropped (CommonMark 6.1)', () => {
    assert.deepEqual(segs('a ``x ` y`` b').find((g) => g.uncontracted)?.text, 'x ` y');
    assert.deepEqual(segs('a ` code ` b').find((g) => g.uncontracted)?.text, 'code');
    assert.deepEqual(segs('a `` `x` `` b').find((g) => g.uncontracted)?.text, '`x`');
    assert.equal(segs('a `*not italic*` b').find((g) => g.uncontracted).text, '*not italic*');
    assert.equal(segs('a ``` ``x`` ``` b').find((g) => g.uncontracted).text, '``x``');
  });
  test('an unmatched backtick is literal', () => {
    assert.equal(md('a ` b')[0].text, 'a ` b');
  });
  test('$5 and $10 are dollar amounts, not maths (Pandoc: a closing $ is not followed by a digit)', () => {
    const p = md('It costs $5 and then $10 more, or $20,000 in all.')[0];
    assert.equal(p.text, 'It costs $5 and then $10 more, or $20,000 in all.');
    assert.equal(p.segments, undefined);
  });
  test('real maths still works: $x^2$, $x_1$, $$..$$, and amounts beside it', () => {
    const m = segs('Let $x^2 + 1$ and $x_1$ cost $5.').filter((g) => g.type === 'math');
    assert.deepEqual(m.map((g) => g.latex), ['x^2 + 1', 'x_1']);
    // A paragraph that is only $$…$$ is a displayed equation, a math block (parse.mjs's own "$$...$$ -> a standalone display-math
    // block"; the editor's and NIMAS reader's A26 rule) — changed 3 Oct 2026 (A89: Quick Mode → editor → Quick Mode changed the braille).
    const d = md('$$\\frac{a}{b}$$')[0];
    assert.equal(d.type, 'math');
    assert.equal(d.latex, '\\frac{a}{b}');
    assert.equal(md('a \\$5 and \\$6')[0].text, 'a $5 and $6');
  });
  test('an opening $ followed by a space or a closing $ preceded by a space is not maths', () => {
    assert.equal(md('a $ x$ b and $y $ c')[0].text, 'a $ x$ b and $y $ c');
  });
  test('maths is not read inside code spans', () => {
    assert.equal(segs('`$a$` and $b$').filter((g) => g.type === 'math').length, 1);
  });
  test('\\( .. \\) is inline maths when it holds LaTeX; ordinary \\( \\) stays parentheses', () => {
    assert.deepEqual(segs('Also \\(a_n \\cos x\\) here').filter((g) => g.type === 'math').map((g) => g.latex), ['a_n \\cos x']);
    assert.equal(md('\\(see note\\)')[0].text, '(see note)');
  });
  test('strikethrough ~~x~~ is the transcriber-defined typeform; ~ alone is literal', () => {
    assert.equal(segs('a ~~gone~~ b').find((g) => g.transcriberTypeform)?.text, 'gone');
    assert.equal(md('about ~5 or ~6')[0].text, 'about ~5 or ~6');
  });
  test('soft line breaks are spaces; runs of spaces collapse', () => {
    assert.equal(md('one\ntwo   three')[0].text, 'one two three');
  });
  test('emphasis does not run across a blank line (two paragraphs)', () => {
    assert.deepEqual(md('*a\n\nb*').map((x) => x.text), ['*a', 'b*']);
  });
});

describe('#37 tables', () => {
  const tableOf = (s) => md(s).find((x) => x.type === 'table');
  test('cells keep bold, italic, code and links as segments (as HTML table cells)', () => {
    const t = tableOf('| Name | Notes |\n|---|---|\n| **bold** | *it* and `code` |\n| [link](https://x.org/t) | H<sub>2</sub>O |');
    const h = html('<table><tr><th>Name</th><th>Notes</th></tr><tr><td><b>bold</b></td><td><i>it</i> and <code>code</code></td></tr><tr><td><a href="https://x.org/t">link</a></td><td>H<sub>2</sub>O</td></tr></table>')[0];
    assert.equal(t.rows[0][0].segments[0].tf, TF_BOLD);
    assert.equal(t.rows[0][0].text, 'bold');
    assert.equal(t.rows[0][1].segments.find((s) => s.text === 'it').tf, TF_ITALIC);
    assert.ok(t.rows[0][1].segments.find((s) => s.text === 'code').uncontracted);
    assert.equal(t.rows[1][0].segments[0].href, 'https://x.org/t');
    assert.equal(t.rows[1][1], `H${subOpen}2${end}O`);      // the script markers, in a plain cell (the HTML reader's cell is the same string)
    assert.deepEqual(t.rows[1][0], h.rows[1][0]);
    assert.deepEqual(t.rows[0][0], h.rows[0][0]);
    assert.deepEqual(t.headers, ['Name', 'Notes']);
  });
  test('a plain cell stays a plain string', () => {
    const t = tableOf('| a | b |\n|---|---|\n| 1 | 2 |');
    assert.deepEqual(t, { type: 'table', headers: ['a', 'b'], rows: [['1', '2']] });
  });
  test('a table without leading or trailing pipes', () => {
    const t = tableOf('Col X | Col Y\n--- | ---\n1 | 2\n3 | 4\n');
    assert.deepEqual(t, { type: 'table', headers: ['Col X', 'Col Y'], rows: [['1', '2'], ['3', '4']] });
  });
  test('an escaped pipe stays in its cell', () => {
    const t = tableOf('| a | b |\n|---|---|\n| x \\| y | z |');
    assert.deepEqual(t.rows[0], ['x | y', 'z']);
  });
  test('column alignment colons are accepted (alignment itself is not used)', () => {
    const t = tableOf('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    assert.deepEqual(t.rows, [['1', '2', '3']]);
  });
  test('an empty cell is an empty string; a short row is padded', () => {
    const t = tableOf('| a | b |\n|---|---|\n| | x |\n| only |');
    assert.deepEqual(t.rows, [['', 'x'], ['only', '']]);
  });
  test('a single "-" row, or a pipe line with no delimiter row, is not a table', () => {
    assert.equal(tableOf('a | b\n-\n'), undefined);
    assert.equal(tableOf('Just | text\nmore text\n'), undefined);
    assert.equal(md('a | b\n-')[0].type, 'heading');
  });
  test('a header with a different cell count from the delimiter row is not a table (GFM)', () => {
    assert.equal(tableOf('| a | b |\n|---|\n| 1 | 2 |'), undefined);
  });
  test('the table ends at a blank line; text after it is a paragraph', () => {
    assert.deepEqual(md('| a |\n|---|\n| 1 |\n\nAfter').map((x) => x.type), ['table', 'para']);
  });
  test('an image in a cell follows the table as a picture, like an HTML cell picture', () => {
    const b = md('| a | b |\n|---|---|\n| ![pic](p.png) | x |');
    assert.deepEqual(b.map((x) => x.type), ['table', 'graphic']);
    assert.equal(b[1].alt, 'pic');
  });
  test('no cell text is lost: a row longer than its header keeps its extra cells', () => {
    const t = tableOf('| a | b |\n|---|---|\n| 1 | 2 | 3 |');
    assert.deepEqual(t.rows[0], ['1', '2', '3']);
  });
});

describe('lists (CommonMark 5.2 - 5.4, GFM task lists)', () => {
  const lists = (s) => md(s).filter((x) => x.type === 'list');
  const lv = (l) => l.items.map((i) => [i.text, i.level || 0, i.marker]);
  test('a loose list (blank lines between items) is ONE list', () => {
    const l = lists('- a\n\n- b\n\n- c');
    assert.equal(l.length, 1);
    assert.deepEqual(lv(l[0]), [['a', 0, '•'], ['b', 0, '•'], ['c', 0, '•']]);
  });
  test('a loose numbered list keeps counting (1. 2. 3.), one list', () => {
    const l = lists('1. a\n\n2. b\n\n3. c');
    assert.equal(l.length, 1);
    assert.deepEqual(l[0].items.map((i) => i.marker), ['1.', '2.', '3.']);
  });
  test('nesting is by indentation relative to the parent: 2, 3 and 4 spaces all give one level deeper', () => {
    for (const ind of ['  ', '   ', '    ']) {
      const l = lists(`- a\n${ind}- b\n${ind}${ind}- c\n- d`);
      assert.deepEqual(lv(l[0]).map((x) => x[1]), [0, 1, 2, 0], `indent "${ind}"`);
    }
  });
  test('numbered nesting: 3-space and 4-space child under "1."; a bullet child under a number', () => {
    const l = lists('1. a\n   1. b\n      1. c\n   2. d\n2. e');
    assert.deepEqual(lv(l[0]), [['a', 0, '1.'], ['b', 1, '1.'], ['c', 2, '1.'], ['d', 1, '2.'], ['e', 0, '2.']]);
    const l2 = lists('1. a\n    - b\n');
    assert.deepEqual(lv(l2[0]), [['a', 0, '1.'], ['b', 1, '•']]);
    const l3 = lists('1. a\n  - b\n');
    assert.deepEqual(lv(l3[0]).map((x) => x[1]), [0, 1]);
  });
  test('a level is never skipped: a deeper indent under a first-level item is level 1, not 2 or 3', () => {
    const l = lists('- a\n        - b\n');
    assert.deepEqual(lv(l[0]).map((x) => x[1]), [0, 1]);
    const l2 = lists('- a\n    - b\n  - c\n');
    assert.deepEqual(lv(l2[0]).map((x) => x[1]), [0, 1, 1]);
  });
  test('the mixed markers - * + at one level are one list; ordered items take start, then count up', () => {
    const l = lists('- a\n* b\n+ c');
    assert.equal(l.length, 1);
    assert.equal(l[0].items.length, 3);
    const n = lists('5. a\n6. b\n7) c');
    assert.deepEqual(n[0].items.map((i) => i.marker), ['5.', '6.', '7)']);
    const ones = lists('1. a\n1. b\n1. c');
    assert.deepEqual(ones[0].items.map((i) => i.marker), ['1.', '2.', '3.']);
  });
  test('a bullet list followed by a numbered list, with no blank line, are two lists', () => {
    assert.deepEqual(md('- a\n- b\n1. c\n2. d').map((x) => x.type), ['list', 'list']);
  });
  test('task lists: "[x]" and "[ ]" stay as the HTML reader reads a check box', () => {
    const l = lists('- [x] done\n- [ ] todo\n- [X] big X');
    const h = html('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>')[0];
    assert.deepEqual(l[0].items.slice(0, 2), h.items);
    assert.equal(l[0].items[2].text, '[x] big X');
  });
  test('an item with another paragraph, code, and a nested list keeps them all', () => {
    const b = md('1. First\n\n   More text.\n\n   ```\n   code\n   ```\n\n   - nested\n2. Second');
    const l = b.find((x) => x.type === 'list');
    assert.equal(l.items[0].text, 'First');
    assert.deepEqual(l.items[0].blocks.map((x) => x.type), ['para', 'code']);
    assert.deepEqual(l.items.map((i) => [i.text, i.level || 0]), [['First', 0], ['nested', 1], ['Second', 0]]);
  });
  test('a wrapped line (lazy continuation) joins its item', () => {
    assert.equal(lists('- one\ntwo\n- three')[0].items[0].text, 'one two');
  });
  test('the list ends at a paragraph after a blank line', () => {
    assert.deepEqual(md('- a\n- b\n\nAfter the list.').map((x) => x.type), ['list', 'para']);
  });
  test('emphasis and links in an item keep segments; a marker-like number mid-line is text', () => {
    const l = lists('- **bold** and [a link](https://x.org)\n- plain 2026. text');
    assert.equal(l[0].items[0].segments[0].tf, TF_BOLD);
    assert.equal(l[0].items[0].segments[2].href, 'https://x.org');
    assert.equal(l[0].items[1].text, 'plain 2026. text');
  });
  test('"2026. A sentence" at the start of a line is a numbered list item starting at 2026 (CommonMark)', () => {
    assert.equal(lists('2026. A sentence.')[0].items[0].marker, '2026.');
  });
  test('an empty item is dropped; "-" alone between paragraphs is a setext underline or an empty item', () => {
    assert.equal(lists('- a\n-\n- b')[0].items.length, 2);
  });
  test('a number like "3.5 litres" is not a list', () => {
    assert.deepEqual(md('3.5 litres of water').map((x) => x.type), ['para']);
  });
});

describe('headings and code', () => {
  test('closing # marks are removed from an ATX heading; a # inside the text stays', () => {
    const b = md('## Two ##\n\n### Three ###   \n\n# C# language #\n\n#### Four\\###');
    assert.deepEqual(b.map((x) => x.text), ['Two', 'Three', 'C# language', 'Four###']);
    assert.deepEqual(b.map((x) => x.type), ['heading', 'heading', 'title', 'heading']);
    assert.equal(b[0].level, 2);
  });
  test('{#id .class key=value} attributes are removed from a heading', () => {
    const b = md('## Heading {#my-id .class}\n\nSetext {#x}\n------\n\n### Plain {braces} stay');
    assert.deepEqual(b.map((x) => x.text), ['Heading', 'Setext', 'Plain {braces} stay']);
    assert.equal(md('## Pandoc order ## {#pid .c}')[0].text, 'Pandoc order');
    assert.equal(md('## Other order {#pid} ##')[0].text, 'Other order');
  });
  test('an empty ATX heading is skipped; "#hashtag" is text', () => {
    assert.deepEqual(md('#\n\n#hashtag').map((x) => x.type), ['para']);
    assert.equal(md('#hashtag')[0].text, '#hashtag');
  });
  test('the first level-1 heading is the title; later ones are headings', () => {
    const m = parseMarkdown('# Book\n\n# Part\n');
    assert.equal(m.title, 'Book');
    assert.deepEqual(m.blocks.map((x) => x.type), ['title', 'heading']);
  });
  test('a multi-line setext heading holds all its lines', () => {
    const b = md('Line one\nline two\n===');
    assert.deepEqual([b[0].type, b[0].text], ['title', 'Line one line two']);
  });
  test('heading emphasis and sub/superscript are kept as segments', () => {
    const h = md('## Water *H*<sub>2</sub>O')[0];
    assert.ok(h.segments.some((s) => s.tf === TF_ITALIC));
    assert.ok(h.text.includes(subOpen));
  });
  test('~~~ fences and ``` fences are code; the info string is dropped; a longer fence holds a shorter one', () => {
    assert.deepEqual(md('~~~python\nx = 1\n  y = 2\n~~~').map((x) => [x.type, x.text]), [['code', 'x = 1\n  y = 2']]);
    assert.deepEqual(md('````\n```\ninner\n```\n````').map((x) => [x.type, x.text]), [['code', '```\ninner\n```']]);
    assert.deepEqual(md('```js\nlet a;\n```\nafter').map((x) => x.type), ['code', 'para']);
  });
  test('an unclosed fence runs to the end of the document', () => {
    assert.deepEqual(md('```\nlet a;\nlet b;').map((x) => [x.type, x.text]), [['code', 'let a;\nlet b;']]);
  });
  test('four-space indented code is a code block; its lines and inner indentation are kept', () => {
    const b = md('Intro\n\n    code line 1\n      code line 2\n\n    code line 3\n\nOutro');
    assert.deepEqual(b.map((x) => x.type), ['para', 'code', 'para']);
    assert.equal(b[1].text, 'code line 1\n  code line 2\n\ncode line 3');
  });
  test('an indented line continues a paragraph, it does not start code (CommonMark example 107)', () => {
    assert.deepEqual(md('Foo\n    bar').map((x) => x.type), ['para']);
  });
  test('a tab at the start of a line is four spaces of indent', () => {
    assert.deepEqual(md('\tcode').map((x) => [x.type, x.text]), [['code', 'code']]);
  });
  test('inside a list item an indented block is code only beyond the item indent', () => {
    const l = md('- item\n\n      code in item\n').find((x) => x.type === 'list');
    assert.deepEqual(l.items[0].blocks.map((x) => x.type), ['code']);
  });
});

describe('block quotes', () => {
  test('nested quotes keep every line of text, all in one quotation', () => {
    const b = md('> outer one\n>\n> > inner alpha\n> > inner beta\n>\n> outer two');
    assert.deepEqual(b.map((x) => x.style), ['quote', 'quote', 'quote']);
    assert.deepEqual(b.map((x) => x.text), ['outer one', 'inner alpha inner beta', 'outer two']);
    assert.equal(new Set(b.map((x) => x.blockquoteId)).size, 1);
    assert.ok(b[0].blockquoteId != null);
  });
  test('a lazy continuation line belongs to the quoted paragraph', () => {
    assert.deepEqual(md('> first\nsecond line\n\nAfter').map((x) => x.text), ['first second line', 'After']);
  });
  test('an attribution line (an em dash, then a name) is its own block, as the HTML reader makes it', () => {
    const b = md('> To be, or not to be.\n> \u2014 William Shakespeare');
    assert.deepEqual(b.map((x) => x.type), ['para', 'attribution']);
    assert.equal(b[1].text, '\u2014 William Shakespeare');
    assert.equal(b[0].text, 'To be, or not to be.');
    assert.equal(b[0].blockquoteId, b[1].blockquoteId);
    assert.ok(b[0].blockquoteId != null);
    const c = md('> Quote text here.\n>\n> -- Someone Else');
    assert.deepEqual(c.map((x) => x.type), ['para', 'attribution']);
  });
  test('a quote that is only a dash line keeps it as quoted text', () => {
    assert.deepEqual(md('> \u2014 nothing else').map((x) => x.type), ['para']);
  });
  test('a quote holds a heading, list and code, each tagged with the quotation id', () => {
    const b = md('> ## Head\n>\n> - one\n> - two\n>\n> ```\n> code\n> ```');
    assert.deepEqual(b.map((x) => x.type), ['heading', 'list', 'code']);
    assert.equal(new Set(b.map((x) => x.blockquoteId)).size, 1);
  });
});

describe('other things in the checklist', () => {
  test('reference links resolve from definitions anywhere, are not shown, and a title is not in the address', () => {
    const b = md('See [the docs][d] and [d] and [other].\n\n[D]: https://docs.example/d "Docs"\n');
    assert.equal(b.length, 1);
    const s = b[0].segments;
    assert.equal(s.find((g) => g.text === 'the docs').href, 'https://docs.example/d');
    assert.equal(flat(b[0]), 'See the docs and d and [other].');
  });
  test('a link reference definition inside a code block is code, not a definition', () => {
    const b = md('```\n[a]: http://x.org\n```\n');
    assert.equal(b[0].text, '[a]: http://x.org');
  });
  test('Windows and old-Mac line endings read like Unix ones', () => {
    assert.deepEqual(md('# T\r\n\r\npara one\r\nstill one\r\n\r\n- a\r\n- b\r\n').map((x) => x.type), ['title', 'para', 'list']);
    assert.equal(md('a\rb')[0].text, 'a b');
  });
  test('the old reading still holds: plain paragraphs, plain emphasis, tables and links', () => {
    assert.deepEqual(md('plain words'), [{ type: 'para', text: 'plain words' }]);
    assert.deepEqual(md('a *b* c')[0].segments, [{ type: 'text', text: 'a ' }, { type: 'text', text: 'b', tf: TF_ITALIC }, { type: 'text', text: ' c' }]);
  });
  test('an empty or blank document gives no blocks', () => {
    assert.deepEqual(parseMarkdown(''), { title: null, blocks: [] });
    assert.deepEqual(parseMarkdown('   \n\n  '), { title: null, blocks: [] });
    assert.deepEqual(parseMarkdown(null), { title: null, blocks: [] });
  });
  test('a very deeply nested quote or list does not crash or hang', () => {
    const deep = `${'> '.repeat(500)}words`;
    assert.ok(allText(md(deep)).includes('words'));
    const lst = Array.from({ length: 300 }, (_, i) => `${' '.repeat(i * 2)}- x${i}`).join('\n');
    assert.ok(md(lst).length >= 1);
  });
  test('pathological inline input finishes quickly', () => {
    const t0 = Date.now();
    md('`'.repeat(5000) + ' ' + '*_'.repeat(3000) + ' [' .repeat(2000) + ' $'.repeat(3000) + ' <'.repeat(2000));
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });
  test('the whole-model save of a document using every feature is well-formed and keeps the words', () => {
    const src = '# Title\n\nA ***strong*** claim[^1] with H<sub>2</sub>O and ![pic](p.png) &amp; `code`.\n\n- [x] done\n  - nested\n\n| a | **b** |\n|---|---|\n| 1 | 2 |\n\n> quote\n> \u2014 Author\n\n---\n\n    indented code\n\n[^1]: The note.\n';
    const xml = exportToNimasXml(parseMarkdown(src));
    const dom = new DOMParser({ onError: (l) => { if (l === 'error' || l === 'fatalError') throw new Error('not well-formed'); } }).parseFromString(xml, 'text/xml');
    assert.ok(dom.documentElement);
    for (const w of ['strong', 'claim', 'The note.', 'done', 'nested', 'indented code', 'Author']) assert.ok(xml.includes(w), w);
    assert.ok(!xml.includes('&amp;amp;'));
  });
});

describe('table cells: a pipe inside a code span stays in its cell', () => {
  test('`a|b` is one code cell (Pandoc rule); an escaped pipe in code is a pipe', () => {
    const t = md('| a | b |\n|---|---|\n| `x|y` | 2 |\n| `p\\|q` | 3 |').find((x) => x.type === 'table');
    assert.equal(t.rows[0].length, 2);
    assert.equal(t.rows[0][0], 'x|y');
    assert.equal(t.rows[1][0], 'p|q');
  });
});

// The braille of Markdown content: the model must go through both layouts without trouble, and what the old reader printed as
// literal text (entities, tags, base64) must not reach the page.
const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument } = await import(path.join(EMBOSS_DIR, 'format', 'document.mjs'));
const { styledTranslate } = await import(path.join(EMBOSS_DIR, 'format', 'text-style.mjs'));
const louis = await import(path.join(EMBOSS_DIR, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS_DIR, 'liblouis', 'tables'));
const g2 = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const g1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const brfOf = (model, mode) => formatDocument(model, { mode, standard: mode, width: 40, depth: 25, translate: styledTranslate(g2, 'faithful', g1), suppressHeader: true });
describe('braille of Markdown content', () => {
  const src = [
    '# Title', '', 'AT&amp;T &copy; 2026 with H<sub>2</sub>O, x<sup>2</sup>, ***strong*** and `code`[^1], $5 and $10.', '',
    '![tiny](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DwnwEJMGFzAGIhAgQSz9RoAAAAAElFTkSuQmCC "t")', '',
    '- [x] done', '  - nested', '- ```', '  codeonly', '  ```', '',
    '| a | **b** |', '|---|---|', '| 1 | 2 |', '', '> quoted words', '> — An Author', '', '---', '', '    indented code line', '',
    '[^1]: The note text.', ''].join('\n');
  for (const mode of ['bana', 'ukaaf']) {
    test(`${mode}: the whole document formats; no entity, tag or base64 reaches the page`, () => {
      const model = parseMarkdown(src);
      const brf = brfOf(model, mode);
      assert.ok(brf.length > 100);
      assert.doesNotMatch(brf, /\\X/);
      assert.ok(brf.split('\n').length < 120, 'the picture data is not brailled');
      assert.ok(brf.toUpperCase().includes('CODEONLY'), 'a list item that holds only a code block still brailles its code');
      assert.ok(brf.toUpperCase().includes('NOTE'), 'the note text is brailled');
    });
  }
});
