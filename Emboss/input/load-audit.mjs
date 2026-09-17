// Load check (A2): compare a DTBook source with the model the parser built, so nothing is
// dropped silently. parseDtbook() turns the result into model.warnings (shown by the editor's
// notice banner); scripts/run_1000_corpus_benchmark.mjs uses the same counts as its checks.
//   - words:  every source word must be in the model (as a multiset — a lost word cannot
//             hide behind a duplicated one);
//   - images, tables and equations: the model must hold at least as many as the source.

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
// Inline elements do not split words ("Lpuceepi<a/>moeDiteéc" is one word in print);
// block-level elements do.
const INLINE = new Set(['a', 'abbr', 'acronym', 'bdo', 'cite', 'code', 'dfn', 'em', 'kbd', 'q', 'samp', 'span', 'strong', 'sub', 'sup', 'var', 'w', 'sent', 'linenum', 'b', 'i', 'u', 'small', 'big', 'tt']);

// A print line number (<linenum>, or class="linenum"/"line-number").
const isLinenum = (el) => {
  const cls = String((el.getAttribute && el.getAttribute('class')) || '').toLowerCase();
  return (el.localName || '').toLowerCase() === 'linenum' || cls.includes('linenum') || cls.includes('line-number');
};
const byTag = (dom, name, ns = '*') => (dom.getElementsByTagNameNS ? [...dom.getElementsByTagNameNS(ns, name)] : []);
export const wordList = (s) => String(s || '').match(/[\p{L}\p{N}]+/gu) || [];

/** Source words the model does not have (as a multiset). */
export function missingWords(srcText, modelText) {
  const have = new Map();
  for (const w of wordList(modelText)) have.set(w, (have.get(w) || 0) + 1);
  const lost = [];
  for (const w of wordList(srcText)) { const n = have.get(w) || 0; if (n > 0) have.set(w, n - 1); else lost.push(w); }
  return lost;
}

/** Running text and counts of a DTBook DOM. */
export function sourceStats(dom) {
  const book = byTag(dom, 'book')[0] || dom.documentElement;
  let text = '';
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) text += c.nodeValue;
      else if (c.nodeType === 1) {
        const tag = (c.localName || '').toLowerCase();
        if (tag === 'pagenum' || tag === 'math' || tag === 'img' || tag === 'brl') { text += ' '; continue; }   // not running text
        if (isLinenum(c)) { text += ` ${c.textContent} `; continue; }                                       // a word of its own (A30)
        // Adjacent links are separate references ("<a>p. 98</a><a>p. 101</a>").
        const prev = c.previousSibling;
        if (tag === 'a' && prev && prev.nodeType === 1 && (prev.localName || '').toLowerCase() === 'a') text += ' ';
        const block = !INLINE.has(tag);
        if (block) text += ' ';
        walk(c);
        if (block) text += ' ';
      }
    }
  })(book);
  // Note references whose target note is in the document (id or DTBook idref="#id").
  const noteIds = new Set(byTag(dom, 'note').filter((n) => n.textContent.trim()).map((n) => n.getAttribute('id')).filter(Boolean));   // an empty note is not kept
  const noterefs = byTag(dom, 'noteref').filter((r) => {
    const t = String(r.getAttribute('idref') || r.getAttribute('id') || '').replace(/^#/, '');
    return t && noteIds.has(t) && r.textContent.trim();
  }).length;
  return {
    words: wordList(text).length,
    text,
    noterefs,
    images: byTag(dom, 'img').length,
    maths: byTag(dom, 'math', MATHML_NS).length,
    // An empty table (no text, image or maths) has nothing to braille and is not kept.
    tables: byTag(dom, 'table').filter((t) => t.textContent.trim() || t.getElementsByTagNameNS('*', 'img').length || t.getElementsByTagNameNS(MATHML_NS, 'math').length).length,
  };
}

/** Running text and counts of a parsed model. */
export function modelStats(doc) {
  let text = '', tables = 0;
  // Runs join as printed; a note reference is a separate mark (as the source counter treats it).
  const seg = (s) => (s || []).map((g) => (!g || g.type === 'math' ? ' ' : g.type === 'noteref' || g.type === 'linenum' ? ` ${g.text || ''} ` : g.text || '')).join('');
  const cell = (c) => (c && typeof c === 'object' ? seg(c.segments) || c.text || '' : c || '');
  (function walk(bs) {
    for (const b of bs || []) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'table') { tables++; text += ` ${[...(b.headers || []), ...(b.rows || []).flat()].map(cell).join(' ')} ${b.caption || ''}`; }
      else if (b.type === 'pagenum' || b.type === 'math') { /* not running text */ }
      else if (b.type === 'graphic') text += ` ${b.caption || ''} ${b.description || ''}`;   // caption + prodnote (alt is not running text)
      else text += ` ${b.segments ? seg(b.segments) : (b.text || '')} ${b.title && b.type !== 'box' && b.type !== 'sidebar' ? b.title : ''}`;
      for (const it of b.items || []) text += ` ${it.segments ? seg(it.segments) : (it.text || '')} ${it.term || ''} ${it.def || ''} ${it.page || ''} ${it.marker || ''}`;   // contents/index page references are kept as item.page
      for (const l of b.lines || []) text += ` ${l}`;
      walk(b.blocks);
    }
  })(doc.blocks);
  const meta = doc.metadata || {};
  text += ` ${doc.title || ''} ${(meta.docauthors || [meta.docauthor || '']).join(' ')}`;   // <doctitle>/<docauthor> are document metadata
  // Images and equations anywhere in the model (blocks, items, cells, captions); each object once.
  let images = 0, maths = 0;
  const seen = new Set();
  (function deep(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.type === 'graphic' && (v.src || v.alt || v.svg)) images++;
    if (v.type === 'math' && (v.mathml || v.latex)) maths++;
    for (const k in v) if (typeof v[k] === 'object') deep(v[k]);
  })(doc.blocks);
  return { words: wordList(text).length, text, tables, images, maths };
}

const quote = (s) => `“${s}”`;

/** Readable notices for anything in the source that the model lacks (empty when all is kept). */
export function loadWarnings(dom, doc) {
  const want = sourceStats(dom);
  const have = modelStats(doc);
  const out = [];
  const lost = missingWords(want.text, have.text);
  if (lost.length) {
    const w = lost[0];
    const i = want.text.search(new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u'));
    const near = want.text.slice(Math.max(0, i - 30), i + w.length + 31).replace(/\s+/g, ' ').trim();
    out.push(`${lost.length} word${lost.length === 1 ? '' : 's'} of the file could not be loaded (the first is ${quote(w)}, in ${quote(`…${near}…`)})`);
  }
  const short = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (have.images < want.images) out.push(`${short(want.images - have.images, 'image', 'images')} could not be loaded`);
  if (have.tables < want.tables) out.push(`${short(want.tables - have.tables, 'table', 'tables')} could not be loaded`);
  if (have.maths < want.maths) out.push(`${short(want.maths - have.maths, 'equation', 'equations')} could not be loaded`);
  return out;
}
