// W14 (Paul, 4 Nov 2026): the tactile drawing tool, ported from his SwiftUI SVG editor (Sensory SVGEditor/SVGEditor/*.swift) to JavaScript.
// Model-level tests, no browser: path syntax (SVGPathParser.swift), SVG parse -> model -> write round trip (SVGParser.swift / SVGWriter.swift),
// undo/redo (SVGDocument.swift saveUndoState/undo/redo), snapping (snappedPoint), selection and hit testing, z-order and grouping, and the
// tactile layer (BANA "Guidelines and Standards for Tactile Graphics", 2010 web edition: 3.2.2, 3.4.2, 3.4.3.x, 5.7.1, 5.9, 5.10.1).
// Every expectation here is new (no existing expectation is changed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parsePathData, pathToD, flattenPath, pathBounds } from '../web/tactile-draw/path.mjs';
import { TactileDoc, makeShape, bbox, translateShape, scaleShape, snapValue, hitTest } from '../web/tactile-draw/model.mjs';
import { parseSvg, writeSvg } from '../web/tactile-draw/svg-io.mjs';
import { LINE_STYLES, TEXTURES, SYMBOLS, LIMITS, MM, checkDrawing, buildKey, translateLabel, labelBox, usedStyles } from '../web/tactile-draw/tactile.mjs';

const DOMParser = new JSDOM('').window.DOMParser;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// ---- path syntax: the cases SVGPathParser.swift tokenises and runs ----
test('path: M with extra pairs is an implicit L (SVGPathParser "M 10 20 30 40")', () => {
  const s = parsePathData('M 10 20 30 40');
  assert.deepEqual(s.map((x) => x.c), ['M', 'L']);
  assert.deepEqual(s[1].p, [30, 40]);
});
test('path: m/l/h/v/H/V relative and absolute become absolute segments', () => {
  const s = parsePathData('m10,10 l5,5 h10 v-5 H0 V0 z');
  assert.deepEqual(s.map((x) => x.c), ['M', 'L', 'L', 'L', 'L', 'L', 'Z']);
  assert.deepEqual(s[1].p, [15, 15]);
  assert.deepEqual(s[2].p, [25, 15]);
  assert.deepEqual(s[3].p, [25, 10]);
  assert.deepEqual(s[4].p, [0, 10]);
  assert.deepEqual(s[5].p, [0, 0]);
});
test('path: a minus sign and a second decimal point start a new number ("1.5.3", "10-5")', () => {
  assert.deepEqual(parsePathData('M1.5.3 L10-5').map((x) => x.p), [[1.5, 0.3], [10, -5]]);
});
test('path: exponent numbers parse (the Swift tokeniser could not; a deliberate improvement)', () => {
  assert.deepEqual(parsePathData('M1e1 2E0')[0].p, [10, 2]);
});
test('path: c, s, q, t keep the reflected control point (SVGPathParser S/T)', () => {
  const s = parsePathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0 Q 25 5 30 0 T 40 0');
  assert.deepEqual(s.map((x) => x.c), ['M', 'C', 'C', 'Q', 'Q']);
  assert.deepEqual(s[2].p.slice(0, 2), [10, -10]);          // reflection of (10,10) over (10,0)
  assert.deepEqual(s[4].p.slice(0, 2), [35, -5]);           // reflection of (25,5) over (30,0)
});
test('path: an arc becomes cubic curves ending at the same point; zero radius is a line', () => {
  const s = parsePathData('M0 0 A 10 10 0 0 1 20 0');
  assert.ok(s.slice(1).every((x) => x.c === 'C'));
  assert.deepEqual(s[s.length - 1].p.slice(-2).map((v) => Math.round(v * 1000) / 1000), [20, 0]);
  const b = pathBounds(s);
  near(b.y, -10, 0.5); assert.ok(b.height > 9 && b.height < 10.5, `arc bulge ${b.height}`);
  assert.equal(parsePathData('M0 0 A 0 5 0 0 1 20 0')[1].c, 'L');
});
test('path: implicit repeats after L/C and bad data do not throw', () => {
  assert.equal(parsePathData('M0 0 L1 1 2 2 3 3').length, 4);
  assert.deepEqual(parsePathData(''), []);
  assert.doesNotThrow(() => parsePathData('M L Q 5 ! zz'));
});
test('path: Z returns the current point to the start for the next relative command', () => {
  const s = parsePathData('M10 10 l10 0 z l5 5');
  assert.deepEqual(s[s.length - 1].p, [15, 15]);
});
test('path: pathToD writes absolute data that parses back to the same segments; flatten and bounds', () => {
  const d = 'M0 0 C 0 10 10 10 10 0 L 10 -5 Z';
  const s = parsePathData(d);
  assert.deepEqual(parsePathData(pathToD(s)), s);
  const subs = flattenPath(s, 8);
  assert.equal(subs.length, 1); assert.ok(subs[0].length > 8);
  const b = pathBounds(s);
  near(b.x, 0); near(b.width, 10); near(b.y, -5);
});

// ---- SVG parse -> model -> write ----
const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect x="10" y="10" width="50" height="30" rx="2" fill="#4a90d9" stroke="#000" stroke-width="2" id="box"/>
  <circle cx="100" cy="30" r="10" fill="none" stroke="black"/>
  <ellipse cx="140" cy="30" rx="15" ry="8" fill="#ff0000" stroke="none"/>
  <line x1="5" y1="90" x2="95" y2="90" stroke="#000" stroke-width="1" stroke-dasharray="8,4"/>
  <polyline points="110,90 120,70 130,90" fill="none" stroke="#000"/>
  <polygon points="150,90 170,90 160,70" fill="#4a90d9" stroke="#000"/>
  <path d="M 20 60 C 20 50, 40 50, 40 60 s 10 10 20 0" fill="none" stroke="#000"/>
  <text x="70" y="55" font-size="12">Lake</text>
  <g id="pair"><rect x="0" y="0" width="5" height="5" fill="none" stroke="#000"/><line x1="0" y1="0" x2="5" y2="5" stroke="#000"/></g>
  <image href="a.png" x="0" y="0" width="1" height="1"/>
</svg>`;

test('svg: parse reads every shape kind Paul\'s parser reads, and reports what it could not import', () => {
  const r = parseSvg(SAMPLE, { DOMParser });
  const kinds = r.doc.shapes.map((s) => s.kind);
  assert.deepEqual(kinds, ['rect', 'ellipse', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'group']);
  assert.equal(r.doc.width, 200); assert.equal(r.doc.height, 100);
  assert.equal(r.doc.shapes[0].name, 'box');
  assert.equal(r.doc.shapes[8].children.length, 2);
  assert.equal(r.skipped.length, 1); assert.match(r.skipped[0], /image/);
});
test('svg: a dash array becomes the dashed line style; two fill colours become two textures; no fill is no texture', () => {
  const d = parseSvg(SAMPLE, { DOMParser }).doc;
  const [rect, circle, ellipse, line, , polygon] = d.shapes;
  assert.equal(line.line, 'dashed');
  assert.notEqual(rect.texture, 'none');
  assert.equal(circle.texture, 'none');
  assert.notEqual(ellipse.texture, rect.texture);
  assert.equal(polygon.texture, rect.texture, 'the same colour keeps the same texture');
  assert.equal(ellipse.line, 'none', 'stroke="none" is no outline');
});
test('svg: write then parse gives the same model (round trip), twice over', () => {
  const first = parseSvg(SAMPLE, { DOMParser }).doc;
  const svg1 = writeSvg(first);
  const second = parseSvg(svg1, { DOMParser }).doc;
  assert.deepEqual(second.toPlain(), first.toPlain());
  assert.equal(writeSvg(second), svg1, 'writing is stable');
  assert.match(svg1, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg1, /data-tactile-draw="1"/);
});
test('svg: only the patterns in use are defined, and they are referenced by url(#tx-...)', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  d.add(makeShape('rect', { x: 0, y: 0, width: 30, height: 30, texture: 'hatch' }));
  const svg = writeSvg(d);
  assert.match(svg, /<pattern id="tx-hatch"/);
  assert.doesNotMatch(svg, /id="tx-dots"/);
  assert.match(svg, /fill="url\(#tx-hatch\)"/);
  assert.equal(parseSvg(svg, { DOMParser }).doc.shapes[0].texture, 'hatch');
});
test('svg: a label is written with a halo, its braille and its print text, and reads back', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  d.add(makeShape('text', { x: 20, y: 20, text: 'Lake', braille: '⠠⠇⠁⠅⠑' }));
  const svg = writeSvg(d);
  assert.match(svg, /data-print="Lake"/);
  assert.match(svg, /<rect class="halo"/);
  assert.match(svg, />⠠⠇⠁⠅⠑<\/text>/);
  const back = parseSvg(svg, { DOMParser }).doc.shapes[0];
  assert.equal(back.kind, 'text'); assert.equal(back.text, 'Lake'); assert.equal(back.braille, '⠠⠇⠁⠅⠑');
});
test('svg: a point symbol is written and read back as a symbol', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  d.add(makeShape('symbol', { cx: 30, cy: 30, size: 8, symbol: 'triangle' }));
  const back = parseSvg(writeSvg(d), { DOMParser }).doc.shapes[0];
  assert.deepEqual([back.kind, back.symbol, back.size, back.cx], ['symbol', 'triangle', 8, 30]);
});
test('svg: text, attributes and names with markup characters are escaped', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  const s = d.add(makeShape('text', { x: 1, y: 1, text: 'a<b & "c"', braille: '⠁' }));
  s.name = 'x"><script>';
  const svg = writeSvg(d);
  assert.doesNotMatch(svg, /<script/);
  const doc2 = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;   // well-formed XML
  assert.equal(doc2.documentElement.localName, 'svg');
  assert.equal(parseSvg(svg, { DOMParser }).doc.shapes[0].text, 'a<b & "c"');
});
test('svg: a transform (translate, scale, matrix) is baked into the shape; hidden shapes are not written', () => {
  const r = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(10,20)"><line x1="0" y1="0" x2="10" y2="0" stroke="#000"/></g><rect x="0" y="0" width="10" height="10" transform="scale(2)" stroke="#000" fill="none"/><rect x="0" y="0" width="10" height="10" transform="rotate(45)" stroke="#000" fill="none"/></svg>`, { DOMParser });
  const [g, rect, rot] = r.doc.shapes;
  assert.deepEqual([g.children[0].x1, g.children[0].y1], [10, 20]);
  assert.deepEqual([rect.width, rect.height], [20, 20]);
  assert.equal(rot.kind, 'path', 'a turned rectangle becomes a path');
  rect.visible = false;
  assert.equal((writeSvg(r.doc).match(/<rect/g) || []).length, 0 + 0);
});
test('svg: malformed input is reported, not thrown', () => {
  const r = parseSvg('<svg><rect', { DOMParser });
  assert.equal(r.doc, null); assert.match(r.error, /./);
  assert.equal(parseSvg('<html/>', { DOMParser }).doc, null);
});
test('svg: a script or event handler in an imported file does not survive the write', () => {
  const r = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><rect width="5" height="5" onclick="y()" stroke="#000" fill="none"/></svg>`, { DOMParser });
  const svg = writeSvg(r.doc);
  assert.doesNotMatch(svg, /script|onload|onclick/);
});

// ---- undo / redo ----
test('undo and redo restore the shapes (SVGDocument.undo/redo), clear the selection, and cap at 50 steps', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  const a = d.add(makeShape('rect', { x: 0, y: 0, width: 20, height: 20 }));
  d.add(makeShape('line', { x1: 0, y1: 0, x2: 10, y2: 10 }));
  assert.equal(d.shapes.length, 2);
  assert.ok(d.undo()); assert.equal(d.shapes.length, 1);
  assert.deepEqual([...d.selection], [], 'selection cleared after undo');
  assert.ok(d.redo()); assert.equal(d.shapes.length, 2);
  d.select(a.id); d.checkpoint(); d.moveSelected(5, 5);
  assert.equal(d.shapes[0].x, 5);
  d.undo(); assert.equal(d.shapes[0].x, 0);
  d.redo(); assert.equal(d.shapes[0].x, 5);
  assert.equal(d.undo() && d.undo() && d.undo() && d.undo(), false, 'nothing left to undo');
  for (let i = 0; i < 80; i++) d.add(makeShape('rect', { x: i, y: 0, width: 5, height: 5 }));
  let n = 0; while (d.undo()) n++;
  assert.equal(n, 50);
  assert.equal(d.canUndo(), false);
});
test('a new change after an undo clears the redo stack', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  d.add(makeShape('rect', { x: 0, y: 0, width: 20, height: 20 }));
  d.undo(); assert.equal(d.canRedo(), true);
  d.add(makeShape('rect', { x: 0, y: 0, width: 20, height: 20 }));
  assert.equal(d.canRedo(), false);
});

// ---- snapping ----
test('snapValue snaps to the braille dot grid (2.5 mm) and does nothing when off', () => {
  assert.equal(MM.dot, 2.5);
  assert.equal(snapValue(3.9, 2.5), 5);
  assert.equal(snapValue(1.2, 2.5), 2.5 * 0 + 0);
  assert.equal(snapValue(7.4, 2.5), 7.5);
  const d = new TactileDoc({ cells: 38, lines: 25 });
  assert.deepEqual(d.snapPoint({ x: 3.9, y: 6.4 }), { x: 5, y: 7.5 });
  d.snap.on = false;
  assert.deepEqual(d.snapPoint({ x: 3.9, y: 6.4 }), { x: 3.9, y: 6.4 });
  assert.equal(d.page.width, 38 * MM.cell); assert.equal(d.page.height, 25 * MM.line);
});

// ---- selection, move, resize, hit test, z-order, group ----
test('move and scale work on every kind (move = translate, resize = scale into a new box)', () => {
  const kinds = [
    makeShape('rect', { x: 10, y: 10, width: 20, height: 10 }),
    makeShape('ellipse', { cx: 20, cy: 15, rx: 10, ry: 5 }),
    makeShape('line', { x1: 10, y1: 10, x2: 30, y2: 20 }),
    makeShape('polyline', { points: [{ x: 10, y: 10 }, { x: 30, y: 20 }, { x: 20, y: 15 }] }),
    makeShape('polygon', { points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }] }),
    makeShape('path', { segs: parsePathData('M10 10 L30 10 L30 20 Z') }),
  ];
  for (const s of kinds) {
    const b = bbox(s);
    near(b.x, 10); near(b.y, 10); near(b.width, 20); near(b.height, 10);
    translateShape(s, 5, -5);
    const m = bbox(s); near(m.x, 15); near(m.y, 5);
    scaleShape(s, m, { x: 0, y: 0, width: 40, height: 30 });
    const r = bbox(s); near(r.x, 0); near(r.y, 0); near(r.width, 40); near(r.height, 30);
  }
});
test('hit test: topmost first, line within tolerance, filled shape inside, hidden and locked skipped', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  const r = d.add(makeShape('rect', { x: 10, y: 10, width: 40, height: 40, texture: 'dots' }));
  const l = d.add(makeShape('line', { x1: 0, y1: 30, x2: 100, y2: 30 }));
  assert.equal(hitTest(d, { x: 30, y: 31 }, 2).id, l.id);
  assert.equal(hitTest(d, { x: 30, y: 40 }, 2).id, r.id);
  assert.equal(hitTest(d, { x: 80, y: 80 }, 2), null);
  l.locked = true; assert.equal(hitTest(d, { x: 30, y: 31 }, 2).id, r.id);
  r.visible = false; assert.equal(hitTest(d, { x: 30, y: 31 }, 2), null);
});
test('z-order moves (front, forward, backward, back) and selection ops (SVGDocument)', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  const [a, b, c] = [1, 2, 3].map((i) => d.add(makeShape('rect', { x: i, y: 0, width: 5, height: 5 })));
  d.select(a.id); d.bringToFront(); assert.deepEqual(d.shapes.map((s) => s.id), [b.id, c.id, a.id]);
  d.sendToBack(); assert.deepEqual(d.shapes.map((s) => s.id), [a.id, b.id, c.id]);
  d.bringForward(); assert.deepEqual(d.shapes.map((s) => s.id), [b.id, a.id, c.id]);
  d.sendBackward(); assert.deepEqual(d.shapes.map((s) => s.id), [a.id, b.id, c.id]);
  d.selectAll(); assert.equal(d.selection.size, 3);
  d.deleteSelected(); assert.equal(d.shapes.length, 0);
  d.undo(); assert.equal(d.shapes.length, 3);
});
test('group and ungroup keep the shapes; duplicate offsets the copy; cycle selection walks the shapes', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  const a = d.add(makeShape('rect', { x: 0, y: 0, width: 5, height: 5 }));
  const b = d.add(makeShape('rect', { x: 20, y: 0, width: 5, height: 5 }));
  d.select(a.id); d.addToSelection(b.id);
  const g = d.groupSelected();
  assert.equal(d.shapes.length, 1); assert.equal(g.children.length, 2);
  near(bbox(g).width, 25);
  d.ungroupSelected(); assert.equal(d.shapes.length, 2);
  d.select(a.id); const copy = d.duplicateSelected();
  assert.equal(copy.x, a.x + MM.dot * 2); assert.equal(d.shapes.length, 3);
  d.deselectAll(); d.cycleSelection(1); assert.equal([...d.selection][0], d.shapes[0].id);
  d.cycleSelection(-1); assert.equal([...d.selection][0], d.shapes[d.shapes.length - 1].id);
});

// ---- the tactile layer ----
test('limits and palettes: five of each per graphic (BANA 3.2.2), distinct names, a pattern per texture', () => {
  assert.deepEqual([LIMITS.textures, LIMITS.lines, LIMITS.symbols], [5, 5, 5]);
  for (const set of [LINE_STYLES, TEXTURES, SYMBOLS]) {
    assert.ok(set.length >= 5);
    assert.equal(new Set(set.map((x) => x.id)).size, set.length);
    assert.equal(new Set(set.map((x) => x.name)).size, set.length);
  }
  assert.ok(TEXTURES.every((t) => /<pattern id="tx-/.test(t.pattern)));
});
test('check: more than five textures, line styles or symbols is warned (3.2.2)', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  TEXTURES.slice(0, 6).forEach((t, i) => d.add(makeShape('rect', { x: i * 30, y: 0, width: 25, height: 25, texture: t.id })));
  LINE_STYLES.slice(0, 6).forEach((l, i) => d.add(makeShape('line', { x1: 0, y1: 40 + i * 10, x2: 60, y2: 40 + i * 10, line: l.id })));
  SYMBOLS.slice(0, 6).forEach((s, i) => d.add(makeShape('symbol', { cx: 10 + i * 20, cy: 150, size: 7, symbol: s.id })));
  const codes = checkDrawing(d).map((w) => w.code);
  for (const c of ['too-many-textures', 'too-many-lines', 'too-many-symbols']) assert.ok(codes.includes(c), c);
  const u = usedStyles(d); assert.equal(u.textures.length, 6);
  const ok = new TactileDoc({ cells: 38, lines: 25 });
  TEXTURES.slice(0, 5).forEach((t, i) => ok.add(makeShape('rect', { x: i * 30, y: 0, width: 25, height: 25, texture: t.id })));
  assert.ok(!checkDrawing(ok).some((w) => w.code === 'too-many-textures'), 'exactly five is allowed');
});
test('check: too-small areas (3.4.3.1), short primary lines (3.4.3.2) and small symbols (3.4.3.11)', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  const r = d.add(makeShape('rect', { x: 0, y: 0, width: 4, height: 4, texture: 'dots' }));
  const l = d.add(makeShape('line', { x1: 0, y1: 50, x2: 8, y2: 50 }));
  const s = d.add(makeShape('symbol', { cx: 50, cy: 50, size: 4, symbol: 'square' }));
  const big = d.add(makeShape('rect', { x: 100, y: 0, width: 30, height: 30, texture: 'dots' }));
  const w = checkDrawing(d);
  const by = (c) => w.filter((x) => x.code === c).flatMap((x) => x.ids);
  assert.deepEqual(by('area-too-small'), [r.id]);
  assert.deepEqual(by('line-too-short'), [l.id]);
  assert.deepEqual(by('symbol-too-small'), [s.id]);
  assert.ok(!w.some((x) => x.ids.includes(big.id)));
  assert.ok(w.every((x) => /BANA/.test(x.rule) && x.message.length > 10));
});
test('check: a label closer than 3 mm to a line is warned (3.4.3.12); inside a shape or far away is not', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  d.add(makeShape('line', { x1: 0, y1: 50, x2: 100, y2: 50 }));
  const near1 = d.add(makeShape('text', { x: 10, y: 51, text: 'ab', braille: '⠁⠃' }));      // touches the line
  const far = d.add(makeShape('text', { x: 10, y: 60, text: 'ab', braille: '⠁⠃' }));        // 4.? mm clear
  const box = d.add(makeShape('rect', { x: 150, y: 10, width: 60, height: 40, texture: 'dots' }));
  const inside = d.add(makeShape('text', { x: 160, y: 25, text: 'ab', braille: '⠁⠃' }));
  const ids = checkDrawing(d).filter((x) => x.code === 'label-too-close').flatMap((x) => x.ids);
  assert.ok(ids.includes(near1.id));
  assert.ok(!ids.includes(far.id), 'label 4 mm clear is fine'); assert.ok(!ids.includes(inside.id));
  assert.ok(box);
});
test('check: shapes outside the page guide are warned (3.4.2: 40 cells x 25 lines)', () => {
  const d = new TactileDoc({ cells: 30, lines: 20 });
  const o = d.add(makeShape('rect', { x: 150, y: 150, width: 100, height: 100 }));
  assert.deepEqual(checkDrawing(d).find((w) => w.code === 'outside-page').ids, [o.id]);
  const big = new TactileDoc({ cells: 42, lines: 26 });
  assert.ok(checkDrawing(big).some((w) => w.code === 'page-too-big'));
});
test('label translation: uses the document translator, trims, keeps one line, falls back safely', () => {
  const tr = (t) => t.split('').map((c) => String.fromCharCode(0x2800 + (c.charCodeAt(0) % 64))).join('');
  const r = translateLabel('  Lake\nshore ', tr);
  assert.equal(r.print, 'Lake shore'); assert.equal(r.braille, tr('Lake shore')); assert.equal(r.cells, 10);
  assert.equal(translateLabel('x', () => { throw new Error('no table'); }, (t) => '⠭').braille, '⠭');
  assert.equal(translateLabel('x', () => '', (t) => '⠭').braille, '⠭');
  assert.equal(translateLabel('', tr).braille, '');
  const b = labelBox({ x: 10, y: 20, braille: '⠁⠃⠉' });
  assert.deepEqual([b.x, b.y, b.width], [10, 20, 3 * MM.cell]); assert.ok(b.height > 0);
});
test('key: area textures, then line styles, then point symbols (BANA 5.7.1), with the meanings the user typed', () => {
  const d = new TactileDoc({ cells: 38, lines: 25 });
  d.add(makeShape('symbol', { cx: 10, cy: 10, size: 7, symbol: 'diamond' }));
  d.add(makeShape('line', { x1: 0, y1: 30, x2: 60, y2: 30, line: 'dashed' }));
  d.add(makeShape('rect', { x: 0, y: 40, width: 30, height: 30, texture: 'hatch' }));
  d.add(makeShape('line', { x1: 0, y1: 90, x2: 60, y2: 90, line: 'solid' }));
  d.legend = { hatch: 'Woodland', dashed: 'Path' };
  const k = buildKey(d);
  assert.deepEqual(k.map((e) => e.type), ['texture', 'line', 'line', 'symbol']);
  assert.equal(k[0].meaning, 'Woodland'); assert.equal(k[1].meaning, 'Path');
  assert.equal(k[2].meaning, ''); assert.equal(k[3].id, 'diamond');
  assert.deepEqual(buildKey(new TactileDoc({ cells: 38, lines: 25 })), []);
});
test('key sizes follow BANA 5.9: area sample 1 in x 1/2 in, line sample 1 in', () => {
  assert.deepEqual([MM.keyAreaW, MM.keyAreaH, MM.keyLine], [25.4, 12.7, 25.4]);
});

// ---- the dot preview (no browser needed for the maths) ----
import { dotsFromPixels, brailleDotPositions } from '../web/tactile-draw/dots.mjs';
test('dot preview: a dot where a block is dark enough; white paper gives none', () => {
  const w = 8, h = 4, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }   // left block black
  const g = dotsFromPixels(data, w, h, 4);
  assert.deepEqual([g.cols, g.rows, Array.from(g.dots)], [2, 1, [1, 0]]);
  assert.equal(Array.from(dotsFromPixels(new Uint8ClampedArray(w * h * 4).fill(255), w, h, 4).dots).every((v) => v === 0), true);
});
test('dot preview: a braille cell is drawn as its real dots, 2.5 mm apart, cell by cell 6.2 mm', () => {
  const p = brailleDotPositions('\u2803\u2801', 10, 20);     // b = dots 1,2 ; a = dot 1
  assert.equal(p.length, 3);
  near(p[1].y - p[0].y, 2.5);
  near(p[2].x - p[0].x, MM.cell);
  assert.deepEqual(brailleDotPositions('abc', 0, 0), [], 'print letters are not dots');
});
