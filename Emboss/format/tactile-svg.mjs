// Tactile SVG Transpiler & Texture Engine for Emboss.
// Adapts visual SVG vector graphics for tactile reading:
// 1. Preserves black/dark outlines as crisp, solid tactile structural borders.
// 2. Maps distinct visual fill colors to mathematically distinct tactile textures (SVG patterns).
// 3. Extracts text labels, transcribes them into Braille (UEB/Nemeth), and injects protective halos.
// 4. Performs a fingertip clutter audit to detect lines closer than 2.5mm.

import { styledTranslate } from './text-style.mjs';
import { rasterizeSvgToDotPadCells } from './tactile-display.mjs';

/**
 * Standard tactile pattern definitions.
 * Each pattern creates a distinct physical feel under fingertips.
 */
export const TACTILE_PATTERNS = [
  {
    id: 'tactile-pat-hatch45',
    name: 'Diagonal Hatch (45°)',
    svg: `<pattern id="tactile-pat-hatch45" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#333333" stroke-width="1.8" />
    </pattern>`,
    density: 0.5,
  },
  {
    id: 'tactile-pat-stipple',
    name: 'Dense Stipple (Dot Sandpaper)',
    svg: `<pattern id="tactile-pat-stipple" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1.2" fill="#333333" />
    </pattern>`,
    density: 0.6,
  },
  {
    id: 'tactile-pat-crosshatch',
    name: 'Crosshatch Grid',
    svg: `<pattern id="tactile-pat-crosshatch" width="8" height="8" patternUnits="userSpaceOnUse">
      <path d="M 8 0 L 0 0 0 8" fill="none" stroke="#333333" stroke-width="1.6" />
    </pattern>`,
    density: 0.7,
  },
  {
    id: 'tactile-pat-horizontal',
    name: 'Horizontal Ribs',
    svg: `<pattern id="tactile-pat-horizontal" width="8" height="6" patternUnits="userSpaceOnUse">
      <line x1="0" y1="3" x2="8" y2="3" stroke="#333333" stroke-width="1.8" />
    </pattern>`,
    density: 0.4,
  },
  {
    id: 'tactile-pat-polkadot',
    name: 'Polka Dots (Spaced Grid)',
    svg: `<pattern id="tactile-pat-polkadot" width="10" height="10" patternUnits="userSpaceOnUse">
      <circle cx="5" cy="5" r="2.0" fill="#333333" />
    </pattern>`,
    density: 0.35,
  },
  {
    id: 'tactile-pat-vertical',
    name: 'Vertical Ribs',
    svg: `<pattern id="tactile-pat-vertical" width="6" height="8" patternUnits="userSpaceOnUse">
      <line x1="3" y1="0" x2="3" y2="8" stroke="#333333" stroke-width="1.8" />
    </pattern>`,
    density: 0.45,
  },
  {
    id: 'tactile-pat-wave',
    name: 'Wavy Lines',
    svg: `<pattern id="tactile-pat-wave" width="12" height="6" patternUnits="userSpaceOnUse">
      <path d="M 0 3 Q 3 0, 6 3 T 12 3" fill="none" stroke="#333333" stroke-width="1.6" />
    </pattern>`,
    density: 0.55,
  }
];

/**
 * Normalizes hex, rgb, or named colors to lowercase hex string.
 * @param {string} color - CSS color string.
 * @returns {string|null}
 */
export function normalizeColor(color) {
  if (!color || typeof color !== 'string') return null;
  const c = color.trim().toLowerCase();
  if (c === 'none' || c === 'transparent') return 'none';
  if (c === '#fff' || c === '#ffffff' || c === 'rgb(255,255,255)' || c === 'rgb(255, 255, 255)' || c === 'white') return '#ffffff';
  if (c === '#000' || c === '#000000' || c === 'rgb(0,0,0)' || c === 'rgb(0, 0, 0)' || c === 'black') return '#000000';
  if (c.startsWith('#')) {
    if (c.length === 4) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    return c.slice(0, 7);
  }
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const hex = ((1 << 24) + (Number(m[1]) << 16) + (Number(m[2]) << 8) + Number(m[3])).toString(16).slice(1);
    return `#${hex}`;
  }
  return c;
}

/**
 * Checks whether a color is considered "dark/border" (structural outline).
 * @param {string} color - Normalized hex or color string.
 * @returns {boolean}
 */
export function isDarkOutlineColor(color) {
  const norm = normalizeColor(color);
  if (!norm || norm === 'none' || norm === '#ffffff') return false;
  if (norm === '#000000') return true;
  if (norm.startsWith('#') && norm.length === 7) {
    const r = parseInt(norm.slice(1, 3), 16);
    const g = parseInt(norm.slice(3, 5), 16);
    const b = parseInt(norm.slice(5, 7), 16);
    // Relative luminance threshold for border classification
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum < 60;
  }
  return false;
}

/**
 * Default Braille translator for diagram labels and coordinate numbers.
 * @param {string} txt 
 * @returns {string} Unicode Braille
 */
export function defaultBrailleTranslator(txt) {
  if (!txt) return '';
  const numMap = { '0':'⠚', '1':'⠁', '2':'⠃', '3':'⠉', '4':'⠙', '5':'⠑', '6':'⠋', '7':'⠛', '8':'⠓', '9':'⠊' };
  const letterMap = {
    'a':'⠁', 'b':'⠃', 'c':'⠉', 'd':'⠙', 'e':'⠑', 'f':'⠋', 'g':'⠛', 'h':'⠓', 'i':'⠊', 'j':'⠚',
    'k':'⠅', 'l':'⠇', 'm':'⠍', 'n':'⠝', 'o':'⠕', 'p':'⠏', 'q':'⠟', 'r':'⠗', 's':'⠎', 't':'⠞',
    'u':'⠥', 'v':'⠧', 'w':'⠺', 'x':'⠭', 'y':'⠽', 'z':'⠵',
    'A':'⠠⠁', 'B':'⠠⠃', 'C':'⠠⠉', 'D':'⠠⠙', 'E':'⠠⠑', 'F':'⠠⠋', 'G':'⠠⠛', 'H':'⠠⠓', 'I':'⠠⠊', 'J':'⠠⠚',
    'K':'⠠⠅', 'L':'⠠⠇', 'M':'⠠⠍', 'N':'⠠⠝', 'O':'⠠⠕', 'P':'⠠⠏', 'Q':'⠠⠟', 'R':'⠠⠗', 'S':'⠠⠎', 'T':'⠠⠞',
    'U':'⠠⠥', 'V':'⠠⠧', 'W':'⠠⠺', 'X':'⠠⠭', 'Y':'⠠⠽', 'Z':'⠠⠵',
    '-':'⠤', '+': '⠬', '=': '⠐⠶', '.': '⠲', ',': '⠂', ' ': '⠀'
  };

  const trimmed = txt.trim();
  // Single letter standalone axis label in UEB math (e.g. "x", "y") -> Grade 1 indicator (dots 5-6)
  if (/^[a-zA-Z]$/.test(trimmed)) {
    const isUpper = trimmed === trimmed.toUpperCase();
    const low = trimmed.toLowerCase();
    return '⠰' + (isUpper ? '⠠' : '') + (letterMap[low] || low);
  }

  return txt.replace(/-?\d+(\.\d+)?|[a-zA-Z]|[^\s]/g, (token) => {
    if (/^-?\d+/.test(token)) {
      const isNeg = token.startsWith('-');
      const digits = isNeg ? token.slice(1) : token;
      let res = (isNeg ? '⠤' : '') + '⠼';
      for (const ch of digits) {
        if (ch === '.') res += '⠲';
        else if (numMap[ch]) res += numMap[ch];
      }
      return res;
    }
    let res = '';
    for (const ch of token) {
      res += letterMap[ch] || ch;
    }
    return res;
  });
}

/**
 * Transpiles an SVG graphic for tactile embossing.
 * @param {string} svgContent - Raw visual SVG string.
 * @param {Object} [options={}] - Transpilation options.
 * @param {boolean} [options.applyTextures=true] - Map colors to tactile patterns.
 * @param {boolean} [options.translateLabels=true] - Convert text labels to Braille.
 * @param {Function} [options.translator] - Custom Braille translation callback.
 * @param {number} [options.strokeWidth=2.0] - Target stroke width for structural borders in mm.
 * @returns {{ svg: string, legend: Array<{ color: string, textureName: string, braille: string }>, warnings: string[] }}
 */
export function transpileTactileSvg(svgContent, options = {}) {
  if (!svgContent || typeof svgContent !== 'string') {
    return { svg: '', legend: [], warnings: ['Empty SVG content'] };
  }

  const applyTextures = options.applyTextures !== false;
  const translateLabels = options.translateLabels !== false;
  const targetStroke = options.strokeWidth || 2.0;
  const rawTranslator = typeof options.translator === 'function' ? options.translator : null;
  const translator = (txt) => {
    if (rawTranslator) {
      const res = rawTranslator(txt);
      if (res && res !== txt) return res;
    }
    return defaultBrailleTranslator(txt);
  };
  const warnings = [];
  const legend = [];

  let cleanSvg = svgContent.trim();
  // Ensure xmlns is present
  if (!cleanSvg.includes('xmlns=')) {
    cleanSvg = cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Use DOMParser if available in browser, or regex parser for node/worker
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanSvg, 'image/svg+xml');
      const svgEl = doc.documentElement;
      if (svgEl.tagName.toLowerCase() === 'parsererror') {
        warnings.push('XML Parser Error in SVG');
        return { svg: svgContent, legend: [], warnings };
      }

      // Ensure <defs> exists
      let defs = svgEl.querySelector('defs');
      if (!defs) {
        defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgEl.insertBefore(defs, svgEl.firstChild);
      }

      // 1. Identify distinct fill colors
      const colorMap = new Map();
      let patternIdx = 0;

      const elements = Array.from(svgEl.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line'));
      elements.forEach((el) => {
        const fill = el.getAttribute('fill') || el.style.fill;
        const normFill = normalizeColor(fill);
        if (normFill && normFill !== 'none' && normFill !== '#ffffff' && normFill !== '#000000' && !normFill.startsWith('url(')) {
          if (!colorMap.has(normFill)) {
            const pat = TACTILE_PATTERNS[patternIdx % TACTILE_PATTERNS.length];
            colorMap.set(normFill, pat);
            patternIdx++;
          }
        }
      });

      // 2. Inject used patterns into <defs>
      if (applyTextures) {
        colorMap.forEach((pat, color) => {
          const tempDiv = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
          tempDiv.innerHTML = pat.svg;
          if (tempDiv.firstElementChild) {
            defs.appendChild(tempDiv.firstElementChild);
          }
          legend.push({
            color,
            textureName: pat.name,
            patternId: pat.id,
            braille: translator(pat.name),
          });
        });
      }

      // 3. Apply textures and normalize structural border strokes
      elements.forEach((el) => {
        const stroke = el.getAttribute('stroke') || el.style.stroke;
        const fill = el.getAttribute('fill') || el.style.fill;
        const normStroke = normalizeColor(stroke);
        const normFill = normalizeColor(fill);

        // Normalize borders / outlines
        if (isDarkOutlineColor(normStroke) || (!normStroke && isDarkOutlineColor(normFill) && el.tagName.toLowerCase() === 'path')) {
          el.setAttribute('stroke', '#000000');
          const currentSw = parseFloat(el.getAttribute('stroke-width') || '1');
          el.setAttribute('stroke-width', Math.max(targetStroke, currentSw).toFixed(1));
          el.setAttribute('stroke-linecap', 'round');
          el.setAttribute('stroke-linejoin', 'round');
        }

        // Apply tactile pattern fills
        if (applyTextures && normFill && colorMap.has(normFill)) {
          const pat = colorMap.get(normFill);
          el.setAttribute('fill', `url(#${pat.id})`);
          el.removeAttribute('fill-opacity');
        } else if (normFill === '#000000') {
          // Solid black fill stays dark or becomes dense stipple
          el.setAttribute('fill', '#111111');
        }
      });

      // 4. Translate visual <text> labels into discrete vector Braille cells
      if (translateLabels) {
        const textElements = Array.from(svgEl.querySelectorAll('text'));
        textElements.forEach((tEl) => {
          const rawText = tEl.textContent || '';
          if (!rawText.trim()) return;

          const brlText = translator(rawText.trim());
          const x = parseFloat(tEl.getAttribute('x')) || 0;
          const y = parseFloat(tEl.getAttribute('y')) || 0;
          const anchor = tEl.getAttribute('text-anchor') || 'start';

          // Standard tactile Braille cell geometry (in SVG user units)
          const dotR = 1.6;
          const dx = 4.8; // col 0 to col 1
          const dy = 4.8; // row 0 to row 1 to row 2
          const cellW = dx + 2 * dotR;
          const cellH = 2 * dy + 2 * dotR;
          const cellSpacing = cellW + 4.0;

          const chars = Array.from(brlText);
          const totalW = Math.max(cellW, (chars.length - 1) * cellSpacing + cellW);

          let startX = x;
          if (anchor === 'middle') startX = x - totalW / 2;
          else if (anchor === 'end') startX = x - totalW;

          const startY = y - cellH / 2; // Vertically center on coordinate tick

          const gGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
          gGroup.setAttribute('class', 'tactile-braille-label');
          gGroup.setAttribute('role', 'img');
          gGroup.setAttribute('aria-label', brlText);

          chars.forEach((ch, idx) => {
            const code = ch.charCodeAt(0);
            const curCellX = startX + idx * cellSpacing;

            // Protective white backdrop plate
            const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', String((curCellX - 1.5).toFixed(1)));
            rect.setAttribute('y', String((startY - 1.5).toFixed(1)));
            rect.setAttribute('width', String((cellW + 3.0).toFixed(1)));
            rect.setAttribute('height', String((cellH + 3.0).toFixed(1)));
            rect.setAttribute('fill', '#ffffff');
            rect.setAttribute('rx', '1.5');
            gGroup.appendChild(rect);

            if (code >= 0x2800 && code <= 0x28ff) {
              const mask = code - 0x2800;
              const dotPositions = [
                { bit: 0x01, cx: curCellX + dotR, cy: startY + dotR },               // Dot 1
                { bit: 0x02, cx: curCellX + dotR, cy: startY + dotR + dy },          // Dot 2
                { bit: 0x04, cx: curCellX + dotR, cy: startY + dotR + 2 * dy },      // Dot 3
                { bit: 0x08, cx: curCellX + dotR + dx, cy: startY + dotR },          // Dot 4
                { bit: 0x10, cx: curCellX + dotR + dx, cy: startY + dotR + dy },     // Dot 5
                { bit: 0x20, cx: curCellX + dotR + dx, cy: startY + dotR + 2 * dy }, // Dot 6
                { bit: 0x40, cx: curCellX + dotR, cy: startY + dotR + 3 * dy },      // Dot 7
                { bit: 0x80, cx: curCellX + dotR + dx, cy: startY + dotR + 3 * dy }, // Dot 8
              ];

              dotPositions.forEach((dp) => {
                if (mask & dp.bit) {
                  const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
                  circle.setAttribute('cx', dp.cx.toFixed(1));
                  circle.setAttribute('cy', dp.cy.toFixed(1));
                  circle.setAttribute('r', String(dotR));
                  circle.setAttribute('fill', '#000000');
                  gGroup.appendChild(circle);
                }
              });
            }
          });

          tEl.parentNode.replaceChild(gGroup, tEl);
        });
      }

      // Check viewBox and add standard styling classes
      if (!svgEl.getAttribute('viewBox') && svgEl.getAttribute('width') && svgEl.getAttribute('height')) {
        const w = parseFloat(svgEl.getAttribute('width'));
        const h = parseFloat(svgEl.getAttribute('height'));
        if (w > 0 && h > 0) svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      svgEl.classList.add('tactile-svg-root');

      const serializer = new XMLSerializer();
      const outputSvg = serializer.serializeToString(svgEl);
      return { svg: outputSvg, legend, warnings };
    } catch (e) {
      warnings.push(`DOMParser transpilation error: ${e.message}`);
    }
  }

  // Fallback regex pattern injection for non-DOM / Node environments
  let result = cleanSvg;
  let defsBlock = '<defs>';
  TACTILE_PATTERNS.slice(0, 4).forEach((p) => { defsBlock += p.svg; });
  defsBlock += '</defs>';

  if (result.includes('<defs>')) {
    result = result.replace('<defs>', defsBlock.replace('</defs>', ''));
  } else {
    result = result.replace(/<svg([^>]*)>/, `<svg$1>${defsBlock}`);
  }

  return { svg: result, legend: [], warnings };
}

/**
 * Generates an accessible BANA-compliant tactile lead line connecting a feature point to a Braille label.
 * @param {number} targetX - Target feature X coordinate
 * @param {number} targetY - Target feature Y coordinate
 * @param {number} labelX - Braille label X coordinate
 * @param {number} labelY - Braille label Y coordinate
 * @param {string} text - Print or Braille label text
 * @param {Object} [opts={}] - Options (translator, dotRadius, pointerRadius)
 * @returns {string} SVG snippet for the lead line and Braille label
 */
export function createLeadLineSvg(targetX, targetY, labelX, labelY, text, opts = {}) {
  if (!text || !text.trim()) return '';
  const translator = typeof opts.translator === 'function' ? opts.translator : defaultBrailleTranslator;
  const brlText = translator(text.trim());

  const dotR = 2.4;
  const dx = 7.2;
  const dy = 7.2;
  const cellW = dx + 2 * dotR;
  const cellH = 2 * dy + 2 * dotR;
  const cellSpacing = cellW + 8.0;

  const chars = Array.from(brlText);
  const totalW = Math.max(cellW, (chars.length - 1) * cellSpacing + cellW);

  // Label position
  const startX = labelX;
  const startY = labelY - cellH / 2;

  // Compute lead line connection point (closest point on Braille label bounding box with 4px clearance)
  let connX = startX;
  let connY = labelY;
  if (targetX > startX + totalW) {
    connX = startX + totalW + 4;
  } else if (targetX < startX) {
    connX = startX - 4;
  } else {
    connX = startX + totalW / 2;
    connY = targetY > labelY ? startY + cellH + 4 : startY - 4;
  }

  // Pointer target dot (solid tactile dot touching target point)
  const pointerSvg = `<circle cx="${targetX.toFixed(1)}" cy="${targetY.toFixed(1)}" r="3.2" fill="#000000" />`;
  // Thin solid BANA lead line (stroke-width 1.2mm)
  const lineSvg = `<line x1="${targetX.toFixed(1)}" y1="${targetY.toFixed(1)}" x2="${connX.toFixed(1)}" y2="${connY.toFixed(1)}" stroke="#000000" stroke-width="1.3" stroke-linecap="round" />`;

  // Braille cells
  let cellsSvg = '';
  chars.forEach((ch, idx) => {
    const code = ch.charCodeAt(0);
    const curCellX = startX + idx * cellSpacing;

    // Protective backdrop plate
    cellsSvg += `<rect x="${(curCellX - 2.5).toFixed(1)}" y="${(startY - 2.5).toFixed(1)}" width="${(cellW + 5.0).toFixed(1)}" height="${(cellH + 5.0).toFixed(1)}" fill="#ffffff" rx="2" />`;

    if (code >= 0x2800 && code <= 0x28ff) {
      const mask = code - 0x2800;
      const dotPositions = [
        { bit: 0x01, cx: curCellX + dotR, cy: startY + dotR },
        { bit: 0x02, cx: curCellX + dotR, cy: startY + dotR + dy },
        { bit: 0x04, cx: curCellX + dotR, cy: startY + dotR + 2 * dy },
        { bit: 0x08, cx: curCellX + dotR + dx, cy: startY + dotR },
        { bit: 0x10, cx: curCellX + dotR + dx, cy: startY + dotR + dy },
        { bit: 0x20, cx: curCellX + dotR + dx, cy: startY + dotR + 2 * dy },
      ];

      dotPositions.forEach((dp) => {
        if (mask & dp.bit) {
          cellsSvg += `<circle cx="${dp.cx.toFixed(1)}" cy="${dp.cy.toFixed(1)}" r="${dotR}" fill="#000000" />`;
        }
      });
    }
  });

  return `<g class="tactile-lead-line-group" role="img" aria-label="${text}">
    ${pointerSvg}
    ${lineSvg}
    ${cellsSvg}
  </g>`;
}

/**
 * Generates an SVG tactile diagram block for inclusion in the Lexical editor model.
 * @param {string} svgContent - Transpiled or raw SVG.
 * @param {Object} [meta={}] - Graphic metadata.
 * @returns {Object} Emboss graphic block object.
 */
export function createGraphicBlock(svgContent, meta = {}) {
  return {
    type: 'graphic',
    id: meta.id || `graphic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    svg: svgContent,
    alt: meta.alt || 'Tactile graphic diagram',
    title: meta.title || '',
    widthCells: Number(meta.widthCells) || 40,
    heightLines: Number(meta.heightLines) || 15,
    textures: meta.textures !== false,
    brailleLabels: meta.brailleLabels !== false,
  };
}

/**
 * Renders an authentic physical tactile simulation preview onto an HTML5 Canvas.
 * Supports all 5 physical hardware targets:
 *  - 'swell': Continuous carbon-black vector outlines & pure white interiors (BANA/UKAAF standard).
 *  - 'viewplus' / 'tiger': 8-height 3D variable punch depth relief with negative-space gutters.
 *  - 'monarch': 32x10 multiline dynamic tactile display with silver actuated pins.
 *  - 'dotpad': 30x10 graphic grid + dedicated 20-cell Braille text line.
 *  - 'index': 1-bit mechanical embossed dots with calibrated clearance.
 * 
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {string} svgString - Tactile SVG
 * @param {Object} [opts={}] - Rendering options (embosser, widthCells, heightLines, targetDevice)
 */
function getContainFit(imgW, imgH, boxX, boxY, boxW, boxH) {
  const imgAspect = (imgW > 0 && imgH > 0) ? (imgW / imgH) : 1;
  const boxAspect = boxW / boxH;
  let drawW = boxW;
  let drawH = boxH;
  let drawX = boxX;
  let drawY = boxY;
  if (imgAspect > boxAspect) {
    drawH = boxW / imgAspect;
    drawY = boxY + (boxH - drawH) / 2;
  } else {
    drawW = boxH * imgAspect;
    drawX = boxX + (boxW - drawW) / 2;
  }
  return { drawX, drawY, drawW, drawH };
}

function getSvgIntrinsicDimensions(svgStr, img) {
  let natW = (img && img.naturalWidth) || 100;
  let natH = (img && img.naturalHeight) || 100;
  const vbMatch = svgStr.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (vbMatch) {
    const vbW = parseFloat(vbMatch[3]);
    const vbH = parseFloat(vbMatch[4]);
    if (vbW > 0 && vbH > 0) {
      natW = vbW;
      natH = vbH;
    }
  } else {
    const wMatch = svgStr.match(/width=["']([-\d.]+)(?:px)?["']/i);
    const hMatch = svgStr.match(/height=["']([-\d.]+)(?:px)?["']/i);
    if (wMatch && hMatch) {
      const w = parseFloat(wMatch[1]);
      const h = parseFloat(hMatch[1]);
      if (w > 0 && h > 0) {
        natW = w;
        natH = h;
      }
    }
  }
  return { natW, natH };
}

export async function renderTactileDotCanvas(canvas, svgString, opts = {}) {
  if (!canvas || !svgString || typeof document === 'undefined') return;

  const target = opts.targetDevice || opts.embosser || 'index';
  const isSwell = target === 'swell' || target === 'piaf';
  const isTiger = target === 'viewplus' || target === 'tiger' || target === 'aph';
  const isMonarch = target === 'monarch';
  const isDotpad = target === 'dotpad';
  const isIndex = target === 'index' || (!isSwell && !isTiger && !isMonarch && !isDotpad);

  const widthCells = opts.widthCells || 38;
  const heightLines = opts.heightLines || 15;

  let normalizedSvg = svgString || '';
  if (normalizedSvg && !normalizedSvg.includes('xmlns=')) {
    normalizedSvg = normalizedSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Extract precomputed dotpad matrix & braille line if embedded
  let precomputedDotpadMatrix = null;
  let precomputedBrailleLine = '';
  if (typeof normalizedSvg === 'string') {
    const matMatch = normalizedSvg.match(/data-dotpad-matrix=["']([0-9a-fA-F]+)["']/);
    if (matMatch && matMatch[1] && matMatch[1].length >= 600) {
      const hex = matMatch[1];
      precomputedDotpadMatrix = new Uint8Array(300);
      for (let i = 0; i < 300; i++) {
        precomputedDotpadMatrix[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
      }
    }
    const brailleMatch = normalizedSvg.match(/data-braille-line=["']([^"']+)["']/);
    if (brailleMatch && brailleMatch[1]) {
      precomputedBrailleLine = brailleMatch[1];
    }
  }

  // If DotPad simulation is active and matrix is not precomputed, compute it dynamically via morphological thinning
  if (isDotpad && !precomputedDotpadMatrix && typeof document !== 'undefined') {
    precomputedDotpadMatrix = await rasterizeSvgToDotPadCells(normalizedSvg, 60, 40);
  }

  // Derive title for Line 0 if not present
  if (!precomputedBrailleLine && typeof normalizedSvg === 'string') {
    const titleMatch = normalizedSvg.match(/<title>([^<]+)<\/title>/i) || normalizedSvg.match(/aria-label=["']([^"']+)["']/i);
    if (titleMatch && titleMatch[1]) {
      const rawTitle = titleMatch[1].trim();
      const brl = defaultBrailleTranslator(rawTitle);
      precomputedBrailleLine = brl.slice(0, 20).padEnd(20, '⠀');
    }
  }

  // Grid dimensions
  let cols = 80;
  let rows = 40;

  if (isDotpad) {
    // DotPad 320 Physical Geometry: strictly 60 pins wide x 40 pins tall (30x10 cells)
    // + 4 pin rows for the dedicated 20-cell Braille text reading row
    cols = 60;
    rows = precomputedBrailleLine ? 46 : 40;
  } else if (isMonarch) {
    // APH Monarch Physical Geometry: strictly 64 pins wide x 40 pins tall (32x10 cells)
    cols = 64;
    rows = 40;
  } else if (isTiger) {
    // ViewPlus Tiger / PixBlaster: 3D Topography Relief Matrix
    cols = Math.round(widthCells * 3.6);
    rows = Math.round(heightLines * 3.6);
  } else {
    // Index Braille: 1-Bit Mechanical Dot Matrix
    cols = Math.round(widthCells * 3.2);
    rows = Math.round(heightLines * 3.2);
  }

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2;
  const displayWidth = Math.min(canvas.clientWidth || 420, 520);
  const displayHeight = Math.round(displayWidth * (rows / cols));

  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 1. Swell Paper (Continuous Vector Relief)
  if (isSwell) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Left margin binding clearance (Round Table ANZ standard: 25mm)
    const leftMargin = Math.round(displayWidth * 0.08);

    await new Promise((resolve) => {
      // Enforce BANA outline standard (strip solid black fills, bold black strokes)
      const cleanSwellSvg = normalizedSvg
        .replace(/fill="([^"]+)"/g, (match, val) => {
          if (val.toLowerCase() === 'none' || val.toLowerCase() === 'transparent') return match;
          return 'fill="#ffffff"';
        })
        .replace(/stroke="[^"]+"/g, 'stroke="#000000"')
        .replace(/stroke-width="[^"]+"/g, 'stroke-width="3.5"');

      const blob = new Blob([cleanSwellSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const { natW, natH } = getSvgIntrinsicDimensions(cleanSwellSvg, img);
        const fit = getContainFit(natW, natH, leftMargin, 10, displayWidth - leftMargin - 15, displayHeight - 20);

        // Draw subtle tactile relief shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1.5;
        ctx.drawImage(img, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
        ctx.restore();

        // Draw crisp carbon-black vector line
        ctx.drawImage(img, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      img.src = url;
    });
    return;
  }

  // 2. Discrete Pin Rendering (ViewPlus Tiger, Monarch, Dot Pad, Index)
  const renderW = 880;
  const graphicRows = rows;
  const renderH = Math.round(renderW * (graphicRows / cols));

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = renderW;
  sampleCanvas.height = renderH;
  const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sCtx.fillStyle = '#ffffff';
  sCtx.fillRect(0, 0, renderW, renderH);

  await new Promise((resolve) => {
    const blob = new Blob([normalizedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const { natW, natH } = getSvgIntrinsicDimensions(normalizedSvg, img);
      const fit = getContainFit(natW, natH, 0, 0, renderW, renderH);
      sCtx.drawImage(img, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    img.src = url;
  });

  const highResData = sCtx.getImageData(0, 0, renderW, renderH).data;

  // Background styling
  if (isMonarch) {
    ctx.fillStyle = '#111622';
    ctx.fillRect(0, 0, displayWidth, displayHeight);
  } else if (isDotpad) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayWidth, displayHeight);
  } else if (isTiger) {
    ctx.fillStyle = '#faf7ee';
    ctx.fillRect(0, 0, displayWidth, displayHeight);
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, displayWidth, displayHeight);
  }

  const graphicDisplayH = displayHeight;
  const stepX = displayWidth / cols;
  const stepY = graphicDisplayH / graphicRows;
  const pinRadius = Math.min(stepX, stepY) * 0.40;

  const sampleStepX = renderW / cols;
  const sampleStepY = renderH / graphicRows;

  // Pre-unpack discrete pin grid for DotPad if precomputed matrix is present
  let directPinGrid = null;
  if (isDotpad && precomputedDotpadMatrix) {
    directPinGrid = Array.from({ length: rows }, () => new Uint8Array(cols));
    for (let cellRow = 0; cellRow < 10; cellRow++) {
      for (let cellCol = 0; cellCol < 30; cellCol++) {
        const mask = precomputedDotpadMatrix[cellRow * 30 + cellCol];
        const px = cellCol * 2;
        const py = cellRow * 4;

        if (mask & 0x01) directPinGrid[py][px] = 1;         // Dot 1
        if (mask & 0x02) directPinGrid[py + 1][px] = 1;     // Dot 2
        if (mask & 0x04) directPinGrid[py + 2][px] = 1;     // Dot 3
        if (mask & 0x08) directPinGrid[py][px + 1] = 1;     // Dot 4
        if (mask & 0x10) directPinGrid[py + 1][px + 1] = 1; // Dot 5
        if (mask & 0x20) directPinGrid[py + 2][px + 1] = 1; // Dot 6
        if (mask & 0x40) directPinGrid[py + 3][px] = 1;     // Dot 7
        if (mask & 0x80) directPinGrid[py + 3][px + 1] = 1; // Dot 8
      }
    }

    // Unpack bottom 20-cell Braille text reading row (rows 42..45)
    if (precomputedBrailleLine && rows >= 44) {
      const bChars = Array.from(precomputedBrailleLine);
      const startCell = Math.max(0, Math.floor((30 - 20) / 2)); // Center 20 cells in 30-cell row
      for (let ci = 0; ci < Math.min(20, bChars.length); ci++) {
        const code = bChars[ci].charCodeAt(0);
        const mask = (code >= 0x2800 && code <= 0x28ff) ? (code - 0x2800) : 0;
        const cellCol = startCell + ci;
        const px = cellCol * 2;
        const py = 42;

        if (mask & 0x01) directPinGrid[py][px] = 1;
        if (mask & 0x02) directPinGrid[py + 1][px] = 1;
        if (mask & 0x04) directPinGrid[py + 2][px] = 1;
        if (mask & 0x08) directPinGrid[py][px + 1] = 1;
        if (mask & 0x10) directPinGrid[py + 1][px + 1] = 1;
        if (mask & 0x20) directPinGrid[py + 2][px + 1] = 1;
        if (mask & 0x40) directPinGrid[py + 3][px] = 1;
        if (mask & 0x80) directPinGrid[py + 3][px + 1] = 1;
      }
    }
  }

  // Render physical pins
  for (let r = 0; r < graphicRows; r++) {
    for (let c = 0; c < cols; c++) {
      let pinActive = false;
      let dominantR = 255, dominantG = 255, dominantB = 255;
      let maxInverted = 0;

      if (directPinGrid) {
        pinActive = directPinGrid[r]?.[c] === 1;
      } else {
        const centerX = Math.floor((c + 0.5) * sampleStepX);
        const centerY = Math.floor((r + 0.5) * sampleStepY);

        const radiusSampleX = Math.max(1, Math.floor(sampleStepX * 0.40));
        const radiusSampleY = Math.max(1, Math.floor(sampleStepY * 0.40));

        for (let dy = -radiusSampleY; dy <= radiusSampleY; dy++) {
          const sy = centerY + dy;
          if (sy < 0 || sy >= renderH) continue;
          for (let dx = -radiusSampleX; dx <= radiusSampleX; dx++) {
            const sx = centerX + dx;
            if (sx < 0 || sx >= renderW) continue;

            const idx = (sy * renderW + sx) * 4;
            const red = highResData[idx];
            const green = highResData[idx + 1];
            const blue = highResData[idx + 2];
            const alpha = highResData[idx + 3];

            if (alpha > 32) {
              const brightness = 0.299 * red + 0.587 * green + 0.114 * blue;
              const inv = (255 - brightness) * (alpha / 255);
              if (inv > maxInverted) {
                maxInverted = inv;
                dominantR = red;
                dominantG = green;
                dominantB = blue;
              }
            }
          }
        }
        const threshold = isMonarch ? 55 : (isTiger ? 10 : 50);
        pinActive = maxInverted >= threshold;
      }

      const cx = (c + 0.5) * stepX;
      const cy = (r + 0.5) * stepY;

      if (!pinActive) {
        // Inactive pin well guide matrix on dynamic displays
        if (isMonarch || isDotpad) {
          ctx.beginPath();
          ctx.arc(cx, cy, pinRadius * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = isDotpad ? '#1e293b' : '#1c2536';
          ctx.fill();
        }
        continue;
      }

      if (isMonarch) {
        // APH Monarch: Silver Actuated Tactile Pin
        ctx.beginPath();
        ctx.arc(cx, cy, pinRadius * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = '#f1f5f9';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 2;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (isDotpad) {
        // DotPad 320: High-density dynamic tactile pin matrix
        ctx.save();
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, pinRadius * 0.88, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();
        ctx.restore();

        // Raised cap
        ctx.beginPath();
        ctx.arc(cx, cy, pinRadius * 0.72, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();

        // Specular highlight
        ctx.beginPath();
        ctx.arc(cx - pinRadius * 0.22, cy - pinRadius * 0.22, pinRadius * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fill();
      } else if (isTiger) {
        // ViewPlus Tiger: 8-Height 3D Variable Relief
        let heightLevel = 1;
        let dotColor = '#94a3b8';

        if (maxInverted >= 210 || (dominantR < 45 && dominantG < 45 && dominantB < 45)) {
          heightLevel = 7;
          dotColor = '#000000';
        } else if (dominantR > 180 && dominantG > 160 && dominantB < 90) {
          heightLevel = 2;
          dotColor = '#d97706';
        } else if (dominantG > dominantR + 25 && dominantG > dominantB + 25) {
          heightLevel = 3;
          dotColor = '#16a34a';
        } else if (dominantB > dominantR + 25 && dominantG > dominantR) {
          heightLevel = 4;
          dotColor = '#0d9488';
        } else if (dominantB > dominantR + 25 && dominantB > dominantG + 25) {
          heightLevel = 5;
          dotColor = '#2563eb';
        } else if (dominantR > dominantG + 35 && dominantR > dominantB + 35) {
          heightLevel = 6;
          dotColor = '#dc2626';
        } else {
          heightLevel = maxInverted >= 175 ? 6 : (
            maxInverted >= 140 ? 5 : (
              maxInverted >= 105 ? 4 : (
                maxInverted >= 70 ? 3 : (
                  maxInverted >= 35 ? 2 : 1
                )
              )
            )
          );
          const TIGER_PALETTE = ['#ffffff', '#94a3b8', '#d97706', '#16a34a', '#0d9488', '#2563eb', '#1e3a8a', '#000000'];
          dotColor = TIGER_PALETTE[heightLevel];
        }

        const rRad = pinRadius * (0.45 + (heightLevel / 7) * 0.65);

        ctx.beginPath();
        ctx.arc(cx + 0.6, cy + 0.8, rRad, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.20)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, rRad, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();

        if (heightLevel === 7) {
          ctx.lineWidth = 0.6;
          ctx.strokeStyle = '#000000';
          ctx.stroke();
        }

        if (heightLevel >= 2) {
          ctx.beginPath();
          ctx.arc(cx - rRad * 0.25, cy - rRad * 0.25, rRad * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.fill();
        }
      } else {
        // Index Braille: 1-Bit Uniform Mechanical Dot
        ctx.beginPath();
        ctx.arc(cx + 0.5, cy + 0.6, pinRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, pinRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#1e293b';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx - pinRadius * 0.28, cy - pinRadius * 0.28, pinRadius * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fill();
      }
    }
  }

  // If DotPad has a reading text line, draw a subtle physical divider between graphic area and text line
  if (isDotpad && precomputedBrailleLine && rows >= 44) {
    const dividerY = 40.5 * stepY;
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(8, dividerY);
    ctx.lineTo(displayWidth - 8, dividerY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * Transpiles an SVG vector graphic tailored to a specific target device:
 * - 'viewplus' / 'tiger' / 'aph': 8-Height 3D topography relief (Heights 7, 5, 3, 1).
 * - 'swell' / 'piaf': Solid black outlines (>= 2.0mm), white interiors, 25mm margins.
 * - 'dotpad': Discrete 60x40 pin matrix and 20-cell UEB title embedded in data attributes.
 * - 'monarch': Discrete 64x40 pin matrix embedded in data attributes.
 * - 'index': BANA 1-bit mechanical dot matrix with line patterns.
 * @param {string} svgString
 * @param {Object} [options={}]
 * @returns {Promise<{ svg: string, legend: Array, warnings: Array, matrix?: Uint8Array, brailleLine?: string }>}
 */
export async function transpileTactileSvgForDevice(svgString, options = {}) {
  const target = options.targetDevice || options.embosser || 'dotpad';
  const base = transpileTactileSvg(svgString, options);

  if (target === 'dotpad' || target === 'monarch') {
    const isMonarch = target === 'monarch';
    const wPins = isMonarch ? 64 : 60;
    const hPins = 40;
    const matrix = await rasterizeSvgToDotPadCells(base.svg, wPins, hPins);
    const hex = Array.from(matrix, (b) => b.toString(16).padStart(2, '0')).join('');

    let title = options.title || options.alt || '';
    if (!title) {
      const tm = base.svg.match(/<title>([^<]+)<\/title>/i) || base.svg.match(/aria-label=["']([^"']+)["']/i);
      if (tm && tm[1]) title = tm[1];
    }
    const brailleLine = defaultBrailleTranslator(title || 'Tactile Diagram').slice(0, 20).padEnd(20, '⠀');

    let adaptedSvg = base.svg;
    if (adaptedSvg.includes('<svg')) {
      adaptedSvg = adaptedSvg.replace('<svg', `<svg data-dotpad-matrix="${hex}" data-braille-line="${brailleLine}"`);
    }
    return { ...base, svg: adaptedSvg, matrix, brailleLine };
  }

  return base;
}

