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
    description: 'Multi-element callout box with BANA top (333...) and bottom (777...) boxlines.',
  },
  'table-spatial': {
    id: 'table-spatial',
    name: 'Spatial Columnar Table',
    category: 'table',
    xmlTag: 'table',
    xmlClass: 'bana-spatial',
    blankBefore: true,
    blankAfter: true,
    description: '2D grid table with column headers, separator lines, and 2-cell gutters.',
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
    description: 'Source print page break indicator.',
  },
  quote: {
    id: 'quote',
    name: 'Blockquote',
    category: 'text',
    xmlTag: 'blockquote',
    firstCell: 3,
    runoverCell: 1,
    blankBefore: true,
    blankAfter: true,
    description: 'Quoted block with BANA 3-1 paragraph margin and surrounding blank lines.',
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
  if (isUkaaf && styleId === 'h3') {
    first = 4; // Cell 5 in UKAAF
    runover = 4;
  }

  return {
    first: Math.max(0, first),
    runover: Math.max(0, runover),
    blankBefore: Boolean(def.blankBefore),
    blankAfter: Boolean(def.blankAfter),
  };
}

/**
 * Returns true if the style is a list-based style.
 * @param {string} styleId
 * @returns {boolean}
 */
export function isListStyle(styleId) {
  const def = STYLE_DEFINITIONS[styleId];
  return def?.category === 'list' || styleId.startsWith('list') || styleId.startsWith('exercise') || styleId === 'toc';
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

  if (cls.includes('bai-play') || cls.includes('dialogue')) return 'dialogue';
  if (cls.includes('bai-stage') || cls.includes('stage')) return 'stage';
  if (cls.includes('bai-exercise-sub')) return 'exercise-sub';
  if (cls.includes('bai-exercise') || cls.includes('exercise')) return 'exercise';
  if (cls.includes('toc-entry') || cls.includes('bai-toc')) return 'toc';
  if (cls.includes('footnote') || tag === 'footnote') return 'footnote';

  if (tag === 'sidebar') return 'sidebar';
  if (tag === 'prodnote') return 'note';
  if (tag === 'caption' || tag === 'figcaption' || tag === 'byline') return 'caption';
  if (tag === 'poem' || tag === 'stanza') return 'poem';
  if (tag === 'table') return cls.includes('listed') ? 'table-listed' : 'table-spatial';
  if (tag === 'pagenum' || tag === 'print-page') return 'print-page';
  if (tag === 'hr') return 'break';

  if (tag === 'list' || tag === 'ul' || tag === 'ol') {
    if (cls.includes('toc')) return 'toc';
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
 * @returns {string}
 */
export function formatStyleInspectorBadge(styleId, profile = 'bana') {
  const normId = (styleId === 'p' || styleId === 'body') ? 'body'
    : (styleId === 'bullet' || styleId === 'ul') ? 'list-bullet'
    : (styleId === 'number' || styleId === 'ol') ? 'list-number'
    : (styleId === 'verse') ? 'poem'
    : (styleId === 'plain') ? 'toc'
    : (styleId === 'table') ? 'table-spatial'
    : (styleId || 'body');

  const def = STYLE_DEFINITIONS[normId] || STYLE_DEFINITIONS.body;
  const isUkaaf = String(profile).toLowerCase() === 'ukaaf';
  const profileLabel = isUkaaf ? 'UKAAF' : 'BANA';

  let firstCell = def.firstCell ?? 3;
  let runoverCell = def.runoverCell ?? 1;

  if (isUkaaf && normId === 'h3') {
    firstCell = 5;
    runoverCell = 5;
  }

  let marginTag = '';
  let cellStr = String(firstCell);
  let alignStr = 'Left';

  if (def.align === 'centered') {
    marginTag = '(Centered)';
    cellStr = 'Centered';
    alignStr = 'Center';
  } else if (def.hasBoxlines) {
    marginTag = '(Boxlines)';
    cellStr = '1';
  } else if (normId === 'table-spatial') {
    marginTag = '(Grid)';
    cellStr = '1';
  } else if (normId === 'print-page') {
    marginTag = '';
    cellStr = '1';
  } else if (normId === 'h2' || normId === 'h3') {
    marginTag = `(Cell ${firstCell})`;
    cellStr = String(firstCell);
  } else if (firstCell != null && runoverCell != null) {
    marginTag = `(${firstCell}-${runoverCell})`;
    cellStr = String(firstCell);
  } else if (firstCell != null) {
    marginTag = `(Cell ${firstCell})`;
    cellStr = String(firstCell);
  }

  const name = def.name || 'Body Text';
  const marginPart = marginTag ? ` ${marginTag}` : '';
  return `Style: ${name}${marginPart} | Cell: ${cellStr} | Alignment: ${alignStr} | Profile: ${profileLabel}`;
}

