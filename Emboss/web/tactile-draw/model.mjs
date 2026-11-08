// Tactile drawing tool (W14): the document and its shapes. A port of SVGDocument.swift and SVGElement.swift (Paul's SwiftUI SVG editor):
// the element list (layer order, bottom first), selection, undo/redo by snapshots (50 steps, as in his saveUndoState), z-order,
// grouping, duplicate, snapping to a grid, hit testing - with these changes:
//  - geometry is stored the same way for every kind, in millimetres on the page: a rectangle's corner and size, an ellipse's centre and radii, a
//    line's two ends, a polygon's points, a path's absolute segments (the Swift version mixed coordinate frames per kind and normalised paths);
//  - there are no free colours: a shape has a line style (a palette entry or 'none') and an area texture (a palette entry or 'none');
//  - the grid is the braille dot grid (2.5 mm) and snapping is on by default.
import { MM } from './constants.mjs';
import { bbox, translateShape, scaleShape, snapValue, shapeHit, unionBoxes } from './geometry.mjs';
import { buildKey, translateLabel } from './tactile.mjs';
export { bbox, translateShape, scaleShape, snapValue, labelBox } from './geometry.mjs';

export const KINDS = ['rect', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'symbol', 'group'];
const UNDO_LIMIT = 50;   // SVGDocument.saveUndoState keeps 50

const DEFAULTS = {
  rect: { x: 0, y: 0, width: 20, height: 20, rx: 0, line: 'solid', texture: 'none' },
  ellipse: { cx: 10, cy: 10, rx: 10, ry: 10, line: 'solid', texture: 'none' },
  line: { x1: 0, y1: 0, x2: 20, y2: 0, line: 'solid' },
  polyline: { points: [], line: 'solid' },
  polygon: { points: [], line: 'solid', texture: 'none' },
  path: { segs: [], line: 'solid', texture: 'none' },
  text: { x: 0, y: 0, text: '', braille: '' },
  symbol: { cx: 0, cy: 0, size: MM.minSymbol, symbol: 'circle' },
  group: { children: [], role: '' },
};

/** A new shape (no id yet: the document gives one when it is added). */
export function makeShape(kind, props = {}) {
  if (!DEFAULTS[kind]) throw new Error(`unknown shape kind ${kind}`);
  const s = { id: null, kind, name: '', visible: true, locked: false, ...structuredClone(DEFAULTS[kind]), ...structuredClone(props) };
  s.kind = kind;
  return s;
}

const HANDLE_IDS = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
export const KIND_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', polyline: 'Polyline', polygon: 'Polygon', path: 'Curve', text: 'Label', symbol: 'Point symbol', group: 'Group' };

export class TactileDoc {
  constructor({ cells = 38, lines = 25, width, height } = {}) {
    this.cells = cells; this.lines = lines;
    this.width = width ?? cells * MM.cell;
    this.height = height ?? lines * MM.line;
    this.shapes = [];
    this.selection = new Set();
    this.legend = {};                       // style id -> what it means (the key)
    this.snap = { on: true, step: MM.dot };
    this.grid = { show: true };
    this.nextId = 1;
    this.undoStack = []; this.redoStack = [];
    this.modified = false;
  }
  get page() { return { width: this.cells * MM.cell, height: this.lines * MM.line }; }

  // ---- ids and lookup ----
  _assignIds(s) { s.id = `s${this.nextId++}`; if (s.kind === 'group') for (const c of s.children) this._assignIds(c); return s; }
  find(id) { let r = null; const go = (list) => { for (const s of list) { if (s.id === id) { r = s; return; } if (s.kind === 'group') go(s.children); if (r) return; } }; go(this.shapes); return r; }
  all() { const a = []; const go = (l) => { for (const s of l) { a.push(s); if (s.kind === 'group') go(s.children); } }; go(this.shapes); return a; }
  selected() { return this.shapes.filter((s) => this.selection.has(s.id)); }
  /** Add without an undo step or selection: used when reading a file. */
  attach(shape) { this._assignIds(shape); this.shapes.push(shape); return shape; }

  // ---- undo / redo (SVGDocument.saveUndoState / undo / redo) ----
  _snapshot() { return structuredClone({ shapes: this.shapes, legend: this.legend, width: this.width, height: this.height }); }
  _restore(snap) { this.shapes = snap.shapes; this.legend = snap.legend; this.width = snap.width; this.height = snap.height; this.selection = new Set(); }
  checkpoint() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.modified = true;
  }
  /** Drop the newest undo step when a gesture changed nothing. */
  discardCheckpoint() { this.undoStack.pop(); }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this._snapshot());
    this._restore(prev); this.modified = true;
    return true;
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this._snapshot());
    this._restore(next); this.modified = true;
    return true;
  }

  // ---- selection ----
  select(id) { this.selection = new Set(id ? [id] : []); }
  addToSelection(id) { this.selection.add(id); }
  toggleSelection(id) { if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); }
  deselectAll() { this.selection = new Set(); }
  selectAll() { this.selection = new Set(this.shapes.filter((s) => s.visible && !s.locked).map((s) => s.id)); }
  /** Tab / Shift+Tab: the next (dir 1) or previous (dir -1) shape, wrapping round. Returns the shape or null. */
  cycleSelection(dir) {
    const list = this.shapes.filter((s) => s.visible && !s.locked);
    if (!list.length) return null;
    const cur = list.findIndex((s) => this.selection.has(s.id));
    const next = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
    this.select(list[next].id);
    return list[next];
  }

  // ---- changes (each one is one undo step) ----
  add(shape) { this.checkpoint(); this._assignIds(shape); this.shapes.push(shape); this.select(shape.id); return shape; }
  deleteSelected() {
    if (!this.selection.size) return 0;
    const n = this.selection.size;
    this.checkpoint();
    this.shapes = this.shapes.filter((s) => !this.selection.has(s.id));
    this.deselectAll();
    return n;
  }
  /** Move the selection (no undo step: call checkpoint() first for a keyboard nudge or at the start of a drag). */
  moveSelected(dx, dy) { for (const s of this.selected()) if (!s.locked) translateShape(s, dx, dy); }
  duplicateSelected() {
    const sel = this.selected();
    if (!sel.length) return null;
    this.checkpoint();
    const copies = sel.map((s) => { const c = structuredClone(s); this._assignIds(c); translateShape(c, MM.dot * 2, MM.dot * 2); if (c.name) c.name += ' copy'; return c; });
    this.shapes.push(...copies);
    this.selection = new Set(copies.map((c) => c.id));
    return copies[0];
  }
  // z-order, one selected shape (SVGDocument bringToFront / sendToBack / bringForward / sendBackward)
  _reorder(fn) {
    const sel = this.selected();
    if (sel.length !== 1) return false;
    const i = this.shapes.indexOf(sel[0]);
    const j = fn(i, this.shapes.length);
    if (j === i) return false;
    this.checkpoint();
    this.shapes.splice(i, 1); this.shapes.splice(j, 0, sel[0]);
    return true;
  }
  bringToFront() { return this._reorder((i, n) => n - 1); }
  sendToBack() { return this._reorder(() => 0); }
  bringForward() { return this._reorder((i, n) => Math.min(n - 1, i + 1)); }
  sendBackward() { return this._reorder((i) => Math.max(0, i - 1)); }
  groupSelected() {
    const sel = this.selected();
    if (sel.length < 2) return null;
    this.checkpoint();
    const at = Math.max(...sel.map((s) => this.shapes.indexOf(s)));
    const idx = this.shapes.slice(0, at).filter((s) => !this.selection.has(s.id)).length;
    const g = makeShape('group', { name: 'Group' });
    g.children = sel;
    g.id = `s${this.nextId++}`;
    this.shapes = this.shapes.filter((s) => !this.selection.has(s.id));
    this.shapes.splice(idx, 0, g);
    this.select(g.id);
    return g;
  }
  ungroupSelected() {
    const gs = this.selected().filter((s) => s.kind === 'group');
    if (!gs.length) return 0;
    this.checkpoint();
    const kids = [];
    for (const g of gs) { const i = this.shapes.indexOf(g); this.shapes.splice(i, 1, ...g.children); kids.push(...g.children); }
    this.selection = new Set(kids.map((k) => k.id));
    return gs.length;
  }
  /** Change a property of one shape as one undo step. */
  setProp(id, props) { const s = this.find(id); if (!s) return false; this.checkpoint(); Object.assign(s, props); return true; }

  // ---- snapping (SVGDocument.snappedPoint) ----
  snapPoint(p) { return this.snap.on ? { x: snapValue(p.x, this.snap.step), y: snapValue(p.y, this.snap.step) } : { x: p.x, y: p.y }; }

  // ---- the key placed on the drawing ----
  /** Draw the automatic key (area textures, lines, symbols) below the drawing, replacing an earlier one. One undo step. */
  placeKey(translate, fallback) {
    const entries = buildKey(this);
    this.checkpoint();
    this.shapes = this.shapes.filter((s) => s.role !== 'key' && !(s.kind === 'group' && s.role === 'key'));
    this.selection = new Set();
    if (!entries.length) return null;
    const content = unionBoxes(this.shapes.filter((s) => s.visible).map(bbox));
    const x0 = 0, y0 = this.shapes.length ? content.y + content.height + MM.dot * 4 : 0;
    const kids = [];
    entries.forEach((e, i) => {
      const y = y0 + i * 15;
      if (e.type === 'texture') kids.push(makeShape('rect', { x: x0, y, width: MM.keyAreaW, height: MM.keyAreaH, texture: e.id }));
      else if (e.type === 'line') kids.push(makeShape('line', { x1: x0, y1: y + 6, x2: x0 + MM.keyLine, y2: y + 6, line: e.id }));
      else kids.push(makeShape('symbol', { cx: x0 + 12.7, cy: y + 6.35, size: MM.minSymbol + 1, symbol: e.id }));
      const t = translateLabel(e.meaning || e.name, translate, fallback);
      kids.push(makeShape('text', { x: x0 + MM.keyAreaW + 6, y: y + 4, text: t.print, braille: t.braille }));
    });
    const g = makeShape('group', { name: 'Key', role: 'key' });
    g.children = kids;
    this._assignIds(g);
    this.shapes.push(g);
    this.select(g.id);
    return g;
  }
  /** Scale and move everything uniformly so it fits the page (an imported drawing larger than the braille page). */
  fitToPage(checkpoint = true) {
    const b = unionBoxes(this.shapes.filter((s) => s.visible).map(bbox));
    if (!b.width && !b.height) return 1;
    const page = this.page;
    const k = Math.min(1, (page.width - 2 * MM.dot) / (b.width || 1), (page.height - 2 * MM.dot) / (b.height || 1));
    if (checkpoint) this.checkpoint();
    const to = { x: MM.dot, y: MM.dot, width: b.width * k, height: b.height * k };
    for (const s of this.shapes) scaleShape(s, b, to);
    this.width = page.width; this.height = page.height;
    return k;
  }
  /** Replace the drawing with another document's shapes (opening an SVG file): one undo step. */
  adopt(other) {
    this.checkpoint();
    this.shapes = [];
    for (const s of other.shapes) this.attach(structuredClone(s));
    this.legend = { ...other.legend };
    this.width = other.width; this.height = other.height;
    this.selection = new Set();
  }
  /** A plain copy of everything that is saved (ids left out), for comparing documents. */
  toPlain() {
    const strip = (s) => { const c = structuredClone(s); const go = (x) => { delete x.id; if (x.kind === 'group') x.children.forEach(go); }; go(c); return c; };
    return { width: this.width, height: this.height, cells: this.cells, lines: this.lines, legend: { ...this.legend }, shapes: this.shapes.map(strip) };
  }
}

/** The topmost visible, unlocked top-level shape under the point (SVGDocument.elementAt), or null. `tol` is in mm. */
export function hitTest(doc, p, tol = 2) {
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i];
    if (s.visible && !s.locked && shapeHit(s, p, tol)) return s;
  }
  return null;
}

// ---- selection handles (CanvasView.swift ResizeHandle / handlePosition / applyResize) ----
/** Handles for one shape: the ends of a line and the corners of a polyline/polygon, or the eight points of the box (CanvasView). A label has none. */
export function handlesFor(s) {
  if (s.kind === 'text') return [];
  if (s.kind === 'line') return [{ id: 'p0', x: s.x1, y: s.y1 }, { id: 'p1', x: s.x2, y: s.y2 }];
  if (s.kind === 'polyline' || s.kind === 'polygon') return s.points.map((p, i) => ({ id: `p${i}`, x: p.x, y: p.y }));
  const b = bbox(s);
  const xs = { l: b.x, r: b.x + b.width }, ys = { t: b.y, b: b.y + b.height };
  const pos = { tl: [xs.l, ys.t], t: [b.x + b.width / 2, ys.t], tr: [xs.r, ys.t], r: [xs.r, b.y + b.height / 2], br: [xs.r, ys.b], b: [b.x + b.width / 2, ys.b], bl: [xs.l, ys.b], l: [xs.l, b.y + b.height / 2] };
  return HANDLE_IDS.map((id) => ({ id, x: pos[id][0], y: pos[id][1] }));
}

/** Drag a handle to point `pt`, from the shape as it was when the drag began (`original`). Mutates `shape`. */
export function dragHandle(shape, original, handleId, pt) {
  const o = structuredClone(original);
  if (/^p\d+$/.test(handleId)) {
    const i = Number(handleId.slice(1));
    if (shape.kind === 'line') { if (i === 0) { shape.x1 = pt.x; shape.y1 = pt.y; } else { shape.x2 = pt.x; shape.y2 = pt.y; } }
    else if (shape.points[i]) { shape.points[i] = { x: pt.x, y: pt.y }; }
    return;
  }
  const b = bbox(o);
  let x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
  if (handleId.includes('l')) x0 = Math.min(pt.x, x1 - 1);
  if (handleId.includes('r')) x1 = Math.max(pt.x, x0 + 1);
  if (handleId.includes('t')) y0 = Math.min(pt.y, y1 - 1);
  if (handleId.includes('b')) y1 = Math.max(pt.y, y0 + 1);
  scaleShape(o, b, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  Object.assign(shape, o);
}
