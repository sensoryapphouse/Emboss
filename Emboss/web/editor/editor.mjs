// Emboss editor: Lexical (vanilla core) → Emboss block model → live braille.
// Reuses the gold-validated engine (/format + /engine). Adds inline MathLive
// equations, a "* * *" document break, a Table-of-Contents toggle, real UEB
// typeform emphasis, a braille-cell preview, and ARIA-toolbar a11y.
import {
  createEditor, $getRoot, $getSelection, $isRangeSelection,
  $createParagraphNode, $createTextNode, FORMAT_TEXT_COMMAND,
  DecoratorNode, ElementNode, $insertNodes, $getNodeByKey, $insertNodeToNearestRoot,
  registerRichText, HeadingNode, QuoteNode, $createHeadingNode, $isHeadingNode,
  ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND, registerList, $isListNode, $createListNode, $createListItemNode,
  $setBlocksType, TextNode, ParagraphNode, $applyNodeReplacement,
} from './vendor-lexical.mjs';

const $isTextNode = (n) => n instanceof TextNode;
const $isParagraphNode = (n) => n instanceof ParagraphNode;
const $isElementNode = (n) => typeof n?.getChildren === 'function';
import { formatDocument, formatVolumes } from '/format/document.mjs';
import { formatStyleInspectorBadge, STYLE_DEFINITIONS, getStyleMargins } from '/format/styles.mjs';
import { makeZip } from '/web/zip.mjs';
import { exportToDocxBlob } from '/web/docx-export.mjs';
import { exportToNimasXml } from '/input/nimas-export.mjs';
import { Reader, buildSpokenItems, speechAvailable, sliceItemsFrom } from '/web/tts.mjs';
import * as louis from '/engine/louis-browser.mjs';
import { renderBraille, expandRowCells } from '/web/braille-render.mjs';
import { proofread, roundTrip, blockEntries } from '/web/proofread.mjs';
import { parseFile, BINARY_EXTS } from '/input/parse.mjs';
import { BRF64, brfToUnicodeBraille, unicodeBrailleToBrf } from '/engine/brf-ascii.mjs';
import * as maths from '/engine/maths.mjs';
import { styledTranslate, exchangeQuotes } from '/format/text-style.mjs';
import { loadSettings, saveSettings, MODE_GEOMETRY, EMBOSSER_NAMES, EMBOSSER_PRESETS, isGraphicsSupported, effectiveMathCode } from '/web/settings.mjs';
import { resolveTable, makeTranslators, UEB_TABLES } from '/web/braille-table.mjs';
import { spoolToEmbosser, spoolToNetworkEmbosser, isWebSerialSupported, initEmbosserAutoDetect } from '/format/spooler.mjs';
import { transpileTactileSvg, transpileTactileSvgForDevice, createGraphicBlock, defaultBrailleTranslator, createLeadLineSvg } from '/format/tactile-svg.mjs';
import { plotTactileFunction, isPlottableEquation } from '/format/math-plotter.mjs';
import { TACTILE_SVG_LIBRARY, TACTILE_SVG_CATEGORIES } from '/web/tactile-library.js';
import { exportToPef } from '/format/pef.mjs';
import { exportToEbraille } from '/format/ebraille.mjs';
import { tactileDisplay, rasterizeSvgToDotPadCells, charToDotMask } from '/format/tactile-display.mjs';
import { openTactileSymbolBrowser } from '/web/tactile-browser.mjs';
import { CODES } from '/Translate/braille-codes.mjs';
import { describeUebMaths } from '/Translate/ueb-maths-to-latex.mjs';
import { describeNemeth } from '/Translate/nemeth-symbols.mjs';
import { uebHybrid, nemethHybrid } from '/Translate/maths-hybrid.mjs';
import { nemethMathsToLatexV2 } from '/Translate/nemeth-rules.mjs';
import { NEM_OPEN, NEM_CLOSE } from '/Translate/nemeth-switch.mjs';
import { getAndClearHandoffDoc } from '/web/handoff-db.mjs';
import { initI18n, t, setLocale, getLocale, getLocaleInfo, getSupportedLocales, getOrderedLocales, translateDOM, registerLocale } from '/web/i18n.mjs';

let settings = loadSettings();                 // standard / grade / geometry / quotes / lists / toc (shared with the converter)
if (typeof window !== 'undefined') window.settings = settings;
const $id = (id) => document.getElementById(id);
const brailleEl = $id('braille');
const brlStackEl = $id('brlStack');
const brlInputEl = $id('brlInput');
const editorEl = $id('editor');
let currentStatusText = '';
let lastCaretWordKey = '';
let caretSyncTimer = null;
export let isReconcilingBrailleToPrint = false;
export let isRenderingPrintToBraille = false;
export let activeSyncSource = null; // 'print' | 'braille' | null
export let lastRenderedBrailleText = '';
let brailleSyncTimer = null;
const setStatus = (m) => {
  currentStatusText = m || '';
  const docStats = $id('docStats');
  if (docStats) docStats.textContent = currentStatusText;
  const el = $id('status');
  if (el) el.textContent = currentStatusText;
};
const announce = (msg) => { const a = $id('announce'); if (!a) return; a.textContent = ''; setTimeout(() => { a.textContent = msg; }, 30); };
const TF = louis.TYPEFORM;   // single source of truth (italic=1, underline=2, bold=4)

// ---- BANA style extensions on ParagraphNode ----
ParagraphNode.prototype.getBanaStyle = function() {
  return this.getLatest().__banaStyle || null;
};
ParagraphNode.prototype.setBanaStyle = function(s) {
  const writable = this.getWritable();
  writable.__banaStyle = s || null;
  return this;
};

const origParagraphAfterCloneFrom = ParagraphNode.prototype.afterCloneFrom;
ParagraphNode.prototype.afterCloneFrom = function(prevNode) {
  origParagraphAfterCloneFrom.call(this, prevNode);
  this.__banaStyle = prevNode.__banaStyle || null;
};

const origParagraphCreateDOM = ParagraphNode.prototype.createDOM;
ParagraphNode.prototype.createDOM = function(config) {
  const dom = origParagraphCreateDOM.call(this, config);
  const style = this.getBanaStyle();
  if (style) {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  return dom;
};

const origParagraphUpdateDOM = ParagraphNode.prototype.updateDOM;
ParagraphNode.prototype.updateDOM = function(prevNode, dom, config) {
  const res = origParagraphUpdateDOM.call(this, prevNode, dom, config);
  const prevStyle = prevNode ? prevNode.__banaStyle || null : null;
  const nextStyle = this.__banaStyle || null;
  if (prevStyle !== nextStyle) {
    if (prevStyle) dom.classList.remove(`bana-style-${prevStyle}`);
    if (nextStyle) {
      dom.classList.add(`bana-style-${nextStyle}`);
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
  }
  return res;
};

const $createBanaParagraphNode = (style) => {
  const p = $createParagraphNode();
  if (style) p.setBanaStyle(style);
  return p;
};
const $isBanaParagraphNode = (n) => n instanceof ParagraphNode;

// ---- BANA style extensions on ListNode and ListItemNode ----
ListNode.prototype.getBanaStyle = function() {
  return this.getLatest().__banaStyle || null;
};
ListNode.prototype.setBanaStyle = function(s) {
  const writable = this.getWritable();
  writable.__banaStyle = s || null;
  return this;
};
ListNode.prototype.getListKind = function() {
  return this.getLatest().__listKind || null;
};
ListNode.prototype.setListKind = function(k) {
  const writable = this.getWritable();
  writable.__listKind = k || null;
  return this;
};

const origListAfterCloneFrom = ListNode.prototype.afterCloneFrom;
ListNode.prototype.afterCloneFrom = function(prevNode) {
  origListAfterCloneFrom.call(this, prevNode);
  this.__banaStyle = prevNode.__banaStyle || null;
  this.__listKind = prevNode.__listKind || null;
};

const origListCreateDOM = ListNode.prototype.createDOM;
ListNode.prototype.createDOM = function(config) {
  const dom = origListCreateDOM.call(this, config);
  const style = this.getBanaStyle() || this.getListKind();
  const listType = this.getListType();
  if (listType === 'plain' || style === 'toc' || style === 'index' || style === 'plain') {
    dom.classList.add('emboss-plain-list');
  }
  if (style) {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  const kind = this.getListKind();
  if (kind) {
    dom.dataset.listKind = kind;
  }
  return dom;
};

const origListUpdateDOM = ListNode.prototype.updateDOM;
ListNode.prototype.updateDOM = function(prevNode, dom, config) {
  const res = origListUpdateDOM.call(this, prevNode, dom, config);
  const prevStyle = (typeof prevNode.getBanaStyle === 'function' ? prevNode.getBanaStyle() : null) || prevNode.__listKind;
  const nextStyle = this.getBanaStyle() || this.getListKind();
  const listType = this.getListType();

  if (listType === 'plain' || nextStyle === 'toc' || nextStyle === 'index' || nextStyle === 'plain') {
    dom.classList.add('emboss-plain-list');
  } else {
    dom.classList.remove('emboss-plain-list');
  }

  if (prevStyle !== nextStyle) {
    if (prevStyle) dom.classList.remove(`bana-style-${prevStyle}`);
    if (nextStyle) {
      dom.classList.add(`bana-style-${nextStyle}`);
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
  }
  const kind = this.getListKind();
  if (kind) dom.dataset.listKind = kind;
  else delete dom.dataset.listKind;
  return res;
};

ListItemNode.prototype.getPage = function() {
  return this.getLatest().__page || null;
};
ListItemNode.prototype.setPage = function(p) {
  const writable = this.getWritable();
  writable.__page = p || null;
  return this;
};
ListItemNode.prototype.getLevel = function() {
  const latest = this.getLatest();
  if (latest.__level != null) return latest.__level;
  return typeof this.getIndent === 'function' ? this.getIndent() : (latest.__indent || 0);
};
ListItemNode.prototype.setLevel = function(lvl) {
  const writable = this.getWritable();
  writable.__level = (lvl | 0) || 0;
  return this;
};
ListItemNode.prototype.getBanaStyle = function() {
  return this.getLatest().__banaStyle || null;
};
ListItemNode.prototype.setBanaStyle = function(s) {
  const writable = this.getWritable();
  writable.__banaStyle = s || null;
  return this;
};

const origListItemAfterCloneFrom = ListItemNode.prototype.afterCloneFrom;
ListItemNode.prototype.afterCloneFrom = function(prevNode) {
  origListItemAfterCloneFrom.call(this, prevNode);
  this.__banaStyle = prevNode.__banaStyle || null;
  this.__page = prevNode.__page || null;
  this.__level = prevNode.__level != null ? prevNode.__level : null;
};

const origListItemCreateDOM = ListItemNode.prototype.createDOM;
ListItemNode.prototype.createDOM = function(config) {
  const dom = origListItemCreateDOM.call(this, config);
  const style = typeof this.getBanaStyle === 'function' ? this.getBanaStyle() : this.__banaStyle;
  if (style) {
    dom.classList.add(`bana-style-${style}`);
    dom.dataset.banaStyle = style;
  }
  const page = typeof this.getPage === 'function' ? this.getPage() : this.__page;
  if (page) {
    dom.dataset.page = page;
  }
  const indent = typeof this.getLevel === 'function' ? this.getLevel() : (this.__level || 0);
  if (indent > 0) {
    dom.dataset.level = indent;
  }
  return dom;
};

const origListItemUpdateDOM = ListItemNode.prototype.updateDOM;
ListItemNode.prototype.updateDOM = function(prevNode, dom, config) {
  const res = origListItemUpdateDOM.call(this, prevNode, dom, config);
  const prevStyle = typeof prevNode.getBanaStyle === 'function' ? prevNode.getBanaStyle() : prevNode.__banaStyle;
  const nextStyle = typeof this.getBanaStyle === 'function' ? this.getBanaStyle() : this.__banaStyle;
  if (prevStyle !== nextStyle) {
    if (prevStyle) dom.classList.remove(`bana-style-${prevStyle}`);
    if (nextStyle) {
      dom.classList.add(`bana-style-${nextStyle}`);
      dom.dataset.banaStyle = nextStyle;
    } else {
      delete dom.dataset.banaStyle;
    }
  }
  const page = typeof this.getPage === 'function' ? this.getPage() : this.__page;
  if (page) dom.dataset.page = page;
  else delete dom.dataset.page;

  const indent = typeof this.getLevel === 'function' ? this.getLevel() : (this.__level || 0);
  if (indent > 0) dom.dataset.level = indent;
  else delete dom.dataset.level;

  return res;
};

const $createPlainListNode = (kind = 'toc') => {
  const list = $createListNode('plain');
  list.setBanaStyle(kind);
  list.setListKind(kind);
  return list;
};

class SidebarNode extends ElementNode {
  static getType() { return 'emboss-sidebar'; }
  static clone(n) { return new SidebarNode(n.__title, n.__key); }
  constructor(title = '', key) {
    super(key);
    this.__title = title || '';
    this.__banaStyle = 'sidebar';
  }
  createDOM(config) {
    const aside = document.createElement('aside');
    aside.className = 'emboss-sidebar-card bana-style-sidebar';
    aside.dataset.banaStyle = 'sidebar';
    if (this.__title) aside.dataset.title = this.__title;
    return aside;
  }
  updateDOM(prevNode, dom, config) {
    const nextTitle = this.getTitle();
    const prevTitle = typeof prevNode.getTitle === 'function' ? prevNode.getTitle() : prevNode.__title;
    if (nextTitle !== prevTitle) {
      if (nextTitle) dom.dataset.title = nextTitle;
      else delete dom.dataset.title;
    }
    return false;
  }
  afterCloneFrom(prevNode) {
    super.afterCloneFrom(prevNode);
    this.__title = prevNode.__title || '';
    this.__banaStyle = prevNode.__banaStyle || 'sidebar';
  }
  getTitle() { return this.getLatest().__title || ''; }
  setTitle(t) { this.getWritable().__title = t || ''; return this; }
  getBanaStyle() { return 'sidebar'; }
  setBanaStyle(s) { return this; }
  exportJSON() {
    return {
      ...super.exportJSON(),
      type: 'emboss-sidebar',
      version: 1,
      title: this.__title,
      banaStyle: this.__banaStyle,
    };
  }
  static importJSON(j) {
    const n = new SidebarNode(j.title);
    n.__banaStyle = j.banaStyle || 'sidebar';
    return n;
  }
  canInsertBlockAfter() { return true; }
  canIndent() { return false; }
  collapseAtStart() { return true; }
}
const $createSidebarNode = (title = '') => $applyNodeReplacement ? $applyNodeReplacement(new SidebarNode(title)) : new SidebarNode(title);
const $isSidebarNode = (n) => n instanceof SidebarNode;

class MathNode extends DecoratorNode {
  static getType() { return 'emboss-math'; }
  static clone(n) { return new MathNode(n.__latex, n.__key); }
  constructor(latex = '', key) { super(key); this.__latex = latex; }
  createDOM() { const s = document.createElement('span'); s.className = 'math-embed'; return s; }
  updateDOM() { return false; }
  setLatex(l) { this.getWritable().__latex = l; }
  getLatex() { return this.getLatest().__latex; }
  decorate() { return this.getLatest().__latex; }
  isInline() { return true; }
  isKeyboardSelectable() { return true; }
  exportJSON() { return { type: 'emboss-math', version: 1, latex: this.__latex }; }
  static importJSON(j) { return new MathNode(j.latex); }
}
const $createMathNode = (latex) => new MathNode(latex);
const $isMathNode = (n) => n instanceof MathNode;

class BreakNode extends DecoratorNode {
  static getType() { return 'emboss-break'; }
  static clone(n) { return new BreakNode(n.__key); }
  createDOM() { const d = document.createElement('div'); d.className = 'doc-break'; d.textContent = '∗ ∗ ∗'; return d; }
  updateDOM() { return false; }
  decorate() { return null; }              // static content — nothing to mount
  isInline() { return false; }
  exportJSON() { return { type: 'emboss-break', version: 1 }; }
  static importJSON() { return new BreakNode(); }
}
const $createBreakNode = () => new BreakNode();
const $isBreakNode = (n) => n instanceof BreakNode;

class PrintPageNode extends DecoratorNode {
  static getType() { return 'emboss-print-page'; }
  static clone(n) { return new PrintPageNode(n.__page, n.__key); }
  constructor(page = '1', key) {
    super(key);
    this.__page = String(page);
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
  exportJSON() { return { type: 'emboss-print-page', version: 1, page: this.__page }; }
  static importJSON(j) { return new PrintPageNode(j.page); }
}
const $createPrintPageNode = (page) => new PrintPageNode(page);
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
    d.setAttribute('aria-label', this.__alt || 'Tactile diagram');
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

class TableNode extends DecoratorNode {
  __headers = [];
  __rows = [];
  __format = 'auto';
  __caption = '';
  __tabletn = '';

  static getType() { return 'emboss-table'; }
  static clone(n) {
    return new TableNode(
      [...(n.__headers || [])],
      (n.__rows || []).map(r => [...r]),
      n.__format || 'auto',
      n.__caption || '',
      n.__tabletn || '',
      n.__key
    );
  }
  constructor(headers = [], rows = [], format = 'auto', caption = '', tabletn = '', key) {
    super(key);
    this.__headers = Array.isArray(headers) ? headers : [];
    this.__rows = Array.isArray(rows) ? rows : [];
    this.__format = format || 'auto';
    this.__caption = caption || '';
    this.__tabletn = tabletn || '';
  }
  createDOM() {
    const d = document.createElement('div');
    d.className = 'doc-table-block';
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', 'Table data block');
    return d;
  }
  afterCloneFrom(prevNode) {
    super.afterCloneFrom(prevNode);
    this.__headers = [...(prevNode.__headers || [])];
    this.__rows = (prevNode.__rows || []).map(r => [...r]);
    this.__format = prevNode.__format || 'auto';
    this.__caption = prevNode.__caption || '';
    this.__tabletn = prevNode.__tabletn || '';
  }
  // See GraphicNode.updateDOM: "+ Row / + Col" changed the model (and the braille)
  // while the visible grid and its "(N cols × M rows)" title stayed stale.
  updateDOM() { return true; }
  decorate() {
    return {
      type: 'table',
      headers: this.__headers,
      rows: this.__rows,
      format: this.__format,
      caption: this.__caption,
      tabletn: this.__tabletn,
    };
  }
  isInline() { return false; }
  getHeaders() { return this.__headers || []; }
  getRows() { return this.__rows || []; }
  getFormat() { return this.__format || 'auto'; }
  getCaption() { return this.__caption || ''; }
  getTabletn() { return this.__tabletn || ''; }
  setHeaders(h) { this.getWritable().__headers = h; }
  setRows(r) { this.getWritable().__rows = r; }
  setFormat(f) { this.getWritable().__format = f || 'auto'; }
  setCaption(c) { this.getWritable().__caption = c || ''; }
  setTabletn(tn) { this.getWritable().__tabletn = tn || ''; }
  setCell(ri, ci, val) {
    const w = this.getWritable();
    if (ri === -1) {
      const h = [...(w.__headers || [])];
      while (h.length <= ci) h.push('');
      h[ci] = val;
      w.__headers = h;
    } else {
      const rows = (w.__rows || []).map(r => [...r]);
      while (rows.length <= ri) rows.push([]);
      while (rows[ri].length <= ci) rows[ri].push('');
      rows[ri][ci] = val;
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
      format: this.__format,
      caption: this.__caption,
      tabletn: this.__tabletn,
    };
  }
  static importJSON(j) {
    return new TableNode(j.headers || [], j.rows || [], j.format || 'auto', j.caption || '', j.tabletn || '');
  }
}
const $createTableNode = (headers, rows, format = 'auto', caption = '', tabletn = '') =>
  $applyNodeReplacement ? $applyNodeReplacement(new TableNode(headers, rows, format, caption, tabletn)) : new TableNode(headers, rows, format, caption, tabletn);
const $isTableNode = (n) => n instanceof TableNode;

// ---- editor ----
const editor = createEditor({
  namespace: 'emboss',
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, MathNode, BreakNode, GraphicNode, TableNode, PrintPageNode, SidebarNode],
  onError: (e) => { console.warn('Lexical non-fatal state warning:', e); },
  theme: { heading: { h1: 'ed-h1', h2: 'ed-h2', h3: 'ed-h3' }, list: { ul: 'ed-ul', ol: 'ed-ol' }, paragraph: 'ed-p',
    text: { underline: 'ed-u', strikethrough: 'ed-s', underlineStrikethrough: 'ed-u ed-s' } },
});
editor.setRootElement($id('editor'));
window.editor = editor;
registerRichText(editor);
registerList(editor);

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
      btnSize.title = 'Cycle diagram size on embosser: Compact -> Half Page -> Full Page';
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
      btnTextures.title = 'Toggle color-to-tactile texture mapping';
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
      btnLabels.title = 'Toggle automatic Braille label transcription';
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
      btnLeadLine.textContent = '🏷 + Label';
      btnLeadLine.title = 'Add tactile Braille callout label with BANA lead line';
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
      btnDel.textContent = '🗑 Delete';
      btnDel.title = 'Remove tactile diagram';
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
      mf.setAttribute('math-virtual-keyboard-policy', 'onfocus');
      mf.setAttribute('smart-mode', '');
      mf.value = val;

      const btnPlot = document.createElement('button');
      btnPlot.type = 'button';
      btnPlot.className = 'math-plot-btn';
      btnPlot.textContent = '📈 Plot';
      btnPlot.title = 'Plot tactile coordinate graph for this math equation';
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
      if (el.querySelector('.editor-table-widget')) continue;
      el.innerHTML = '';

      const bar = document.createElement('div');
      bar.className = 'table-context-bar';

      const colCount = Math.max(val.headers?.length || 0, ...(val.rows?.map(r => r.length) || [0]), 1);
      const rowCount = val.rows?.length || 0;

      const titleSpan = document.createElement('strong');
      titleSpan.textContent = `📊 Table (${colCount} cols × ${rowCount} rows)`;
      titleSpan.style.marginRight = 'auto';
      bar.appendChild(titleSpan);

      // Table Format Mode Toggle Button
      const btnMode = document.createElement('button');
      btnMode.type = 'button';
      btnMode.className = 'table-context-btn table-mode-btn';
      const formatLabels = {
        auto: '⚙ Format: Auto',
        spatial: '📊 Format: Spatial',
        listed: '📋 Format: Listed'
      };
      const currentFormat = val.format || 'auto';
      btnMode.textContent = formatLabels[currentFormat] || '⚙ Format: Auto';
      btnMode.title = 'Cycle table Braille layout: Auto (spatial if fits) -> Force Spatial -> Force Listed';
      btnMode.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) {
            const nextMap = { auto: 'spatial', spatial: 'listed', listed: 'auto' };
            const nextFormat = nextMap[n.getFormat()] || 'auto';
            n.setFormat(nextFormat);
            btnMode.textContent = formatLabels[nextFormat] || '⚙ Format: Auto';
          }
        });
        clearTranslationCache();
        scheduleRender();
      });
      bar.appendChild(btnMode);

      const btnAddRow = document.createElement('button');
      btnAddRow.type = 'button';
      btnAddRow.className = 'table-context-btn';
      btnAddRow.textContent = '+ Row';
      btnAddRow.title = 'Add row below';
      btnAddRow.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) n.addRow();
        });
        clearTranslationCache();
        scheduleRender();
      });
      bar.appendChild(btnAddRow);

      const btnAddCol = document.createElement('button');
      btnAddCol.type = 'button';
      btnAddCol.className = 'table-context-btn';
      btnAddCol.textContent = '+ Col';
      btnAddCol.title = 'Add column to the right';
      btnAddCol.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) n.addColumn();
        });
        clearTranslationCache();
        scheduleRender();
      });
      bar.appendChild(btnAddCol);

      const btnDelRow = document.createElement('button');
      btnDelRow.type = 'button';
      btnDelRow.className = 'table-context-btn';
      btnDelRow.textContent = '- Row';
      btnDelRow.title = 'Remove bottom row';
      btnDelRow.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n) && n.getRows().length > 1) {
            n.removeRow(n.getRows().length - 1);
          }
        });
        clearTranslationCache();
        scheduleRender();
      });
      bar.appendChild(btnDelRow);

      const btnDelCol = document.createElement('button');
      btnDelCol.type = 'button';
      btnDelCol.className = 'table-context-btn';
      btnDelCol.textContent = '- Col';
      btnDelCol.title = 'Remove rightmost column';
      btnDelCol.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) {
            const cols = Math.max(n.getHeaders().length, ...(n.getRows().map(r => r.length)));
            if (cols > 1) n.removeColumn(cols - 1);
          }
        });
        clearTranslationCache();
        scheduleRender();
      });
      bar.appendChild(btnDelCol);

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'table-context-btn danger';
      btnDelete.textContent = '🗑 Delete';
      btnDelete.title = 'Delete table';
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isTableNode(n)) n.remove();
        });
        clearTranslationCache();
        scheduleRender();
      });
      bar.appendChild(btnDelete);

      el.appendChild(bar);

      const table = document.createElement('table');
      table.className = 'editor-table-widget';

      // Cell keyboard handler
      const setupCellKeyboard = (input, rIdx, cIdx, totalRows, totalCols) => {
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Tab' && !e.shiftKey) {
            const nextInput = table.querySelector(`input[data-ri="${rIdx}"][data-ci="${cIdx + 1}"]`) ||
                              table.querySelector(`input[data-ri="${rIdx + 1}"][data-ci="0"]`);
            if (nextInput) {
              e.preventDefault();
              nextInput.focus();
            } else if (rIdx === totalRows - 1 && cIdx === totalCols - 1) {
              e.preventDefault();
              editor.update(() => {
                const n = $getNodeByKey(key);
                if ($isTableNode(n)) n.addRow();
              });
              clearTranslationCache();
              scheduleRender();
            }
          } else if (e.key === 'Tab' && e.shiftKey) {
            const prevInput = table.querySelector(`input[data-ri="${rIdx}"][data-ci="${cIdx - 1}"]`) ||
                              table.querySelector(`input[data-ri="${rIdx - 1}"][data-ci="${totalCols - 1}"]`);
            if (prevInput) {
              e.preventDefault();
              prevInput.focus();
            }
          } else if (e.key === 'Enter') {
            const belowInput = table.querySelector(`input[data-ri="${rIdx + 1}"][data-ci="${cIdx}"]`);
            if (belowInput) {
              e.preventDefault();
              belowInput.focus();
            }
          }
        });
      };

      if (val.headers && val.headers.length > 0) {
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        val.headers.forEach((h, ci) => {
          const th = document.createElement('th');
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'table-cell-input table-header-input';
          input.dataset.ri = '-1';
          input.dataset.ci = String(ci);
          input.value = h;
          input.placeholder = `Header ${ci + 1}`;
          setupCellKeyboard(input, -1, ci, rowCount, colCount);
          input.addEventListener('input', () => {
            editor.update(() => {
              const n = $getNodeByKey(key);
              if ($isTableNode(n)) n.setCell(-1, ci, input.value);
            });
            clearTranslationCache();
            scheduleRender();
          });
          th.appendChild(input);
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
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'table-cell-input';
          input.dataset.ri = String(ri);
          input.dataset.ci = String(ci);
          input.value = row[ci] || '';
          input.placeholder = '...';
          setupCellKeyboard(input, ri, ci, rowCount, colCount);
          input.addEventListener('input', () => {
            editor.update(() => {
              const n = $getNodeByKey(key);
              if ($isTableNode(n)) n.setCell(ri, ci, input.value);
            });
            clearTranslationCache();
            scheduleRender();
          });
          td.appendChild(input);
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
      badge.innerHTML = '📄 Print Page';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'page-num-input';
      input.value = val.page || '1';
      input.setAttribute('aria-label', 'Print page number');
      input.title = 'Edit source print page number';

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
      btnDel.title = 'Remove print page indicator';
      btnDel.setAttribute('aria-label', 'Remove print page indicator');
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        editor.update(() => {
          const n = $getNodeByKey(key);
          if ($isPrintPageNode(n)) n.remove();
        });
        clearTranslationCache();
        scheduleRender();
        announce('Removed print page number');
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
    if (norm === 'bullet' || norm === 'number' || norm === 'plain' || norm === 'toc' || norm === 'exercise') {
      if (norm === 'toc' || norm === 'plain') {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            const nodes = sel.getNodes();
            for (const n of nodes) {
              const top = n.getTopLevelElement();
              if (top && $isListNode(top)) {
                top.setListType('plain');
                if (typeof top.setListKind === 'function') top.setListKind(norm === 'toc' ? 'toc' : 'plain');
                if (typeof top.setBanaStyle === 'function') top.setBanaStyle(norm === 'toc' ? 'toc' : 'plain');
              }
            }
          }
        });
      } else if (norm === 'exercise') {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        editor.update(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            const nodes = sel.getNodes();
            for (const n of nodes) {
              const top = n.getTopLevelElement();
              if (top && $isListNode(top)) {
                if (typeof top.setListKind === 'function') top.setListKind('exercise');
                if (typeof top.setBanaStyle === 'function') top.setBanaStyle('exercise');
              }
            }
          }
        });
      } else {
        editor.dispatchCommand(norm === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
      }
    } else if (norm === 'h1' || norm === 'h2' || norm === 'h3') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => $createHeadingNode(norm));
        }
      });
    } else if (norm === 'quote') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => {
            const p = $createParagraphNode();
            p.setBanaStyle('quote');
            return p;
          });
        }
      });
    } else {
      // Paragraph with optional BANA style (dialogue, stage, poem, caption, footnote, note, or null for body)
      const banaStyle = (norm === 'p' || norm === 'body') ? null : norm;
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => $createBanaParagraphNode(banaStyle));
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
  const selectEl = $id('blockStyle');
  const label = selectEl?.selectedOptions[0]?.text || v;
  announce(label);
}
window.applyBlockStyle = applyBlockStyle;
window.setBlockStyle = setBlockStyle;
window.updateStyleInspector = updateStyleInspector;
window.formatStyleInspectorBadge = formatStyleInspectorBadge;
$id('blockStyle')?.addEventListener('change', (e) => applyBlockStyle(e.target.value));

// ---- toolbar: emphasis ----
function fmtBtn(id, format, label) {
  $id(id).addEventListener('click', () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format); editor.focus();
    editor.getEditorState().read(() => {
      const s = $getSelection();
      announce(label + (($isRangeSelection(s) && s.hasFormat(format)) ? ' on' : ' off'));
    });
  });
}
fmtBtn('btnBold', 'bold', 'Bold'); fmtBtn('btnItalic', 'italic', 'Italic'); fmtBtn('btnUnderline', 'underline', 'Underline');

// ---- toolbar: maths / break / TOC ----
// Keep the editor's selection alive when a toolbar BUTTON is pressed (mousedown
['btnBold', 'btnItalic', 'btnUnderline', 'btnMath', 'btnFormula', 'btnTable', 'btnGraphic', 'btnBreak'].forEach((id) =>
  $id(id)?.addEventListener('mousedown', (e) => e.preventDefault()));

let savedLexicalBlockKey = null;
let lastKnownEditorBlockIndex = null;

function saveCurrentLexicalBlock() {
  try {
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel) && sel.anchor.key !== 'root') {
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
}, { passive: true });
editorEl.addEventListener('keyup', (e) => {
  updateEditorBlockIndex();
  syncCaretWithBraille();
}, { passive: true });
editorEl.addEventListener('click', updateEditorBlockIndex, { passive: true });
document.addEventListener('selectionchange', () => {
  updateEditorBlockIndex();
  syncCaretWithBraille();
}, { passive: true });

function insertMathEquation(latex = '', label = 'Equation inserted — type the maths') {
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
    const firstItem = insertDropdown.querySelector('.insert-item:not([style*="display: none"])');
    firstItem?.focus({ preventScroll: true });
  }
}

function closeAllDropdownMenus() {
  closeInsertMenu();
  const saveMenu = $id('saveMenu');
  const saveBtn = $id('saveDocBtn');
  if (saveMenu && !saveMenu.hidden) {
    saveMenu.hidden = true;
    saveBtn?.setAttribute('aria-expanded', 'false');
  }
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
  if (!e.target.closest('#insertMenuWrap') && !e.target.closest('#saveMenuWrap') && !e.target.closest('#downloadMenuWrap')) {
    closeAllDropdownMenus();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllDropdownMenus();
  }
});

$id('btnMath')?.addEventListener('click', () => insertMathEquation('', 'Equation inserted — type the maths'));
$id('btnFormula')?.addEventListener('click', () => openFormulaDialog());
$id('btnTable')?.addEventListener('click', () => insertTable(3, 3));
$id('btnBreak')?.addEventListener('click', () => {
  editor.update(() => {
    const sel = $getSelection();
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot($createBreakNode());
    else $getRoot().append($createBreakNode());
  });
  announce('Document break inserted');
});

function insertPrintPage(pageVal) {
  let p = pageVal;
  if (!p) {
    // Find last page number in document to auto-increment
    editor.getEditorState().read(() => {
      let lastPageNum = null;
      for (const node of $getRoot().getChildren()) {
        if ($isPrintPageNode(node)) {
          const raw = node.getPage().trim();
          const match = raw.match(/(\d+)$/);
          if (match) lastPageNum = parseInt(match[1], 10);
        }
      }
      p = (lastPageNum != null && !isNaN(lastPageNum)) ? String(lastPageNum + 1) : '1';
    });
  }
  if (!p) p = '1';
  editor.update(() => {
    const sel = $getSelection();
    const node = $createPrintPageNode(p);
    if ($isRangeSelection(sel)) $insertNodeToNearestRoot(node);
    else $getRoot().append(node);
  });
  announce(`Print page ${p} inserted`);
}
window.insertPrintPage = insertPrintPage;
$id('btnInsertPrintPage')?.addEventListener('click', () => insertPrintPage());
$id('tocToggle')?.addEventListener('change', (e) => {
  settings = saveSettings({ toc: e.target.checked });
  clearTranslationCache();
  announce('Table of contents ' + (e.target.checked ? 'on' : 'off'));
  render();
});

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
      if (latex) {
        const mathml = convertLatexCached(latex);
        if (mathml) {
          runs.push({ type: 'math', mathml, latex });
          hasMath = true;
        }
      }
      continue;
    }
    const text = child.getTextContent();
    if (!text) continue;
    let tf = 0;
    let uncontracted = false;
    if (typeof child.hasFormat === 'function') {
      if (child.hasFormat('bold')) tf |= TF.bold;
      if (child.hasFormat('italic')) tf |= TF.italic;
      if (child.hasFormat('underline')) tf |= TF.underline;
      if (child.hasFormat('code')) uncontracted = true;
    }
    if (tf || uncontracted) hasEmph = true;
    const run = { type: 'text', text, tf };
    if (uncontracted) run.uncontracted = true;
    runs.push(run);
  }
  return { runs, hasEmph, hasMath };
}
function paraBlock(node) {
  const { runs, hasEmph, hasMath } = nodeToRuns(node);
  if (!runs.length) return null;
  const banaStyle = (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null) || node.__banaStyle || null;
  const block = (hasMath || hasEmph) ? { type: 'para', segments: runs }
    : { type: 'para', text: node.getTextContent().replace(/\s+/g, ' ').trim() };
  if (banaStyle && banaStyle !== 'body') {
    block.style = banaStyle;
    if (banaStyle === 'note') block.type = 'note';
    else if (banaStyle === 'caption') block.type = 'caption';
    else if (banaStyle === 'footnote') block.type = 'footnote';
    else if (banaStyle === 'attribution') block.type = 'attribution';
    else if (banaStyle === 'stage') block.type = 'stage';
    else if (banaStyle === 'dialogue') block.type = 'play';
    else if (banaStyle === 'verse' || banaStyle === 'poem') { block.type = 'play'; block.subtype = 'verse'; }
  }
  return block;
}
function extractListBlock(node) {
  const listType = typeof node.getListType === 'function' ? node.getListType() : null;
  const listKind = (typeof node.getListKind === 'function' ? node.getListKind() : null) ||
                   (typeof node.getBanaStyle === 'function' ? node.getBanaStyle() : null);
  const isPlain = listType === 'plain' || listKind === 'toc' || listKind === 'index' || listKind === 'plain';
  const isExercise = listKind === 'exercise' || (typeof node.getBanaStyle === 'function' && node.getBanaStyle() === 'exercise');
  const isOrdered = listType === 'number' || (isExercise && !isPlain);

  const items = [];
  let n = 0;
  for (const li of node.getChildren()) {
    const { runs, hasEmph, hasMath } = nodeToRuns(li);        // keep list-item emphasis + inline maths
    const textContent = li.getTextContent().replace(/\s+/g, ' ').trim();
    if (!runs.length && !textContent) continue;
    n++;
    const item = (hasEmph || hasMath) ? { segments: runs, text: textContent } : { text: textContent };

    if (isOrdered && !isPlain) {
      const val = typeof li.getValue === 'function' ? li.getValue() : null;
      item.marker = `${val && val > 0 ? val : n}.`;
    }

    const page = (typeof li.getPage === 'function' ? li.getPage() : null) || li.__page;
    if (page) {
      item.page = page;
    } else if (isPlain || listKind === 'toc') {
      const m = textContent.match(/\s+(\d+|[ivxlcdm]+)$/i);
      if (m) {
        item.page = m[1];
        item.text = textContent.slice(0, m.index).trim();
      }
    }

    const lvl = typeof li.getLevel === 'function' ? li.getLevel() : (li.__level || 0);
    if (lvl > 0) item.level = lvl;

    const itemStyle = typeof li.getBanaStyle === 'function' ? li.getBanaStyle() : li.__banaStyle;
    if (itemStyle) item.style = itemStyle;

    items.push(item);
  }

  if (items.length) {
    const block = { type: 'list', items };
    if (listKind) {
      block.kind = listKind;
      block.style = listKind;
    } else if (isPlain) {
      block.kind = 'toc';
      block.style = 'toc';
    }
    return block;
  }
  return null;
}

function buildModel() {
  const blocks = [];
  const keys = [];                                     // parallel: the Lexical node key that produced blocks[i]
  for (const node of $getRoot().getChildren()) {
    const before = blocks.length;
    const nodeKey = node.getKey();
    if ($isBreakNode(node)) {
      blocks.push({ type: 'indicator', kind: 'asterisks', _key: nodeKey });
    } else if ($isPrintPageNode(node)) {
      blocks.push({ type: 'pagenum', page: node.getPage(), _key: nodeKey });
    } else if ($isTableNode(node)) {
      const tblBlock = {
        type: 'table',
        headers: node.getHeaders(),
        rows: node.getRows(),
        _key: nodeKey
      };
      const fmt = node.getFormat();
      if (fmt && fmt !== 'auto') {
        tblBlock.format = fmt;
        tblBlock.style = `table-${fmt}`;
      }
      const cap = node.getCaption();
      if (cap) tblBlock.caption = cap;
      const tn = node.getTabletn();
      if (tn) tblBlock.tabletn = tn;
      blocks.push(tblBlock);
    } else if ($isGraphicNode(node)) {
      const sz = node.getSize();
      const hLines = sz === 'compact' ? 8 : (sz === 'full' ? Math.min(24, (settings.lines || 25) - 1) : 15);
      blocks.push({
        type: 'graphic',
        svg: node.getSvg(),
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
      const text = node.getTextContent().replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ type: 'heading', level: Math.min(3, Number(node.getTag().slice(1)) || 1), text, _key: nodeKey });
    } else if ($isListNode(node)) {
      const block = extractListBlock(node);
      if (block) {
        block._key = nodeKey;
        blocks.push(block);
      }
    } else if ($isSidebarNode(node)) {
      const innerBlocks = [];
      let boxTitle = node.getTitle() || null;
      for (const child of node.getChildren()) {
        if ($isHeadingNode(child)) {
          const text = child.getTextContent().replace(/\s+/g, ' ').trim();
          const { runs, hasEmph, hasMath } = nodeToRuns(child);
          if (!boxTitle && innerBlocks.length === 0) {
            boxTitle = text;
          }
          const hBlock = (hasEmph || hasMath) && runs.length
            ? { type: 'heading', level: Math.min(3, Number(child.getTag().slice(1)) || 2), text, segments: runs }
            : { type: 'heading', level: Math.min(3, Number(child.getTag().slice(1)) || 2), text };
          innerBlocks.push(hBlock);
        } else if ($isListNode(child)) {
          const listBlock = extractListBlock(child);
          if (listBlock) innerBlocks.push(listBlock);
        } else if ($isTableNode(child)) {
          const tblBlock = {
            type: 'table',
            headers: child.getHeaders(),
            rows: child.getRows()
          };
          const fmt = child.getFormat();
          if (fmt && fmt !== 'auto') {
            tblBlock.format = fmt;
            tblBlock.style = `table-${fmt}`;
          }
          const cap = child.getCaption();
          if (cap) tblBlock.caption = cap;
          const tn = child.getTabletn();
          if (tn) tblBlock.tabletn = tn;
          innerBlocks.push(tblBlock);
        } else if ($isGraphicNode(child)) {
          innerBlocks.push({ type: 'graphic', svg: child.getSvg(), alt: child.getAlt(), title: child.getTitle(), textures: child.getTextures(), brailleLabels: child.getBrailleLabels(), size: child.getSize() });
        } else {
          const p = paraBlock(child);
          if (p) innerBlocks.push(p);
        }
      }
      const boxBlock = {
        type: 'box',
        _key: nodeKey
      };
      if (boxTitle) boxBlock.title = boxTitle;
      if (innerBlocks.length) boxBlock.blocks = innerBlocks;
      blocks.push(boxBlock);
    } else {
      const b = paraBlock(node);
      if (b) {
        b._key = nodeKey;
        blocks.push(b);
      }
    }
    if (blocks.length > before) keys.push(nodeKey);
  }
  const firstHeading = blocks.find((b) => b.type === 'heading');   // → running head on page 2+
  return { title: firstHeading ? firstHeading.text : null, blocks, keys };
}

// ---- toolbar state & style inspector ----
function updateStyleInspector(block) {
  const badge = $id('styleInspector');
  if (!badge) return;
  const profile = settings?.mode || 'bana';
  const label = typeof formatStyleInspectorBadge === 'function'
    ? formatStyleInspectorBadge(block, profile)
    : `Style: ${block} | Profile: ${profile.toUpperCase()}`;
  badge.textContent = label;
  badge.title = `Active BANA Style: ${label}. Press Alt+Up/Down to cycle styles, or click to change.`;
  badge.setAttribute('aria-label', `Active BANA Style: ${label}`);
}

function refreshToolbar(targetBlockIdx = null) {
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    let block = 'p', b = false, i = false, u = false;
    let top = null;
    if ($isRangeSelection(sel)) {
      top = sel.anchor.getNode().getTopLevelElement();
      b = sel.hasFormat('bold'); i = sel.hasFormat('italic'); u = sel.hasFormat('underline');
    } else {
      const root = $getRoot();
      const children = root.getChildren();
      const idx = (typeof targetBlockIdx === 'number' && targetBlockIdx >= 0) ? targetBlockIdx : 0;
      top = children[idx] || children[0] || null;
    }
    if (top && $isHeadingNode(top)) {
      block = top.getTag();
    } else if (top && $isListNode(top)) {
      const lt = top.getListType();
      const kind = typeof top.getListKind === 'function' ? top.getListKind() : null;
      block = (lt === 'plain' || kind === 'toc') ? 'toc' : (kind === 'exercise' ? 'exercise' : (lt === 'number' ? 'number' : 'bullet'));
    } else if (top && $isSidebarNode(top)) {
      block = 'sidebar';
    } else if (top && typeof top.getBanaStyle === 'function') {
      const bs = top.getBanaStyle();
      if (bs) block = (bs === 'verse') ? 'poem' : bs;
    }
    const selectEl = $id('blockStyle');
    if (selectEl) {
      const validOptions = Array.from(selectEl.options).map((o) => o.value);
      selectEl.value = validOptions.includes(block) ? block : 'p';
    }
    updateStyleInspector(block);
    $id('btnBold')?.setAttribute('aria-pressed', String(b));
    $id('btnItalic')?.setAttribute('aria-pressed', String(i));
    $id('btnUnderline')?.setAttribute('aria-pressed', String(u));
  });
}


// ---- live braille render (honours the shared settings) ----
let lastBrf = '';
let lastModel = null;      // for the volume-aware download
let lastFormatOpts = null;
let lastTrace = null;
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
    setStatus(`Could not load the tables for "${settings.brailleCode}" — still using the previous braille code.`);
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
async function render() {
  try {
    const model = editor.getEditorState().read(buildModel);
    const table = activeTable;
    const o = currentFormatOpts();
    const trace = {};
    const brf = formatDocument(model, { ...o, trace });
    lastModel = model; lastFormatOpts = o;
    lastTrace = trace;
    lastBrf = brf;
    lastKeys = model.keys;
    const getPrintTextForBlock = (b) => {
      if (!b) return '';
      if (b.type === 'pagenum') return `Page ${b.page || ''}`;
      if (b.type === 'indicator') return '∗ ∗ ∗';
      if (typeof b.text === 'string' && b.text) return b.text;
      if (Array.isArray(b.segments)) return b.segments.map((s) => (s.text != null ? s.text : (s.latex != null ? s.latex : ''))).join('');
      if (typeof b.latex === 'string') return b.latex;
      return '';
    };
    const allBrfLines = [];
    (brf.split('\f')).forEach((page) => {
      const lines = page.split(/\r\n|\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      allBrfLines.push(...lines);
    });
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
    const scrollTarget = brlStackEl || brailleEl;
    const prevBrailleScroll = scrollTarget ? scrollTarget.scrollTop : 0;
    renderBraille(brailleEl, brf, {
      rows: trace.rows, rowCells: trace.rowCells, cells: (settings.cells | 0) || (EMBOSSER_PRESETS[settings.embosser]?.cells || 38),
      cellW: isManualZoom ? brailleCellW : undefined,   // Ctrl/⌘+Shift+= / − zoom; auto-fit otherwise
      textMode: false, asciiBraille: settings.asciiBraille,
      volumePages: Number(settings.volumePages) || 0,
      rowPrintText, blocks: model.blocks,
      embosser: settings.embosser,
      tactileGraphics: settings.tactileGraphics,
    });
    if (brlInputEl && allBrfLines) {
      const brailleText = settings.asciiBraille
        ? allBrfLines.join('\n')
        : allBrfLines.map(l => brfToUnicodeBraille(l)).join('\n');
      lastRenderedBrailleText = brailleText;
      if (!isReconcilingBrailleToPrint && brlInputEl.value !== brailleText) {
        const hadFocus = document.activeElement === brlInputEl;
        const selStart = brlInputEl.selectionStart;
        const selEnd = brlInputEl.selectionEnd;
        brlInputEl.value = brailleText;
        if (hadFocus) {
          brlInputEl.setSelectionRange(selStart, selEnd);
        }
      }
    }
    if (scrollTarget && (!reader || !reader.speaking)) {
      scrollTarget.scrollTop = prevBrailleScroll;
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
    setStatus(`${settings.mode.toUpperCase()} · G${settings.grade === 'g1' ? 1 : 2} · ${settings.cells}×${settings.lines} · ${model.blocks.length} block(s) · ${pages} page(s)${settings.toc ? ' · TOC' : ''}`);
    const graphicMap = new Map();
    if (model.blocks && trace.rows) {
      for (let bi = 0; bi < model.blocks.length; bi++) {
        const b = model.blocks[bi];
        if (b && (b.type === 'graphic' || b.type === 'tactile') && b.svg) {
          const lineIdx = trace.rows.findIndex(rBi => rBi === bi);
          const startLine = lineIdx >= 0 ? lineIdx : 0;
          const matrix = await rasterizeSvgToDotPadCells(b.svg);
          const m = String(b.svg).match(/data-braille-line=["']([^"']+)["']/);
          const title = (m && m[1]) || (b.title || b.alt || 'Graphic');
          const uebTitle = (m && m[1]) ? m[1] : (defaultBrailleTranslator ? defaultBrailleTranslator(title).slice(0, 20).padEnd(20, '⠀') : title.slice(0, 20));
          graphicMap.set(startLine, { matrix, title: uebTitle });
        }
      }
    }
    await tactileDisplay.updateBraille(allBrfLines, null, graphicMap);
  } catch (e) {
    console.error(e);
    const msg = String((e && e.message) || e);       // tolerate a non-Error throw (no .message)
    brailleEl.textContent = '⚠ Braille could not be generated.\n\n' + msg +
      '\n\n(If this says the engine is not initialised, the braille engine did not load — hard-refresh with Cmd/Ctrl+Shift+R.)';
    setStatus('Render error: ' + msg);
  }
}
const scheduleRender = () => { clearTimeout(timer); timer = setTimeout(render, 200); };
editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
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

  const isFromBraille = (tags && tags.has('braille-sync')) || isReconcilingBrailleToPrint;
  if (isFromBraille) {
    editorState.read(() => {
      lastModel = buildModel();
    });
    tagPrintBlocks(lastModel?.keys);
    buildCellText(lastModel);
    return;
  }

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
  const children = Array.from(editorEl.children);
  (keys || []).forEach((key, i) => {
    let el = editor.getElementByKey(key);
    if (!el && children[i]) el = children[i];
    if (el) el.dataset.blockIdx = String(i);
  });
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
  const bestOffset = best.offsetTop - targetY;
  const idx = Number(best.getAttribute('data-block-idx') ?? best.dataset?.blockIdx ?? foundIdx);
  return Number.isNaN(idx) ? { idx: foundIdx, offset: 0 } : { idx, offset: bestOffset };
}

function brailleTopBlock() {
  if (isModalOpen()) return null;
  const container = brlStackEl || brailleEl;
  if (brailleEl._virtualBraille?.isVirtualized()) {
    const idx = brailleEl._virtualBraille.getVisibleBlock();
    if (idx == null) return null;
    const off = (brailleEl._virtualBraille.getBlockOffset(idx) ?? container.scrollTop) - container.scrollTop;
    return { idx, offset: off };
  }
  const cTop = container.getBoundingClientRect().top;
  let best = null, bestScore = Infinity;
  brailleEl.querySelectorAll('.brl-row[data-block]').forEach((el) => {
    const d = el.getBoundingClientRect().top - cTop;
    const score = d >= -1 ? d : 1e6 - d;
    if (score < bestScore) { bestScore = score; best = el; }
  });
  if (!best) return null;
  const idx = Number(best.getAttribute('data-block'));
  return Number.isNaN(idx) ? null : { idx, offset: best.getBoundingClientRect().top - cTop };
}

function syncBrailleToEditor() {
  if (isModalOpen()) return;
  const anchor = editorTopBlock();
  if (!anchor) return;
  const container = brlStackEl || brailleEl;
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.scrollToBlock(anchor.idx, anchor.offset);
  } else {
    const el = brailleEl.querySelector(`.brl-row[data-block="${anchor.idx}"]`);
    if (!el) return;
    const delta = (el.getBoundingClientRect().top - container.getBoundingClientRect().top) - anchor.offset;
    if (Math.abs(delta) >= 1) container.scrollTop += delta;
  }
  if (currentBrailleTab === 'dotpad' && typeof tactileDisplay !== 'undefined') {
    let lineIdx = -1;
    if (lastTrace?.rows) lineIdx = lastTrace.rows.indexOf(anchor.idx);
    if (lineIdx < 0 && brailleEl._virtualBraille?.isVirtualized()) {
      const it = brailleEl._virtualBraille.getItems().find(item => item.block === anchor.idx);
      if (it && typeof it.rowIndex === 'number') lineIdx = it.rowIndex;
    }
    if (lineIdx >= 0) {
      tactileDisplay.scrollToLine(lineIdx);
      if (typeof drawDotPadEmulator === 'function') {
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
  const targetTop = el.offsetTop - edTop - anchor.offset;
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
const brailleScrollEl = brlStackEl || brailleEl;
if (brailleScrollEl) {
  brailleScrollEl.addEventListener('wheel', recordUserInteraction, { passive: true });
  brailleScrollEl.addEventListener('pointerdown', recordUserInteraction, { passive: true });
  brailleScrollEl.addEventListener('touchstart', recordUserInteraction, { passive: true });
}

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
if (brailleScrollEl) {
  brailleScrollEl.addEventListener('scroll', () => onPaneScroll('braille', syncEditorToBraille), { passive: true });
}

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
  clearWordLink();                                 // stale Range/highlights point at the pre-render DOM
  (model.blocks || []).forEach((b, i) => {
    if (!b) return;
    if (b.type === 'heading' || b.type === 'para' || b.type === 'note' || b.type === 'footnote' || b.type === 'caption' || b.type === 'attribution' || b.type === 'stage' || b.type === 'play') cellText[`${i}:0`] = b.segments ? flatSegText(b.segments) : (b.text || '');
    else if (b.type === 'list') (b.items || []).forEach((it, u) => { cellText[`${i}:${u}`] = it.segments ? flatSegText(it.segments) : (it.text || ''); });
  });
  updatePrintToc();
}
// The print element for a (block, unit): the block, or its unit-th <li> for a list.
function printUnitEl(block, unit) {
  const be = editorEl.querySelector(`[data-block-idx="${block}"]`);
  if (!be) return null;
  const lis = be.querySelectorAll('li');
  return lis.length ? (lis[unit] || be) : be;
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
  let acc = 0, range = null;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
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
      if (node.classList?.contains('math-embed') || node.tagName === 'MATH-FIELD') {
        const mf = node.querySelector?.('math-field') || (node.tagName === 'MATH-FIELD' ? node : null);
        const latex = mf?.value || '';
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
  walk(el);
  return range;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function showIdleStatus() {
  const body = $id('ruleInfoBody');
  if (body) {
    body.innerHTML = `<span class="sb-hint">Click a word in either panel to see the braille rules used.</span>`;
  } else {
    const sb = $id('statusBar') || $id('ruleInfo');
    if (sb) {
      sb.innerHTML = `<span class="sb-hint">Click a word in either panel to see the braille rules used.</span>` +
        (currentStatusText ? `<span class="doc-stats" id="docStats">${escapeHtml(currentStatusText)}</span>` : `<span class="doc-stats" id="docStats"></span>`);
    }
  }
  const ds = $id('docStats');
  if (ds) ds.textContent = currentStatusText || '';
}

let activeCaretLine = -1;
let activeCaretCol = -1;
let activeWordHighlight = null;

function clearWordLink() {
  activeWordHighlight = null;
  if (brailleEl._virtualBraille?.isVirtualized()) {
    brailleEl._virtualBraille.clearWordHighlight();
  }
  brailleEl.querySelectorAll('.bcell.cell-hl').forEach((c) => c.classList.remove('cell-hl'));
  brailleEl.querySelectorAll('rect.cell-box').forEach((r) => r.remove());
  editorEl.querySelectorAll('.math-hl').forEach((m) => m.classList.remove('math-hl'));
  if (HL_API) CSS.highlights.delete('link-word');
  showIdleStatus();
  activeCaretLine = -1;
  activeCaretCol = -1;
  if (currentBrailleTab === 'dotpad' && typeof drawDotPadEmulator === 'function') {
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
    brailleEl._virtualBraille.setWordHighlight({ block, unit, s, e, cw, ch });
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

  if (currentBrailleTab === 'dotpad' && typeof drawDotPadEmulator === 'function') {
    drawDotPadEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getDotPadActiveFrame() : null);
  }

  if (brlInputEl && wordRowIdx >= 0 && source !== 'braille') {
    const lines = brlInputEl.value.split('\n');
    let targetPos = 0;
    for (let r = 0; r < wordRowIdx && r < lines.length; r++) {
      targetPos += lines[r].length + 1;
    }
    if (activeCaretCol >= 0) {
      targetPos += Math.min(activeCaretCol, lines[wordRowIdx]?.length || 0);
    }
    if (document.activeElement !== brlInputEl) {
      brlInputEl.setSelectionRange(targetPos, targetPos);
    }
  }

  const pe = printUnitEl(block, unit) || editorEl.querySelector(`[data-block-idx="${block}"]`);
  if (pe) {
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
  const tG1 = louis.TABLES.uebG1;
  for (const tbl of [table, tG1]) {
    if (!tbl) continue;
    try {
      const r = louis.translatePos(text, tbl);
      if (r && r.braille === brl) { res = r; break; }
    } catch { /* ignore */ }
  }
  if (!res) return null;
  const pos = res.inputPos;
  const n = brl.length;
  if (!pos || pos.length < n) return null;
  const segs = [];
  let j = 0;
  while (j < n) {
    const start = pos[j];
    let k = j;
    while (k + 1 < n && pos[k + 1] === start) k++;
    const nextStart = (k + 1 < n) ? pos[k + 1] : text.length;
    if (!(nextStart >= start)) return null;
    segs.push({ cells: brl.slice(j, k + 1), chars: text.slice(start, nextStart) });
    j = k + 1;
  }
  return segs;
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
  '⠐⠹': 'through', '⠐⠱': 'where', '⠐⠪': 'ought'
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
    const ds = $id('docStats');
    if (ds) ds.textContent = currentStatusText || '';
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
  const ds = $id('docStats');
  if (ds) ds.textContent = currentStatusText || '';
}

// Resizing the explanation bar via drag grab or arrow keys (matching Translate)
const SB_MIN_SCALE = 0.85, SB_MAX_SCALE = 2.2, SB_STEP = 0.15;
let statusScale = 1;
function applyStatusScale(next) {
  statusScale = Math.max(SB_MIN_SCALE, Math.min(SB_MAX_SCALE, Number(next) || 1));
  document.documentElement.style.setProperty('--sb-scale', statusScale.toFixed(3));
  const targetH = Math.min(220, Math.round(44 * statusScale));
  document.documentElement.style.setProperty('--sb-h', targetH + 'px');
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
            if (c.classList?.contains('math-embed') || c.tagName === 'MATH-FIELD') {
              const mf = c.querySelector?.('math-field') || (c.tagName === 'MATH-FIELD' ? c : null);
              const latex = mf?.value || '';
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
      if (node.classList?.contains('math-embed') || node.tagName === 'MATH-FIELD') {
        const mf = node.querySelector?.('math-field') || (node.tagName === 'MATH-FIELD' ? node : null);
        const latex = mf?.value || '';
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
    const block = Number(cellRow.dataset.block), unit = Number(cell.dataset.unit);
    const text = cellText[`${block}:${unit}`];
    if (text != null) {
      const [s, en] = wordRangeAt(text, +cell.dataset.char);
      highlightWord(block, unit, s, en, null, 'braille');
      showRuleInfo(text.slice(s, en));
      return;
    }
  }
  const row = e.target.closest('.brl-row');      // fallback: block-level (decoration/maths cells)
  if (row) {
    clearWordLink();
    let bIdx = row.dataset.block != null && Number(row.dataset.block) >= 0 ? Number(row.dataset.block) : 0;
    linkByBlock(bIdx, true);
    const text = cellText[`${bIdx}:0`];
    if (text) showRuleInfo(text.split(/\s+/)[0] || text);
    const pe = editorEl.querySelector(`[data-block-idx="${bIdx}"]`);
    if (pe && !isElementVisibleIn(pe, editorEl)) {
      pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }
});

function onBrlInputCaretMove() {
  if (!brlInputEl) return;
  if (typeof updateBrlPositionUI === 'function') updateBrlPositionUI();
  const pos = brlInputEl.selectionStart;
  const val = brlInputEl.value;
  const linesBefore = val.slice(0, pos).split('\n');
  const rowIndex = linesBefore.length - 1;
  const colIndex = linesBefore[linesBefore.length - 1].length;

  const rows = brailleEl ? Array.from(brailleEl.querySelectorAll('.brl-row')) : [];
  const cellRow = rows[rowIndex];
  if (cellRow) expandRowCells(cellRow);

  if (lastTrace?.rows) {
    const block = lastTrace.rows[rowIndex];
    if (block != null && block >= 0) {
      const rowCells = lastTrace.rowCells?.[rowIndex];
      const cell = rowCells ? (rowCells[colIndex] || (colIndex > 0 ? rowCells[colIndex - 1] : null)) : null;
      if (cell) {
        const unit = Number(cell.u);
        const text = cellText[`${block}:${unit}`];
        if (text != null) {
          const [s, en] = wordRangeAt(text, +cell.c);
          highlightWord(block, unit, s, en, +cell.c, 'braille');
          showRuleInfo(text.slice(s, en));
          return;
        }
      }
      clearWordLink();
      linkByBlock(block, true);
      const text = cellText[`${block}:0`];
      if (text) showRuleInfo(text.split(/\s+/)[0] || text);
      const pe = editorEl.querySelector(`[data-block-idx="${block}"]`);
      if (pe && !isElementVisibleIn(pe, editorEl)) {
        pe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

// ---- BANA Margin Presets & Direct Braille Controller ----
export let brlActiveMarginStyle = 'body';
export let brlOverwriteMode = false;

export function getBrlActiveStyle() {
  if (brlActiveMarginStyle && STYLE_DEFINITIONS[brlActiveMarginStyle]) {
    return brlActiveMarginStyle;
  }
  return 'body';
}

export function getMarginIndent(styleId = 'body', isFirstLine = true) {
  const profile = settings?.mode === 'bana' ? 'bana' : 'ukaaf';
  const margins = getStyleMargins(styleId, profile);
  const spaces = isFirstLine ? margins.first : margins.runover;
  return ' '.repeat(Math.max(0, spaces));
}
export const getBanaMarginIndent = getMarginIndent;

export function centerBrailleText(text, lineWidth) {
  const width = lineWidth != null ? Number(lineWidth) : ((settings?.cells | 0) || (EMBOSSER_PRESETS[settings?.embosser]?.cells || 38));
  const trimmed = text.trim();
  if (!trimmed) return '';
  const len = [...trimmed].length;
  if (len >= width - 6) return '   ' + trimmed;
  const padLeft = Math.floor((width - len) / 2);
  return ' '.repeat(padLeft) + trimmed;
}

export function applyBrlWordWrap(inputEl, maxCells = (Number(settings?.cells) || (EMBOSSER_PRESETS[settings?.embosser]?.cells || 38))) {
  if (!inputEl) return false;
  let wrappedAny = false;
  let guard = 0;
  while (guard++ < 200) {
    const pos = inputEl.selectionStart;
    const val = inputEl.value;
    const lineStart = val.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    let lineEnd = val.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = val.length;
    const currentLine = val.slice(lineStart, lineEnd);

    if (currentLine.length <= maxCells) break;

    const activeStyle = getBrlActiveStyle();
    const runoverIndent = getMarginIndent(activeStyle, false);
    const firstNonSpace = currentLine.search(/\S/);
    const lastSpace = currentLine.lastIndexOf(' ', maxCells);

    if (firstNonSpace !== -1 && lastSpace > firstNonSpace) {
      const breakIdx = lineStart + lastSpace;
      const before = val.slice(0, breakIdx);
      const after = val.slice(breakIdx + 1);
      inputEl.value = before + '\n' + runoverIndent + after;
      const newPos = pos > breakIdx ? pos + runoverIndent.length : pos;
      inputEl.setSelectionRange(newPos, newPos);
      wrappedAny = true;
    } else {
      const breakIdx = lineStart + maxCells;
      const before = val.slice(0, breakIdx);
      const after = val.slice(breakIdx);
      inputEl.value = before + '\n' + runoverIndent + after;
      const newPos = pos >= breakIdx ? pos + 1 + runoverIndent.length : pos;
      inputEl.setSelectionRange(newPos, newPos);
      wrappedAny = true;
    }
  }
  return wrappedAny;
}

export function toggleBrlSixKey(forcedState) {
  const isCurrentlyOn = settings?.sixKeyInput !== false;
  const nextState = forcedState != null ? !!forcedState : !isCurrentlyOn;
  settings = saveSettings({ sixKeyInput: nextState });
  const btn = $id('btnBrlSixKey');
  if (btn) {
    btn.setAttribute('aria-pressed', String(nextState));
    if (nextState) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  announce(nextState ? 'Braille editor Perkins 6-key input enabled.' : 'Braille editor Perkins 6-key input disabled.');
}

export function updateBrlAsciiUI() {
  const isAscii = !!settings?.asciiBraille;
  const btn = $id('btnBrlAscii');
  if (btn) {
    btn.textContent = 'BRF';
    btn.setAttribute('aria-pressed', String(isAscii));
    if (isAscii) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  if ($id('set-asciiBraille')) {
    $id('set-asciiBraille').checked = isAscii;
  }
  if (brlInputEl) {
    if (isAscii) {
      brlInputEl.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    } else {
      brlInputEl.style.fontFamily = '"APHfont", "Apple Braille", "Segoe UI Symbol", monospace';
    }
  }
}

export function toggleBrlAscii(forcedState) {
  const nextState = forcedState != null ? !!forcedState : !settings?.asciiBraille;
  settings = saveSettings({ asciiBraille: nextState });
  updateBrlAsciiUI();
  if (brlInputEl) {
    if (nextState) {
      brlInputEl.value = unicodeBrailleToBrf(brlInputEl.value);
    } else {
      brlInputEl.value = brfToUnicodeBraille(brlInputEl.value);
    }
  }
  render();
  announce(nextState ? 'Switched to BRF ASCII braille display.' : 'Switched to Unicode braille display.');
}

export function updateBrlInsertModeUI() {
  const btn = $id('btnBrlInsertMode');
  if (btn) {
    btn.textContent = brlOverwriteMode ? 'OVR' : 'INS';
    btn.setAttribute('aria-pressed', String(brlOverwriteMode));
    if (brlOverwriteMode) btn.classList.add('active');
    else btn.classList.remove('active');
  }
}

export function toggleBrlInsertMode(forcedState) {
  brlOverwriteMode = forcedState != null ? !!forcedState : !brlOverwriteMode;
  updateBrlInsertModeUI();
  announce(brlOverwriteMode ? 'Braille editor: Overwrite mode.' : 'Braille editor: Insert mode.');
}

export function updateBrlMarginDropdownUI() {
  const sel = $id('selBrlMargin');
  if (!sel) return;
  const isUkaaf = settings?.mode !== 'bana';
  const currentVal = sel.value || brlActiveMarginStyle || 'body';
  
  sel.innerHTML = `
    <option value="body">3-1 Paragraph</option>
    <option value="h1">Centered Heading</option>
    <option value="h2">5-5 Subheading</option>
    <option value="h3">${isUkaaf ? '5-5 Heading 3' : '7-7 Heading 3'}</option>
    <option value="list-bullet">1-3 List</option>
    <option value="exercise">1-5 Exercise</option>
  `;
  sel.value = currentVal;
  const profileName = isUkaaf ? 'UKAAF' : 'BANA';
  sel.title = `${profileName} Margin Preset`;
  sel.setAttribute('aria-label', `${profileName} Margin Preset`);
}

export function centerCurrentBrailleLine() {
  if (!brlInputEl) return;
  const pos = brlInputEl.selectionStart;
  const val = brlInputEl.value;
  const lineStart = val.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  let lineEnd = val.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = val.length;
  const currentLine = val.slice(lineStart, lineEnd);
  const width = (settings?.cells | 0) || (EMBOSSER_PRESETS[settings?.embosser]?.cells || 38);
  const centered = centerBrailleText(currentLine, width);
  brlInputEl.value = val.slice(0, lineStart) + centered + val.slice(lineEnd);
  const newPos = lineStart + centered.length;
  brlInputEl.setSelectionRange(newPos, newPos);
  brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  onBrlInputCaretMove();
  announce('Line centered.');
}

// ---- Direct Braille Editor Diagnostics & Status Badges (Stage 3C) ----
export function updateBrlPositionUI() {
  const badge = $id('brlPosBadge');
  if (!badge || !brlInputEl) return;
  const pos = brlInputEl.selectionStart ?? 0;
  const val = brlInputEl.value || '';
  const linesBefore = val.slice(0, pos).split('\n');
  const lineNum = linesBefore.length;
  const currentLineText = linesBefore[linesBefore.length - 1] || '';
  const cellNum = currentLineText.length + 1;
  const maxCells = (settings?.cells | 0) || (EMBOSSER_PRESETS[settings?.embosser]?.cells || 38);

  const label = `L${lineNum}, C${cellNum}/${maxCells}`;
  badge.textContent = label;

  if (currentLineText.length > maxCells) {
    badge.classList.add('brl-pos-overflow');
    badge.title = `Line ${lineNum} exceeds maximum width (${currentLineText.length}/${maxCells} cells)`;
  } else {
    badge.classList.remove('brl-pos-overflow');
    badge.title = `Cursor Line ${lineNum}, Cell ${cellNum} of ${maxCells}`;
  }
}

export let brlCurrentSyncStatus = 'synced'; // 'synced' | 'editing' | 'syncing'

export function updateBrlSyncStatus(status = 'synced') {
  brlCurrentSyncStatus = status;
  const badge = $id('brlSyncStatus');
  if (!badge) return;

  badge.className = `brl-sync-status ${status}`;
  const labelEl = badge.querySelector('.sync-label');

  if (status === 'editing') {
    if (labelEl) labelEl.textContent = 'Editing...';
    badge.title = 'Braille changes pending reverse synchronization';
  } else if (status === 'syncing') {
    if (labelEl) labelEl.textContent = 'Syncing...';
    badge.title = 'Synchronizing Braille into Print document...';
  } else {
    if (labelEl) labelEl.textContent = 'Synced';
    badge.title = 'Print and Braille are in full synchronization';
  }
}

export function validateBrailleDocument(rawBraille, customSettings = settings) {
  if (typeof rawBraille !== 'string') rawBraille = brlInputEl ? brlInputEl.value : '';
  const currentSettings = customSettings || settings;
  const maxCells = (currentSettings?.cells | 0) || (EMBOSSER_PRESETS[currentSettings?.embosser]?.cells || 38);
  const isAscii = !!currentSettings?.asciiBraille;
  const lines = rawBraille.split('\n');
  const issues = [];

  let inNemeth = false;
  let nemethOpenLine = null;
  let inBox = false;
  let boxOpenLine = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');

    // 1. Line overflow check
    if (line.length > maxCells) {
      issues.push({
        type: 'line-overflow',
        line: lineNum,
        col: line.length,
        message: `Line ${lineNum} exceeds ${maxCells} cells (${line.length} cells)`,
      });
    }

    // 2. Boxline tracking
    const isTopBox = isAscii
      ? /^3{3,}/.test(trimmed)
      : /^[⠒]{3,}/.test(trimmed);
    const isBottomBox = isAscii
      ? /^[37]{3,}$/.test(trimmed)
      : /^[⠒⠶]{3,}$/.test(trimmed);

    if (isTopBox && !inBox) {
      inBox = true;
      boxOpenLine = lineNum;
    } else if (inBox && (isBottomBox || (isTopBox && lineNum > boxOpenLine))) {
      inBox = false;
      boxOpenLine = null;
    }

    // 3. Nemeth switch tracking
    const nemOpen = isAscii ? '_%' : '⠸⠩';
    const nemClose = isAscii ? '_:' : '⠸⠱';

    let searchIdx = 0;
    while (searchIdx < line.length) {
      if (!inNemeth) {
        const nextOpen = line.indexOf(nemOpen, searchIdx);
        const nextClose = line.indexOf(nemClose, searchIdx);
        if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
          issues.push({
            type: 'unmatched-nemeth-close',
            line: lineNum,
            col: nextClose + 1,
            message: `Closing Nemeth switch without matching opening indicator on line ${lineNum}`,
          });
          searchIdx = nextClose + nemClose.length;
          continue;
        }
        if (nextOpen !== -1) {
          inNemeth = true;
          nemethOpenLine = lineNum;
          searchIdx = nextOpen + nemOpen.length;
        } else {
          break;
        }
      } else {
        const nextClose = line.indexOf(nemClose, searchIdx);
        if (nextClose !== -1) {
          inNemeth = false;
          nemethOpenLine = null;
          searchIdx = nextClose + nemClose.length;
        } else {
          break;
        }
      }
    }
  }

  if (inNemeth && nemethOpenLine !== null) {
    issues.push({
      type: 'unclosed-nemeth',
      line: nemethOpenLine,
      message: `Unclosed Nemeth switch opened on line ${nemethOpenLine}`,
    });
  }

  if (inBox && boxOpenLine !== null) {
    issues.push({
      type: 'unclosed-box',
      line: boxOpenLine,
      message: `Unclosed sidebar boxline opened on line ${boxOpenLine}`,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    issueCount: issues.length,
  };
}

export function runBrailleValidation() {
  const badge = $id('brlValidationBadge');
  if (!badge) return null;

  const text = brlInputEl ? brlInputEl.value : '';
  const result = validateBrailleDocument(text, settings);

  if (result.valid) {
    badge.className = 'tb-btn brl-val-badge valid';
    badge.textContent = '✓ Valid';
    badge.title = 'Braille document structure is valid';
  } else {
    const isError = result.issues.some(i => i.type.startsWith('unclosed') || i.type.startsWith('unmatched'));
    badge.className = `tb-btn brl-val-badge ${isError ? 'error' : 'warn'}`;
    badge.textContent = `⚠ ${result.issueCount} issue${result.issueCount > 1 ? 's' : ''}`;
    badge.title = `${result.issues.map(i => `• ${i.message}`).join('\n')}\nClick to jump to first issue.`;
  }
  return result;
}

export function jumpToBrailleIssue() {
  if (!brlInputEl) return;
  const result = validateBrailleDocument(brlInputEl.value, settings);
  if (!result.valid && result.issues.length > 0) {
    const first = result.issues[0];
    const targetLine = Math.max(1, first.line);
    const lines = brlInputEl.value.split('\n');
    let charPos = 0;
    for (let i = 0; i < targetLine - 1 && i < lines.length; i++) {
      charPos += lines[i].length + 1;
    }
    if (first.col) {
      charPos += Math.min(lines[targetLine - 1]?.length || 0, first.col - 1);
    }
    brlInputEl.focus();
    brlInputEl.setSelectionRange(charPos, charPos);
    onBrlInputCaretMove();
    announce(`Navigated to ${first.message}`);
  }
}

if (typeof window !== 'undefined') {
  window.setBrlMarginStyle = (styleId) => {
    if (STYLE_DEFINITIONS[styleId]) {
      brlActiveMarginStyle = styleId;
      if ($id('selBrlMargin')) $id('selBrlMargin').value = styleId;
    }
  };
  window.getBrlMarginStyle = () => brlActiveMarginStyle;
  window.getMarginIndent = getMarginIndent;
  window.getBanaMarginIndent = getMarginIndent;
  window.centerBrailleText = centerBrailleText;
  window.applyBrlWordWrap = (el, maxCells) => applyBrlWordWrap(el || brlInputEl, maxCells);
  window.toggleBrlSixKey = toggleBrlSixKey;
  window.toggleBrlAscii = toggleBrlAscii;
  window.toggleBrlInsertMode = toggleBrlInsertMode;
  window.centerCurrentBrailleLine = centerCurrentBrailleLine;
  window.updateBrlMarginDropdownUI = updateBrlMarginDropdownUI;
  window.updateBrlPositionUI = updateBrlPositionUI;
  window.updateBrlSyncStatus = updateBrlSyncStatus;
  window.validateBrailleDocument = validateBrailleDocument;
  window.runBrailleValidation = runBrailleValidation;
  window.jumpToBrailleIssue = jumpToBrailleIssue;
  window.getBrlSyncStatus = () => brlCurrentSyncStatus;
  window.detectBrailleBufferChanges = detectBrailleBufferChanges;
  window.reconcileBrailleChangeToPrint = reconcileBrailleChangeToPrint;
  window.scheduleBrailleToPrintSync = scheduleBrailleToPrintSync;
  window.backTranslateBrailleText = backTranslateBrailleText;
  window.backTranslateBrailleRuns = backTranslateBrailleRuns;
  window.parseBrailleBlockSegments = parseBrailleBlockSegments;
  window.extractPrintPageNumber = extractPrintPageNumber;
  window.detectBrailleBlockStyle = detectBrailleBlockStyle;
  window.stripTranscriberNoteIndicators = stripTranscriberNoteIndicators;
  window.stripFootnoteIndicators = stripFootnoteIndicators;
  window.stripStageIndicators = stripStageIndicators;
  window.stripPoemIndicators = stripPoemIndicators;
  window.stripDialogueIndicators = stripDialogueIndicators;
  window.stripAttributionIndicators = stripAttributionIndicators;
  window.stripCaptionIndicators = stripCaptionIndicators;
  window.stripQuoteIndicators = stripQuoteIndicators;
  window.isTableSeparatorLine = isTableSeparatorLine;
  window.extractColumnsFromSeparator = extractColumnsFromSeparator;
  window.parseBrailleSpatialTable = parseBrailleSpatialTable;
  window.parseBrailleListedTable = parseBrailleListedTable;
  window.parseBrailleTable = parseBrailleTable;
  window.detectBrailleTable = detectBrailleTable;
  window.detectBrailleGraphic = detectBrailleGraphic;
  window.parseBrailleGraphicBlock = parseBrailleGraphicBlock;
  window.refreshToolbar = refreshToolbar;
  window.isReconcilingBrailleToPrint = () => isReconcilingBrailleToPrint;
  window.getLastRenderedBrailleText = () => lastRenderedBrailleText;
  window.getLastTrace = () => lastTrace;
  window.modelToLexical = modelToLexical;
  window.buildModel = () => editor.getEditorState().read(buildModel);
  window.unicodeBrailleToBrf = unicodeBrailleToBrf;
  window.brfToUnicodeBraille = brfToUnicodeBraille;
}

// ---- Bidirectional Sync & Change Detection (Braille -> Print) ----
export function backTranslateBrailleText(brailleText, customSettings = settings) {
  if (!brailleText || !brailleText.trim()) return '';
  const brf = /[\u2800-\u28FF]/.test(brailleText) ? unicodeBrailleToBrf(brailleText) : brailleText;
  const table = resolveTable(customSettings || settings);
  const translators = makeTranslators(louis, table);
  try {
    const raw = translators.backTranslate(brf);
    return (raw || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  } catch (err) {
    console.warn('backTranslateBrailleText error:', err);
    return '';
  }
}

export function backTranslateBrailleRuns(brailleText, customSettings = settings) {
  if (!brailleText || !brailleText.trim()) return [];
  const brf = /[\u2800-\u28FF]/.test(brailleText) ? unicodeBrailleToBrf(brailleText) : brailleText;
  const table = resolveTable(customSettings || settings);
  const translators = makeTranslators(louis, table);
  try {
    if (typeof translators.backTranslateRuns === 'function') {
      const res = translators.backTranslateRuns(brf);
      if (res && res.runs && res.runs.length > 0) {
        return res.runs.map(r => ({
          type: 'text',
          text: (r.text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''),
          tf: r.tf || 0,
        })).filter(r => r.text);
      }
    }
    const plain = translators.backTranslate(brf);
    return plain ? [{ type: 'text', text: plain.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''), tf: 0 }] : [];
  } catch (err) {
    console.warn('backTranslateBrailleRuns error:', err);
    return [];
  }
}

export function parseBrailleBlockSegments(rawBraille, customSettings = settings) {
  if (!rawBraille || !rawBraille.trim()) return [];
  const currentSettings = customSettings || settings;
  const isNemeth = effectiveMathCode(currentSettings) === 'nemeth';

  // 1. Normalize Unicode Braille representation if input is BRF ASCII
  const uniBrl = /[\u2800-\u28FF]/.test(rawBraille) ? rawBraille : brfToUnicodeBraille(rawBraille);

  // 2. Check for Nemeth Switches: ⠸⠩ (NEM_OPEN) and ⠸⠱ (NEM_CLOSE)
  if (uniBrl.includes(NEM_OPEN)) {
    const segments = [];
    let idx = 0;
    while (idx < uniBrl.length) {
      const openIdx = uniBrl.indexOf(NEM_OPEN, idx);
      if (openIdx === -1) {
        const textPart = uniBrl.slice(idx);
        if (textPart.trim()) {
          const runs = backTranslateBrailleRuns(textPart, currentSettings);
          if (runs.length) segments.push(...runs);
        }
        break;
      }

      if (openIdx > idx) {
        const textPart = uniBrl.slice(idx, openIdx);
        if (textPart.trim()) {
          const runs = backTranslateBrailleRuns(textPart, currentSettings);
          if (runs.length) segments.push(...runs);
        }
      }

      const closeIdx = uniBrl.indexOf(NEM_CLOSE, openIdx + NEM_OPEN.length);
      const mathBrl = closeIdx !== -1
        ? uniBrl.slice(openIdx + NEM_OPEN.length, closeIdx)
        : uniBrl.slice(openIdx + NEM_OPEN.length);

      let mathLatex = null;
      try {
        if (typeof globalThis !== 'undefined' && globalThis.NemethToLatex && typeof nemethHybrid === 'function') {
          const mathRes = nemethHybrid(mathBrl);
          if (mathRes && mathRes.latex) mathLatex = mathRes.latex;
        }
        if (!mathLatex && typeof nemethMathsToLatexV2 === 'function') {
          const v2Res = nemethMathsToLatexV2(mathBrl);
          if (v2Res && v2Res.latex) mathLatex = v2Res.latex;
        }
      } catch (e) {
        try {
          if (typeof nemethMathsToLatexV2 === 'function') {
            const v2Res = nemethMathsToLatexV2(mathBrl);
            if (v2Res && v2Res.latex) mathLatex = v2Res.latex;
          }
        } catch (_) {}
      }

      if (mathLatex) {
        segments.push({ type: 'math', latex: mathLatex });
      } else if (mathBrl.trim()) {
        const runs = backTranslateBrailleRuns(mathBrl, currentSettings);
        if (runs.length) segments.push(...runs);
      }

      if (closeIdx === -1) break;
      idx = closeIdx + NEM_CLOSE.length;
    }
    return segments;
  }

  // 3. Check for UEB Math Indicators or Expressions
  // Indicators: ⠰⠰⠰ (passage), ⠰⠰ (word), ⠰ (symbol)
  // Operators: ⠐⠖ (+), ⠐⠤ (-), ⠐⠶ (=), ⠐⠦ (×), ⠨⠌ (/), ⠰⠔ (^), ⠰⠩ (sqrt), ⠰⠷ (frac), ⠨⠏ (pi)
  const isUebMathPattern = /⠰[⠔⠢⠩⠷⠻]|⠐[⠖⠤⠶⠦]|⠨[⠌⠏]|⠼[⠁-⠚]+[⠐⠨⠰]/.test(uniBrl);
  if (isUebMathPattern) {
    try {
      const uebRes = uebHybrid(uniBrl);
      if (uebRes && uebRes.latex && (!uebRes.badCells || uebRes.badCells.length === 0)) {
        return [{ type: 'math', latex: uebRes.latex }];
      }
    } catch (_) {}
  }

  // 4. Standalone Nemeth Math (ONLY when string has NO spaces and contains explicit Nemeth operators/digits)
  if (isNemeth && !uniBrl.includes(' ') && !uniBrl.includes('⠀') && /[⠂⠆⠒⠲⠢⠖⠶⠦⠔⠴]/.test(uniBrl)) {
    try {
      const mathRes = nemethMathsToLatexV2 ? nemethMathsToLatexV2(uniBrl) : null;
      if (mathRes && mathRes.latex && (!mathRes.badCells || mathRes.badCells.length === 0)) {
        return [{ type: 'math', latex: mathRes.latex }];
      }
    } catch (_) {}
  }

  // 5. Default: Standard Literary Text with Typeform Runs (Bold, Italic, Underline)
  return backTranslateBrailleRuns(rawBraille, currentSettings);
}

export function extractPrintPageNumber(rawPageToken, customSettings = settings) {
  if (!rawPageToken) return '1';
  let token = rawPageToken.trim();

  // 1. If standard ASCII digits / letters / Roman numerals
  if (/^[a-zA-Z0-9\-]+$/.test(token)) {
    // Check if ASCII BRF number format like #A or #B or #AB
    if (token.startsWith('#')) {
      const numPart = token.slice(1).toUpperCase();
      const digitMap = { A: '1', B: '2', C: '3', D: '4', E: '5', F: '6', G: '7', H: '8', I: '9', J: '0' };
      const converted = [...numPart].map(ch => digitMap[ch] || ch).join('');
      if (/^\d+$/.test(converted)) return converted;
    }
    return token;
  }

  // 2. If Unicode Braille number with number prefix ⠼
  if (token.startsWith('⠼')) {
    const numPart = token.slice(1);
    const digitMap = { '⠁': '1', '⠃': '2', '⠉': '3', '⠙': '4', '⠑': '5', '⠋': '6', '⠛': '7', '⠓': '8', '⠊': '9', '⠚': '0' };
    const converted = [...numPart].map(ch => digitMap[ch] || ch).join('');
    if (/^\d+$/.test(converted)) return converted;
  }

  // 3. If Lowered braille digits (UKAAF lowered numbers ⠂ ⠆ ⠒ ⠲ ⠢ ⠖ ⠶ ⠦ ⠔ ⠴)
  const loweredMap = { '⠂': '1', '⠆': '2', '⠒': '3', '⠲': '4', '⠢': '5', '⠖': '6', '⠶': '7', '⠦': '8', '⠔': '9', '⠴': '0' };
  if ([...token].every(ch => loweredMap[ch])) {
    return [...token].map(ch => loweredMap[ch]).join('');
  }

  // 4. If UEB letter page numbers (e.g. ⠁ for 1/a, ⠊ for i, ⠊⠊ for ii, etc.)
  const letterMap = { '⠁': 'a', '⠃': 'b', '⠉': 'c', '⠙': 'd', '⠑': 'e', '⠋': 'f', '⠛': 'g', '⠓': 'h', '⠊': 'i', '⠚': 'j', '⠧': 'v', '⠭': 'x' };
  if ([...token].every(ch => letterMap[ch])) {
    const letters = [...token].map(ch => letterMap[ch]).join('');
    return letters;
  }

  // 5. Back-translation fallback
  if (typeof backTranslateBrailleText === 'function') {
    const bt = backTranslateBrailleText(token, customSettings);
    if (bt) return bt.trim();
  }

  return token;
}

export function stripTranscriberNoteIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  // Strip Unicode TN indicators ⠈⠨⠣ ... ⠈⠨⠜
  s = s.replace(/^⠈⠨⠣[ \t\u2800]*/, '').replace(/[ \t\u2800]*⠈⠨⠜$/, '');
  // Strip ASCII TN indicators @.< ... @.>
  s = s.replace(/^@\.<[ \t]*/, '').replace(/[ \t]*@\.\>$/, '');
  // Strip legacy Unicode ⠐⠇ ... ⠐⠂ / ⠐⠇
  s = s.replace(/^⠐⠇[ \t\u2800]*/, '').replace(/[ \t\u2800]*(?:⠐⠂|⠐⠇)$/, '');
  // Strip legacy ASCII ,' ... 7 / ,'
  s = s.replace(/^,\'[ \t]*/, '').replace(/[ \t]*(?:7|,\')$/, '');
  // Strip [TN: ...] or [transcriber's note: ...]
  s = s.replace(/^\[(?:tn:?|transcriber(?:'s)?\s*note:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  return s.trim();
}

export function stripFootnoteIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  // Strip [fn: ...] or [footnote: ...]
  s = s.replace(/^\[(?:fn:?|footnote:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  // Strip leading Footnote: or ⠠⠋⠕⠕⠞⠝⠕⠞⠑ / ⠠⠿⠕⠕⠞⠝⠕⠞⠑
  s = s.replace(/^(?:footnote:?|⠠?[⠋⠿]⠕⠕⠞⠝⠕⠞⠑:?)[ \t\u2800]*/i, '');
  return s.trim();
}

export function stripStageIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  s = s.replace(/^\[(?:stage\s*direction:?|stage:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  s = s.replace(/^\((?:stage\s*direction:?|stage:?)[ \t]*/i, '').replace(/[ \t]*\)$/, '');
  s = s.replace(/^(?:⠠⠎⠞⠁⠛⠑\s*⠙⠊⠗⠑⠉⠞⠊⠕⠝:|⠠⠎⠞⠁⠛⠑:|stage\s*direction:|stage:)[ \t\u2800]*/i, '');
  return s.trim();
}

export function stripPoemIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  s = s.replace(/^\[(?:poem:?|verse:?|stanza:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  s = s.replace(/^(?:⠠⠏⠕⠑⠍:|⠠⠧⠑⠗⠎⠑:|poem:|verse:)[ \t\u2800]*/i, '');
  return s.trim();
}

export function stripDialogueIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  s = s.replace(/^\[(?:dialogue:?|play:?|speaker:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  s = s.replace(/^(?:⠠⠙⠊⠁⠇⠕⠛⠥⠑:|dialogue:)[ \t\u2800]*/i, '');
  return s.trim();
}

export function stripAttributionIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  s = s.replace(/^\[(?:attribution:?|source:?|credit:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  s = s.replace(/^(?:⠠⠁⠞⠞⠗⠊⠃⠥⠞⠊⠕⠝:|attribution:|source:)[ \t\u2800]*/i, '');
  return s.trim();
}

export function stripCaptionIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  s = s.replace(/^\[(?:caption:?|figure:?|image\s*caption:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  s = s.replace(/^(?:caption:|figure\s*\d+:|fig\.\s*\d+:|⠠⠉⠁⠏⠞⠊⠕⠝:|⠠⠿⠊⠛⠥⠗⠑\s*⠼[⠁-⠚]+:)[ \t\u2800]*/i, '');
  return s.trim();
}

export function stripQuoteIndicators(brl) {
  if (!brl || typeof brl !== 'string') return '';
  let s = brl.trim();
  s = s.replace(/^\[(?:quote:?|blockquote:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
  s = s.replace(/^>[ \t]*/, '');
  return s.trim();
}

export function isTableSeparatorLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^[ \t\u2800]*[⠒⠤\-3—]{2,}(?:[ \t\u2800]+[⠒⠤\-3—]{2,})+[ \t\u2800]*$/.test(line);
}

export function extractColumnsFromSeparator(sepLine) {
  const cols = [];
  const re = /([⠒⠤\-3—]{2,})/g;
  let m;
  while ((m = re.exec(sepLine)) !== null) {
    cols.push({ start: m.index, end: m.index + m[0].length });
  }
  return cols;
}

export function parseBrailleSpatialTable(blockLines, customSettings = settings, existingHeaders = []) {
  if (!blockLines || !blockLines.length) return { headers: [], rows: [], format: 'spatial' };

  let caption = '';
  let tabletn = '';
  const cleanLines = [];

  for (let l of blockLines) {
    const trimmed = l.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');
    if (!trimmed) continue;
    if (/^\[\/?(?:table|table-spatial|table-listed)(?::\s*.*)?\]$/i.test(trimmed)) continue;

    // Ignore standalone embosser page numbers (e.g. ⠼⠁, #A, 1, Page 1)
    if (/^(?:⠼[⠁-⠚]+|#\s*[a-zA-Z0-9]+|\d+|page\s*\d+)$/i.test(trimmed)) continue;

    if (/^(@\.<|⠈⠨⠣|,'|⠐⠇|\[(?:tn:?|transcriber(?:'s)?\s*note:?|tabletn:?))/i.test(trimmed)) {
      const tnBrl = stripTranscriberNoteIndicators(trimmed);
      tabletn = backTranslateBrailleText(tnBrl, customSettings);
      continue;
    }

    if (/^\[(?:caption:?|title:?)[ \t]*/i.test(trimmed)) {
      const capBrl = trimmed.replace(/^\[(?:caption:?|title:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
      caption = backTranslateBrailleText(capBrl, customSettings);
      continue;
    }

    cleanLines.push(l);
  }

  if (cleanLines.length === 0) {
    return { headers: [], rows: [], format: 'spatial', caption, tabletn };
  }

  let sepIdx = -1;
  for (let i = 0; i < cleanLines.length; i++) {
    if (isTableSeparatorLine(cleanLines[i])) {
      sepIdx = i;
      break;
    }
  }

  let headers = [];
  const rows = [];

  if (sepIdx !== -1) {
    const sepLine = cleanLines[sepIdx];
    const colSpans = extractColumnsFromSeparator(sepLine);
    const colCount = colSpans.length;

    const sliceRow = (line) => {
      const chunks = line.split(/[ \t\u2800]{2,}/).map(c => c.trim()).filter(Boolean);
      if (chunks.length === colCount) {
        return chunks.map(rawCell => {
          if (!rawCell || /^[⠒⠤\-3—]{2,}$/.test(rawCell)) return '';
          return backTranslateBrailleText(rawCell, customSettings);
        });
      }

      const cells = [];
      for (let ci = 0; ci < colCount; ci++) {
        const cStart = ci === 0 ? 0 : colSpans[ci].start;
        const cEnd = ci === colCount - 1 ? line.length : (colSpans[ci + 1] ? colSpans[ci + 1].start : line.length);
        const rawCell = line.slice(cStart, cEnd).trim();
        if (!rawCell || /^[⠒⠤\-3—]{2,}$/.test(rawCell)) {
          cells.push('');
        } else {
          cells.push(backTranslateBrailleText(rawCell, customSettings));
        }
      }
      return cells;
    };

    const headerLines = cleanLines.slice(0, sepIdx);
    if (headerLines.length > 0) {
      if (headerLines.length > 1 && !caption) {
        const first = headerLines[0].trim();
        const leadingSpaces = (headerLines[0].match(/^[ \t\u2800]*/) || [''])[0].length;
        if (leadingSpaces >= 4 && !first.includes('  ')) {
          caption = backTranslateBrailleText(first, customSettings);
          headerLines.shift();
        }
      }
      if (headerLines.length > 0) {
        headers = sliceRow(headerLines[headerLines.length - 1]);
      }
    }

    if ((!headers || headers.length === 0) && existingHeaders && existingHeaders.length > 0) {
      headers = existingHeaders;
    }

    const dataLines = cleanLines.slice(sepIdx + 1);
    for (const dl of dataLines) {
      const r = sliceRow(dl);
      if (r.some(c => c !== '')) rows.push(r);
    }
  } else {
    for (let i = 0; i < cleanLines.length; i++) {
      const line = cleanLines[i].trim();
      if (!line) continue;
      const rawCols = line.split(/[ \t\u2800]{2,}/);
      const row = rawCols.map(c => {
        const tr = c.trim();
        if (!tr || /^[⠒⠤\-3—]{2,}$/.test(tr)) return '';
        return backTranslateBrailleText(tr, customSettings);
      });
      if (i === 0 && (existingHeaders.length > 0 || cleanLines.length > 1)) {
        headers = row;
      } else {
        rows.push(row);
      }
    }
  }

  if ((!headers || headers.length === 0) && existingHeaders && existingHeaders.length > 0) {
    headers = existingHeaders;
  }

  return { headers, rows, format: 'spatial', caption, tabletn };
}

export function parseBrailleListedTable(blockLines, customSettings = settings, existingHeaders = []) {
  if (!blockLines || !blockLines.length) return { headers: [], rows: [], format: 'listed' };

  let caption = '';
  let tabletn = '';
  const rows = [];
  const headersSet = new Set(existingHeaders.slice(1));
  let currentRow = null;

  for (let line of blockLines) {
    const trimmed = line.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');
    if (!trimmed) {
      if (currentRow) {
        rows.push(currentRow);
        currentRow = null;
      }
      continue;
    }

    if (/^\[\/?(?:table|table-spatial|table-listed)(?::\s*.*)?\]$/i.test(trimmed)) continue;

    // Ignore standalone embosser page numbers (e.g. ⠼⠁, #A, 1, Page 1)
    if (/^(?:⠼[⠁-⠚]+|#\s*[a-zA-Z0-9]+|\d+|page\s*\d+)$/i.test(trimmed)) continue;

    if (/^(@\.<|⠈⠨⠣|,'|⠐⠇|\[(?:tn:?|transcriber(?:'s)?\s*note:?|tabletn:?))/i.test(trimmed)) {
      const tnBrl = stripTranscriberNoteIndicators(trimmed);
      tabletn = backTranslateBrailleText(tnBrl, customSettings);
      continue;
    }

    if (/^\[(?:caption:?|title:?)[ \t]*/i.test(trimmed)) {
      const capBrl = trimmed.replace(/^\[(?:caption:?|title:?)[ \t]*/i, '').replace(/[ \t]*\]$/, '');
      caption = backTranslateBrailleText(capBrl, customSettings);
      continue;
    }

    const leadingSpaces = (line.match(/^[ \t\u2800]*/) || [''])[0].length;

    if (rows.length === 0 && !currentRow && leadingSpaces >= 4 && !caption && !line.includes(':')) {
      caption = backTranslateBrailleText(trimmed, customSettings);
      continue;
    }

    if (leadingSpaces === 0) {
      if (currentRow) rows.push(currentRow);
      currentRow = {
        label: backTranslateBrailleText(trimmed, customSettings),
        cols: {}
      };
    } else {
      if (!currentRow) {
        currentRow = { label: '', cols: {} };
      }
      const fullText = backTranslateBrailleText(trimmed, customSettings);
      let colonIdx = fullText.indexOf(':');
      if (colonIdx !== -1) {
        const hdr = fullText.slice(0, colonIdx).trim();
        let val = fullText.slice(colonIdx + 1).trim();
        if (val === '---' || val === '——' || val === '–' || /^[⠒⠤\-3—]{2,}$/.test(val)) val = '';
        if (hdr) {
          headersSet.add(hdr);
          currentRow.cols[hdr] = val;
        }
      }
    }
  }

  if (currentRow) rows.push(currentRow);

  const col1Headers = Array.from(headersSet);
  const headers = [existingHeaders[0] || 'Item', ...col1Headers];
  const tableRows = rows.map(r => {
    return [r.label, ...col1Headers.map(h => r.cols[h] || '')];
  });

  return { headers, rows: tableRows, format: 'listed', caption, tabletn };
}

export function parseBrailleTable(blockLines, customSettings = settings, existingHeaders = []) {
  if (!blockLines || !blockLines.length) return { headers: [], rows: [], format: 'auto' };

  const isListed = blockLines.some(l => {
    const tr = l.trim();
    if (/\[table-listed\]/i.test(tr)) return true;
    if (/@\.<.*(?:table:\s*listed|listed\s*table|,LI\/\$)/i.test(tr) || /⠈⠨⠣.*(?:⠠⠞⠁⠃⠇⠑:.*⠠⠇⠊⠎⠞⠑⠙|⠠⠇⠊⠎⠞⠑⠙.*⠠⠞⠁⠃⠇⠑)/i.test(tr)) return true;
    if (/^(@\.<|⠈⠨⠣|,'|⠐⠇|\[(?:tn:?|transcriber(?:'s)?\s*note:?|tabletn:?))/i.test(tr)) {
      const tnText = backTranslateBrailleText(stripTranscriberNoteIndicators(tr), customSettings);
      if (/(?:table:\s*listed|listed\s*table)/i.test(tnText)) return true;
    }
    return false;
  });

  if (isListed) {
    return parseBrailleListedTable(blockLines, customSettings, existingHeaders);
  }

  return parseBrailleSpatialTable(blockLines, customSettings, existingHeaders);
}

export function parseBrailleGraphicBlock(blockLines, customSettings = settings, existingData = {}) {
  if (!blockLines || !blockLines.length) {
    return {
      title: existingData.title || 'Tactile diagram',
      alt: existingData.alt || 'Tactile diagram',
      size: existingData.size || 'half',
      caption: existingData.caption || '',
      labels: existingData.labels || []
    };
  }

  let title = '';
  let alt = '';
  let size = existingData.size || 'half';
  let caption = existingData.caption || '';
  const labels = [];

  const textLines = blockLines.map(l => l.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '')).filter(Boolean);

  for (const line of textLines) {
    // 1. Explicit bracket marker: [graphic: Title], [graphic size="full": Title], [tactile graphic: Title — Alt], [diagram: Title]
    const bracketMatch = line.match(/^\[(?:graphic|tactile(?:\s*graphic)?|diagram)(?:\s+size=["']?(compact|half|full)["']?)?(?::|\s+)?\s*(.*?)\]$/i);
    if (bracketMatch) {
      if (bracketMatch[1]) size = bracketMatch[1].toLowerCase();
      const payload = bracketMatch[2].trim();
      if (payload) {
        const parts = payload.split(/\s+[—\-]\s+/);
        let rawTitle = parts[0] || '';
        let rawAlt = parts[1] || rawTitle;

        if (/[\u2800-\u28FF]/.test(rawTitle)) {
          title = backTranslateBrailleText(rawTitle, customSettings);
        } else {
          title = rawTitle;
        }

        if (/[\u2800-\u28FF]/.test(rawAlt)) {
          alt = backTranslateBrailleText(rawAlt, customSettings);
        } else {
          alt = rawAlt;
        }
      }
      continue;
    }

    // Size tag: [size: full] or [size: compact]
    const sizeMatch = line.match(/^\[size:\s*(compact|half|full)\]$/i);
    if (sizeMatch) {
      size = sizeMatch[1].toLowerCase();
      continue;
    }

    // TN graphic line: [Transcriber's Note: Tactile diagram — Title]
    const tnMatch = line.match(/^\[(?:Transcriber(?:'s)?\s*Note:\s*)?(?:Tactile\s*diagram|Graphic)\s*[—\-]\s*(.*?)\]$/i);
    if (tnMatch) {
      const payload = tnMatch[1].trim();
      if (/[\u2800-\u28FF]/.test(payload)) {
        title = backTranslateBrailleText(payload, customSettings);
      } else {
        title = payload;
      }
      if (!alt) alt = title;
      continue;
    }

    // Unicode Braille graphic label line
    if (/[\u2800-\u28FF]/.test(line)) {
      const back = backTranslateBrailleText(line, customSettings);
      const backMatch = back.match(/^(?:\[)?(?:Tactile\s*graphic|Graphic|Diagram)(?::|\s*[—\-])\s*(.*?)(?:\])?$/i);
      if (backMatch) {
        title = backMatch[1].trim();
        if (!alt) alt = title;
        continue;
      }
    }

    // Caption line
    const capMatch = line.match(/^(?:\[(?:caption:?)|caption:)\s*(.*?)\]?$/i);
    if (capMatch) {
      let rawCap = capMatch[1].trim();
      if (/[\u2800-\u28FF]/.test(rawCap)) {
        caption = backTranslateBrailleText(rawCap, customSettings);
      } else {
        caption = rawCap;
      }
      continue;
    }

    // Label line
    const labelMatch = line.match(/^(?:\[(?:label|key):?|(?:label|key):)\s*(.*?)\]?$/i);
    if (labelMatch) {
      let rawLbl = labelMatch[1].trim();
      if (/[\u2800-\u28FF]/.test(rawLbl)) {
        labels.push(backTranslateBrailleText(rawLbl, customSettings));
      } else {
        labels.push(rawLbl);
      }
      continue;
    }
  }

  if (!title) title = existingData.title || existingData.alt || 'Tactile diagram';
  if (!alt) alt = existingData.alt || title || 'Tactile diagram';

  return { title, alt, size, caption, labels };
}

export function detectBrailleGraphic(blockLines, customSettings = settings) {
  if (!blockLines || !blockLines.length) return { isGraphic: false };
  const firstLine = blockLines[0] || '';
  const trimmed = firstLine.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');
  if (!trimmed) return { isGraphic: false };

  const isGraphicMarker = /^(\[(?:graphic:?|tactile(?:\s*graphic)?:?|diagram:?)|\[(?:graphic|tactile|diagram)\]|⠠⠞⠁⠉⠞⠊⠇⠑\s*⠠?⠛⠗⠁⠏⠓⠊⠉:|⠠⠛⠗⠁⠏⠓⠊⠉:|⠠⠙⠊⠁⠛⠗⠁⠍:|\[(?:Transcriber(?:'s)?\s*Note:\s*)?(?:Tactile\s*diagram|Graphic)\s*[—\-])/i.test(trimmed);
  if (isGraphicMarker) {
    const parsed = parseBrailleGraphicBlock(blockLines, customSettings);
    return { isGraphic: true, style: 'graphic', ...parsed };
  }
  return { isGraphic: false };
}

export function detectBrailleTable(blockLines, customSettings = settings) {
  if (!blockLines || !blockLines.length) return { isTable: false };
  const firstLine = blockLines[0] || '';
  const trimmed = firstLine.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');

  const hasTableMarker = blockLines.some(l => /^\[\/?(?:table|table-spatial|table-listed)(?::\s*.*)?\]$/i.test(l.trim()));
  const hasListedTn = blockLines.some(l => {
    const tr = l.trim();
    if (/@\.<.*(?:table:\s*listed|listed\s*table|,LI\/\$)/i.test(tr) || /⠈⠨⠣.*(?:⠠⠞⠁⠃⠇⠑:.*⠠⠇⠊⠎⠞⠑⠙|⠠⠇⠊⠎⠞⠑⠙.*⠠⠞⠁⠃⠇⠑)/i.test(tr)) return true;
    if (/^(@\.<|⠈⠨⠣|,'|⠐⠇|\[(?:tn:?|transcriber(?:'s)?\s*note:?|tabletn:?))/i.test(tr)) {
      const tnText = backTranslateBrailleText(stripTranscriberNoteIndicators(tr), customSettings);
      if (/(?:table:\s*listed|listed\s*table)/i.test(tnText)) return true;
    }
    return false;
  });
  const hasSeparator = blockLines.some(l => isTableSeparatorLine(l));

  if (hasTableMarker || hasListedTn || hasSeparator) {
    const isListed = hasListedTn || blockLines.some(l => /\[table-listed\]/i.test(l.trim()));
    return { isTable: true, format: isListed ? 'listed' : 'spatial' };
  }
  return { isTable: false };
}

export function detectBrailleBlockStyle(blockLines, customSettings = settings) {
  if (!blockLines || blockLines.length === 0) return { style: 'body', headingLevel: null, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false, isTable: false };
  const firstLine = blockLines[0] || '';
  const trimmed = firstLine.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');
  if (!trimmed) return { style: 'body', headingLevel: null, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false, isTable: false };

  const currentSettings = customSettings || settings;
  const lineWidth = (currentSettings?.cells | 0) || (EMBOSSER_PRESETS[currentSettings?.embosser]?.cells || 38);
  const leadingSpaces = (firstLine.match(/^[ \t\u2800]*/) || [''])[0].length;

  // 1. Check for Document Section Break (* * *, ***, ∗ ∗ ∗, "9 "9 "9, ⠐⠔ ⠐⠔ ⠐⠔, ⠐ ⠐ ⠐)
  const breakMatch = trimmed.match(/^(?:(?:"9|⠐⠔)[ \t\u2800]+(?:"9|⠐⠔)[ \t\u2800]+(?:"9|⠐⠔)|(?:"9|⠐⠔){3}|\*(?:[ \t\u2800]*\*){2,}|∗(?:[ \t\u2800]*∗){2,}|⠐(?:[ \t\u2800]+⠐){2,})$/);
  if (breakMatch) {
    return { style: 'break', isBreak: true, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isNote: false, isFootnote: false, isTable: false };
  }

  // 2. Check for Print Page Indicator
  // 2a. BANA / UKAAF Braille Page Indicator lines ("3------- 1 or ⠐⠒⠤⠤⠤⠤ ⠼⠁ or centred "31 / ⠐⠒⠁)
  const braillePageMatch = trimmed.match(/^(?:"3|⠐⠒)[ \t\u2800\-\⠤]*(?:Page|PAGE|⠠⠏⠁⠛⠑)?[ \t\u2800]*([a-zA-Z0-9ivxlcdm\u2800-\u28FF\-#]+)$/i);
  if (braillePageMatch) {
    const pageToken = braillePageMatch[1];
    const pageNum = extractPrintPageNumber(pageToken, currentSettings);
    return { style: 'print-page', isPrintPage: true, page: pageNum, isHeading: false, isList: false, isSidebar: false, isBreak: false, isNote: false, isFootnote: false, isTable: false };
  }

  // 2b. Direct / Slash Print Page marker (e.g. "--- Page 1 ---" or "Page 1" or "⠠⠏⠁⠛⠑ ⠼⠁")
  const directPageMatch = trimmed.match(/^(?:---|⠒{3,}|⠐{3,})?[ \t\u2800]*(?:Page|PAGE|⠠⠏⠁⠛⠑|⠏⠁⠛⠑)[ \t\u2800]+([a-zA-Z0-9ivxlcdm\u2800-\u28FF\-#]+)[ \t\u2800]*(?:---|⠒{3,}|⠐{3,})?$/i);
  if (directPageMatch) {
    const pageToken = directPageMatch[1];
    const pageNum = extractPrintPageNumber(pageToken, currentSettings);
    return { style: 'print-page', isPrintPage: true, page: pageNum, isHeading: false, isList: false, isSidebar: false, isBreak: false, isNote: false, isFootnote: false, isTable: false };
  }

  // 3. Check for Sidebar Boxlines (top border dots 2-5: ⠒ in Unicode, 3 in ASCII)
  const boxlineMatch = trimmed.match(/^([⠒3]{3,})[ \t\u2800]*(.*?)[ \t\u2800]*([⠒3]*)$/);
  if (boxlineMatch && (boxlineMatch[1].length >= 3 || (boxlineMatch[1].length + (boxlineMatch[3]?.length || 0) >= 4))) {
    let titleBrl = boxlineMatch[2] ? boxlineMatch[2].replace(/[⠒3]+$/g, '').replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '') : '';
    let title = '';
    if (titleBrl) {
      title = backTranslateBrailleText(titleBrl, currentSettings);
    }
    return { style: 'sidebar', isContainer: true, title, isSidebar: true, isHeading: false, isList: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false, isTable: false };
  }

  // 4. Check for Table (Spatial Columnar or Listed Format)
  const tableInfo = detectBrailleTable(blockLines, currentSettings);
  if (tableInfo.isTable) {
    return { style: 'table', isTable: true, format: tableInfo.format, isNote: false, isFootnote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isGraphic: false };
  }

  // 5. Check for Tactile Graphic
  const graphicInfo = detectBrailleGraphic(blockLines, currentSettings);
  if (graphicInfo.isGraphic) {
    return { style: 'graphic', isGraphic: true, isTable: false, isNote: false, isFootnote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, ...graphicInfo };
  }

  // 6. Check for Transcriber's Note (TN)
  // BANA TN indicators: @.< ... @.> (BRF), ⠈⠨⠣ ... ⠈⠨⠜ (Unicode), legacy ,' ... 7 or ,' ... ,', ⠐⠇ ... ⠐⠂
  // Direct/Slash markers: [tn: ...], [transcriber's note: ...]
  const lastLine = blockLines[blockLines.length - 1] || '';
  const trimmedLast = lastLine.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');
  const joinedBlock = blockLines.map(l => l.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '')).join(' ');

  const hasTnOpen = /^(@\.<|⠈⠨⠣|,'|⠐⠇|\[(?:tn:?|transcriber(?:'s)?\s*note:?))/i.test(trimmed);
  const hasTnClose = /(@\.>|⠈⠨⠜|,'|7|⠐⠂|\])$/.test(trimmedLast);
  const hasTnMarkers = /(@\.<|⠈⠨⠣|,'|⠐⠇)/.test(joinedBlock);

  if (hasTnOpen || (hasTnClose && hasTnMarkers)) {
    return { style: 'note', isNote: true, isFootnote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 5. Check for Footnote
  // Markers: [fn: ...], [footnote: ...], Footnote: ..., ⠠⠋⠕⠕⠞⠝⠕⠞⠑ / ⠠⠿⠕⠕⠞⠝⠕⠞⠑ ...
  const hasFnMarker = /^(\[(?:fn:?|footnote:?)|footnote:|⠠?[⠋⠿]⠕⠕⠞⠝⠕⠞⠑)/i.test(trimmed);
  if (hasFnMarker) {
    return { style: 'footnote', isFootnote: true, isNote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 6. Check for Stage Direction
  const isStageMarker = /^(\[(?:stage:?|stage\s*direction:?)|\[stage\]|\(stage\s*direction:?\)|⠠⠎⠞⠁⠛⠑:)/i.test(trimmed);
  const isStageIndentParenthetical = (leadingSpaces === 6 && ((trimmed.startsWith('(') && trimmed.endsWith(')')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))));
  if (isStageMarker || isStageIndentParenthetical) {
    return { style: 'stage', isStage: true, isFootnote: false, isNote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 7. Check for Play Dialogue
  const isDialogueMarker = /^(\[(?:dialogue:?|play:?|speaker:?)|\[dialogue\]|\[play\]|⠠⠙⠊⠁⠇⠕⠛⠥⠑:)/i.test(trimmed);
  const isDialogueSpeaker = /^((?:⠠[⠁-⠵]){2,20}⠒|\b[A-Z]{2,20}:)[ \t\u2800]/.test(trimmed);
  if (isDialogueMarker || isDialogueSpeaker) {
    return { style: 'dialogue', isDialogue: true, isFootnote: false, isNote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 8. Check for Poetry / Verse
  const isPoemMarker = /^(\[(?:poem:?|verse:?|stanza:?)|\[poem\]|\[verse\]|⠠⠏⠕⠑⠍:|⠠⠧⠑⠗⠎⠑:)/i.test(trimmed);
  if (isPoemMarker) {
    return { style: 'poem', isPoem: true, isFootnote: false, isNote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 9. Check for Caption
  const isCaptionMarker = /^(\[(?:caption:?|image\s*caption:?)|\[caption\]|caption:|⠠⠉⠁⠏⠞⠊⠕⠝:|figure\s*\d+:|fig\.\s*\d+:|⠠⠿⠊⠛⠥⠗⠑\s*⠼[⠁-⠚]+:)/i.test(trimmed);
  if (isCaptionMarker) {
    return { style: 'caption', isCaption: true, isFootnote: false, isNote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 10. Check for Attribution
  const isAttributionMarker = /^(\[(?:attribution:?|source:?|credit:?)|\[attribution\]|⠠⠁⠞⠞⠗⠊⠃⠥⠞⠊⠕⠝:|(?:—|---|--|⠠⠤⠤|⠤⠤)[ \t\u2800]+[A-Za-z0-9\u2800-\u28FF])/i.test(trimmed);
  if (isAttributionMarker) {
    return { style: 'attribution', isAttribution: true, isFootnote: false, isNote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 11. Check for Quote
  const isQuoteMarker = /^(\[(?:quote:?|blockquote:?)|\[quote\]|>)[ \t\u2800]*/i.test(trimmed);
  if (isQuoteMarker) {
    return { style: 'quote', isQuote: true, isFootnote: false, isNote: false, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false };
  }

  // 6. Check for Bullet List Item (⠸⠲ in Unicode, _4 in ASCII, •, *, -)
  const bulletMatch = trimmed.match(/^([⠸_][⠲4]|•|\*|-)[ \t\u2800]+(.*)$/);
  if (bulletMatch) {
    return { style: 'list-bullet', listType: 'bullet', isList: true, isHeading: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false, marker: 'bullet', itemBraille: bulletMatch[2] };
  }

  // 7. Check for Numbered List Item (⠼[⠁-⠚]+[⠄\.] or ASCII #A. / 1. or (a) or (1))
  const numMatch = trimmed.match(/^((?:⠼[⠁-⠚]+[⠄\.]|\d+[\.\)]|\([a-zA-Z0-9]+\)))[ \t\u2800]+(.*)$/);
  if (numMatch) {
    return { style: 'list-number', listType: 'number', isList: true, isHeading: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false, marker: numMatch[1], itemBraille: numMatch[2] };
  }

  // 8. Check for TOC List Item (dot leaders ⠐⠐⠐... or """... connecting to page number)
  if (/[⠐"]{2,}[ \t\u2800]*(?:⠼?[⠁-⠚]+|\d+|[a-zA-Z0-9\-_]+)$/i.test(trimmed)) {
    return { style: 'toc', listType: 'plain', isList: true, listKind: 'toc', isHeading: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false };
  }

  // 9. Check for Centered Heading 1 (h1)
  if (leadingSpaces >= 3) {
    const expectedPad = Math.floor((lineWidth - trimmed.length) / 2);
    const rightMargin = lineWidth - (leadingSpaces + trimmed.length);
    if (Math.abs(leadingSpaces - expectedPad) <= 2 && rightMargin >= 2) {
      return { style: 'h1', headingLevel: 1, isHeading: true, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false };
    }
  }

  // 10. Check for Cell 7 Heading (h3) - 6 spaces
  if (leadingSpaces === 6) {
    return { style: 'h3', headingLevel: 3, isHeading: true, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false };
  }

  // 11. Check for Cell 5 Heading (h2) - 4 spaces
  if (leadingSpaces === 4) {
    return { style: 'h2', headingLevel: 2, isHeading: true, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false };
  }

  // 12. Check for Cell 3 Paragraph (3-1 body) - 2 spaces
  if (leadingSpaces === 2) {
    return { style: 'body', headingLevel: null, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false };
  }

  // Default: Body / Flush-Left
  return { style: 'body', headingLevel: null, isHeading: false, isList: false, isSidebar: false, isPrintPage: false, isBreak: false, isNote: false, isFootnote: false };
}

export function detectBrailleBufferChanges() {
  if (!brlInputEl) return { hasChanges: false };
  const currentVal = brlInputEl.value;
  if (currentVal === lastRenderedBrailleText) return { hasChanges: false };

  const currentLines = currentVal.split('\n');
  const oldLines = (lastRenderedBrailleText || '').split('\n');

  let startLine = 0;
  while (startLine < currentLines.length && startLine < oldLines.length && currentLines[startLine] === oldLines[startLine]) {
    startLine++;
  }

  let endLineCurrent = currentLines.length - 1;
  let endLineOld = oldLines.length - 1;
  while (endLineCurrent >= startLine && endLineOld >= startLine && currentLines[endLineCurrent] === oldLines[endLineOld]) {
    endLineCurrent--;
    endLineOld--;
  }

  let targetBlockIndex = lastTrace?.rows ? (lastTrace.rows[startLine] ?? 0) : 0;
  if (targetBlockIndex < 0 && lastTrace?.rows) {
    for (let i = startLine; i < lastTrace.rows.length; i++) {
      if (lastTrace.rows[i] >= 0) {
        targetBlockIndex = lastTrace.rows[i];
        break;
      }
    }
  }
  if (targetBlockIndex < 0) targetBlockIndex = 0;

  return {
    hasChanges: true,
    startLine,
    endLineCurrent,
    endLineOld,
    targetBlockIndex,
    changedLines: currentLines.slice(startLine, endLineCurrent + 1),
    currentLines,
    oldLines,
    currentValue: currentVal,
    previousValue: lastRenderedBrailleText,
    isAscii: !!settings?.asciiBraille,
  };
}

export function reconcileBrailleChangeToPrint() {
  if (isReconcilingBrailleToPrint) return null;
  const changes = detectBrailleBufferChanges();
  if (!changes.hasChanges) {
    if (typeof updateBrlSyncStatus === 'function') updateBrlSyncStatus('synced');
    return null;
  }

  isReconcilingBrailleToPrint = true;
  activeSyncSource = 'braille';
  if (typeof updateBrlSyncStatus === 'function') updateBrlSyncStatus('syncing');

  try {
    // 1. Gather all braille lines belonging to targetBlockIndex
    let blockBrailleLines = [];
    const blockRows = [];
    if (lastTrace?.rows) {
      for (let r = 0; r < lastTrace.rows.length; r++) {
        if (lastTrace.rows[r] === changes.targetBlockIndex) blockRows.push(r);
      }
    }

    if (blockRows.length > 0 && blockRows[0] < changes.currentLines.length) {
      const minRow = blockRows[0];
      const maxRow = blockRows[blockRows.length - 1];
      const lineDelta = changes.currentLines.length - changes.oldLines.length;
      let nextBlockRow = null;
      for (let r = maxRow + 1; r < lastTrace.rows.length; r++) {
        if (lastTrace.rows[r] > changes.targetBlockIndex) {
          nextBlockRow = r;
          break;
        }
      }
      const endSlice = nextBlockRow !== null
        ? Math.min(changes.currentLines.length, nextBlockRow + lineDelta)
        : changes.currentLines.length;
      const sliceStart = Math.min(minRow, changes.startLine);
      let sliceEnd = Math.max(sliceStart + 1, endSlice);

      const currentBlockText = changes.currentLines.slice(sliceStart, sliceEnd).join('\n');
      const markerMatch = currentBlockText.match(/\[(table|table-spatial|table-listed|sidebar|poem|stage|dialogue|quote|graphic|tactile|diagram)[^\]]*\]/i);
      if (markerMatch) {
        const tag = markerMatch[1].toLowerCase().split('-')[0];
        const closeTagRe = new RegExp(`\\[\\/${tag}[^\\]]*\\]`, 'i');
        let closeIdx = -1;
        for (let i = sliceStart; i < changes.currentLines.length; i++) {
          if (closeTagRe.test(changes.currentLines[i])) {
            closeIdx = i;
            break;
          }
        }
        if (closeIdx !== -1 && closeIdx >= sliceEnd) {
          sliceEnd = closeIdx + 1;
        }
      }

      blockBrailleLines = changes.currentLines.slice(sliceStart, sliceEnd);
    }

    if (!blockBrailleLines || blockBrailleLines.length === 0) {
      blockBrailleLines = changes.changedLines;
    }

    // 2. Detect block structural style from braille indentation & markers
    const blockStyleInfo = detectBrailleBlockStyle(blockBrailleLines, settings);

    // If target node is an existing Footnote paragraph, editing numbered text preserves footnote
    if (lastModel?.blocks?.[changes.targetBlockIndex]) {
      const tb = lastModel.blocks[changes.targetBlockIndex];
      if ((tb.type === 'footnote' || tb.style === 'footnote') && blockStyleInfo.style === 'list-number') {
        blockStyleInfo.isList = false;
        blockStyleInfo.isFootnote = true;
        blockStyleInfo.style = 'footnote';
      }
    }

    // Handle Table (Spatial Columnar or Listed Format)
    const isExistingTable = (lastModel?.blocks?.[changes.targetBlockIndex]?.type === 'table');
    if (blockStyleInfo.isTable || isExistingTable) {
      const existingHeaders = (isExistingTable && lastModel.blocks[changes.targetBlockIndex].headers)
        ? lastModel.blocks[changes.targetBlockIndex].headers
        : [];
      const parsedTable = parseBrailleTable(blockBrailleLines, settings, existingHeaders);
      const targetFormat = parsedTable.format || (blockStyleInfo.format && blockStyleInfo.format !== 'auto' ? blockStyleInfo.format : null) || 'auto';

      editor.update(() => {
        const key = lastModel?.keys ? lastModel.keys[changes.targetBlockIndex] : null;
        let targetNode = key ? $getNodeByKey(key) : null;
        if (!targetNode) {
          const root = $getRoot();
          const children = root.getChildren();
          targetNode = children[changes.targetBlockIndex] || null;
        }

        const finalHeaders = (parsedTable.headers && parsedTable.headers.length > 0)
          ? parsedTable.headers
          : (targetNode && $isTableNode(targetNode) ? targetNode.getHeaders() : existingHeaders || []);
        const finalRows = (parsedTable.rows && parsedTable.rows.length > 0)
          ? parsedTable.rows
          : (targetNode && $isTableNode(targetNode) ? targetNode.getRows() : []);
        const finalCaption = (parsedTable.caption !== undefined && parsedTable.caption !== null && parsedTable.caption !== '')
          ? parsedTable.caption
          : (targetNode && $isTableNode(targetNode) ? targetNode.getCaption() : '');
        const finalTabletn = (parsedTable.tabletn !== undefined && parsedTable.tabletn !== null && parsedTable.tabletn !== '')
          ? parsedTable.tabletn
          : (targetNode && $isTableNode(targetNode) ? targetNode.getTabletn() : '');

        const tblNode = $createTableNode(
          finalHeaders,
          finalRows,
          targetFormat,
          finalCaption,
          finalTabletn
        );
        if (targetNode) {
          targetNode.replace(tblNode);
          targetNode = tblNode;
        } else {
          $getRoot().append(tblNode);
          targetNode = tblNode;
        }
        lastModel = buildModel();
      }, { tag: 'braille-sync' });

      if (lastModel) {
        tagPrintBlocks(lastModel.keys);
        buildCellText(lastModel);
      }
      if (typeof refreshToolbar === 'function') {
        refreshToolbar(changes.targetBlockIndex);
      }

      lastRenderedBrailleText = brlInputEl ? brlInputEl.value : '';
      return { ...changes, blockStyleInfo, parsedTable };
    }

    // Handle Tactile Graphic Block
    const isExistingGraphic = (lastModel?.blocks?.[changes.targetBlockIndex]?.type === 'graphic' || lastModel?.blocks?.[changes.targetBlockIndex]?.type === 'tactile');
    if (blockStyleInfo.isGraphic || isExistingGraphic) {
      const existingNodeData = (isExistingGraphic && lastModel.blocks[changes.targetBlockIndex])
        ? lastModel.blocks[changes.targetBlockIndex]
        : {};
      const parsedGraphic = parseBrailleGraphicBlock(blockBrailleLines, settings, existingNodeData);

      editor.update(() => {
        const key = lastModel?.keys ? lastModel.keys[changes.targetBlockIndex] : null;
        let targetNode = key ? $getNodeByKey(key) : null;
        if (!targetNode) {
          const root = $getRoot();
          const children = root.getChildren();
          targetNode = children[changes.targetBlockIndex] || null;
        }

        const finalTitle = parsedGraphic.title || (targetNode && $isGraphicNode(targetNode) ? targetNode.getTitle() : 'Tactile diagram');
        const finalAlt = parsedGraphic.alt || (targetNode && $isGraphicNode(targetNode) ? targetNode.getAlt() : finalTitle);
        const finalSize = parsedGraphic.size || (targetNode && $isGraphicNode(targetNode) ? targetNode.getSize() : 'half');
        const existingSvg = (targetNode && $isGraphicNode(targetNode)) ? targetNode.getSvg() : (existingNodeData.svg || '');
        const finalSvg = existingSvg || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="380" height="280" fill="none" stroke="#000" stroke-width="3"/><circle cx="200" cy="150" r="80" fill="none" stroke="#000" stroke-width="3"/></svg>';
        const textures = (targetNode && $isGraphicNode(targetNode)) ? targetNode.getTextures() : true;
        const brailleLabels = (targetNode && $isGraphicNode(targetNode)) ? targetNode.getBrailleLabels() : true;

        const gNode = $createGraphicNode(
          finalSvg,
          finalAlt,
          finalTitle,
          textures,
          brailleLabels,
          finalSize
        );
        if (targetNode) {
          targetNode.replace(gNode);
          targetNode = gNode;
        } else {
          $getRoot().append(gNode);
          targetNode = gNode;
        }
        lastModel = buildModel();
      }, { tag: 'braille-sync' });

      if (lastModel) {
        tagPrintBlocks(lastModel.keys);
        buildCellText(lastModel);
      }
      if (typeof refreshToolbar === 'function') {
        refreshToolbar(changes.targetBlockIndex);
      }

      lastRenderedBrailleText = brlInputEl ? brlInputEl.value : '';
      return { ...changes, blockStyleInfo, parsedGraphic };
    }

    // 3. Strip leading whitespace/margins/markers and join lines into continuous braille stream
    let rawBraille = '';
    if (blockStyleInfo.isSidebar) {
      const contentLines = blockBrailleLines.filter(l => {
        const tr = l.replace(/^[ \t\u2800]+|[ \t\u2800]+$/g, '');
        return !/^[ \t\u2800⠒37⠶]{3,}$/.test(tr) && !/^([⠒3]{3,})/.test(tr);
      });
      rawBraille = contentLines.map(l => l.replace(/^[ \t\u2800]+/, '')).filter(Boolean).join(' ');
      if (!rawBraille && blockStyleInfo.title) rawBraille = blockStyleInfo.title;
    } else if (blockStyleInfo.isList && blockStyleInfo.itemBraille) {
      const rest = blockBrailleLines.slice(1);
      rawBraille = [blockStyleInfo.itemBraille, ...rest].map(l => l.replace(/^[ \t\u2800]+/, '')).filter(Boolean).join(' ');
    } else {
      rawBraille = blockBrailleLines.map(l => l.replace(/^[ \t\u2800]+/, '')).filter(Boolean).join(' ');
    }

    if (blockStyleInfo.isNote || blockStyleInfo.style === 'note') {
      rawBraille = stripTranscriberNoteIndicators(rawBraille);
    } else if (blockStyleInfo.isFootnote || blockStyleInfo.style === 'footnote') {
      rawBraille = stripFootnoteIndicators(rawBraille);
    } else if (blockStyleInfo.isStage || blockStyleInfo.style === 'stage') {
      rawBraille = stripStageIndicators(rawBraille);
    } else if (blockStyleInfo.isPoem || blockStyleInfo.style === 'poem') {
      rawBraille = stripPoemIndicators(rawBraille);
    } else if (blockStyleInfo.isDialogue || blockStyleInfo.style === 'dialogue') {
      rawBraille = stripDialogueIndicators(rawBraille);
    } else if (blockStyleInfo.isAttribution || blockStyleInfo.style === 'attribution') {
      rawBraille = stripAttributionIndicators(rawBraille);
    } else if (blockStyleInfo.isCaption || blockStyleInfo.style === 'caption') {
      rawBraille = stripCaptionIndicators(rawBraille);
    } else if (blockStyleInfo.isQuote || blockStyleInfo.style === 'quote') {
      rawBraille = stripQuoteIndicators(rawBraille);
    }

    // 4. Parse into text and math segments
    const segments = parseBrailleBlockSegments(rawBraille, settings);
    const printText = segments.map(s => s.type === 'math' ? `$${s.latex}$` : s.text).join('');

    // 5. Update the Lexical node with tagged update
    editor.update(() => {
      const key = lastModel?.keys ? lastModel.keys[changes.targetBlockIndex] : null;
      let targetNode = key ? $getNodeByKey(key) : null;
      if (!targetNode) {
        const root = $getRoot();
        const children = root.getChildren();
        targetNode = children[changes.targetBlockIndex] || null;
      }

      const appendSegments = (node) => {
        if (typeof node.getChildren === 'function') {
          node.getChildren().forEach(c => c.remove());
        }
        if (!segments || segments.length === 0) {
          node.append($createTextNode(''));
        } else {
          for (const seg of segments) {
            if (seg.type === 'math' && seg.latex) {
              node.append($createMathNode(seg.latex));
            } else if (seg.type === 'text' && seg.text) {
              const textNode = $createTextNode(seg.text);
              if (seg.tf) {
                applyEmphasis(textNode, seg.tf, seg.uncontracted);
              }
              node.append(textNode);
            }
          }
        }
      };

      if (targetNode) {
        if (blockStyleInfo.isPrintPage) {
          if ($isPrintPageNode(targetNode)) {
            targetNode.setPage(blockStyleInfo.page || '1');
          } else {
            const printPageNode = $createPrintPageNode(blockStyleInfo.page || '1');
            targetNode.replace(printPageNode);
            targetNode = printPageNode;
          }
        } else if (blockStyleInfo.isBreak) {
          if ($isBreakNode(targetNode)) {
            // Already BreakNode
          } else {
            const breakNode = $createBreakNode();
            targetNode.replace(breakNode);
            targetNode = breakNode;
          }
        } else if (blockStyleInfo.isList) {
          const listType = blockStyleInfo.listType || 'bullet';
          const listKind = blockStyleInfo.listKind || (blockStyleInfo.style !== 'list-bullet' && blockStyleInfo.style !== 'list-number' ? blockStyleInfo.style : null);
          const targetBana = (typeof targetNode.getBanaStyle === 'function' ? targetNode.getBanaStyle() : null) || targetNode.__banaStyle || null;
          if (targetBana === 'footnote' && blockStyleInfo.style === 'list-number') {
            // Target is an existing Footnote paragraph, editing numbered text preserves footnote
            appendSegments(targetNode);
          } else if ($isListNode(targetNode) && targetNode.getListType() === listType) {
            if (listKind && typeof targetNode.setListKind === 'function') {
              targetNode.setListKind(listKind);
              targetNode.setBanaStyle(listKind);
            }
            const items = targetNode.getChildren();
            let li = items[0];
            if (!li) {
              li = $createListItemNode();
              targetNode.append(li);
            }
            if (blockStyleInfo.style === 'toc' && typeof li.setBanaStyle === 'function') {
              li.setBanaStyle('toc-entry');
            }
            appendSegments(li);
          } else {
            const listNode = $createListNode(listType);
            if (listKind && typeof listNode.setListKind === 'function') {
              listNode.setListKind(listKind);
              listNode.setBanaStyle(listKind);
            }
            const li = $createListItemNode();
            if (blockStyleInfo.style === 'toc' && typeof li.setBanaStyle === 'function') {
              li.setBanaStyle('toc-entry');
            }
            appendSegments(li);
            listNode.append(li);
            targetNode.replace(listNode);
            targetNode = listNode;
          }
        } else if (blockStyleInfo.isSidebar) {
          if ($isSidebarNode(targetNode)) {
            if (blockStyleInfo.title && typeof targetNode.setTitle === 'function') {
              targetNode.setTitle(blockStyleInfo.title);
            }
            const children = targetNode.getChildren();
            let inner = children[0];
            if (!inner) {
              inner = $createParagraphNode();
              targetNode.append(inner);
            }
            appendSegments(inner);
          } else {
            const sidebarNode = $createSidebarNode(blockStyleInfo.title || '');
            const inner = $createParagraphNode();
            appendSegments(inner);
            sidebarNode.append(inner);
            targetNode.replace(sidebarNode);
            targetNode = sidebarNode;
          }
        } else if (blockStyleInfo.isHeading) {
          const headingTag = blockStyleInfo.style; // 'h1', 'h2', 'h3'
          if ($isHeadingNode(targetNode) && targetNode.getTag() === headingTag) {
            appendSegments(targetNode);
          } else {
            const headingNode = $createHeadingNode(headingTag);
            appendSegments(headingNode);
            targetNode.replace(headingNode);
            targetNode = headingNode;
          }
        } else {
          // Paragraph / Body / Note / Footnote / BANA Paragraph Styles
          const existingStyle = (typeof targetNode.getBanaStyle === 'function' ? targetNode.getBanaStyle() : null) || targetNode.__banaStyle || null;
          const effectiveStyle = blockStyleInfo.style !== 'body'
            ? blockStyleInfo.style
            : (existingStyle && existingStyle !== 'note' ? existingStyle : null);

          if ($isHeadingNode(targetNode) || $isListNode(targetNode) || $isSidebarNode(targetNode) || $isPrintPageNode(targetNode) || $isBreakNode(targetNode) || !$isParagraphNode(targetNode)) {
            const paraNode = $createBanaParagraphNode(effectiveStyle);
            appendSegments(paraNode);
            targetNode.replace(paraNode);
            targetNode = paraNode;
          } else {
            if (typeof targetNode.setBanaStyle === 'function') {
              targetNode.setBanaStyle(effectiveStyle);
            }
            appendSegments(targetNode);
          }
        }
      } else {
        const root = $getRoot();
        let newNode;
        if (blockStyleInfo.isPrintPage) {
          newNode = $createPrintPageNode(blockStyleInfo.page || '1');
        } else if (blockStyleInfo.isBreak) {
          newNode = $createBreakNode();
        } else if (blockStyleInfo.isList) {
          const listType = blockStyleInfo.listType || 'bullet';
          newNode = $createListNode(listType);
          const li = $createListItemNode();
          appendSegments(li);
          newNode.append(li);
        } else if (blockStyleInfo.isSidebar) {
          newNode = $createSidebarNode(blockStyleInfo.title || '');
          const inner = $createParagraphNode();
          appendSegments(inner);
          newNode.append(inner);
        } else if (blockStyleInfo.isHeading) {
          newNode = $createHeadingNode(blockStyleInfo.style);
          appendSegments(newNode);
        } else {
          const effectiveStyle = blockStyleInfo.style !== 'body' ? blockStyleInfo.style : null;
          newNode = $createBanaParagraphNode(effectiveStyle);
          appendSegments(newNode);
        }
        root.append(newNode);
      }
      lastModel = buildModel();
    }, { tag: 'braille-sync' });

    // 6. Keep model, toolbar, and cell text in sync
    if (lastModel) {
      tagPrintBlocks(lastModel.keys);
      buildCellText(lastModel);
    }
    if (typeof refreshToolbar === 'function') {
      refreshToolbar(changes.targetBlockIndex);
    }

    lastRenderedBrailleText = brlInputEl ? brlInputEl.value : '';
    return { ...changes, blockStyleInfo, segments, printText };
  } catch (err) {
    console.warn('reconcileBrailleChangeToPrint error:', err);
    return null;
  } finally {
    isReconcilingBrailleToPrint = false;
    activeSyncSource = null;
    if (typeof updateBrlSyncStatus === 'function') updateBrlSyncStatus('synced');
    if (typeof updateBrlPositionUI === 'function') updateBrlPositionUI();
    if (typeof runBrailleValidation === 'function') runBrailleValidation();
  }
}

export function scheduleBrailleToPrintSync(delayMs = 250) {
  if (typeof updateBrlSyncStatus === 'function') updateBrlSyncStatus('editing');
  if (brailleSyncTimer) clearTimeout(brailleSyncTimer);
  brailleSyncTimer = setTimeout(() => {
    reconcileBrailleChangeToPrint();
  }, delayMs);
}

// ---- Direct Braille & Perkins 6-Key Chord Engine on #brlInput ----
const BRL_DOTS = { KeyF: 0x01, KeyD: 0x02, KeyS: 0x04, KeyJ: 0x08, KeyK: 0x10, KeyL: 0x20 };
const BRL_CELL_REGEX = /[\u2800-\u28FF\r\n\t ]/;
function brlToCells(s) {
  if (settings?.asciiBraille) {
    let out = '';
    for (const ch of s) {
      if (ch === '\r' || ch === '\n' || ch === '\t' || ch === ' ') { out += ch; continue; }
      const cp = ch.codePointAt(0);
      if (cp >= 0x2800 && cp <= 0x28ff) {
        out += BRF64[cp & 0x3f];
      } else if (BRF64.includes(ch.toUpperCase())) {
        out += ch.toUpperCase();
      }
    }
    return out;
  }
  let out = '';
  for (const ch of s) {
    if (BRL_CELL_REGEX.test(ch)) { out += ch; continue; }
    const c = brfToUnicodeBraille(ch.toUpperCase());
    if (c && BRL_CELL_REGEX.test(c)) out += c;
  }
  return out;
}

function renderBrlInputToBraillePane() {
  if (!brailleEl || !brlInputEl) return;
  const val = brlInputEl.value;
  const brf = settings?.asciiBraille ? val : unicodeBrailleToBrf(val);
  lastBrf = brf;
  const numCells = (settings?.cells | 0) || (EMBOSSER_PRESETS[settings?.embosser]?.cells || 38);
  renderBraille(brailleEl, brf, {
    rows: lastTrace?.rows,
    rowCells: lastTrace?.rowCells,
    cells: numCells,
    asciiBraille: settings?.asciiBraille,
  });
}

const heldKeys = new Set();
let activeChord = 0;
let chordSelection = null;

// ---- Braille Slash Command Palette for #brlInput ----
export const BRL_SLASH_COMMANDS = [
  {
    id: 'slash',
    title: 'Insert "/"',
    desc: 'Type a literal slash character (Dots 3-4)',
    icon: '/',
    keywords: ['slash', '/', 'symbol', 'literal', '⠌'],
    action: () => insertBrailleTextAtCaret(settings?.asciiBraille ? '/' : '⠌'),
  },
  {
    id: 'p',
    title: 'Paragraph (3-1)',
    desc: 'Standard body paragraph (Cell 3 indent, Cell 1 runover)',
    icon: '¶',
    keywords: ['p', 'para', 'paragraph', 'body', 'text', 'standard', '3-1', '⠏'],
    action: () => {
      setBrlMarginStyle('body');
      applyBrlParagraphIndent();
    },
  },
  {
    id: 'center',
    title: 'Centered Heading',
    desc: 'Center text on current braille line',
    icon: '≡',
    keywords: ['center', 'centered', 'heading', 'h1', 'title', 'middle', '⠉'],
    action: () => {
      centerCurrentBrailleLine();
    },
  },
  {
    id: 'h2',
    title: 'Subheading (5-5)',
    desc: 'Section heading (Cell 5 indent, Cell 5 runover)',
    icon: 'H2',
    keywords: ['h2', 'subheading', 'heading 2', 'section', '5-5', '⠓'],
    action: () => {
      setBrlMarginStyle('h2');
      applyBrlHeadingIndent('h2');
    },
  },
  {
    id: 'h3',
    title: 'Minor Heading (5-5 / 7-7)',
    desc: 'Subsection heading (UKAAF 5-5 / BANA 7-7)',
    icon: 'H3',
    keywords: ['h3', 'minor', 'heading 3', 'subsection', '7-7', '5-5'],
    action: () => {
      setBrlMarginStyle('h3');
      applyBrlHeadingIndent('h3');
    },
  },
  {
    id: 'list',
    title: 'List Item (1-3)',
    desc: 'List item (Cell 1 first line, Cell 3 runover)',
    icon: '•',
    keywords: ['list', 'ul', 'bullet', 'item', '1-3', '⠇'],
    action: () => {
      setBrlMarginStyle('list-bullet');
    },
  },
  {
    id: 'ex',
    title: 'Exercise Question (1-5)',
    desc: 'Numbered exercise (Cell 1 question, Cell 5 runover)',
    icon: '❓',
    keywords: ['exercise', 'ex', 'question', 'problem', '1-5', '⠑'],
    action: () => {
      setBrlMarginStyle('exercise');
    },
  },
  {
    id: 'box',
    title: 'Boxline Container',
    desc: 'Full-width decorative border boxline',
    icon: '📦',
    keywords: ['box', 'boxline', 'border', 'container', 'line', 'divider', '⠃'],
    action: () => {
      insertBrlBoxline();
    },
  },
  {
    id: 'page',
    title: 'Page Break',
    desc: 'Insert braille page break (form feed)',
    icon: '📄',
    keywords: ['page', 'break', 'formfeed', 'pagebreak', 'new page', '⠏'],
    action: () => {
      insertBrailleTextAtCaret('\f\n');
    },
  },
  {
    id: 'graphic',
    title: 'Tactile Graphic',
    desc: 'Insert a tactile graphic diagram block',
    icon: '📊',
    keywords: ['graphic', 'diagram', 'tactile', 'image', 'figure', 'chart', 'plot', '⠙', '⠛'],
    action: () => {
      insertBrailleTextAtCaret('[Tactile graphic: Diagram]\n');
    },
  },
  {
    id: 'tn',
    title: "Transcriber's Note (7-5)",
    desc: "Transcriber's note with BANA/UKAAF indicators",
    icon: '📋',
    keywords: ['tn', 'transcriber', 'note', 'comment', '7-5', '⠞'],
    action: () => {
      insertBrlTranscribersNote();
    },
  },
  {
    id: 'brf',
    title: 'Toggle BRF / Unicode',
    desc: 'Switch between Unicode Braille and BRF ASCII display',
    icon: '🔤',
    keywords: ['brf', 'ascii', 'unicode', 'view', 'display', 'mode', '⠃'],
    action: () => {
      toggleBrlAscii();
    },
  },
  {
    id: '6key',
    title: 'Toggle Perkins 6-Key',
    desc: 'Switch Perkins 6-key chording (S D F J K L) on/off',
    icon: '⠼',
    keywords: ['6key', 'sixkey', 'perkins', 'chord', 'chording', 'keyboard', '⠋'],
    action: () => {
      toggleBrlSixKey();
    },
  },
  {
    id: 'ins',
    title: 'Toggle Insert / Overwrite',
    desc: 'Switch between Insert (INS) and Overwrite (OVR) typing mode',
    icon: '⇄',
    keywords: ['ins', 'ovr', 'insert', 'overwrite', 'mode', 'typeover', '⠊'],
    action: () => {
      toggleBrlInsertMode();
    },
  },
];

export function insertBrailleTextAtCaret(text) {
  if (!brlInputEl) return;
  const selA = brlInputEl.selectionStart;
  const selB = brlInputEl.selectionEnd;
  brlInputEl.setRangeText(text, selA, selB, 'end');
  brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  onBrlInputCaretMove();
}

export function applyBrlParagraphIndent() {
  if (!brlInputEl) return;
  const pos = brlInputEl.selectionStart;
  const val = brlInputEl.value;
  const lineStart = val.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  let lineEnd = val.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = val.length;
  const lineText = val.slice(lineStart, lineEnd);
  if (/^\s*$/.test(lineText)) {
    const indent = getMarginIndent('body', true);
    brlInputEl.value = val.slice(0, lineStart) + indent + val.slice(lineEnd);
    const newPos = lineStart + indent.length;
    brlInputEl.setSelectionRange(newPos, newPos);
    brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
    onBrlInputCaretMove();
  }
}

export function applyBrlHeadingIndent(styleId) {
  if (!brlInputEl) return;
  const pos = brlInputEl.selectionStart;
  const val = brlInputEl.value;
  const lineStart = val.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  let lineEnd = val.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = val.length;
  const lineText = val.slice(lineStart, lineEnd);
  if (/^\s*$/.test(lineText)) {
    const indent = getMarginIndent(styleId, true);
    brlInputEl.value = val.slice(0, lineStart) + indent + val.slice(lineEnd);
    const newPos = lineStart + indent.length;
    brlInputEl.setSelectionRange(newPos, newPos);
    brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
    onBrlInputCaretMove();
  }
}

export function insertBrlBoxline() {
  if (!brlInputEl) return;
  const numCells = (settings?.cells | 0) || (EMBOSSER_PRESETS[settings?.embosser]?.cells || 38);
  const isAscii = settings?.asciiBraille;
  const cellChar = isAscii ? '-' : '⠒';
  const boxline = cellChar.repeat(numCells) + '\n';
  insertBrailleTextAtCaret(boxline);
}

export function insertBrlTranscribersNote() {
  if (!brlInputEl) return;
  setBrlMarginStyle('note');
  const isAscii = settings?.asciiBraille;
  const prefix = '      ' + (isAscii ? '__ ' : '⠸⠸ ');
  const suffix = (isAscii ? " _'" : ' ⠸⠄') + '\n';
  const selA = brlInputEl.selectionStart;
  const selB = brlInputEl.selectionEnd;
  const insertion = prefix + suffix;
  brlInputEl.setRangeText(insertion, selA, selB, 'preserve');
  const midPos = selA + prefix.length;
  brlInputEl.setSelectionRange(midPos, midPos);
  brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  onBrlInputCaretMove();
}

let isBrlSlashMenuOpen = false;
let brlSlashFilteredCommands = [];
let brlSlashSelectedIndex = 0;
let brlSlashActiveQuery = '';

export function isBrlSlashOpen() {
  return isBrlSlashMenuOpen;
}

export function initBrlSlashMenu() {
  const menuEl = $id('brlSlashMenu');
  const listEl = $id('brlSlashList');
  if (!menuEl || !listEl || !brlInputEl) return;

  function hideSlashMenu() {
    isBrlSlashMenuOpen = false;
    menuEl.hidden = true;
    menuEl.style.display = 'none';
    brlSlashActiveQuery = '';
    brlSlashFilteredCommands = [];
    brlSlashSelectedIndex = 0;
  }

  function showSlashMenu() {
    isBrlSlashMenuOpen = true;
    menuEl.hidden = false;
    menuEl.style.display = 'block';
  }

  function renderSlashList() {
    listEl.innerHTML = '';
    brlSlashFilteredCommands.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.className = 'slash-item';
      item.role = 'option';
      item.id = `brl-slash-opt-${cmd.id}`;
      item.setAttribute('aria-selected', String(idx === brlSlashSelectedIndex));

      const ico = document.createElement('span');
      ico.className = 'slash-ico';
      ico.textContent = cmd.icon;

      const info = document.createElement('div');
      info.className = 'slash-info';

      const title = document.createElement('span');
      title.className = 'slash-title';
      title.textContent = cmd.title;

      const desc = document.createElement('span');
      desc.className = 'slash-desc';
      desc.textContent = cmd.desc;

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

    const activeItem = listEl.children[brlSlashSelectedIndex];
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
      menuEl.setAttribute('aria-activedescendant', activeItem.id);
    }
  }

  function updateSlashQuery(rawQuery) {
    brlSlashActiveQuery = (rawQuery || '').trim();
    const qAscii = unicodeBrailleToBrf(brlSlashActiveQuery).toLowerCase().trim();
    const qUni = brfToUnicodeBraille(brlSlashActiveQuery).trim();

    if (!qAscii && !qUni) {
      brlSlashFilteredCommands = BRL_SLASH_COMMANDS.slice();
    } else {
      const scored = [];
      for (const cmd of BRL_SLASH_COMMANDS) {
        let score = 0;
        const idLower = cmd.id.toLowerCase();
        const titleLower = cmd.title.toLowerCase();
        const words = titleLower.split(/[\s\(\)\/\-]+/).filter(Boolean);
        const kwList = cmd.keywords.map((k) => k.toLowerCase());

        if (idLower === qAscii || (qUni && cmd.keywords.includes(qUni))) {
          score += 100;
        } else if (kwList.includes(qAscii)) {
          score += 80;
        } else if (idLower.startsWith(qAscii)) {
          score += 60;
        } else if (qAscii.length > 1 && words.some((w) => w === qAscii)) {
          score += 50;
        } else if (qAscii.length > 1 && words.some((w) => w.startsWith(qAscii))) {
          score += 40;
        } else if (qAscii.length > 1 && kwList.some((k) => k.startsWith(qAscii))) {
          score += 30;
        } else if (qAscii.length > 1 && titleLower.includes(qAscii)) {
          score += 10;
        } else if (qAscii.length > 1 && kwList.some((k) => k.includes(qAscii))) {
          score += 5;
        }

        if (score > 0) {
          scored.push({ cmd, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      brlSlashFilteredCommands = scored.map((s) => s.cmd);
    }

    if (!brlSlashFilteredCommands.length) {
      hideSlashMenu();
      return;
    }

    brlSlashSelectedIndex = 0;
    renderSlashList();
    showSlashMenu();
    const cur = brlSlashFilteredCommands[0];
    if (cur) announce(`${cur.title}, ${cur.desc} (1 of ${brlSlashFilteredCommands.length})`);
  }

  function positionSlashMenu() {
    if (!brlInputEl || !menuEl) return;
    const pos = brlInputEl.selectionStart;
    const val = brlInputEl.value;
    const linesBefore = val.slice(0, pos).split('\n');
    const rowIndex = linesBefore.length - 1;
    const colIndex = linesBefore[linesBefore.length - 1].length;

    const pane = brlInputEl.closest('.pane');
    if (!pane) return;
    const paneRect = pane.getBoundingClientRect();
    const rows = brailleEl ? Array.from(brailleEl.querySelectorAll('.brl-row')) : [];
    const cellRow = rows[rowIndex];

    const menuHeight = 280;
    const menuWidth = 280;

    let targetTop = 100;
    let targetLeft = 20;

    if (cellRow) {
      const rowRect = cellRow.getBoundingClientRect();
      const cells = Array.from(cellRow.querySelectorAll('.bcell'));
      const activeCell = cells[colIndex] || cells[colIndex - 1];

      if (activeCell) {
        const cellRect = activeCell.getBoundingClientRect();
        targetTop = cellRect.bottom - paneRect.top + 6;
        targetLeft = cellRect.left - paneRect.left;
      } else {
        const cellWidth = 12.6;
        targetTop = rowRect.bottom - paneRect.top + 6;
        targetLeft = (rowRect.left - paneRect.left) + (colIndex * cellWidth);
      }

      const spaceBelow = paneRect.bottom - (rowRect.bottom || rowRect.top);
      if (spaceBelow < menuHeight && (rowRect.top - paneRect.top) > menuHeight) {
        targetTop = Math.max(10, rowRect.top - paneRect.top - menuHeight - 6);
      }
    } else {
      const inputRect = brlInputEl.getBoundingClientRect();
      targetTop = inputRect.top - paneRect.top + 40;
      targetLeft = inputRect.left - paneRect.left + 20;
    }

    const maxLeft = Math.max(10, paneRect.width - menuWidth - 10);
    const left = Math.min(Math.max(10, targetLeft), maxLeft);
    const top = Math.max(10, targetTop);

    menuEl.style.top = `${top}px`;
    menuEl.style.left = `${left}px`;
  }

  function removeSlashQueryText(activeQueryLen) {
    if (!brlInputEl) return;
    try {
      const pos = brlInputEl.selectionStart;
      const totalToRemove = activeQueryLen + 1;
      const start = Math.max(0, pos - totalToRemove);
      brlInputEl.setRangeText('', start, pos, 'end');
      brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
      onBrlInputCaretMove();
    } catch (e) {
      console.warn('removeBrlSlashQueryText safely recovered:', e);
    }
  }

  function executeCommand(cmd) {
    if (!cmd || typeof cmd.action !== 'function') {
      hideSlashMenu();
      return;
    }
    removeSlashQueryText(brlSlashActiveQuery.length);
    hideSlashMenu();
    setTimeout(() => {
      try {
        cmd.action();
        announce(`Applied ${cmd.title}`);
      } catch (err) {
        console.warn(`Safe recovery: Braille slash command "${cmd.title}" encountered an error:`, err);
      }
    }, 10);
  }

  function checkBrlSlashTrigger() {
    if (!brlInputEl) return;
    const pos = brlInputEl.selectionStart;
    const val = brlInputEl.value;
    const beforeCaret = val.slice(0, pos);
    const match = beforeCaret.match(/(?:^|\s)([\/⠌])([a-zA-Z0-9\u2800-\u28FF]*)$/);
    if (match) {
      updateSlashQuery(match[2]);
      positionSlashMenu();
      return;
    }
    hideSlashMenu();
  }

  window.checkBrlSlashTrigger = checkBrlSlashTrigger;
  window.hideBrlSlashMenu = hideSlashMenu;
  window.showBrlSlashMenu = showSlashMenu;
  window.executeBrlSlashCommand = executeCommand;
  window.isBrlSlashMenuOpen = () => isBrlSlashMenuOpen;
  window.getBrlSlashFilteredCommands = () => brlSlashFilteredCommands;
  window.getBrlSlashSelectedIndex = () => brlSlashSelectedIndex;

  document.addEventListener('mousedown', (e) => {
    if (isBrlSlashMenuOpen && !menuEl.contains(e.target) && e.target !== brlInputEl) {
      hideSlashMenu();
    }
  });
}

if (typeof window !== 'undefined') {
  window.BRL_SLASH_COMMANDS = BRL_SLASH_COMMANDS;
  window.initBrlSlashMenu = initBrlSlashMenu;
}

if (brlInputEl) {
  brlInputEl.addEventListener('click', () => {
    onBrlInputCaretMove();
    if (typeof window.checkBrlSlashTrigger === 'function') window.checkBrlSlashTrigger();
  });

  brlInputEl.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Handle Slash Menu Navigation & Actions if menu is open
    if (isBrlSlashMenuOpen && brlSlashFilteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        brlSlashSelectedIndex = (brlSlashSelectedIndex + 1) % brlSlashFilteredCommands.length;
        const menuEl = $id('brlSlashMenu');
        const listEl = $id('brlSlashList');
        if (listEl) {
          Array.from(listEl.children).forEach((child, idx) => {
            child.setAttribute('aria-selected', String(idx === brlSlashSelectedIndex));
          });
          const activeItem = listEl.children[brlSlashSelectedIndex];
          if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest' });
            if (menuEl) menuEl.setAttribute('aria-activedescendant', activeItem.id);
          }
        }
        const cur = brlSlashFilteredCommands[brlSlashSelectedIndex];
        if (cur) announce(`${cur.title}, ${cur.desc} (${brlSlashSelectedIndex + 1} of ${brlSlashFilteredCommands.length})`);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        brlSlashSelectedIndex = (brlSlashSelectedIndex - 1 + brlSlashFilteredCommands.length) % brlSlashFilteredCommands.length;
        const menuEl = $id('brlSlashMenu');
        const listEl = $id('brlSlashList');
        if (listEl) {
          Array.from(listEl.children).forEach((child, idx) => {
            child.setAttribute('aria-selected', String(idx === brlSlashSelectedIndex));
          });
          const activeItem = listEl.children[brlSlashSelectedIndex];
          if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest' });
            if (menuEl) menuEl.setAttribute('aria-activedescendant', activeItem.id);
          }
        }
        const cur = brlSlashFilteredCommands[brlSlashSelectedIndex];
        if (cur) announce(`${cur.title}, ${cur.desc} (${brlSlashSelectedIndex + 1} of ${brlSlashFilteredCommands.length})`);
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = brlSlashFilteredCommands[brlSlashSelectedIndex];
        if (cmd) {
          if (typeof window.executeBrlSlashCommand === 'function') window.executeBrlSlashCommand(cmd);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof window.hideBrlSlashMenu === 'function') window.hideBrlSlashMenu();
        announce('Braille command menu closed');
        return;
      }
    }

    // Enter key with BANA margin auto-indentation:
    if (e.key === 'Enter') {
      e.preventDefault();
      const activeStyle = getBrlActiveStyle();
      const isFirstLine = !e.shiftKey;
      let indent = '';
      if (activeStyle === 'h1') {
        brlActiveMarginStyle = 'body';
        if ($id('selBrlMargin')) $id('selBrlMargin').value = 'body';
        indent = getBanaMarginIndent('body', true);
      } else {
        indent = getBanaMarginIndent(activeStyle, isFirstLine);
      }
      const insertion = '\n' + indent;
      const selA = brlInputEl.selectionStart;
      const selB = brlInputEl.selectionEnd;
      brlInputEl.setRangeText(insertion, selA, selB, 'end');
      brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
      onBrlInputCaretMove();
      return;
    }

    const isSixKey = settings?.sixKeyInput !== false && settings?.sixKey !== false;
    
    // Universal Overwrite mode handling for direct (non-chord) keystrokes:
    if (brlOverwriteMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && e.key !== 'Enter') {
      const bit = isSixKey ? BRL_DOTS[e.code] : null;
      if (!bit) {
        const selA = brlInputEl.selectionStart;
        const selB = brlInputEl.selectionEnd;
        if (selA === selB && selA < brlInputEl.value.length && brlInputEl.value.charAt(selA) !== '\n') {
          brlInputEl.setSelectionRange(selA, selA + 1);
        }
      }
    }

    if (isSixKey) {
      const bit = BRL_DOTS[e.code];
      if (bit) {
        e.preventDefault();
        if (heldKeys.size === 0) {
          chordSelection = { a: brlInputEl.selectionStart, b: brlInputEl.selectionEnd };
          activeChord = 0;
        }
        heldKeys.add(e.code);
        activeChord |= bit;
        return;
      }

      // Six-key exclusivity guard:
      // When six-key is ON, printable keys other than chord keys (S D F J K L)
      // are swallowed so accidental QWERTY keystrokes don't corrupt the braille buffer,
      // EXCEPT for Space, Slash (/), and direct Unicode Braille cells (from refreshable braille displays / IMEs).
      // Also allow alphanumeric keys when the slash menu is open so users can type query filters.
      if (!isBrlSlashMenuOpen && e.key.length === 1 && e.key !== ' ' && e.key !== '/' && !(e.key.charCodeAt(0) >= 0x2800 && e.key.charCodeAt(0) <= 0x28FF)) {
        e.preventDefault();
        return;
      }
    }
  });

  brlInputEl.addEventListener('keyup', (e) => {
    const bit = BRL_DOTS[e.code];
    if (bit) {
      e.preventDefault();
      heldKeys.delete(e.code);

      if (heldKeys.size === 0 && activeChord > 0) {
        const brailleChar = settings?.asciiBraille
          ? (BRF64[activeChord & 0x3F] || ' ')
          : String.fromCodePoint(0x2800 + (activeChord & 0x3F));
        const selA = chordSelection ? chordSelection.a : brlInputEl.selectionStart;
        const selB = chordSelection ? chordSelection.b : brlInputEl.selectionEnd;
        chordSelection = null;
        activeChord = 0;

        const isOvr = brlOverwriteMode && selA === selB && selA < brlInputEl.value.length && brlInputEl.value.charAt(selA) !== '\n';
        const replaceEnd = isOvr ? selA + 1 : selB;

        brlInputEl.setRangeText(brailleChar, selA, replaceEnd, 'end');
        brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
        onBrlInputCaretMove();
        if (typeof window.checkBrlSlashTrigger === 'function') window.checkBrlSlashTrigger();
      }
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      onBrlInputCaretMove();
      if (!isBrlSlashMenuOpen && typeof window.checkBrlSlashTrigger === 'function') {
        window.checkBrlSlashTrigger();
      }
    }
  });

  brlInputEl.addEventListener('input', () => {
    const rawVal = brlInputEl.value;
    const converted = brlToCells(rawVal);
    if (converted !== rawVal) {
      const selStart = brlInputEl.selectionStart;
      const prefix = brlToCells(rawVal.slice(0, selStart));
      brlInputEl.value = converted;
      brlInputEl.setSelectionRange(prefix.length, prefix.length);
    }
    applyBrlWordWrap(brlInputEl);
    renderBrlInputToBraillePane();
    onBrlInputCaretMove();
    runBrailleValidation();
    if (typeof window.checkBrlSlashTrigger === 'function') window.checkBrlSlashTrigger();
    scheduleBrailleToPrintSync();
  });

  brlInputEl.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') ?? '';
    if (!text) return;
    const converted = brlToCells(text);
    if (converted) {
      e.preventDefault();
      const selA = brlInputEl.selectionStart;
      const selB = brlInputEl.selectionEnd;
      brlInputEl.setRangeText(converted, selA, selB, 'end');
      brlInputEl.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof window.checkBrlSlashTrigger === 'function') window.checkBrlSlashTrigger();
    }
  });

  brlInputEl.addEventListener('blur', () => {
    heldKeys.clear();
    activeChord = 0;
    chordSelection = null;
  });

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === brlInputEl) {
      onBrlInputCaretMove();
    }
  });

  $id('btnBrlSixKey')?.addEventListener('click', () => toggleBrlSixKey());
  $id('btnBrlAscii')?.addEventListener('click', () => toggleBrlAscii());
  $id('btnBrlInsertMode')?.addEventListener('click', () => toggleBrlInsertMode());
  $id('btnBrlCenter')?.addEventListener('click', () => centerCurrentBrailleLine());
  $id('brlValidationBadge')?.addEventListener('click', () => jumpToBrailleIssue());
  $id('selBrlMargin')?.addEventListener('change', (e) => {
    const val = e.target.value;
    brlActiveMarginStyle = val;
    if (val === 'h1' || val === 'center') {
      centerCurrentBrailleLine();
    }
    announce(`Braille margin preset set to ${e.target.options[e.target.selectedIndex]?.text || val}.`);
  });

  // Initialize UI states
  $id('btnBrlSixKey')?.setAttribute('aria-pressed', String(settings?.sixKeyInput !== false));
  updateBrlAsciiUI();
  updateBrlInsertModeUI();
  updateBrlPositionUI();
  updateBrlSyncStatus('synced');
  runBrailleValidation();
}
function handleMathFieldSelect(mf) {
  if (!mf) return false;
  try { if (typeof mf.focus === 'function' && document.activeElement !== mf) mf.focus(); } catch {}
  const be = mf.closest('[data-block-idx]');
  if (!be) return false;
  const block = Number(be.dataset.blockIdx);
  const li = mf.closest('li');
  let unit = 0, unitEl = be;
  if (li && be.contains(li)) { unit = Math.max(0, [...be.querySelectorAll('li')].indexOf(li)); unitEl = li; }
  const b = lastModel?.blocks?.[block];
  let segs = b?.segments;
  if (b?.type === 'list') segs = b?.items?.[unit]?.segments;
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
  return true;
}

// click a print word or math equation → highlight its braille cells
editorEl.addEventListener('click', (e) => {
  const mf = e.target.closest('math-field') || e.target.closest('.math-embed')?.querySelector('math-field') || (e.composedPath && e.composedPath().find(el => el.tagName === 'MATH-FIELD'));
  if (mf && handleMathFieldSelect(mf)) return;

  const be = e.target.closest('[data-block-idx]');
  if (!be) return;
  const block = Number(be.dataset.blockIdx);
  const li = e.target.closest('li');
  let unit = 0, unitEl = be;
  if (li && be.contains(li)) { unit = Math.max(0, [...be.querySelectorAll('li')].indexOf(li)); unitEl = li; }
  const text = cellText[`${block}:${unit}`];
  if (text == null || !text.trim()) {
    clearWordLink();
    linkByBlock(block);
    return;
  }

  const [s, en] = wordRangeAt(text, caretOffsetInEl(unitEl, e));
  highlightWord(block, unit, s, en, caretOffsetInEl(unitEl, e), 'editor');
  showRuleInfo(text.slice(s, en));
});

editorEl.addEventListener('focusin', (e) => {
  const mf = e.target.closest('math-field') || e.target.closest('.math-embed')?.querySelector('math-field') || (e.composedPath && e.composedPath().find(el => el.tagName === 'MATH-FIELD'));
  if (mf) handleMathFieldSelect(mf);
});

// ---- Table of Contents print preview in editor (Expandable / Collapsible) ----
let isTocBoxCollapsed = localStorage.getItem('emboss-toc-box-collapsed') === 'true';

function updatePrintToc() {
  const container = $id('printTocContainer');
  if (!container) return;
  if (!settings.toc) {
    container.innerHTML = '';
    return;
  }
  const headings = [];
  (lastModel?.blocks || []).forEach((b, idx) => {
    if (b.type === 'heading' && b.text) headings.push({ text: b.text, level: b.level || 1, blockIdx: idx });
  });
  if (!headings.length) {
    container.innerHTML = '';
    return;
  }

  const countText = `${headings.length} section${headings.length === 1 ? '' : 's'}`;
  const toggleLabel = isTocBoxCollapsed ? 'Expand ▾' : 'Shrink ▴';
  const ariaExpanded = !isTocBoxCollapsed;

  container.innerHTML = `
    <div class="print-toc-box ${isTocBoxCollapsed ? 'collapsed' : ''}" id="printTocBox">
      <div class="print-toc-head" id="printTocHead" role="button" tabindex="0" aria-expanded="${ariaExpanded}" aria-controls="printTocList" title="${isTocBoxCollapsed ? 'Expand Table of Contents' : 'Shrink Table of Contents'}">
        <h3>📑 Table of Contents <span class="print-toc-count">(${countText})</span></h3>
        <button type="button" class="print-toc-toggle-btn" id="printTocToggleBtn" aria-label="${isTocBoxCollapsed ? 'Expand Table of Contents' : 'Shrink Table of Contents'}">${toggleLabel}</button>
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
        linkByBlock(bIdx);
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

function syncCaretWithBraille() {
  if (caretSyncTimer) cancelAnimationFrame(caretSyncTimer);
  caretSyncTimer = requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && (active.tagName === 'MATH-FIELD' || active.closest?.('math-field'))) {
      const mf = active.tagName === 'MATH-FIELD' ? active : active.closest('math-field');
      handleMathFieldSelect(mf);
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
    const start = targetChild || (node.nodeType === 1 ? node : node.parentElement);
    const mf = start && (start.closest?.('math-field') || start.closest?.('.math-embed')?.querySelector('math-field') || (start.classList?.contains('math-embed') ? start.querySelector('math-field') : null) || (start.tagName === 'MATH-FIELD' ? start : null));
    if (mf) {
      handleMathFieldSelect(mf);
      return;
    }
    const be = start && start.closest('[data-block-idx]');
    if (!be) return;
    const block = Number(be.dataset.blockIdx);
    const li = start.closest('li');
    let unit = 0, unitEl = be;
    if (li && be.contains(li)) { unit = Math.max(0, [...be.querySelectorAll('li')].indexOf(li)); unitEl = li; }
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
  });
}

function describeCaretWord() {
  const sel = window.getSelection();
  const node = sel && sel.anchorNode;
  const start = node && (node.nodeType === 1 ? node : node.parentElement);
  const be = start && start.closest('[data-block-idx]');
  if (!be) { announce('Place the caret in the text first.'); return; }
  const block = Number(be.dataset.blockIdx);
  const li = start.closest('li');
  let unit = 0, unitEl = be;
  if (li && be.contains(li)) { unit = Math.max(0, [...be.querySelectorAll('li')].indexOf(li)); unitEl = li; }
  const text = cellText[`${block}:${unit}`];
  if (text == null) { announce('No braille mapping for this line.'); return; }
  const [s, en] = wordRangeAt(text, domOffsetInEl(unitEl, node, sel.anchorOffset));
  highlightWord(block, unit, s, en, null, 'caret');
  showRuleInfo(text.slice(s, en));
  announce(lastRuleSpoken || text.slice(s, en));
}

// ---- transparency: hovering a braille line shows the text it came from ----
function blockDisplayText(b) {
  if (!b) return '';
  if (b.type === 'heading') return b.text || '';
  if (b.type === 'indicator') return '* * *';
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
          const cacheKey = `${entry.text}|${table}`;
          let res = proofreadCache.get(cacheKey);
          if (!res) {
            const tr = makeTranslators(louis, table);
            res = roundTrip(entry.text, (s) => tr.translate(s), (s) => tr.backTranslate(s));
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
        setProofBadge('warn', `⚠ ${issues.length} to review`, `${issues.length} word discrepancy(s) found during round-trip back-translation. Click to jump to the first.`);
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
  if (want && settings.sixKeyInput === false) { announce('SDF JKL braille input is turned off in Settings.'); return; }
  sixKeyOn = want;
  $id('btnSixKey')?.setAttribute('aria-pressed', String(sixKeyOn));
  const perkinsHeaderBtn = $id('btnPerkinsHeader');
  if (perkinsHeaderBtn) {
    perkinsHeaderBtn.setAttribute('aria-pressed', String(sixKeyOn));
    if (sixKeyOn) perkinsHeaderBtn.classList.add('active');
    else perkinsHeaderBtn.classList.remove('active');
  }
  skHeld.clear(); skChord = 0;
  if (sixKeyOn) { skUpdatePending(); editorEl.focus(); announce('Braille direct input on. Type chords with S D F and J K L.'); }
  else { skUpdatePending(); announce('Braille direct input off.'); }
}
// Screen reader mode: braille pane is real cells for a display (see renderBraille),
// and six-key input is hidden + disabled (it fights a display user's own braille input).
// `on` = six-key (S D F / J K L) braille entry is available. Turned off, the button is
// hidden and any active six-key session ends — a braille-display user entering braille on
// their own device does not want the editor grabbing those keys.
function applySixKeyInput(on) {
  const btn = $id('btnSixKey'); if (btn) btn.style.display = on ? '' : 'none';
  const headerBtn = $id('btnPerkinsHeader'); if (headerBtn) headerBtn.style.display = on ? '' : 'none';
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
$id('btnPerkinsHeader')?.addEventListener('click', () => toggleSixKey());

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '6' || e.code === 'Digit6')) {
    e.preventDefault();
    toggleSixKey();
  }
});

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
  const mf = editorEl.querySelectorAll(`[data-block-idx="${item.blockIdx}"] math-field`)[item.mathIndex || 0];
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
  onStuck: () => { announce('Read-aloud could not start — your browser’s speech engine may be stuck. Try fully quitting and reopening the browser.'); setStatus('Read-aloud did not start (browser speech engine stuck — restart the browser).'); },
});
// play / pause / resume + stop, with the play arrow, pause bars, and a stop square
function updateReadButtons() {                       // one button: ▶ play (from caret) ⇄ ⏹ stop
  const r = $id('btnRead'); if (!r) return;
  if (reader.speaking) {
    r.innerHTML = '⏹ <span class="btn-lbl">Stop</span>';
    r.setAttribute('aria-pressed', 'true');
    r.title = 'Stop reading';
  } else {
    r.innerHTML = '▶ <span class="btn-lbl">Read</span>';
    r.setAttribute('aria-pressed', 'false');
    r.title = 'Read aloud, starting at the caret';
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
    } else if ($isSidebarNode(top)) {
      let childOfSidebar = anchorNode;
      while (childOfSidebar && childOfSidebar.getParent && childOfSidebar.getParent().getKey() !== top.getKey()) {
        childOfSidebar = childOfSidebar.getParent();
      }
      if (childOfSidebar) {
        let cnt = 0;
        for (const k of top.getChildren()) {
          if (k.getKey() === childOfSidebar.getKey()) { unit = cnt; container = k; break; }
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
  if (!speechAvailable()) { announce('Text-to-speech is not available in this browser.'); return; }
  const model = editor.getEditorState().read(buildModel);
  const all = buildSpokenItems(model, mathSpeech);
  // Play (no arg) → from the caret word; double-click a braille line → from that block.
  const pos = (fromBlock != null) ? { block: fromBlock, unit: 0, offset: 0 } : caretPos();
  let items = sliceItemsFrom(all, pos);
  // Caret past the last word (nothing after it) → read its block from the start, so Play
  // always does something instead of announcing "Nothing to read".
  if (!items.length && all.length) items = sliceItemsFrom(all, { block: pos.block, unit: 0, offset: 0 });
  if (!items.length) { announce('Nothing to read.'); return; }
  reader.rate = Number(settings.ttsRate) || 1;
  reader.voice = pickVoice(settings.ttsVoice);
  announce('Reading aloud.');
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
    o.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
    sel.appendChild(o);
  });

  if (!voicesExpanded && restVoices.length) {
    const o = document.createElement('option'); o.value = '__more_voices__'; o.textContent = `… more voices (${restVoices.length})`; sel.appendChild(o);
  }
  if (!noveltyExpanded && novelty.length) {
    const o = document.createElement('option'); o.value = '__novelty_voices__'; o.textContent = `… novelty voices (${novelty.length})`; sel.appendChild(o);
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
function initToolbar() {
  const toolbar = $id('toolbar');
  const items = () => [...toolbar.querySelectorAll('[data-tb]')];
  items().forEach((el, i) => { el.tabIndex = i === 0 ? 0 : -1; });
  toolbar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = items(); const cur = list.indexOf(document.activeElement);
    if (cur < 0) return;
    e.preventDefault();
    const next = (cur + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    list[cur].tabIndex = -1; list[next].tabIndex = 0; list[next].focus();
  });
}

// ---- BANA style cycling & keyboard navigation ----
const BANA_STYLE_CYCLE_ORDER = [
  'p', 'h1', 'h2', 'h3', 'bullet', 'number', 'toc',
  'dialogue', 'stage', 'poem', 'exercise', 'caption',
  'footnote', 'note', 'quote'
];

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;

  // Alt+S: Focus Block Style dropdown
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    const sel = $id('blockStyle');
    if (sel) {
      sel.focus();
      if (typeof sel.showPicker === 'function') {
        try { sel.showPicker(); } catch (_) {}
      }
    }
    return;
  }

  // Alt+ArrowUp / Alt+ArrowDown: Cycle block styles on active paragraph/element
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const isEditorActive = editorEl?.contains(document.activeElement) ||
      document.activeElement === $id('blockStyle') ||
      document.activeElement === $id('styleInspector');
    if (isEditorActive) {
      e.preventDefault();
      const currentVal = $id('blockStyle')?.value || 'p';
      const curIdx = BANA_STYLE_CYCLE_ORDER.indexOf(currentVal);
      const idx = curIdx >= 0 ? curIdx : 0;
      const step = (e.key === 'ArrowDown') ? 1 : -1;
      const nextIdx = (idx + step + BANA_STYLE_CYCLE_ORDER.length) % BANA_STYLE_CYCLE_ORDER.length;
      const nextStyle = BANA_STYLE_CYCLE_ORDER[nextIdx];
      setBlockStyle(nextStyle);
      const profile = settings?.mode || 'bana';
      const badgeText = typeof formatStyleInspectorBadge === 'function'
        ? formatStyleInspectorBadge(nextStyle, profile)
        : `Style: ${nextStyle}`;
      announce(`Changed style to ${badgeText}`);
    }
  }
});

$id('styleInspector')?.addEventListener('click', () => {
  const sel = $id('blockStyle');
  if (sel) {
    sel.focus();
    if (typeof sel.showPicker === 'function') {
      try { sel.showPicker(); } catch (_) {}
    }
  }
});
$id('styleInspector')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $id('blockStyle')?.focus();
  }
});

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
  announce(`Formula and Equation Templates dialog opened. ${total} formulas available. Type to search, pick a category, or press Down Arrow to browse.`);
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
    allBtn.textContent = 'All';
    allBtn.setAttribute('aria-pressed', String(activeCat === null));
    allBtn.setAttribute('aria-label', 'All categories');
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
      btn.textContent = c.label;
      btn.setAttribute('aria-pressed', String(isActive));
      btn.setAttribute('aria-label', `${c.label} category`);
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
      empty.textContent = 'No matching formulas found in library.';
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
      announce(`${count} formula${count === 1 ? '' : 's'} matching search`);
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
          announce(`${filtered[0].name}. ${speech}. Option 1 of ${filtered.length}`);
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
        announce(`${curItem.name}. ${speech}. Option ${next + 1} of ${items.length}`);
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
        announce(`${curItem.name}. ${speech}. Option ${prev + 1} of ${items.length}`);
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
    allBtn.textContent = 'All';
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
      btn.textContent = c.name;
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
      empty.textContent = 'No matching diagrams found.';
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

    announce(`Plotted tactile graph for ${latex}`);
    ding();
  } catch (err) {
    console.error('Plot error:', err);
    announce(`Could not plot function: ${err.message}`);
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

  announce(`Inserted tactile diagram: ${meta.title || meta.alt || 'Graphic'}`);
  ding();
}
window.insertGraphicDiagram = insertGraphicDiagram;
window.plotAndInsertGraph = plotAndInsertGraph;

function insertSidebar(title = '') {
  editor.update(() => {
    const sidebar = $createSidebarNode(title);
    if (title) {
      const h = $createHeadingNode('h2');
      h.append($createTextNode(title));
      sidebar.append(h);
    }
    const p = $createParagraphNode();
    sidebar.append(p);
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      $insertNodeToNearestRoot(sidebar);
    } else {
      $getRoot().append(sidebar);
    }
    p.select();
  });
  announce('Inserted sidebar box');
}
function insertTable(cols = 3, rows = 3, format = 'auto') {
  editor.update(() => {
    const headers = Array.from({ length: cols }, (_, i) => `Col ${i + 1}`);
    const tableRows = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
    const table = $createTableNode(headers, tableRows, format);
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      $insertNodeToNearestRoot(table);
    } else {
      $getRoot().append(table);
    }
  });
  announce('Inserted table');
}
window.insertSidebar = insertSidebar;
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
  { id: 'toc', title: 'TOC Entry', desc: 'Table of Contents entry with dot leaders (1-3)', icon: '📑', keywords: ['toc', 'table of contents', 'contents', 'index', 'dot leaders', 'leader'], action: () => setBlockStyle('toc') },
  { id: 'dialogue', title: 'Play Dialogue', desc: 'Prose drama dialogue speaker line (1-3)', icon: '🎭', keywords: ['dialogue', 'play', 'drama', 'speaker', 'character', 'line', 'script', 'speech'], action: () => setBlockStyle('dialogue') },
  { id: 'stage', title: 'Stage Direction', desc: 'Drama stage direction indented (7-7)', icon: '🎬', keywords: ['stage', 'direction', 'play', 'drama', 'setting', 'action', 'parenthetical'], action: () => setBlockStyle('stage') },
  { id: 'poem', title: 'Poetry / Verse', desc: 'Poetic stanza verse line (1-3)', icon: '📜', keywords: ['poem', 'poetry', 'verse', 'stanza', 'rhyme', 'lines', 'lyric'], action: () => setBlockStyle('poem') },
  { id: 'exercise', title: 'Exercise Question', desc: 'Numbered exercise question (1-5 / 3-5)', icon: '❓', keywords: ['exercise', 'question', 'problem', 'homework', 'task', 'exam', 'quiz', 'subquestion'], action: () => setBlockStyle('exercise') },
  { id: 'caption', title: 'Caption / Attribution', desc: 'Figure caption or attribution (7-5)', icon: '💬', keywords: ['caption', 'attribution', 'photo', 'figure', 'image', 'label', 'credit'], action: () => setBlockStyle('caption') },
  { id: 'footnote', title: 'Footnote', desc: 'Footnote note text (1-3)', icon: '📝', keywords: ['footnote', 'note', 'reference', 'citation', 'annotation', 'fn'], action: () => setBlockStyle('footnote') },
  { id: 'note', title: "Transcriber's Note", desc: "Transcriber's note with BANA indicators (7-5)", icon: '📋', keywords: ['note', 'transcriber', 'transcriber note', 'tn', 'prodnote', 'comment', 'remark'], action: () => setBlockStyle('note') },
  { id: 'quote', title: 'Blockquote', desc: 'Indented quotation block (3-1)', icon: '“', keywords: ['quote', 'blockquote', 'quotation', 'citation', 'excerpt', 'indent'], action: () => setBlockStyle('quote') },
  { id: 'sidebar', title: 'Sidebar Box', desc: 'Container card with BANA boxlines', icon: '📦', keywords: ['sidebar', 'box', 'callout', 'aside', 'container', 'panel', 'boxline'], action: () => insertSidebar() },
  { id: 'table', title: 'Spatial Braille Table', desc: 'Insert 3×3 columnar data table', icon: '📊', keywords: ['table', 'grid', 'column', 'row', 'spatial', 'data'], action: () => insertTable(3, 3, 'spatial') },
  { id: 'listedtable', title: 'BANA Listed Table', desc: 'Insert structured listed table (Header: Value)', icon: '📋', keywords: ['listedtable', 'listed', 'table', 'bana', 'data', 'card', 'key value', 'key-value'], action: () => insertTable(3, 3, 'listed') },
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
window.SLASH_COMMANDS = SLASH_COMMANDS;

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
      title.textContent = cmd.title;

      const desc = document.createElement('span');
      desc.className = 'slash-desc';
      desc.textContent = cmd.desc;

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
    if (cur) announce(`${cur.title}, ${cur.desc} (1 of ${filteredCommands.length})`);
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
        announce(`Applied ${cmd.title}`);
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
      if (cur) announce(`${cur.title}, ${cur.desc} (${selectedIndex + 1} of ${filteredCommands.length})`);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
      renderSlashList();
      const cur = filteredCommands[selectedIndex];
      if (cur) announce(`${cur.title}, ${cur.desc} (${selectedIndex + 1} of ${filteredCommands.length})`);
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
      announce('Menu closed');
      return;
    }
  }, true);
}

// ---- Markdown Shortcut Triggers (Auto-formatting on Line-Start Input) ----
function applyMarkdownShortcut(node) {
  if (!$isParagraphNode(node)) return null;
  const firstChild = node.getFirstChild();
  if (!$isTextNode(firstChild)) return null;

  const text = firstChild.getTextContent();

  // 1. Heading 1-3: # , ## , ### 
  const headingMatch = text.match(/^(#{1,3})\s(.*)$/s);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const tag = `h${level}`;
    const restText = headingMatch[2];
    const heading = $createHeadingNode(tag);
    if (restText) heading.append($createTextNode(restText));
    node.replace(heading);
    return { type: 'heading', level, node: heading };
  }

  // 2. Blockquote: > 
  const quoteMatch = text.match(/^>\s(.*)$/s);
  if (quoteMatch) {
    const restText = quoteMatch[1];
    const p = $createParagraphNode();
    p.setBanaStyle('quote');
    if (restText) p.append($createTextNode(restText));
    node.replace(p);
    return { type: 'quote', node: p };
  }

  // 3. Bullet list: * , - , + 
  const bulletMatch = text.match(/^([*\-+])\s(.*)$/s);
  if (bulletMatch) {
    const restText = bulletMatch[2];
    const list = $createListNode('bullet');
    const li = $createListItemNode();
    if (restText) li.append($createTextNode(restText));
    list.append(li);
    node.replace(list);
    return { type: 'list-bullet', node: list };
  }

  // 4. Numbered list: 1. , 1) 
  const numberMatch = text.match(/^1[.)]\s(.*)$/s);
  if (numberMatch) {
    const restText = numberMatch[1];
    const list = $createListNode('number');
    const li = $createListItemNode();
    if (restText) li.append($createTextNode(restText));
    list.append(li);
    node.replace(list);
    return { type: 'list-number', node: list };
  }

  // 5. Exercise question: Q1. , Ex1. 
  const exMatch = text.match(/^(?:Q\d+|Ex\d*|Exercise\s*\d*)[.)]\s(.*)$/is);
  if (exMatch) {
    const restText = exMatch[1];
    const list = $createListNode('number');
    list.setListKind('exercise');
    list.setBanaStyle('exercise');
    const li = $createListItemNode();
    if (restText) li.append($createTextNode(restText));
    list.append(li);
    node.replace(list);
    return { type: 'exercise', node: list };
  }

  // 6. Transcriber's Note: [TN , [tn , [TN: , [tn: , @.< 
  const tnMatch = text.match(/^(?:\[tn:?|\[transcriber(?:'s)?\s*note:?|@\.<)\s*(.*?)(?:\]|@\.>)?$/is);
  if (tnMatch) {
    const restText = tnMatch[1];
    const p = $createBanaParagraphNode('note');
    if (restText) p.append($createTextNode(restText));
    node.replace(p);
    return { type: 'note', node: p };
  }

  // 7. Horizontal Divider Break: ---, ***, ___
  const hrMatch = text.match(/^(\-{3,}|\*{3,}|_{3,})$/);
  if (hrMatch) {
    const brk = $createBreakNode();
    const nextP = $createParagraphNode();
    node.replace(brk);
    brk.insertAfter(nextP);
    return { type: 'break', node: brk, nextNode: nextP };
  }

  // 8. Drama Dialogue: Speaker name with colon (e.g. HAMLET: or DOCTOR:)
  const dialogueMatch = text.match(/^([A-Z][A-Z0-9_\s]{1,20}):\s(.*)$/s);
  if (dialogueMatch && !node.getBanaStyle()) {
    node.setBanaStyle('dialogue');
    return { type: 'dialogue', node };
  }

  return null;
}
window.applyMarkdownShortcut = applyMarkdownShortcut;

function initMarkdownShortcuts() {
  editor.registerUpdateListener(() => {
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
      const anchor = sel.anchor;
      const node = anchor.getNode();
      if (!$isTextNode(node)) return;

      const parent = node.getParent();
      if (!parent || !$isParagraphNode(parent)) return;
      if (parent.getFirstChild() !== node) return;

      const text = node.getTextContent();
      const offset = anchor.offset;
      const textBefore = text.slice(0, offset);

      const isTrigger = /^(?:#{1,3}|>|[*\-+]|1[.)]|\[tn:?|@\.<)\s$/i.test(textBefore) ||
                        /^(?:Q\d+|Ex\d*|Exercise\s*\d*)[.)]\s$/i.test(textBefore) ||
                        /^(\-{3,}|\*{3,}|_{3,})$/.test(textBefore) ||
                        /^([A-Z][A-Z0-9_\s]{1,20}):\s$/.test(textBefore);

      if (!isTrigger) return;

      setTimeout(() => {
        try {
          editor.update(() => {
            const currentSel = $getSelection();
            if (!$isRangeSelection(currentSel)) return;
            const currentAnchor = currentSel.anchor;
            const currentNode = currentAnchor.getNode();
            const currentParent = currentNode?.getParent();
            if (!currentParent || !$isParagraphNode(currentParent)) return;

            const res = applyMarkdownShortcut(currentParent);
            if (res) {
              if (res.node && typeof res.node.select === 'function') {
                res.node.select(0, 0);
              } else if (res.nextNode) {
                res.nextNode.select();
              }
              announce(`Converted to ${res.type}`);
            }
          });
        } catch (e) {
          console.warn('Markdown shortcut safe recovery:', e);
        }
      }, 0);
    });
  });
}

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
  });
}

// ---- drag-and-drop import (parse a document into the editor) ----
// Reuses the converter's parsers (parseFile → the same block model the formatter
// eats) and rebuilds it as Lexical nodes. Structure + inline maths from LaTeX
// sources import fully; docx/OMML equations (MathML, no LaTeX) come in as a marker.
function applyEmphasis(node, tf, uncontracted = false) {
  if (tf & TF.bold) node.toggleFormat('bold');
  if (tf & TF.italic) node.toggleFormat('italic');
  if (tf & TF.underline) node.toggleFormat('underline');
  if (uncontracted) node.toggleFormat('code');
  return node;
}
function fillFromBlock(parent, b) {
  if (b.segments) {
    for (const s of b.segments) {
      if (s.type === 'math') { if (s.latex) parent.append($createMathNode(s.latex)); else if (s.mathml) parent.append($createTextNode('⟨equation⟩')); }
      else if (s.text) parent.append(applyEmphasis($createTextNode(s.text), s.tf || 0, s.uncontracted));
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
  if (it.text) return { ...it, text: it.text.replace(LEADING_BULLET_RE, '') };
  if (it.segments && it.segments.length > 0) {
    const first = it.segments[0];
    if (first.text) {
      const newFirst = { ...first, text: first.text.replace(LEADING_BULLET_RE, '') };
      return { ...it, segments: [newFirst, ...it.segments.slice(1)] };
    }
  }
  return it;
}

function getBlockBanaStyle(b) {
  if (!b) return null;
  if (b.style) return b.style;
  if (b.type === 'note' || b.kind === 'tabletn' || b.kind === 'image') return 'note';
  if (b.type === 'caption') return 'caption';
  if (b.type === 'footnote') return 'footnote';
  if (b.type === 'attribution') return 'attribution';
  if (b.type === 'stage') return 'stage';
  if (b.type === 'play') return b.subtype === 'verse' ? 'poem' : 'dialogue';
  return null;
}

function createListFromBlock(b) {
  const kind = b.kind || b.style || null;
  const isToc = kind === 'toc';
  const isPlain = kind === 'plain' || kind === 'index' || isToc;
  const isExercise = kind === 'exercise';
  const isOrdered = b.ordered || (b.items && b.items.some((it) => it.marker));

  let listType = 'bullet';
  if (isPlain) listType = 'plain';
  else if (isExercise || isOrdered) listType = 'number';

  const list = $createListNode(listType);
  if (kind) {
    if (typeof list.setListKind === 'function') list.setListKind(kind);
    if (typeof list.setBanaStyle === 'function') list.setBanaStyle(kind);
  }

  for (const it of (b.items || [])) {
    const li = $createListItemNode();
    if (isToc) {
      li.setBanaStyle('toc-entry');
    } else if (isExercise) {
      li.setBanaStyle(it.level && it.level > 0 ? 'exercise-sub' : 'exercise');
    } else if (it.style) {
      li.setBanaStyle(it.style);
    }
    if (it.page && typeof li.setPage === 'function') {
      li.setPage(it.page);
    }
    if (it.level != null) {
      if (typeof li.setLevel === 'function') li.setLevel(it.level);
      else if (typeof li.setIndent === 'function') li.setIndent(it.level);
    }
    if (it.marker && typeof li.setValue === 'function') {
      const mNum = parseInt(it.marker, 10);
      if (!isNaN(mNum)) li.setValue(mNum);
    }

    const cleanItem = stripLeadingListBullet(it);
    fillFromBlock(li, cleanItem);
    if (li.getChildrenSize()) list.append(li);
  }
  return list;
}

function modelToLexical(model) {
  window.modelToLexical = modelToLexical;
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const blocks = Array.isArray(model) ? model : (model?.blocks || []);
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'heading' || b.type === 'title') {
        const lvl = b.type === 'title' ? 1 : Math.min(3, b.level || 1);
        const h = $createHeadingNode('h' + lvl);
        fillFromBlock(h, b);
        root.append(h);
      } else if (b.type === 'list') {
        const list = createListFromBlock(b);
        if (list.getChildrenSize()) root.append(list);
      } else if (b.type === 'indicator') {
        root.append($createBreakNode());
      } else if (b.type === 'pagenum') {
        root.append($createPrintPageNode(b.page || b.text || '1'));
      } else if (b.type === 'graphic') {
        if (b.svg) {
          const transpiled = transpileTactileSvg(b.svg, { brailleCode: settings.brailleCode });
          root.append($createGraphicNode(transpiled.svg || b.svg, b.alt || 'Tactile diagram', b.title || b.alt || 'Tactile diagram', true, true, b.size || 'half'));
        } else {
          const p = $createBanaParagraphNode(null);
          p.append($createTextNode(`[Tactile graphic: ${b.alt || 'Diagram'}]`));
          root.append(p);
        }
      } else if (b.type === 'box' || b.type === 'sidebar') {
        const sidebar = $createSidebarNode(b.title || '');
        let titleBlockHandled = false;
        if (Array.isArray(b.blocks) && b.blocks.length > 0) {
          for (let i = 0; i < b.blocks.length; i++) {
            const cb = b.blocks[i];
            if (i === 0 && (cb.type === 'heading' || cb.type === 'title')) {
              const h = $createHeadingNode('h' + Math.min(3, cb.level || 2));
              fillFromBlock(h, cb);
              sidebar.append(h);
              titleBlockHandled = true;
            } else if (cb.type === 'heading' || cb.type === 'title') {
              const h = $createHeadingNode('h' + Math.min(3, cb.level || 2));
              fillFromBlock(h, cb);
              sidebar.append(h);
            } else if (cb.type === 'list') {
              const list = createListFromBlock(cb);
              if (list.getChildrenSize()) sidebar.append(list);
            } else if (cb.type === 'table') {
              const fmt = cb.format || (cb.style === 'table-listed' ? 'listed' : (cb.style === 'table-spatial' ? 'spatial' : 'auto'));
              sidebar.append($createTableNode(cb.headers || [], cb.rows || [], fmt, cb.caption || cb.title || '', cb.tabletn || ''));
            } else if (cb.type === 'graphic') {
              if (cb.svg) {
                const transpiled = transpileTactileSvg(cb.svg, { brailleCode: settings.brailleCode });
                sidebar.append($createGraphicNode(transpiled.svg || cb.svg, cb.alt || 'Tactile diagram', cb.title || cb.alt || 'Tactile diagram', true, true, cb.size || 'half'));
              } else {
                const p = $createBanaParagraphNode(null);
                p.append($createTextNode(`[Tactile graphic: ${cb.alt || 'Diagram'}]`));
                sidebar.append(p);
              }
            } else {
              const style = getBlockBanaStyle(cb);
              const p = $createBanaParagraphNode(style);
              fillFromBlock(p, cb);
              if (p.getChildrenSize()) sidebar.append(p);
            }
          }
        }
        if (!titleBlockHandled && b.title) {
          const h = $createHeadingNode('h2');
          h.append($createTextNode(b.title));
          sidebar.append(h);
        }
        if (!b.blocks?.length && b.text) {
          const style = getBlockBanaStyle(b);
          const p = $createBanaParagraphNode(style);
          fillFromBlock(p, b);
          if (p.getChildrenSize()) sidebar.append(p);
        }
        if (sidebar.getChildrenSize()) root.append(sidebar);
      } else if (b.type === 'table') {
        const fmt = b.format || (b.style === 'table-listed' ? 'listed' : (b.style === 'table-spatial' ? 'spatial' : 'auto'));
        root.append($createTableNode(b.headers || [], b.rows || [], fmt, b.caption || b.title || '', b.tabletn || ''));
      } else if (b.type === 'math') {
        const p = $createBanaParagraphNode(null); if (b.latex) p.append($createMathNode(b.latex)); else p.append($createTextNode('⟨equation⟩')); root.append(p);
      } else {
        const style = getBlockBanaStyle(b);
        const p = $createBanaParagraphNode(style);
        fillFromBlock(p, b);
        root.append(p);
      }
    }
    if (!root.getFirstChild()) root.append($createBanaParagraphNode(null));
  });
}
window.modelToLexical = modelToLexical;
window.render = render;
let importing = false;
async function importFile(file) {
  if (importing) return;                             // a second drop while one is still parsing would clobber it
  importing = true;
  try {
    if (reader.speaking) reader.stop();
    hideParseWarning();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    setStatus(`Importing ${file.name}…`);
    if (ext === 'svg') {
      const svgText = await file.text();
      insertGraphicDiagram(svgText, { title: file.name.replace(/\.svg$/i, '') });
      announce(`Imported tactile SVG: ${file.name}`);
      return;
    }
    const payload = BINARY_EXTS.has(ext) ? await file.arrayBuffer() : await file.text();
    const model = await parseFile(file.name, payload);
    if (!model || !(model.blocks || []).length) throw new Error('No readable content found in this file');
    modelToLexical(model);
    announce(`Imported ${file.name}.`);
    if (model.warnings && model.warnings.length) {
      showParseWarning(`Notice: ${model.warnings.join('; ')}`);
    }
  } catch (err) {
    console.error(err);
    const msg = String((err && err.message) || err);
    setStatus('Import notice: ' + msg);
    showParseWarning(`Could not fully parse structure for "${file.name}": ${msg}. You can continue editing or typing below.`);
    announce('Import notice: ' + msg);
  } finally {
    importing = false;
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

  const uiLoc = (settings.uiLanguage || (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en').split('-');
  const sysLang = (uiLoc[0] || 'en').toLowerCase();

  // Rank:
  // 0-4: Up to 5 recently chosen codes (PINNED AT THE VERY TOP!)
  // 10: Current UI / system locale language codes (if different from en, es, fr)
  // 11: English language codes ('en')
  // 12: Spanish language codes ('es')
  // 13: French language codes ('fr')
  // 20: All other languages
  const rank = (c) => {
    const idx = topCodes.indexOf(c.id);
    if (idx !== -1) return idx;
    if (c.lang === sysLang && sysLang !== 'en' && sysLang !== 'es' && sysLang !== 'fr') return 10;
    if (c.lang === 'en') return 11;
    if (c.lang === 'es') return 12;
    if (c.lang === 'fr') return 13;
    return 20;
  };

  const near = CODES.filter((c) => rank(c) < 20);
  const base = codesExpanded || !near.length ? CODES : near;

  // Sort by rank first (Top 5 & Local top & en/es/fr), then alphabetically by Display Name
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
    sel.appendChild(new Option(c.shipped !== false ? label : `${label} (needs internet first time)`, c.id));
  }
  if (!codesExpanded && restCount > 0) {
    sel.appendChild(new Option(`… more languages (${restCount})`, '__more__'));
  }
  if (inUseCode && CODES.some((c) => c.id === inUseCode)) {
    sel.value = inUseCode;
  } else if (sel.options.length) {
    sel.value = sel.options[0].value;
  }
}

// ---- Braille View / DotPad Tab Management & Emulator ----
let currentBrailleTab = 'braille';
let dotpadInvertDisplay = false;

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
  const typeLabel = isGraphic ? 'Tactile Graphic' : 'Text Stream';
  const subtitle = `Page ${activeFrame.pageNumber || 1} of ${activeFrame.totalPages || 1} (${typeLabel})`;

  if ($id('dotpadPanelSubtitle')) $id('dotpadPanelSubtitle').textContent = subtitle;
}

function switchBrailleTab(tab) {
  currentBrailleTab = tab;
  programmaticScrollUntil = performance.now() + 1000;
  cancelScrollSync();
  const tabViewBraille = $id('tabViewBraille');
  const tabViewDotPad = $id('tabViewDotPad');
  const braillePane = $id('braille');
  const brlStack = $id('brlStack');
  const brlToolbar = $id('brailleToolbar');
  const dotpadPanel = $id('dotpadPanel');

  if (tab === 'dotpad') {
    tabViewDotPad?.classList.add('active');
    tabViewDotPad?.setAttribute('aria-selected', 'true');
    tabViewBraille?.classList.remove('active');
    tabViewBraille?.setAttribute('aria-selected', 'false');
    if (brlToolbar) brlToolbar.style.display = 'none';
    if (brlStack) brlStack.style.display = 'none';
    if (braillePane) {
      braillePane._savedScrollTop = braillePane.scrollTop;
      braillePane.style.display = 'none';
    }
    if (dotpadPanel) {
      dotpadPanel.style.display = 'flex';
      drawDotPadEmulator(typeof tactileDisplay !== 'undefined' ? tactileDisplay.getDotPadActiveFrame() : null);
    }
  } else {
    tabViewBraille?.classList.add('active');
    tabViewBraille?.setAttribute('aria-selected', 'true');
    tabViewDotPad?.classList.remove('active');
    tabViewDotPad?.setAttribute('aria-selected', 'false');
    if (brlToolbar) brlToolbar.style.display = 'inline-flex';
    if (brlStack) brlStack.style.display = '';
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
    if (dotpadPanel) dotpadPanel.style.display = 'none';
  }
}

export function updateBrailleTabsVisibility(autoSwitch = false) {
  const embosserVal = $id('set-embosser')?.value || settings.embosser;
  const isConn = (typeof tactileDisplay !== 'undefined') && tactileDisplay.isConnected && tactileDisplay.isConnected();
  const isDotPad = (embosserVal === 'dotpad') || (settings.embosser === 'dotpad') || isConn;
  const tabViewDotPad = $id('tabViewDotPad');
  if (tabViewDotPad) {
    tabViewDotPad.style.display = isDotPad ? 'inline-flex' : 'none';
  }
  if (autoSwitch) {
    if (isDotPad) {
      switchBrailleTab('dotpad');
    } else {
      switchBrailleTab('braille');
    }
  } else if (!isDotPad && currentBrailleTab === 'dotpad') {
    switchBrailleTab('braille');
  }
}

// ---- settings dialog, Simple-mode switch, BRF download (shared settings) ----
function applySettingsToUI(autoSwitch = false) {
  $id('tocToggle').checked = !!settings.toc;
  populateUiLanguageDropdown();
  for (const k of ['embosser', 'tableFormat', 'quoteStyle', 'listStyle', 'paragraphStyle', 'connectionType']) if ($id('set-' + k)) $id('set-' + k).value = settings[k] || (k === 'embosser' ? 'generic' : (k === 'tableFormat' ? 'auto' : (k === 'paragraphStyle' ? 'indented' : (k === 'connectionType' ? 'serial' : ''))));
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

  const conn = settings.connectionType || 'serial';
  if ($id('networkSettingsGroup')) $id('networkSettingsGroup').style.display = conn === 'network' ? 'block' : 'none';
  if ($id('serialBaudGroup')) $id('serialBaudGroup').style.display = conn === 'serial' ? 'block' : 'none';
  if ($id('bleSettingsGroup')) $id('bleSettingsGroup').style.display = conn === 'ble' ? 'block' : 'none';
  if ($id('hidSettingsGroup')) $id('hidSettingsGroup').style.display = conn === 'hid' ? 'block' : 'none';
  updateGraphicsSupportUI();
  updateBrailleTabsVisibility(autoSwitch);
  updateBrlMarginDropdownUI();
  updateBrlAsciiUI();
}

export function updateGraphicsSupportUI() {
  const btn = $id('btnGraphic');
  if (btn) {
    btn.disabled = false;
    btn.title = 'Insert Tactile Graphic Diagram (/graphic)';
    btn.style.opacity = '';
    btn.style.cursor = 'pointer';
  }
}

function wireControls() {
  $id('backToSimple')?.addEventListener('click', () => { saveSettings({ simpleMode: true }); location.href = '/web/index.html'; });
  $id('settingsBtn')?.addEventListener('click', () => {
    cancelScrollSync();
    applySettingsToUI();
    $id('settingsDialog')?.showModal();
  });
  $id('settingsDialog')?.addEventListener('close', () => {
    cancelScrollSync();
    updateGraphicsSupportUI();
    render();
  });
  $id('helpBtn')?.addEventListener('click', () => {
    cancelScrollSync();
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
    const conn = $id('set-connectionType').value;
    if ($id('networkSettingsGroup')) $id('networkSettingsGroup').style.display = conn === 'network' ? 'block' : 'none';
    if ($id('serialBaudGroup')) $id('serialBaudGroup').style.display = conn === 'serial' ? 'block' : 'none';
    if ($id('bleSettingsGroup')) $id('bleSettingsGroup').style.display = conn === 'ble' ? 'block' : 'none';
    if ($id('hidSettingsGroup')) $id('hidSettingsGroup').style.display = conn === 'hid' ? 'block' : 'none';
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
  $id('set-uiLanguage')?.addEventListener('change', async (e) => {
    const newLang = e.target.value;
    settings = saveSettings({ uiLanguage: newLang });
    await setLocale(newLang);
    populateUiLanguageDropdown();
    populateLanguageDropdown();
    announce(t('aria.language_changed', { language: newLang }));
  });
  $id('set-tactileGraphics')?.addEventListener('change', onSet);
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
    const msg = `🔌 Detected ${profile.name} — configured to ${profile.presets.cells}×${profile.presets.lines} at ${profile.presets.baudRate || 9600} baud.`;
    setStatus(msg);
    announce(msg);
  }, () => {
    setStatus('Embosser disconnected.');
    announce('Embosser disconnected.');
  });

  const handleEmbossPrint = async () => {
    if (!lastBrf) return;

    const conn = settings.connectionType || 'serial';
    try {
      const modeLabel = conn === 'ble' ? 'Bluetooth' : (conn === 'hid' ? 'USB HID' : (conn === 'network' ? 'Network' : 'USB Serial'));
      announce(`Connecting to ${modeLabel} embosser…`);
      setStatus(`Connecting to ${modeLabel} embosser…`);

      const res = await spoolToEmbosser(lastBrf, {
        connectionType: conn,
        embosser: settings.embosser || 'generic',
        duplex: settings.embosserDuplex || 'double',
        width: settings.cells || 38,
        depth: settings.lines || 25,
        baudRate: settings.baudRate || 9600,
        networkHost: settings.networkHost || '192.168.1.150',
        networkPort: settings.networkPort || 9100,
        onStatus: (msg) => { setStatus(msg); announce(msg); },
      });

      if (res.success) {
        setStatus(res.message);
        announce(res.message);
      } else if (res.method === 'cancelled') {
        setStatus('Embosser selection cancelled.');
        announce('Embosser selection cancelled.');
      } else if (res.message) {
        setStatus(res.message);
        announce(res.message);
      }
    } catch (err) {
      console.warn('Embosser hardware communication error:', err);
      setStatus(`Embosser error: ${err.message}`);
      announce(`Embosser error: ${err.message}`);
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
      lbl.textContent = `Monarch (${(p - 1) * 10 + 1}-${p * 10})`;
    }
  });
  $id('tactileNextBtn')?.addEventListener('click', () => {
    tactileDisplay.nextPage();
    const lbl = $id('tactileDisplayLbl');
    if (lbl) {
      const p = (typeof tactileDisplay.getCurrentPage === 'function') ? tactileDisplay.getCurrentPage() : 2;
      lbl.textContent = `Monarch (${(p - 1) * 10 + 1}-${p * 10})`;
    }
  });

  const tabViewBraille = $id('tabViewBraille');
  const tabViewDotPad = $id('tabViewDotPad');
  const braillePane = $id('braille');
  const dotpadPanel = $id('dotpadPanel');

  tabViewBraille?.addEventListener('click', () => switchBrailleTab('braille'));
  tabViewDotPad?.addEventListener('click', () => switchBrailleTab('dotpad'));

  // Hardware button handlers
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
    announce('DotPad display refreshed.');
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
      const frame = data?.activeFrame || tactileDisplay.getDotPadActiveFrame();
      drawDotPadEmulator(frame);
    }
    if (event === 'connect') {
      scheduleRender();
    }
  });

  btnConnectTactile?.addEventListener('click', async () => {
    if (tactileConnStatus) tactileConnStatus.textContent = 'Scanning Bluetooth LE devices...';
    const res = await tactileDisplay.connect({ transport: 'bluetooth', target: 'dotpad' });
    if (!res.success) {
      if (tactileConnStatus) tactileConnStatus.textContent = res.error || 'Connection cancelled';
    } else {
      announce(`Connected to ${res.name}`);
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
    if (tactileConnStatus) tactileConnStatus.textContent = 'Scanning USB / HID tactile displays...';
    const res = await tactileDisplay.connect({ transport: 'hid', target: 'monarch' });
    if (!res.success) {
      if (tactileConnStatus) tactileConnStatus.textContent = res.error || 'Connection cancelled';
    } else {
      announce(`Connected to ${res.name}`);
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
    announce('Disconnected tactile display.');
    updateTactileDisplayUI();
  });

  btnSimulateTactile?.addEventListener('click', async () => {
    await tactileDisplay.connect({ transport: 'simulated', target: 'monarch' });
    announce('Connected to Simulated Monarch (32x10).');
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
    announce('Connected to Simulated DotPad (30x10 + 20 Braille).');
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
      announce(`Auto-reconnected to ${res.name}`);
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
  const historyStack = [];
  let historyIndex = -1;
  let isHistoryUpdating = false;

  function recordHistoryState(description = 'edit') {
    if (isHistoryUpdating) return;
    try {
      const editorState = editor.getEditorState();
      const json = editorState.toJSON();
      if (historyIndex < historyStack.length - 1) {
        historyStack.splice(historyIndex + 1);
      }
      const last = historyStack[historyStack.length - 1];
      if (last && JSON.stringify(last.state) === JSON.stringify(json)) return;
      historyStack.push({ state: json, desc: description });
      if (historyStack.length > 80) historyStack.shift();
      else historyIndex = historyStack.length - 1;
      updateUndoRedoUI();
    } catch (e) {
      console.warn('recordHistoryState recovery:', e);
    }
  }

  function updateUndoRedoUI() {
    const btnUndo = $id('btnUndo');
    const btnRedo = $id('btnRedo');
    if (btnUndo) {
      btnUndo.disabled = historyIndex <= 0;
      btnUndo.style.opacity = historyIndex <= 0 ? '0.45' : '1';
    }
    if (btnRedo) {
      btnRedo.disabled = historyIndex >= historyStack.length - 1;
      btnRedo.style.opacity = historyIndex >= historyStack.length - 1 ? '0.45' : '1';
    }
  }

  function performUndo() {
    if (historyIndex > 0) {
      historyIndex--;
      const item = historyStack[historyIndex];
      if (item && item.state) {
        isHistoryUpdating = true;
        try {
          const state = editor.parseEditorState(item.state);
          editor.setEditorState(state);
          announce(`Undo applied`);
          setStatus(`Undo applied (${item.desc || 'change'}).`);
          ding();
        } finally {
          isHistoryUpdating = false;
          updateUndoRedoUI();
        }
      }
    } else {
      announce('Nothing to undo');
    }
  }

  function performRedo() {
    if (historyIndex < historyStack.length - 1) {
      historyIndex++;
      const item = historyStack[historyIndex];
      if (item && item.state) {
        isHistoryUpdating = true;
        try {
          const state = editor.parseEditorState(item.state);
          editor.setEditorState(state);
          announce(`Redo applied`);
          setStatus(`Redo applied (${item.desc || 'change'}).`);
          ding();
        } finally {
          isHistoryUpdating = false;
          updateUndoRedoUI();
        }
      }
    } else {
      announce('Nothing to redo');
    }
  }

  $id('btnUndo')?.addEventListener('click', () => performUndo());
  $id('btnRedo')?.addEventListener('click', () => performRedo());

  $id('btnClear')?.addEventListener('click', () => {
    recordHistoryState('before clear');
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      root.append(p);
    });
    recordHistoryState('clear');
    announce('Document cleared. Click Undo or press Ctrl+Z to restore.');
    setStatus('Document cleared. Click Undo or press Ctrl+Z to restore.');
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
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'MATH-FIELD' || (t.closest && t.closest('math-field, dialog[open]')));
    if (inField) return;
    if (mod && !e.altKey) {
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportTextDocument('xml');
        return;
      } else if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault();
        performRedo();
      }
    }
  });

  editor.registerUpdateListener(() => {
    recordHistoryState('typing');
  });

  // ---- Save / Export Text Document ----
  function exportTextDocument(format = 'xml') {
    const title = (lastModel?.title || 'document').trim();
    const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
    if (format === 'xml' || format === 'nimas') {
      let currentDocModel = null;
      editor.getEditorState().read(() => {
        currentDocModel = buildModel();
      });
      const doc = currentDocModel || lastModel || { title, blocks: [] };
      const xmlString = exportToNimasXml(doc, { title: doc.title || title });
      saveBlob(new Blob([xmlString], { type: 'application/xml;charset=utf-8' }), `${baseName}.xml`);
      announce(`Saved ${baseName}.xml`);
      setStatus(`Saved ${baseName}.xml NIMAS project document.`);
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
      announce(`Saved ${baseName}.json`);
      setStatus(`Exported ${baseName}.json native document.`);
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
            lines.push(`| ${headers.join(' | ')} |`);
            lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
          }
          for (const row of rows) {
            lines.push(`| ${(row || []).join(' | ')} |`);
          }
          lines.push('');
        } else if (b.type === 'indicator') {           // buildModel emits 'indicator' for a section break
          lines.push('* * *\n');
        } else if (b.type === 'note') {
          lines.push(`> ${b.text || ''}\n`);
        } else if (b.type === 'footnote') {
          lines.push(`[^fn]: ${b.text || ''}\n`);
        } else if (b.type === 'stage' || b.style === 'stage') {
          lines.push(`*(${b.text || ''})*\n`);
        } else if (b.type === 'caption' || b.style === 'caption') {
          lines.push(`*${b.text || ''}*\n`);
        } else if (b.type === 'attribution' || b.style === 'attribution') {
          lines.push(`— *${b.text || ''}*\n`);
        } else if (b.type === 'play' || b.style === 'dialogue' || b.style === 'poem') {
          lines.push(`${b.text || ''}\n`);
        } else if (b.style === 'quote') {
          lines.push(`> ${b.text || ''}\n`);
        } else if (b.type === 'math') {
          lines.push(`$$\n${b.latex || ''}\n$$\n`);
        } else if (b.type === 'graphic') {
          lines.push(`![${b.alt || 'Tactile graphic'}](${b.src || 'graphic'})\n`);
        }
      });
      saveBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `${baseName}.md`);
      announce(`Saved ${baseName}.md`);
      setStatus(`Exported ${baseName}.md markdown document.`);
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
          if (headers.length) lines.push(headers.join('\t'));
          for (const r of rows) lines.push((r || []).join('\t'));
          lines.push('');
        } else if (b.type === 'indicator') lines.push('\n* * *\n');
        else if (b.type === 'note') lines.push(`\n[Note: ${b.text || ''}]\n`);
        else if (b.type === 'footnote') lines.push(`\n[Footnote: ${b.text || ''}]\n`);
        else if (b.type === 'stage' || b.style === 'stage') lines.push(`\n[Stage direction: ${b.text || ''}]\n`);
        else if (b.type === 'caption' || b.style === 'caption') lines.push(`\n[Caption: ${b.text || ''}]\n`);
        else if (b.type === 'attribution' || b.style === 'attribution') lines.push(`\n[Attribution: ${b.text || ''}]\n`);
        else if (b.type === 'play' || b.style === 'dialogue' || b.style === 'poem') lines.push(`${b.text || ''}\n`);
        else if (b.style === 'quote') lines.push(`\n"${b.text || ''}"\n`);
      });
      saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${baseName}.txt`);
      announce(`Saved ${baseName}.txt`);
      setStatus(`Exported ${baseName}.txt plain text.`);
      return;
    }
    if (format === 'docx') {
      const blob = exportToDocxBlob(lastModel, title);
      saveBlob(blob, `${baseName}.docx`);
      announce(`Saved ${baseName}.docx`);
      setStatus(`Exported ${baseName}.docx Word document.`);
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
          const headHtml = headers.length ? `<thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>` : '';
          const bodyHtml = `<tbody>${rows.map(r => `<tr>${(r || []).map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
          htmlBody.push(`<table>${headHtml}${bodyHtml}</table>`);
        } else if (b.type === 'indicator') {
          htmlBody.push('<hr />');
        } else if (b.type === 'note') {
          htmlBody.push(`<aside class="transcriber-note"><p>${escapeHtml(b.text || '')}</p></aside>`);
        } else if (b.type === 'footnote') {
          htmlBody.push(`<aside class="footnote" role="doc-footnote"><p>${escapeHtml(b.text || '')}</p></aside>`);
        } else if (b.type === 'stage' || b.style === 'stage') {
          htmlBody.push(`<p class="stage-direction"><em>${escapeHtml(b.text || '')}</em></p>`);
        } else if (b.type === 'caption' || b.style === 'caption') {
          htmlBody.push(`<p class="caption"><em>${escapeHtml(b.text || '')}</em></p>`);
        } else if (b.type === 'attribution' || b.style === 'attribution') {
          htmlBody.push(`<p class="attribution"><cite>${escapeHtml(b.text || '')}</cite></p>`);
        } else if (b.type === 'play' || b.style === 'dialogue') {
          htmlBody.push(`<p class="dialogue">${b.segments ? segToHtml(b.segments) : escapeHtml(b.text || '')}</p>`);
        } else if (b.type === 'play' || b.style === 'poem') {
          htmlBody.push(`<p class="verse-line">${b.segments ? segToHtml(b.segments) : escapeHtml(b.text || '')}</p>`);
        } else if (b.style === 'quote') {
          htmlBody.push(`<blockquote><p>${b.segments ? segToHtml(b.segments) : escapeHtml(b.text || '')}</p></blockquote>`);
        } else if (b.type === 'math') {
          htmlBody.push(`<div class="math-block">${b.mathml || `<math display="block"><mrow><mtext>${escapeHtml(b.latex || '')}</mtext></mrow></math>`}</div>`);
        } else if (b.type === 'graphic') {
          htmlBody.push(`<figure role="doc-graphic">${b.svg ? sanitizeSvgMarkup(b.svg) : `<svg viewBox="0 0 100 100"><text x="10" y="50">${escapeHtml(b.alt || 'Graphic')}</text></svg>`}<figcaption>${escapeHtml(b.caption || b.alt || '')}</figcaption></figure>`);
        }
      });
      const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:2rem auto;line-height:1.6;padding:0 1rem;}table{border-collapse:collapse;width:100%;margin:1rem 0;}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f4f5f8;}.transcriber-note{background:#f8f9fa;border-left:4px solid #0284c7;padding:8px 16px;margin:1rem 0;}.footnote{border-top:1px solid #ccc;padding:8px 0;margin:1rem 0;font-size:0.9em;color:#555;}</style></head><body>${htmlBody.join('\n')}</body></html>`;
      saveBlob(new Blob([docHtml], { type: 'text/html;charset=utf-8' }), `${baseName}.html`);
      announce(`Saved ${baseName}.html`);
      setStatus(`Exported ${baseName}.html document.`);
      return;
    }
  }

  const saveBlob = (blob, name) => {
    if (typeof window !== 'undefined' && typeof window.saveBlob === 'function' && window.saveBlob !== saveBlob) {
      window.saveBlob(blob, name);
      return;
    }
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const saveMenuBtn = $id('saveDocBtn');
  const saveMenu = $id('saveMenu');
  saveMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!saveMenu) return;
    const willShow = saveMenu.hidden;
    closeAllDropdownMenus();
    saveMenu.hidden = !willShow;
    saveMenuBtn.setAttribute('aria-expanded', String(willShow));
    if (willShow) {
      saveMenu.querySelector('.menu-dropdown-item')?.focus({ preventScroll: true });
    }
  });
  $id('saveXmlItem')?.addEventListener('click', () => {
    closeAllDropdownMenus();
    exportTextDocument('xml');
  });
  $id('saveDocxItem')?.addEventListener('click', () => {
    closeAllDropdownMenus();
    exportTextDocument('docx');
  });
  $id('saveMdItem')?.addEventListener('click', () => {
    closeAllDropdownMenus();
    exportTextDocument('md');
  });
  $id('saveJsonItem')?.addEventListener('click', () => {
    closeAllDropdownMenus();
    exportTextDocument('json');
  });
  $id('saveTxtItem')?.addEventListener('click', () => {
    closeAllDropdownMenus();
    exportTextDocument('txt');
  });
  $id('saveHtmlItem')?.addEventListener('click', () => {
    closeAllDropdownMenus();
    exportTextDocument('html');
  });

  window.exportTextDocument = exportTextDocument;
  window.triggerDownloadFormat = triggerDownloadFormat;
  window.saveBlob = saveBlob;

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
      downloadMenu.querySelector('.menu-dropdown-item')?.focus({ preventScroll: true });
    }
  });

  function triggerDownloadFormat(format = 'brf') {
    closeAllDropdownMenus();
    if (!lastBrf) return;
    const title = (lastModel?.title || document.querySelector('#editor h1, #editor h2, #editor [data-block-type="heading"]')?.textContent || 'document').trim();
    const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
    const currentVolPages = window.settings?.volumePages !== undefined ? window.settings.volumePages : settings.volumePages;
    const maxV = Math.max(0, Number(currentVolPages) || 0);
    const opts = {
      ...(lastFormatOpts || currentFormatOpts()),
      suppressHeader: false,
      mode: settings.mode, width: settings.cells, depth: settings.lines,
      volumePages: maxV, includeCovers: settings.includeCovers,
      duplex: settings.embosserDuplex,
    };
    if (format === 'pef') {
      const pefXml = exportToPef(lastModel || { title: 'Document', blocks: [] }, opts);
      saveBlob(new Blob([pefXml], { type: 'application/x-pef+xml' }), `${baseName}.pef`);
      announce('Downloaded PEF 1.0 XML document.');
      setStatus(`Exported ${baseName}.pef XML document.`);
      return;
    }
    if (format === 'ebrl' || format === 'ebraille' || format === 'ebrf') {
      const bytes = exportToEbraille(lastModel || { title: 'Document', blocks: [] },
        { ...opts, language: (typeof navigator !== 'undefined' && navigator.language) || 'en' });
      saveBlob(new Blob([bytes], { type: 'application/epub+zip' }), `${baseName}.ebraille`);
      announce(`Saved ${baseName}.ebraille`);
      setStatus(`Exported ${baseName}.ebraille eBraille publication.`);
      return;
    }
    const vols = (lastModel && lastFormatOpts) ? formatVolumes(lastModel, { ...lastFormatOpts, suppressHeader: false, volumePages: maxV }) : [{ volume: 1, of: 1, brf: lastBrf || '' }];
    if (vols.length <= 1) {
      saveBlob(new Blob([vols[0].brf || ''], { type: 'application/octet-stream' }), `${baseName}.brf`);
      announce(`Saved ${baseName}.brf`);
      setStatus(`Exported ${baseName}.brf formatted braille.`);
      return;
    }
    const files = vols.map((v) => ({ name: `${baseName}-v${v.volume}-of-${v.of}.brf`, text: v.brf }));
    saveBlob(makeZip(files), `${baseName}-braille-volumes.zip`);
    announce(`Downloaded ${vols.length} braille volumes as a zip.`);
  }

  $id('downloadEbrlItem')?.addEventListener('click', () => triggerDownloadFormat('ebraille'));
  $id('downloadBrfItem')?.addEventListener('click', () => triggerDownloadFormat('brf'));
  $id('downloadPefItem')?.addEventListener('click', () => triggerDownloadFormat('pef'));
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
        announce(`Review issue ${proofIssueIdx} of ${lastProofIssues.length}: ${issue.text || ''}`);
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
    window.registerLocale = registerLocale;
  }
  applySettingsToUI(true);
  wireControls();
  wireReadingControls();
  updateReadButtons();
  setStatus('Loading braille engine…');
  brailleEl.textContent = 'Loading braille engine…';
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
    brailleEl.textContent = '⚠ Braille engine failed to load.\n\n' + e.message +
      '\n\nHard-refresh with Cmd/Ctrl+Shift+R. If it persists, open the browser console (View ▸ Developer) and send the errors.';
    setStatus('Engine failed to load: ' + e.message);
    return;
  }
  initToolbar();
  initSlashMenu();
  initBrlSlashMenu();
  initMarkdownShortcuts();
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
  if (handoff && (handoff.blocks || []).length) modelToLexical(handoff); else seed();
  clearTranslationCache();
  render();
  refreshToolbar();
  // once MathCAT and MathLive are ready, re-render so the seeded equation transcribes
  Promise.resolve(maths.initMaths()).then(() => {
    clearTranslationCache();
    render();
  }).catch(() => {});
  if (globalThis.customElements) customElements.whenDefined('math-field').then(() => {
    clearTranslationCache();
    render();
  }).catch(() => {});
  setStatus('Ready — type or format on the left; braille updates live.');
})();
