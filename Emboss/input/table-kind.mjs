// Layout tables vs data tables — one shared rule for every reader (DOCX today; .doc, ODT and
// HTML/EPUB can call it the same way — see "How a reader calls it" below).
//
// WHY. BANA Braille Formats 2016 §11.1.1: "A table is an orderly arrangement of data,
// especially one in which the data are arranged in columns and rows in an essentially
// rectangular form"; §11.2.3: "Entries are compared with entries in other columns and rows
// to analyze data. Not all print identified as tables fit these criteria." Word authors use
// tables for page LAYOUT — a letterhead (logo | address), a form (Name: | blank), a photo
// beside a biography, two columns of prose, a one-cell sidebar. None of those has data to
// compare, so none is a braille table: the cells are read as ordinary text in reading order
// (row by row, cell by cell), keeping their headings, lists, pictures and paragraphs. Forms
// in particular: BANA §6.7.3b "Do not reproduce print forms spatially" (items as a list,
// §6.7.3d; a blank is an underscore, §6.7.3e / §10.6.1); UKAAF B004 Appendix F, Forms: "it
// is not necessary to replicate the (very often) complex layout of forms". B004 §12 keeps
// tables for "information presented as a table in print, such as a table of figures, a bank
// statement, or textual information set out in columns".
//
// WHEN UNSURE: DATA. Flattening a real table loses information that cannot be recovered —
// which entry belongs to which column heading and row (§11.2.3's whole point) — whereas a
// layout table kept as a table loses nothing: every word is still there, only with a
// needless heading rule, and the transcriber can see and fix it. So every rule below that
// says "layout" needs positive evidence, and anything that fits none of them stays a table.
//
// THE SIGNALS, in the order they are applied (first match wins):
//  Explicit, from the source file
//   1. role="presentation" / role="none" on an HTML table ................. layout
//   2. a marked header row (Word w:tblHeader "repeat as header row", HTML <th>/<thead>,
//      ODF table:table-header-rows) ....................................... data
//   3. alt text / a caption: Word w:tblCaption or w:tblDescription, HTML <caption> or
//      summary, or a "Table n" caption paragraph attached to the table ...... data
//   4. a data-table style from Word's gallery ("Grid Table 4 - Accent 1", "List Table …",
//      the older "Light/Medium/Dark … Shading/List/Grid" and "Colorful …" families) — an
//      author picked a style made for rows of data. ("Table Grid", Word's default for every
//      inserted table, and "Plain Table n" say nothing either way.) ....... data
//  Structure (no explicit signal)
//   5. no cell has any content ............................................. layout (empty)
//   6. a cell holds a heading (or title) paragraph .......................... layout
//   7. a form: every row has a label (short text ending in ":" or "?", at most
//      FORM_LABEL_MAX characters) and a blank to fill in (an empty cell, or one of only
//      underscores/dots/dashes), and no other content ........................ layout (form)
//   8. one column only (every row is one cell): nothing to compare across ... layout
//   9. one row only: nothing to compare down (a letterhead, two prose columns,
//      logo | address, photo | biography) ................................... layout
//  10. a heading-like first row — two or more cells, each short text (at most
//      HEADER_CELL_MAX characters, one paragraph, no picture/list) — over two or more rows:
//      the shape of a real table (the grid, a term/definition table, a picture column
//      under a "Picture" heading). One cell spanning the width is a title row or a
//      section band, not column headings. ................................... data
//  11. otherwise, content that data cells do not hold: a nested table, a picture, a
//      list, or prose — at least half the non-empty cells being PROSE (PROSE_PARAS or
//      more paragraphs, or more than PROSE_CHARS characters) .................. layout
//  12. anything else ........................................................ data
//
// Not used: Word's w:tblLook firstRow flag (Word writes it on every table it inserts, so it
// says nothing) and column widths (the picture signal already covers "narrow picture column
// beside wide text").
//
// How a reader calls it. Build the neutral description below from its own table markup and
// call classifyTable(desc) (or isLayoutTable(desc)); for a layout table emit each cell's own
// blocks in reading order instead of a table block:
//   desc = {
//     rows: [ [ cell, … ], … ],          // physical rows; a horizontally merged cell appears
//                                        //   once with span > 1; a vertically merged
//                                        //   continuation appears as an empty cell
//     headerRow:   bool,                  // signal 2
//     altText:     bool,                  // signal 3 (alt text, <caption>, summary, attached caption)
//     styleName:   string | null,         // signal 4 (the table style's display name, or id)
//     role:        string | null,         // signal 1 (HTML role attribute)
//   }
//   cell = { text: string,                // the cell's plain text, paragraphs joined by a space
//            paragraphs: number,          // non-empty paragraphs
//            images: number, headings: number, lists: number, tables: number,   // counts
//            span: number }               // columns covered (default 1)
// The .doc reader (Emboss/input/doc*.mjs) has the same facts as DOCX (sprmTTableHeader for
// the header row, paragraph styles for headings, list ids for lists, picture runs); ODT has
// table:table-header-rows and text:h/text:list/draw:frame; HTML has <th>/<thead>, <caption>,
// summary, role, <h1>-<h6>, <ul>/<ol>, <img>.

export const FORM_LABEL_MAX = 60;
export const HEADER_CELL_MAX = 40;
export const PROSE_PARAS = 3;
export const PROSE_CHARS = 250;

const DATA_STYLE_RE = /^(grid table|list table|(light|medium|dark) (shading|list|grid)|colorful (shading|list|grid))\b/i;
// Word style ids drop the spaces ("GridTable4-Accent1", "LightShading-Accent1", "MediumGrid1").
const DATA_STYLE_ID_RE = /^(gridtable|listtable|(light|medium|dark)(shading|list|grid)|colorful(shading|list|grid))/i;

const BLANK_RE = /^[\s_.…\-–—]*$/;          // empty, or a write-on line made of underscores/dots/dashes
const cellText = (c) => String((c && c.text) || '').replace(/\s+/g, ' ').trim();
const isBlankCell = (c) => BLANK_RE.test(cellText(c)) && !(c && (c.images || c.tables));
const isLabelCell = (c) => {
  const t = cellText(c);
  return !!t && t.length <= FORM_LABEL_MAX && /[:?]$/.test(t) && !(c.images || c.lists || c.tables || c.headings);
};
const isShortTextCell = (c) => {
  const t = cellText(c);
  return !!t && t.length <= HEADER_CELL_MAX && (c.paragraphs || 1) <= 1 && !(c.images || c.lists || c.tables || c.headings);
};
const isProseCell = (c) => (c.paragraphs || 0) >= PROSE_PARAS || cellText(c).length > PROSE_CHARS;

/**
 * Decide whether a table is a data table or a layout table.
 * @param {object} desc  the neutral description (see the file comment)
 * @returns {{ kind: 'data'|'layout', reason: string, form?: boolean, empty?: boolean }}
 */
export function classifyTable(desc) {
  const rows = (desc && Array.isArray(desc.rows) ? desc.rows : []).map((r) => (Array.isArray(r) ? r.filter(Boolean) : []));
  const role = String((desc && desc.role) || '').trim().toLowerCase();
  if (role === 'presentation' || role === 'none') return { kind: 'layout', reason: 'role=presentation' };
  if (desc && desc.headerRow) return { kind: 'data', reason: 'marked header row' };
  if (desc && desc.altText) return { kind: 'data', reason: 'table alt text or caption' };
  const style = String((desc && desc.styleName) || '').trim();
  if (style && (DATA_STYLE_RE.test(style) || DATA_STYLE_ID_RE.test(style.replace(/\s+/g, '')))) return { kind: 'data', reason: `data table style "${style}"` };

  const cells = rows.flat();
  const filled = cells.filter((c) => !isBlankCell(c));
  if (!filled.length) return { kind: 'layout', reason: 'no content', empty: true };
  if (cells.some((c) => c.headings)) return { kind: 'layout', reason: 'a cell holds a heading' };
  const liveRows = rows.filter((r) => r.some((c) => !isBlankCell(c)));
  if (liveRows.every((r) => r.some(isLabelCell) && r.some(isBlankCell) && r.every((c) => isLabelCell(c) || isBlankCell(c)))) {
    return { kind: 'layout', reason: 'form (label: blank)', form: true };
  }
  const colCount = Math.max(0, ...rows.map((r) => r.reduce((n, c) => n + Math.max(1, c.span || 1), 0)));
  if (colCount <= 1) return { kind: 'layout', reason: 'single column' };
  if (liveRows.length <= 1) return { kind: 'layout', reason: 'single row' };
  // Column headings are two or more cells: a first row that is ONE cell spanning the table
  // is a title row (or a section band in a layout), not a heading row.
  const first = liveRows[0];
  if (first.length >= 2 && first.every(isShortTextCell)) return { kind: 'data', reason: 'heading-like first row' };
  if (cells.some((c) => c.tables)) return { kind: 'layout', reason: 'a cell holds a nested table' };
  if (cells.some((c) => c.images)) return { kind: 'layout', reason: 'picture in a cell, no heading row' };
  if (cells.some((c) => c.lists)) return { kind: 'layout', reason: 'list in a cell, no heading row' };
  if (filled.filter(isProseCell).length * 2 >= filled.length) return { kind: 'layout', reason: 'prose cells, no heading row' };
  return { kind: 'data', reason: 'default (uncertain → data)' };
}

/** True when `desc` (see classifyTable) describes a table used only for page layout. */
export function isLayoutTable(desc) {
  return classifyTable(desc).kind === 'layout';
}
