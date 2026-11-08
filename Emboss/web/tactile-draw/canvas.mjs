// Tactile drawing tool (W14): the drawing area - what is drawn, the mouse and the keyboard. A port of CanvasView.swift (Paul's SwiftUI SVG editor):
// the artboard with an optional grid, shapes drawn in layer order, a drawing preview while dragging, selection boxes with handles, click or drag to
// draw with the current tool (the tool goes back to Select afterwards, as in his editor), click to select, drag to move, drag a handle to resize.
// Added for this tool: every action also by keyboard (a keyboard cursor in the drawing tools; arrow keys move or resize the selection; Tab walks the
// shapes), snapping to the braille dot grid, polyline/polygon by clicks, and spoken (live-region) feedback for every change.
import { MM } from './constants.mjs';
import { TactileDoc, makeShape, hitTest, handlesFor, dragHandle, bbox, translateShape, scaleShape } from './model.mjs';
import { writeSvg } from './svg-io.mjs';
import { describeShape, shapeName, cellAt } from './describe.mjs';

export const TOOLS = [
  { id: 'select', key: 'v', name: 'Select', hint: 'Click a shape to select it, drag to move it, drag a handle to resize it.' },
  { id: 'line', key: 'l', name: 'Line', hint: 'Drag from one end to the other.' },
  { id: 'polyline', key: 'p', name: 'Polyline', hint: 'Click each corner; double-click to finish.' },
  { id: 'polygon', key: 'g', name: 'Polygon', hint: 'Click each corner; double-click to close the shape.' },
  { id: 'rect', key: 'r', name: 'Rectangle', hint: 'Drag from one corner to the opposite corner.' },
  { id: 'ellipse', key: 'e', name: 'Ellipse', hint: 'Drag across the ellipse.' },
  { id: 'circle', key: 'c', name: 'Circle', hint: 'Drag from the centre outwards.' },
  { id: 'text', key: 't', name: 'Label', hint: 'Click where the braille label goes.' },
  { id: 'symbol', key: 's', name: 'Point symbol', hint: 'Click where the point symbol goes.' },
];
const PX_PER_MM = 3;
const svgInner = (text) => text.replace(/^<svg[^>]*>\n?/, '').replace(/<\/svg>\s*$/, '');
const num = (v) => Math.round(v * 1000) / 1000;

export function createStage(ctx) {
  const { doc, state } = ctx;
  const el = document.createElement('div');
  el.className = 'td-stage';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'td-svg');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', 'Drawing area');
  svg.setAttribute('aria-describedby', 'tdKeys');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  el.appendChild(svg);

  let gesture = null;          // the drag in progress: {type:'move'|'handle'|'draw'|..., ...}
  let lastNudge = 0;
  const pxmm = () => PX_PER_MM * state.zoom;

  // ------------------------------------------------------------------ drawing
  function draftShape() {
    const d = state.draft;
    if (!d) return null;
    const { tool } = d;
    const a = d.a, b = d.b || d.a;
    const st = { line: state.line, texture: state.texture };
    if (tool === 'line') return makeShape('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, line: st.line });
    if (tool === 'rect') return makeShape('rect', { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), line: st.line, texture: st.texture });
    if (tool === 'ellipse') return makeShape('ellipse', { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2, line: st.line, texture: st.texture });
    if (tool === 'circle') { const r = Math.hypot(b.x - a.x, b.y - a.y); return makeShape('ellipse', { cx: a.x, cy: a.y, rx: r, ry: r, line: st.line, texture: st.texture }); }
    if (tool === 'polyline' || tool === 'polygon') {
      const pts = [...d.pts, ...(d.b ? [d.b] : [])];
      if (pts.length < 2) return null;
      return makeShape(tool, { points: pts.map((p) => ({ x: p.x, y: p.y })), line: st.line, texture: st.texture });
    }
    return null;
  }
  const tmpMarkup = (shape) => { const t = new TactileDoc({ cells: doc.cells, lines: doc.lines }); t.attach(shape); return svgInner(writeSvg(t)); };

  function overlay() {
    const px = pxmm();
    const hs = 4 / px;                        // half a handle, 4 px, in mm
    let o = '';
    if (state.warnIds && state.warnIds.size) {
      for (const id of state.warnIds) { const s = doc.find(id); if (!s || !s.visible) continue; const b = bbox(s); o += `<rect class="td-warn" x="${num(b.x - 1.5)}" y="${num(b.y - 1.5)}" width="${num(b.width + 3)}" height="${num(b.height + 3)}"/>`; }
    }
    for (const s of doc.selected()) {
      const b = bbox(s);
      o += `<rect class="td-sel" x="${num(b.x - 1)}" y="${num(b.y - 1)}" width="${num(b.width + 2)}" height="${num(b.height + 2)}"/>`;
    }
    const sel = doc.selected();
    if (sel.length === 1 && !sel[0].locked && state.tool === 'select') {
      for (const h of handlesFor(sel[0])) o += `<rect class="td-handle" data-handle="${h.id}" x="${num(h.x - hs)}" y="${num(h.y - hs)}" width="${num(hs * 2)}" height="${num(hs * 2)}"/>`;
    }
    const draft = draftShape();
    if (draft) o += `<g class="td-draft">${tmpMarkup(draft)}</g>`;
    if (state.tool !== 'select' && (state.cursorShown || state.focused)) {
      const c = state.cursor, r = 3;
      o += `<g class="td-cursor"><line x1="${num(c.x - r)}" y1="${num(c.y)}" x2="${num(c.x + r)}" y2="${num(c.y)}"/><line x1="${num(c.x)}" y1="${num(c.y - r)}" x2="${num(c.x)}" y2="${num(c.y + r)}"/></g>`;
    }
    return o;
  }

  function render() {
    const W = doc.width, H = doc.height, px = pxmm();
    svg.setAttribute('width', String(Math.round(W * px)));
    svg.setAttribute('height', String(Math.round(H * px)));
    svg.setAttribute('viewBox', `0 0 ${num(W)} ${num(H)}`);
    const page = doc.page;
    let m = `<defs><pattern id="td-grid" width="${MM.dot}" height="${MM.dot}" patternUnits="userSpaceOnUse"><circle cx="${MM.dot / 2}" cy="${MM.dot / 2}" r="0.28" class="td-gridpt"/></pattern></defs>`;
    m += `<rect class="td-paper" x="0" y="0" width="${num(W)}" height="${num(H)}"/>`;
    if (doc.grid.show) m += `<rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="url(#td-grid)" pointer-events="none"/>`;
    m += `<rect class="td-page" x="0" y="0" width="${num(page.width)}" height="${num(page.height)}"/>`;
    m += `<g class="td-content">${svgInner(writeSvg(doc))}</g>`;
    m += `<g class="td-overlay">${overlay()}</g>`;
    svg.innerHTML = m;
    svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
  }

  // ------------------------------------------------------------------ pointer
  function toMm(e) {
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * doc.width, y: ((e.clientY - r.top) / r.height) * doc.height };
  }
  const snapped = (p) => doc.snapPoint(p);
  const tolMm = () => 6 / pxmm();
  const handleAt = (p) => {
    const sel = doc.selected();
    if (sel.length !== 1 || sel[0].locked || state.tool !== 'select') return null;
    const t = 8 / pxmm();
    return handlesFor(sel[0]).find((h) => Math.abs(h.x - p.x) <= t && Math.abs(h.y - p.y) <= t) || null;
  };

  function finishDraw(tool, a, b, clicked) {
    const st = { line: state.line, texture: state.texture };
    const d = (v) => (clicked ? v : 0);
    let shape = null;
    if (tool === 'line') shape = clicked ? makeShape('line', { x1: a.x, y1: a.y, x2: a.x + 25, y2: a.y, line: st.line }) : makeShape('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, line: st.line });
    else if (tool === 'rect') shape = clicked ? makeShape('rect', { x: a.x, y: a.y, width: 25, height: 20, ...st }) : draftShape();
    else if (tool === 'ellipse') shape = clicked ? makeShape('ellipse', { cx: a.x + 12.5, cy: a.y + 10, rx: 12.5, ry: 10, ...st }) : draftShape();
    else if (tool === 'circle') shape = clicked ? makeShape('ellipse', { cx: a.x, cy: a.y, rx: 12.5, ry: 12.5, ...st }) : draftShape();
    void d;
    if (!shape) return null;
    doc.add(shape);
    state.draft = null;
    ctx.setTool('select', { quiet: true });
    ctx.changed();
    ctx.announce(`Added ${describeShape(doc, shape)}.`);
    return shape;
  }
  function finishPoly(close) {
    const d = state.draft;
    if (!d) return;
    const pts = d.pts.filter((p, i) => i === 0 || Math.hypot(p.x - d.pts[i - 1].x, p.y - d.pts[i - 1].y) > 1e-6);
    state.draft = null;
    const need = d.tool === 'polygon' ? 3 : 2;
    if (pts.length < need) { ctx.announce(`A ${d.tool} needs at least ${need} points. Nothing was added.`); render(); return; }
    const shape = makeShape(d.tool, { points: pts.map((p) => ({ x: p.x, y: p.y })), line: state.line, texture: state.texture });
    void close;
    doc.add(shape);
    ctx.setTool('select', { quiet: true });
    ctx.changed();
    ctx.announce(`Added ${describeShape(doc, shape)}.`);
  }
  function placeText(p) {
    const label = ctx.makeLabel('Label');
    const shape = makeShape('text', { x: p.x, y: p.y, text: label.print, braille: label.braille });
    doc.add(shape);
    ctx.setTool('select', { quiet: true });
    ctx.changed();
    ctx.announce(`Added a label. Type its text in the Label text box.`);
    ctx.focusLabelText();
  }
  function placeSymbol(p) {
    const shape = makeShape('symbol', { cx: p.x, cy: p.y, size: 7.5, symbol: state.symbol });
    doc.add(shape);
    ctx.setTool('select', { quiet: true });
    ctx.changed();
    ctx.announce(`Added ${describeShape(doc, shape)}.`);
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    svg.focus();
    const raw = toMm(e);
    const p = snapped(raw);
    state.cursor = p;
    if (state.tool === 'select') {
      const h = handleAt(raw);
      if (h) {
        const s = doc.selected()[0];
        doc.checkpoint();
        gesture = { type: 'handle', id: h.id, shape: s, original: structuredClone(s), moved: false };
      } else {
        const hit = hitTest(doc, raw, tolMm());
        if (hit) {
          if (e.shiftKey) doc.toggleSelection(hit.id);
          else if (!doc.selection.has(hit.id)) doc.select(hit.id);
          doc.checkpoint();
          gesture = { type: 'move', start: raw, startSnap: p, originals: new Map(doc.selected().map((s) => [s.id, structuredClone(s)])), moved: false };
          if (doc.selection.size === 1) ctx.announce(`Selected ${describeShape(doc, hit)}.`);
        } else {
          if (!e.shiftKey) doc.deselectAll();
          gesture = null;
        }
      }
      ctx.changed({ selection: true });
    } else if (state.tool === 'polyline' || state.tool === 'polygon') {
      if (!state.draft) state.draft = { tool: state.tool, pts: [p], b: p };
      else { const last = state.draft.pts[state.draft.pts.length - 1]; if (Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) state.draft.pts.push(p); state.draft.b = p; }
      render();
    } else if (state.tool === 'text') placeText(p);
    else if (state.tool === 'symbol') placeSymbol(p);
    else {
      state.draft = { tool: state.tool, a: p, b: p, pointer: true };
      gesture = { type: 'draw', start: p, moved: false };
      render();
    }
    try { svg.setPointerCapture(e.pointerId); } catch { /* not all pointers can be captured */ }
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    const raw = toMm(e);
    const p = snapped(raw);
    if (!gesture) {
      if (state.draft && (state.draft.tool === 'polyline' || state.draft.tool === 'polygon')) { state.draft.b = p; state.cursor = p; render(); }
      return;
    }
    if (gesture.type === 'move') {
      const sx = raw.x - gesture.start.x, sy = raw.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(sx, sy) * pxmm() < 3) return;        // a click, not a drag
      gesture.moved = true;
      // snap the moved shape's top-left corner to the dot grid, so what was on the grid stays on it
      const first = [...gesture.originals.values()][0];
      const ob = bbox(first);
      const target = doc.snapPoint({ x: ob.x + sx, y: ob.y + sy });
      const dx = target.x - ob.x, dy = target.y - ob.y;
      for (const s of doc.selected()) { const o = gesture.originals.get(s.id); if (!o || s.locked) continue; Object.assign(s, structuredClone(o)); translateShape(s, dx, dy); }
      render();
    } else if (gesture.type === 'handle') {
      gesture.moved = true;
      dragHandle(gesture.shape, gesture.original, gesture.id, p);
      render();
    } else if (gesture.type === 'draw') {
      gesture.moved = true;
      state.draft.b = p;
      render();
    }
  });

  const endGesture = (e) => {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.type === 'move' || g.type === 'handle') {
      if (!g.moved) { doc.discardCheckpoint(); }
      else { ctx.announce(doc.selection.size === 1 ? `Moved ${describeShape(doc, doc.selected()[0])}.` : `Moved ${doc.selection.size} shapes.`); }
      ctx.changed();
    } else if (g.type === 'draw') {
      const a = g.start, b = state.draft ? state.draft.b : a;
      const clicked = Math.hypot(b.x - a.x, b.y - a.y) < 1;
      finishDraw(state.tool, a, b, clicked);
    }
    void e;
  };
  svg.addEventListener('pointerup', endGesture);
  svg.addEventListener('pointercancel', () => { if (gesture && gesture.moved && (gesture.type === 'move' || gesture.type === 'handle')) { doc.undo(); } gesture = null; state.draft = null; ctx.changed(); });
  svg.addEventListener('dblclick', (e) => {
    if (state.draft && (state.draft.tool === 'polyline' || state.draft.tool === 'polygon')) { finishPoly(); e.preventDefault(); return; }
    if (state.tool === 'select') { const s = doc.selected()[0]; if (s && s.kind === 'text') ctx.focusLabelText(); else if (s) ctx.focusInspector(); }
  });

  // ------------------------------------------------------------------ keyboard
  const step = (e) => (doc.snap.on ? doc.snap.step : 1) * (e.shiftKey ? 5 : 1);
  function moveCursor(dx, dy) {
    const c = state.cursor;
    const p = { x: Math.max(0, Math.min(doc.width, num(c.x + dx))), y: Math.max(0, Math.min(doc.height, num(c.y + dy))) };
    state.cursor = p;
    state.cursorShown = true;
    if (state.draft) state.draft.b = p;
    render();
    ctx.announce(`${num(p.x)}, ${num(p.y)} millimetres, ${cellAt(p, MM)}.`);
  }
  function nudge(e, dx, dy) {
    const sel = doc.selected().filter((s) => !s.locked);
    if (!sel.length) return false;
    const now = Date.now();
    if (now - lastNudge > 800) doc.checkpoint();       // a run of key presses is one undo step
    lastNudge = now;
    if (e.altKey) {
      for (const s of sel) { const b = bbox(s); if (s.kind === 'text') continue; scaleShape(s, b, { x: b.x, y: b.y, width: Math.max(1, b.width + dx), height: Math.max(1, b.height + dy) }); }
      ctx.announce(`Resized ${doc.selection.size === 1 ? describeShape(doc, sel[0]) : doc.selection.size + ' shapes'}.`);
    } else {
      doc.moveSelected(dx, dy);
      ctx.announce(doc.selection.size === 1 ? `Moved to ${num(bbox(sel[0]).x)}, ${num(bbox(sel[0]).y)} millimetres, ${cellAt(bbox(sel[0]), MM)}.` : `Moved ${doc.selection.size} shapes.`);
    }
    ctx.changed();
    return true;
  }
  function tab(e) {
    const list = doc.shapes.filter((s) => s.visible && !s.locked);
    if (!list.length) return false;
    const cur = list.findIndex((s) => doc.selection.has(s.id));
    let next;
    if (e.shiftKey) { if (cur < 0) return false; next = cur - 1; if (next < 0) { return false; } }
    else { next = cur + 1; if (next >= list.length) return false; }
    doc.select(list[next].id);
    ctx.changed({ selection: true });
    ctx.announce(`${describeShape(doc, list[next])}. ${next + 1} of ${list.length}.`);
    return true;
  }
  function enterKey() {
    const t = state.tool, c = state.cursor;
    if (t === 'select') { const s = doc.selected()[0]; if (!s) return; if (s.kind === 'text') ctx.focusLabelText(); else ctx.focusInspector(); return; }
    if (t === 'text') return placeText(c);
    if (t === 'symbol') return placeSymbol(c);
    if (t === 'polyline' || t === 'polygon') {
      if (!state.draft) { state.draft = { tool: t, pts: [c], b: c }; ctx.announce(`Started at ${num(c.x)}, ${num(c.y)}. Move with the arrow keys, Enter adds a corner, Space finishes, Escape cancels.`); }
      else { state.draft.pts.push(c); state.draft.b = c; ctx.announce(`Corner ${state.draft.pts.length} added.`); }
      return render();
    }
    if (!state.draft) { state.draft = { tool: t, a: c, b: c }; ctx.announce(`Started at ${num(c.x)}, ${num(c.y)}. Move with the arrow keys, Enter finishes, Escape cancels.`); return render(); }
    const a = state.draft.a;
    finishDraw(t, a, c, Math.hypot(c.x - a.x, c.y - a.y) < 1);
  }
  svg.addEventListener('focus', () => { state.focused = true; if (state.tool !== 'select') render(); });
  svg.addEventListener('blur', () => { state.focused = false; if (state.tool !== 'select') render(); });
  svg.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    let handled = true;
    if (mod && (k === 'z' || k === 'Z')) { e.shiftKey ? ctx.redo() : ctx.undo(); }
    else if (mod && (k === 'y' || k === 'Y')) ctx.redo();
    else if (mod && (k === 'd' || k === 'D')) ctx.duplicate();
    else if (mod && (k === 'a' || k === 'A')) { doc.selectAll(); ctx.changed({ selection: true }); ctx.announce(`${doc.selection.size} shapes selected.`); }
    else if (mod && (k === 'g' || k === 'G')) { e.shiftKey ? ctx.ungroup() : ctx.group(); }
    else if (mod || e.altKey && !arrows[k]) handled = false;
    else if (arrows[k]) {
      const [ax, ay] = arrows[k];
      const sz = step(e);
      if (state.tool === 'select') handled = nudge(e, ax * sz, ay * sz);
      else moveCursor(ax * sz, ay * sz);
    }
    else if (k === 'Tab') handled = tab(e);
    else if (k === 'Delete' || k === 'Backspace') ctx.deleteSelected();
    else if (k === 'Enter') enterKey();
    else if (k === ' ' && state.draft && (state.draft.tool === 'polyline' || state.draft.tool === 'polygon')) finishPoly();
    else if (k === ' ') handled = false;
    else if (k === 'Escape') {
      if (state.draft) { state.draft = null; ctx.announce('Cancelled.'); render(); }
      else if (state.tool !== 'select') ctx.setTool('select');
      else if (doc.selection.size) { doc.deselectAll(); ctx.changed({ selection: true }); ctx.announce('Nothing selected.'); }
      else handled = false;       // not ours: the dialog closes
      if (handled) state.escHandled = Date.now();
    }
    else if (k === '+' || k === '=') ctx.zoomBy(1.25);
    else if (k === '-') ctx.zoomBy(0.8);
    else if (k === '0') ctx.zoomFit();
    else if (k === '?') ctx.showHelp();
    else if (!e.shiftKey || k.length === 1) {
      const t = TOOLS.find((x) => x.key === k.toLowerCase());
      if (t) ctx.setTool(t.id); else handled = false;
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });

  return { el, svg, render, toMm, pxmm };
}
