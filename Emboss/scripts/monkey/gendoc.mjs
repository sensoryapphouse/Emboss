// A freshly generated random document for the monkey test (Emboss/scripts/monkey-test.mjs, A89 step 3, Paul 2 Oct 2026:
// "a much wider range of samples"). Every random choice comes from the rng it is given (monkey/prng.mjs), so the same seed and
// session index always give the same file; the file is written under the run's --out folder, so a failure keeps its document.
//
//   genDocument(rng) -> { ext: 'xml' | 'html' | 'md', name, text, features: [..] }
//
// The document is first drawn as an abstract list of blocks (headings 1-6, paragraphs with bold / italic / underline runs, links,
// inline maths, nested lists to depth 6, tables with spans and empty cells, display equations (MathML), footnotes and endnotes,
// a poem, a sidebar, print page numbers, a ⁂ break, pictures with and without a description, and text in other scripts), then
// written out as NIMAS/DTBook XML, HTML or Markdown, whichever the rng picks. A format cannot say everything (Markdown has no
// underline, no spans, no sidebar, no print page numbers): what it cannot say is left out of that file, or written as the nearest
// plain thing; the documents are meant to be varied, not to be equal across formats.

// ---------------------------------------------------------------- words
const EN = ['the', 'river', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'and', 'braille', 'cell', 'dot', 'page', 'line', 'chapter', 'science', 'teacher', 'student', 'reads', 'with', 'fingers', 'because', 'although', 'however', 'together', 'children', 'should', 'would', 'about', 'between', 'through', 'mountain', 'ocean', 'light', 'shadow', 'number', 'letter', 'word', 'sentence', 'paragraph', 'Emboss', 'UEB', 'Nemeth', 'BANA', 'UKAAF', 'Dr.', 'Mrs.', 'e.g.', 'etc.', 'ing', 'ation', 'ough', 'ound', 'ence', 'st', 'ch', 'sh', 'th', 'wh', 'ou', 'er', 'ow'];
const PUNCT = [',', ',', ',', '.', '.', ';', ':', '!', '?', ' —', ' …', '’s', ' (see page 12)', ' "quoted"', " 'single'", ' 3.14', ' 1,000', ' 50%', ' £5', ' $10', ' 12:30', ' 2/3', ' #1', ' a+b', ' x=y', ' [1]', ' {x}', ' A.B.C.'];
const FOREIGN = {
  greek: ['Αλφα', 'βήτα', 'γάμμα', 'Ελλάδα', 'ἄνθρωπος', 'π', 'Ω', 'μ'],
  cyrillic: ['Привет', 'мир', 'книга', 'Москва', 'щука', 'Ёж'],
  hebrew: ['שלום', 'עולם', 'ספר', 'בְּרֵאשִׁית'],
  arabic: ['مرحبا', 'بالعالم', 'كتاب', 'السَّلَامُ'],
  cjk: ['中文', '你好', '世界', '日本語', 'ひらがな', 'カタカナ', '한국어'],
  emoji: ['😀', '👍🏽', '🧑‍🚀', '🇬🇧', '❤️', '🎉'],
  combining: ['é', 'ạ̈', 'ñ', 'Z͡a̴l̵g̷o', 'ǆ', 'ﬁ', '​zero', 'x­y', '½', 'Å', 'ñ', 'ß', 'ø', 'œ'],
};
const SCRIPT_NAMES = Object.keys(FOREIGN);
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------- the abstract document
// inline: { k:'t', s } | { k:'b'|'i'|'u', c:[inline] } | { k:'a', href, c:[inline] } | { k:'m', mml } | { k:'n', id, kind } (note call)
function genWords(rng, n) {
  const w = [];
  for (let i = 0; i < n; i++) w.push(rng.pick(EN) + (rng.chance(0.12) ? rng.pick(PUNCT) : ''));
  return w.join(' ');
}
function genMathML(rng, depth = 0) {
  const leaf = () => rng.weighted([[4, () => `<mi>${rng.pick(['x', 'y', 'a', 'b', 'n', 'θ', 'π'])}</mi>`], [4, () => `<mn>${rng.range(0, 120)}</mn>`], [1, () => `<mi>${rng.pick(['sin', 'cos', 'log'])}</mi>`]])();
  const op = () => `<mo>${rng.pick(['+', '−', '=', '×', '÷', '&lt;', '≤', '≠', '±', '∑', '∫'])}</mo>`;
  if (depth > 2) return leaf();
  return rng.weighted([
    [3, () => leaf() + op() + leaf()],
    [2, () => `<mfrac><mrow>${genMathML(rng, depth + 1)}</mrow><mrow>${genMathML(rng, depth + 1)}</mrow></mfrac>`],
    [2, () => `<msup>${leaf()}<mn>${rng.range(2, 9)}</mn></msup>${op()}${leaf()}`],
    [1, () => `<msqrt>${genMathML(rng, depth + 1)}</msqrt>`],
    [1, () => `<msub>${leaf()}<mn>${rng.range(0, 5)}</mn></msub>${op()}${genMathML(rng, depth + 1)}`],
    [1, () => `<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>${leaf()}`],
    [1, () => `<mrow><mo>(</mo>${genMathML(rng, depth + 1)}<mo>)</mo></mrow>${op()}${leaf()}`],
    [1, () => `<mtable><mtr><mtd>${leaf()}</mtd><mtd>${leaf()}</mtd></mtr><mtr><mtd>${leaf()}</mtd><mtd>${leaf()}</mtd></mtr></mtable>`],
  ])();
}
function genInlines(rng, ctx, opts = {}) {
  const out = [];
  const n = rng.weighted([[5, 1], [4, 2], [3, 4], [1, 7]]);
  for (let i = 0; i < n; i++) {
    const r = rng.next();
    let seg;
    if (r < 0.46 || !rng.chance(ctx.rich)) seg = { k: 't', s: genWords(rng, rng.range(1, 14)) };
    else if (r < 0.56) seg = { k: 'b', c: [{ k: 't', s: genWords(rng, rng.range(1, 4)) }] };
    else if (r < 0.65) seg = { k: 'i', c: [{ k: 't', s: genWords(rng, rng.range(1, 4)) }] };
    else if (r < 0.71) seg = { k: 'u', c: [{ k: 't', s: genWords(rng, rng.range(1, 3)) }] };
    else if (r < 0.74) seg = { k: 'b', c: [{ k: 'i', c: [{ k: 't', s: genWords(rng, rng.range(1, 3)) }] }] };
    else if (r < 0.79) seg = { k: 'a', href: rng.pick(['https://example.org/a?b=c&d=e', 'http://emboss.example/x', 'mailto:someone@example.org', '#target']), c: [{ k: 't', s: genWords(rng, rng.range(1, 3)) }] };
    else if (r < 0.85 && !opts.noMath) seg = { k: 'm', mml: genMathML(rng) };
    else if (r < 0.93) { const sc = rng.pick(SCRIPT_NAMES); seg = { k: 't', s: Array.from({ length: rng.range(1, 4) }, () => rng.pick(FOREIGN[sc])).join(rng.chance(0.2) ? '' : ' ') }; ctx.features.add('script:' + sc); }
    else if (r < 0.97 && !opts.noNotes && ctx.notes.length < 6) { const id = 'n' + (ctx.notes.length + 1); const kind = rng.chance(0.6) ? 'footnote' : 'endnote'; ctx.notes.push({ id, kind, text: genWords(rng, rng.range(3, 20)) }); seg = { k: 'n', id, kind }; }
    else seg = { k: 't', s: rng.pick(PUNCT).trim() + ' ' + genWords(rng, 2) };
    if (seg.k === 'm') ctx.features.add('inline-math');
    if (seg.k === 'n') ctx.features.add('note');
    if (seg.k === 'a') ctx.features.add('link');
    if (seg.k === 'u') ctx.features.add('underline');
    // a space between runs (the word runs carry no spaces at their edges)
    out.push(seg);
    if (i < n - 1) out.push({ k: 't', s: ' ' });
  }
  return out;
}
function genList(rng, ctx, depth, maxDepth) {
  const ordered = rng.chance(0.45);
  const n = rng.range(1, depth === 1 ? 6 : 3);
  const items = [];
  for (let i = 0; i < n; i++) {
    const it = { inl: genInlines(rng, ctx, { noNotes: true }), kids: null };
    if (depth < maxDepth && rng.chance(depth < 3 ? 0.5 : 0.7)) it.kids = genList(rng, ctx, depth + 1, maxDepth);
    items.push(it);
  }
  return { kind: ordered ? 'ol' : rng.weighted([[5, 'ul'], [1, 'pl']]), items, depth };
}
function genTable(rng, ctx) {
  const cols = rng.range(1, 7), rows = rng.range(1, 8);
  const grid = [];
  const taken = new Set();
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (taken.has(r + ',' + c)) continue;
      const cell = { head: r === 0 || (c === 0 && rng.chance(0.15)), text: rng.chance(0.14) ? '' : rng.chance(0.2) ? String(rng.range(0, 9999)) : genWords(rng, rng.range(1, 5)), cs: 1, rs: 1 };
      if (rng.chance(0.12) && c + 1 < cols && !taken.has(r + ',' + (c + 1))) { cell.cs = rng.range(2, Math.min(3, cols - c)); }
      if (rng.chance(0.10) && r + 1 < rows) { cell.rs = rng.range(2, Math.min(3, rows - r)); }
      for (let dr = 0; dr < cell.rs; dr++) for (let dc = 0; dc < cell.cs; dc++) if (dr || dc) taken.add((r + dr) + ',' + (c + dc));
      row.push(cell);
    }
    grid.push(row);
  }
  ctx.features.add('table');
  return { rows: grid, caption: rng.chance(0.4) ? genWords(rng, rng.range(2, 6)) : null };
}

// One block of the document body. `level` is the heading level of the section it sits in (for nesting only).
function genBlock(rng, ctx) {
  // each document has its own mix: a kind of block is rare, normal or common in it (or, now and then, absent)
  const m = (k, w) => w * ctx.mix[k];
  return rng.weighted([
    [16, () => ({ k: 'p', inl: genInlines(rng, ctx) })],
    [m('list', 3), () => ({ k: 'list', list: genList(rng, ctx, 1, rng.weighted([[4, 2], [3, 4], [2, 6]])) })],
    [m('table', 3), () => ({ k: 'table', table: genTable(rng, ctx) })],
    [m('math', 2), () => { ctx.features.add('display-math'); return { k: 'dmath', mml: genMathML(rng) }; }],
    [m('poem', 1.2), () => { ctx.features.add('poem'); return { k: 'poem', lines: Array.from({ length: rng.range(2, 8) }, () => genWords(rng, rng.range(3, 9))) }; }],
    [m('sidebar', 1.2), () => { ctx.features.add('sidebar'); return { k: 'sidebar', title: rng.chance(0.7) ? genWords(rng, rng.range(1, 4)) : null, inl: genInlines(rng, ctx, { noNotes: true }), list: rng.chance(0.3) ? genList(rng, ctx, 1, 2) : null }; }],
    [m('pagenum', 1.2), () => { ctx.features.add('pagenum'); return { k: 'pagenum', n: ctx.page++ }; }],
    [m('break', 1), () => { ctx.features.add('break'); return { k: 'break' }; }],
    [m('img', 2), () => { const alt = rng.chance(0.5) ? genWords(rng, rng.range(1, 8)) : null; ctx.features.add(alt ? 'picture-alt' : 'picture-noalt'); return { k: 'img', alt, caption: rng.chance(0.3) ? genWords(rng, 4) : null }; }],
    [m('quote', 1), () => ({ k: 'quote', inl: genInlines(rng, ctx, { noNotes: true }) })],
    [0.4, () => ({ k: 'p', inl: [] })],   // an empty paragraph
  ])();
}

function genAbstract(rng) {
  const mixOf = () => rng.weighted([[2, 0], [3, 0.3], [6, 1], [3, 2.5]]);
  const ctx = { features: new Set(), notes: [], page: rng.range(1, 40), rich: rng.weighted([[2, 0.05], [3, 0.35], [5, 1]]), mix: { list: mixOf(), table: mixOf(), math: mixOf(), poem: mixOf(), sidebar: mixOf(), pagenum: mixOf(), break: mixOf(), img: mixOf(), quote: mixOf() } };
  const title = genWords(rng, rng.range(1, 5)).replace(/\b\w/, (c) => c.toUpperCase());
  const secs = [];
  // headings may start at any level and skip levels (a real book mostly doesn't, a hostile one does)
  const nsec = rng.weighted([[3, rng.range(1, 3)], [4, rng.range(3, 8)], [2, rng.range(8, 20)]]);
  let level = rng.range(1, 3);
  for (let i = 0; i < nsec; i++) {
    level = Math.max(1, Math.min(6, level + rng.weighted([[5, 0], [3, 1], [2, -1], [1, 2], [1, -2]])));
    if (rng.chance(0.25)) level = rng.range(1, 6);
    ctx.features.add('h' + level);
    const blocks = [];
    const nb = rng.weighted([[2, rng.range(0, 1)], [5, rng.range(2, 6)], [2, rng.range(6, 14)]]);
    for (let j = 0; j < nb; j++) blocks.push(genBlock(rng, ctx));
    secs.push({ level, title: genWords(rng, rng.range(1, 7)), blocks });
  }
  return { title, author: rng.pick(['A. Writer', 'Paul B.', 'Grüße Müller', 'Ελένη Παπά', 'Anon']), secs, notes: ctx.notes, features: ctx.features };
}

// ---------------------------------------------------------------- writers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// a character an XML 1.0 file may not hold is dropped (none of ours are, but a combining sequence must stay whole)
const mmlNs = (mml, prefix) => (prefix ? mml.replace(/<(\/?)([a-z]+)/g, `<$1${prefix}:$2`) : mml);

function inlXml(inl, o) {
  return inl.map((s) => {
    switch (s.k) {
      case 't': return esc(s.s);
      case 'b': return `<strong>${inlXml(s.c, o)}</strong>`;
      case 'i': return `<em>${inlXml(s.c, o)}</em>`;
      case 'u': return `<span class="underline">${inlXml(s.c, o)}</span>`;
      case 'a': return `<a href="${esc(s.href)}">${inlXml(s.c, o)}</a>`;
      case 'm': return `<m:math display="inline">${mmlNs(s.mml, 'm')}</m:math>`;
      case 'n': return `<noteref idref="#${s.id}">${s.id.slice(1)}</noteref>`;
      default: return '';
    }
  }).join('');
}
function listXml(l, o, ind) {
  const type = l.kind === 'ol' ? ' type="ol" enum="1"' : l.kind === 'pl' ? ' type="pl"' : ' type="ul"';
  return `${ind}<list${type}>\n${l.items.map((it) => `${ind}  <li>${inlXml(it.inl, o)}${it.kids ? '\n' + listXml(it.kids, o, ind + '    ') + `\n${ind}  ` : ''}</li>`).join('\n')}\n${ind}</list>`;
}
function tableXml(t, ind) {
  const cell = (c) => { const tag = c.head ? 'th' : 'td'; return `<${tag}${c.cs > 1 ? ` colspan="${c.cs}"` : ''}${c.rs > 1 ? ` rowspan="${c.rs}"` : ''}>${esc(c.text)}</${tag}>`; };
  return `${ind}<table>\n${t.caption ? `${ind}  <caption>${esc(t.caption)}</caption>\n` : ''}${t.rows.map((r) => `${ind}  <tr>${r.map(cell).join('')}</tr>`).join('\n')}\n${ind}</table>`;
}
function blockXml(b, o, ind) {
  switch (b.k) {
    case 'p': return `${ind}<p>${inlXml(b.inl, o)}</p>`;
    case 'list': return listXml(b.list, o, ind);
    case 'table': return tableXml(b.table, ind);
    case 'dmath': return `${ind}<p><m:math display="block">${mmlNs(b.mml, 'm')}</m:math></p>`;
    case 'poem': return `${ind}<poem><linegroup>${b.lines.map((l) => `<line>${esc(l)}</line>`).join('')}</linegroup></poem>`;
    case 'sidebar': return `${ind}<sidebar render="required">${b.title ? `<hd>${esc(b.title)}</hd>` : ''}<p>${inlXml(b.inl, o)}</p>${b.list ? '\n' + listXml(b.list, o, ind + '  ') : ''}</sidebar>`;
    case 'pagenum': return `${ind}<pagenum page="normal">${b.n}</pagenum>`;
    case 'break': return `${ind}<div class="doc-break"><p class="break">⁂ ⁂ ⁂</p></div>`;
    case 'img': return `${ind}<imggroup><img src="pic${o.pics++}.png"${b.alt != null ? ` alt="${esc(b.alt)}"` : ''}/>${b.caption ? `<caption>${esc(b.caption)}</caption>` : ''}</imggroup>`;
    case 'quote': return `${ind}<blockquote><p>${inlXml(b.inl, o)}</p></blockquote>`;
    default: return '';
  }
}
function writeDtbook(d) {
  const o = { pics: 1 };
  // sections nest: a section of level L goes inside the open section of level L-1 (a skipped level just nests less deeply, as a
  // book that jumps from h2 to h5 would in print); level k sections are closed when a section of level <= k starts
  const out = [];
  const stack = [];
  const close = (to) => { while (stack.length && stack[stack.length - 1] >= to) { const l = stack.pop(); out.push('    '.repeat(0) + `</level${l}>`); } };
  const depthOf = (lv) => { let n = 0; for (const s of stack) if (s < lv) n++; return n + 1; };
  for (const s of d.secs) {
    close(s.level);
    // DTBook allows level1..level6 only inside the right parent: a skipped level is written as the next one down
    const lv = Math.min(s.level, depthOf(s.level));
    stack.push(lv);
    out.push(`<level${lv}><h${lv}>${esc(s.title)}</h${lv}>`);
    for (const b of s.blocks) out.push(blockXml(b, o, '  '));
  }
  close(0);
  const notes = d.notes.map((n) => `<note id="${n.id}" class="${n.kind}"><p>${n.id.slice(1)}. ${esc(n.text)}</p></note>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML" version="2005-3" xml:lang="en-GB">
<head>
<meta name="dtb:uid" content="MONKEY-${esc(d.title).replace(/\s+/g, '-')}"/>
<meta name="dc:Title" content="${esc(d.title)}"/>
<meta name="dc:Creator" content="${esc(d.author)}"/>
<meta name="dc:Language" content="en-GB"/>
</head>
<book>
<frontmatter><doctitle>${esc(d.title)}</doctitle><docauthor>${esc(d.author)}</docauthor></frontmatter>
<bodymatter>
${out.join('\n')}
${notes.join('\n')}
</bodymatter>
</book>
</dtbook>
`;
}

function inlHtml(inl) {
  return inl.map((s) => {
    switch (s.k) {
      case 't': return esc(s.s);
      case 'b': return `<b>${inlHtml(s.c)}</b>`;
      case 'i': return `<i>${inlHtml(s.c)}</i>`;
      case 'u': return `<u>${inlHtml(s.c)}</u>`;
      case 'a': return `<a href="${esc(s.href)}">${inlHtml(s.c)}</a>`;
      case 'm': return `<math xmlns="http://www.w3.org/1998/Math/MathML">${s.mml}</math>`;
      case 'n': return `<sup><a href="#${s.id}" id="ref-${s.id}">${s.id.slice(1)}</a></sup>`;
      default: return '';
    }
  }).join('');
}
function listHtml(l) {
  const tag = l.kind === 'ol' ? 'ol' : 'ul';
  return `<${tag}${l.kind === 'pl' ? ' style="list-style:none"' : ''}>${l.items.map((it) => `<li>${inlHtml(it.inl)}${it.kids ? listHtml(it.kids) : ''}</li>`).join('')}</${tag}>`;
}
function writeHtml(d) {
  const body = [];
  for (const s of d.secs) {
    body.push(`<h${s.level}>${esc(s.title)}</h${s.level}>`);
    for (const b of s.blocks) {
      switch (b.k) {
        case 'p': body.push(`<p>${inlHtml(b.inl)}</p>`); break;
        case 'list': body.push(listHtml(b.list)); break;
        case 'table': body.push(`<table>${b.table.caption ? `<caption>${esc(b.table.caption)}</caption>` : ''}${b.table.rows.map((r) => `<tr>${r.map((c) => `<${c.head ? 'th' : 'td'}${c.cs > 1 ? ` colspan="${c.cs}"` : ''}${c.rs > 1 ? ` rowspan="${c.rs}"` : ''}>${esc(c.text)}</${c.head ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`); break;
        case 'dmath': body.push(`<p><math xmlns="http://www.w3.org/1998/Math/MathML" display="block">${b.mml}</math></p>`); break;
        case 'poem': body.push(`<div class="poem"><p>${b.lines.map(esc).join('<br>')}</p></div>`); break;
        case 'sidebar': body.push(`<aside class="sidebar">${b.title ? `<h4>${esc(b.title)}</h4>` : ''}<p>${inlHtml(b.inl)}</p>${b.list ? listHtml(b.list) : ''}</aside>`); break;
        case 'pagenum': body.push(`<span role="doc-pagebreak" epub:type="pagebreak" id="pg${b.n}" title="${b.n}"></span>`); break;
        case 'break': body.push('<hr>'); break;
        case 'img': body.push(`<figure><img src="data:image/png;base64,${PIXEL}"${b.alt != null ? ` alt="${esc(b.alt)}"` : ''}>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`); break;
        case 'quote': body.push(`<blockquote><p>${inlHtml(b.inl)}</p></blockquote>`); break;
        default: break;
      }
    }
  }
  const notes = d.notes.map((n) => `<aside id="${n.id}" role="doc-${n.kind === 'endnote' ? 'endnote' : 'footnote'}" epub:type="${n.kind === 'endnote' ? 'endnote' : 'footnote'}"><p>${n.id.slice(1)}. ${esc(n.text)}</p></aside>`);
  return `<!DOCTYPE html>
<html lang="en" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"><title>${esc(d.title)}</title></head>
<body>
<h1 class="title">${esc(d.title)}</h1>
${body.join('\n')}
${notes.join('\n')}
</body></html>
`;
}

function inlMd(inl) {
  return inl.map((s) => {
    switch (s.k) {
      case 't': return s.s.replace(/([*_`\\[\]])/g, '\\$1');
      case 'b': return `**${inlMd(s.c)}**`;
      case 'i': return `*${inlMd(s.c)}*`;
      case 'u': return inlMd(s.c);                      // Markdown has no underline
      case 'a': return `[${inlMd(s.c)}](${s.href})`;
      case 'm': return `$${mmlToLatex(s.mml)}$`;
      case 'n': return `[^${s.id.slice(1)}]`;
      default: return '';
    }
  }).join('');
}
// a rough MathML -> LaTeX for the Markdown writer (the fixtures it makes are only meant to be varied)
function mmlToLatex(m) {
  return m
    .replace(/<mfrac><mrow>(.*?)<\/mrow><mrow>(.*?)<\/mrow><\/mfrac>/g, '\\frac{$1}{$2}')
    .replace(/<msqrt>(.*?)<\/msqrt>/g, '\\sqrt{$1}')
    .replace(/<msup>(.*?)<mn>(\d+)<\/mn><\/msup>/g, '$1^{$2}')
    .replace(/<msub>(.*?)<mn>(\d+)<\/mn><\/msub>/g, '$1_{$2}')
    .replace(/<munderover>.*?<\/munderover>/g, '\\sum_{i=1}^{n}')
    .replace(/<mtable>.*?<\/mtable>/g, '1')
    .replace(/<[^>]+>/g, '')
    .replace(/−/g, '-').replace(/×/g, '\\times ').replace(/÷/g, '\\div ').replace(/≤/g, '\\le ').replace(/≠/g, '\\ne ').replace(/±/g, '\\pm ').replace(/∑/g, '\\sum ').replace(/∫/g, '\\int ').replace(/θ/g, '\\theta ').replace(/π/g, '\\pi ')
    .replace(/&lt;/g, '<').replace(/\$/g, '') || 'x';
}
function listMd(l, depth) {
  const out = [];
  l.items.forEach((it, i) => {
    out.push(`${'    '.repeat(depth)}${l.kind === 'ol' ? `${i + 1}.` : '-'} ${inlMd(it.inl)}`);
    if (it.kids) out.push(listMd(it.kids, depth + 1));
  });
  return out.join('\n');
}
function writeMd(d) {
  const out = [];
  for (const s of d.secs) {
    out.push(`${'#'.repeat(s.level)} ${s.title.replace(/([*_`\\[\]#])/g, '\\$1')}`, '');
    for (const b of s.blocks) {
      switch (b.k) {
        case 'p': if (b.inl.length) out.push(inlMd(b.inl), ''); break;
        case 'list': out.push(listMd(b.list, 0), ''); break;
        case 'table': {
          const cols = Math.max(...b.table.rows.map((r) => r.length), 1);
          const cell = (c) => (c ? String(c.text).replace(/\|/g, '\\|') : '');
          const rows = b.table.rows.map((r) => Array.from({ length: cols }, (_, i) => cell(r[i])));
          out.push(`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`), '');
          break;
        }
        case 'dmath': out.push(`$$${mmlToLatex(b.mml)}$$`, ''); break;
        case 'poem': out.push(b.lines.map((l) => `> ${l}  `).join('\n'), ''); break;
        case 'sidebar': out.push(`> **${b.title || 'Note'}** ${inlMd(b.inl)}`, ''); break;
        case 'pagenum': break;
        case 'break': out.push('* * *', ''); break;
        case 'img': out.push(`![${b.alt != null ? b.alt : ''}](data:image/png;base64,${PIXEL})`, ''); break;
        case 'quote': out.push(`> ${inlMd(b.inl)}`, ''); break;
        default: break;
      }
    }
  }
  out.push(...d.notes.map((n) => `[^${n.id.slice(1)}]: ${n.text}`), '');
  return out.join('\n');
}

export function genDocument(rng) {
  const d = genAbstract(rng);
  const ext = rng.weighted([[5, 'xml'], [3, 'html'], [2, 'md']]);
  const text = ext === 'xml' ? writeDtbook(d) : ext === 'html' ? writeHtml(d) : writeMd(d);
  return { ext, text, features: [...d.features].sort() };
}
