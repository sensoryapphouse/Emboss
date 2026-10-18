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
// TF_SCRIPT (K5, UEB §9) matches engine/louis.mjs's TYPEFORM.script = 8 exactly — the next
// bit after TF_BOLD, combinable with the other three the same way liblouis combines them.
export const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4, TF_SCRIPT = 8;
const ESCAPABLE = '*_`$<\\';
// Escaped characters are parked in the Private Use Area while the markup is parsed — at U+E020 up, clear of the
// sub/superscript markers U+E000–U+E002 (format/text-style.mjs SCRIPT_MARKS): parked at U+E000 as they were, a
// superscript in a table cell came back as a literal "_" and "`" (import audit, 30 Sep).
const PUA = 0xE020;
const park = (s) => s.replace(/\\([*_`$<\\])/g, (_, ch) => String.fromCharCode(PUA + ESCAPABLE.indexOf(ch)));
const unpark = (s) => s.replace(/[\uE020-\uE025]/g, (c) => ESCAPABLE[c.charCodeAt(0) - PUA]);
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
    // K5: `<script>…</script>` is this dialect's own pseudo-tag for the script typeform (real
    // HTML has no inline tag for it, same reasoning as `<u>` for underline above) -> TF_SCRIPT.
    const regex = /<(\/)?(strong|b|em|i|u|code|span|dfn|script)(?:\s+[^>]*)?>|([^<]+)/gi;
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
        const bit = (tag === 'b' || tag === 'strong') ? TF_BOLD : ((tag === 'i' || tag === 'em' || tag === 'dfn') ? TF_ITALIC : (tag === 'u' ? TF_UNDERLINE : (tag === 'script' ? TF_SCRIPT : 0)));
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
  return segs.length > 1 || !!(segs[0] && (segs[0].tf || segs[0].uncontracted || segs[0].type === 'math' || segs[0].type === 'noteref' || segs[0].type === 'imgnote' || segs[0].type === 'brl' || segs[0].href || segs[0].cite));
}

/** Plain print text of a cell (maths as its LaTeX), for widths, numbers, speech and search. */
export function cellPlainText(cell) {
  if (cell == null) return '';
  if (isObjectCell(cell) && typeof cell.text === 'string' && cell.text) return cell.text;
  return cellSegments(cell).map((g) => (g.type === 'math' ? (g.latex || '') : (g.text || ''))).join('');
}

// A {type:'brl'} segment's `text` (the print it stands for) is deliberately '' for a cell
// that is ONLY literal braille with no print equivalent of its own (a BrailleBlaster
// <brl>-only table cell) — cellPlainText correctly reports no PRINT text for it, but the
// cell itself is not blank: it has real braille to emboss (`.brl`). Every other rich
// segment type (math's latex, imgnote's alt text) already surfaces through cellPlainText,
// so brl is the one case that needs checking separately here.
export const cellIsBlank = (cell) => cellPlainText(cell).trim() === '' && !cellSegments(cell).some((g) => g.type === 'brl' && g.brl);

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
    // The markup does not nest; bold wins over italic, italic over underline over script (K5).
    if (tf & TF_BOLD) t = `**${t}**`;
    else if (tf & TF_ITALIC) t = `*${t}*`;
    else if (tf & TF_UNDERLINE) t = `<u>${t}</u>`;
    else if (tf & TF_SCRIPT) t = `<script>${t}</script>`;
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
  // A19/A21 Stage 3/4: a cell whose only "rich" content is a <a href>/<cite> segment (no
  // tf/uncontracted/math/noteref) must still keep its segments, or the href/cite marking
  // (parse.mjs's walkInline) is dropped the moment the cell collapses to a plain string.
  // A picture kept in a table cell (parse.mjs, DOCX data tables) is an `imgnote` segment
  // (an embedded transcriber's note with its description, BANA §10.11.1): kept the same way.
  // BrailleBlaster-style table test fixtures (TablesTestXml.xml) hold a cell's LITERAL
  // braille as a {type:'brl'} segment (document.mjs's F-187/F-188/F-222 model) — that must
  // count as "rich" too, or a cell whose only content is one brl segment (no tf/href/etc.,
  // print `text` empty) collapses back to the empty plain string here and the segment
  // (the cell's only actual content) is silently thrown away.
  // A foreign-language run (`lang`, input/lang.mjs) is kept the same way (it does not change the braille).
  const rich = Array.isArray(segments) && segments.some((g) => g.tf || g.uncontracted || g.type === 'math' || g.type === 'noteref' || g.type === 'imgnote' || g.type === 'brl' || g.href || g.cite || g.lang);
  if (!rich && !MARKUP_CHARS.test(plain)) return plain;
  return { text: plain, segments: rich ? segments : [{ type: 'text', text: plain }] };
}
