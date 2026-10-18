// The editor's Word (.docx) writer (audit batch S5d, 15 Oct 2026; Paul's decision E2: repair and test it).
//
// FIDELITY POLICY (what each model type becomes; Emboss's own reader, input/parse.mjs parseDocx, reads each back)
//   title              Title style (first line) and Subtitle style (further lines); core properties dc:title, dc:creator, dc:language
//   heading 1-6        Heading1..Heading6 (styles carry the outline level), with the heading's inline structure
//   paragraph          Normal; emphasis, links (w:hyperlink + relationship), script, strike, language, citations
//   quote, caption, attribution, note, verse, glossary entry, transcriber pages: the Quote / Caption / Emboss... paragraph style
//                      (the semantic style is chosen BEFORE the generic paragraph)
//   code               Source Code style, Consolas, one paragraph per line, every space kept
//   equations          Word equations (OMML, converted from the model's MathML, else from its LaTeX through opts.latexToMathml);
//                      an equation that cannot be converted is an equation object holding its LaTeX as text
//   footnote/endnote   real w:footnoteReference / w:endnoteReference and word/footnotes.xml, word/endnotes.xml; a mark that is not
//                      the automatic number is written as Word's custom mark; a note nobody cites stays a paragraph (EmbossFootnote)
//   list               real Word bullets / numbering (numbering.xml); marker-less items in EmbossPlainList; an item holding only a
//                      nested block uses that block as its paragraph; term/definition items and glossary blocks are glossary entries
//   table              w:tbl with a header row (w:tblHeader), grid, borders; title and caption paragraphs above, table note below
//   box                a run of paragraphs bordered on four sides (what parseDocx reads as a box)
//   picture            an inline picture with alt text (png, jpeg, gif); caption in the Caption style, description as a note;
//                      an SVG or other picture Word cannot take from here is a "[Graphic: alt]" paragraph (not embedded)
//   print page, section break: "[Page N]" and a centred star line (Word has no print-page concept)
import { makeZip } from './zip.mjs';
import { cellSegments } from '../format/cell-markup.mjs';

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// format/text-style.mjs SCRIPT_MARKS: a sub/superscript run is bracketed in the text by these
const SUB_OPEN = '', SUP_OPEN = '', SCRIPT_END = '';

// XML text: the characters XML cannot hold (controls, lone surrogates, U+FFFE/FFFF) are left out, as nimas-export.mjs does
function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ---- run properties, in the order WordprocessingML requires (rStyle rFonts b i strike color sz u vertAlign lang)
const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;   // `tf` is the liblouis typeform BITMASK the editor's model carries
function rPr({ style, font, tf = 0, strike, color, sz, vert, lang, extra = '' } = {}) {
  const n = Number(tf) || 0;
  const body = (style ? `<w:rStyle w:val="${style}"/>` : '')
    + (font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>` : '')
    + (n & TF_BOLD ? '<w:b/>' : '') + (n & TF_ITALIC ? '<w:i/>' : '')
    + (strike ? '<w:strike/>' : '')
    + (color ? `<w:color w:val="${color}"/>` : '')
    + (sz ? `<w:sz w:val="${sz}"/>` : '')
    + (n & TF_UNDERLINE ? '<w:u w:val="single"/>' : '')
    + (vert ? `<w:vertAlign w:val="${vert}"/>` : '')
    + (lang ? `<w:lang w:val="${escapeXml(lang)}"/>` : '')
    + extra;
  return body ? `<w:rPr>${body}</w:rPr>` : '';
}
// ---- paragraph properties, in schema order (pStyle numPr pBdr ind jc outlineLvl)
function pPr({ style, numPr, bdr, spacing, ind, jc, keepNext } = {}) {
  const body = (style ? `<w:pStyle w:val="${style}"/>` : '') + (keepNext ? '<w:keepNext/>' : '') + (numPr || '') + (bdr || '') + (spacing || '') + (ind || '') + (jc ? `<w:jc w:val="${jc}"/>` : '');
  return body ? `<w:pPr>${body}</w:pPr>` : '';
}
const indXml = (left, hanging, right) => `<w:ind${left != null ? ` w:left="${left}"` : ''}${right != null ? ` w:right="${right}"` : ''}${hanging != null ? ` w:hanging="${hanging}"` : ''}/>`;

const PLAIN_LIST_LEFT = 720, PLAIN_LIST_STEP = 360;   // parseDocx reads a plain list item's level = (left - 720) / 360

// F4-04: paragraph styles for block types Word has no native form for; parseDocx
// (input/parse.mjs, EMBOSS_PARA_STYLES) maps each id back to its block type.
const EMBOSS_PARA_STYLE_DEFS = [
  ['EmbossCaption', 'Emboss Caption', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:sz w:val="20"/></w:rPr>'],
  ['EmbossByline', 'Emboss Byline', '<w:pPr><w:jc w:val="right"/></w:pPr><w:rPr><w:i/></w:rPr>'],
  ['EmbossNote', 'Emboss Transcriber Note', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr>'],
  ['EmbossNoteRequired', 'Emboss Transcriber Note Required', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr>'],
  ['EmbossNoteOptional', 'Emboss Transcriber Note Optional', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr>'],
  ['EmbossNoteTableTn', 'Emboss Table Note', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr>'],
  ['EmbossFootnote', 'Emboss Footnote', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>'],
  ['EmbossVerse', 'Emboss Verse', '<w:pPr><w:ind w:left="360"/></w:pPr>'],
  ['EmbossPlainList', 'Emboss Plain List Item', `<w:pPr><w:ind w:left="${PLAIN_LIST_LEFT}"/></w:pPr>`],
  ['EmbossGlossary', 'Emboss Glossary Entry', '<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr>'],
  ['EmbossTnHeading', 'Emboss Transcriber Notes Heading', '<w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr>'],
  ['EmbossTnEntry', 'Emboss Transcriber Notes Entry', ''],
  ['EmbossTnContinued', 'Emboss Transcriber Notes Continued', '<w:pPr><w:ind w:left="360"/></w:pPr>'],
].map(([id, name, props]) => `<w:style w:type="paragraph" w:styleId="${id}">
    <w:name w:val="${name}"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    ${props}
  </w:style>`).join('\n  ');

// ---------------------------------------------------------------------------------------------------------------------------------
// list markers (unchanged from the version tests/docx_plain_list.test.mjs covers)
// ---------------------------------------------------------------------------------------------------------------------------------
// Lists. A bullet item is a real Word bullet (numbering.xml), a numbered item real Word numbering
// (numFmt/lvlText/start taken from the item markers; only when the markers are exactly what Word would
// count, else the marker stays literal text), and a marker-less item (a BANA plain list) an ordinary
// paragraph in EmbossPlainList with the list indent and no bullet or number. parseDocx reads each back.
const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function listCounterText(n, fmt) {
  if (fmt === 'decimal') return String(n);
  if (fmt === 'lowerLetter' || fmt === 'upperLetter') {
    let out = '', k = n; while (k > 0) { k--; out = String.fromCharCode(97 + (k % 26)) + out; k = Math.floor(k / 26); }
    return fmt === 'upperLetter' ? out.toUpperCase() : out;
  }
  let out = '', k = n; for (const [v, r] of ROMAN) while (k >= v) { out += r; k -= v; }
  return fmt === 'upperRoman' ? out.toUpperCase() : out;
}
// "1." / "a)" / "(iii)" -> { fmt, start, pre, post } (null when it is not a counter marker)
function parseListMarker(marker, asRoman) {
  const m = /^(\(?)([0-9]+|[a-z]+|[A-Z]+)([.)]?)$/.exec(String(marker || '').trim());
  if (!m) return null;
  const [, pre, tok, post] = m;
  for (const fmt of /^[0-9]/.test(tok) ? ['decimal'] : tok === tok.toLowerCase() ? (asRoman ? ['lowerRoman', 'lowerLetter'] : ['lowerLetter', 'lowerRoman']) : (asRoman ? ['upperRoman', 'upperLetter'] : ['upperLetter', 'upperRoman'])) {
    for (let n = 1; n <= 3999; n++) if (listCounterText(n, fmt) === tok) return { fmt, start: n, pre, post };
    if (fmt === 'decimal') return { fmt, start: Number(tok), pre, post };
  }
  return null;
}
const isBulletMarker = (m) => typeof m === 'string' && m.length > 0 && m.length <= 2 && !/[\p{L}\p{N}]/u.test(m);

// ---------------------------------------------------------------------------------------------------------------------------------
// pictures
// ---------------------------------------------------------------------------------------------------------------------------------
// The kind and pixel size of a PNG, JPEG or GIF from its first bytes (null for anything else: Word is given only what it can show).
function imageInfo(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    return { ext: 'png', mime: 'image/png', w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: 'gif', mime: 'image/gif', w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xFF) { i++; continue; }
      if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { ext: 'jpeg', mime: 'image/jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return { ext: 'jpeg', mime: 'image/jpeg', w: 0, h: 0 };
  }
  return null;
}
function decodeDataUri(src) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]*)$/i.exec(String(src || ''));
  if (!m) return null;
  try { const bin = atob(m[1].replace(/\s+/g, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; } catch { return null; }
}
function pictureBytes(model, src) {
  const s = String(src || '');
  if (!s) return null;
  const res = (model && Array.isArray(model.resources) ? model.resources : []).find((r) => r && r.path === s && r.bytes);
  if (res) return res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes);
  return decodeDataUri(s);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// equations: MathML -> OMML (Office Math). A small tolerant XML reader (the model's MathML is XML, from Temml, MathLive, MathCAT or an
// imported document) and a mapping of the presentation elements Word has a form for; anything else keeps its text.
// ---------------------------------------------------------------------------------------------------------------------------------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', minus: '−', times: '×', plusmn: '±', middot: '·', deg: '°', hellip: '…', ne: '≠', le: '≤', ge: '≥' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return ''; } }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
function parseMathXml(src) {
  const root = { name: '#root', attrs: {}, kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.kids.push(m[1]);
    else if (m[3]) {
      const name = m[3].replace(/^.*:/, '');
      if (m[2]) { if (stack.length > 1) { let k = stack.length - 1; while (k > 0 && stack[k].name !== name) k--; if (k > 0) stack.length = k; } continue; }
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^.*:/, '')] = decodeEntities(a[2] ?? a[3] ?? '');
      const node = { name, attrs, kids: [] };
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] != null) top.kids.push(decodeEntities(m[6]));
  }
  return root;
}
const elems = (n) => n.kids.filter((k) => typeof k !== 'string');
const textOf = (n) => (typeof n === 'string' ? n : n.kids.map(textOf).join(''));
const BIG_OPS = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '∯', '∰', '⋀', '⋁', '⋂', '⋃', '⨀', '⨁', '⨂', '⨄', '⨆']);
const mt = (text, sty) => `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
const mlist = (nodes) => nodes.map(mmath).join('');
const marg = (tag, nodes) => `<m:${tag}>${mlist(nodes)}</m:${tag}>`;
function mmath(n) {
  if (typeof n === 'string') return n.trim() ? mt(n.replace(/\s+/g, ' ')) : '';
  const k = elems(n);
  switch (n.name) {
    case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'merror': case 'mphantom': case 'menclose': case 'maction': case 'none': case 'mprescripts':
      return n.name === 'mphantom' ? '' : n.kids.map(mmath).join('');
    case 'semantics': return k.length && k[0].name !== 'annotation' && k[0].name !== 'annotation-xml' ? mmath(k[0]) : '';
    case 'annotation': case 'annotation-xml': return '';
    case 'mi': { const t = textOf(n).trim(); return t ? mt(t, t.length > 1 || n.attrs.mathvariant === 'normal' ? 'p' : '') : ''; }
    case 'mn': { const t = textOf(n).trim(); return t ? mt(t, 'p') : ''; }
    case 'mo': { const t = textOf(n).trim(); return t ? mt(t, 'p') : ''; }
    case 'mtext': { const t = textOf(n); return t ? `<m:r><m:rPr><m:nor/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${escapeXml(t)}</m:t></m:r>` : ''; }
    case 'mspace': return mt(' ');
    case 'mfrac': return `<m:f>${n.attrs.linethickness === '0' ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}${marg('num', k.slice(0, 1))}${marg('den', k.slice(1, 2))}</m:f>`;
    case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${marg('e', k)}</m:rad>`;
    case 'mroot': return `<m:rad><m:radPr/>${marg('deg', k.slice(1, 2))}${marg('e', k.slice(0, 1))}</m:rad>`;
    case 'msup': case 'msub': case 'msubsup': {
      const base = k[0];
      const bt = base && base.name === 'mo' ? textOf(base).trim() : '';
      if (BIG_OPS.has(bt)) {   // an integral or a sum with its limits to the side
        const sub = n.name === 'msup' ? null : k[1], sup = n.name === 'msub' ? null : (n.name === 'msup' ? k[1] : k[2]);
        return naryXml(bt, sub, sup, 'subSup', null);
      }
      if (n.name === 'msup') return `<m:sSup>${marg('e', k.slice(0, 1))}${marg('sup', k.slice(1, 2))}</m:sSup>`;
      if (n.name === 'msub') return `<m:sSub>${marg('e', k.slice(0, 1))}${marg('sub', k.slice(1, 2))}</m:sSub>`;
      return `<m:sSubSup>${marg('e', k.slice(0, 1))}${marg('sub', k.slice(1, 2))}${marg('sup', k.slice(2, 3))}</m:sSubSup>`;
    }
    case 'munder': case 'mover': case 'munderover': {
      const base = k[0];
      const bt = base && base.name === 'mo' ? textOf(base).trim() : '';
      if (BIG_OPS.has(bt)) return naryXml(bt, n.name === 'mover' ? null : k[1], n.name === 'munder' ? null : (n.name === 'mover' ? k[1] : k[2]), 'undOvr', null);
      if (n.name === 'munderover') return `<m:limUpp>${marg('e', [{ name: 'munder', attrs: {}, kids: [k[0], k[1]] }])}${marg('lim', k.slice(2, 3))}</m:limUpp>`;
      const over = n.name === 'mover';
      const acc = over && k[1] && k[1].name === 'mo' && /^[¯^~ˆ˜→⃗´`˙¨ˇ̅̂̃̇̈]$/.test(textOf(k[1]).trim()) && n.attrs.accent !== 'false';
      if (acc) return `<m:acc><m:accPr><m:chr m:val="${escapeXml(textOf(k[1]).trim())}"/></m:accPr>${marg('e', k.slice(0, 1))}</m:acc>`;
      return over ? `<m:limUpp>${marg('e', k.slice(0, 1))}${marg('lim', k.slice(1, 2))}</m:limUpp>` : `<m:limLow>${marg('e', k.slice(0, 1))}${marg('lim', k.slice(1, 2))}</m:limLow>`;
    }
    case 'mfenced': {
      const open = n.attrs.open ?? '(', close = n.attrs.close ?? ')', sep = n.attrs.separators ?? ',';
      const parts = k.length ? k : [];
      return `<m:d><m:dPr><m:begChr m:val="${escapeXml(open)}"/><m:sepChr m:val="${escapeXml(sep[0] || '')}"/><m:endChr m:val="${escapeXml(close)}"/></m:dPr>${parts.map((p) => marg('e', [p])).join('')}</m:d>`;
    }
    case 'mtable': {
      const cols = Math.max(1, ...elems(n).map((r) => elems(r).length));
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${k.map((r) => `<m:mr>${(r.name === 'mtr' || r.name === 'mlabeledtr' ? elems(r).filter((c) => c.name === 'mtd') : [r]).map((c) => marg('e', c.name === 'mtd' ? c.kids : [c])).join('')}</m:mr>`).join('')}</m:m>`;
    }
    case 'mtr': case 'mtd': return n.kids.map(mmath).join('');
    case 'mmultiscripts': return n.kids.map(mmath).join('');
    default: return n.kids.map(mmath).join('');
  }
}
function naryXml(chr, sub, sup, limLoc, body) {
  return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(chr)}"/><m:limLoc m:val="${limLoc}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>${sub ? marg('sub', [sub]) : '<m:sub/>'}${sup ? marg('sup', [sup]) : '<m:sup/>'}<m:e/></m:nary>`;
}
// the OMML inside <m:oMath> for a MathML string, or '' when it holds nothing
export function mathmlToOmml(mathml) {
  const tree = parseMathXml(String(mathml || ''));
  const root = elems(tree).find((e) => e.name === 'math') || tree;
  return mmath(root);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the writer
// ---------------------------------------------------------------------------------------------------------------------------------
const BOX_COLORS = ['0284C7', '7C3AED', '059669', 'D97706'];

export function exportToDocxBlob(model, title = 'Document', opts = {}) {
  const now = (opts && opts.now instanceof Date ? opts.now : new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const latexToMathml = opts && typeof opts.latexToMathml === 'function' ? opts.latexToMathml : null;
  const meta = (model && model.metadata) || {};
  const docTitle = String((model && model.title) || title || '').replace(/\s+/g, ' ').trim();
  const author = String(meta.creator || meta.author || (Array.isArray(meta.docauthors) ? meta.docauthors.join(', ') : meta.docauthor) || '').trim();
  const language = String(meta.language || meta.lang || (model && (model.language || model.lang)) || '').replace(/[^A-Za-z-]/g, '') || 'en-US';

  // ---- a part (document, footnotes or endnotes) holds its own relationships (hyperlinks, pictures)
  const makePart = (firstId) => {
    const rels = [], byKey = new Map();
    let n = firstId;
    return {
      rels,
      rel(type, target, external = false) {
        const key = `${type}|${target}|${external}`;
        if (byKey.has(key)) return byKey.get(key);
        const id = `rId${n++}`;
        rels.push(`<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
        byKey.set(key, id);
        return id;
      },
    };
  };
  const docPart = makePart(10), fnPart = makePart(1), enPart = makePart(1);

  // ---- notes: the footnote / endnote blocks of the model, found by id, and the numbers Word will give them
  const noteDefs = new Map();      // id -> { kind, paras: [block] }
  const collectNotes = (blocks) => {
    let prev = null;
    for (const b of blocks || []) {
      if (!b || typeof b !== 'object') { prev = null; continue; }
      if (b.type === 'footnote' && b.id != null && b.id !== '') {
        const parts = Array.isArray(b.blocks) && b.blocks.length ? b.blocks : [b];
        if (b.noteCont && prev && prev.id === b.id) prev.paras.push(...parts);
        else { prev = { id: String(b.id), kind: b.kind === 'endnote' ? 'endnote' : 'footnote', paras: [...parts] }; if (!noteDefs.has(prev.id)) noteDefs.set(prev.id, prev); }
        continue;
      }
      prev = null;
      if (Array.isArray(b.blocks)) collectNotes(b.blocks);
      for (const it of b.items || []) if (it && Array.isArray(it.blocks)) collectNotes(it.blocks);
    }
  };
  collectNotes(model && model.blocks);
  const cited = new Set();
  const scanCites = (blocks) => {
    const look = (segs) => { for (const s of segs || []) if (s && s.type === 'noteref' && s.idref != null && noteDefs.has(String(s.idref))) cited.add(String(s.idref)); };
    for (const b of blocks || []) {
      if (!b || typeof b !== 'object') continue;
      look(b.segments);
      for (const it of b.items || []) { if (it) { look(it.segments); look(it.termSegments); look(it.defSegments); scanCites(it.blocks); } }
      for (const row of [b.headers || [], ...(b.rows || [])]) if (Array.isArray(row)) for (const c of row) look(cellSegments(c));
      scanCites(b.blocks);
    }
  };
  scanCites(model && model.blocks);
  const assigned = new Map();      // id -> { wid, kind, mark, custom }
  const seqs = { footnote: 0, endnote: 0 };

  // ---- pictures
  const media = [];                // { name, bytes, ext }
  const mediaBySrc = new Map();
  const exts = new Set();
  let docPrId = 0;

  // ---- inline equations
  const ommlOf = (mathml, latex) => {
    let ml = String(mathml || '');
    if (!ml && latex && latexToMathml) { try { ml = String(latexToMathml(latex) || ''); } catch { ml = ''; } }
    if (ml) { try { const o = mathmlToOmml(ml); if (o) return o; } catch { /* falls back below */ } }
    return latex ? `<m:r><m:rPr><m:nor/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${escapeXml(latex)}</m:t></m:r>` : '';
  };

  // ---- runs of a segment list (or plain text) for a part
  function runsOf(part, segments, text, o = {}) {
    const { baseTf = 0, font, style, sz } = o;
    const segs = Array.isArray(segments) && segments.length ? segments : [{ type: 'text', text: text == null ? '' : text }];
    let out = '';
    for (const s of segs) {
      if (!s) continue;
      if (s.type === 'math') { const om = ommlOf(s.mathml, s.latex); if (om) out += `<m:oMath>${om}</m:oMath>`; continue; }
      if (s.type === 'noteref') { out += noteRefRuns(part, s); continue; }
      if (s.type === 'gap') { out += `<w:r><w:t xml:space="preserve">  </w:t></w:r>`; continue; }
      const raw = s.type === 'imgnote' ? `[Picture: ${s.text || ''}]` : s.type === 'brl' ? (s.text || s.brl || '') : s.text;
      const charStyle = style || (s.type === 'linenum' ? 'EmbossLineNumber' : s.uncontracted ? 'EmbossUncontracted' : s.href ? 'Hyperlink' : '');
      const tf = (Number(s.tf) || 0) | baseTf | (s.cite ? TF_ITALIC : 0);
      const strike = s.transcriberTypeform === 'strike';
      const lang = s.lang || '';
      let runs = '';
      let sub = false, sup = false, buf = '';
      const flush = () => {
        if (!buf) return;
        runs += `<w:r>${rPr({ style: charStyle, font, tf, strike, sz, vert: sub ? 'subscript' : sup ? 'superscript' : '', lang })}<w:t xml:space="preserve">${escapeXml(buf)}</w:t></w:r>`;
        buf = '';
      };
      for (const ch of String(raw == null ? '' : raw)) {
        if (ch === SUB_OPEN) { flush(); sub = true; sup = false; }
        else if (ch === SUP_OPEN) { flush(); sup = true; sub = false; }
        else if (ch === SCRIPT_END) { flush(); sub = sup = false; }
        else if (ch === '\n') { flush(); runs += `<w:r>${rPr({ font, sz })}<w:br/></w:r>`; }
        else if (ch === '\t') { flush(); runs += `<w:r>${rPr({ font, sz })}<w:tab/></w:r>`; }
        else buf += ch;
      }
      flush();
      const href = s.href && /^(https?:|mailto:|tel:|ftp:|#)/i.test(String(s.href).trim()) ? String(s.href).trim() : '';
      if (href && runs) {
        if (href[0] === '#') out += `<w:hyperlink w:anchor="${escapeXml(href.slice(1))}" w:history="1">${runs}</w:hyperlink>`;
        else out += `<w:hyperlink r:id="${part.rel(`${REL}/hyperlink`, href, true)}" w:history="1">${runs}</w:hyperlink>`;
      } else out += runs;
    }
    return out;
  }
  // a note reference: Word's own reference when the note is in the model and this is its first citation, else the mark as raised text
  function noteRefRuns(part, s) {
    const id = s.idref != null ? String(s.idref) : '';
    const def = noteDefs.get(id);
    const mark = String(s.text || '');
    if (!def || assigned.has(id)) return mark ? `<w:r>${rPr({ vert: 'superscript' })}<w:t xml:space="preserve">${escapeXml(mark)}</w:t></w:r>` : '';
    const wid = ++seqs[def.kind];
    const custom = mark !== '' && mark !== String(wid);
    assigned.set(id, { wid, kind: def.kind, mark, custom, def });
    const tag = def.kind === 'endnote' ? 'endnoteReference' : 'footnoteReference';
    const style = def.kind === 'endnote' ? 'EndnoteReference' : 'FootnoteReference';
    return `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:${tag}${custom ? ' w:customMarkFollows="1"' : ''} w:id="${wid}"/></w:r>`
      + (custom ? `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:t xml:space="preserve">${escapeXml(mark)}</w:t></w:r>` : '');
  }

  // ---- the body
  const body = [];
  const boxes = [];                // the border of each box being written (innermost last)
  let boxSeq = 0;
  const bdrXml = () => {
    if (!boxes.length) return '';
    const { color, sz } = boxes[boxes.length - 1];
    const side = (n) => `<w:${n} w:val="single" w:sz="${sz}" w:space="4" w:color="${color}"/>`;
    return `<w:pBdr>${side('top')}${side('left')}${side('bottom')}${side('right')}</w:pBdr>`;
  };
  const P = (o, inner) => `<w:p>${pPr({ ...o, bdr: bdrXml() })}${inner}</w:p>`;
  const emit = (xml) => { body.push(xml); };

  let lastNumId = 1;   // numId 1 = the shared bullet list
  const numberedDefs = [];

  const splitLines = (segs, text) => {   // a title's lines: its segments (or text) cut at the line breaks
    if (!(Array.isArray(segs) && segs.length)) return String(text == null ? '' : text).split('\n').map((l) => ({ segs: null, text: l }));
    const lines = [[]];
    for (const s of segs) {
      if (s && s.type !== 'math' && s.type !== 'noteref' && typeof s.text === 'string' && s.text.includes('\n')) {
        s.text.split('\n').forEach((part, i) => { if (i) lines.push([]); if (part) lines[lines.length - 1].push({ ...s, text: part }); });
      } else lines[lines.length - 1].push(s);
    }
    return lines.map((l) => ({ segs: l, text: '' }));
  };

  const hasContent = (b) => b && ((b.text != null && String(b.text).trim()) || (Array.isArray(b.segments) && b.segments.length));
  const picture = (b) => {
    const bytes = pictureBytes(model, b.src);
    const info = bytes ? imageInfo(bytes) : null;
    const alt = String(b.alt || b.title || '');
    if (!info) {   // not embeddable (SVG, an unknown file, no file): its description stays, as the old writer wrote it
      emit(P({ jc: 'center' }, `<w:r><w:rPr><w:i/><w:color w:val="555555"/></w:rPr><w:t xml:space="preserve">[Graphic: ${escapeXml(alt || b.caption || 'Image')}]</w:t></w:r>`));
      return;
    }
    let m = mediaBySrc.get(b.src);
    if (!m) { m = { name: `image${media.length + 1}.${info.ext}`, bytes, ext: info.ext }; media.push(m); mediaBySrc.set(b.src, m); exts.add(info.ext); }
    const rid = docPart.rel(`${REL}/image`, `media/${m.name}`);
    const maxW = 5486400;                                             // six inches
    let cx = Math.max(1, info.w) * 9525, cy = Math.max(1, info.h) * 9525;   // 96 dpi
    if (!info.w || !info.h) { cx = 3000000; cy = 2000000; }
    if (cx > maxW) { cy = Math.round(cy * maxW / cx); cx = maxW; }
    const id = ++docPrId;
    const deco = b.decorative && !alt ? `<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>` : '';
    const docPr = deco ? `<wp:docPr id="${id}" name="Picture ${id}" descr="${escapeXml(alt)}">${deco}</wp:docPr>` : `<wp:docPr id="${id}" name="Picture ${id}" descr="${escapeXml(alt)}"/>`;
    emit(P({ jc: 'center', keepNext: !!b.caption }, `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>${docPr}<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS.pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${m.name}" descr="${escapeXml(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`));
  };

  // a table: header row(s), grid, borders; `left` is the indent of a table inside a list item
  const tableXml = (b, left) => {
    const headers = Array.isArray(b.headers) ? b.headers : [];
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const groups = Array.isArray(b.headerGroups) ? b.headerGroups.filter((g) => g && Number.isInteger(g.from) && Number.isInteger(g.to) && g.to >= g.from) : [];
    const cols = Math.max(1, headers.length, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
    const cell = (c, tf, span) => {
      const runs = cellSegments(c).length ? runsOf(docPart, cellSegments(c), '', { baseTf: tf }) : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / cols) * (span || 1)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr><w:p>${runs}</w:p></w:tc>`;
    };
    const trs = [];
    if (headers.length && groups.length) {
      const cells = []; let c = 0;
      for (const g of [...groups].sort((x, y) => x.from - y.from)) {
        if (g.from > c) cells.push(cell('', TF_BOLD, g.from - c));
        cells.push(cell({ text: String(g.text == null ? '' : g.text) }, TF_BOLD, g.to - g.from + 1));
        c = g.to + 1;
      }
      if (c < cols) cells.push(cell('', TF_BOLD, cols - c));
      trs.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${cells.join('')}</w:tr>`);
    }
    if (headers.length) trs.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${Array.from({ length: cols }, (_, i) => cell(headers[i], TF_BOLD)).join('')}</w:tr>`);
    for (const row of rows) trs.push(`<w:tr>${Array.from({ length: cols }, (_, i) => cell((row || [])[i], 0)).join('')}</w:tr>`);
    const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${left ? `<w:tblInd w:w="${left}" w:type="dxa"/>` : ''}<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs.join('')}</w:tbl>`;
  };

  // a list (the numbering logic is the earlier version's: tests/docx_plain_list.test.mjs)
  function renderList(b) {
    const glossary = b.type === 'glossary' || b.kind === 'glossary' || b.style === 'glossary';
    const termDef = (it) => (it.termSegments || it.defSegments || it.term != null || it.def != null);
    if (glossary) {
      for (const it of (b.items || [])) {                              // "term — definition", one paragraph per entry
        if (!it) continue;
        let inner;
        if (termDef(it)) inner = runsOf(docPart, it.termSegments, it.term == null ? '' : it.term) + `<w:r><w:t xml:space="preserve"> — </w:t></w:r>` + runsOf(docPart, it.defSegments, it.def == null ? '' : it.def);
        else if (hasContent(it)) inner = runsOf(docPart, it.segments, it.text);
        else continue;
        emit(P({ style: 'EmbossGlossary' }, inner));
        for (const x of (Array.isArray(it.blocks) ? it.blocks : [])) renderBlock(x);
      }
      return;
    }
    // Items with no text are left out: Word round trip drops an empty paragraph, and it would split the list. An item that holds only
    // a nested block uses that block's text as its own paragraph (a Word list item is a paragraph); the rest of its blocks follow it.
    const items = [];
    for (const it of (b.items || [])) {
      if (!it || typeof it !== 'object') continue;
      if (hasContent(it)) { items.push(it); continue; }
      if (termDef(it)) { items.push({ ...it, segments: [...(it.termSegments || [{ type: 'text', text: it.term == null ? '' : String(it.term) }]), { type: 'text', text: ' — ' }, ...(it.defSegments || [{ type: 'text', text: it.def == null ? '' : String(it.def) }])], text: undefined }); continue; }
      const blocks = Array.isArray(it.blocks) ? it.blocks : [];
      const k = blocks.findIndex((x) => x && (x.type === 'para' || x.type == null) && !x.style && hasContent(x));
      if (k >= 0) items.push({ ...it, segments: blocks[k].segments, text: blocks[k].text, blocks: blocks.filter((_, j) => j !== k) });
    }
    let seq = 0;
    const eff = items.map((it) => ({ it, lvl: Math.max(0, Math.min(8, Number(it.level) || 0)), marker: it.marker || (b.ordered ? `${++seq}.` : null) }));
    for (let i = 0; i < eff.length;) {
      const kind = !eff[i].marker ? 'plain' : isBulletMarker(eff[i].marker) ? 'bullet' : 'num';
      let j = i + 1;
      while (j < eff.length && (!eff[j].marker ? 'plain' : isBulletMarker(eff[j].marker) ? 'bullet' : 'num') === kind) j++;
      const run = eff.slice(i, j); i = j;
      const runs = (e) => runsOf(docPart, e.it.segments, e.it.text);
      // An item's further content (item.blocks, after its first paragraph): a paragraph indented to the item's text, a
      // table indented the same way (w:tblInd), which parse.mjs reads back into the item (docxContinuesItem / tblInd).
      const itemExtras = (e) => {
        const left = PLAIN_LIST_LEFT + PLAIN_LIST_STEP * e.lvl;
        for (const x of (Array.isArray(e.it.blocks) ? e.it.blocks : [])) {
          if (!x || typeof x !== 'object') continue;
          if ((x.type === 'para' || x.type == null) && !x.style) { emit(P({ ind: indXml(left) }, runsOf(docPart, x.segments, x.text))); continue; }
          if (x.type === 'table') { renderTable(x, left); continue; }
          renderBlock(x);
        }
      };
      if (kind === 'plain') {
        for (const e of run) { emit(P({ style: 'EmbossPlainList', ind: e.lvl ? indXml(PLAIN_LIST_LEFT + PLAIN_LIST_STEP * e.lvl) : '' }, runs(e) + (e.it.page ? pageRuns(e.it) : ''))); itemExtras(e); }
      } else if (kind === 'bullet') {
        for (const e of run) { emit(P({ style: 'ListBullet', numPr: `<w:numPr><w:ilvl w:val="${e.lvl}"/><w:numId w:val="1"/></w:numPr>` }, runs(e) + (e.it.page ? pageRuns(e.it) : ''))); itemExtras(e); }
      } else {
        // numbered run: per level, take the format from the first marker; use Word numbering only if it counts exactly the markers
        let lv, ok = false;
        for (const asRoman of [false, true]) {        // "i." is a letter in a-b-c-i-j, a roman numeral in i-ii-iii
          lv = new Map();
          for (const e of run) if (!lv.has(e.lvl)) { const pm = parseListMarker(e.marker, asRoman); if (pm) lv.set(e.lvl, pm); }
          const counters = new Map(); ok = true;
          for (const e of run) {
            const pm = lv.get(e.lvl);
            if (!pm) { ok = false; break; }
            counters.set(e.lvl, counters.has(e.lvl) ? counters.get(e.lvl) + 1 : pm.start);
            for (let d = e.lvl + 1; d <= 8; d++) counters.delete(d);
            if (`${pm.pre}${listCounterText(counters.get(e.lvl), pm.fmt)}${pm.post}` !== String(e.marker).trim()) { ok = false; break; }
          }
          if (ok) break;
        }
        if (!ok) {   // markers Word could not reproduce: keep them as literal text
          for (const e of run) { emit(P({ style: 'ListBullet' }, `<w:r><w:t xml:space="preserve">${escapeXml(e.marker)} </w:t></w:r>${runs(e)}`)); itemExtras(e); }
        } else {
          const numId = ++lastNumId;
          const lvls = [];
          for (let l = 0; l <= 8; l++) {
            const pm = lv.get(l) || { fmt: 'decimal', start: 1, pre: '', post: '.' };
            lvls.push(`<w:lvl w:ilvl="${l}"><w:start w:val="${pm.start}"/><w:numFmt w:val="${pm.fmt}"/><w:lvlText w:val="${pm.pre}%${l + 1}${pm.post}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${PLAIN_LIST_LEFT + PLAIN_LIST_STEP * l}" w:hanging="360"/></w:pPr></w:lvl>`);
          }
          numberedDefs.push({ numId, xml: `<w:abstractNum w:abstractNumId="${numId}"><w:multiLevelType w:val="multilevel"/>${lvls.join('')}</w:abstractNum>` });
          for (const e of run) { emit(P({ style: 'ListBullet', numPr: `<w:numPr><w:ilvl w:val="${e.lvl}"/><w:numId w:val="${numId}"/></w:numPr>` }, runs(e) + (e.it.page ? pageRuns(e.it) : ''))); itemExtras(e); }
        }
      }
    }
  }
  const pageRuns = (it) => `<w:r><w:t xml:space="preserve"> … </w:t></w:r>` + (it.pageHref && /^https?:/i.test(it.pageHref) ? `<w:hyperlink r:id="${docPart.rel(`${REL}/hyperlink`, it.pageHref, true)}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>${escapeXml(it.page)}</w:t></w:r></w:hyperlink>` : `<w:r><w:t>${escapeXml(it.page)}</w:t></w:r>`);

  function renderTable(b, left) {
    const t = b.title != null && String(b.title).trim() ? String(b.title) : '';
    if (t) emit(P({ style: 'Caption', keepNext: true }, runsOf(docPart, null, t)));
    const cap = b.caption ? (typeof b.caption === 'string' ? b.caption : (b.caption.text || '')) : '';
    if (cap && String(cap).trim()) emit(P({ style: 'EmbossCaption', keepNext: true }, runsOf(docPart, null, cap)));
    emit(tableXml(b, left || 0));
    if (b.tabletn != null && String(b.tabletn).trim()) emit(P({ style: 'EmbossNoteTableTn' }, runsOf(docPart, null, String(b.tabletn))));
  }

  const styleFirst = (b) => (b.type === 'para' || b.type == null ? b.style : null);
  function renderBlock(b) {
    if (!b || typeof b !== 'object') return;
    const t = b.type;
    // --- types with a form of their own
    if (t === 'title') {
      splitLines(b.segments, b.text).forEach((ln, i) => { if (ln.segs ? ln.segs.length : ln.text.trim()) emit(P({ style: i === 0 ? 'Title' : 'Subtitle' }, runsOf(docPart, ln.segs, ln.text))); });
    } else if (t === 'heading') {
      const level = Math.max(1, Math.min(6, Number(b.level) || 1));
      emit(P({ style: `Heading${level}`, keepNext: true }, runsOf(docPart, b.segments, b.text)));
    } else if (t === 'pagenum') {
      const pageStr = b.page != null && b.page !== '' ? b.page : (b.text || '');
      emit(P({ jc: 'right' }, `<w:r><w:rPr><w:i/><w:color w:val="777777"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">[Page ${escapeXml(pageStr)}]</w:t></w:r>`));
    } else if (t === 'box' || t === 'sidebar') {
      const color = BOX_COLORS[boxSeq++ % BOX_COLORS.length];
      boxes.push({ color, sz: 8 + 4 * boxes.length });
      const first = Array.isArray(b.blocks) ? b.blocks.find((x) => x && typeof x === 'object') : null;
      const titleIsHeading = first && first.type === 'heading' && String(first.text || '').replace(/\s+/g, ' ').trim() === String(b.title || '').replace(/\s+/g, ' ').trim();
      if (b.title && !titleIsHeading) emit(P({}, `<w:r>${rPr({ tf: TF_BOLD })}<w:t xml:space="preserve">${escapeXml(b.title)}</w:t></w:r>`));
      if (Array.isArray(b.blocks)) b.blocks.forEach(renderBlock);
      boxes.pop();
    } else if (t === 'math') {
      const om = ommlOf(b.mathml, b.latex);
      if (om) emit(P({ jc: 'center' }, `<m:oMathPara><m:oMath>${om}</m:oMath></m:oMathPara>`));
    } else if (t === 'graphic' || t === 'tactile' || t === 'image') {
      picture(b);
      if (b.caption && String(b.caption).trim()) emit(P({ style: 'Caption' }, runsOf(docPart, b.captionSegments, b.caption)));
      const descs = Array.isArray(b.descriptions) && b.descriptions.length ? b.descriptions : (b.description ? [b.description] : []);
      for (const d of descs) if (String(d).trim()) emit(P({ style: 'EmbossNote' }, runsOf(docPart, null, String(d))));
    } else if (t === 'code') {
      for (const line of String(b.text == null ? '' : b.text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')) {
        emit(P({ style: 'SourceCode' }, line ? runsOf(docPart, null, line, { font: 'Consolas' }) : ''));
      }
    } else if (t === 'list' || t === 'glossary') {
      renderList(b);
    } else if (t === 'table') {
      renderTable(b, 0);
    } else if (t === 'indicator' || t === 'break') {
      if (b.fromPoem) emit(P({ style: 'EmbossVerse' }, ''));                // a stanza break inside a poem
      else emit(P({ jc: 'center' }, `<w:r><w:t xml:space="preserve">∗ ∗ ∗</w:t></w:r>`));
    } else if (t === 'note') {
      const st = b.kind === 'tabletn' ? 'EmbossNoteTableTn' : b.render === 'required' ? 'EmbossNoteRequired' : b.render === 'optional' ? 'EmbossNoteOptional' : 'EmbossNote';
      emit(P({ style: st }, runsOf(docPart, b.segments, b.text)));
    } else if (t === 'footnote') {
      // a note a reference of the document cites is in its part; one nobody cites stays here, a paragraph of its own
      if (b.id != null && b.id !== '' && cited.has(String(b.id)) && noteDefs.has(String(b.id))) return;
      const parts = Array.isArray(b.blocks) && b.blocks.length ? b.blocks : [b];
      for (const part of parts) emit(P({ style: 'EmbossFootnote' }, runsOf(docPart, part && part.segments, part && part.text)));
    } else if (t === 'tnpage') {
      emit(P({ style: 'EmbossTnHeading' }, runsOf(docPart, null, b.heading || "Transcriber's Notes")));
      for (const e of (b.entries || [])) {
        if (!e) continue;
        emit(P({ style: 'EmbossTnEntry' }, runsOf(docPart, e.segments, e.text)));
        for (const c of (e.paragraphs || [])) if (c) emit(P({ style: 'EmbossTnContinued' }, runsOf(docPart, c.segments, c.text)));
      }
    } else if (t === 'sympage') {
      emit(P({ style: 'EmbossTnHeading' }, runsOf(docPart, null, b.heading || 'Special Symbols')));
      const lines = b.auto ? (b._shown || []).map(String) : (b.entries || []).map((e) => [e.braille, e.print, e.description && (e.print || e.braille ? `— ${e.description}` : e.description)].filter(Boolean).join(' '));
      for (const l of lines) if (l.trim()) emit(P({ style: 'EmbossTnEntry' }, runsOf(docPart, null, l)));
    } else if (t === 'titlepage') {
      if (!b.auto) for (const sg of b.segments || []) for (const ln of (sg && sg.lines) || []) {
        const text = (ln.parts || []).map((p) => (p.lit != null ? p.lit : p.value != null ? p.value : '')).join('');
        if (text.trim()) emit(P({ jc: 'center' }, runsOf(docPart, null, text)));
      }
    } else if (t === 'stage' || b.style === 'stage') {
      emit(P({ ind: indXml(720) }, runsOf(docPart, b.segments, b.text, { baseTf: TF_ITALIC })));
    } else if (t === 'caption' || b.style === 'caption') {
      emit(P({ style: 'EmbossCaption' }, runsOf(docPart, b.segments, b.text)));
    } else if (t === 'attribution' || b.style === 'attribution') {
      emit(P({ style: 'EmbossByline' }, runsOf(docPart, b.segments, b.text)));
    } else if (t === 'play' || b.style === 'dialogue' || b.style === 'poem' || b.style === 'verse') {
      if (b.subtype === 'verse' || b.style === 'poem' || b.style === 'verse') emit(P({ style: 'EmbossVerse' }, runsOf(docPart, b.segments, b.text)));
      else emit(P({ ind: indXml(360, 360) }, runsOf(docPart, b.segments, b.text)));
    } else if (styleFirst(b) === 'quote') {
      emit(P({ style: 'Quote' }, runsOf(docPart, b.segments, b.text)));
    } else if (t === 'para' || hasContent(b)) {
      if (hasContent(b)) emit(P({}, runsOf(docPart, b.segments, b.text)));
    }
  }
  (model?.blocks || []).forEach(renderBlock);

  // ---- note parts: the notes the body cited, numbered as Word will number them
  const noteBodies = { footnote: [], endnote: [] };
  for (const [, n] of assigned) {
    const style = n.kind === 'endnote' ? 'EndnoteReference' : 'FootnoteReference';
    const textStyle = n.kind === 'endnote' ? 'EndnoteText' : 'FootnoteText';
    const part = n.kind === 'endnote' ? enPart : fnPart;
    const mk = n.custom ? `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:t xml:space="preserve">${escapeXml(n.mark)}</w:t></w:r>`
      : `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:${n.kind === 'endnote' ? 'endnoteRef' : 'footnoteRef'}/></w:r>`;
    const paras = n.def.paras.map((p, i) => `<w:p><w:pPr><w:pStyle w:val="${textStyle}"/></w:pPr>${i === 0 ? mk + '<w:r><w:t xml:space="preserve"> </w:t></w:r>' : ''}${runsOf(part, p && p.segments, p && p.text)}</w:p>`);
    noteBodies[n.kind].push(`<w:${n.kind} w:id="${n.wid}">${paras.join('') || `<w:p><w:pPr><w:pStyle w:val="${textStyle}"/></w:pPr>${mk}</w:p>`}</w:${n.kind}>`);
  }
  const noteSeparators = (kind) => `<w:${kind} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
  const nsDecl = `xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:m="${NS.m}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"`;

  // ---- styles
  const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}">
    <w:name w:val="heading ${n}"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:outlineLvl w:val="${n - 1}"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>
  </w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS.w}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="${escapeXml(language)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="48"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:i/><w:sz w:val="28"/></w:rPr>
  </w:style>
  ${heading(1, 36)}
  ${heading(2, 28)}
  ${heading(3, 24)}
  ${heading(4, 22)}
  ${heading(5, 22)}
  ${heading(6, 22)}
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="caption"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:i/><w:sz w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:ind w:left="720" w:right="720"/></w:pPr>
    <w:rPr><w:i/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SourceCode">
    <w:name w:val="Source Code"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="0"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="FootnoteText">
    <w:name w:val="footnote text"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="EndnoteText">
    <w:name w:val="endnote text"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="FootnoteReference">
    <w:name w:val="footnote reference"/>
    <w:rPr><w:vertAlign w:val="superscript"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="EndnoteReference">
    <w:name w:val="endnote reference"/>
    <w:rPr><w:vertAlign w:val="superscript"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>
  </w:style>
  ${EMBOSS_PARA_STYLE_DEFS}
  <w:style w:type="character" w:styleId="EmbossLineNumber">
    <w:name w:val="Emboss Line Number"/>
    <w:qFormat/>
    <w:rPr><w:color w:val="777777"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="EmbossUncontracted">
    <w:name w:val="Emboss Uncontracted"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${nsDecl}>
  <w:body>
    ${body.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const bulletLvls = [];
  for (let l = 0; l <= 8; l++) bulletLvls.push(`<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${PLAIN_LIST_LEFT + PLAIN_LIST_STEP * l}" w:hanging="360"/></w:pPr></w:lvl>`);
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${NS.w}">
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLvls.join('')}</w:abstractNum>
  ${numberedDefs.map((d) => d.xml).join('\n  ')}
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  ${numberedDefs.map((d) => `<w:num w:numId="${d.numId}"><w:abstractNumId w:val="${d.numId}"/></w:num>`).join('\n  ')}
</w:numbering>`;

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${NS.w}">
  <w:footnotePr><w:numFmt w:val="decimal"/><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>
  <w:endnotePr><w:numFmt w:val="decimal"/><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>
</w:settings>`;
  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${nsDecl}>${noteSeparators('footnote')}${noteBodies.footnote.join('')}</w:footnotes>`;
  const endnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:endnotes ${nsDecl}>${noteSeparators('endnote')}${noteBodies.endnote.join('')}</w:endnotes>`;

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${docTitle ? `<dc:title>${escapeXml(docTitle)}</dc:title>` : ''}${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ''}<dc:language>${escapeXml(language)}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${[...exts].map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('\n  ')}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
  const relsXml = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${items.join('\n  ')}
</Relationships>`;
  const docRels = relsXml([
    `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>`,
    `<Relationship Id="rId3" Type="${REL}/settings" Target="settings.xml"/>`,
    `<Relationship Id="rId4" Type="${REL}/footnotes" Target="footnotes.xml"/>`,
    `<Relationship Id="rId5" Type="${REL}/endnotes" Target="endnotes.xml"/>`,
    ...docPart.rels,
  ]);

  const files = [
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rootRels },
    { name: 'docProps/core.xml', text: coreXml },
    { name: 'word/_rels/document.xml.rels', text: docRels },
    { name: 'word/styles.xml', text: stylesXml },
    { name: 'word/numbering.xml', text: numberingXml },
    { name: 'word/settings.xml', text: settingsXml },
    { name: 'word/footnotes.xml', text: footnotesXml },
    { name: 'word/endnotes.xml', text: endnotesXml },
    ...(fnPart.rels.length ? [{ name: 'word/_rels/footnotes.xml.rels', text: relsXml(fnPart.rels) }] : []),
    ...(enPart.rels.length ? [{ name: 'word/_rels/endnotes.xml.rels', text: relsXml(enPart.rels) }] : []),
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.bytes })),
    { name: 'word/document.xml', text: docXml },
  ];

  const zipBlob = makeZip(files);
  return new Blob([zipBlob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
