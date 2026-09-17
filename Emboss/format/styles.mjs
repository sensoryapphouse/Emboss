// Official BANA & UKAAF Block Style Definitions and Taxonomy for Emboss.
// Provides metadata, margin rules, XML tag mappings, and helper utilities.

/**
 * Complete BANA / UKAAF Style Registry.
 * Each style defines:
 * - id: Unique string identifier
 * - name: Human-readable display label
 * - category: 'text' | 'heading' | 'list' | 'drama' | 'poetry' | 'table' | 'container' | 'meta'
 * - xmlTag: Corresponding NIMAS/DTBook tag
 * - xmlClass: Optional class attribute for DTBook
 * - firstCell: 1-indexed starting braille cell (e.g. 1 = 0-space indent, 3 = 2-space indent)
 * - runoverCell: 1-indexed runover braille cell for subsequent wrapped lines
 * - blankBefore: Whether a blank braille line precedes this block
 * - blankAfter: Whether a blank braille line follows this block
 * - isContainer: Boolean if block contains child blocks
 */
export const STYLE_DEFINITIONS = {
  body: {
    id: 'body',
    name: 'Body Text',
    category: 'text',
    xmlTag: 'p',
    firstCell: 3,
    runoverCell: 1,
    blankBefore: false,
    blankAfter: false,
    description: 'Standard paragraph with Cell 3 indent and Cell 1 runover (3-1).',
  },
  // F-39 — BANA Formats §1.9.3: "Use 1-1 margins for blocked paragraphs. A blank line
  // precedes each blocked paragraph, unless it follows a cell-5 or cell-7 heading." A
  // per-paragraph flag layered onto an ordinary body paragraph (editor.mjs's blockStyle
  // toggle, ParagraphNode.__blocked), not a mutually-exclusive alternative to it — see
  // `getStyleMargins`'s own `blankBefore` note below for the cell-5/cell-7 exception, which
  // getStyleMargins cannot express (it is conditional on what precedes the paragraph, not a
  // fixed per-style constant) and is instead implemented in document.mjs's
  // joinsWithoutBlank.
  blocked: {
    id: 'blocked',
    name: 'Blocked Paragraph',
    category: 'text',
    xmlTag: 'p',
    xmlClass: 'blocked',
    firstCell: 1,
    runoverCell: 1,
    blankBefore: true,
    blankAfter: false,
    description: 'BANA Formats §1.9.3: 1-1 margins (flush first line and runover); a blank line precedes it unless it follows a cell-5 or cell-7 heading (see document.mjs joinsWithoutBlank).',
  },
  h1: {
    id: 'h1',
    name: 'Heading 1',
    category: 'heading',
    xmlTag: 'h1',
    align: 'centered',
    firstCell: 1,
    runoverCell: 1,
    blankBefore: true,
    blankAfter: true,
    description: 'Major section heading, centered with blank line before and after.',
  },
  h2: {
    id: 'h2',
    name: 'Heading 2 (Subheading)',
    category: 'heading',
    xmlTag: 'h2',
    firstCell: 5,
    runoverCell: 5,
    blankBefore: true,
    blankAfter: false,
    description: 'Subheading starting at Cell 5 with a blank line before.',
  },
  h3: {
    id: 'h3',
    name: 'Heading 3 (Sub-subheading)',
    category: 'heading',
    xmlTag: 'h3',
    firstCell: 7,
    runoverCell: 7,
    blankBefore: true,
    blankAfter: false,
    description: 'Minor heading starting at Cell 7 (BANA) or Cell 5 (UKAAF).',
  },
  toc: {
    id: 'toc',
    name: 'TOC Entry',
    category: 'list',
    xmlTag: 'list',
    xmlType: 'pl',
    xmlClass: 'toc-entry',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: false,
    blankAfter: false,
    hasDotLeaders: true,
    description: 'Table of contents entry with BANA dot leaders connecting to page number.',
  },
  'list-bullet': {
    id: 'list-bullet',
    name: 'Bullet List',
    category: 'list',
    xmlTag: 'list',
    xmlType: 'ul',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: false,
    blankAfter: false,
    description: 'Unordered list with bullet indicators and 1-3 margin.',
  },
  'list-number': {
    id: 'list-number',
    name: 'Numbered List',
    category: 'list',
    xmlTag: 'list',
    xmlType: 'ol',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: false,
    blankAfter: false,
    description: 'Ordered numbered list with 1-3 margin.',
  },
  plain: {
    id: 'plain',
    name: 'Plain List',
    category: 'list',
    xmlTag: 'list',
    xmlType: 'pl',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: true,
    blankAfter: true,
    description: 'Unmarked list (DTBook <list type="pl">) with 1-3 margin; nested levels step in by 2 with all runovers two cells right of the deepest level (BANA Formats §8.5.1b; UKAAF B004 §10 / App C).',
  },
  index: {
    id: 'index',
    name: 'Index Entry',
    category: 'list',
    xmlTag: 'list',
    xmlType: 'pl',
    xmlClass: 'bai-index',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: false,
    blankAfter: false,
    description: 'Index / alphabetic reference entry: main entry 1-3, each subentry level two cells further right with all runovers two cells right of the deepest level (1-5, 3-5); each index starts on a new braille page (BANA Formats §21.2.1, §21.4; UKAAF B004 App I).',
  },
  dialogue: {
    id: 'dialogue',
    name: 'Play Dialogue',
    category: 'drama',
    xmlTag: 'p',
    xmlClass: 'bai-play',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: false,
    blankAfter: false,
    description: 'Prose play dialogue: Speaker begins at Cell 1, speech runover at Cell 3.',
  },
  stage: {
    id: 'stage',
    name: 'Stage Direction',
    category: 'drama',
    xmlTag: 'p',
    xmlClass: 'bai-stage',
    firstCell: 7,
    runoverCell: 7,
    blankBefore: false,
    blankAfter: false,
    description: 'Stage directions indented 6 spaces (Cell 7) with Cell 7 runover.',
  },
  poem: {
    id: 'poem',
    name: 'Poetry / Verse',
    category: 'poetry',
    xmlTag: 'poem',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: true,
    blankAfter: true,
    description: 'Poetry stanza: First line at Cell 1, runover at Cell 3, with line numbers.',
  },
  exercise: {
    id: 'exercise',
    name: 'Exercise Main Question',
    category: 'list',
    xmlTag: 'list',
    xmlClass: 'bai-exercise',
    firstCell: 1,
    runoverCell: 5,
    blankBefore: false,
    blankAfter: false,
    description: 'Exercise main question starting at Cell 1 with Cell 5 runover (1-5).',
  },
  'exercise-sub': {
    id: 'exercise-sub',
    name: 'Exercise Sub-Question',
    category: 'list',
    xmlTag: 'li',
    xmlClass: 'bai-exercise-sub',
    firstCell: 3,
    runoverCell: 5,
    blankBefore: false,
    blankAfter: false,
    description: 'Exercise sub-question starting at Cell 3 with Cell 5 runover (3-5).',
  },
  footnote: {
    id: 'footnote',
    name: 'Footnote',
    category: 'text',
    xmlTag: 'note',
    xmlClass: 'footnote',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: false,
    blankAfter: false,
    description: 'Footnote text formatted with BANA 1-3 margin without TN quotes.',
  },
  note: {
    id: 'note',
    name: "Transcriber's Note",
    category: 'text',
    xmlTag: 'prodnote',
    firstCell: 7,
    runoverCell: 5,
    blankBefore: false,
    blankAfter: false,
    hasTnQuotes: true,
    description: "Transcriber's note enclosed in BANA TN quotes (,' ... ,') with 7-5 margin.",
  },
  caption: {
    id: 'caption',
    name: 'Caption / Attribution',
    category: 'text',
    xmlTag: 'caption',
    firstCell: 7,
    runoverCell: 5,
    blankBefore: false,
    blankAfter: false,
    description: 'Image or figure caption with BANA 7-5 margin.',
  },
  attribution: {
    id: 'attribution',
    name: 'Attribution / Byline',
    category: 'text',
    xmlTag: 'byline',
    firstCell: 5,
    runoverCell: 5,
    blankBefore: false,
    blankAfter: true,
    description: 'Source or author attribution blocked at Cell 5 (BANA Formats §9.4.1b), no blank line before and a blank line after (§9.4.1d).',
  },
  glossary: {
    id: 'glossary',
    name: 'Glossary Definition',
    category: 'list',
    xmlTag: 'dl',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: true,
    blankAfter: true,
    description: 'Glossary definition list with 1-3 margin.',
  },
  sidebar: {
    id: 'sidebar',
    name: 'Sidebar Box',
    category: 'container',
    xmlTag: 'sidebar',
    isContainer: true,
    firstCell: 1,
    runoverCell: 1,
    blankBefore: true,
    blankAfter: true,
    hasBoxlines: true,
    description: 'Multi-element callout box between BANA box lines (Formats §7.1.3): top 777..., bottom GGG... (exterior === when boxes are nested); heading on the line after the top line.',
  },
  'table-spatial': {
    id: 'table-spatial',
    name: 'Spatial Columnar Table',
    category: 'table',
    xmlTag: 'table',
    xmlClass: 'bana-spatial',
    blankBefore: true,
    blankAfter: true,
    description: '2D grid table: column headings over a dot-5/dots-25 ("333) separation line (Formats §11.4.2), 2-cell gutters, guide dots to fill short or blank entries (§11.6.1f, §11.6.4), numbers aligned by place value (§11.6.1d), runovers 2 cells in (§11.6.1a). In UKAAF mode an over-wide table falls back to B004 §12 paragraph form.',
  },
  'table-listed': {
    id: 'table-listed',
    name: 'Listed Table',
    category: 'table',
    xmlTag: 'table',
    xmlClass: 'bana-listed',
    firstCell: 1,
    runoverCell: 3,
    blankBefore: true,
    blankAfter: true,
    description: 'BANA §11 listed table format: Each row is an item with column labels.',
  },
  'print-page': {
    id: 'print-page',
    name: 'Print Page Indicator',
    category: 'meta',
    xmlTag: 'pagenum',
    description: 'Source print page change indicator: UKAAF centred "3 + number (B004 §8); BANA a line of dots 36 ending in the number at the right margin (Formats §1.11.3).',
  },
  quote: {
    id: 'quote',
    name: 'Blockquote',
    category: 'text',
    xmlTag: 'blockquote',
    firstCell: 3,
    runoverCell: 3,
    blankBefore: true,
    blankAfter: true,
    description: 'Displayed / quoted material: BANA blocked 3-3 at the adjusted margin with a blank line before and after (Formats §9.2.2); UKAAF 7-5 with no blank lines (B004 App. B / App. G).',
  },
  break: {
    id: 'break',
    name: 'Document Break',
    category: 'meta',
    xmlTag: 'hr',
    firstCell: 1,
    runoverCell: 1,
    blankBefore: true,
    blankAfter: true,
    description: 'Formal section break ( ∗ ∗ ∗ ).',
  },
};

/**
 * Returns margin configuration (first cell indent, runover indent, blanks) for a given style.
 * @param {string} styleId
 * @param {string} profile 'bana' | 'ukaaf'
 * @returns {{ first: number, runover: number, blankBefore: boolean, blankAfter: boolean, centered?: boolean }}
 */
export function getStyleMargins(styleId, profile = 'bana') {
  const def = STYLE_DEFINITIONS[styleId] || STYLE_DEFINITIONS.body;
  const isUkaaf = profile === 'ukaaf';

  if (def.align === 'centered') {
    return { first: 0, runover: 0, blankBefore: def.blankBefore, blankAfter: def.blankAfter, centered: true };
  }

  let first = (def.firstCell ?? 3) - 1;       // 1-indexed to 0-indexed space count
  let runover = (def.runoverCell ?? 1) - 1;

  // UKAAF minor adjustments if applicable
  let blankBefore = Boolean(def.blankBefore), blankAfter = Boolean(def.blankAfter);
  if (isUkaaf && styleId === 'h3') {
    first = 4; // Cell 5 in UKAAF
    runover = 4;
  } else if (isUkaaf && styleId === 'quote') {
    first = 6; // B004 App. B: quoted material 7-5, "no blank lines are used"
    runover = 4;
    blankBefore = false; blankAfter = false;
  } else if (isUkaaf && styleId === 'note') {
    first = 0; // B004 gives no TN margin; the house 1-3 is kept (BANA: 7-5, Formats §3.2.2)
    runover = 2;
  }

  return {
    first: Math.max(0, first),
    runover: Math.max(0, runover),
    blankBefore,
    blankAfter,
  };
}

/**
 * Returns true if the style is a list-based style.
 * @param {string} styleId
 * @returns {boolean}
 */
export function isListStyle(styleId) {
  const def = STYLE_DEFINITIONS[styleId];
  return def?.category === 'list' || styleId.startsWith('list') || styleId.startsWith('exercise') || styleId === 'toc' || styleId === 'glossary' || styleId === 'index' || styleId === 'plain';
}

/**
 * Resolves style ID from an XML node (tag name + class attributes).
 * @param {string} tagName
 * @param {string} className
 * @returns {string} styleId
 */
export function resolveStyleFromXml(tagName, className = '') {
  const tag = (tagName || '').toLowerCase();
  const cls = (className || '').toLowerCase();

  if (tag === 'h1' || (tag.startsWith('level') && tag.endsWith('1'))) return 'h1';
  if (tag === 'h2' || (tag.startsWith('level') && tag.endsWith('2')) || tag === 'bridgehead') return 'h2';
  if (tag === 'h3' || (tag.startsWith('level') && tag.endsWith('3'))) return 'h3';

  if (cls.includes('bai-play') || cls.includes('dialogue') || tag === 'speaker' || cls.includes('speaker')) return 'dialogue';
  if (cls.includes('bai-stage') || cls.includes('stage') || tag === 'stage') return 'stage';
  if (cls.includes('bai-exercise-sub')) return 'exercise-sub';
  if (cls.includes('bai-exercise') || cls.includes('exercise')) return 'exercise';
  if (cls.includes('toc-entry') || cls.includes('bai-toc') || cls.includes('toc')) return 'toc';
  if (cls.includes('bai-index') || cls.includes('index')) return 'index';
  if (cls.includes('footnote') || tag === 'footnote') return 'footnote';
  if (cls.includes('quote') || tag === 'blockquote') return 'quote';
  if (tag === 'byline' || tag === 'author') return 'attribution';
  if (tag === 'dl' || cls.includes('glossary')) return 'glossary';

  if (tag === 'sidebar') return 'sidebar';
  if (tag === 'prodnote') return 'note';
  if (tag === 'caption' || tag === 'figcaption') return 'caption';
  if (tag === 'poem' || tag === 'stanza' || tag === 'linegroup' || tag === 'line' || cls.includes('verse')) return 'poem';
  if (tag === 'table') return cls.includes('listed') ? 'table-listed' : 'table-spatial';
  if (tag === 'pagenum' || tag === 'print-page') return 'print-page';
  if (tag === 'hr') return 'break';

  if (tag === 'list' || tag === 'ul' || tag === 'ol') {
    if (cls.includes('toc')) return 'toc';
    if (cls.includes('index')) return 'index';
    if (tag === 'ol') return 'list-number';
    return 'list-bullet';
  }

  return 'body';
}

/**
 * Formats a live Style Inspector breadcrumb label for a given style ID and layout profile.
 * Example output: "Style: Play Dialogue (1-3) | Cell: 1 | Alignment: Left | Profile: BANA"
 * @param {string} styleId
 * @param {string} profile 'bana' | 'ukaaf'
 * @param {(key: string, params: object, fallback: string) => string} [tr] interface translator
 *   (keys app.inspector.* and app.style_names.<id>); English when omitted.
 * @returns {string}
 */
export function formatStyleInspectorBadge(styleId, profile = 'bana', tr = null) {
  const T = (key, fallback, params = {}) => (tr ? tr(key, params, fallback) : fallback.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? ''));
  const normId = (styleId === 'p' || styleId === 'body') ? 'body'
    : (styleId === 'bullet' || styleId === 'ul') ? 'list-bullet'
    : (styleId === 'number' || styleId === 'ol') ? 'list-number'
    : (styleId === 'verse') ? 'poem'
    : (styleId === 'index') ? 'index'
    : (styleId === 'plain') ? 'plain'
    : (styleId === 'table') ? 'table-spatial'
    : (styleId === 'indicator') ? 'break'
    : (styleId === 'play') ? 'dialogue'
    : (styleId === 'box') ? 'sidebar'
    : (styleId === 'graphic') ? 'caption'
    : (styleId === 'math') ? 'body'
    : (styleId === 'pagenum') ? 'print-page'
    : (styleId || 'body');

  const def = STYLE_DEFINITIONS[normId] || STYLE_DEFINITIONS.body;
  const isUkaaf = String(profile).toLowerCase() === 'ukaaf';
  const profileLabel = isUkaaf ? 'UKAAF' : 'BANA';

  let firstCell = def.firstCell ?? 3;
  let runoverCell = def.runoverCell ?? 1;

  if (isUkaaf && normId === 'h3') {
    firstCell = 5;
    runoverCell = 5;
  } else if (isUkaaf && normId === 'quote') {
    firstCell = 7;       // B004 App. B quoted material 7-5
    runoverCell = 5;
  } else if (isUkaaf && normId === 'note') {
    firstCell = 1;       // house 1-3 (BANA 7-5)
    runoverCell = 3;
  }

  let marginTag = '';
  let cellStr = String(firstCell);
  let alignStr = T('app.inspector.left', 'Left');

  if (def.align === 'centered') {
    marginTag = `(${T('app.inspector.centered', 'Centered')})`;
    cellStr = T('app.inspector.centered', 'Centered');
    alignStr = T('app.inspector.center', 'Center');
  } else if (def.hasBoxlines) {
    marginTag = `(${T('app.inspector.boxlines', 'Boxlines')})`;
    cellStr = '1';
  } else if (normId === 'table-spatial') {
    marginTag = `(${T('app.inspector.grid', 'Grid')})`;
    cellStr = '1';
  } else if (normId === 'print-page') {
    marginTag = '';
    cellStr = '1';
  } else if (normId === 'h2' || normId === 'h3') {
    marginTag = `(${T('app.inspector.cell_n', 'Cell {n}', { n: firstCell })})`;
    cellStr = String(firstCell);
  } else if (firstCell != null && runoverCell != null) {
    marginTag = `(${firstCell}-${runoverCell})`;
    cellStr = String(firstCell);
  } else if (firstCell != null) {
    marginTag = `(${T('app.inspector.cell_n', 'Cell {n}', { n: firstCell })})`;
    cellStr = String(firstCell);
  }

  const name = T(`app.style_names.${normId.replace(/-/g, '_')}`, def.name || 'Body Text');
  const marginPart = marginTag ? ` ${marginTag}` : '';
  return T('app.inspector.badge', 'Style: {name} | Cell: {cell} | Alignment: {align} | Profile: {profile}',
    { name: `${name}${marginPart}`, cell: cellStr, align: alignStr, profile: profileLabel });
}

