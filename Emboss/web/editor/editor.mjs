// Emboss editor: Lexical (vanilla core) → Emboss block model → live braille.
// Reuses the gold-validated engine (/format + /engine). Adds inline MathLive
// equations, a "* * *" document break, a Table-of-Contents toggle, real UEB
// typeform emphasis, a braille-cell preview, and ARIA-toolbar a11y.
import {
  createEditor, $getRoot, $getSelection, $isRangeSelection,
  ParagraphNode, $createParagraphNode, $createTextNode, FORMAT_TEXT_COMMAND,
  DecoratorNode, ElementNode, $insertNodes, $getNodeByKey, $insertNodeToNearestRoot,
  registerRichText, HeadingNode, QuoteNode, $createHeadingNode, $isHeadingNode,
  ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND, registerList, $isListNode, $createListNode, $createListItemNode,
  $setBlocksType, TextNode,
} from './vendor-lexical.mjs';

const $isTextNode = (n) => n instanceof TextNode;
const $isElementNode = (n) => typeof n?.getChildren === 'function';
const $isQuoteNode = (n) => n instanceof QuoteNode;
const $isListItemNode = (n) => n instanceof ListItemNode;
import { formatDocument, formatDocumentAsync, formatVolumes, tableLayout } from '/format/document.mjs?v=20260918_100000';
import { formatStyleInspectorBadge, STYLE_DEFINITIONS, getStyleMargins } from '/format/styles.mjs?v=20260918_050000';
import { exportToNimasXml } from '/input/nimas-export.mjs?v=20260918_090000';
import { buildNimasPackage } from '/input/nimas-package.mjs?v=20260918_090000';
import { cellSegments, cellPlainText, cellToMarkup } from '/format/cell-markup.mjs?v=20260918_100000';
// Table cell rich editing (G15): segments <-> the small HTML string a contenteditable
// table cell shows/edits, so a cell displays real bold/italic/underline/uncontracted
// formatting and atomic maths/note-reference chips instead of markup characters.
import { cellToEditableHtml, cellHtmlToSegments, cellFromEditableHtml } from '/format/cell-dom.mjs?v=20260918_110000';
import { makeZip } from '/web/zip.mjs';
import { exportToDocxBlob } from '/web/docx-export.mjs';
import { Reader, buildSpokenItems, speechAvailable, sliceItemsFrom } from '/web/tts.mjs?v=20260914_192000';
import * as louis from '/engine/louis-browser.mjs';
import { renderBraille, expandRowCells, autoFitBraille } from '/web/braille-render.mjs?v=20260915_102500';
import { proofread, roundTrip, blockEntries } from '/web/proofread.mjs?v=20260912_180700';
import { parseFile, BINARY_EXTS } from '/input/parse.mjs?v=20260918_090000';
import { BRF64, brfToUnicodeBraille } from '/engine/brf-ascii.mjs';
import * as maths from '/engine/maths.mjs';
import { mathmlToLatex } from '/engine/mathml-to-latex.mjs';
import { styledTranslate, exchangeQuotes } from '/format/text-style.mjs';
import { loadSettings, saveSettings, MODE_GEOMETRY, EMBOSSER_NAMES, EMBOSSER_PRESETS, isGraphicsSupported, effectiveMathCode } from '/web/settings.mjs';
import { resolveTable, makeTranslators, UEB_TABLES } from '/web/braille-table.mjs';
import { spoolToEmbosser, spoolToNetworkEmbosser, isWebSerialSupported, initEmbosserAutoDetect } from '/format/spooler.mjs?v=20260918_050000';
import { transpileTactileSvg, transpileTactileSvgForDevice, createGraphicBlock, defaultBrailleTranslator, createLeadLineSvg } from '/format/tactile-svg.mjs?v=20260915_142000';
import { plotTactileFunction, isPlottableEquation } from '/format/math-plotter.mjs?v=20260915_142000';
import { TACTILE_SVG_LIBRARY, TACTILE_SVG_CATEGORIES } from '/web/tactile-library.js';
import { exportToPef } from '/format/pef.mjs';
import { exportToEbraille } from '/format/ebraille.mjs';
import { tactileDisplay, rasterizeSvgToDotPadCells, rasterizeSvgToMonarchCells, charToDotMask } from '/format/tactile-display.mjs?v=20260915_142000';
import { openTactileSymbolBrowser } from '/web/tactile-browser.mjs?v=20260918_050000';
import { CODES } from '/Translate/braille-codes.mjs';
import { describeUebMaths } from '/Translate/ueb-maths-to-latex.mjs';
import { describeNemeth } from '/Translate/nemeth-symbols.mjs';
import { getAndClearHandoffDoc } from '/web/handoff-db.mjs';
import { initI18n, t, setLocale, getLocale, getLocaleInfo, getSupportedLocales, getOrderedLocales, translateDOM, registerLocale } from '/web/i18n.mjs?v=20260918_050000';

if (typeof window !== 'undefined') {
  window.parseFile = parseFile;
  window.exportToNimasXml = exportToNimasXml;
  window.exportCurrentDocumentXml = () => {
    let currentDocModel = null;
    editor.getEditorState().read(() => { currentDocModel = buildModel(); });
    const doc = currentDocModel || lastModel || { title: 'Document', blocks: [] };
    return exportToNimasXml(doc, { title: doc.title || 'Document' });
  };
  window.importFile = importFile;
  window.showRuleInfo = showRuleInfo;
  window.indentCurrentItem = indentCurrentItem;
  window.outdentCurrentItem = outdentCurrentItem;
}

let settings = loadSettings();                 // standard / grade / geometry / quotes / lists / toc (shared with the converter)
const $id = (id) => document.getElementById(id);
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
const origParaClone = ParagraphNode.prototype.afterCloneFrom;
ParagraphNode.prototype.afterCloneFrom = function(prev) {
  if (origParaClone) origParaClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
  this.__pageTurn = prev.__pageTurn || null;
  this.__note = prev.__note || null;
  this.__blocked = !!prev.__blocked;
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
  return json;
};
const origParaUpdateFromJSON = ParagraphNode.prototype.updateFromJSON;
ParagraphNode.prototype.updateFromJSON = function(serializedNode) {
  const node = origParaUpdateFromJSON ? origParaUpdateFromJSON.call(this, serializedNode) : this;
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  if (serializedNode?.pageTurn) node.setPageTurn(serializedNode.pageTurn);
  if (serializedNode?.note) node.setNote(serializedNode.note);
  if (serializedNode?.blocked) node.setBlocked(true);
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
  const prevLvl = prevNode ? prevNode.getLevel() : null;
  const nextLvl = this.getLevel();
  if (prevLvl !== nextLvl) {
    if (nextLvl) dom.dataset.level = String(nextLvl);
    else delete dom.dataset.level;
    updated = true;
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
  if (serializedNode?.marker) node.setMarker(serializedNode.marker);
  if (serializedNode?.bulletPrefix) node.setBulletPrefix(serializedNode.bulletPrefix);
  if (serializedNode?.level != null) node.setLevel(serializedNode.level);
  return node;
};

HeadingNode.prototype.getBanaStyle = function() { return this.getLatest().__banaStyle || null; };
HeadingNode.prototype.setBanaStyle = function(s) { this.getWritable().__banaStyle = s || null; return this; };
const origHeadingClone = HeadingNode.prototype.afterCloneFrom;
HeadingNode.prototype.afterCloneFrom = function(prev) {
  if (origHeadingClone) origHeadingClone.call(this, prev);
  this.__banaStyle = prev.__banaStyle || null;
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
  return json;
};
const origHeadingUpdateFromJSON = HeadingNode.prototype.updateFromJSON;
HeadingNode.prototype.updateFromJSON = function(serializedNode) {
  const node = origHeadingUpdateFromJSON ? origHeadingUpdateFromJSON.call(this, serializedNode) : this;
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  return node;
};
const origHeadingImportJSON = ownImportJSON(HeadingNode);
HeadingNode.importJSON = function(serializedNode) {
  const node = origHeadingImportJSON ? origHeadingImportJSON.call(this, serializedNode) : $createHeadingNode(serializedNode?.tag || 'h1').updateFromJSON(serializedNode);
  if (serializedNode?.banaStyle) node.setBanaStyle(serializedNode.banaStyle);
  return node;
};

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
  static clone(n) { return new ImgNoteNode(n.__text, n.__src, n.__key); }
  constructor(text = '', src = null, key) {
    super(text, key);
    this.__src = src || null;
  }
  getSrc() { return this.getLatest().__src; }
  createDOM(config) {
    const dom = super.createDOM(config);
    dom.classList.add('ed-imgnote');
    return dom;
  }
  exportJSON() { return { ...super.exportJSON(), type: 'emboss-imgnote', version: 1, src: this.__src }; }
  static importJSON(j) { return new ImgNoteNode(j.text || '', j.src || null).updateFromJSON(j).setMode('token'); }
}
const $createImgNoteNode = (text, src = null) => new ImgNoteNode(text, src).setMode('token');
const $isImgNoteNode = (n) => n instanceof ImgNoteNode;
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
  static clone(n) { return new BreakNode(n.__kind || 'asterisks', n.__key); }
  constructor(kind = 'asterisks', key) {
    super(key);
    this.__kind = kind || 'asterisks';
  }
  getKind() { return this.getLatest().__kind || 'asterisks'; }
  setKind(k) { this.getWritable().__kind = k || 'asterisks'; }
  createDOM() {
    const d = document.createElement('div');
    d.className = 'doc-break';
    d.textContent = this.__kind === 'line' ? '————————' : (this.__kind === 'asterism' ? '⁂ ⁂ ⁂' : '∗ ∗ ∗');
    return d;
  }
  updateDOM() { return false; }
  decorate() { return null; }              // static content — nothing to mount
  isInline() { return false; }
  exportJSON() { return { type: 'emboss-break', version: 1, kind: this.__kind }; }
  static importJSON(j) { return new BreakNode(j?.kind || 'asterisks'); }
}
const $createBreakNode = (kind = 'asterisks') => new BreakNode(kind);
const $isBreakNode = (n) => n instanceof BreakNode;

class PrintPageNode extends DecoratorNode {
  static getType() { return 'emboss-print-page'; }
  static clone(n) { const c = new PrintPageNode(n.__page, n.__key); c.__pnId = n.__pnId || null; c.__pageType = n.__pageType || null; return c; }
  constructor(page = '1', key) {
    super(key);
    this.__page = String(page);
    this.__pnId = null;          // the source <pagenum> id and page type, kept for the save (A26)
    this.__pageType = null;
  }
  createDOM() {
    const d = document.createElement('div');
    d.className = 'doc-print-page emboss-printpage-widget';
    return d;
  }
  updateDOM() { return false; }
  setPage(p) { this.getWritable().__page = String(p); }
  getPage() { return this.getLatest().__page; }
  decorate() { return { type: 'print-page', page: this.getPage() }; }
  isInline() { return false; }
  getSource() { const n = this.getLatest(); return { id: n.__pnId, pageType: n.__pageType }; }
  exportJSON() { return { type: 'emboss-print-page', version: 1, page: this.__page, ...(this.__pnId ? { id: this.__pnId } : {}), ...(this.__pageType ? { pageType: this.__pageType } : {}) }; }
  static importJSON(j) { const n = new PrintPageNode(j.page); n.__pnId = j.id || null; n.__pageType = j.pageType || null; return n; }
}
const $createPrintPageNode = (page, src = null) => { const n = new PrintPageNode(page); if (src) { n.__pnId = src.id || null; n.__pageType = src.pageType || null; } return n; };
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
    };
  }
  getImage() { return this.getLatest().__image; }
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
    line('doc-image-src', `🖼 ${img.src ? img.src.replace(/^data:[^,]*,.*/, 'embedded image') : 'image'}`);
    line('doc-image-caption', img.caption);
    line('doc-image-desc', img.description || (img.alt ? `Alt: ${img.alt}` : ''));
    if (!img.caption && !img.description && !img.alt) line('doc-image-desc', t('app.editor.decorative_image'));
    d.appendChild(meta);
    return d;
  }
  updateDOM() { return true; }
  decorate() { return null; }
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

  static getType() { return 'emboss-table'; }
  static clone(n) {
    const node = new TableNode([...(n.__headers || [])], (n.__rows || []).map(r => [...r]), n.__key);
    node.__format = n.__format || 'spatial';
    node.__title = Array.isArray(n.__title) ? [...n.__title] : (n.__title ?? null);
    node.__titlePosition = n.__titlePosition || 'in-box';
    node.__headerGroups = Array.isArray(n.__headerGroups) ? n.__headerGroups.map((g) => ({ ...g })) : null;
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
    };
  }
  static importJSON(j) {
    const n = new TableNode(j.headers || [], j.rows || []);
    if (j.format) n.__format = j.format;
    if (j.title != null) n.__title = j.title;
    if (j.titlePosition) n.__titlePosition = j.titlePosition === 'before-box' ? 'before-box' : 'in-box';
    if (Array.isArray(j.headerGroups) && j.headerGroups.length) n.__headerGroups = j.headerGroups;
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

// ---- editor ----
const editor = createEditor({
  namespace: 'emboss',
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, MathNode, NoteRefNode, LineNumberNode, ImgNoteNode, BreakNode, GraphicNode, ImageNode, TableNode, PrintPageNode, SidebarNode],
  onError: (e) => { console.warn('Lexical non-fatal state warning:', e); },
  theme: { heading: { h1: 'ed-h1', h2: 'ed-h2', h3: 'ed-h3' }, list: { ul: 'ed-ul', ol: 'ed-ol' }, paragraph: 'ed-p',
    text: { bold: 'ed-b', italic: 'ed-i', underline: 'ed-u', strikethrough: 'ed-s', underlineStrikethrough: 'ed-u ed-s' } },
});
editor.setRootElement($id('editor'));
window.editor = editor;
// Lexical's core line-break node (not exported by the vendored bundle; registered on every editor).
const $createLineBreakNode = () => new (editor._nodes.get('linebreak').klass)();
const $isLineBreakNode = (n) => !!n && typeof n.getType === 'function' && n.getType() === 'linebreak';
registerRichText(editor);
registerList(editor);

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

export function markDocumentClean() {
  lastSavedEditorState = editor.getEditorState();
  lastSavedStateSignature = getEditorStateSignature();
  contentChangedSinceClean = false;
}

export function isDocumentDirty() {
  if (!lastSavedStateSignature) return false;
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
  if (fmt === 'listed' || fmt === 'vertical') { if (badge) badge.remove(); return; }   // an explicit listed/vertical table isn't "too wide" — that's what was asked for
  const o = currentFormatOpts();
  const layout = tableLayout({ headers: headers || [], rows: rows || [], format: fmt }, o);
  if (layout === 'columnar' || layout === 'vertical') { if (badge) badge.remove(); return; }   // T4: vertical division (BANA §11.14) is a legitimate auto fallback, not the "too wide" warning
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
      const sizeLabels = { compact: '📐 Size: Compact', half: '📐 Size: Half Page', full: '📐 Size: Full Page' };
      const currentSize = val.size || 'half';
      btnSize.textContent = sizeLabels[currentSize] || '📐 Size: Half Page';
      btnSize.title = t('app.graphic.size_title');
      btnSize.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isGraphicNode(n)) {
            const nextMap = { compact: 'half', half: 'full', full: 'compact' };
            const nextSize = nextMap[n.getSize()] || 'half';
            n.setSize(nextSize);
            btnSize.textContent = sizeLabels[nextSize] || '📐 Size: Half Page';
            el.className = 'doc-graphic-block size-' + nextSize;
          }
        });
      });
      bar.appendChild(btnSize);

      const btnTextures = document.createElement('button');
      btnTextures.type = 'button';
      btnTextures.className = 'graphic-context-btn';
      btnTextures.textContent = val.textures ? '🎨 Textures: ON' : '🎨 Textures: OFF';
      btnTextures.title = t('app.graphic.textures_title');
      btnTextures.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isGraphicNode(n)) {
            const next = !n.getTextures();
            n.setTextures(next);
            btnTextures.textContent = next ? '🎨 Textures: ON' : '🎨 Textures: OFF';
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
      btnLeadLine.textContent = `🏷 + ${t('app.graphic.add_label')}`;
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
      btnDel.textContent = `🗑 ${t('common.delete')}`;
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

    // MathLive math-field decorator
    if (typeof val === 'string') {
      if (el.querySelector('math-field')) continue;
      el.innerHTML = '';
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.gap = '4px';

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

      const btnPlot = document.createElement('button');
      btnPlot.type = 'button';
      btnPlot.className = 'math-plot-btn';
      btnPlot.textContent = `📈 ${t('app.graphic.plot')}`;
      btnPlot.title = t('app.graphic.plot_title');
      btnPlot.style.cssText = 'display:none; padding:2px 6px; font-size:.75rem; font-weight:600; background:var(--accent); color:#fff; border:0; border-radius:4px; cursor:pointer; vertical-align:middle;';
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
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); handleMathFieldSelect(mf); });
      el.addEventListener('click', (e) => { e.stopPropagation(); handleMathFieldSelect(mf); });
      el.addEventListener('mouseenter', () => { if (mf.value.trim()) updatePlotVisibility(); });
      el.addEventListener('mouseleave', () => { if (document.activeElement !== mf) btnPlot.style.display = 'none'; });

      mf.addEventListener('input', () => {
        editor.update(() => { const n = $getNodeByKey(key); if ($isMathNode(n)) n.setLatex(mf.value); });
        updatePlotVisibility();
      });
      mf.addEventListener('focusout', () => setTimeout(() => {
        if (!mf.value.trim() && document.activeElement !== mf) {
          editor.update(() => { const n = $getNodeByKey(key); if ($isMathNode(n)) n.remove(); });
        }
        if (document.activeElement !== mf) {
          btnPlot.style.display = 'none';
        }
      }, 160));

      el.appendChild(mf);
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
            ? cellToEditableHtml(val.headers[u])
            : cellToEditableHtml(val.rows[Math.floor((u - headerCount) / colCount)]?.[(u - headerCount) % colCount]);
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
      titleSpan.textContent = `📊 ${t('app.table.title', { cols: colCount, rows: rowCount })}`;
      titleSpan.style.marginRight = 'auto';
      bar.appendChild(titleSpan);
      updateTableWarningBadge(bar, val.headers, val.rows, val.format);   // G15: too-wide warning

      const btnFormat = document.createElement('button');
      btnFormat.type = 'button';
      btnFormat.className = 'table-context-btn';
      const FORMAT_LABEL = { auto: `🔀 ${t('app.table.fmt_auto')}`, spatial: `📊 ${t('app.table.fmt_spatial')}`, listed: `📋 ${t('app.table.fmt_listed')}`, vertical: `🔲 ${t('app.table.fmt_vertical')}` };
      const FORMAT_TITLE = {
        auto: t('app.table.fmt_auto_title'),
        spatial: t('app.table.fmt_spatial_title'),
        listed: t('app.table.fmt_listed_title'),
        vertical: t('app.table.fmt_vertical_title'),
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
            const nextFmt = { auto: 'spatial', spatial: 'listed', listed: 'vertical', vertical: 'auto' }[n.getFormat()] || 'listed';
            n.setFormat(nextFmt);
          }
        });
      });
      bar.appendChild(btnFormat);

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
      btnDelete.textContent = `🗑 ${t('common.delete')}`;
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
      badge.textContent = `📄 ${t('app.printpage.badge')}`;

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
      btnDel.textContent = '✕';
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

      el.appendChild(badge);
      el.appendChild(input);
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
    } else if (['dialogue', 'stage', 'poem', 'caption', 'attribution', 'footnote', 'note', 'quote'].includes(norm)) {
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
$id('blockStyle')?.addEventListener('change', (e) => applyBlockStyle(e.target.value));

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
function toggleBlockedParagraph() {
  editor.update(() => {
    const sel = $getSelection();
    const paras = new Set();
    if ($isRangeSelection(sel)) {
      for (const n of sel.getNodes()) {
        const p = nearestParagraphNode(n);
        if (p) paras.add(p);
      }
    }
    if (!paras.size && lastActiveEditorSelection?.anchorKey) {
      const p = nearestParagraphNode($getNodeByKey(lastActiveEditorSelection.anchorKey));
      if (p) paras.add(p);
    }
    if (!paras.size) return;
    const anyBlocked = [...paras].some((p) => p.getBlocked());
    for (const p of paras) p.setBlocked(!anyBlocked);
  });
  clearTranslationCache();
  scheduleRender();
  refreshToolbar();
}
$id('btnBlockedPara')?.addEventListener('click', toggleBlockedParagraph);

let savedLexicalBlockKey = null;
let lastKnownEditorBlockIndex = null;
let lastActiveEditorSelection = null;

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
      const rect = insertMenuWrap.getBoundingClientRect();
      const dropWidth = 240;
      if (rect.left + dropWidth > window.innerWidth - 8) {
        insertDropdown.style.left = 'auto';
        insertDropdown.style.right = '0';
      } else {
        insertDropdown.style.left = '0';
        insertDropdown.style.right = 'auto';
      }
    }
    const firstItem = insertDropdown.querySelector('.insert-item:not([style*="display: none"])');
    firstItem?.focus({ preventScroll: true });
  }
}

function closeAllDropdownMenus() {
  closeInsertMenu();
  const dlMenu = $id('downloadMenu');
  const dlBtn = $id('downloadBtn');
  if (dlMenu && !dlMenu.hidden) {
    dlMenu.hidden = true;
    dlBtn?.setAttribute('aria-expanded', 'false');
  }
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

document.addEventListener('click', (e) => {
  if (!e.target.closest('#insertMenuWrap') && !e.target.closest('#downloadMenuWrap')) {
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
  div.innerHTML = cellToEditableHtml(cell);

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
            sel.setTextNodeRange(anchorNode, start, anchorNode, end);
          }
        }
      }
    });
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    editor.focus();
    refreshToolbar();
    editor.getEditorState().read(() => {
      const s = $getSelection();
      announce(label + (($isRangeSelection(s) && s.hasFormat(format)) ? ' on' : ' off'));
    });
  });
}
fmtBtn('btnBold', 'bold', 'Bold'); fmtBtn('btnItalic', 'italic', 'Italic'); fmtBtn('btnUnderline', 'underline', 'Underline');
// A table cell's DOM selection (unlike a Lexical selection) is lost the instant focus
// moves to the button, so keep focus in the cell on mousedown — the click still fires
// fmtBtn's handler right afterwards, with the cell's selection still intact.
['btnBold', 'btnItalic', 'btnUnderline'].forEach((id) => {
  $id(id)?.addEventListener('mousedown', (e) => { if (isTableCellEl(document.activeElement)) e.preventDefault(); });
});

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

$id('btnIndent')?.addEventListener('click', () => indentCurrentItem());
$id('btnOutdent')?.addEventListener('click', () => outdentCurrentItem());

// ---- toolbar: maths / break / TOC / sidebar / table / lists ----
// Keep the editor's selection alive when a toolbar BUTTON is pressed (mousedown)
['btnBold', 'btnItalic', 'btnUnderline', 'btnOutdent', 'btnIndent', 'btnMath', 'btnFormula', 'btnTable', 'btnGraphic', 'btnSidebar', 'btnBreak', 'btnInsertPrintPage'].forEach((id) =>
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
      const mathml = globalThis.MathLive.convertLatexToMathMl(latex);
      latexToMathMlCache.set(latex, mathml);
      return mathml;
    } catch (e) {
      console.warn('equation skipped (could not convert):', e);
      return '';
    }
  }
  return '';
}

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
    if ($isImgNoteNode(child)) {
      const desc = child.getTextContent().trim();
      if (desc) {
        const run = { type: 'imgnote', text: desc };
        if (child.getSrc()) run.src = child.getSrc();
        runs.push(run);
        hasEmph = true;                                  // keep segments so the embedded note survives (F-229)
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
    const text = rawText.replace(/\s+/g, ' ');
    if (!text) continue;
    let tf = 0;
    let unc = false;
    if (typeof child.hasFormat === 'function') {
      if (child.hasFormat('bold')) tf |= TF.bold;
      if (child.hasFormat('italic')) tf |= TF.italic;
      if (child.hasFormat('underline')) tf |= TF.underline;
      unc = child.hasFormat('code');
    }
    if (tf || unc) hasEmph = true;
    const last = runs[runs.length - 1];
    if (last && last.type === 'text' && (last.tf || 0) === tf && !!last.uncontracted === unc) last.text += text;   // one run per form
    else runs.push(unc ? { type: 'text', text, tf, uncontracted: true } : { type: 'text', text, tf });
  }
  return { runs, hasEmph, hasMath };
}
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
  const block = (hasMath || hasEmph) ? { type: 'para', segments: runs }
    : { type: 'para', text: node.getTextContent().replace(/\s+/g, ' ').trim() };
  const turn = typeof node.getPageTurn === 'function' ? node.getPageTurn() : null;
  if (turn === 'continued' || turn === 'both') block.continued = true;
  if (turn === 'continuation' || turn === 'both') block.continuation = true;
  // F-39 — BANA §1.9.3: only meaningful on a plain body paragraph (formatPara ignores it
  // once a styled path — quote, attribution, ... — takes over the block's own margins).
  if (typeof node.getBlocked === 'function' && node.getBlocked()) block.blocked = true;
  if (banaStyle && banaStyle !== 'body') {
    block.style = banaStyle;
    if (banaStyle === 'note') block.type = 'note';
    else if (banaStyle === 'caption') block.type = 'caption';
    else if (banaStyle === 'footnote') {
      block.type = 'footnote';
      const note = typeof node.getNote === 'function' ? node.getNote() : null;
      if (note) { block.id = note.id; if (note.kind) block.kind = note.kind; }
    }
    else if (banaStyle === 'attribution') block.type = 'attribution';
    else if (banaStyle === 'stage' || banaStyle === 'play-stage') block.type = 'stage';
    else if (banaStyle === 'dialogue' || banaStyle === 'play-speaker' || banaStyle === 'speaker') { block.type = 'play'; block.subtype = 'prose'; }
    else if (banaStyle === 'verse' || banaStyle === 'poem' || banaStyle === 'play-verse') { block.type = 'play'; block.subtype = 'verse'; }
    else if (banaStyle === 'quote') { block.type = 'para'; block.style = 'quote'; }
  }
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
let loadedDocInfo = { title: null, metadata: null, resources: [], resourceUrls: new Map() };
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
  const g = { type: 'graphic', src: img.src, alt: img.alt };
  if (img.caption) { g.caption = img.caption; if (img.captionSegments) g.captionSegments = img.captionSegments; }
  if (img.description) g.description = img.description;
  return g;
}

// One editor node → model block(s) appended to `blocks` (the document or a sidebar's blocks).
function nodeToBlocks(node, blocks) {
  const nodeKey = node.getKey();
  if ($isBreakNode(node)) {
    blocks.push({ type: 'indicator', kind: typeof node.getKind === 'function' ? node.getKind() : 'asterisks', _key: nodeKey });
  } else if ($isPrintPageNode(node)) {
    const src = node.getSource();
    blocks.push({ type: 'pagenum', page: node.getPage(), ...(src.id ? { id: src.id } : {}), ...(src.pageType ? { pageType: src.pageType } : {}), _key: nodeKey });
  } else if ($isSidebarNode(node)) {
    const innerBlocks = [];
    for (const child of node.getChildren()) nodeToBlocks(child, innerBlocks);   // same rules inside a sidebar, nested sidebars too (A26)
    const boxSrc = node.getSource();
    blocks.push({
      type: 'box',
      ...(boxSrc && boxSrc.id ? { id: boxSrc.id } : {}),
      ...(boxSrc && boxSrc.render ? { render: boxSrc.render } : {}),
      title: node.getTitle() || undefined,
      blocks: innerBlocks.length ? innerBlocks : undefined,
      _key: nodeKey
    });
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
    blocks.push(tblBlock);
  } else if ($isImageNode(node)) {
    blocks.push({ ...imageBlock(node), _key: nodeKey });
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
  } else if ($isHeadingNode(node)) {
    const { runs, hasEmph, hasMath } = nodeToRuns(node);
    const text = node.getTextContent().replace(/\s+/g, ' ').trim();
    if (runs.length && (hasEmph || hasMath)) {
      blocks.push({ type: 'heading', level: Number(node.getTag().slice(1)) || 1, segments: runs, text, _key: nodeKey });
    } else if (text) {
      blocks.push({ type: 'heading', level: Number(node.getTag().slice(1)) || 1, text, _key: nodeKey });
    }
  } else if ($isListNode(node)) {
    const listType = typeof node.getListType === 'function' ? node.getListType() : null;
    const listKind = (typeof node.getListKind === 'function' ? node.getListKind() : null) ||
                     (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null);
    const isPlain = listType === 'plain' || listKind === 'toc' || listKind === 'index' || listKind === 'plain';
    const isExercise = listKind === 'exercise' || (typeof node.getBanaStyle === 'function' && node.getBanaStyle() === 'exercise');
    const ordered = listType === 'number' || (isExercise && !isPlain);
    const items = [];
    const counters = Array(10).fill(0);
    for (const li of node.getChildren()) {
      const { runs, hasEmph, hasMath } = nodeToRuns(li);        // keep list-item emphasis + inline maths
      if (!runs.length) continue;
      const lvl = Math.max(0, Math.min(9, typeof li.getLevel === 'function' ? (li.getLevel() || 0) : 0));   // sources nest deeper than 4 (A28)
      counters[lvl]++;
      for (let l = lvl + 1; l < counters.length; l++) counters[l] = 0;
      const count = counters[lvl];
      let marker = null;
      if (ordered && !isPlain) {
        if (lvl === 0) marker = `${count}.`;
        else if (lvl === 1) marker = `${String.fromCharCode(96 + ((count - 1) % 26 + 1))}.`;
        else if (lvl === 2) {
          const romans = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
          marker = `${romans[count - 1] || count}.`;
        } else if (lvl === 3) marker = `${String.fromCharCode(64 + ((count - 1) % 26 + 1))}.`;
        else marker = `(${count})`;
      }
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
      const kept = ordered && !isPlain && typeof li.getMarker === 'function' ? li.getMarker() : null;
      if (kept !== NO_MARKER && (kept || marker)) item.marker = kept || marker;
      const page = typeof li.getPage === 'function' ? li.getPage() : null;
      if (page) item.page = page;
      if (lvl > 0) item.level = lvl;
      items.push(item);
    }
    if (items.length) {
      const blk = { type: 'list', items, _key: nodeKey };
      if (ordered && !isPlain) blk.ordered = true;
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

function buildModel() {
  const blocks = [];
  const keys = [];                                     // parallel: the Lexical node key that produced blocks[i]
  for (const node of $getRoot().getChildren()) {
    const before = blocks.length;
    nodeToBlocks(node, blocks);
    if (blocks.length > before) keys.push(node.getKey());
  }
  const firstHeading = blocks.find((b) => b.type === 'heading');   // fallback title for a new document
  const model = { title: loadedDocInfo.title || (firstHeading ? firstHeading.text : null), blocks, keys };
  if (loadedDocInfo.metadata) model.metadata = loadedDocInfo.metadata;
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

// ---- toolbar state ----
function refreshToolbar(explicitTarget) {
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    let block = 'p', b = false, i = false, u = false;

    // 1. Unconditionally sync bold / italic / underline from Lexical selection
    if ($isRangeSelection(sel)) {
      b = sel.hasFormat('bold');
      i = sel.hasFormat('italic');
      u = sel.hasFormat('underline');
      if (sel.isCollapsed()) {
        const anchorNode = sel.anchor.getNode();
        if (anchorNode && $isTextNode(anchorNode)) {
          b = anchorNode.hasFormat('bold');
          i = anchorNode.hasFormat('italic');
          u = anchorNode.hasFormat('underline');
        }
      }
    } else if (lastActiveEditorSelection?.anchorKey) {
      const node = $getNodeByKey(lastActiveEditorSelection.anchorKey);
      if (node && $isTextNode(node)) {
        b = node.hasFormat('bold');
        i = node.hasFormat('italic');
        u = node.hasFormat('underline');
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

      // DOM fallback for bold/italic/underline ONLY when no Lexical selection available
      if (activeDomNode) {
        if (activeDomNode.closest('b, strong, .ed-b') || activeDomNode.style?.fontWeight === 'bold') b = true;
        if (activeDomNode.closest('i, em, .ed-i') || activeDomNode.style?.fontStyle === 'italic') i = true;
        if (activeDomNode.closest('u, ins, .ed-u') || activeDomNode.style?.textDecoration?.includes('underline')) u = true;
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

    const bs = $id('blockStyle');
    if (bs) {
      const validOptions = Array.from(bs.options).map((o) => o.value);
      if (validOptions.includes(block)) {
        bs.value = block;
      } else {
        bs.value = 'p';
      }
    }
    const si = $id('styleInspector');
    if (si) {
      si.textContent = formatStyleInspectorBadge(block, settings.profile || settings.mode || 'bana', uiText);
    }
    $id('btnBold')?.setAttribute('aria-pressed', String(b));
    $id('btnItalic')?.setAttribute('aria-pressed', String(i));
    $id('btnUnderline')?.setAttribute('aria-pressed', String(u));

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
}

// ---- live braille render (honours the shared settings) ----
let lastBrf = '';
let lastModel = null;      // for the volume-aware download
let lastFormatOpts = null;
let lastTrace = null;
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
  const translate = styledTranslate((s, tf) => tr.translate(s, tf), settings.quoteStyle);
  // Mirrors `translate` for the cell trace: quote exchange is length-preserving, so
  // inputPos still indexes the source text. (Script markers are docx-only; N/A here.)
  const translatePos = (s, tf) => tr.translatePos(settings.quoteStyle === 'exchange' ? exchangeQuotes(s) : s, tf || null);
  // Grade-1 translator for segments marked `uncontracted` (UEB only — the formatter
  // falls back to bracketing the contracted text when this is absent).
  const translateG1 = /en-ueb/.test(table) ? (s) => makeTranslators(louis, UEB_TABLES.g1).translate(s) : undefined;
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
      listStyle: settings.listStyle, toc: settings.toc, translate, translatePos,
      mathToBrf: maths.isMathsReady() ? (seg) => maths.mathToBrf(seg, effectiveMathCode(settings)) : null,
      blockCache: blockTranslationCache,
    };
}
// Renders are async and may overlap (a keystroke lands while a large document is still
// formatting). Each call takes a generation number; after every await a call that is no
// longer the newest bails out, so lastModel/lastBrf/lastKeys and the braille pane always
// reflect the most recent editor state and never a stale, slower render that finished last.
let renderGen = 0;
async function render() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const gen = ++renderGen;
  try {
    const model = editor.getEditorState().read(buildModel);
    const table = activeTable;
    const o = currentFormatOpts();
    const trace = {};
    const brf = await formatDocumentAsync(model, { ...o, trace });
    if (gen !== renderGen) return;                  // superseded by a newer render
    refreshAllTableBadges();          // G15: covers a settings change (width/mode) too, not just a table edit
    lastModel = model; lastFormatOpts = o;
    lastTrace = trace;
    lastBrf = brf;
    lastKeys = model.keys;
    window.lastModel = lastModel;
    window.lastFormatOpts = lastFormatOpts;
    window.lastTrace = lastTrace;
    window.lastBrf = lastBrf;
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
        if (rCells && rCells[0] && typeof rCells[0].u === 'number' && rCells[0].u < b.items.length) {
          itemIndex = rCells[0].u;
        }
        const item = b.items[itemIndex];
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
    renderBraille(brailleEl, brf, {
      rows: trace.rows, rowCells: trace.rowCells, cells: (settings.cells | 0) || (EMBOSSER_PRESETS[settings.embosser]?.cells || 38),
      cellW: isManualZoom ? brailleCellW : undefined,   // Ctrl/⌘+Shift+= / − zoom; auto-fit otherwise
      textMode: false, asciiBraille: settings.asciiBraille,
      volumePages: Number(settings.volumePages) || 0,
      rowPrintText, blocks: model.blocks,
      embosser: settings.embosser,
      tactileGraphics: settings.tactileGraphics,
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
    tagPrintBlocks(model.keys);                     // label print blocks so click-to-link can find them
    linkCursor();                                   // re-apply the print↔braille highlight after the re-render
    annotateRows(model);                            // hover a braille line → see its source text
    buildCellText(model);                           // per (block,unit) flat text for word lookup + rule info
    syncCaretWithBraille();                         // re-apply word/math highlights on freshly rendered DOM
    runProofread(model, table);                     // round-trip check → badge + flag lines to review
    const pages = brf ? brf.split('\f').length : 0;
    updateCaretLocation();
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
    brailleEl.textContent = `${t('app.render.failed')}\n\n${msg}\n\n${t('app.render.failed_hint')}`;
    setStatus(t('app.render.error_status', { message: msg }));
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
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.setLinkedBlock(idx);
    if (autoScroll) {
      brailleEl._virtualBraille.scrollToBlock(idx, 0);
    }
  } else {
    const brailleRows = Array.from(brailleEl.querySelectorAll(`.brl-row[data-block="${idx}"]`));
    brailleRows.forEach((r) => {
      expandRowCells(r);
      r.classList.add('brl-linked');
    });
    if (autoScroll) {
      const firstRow = brailleRows[0];
      if (firstRow && !isElementVisibleIn(firstRow, brailleEl)) {
        firstRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
  const pe = editorEl.querySelector(`[data-block-idx="${idx}"]`);
  if (pe) {
    pe.classList.add('print-linked');
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
  if (tableInputs.length) return tableInputs[unit] || be;
  if (be.tagName === 'ASIDE' || be.classList.contains('emboss-sidebar-card')) {
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
function handleTableCellEvent(input, unit) {
  if (!input) return;
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

function charRangeInEl(el, s, e) {                  // a DOM Range over chars [s,e) of the element's text
  if (!el || s >= e) return null;
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
function showIdleStatus() {
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
  editorEl.querySelectorAll('input.table-cell-hl').forEach((inp) => inp.classList.remove('table-cell-hl'));
  if (HL_API) CSS.highlights.delete('link-word');
  showIdleStatus();
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
      targetBraille.scrollIntoView({ behavior: 'auto', block: 'center' });
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
          pe.focus();
          const r = charRangeInEl(pe, s, e);
          if (r) {
            const domSel = window.getSelection();
            domSel.removeAllRanges();
            domSel.addRange(r);
          }
        } catch {}
      }
      if (!isElementVisibleIn(pe, editorEl, 40)) {
        pe.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    } else {
      let wordRange = null;
      try {
        wordRange = charRangeInEl(pe, s, e);
      } catch { wordRange = null; }

      if (wordRange && HL_API) {
        CSS.highlights.set('link-word', new Highlight(wordRange));
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
        pe.scrollIntoView({ behavior: 'auto', block: 'center' });
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
      const r = tr.translatePos ? tr.translatePos(text) : louis.translatePos(text, t);
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

const COMMON_CONTRACTIONS = {
  '⠮': 'the', '⠯': 'and', '⠿': 'for', '⠷': 'of', '⠾': 'with',
  '⠡': 'ch', '⠩': 'sh', '⠹': 'th', '⠱': 'wh', '⠳': 'ou',
  '⠌': 'st', '⠜': 'ar', '⠫': 'ed', '⠻': 'er', '⠔': 'in', '⠢': 'en',
  '⠬': 'ing', '⠪': 'ow', '⠒': 'con', '⠲': 'dis', '⠂': 'ea', '⠆': 'bb',
  '⠖': 'ff', '⠛': 'gg', '⠐⠙': 'day', '⠐⠑': 'ever', '⠐⠋': 'father',
  '⠐⠓': 'here', '⠐⠅': 'know', '⠐⠇': 'lord', '⠐⠍': 'mother', '⠐⠝': 'name',
  '⠐⠕': 'one', '⠐⠏': 'part', '⠐⠟': 'question', '⠐⠗': 'right', '⠐⠎': 'some',
  '⠐⠞': 'time', '⠐⠥': 'under', '⠐⠺': 'work', '⠐⠽': 'young', '⠐⠉': 'character',
  '⠐⠹': 'through', '⠐⠱': 'where', '⠐⠪': 'ought', '⠰⠝': 'tion'
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
});
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

  const offset = caretOffsetInEl(unitEl, e);
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
    if (b.type === 'heading' && b.text) headings.push({ text: b.text, level: b.level || 1, blockIdx: idx });
  });
  if (!headings.length) {
    container.innerHTML = '';
    return;
  }

  const countText = headings.length === 1 ? t('app.toc.section_one') : t('app.toc.sections', { count: headings.length });
  const toggleLabel = isTocBoxCollapsed ? `${t('app.toc.expand')} ▾` : `${t('app.toc.shrink')} ▴`;
  const toggleAria = escapeHtml(isTocBoxCollapsed ? t('app.toc.expand_aria') : t('app.toc.shrink_aria'));
  const ariaExpanded = !isTocBoxCollapsed;

  container.innerHTML = `
    <div class="print-toc-box ${isTocBoxCollapsed ? 'collapsed' : ''}" id="printTocBox">
      <div class="print-toc-head" id="printTocHead" role="button" tabindex="0" aria-expanded="${ariaExpanded}" aria-controls="printTocList" title="${toggleAria}">
        <h3>📑 ${escapeHtml(t('app.toc.title'))} <span class="print-toc-count">(${escapeHtml(countText)})</span></h3>
        <button type="button" class="print-toc-toggle-btn" id="printTocToggleBtn" aria-label="${toggleAria}">${escapeHtml(toggleLabel)}</button>
      </div>
      <ul class="print-toc-list" id="printTocList">
        ${headings.map(h => `<li style="margin-left:${(h.level - 1) * 1.2}em"><a data-jump-block="${h.blockIdx}">${escapeHtml(h.text)}</a></li>`).join('')}
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
  headEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleAction();
    }
  });

  container.querySelectorAll('a[data-jump-block]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const bIdx = Number(a.dataset.jumpBlock);
      const target = editorEl.querySelector(`[data-block-idx="${bIdx}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
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
    if (lastCaretWordKey && lastCaretWordKey.endsWith(':math')) {
      const currentMathHl = editorEl.querySelector('.math-hl');
      if (currentMathHl) return;
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
    if (!resolved) return;
    const { block, unit, unitEl } = resolved;
    const text = cellText[`${block}:${unit}`];
    if (text == null || !text.trim()) {
      clearWordLink();
      linkByBlock(block, false);
      lastCaretWordKey = `${block}:${unit}:empty`;
      return;
    }
    const offset = domOffsetInEl(unitEl, node, sel.anchorOffset);
    const [s, en] = wordRangeAt(text, offset);
    const wordKey = `${block}:${unit}:${s}:${en}:${offset}`;
    if (wordKey === lastCaretWordKey) return;
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
  const [s, en] = wordRangeAt(text, domOffsetInEl(unitEl, node, sel.anchorOffset));
  highlightWord(block, unit, s, en, null, 'caret');
  showRuleInfo(text.slice(s, en));
  announce(lastRuleSpoken || text.slice(s, en));
}

// ---- transparency: hovering a braille line shows the text it came from ----
function blockDisplayText(b) {
  if (!b) return '';
  if (b.type === 'heading') return b.text || '';
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

function clearProofHighlights() {
  if (HL_API) CSS.highlights.delete('proof-warn-word');
  editorEl.querySelectorAll('.proof-warn').forEach((e) => { e.classList.remove('proof-warn'); e.removeAttribute('title'); });
}

function runProofread(model, table) {
  if (proofreadTimer) clearTimeout(proofreadTimer);
  clearProofHighlights();
  lastProofIssues = [];
  
  if (!model || !model.blocks || !model.blocks.length) return;
  
  const blocks = model.blocks;
  const total = blocks.length;
  const issues = [];
  let checked = 0;
  let currentIdx = 0;
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
            res = roundTrip(entry.text, translateEntry, (s) => tr.backTranslate(s));
            proofreadCache.set(cacheKey, res);
          }
          if (!res.ok && res.wordIssues && res.wordIssues.length > 0) {
            for (const w of res.wordIssues) {
              issues.push({ idx: i, itemIdx: entry.itemIdx, word: w.word, start: w.start, end: w.end, src: entry.text, back: res.back });
              const pe = printUnitEl(i, entry.itemIdx) || editorEl.querySelector(`[data-block-idx="${i}"]`);
              if (pe) {
                const r = charRangeInEl(pe, w.start, w.end);
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
      if (HL_API) {
        if (warnRanges.length > 0) {
          CSS.highlights.set('proof-warn-word', new Highlight(...warnRanges));
        } else {
          CSS.highlights.delete('proof-warn-word');
        }
      }
      const badge = $id('proofBadge');
      if (issues.length === 0) {
        if (badge) badge.hidden = true;
      } else {
        if (badge) badge.hidden = false;
        setProofBadge('warn', t('proofread.badge_warn', { count: issues.length }) || `⚠ ${issues.length} to review`, t('proofread.badge_title', { count: issues.length }) || `${issues.length} word discrepancy(s) found during round-trip back-translation. Click to jump to the first.`);
      }
    }
  }

  proofreadTimer = setTimeout(processChunk, 50);
}

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
function sanitizeSvgMarkup(svg) {
  if (!svg || typeof svg !== 'string') return '';
  let doc;
  try { doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); } catch { return ''; }
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror' || root.localName !== 'svg') return '';
  for (const el of Array.from(root.querySelectorAll('script, foreignObject, iframe, object, embed'))) el.remove();
  const walk = (el) => {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      const val = a.value.trim();
      if (name.startsWith('on')) { el.removeAttribute(a.name); continue; }
      if ((name === 'href' || name === 'xlink:href' || name.endsWith(':href')) && !val.startsWith('#')) el.removeAttribute(a.name);
      else if (/javascript:|data:text\/html/i.test(val)) el.removeAttribute(a.name);
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(root);
  return new XMLSerializer().serializeToString(root);
}

function skInsert(text) { editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) s.insertText(text); }); }
function skParagraph() { editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) s.insertParagraph(); }); }
function skDeleteBack() { editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) s.deleteCharacter(true); }); }
function skUpdatePending() {
  const el = $id('skPending'); if (!el) return;       // the indicator's id in index.html
  if (!skChord) { el.textContent = ''; return; }
  const cell = String.fromCodePoint(0x2800 + (skChord & 0x3f));
  el.innerHTML = `<span class="sk-cells">${escapeHtml(cell)}</span>`;
}
function inMathField(e) { return !!(e.target && e.target.closest && e.target.closest('math-field')); }
function skKeydown(e) {
  if (!sixKeyOn || e.ctrlKey || e.metaKey || e.altKey || inMathField(e)) return;
  const code = e.code;
  // stop() also halts propagation so Lexical's OWN key handlers don't ALSO fire
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (code in SK_DOT) { stop(); if (e.repeat) return; skHeld.add(code); skChord |= SK_DOT[code]; skUpdatePending(); return; }
  if (code === 'Space')     { stop(); if (!e.repeat) { skInsert(' '); skUpdatePending(); } return; }
  if (code === 'Enter')     { stop(); if (!e.repeat) { skParagraph(); skUpdatePending(); } return; }
  if (code === 'Backspace') { stop(); skDeleteBack(); return; }
  if (code === 'Escape')    { stop(); toggleSixKey(false); return; }
  if (e.key && e.key.length === 1) stop();   // block stray letters/digits while brailling
}
function skKeyup(e) {
  if (!sixKeyOn) return;
  const code = e.code; if (!(code in SK_DOT)) return;
  e.preventDefault(); skHeld.delete(code);
  if (skHeld.size === 0 && skChord) {
    const cell = String.fromCodePoint(0x2800 + (skChord & 0x3f));
    skInsert(cell);
    skChord = 0;
    skUpdatePending();
  }
}
function toggleSixKey(on) {
  const want = on == null ? !sixKeyOn : on;
  if (want && settings.sixKeyInput === false) { announce(t('app.sixkey.disabled_in_settings')); return; }
  sixKeyOn = want;
  $id('btnSixKey')?.setAttribute('aria-pressed', String(sixKeyOn));
  skHeld.clear(); skChord = 0;
  if (sixKeyOn) { skUpdatePending(); editorEl.focus(); announce(t('app.sixkey.on')); }
  else { skUpdatePending(); announce(t('app.sixkey.off')); }
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
  skUpdatePending();
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
        '.eq-atom.speaking-atom{color:#b3140f;text-decoration:underline;text-decoration-color:#d81b1b;text-decoration-thickness:2.5px;text-underline-offset:3px}' +
        '.eq-grp.speaking-group{color:#b3140f;background:rgba(216,27,27,.12);border-radius:3px;box-shadow:0 0 0 1.5px rgba(216,27,27,.45)}',
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
  if (ttsHi) CSS.highlights.delete('tts-word');
}
function clearSpokenWord() {
  brailleEl.querySelectorAll('.bcell.cell-speaking').forEach((c) => c.classList.remove('cell-speaking'));
  editorEl.querySelectorAll('.math-speaking').forEach((e) => e.classList.remove('math-speaking'));
  if (ttsHi) CSS.highlights.delete('tts-word');
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
      if (pe && ttsHi) { const r = charRangeInEl(pe, fs, fe); if (r) CSS.highlights.set('tts-word', new Highlight(r)); }
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
function updateReadButtons() {                       // one button: ▶ play (from caret) ⇄ ⏹ stop
  const r = $id('btnRead'); if (!r) return;
  if (reader.speaking) {
    r.innerHTML = `⏹ <span class="btn-lbl" data-i18n="toolbar.stop_reading">${t('toolbar.stop_reading') || 'Stop'}</span>`;
    r.setAttribute('aria-pressed', 'true');
    r.title = t('toolbar.stop_reading') || 'Stop reading';
  } else {
    r.innerHTML = `▶ <span class="btn-lbl" data-i18n="toolbar.read_aloud">${t('toolbar.read_aloud') || 'Read'}</span>`;
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

  function getStyleLabels() {
    return {
      p:        { full: `¶ ${t('styles.body') || 'Body Text'}`,            short: `¶ ${t('app.styles.short_text')}`, mini: '¶' },
      h1:       { full: `${t('styles.h1') || 'H1 Heading'}`,               short: 'H1',          mini: 'H1' },
      h2:       { full: `${t('styles.h2') || 'H2 Subheading'}`,            short: 'H2',          mini: 'H2' },
      h3:       { full: `${t('styles.h3') || 'H3 Sub-subheading'}`,        short: 'H3',          mini: 'H3' },
      bullet:   { full: `• ${t('styles.bullet_list') || 'Bullet List'}`,    short: `• ${t('app.styles.short_list')}`, mini: '•' },
      number:   { full: `1. ${t('styles.number_list') || 'Numbered List'}`, short: `1. ${t('app.styles.short_list')}`, mini: '1.' },
      toc:      { full: `📑 ${t('styles.toc_entry') || 'TOC Entry'}`,      short: t('app.styles.short_toc'), mini: t('app.styles.short_toc') },
      dialogue: { full: `🎭 ${t('styles.dialogue') || 'Play Dialogue'}`,    short: t('app.styles.short_play'), mini: t('app.styles.short_play') },
      stage:    { full: `🎬 ${t('styles.stage') || 'Stage Direction'}`,    short: t('app.styles.short_stage'), mini: t('app.styles.short_stage') },
      poem:     { full: `📜 ${t('styles.poem') || 'Poetry / Verse'}`,      short: t('app.styles.short_poem'), mini: t('app.styles.short_poem') },
      exercise: { full: `❓ ${t('styles.exercise') || 'Exercise Question'}`, short: t('app.styles.short_exercise'), mini: t('app.styles.mini_exercise') },
      caption:  { full: `💬 ${t('styles.caption') || 'Caption'}`,          short: t('app.styles.short_caption'), mini: t('app.styles.mini_caption') },
      footnote: { full: `📝 ${t('styles.footnote') || 'Footnote'}`,        short: t('app.styles.short_footnote'), mini: t('app.styles.mini_footnote') },
      note:     { full: `📋 ${t('styles.note') || "Transcriber's Note"}`,   short: t('app.styles.short_note'), mini: t('app.styles.mini_note') },
      quote:    { full: `“ ${t('styles.quote') || 'Blockquote'}`,          short: t('app.styles.short_quote'), mini: t('app.styles.mini_quote') },
      index:    { full: `📇 ${t('app.styles.index')}`,                     short: t('app.styles.short_index'), mini: t('app.styles.mini_index') },
      attribution: { full: `✍️ ${t('app.styles.attribution')}`,           short: t('app.styles.short_attribution'), mini: t('app.styles.mini_attribution') },
      sidebar:  { full: `📦 ${t('app.styles.sidebar')}`,                   short: t('app.styles.short_sidebar'), mini: t('app.styles.mini_sidebar') },
      'table-spatial': { full: `📊 ${t('app.styles.table_spatial')}`,      short: t('app.styles.short_table'), mini: t('app.styles.mini_table') },
      'table-listed':  { full: `📋 ${t('app.styles.table_listed')}`,       short: t('app.styles.short_table_listed'), mini: t('app.styles.mini_table_listed') }
    };
  }

  let currentMode = 'full';

  function updateSelectLabels(mode, force = false) {
    if (mode === currentMode && !force) return;
    currentMode = mode;
    const styleLabels = getStyleLabels();
    for (const opt of selectEl.options) {
      const def = styleLabels[opt.value];
      if (def) {
        opt.textContent = def[mode] || def.full;
      }
    }
  }

  window.addEventListener('i18n:localechange', () => {
    updateSelectLabels(currentMode, true);
  });

  function checkDimensions(width) {
    const w = width ?? header.getBoundingClientRect().width;
    if (w < 390) {
      pane?.classList.add('pane-ultra-compact');
      pane?.classList.remove('pane-compact');
      updateSelectLabels('mini');
    } else if (w < 540) {
      pane?.classList.add('pane-compact');
      pane?.classList.remove('pane-ultra-compact');
      updateSelectLabels('short');
    } else {
      pane?.classList.remove('pane-compact', 'pane-ultra-compact');
      updateSelectLabels('full');
    }
  }

  let rafId = null;
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((entries) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          checkDimensions(entry.contentRect.width);
        }
      });
    });
    ro.observe(header);
  } else {
    window.addEventListener('resize', () => checkDimensions());
  }
  checkDimensions();
}

// ---- Slash command popover menu for keyboard & screen reader accessibility ----
function setBlockStyle(val) {
  const norm = (val === 'ul') ? 'bullet' : (val === 'ol') ? 'number' : (val || 'p');
  const sel = $id('blockStyle');
  if (sel) {
    sel.value = norm;
  }
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
    icon: '▦'
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
  const bs = $id('blockStyle');
  if (bs) bs.value = styleVal;
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

const SLASH_COMMANDS = [
  { id: 'slash', title: 'Insert "/"', desc: 'Type a literal slash character', icon: '/', keywords: ['slash', '/', 'text', 'symbol'], action: () => insertTextAtCaret('/') },
  { id: 'bold', title: 'Bold Text', desc: 'Apply bold formatting', icon: 'B', keywords: ['bold', 'b', 'strong'], action: () => $id('btnBold')?.click() },
  { id: 'italic', title: 'Italic Text', desc: 'Apply italic formatting', icon: 'I', keywords: ['italic', 'i', 'emphasis'], action: () => $id('btnItalic')?.click() },
  { id: 'underline', title: 'Underline Text', desc: 'Apply underline formatting', icon: 'U', keywords: ['underline', 'u'], action: () => $id('btnUnderline')?.click() },
  { id: 'h1', title: 'Heading 1', desc: 'Major centered heading (1-1)', icon: 'H1', keywords: ['h1', 'heading 1', 'title', 'centered', 'major'], action: () => setBlockStyle('h1') },
  { id: 'h2', title: 'Heading 2', desc: 'Section heading (Cell 5)', icon: 'H2', keywords: ['h2', 'heading 2', 'section', 'subheading'], action: () => setBlockStyle('h2') },
  { id: 'h3', title: 'Heading 3', desc: 'Subsection heading (Cell 7)', icon: 'H3', keywords: ['h3', 'heading 3', 'sub', 'subsection', 'minor'], action: () => setBlockStyle('h3') },
  { id: 'p', title: 'Paragraph (Body)', desc: 'Standard body paragraph (3-1)', icon: '¶', keywords: ['p', 'para', 'paragraph', 'body', 'text', 'standard'], action: () => setBlockStyle('p') },
  { id: 'ul', title: 'Bulleted List', desc: 'Create bulleted list items (1-3)', icon: '•', keywords: ['ul', 'bullet', 'bullets', 'list', 'unordered'], action: () => setBlockStyle('bullet') },
  { id: 'ol', title: 'Numbered List', desc: 'Create numbered list items (1-3)', icon: '1.', keywords: ['ol', 'number', 'numbered', 'list', 'ordered'], action: () => setBlockStyle('number') },
  { id: 'indent', title: 'Indent / Nest Sub-item', desc: 'Nest list item or exercise deeper (Tab)', icon: '⇥', keywords: ['indent', 'nest', 'subitem', 'subquestion', 'sub', 'tab', 'level'], action: () => indentCurrentItem() },
  { id: 'outdent', title: 'Outdent / Promote Item', desc: 'Promote list item or exercise higher (Shift+Tab)', icon: '⇤', keywords: ['outdent', 'promote', 'unindent', 'unnest', 'shift-tab', 'back'], action: () => outdentCurrentItem() },
  { id: 'plain', title: 'Plain List', desc: 'Unmarked list, DTBook <list type="pl"> (1-3; nested 1-5, 3-5)', icon: '≡', keywords: ['plain', 'pl', 'list', 'unmarked', 'simple', 'no bullets'], action: () => setBlockStyle('plain') },
  { id: 'index', title: 'Index Entry', desc: 'BANA §21 index entry (1-3; nested 1-5, 3-5; new braille page)', icon: '📇', keywords: ['index', 'entry', 'subentry', 'alphabetic', 'reference', 'skill', 'skills'], action: () => setBlockStyle('index') },
  { id: 'toc', title: 'TOC Entry', desc: 'Table of Contents entry with dot leaders (1-3)', icon: '📑', keywords: ['toc', 'table of contents', 'contents', 'dot leaders', 'leader'], action: () => setBlockStyle('toc') },
  { id: 'dialogue', title: 'Play Dialogue', desc: 'Prose drama dialogue speaker line (1-3)', icon: '🎭', keywords: ['dialogue', 'play', 'drama', 'speaker', 'character', 'line', 'script', 'speech'], action: () => setBlockStyle('dialogue') },
  { id: 'stage', title: 'Stage Direction', desc: 'Drama stage direction indented (7-7)', icon: '🎬', keywords: ['stage', 'direction', 'play', 'drama', 'setting', 'action', 'parenthetical'], action: () => setBlockStyle('stage') },
  { id: 'poem', title: 'Poetry / Verse', desc: 'Poetic stanza verse line (1-3)', icon: '📜', keywords: ['poem', 'poetry', 'verse', 'stanza', 'rhyme', 'lines', 'lyric'], action: () => setBlockStyle('poem') },
  { id: 'exercise', title: 'Exercise Question', desc: 'Numbered exercise question (1-5 / 3-5)', icon: '❓', keywords: ['exercise', 'question', 'problem', 'homework', 'task', 'exam', 'quiz', 'subquestion'], action: () => setBlockStyle('exercise') },
  { id: 'caption', title: 'Caption / Attribution', desc: 'Figure caption or attribution (7-5)', icon: '💬', keywords: ['caption', 'attribution', 'photo', 'figure', 'image', 'label', 'credit'], action: () => setBlockStyle('caption') },
  { id: 'footnote', title: 'Footnote', desc: 'Footnote note text (1-3)', icon: '📝', keywords: ['footnote', 'note', 'reference', 'citation', 'annotation', 'fn'], action: () => setBlockStyle('footnote') },
  { id: 'note', title: "Transcriber's Note", desc: "Transcriber's note with BANA indicators (7-5)", icon: '📋', keywords: ['note', 'transcriber', 'transcriber note', 'tn', 'prodnote', 'comment', 'remark'], action: () => setBlockStyle('note') },
  { id: 'quote', title: 'Blockquote', desc: 'Indented quotation block (3-1)', icon: '“', keywords: ['quote', 'blockquote', 'quotation', 'citation', 'excerpt', 'indent'], action: () => setBlockStyle('quote') },
  { id: 'sidebar', title: 'Sidebar Box', desc: 'Insert callout box with BANA boxlines', icon: '📦', keywords: ['sidebar', 'box', 'callout', 'panel', 'aside'], action: () => insertSidebar() },
  { id: 'table', title: 'Spatial Braille Table', desc: 'Insert 3×3 columnar data table', icon: '📊', keywords: ['table', 'grid', 'column', 'row', 'spatial', 'data'], action: () => insertTable(3, 3, 'spatial') },
  { id: 'listedtable', title: 'Listed Table', desc: 'Insert BANA listed linear table format', icon: '📋', keywords: ['listedtable', 'table', 'listed', 'linear'], action: () => insertTable(3, 3, 'listed') },
  { id: 'matrix', title: 'Math Matrix (2×2 / 3×3)', desc: 'Insert 2×2 or 3×3 visual MathLive matrix', icon: '🔢', keywords: ['matrix', 'pmatrix', 'bmatrix', 'linalg', 'array', 'grid', 'vector'], action: () => insertMathEquation('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'Matrix equation inserted') },
  { id: 'math', title: 'Insert Equation', desc: 'MathLive visual equation (UEB/Nemeth)', icon: '∑', keywords: ['math', 'maths', 'equation', 'latex', 'formula'], action: () => $id('btnMath')?.click() },
  { id: 'formula', title: 'Formula Templates...', desc: 'Browse 340+ math formulas, matrices & equations', icon: '🧮', keywords: ['formula', 'template', 'math', 'equation', 'matrix', 'table', 'algebra', 'calculus', 'frac', 'sqrt'], action: () => openFormulaDialog() },
  { id: 'plot', title: 'Plot Tactile Math Graph...', desc: 'Generate tactile coordinate graph (single or multi-curve)', icon: '📈', keywords: ['plot', 'graph', 'function', 'curve', 'math', 'equation', 'parabola', 'sine', 'line', 'coordinate', 'axes', 'multi'], action: () => {
    const promptEquation = window.prompt('Enter function(s) or comma-separated curves to plot (e.g. x^2 - 4, 2x + 1):', 'x^2 - 4, 2x + 1');
    if (promptEquation) plotAndInsertGraph(promptEquation);
  }},
  { id: 'graphic', title: 'Tactile Graphic Diagram...', desc: 'Browse curated tactile diagrams or upload SVG', icon: '🖼', keywords: ['graphic', 'svg', 'image', 'diagram', 'chart', 'tactile', 'picture', 'drawing', 'map'], action: () => openGraphicDialog() },
  { id: 'break', title: 'Document Break', desc: 'Divider line ( ∗ ∗ ∗ )', icon: '⁂', keywords: ['break', 'divider', 'asterisks', 'line', 'hr', 'separator'], action: () => $id('btnBreak')?.click() },
  { id: 'page', title: 'Print Page Number', desc: 'Insert source print page break indicator', icon: '📄', keywords: ['page', 'printpage', 'pagenum', 'break', 'number', 'pagination'], action: () => insertPrintPage() },
  { id: 'code', title: 'Computer Code', desc: 'Insert Code block with UEB indicators', icon: '💻', keywords: ['code', 'python', 'html', 'js', 'programming', 'script'], action: () => insertTextAtCaret('```\n\n```') },
];

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
      ico.textContent = cmd.icon;

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
  const key = `slash.${cmd.id}_${part}`;
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
function applyEmphasis(node, tf, uncontracted = false) {
  if (tf & TF.bold) node.toggleFormat('bold');
  if (tf & TF.italic) node.toggleFormat('italic');
  if (tf & TF.underline) node.toggleFormat('underline');
  if (uncontracted) node.toggleFormat('code');           // uncontracted (grade 1) run, e.g. a pronunciation (A26)
  return node;
}
function safeMathmlToLatex(mathml) {
  try { return mathmlToLatex(mathml) || ''; }
  catch (e) { console.warn('[maths] MathML could not be converted to LaTeX for editing; original kept:', (e && e.message) || e); return ''; }
}
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
      else if (s.type === 'imgnote') { if (s.text) parent.append($createImgNoteNode(s.text, s.src || null)); }
      else if (s.text) {
        // A forced line break (<br/>, '\n') stays a line break (A26); other space runs collapse.
        String(s.text).split('\n').forEach((part, k) => {
          if (k > 0) parent.append($createLineBreakNode());
          const t = part.replace(/\s+/g, ' ');
          if (t) parent.append(applyEmphasis($createTextNode(t), s.tf || 0, !!s.uncontracted));
        });
      }
    }
  } else if (Array.isArray(b.lines) && b.lines.length > 0) {
    b.lines.forEach((l, idx) => {
      if (idx > 0) parent.append($createLineBreakNode());
      parent.append($createTextNode(String(l)));
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
    parent.append($createTextNode(b.text.replace(/\s+/g, ' ').trim()));
  }
}

// Mirrors input/parse.mjs LEADING_BULLET_RE: the glyph must be FOLLOWED BY WHITESPACE,
// so "-3 is negative" and "*Note* this" keep their first character.
const LEADING_BULLET_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7]+\s+/;
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
    fillFromBlock(h, b);
    parent.append(h);
  } else if (b.type === 'list') {
    const listKind = b.kind || b.style || (b.ordered ? 'number' : null);
    const isPlain = listKind === 'toc' || listKind === 'index' || listKind === 'plain' || b.kind === 'plain';
    const isOrdered = b.ordered || listKind === 'number' || (b.items && b.items.some((it) => it.marker));
    const listType = isPlain ? 'plain' : (isOrdered ? 'number' : 'bullet');
    const list = $createListNode(listType);
    const effectiveKind = listKind || (isPlain ? 'plain' : null);   // plain stays plain (its own style)
    if (effectiveKind) {
      list.setListKind(effectiveKind);
      list.setBanaStyle(effectiveKind);
    }
    for (const it of (b.items || [])) {
      const li = $createListItemNode();
      const cleanItem = stripLeadingListBullet(it);
      const firstSeg = typeof it === 'object' && it.segments ? it.segments[0] : null;
      const rawFirst = typeof it === 'string' ? it : (it.segments ? ((firstSeg && firstSeg.text) || '') : (it.text || ''));
      const bullet = String(rawFirst).match(LEADING_BULLET_RE);
      if (bullet) li.setBulletPrefix({ text: bullet[0], tf: (firstSeg && firstSeg.tf) || 0 });
      fillFromBlock(li, cleanItem);
      if (it.page) li.setPage(it.page);
      if (isOrdered && !isPlain) li.setMarker(it.marker || NO_MARKER);
      if (it.level != null) li.setLevel(it.level);
      if (effectiveKind) li.setBanaStyle(effectiveKind);
      if (li.getChildrenSize()) list.append(li);
    }
    // Lexical joins neighbouring lists of the same type: keep separate source lists apart
    // with an empty paragraph (buildModel skips it), or numbering would run on (A26).
    if (list.getChildrenSize()) {
      const prev = parent.getLastChild();
      if (prev && $isListNode(prev)) parent.append($createParagraphNode());
      parent.append(list);
    }
  } else if (b.type === 'indicator' || b.type === 'break') {
    parent.append($createBreakNode(b.kind || 'asterisks'));
  } else if (b.type === 'pagenum') {
    parent.append($createPrintPageNode(b.page || b.text || '1', b));
  } else if (b.type === 'graphic') {
    if (b.svg) {
      const transpiled = transpileTactileSvg(b.svg, { brailleCode: settings.brailleCode });
      parent.append($createGraphicNode(transpiled.svg || b.svg, b.alt || 'Tactile diagram', b.title || b.alt || 'Tactile diagram', true, true));
    } else {
      parent.append($createImageNode(b));
    }
  } else if (b.type === 'box' || b.type === 'sidebar') {
    const sidebar = $createSidebarNode(b.title || '');
    if (b.id || b.render) sidebar.setSource(b);
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
    parent.append($createTableNode(b.headers || [], b.rows || [], b.format || 'auto', b.title ?? null, b.titlePosition || 'in-box', b.headerGroups || null));
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
  } else {
    const style = getBlockBanaStyle(b);
    const p = $createBanaParagraphNode(style);
    if (b.type === 'footnote' && b.id) p.setNote({ id: b.id, kind: b.kind });
    fillFromBlock(p, b);
    if (b.continued || b.continuation) p.setPageTurn(b.continued && b.continuation ? 'both' : (b.continued ? 'continued' : 'continuation'));
    if (b.blocked) p.setBlocked(true);   // F-39 — BANA §1.9.3
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
    if (!model || !(model.blocks || []).length) throw new Error('No readable content found in this file');
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
    setStatus(t('app.import.notice_status', { message: msg }));
    showParseWarning(t('app.import.partial', { name: file.name, message: msg.replace(/\.\s*$/, '') }));
    announce(t('app.import.notice_status', { message: msg }));
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

function showParseWarning(msg) {
  if (parseWarningBanner && parseWarningText) {
    parseWarningText.textContent = msg;
    parseWarningBanner.hidden = false;
  }
}
function hideParseWarning() {
  if (parseWarningBanner) parseWarningBanner.hidden = true;
}
if (parseWarningClose) parseWarningClose.addEventListener('click', hideParseWarning);

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
  ctx.fillStyle = '#020617';
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
          ctx.fillStyle = '#38bdf8';
          ctx.shadowColor = '#0284c7';
          ctx.shadowBlur = 4;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#1e293b';
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
          ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
          ctx.strokeStyle = '#f59e0b';
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
              const pinColor = isCellHighlighted ? '#fbbf24' : '#38bdf8';
              const shadowColor = isCellHighlighted ? '#f59e0b' : '#38bdf8';
              ctx.fillStyle = pinColor;
              ctx.shadowColor = shadowColor;
              ctx.shadowBlur = 3;
              ctx.fill();
              ctx.shadowBlur = 0;
            } else {
              ctx.beginPath();
              ctx.arc(px, py, 1.1, 0, Math.PI * 2);
              ctx.fillStyle = isCellHighlighted ? '#78350f' : '#1e293b';
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
  ctx.fillStyle = '#020617';
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
          ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
          ctx.strokeStyle = '#f59e0b';
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
        const pinColor = isCellHighlighted ? '#fbbf24' : '#38bdf8';
        const shadowColor = isCellHighlighted ? '#f59e0b' : '#38bdf8';
        ctx.fillStyle = pinColor;
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = isCellHighlighted ? '#78350f' : '#1e293b';
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
  ctx.fillStyle = '#020617';
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
        ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
        ctx.strokeStyle = '#f59e0b';
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
          const pinColor = isCellHighlighted ? '#fbbf24' : '#38bdf8';
          const shadowColor = isCellHighlighted ? '#f59e0b' : '#38bdf8';
          ctx.fillStyle = pinColor;
          ctx.shadowColor = shadowColor;
          ctx.shadowBlur = 4;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = isCellHighlighted ? '#78350f' : '#1e293b';
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
  if ($id('set-volumePages')) $id('set-volumePages').value = settings.volumePages || 0;
  if ($id('set-sixkey')) $id('set-sixkey').checked = settings.sixKeyInput !== false;
  if ($id('set-includeCovers')) $id('set-includeCovers').checked = !!settings.includeCovers;
  if ($id('set-asciiBraille')) $id('set-asciiBraille').checked = !!settings.asciiBraille;
  if ($id('set-tactileGraphics')) $id('set-tactileGraphics').checked = settings.tactileGraphics !== false;
  applySixKeyInput(settings.sixKeyInput !== false);

  const isNet = settings.connectionType === 'network';
  if ($id('networkSettingsGroup')) $id('networkSettingsGroup').style.display = isNet ? 'block' : 'none';
  if ($id('serialBaudGroup')) $id('serialBaudGroup').style.display = isNet ? 'none' : 'block';
  updateGraphicsSupportUI();
  updateBrailleTabsVisibility(autoSwitch);
}

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
  window.addEventListener('beforeunload', (e) => {
    if (isDocumentDirty()) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  $id('backToSimple')?.addEventListener('click', (e) => {
    if (isDocumentDirty()) {
      const ok = window.confirm(t('messages.unsaved_changes', 'You have unsaved changes. Are you sure you want to exit without saving?'));
      if (!ok) {
        e.preventDefault();
        return;
      }
    }
    saveSettings({ simpleMode: true });
    location.href = '/web/index.html';
  });
  $id('settingsBtn')?.addEventListener('click', () => {
    cancelScrollSync();
    applySettingsToUI();
    translateDOM($id('settingsDialog'));
    $id('settingsDialog')?.showModal();
  });
  $id('settingsDialog')?.addEventListener('close', () => {
    cancelScrollSync();
    updateGraphicsSupportUI();
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
    const isNet = $id('set-connectionType').value === 'network';
    if ($id('networkSettingsGroup')) $id('networkSettingsGroup').style.display = isNet ? 'block' : 'none';
    if ($id('serialBaudGroup')) $id('serialBaudGroup').style.display = 'none';
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

    updateGraphicsSupportUI();
    updateBrailleTabsVisibility();

    // Swap the braille code in only once its tables are present (see activateTable).
    activateTable().then(() => scheduleRender());
  };
  // set-embosser and set-connectionType have their own change handlers above (they call
  // onSet themselves); listing them here too ran every save and render twice.
  ['set-networkHost', 'set-networkPort', 'set-baudRate', 'set-embosserDuplex', 'set-language', 'set-mathCode', 'set-mode', 'set-tableFormat', 'set-cells', 'set-lines', 'set-quoteStyle', 'set-listStyle', 'set-paragraphStyle', 'set-volumePages'].forEach((id) => {
    $id(id)?.addEventListener('change', onSet);
    if (['set-cells', 'set-lines', 'set-volumePages', 'set-networkHost', 'set-networkPort'].includes(id)) {
      $id(id)?.addEventListener('input', onSet);
    }
  });
  $id('set-tactileGraphics')?.addEventListener('change', onSet);
  $id('set-uiLanguage')?.addEventListener('change', async (e) => {
    const newLang = e.target.value;
    settings = saveSettings({ uiLanguage: newLang });
    await setLocale(newLang);
    populateUiLanguageDropdown();
    populateLanguageDropdown();
    announce(t('aria.language_changed', { language: newLang }));
  });
  $id('set-sixkey')?.addEventListener('change', () => {
    settings = saveSettings({ sixKeyInput: $id('set-sixkey').checked });
    applySixKeyInput(settings.sixKeyInput);           // input-only: the braille output is unaffected
  });
  $id('set-includeCovers')?.addEventListener('change', () => {
    settings = saveSettings({ includeCovers: $id('set-includeCovers').checked });
    render();
  });
  $id('set-asciiBraille')?.addEventListener('change', () => {
    settings = saveSettings({ asciiBraille: $id('set-asciiBraille').checked });
    render();
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
    if (!lastBrf) return;

    if (settings.connectionType === 'network') {
      try {
        announce(t('app.embosser.sending_network', { host: settings.networkHost || '192.168.1.150' }));
        setStatus(t('app.embosser.sending_network', { host: settings.networkHost || '192.168.1.150' }));
        const res = await spoolToNetworkEmbosser(lastBrf, {
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

    if (!isWebSerialSupported()) {
      const msg = t('app.spool.needs_webserial');
      setStatus(msg);
      announce(msg);
      return;
    }
    try {
      announce(t('spooler.status_connecting'));
      setStatus(t('spooler.status_connecting'));
      const res = await spoolToEmbosser(lastBrf, {
        embosser: settings.embosser || 'generic',
        duplex: settings.embosserDuplex || 'double',
        width: settings.cells || 38,
        depth: settings.lines || 25,
        baudRate: settings.baudRate || 9600,
        onStatus: (msg) => { setStatus(msg); announce(msg); },
        text: uiText,
      });
      if (res.success) {
        setStatus(res.message);
        announce(res.message);
      } else if (res.method === 'cancelled') {
        setStatus(t('app.embosser.cancelled'));
        announce(t('app.embosser.cancelled'));
      }
    } catch (err) {
      console.warn('Embosser hardware communication error:', err);
      setStatus(t('spooler.status_error', { message: err.message }));
      announce(t('spooler.status_error', { message: err.message }));
    }
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

  function updateTactileDisplayUI() {
    const isConn = tactileDisplay.isConnected();
    const info = tactileDisplay.getConnectionInfo();
    if (tactileConnStatus) {
      tactileConnStatus.textContent = isConn ? `Connected: ${info.name}` : 'No display connected';
      tactileConnStatus.style.color = isConn ? '#10b981' : 'var(--muted)';
    }
    const badge = $id('tactileDisplayBadge');
    if (badge) badge.style.display = isConn ? 'inline-flex' : 'none';
    updateBrailleTabsVisibility();
    if (btnConnectTactile) btnConnectTactile.style.display = isConn ? 'none' : 'inline-block';
    if (btnConnectHid) btnConnectHid.style.display = isConn ? 'none' : 'inline-block';
    if (btnDisconnectTactile) btnDisconnectTactile.style.display = isConn ? 'inline-block' : 'none';
    showIdleStatus();
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
      root.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      updateTactileDisplayUI();
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

  function performUndo() {
    flushHistorySnapshot();                 // anything typed in the last burst is undone first
    if (historyIndex > 0) {
      historyIndex--;
      const item = historyStack[historyIndex];
      if (item && item.state) {
        isHistoryUpdating = true;
        try {
          const state = editor.parseEditorState(item.state);
          editor.setEditorState(state);
          item.ref = editor.getEditorState();    // identity fast-path for the next snapshot attempt
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
      historyIndex++;
      const item = historyStack[historyIndex];
      if (item && item.state) {
        isHistoryUpdating = true;
        try {
          const state = editor.parseEditorState(item.state);
          editor.setEditorState(state);
          item.ref = editor.getEditorState();
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
    announce(t('app.history.cleared'));
    setStatus(t('app.history.cleared'));
    ding();
    editor.focus();
  });

  // ---- Expert Hardware & Serial mode toggle (Ctrl+Shift+\) ----
  // Always starts HIDDEN by default on every app startup/reload (not remembered across sessions).
  try { localStorage.removeItem('emboss_expert_hardware'); } catch {}
  let expertHardwareMode = false;

  function toggleHardwareExpertMode() {
    expertHardwareMode = !expertHardwareMode;
    document.body.classList.toggle('expert-hardware', expertHardwareMode);
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

  // ---- Save / Export Text Document ----
  function exportTextDocument(format) {
    flushHistorySnapshot();                 // the saved state is always an undo point
    const title = (lastModel?.title || "document").trim();
    const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";
    if (format === 'package') {
      let currentDocModel = null;
      editor.getEditorState().read(() => {
        currentDocModel = buildModel();
      });
      const doc = currentDocModel || lastModel || { title, blocks: [] };
      const pkg = buildNimasPackage(doc);
      saveBlob(makeZip(pkg.files), pkg.zipName);
      // Like the .xml project save, this download IS the saved document.
      markDocumentClean();
      announce(t('app.save.saved', { file: pkg.zipName }));
      setStatus(t('app.save.package', { file: pkg.zipName, count: pkg.imageCount }));
      return;
    }
    if (format === "xml" || format === "nimas") {
      let currentDocModel = null;
      editor.getEditorState().read(() => {
        currentDocModel = buildModel();
      });
      const doc = currentDocModel || lastModel || { title, blocks: [] };
      const xmlString = exportToNimasXml(doc, { title: doc.title || title });
      saveBlob(new Blob([xmlString], { type: "application/xml;charset=utf-8" }), `${baseName}.xml`);
      // The project file is the one download that *is* the saved document: baseline the
      // dirty tracking on it once the download has been triggered.
      markDocumentClean();
      announce(t('app.save.saved', { file: `${baseName}.xml` }));
      setStatus(t('app.save.nimas', { file: `${baseName}.xml` }));
      return;
    }
    if (format === 'json') {
      const docObj = {
        title,
        date: new Date().toISOString(),
        settings: { ...settings },
        model: lastModel,
        lexical: editor.getEditorState().toJSON()
      };
      saveBlob(new Blob([JSON.stringify(docObj, null, 2)], { type: 'application/json;charset=utf-8' }), `${baseName}.json`);
      announce(t('app.save.saved', { file: `${baseName}.json` }));
      setStatus(t('app.save.native', { file: `${baseName}.json` }));
      return;
    }
    if (format === 'md') {
      const lines = [];
      const segToMd = (segments) => (segments || []).map(s => {
        if (!s) return '';
        if (s.type === 'math') return s.latex ? `$${s.latex}$` : '';
        let t = s.text || '';
        if (s.tf & TF.bold) t = `**${t}**`;          // tf is the liblouis bitmask, not an object
        if (s.tf & TF.italic) t = `*${t}*`;
        if (s.tf & TF.underline) t = `<u>${t}</u>`;
        return t;
      }).join('');

      (lastModel?.blocks || []).forEach((b) => {
        if (b.type === 'heading') lines.push(`${'#'.repeat(b.level || 1)} ${b.text || ''}\n`);
        else if (b.type === 'para') {
          const t = b.segments ? segToMd(b.segments) : (b.text || '');
          lines.push(`${t}\n`);
        } else if (b.type === 'list') {
          (b.items || []).forEach((it, idx) => {
            const marker = isOrderedList(b) ? (it.marker || `${idx + 1}.`) : '*';
            const t = it.segments ? segToMd(it.segments) : (it.text || '');
            lines.push(`${marker} ${t}`);
          });
          lines.push('');
        } else if (b.type === 'table') {
          const headers = b.headers || [];
          const rows = b.rows || [];
          if (headers.length) {
            lines.push(`| ${headers.map(cellToMarkup).join(' | ')} |`);
            lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
          }
          for (const row of rows) {
            lines.push(`| ${(row || []).map(cellToMarkup).join(' | ')} |`);
          }
          lines.push('');
        } else if (b.type === 'indicator') {           // buildModel emits 'indicator' for a section break
          lines.push('* * *\n');
        } else if (b.type === 'note') {
          lines.push(`> ${b.text || ''}\n`);
        } else if (b.type === 'math') {
          lines.push(`$$\n${b.latex || ''}\n$$\n`);
        } else if (b.type === 'graphic') {
          lines.push(`![${b.alt || 'Tactile graphic'}](${b.src || 'graphic'})\n`);
        }
      });
      saveBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `${baseName}.md`);
      announce(t('app.save.saved', { file: `${baseName}.md` }));
      setStatus(t('app.save.markdown', { file: `${baseName}.md` }));
      return;
    }
    if (format === 'txt') {
      const lines = [];
      (lastModel?.blocks || []).forEach((b) => {
        if (b.type === 'heading') lines.push(`\n${(b.text || '').toUpperCase()}\n`);
        else if (b.type === 'para') lines.push(`${b.text || (b.segments ? b.segments.map(s => s.text || (s.latex ? `$${s.latex}$` : '')).join('') : '')}\n`);
        else if (b.type === 'list') {
          (b.items || []).forEach((it, idx) => {
            const t = it.text || (it.segments ? it.segments.map(s => s.text || (s.latex ? `$${s.latex}$` : '')).join('') : '');
            lines.push(`${isOrderedList(b) ? (it.marker || (idx + 1) + '.') : '•'} ${t}`);
          });
          lines.push('');
        } else if (b.type === 'table') {
          const headers = b.headers || [];
          const rows = b.rows || [];
          if (headers.length) lines.push(headers.map(cellPlainText).join('\t'));
          for (const r of rows) lines.push((r || []).map(cellPlainText).join('\t'));
          lines.push('');
        } else if (b.type === 'indicator') lines.push('\n* * *\n');
        else if (b.type === 'note') lines.push(`\n[Note: ${b.text || ''}]\n`);
      });
      saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${baseName}.txt`);
      announce(t('app.save.saved', { file: `${baseName}.txt` }));
      setStatus(t('app.save.text', { file: `${baseName}.txt` }));
      return;
    }
    if (format === 'docx') {
      const blob = exportToDocxBlob(lastModel, title);
      saveBlob(blob, `${baseName}.docx`);
      announce(t('app.save.saved', { file: `${baseName}.docx` }));
      setStatus(t('app.save.word', { file: `${baseName}.docx` }));
      return;
    }
    if (format === 'html') {
      const htmlBody = [];
      const segToHtml = (segments) => (segments || []).map(s => {
        if (!s) return '';
        if (s.type === 'math') return s.mathml || `<math display="inline"><mrow><mtext>${escapeHtml(s.latex || '')}</mtext></mrow></math>`;
        let t = escapeHtml(s.text || '');
        if (s.tf & TF.bold) t = `<strong>${t}</strong>`;
        if (s.tf & TF.italic) t = `<em>${t}</em>`;
        if (s.tf & TF.underline) t = `<u>${t}</u>`;
        return t;
      }).join('');

      (lastModel?.blocks || []).forEach((b) => {
        if (b.type === 'heading') htmlBody.push(`<h${b.level || 1}>${escapeHtml(b.text || '')}</h${b.level || 1}>`);
        else if (b.type === 'para') {
          const inner = b.segments ? segToHtml(b.segments) : escapeHtml(b.text || '');
          htmlBody.push(`<p>${inner}</p>`);
        } else if (b.type === 'list') {
          const tag = isOrderedList(b) ? 'ol' : 'ul';
          const itemsHtml = (b.items || []).map(it => {
            const inner = it.segments ? segToHtml(it.segments) : escapeHtml(it.text || '');
            return `<li>${inner}</li>`;
          }).join('');
          htmlBody.push(`<${tag}>${itemsHtml}</${tag}>`);
        } else if (b.type === 'table') {
          const headers = b.headers || [];
          const rows = b.rows || [];
          const headHtml = headers.length ? `<thead><tr>${headers.map(h => `<th>${segToHtml(cellSegments(h))}</th>`).join('')}</tr></thead>` : '';
          const bodyHtml = `<tbody>${rows.map(r => `<tr>${(r || []).map(c => `<td>${segToHtml(cellSegments(c))}</td>`).join('')}</tr>`).join('')}</tbody>`;
          htmlBody.push(`<table>${headHtml}${bodyHtml}</table>`);
        } else if (b.type === 'indicator') {
          htmlBody.push('<hr />');
        } else if (b.type === 'note') {
          htmlBody.push(`<aside class="transcriber-note"><p>${escapeHtml(b.text || '')}</p></aside>`);
        } else if (b.type === 'math') {
          htmlBody.push(`<div class="math-block">${b.mathml || `<math display="block"><mrow><mtext>${escapeHtml(b.latex || '')}</mtext></mrow></math>`}</div>`);
        } else if (b.type === 'graphic') {
          htmlBody.push(`<figure role="doc-graphic">${b.svg ? sanitizeSvgMarkup(b.svg) : `<svg viewBox="0 0 100 100"><text x="10" y="50">${escapeHtml(b.alt || 'Graphic')}</text></svg>`}<figcaption>${escapeHtml(b.caption || b.alt || '')}</figcaption></figure>`);
        }
      });
      const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:2rem auto;line-height:1.6;padding:0 1rem;}table{border-collapse:collapse;width:100%;margin:1rem 0;}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f4f5f8;}.transcriber-note{background:#f8f9fa;border-left:4px solid #0284c7;padding:8px 16px;margin:1rem 0;}</style></head><body>${htmlBody.join('\n')}</body></html>`;
      saveBlob(new Blob([docHtml], { type: 'text/html;charset=utf-8' }), `${baseName}.html`);
      announce(t('app.save.saved', { file: `${baseName}.html` }));
      setStatus(t('app.save.html', { file: `${baseName}.html` }));
      return;
    }
  }

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

  function triggerDownloadFormat(format = 'brf') {
    closeAllDropdownMenus();
    if (!lastBrf) return;
    const title = (lastModel?.title || document.querySelector('#editor h1, #editor h2, #editor [data-block-type="heading"]')?.textContent || 'document').trim();
    const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
    const opts = {
      ...(lastFormatOpts || currentFormatOpts()),
      suppressHeader: false,
      mode: settings.mode, width: settings.cells, depth: settings.lines,
      volumePages: settings.volumePages, includeCovers: settings.includeCovers,
      duplex: settings.embosserDuplex,
    };
    if (format === 'pef') {
      const pefXml = exportToPef(lastModel || { title: 'Document', blocks: [] }, opts);
      saveBlob(new Blob([pefXml], { type: 'application/x-pef+xml' }), `${baseName}.pef`);
      announce(t('app.save.pef_downloaded'));
      setStatus(t('app.save.pef', { file: `${baseName}.pef` }));
      return;
    }
    if (format === 'ebrl' || format === 'ebrf') {
      const bytes = exportToEbraille(lastModel || { title: 'Document', blocks: [] },
        { ...opts, language: (navigator.language || 'en') });
      saveBlob(new Blob([bytes], { type: 'application/epub+zip' }), `${baseName}.ebrl`);
      announce(t('app.save.saved', { file: `${baseName}.ebrl` }));
      setStatus(t('app.save.ebraille', { file: `${baseName}.ebrl` }));
      return;
    }
    const maxV = Math.max(0, Number(settings.volumePages) || 0);
    const vols = (lastModel && lastFormatOpts) ? formatVolumes(lastModel, { ...lastFormatOpts, suppressHeader: false, volumePages: maxV }) : [{ volume: 1, of: 1, brf: lastBrf || '' }];
    if (vols.length <= 1) { saveBlob(new Blob([vols[0].brf || ''], { type: 'application/octet-stream' }), `${baseName}.brf`); return; }
    const files = vols.map((v) => ({ name: `${baseName}-v${v.volume}-of-${v.of}.brf`, text: v.brf }));
    saveBlob(makeZip(files), `${baseName}-braille-volumes.zip`);
    announce(t('app.save.volumes', { count: vols.length }));
  }

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
  $id('proofBadge')?.addEventListener('click', () => {
    if (lastProofIssues && lastProofIssues.length > 0) {
      proofIssueIdx = proofIssueIdx % lastProofIssues.length;
      const issue = lastProofIssues[proofIssueIdx++];
      const pe = printUnitEl(issue.idx, issue.itemIdx) || editorEl.querySelector(`[data-block-idx="${issue.idx}"]`);
      if (pe) {
        pe.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightWord(issue.idx, issue.itemIdx || 0, issue.start, issue.end);
        announce(t('app.proof.issue', { n: proofIssueIdx, total: lastProofIssues.length, word: issue.word || issue.src || '' }));
      }
    }
  });
  window.addEventListener('resize', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => render(), 100);
  });
}

(async () => {
  if (settings.simpleMode) { location.href = '/web/index.html'; return; }   // Simple mode → the converter
  try {
    await initI18n(settings.uiLanguage || 'en');
  } catch (err) {
    console.warn('initI18n error:', err);
  }
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
  wireControls();
  wireReadingControls();
  updateReadButtons();
  setStatus(t('app.engine.loading'));
  brailleEl.textContent = t('app.engine.loading');
  try {
    const [ver] = await Promise.all([
      louis.init({ tablesBaseUrl: '/liblouis/tables' }),
      maths.initMaths().catch((e) => console.warn('maths engine:', e))
    ]);
    const ev = $id('engineVer'); if (ev) ev.textContent = (ver || '').split(' ')[0] || '3.38.0';
    await activateTable();                 // the persisted braille code, before the first render
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
  // A document uploaded in Quick Mode is handed over via IndexedDB / sessionStorage — load it here
  // instead of the demo (text/headings/lists/emphasis/latex-maths transfer; a docx
  // equation with only MathML becomes an ⟨equation⟩ placeholder).
  let handoff = null;
  try {
    handoff = await getAndClearHandoffDoc();
  } catch (e) {
    console.warn('handoff retrieval error:', e);
  }
  if (handoff && (handoff.blocks || []).length) { setLoadedDocInfo(handoff); modelToLexical(handoff); } else seed();
  clearTranslationCache();
  render();
  refreshToolbar();
  markDocumentClean();
  resetUndoHistory();
  // once MathCAT and MathLive are ready, re-render so the seeded equation transcribes
  Promise.resolve(maths.initMaths()).then(() => {
    clearTranslationCache();
    render();
  }).catch(() => {});
  if (globalThis.customElements) customElements.whenDefined('math-field').then(() => {
    clearTranslationCache();
    render();
  }).catch(() => {});
  setStatus(t('app.engine.ready'));
})();
