// Emboss editor: Lexical (vanilla core) → Emboss block model → live braille.
// Reuses the gold-validated engine (/format + /engine). Adds inline MathLive
// equations, a "* * *" document break, a Table-of-Contents toggle, real UEB
// typeform emphasis, a braille-cell preview, and ARIA-toolbar a11y.
// First, so it records any error from the moment the page starts (A89 step 2, Report a problem).
import { openProblemDialog, recordProblem, problemCount, problemLog } from '/web/problem-report.mjs';
import {
  createEditor, $getRoot, $getSelection, $isRangeSelection,
  ParagraphNode, $createParagraphNode, $createTextNode, FORMAT_TEXT_COMMAND,
  DecoratorNode, ElementNode, $insertNodes, $getNodeByKey, $insertNodeToNearestRoot,
  registerRichText, HeadingNode, QuoteNode, $createHeadingNode, $isHeadingNode,
  ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND, registerList, $isListNode, $createListNode, $createListItemNode,
  $setBlocksType, TextNode, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, COMMAND_PRIORITY_HIGH,
  $setSelection, $createNodeSelection, $isNodeSelection,
  PASTE_COMMAND, $insertDataTransferForRichText,
} from './vendor-lexical.mjs';

const $isTextNode = (n) => n instanceof TextNode;
const $isElementNode = (n) => typeof n?.getChildren === 'function';
const $isQuoteNode = (n) => n instanceof QuoteNode;
const $isListItemNode = (n) => n instanceof ListItemNode;
import { formatDocument, formatDocumentAsync, formatVolumes, tableLayout, collectSpecialSymbols, symbolMeaning, suggestTranscriberNotes, titlePageFieldsFrom, withListNestLevel } from '/format/document.mjs';
import { formatStyleInspectorBadge, STYLE_DEFINITIONS, getStyleMargins } from '/format/styles.mjs';
import { exportToNimasXml, isBulletMarker, bulletName, synthesizeOrderedMarker } from '/input/nimas-export.mjs';
import { FMT_OFF as REGISTRY_FMT_OFF, GROUPS as FIELD_GROUPS, CODECS as FIELD_CODECS, fieldByKey, controlById, groupControlIds, groupsForKind, fmtKeysFor, fmtOffKeys, docOptionFields, TRANSCRIBER_STYLES, TRANSCRIBER_BUTTONS, EVERYDAY_STYLES, titlepageBookDetails, REPRODUCTION_NOTICES, ukAccessibleCopyStatement, titlePageTemplateSegments, refreshTitlePageValues, titlePageStructureSig, TP_FIELD_LABELS, tpInsertableFields, tpFieldCurrentValue } from '/format/field-registry.mjs';
import { titlePagePrintHtml } from '/format/titlepage-print.mjs';   // K29 Stage 1d: "Print title page…" — see that module's own header comment
import { buildNimasPackage } from '/input/nimas-package.mjs';
import { checkPackagePaths } from '/input/nimas-package.mjs';   // (a separate line: tests/nimas_package_export.test.mjs matches the line above)
import { htmlNamedCharsToText } from '/input/omml.mjs';
import { cellSegments, cellPlainText, cellToMarkup } from '/format/cell-markup.mjs';
// Table cell rich editing (G15): segments <-> the small HTML string a contenteditable
// table cell shows/edits, so a cell displays real bold/italic/underline/uncontracted
// formatting and atomic maths/note-reference chips instead of markup characters.
import { cellToEditableHtml, cellHtmlToSegments, cellFromEditableHtml } from '/format/cell-dom.mjs';
import { makeZip } from '/web/zip.mjs';
import { exportToDocxBlob } from '/web/docx-export.mjs';
import { exportToText, exportToMarkdown, exportToHtml, bytesToBase64 } from '/web/export-formats.mjs';   // S5d: the alternative saves (txt, md, html), one traversal of the model
import { Reader, buildSpokenItems, speechAvailable, sliceItemsFrom } from '/web/tts.mjs';
import * as louis from '/engine/louis-browser.mjs';
import { renderBraille, expandRowCells, autoFitBraille } from '/web/braille-render.mjs';
import { proofread, roundTrip, blockEntries } from '/web/proofread.mjs';
import { parseFile, BINARY_EXTS } from '/input/parse.mjs';
import { BRF64, brfToUnicodeBraille } from '/engine/brf-ascii.mjs';
import * as maths from '/engine/maths.mjs';
import { mathmlToLatex } from '/engine/mathml-to-latex.mjs';
import { styledTranslate, styledTranslatePos, SCRIPT_MARKS, normalizeTextAndTypeform } from '/format/text-style.mjs';
import { loadSettings, saveSettings, MODE_GEOMETRY, EMBOSSER_NAMES, EMBOSSER_PRESETS, PAGE_SIZE_PRESETS, fillPageSizeSelect, isGraphicsSupported, effectiveMathCode, isPhoneScreen, PHONE_EDITOR_ANYWAY_KEY, markStayInQuick, betaLocked, keepNumbersInRange, largeFileWarning, largeFileQuestion } from '/web/settings.mjs';
keepNumbersInRange(document.getElementById('settingsDialog'));   // Settings only: dialogs that check their own numbers say why (Braille formatting)
import { resolveTable, makeTranslators, UEB_TABLES, registryName, codeLanguage, settingsForTable } from '/web/braille-table.mjs';
import { spoolToNetworkEmbosser, connectionSupport, chooseEmbosserTarget, sendToEmbosserTarget, initEmbosserAutoDetect } from '/format/spooler.mjs';
import { transpileTactileSvg, transpileTactileSvgForDevice, createGraphicBlock, defaultBrailleTranslator, createLeadLineSvg } from '/format/tactile-svg.mjs';
import { plotTactileFunction, isPlottableEquation } from '/format/math-plotter.mjs';
import { TACTILE_SVG_LIBRARY, TACTILE_SVG_CATEGORIES } from '/web/tactile-library.js';
import { exportToPef } from '/format/pef.mjs';
import { exportToEbraille, ebrailleWarningText } from '/format/ebraille.mjs';
import { tactileDisplay, rasterizeSvgToDotPadCells, rasterizeSvgToMonarchCells, charToDotMask } from '/format/tactile-display.mjs';
import { openTactileSymbolBrowser } from '/web/tactile-browser.mjs';
import { CODES } from '/Translate/braille-codes.mjs';
import { describeUebMaths } from '/Translate/ueb-maths-to-latex.mjs';
import { describeNemeth } from '/Translate/nemeth-symbols.mjs';
import { readHandoff, confirmHandoff, setHandoffDoc, newHandoffId, handoffHash, brailleKey, brailleFlags } from '/web/handoff-db.mjs';
import { initI18n, t, setLocale, getLocale, getLocaleInfo, getSupportedLocales, getOrderedLocales, translateDOM, registerLocale } from '/web/i18n.mjs';
import { watchOfflineReady } from '/web/offline-ready.mjs';
import { getBuildInfo } from '/web/build-info.mjs';
import { iconSvg, iconEl } from '/web/icons.mjs';   // Iconoir line icons; also adds the page's icon symbols (feedback 30 Sep, item 18)
import { mountSettingsDialog } from '/web/settings-panes.mjs';
import { initAutosave, checkForRecovery, clearSnapshot as clearAutosaveSnapshot, forceAutosaveTick, noteChange as noteAutosaveChange } from '/web/editor/autosave.mjs';

// The Settings dialog is made from the one source Quick Mode uses too (web/settings-panes.mjs; feedback 17 Oct 2026, item 9a), before anything below looks for its controls.
mountSettingsDialog(document.getElementById('settingsDialog'), { page: 'editor' });

if (typeof window !== 'undefined') {
  window.parseFile = parseFile;
  window.exportToNimasXml = exportToNimasXml;
  window.exportCurrentDocumentXml = () => {
    let currentDocModel = null;
    editor.getEditorState().read(() => { currentDocModel = mergeListItemBlocks(buildModel()); });
    const doc = currentDocModel || lastModel || { title: 'Document', blocks: [] };
    return exportToNimasXml(doc, { title: doc.title || 'Document', mode: settings.mode });   // UK-9: an auto title page's saved wording follows the current format mode
  };
  window.importFile = importFile;
  window.showRuleInfo = showRuleInfo;
  window.indentCurrentItem = indentCurrentItem;
  window.outdentCurrentItem = outdentCurrentItem;
  // Test hooks (Emboss/tests/test-autosave.mjs): force an immediate autosave write instead of
  // waiting for the real 30s interval, and check/clear the stored snapshot directly.
  window.__forceAutosaveTick = forceAutosaveTick;
  window.__clearAutosaveSnapshot = clearAutosaveSnapshot;
}

let settings = loadSettings();                 // standard / grade / geometry / quotes / lists / toc (shared with the converter)
// "Transcriber tools" (settings.transcriberTools, off by default): see applyTranscriberTools. Declared here, before any
// code that may ask for it (toolbar-button updates run from editor update listeners).
// A beta build keeps it off, its switch hidden, unless unlocked with ?tools=1 (feedback item 15; betaLocked, settings.mjs).
const BETA_LOCKED = betaLocked();
if (BETA_LOCKED) document.body.classList.add('beta-locked');
let transcriberTools = settings.transcriberTools === true && !BETA_LOCKED;
function transcriberToolsOn() { return transcriberTools; }
// The caret's last known place in the editor. Declared up here (not with the other caret state further down) because the
// Transcriber tools setup runs at load and asks the remove-box check where the caret is (it read this variable before
// its `let` ran — a temporal-dead-zone ReferenceError, caught and logged).
let lastActiveEditorSelection = null;
const $id = (id) => document.getElementById(id);
// State of the explanation bar's typing hold (see TYPING_PAUSE_MS, below), declared up here so nothing that runs early can reach it before it exists.
let typingAt = 0;
let typingTimer = null;
let pendingRuleWord = null;
// Scroll one pane to an element WITHOUT scrolling the page round it (feedback 17 Oct 2026, item 6). element.scrollIntoView() also scrolls every
// scrollable ancestor — <main> is overflow:hidden but can still be scrolled by a script — so a click on a Table of Contents link (block:'center')
// pushed the whole interface up and left a band of white under the explanation bar. This moves `container` only.
function scrollWithin(container, el, { block = 'center', behavior = 'auto' } = {}) {
  if (!container || !el) return;
  const c = container.getBoundingClientRect(), r = el.getBoundingClientRect();
  let delta = 0;
  if (block === 'center') delta = (r.top + r.height / 2) - (c.top + c.height / 2);
  else if (r.top < c.top) delta = r.top - c.top;
  else if (r.bottom > c.bottom) delta = r.bottom - c.bottom;
  if (Math.abs(delta) < 1) return;
  const top = Math.max(0, container.scrollTop + delta);
  if (behavior === 'smooth' && typeof container.scrollTo === 'function') container.scrollTo({ top, behavior }); else container.scrollTop = top;
}
// Nothing but the two panes scrolls: if anything else is moved (an equation scrolling itself into view, a browser scrolling the caret), put it back.
for (const holder of [document.querySelector('main'), document.body, document.documentElement]) {
  if (holder) holder.addEventListener('scroll', () => { if (holder.scrollTop || holder.scrollLeft) { holder.scrollTop = 0; holder.scrollLeft = 0; } }, { passive: true });
}

// ---- One style registry for the style dropdown AND the slash menu (G1) ----
// Every block style the editor can apply is listed here once. The dropdown (#blockStyle,
// built by buildBlockStyleSelect) and the slash menu (SLASH_COMMANDS, below) are both made
// from this list, so they always offer the same styles. `slash` is the slash id (what the
// user types after "/"), `slashKey` the i18n key stem if it differs, `slashAction` an
// override for styles whose slash command inserts rather than converts. full/short/mini
// are the dropdown label at wide / compact / ultra-compact toolbar widths.
//
// "Computer code" (import fix list #40, 1 Oct 2026) is a paragraph style like Blockquote: the paragraph keeps its spaces and
// line breaks (a line break is a line of the code), paraBlock() turns it into a `{ type: 'code', text }` block (the formatter's
// grade-1 passage, BANA 19 / UEB technical 17) and the save writes <p class="bana-code"> with <br/>. See paraBlock, appendBlock and the Enter rule (ParagraphNode.insertNewAfter).
const tOr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const BLOCK_STYLES = [
  { value: 'p', slash: 'p', icon: 'i:text', title: 'Paragraph (Body)', desc: 'Standard body paragraph (3-1)',
    keywords: ['p', 'para', 'paragraph', 'body', 'text', 'standard'],
    full: () => tOr('styles.body', 'Body Text'), short: () => tOr('app.styles.short_text', 'Text'), mini: () => '' },
  { value: 'h1', slash: 'h1', icon: 'H1', title: 'Heading 1', desc: 'Major centered heading (1-1)',
    keywords: ['h1', 'heading 1', 'title', 'centered', 'major'],
    full: () => tOr('styles.h1', 'H1 Heading'), short: () => 'H1', mini: () => 'H1' },
  { value: 'h2', slash: 'h2', icon: 'H2', title: 'Heading 2', desc: 'Section heading (Cell 5)',
    keywords: ['h2', 'heading 2', 'section', 'subheading'],
    full: () => tOr('styles.h2', 'H2 Subheading'), short: () => 'H2', mini: () => 'H2' },
  { value: 'h3', slash: 'h3', icon: 'H3', title: 'Heading 3', desc: 'Subsection heading (Cell 7)',
    keywords: ['h3', 'heading 3', 'sub', 'subsection', 'minor'],
    full: () => tOr('styles.h3', 'H3 Sub-subheading'), short: () => 'H3', mini: () => 'H3' },
  { value: 'bullet', slash: 'ul', icon: 'i:list', title: 'Bulleted List', desc: 'Create bulleted list items (1-3)',
    keywords: ['ul', 'bullet', 'bullets', 'list', 'unordered'],
    full: () => tOr('styles.bullet_list', 'Bullet List'), short: () => tOr('app.styles.short_list', 'List'), mini: () => '' },
  { value: 'number', slash: 'ol', icon: '1.', title: 'Numbered List', desc: 'Create numbered list items (1-3)',
    keywords: ['ol', 'number', 'numbered', 'list', 'ordered'],
    full: () => `1. ${tOr('styles.number_list', 'Numbered List')}`, short: () => `1. ${tOr('app.styles.short_list', 'List')}`, mini: () => '1.' },
  { value: 'plain', slash: 'plain', icon: 'i:align-left', title: 'Plain List', desc: 'Unmarked list, DTBook <list type="pl"> (1-3; nested 1-5, 3-5)',
    keywords: ['plain', 'pl', 'list', 'unmarked', 'simple', 'no bullets'],
    full: () => tOr('app.style_names.plain', 'Plain List'), short: () => tOr('app.styles.short_plain', 'Plain'), mini: () => tOr('app.styles.mini_plain', 'Pl') },
  { value: 'index', slash: 'index', icon: 'i:page-search', title: 'Index Entry', desc: 'BANA §21 index entry (1-3; nested 1-5, 3-5; new braille page)',
    keywords: ['index', 'entry', 'subentry', 'alphabetic', 'reference', 'skill', 'skills'],
    full: () => `${tOr('app.styles.index', 'Index Entry')}`, short: () => tOr('app.styles.short_index', 'Index'), mini: () => tOr('app.styles.mini_index', 'Idx') },
  { value: 'toc', slash: 'toc', icon: 'i:list', title: 'TOC Entry', desc: 'Table of Contents entry with dot leaders (1-3)',
    keywords: ['toc', 'table of contents', 'contents', 'dot leaders', 'leader'],
    full: () => `${tOr('styles.toc_entry', 'TOC Entry')}`, short: () => tOr('app.styles.short_toc', 'TOC'), mini: () => tOr('app.styles.short_toc', 'TOC') },
  { value: 'dialogue', slash: 'dialogue', icon: 'i:chat-lines', title: 'Play Dialogue', desc: 'Prose drama dialogue speaker line (1-3)',
    keywords: ['dialogue', 'play', 'drama', 'speaker', 'character', 'line', 'script', 'speech'],
    full: () => `${tOr('styles.dialogue', 'Play Dialogue')}`, short: () => tOr('app.styles.short_play', 'Play'), mini: () => tOr('app.styles.short_play', 'Play') },
  { value: 'stage', slash: 'stage', icon: 'i:movie', title: 'Stage Direction', desc: 'Drama stage direction indented (7-7)',
    keywords: ['stage', 'direction', 'play', 'drama', 'setting', 'action', 'parenthetical'],
    full: () => `${tOr('styles.stage', 'Stage Direction')}`, short: () => tOr('app.styles.short_stage', 'Stage'), mini: () => tOr('app.styles.short_stage', 'Stage') },
  { value: 'poem', slash: 'poem', icon: 'i:journal-page', title: 'Poetry / Verse', desc: 'Poetic stanza verse line (1-3)',
    keywords: ['poem', 'poetry', 'verse', 'stanza', 'rhyme', 'lines', 'lyric'],
    full: () => `${tOr('styles.poem', 'Poetry / Verse')}`, short: () => tOr('app.styles.short_poem', 'Poem'), mini: () => tOr('app.styles.short_poem', 'Poem') },
  { value: 'exercise', slash: 'exercise', icon: 'i:help-circle', title: 'Exercise Question', desc: 'Numbered exercise question (1-5 / 3-5)',
    keywords: ['exercise', 'question', 'problem', 'homework', 'task', 'exam', 'quiz', 'subquestion'],
    full: () => `${tOr('styles.exercise', 'Exercise Question')}`, short: () => tOr('app.styles.short_exercise', 'Exercise'), mini: () => tOr('app.styles.mini_exercise', 'Ex') },
  // A caption and an attribution are two different DTBook elements (<caption>, <byline>).
  // There is only ONE attribution style — no separate "Byline" style (G1, 16 Sep).
  { value: 'caption', slash: 'caption', slashKey: 'figcaption', icon: 'i:chat-bubble-empty', title: 'Caption', desc: 'Figure or image caption (7-5)',
    keywords: ['caption', 'photo', 'figure', 'image', 'label'],
    full: () => `${tOr('app.styles.caption', 'Caption')}`, short: () => tOr('app.styles.short_caption', 'Caption'), mini: () => tOr('app.styles.mini_caption', 'Cap') },
  { value: 'attribution', slash: 'attribution', icon: 'i:edit-pencil', title: 'Attribution', desc: 'Source or author line, saved as <byline> (cell 5)',
    keywords: ['attribution', 'byline', 'author', 'source', 'credit'],
    full: () => `${tOr('app.styles.attribution', 'Attribution')}`, short: () => tOr('app.styles.short_attribution', 'Attrib'), mini: () => tOr('app.styles.mini_attribution', 'Attr') },
  { value: 'footnote', slash: 'footnote', icon: 'i:notes', title: 'Footnote', desc: 'Footnote note text (1-3)',
    keywords: ['footnote', 'note', 'reference', 'citation', 'annotation', 'fn'],
    full: () => `${tOr('styles.footnote', 'Footnote')}`, short: () => tOr('app.styles.short_footnote', 'Footnote'), mini: () => tOr('app.styles.mini_footnote', 'Fn') },
  { value: 'note', slash: 'note', icon: 'i:info-circle', title: "Transcriber's Note", desc: "Transcriber's note with BANA indicators (7-5)",
    keywords: ['note', 'transcriber', 'transcriber note', 'tn', 'prodnote', 'comment', 'remark'],
    full: () => `${tOr('styles.note', "Transcriber's Note")}`, short: () => tOr('app.styles.short_note', 'Note'), mini: () => tOr('app.styles.mini_note', 'TN') },
  { value: 'sidebar', slash: 'sidebar', icon: 'i:box-iso', title: 'Sidebar Box', desc: 'Insert callout box with BANA boxlines',
    keywords: ['sidebar', 'box', 'callout', 'panel', 'aside'], slashAction: () => insertSidebar(),
    full: () => `${tOr('app.styles.sidebar', 'Sidebar Box')}`, short: () => tOr('app.styles.short_sidebar', 'Sidebar'), mini: () => tOr('app.styles.mini_sidebar', 'Box') },
  { value: 'titlepage', slash: 'titlepage', icon: 'i:open-book', title: 'Title Page', desc: 'Insert the Title Page (BANA 2.3.3), at the start of the book',
    keywords: ['title', 'titlepage', 'title page', 'cover', 'front matter'], slashAction: () => insertTitlePage(),
    full: () => `${tOr('app.styles.titlepage', 'Title Page')}`, short: () => tOr('app.styles.short_titlepage', 'Title Page'), mini: () => tOr('app.styles.mini_titlepage', 'TP') },
  { value: 'tnpage', slash: 'tnpage', icon: 'i:multiple-pages-empty', title: "Transcriber's Notes Page", desc: "Insert a Transcriber's Notes page (own page, 3-1 entries, no indicators)",
    keywords: ['transcriber', 'notes', 'tn', 'tnpage', 'page', 'front matter', 'notes page'], slashAction: () => insertTnPage(),
    full: () => `${tOr('app.styles.tnpage', "Transcriber's Notes Page")}`, short: () => tOr('app.styles.short_tnpage', 'TN Page'), mini: () => tOr('app.styles.mini_tnpage', 'TNP') },
  // UK-8 (28 Sep): "UKAAF has no Special Symbols page... the style/slash/insert UI doesn't offer it in
  // UKAAF mode" — `when` keeps it out of the dropdown/slash menu while settings.mode isn't 'bana' (a
  // UKAAF document that already has one still shows/keeps it: the "current block's own style" exception
  // in syncStyleOptionVisibility, and the page itself is untouched either way).
  { value: 'sympage', slash: 'sympage', icon: 'i:hashtag', title: 'Special Symbols Page', desc: 'Insert a Special Symbols page (own page, listed automatically from the document until edited)',
    keywords: ['special', 'symbols', 'symbol', 'sympage', 'page', 'front matter', 'dot locator', 'bullets'], slashAction: () => insertSymPage(), when: () => settings.mode === 'bana',
    full: () => `${tOr('app.styles.sympage', 'Special Symbols Page')}`, short: () => tOr('app.styles.short_sympage', 'Symbols Page'), mini: () => tOr('app.styles.mini_sympage', 'SSP') },
  { value: 'table-spatial', slash: 'table', icon: 'i:table', title: 'Spatial Braille Table', desc: 'Insert 3×3 columnar data table',
    keywords: ['table', 'grid', 'column', 'row', 'spatial', 'data'], slashAction: () => insertTable(3, 3, 'spatial'),
    full: () => `${tOr('app.styles.table_spatial', 'Table (Spatial)')}`, short: () => tOr('app.styles.short_table', 'Table'), mini: () => tOr('app.styles.mini_table', 'Tbl') },
  { value: 'table-listed', slash: 'listedtable', icon: 'i:table-rows', title: 'Listed Table', desc: 'Insert BANA listed linear table format',
    keywords: ['listedtable', 'table', 'listed', 'linear'], slashAction: () => insertTable(3, 3, 'listed'),
    full: () => `${tOr('app.styles.table_listed', 'Table (Listed)')}`, short: () => tOr('app.styles.short_table_listed', 'Tbl-List'), mini: () => tOr('app.styles.mini_table_listed', 'List') },
  { value: 'quote', slash: 'quote', icon: 'i:quote', title: 'Blockquote', desc: 'Indented quotation block (3-1)',
    keywords: ['quote', 'blockquote', 'quotation', 'citation', 'excerpt', 'indent'],
    full: () => tOr('styles.quote', 'Blockquote'), short: () => tOr('app.styles.short_quote', 'Quote'), mini: () => tOr('app.styles.mini_quote', 'Quote') },
  // A print structure (like Blockquote), not a transcriber judgement: in the same audience group as Blockquote (not an everyday
  // style, so offered with Transcriber tools on; a code block that is already in the document always shows its style).
  { value: 'code', slash: 'code', icon: 'i:code', title: 'Computer Code', desc: 'Displayed computer code: lines and spaces kept, a grade 1 passage (BANA 19)',
    keywords: ['code', 'computer', 'program', 'source', 'listing', 'preformatted', 'pre', 'monospace', 'script'],
    full: () => tOr('styles.code', 'Computer Code'), short: () => tOr('app.styles.short_code', 'Code'), mini: () => tOr('app.styles.mini_code', 'Code') },
];

// Audience of each style (format/field-registry.mjs EVERYDAY_STYLES, Paul 26 Sep): only the everyday styles are for
// everyone; the rest, the transcriber pages included, are hidden from the dropdown and the slash menu while
// "Transcriber tools" is off (the current block's own style excepted — syncStyleOptionVisibility).
for (const d of BLOCK_STYLES) d.audience = EVERYDAY_STYLES.includes(d.value) ? 'everyone' : 'transcriber';

// (Re)write the dropdown's option labels for a toolbar width mode: 'full' | 'short' | 'mini'.
// data-full/short/mini carry all three so a screen-reader announcement can use the full one.
function refreshBlockStyleLabels(mode = 'full') {
  const sel = document.getElementById('blockStyle');
  if (!sel) return;
  const byValue = new Map(BLOCK_STYLES.map((d) => [d.value, d]));
  for (const opt of allBlockStyleOptions) {
    const def = byValue.get(opt.value);
    if (!def) continue;
    opt.dataset.full = def.full();
    opt.dataset.short = def.short();
    opt.dataset.mini = def.mini();
    opt.textContent = (def[mode] || def.full)();
  }
  updateStyleMenuUI();
}
// Every style's <option>, in BLOCK_STYLES order, whether or not it is in the dropdown just now: the styles hidden while
// Transcriber tools is off are taken out of the select, not marked hidden, because Safari's dropdown still lists a
// hidden option (Paul, 30 Sep) — see syncStyleOptionVisibility.
const allBlockStyleOptions = [];
// Build the dropdown's options from BLOCK_STYLES (index.html only holds an empty select).
function buildBlockStyleSelect() {
  const sel = document.getElementById('blockStyle');
  if (!sel) return;
  sel.textContent = '';
  allBlockStyleOptions.length = 0;
  for (const def of BLOCK_STYLES) {
    const opt = document.createElement('option');
    opt.value = def.value;
    allBlockStyleOptions.push(opt);
    sel.appendChild(opt);
  }
  refreshBlockStyleLabels('full');
}
buildBlockStyleSelect();

// ---- The style menu: the Insert menu's look, an icon per style (F9 item C1, Paul 9 Oct 2026: "give the style menu icons, so the
// two menus are one style") ----
// The toolbar's style control used to be a native <select>, whose dropdown the browser draws (no icons possible). It is now a button
// (#btnStyleMenu) that opens a listbox (#styleDropdown) styled as the Insert menu (.insert-dropdown / .insert-item / .insert-icon),
// each row carrying the same icon the slash menu gives that style (BLOCK_STYLES[].icon). The <select id="blockStyle"> STAYS in the
// page, out of sight and hidden from screen readers (aria-hidden, tabindex -1), as the model: every other part of the editor (and the
// test suites) reads and sets its value and listens to its `change` event, and picking a row does exactly that. Keyboard: Up/Down
// (or Alt+Up/Down) on the button open the list on the current style; Up/Down, Home/End and typing a letter move; Enter or Space pick;
// Esc closes and puts the keyboard back on the button; Tab closes. aria-haspopup=listbox / aria-expanded on the button, role=listbox
// / option / aria-selected in the list, and the button's name says which style is current.
function styleMenuBtn() { return document.getElementById('btnStyleMenu'); }   // function declarations: buildBlockStyleSelect() above runs first
function styleMenuList() { return document.getElementById('styleDropdown'); }
// A row's label without the leading glyph the toolbar label carries ("¶ Body Text", "1. Numbered List", "H1 Heading"): the icon is
// shown on its own beside it. The row keeps the full label as its accessible name, so "H1 Heading" is still spoken.
function styleRowLabel(full, icon) {
  const ic = String(icon || '');
  if (!ic || ic.startsWith('i:') || !full.startsWith(ic)) return full;
  const rest = full.slice(ic.length).replace(/^\s+/, '');
  return rest || full;
}
function styleIconNode(def) {
  const ico = document.createElement('span');
  ico.className = 'insert-icon style-icon';
  ico.setAttribute('aria-hidden', 'true');
  const ic = String(def.icon || '');
  if (ic.startsWith('i:')) ico.append(iconEl(ic.slice(2)));
  else { ico.textContent = ic; if (ic.length > 2) ico.classList.add('style-icon-wide'); if (/^H\d$/.test(ic)) ico.classList.add('style-icon-h'); }
  return ico;
}
function updateStyleMenuUI() {
  const btn = styleMenuBtn(); const sel = document.getElementById('blockStyle');
  if (!btn || !sel) return;
  const opt = sel.selectedOptions[0];
  const shown = opt ? opt.textContent : '';
  const lbl = document.getElementById('styleBtnLabel'); if (lbl) lbl.textContent = shown;
  // The current style's Iconoir icon beside its name (feedback 17 Oct, item 3: the "¶" in "¶ Body Text" was a symbol used as an icon). A style whose
  // icon is lettering (H1, 1.) keeps its name alone, as before.
  const def = BLOCK_STYLES.find((d) => d.value === sel.value);
  const ico = document.getElementById('styleBtnIcon');
  if (ico) { ico.replaceChildren(); const n = def && String(def.icon || ''); if (n && n.startsWith('i:')) ico.append(iconEl(n.slice(2))); ico.hidden = !ico.firstChild; }
  const name = `${tOr('app.editor.style_label', 'Paragraph style')}: ${(opt && opt.dataset.full) || shown}`;
  btn.setAttribute('aria-label', name);
  btn.title = name;
  const list = styleMenuList();
  if (list && !list.hidden) for (const row of list.querySelectorAll('[role=option]')) row.setAttribute('aria-selected', String(row.dataset.value === sel.value));
}
function buildStyleMenuRows() {
  const list = styleMenuList(); const sel = document.getElementById('blockStyle');
  if (!list || !sel) return;
  list.setAttribute('aria-label', tOr('app.editor.style_label', 'Paragraph style'));
  list.textContent = '';
  for (const opt of sel.options) {
    const def = BLOCK_STYLES.find((d) => d.value === opt.value);
    if (!def) continue;
    const full = opt.dataset.full || def.full();
    const row = document.createElement('div');
    row.className = 'insert-item style-item';
    row.setAttribute('role', 'option');
    row.tabIndex = -1;
    row.dataset.value = opt.value;
    row.setAttribute('aria-selected', String(opt.value === sel.value));
    row.setAttribute('aria-label', full);
    const lbl = document.createElement('span');
    lbl.className = 'insert-lbl';
    lbl.textContent = styleRowLabel(full, def.icon);
    const tick = document.createElement('span');
    tick.className = 'style-tick';
    tick.setAttribute('aria-hidden', 'true');
    tick.append(iconEl('check', 'icon icon-inline'));   // Iconoir, not a ✓ character (feedback 17 Oct 2026, item 3)
    row.append(styleIconNode(def), lbl, tick);
    list.appendChild(row);
  }
}
function closeStyleMenu(returnFocus = false) {
  const list = styleMenuList(); const btn = styleMenuBtn();
  if (!list || list.hidden) return;
  list.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
  if (returnFocus) btn?.focus({ preventScroll: true });
}
function openStyleMenu() {
  const list = styleMenuList(); const btn = styleMenuBtn(); const wrap = document.getElementById('styleMenuWrap');
  if (!list || !btn) return;
  closeAllDropdownMenus();                                   // one menu open at a time (feedback 30 Sep item 16)
  buildStyleMenuRows();
  list.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  if (wrap) {                                                // right of the button if it fits, else pinned inside the window's edge (as Insert)
    const rect = wrap.getBoundingClientRect(); const dropWidth = list.offsetWidth || 200;
    let left = 0;
    if (rect.left + dropWidth > window.innerWidth - 8) left = rect.right - dropWidth >= 8 ? rect.width - dropWidth : 8 - rect.left;
    list.style.left = `${left}px`; list.style.right = 'auto';
  }
  const cur = list.querySelector('[aria-selected="true"]') || list.querySelector('[role=option]');
  cur?.focus({ preventScroll: false });
  cur?.scrollIntoView?.({ block: 'nearest' });
}
function chooseStyle(value) {
  const sel = document.getElementById('blockStyle');
  closeStyleMenu(false);
  if (!sel || !value) return;
  if (sel.value !== value) { sel.value = value; sel.dispatchEvent(new Event('change', { bubbles: true })); }   // applyBlockStyle listens to this
  else editor.focus();
}
{
  let typed = ''; let typedAt = 0;
  const rows = () => [...(styleMenuList()?.querySelectorAll('[role=option]') || [])];
  const move = (to) => { const r = rows(); if (!r.length) return; const i = Math.max(0, Math.min(r.length - 1, to)); r[i].focus(); r[i].scrollIntoView?.({ block: 'nearest' }); };
  styleMenuBtn()?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (styleMenuList()?.hidden === false) closeStyleMenu(true); else openStyleMenu();
  });
  styleMenuBtn()?.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); openStyleMenu(); }
  });
  styleMenuList()?.addEventListener('click', (e) => {
    e.stopPropagation();
    const row = e.target.closest?.('[role=option]');
    if (row) chooseStyle(row.dataset.value);
  });
  styleMenuList()?.addEventListener('keydown', (e) => {
    const r = rows(); const i = r.indexOf(document.activeElement);
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(i < 0 ? 0 : i + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(i < 0 ? r.length - 1 : i - 1); }
    else if (k === 'Home') { e.preventDefault(); e.stopPropagation(); move(0); }
    else if (k === 'End') { e.preventDefault(); e.stopPropagation(); move(r.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); if (i >= 0) chooseStyle(r[i].dataset.value); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeStyleMenu(true); }
    else if (k === 'Tab') { closeStyleMenu(false); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {                      // type-ahead, as the native list had
      const now = Date.now(); typed = now - typedAt > 700 ? k.toLowerCase() : typed + k.toLowerCase(); typedAt = now;
      const labels = r.map((row) => (row.querySelector('.insert-lbl')?.textContent || '').toLowerCase());
      const from = typed.length === 1 ? i + 1 : i;                                          // a repeated letter steps on; a longer prefix stays
      let hit = -1;
      for (let n = 0; n < labels.length; n++) { const j = (from + n) % labels.length; if (labels[j].startsWith(typed)) { hit = j; break; } }
      if (hit >= 0) { e.preventDefault(); e.stopPropagation(); move(hit); }
    }
  });
  // Focus leaving the list (a click elsewhere) closes it, unless it went to the button itself.
  styleMenuList()?.addEventListener('focusout', (e) => {
    const next = e.relatedTarget;
    if (next && (styleMenuList().contains(next) || next === styleMenuBtn())) return;
    if (next === null) return;                                // clicks on non-focusable page areas are closed by the document click handler
    closeStyleMenu(false);
  });
}
updateStyleMenuUI();
const brailleEl = $id('braille');
const editorEl = $id('editor');
let currentStatusText = '';
function updateDocStatsVisibility() {
  const ds = $id('docStats');
  if (!ds) return;
  if (!currentStatusText) {
    ds.textContent = '';
    ds.style.display = 'none';
    return;
  }
  ds.textContent = currentStatusText;
  ds.style.display = 'inline-block';
}
const setStatus = (m) => {
  currentStatusText = m || '';
  const el = $id('status');
  if (el) el.textContent = currentStatusText;
  updateDocStatsVisibility();
};

function getPrintPageForBlock(blockIdx) {
  if (lastModel?.blocks && typeof blockIdx === 'number' && blockIdx >= 0) {
    for (let i = Math.min(blockIdx, lastModel.blocks.length - 1); i >= 0; i--) {
      const b = lastModel.blocks[i];
      if (b && b.type === 'pagenum' && b.page != null) {
        return String(b.page).trim();
      }
    }
  }
  const blockEl = editorEl?.querySelector(`[data-block-idx="${blockIdx}"]`);
  if (blockEl) {
    let curr = blockEl;
    while (curr) {
      if (curr.classList?.contains('doc-print-page') || curr.querySelector?.('.doc-print-page')) {
        const pageEl = curr.classList?.contains('doc-print-page') ? curr : curr.querySelector('.doc-print-page');
        const pInput = pageEl?.querySelector('input.print-page-input');
        if (pInput && pInput.value) return pInput.value.trim();
        if (pageEl?.dataset?.page) return pageEl.dataset.page.trim();
      }
      curr = curr.previousElementSibling;
    }
  }
  return null;
}

function updateCaretLocation(blockIdx = null, rowIdx = null, colIdx = null) {
  const bIdx = typeof blockIdx === 'number' && blockIdx >= 0 ? blockIdx : (lastKnownEditorBlockIndex ?? 0);
  const printPage = getPrintPageForBlock(bIdx);
  
  const lpp = Number(settings.lines) || Number(settings.linesPerPage) || 25;
  let rIdx = typeof rowIdx === 'number' && rowIdx >= 0 ? rowIdx : (activeCaretLine >= 0 ? activeCaretLine : -1);
  if (rIdx < 0 && lastTrace?.rows && typeof bIdx === 'number') {
    rIdx = lastTrace.rows.indexOf(bIdx);
  }
  
  // Braille page and line come from the formatted pages themselves (running heads, page
  // number lines, contents pages and suppressed blank lines make row ÷ lines-per-page drift).
  let bPage = 1, bLine = 1;
  const starts = lastPageLineStarts;
  if (rIdx >= 0 && Array.isArray(starts) && starts.length) {
    let p = 0;
    while (p + 1 < starts.length && starts[p + 1] <= rIdx) p++;
    bPage = p + 1;
    bLine = rIdx - starts[p] + 1;
  } else if (rIdx >= 0) {
    bPage = Math.floor(rIdx / lpp) + 1;
    bLine = (rIdx % lpp) + 1;
  }
  const bCell = typeof colIdx === 'number' && colIdx >= 0 ? colIdx + 1 : (activeCaretCol >= 0 ? activeCaretCol + 1 : 1);
  
  const locStr = printPage
    ? `(P:${printPage} · B${bPage}: L${bLine}, C${bCell})`
    : `(B${bPage}: L${bLine}, C${bCell})`;
    
  setStatus(locStr);
}
// Live-region announcer. The region is cleared, then set ~30 ms later so that repeating
// the same text is still spoken. Rapid calls (slash-menu filtering announces on every
// keystroke) coalesce: while one message is pending, a newer one *replaces* it — latest
// wins — so the final message is always the one announced, never an arbitrary earlier one.
const announce = (() => {
  let pending = null;      // message waiting for the clear→set gap
  let timerId = 0;
  return (msg) => {
    const a = $id('announce'); if (!a) return;
    pending = msg;
    if (timerId) return;                     // a flush is already scheduled; it will pick up `pending`
    a.textContent = '';
    timerId = setTimeout(() => {
      timerId = 0;
      const m = pending; pending = null;
      if (m != null) a.textContent = m;
    }, 30);
  };
})();
const TF = louis.TYPEFORM;   // single source of truth (italic=1, underline=2, bold=4)

// BANA / UKAAF style metadata prototype extensions on core Lexical nodes
ParagraphNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ParagraphNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
// A paragraph the source split around a print page turn: 'continued' = the page turn follows
// it, 'continuation' = it resumes after one (formatted from cell 1, BANA §1.11.3 / B004 §8).
// The NIMAS exporter rejoins the pieces into one <p> with the <pagenum> inline.
ParagraphNode.prototype.getPageTurn = function() { return this.getLatest().__pageTurn || null; };
ParagraphNode.prototype.setPageTurn = function(v) { this.getWritable().__pageTurn = v || null; return this; };
// F-39 — BANA Formats §1.9.3: a per-paragraph "blocked" (1-1 margins) flag, alongside the
// paragraph's own banaStyle (a plain body paragraph can be blocked; a quote/attribution/etc.
// paragraph ignores this flag entirely — see document.mjs formatPara's own comment). Toggled
// by the "Blocked Paragraph" toolbar button (btnBlockedPara), not the blockStyle dropdown.
ParagraphNode.prototype.getBlocked = function() { return !!this.getLatest().__blocked; };
ParagraphNode.prototype.setBlocked = function(v) { this.getWritable().__blocked = !!v; return this; };
// A footnote paragraph keeps its note id (the target of note references, A5) and kind.
ParagraphNode.prototype.getNote = function() { return this.getLatest().__note || null; };
ParagraphNode.prototype.setNote = function(v) { this.getWritable().__note = v && v.id ? { id: String(v.id), kind: v.kind || null } : null; return this; };
// A22 / A19-A21 Stage 9: an *imported* <prodnote render="required"> (A19/A21 Stage 7) keeps
// that value through the editor too — null means "not set", so the exporter's own D6 default
// ("optional") applies, exactly as for a transcriber's note block Emboss itself creates.
ParagraphNode.prototype.getRender = function() { return this.getLatest().__render || null; };
ParagraphNode.prototype.setRender = function(v) { this.getWritable().__render = v || null; return this; };
// F-5: a transcriber's note that belongs to a table (parse.mjs's parseTable pushes it as a
// standalone {type:'note', kind:'tabletn'} block right before the table). Both are the same
// "note" style in the editor, so without this flag the kind is lost on save and
// nimas-export.mjs's tableIndexForCaption can no longer see past the note to pair the table's
// caption with the table (the caption then saves as an orphan <imggroup><caption>) and the
// note loses class="tabletn". Only meaningful while the style is 'note'.
ParagraphNode.prototype.getTabletn = function() { return !!this.getLatest().__tabletn; };
ParagraphNode.prototype.setTabletn = function(v) { this.getWritable().__tabletn = !!v; return this; };
// A19/A21 Stage 2/9: a verse line's own <poem> provenance (parse.mjs's parsePoem/fromPoem) —
// only a line tagged fromPoem sweeps back into <poem>/<linegroup>/<line> on save; an untagged
// verse-styled paragraph (BrailleBlaster's own bai-verse, verse drama, D5) is unaffected and
// keeps saving as <p class="bai-verse">.
ParagraphNode.prototype.getFromPoem = function() { return !!this.getLatest().__fromPoem; };
ParagraphNode.prototype.setFromPoem = function(v) { this.getWritable().__fromPoem = !!v; return this; };
// #49 (D14): which poem a line, stanza break, page turn, title or author belongs to (poemId, parse.mjs's parsePoem) and what a
// poem's own title / author / byline is (poemRole 'title' | 'author' | 'byline'), so a poem saved from the editor keeps its title and
// author inside its <poem> and two adjacent titled poems stay two, as when saved straight from the reader (nimas-export.mjs
// renderPoemRun). Carried on ParagraphNode, HeadingNode, BreakNode and PrintPageNode, the same way as bareLinegroupId.
ParagraphNode.prototype.getPoemId = function() { const n = this.getLatest().__poemId; return n != null ? n : null; };
ParagraphNode.prototype.setPoemId = function(v) { this.getWritable().__poemId = v != null ? v : null; return this; };
ParagraphNode.prototype.getPoemRole = function() { return this.getLatest().__poemRole || null; };
ParagraphNode.prototype.setPoemRole = function(v) { this.getWritable().__poemRole = v || null; return this; };
// A verse line of a play (D5: <p class="bai-verse">, block.playVerse): the formatter gives it BANA 14.6.1a's verse-play margins (runover
// in cell 5), not poetry's (cell 3). Dropped by the editor before 1 Oct 2026, so the editor brailled verse drama as poetry.
ParagraphNode.prototype.getPlayVerse = function() { return !!this.getLatest().__playVerse; };
ParagraphNode.prototype.setPlayVerse = function(v) { this.getWritable().__playVerse = !!v; return this; };
// A19/A21 Stage 5/9: a generic <div class="…"> parse.mjs could not attribute to a single block
// on its own — see parse.mjs's walk(), the "unknown container" branch's `tag === 'div' && cls`
// case. divId (a source-side sequence number, not shown or saved on its own) distinguishes two
// separate, adjacent, identically-classed <div>s from one <div>'s own contiguous content — see
// nimas-export.mjs's isDivClassBlock/renderDivRun.
ParagraphNode.prototype.getDivClass = function() { return this.getLatest().__divClass || null; };
ParagraphNode.prototype.setDivClass = function(v) { this.getWritable().__divClass = v || null; return this; };
ParagraphNode.prototype.getDivId = function() { const n = this.getLatest().__divId; return n != null ? n : null; };
ParagraphNode.prototype.setDivId = function(v) { this.getWritable().__divId = v != null ? v : null; return this; };
// A42: a verse line read from a bare <linegroup>/<stanza> (no <poem> wrapper in the source —
// see parse.mjs's parsePoem call sites and block.bareLinegroup) must save back without a
// newly-invented <poem> — see nimas-export.mjs's renderPoemRun's wrapInPoem flag. Same shape
// as divClass/divId: bareLinegroupId distinguishes two separate, adjacent bare linegroups
// (no stanza-break between them) from one linegroup's own contiguous content.
ParagraphNode.prototype.getBareLinegroup = function() { return !!this.getLatest().__bareLinegroup; };
ParagraphNode.prototype.setBareLinegroup = function(v) { this.getWritable().__bareLinegroup = !!v; return this; };
ParagraphNode.prototype.getBareLinegroupId = function() { const n = this.getLatest().__bareLinegroupId; return n != null ? n : null; };
ParagraphNode.prototype.setBareLinegroupId = function(v) { this.getWritable().__bareLinegroupId = v != null ? v : null; return this; };
// A35/A19-A21 Stage 9 shape: a verse line parsed from a genuine source <line> element (not
// D5's bare verse drama, <p class="bai-verse"> with no source <line> — see parse.mjs's
// fromLineTag note) must round-trip as <line>, not collapse to <p class="bai-verse">.
// blockquoteId (mirrors divClass/divId exactly) marks a run of blocks that came from one source
// <blockquote> that needed the run mechanism at all — either because its direct children mixed
// a <line> with other block content (A35, a quoted letter's salutation/signature lines alongside
// its body <p> — those blocks are additionally tagged fromBlockquoteLines) or simply because it
// had more than one block child (A40, e.g. a plain multi-paragraph quoted letter). The id (not
// either flag alone) distinguishes two separate, adjacent such blockquotes from one blockquote's
// own contiguous content; blockquoteClass (A40) is the source's own <blockquote class="…">, kept
// alongside — see nimas-export.mjs's isBlockquoteRunBlock/renderBlockquoteRun.
ParagraphNode.prototype.getFromLineTag = function() { return !!this.getLatest().__fromLineTag; };
ParagraphNode.prototype.setFromLineTag = function(v) { this.getWritable().__fromLineTag = !!v; return this; };
ParagraphNode.prototype.getFromBlockquoteLines = function() { return !!this.getLatest().__fromBlockquoteLines; };
ParagraphNode.prototype.setFromBlockquoteLines = function(v) { this.getWritable().__fromBlockquoteLines = !!v; return this; };
ParagraphNode.prototype.getBlockquoteId = function() { const n = this.getLatest().__blockquoteId; return n != null ? n : null; };
ParagraphNode.prototype.setBlockquoteId = function(v) { this.getWritable().__blockquoteId = v != null ? v : null; return this; };
// F-164 / BANA 3.2.1b: consecutive note paragraphs sharing a noteGroup are ONE transcriber's
// note (a <prodnote> with several <p>): one @.< ... @.> pair around the whole run, one
// <prodnote> on save (nimas-export.mjs's mergeNoteGroups). Same run idea as blockquoteId.
ParagraphNode.prototype.getNoteGroup = function() { const n = this.getLatest().__noteGroup; return n != null ? n : null; };
ParagraphNode.prototype.setNoteGroup = function(v) { this.getWritable().__noteGroup = v != null ? v : null; return this; };
ParagraphNode.prototype.getBlockquoteClass = function() { return this.getLatest().__blockquoteClass || null; };
ParagraphNode.prototype.setBlockquoteClass = function(v) { this.getWritable().__blockquoteClass = v || null; return this; };
const origParaClone = ParagraphNode.prototype.afterCloneFrom;
ParagraphNode.prototype.afterCloneFrom = function(prev) {
  if (origParaClone) origParaClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__pageTurn = prev.__pageTurn || null;
  this.__note = prev.__note || null;
  this.__blocked = !!prev.__blocked;
  this.__render = prev.__render || null;
  this.__tabletn = !!prev.__tabletn;
  this.__fromPoem = !!prev.__fromPoem;
  this.__poemId = prev.__poemId != null ? prev.__poemId : null;
  this.__poemRole = prev.__poemRole || null;
  this.__playVerse = !!prev.__playVerse;
  this.__divClass = prev.__divClass || null;
  this.__divId = prev.__divId != null ? prev.__divId : null;
  this.__bareLinegroup = !!prev.__bareLinegroup;
  this.__bareLinegroupId = prev.__bareLinegroupId != null ? prev.__bareLinegroupId : null;
  this.__fromLineTag = !!prev.__fromLineTag;
  this.__fromBlockquoteLines = !!prev.__fromBlockquoteLines;
  this.__blockquoteId = prev.__blockquoteId != null ? prev.__blockquoteId : null;
  this.__blockquoteClass = prev.__blockquoteClass || null;
  this.__noteGroup = prev.__noteGroup != null ? prev.__noteGroup : null;
};
// #57c: Enter in a footnote paragraph that has a note id (at its end, or in the middle: Lexical then moves the rest into the new
// paragraph) makes a further paragraph of the SAME note, as Word does -- a footnote paragraph with the same id and kind -- rather than
// a body paragraph. buildModel marks it noteCont (markNoteParts), so it braille as the note's next paragraph and saves as its next
// <p>. The style menu still turns it into a body paragraph (a footnote with no id is not joined to the one above, so it stays apart).
const origParaInsertNewAfterNote = ParagraphNode.prototype.insertNewAfter;   // the "Computer code" Enter rule (#40) wraps this one in turn
ParagraphNode.prototype.insertNewAfter = function(...args) {
  const next = origParaInsertNewAfterNote.apply(this, args);
  const note = this.getNote();
  if (note && this.getBanaStyle() === 'footnote' && next && typeof next.setNote === 'function') next.setBanaStyle('footnote').setNote({ id: note.id, kind: note.kind });
  return next;
};
const origParaCreateDOM = ParagraphNode.prototype.createDOM;
ParagraphNode.prototype.createDOM = function(config) {
  const dom = origParaCreateDOM ? origParaCreateDOM.call(this, config) : document.createElement('p');
  const style = this.getBanaStyle();
  if (style && style !== 'body') {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  const turn = this.getPageTurn();
  if (turn === 'continuation' || turn === 'both') dom.classList.add('bana-continuation');
  if (this.getBlocked()) dom.classList.add('bana-blocked');
  return dom;
};
const origParaUpdateDOM = ParagraphNode.prototype.updateDOM;
ParagraphNode.prototype.updateDOM = function(prevNode, dom, config) {
  let updated = origParaUpdateDOM ? origParaUpdateDOM.call(this, prevNode, dom, config) : false;
  const prevStyle = prevNode ? prevNode.getBanaStyle() : null;
  const nextStyle = this.getBanaStyle();
  if (prevStyle !== nextStyle) {
    if (prevStyle && prevStyle !== 'body') dom.classList.remove(`bana-style-${prevStyle}`);
    if (nextStyle && nextStyle !== 'body') {
      dom.classList.add(`bana-style-${nextStyle}`);
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
    updated = true;
  }
  const prevTurn = prevNode ? prevNode.getPageTurn() : null;
  const nextTurn = this.getPageTurn();
  if (prevTurn !== nextTurn) {
    dom.classList.toggle('bana-continuation', nextTurn === 'continuation' || nextTurn === 'both');
    updated = true;
  }
  const prevBlocked = prevNode ? prevNode.getBlocked() : false;
  const nextBlocked = this.getBlocked();
  if (prevBlocked !== nextBlocked) {
    dom.classList.toggle('bana-blocked', nextBlocked);
    updated = true;
  }
  return updated;
};
const origParaExportJSON = ParagraphNode.prototype.exportJSON;
ParagraphNode.prototype.exportJSON = function() {
  const json = origParaExportJSON ? origParaExportJSON.call(this) : {
    children: [],
    direction: this.getDirection(),
    format: this.getFormatType(),
    indent: this.getIndent(),
    type: 'paragraph',
    version: 1,
    textFormat: this.getTextFormat(),
    textStyle: this.getTextStyle(),
  };
  const style = this.getBanaStyle();
  if (style) json.banaStyle = style;
  const turn = this.getPageTurn();
  if (turn) json.pageTurn = turn;
  const note = this.getNote();
  if (note) json.note = note;
  if (this.getBlocked()) json.blocked = true;
  const render = this.getRender();
  if (render) json.render = render;
  if (this.getTabletn()) json.tabletn = true;
  if (this.getFromPoem()) json.fromPoem = true;
  if (this.getPoemId() != null) json.poemId = this.getPoemId();
  if (this.getPoemRole()) json.poemRole = this.getPoemRole();
  if (this.getPlayVerse()) json.playVerse = true;
  const divClass = this.getDivClass();
  if (divClass) { json.divClass = divClass; const divId = this.getDivId(); if (divId != null) json.divId = divId; }
  if (this.getBareLinegroup()) { json.bareLinegroup = true; const blgId = this.getBareLinegroupId(); if (blgId != null) json.bareLinegroupId = blgId; }
  if (this.getFromLineTag()) json.fromLineTag = true;
  if (this.getNoteGroup() != null) json.noteGroup = this.getNoteGroup();
  // A40: gate on blockquoteId (any run at all), not fromBlockquoteLines (only the A35 subset
  // that also had a <line>) — see the field comment above ParagraphNode's own getters.
  const bqId = this.getBlockquoteId();
  if (bqId != null) {
    json.blockquoteId = bqId;
    if (this.getFromBlockquoteLines()) json.fromBlockquoteLines = true;
    const bqClass = this.getBlockquoteClass();
    if (bqClass) json.blockquoteClass = bqClass;
  }
  return json;
};
const origParaUpdateFromJSON = ParagraphNode.prototype.updateFromJSON;
ParagraphNode.prototype.updateFromJSON = function(serializedNode) {
  const node = origParaUpdateFromJSON ? origParaUpdateFromJSON.call(this, serializedNode) : this;
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.pageTurn) node.setPageTurn(serializedNode.pageTurn);
  if (serializedNode?.note) node.setNote(serializedNode.note);
  if (serializedNode?.blocked) node.setBlocked(true);
  if (serializedNode?.render) node.setRender(serializedNode.render);
  if (serializedNode?.tabletn) node.setTabletn(true);
  if (serializedNode?.fromPoem) node.setFromPoem(true);
  if (serializedNode?.poemId != null) node.setPoemId(serializedNode.poemId);
  if (serializedNode?.poemRole) node.setPoemRole(serializedNode.poemRole);
  if (serializedNode?.playVerse) node.setPlayVerse(true);
  if (serializedNode?.divClass) { node.setDivClass(serializedNode.divClass); node.setDivId(serializedNode.divId); }
  if (serializedNode?.bareLinegroup) { node.setBareLinegroup(true); node.setBareLinegroupId(serializedNode.bareLinegroupId); }
  if (serializedNode?.fromLineTag) node.setFromLineTag(true);
  if (serializedNode?.noteGroup != null) node.setNoteGroup(serializedNode.noteGroup);
  if (serializedNode?.blockquoteId != null) {
    node.setBlockquoteId(serializedNode.blockquoteId);
    if (serializedNode.fromBlockquoteLines) node.setFromBlockquoteLines(true);
    if (serializedNode.blockquoteClass) node.setBlockquoteClass(serializedNode.blockquoteClass);
  }
  return node;
};
// A node class's own static importJSON, or null. Lexical nodes declared with $config()
// inherit LexicalNode.importJSON, which always throws — calling that from a wrapper made
// every undo/redo drop the document from the first list onwards (G7).
const ownImportJSON = (Klass) => (Object.prototype.hasOwnProperty.call(Klass, 'importJSON') ? Klass.importJSON : null);
const origParaImportJSON = ownImportJSON(ParagraphNode);
ParagraphNode.importJSON = function(serializedNode) {
  const node = origParaImportJSON ? origParaImportJSON.call(this, serializedNode) : $createParagraphNode().updateFromJSON(serializedNode);
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.pageTurn) node.setPageTurn(serializedNode.pageTurn);
  if (serializedNode?.note) node.setNote(serializedNode.note);
  if (serializedNode?.blocked) node.setBlocked(true);
  if (serializedNode?.render) node.setRender(serializedNode.render);
  if (serializedNode?.tabletn) node.setTabletn(true);
  if (serializedNode?.fromPoem) node.setFromPoem(true);
  if (serializedNode?.poemId != null) node.setPoemId(serializedNode.poemId);
  if (serializedNode?.poemRole) node.setPoemRole(serializedNode.poemRole);
  if (serializedNode?.playVerse) node.setPlayVerse(true);
  if (serializedNode?.divClass) { node.setDivClass(serializedNode.divClass); node.setDivId(serializedNode.divId); }
  if (serializedNode?.bareLinegroup) { node.setBareLinegroup(true); node.setBareLinegroupId(serializedNode.bareLinegroupId); }
  if (serializedNode?.fromLineTag) node.setFromLineTag(true);
  if (serializedNode?.noteGroup != null) node.setNoteGroup(serializedNode.noteGroup);
  if (serializedNode?.blockquoteId != null) {
    node.setBlockquoteId(serializedNode.blockquoteId);
    if (serializedNode.fromBlockquoteLines) node.setFromBlockquoteLines(true);
    if (serializedNode.blockquoteClass) node.setBlockquoteClass(serializedNode.blockquoteClass);
  }
  return node;
};

ListNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ListNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
ListNode.prototype.getListKind = function() { return this.getLatest().__listKind || null; };
ListNode.prototype.setListKind = function(k) { this.getWritable().__listKind = k || null; return this; };
const origListClone = ListNode.prototype.afterCloneFrom;
ListNode.prototype.afterCloneFrom = function(prev) {
  if (origListClone) origListClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__listKind = prev.__listKind || null;
};
const origListCreateDOM = ListNode.prototype.createDOM;
ListNode.prototype.createDOM = function(config) {
  const dom = origListCreateDOM ? origListCreateDOM.call(this, config) : document.createElement(this.getListType() === 'number' ? 'ol' : 'ul');
  const style = this.getListKind() || this.getBanaStyle();
  if (style) {
    dom.classList.add(`bana-style-${style}`);
    if (style === 'plain' || style === 'toc' || style === 'glossary') dom.classList.add('emboss-plain-list');
    dom.dataset.banaStyle = style;
  }
  return dom;
};
const origListUpdateDOM = ListNode.prototype.updateDOM;
ListNode.prototype.updateDOM = function(prevNode, dom, config) {
  let updated = origListUpdateDOM ? origListUpdateDOM.call(this, prevNode, dom, config) : false;
  const prevStyle = prevNode ? (prevNode.getListKind() || prevNode.getBanaStyle()) : null;
  const nextStyle = this.getListKind() || this.getBanaStyle();
  if (prevStyle !== nextStyle) {
    if (prevStyle) {
      dom.classList.remove(`bana-style-${prevStyle}`);
      dom.classList.remove('emboss-plain-list');
    }
    if (nextStyle) {
      dom.classList.add(`bana-style-${nextStyle}`);
      if (nextStyle === 'plain' || nextStyle === 'toc' || nextStyle === 'glossary') dom.classList.add('emboss-plain-list');
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
    updated = true;
  }
  return updated;
};
const origListExportJSON = ListNode.prototype.exportJSON;
ListNode.prototype.exportJSON = function() {
  const json = origListExportJSON ? origListExportJSON.call(this) : {
    children: [],
    direction: this.getDirection(),
    format: this.getFormatType(),
    indent: this.getIndent(),
    type: 'list',
    version: 1,
    listType: this.getListType(),
    start: this.getStart(),
    tag: this.getTag(),
  };
  const style = this.getBanaStyle();
  if (style) json.banaStyle = style;
  const kind = this.getListKind();
  if (kind) json.listKind = kind;
  return json;
};
const origListUpdateFromJSON = ListNode.prototype.updateFromJSON;
ListNode.prototype.updateFromJSON = function(serializedNode) {
  const node = origListUpdateFromJSON ? origListUpdateFromJSON.call(this, serializedNode) : this;
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.listKind) node.setListKind(serializedNode.listKind);
  return node;
};
const origListImportJSON = ownImportJSON(ListNode);
ListNode.importJSON = function(serializedNode) {
  const node = origListImportJSON ? origListImportJSON.call(this, serializedNode) : $createListNode(serializedNode?.listType, serializedNode?.start).updateFromJSON(serializedNode);
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.listKind) node.setListKind(serializedNode.listKind);
  return node;
};

ListItemNode.prototype.getPage = function() { return this.getLatest().__page || null; };
ListItemNode.prototype.setPage = function(p) { this.getWritable().__page = p || null; return this; };
// A36: a TOC/index page number that was itself a link (parse.mjs's pageColumnHref) — kept
// alongside the plain page number, same shape as getPage/setPage, so a save can put the href
// back around the visible number (see nimas-export.mjs's toc/index list-item cases).
ListItemNode.prototype.getPageHref = function() { return this.getLatest().__pageHref || null; };
ListItemNode.prototype.setPageHref = function(h) { this.getWritable().__pageHref = h || null; return this; };
// The print marker a loaded item had ("3.", "b)") — kept so braille and the save follow print
// (A26); items typed in the editor have none and are numbered by position.
const NO_MARKER = '\u0000';                    // a loaded item that had no print marker
ListItemNode.prototype.getMarker = function() { return this.getLatest().__marker || null; };
// A literal bullet the print text starts with ("• ") is hidden in the editor (the list shows
// its own) but kept here and put back on save, so the text is not changed (A26).
ListItemNode.prototype.getBulletPrefix = function() { return this.getLatest().__bulletPrefix || null; };
ListItemNode.prototype.setBulletPrefix = function(p) { this.getWritable().__bulletPrefix = p ? (typeof p === 'string' ? { text: p, tf: 0 } : p) : null; return this; };
ListItemNode.prototype.setMarker = function(m) { this.getWritable().__marker = m || null; return this; };
ListItemNode.prototype.getLevel = function() {
  const latest = this.getLatest();
  if (latest.__level != null) return latest.__level;
  if (latest.__indent != null) return latest.__indent;
  return 0;
};
ListItemNode.prototype.setLevel = function(lvl) {
  const n = (lvl | 0) || 0;
  const w = this.getWritable();
  w.__level = n;
  w.__indent = n;
  return this;
};
ListItemNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
ListItemNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
const origItemClone = ListItemNode.prototype.afterCloneFrom;
ListItemNode.prototype.afterCloneFrom = function(prev) {
  if (origItemClone) origItemClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__page = prev.__page || null;
  this.__pageHref = prev.__pageHref || null;
  this.__marker = prev.__marker || null;
  this.__bulletPrefix = prev.__bulletPrefix || null;
  this.__level = prev.__level != null ? prev.__level : (prev.__indent != null ? prev.__indent : null);
};
const origItemCreateDOM = ListItemNode.prototype.createDOM;
ListItemNode.prototype.createDOM = function(config) {
  const dom = origItemCreateDOM ? origItemCreateDOM.call(this, config) : document.createElement('li');
  const style = this.getBanaStyle();
  if (style) {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  const page = this.getPage();
  if (page) dom.dataset.page = String(page);
  const pageHref = this.getPageHref();
  if (pageHref) dom.dataset.pageHref = String(pageHref);
  const lvl = this.getLevel();
  if (lvl) dom.dataset.level = String(lvl);
  return dom;
};
const origItemUpdateDOM = ListItemNode.prototype.updateDOM;
ListItemNode.prototype.updateDOM = function(prevNode, dom, config) {
  let updated = origItemUpdateDOM ? origItemUpdateDOM.call(this, prevNode, dom, config) : false;
  const prevStyle = prevNode ? prevNode.getBanaStyle() : null;
  const nextStyle = this.getBanaStyle();
  if (prevStyle !== nextStyle) {
    if (prevStyle) dom.classList.remove(`bana-style-${prevStyle}`);
    if (nextStyle) {
      dom.classList.add(`bana-style-${nextStyle}`);
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
    updated = true;
  }
  const prevPage = prevNode ? prevNode.getPage() : null;
  const nextPage = this.getPage();
  if (prevPage !== nextPage) {
    if (nextPage) dom.dataset.page = String(nextPage);
    else delete dom.dataset.page;
    updated = true;
  }
  const prevPageHref = prevNode ? prevNode.getPageHref() : null;
  const nextPageHref = this.getPageHref();
  if (prevPageHref !== nextPageHref) {
    if (nextPageHref) dom.dataset.pageHref = String(nextPageHref);
    else delete dom.dataset.pageHref;
    updated = true;
  }
  // prevNode.getLatest() is the new node, so compare with what the DOM shows (Tab / Shift+Tab changed only the level).
  const nextLvl = this.getLevel();
  if ((Number(dom.dataset.level) || 0) !== nextLvl) {
    if (nextLvl) dom.dataset.level = String(nextLvl);
    else delete dom.dataset.level;
  }
  return updated;
};
const origItemExportJSON = ListItemNode.prototype.exportJSON;
ListItemNode.prototype.exportJSON = function() {
  const json = origItemExportJSON ? origItemExportJSON.call(this) : {
    children: [],
    direction: this.getDirection(),
    format: this.getFormatType(),
    indent: this.getIndent(),
    type: 'listitem',
    version: 1,
    checked: this.getChecked(),
    value: this.getValue(),
  };
  const style = this.getBanaStyle();
  if (style) json.banaStyle = style;
  const page = this.getPage();
  if (page != null) json.page = page;
  const pageHref = this.getPageHref();
  if (pageHref != null) json.pageHref = pageHref;
  const marker = this.getMarker();
  if (marker) json.marker = marker;
  const bullet = this.getBulletPrefix();
  if (bullet) json.bulletPrefix = bullet;
  const level = this.getLevel();
  if (level != null && level !== 0) json.level = level;
  return json;
};
const origItemUpdateFromJSON = ListItemNode.prototype.updateFromJSON;
ListItemNode.prototype.updateFromJSON = function(serializedNode) {
  const node = origItemUpdateFromJSON ? origItemUpdateFromJSON.call(this, serializedNode) : this;
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.page != null) node.setPage(serializedNode.page);
  if (serializedNode?.pageHref != null) node.setPageHref(serializedNode.pageHref);
  if (serializedNode?.marker) node.setMarker(serializedNode.marker);
  if (serializedNode?.bulletPrefix) node.setBulletPrefix(serializedNode.bulletPrefix);
  if (serializedNode?.level != null) node.setLevel(serializedNode.level);
  return node;
};
const origItemImportJSON = ownImportJSON(ListItemNode);
ListItemNode.importJSON = function(serializedNode) {
  const node = origItemImportJSON ? origItemImportJSON.call(this, serializedNode) : $createListItemNode(serializedNode?.checked).updateFromJSON(serializedNode);
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.page != null) node.setPage(serializedNode.page);
  if (serializedNode?.pageHref != null) node.setPageHref(serializedNode.pageHref);
  if (serializedNode?.marker) node.setMarker(serializedNode.marker);
  if (serializedNode?.bulletPrefix) node.setBulletPrefix(serializedNode.bulletPrefix);
  if (serializedNode?.level != null) node.setLevel(serializedNode.level);
  return node;
};

HeadingNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
HeadingNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
// #49: a poem's own title (poemRole 'title', poemId), as on ParagraphNode
HeadingNode.prototype.getPoemId = function() { const n = this.getLatest().__poemId; return n != null ? n : null; };
HeadingNode.prototype.setPoemId = function(v) { this.getWritable().__poemId = v != null ? v : null; return this; };
HeadingNode.prototype.getPoemRole = function() { return this.getLatest().__poemRole || null; };
HeadingNode.prototype.setPoemRole = function(v) { this.getWritable().__poemRole = v || null; return this; };
// Import fix list #57b (Paul, 1 Oct 2026: "the editor should keep the title as its own type"): the document title (a Word/ODT/RTF Title
// with its Subtitle, Markdown's first heading) is a `title` block to the readers — formatTitle centres each line of it — so a heading
// that came from one carries this flag (always an h1). A new heading made by the style menu is a fresh node and so is not a title.
HeadingNode.prototype.getIsTitle = function() { return !!this.getLatest().__isTitle; };
HeadingNode.prototype.setIsTitle = function(v) { this.getWritable().__isTitle = !!v; return this; };
const origHeadingClone = HeadingNode.prototype.afterCloneFrom;
HeadingNode.prototype.afterCloneFrom = function(prev) {
  if (origHeadingClone) origHeadingClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__poemId = prev.__poemId != null ? prev.__poemId : null;
  this.__poemRole = prev.__poemRole || null;
  this.__isTitle = !!prev.__isTitle;
};
const origHeadingCreateDOM = HeadingNode.prototype.createDOM;
HeadingNode.prototype.createDOM = function(config) {
  const dom = origHeadingCreateDOM ? origHeadingCreateDOM.call(this, config) : document.createElement(this.getTag());
  const style = this.getBanaStyle();
  if (style && style !== 'body') {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  return dom;
};
const origHeadingUpdateDOM = HeadingNode.prototype.updateDOM;
HeadingNode.prototype.updateDOM = function(prevNode, dom, config) {
  let updated = origHeadingUpdateDOM ? origHeadingUpdateDOM.call(this, prevNode, dom, config) : false;
  const prevStyle = prevNode ? prevNode.getBanaStyle() : null;
  const nextStyle = this.getBanaStyle();
  if (prevStyle !== nextStyle) {
    if (prevStyle && prevStyle !== 'body') dom.classList.remove(`bana-style-${prevStyle}`);
    if (nextStyle && nextStyle !== 'body') {
      dom.classList.add(`bana-style-${nextStyle}`);
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
    updated = true;
  }
  return updated;
};
const origHeadingExportJSON = HeadingNode.prototype.exportJSON;
HeadingNode.prototype.exportJSON = function() {
  const json = origHeadingExportJSON ? origHeadingExportJSON.call(this) : {
    children: [],
    direction: this.getDirection(),
    format: this.getFormatType(),
    indent: this.getIndent(),
    type: 'heading',
    version: 1,
    tag: this.getTag(),
  };
  const style = this.getBanaStyle();
  if (style) json.banaStyle = style;
  if (this.getPoemId() != null) json.poemId = this.getPoemId();
  if (this.getPoemRole()) json.poemRole = this.getPoemRole();
  if (this.getIsTitle()) json.isTitle = true;
  return json;
};
const origHeadingUpdateFromJSON = HeadingNode.prototype.updateFromJSON;
HeadingNode.prototype.updateFromJSON = function(serializedNode) {
  const node = origHeadingUpdateFromJSON ? origHeadingUpdateFromJSON.call(this, serializedNode) : this;
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.poemId != null) node.setPoemId(serializedNode.poemId);
  if (serializedNode?.poemRole) node.setPoemRole(serializedNode.poemRole);
  if (serializedNode?.isTitle) node.setIsTitle(true);
  return node;
};
const origHeadingImportJSON = ownImportJSON(HeadingNode);
HeadingNode.importJSON = function(serializedNode) {
  const node = origHeadingImportJSON ? origHeadingImportJSON.call(this, serializedNode) : $createHeadingNode(serializedNode?.tag || 'h1').updateFromJSON(serializedNode);
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.poemId != null) node.setPoemId(serializedNode.poemId);
  if (serializedNode?.poemRole) node.setPoemRole(serializedNode.poemRole);
  if (serializedNode?.isTitle) node.setIsTitle(true);
  return node;
};

// Optional BANA formatter fields (see nimas-export.mjs's BANA_FLAG_FIELDS for the DTBook forms) live on
// the node as ONE plain object, `fmt` — only set (truthy) keys are stored, so a node without any is
// exactly as before. It follows the same paths as every other node field: clone, the DOM (data-bana-fmt,
// so a change re-renders), exportJSON/importJSON (undo history, editor-state snapshots) and the
// model <-> node conversion (fmtToBlock / fmtFromBlock below).
const cleanFmt = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== false && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
  return Object.keys(out).length ? out : null;
};
function installFmt(Klass) {
  const P = Klass.prototype;
  P.getFmt = function() { return this.getLatest().__fmt || null; };
  P.setFmt = function(o) { this.getWritable().__fmt = cleanFmt(o); return this; };
  const oc = P.afterCloneFrom;
  P.afterCloneFrom = function(prev) { if (oc) oc.call(this, prev); this.__fmt = prev.__fmt ? { ...prev.__fmt } : null; };
  const od = P.createDOM;
  P.createDOM = function(config) {
    const dom = od.call(this, config);
    const f = this.getFmt();
    if (f) dom.dataset.banaFmt = Object.keys(f).join(' ');
    return dom;
  };
  const ou = P.updateDOM;
  P.updateDOM = function(prevNode, dom, config) {
    let updated = ou.call(this, prevNode, dom, config);
    const a = prevNode ? prevNode.getFmt() : null, b = this.getFmt();
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      if (b) dom.dataset.banaFmt = Object.keys(b).join(' '); else delete dom.dataset.banaFmt;
      updated = true;
    }
    return updated;
  };
  const oe = P.exportJSON;
  P.exportJSON = function() { const json = oe.call(this); const f = this.getFmt(); if (f) json.fmt = { ...f }; return json; };
  const ouf = P.updateFromJSON;
  P.updateFromJSON = function(serializedNode) { const node = ouf.call(this, serializedNode); if (serializedNode?.fmt) node.setFmt(serializedNode.fmt); return node; };
  const oi = Klass.importJSON;
  Klass.importJSON = function(serializedNode) { const node = oi.call(this, serializedNode); if (serializedNode?.fmt) node.setFmt(serializedNode.fmt); return node; };
}
[ParagraphNode, HeadingNode, ListNode, ListItemNode].forEach(installFmt);
// Which optional formatter fields each kind of node keeps in its fmt: DERIVED from format/field-registry.mjs (each
// field's `carry` list), so the editor, the save format and the dialog cannot drift apart. Buckets: a heading, a list,
// a list item, any paragraph (body / verse / speaker / note / footnote / code), the note-level fields repeated on every
// paragraph of a note group, a print page change, a table, and the page-break-only nodes (box, picture, tactile graphic).
const FMT_HEADING_KEYS = fmtKeysFor('heading');
const FMT_CODE_KEYS = fmtKeysFor('code');             // dotLocator / keepSpaces / spaceLetters: the paragraph is a code block
const FMT_LIST_KEYS = fmtKeysFor('list');
const FMT_ITEM_KEYS = fmtKeysFor('item');
const FMT_PARA_KEYS = fmtKeysFor('para');
const FMT_NOTE_KEYS = fmtKeysFor('note');
const FMT_PAGENUM_KEYS = fmtKeysFor('pagenum');
const FMT_TABLE_KEYS = fmtKeysFor('table');
const FMT_PBB_KEYS = fmtKeysFor('pbb');   // a box, a picture or a tactile graphic
// A field whose explicit "off" (false) matters (repeatHeadings, continuedNote: an opt-out of a default) is kept as a marker,
// because fmt drops false values; it is turned back into false on the way to the model (registry `offMarker`).
const FMT_OFF_KEYS = fmtOffKeys();
const FMT_OFF = REGISTRY_FMT_OFF;
const fmtOf = (node) => (node && typeof node.getFmt === 'function' ? node.getFmt() : null);

// ---- G8 stage 3: print markers of a (flat, level-tagged) list, per LEVEL and per sibling group ----
// A sibling group = the run of items at one level between two items of a shallower level. Its first item carries the
// group's `enum` (1/a/A/i/I) and `start` in fmt (same place parse/export put them). One pure function is used by the
// print view (data-marker), by save (nodeToBlocks) and by the chooser, so they cannot disagree.
const LIST_DEFAULT_GLYPHS = ['•', '◦', '▪'];
const LIST_ENUMS = ['1', 'a', 'A', 'i', 'I'];
const BULLET_NAME_GLYPH = { dot: '•', 'hollow square': '□', 'solid square': '■', 'hollow circle': '○', triangle: '▲', checkmark: '√' };
const defaultEnumForLevel = (lvl) => (lvl === 1 ? 'a' : lvl === 2 ? 'i' : lvl === 3 ? 'A' : '1');
// Group index of every item: gi[i] = index of the first item of i's group; pos[i] = 0-based place in the group.
// An `empty` item takes a place without using one (save drops empty items, so numbering must not count them).
function listGroups(items) {
  const n = items.length, gi = new Array(n), pos = new Array(n), first = [], cnt = [];
  for (let i = 0; i < n; i++) {
    const L = Math.max(0, Math.min(9, items[i].level | 0));
    if (first[L] == null) { first[L] = i; cnt[L] = 0; }
    gi[i] = first[L];
    pos[i] = cnt[L];
    if (!items[i].empty) cnt[L]++;
    for (let l = L + 1; l < 10; l++) first[l] = null;
  }
  return { gi, pos };
}
// items: [{ level, kept (li.getMarker(): null | NO_MARKER | text), fmt, empty }]; listType 'number' | 'bullet'.
// Returns [{ kind: 'none'|'ordered'|'bullet', text (what the print view shows), marker (what save stores for a typed item) }].
function planListMarkers(items, listType, symbols) {
  const { gi, pos } = listGroups(items);
  const seq = Array.isArray(symbols) && symbols.length ? symbols : LIST_DEFAULT_GLYPHS;
  const levelGlyph = (lvl) => seq[Math.min(lvl, seq.length - 1)];
  const groupKind = new Map();
  items.forEach((it, i) => { if (it.kept && it.kept !== NO_MARKER && !groupKind.has(gi[i])) groupKind.set(gi[i], isBulletMarker(it.kept) ? 'bullet' : 'ordered'); });
  return items.map((it, i) => {
    const lvl = Math.max(0, Math.min(9, it.level | 0));
    const f = it.fmt || {};
    const g = groupKind.get(gi[i]) || (listType === 'bullet' ? 'bullet' : 'ordered');
    let kind = g;
    if (it.kept === NO_MARKER) kind = 'none';
    else if (it.kept) kind = isBulletMarker(it.kept) ? 'bullet' : 'ordered';
    if (kind === 'none') return { kind, text: '', marker: null };
    const explicit = (f.bullet && BULLET_NAME_GLYPH[bulletName(f.bullet)]) || (f.bulletMarker && f.bulletMarker !== '•' ? f.bulletMarker : null) || (it.kept && it.kept !== '•' && isBulletMarker(it.kept) ? it.kept : null);
    const glyph = explicit || levelGlyph(lvl);
    if (kind === 'bullet') return { kind, text: glyph, marker: explicit ? null : '•' };
    let text = it.kept;
    if (!text) {
      const gf = items[gi[i]].fmt || {};
      const en = LIST_ENUMS.includes(gf.enum) ? gf.enum : defaultEnumForLevel(lvl);
      const st = Math.max(1, Math.floor(Number(gf.start)) || 1);
      const n = st + pos[i];
      text = (!LIST_ENUMS.includes(gf.enum) && lvl >= 4) ? `(${n})` : synthesizeOrderedMarker(n, en);
    }
    return { kind, text: f.bullet && BULLET_NAME_GLYPH[bulletName(f.bullet)] ? `${glyph} ${text}` : text, marker: it.kept ? null : text };
  });
}
// Lexical list -> planListMarkers input (runs in an editor read/update).
// A list item's further paragraph (model item.blocks, see document.mjs formatItemBlocks) is a list line of its own in the
// editor, flagged fmt.itemCont: it shows no marker and takes no place in the numbering (planned as an empty, unmarked item).
const isItemContLi = (li) => !!(fmtOf(li) || {}).itemCont;
const listItemsForPlan = (list, emptyOf) => list.getChildren().filter($isListItemNode).map((li) => ({
  node: li, level: li.getLevel() || 0, kept: isItemContLi(li) ? NO_MARKER : li.getMarker(), fmt: fmtOf(li),
  empty: isItemContLi(li) || (emptyOf ? emptyOf(li) : li.getTextContent().trim() === '' && !li.getChildren().some((c) => typeof c.getType === 'function' && !['text', 'linebreak'].includes(c.getType()))),
}));
// Print view: put each list item's marker on its <li> as data-marker (CSS draws it). Only DOM attributes; the model is untouched.
function refreshListMarkers(editorState, dirtyElements, tags) {
  try {
    editorState.read(() => {
      const lists = new Map();
      const add = (n) => { if ($isListNode(n)) lists.set(n.getKey(), n); };
      if (!dirtyElements || (tags && tags.has('historic'))) { for (const n of editorState._nodeMap.values()) add(n); }
      else for (const k of dirtyElements.keys()) { const n = $getNodeByKey(k); if ($isListItemNode(n)) add(n.getParent()); else add(n); }
      for (const list of lists.values()) {
        const type = typeof list.getListType === 'function' ? list.getListType() : null;
        const kind = (typeof list.getListKind === 'function' ? list.getListKind() : null) || (typeof list.getBanaStyle === 'function' ? list.getBanaStyle() : null);
        const eligible = (type === 'number' || type === 'bullet') && !['toc', 'index', 'plain', 'glossary'].includes(kind);
        const items = listItemsForPlan(list);
        const plan = eligible ? planListMarkers(items, type, (fmtOf(list) || {}).symbols) : null;
        items.forEach((it, i) => {
          const el = editor.getElementByKey(it.node.getKey());
          if (!el) return;
          const txt = plan && !it.node.getChildren().some($isListNode) ? plan[i].text : '';
          if (txt) { if (el.dataset.marker !== txt) el.dataset.marker = txt; }
          // An item planned with no marker (its printed label, e.g. "1.1", is part of its text): an EMPTY data-marker, so
          // the CSS still hides the browser's own a./i. marker (30 Sep: "a. 1.1 alphalegal11" in an ODT legal list).
          else if (plan && plan[i].kind === 'none') { if (el.dataset.marker !== '') el.dataset.marker = ''; }
          else if (el.dataset.marker != null) delete el.dataset.marker;
        });
      }
    });
  } catch (err) { console.warn('refreshListMarkers', err); }
}
function fmtToBlock(block, node, keys) {
  const f = fmtOf(node);
  if (f) for (const k of keys) if (f[k] != null) block[k] = f[k] === FMT_OFF && FMT_OFF_KEYS.includes(k) ? false : f[k];
  return block;
}
function fmtFromBlock(node, b, keys) {
  const o = {};
  for (const k of keys) {
    if (b[k] === false && FMT_OFF_KEYS.includes(k)) o[k] = FMT_OFF;
    else if (b[k] != null && b[k] !== false && b[k] !== '') o[k] = b[k];
  }
  if (Object.keys(o).length) node.setFmt({ ...(fmtOf(node) || {}), ...o });
  return node;
}

QuoteNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
QuoteNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
const origQuoteClone = QuoteNode.prototype.afterCloneFrom;
QuoteNode.prototype.afterCloneFrom = function(prev) {
  if (origQuoteClone) origQuoteClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
};
const origQuoteCreateDOM = QuoteNode.prototype.createDOM;
QuoteNode.prototype.createDOM = function(config) {
  const dom = origQuoteCreateDOM ? origQuoteCreateDOM.call(this, config) : document.createElement('blockquote');
  const style = this.getBanaStyle();
  if (style && style !== 'body') {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  return dom;
};
const origQuoteUpdateDOM = QuoteNode.prototype.updateDOM;
QuoteNode.prototype.updateDOM = function(prevNode, dom, config) {
  let updated = origQuoteUpdateDOM ? origQuoteUpdateDOM.call(this, prevNode, dom, config) : false;
  const prevStyle = prevNode ? prevNode.getBanaStyle() : null;
  const nextStyle = this.getBanaStyle();
  if (prevStyle !== nextStyle) {
    if (prevStyle && prevStyle !== 'body') dom.classList.remove(`bana-style-${prevStyle}`);
    if (nextStyle && nextStyle !== 'body') {
      dom.classList.add(`bana-style-${nextStyle}`);
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
    updated = true;
  }
  return updated;
};
const origQuoteExportJSON = QuoteNode.prototype.exportJSON;
QuoteNode.prototype.exportJSON = function() {
  const json = origQuoteExportJSON ? origQuoteExportJSON.call(this) : {
    children: [],
    direction: this.getDirection(),
    format: this.getFormatType(),
    indent: this.getIndent(),
    type: 'quote',
    version: 1,
  };
  const style = this.getBanaStyle();
  if (style) json.banaStyle = style;
  return json;
};
const origQuoteUpdateFromJSON = QuoteNode.prototype.updateFromJSON;
QuoteNode.prototype.updateFromJSON = function(serializedNode) {
  const node = origQuoteUpdateFromJSON ? origQuoteUpdateFromJSON.call(this, serializedNode) : this;
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  return node;
};

const $createBanaParagraphNode = (style) => {
  const p = $createParagraphNode();
  if (style) p.setBanaStyle(style);
  return p;
};

// Enter in a "Computer code" paragraph (#40) is a new LINE of the same block, as Shift+Enter: a listing is one block (one grade-1
// passage in the braille, one <p class="bana-code"> in the save), not a paragraph per line, which would braille as many
// passages. Pasted lines (Lexical's paste calls insertParagraph for each newline) stay in the block the same way. Enter on an
// empty last line (a second Enter at the end) leaves the block: the empty line goes and an ordinary paragraph follows; Enter in
// an empty code paragraph turns it into an ordinary one. (Lexical's insertParagraph asks the paragraph for the node to continue
// in; answering null after the line break is inserted leaves it nothing else to do.)
const origParaInsertNewAfter = ParagraphNode.prototype.insertNewAfter;
ParagraphNode.prototype.insertNewAfter = function(selection, restoreSelection) {
  if (this.getBanaStyle() !== 'code' || !$isRangeSelection(selection)) return origParaInsertNewAfter.call(this, selection, restoreSelection);
  const last = this.getLastChild();
  const a = selection.anchor, at = a.getNode();
  const atEnd = selection.isCollapsed() && (at.is(this) ? a.offset >= this.getChildrenSize() : ($isTextNode(at) && this.isParentOf(at) && a.offset >= at.getTextContentSize() && !at.getNextSibling()));
  if (!last) {                                              // an empty code paragraph: Enter makes it an ordinary one
    const plain = $createParagraphNode();
    this.replace(plain);
    return plain;
  }
  if (atEnd && $isLineBreakNode(last)) {                    // on the empty last line: leave the block
    last.remove();
    const plain = $createParagraphNode();
    this.insertAfter(plain, restoreSelection);
    return plain;
  }
  selection.insertLineBreak();
  return null;
};

// ---- custom nodes ----
// An equation. The editor edits LaTeX (MathLive), but an equation loaded from a document
// also keeps its original MathML: until the user changes it, that MathML is what is saved
// and brailled. Converting MathML → LaTeX → MathML on every save lost equations the
// converters could not round-trip (41 of 852 in a real textbook; matrices came back with
// "?" and invalid <munder>). `__srcLatex` is the LaTeX the node was created with, so
// "unchanged" is exact; any real edit makes getSourceMathml() return null.
// A note reference (DTBook <noteref>/<annoref>, A5): an atomic superscript mark that keeps
// its target note id, so braille superscripts it (BANA Formats §16.2.2) and the save
// writes <noteref idref="#…"> again.
class NoteRefNode extends TextNode {
  static getType() { return 'emboss-noteref'; }
  static clone(n) { return new NoteRefNode(n.__text, n.__idref, n.__annoref, n.__key); }
  constructor(text = '', idref = null, annoref = false, key) {
    super(text, key);
    this.__idref = idref || null;
    this.__annoref = !!annoref;
  }
  getIdref() { return this.getLatest().__idref; }
  isAnnoref() { return this.getLatest().__annoref; }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('ed-noteref');
    dom.style.verticalAlign = 'super';
    dom.style.fontSize = '0.75em';
    if (this.__idref) dom.dataset.noteref = this.__idref;
    return dom;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-noteref', version: 1, idref: this.__idref, annoref: this.__annoref }; }
  static importJSON(j) { return new NoteRefNode(j.text || '', j.idref || null, !!j.annoref).updateFromJSON(j).setMode('token'); }
}
const $createNoteRefNode = (text, idref = null, annoref = false) => new NoteRefNode(text, idref, annoref).setMode('token');
const $isNoteRefNode = (n) => n instanceof NoteRefNode;
// An embedded picture transcriber's note inside exercise material (BANA Formats §10.11.1,
// F-229): an atomic run carrying the source <img>'s own alt text; braille wraps it in TN
// indicators (@.< … @.>) right where the picture sat, and the save writes <img src="…"
// alt="…"/> again (the src is kept only for that round trip, never shown or brailled).
class ImgNoteNode extends TextNode {
  static getType() { return 'emboss-imgnote'; }
  static clone(n) { const c = new ImgNoteNode(n.__text, n.__src, n.__key); c.__extra = n.__extra ? { ...n.__extra } : null; return c; }
  constructor(text = '', src = null, key) {
    super(text, key);
    this.__src = src || null;
    this.__extra = null;     // { uncontracted, prodnote, render } of the source note (17.11.2b, F-S4-02), kept for the save
  }
  getSrc() { return this.getLatest().__src; }
  getExtra() { return this.getLatest().__extra || null; }
  setExtra(o) {
    const e = {};
    if (o && o.uncontracted) e.uncontracted = true;
    if (o && o.spanTypeform) e.spanTypeform = true;   // 18.3.3c
    if (o && o.prodnote) { e.prodnote = true; if (o.render) e.render = o.render; }
    this.getWritable().__extra = Object.keys(e).length ? e : null;
    return this;
  }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('ed-imgnote');
    return dom;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-imgnote', version: 1, src: this.__src, ...(this.__extra ? { extra: { ...this.__extra } } : {}) }; }
  static importJSON(j) { return new ImgNoteNode(j.text || '', j.src || null).updateFromJSON(j).setMode('token').setExtra(j.extra); }
}
const $createImgNoteNode = (text, src = null, extra = null) => new ImgNoteNode(text, src).setMode('token').setExtra(extra);
const $isImgNoteNode = (n) => n instanceof ImgNoteNode;
// Literal braille cells inside prose ({type:'brl'}: grouping indicators, transcriber-defined symbols, dot locators):
// an atomic run carrying the cells (title on the save's <span class="bana-brl">) and its print text (may be empty:
// a zero-width space keeps the run alive in the editor and is dropped again on save). Same token shape as ImgNoteNode.
const BRL_EMPTY = '\u200B';
class BrlNode extends TextNode {
  static getType() { return 'emboss-brl'; }
  static clone(n) { return new BrlNode(n.__text, n.__brl, n.__key); }
  constructor(text = '', brl = '', key) {
    super(text || BRL_EMPTY, key);
    this.__brl = brl || '';
  }
  getBrl() { return this.getLatest().__brl; }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('ed-brl');
    dom.title = this.__brl;
    return dom;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-brl', version: 1, brl: this.__brl }; }
  static importJSON(j) { return new BrlNode(j.text || '', j.brl || '').updateFromJSON(j).setMode('token'); }
}
const $createBrlNode = (text, brl) => new BrlNode(text, brl).setMode('token');
const $isBrlNode = (n) => n instanceof BrlNode;
// A print line number in prose (A30): an atomic mark, shown small in the margin colour;
// braille puts it at the right margin (BANA Formats §15.3) and the save writes
// <span class="linenum"> again.
class LineNumberNode extends TextNode {
  static getType() { return 'emboss-linenum'; }
  static clone(n) { return new LineNumberNode(n.__text, n.__key); }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('ed-linenum');
    dom.style.fontSize = '0.75em';
    dom.style.opacity = '0.7';
    dom.title = t('app.editor.print_line_number');
    return dom;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-linenum', version: 1 }; }
  static importJSON(j) { return new LineNumberNode(j.text || '').updateFromJSON(j).setMode('token'); }
}
const $createLineNumberNode = (text) => new LineNumberNode(text).setMode('token');
const $isLineNumberNode = (n) => n instanceof LineNumberNode;
// A hyperlink (DTBook <a href>, A19/A21 Stage 3): an atomic run carrying its target href,
// so a save round trip keeps the link instead of silently unwrapping it to plain text.
// Braille still renders the link text as ordinary text — BANA has no convention for print
// hyperlinks, so the href is carried for the save only, same as ImgNoteNode's @src.
// Same token-node shape as NoteRefNode/ImgNoteNode above (see those for why): the run is
// one atomic unit rather than per-character editable text.
class LinkNode extends TextNode {
  static getType() { return 'emboss-link'; }
  static clone(n) { return new LinkNode(n.__text, n.__href, n.__key); }
  constructor(text = '', href = null, key) {
    super(text, key);
    this.__href = href || null;
  }
  getHref() { return this.getLatest().__href; }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('ed-link');
    if (this.__href) dom.title = this.__href;
    return dom;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-link', version: 1, href: this.__href }; }
  static importJSON(j) { return new LinkNode(j.text || '', j.href || null).updateFromJSON(j).setMode('token'); }
}
const $createLinkNode = (text, href = null) => new LinkNode(text, href).setMode('token');
const $isLinkNode = (n) => n instanceof LinkNode;
// An inline citation (DTBook <cite>, A19/A21 Stage 4): same shape as LinkNode — an atomic
// run marked so the save writes <cite> around it again. Braille renders it as ordinary text.
class CiteNode extends TextNode {
  static getType() { return 'emboss-cite'; }
  static clone(n) { return new CiteNode(n.__text, n.__key); }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('ed-cite');
    return dom;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-cite', version: 1 }; }
  static importJSON(j) { return new CiteNode(j.text || '').updateFromJSON(j).setMode('token'); }
}
const $createCiteNode = (text) => new CiteNode(text).setMode('token');
const $isCiteNode = (n) => n instanceof CiteNode;

class MathNode extends DecoratorNode {
  static getType() { return 'emboss-math'; }
  static clone(n) { return new MathNode(n.__latex, n.__key, n.__mathml, n.__srcLatex); }
  constructor(latex = '', key, mathml = null, srcLatex = null) {
    super(key);
    this.__latex = latex;
    this.__mathml = mathml || null;
    this.__srcLatex = mathml ? (srcLatex ?? latex) : null;
  }
  createDOM() {
    const s = document.createElement('span');
    s.className = 'math-embed';
    if (this.__latex) s.setAttribute('data-latex', this.__latex);
    return s;
  }
  updateDOM() { return false; }
  setLatex(l) { if (l !== this.getLatest().__latex) this.getWritable().__latex = l; }
  getLatex() { return this.getLatest().__latex; }
  // The original MathML while the equation is unedited, else null.
  getSourceMathml() {
    const n = this.getLatest();
    return n.__mathml && n.__latex === n.__srcLatex ? n.__mathml : null;
  }
  decorate() { return this.getLatest().__latex; }
  isInline() { return true; }
  isKeyboardSelectable() { return true; }
  exportJSON() {
    const j = { type: 'emboss-math', version: 1, latex: this.__latex };
    if (this.__mathml) { j.mathml = this.__mathml; j.srcLatex = this.__srcLatex; }
    return j;
  }
  static importJSON(j) { return new MathNode(j.latex, undefined, j.mathml || null, j.srcLatex ?? null); }
}
// Placeholder shown in the maths field when MathML cannot be converted to LaTeX for
// editing; the original MathML is still what gets saved and brailled.
const UNEDITABLE_MATH_LATEX = '\\text{[equation]}';
const $createMathNode = (latex, mathml = null) => new MathNode(latex || (mathml ? UNEDITABLE_MATH_LATEX : ''), undefined, mathml);
const $isMathNode = (n) => n instanceof MathNode;

class BreakNode extends DecoratorNode {
  __kind = 'asterisks';
  static getType() { return 'emboss-break'; }
  static clone(n) {
    const c = new BreakNode(n.__kind || 'asterisks', n.__key);
    c.__fromPoem = !!n.__fromPoem;
    c.__poemId = n.__poemId != null ? n.__poemId : null;   // #49
    c.__divClass = n.__divClass || null;
    c.__divId = n.__divId != null ? n.__divId : null;
    c.__bareLinegroup = !!n.__bareLinegroup;
    c.__bareLinegroupId = n.__bareLinegroupId != null ? n.__bareLinegroupId : null;
    c.__fromBlockquoteLines = !!n.__fromBlockquoteLines;
    c.__blockquoteId = n.__blockquoteId != null ? n.__blockquoteId : null;
    c.__blockquoteClass = n.__blockquoteClass || null;
    return c;
  }
  constructor(kind = 'asterisks', key) {
    super(key);
    this.__kind = kind || 'asterisks';
    // A19/A21 Stage 2/9: a stanza-break indicator inside a poem (parse.mjs's parsePoem tags
    // it fromPoem, same as its verse lines) and/or a generic <div class="…"> wrapper
    // (Stage 5/9) — same shape as ParagraphNode's own fields, see there for why.
    this.__fromPoem = false;
    this.__poemId = null;       // #49
    this.__divClass = null;
    this.__divId = null;
    // A42: same shape as divClass/divId, for a stanza-break indicator that fell inside a bare
    // <linegroup>/<stanza> (no <poem> wrapper in the source).
    this.__bareLinegroup = false;
    this.__bareLinegroupId = null;
    // A35/A40: same shape as divClass/divId, for a break indicator that fell inside a
    // <blockquote> run (see ParagraphNode's own fromBlockquoteLines/blockquoteId/
    // blockquoteClass note).
    this.__fromBlockquoteLines = false;
    this.__blockquoteId = null;
    this.__blockquoteClass = null;
  }
  getKind() { return this.getLatest().__kind || 'asterisks'; }
  setKind(k) { this.getWritable().__kind = k || 'asterisks'; }
  getFromPoem() { return !!this.getLatest().__fromPoem; }
  setFromPoem(v) { this.getWritable().__fromPoem = !!v; return this; }
  getPoemId() { const n = this.getLatest().__poemId; return n != null ? n : null; }   // #49
  setPoemId(v) { this.getWritable().__poemId = v != null ? v : null; return this; }
  getDivClass() { return this.getLatest().__divClass || null; }
  setDivClass(v) { this.getWritable().__divClass = v || null; return this; }
  getDivId() { const n = this.getLatest().__divId; return n != null ? n : null; }
  setDivId(v) { this.getWritable().__divId = v != null ? v : null; return this; }
  getBareLinegroup() { return !!this.getLatest().__bareLinegroup; }
  setBareLinegroup(v) { this.getWritable().__bareLinegroup = !!v; return this; }
  getBareLinegroupId() { const n = this.getLatest().__bareLinegroupId; return n != null ? n : null; }
  setBareLinegroupId(v) { this.getWritable().__bareLinegroupId = v != null ? v : null; return this; }
  getFromBlockquoteLines() { return !!this.getLatest().__fromBlockquoteLines; }
  setFromBlockquoteLines(v) { this.getWritable().__fromBlockquoteLines = !!v; return this; }
  getBlockquoteId() { const n = this.getLatest().__blockquoteId; return n != null ? n : null; }
  setBlockquoteId(v) { this.getWritable().__blockquoteId = v != null ? v : null; return this; }
  getBlockquoteClass() { return this.getLatest().__blockquoteClass || null; }
  setBlockquoteClass(v) { this.getWritable().__blockquoteClass = v || null; return this; }
  createDOM() {
    const d = document.createElement('div');
    d.className = 'doc-break';
    d.textContent = this.__kind === 'line' ? '————————' : (this.__kind === 'asterism' ? '⁂ ⁂ ⁂' : '∗ ∗ ∗');
    return d;
  }
  updateDOM() { return false; }
  decorate() { return null; }              // static content — nothing to mount
  isInline() { return false; }
  exportJSON() {
    const j = { type: 'emboss-break', version: 1, kind: this.__kind };
    if (this.__fromPoem) j.fromPoem = true;
    if (this.__poemId != null) j.poemId = this.__poemId;   // #49
    if (this.__divClass) { j.divClass = this.__divClass; j.divId = this.__divId; }
    if (this.__bareLinegroup) { j.bareLinegroup = true; j.bareLinegroupId = this.__bareLinegroupId; }
    // A40: gate on blockquoteId (any run at all), not fromBlockquoteLines (only the A35 subset).
    if (this.__blockquoteId != null) {
      j.blockquoteId = this.__blockquoteId;
      if (this.__fromBlockquoteLines) j.fromBlockquoteLines = true;
      if (this.__blockquoteClass) j.blockquoteClass = this.__blockquoteClass;
    }
    return j;
  }
  static importJSON(j) {
    const n = new BreakNode(j?.kind || 'asterisks');
    if (j?.fromPoem) n.__fromPoem = true;
    if (j?.poemId != null) n.__poemId = j.poemId;   // #49
    if (j?.divClass) { n.__divClass = j.divClass; n.__divId = j.divId != null ? j.divId : null; }
    if (j?.bareLinegroup) { n.__bareLinegroup = true; n.__bareLinegroupId = j.bareLinegroupId != null ? j.bareLinegroupId : null; }
    if (j?.blockquoteId != null) {
      n.__blockquoteId = j.blockquoteId;
      if (j.fromBlockquoteLines) n.__fromBlockquoteLines = true;
      if (j.blockquoteClass) n.__blockquoteClass = j.blockquoteClass;
    }
    return n;
  }
}
const $createBreakNode = (kind = 'asterisks') => new BreakNode(kind);
const $isBreakNode = (n) => n instanceof BreakNode;

class PrintPageNode extends DecoratorNode {
  static getType() { return 'emboss-print-page'; }
  static clone(n) {
    const c = new PrintPageNode(n.__page, n.__key);
    c.__pnId = n.__pnId || null;
    c.__pageType = n.__pageType || null;
    c.__fromPoem = !!n.__fromPoem;
    c.__poemId = n.__poemId != null ? n.__poemId : null;   // #49
    c.__divClass = n.__divClass || null;
    c.__divId = n.__divId != null ? n.__divId : null;
    c.__bareLinegroup = !!n.__bareLinegroup;
    c.__bareLinegroupId = n.__bareLinegroupId != null ? n.__bareLinegroupId : null;
    c.__fromBlockquoteLines = !!n.__fromBlockquoteLines;
    c.__blockquoteId = n.__blockquoteId != null ? n.__blockquoteId : null;
    c.__blockquoteClass = n.__blockquoteClass || null;
    return c;
  }
  constructor(page = '1', key) {
    super(key);
    this.__page = String(page);
    this.__pnId = null;          // the source <pagenum> id and page type, kept for the save (A26)
    this.__pageType = null;
    // Same shape as BreakNode above (A19/A21 Stage 2/5/9): a print page turn that fell inside
    // a <poem>, or inside a generic classed <div> — parse.mjs tags either onto a pagenum block.
    this.__fromPoem = false;
    this.__poemId = null;       // #49
    this.__divClass = null;
    this.__divId = null;
    // A42: same shape as divClass/divId, for a print-page turn that fell inside a bare
    // <linegroup>/<stanza> (no <poem> wrapper in the source).
    this.__bareLinegroup = false;
    this.__bareLinegroupId = null;
    // A35/A40: same shape as divClass/divId, for a pagenum that fell inside a <blockquote>
    // run (see ParagraphNode's own fromBlockquoteLines/blockquoteId/blockquoteClass note).
    this.__fromBlockquoteLines = false;
    this.__blockquoteId = null;
    this.__blockquoteClass = null;
  }
  createDOM() {
    const d = document.createElement('div');
    d.className = 'doc-print-page emboss-printpage-widget';
    return d;
  }
  updateDOM() { return false; }
  setPage(p) { this.getWritable().__page = String(p); }
  getPage() { return this.getLatest().__page; }
  getFromPoem() { return !!this.getLatest().__fromPoem; }
  setFromPoem(v) { this.getWritable().__fromPoem = !!v; return this; }
  getPoemId() { const n = this.getLatest().__poemId; return n != null ? n : null; }   // #49
  setPoemId(v) { this.getWritable().__poemId = v != null ? v : null; return this; }
  getDivClass() { return this.getLatest().__divClass || null; }
  setDivClass(v) { this.getWritable().__divClass = v || null; return this; }
  getDivId() { const n = this.getLatest().__divId; return n != null ? n : null; }
  setDivId(v) { this.getWritable().__divId = v != null ? v : null; return this; }
  getBareLinegroup() { return !!this.getLatest().__bareLinegroup; }
  setBareLinegroup(v) { this.getWritable().__bareLinegroup = !!v; return this; }
  getBareLinegroupId() { const n = this.getLatest().__bareLinegroupId; return n != null ? n : null; }
  setBareLinegroupId(v) { this.getWritable().__bareLinegroupId = v != null ? v : null; return this; }
  getFromBlockquoteLines() { return !!this.getLatest().__fromBlockquoteLines; }
  setFromBlockquoteLines(v) { this.getWritable().__fromBlockquoteLines = !!v; return this; }
  getBlockquoteId() { const n = this.getLatest().__blockquoteId; return n != null ? n : null; }
  setBlockquoteId(v) { this.getWritable().__blockquoteId = v != null ? v : null; return this; }
  getBlockquoteClass() { return this.getLatest().__blockquoteClass || null; }
  setBlockquoteClass(v) { this.getWritable().__blockquoteClass = v || null; return this; }
  decorate() { return { type: 'print-page', page: this.getPage() }; }
  isInline() { return false; }
  getSource() { const n = this.getLatest(); return { id: n.__pnId, pageType: n.__pageType }; }
  exportJSON() {
    return {
      type: 'emboss-print-page', version: 1, page: this.__page,
      ...(this.__pnId ? { id: this.__pnId } : {}),
      ...(this.__pageType ? { pageType: this.__pageType } : {}),
      ...(this.__fromPoem ? { fromPoem: true } : {}),
      ...(this.__poemId != null ? { poemId: this.__poemId } : {}),   // #49
      ...(this.__divClass ? { divClass: this.__divClass, divId: this.__divId } : {}),
      ...(this.__bareLinegroup ? { bareLinegroup: true, bareLinegroupId: this.__bareLinegroupId } : {}),
      // A40: gate on blockquoteId (any run at all), not fromBlockquoteLines (only the A35 subset).
      ...(this.__blockquoteId != null ? {
        blockquoteId: this.__blockquoteId,
        ...(this.__fromBlockquoteLines ? { fromBlockquoteLines: true } : {}),
        ...(this.__blockquoteClass ? { blockquoteClass: this.__blockquoteClass } : {}),
      } : {}),
    };
  }
  static importJSON(j) {
    const n = new PrintPageNode(j.page);
    n.__pnId = j.id || null;
    n.__pageType = j.pageType || null;
    if (j.fromPoem) n.__fromPoem = true;
    if (j.poemId != null) n.__poemId = j.poemId;   // #49
    if (j.divClass) { n.__divClass = j.divClass; n.__divId = j.divId != null ? j.divId : null; }
    if (j.bareLinegroup) { n.__bareLinegroup = true; n.__bareLinegroupId = j.bareLinegroupId != null ? j.bareLinegroupId : null; }
    if (j.blockquoteId != null) {
      n.__blockquoteId = j.blockquoteId;
      if (j.fromBlockquoteLines) n.__fromBlockquoteLines = true;
      if (j.blockquoteClass) n.__blockquoteClass = j.blockquoteClass;
    }
    return n;
  }
}
const $createPrintPageNode = (page, src = null) => {
  const n = new PrintPageNode(page);
  if (src) {
    n.__pnId = src.id || null;
    n.__pageType = src.pageType || null;
    if (src.fromPoem) n.__fromPoem = true;
    if (src.poemId != null) n.__poemId = src.poemId;   // #49
    if (src.divClass) { n.__divClass = src.divClass; n.__divId = src.divId != null ? src.divId : null; }
    if (src.bareLinegroup) { n.__bareLinegroup = true; n.__bareLinegroupId = src.bareLinegroupId != null ? src.bareLinegroupId : null; }
    if (src.blockquoteId != null) {
      n.__blockquoteId = src.blockquoteId;
      if (src.fromBlockquoteLines) n.__fromBlockquoteLines = true;
      if (src.blockquoteClass) n.__blockquoteClass = src.blockquoteClass;
    }
  }
  return n;
};
const $isPrintPageNode = (n) => n instanceof PrintPageNode;

class GraphicNode extends DecoratorNode {
  __svg = '';
  __alt = '';
  __title = '';
  __textures = true;
  __brailleLabels = true;
  __size = 'half'; // 'compact' | 'half' | 'full'

  static getType() { return 'emboss-graphic'; }
  static clone(n) { return new GraphicNode(n.__svg, n.__alt, n.__title, n.__textures, n.__brailleLabels, n.__size, n.__key); }
  constructor(svg = '', alt = 'Tactile graphic', title = '', textures = true, brailleLabels = true, size = 'half', key) {
    super(key);
    this.__svg = svg;
    this.__alt = alt;
    this.__title = title;
    this.__textures = textures;
    this.__brailleLabels = brailleLabels;
    this.__size = size || 'half';
  }
  createDOM() {
    const d = document.createElement('div');
    d.className = 'doc-graphic-block size-' + this.__size;
    d.setAttribute('role', 'figure');
    d.setAttribute('aria-label', this.__alt || t('app.editor.tactile_diagram_aria'));
    return d;
  }
  // Returning true makes Lexical recreate the element when the node changes, so the
  // decorator listener (which skips elements that already hold a widget) rebuilds the
  // preview. With false, "+ Label" changed the model but the drawing never redrew.
  updateDOM() { return true; }
  decorate() {
    return {
      svg: this.__svg,
      alt: this.__alt,
      title: this.__title,
      textures: this.__textures,
      brailleLabels: this.__brailleLabels,
      size: this.__size,
    };
  }
  isInline() { return false; }
  getSvg() { return this.__svg; }
  getAlt() { return this.__alt; }
  getTitle() { return this.__title; }
  getTextures() { return this.__textures; }
  getBrailleLabels() { return this.__brailleLabels; }
  getSize() { return this.__size || 'half'; }
  setSvg(s) { this.getWritable().__svg = s; }
  setTextures(t) { this.getWritable().__textures = Boolean(t); }
  setBrailleLabels(b) { this.getWritable().__brailleLabels = Boolean(b); }
  setSize(s) { this.getWritable().__size = s; }
  exportJSON() {
    return {
      type: 'emboss-graphic',
      version: 1,
      svg: this.__svg,
      alt: this.__alt,
      title: this.__title,
      textures: this.__textures,
      brailleLabels: this.__brailleLabels,
      size: this.__size,
    };
  }
  static importJSON(j) {
    return new GraphicNode(j.svg, j.alt, j.title, j.textures, j.brailleLabels, j.size || 'half');
  }
}
const $createGraphicNode = (svg, alt, title, textures, brailleLabels, size) => new GraphicNode(svg, alt, title, textures, brailleLabels, size);
const $isGraphicNode = (n) => n instanceof GraphicNode;

// A print image (A26): keeps its source, alt text, print caption (with inline segments such
// as note references) and description, so the save writes <img>/<imggroup> back and braille
// follows BANA Formats §6. Shown as a card; the image itself only when its source can load.
class ImageNode extends DecoratorNode {
  static getType() { return 'emboss-image'; }
  static clone(n) { return new ImageNode({ ...n.__image }, n.__key); }
  constructor(image = {}, key) {
    super(key);
    this.__image = {
      src: String(image.src || ''), alt: String(image.alt || ''),
      caption: image.caption ? String(image.caption) : '',
      captionSegments: Array.isArray(image.captionSegments) ? image.captionSegments : null,
      description: image.description ? String(image.description) : '',
      // A22 / A19-A21 Stage 9: an imported <prodnote render="required"> used as this image's
      // description (parse.mjs's parseImgGroup) keeps that value — null/absent means the
      // exporter's own D6 default ("optional") applies, same as ParagraphNode's getRender above.
      descriptionRender: image.descriptionRender === 'required' ? 'required' : null,
      // A34: several source <prodnote>s in one <imggroup> (parse.mjs's parseImgGroup) are kept
      // separately here too — null/absent (no source array at all, e.g. an Emboss-created
      // description) means the exporter falls back to the single description/descriptionRender
      // pair above, unchanged (D6). description/descriptionRender themselves are unaffected —
      // every other reader (the braille formatter, docx export, this node's own display above)
      // keeps working off the merged single field.
      descriptions: Array.isArray(image.descriptions) && image.descriptions.length
        ? image.descriptions.map((d) => ({
          text: String((d && d.text) || ''),
          ...(d && d.render === 'required' ? { render: 'required' } : {}),
          ...(d && d.id ? { id: String(d.id) } : {}),
        }))
        : null,
      // F-231 — BANA 6.2.2b: the transcriber's-note label word for an unidentified
      // illustration (e.g. "Photograph", "Picture") — document.mjs's traceOrFormatPrintImage
      // reads this straight from the block, defaulting to "Illustration" when unset.
      figureType: image.figureType ? String(image.figureType) : '',
      // BANA 6.2.2c source citation (block.citation), carried for the save and the formatter.
      citation: image.citation ? String(image.citation) : '',
      // A picture the document marks as decoration (Word's IMP-W12; HTML alt="", S5D-Q4): no "picture has no description" warning. It counts
      // only while the description is empty (imageBlock): typing one makes it an ordinary described picture (17 Oct 2026).
      decorative: !!image.decorative,
    };
  }
  getImage() { return this.getLatest().__image; }
  // F-231 / Stage 2 (23 Sep 2026): the picture-type control's read/write pair — the field
  // itself already round-trips through load/save/undo via __image (F-231's fix, above);
  // this just lets the Advanced Editor's dropdown (registerDecoratorListener, below) change it.
  // Feedback 30 Sep item 8 (Paul, 1 Oct): the picture's alt text — the description the braille reader is given, which the
  // formatter puts in a transcriber's note (BANA 6.2.2) — is edited on the picture card (registerDecoratorListener, below).
  getAlt() { return this.getLatest().__image.alt || ''; }
  setAlt(v) {
    const w = this.getWritable();
    w.__image = { ...w.__image, alt: String(v ?? '').replace(/\s+/g, ' ').trim() };
  }
  getFigureType() { return this.getLatest().__image.figureType || ''; }
  setFigureType(v) {
    const w = this.getWritable();
    w.__image = { ...w.__image, figureType: v ? String(v) : '' };
  }
  createDOM() {
    const img = this.__image;
    const d = document.createElement('figure');
    d.className = 'doc-image-block';
    d.contentEditable = 'false';
    const label = img.caption || img.alt || img.description || 'Image';
    d.setAttribute('aria-label', t('app.editor.image_aria', { label }));
    // A NIMAS package's own image (A3): src is the package-relative path (kept as-is so the
    // save writes it back), shown here via the object URL setLoadedDocInfo built for it.
    const packageUrl = loadedDocInfo.resourceUrls.get(img.src);
    const displaySrc = packageUrl || (/^(data:image\/|https?:|blob:)/i.test(img.src) ? img.src : null);
    if (displaySrc) {
      const el = document.createElement('img');
      el.src = displaySrc; el.alt = img.alt;
      el.onerror = () => el.remove();
      d.appendChild(el);
    }
    const meta = document.createElement('div');
    meta.className = 'doc-image-meta';
    const line = (cls, text) => { if (!text) return; const x = document.createElement('div'); x.className = cls; x.textContent = text; meta.appendChild(x); };
    line('doc-image-src', `${img.src ? img.src.replace(/^data:[^,]*,.*/, 'embedded image') : 'image'}`);
    line('doc-image-caption', img.caption);
    // The alt text is edited in its own box (the decorator, feedback item 8); a production note (img.description) stays shown here.
    line('doc-image-desc', img.description || '');
    d.appendChild(meta);
    return d;
  }
  updateDOM() { return true; }
  // Stage 2 (23 Sep 2026): decorate() used to return null (ImageNode had no interactive
  // control at all). It now carries figureType so registerDecoratorListener can mount the
  // picture-type dropdown into the meta area createDOM already built, the same way
  // GraphicNode/TableNode mount their own controls onto their static shells.
  decorate() { return { type: 'image', figureType: this.getLatest().__image.figureType || '', alt: this.getLatest().__image.alt || '' }; }
  isInline() { return false; }
  exportJSON() { return { type: 'emboss-image', version: 1, image: this.__image }; }
  static importJSON(j) { return new ImageNode(j?.image || {}); }
}
const $createImageNode = (image) => new ImageNode(image);
const $isImageNode = (n) => n instanceof ImageNode;

class TableNode extends DecoratorNode {
  __headers = [];
  __rows = [];
  __format = 'spatial';
  // BANA §11.3.1a's HEADING (centred; `null` when this table has none, or only a plain
  // §11.2.8 CAPTION — carried as a separate sibling "Caption / Attribution" block instead,
  // unrelated to this node, F-4/F-5) — a string, or an array for a real hard print line
  // break (e.g. a sequence number on its own line, BANA Example 11-4). __titlePosition
  // ('in-box' | 'before-box') is BANA §11.3.1b's box-line placement; see document.mjs
  // formatBox/formatTable and parse.mjs parseTable for the same signal on the model/DTBook
  // side.
  __title = null;
  __titlePosition = 'in-box';
  // BANA §11.4.3's complex (two-tier) header, F-12: [{ text, from, to }] (0-based
  // inclusive column span) for the primary heading row; `__headers` stays the flat
  // sub-column/single-tier row (unchanged shape) — see document.mjs's
  // formatGroupedHeaderRows/computeTableColumns and parse.mjs's parseTable for the
  // same signal on the format/DTBook side. Data only, carried through save/load like
  // __title/__titlePosition above; there is no editor UI to author or edit it — a
  // table authored fresh in the editor simply has none, same as before this fix — and
  // addColumn/removeColumn below do not adjust it (no UI path exercises that
  // combination yet, so it is left rather than half-fixed).
  __headerGroups = null;
  // K3 (BANA §11.6.1d/§11.6.1c, transcriber KD): per-column place-value alignment.
  // __printAlign ('right'|'decimal'|undefined per column) is what a reader read from PRINT's
  // own column-alignment markup (parse.mjs's parseTable/DOCX/HTML/ODT/RTF readers, doc.mjs) —
  // read-only in the editor, same as __headerGroups above: data only, carried through
  // clone/JSON/undo/save/load so opening and re-saving a document never silently drops what
  // was read from its source file, but not user-editable here yet. __columnAlign
  // ('left'|'right' per column) is the transcriber's own override (F-7/standards-findings.md
  // — "a way to mark a column as 'don't align'"), which always wins over __printAlign
  // (document.mjs's numericAlignApplies); also data only for now — no dialog control exists
  // to set it yet (Emboss/format/field-registry.mjs, the Braille formatting dialog's own
  // data source, has no per-column entry — a per-column control is a UI design task of its
  // own, out of scope here). addColumn/removeColumn below do not adjust either array (no UI
  // path exercises that combination yet, so left rather than half-fixed, same as headerGroups).
  __printAlign = null;
  __columnAlign = null;
  // BANA §11.18.1j (stairstep only): 0-based body-row indexes shown as cell-5 subdivision
  // headings + the heading's own text. Data only, carried through clone/JSON/undo/save/load
  // like __headerGroups; there is no editor UI to author them yet.
  __subdivisionRows = null;
  __subdivisionHeading = null;
  // F-5: the table block's own caption / transcriber's note / note render, for a model that
  // carries them directly on the table (nimas-export.mjs and format/document.mjs both read
  // block.caption / block.tabletn / block.tabletnRender). The parser itself puts a table's
  // caption and note in separate sibling blocks instead (Caption / Note paragraphs, kept by
  // ParagraphNode's own fields); these are plain data carried through so a table that has
  // them is never silently stripped. No editor UI: the siblings are the visible way to edit.
  __caption = null;
  __tabletn = null;
  __tabletnRender = null;
  __noGuideDots = false;   // block.guideDots === false (BANA 10.9.1d matching columns), carried for the save and the formatter

  static getType() { return 'emboss-table'; }
  static clone(n) {
    const node = new TableNode([...(n.__headers || [])], (n.__rows || []).map(r => [...r]), n.__key);
    node.__format = n.__format || 'spatial';
    node.__title = Array.isArray(n.__title) ? [...n.__title] : (n.__title ?? null);
    node.__titlePosition = n.__titlePosition || 'in-box';
    node.__headerGroups = Array.isArray(n.__headerGroups) ? n.__headerGroups.map((g) => ({ ...g })) : null;
    node.__printAlign = Array.isArray(n.__printAlign) ? [...n.__printAlign] : null;
    node.__columnAlign = Array.isArray(n.__columnAlign) ? [...n.__columnAlign] : null;
    node.__subdivisionRows = Array.isArray(n.__subdivisionRows) ? [...n.__subdivisionRows] : null;
    node.__subdivisionHeading = n.__subdivisionHeading ?? null;
    node.__caption = n.__caption ?? null;
    node.__tabletn = n.__tabletn ?? null;
    node.__tabletnRender = n.__tabletnRender ?? null;
    node.__noGuideDots = !!n.__noGuideDots;
    return node;
  }
  constructor(headers = [], rows = [], key) {
    super(key);
    this.__headers = Array.isArray(headers) ? headers : [];
    this.__rows = Array.isArray(rows) ? rows : [];
    this.__format = 'spatial';
  }
  getTitle() { return this.getLatest().__title; }
  setTitle(t) { this.getWritable().__title = (t == null || t === '') ? null : t; }
  getTitlePosition() { return this.getLatest().__titlePosition || 'in-box'; }
  setTitlePosition(p) { this.getWritable().__titlePosition = p === 'before-box' ? 'before-box' : 'in-box'; }
  getHeaderGroups() { return this.getLatest().__headerGroups; }
  setHeaderGroups(g) { this.getWritable().__headerGroups = Array.isArray(g) && g.length ? g : null; }
  getPrintAlign() { return this.getLatest().__printAlign; }
  setPrintAlign(a) { this.getWritable().__printAlign = Array.isArray(a) && a.some(Boolean) ? [...a] : null; }
  getColumnAlign() { return this.getLatest().__columnAlign; }
  setColumnAlign(a) { this.getWritable().__columnAlign = Array.isArray(a) && a.some(Boolean) ? [...a] : null; }
  getSubdivisionRows() { return this.getLatest().__subdivisionRows; }
  setSubdivisionRows(r) { this.getWritable().__subdivisionRows = Array.isArray(r) && r.length ? [...r] : null; }
  getSubdivisionHeading() { return this.getLatest().__subdivisionHeading ?? null; }
  setSubdivisionHeading(h) { this.getWritable().__subdivisionHeading = (h == null || h === '') ? null : String(h); }
  getCaption() { return this.getLatest().__caption ?? null; }
  setCaption(c) { this.getWritable().__caption = (c == null || c === '') ? null : c; }
  getTabletn() { return this.getLatest().__tabletn ?? null; }
  setTabletn(t) { this.getWritable().__tabletn = (t == null || t === '') ? null : t; }
  getTabletnRender() { return this.getLatest().__tabletnRender ?? null; }
  setTabletnRender(r) { this.getWritable().__tabletnRender = r === 'required' || r === 'optional' ? r : null; }
  getNoGuideDots() { return !!this.getLatest().__noGuideDots; }
  setNoGuideDots(v) { this.getWritable().__noGuideDots = !!v; }
  getFormat() { return this.getLatest().__format || 'spatial'; }
  setFormat(f) { this.getWritable().__format = f || 'spatial'; }
  createDOM() {
    const d = document.createElement('div');
    d.className = 'doc-table-block';
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', t('app.editor.table_block_aria'));
    return d;
  }
  // Only recreate DOM when structural dimensions change (+Row / +Col / -Row / -Col).
  // In-cell text edits return false so the active input is never destroyed and cursor focus is preserved.
  updateDOM(prevNode) {
    if (!prevNode) return true;
    const prevHeaders = prevNode.__headers || [];
    const nextHeaders = this.__headers || [];
    const prevRows = prevNode.__rows || [];
    const nextRows = this.__rows || [];
    if (prevHeaders.length !== nextHeaders.length || prevRows.length !== nextRows.length) {
      return true;
    }
    for (let i = 0; i < prevRows.length; i++) {
      if ((prevRows[i] || []).length !== (nextRows[i] || []).length) return true;
    }
    if ((prevNode.__format || 'spatial') !== (this.__format || 'spatial')) return true;
    return false;
  }
  decorate() {
    return {
      type: 'table',
      headers: this.__headers,
      rows: this.__rows,
      format: this.__format || 'spatial',
      title: this.__title ?? null,
      titlePosition: this.__titlePosition || 'in-box',
      ...(this.__headerGroups ? { headerGroups: this.__headerGroups } : {}),
      ...(this.__printAlign ? { printAlign: this.__printAlign } : {}),
      ...(this.__columnAlign ? { columnAlign: this.__columnAlign } : {}),
      ...(this.__subdivisionRows ? { subdivisionRows: this.__subdivisionRows } : {}),
      ...(this.__subdivisionHeading != null ? { subdivisionHeading: this.__subdivisionHeading } : {}),
    };
  }
  isInline() { return false; }
  getHeaders() { return this.getLatest().__headers; }
  getRows() { return this.getLatest().__rows; }
  setHeaders(h) { this.getWritable().__headers = h; }
  setRows(r) { this.getWritable().__rows = r; }
  // `html` is the cell's contenteditable innerHTML (format/cell-dom.mjs, G15): a maths or
  // note-reference chip carries its own MathML/idref in data attributes, so it round-trips
  // exactly with no "was this cell edited?" comparison against the previous value needed.
  setCell(ri, ci, html) {
    const w = this.getWritable();
    if (ri === -1) {
      const h = [...(w.__headers || [])];
      while (h.length <= ci) h.push('');
      h[ci] = cellFromEditableHtml(html);
      w.__headers = h;
    } else {
      const rows = (w.__rows || []).map(r => [...r]);
      while (rows.length <= ri) rows.push([]);
      while (rows[ri].length <= ci) rows[ri].push('');
      rows[ri][ci] = cellFromEditableHtml(html);
      w.__rows = rows;
    }
  }
  addRow() {
    const w = this.getWritable();
    const colCount = Math.max(w.__headers.length, ...(w.__rows.map(r => r.length)), 2);
    const newRow = Array(colCount).fill('');
    w.__rows = [...(w.__rows || []), newRow];
  }
  removeRow(ri) {
    const w = this.getWritable();
    if (w.__rows && w.__rows.length > 1) {
      w.__rows = w.__rows.filter((_, idx) => idx !== ri);
      if (Array.isArray(w.__subdivisionRows)) {
        const sr = w.__subdivisionRows.filter((i) => i !== ri).map((i) => (i > ri ? i - 1 : i));
        w.__subdivisionRows = sr.length ? sr : null;
      }
      // fmt row indexes (total rows, subheadings above a row) follow the rows they name.
      if (w.__fmt && (w.__fmt.totalRows || w.__fmt.rowSubheadings)) {
        const f = { ...w.__fmt };
        if (Array.isArray(f.totalRows)) f.totalRows = f.totalRows.filter((i) => i !== ri).map((i) => (i > ri ? i - 1 : i));
        if (Array.isArray(f.rowSubheadings)) f.rowSubheadings = f.rowSubheadings.filter((e) => e && e.row !== ri).map((e) => (e.row > ri ? { ...e, row: e.row - 1 } : e));
        w.__fmt = cleanFmt(f);
      }
    }
  }
  addColumn() {
    const w = this.getWritable();
    if (w.__headers && w.__headers.length > 0) w.__headers = [...w.__headers, ''];
    w.__rows = (w.__rows || []).map(r => [...r, '']);
  }
  removeColumn(ci) {
    const w = this.getWritable();
    if (w.__headers && w.__headers.length > ci) w.__headers = w.__headers.filter((_, idx) => idx !== ci);
    if (w.__rows) w.__rows = w.__rows.map(r => r.filter((_, idx) => idx !== ci));
  }
  exportJSON() {
    return {
      type: 'emboss-table',
      version: 1,
      headers: this.__headers,
      rows: this.__rows,
      format: this.__format || 'spatial',
      ...(this.__title != null ? { title: this.__title, titlePosition: this.__titlePosition || 'in-box' } : {}),
      ...(this.__headerGroups ? { headerGroups: this.__headerGroups } : {}),
      ...(this.__printAlign ? { printAlign: this.__printAlign } : {}),
      ...(this.__columnAlign ? { columnAlign: this.__columnAlign } : {}),
      ...(this.__subdivisionRows ? { subdivisionRows: this.__subdivisionRows } : {}),
      ...(this.__subdivisionHeading != null ? { subdivisionHeading: this.__subdivisionHeading } : {}),
      ...(this.__caption != null ? { caption: this.__caption } : {}),
      ...(this.__tabletn != null ? { tabletn: this.__tabletn } : {}),
      ...(this.__tabletnRender != null ? { tabletnRender: this.__tabletnRender } : {}),
      ...(this.__noGuideDots ? { noGuideDots: true } : {}),
    };
  }
  static importJSON(j) {
    const n = new TableNode(j.headers || [], j.rows || []);
    if (j.format) n.__format = j.format;
    if (j.title != null) n.__title = j.title;
    if (j.titlePosition) n.__titlePosition = j.titlePosition === 'before-box' ? 'before-box' : 'in-box';
    if (Array.isArray(j.headerGroups) && j.headerGroups.length) n.__headerGroups = j.headerGroups;
    if (Array.isArray(j.printAlign) && j.printAlign.some(Boolean)) n.__printAlign = j.printAlign;
    if (Array.isArray(j.columnAlign) && j.columnAlign.some(Boolean)) n.__columnAlign = j.columnAlign;
    if (Array.isArray(j.subdivisionRows) && j.subdivisionRows.length) n.__subdivisionRows = j.subdivisionRows;
    if (j.subdivisionHeading != null) n.__subdivisionHeading = j.subdivisionHeading;
    if (j.caption != null) n.__caption = j.caption;
    if (j.tabletn != null) n.__tabletn = j.tabletn;
    if (j.tabletnRender === 'required' || j.tabletnRender === 'optional') n.__tabletnRender = j.tabletnRender;
    if (j.noGuideDots) n.__noGuideDots = true;
    return n;
  }
}
const $createTableNode = (headers, rows, format = 'spatial', title = null, titlePosition = 'in-box', headerGroups = null) => {
  const t = new TableNode(headers, rows);
  if (format) t.setFormat(format);
  if (title != null) t.setTitle(title);
  t.setTitlePosition(titlePosition);
  if (headerGroups) t.setHeaderGroups(headerGroups);
  return t;
};
const $isTableNode = (n) => n instanceof TableNode;

class SidebarNode extends ElementNode {
  __title = '';
  __banaStyle = 'sidebar';

  static getType() { return 'emboss-sidebar'; }
  static clone(n) { return new SidebarNode(n.__title, n.__key); }
  constructor(title = '', key) {
    super(key);
    this.__title = title || '';
    this.__banaStyle = 'sidebar';
  }
  createDOM() {
    const aside = document.createElement('aside');
    aside.className = 'emboss-sidebar-card bana-style-sidebar';
    aside.dataset.banaStyle = 'sidebar';
    if (this.__title) aside.dataset.title = this.__title;
    return aside;
  }
  updateDOM(prevNode, dom) {
    if (prevNode.__title !== this.__title) {
      if (this.__title) dom.dataset.title = this.__title;
      else delete dom.dataset.title;
    }
    return false;
  }
  afterCloneFrom(prevNode) {
    if (super.afterCloneFrom) super.afterCloneFrom(prevNode);
    this.__title = prevNode.__title || '';
    this.__banaStyle = prevNode.__banaStyle || 'sidebar';
    this.__source = prevNode.__source || null;
  }
  // The source <sidebar> id and render value, kept for the save (A26).
  getSource() { return this.getLatest().__source || null; }
  setSource(src) { this.getWritable().__source = src && (src.id || src.render) ? { id: src.id || null, render: src.render || null } : null; return this; }
  getTitle() { return this.getLatest().__title || ''; }
  setTitle(t) { this.getWritable().__title = t || ''; return this; }
  getBanaStyle() { return 'sidebar'; }
  setBanaStyle() { return this; }
  exportJSON() {
    return {
      ...super.exportJSON(),
      type: 'emboss-sidebar',
      version: 1,
      title: this.__title,
      banaStyle: this.__banaStyle,
      ...(this.__source ? { source: this.__source } : {}),
    };
  }
  updateFromJSON(serializedNode) {
    if (super.updateFromJSON) super.updateFromJSON(serializedNode);
    this.__title = serializedNode.title || '';
    this.__source = serializedNode.source || null;
    return this;
  }
  static importJSON(j) {
    const node = new SidebarNode(j.title);
    node.updateFromJSON(j);
    return node;
  }
}
const $createSidebarNode = (title) => new SidebarNode(title);
const $isSidebarNode = (n) => n instanceof SidebarNode;
[PrintPageNode, TableNode, SidebarNode, ImageNode, GraphicNode].forEach(installFmt);   // same per-node `fmt` as paragraphs (page-turn flags, table extras, box lines, page break before a picture)

// Transcriber's Notes page (block `tnpage`, BANA 2.6.1; transcriber-pages-plan.md stage 3).
// A titled container of plain paragraphs: each paragraph is one entry, and paragraphs that share
// a noteGroup (ParagraphNode.getNoteGroup, the F-164 mechanism) are ONE entry's further
// paragraphs. The heading is NOT a child node: it is the fixed heading of the page (or the
// block's own `heading`, kept here for the save) and is shown by CSS from data-heading, so the
// braille pane's heading line has no print counterpart to link to (formatter's traceBlock gives
// it no source either) -- only the entries map to units (data-unit-idx = the k-th non-empty entry
// paragraph, tagPrintBlocks). Saves as <level1 class="bana-transcriber-notes"> (nimas-export.mjs).
class TnPageNode extends ElementNode {
  __heading = '';
  __dismissed = [];   // ids of suggested notes the transcriber added or dismissed (kept in the undo snapshots; NOT in the saved file)
  static getType() { return 'emboss-tnpage'; }
  static clone(n) { return new TnPageNode(n.__heading, n.__key); }
  constructor(heading = '', key) {
    super(key);
    this.__heading = heading || '';
  }
  createDOM() {
    const aside = document.createElement('aside');
    aside.className = 'emboss-sidebar-card emboss-tnpage-card bana-style-tnpage';
    aside.dataset.banaStyle = 'tnpage';
    aside.dataset.heading = this.__heading || TNPAGE_DEFAULT_HEADING_UI();
    aside.setAttribute('role', 'group');
    aside.setAttribute('aria-label', aside.dataset.heading);
    return aside;
  }
  updateDOM(prevNode, dom) {
    if (prevNode.__heading !== this.__heading) {
      dom.dataset.heading = this.__heading || TNPAGE_DEFAULT_HEADING_UI();
      dom.setAttribute('aria-label', dom.dataset.heading);
    }
    return false;
  }
  afterCloneFrom(prevNode) {
    if (super.afterCloneFrom) super.afterCloneFrom(prevNode);
    this.__heading = prevNode.__heading || '';
    this.__dismissed = [...(prevNode.__dismissed || [])];
  }
  getDismissed() { return this.getLatest().__dismissed || []; }
  setDismissed(ids) { this.getWritable().__dismissed = [...ids]; return this; }
  getHeading() { return this.getLatest().__heading || ''; }
  setHeading(h) { this.getWritable().__heading = h || ''; return this; }
  getBanaStyle() { return 'tnpage'; }
  setBanaStyle() { return this; }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-tnpage', version: 1, heading: this.__heading, dismissed: this.__dismissed }; }
  updateFromJSON(j) {
    if (super.updateFromJSON) super.updateFromJSON(j);
    this.__heading = j.heading || '';
    this.__dismissed = Array.isArray(j.dismissed) ? [...j.dismissed] : [];
    return this;
  }
  static importJSON(j) { const node = new TnPageNode(j.heading); node.updateFromJSON(j); return node; }
}
const $createTnPageNode = (heading) => new TnPageNode(heading);
const $isTnPageNode = (n) => n instanceof TnPageNode;
// UK-8 (28 Sep, James via Paul): the UK equivalent of the Transcriber's Notes page is called "Note to
// Braille Edition" \u2014 its heading in the braille (document.mjs's tnpageHeading) AND its label here in
// the editor card, whenever the page's own heading has not been typed over.
function TNPAGE_DEFAULT_HEADING_UI() {
  return settings.mode === 'bana' ? tOr('app.editor.tnpage_heading', 'Transcriber\u2019s Notes')
    : tOr('app.editor.tnpage_heading_ukaaf', 'Note to Braille Edition');
}

// Special Symbols page (block `sympage`, BANA 2.5; G8 stage 5). Same shape as TnPageNode: a titled
// container whose heading is CSS (data-heading), not a child; each child paragraph is one entry: an
// atomic BrlNode (the symbol: braille cells in its title, print glyph as text) then the meaning as
// plain text. While `auto` is on the page is derived: syncSymPages rewrites the children from the
// document's symbols and the save writes only {auto:true}. Once the transcriber edits an entry the
// children no longer match the last sync (__sig), `auto` goes off and the entries are saved explicitly.
class SymPageNode extends ElementNode {
  __heading = '';
  __auto = true;
  __sig = '[]';
  static getType() { return 'emboss-sympage'; }
  static clone(n) { const c = new SymPageNode(n.__heading, n.__auto, n.__sig, n.__key); return c; }
  constructor(heading = '', auto = true, sig = '[]', key) {
    super(key);
    this.__heading = heading || '';
    this.__auto = auto !== false;
    this.__sig = sig || '[]';
  }
  createDOM() {
    const aside = document.createElement('aside');
    aside.className = 'emboss-sidebar-card emboss-sympage-card bana-style-sympage';
    aside.dataset.banaStyle = 'sympage';
    aside.dataset.heading = this.__heading || SYMPAGE_DEFAULT_HEADING_UI();
    aside.dataset.auto = this.__auto ? '1' : '';
    aside.dataset.autoNote = tOr('app.editor.sympage_auto_note', 'Listed automatically from the document. Edit an entry to fix the list.');
    aside.setAttribute('role', 'group');
    aside.setAttribute('aria-label', aside.dataset.heading);
    return aside;
  }
  updateDOM(prevNode, dom) {
    if (prevNode.__heading !== this.__heading) {
      dom.dataset.heading = this.__heading || SYMPAGE_DEFAULT_HEADING_UI();
      dom.setAttribute('aria-label', dom.dataset.heading);
    }
    if (prevNode.__auto !== this.__auto) dom.dataset.auto = this.__auto ? '1' : '';
    return false;
  }
  afterCloneFrom(prevNode) {
    if (super.afterCloneFrom) super.afterCloneFrom(prevNode);
    this.__heading = prevNode.__heading || '';
    this.__auto = prevNode.__auto;
    this.__sig = prevNode.__sig;
  }
  getHeading() { return this.getLatest().__heading || ''; }
  setHeading(h) { this.getWritable().__heading = h || ''; return this; }
  getAuto() { return this.getLatest().__auto; }
  setAuto(v) { this.getWritable().__auto = !!v; return this; }
  getSig() { return this.getLatest().__sig; }
  setSig(v) { this.getWritable().__sig = v; return this; }
  getBanaStyle() { return 'sympage'; }
  setBanaStyle() { return this; }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-sympage', version: 1, heading: this.__heading, auto: this.__auto, sig: this.__sig }; }
  updateFromJSON(j) {
    if (super.updateFromJSON) super.updateFromJSON(j);
    this.__heading = j.heading || '';
    this.__auto = j.auto !== false;
    this.__sig = j.sig || '[]';
    return this;
  }
  static importJSON(j) { const node = new SymPageNode(j.heading, j.auto, j.sig); node.updateFromJSON(j); return node; }
}
const $createSymPageNode = (heading, auto) => new SymPageNode(heading, auto);
const $isSymPageNode = (n) => n instanceof SymPageNode;
function SYMPAGE_DEFAULT_HEADING_UI() { return tOr('app.editor.sympage_heading', 'Special Symbols Used in This Volume'); }
// One entry paragraph <-> { braille, print?, description? } (the block's entry shape).
function $symEntryOfParagraph(p) {
  let braille = '', print = '', hasBrl = false, desc = '';
  for (const c of p.getChildren()) {
    if ($isBrlNode(c)) {
      if (!hasBrl) { hasBrl = true; braille = c.getBrl(); const tx = c.getTextContent().replace(/\u200B/g, ''); print = tx === braille ? '' : tx; }
    } else desc += c.getTextContent();
  }
  desc = desc.replace(/\s+/g, ' ').trim();
  if (!hasBrl && !desc) return null;
  const e = { braille };
  if (print) e.print = print;
  if (desc) e.description = desc;
  return e;
}
function $symNodeEntries(node) {
  const out = [];
  for (const c of node.getChildren()) { if (c instanceof ParagraphNode) { const e = $symEntryOfParagraph(c); if (e) out.push(e); } }
  return out;
}
function $fillSymPage(node, entries) {
  for (const c of node.getChildren()) c.remove();
  for (const e of entries) {
    const p = $createParagraphNode();
    if (e.braille || e.print) p.append($createBrlNode(e.print || e.braille, e.braille || ''));
    if (e.description) p.append($createTextNode(`${e.braille || e.print ? ' ' : ''}${e.description}`));
    node.append(p);
  }
  if (!entries.length) node.append($createParagraphNode());
}
// The automatic page's entries for a model: the dot locator, then the document's special symbols in
// braille order (collectSpecialSymbols), worded by the formatter's own symbolMeaning (format/document.mjs).
function symDerivedEntries(blocks) {
  const found = collectSpecialSymbols(blocks.filter((b) => b && b.type !== 'sympage'), {});
  if (!found.length) return [];
  return [{ braille: '', print: '.=', description: 'Dot locator, precedes listed symbols' },
    ...found.map((d) => {
      const t = String(d.print ?? '').trim();
      const description = symbolMeaning({ print: d.print, name: d.name });
      return { braille: d.braille, ...(t ? { print: t } : {}), ...(description ? { description } : {}) };
    })];
}

// ---- Title Page (block `titlepage`, BANA Formats 2016 §2.3, K29 Stage 1c; design doc
// transcriber-pages-customisation-design.md §4). Three node types, nested like ListNode/ListItemNode:
//   TitlePageNode (the card, an <aside role="group">) -> TpSegmentNode (one per segment, a labelled
//   <div role="group">, design §4 "labelled segment groups") -> ordinary ParagraphNode lines, each a
//   mix of plain TextNode runs and TpFieldNode chips (atomic, like BrlNode — design §4 "Fields are
//   atomic chips, like the existing BrlNode").
// `auto`/`sig` on TitlePageNode is the SAME pattern as SymPageNode's own auto/sig (see that class's
// comment): while auto, the WHOLE card is regenerated from the document's live fields on every render
// (syncTitlePages, called from render()); the transcriber typing on the page (adding/deleting/retyping
// a line) flips auto off (the update listener below), same trigger as SymPageNode's. Unlike SymPageNode,
// `sig` here is a STRUCTURAL signature ONLY (titlePageStructureSig, field-registry.mjs) — which lines,
// fields and (for a list field) indices exist, with field VALUES stripped out — because TP-6
// (decisions.md) requires field values to keep updating even on an edited page ("fields are always
// live... typing over a field's value turns that field into plain text on that page only"); only a
// change to the STRUCTURE (a line added/removed/retyped) counts as an edit. syncTitlePages refreshes
// an edited page's existing chips' VALUES in place (never touching line structure) using
// field-registry.mjs's refreshTitlePageValues — the SAME function format/document.mjs's traceTitlePage
// now uses for the braille, so the card and the braille can never show two different current values.
// K29 Stage 1c rework (Fable review): a chip's `idx` (only set for a LIST field — authors, isbn —
// design §3.1) identifies WHICH entry it stands for, so refreshTitlePageValues can find the right
// value again even if the list has since grown or shrunk, rather than assuming chips stay lined up
// by position (this stage's ORIGINAL, since-removed limitation).
const TP_FIELD_EMPTY = '​';   // keeps an empty chip's TextNode alive, same technique as BrlNode's BRL_EMPTY
function tpFieldAriaLabel(field, rawText) {
  const label = TP_FIELD_LABELS[field] || field || '';
  const value = String(rawText || '').replace(/​/g, '');
  // design §4: "A screen reader announces a chip as, for example, 'Print pages, field, i-x and 1-44';
  // an empty field says 'empty, line not brailled'."
  return value ? (t('app.titlepage_card.field_aria', { label, value }) || `${label}, field, ${value}`)
    : (t('app.titlepage_card.field_empty_aria', { label }) || `${label}, empty, line not brailled`);
}
class TpFieldNode extends TextNode {
  static getType() { return 'emboss-tpfield'; }
  static clone(n) { return new TpFieldNode(n.__text, n.__field, n.__idx, n.__key); }
  constructor(value = '', field = '', idx = null, key) {
    super(value || TP_FIELD_EMPTY, key);
    this.__field = field || '';
    this.__idx = idx == null ? null : Number(idx);
  }
  getField() { return this.getLatest().__field; }
  getIdx() { return this.getLatest().__idx; }
  getFieldValue() { return this.getTextContent().replace(/​/g, ''); }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('tp-field-chip');
    dom.title = this.__field;
    dom.setAttribute('aria-label', tpFieldAriaLabel(this.__field, this.getTextContent()));
    return dom;
  }
  updateDOM(prevNode, dom, config) {
    const changed = super.updateDOM(prevNode, dom, config) || false;
    if (prevNode.__field !== this.__field || prevNode.getTextContent() !== this.getTextContent()) {
      dom.title = this.__field;
      dom.setAttribute('aria-label', tpFieldAriaLabel(this.__field, this.getTextContent()));
    }
    return changed;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-tpfield', version: 1, field: this.__field, idx: this.__idx }; }
  static importJSON(j) { return new TpFieldNode(j.text || '', j.field || '', j.idx ?? null).updateFromJSON(j).setMode('token'); }
}
const $createTpFieldNode = (value, field, idx) => new TpFieldNode(value, field, idx).setMode('token');
const $isTpFieldNode = (n) => n instanceof TpFieldNode;

class TpSegmentNode extends ElementNode {
  __name = '';
  static getType() { return 'emboss-tpsegment'; }
  static clone(n) { return new TpSegmentNode(n.__name, n.__key); }
  constructor(name = '', key) { super(key); this.__name = name || ''; }
  createDOM() {
    const div = document.createElement('div');
    div.className = 'tp-segment';
    div.setAttribute('role', 'group');
    div.setAttribute('aria-label', this.__name);
    div.dataset.segment = this.__name;
    return div;
  }
  updateDOM(prevNode, dom) {
    if (prevNode.__name !== this.__name) { dom.setAttribute('aria-label', this.__name); dom.dataset.segment = this.__name; }
    return false;
  }
  afterCloneFrom(prevNode) { if (super.afterCloneFrom) super.afterCloneFrom(prevNode); this.__name = prevNode.__name || ''; }
  getName() { return this.getLatest().__name; }
  setName(n) { this.getWritable().__name = n || ''; return this; }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-tpsegment', version: 1, name: this.__name }; }
  updateFromJSON(j) { if (super.updateFromJSON) super.updateFromJSON(j); this.__name = j.name || ''; return this; }
  static importJSON(j) { const node = new TpSegmentNode(j.name); node.updateFromJSON(j); return node; }
}
const $createTpSegmentNode = (name) => new TpSegmentNode(name);
const $isTpSegmentNode = (n) => n instanceof TpSegmentNode;

function TITLEPAGE_HEADING_UI() { return tOr('app.editor.titlepage_heading', 'Title Page'); }
class TitlePageNode extends ElementNode {
  __auto = true;
  __sig = '[]';
  static getType() { return 'emboss-titlepage'; }
  static clone(n) { return new TitlePageNode(n.__auto, n.__sig, n.__key); }
  constructor(auto = true, sig = '[]', key) {
    super(key);
    this.__auto = auto !== false;
    this.__sig = sig || '[]';
  }
  createDOM() {
    const aside = document.createElement('aside');
    aside.className = 'emboss-sidebar-card emboss-titlepage-card bana-style-titlepage';
    aside.dataset.banaStyle = 'titlepage';
    aside.dataset.heading = TITLEPAGE_HEADING_UI();
    aside.dataset.auto = this.__auto ? '1' : '';
    aside.dataset.editedNote = tOr('app.editor.titlepage_edited_note', 'The template changed since you edited this page.');
    aside.setAttribute('role', 'group');
    aside.setAttribute('aria-label', aside.dataset.heading);
    return aside;
  }
  updateDOM(prevNode, dom) {
    if (prevNode.__auto !== this.__auto) dom.dataset.auto = this.__auto ? '1' : '';
    return false;
  }
  afterCloneFrom(prevNode) { if (super.afterCloneFrom) super.afterCloneFrom(prevNode); this.__auto = prevNode.__auto; this.__sig = prevNode.__sig; }
  getAuto() { return this.getLatest().__auto; }
  setAuto(v) { this.getWritable().__auto = !!v; return this; }
  getSig() { return this.getLatest().__sig; }
  setSig(v) { this.getWritable().__sig = v; return this; }
  getBanaStyle() { return 'titlepage'; }
  setBanaStyle() { return this; }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-titlepage', version: 1, auto: this.__auto, sig: this.__sig }; }
  updateFromJSON(j) { if (super.updateFromJSON) super.updateFromJSON(j); this.__auto = j.auto !== false; this.__sig = j.sig || '[]'; return this; }
  static importJSON(j) { const node = new TitlePageNode(j.auto, j.sig); node.updateFromJSON(j); return node; }
}
const $createTitlePageNode = (auto = true, sig = '[]') => new TitlePageNode(auto, sig);
const $isTitlePageNode = (n) => n instanceof TitlePageNode;

// Build/replace a TitlePageNode's full content from a titlePageTemplateSegments()-shaped array (used for a
// fresh auto page, Regenerate, and restoring an edited page's saved segments on load — all three just
// hand this a segments array; only WHERE the array comes from differs).
function $fillTitlePage(node, segments) {
  for (const c of node.getChildren()) c.remove();
  for (const seg of Array.isArray(segments) ? segments : []) {
    if (!seg || !Array.isArray(seg.lines) || !seg.lines.length) continue;
    const segNode = $createTpSegmentNode(seg.name);
    for (const l of seg.lines) {
      const p = $createParagraphNode();
      for (const part of (l.parts || [])) {
        if (part && 'fld' in part) p.append($createTpFieldNode(part.value, part.fld, part.idx));
        else if (part && part.lit) p.append($createTextNode(part.lit));
      }
      // K29 Stage 1c rework: etAl/cell3 are LAYOUT hints the shared template still decides
      // (field-registry.mjs's titlePageTemplateSegments) — kept on the paragraph's own `fmt` (the
      // same per-node mechanism BANA margins/page-turn flags already use, installFmt above) so an
      // edited page's braille (format/document.mjs's traceTitlePage) can still apply the "et al."
      // uncontracted tail / cell-3 indent even after a save/reload — see nimas-export.mjs/parse.mjs
      // for the DTBook form (bana-tp-etal/bana-tp-cell3 class tokens on the <p>).
      if (l.etAl || l.cell3) p.setFmt({ ...(l.etAl ? { etAl: true } : {}), ...(l.cell3 ? { cell3: true } : {}) });
      if (p.getChildrenSize()) segNode.append(p);
    }
    if (segNode.getChildrenSize()) node.append(segNode);
  }
}
// Read a TitlePageNode's current content back into the same titlePageTemplateSegments() shape (for
// saving to the block model, and for computing its structural signature) — the inverse of $fillTitlePage.
function $titlePageSegments(node) {
  const segs = [];
  for (const c of node.getChildren()) {
    if (!$isTpSegmentNode(c)) continue;
    const lines = [];
    for (const p of c.getChildren()) {
      if (!(p instanceof ParagraphNode)) continue;
      const parts = [];
      for (const ch of p.getChildren()) {
        if ($isTpFieldNode(ch)) parts.push({ fld: ch.getField(), ...(ch.getIdx() != null ? { idx: ch.getIdx() } : {}), value: ch.getFieldValue() });
        else { const txt = ch.getTextContent(); if (txt) parts.push({ lit: txt }); }
      }
      if (parts.length) {
        const f = typeof p.getFmt === 'function' ? p.getFmt() : null;
        lines.push({ parts, ...(f?.etAl ? { etAl: true } : {}), ...(f?.cell3 ? { cell3: true } : {}) });
      }
    }
    segs.push({ name: c.getName(), lines });
  }
  return segs;
}

// ---- editor ----
// Every error Lexical reports while applying a change (it then discards that change) is counted — so a paste that failed can
// be retried as plain text (below) — and goes into Report a problem's log (A89 step 3).
let lexicalErrorCount = 0;
const editor = createEditor({
  namespace: 'emboss',
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, MathNode, NoteRefNode, LineNumberNode, ImgNoteNode, BrlNode, LinkNode, CiteNode, BreakNode, GraphicNode, ImageNode, TableNode, PrintPageNode, SidebarNode, TnPageNode, SymPageNode, TitlePageNode, TpSegmentNode, TpFieldNode],
  onError: (e) => { lexicalErrorCount++; recordProblem('editor', `Lexical: ${e?.message || e}`, { stack: e?.stack || '' }); console.warn('Lexical non-fatal state warning:', e); },
  theme: { heading: { h1: 'ed-h1', h2: 'ed-h2', h3: 'ed-h3' }, list: { ul: 'ed-ul', ol: 'ed-ol' }, paragraph: 'ed-p',
    text: { bold: 'ed-b', italic: 'ed-i', underline: 'ed-u', strikethrough: 'ed-s', underlineStrikethrough: 'ed-u ed-s' } },
});
editor.setRootElement($id('editor'));
window.editor = editor;
// Test hooks (tests/test-decorator-delete.mjs): make a node selection the way the arrow keys do.
window.__createNodeSelectionForTest = $createNodeSelection;
window.__setSelectionForTest = $setSelection;
// Lexical's core line-break node (not exported by the vendored bundle; registered on every editor).
const $createLineBreakNode = () => new (editor._nodes.get('linebreak').klass)();
const $isLineBreakNode = (n) => !!n && typeof n.getType === 'function' && n.getType() === 'linebreak';
registerRichText(editor);
registerList(editor);

// ---- Never let Backspace/Delete pull content across a box/tnpage/sympage boundary (Paul, 26 Sep
// bug report: "If you delete all the text in a sidebar then the sidebar is not removed and in
// fact it seems to be impossible to delete it.") Testing traced the "impossible to delete" symptom
// to this: triple-clicking a box's only paragraph to select "all its text" — an ordinary way to
// clear it — is a well-known contenteditable quirk where the browser's own selection actually
// extends to the very START of the NEXT paragraph, not just to the end of the box's own text.
// Lexical's default Backspace/Delete has no notion that an aside/page element is a boundary, so it
// deleted the box's text AND merged the following paragraph's content bodily INSIDE the box —
// the box then looked "empty" in the print pane but was never actually empty (it had adopted its
// neighbour's text), so no further Backspace ever removed it. The fix clamps such a selection to
// stay on whichever side its OWN start point is on before the deletion runs, so a container can
// never adopt a sibling's content, and a sibling can never be pulled into a container, as a side
// effect of a delete. Registered above registerRichText's own (COMMAND_PRIORITY_EDITOR) handler so
// it gets first refusal; returns false for every ordinary (non-boundary-crossing) selection, which
// is the overwhelming majority of Backspace/Delete presses, leaving those to Lexical as before.
// K29 Stage 1c rework: TitlePageNode joins the container guard/auto-remove — an emptied Title Page
// card is removable the same way an emptied Transcriber's Notes page is (containerRemovedMessageKey,
// below, gives it its own announcement).
function $isEmbossContainerNode(n) { return $isSidebarNode(n) || $isTnPageNode(n) || $isSymPageNode(n) || $isTitlePageNode(n); }
function $nearestEmbossContainer(node) {
  for (let n = node; n; n = n.getParent ? n.getParent() : null) if ($isEmbossContainerNode(n)) return n;
  return null;
}
// Mutates `selection` in place, clamping it to stop at the boundary; returns true if it changed
// anything (a boundary was actually crossed), false for an ordinary same-side selection.
function $clampSelectionToContainerBoundary(selection) {
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return false;
  const backward = selection.isBackward();
  const startPoint = backward ? selection.focus : selection.anchor;   // earlier of the two in document order
  const endPoint = backward ? selection.anchor : selection.focus;
  const startContainer = $nearestEmbossContainer(startPoint.getNode());
  const endContainer = $nearestEmbossContainer(endPoint.getNode());
  if (startContainer === endContainer) return false;   // both outside every container, or both in the SAME one
  if (startContainer) {
    // Starts inside a container and reaches past its end (outside it, or into a different one):
    // clamp the far point back to the container's own last text position.
    let last = startContainer.getLastDescendant();
    if (!last) return false;
    if (typeof last.getTextContentSize === 'function') endPoint.set(last.getKey(), last.getTextContentSize(), 'text');
    else endPoint.set(startContainer.getKey(), startContainer.getChildrenSize(), 'element');
  } else if (endContainer) {
    // Starts outside and reaches INTO a container: clamp the far point back to just before the
    // container begins, so nothing inside it is touched (and the container cannot be dragged out).
    const parent = endContainer.getParent();
    if (!parent) return false;
    endPoint.set(parent.getKey(), endContainer.getIndexWithinParent(), 'element');
  }
  return true;
}

// ---- A69: never let a single Backspace/Delete silently delete a table/picture/diagram/equation.
// TableNode/ImageNode/GraphicNode/MathNode are Lexical DecoratorNodes; a collapsed caret sitting
// right next to one of them and Backspace/Delete goes through LexicalSelection.ts's
// $deleteCharacter, whose decorator branch calls `caret.origin.remove()` directly for the
// overwhelmingly common case (the "select first" safety Lexical does have only kicks in via a
// narrower path this direct single-boundary adjacency never takes) -- so a whole table's cells, a
// picture, a tactile diagram or an equation could vanish on one keystroke with no undo prompt and
// no announcement. Fixed the same way many editors handle an embedded object: the first
// Backspace/Delete at the boundary turns the caret into a NodeSelection on the decorator (Lexical's
// own "selected object" pattern, same mechanism the click handling elsewhere in this file already
// uses) instead of deleting anything, and announces what happened. The SECOND Backspace/Delete
// needs no new code at all: registerRichText's own DELETE_CHARACTER_COMMAND handler already calls
// `selection.deleteNodes()` whenever the current selection is a NodeSelection -- this fix only had
// to stop the FIRST press reaching that point by accident.
// A print-page marker is protected too: losing one silently renumbers every later print page in the braille.
function $isProtectedDecoratorNode(n) { return $isTableNode(n) || $isImageNode(n) || $isGraphicNode(n) || $isMathNode(n) || $isPrintPageNode(n); }
// A block-level equation (appendBlock's top-level 'math' case, below) is wrapped in its own
// single-child paragraph, so the boundary sibling found is that paragraph, not the MathNode
// itself -- unwrap one level. An inline equation within running text, or a table/image/graphic
// (never paragraph-wrapped), resolve directly.
function $resolveProtectedDecorator(sib, forward) {
  if ($isProtectedDecoratorNode(sib)) return sib;
  if ($isElementNode(sib) && sib.getChildrenSize() === 1) {
    const only = forward ? sib.getFirstChild() : sib.getLastChild();
    if ($isProtectedDecoratorNode(only)) return only;
  }
  return null;
}
// The node immediately adjacent to a COLLAPSED caret sitting at the very edge of its own text (or
// of an empty element), walking up out of every ancestor for which the caret's own node is the
// first/last child -- mirrors Lexical's own decorator-adjacency walk. Returns null unless the
// caret is a genuine boundary caret (an ordinary mid-text caret never matches).
function $boundarySibling(caret, forward) {
  if (!caret) return null;
  const point = caret;
  const origin = caret.node;
  if (!origin) return null;
  if ($isElementNode(origin)) {
    if ((forward ? origin.getChildrenSize() : 0) !== point.offset) return null;
  } else {
    const size = typeof origin.getTextContentSize === 'function' ? origin.getTextContentSize() : (origin.getTextContent ? origin.getTextContent().length : 0);
    if ((forward ? size : 0) !== point.offset) return null;
  }
  let cur = origin;
  while (cur) {
    const parent = typeof cur.getParent === 'function' ? cur.getParent() : null;
    if (!parent) return null;
    const sib = forward ? cur.getNextSibling() : cur.getPreviousSibling();
    if (sib) return sib;
    cur = parent;
    if (typeof cur.getType === 'function' && cur.getType() === 'root') return null;
  }
  return null;
}
function protectedDecoratorArmedMessageKey(node) {
  if ($isTableNode(node)) return 'app.editor.table_selected_for_delete';
  if ($isImageNode(node)) return 'app.editor.image_selected_for_delete';
  if ($isGraphicNode(node)) return 'app.editor.graphic_selected_for_delete';
  if ($isPrintPageNode(node)) return 'app.editor.printpage_selected_for_delete';
  return 'app.editor.equation_selected_for_delete';   // $isMathNode -- the only remaining case
}
// Returns true (handled) when the boundary in the given direction is a protected decorator AND
// the selection is not already a NodeSelection on it (that second-press case is
// $deleteArmedProtectedDecorator, below).
// The key of the decorator the first press armed. A delete needs this exact arming: a table,
// picture or page number that became selected some other way (arrow keys, a click) is armed and
// announced by the first press too, never deleted by it. Cleared as soon as the selection moves.
let armedDecoratorKey = null;
// Where the caret was when the first press armed the item ({ key, offset, forward }), or null when it was armed from
// a node selection made some other way. A second press from that same caret deletes the item; any other move or edit
// cancels the arm. (Seen in Chrome, 28 Sep: a screen-reader user, who always waits for the announcement, could not
// delete the item when the second press depended on a node selection that Chrome had already dropped.)
let armedFrom = null;
function setArmedOutline(key) {
  document.querySelectorAll('.emboss-armed').forEach((el) => el.classList.remove('emboss-armed'));
  if (key != null) { const el = editor.getElementByKey(key); if (el) el.classList.add('emboss-armed'); }
}
function clearArm() { armedDecoratorKey = null; armedFrom = null; setArmedOutline(null); }
window.__armStateForTest = () => ({ key: armedDecoratorKey, from: armedFrom });
// Feedback 30 Sep item 9 (Paul, 1 Oct): a click on a picture, a tactile graphic or a table's bar selects it (a node selection,
// outlined), so Delete and Backspace work for a mouse user as they do from the keyboard — the first press says what is selected,
// the second removes it (the arming above). A click on a control, a table cell or a text box inside the card is left alone.
editorEl.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target : null;
  if (!el || el.closest('button, input, select, textarea, a, label, math-field, td, th, [contenteditable="true"]:not(#editor)')) return;
  const keyProp = `__lexicalKey_${editor.getKey()}`;
  let dom = el, key = null;
  while (dom && dom !== editorEl) { if (dom[keyProp] != null) { key = dom[keyProp]; break; } dom = dom.parentElement; }
  if (key == null) return;
  let picked = null;
  editor.update(() => {
    const n = $getNodeByKey(key);
    // Any card in the document — a picture, a graphic, a table (outside its cells), a ⁂ break, a print page marker … — not only
    // pictures, graphics and a table's bar (A89, found by random-action testing: a click on a break or a print page selected
    // nothing and, in WebKit, left the caret inside the card).
    // …and wherever it sits: a picture inside a box was not selected, and left the caret inside the card (A89, the nightly run).
    if (!n || !(n instanceof DecoratorNode) || n.isInline() || !n.getParent()) return;
    const ns = $createNodeSelection();
    ns.add(n.getKey());
    $setSelection(ns);
    picked = n;
  });
  if (!picked) return;
  clearArm();
  if (document.activeElement !== editorEl) editorEl.focus({ preventScroll: true });
  // WebKit keeps its own text caret where the click put it, inside the card, beside the node selection: take it out.
  const ds = window.getSelection();
  const cardEl = editor.getElementByKey(picked.getKey());
  if (ds && ds.rangeCount && cardEl && cardEl.contains(ds.anchorNode)) ds.removeAllRanges();
});
// The keys stay with the text (A89, found by random-action testing): a button on a card's bar re-rendered under the pointer, or a
// menu item that closes its menu (Braille › Download BRF), left the keyboard focus on the page itself, so the keys did nothing
// until the text was clicked again. After a click or a key, if the focus has fallen to the page while the caret (or a selected
// card) is still in the text and no dialog is open, the focus goes back to the text. And Backspace with the focus on the page
// never takes the browser "Back" (Playwright's WebKit did, leaving the editor).
// Where the keyboard last was: in the text (or something inside it — an equation, a card's control), or elsewhere.
let keysLastInText = false;
document.addEventListener('focusin', (e) => { keysLastInText = editorEl.contains(e.target); });
function rescueEditorFocus() {
  if (document.activeElement && document.activeElement !== document.body) return;
  if (document.querySelector('dialog[open]')) return;
  // nor while a menu or a list is open: it takes the focus a moment after it opens (Ctrl/⌘+Shift+F's Insert-field menu)
  if ([...document.querySelectorAll('[role="menu"], [role="listbox"], .menu-dropdown, .slash-menu')].some((m) => !m.hidden && m.getClientRects().length > 0)) return;
  const ds = window.getSelection();
  const caretInText = ds && ds.rangeCount > 0 && editorEl.contains(ds.anchorNode);
  let cardSelected = false;
  editor.getEditorState().read(() => { cardSelected = $isNodeSelection($getSelection()); });
  // …or, with no caret to go by (an equation's own caret is not the page's), when the keyboard was last in the text
  if (caretInText || cardSelected || keysLastInText) {
    editorEl.focus({ preventScroll: true });
    // A click on the page itself (the explanation bar, a blank area) took the page's caret away: the focus coming back put it at the start
    // of the document, where the next key acted (18 Oct 2026). It goes back where it was instead.
    if (!caretInText && !cardSelected && lastActiveEditorSelection) {
      const last = lastActiveEditorSelection;
      editor.update(() => {
        const a = $getNodeByKey(last.anchorKey), f = $getNodeByKey(last.focusKey);
        if (!a || !f) return;
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) { if ($isTextNode(a)) a.select(last.anchorOffset, a === f ? last.focusOffset : last.anchorOffset); return; }
        sel.anchor.set(last.anchorKey, last.anchorOffset, $isTextNode(a) ? 'text' : 'element');
        sel.focus.set(last.focusKey, last.focusOffset, $isTextNode(f) ? 'text' : 'element');
      });
    }
  }
}
// at once and again a moment later: a card's bar is re-rendered, and a download started, after the click itself
const rescueSoon = () => { setTimeout(rescueEditorFocus, 0); setTimeout(rescueEditorFocus, 450); };
document.addEventListener('click', rescueSoon);
document.addEventListener('keyup', rescueSoon);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && (!document.activeElement || document.activeElement === document.body)) e.preventDefault();
});
// A navigation key while a card is node-selected (Up/Down, Home/End, Page Up/Down, with or without Cmd/Ctrl) first puts the caret
// just after the card, then does its usual job — a selected picture otherwise swallowed Cmd+Down (end of document) and the typing
// after it. Left/Right are Lexical's own (they step off the card). Delete/Backspace are the arming above.
// Up/Down (no modifier) from a selected card go to the block below (above) it — into its text, or selecting it when it is a
// card too (a ⁂ break followed by a print page, item 19) — and Lexical does nothing more with the key.
editorEl.addEventListener('keydown', (e) => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
  const plainUpDown = (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
  let handled = false;
  editor.update(() => {
    const sel = $getSelection();
    if (!$isNodeSelection(sel)) return;
    const n = sel.getNodes()[0];
    if (!n) return;
    if (plainUpDown && n.getParent() && n.getParent().is($getRoot())) {
      const down = e.key === 'ArrowDown';
      const sib = down ? n.getNextSibling() : n.getPreviousSibling();
      if (sib && sib instanceof DecoratorNode) { const ns = $createNodeSelection(); ns.add(sib.getKey()); $setSelection(ns); handled = true; return; }
      if (sib && typeof sib.selectStart === 'function') { if (down) sib.selectStart(); else sib.selectEnd(); handled = true; return; }
    }
    if (typeof n.selectNext === 'function') n.selectNext(0, 0);
  }, { discrete: true });
  if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
// Up/Down in a paragraph that holds an equation (feedback 30 Sep, item 19). In WebKit (Safari) the caret could not leave a line
// with a MathLive <math-field> on it, to the next line or the next paragraph; in Chrome, with a ⁂ break and a print page after
// such a paragraph, it jumped to the end of the book. In such a paragraph Emboss moves the caret itself: to the next (previous)
// line at the same distance across, and off its last (first) line into the next (previous) paragraph, or onto a ⁂ break / print
// page as a node selection (as a click does), from which the next Down goes on below it (the handler above). In paragraphs
// without an equation the browser moves the caret as before.
function caretClientRect(range) {
  // Measured from the character after the caret (before it, at the end): a caret where a line wraps belongs to the line it is
  // shown on, while the collapsed range's own rectangle sits at the end of the line above, in Chrome.
  const c = range.startContainer, o = range.startOffset;
  if (c.nodeType === 3) {
    const x = document.createRange();
    if (o < c.length && c.data[o] !== '\n') {
      x.setStart(c, o); x.setEnd(c, o + 1);
      const xr = x.getClientRects()[0];
      if (xr && xr.height) return { left: xr.left, top: xr.top, bottom: xr.bottom };
    }
    if (o > 0) {
      x.setStart(c, o - 1); x.setEnd(c, o);
      const rs = x.getClientRects(); const xr = rs[rs.length - 1];
      if (xr && xr.height) return { left: xr.right, top: xr.top, bottom: xr.bottom };
    }
  }
  const r = range.getClientRects()[0];
  if (r && r.height) return r;
  const el = c.nodeType === 1 ? c : c.parentElement;
  return el ? el.getBoundingClientRect() : null;
}
// a caret position at (x, y) inside `box`, not inside an equation or a card
function caretPointIn(box, x, y) {
  let pos = null;
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) pos = { node: p.offsetNode, offset: p.offset }; }
  else if (document.caretRangeFromPoint) { const p = document.caretRangeFromPoint(x, y); if (p) pos = { node: p.startContainer, offset: p.startOffset }; }
  if (!pos || !box.contains(pos.node)) return null;
  const el = pos.node.nodeType === 1 ? pos.node : pos.node.parentElement;
  return el?.closest('math-field, .math-embed, [contenteditable="false"]') ? null : pos;
}
// The boxes of a block's lines: its text, and each equation as one box. Not Range.getClientRects of the whole block — Firefox
// includes every glyph inside an equation, and a raised one (∞ over a ∑) looked like a line above the caret (found by
// random-action testing: Up stuck after an equation in Firefox).
function lineRects(box) {
  const out = [];
  const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement?.closest('math-field, .math-embed') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const r = document.createRange();
  for (let t = w.nextNode(); t; t = w.nextNode()) { r.selectNodeContents(t); out.push(...r.getClientRects()); }
  for (const m of box.querySelectorAll('.math-embed')) out.push(m.getBoundingClientRect());
  return out.filter((x) => x.height > 0 && x.width > 0);
}
function placeCaret(pos) {
  const sel = window.getSelection();
  const r = document.createRange(); r.setStart(pos.node, pos.offset); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}
// Moves the caret one line down (up) from where it is, when that is Emboss's job (see above); false when the browser should.
// With `extend` (Shift+Down / Shift+Up) the selection's moving end goes one line instead: the browser's own Shift+Down past an
// equation took the selection to the end of the book in Chrome, and could not get past it in WebKit (A89, random-action testing).
function moveCaretVertically(down, extend = false) {
  const sel = window.getSelection();
  if (!sel.rangeCount || (!extend && !sel.isCollapsed) || !editorEl.contains(sel.focusNode)) return false;
  const put = (node, offset) => { if (extend) sel.extend(node, offset); else placeCaret({ node, offset }); };
  const at = sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement;
  // Inside the equation's own field the key is MathLive's. A caret Lexical puts beside an equation can sit on the equation's
  // wrapper (.math-embed); that is the paragraph's caret, not the equation's (A89: Up stuck there after an equation-only paragraph).
  if (at?.closest('math-field')) return false;
  const li = at?.closest('li');
  const unit = li && editorEl.contains(li) ? li : at?.closest('#editor > *');
  if (!unit) return false;
  const step = (el) => (down ? el.nextElementSibling : el.previousElementSibling);
  const nextBlock = (u) => { let t = step(u); if (!t && u.tagName === 'LI') { const top = u.closest('#editor > *'); t = top && step(top); } return t; };
  // A paragraph with an equation, or the line next to one: off a plain paragraph's last (first) line into a paragraph with an
  // equation, Chrome skipped a paragraph that is only an equation (A89, random-action testing).
  const ownMath = !!unit.querySelector('math-field');
  // …or a card (a print page, a ⁂ break, a table, a picture) next: the browsers skipped past a run of cards (Chrome, Firefox),
  // left the caret between them, or did not move at all (WebKit) — found by random-action testing (A89). The card is selected,
  // as a click does, and the next key goes on from it (the handler above).
  const next = nextBlock(unit);
  const nextIsCard = !!next && (next.getAttribute('data-lexical-decorator') === 'true' || next.getAttribute('contenteditable') === 'false');
  if (!ownMath && !nextIsCard && !next?.querySelector?.('math-field')) return false;
  // positions are found by point, which needs the paragraph on screen
  const ub0 = unit.getBoundingClientRect();
  if (ub0.top < 0 || ub0.bottom > window.innerHeight) unit.scrollIntoView({ block: 'nearest' });
  const range = document.createRange(); range.setStart(sel.focusNode, sel.focusOffset); range.collapse(true);
  const embed = at?.closest('.math-embed');
  const caret = embed ? embed.getBoundingClientRect() : caretClientRect(range);
  if (!caret) return false;
  // the next (previous) line of this paragraph, if there is one
  const rects = lineRects(unit);
  const beyond = rects.filter((r) => (down ? r.top >= caret.bottom - 1 : r.bottom <= caret.top + 1));
  if (!ownMath && beyond.length) return false;   // inside a plain paragraph the browser moves the caret, as before
  if (beyond.length) {
    const edge = down ? Math.min(...beyond.map((r) => r.top)) : Math.max(...beyond.map((r) => r.bottom));
    const line = beyond.filter((r) => (down ? r.top < edge + 4 : r.bottom > edge - 4));
    const textLine = line.reduce((a, r) => (!a || r.height < a.height ? r : a), null);
    const y = (textLine.top + textLine.bottom) / 2;
    const ub = unit.getBoundingClientRect();
    const pos = caretPointIn(unit, caret.left, y) || caretPointIn(unit, ub.left + 2, y) || caretPointIn(unit, ub.right - 2, y);
    if (pos) { put(pos.node, pos.offset); return true; }
  }
  // off the paragraph: the next (previous) block
  const target = nextBlock(unit);
  if (!target) return true;
  const keyProp = `__lexicalKey_${editor.getKey()}`;
  target.scrollIntoView({ block: 'nearest' });
  if (target.getAttribute('data-lexical-decorator') === 'true' || target.getAttribute('contenteditable') === 'false') {
    if (extend) { sel.extend(editorEl, [...editorEl.children].indexOf(target) + (down ? 1 : 0)); return true; }   // the whole card
    const key = target[keyProp];
    if (key != null) editor.update(() => { const n = $getNodeByKey(key); if (!n) return; const ns = $createNodeSelection(); ns.add(n.getKey()); $setSelection(ns); }, { discrete: true });
    return true;
  }
  const tr = target.getBoundingClientRect();
  const tRects = lineRects(target);
  const first = tRects.length ? (down ? tRects.reduce((a, r) => (r.top < a.top ? r : a)) : tRects.reduce((a, r) => (r.bottom > a.bottom ? r : a))) : tr;
  const y = (first.top + first.bottom) / 2;
  const x = Math.min(Math.max(caret.left, tr.left + 1), tr.right - 2);
  const pos = caretPointIn(target, x, y) || caretPointIn(target, tr.left + 2, y);
  if (pos) { put(pos.node, pos.offset); return true; }
  if (extend) { put(target, down ? 0 : target.childNodes.length); return true; }
  let key = null; for (let d = target; d && d !== editorEl && key == null; d = d.firstElementChild) key = d[keyProp] ?? null;
  editor.update(() => { const n = key != null ? $getNodeByKey(key) : null; if (n && typeof n.selectStart === 'function') { if (down) n.selectStart(); else n.selectEnd(); } }, { discrete: true });
  return true;
}
editorEl.addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  if (e.target !== editorEl) return;   // a math-field or a card's own control has the key
  if (moveCaretVertically(e.key === 'ArrowDown', e.shiftKey)) {
    e.preventDefault();
    e.stopImmediatePropagation();   // Lexical's own arrow handling would move on again from where this puts the caret
  }
}, true);
// Pasting (A89 step 3, found by random-action testing in Chrome and WebKit): Lexical's own rich-text paste threw "Expected node
// to have a parent" pasting formatted text at the very start of a heading, and the pasted words were lost. Emboss now runs the
// paste itself — exactly what Lexical's rich-text paste does — and if Lexical reports an error (it discards the failed change),
// pastes the clipboard's plain text at the caret instead: the words always arrive, only their formatting can be lost. With no caret
// in the text at all, the paste goes to the end of the document (as Word and Google Docs do when nothing was clicked). Pastes into
// a table cell, an equation or a description box are theirs, and a paste of files only (no text) is left to Lexical, as before.
editor.registerCommand(PASTE_COMMAND, (event) => {
  const dt = event && event.clipboardData;
  if (!dt) return false;
  const tgt = event.target && event.target.nodeType === 1 ? event.target : event.target?.parentElement;
  if (tgt && tgt !== editorEl && (tgt.closest('input, textarea, math-field') || (tgt.closest('[contenteditable="true"]') && tgt.closest('[contenteditable="true"]') !== editorEl))) return false;
  const text = dt.getData('text/plain') || '';
  if (!text && !dt.getData('text/html') && dt.files && dt.files.length) return false;
  event.preventDefault();
  // A command runs inside Lexical's own update, where a failure surfaces only after this returns; so the clipboard is copied now
  // and the paste done as an update of its own straight after, where a failure can be seen and the document put back.
  const data = {};
  for (const type of ['application/x-lexical-editor', 'text/html', 'text/plain', 'text/uri-list']) { try { const v = dt.getData(type); if (v) data[type] = v; } catch { /* not offered */ } }
  const copy = { types: Object.keys(data), files: [], getData: (type) => data[type] || '' };
  setTimeout(() => {
    const before = lexicalErrorCount;
    const logged = problemCount();   // Lexical can catch an insert's failure itself, log it with console.error and carry on half-done
    const saved = editor.getEditorState();
    let threw = null;
    try {
      editor.update(() => {
        let sel = $getSelection();
        if (!sel) {
          const root = $getRoot();
          const last = root.getLastChild();
          if (last && last instanceof ElementNode && !last.isInline()) last.selectEnd();
          else { const p = $createParagraphNode(); root.append(p); p.select(); }
          sel = $getSelection();
        }
        // At the very start of a paragraph or heading that has text, Lexical's own insert of pasted paragraphs fails ("Expected
        // node to have a parent": it splits the block in two and loses the empty first half). Paste into a new empty paragraph just
        // before the block instead — what a word processor does — and drop it again if the paste left it empty.
        let spare = null;
        if ($isRangeSelection(sel) && sel.isCollapsed() && sel.anchor.offset === 0) {
          const top = sel.anchor.getNode().getTopLevelElement();
          const first = top && top.getFirstDescendant ? top.getFirstDescendant() : null;
          const atStart = top && top instanceof ElementNode && top.getTextContentSize() > 0 && (first === sel.anchor.getNode() || top.is(sel.anchor.getNode()));
          if (atStart) { spare = $createParagraphNode(); top.insertBefore(spare); spare.select(); sel = $getSelection(); }
        }
        $insertDataTransferForRichText(copy, sel, editor);
        if (spare && spare.isAttached() && spare.getTextContentSize() === 0 && spare.getChildrenSize() === 0) spare.remove();
      }, { discrete: true, tag: 'paste' });
    } catch (e) { threw = e; }
    const newProblems = problemCount() - logged;
    const lexicalLogged = newProblems > 0 && problemLog().slice(-newProblems).some((p) => /Lexical/.test(p.message));
    if (threw || lexicalErrorCount !== before || lexicalLogged) {
      recordProblem('paste', `The formatted paste failed (${threw?.message || 'Lexical error'}); pasted as plain text instead`, { stack: threw?.stack || '' });
      editor.setEditorState(saved);
      if (text) editor.update(() => { const sel = $getSelection(); if ($isRangeSelection(sel)) sel.insertRawText(text); }, { discrete: true, tag: 'paste' });
    }
  }, 0);
  return true;
}, COMMAND_PRIORITY_HIGH);
// A letter typed inside a formatted run joins it — its typeform (italic, bold …) and its marks (ignore-font, hyperlink …) — in
// every browser, as in Word (Paul, 2 Oct, A89: "inside"). Lexical types with the selection's own format and style, which Chrome
// (and WebKit for a typeform run) left empty for a caret moved into the middle of a run, so the letter split it: "mar" + "y" +
// "ked", the y plain — and the braille differed by browser. Just before text goes in, a collapsed caret strictly inside a text
// run takes that run's format and style. At a run's edge Lexical's own rule (the run before the caret) is unchanged.
editorEl.addEventListener('beforeinput', (e) => {
  if (e.isComposing || (e.inputType !== 'insertText' && e.inputType !== 'insertReplacementText')) return;
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel) || !sel.isCollapsed() || sel.anchor.type !== 'text') return;
    const n = sel.anchor.getNode();
    const off = sel.anchor.offset;
    if (!(n instanceof TextNode) || off <= 0 || off >= n.getTextContentSize()) return;
    if (sel.format !== n.getFormat()) sel.format = n.getFormat();
    if (sel.style !== n.getStyle()) sel.style = n.getStyle();
  }, { discrete: true });
}, true);
// The node-selected card is outlined (class emboss-selected), and the outline goes when the selection moves.
editor.registerUpdateListener(({ editorState }) => {
  const keys = editorState.read(() => { const sel = $getSelection(); return $isNodeSelection(sel) ? sel.getNodes().map((n) => n.getKey()) : []; });
  document.querySelectorAll('#editor .emboss-selected').forEach((x) => { if (!keys.includes(x[`__lexicalKey_${editor.getKey()}`])) x.classList.remove('emboss-selected'); });
  for (const k of keys) { const x = editor.getElementByKey(k); if (x) x.classList.add('emboss-selected'); }
});
function $armProtectedDecorator(target, from = null) {
  // Armed from a caret: the caret stays where it is (the outline and the announcement say what is armed). Switching
  // to a node selection here made real Chrome lose the caret on the next click, so the next key acted at the start
  // of the document (28 Sep). An item that is already node-selected (arrow keys, a click on it) stays selected.
  if (!from) {
    const nodeSelection = $createNodeSelection();
    nodeSelection.add(target.getKey());
    $setSelection(nodeSelection);
  }
  armedDecoratorKey = target.getKey();
  armedFrom = from;
  queueMicrotask(() => setArmedOutline(armedDecoratorKey));   // after the DOM is reconciled
  announce(t(protectedDecoratorArmedMessageKey(target)));
}
const caretOf = (sel) => ($isRangeSelection(sel) && sel.isCollapsed() ? { key: sel.anchor.key, offset: sel.anchor.offset, node: sel.anchor.getNode() } : null);
const sameCaret = (c) => !!(c && armedFrom && c.key === armedFrom.key && c.offset === armedFrom.offset);
const atArmedCaret = (sel) => sameCaret(caretOf(sel));
// The caret as the page shows it. Lexical takes its caret from the browser's selectionchange event, which can arrive
// after a quick next key (Home then Backspace a few milliseconds apart, seen in Chrome 28 Sep), so a Backspace or Delete
// reads it from the page itself. Null when the page's selection is not a collapsed caret in this editor's text.
function $domCaret() {
  const ds = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
  if (!ds || !ds.rangeCount || !ds.isCollapsed || !ds.anchorNode) return null;
  const dom = ds.anchorNode;
  const el = dom.nodeType === 3 ? dom.parentNode : dom;
  const key = el ? el[`__lexicalKey_${editor.getKey()}`] : null;
  const node = key != null ? $getNodeByKey(key) : null;
  if (!node) return null;
  if (dom.nodeType === 3) return node instanceof TextNode && ds.anchorOffset <= node.getTextContentSize() ? { key, offset: ds.anchorOffset, node } : null;
  return $isElementNode(node) && ds.anchorOffset <= node.getChildrenSize() ? { key, offset: ds.anchorOffset, node } : null;
}
function $armProtectedDecoratorOnBoundary(selection, caret, forward) {
  if ($isNodeSelection(selection)) return false;   // a selected decorator: handled below
  const sib = $boundarySibling(caret, forward);
  if (!sib) return false;
  const target = $resolveProtectedDecorator(sib, forward);
  if (!target) return false;
  $armProtectedDecorator(target, { key: caret.key, offset: caret.offset, forward });
  return true;
}
// The second Backspace/Delete, now that a protected decorator is NodeSelection'd. Lexical's own
// registerRichText DELETE_CHARACTER_COMMAND handler already does `selection.deleteNodes()` for a
// NodeSelection, which would be enough on its own -- but a block-level equation lives alone inside
// its OWN wrapping paragraph (appendBlock's top-level 'math' case builds `p.append($createMathNode(...))`
// then appends `p`), so deleting just the MathNode leaves that now-empty paragraph behind as a
// stray blank line. Handled here instead, at the same COMMAND_PRIORITY_HIGH as the arming step
// above, so the whole two-press gesture is one clean codepath: remove the wrapper too when the
// decorator was its only content, and land the caret on whichever neighbour is left.
function $removeProtectedDecorator(node) {
  clearArm();
  const parent = node.getParent();
  const wrapperIsMathOnly = $isMathNode(node) && parent instanceof ParagraphNode && parent.getChildrenSize() === 1;
  const target = wrapperIsMathOnly ? parent : node;
  const prev = target.getPreviousSibling();
  const next = target.getNextSibling();
  target.remove();
  if (prev && typeof prev.selectEnd === 'function') prev.selectEnd();
  else if (next && typeof next.selectStart === 'function') next.selectStart();
}
function $deleteArmedProtectedDecorator(selection, caret, forward) {
  // The caret is still where the first press armed the item: this press is the second one.
  if (sameCaret(caret) && armedFrom.forward === forward) {
    const node = $getNodeByKey(armedDecoratorKey);
    if (node && $isProtectedDecoratorNode(node)) { $removeProtectedDecorator(node); return true; }
    clearArm();
    return false;
  }
  if (!$isNodeSelection(selection)) return false;
  const nodes = selection.getNodes();
  if (nodes.length !== 1 || !$isProtectedDecoratorNode(nodes[0])) return false;
  const node = nodes[0];
  if (node.getKey() !== armedDecoratorKey) { $armProtectedDecorator(node); return true; }   // selected, but not armed by a first press
  $removeProtectedDecorator(node);
  return true;
}
for (const CMD of [KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND]) {
  editor.registerCommand(CMD, (event) => {
    const sel = $getSelection();
    const forward = CMD === KEY_DELETE_COMMAND;
    // Lexical takes its caret from the browser's selectionchange event, which can arrive after a quick next key or
    // click (seen in Chrome, 28 Sep): bring it to where the page shows the caret first, so neither this handler nor
    // Lexical's own delete acts at the old spot.
    const pageCaret = $isRangeSelection(sel) ? $domCaret() : null;
    if (pageCaret && (!sel.isCollapsed() || sel.anchor.key !== pageCaret.key || sel.anchor.offset !== pageCaret.offset)) {
      const type = pageCaret.node instanceof TextNode ? 'text' : 'element';
      sel.anchor.set(pageCaret.key, pageCaret.offset, type);
      sel.focus.set(pageCaret.key, pageCaret.offset, type);
    }
    if ($clampSelectionToContainerBoundary(sel)) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();   // stop the browser's own native contenteditable deletion too, not just Lexical's
      sel.removeText();
      return true;   // handled: stop registerRichText's own default from ALSO running
    }
    const caret = caretOf(sel);
    if ($deleteArmedProtectedDecorator(sel, caret, forward)) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      return true;   // handled: the second press removes the armed decorator (or a first press arms one selected another way)
    }
    if ($armProtectedDecoratorOnBoundary(sel, caret, forward)) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      return true;   // handled: the first press only selects the decorator, never deletes it
    }
    return false;   // neither case applies: let the normal handler run
  }, COMMAND_PRIORITY_HIGH);
}

// The arm lasts while the item is still selected, or while the caret is back where it armed (see armedFrom); any
// other move, a change to the document, or the item's removal cancels it.
editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
  if (armedDecoratorKey == null) return;
  editorState.read(() => {
    const sel = $getSelection();
    const stillSelected = $isNodeSelection(sel) && sel.has(armedDecoratorKey);
    const contentChanged = dirtyLeaves.size > 0 || [...dirtyElements.keys()].some((k) => k !== 'root');
    if (!$getNodeByKey(armedDecoratorKey) || (!stillSelected && !atArmedCaret(sel)) || (contentChanged && !stillSelected)) clearArm();
  });
});

// ---- Auto-remove an emptied box/tnpage/sympage. A SidebarNode/TnPageNode/SymPageNode is an
// ordinary ElementNode with no canBeEmpty()/collapseAtStart() override, so once the boundary-clamp
// above stops it adopting a neighbour's content, Lexical's own default Backspace/Delete leaves it
// sitting there empty rather than removing it (the other half of the same bug report). Rather than
// trying to special-case every keyboard path into these containers, this instead watches every
// update for one whose container just LOST its last content (compares against prevEditorState, so
// a freshly-inserted, still-empty page — insertTnPage()'s placeholder entry, insertSidebar()'s
// heading+placeholder are never empty at birth anyway — is never touched: it was never "non-empty
// a moment ago") and removes it in the same update, tagged 'history-merge' (same pattern as the
// SymPage auto-sync below) so Undo restores the box and its last content in one step, not two.
// The caret goes to the end of the block that is now just before it (or the start of the block
// after, if the container was the document's first block).
// "Empty" = no real content anywhere inside: no non-blank text, and no picture/table/equation/etc.
// (a container holding only a picture, say, is not "empty" even though getTextContent() is '').
function $isContainerEmpty(node) {
  if (node.getTextContent().replace(/[\s ]+/g, '') !== '') return false;
  const stack = node.getChildren();
  for (let i = 0; i < stack.length; i++) {
    const n = stack[i];
    if (n instanceof DecoratorNode) return false;
    if (typeof n.getChildren === 'function') stack.push(...n.getChildren());
  }
  return true;
}
function containerRemovedMessageKey(node) {
  if ($isTnPageNode(node)) return 'app.editor.tnpage_auto_removed';
  if ($isSymPageNode(node)) return 'app.editor.sympage_auto_removed';
  if ($isTitlePageNode(node)) return 'app.editor.titlepage_auto_removed';
  return 'app.editor.box_auto_removed';
}
editor.registerUpdateListener(({ editorState, prevEditorState, dirtyElements, dirtyLeaves, tags }) => {
  if (tags.has('emboss-skip-empty-container-check')) return;
  if (!dirtyElements.size && !dirtyLeaves.size) return;
  const candidateKeys = new Set();
  editorState.read(() => {
    const dirtyKeys = [...dirtyElements.keys(), ...dirtyLeaves];
    for (const key of dirtyKeys) {
      let n = $getNodeByKey(key);
      while (n) {
        if ($isEmbossContainerNode(n)) { candidateKeys.add(n.getKey()); break; }
        n = n.getParent ? n.getParent() : null;
      }
    }
  });
  if (!candidateKeys.size) return;
  const toRemove = [];   // [{ key, msgKey }]
  editorState.read(() => {
    for (const key of candidateKeys) {
      const node = $getNodeByKey(key);
      if (!node || !$isContainerEmpty(node)) continue;
      // An automatic Special Symbols page ($isSymPageNode && getAuto()) legitimately passes
      // through a transiently-empty state of its own: regenerateSymPage() clears it back to one
      // empty paragraph before syncSymPages (called from render(), a moment later) refills it
      // from the document's actual symbols. That is not a user emptying real content — it must
      // never be treated as one, or "Regenerate" would delete the page out from under itself.
      if ($isSymPageNode(node) && node.getAuto()) continue;
      let wasNonEmpty = false;
      try {
        prevEditorState.read(() => {
          const prev = $getNodeByKey(key);
          wasNonEmpty = !!prev && $isEmbossContainerNode(prev) && !$isContainerEmpty(prev);
        });
      } catch (_) {}
      if (wasNonEmpty) toRemove.push({ key, msgKey: containerRemovedMessageKey(node) });
    }
  });
  if (!toRemove.length) return;
  let announceMsg = null;
  // Called from inside a registerUpdateListener callback, editor.update() here does not commit
  // synchronously (Lexical defers a nested/re-entrant update to its own microtask) — so the
  // announce() call must happen in the onUpdate callback, not straight after this call returns
  // (which was tried first: announceMsg was always still null at that point).
  editor.update(() => {
    for (const { key, msgKey } of toRemove) {
      const node = $getNodeByKey(key);
      if (!node || !$isEmbossContainerNode(node)) continue;
      const prev = node.getPreviousSibling();
      const next = node.getNextSibling();
      node.remove();
      if (prev && typeof prev.selectEnd === 'function') prev.selectEnd();
      else if (next && typeof next.selectStart === 'function') next.selectStart();
      announceMsg = t(msgKey);   // last one wins if several were removed in the same update, same as elsewhere in this file
    }
  }, { tag: 'history-merge', onUpdate: () => { if (announceMsg) announce(announceMsg); } });
});

editor.registerUpdateListener(({ editorState, dirtyElements, tags }) => refreshListMarkers(editorState, dirtyElements, tags));

// Special Symbols page (SymPageNode): (1) the transcriber editing an entry of an automatic page turns
// `auto` off (the children no longer match what the last sync wrote), so the entries are saved
// explicitly from then on; (2) syncSymPages, called by render() with the fresh model, rewrites an
// untouched automatic page from the document's symbols and marks an edited page whose list has
// symbols it lacks (data-stale; the CSS shows the note). Both use 'history-merge' so undo stays one step.
editor.registerUpdateListener(({ editorState }) => {
  const flip = [];
  editorState.read(() => {
    for (const c of $getRoot().getChildren()) {
      if ($isSymPageNode(c) && c.getAuto() && JSON.stringify($symNodeEntries(c)) !== c.getSig()) flip.push(c.getKey());
    }
  });
  if (!flip.length) return;
  editor.update(() => {
    for (const k of flip) { const n = $getNodeByKey(k); if ($isSymPageNode(n)) n.setAuto(false); }
  }, { tag: 'history-merge' });
});
function syncSymPages(model) {
  const targets = (model.blocks || []).filter((b) => b && b.type === 'sympage' && b._key);
  if (!targets.length) return;
  const derived = symDerivedEntries(model.blocks);
  const dsig = JSON.stringify(derived);
  const need = [];
  editor.getEditorState().read(() => {
    for (const b of targets) {
      const n = $getNodeByKey(b._key);
      if (!$isSymPageNode(n)) continue;
      const cur = JSON.stringify($symNodeEntries(n));
      const el = editor.getElementByKey(b._key);
      if (n.getAuto()) { if (cur === n.getSig() && cur !== dsig) need.push(b._key); }
      else if (el) {
        const have = new Set($symNodeEntries(n).map((e) => e.braille));
        const stale = derived.some((d) => d.braille && !have.has(d.braille));
        const next = stale ? '1' : '';
        if ((el.dataset.stale || '') !== next) { el.dataset.stale = next; el.dataset.staleNote = tOr('app.editor.sympage_stale_note', 'Symbols changed since you edited this page.'); }
      }
    }
  });
  if (!need.length) return;
  editor.update(() => {
    for (const k of need) {
      const n = $getNodeByKey(k);
      if (!$isSymPageNode(n)) continue;
      $fillSymPage(n, derived);
      n.setSig(JSON.stringify($symNodeEntries(n)));
    }
  }, { tag: 'history-merge' });
}
// Turn an edited Special Symbols page back into an automatic one (the 'regenerate' action). One undo step:
// the update below and the render's own history-merge refill (syncSymPages) share one history entry.
function regenerateSymPage(key) {
  let done = false;
  editor.update(() => {
    const n = key ? $getNodeByKey(key) : $getRoot().getChildren().find($isSymPageNode);
    if (!$isSymPageNode(n)) return;
    $fillSymPage(n, []);
    n.setSig('[]');
    n.setAuto(true);
    done = true;
  }, { discrete: true });
  scheduleRender();
  if (done) announce(t('app.editor.sympage_regenerated'));
  return done;
}
// The toolbar button: shown when the document has a Special Symbols page, enabled only when the page the cursor is
// in (else the first one) is explicit. It lives in the toolbar, outside the editable root, so Lexical never sees it.
function symRegenTarget(state) {
  return state.read(() => {
    const pages = $getRoot().getChildren().filter($isSymPageNode);
    if (!pages.length) return { any: false, key: null, explicit: false };
    let page = null;
    const sel = $getSelection();
    if ($isRangeSelection(sel)) { for (let n = sel.anchor.getNode(); n; n = n.getParent()) if ($isSymPageNode(n)) { page = n; break; } }
    page = page || pages.find((p) => !p.getAuto()) || pages[0];
    return { any: true, key: page.getKey(), explicit: !page.getAuto() };
  });
}
function updateSymRegenBtn() {
  const btn = $id('btnSymRegen');
  if (!btn) return;
  const r = symRegenTarget(editor.getEditorState());
  btn.hidden = !r.any || !transcriberToolsOn();   // a transcriber tool: hidden while Transcriber tools is off (the page itself stays)
  btn.disabled = !r.explicit;
}
editor.registerUpdateListener(() => updateSymRegenBtn());
$id('btnSymRegen')?.addEventListener('click', () => { const r = symRegenTarget(editor.getEditorState()); if (r.explicit) regenerateSymPage(r.key); });
window.regenerateSymPage = regenerateSymPage;

// Title Page (TitlePageNode): the transcriber typing on the page (adding/deleting/retyping a line —
// anything that changes the STRUCTURAL signature, field values excluded, TP-6) turns `auto` off, same
// trigger/shape as SymPageNode's own listener just above. syncTitlePages (called by render(), below)
// keeps an auto page's fields live and (only while still auto) refilled from the document; an edited
// page instead gets its existing chips' VALUES refreshed in place, never its structure — see that
// function's own comment.
editor.registerUpdateListener(({ editorState }) => {
  const flip = [];
  editorState.read(() => {
    for (const c of $getRoot().getChildren()) {
      if ($isTitlePageNode(c) && c.getAuto() && titlePageStructureSig($titlePageSegments(c)) !== c.getSig()) flip.push(c.getKey());
    }
  });
  if (!flip.length) return;
  editor.update(() => {
    for (const k of flip) { const n = $getNodeByKey(k); if ($isTitlePageNode(n)) n.setAuto(false); }
  }, { tag: 'history-merge' });
});
function syncTitlePages(model) {
  const targets = (model.blocks || []).filter((b) => b && b.type === 'titlepage' && b._key);
  if (!targets.length) return;
  const fields = titlePageFieldsFrom(tpCurrentModel());
  // Filtered to lines-that-actually-exist, matching $fillTitlePage's OWN rule ("no lines" segments,
  // e.g. an empty Publisher and copyright, are never appended to the node) — comparing against the
  // unfiltered array here would never match the rendered content and refill in an endless loop.
  const freshSegments = titlePageTemplateSegments(fields, undefined, tpMode()).filter((s) => s && Array.isArray(s.lines) && s.lines.length);
  const freshFullJson = JSON.stringify(freshSegments);
  const freshSig = titlePageStructureSig(freshSegments);
  const need = [];          // auto pages whose live field values moved on: full refill
  const fieldUpdates = [];  // edited pages: [{ key: TpFieldNode key, value }] — values only, never structure
  editor.getEditorState().read(() => {
    for (const b of targets) {
      const n = $getNodeByKey(b._key);
      if (!$isTitlePageNode(n)) continue;
      if (n.getAuto()) {
        // Still auto (the flip-listener above would have turned it off on any real edit): a full
        // refill here can only be catching up with the document's own fields, never discarding
        // anything the transcriber typed — same reasoning as syncSymPages' own refill.
        if (JSON.stringify($titlePageSegments(n)) !== freshFullJson) need.push(b._key);
        continue;
      }
      // Edited page (TP-6 "fields stay live" on an edited page too, exactly as format/document.mjs's
      // traceTitlePage now does for the braille — field-registry.mjs's refreshTitlePageValues is the
      // ONE function both use): each chip's own field name AND index (K29 Stage 1c rework) says which
      // value it wants, so this is correct even if a list field (authors/isbn) has grown or shrunk
      // since the page was last saved — no more "only if the whole chip sequence still lines up".
      const current = $titlePageSegments(n);
      const refreshed = refreshTitlePageValues(current, fields, fields);
      const currentChips = [], refreshedValues = [];
      current.forEach((seg, si) => seg.lines.forEach((l, li) => l.parts.forEach((part, pi) => { if ('fld' in part) { currentChips.push({ si, li, pi }); refreshedValues.push(refreshed[si].lines[li].parts[pi].value); } })));
      // Map each logical (segment,line,part) position back to its live TpFieldNode, in the SAME
      // document order $titlePageSegments walked them in.
      const nodeChips = [];
      for (const seg of n.getChildren()) { if (!$isTpSegmentNode(seg)) continue; for (const p of seg.getChildren()) { if (!(p instanceof ParagraphNode)) continue; for (const ch of p.getChildren()) if ($isTpFieldNode(ch)) nodeChips.push(ch); } }
      nodeChips.forEach((ch, i) => { if (i < refreshedValues.length && ch.getFieldValue() !== refreshedValues[i]) fieldUpdates.push({ key: ch.getKey(), value: refreshedValues[i] }); });
    }
  });
  if (need.length) {
    editor.update(() => {
      for (const k of need) {
        const n = $getNodeByKey(k);
        if (!$isTitlePageNode(n)) continue;
        $fillTitlePage(n, freshSegments);
        n.setSig(freshSig);
      }
    }, { tag: 'history-merge' });
  }
  if (fieldUpdates.length) {
    editor.update(() => {
      for (const { key, value } of fieldUpdates) {
        const n = $getNodeByKey(key);
        if ($isTpFieldNode(n)) n.setTextContent(value || TP_FIELD_EMPTY);
      }
    }, { tag: 'history-merge' });
  }
}
// Turn an edited Title Page back into an automatic one (the 'Regenerate' action) — one undo step,
// same pattern as regenerateSymPage.
function regenerateTitlePage(key) {
  let done = false;
  editor.update(() => {
    const n = key ? $getNodeByKey(key) : $getRoot().getChildren().find($isTitlePageNode);
    if (!$isTitlePageNode(n)) return;
    const segments = titlePageTemplateSegments(titlePageFieldsFrom(tpCurrentModel()), undefined, tpMode());
    $fillTitlePage(n, segments);
    n.setSig(titlePageStructureSig(segments));
    n.setAuto(true);
    done = true;
  }, { discrete: true });
  scheduleRender();
  if (done) announce(t('app.editor.titlepage_regenerated'));
  return done;
}
function titlePageRegenTarget(state) {
  return state.read(() => {
    const pages = $getRoot().getChildren().filter($isTitlePageNode);
    if (!pages.length) return { any: false, key: null, explicit: false };
    let page = null;
    const sel = $getSelection();
    if ($isRangeSelection(sel)) { for (let n = sel.anchor.getNode(); n; n = n.getParent()) if ($isTitlePageNode(n)) { page = n; break; } }
    page = page || pages.find((p) => !p.getAuto()) || pages[0];
    return { any: true, key: page.getKey(), explicit: !page.getAuto() };
  });
}
function updateTitlePageRegenBtn() {
  const btn = $id('btnTitlepageRegen');
  if (!btn) return;
  const r = titlePageRegenTarget(editor.getEditorState());
  btn.hidden = !r.any || !transcriberToolsOn();
  btn.disabled = !r.explicit;
}
editor.registerUpdateListener(() => updateTitlePageRegenBtn());
$id('btnTitlepageRegen')?.addEventListener('click', () => { const r = titlePageRegenTarget(editor.getEditorState()); if (r.explicit) regenerateTitlePage(r.key); });
window.regenerateTitlePage = regenerateTitlePage;

// ---- K29 Stage 1d: "Insert field" (design §4) — a field chip put at the CURSOR inside a title page
// line (a ParagraphNode that is a direct child of a TpSegmentNode), reached from the card's own toolbar
// button, the slash menu, or Ctrl/⌘+Shift+F. Inserting a chip changes the page's STRUCTURE, so the same
// update listener that already watches for a typed edit (above) turns `auto` off for it, exactly as
// typing a new line would (TP-6) — no separate handling needed here.
// $titlePageLineTarget(): read-only, must run inside an editor.read()/update() callback — returns true
// when the (collapsed) selection is inside such a line, false otherwise (no line, or a range selection).
function $titlePageLineTarget() {
  const sel = $getSelection();
  if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
  let node = sel.anchor.getNode();
  let para = node instanceof ParagraphNode ? node : null;
  if (!para) { for (let n = node; n; n = (typeof n.getParent === 'function' ? n.getParent() : null)) { if (n instanceof ParagraphNode) { para = n; break; } } }
  if (!para) return false;
  return $isTpSegmentNode(para.getParent());
}
function titlePageInsertFieldTarget(state) { return { available: state.read(() => $titlePageLineTarget()) }; }
// Puts a field chip (its CURRENT value, field-registry.mjs's tpFieldCurrentValue — the same rule
// titlePageTemplateSegments itself uses) at the cursor. List fields (authors/isbn) default to their
// first entry (see tpFieldCurrentValue's own comment). Returns false (and announces where to put the
// caret) when there is nowhere to insert.
function insertTitlePageField(fld, idx) {
  let inserted = null;
  editor.update(() => {
    if (!$titlePageLineTarget()) return;
    const sel = $getSelection();
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
    const fields = titlePageFieldsFrom(tpCurrentModel());
    const value = tpFieldCurrentValue(fields, undefined, fld, idx);
    sel.insertNodes([$createTpFieldNode(value, fld, idx ?? null)]);
    inserted = { field: fld, value };
  }, { discrete: true });
  if (inserted) {
    const label = TP_FIELD_LABELS[inserted.field] || inserted.field;
    // design §4: "A screen reader announces a chip as, for example, 'Print pages, field, i-x and 1-44'" —
    // the same announcement an inserted chip gets here, so insertion is confirmed the same way reading one is.
    announce(t('app.titlepage_card.field_inserted', { label, value: inserted.value || '' }) || `Inserted ${label} field: ${inserted.value || ''}.`);
    scheduleRender();
  } else {
    announce(t('app.editor.titlepage_insertfield_none') || 'Place the caret in a Title Page line first.');
  }
  return !!inserted;
}
function updateTpInsertFieldBtn() {
  const btn = $id('btnTpInsertField');
  if (!btn) return;
  const show = transcriberToolsOn() && titlePageInsertFieldTarget(editor.getEditorState()).available;
  btn.hidden = !show;
  if (!show) closeTpInsertFieldMenu();
}
editor.registerUpdateListener(() => updateTpInsertFieldBtn());
function renderTpInsertFieldMenu() {
  const menu = $id('tpInsertFieldMenu');
  if (!menu) return;
  menu.innerHTML = '';
  for (const fld of tpInsertableFields(tpMode())) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.className = 'menu-dropdown-item';
    item.textContent = TP_FIELD_LABELS[fld] || fld;
    item.addEventListener('click', () => { closeTpInsertFieldMenu(); insertTitlePageField(fld); });
    menu.appendChild(item);
  }
}
function openTpInsertFieldMenu() {
  const menu = $id('tpInsertFieldMenu'), btn = $id('btnTpInsertField');
  if (!menu || !btn || btn.hidden) return;
  closeAllDropdownMenus();
  renderTpInsertFieldMenu();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('.menu-dropdown-item');
  first?.focus({ preventScroll: true });
  // Opened from Ctrl/⌘+Shift+F, Lexical is still handling that key: its update then restores the caret, which takes the focus
  // back to the text and leaves the open menu out of the keyboard's reach (A89, found running the suites in real Chrome). After
  // that update, the focus goes back to the menu's first item if the menu is still open and the text took it.
  const unregister = editor.registerUpdateListener(() => {
    unregister();
    setTimeout(() => { if (!menu.hidden && document.activeElement === editorEl) first?.focus({ preventScroll: true }); }, 0);
  });
  setTimeout(() => unregister(), 1000);
}
function closeTpInsertFieldMenu() {
  const menu = $id('tpInsertFieldMenu'), btn = $id('btnTpInsertField');
  if (menu && !menu.hidden) { menu.hidden = true; btn?.setAttribute('aria-expanded', 'false'); }
}
function toggleTpInsertFieldMenu() {
  const menu = $id('tpInsertFieldMenu');
  if (menu && !menu.hidden) closeTpInsertFieldMenu(); else openTpInsertFieldMenu();
}
window.insertTitlePageField = insertTitlePageField;   // Playwright test hook (test-titlepage-editor.mjs)

// ---- K29 Stage 1d: "Print title page…" (design §4/§5 row "1d Print copy"; addendum 2.3.1/2.3.6e; KD's
// round-2 answer 5d, questions-register.md). format/titlepage-print.mjs builds the HTML (pure, unit-
// tested by tests/titlepage_print_copy.test.mjs); this is the one place that opens a window and prints it.
function tpFullDocForPrint() {
  let currentDocModel = null;
  editor.getEditorState().read(() => { currentDocModel = mergeListItemBlocks(buildModel()); });
  return currentDocModel || lastModel || { title: null, blocks: [] };
}
// Runs on every update, so it only looks for a Title Page node rather than building the document model.
function printTitlePageAvailable() { return editor.getEditorState().read(() => $getRoot().getChildren().some((n) => $isTitlePageNode(n))); }
function updatePrintTitlepageMenuItem() {
  const item = $id('printTitlepageItem'), div = $id('printTitlepageDivider');
  const show = printTitlePageAvailable();
  if (item) item.hidden = !show;
  if (div) div.hidden = !show;
}
editor.registerUpdateListener(() => updatePrintTitlepageMenuItem());
function openPrintTitlePage() {
  const doc = tpFullDocForPrint();
  if (!(doc.blocks || []).some((b) => b && b.type === 'titlepage')) { announce(t('app.titlepage_print.unavailable') || 'There is no Title Page to print. Insert one first.'); return; }
  const html = titlePagePrintHtml(doc, { mode: settings.mode, exhaustiveSymbols: doc.exhaustiveSymbols });
  const win = window.open('', '_blank');
  if (!win) { announce(t('app.titlepage_print.blocked') || 'Pop-up blocked: allow pop-ups for this page to print the Title Page.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  announce(t('app.titlepage_print.opened') || 'Print copy opened in a new window.');
}
window.openPrintTitlePage = openPrintTitlePage;   // Playwright test hook (test-titlepage-editor.mjs)

// Enter makes a new item that copies the old one's marker and enum/start: the new item is numbered by position, not by copy.
const origItemInsertNewAfter = ListItemNode.prototype.insertNewAfter;
ListItemNode.prototype.insertNewAfter = function(...args) {
  const r = origItemInsertNewAfter.apply(this, args);
  if ($isListItemNode(r) && r !== this) {
    if (r.getMarker()) r.setMarker(null);
    const f = fmtOf(r);
    if (f && (f.enum != null || f.start != null || f.itemCont)) r.setFmt({ ...f, enum: null, start: null, itemCont: null });   // Enter after an item's further paragraph starts a new item
  }
  return r;
};
// Deleting the first item of a sibling group must not lose the group's enum/start: they move to the group's new first item
// (unless that item has its own). Done inside remove()/replace(), i.e. in the same update, so one undo restores everything.
function keepGroupFmtOnRemove(item) {
  try {
    const f = fmtOf(item);
    if (!f || (f.enum == null && f.start == null)) return;
    const lvl = item.getLevel() || 0;
    for (let p = item.getPreviousSibling(); p; p = p.getPreviousSibling()) {
      if (!$isListItemNode(p)) continue;
      const pl = p.getLevel() || 0;
      if (pl === lvl) return;                           // not the first item of its group
      if (pl < lvl) break;                              // a shallower item opens the group: this is its first
    }
    for (let n = item.getNextSibling(); n; n = n.getNextSibling()) {
      if (!$isListItemNode(n)) continue;
      const nl = n.getLevel() || 0;
      if (nl > lvl) continue;
      if (nl < lvl) return;                             // the group ended with it
      const nf = fmtOf(n) || {};
      if (nf.enum == null && nf.start == null) n.setFmt({ ...nf, enum: f.enum != null ? f.enum : null, start: f.start != null ? f.start : null });
      return;
    }
  } catch (err) { console.warn('keepGroupFmtOnRemove', err); }
}
for (const method of ['remove', 'replace']) {
  const orig = ListItemNode.prototype[method];
  ListItemNode.prototype[method] = function(...args) {
    if (this.isAttached()) keepGroupFmtOnRemove(this);
    return orig.apply(this, args);
  };
}
// A89 (random-action testing, seed 614743370): a document that begins with a box, then select all + type, left the typed
// text loose inside the box -- Lexical keeps the first block's container and puts the text straight into it -- and every
// other part of the editor (the braille, the save) expects text to sit inside a paragraph. Loose text, line breaks and
// inline equations directly under the document or a box are gathered into a paragraph as soon as they appear.
function $wrapLooseInlines(container) {
  if (!container.isAttached()) return;
  let para = null;
  for (const child of container.getChildren()) {
    const loose = !(child instanceof ElementNode || child instanceof DecoratorNode) || child.isInline();
    if (!loose) { para = null; continue; }
    if (!para) { para = $createParagraphNode(); child.insertBefore(para); }
    para.append(child);
  }
}
for (const C of [SidebarNode, TnPageNode, SymPageNode, TpSegmentNode]) editor.registerNodeTransform(C, $wrapLooseInlines);
// The Title Page begins the book (BANA 2.2.1), and a save writes one Title Page, first (nimas-export.mjs), so in the editor too
// there is one, and it is the first block: whatever is put above it (pasted, typed or moved there) ends up just after it, and a
// second one (a paste or a load can bring one) is dropped. It was brailled where it stood, twice when there were two, and the
// reopened document's braille differed (A89, random-action testing; tests/test-titlepage-first.mjs). Checked on the document
// itself, which changes whenever a top-level block is added, moved or removed (a change further down does not touch the page).
const RootNodeClass = editor.getEditorState().read(() => $getRoot().constructor);
editor.registerNodeTransform(RootNodeClass, (root) => {
  const tps = root.getChildren().filter($isTitlePageNode);
  if (!tps.length) return;
  for (const extra of tps.slice(1)) extra.remove();
  const first = root.getFirstChild();
  if (first && !first.is(tps[0])) first.insertBefore(tps[0]);
});
// A pasted native (Lexical) list nests real ListNodes inside a ListItemNode. The editor's model is flat (one ListNode, items
// tagged with __level), so a pasted nested list is flattened on arrival: order kept, level = nesting depth, and a group whose
// type differs from the list's own (bullets under numbers, numbers under bullets) gets literal item markers so it still
// shows and saves as what it was. Plain-text paste ('- ', '1.' prefixes) never makes nested nodes and is not touched.
editor.registerNodeTransform(ListNode, (list) => {
  if (!list.isAttached() || typeof list.getListType !== 'function') return;
  const host = list.getListType();
  if (host !== 'number' && host !== 'bullet') return;
  for (const li of list.getChildren().filter($isListItemNode)) {
    const nestedLists = li.getChildren().filter($isListNode);
    if (!nestedLists.length) continue;
    let cursor = li;
    const flat = [];
    const walk = (nl, level) => {
      const type = nl.getListType();
      let n = 0;
      for (const it of nl.getChildren()) {
        if (!$isListItemNode(it)) continue;
        const inner = it.getChildren().filter($isListNode);
        const hasOwn = it.getChildren().some((c) => !$isListNode(c));
        if (hasOwn) {
          it.setLevel(level);
          if (type !== host) it.setMarker(type === 'bullet' ? '•' : synthesizeOrderedMarker(n + 1, defaultEnumForLevel(level)));
          n++;
          flat.push(it);
        }
        for (const sub of inner) walk(sub, level + 1);
      }
    };
    for (const nl of nestedLists) walk(nl, (li.getLevel() || 0) + 1);
    for (const it of flat) { cursor.insertAfter(it); cursor = it; }
    for (const nl of nestedLists) if (nl.isAttached()) nl.remove();
    if (!li.getChildren().length) li.remove();
  }
});
// Print markers that are plain 1-2-3 / a-b-c / i-ii-iii runs agreeing with the group's enum/start are computed, not kept: then
// Enter, delete, Tab and undo renumber. Groups with literal print markers (3. 5. 6., a) b) …) keep them. Same text on save, so
// an unedited document saves as before. Also: only the first item of a group carries enum/start.
editor.registerNodeTransform(ListNode, (list) => {
  if (!list.isAttached() || typeof list.getListType !== 'function' || list.getListType() !== 'number') return;
  const kind = (typeof list.getListKind === 'function' ? list.getListKind() : null) || (typeof list.getBanaStyle === 'function' ? list.getBanaStyle() : null);
  if (['toc', 'index', 'plain', 'glossary'].includes(kind)) return;
  const its = listItemsForPlan(list);
  const { gi, pos } = listGroups(its);
  its.forEach((it, i) => {
    if (gi[i] !== i && it.fmt && (it.fmt.enum != null || it.fmt.start != null)) it.node.setFmt({ ...it.fmt, enum: null, start: null });
  });
  const groups = new Map();
  its.forEach((it, i) => { if (!groups.has(gi[i])) groups.set(gi[i], []); groups.get(gi[i]).push(i); });
  for (const [g, idxs] of groups) {
    const gf = its[g].fmt || {};
    const lvl = Math.max(0, Math.min(9, its[g].level | 0));
    const en = LIST_ENUMS.includes(gf.enum) ? gf.enum : defaultEnumForLevel(lvl);
    const st = Math.max(1, Math.floor(Number(gf.start)) || 1);
    if (!idxs.some((i) => its[i].kept)) continue;
    const agrees = idxs.every((i) => {
      const k = its[i].kept;
      if (!k) return true;
      if (k === NO_MARKER) return false;
      const n = st + pos[i];
      return k === ((!LIST_ENUMS.includes(gf.enum) && lvl >= 4) ? `(${n})` : synthesizeOrderedMarker(n, en));
    });
    if (agrees) for (const i of idxs) if (its[i].kept) its[i].node.setMarker(null);
  }
});

// ---- Document Dirty Tracking & Save State ----
// O(1) per keystroke: an update listener flips `contentChangedSinceClean` whenever a
// content (not selection-only) update commits. The full-state signature is only computed
// lazily — when something actually asks (beforeunload / load / clear) — so that an undo
// back to the saved state still reads as clean without stringifying on every update.
let lastSavedStateSignature = null;      // hash of the state at the last save/load
let lastSavedEditorState = null;         // the EditorState object at that moment (identity fast-path)
let contentChangedSinceClean = false;

// FNV-1a 32-bit over the string: a cheap structural signature of a JSON snapshot.
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + s.length;
}

export function getEditorStateSignature() {
  try {
    return hashString(JSON.stringify(editor.getEditorState().toJSON()));
  } catch {
    return '';
  }
}

// True when the document has no content at all: only empty paragraphs, no pictures, tables, equations or other items, and no title
// typed into the Title field (feedback 30 Sep item 17: an emptied document is nothing to recover or to ask about).
function isDocumentEmpty() {
  if (loadedDocInfo.titleTyped) return false;
  return editor.getEditorState().read(() => $getRoot().getChildren().every((c) => typeof c.getChildren === 'function'
    && c.getTextContent().trim() === '' && c.getChildren().every((k) => $isTextNode(k) || $isLineBreakNode(k))));
}
// The document's title and details live outside the text (loadedDocInfo): a change to them since the last save (the Title field,
// Book details) is unsaved too (feedback item 10), though the text's own state is unchanged.
let docInfoChangedSinceClean = false;
// A picture description being typed (feedback item 8's box) is committed when the box is left; until then it is unsaved work too,
// so leaving the page asks first.
let cardEditPending = false;
// S2a #5 (audit 15 Oct 2026): what is typed in a picture's description box is not in the document until the box is left, so the
// autosave backup, a save and the transfer to Quick Mode (all built from the document) missed it. The draft is now kept here,
// by the picture's node key: buildModel's imageBlock() reads it in place of the stored description (so every copy of the model
// built meanwhile has the text being typed), typing asks for an autosave, and commitPendingCardDrafts() puts the drafts into the
// document (the braille and a download need that: they are rendered from it).
const pendingAltDrafts = new Map();     // picture node key -> the text typed in its description box, not yet committed
const pendingCardCommits = new Map();   // picture node key -> () => commits that draft to the document
function commitPendingCardDrafts() {
  for (const commit of [...pendingCardCommits.values()]) { try { commit(true); } catch (e) { console.warn('committing a picture description failed:', e); } }
}
// S3c (S2-Q3, Paul 15 Oct): "unsaved" must mean a real change. cardEditPending is true only while a description box holds text
// that differs from the picture's stored description (typing a letter and deleting it, or a trailing space, is no change).
function refreshCardEditPending() {
  let pending = false;
  if (pendingAltDrafts.size) {
    editor.getEditorState().read(() => {
      for (const [k, v] of pendingAltDrafts) {
        const n = $getNodeByKey(k);
        const stored = $isImageNode(n) ? (n.getAlt() || '') : '';
        if (stored !== String(v).replace(/\s+/g, ' ').trim()) { pending = true; break; }
      }
    });
  }
  cardEditPending = pending;
}
export function markDocumentClean() {
  // A description still in its box was saved with the document (S2a #5: the save reads the draft). Put it into the document now,
  // before the saved state is taken, so that leaving the box later does not look like a change since the save (S2-Q3).
  commitPendingCardDrafts();
  lastSavedEditorState = editor.getEditorState();
  lastSavedStateSignature = getEditorStateSignature();
  contentChangedSinceClean = false;
  docInfoChangedSinceClean = false;
  cardEditPending = false;
}

// A recovered autosave has never been saved to a file: it starts dirty, so the close guard
// still asks and autosave keeps backing it up until the user saves.
export function markDocumentUnsaved() {
  lastSavedEditorState = null;
  lastSavedStateSignature = 'unsaved';
  contentChangedSinceClean = true;
}

export function isDocumentDirty() {
  if (!lastSavedStateSignature) return false;
  if (docInfoChangedSinceClean || cardEditPending) return true;
  if (!contentChangedSinceClean) return false;
  const cur = editor.getEditorState();
  if (cur === lastSavedEditorState) { contentChangedSinceClean = false; return false; }
  // Something changed since the save; check (lazily, only now) whether an undo/redo has
  // brought the content back to exactly the saved state.
  const same = getEditorStateSignature() === lastSavedStateSignature;
  if (same) { lastSavedEditorState = cur; contentChangedSinceClean = false; }
  return !same;
}

editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
  if (contentChangedSinceClean) return;
  if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;   // selection-only update
  contentChangedSinceClean = true;
});

if (typeof window !== 'undefined') {
  window.getEditorStateSignature = getEditorStateSignature;
  window.markDocumentClean = markDocumentClean;
  window.isDocumentDirty = isDocumentDirty;
}

// G15: the too-wide warning badge in a table's toolbar — shown when the table's format is
// 'auto' or 'spatial' but the formatter actually falls back to a listed (BANA) / paragraph
// (UKAAF) table. tableLayout (format/document.mjs) is formatTable's own width computation,
// so this can never disagree with what the table actually braillies as; called with the
// editor's current width/mode settings (currentFormatOpts, defined below — hoisted),
// matching what render() itself uses.
function updateTableWarningBadge(bar, headers, rows, format) {
  if (!bar) return;
  const fmt = format || 'spatial';
  let badge = bar.querySelector('.table-warn-badge');
  if (fmt === 'listed' || fmt === 'vertical' || fmt === 'facing' || fmt === 'stairstep' || fmt === 'linear') { if (badge) badge.remove(); return; }   // an explicit listed/vertical table isn't "too wide" — that's what was asked for
  const o = currentFormatOpts();
  const layout = tableLayout({ headers: headers || [], rows: rows || [], format: fmt }, o);
  if (layout === 'columnar' || layout === 'vertical' || layout === 'facing' || layout === 'interchange' || layout === 'stairstep' || layout === 'linear') { if (badge) badge.remove(); return; }   // BANA 11.15: an 'interchange' table that does not fit even interchanged is laid out as auto — so it can still warn   // T4: vertical division (BANA §11.14) and K15 facing pages (§11.13) are legitimate auto layouts, not the "too wide" warning
  const bana = o.mode === 'bana';
  const msg = t(bana ? 'app.table.too_wide_listed' : 'app.table.too_wide_paragraph');
  const desc = t(bana ? 'app.table.too_wide_listed_title' : 'app.table.too_wide_paragraph_title');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'table-warn-badge';
    bar.appendChild(badge);
  }
  badge.textContent = msg;
  badge.title = desc;
  badge.setAttribute('aria-label', `${msg}. ${desc}`);
}
// Every TableNode in the document, wherever nested (a sidebar's own table included), for
// refreshing warning badges when settings change width/mode without touching the Lexical
// tree (so the table decorator itself never re-fires) — called from render().
function forEachTableNode(cb) {
  editor.getEditorState().read(() => {
    const walk = (nodes) => {
      for (const n of nodes) {
        if ($isTableNode(n)) cb(n);
        else if (typeof n.getChildren === 'function') walk(n.getChildren());
      }
    };
    walk($getRoot().getChildren());
  });
}
// The maths keyboard (MathLive's virtual keyboard) takes the bottom third of the window and pads the page to make room.
// Found 30 Sep: with the braille-rules band showing an equation's several rows of rules, the text and braille panes
// were squeezed to a few lines (on a small window, to nothing). While the keyboard is open the band keeps to one row
// (it scrolls) and the equation being edited is kept in view.
let mathKeyboardWatched = false;
// Every equation's keyboard button says whether the keyboard is open (aria-expanded), whoever opened or closed it.
function syncMathKeyboardButtons() {
  const open = !!(window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible);
  for (const b of document.querySelectorAll('.math-kb-btn')) b.setAttribute('aria-expanded', String(open));
}
function watchMathKeyboard() {
  if (mathKeyboardWatched) return;
  mathKeyboardWatched = true;
  // Opening or closing the keyboard makes MathLive pad <body> (its style attribute) at once, with
  // mathVirtualKeyboard.visible already updated; its own events proved unreliable when the field's keyboard button
  // opens it, and its .is-visible class waits for an animation frame.
  //
  // F9 item M (Paul 9 Oct 2026): the keyboard stayed open, with no way to close it, once every equation had been deleted (it belongs to the
  // page, not to a field, and MathLive's own close key lives in the field's toolbar). Now (1) a Close button sits above the keyboard
  // whenever it is open, and (2) the keyboard closes by itself as soon as no equation is left in the document.
  let closeBtn = null;
  const kb = () => window.mathVirtualKeyboard;
  const placeClose = () => {
    if (!closeBtn) return;
    const h = Math.round(kb()?.boundingRect?.height || 0);
    closeBtn.style.bottom = `${h + 8}px`;
  };
  const ensureClose = () => {
    if (closeBtn) return closeBtn;
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = 'mathKbClose';
    closeBtn.className = 'math-kb-close';
    closeBtn.hidden = true;
    const label = tOr('app.editor.math_keyboard_close', 'Close maths keyboard');
    closeBtn.append(iconEl('xmark', 'icon icon-inline'), ` ${label}`);
    closeBtn.setAttribute('aria-label', label);
    closeBtn.addEventListener('click', () => { try { kb()?.hide(); } catch { /* not up yet */ } sync(); editor.focus(); });
    document.body.appendChild(closeBtn);
    window.addEventListener('i18n:localechange', () => { const l = tOr('app.editor.math_keyboard_close', 'Close maths keyboard'); closeBtn.replaceChildren(iconEl('xmark', 'icon icon-inline'), ` ${l}`); closeBtn.setAttribute('aria-label', l); });
    return closeBtn;
  };
  const sync = () => {
    let open = !!(kb() && kb().visible);
    if (open && !document.querySelector('math-field')) { try { kb().hide(); open = !!kb().visible; } catch { /* ignore */ } }   // no equation left: nothing for it to type into
    const shown = open && !!document.querySelector('math-field');
    ensureClose().hidden = !shown;
    if (shown) placeClose();
    syncMathKeyboardButtons();
    if (document.body.classList.contains('math-keyboard-open') === open) return;
    document.body.classList.toggle('math-keyboard-open', open);
    if (!open) return;
    const active = document.activeElement;
    const mf = active && active.tagName === 'MATH-FIELD' ? active : document.querySelector('math-field:focus-within');
    setTimeout(() => mf?.scrollIntoView({ block: 'nearest' }), 0);
  };
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true });
  // An equation removed from the document (the text is edited, not the body): looked at only while the keyboard is open.
  const doc = $id('editor');
  if (doc) {
    let queued = false;
    new MutationObserver(() => {
      if (queued || !(kb() && kb().visible)) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; sync(); });
    }).observe(doc, { childList: true, subtree: true });
  }
  try { kb()?.addEventListener?.('geometrychange', () => { placeClose(); }); } catch { /* older MathLive */ }
}

function refreshAllTableBadges() {
  forEachTableNode((n) => {
    const el = editor.getElementByKey(n.getKey());
    const bar = el && el.querySelector('.table-context-bar');
    if (bar) updateTableWarningBadge(bar, n.getHeaders(), n.getRows(), n.getFormat());
  });
}

// mount a MathLive <math-field> or Graphic preview into each node's DOM
editor.registerDecoratorListener((decorators) => {
  for (const key of Object.keys(decorators)) {
    const val = decorators[key];
    if (val == null) continue;                 // break node
    const el = editor.getElementByKey(key);
    if (!el) continue;

    // Graphic diagram decorator
    if (typeof val === 'object' && val.svg) {
      if (el.querySelector('.graphic-preview-svg-wrap')) continue;
      el.innerHTML = '';
      const bar = document.createElement('div');
      bar.className = 'graphic-context-bar';
      
      const titleSpan = document.createElement('strong');
      titleSpan.textContent = val.title || val.alt || 'Tactile Diagram';
      titleSpan.style.marginRight = 'auto';
      bar.appendChild(titleSpan);

      const btnSize = document.createElement('button');
      btnSize.type = 'button';
      btnSize.className = 'graphic-context-btn';
      const sizeLabels = { compact: 'Size: Compact', half: 'Size: Half Page', full: 'Size: Full Page' };
      const currentSize = val.size || 'half';
      btnSize.textContent = sizeLabels[currentSize] || 'Size: Half Page';
      btnSize.title = t('app.graphic.size_title');
      btnSize.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isGraphicNode(n)) {
            const nextMap = { compact: 'half', half: 'full', full: 'compact' };
            const nextSize = nextMap[n.getSize()] || 'half';
            n.setSize(nextSize);
            btnSize.textContent = sizeLabels[nextSize] || 'Size: Half Page';
            el.className = 'doc-graphic-block size-' + nextSize;
          }
        });
      });
      bar.appendChild(btnSize);

      const btnTextures = document.createElement('button');
      btnTextures.type = 'button';
      btnTextures.className = 'graphic-context-btn';
      btnTextures.textContent = val.textures ? 'Textures: ON' : 'Textures: OFF';
      btnTextures.title = t('app.graphic.textures_title');
      btnTextures.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isGraphicNode(n)) {
            const next = !n.getTextures();
            n.setTextures(next);
            btnTextures.textContent = next ? 'Textures: ON' : 'Textures: OFF';
          }
        });
      });
      bar.appendChild(btnTextures);

      const btnLabels = document.createElement('button');
      btnLabels.type = 'button';
      btnLabels.className = 'graphic-context-btn';
      btnLabels.textContent = val.brailleLabels ? '⠿ Braille: ON' : '⠿ Braille: OFF';
      btnLabels.title = t('app.graphic.labels_title');
      btnLabels.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isGraphicNode(n)) {
            const next = !n.getBrailleLabels();
            n.setBrailleLabels(next);
            btnLabels.textContent = next ? '⠿ Braille: ON' : '⠿ Braille: OFF';
          }
        });
      });
      bar.appendChild(btnLabels);

      const btnLeadLine = document.createElement('button');
      btnLeadLine.type = 'button';
      btnLeadLine.className = 'graphic-context-btn';
      btnLeadLine.textContent = `+ ${t('app.graphic.add_label')}`;
      btnLeadLine.title = t('app.graphic.add_label_title');
      btnLeadLine.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = window.prompt("Enter label text (e.g. 'Vertex', 'Nucleus', 'Resistor'):", 'Feature');
        if (!text) return;
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isGraphicNode(n)) {
            let svg = n.getSvg();
            // Compute target near center and label in open top-left margin
            const targetX = 210, targetY = 160, labelX = 60, labelY = 40;
            const leadSvg = createLeadLineSvg(targetX, targetY, labelX, labelY, text, {
              translator: translateDiagramText
            });
            if (svg.includes('</svg>')) {
              svg = svg.replace('</svg>', `${leadSvg}</svg>`);
              n.setSvg(svg);
            }
          }
        });
      });
      bar.appendChild(btnLeadLine);

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'graphic-context-btn danger';
      btnDel.replaceChildren(iconEl('trash', 'icon icon-inline'), ` ${t('common.delete')}`);
      btnDel.title = t('app.graphic.delete_title');
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isGraphicNode(n)) n.remove();
        });
      });
      bar.appendChild(btnDel);

      const svgWrap = document.createElement('div');
      svgWrap.className = 'graphic-preview-svg-wrap size-' + (val.size || 'half');
      // The SVG came from an imported .html/.epub/.svg — untrusted. Strip anything
      // that can run script before it becomes live DOM.
      svgWrap.innerHTML = sanitizeSvgMarkup(val.svg);

      el.appendChild(bar);
      el.appendChild(svgWrap);

      el.addEventListener('click', (e) => {
        if (e.target.closest('.graphic-preview-bar')) return;
        const bIdx = el.dataset.blockIdx != null ? Number(el.dataset.blockIdx) : lastKeys.indexOf(key);
        if (!Number.isNaN(bIdx) && bIdx >= 0) {
          linkByBlock(bIdx, true);
        }
      });
      continue;
    }

    // Image (print image) decorator: a control for the picture's type word (BANA 6.2.2b,
    // F-231/Stage 2, 23 Sep 2026). figureType already round-trips through load/save/undo
    // (F-231's fix on ImageNode/imageBlock, above) — this is its only editor UI. Blank
    // keeps the "Illustration" default (document.mjs's traceOrFormatPrintImage). Caption,
    // alt text and description stay static (built once in ImageNode.createDOM); only
    // figureType is interactive, so the meta block createDOM already built is reused here
    // rather than wiped, unlike the Graphic/Table decorators above which own their whole DOM.
    if (typeof val === 'object' && val.type === 'image') {
      const meta = el.querySelector('.doc-image-meta');
      if (!meta || meta.querySelector('.doc-image-type-select')) continue;
      const FIGURE_TYPE_OPTIONS = ['Photograph', 'Map', 'Diagram', 'Illustration', 'Picture', 'Cartoon'];
      const OTHER = '__other__';
      const isPreset = FIGURE_TYPE_OPTIONS.includes(val.figureType);
      // The description for the braille reader (the alt text; feedback 30 Sep item 8, Paul 1 Oct): typed here, it becomes the
      // picture's transcriber's note in the braille. Committed when the box is left (change), so the card is not rebuilt while
      // typing; keys stay in the box (Lexical would otherwise take Backspace / Enter as edits to the document around the picture).
      const altId = `img-alt-${key}`;
      const altLabel = document.createElement('label');
      altLabel.className = 'doc-image-alt-label';
      altLabel.htmlFor = altId;
      altLabel.textContent = tOr('app.editor.image_alt_label', 'Description for the braille reader');
      const altBox = document.createElement('textarea');
      altBox.id = altId;
      altBox.className = 'doc-image-alt';
      altBox.rows = 2;
      altBox.value = val.alt || '';
      altBox.placeholder = tOr('app.editor.image_alt_placeholder', 'What the picture shows. Leave empty for a decorative picture.');
      for (const ev of ['pointerdown', 'mousedown', 'click', 'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy', 'focusin']) altBox.addEventListener(ev, (e) => e.stopPropagation());
      altBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); altBox.blur(); } });
      pendingAltDrafts.delete(key); pendingCardCommits.delete(key);   // a rebuilt card starts from the document's description
      const commitAlt = (discrete = false) => {
        const v = altBox.value;
        pendingAltDrafts.delete(key); pendingCardCommits.delete(key);
        if (!altBox.isConnected) { refreshCardEditPending(); return; }
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isImageNode(n) && n.getAlt() !== v.replace(/\s+/g, ' ').trim()) n.setAlt(v);   // only a real change touches the document (S2-Q3)
        }, discrete === true ? { discrete: true } : undefined);
        refreshCardEditPending();   // a real change is now in the document (its own dirty mark); an unchanged box leaves nothing pending
      };
      altBox.addEventListener('input', () => {
        pendingAltDrafts.set(key, altBox.value);
        pendingCardCommits.set(key, commitAlt);
        refreshCardEditPending();   // S2-Q3: unsaved only if the text differs from the stored description
        noteAutosaveChange();   // S2a #5: a backup follows the typing, as it does for the text itself
      });
      altBox.addEventListener('change', () => commitAlt());
      const altRow = document.createElement('div');
      altRow.className = 'doc-image-alt-row';
      altRow.append(altLabel, altBox);
      meta.appendChild(altRow);
      const row = document.createElement('div');
      // The picture type (the note's label word, BANA 6.2.2b) is a transcriber's choice: hidden while Transcriber tools is off
      // (class fmt-transcriber), when every picture uses the default, "Illustration" (feedback item 8).
      row.className = 'doc-image-type-row fmt-transcriber';
      const selId = `img-type-${key}`;
      const label = document.createElement('label');
      label.className = 'doc-image-type-label';
      label.htmlFor = selId;
      label.textContent = 'Picture type:';
      const sel = document.createElement('select');
      sel.id = selId;
      sel.className = 'doc-image-type-select';
      sel.title = 'The transcriber\'s-note label word for this picture (BANA 6.2.2b) — untested on real hardware output, blank uses "Illustration".';
      const addOption = (value, text, selected) => {
        const o = document.createElement('option');
        o.value = value; o.textContent = text;
        if (selected) o.selected = true;
        sel.appendChild(o);
      };
      addOption('', '(default — Illustration)', !val.figureType);
      for (const word of FIGURE_TYPE_OPTIONS) addOption(word, word, val.figureType === word);
      addOption(OTHER, 'Other…', Boolean(val.figureType) && !isPreset);
      sel.addEventListener('pointerdown', (e) => e.stopPropagation());
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        let value = sel.value;
        if (value === OTHER) {
          const custom = window.prompt('Enter a custom picture type word (e.g. "Cover", "Portrait"):', !isPreset ? (val.figureType || '') : '');
          value = custom ? custom.trim() : '';
          if (!value) { sel.value = isPreset ? val.figureType : ''; return; }
        }
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isImageNode(n)) n.setFigureType(value);
        });
      });
      row.appendChild(label);
      row.appendChild(sel);
      meta.appendChild(row);
      // Feedback 30 Sep item 9 (Paul, 1 Oct): a Delete button, as tables, tactile graphics, equations and page numbers have
      // (a picture had none, and a mouse user could not remove one). Undo brings it back.
      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'doc-image-delete table-context-btn danger';
      btnDel.replaceChildren(iconEl('trash', 'icon icon-inline'), ` ${t('common.delete')}`);
      btnDel.title = tOr('app.editor.image_delete_title', 'Delete this picture (Undo brings it back)');
      btnDel.addEventListener('pointerdown', (e) => e.stopPropagation());
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => { const n = $getNodeByKey(key); if ($isImageNode(n)) n.remove(); });
        announce(tOr('app.editor.image_deleted', 'Picture deleted. Undo brings it back.'));
      });
      const delRow = document.createElement('div');
      delRow.className = 'doc-image-delete-row';
      delRow.appendChild(btnDel);
      meta.appendChild(delRow);
      continue;
    }

    // MathLive math-field decorator
    if (typeof val === 'string') {
      if (el.querySelector('math-field')) continue;
      el.innerHTML = '';
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.gap = '4px';

      watchMathKeyboard();
      const mf = document.createElement('math-field');
      // Virtual keyboard only on request (its toggle is visible); the MathLive menu stays
      // hidden because its options are print styling that braille ignores (G11).
      mf.setAttribute('math-virtual-keyboard-policy', 'manual');
      mf.setAttribute('smart-mode', '');
      if (val) {
        mf.setAttribute('data-latex', val);
        el.setAttribute('data-latex', val);
      }
      mf.value = val;
      // A name for the equation's typing area (WCAG 4.1.2): MathLive's own keyboard sink, inside its shadow root, has none.
      const mfLabel = tOr('app.editor.equation_aria', 'Equation');
      mf.setAttribute('aria-label', mfLabel);
      let mfLabelTries = 0;
      const labelMathSink = () => {
        const sink = mf.shadowRoot?.querySelector('.ML__keyboard-sink');
        if (sink) sink.setAttribute('aria-label', mfLabel);
        else if (++mfLabelTries < 60) requestAnimationFrame(labelMathSink);
      };
      requestAnimationFrame(labelMathSink);

      const btnPlot = document.createElement('button');
      btnPlot.type = 'button';
      btnPlot.className = 'math-plot-btn';
      btnPlot.replaceChildren(iconEl('graph-up', 'icon icon-inline'), ` ${t('app.graphic.plot')}`);
      btnPlot.title = t('app.graphic.plot_title');
      btnPlot.style.cssText = 'display:none; padding:2px 6px; font-size:.75rem; font-weight:600; background:var(--pill-bg); color:var(--ink); border:1px solid var(--line); border-radius:4px; cursor:pointer; vertical-align:middle;';
      btnPlot.addEventListener('mousedown', (e) => e.preventDefault());
      btnPlot.addEventListener('click', (e) => {
        e.stopPropagation();
        const latex = mf.value || val;
        plotAndInsertGraph(latex, key);
      });

      const updatePlotVisibility = () => {
        const canPlot = isGraphicsSupported(settings) && isPlottableEquation(mf.value || val);
        btnPlot.style.display = canPlot ? 'inline-flex' : 'none';
      };

      mf.addEventListener('pointerdown', (e) => { e.stopPropagation(); handleMathFieldSelect(mf); });
      mf.addEventListener('click', (e) => { e.stopPropagation(); handleMathFieldSelect(mf); });
      mf.addEventListener('focus', () => { handleMathFieldSelect(mf); updatePlotVisibility(); });
      mf.addEventListener('focusin', () => { handleMathFieldSelect(mf); updatePlotVisibility(); });
      // The arrow keys out of an equation (A89, found by random-action testing, Chrome and WebKit): MathLive moves the caret inside
      // the equation itself and at its edge asks the page to take over ("move-out"); Right / Down at the end put the caret just
      // after the equation in the text, Left / Up at the start just before it.
      // Escape leaves the equation, the caret just after it (A89, random-action testing): MathLive's own Escape switched the
      // equation to its raw-LaTeX mode — invisible — where the arrow keys stopped moving. Caught before MathLive sees it.
      mf.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape' || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        editorEl.focus({ preventScroll: true });
        editor.update(() => { const n = $getNodeByKey(key); if (n) n.selectNext(0, 0); }, { discrete: true });
      }, true);
      mf.addEventListener('move-out', (ev) => {
        const dir = ev.detail && ev.detail.direction;
        ev.preventDefault();
        leaveMathHighlight(mf);   // the caret has left the equation: its highlight goes with it (item 10)
        const after = dir === 'forward' || dir === 'downward';
        editorEl.focus({ preventScroll: true });
        editor.update(() => {
          const n = $getNodeByKey(key);
          if (!n) return;
          if (after) n.selectNext(0, 0); else n.selectPrevious();
        }, { discrete: true });
        // Up / Down go on to the line above (below), as from any text: stopping just beside the equation, on the same line,
        // took two presses for each equation-only paragraph, and looked stuck (A89, random-action testing).
        if (dir === 'upward' || dir === 'downward') moveCaretVertically(dir === 'downward');
      });
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); handleMathFieldSelect(mf); });
      el.addEventListener('click', (e) => { e.stopPropagation(); handleMathFieldSelect(mf); });
      el.addEventListener('mouseenter', () => { if (mf.value.trim()) updatePlotVisibility(); });
      el.addEventListener('mouseleave', () => { if (document.activeElement !== mf) btnPlot.style.display = 'none'; });

      mf.addEventListener('input', () => {
        editor.update(() => { const n = $getNodeByKey(key); if ($isMathNode(n)) n.setLatex(mf.value); });
        updatePlotVisibility();
      });
      mf.addEventListener('focusout', () => setTimeout(() => {
        if (document.activeElement !== mf && !mf.contains(document.activeElement)) { leaveMathHighlight(mf); if (document.activeElement === editorEl) syncCaretWithBraille(true); }
        if (!mf.value.trim() && document.activeElement !== mf) {
          editor.update(() => { const n = $getNodeByKey(key); if ($isMathNode(n)) n.remove(); });
        }
        if (document.activeElement !== mf) {
          btnPlot.style.display = 'none';
        }
      }, 160));

      // Emboss's own button for the on-screen maths keyboard, Iconoir's keypad icon in place of MathLive's built-in toggle (hidden in
      // style.css): the same thing MathLive's toggle does (its toggleVirtualKeyboard command), with the equation focused first so the
      // keys type into it. mousedown is not allowed to move the focus off the equation. aria-expanded follows the keyboard (watchMathKeyboard).
      const btnKb = document.createElement('button');
      btnKb.type = 'button';
      btnKb.className = 'math-kb-btn';
      btnKb.append(iconEl('dots-grid-3x3', 'icon'));
      const kbName = tOr('app.editor.math_keyboard_toggle', 'Maths keyboard');
      btnKb.setAttribute('aria-label', kbName);
      btnKb.title = kbName;
      btnKb.setAttribute('aria-expanded', String(!!(window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible)));
      btnKb.addEventListener('mousedown', (e) => e.preventDefault());
      btnKb.addEventListener('pointerdown', (e) => e.stopPropagation());
      btnKb.addEventListener('click', (e) => {
        e.stopPropagation();
        try { mf.focus(); mf.executeCommand('toggleVirtualKeyboard'); } catch { /* MathLive not ready */ }
        setTimeout(() => syncMathKeyboardButtons(), 0);
      });

      el.appendChild(mf);
      el.appendChild(btnKb);
      el.appendChild(btnPlot);
    }

    // Table decorator
    if (typeof val === 'object' && val.type === 'table') {
      const colCount = Math.max(val.headers?.length || 0, ...(val.rows?.map(r => r.length) || [0]), 1);
      const rowCount = val.rows?.length || 0;
      const headerCount = (val.headers && val.headers.length) || 0;

      if (el.querySelector('.editor-table-widget')) {
        // In-cell edits return false from updateDOM (the comment on TableNode.updateDOM),
        // so the widget's DOM survives and only needs its *other* cells re-synced — never
        // the focused one, or the caret/in-progress edit would be clobbered mid-keystroke.
        const allCells = el.querySelectorAll('.table-cell-input');
        allCells.forEach((cellEl) => {
          if (cellEl === document.activeElement) return;
          const u = parseInt(cellEl.dataset.unit, 10);
          if (isNaN(u)) return;
          const html = u < headerCount
            ? cellToEditableHtml(val.headers[u], resolveCellImgSrc)
            : cellToEditableHtml(val.rows[Math.floor((u - headerCount) / colCount)]?.[(u - headerCount) % colCount], resolveCellImgSrc);
          if (cellEl.innerHTML !== html) cellEl.innerHTML = html;
        });
        const bar = el.querySelector('.table-context-bar');
        if (bar) updateTableWarningBadge(bar, val.headers, val.rows, val.format);
        continue;
      }
      el.innerHTML = '';

      const bar = document.createElement('div');
      bar.className = 'table-context-bar';

      const curFormat = val.format || 'spatial';
      const titleSpan = document.createElement('strong');
      titleSpan.replaceChildren(iconEl('table', 'icon icon-inline'), ` ${t('app.table.title', { cols: colCount, rows: rowCount })}`);
      titleSpan.style.marginRight = 'auto';
      bar.appendChild(titleSpan);
      updateTableWarningBadge(bar, val.headers, val.rows, val.format);   // G15: too-wide warning

      // Feedback 30 Sep, item 5 (Paul, 1 Oct): the table layout (BANA §11) and "Braille formatting" are transcriber tools, as the
      // Layout dialog is (Paul, 25 Sep): hidden while Transcriber tools is off (class fmt-transcriber); a table keeps the layout it has.
      const btnFormat = document.createElement('button');
      btnFormat.type = 'button';
      btnFormat.className = 'table-context-btn fmt-transcriber';
      const FORMAT_LABEL = { auto: `${t('app.table.fmt_auto')}`, spatial: `${t('app.table.fmt_spatial')}`, listed: `${t('app.table.fmt_listed')}`, vertical: `${t('app.table.fmt_vertical')}`, facing: `${t('app.table.fmt_facing')}`, interchange: `${t('app.table.fmt_interchange')}`, stairstep: `${t('app.table.fmt_stairstep')}`, linear: `${t('app.table.fmt_linear')}` };
      const FORMAT_TITLE = {
        auto: t('app.table.fmt_auto_title'),
        spatial: t('app.table.fmt_spatial_title'),
        listed: t('app.table.fmt_listed_title'),
        vertical: t('app.table.fmt_vertical_title'),
        stairstep: t('app.table.fmt_stairstep_title'),
        linear: t('app.table.fmt_linear_title'),
        facing: t('app.table.fmt_facing_title'),
        interchange: t('app.table.fmt_interchange_title'),
      };
      btnFormat.textContent = FORMAT_LABEL[curFormat] || FORMAT_LABEL.spatial;
      btnFormat.title = t('app.table.fmt_title', { format: FORMAT_TITLE[curFormat] || FORMAT_TITLE.spatial });
      btnFormat.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) {
            // T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026): 'vertical' (BANA §11.14
            // Wide Tables: Vertical Division) added to the cycle between Listed and Auto.
            // K15: 'facing' (BANA §11.13 Wide Tables: Facing Pages) after Vertical Division.
            // BANA §11.15: 'interchange' (Interchanged Columns and Rows) after Facing Pages.
            const nextFmt = { auto: 'spatial', spatial: 'listed', listed: 'vertical', vertical: 'facing', facing: 'interchange', interchange: 'stairstep', stairstep: 'linear', linear: 'auto' }[n.getFormat()] || 'listed';
            n.setFormat(nextFmt);
          }
        });
      });
      bar.appendChild(btnFormat);

      const btnFmtFields = document.createElement('button');
      btnFmtFields.type = 'button';
      btnFmtFields.className = 'table-context-btn fmt-transcriber';
      btnFmtFields.replaceChildren(iconEl('settings', 'icon icon-inline'), ` ${t('app.braille_fmt.title')}`);
      btnFmtFields.title = t('app.braille_fmt.button_title');
      btnFmtFields.setAttribute('aria-haspopup', 'dialog');
      btnFmtFields.addEventListener('click', (e) => { e.stopPropagation(); openBrailleFmtDialog(key); });
      bar.appendChild(btnFmtFields);

      const btnAddRow = document.createElement('button');
      btnAddRow.type = 'button';
      btnAddRow.className = 'table-context-btn';
      btnAddRow.textContent = `+ ${t('app.table.add_row')}`;
      btnAddRow.title = t('app.table.add_row_title');
      btnAddRow.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) n.addRow();
        });
      });
      bar.appendChild(btnAddRow);

      const btnAddCol = document.createElement('button');
      btnAddCol.type = 'button';
      btnAddCol.className = 'table-context-btn';
      btnAddCol.textContent = `+ ${t('app.table.add_col')}`;
      btnAddCol.title = t('app.table.add_col_title');
      btnAddCol.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) n.addColumn();
        });
      });
      bar.appendChild(btnAddCol);

      const btnDelRow = document.createElement('button');
      btnDelRow.type = 'button';
      btnDelRow.className = 'table-context-btn';
      btnDelRow.textContent = `- ${t('app.table.add_row')}`;
      btnDelRow.title = t('app.table.del_row_title');
      btnDelRow.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n) && n.getRows().length > 1) {
            n.removeRow(n.getRows().length - 1);
          }
        });
      });
      bar.appendChild(btnDelRow);

      const btnDelCol = document.createElement('button');
      btnDelCol.type = 'button';
      btnDelCol.className = 'table-context-btn';
      btnDelCol.textContent = `- ${t('app.table.add_col')}`;
      btnDelCol.title = t('app.table.del_col_title');
      btnDelCol.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) {
            const cols = Math.max(n.getHeaders().length, ...(n.getRows().map(r => r.length)));
            if (cols > 1) n.removeColumn(cols - 1);
          }
        });
      });
      bar.appendChild(btnDelCol);

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'table-context-btn danger';
      btnDelete.replaceChildren(iconEl('trash', 'icon icon-inline'), ` ${t('common.delete')}`);
      btnDelete.title = t('app.table.delete_title');
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) n.remove();
        });
      });
      bar.appendChild(btnDelete);

      el.appendChild(bar);

      const table = document.createElement('table');
      table.className = 'editor-table-widget';

      if (val.headers && val.headers.length > 0) {
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        val.headers.forEach((h, ci) => {
          const th = document.createElement('th');
          const label = t('app.table.header_n', { n: ci + 1 });
          th.appendChild(makeTableCell(key, h, -1, ci, ci, 'table-cell-input table-header-input', label, label));
          tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
      }

      const tbody = document.createElement('tbody');
      (val.rows || []).forEach((row, ri) => {
        const tr = document.createElement('tr');
        for (let ci = 0; ci < colCount; ci++) {
          const td = document.createElement('td');
          const unit = headerCount + ri * colCount + ci;
          const headerLabel = cellPlainText(val.headers && val.headers[ci]).trim();
          const label = headerLabel
            ? t('app.table.cell_aria_named', { header: headerLabel, row: ri + 1 })
            : t('app.table.cell_aria', { col: ci + 1, row: ri + 1 });
          td.appendChild(makeTableCell(key, row[ci], ri, ci, unit, 'table-cell-input', label, '...'));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      el.appendChild(table);
    }

    // Print Page decorator
    if (typeof val === 'object' && val?.type === 'print-page') {
      if (el.querySelector('.page-badge')) continue;
      el.innerHTML = '';

      const badge = document.createElement('span');
      badge.className = 'page-badge';
      badge.replaceChildren(iconEl('page', 'icon icon-inline'), ` ${t('app.printpage.badge')}`);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'page-num-input';
      input.value = val.page || '1';
      input.setAttribute('aria-label', t('app.printpage.input_aria'));
      input.title = t('app.printpage.input_title');

      input.addEventListener('input', (e) => {
        const newPage = e.target.value;
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isPrintPageNode(n)) n.setPage(newPage);
        });
        clearTranslationCache();
        scheduleRender();
      });
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => e.stopPropagation());

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'page-del-btn';
      btnDel.replaceChildren(iconEl('xmark'));
      btnDel.title = t('app.printpage.remove');
      btnDel.setAttribute('aria-label', t('app.printpage.remove'));
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isPrintPageNode(n)) n.remove();
        });
        clearTranslationCache();
        scheduleRender();
        announce(t('app.printpage.removed'));
      });

      const btnFmt = document.createElement('button');
      btnFmt.type = 'button';
      btnFmt.className = 'page-fmt-btn';
      // Every print-page-change field is a transcriber tool (field-registry.mjs): hidden with the rest while Transcriber tools is off.
      if (bfKindIsTranscriberOnly('pagenum')) btnFmt.classList.add('fmt-transcriber');
      btnFmt.replaceChildren(iconEl('settings'));
      btnFmt.title = t('app.braille_fmt.pagenum_button');
      btnFmt.setAttribute('aria-label', t('app.braille_fmt.pagenum_button'));
      btnFmt.setAttribute('aria-haspopup', 'dialog');
      btnFmt.addEventListener('pointerdown', (e) => e.stopPropagation());
      btnFmt.addEventListener('click', (e) => { e.stopPropagation(); openBrailleFmtDialog(key); });

      el.appendChild(badge);
      el.appendChild(input);
      el.appendChild(btnFmt);
      el.appendChild(btnDel);
    }
  }
});

// ---- toolbar: block style ----
function applyBlockStyle(v) {
  try {
    const norm = (v === 'ul') ? 'bullet' : (v === 'ol') ? 'number' : (v === 'body' ? 'p' : (v || 'p'));
    if (norm === 'bullet' || norm === 'number') {
      editor.dispatchCommand(norm === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          let targetNode = sel.anchor.getNode();
          let listNode = null;
          while (targetNode && targetNode !== $getRoot()) {
            if ($isListNode(targetNode)) { listNode = targetNode; break; }
            targetNode = targetNode.getParent ? targetNode.getParent() : null;
          }
          if (listNode) {
            listNode.setListKind(null);
            listNode.setBanaStyle(null);
          }
        }
      });
    } else if (norm === 'toc' || norm === 'exercise' || norm === 'index' || norm === 'plain') {
      editor.dispatchCommand(norm === 'exercise' ? INSERT_ORDERED_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          let targetNode = sel.anchor.getNode();
          let listNode = null;
          while (targetNode && targetNode !== $getRoot()) {
            if ($isListNode(targetNode)) { listNode = targetNode; break; }
            targetNode = targetNode.getParent ? targetNode.getParent() : null;
          }
          if (listNode) {
            const lKind = norm;                       // 'plain' is its own list style (DTBook <list type="pl">), not an index
            listNode.setListKind(lKind);
            listNode.setBanaStyle(lKind);
            if (norm === 'index' || norm === 'plain') {
              if (typeof listNode.setListType === 'function') listNode.setListType('plain');
            }
          }
        }
      });
    } else if (norm === 'h1' || norm === 'h2' || norm === 'h3') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => $createHeadingNode(norm));
        }
      });
    } else if (['dialogue', 'stage', 'poem', 'caption', 'attribution', 'footnote', 'note', 'quote', 'code'].includes(norm)) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => $createBanaParagraphNode(norm));
        }
      });
    } else if (norm === 'sidebar') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      insertSidebar();
    } else if (norm === 'titlepage') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      insertTitlePage();
    } else if (norm === 'tnpage') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      insertTnPage();
    } else if (norm === 'sympage') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      insertSymPage();
    } else if (norm === 'table-spatial' || norm === 'table-listed') {
      const targetFmt = norm === 'table-listed' ? 'listed' : 'spatial';
      let switchedExisting = false;
      const activeInput = document.activeElement;
      const activeCell = (activeInput && activeInput.classList?.contains('table-cell-input')) ? activeInput : lastActiveTableCellInput;
      if (activeCell && editorEl.contains(activeCell)) {
        const be = activeCell.closest('[data-block-idx]');
        const bi = be ? Number(be.dataset.blockIdx) : NaN;
        if (!Number.isNaN(bi)) {
          editor.update(() => {
            const root = $getRoot();
            const children = root.getChildren();
            let count = 0;
            for (const child of children) {
              if ($isTableNode(child)) {
                if (count === bi) {
                  child.setFormat(targetFmt);
                  switchedExisting = true;
                  break;
                }
              }
              count++;
            }
          });
        }
      }
      if (!switchedExisting) {
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            let n = sel.anchor.getNode();
            while (n && n !== $getRoot()) {
              if ($isTableNode(n)) {
                n.setFormat(targetFmt);
                switchedExisting = true;
                break;
              }
              n = n.getParent ? n.getParent() : null;
            }
          }
        });
      }
      if (!switchedExisting) {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        insertTable(3, 3, targetFmt);
      } else {
        announce(t('app.table.format_changed', { format: t(`app.table.fmt_${targetFmt}`) }));
      }
    } else {
      // Default to paragraph for 'p' or any unrecognized style
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => $createParagraphNode());
        }
      });
    }
  } catch (err) {
    console.warn('applyBlockStyle safe recovery:', err);
    try {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) $setBlocksType(sel, () => $createParagraphNode());
      });
    } catch {}
  }
  editor.focus();
  refreshToolbar();
  const selectEl = $id('blockStyle');
  const label = selectEl?.selectedOptions[0]?.getAttribute('data-full') || selectEl?.selectedOptions[0]?.text || v;
  announce(label);
}
$id('blockStyle')?.addEventListener('change', (e) => { updateStyleMenuUI(); applyBlockStyle(e.target.value); });
// Feedback 30 Sep item 16 (Paul, 2 Oct): opening the style list (the browser's own dropdown) closes Emboss's open menus (Insert, the
// Braille menu, a title page's Field… menu), as they already close each other — the tester had the style list and Insert open together.
for (const ev of ['mousedown', 'focus']) $id('blockStyle')?.addEventListener(ev, () => closeAllDropdownMenus());

// F-39 — BANA Formats §1.9.3: "Blocked Paragraph" toggle, alongside (not instead of) the
// blockStyle dropdown above — it layers a `blocked` flag onto whichever paragraph(s) the
// selection touches, the way bold/italic/underline layer onto text, rather than replacing
// the paragraph's own style the way the dropdown does.
function nearestParagraphNode(node) {
  let n = node;
  while (n && n !== $getRoot()) {
    if (typeof n.getBlocked === 'function' && typeof n.setBlocked === 'function') return n;
    n = n.getParent ? n.getParent() : null;
  }
  return null;
}
// 1-1 and 5-5 apply only to a Body Text paragraph: the formatter honours `blocked` / `directions` on plain paragraphs
// alone (a quote, poem, note, caption… ignores them), so elsewhere the buttons are greyed out (Paul, 24 Sep).
function isBodyParagraph(p) {
  const style = p && typeof p.getBanaStyle === 'function' ? p.getBanaStyle() : null;
  return !!p && (!style || style === 'body');
}
// The Body Text paragraphs the selection touches (or the one the caret was last in).
function selectedBodyParagraphs() {
  const paras = new Set();
  const sel = $getSelection();
  if ($isRangeSelection(sel)) for (const n of sel.getNodes()) { const p = nearestParagraphNode(n); if (isBodyParagraph(p)) paras.add(p); }
  if (!paras.size && lastActiveEditorSelection?.anchorKey) {
    const p = nearestParagraphNode($getNodeByKey(lastActiveEditorSelection.anchorKey));
    if (isBodyParagraph(p)) paras.add(p);
  }
  return paras;
}
function toggleBlockedParagraph() {
  editor.update(() => {
    const paras = selectedBodyParagraphs();
    if (!paras.size) return;
    const anyBlocked = [...paras].some((p) => p.getBlocked());
    for (const p of paras) p.setBlocked(!anyBlocked);
  });
  clearTranslationCache();
  scheduleRender();
  refreshToolbar();
}
$id('btnBlockedPara')?.addEventListener('click', toggleBlockedParagraph);
// BANA Formats §10.3.2: "Use 5-5 margins for unnumbered or unlettered directions." — the same kind of
// per-paragraph toggle as the blocked-paragraph button, stored as fmt.directions (see installFmt).
function toggleDirectionsParagraph() {
  editor.update(() => {
    const paras = selectedBodyParagraphs();
    if (!paras.size) return;
    const anyDir = [...paras].some((p) => (fmtOf(p) || {}).directions);
    for (const p of paras) p.setFmt({ ...(fmtOf(p) || {}), directions: !anyDir });
  });
  clearTranslationCache();
  scheduleRender();
  refreshToolbar();
}
$id('btnDirectionsPara')?.addEventListener('click', toggleDirectionsParagraph);

// ---- "Braille formatting…" dialog: the optional formatter fields (fmt) of the focused block ----
// One native <dialog> (#brailleFmtDialog) that shows only the fields the focused block type has.
// Applying writes them to the node's fmt (or, for a table, its subdivision fields) in ONE
// editor.update, so it is one undo step. Opened by #btnBrailleFmt, Ctrl/Cmd+Alt+B, the slash menu
// ("/braille") and the "Braille formatting" button on a table's context bar.
// The fieldsets and their controls are BUILT from format/field-registry.mjs (GROUPS + each field's `ui`): labels, help,
// control type, grouping, which block kinds show a fieldset, and the audience tag the "Transcriber tools" setting
// filters on. Reading and writing a control goes through the registry's CODECS; the few controls whose value does not
// live in the node's own fmt (list numbering / bullets / level symbols / item fonts, a table's subdivision fields and
// guide dots) are the explicit BF_SPECIAL code below.

// ---- "Transcriber tools" (Paul's decision, 24 Sep 2026; docs/transcriber-tools-setting.md) ----
// Off by default. When off, every control whose registry audience is 'transcriber' is hidden (CSS: body without
// .transcriber-tools hides .fmt-transcriber), as are the transcriber page styles in the dropdown / slash menu and the
// Notes… / Regenerate buttons. It only hides tools: the braille never depends on it, and a document that already carries
// a field or a page keeps showing and saving it (hidden controls keep their values when the dialog applies).
const audienceVisible = (audience) => audience !== 'transcriber' || transcriberTools;
// Leave the dropdown's transcriber styles out while Transcriber tools is off — except the style of the block the caret
// is in, which stays listed so the user can see what it is and change it (Paul, 26 Sep). They are removed from the
// select rather than marked hidden: Safari's dropdown ignores `hidden` on an option (Paul, 30 Sep). `value` is the style
// to show as selected (default: the current one); it is always kept in the list, so this is also the way to set it.
function syncStyleOptionVisibility(value) {
  const sel = $id('blockStyle');
  if (!sel) return;
  const wanted = value ?? sel.value;
  const audience = new Map(BLOCK_STYLES.map((d) => [d.value, d.audience]));
  const when = new Map(BLOCK_STYLES.map((d) => [d.value, d.when]));   // UK-8: e.g. sympage's `when` keeps it out of UKAAF mode
  const shown = allBlockStyleOptions.filter((opt) => {
    const w = when.get(opt.value);
    return opt.value === wanted || (audienceVisible(audience.get(opt.value)) && !(w && !w()));
  });
  const current = [...sel.options];
  if (shown.length !== current.length || shown.some((o, i) => o !== current[i])) sel.replaceChildren(...shown);
  if (sel.value !== wanted) sel.value = wanted;
  updateStyleMenuUI();   // the style button (F9 C1) follows the select
}
// The Title field above the text (Paul, 7 Oct 2026): shown with Transcriber tools on, hidden for everyone else, unless the setting
// "Show the Title field above the text" has been ticked or unticked (settings.showTitleField true / false; null = follow Transcriber tools).
function titleFieldShown() { return settings.showTitleField == null ? transcriberTools : settings.showTitleField === true; }
function applyTitleFieldVisibility() {
  const row = $id('docTitleRow');
  if (row) row.hidden = !titleFieldShown();
  const box = $id('set-showTitleField');
  if (box) box.checked = titleFieldShown();
}
function applyTranscriberTools() {
  document.body.classList.toggle('transcriber-tools', transcriberTools);
  applyTitleFieldVisibility();
  syncStyleOptionVisibility();
  for (const id of TRANSCRIBER_BUTTONS) { const b = $id(id); if (b) b.classList.add('fmt-transcriber'); }  // CSS hides them while off
  for (const g of FIELD_GROUPS) {                  // a fieldset whose controls are all transcriber tools goes too
    const el = $id(g.id);
    if (el) el.classList.toggle('fmt-transcriber', groupControlIds(g).every((id) => (controlById(id) || {}).audience === 'transcriber'));
  }
  try { updateTnSuggestBtn(); updateSymRegenBtn(); updateUnboxBtn(); refreshToolbar(); } catch (err) { /* before the editor is up: the buttons start hidden */ }
}

// Build one control from its registry entry (the markup the hand-written dialog used, so styles and tests still apply).
function buildFmtControl(ctl) {
  const mk = (tag, attrs = {}, text) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };
  const helpId = ctl.help != null ? (ctl.helpId || `${ctl.id}Help`) : null;
  const describedBy = ctl.describedBy || helpId;
  const helpEl = () => mk('span', { id: helpId, class: 'fmt-help', 'data-i18n': ctl.helpKey }, ctl.help);
  let wrap;
  if (ctl.control === 'check') {
    wrap = mk('div', { class: 'fmt-check' });
    wrap.append(mk('input', { type: 'checkbox', id: ctl.id, 'aria-describedby': describedBy }));
    if (helpId) {
      const label = mk('label', { for: ctl.id });
      label.append(mk('span', { 'data-i18n': ctl.labelKey }, ctl.label), mk('br'), helpEl());
      wrap.append(label);
    } else wrap.append(mk('label', { for: ctl.id, 'data-i18n': ctl.labelKey }, ctl.label));
  } else {
    wrap = mk('div', { class: 'fmt-field' });
    let label;
    if (ctl.labelExtraId) {
      label = mk('label', { for: ctl.id });
      label.append(mk('span', { 'data-i18n': ctl.labelKey }, ctl.label), document.createTextNode(' '), mk('span', { id: ctl.labelExtraId }));
    } else label = mk('label', { for: ctl.id, 'data-i18n': ctl.labelKey }, ctl.label);
    let input;
    if (ctl.control === 'select') {
      input = mk('select', { id: ctl.id, 'aria-describedby': describedBy });
      for (const o of ctl.options) input.append(mk('option', { value: o.value, 'data-i18n': o.key }, o.text));
    } else if (ctl.control === 'textarea') {
      input = mk('textarea', { id: ctl.id, ...(ctl.attrs || {}), 'aria-describedby': describedBy });
    } else {
      input = mk('input', { type: ctl.control === 'number' ? 'number' : 'text', id: ctl.id, ...(ctl.attrs || {}), ...(ctl.control === 'text' ? { autocomplete: 'off' } : {}), 'aria-describedby': describedBy });
    }
    wrap.append(label, input);
    if (helpId) wrap.append(helpEl());
    if (ctl.statusId) wrap.append(mk('span', { id: ctl.statusId, role: 'alert', style: 'color:var(--danger);' }));
  }
  wrap.dataset.field = ctl.field;
  if (ctl.audience === 'transcriber') wrap.classList.add('fmt-transcriber');
  return wrap;
}
function buildFmtGroupControls(g, host) {
  for (const item of g.controls) {
    if (typeof item === 'string') { const ctl = controlById(item); if (ctl) host.append(buildFmtControl(ctl)); continue; }
    if (item.note) {
      const p = document.createElement('p');
      p.id = item.note; p.className = 'fmt-help'; p.hidden = true; p.dataset.i18n = item.key; p.textContent = item.text;
      if (item.audience === 'transcriber') p.classList.add('fmt-transcriber');
      host.append(p);
    } else if (item.wrap) {
      const div = document.createElement('div');
      div.id = item.wrap; div.hidden = true;
      for (const id of item.controls) { const ctl = controlById(id); if (ctl) div.append(buildFmtControl(ctl)); }
      host.append(div);
    }
  }
}
// The dialog's fieldsets (into #brailleFmtGroups) and the Settings "Braille formatting options" group (into
// #docOptionsGroup, after its legend and intro). Runs once at start-up, before initI18n translates the page.
(function buildFieldControls() {
  const box = $id('brailleFmtGroups');
  for (const g of FIELD_GROUPS) {
    if (g.settings) { const fs = $id(g.id); if (fs && !fs.querySelector('input, select, textarea')) buildFmtGroupControls(g, fs); continue; }
    if (!box || $id(g.id)) continue;
    const fs = document.createElement('fieldset');
    fs.id = g.id; fs.hidden = true;
    const lg = document.createElement('legend');
    lg.dataset.i18n = g.legendKey; lg.textContent = g.legend;
    fs.append(lg);
    buildFmtGroupControls(g, fs);
    box.append(fs);
  }
  applyTranscriberTools();
})();

// Which block the caret is in, its fmt, and the values that do not live in fmt (`special`, keyed by control id).
// Runs in a read; null = nothing to set.
function bfResolveTarget(tableKey) {
  let out = null;
  editor.getEditorState().read(() => {
    const up = (n, pred) => { while (n && n !== $getRoot()) { if (pred(n)) return n; n = n.getParent ? n.getParent() : null; } return null; };
    let tk = tableKey || null;
    if (!tk && document.activeElement) {
      const hit = $getRoot().getChildren().find((tn) => { if (!$isTableNode(tn)) return false; const el = editor.getElementByKey(tn.getKey()); return el && el.contains(document.activeElement); });
      if (hit) tk = hit.getKey();
    }
    if (tk) {
      const tn = $getNodeByKey(tk);
      if ($isPrintPageNode(tn)) { out = { kind: 'pagenum', key: tk, fmt: fmtOf(tn) || {}, special: {} }; return; }
      if (!$isTableNode(tn)) return;
      const rows = tn.getSubdivisionRows();
      const tblRows = tn.getRows() || [];
      const colCount = Math.max((tn.getHeaders() || []).length, ...tblRows.map((r) => r.length), 1);
      // K35: block.columnAlign (TableNode.getColumnAlign, K3), shown one non-follow column per line.
      const colAlign = typeof tn.getColumnAlign === 'function' ? tn.getColumnAlign() : null;
      const fmtColumnAlign = Array.isArray(colAlign) ? colAlign.map((v, i) => (v ? `${i + 1}: ${v}` : null)).filter(Boolean).join('\n') : '';
      out = { kind: 'table', key: tk, fmt: fmtOf(tn) || {}, rowCount: tblRows.length, colCount, special: {
        fmtSubRows: rows ? rows.map((i) => i + 1).join(', ') : '', fmtSubHeading: tn.getSubdivisionHeading() || '',
        fmtGuideDots: !(typeof tn.getNoGuideDots === 'function' && tn.getNoGuideDots()), stairstep: tn.getFormat() === 'stairstep',
        fmtColumnAlign,
      } };
      return;
    }
    const sel = $getSelection();
    let nodes = [];
    let anchor = null;
    if ($isRangeSelection(sel)) { nodes = sel.getNodes(); anchor = sel.anchor.getNode(); }
    if (!anchor && lastActiveEditorSelection?.anchorKey) { anchor = $getNodeByKey(lastActiveEditorSelection.anchorKey); if (anchor) nodes = [anchor]; }
    if (!anchor) return;
    const li = up(anchor, $isListItemNode);
    if (li) {
      let top = li;
      while (top.getParent() && ($isListNode(top.getParent()) || $isListItemNode(top.getParent()))) top = top.getParent();
      const items = new Map();
      for (const n of nodes.length ? nodes : [li]) { const x = up(n, $isListItemNode); if (x && !x.getChildren().some((c) => $isListNode(c))) items.set(x.getKey(), x); }
      if (!items.size) items.set(li.getKey(), li);
      const names = new Set([...items.values()].map((x) => { const f = fmtOf(x) || {}; return bulletName(f.bullet || f.bulletMarker) || ''; }));
      const lf = $isListNode(top) ? (fmtOf(top) || {}) : {};
      // G8 stage 3: numbering of the caret's level (its sibling group) and the list's bullet glyphs by level
      let enumVal = '', startVal = '', level = 0;
      if ($isListNode(top)) {
        const its = listItemsForPlan(top);
        const idx = its.findIndex((x) => x.node.getKey() === li.getKey());
        if (idx >= 0) {
          const { gi } = listGroups(its);
          const g = its[gi[idx]], gf = g.fmt || {};
          level = its[idx].level;
          const kind = planListMarkers(its, top.getListType() === 'bullet' ? 'bullet' : 'number', lf.symbols)[idx].kind;
          if (kind === 'bullet') enumVal = 'bullet';
          else if (LIST_ENUMS.includes(gf.enum)) enumVal = gf.enum;
          else if (g.kept && g.kept !== NO_MARKER) enumVal = /^\d+\./.test(g.kept) ? '1' : /^[a-z]\./.test(g.kept) ? 'a' : /^[A-Z]\./.test(g.kept) ? 'A' : '';
          startVal = gf.start || '';
        }
      }
      const symSeq = Array.isArray(lf.symbols) && lf.symbols.length ? lf.symbols : null;
      const sym = [0, 1, 2].map((i) => (symSeq ? symSeq[Math.min(i, symSeq.length - 1)] : ''));
      const listKind = (typeof top.getListKind === 'function' ? top.getListKind() : null) || (typeof top.getBanaStyle === 'function' ? top.getBanaStyle() : null);
      const itemIgnoreFontNames = new Set([...items.values()].map((x) => !!(fmtOf(x) || {}).ignoreFont));
      out = { kind: 'list', key: top.getKey(), liKey: li.getKey(), itemKeys: [...items.keys()], fmt: lf, level, special: {
        fmtBullet: names.size === 1 ? [...names][0] : '', fmtEnum: enumVal, fmtStart: startVal, fmtSym0: sym[0], fmtSym1: sym[1], fmtSym2: sym[2],
        fmtItemIgnoreFont: itemIgnoreFontNames.size === 1 && [...itemIgnoreFontNames][0], isGlossary: listKind === 'glossary',
      } };
      return;
    }
    const h = up(anchor, $isHeadingNode);
    if (h && $isSidebarNode(h.getParent())) {
      // The box's own title heading: braille formatting here means the box itself (box lines /
      // page break), not the heading fields (a box title is never "not connected"/"accompanies a box").
      const box = h.getParent();
      out = { kind: 'box', key: box.getKey(), fmt: fmtOf(box) || {}, special: {} };
      return;
    }
    if (h) { out = { kind: 'heading', key: h.getKey(), fmt: fmtOf(h) || {}, special: {} }; return; }
    const p = up(anchor, (n) => typeof n.getBlocked === 'function' && typeof n.setBlocked === 'function');
    if (!p) return;
    const f = fmtOf(p) || {};
    const style = typeof p.getBanaStyle === 'function' ? p.getBanaStyle() : null;
    let kind = null;
    if (style === 'note' || f.xref) kind = 'note';
    else if (style === 'footnote') kind = 'footnote';
    else if (style === 'dialogue' || style === 'play-speaker' || style === 'speaker') kind = 'speaker';
    else if (style === 'poem' || style === 'verse' || style === 'play-verse' || style === 'exercise') kind = 'verse';
    else if (style === 'caption') kind = 'caption';   // F-4: identifier before the caption (BANA 11.2.8b)
    else if (f.directions) kind = 'directions';
    // A genuinely empty, untyped paragraph has nothing to format yet (matches the pre-existing "no extra braille
    // formatting" message for a fresh paragraph); one with text, or one that already carries a fmt field, gets the
    // dialog. A slash query in progress ("/braillefo…") is stripped first, so it does not itself count as "text"
    // (this is evaluated live, including whatever the user has typed into the slash box so far).
    else if ((!style || style === 'body') && (p.getTextContent().replace(/\/[a-zA-Z]*$/, '').trim() !== '' || fmtOf(p))) kind = 'para';
    if (kind) out = { kind, key: p.getKey(), fmt: f, special: {} };
  });
  return out;
}
// A kind has something to offer when one of its controls is for this audience (Transcriber tools off hides the rest).
const bfKindIsTranscriberOnly = (kind) => groupsForKind(kind).every((g) => groupControlIds(g).every((id) => (controlById(id) || {}).audience === 'transcriber'));
const bfKindHasVisibleControls = (kind) => groupsForKind(kind).some((g) => groupControlIds(g).some((id) => audienceVisible((controlById(id) || {}).audience)));
const bfHasTarget = () => { try { const r = bfResolveTarget(null); return !!r && bfKindHasVisibleControls(r.kind); } catch (err) { console.warn('bfHasTarget', err); return false; } };

// The fmt key a control's value lives under (boxLines is kept as fmt.noBoxLines on the box node).
const bfFmtKey = (ctl) => (fieldByKey(ctl.field) || {}).fmtKey || ctl.field;
const bfIsComposite = (ctl) => ctl.part != null;
// Value to show in a control for this target.
function bfReadControl(ctl, target) {
  if (ctl.codec === 'special') return target.special[ctl.id];
  const codec = FIELD_CODECS[ctl.codec];
  const v = codec.read(target.fmt[bfFmtKey(ctl)], ctl);
  return bfIsComposite(ctl) ? v[ctl.part] : v;
}
// The wrap / note of a group that is shown for this target (the glossary options only for a glossary list; the
// stairstep note only when the table is NOT stairstep).
const bfWrapShown = (id, target) => (id === 'fmtListGlossaryWrap' ? !!target.special.isGlossary : true);
const bfNoteShown = (id, target) => (id === 'fmtTableNote' ? !target.special.stairstep : true);

function openBrailleFmtDialog(tableKey) {
  const dlg = $id('brailleFmtDialog');
  if (!dlg || dlg.open) return;
  // The Layout dialog is a transcriber tool (Paul, 25 Sep; feedback item 5, 1 Oct): whichever way it is reached, it stays shut while
  // Transcriber tools is off (its buttons are hidden then; this is the guard behind them).
  if (!transcriberToolsOn()) { announce(tOr('app.braille_fmt.transcriber_only', 'The formatting options for this block are transcriber tools. Turn on Transcriber tools in Settings to see them.')); return; }
  const target = bfResolveTarget(tableKey || null);
  if (!target) { announce(t('app.braille_fmt.none')); return; }
  if (!bfKindHasVisibleControls(target.kind)) { announce(tOr('app.braille_fmt.transcriber_only', 'The formatting options for this block are transcriber tools. Turn on Transcriber tools in Settings to see them.')); return; }
  const set = (id, val) => { const el = $id(id); if (!el) return; if (el.type === 'checkbox') el.checked = !!val; else el.value = val == null ? '' : String(val); };
  const shown = groupsForKind(target.kind);
  for (const g of FIELD_GROUPS) { if (g.settings) continue; const el = $id(g.id); if (el) el.hidden = !shown.includes(g); }
  for (const g of shown) {
    for (const item of g.controls) {
      if (item && item.wrap) { const w = $id(item.wrap); if (w) w.hidden = !bfWrapShown(item.wrap, target); }
      if (item && item.note) { const n = $id(item.note); if (n) n.hidden = !bfNoteShown(item.note, target); }
    }
    for (const id of groupControlIds(g)) set(id, bfReadControl(controlById(id), target));
    // A fieldset whose every control is hidden for this audience is not shown either.
    const fsEl = $id(g.id);
    if (fsEl && !groupControlIds(g).some((id) => audienceVisible((controlById(id) || {}).audience))) fsEl.hidden = true;
  }
  if (target.kind === 'list') { const lv = $id('fmtEnumLevel'); if (lv) lv.textContent = t('app.braille_fmt.enum_level', { level: target.level + 1 }); }
  const hint = tOr(`app.braille_fmt.hint_${target.kind}`, '');
  const hintEl = $id('brailleFmtHint'); if (hintEl) hintEl.textContent = hint;
  const st = $id('brailleFmtStatus'); if (st) st.textContent = '';
  bfState = { target, opener: document.activeElement };
  dlg.showModal();
  // Focus the group's first field (the list's numbering), or the first one this audience can see.
  const g0 = shown[0];
  const want = g0 && (g0.first || groupControlIds(g0)[0]);
  const visible = (el) => el && !el.disabled && el.getClientRects().length;
  const first = visible($id(want)) ? $id(want) : [...dlg.querySelectorAll('fieldset:not([hidden]) input, fieldset:not([hidden]) select, fieldset:not([hidden]) textarea')].find(visible);
  if (first) first.focus();
}
let bfState = null;

function closeBrailleFmtDialog() {
  const dlg = $id('brailleFmtDialog');
  if (dlg && dlg.open) dlg.close();
}

// G8 stage 3: numbering style + start for the sibling group of the item `liKey` (call inside editor.update).
// Every item of the group loses its kept print marker so the print view, braille and save all follow enum/start.
function applyGroupNumbering(list, liKey, en, start) {
  if (!$isListNode(list)) return;
  const its = listItemsForPlan(list);
  const idx = its.findIndex((x) => x.node.getKey() === liKey);
  if (idx < 0) return;
  const { gi } = listGroups(its);
  const members = its.filter((_, i) => gi[i] === gi[idx]);
  const lvl = its[idx].level;
  const put = (node, o) => node.setFmt({ ...(fmtOf(node) || {}), ...o });
  if (en !== 'bullet' && list.getListType() === 'bullet') {     // a numbered group inside a bulleted list: the list becomes numbered, its other bullets keep their bullet
    list.setListType('number');
    for (const it of its) if (!members.includes(it) && !it.kept) it.node.setMarker('•');
  }
  const numbered = list.getListType() !== 'bullet';
  members.forEach((m, i) => {
    m.node.setMarker(en === 'bullet' && numbered ? '•' : null);
    const first = i === 0 && en !== 'bullet';
    const enumV = first ? (en || (start > 1 ? defaultEnumForLevel(lvl) : null)) : null;
    put(m.node, { enum: enumV, start: first && start > 1 ? start : null });
  });
}

// Controls whose value does not live in the focused node's own fmt: validate(ctx) -> error key or null (in control order,
// like every other field), apply(ctx) inside the one editor.update. ctx: { target, n (node), val, chk, put, data }.
const BF_SPECIAL = {
  fmtStart: {
    validate: (c) => {
      const sraw = c.val('fmtStart');
      c.data.startN = 0;
      if (sraw) { c.data.startN = Number(sraw); if (!/^\d+$/.test(sraw) || c.data.startN < 1 || c.data.startN > 9999) return 'app.braille_fmt.err_start'; }
      return null;
    },
  },
  fmtSym0: {
    apply: (c) => {
      const sv = c.target.special;
      const symVals = [0, 1, 2].map((i) => $id(`fmtSym${i}`).value);
      if (symVals.some((g, i) => g !== sv[`fmtSym${i}`])) c.put(c.n, { symbols: symVals.every((g) => !g) ? null : symVals.map((g, i) => g || LIST_DEFAULT_GLYPHS[i]) });
    },
  },
  fmtEnum: {
    apply: (c) => {
      const sv = c.target.special;
      const enVal = $id('fmtEnum').value;
      if (enVal !== sv.fmtEnum || String(c.data.startN || '') !== String(sv.fmtStart || '')) applyGroupNumbering(c.n, c.target.liKey, enVal, c.data.startN);
    },
  },
  fmtBullet: {
    apply: (c) => {   // Only touch the bullet when the user picked something different from what was shown.
      const b = $id('fmtBullet').value;
      if (b !== c.target.special.fmtBullet) for (const k of c.target.itemKeys) c.put($getNodeByKey(k), { bullet: b || null, bulletMarker: null });
    },
  },
  fmtItemIgnoreFont: {
    apply: (c) => {
      const itemIgnore = c.chk('fmtItemIgnoreFont');
      if (itemIgnore !== !!c.target.special.fmtItemIgnoreFont) for (const k of c.target.itemKeys) c.put($getNodeByKey(k), { ignoreFont: itemIgnore });
    },
  },
  fmtSubRows: {
    validate: (c) => {
      const raw = c.val('fmtSubRows');
      c.data.subRows = [];
      if (raw) {
        const parts = raw.split(/[,\s]+/).filter(Boolean);
        if (!parts.every((x) => /^\d+$/.test(x) && Number(x) >= 1)) return 'app.braille_fmt.err_rows';
        c.data.subRows = [...new Set(parts.map((x) => Number(x) - 1))].sort((a, b) => a - b);
      }
      return null;
    },
    apply: (c) => { if ($isTableNode(c.n)) c.n.setSubdivisionRows(c.data.subRows); },
  },
  fmtSubHeading: { apply: (c) => { if ($isTableNode(c.n)) c.n.setSubdivisionHeading(c.val('fmtSubHeading')); } },
  fmtGuideDots: { apply: (c) => { if ($isTableNode(c.n)) c.n.setNoGuideDots(!c.chk('fmtGuideDots')); } },
  // K35: block.columnAlign (TableNode.getColumnAlign/setColumnAlign, K3) — one line per
  // column that is not simply following print, "N: left"/"N: right"/"N: decimal" (N counts
  // from 1). A column left out of the text keeps following print (numericAlignApplies).
  fmtColumnAlign: {
    validate: (c) => {
      const raw = c.val('fmtColumnAlign');
      c.data.columnAlign = null;
      if (!raw) return null;
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const out = [];
      const seen = new Set();
      for (const line of lines) {
        const m = /^(\d+)\s*:\s*(left|right|decimal)\s*$/i.exec(line);
        const n = m && Number(m[1]);
        if (!m || n < 1 || n > c.colCount || seen.has(n)) return 'app.braille_fmt.err_column_align';
        seen.add(n);
        out[n - 1] = m[2].toLowerCase();
      }
      c.data.columnAlign = out.length ? out : null;
      return null;
    },
    apply: (c) => { if ($isTableNode(c.n)) c.n.setColumnAlign(c.data.columnAlign); },
  },
};

const BF_SPECIAL_ORDER = ['fmtSubRows', 'fmtSubHeading', 'fmtGuideDots', 'fmtColumnAlign', 'fmtSym0', 'fmtEnum', 'fmtBullet', 'fmtItemIgnoreFont'].map((id) => BF_SPECIAL[id]);

function applyBrailleFmt() {
  const st = bfState;
  if (!st) return;
  const { target } = st;
  const { kind, key } = target;
  const val = (id) => { const el = $id(id); return el ? el.value.trim() : ''; };
  const chk = (id) => !!$id(id)?.checked;
  const fail = (msg, id) => { const s = $id('brailleFmtStatus'); if (s) s.textContent = msg; const el = id && $id(id); if (el) el.focus(); };
  const ctx = { target, val, chk, data: {}, rowCount: target.rowCount || 0, colCount: target.colCount || 0 };
  // Pass 1: read and check every shown control, in dialog order; nothing is written until all are valid.
  const patch = {};
  const specials = [];
  const doneComposite = new Set();
  for (const g of groupsForKind(kind)) {
    for (const item of g.controls) {
      const ids = typeof item === 'string' ? [item] : (item.wrap && bfWrapShown(item.wrap, target) ? item.controls : []);
      for (const id of ids) {
        const ctl = controlById(id);
        if (!ctl) continue;
        if (ctl.codec === 'special') {
          const sp = BF_SPECIAL[id];
          if (sp && sp.validate) { const err = sp.validate(ctx); if (err) return fail(t(err), id); }
          if (sp && sp.apply) specials.push(sp);
          continue;
        }
        const codec = FIELD_CODECS[ctl.codec];
        let res;
        if (bfIsComposite(ctl)) {
          const ck = `${g.id}:${ctl.field}`;
          if (doneComposite.has(ck)) continue;
          doneComposite.add(ck);
          const partCtls = groupControlIds(g).map(controlById).filter((c) => c && c.field === ctl.field);
          const parts = Object.fromEntries(partCtls.map((c) => [c.part, c.control === 'check' ? chk(c.id) : val(c.id)]));
          res = codec.write(parts, ctl, ctx);
          if (res.err) return fail(t(res.err, res.params), (partCtls.find((c) => c.part === res.part) || ctl).id);
        } else {
          res = codec.write(ctl.control === 'check' ? chk(id) : val(id), ctl, ctx);
          if (res.err) return fail(t(res.err, res.params), id);
          if (ctl.requires && !chk(ctl.requires)) res = { value: null };
        }
        patch[bfFmtKey(ctl)] = res.value;
      }
    }
  }
  const put = (node, o) => { if (node && typeof node.setFmt === 'function') node.setFmt({ ...(fmtOf(node) || {}), ...o }); };
  specials.sort((a, b) => BF_SPECIAL_ORDER.indexOf(a) - BF_SPECIAL_ORDER.indexOf(b));   // the order the hand-written dialog applied them in
  editor.update(() => {
    const n = $getNodeByKey(key);
    if (!n) return;
    if (kind === 'table' && !$isTableNode(n)) return;
    put(n, patch);
    const c = { ...ctx, n, put };
    for (const sp of specials) sp.apply(c);
  });
  clearTranslationCache();
  scheduleRender();
  refreshToolbar();
  st.applied = true;
  closeBrailleFmtDialog();
}

(function initBrailleFmtDialog() {
  const dlg = $id('brailleFmtDialog');
  if (!dlg) return;
  $id('btnBrailleFmt')?.addEventListener('click', () => openBrailleFmtDialog());
  $id('brailleFmtForm')?.addEventListener('submit', (e) => { e.preventDefault(); applyBrailleFmt(); });
  $id('brailleFmtCancel')?.addEventListener('click', closeBrailleFmtDialog);
  $id('brailleFmtClose')?.addEventListener('click', closeBrailleFmtDialog);
  // Escape (the native "cancel") and every other close end here: put focus back where it was
  // (the editor, with the caret on the block, when the dialog was opened from the keyboard).
  // Native showModal keeps focus inside the page but lets Tab step out to the browser; wrap it.
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.getClientRects().length);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  dlg.addEventListener('close', () => {
    if (dlg.open) return;   // reopened before this (queued) close event ran: the new opening owns bfState and focus
    const st = bfState; bfState = null;
    if (!st) return;
    const op = st.opener;
    if (op && document.contains(op) && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(op.tagName)) op.focus();
    else editor.focus();
    if (st.applied) announce(t('app.braille_fmt.applied'));
  });
})();
window.openBrailleFmtDialog = openBrailleFmtDialog;

let savedLexicalBlockKey = null;
let lastKnownEditorBlockIndex = null;

function saveCurrentLexicalBlock() {
  try {
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel) && sel.anchor.key !== 'root') {
        lastActiveEditorSelection = {
          anchorKey: sel.anchor.key,
          anchorOffset: sel.anchor.offset,
          focusKey: sel.focus.key,
          focusOffset: sel.focus.offset,
        };
        const target = sel.anchor.getNode();
        const top = target.getTopLevelElement();
        if (top) {
          savedLexicalBlockKey = top.getKey();
        }
      }
    });
  } catch (_) {}
}

function updateEditorBlockIndex() {
  saveCurrentLexicalBlock();
  try {
    const domSel = window.getSelection();
    if (domSel && domSel.anchorNode && editorEl.contains(domSel.anchorNode)) {
      const targetChild = domSel.anchorNode.nodeType === 1
        ? domSel.anchorNode.closest('#editor > *')
        : domSel.anchorNode.parentElement?.closest('#editor > *');
      if (targetChild) {
        const idx = Array.from(editorEl.children).indexOf(targetChild);
        if (idx >= 0) {
          lastKnownEditorBlockIndex = idx;
        }
      }
    }
  } catch (_) {}
}

editorEl.addEventListener('pointerdown', updateEditorBlockIndex, { passive: true });
editorEl.addEventListener('pointerup', () => {
  updateEditorBlockIndex();
  syncCaretWithBraille();
  refreshToolbar();
}, { passive: true });
editorEl.addEventListener('keyup', (e) => {
  updateEditorBlockIndex();
  syncCaretWithBraille();
  refreshToolbar();
}, { passive: true });
editorEl.addEventListener('click', () => {
  updateEditorBlockIndex();
  refreshToolbar();
}, { passive: true });
document.addEventListener('selectionchange', () => {
  updateEditorBlockIndex();
  syncCaretWithBraille();
  refreshToolbar();
}, { passive: true });

function insertMathEquation(latex = '', label = t('app.editor.equation_inserted')) {
  let key = null;
  editor.update(() => {
    const node = $createMathNode(latex);
    const p = $createParagraphNode();
    p.append(node);

    let inserted = false;
    const rootChildren = $getRoot().getChildren();

    if (lastKnownEditorBlockIndex != null && lastKnownEditorBlockIndex >= 0 && lastKnownEditorBlockIndex < rootChildren.length) {
      const targetNode = rootChildren[lastKnownEditorBlockIndex];
      if (targetNode && targetNode.isAttached()) {
        targetNode.insertAfter(p);
        inserted = true;
      }
    }

    if (!inserted && savedLexicalBlockKey) {
      try {
        const top = $getNodeByKey(savedLexicalBlockKey);
        if (top && top.isAttached()) {
          top.insertAfter(p);
          inserted = true;
        }
      } catch (_) {}
    }

    if (!inserted) {
      const sel = $getSelection();
      if ($isRangeSelection(sel) && sel.anchor.key !== 'root') {
        const target = sel.anchor.getNode();
        const top = target.getTopLevelElement();
        if (top && top.isAttached()) {
          top.insertAfter(p);
          inserted = true;
        } else {
          $insertNodes([node]);
          inserted = true;
        }
      }
    }

    if (!inserted) {
      $getRoot().append(p);
    }

    key = node.getKey();
    savedLexicalBlockKey = null;
  });
  announce(label);
  setTimeout(() => {
    const el = key && editor.getElementByKey(key);
    const mf = el?.querySelector('math-field');
    if (mf) {
      mf.focus({ preventScroll: true });
    }
  }, 80);
}

// ---- Insert Dropdown Menu ----
const insertMenuBtn = $id('btnInsertMenu');
const insertDropdown = $id('insertDropdown');
const insertMenuWrap = $id('insertMenuWrap');

function closeInsertMenu() {
  if (insertDropdown && !insertDropdown.hidden) {
    insertDropdown.hidden = true;
    insertMenuBtn?.setAttribute('aria-expanded', 'false');
  }
}

function toggleInsertMenu() {
  if (!insertDropdown) return;
  const willShow = insertDropdown.hidden;
  closeAllDropdownMenus();
  insertDropdown.hidden = !willShow;
  insertMenuBtn?.setAttribute('aria-expanded', String(willShow));
  if (willShow) {
    if (insertMenuWrap) {
      // Open to the right of the button if it fits, else to the left, else pinned inside the window's edge.
      const rect = insertMenuWrap.getBoundingClientRect();
      const dropWidth = insertDropdown.offsetWidth || 240;
      let left = 0;
      if (rect.left + dropWidth > window.innerWidth - 8) {
        left = rect.right - dropWidth >= 8 ? rect.width - dropWidth : 8 - rect.left;
      }
      insertDropdown.style.left = `${left}px`;
      insertDropdown.style.right = 'auto';
    }
    const firstItem = insertDropdown.querySelector('.insert-item:not([style*="display: none"])');
    firstItem?.focus({ preventScroll: true });
  }
}

function closeAllDropdownMenus() {
  closeInsertMenu();
  closeStyleMenu(false);      // the style menu (F9 C1)
  const dlMenu = $id('downloadMenu');
  const dlBtn = $id('downloadBtn');
  if (dlMenu && !dlMenu.hidden) {
    dlMenu.hidden = true;
    dlBtn?.setAttribute('aria-expanded', 'false');
  }
  closeTpInsertFieldMenu();   // K29 Stage 1d "Insert field" combobox
}

insertMenuBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleInsertMenu();
});

insertDropdown?.querySelectorAll('.insert-item').forEach((item) => {
  item.addEventListener('click', () => {
    closeInsertMenu();
  });
});

// K29 Stage 1d "Insert field": the title page card's own combobox toggle (updateTpInsertFieldBtn shows/
// hides the button; renderTpInsertFieldMenu/insertTitlePageField do the work, both above).
$id('btnTpInsertField')?.addEventListener('click', (e) => { e.stopPropagation(); toggleTpInsertFieldMenu(); });

document.addEventListener('click', (e) => {
  if (!e.target.closest('#insertMenuWrap') && !e.target.closest('#downloadMenuWrap') && !e.target.closest('#tpInsertFieldWrap') && !e.target.closest('#styleMenuWrap')) {
    closeAllDropdownMenus();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllDropdownMenus();
  }
});

$id('btnMath')?.addEventListener('click', () => insertMathEquation('', t('app.editor.equation_inserted')));
$id('btnFormula')?.addEventListener('click', () => openFormulaDialog());
$id('btnTable')?.addEventListener('click', () => insertTable(3, 3));
$id('btnBreak')?.addEventListener('click', () => {
  editor.update(() => {
    const sel = $getSelection();
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot($createBreakNode());
    else $getRoot().append($createBreakNode());
  });
  announce(t('app.editor.break_inserted'));
});

$id('btnSidebar')?.addEventListener('click', () => insertSidebar());

// The print page that follows `raw`: a trailing number is incremented keeping any prefix
// and zero padding ("R64" → "R65", "A-9" → "A-10"); roman numerals stay roman in the same
// case ("xiv" → "xv"); a single letter advances ("a" → "b"). Anything else gets "".
const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function romanToInt(s) {
  const t = s.toLowerCase();
  let i = 0, n = 0;
  for (const [v, r] of ROMAN) while (t.startsWith(r, i)) { n += v; i += r.length; }
  return i === t.length && n > 0 ? n : 0;
}
function intToRoman(n) {
  let out = '';
  for (const [v, r] of ROMAN) while (n >= v) { out += r; n -= v; }
  return out;
}
export function nextPrintPage(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const num = s.match(/^(.*?)(\d+)$/);
  if (num) {
    const next = String(parseInt(num[2], 10) + 1);
    return num[1] + (num[2].startsWith('0') ? next.padStart(num[2].length, '0') : next);
  }
  if (/^[ivxlcdm]+$/i.test(s)) {
    const n = romanToInt(s);
    if (n) {
      const r = intToRoman(n + 1);
      return s === s.toUpperCase() ? r.toUpperCase() : r;
    }
  }
  if (/^[a-y]$/i.test(s)) return String.fromCharCode(s.charCodeAt(0) + 1);
  return '';
}

function insertPrintPage(pageVal) {
  let p = pageVal;
  if (!p) {
    // Number from the print page *before the insertion point* (not the last one in the
    // document): inserting after page 95 in a long book gives 96, not the book's last page + 1.
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      let stopAt = null;
      if ($isRangeSelection(sel)) {
        const anchor = sel.anchor.getNode();
        stopAt = anchor ? (anchor.getTopLevelElement ? anchor.getTopLevelElement() : null) || anchor : null;
      }
      let previous = null;
      for (const node of $getRoot().getChildren()) {
        if ($isPrintPageNode(node)) previous = node.getPage();
        if (stopAt && node.is(stopAt)) break;
      }
      p = previous != null ? nextPrintPage(previous) : '1';
    });
  }
  if (!p) p = '1';
  editor.update(() => {
    const sel = $getSelection();
    const node = $createPrintPageNode(p);
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot(node);
    else $getRoot().append(node);
  });
  announce(t('app.printpage.inserted', { page: p }));
}
window.insertPrintPage = insertPrintPage;
$id('btnInsertPrintPage')?.addEventListener('click', () => insertPrintPage());
$id('tocToggle')?.addEventListener('change', (e) => {
  settings = saveSettings({ toc: e.target.checked });
  clearTranslationCache();
  announce(t(e.target.checked ? 'app.editor.toc_on' : 'app.editor.toc_off'));
  render();
});

let lastActiveTableCellInput = null;
const isTableCellEl = (el) => !!(el && el.classList && el.classList.contains('table-cell-input'));

// One table cell's contenteditable widget (G15): shows the cell's segments as real
// bold/italic/underline/uncontracted formatting and atomic maths/note-reference chips
// (format/cell-dom.mjs) instead of markup characters, and keeps it wired the way the old
// <input> cell was — the braille cell trace, Tab/Shift+Tab, and the Bold/Italic/Underline
// toolbar (see applyCellFormat below).
function makeTableCell(key, cell, ri, ci, unit, className, ariaLabel, placeholder) {
  const div = document.createElement('div');
  div.className = className;
  div.contentEditable = 'true';
  div.setAttribute('role', 'textbox');
  div.setAttribute('aria-multiline', 'false');
  div.setAttribute('aria-label', ariaLabel);
  if (placeholder) div.dataset.placeholder = placeholder;
  div.tabIndex = 0;
  div.dataset.unit = String(unit);
  div.dataset.row = String(ri);
  div.dataset.col = String(ci);
  div.innerHTML = cellToEditableHtml(cell, resolveCellImgSrc);

  div.addEventListener('input', () => {
    // Deleting all a cell's text can leave a stray <br> behind (Chrome keeps one so the
    // caret stays visible); clear it so :empty::before shows the placeholder again.
    if (!div.textContent && div.innerHTML !== '') div.innerHTML = '';
    editor.update(() => {
      const n = $getNodeByKey(key);
      if ($isTableNode(n)) n.setCell(ri, ci, div.innerHTML);
    });
    handleTableCellEvent(div, unit);
  });
  div.addEventListener('pointerup', () => handleTableCellEvent(div, unit));
  div.addEventListener('keyup', () => handleTableCellEvent(div, unit));
  div.addEventListener('focus', () => {
    lastActiveTableCellInput = div;
    handleTableCellEvent(div, unit);
  });
  div.addEventListener('mousedown', () => { lastActiveTableCellInput = div; });
  // Paste as plain text only — no pasted-in markup or formatting (build item 1); a pasted
  // newline becomes a space, so a cell stays single-line like the old <input>.
  div.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\r\n|\r|\n/g, ' ');
    document.execCommand('insertText', false, text);
  });
  div.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // Never insert a newline (build item 1): move to the cell below in the same
      // column, or do nothing past the last row.
      e.preventDefault();
      e.stopPropagation();
      focusTableCellAt(div, Number(div.dataset.row) + 1, Number(div.dataset.col));
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      focusAdjacentTableCell(div, e.shiftKey ? -1 : 1);
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && tableCellArrow(div, key, e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); e.stopPropagation(); applyCellFormat(div, 'bold'); }
      else if (k === 'i') { e.preventDefault(); e.stopPropagation(); applyCellFormat(div, 'italic'); }
      else if (k === 'u') { e.preventDefault(); e.stopPropagation(); applyCellFormat(div, 'underline'); }
    }
  });
  return div;
}
// Enter: the cell at (row, col) in the same table, or nothing past the last row.
function focusTableCellAt(cell, row, col) {
  const table = cell.closest('table.editor-table-widget');
  const target = table && table.querySelector(`.table-cell-input[data-row="${row}"][data-col="${col}"]`);
  if (target) { target.focus(); placeCaretAtEnd(target); }
}
// Up / Down in a table cell (A89, random-action testing: in Firefox the caret could not leave a cell; Chrome and WebKit went
// through the cells in reading order and never left the table): the cell above (below) in the same column, as in a word
// processor's table — the nearest cell at or before that column where cells are joined — and off the top (bottom) row, the
// text before (after) the table; a paragraph is added after a table that ends the document, so there is somewhere to go. A
// cell whose text wraps onto several lines first moves within its own lines (the browser does that). False: not handled.
function tableCellArrow(cell, tableKey, down) {
  const sel = window.getSelection();
  if (sel.rangeCount && cell.contains(sel.focusNode)) {
    const r = document.createRange(); r.setStart(sel.focusNode, sel.focusOffset); r.collapse(true);
    const caret = caretClientRect(r);
    if (caret && lineRects(cell).some((x) => (down ? x.top >= caret.bottom - 1 : x.bottom <= caret.top + 1))) return false;
  }
  const table = cell.closest('table.editor-table-widget');
  if (!table) return false;
  const col = Number(cell.dataset.col);
  const rows = [...new Set([...table.querySelectorAll('.table-cell-input')].map((c) => Number(c.dataset.row)))].sort((a, b) => a - b);
  let i = rows.indexOf(Number(cell.dataset.row)) + (down ? 1 : -1);
  for (; i >= 0 && i < rows.length; i += down ? 1 : -1) {
    const inRow = [...table.querySelectorAll(`.table-cell-input[data-row="${rows[i]}"]`)].filter((c) => Number(c.dataset.col) <= col);
    const target = inRow.sort((a, b) => Number(b.dataset.col) - Number(a.dataset.col))[0];
    if (target) { target.focus(); placeCaretAtEnd(target); return true; }
  }
  editorEl.focus({ preventScroll: true });
  editor.update(() => {
    const n = $getNodeByKey(tableKey);
    if (!n) return;
    let sib = down ? n.getNextSibling() : n.getPreviousSibling();
    if (!sib && down) { sib = $createParagraphNode(); n.insertAfter(sib); }
    if (!sib) { n.selectPrevious(); return; }
    if (sib instanceof DecoratorNode) { const ns = $createNodeSelection(); ns.add(sib.getKey()); $setSelection(ns); return; }
    if (down) sib.selectStart(); else sib.selectEnd();
  }, { discrete: true });
  return true;
}
// Tab / Shift+Tab: the next/previous cell in reading order. A contenteditable element is
// not in the browser's own Tab order the way an <input> is, so this is done explicitly.
function focusAdjacentTableCell(cell, dir) {
  const table = cell.closest('table.editor-table-widget');
  if (!table) return;
  const cells = Array.from(table.querySelectorAll('.table-cell-input'));
  const next = cells[cells.indexOf(cell) + dir];
  if (next) { next.focus(); placeCaretAtEnd(next); }
}
function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
// Bold/Italic/Underline for a table cell's selection: execCommand is deprecated but still
// the simplest reliable way to toggle *nested* inline formatting in a small, self-contained
// contenteditable — a table cell is decorator content, not part of Lexical's own node tree,
// so Lexical's FORMAT_TEXT_COMMAND cannot reach it. Chrome fires the cell's own 'input'
// listener for the DOM change, which commits it and refreshes the cell trace.
function applyCellFormat(cell, format) {
  cell.focus();
  document.execCommand(format, false, null);
}
// K5 (UEB §9 script typeform): a table cell is DOM content outside Lexical's tree (see
// applyCellFormat above), and there is no document.execCommand for a custom CSS property, so
// this wraps/unwraps the selection's own Range directly in a `<span class="cell-script">` —
// format/cell-dom.mjs's cellHtmlToSegments already reads that class straight back into
// TF_SCRIPT on save (the same convention segmentsToCellHtml writes for a script run).
function applyCellScriptFormat(cell) {
  cell.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const container = range.commonAncestorContainer;
  const holder = container.nodeType === 1 ? container : container.parentElement;
  const existing = holder && holder.closest ? holder.closest('.cell-script') : null;
  if (existing && cell.contains(existing) && existing.textContent === range.toString()) {
    // The whole selection IS one script span already: unwrap it (toggle off).
    const parent = existing.parentNode;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
  } else {
    const span = document.createElement('span');
    span.className = 'cell-script';
    try {
      range.surroundContents(span);
    } catch {
      // A selection that only partly covers a node (surroundContents refuses that): extract
      // and re-wrap instead — loses no content, just less surgical about node boundaries.
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
  }
  cell.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---- toolbar: emphasis ----
function fmtBtn(id, format, label) {
  $id(id).addEventListener('click', () => {
    const active = document.activeElement;
    if (isTableCellEl(active)) {
      applyCellFormat(active, format);
      announce(label + ' toggled');
      return;
    }
    if (lastActiveTableCellInput && document.contains(lastActiveTableCellInput) && (lastActiveTableCellInput === document.activeElement || document.activeElement === $id(id))) {
      applyCellFormat(lastActiveTableCellInput, format);
      announce(label + ' toggled');
      return;
    }
    let caretInWord = null;   // a plain caret inside a word: where in the word it was (the word is formatted; the caret goes back there)
    editor.update(() => {
      let sel = $getSelection();
      if (!sel && lastActiveEditorSelection?.anchorKey) {
        const node = $getNodeByKey(lastActiveEditorSelection.anchorKey);
        if (node && $isTextNode(node)) {
          sel = node.select(lastActiveEditorSelection.anchorOffset, lastActiveEditorSelection.focusOffset);
        }
      }
      if ($isRangeSelection(sel) && sel.isCollapsed()) {
        let anchorNode = sel.anchor.getNode();
        let offset = sel.anchor.offset;
        if (sel.anchor.type === 'element' && anchorNode && typeof anchorNode.getChildren === 'function') {
          const children = anchorNode.getChildren();
          const childIdx = Math.min(offset, Math.max(0, children.length - 1));
          const child = children[childIdx] || children[0];
          if (child && $isTextNode(child)) {
            anchorNode = child;
            offset = 0;
          }
        }
        if (anchorNode && $isTextNode(anchorNode)) {
          const text = anchorNode.getTextContent();
          let start = Math.min(offset, text.length), end = start;
          while (start > 0 && /[\w'-]/.test(text[start - 1])) start--;
          while (end < text.length && /[\w'-]/.test(text[end])) end++;
          if (end > start) {
            caretInWord = offset - start;
            sel.setTextNodeRange(anchorNode, start, anchorNode, end);
          }
        }
      }
    });
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    // As a word processor does (18 Oct 2026, Paul: Backspace "deletes the wrong thing"): the whole word is formatted but the caret goes back
    // to where it was - the word was left selected, and the next Backspace deleted all of it.
    if (caretInWord != null) editor.update(() => {
      const s2 = $getSelection();
      if (!$isRangeSelection(s2) || s2.isCollapsed()) return;
      const first = s2.isBackward() ? s2.focus : s2.anchor;
      const node = first.getNode();
      if (!$isTextNode(node)) return;
      const o = Math.min(first.offset + caretInWord, node.getTextContentSize());
      s2.anchor.set(node.getKey(), o, 'text');
      s2.focus.set(node.getKey(), o, 'text');
    });
    editor.focus();
    refreshToolbar();
    editor.getEditorState().read(() => {
      const s = $getSelection();
      announce(label + (($isRangeSelection(s) && s.hasFormat(format)) ? ' on' : ' off'));
    });
  });
}
fmtBtn('btnBold', 'bold', 'Bold'); fmtBtn('btnItalic', 'italic', 'Italic'); fmtBtn('btnUnderline', 'underline', 'Underline');
// UEB 9.5.1: crossed-out text, the first transcriber-defined typeform — same fmtBtn shape as
// bold/italic/underline (Lexical's built-in 'strikethrough' format; document.execCommand
// supports it too, so applyCellFormat's table-cell path works unchanged).
fmtBtn('btnStrike', 'strikethrough', 'Strikethrough');
// A table cell's DOM selection (unlike a Lexical selection) is lost the instant focus
// moves to the button, so keep focus in the cell on mousedown — the click still fires
// fmtBtn's handler right afterwards, with the cell's selection still intact.
['btnBold', 'btnItalic', 'btnUnderline', 'btnStrike', 'btnScript'].forEach((id) => {
  $id(id)?.addEventListener('mousedown', (e) => { if (isTableCellEl(document.activeElement)) e.preventDefault(); });
});

// K5 / UEB §9 script typeform: unlike fmtBtn's bold/italic/underline/strikethrough, which all
// dispatch Lexical's own FORMAT_TEXT_COMMAND, script has no Lexical format bit to dispatch
// (see SCRIPT_STYLE/hasScript, defined below with the other CSS-custom-property runs). This
// walks the selection's own text nodes, splitting any node the selection only partly covers —
// FORMAT_TEXT_COMMAND does the equivalent split internally for Lexical's own format bits, but
// there is nothing built in for a style property, so it is reimplemented here, once.
function $scriptSelectionTextNodes(sel) {
  if (sel.isCollapsed()) return [];
  const isBackward = sel.isBackward();
  const startPoint = isBackward ? sel.focus : sel.anchor;
  const endPoint = isBackward ? sel.anchor : sel.focus;
  const startNode = startPoint.getNode();
  const endNode = endPoint.getNode();
  if (startNode.is(endNode) && $isTextNode(startNode)) {
    const lo = Math.min(startPoint.offset, endPoint.offset);
    const hi = Math.max(startPoint.offset, endPoint.offset);
    if (lo === hi) return [];
    const size = startNode.getTextContentSize();
    if (lo === 0 && hi === size) return [startNode];
    const offsets = [lo, hi].filter((o) => o > 0 && o < size);
    const parts = startNode.splitText(...offsets);
    return [lo > 0 ? parts[1] : parts[0]];
  }
  const nodes = sel.getNodes().filter($isTextNode);
  if (!nodes.length) return [];
  if (nodes[0].is(startNode) && startPoint.offset > 0 && startPoint.offset < startNode.getTextContentSize()) {
    nodes[0] = startNode.splitText(startPoint.offset)[1];
  }
  const lastIdx = nodes.length - 1;
  if (nodes[lastIdx].is(endNode) && endPoint.offset > 0 && endPoint.offset < endNode.getTextContentSize()) {
    nodes[lastIdx] = endNode.splitText(endPoint.offset)[0];
  }
  return nodes.filter((n) => n.getTextContent().length > 0);
}
function $setScriptStyle(node, on) {
  const cur = (typeof node.getStyle === 'function' ? node.getStyle() || '' : '').replace(/--bana-script\s*:\s*1;?\s*/g, '').trim();
  node.setStyle(on ? [cur, SCRIPT_STYLE].filter(Boolean).join(' ') : cur);
}
function toggleScriptFormat() {
  const active = document.activeElement;
  if (isTableCellEl(active)) {
    applyCellScriptFormat(active);
    announce('Script toggled');
    return;
  }
  let turnedOn = null;
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const nodes = $scriptSelectionTextNodes(sel);
    if (!nodes.length) return;
    const allOn = nodes.every((n) => hasScript(n));
    turnedOn = !allOn;
    nodes.forEach((n) => $setScriptStyle(n, turnedOn));
  });
  editor.focus();
  refreshToolbar();
  if (turnedOn !== null) announce('Script ' + (turnedOn ? 'on' : 'off'));
}
$id('btnScript')?.addEventListener('click', () => toggleScriptFormat());

export function indentCurrentItem() {
  let changed = false;
  let newLevelAnnounce = null;
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const listItems = new Set();
    let aNode = sel.anchor.getNode();
    while (aNode && aNode !== $getRoot()) {
      if ($isListItemNode(aNode)) { listItems.add(aNode); break; }
      aNode = aNode.getParent ? aNode.getParent() : null;
    }
    let fNode = sel.focus.getNode();
    while (fNode && fNode !== $getRoot()) {
      if ($isListItemNode(fNode)) { listItems.add(fNode); break; }
      fNode = fNode.getParent ? fNode.getParent() : null;
    }
    for (const node of sel.getNodes()) {
      if ($isListItemNode(node)) {
        listItems.add(node);
      } else {
        let p = node.getParent ? node.getParent() : null;
        while (p && p !== $getRoot()) {
          if ($isListItemNode(p)) { listItems.add(p); break; }
          p = p.getParent ? p.getParent() : null;
        }
      }
    }
    for (const li of listItems) {
      const cur = li.getLevel() || 0;
      if (cur < 4) {
        const next = cur + 1;
        li.setLevel(next);
        changed = true;
        newLevelAnnounce = next;
      }
    }
  });
  if (changed) {
    editor.focus();
    refreshToolbar();
    const lvlNames = [t('app.list.level_1'), t('app.list.level_2'), t('app.list.level_3'), t('app.list.level_4'), '5'];
    announce(t('app.list.indented', { level: lvlNames[newLevelAnnounce] || newLevelAnnounce + 1 }));
  }
  return changed;
}

export function outdentCurrentItem() {
  let changed = false;
  let newLevelAnnounce = null;
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const listItems = new Set();
    let aNode = sel.anchor.getNode();
    while (aNode && aNode !== $getRoot()) {
      if ($isListItemNode(aNode)) { listItems.add(aNode); break; }
      aNode = aNode.getParent ? aNode.getParent() : null;
    }
    let fNode = sel.focus.getNode();
    while (fNode && fNode !== $getRoot()) {
      if ($isListItemNode(fNode)) { listItems.add(fNode); break; }
      fNode = fNode.getParent ? fNode.getParent() : null;
    }
    for (const node of sel.getNodes()) {
      if ($isListItemNode(node)) {
        listItems.add(node);
      } else {
        let p = node.getParent ? node.getParent() : null;
        while (p && p !== $getRoot()) {
          if ($isListItemNode(p)) { listItems.add(p); break; }
          p = p.getParent ? p.getParent() : null;
        }
      }
    }
    for (const li of listItems) {
      const cur = li.getLevel() || 0;
      if (cur > 0) {
        const next = cur - 1;
        li.setLevel(next);
        changed = true;
        newLevelAnnounce = next;
      }
    }
  });
  if (changed) {
    editor.focus();
    refreshToolbar();
    const lvlNames = [t('app.list.level_1'), t('app.list.level_2'), t('app.list.level_3'), t('app.list.level_4'), '5'];
    announce(t('app.list.outdented', { level: lvlNames[newLevelAnnounce] || newLevelAnnounce + 1 }));
  }
  return changed;
}

// The list item the caret is currently in (or null), read without mutating the editor — used
// by both the slash command's `when` and the keyboard shortcut so they agree on availability.
function caretListItem() {
  let li = null;
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    let node = sel.anchor.getNode();
    while (node && node !== $getRoot()) {
      if ($isListItemNode(node)) { li = node; break; }
      node = node.getParent ? node.getParent() : null;
    }
  });
  return li;
}
// "Empty", for Continue Item: genuinely blank, OR its whole text is still just the "/continue"
// slash query being typed (removeSlashQueryText only erases that text once the command RUNS —
// the `when` check that decides whether to OFFER it in the menu runs earlier, while it's
// still there, so a line reading only "/continue" must count as empty too).
const liIsEmpty = (li) => {
  const t = li.getTextContent();
  return (t.trim() === '' || /^\/[a-zA-Z0-9]*$/.test(t.trim())) && !li.getChildren().some((c) => typeof c.getType === 'function' && !['text', 'linebreak'].includes(c.getType()));
};
// "Continue item": turns a blank new list line into a further paragraph of the item above it —
// saved/exported as that item's item.blocks (document.mjs formatItemBlocks), shown at the
// runover+2 margin, no marker or number of its own (fmt.itemCont; see isItemContLi above and
// the load-time construction in appendBlock's list branch). Pressing it again on a continuation
// paragraph turns it back into an ordinary new item (its marker is then computed as usual).
// Slash command "/continue" and Ctrl/⌘+Shift+Enter (see the editorEl keydown handler) both
// call this. Chosen over Enter-on-empty-item (which already ends a list in Lexical, matching
// Word/Docs) and over Shift+Enter (already a soft line break within the same paragraph).
export function continueListItem() {
  let result = null;   // 'on' | 'off' | null (not applicable here)
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
    let li = null;
    let node = sel.anchor.getNode();
    while (node && node !== $getRoot()) { if ($isListItemNode(node)) { li = node; break; } node = node.getParent ? node.getParent() : null; }
    if (!li) return;
    const f = fmtOf(li) || {};
    if (f.itemCont) {
      li.setFmt({ ...f, itemCont: null });
      result = 'off';
      return;
    }
    if (!liIsEmpty(li)) return;
    const prev = li.getPreviousSibling();
    if (!prev || !$isListItemNode(prev) || (prev.getLevel() || 0) !== (li.getLevel() || 0)) return;
    if (typeof li.setMarker === 'function') li.setMarker(null);
    li.setFmt({ ...f, itemCont: true, enum: null, start: null });
    result = 'on';
  });
  if (result) {
    editor.focus();
    refreshToolbar();
    announce(t(result === 'on' ? 'app.list.item_cont_on' : 'app.list.item_cont_off'));
  }
  return result;
}
// `when` for the slash command: available on a blank new list line right after another item
// (would turn 'on'), or on an existing continuation paragraph (would turn 'off').
function continueListItemAvailable() {
  const li = caretListItem();
  if (!li) return false;
  const f = fmtOf(li) || {};
  if (f.itemCont) return true;
  if (!liIsEmpty(li)) return false;
  const prev = li.getPreviousSibling();
  return !!(prev && $isListItemNode(prev) && (prev.getLevel() || 0) === (li.getLevel() || 0));
}

$id('btnIndent')?.addEventListener('click', () => indentCurrentItem());
$id('btnOutdent')?.addEventListener('click', () => outdentCurrentItem());

// ---- toolbar: maths / break / TOC / sidebar / table / lists ----
// Keep the editor's selection alive when a toolbar BUTTON is pressed (mousedown)
['btnBold', 'btnItalic', 'btnUnderline', 'btnStrike', 'btnOutdent', 'btnIndent', 'btnMath', 'btnFormula', 'btnTable', 'btnGraphic', 'btnSidebar', 'btnBreak', 'btnInsertPrintPage'].forEach((id) =>
  $id(id)?.addEventListener('mousedown', (e) => e.preventDefault()));

// ---- Lexical document → Emboss block model ----
// Walk a paragraph / list-item's children into runs: text runs carry their liblouis
// emphasis bits (tf = bold/italic/underline), MathNodes become inline-maths runs.
const latexToMathMlCache = new Map();
function convertLatexCached(latex) {
  if (!latex) return '';
  if (latexToMathMlCache.has(latex)) return latexToMathMlCache.get(latex);
  if (globalThis.MathLive?.convertLatexToMathMl) {
    try {
      // MathLive writes some symbols as HTML named characters (&ne;, &alpha;): the characters themselves, which a saved file can hold (A89)
      const mathml = htmlNamedCharsToText(globalThis.MathLive.convertLatexToMathMl(latex));
      latexToMathMlCache.set(latex, mathml);
      return mathml;
    } catch (e) {
      console.warn('equation skipped (could not convert):', e);
      return '';
    }
  }
  return '';
}

// Ignore-font run mark (batch A, F-145 …): a text node carries it as a CSS custom property in its Lexical `style`, which
// Lexical already copies on clone, keeps in the JSON of undo history / editor-state snapshots, and never merges across
// (adjacent text nodes join only when format AND style match), so editing the text beside it cannot swallow or spread it.
const IGNORE_FONT_STYLE = '--bana-ignore-font: 1;';
const hasIgnoreFont = (n) => typeof n.getStyle === 'function' && /--bana-ignore-font\s*:\s*1/.test(n.getStyle() || '');
// F-233 / BANA 6.12.3b(3): a hyperlinked run's braille indicator, carried the same way (its own CSS custom property,
// independent of --bana-ignore-font so a run can carry either, both or neither without one overwriting the other).
const HYPERLINK_STYLE = '--bana-hyperlink: 1;';
const hasHyperlink = (n) => typeof n.getStyle === 'function' && /--bana-hyperlink\s*:\s*1/.test(n.getStyle() || '');
// UEB 9.5.1 transcriber-defined typeform. 'strike' IS the editor's own strikethrough control
// (Lexical's built-in 'strikethrough' text format — the btnStrike toolbar button / Ctrl+Shift+X,
// the SECOND transcriber-defined typeform in format/document.mjs's segTf, kept off the first
// slot on purpose: that one is the hyperlink indicator, F-233). BrailleBlaster's own
// bai-trans1..bai-trans5 (parse.mjs A24) have no editor control (they only ever arrive already
// on a segment from that import) but must still round-trip a save, so — like ignoreFont/
// hyperlink above — they ride a CSS custom property in the node's own Lexical style,
// independent of the format bitmask.
const TRANSCRIBER_TF_STYLE_RE = /--bana-ttf\s*:\s*([a-z0-9-]+)/;
const transcriberTfOf = (n) => { const m = typeof n.getStyle === 'function' && TRANSCRIBER_TF_STYLE_RE.exec(n.getStyle() || ''); return m ? m[1] : null; };
const transcriberTfStyle = (ttf) => (ttf ? `--bana-ttf: ${ttf};` : '');
// A foreign-language run (seg.lang, a BCP-47 primary subtag — input/lang.mjs) rides the same channel, its own custom
// property, so it survives typing, undo and save. No control sets it yet; it arrives from an imported document.
const LANG_STYLE_RE = /--bana-lang\s*:\s*([a-z]{2,3})\b/;
const langOfNode = (n) => { const m = typeof n.getStyle === 'function' && LANG_STYLE_RE.exec(n.getStyle() || ''); return m ? m[1] : null; };
const langStyle = (lang) => (typeof lang === 'string' && /^[a-z]{2,3}$/.test(lang) ? `--bana-lang: ${lang};` : '');

// K5 / UEB §9 (rueb-2024.txt §9.1.2's "script does not need a transcriber-defined typeform"):
// Lexical ships a fixed format bitmask (bold/italic/underline/strikethrough/code/highlight/
// sub/superscript) with no 'script' slot to add to, so — like ignoreFont/hyperlink above — a
// script run rides its own CSS custom property on the node's Lexical `style`, independent of
// the format bitmask. UNLIKE ignoreFont/hyperlink (separate boolean segment fields), script
// folds into the numeric `tf` bitmask itself (TF_SCRIPT) once read off the node, because that
// is what format/document.mjs's segTf/groupSegments/stripEmphasis already read for italic/
// underline/bold — treating it the same way means every rule that inspects `seg.tf` (heading
// emphasis-drop, list emphasis-strip, the "all one typeform" checks, forceBold, …) works for
// script with no separate code path. TF_SCRIPT is liblouis's own `emphclass script` bit (8), named
// by TYPEFORM in Emboss/engine/louis-browser.mjs — the copy this editor loads as /engine/louis-browser.mjs
// (the dev server and dist both serve Emboss/engine/, not the repo-root engine/) — and matching
// format/cell-markup.mjs's TF_SCRIPT (confirmed against the compiled en-ueb-g1.ctb; see
// Emboss/engine/louis.mjs's TYPEFORM comment).
const TF_SCRIPT = TF.script;
const SCRIPT_STYLE = '--bana-script: 1;';
const hasScript = (n) => typeof n.getStyle === 'function' && /--bana-script\s*:\s*1/.test(n.getStyle() || '');

// Used for BOTH paragraphs and list items so emphasis + inline maths survive in lists
// too (previously list items were flattened to plain text, dropping both).
function nodeToRuns(node) {
  const runs = [];
  let hasEmph = false, hasMath = false;
  for (const child of node.getChildren()) {
    if ($isMathNode(child)) {
      const latex = (child.getLatex() || '').trim();
      const source = child.getSourceMathml();
      if (source) {
        // Unedited equation from the loaded document: keep its MathML exactly.
        const run = { type: 'math', mathml: source };
        if (latex && latex !== UNEDITABLE_MATH_LATEX) run.latex = latex;
        runs.push(run);
        hasMath = true;
      } else if (latex) {
        const mathml = convertLatexCached(latex);
        // If LaTeX → MathML fails, keep the equation as LaTeX (braille uses latexToBrf,
        // the exporter writes it with a TeX annotation) instead of dropping it.
        runs.push(mathml ? { type: 'math', mathml, latex } : { type: 'math', latex });
        hasMath = true;
      }
      continue;
    }
    if ($isLineNumberNode(child)) {
      const num = child.getTextContent().trim();
      if (num) { runs.push({ type: 'linenum', text: num }); hasEmph = true; }   // keep segments so the number survives
      continue;
    }
    if ($isNoteRefNode(child)) {
      const mark = child.getTextContent().trim();
      if (mark) {
        const run = { type: 'noteref', text: mark };
        if (child.getIdref()) run.idref = child.getIdref();
        if (child.isAnnoref()) run.annoref = true;
        runs.push(run);
        hasEmph = true;                                  // keep segments so the reference survives
      }
      continue;
    }
    if ($isBrlNode(child)) {
      runs.push({ type: 'brl', brl: child.getBrl(), text: child.getTextContent().replace(/\u200B/g, '') });
      hasEmph = true;                                    // keep segments so the literal cells survive
      continue;
    }
    if ($isImgNoteNode(child)) {
      const desc = child.getTextContent().trim();
      if (desc) {
        const run = { type: 'imgnote', text: desc };
        if (child.getSrc()) run.src = child.getSrc();
        const ex = child.getExtra();
        if (ex) Object.assign(run, ex);
        runs.push(run);
        hasEmph = true;                                  // keep segments so the embedded note survives (F-229)
      }
      continue;
    }
    if ($isLinkNode(child)) {
      // A19/A21 Stage 3: reconstruct the `.href`-tagged plain-text segment parse.mjs's
      // walkInline produces (nimas-export's serializeInlineSegments re-wraps a contiguous
      // run sharing the same href in one <a href="…">) — kept as its own run, not merged
      // with a neighbour, so the href boundary is never blurred.
      const linkText = child.getTextContent();
      if (linkText) {
        let tf = 0, unc = false, ttf = null;
        if (typeof child.hasFormat === 'function') {
          if (child.hasFormat('bold')) tf |= TF.bold;
          if (child.hasFormat('italic')) tf |= TF.italic;
          if (child.hasFormat('underline')) tf |= TF.underline;
          unc = child.hasFormat('code');
          ttf = child.hasFormat('strikethrough') ? 'strike' : transcriberTfOf(child);
        }
        if (hasScript(child)) tf |= TF_SCRIPT;   // K5
        const run = { type: 'text', text: scriptMarked(child, linkText.replace(/\s+/g, ' ')), href: child.getHref() || undefined };
        if (tf) run.tf = tf;
        if (unc) run.uncontracted = true;
        if (ttf) run.transcriberTypeform = ttf;
        if (hasIgnoreFont(child)) run.ignoreFont = true;
        if (hasHyperlink(child)) run.hyperlink = true;
        if (langOfNode(child)) run.lang = langOfNode(child);
        runs.push(run);
        hasEmph = true;                                   // keep segments so the href survives
      }
      continue;
    }
    if ($isCiteNode(child)) {
      // A19/A21 Stage 4: same shape as the link case above.
      const citeText = child.getTextContent();
      if (citeText) {
        let tf = 0, unc = false, ttf = null;
        if (typeof child.hasFormat === 'function') {
          if (child.hasFormat('bold')) tf |= TF.bold;
          if (child.hasFormat('italic')) tf |= TF.italic;
          if (child.hasFormat('underline')) tf |= TF.underline;
          unc = child.hasFormat('code');
          ttf = child.hasFormat('strikethrough') ? 'strike' : transcriberTfOf(child);
        }
        if (hasScript(child)) tf |= TF_SCRIPT;   // K5
        const run = { type: 'text', text: scriptMarked(child, citeText.replace(/\s+/g, ' ')), cite: true };
        if (tf) run.tf = tf;
        if (unc) run.uncontracted = true;
        if (ttf) run.transcriberTypeform = ttf;
        if (hasIgnoreFont(child)) run.ignoreFont = true;
        if (hasHyperlink(child)) run.hyperlink = true;
        if (langOfNode(child)) run.lang = langOfNode(child);
        runs.push(run);
        hasEmph = true;                                   // keep segments so the cite marking survives
      }
      continue;
    }
    if ($isLineBreakNode(child)) {
      // A break inside emphasised text belongs to it ("EXPLAIN / THE PHENOMENON" is one bold run).
      const prev = runs[runs.length - 1];
      runs.push({ type: 'text', text: '\n', tf: prev && prev.type === 'text' ? prev.tf || 0 : 0 });
      hasEmph = true;                                    // keep segments so the break survives
      continue;
    }
    const rawText = child.getTextContent();
    if (!rawText) continue;
    const text = scriptMarked(child, rawText.replace(/\s+/g, ' '));
    if (!text) continue;
    let tf = 0;
    let unc = false;
    let ttf = null;
    if (typeof child.hasFormat === 'function') {
      if (child.hasFormat('bold')) tf |= TF.bold;
      if (child.hasFormat('italic')) tf |= TF.italic;
      if (child.hasFormat('underline')) tf |= TF.underline;
      unc = child.hasFormat('code');
      ttf = child.hasFormat('strikethrough') ? 'strike' : transcriberTfOf(child);
    }
    if (hasScript(child)) tf |= TF_SCRIPT;   // K5
    const ign = hasIgnoreFont(child);
    const hyp = hasHyperlink(child);
    const lg = langOfNode(child);                        // foreign-language run (input/lang.mjs)
    if (tf || unc || ign || hyp || ttf || lg || text !== rawText.replace(/\s+/g, ' ')) hasEmph = true;   // a sub/superscript run keeps segments too
    const last = runs[runs.length - 1];
    // A19/A21 Stage 9: a run tagged .href (LinkNode) or .cite (CiteNode) must never absorb the
    // plain text that follows it — that text was never part of the link/citation. Before this
    // check, an ordinary TextNode right after a LinkNode/CiteNode run (same tf/uncontracted,
    // the only two fields compared here) merged straight into it, silently pulling unrelated
    // words inside the <a>/<cite> on save.
    if (last && last.type === 'text' && !last.href && !last.cite && (last.tf || 0) === tf && !!last.uncontracted === unc && !!last.ignoreFont === ign && !!last.hyperlink === hyp && (last.transcriberTypeform || null) === ttf && (last.lang || null) === lg) last.text += text;   // one run per form
    else runs.push({ type: 'text', text, tf, ...(unc ? { uncontracted: true } : {}), ...(ttf ? { transcriberTypeform: ttf } : {}), ...(ign ? { ignoreFont: true } : {}), ...(hyp ? { hyperlink: true } : {}), ...(lg ? { lang: lg } : {}) });
  }
  return { runs, hasEmph, hasMath };
}
const TYPED_BRAILLE_TEXT_RE = /^[⠀-⣿ \n]*[⠁-⣿][⠀-⣿ \n]*$/;   // as format/document.mjs's TYPED_BRAILLE_RE
function paraBlock(node) {
  const { runs, hasEmph, hasMath } = nodeToRuns(node);
  if (!runs.length) return null;
  const banaStyle = typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null;
  // A plain paragraph holding one equation and nothing else is displayed maths (A26): the
  // parser reads such a <p> as a math block, so save it as one (display="block").
  const solid = runs.filter((r) => r.type !== 'text' || r.text.trim());
  if ((!banaStyle || banaStyle === 'body') && solid.length === 1 && solid[0].type === 'math' && !node.getPageTurn?.()) {
    const m = { type: 'math' };
    if (solid[0].mathml) m.mathml = solid[0].mathml;
    if (solid[0].latex) m.latex = solid[0].latex;
    return m;
  }
  // Feedback 30 Sep, item 3 (Paul, 1 Oct): a paragraph of typed braille (six-key entry) keeps its spaces and line breaks as typed —
  // the formatter lays it out exactly as typed (format/document.mjs typedBrailleRuns); only trailing blanks are dropped.
  const raw = node.getTextContent();
  const typedBraille = !hasMath && !hasEmph && TYPED_BRAILLE_TEXT_RE.test(raw);
  const block = (hasMath || hasEmph) ? { type: 'para', segments: runs }
    : { type: 'para', text: typedBraille ? raw.replace(/\s+$/, '') : raw.replace(/\s+/g, ' ').trim() };
  const turn = typeof node.getPageTurn === 'function' ? node.getPageTurn() : null;
  if (turn === 'continued' || turn === 'both') block.continued = true;
  if (turn === 'continuation' || turn === 'both') block.continuation = true;
  // F-39 — BANA §1.9.3: only meaningful on a plain body paragraph (formatPara ignores it
  // once a styled path — quote, attribution, ... — takes over the block's own margins).
  if (typeof node.getBlocked === 'function' && node.getBlocked()) block.blocked = true;
  if (banaStyle && banaStyle !== 'body') {
    block.style = banaStyle;
    if (banaStyle === 'note') {
      block.type = 'note';
      // A22 / A19-A21 Stage 7/9: keep an imported render="required" through the editor too.
      const render = typeof node.getRender === 'function' ? node.getRender() : null;
      if (render === 'required') block.render = 'required';
      // F-5: keep it a table's transcriber's note (see ParagraphNode's getTabletn).
      if (typeof node.getTabletn === 'function' && node.getTabletn()) block.kind = 'tabletn';
      // F-164: paragraph of a multi-paragraph note (see ParagraphNode's getNoteGroup).
      const ng = typeof node.getNoteGroup === 'function' ? node.getNoteGroup() : null;
      if (ng != null) block.noteGroup = ng;
    }
    else if (banaStyle === 'caption') block.type = 'caption';
    else if (banaStyle === 'footnote') {
      block.type = 'footnote';
      const note = typeof node.getNote === 'function' ? node.getNote() : null;
      if (note) { block.id = note.id; if (note.kind) block.kind = note.kind; }
    }
    else if (banaStyle === 'attribution') block.type = 'attribution';
    else if (banaStyle === 'stage' || banaStyle === 'play-stage') block.type = 'stage';
    else if (banaStyle === 'dialogue' || banaStyle === 'play-speaker' || banaStyle === 'speaker') { block.type = 'play'; block.subtype = 'prose'; }
    else if (banaStyle === 'verse' || banaStyle === 'poem' || banaStyle === 'play-verse') {
      block.type = 'play'; block.subtype = 'verse';
      // A19/A21 Stage 2/9: only a line read from a genuine <poem> sweeps back into
      // <poem>/<linegroup>/<line> on save (D5) — see nimas-export.mjs's isPoemLineBlock.
      if (typeof node.getFromPoem === 'function' && node.getFromPoem()) block.fromPoem = true;
      if (typeof node.getPlayVerse === 'function' && node.getPlayVerse()) block.playVerse = true;   // verse drama keeps its BANA 14.6.1a margins
      // A42: a line read from a bare <linegroup>/<stanza> (no <poem> wrapper) must save back
      // without inventing one — see nimas-export.mjs's renderPoemRun's wrapInPoem flag.
      if (typeof node.getBareLinegroup === 'function' && node.getBareLinegroup()) {
        block.bareLinegroup = true;
        if (typeof node.getBareLinegroupId === 'function') block.bareLinegroupId = node.getBareLinegroupId();
      }
      // A35/A19-A21 Stage 9: a line read from a genuine source <line> element (not D5's bare
      // verse drama) must round-trip as <line> — see nimas-export.mjs's fromLineTag check.
      if (typeof node.getFromLineTag === 'function' && node.getFromLineTag()) block.fromLineTag = true;
    }
    else if (banaStyle === 'quote') { block.type = 'para'; block.style = 'quote'; }
  }
  // A19/A21 Stage 5/9: a generic <div class="…"> wrapper, independent of banaStyle — any
  // paragraph-shaped block can have come from inside one (see parse.mjs's walk()).
  const divClass = typeof node.getDivClass === 'function' ? node.getDivClass() : null;
  if (divClass) {
    block.divClass = divClass;
    const divId = typeof node.getDivId === 'function' ? node.getDivId() : null;
    if (divId != null) block.divId = divId;
  }
  // A35/A40/A19-A21 Stage 9: a run of blocks from one source <blockquote> that needed the run
  // mechanism (see ParagraphNode's own fromBlockquoteLines/blockquoteId/blockquoteClass note) —
  // independent of banaStyle, same shape as divClass above (a quote paragraph inside the run
  // carries this too, so nimas-export.mjs's renderBlockquoteRun can rebuild one <blockquote>
  // around them all instead of each paragraph self-wrapping its own). Gate on blockquoteId (any
  // run at all), not fromBlockquoteLines (only the A35 subset that also had a <line>).
  const bqId = typeof node.getBlockquoteId === 'function' ? node.getBlockquoteId() : null;
  if (bqId != null) {
    block.blockquoteId = bqId;
    if (typeof node.getFromBlockquoteLines === 'function' && node.getFromBlockquoteLines()) block.fromBlockquoteLines = true;
    const bqClass = typeof node.getBlockquoteClass === 'function' ? node.getBlockquoteClass() : null;
    if (bqClass) block.blockquoteClass = bqClass;
  }
  // Optional formatter fields (see installFmt): directions (BANA 10.3.2), speaker gap, line-number
  // note text / off / margin, enclosed note prefix; a cross-reference note is a paragraph with fmt.xref.
  fmtToBlock(block, node, FMT_PARA_KEYS);
  const pf = fmtOf(node);
  if (pf && pf.xref) {
    block.type = 'xref'; delete block.style;
    if (pf.xrefHeading) block.heading = pf.xrefHeading;
  }
  // A code block (dotLocator / keepSpaces / spaceLetters) is a plain paragraph carrying those flags: its text keeps its
  // spaces and line breaks (the formatter reads block.text), so it is not collapsed like body text.
  // The "Computer code" style (#40) makes the paragraph a code block too, flags or not: the formatter's grade-1 passage and the
  // save's <p class="bana-code">. A line break in it is a line of the code; a trailing empty line (the caret waiting there) is not.
  const codeStyle = banaStyle === 'code';
  if (block.type === 'para' && !hasMath && (codeStyle || (pf && FMT_CODE_KEYS.some((k) => pf[k])))) {
    block.type = 'code';
    block.text = codeStyle ? node.getTextContent().replace(/\n+$/, '') : node.getTextContent();
    delete block.segments;
    if (codeStyle) delete block.style;                  // 'code' is the block's type now
    if (codeStyle && !block.text.trim()) return null;   // only blanks: nothing to braille (an empty paragraph)
  } else if (codeStyle) delete block.style;   // an equation in a code paragraph: not a code block
  // #49: which poem the line / author belongs to, and an author's or byline's role in its poem (the reader's poemId / poemRole)
  const poemId = typeof node.getPoemId === 'function' ? node.getPoemId() : null;
  if (poemId != null && (block.fromPoem || block.type === 'attribution')) block.poemId = poemId;
  const poemRole = typeof node.getPoemRole === 'function' ? node.getPoemRole() : null;
  if (poemRole && block.type === 'attribution') block.poemRole = poemRole;
  return block;
}
// SVG markup → `data:image/svg+xml;base64,…` (UTF-8 safe: braille cells / non-ASCII labels).
function svgToDataUri(svg) {
  if (!svg) return '';
  try {
    let b64;
    if (typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(String(svg));
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      b64 = btoa(bin);
    } else {
      b64 = btoa(unescape(encodeURIComponent(String(svg))));
    }
    return 'data:image/svg+xml;base64,' + b64;
  } catch { return ''; }
}

// The loaded document's own title and metadata (A17): the save (<doctitle>, dc:Title …) and
// the braille title / running head use them; only a document with none (typed from scratch)
// falls back to its first heading. Replaced on every load; kept across Clear (undoable).
// A NIMAS package (A3) also carries its images as model.resources; those get object URLs
// here so ImageNode can show them (the node itself keeps the package-relative src, so saving
// still writes that path — packaging the bytes back out is A4).
// The document options (field-registry.mjs entries saved as a <meta>, nimas-export.mjs's BANA_DOC_OPTIONS) ride here
// too: kept on the model buildModel returns, so the save writes them and formatDocument (doc.<name>) uses them.
// A plain on/off option is kept as `true` when set; one whose VALUE matters (text, or an explicit false that turns a
// default-on rule off) is kept as loaded.
const DOC_OPTION_KEYS = docOptionFields().filter((f) => f.type === 'bool' && !f.save.some((sv) => sv.off)).map((f) => f.key);
const DOC_OPTION_VALUE_KEYS = docOptionFields().filter((f) => !DOC_OPTION_KEYS.includes(f.key)).map((f) => f.key);
let loadedDocInfo = { title: null, metadata: null, resources: [], resourceUrls: new Map(), options: {} };
// A loaded file's title (and its document information) is kept apart from the text: it is page 1, line 1 of the braille, and is not
// in the text pane. A user's report (1 Oct 2026, "the uneditable braille lingers from previous stuff"): after Clear, or after deleting
// all the text, the old document's title stayed on line 1 of the new text's braille. Emptying the document starts a new one: the old
// title and document information go (Clear does this too — see btnClear).
function forgetLoadedTitle() {
  if (loadedDocInfo.title == null && loadedDocInfo.metadata == null) return;
  loadedDocInfo = { ...loadedDocInfo, title: null, metadata: null, titleTyped: false };
}
editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
  // A title the user typed into the Title field (feedback item 10) is theirs, and in sight: emptying the text keeps it.
  if (importing || loadedDocInfo.titleTyped || (loadedDocInfo.title == null && loadedDocInfo.metadata == null)) return;
  if (!dirtyElements.size && !dirtyLeaves.size) return;
  const empty = editorState.read(() => $getRoot().getChildren().every((c) => typeof c.getChildren === 'function'
    && c.getTextContent().trim() === '' && c.getChildren().every((k) => $isTextNode(k) || $isLineBreakNode(k))));
  if (empty) forgetLoadedTitle();
});
// Feedback 30 Sep item 10 (Paul, 1 Oct): the document's title in a field above the text. It is page 1's braille title and the
// running heads, and lives outside the text (loadedDocInfo.title, as Book details sets it). The field follows every render while
// it is not being typed in; with no title of its own it says the first heading is used (buildModel's fallback).
const docTitleField = $id('docTitleInput');
// What the Title field does differs by standard (Paul, 2 Oct): in BANA the title is brailled at the top of the first page; in
// UKAAF it is the running head, which starts on braille page 2 — so the label says so, and after a title is typed into a document
// of one page the status explains why the braille has not changed.
let titleHintPending = false;
function syncDocTitleLabel() {
  const label = docTitleField && document.querySelector(`label[for="${docTitleField.id}"]`);
  if (!label) return;
  const key = settings?.mode === 'ukaaf' ? 'app.editor.doc_title_label_ukaaf' : 'app.editor.doc_title_label';
  const text = settings?.mode === 'ukaaf' ? tOr(key, 'Title (the running head at the top of each braille page, from page 2)') : tOr(key, 'Title (shown at the top of the braille)');
  if (label.getAttribute('data-i18n') !== key) label.setAttribute('data-i18n', key);
  if (label.textContent !== text) label.textContent = text;
}
function syncDocTitleField(model) {
  if (!docTitleField) return;
  syncDocTitleLabel();
  if (document.activeElement !== docTitleField) docTitleField.value = loadedDocInfo.title || '';
  docTitleField.placeholder = loadedDocInfo.title ? '' : (model && model.title
    ? tOr('app.editor.doc_title_placeholder_heading', 'No title of its own: the first heading is used, “{title}”').replace('{title}', model.title)
    : tOr('app.editor.doc_title_placeholder_none', 'Untitled document'));
}
function applyDocTitleField() {
  const v = docTitleField.value.replace(/\s+/g, ' ').trim();
  if (v === (loadedDocInfo.title || '')) return;
  loadedDocInfo = { ...loadedDocInfo, title: v || null, titleTyped: !!v };
  titleHintPending = !!v;
  contentChangedSinceClean = true;
  docInfoChangedSinceClean = true;
  noteAutosaveChange();   // the title and book details are part of the backup too (A89 step 3)
  clearTranslationCache();
  scheduleRender();
}
if (docTitleField) {
  let titleTimer = null;
  docTitleField.addEventListener('input', () => { clearTimeout(titleTimer); titleTimer = setTimeout(applyDocTitleField, 500); });
  docTitleField.addEventListener('change', () => { clearTimeout(titleTimer); applyDocTitleField(); });
  docTitleField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); docTitleField.blur(); } });
}
// K35: a table cell's own picture (an imgnote segment, format/cell-dom.mjs) shows a thumbnail
// the same way ImageNode.createDOM resolves a graphic block's src above: the package's own
// object URL when it is one of this document's resources, else the src itself when it is
// already displayable (a data:/http(s):/blob: URL) — null (no thumbnail, chip + text only)
// for a package-relative path this document has no resource for.
const resolveCellImgSrc = (src) => loadedDocInfo.resourceUrls.get(src) || (/^(data:image\/|https?:|blob:)/i.test(src || '') ? src : null);
function setLoadedDocInfo(model) {
  const title = model && model.title != null ? String(model.title).trim() : '';
  for (const url of loadedDocInfo.resourceUrls.values()) URL.revokeObjectURL(url);
  const resources = Array.isArray(model && model.resources) ? model.resources : [];
  const resourceUrls = new Map();
  for (const r of resources) {
    if (!r || !r.path || !r.bytes) continue;
    resourceUrls.set(r.path, URL.createObjectURL(new Blob([r.bytes], { type: r.mime || 'application/octet-stream' })));
  }
  loadedDocInfo = {
    title: title || null,
    metadata: model && model.metadata && typeof model.metadata === 'object' ? model.metadata : null,
    resources, resourceUrls,
    options: {
      ...Object.fromEntries(DOC_OPTION_KEYS.filter((k) => model && model[k]).map((k) => [k, true])),
      ...Object.fromEntries(DOC_OPTION_VALUE_KEYS.filter((k) => model && model[k] !== undefined && model[k] !== null).map((k) => [k, model[k]])),
    },
  };
}

// A glossary entry is shown as "term — definition" (the parser's form): split it back so the
// save writes <dt>/<dd> again (A26). Returns null when the entry has no separator.
const GLOSSARY_SEP = ' — ';
function glossaryItem(runs) {
  const i = runs.findIndex((r) => r.type === 'text' && r.text.includes(GLOSSARY_SEP));
  if (i < 0) return null;
  const at = runs[i].text.indexOf(GLOSSARY_SEP);
  const before = runs[i].text.slice(0, at), after = runs[i].text.slice(at + GLOSSARY_SEP.length);
  const termSegs = [...runs.slice(0, i), ...(before ? [{ ...runs[i], text: before }] : [])];
  const defSegs = [...(after ? [{ ...runs[i], text: after }] : []), ...runs.slice(i + 1)];
  const plain = (segs) => segs.map((g) => (g.type === 'math' ? (g.latex || '') : (g.text || ''))).join('').replace(/\s+/g, ' ').trim();
  const rich = (segs) => segs.some((g) => g.tf || g.uncontracted || g.type !== 'text' || g.text.includes('\n'));
  const term = plain(termSegs), def = plain(defSegs);
  const item = { term, def, text: `${term}${GLOSSARY_SEP}${def}` };
  if (rich(termSegs) || rich(defSegs)) {
    const norm = (segs) => segs.map((g) => (g.type === 'text' && !g.tf ? (({ tf, ...rest }) => rest)(g) : g));
    item.termSegments = norm(termSegs);
    item.defSegments = norm(defSegs);
    item.segments = [...item.termSegments, { type: 'text', text: GLOSSARY_SEP }, ...item.defSegments];
  }
  return item;
}

function imageBlock(node) {
  const img = node.getImage();
  const draft = pendingAltDrafts.get(node.getKey());   // S2a #5: a description still being typed counts
  const g = { type: 'graphic', src: img.src, alt: draft !== undefined ? String(draft).replace(/\s+/g, ' ').trim() : img.alt };
  if (img.caption) { g.caption = img.caption; if (img.captionSegments) g.captionSegments = img.captionSegments; }
  if (img.description) {
    g.description = img.description;
    if (img.descriptionRender === 'required') g.descriptionRender = 'required';
    // A34: several source <prodnote>s, kept separately — see ImageNode's own descriptions note.
    if (Array.isArray(img.descriptions) && img.descriptions.length) g.descriptions = img.descriptions;
  }
  if (img.figureType) g.figureType = img.figureType;   // F-231
  if (img.citation) g.citation = img.citation;         // 6.2.2c
  if (img.decorative && !g.alt) g.decorative = true;   // decoration, while it has no description (the reader's mark, kept through the editor)
  return g;
}

// One editor node → model block(s) appended to `blocks` (the document or a sidebar's blocks).
function nodeToBlocks(node, blocks) {
  const nodeKey = node.getKey();
  if (typeof node.getChildren !== 'function' && !(node instanceof DecoratorNode && !node.isInline())) {
    // Loose text where a block belongs ($wrapLooseInlines normally gathers it into a paragraph first): braille it as a
    // paragraph of its text rather than fail (A89).
    const text = node.getTextContent();
    if (text.trim()) blocks.push({ type: 'para', text: text.replace(/\s+/g, ' ').trim(), _key: nodeKey });
    return;
  }
  if ($isBreakNode(node)) {
    // A19/A21 Stage 2/5/9: fromPoem (stanza break inside a <poem>) and divClass/divId (a
    // generic classed <div> wrapper) — see BreakNode's own fields, above.
    const fromPoem = typeof node.getFromPoem === 'function' && node.getFromPoem();
    const divClass = typeof node.getDivClass === 'function' ? node.getDivClass() : null;
    // A42: same shape as divClass/divId, for a stanza-break indicator inside a bare linegroup.
    const bareLinegroup = typeof node.getBareLinegroup === 'function' && node.getBareLinegroup();
    // A40: gate on blockquoteId (any run at all), not fromBlockquoteLines (only the A35 subset).
    const bqId = typeof node.getBlockquoteId === 'function' ? node.getBlockquoteId() : null;
    const fromBlockquoteLines = bqId != null && typeof node.getFromBlockquoteLines === 'function' && node.getFromBlockquoteLines();
    const bqClass = bqId != null && typeof node.getBlockquoteClass === 'function' ? node.getBlockquoteClass() : null;
    blocks.push({
      type: 'indicator', kind: typeof node.getKind === 'function' ? node.getKind() : 'asterisks',
      ...(fromPoem ? { fromPoem: true } : {}),
      ...(fromPoem && node.getLatest().__poemId != null ? { poemId: node.getLatest().__poemId } : {}),   // #49
      ...(divClass ? { divClass, divId: node.getDivId() } : {}),
      ...(bareLinegroup ? { bareLinegroup: true, bareLinegroupId: node.getBareLinegroupId() } : {}),
      ...(bqId != null ? { blockquoteId: bqId, ...(fromBlockquoteLines ? { fromBlockquoteLines: true } : {}), ...(bqClass ? { blockquoteClass: bqClass } : {}) } : {}),
      _key: nodeKey
    });
  } else if ($isPrintPageNode(node)) {
    const src = node.getSource();
    const fromPoem = typeof node.getFromPoem === 'function' && node.getFromPoem();
    const divClass = typeof node.getDivClass === 'function' ? node.getDivClass() : null;
    // A42: same shape as divClass/divId, for a print-page turn inside a bare linegroup.
    const bareLinegroup = typeof node.getBareLinegroup === 'function' && node.getBareLinegroup();
    // A40: gate on blockquoteId (any run at all), not fromBlockquoteLines (only the A35 subset).
    const bqId = typeof node.getBlockquoteId === 'function' ? node.getBlockquoteId() : null;
    const fromBlockquoteLines = bqId != null && typeof node.getFromBlockquoteLines === 'function' && node.getFromBlockquoteLines();
    const bqClass = bqId != null && typeof node.getBlockquoteClass === 'function' ? node.getBlockquoteClass() : null;
    blocks.push({
      type: 'pagenum', ...(node.getPage() !== '' ? { page: node.getPage() } : {}), ...(src.id ? { id: src.id } : {}), ...(src.pageType ? { pageType: src.pageType } : {}),
      ...(fromPoem ? { fromPoem: true } : {}),
      ...(fromPoem && node.getLatest().__poemId != null ? { poemId: node.getLatest().__poemId } : {}),   // #49
      ...(divClass ? { divClass, divId: node.getDivId() } : {}),
      ...(bareLinegroup ? { bareLinegroup: true, bareLinegroupId: node.getBareLinegroupId() } : {}),
      ...(bqId != null ? { blockquoteId: bqId, ...(fromBlockquoteLines ? { fromBlockquoteLines: true } : {}), ...(bqClass ? { blockquoteClass: bqClass } : {}) } : {}),
      _key: nodeKey
    });
    fmtToBlock(blocks[blocks.length - 1], node, FMT_PAGENUM_KEYS);
  } else if ($isTnPageNode(node)) {
    // One entry per paragraph; paragraphs sharing a noteGroup are one entry's further paragraphs.
    const entries = [];
    let lastGroup = null;
    for (const child of node.getChildren()) {
      if (!(child instanceof ParagraphNode)) continue;
      const pb = paraBlock(child);
      if (!pb) continue;
      const one = pb.type === 'math' ? { segments: [{ type: 'math', ...(pb.mathml ? { mathml: pb.mathml } : {}), ...(pb.latex ? { latex: pb.latex } : {}) }] }
        : (pb.segments ? { segments: pb.segments } : { text: pb.text });
      if (!one.segments && !String(one.text || '').trim()) continue;
      const ng = typeof child.getNoteGroup === 'function' ? child.getNoteGroup() : null;
      if (ng != null && ng === lastGroup && entries.length) (entries[entries.length - 1].paragraphs ||= []).push(one);
      else entries.push(one);
      lastGroup = ng;
    }
    const heading = node.getHeading();
    // Belt-and-braces (Paul's 26 Sep "empty sidebar" bug report, checked across all three page/box
    // containers): the editor now removes one of these the instant it is emptied by keyboard
    // (see the auto-remove update listener above), but buildModel must never itself save one that
    // is empty either way it got that way — a heading-less page with no entries has nothing for a
    // reader, and would otherwise round-trip into an empty <level1 class="bana-transcriber-notes">.
    if (!heading && !entries.length) return;
    blocks.push({ type: 'tnpage', matter: 'transcriber', ...(heading ? { heading } : {}), entries, _key: nodeKey });
  } else if ($isSymPageNode(node)) {
    const heading = node.getHeading();
    const shown = $symNodeEntries(node);
    // An automatic page saves as the marker only (the formatter derives the entries); an edited one saves them.
    // A non-automatic (explicitly edited) page with no heading and no entries left is empty — drop it (see the
    // tnpage comment just above); an automatic page is kept even with no entries yet (nothing found to list is
    // still a legitimate, non-empty-looking page once syncSymPages runs).
    if (!node.getAuto() && !heading && !shown.length) return;
    blocks.push({ type: 'sympage', matter: 'transcriber', ...(heading ? { heading } : {}), ...(node.getAuto() ? { auto: true } : { entries: shown }),
      _shown: shown.map((e) => e.description || e.print || ''), _key: nodeKey });
  } else if ($isTitlePageNode(node)) {
    // K29 Stage 1c: same auto/edited shape as sympage just above — an untouched page saves as the
    // marker only (design §3.2: the formatter/exporter derive fresh content from the document's own
    // fields, never from this block); an edited page saves its own segments/lines/chips exactly.
    blocks.push(node.getAuto() ? { type: 'titlepage', matter: 'transcriber', auto: true, _key: nodeKey }
      : { type: 'titlepage', matter: 'transcriber', segments: $titlePageSegments(node), _key: nodeKey });
  } else if ($isSidebarNode(node)) {
    const innerBlocks = [];
    for (const child of node.getChildren()) nodeToBlocks(child, innerBlocks);   // same rules inside a sidebar, nested sidebars too (A26)
    // A box's title IS its first heading, when it has one — the heading the user sees and edits; the title the box was loaded
    // with is kept only for a box without one. The braille showed the old title beside an edited (or split) one, while a save
    // writes the first heading as the title (A89, random-action testing; tests/test-box-title.mjs).
    const head = $isHeadingNode(node.getFirstChild()) && innerBlocks[0] && innerBlocks[0].type === 'heading' ? innerBlocks[0] : null;
    const boxTitle = head ? String(head.text ?? '').trim() : node.getTitle();
    // See the tnpage comment above: never save a box with no title and nothing inside it.
    if (!boxTitle && !innerBlocks.length) return;
    const boxSrc = node.getSource();
    blocks.push({
      type: 'box',
      ...(boxSrc && boxSrc.id ? { id: boxSrc.id } : {}),
      ...(boxSrc && boxSrc.render ? { render: boxSrc.render } : {}),
      title: boxTitle || undefined,
      blocks: innerBlocks.length ? innerBlocks : undefined,
      ...((fmtOf(node) || {}).noBoxLines ? { boxLines: false } : {}),   // F-230
      ...((fmtOf(node) || {}).boxColor ? { boxColor: (fmtOf(node) || {}).boxColor } : {}),   // K7
      _key: nodeKey
    });
    fmtToBlock(blocks[blocks.length - 1], node, FMT_PBB_KEYS);
  } else if ($isTableNode(node)) {
    const format = typeof node.getFormat === 'function' ? node.getFormat() : 'spatial';
    const tblBlock = {
      type: 'table',
      headers: node.getHeaders(),
      rows: node.getRows(),
      _key: nodeKey
    };
    if (format && format !== 'auto') {
      tblBlock.format = format;
      tblBlock.style = `table-${format}`;
    }
    const nodeTitle = typeof node.getTitle === 'function' ? node.getTitle() : null;
    if (nodeTitle != null) {
      tblBlock.title = nodeTitle;
      tblBlock.titlePosition = (typeof node.getTitlePosition === 'function' ? node.getTitlePosition() : 'in-box');
    }
    const headerGroups = typeof node.getHeaderGroups === 'function' ? node.getHeaderGroups() : null;
    if (headerGroups) tblBlock.headerGroups = headerGroups;
    // K3: printAlign (read from the source file) and columnAlign (the transcriber's own
    // override) both carried straight through — see document.mjs's numericAlignApplies.
    const printAlign = typeof node.getPrintAlign === 'function' ? node.getPrintAlign() : null;
    if (printAlign) tblBlock.printAlign = printAlign;
    const columnAlign = typeof node.getColumnAlign === 'function' ? node.getColumnAlign() : null;
    if (columnAlign) tblBlock.columnAlign = columnAlign;
    const subRows = typeof node.getSubdivisionRows === 'function' ? node.getSubdivisionRows() : null;
    if (subRows) tblBlock.subdivisionRows = subRows;
    const subHeading = typeof node.getSubdivisionHeading === 'function' ? node.getSubdivisionHeading() : null;
    if (subHeading != null) tblBlock.subdivisionHeading = subHeading;
    // F-5: a caption / transcriber's note carried on the table itself.
    const nodeCaption = typeof node.getCaption === 'function' ? node.getCaption() : null;
    // The formatter no longer renders table.caption (F-4: a caption is a separate `caption` block, BANA 11.2.8a, as the
    // parser emits it), so the node's caption becomes a caption block right before the table; TableNode's own JSON is unchanged.
    if (nodeCaption != null && String(nodeCaption).trim() !== '') blocks.push({ type: 'caption', text: String(nodeCaption), _key: nodeKey });
    const nodeTabletn = typeof node.getTabletn === 'function' ? node.getTabletn() : null;
    if (nodeTabletn != null) {
      tblBlock.tabletn = nodeTabletn;
      const tnRender = typeof node.getTabletnRender === 'function' ? node.getTabletnRender() : null;
      if (tnRender) tblBlock.tabletnRender = tnRender;
    }
    if (typeof node.getNoGuideDots === 'function' && node.getNoGuideDots()) tblBlock.guideDots = false;
    fmtToBlock(tblBlock, node, FMT_TABLE_KEYS);   // citation, total rows, subheadings
    blocks.push(tblBlock);
  } else if ($isImageNode(node)) {
    blocks.push(fmtToBlock({ ...imageBlock(node), _key: nodeKey }, node, FMT_PBB_KEYS));
  } else if ($isGraphicNode(node)) {
    const sz = node.getSize();
    const hLines = sz === 'compact' ? 8 : (sz === 'full' ? Math.min(24, (settings.lines || 25) - 1) : 15);
    const svg = node.getSvg();
    blocks.push({
      type: 'graphic',
      svg,
      // The NIMAS exporter writes `<img src="${block.src}">`; without a src the tactile
      // graphic silently vanished on Save. Embed the SVG as a data URI so it round-trips.
      src: svgToDataUri(svg),
      alt: node.getAlt(),
      title: node.getTitle(),
      textures: node.getTextures(),
      brailleLabels: node.getBrailleLabels(),
      size: sz,
      widthCells: settings.cells || 38,
      heightLines: hLines,
      _key: nodeKey
    });
    fmtToBlock(blocks[blocks.length - 1], node, FMT_PBB_KEYS);
  } else if ($isHeadingNode(node)) {
    const { runs, hasEmph, hasMath } = nodeToRuns(node);
    const text = node.getTextContent().replace(/\s+/g, ' ').trim();
    // #49: a poem's own title keeps its role and its poem
    const poemHead = node.getPoemRole && node.getPoemRole() === 'title' ? { poemRole: 'title', ...(node.getPoemId() != null ? { poemId: node.getPoemId() } : {}) } : {};
    if (node.getIsTitle() && node.getTag() === 'h1' && !poemHead.poemRole) {
      // #57b: the document title stays a `title` block. Its lines (Title, Subtitle) are joined by '\n', as the readers give them;
      // segments ride along only when something other than plain text (emphasis, maths, a link …) must survive the save.
      const tText = node.getTextContent().split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
      if (tText.trim()) {
        const plainRun = (r) => r.type === 'text' && Object.keys(r).every((k) => k === 'type' || k === 'text' || (k === 'tf' && !r.tf));
        const keepSegs = runs.length && (hasMath || !runs.every(plainRun));
        blocks.push(fmtToBlock({ type: 'title', ...(keepSegs ? { segments: runs } : {}), text: tText, _key: nodeKey }, node, FMT_HEADING_KEYS));
      }
    } else if (runs.length && (hasEmph || hasMath)) {
      blocks.push(fmtToBlock({ type: 'heading', level: Number(node.getTag().slice(1)) || 1, segments: runs, text, ...poemHead, _key: nodeKey }, node, FMT_HEADING_KEYS));
    } else if (text) {
      blocks.push(fmtToBlock({ type: 'heading', level: Number(node.getTag().slice(1)) || 1, text, ...poemHead, _key: nodeKey }, node, FMT_HEADING_KEYS));
    }
  } else if ($isListNode(node)) {
    const listType = typeof node.getListType === 'function' ? node.getListType() : null;
    const listKind = (typeof node.getListKind === 'function' ? node.getListKind() : null) ||
                     (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null);
    const isPlain = listType === 'plain' || listKind === 'toc' || listKind === 'index' || listKind === 'plain';
    const isExercise = listKind === 'exercise' || (typeof node.getBanaStyle === 'function' && node.getBanaStyle() === 'exercise');
    const ordered = listType === 'number' || (isExercise && !isPlain);
    const items = [];
    const symbolsOn = Array.isArray((fmtOf(node) || {}).symbols) && (fmtOf(node) || {}).symbols.length > 0;
    // G8 stage 3: the marker of an item typed in the editor comes from its sibling group's enum/start (planListMarkers);
    // a loaded item keeps its own marker (below), so an unedited document saves byte for byte as before.
    const runsOf = new Map();
    for (const li of node.getChildren()) runsOf.set(li.getKey(), nodeToRuns(li));   // keep list-item emphasis + inline maths
    const allPlan = listItemsForPlan(node, (li) => !(runsOf.get(li.getKey())?.runs.length));
    // An empty item (dropped on save) that opens a sibling group hands the group's enum/start to the next kept item of that group.
    { const gg = listGroups(allPlan);
      allPlan.forEach((x, i) => {
        if (!x.empty || gg.gi[i] !== i || !x.fmt || (x.fmt.enum == null && x.fmt.start == null)) return;
        for (let j = i + 1; j < allPlan.length; j++) {
          if (allPlan[j].level < x.level) break;
          if (allPlan[j].level !== x.level || allPlan[j].empty) continue;
          const nf = allPlan[j].fmt || {};
          if (nf.enum == null && nf.start == null) allPlan[j].fmt = { ...nf, enum: x.fmt.enum, start: x.fmt.start };
          break;
        }
      });
    }
    const planItems = allPlan.filter((x) => !x.empty);
    const fmtCarry = new Map(planItems.map((x) => [x.node.getKey(), x.fmt]));
    const plan = ordered && !isPlain ? planListMarkers(planItems, 'number', null) : null;
    const planOf = new Map(planItems.map((x, i) => [x.node.getKey(), plan ? plan[i] : null]));
    for (const li of node.getChildren()) {
      const { runs, hasEmph, hasMath } = runsOf.get(li.getKey());
      if (!runs.length) continue;
      if (isItemContLi(li)) {                          // an item's further paragraph: back into that item's blocks
        const para = (hasEmph || hasMath) ? { type: 'para', segments: runs } : { type: 'para', text: li.getTextContent().replace(/\s+/g, ' ').trim() };
        if (items.length) { (items[items.length - 1].blocks ||= []).push(para); continue; }
        // First line of a list that goes on after a table inside an item (fmt.listResume): the save joins it to the
        // item before the table (mergeListItemBlocks). Until then it is an unmarked line of this list.
        const lead = para.segments ? { segments: para.segments } : { text: para.text };
        Object.defineProperty(lead, '_itemCont', { value: true });
        items.push(lead);
        continue;
      }
      const lvl = Math.max(0, Math.min(9, typeof li.getLevel === 'function' ? (li.getLevel() || 0) : 0));   // sources nest deeper than 4 (A28)
      const pl = planOf.get(li.getKey());
      const marker = pl ? pl.marker : null;
      let item = (hasEmph || hasMath) ? { segments: runs } : { text: li.getTextContent().replace(/\s+/g, ' ').trim() };
      const bullet = typeof li.getBulletPrefix === 'function' ? li.getBulletPrefix() : null;
      if (bullet) {                                    // put the print bullet back, in its own form
        const first = item.segments && item.segments[0];
        if (item.text != null && !bullet.tf) item.text = bullet.text + item.text;
        else if (item.text != null) item.segments = [{ type: 'text', text: bullet.text, tf: bullet.tf }, { type: 'text', text: item.text, tf: 0 }];
        else if (first && first.type === 'text' && (first.tf || 0) === bullet.tf && !first.uncontracted) item.segments = [{ ...first, text: bullet.text + first.text }, ...item.segments.slice(1)];
        else item.segments = [{ type: 'text', text: bullet.text, tf: bullet.tf }, ...item.segments];
      }
      if (listKind === 'glossary') item = glossaryItem(runs) || item;
      const kept = !isPlain && typeof li.getMarker === 'function' && (ordered || li.getMarker() === NO_MARKER) ? li.getMarker() : null;   // (a bullet list keeps only "no marker")
      if (kept !== NO_MARKER && (kept || marker)) item.marker = kept || marker;
      // Bullets (BANA §8.6.2a): item.bullet beside an ordinal, and the glyph of a bullet-only item.
      fmtToBlock(item, li, FMT_ITEM_KEYS);
      { const cf = fmtCarry.get(li.getKey()); if (cf) { if (cf.enum != null && item.enum == null) item.enum = cf.enum; if (cf.start != null && item.start == null) item.start = cf.start; } }
      const lf = fmtOf(li);
      if (lf && lf.bulletMarker && item.marker == null) item.marker = lf.bulletMarker;
      // A bulleted list item always carries the dot marker: braille keeps the print bullet (BANA 8.6.2, primary bullet `_4`),
      // and with per-level `symbols` (G8 stage 3) the formatter uses the level glyphs. Without a marker an item has no bullet in braille.
      if (!ordered && !isPlain && listKind !== 'glossary' && item.marker == null && item.bullet == null && kept !== NO_MARKER) item.marker = '•';
      const page = typeof li.getPage === 'function' ? li.getPage() : null;
      if (page) item.page = page;
      // A36: the page number's own link, if it had one (see ListItemNode's getPageHref).
      const pageHref = typeof li.getPageHref === 'function' ? li.getPageHref() : null;
      if (page && pageHref) item.pageHref = pageHref;
      if (lvl > 0) item.level = lvl;
      items.push(item);
    }
    if (items.length) {
      const blk = { type: 'list', items, _key: nodeKey };
      fmtToBlock(blk, node, FMT_LIST_KEYS);
      if ((fmtOf(node) || {}).listResume) Object.defineProperty(blk, '_listResume', { value: true });   // goes on after a table inside an item (mergeListItemBlocks)
      // A bullet top item over a numbered sub-list: the list is a bullet list whose top items keep their print bullet as
      // `marker` (the exporter then writes <list type="ul"> and the sub-list's own enum/start), not a numbered list with a literal "• ".
      const rootItems = items.filter((it) => !it.level);
      const bulletOverNumbers = ordered && !isPlain && rootItems.length > 0 && rootItems.every((it) => it.marker != null && isBulletMarker(it.marker)) && items.some((it) => it.level && it.marker && !isBulletMarker(it.marker));
      if (ordered && !isPlain && !bulletOverNumbers) blk.ordered = true;
      if (listKind && listKind !== 'number') { blk.kind = listKind; blk.style = listKind; }   // 'number' is the list type, not a style
      else if (isPlain) { blk.kind = 'toc'; blk.style = 'toc'; }
      blocks.push(blk);
    }
  } else {
    const b = paraBlock(node);
    if (b) {
      b._key = nodeKey;
      blocks.push(b);
    }
  }
}

// F-164: tell the formatter where a multi-paragraph note (a run of note blocks sharing a
// noteGroup) begins and ends, so @.< opens only the first and @.> closes only the last
// (formatTranscriberNote reads block.tnPart). Blocks/keys stay one-per-editor-paragraph.
function markNoteParts(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b) continue;
    if (Array.isArray(b.blocks)) markNoteParts(b.blocks);
    // #57c: a footnote (or endnote) of several paragraphs is one footnote paragraph per paragraph, all with the note's id; a footnote
    // paragraph straight after one of the same id and kind is a further paragraph of that note (formatFootnote lays it out at 5-3,
    // noteLayout keeps it with the note, nimas-export's mergeNoteGroups folds it back into the note's <p> list).
    if (b.type === 'footnote' && b.id != null && b.id !== '') {
      const p = blocks[i - 1];
      if (p && p.type === 'footnote' && p.id === b.id && (p.kind || null) === (b.kind || null)) b.noteCont = true;
      continue;
    }
    if (b.type !== 'note' || b.noteGroup == null) continue;
    const same = (x) => x && x.type === 'note' && x.noteGroup === b.noteGroup;
    const prev = same(blocks[i - 1]), next = same(blocks[i + 1]);
    if (prev && next) b.tnPart = 'mid'; else if (next) b.tnPart = 'first'; else if (prev) b.tnPart = 'last';
  }
}

// Save: a table (or other block) inside a list item is shown in the editor as the list, the block (fmt.inItem) and the
// list going on (fmt.listResume) -- a Lexical list item cannot hold a table. The saved model has them as they were: one
// list whose item carries the block in item.blocks (document.mjs formatItemBlocks / nimas-export itemBlocksXml). The live
// braille keeps the three blocks, which format the same way (the table at cell 1 between blank lines, BANA 11.2.5).
function mergeListItemBlocks(model) {
  if (!model || !Array.isArray(model.blocks) || !model.blocks.some((b) => b && (b._inItem || b._listResume))) return model;
  const out = [];
  let open = null;
  let afterInItem = false;   // a list goes on only straight after a block inside an item: a stale mark (the block above it since
                             // deleted or changed) would join two lists the braille shows apart (A89, random-action testing)
  const lastItem = () => open.items[open.items.length - 1];
  for (const b of model.blocks) {
    if (b && b._inItem && open && open.items.length) { const { _key, ...rest } = b; (lastItem().blocks ||= []).push(rest); afterInItem = true; continue; }
    const resumes = afterInItem;
    afterInItem = false;
    if (b && b.type === 'list' && b._listResume && resumes && open && open.items.length) {
      for (const it of b.items || []) {
        if (it && it._itemCont) (lastItem().blocks ||= []).push(it.segments ? { type: 'para', segments: it.segments } : { type: 'para', text: it.text });
        else open.items.push(it);
      }
      continue;
    }
    open = b && b.type === 'list' ? { ...b, items: (b.items || []).map((it) => (it && typeof it === 'object' ? { ...it } : it)) } : null;
    out.push(open || b);
  }
  return { ...model, blocks: out, keys: undefined };
}

// Invisible control characters (codes 0-8, 11, 12, 14-31, from a paste) are left out of the document the editor brailles, as a
// save leaves them out (a file cannot hold them; nimas-export.mjs stripXmlIllegalChars): in a table cell they made the column
// wider until the document was saved and reopened (A89, random-action testing). Copy on write: a block or a table's rows can be
// the editor's own data, which is never changed here — only what holds such a character is copied (with its hidden fields).
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
function withoutControlChars(x, depth = 0) {
  if (typeof x === 'string') return CONTROL_CHARS_RE.test(x) ? x.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') : x;
  if (!x || typeof x !== 'object' || depth > 60) return x;
  let copy = null;
  for (const k of Object.keys(x)) {
    const v = withoutControlChars(x[k], depth + 1);
    if (v !== x[k]) { copy ||= Object.defineProperties(Array.isArray(x) ? [] : {}, Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(x)).map(([n, d]) => [n, 'value' in d && n !== 'length' ? { ...d, writable: true, configurable: true } : d]))); copy[k] = v; }
  }
  return copy || x;
}
function dropControlChars(blocks) { for (let i = 0; i < blocks.length; i++) blocks[i] = withoutControlChars(blocks[i]); }
function buildModel() {
  const blocks = [];
  const keys = [];                                     // parallel: the Lexical node key that produced blocks[i]
  for (const node of $getRoot().getChildren()) {
    const before = blocks.length;
    nodeToBlocks(node, blocks);
    if (blocks.length > before) keys.push(node.getKey());
    if ((fmtOf(node) || {}).inItem) for (let i = before; i < blocks.length; i++) Object.defineProperty(blocks[i], '_inItem', { value: true });   // inside the list item before it (mergeListItemBlocks)
  }
  // A list shown in parts around a table inside one of its items: every part takes the whole list's deepest level (its
  // shared runover, BANA 8.1.5), so the live braille is the saved list's braille.
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i] || blocks[i].type !== 'list' || blocks[i]._listResume) continue;
    const chain = [blocks[i]];
    let j = i + 1;
    for (; j < blocks.length && blocks[j] && (blocks[j]._inItem || (blocks[j].type === 'list' && blocks[j]._listResume)); j++) if (blocks[j].type === 'list' && blocks[j]._listResume) chain.push(blocks[j]);
    const deepest = Math.max(0, ...chain.flatMap((l) => (l.items || []).map((it) => (it && it.level) || 0)));
    if (chain.length > 1 && deepest > 0) for (const l of chain) l.maxLevel = Math.max(Number(l.maxLevel) || 0, deepest);
    // a block inside an item is nested as the list nests it when the list is saved and exported (format/document.mjs withListNestLevel, BANA 9.2.2,
    // Q-28): the live braille takes it from the list's deepest level (APH feedback 17 Oct 2026: a quotation in a list item was 2 cells left of the export's)
    for (let k = i + 1; k < j; k++) if (blocks[k] && blocks[k]._inItem) Object.defineProperty(blocks[k], '_itemListLevel', { value: deepest, configurable: true });
    i = j - 1;
  }
  markNoteParts(blocks);
  dropControlChars(blocks);
  const firstHeading = blocks.find((b) => b.type === 'heading');   // fallback title for a new document (a `title` block's reader already set loadedDocInfo.title)
  const model = { title: loadedDocInfo.title || (firstHeading ? firstHeading.text : null), blocks, keys };
  if (loadedDocInfo.metadata) model.metadata = loadedDocInfo.metadata;
  Object.assign(model, loadedDocInfo.options || {});
  // A NIMAS package's own images/PDF (A3), so a save can package them back out (A4).
  if (loadedDocInfo.resources.length) model.resources = loadedDocInfo.resources;
  return model;
}

// Save/Ctrl+S writes a NIMAS package (A4) — not a bare .xml — once the loaded document either
// carries package resources (images/PDF) or was itself imported from a package (A3), so a
// package round-trips without the user having to remember to pick "NIMAS package" by hand.
function saveFormat() {
  return (loadedDocInfo.resources.length || loadedDocInfo.metadata?.package) ? 'package' : 'xml';
}

// S5d (S2-Q1, Paul 15 Oct 2026): every save reads the LIVE document, as the NIMAS save does - the document as it is in the editor this
// instant, after the picture descriptions still being typed are put into it - never lastModel, which is the model of the last render
// and can be one edit behind. (The txt, md, html, docx and json writers used lastModel.)
function liveDocumentModel() {
  commitPendingCardDrafts();
  let doc = null;
  editor.getEditorState().read(() => { doc = mergeListItemBlocks(buildModel()); });
  return doc || lastModel || { title: null, blocks: [] };
}

// ---- toolbar state ----
function refreshToolbar(explicitTarget) {
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    let block = 'p', b = false, i = false, u = false, strike = false, script = false;

    // 1. Unconditionally sync bold / italic / underline / strikethrough / script from Lexical selection
    if ($isRangeSelection(sel)) {
      b = sel.hasFormat('bold');
      i = sel.hasFormat('italic');
      u = sel.hasFormat('underline');
      strike = sel.hasFormat('strikethrough');
      // K5: no Lexical format bit for script, so — like the DOM fallback below — this checks
      // every selected text node's own style (sel.getNodes() covers a collapsed selection's
      // one node too, matching hasFormat's own all-or-nothing semantics for the other three).
      { const tns = sel.getNodes().filter($isTextNode); script = tns.length > 0 && tns.every((n) => hasScript(n)); }
      if (sel.isCollapsed()) {
        const anchorNode = sel.anchor.getNode();
        if (anchorNode && $isTextNode(anchorNode)) {
          b = anchorNode.hasFormat('bold');
          i = anchorNode.hasFormat('italic');
          u = anchorNode.hasFormat('underline');
          strike = anchorNode.hasFormat('strikethrough');
          script = hasScript(anchorNode);
        }
      }
    } else if (lastActiveEditorSelection?.anchorKey) {
      const node = $getNodeByKey(lastActiveEditorSelection.anchorKey);
      if (node && $isTextNode(node)) {
        b = node.hasFormat('bold');
        i = node.hasFormat('italic');
        u = node.hasFormat('underline');
        strike = node.hasFormat('strikethrough');
        script = hasScript(node);
      }
    } else {
      const domSel = window.getSelection();
      const activeDomNode = (explicitTarget && editorEl.contains(explicitTarget))
        ? explicitTarget
        : ((domSel && domSel.anchorNode && editorEl.contains(domSel.anchorNode))
          ? (domSel.anchorNode.nodeType === 1 ? domSel.anchorNode : domSel.anchorNode.parentElement)
          : ((document.activeElement && editorEl.contains(document.activeElement))
            ? document.activeElement
            : null));

      // DOM fallback for bold/italic/underline/strikethrough/script ONLY when no Lexical selection available
      if (activeDomNode) {
        if (activeDomNode.closest('b, strong, .ed-b') || activeDomNode.style?.fontWeight === 'bold') b = true;
        if (activeDomNode.closest('i, em, .ed-i') || activeDomNode.style?.fontStyle === 'italic') i = true;
        if (activeDomNode.closest('u, ins, .ed-u') || activeDomNode.style?.textDecoration?.includes('underline')) u = true;
        if (activeDomNode.closest('s, strike, del, .ed-s') || activeDomNode.style?.textDecoration?.includes('line-through')) strike = true;
        if (activeDomNode.closest('[style*="--bana-script"]')) script = true;
      }
    }

    const domSel = window.getSelection();
    const activeDomNode = (explicitTarget && editorEl.contains(explicitTarget))
      ? explicitTarget
      : ((domSel && domSel.anchorNode && editorEl.contains(domSel.anchorNode))
        ? (domSel.anchorNode.nodeType === 1 ? domSel.anchorNode : domSel.anchorNode.parentElement)
        : ((document.activeElement && editorEl.contains(document.activeElement))
          ? document.activeElement
          : null));

    // 2. Resolve block style: Innermost-first from Lexical AST if range selection available
    let detectedBlock = null;
    if ($isRangeSelection(sel)) {
      let node = sel.anchor.getNode();
      let hasContainer = false;
      while (node && node !== $getRoot()) {
        if ($isTableNode(node)) {
          detectedBlock = (typeof node.getFormat === 'function' && node.getFormat() === 'listed') ? 'table-listed' : 'table-spatial';
          break;
        }
        if ($isHeadingNode(node)) {
          detectedBlock = node.getTag().toLowerCase();
          break;
        }
        if ($isListNode(node)) {
          const lKind = (typeof node.getListKind === 'function' ? node.getListKind() : null) || (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null);
          detectedBlock = lKind || node.getListType() || 'bullet';
          break;
        }
        if ($isQuoteNode(node)) {
          detectedBlock = 'quote';
          break;
        }
        if ($isBreakNode(node)) {
          detectedBlock = 'break';
          break;
        }
        if ($isPrintPageNode(node)) {
          detectedBlock = 'print-page';
          break;
        }
        if (typeof node.getBanaStyle === 'function') {
          const bs = node.getBanaStyle();
          if (bs && bs !== 'body' && bs !== 'sidebar') {
            detectedBlock = bs;
            break;
          }
        }
        if ($isSidebarNode(node)) {
          hasContainer = true;
        }
        node = node.getParent ? node.getParent() : null;
      }
      if (!detectedBlock && hasContainer) {
        detectedBlock = 'sidebar';
      }
    } else if (lastActiveEditorSelection?.anchorKey) {
      let node = $getNodeByKey(lastActiveEditorSelection.anchorKey);
      let hasContainer = false;
      while (node && node !== $getRoot()) {
        if ($isTableNode(node)) {
          detectedBlock = (typeof node.getFormat === 'function' && node.getFormat() === 'listed') ? 'table-listed' : 'table-spatial';
          break;
        }
        if ($isHeadingNode(node)) {
          detectedBlock = node.getTag().toLowerCase();
          break;
        }
        if ($isListNode(node)) {
          const lKind = (typeof node.getListKind === 'function' ? node.getListKind() : null) || (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null);
          const rawType = (typeof node.getListType === 'function' ? node.getListType() : null);
          detectedBlock = lKind || rawType || 'bullet';   // a plain list reports as 'plain', not 'index'
          break;
        }
        if ($isQuoteNode(node)) {
          detectedBlock = 'quote';
          break;
        }
        if ($isBreakNode(node)) {
          detectedBlock = 'break';
          break;
        }
        if ($isPrintPageNode(node)) {
          detectedBlock = 'print-page';
          break;
        }
        if (typeof node.getBanaStyle === 'function') {
          const bs = node.getBanaStyle();
          if (bs && bs !== 'body' && bs !== 'sidebar') {
            detectedBlock = bs;
            break;
          }
        }
        if ($isSidebarNode(node)) {
          hasContainer = true;
        }
        node = node.getParent ? node.getParent() : null;
      }
      if (!detectedBlock && hasContainer) {
        detectedBlock = 'sidebar';
      }
    }

    // 3. If not detected from Lexical AST (e.g. focused on custom widget input), resolve from DOM innermost first
    if (!detectedBlock && activeDomNode && editorEl.contains(activeDomNode) && activeDomNode !== editorEl) {
      const tableEl = activeDomNode.closest('.doc-table-block, .emboss-table-card, .editor-table-widget, table') || (activeDomNode.classList.contains('table-cell-input') ? activeDomNode : null);
      if (tableEl) {
        const be = activeDomNode.closest('[data-block-idx]');
        const bi = be ? Number(be.dataset.blockIdx) : NaN;
        const bModel = !Number.isNaN(bi) ? lastModel?.blocks?.[bi] : null;
        const format = bModel?.format || bModel?.style || 'spatial';
        detectedBlock = (format === 'listed' || format === 'table-listed') ? 'table-listed' : 'table-spatial';
      } else {
        // Check innermost styled element first (excluding sidebar container)
        const banaEl = activeDomNode.closest('[data-bana-style]:not(aside):not(.emboss-sidebar-card):not(.emboss-box-card)');
        if (banaEl) {
          const bs = banaEl.dataset.banaStyle;
          detectedBlock = bs;
        } else {
          const hEl = activeDomNode.closest('h1, h2, h3, h4, h5, h6');
          if (hEl) {
            detectedBlock = hEl.tagName.toLowerCase();
          } else {
            const listEl = activeDomNode.closest('ul, ol');
            if (listEl) {
              const lk = listEl.dataset.listKind || listEl.dataset.banaStyle;
              const rawType = listEl.dataset.listType;
              detectedBlock = lk || (rawType === 'plain' ? 'plain' : (listEl.tagName === 'OL' ? 'number' : 'bullet'));
            } else if (activeDomNode.closest('blockquote')) {
              detectedBlock = 'quote';
            } else if (activeDomNode.closest('.doc-break')) {
              detectedBlock = 'break';
            } else if (activeDomNode.closest('.doc-print-page')) {
              detectedBlock = 'print-page';
            } else {
              // If no inner style, check if inside sidebar container
              const sidebarEl = activeDomNode.closest('aside, .emboss-sidebar-card, .emboss-box-card, [data-bana-style="sidebar"]');
              if (sidebarEl) {
                detectedBlock = 'sidebar';
              }
            }
          }
        }
      }
    }

    block = detectedBlock || 'p';

    if ($id('blockStyle')) syncStyleOptionVisibility(allBlockStyleOptions.some((o) => o.value === block) ? block : 'p');
    const si = $id('styleInspector');
    if (si) {
      si.textContent = formatStyleInspectorBadge(block, settings.profile || settings.mode || 'bana', uiText);
    }
    $id('btnBold')?.setAttribute('aria-pressed', String(b));
    $id('btnItalic')?.setAttribute('aria-pressed', String(i));
    $id('btnUnderline')?.setAttribute('aria-pressed', String(u));
    $id('btnStrike')?.setAttribute('aria-pressed', String(strike));
    $id('btnScript')?.setAttribute('aria-pressed', String(script));

    // F-39 — sync the "Blocked Paragraph" toggle to the current selection's own paragraph.
    let blockedPara = false;
    if ($isRangeSelection(sel)) {
      const p = nearestParagraphNode(sel.anchor.getNode());
      if (p) blockedPara = p.getBlocked();
    } else if (lastActiveEditorSelection?.anchorKey) {
      const p = nearestParagraphNode($getNodeByKey(lastActiveEditorSelection.anchorKey));
      if (p) blockedPara = p.getBlocked();
    }
    $id('btnBlockedPara')?.setAttribute('aria-pressed', String(blockedPara));
    let dirPara = false;
    {
      const p = $isRangeSelection(sel) ? nearestParagraphNode(sel.anchor.getNode())
        : (lastActiveEditorSelection?.anchorKey ? nearestParagraphNode($getNodeByKey(lastActiveEditorSelection.anchorKey)) : null);
      if (p) dirPara = !!(fmtOf(p) || {}).directions;
    }
    $id('btnDirectionsPara')?.setAttribute('aria-pressed', String(dirPara));
    // Greyed out unless the selection touches a Body Text paragraph (not re-judged while focus is in the toolbar,
    // so pressing a button never disables it under the pointer).
    if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.toolbar'))) {
      const noBody = selectedBodyParagraphs().size === 0;
      for (const id of ['btnBlockedPara', 'btnDirectionsPara']) { const bt = $id(id); if (bt) bt.disabled = noBody; }
    }

    // Check if caret/selection is inside a list item to update Indent/Outdent buttons
    let activeLi = null;
    if ($isRangeSelection(sel)) {
      let n = sel.anchor.getNode();
      while (n && n !== $getRoot()) {
        if ($isListItemNode(n)) { activeLi = n; break; }
        n = n.getParent ? n.getParent() : null;
      }
    } else if (lastActiveEditorSelection?.anchorKey) {
      let n = $getNodeByKey(lastActiveEditorSelection.anchorKey);
      while (n && n !== $getRoot()) {
        if ($isListItemNode(n)) { activeLi = n; break; }
        n = n.getParent ? n.getParent() : null;
      }
    } else if (activeDomNode && editorEl.contains(activeDomNode)) {
      const liEl = activeDomNode.closest('li');
      if (liEl) {
        const lvl = parseInt(liEl.dataset.level || '0', 10) || 0;
        activeLi = { getLevel: () => lvl };
      }
    }
    const curLevel = activeLi ? (activeLi.getLevel() || 0) : 0;
    const btnIndent = $id('btnIndent');
    const btnOutdent = $id('btnOutdent');
    if (btnIndent) btnIndent.disabled = !activeLi || (curLevel >= 4);
    if (btnOutdent) btnOutdent.disabled = !activeLi || (curLevel <= 0);
  });
  // Layout is greyed out where the dialog has nothing to offer this user (Paul, 24 Sep). Not re-judged while focus is
  // in the toolbar itself (the table check reads the focused cell, and pressing the button must not disable it).
  const btnFmt = $id('btnBrailleFmt');
  if (btnFmt && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('.toolbar'))) btnFmt.disabled = !bfHasTarget();
}

// Feedback 30 Sep, item 6 (Paul, 1 Oct): the Settings dialog's "Page size preset" list shows the size in use (or "Custom size"),
// the current standard's sizes first (settings.mjs fillPageSizeSelect).
function syncPageSizeSelect() {
  fillPageSizeSelect($id('set-pageSize'), $id('set-mode')?.value || settings.mode, $id('set-cells')?.value ?? settings.cells, $id('set-lines')?.value ?? settings.lines, t);
}

// ---- live braille render (honours the shared settings) ----
let lastBrf = '';
let lastModel = null;      // for the volume-aware download
let lastFormatOpts = null;
let lastTrace = null;
let lastWarnings = [];      // set by render(): opts.warnings from the most recent format (Fable review #5)
let lastPageLineStarts = null;                     // set by render(): first trace row of each braille page
let timer = null;
let isManualZoom = false;
let brailleCellW = Number(settings.brailleCellW) || 18;   // dot-cell size (the legibility control)

// Persistent paragraph / block-level caches to make long documents fast
const blockTranslationCache = new Map();
const proofreadCache = new Map();
function clearTranslationCache() {
  blockTranslationCache.clear();
  proofreadCache.clear();
}
window.clearTranslationCache = clearTranslationCache;   // test hook: random-action testing compares a cached render with a fresh one

function getEffectiveCellW() {
  const numCells = Math.max(10, (settings.cells | 0) || 38);
  const container = brailleEl || $id('braille');
  const width = container ? container.clientWidth : 500;
  // Calculate cell width so all numCells fit inside available pane width with padding
  const targetW = Math.max(9, Math.min(30, Math.floor((width - 36) / (numCells * 0.96))));
  return targetW || 16;
}

// The braille code in force. render() is synchronous, so the table it uses must already
// be in the engine's filesystem: activateTable() fetches the selected code's tables
// (and everything they include) and only then swaps it in; until it resolves — or if the
// code cannot be loaded — the previous table stays active and the user is told.
// Before this the language dropdown was saved and its tables fetched, but every render
// still translated English UEB at the selected grade: the choice had no effect at all.
let activeTable = UEB_TABLES.g2;
async function activateTable() {
  const want = resolveTable(settings);
  if (want === activeTable) return activeTable;
  try {
    await louis.ensureTables(want);
    activeTable = want;
  } catch (e) {
    console.warn('braille code unavailable, keeping', activeTable, e);
    setStatus(t('app.render.table_failed', { code: settings.brailleCode }));
  }
  return activeTable;
}
function currentFormatOpts() {
  const table = activeTable;
  const tr = makeTranslators(louis, table);
  // Grade-1 translator for segments marked `uncontracted` (UEB only — the formatter
  // falls back to bracketing the contracted text when this is absent).
  const translateG1 = /en-ueb/.test(table) ? (s, tf) => makeTranslators(louis, UEB_TABLES.g1).translate(s, tf) : undefined;
  // In contracted UEB a sub/superscript run longer than one item puts its word in grade 1 (text-style.mjs).
  const translate = styledTranslate((s, tf) => tr.translate(s, tf), settings.quoteStyle, /en-ueb-g2/.test(table) ? translateG1 : null);
  // Mirrors `translate` for the cell trace: the same quote exchange and whitespace/invisible-character
  // clean-up, with inputPos mapped back to the source text (A71).
  // ... and with the grade-1 translator, as `translate` has it, so a sub/superscript run of more than one item is traced too
  // (feedback 30 Sep item 7: those blocks fell back and showed "Editor link degraded" as a transcription warning).
  const translatePos = styledTranslatePos((s, tf) => tr.translatePos(s, tf || null), settings.quoteStyle, /en-ueb-g2/.test(table) ? translateG1 : null);
    const preset = EMBOSSER_PRESETS[settings.embosser];
    const defaultWidth = preset ? preset.cells : 38;
    const defaultDepth = preset ? preset.lines : 25;
    return {
      translateG1,
      mode: settings.mode,
      standard: settings.mode,
      width: Math.max(10, (settings.cells | 0) || defaultWidth),
      depth: Math.max(10, (settings.lines | 0) || defaultDepth),
      suppressHeader: settings.pageHeaders === false,
      paragraphStyle: settings.paragraphStyle || 'indented',
      tableFormat: settings.tableFormat || 'auto',
      interpoint: settings.embosserDuplex !== 'single',   // K15: a facing-pages table starts on an even (left-hand) page in interpoint
      listStyle: settings.listStyle, toc: settings.toc, translate, translatePos,
      titleInBraille: titleFieldShown(),   // F9 E2a (Paul, 9 Oct 2026): with the Title field hidden, no title is added to the braille (page 1, running heads); the field shown = as before
      quoteStyle: settings.quoteStyle,   // UK-3: so suggestTranscriberNotes(buildModel().blocks, currentFormatOpts()) can offer the RUEB 7.6.4 note
      mathToBrf: maths.isMathsReady() ? (seg) => maths.mathToBrf(seg, effectiveMathCode(settings)) : null,
      // What the eBraille export declares (S3b #17, #18): the braille system and language of the table this braille is made with, and the maths code.
      brailleSystem: registryName(settingsForTable(table)), brailleCode: settingsForTable(table).brailleCode, codeLanguage: codeLanguage(settingsForTable(table)), mathCode: effectiveMathCode(settings),
      blockCache: blockTranslationCache,
    };
}
// Renders are async and may overlap (a keystroke lands while a large document is still
// formatting). Each call takes a generation number; after every await a call that is no
// longer the newest bails out, so lastModel/lastBrf/lastKeys and the braille pane always
// reflect the most recent editor state and never a stale, slower render that finished last.
// Optional timing marks (feedback item 11, measuring Chrome against Safari's engine): recorded only while a test has set
// window.__embossPerf to an array; each mark is [label, performance.now()].
const perfMark = (label) => { if (Array.isArray(window.__embossPerf)) window.__embossPerf.push([label, performance.now()]); };
// One paragraph Emboss cannot braille must not take the whole braille pane with it (A89 step 3; Paul, 2 Oct: "it is vital that
// Emboss is robust"). If brailling the document throws, each block is brailled on its own to find the ones that fail; those are
// replaced in the braille by a marker ("[Emboss could not braille this paragraph]"), the rest is brailled as usual, the status
// says so, and the error goes into Report a problem's log. If no single block fails on its own, the error stands as before.
// window.__embossTestBreakBlock (tests only: a function of a block) makes chosen blocks fail.
async function formatForRender(model, fo) {
  const attempt = async (m, opts) => {
    const slow = Number(window.__embossTestFormatDelay) || 0;   // tests only (S2a #2): makes the formatting take this many ms
    if (slow > 0) await new Promise((r) => setTimeout(r, slow));
    const breaker = window.__embossTestBreakBlock;
    if (typeof breaker === 'function' && (m.blocks || []).some((b) => breaker(b))) throw new Error('test: a block that cannot be brailled');
    // a block inside a list item, shown here as a block of its own: nested as the list nests it in the saved and exported document
    if ((m.blocks || []).some((b) => b && b._itemListLevel != null)) m = { ...m, blocks: m.blocks.map((b) => (b && b._itemListLevel != null ? withListNestLevel(b, b._itemListLevel, opts) : b)) };
    return formatDocumentAsync(m, opts);
  };
  try {
    return { brf: await attempt(model, fo), failed: [] };
  } catch (e) {
    recordProblem('render', `Brailling the document failed: ${e?.message || e}`, { stack: e?.stack || '' });
    const blocks = model.blocks || [];
    const failed = [];
    for (let i = 0; i < blocks.length; i++) {
      try { await attempt({ ...model, blocks: [blocks[i]], keys: [model.keys?.[i]] }, { ...fo, trace: {}, warnings: undefined }); }
      catch (e2) { failed.push(i); recordProblem('render', `Block ${i} (${blocks[i]?.type || 'para'}) could not be brailled: ${e2?.message || e2}`, { stack: e2?.stack || '' }); }
    }
    if (!failed.length || failed.length === blocks.length) throw e;
    const marker = `[${tOr('app.render.block_failed', 'Emboss could not braille this paragraph')}]`;
    model.blocks = blocks.map((b, i) => (failed.includes(i) ? { type: 'para', text: marker } : b));
    for (const k of Object.keys(fo.trace || {})) delete fo.trace[k];
    delete fo.warnings;
    return { brf: await attempt(model, fo), failed };
  }
}
let engineLoading = false;   // true from start-up until the braille engine is up: the loading message in the braille pane stays until the first real render (F9 item I)
// F9 item A: a render is waiting for its 200 ms timer or running (several seconds on a 1,200-page book). Anything that jumps to a
// place in the braille (the "words to check" badge) waits for it: the render's own clean-up clears word highlights, and its
// proofreading pass replaces the list of words.
let renderActive = 0;
const renderPending = () => renderActive > 0 || !!timer;
window.renderIsIdle = () => !renderPending();   // tests (timing checks)
async function renderSettled(maxMs = 120000) {
  const t0 = performance.now();
  while (renderPending() && performance.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 40));
}
// S2a #2/#3: the current document's braille, or null (see the comment at outputGen). Synchronous, so a download or an emboss
// of braille that is already current stays inside the click that asked for it (browsers allow a download, and a serial-port
// request, only soon after a click).
function currentOutput() {
  if (engineLoading || timer || renderFailure || outputGen === 0 || outputGen !== renderGen || renderedSettingsState !== settingsState()) return null;
  return { brf: lastBrf, model: lastModel, opts: lastFormatOpts };
}
// Waits (at most two minutes) for the braille of the current document: puts any picture description being typed into the
// document, runs the render now instead of after the 200 ms wait, and waits for it. A render that fails, or a failure left by an
// earlier one that a fresh try does not mend, gives { failed: message }. Shows "Preparing braille…" if the wait is noticeable.
async function waitForCurrentOutput() {
  const prepMsg = tOr('app.export.preparing', 'Preparing braille…');
  const prepTimer = setTimeout(() => { setStatus(prepMsg); announce(prepMsg); }, 400);
  const t0 = performance.now();
  let kicked = false, retried = false, kicks = 0;
  try {
    while (performance.now() - t0 < 120000) {
      commitPendingCardDrafts();
      const out = currentOutput();
      if (out) return { out };
      const idle = renderActive === 0 && !timer;
      if (renderFailure && renderFailure.gen === renderGen && idle && renderedSettingsState === settingsState()) {
        if (kicked || retried) return { failed: renderFailure.message };   // our own render failed, or the retry did
        retried = true; render();                                           // a failure left from before: try once more, the cause may have gone
      } else if (!engineLoading && (timer || renderedSettingsState !== settingsState() || (renderActive === 0 && outputGen !== renderGen))) {
        if (++kicks > 12) break;
        kicked = true; render();
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return { timedOut: true };
  } finally {
    clearTimeout(prepTimer);
    if (currentStatusText === prepMsg) setStatus('');
  }
}
function refuseOutput(action, res) {
  const what = action === 'emboss' ? tOr('app.export.nothing_sent', 'Nothing was sent to the embosser') : tOr('app.export.nothing_downloaded', 'Nothing was downloaded');
  const msg = res && res.failed != null
    ? `${what}: ${tOr('app.export.failed_reason', 'the braille for the current text could not be made (see the braille pane). Change the text or settings and try again.')}`
    : `${what}: ${tOr('app.export.timeout_reason', 'the braille is still being prepared. Try again in a moment.')}`;
  setStatus(msg); announce(msg);
}
// The settings a render depends on, as one string: what the last render used, and what Settings holds now (F9 item D2, see the Settings dialog's close handler).
const settingsState = () => JSON.stringify([settings, transcriberTools, titleFieldShown()]);
// S2a #2/#3 (audit 15 Oct 2026): the braille in lastBrf / lastModel / lastFormatOpts belongs to ONE render. A download or an
// emboss must use the braille of the document and settings as they are NOW, so it may use that output only if
//   - the render that made it is the newest one asked for (outputGen === renderGen: nothing has asked for another since),
//   - no render is waiting for its 200 ms timer, and the settings are the ones that render used, and
//   - the newest render did not fail (renderFailure: a render that failed as a whole leaves the previous document's braille
//     in lastBrf - the pane shows the error, but nothing may be downloaded or embossed from that old output).
// Otherwise waitForCurrentOutput() flushes the timer / starts the render and waits for it, and refuses if it fails.
// (A paragraph that fails ALONE is marked in the braille and the render succeeds, A89 - that output stays usable.)
let outputGen = 0;          // the render (renderGen) whose output lastBrf / lastModel / lastFormatOpts hold; 0 = none yet
let renderFailure = null;   // { gen, message } while the newest render failed as a whole
let renderedSettingsState = null;
let renderGen = 0;
async function render() {
  if (engineLoading) return;   // not yet: the engine is still loading (F9 item I)
  perfMark('render:start');
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const gen = ++renderGen;
  renderedSettingsState = settingsState();
  renderActive++;
  let committed = false;   // lastBrf / lastModel / lastFormatOpts now hold THIS render's output
  try {
    const model = editor.getEditorState().read(buildModel);
    perfMark('render:buildModel');
    syncDocTitleField(model);
    syncSymPages(model);
    syncTitlePages(model);   // K29 Stage 1c: TP-6 "fields stay live" — see that function's own comment
    const table = activeTable;
    const o = currentFormatOpts();
    const trace = {};
    const fo = { ...o, trace };
    perfMark('render:before-format');
    const { brf, failed: failedBlocks } = await formatForRender(model, fo);
    perfMark('render:formatDocument');
    if (gen !== renderGen) return;                  // superseded by a newer render
    if (titleHintPending) {
      titleHintPending = false;
      if (settings?.mode === 'ukaaf' && brf.split('\f').length < 2) {
        const hint = tOr('app.editor.doc_title_hint_ukaaf', 'The title will appear in the running head from braille page 2.');
        setStatus(hint); announce(hint);
      }
    }
    if (failedBlocks.length) {
      const msg = failedBlocks.length === 1 ? tOr('app.render.blocks_failed_one', 'Emboss could not braille 1 paragraph; it is marked in the braille.')
        : tOr('app.render.blocks_failed', 'Emboss could not braille {count} paragraphs; each is marked in the braille.').replace('{count}', failedBlocks.length);
      setStatus(msg); announce(msg);
    }
    refreshAllTableBadges();          // G15: covers a settings change (width/mode) too, not just a table edit
    lastModel = model; lastFormatOpts = o;
    lastTrace = trace;
    lastBrf = brf;
    outputGen = gen; renderFailure = null; committed = true;   // S2a #2/#3: the output is this render's, and it did not fail
    lastKeys = model.keys;
    lastWarnings = Array.isArray(fo.warnings) ? fo.warnings : [];   // Fable review #5: transcription-warnings channel
    updateWarningsUI();
    updateSymbolNotice(model, fo);
    window.lastModel = lastModel;
    window.lastFormatOpts = lastFormatOpts;
    window.lastTrace = lastTrace;
    window.lastBrf = lastBrf;
    window.lastWarnings = lastWarnings;
    window.cellText = cellText;
    const getPrintTextForBlock = (b) => {
      if (!b) return '';
      if (typeof b.text === 'string' && b.text) return b.text;
      if (Array.isArray(b.segments)) return b.segments.map((s) => (s.text != null ? s.text : (s.latex != null ? s.latex : ''))).join('');
      if (typeof b.latex === 'string') return b.latex;
      return '';
    };
    const allBrfLines = [];
    const pageLineStarts = [];                     // index into allBrfLines where each braille page begins
    (brf.split('\f')).forEach((page) => {
      const lines = page.split(/\r\n|\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      pageLineStarts.push(allBrfLines.length);
      allBrfLines.push(...lines);
    });
    lastPageLineStarts = pageLineStarts;
    const rowPrintText = new Array(allBrfLines.length).fill('');
    let prevBi = -1;
    let listItemIdx = 0;
    let assignedBlockBi = -1;
    for (let i = 0; i < allBrfLines.length; i++) {
      const bi = trace.rows ? trace.rows[i] : null;
      const rawLine = allBrfLines[i] || '';
      if (bi == null || bi < 0 || !model.blocks || !model.blocks[bi]) {
        prevBi = -1;
        listItemIdx = 0;
        assignedBlockBi = -1;
        continue;
      }
      const b = model.blocks[bi];
      if (b.type === 'list' && Array.isArray(b.items)) {
        if (bi !== prevBi) { listItemIdx = 0; } else if (rawLine.trim()) { listItemIdx++; }
        prevBi = bi;
        if (!rawLine.trim()) continue;
        const rCells = trace.rowCells ? trace.rowCells[i] : null;
        let itemIndex = listItemIdx;
        // Units count an item's further paragraphs (item.blocks) as list lines of their own (document.mjs traceItemBlocks).
        const unitLines = b.items.some((it) => it && Array.isArray(it.blocks))
          ? b.items.flatMap((it) => [it, ...(it && Array.isArray(it.blocks) ? it.blocks.filter((x) => x && (x.type === 'para' || x.type == null) && !x.style) : [])])
          : b.items;
        if (rCells && rCells[0] && typeof rCells[0].u === 'number' && rCells[0].u < unitLines.length) {
          itemIndex = rCells[0].u;
        }
        const item = unitLines[itemIndex];
        if (item) {
          let text = '';
          if (typeof item === 'string') text = item;
          else if (item.text) text = item.text;
          else if (Array.isArray(item.segments)) text = item.segments.map((s) => (s.text != null ? s.text : (s.latex != null ? s.latex : ''))).join('');
          const marker = item.marker ? `${item.marker} ` : '• ';
          rowPrintText[i] = marker + text;
        }
      } else {
        if (bi !== prevBi) {
          assignedBlockBi = -1;
          prevBi = bi;
        }
        if (rawLine.trim() && assignedBlockBi !== bi) {
          rowPrintText[i] = getPrintTextForBlock(b);
          assignedBlockBi = bi;
        }
        listItemIdx = 0;
      }
    }
    const prevBrailleScroll = brailleEl.scrollTop;
    perfMark('render:rowPrintText');
    renderBraille(brailleEl, brf, {
      rows: trace.rows, rowCells: trace.rowCells, cells: (settings.cells | 0) || (EMBOSSER_PRESETS[settings.embosser]?.cells || 38),
      cellW: isManualZoom ? brailleCellW : undefined,   // Ctrl/⌘+Shift+= / − zoom; auto-fit otherwise
      textMode: false, asciiBraille: settings.asciiBraille,
      volumePages: Number(settings.volumePages) || 0,
      rowPrintText, blocks: model.blocks,
      embosser: settings.embosser,
      tactileGraphics: settings.tactileGraphics,
      hardwarePreview: settings.expertHardware === true,   // the tactile-graphic hardware preview: expert hardware features only (feedback item 8)
    });
    if (!reader || !reader.speaking) {
      brailleEl.scrollTop = prevBrailleScroll;
    }
    // A re-render mid-read (braille resize, settings, TOC toggle) rebuilds the braille
    // DOM and drops the karaoke classes. Keep playback going and re-tint the line being
    // read; the per-word dots re-apply on the next speech boundary.
    if (reader && reader.speaking) {
      if (brailleEl._virtualBraille?.isVirtualized()) {
        brailleEl._virtualBraille.setReadingBlock(readingBlock);
      } else {
        brailleEl.querySelectorAll(`.brl-row[data-block="${readingBlock}"]`).forEach((r) => r.classList.add('brl-reading'));
      }
    }
    perfMark('render:renderBraille');
    tagPrintBlocks(model.keys);                     // label print blocks so click-to-link can find them
    perfMark('render:tagPrintBlocks');
    linkCursor();                                   // re-apply the print↔braille highlight after the re-render
    annotateRows(model);                            // hover a braille line → see its source text
    perfMark('render:annotateRows');
    buildCellText(model);                           // per (block,unit) flat text for word lookup + rule info
    perfMark('render:buildCellText');
    syncCaretWithBraille();                         // re-apply word/math highlights on freshly rendered DOM
    runProofread(model, table);                     // round-trip check → badge + flag lines to review
    const pages = brf ? brf.split('\f').length : 0;
    updateCaretLocation();
    perfMark('render:caret+proofread-start');
    const graphicMap = new Map();
    if (model.blocks && trace.rows) {
      for (let bi = 0; bi < model.blocks.length; bi++) {
        const b = model.blocks[bi];
        if (b && (b.type === 'graphic' || b.type === 'tactile') && b.svg) {
          const lineIdx = trace.rows.findIndex(rBi => rBi === bi);
          const startLine = lineIdx >= 0 ? lineIdx : 0;
          const matrix = await rasterizeSvgToDotPadCells(b.svg);
          const monarchMatrix = await rasterizeSvgToMonarchCells(b.svg);
          if (gen !== renderGen) return;            // superseded while rasterising
          const m = String(b.svg).match(/data-braille-line=["']([^"']+)["']/);
          const title = (m && m[1]) || (b.title || b.alt || 'Graphic');
          const uebTitle = (m && m[1]) ? m[1] : (defaultBrailleTranslator ? defaultBrailleTranslator(title).slice(0, 20).padEnd(20, '⠀') : title.slice(0, 20));
          graphicMap.set(startLine, { matrix, monarchMatrix, title: uebTitle });
        }
      }
    }
    if (gen !== renderGen) return;                  // superseded before the device push
    await tactileDisplay.updateBraille(allBrfLines, null, graphicMap);
    perfMark('render:tactileDisplay');
    if (gen !== renderGen) return;
    if (currentBrailleTab === 'monarch' && typeof drawMonarchEmulator === 'function') {
      drawMonarchEmulator(tactileDisplay.getMonarchActiveFrame());
    } else if (currentBrailleTab === 'dotpad' && typeof drawDotPadEmulator === 'function') {
      drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
    }
  } catch (e) {
    console.error(e);
    if (gen !== renderGen) return;                  // a newer render owns the pane now
    const msg = String((e && e.message) || e);       // tolerate a non-Error throw (no .message)
    if (!committed) renderFailure = { gen, message: msg };   // S2a #3: lastBrf is still the previous document's: not downloadable or embossable
    brailleEl.textContent = `${t('app.render.failed')}\n\n${msg}\n\n${t('app.render.failed_hint')}`;
    setStatus(t('app.render.error_status', { message: msg }));
  } finally {
    renderActive--;
  }
}
const scheduleRender = () => { clearTimeout(timer); timer = setTimeout(render, 200); };
editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
  refreshToolbar();
  linkCursor();
  try {
    editorState.read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel) && sel.anchor.key !== 'root') {
        lastActiveEditorSelection = {
          anchorKey: sel.anchor.key,
          anchorOffset: sel.anchor.offset,
          focusKey: sel.focus.key,
          focusOffset: sel.focus.offset,
        };
      }
    });
  } catch (_) {}
  // Only re-render when the CONTENT changed. A selection-only update (clicking to
  // place the caret) must NOT re-render — that rebuilds the braille DOM and would
  // wipe a just-made word/cell link highlight (it flashed then vanished before).
  if (dirtyElements.size > 0 || dirtyLeaves.size > 0) {
    clearWordLink();
    scheduleRender();
  }
});

// ---- print ↔ braille linking ----
// Highlight the braille for the block the caret is in (and the block itself), and
// let a click in the braille pane highlight the matching print block. Linking is
// by *block key* (not index) so it survives blocks being added/removed above.
let lastKeys = [];
// A Transcriber's Notes page's entry paragraphs are the formatter's units 0,1,2... (traceBlock's
// tnpageParas skips empty ones, so an empty paragraph gets no unit). The heading has none.
function tagTnPageUnits(el, blockIdx) {
  let u = 0;
  for (const childEl of Array.from(el.children)) {
    if (!(childEl.textContent || '').trim()) continue;
    childEl.dataset.unitIdx = String(u++);
    childEl.dataset.parentBlockIdx = String(blockIdx);
  }
}
// A Special Symbols page's entry paragraphs are the formatter's units 0,1,2... (every entry, in order).
function tagSymPageUnits(el, blockIdx) {
  let u = 0;
  for (const childEl of Array.from(el.children)) {
    if (!(childEl.textContent || '').trim()) continue;
    childEl.dataset.unitIdx = String(u++);
    childEl.dataset.parentBlockIdx = String(blockIdx);
  }
}
function tagPrintBlocks(keys) {
  lastKeys = keys || [];
  editorEl.querySelectorAll('[data-block-idx]').forEach((el) => el.removeAttribute('data-block-idx'));
  editorEl.querySelectorAll('[data-unit-idx]').forEach((el) => {
    el.removeAttribute('data-unit-idx');
    el.removeAttribute('data-parent-block-idx');
  });
  if (keys && keys.length) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const el = key ? editor.getElementByKey(key) : null;
      if (el) {
        el.dataset.blockIdx = String(i);
        const b = lastModel?.blocks?.[i];
        if (b && (b.type === 'box' || b.type === 'sidebar') && Array.isArray(b.blocks)) {
          const sideChildren = Array.from(el.children);
          b.blocks.forEach((cb, u) => {
            const childEl = (cb && cb._key ? editor.getElementByKey(cb._key) : null) || sideChildren[u];
            if (childEl) {
              childEl.dataset.unitIdx = String(u);
              childEl.dataset.parentBlockIdx = String(i);
            }
          });
        }
        else if (b && b.type === 'tnpage') tagTnPageUnits(el, i);
        else if (b && b.type === 'sympage') tagSymPageUnits(el, i);
      }
    }
  } else {
    const children = Array.from(editorEl.children);
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el) {
        el.dataset.blockIdx = String(i);
        const b = lastModel?.blocks?.[i];
        if (b && (b.type === 'box' || b.type === 'sidebar') && Array.isArray(b.blocks)) {
          const sideChildren = Array.from(el.children);
          b.blocks.forEach((cb, u) => {
            const childEl = sideChildren[u];
            if (childEl) {
              childEl.dataset.unitIdx = String(u);
              childEl.dataset.parentBlockIdx = String(i);
            }
          });
        }
        else if (b && b.type === 'tnpage') tagTnPageUnits(el, i);
        else if (b && b.type === 'sympage') tagSymPageUnits(el, i);
      }
    }
  }
}
function clearLink() {
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.setLinkedBlock(null);
  } else {
    brailleEl.querySelectorAll('.brl-linked').forEach((r) => r.classList.remove('brl-linked'));
  }
  editorEl.querySelectorAll('.print-linked').forEach((r) => r.classList.remove('print-linked'));
}
function clearAllHighlights() {
  clearLink();
  clearWordLink();
}

function isElementVisibleIn(el, container, padding = 24) {
  if (!el || !container) return false;
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  return (eRect.bottom >= cRect.top + padding && eRect.top <= cRect.bottom - padding);
}

let lastLinkedBlock = null;
function linkByBlock(idx, autoScroll = false) {
  if (idx == null || idx < 0) return;
  clearLink();
  if (idx !== lastLinkedBlock) {
    clearWordLink();
    lastLinkedBlock = idx;
  }
  // A table block can be dozens of braille rows (or span several pages); painting the
  // whole-block 'brl-linked'/'print-linked' tint over all of it reads as "the whole table
  // lit up" for one cell click. A table's own click handling always also paints the exact
  // cell/entry (cell-hl / table-cell-hl below), so the block-wide wash is skipped here and
  // that per-cell highlight is left to do the (correct, narrower) job on its own.
  const isTableBlock = lastModel?.blocks?.[idx]?.type === 'table';
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.setLinkedBlock(isTableBlock ? null : idx);
    if (autoScroll) {
      brailleEl._virtualBraille.scrollToBlock(idx, 0);
    }
  } else {
    const brailleRows = Array.from(brailleEl.querySelectorAll(`.brl-row[data-block="${idx}"]`));
    if (!isTableBlock) {
      brailleRows.forEach((r) => {
        expandRowCells(r);
        r.classList.add('brl-linked');
      });
    }
    if (autoScroll) {
      const firstRow = brailleRows[0];
      if (firstRow && !isElementVisibleIn(firstRow, brailleEl)) {
        firstRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
  const pe = editorEl.querySelector(`[data-block-idx="${idx}"]`);
  if (pe) {
    if (!isTableBlock) pe.classList.add('print-linked');
    if (autoScroll && !isElementVisibleIn(pe, editorEl)) {
      pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Synchronize tactile displays (Monarch / DotPad)
  let lineIdx = -1;
  if (lastTrace?.rows) lineIdx = lastTrace.rows.indexOf(idx);
  if (lineIdx < 0 && brailleEl._virtualBraille?.isVirtualized()) {
    const it = brailleEl._virtualBraille.getItems().find(item => item.block === idx);
    if (it && typeof it.rowIndex === 'number') lineIdx = it.rowIndex;
  }
  if (lineIdx >= 0 && typeof tactileDisplay !== 'undefined') {
    tactileDisplay.scrollToLine(lineIdx);
    if (currentBrailleTab === 'monarch' && typeof drawMonarchEmulator === 'function') {
      drawMonarchEmulator(tactileDisplay.getMonarchActiveFrame());
    } else if (currentBrailleTab === 'dotpad' && typeof drawDotPadEmulator === 'function') {
      drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
    }
  }
}
function linkCursor() {
  let idx = null;
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      const top = sel.anchor.getNode().getTopLevelElement();
      if (top) { const i = lastKeys.indexOf(top.getKey()); if (i >= 0) idx = i; }
    }
  });
  if (idx != null && idx >= 0) {
    linkByBlock(idx, false);
  }
}

// ---- synchronized scrolling: keep the two panes showing the same block ----
let syncSrc = null, syncTs = 0;
let scrollRaf = null;
let programmaticScrollUntil = 0;

function isModalOpen() {
  return !!document.querySelector('dialog[open]');
}

export function cancelScrollSync() {
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }
  syncSrc = null;
}

function editorTopBlock() {
  if (isModalOpen()) return null;
  const sTop = editorEl.scrollTop;
  const children = editorEl.children;
  const len = children.length;
  if (!len) return null;

  const edTop = editorEl.offsetTop;
  const targetY = sTop + edTop;

  // Fast O(log N) binary search across children (only ~12 iterations for 5000 elements)
  let low = 0, high = len - 1, foundIdx = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (children[mid].offsetTop <= targetY + 20) {
      foundIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const best = children[foundIdx] || children[0];
  const blockH = Math.max(1, best.offsetHeight || 20);
  const scrolledInsideBlock = Math.max(0, Math.min(blockH, targetY - best.offsetTop));
  const fraction = scrolledInsideBlock / blockH;
  const idx = Number(best.getAttribute('data-block-idx') ?? best.dataset?.blockIdx ?? foundIdx);
  return Number.isNaN(idx) ? { idx: foundIdx, fraction: 0 } : { idx, fraction };
}

function brailleTopBlock() {
  if (isModalOpen()) return null;
  if (brailleEl._virtualBraille?.isVirtualized()) {
    const sTop = brailleEl.scrollTop;
    const items = brailleEl._virtualBraille.getItems();
    let low = 0, high = items.length - 1, foundIdx = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (items[mid].top <= sTop + 20) {
        foundIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const it = items[foundIdx] || items[0];
    if (it.block == null) return null;
    const blockIdx = it.block;
    const blockTop = brailleEl._virtualBraille.getBlockOffset(blockIdx) ?? it.top;
    const blockH = brailleEl._virtualBraille.getBlockHeight(blockIdx) || 20;
    const fraction = Math.max(0, Math.min(1, (sTop - blockTop) / blockH));
    return { idx: blockIdx, fraction };
  }
  const cTop = brailleEl.getBoundingClientRect().top;
  const rows = Array.from(brailleEl.querySelectorAll('.brl-row[data-block]'));
  if (!rows.length) return null;
  let best = null, bestScore = Infinity;
  rows.forEach((el) => {
    const d = el.getBoundingClientRect().top - cTop;
    const score = d >= -1 ? d : 1e6 - d;
    if (score < bestScore) { bestScore = score; best = el; }
  });
  if (!best) return null;
  const idx = Number(best.getAttribute('data-block'));
  if (Number.isNaN(idx)) return null;
  const blockRows = rows.filter(r => Number(r.getAttribute('data-block')) === idx);
  const firstRow = blockRows[0];
  const lastRow = blockRows[blockRows.length - 1];
  const totalH = Math.max(1, (lastRow.offsetTop + lastRow.offsetHeight) - firstRow.offsetTop);
  const fraction = Math.max(0, Math.min(1, (brailleEl.scrollTop - firstRow.offsetTop) / totalH));
  return { idx, fraction };
}

function syncBrailleToEditor() {
  if (isModalOpen()) return;
  const anchor = editorTopBlock();
  if (!anchor) return;
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.scrollToBlock(anchor.idx, anchor.fraction);
  } else {
    const rows = Array.from(brailleEl.querySelectorAll(`.brl-row[data-block="${anchor.idx}"]`));
    if (!rows.length) return;
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const totalBrailleH = (lastRow.offsetTop + lastRow.offsetHeight) - firstRow.offsetTop;
    const targetScroll = firstRow.offsetTop + (anchor.fraction * totalBrailleH);
    if (Math.abs(brailleEl.scrollTop - targetScroll) >= 1) {
      brailleEl.scrollTop = targetScroll;
    }
  }
  if ((currentBrailleTab === 'dotpad' || currentBrailleTab === 'monarch') && typeof tactileDisplay !== 'undefined') {
    let lineIdx = -1;
    if (lastTrace?.rows) lineIdx = lastTrace.rows.indexOf(anchor.idx);
    if (lineIdx < 0 && brailleEl._virtualBraille?.isVirtualized()) {
      const it = brailleEl._virtualBraille.getItems().find(item => item.block === anchor.idx);
      if (it && typeof it.rowIndex === 'number') lineIdx = it.rowIndex;
    }
    if (lineIdx >= 0) {
      tactileDisplay.scrollToLine(lineIdx);
      if (currentBrailleTab === 'monarch' && typeof drawMonarchEmulator === 'function') {
        drawMonarchEmulator(tactileDisplay.getMonarchActiveFrame());
      } else if (currentBrailleTab === 'dotpad' && typeof drawDotPadEmulator === 'function') {
        drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
      }
    }
  }
}

function syncEditorToBraille() {
  if (isModalOpen()) return;
  const anchor = brailleTopBlock();
  if (!anchor) return;
  const el = editorEl.children[anchor.idx] || editorEl.querySelector(`[data-block-idx="${anchor.idx}"]`);
  if (!el) return;
  const edTop = editorEl.offsetTop;
  const blockH = el.offsetHeight || 20;
  const targetTop = (el.offsetTop - edTop) + (anchor.fraction * blockH);
  if (Math.abs(editorEl.scrollTop - targetTop) >= 2) {
    editorEl.scrollTop = Math.max(0, targetTop);
  }
}

let userIsInteracting = false;
let userInteractTimer = null;
function recordUserInteraction() {
  userIsInteracting = true;
  if (userInteractTimer) clearTimeout(userInteractTimer);
  userInteractTimer = setTimeout(() => { userIsInteracting = false; }, 600);
}
editorEl.addEventListener('wheel', recordUserInteraction, { passive: true });
editorEl.addEventListener('pointerdown', recordUserInteraction, { passive: true });
editorEl.addEventListener('touchstart', recordUserInteraction, { passive: true });
brailleEl.addEventListener('wheel', recordUserInteraction, { passive: true });
brailleEl.addEventListener('pointerdown', recordUserInteraction, { passive: true });
brailleEl.addEventListener('touchstart', recordUserInteraction, { passive: true });

function onPaneScroll(from, fn) {
  if (isModalOpen() || (reader && reader.speaking)) return;
  const t = performance.now();
  if (t < programmaticScrollUntil) return;
  if (!userIsInteracting) return;
  if (syncSrc && syncSrc !== from && t - syncTs < 150) return;
  syncSrc = from; syncTs = t;
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    if (!isModalOpen() && (!reader || !reader.speaking) && performance.now() >= programmaticScrollUntil && userIsInteracting) fn();
  });
}
editorEl.addEventListener('scroll', () => onPaneScroll('editor', syncBrailleToEditor), { passive: true });
brailleEl.addEventListener('scroll', () => onPaneScroll('braille', syncEditorToBraille), { passive: true });

// ---- audio feedback (self-voicing oscillator chime) ----
let dingCtx = null;
function ding() {
  try {
    dingCtx = dingCtx || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (dingCtx.state === 'suspended') dingCtx.resume();
    const t = dingCtx.currentTime;
    const gain = dingCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.04, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
    gain.connect(dingCtx.destination);
    const osc = dingCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1174, t + 0.08);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.22);
  } catch { /* audio is optional */ }
}

// ---- word / cell-level linking (down to the cell) ----
const HL_API = !!(globalThis.Highlight && globalThis.CSS && CSS.highlights);
// F9 item D1 (APH feedback, 9 Oct 2026): in Safari the Settings dialog's title was painted with the word-link highlight (yellow) and the
// words-to-check underline, though both Highlight ranges are over the document's text. WebKit paints a CSS Custom Highlight into the
// top-layer dialog opened over it (shown with the dialog's text whether or not its text was translated). So no document highlight is
// registered while a modal dialog is open: a dialog's opening sets them aside, anything set meanwhile (a word-check pass that finishes,
// a read-aloud word) waits, and when the last dialog closes they go back. Highlights thus only ever cover document text.
const hlHeld = new Map();
let hlDialogs = 0;
const HL_NAMES = ['link-word', 'proof-warn-word', 'tts-word'];
// Feedback 17 Oct 2026, item 10 (Safari: stale highlights lingering as the arrow keys move through the text): WebKit has repainted the text a
// Highlight covered only when that Highlight object itself changed, not when it was dropped from the registry or replaced under its name — and a
// highlight Range kept over text that has since been re-rendered goes on being painted. So the Highlight being dropped or replaced is emptied first
// (its ranges released, and its text repainted), then removed. Harmless in Chrome. (The held-over objects of the dialog guard below are moved, not dropped.)
function releaseHl(old) { try { if (old && typeof old.clear === 'function') old.clear(); } catch { /* already empty */ } }
function setHl(name, h) {
  if (!HL_API) return;
  if (hlDialogs > 0) { hlHeld.set(name, h); return; }
  const old = CSS.highlights.get(name);
  if (old && old !== h) releaseHl(old);
  CSS.highlights.set(name, h);
}
function delHl(name) {
  hlHeld.delete(name);
  if (!HL_API) return;
  releaseHl(CSS.highlights.get(name));
  CSS.highlights.delete(name);
}
window.__highlightsHeld = () => ({ dialogs: hlDialogs, held: [...hlHeld.keys()], shown: HL_API ? [...CSS.highlights.keys()] : [] });   // tests
if (HL_API && typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.__hlGuard) {
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function guardedShowModal(...args) {
    const wasOpen = this.open;
    if (!wasOpen) {
      hlDialogs++;
      for (const n of HL_NAMES) { const h = CSS.highlights.get(n); if (h) { hlHeld.set(n, h); CSS.highlights.delete(n); } }
      this.addEventListener('close', () => {
        hlDialogs = Math.max(0, hlDialogs - 1);
        if (hlDialogs === 0) { for (const [n, h] of hlHeld) CSS.highlights.set(n, h); hlHeld.clear(); }
      }, { once: true });
    }
    try { return showModal.apply(this, args); } catch (e) { if (!wasOpen) { hlDialogs = Math.max(0, hlDialogs - 1); } throw e; }
  };
  HTMLDialogElement.prototype.__hlGuard = true;
}
let cellText = {};                                 // `${blockIdx}:${unit}` → flat source text
let lastRuleSpoken = '';                            // plain-English rule info for the screen reader
function flatSegText(segments) {
  return (segments || []).map((s) => (s && s.type === 'math') ? (s.latex ? `$${s.latex}$` : '⟨equation⟩') : ((s && s.text) || '').replace(/\s+/g, ' ')).join('');
}
function buildCellText(model) {
  cellText = {};
  window.cellText = cellText;
  clearWordLink();                                 // stale Range/highlights point at the pre-render DOM
  (model.blocks || []).forEach((b, i) => {
    if (!b) return;
    if (b.type === 'list') {
      (b.items || []).forEach((it, u) => { cellText[`${i}:${u}`] = it.segments ? flatSegText(it.segments) : (it.text || ''); });
    } else if (b.type === 'table') {
      const rawHeaders = Array.isArray(b.headers) ? b.headers : [];
      const rawRows = (Array.isArray(b.rows) ? b.rows : []).map((r) => (Array.isArray(r) ? r : (r == null ? [] : [r])));
      const colCount = Math.max(rawHeaders.length, ...rawRows.map((r) => r.length));
      const headerCount = rawHeaders.length;
      for (let ci = 0; ci < headerCount; ci++) {
        cellText[`${i}:${ci}`] = flatSegText(cellSegments(rawHeaders[ci]));
      }
      rawRows.forEach((r, ri) => {
        for (let ci = 0; ci < colCount; ci++) {
          const unit = headerCount + ri * colCount + ci;
          cellText[`${i}:${unit}`] = flatSegText(cellSegments(r && r[ci]));
        }
      });
      if (headerCount === 0 && rawRows.length === 0 && (b.title || b.caption)) {
        cellText[`${i}:0`] = String(b.title || b.caption);
      }
    } else if (b.type === 'tnpage') {
      let u = 0;   // same order as the formatter's tnpageParas: each entry, then its further paragraphs
      const add = (o) => { const tx = o.segments ? flatSegText(o.segments) : (o.text || ''); if (String(tx).trim()) cellText[`${i}:${u++}`] = tx; };
      for (const e of (Array.isArray(b.entries) ? b.entries : [])) { if (!e) continue; add(e); (Array.isArray(e.paragraphs) ? e.paragraphs : []).forEach((pp) => pp && add(pp)); }
    } else if (b.type === 'sympage') {
      (Array.isArray(b._shown) ? b._shown : []).forEach((tx, u) => { if (String(tx).trim()) cellText[`${i}:${u}`] = tx; });
    } else if (b.type === 'box' || b.type === 'sidebar') {
      if (Array.isArray(b.blocks) && b.blocks.length) {
        b.blocks.forEach((cb, u) => {
          if (cb.type === 'list' && Array.isArray(cb.items)) {
            cb.items.forEach((it, liIdx) => {
              const itemUnit = u * 1000 + liIdx;
              cellText[`${i}:${itemUnit}`] = it.segments ? flatSegText(it.segments) : (it.text || '');
            });
            cellText[`${i}:${u}`] = cb.items.map(it => (it.segments ? flatSegText(it.segments) : (it.text || ''))).join(' ');
          } else {
            cellText[`${i}:${u}`] = cb.segments ? flatSegText(cb.segments) : (cb.text || '');
          }
        });
      } else {
        cellText[`${i}:0`] = b.segments ? flatSegText(b.segments) : (b.text || b.title || '');
      }
    } else {
      cellText[`${i}:0`] = b.segments ? flatSegText(b.segments) : (b.text || '');
    }
  });
  updatePrintToc();
}
// The print element for a (block, unit): the block, its unit-th <li> for a list, or its unit-th cell for a table.
function printUnitEl(block, unit) {
  const be = editorEl.querySelector(`[data-block-idx="${block}"]`);
  if (!be) return null;
  const lis = be.querySelectorAll('li');
  if (be.tagName !== 'ASIDE' && !be.classList.contains('emboss-sidebar-card') && lis.length) return lis[unit] || be;
  const tableInputs = be.querySelectorAll('.table-cell-input');
  // (F9 item K) not for a box: its units are its own paragraphs and lists; a table inside it has no units of its own, and its cells
  // (0, 1, 2...) were taken for the box's units, so a click in the box's heading lit the table's first cell's word.
  const isBox = be.tagName === 'ASIDE' || be.classList.contains('emboss-sidebar-card');
  if (tableInputs.length && !isBox) return tableInputs[unit] || be;
  if (isBox) {
    if (unit >= 1000) {
      const childIdx = Math.floor(unit / 1000);
      const liIdx = unit % 1000;
      const childEl = be.children[childIdx];
      if (childEl) {
        const nestedLis = childEl.querySelectorAll('li');
        if (nestedLis[liIdx]) return nestedLis[liIdx];
      }
    }
    const b = lastModel?.blocks?.[block];
    if (b && Array.isArray(b.blocks) && b.blocks[unit]) {
      const cb = b.blocks[unit];
      if (cb && cb._key) {
        const childEl = editor.getElementByKey(cb._key);
        if (childEl) return childEl;
      }
    }
    const unitEl = be.querySelector(`[data-unit-idx="${unit}"]`);
    if (unitEl) return unitEl;
    if (be.children.length) return be.children[unit] || be;
  }
  return be;
}
function resolveBlockUnit(target) {
  if (!target) return null;
  const rawStart = target.nodeType === 1 ? target : target.parentElement;
  const start = rawStart ? (rawStart.nodeType === 1 ? rawStart : rawStart.parentElement) : null;
  if (!start) return null;
  const be = start.closest('[data-block-idx]') || start.closest('#editor > *');
  if (!be) return null;
  const block = be.dataset?.blockIdx != null ? Number(be.dataset.blockIdx) : Array.from(editorEl.children).indexOf(be);
  if (Number.isNaN(block) || block < 0) return null;

  const li = start.closest('li');
  let unit = 0, unitEl = be;
  if (li && be.contains(li)) {
    if (be.tagName === 'ASIDE' || be.classList.contains('emboss-sidebar-card')) {
      const child = li.closest('.emboss-sidebar-card > *') || (li.parentElement?.closest('.emboss-sidebar-card > *'));
      const childIdx = child ? Math.max(0, [...be.children].indexOf(child)) : 0;
      const listEl = li.closest('ul, ol') || child;
      const liIdx = listEl ? Math.max(0, [...listEl.querySelectorAll('li')].indexOf(li)) : 0;
      unit = childIdx * 1000 + liIdx;
      unitEl = li;
    } else {
      unit = Math.max(0, [...be.querySelectorAll('li')].indexOf(li));
      unitEl = li;
    }
  } else if (be.tagName === 'ASIDE' || be.classList.contains('emboss-sidebar-card')) {
    const child = start.closest('.emboss-sidebar-card > *') || (start.parentElement === be ? start : null);
    if (child && be.contains(child)) {
      if (child.dataset.unitIdx != null) {
        unit = Number(child.dataset.unitIdx);
      } else {
        const b = lastModel?.blocks?.[block];
        if (b && Array.isArray(b.blocks) && b.blocks.length > 0) {
          const matchIdx = b.blocks.findIndex(cb => cb && cb._key && editor.getElementByKey(cb._key) === child);
          unit = matchIdx >= 0 ? matchIdx : Math.max(0, [...be.children].indexOf(child));
        } else {
          unit = Math.max(0, [...be.children].indexOf(child));
        }
      }
      unitEl = child;
    }
  }
  return { block, unit, unitEl, be };
}
// The caret's offset into `cellEl`'s flat text (matching flatSegText's own $latex$
// wrapping for maths), or 0 when the selection is not inside the cell — e.g. right after
// a click that also moved focus elsewhere, or during a programmatic .focus() before the
// browser has placed a caret.
function tableCellCaretOffset(cellEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!cellEl.contains(range.startContainer)) return 0;
  return domOffsetOfNode(cellEl, range.startContainer, range.startOffset);
}
// Set around a programmatic pe.focus() (highlightWord's braille -> print table-cell path)
// so the div's own 'focus' listener below does not re-enter handleTableCellEvent: at that
// point the browser has not placed a caret yet (no click happened), so it would read
// caretPos 0 and recompute a different word range, clobbering the correct highlight that
// was just painted for the entry actually clicked in the braille pane.
let suppressTableCellFocusSync = false;
function handleTableCellEvent(input, unit) {
  if (!input || suppressTableCellFocusSync) return;
  const be = input.closest('[data-block-idx]');
  if (!be) return;
  const block = Number(be.dataset.blockIdx);
  if (Number.isNaN(block)) return;

  refreshToolbar();
  // Read straight from the cell's live DOM (not the model/cellText, which only catches up
  // after the next debounced render) so the cell trace tracks every keystroke.
  const text = flatSegText(cellHtmlToSegments(input.innerHTML));
  const caretPos = tableCellCaretOffset(input);
  if (!text.trim()) {
    clearWordLink();
    linkByBlock(block, false);
    input.classList.add('table-cell-hl');
    lastCaretWordKey = `${block}:${unit}:empty`;
    return;
  }
  const [s, en] = wordRangeAt(text, caretPos);
  const wordKey = `${block}:${unit}:${s}:${en}:${caretPos}`;
  if (wordKey === lastCaretWordKey && input.classList.contains('table-cell-hl')) return;
  lastCaretWordKey = wordKey;
  highlightWord(block, unit, s, en, caretPos, 'editor');
  input.classList.add('table-cell-hl');
  showRuleInfo(text.slice(s, en));
}
function wordRangeAt(text, pos) {                   // [start,end) of the whitespace-delimited word at pos
  pos = Math.max(0, Math.min(pos, text.length - 1));
  
  // Check if pos is strictly inside a $...$ math segment
  const dollarIndices = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$') dollarIndices.push(i);
  }
  for (let k = 0; k < dollarIndices.length - 1; k += 2) {
    const start = dollarIndices[k];
    const end = dollarIndices[k + 1];
    if (pos >= start && pos <= end) {
      return [start, end + 1];
    }
  }

  if (/\s/.test(text[pos] || '')) {
    let e = pos;
    while (e < text.length && /\s/.test(text[e])) e++;
    pos = Math.min(e, text.length - 1);
  }
  let s = pos, e = pos + 1;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return [s, e];
}

// F9 item K (APH feedback, 9 Oct 2026: "the highlight is a few letters out on some paragraphs of the large NIMAS book"): the model's flat text
// for a unit (cellText: what the braille's cell positions count) and the text the print pane shows are not always the same string:
//  - a literal bullet the print text starts with ("• ") is hidden in the editor's list (a ListItemNode's bullet prefix) but counted in the model;
//  - the model joins what the print shows on separate lines (a <br>, a box's paragraphs) with a space the DOM has no character for.
// Offsets were used as if the two were one string, so a highlight (and a click) was out by the width of every such difference before it
// (472 list items and 105 boxes in "Collections, Grade 7"). alignPrint pairs the two texts character by character, so that print offsets
// and model offsets convert both ways. Nothing is changed when the strings agree.
function printTextOf(el) {
  let out = '';
  (function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList?.contains('math-embed') || node.tagName === 'MATH-FIELD' || node.classList?.contains('cell-math-chip')) {
      const mf = node.querySelector?.('math-field') || (node.tagName === 'MATH-FIELD' ? node : null);
      const latex = node.getAttribute?.('data-latex') || mf?.getAttribute?.('data-latex') || mf?.value || '';
      out += (latex ? `$${latex}$` : '⟨equation⟩');
      return;
    }
    for (const child of node.childNodes) walk(child);
  })(el);
  return out;
}
const printAlignCache = new WeakMap();
// -> null (the two texts agree: offsets are the same), or { m2d, d2m, D }: m2d[i] the print index of model char i (-1: not shown in print),
// d2m[j] the model index of print char j (and d2m[D.length] the model end).
function alignPrint(el, modelText) {
  if (!el || modelText == null) return null;
  const M = String(modelText), D = printTextOf(el);
  if (D === M) return null;
  const cached = printAlignCache.get(el);
  if (cached && cached.M === M && cached.D === D) return cached.al;
  const ws = (ch) => /\s/.test(ch);
  const m2d = new Int32Array(M.length).fill(-1), d2m = new Int32Array(D.length + 1).fill(-1);
  let j = 0, hidden = 0, solid = 0;
  for (let i = 0; i < M.length; i++) {
    const mc = M[i];
    if (ws(mc)) {                                  // a space of the model: the print's own space, or nothing there (a line break)
      if (j < D.length && ws(D[j])) { m2d[i] = j; d2m[j] = i; j++; }
      continue;
    }
    solid++;
    while (j < D.length && ws(D[j])) { d2m[j] = i; j++; }   // spaces the model does not have: they belong to the next character
    if (j < D.length && D[j] === mc) { m2d[i] = j; d2m[j] = i; j++; continue; }
    let n = i + 1; while (n < M.length && ws(M[n])) n++;   // the next character of the model that is not a space
    if (j >= D.length || (n < M.length && M[n] === D[j])) { hidden++; continue; }   // the model's character, absent from print (a bullet)
    m2d[i] = j; d2m[j] = i; j++;                   // a different character in the same place (a quote mark, a ligature)
  }
  let last = M.length;
  for (let k = D.length; k >= 0; k--) { if (d2m[k] >= 0) last = d2m[k]; else d2m[k] = last; }
  d2m[D.length] = Math.max(d2m[D.length], 0);
  const al = hidden > Math.max(2, solid / 2) ? null : { m2d, d2m, D };   // not the same text at all: the old, direct offsets
  printAlignCache.set(el, { M, D, al });
  return al;
}
const domToModel = (el, domOffset, modelText) => { const al = alignPrint(el, modelText); return al ? al.d2m[Math.max(0, Math.min(domOffset, al.D.length))] : domOffset; };
function charRangeInEl(el, s, e, modelText = null) {   // a DOM Range over chars [s,e) of the element's text (of the model's flat text, with modelText)
  if (!el || s >= e) return null;
  const al = alignPrint(el, modelText);
  if (al) {                                         // model offsets -> print offsets
    let ds = -1, de = -1;
    for (let k = Math.max(0, s); k < Math.min(e, al.m2d.length); k++) { const d = al.m2d[k]; if (d >= 0) { if (ds < 0) ds = d; de = d + 1; } }
    if (ds < 0) return null;
    s = ds; e = de;
  }
  let acc = 0, range = null;
  let lastTextNode = null;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      lastTextNode = node;
      const L = node.nodeValue.length;
      if (!range && s < acc + L) {
        range = document.createRange();
        range.setStart(node, Math.max(0, s - acc));
      }
      if (range && e <= acc + L) {
        range.setEnd(node, Math.min(L, e - acc));
        return true;
      }
      acc += L;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // A table cell's atomic maths chip (G15) counts as `$latex$`, matching flatSegText.
      if (node.classList?.contains('math-embed') || node.tagName === 'MATH-FIELD' || node.classList?.contains('cell-math-chip')) {
        const mf = node.querySelector?.('math-field') || (node.tagName === 'MATH-FIELD' ? node : null);
        const latex = node.getAttribute?.('data-latex') || mf?.getAttribute?.('data-latex') || mf?.value || '';
        const mathLen = (latex ? `$${latex}$` : '⟨equation⟩').length;
        acc += mathLen;
      } else {
        for (const child of node.childNodes) {
          if (walk(child)) return true;
        }
      }
    }
    return false;
  }
  const done = walk(el);
  if (range && !done && lastTextNode) {
    try {
      if (range.collapsed || e > acc) {
        range.setEnd(lastTextNode, lastTextNode.nodeValue.length);
      }
    } catch {}
  }
  return range;
}
const SVGNS = 'http://www.w3.org/2000/svg';
// Settings > User Interface > "Show the explanation bar" (off hides the bar and its drag handle: body.no-explanation-bar, index.html). Speech goes out through the live region, not the bar.
function applyExplanationBarVisibility() { document.body.classList.toggle('no-explanation-bar', settings.showExplanationBar === false); }
applyExplanationBarVisibility();
// While the user is typing (ordinary keys or six-key braille) the explanation bar keeps showing the last explanation and only moves on to the
// word under the caret after a pause of about 700 ms (feedback 17 Oct 2026, item 14b: it flickered through every word as each key was pressed, and
// blanked to its hint each time the braille was redrawn). It never goes blank in between. A key that only MOVES the caret, or a click, shows the
// new word at once. Announcements through the live region wait for the pause too (they are made by the same call).
const TYPING_PAUSE_MS = 700;
function typingHold() { return typingAt > 0 && performance.now() - typingAt < TYPING_PAUSE_MS; }
function scheduleRuleFlush() {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingTimer = null;
    if (typingHold()) { scheduleRuleFlush(); return; }
    const p = pendingRuleWord; pendingRuleWord = null;
    if (p) showRuleInfoNow(p.word);
  }, Math.max(20, TYPING_PAUSE_MS - (performance.now() - typingAt)) + 10);
}
function noteTyping() { typingAt = performance.now(); }
function noteNavigation() { typingAt = 0; if (pendingRuleWord) { clearTimeout(typingTimer); typingTimer = null; pendingRuleWord = null; } }
window.__typingHold = typingHold;   // tests
const TYPING_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
editorEl.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (TYPING_NAV_KEYS.has(e.key)) { noteNavigation(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key === 'Spacebar') noteTyping();
}, true);   // capture, and before the six-key handler (it stops the key), which also calls noteTyping itself
editorEl.addEventListener('beforeinput', (e) => { if (/^(insert|delete)/.test(e.inputType || '')) noteTyping(); }, true);
document.addEventListener('pointerdown', () => noteNavigation(), true);
function showIdleStatus() {
  // While typing the bar keeps its last explanation; the idle hint waits for the pause too (unless a word's explanation is already waiting).
  if (typingHold()) { if (!pendingRuleWord) pendingRuleWord = { word: '' }; scheduleRuleFlush(); return; }
  const body = $id('ruleInfoBody');
  if (body) {
    body.innerHTML = `<span class="sb-hint">${escapeHtml(t('app.status.rule_hint'))}</span>`;
  } else {
    const sb = $id('statusBar') || $id('ruleInfo');
    if (sb) {
      sb.innerHTML = `<span class="sb-hint">${escapeHtml(t('app.status.rule_hint'))}</span>` +
        (currentStatusText ? `<span class="doc-stats" id="docStats">${escapeHtml(currentStatusText)}</span>` : `<span class="doc-stats" id="docStats"></span>`);
    }
  }
  updateDocStatsVisibility();
}

let activeCaretLine = -1;
let activeCaretCol = -1;
let activeWordHighlight = null;

function clearWordLink() {
  activeWordHighlight = null;
  window.activeWordHighlight = null;
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.clearWordHighlight();
  }
  brailleEl.querySelectorAll('.bcell.cell-hl').forEach((c) => c.classList.remove('cell-hl'));
  brailleEl.querySelectorAll('rect.cell-box').forEach((r) => r.remove());
  editorEl.querySelectorAll('.math-hl').forEach((m) => m.classList.remove('math-hl'));
  // A table cell is a contenteditable <div class="table-cell-input">, not an <input> (G15
  // moved it off the old <input> element) — 'input.table-cell-hl' never matched anything, so
  // a cell's highlight was never cleared and stale marks piled up across clicks.
  editorEl.querySelectorAll('.table-cell-input.table-cell-hl').forEach((inp) => inp.classList.remove('table-cell-hl'));
  if (HL_API) delHl('link-word');
  showIdleStatus();                               // (held while the user types: item 14b)
  activeCaretLine = -1;
  activeCaretCol = -1;
  if (currentBrailleTab === 'monarch' && typeof drawMonarchEmulator === 'function') {
    drawMonarchEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getMonarchActiveFrame() : null);
  } else if (currentBrailleTab === 'dotpad' && typeof drawDotPadEmulator === 'function') {
    drawDotPadEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getDotPadActiveFrame() : null);
  }
}
function highlightWord(block, unit, s, e, caretOffset = null, source = 'external') {
  clearWordLink();
  userIsInteracting = false;
  if (userInteractTimer) clearTimeout(userInteractTimer);
  programmaticScrollUntil = performance.now() + 1000;
  cancelScrollSync();
  activeWordHighlight = { block, unit, s, e };
  window.activeWordHighlight = activeWordHighlight;
  lastLinkedBlock = block;
  linkByBlock(block, false);
  const cw = brailleCellW, ch = brailleCellW * 1.5;
  const targetOffset = (typeof caretOffset === 'number') ? caretOffset : s;

  // Find exact document row index containing this word
  let wordRowIdx = -1;
  if (lastTrace?.rowCells && lastTrace?.rows) {
    for (let r = 0; r < lastTrace.rowCells.length; r++) {
      if (lastTrace.rows[r] === block) {
        const cells = lastTrace.rowCells[r];
        const cellList = Array.isArray(cells) ? cells : (Array.isArray(cells?.src) ? cells.src : null);
        if (cellList && cellList.some(c => c && Number(c.u) === unit && c.c >= s && c.c < e)) {
          wordRowIdx = r;
          break;
        }
      }
    }
  }
  if (wordRowIdx < 0 && lastTrace?.rows) {
    wordRowIdx = lastTrace.rows.indexOf(block);
  }

  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.setWordHighlight({ block, unit, s, e, cw, ch, rowIdx: wordRowIdx });
    if (wordRowIdx >= 0) {
      brailleEl._virtualBraille.scrollToRow(wordRowIdx);
    } else {
      brailleEl._virtualBraille.scrollToBlock(block, 0);
    }
  } else {
    const rows = Array.from(brailleEl.querySelectorAll(`.brl-row[data-block="${block}"]`));
    rows.forEach(expandRowCells);
    let highlightedRow = null;
    let matchingCaretCell = null;

    rows.forEach((r) => {
      const rIdx = Number(r.dataset.row);
      if (wordRowIdx >= 0 && !isNaN(rIdx) && rIdx !== wordRowIdx) return;
      r.querySelectorAll('.bcell[data-char]').forEach((c) => {
        if (Number(c.dataset.unit) !== unit) return;
        const n = +c.dataset.char; if (n < s || n >= e) return;
        c.classList.add('cell-hl');
        if (!highlightedRow) highlightedRow = r;
        if (n <= targetOffset) {
          if (!matchingCaretCell || n > +matchingCaretCell.dataset.char) {
            matchingCaretCell = c;
          }
        }
        if (c.tagName.toLowerCase() === 'g') {
          const ci = +c.dataset.col;
          const rect = document.createElementNS(SVGNS, 'rect');
          rect.setAttribute('class', 'cell-box');
          rect.setAttribute('x', (ci * cw + 0.5).toFixed(1)); rect.setAttribute('y', '0.5');
          rect.setAttribute('width', (cw - 1).toFixed(1)); rect.setAttribute('height', (ch - 1).toFixed(1)); rect.setAttribute('rx', '2.5');
          c.insertBefore(rect, c.firstChild);
        }
      });
    });

    const targetBraille = highlightedRow || (wordRowIdx >= 0 ? brailleEl.querySelector(`.brl-row[data-row="${wordRowIdx}"]`) : null) || rows[0] || null;
    if (targetBraille && !isElementVisibleIn(targetBraille, brailleEl, 40)) {
      scrollWithin(brailleEl, targetBraille, { block: 'center' });
    }
  }

  if (wordRowIdx >= 0) {
    activeCaretLine = wordRowIdx;
    if (typeof tactileDisplay !== 'undefined') {
      tactileDisplay.scrollToLine(wordRowIdx);
    }
  }

  // Calculate active caret column
  if (wordRowIdx >= 0 && lastTrace?.rowCells?.[wordRowIdx]) {
    const rCells = lastTrace.rowCells[wordRowIdx];
    let col = -1;
    for (let ci = 0; ci < rCells.length; ci++) {
      const src = rCells[ci];
      if (src && Number(src.u) === unit && src.c >= s && src.c < e) {
        if (src.c <= targetOffset || col === -1) col = ci;
      }
    }
    activeCaretCol = col >= 0 ? col : -1;
  } else {
    activeCaretCol = -1;
  }
  updateCaretLocation(block, wordRowIdx, activeCaretCol);

  if (currentBrailleTab === 'monarch' && typeof drawMonarchEmulator === 'function') {
    drawMonarchEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getMonarchActiveFrame() : null);
  } else if (currentBrailleTab === 'dotpad' && typeof drawDotPadEmulator === 'function') {
    drawDotPadEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getDotPadActiveFrame() : null);
  }

  const pe = printUnitEl(block, unit) || editorEl.querySelector(`[data-block-idx="${block}"]`);
  if (pe) {
    if (isTableCellEl(pe)) {
      pe.classList.add('table-cell-hl');
      if (source === 'braille') {
        // A contenteditable cell has no .setSelectionRange; place a real DOM Range/
        // Selection instead (charRangeInEl already treats a maths chip as one unit).
        try {
          suppressTableCellFocusSync = true;
          pe.focus();
          const r = charRangeInEl(pe, s, e, cellText[`${block}:${unit}`]);
          if (r) {
            const domSel = window.getSelection();
            domSel.removeAllRanges();
            domSel.addRange(r);
          }
        } catch {} finally {
          suppressTableCellFocusSync = false;
        }
      }
      if (!isElementVisibleIn(pe, editorEl, 40)) {
        scrollWithin(editorEl, pe, { block: 'center' });
      }
    } else {
      let wordRange = null;
      try {
        wordRange = charRangeInEl(pe, s, e, cellText[`${block}:${unit}`]);
      } catch { wordRange = null; }

      if (wordRange && HL_API) {
        setHl('link-word', new Highlight(wordRange));
      }

      if (wordRange) {
        const rRect = wordRange.getBoundingClientRect();
        const cRect = editorEl.getBoundingClientRect();
        const isVisibleInEditor = (rRect.top >= cRect.top + 15) && (rRect.bottom <= cRect.bottom - 15);
        if (!isVisibleInEditor && rRect.height > 0) {
          const wordDocTop = editorEl.scrollTop + (rRect.top - cRect.top);
          const targetScrollTop = Math.max(0, wordDocTop - (editorEl.clientHeight / 2) + (rRect.height / 2));
          editorEl.scrollTop = targetScrollTop;
        }
      } else if (pe && !isElementVisibleIn(pe, editorEl, 40)) {
        scrollWithin(editorEl, pe, { block: 'center' });
      }
    }

    const b = lastModel?.blocks?.[block];
    let segs = b?.segments;
    if (b?.type === 'list') segs = b?.items?.[unit]?.segments;
    if (segs) {
      let curPos = 0;
      const mathEmbeds = Array.from(pe.querySelectorAll('.math-embed, math-field')).filter(m => m.classList.contains('math-embed') || !m.closest('.math-embed'));
      let mathIdx = 0;
      for (const seg of segs) {
        if (seg.type === 'math') {
          const mLen = (seg.latex ? `$${seg.latex}$` : '⟨equation⟩').length;
          const mStart = curPos;
          const mEnd = curPos + mLen;
          if (Math.max(s, mStart) < Math.min(e, mEnd)) {
            if (mathEmbeds[mathIdx]) {
              mathEmbeds[mathIdx].classList.add('math-hl');
              const mf = mathEmbeds[mathIdx].querySelector('math-field') || (mathEmbeds[mathIdx].tagName.toLowerCase() === 'math-field' ? mathEmbeds[mathIdx] : null);
              if (mf) mf.classList.add('math-hl');
            }
          }
          mathIdx++;
          curPos += mLen;
        } else {
          curPos += (seg.text || '').replace(/\s+/g, ' ').length;
        }
      }
    }
  }
}

const SEG_COLOURS = 7;

function alignWord(brl, text, table) {
  let res = null;
  const tbl = table || (louis.TABLES ? louis.TABLES.uebG2 : null);
  const tG1 = louis.TABLES ? louis.TABLES.uebG1 : null;
  for (const t of [tbl, tG1]) {
    if (!t) continue;
    try {
      const tr = makeTranslators(louis, t);
      const pos = (s2, tf) => (tr.translatePos ? tr.translatePos(s2, tf) : louis.translatePos(s2, t, tf));
      const r = styledTranslatePos(pos, settings.quoteStyle)(text);   // the same house style as the rendered braille it is matched against (A71)
      if (r && (r.braille === brl || !brl)) { res = r; break; }
    } catch { /* ignore */ }
  }
  
  if (res && res.inputPos && res.braille) {
    const pos = res.inputPos;
    const b = res.braille;
    const n = b.length;
    if (pos.length >= n && n > 0) {
      const segs = [];
      let j = 0;
      let ok = true;
      while (j < n) {
        const start = pos[j];
        let k = j;
        while (k + 1 < n && pos[k + 1] === start) k++;
        let nextStart = text.length;
        if (k + 1 < n) {
          nextStart = pos[k + 1];
        }
        if (nextStart < start) {
          ok = false;
          break;
        }
        segs.push({ cells: b.slice(j, k + 1), chars: text.slice(start, nextStart) });
        j = k + 1;
      }
      if (ok && segs.length > 0) return segs;
    }
  }

  // Fallback 1: Spelt-out 1-to-1 letter mapping
  const uni = brfToUnicodeBraille(brl || '');
  const cleanUni = [...uni.replace(/\s/g, '')];
  if (cleanUni.length === text.length && text.length > 0) {
    const segs = [];
    for (let i = 0; i < text.length; i++) {
      segs.push({ cells: brl[i] || '', chars: text[i] });
    }
    return segs;
  }

  // Fallback 2: Single chunk with full word and braille
  if (text.length > 0) {
    return [{ cells: brl || '', chars: text }];
  }

  return null;
}

// gg, character and ought were wrong (⠛ = the letter g, ⠐⠉, ⠐⠪); tests/common_contractions_table.test.mjs checks every entry against liblouis.
const COMMON_CONTRACTIONS = {
  '⠮': 'the', '⠯': 'and', '⠿': 'for', '⠷': 'of', '⠾': 'with',
  '⠡': 'ch', '⠩': 'sh', '⠹': 'th', '⠱': 'wh', '⠳': 'ou',
  '⠌': 'st', '⠜': 'ar', '⠫': 'ed', '⠻': 'er', '⠔': 'in', '⠢': 'en',
  '⠬': 'ing', '⠪': 'ow', '⠒': 'con', '⠲': 'dis', '⠂': 'ea', '⠆': 'bb',
  '⠖': 'ff', '⠶': 'gg', '⠐⠙': 'day', '⠐⠑': 'ever', '⠐⠋': 'father',
  '⠐⠓': 'here', '⠐⠅': 'know', '⠐⠇': 'lord', '⠐⠍': 'mother', '⠐⠝': 'name',
  '⠐⠕': 'one', '⠐⠏': 'part', '⠐⠟': 'question', '⠐⠗': 'right', '⠐⠎': 'some',
  '⠐⠞': 'time', '⠐⠥': 'under', '⠐⠺': 'work', '⠐⠽': 'young', '⠐⠡': 'character',
  '⠐⠹': 'through', '⠐⠱': 'where', '⠐⠳': 'ought', '⠰⠝': 'tion'
};

function getPartSpeech(p) {
  if (!p || !p.name) return '';
  const n = p.name;
  if (n.startsWith('grade-1') || n.startsWith('open Nemeth') || n.startsWith('close Nemeth') || n.startsWith('end of the grade-1') || n.startsWith('Greek letter sign')) {
    return '';
  }
  if (n.startsWith('letter ')) return n.slice(7);
  if (n.startsWith('letters ')) return n.slice(8);
  if (n.startsWith('Greek letter ')) return n.slice(13);
  if (n.startsWith('Greek capital ')) return n.slice(14);
  if (n.startsWith('capital ')) return n.slice(8);
  if (n === 'open fraction') return 'open fraction';
  if (n === 'fraction line' || n === 'fraction line (simple numeric fraction)') return 'over';
  if (n === 'close fraction') return 'close fraction';
  if (n === 'square-root sign') return 'square root of';
  if (n === 'end of square root') return 'end root';
  if (n === 'superscript (raise what follows)') return 'to the power';
  if (n === 'subscript (lower what follows)') return 'sub';
  if (n === 'open bracket') return 'open paren';
  if (n === 'close bracket') return 'close paren';
  if (n === 'open square bracket') return 'open bracket';
  if (n === 'close square bracket') return 'close bracket';
  if (n === 'open curly bracket') return 'open brace';
  if (n === 'close curly bracket') return 'close brace';
  if (n === 'open group') return 'open group';
  if (n === 'close group') return 'close group';
  if (n === 'times (dot product)') return 'dot';
  if (n === 'times') return 'times';
  if (n.startsWith('hbar')) return 'h-bar';
  if (n === 'partial derivative') return 'partial';
  if (n === 'hat accent') return 'hat';
  if (n === 'bar accent') return 'bar';
  if (n === 'vector arrow') return 'vector';
  if (n === 'decimal point') return 'point';
  if (/^[\d.,]+$/.test(n)) return n;
  return n;
}

// Show what braille rule/contraction produced a word: its grade-2 braille with colored
// aligned segment chips, rule badges, and comparison against uncontracted form.
function showRuleInfo(word) {
  if (typingHold()) { pendingRuleWord = { word }; scheduleRuleFlush(); return; }   // typing: the bar keeps its last explanation until a pause (item 14b)
  pendingRuleWord = null;
  showRuleInfoNow(word);
}
function showRuleInfoNow(word) {
  const body = $id('ruleInfoBody');
  const el = body || $id('statusBar') || $id('ruleInfo'); if (!el) return;
  const w = (word || '').trim();
  if (!w) { showIdleStatus(); return; }

  // Math indicator / equation handler
  if (w.startsWith('$') && w.endsWith('$')) {
    const mathContent = w.slice(1, -1);
    let brlMath = '';
    try { brlMath = maths.mathToBrf({ latex: mathContent }, effectiveMathCode(settings)); } catch { /* */ }
    const uniMath = brfToUnicodeBraille(brlMath);
    let spoken = '';
    try {
      const spk = mathSpeech(mathContent);
      spoken = spk && spk.spokenText ? spk.spokenText : '';
    } catch { /* */ }

    // Segment braille cells into mathematical signs and rules
    const isNemeth = effectiveMathCode(settings) === 'nemeth';   // the same decider the render used
    let parts = [];
    try {
      parts = isNemeth ? describeNemeth(uniMath) : describeUebMaths(uniMath);
    } catch { /* */ }

    let spokenSegments = [];
    if (parts && parts.length > 0) {
      parts.forEach((p, idx) => {
        const text = getPartSpeech(p);
        if (text) {
          const colorIdx = idx % SEG_COLOURS;
          spokenSegments.push(`<span class="ri-seg c${colorIdx}">${escapeHtml(text)}</span>`);
        }
      });
    }
    const desc = spokenSegments.length > 0
      ? `“${spokenSegments.join(' ')}” · `
      : (spoken ? `“${escapeHtml(spoken)}” · ` : '');

    let renderedMath = '';
    if (typeof globalThis.temml !== 'undefined') {
      try {
        const out = globalThis.temml.renderToString(mathContent, { displayMode: false });
        if (out && !out.includes('temml-error')) {
          renderedMath = out;
        }
      } catch { /* */ }
    }
    const mathHtml = renderedMath || `<span class="ri-word">${escapeHtml(w)}</span>`;

    let brlHtml = escapeHtml(uniMath);
    let rulesHtml = '';
    if (parts && parts.length > 0) {
      brlHtml = parts.map((p, i) => `<span class="ri-seg c${i % SEG_COLOURS}">${escapeHtml(p.cells)}</span>`).join('');
      rulesHtml = ' ' + parts.map((p, i) =>
        `<span class="ri-rule" aria-hidden="true"><span class="ri-seg c${i % SEG_COLOURS}" style="padding:0 4px;margin-right:2px"><span class="ri-brl" style="font-size:1.15em">${escapeHtml(p.cells)}</span></span> = &ldquo;${escapeHtml(p.name)}&rdquo;</span>`
      ).join(' ');
    }

    const mathOutput =
      `<span class="ri-brl" aria-hidden="true">${brlHtml}</span> ` +
      `<span class="ri-arrow" aria-hidden="true">→</span> ` +
      `<span class="ri-math" aria-hidden="true">${mathHtml}</span> ` +
      `<span class="ri-note" aria-hidden="true">${desc}Equation (${isNemeth ? 'Nemeth' : 'UEB Maths'}, ${[...uniMath].length} cells)</span>` +
      rulesHtml;
    if (body) {
      body.innerHTML = mathOutput;
    } else {
      el.innerHTML = mathOutput + (currentStatusText ? `<span class="doc-stats" id="docStats">${escapeHtml(currentStatusText)}</span>` : '');
    }
    updateDocStatsVisibility();
    return;
  }

  const table = activeTable;
  let g2Brf, g1Brf;
  try {
    g2Brf = makeTranslators(louis, table).translate(w);
    g1Brf = louis.translate(w, louis.TABLES.uebG1);
  } catch { showIdleStatus(); return; }

  const uniG2 = brfToUnicodeBraille(g2Brf);
  const uniG1 = brfToUnicodeBraille(g1Brf);
  const g2cells = [...uniG2.replace(/\s/g, '')].length;
  const g1cells = [...uniG1.replace(/\s/g, '')].length;
  const contracted = settings.grade !== 'g1' && g2cells < g1cells;

  const segs = alignWord(g2Brf, w, table);
  let brlHtml = escapeHtml(uniG2);
  let txtHtml = escapeHtml(w);
  let rules = [];

  if (segs) {
    brlHtml = segs.map((s, i) => `<span class="ri-seg c${i % SEG_COLOURS}">${escapeHtml(brfToUnicodeBraille(s.cells))}</span>`).join('');
    txtHtml = segs.map((s, i) => `<span class="ri-seg c${i % SEG_COLOURS}">${escapeHtml(s.chars)}</span>`).join('');
    rules = segs.filter((s) => s.chars.length > 1)
                .map((s) => ({ cell: brfToUnicodeBraille(s.cells), meaning: s.chars }));
  } else {
    for (const [cell, name] of Object.entries(COMMON_CONTRACTIONS)) {
      if (uniG2.includes(cell)) rules.push({ cell, meaning: name });
    }
  }

  const plural = (n) => `${n} cell${n === 1 ? '' : 's'}`;
  const chars = `${w.length} character${w.length === 1 ? '' : 's'}`;

  lastRuleSpoken = contracted
    ? `${w}: ${plural(g2cells)} for ${chars} — contracted` + (rules.length ? ` (${rules.map(r => `${r.cell} = ${r.meaning}`).join(', ')})` : '')
    : `${w}: spelt out in ${plural(g2cells)}`;

  const wordOutput =
    `<span class="ri-brl" aria-hidden="true">${brlHtml}</span> ` +
    `<span class="ri-arrow" aria-hidden="true">→</span> ` +
    `<span class="ri-word" aria-hidden="true">${txtHtml}</span> ` +
    `<span class="ri-note" aria-hidden="true">${plural(g2cells)} for ${chars}` +
      (contracted
        ? ` — <strong>contracted</strong> (uncontracted: <span class="ri-brl" style="font-size:1.1em">${escapeHtml(uniG1)}</span>, ${plural(g1cells)})`
        : ' — spelt out, no contraction') +
    `</span> ` +
    rules.map((r) => `<span class="ri-rule" aria-hidden="true"><span class="ri-brl">${escapeHtml(r.cell)}</span> = &ldquo;${escapeHtml(r.meaning)}&rdquo;</span>`).join(' ');
  if (body) {
    body.innerHTML = wordOutput;
  } else {
    el.innerHTML = wordOutput + (currentStatusText ? `<span class="doc-stats" id="docStats">${escapeHtml(currentStatusText)}</span>` : '');
  }
  updateDocStatsVisibility();
}

// Resizing the explanation bar via drag grab or arrow keys (matching Translate)
const SB_MIN_SCALE = 0.85, SB_MAX_SCALE = 2.2, SB_STEP = 0.15;
let statusScale = 1;
function applyStatusScale(next) {
  statusScale = Math.max(SB_MIN_SCALE, Math.min(SB_MAX_SCALE, Number(next) || 1));
  document.documentElement.style.setProperty('--sb-scale', statusScale.toFixed(3));
  const targetH = Math.min(220, Math.round(44 * statusScale));
  document.documentElement.style.setProperty('--sb-h', targetH + 'px');
  // A focusable role=separator must say where it is (WCAG 4.1.2): the bar's size as a percentage of normal.
  const grab = $id('sbGrab');
  if (grab) {
    grab.setAttribute('aria-valuemin', String(Math.round(SB_MIN_SCALE * 100)));
    grab.setAttribute('aria-valuemax', String(Math.round(SB_MAX_SCALE * 100)));
    grab.setAttribute('aria-valuenow', String(Math.round(statusScale * 100)));
    grab.setAttribute('aria-valuetext', statusScale === 1 ? 'normal size' : `${Math.round(statusScale * 100)} per cent`);
  }
  updateDocStatsVisibility();
  return statusScale;
}
(function wireStatusGrab() {
  const grab = $id('sbGrab');
  if (!grab) return;
  applyStatusScale(settings?.statusScale || 1);
  let startY = 0, startScale = 1, dragging = false;
  // saveSettings() rebuilds from localStorage, so a mutation of the in-memory object was
  // discarded; pass the patch.
  const commit = () => { if (settings) settings = saveSettings({ statusScale }); };
  const PX_PER_STEP = 40;
  grab.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startScale = statusScale;
    grab.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    applyStatusScale(startScale + ((startY - e.clientY) / PX_PER_STEP) * SB_STEP);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { grab.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    commit();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  grab.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? SB_STEP * 4 : SB_STEP;
    let next = null;
    if (e.key === 'ArrowUp') next = statusScale + step;
    else if (e.key === 'ArrowDown') next = statusScale - step;
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = SB_MAX_SCALE;
    else return;
    e.preventDefault();
    applyStatusScale(next);
    commit();
    announce(statusScale === 1 ? 'Explanation bar, normal size' : `Explanation bar, ${Math.round(statusScale * 100)} per cent`);
  });
})();
if (typeof ResizeObserver !== 'undefined' && brailleEl) {
  new ResizeObserver(() => {
    if (brailleEl && !isManualZoom) {
      autoFitBraille(brailleEl, (settings?.cells | 0) || 38);
    }
  }).observe(brailleEl);
}
if (typeof ResizeObserver !== 'undefined' && $id('statusBar')) {
  new ResizeObserver(() => updateDocStatsVisibility()).observe($id('statusBar'));
}
window.addEventListener('resize', updateDocStatsVisibility);
function domOffsetOfNode(el, targetNode, targetOffset) {
  if (!el || !targetNode) return 0;
  let acc = 0;
  let found = false;
  let finalOffset = 0;

  function walk(node) {
    if (found) return;
    if (node === targetNode) {
      found = true;
      if (node.nodeType === Node.TEXT_NODE) {
        finalOffset = acc + Math.max(0, Math.min(targetOffset || 0, node.nodeValue.length));
      } else {
        let childAcc = 0;
        const children = node.childNodes;
        const limit = Math.min(targetOffset || 0, children.length);
        for (let i = 0; i < limit; i++) {
          const c = children[i];
          if (c.nodeType === Node.TEXT_NODE) childAcc += c.nodeValue.length;
          else if (c.nodeType === Node.ELEMENT_NODE) {
            if (c.classList?.contains('math-embed') || c.tagName === 'MATH-FIELD' || c.classList?.contains('cell-math-chip')) {
              const mf = c.querySelector?.('math-field') || (c.tagName === 'MATH-FIELD' ? c : null);
              const latex = c.getAttribute?.('data-latex') || mf?.getAttribute?.('data-latex') || mf?.value || '';
              childAcc += (latex ? `$${latex}$` : '⟨equation⟩').length;
            } else {
              childAcc += c.textContent.length;
            }
          }
        }
        finalOffset = acc + childAcc;
      }
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      acc += node.nodeValue.length;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList?.contains('math-embed') || node.tagName === 'MATH-FIELD' || node.classList?.contains('cell-math-chip')) {
        const mf = node.querySelector?.('math-field') || (node.tagName === 'MATH-FIELD' ? node : null);
        const latex = node.getAttribute?.('data-latex') || mf?.getAttribute?.('data-latex') || mf?.value || '';
        acc += (latex ? `$${latex}$` : '⟨equation⟩').length;
      } else {
        for (const child of node.childNodes) {
          walk(child);
          if (found) return;
        }
      }
    }
  }

  walk(el);
  return found ? finalOffset : acc;
}

function caretOffsetInEl(el, ev) {
  const mathEmbed = ev?.target?.closest?.('.math-embed, math-field');
  if (mathEmbed && el.contains(mathEmbed)) {
    return domOffsetOfNode(el, mathEmbed, 0);
  }
  let node = null, off = 0;
  if (ev && document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(ev.clientX, ev.clientY);
    if (p) { node = p.offsetNode; off = p.offset; }
  } else if (ev && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
    if (r) { node = r.startContainer; off = r.startOffset; }
  }
  if (!node || !el.contains(node)) {
    const sel = window.getSelection();
    if (sel && sel.anchorNode && el.contains(sel.anchorNode)) {
      node = sel.anchorNode;
      off = sel.anchorOffset;
    }
  }
  if (!node) return 0;
  return domOffsetOfNode(el, node, off);
}
// hover over a braille line → expand its cells on-demand
brailleEl.addEventListener('pointerover', (e) => {
  const row = e.target.closest('.brl-row');
  if (row) expandRowCells(row);
}, { passive: true });

// click a braille cell → highlight its print word + the word's cells
brailleEl.addEventListener('click', (e) => {
  const cellRow = e.target.closest('.brl-row[data-block]');   // a traced cell may sit in a row without data-block
  if (cellRow) expandRowCells(cellRow);
  let cell = e.target.closest('.bcell[data-char]');
  if (!cell && cellRow) {
    const rowCells = Array.from(cellRow.querySelectorAll('.bcell[data-char]'));
    if (rowCells.length > 0) {
      let closest = rowCells[0], minD = Infinity;
      rowCells.forEach((c) => {
        const r = c.getBoundingClientRect();
        const d = Math.abs(e.clientX - (r.left + r.width / 2));
        if (d < minD) { minD = d; closest = c; }
      });
      cell = closest;
    }
  }
  if (cell && cellRow) {
    const block = Number(cellRow.dataset.block);
    const rawUnit = cell.dataset.unit;
    const unit = (rawUnit !== undefined && rawUnit !== '' && !isNaN(Number(rawUnit))) ? Number(rawUnit) : 0;
    const text = cellText[`${block}:${unit}`];
    if (text != null) {
      const [s, en] = wordRangeAt(text, +cell.dataset.char);
      highlightWord(block, unit, s, en, null, 'braille');
      showRuleInfo(text.slice(s, en));
      return;
    }
  }
  const row = e.target.closest('.brl-row[data-block]');      // fallback: block-level (decoration/maths cells)
  if (row) {
    clearWordLink();
    const bIdx = Number(row.dataset.block);
    linkByBlock(bIdx, true);
    const text = cellText[`${bIdx}:0`];
    if (text) showRuleInfo(text.split(/\s+/)[0] || text);
    const pe = editorEl.querySelector(`[data-block-idx="${row.dataset.block}"]`);
    if (pe && !isElementVisibleIn(pe, editorEl)) {
      pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }
  // A line Emboss adds (no print of its own: the title, a running head, a page number …) says what it is and where to change it
  // (feedback 30 Sep item 10, Paul 1 Oct).
  const genRow = e.target.closest('.brl-row[data-row]');
  if (genRow) {
    const msg = describeGeneratedRow(Number(genRow.dataset.row));
    if (msg) {
      clearWordLink();
      const body = $id('ruleInfoBody');
      if (body) body.innerHTML = `<span class="ri-note generated-line-note" style="color:var(--ink)">${iconSvg('info-circle', 'icon icon-inline')} ${escapeHtml(msg)}</span>`;
      announce(msg);
    }
  }
});
// What a braille line with no print of its own is, from where it sits: on page 1 before the first block, the document title (BANA);
// a page's first line, its running head / print page number (BANA) or page information line (UKAAF); a BANA page's last line, its
// braille page number. Anything else Emboss added gets a general note. Null for a blank line.
function describeGeneratedRow(r) {
  const rows = (lastTrace && lastTrace.rows) || [];
  const lines = String(lastBrf || '').split(/\r?\n/);
  const line = String(lines[r] ?? '').replace(/\f/g, '');
  if (!line.trim() || (rows[r] != null && rows[r] >= 0)) return null;
  const starts = Array.isArray(lastPageLineStarts) && lastPageLineStarts.length ? lastPageLineStarts : [0];
  let p = 0;
  while (p + 1 < starts.length && starts[p + 1] <= r) p++;
  const pageStart = starts[p], pageEnd = (p + 1 < starts.length ? starts[p + 1] : lines.length) - 1;
  const bana = ((lastFormatOpts && lastFormatOpts.mode) || settings.mode) === 'bana';
  const firstContent = rows.findIndex((x) => x != null && x >= 0);
  if (bana) {
    if (p === 0 && firstContent >= 0 && r < firstContent && lastModel && lastModel.title) return tOr('app.editor.generated_title', 'Document title. BANA puts the book\'s title at the top of the first braille page. Change it in the Title field above the text.');
    if (r === pageStart) return tOr('app.editor.generated_head', 'Running head and print page number.');
    if (r === pageEnd) return tOr('app.editor.generated_foot', 'Braille page number. Emboss numbers the braille pages itself.');
  } else if (r === pageStart) return tOr('app.editor.generated_ukaaf_head', 'Page information line.');
  return tOr('app.editor.generated_other', 'Emboss added this line as part of the braille layout. It has no print of its own.');
}
function handleMathFieldSelect(mf) {
  if (!mf) return false;
  try { if (typeof mf.focus === 'function' && document.activeElement !== mf) mf.focus(); } catch {}
  const resolved = resolveBlockUnit(mf);
  if (!resolved) return false;
  const { block, unit, unitEl } = resolved;
  const b = lastModel?.blocks?.[block];
  let segs = b?.segments;
  if (b?.type === 'list') segs = b?.items?.[unit]?.segments;
  else if ((b?.type === 'box' || b?.type === 'sidebar') && Array.isArray(b?.blocks)) {
    segs = b.blocks[unit]?.segments;
  }
  const mathEmbeds = Array.from(unitEl.querySelectorAll('.math-embed, math-field'));
  const distinctEmbeds = mathEmbeds.filter(m => m.classList.contains('math-embed') || !m.closest('.math-embed'));
  const clickedIdx = distinctEmbeds.findIndex(m => m === mf || m.contains(mf) || (mf.contains && mf.contains(m)));
  if (segs && clickedIdx >= 0) {
    let curPos = 0, mIdx = 0;
    for (const seg of segs) {
      if (seg.type === 'math') {
        const mLen = (seg.latex ? `$${seg.latex}$` : '⟨equation⟩').length;
        if (mIdx === clickedIdx) {
          lastCaretWordKey = `${block}:${unit}:${curPos}:${curPos + mLen}:math`;
          highlightWord(block, unit, curPos, curPos + mLen, null, 'editor');
          showRuleInfo(seg.latex ? `$${seg.latex}$` : '⟨equation⟩');
          mf.classList.add('math-hl');
          const wrap = mf.closest('.math-embed');
          if (wrap) wrap.classList.add('math-hl');
          refreshToolbar();
          return true;
        }
        mIdx++;
        curPos += mLen;
      } else {
        curPos += (seg.text || '').replace(/\s+/g, ' ').length;
      }
    }
  }
  clearWordLink();
  linkByBlock(block);
  lastCaretWordKey = `${block}:${unit}:math`;
  mf.classList.add('math-hl');
  const wrap = mf.closest('.math-embed');
  if (wrap) wrap.classList.add('math-hl');
  const val = mf.value || b?.latex || (mf.getValue ? mf.getValue() : '');
  if (val) showRuleInfo(`$${val}$`);
  refreshToolbar();
  return true;
}

// click a print word or math equation → highlight its braille cells
editorEl.addEventListener('click', (e) => {
  const mf = e.target.closest('math-field') || e.target.closest('.math-embed')?.querySelector('math-field') || (e.composedPath && e.composedPath().find(el => el.tagName === 'MATH-FIELD'));
  if (mf && handleMathFieldSelect(mf)) {
    refreshToolbar(e.target);
    return;
  }
  // A table cell has its own mousedown/focus/pointerup/keyup handlers (handleTableCellEvent,
  // via makeTableCell) that already resolve the exact cell and word range. resolveBlockUnit
  // has no notion of a table cell — for any click inside one it falls through to its default
  // (unit 0, unitEl = the whole table's container), which then clobbers the correct highlight
  // that pointerup/focus just set, always landing on the table's first cell/word and letting
  // the caret jump there too. Skip this generic handler for table cells; syncCaretWithBraille
  // and describeCaretWord already carry the equivalent isTableCellEl guard.
  if (e.target.closest && e.target.closest('.table-cell-input')) {
    refreshToolbar(e.target);
    return;
  }

  const resolved = resolveBlockUnit(e.target);
  if (!resolved) {
    refreshToolbar(e.target);
    return;
  }
  const { block, unit, unitEl } = resolved;
  const text = cellText[`${block}:${unit}`];
  if (text == null || !text.trim()) {
    clearWordLink();
    linkByBlock(block);
    refreshToolbar(e.target);
    return;
  }

  const offset = domToModel(unitEl, caretOffsetInEl(unitEl, e), text);
  const [s, en] = wordRangeAt(text, offset);
  highlightWord(block, unit, s, en, offset, 'editor');
  showRuleInfo(text.slice(s, en));
  refreshToolbar(e.target);
});

editorEl.addEventListener('pointerup', (e) => {
  refreshToolbar(e.target);
});

editorEl.addEventListener('focusin', (e) => {
  const mf = e.target.closest('math-field') || e.target.closest('.math-embed')?.querySelector('math-field') || (e.composedPath && e.composedPath().find(el => el.tagName === 'MATH-FIELD'));
  if (mf) handleMathFieldSelect(mf);
  refreshToolbar(e.target);
});

// ---- Table of Contents print preview in editor (Expandable / Collapsible) ----
let isTocBoxCollapsed = localStorage.getItem('emboss-toc-box-collapsed') === 'true';

function updatePrintToc() {
  const container = $id('printTocContainer');
  if (!container) return;
  const headings = [];
  (lastModel?.blocks || []).forEach((b, idx) => {
    if ((b.type === 'heading' || b.type === 'title') && b.text) headings.push({ text: b.text.replace(/\n/g, ' '), level: b.type === 'title' ? 1 : (b.level || 1), blockIdx: idx });   // #57b: a title still shows in the contents, as the level-1 heading it was
  });
  if (!headings.length) {
    container.innerHTML = '';
    return;
  }

  const countText = headings.length === 1 ? t('app.toc.section_one') : t('app.toc.sections', { count: headings.length });
  // Iconoir nav-arrows, not the ▾ ▴ characters (Paul, 17 Oct 2026, feedback item 3); the label is HTML here, built from escaped text and the icon.
  const toggleLabel = `${escapeHtml(isTocBoxCollapsed ? t('app.toc.expand') : t('app.toc.shrink'))} ${iconSvg(isTocBoxCollapsed ? 'nav-arrow-down' : 'nav-arrow-up', 'icon icon-inline')}`;
  const toggleAria = escapeHtml(isTocBoxCollapsed ? t('app.toc.expand_aria') : t('app.toc.shrink_aria'));
  const ariaExpanded = !isTocBoxCollapsed;

  container.innerHTML = `
    <div class="print-toc-box ${isTocBoxCollapsed ? 'collapsed' : ''}" id="printTocBox">
      <div class="print-toc-head" id="printTocHead" title="${toggleAria}">
        <h3>${iconSvg('list', 'icon icon-inline')} ${escapeHtml(t('app.toc.title'))} <span class="print-toc-count">(${escapeHtml(countText)})</span></h3>
        <button type="button" class="print-toc-toggle-btn" id="printTocToggleBtn" aria-label="${toggleAria}" aria-expanded="${ariaExpanded}" aria-controls="printTocList">${toggleLabel}</button>
      </div>
      <ul class="print-toc-list" id="printTocList">
        ${headings.map(h => `<li style="margin-left:${(h.level - 1) * 1.2}em"><a href="#" data-jump-block="${h.blockIdx}">${escapeHtml(h.text)}</a></li>`).join('')}
      </ul>
    </div>
  `;

  const toggleAction = () => {
    isTocBoxCollapsed = !isTocBoxCollapsed;
    localStorage.setItem('emboss-toc-box-collapsed', String(isTocBoxCollapsed));
    updatePrintToc();
  };

  const headEl = container.querySelector('#printTocHead');
  headEl?.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    toggleAction();
  });
  // The keyboard reaches the toggle through its own button (whose click bubbles here); the heading is not a second, nested button.

  container.querySelectorAll('a[data-jump-block]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const bIdx = Number(a.dataset.jumpBlock);
      const target = editorEl.querySelector(`[data-block-idx="${bIdx}"]`);
      if (target) {
        scrollWithin(editorEl, target, { block: 'center' });
        // the caret goes to the heading too (18 Oct 2026): it stayed where it was, so the next key - Backspace - acted off-screen
        const key = lastKeys[bIdx];
        if (key) editor.update(() => { const n = $getNodeByKey(key); if (n && typeof n.selectStart === 'function') n.selectStart(); });
        editorEl.focus({ preventScroll: true });
        linkByBlock(bIdx, true);
      }
    });
  });
}
// Keyboard equivalent of clicking a word: describe the braille for the word at the
// caret (highlights it + announces the contraction) — the linking/rule transparency
// without a mouse. Bound to Ctrl/⌘+Shift+D.
function domOffsetInEl(el, node, offset) {
  return domOffsetOfNode(el, node, offset);
}

let lastCaretWordKey = '';
let caretSyncTimer = null;
// Is the word the caret is on still the one the page has lit? (The Highlight's Range is attached to the text and reads as that word.)
function caretHighlightIsLive(word) {
  if (!HL_API) return true;
  const h = CSS.highlights.get('link-word');
  if (!h) return false;
  const rs = [...h];
  if (rs.length !== 1) return false;
  const r = rs[0];
  if (!r.startContainer || !r.startContainer.isConnected || r.collapsed) return false;
  return r.toString().replace(/\s+/g, ' ').trim() === String(word).replace(/\s+/g, ' ').trim() || /\$/.test(String(word));
}
// The caret has left an equation: drop its highlight and forget it was the last thing picked out, so the next caret move links the word it lands on.
function leaveMathHighlight(mf) {
  try { mf.classList.remove('math-hl'); mf.closest('.math-embed')?.classList.remove('math-hl'); } catch { /* detached */ }
  if (lastCaretWordKey && lastCaretWordKey.endsWith(':math')) lastCaretWordKey = '';
}

function syncCaretWithBraille(immediate = false) {
  const doSync = () => {
    const active = document.activeElement;
    if (active && (active.tagName === 'MATH-FIELD' || active.closest?.('math-field'))) {
      const mf = active.tagName === 'MATH-FIELD' ? active : active.closest('math-field');
      handleMathFieldSelect(mf);
      return;
    }
    if (isTableCellEl(active)) {
      const unit = Number(active.dataset.unit || 0);
      handleTableCellEvent(active, unit);
      return;
    }
    // An equation was picked out (by a click, or the caret was in it) and the page still shows it. Leave it alone while the keyboard is somewhere
    // else (a button, a dialog) — but once the keyboard is back in the text (the arrow keys left the equation), the caret's word takes over:
    // returning here then left the equation lit, with the word after it lit as well, while the arrow keys went on through the text (item 10).
    if (lastCaretWordKey && lastCaretWordKey.endsWith(':math') && document.activeElement !== editorEl) {
      const currentMathHl = editorEl.querySelector('.math-hl');
      if (currentMathHl) return;
    }
    // A selected picture, table or graphic (a node selection, feedback item 9): link its own braille lines. The page's text cursor
    // is then at the start of the document, and reading it highlighted the first word there, as if Delete would act on it.
    let nodeSelBlock = null, nodeSelected = false;
    editor.getEditorState().read(() => {
      const ls = $getSelection();
      if (!$isNodeSelection(ls)) return;
      nodeSelected = true;
      const n = ls.getNodes()[0];
      const top = n && typeof n.getTopLevelElement === 'function' ? (n.getTopLevelElement() || n) : n;
      const i = top ? lastKeys.indexOf(top.getKey()) : -1;
      if (i >= 0) nodeSelBlock = i;
    });
    if (nodeSelected) {
      clearWordLink();
      if (nodeSelBlock != null) linkByBlock(nodeSelBlock, false);
      lastCaretWordKey = null;
      showIdleStatus();
      return;
    }
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !editorEl.contains(sel.anchorNode)) return;
    const node = sel.anchorNode;
    let targetChild = null;
    if (node.nodeType === 1 && typeof sel.anchorOffset === 'number' && sel.anchorOffset < node.childNodes.length) {
      targetChild = node.childNodes[sel.anchorOffset];
    }
    const target = targetChild || node;
    const mf = (target.nodeType === 1 ? target : target.parentElement)?.closest?.('math-field') || (target.nodeType === 1 ? target : target.parentElement)?.closest?.('.math-embed')?.querySelector('math-field') || (target.tagName === 'MATH-FIELD' ? target : null);
    if (mf) {
      handleMathFieldSelect(mf);
      return;
    }
    const resolved = resolveBlockUnit(target);
    if (!resolved) {
      // The caret is somewhere that has no word (a card, the page's own edge): the last word's highlight must not stay behind (item 10).
      if (lastCaretWordKey && (activeWordHighlight || (HL_API && CSS.highlights.has('link-word')))) { clearWordLink(); lastCaretWordKey = ''; }
      return;
    }
    const { block, unit, unitEl } = resolved;
    const text = cellText[`${block}:${unit}`];
    if (text == null || !text.trim()) {
      clearWordLink();
      linkByBlock(block, false);
      lastCaretWordKey = `${block}:${unit}:empty`;
      return;
    }
    const offset = domToModel(unitEl, domOffsetInEl(unitEl, node, sel.anchorOffset), text);
    const [s, en] = wordRangeAt(text, offset);
    const wordKey = `${block}:${unit}:${s}:${en}:${offset}`;
    if (wordKey === lastCaretWordKey && caretHighlightIsLive(text.slice(s, en))) return;   // the same word, and still lit: nothing to do (a stale or dropped highlight is made again)
    lastCaretWordKey = wordKey;
    highlightWord(block, unit, s, en, offset, 'caret');
    showRuleInfo(text.slice(s, en));
  };

  if (caretSyncTimer) cancelAnimationFrame(caretSyncTimer);
  if (immediate) {
    doSync();
  } else {
    caretSyncTimer = requestAnimationFrame(doSync);
  }
}
window.syncCaretWithBraille = syncCaretWithBraille;

function describeCaretWord() {
  const active = document.activeElement;
  if (isTableCellEl(active)) {
    const unit = Number(active.dataset.unit || 0);
    handleTableCellEvent(active, unit);
    const be = active.closest('[data-block-idx]');
    const block = be ? Number(be.dataset.blockIdx) : 0;
    const text = cellText[`${block}:${unit}`] || flatSegText(cellHtmlToSegments(active.innerHTML));
    const [s, en] = wordRangeAt(text, tableCellCaretOffset(active));
    announce(lastRuleSpoken || text.slice(s, en));
    return;
  }
  const sel = window.getSelection();
  const node = sel && sel.anchorNode;
  if (!node || !editorEl.contains(node)) { announce(t('app.editor.caret_first')); return; }
  let targetChild = null;
  if (node.nodeType === 1 && typeof sel.anchorOffset === 'number' && sel.anchorOffset < node.childNodes.length) {
    targetChild = node.childNodes[sel.anchorOffset];
  }
  const target = targetChild || node;
  const resolved = resolveBlockUnit(target);
  if (!resolved) { announce(t('app.editor.caret_first')); return; }
  const { block, unit, unitEl } = resolved;
  const text = cellText[`${block}:${unit}`];
  if (text == null) { announce(t('app.editor.no_mapping')); return; }
  const [s, en] = wordRangeAt(text, domToModel(unitEl, domOffsetInEl(unitEl, node, sel.anchorOffset), text));
  highlightWord(block, unit, s, en, null, 'caret');
  showRuleInfo(text.slice(s, en));
  announce(lastRuleSpoken || text.slice(s, en));
}

// F9 item K (tests): for every (block, unit) with a flat text, do the print offsets and the model's agree? Direction A: for every word of the
// flat text (wordRangeAt), the print Range charRangeInEl gives covers exactly that word. Direction B: for characters of the print text
// (every `stride`-th), the offset domOffsetOfNode gives is the same character in the flat text. `limit` units at most, every
// `unitStride`-th unit. Returns counts and the first mismatches.
window.__printLinkCheck = ({ unitStride = 1, stride = 7, limit = Infinity, maxReport = 40 } = {}) => {
  const norm = (x) => String(x).replace(/\s+/g, ' ');
  const res = { units: 0, skipped: 0, words: 0, charsChecked: 0, badWords: 0, badChars: 0, mismatches: [] };
  const keys = Object.keys(cellText);
  for (let k = 0; k < keys.length && res.units < limit; k += unitStride) {
    const key = keys[k]; const text = cellText[key];
    if (text == null || !String(text).trim()) continue;
    const [bi, ui] = key.split(':').map(Number);
    const el = printUnitEl(bi, ui);
    if (!el || (el.getAttribute && el.getAttribute('data-block-idx') != null && lastModel?.blocks?.[bi]?.type && !['para', 'paragraph', 'heading', 'list', 'quote', 'title'].includes(lastModel.blocks[bi].type))) { res.skipped++; continue; }
    res.units++;
    // direction A
    let pos = 0;
    while (pos < text.length) {
      if (/\s/.test(text[pos])) { pos++; continue; }
      const [ws, we] = wordRangeAt(text, pos);
      if (we <= pos) { pos++; continue; }
      res.words++;
      const r = charRangeInEl(el, ws, we, text);
      const got = r ? norm(r.toString()) : null, want = norm(text.slice(ws, we));
      if (got === null) { const al = alignPrint(el, text); let allHidden = !!al; for (let q = ws; al && q < we; q++) if (al.m2d[q] >= 0) allHidden = false; if (allHidden) { res.hiddenWords = (res.hiddenWords || 0) + 1; pos = we; continue; } }   // a word print does not show (a hidden bullet): nothing to highlight, not an error
      if (got !== want) { res.badWords++; if (res.mismatches.length < maxReport) res.mismatches.push({ key, kind: 'word', want, got, ws, we, type: lastModel?.blocks?.[bi]?.type, dom: norm(el.textContent).slice(0, 70), model: String(text).slice(0, 70) }); }
      pos = we;
    }
    // direction B
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement?.closest('.math-embed, math-field, .cell-math-chip')) continue;
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i += stride) {
        if (/\s/.test(v[i])) continue;
        res.charsChecked++;
        const m = domToModel(el, domOffsetOfNode(el, n, i), text);
        if (text[m] !== v[i]) { res.badChars++; if (res.mismatches.length < maxReport) res.mismatches.push({ key, kind: 'char', dom: v[i], model: text[m], off: m, ctx: v.slice(Math.max(0, i - 8), i + 8) }); }
      }
    }
  }
  return res;
};

// ---- transparency: hovering a braille line shows the text it came from ----
function blockDisplayText(b) {
  if (!b) return '';
  if (b.type === 'heading' || b.type === 'title') return (b.text || '').replace(/\n/g, ' ');
  if (b.type === 'indicator') return b.kind === 'asterism' ? '⁂ ⁂ ⁂' : '* * *';
  if (b.type === 'list') return (b.items || []).map((it) => it.text).join(' • ');
  if (b.type === 'para') {
    if (b.segments) return b.segments.map((s) => (s.type === 'math' ? '⟨maths⟩' : (s.text || ''))).join('');
    return b.text || '';
  }
  return '';
}
function annotateRows(model) {
  brailleEl.querySelectorAll('.brl-row[data-block]').forEach((row) => {
    const t = blockDisplayText(model.blocks[Number(row.dataset.block)]);
    if (t) row.title = t;
  });
}

// ---- round-trip proofread: badge + flag lines that don't read back ----
function setProofBadge(kind, label, tip) {
  const b = $id('proofBadge'); if (!b) return;
  b.className = 'proof-badge ' + kind;
  b.textContent = label;
  b.title = tip || b.title;
}
let proofreadTimer = null;
let lastProofIssues = [];
let proofBusy = false;                  // a pass over the document is running (tests read it: window.proofreadBusy)
window.proofreadBusy = () => proofBusy;
// F9 item A: while a pass runs (seconds, on a big book, after every edit) the badge still shows the last count. Its words are the
// ones this pass has found so far plus the earlier pass's words in blocks this pass has not reached, and only those still in the text.
let proofPass = null;                   // {issues, at()} while a pass runs
function proofIssueStillThere(i) {
  try {
    const pe = printUnitEl(i.idx, i.itemIdx) || editorEl.querySelector(`[data-block-idx="${i.idx}"]`);
    const r = pe && charRangeInEl(pe, i.start, i.end, i.src);
    return !!r && r.toString().replace(/\s+/g, ' ') === String(i.word || '').replace(/\s+/g, ' ');
  } catch { return false; }
}
function proofIssuesNow() {
  if (!proofPass) return lastProofIssues;
  const at = proofPass.at();
  return proofPass.issues.concat(lastProofIssues.filter((i) => i.idx >= at && proofIssueStillThere(i)));   // already in document order: this pass's blocks come first
}

function clearProofHighlights() {
  if (HL_API) delHl('proof-warn-word');
  editorEl.querySelectorAll('.proof-warn').forEach((e) => { e.classList.remove('proof-warn'); e.removeAttribute('title'); });
}

function runProofread(model, table) {
  if (proofreadTimer) clearTimeout(proofreadTimer);
  clearProofHighlights();
  proofBusy = false;
  lastProofIssues = proofIssuesNow();     // what the pass that is being replaced knew: the badge's list until this pass has found its own
  proofPass = null;
  
  // Feedback 30 Sep item 7 (Paul, 1 Oct): an emptied document has nothing to check — hide the badge, which used to stay showing
  // the last document's count after Clear or select-all-and-delete.
  if (!model || !model.blocks || !model.blocks.length) { lastProofIssues = []; const badge = $id('proofBadge'); if (badge) badge.hidden = true; return; }
  
  proofBusy = true;
  const blocks = model.blocks;
  const total = blocks.length;
  const issues = [];
  let checked = 0;
  let currentIdx = 0;
  proofPass = { issues, at: () => currentIdx };
  const chunkSize = 60;
  const warnRanges = [];
  
  function processChunk() {
    const end = Math.min(total, currentIdx + chunkSize);
    for (let i = currentIdx; i < end; i++) {
      const b = blocks[i];
      if (!b) continue;
      const entries = blockEntries(b);
      for (const entry of entries) {
        if (!entry.text || !entry.text.trim()) continue;
        checked++;
        try {
          const hasSeg = entry.segments && entry.segments.some((seg) => seg.uncontracted || seg.tf);
          const cacheKey = `${entry.text}|${table}|${hasSeg ? 'seg' : 'plain'}`;
          let res = proofreadCache.get(cacheKey);
          if (!res) {
            const tr = makeTranslators(louis, table);
            const trG1 = /en-ueb/.test(table) ? (s) => makeTranslators(louis, UEB_TABLES.g1).translate(s) : null;
            const translateEntry = (s) => {
              if (hasSeg) {
                let out = '';
                for (const seg of entry.segments) {
                  const t = String(seg.text ?? '');
                  if (!t) continue;
                  if (seg.uncontracted) {
                    const g1 = trG1 ? trG1(t) : tr.translate(t);
                    out += t.includes(' ') ? `;;;${g1};'` : `;;${g1}`;
                  } else if (seg.tf) {
                    out += tr.translate(t, Array(t.length).fill(seg.tf));
                  } else {
                    out += tr.translate(t);
                  }
                }
                return out;
              }
              return tr.translate(s);
            };
            // The text as the real translator sees it (feedback 30 Sep item 7): invisible characters such as a soft hyphen
            // removed, no-break spaces as spaces — the check brailled them raw and flagged "soft­hyphen" though its braille was
            // right. Word positions are mapped back to the original text for highlighting.
            const norm = hasSeg ? null : normalizeTextAndTypeform(entry.text, null);
            // Emboss's script markers (U+E000-U+E002) are seen as spaces, one for one (positions unchanged): passed to liblouis raw
            // they garbled the read-back of the whole line ("script" in "…with script: Figure 1ᵃ" came back different).
            const checkText = (norm && norm.map ? norm.text : entry.text).replace(/[\uE000-\uE002]/g, ' ');
            res = roundTrip(checkText, translateEntry, (s) => tr.backTranslate(s));
            if (norm && norm.map && res.wordIssues) {
              const mp = norm.map;
              res = { ...res, wordIssues: res.wordIssues.map((w) => ({ ...w, word: entry.text.slice(mp[w.start] ?? w.start, (mp[w.end - 1] ?? w.end - 1) + 1), start: mp[w.start] ?? w.start, end: (mp[w.end - 1] ?? w.end - 1) + 1 })) };
            }
            proofreadCache.set(cacheKey, res);
          }
          if (!res.ok && res.wordIssues && res.wordIssues.length > 0) {
            for (const w of res.wordIssues) {
              // A word next to or inside a sub/superscript (Emboss's script markers U+E000-U+E002) is not one this check can judge:
              // it brailles the raw text, and reading back cannot turn script indicators into markers, so every such word came back
              // "different" while its braille was right (feedback 30 Sep item 7: Paul's test document showed "4 to review", all
              // the words of its subscript and superscript line).
              if (/[\uE000-\uE002]/.test(entry.text.slice(Math.max(0, w.start - 1), w.end + 1))) continue;
              // Nor is a word of a web or email address: UEB brailles those by its computer-material rules, which reading back
              // cannot reverse ("https" was flagged in every document with a link).
              // Nor a word touching a note reference: its number is brailled as the reference mark, which reading back cannot
              // reverse ("script:" + reference 3 came back as two words to check).
              if (Array.isArray(entry.segments)) {
                let c = 0, touches = false;
                for (const g of entry.segments) { const len = String((g && g.text) || '').length; if (g && g.type === 'noteref' && w.start <= c + len + 1 && w.end >= c - 1) touches = true; /* next to it, or one punctuation mark away ("script:³") */ c += len; }
                if (touches) continue;
              }
              const tokA = entry.text.lastIndexOf(' ', w.start) + 1, tokB = entry.text.indexOf(' ', w.end);
              if (/:\/\/|^www\.|\S@\S/i.test(entry.text.slice(tokA, tokB < 0 ? entry.text.length : tokB))) continue;
              issues.push({ idx: i, itemIdx: entry.itemIdx, word: w.word, start: w.start, end: w.end, src: entry.text, back: res.back });
              const pe = printUnitEl(i, entry.itemIdx) || editorEl.querySelector(`[data-block-idx="${i}"]`);
              if (pe) {
                const r = charRangeInEl(pe, w.start, w.end, entry.text);
                if (r) warnRanges.push(r);
              }
            }
          }
        } catch (e) { /* ignore single line errors */ }
      }
    }
    currentIdx = end;
    if (currentIdx < total) {
      proofreadTimer = setTimeout(processChunk, 16);
    } else {
      lastProofIssues = issues;
      proofPass = null;
      proofBusy = false;
      if (HL_API) {
        if (warnRanges.length > 0) {
          setHl('proof-warn-word', new Highlight(...warnRanges));
        } else {
          delHl('proof-warn-word');
        }
      }
      const badge = $id('proofBadge');
      if (issues.length === 0) {
        if (badge) badge.hidden = true;
      } else {
        if (badge) badge.hidden = false;
        // Plain words (feedback 30 Sep item 7, Paul, 1 Oct): what the badge is for, said where it is seen.
        const one = issues.length === 1;
        setProofBadge('warn', (one ? tOr('proofread.badge_warn_one', '1 word to check') : tOr('proofread.badge_warn', `${issues.length} words to check`).replace('{count}', issues.length)),
          tOr('proofread.badge_title', `Emboss checks its braille by reading it back into print. ${issues.length} word(s) did not come back the same. The braille is often still right (names and unusual words), but it is worth checking. Select to go to each one in turn.`).replace('{count}', issues.length));
      }
    }
  }

  proofreadTimer = setTimeout(processChunk, 50);
}

// The warnings shown to the user (badge, list, export notice). 'trace-fallback' is left out (feedback 30 Sep item 7, Paul, 1 Oct):
// it says only that the editor could not link a block's cells to the print, the braille itself unchanged — a diagnostic, not
// something a reader or transcriber can act on. It stays in lastWarnings (window.lastWarnings) for tests and debugging.
const shownWarnings = () => lastWarnings.filter((w) => w && w.kind !== 'trace-fallback');
// ---- transcription warnings (Fable review #5): a small badge near the braille pane, like
// the proofreading one above, opening a list where each warning jumps to its block. Built from
// `lastWarnings` (render()'s copy of opts.warnings — see format/document.mjs's pushWarning),
// which never affects the braille itself; this is purely a "what changed" report on top of it.
const WARN_KIND_LABEL_KEY = {
  'block-skipped': 'app.warnings.kind_block_skipped',
  'trace-fallback': 'app.warnings.kind_trace_fallback',
  'lou-undefined-char': 'app.warnings.kind_lou_undefined_char',
  'blanked-char': 'app.warnings.kind_blanked_char',
  'table-fallback': 'app.warnings.kind_table_fallback',
  'titlepage-overflow': 'app.warnings.kind_titlepage_overflow',   // K29 Stage 1b's pushWarning (format/document.mjs traceTitlePage); en.json strings already exist
};
// Kinds with no locale string yet (English only; a locale key can replace an entry here later).
const WARN_KIND_PLAIN_LABEL = {
  'picture-no-description': 'Picture without a description',   // IMP-W12 (Paul, 30 Sep 2026)
  'math-unreadable': 'Equation Emboss could not read',   // A89 (Paul, 2 Oct 2026): TeX Temml could not convert
};
function warningKindLabel(kind) {
  const key = WARN_KIND_LABEL_KEY[kind];
  return (key && t(key)) || WARN_KIND_PLAIN_LABEL[kind] || kind || '';
}
function warningMessageFor(w) {
  if (!w) return '';
  const chars = Array.isArray(w.chars) ? w.chars.join(' ') : '';
  switch (w.kind) {
    case 'block-skipped': return t('app.warnings.message_block_skipped', { message: w.message || '' }) || w.message || '';
    case 'trace-fallback': return t('app.warnings.message_trace_fallback', { message: w.message || '' }) || w.message || '';
    case 'lou-undefined-char': return t('app.warnings.message_lou_undefined_char', { count: w.count || 0, chars }) || w.message || '';
    case 'blanked-char': return t('app.warnings.message_blanked_char', { count: w.count || 0, chars }) || w.message || '';
    case 'table-fallback': {
      const resolvedLayoutLabel = w.resolvedLayout === 'listed' ? 'a Listed table' : 'paragraph form';
      return t('app.warnings.message_table_fallback', { requestedMode: w.requestedMode || 'auto', resolvedLayoutLabel }) || w.message || '';
    }
    case 'titlepage-overflow': return t('app.warnings.message_titlepage_overflow') || w.message || '';
    default: return w.message || '';
  }
}
function jumpToWarningBlock(w) {
  if (!w || w.blockIndex == null || w.blockIndex < 0) return;
  const el = editorEl.querySelector(`[data-block-idx="${w.blockIndex}"]`);
  if (!el) return;
  scrollWithin(editorEl, el, { block: 'center', behavior: 'smooth' });
  // The print-pane block elements are plain <div>/<li>/etc. with no native tabindex, so a bare
  // .focus() is a silent no-op; give it one just long enough to take focus (the standard
  // "temporary tabindex" pattern for moving focus to non-interactive content), so a screen
  // reader / keyboard user actually lands there, not just sees it scroll.
  const hadTabIndex = el.hasAttribute('tabindex');
  if (!hadTabIndex) el.setAttribute('tabindex', '-1');
  try { el.focus({ preventScroll: true }); } catch { /* not focusable even with tabindex */ }
  if (!hadTabIndex) {
    const cleanup = () => { el.removeAttribute('tabindex'); el.removeEventListener('blur', cleanup); };
    el.addEventListener('blur', cleanup, { once: true });
  }
}
function renderWarningsPanel() {
  const list = $id('warnPanelList');
  if (!list) return;
  list.innerHTML = '';
  if (!shownWarnings().length) {
    const li = document.createElement('li');
    li.className = 'warn-panel-empty';
    li.textContent = t('app.warnings.panel_empty') || 'No transcription warnings.';
    list.appendChild(li);
    return;
  }
  shownWarnings().forEach((w, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'warn-item';
    const kindEl = document.createElement('span');
    kindEl.className = 'warn-item-kind';
    kindEl.textContent = warningKindLabel(w.kind);
    const msgEl = document.createElement('span');
    msgEl.className = 'warn-item-msg';
    msgEl.textContent = warningMessageFor(w);
    btn.appendChild(kindEl);
    btn.appendChild(msgEl);
    if (w.snippet) {
      const snEl = document.createElement('span');
      snEl.className = 'warn-item-snippet';
      snEl.textContent = w.snippet;
      btn.appendChild(snEl);
    }
    btn.setAttribute('aria-label', t('app.warnings.list_item_aria', { n: i + 1, total: shownWarnings().length, kind: warningKindLabel(w.kind), message: warningMessageFor(w) }) || `${warningKindLabel(w.kind)}: ${warningMessageFor(w)}`);
    btn.addEventListener('click', () => {
      jumpToWarningBlock(w);
      closeWarningsPanel();
      announce(t('app.warnings.jump_announce', { n: i + 1, total: shownWarnings().length, message: warningMessageFor(w) }));
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}
function openWarningsPanel() {
  const panel = $id('warnPanel'), badge = $id('warnBadge');
  if (!panel) return;
  renderWarningsPanel();
  panel.hidden = false;
  badge?.setAttribute('aria-expanded', 'true');
  panel.querySelector('.warn-item, #warnPanelClose')?.focus({ preventScroll: true });
  document.addEventListener('keydown', warnPanelKeydown, true);
  document.addEventListener('click', warnPanelOutsideClick, true);
}
function closeWarningsPanel() {
  const panel = $id('warnPanel'), badge = $id('warnBadge');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  badge?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', warnPanelKeydown, true);
  document.removeEventListener('click', warnPanelOutsideClick, true);
}
function warnPanelKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeWarningsPanel(); $id('warnBadge')?.focus({ preventScroll: true }); }
}
function warnPanelOutsideClick(e) {
  const panel = $id('warnPanel'), badge = $id('warnBadge');
  if (panel && !panel.contains(e.target) && e.target !== badge) closeWarningsPanel();
}
function updateWarningsUI() {
  const badge = $id('warnBadge');
  if (!badge) return;
  const n = shownWarnings().length;
  if (!n) {
    badge.hidden = true;
    closeWarningsPanel();
    return;
  }
  badge.hidden = false;
  const label = n === 1 ? (t('app.warnings.badge_one') || '1 transcription warning') : (t('app.warnings.badge_other', { count: n }) || `${n} transcription warnings`);
  badge.textContent = label;
  const title = t('app.warnings.badge_title', { count: n }) || `Emboss had to skip or change ${n} thing(s) while brailling this document.`;
  badge.title = title;
  badge.setAttribute('aria-label', title);
  if (!$id('warnPanel')?.hidden) renderWarningsPanel();   // keep an open panel in sync with a fresh render
}
// Shown once before a BRF/PEF/eBraille/NIMAS export whenever the last render produced any
// transcription warnings — the download still proceeds; this only makes sure the transcriber
// sees it, per Fable review #5 ("a short notice ... before download").
let exportWarnDismissTimer = null;
function maybeShowExportWarningNotice() {
  if (!shownWarnings().length) return;
  const notice = $id('exportWarnNotice'), textEl = $id('exportWarnNoticeText');
  if (!notice || !textEl) return;
  const msg = t('app.warnings.export_notice', { count: shownWarnings().length }) || `Emboss had to skip or change ${shownWarnings().length} thing(s) — see details`;
  textEl.textContent = msg;
  notice.hidden = false;
  announce(msg);
  if (exportWarnDismissTimer) clearTimeout(exportWarnDismissTimer);
  exportWarnDismissTimer = setTimeout(() => { notice.hidden = true; }, 12000);
}
if (typeof window !== 'undefined') { window.updateWarningsUI = updateWarningsUI; window.lastWarnings = lastWarnings; }

// ---- six-key (Perkins) braille input ----
// S D F = dots 3 2 1 (left hand), J K L = dots 4 5 6 (right hand), chorded like a
// Perkins brailler. Directly inserts Unicode Braille cells (U+2800..U+28FF) into the
// document without back-translating, preserving the exact typed dot patterns.
const SK_DOT = { KeyF: 0x01, KeyD: 0x02, KeyS: 0x04, KeyJ: 0x08, KeyK: 0x10, KeyL: 0x20 };
let sixKeyOn = false;
let skChord = 0;                 // dots accumulated in the in-progress chord
const skHeld = new Set();        // physical keys currently down in this chord
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// A list is numbered when the model says so or any item carries a marker
// (buildModel puts numbering in item.marker; b.ordered is never set there).
function isOrderedList(b) {
  return !!(b && (b.ordered || (b.items || []).some((it) => it && it.marker)));
}

// Untrusted SVG (imported .html/.epub/.svg, or handed over from Quick Mode) is rendered
// with innerHTML for the graphic preview and written into the HTML export. Strip every
// vector for script: <script>, <foreignObject> (arbitrary HTML), on* handlers, and any
// href that is not a same-document fragment (javascript:, data:, remote). Returns the
// serialised <svg> or '' when the markup is not an SVG at all.
//
// S1 audit #23 (15 Oct 2026, Paul's decision F2): the SVG is put inline, so a <style> in it was a stylesheet for the WHOLE page
// (`body{--x:1}`, `*{display:none}`), and a url() in a rule, a style attribute or a presentation attribute was a request the
// graphic could make. Now:
//  - every rule of an embedded <style> is scoped to this graphic (its root carries a unique data-gscope), so it can colour the
//    drawing and nothing else; at-rules (@import, @font-face, @media, @keyframes …) are dropped, a rule whose selector holds a backslash
//    or a brace is dropped, and only SVG painting/text properties (and --custom ones) survive, in <style> and in style="…";
//  - a url() anywhere (rule, style attribute, presentation attribute such as fill/filter/mask) may name only a fragment of the
//    same document (url(#g)); a declaration or attribute with any other url(), or an image-set(), expression() or image(),
//    is removed;
//  - an animation that sets an href is removed.
const SVG_CSS_PROPS = new Set(['alignment-baseline', 'baseline-shift', 'clip', 'clip-path', 'clip-rule', 'color', 'color-interpolation', 'color-interpolation-filters', 'color-rendering', 'direction', 'display', 'dominant-baseline', 'fill', 'fill-opacity', 'fill-rule', 'filter', 'flood-color', 'flood-opacity', 'font', 'font-family', 'font-kerning', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-variant', 'font-weight', 'image-rendering', 'isolation', 'letter-spacing', 'lighting-color', 'marker', 'marker-end', 'marker-mid', 'marker-start', 'mask', 'mix-blend-mode', 'opacity', 'paint-order', 'shape-rendering', 'stop-color', 'stop-opacity', 'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'text-anchor', 'text-decoration', 'text-rendering', 'transform', 'transform-box', 'transform-origin', 'unicode-bidi', 'vector-effect', 'visibility', 'white-space', 'word-spacing', 'writing-mode']);
let svgScopeSeq = 0;
// One CSS declaration is kept when its property is allowed and every url() in its value is a bare same-document fragment.
function svgDeclOk(prop, value) {
  prop = prop.trim().toLowerCase();
  if (!(SVG_CSS_PROPS.has(prop) || /^--[\w-]+$/.test(prop))) return false;
  return svgValueOk(value);
}
function svgValueOk(value) {
  const v = String(value);
  if (/[\\]|expression\s*\(|image-set\s*\(|image\s*\(|-moz-binding|behavior\s*:|javascript:|@import|<|>/i.test(v)) return false;
  const re = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
  let m; let count = 0;
  while ((m = re.exec(v))) { count++; const arg = (m[1] ?? m[2] ?? m[3] ?? '').trim(); if (!/^#[\w.:-]+$/.test(arg)) return false; }
  if ((v.match(/url\s*\(/gi) || []).length !== count) return false;   // a url( the pattern could not read
  return true;
}
function svgCleanStyleAttr(text) {
  return String(text).split(';').map((d) => {
    const i = d.indexOf(':'); if (i < 0) return '';
    const prop = d.slice(0, i); const val = d.slice(i + 1);
    return svgDeclOk(prop, val) ? `${prop.trim()}:${val.trim()}` : '';
  }).filter(Boolean).join(';');
}
// The selectors of one rule, each turned into "descendant of this graphic"; `svg`/`:root` mean the graphic's own root.
function svgScopeSelectors(sel, scope) {
  const root = `svg[data-gscope="${scope}"]`;
  const out = [];
  for (let one of sel.split(',')) {
    one = one.trim();
    if (!one || /[\\{};@]|\/\*/.test(one)) return [];                    // an escape, brace or at-sign: not a selector we trust
    if (/^(?:html|body)\b/i.test(one)) continue;                        // cannot match inside the graphic
    if (/^:root\b/i.test(one)) { out.push(root + one.slice(5)); continue; }
    if (/^svg(?![\w-])/i.test(one)) { out.push(root + one.slice(3)); out.push(`${root} ${one}`); continue; }
    out.push(`${root} ${one}`);
  }
  return out;
}
function svgScopeCss(css, scope) {
  css = String(css).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    if (css[i] === '@') {                                               // an at-rule: skip it whole (to its ; or its balanced block)
      let depth = 0; let j = i;
      for (; j < css.length; j++) { const c = css[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth <= 0) { j++; break; } } else if (c === ';' && depth === 0) { j++; break; } }
      i = j; continue;
    }
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const close = css.indexOf('}', open);
    const selector = css.slice(i, open);
    const body = close < 0 ? css.slice(open + 1) : css.slice(open + 1, close);
    i = close < 0 ? css.length : close + 1;
    if (body.includes('{')) { continue; }                               // nested block (not valid here): drop it
    const sels = svgScopeSelectors(selector, scope);
    if (!sels.length) continue;
    const decls = svgCleanStyleAttr(body);
    if (decls) out.push(`${sels.join(', ')} { ${decls} }`);
  }
  return out.join('\n');
}
function sanitizeSvgMarkup(svg) {
  if (!svg || typeof svg !== 'string') return '';
  let doc;
  try { doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); } catch { return ''; }
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror' || root.localName !== 'svg') return '';
  for (const el of Array.from(root.querySelectorAll('script, foreignObject, iframe, object, embed, link, meta'))) el.remove();
  for (const el of Array.from(root.querySelectorAll('set, animate'))) {
    if (/href/i.test(el.getAttribute('attributeName') || '')) el.remove();
  }
  const scope = `g${++svgScopeSeq}x${Math.random().toString(36).slice(2, 8)}`;
  root.setAttribute('data-gscope', scope);
  const walk = (el) => {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      const val = a.value.trim();
      if (name.startsWith('on')) { el.removeAttribute(a.name); continue; }
      if (name === 'data-gscope' && el !== root) { el.removeAttribute(a.name); continue; }
      if ((name === 'href' || name === 'xlink:href' || name.endsWith(':href')) && !val.startsWith('#')) { el.removeAttribute(a.name); continue; }
      if (/javascript:|data:text\/html/i.test(val)) { el.removeAttribute(a.name); continue; }
      if (name === 'style') { const c = svgCleanStyleAttr(val); if (c) el.setAttribute(a.name, c); else el.removeAttribute(a.name); continue; }
      if (/url\s*\(|image-set\s*\(|expression\s*\(/i.test(val) && !svgValueOk(val)) el.removeAttribute(a.name);
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(root);
  for (const st of Array.from(root.querySelectorAll('style'))) {
    const css = svgScopeCss(st.textContent || '', scope);
    if (css) { st.textContent = css; st.removeAttribute('media'); st.removeAttribute('type'); st.removeAttribute('src'); } else st.remove();
  }
  return new XMLSerializer().serializeToString(root);
}

function skInsert(text) { editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) s.insertText(text); }); }
function skParagraph() { editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) s.insertParagraph(); }); }
function skDeleteBack() { editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) s.deleteCharacter(true); }); }
function inMathField(e) { return !!(e.target && e.target.closest && e.target.closest('math-field')); }
function skKeydown(e) {
  if (!sixKeyOn || e.ctrlKey || e.metaKey || e.altKey || inMathField(e)) return;
  const code = e.code;
  // stop() also halts propagation so Lexical's OWN key handlers don't ALSO fire
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (code in SK_DOT) { stop(); noteTyping(); if (e.repeat) return; skHeld.add(code); skChord |= SK_DOT[code]; return; }
  if (code === 'Space')     { stop(); noteTyping(); if (!e.repeat) skInsert(' '); return; }
  if (code === 'Enter')     { stop(); noteTyping(); if (!e.repeat) skParagraph(); return; }
  if (code === 'Backspace') { stop(); noteTyping(); skDeleteBack(); return; }
  if (code === 'Escape')    { stop(); toggleSixKey(false); return; }
  if (e.key && e.key.length === 1) stop();   // block stray letters/digits while brailling
}
function skKeyup(e) {
  if (!sixKeyOn) return;
  const code = e.code; if (!(code in SK_DOT)) return;
  e.preventDefault(); skHeld.delete(code);
  if (skHeld.size === 0 && skChord) {
    const cell = String.fromCodePoint(0x2800 + (skChord & 0x3f));
    noteTyping();
    skInsert(cell);
    skChord = 0;
  }
}
// F9-Q1b (Paul, 9 Oct 2026): the button remembers its last state between visits (the saved setting `sixKeyOn`, off for a new user).
// `restoring` is the start-up call: it only sets the state — no announcement, and the keyboard is not moved.
function toggleSixKey(on, restoring = false) {
  const want = on == null ? !sixKeyOn : on;
  sixKeyOn = want;
  $id('btnSixKey')?.setAttribute('aria-pressed', String(sixKeyOn));
  skHeld.clear(); skChord = 0;
  if (!restoring) { try { settings = saveSettings({ sixKeyOn }); } catch { /* not remembered */ } }
  if (restoring) return;
  if (sixKeyOn) { editorEl.focus(); announce(t('app.sixkey.on')); }
  else announce(t('app.sixkey.off'));
}
// Screen reader mode: braille pane is real cells for a display (see renderBraille),
// and six-key input is hidden + disabled (it fights a display user's own braille input).
// `on` = six-key (S D F / J K L) braille entry is available. Turned off, the button is
// hidden and any active six-key session ends — a braille-display user entering braille on
// their own device does not want the editor grabbing those keys.
function applySixKeyInput(on) {
  const btn = $id('btnSixKey'); if (btn) btn.style.display = on ? '' : 'none';
  if (!on && sixKeyOn) toggleSixKey(false);
}
editorEl.addEventListener('keydown', skKeydown, true);
editorEl.addEventListener('keyup', skKeyup, true);
// If focus leaves the editor mid-chord (Tab, alt-tab, clicking a math-field, an OS
// shortcut), the keyups never arrive — without this the held keys stay "down" forever
// and six-key input silently dies. Reset the chord and commit the in-progress word.
editorEl.addEventListener('focusout', (e) => {
  if (!sixKeyOn) return;
  if (e.relatedTarget && editorEl.contains(e.relatedTarget)) return;   // focus stayed inside the editor → normal
  skHeld.clear(); skChord = 0;
});
$id('btnSixKey')?.addEventListener('click', () => toggleSixKey());

// ---- read aloud (TTS) with karaoke highlight ----
// speakMath: plain spoken text (fallback). mathSpeech: SumIt's engine →
// { spokenText, atomMap, wrappedLatex } so the reader can light up each equation term.
const speakMath = (latex) => { try { return globalThis.MathLive?.convertLatexToSpeakableText?.(latex) || 'equation'; } catch { return 'equation'; } };
const mathSpeech = (latex) => {
  try { if (globalThis.generateMathSpeech) { const r = globalThis.generateMathSpeech(latex); if (r && r.spokenText) return r; } } catch (e) { console.warn('generateMathSpeech:', e); }
  return { spokenText: speakMath(latex), atomMap: [], wrappedLatex: '' };
};
const ttsHi = !!(globalThis.Highlight && globalThis.CSS && CSS.highlights);   // CSS Custom Highlight API

// ---- in-place equation term highlighting during read-aloud ----
// The editable <math-field>'s internal DOM is opaque to reliable per-atom
// highlighting, so we overlay a MathLive render of the SAME equation exactly on
// top of it. convertLatexToMarkup keeps SumIt's eq-atom/eq-grp id classes, and we
// give the overlay MathLive's own compiled CSS — shared from the real field's
// adoptedStyleSheets — so it looks pixel-identical (proper superscripts, fractions,
// roots). A sequential word-boundary counter (SumIt's atomMap + word counter, NOT
// charIndex) lights up each term in place. On stop the overlay is removed and the
// untouched field shows through.
let eqCtrl = null;
let mlSheets = null;                                 // MathLive's compiled stylesheets (shared into the overlay shadow)
let hlSheet = null;                                  // our .speaking-atom / .speaking-group rules
function ensureEqSheets(mf) {
  if (!mlSheets) { try { mlSheets = mf.shadowRoot ? [...mf.shadowRoot.adoptedStyleSheets] : []; } catch { mlSheets = []; } }
  if (!hlSheet && globalThis.CSSStyleSheet) {
    try {
      hlSheet = new CSSStyleSheet();
      hlSheet.replaceSync(
        ':host{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%}' +
        '.eq-atom.speaking-atom{color:inherit;text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:2.5px;text-underline-offset:3px}' +
        '.eq-grp.speaking-group{background:var(--sel);border-radius:3px;box-shadow:0 0 0 1.5px var(--accent)}',
      );
    } catch { hlSheet = null; }
  }
}
function computeWordCharRanges(text) {
  const out = []; if (typeof text !== 'string' || !text) return out;
  const re = /\S+/g; let m; while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}
function startEqOverlay(item) {
  clearEqOverlay();                                   // defensive: never leave a previous overlay/hidden field behind
  const pe = printUnitEl(item.blockIdx, item.unit || 0) || editorEl.querySelector(`[data-block-idx="${item.blockIdx}"]`);
  const mf = (pe ? pe.querySelectorAll('math-field') : editorEl.querySelectorAll(`[data-block-idx="${item.blockIdx}"] math-field`))[item.mathIndex || 0];
  if (!mf || !item.wrappedLatex || !globalThis.MathLive?.convertLatexToMarkup) return;
  const embed = mf.closest('.math-embed') || mf.parentElement;
  if (!embed) return;
  ensureEqSheets(mf);
  // Without MathLive's own compiled CSS the overlay would render as a degraded
  // baseline equation — so if we couldn't borrow it, skip the overlay entirely and
  // just mark the equation being read (it is still spoken). No ugly fallback.
  if (!mlSheets || !mlSheets.length) { embed.classList.add('math-speaking'); return; }
  let markup; try { markup = globalThis.MathLive.convertLatexToMarkup(item.wrappedLatex); } catch { return; }
  const ovl = document.createElement('span');
  ovl.className = 'eq-inplace-ovl';
  ovl.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;font-size:${getComputedStyle(mf).fontSize};pointer-events:none;z-index:2`;
  const sh = ovl.attachShadow({ mode: 'open' });
  try { sh.adoptedStyleSheets = [...(mlSheets || []), ...(hlSheet ? [hlSheet] : [])]; } catch { /* overlay still renders, just unstyled */ }
  const box = document.createElement('span'); box.className = 'ML__latex'; box.innerHTML = markup;
  sh.appendChild(box);
  const prevPos = embed.style.position;
  if (getComputedStyle(embed).position === 'static') embed.style.position = 'relative';
  embed.appendChild(ovl);
  mf.style.visibility = 'hidden';                    // hide the real glyphs+keyboard icon; the overlay looks identical
  embed.classList.add('math-speaking');              // subtle ring marks the equation currently being read
  eqCtrl = { root: sh, mf, embed, ovl, prevPos, atomMap: item.atomMap || [], wordRanges: computeWordCharRanges(item.text || ''), wordIdx: 0, activeGroups: new Set(), activeAtom: null };
}
function eqOverlayBoundary() {                        // one increment per word boundary (NOT charIndex — SumIt's lesson)
  if (!eqCtrl) return;
  const range = eqCtrl.wordRanges[eqCtrl.wordIdx++]; if (!range) return;
  const [wStart, wEnd] = range;
  const containing = eqCtrl.atomMap.filter((e) => e.start <= wStart && e.end >= wEnd);
  if (!containing.length) return;                    // a prosody word with no atom → keep the current highlight
  let bestAtom = null;
  for (const e of containing) { if (e.kind !== 'atom') continue; if (!bestAtom || (e.end - e.start) < (bestAtom.end - bestAtom.start)) bestAtom = e; }
  const groupIds = new Set(containing.filter((e) => e.kind === 'group').map((e) => e.id));
  const wantAtom = bestAtom ? bestAtom.id : null;
  const root = eqCtrl.root;
  if (wantAtom !== eqCtrl.activeAtom) {
    root.querySelectorAll('.speaking-atom').forEach((el) => el.classList.remove('speaking-atom'));
    if (wantAtom) root.querySelector('.' + wantAtom)?.classList.add('speaking-atom');
    eqCtrl.activeAtom = wantAtom;
  }
  for (const id of eqCtrl.activeGroups) if (!groupIds.has(id)) root.querySelector('.' + id)?.classList.remove('speaking-group');
  for (const id of groupIds) if (!eqCtrl.activeGroups.has(id)) root.querySelector('.' + id)?.classList.add('speaking-group');
  eqCtrl.activeGroups = groupIds;
}
function clearEqOverlay() {
  if (eqCtrl) {
    try { eqCtrl.mf.style.visibility = ''; } catch { /* */ }
    try { eqCtrl.embed.classList.remove('math-speaking'); if (eqCtrl.prevPos !== undefined) eqCtrl.embed.style.position = eqCtrl.prevPos; } catch { /* */ }
    try { eqCtrl.ovl.remove(); } catch { /* */ }
  }
  eqCtrl = null;
}
function clearReading() {
  editorEl.querySelectorAll('.print-reading').forEach((e) => e.classList.remove('print-reading'));
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.setReadingBlock(null);
  } else {
    brailleEl.querySelectorAll('.brl-reading').forEach((r) => r.classList.remove('brl-reading'));
  }
  brailleEl.querySelectorAll('.cell-speaking').forEach((c) => c.classList.remove('cell-speaking'));
  editorEl.querySelectorAll('.math-speaking').forEach((e) => e.classList.remove('math-speaking'));
  clearEqOverlay();
  if (ttsHi) delHl('tts-word');
}
function clearSpokenWord() {
  brailleEl.querySelectorAll('.bcell.cell-speaking').forEach((c) => c.classList.remove('cell-speaking'));
  editorEl.querySelectorAll('.math-speaking').forEach((e) => e.classList.remove('math-speaking'));
  if (ttsHi) delHl('tts-word');
}
let readingBlock = 0, readingKey = null;              // the block currently being read (for stop→caret); key survives re-index
const reader = new Reader({
  onBlock: (item) => {
    readingBlock = item.blockIdx;
    readingKey = lastKeys[item.blockIdx] || null;     // Lexical node key is stable even if block indices shift mid-read
    clearReading();
    const target = printUnitEl(item.blockIdx, item.unit || 0);      // the block, or the specific <li> for a list
    if (target) { target.classList.add('print-reading'); target.scrollIntoView({ block: 'nearest' }); }
    if (brailleEl._virtualBraille?.isVirtualized()) {
      brailleEl._virtualBraille.setReadingBlock(item.blockIdx);
    } else {
      brailleEl.querySelectorAll(`.brl-row[data-block="${item.blockIdx}"]`).forEach((r) => r.classList.add('brl-reading'));
    }
    if (item.kind === 'math') startEqOverlay(item);    // in-place term highlighting over the real equation
  },
  onBoundary: (item, charIndex, len) => {
    if (item.kind === 'math') { eqOverlayBoundary(); return; }      // equation term karaoke
    clearSpokenWord();
    if (!item.map || !item.map.length) return;
    const unit = item.unit || 0;
    const wend = charIndex + (len || (((item.text || '').slice(charIndex).match(/^\S+/) || [''])[0].length) || 1);
    // spoken word → source flat-char range (text) and/or maths
    let fs = Infinity, fe = -1, isMath = false;
    for (let i = charIndex; i < wend && i < item.map.length; i++) {
      const f = item.map[i];
      if (f >= 0) { if (f < fs) fs = f; if (f + 1 > fe) fe = f + 1; }
      else if (item.text[i] && !/\s/.test(item.text[i])) isMath = true;
    }
    if (fe > fs) {                                     // a text word: underline print + red braille (unit-aware)
      const pe = printUnitEl(item.blockIdx, unit);
      if (pe && ttsHi) { const r = charRangeInEl(pe, fs, fe, cellText[`${item.blockIdx}:${unit}`]); if (r) setHl('tts-word', new Highlight(r)); }
      const rows = brailleEl.querySelectorAll(`.brl-row[data-block="${item.blockIdx}"]`);
      rows.forEach(expandRowCells);
      rows.forEach((r) => {
        r.querySelectorAll('.bcell[data-char]').forEach((c) => {
          if (Number(c.dataset.unit) !== unit) return;
          const n = +c.dataset.char; if (n >= fs && n < fe) c.classList.add('cell-speaking');
        });
      });
    } else if (isMath) {                               // a maths word ("pie", "squared"…): flag the equation
      editorEl.querySelector(`[data-block-idx="${item.blockIdx}"] math-field`)?.classList.add('math-speaking');
    }
  },
  onEnd: () => { clearReading(); updateReadButtons(); },
  onStuck: () => { announce(t('app.tts.stuck')); setStatus(t('app.tts.stuck_status')); },
});
// play / pause / resume + stop, with the play arrow, pause bars, and a stop square
function updateReadButtons() {                       // one button: play (from caret) ⇄ stop
  const r = $id('btnRead'); if (!r) return;
  if (reader.speaking) {
    r.innerHTML = `${iconSvg('square', 'icon icon-inline')} <span class="btn-lbl" data-i18n="toolbar.stop_reading">${t('toolbar.stop_reading') || 'Stop'}</span>`;
    r.setAttribute('aria-pressed', 'true');
    r.title = t('toolbar.stop_reading') || 'Stop reading';
  } else {
    r.innerHTML = `${iconSvg('play', 'icon icon-inline')} <span class="btn-lbl" data-i18n="toolbar.read_aloud">${t('toolbar.read_aloud') || 'Read'}</span>`;
    r.setAttribute('aria-pressed', 'false');
    r.title = t('toolbar.read_aloud') || 'Read aloud, starting at the caret';
  }
}
// Where Play starts: the caret's block, its unit (list item), AND its char offset
// in that unit's flat text — so reading begins at the clicked WORD, not the line.
function caretPos() {
  const pos = { block: 0, unit: 0, offset: 0 };
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const anchor = sel.anchor;
    const anchorNode = anchor.getNode();
    const top = anchorNode.getTopLevelElement();
    if (!top) return;
    const bi = lastKeys.indexOf(top.getKey());
    pos.block = bi < 0 ? 0 : bi;
    let container = top, unit = 0;
    if ($isListNode(top)) {                            // which list item (counting only non-empty ones, as buildModel does)
      let li = anchorNode;
      while (li && li.getParent && li.getParent().getKey() !== top.getKey()) li = li.getParent();
      if (li) {
        let cnt = 0;
        for (const k of top.getChildren()) {
          if (k.getKey() === li.getKey()) { unit = cnt; container = k; break; }
          if (k.getTextContent().replace(/\s+/g, ' ').trim()) cnt++;
        }
      }
    }
    pos.unit = unit;
    const leaves = container.getAllTextNodes ? container.getAllTextNodes() : [];
    let raw = '', found = false;
    for (const n of leaves) {
      if (n.getKey() === anchorNode.getKey()) { raw += (n.getTextContent() || '').slice(0, anchor.offset); found = true; break; }
      raw += n.getTextContent() || '';
    }
    pos.offset = found ? raw.replace(/\s+/g, ' ').length : 0;     // fall back to line start if the caret isn't in a text leaf
  });
  return pos;
}
function moveCaretToKey(key) {                      // so the next Play resumes from where we stopped
  if (key == null) return;
  editor.update(() => { const n = $getNodeByKey(key); if (n && n.selectStart) n.selectStart(); });
}
function startReading(fromBlock) {
  if (!speechAvailable()) { announce(t('app.tts.unavailable')); return; }
  const model = editor.getEditorState().read(buildModel);
  const all = buildSpokenItems(model, mathSpeech);
  // Play (no arg) → from the caret word; double-click a braille line → from that block.
  const pos = (fromBlock != null) ? { block: fromBlock, unit: 0, offset: 0 } : caretPos();
  let items = sliceItemsFrom(all, pos);
  // Caret past the last word (nothing after it) → read its block from the start, so Play
  // always does something instead of announcing "Nothing to read".
  if (!items.length && all.length) items = sliceItemsFrom(all, { block: pos.block, unit: 0, offset: 0 });
  if (!items.length) { announce(t('app.tts.nothing')); return; }
  reader.rate = Number(settings.ttsRate) || 1;
  reader.voice = pickVoice(settings.ttsVoice);
  announce(t('app.tts.reading'));
  reader.speak(items);
  updateReadButtons();
}
function onReadClick() {
  if (reader.speaking) { moveCaretToKey(readingKey); reader.stop(); return; }   // stop → caret at the read position
  startReading();
}
$id('btnRead')?.addEventListener('click', onReadClick);
// double-click a braille line → read from that block
brailleEl.addEventListener('dblclick', (e) => { const row = e.target.closest('.brl-row[data-block]'); if (row) startReading(Number(row.dataset.block)); });
editorEl.addEventListener('beforeinput', () => { if (reader.speaking) reader.stop(); });   // editing stops the read (indices shift)

// ---- reading voice + speed (persisted) ----
const NOVELTY_VOICES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
  'deranged', 'fred', 'good news', 'hysterical', 'jester', 'junior', 'kathy',
  'organ', 'pipe organ', 'ralph', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox',
]);

function isNoveltyVoice(v) {
  const name = (v.name || '').toLowerCase();
  for (const n of NOVELTY_VOICES) {
    if (name.startsWith(n) && !/[a-z0-9]/.test(name[n.length] || '')) return true;
  }
  return false;
}

let voicesExpanded = false;
let noveltyExpanded = false;

function pickVoice(name) {
  if (!speechAvailable()) return null;
  const voices = speechSynthesis.getVoices() || [];
  return voices.find((v) => v.name === name || v.voiceURI === name) || voices.find((v) => /en[-_]/i.test(v.lang)) || voices[0] || null;
}

function populateVoices() {
  const sel = $id('set-voice'); if (!sel || !speechAvailable()) return;
  const allVoices = speechSynthesis.getVoices() || [];
  if (!allVoices.length) return;                       // fires again on voiceschanged
  sel.innerHTML = '';
  const loc = (navigator.language || 'en').split('-');
  const lang = (loc[0] || 'en').toLowerCase();
  const rank = (v) => {
    const vl = (v.lang || '').split(/[-_]/)[0].toLowerCase();
    return vl === lang ? 0 : (vl === 'en' ? 1 : 2);
  };
  const novelty = allVoices.filter(isNoveltyVoice);
  const ordinary = allVoices.filter((v) => !isNoveltyVoice(v));
  const isKept = (v) => rank(v) < 2;
  const keep = ordinary.filter(isKept);
  const baseKeep = keep.length ? keep : ordinary;
  const restVoices = keep.length ? ordinary.filter((v) => !isKept(v)) : [];

  const shown = baseKeep.slice();
  if (voicesExpanded) shown.push(...restVoices);
  if (noveltyExpanded) shown.push(...novelty);
  shown.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  shown.forEach((v) => {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})${v.default ? ` — ${t('app.tts.default_voice')}` : ''}`;
    sel.appendChild(o);
  });

  if (!voicesExpanded && restVoices.length) {
    const o = document.createElement('option'); o.value = '__more_voices__'; o.textContent = t('app.tts.more_voices', { count: restVoices.length }); sel.appendChild(o);
  }
  if (!noveltyExpanded && novelty.length) {
    const o = document.createElement('option'); o.value = '__novelty_voices__'; o.textContent = t('app.tts.novelty_voices', { count: novelty.length }); sel.appendChild(o);
  }

  const chosen = pickVoice(settings.ttsVoice); if (chosen) sel.value = chosen.name;
}

function wireReadingControls() {
  const rate = $id('set-rate'), rv = $id('rateVal'), voice = $id('set-voice');
  if (rate) { rate.value = settings.ttsRate || 1; if (rv) rv.textContent = `${Number(rate.value).toFixed(1)}×`;
    rate.addEventListener('input', () => { if (rv) rv.textContent = `${Number(rate.value).toFixed(1)}×`; settings = saveSettings({ ttsRate: Number(rate.value) }); reader.rate = Number(rate.value); }); }
  if (voice) voice.addEventListener('change', () => {
    if (voice.value === '__more_voices__') {
      voicesExpanded = true; populateVoices(); return;
    }
    if (voice.value === '__novelty_voices__') {
      noveltyExpanded = true; populateVoices(); return;
    }
    settings = saveSettings({ ttsVoice: voice.value }); reader.voice = pickVoice(voice.value);
  });
  populateVoices();
  if (speechAvailable()) speechSynthesis.addEventListener?.('voiceschanged', populateVoices);
}

// highlight the Maths button (accent blue) while the caret is inside a math-field
// — the "maths mode on" indicator. Document-level so it catches focus into any
// equation regardless of when it was mounted (math-field uses a shadow DOM).
document.addEventListener('focusin', (e) => {
  const inMath = !!(e.target && e.target.closest && e.target.closest('math-field'));
  $id('btnMath').setAttribute('aria-pressed', String(inMath));
});

// ---- keyboard shortcuts (every action is also reachable via Tab + arrow keys) ----
// ⌘/Ctrl+B/I/U handled by Lexical rich-text. These add the custom actions; each
// button also carries aria-keyshortcuts and the set is listed in Help.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (document.querySelector('dialog[open]')) return;              // don't fire while a dialog is up
  const k = (e.key || '').toLowerCase();
  const go = (id) => { e.preventDefault(); $id(id)?.click(); };
  if (!e.shiftKey && k === 'e') return go('btnMath');              // insert equation
  if (e.shiftKey && k === 'k') return go('btnSixKey');             // six-key braille input
  if (e.shiftKey && (e.code === 'Space' || k === ' ')) return go('btnRead');   // read aloud / stop
  if (e.shiftKey && (k === '=' || k === '+')) return go('brlLarger');          // braille bigger
  if (e.shiftKey && (k === '-' || k === '_')) return go('brlSmaller');         // braille smaller
  if (e.shiftKey && k === 'd') { e.preventDefault(); describeCaretWord(); }    // describe braille at the caret
});

// ---- ARIA toolbar: roving tabindex + Left/Right navigation ----
// WAI-ARIA toolbar pattern: exactly one control is in the Tab sequence (tabindex=0), the
// rest are tabindex=-1; Left/Right move focus (wrapping), Home/End jump to the ends, and
// the last-focused control stays the Tab stop so Shift+Tab/Tab returns to where you were.
// Disabled or hidden controls (Undo at start-up, Six-key when off) are skipped and never
// left as the Tab stop, otherwise the whole toolbar would be unreachable from the keyboard.
function initToolbar() {
  const toolbar = $id('toolbar');
  if (!toolbar) { initResponsiveTextToolbar(); return; }
  // Every focusable control in the toolbar shares the single Tab stop (WAI-ARIA toolbar
  // pattern) — not only the [data-tb] formatting buttons, or the Insert/Table/Style
  // controls stay as eight separate stops between the header and the editor.
  const allItems = () => [...toolbar.querySelectorAll('button, select, input, [data-tb]')];
  const usable = (el) => !el.disabled && !el.hidden && el.getAttribute('aria-hidden') !== 'true' &&
    !(el.offsetParent === null && getComputedStyle(el).position !== 'fixed');
  const items = () => allItems().filter(usable);
  let current = null;                                  // the control that owns tabindex=0
  const setCurrent = (el) => {
    current = el;
    allItems().forEach((it) => { const v = it === el ? 0 : -1; if (it.tabIndex !== v) it.tabIndex = v; });
  };
  const ensureTabStop = () => {
    const list = items();
    if (!list.length) return;
    if (current && list.includes(current)) { setCurrent(current); return; }
    setCurrent(list[0]);
  };
  ensureTabStop();
  // Focus by mouse or programmatically (e.g. the Insert button after a dialog) also
  // "remembers" that control as the Tab stop.
  toolbar.addEventListener('focusin', (e) => {
    const el = e.target.closest ? e.target.closest('button, select, input, [data-tb]') : null;
    if (el && toolbar.contains(el) && el !== current) setCurrent(el);
  });
  toolbar.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
    const active = document.activeElement;
    const el = active && active.closest ? active.closest('button, select, input, [data-tb]') : null;
    if (!el || !toolbar.contains(el)) return;
    if (el.tagName === 'SELECT' && (k === 'ArrowLeft' || k === 'ArrowRight')) return;   // leave value cycling to the select
    const list = items();
    if (!list.length) return;
    const cur = Math.max(0, list.indexOf(el));
    let next;
    if (k === 'Home') next = 0;
    else if (k === 'End') next = list.length - 1;
    else next = (cur + (k === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    e.preventDefault();
    setCurrent(list[next]);
    list[next].focus();
  });
  // Keep a valid Tab stop when controls are enabled/disabled or shown/hidden later.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(ensureTabStop).observe(toolbar, {
      subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'aria-hidden', 'style', 'class'],
    });
  }
  initResponsiveTextToolbar();
}

// ---- Responsive Text Toolbar & Style Select labels ----
function initResponsiveTextToolbar() {
  const header = $id('editorHeader');
  const pane = header?.closest('.pane-editor');
  const selectEl = $id('blockStyle');
  if (!header || !selectEl) return;

  let currentMode = 'full';

  function updateSelectLabels(mode, force = false) {
    if (mode === currentMode && !force) return;
    currentMode = mode;
    refreshBlockStyleLabels(mode);      // labels come from BLOCK_STYLES, the registry shared with the slash menu
  }

  window.addEventListener('i18n:localechange', () => {
    updateSelectLabels(currentMode, true);
  });

  // Largest layout whose controls fit on one row: full size, then smaller buttons ('tight', keeps the TEXT label and the
  // full style names), then compact, then ultra-compact. Only if even that does not fit does the toolbar wrap (Paul,
  // 24 Sep). Measured with transitions off, so the result depends on the width alone and cannot flip back and forth.
  const MODES = [['full', null, 'full'], ['tight', 'pane-tight', 'full'], ['short', 'pane-compact', 'short'], ['mini', 'pane-ultra-compact', 'mini']];
  const toolbarEl = header?.querySelector('.toolbar');
  function applyMode([, cls, labels]) {
    for (const [, c] of MODES) if (c) pane?.classList.toggle(c, c === cls);
    updateSelectLabels(labels);
  }
  function wraps() {
    const kids = [...(toolbarEl?.children || [])].filter((el) => el.offsetParent !== null && getComputedStyle(el).position !== 'absolute' && el.getBoundingClientRect().width > 0);
    if (kids.length < 2) return false;
    const top = kids[0].getBoundingClientRect().top;
    return kids.some((el) => el.getBoundingClientRect().top > top + 4);
  }
  function checkDimensions() {
    header.classList.add('tb-measure');
    // Below 540 / 390 px the pane's container queries already apply the compact sizes, so start there.
    const pw = (pane || header).getBoundingClientRect().width;
    let i = pw < 390 ? 3 : pw < 540 ? 2 : 0;
    applyMode(MODES[i]);
    while (i < MODES.length - 1 && wraps()) applyMode(MODES[++i]);
    header.classList.remove('tb-measure');
  }

  let rafId = null;
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = -1;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[entries.length - 1].contentRect.width);
      if (w === lastW) return;                     // a height change (the toolbar wrapping) is not a reason to re-measure
      lastW = w;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => checkDimensions());
    });
    ro.observe(header);
  } else {
    window.addEventListener('resize', () => checkDimensions());
  }
  // Buttons shown or hidden later (Transcriber tools, the notes / symbols buttons) and the interface language change
  // the toolbar's width too.
  if (typeof MutationObserver !== 'undefined' && toolbarEl) {
    let queued = false;
    const recheck = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; checkDimensions(); }); };
    new MutationObserver(recheck).observe(toolbarEl, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(recheck).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('i18n:localechange', recheck);
  }
  checkDimensions();
}

// ---- Slash command popover menu for keyboard & screen reader accessibility ----
function setBlockStyle(val) {
  const norm = (val === 'ul') ? 'bullet' : (val === 'ol') ? 'number' : (val || 'p');
  if ($id('blockStyle')) syncStyleOptionVisibility(norm);
  applyBlockStyle(norm);
}

function setSetting(id, val) {
  const el = $id(id);
  if (el) {
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function insertTextAtCaret(text) {
  if (typeof text !== 'string') return;
  try {
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        sel.insertText(text);
      } else {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createTextNode(text));
        root.append(p);
      }
    });
  } catch (e) {
    console.warn('insertTextAtCaret recovery:', e);
  }
  editor.focus();
}

const FORMULA_TEMPLATES = [
  {
    id: 'frac',
    title: 'Fraction',
    desc: 'Numerator over denominator',
    speech: 'Fraction template: numerator over denominator. Use Tab to move between fields.',
    latex: '\\frac{\\placeholder{a}}{\\placeholder{b}}',
    keywords: ['frac', 'fraction', 'division', 'ratio', 'over'],
    icon: '½'
  },
  {
    id: 'sqrt',
    title: 'Square Root',
    desc: 'Radical of expression',
    speech: 'Square root of placeholder. Use Tab to edit.',
    latex: '\\sqrt{\\placeholder{x}}',
    keywords: ['sqrt', 'square root', 'root', 'radical'],
    icon: '√'
  },
  {
    id: 'nroot',
    title: 'n-th Root',
    desc: 'Root with custom index',
    speech: 'n-th root: index n of placeholder.',
    latex: '\\sqrt[\\placeholder{n}]{\\placeholder{x}}',
    keywords: ['nroot', 'root', 'radical', 'cube root'],
    icon: '∛'
  },
  {
    id: 'quad',
    title: 'Quadratic Formula',
    desc: 'x = (-b ± √(b² - 4ac)) / 2a',
    speech: 'Quadratic Formula: x equals fraction, negative b plus or minus square root of b squared minus 4 a c, all over 2 a.',
    latex: 'x = \\frac{-\\placeholder{b} \\pm \\sqrt{\\placeholder{b}^2 - 4\\placeholder{a}\\placeholder{c}}}{2\\placeholder{a}}',
    keywords: ['quad', 'quadratic', 'algebra', 'roots', 'polynomial'],
    icon: 'x='
  },
  {
    id: 'matrix2',
    title: '2×2 Matrix',
    desc: 'Two by two bracketed matrix',
    speech: 'Two by two Matrix: row 1, a, b; row 2, c, d.',
    latex: '\\begin{pmatrix} \\placeholder{a} & \\placeholder{b} \\\\ \\placeholder{c} & \\placeholder{d} \\end{pmatrix}',
    keywords: ['matrix', 'matrix2', 'linear algebra', 'array', 'grid'],
    icon: '⊞'
  },
  {
    id: 'matrix3',
    title: '3×3 Matrix',
    desc: 'Three by three bracketed matrix',
    speech: 'Three by three Matrix: 3 rows and 3 columns.',
    latex: '\\begin{pmatrix} \\placeholder{a} & \\placeholder{b} & \\placeholder{c} \\\\ \\placeholder{d} & \\placeholder{e} & \\placeholder{f} \\\\ \\placeholder{g} & \\placeholder{h} & \\placeholder{i} \\end{pmatrix}',
    keywords: ['matrix3', 'matrix', '3x3', 'linear algebra', 'array'],
    icon: '▦'
  },
  {
    id: 'vector',
    title: 'Column Vector',
    desc: 'Two-element vertical column vector',
    speech: 'Column Vector: vertical vector with elements x and y.',
    latex: '\\begin{pmatrix} \\placeholder{x} \\\\ \\placeholder{y} \\end{pmatrix}',
    keywords: ['vector', 'column', 'matrix', 'linear algebra'],
    icon: 'v⃗'
  },
  {
    id: 'determ',
    title: 'Determinant',
    desc: '2×2 matrix determinant',
    speech: 'Determinant of 2 by 2 matrix: vertical bars a, b; c, d.',
    latex: '\\begin{vmatrix} \\placeholder{a} & \\placeholder{b} \\\\ \\placeholder{c} & \\placeholder{d} \\end{vmatrix}',
    keywords: ['determ', 'determinant', 'matrix', 'modulus'],
    icon: '|A|'
  },
  {
    id: 'table_func',
    title: 'Function Value Table (Maths)',
    desc: 'Two-column x vs f(x) vertical data table',
    speech: 'Function value table: header x and f of x, followed by data rows.',
    latex: '\\begin{array}{c|c} \\placeholder{x} & \\placeholder{f(x)} \\\\ \\hline \\placeholder{0} & \\placeholder{1} \\\\ \\placeholder{1} & \\placeholder{2} \\end{array}',
    keywords: ['table', 'function table', 'data table', 'values', 'array'],
    icon: '⊞'
  },
  {
    id: 'table_grid',
    title: 'Document Data Table (Print & Braille)',
    desc: 'Standard markdown data table formatted for UKAAF/BANA',
    speech: 'Document data table: 3 columns with header and rows.',
    isText: true,
    text: '\n| Item | Quantity | Price |\n| --- | --- | --- |\n| Widget A | 10 | $5.00 |\n| Widget B | 25 | $12.50 |\n',
    keywords: ['table', 'data table', 'grid', 'ukaaf table', 'bana table'],
    icon: 'i:table'
  },
  {
    id: 'integral',
    title: 'Definite Integral',
    desc: 'Integral from a to b of f(x) dx',
    speech: 'Definite integral: integral from a to b of f of x d x.',
    latex: '\\int_{\\placeholder{a}}^{\\placeholder{b}} \\placeholder{f(x)}\\, d\\placeholder{x}',
    keywords: ['int', 'integral', 'definite', 'calculus', 'area'],
    icon: '∫'
  },
  {
    id: 'deriv',
    title: 'Derivative',
    desc: 'df/dx differential',
    speech: 'Derivative: d f over d x.',
    latex: '\\frac{d\\placeholder{f}}{d\\placeholder{x}}',
    keywords: ['deriv', 'derivative', 'calculus', 'differential', 'rate'],
    icon: 'd/dx'
  },
  {
    id: 'partial',
    title: 'Partial Derivative',
    desc: '∂f/∂x partial differential',
    speech: 'Partial derivative: partial f over partial x.',
    latex: '\\frac{\\partial \\placeholder{f}}{\\partial \\placeholder{x}}',
    keywords: ['partial', 'derivative', 'calculus', 'gradient'],
    icon: '∂/∂x'
  },
  {
    id: 'limit',
    title: 'Limit',
    desc: 'Limit as x approaches c',
    speech: 'Limit: limit as x approaches c of f of x.',
    latex: '\\lim_{\\placeholder{x} \\to \\placeholder{\\infty}} \\placeholder{f(x)}',
    keywords: ['limit', 'lim', 'calculus', 'asymptotic'],
    icon: 'lim'
  },
  {
    id: 'sum',
    title: 'Summation (Sigma)',
    desc: 'Sum from i=1 to n of x_i',
    speech: 'Summation: sum from i equals 1 to n of x sub i.',
    latex: '\\sum_{\\placeholder{i}=1}^{\\placeholder{n}} \\placeholder{x_i}',
    keywords: ['sum', 'summation', 'sigma', 'series'],
    icon: '∑'
  },
  {
    id: 'pythag',
    title: 'Pythagorean Theorem',
    desc: 'a² + b² = c²',
    speech: 'Pythagorean Theorem: a squared plus b squared equals c squared.',
    latex: '\\placeholder{a}^2 + \\placeholder{b}^2 = \\placeholder{c}^2',
    keywords: ['pythag', 'pythagoras', 'triangle', 'geometry', 'hypotenuse'],
    icon: '⊿'
  },
  {
    id: 'slope',
    title: 'Linear Equation (Slope)',
    desc: 'y = mx + c',
    speech: 'Linear Equation: y equals m x plus c.',
    latex: '\\placeholder{y} = \\placeholder{m}\\placeholder{x} + \\placeholder{c}',
    keywords: ['slope', 'linear', 'line', 'intercept', 'algebra'],
    icon: 'y=mx'
  },
  {
    id: 'circle_area',
    title: 'Circle Area',
    desc: 'A = π r²',
    speech: 'Area of a circle: A equals pi r squared.',
    latex: 'A = \\pi \\placeholder{r}^2',
    keywords: ['circle', 'area', 'pi', 'radius', 'geometry'],
    icon: '◯'
  },
  {
    id: 'emc2',
    title: 'Mass-Energy Equivalence',
    desc: 'E = mc²',
    speech: 'Mass-Energy Equivalence: E equals m c squared.',
    latex: 'E = \\placeholder{m} c^2',
    keywords: ['emc2', 'einstein', 'energy', 'physics', 'mass'],
    icon: 'E=mc²'
  },
  {
    id: 'chem_reaction',
    title: 'Chemical Reaction Arrow',
    desc: 'Reactants → Products',
    speech: 'Chemical Reaction: Reactants yields Products.',
    latex: '\\placeholder{\\text{A}} + \\placeholder{\\text{B}} \\rightarrow \\placeholder{\\text{C}}',
    keywords: ['chem', 'chemistry', 'reaction', 'arrow', 'reactants'],
    icon: '→'
  }
];

function getFormulaSpeech(item) {
  if (!item) return '';
  if (item.speech) return item.speech;
  if (typeof window.generateMathSpeech === 'function' && item.latex) {
    try {
      const res = window.generateMathSpeech(item.latex);
      if (res && res.spokenText) return res.spokenText;
    } catch (_) {}
  }
  if (item.notes) return item.notes;
  return item.name || '';
}

function openFormulaDialog() {
  const dlg = $id('formulaDialog');
  if (!dlg) return;
  if (typeof window.renderFormulaList !== 'function') {
    initFormulaDialog();
  }
  
  updateEditorBlockIndex();

  if (!dlg.open) dlg.showModal();
  const searchInput = $id('formulaSearch');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  if (typeof window.renderFormulaList === 'function') {
    window.renderFormulaList('');
  }
  const total = (window.FORMULAS || []).length;
  announce(t('app.formulas.opened', { count: total }));
}

function initFormulaDialog() {
  const dlg = $id('formulaDialog');
  const listEl = $id('formulaList');
  const catsEl = $id('formulaCats');
  const statusEl = $id('formulaStatus');
  const searchInput = $id('formulaSearch');
  const closeBtn = $id('formulaClose');
  if (!dlg || !listEl) return;

  let activeCat = null; // null = "All"
  let filtered = [];

  function renderCategories() {
    if (!catsEl) return;
    catsEl.innerHTML = '';
    const cats = window.FORMULA_CATEGORIES || [
      { id: "algebra",     label: "Algebra" },
      { id: "trig",        label: "Trigonometry" },
      { id: "calculus",    label: "Calculus" },
      { id: "linalg",      label: "Linear Algebra" },
      { id: "geometry",    label: "Geometry" },
      { id: "stats",       label: "Statistics" },
      { id: "discrete",    label: "Discrete & Number" },
      { id: "mechanics",   label: "Mechanics" },
      { id: "em",          label: "Electromagnetism" },
      { id: "thermo",      label: "Thermodynamics" },
      { id: "quantum",     label: "Quantum" },
      { id: "relativity",  label: "Relativity" },
      { id: "optics",      label: "Optics & Waves" },
      { id: "chemistry",   label: "Chemistry" },
      { id: "engineering", label: "Engineering" },
      { id: "constants",   label: "Constants" }
    ];

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'formula-cat-btn' + (activeCat === null ? ' active' : '');
    allBtn.textContent = t('common.all') || 'All';
    allBtn.setAttribute('aria-pressed', String(activeCat === null));
    allBtn.setAttribute('aria-label', `${t('common.all') || 'All'} categories`);
    allBtn.addEventListener('click', () => {
      activeCat = null;
      renderCategories();
      renderList(searchInput ? searchInput.value : '');
    });
    catsEl.appendChild(allBtn);

    for (const c of cats) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = activeCat === c.id;
      btn.className = 'formula-cat-btn' + (isActive ? ' active' : '');
      const catLabel = t(`formulas.cat_${c.id}`) || c.label;
      btn.textContent = catLabel;
      btn.setAttribute('aria-pressed', String(isActive));
      btn.setAttribute('aria-label', t('app.formulas.category_aria', { category: catLabel }));
      btn.addEventListener('click', () => {
        activeCat = c.id;
        renderCategories();
        renderList(searchInput ? searchInput.value : '');
      });
      catsEl.appendChild(btn);
    }
  }

  function matches(f, q) {
    if (!q) return true;
    const hay = `${f.name || ''} ${f.id || ''} ${f.keywords || ''} ${f.notes || ''} ${f.latex || ''} ${f.category || ''}`.toLowerCase();
    return q.split(/\s+/).every(t => hay.includes(t));
  }

  let searchDebounceTimer = null;

  const formulaTemmlCache = new Map();
  const formulaSpeechCache = new Map();
  const BATCH_SIZE = 30;
  let renderedCount = 0;

  function createFormulaElement(item, idx, totalSize) {
    const el = document.createElement('div');
    el.className = 'formula-item';
    el.role = 'option';
    el.id = `formula-opt-${item.id || idx}`;
    el.tabIndex = idx === 0 ? 0 : -1;
    el.setAttribute('aria-selected', String(idx === 0));
    el.setAttribute('aria-posinset', String(idx + 1));
    el.setAttribute('aria-setsize', String(totalSize));

    const catObj = (window.FORMULA_CATEGORIES || []).find(c => c.id === item.category);
    const catLabel = catObj ? catObj.label : (item.category || '');

    // Cached Speech
    let speechText = item.speech || item.notes || item.name || '';
    if (item.speech) {
      speechText = item.speech;
    } else if (formulaSpeechCache.has(item.latex)) {
      speechText = formulaSpeechCache.get(item.latex);
    } else if (typeof window.generateMathSpeech === 'function' && item.latex) {
      try {
        const res = window.generateMathSpeech(item.latex);
        if (res?.spokenText) {
          speechText = res.spokenText;
          formulaSpeechCache.set(item.latex, speechText);
        }
      } catch (_) {}
    }

    el.setAttribute('aria-label', `${item.name}, ${catLabel}. ${speechText}`);
    if (item.notes) el.setAttribute('aria-description', item.notes);

    const meta = document.createElement('div');
    meta.className = 'formula-meta';

    const title = document.createElement('div');
    title.className = 'formula-title';
    title.innerHTML = `<span>${escapeHtml(item.name)}</span> <span class="formula-cat-badge">${escapeHtml(catLabel)}</span>`;
    meta.appendChild(title);

    if (item.notes) {
      const desc = document.createElement('div');
      desc.className = 'formula-desc';
      desc.textContent = item.notes;
      meta.appendChild(desc);
    }

    const preview = document.createElement('div');
    preview.className = 'formula-preview';
    preview.setAttribute('aria-hidden', 'true');

    // Cached Temml Layout
    if (item.latex) {
      if (formulaTemmlCache.has(item.latex)) {
        preview.innerHTML = formulaTemmlCache.get(item.latex);
      } else if (typeof window.temml?.renderToString === 'function') {
        try {
          const rendered = window.temml.renderToString(item.latex, { displayMode: false, throwOnError: false });
          formulaTemmlCache.set(item.latex, rendered);
          preview.innerHTML = rendered;
        } catch {
          preview.textContent = item.latex || '';
        }
      } else {
        preview.textContent = item.latex || '';
      }
    }

    el.appendChild(meta);
    el.appendChild(preview);
    el.addEventListener('click', () => applyFormula(item));
    return el;
  }

  function appendNextBatch() {
    if (renderedCount >= filtered.length) return;
    const batch = filtered.slice(renderedCount, renderedCount + BATCH_SIZE);
    const fragment = document.createDocumentFragment();
    const totalSize = filtered.length;
    batch.forEach((item, offset) => {
      const idx = renderedCount + offset;
      fragment.appendChild(createFormulaElement(item, idx, totalSize));
    });
    listEl.appendChild(fragment);
    renderedCount += batch.length;
  }

  listEl.addEventListener('scroll', () => {
    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 160) {
      appendNextBatch();
    }
  }, { passive: true });

  function renderList(query = '') {
    const q = (query || '').trim().toLowerCase();
    const all = window.FORMULAS || [];
    filtered = all.filter(f =>
      (!activeCat || f.category === activeCat) &&
      matches(f, q)
    );

    listEl.innerHTML = '';
    renderedCount = 0;
    const count = filtered.length;
    const countMsg = count === 0
      ? 'No matching formulas found'
      : `${count} formula${count === 1 ? '' : 's'} available`;

    if (statusEl) {
      statusEl.textContent = countMsg;
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '14px';
      empty.style.color = 'var(--muted)';
      empty.style.fontStyle = 'italic';
      empty.textContent = t('app.formulas.none');
      listEl.appendChild(empty);
      return;
    }

    appendNextBatch();
  }

  window.renderFormulaList = (q) => {
    renderCategories();
    renderList(q);
  };

  function applyFormula(item) {
    if (!item) return;
    dlg.close();
    if (item.latex) {
      insertMathEquation(item.latex, `Inserted ${item.name}.`);
    }
  }

  searchInput?.addEventListener('input', (e) => {
    renderList(e.target.value);
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const count = filtered.length;
      announce(count === 1 ? t('app.formulas.matching_one') : t('app.formulas.matching', { count }));
    }, 450);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const firstItem = listEl.querySelector('.formula-item');
      if (firstItem) {
        firstItem.focus();
        if (filtered[0]) {
          const speech = getFormulaSpeech(filtered[0]);
          announce(t('app.formulas.option', { name: filtered[0].name, speech, n: 1, total: filtered.length }));
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) applyFormula(filtered[0]);
    }
  });

  listEl.addEventListener('keydown', (e) => {
    const items = [...listEl.querySelectorAll('.formula-item')];
    const cur = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (cur + 1) % items.length;
      items[next]?.focus();
      items.forEach((it, i) => {
        it.setAttribute('aria-selected', String(i === next));
        it.tabIndex = i === next ? 0 : -1;
      });
      const curItem = filtered[next];
      if (curItem) {
        const speech = getFormulaSpeech(curItem);
        announce(t('app.formulas.option', { name: curItem.name, speech, n: next + 1, total: items.length }));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (cur - 1 + items.length) % items.length;
      items[prev]?.focus();
      items.forEach((it, i) => {
        it.setAttribute('aria-selected', String(i === prev));
        it.tabIndex = i === prev ? 0 : -1;
      });
      const curItem = filtered[prev];
      if (curItem) {
        const speech = getFormulaSpeech(curItem);
        announce(t('app.formulas.option', { name: curItem.name, speech, n: prev + 1, total: items.length }));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0 && filtered[cur]) applyFormula(filtered[cur]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dlg.close();
      editor.focus();
    }
  });

  const doneBtn = $id('formulaDone');

  closeBtn?.addEventListener('click', () => {
    dlg.close();
    editor.focus();
  });

  doneBtn?.addEventListener('click', () => {
    dlg.close();
    editor.focus();
  });
}
initFormulaDialog();

function openGraphicDialog() {
  const activeDevice = settings?.embosser || 'generic';
  openTactileSymbolBrowser((item, svgContent) => {
    insertGraphicDiagram(svgContent, { title: item.name, alt: `${item.name} tactile graphic` });
  }, activeDevice);
}

function initGraphicDialog() {
  const dlg = $id('graphicDialog');
  const listEl = $id('graphicList');
  const catsEl = $id('graphicCats');
  const searchInput = $id('graphicSearch');
  const closeBtn = $id('graphicClose');
  const doneBtn = $id('graphicDone');
  const uploadInput = $id('graphicUploadInput');
  if (!dlg || !listEl) return;

  let activeCat = null;
  let filtered = [];

  function renderCategories() {
    if (!catsEl) return;
    catsEl.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'formula-cat-btn' + (activeCat === null ? ' active' : '');
    allBtn.textContent = t('common.all') || 'All';
    allBtn.addEventListener('click', () => {
      activeCat = null;
      renderCategories();
      renderList(searchInput ? searchInput.value : '');
    });
    catsEl.appendChild(allBtn);

    TACTILE_SVG_CATEGORIES.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = activeCat === c.id;
      btn.className = 'formula-cat-btn' + (isActive ? ' active' : '');
      btn.textContent = t(`tactile.category_${c.id}`) || c.name;
      btn.addEventListener('click', () => {
        activeCat = c.id;
        renderCategories();
        renderList(searchInput ? searchInput.value : '');
      });
      catsEl.appendChild(btn);
    });
  }

  function renderList(query = '') {
    const q = (query || '').trim().toLowerCase();
    filtered = TACTILE_SVG_LIBRARY.filter((item) => {
      if (activeCat && item.category !== activeCat) return false;
      if (!q) return true;
      const hay = `${item.title} ${item.desc} ${(item.keywords || []).join(' ')}`.toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });

    listEl.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.style.gridColumn = '1 / -1';
      empty.style.padding = '20px';
      empty.style.textAlign = 'center';
      empty.style.color = 'var(--muted)';
      empty.textContent = t('tactile.no_diagrams') || 'No matching diagrams found.';
      listEl.appendChild(empty);
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'graphic-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'option');

      const thumb = document.createElement('div');
      thumb.className = 'graphic-thumb';
      thumb.innerHTML = item.svg;

      const title = document.createElement('div');
      title.className = 'graphic-card-title';
      title.textContent = item.title;

      const desc = document.createElement('div');
      desc.className = 'graphic-card-desc';
      desc.textContent = item.desc;

      card.appendChild(thumb);
      card.appendChild(title);
      card.appendChild(desc);

      card.addEventListener('click', () => {
        insertGraphicDiagram(item.svg, { title: item.title, alt: item.desc });
        dlg.close();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          insertGraphicDiagram(item.svg, { title: item.title, alt: item.desc });
          dlg.close();
        }
      });

      listEl.appendChild(card);
    });
  }

  window.renderGraphicList = (q) => {
    renderCategories();
    renderList(q);
  };

  searchInput?.addEventListener('input', (e) => {
    renderList(e.target.value);
  });

  uploadInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      if (typeof content === 'string' && content.includes('<svg')) {
        insertGraphicDiagram(content, { title: file.name.replace(/\.svg$/i, ''), alt: file.name });
        dlg.close();
      }
    };
    reader.readAsText(file);
  });

  closeBtn?.addEventListener('click', () => { dlg.close(); editor.focus(); });
  doneBtn?.addEventListener('click', () => { dlg.close(); editor.focus(); });
}

function translateDiagramText(txt) {
  if (!txt || !txt.trim()) return '';
  try {
    const brf = makeTranslators(louis, activeTable).translate(txt.trim(), 0);
    if (brf) {
      const uni = brfToUnicodeBraille(brf);
      if (uni && uni !== txt) return uni;
    }
  } catch (_) {}
  return defaultBrailleTranslator(txt.trim());
}

function plotAndInsertGraph(latex, targetNodeKey) {
  if (!latex || !latex.trim()) return;
  try {
    const plot = plotTactileFunction(latex, {
      brailleCode: settings.brailleCode || 'en-ueb-g2',
      targetDevice: settings.embosser || 'dotpad',
      embosser: settings.embosser || 'dotpad',
      autoScaleY: true,
      translator: translateDiagramText,
    });

    editor.update(() => {
      const graphNode = $createGraphicNode(
        plot.svg,
        plot.title,
        plot.title,
        true,
        true
      );
      if (targetNodeKey) {
        const targetNode = $getNodeByKey(targetNodeKey);
        if (targetNode) {
          const topLevel = targetNode.getTopLevelElement();
          if (topLevel) {
            topLevel.insertAfter(graphNode);
            return;
          }
        }
      }
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $insertNodeToNearestRoot(graphNode);
      else $getRoot().append(graphNode);
    });

    announce(t('app.graphic.plotted', { latex }));
    ding();
  } catch (err) {
    console.error('Plot error:', err);
    announce(t('app.graphic.plot_failed', { message: err.message }));
  }
}

async function insertGraphicDiagram(rawSvg, meta = {}) {
  const transpiled = await transpileTactileSvgForDevice(rawSvg, {
    brailleCode: settings.brailleCode || 'en-ueb-g2',
    targetDevice: settings.embosser || 'dotpad',
    embosser: settings.embosser || 'dotpad',
    applyTextures: true,
    translateLabels: true,
    translator: translateDiagramText,
    title: meta.title || meta.alt || 'Tactile diagram',
    alt: meta.alt || meta.title || 'Tactile diagram',
  });

  editor.update(() => {
    const node = $createGraphicNode(
      transpiled.svg,
      meta.alt || meta.title || 'Tactile diagram',
      meta.title || meta.alt || 'Tactile diagram',
      true,
      true
    );
    const sel = $getSelection();
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot(node);
    else $getRoot().append(node);
  });

  announce(t('app.graphic.inserted', { title: meta.title || meta.alt || t('app.graphic.default_title') }));
  ding();
}
window.insertGraphicDiagram = insertGraphicDiagram;
window.plotAndInsertGraph = plotAndInsertGraph;

function insertSidebar(title = 'Sidebar Title') {
  let createdKey = null;
  editor.update(() => {
    const node = $createSidebarNode(title);
    const h = $createHeadingNode('h2');
    h.append($createTextNode(title));
    const p = $createParagraphNode();
    p.append($createTextNode(t('app.editor.sidebar_placeholder')));
    node.append(h, p);

    const sel = $getSelection();
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot(node);
    else $getRoot().append(node);
    createdKey = node.getKey();
    h.select(0, title.length);
  });
  announce(t('app.editor.sidebar_inserted'));
  const domEl = editor.getElementByKey(createdKey || '');
  refreshToolbar(domEl);
}
window.insertSidebar = insertSidebar;

// ---- K9: "Remove box" — dissolves the sidebar/box the caret is in, leaving its contents as ordinary
// blocks in place (a title heading stays a heading). This is NOT the "Draw the box lines" field (boxLines,
// field-registry.mjs): that keeps the box itself but switches its border lines on or off in braille; Remove
// box gets rid of the box entirely, so the braille has no box lines because there is no box. Everyone can
// use it (not a transcriber tool): the box and its border lines are ordinary, reader-visible content, like
// any other style choice — unlike the Braille formatting dialog's production-only fields.
// The nearest SidebarNode enclosing the caret (or null). Only the innermost box is returned, so removing a
// nested box (A26) leaves the outer one alone.
function $sidebarBoxAtCaret() {
  const sel = $getSelection();
  let anchor = null;
  if ($isRangeSelection(sel)) anchor = sel.anchor.getNode();
  else if (lastActiveEditorSelection?.anchorKey) anchor = $getNodeByKey(lastActiveEditorSelection.anchorKey);
  if (!anchor) return null;
  for (let n = anchor; n && n !== $getRoot(); n = n.getParent ? n.getParent() : null) {
    if ($isSidebarNode(n)) return n;
  }
  return null;
}
function unboxAvailable() {
  try { return editor.getEditorState().read(() => !!$sidebarBoxAtCaret()); } catch (err) { console.warn('unboxAvailable', err); return false; }
}
// Replace the box with its own children, in place, as ordinary top-level blocks; then remove the (now
// empty) box. One editor.update() call = one undo step. The caret moves to the start of the first block
// that was inside the box (its title heading, if it had one).
function unboxAtCaret() {
  let removed = false;
  let focusKey = null;
  editor.update(() => {
    const box = $sidebarBoxAtCaret();
    if (!box) return;
    removed = true;
    const children = box.getChildren();
    if (!children.length) { box.remove(); return; }
    let cursor = box;
    for (const child of children) { cursor.insertAfter(child); cursor = child; }
    box.remove();
    const first = children[0];
    focusKey = first ? first.getKey() : null;
    if (first) {
      if (typeof first.selectStart === 'function') first.selectStart();
      else if (typeof first.select === 'function') first.select(0, 0);
    }
  });
  if (!removed) { announce(t('app.editor.unbox_none')); return; }
  announce(t('app.editor.unbox_removed'));
  const domEl = focusKey ? editor.getElementByKey(focusKey) : null;
  refreshToolbar(domEl);
}
window.unboxAtCaret = unboxAtCaret;
function updateUnboxBtn() {
  const btn = $id('btnUnbox');
  if (!btn) return;
  btn.hidden = !unboxAvailable();
}
editor.registerUpdateListener(() => updateUnboxBtn());
$id('btnUnbox')?.addEventListener('click', () => unboxAtCaret());

// Insert the Title Page (design §4: the style menu / slash command insert it at the START of the
// book, unlike tnpage/sympage which insert near the cursor — BANA 2.2.1's page order puts it first,
// and design §3.4 allows at most one). The Book details dialog opens by itself right after (design §4).
function insertTitlePage() {
  let key = null;
  editor.update(() => {
    const existing = $getRoot().getChildren().find($isTitlePageNode);
    if (existing) { key = existing.getKey(); return; }
    const segments = titlePageTemplateSegments(titlePageFieldsFrom(tpCurrentModel()), undefined, tpMode());
    const node = $createTitlePageNode(true, titlePageStructureSig(segments));
    $fillTitlePage(node, segments);
    const root = $getRoot();
    const first = root.getFirstChild();
    if (first) first.insertBefore(node); else root.append(node);
    key = node.getKey();
  }, { onUpdate: () => { openTitlepageDetailsDialog(); } });
  if (key) announce(t('app.editor.titlepage_inserted'));
}
window.insertTitlePage = insertTitlePage;

// Insert an empty Transcriber's Notes page (one empty entry to type in) and put the caret in it.
function insertTnPage() {
  let key = null;
  editor.update(() => {
    const node = $createTnPageNode('');
    const p = $createParagraphNode();
    node.append(p);
    const sel = $getSelection();
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot(node);
    else $getRoot().append(node);
    p.select();
    key = node.getKey();
  }, { onUpdate: () => { if (key) openTnSuggestDialog(key, true, true); } });   // offer the detected notes, only when there are some (nothing is added without an explicit Add)
  announce(t('app.editor.tnpage_inserted'));
}
window.insertTnPage = insertTnPage;

// ---- "Suggested notes…" dialog for the Transcriber's Notes page (plan §9 row 5, Paul 23 Sep 2026) ----
// Emboss OFFERS the notes suggestTranscriberNotes (format/document.mjs) detected; the transcriber edits the text in place and
// presses Add or Dismiss on each (or Add all). NOTHING reaches the page without an explicit Add. Added and dismissed ids are
// kept on the page node (dismissed[]), so they are not offered again in this session and survive undo/redo; they are not
// written to the saved file, so a reloaded document offers the still-detected notes again.
let tnsState = null;   // { pageKey, opener, list: [{...suggestion, done}] }
function tnPageTarget(state) {
  return state.read(() => {
    const pages = $getRoot().getChildren().filter($isTnPageNode);
    if (!pages.length) return null;
    let page = null;
    const sel = $getSelection();
    if ($isRangeSelection(sel)) { for (let n = sel.anchor.getNode(); n; n = n.getParent()) if ($isTnPageNode(n)) { page = n; break; } }
    return (page || pages[0]).getKey();
  });
}
function updateTnSuggestBtn() {
  const btn = $id('btnTnSuggest');
  // UK-8: suggestTranscriberNotes() itself already returns nothing in UKAAF (BANA's Appendix-A-style
  // heuristics are BANA-only) EXCEPT UK-3's already-shipped quote-exchange note, which stays available
  // in UKAAF too (see that function's own UK-8/UK-3 comment) — so the button is NOT hidden by mode here:
  // doing that would also hide the one legitimate UKAAF suggestion. In the ordinary case the dialog just
  // opens empty (tnsRender's own "nothing to add" state), same as a BANA page with nothing detected.
  if (btn) btn.hidden = !transcriberToolsOn() || !tnPageTarget(editor.getEditorState());   // a transcriber tool (see transcriberTools)
}
function tnSuggestions(pageKey) {
  return editor.getEditorState().read(() => {
    const page = $getNodeByKey(pageKey);
    if (!page) return [];
    const done = new Set(page.getDismissed());
    return suggestTranscriberNotes(buildModel().blocks, currentFormatOpts()).filter((sg) => !done.has(sg.id));
  });
}
function tnsRender() {
  const ul = $id('tnsList'); if (!ul) return;
  ul.textContent = '';
  const open = tnsState.list.filter((sg) => !sg.done);
  $id('tnsEmpty').hidden = open.length > 0;
  $id('tnsAddAll').hidden = open.length < 2;
  ul.hidden = !open.length;
  open.forEach((sg, i) => {
    const li = document.createElement('li'); li.className = 'tns-row'; li.dataset.id = sg.id;
    const lab = document.createElement('label'); lab.htmlFor = `tnsText${i}`; lab.textContent = t('app.tns.note_label', { n: i + 1 });
    const inp = document.createElement('input'); inp.type = 'text'; inp.id = `tnsText${i}`; inp.value = sg.text; inp.setAttribute('aria-describedby', `tnsReason${i}`);
    inp.addEventListener('input', () => { sg.edited = inp.value; });
    const why = document.createElement('p'); why.id = `tnsReason${i}`; why.className = 'fmt-help'; why.textContent = t('app.tns.why', { reason: sg.reason }) + (sg.provisional ? ' ' + t('app.tns.provisional') : '');
    const acts = document.createElement('div'); acts.className = 'tns-actions';
    const add = document.createElement('button'); add.type = 'button'; add.className = 'tns-add'; add.textContent = t('app.tns.add'); add.setAttribute('aria-label', t('app.tns.add_n', { n: i + 1 }));
    const dis = document.createElement('button'); dis.type = 'button'; dis.className = 'tns-dismiss'; dis.textContent = t('app.tns.dismiss'); dis.setAttribute('aria-label', t('app.tns.dismiss_n', { n: i + 1 }));
    add.addEventListener('click', () => tnsAct([sg], true, i));
    dis.addEventListener('click', () => tnsAct([sg], false, i));
    acts.append(add, dis);
    li.append(lab, inp, why, acts); ul.append(li);
  });
}
// Add (or only dismiss) the given suggestions in ONE undo step; then re-list and put focus on the row that took its place.
function tnsAct(list, add, rowIndex) {
  const st = tnsState; if (!st || !list.length) return;
  editor.update(() => {
    const page = $getNodeByKey(st.pageKey);
    if (!page) return;
    if (add) {
      for (const sg of list) {
        const text = String(sg.edited != null ? sg.edited : sg.text).trim();
        if (!text) continue;
        const kids = page.getChildren();
        const last = kids[kids.length - 1];
        if (last instanceof ParagraphNode && !last.getTextContent().trim()) last.append($createTextNode(text));
        else { const p = $createParagraphNode(); p.append($createTextNode(text)); page.append(p); }
      }
    }
    page.setDismissed([...page.getDismissed(), ...list.map((sg) => sg.id)]);
  }, { tag: 'history-push', discrete: true });
  list.forEach((sg) => { sg.done = true; });
  scheduleRender();
  const left = st.list.filter((sg) => !sg.done).length;
  const msg = add ? t('app.tns.added', { count: list.length }) : t('app.tns.dismissed');
  $id('tnsStatus').textContent = '';
  setTimeout(() => { const el = $id('tnsStatus'); if (el) el.textContent = msg + (left ? '' : ' ' + t('app.tns.none_left')); }, 30);
  announce(msg);
  tnsRender();
  const inputs = [...document.querySelectorAll('#tnsList .tns-row input')];
  (inputs[Math.min(rowIndex ?? 0, inputs.length - 1)] || $id('tnsClose')).focus();
}
function openTnSuggestDialog(pageKey, toEditor, onlyIfAny) {
  const dlg = $id('tnsDialog'); if (!dlg || dlg.open) return;
  pageKey = pageKey || tnPageTarget(editor.getEditorState());
  if (!pageKey) { announce(t('app.tns.no_page')); return; }
  const list = tnSuggestions(pageKey);
  if (onlyIfAny && !list.length) return;   // a page just created with nothing detected: no dialog (the Notes… button still opens it, empty)
  tnsState = { pageKey, opener: toEditor === true ? null : document.activeElement,   // a just-inserted page: focus goes back to the new entry
     list };
  $id('tnsStatus').textContent = '';
  tnsRender();
  dlg.showModal();
  const first = document.querySelector('#tnsList .tns-row input');
  (first || $id('tnsClose')).focus();
  announce(tnsState.list.length ? t('app.tns.opened', { count: tnsState.list.length }) : t('app.tns.empty'));
}
(function initTnSuggestDialog() {
  const dlg = $id('tnsDialog'); if (!dlg) return;
  $id('btnTnSuggest')?.addEventListener('click', () => openTnSuggestDialog());
  $id('tnsClose')?.addEventListener('click', () => dlg.close());
  $id('tnsDone')?.addEventListener('click', () => dlg.close());
  $id('tnsAddAll')?.addEventListener('click', () => { if (tnsState) tnsAct(tnsState.list.filter((sg) => !sg.done), true, 0); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.getClientRects().length);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  dlg.addEventListener('close', () => {
    if (dlg.open) return;   // reopened before this (queued) close event ran: the new opening owns tnsState and focus
    const st = tnsState; tnsState = null;
    if (!st) return;
    const op = st.opener;
    if (op && document.contains(op) && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(op.tagName)) op.focus(); else editor.focus();
  });
  editor.registerUpdateListener(() => updateTnSuggestBtn());
})();
window.openTnSuggestDialog = openTnSuggestDialog;

// Insert an automatic Special Symbols page (its entries fill in from the document's symbols).
function insertSymPage() {
  editor.update(() => {
    const node = $createSymPageNode('', true);
    const p = $createParagraphNode();
    node.append(p);
    const sel = $getSelection();
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot(node);
    else $getRoot().append(node);
    p.select();
  });
  announce(t('app.editor.sympage_inserted'));
}
window.insertSymPage = insertSymPage;

function insertTable(numRows = 3, numCols = 3, format = 'spatial') {
  let createdKey = null;
  editor.update(() => {
    const headers = Array.from({ length: numCols }, (_, i) => `Header ${i + 1}`);
    const rows = Array.from({ length: numRows }, (_, ri) =>
      Array.from({ length: numCols }, (_, ci) => `Row ${ri + 1}, Col ${ci + 1}`)
    );
    const node = $createTableNode(headers, rows, format);
    const sel = $getSelection();
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot(node);
    else $getRoot().append(node);
    createdKey = node.getKey();
  });
  announce(t('app.table.inserted', { format: t(`app.table.fmt_${format}`) === `app.table.fmt_${format}` ? format : t(`app.table.fmt_${format}`), cols: numCols, rows: numRows }));
  const styleVal = (format === 'listed' || format === 'table-listed') ? 'table-listed' : 'table-spatial';
  if ($id('blockStyle')) syncStyleOptionVisibility(styleVal);
  const si = $id('styleInspector');
  if (si) si.textContent = formatStyleInspectorBadge(styleVal, settings.profile || settings.mode || 'bana', uiText);
  setTimeout(() => {
    const tables = editorEl.querySelectorAll('.doc-table-block');
    const lastTable = tables[tables.length - 1];
    const firstInput = lastTable?.querySelector('.table-cell-input');
    if (firstInput) {
      firstInput.focus();
      refreshToolbar(firstInput);
    }
  }, 80);
}
window.insertTable = insertTable;

// The slash menu: the text-format commands, then every style in BLOCK_STYLES (the same
// registry the style dropdown is built from), then the other inserts. `expertOnly` commands
// (tactile graphics, graph plotting) are hidden unless the Ctrl/Cmd+Shift+\ toggle is on
// (body.expert-hardware) — see slashCommandVisible. Maths inserts stay visible (G1).
const SLASH_FORMAT_COMMANDS = [
  { id: 'slash', title: 'Insert "/"', desc: 'Type a literal slash character', icon: '/', keywords: ['slash', '/', 'text', 'symbol'], action: () => insertTextAtCaret('/') },
  { id: 'bold', title: 'Bold Text', desc: 'Apply bold formatting', icon: 'B', keywords: ['bold', 'b', 'strong'], action: () => $id('btnBold')?.click() },
  { id: 'italic', title: 'Italic Text', desc: 'Apply italic formatting', icon: 'I', keywords: ['italic', 'i', 'emphasis'], action: () => $id('btnItalic')?.click() },
  { id: 'underline', title: 'Underline Text', desc: 'Apply underline formatting', icon: 'U', keywords: ['underline', 'u'], action: () => $id('btnUnderline')?.click() },
];
const SLASH_INSERT_COMMANDS = [
  { id: 'indent', title: 'Indent / Nest Sub-item', desc: 'Nest list item or exercise deeper (Tab)', icon: 'i:arrow-right', keywords: ['indent', 'nest', 'subitem', 'subquestion', 'sub', 'tab', 'level'], action: () => indentCurrentItem() },
  { id: 'outdent', title: 'Outdent / Promote Item', desc: 'Promote list item or exercise higher (Shift+Tab)', icon: 'i:arrow-left', keywords: ['outdent', 'promote', 'unindent', 'unnest', 'shift-tab', 'back'], action: () => outdentCurrentItem() },
  { id: 'continue', when: () => continueListItemAvailable(), title: 'Continue Item', desc: 'Turn this blank line into a further paragraph of the item above, or back (Ctrl/⌘+Shift+Enter)', icon: 'i:arrow-down-left', keywords: ['continue', 'paragraph', 'item', 'list', 'runover', 'blocks'], action: () => continueListItem() },
  { id: 'matrix', title: 'Math Matrix (2×2 / 3×3)', desc: 'Insert 2×2 or 3×3 visual MathLive matrix', icon: 'i:calculator', keywords: ['matrix', 'pmatrix', 'bmatrix', 'linalg', 'array', 'grid', 'vector'], action: () => insertMathEquation('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'Matrix equation inserted') },
  { id: 'math', title: 'Insert Equation', desc: 'MathLive visual equation (UEB/Nemeth)', icon: 'i:sigma-function', keywords: ['math', 'maths', 'equation', 'latex', 'formula'], action: () => $id('btnMath')?.click() },
  { id: 'formula', title: 'Equation Templates...', desc: 'Browse 340+ math formulas, matrices & equations', icon: 'i:sigma-function', keywords: ['formula', 'template', 'math', 'equation', 'matrix', 'table', 'algebra', 'calculus', 'frac', 'sqrt'], action: () => openFormulaDialog() },
  { id: 'plot', expertOnly: true, title: 'Plot Tactile Math Graph...', desc: 'Generate tactile coordinate graph (single or multi-curve)', icon: 'i:graph-up', keywords: ['plot', 'graph', 'function', 'curve', 'math', 'equation', 'parabola', 'sine', 'line', 'coordinate', 'axes', 'multi'], action: () => {
    const promptEquation = window.prompt('Enter function(s) or comma-separated curves to plot (e.g. x^2 - 4, 2x + 1):', 'x^2 - 4, 2x + 1');
    if (promptEquation) plotAndInsertGraph(promptEquation);
  }},
  { id: 'graphic', expertOnly: true, title: 'Tactile Graphic Diagram...', desc: 'Browse curated tactile diagrams or upload SVG', icon: 'i:media-image', keywords: ['graphic', 'svg', 'image', 'diagram', 'chart', 'tactile', 'picture', 'drawing', 'map'], action: () => openGraphicDialog() },
  { id: 'brailleformat', when: () => transcriberToolsOn() && bfHasTarget(), title: 'Braille formatting…', desc: 'Optional braille formatting fields for this block (Ctrl/⌘+Alt+B)', icon: 'i:settings', keywords: ['braille', 'formatting', 'format', 'fields', 'bullet', 'columns', 'directions', 'speaker', 'stairstep', 'subdivision', 'note', 'xref', 'prefix'], action: () => openBrailleFmtDialog() },
  // K29 Stage 1d "Insert field": only offered with the caret inside a Title Page line, Transcriber tools on.
  { id: 'titlepageinsertfield', when: () => transcriberToolsOn() && titlePageInsertFieldTarget(editor.getEditorState()).available, title: 'Insert field…', desc: 'Put a Title Page field (title, author, ISBN…) at the cursor (Ctrl/⌘+Shift+F)', icon: 'i:label', keywords: ['field', 'chip', 'title page', 'insert field', 'author', 'isbn', 'publisher'], action: () => openTpInsertFieldMenu() },
  // K9: everyone's command (not a transcriber tool) — the caret must be inside a sidebar/box.
  { id: 'unbox', when: () => unboxAvailable(), title: 'Remove box', desc: 'Replace this box with its contents as ordinary blocks — the braille then has no box lines (Ctrl/⌘+Alt+U)', icon: 'i:box', keywords: ['unbox', 'remove box', 'delete box', 'sidebar', 'box lines', 'callout', 'dissolve', 'border'], action: () => unboxAtCaret() },
  { id: 'break', title: 'Document Break', desc: 'Divider line ( ∗ ∗ ∗ )', icon: 'i:asterisk', keywords: ['break', 'divider', 'asterisks', 'line', 'hr', 'separator'], action: () => $id('btnBreak')?.click() },
  { id: 'page', title: 'Print Page Number', desc: 'Insert source print page break indicator', icon: 'i:page', keywords: ['page', 'printpage', 'pagenum', 'break', 'number', 'pagination'], action: () => insertPrintPage() },
];
const SLASH_COMMANDS = [
  ...SLASH_FORMAT_COMMANDS,
  ...BLOCK_STYLES.map((d) => ({
    id: d.slash, i18nId: d.slashKey || d.slash, style: d.value, audience: d.audience, title: d.title, desc: d.desc, icon: d.icon, keywords: d.keywords,
    action: d.slashAction || (() => setBlockStyle(d.value)), when: d.when,   // UK-8: carries e.g. sympage's mode gate into the slash menu too
  })),
  ...SLASH_INSERT_COMMANDS,
];
// Expert-only commands show only while the Ctrl/Cmd+Shift+\ toggle is on (body.expert-hardware).
const slashCommandVisible = (cmd) => (!cmd.expertOnly || document.body.classList.contains('expert-hardware')) && audienceVisible(cmd.audience) && (!cmd.when || cmd.when());   // audience: a transcriber page style needs Transcriber tools   // `when`: only offered where it applies (the Braille formatting command needs a block that has fields)

function initSlashMenu() {
  const menuEl = $id('slashMenu');
  const listEl = $id('slashList');
  if (!menuEl || !listEl) return;

  let activeQuery = '';
  let filteredCommands = [];
  let selectedIndex = 0;
  let isMenuOpen = false;

  function hideSlashMenu() {
    isMenuOpen = false;
    menuEl.hidden = true;
    menuEl.style.display = 'none';
    activeQuery = '';
    filteredCommands = [];
    selectedIndex = 0;
  }

  function showSlashMenu() {
    isMenuOpen = true;
    menuEl.hidden = false;
    menuEl.style.display = 'block';
  }

  function renderSlashList() {
    listEl.innerHTML = '';
    filteredCommands.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.className = 'slash-item';
      item.role = 'option';
      item.id = `slash-opt-${cmd.id}`;
      item.setAttribute('aria-selected', String(idx === selectedIndex));

      const ico = document.createElement('span');
      ico.className = 'slash-ico';
      if (String(cmd.icon || '').startsWith('i:')) ico.append(iconEl(cmd.icon.slice(2)));
      else ico.textContent = cmd.icon;

      const info = document.createElement('div');
      info.className = 'slash-info';

      const title = document.createElement('span');
      title.className = 'slash-title';
      title.textContent = slashText(cmd, 'title');

      const desc = document.createElement('span');
      desc.className = 'slash-desc';
      desc.textContent = slashText(cmd, 'desc');

      info.appendChild(title);
      info.appendChild(desc);
      item.appendChild(ico);
      item.appendChild(info);

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        executeCommand(cmd);
      });

      listEl.appendChild(item);
    });

    const activeItem = listEl.children[selectedIndex];
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
      menuEl.setAttribute('aria-activedescendant', activeItem.id);
    }
  }

  function updateSlashQuery(query) {
    activeQuery = (query || '').toLowerCase().trim();
    filteredCommands = SLASH_COMMANDS.filter((cmd) => {
      if (!slashCommandVisible(cmd)) return false;
      if (!activeQuery) return true;
      return cmd.id.includes(activeQuery) ||
             cmd.title.toLowerCase().includes(activeQuery) ||
             cmd.keywords.some((k) => k.includes(activeQuery));
    });

    if (!filteredCommands.length) {
      hideSlashMenu();
      return;
    }

    selectedIndex = 0;
    renderSlashList();
    showSlashMenu();
    const cur = filteredCommands[0];
    if (cur) announce(t('app.slash.option', { title: slashText(cur, 'title'), desc: slashText(cur, 'desc'), n: 1, total: filteredCommands.length }));
  }

  function positionSlashMenu() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const pane = editorEl.closest('.pane');
    if (!pane) return;
    const paneRect = pane.getBoundingClientRect();
    const menuHeight = 280;
    const spaceBelow = paneRect.bottom - (rect.bottom || rect.top || 100);
    let top;
    if (spaceBelow < menuHeight && (rect.top - paneRect.top) > menuHeight) {
      top = Math.max(10, (rect.top || 100) - paneRect.top - menuHeight - 6);
    } else {
      top = (rect.bottom || rect.top || 100) - paneRect.top + 6;
    }
    const left = Math.min(Math.max(10, (rect.left || 20) - paneRect.left), paneRect.width - 290);
    menuEl.style.top = `${top}px`;
    menuEl.style.left = `${left}px`;
  }

  function removeSlashQueryText(len) {
    try {
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel) && sel.isCollapsed()) {
          const anchor = sel.anchor;
          const node = anchor.getNode();
          if (!node || typeof node.getTextContent !== 'function') return;
          const offset = anchor.offset;
          const start = Math.max(0, offset - (Math.max(0, len) + 1));
          if (typeof sel.setTextNodeRange === 'function') {
            sel.setTextNodeRange(node, start, node, offset);
            sel.insertText('');
          }
        }
      });
    } catch (e) {
      console.warn('removeSlashQueryText safely recovered:', e);
    }
  }

  // A slash command's title / description in the interface language (slash.<id>_title / _desc).
function slashText(cmd, part) {
  const key = `slash.${cmd.i18nId || cmd.id}_${part}`;
  const v = t(key);
  return v && v !== key ? v : cmd[part];
}

function executeCommand(cmd) {
    if (!cmd || typeof cmd.action !== 'function') {
      hideSlashMenu();
      return;
    }
    removeSlashQueryText(activeQuery.length);
    hideSlashMenu();
    setTimeout(() => {
      try {
        cmd.action();
        announce(t('app.slash.applied', { title: slashText(cmd, 'title') }));
      } catch (err) {
        console.warn(`Safe recovery: Slash command "${cmd.title}" encountered an error:`, err);
      }
    }, 10);
  }

  // Monitor text caret for slash trigger
  editor.registerUpdateListener(() => {
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel) && sel.isCollapsed()) {
        const anchor = sel.anchor;
        const node = anchor.getNode();
        const offset = anchor.offset;
        const text = node.getTextContent();
        const beforeCaret = text.slice(0, offset);
        const match = beforeCaret.match(/(?:^|\s)\/([a-zA-Z0-9]*)$/);
        if (match) {
          updateSlashQuery(match[1]);
          positionSlashMenu();
          return;
        }
      }
      hideSlashMenu();
    });
  });

  // Handle keyboard navigation when slash menu is active
  editorEl.addEventListener('keydown', (e) => {
    if (!isMenuOpen || !filteredCommands.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % filteredCommands.length;
      renderSlashList();
      const cur = filteredCommands[selectedIndex];
      if (cur) announce(t('app.slash.option', { title: slashText(cur, 'title'), desc: slashText(cur, 'desc'), n: selectedIndex + 1, total: filteredCommands.length }));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
      renderSlashList();
      const cur = filteredCommands[selectedIndex];
      if (cur) announce(t('app.slash.option', { title: slashText(cur, 'title'), desc: slashText(cur, 'desc'), n: selectedIndex + 1, total: filteredCommands.length }));
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();   // Lexical's own Enter/Tab handler must not also split the block or indent
      const cmd = filteredCommands[selectedIndex];
      if (cmd) executeCommand(cmd);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlashMenu();
      announce(t('app.slash.closed'));
      return;
    }
  }, true);
}

// Continue item: turn a blank new list line into a further paragraph of the item above (and
// back). Shift+Enter is already a line break within a paragraph and Enter on a blank item
// already ends the list (matching Word/Docs), so this needs its own combination: Ctrl/⌘+Shift+
// Enter is free (no other shortcut here uses Enter) and reads as "Enter, but keep it in the
// item". Lexical's own rich-text plugin claims EVERY Enter+Shift combination for "insert line
// break" regardless of Ctrl/⌘ (it checks ctrlKey/metaKey as "any"), via its own keydown listener
// on editorEl itself — a capture-phase listener on that SAME element would not reliably run
// first (per the DOM spec, listeners on the event's own target fire in registration order, not
// capture-before-bubble), so this is registered on `document`, an ANCESTOR of editorEl: a
// capture-phase listener there is guaranteed to see the event before it ever reaches editorEl,
// and stopPropagation() here stops it from reaching editorEl (and Lexical) at all.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter' && editorEl.contains(document.activeElement)) {
    e.preventDefault();
    e.stopPropagation();
    continueListItem();
  }
}, true);

// #57c: a way out of a note, as Enter on a blank list item ends the list. Enter at the end of a note paragraph starts a further
// paragraph of the SAME note (ParagraphNode.insertNewAfter above); Enter again on that still-empty paragraph turns it into an
// ordinary body paragraph instead, so the text after the note can be typed at once.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || !editorEl.contains(document.activeElement)) return;
  let ended = false;
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
    const p = sel.anchor.getNode();
    if (!(p instanceof ParagraphNode) || p.getChildrenSize() !== 0 || p.getBanaStyle() !== 'footnote') return;
    const note = p.getNote();
    const prev = p.getPreviousSibling();
    if (!note || !(prev instanceof ParagraphNode) || prev.getBanaStyle() !== 'footnote' || !prev.getNote() || prev.getNote().id !== note.id) return;
    p.setBanaStyle(null).setNote(null);
    ended = true;
  });
  if (ended) { e.preventDefault(); e.stopPropagation(); }
}, true);

// ---- Keyboard Tab / Shift+Tab & Bracket Shortcut Handler for List Item Indent / Outdent ----
editorEl.addEventListener('keydown', (e) => {
  // Support Ctrl+] / Cmd+] (Indent) and Ctrl+[ / Cmd+[ (Outdent)
  if (e.ctrlKey || e.metaKey) {
    if (e.key === ']' || e.code === 'BracketRight') {
      e.preventDefault();
      e.stopPropagation();
      indentCurrentItem();
      return;
    }
    if (e.key === '[' || e.code === 'BracketLeft') {
      e.preventDefault();
      e.stopPropagation();
      outdentCurrentItem();
      return;
    }
  }

  // Contextual Tab: Only trap Tab when inside a list item or exercise so screen reader users can Tab out freely from body text
  if (e.key === 'Tab') {
    let isInsideList = false;
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        let node = sel.anchor.getNode();
        while (node && node !== $getRoot()) {
          if ($isListItemNode(node) || $isListNode(node)) {
            isInsideList = true;
            break;
          }
          node = node.getParent ? node.getParent() : null;
        }
      }
    });
    if (isInsideList) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        outdentCurrentItem();
      } else {
        indentCurrentItem();
      }
    }
  }
});

// ---- seed demo content ----
function seed() {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const h1 = $createHeadingNode('h1'); h1.append($createTextNode('Chapter One'));
    const p1 = $createParagraphNode();
    p1.append($createTextNode('This word is '));
    const b = $createTextNode('important'); b.toggleFormat('bold'); p1.append(b);
    p1.append($createTextNode(', and this is '));
    const it = $createTextNode('emphasised'); it.toggleFormat('italic'); p1.append(it);
    p1.append($createTextNode('.'));
    const p2 = $createParagraphNode();
    p2.append($createTextNode('The area of a circle is '));
    p2.append($createMathNode('\\pi r^2'));
    p2.append($createTextNode('.'));
    const p3 = $createParagraphNode();
    p3.append($createTextNode('Click any word here and its braille lights up beside it — and the other way round.'));
    const h2 = $createHeadingNode('h2'); h2.append($createTextNode('A short list'));
    const ul = $createListNode('bullet');
    ['First item', 'Second item', 'Third item'].forEach((s) => { const li = $createListItemNode(); li.append($createTextNode(s)); ul.append(li); });
    root.append(h1, p1, $createBreakNode(), p2, p3, h2, ul);
  }, { discrete: true });
}

// ---- drag-and-drop import (parse a document into the editor) ----
// Reuses the converter's parsers (parseFile → the same block model the formatter
// eats) and rebuilds it as Lexical nodes. Structure + inline maths from LaTeX
// sources import fully; docx/OMML equations (MathML, no LaTeX) come in as a marker.
// Subscript/superscript: the readers bracket a sub/superscript run with private-use markers inside the text
// (format/text-style.mjs SCRIPT_MARKS). The editor shows such a run as Lexical's own subscript/superscript format
// (and nodeToRuns turns the format back into markers), instead of showing the markers as boxes (Paul, 30 Sep).
// `make(text)` builds one text node (with its emphasis); this appends one node per run between markers.
function $appendScriptAware(parent, text, make) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  if (!/[\ue000-\ue002]/.test(text)) { parent.append(make(text)); return; }
  let level = null, buf = '';
  const flush = () => {
    if (!buf) return;
    const node = make(buf);
    if (level) node.toggleFormat(level);
    parent.append(node);
    buf = '';
  };
  for (const c of text) {
    if (c === subOpen || c === supOpen) { flush(); level = c === subOpen ? 'subscript' : 'superscript'; }
    else if (c === end) { flush(); level = null; }
    else buf += c;
  }
  flush();
}
// The reverse, for nodeToRuns: a subscript/superscript text node's text bracketed by the markers again.
function scriptMarked(node, text) {
  if (typeof node.hasFormat !== 'function' || !text) return text;
  if (node.hasFormat('subscript')) return SCRIPT_MARKS.subOpen + text + SCRIPT_MARKS.end;
  if (node.hasFormat('superscript')) return SCRIPT_MARKS.supOpen + text + SCRIPT_MARKS.end;
  return text;
}
function applyEmphasis(node, tf, uncontracted = false, ignoreFont = false, hyperlink = false, transcriberTypeform = null, lang = null) {
  if (ignoreFont || hyperlink) node.setStyle([ignoreFont ? IGNORE_FONT_STYLE : '', hyperlink ? HYPERLINK_STYLE : ''].filter(Boolean).join(' '));
  if (tf & TF.bold) node.toggleFormat('bold');
  if (tf & TF.italic) node.toggleFormat('italic');
  if (tf & TF.underline) node.toggleFormat('underline');
  // K5: script has no Lexical format bit (see SCRIPT_STYLE/hasScript above) — its own CSS
  // custom property, appended onto whatever ignoreFont/hyperlink already set.
  if (tf & TF_SCRIPT) node.setStyle([node.getStyle ? node.getStyle() || '' : '', SCRIPT_STYLE].filter(Boolean).join(' '));
  if (uncontracted) node.toggleFormat('code');           // uncontracted (grade 1) run, e.g. a pronunciation (A26)
  // UEB 9.5.1: 'strike' is the editor's own strikethrough control (Lexical format bit); any
  // other transcriber-defined typeform slot (BrailleBlaster's own bai-transN, parse.mjs A24)
  // has no editor control, so it rides the CSS-custom-property style channel instead — same
  // mechanism as ignoreFont/hyperlink above, so it round-trips a save.
  if (transcriberTypeform === 'strike') node.toggleFormat('strikethrough');
  else if (transcriberTypeform) node.setStyle([node.getStyle ? node.getStyle() || '' : '', transcriberTfStyle(transcriberTypeform)].filter(Boolean).join(' '));
  if (langStyle(lang)) node.setStyle([node.getStyle ? node.getStyle() || '' : '', langStyle(lang)].filter(Boolean).join(' '));   // foreign-language run (input/lang.mjs)
  return node;
}
function safeMathmlToLatex(mathml) {
  try { return mathmlToLatex(mathml) || ''; }
  catch (e) { console.warn('[maths] MathML could not be converted to LaTeX for editing; original kept:', (e && e.message) || e); return ''; }
}
let noteGroupSeq = 0;
function fillFromBlock(parent, b) {
  if (!b) return;
  if (b.type === 'math' && !b.segments) {
    // A display equation inside a container (sidebar) — previously dropped here.
    const latex = b.latex || (b.mathml ? safeMathmlToLatex(b.mathml) : '');
    if (latex || b.mathml) parent.append($createMathNode(latex, b.mathml || null));
    return;
  }
  // F-113: a multi-paragraph note (parse.mjs's pushNote) keeps its paragraphs as
  // b.blocks — but a footnote is one editor ParagraphNode, with no multi-paragraph
  // authoring UI yet (a separate gap from this data-loss fix). Join them with a forced
  // line break so the text survives visibly instead of being silently dropped (fillFromBlock
  // otherwise finds no b.segments/b.lines/b.text on a blocks-only footnote block).
  if (Array.isArray(b.blocks) && b.blocks.length && !b.segments && !(Array.isArray(b.lines) && b.lines.length)) {
    b.blocks.forEach((cb, i) => {
      if (i > 0) parent.append($createLineBreakNode());
      fillFromBlock(parent, cb);
    });
    return;
  }
  if (b.segments) {
    for (const s of b.segments) {
      if (s.type === 'math') {
        const latex = s.latex || (s.mathml ? safeMathmlToLatex(s.mathml) : '');
        if (latex || s.mathml) parent.append($createMathNode(latex, s.mathml || null));
        else parent.append($createTextNode('⟨equation⟩'));
      }
      else if (s.type === 'noteref') { if (s.text) parent.append($createNoteRefNode(s.text, s.idref || null, !!s.annoref)); }
      else if (s.type === 'linenum') { if (s.text) parent.append($createLineNumberNode(s.text)); }
      else if (s.type === 'imgnote') { if (s.text) parent.append($createImgNoteNode(s.text, s.src || null, s)); }
      else if (s.type === 'brl') { if (s.brl || s.text) parent.append($createBrlNode(s.text || '', s.brl || '')); }
      else if (s.href) {
        // A19/A21 Stage 3: keep the href through the editor, not just a direct parse->export
        // round trip (parse.mjs's walkInline stamps `.href` on an ordinary text segment —
        // see there — so this must be checked before the plain-text branch below).
        if (s.text) $appendScriptAware(parent, s.text, (x) => applyEmphasis($createLinkNode(x, s.href), s.tf || 0, !!s.uncontracted, !!s.ignoreFont, !!s.hyperlink, s.transcriberTypeform, s.lang));
      }
      else if (s.cite) {
        // A19/A21 Stage 4: same shape as the link case above.
        if (s.text) $appendScriptAware(parent, s.text, (x) => applyEmphasis($createCiteNode(x), s.tf || 0, !!s.uncontracted, !!s.ignoreFont, !!s.hyperlink, s.transcriberTypeform, s.lang));
      }
      else if (s.text) {
        // A forced line break (<br/>, '\n') stays a line break (A26); other space runs collapse.
        String(s.text).split('\n').forEach((part, k) => {
          if (k > 0) parent.append($createLineBreakNode());
          const t = part.replace(/\s+/g, ' ');
          if (t) $appendScriptAware(parent, t, (x) => applyEmphasis($createTextNode(x), s.tf || 0, !!s.uncontracted, !!s.ignoreFont, !!s.hyperlink, s.transcriberTypeform, s.lang));
        });
      }
    }
  } else if (Array.isArray(b.lines) && b.lines.length > 0) {
    b.lines.forEach((l, idx) => {
      if (idx > 0) parent.append($createLineBreakNode());
      $appendScriptAware(parent, String(l), (x) => $createTextNode(x));
    });
  } else if (b.speaker || b.speech) {
    const speakerText = b.speaker ? `${b.speaker}: ` : '';
    const speechText = b.speech || '';
    if (speakerText) {
      const strong = applyEmphasis($createTextNode(speakerText), 4);
      parent.append(strong);
    }
    if (speechText) {
      parent.append($createTextNode(speechText));
    }
  } else if ((b.text ?? '').trim()) {
    // A forced line break ('\n': Shift+Enter, <br/>, an RTF \line) stays a line break, as in the segments path above (A26); other
    // space runs collapse. (1 Oct 2026: a plain-text paragraph's line break was collapsed to a space, so the editor's braille ran the
    // two lines together where the reader's broke them — tests/test-editor-reader-parity.mjs, r01-inline.rtf.)
    const typedBraille = TYPED_BRAILLE_TEXT_RE.test(String(b.text));   // feedback item 3: typed braille keeps its spaces as typed
    (typedBraille ? String(b.text).replace(/\s+$/, '') : String(b.text).trim()).split('\n').forEach((part, k) => {
      if (k > 0) parent.append($createLineBreakNode());
      const t = typedBraille ? part : part.replace(/\s+/g, ' ').trim();
      if (t) $appendScriptAware(parent, t, (x) => $createTextNode(x));
    });
  }
}

// Mirrors input/parse.mjs LEADING_BULLET_RE: the glyph must be FOLLOWED BY WHITESPACE,
// so "-3 is negative" and "*Note* this" keep their first character.
const LEADING_BULLET_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7\u25A1\u25A0\u25B2\u2713\u2714\u221A]+\s+/;
function stripLeadingListBullet(it) {
  if (!it) return it;
  if (typeof it === 'string') return it.replace(LEADING_BULLET_RE, '');
  // Segments are what the editor shows, so strip them too (an item carries both).
  const out = { ...it };
  if (typeof out.text === 'string') out.text = out.text.replace(LEADING_BULLET_RE, '');
  if (out.segments && out.segments.length > 0 && out.segments[0].text) {
    out.segments = [{ ...out.segments[0], text: out.segments[0].text.replace(LEADING_BULLET_RE, '') }, ...out.segments.slice(1)];
  }
  return out;
}

export function getBlockBanaStyle(b) {
  if (!b) return null;
  if (b.style) {
    if (b.style === 'play-speaker' || b.style === 'speaker' || b.style === 'play' || b.style === 'dialogue' || b.style === 'play-dialogue') return 'dialogue';
    if (b.style === 'play-stage') return 'stage';
    if (b.style === 'play-verse' || b.style === 'verse' || b.style === 'poem' || b.style === 'poetry') return 'poem';
    return b.style;
  }
  if (b.type === 'note' || b.kind === 'tabletn' || b.kind === 'image') return 'note';
  if (b.type === 'code') return 'code';   // import fix list #40: a code block (a Markdown fence, <pre>, Word Source Code) is the "Computer code" paragraph style
  if (b.type === 'caption') return 'caption';
  if (b.type === 'footnote') return 'footnote';
  if (b.type === 'attribution') return 'attribution';
  if (b.type === 'stage') return 'stage';
  if (b.type === 'verse' || b.type === 'poem' || b.type === 'poetry') return 'poem';
  if (b.type === 'dialogue' || b.type === 'speaker' || b.type === 'play-dialogue') return 'dialogue';
  if (b.type === 'play') return b.subtype === 'verse' ? 'poem' : 'dialogue';
  return null;
}

// Set by the undo/redo system: forget the history and make the current document the
// undo floor (G7 — undo after a load must not step back into the previous document).
let resetUndoHistory = () => {};

// One model block → editor node(s) appended to `parent` (the root or a sidebar).
function appendBlock(parent, b) {
  if (!b) return;
  if (b.type === 'heading' || b.type === 'title') {
    const lvl = b.type === 'title' ? 1 : Math.min(6, b.level || 1);
    const h = $createHeadingNode('h' + lvl);
    if (b.type === 'title') h.setIsTitle(true);   // #57b: kept as its own type (see HeadingNode.setIsTitle)
    fillFromBlock(h, b);
    fmtFromBlock(h, b, FMT_HEADING_KEYS);
    if (b.poemRole === 'title') { h.setPoemRole('title'); if (b.poemId != null) h.setPoemId(b.poemId); }   // #49: a poem's own title
    parent.append(h);
  } else if (b.type === 'list') {
    const listKind = b.kind || b.style || (b.ordered ? 'number' : null);
    const isPlain = listKind === 'toc' || listKind === 'index' || listKind === 'plain' || b.kind === 'plain';
    // A bullet glyph as an item's marker ('•', '▲' …) is a bulleted list, not a numbered one.
    const isOrdered = b.ordered || listKind === 'number' || (b.items && b.items.some((it) => it.marker && !isBulletMarker(it.marker)));
    const listType = isPlain ? 'plain' : (isOrdered ? 'number' : 'bullet');
    const effectiveKind = listKind || (isPlain ? 'plain' : null);   // plain stays plain (its own style)
    const makeList = () => {
      const l = $createListNode(listType);
      fmtFromBlock(l, b, FMT_LIST_KEYS);
      if (effectiveKind) {
        l.setListKind(effectiveKind);
        l.setBanaStyle(effectiveKind);
      }
      return l;
    };
    // Lexical joins neighbouring lists of the same type: keep separate source lists apart
    // with an empty paragraph (buildModel skips it), or numbering would run on (A26).
    const attachList = (l) => {
      if (!l.getChildrenSize()) return;
      const prev = parent.getLastChild();
      if (prev && $isListNode(prev)) parent.append($createParagraphNode());
      parent.append(l);
    };
    let list = makeList();
    for (const it of (b.items || [])) {
      const li = $createListItemNode();
      const cleanItem = stripLeadingListBullet(it);
      const firstSeg = typeof it === 'object' && it.segments ? it.segments[0] : null;
      const rawFirst = typeof it === 'string' ? it : (it.segments ? ((firstSeg && firstSeg.text) || '') : (it.text || ''));
      const bullet = String(rawFirst).match(LEADING_BULLET_RE);
      if (bullet) li.setBulletPrefix({ text: bullet[0], tf: (firstSeg && firstSeg.tf) || 0 });
      fillFromBlock(li, cleanItem && typeof cleanItem === 'object' && cleanItem.blocks ? { ...cleanItem, blocks: undefined } : cleanItem);   // the item's own paragraph (its blocks follow below)
      if (it.page) li.setPage(it.page);
      if (it.page && it.pageHref) li.setPageHref(it.pageHref);   // A36
      if (isOrdered && !isPlain) li.setMarker(it.marker || NO_MARKER);
      else if (it.marker && isBulletMarker(it.marker)) li.setFmt({ ...(li.getFmt() || {}), bulletMarker: it.marker });   // kept for save (the list itself is a bullet list)
      // An item with no print marker in a bulleted list (text straight inside an HTML <ul>, an ODT legal label written into the text):
      // no bullet on screen, in the braille or in the saved file, as the reader has it (it was given "•" on the way back to the model).
      // Every reader gives a bulleted item its marker ("•", or the print glyph); an item without one has no bullet in print (a Word list
      // paragraph numbered "none", an ODT legal label written into the text), and the formatter gives it none (no marker, no bullet).
      else if (!isPlain && !it.marker && !it.bullet && typeof it === 'object') li.setMarker(NO_MARKER);
      if (it.bullet && bulletName(it.bullet)) li.setFmt({ ...(li.getFmt() || {}), bullet: bulletName(it.bullet) });
      fmtFromBlock(li, it, FMT_ITEM_KEYS.filter((k) => k !== 'bullet'));   // enum / start / example / label / labelSegments / lead / termSup / ignoreFont (bullet: above)
      if (it.level != null) li.setLevel(it.level);
      if (effectiveKind) li.setBanaStyle(effectiveKind);
      // A89: an empty item saved on purpose (<li class="bana-empty"/>, read with keptEmpty; Paul 2 Oct 2026) comes back as one, holding only a space as when typed, so buildModel keeps it. Not any empty item: an emptied box must still go.
      if (!li.getChildrenSize() && it && typeof it === 'object' && it.keptEmpty && !it.blocks && !it.page) li.append($createTextNode(' '));
      // An item whose only content is a picture or another block (an HTML <li><img alt="…"></li>, 17 Oct 2026) is kept as an item of its own,
      // as the reader and Quick Mode have it (a bullet, then the picture's note), not dropped so that its picture joined the item before.
      else if (!li.getChildrenSize() && it && typeof it === 'object' && Array.isArray(it.blocks) && it.blocks.length && !it.page) li.append($createTextNode(' '));
      if (li.getChildrenSize()) list.append(li);
      // The item's further content (item.blocks, document.mjs formatItemBlocks). A further paragraph is a list line of
      // its own, flagged fmt.itemCont (no marker, no number; saved back into the item's blocks). A table or any other
      // block cannot sit inside a Lexical list item: the list stops, the block follows it (fmt.inItem) and the list goes
      // on after it (fmt.listResume); the save joins them back into one list (mergeListItemBlocks).
      for (const cb of (typeof it === 'object' && Array.isArray(it.blocks) ? it.blocks : [])) {
        if (!cb || typeof cb !== 'object') continue;
        if ((cb.type === 'para' || cb.type == null) && !cb.style && (cb.text != null || Array.isArray(cb.segments))) {
          const cli = $createListItemNode();
          fillFromBlock(cli, cb);
          cli.setFmt({ ...(cli.getFmt() || {}), itemCont: true });
          if (it.level != null) cli.setLevel(it.level);
          if (effectiveKind) cli.setBanaStyle(effectiveKind);
          if (cli.getChildrenSize()) list.append(cli);
          continue;
        }
        attachList(list);
        const before = parent.getChildrenSize();
        appendBlock(parent, cb);
        for (const n of parent.getChildren().slice(before)) if (typeof n.setFmt === 'function') n.setFmt({ ...(n.getFmt() || {}), inItem: true });
        list = makeList();
        list.setFmt({ ...(list.getFmt() || {}), listResume: true });
      }
    }
    attachList(list);
  } else if (b.type === 'indicator' || b.type === 'break') {
    const brk = $createBreakNode(b.kind || 'asterisks');
    // A19/A21 Stage 2/9: a stanza-break indicator inside a poem (parse.mjs's parsePoem tags it
    // fromPoem, same as its verse lines) keeps that tag through the editor too.
    if (b.fromPoem) brk.setFromPoem(true);
    if (b.fromPoem && b.poemId != null) brk.setPoemId(b.poemId);   // #49
    if (b.divClass) { brk.setDivClass(b.divClass); brk.setDivId(b.divId != null ? b.divId : null); }
    // A42: a stanza-break indicator inside a bare <linegroup>/<stanza> (no <poem> wrapper).
    if (b.bareLinegroup) brk.setBareLinegroup(true).setBareLinegroupId(b.bareLinegroupId != null ? b.bareLinegroupId : null);
    // A35/A40: a break indicator that fell inside a <blockquote> run (see parse.mjs's
    // tag==='blockquote' branch). Gate on blockquoteId (any run), not fromBlockquoteLines
    // (only the A35 subset that also had a <line>).
    if (b.blockquoteId != null) {
      brk.setBlockquoteId(b.blockquoteId);
      if (b.fromBlockquoteLines) brk.setFromBlockquoteLines(true);
      if (b.blockquoteClass) brk.setBlockquoteClass(b.blockquoteClass);
    }
    parent.append(brk);
  } else if (b.type === 'pagenum') {
    const pn = $createPrintPageNode(b.page || b.text || (b.implied ? '' : '1'), b);   // an implied page turn may have no number
    fmtFromBlock(pn, b, FMT_PAGENUM_KEYS);
    parent.append(pn);
  } else if (b.type === 'graphic') {
    if (b.svg) {
      const transpiled = transpileTactileSvg(b.svg, { brailleCode: settings.brailleCode });
      parent.append(fmtFromBlock($createGraphicNode(transpiled.svg || b.svg, b.alt || 'Tactile diagram', b.title || b.alt || 'Tactile diagram', true, true), b, FMT_PBB_KEYS));
    } else {
      parent.append(fmtFromBlock($createImageNode(b), b, FMT_PBB_KEYS));
    }
  } else if (b.type === 'titlepage') {
    // K29 Stage 1c: an auto page is left EMPTY here (no fields to compute yet in this generic
    // loader — Book details live on the document, not passed into appendBlock); syncTitlePages
    // (render(), called right after every modelToLexical caller) fills it from the live document
    // on the very next render pass, same as how an auto SymPageNode starts life via $createSymPageNode
    // with no entries and is filled by syncSymPages moments later.
    const auto = b.auto === true || !Array.isArray(b.segments);
    const tpNode = $createTitlePageNode(auto, '[]');
    if (!auto) { $fillTitlePage(tpNode, b.segments); tpNode.setSig(titlePageStructureSig($titlePageSegments(tpNode))); }
    parent.append(tpNode);
  } else if (b.type === 'tnpage') {
    const page = $createTnPageNode(b.heading || '');
    for (const e of (Array.isArray(b.entries) ? b.entries : [])) {
      if (!e || typeof e !== 'object') continue;
      const extra = (Array.isArray(e.paragraphs) ? e.paragraphs : []).filter((x) => x && typeof x === 'object');
      const gid = extra.length ? ++noteGroupSeq : null;
      for (const one of [e, ...extra]) {
        const p = $createParagraphNode();
        fillFromBlock(p, one.segments ? { type: 'para', segments: one.segments } : { type: 'para', text: one.text });
        if (gid != null) p.setNoteGroup(gid);
        if (p.getChildrenSize()) page.append(p);
      }
    }
    if (!page.getChildrenSize()) page.append($createParagraphNode());   // an entry-less page keeps one empty entry to type in
    parent.append(page);
  } else if (b.type === 'sympage') {
    const auto = b.auto === true && !(Array.isArray(b.entries) && b.entries.length);
    const page = $createSymPageNode(b.heading || '', auto);
    const entries = (Array.isArray(b.entries) ? b.entries : []).filter((e) => e && typeof e === 'object');
    $fillSymPage(page, auto ? [] : entries);
    page.setSig(JSON.stringify(auto ? [] : $symNodeEntries(page)));
    parent.append(page);
  } else if (b.type === 'box' || b.type === 'sidebar') {
    const sidebar = $createSidebarNode(b.title || '');
    if (b.id || b.render) sidebar.setSource(b);
    if (b.boxLines === false) sidebar.setFmt({ ...(fmtOf(sidebar) || {}), noBoxLines: true });
    if (b.boxColor) sidebar.setFmt({ ...(fmtOf(sidebar) || {}), boxColor: b.boxColor });   // K7
    fmtFromBlock(sidebar, b, FMT_PBB_KEYS);
    if (Array.isArray(b.blocks) && b.blocks.length) {
      for (const cb of b.blocks) appendBlock(sidebar, cb);         // same rules inside a sidebar, nested sidebars too (A26)
    } else if (b.text) {
      const p = $createParagraphNode();
      fillFromBlock(p, b);
      if (p.getChildrenSize()) sidebar.append(p);
    }
    if (sidebar.getChildrenSize()) parent.append(sidebar);
  } else if (b.type === 'table') {
    // A table the source did not mark keeps 'auto' (columns when they fit, else the
    // listed / paragraph fallback) — it was forced to spatial on load (A26).
    const tableNode = $createTableNode(b.headers || [], b.rows || [], b.format || 'auto', b.title ?? null, b.titlePosition || 'in-box', b.headerGroups || null);
    // K3: printAlign (read from the source file) and columnAlign (the transcriber's own
    // override) both carried straight through — see document.mjs's numericAlignApplies.
    if (Array.isArray(b.printAlign) && b.printAlign.some(Boolean)) tableNode.setPrintAlign(b.printAlign);
    if (Array.isArray(b.columnAlign) && b.columnAlign.some(Boolean)) tableNode.setColumnAlign(b.columnAlign);
    // F-5: a caption / transcriber's note the model carries on the table itself.
    if (Array.isArray(b.subdivisionRows) && b.subdivisionRows.length) tableNode.setSubdivisionRows(b.subdivisionRows);
    if (b.subdivisionHeading != null && b.subdivisionHeading !== '') tableNode.setSubdivisionHeading(b.subdivisionHeading);
    if (b.caption != null && b.caption !== '') tableNode.setCaption(b.caption);
    if (b.guideDots === false) tableNode.setNoGuideDots(true);
    fmtFromBlock(tableNode, b, FMT_TABLE_KEYS);
    if (b.tabletn != null && b.tabletn !== '') {
      tableNode.setTabletn(b.tabletn);
      tableNode.setTabletnRender(b.tabletnRender);
    }
    parent.append(tableNode);
  } else if (b.type === 'math') {
    const latex = b.latex || (b.mathml ? safeMathmlToLatex(b.mathml) : '');
    const p = $createParagraphNode();
    if (latex || b.mathml) p.append($createMathNode(latex, b.mathml || null));
    else p.append($createTextNode('⟨equation⟩'));
    parent.append(p);
  } else if ((b.type === 'verse' || b.style === 'verse' || b.style === 'poem' || b.type === 'poem' || b.type === 'poetry') && Array.isArray(b.lines) && b.lines.length > 0) {
    for (const line of b.lines) {
      const p = $createBanaParagraphNode('poem');
      p.append($createTextNode(String(line)));
      parent.append(p);
    }
  } else if (b.type === 'footnote' && Array.isArray(b.blocks) && b.blocks.length > 1 && !b.segments && !(Array.isArray(b.lines) && b.lines.length)) {
    // #57c: a footnote of several paragraphs -> one footnote paragraph per paragraph, each carrying the note's id and kind (the
    // F-113 line-break join below, in fillFromBlock, gave the second paragraph no indent of its own and saved one <p> with <br/>).
    // buildModel marks the second and later ones `noteCont`, so the formatter lays the run out as ONE note and the save writes
    // one <note> with several <p> again (nimas-export.mjs's mergeNoteGroups).
    const paras = b.blocks.filter((cb) => cb && typeof cb === 'object');
    paras.forEach((cb, i) => {
      const one = { ...b, text: cb.text, segments: cb.segments };
      delete one.blocks;
      if (one.segments === undefined) delete one.segments;
      if (i > 0) delete one.continuation;
      if (i < paras.length - 1) delete one.continued;
      appendBlock(parent, one);
    });
  } else if (b.type === 'note' && Array.isArray(b.blocks) && b.blocks.length > 1) {
    // F-164: a multi-paragraph transcriber's note -> one note paragraph per source <p>, all
    // sharing a noteGroup so save/format treat them as one note again.
    const gid = ++noteGroupSeq;
    for (const cb of b.blocks) {
      const p = $createBanaParagraphNode('note');
      p.setNoteGroup(gid);
      fillFromBlock(p, cb);
      fmtFromBlock(p, b, FMT_NOTE_KEYS);   // note-level fields ride on every paragraph of the group
      if (b.render === 'required') p.setRender('required');
      if (b.kind === 'tabletn') p.setTabletn(true);
      if (p.getChildrenSize()) parent.append(p);
    }
  } else {
    const style = getBlockBanaStyle(b);
    const p = $createBanaParagraphNode(style);
    if (b.type === 'footnote' && b.id) p.setNote({ id: b.id, kind: b.kind });
    if (b.type === 'code' && !b.segments && b.text != null) {
      // keep the spaces and line breaks of a code block (fillFromBlock would collapse them)
      String(b.text).split('\n').forEach((part, k) => { if (k > 0) p.append($createLineBreakNode()); if (part) p.append($createTextNode(part)); });
    } else fillFromBlock(p, b);
    // A89: an empty paragraph saved on purpose (<p class="bana-empty"/>, read with keptEmpty; Paul 2 Oct 2026) comes back as one, holding only a space as when typed, so buildModel keeps it. Not any empty paragraph: a new box's empty paragraph must stay empty, or emptying the box no longer removes it (test-empty-containers).
    if (b.type === 'para' && b.keptEmpty && !b.style && !p.getChildrenSize()) p.append($createTextNode(' '));
    fmtFromBlock(p, b, FMT_PARA_KEYS);
    if (b.type === 'xref') p.setFmt({ ...(p.getFmt() || {}), xref: true, xrefHeading: b.heading || null });   // F-104 cross-reference note
    if (b.continued || b.continuation) p.setPageTurn(b.continued && b.continuation ? 'both' : (b.continued ? 'continued' : 'continuation'));
    if (b.blocked) p.setBlocked(true);   // F-39 — BANA §1.9.3
    // A22 / A19-A21 Stage 7/9: an imported <prodnote render="required"> note block.
    if (b.type === 'note' && b.render === 'required') p.setRender('required');
    // F-5: a table's transcriber's note keeps its kind through the editor.
    if (b.type === 'note' && b.kind === 'tabletn') p.setTabletn(true);
    // A19/A21 Stage 2/9: a verse line read from a genuine <poem> (D5).
    if (b.fromPoem) p.setFromPoem(true);
    if (b.playVerse) p.setPlayVerse(true);   // verse drama (D5)
    if (b.poemId != null && (b.fromPoem || b.type === 'attribution')) p.setPoemId(b.poemId);   // #49: its poem
    if (b.poemRole && b.type === 'attribution') p.setPoemRole(b.poemRole);   // #49: a poem's author / byline
    // A42: a verse line read from a bare <linegroup>/<stanza> (no <poem> wrapper) must save
    // back without inventing one — see nimas-export.mjs's renderPoemRun's wrapInPoem flag.
    if (b.bareLinegroup) p.setBareLinegroup(true).setBareLinegroupId(b.bareLinegroupId != null ? b.bareLinegroupId : null);
    // A35: a verse line read from a genuine source <line> element (not D5's bare verse drama).
    if (b.fromLineTag) p.setFromLineTag(true);
    // A19/A21 Stage 5/9: a generic <div class="…"> wrapper (see parse.mjs's walk()).
    if (b.divClass) { p.setDivClass(b.divClass); p.setDivId(b.divId != null ? b.divId : null); }
    // A35/A40: a run of blocks from one source <blockquote> that needed the run mechanism (see
    // parse.mjs's tag==='blockquote' branch). Gate on blockquoteId (any run), not
    // fromBlockquoteLines (only the A35 subset that also had a <line>).
    if (b.blockquoteId != null) {
      p.setBlockquoteId(b.blockquoteId);
      if (b.fromBlockquoteLines) p.setFromBlockquoteLines(true);
      if (b.blockquoteClass) p.setBlockquoteClass(b.blockquoteClass);
    }
    parent.append(p);
  }
}

function modelToLexical(model) {
  window.modelToLexical = modelToLexical;
  clearTranslationCache();
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    for (const b of (model.blocks || [])) appendBlock(root, b);
    if (!root.getFirstChild()) root.append($createParagraphNode());
  }, { discrete: true });
}
window.modelToLexical = modelToLexical;
window.render = render;
window.importFile = importFile;
function setLoadingProgress(pct, msg, title) {
  const pctEl = $id('loadingPercent');
  const msgEl = $id('loadingMsg');
  const titleEl = $id('loadingTitle');
  const rounded = Math.min(100, Math.max(0, Math.round(pct)));
  if (pctEl) pctEl.textContent = `${rounded}%`;
  if (msg && msgEl) msgEl.textContent = msg;
  if (title && titleEl) titleEl.textContent = title;
}

function showLoading(title, msg) {
  const ov = $id('loadingOverlay');
  if (ov) {
    setLoadingProgress(10, msg || 'Reading document file…', title || 'Loading document…');
    ov.hidden = false;
  }
  if (editorEl) editorEl.setAttribute('aria-busy', 'true');
}

function hideLoading() {
  const ov = $id('loadingOverlay');
  if (ov) ov.hidden = true;
  if (editorEl) editorEl.removeAttribute('aria-busy');
}

let importing = false;
async function importFile(file) {
  if (!file || importing) return;                             // a second drop while one is still parsing would clobber it
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext !== 'svg' && isDocumentDirty()) {
    const ok = window.confirm(t('messages.unsaved_load', 'You have unsaved changes. Loading a new file will replace your current document. Continue?'));
    if (!ok) return;
  }
  const big = ext !== 'svg' ? largeFileWarning(file.name, file.size) : null;   // a very large book asks first (A89 / A90)
  if (big && !window.confirm(largeFileQuestion(t, big))) return;
  importing = true;
  
  // Calculate equal step duration based on file size:
  // e.g. 50KB -> 500ms total (~50ms/step), 1.5MB -> 2000ms total (~200ms/step)
  const fileSize = (file && file.size) || 50000;
  const stepMs = Math.max(50, Math.min(220, Math.round(fileSize / 7000)));
  
  showLoading(t('loading.title') || `Loading ${file.name}…`, t('loading.reading_file') || 'Reading document file…');
  setLoadingProgress(10, t('loading.reading_file') || 'Reading document file…', t('loading.title') || `Loading ${file.name}…`);
  
  let currentPct = 10;
  let active = true;
  
  // Steady periodic timer that ticks in exact equal intervals:
  const timerId = setInterval(() => {
    if (!active) return;
    if (currentPct < 90) {
      currentPct += 10;
      let msg = t('loading.processing_elements') || 'Processing document…';
      if (currentPct <= 20) msg = t('loading.reading_payload') || 'Reading file payload…';
      else if (currentPct <= 40) msg = t('loading.parsing_structure') || 'Parsing document structure…';
      else if (currentPct <= 60) msg = t('loading.building_editor') || 'Building editor document…';
      else if (currentPct <= 80) msg = t('loading.translating_braille') || 'Translating & formatting braille…';
      else if (currentPct <= 90) msg = t('loading.finalizing') || 'Finalizing braille pages…';
      setLoadingProgress(currentPct, msg);
    }
  }, stepMs);

  try {
    if (reader.speaking) reader.stop();
    hideParseWarning();
    setStatus(t('app.import.importing', { name: file.name }));
    
    if (ext === 'svg') {
      const svgText = await file.text();
      insertGraphicDiagram(svgText, { title: file.name.replace(/\.svg$/i, '') });
      active = false;
      clearInterval(timerId);
      setLoadingProgress(100, t('common.done') || 'Done');
      announce(t('app.import.svg_done', { name: file.name }));
      await new Promise((r) => setTimeout(r, 200));
      return;
    }
    
    // Read file payload
    const payload = BINARY_EXTS.has(ext) ? await file.arrayBuffer() : await file.text();
    await new Promise((r) => setTimeout(r, 10));
    
    // Parse file
    const model = await parseFile(file.name, payload);
    // A document Emboss saved empty (after Clear, say) opens as an empty document; any other file with nothing readable is an
    // error, as before (A89, the nightly random-action run: the reopened tab had kept its starting document instead).
    const embossSavedEmpty = model && !(model.blocks || []).length && typeof payload === 'string' && /<meta name="dc:Publisher" content="Emboss Braille Editor"/.test(payload);
    if (!model || (!(model.blocks || []).length && !embossSavedEmpty)) throw new Error('No readable content found in this file');
    await new Promise((r) => setTimeout(r, 10));
    
    // Build Lexical editor model
    setLoadedDocInfo(model);
    modelToLexical(model);
    await new Promise((r) => setTimeout(r, 10));
    
    // Format to braille and render
    clearTimeout(timer);
    await render();
    
    // Stop the timer and complete cleanly
    active = false;
    clearInterval(timerId);
    setLoadingProgress(100, t('loading.complete') || 'Formatting complete!');
    clearAutosaveSnapshot();   // loading a new document replaces whatever the old one's autosave backup held
    markDocumentClean();
    resetUndoHistory();
    announce(t('app.import.done', { name: file.name }));
    if (model.warnings && model.warnings.length) {
      showParseWarning(t('app.import.notice', { message: model.warnings.join('; ') }));
    }
    // Hold at 100% for 200ms so user clearly sees 100% complete
    await new Promise((resolve) => setTimeout(resolve, 200));
  } catch (err) {
    active = false;
    clearInterval(timerId);
    console.error(err);
    const msg = String((err && err.message) || err);
    if (err && err.userFacing) {
      // A hard failure (password-protected, damaged, Word 6/95, not a Word file — see
      // parseDocxSniffed/doc.mjs's userError): the file could not be read at all, so nothing
      // was parsed and the current document is untouched. Show the reader's own plain message
      // as an error, not the "partial parse, continue editing" wording — that would wrongly
      // suggest the file was partly loaded.
      setStatus(t('app.import.failed_status', { message: msg }));
      showParseWarning(msg, true);
      announce(t('app.import.failed', { name: file.name, message: msg }));
    } else {
      setStatus(t('app.import.notice_status', { message: msg }));
      showParseWarning(t('app.import.partial', { name: file.name, message: msg.replace(/\.\s*$/, '') }));
      announce(t('app.import.notice_status', { message: msg }));
    }
  } finally {
    active = false;
    clearInterval(timerId);
    importing = false;
    hideLoading();
  }
}
window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault(); document.body.classList.remove('dropping');
  importFile(e.dataTransfer.files[0]);
});

const loadFileBtn = $id('loadFileBtn');
const loadFileInput = $id('loadFileInput');
if (loadFileBtn && loadFileInput) {
  loadFileBtn.addEventListener('click', () => loadFileInput.click());
  loadFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      importFile(file);
      loadFileInput.value = '';
    }
  });
}

// ---- Parse Warning Callout Banner ----
const parseWarningBanner = $id('parseWarningBanner');
const parseWarningText = $id('parseWarningText');
const parseWarningClose = $id('parseWarningClose');

// Interface text for scripts that cannot import i18n (the service-worker update prompt,
// format/ modules): the translation, or the given English fallback (A33).
function uiText(key, params = {}, fallback = '') {
  const v = t(key, params);
  return v && v !== key ? v : String(fallback).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}
window.embossT = uiText;

// `isError` (a hard failure — the file could not be read at all) swaps the banner's amber
// "Notice" styling and label for a red "Error" one and makes it an assertive live region, so a
// screen reader announces it immediately rather than waiting to be discovered like a notice.
function showParseWarning(msg, isError = false) {
  if (parseWarningBanner && parseWarningText) {
    parseWarningText.textContent = msg;
    parseWarningBanner.hidden = false;
    // .is-error swaps the amber "Notice" label/styling for a red "Error" one (CSS: .notice-label
    // / .error-label) and switches the live region from polite (status) to assertive (alert) so
    // a hard load failure interrupts and is announced immediately, unlike an ordinary notice.
    parseWarningBanner.classList.toggle('is-error', !!isError);
    parseWarningBanner.setAttribute('role', isError ? 'alert' : 'status');
  }
}
function hideParseWarning() {
  if (parseWarningBanner) parseWarningBanner.hidden = true;
}
if (parseWarningClose) parseWarningClose.addEventListener('click', hideParseWarning);

// ---- Plain notice about symbols a reader may not know (Transcriber tools off) ----
// Paul's decision (docs/transcriber-tools-setting.md): ordinary users are still told about odd symbols. When the
// document uses a special symbol (collectSpecialSymbols: a sub-level or non-dot bullet, a literal braille symbol) or a
// print character with no braille equivalent (the formatter's o.untranslatable, F-213) and Transcriber tools is off,
// a dismissible notice offers to add ONE ordinary paragraph explaining them -- no formal Special Symbols page. A document
// with its own Special Symbols page explains them already. Dismissing (or adding the line) hides the notice until the
// set of symbols changes. It never changes the braille of anything else.
const seenUntranslatable = new Map();   // char -> code point; a render that reuses cached blocks does not report them again
let symbolNoticeDismissed = null;       // signature of the symbol set the user dismissed or explained
let symbolNoticeItems = [];
function symbolNoticeList(model, fo) {
  const blocks = model && Array.isArray(model.blocks) ? model.blocks : [];
  if (blocks.some((b) => b && b.type === 'sympage')) return [];
  const out = [];
  let found = [];
  try { found = collectSpecialSymbols(blocks, fo || {}); } catch (err) { console.warn('symbol notice', err); }
  // `description` must be forwarded: a 'typeform' entry (hyperlink, F-233, or strikethrough,
  // UEB 9.5.1) has no `print`/`name` of its own — symbolMeaning falls through to '' without it,
  // silently dropping the notice's wording for both (task requirement: this notice must name
  // them, same as the Special Symbols page does).
  for (const e of found) out.push({ print: String(e.print ?? '').trim(), meaning: symbolMeaning({ print: e.print, name: e.name, description: e.description }) });
  for (const u of (fo && fo.untranslatable) || []) if (u && u.char) seenUntranslatable.set(u.char, u.codePoint);
  if (seenUntranslatable.size) {
    const json = JSON.stringify(blocks);
    // PROVISIONAL wording (Emboss's own; no transcriber-approved text yet).
    for (const [ch] of seenUntranslatable) if (json.includes(ch)) out.push({ print: ch, meaning: 'a print symbol with no braille equivalent, shown as a full cell' });
  }
  return out;
}
// The explaining line, e.g. "Symbols used: □ hollow square bullet; ▲ triangle bullet." PROVISIONAL wording, built from
// the formatter's own symbolMeaning (the Special Symbols page's wording) until transcribers give theirs.
function symbolNoticeLine(items) {
  const lower = (x) => (x ? x.charAt(0).toLowerCase() + x.slice(1) : '');
  const parts = items.map((i) => (i.print && i.meaning && i.meaning.toLowerCase() !== i.print.toLowerCase() ? `${i.print} ${lower(i.meaning)}` : (i.print || lower(i.meaning))));
  return `Symbols used: ${parts.join('; ')}.`;
}
const symbolNoticeSig = (items) => items.map((i) => `${i.print}\u0001${i.meaning}`).join('\u0002');
function updateSymbolNotice(model, fo) {
  const banner = $id('symbolNoticeBanner');
  if (!banner) return;
  const items = transcriberToolsOn() ? [] : symbolNoticeList(model, fo);
  symbolNoticeItems = items;
  const show = items.length > 0 && symbolNoticeSig(items) !== symbolNoticeDismissed;
  if (show) {
    const txt = $id('symbolNoticeText');
    // Each symbol with its name (feedback 30 Sep item 7, Paul, 1 Oct: "■ - ○" alone did not say what they were).
    const lower = (x) => (x ? x.charAt(0).toLowerCase() + x.slice(1) : '');
    const named = items.map((i) => (i.print && i.meaning && i.meaning.toLowerCase() !== i.print.toLowerCase() ? `${i.print} ${lower(i.meaning)}` : (i.print || lower(i.meaning)))).join(', ');
    if (txt) txt.textContent = t('app.symbol_notice.text', { symbols: named });
  }
  banner.hidden = !show;
}
function addSymbolExplanation() {
  const items = symbolNoticeItems;
  if (!items.length) return;
  const line = symbolNoticeLine(items);
  editor.update(() => {
    const root = $getRoot();
    const p = $createParagraphNode();
    p.append($createTextNode(line));
    const first = root.getFirstChild();
    // After a leading title heading (so the document still opens with its title); otherwise at the very start.
    if (first && $isHeadingNode(first)) first.insertAfter(p);
    else if (first) first.insertBefore(p);
    else root.append(p);
  });
  symbolNoticeDismissed = symbolNoticeSig(items);
  const banner = $id('symbolNoticeBanner'); if (banner) banner.hidden = true;
  clearTranslationCache();
  scheduleRender();
  announce(t('app.symbol_notice.added'));
}
$id('symbolNoticeAdd')?.addEventListener('click', addSymbolExplanation);
$id('symbolNoticeClose')?.addEventListener('click', () => {
  symbolNoticeDismissed = symbolNoticeSig(symbolNoticeItems);
  const banner = $id('symbolNoticeBanner'); if (banner) banner.hidden = true;
});

let codesExpanded = false;
const displayNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }) : null;

function getLanguageLabel(c) {
  let name = c.lang;
  try { if (displayNames) name = displayNames.of(c.lang) || c.lang; } catch { /* fallback */ }
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return `${name}${c.grade ? ' (' + c.grade + ')' : ''}`;
}

function populateUiLanguageDropdown() {
  const sel = $id('set-uiLanguage');
  if (!sel) return;
  const current = settings.uiLanguage || getLocale() || 'en';
  const ordered = getOrderedLocales(current);
  sel.innerHTML = '';
  for (const loc of ordered) {
    const opt = document.createElement('option');
    opt.value = loc.code;
    opt.textContent = `${loc.nativeName} (${loc.name})`;
    sel.appendChild(opt);
  }
  sel.value = current;
}

function populateLanguageDropdown() {
  const sel = $id('set-language');
  if (!sel) return;
  const inUseCode = settings.brailleCode || `${settings.language}_${settings.grade}`;
  const recentList = Array.isArray(settings.recentCodes) && settings.recentCodes.length
    ? [...settings.recentCodes]
    : [inUseCode];
  if (inUseCode && !recentList.includes(inUseCode)) {
    recentList.unshift(inUseCode);
  }
  const topCodes = recentList.slice(0, 5);

  const loc = (navigator.language || 'en').split('-');
  const sysLang = (loc[0] || 'en').toLowerCase();

  // Rank:
  // 0-4: Up to 5 recently chosen codes (PINNED AT THE VERY TOP!)
  // 10: System locale language codes (e.g. English for en-GB)
  // 20: All other languages
  const rank = (c) => {
    const idx = topCodes.indexOf(c.id);
    if (idx !== -1) return idx;
    if (c.lang === sysLang) return 10;
    return 20;
  };

  const near = CODES.filter((c) => rank(c) < 20);
  const base = codesExpanded || !near.length ? CODES : near;

  // Sort by rank first (Top 5 & Local top), then alphabetically by Display Name
  const shownCodes = base.slice().sort((a, b) => {
    const rA = rank(a), rB = rank(b);
    if (rA !== rB) return rA - rB;
    const nameA = getLanguageLabel(a);
    const nameB = getLanguageLabel(b);
    return nameA.localeCompare(nameB);
  });
  const restCount = CODES.length - shownCodes.length;

  sel.innerHTML = '';
  for (const c of shownCodes) {
    const label = getLanguageLabel(c);
    sel.appendChild(new Option(c.shipped !== false ? label : t('app.codes.needs_internet', { label }), c.id));
  }
  if (!codesExpanded && restCount > 0) {
    sel.appendChild(new Option(t('app.codes.more', { count: restCount }), '__more__'));
  }
  if (inUseCode && CODES.some((c) => c.id === inUseCode)) {
    sel.value = inUseCode;
  } else if (sel.options.length) {
    sel.value = sel.options[0].value;
  }
}

// ---- Braille View / Monarch / DotPad Tab Management & Emulators ----
let currentBrailleTab = 'braille';
let dotpadInvertDisplay = false;
let monarchInvertDisplay = false;

function drawMonarchCanvas(canvas, activeFrame) {
  if (!canvas || !activeFrame) return 0;
  const ctx = canvas.getContext('2d');
  const width = canvas.width || 680;
  const height = canvas.height || 260;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  const isGraphic = Boolean(activeFrame.isGraphic && activeFrame.graphicMatrix);
  const startLine = activeFrame.startLine || 0;
  let raisedCount = 0;

  if (isGraphic) {
    // Continuous 64x40 Tactile Pin Grid for Graphics Mode (320 cells x 8 bits = 2560 pins)
    const cols = 64; // 32 cells * 2 pins
    const rows = 40; // 10 lines * 4 pins
    const marginX = 14;
    const marginY = 12;
    const gridW = width - (marginX * 2);
    const gridH = height - (marginY * 2);
    const stepX = gridW / (cols - 1);
    const stepY = gridH / (rows - 1);
    const matrix = activeFrame.graphicMatrix;

    for (let r = 0; r < rows; r++) {
      const cellRow = Math.floor(r / 4); // 0..9
      const bitInCell = r % 4;           // 0..3

      for (let c = 0; c < cols; c++) {
        const cellCol = Math.floor(c / 2); // 0..31
        const isRightCol = (c % 2) === 1;
        const cellIdx = (cellRow * 32) + cellCol;
        let isRaised = false;

        if (matrix && cellIdx < matrix.length) {
          const mask = matrix[cellIdx];
          const bit = isRightCol
            ? (bitInCell === 0 ? 0x08 : (bitInCell === 1 ? 0x10 : (bitInCell === 2 ? 0x20 : 0x80)))
            : (bitInCell === 0 ? 0x01 : (bitInCell === 1 ? 0x02 : (bitInCell === 2 ? 0x04 : 0x40)));
          isRaised = Boolean(mask & bit);
        }

        if (monarchInvertDisplay) isRaised = !isRaised;

        const px = marginX + (c * stepX);
        const py = marginY + (r * stepY);

        if (isRaised) {
          raisedCount++;
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#e9f2fc';
          ctx.shadowColor = '#2a7de1';
          ctx.shadowBlur = 4;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#30363d';
          ctx.fill();
        }
      }
    }
  } else {
    // Discrete 32 cells x 10 lines Braille Mode with inter-cell gaps and word highlighting
    const numCols = 32;
    const numLines = 10;
    const bRows = 4;
    const marginX = 14;
    const marginY = 12;
    const gridW = width - (marginX * 2);
    const gridH = height - (marginY * 2);

    const cellStepX = gridW / numCols;
    const lineStepY = gridH / numLines;
    const dotStepX = (cellStepX * 0.44) / 1;
    const dotStepY = (lineStepY * 0.65) / (bRows - 1);

    // Pre-calculate highlighted cells per line (0..9) directly from trace & activeWordHighlight
    const lineHighlightCols = [];
    for (let lr = 0; lr < numLines; lr++) {
      const docLine = startLine + lr;
      const hlCols = new Set();
      const rBlock = lastTrace?.rows ? lastTrace.rows[docLine] : null;
      const rCells = lastTrace?.rowCells ? lastTrace.rowCells[docLine] : null;
      if (activeWordHighlight && rBlock === activeWordHighlight.block && rCells) {
        const { unit, s, e } = activeWordHighlight;
        for (let ci = 0; ci < rCells.length; ci++) {
          const src = rCells[ci];
          if (src && Number(src.u) === unit && src.c >= s && src.c < e) {
            hlCols.add(ci);
          }
        }
      }
      lineHighlightCols.push(hlCols);

      for (const colIdx of hlCols) {
        if (colIdx >= 0 && colIdx < numCols) {
          const px0 = marginX + (colIdx * cellStepX) + 1;
          const bw = cellStepX - 2;
          const py0 = marginY + (lr * lineStepY) + 1;
          const bh = lineStepY - 2;
          ctx.fillStyle = 'rgba(252, 237, 191, 0.24)';
          ctx.strokeStyle = '#f5b800';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(px0, py0, bw, bh, 3);
          else ctx.rect(px0, py0, bw, bh);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    for (let lr = 0; lr < numLines; lr++) {
      const hlSet = lineHighlightCols[lr];
      const rowBytes = activeFrame.viewportLines ? activeFrame.viewportLines[lr] : null;
      const textRow = activeFrame.textRows ? activeFrame.textRows[lr] : null;
      const docLine = startLine + lr;

      for (let cIdx = 0; cIdx < numCols; cIdx++) {
        let mask = 0;
        if (rowBytes && rowBytes[cIdx] != null) {
          mask = rowBytes[cIdx];
        } else if (textRow && cIdx < textRow.length) {
          const char = textRow[cIdx];
          mask = (typeof char === 'number') ? char : charToDotMask(char);
        }

        const isCellHighlighted = hlSet && hlSet.has(cIdx);
        const cellLeftX = marginX + (cIdx * cellStepX) + (cellStepX * 0.28);
        const cellTopY = marginY + (lr * lineStepY) + (lineStepY * 0.16);

        for (let br = 0; br < bRows; br++) {
          for (let col = 0; col < 2; col++) {
            const isRight = (col === 1);
            const bit = isRight
              ? (br === 0 ? 0x08 : (br === 1 ? 0x10 : (br === 2 ? 0x20 : 0x80)))
              : (br === 0 ? 0x01 : (br === 1 ? 0x02 : (br === 2 ? 0x04 : 0x40)));
            let isRaised = Boolean(mask & bit);

            if (docLine === activeCaretLine && cIdx === activeCaretCol && br === 3) {
              isRaised = true;
            }

            if (monarchInvertDisplay) isRaised = !isRaised;

            const px = cellLeftX + (col * dotStepX);
            const py = cellTopY + (br * dotStepY);

            if (isRaised) {
              raisedCount++;
              ctx.beginPath();
              ctx.arc(px, py, 2.2, 0, Math.PI * 2);
              const pinColor = isCellHighlighted ? '#fcedbf' : '#e9f2fc';
              const shadowColor = isCellHighlighted ? '#f5b800' : '#e9f2fc';
              ctx.fillStyle = pinColor;
              ctx.shadowColor = shadowColor;
              ctx.shadowBlur = 3;
              ctx.fill();
              ctx.shadowBlur = 0;
            } else {
              ctx.beginPath();
              ctx.arc(px, py, 1.1, 0, Math.PI * 2);
              ctx.fillStyle = isCellHighlighted ? '#5c4415' : '#30363d';
              ctx.fill();
            }
          }
        }
      }
    }
  }

  return raisedCount;
}

function drawMonarchEmulator(activeFrame) {
  if (!activeFrame && typeof tactileDisplay !== 'undefined') activeFrame = tactileDisplay.getMonarchActiveFrame();
  if (!activeFrame) return;

  drawMonarchCanvas($id('monarchPanelCanvas'), activeFrame);

  const startLine = activeFrame.startLine || 0;
  const endLine = Math.min(activeFrame.totalLines || 1, startLine + 10);
  const subtitle = t('app.panels.monarch_subtitle', { from: startLine + 1, to: endLine, lines: activeFrame.totalLines || 1, page: activeFrame.pageNumber || 1, pages: activeFrame.totalPages || 1 });

  if ($id('monarchPanelSubtitle')) $id('monarchPanelSubtitle').textContent = subtitle;
}

function drawDotPadUpperCanvas(canvas, activeFrame) {
  if (!canvas || !activeFrame) return 0;
  const ctx = canvas.getContext('2d');
  const width = canvas.width || 520;
  const height = canvas.height || 340;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  const isGraphic = activeFrame.isGraphic && activeFrame.graphicMatrix;
  const matrix = activeFrame.graphicMatrix;

  const cols = 60;
  const rows = 40;
  const marginX = 16;
  const marginY = 14;
  const gridW = width - (marginX * 2);
  const gridH = height - (marginY * 2);
  const stepX = gridW / (cols - 1);
  const stepY = gridH / (rows - 1);

  const startLine = activeFrame.startLine || 0;

  // Pre-calculate highlighted cells per line (0..9) directly from trace & activeWordHighlight
  const lineHighlightCols = [];
  if (!isGraphic) {
    for (let lr = 0; lr < 10; lr++) {
      const docLine = startLine + lr;
      const hlCols = new Set();
      const rBlock = lastTrace?.rows ? lastTrace.rows[docLine] : null;
      const rCells = lastTrace?.rowCells ? lastTrace.rowCells[docLine] : null;
      if (activeWordHighlight && rBlock === activeWordHighlight.block && rCells) {
        const { unit, s, e } = activeWordHighlight;
        for (let ci = 0; ci < rCells.length; ci++) {
          const src = rCells[ci];
          if (src && Number(src.u) === unit && src.c >= s && src.c < e) {
            hlCols.add(ci);
          }
        }
      }
      lineHighlightCols.push(hlCols);

      // Draw bounding boxes behind highlighted cells
      for (const colIdx of hlCols) {
        if (colIdx >= 0 && colIdx < 20) {
          const px0 = marginX + ((colIdx * 3) * stepX) - 4;
          const bw = (1 * stepX) + 8;
          const py0 = marginY + ((lr * 4) * stepY) - 4;
          const bh = (3 * stepY) + 8;
          ctx.fillStyle = 'rgba(252, 237, 191, 0.24)';
          ctx.strokeStyle = '#f5b800';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(px0, py0, bw, bh, 4);
          else ctx.rect(px0, py0, bw, bh);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  let raisedCount = 0;

  for (let r = 0; r < rows; r++) {
    const cellRow = Math.floor(r / 4); // 0..9
    const bitInCell = r % 4;           // 0..3
    const hlSet = lineHighlightCols[cellRow];

    for (let c = 0; c < cols; c++) {
      let isRaised = false;
      let isCellHighlighted = false;

      if (isGraphic && matrix) {
        // Continuous 60x40 tactile graphics matrix (300 cells x 8 bits = 2400 pixels)
        const cellCol = Math.floor(c / 2); // 0..29
        const isRightCol = (c % 2) === 1;
        const cellIdx = (cellRow * 30) + cellCol;
        if (cellIdx < matrix.length) {
          const mask = matrix[cellIdx];
          const bit = isRightCol
            ? (bitInCell === 0 ? 0x08 : (bitInCell === 1 ? 0x10 : (bitInCell === 2 ? 0x20 : 0x80)))
            : (bitInCell === 0 ? 0x01 : (bitInCell === 1 ? 0x02 : (bitInCell === 2 ? 0x04 : 0x40)));
          isRaised = Boolean(mask & bit);
        }
      } else if (!isGraphic) {
        // Text Stream: 20 cells per line with 1-pin blank column separator (2 pins cell + 1 pin gap = 3 pins/cell)
        const cellCol = Math.floor(c / 3); // 0..19
        const colInCell = c % 3;           // 0 = left col, 1 = right col, 2 = blank separator

        if (colInCell < 2 && cellCol < 20) {
          const rowBytes = activeFrame.viewportLines ? activeFrame.viewportLines[cellRow] : null;
          const mask = rowBytes ? rowBytes[cellCol] : 0;
          const bit = (colInCell === 1)
            ? (bitInCell === 0 ? 0x08 : (bitInCell === 1 ? 0x10 : (bitInCell === 2 ? 0x20 : 0x80)))
            : (bitInCell === 0 ? 0x01 : (bitInCell === 1 ? 0x02 : (bitInCell === 2 ? 0x04 : 0x40)));
          isRaised = Boolean(mask & bit);
          if (hlSet && hlSet.has(cellCol)) {
            isCellHighlighted = true;
          }
          // Caret Dots: On the active cell, raise both Dot 7 and Dot 8 (4th row baseline pins)
          const docLine = startLine + cellRow;
          if (docLine === activeCaretLine && cellCol === activeCaretCol && bitInCell === 3) {
            isRaised = true;
          }
        }
      }

      if (dotpadInvertDisplay) isRaised = !isRaised;

      const px = marginX + (c * stepX);
      const py = marginY + (r * stepY);

      if (isRaised) {
        raisedCount++;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        const pinColor = isCellHighlighted ? '#fcedbf' : '#e9f2fc';
        const shadowColor = isCellHighlighted ? '#f5b800' : '#e9f2fc';
        ctx.fillStyle = pinColor;
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = isCellHighlighted ? '#5c4415' : '#30363d';
        ctx.fill();
      }
    }
  }

  return raisedCount;
}

function drawDotPadTextCanvas(canvas, activeFrame) {
  if (!canvas || !activeFrame) return 0;
  const ctx = canvas.getContext('2d');
  const width = canvas.width || 520;
  const height = canvas.height || 70;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  const brailleLine = activeFrame.brailleLine || '';
  const numCells = 20;
  const bRows = 4;
  const cols = 60;
  const marginX = 16;
  const gridW = width - (marginX * 2);
  const stepX = gridW / (cols - 1);
  const stepY = 8.0;
  const cellHeight = (bRows - 1) * stepY;
  const marginY = (height - cellHeight) / 2;

  const activeLine = (typeof activeFrame.activeLine === 'number') ? activeFrame.activeLine : (activeFrame.startLine || 0);
  const hlCols = new Set();
  const rBlock = lastTrace?.rows ? lastTrace.rows[activeLine] : null;
  const rCells = lastTrace?.rowCells ? lastTrace.rowCells[activeLine] : null;
  if (activeWordHighlight && rBlock === activeWordHighlight.block && rCells) {
    const { unit, s, e } = activeWordHighlight;
    for (let ci = 0; ci < rCells.length; ci++) {
      const src = rCells[ci];
      if (src && Number(src.u) === unit && src.c >= s && src.c < e) {
        hlCols.add(ci);
      }
    }
  }

  if (hlCols.size > 0) {
    for (const colIdx of hlCols) {
      if (colIdx >= 0 && colIdx < numCells) {
        const px0 = marginX + ((colIdx * 3) * stepX) - 4;
        const bw = (1 * stepX) + 8;
        const py0 = marginY - 4;
        const bh = cellHeight + 8;
        ctx.fillStyle = 'rgba(252, 237, 191, 0.24)';
        ctx.strokeStyle = '#f5b800';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px0, py0, bw, bh, 4);
        else ctx.rect(px0, py0, bw, bh);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  let raisedCount = 0;

  for (let cIdx = 0; cIdx < numCells; cIdx++) {
    const char = brailleLine[cIdx] || ' ';
    const mask = (typeof char === 'number') ? char : charToDotMask(char);
    const isCellHighlighted = hlCols.has(cIdx);
    const cellLeftX = marginX + (cIdx * 3 * stepX);

    for (let br = 0; br < bRows; br++) {
      for (let col = 0; col < 2; col++) {
        const isRight = (col === 1);
        const bit = isRight
          ? (br === 0 ? 0x08 : (br === 1 ? 0x10 : (br === 2 ? 0x20 : 0x80)))
          : (br === 0 ? 0x01 : (br === 1 ? 0x02 : (br === 2 ? 0x04 : 0x40)));
        let isRaised = Boolean(mask & bit);
        // Caret Dots: On the active cell, raise both Dot 7 and Dot 8 (4th row baseline pins)
        if (activeLine === activeCaretLine && cIdx === activeCaretCol && br === 3) {
          isRaised = true;
        }
        if (dotpadInvertDisplay) isRaised = !isRaised;

        const px = cellLeftX + (col * stepX);
        const py = marginY + (br * stepY);

        if (isRaised) {
          raisedCount++;
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          const pinColor = isCellHighlighted ? '#fcedbf' : '#e9f2fc';
          const shadowColor = isCellHighlighted ? '#f5b800' : '#e9f2fc';
          ctx.fillStyle = pinColor;
          ctx.shadowColor = shadowColor;
          ctx.shadowBlur = 4;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = isCellHighlighted ? '#5c4415' : '#30363d';
          ctx.fill();
        }
      }
    }
  }

  return raisedCount;
}

function drawDotPadEmulator(activeFrame) {
  if (!activeFrame && typeof tactileDisplay !== 'undefined') activeFrame = tactileDisplay.getDotPadActiveFrame();
  if (!activeFrame) return;

  drawDotPadUpperCanvas($id('dotpadPanelCanvas'), activeFrame);
  drawDotPadTextCanvas($id('dotpadTextCanvas'), activeFrame);

  const isGraphic = activeFrame.isGraphic && activeFrame.graphicMatrix;
  const typeLabel = isGraphic ? t('app.panels.tactile_graphic') : t('app.panels.text_stream');
  const subtitle = t('app.panels.dotpad_subtitle', { page: activeFrame.pageNumber || 1, pages: activeFrame.totalPages || 1, type: typeLabel });

  if ($id('dotpadPanelSubtitle')) $id('dotpadPanelSubtitle').textContent = subtitle;
}

function switchBrailleTab(tab) {
  currentBrailleTab = tab;
  programmaticScrollUntil = performance.now() + 1000;
  cancelScrollSync();
  const tabViewBraille = $id('tabViewBraille');
  const tabViewDotPad = $id('tabViewDotPad');
  const tabViewMonarch = $id('tabViewMonarch');
  const braillePane = $id('braille');
  const dotpadPanel = $id('dotpadPanel');
  const monarchPanel = $id('monarchPanel');

  tabViewBraille?.classList.remove('active');
  tabViewBraille?.setAttribute('aria-selected', 'false');
  tabViewDotPad?.classList.remove('active');
  tabViewDotPad?.setAttribute('aria-selected', 'false');
  tabViewMonarch?.classList.remove('active');
  tabViewMonarch?.setAttribute('aria-selected', 'false');

  if (tab === 'monarch') {
    if (typeof tactileDisplay !== 'undefined' && tactileDisplay.setDeviceProfile) {
      tactileDisplay.setDeviceProfile('monarch');
    }
    tabViewMonarch?.classList.add('active');
    tabViewMonarch?.setAttribute('aria-selected', 'true');
    if (braillePane) {
      braillePane._savedScrollTop = braillePane.scrollTop;
      braillePane.style.display = 'none';
    }
    if (dotpadPanel) dotpadPanel.style.display = 'none';
    if (monarchPanel) {
      monarchPanel.style.display = 'flex';
      drawMonarchEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getMonarchActiveFrame() : null);
    }
  } else if (tab === 'dotpad') {
    if (typeof tactileDisplay !== 'undefined' && tactileDisplay.setDeviceProfile) {
      tactileDisplay.setDeviceProfile('dotpad');
    }
    tabViewDotPad?.classList.add('active');
    tabViewDotPad?.setAttribute('aria-selected', 'true');
    if (braillePane) {
      braillePane._savedScrollTop = braillePane.scrollTop;
      braillePane.style.display = 'none';
    }
    if (monarchPanel) monarchPanel.style.display = 'none';
    if (dotpadPanel) {
      dotpadPanel.style.display = 'flex';
      drawDotPadEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getDotPadActiveFrame() : null);
    }
  } else {
    tabViewBraille?.classList.add('active');
    tabViewBraille?.setAttribute('aria-selected', 'true');
    if (dotpadPanel) dotpadPanel.style.display = 'none';
    if (monarchPanel) monarchPanel.style.display = 'none';
    if (braillePane) {
      braillePane.style.display = 'block';
      if (activeWordHighlight && activeCaretLine >= 0) {
        if (braillePane._virtualBraille?.isVirtualized()) {
          braillePane._virtualBraille.scrollToRow(activeCaretLine);
        }
      } else if (typeof braillePane._savedScrollTop === 'number') {
        braillePane.scrollTop = braillePane._savedScrollTop;
      } else if (lastLinkedBlock != null) {
        if (braillePane._virtualBraille?.isVirtualized()) {
          braillePane._virtualBraille.scrollToBlock(lastLinkedBlock, 0);
        }
      } else {
        syncBrailleToEditor();
      }
      if (braillePane._virtualBraille?.isVirtualized()) {
        braillePane._virtualBraille.refresh();
      }
    }
  }
}

export function updateBrailleTabsVisibility(autoSwitch = false) {
  const embosserVal = $id('set-embosser')?.value || settings.embosser;
  const isConn = (typeof tactileDisplay !== 'undefined') && tactileDisplay.isConnected && tactileDisplay.isConnected();
  const isDotPad = (embosserVal === 'dotpad') || (settings.embosser === 'dotpad') || (isConn && tactileDisplay.deviceProfile?.id === 'dotpad');
  const isMonarch = (embosserVal === 'monarch') || (settings.embosser === 'monarch') || (isConn && tactileDisplay.deviceProfile?.id === 'monarch');

  const tabViewDotPad = $id('tabViewDotPad');
  if (tabViewDotPad) {
    tabViewDotPad.style.display = isDotPad ? 'inline-flex' : 'none';
  }
  const tabViewMonarch = $id('tabViewMonarch');
  if (tabViewMonarch) {
    tabViewMonarch.style.display = isMonarch ? 'inline-flex' : 'none';
  }
  // Tabs only when there is more than one view; otherwise a plain label (Paul, 25 Sep).
  const tabs = document.querySelector('.braille-view-tabs');
  const solo = $id('brailleSoloLabel');
  if (tabs) tabs.hidden = !(isDotPad || isMonarch);
  if (solo) solo.hidden = isDotPad || isMonarch;

  if (autoSwitch) {
    if (isMonarch) {
      switchBrailleTab('monarch');
    } else if (isDotPad) {
      switchBrailleTab('dotpad');
    } else {
      switchBrailleTab('braille');
    }
  } else if (!isMonarch && currentBrailleTab === 'monarch') {
    switchBrailleTab('braille');
  } else if (!isDotPad && currentBrailleTab === 'dotpad') {
    switchBrailleTab('braille');
  }
}

// ---- Settings > Embosser: the four connection choices (S3c, audit 15 Oct #22) ----
// A choice the browser cannot use (Safari and Firefox have no WebSerial, WebHID or Web Bluetooth) is shown but disabled, with the
// reason beside it; if the saved choice is one of those, a line under the list says so. Nothing is lost: the saved value stays.
function syncConnectionControls(type) {
  type = ['serial', 'hid', 'ble', 'network'].includes(type) ? type : 'serial';
  const sel = $id('set-connectionType');
  if (sel) {
    for (const opt of sel.options) {
      const prev = opt.dataset.unavailSuffix;
      if (prev && opt.textContent.endsWith(prev)) opt.textContent = opt.textContent.slice(0, -prev.length);
      delete opt.dataset.unavailSuffix;
      const sup = connectionSupport(opt.value, { text: uiText });
      opt.disabled = !sup.ok;
      if (!sup.ok) { const suffix = ` (${sup.short})`; opt.textContent += suffix; opt.dataset.unavailSuffix = suffix; }
    }
    if (sel.value !== type) sel.value = type;
  }
  const show = (id, on) => { if ($id(id)) $id(id).style.display = on ? 'block' : 'none'; };
  show('networkSettingsGroup', type === 'network');
  show('serialBaudGroup', type === 'serial');
  show('hidSettingsGroup', type === 'hid');
  show('bleSettingsGroup', type === 'ble');
  const hint = $id('connectionUnavailableHint');
  if (hint) {
    const sup = connectionSupport(type, { text: uiText });
    hint.textContent = sup.ok ? '' : tOr('app.settings.connection_unavailable', 'This connection is not available in this browser, so Emboss cannot send to the embosser. Use Chrome or Edge, or choose another connection.');
    hint.style.display = sup.ok ? 'none' : 'block';
  }
}
window.addEventListener('i18n:localechange', () => syncConnectionControls(settings.connectionType));

// ---- settings dialog, Simple-mode switch, BRF download (shared settings) ----
function applySettingsToUI(autoSwitch = false) {
  if ($id('tocToggle')) $id('tocToggle').checked = !!settings.toc;
  for (const k of ['embosser', 'tableFormat', 'quoteStyle', 'listStyle', 'paragraphStyle', 'connectionType']) if ($id('set-' + k)) $id('set-' + k).value = settings[k] || (k === 'embosser' ? 'generic' : (k === 'tableFormat' ? 'auto' : (k === 'paragraphStyle' ? 'indented' : (k === 'connectionType' ? 'serial' : ''))));
  populateUiLanguageDropdown();
  populateLanguageDropdown();
  if ($id('set-mathCode')) $id('set-mathCode').value = settings.mathCode || 'auto';
  if ($id('set-mode')) $id('set-mode').value = settings.mode || 'ukaaf';
  if ($id('set-embosserDuplex')) $id('set-embosserDuplex').value = settings.embosserDuplex || 'double';
  if ($id('set-baudRate')) $id('set-baudRate').value = String(settings.baudRate || 9600);
  if ($id('set-networkHost')) $id('set-networkHost').value = settings.networkHost || '192.168.1.150';
  if ($id('set-networkPort')) $id('set-networkPort').value = settings.networkPort || 9100;
  if ($id('set-cells')) $id('set-cells').value = settings.cells;
  if ($id('set-lines')) $id('set-lines').value = settings.lines;
  syncPageSizeSelect();   // feedback item 6: the preset list shows the size in use
  if ($id('set-volumePages')) $id('set-volumePages').value = settings.volumePages || 0;
  if ($id('set-includeCovers')) $id('set-includeCovers').checked = !!settings.includeCovers;
  if ($id('set-transcriberTools')) $id('set-transcriberTools').checked = transcriberTools;
  if ($id('set-asciiBraille')) $id('set-asciiBraille').checked = !!settings.asciiBraille;
  if ($id('set-simpleMode')) $id('set-simpleMode').checked = settings.simpleMode !== false;
  if ($id('set-showExplanationBar')) $id('set-showExplanationBar').checked = settings.showExplanationBar !== false;
  applyExplanationBarVisibility();
  applyTitleFieldVisibility();
  if ($id('set-tactileGraphics')) $id('set-tactileGraphics').checked = settings.tactileGraphics !== false;
  if ($id('set-tactileRip')) $id('set-tactileRip').checked = settings.tactileRip === true;
  applySixKeyInput(true);   // the Settings checkbox is gone (F9 E1, Paul 9 Oct): the toolbar's six-key button is the one control, so an old saved "sixKeyInput: false" no longer hides it

  syncConnectionControls(settings.connectionType);
  updateGraphicsSupportUI();
  updateBrailleTabsVisibility(autoSwitch);
  applyDocOptionsToUI();
}

// ---- Settings dialog: "Braille formatting options" (document-level BANA_DOC_OPTIONS, nimas-export.mjs) ----
// Unlike the rest of the Settings dialog (persisted to localStorage as `settings`), these ride on
// loadedDocInfo.options — the current DOCUMENT's own options, read by getLexicalModel's
// `Object.assign(model, loadedDocInfo.options)` and so carried through save/reload like any other field.
// The controls are built from format/field-registry.mjs (buildFieldControls) and read / written through its CODECS:
// docBool (on = true), docOff (a default-on rule: only an explicit false is kept), docText (trimmed text, optional pattern).
const DOC_OPT_CONTROLS = groupControlIds(FIELD_GROUPS.find((g) => g.id === 'docOptionsGroup')).map(controlById).filter(Boolean);
function applyDocOptionsToUI() {
  const o = loadedDocInfo.options || {};
  for (const ctl of DOC_OPT_CONTROLS) {
    const el = $id(ctl.id);
    if (!el) continue;
    const v = FIELD_CODECS[ctl.codec].read(o[ctl.field], ctl);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
}
// Called live on every control's change: mutates loadedDocInfo.options in place (so a document loaded moments ago,
// or one about to be saved, always reflects what is on screen) and marks the document dirty, same as any other edit.
// A value that fails its pattern (the line indicator) is reported under the control and not saved.
function saveDocOptionFromUI(ctl) {
  const el = $id(ctl.id);
  if (!el) return;
  const res = FIELD_CODECS[ctl.codec].write(el.type === 'checkbox' ? el.checked : el.value.trim(), ctl);
  const statusEl = ctl.statusId ? $id(ctl.statusId) : null;
  if (res.err) { if (statusEl) statusEl.textContent = t(res.err); el.focus(); return; }
  if (statusEl) statusEl.textContent = '';
  const opts = { ...(loadedDocInfo.options || {}) };
  if (res.value === undefined) delete opts[ctl.field]; else opts[ctl.field] = res.value;
  loadedDocInfo = { ...loadedDocInfo, options: opts };
  contentChangedSinceClean = true;
  clearTranslationCache();
  scheduleRender();
}
(function initDocOptionsGroup() {
  for (const ctl of DOC_OPT_CONTROLS) $id(ctl.id)?.addEventListener('change', () => saveDocOptionFromUI(ctl));
})();

// ---- Book details… dialog (K29 Stage 1a): document-level Title Page facts ----------------------------------
// design docs/transcriber-pages-customisation-design.md §4; fields described once in format/field-registry.mjs
// (audience 'transcriber', save: bana-tp-* meta). A Transcriber tool: reached from the "Book details…" button in
// Settings (class fmt-transcriber, hidden the same CSS way as the rest of the transcriber UI). Unlike the generic
// "Braille formatting options" group, these fields have no registry `ui` (they are not the per-block dialog GROUPS
// drive) so this markup and its wiring are hand-written, the same way the dialog looked before that generator
// existed. Most fields ride on loadedDocInfo.options, like the doc-options group above; `title`, `authors` and
// `publisher` are the document's own existing top-level fields (loadedDocInfo.title / .metadata.docauthors /
// .metadata.publisher) — this is the first UI Emboss has had to edit them (design §3.1: they are NOT new bana-tp-*
// fields, just read from / written to the fields that already exist).
const TP_TEXT_KEYS = ['tpSeries', 'tpGradeLevel', 'tpSubtitle', 'tpEdition', 'tpTranslator', 'tpPublisherCity', 'tpPublisherUrl',
  'tpCopyright', 'tpReproductionNotice', 'tpPrintingHistory', 'tpYear', 'tpTranscriber', 'tpProofreader', 'tpTactileSpecialist',
  'tpAgency', 'tpAgencyLocation'];
const TP_ENUM_KEYS = ['tpPublishedBy', 'tpCountry'];
const TP_LIST_KEYS = ['tpEditors', 'tpIsbn'];
const tpLines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
function tpCurrentModel() {
  return { title: loadedDocInfo.title, metadata: loadedDocInfo.metadata, publisher: loadedDocInfo.options?.tpPublisher, ...(loadedDocInfo.options || {}) };
}
// UK-9: which titlePageTemplateSegments() variant the card should render — the SAME mode
// format/document.mjs's traceTitlePage picks by (isBanaOpts: o.standard/o.mode === 'bana').
function tpMode() { return settings.mode === 'bana' ? 'bana' : 'ukaaf'; }
function tpUpdateReproductionWarning(country) {
  const w = $id('tpReproductionNoticeWarning');
  if (!w) return;
  w.textContent = country === 'US' ? t('app.titlepage_details.reproductionNotice_warning_us')
    : country === 'UK' ? t('app.titlepage_details.reproductionNotice_warning_uk') : '';
}
function applyTitlepageDetailsToUI() {
  const d = titlepageBookDetails(tpCurrentModel());
  const opts = loadedDocInfo.options || {};
  const set = (id, val) => { const el = $id(id); if (el) el.value = val == null ? '' : String(val); };
  set('tpTitle', d.title.value);
  for (const key of TP_TEXT_KEYS) set(key, opts[key] || '');
  set('tpAuthors', (d.authors.value || []).join('\n'));
  set('tpEditors', (opts.tpEditors || []).join('\n'));
  set('tpPublishedBy', opts.tpPublishedBy || '');
  set('tpPublisher', d.publisher.value);
  set('tpCopyright', d.copyright.value);
  const copyrightNote = $id('tpCopyrightComputed');
  if (copyrightNote) { copyrightNote.hidden = !d.copyright.computed; copyrightNote.textContent = d.copyright.computed ? t('app.titlepage_details.from_document') : ''; }
  const country = opts.tpCountry || '';
  set('tpCountry', country);
  let notice = opts.tpReproductionNotice || '';
  if (!notice && country === 'US') notice = REPRODUCTION_NOTICES.US;
  else if (!notice && country === 'UK') notice = ukAccessibleCopyStatement({ title: d.title.value, authors: d.authors.value });
  set('tpReproductionNotice', notice);
  tpUpdateReproductionWarning(country);
  set('tpIsbn', (d.isbn.value || []).join('\n'));
  const isbnNote = $id('tpIsbnComputed');
  if (isbnNote) { isbnNote.hidden = !d.isbn.computed; isbnNote.textContent = d.isbn.computed ? t('app.titlepage_details.isbn_from_source', { isbn: (d.isbn.value || [])[0] || '' }) : ''; }
  set('tpYear', opts.tpYear || String(new Date().getFullYear()));
  set('tpBrailleCode', d.brailleCode.value);
  const st = $id('titlepageDetailsStatus'); if (st) st.textContent = '';
}
function saveTitlepageDetailsFromUI() {
  const val = (id) => ($id(id)?.value || '').trim();
  const st = $id('titlepageDetailsStatus');
  const yr = val('tpYear');
  if (yr && !/^\d{4}$/.test(yr)) {
    if (st) st.textContent = t('app.titlepage_details.err_year');
    $id('tpYear')?.focus();
    return false;
  }
  const meta = { ...(loadedDocInfo.metadata || {}) };
  const authors = tpLines(val('tpAuthors'));
  if (authors.length) { meta.docauthors = authors; meta.docauthor = authors[0]; } else { delete meta.docauthors; delete meta.docauthor; }
  const publisher = val('tpPublisher');
  if (publisher) meta.publisher = publisher; else delete meta.publisher;
  const opts = { ...(loadedDocInfo.options || {}) };
  const setOpt = (key, v) => { if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) delete opts[key]; else opts[key] = v; };
  for (const key of TP_TEXT_KEYS) setOpt(key, val(key));
  for (const key of TP_ENUM_KEYS) setOpt(key, val(key) || null);
  for (const key of TP_LIST_KEYS) setOpt(key, tpLines(val(key)));
  loadedDocInfo = { ...loadedDocInfo, title: val('tpTitle') || null, metadata: meta, options: opts };
  contentChangedSinceClean = true;
  docInfoChangedSinceClean = true;
  noteAutosaveChange();   // the title and book details are part of the backup too (A89 step 3)
  clearTranslationCache();
  scheduleRender();
  if (st) st.textContent = '';
  return true;
}
function openTitlepageDetailsDialog() {
  if (!transcriberToolsOn()) { announce(tOr('app.braille_fmt.transcriber_only', 'The formatting options for this block are transcriber tools. Turn on Transcriber tools in Settings to see them.')); return; }
  const dlg = $id('titlepageDetailsDialog');
  if (!dlg || dlg.open) return;
  applyTitlepageDetailsToUI();
  dlg.showModal();
  announce(t('app.titlepage_details.opened'));
  $id('tpTitle')?.focus();
}
function closeTitlepageDetailsDialog() { $id('titlepageDetailsDialog')?.close(); }
(function initTitlepageDetailsDialog() {
  $id('btnTitlepageDetails')?.addEventListener('click', () => { $id('settingsDialog')?.close(); openTitlepageDetailsDialog(); });
  $id('titlepageDetailsClose')?.addEventListener('click', closeTitlepageDetailsDialog);
  $id('titlepageDetailsCancel')?.addEventListener('click', closeTitlepageDetailsDialog);
  $id('titlepageDetailsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (saveTitlepageDetailsFromUI()) { announce(t('app.titlepage_details.saved')); closeTitlepageDetailsDialog(); }
  });
  $id('tpCountry')?.addEventListener('change', () => {
    const country = $id('tpCountry').value;
    tpUpdateReproductionWarning(country);
    const noticeEl = $id('tpReproductionNotice');
    if (noticeEl && !noticeEl.value.trim()) {
      if (country === 'US') noticeEl.value = REPRODUCTION_NOTICES.US;
      else if (country === 'UK') noticeEl.value = ukAccessibleCopyStatement({ title: $id('tpTitle')?.value || '', authors: tpLines($id('tpAuthors')?.value) });
    }
  });
  const dlg = $id('titlepageDetailsDialog');
  dlg?.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
})();

export function updateGraphicsSupportUI() {
  const btn = $id('btnGraphic');
  if (btn) {
    btn.disabled = false;
    btn.title = `${t('toolbar.insert_graphic')} (/graphic)`;
    btn.style.opacity = '';
    btn.style.cursor = 'pointer';
  }
}

function wireControls() {
  // Set just before leaving for Quick Mode: the document went with the handoff, or the user already
  // agreed to leave without it, so the close guard must not ask (again).
  let leavingForQuickMode = false;
  window.addEventListener('beforeunload', (e) => {
    if (!leavingForQuickMode && isDocumentDirty()) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Autosave & crash recovery (Fable review #7): the beforeunload guard above only catches a
  // close/reload it gets to run for — never a crash or a killed tab. autosave.mjs snapshots the
  // document to IndexedDB every ~30s and on hide/pagehide while it is dirty, off the keystroke
  // path; the matching recovery check (checkForRecovery) runs once at start-up, below.
  initAutosave({
    isDirty: () => isDocumentDirty(),
    isLoading: () => importing,
    isEmpty: () => isDocumentEmpty(),
    buildSnapshot: buildAutosaveSnapshot,
    onWarn: (msg) => { setStatus(msg); announce(msg); },
  });
  // A backup soon after every change, not only every 30 s (A89 step 3): a crashed or frozen tab runs no closing code.
  editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => { if (dirtyElements.size || dirtyLeaves.size) noteAutosaveChange(); });

  // Going back to Quick Mode takes the document with it, through the same handoff Quick Mode uses
  // to open a file here, so nothing is lost and there is nothing to ask (Paul, 26 Sep). Unsaved
  // edits stay marked unsaved: Quick Mode warns before its page closes, and brings the flag back
  // if the document returns here. Only if the document can't be handed over does it still ask.
  $id('backToSimple')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const unsaved = isDocumentDirty();
    let handedOver = false;
    let handoffId = null;   // S2a #4: this transfer's own id, carried to Quick Mode in the address
    try {
      let model = null, merged = false;
      editor.getEditorState().read(() => { const raw = buildModel(); model = mergeListItemBlocks(raw); merged = model !== raw; });
      if (model && (model.blocks || []).length) {
        // the crash-recovery backup is made current as well - but the switch never waits on it more than a few seconds (18 Oct 2026: it could wait for ever)
        if (unsaved) await Promise.race([forceAutosaveTick().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
        handoffId = newHandoffId();
        const handoffDoc = {
          ...loadedDocInfo.options, ...model,
          title: model.title || loadedDocInfo.title,
          metadata: loadedDocInfo.metadata,
          resources: loadedDocInfo.resources,
          _unsavedEdits: unsaved,
        };
        // The braille already made goes with the document (feedback 17 Oct 2026, item 13), but only braille that is THIS document's and these settings':
        // no render pending or running, the settings the render used, no failure (currentOutput), made with the maths engine up. Its key names the document
        // and every setting and flag the formatter read; Quick Mode uses it only if its own key for the document it reads is the same.
        let carried = null;
        window.__handoffBraille = 'none';   // tests: why braille was or was not carried
        try {
          const out = currentOutput();
          if (!out) window.__handoffBraille = 'not current (a render is waiting or running, or failed)'; else if (!(out.opts && out.opts.mathToBrf)) window.__handoffBraille = 'maths engine was not up'; else if (merged) window.__handoffBraille = 'document put back together (list items with blocks)';
          // Not for a document that had to be put back together for the hand-over (a table or other block inside a list item: mergeListItemBlocks): the live
          // braille formats those parts as they stand in the editor and the document as Quick Mode has it formats one list — close, but not always the same
          // braille (a quotation inside a list item was indented two cells less in the editor's), so Quick Mode brailles that document itself.
          if (out && out.brf && out.opts && out.opts.mathToBrf && !renderFailure && !merged) {
            const key = await brailleKey(handoffDoc, brailleFlags(settings, { titleInBraille: out.opts.titleInBraille, toc: out.opts.toc, suppressHeader: out.opts.suppressHeader, mathsReady: true }));
            const still = currentOutput();   // nothing has changed while the key was worked out
            if (!key) window.__handoffBraille = 'no key'; else if (!still || still.brf !== out.brf) window.__handoffBraille = 'changed while the key was worked out';
            if (key && still && still.brf === out.brf) { window.__handoffBraille = 'carried'; carried = { key, brf: out.brf, warnings: JSON.parse(JSON.stringify(Array.isArray(lastWarnings) ? lastWarnings : [])) }; }
          }
        } catch (err) { carried = null; }
        handedOver = await setHandoffDoc(handoffDoc, handoffId, carried);
      }
    } catch (err) {
      console.warn('handoff to Quick Mode failed:', err);
    }
    // Feedback 30 Sep item 17 (Paul, 2 Oct): an empty document has nothing to lose — no question, and no backup of deleted text is
    // left to be offered on coming back. With text that could not be handed over (rare), the question says what happened.
    if (isDocumentEmpty()) clearAutosaveSnapshot();
    else if (!handedOver && unsaved && !window.confirm(tOr('messages.unsaved_handoff_failed', "Emboss couldn't take your document to Quick Mode. Leave anyway? Your changes since the last save will be lost."))) return;
    // Not markDocumentClean(): only a save or a load makes the document clean. The document is
    // still unsaved; it just travels with the handoff (marked unsaved there too).
    leavingForQuickMode = true;
    // Switching pages does not touch "Start in Quick Mode" (feedback 17 Oct 2026, item 12): that setting is where Emboss opens, not where this tab is.
    // The mark tells Quick Mode it was CHOSEN, so it stays even with that setting off.
    markStayInQuick();
    location.href = '/web/index.html' + (handoffId ? handoffHash(handoffId) : '');
  });
  $id('settingsBtn')?.addEventListener('click', () => {
    cancelScrollSync();
    applySettingsToUI();
    translateDOM($id('settingsDialog'));
    $id('settingsDialog')?.showModal();
  });
  // F9 item D2 (APH feedback, 9 Oct 2026: Settings slow in Safari on a big book): closing Settings used to braille the whole document
  // again every time, changed or not (2.2 s of frozen page on the 1,275-page "Collections, Grade 7", in Chrome and in WebKit alike).
  // Now it renders only if the settings are not the ones the last render used (and no render is already scheduled for them).
  $id('settingsDialog')?.addEventListener('close', () => {
    cancelScrollSync();
    updateGraphicsSupportUI();
    if (timer || settingsState() === renderedSettingsState) return;
    render();
  });
  $id('helpBtn')?.addEventListener('click', () => {
    cancelScrollSync();
    translateDOM($id('helpDialog'));
    $id('helpDialog')?.showModal();
  });
  $id('helpClose')?.addEventListener('click', () => {
    cancelScrollSync();
    $id('helpDialog')?.close();
  });
  // Report a problem (A89 step 2): one file for the tester to email — the document as NIMAS and as the editor's own state, its
  // braille, the settings and every error since the page opened.
  $id('reportProblemBtn')?.addEventListener('click', () => {
    cancelScrollSync();
    $id('helpDialog')?.close();
    openProblemDialog({
      page: 'editor', t, settings: () => settings, buildInfo: getBuildInfo, makeZip,
      collect: async (includeDocument) => {
        let model = null;
        try { editor.getEditorState().read(() => { model = mergeListItemBlocks(buildModel()); }); } catch (e) { recordProblem('report', `Reading the document failed: ${e?.message || e}`, { stack: e?.stack || '' }); }
        const doc = model || lastModel || { title: '', blocks: [] };
        const extra = { title: doc.title || '', blocks: (doc.blocks || []).length, unsaved: isDocumentDirty(), transcriberTools: document.body.classList.contains('transcriber-tools') };
        if (!includeDocument) return { documentFiles: [], extra };
        const files = [];
        try { files.push({ name: 'document.xml', text: exportToNimasXml(doc, { title: doc.title || 'document', mode: settings.mode }) }); }
        catch (e) { recordProblem('report', `Saving the document as NIMAS failed: ${e?.message || e}`, { stack: e?.stack || '' }); }
        try { files.push({ name: 'editor-state.json', text: JSON.stringify(editor.getEditorState().toJSON()) }); } catch { /* the NIMAS file is enough */ }
        if (lastBrf) files.push({ name: 'braille.brf', text: lastBrf });
        return { documentFiles: files, extra };
      },
      onSaved: (name, msg) => { setStatus(msg); announce(msg); },
    });
  });
  for (const d of [$id('settingsDialog'), $id('helpDialog')]) {
    d?.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
  $id('btnGraphic')?.addEventListener('click', () => {
    openGraphicDialog();
  });

  // Tabbed settings navigation
  document.querySelectorAll('.settings-nav .tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const dialog = e.target.closest('.dialog');
      if (!dialog) return;
      const tabId = btn.getAttribute('data-tab');
      dialog.querySelectorAll('.tab-btn').forEach((b) => {
        const isSel = b === btn;
        b.classList.toggle('active', isSel);
        b.setAttribute('aria-selected', isSel ? 'true' : 'false');
      });
      dialog.querySelectorAll('.settings-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === tabId);
      });
    });
  });

  $id('set-connectionType')?.addEventListener('change', () => {
    syncConnectionControls($id('set-connectionType').value);
    onSet();
  });

  $id('set-embosser')?.addEventListener('change', () => {
    const p = EMBOSSER_PRESETS[$id('set-embosser').value];
    if (p) {
      $id('set-cells').value = p.cells;
      $id('set-lines').value = p.lines;
      if (p.baudRate && $id('set-baudRate')) {
        $id('set-baudRate').value = String(p.baudRate);
      }
    }
    onSet();
  });
  // UK-7 (28 Sep, James / decisions.md "UKAAF"): the UK page-size presets (settings.mjs
  // UK_PAGE_SIZE_PRESETS) — picking one just fills Cells/Lines, same as an embosser preset;
  // "Always let the user choose" (James), so both fields stay free-standing number inputs and
  // this never overrides them on its own (a preset is applied only on an explicit change here).
  $id('set-pageSize')?.addEventListener('change', () => {
    const preset = PAGE_SIZE_PRESETS.find((p) => p.id === $id('set-pageSize').value);
    if (preset) { $id('set-cells').value = preset.cells; $id('set-lines').value = preset.lines; }
    onSet();
  });
  // settings fields → persist + re-render
  const onSet = () => {
    clearTranslationCache();
    const langVal = $id('set-language')?.value || 'en-ueb-g2';
    if (langVal === '__more__') {
      codesExpanded = true;
      populateLanguageDropdown();
      return;
    }
    const selectedCode = CODES.find((c) => c.id === langVal);
    const lang = selectedCode ? selectedCode.lang : (langVal.split('_')[0] || 'ueb');
    const gr = selectedCode ? (selectedCode.grade.includes('2') ? 'g2' : 'g1') : (langVal.split('_')[1] || 'g2');
    let recent = Array.isArray(settings.recentCodes) ? [...settings.recentCodes] : [];
    recent = [langVal, ...recent.filter((id) => id !== langVal)].slice(0, 5);
    settings = saveSettings({
      brailleCode: langVal,
      recentCodes: recent,
      language: lang,
      grade: gr,
      mathCode: $id('set-mathCode')?.value || 'auto',
      mode: $id('set-mode')?.value || 'ukaaf',
      connectionType: $id('set-connectionType')?.value || 'serial',
      networkHost: $id('set-networkHost')?.value || '192.168.1.150',
      networkPort: Number($id('set-networkPort')?.value) || 9100,
      embosser: $id('set-embosser')?.value || 'generic',
      embosserDuplex: $id('set-embosserDuplex')?.value || 'double',
      baudRate: Number($id('set-baudRate')?.value) || 9600,
      tactileGraphics: $id('set-tactileGraphics')?.checked !== false,
      tactileRip: $id('set-tactileRip')?.checked === true,
      tableFormat: $id('set-tableFormat')?.value || 'auto',
      cells: $id('set-cells')?.value,
      lines: $id('set-lines')?.value,
      quoteStyle: $id('set-quoteStyle')?.value,
      listStyle: $id('set-listStyle')?.value,
      paragraphStyle: $id('set-paragraphStyle')?.value || 'indented',
      volumePages: $id('set-volumePages')?.value,
    });
    // Sync sanitized clamped values back to UI inputs
    if ($id('set-cells')) $id('set-cells').value = settings.cells;
    if ($id('set-lines')) $id('set-lines').value = settings.lines;
    if ($id('set-volumePages')) $id('set-volumePages').value = settings.volumePages;
    syncPageSizeSelect();

    updateGraphicsSupportUI();
    updateBrailleTabsVisibility();

    // Swap the braille code in only once its tables are present (see activateTable).
    activateTable().then(() => scheduleRender());
  };
  // Feedback item 6 (Paul, 1 Oct): changing the standard takes its page size (MODE_GEOMETRY: BANA 38x25, UKAAF 38x27), as Quick
  // Mode already does, unless a hardware preset fixes the page — the editor kept the old size, so BANA stayed on the UK page.
  // Registered before onSet (below), so the new size is what onSet saves.
  $id('set-mode')?.addEventListener('change', () => {
    const g = MODE_GEOMETRY[$id('set-mode').value];
    if (g && ($id('set-embosser')?.value || 'generic') === 'generic') { if ($id('set-cells')) $id('set-cells').value = g.cells; if ($id('set-lines')) $id('set-lines').value = g.lines; }
  });
  ['set-cells', 'set-lines'].forEach((id) => $id(id)?.addEventListener('input', syncPageSizeSelect));   // typing a size shows its preset, or "Custom size"
  // set-embosser and set-connectionType have their own change handlers above (they call
  // onSet themselves); listing them here too ran every save and render twice.
  ['set-networkHost', 'set-networkPort', 'set-baudRate', 'set-embosserDuplex', 'set-language', 'set-mathCode', 'set-mode', 'set-tableFormat', 'set-cells', 'set-lines', 'set-quoteStyle', 'set-listStyle', 'set-paragraphStyle', 'set-volumePages'].forEach((id) => {
    $id(id)?.addEventListener('change', onSet);
    if (['set-cells', 'set-lines', 'set-volumePages', 'set-networkHost', 'set-networkPort'].includes(id)) {
      // Live update while typing, but only once the number is complete and in range: onSet clamps and writes the value
      // back, so applying a half-typed "3" (on the way to 32) made it jump to 10, then 102 → 60. 'change' (Enter / leaving
      // the field) still applies and corrects whatever is there.
      $id(id)?.addEventListener('input', (e) => {
        const el = e.target;
        if (el.type === 'number') {
          const v = Number(el.value);
          const min = el.min === '' ? -Infinity : Number(el.min), max = el.max === '' ? Infinity : Number(el.max);
          if (el.value === '' || !Number.isInteger(v) || v < min || v > max) return;
        }
        onSet();
      });
    }
  });
  $id('set-tactileGraphics')?.addEventListener('change', onSet);
  $id('set-tactileRip')?.addEventListener('change', onSet);
  $id('set-uiLanguage')?.addEventListener('change', async (e) => {
    const newLang = e.target.value;
    settings = saveSettings({ uiLanguage: newLang });
    await setLocale(newLang);
    populateUiLanguageDropdown();
    populateLanguageDropdown();
    announce(t('aria.language_changed', { language: newLang }));
  });
  $id('set-includeCovers')?.addEventListener('change', () => {
    settings = saveSettings({ includeCovers: $id('set-includeCovers').checked });
    render();
  });
  // Transcriber tools: shows or hides tools only, so there is nothing to re-render (the braille never depends on it).
  $id('set-transcriberTools')?.addEventListener('change', () => {
    transcriberTools = $id('set-transcriberTools').checked;
    settings = saveSettings({ transcriberTools });
    applyTranscriberTools();
    if (lastModel) updateSymbolNotice(lastModel, lastFormatOpts);
    announce(t(transcriberTools ? 'app.settings.transcriber_tools_on' : 'app.settings.transcriber_tools_off'));
  });
  $id('set-asciiBraille')?.addEventListener('change', () => {
    settings = saveSettings({ asciiBraille: $id('set-asciiBraille').checked });
    render();
  });
  // "Start in Quick Mode": where Emboss opens, nothing more. Being in the editor does not change it, and ticking it does not move you (item 12).
  $id('set-simpleMode')?.addEventListener('change', () => { settings = saveSettings({ simpleMode: $id('set-simpleMode').checked }); });
  $id('set-showExplanationBar')?.addEventListener('change', () => {
    settings = saveSettings({ showExplanationBar: $id('set-showExplanationBar').checked });
    applyExplanationBarVisibility();
  });
  $id('set-showTitleField')?.addEventListener('change', () => {
    settings = saveSettings({ showTitleField: $id('set-showTitleField').checked });
    applyTitleFieldVisibility();
  });

  // Automatic hardware embosser USB hotplug detection
  initEmbosserAutoDetect((profile) => {
    settings = saveSettings(profile.presets);
    applySettingsToUI();
    render();
    const msg = t('app.spool.detected', { name: profile.name, cells: profile.presets.cells, lines: profile.presets.lines, baud: profile.presets.baudRate || 9600 });
    setStatus(msg);
    announce(msg);
  }, () => {
    setStatus(t('spooler.status_disconnected'));
    announce(t('spooler.status_disconnected'));
  });

  const handleEmbossPrint = async () => {
    const tell = (msg) => { setStatus(msg); announce(msg); };
    const connType = ['serial', 'hid', 'ble', 'network'].includes(settings.connectionType) ? settings.connectionType : 'serial';
    // S3c (audit 15 Oct #22, S2-Q2): the browser lets a page show its device chooser (serial port, HID, Bluetooth) only soon after
    // a click, and a long wait for the braille of a big book makes it forget the click. So the device is asked for FIRST, here,
    // before anything is awaited; the braille is waited for afterwards; then it is sent to the device chosen.
    let choice = null;
    if (connType !== 'network') {
      choice = await chooseEmbosserTarget(connType, { onStatus: tell, text: uiText });
      if (!choice.ok) {
        // unsupported: why; cancelled: nothing was sent; anything else: the plain reason chooseEmbosserTarget gives
        tell(choice.method === 'cancelled' ? `${choice.message} ${tOr('app.export.nothing_sent_short', 'Nothing was sent.')}` : choice.message);
        return;
      }
    }
    // S2a #2/#3: only the braille of the document and settings as they are now (see currentOutput / waitForCurrentOutput)
    commitPendingCardDrafts();
    let out = currentOutput();
    if (!out) {
      const res = await waitForCurrentOutput();
      if (!res.out) { refuseOutput('emboss', res); return; }
      out = res.out;
    }
    const brfNow = out.brf;   // the braille checked above, not whatever a later render leaves in lastBrf
    if (!brfNow) return;

    if (connType === 'network') {
      try {
        announce(t('app.embosser.sending_network', { host: settings.networkHost || '192.168.1.150' }));
        setStatus(t('app.embosser.sending_network', { host: settings.networkHost || '192.168.1.150' }));
        const res = await spoolToNetworkEmbosser(brfNow, {
          host: settings.networkHost || '192.168.1.150',
          port: settings.networkPort || 9100,
          embosser: settings.embosser || 'generic',
          duplex: settings.embosserDuplex || 'double',
          width: settings.cells || 38,
          depth: settings.lines || 25,
          onStatus: (msg) => { setStatus(msg); announce(msg); },
          text: uiText,
        });
        if (res.message) {
          setStatus(res.message);
          announce(res.message);
        }
      } catch (err) {
        console.warn('Network embosser error:', err);
        setStatus(t('app.embosser.network_error', { message: err.message }));
        announce(t('app.embosser.network_error', { message: err.message }));
      }
      return;
    }

    announce(t('spooler.status_connecting'));
    setStatus(t('spooler.status_connecting'));
    const res = await sendToEmbosserTarget(brfNow, choice, {
      embosser: settings.embosser || 'generic',
      duplex: settings.embosserDuplex || 'double',
      width: settings.cells || 38,
      depth: settings.lines || 25,
      baudRate: settings.baudRate || 9600,
      onStatus: (msg) => { setStatus(msg); announce(msg); },
      text: uiText,
    });
    if (!res.success) console.warn('Embosser hardware communication error:', res.message);
    if (res.success) tell(res.message);
    else if (res.method === 'cancelled') tell(`${res.message || t('app.embosser.cancelled')} ${tOr('app.export.nothing_sent_short', 'Nothing was sent.')}`);
    else tell(res.message || t('spooler.status_error', { message: '' }));
  };
  $id('embossBtn')?.addEventListener('click', handleEmbossPrint);
  $id('spoolBtn')?.addEventListener('click', handleEmbossPrint);

  // ---- Tactile Display (Monarch / DotPad / HID) Connection & Streaming ----
  const btnConnectTactile = $id('btnConnectTactile');
  const btnConnectHid = $id('btnConnectHid');
  const btnDisconnectTactile = $id('btnDisconnectTactile');
  const btnSimulateTactile = $id('btnSimulateTactile');
  const btnSimulateDotPad = $id('btnSimulateDotPad');
  const tactileConnStatus = $id('tactileConnStatus');

  // `resetBar` false for the display's 'viewport' events: they fire on every caret move (the display follows the caret), and each used to put the
  // explanation bar back to its hint a moment after the word's explanation was shown (feedback 17 Oct 2026, item 14b: the bar went blank/hint while typing).
  function updateTactileDisplayUI({ resetBar = true } = {}) {
    const isConn = tactileDisplay.isConnected();
    const info = tactileDisplay.getConnectionInfo();
    if (tactileConnStatus) {
      tactileConnStatus.textContent = isConn ? `Connected: ${info.name}` : 'No display connected';
      tactileConnStatus.style.color = isConn ? 'var(--accent-text)' : 'var(--muted)';
    }
    const badge = $id('tactileDisplayBadge');
    if (badge) badge.style.display = isConn ? 'inline-flex' : 'none';
    updateBrailleTabsVisibility();
    if (btnConnectTactile) btnConnectTactile.style.display = isConn ? 'none' : 'inline-block';
    if (btnConnectHid) btnConnectHid.style.display = isConn ? 'none' : 'inline-block';
    if (btnDisconnectTactile) btnDisconnectTactile.style.display = isConn ? 'inline-block' : 'none';
    if (resetBar) showIdleStatus();
  }

  $id('tactilePrevBtn')?.addEventListener('click', () => {
    tactileDisplay.prevPage();
    const lbl = $id('tactileDisplayLbl');
    if (lbl) {
      const p = (typeof tactileDisplay.getCurrentPage === 'function') ? tactileDisplay.getCurrentPage() : 1;
      lbl.textContent = t('app.panels.monarch_lines', { from: (p - 1) * 10 + 1, to: p * 10 });
    }
  });
  $id('tactileNextBtn')?.addEventListener('click', () => {
    tactileDisplay.nextPage();
    const lbl = $id('tactileDisplayLbl');
    if (lbl) {
      const p = (typeof tactileDisplay.getCurrentPage === 'function') ? tactileDisplay.getCurrentPage() : 2;
      lbl.textContent = t('app.panels.monarch_lines', { from: (p - 1) * 10 + 1, to: p * 10 });
    }
  });

  const tabViewBraille = $id('tabViewBraille');
  const tabViewDotPad = $id('tabViewDotPad');
  const tabViewMonarch = $id('tabViewMonarch');
  const braillePane = $id('braille');
  const dotpadPanel = $id('dotpadPanel');
  const monarchPanel = $id('monarchPanel');

  tabViewBraille?.addEventListener('click', () => switchBrailleTab('braille'));
  tabViewDotPad?.addEventListener('click', () => switchBrailleTab('dotpad'));
  tabViewMonarch?.addEventListener('click', () => switchBrailleTab('monarch'));

  // Monarch Canvas wheel navigation (scroll through 10-line frames)
  $id('monarchPanelCanvas')?.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      tactileDisplay.nextPage();
    } else if (e.deltaY < 0) {
      tactileDisplay.prevPage();
    }
    drawMonarchEmulator(tactileDisplay.getMonarchActiveFrame());
  }, { passive: false });

  // Monarch Canvas click interaction for bidirectional caret & word synchronization
  $id('monarchPanelCanvas')?.addEventListener('click', (e) => {
    const canvas = $id('monarchPanelCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = x * scaleX;
    const cy = y * scaleY;

    const activeFrame = tactileDisplay.getMonarchActiveFrame();
    if (!activeFrame) return;

    const marginX = 14, marginY = 12;
    const gridW = canvas.width - (marginX * 2);
    const gridH = canvas.height - (marginY * 2);
    const cellRow = Math.max(0, Math.min(9, Math.floor((cy - marginY) / (gridH / 10))));
    const cellCol = Math.max(0, Math.min(31, Math.floor((cx - marginX) / (gridW / 32))));

    const docLineIdx = (activeFrame.startLine || 0) + cellRow;
    tactileDisplay.activeLineIndex = docLineIdx;

    let targetBlock = lastTrace?.rows ? lastTrace.rows[docLineIdx] : null;
    if (targetBlock == null || targetBlock < 0) {
      if (brailleEl._virtualBraille?.isVirtualized()) {
        const it = brailleEl._virtualBraille.getItems()[docLineIdx];
        if (it && it.block != null) targetBlock = it.block;
      } else {
        const row = brailleEl.querySelectorAll('.brl-row')[docLineIdx];
        if (row && row.dataset.block != null) targetBlock = Number(row.dataset.block);
      }
    }

    let targetUnit = 0;
    let targetChar = -1;

    const rCells = lastTrace?.rowCells ? lastTrace.rowCells[docLineIdx] : null;
    if (rCells && rCells.length > 0) {
      let src = rCells[cellCol];
      if (!src) {
        let closestSrc = null, minDiff = Infinity;
        for (let ci = 0; ci < rCells.length; ci++) {
          if (rCells[ci] && typeof rCells[ci].c === 'number') {
            const diff = Math.abs(ci - cellCol);
            if (diff < minDiff) { minDiff = diff; closestSrc = rCells[ci]; }
          }
        }
        if (minDiff <= 3) src = closestSrc;
      }
      if (src && typeof src.c === 'number') {
        targetUnit = src.u || 0;
        targetChar = src.c;
      }
    }

    if (targetChar >= 0 && targetBlock != null && targetBlock >= 0) {
      const text = cellText[`${targetBlock}:${targetUnit}`];
      if (text != null && text.length > 0) {
        const [s, en] = wordRangeAt(text, targetChar);
        highlightWord(targetBlock, targetUnit, s, en, null, 'monarch');
        showRuleInfo(text.slice(s, en));
        drawMonarchEmulator(tactileDisplay.getMonarchActiveFrame());
        return;
      }
    }

    if (targetBlock != null && !isNaN(targetBlock) && targetBlock >= 0) {
      clearWordLink();
      linkByBlock(targetBlock, true);
      const text = cellText[`${targetBlock}:0`];
      if (text) showRuleInfo(text.split(/\s+/)[0] || text);
      const pe = editorEl.querySelector(`[data-block-idx="${targetBlock}"]`);
      if (pe && !isElementVisibleIn(pe, editorEl)) {
        pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      drawMonarchEmulator(tactileDisplay.getMonarchActiveFrame());
    }
  });

  // DotPad Hardware button handlers
  $id('dotpadBtnLP')?.addEventListener('click', () => tactileDisplay.prevPage());
  $id('dotpadBtnRP')?.addEventListener('click', () => tactileDisplay.nextPage());
  $id('dotpadBtnF1')?.addEventListener('click', () => onReadClick());
  $id('dotpadBtnF2')?.addEventListener('click', () => {
    tactileDisplay.setPage(1);
    const root = editorEl.querySelector('[data-block-idx="0"]');
    if (root) {
      linkByBlock(0, true);
      scrollWithin(editorEl, root, { block: 'center', behavior: 'smooth' });
    }
  });
  $id('dotpadBtnF3')?.addEventListener('click', () => {
    dotpadInvertDisplay = !dotpadInvertDisplay;
    drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
  });
  $id('dotpadBtnF4')?.addEventListener('click', () => {
    scheduleRender();
    announce(t('app.tactile.dotpad_refreshed'));
  });

  // Click interaction on emulator canvases for bidirectional caret & word synchronization
  $id('dotpadPanelCanvas')?.addEventListener('click', (e) => {
    const canvas = $id('dotpadPanelCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = x * scaleX;
    const cy = y * scaleY;

    const activeFrame = tactileDisplay.getDotPadActiveFrame();
    if (!activeFrame) return;

    if (activeFrame.isGraphic) {
      const pageOffset = ((activeFrame.pageNumber || 1) - 1) * 10;
      const pe = editorEl.querySelector(`[data-block-idx="${pageOffset}"]`);
      if (pe) {
        linkByBlock(pageOffset, true);
        pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        showRuleInfo('Tactile Graphic');
      }
      return;
    }

    const marginX = 16, marginY = 14;
    const gridW = canvas.width - (marginX * 2);
    const gridH = canvas.height - (marginY * 2);
    const cellRow = Math.max(0, Math.min(9, Math.floor((cy - marginY) / (gridH / 10))));
    const cellCol = Math.max(0, Math.min(19, Math.floor((cx - marginX) / (gridW / 20))));

    const docLineIdx = (activeFrame.startLine || 0) + cellRow;
    tactileDisplay.activeLineIndex = docLineIdx;

    let targetBlock = lastTrace?.rows ? lastTrace.rows[docLineIdx] : null;
    if (targetBlock == null || targetBlock < 0) {
      if (brailleEl._virtualBraille?.isVirtualized()) {
        const it = brailleEl._virtualBraille.getItems()[docLineIdx];
        if (it && it.block != null) targetBlock = it.block;
      } else {
        const row = brailleEl.querySelectorAll('.brl-row')[docLineIdx];
        if (row && row.dataset.block != null) targetBlock = Number(row.dataset.block);
      }
    }

    let targetUnit = 0;
    let targetChar = -1;

    const rCells = lastTrace?.rowCells ? lastTrace.rowCells[docLineIdx] : null;
    if (rCells && rCells.length > 0) {
      let src = rCells[cellCol];
      if (!src) {
        let closestSrc = null, minDiff = Infinity;
        for (let ci = 0; ci < rCells.length; ci++) {
          if (rCells[ci] && typeof rCells[ci].c === 'number') {
            const diff = Math.abs(ci - cellCol);
            if (diff < minDiff) { minDiff = diff; closestSrc = rCells[ci]; }
          }
        }
        if (minDiff <= 3) src = closestSrc;
      }
      if (src && typeof src.c === 'number') {
        targetUnit = src.u || 0;
        targetChar = src.c;
      }
    }

    if (targetChar >= 0 && targetBlock != null && targetBlock >= 0) {
      const text = cellText[`${targetBlock}:${targetUnit}`];
      if (text != null && text.length > 0) {
        const [s, en] = wordRangeAt(text, targetChar);
        highlightWord(targetBlock, targetUnit, s, en, null, 'dotpad');
        showRuleInfo(text.slice(s, en));
        drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
        return;
      }
    }

    if (targetBlock != null && !isNaN(targetBlock) && targetBlock >= 0) {
      clearWordLink();
      linkByBlock(targetBlock, true);
      const text = cellText[`${targetBlock}:0`];
      if (text) showRuleInfo(text.split(/\s+/)[0] || text);
      const pe = editorEl.querySelector(`[data-block-idx="${targetBlock}"]`);
      if (pe && !isElementVisibleIn(pe, editorEl)) {
        pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
    }
  });

  $id('dotpadTextCanvas')?.addEventListener('click', (e) => {
    const canvas = $id('dotpadTextCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const cx = x * scaleX;

    const activeFrame = tactileDisplay.getDotPadActiveFrame();
    if (!activeFrame) return;

    const cols = 60;
    const marginX = 16;
    const gridW = canvas.width - (marginX * 2);
    const stepX = gridW / (cols - 1);
    const relX = cx - marginX;
    const cellCol = Math.max(0, Math.min(19, Math.floor((relX + stepX) / (3 * stepX))));

    const activeLine = (typeof activeFrame.activeLine === 'number') ? activeFrame.activeLine : (activeFrame.startLine || 0);
    tactileDisplay.activeLineIndex = activeLine;

    let targetBlock = lastTrace?.rows ? lastTrace.rows[activeLine] : null;
    if (targetBlock == null || targetBlock < 0) {
      if (brailleEl._virtualBraille?.isVirtualized()) {
        const it = brailleEl._virtualBraille.getItems()[activeLine];
        if (it && it.block != null) targetBlock = it.block;
      } else {
        const row = brailleEl.querySelectorAll('.brl-row')[activeLine];
        if (row && row.dataset.block != null) targetBlock = Number(row.dataset.block);
      }
    }

    let targetUnit = 0;
    let targetChar = -1;

    const rCells = lastTrace?.rowCells ? lastTrace.rowCells[activeLine] : null;
    if (rCells && rCells.length > 0) {
      let src = rCells[cellCol];
      if (!src) {
        let closestSrc = null, minDiff = Infinity;
        for (let ci = 0; ci < rCells.length; ci++) {
          if (rCells[ci] && typeof rCells[ci].c === 'number') {
            const diff = Math.abs(ci - cellCol);
            if (diff < minDiff) { minDiff = diff; closestSrc = rCells[ci]; }
          }
        }
        if (minDiff <= 3) src = closestSrc;
      }
      if (src && typeof src.c === 'number') {
        targetUnit = src.u || 0;
        targetChar = src.c;
      }
    }

    if (targetChar >= 0 && targetBlock != null && targetBlock >= 0) {
      const text = cellText[`${targetBlock}:${targetUnit}`];
      if (text != null && text.length > 0) {
        const [s, en] = wordRangeAt(text, targetChar);
        highlightWord(targetBlock, targetUnit, s, en, null, 'dotpad');
        showRuleInfo(text.slice(s, en));
        drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
        return;
      }
    }

    if (targetBlock != null && !isNaN(targetBlock) && targetBlock >= 0) {
      clearWordLink();
      linkByBlock(targetBlock, true);
      const text = cellText[`${targetBlock}:0`];
      if (text) showRuleInfo(text.split(/\s+/)[0] || text);
      const pe = editorEl.querySelector(`[data-block-idx="${targetBlock}"]`);
      if (pe && !isElementVisibleIn(pe, editorEl)) {
        pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      drawDotPadEmulator(tactileDisplay.getDotPadActiveFrame());
    }
  });

  tactileDisplay.subscribe((event, data) => {
    if (event === 'connect' || event === 'disconnect' || event === 'viewport') {
      updateTactileDisplayUI({ resetBar: event !== 'viewport' });
      if (currentBrailleTab === 'monarch') {
        const frame = data?.activeFrame || tactileDisplay.getMonarchActiveFrame();
        drawMonarchEmulator(frame);
      } else {
        const frame = data?.activeFrame || tactileDisplay.getDotPadActiveFrame();
        drawDotPadEmulator(frame);
      }
    }
    if (event === 'connect') {
      scheduleRender();
    }
  });

  btnConnectTactile?.addEventListener('click', async () => {
    if (tactileConnStatus) tactileConnStatus.textContent = t('app.tactile.scanning_ble');
    const res = await tactileDisplay.connect({ transport: 'bluetooth', target: 'dotpad' });
    if (!res.success) {
      if (tactileConnStatus) tactileConnStatus.textContent = res.error || 'Connection cancelled';
    } else {
      announce(t('spooler.status_connected', { device: res.name }));
      const isDot = res.profile?.id === 'dotpad';
      const targetEmbosser = isDot ? 'dotpad' : 'monarch';
      if (settings.embosser !== targetEmbosser) {
        if ($id('set-embosser')) $id('set-embosser').value = targetEmbosser;
        const p = EMBOSSER_PRESETS[targetEmbosser];
        if (p) { $id('set-cells').value = p.cells; $id('set-lines').value = p.lines; }
        onSet();
      }
      switchBrailleTab('dotpad');
    }
    updateTactileDisplayUI();
  });

  btnConnectHid?.addEventListener('click', async () => {
    if (tactileConnStatus) tactileConnStatus.textContent = t('app.tactile.scanning_hid');
    const res = await tactileDisplay.connect({ transport: 'hid', target: 'monarch' });
    if (!res.success) {
      if (tactileConnStatus) tactileConnStatus.textContent = res.error || 'Connection cancelled';
    } else {
      announce(t('spooler.status_connected', { device: res.name }));
      if (settings.embosser !== 'monarch') {
        if ($id('set-embosser')) $id('set-embosser').value = 'monarch';
        const p = EMBOSSER_PRESETS['monarch'];
        if (p) { $id('set-cells').value = p.cells; $id('set-lines').value = p.lines; }
        onSet();
      }
    }
    updateTactileDisplayUI();
  });

  btnDisconnectTactile?.addEventListener('click', async () => {
    await tactileDisplay.disconnect();
    announce(t('app.tactile.disconnected'));
    updateTactileDisplayUI();
  });

  btnSimulateTactile?.addEventListener('click', async () => {
    await tactileDisplay.connect({ transport: 'simulated', target: 'monarch' });
    announce(t('app.tactile.sim_monarch'));
    if (settings.embosser !== 'monarch') {
      if ($id('set-embosser')) $id('set-embosser').value = 'monarch';
      const p = EMBOSSER_PRESETS['monarch'];
      if (p) { $id('set-cells').value = p.cells; $id('set-lines').value = p.lines; }
      onSet();
    }
    updateTactileDisplayUI();
  });

  btnSimulateDotPad?.addEventListener('click', async () => {
    await tactileDisplay.connect({ transport: 'dotpad-simulated', target: 'dotpad' });
    announce(t('app.tactile.sim_dotpad'));
    if (settings.embosser !== 'dotpad') {
      if ($id('set-embosser')) $id('set-embosser').value = 'dotpad';
      const p = EMBOSSER_PRESETS['dotpad'];
      if (p) { $id('set-cells').value = p.cells; $id('set-lines').value = p.lines; }
      onSet();
    }
    updateTactileDisplayUI();
    switchBrailleTab('dotpad');
  });

  // Attempt silent background auto-reconnection to any previously paired tactile display
  tactileDisplay.autoReconnect('dotpad').then((res) => {
    if (res && res.success) {
      announce(t('app.tactile.reconnected', { device: res.name }));
      const isDot = res.profile?.id === 'dotpad';
      const targetEmbosser = isDot ? 'dotpad' : 'monarch';
      if (settings.embosser !== targetEmbosser) {
        if ($id('set-embosser')) $id('set-embosser').value = targetEmbosser;
        const p = EMBOSSER_PRESETS[targetEmbosser];
        if (p) { $id('set-cells').value = p.cells; $id('set-lines').value = p.lines; }
        onSet();
      }
      updateTactileDisplayUI();
    }
  }).catch(() => {});

  // ---- Undo & Redo History System ----
  // Snapshots are serialised JSON strings (what parseEditorState takes) keyed by a cheap
  // FNV hash, so "did anything change?" is a string compare, not a second stringify of
  // the whole document. Snapshots are taken at most once per HISTORY_DEBOUNCE_MS burst of
  // updates (plus always on blur, save, undo/redo and clear), not on every keystroke.
  const HISTORY_DEBOUNCE_MS = 400;
  const HISTORY_MAX = 80;
  const historyStack = [];      // [{ state: <json string>, hash, desc, ref: EditorState }]
  let historyIndex = -1;
  let isHistoryUpdating = false;
  let historyTimer = 0;
  let pendingHistoryDesc = null;

  function recordHistoryState(description = 'edit') {
    if (isHistoryUpdating) return;
    if (historyTimer) { clearTimeout(historyTimer); historyTimer = 0; pendingHistoryDesc = null; }
    try {
      const editorState = editor.getEditorState();
      const cur = historyStack[historyIndex];
      // Identity fast-path: the exact EditorState we last snapshotted → nothing to record.
      if (cur && cur.ref === editorState) return;
      const json = JSON.stringify(editorState.toJSON());
      const hash = hashString(json);
      // Same content as the current history position (e.g. a selection-only update).
      if (cur && cur.hash === hash && cur.state === json) { cur.ref = editorState; return; }
      if (historyIndex < historyStack.length - 1) {
        historyStack.splice(historyIndex + 1);          // a new edit after undo drops the redo branch
      }
      historyStack.push({ state: json, hash, desc: description, ref: editorState });
      if (historyStack.length > HISTORY_MAX) historyStack.shift();
      historyIndex = historyStack.length - 1;
      updateUndoRedoUI();
    } catch (e) {
      console.warn('recordHistoryState recovery:', e);
    }
  }

  // Coalesce a burst of updates into one snapshot, taken HISTORY_DEBOUNCE_MS after the last one.
  function scheduleHistorySnapshot(description = 'typing') {
    if (isHistoryUpdating) return;
    if (historyStack.length === 0) { recordHistoryState('initial'); return; }   // baseline is immediate
    pendingHistoryDesc = description;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      historyTimer = 0;
      const d = pendingHistoryDesc || 'typing';
      pendingHistoryDesc = null;
      recordHistoryState(d);
    }, HISTORY_DEBOUNCE_MS);
  }

  // Take any pending snapshot *now* (before undo/redo/save/clear, and on blur) so nothing
  // typed in the last few hundred ms is lost from the undo stack.
  function flushHistorySnapshot() {
    if (!historyTimer) return;
    clearTimeout(historyTimer); historyTimer = 0;
    const d = pendingHistoryDesc || 'typing';
    pendingHistoryDesc = null;
    recordHistoryState(d);
  }
  // Leaving the editor (clicking a toolbar button, a dialog, another pane) ends the burst.
  $id('editor')?.addEventListener('blur', flushHistorySnapshot);

  // A newly loaded document is the undo floor. Deferred so the load's editor update has
  // been committed before the baseline snapshot is taken.
  resetUndoHistory = () => {
    if (historyTimer) { clearTimeout(historyTimer); historyTimer = 0; pendingHistoryDesc = null; }
    historyStack.length = 0;
    historyIndex = -1;
    updateUndoRedoUI();
    setTimeout(() => recordHistoryState('loaded document'), 0);
  };

  function updateUndoRedoUI() {
    const btnUndo = $id('btnUndo');
    const btnRedo = $id('btnRedo');
    if (btnUndo) {
      btnUndo.disabled = historyIndex <= 0;
    }
    if (btnRedo) {
      btnRedo.disabled = historyIndex >= historyStack.length - 1;
    }
  }

  // F9 item B (APH feedback, 9 Oct 2026): Undo and Redo put a whole saved state back, which rebuilds the print pane; in Safari the
  // pane's scroll position fell to 0 (the top of a 1,200-page book) and in Chrome it drifted, so the writer lost their place.
  // The first top-level block that differs between the two states is where the change was: the view is put back, then the block
  // is brought into view if it is not and the caret placed in it.
  function firstChangedBlock(fromJson, toJson) {
    try {
      const a = JSON.parse(fromJson).root.children, b = JSON.parse(toJson).root.children;
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i;
      return a.length === b.length ? -1 : n;
    } catch { return -1; }
  }
  function keepViewAfterHistory(fromJson, toJson, scrollTop) {
    const idx = firstChangedBlock(fromJson, toJson);
    editorEl.scrollTop = scrollTop;
    let node = null;
    try {
      editor.update(() => {
        const kids = $getRoot().getChildren();
        node = kids[Math.min(Math.max(idx, 0), kids.length - 1)] || null;
        if (idx >= 0 && node && typeof node.selectEnd === 'function' && !$isListNode(node)) { try { node.selectEnd(); } catch { /* an atomic block: no caret */ } }
      }, { discrete: true });
    } catch { /* leave the view as restored */ }
    const el = node && editor.getElementByKey(node.getKey());
    if (idx >= 0 && el && !isElementVisibleIn(el, editorEl, 0)) {
      editorEl.scrollTop = Math.max(0, el.offsetTop - editorEl.offsetTop - Math.round(editorEl.clientHeight / 3));
      if (!isElementVisibleIn(el, editorEl, 0)) scrollWithin(editorEl, el, { block: 'center' });
    }
  }

  function performUndo() {
    flushHistorySnapshot();                 // anything typed in the last burst is undone first
    if (historyIndex > 0) {
      const scrollTop = editorEl.scrollTop, fromJson = historyStack[historyIndex]?.state;
      historyIndex--;
      const item = historyStack[historyIndex];
      if (item && item.state) {
        isHistoryUpdating = true;
        try {
          const state = editor.parseEditorState(item.state);
          editor.setEditorState(state);
          item.ref = editor.getEditorState();    // identity fast-path for the next snapshot attempt
          keepViewAfterHistory(fromJson, item.state, scrollTop);
          announce(t('app.history.undo'));
          setStatus(t('app.history.undo_status', { what: item.desc || t('app.history.change') }));
          ding();
        } finally {
          isHistoryUpdating = false;
          updateUndoRedoUI();
        }
      }
    } else {
      announce(t('app.history.nothing_undo'));
    }
  }

  function performRedo() {
    flushHistorySnapshot();
    if (historyIndex < historyStack.length - 1) {
      const scrollTop = editorEl.scrollTop, fromJson = historyStack[historyIndex]?.state;
      historyIndex++;
      const item = historyStack[historyIndex];
      if (item && item.state) {
        isHistoryUpdating = true;
        try {
          const state = editor.parseEditorState(item.state);
          editor.setEditorState(state);
          item.ref = editor.getEditorState();
          keepViewAfterHistory(fromJson, item.state, scrollTop);
          announce(t('app.history.redo'));
          setStatus(t('app.history.redo_status', { what: item.desc || t('app.history.change') }));
          ding();
        } finally {
          isHistoryUpdating = false;
          updateUndoRedoUI();
        }
      }
    } else {
      announce(t('app.history.nothing_redo'));
    }
  }

  $id('btnUndo')?.addEventListener('click', () => performUndo());
  $id('btnRedo')?.addEventListener('click', () => performRedo());

  $id('btnClear')?.addEventListener('click', () => {
    if (isDocumentDirty()) {
      const ok = window.confirm(t('messages.unsaved_clear', 'You have unsaved changes. Are you sure you want to clear the document?'));
      if (!ok) return;
    }
    recordHistoryState('before clear');
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      root.append(p);
    });
    recordHistoryState('clear');
    forgetLoadedTitle();       // a new document: the old file's title must not stay on line 1 of the braille (1 Oct 2026)
    clearAutosaveSnapshot();   // an explicit Clear discards the autosave backup too (Undo still brings the text back)
    announce(t('app.history.cleared'));
    setStatus(t('app.history.cleared'));
    ding();
    editor.focus();
  });

  // ---- Expert Hardware & Serial mode toggle (Ctrl+Shift+\) ----
  // The state is remembered across reloads (G1, 16 Sep): it lives in the shared settings
  // (settings.expertHardware). It also shows/hides the Tactile Graphic and Plot Tactile
  // Graph slash commands (BLOCK_STYLES / SLASH_COMMANDS — see slashCommandVisible).
  try { localStorage.removeItem('emboss_expert_hardware'); } catch {}   // the old, never-persisted key
  let expertHardwareMode = settings.expertHardware === true && !BETA_LOCKED;   // a beta build: off unless unlocked (item 15)
  document.body.classList.toggle('expert-hardware', expertHardwareMode);

  function toggleHardwareExpertMode() {
    if (BETA_LOCKED) return;   // a beta build: the hardware controls are not offered (feedback item 15)
    expertHardwareMode = !expertHardwareMode;
    document.body.classList.toggle('expert-hardware', expertHardwareMode);
    settings = saveSettings({ expertHardware: expertHardwareMode });
    scheduleRender();   // the braille pane's tactile-graphic preview follows this toggle (feedback item 8)
    if (!expertHardwareMode) {
      const tabBtn = document.querySelector('.tab-btn[data-tab="tab-hardware"]');
      if (tabBtn && tabBtn.classList.contains('active')) {
        const rulesBtn = document.querySelector('.tab-btn[data-tab="tab-rules"]');
        rulesBtn?.click();
      }
    }
    const msg = expertHardwareMode
      ? 'Hardware Embosser & Serial controls revealed (Ctrl+Shift+\\ to hide).'
      : 'Hardware Embosser & Serial controls hidden (Ctrl+Shift+\\ to show).';
    setStatus(msg);
    announce(msg);
  }

  window.addEventListener('keydown', (e) => {
    // Expert Hardware toggle: Ctrl+Shift+\ or Cmd+Shift+\
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '\\' || e.code === 'Backslash' || e.key === '|')) {
      e.preventDefault();
      toggleHardwareExpertMode();
      return;
    }

    // Braille formatting… dialog: Ctrl/Cmd+Alt+B (works from the editor, not while a dialog is open)
    if (e.altKey && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyB') {
      e.preventDefault();
      if (!transcriberToolsOn()) { announce(tOr('app.braille_fmt.transcriber_only', 'The formatting options for this block are transcriber tools. Turn on Transcriber tools in Settings to see them.')); return; }
      if (!document.querySelector('dialog[open]')) openBrailleFmtDialog();
      return;
    }

    // K9 Remove box: Ctrl/Cmd+Alt+U (works from the editor, not while a dialog is open; everyone's shortcut,
    // not gated on Transcriber tools — see unboxAtCaret).
    if (e.altKey && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyU') {
      e.preventDefault();
      if (!document.querySelector('dialog[open]')) unboxAtCaret();
      return;
    }

    // Tactile display page navigation: Ctrl+Alt+Up / Down
    if (e.altKey && (e.ctrlKey || e.metaKey)) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        tactileDisplay.prevPage();
        return;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        tactileDisplay.nextPage();
        return;
      }
    }

    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    // Only the document's own undo stack: a text field in a dialog, a table cell input
    // or a MathLive field has its own undo and must keep it.
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'MATH-FIELD' || (t.closest && t.closest('math-field, dialog[open], .table-cell-input')));
    if (inField) return;
    if (mod && !e.altKey) {
      // UEB 9.5.1 strikethrough: Ctrl/⌘+Shift+X. Always live (task: "the shortcut still
      // works") even while Settings › Transcriber tools is off and btnStrike is hidden —
      // .click() on a display:none button still runs its handler.
      if (e.shiftKey && (e.key.toLowerCase() === 'x' || e.code === 'KeyX')) {
        e.preventDefault();
        $id('btnStrike')?.click();
        return;
      }
      // K5 / UEB §9 script typeform: Ctrl/⌘+Shift+S — same "always live" reasoning as
      // strikethrough above. Checked BEFORE the plain Ctrl/⌘+S save shortcut just below,
      // whose own check does not test e.shiftKey.
      if (e.shiftKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
        e.preventDefault();
        $id('btnScript')?.click();
        return;
      }
      // K29 Stage 1d "Insert field": Ctrl/⌘+Shift+F — opens the Title Page's Insert-field combobox
      // (design §4). Free (checked against every other Ctrl/⌘(+Shift) shortcut in this handler).
      // The button's own click handler checks availability (caret in a Title Page line, Transcriber
      // tools on), so this is safe to fire unconditionally, same "always live" pattern as above.
      if (e.shiftKey && (e.key.toLowerCase() === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        // after Lexical has finished with this key press (its update restores the caret and would take the focus back from
        // the menu just opened — A89)
        setTimeout(() => $id('btnTpInsertField')?.click(), 0);
        return;
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        exportTextDocument(saveFormat());
        return;
      }
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault();
        performRedo();
      }
    }
  });

  // Debounced: a selection-only update (no dirty nodes) never schedules a snapshot, and a
  // burst of keystrokes becomes one snapshot HISTORY_DEBOUNCE_MS after the last one.
  editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
    if (isHistoryUpdating) return;
    if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
    scheduleHistorySnapshot('typing');
  });

  // ---- Autosave & crash recovery (Fable review #7): the one Lexical read pass autosave.mjs's
  // periodic timer / visibilitychange / pagehide hooks need — the same NIMAS XML
  // window.exportCurrentDocumentXml() produces, plus the title/metadata/resources a save would
  // otherwise carry. All the storage, size-capping, warning and recovery-dialog logic lives in
  // autosave.mjs; this function is the only bit of it that has to reach into editor state.
  function buildAutosaveSnapshot() {
    let currentDocModel = null;
    editor.getEditorState().read(() => { currentDocModel = mergeListItemBlocks(buildModel()); });
    const doc = currentDocModel || lastModel || { title: null, blocks: [] };
    return {
      xml: exportToNimasXml(doc, { title: doc.title || 'Document', mode: settings.mode }),   // UK-9: same as window.exportCurrentDocumentXml
      title: doc.title || null,
      metadata: loadedDocInfo.metadata || null,
      resources: loadedDocInfo.resources || [],
    };
  }

  // ---- Save / Export Text Document ----
  function exportTextDocument(format) {
    flushHistorySnapshot();                 // the saved state is always an undo point
    if (format === 'package' || format === 'xml' || format === 'nimas') maybeShowExportWarningNotice();   // Fable review #5
    const title = (lastModel?.title || "document").trim();
    const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";
    if (format === 'package') {
      let currentDocModel = null;
      editor.getEditorState().read(() => {
        currentDocModel = mergeListItemBlocks(buildModel());
      });
      const doc = currentDocModel || lastModel || { title, blocks: [] };
      // S2B-Q2 (Paul 15 Oct): the package builder refuses a package it cannot make correctly (a duplicate file name, an unsafe path).
      // Its message goes to the status line and is announced; nothing is written, and the document stays unsaved.
      let pkg;
      try {
        pkg = buildNimasPackage(doc, { mode: settings.mode });   // UK-9: same as the .xml export below
        // tests only: window.__embossTestPackageFiles(files) may return other files, to reach the builder's own refusal (a duplicate name)
        // - a real document cannot, since the builder gives every file a name of its own
        if (typeof window.__embossTestPackageFiles === 'function') { pkg.files = window.__embossTestPackageFiles(pkg.files); checkPackagePaths(pkg.files); }
        saveBlob(makeZip(pkg.files), pkg.zipName);
      } catch (err) {
        console.warn('NIMAS package refused:', err);
        const msg = err && err.userFacing ? err.message : tOr('app.save.package_failed', 'The package could not be saved: {message}. The file was not written.').replace('{message}', String((err && err.message) || err));
        setStatus(msg); announce(msg);
        return;
      }
      // Like the .xml project save, this download IS the saved document.
      markDocumentClean();
      clearAutosaveSnapshot();   // this download is the save — the autosave backup is now redundant
      announce(t('app.save.saved', { file: pkg.zipName }));
      setStatus(t('app.save.package', { file: pkg.zipName, count: pkg.imageCount }));
      return;
    }
    if (format === "xml" || format === "nimas") {
      let currentDocModel = null;
      editor.getEditorState().read(() => {
        currentDocModel = mergeListItemBlocks(buildModel());
      });
      const doc = currentDocModel || lastModel || { title, blocks: [] };
      const xmlString = exportToNimasXml(doc, { title: doc.title || title, mode: settings.mode });   // UK-9: same as window.exportCurrentDocumentXml
      saveBlob(new Blob([xmlString], { type: "application/xml;charset=utf-8" }), `${baseName}.xml`);
      // The project file is the one download that *is* the saved document: baseline the
      // dirty tracking on it once the download has been triggered.
      markDocumentClean();
      clearAutosaveSnapshot();   // this download is the save — the autosave backup is now redundant
      announce(t('app.save.saved', { file: `${baseName}.xml` }));
      setStatus(t('app.save.nimas', { file: `${baseName}.xml` }));
      return;
    }
    // The alternative saves (S5d). None is in a menu yet (Paul decides whether to offer them); each is a derived output, so none marks the
    // document clean. Each reads the live document (liveDocumentModel) and a failure is told in the status line, not thrown.
    if (format === 'json' || format === 'md' || format === 'txt' || format === 'docx' || format === 'html') {
      const doc = liveDocumentModel();
      const docTitle = String((doc && doc.title) || 'document').trim();
      const base = docTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
      const finish = (blob, ext, statusKey) => {
        saveBlob(blob, `${base}.${ext}`);
        announce(t('app.save.saved', { file: `${base}.${ext}` }));
        setStatus(t(statusKey, { file: `${base}.${ext}` }));
      };
      try {
        if (format === 'json') {
          const docObj = {
            title: docTitle,
            date: new Date().toISOString(),
            settings: { ...settings },
            model: doc,
            lexical: editor.getEditorState().toJSON()
          };
          // package pictures are bytes: written as base64, not as an object of numbers
          const json = JSON.stringify(docObj, (k, v) => (v instanceof Uint8Array ? { base64: bytesToBase64(v) } : v), 2);
          finish(new Blob([json], { type: 'application/json;charset=utf-8' }), 'json', 'app.save.native');
        } else if (format === 'md') {
          finish(new Blob([exportToMarkdown(doc, { title: docTitle })], { type: 'text/markdown;charset=utf-8' }), 'md', 'app.save.markdown');
        } else if (format === 'txt') {
          finish(new Blob([exportToText(doc, { title: docTitle })], { type: 'text/plain;charset=utf-8' }), 'txt', 'app.save.text');
        } else if (format === 'docx') {
          finish(exportToDocxBlob(doc, docTitle, { latexToMathml: convertLatexCached }), 'docx', 'app.save.word');
        } else {
          finish(new Blob([exportToHtml(doc, { title: docTitle, latexToMathml: convertLatexCached })], { type: 'text/html;charset=utf-8' }), 'html', 'app.save.html');
        }
      } catch (err) {
        console.warn(`Save as ${format} failed:`, err);
        const msg = tOr('app.save.export_failed', 'The document could not be saved as {format}: {message}. The file was not written.').replace('{format}', format).replace('{message}', String((err && err.message) || err));
        setStatus(msg); announce(msg);
      }
      return;
    }
  }

  // Test hook (Emboss/tests/test-s5d-live-save.mjs): the alternative saves (txt, md, html, docx, json) are in no menu yet, so the test
  // reaches them here - the same exportTextDocument the Save button and Ctrl/Cmd+S call with the project format.
  window.__embossTestSaveAs = (format) => exportTextDocument(format);

  // Triggers a browser download. Deliberately does NOT touch the dirty flag: a BRF/PEF/
  // eBraille/HTML/Markdown export is a *derived* output, so downloading one must not
  // disable the unsaved-changes guards. Only the NIMAS project save (exportTextDocument
  // 'xml') marks the document clean — see there.
  const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const saveDocBtn = $id('saveDocBtn');
  saveDocBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllDropdownMenus();
    exportTextDocument(saveFormat());
  });

  const downloadMenuBtn = $id('downloadBtn');
  const downloadMenu = $id('downloadMenu');
  downloadMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!downloadMenu) return;
    const willShow = downloadMenu.hidden;
    closeAllDropdownMenus();
    downloadMenu.hidden = !willShow;
    downloadMenuBtn.setAttribute('aria-expanded', String(willShow));
    if (willShow) {
      const wrap = $id('downloadMenuWrap') || downloadMenuBtn.parentElement;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        if (rect.right < 210) {
          downloadMenu.style.right = 'auto';
          downloadMenu.style.left = '0';
        } else {
          downloadMenu.style.right = '0';
          downloadMenu.style.left = 'auto';
        }
      }
      downloadMenu.querySelector('.menu-dropdown-item')?.focus({ preventScroll: true });
    }
  });

  async function triggerDownloadFormat(format = 'brf') {
    closeAllDropdownMenus();
    // S2a #2/#3: only the braille of the document and settings as they are now (see currentOutput / waitForCurrentOutput)
    commitPendingCardDrafts();
    let out = currentOutput();
    if (!out) {
      const res = await waitForCurrentOutput();
      if (!res.out) { refuseOutput('download', res); return; }
      out = res.out;
    }
    const { brf: curBrf, model: liveModel, opts: curOpts } = out;
    if (!curBrf) return;
    // The files are made from the document as it is saved and as Quick Mode and eBraille have it - a list whole, with a table or quotation inside
    // one of its items (mergeListItemBlocks) - never from the editor's own pieces of it: a quotation in a list item was 2 cells left of Quick
    // Mode's, and a page could end in a different place (APH feedback 17 Oct 2026).
    const curModel = liveModel ? mergeListItemBlocks(liveModel) : liveModel;
    maybeShowExportWarningNotice();   // Fable review #5: BRF / PEF / eBraille all derive from the same last-rendered braille
    const title = (curModel?.title || document.querySelector('#editor h1, #editor h2, #editor [data-block-type="heading"]')?.textContent || 'document').trim();
    const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
    const opts = {
      ...(curOpts || currentFormatOpts()),
      suppressHeader: false,
      mode: settings.mode, width: settings.cells, depth: settings.lines,
      volumePages: settings.volumePages, includeCovers: settings.includeCovers,
      duplex: settings.embosserDuplex,
    };
    if (format === 'pef') {
      const pefXml = exportToPef(curModel || { title: 'Document', blocks: [] }, opts);
      saveBlob(new Blob([pefXml], { type: 'application/x-pef+xml' }), `${baseName}.pef`);
      announce(t('app.save.pef_downloaded'));
      setStatus(t('app.save.pef', { file: `${baseName}.pef` }));
      maybeOfferTitlePagePrintCopy(baseName);   // K29 Stage 1d: BRF/PEF export offer
      return;
    }
    if (format === 'ebrl' || format === 'ebrf') {
      // The document's own language, author, identifier and publisher come first; the braille code's language next; the browser's is the last
      // fallback (S3b #18, Paul B1). The system declared is that of the braille exported (opts carries it from the render, S3b #17).
      const bytes = exportToEbraille(curModel || { title: 'Document', blocks: [] },
        { ...opts, language: (navigator.language || 'en') });
      saveBlob(new Blob([bytes], { type: 'application/epub+zip' }), `${baseName}.ebrl`);
      announce(t('app.save.saved', { file: `${baseName}.ebrl` }));
      if (bytes.warnings && bytes.warnings.length) {   // S3b #20 (Paul C1): cells or labels replaced by a note - the file says so, and so does this
        const msg = ebrailleWarningText(bytes.warnings, `${baseName}.ebrl`);
        setStatus(msg, 'warn'); announce(msg);
      } else setStatus(t('app.save.ebraille', { file: `${baseName}.ebrl` }));
      return;
    }
    const maxV = Math.max(0, Number(settings.volumePages) || 0);
    const vols = (curModel && curOpts) ? formatVolumes(curModel, { ...curOpts, suppressHeader: false, volumePages: maxV }) : [{ volume: 1, of: 1, brf: curBrf || '' }];
    if (vols.length <= 1) {
      saveBlob(new Blob([vols[0].brf || ''], { type: 'application/octet-stream' }), `${baseName}.brf`);
      maybeOfferTitlePagePrintCopy(baseName);   // K29 Stage 1d: BRF/PEF export offer
      return;
    }
    const files = vols.map((v) => ({ name: `${baseName}-v${v.volume}-of-${v.of}.brf`, text: v.brf }));
    saveBlob(makeZip(files), `${baseName}-braille-volumes.zip`);
    announce(t('app.save.volumes', { count: vols.length }));
    maybeOfferTitlePagePrintCopy(baseName);   // K29 Stage 1d: BRF/PEF export offer
  }

  // K29 Stage 1d: "…offer to also save the print copy as …-title-page.html" (design §4/§5 row "1d Print
  // copy") — the print copy is paper, never inside the BRF/PEF itself, so it is offered as a separate
  // save each time a document with a Title Page is exported to BRF or PEF (not eBraille/NIMAS package,
  // which are not "BRF/PEF export").
  function maybeOfferTitlePagePrintCopy(baseName) {
    const doc = tpFullDocForPrint();
    const el = $id('titlepagePrintOffer');
    if (!el) return;
    if (!(doc.blocks || []).some((b) => b && b.type === 'titlepage')) { el.hidden = true; return; }
    el.hidden = false;
    const saveBtn = $id('titlepagePrintOfferSave');
    if (saveBtn) saveBtn.onclick = () => {
      const html = titlePagePrintHtml(doc, { mode: settings.mode, exhaustiveSymbols: doc.exhaustiveSymbols });
      saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${baseName}-title-page.html`);
      el.hidden = true;
      announce(t('app.titlepage_print.export_offer_saved') || 'Print copy saved.');
    };
  }
  $id('titlepagePrintOfferDismiss')?.addEventListener('click', () => { const el = $id('titlepagePrintOffer'); if (el) el.hidden = true; });
  $id('printTitlepageItem')?.addEventListener('click', () => { closeAllDropdownMenus(); openPrintTitlePage(); });

  $id('downloadBrfItem')?.addEventListener('click', () => triggerDownloadFormat('brf'));
  $id('downloadPefItem')?.addEventListener('click', () => triggerDownloadFormat('pef'));
  $id('downloadEbrlItem')?.addEventListener('click', () => triggerDownloadFormat('ebrl'));
  $id('downloadPackageItem')?.addEventListener('click', () => { closeAllDropdownMenus(); exportTextDocument('package'); });
  const resize = (delta) => {
    isManualZoom = true;
    brailleCellW = Math.max(9, Math.min(40, getEffectiveCellW() + delta));
    saveSettings({ brailleCellW });
    render();
  };
  $id('brlLarger')?.addEventListener('click', () => resize(3));
  $id('brlSmaller')?.addEventListener('click', () => resize(-3));
  let proofIssueIdx = 0;
  $id('proofBadge')?.addEventListener('click', async (ev) => {
    // Feedback 17 Oct 2026, item 5: Safari does not give a button the focus when it is clicked, so with the caret in the text the focus sat on
    // the page, and rescueEditorFocus (above) put it back on the text a moment later — and WebKit then scrolled the text back to the old caret,
    // undoing the jump to the word ("nothing happened"). The badge takes the focus itself, as it does in Chrome; the keyboard stays on it (Enter
    // or Space goes to the next word) and nothing is left to rescue.
    try { (ev.currentTarget || $id('proofBadge')).focus({ preventScroll: true }); } catch { /* not focusable */ }
    // F9 item A: after an edit (or leaving the picture card's description box, which commits it) the page renders again; the jump
    // waits for that, or the render's clean-up wiped the highlight a moment after it was made and "nothing happened".
    if (renderPending()) { announce(tOr('app.proof.waiting', 'Finishing your last change, then going to the next word to check.')); await renderSettled(); }
    const issues = proofIssuesNow();
    if (issues && issues.length > 0) {
      proofIssueIdx = proofIssueIdx % issues.length;
      const issue = issues[proofIssueIdx++];
      const pe = printUnitEl(issue.idx, issue.itemIdx) || editorEl.querySelector(`[data-block-idx="${issue.idx}"]`);
      if (pe) {
        scrollWithin(editorEl, pe, { block: 'center', behavior: 'smooth' });
        highlightWord(issue.idx, issue.itemIdx || 0, issue.start, issue.end);
        const msg = tOr('app.proof.issue', `Word ${proofIssueIdx} of ${issues.length} to check: “${issue.word || ''}”. Its braille does not read back as the same word. That is often fine for a name or an unusual word; otherwise check the braille.`)
          .replace('{n}', proofIssueIdx).replace('{total}', issues.length).replace('{word}', issue.word || issue.src || '');
        announce(msg);
        // Shown in the explanation bar too (feedback item 7): the badge alone did not say why the word was picked out.
        const body = $id('ruleInfoBody');
        if (body) setTimeout(() => { body.innerHTML = `<span class="ri-note proof-explain" style="color:var(--ink)">${iconSvg('warning-triangle', 'icon icon-inline')} ${escapeHtml(msg)}</span>`; }, 60);
      }
    }
  });
  $id('warnBadge')?.addEventListener('click', () => {
    const panel = $id('warnPanel');
    if (panel && !panel.hidden) closeWarningsPanel(); else openWarningsPanel();
  });
  $id('warnPanelClose')?.addEventListener('click', () => closeWarningsPanel());
  $id('exportWarnNoticeView')?.addEventListener('click', () => {
    $id('exportWarnNotice').hidden = true;
    if (exportWarnDismissTimer) clearTimeout(exportWarnDismissTimer);
    openWarningsPanel();
  });
  $id('exportWarnNoticeDismiss')?.addEventListener('click', () => {
    $id('exportWarnNotice').hidden = true;
    if (exportWarnDismissTimer) clearTimeout(exportWarnDismissTimer);
  });
  window.addEventListener('resize', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => render(), 100);
  });
}

getBuildInfo().then((info) => {
  const bi = $id('buildInfo'); if (bi) bi.textContent = info ? `${info.hash}, built ${info.date}` : 'development';
});

(async () => {
  // (The editor no longer sends anyone to Quick Mode because "Start in Quick Mode" is on: that setting decides where the SITE ADDRESS opens, which is
  // Quick Mode's own check; the editor's address, and the switch from Quick Mode, always open the editor — feedback 17 Oct 2026, item 12.)
  // (On a phone the page's first script has already sent the editor's address to Quick Mode: Paul, 18 Oct 2026, Quick Mode only.)
  try {
    await initI18n(settings.uiLanguage || 'en');
  } catch (err) {
    console.warn('initI18n error:', err);
  }
  watchOfflineReady({ text: tOr, say: (m) => { setStatus(m); announce(m); } });   // S4-Q2
  if (typeof window !== 'undefined') {
    window.initI18n = initI18n;
    window.t = t;
    window.setLocale = setLocale;
    window.getLocale = getLocale;
    window.getLocaleInfo = getLocaleInfo;
    window.getSupportedLocales = getSupportedLocales;
    window.translateDOM = translateDOM;
  }
  applySettingsToUI();
  if (settings.sixKeyOn === true) toggleSixKey(true, true);   // F9-Q1b: the six-key button is back as the writer left it
  wireControls();
  wireReadingControls();
  updateReadButtons();
  // F9 item I (Paul 9 Oct 2026): a calm loading state — a small spinner and words in the page's own font — instead of bare monospace text.
  // The spinner is hidden from screen readers and the words are announced once, politely, through the page's live region; the
  // renders that run before the engine is up are skipped (render() checks engineLoading) so the message stays until braille shows.
  engineLoading = true;
  const loadingText = t('app.engine.loading');
  setStatus(loadingText);
  announce(loadingText);
  {
    const wrap = document.createElement('div');
    wrap.className = 'engine-loading';
    const spin = document.createElement('span');
    spin.className = 'engine-spinner';
    spin.setAttribute('aria-hidden', 'true');
    const words = document.createElement('span');
    words.textContent = loadingText;
    wrap.append(spin, words);
    brailleEl.replaceChildren(wrap);
  }
  try {
    const [ver] = await Promise.all([
      louis.init({ tablesBaseUrl: '/liblouis/tables' }),
      maths.initMaths().catch((e) => console.warn('maths engine:', e))
    ]);
    const ev = $id('engineVer'); if (ev) ev.textContent = (ver || '').split(' ')[0] || '3.38.0';
    await activateTable();                 // the persisted braille code, before the first render
    engineLoading = false;
  }
  catch (e) {
    console.error(e);
    brailleEl.textContent = `${t('app.engine.failed')}\n\n${e.message}\n\n${t('app.engine.failed_hint')}`;
    setStatus(t('app.engine.failed_status', { message: e.message }));
    return;
  }
  initToolbar();
  initSlashMenu();
  initFormulaDialog();
  initGraphicDialog();
  // Autosave & crash recovery (Fable review #7; one backup per tab since A80): a backup only
  // survives to here when a session ended dirty (every explicit save/Clear/new-load removes this
  // tab's own — see clearAutosaveSnapshot() above). checkForRecovery() prompts "Recover unsaved
  // work from <time>?" for this tab's own backup, or one whose tab is gone — never for another
  // open tab's — and resolves the recovered model, or null if there was nothing to recover or the
  // user chose Discard. A Quick Mode handoff, when there is one, is opened instead (below).
  // A document uploaded in Quick Mode is handed over via IndexedDB / sessionStorage — load it here
  // instead of the demo (text/headings/lists/emphasis/latex-maths transfer; a docx
  // equation with only MathML becomes an ⟨equation⟩ placeholder).
  let handoff = null, handoffRec = null;
  try {
    handoffRec = await readHandoff();   // S2a #4: this page's own transfer (its id is in the address); the stored copy stays until confirmHandoff below
    handoff = handoffRec && handoffRec.doc;
  } catch (e) {
    console.warn('handoff retrieval error:', e);
  }
  const hasHandoff = !!(handoff && (handoff.blocks || []).length);
  // A handoff is the document the user just chose to open, so it wins; the recovery prompt is
  // only for an ordinary start. The backup is kept either way (it is replaced on the next
  // autosave, or offered on a later ordinary start if it is still there).
  let recovered = null;
  let recoveryAnswered = false;
  if (!hasHandoff) {
    try {
      // announce(), not setStatus(): the status line is about to be overwritten by
      // t('app.engine.ready') a few lines below, but the screen-reader announcement still lands.
      recovered = await checkForRecovery({ onStatus: (msg) => announce(msg), onAnswered: () => { recoveryAnswered = true; } });
    } catch (e) {
      console.warn('autosave recovery check error:', e);
    }
  }
  if (recovered) { setLoadedDocInfo(recovered); modelToLexical(recovered); }
  else if (hasHandoff) { setLoadedDocInfo(handoff); modelToLexical(handoff); } else seed();
  clearTranslationCache();
  render();
  refreshToolbar();
  markDocumentClean();
  resetUndoHistory();
  if (recovered || (hasHandoff && handoff._unsavedEdits)) markDocumentUnsaved();   // a recovered backup, or edits that went to Quick Mode and back, were never saved to a file
  await confirmHandoff(handoffRec);   // the document is loaded here: the stored copy of this transfer can go (S2a #4)
  // Recover / Discard answered: the dialog has gone, so the keyboard goes back to the document, at its start — it was left on the
  // page itself, where Tab reached the toolbar and a space pressed Quick Mode (A89, the nightly random-action run).
  if (recoveryAnswered) { editorEl.focus({ preventScroll: true }); editor.update(() => { $getRoot().selectStart(); }, { discrete: true }); }
  // once MathCAT and MathLive are ready, re-render so the seeded equation transcribes — but only if there IS an equation (feedback 17 Oct 2026,
  // item 13): each of these two re-renders restarted the formatting of the whole document, and on a 5,000-block book with no maths (the testers'
  // Large NIMAS test) they pushed the braille from about 4 s to about 10 s, the three renders contending for the processor.
  const documentHasMaths = () => {
    try { return /"type":"(?:math|equation)"|"(?:mathml|latex)":/.test(JSON.stringify(editor.getEditorState().read(buildModel))); } catch { return true; }   // inline or display maths; unsure: render
  };
  Promise.resolve(maths.initMaths()).then(() => {
    if (!documentHasMaths()) return;
    clearTranslationCache();
    render();
  }).catch(() => {});
  if (globalThis.customElements) customElements.whenDefined('math-field').then(() => {
    if (!documentHasMaths()) return;
    clearTranslationCache();
    render();
  }).catch(() => {});
  setStatus(t('app.engine.ready'));
})();
