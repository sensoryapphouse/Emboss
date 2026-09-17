// Table cells (A25). A cell in the document model is either
//   - a string, which may carry the editor's light inline markup:
//       **bold**, *italic*, <u>underline</u>, `code` (uncontracted), $latex$ / $$latex$$,
//       or HTML-style <strong>/<b>/<em>/<i>/<u>/<code>/<span>/<dfn> tags,
//     with a backslash escaping a literal * _ ` $ < \ ;
//   - or an object { text, segments } whose segments are the same inline runs paragraphs
//     use ({type:'text', text, tf, uncontracted} / {type:'math', mathml, latex}). The
//     parser writes objects for cells with emphasis or maths (or characters the markup
//     would misread), so imported MathML is kept exactly.
// Everything that reads a cell (formatter, cell trace, exporter, editor, speech) goes
// through these helpers so all of them agree on what a cell contains.

// Exported so other modules that build or read segment `tf` bitmasks (e.g. the editor's
// contenteditable table cells, format/cell-dom.mjs) share one definition (G15).
export const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
const ESCAPABLE = '*_`$<\\';
// Escaped characters are parked in the Private Use Area while the markup is parsed.
const PUA = 0xE000;
const park = (s) => s.replace(/\\([*_`$<\\])/g, (_, ch) => String.fromCharCode(PUA + ESCAPABLE.indexOf(ch)));
const unpark = (s) => s.replace(/[\uE000-\uE005]/g, (c) => ESCAPABLE[c.charCodeAt(0) - PUA]);
const MARKUP_CHARS = /[*_`$<\\]/;

const isObjectCell = (cell) => cell != null && typeof cell === 'object' && !Array.isArray(cell);

/** Parse a markup string into inline segments. */
export function parseCellMarkup(str) {
  if (str == null || str === '') return [];
  const s = park(String(str));
  const done = (segs) => segs.map((g) => (g.type === 'text' ? { ...g, text: unpark(g.text) } : g));
  if (!MARKUP_CHARS.test(s)) return done([{ type: 'text', text: s }]);

  if (/<[a-z][\s\S]*>/i.test(s)) {
    const segments = [];
    const regex = /<(\/)?(strong|b|em|i|u|code|span|dfn)(?:\s+[^>]*)?>|([^<]+)/gi;
    let m, tf = 0, unc = false;
    while ((m = regex.exec(s)) !== null) {
      if (m[3]) {
        const seg = { type: 'text', text: m[3] };
        if (tf) seg.tf = tf;
        if (unc) seg.uncontracted = true;
        segments.push(seg);
      } else if (m[2]) {
        const isClose = !!m[1];
        const tag = m[2].toLowerCase();
        const bit = (tag === 'b' || tag === 'strong') ? TF_BOLD : ((tag === 'i' || tag === 'em' || tag === 'dfn') ? TF_ITALIC : (tag === 'u' ? TF_UNDERLINE : 0));
        if (isClose) {
          if (bit) tf &= ~bit;
          if (tag === 'code') unc = false;
        } else {
          if (bit) tf |= bit;
          if (tag === 'code') unc = true;
        }
      }
    }
    return done(segments.length ? segments : [{ type: 'text', text: s }]);
  }

  const segments = [];
  const regex = /(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$|\*\*[^*]+?\*\*|__(?:[A-Za-z0-9 _]+?)__|\*[^*\n]+?\*|(?<=\s|^)_(?:[^\s_]+?)_(?=\s|$|[.,;:!?])|<u>[\s\S]*?<\/u>|`[^`\n]+?`)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(s)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', text: s.slice(lastIndex, match.index) });
    const token = match[0];
    if (token.startsWith('$$') && token.endsWith('$$')) segments.push({ type: 'math', latex: unpark(token.slice(2, -2).trim()) });
    else if (token.startsWith('$') && token.endsWith('$')) segments.push({ type: 'math', latex: unpark(token.slice(1, -1).trim()) });
    else if (token.startsWith('**') && token.endsWith('**')) segments.push({ type: 'text', text: token.slice(2, -2), tf: TF_BOLD });
    else if (token.startsWith('__') && token.endsWith('__')) segments.push({ type: 'text', text: token.slice(2, -2), tf: TF_BOLD });
    else if (token.startsWith('*') && token.endsWith('*')) segments.push({ type: 'text', text: token.slice(1, -1), tf: TF_ITALIC });
    else if (token.startsWith('<u>') && token.endsWith('</u>')) segments.push({ type: 'text', text: token.slice(3, -4), tf: TF_UNDERLINE });
    else if (token.startsWith('_') && token.endsWith('_')) segments.push({ type: 'text', text: token.slice(1, -1), tf: TF_ITALIC });
    else if (token.startsWith('`') && token.endsWith('`')) segments.push({ type: 'text', text: token.slice(1, -1), uncontracted: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < s.length) segments.push({ type: 'text', text: s.slice(lastIndex) });
  return done(segments);
}

/** The inline segments of a cell (string markup or object). */
export function cellSegments(cell) {
  if (cell == null) return [];
  if (isObjectCell(cell)) {
    if (Array.isArray(cell.segments) && cell.segments.length) return cell.segments;
    return cell.text ? [{ type: 'text', text: String(cell.text) }] : [];
  }
  return parseCellMarkup(String(cell));
}

/** True when the cell needs segment translation (emphasis, uncontracted text or maths). */
export function cellIsRich(cell) {
  const segs = cellSegments(cell);
  return segs.length > 1 || !!(segs[0] && (segs[0].tf || segs[0].uncontracted || segs[0].type === 'math' || segs[0].type === 'noteref'));
}

/** Plain print text of a cell (maths as its LaTeX), for widths, numbers, speech and search. */
export function cellPlainText(cell) {
  if (cell == null) return '';
  if (isObjectCell(cell) && typeof cell.text === 'string' && cell.text) return cell.text;
  return cellSegments(cell).map((g) => (g.type === 'math' ? (g.latex || '') : (g.text || ''))).join('');
}

export const cellIsBlank = (cell) => cellPlainText(cell).trim() === '';

const escapeText = (t) => String(t).replace(/[*_`$<\\]/g, (c) => '\\' + c);

/** Editable markup for a cell (what the table editor's input shows). */
export function cellToMarkup(cell) {
  if (cell == null) return '';
  if (!isObjectCell(cell)) return String(cell);
  return cellSegments(cell).map((g) => {
    if (g.type === 'math') return `$${g.latex || '\\text{[equation]}'}$`;
    let t = escapeText(g.text || '');
    if (!t) return '';
    if (g.uncontracted) t = '`' + t + '`';
    const tf = g.tf || 0;
    // The markup does not nest; bold wins over italic, italic over underline.
    if (tf & TF_BOLD) t = `**${t}**`;
    else if (tf & TF_ITALIC) t = `*${t}*`;
    else if (tf & TF_UNDERLINE) t = `<u>${t}</u>`;
    return t;
  }).join('');
}

/**
 * The cell to store after an edit: the previous object while its markup is unchanged
 * (so imported MathML and emphasis are kept exactly), otherwise the edited markup string.
 */
export function cellFromEdit(markup, previous) {
  if (isObjectCell(previous) && cellToMarkup(previous) === markup) return previous;
  return markup;
}

/**
 * Build a cell from parsed inline segments (parser): a plain string when it is plain text
 * that the markup cannot misread, else an object that keeps the segments.
 */
export function cellFromSegments(text, segments) {
  const plain = String(text ?? '');
  const rich = Array.isArray(segments) && segments.some((g) => g.tf || g.uncontracted || g.type === 'math' || g.type === 'noteref');
  if (!rich && !MARKUP_CHARS.test(plain)) return plain;
  return { text: plain, segments: rich ? segments : [{ type: 'text', text: plain }] };
}
