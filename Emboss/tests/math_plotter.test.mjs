import test from 'node:test';
import assert from 'node:assert/strict';
import { latexToMathJs, evaluateFunction, plotTactileFunction, plotFunctionToPinGrid } from '../format/math-plotter.mjs';

test('Math Plotter: latexToMathJs parses LaTeX expressions into JS', () => {
  assert.equal(latexToMathJs('x^2 - 4'), 'x ** (2) - 4');
  assert.equal(latexToMathJs('y = 2x + 1'), '2 * x + 1');
  assert.equal(latexToMathJs('f(x) = \\sin(x)'), 'Math.sin(x)');
  assert.equal(latexToMathJs('\\frac{1}{2}x + 3'), '((1)/(2)) * x + 3');
  assert.equal(latexToMathJs('\\sqrt{x}'), 'Math.sqrt(x)');
});

test('Math Plotter: evaluateFunction computes values accurately', () => {
  const quad = latexToMathJs('x^2 - 4');
  assert.equal(evaluateFunction(quad, 0), -4);
  assert.equal(evaluateFunction(quad, 2), 0);
  assert.equal(evaluateFunction(quad, -2), 0);

  const linear = latexToMathJs('2x + 3');
  assert.equal(evaluateFunction(linear, 1), 5);
  assert.equal(evaluateFunction(linear, -1.5), 0);
});

test('Math Plotter: plotTactileFunction outputs valid tactile SVG graph', () => {
  const res = plotTactileFunction('x^2 - 4', {
    xMin: -5,
    xMax: 5,
    yMin: -5,
    yMax: 10,
    translator: (txt) => txt,
  });

  assert.ok(res.svg, 'Should return SVG content');
  assert.ok(res.svg.includes('<svg'), 'Should contain SVG root');
  assert.ok(res.svg.includes('tactile-axes'), 'Should contain coordinate axes');
  assert.ok(res.svg.includes('tactile-curves'), 'Should contain curve path');
  assert.ok(res.svg.includes('tactile-poi'), 'Should contain points of interest');
  assert.ok(res.title.includes('x^2 - 4'), 'Should have appropriate title');
});

test('Math Plotter: plotFunctionToPinGrid generates 60x40 discrete pin matrix and UEB Math reading row', () => {
  const pinPlot = plotFunctionToPinGrid('x^2 - 4', {
    widthPins: 60,
    heightPins: 40,
    xMin: -5,
    xMax: 5,
    yMin: -5,
    yMax: 5,
  });

  assert.equal(pinPlot.widthPins, 60);
  assert.equal(pinPlot.heightPins, 40);
  assert.equal(pinPlot.matrix.length, 300); // 30 cols x 10 rows
  assert.ok(pinPlot.brailleLine.length >= 20, 'Should generate 20-cell Braille text reading row');
  assert.ok(pinPlot.brailleLine.includes('⠰⠰⠰⠽'), 'Should contain UEB Math indicator for y');
  assert.ok(pinPlot.pointsOfInterest.some((p) => p.type === 'root'), 'Should detect roots');
});

test('Math Plotter: ViewPlus Tiger adaptation uses 8-height 3D elevation palette and dimmed grid', () => {
  const res = plotTactileFunction('x^2 - 4, 2x + 1', {
    targetDevice: 'viewplus',
    showGrid: true,
  });

  assert.equal(res.curves.length, 2);
  assert.ok(res.curves[0].style.includes('Height 7'), 'Primary curve should use Height 7 (Solid Black)');
  assert.ok(res.curves[1].style.includes('Height 5'), 'Secondary curve should use Height 5 (Royal Blue)');
  assert.ok(res.svg.includes('#cbd5e1') || res.svg.includes('#e2e8f0'), 'Should use dimmed stroke color for Tiger grid lines');
  assert.ok(res.textSummary.includes('x^2 - 4'), 'Should generate complete mathematical text summary');
});

test('Math Plotter: DotPad adaptation embeds discrete 60x40 pin matrix and UEB reading row in SVG', () => {
  const res = plotTactileFunction('x^2 - 4', {
    targetDevice: 'dotpad',
  });

  assert.ok(res.svg.includes('data-dotpad-matrix="'), 'SVG should carry precomputed dotpad matrix');
  assert.ok(res.svg.includes('data-braille-line="'), 'SVG should carry precomputed braille line');
  assert.ok(res.matrix instanceof Uint8Array, 'Should return 300-byte cell matrix');
  assert.equal(res.matrix.length, 300);
});
