// Tactile drawing tool (W14): the drawing dialog - toolbar, drawing area, inspector, shapes (layers) list, key, checks and the dot preview.
// Ports ContentView.swift (the action bar and file actions), ToolbarView.swift (tools, zoom, grid and snap), LayersPanel.swift (the list of shapes
// with show/hide and lock) and InspectorView.swift (the selected shape's name, position, size, appearance, text, arrange, duplicate, delete,
// visible, locked; with nothing selected, the canvas size) from Paul's SwiftUI SVG editor. Plain DOM, no framework.
import { MM } from './constants.mjs';
import { TactileDoc, makeShape, bbox, translateShape, scaleShape, KIND_NAMES } from './model.mjs';
import { parseSvg, writeSvg } from './svg-io.mjs';
import { LINE_STYLES, TEXTURES, SYMBOLS, LIMITS, checkDrawing, buildKey, translateLabel, usedStyles, lineStyle, textureById } from './tactile.mjs';
import { createStage, TOOLS } from './canvas.mjs';
import { describeShape, shapeName } from './describe.mjs';
import { drawDotPreview } from './dots.mjs';
import { CSS } from './styles.mjs';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};
const r1 = (v) => Math.round(v * 10) / 10;
let uid = 0;

function injectStyles() {
  if (document.getElementById('tdStyles')) return;
  const s = document.createElement('style'); s.id = 'tdStyles'; s.textContent = CSS; document.head.appendChild(s);
}

/**
 * Open the drawing dialog.
 * opts: { svg, title, alt, cells, lines, translate(print)->braille, fallback(print)->braille, announce(msg), onSave({svg,title,alt,warnings}), onCancel() }
 * Returns a promise that resolves to {saved} when the dialog closes.
 */
export function openTactileDraw(opts = {}) {
  injectStyles();
  const cells = opts.cells || 38, lines = opts.lines || 25;
  let doc = new TactileDoc({ cells, lines });
  let openMessage = '';
  if (opts.svg) {
    const r = parseSvg(opts.svg, { cells, lines });
    if (r.doc) {
      doc = r.doc;
      if (!r.own) {
        const fitted = (() => { const p = doc.page; return doc.width > p.width + 0.01 || doc.height > p.height + 0.01 ? doc.fitToPage(false) : 1; })();
        doc.width = Math.max(doc.width, doc.page.width); doc.height = Math.max(doc.height, doc.page.height);
        openMessage = `This graphic was not made in the drawing tool, so it was converted: fill colours became textures${fitted < 1 ? ', and it was shrunk to fit the page' : ''}${r.skipped.length ? `; ${r.skipped.length} kind(s) of item could not be brought in (${r.skipped.slice(0, 3).join(' ')})` : ''}. Cancel keeps the original.`;
      } else if (r.skipped.length) openMessage = r.skipped.join(' ');
      doc.undoStack = []; doc.redoStack = []; doc.modified = false;
    } else openMessage = `${r.error} A blank drawing was opened instead.`;
  }
  const tr = (print) => translateLabel(print, opts.translate, opts.fallback);
  // labels read from a file may have no braille yet, or braille for another code: translate them with the document's code
  for (const s of doc.all()) if (s.kind === 'text' && s.text) { const t = tr(s.text); if (t.braille) s.braille = t.braille; }

  const state = { tool: 'select', zoom: 1, line: 'solid', texture: 'none', symbol: 'circle', cursor: { x: MM.dot * 8, y: MM.dot * 8 }, draft: null, warnIds: new Set(), showDots: false, focused: false, cursorShown: false };
  const id = (n) => `td-${n}-${++uid}`;

  // ------------------------------------------------------------------ the dialog
  const dlg = h('dialog', { class: 'dialog td-dialog', 'aria-labelledby': 'tdTitleHead', id: 'tactileDrawDialog' });
  const body = h('div', { class: 'dialog-body td-body' });
  dlg.append(body);
  const titleIn = h('input', { type: 'text', id: id('title'), value: opts.title || '' });
  const altIn = h('input', { type: 'text', id: id('alt'), value: opts.alt || '' });
  const status = h('div', { class: 'td-status', role: 'status', 'aria-live': 'polite', id: 'tdStatus' });
  let statusTimer = 0;
  const announce = (msg) => {
    clearTimeout(statusTimer);
    status.textContent = '';
    statusTimer = setTimeout(() => { status.textContent = msg; }, 30);
    if (opts.announce) { try { opts.announce(msg); } catch { /* the page's own live region is optional */ } }
  };

  body.append(h('div', { class: 'td-head' }, h('h2', { id: 'tdTitleHead', text: 'Draw a tactile graphic' }),
    h('span', { class: 'td-note', text: `Page ${doc.cells} cells by ${doc.lines} lines. Units are millimetres.` })));
  body.append(h('div', { class: 'td-meta' },
    h('div', {}, h('label', { for: titleIn.id, text: 'Title (the braille label line)' }), titleIn),
    h('div', {}, h('label', { for: altIn.id, text: 'Description for the braille reader' }), altIn)));

  // ------------------------------------------------------------------ toolbar
  const bar = h('div', { class: 'td-bar' });
  const toolBtns = new Map();
  const toolGroup = h('div', { class: 'td-group', role: 'group', 'aria-label': 'Drawing tools' });
  for (const t of TOOLS) {
    const b = h('button', { type: 'button', class: 'td-btn', 'data-tool': t.id, 'aria-pressed': 'false', 'aria-keyshortcuts': t.key.toUpperCase(), title: `${t.name} (${t.key.toUpperCase()}). ${t.hint}`, text: t.name, onclick: () => { setTool(t.id); stage.svg.focus(); } });
    toolBtns.set(t.id, b); toolGroup.append(b);
  }
  const symbolSel = h('select', { 'aria-label': 'Point symbol for the Point symbol tool', onchange: () => { state.symbol = symbolSel.value; announce(`Point symbol ${SYMBOLS.find((s) => s.id === state.symbol).name}.`); } },
    SYMBOLS.map((s) => h('option', { value: s.id, text: s.name })));
  toolGroup.append(symbolSel);

  const act = (label, fn, extra = {}) => h('button', { type: 'button', class: 'td-btn' + (extra.danger ? ' danger' : ''), text: label, title: extra.title, 'aria-keyshortcuts': extra.keys, onclick: () => { fn(); if (!extra.keep) stage.svg.focus(); } });
  const btnUndo = act('Undo', () => ctx.undo(), { keys: 'Control+Z', title: 'Undo (Ctrl+Z)' });
  const btnRedo = act('Redo', () => ctx.redo(), { keys: 'Control+Shift+Z', title: 'Redo (Ctrl+Shift+Z or Ctrl+Y)' });
  const btnDup = act('Duplicate', () => ctx.duplicate(), { keys: 'Control+D', title: 'Duplicate (Ctrl+D)' });
  const btnDel = act('Delete', () => ctx.deleteSelected(), { keys: 'Delete', danger: true, title: 'Delete the selected shapes (Delete)' });
  const btnGroup = act('Group', () => ctx.group(), { keys: 'Control+G', title: 'Group the selected shapes (Ctrl+G)' });
  const btnUngroup = act('Ungroup', () => ctx.ungroup(), { keys: 'Control+Shift+G', title: 'Ungroup (Ctrl+Shift+G)' });
  const editGroup = h('div', { class: 'td-group', role: 'group', 'aria-label': 'Edit' }, btnUndo, btnRedo, btnDup, btnDel, btnGroup, btnUngroup);

  const snapCb = h('input', { type: 'checkbox', id: id('snap'), checked: true, onchange: () => { doc.snap.on = snapCb.checked; announce(doc.snap.on ? 'Snapping to the braille dot grid is on.' : 'Snapping is off.'); } });
  const gridCb = h('input', { type: 'checkbox', id: id('grid'), checked: true, onchange: () => { doc.grid.show = gridCb.checked; stage.render(); } });
  const viewGroup = h('div', { class: 'td-group', role: 'group', 'aria-label': 'View' },
    act('Zoom out', () => ctx.zoomBy(0.8), { title: 'Zoom out (-)' }), act('Zoom in', () => ctx.zoomBy(1.25), { title: 'Zoom in (+)' }), act('Fit', () => ctx.zoomFit(), { title: 'Fit the page in the window (0)' }),
    h('label', { class: 'td-check', for: snapCb.id }, snapCb, 'Snap to dots'), h('label', { class: 'td-check', for: gridCb.id }, gridCb, 'Dot grid'));
  const btnDots = h('button', { type: 'button', class: 'td-btn', 'aria-pressed': 'false', text: 'Show as dots', title: 'Preview the drawing as raised dots', onclick: () => { state.showDots = !state.showDots; btnDots.setAttribute('aria-pressed', String(state.showDots)); updateView(); announce(state.showDots ? 'Showing the drawing as dots.' : 'Showing the drawing.'); } });
  const btnKey = act('Put key on drawing', () => ctx.placeKey(), { title: 'Draw the key (area textures, lines, symbols) on the drawing' });
  const fileIn = h('input', { type: 'file', accept: '.svg,image/svg+xml', class: 'sr-only', id: id('file'), 'aria-label': 'SVG file to open', tabindex: '-1' });
  fileIn.addEventListener('change', async () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) importSvg(await f.text(), f.name); });
  const btnImport = act('Open SVG…', () => fileIn.click(), { keep: true, title: 'Replace the drawing with an SVG file (Undo brings it back)' });
  const btnExport = act('Save as SVG file', () => exportSvg(), { keep: true });
  const fileGroup = h('div', { class: 'td-group', role: 'group', 'aria-label': 'Key and files' }, btnDots, btnKey, btnImport, fileIn, btnExport);
  bar.append(toolGroup, editGroup, viewGroup, fileGroup);
  body.append(h('div', { role: 'toolbar', 'aria-label': 'Drawing tools and actions', class: 'td-bar-wrap' }, bar));

  // ------------------------------------------------------------------ main: stage and side panels
  const ctx = {
    doc, state, announce,
    setTool, changed, zoomBy, zoomFit, showHelp,
    undo() { if (doc.undo()) { announce('Undone.'); changed({ selection: true }); } else announce('Nothing to undo.'); },
    redo() { if (doc.redo()) { announce('Redone.'); changed({ selection: true }); } else announce('Nothing to redo.'); },
    duplicate() { const c = doc.duplicateSelected(); if (c) { announce(`Duplicated: ${describeShape(doc, c)}.`); changed({ selection: true }); } else announce('Nothing selected to duplicate.'); },
    group() { const g = doc.groupSelected(); if (g) { announce(`Grouped ${g.children.length} shapes.`); changed({ selection: true }); } else announce('Select two or more shapes to group.'); },
    ungroup() { const n = doc.ungroupSelected(); if (n) { announce('Ungrouped.'); changed({ selection: true }); } else announce('Select a group to ungroup.'); },
    deleteSelected() { const names = doc.selected().map((s) => shapeName(doc, s)); const n = doc.deleteSelected(); if (n) { announce(n === 1 ? `Deleted ${names[0]}.` : `Deleted ${n} shapes.`); changed({ selection: true }); } else announce('Nothing selected to delete.'); },
    placeKey() { const g = doc.placeKey(opts.translate, opts.fallback); if (g) announce('The key was put on the drawing, below everything else. Move it where it belongs.'); else announce('There is nothing to put in a key yet.'); changed({ selection: true }); },
    makeLabel: (t) => tr(t),
    focusLabelText() { const e = dlg.querySelector('#tdLabelText'); if (e) { e.focus(); e.select(); } },
    focusInspector() { const e = inspector.querySelector('input, select'); if (e) e.focus(); },
  };
  const stage = createStage(ctx);
  const dotsCanvas = h('canvas', { class: 'td-dots', role: 'img', 'aria-label': 'The drawing as raised dots' });
  const dotsWrap = h('div', { class: 'td-stage td-dots-wrap', hidden: true }, dotsCanvas);
  const side = h('div', { class: 'td-side' });
  const inspector = h('section', { class: 'td-panel', 'aria-labelledby': 'tdInspH' });
  const layersPanel = h('section', { class: 'td-panel', 'aria-labelledby': 'tdLayH' });
  const keyPanel = h('section', { class: 'td-panel', 'aria-labelledby': 'tdKeyH' });
  const checksPanel = h('section', { class: 'td-panel', 'aria-labelledby': 'tdChkH' });
  const help = h('details', { class: 'td-panel td-keys', id: 'tdHelp' }, h('summary', { text: 'Keyboard help' }),
    h('dl', {}, ...[
      ['V L P G R E C T S', 'Choose a tool: Select, Line, Polyline, Polygon, Rectangle, Ellipse, Circle, Label, Point symbol'],
      ['Arrow keys', 'Select tool: move the selection (Shift: 5 steps; Alt: resize). Drawing tools: move the cursor'],
      ['Enter', 'Drawing tool: start, add a corner, or finish. Select tool: edit the selected shape'],
      ['Space', 'Finish a polyline or polygon'],
      ['Tab, Shift+Tab', 'Next or previous shape; past the last shape it moves on to the next control'],
      ['Delete', 'Delete the selection'],
      ['Escape', 'Cancel a shape being drawn; then back to Select; then clear the selection; then close'],
      ['Ctrl+Z, Ctrl+Shift+Z', 'Undo, redo'], ['Ctrl+D, Ctrl+G, Ctrl+A', 'Duplicate, group, select all'],
      ['+  -  0', 'Zoom in, out, fit'],
    ].flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
  side.append(inspector, layersPanel, keyPanel, checksPanel, help);
  body.append(h('p', { id: 'tdKeys', class: 'sr-only', text: 'Drawing area. Choose a tool with a letter key, move with the arrow keys, press Enter to place, Tab to move between shapes, question mark for the keyboard help.' }));
  body.append(h('div', { class: 'td-main' }, h('div', { style: 'min-height:0;display:flex;flex-direction:column;' }, stage.el, dotsWrap), side));
  stage.el.style.flex = '1 1 0'; dotsWrap.style.flex = '1 1 0';

  // ------------------------------------------------------------------ footer
  const btnCancel = h('button', { type: 'button', class: 'td-btn', text: 'Cancel', onclick: () => requestClose() });
  const btnSave = h('button', { type: 'button', class: 'td-btn primary', text: opts.saveLabel || 'Save to document', onclick: () => save() });
  const footBtns = h('div', { class: 'td-group' }, btnCancel, btnSave);
  const foot = h('div', { class: 'td-foot' }, status, footBtns);
  body.append(foot);

  // ------------------------------------------------------------------ behaviour
  function setTool(toolId, { quiet } = {}) {
    state.tool = toolId; state.draft = null; state.cursorShown = false;
    for (const [t, b] of toolBtns) b.setAttribute('aria-pressed', String(t === toolId));
    const t = TOOLS.find((x) => x.id === toolId);
    if (!quiet) announce(`${t.name} tool. ${t.hint}${toolId !== 'select' ? ' With the keyboard: arrow keys move the cursor, Enter places.' : ''}`);
    stage.render();
  }
  function updateView() {
    stage.el.hidden = state.showDots; dotsWrap.hidden = !state.showDots;
    if (state.showDots) scheduleDots();
  }
  let dotsTimer = 0, dotsGen = 0;
  function scheduleDots() {
    clearTimeout(dotsTimer);
    dotsTimer = setTimeout(async () => {
      if (!state.showDots) return;
      const gen = ++dotsGen;
      const labels = doc.all().filter((s) => s.kind === 'text' && s.visible);
      const r = await drawDotPreview(dotsCanvas, writeSvg(doc, { noLabelText: true }), doc, labels);
      if (gen !== dotsGen) return;
      if (r) dotsCanvas.setAttribute('aria-label', `The drawing as raised dots: ${r.dots} dots on a grid ${r.cols} by ${r.rows}`);
    }, 120);
  }
  function zoomBy(f) { state.zoom = Math.max(0.3, Math.min(5, state.zoom * f)); stage.render(); announce(`Zoom ${Math.round(state.zoom * 100)} percent.`); }
  function zoomFit(quiet) { const avail = (stage.el.clientWidth || 700) - 24; state.zoom = Math.max(0.3, Math.min(4, avail / (doc.width * 3))); stage.render(); if (quiet !== true) announce(`Zoom ${Math.round(state.zoom * 100)} percent.`); }
  function showHelp() { help.open = true; help.querySelector('summary').focus(); }

  function edit(fn) { doc.checkpoint(); fn(); changed(); }
  const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

  // inspector ------------------------------------------------------------
  let inspSig = '';
  let inspFields = [];
  const optionsOf = (list, none) => [none ? h('option', { value: 'none', text: none }) : null, ...list.map((x) => h('option', { value: x.id, text: x.name }))];
  function field(parent, label, input, { wide = false, get } = {}) {
    const fid = id('f'); input.id = input.id || fid;
    parent.append(h('div', { class: wide ? 'wide' : '' }, h('label', { for: input.id, text: label }), input));
    if (get) inspFields.push({ input, get });
    return input;
  }
  function numberField(parent, label, get, set, opt = {}) {
    const input = h('input', { type: 'number', step: opt.step || '0.5', min: opt.min });
    input.value = String(r1(get()));
    input.addEventListener('change', () => { const v = num(input.value, get()); edit(() => set(opt.min != null ? Math.max(opt.min, v) : v)); });
    return field(parent, label, input, { get: () => String(r1(get())) });
  }
  function selectField(parent, label, options, get, set, opt = {}) {
    const input = h('select', {}, options);
    input.value = get();
    input.addEventListener('change', () => set(input.value));
    return field(parent, label, input, { get, ...opt });
  }
  function usageNote(kind) {
    const u = usedStyles(doc);
    const n = u[kind].length, max = LIMITS[kind];
    return `${n} of ${max} ${kind === 'textures' ? 'textures' : kind === 'lines' ? 'line styles' : 'symbols'} used in this graphic.`;
  }

  function buildInspector() {
    inspFields = [];
    const sel = doc.selected();
    inspector.replaceChildren();
    const head = h('h3', { id: 'tdInspH', text: sel.length === 1 ? shapeName(doc, sel[0]) : sel.length ? `${sel.length} shapes selected` : 'Drawing' });
    inspector.append(head);
    const grid = h('div', { class: 'td-fields' });
    if (!sel.length) {
      inspector.append(h('p', { class: 'td-note', text: `Nothing selected. Page: ${doc.cells} cells by ${doc.lines} lines (${r1(doc.page.width)} by ${r1(doc.page.height)} mm). ${doc.shapes.length} shape(s).` }));
      grid.append();
      selectField(grid, 'New shapes: line style', optionsOf(LINE_STYLES, 'None'), () => state.line, (v) => { state.line = v; announce(`New shapes get the ${v === 'none' ? 'no' : lineStyle(v).name.toLowerCase()} line.`); }, { wide: true });
      selectField(grid, 'New shapes: area texture', optionsOf(TEXTURES, 'None'), () => state.texture, (v) => { state.texture = v; announce(`New closed shapes get ${v === 'none' ? 'no texture' : textureById(v).name.toLowerCase()}.`); }, { wide: true });
      inspector.append(grid);
      return;
    }
    if (sel.length > 1) {
      inspector.append(h('p', { class: 'td-note', text: 'Arrow keys move them together. Use Group to make them one shape.' }));
      return;
    }
    const s = sel[0];
    const nameIn = h('input', { type: 'text', value: s.name, placeholder: shapeName(doc, { ...s, name: '' }) });
    nameIn.addEventListener('change', () => edit(() => { s.name = nameIn.value.slice(0, 80); }));
    field(grid, 'Name', nameIn, { wide: true, get: () => s.name });
    const b0 = () => bbox(s);
    numberField(grid, 'X (mm)', () => b0().x, (v) => translateShape(s, v - b0().x, 0));
    numberField(grid, 'Y (mm)', () => b0().y, (v) => translateShape(s, 0, v - b0().y));
    if (s.kind !== 'text' && s.kind !== 'symbol') {
      numberField(grid, 'Width (mm)', () => b0().width, (v) => { const b = b0(); scaleShape(s, b, { x: b.x, y: b.y, width: Math.max(1, v), height: b.height }); }, { min: 1 });
      numberField(grid, 'Height (mm)', () => b0().height, (v) => { const b = b0(); scaleShape(s, b, { x: b.x, y: b.y, width: b.width, height: Math.max(1, v) }); }, { min: 1 });
    }
    if (s.kind === 'symbol') {
      selectField(grid, 'Symbol', optionsOf(SYMBOLS), () => s.symbol, (v) => edit(() => { s.symbol = v; }), { wide: true });
      numberField(grid, 'Size (mm, at least 6.35)', () => s.size, (v) => { s.size = v; }, { min: 1 });
      grid.append(h('p', { class: 'td-note wide', text: usageNote('symbols') }));
    }
    if (s.kind === 'text') {
      const t = h('input', { type: 'text', id: 'tdLabelText', value: s.text });
      const commit = () => { if (t.value === s.text) return; edit(() => { const r = tr(t.value); s.text = r.print; s.braille = r.braille; }); announce(`Label braille: ${s.braille || 'none'}, ${Array.from(s.braille).length} cells.`); };
      t.addEventListener('change', commit);
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); stage.svg.focus(); } else if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); t.value = s.text; stage.svg.focus(); } });
      field(grid, 'Label text (print)', t, { wide: true, get: () => s.text });
      const out = h('output', { id: 'tdLabelBraille', 'aria-label': 'Braille of the label' });
      out.textContent = s.braille || '(none)';
      grid.append(h('div', { class: 'wide' }, h('span', { class: 'td-note', text: 'Braille, in the document\'s braille code: ' }), out));
      grid.append(h('p', { class: 'td-note wide', text: `Keep labels 3 mm (1/8 inch) from lines and shapes (BANA 3.4.3.12). Labels always stay horizontal (5.10.1). A label over a texture gets a clear space round it (3.4.3.13).` }));
      inspFields.push({ input: out, get: () => s.braille || '(none)', output: true });
    }
    if (['rect', 'ellipse', 'line', 'polyline', 'polygon', 'path'].includes(s.kind)) {
      selectField(grid, 'Line style', optionsOf(LINE_STYLES, 'None'), () => s.line || 'none', (v) => { edit(() => { s.line = v; }); state.line = v === 'none' ? state.line : v; announce(`Line style ${v === 'none' ? 'none' : lineStyle(v).name}. ${usageNote('lines')}`); }, { wide: true });
    }
    if (['rect', 'ellipse', 'polygon', 'path'].includes(s.kind)) {
      selectField(grid, 'Area texture', optionsOf(TEXTURES, 'None'), () => s.texture || 'none', (v) => { edit(() => { s.texture = v; }); state.texture = v; announce(`Texture ${v === 'none' ? 'none' : textureById(v).name}. ${usageNote('textures')}`); }, { wide: true });
    }
    if (s.kind === 'rect') numberField(grid, 'Corner radius (mm)', () => s.rx || 0, (v) => { s.rx = Math.max(0, v); }, { min: 0 });
    const vis = h('input', { type: 'checkbox', id: id('vis'), checked: s.visible !== false });
    vis.addEventListener('change', () => edit(() => { s.visible = vis.checked; }));
    const lock = h('input', { type: 'checkbox', id: id('lock'), checked: !!s.locked });
    lock.addEventListener('change', () => edit(() => { s.locked = lock.checked; }));
    grid.append(h('label', { class: 'td-check', for: vis.id }, vis, 'Visible'), h('label', { class: 'td-check', for: lock.id }, lock, 'Locked'));
    inspector.append(grid);
    const arrange = h('div', { class: 'td-group', role: 'group', 'aria-label': 'Arrange', style: 'margin-top:8px' },
      ...[['To front', 'bringToFront'], ['Forward', 'bringForward'], ['Backward', 'sendBackward'], ['To back', 'sendToBack']].map(([l, m]) => h('button', { type: 'button', class: 'td-btn', text: l, title: `Move ${l.toLowerCase()} in the layer order`, onclick: () => { if (doc[m]()) { announce(`${l}.`); changed(); } } })));
    inspector.append(arrange);
  }
  function refreshInspector(force) {
    const sel = doc.selected();
    const sig = sel.map((s) => s.id + s.kind).join(',');
    if (force || sig !== inspSig) { inspSig = sig; buildInspector(); return; }
    for (const f of inspFields) {
      if (document.activeElement === f.input) continue;
      const v = f.get();
      if (f.output) f.input.textContent = v; else if (f.input.value !== v) f.input.value = v;
    }
    const hd = inspector.querySelector('h3');
    if (hd && sel.length === 1) hd.textContent = shapeName(doc, sel[0]);
  }

  // shapes list (layers) ---------------------------------------------------
  function refreshLayers() {
    const list = h('ul', { class: 'td-layers', 'aria-labelledby': 'tdLayH' });
    const rows = [...doc.shapes].reverse();
    for (const s of rows) {
      const nm = shapeName(doc, s);
      const sel = doc.selection.has(s.id);
      list.append(h('li', {},
        h('button', { type: 'button', class: 'td-btn td-layer', 'aria-pressed': String(sel), title: describeShape(doc, s), text: nm, onclick: (e) => { if (e.shiftKey) doc.toggleSelection(s.id); else doc.select(s.id); changed({ selection: true }); announce(`Selected ${describeShape(doc, s)}.`); } }),
        h('button', { type: 'button', class: 'td-btn', 'aria-pressed': String(s.visible !== false), 'aria-label': `Visible: ${nm}`, text: s.visible !== false ? 'Shown' : 'Hidden', onclick: () => { edit(() => { s.visible = !s.visible; }); announce(`${nm} ${s.visible ? 'shown' : 'hidden'}.`); } }),
        h('button', { type: 'button', class: 'td-btn', 'aria-pressed': String(!!s.locked), 'aria-label': `Locked: ${nm}`, text: s.locked ? 'Locked' : 'Unlocked', onclick: () => { edit(() => { s.locked = !s.locked; if (s.locked) doc.selection.delete(s.id); }); announce(`${nm} ${s.locked ? 'locked' : 'unlocked'}.`); } })));
    }
    layersPanel.replaceChildren(h('h3', { id: 'tdLayH', text: `Shapes (${doc.shapes.length})` }), rows.length ? list : h('p', { class: 'td-note', text: 'No shapes yet. Choose a tool and draw.' }));
  }

  // key -----------------------------------------------------------------------
  let keySig = '';
  function sampleSvg(e) {
    const t = new TactileDoc({ cells: 5, lines: 2 });
    if (e.type === 'texture') t.attach(makeShape('rect', { x: 1, y: 1, width: 23, height: 11, texture: e.id }));
    else if (e.type === 'line') t.attach(makeShape('line', { x1: 1, y1: 6, x2: 24, y2: 6, line: e.id }));
    else t.attach(makeShape('symbol', { cx: 12.5, cy: 6.5, size: 8, symbol: e.id }));
    t.width = 25; t.height = 13;
    const wrap = document.createElement('div');
    wrap.innerHTML = writeSvg(t);
    const el = wrap.firstElementChild;
    el.setAttribute('width', '50'); el.setAttribute('height', '26'); el.setAttribute('aria-hidden', 'true'); el.removeAttribute('data-tactile-draw');
    return el;
  }
  function refreshKey() {
    const entries = buildKey(doc);
    const sig = entries.map((e) => e.type + e.id).join(',');
    if (sig === keySig && keyPanel.childElementCount) return;
    keySig = sig;
    keyPanel.replaceChildren(h('h3', { id: 'tdKeyH', text: 'Key' }));
    if (!entries.length) { keyPanel.append(h('p', { class: 'td-note', text: 'The key lists the textures, lines and point symbols you use, in BANA order (5.7.1): area textures, lines, point symbols. Type what each one means.' })); return; }
    const NAME = { texture: 'Texture', line: 'Line', symbol: 'Symbol' };
    for (const e of entries) {
      const input = h('input', { type: 'text', value: e.meaning, 'aria-label': `Meaning of ${NAME[e.type].toLowerCase()} ${e.name}`, placeholder: `${e.name}: what it shows` });
      input.addEventListener('change', () => { doc.checkpoint(); doc.legend[e.id] = input.value.trim(); if (!input.value.trim()) delete doc.legend[e.id]; changed(); });
      keyPanel.append(h('div', { class: 'td-keyrow' }, sampleSvg(e), input));
    }
    keyPanel.append(h('p', { class: 'td-note', text: 'Use "Put key on drawing" to draw it as shapes you can move.' }));
  }

  // checks ----------------------------------------------------------------------
  let lastWarnCount = -1;
  function refreshChecks() {
    const warns = checkDrawing(doc);
    const list = h('ul', { class: 'td-warns' });
    for (const w of warns) {
      list.append(h('li', {}, h('div', { text: w.message }), h('div', { class: 'td-rule', text: w.rule }),
        w.ids.length ? h('button', { type: 'button', class: 'td-btn', text: 'Show', title: 'Select what this is about', onclick: () => { doc.deselectAll(); w.ids.forEach((i) => doc.addToSelection(i)); state.warnIds = new Set(w.ids); changed({ selection: true, keepWarn: true }); announce(`${w.ids.length} selected. ${w.message}`); stage.svg.focus(); } }) : null));
    }
    checksPanel.replaceChildren(h('h3', { id: 'tdChkH', text: `Checks (${warns.length})` }),
      h('p', { class: 'td-note', role: 'status', text: warns.length ? `${warns.length} thing${warns.length === 1 ? '' : 's'} to look at (BANA Guidelines and Standards for Tactile Graphics).` : 'No problems found.' }), list);
    lastWarnCount = warns.length;
    return warns;
  }

  function refreshToolbar() {
    btnUndo.disabled = !doc.canUndo(); btnRedo.disabled = !doc.canRedo();
    const n = doc.selection.size;
    btnDup.disabled = !n; btnDel.disabled = !n; btnGroup.disabled = n < 2; btnUngroup.disabled = !doc.selected().some((s) => s.kind === 'group');
    snapCb.checked = doc.snap.on; gridCb.checked = doc.grid.show;
  }
  function changed(o = {}) {
    if (o.selection && !o.keepWarn) state.warnIds = new Set();
    stage.render(); refreshToolbar(); refreshInspector(); refreshLayers(); refreshKey(); refreshChecks();
    if (state.showDots) scheduleDots();
  }

  // files ----------------------------------------------------------------------
  function importSvg(text, name = 'the file') {
    const r = parseSvg(text, { cells: doc.cells, lines: doc.lines });
    if (!r.doc) { announce(`${name} could not be opened: ${r.error}`); return; }
    doc.adopt(r.doc);
    for (const s of doc.all()) if (s.kind === 'text' && s.text) { const t = tr(s.text); if (t.braille) s.braille = t.braille; }
    const p = doc.page;
    let msg = `Opened ${name}: ${doc.shapes.length} shape(s).`;
    if (doc.width > p.width + 0.01 || doc.height > p.height + 0.01) { const k = doc.fitToPage(false); if (k < 1) msg += ' It was larger than the page, so it was shrunk to fit.'; }
    doc.width = Math.max(doc.width, doc.page.width); doc.height = Math.max(doc.height, doc.page.height);
    if (!r.own) msg += ' Fill colours became textures.';
    if (r.skipped.length) msg += ` Not imported: ${r.skipped.join(' ')}`;
    if (r.notes.length) msg += ` ${r.notes.join(' ')}`;
    zoomFit(true);
    changed({ selection: true });
    announce(msg + ' Undo brings the old drawing back.');
  }
  function exportSvg() {
    const blob = new Blob([writeSvg(doc, { title: titleIn.value })], { type: 'image/svg+xml' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${(titleIn.value || 'tactile-graphic').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'tactile-graphic'}.svg` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    announce('The drawing was saved as an SVG file.');
  }

  let saved = false, resolveDone;
  const done = new Promise((res) => { resolveDone = res; });
  function save() {
    const warnings = checkDrawing(doc);
    const title = titleIn.value.trim(), alt = altIn.value.trim();
    const svg = writeSvg(doc, { title: title || undefined });
    saved = true;
    try { opts.onSave && opts.onSave({ svg, title, alt, warnings }); } finally { dlg.close(); }
  }
  let confirming = false, keepEditing = null;
  function requestClose() {
    const dirty = doc.modified || titleIn.value !== (opts.title || '') || altIn.value !== (opts.alt || '');
    if (confirming) { keepEditing && keepEditing(); return; }       // Escape while asked: keep editing, never discard by accident
    if (!dirty) { dlg.close(); return; }
    confirming = true;
    const keep = h('button', { type: 'button', class: 'td-btn primary', text: 'Keep editing', onclick: () => { confirming = false; box.replaceWith(footBtns); stage.svg.focus(); announce('Keep editing.'); } });
    keepEditing = () => keep.click();
    const discard = h('button', { type: 'button', class: 'td-btn danger', text: 'Discard changes', onclick: () => dlg.close() });
    const box = h('div', { class: 'td-confirm', role: 'group', 'aria-label': 'Discard your changes?' }, h('span', { text: 'Discard your changes?' }), keep, discard);
    footBtns.replaceWith(box);
    keep.focus();
    announce('Discard your changes? Keep editing, or Discard changes.');
  }

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (Date.now() - (state.escHandled || 0) < 200) return;        // the drawing area used this Escape (cancel a shape, back to Select ...)
    requestClose();
  });
  dlg.addEventListener('keydown', (e) => {
    // Escape is handled here, not left to the browser: Chrome closes a dialog on a second Escape without asking it first.
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); requestClose(); }
    e.stopPropagation();   // none of the editor's own shortcuts act while drawing
  });
  dlg.addEventListener('close', () => { dotsGen++; clearTimeout(dotsTimer); dlg.remove(); if (!saved && opts.onCancel) opts.onCancel(); resolveDone({ saved }); });

  document.body.append(dlg);
  dlg.showModal();
  setTool('select', { quiet: true });
  zoomFit(true);
  changed({ selection: true });
  if (openMessage) announce(openMessage);
  else announce(`Drawing tool open. Page ${doc.cells} cells by ${doc.lines} lines. Press the question mark key for keyboard help.`);
  stage.svg.focus();
  dlg._td = { doc, state, ctx, stage, save, importSvg, requestClose };   // for tests and the host page
  return done;
}

export { KIND_NAMES };
