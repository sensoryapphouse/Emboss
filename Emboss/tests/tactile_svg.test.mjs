import test from 'node:test';
import assert from 'node:assert/strict';
import { transpileTactileSvg, normalizeColor, isDarkOutlineColor, TACTILE_PATTERNS, createLeadLineSvg } from '../format/tactile-svg.mjs';

test('Tactile SVG: normalizes colors and identifies black/dark outlines', () => {
  assert.equal(normalizeColor('rgb(0, 0, 0)'), '#000000');
  assert.equal(normalizeColor('black'), '#000000');
  assert.equal(normalizeColor('#FFF'), '#ffffff');
  assert.equal(normalizeColor('none'), 'none');

  assert.equal(isDarkOutlineColor('#000000'), true);
  assert.equal(isDarkOutlineColor('black'), true);
  assert.equal(isDarkOutlineColor('#1a1a1a'), true);
  assert.equal(isDarkOutlineColor('#ffffff'), false);
  assert.equal(isDarkOutlineColor('#2563eb'), false);
});

test('Tactile SVG: transpileTactileSvg injects tactile patterns and preserves outlines', () => {
  const inputSvg = `<svg viewBox="0 0 100 100" width="100" height="100">
    <rect x="10" y="10" width="80" height="80" fill="#2563eb" stroke="#000000" stroke-width="1" />
  </svg>`;

  const result = transpileTactileSvg(inputSvg, {
    applyTextures: true,
    strokeWidth: 2.0,
    translator: (txt) => txt.toUpperCase(),
  });

  assert.ok(result.svg, 'Should produce SVG output');
  assert.ok(result.svg.includes('<defs>'), 'Should include <defs> with tactile pattern');
  assert.ok(result.svg.includes('tactile-pat-'), 'Should reference a tactile pattern ID');
});

test('Tactile SVG: pattern library contains foundational distinct textures', () => {
  assert.ok(TACTILE_PATTERNS.length >= 5, 'Should have at least 5 distinct tactile textures');
  const ids = TACTILE_PATTERNS.map((p) => p.id);
  assert.ok(ids.includes('tactile-pat-hatch45'));
  assert.ok(ids.includes('tactile-pat-stipple'));
  assert.ok(ids.includes('tactile-pat-crosshatch'));
  assert.ok(ids.includes('tactile-pat-horizontal'));
});

test('Tactile SVG: createLeadLineSvg generates BANA compliant pointer, line, and Braille cells', () => {
  const leadSvg = createLeadLineSvg(100, 150, 40, 50, 'Vertex', {
    translator: (t) => '⠠⠧⠑⠗⠞⠑⠭'
  });
  assert.ok(leadSvg.includes('class="tactile-lead-line-group"'));
  assert.ok(leadSvg.includes('<circle cx="100.0" cy="150.0" r="3.2"'));
  assert.ok(leadSvg.includes('<line x1="100.0" y1="150.0"'));
  assert.ok(leadSvg.includes('<rect'));
});

test('Tactile SVG: transpileTactileSvgForDevice precomputes DotPad matrix and Braille Line 0', async () => {
  const { transpileTactileSvgForDevice } = await import('../format/tactile-svg.mjs');
  const sampleSvg = `<svg viewBox="0 0 100 100" width="100" height="100">
    <title>Beaker</title>
    <rect x="20" y="20" width="60" height="60" stroke="#000000" stroke-width="4" fill="none" />
  </svg>`;

  const result = await transpileTactileSvgForDevice(sampleSvg, {
    targetDevice: 'dotpad',
    title: 'Laboratory Beaker'
  });

  assert.ok(result.svg.includes('data-dotpad-matrix='), 'Should embed data-dotpad-matrix');
  assert.ok(result.svg.includes('data-braille-line='), 'Should embed data-braille-line');
  assert.ok(result.matrix instanceof Uint8Array, 'Should return discrete matrix');
  assert.equal(result.matrix.length, 300);
  assert.ok(result.brailleLine.length >= 20);
});

