// Render BRF braille as tactile-style dot cells (SVG), instead of relying on the
// OS's Unicode-braille font (which is light/inconsistent across platforms). Raised
// dots are bold and filled; empty dot positions are faint so the cell grid reads
// like braille paper. `cellW` scales everything (the size control). Each cell is a
// <g data-cell> so a later pass can link/highlight it against the source print.
import { brfCharDots, brfToUnicodeBraille } from '/engine/brf-ascii.mjs';
import { renderTactileDotCanvas } from '/format/tactile-svg.mjs';

// dot d (0..5) → dot numbers 1-6 laid out  1 4 / 2 5 / 3 6
const COL = (d) => (d < 3 ? 0 : 1);
const ROW = (d) => d % 3;

function lineSvg(line, cellW, cellH, dotR, rowIndex, rowSrc) {
  const cells = [...line];
  const w = Math.max(cells.length, 1) * cellW;
  const colX = [cellW * 0.34, cellW * 0.66];
  const rowY = [cellH * 0.2, cellH * 0.5, cellH * 0.8];
  let inner = '';
  cells.forEach((ch, ci) => {
    const bits = brfCharDots(ch);
    if (bits === null) return;                       // non-braille annotation (shouldn't occur in BRF)
    const x0 = ci * cellW;
    let dots = '';
    for (let d = 0; d < 6; d++) {
      const on = (bits >> d) & 1;
      const cx = (x0 + colX[COL(d)]).toFixed(1);
      const cy = rowY[ROW(d)].toFixed(1);
      dots += `<circle cx="${cx}" cy="${cy}" r="${(on ? dotR : dotR * 0.5).toFixed(2)}" class="${on ? 'don' : 'doff'}"/>`;
    }
    const src = rowSrc && rowSrc[ci];                // {u,c} source coordinate for word/cell linking, or null
    const link = src ? ` data-unit="${src.u}" data-char="${src.c}"` : '';
    inner += `<g class="bcell" data-row="${rowIndex}" data-col="${ci}"${bits ? ' data-on="1"' : ''}${link}>${dots}</g>`;
  });
  return `<svg class="brl-svg" viewBox="0 0 ${w} ${cellH.toFixed(0)}" style="width:100%; height:auto; display:block;" xmlns="http://www.w3.org/2000/svg" role="presentation">${inner}</svg>`;
}

export function expandRowCells(row) {
  if (!row || row._expanded) return;
  const textContainer = row.querySelector('.brl-text-wrap');
  if (!textContainer) return;
  const chars = row._isAscii ? (row._raw ? [...row._raw] : []) : (row._uni ? [...row._uni] : []);
  if (!chars.length) return;
  let innerHtml = '';
  const curRowCells = row._rowCells;
  const rowIndex = row._rowIndex;
  for (let ci = 0; ci < chars.length; ci++) {
    const ch = chars[ci];
    const src = curRowCells ? curRowCells[ci] : null;
    const link = src ? ` data-unit="${src.u}" data-char="${src.c}"` : '';
    innerHtml += `<span class="bcell" data-row="${rowIndex}" data-col="${ci}"${link}>${ch}</span>`;
  }
  textContainer.innerHTML = innerHtml;
  row._expanded = true;
}

export function autoFitBraille(container, numCells = 38) {
  if (!container) return;
  const num = Math.max(10, (numCells | 0) || 38);
  const containerW = container.clientWidth || 540;
  const targetFontSize = Math.max(10, Math.min(30, Math.floor((containerW - 48) / (num * 0.78))));
  container.style.fontSize = `${targetFontSize}px`;
  const brlInput = container?.parentElement?.querySelector?.('#brlInput') || (typeof document !== 'undefined' ? document.getElementById('brlInput') : null);
  if (brlInput) {
    brlInput.style.fontSize = `${targetFontSize}px`;
  }
}

// Render `brf` (form-feed page breaks, CR?LF lines) into `container`. If
// `opts.rows` is given (from formatDocument's trace), each row div is tagged with
// `data-block` = its source block index (-1 = running head / page number / TOC),
// so the editor can link print↔braille selection.
export function renderBraille(container, brf, opts = {}) {
  const numCells = Math.max(10, (opts.cells | 0) || 38);
  const containerW = container ? (container.clientWidth || 540) : 540;
  // Calculate font size so ALL numCells fit inside available container width (minus padding & scrollbar gutter)
  const targetFontSize = Math.max(10, Math.min(30, Math.floor((containerW - 48) / (numCells * 0.78))));
  const fontSize = opts.cellW ? Math.max(10, Math.round(opts.cellW * 1.55)) : targetFontSize;
  const cellW = Math.round(fontSize / 1.55);
  const rows = opts.rows || null;
  const rowCells = opts.rowCells || null;            // per-row cell→source map (word/cell linking)
  container.textContent = '';
  container.style.fontSize = `${fontSize}px`;
  container.style.lineHeight = '1.4';
  const brlInput = container?.parentElement?.querySelector?.('#brlInput') || (typeof document !== 'undefined' ? document.getElementById('brlInput') : null);
  if (brlInput) {
    brlInput.style.fontSize = `${fontSize}px`;
    brlInput.style.lineHeight = '1.4';
  }
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', opts.textMode ? 'Braille cells' : 'Braille');
  if (!opts.textMode) {
    const hint = document.createElement('p');
    hint.className = 'brl-sr-hint';
    hint.textContent = 'Braille. Each line is exposed as BRF braille ASCII, so a braille display shows the real cells. Set your braille table to English (Eight dot) computer braille.';
    container.appendChild(hint);
  }
  if (!brf) return;

  const fragment = document.createDocumentFragment();
  const pages = brf.split('\f');
  const totalLines = pages.reduce((acc, p) => acc + p.split(/\r\n|\n/).length, 0);
  const deferCells = totalLines > 300; // if doc is larger than ~12 pages, render lightweight text nodes and expand on demand
  let rowIndex = 0;
  const renderedGraphicBlocks = new Set();
  const volumePages = Math.max(0, (opts.volumePages | 0) || 0);

  const items = [];
  const blockFirstItem = new Map();
  const rowHeight = Math.max(20, Math.round(fontSize * 1.45));

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (volumePages > 0 && pi > 0 && pi % volumePages === 0) {
      const volNum = Math.floor(pi / volumePages) + 1;
      const totalVols = Math.ceil(pages.length / volumePages);
      items.push({
        type: 'volbreak',
        volNum,
        totalVols,
        pageNum: pi + 1,
        height: 38,
      });
    }
    if (pi > 0) {
      items.push({
        type: 'pagebreak',
        pageNum: pi + 1,
        height: 32,
      });
    }
    const lines = page.split(/\r\n|\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    for (let li = 0; li < lines.length; li++) {
      const rawLine = lines[li];
      let b = null;
      if (rows) {
        b = rows[rowIndex];
        if (b != null && b >= 0) {
          if (!blockFirstItem.has(b)) blockFirstItem.set(b, items.length);
        }
      }
      const blockObj = (b != null && b >= 0 && opts.blocks) ? opts.blocks[b] : null;
      const isGraphic = (blockObj && blockObj.type === 'graphic' && !renderedGraphicBlocks.has(b));
      if (isGraphic) renderedGraphicBlocks.add(b);

      const isGraphicSkip = (blockObj && blockObj.type === 'graphic' && opts.tactileGraphics !== false && blockObj.svg && !isGraphic);
      if (isGraphicSkip) {
        rowIndex++;
        continue;
      }

      const itemH = isGraphic ? Math.max(220, Math.round((blockObj.heightLines || 15) * rowHeight + 40)) : rowHeight;

      items.push({
        type: 'row',
        rowIndex,
        rawLine,
        block: b,
        blockObj,
        isGraphic,
        height: itemH,
      });
      rowIndex++;
    }
  }

  let curTop = 0;
  for (let i = 0; i < items.length; i++) {
    items[i].top = curTop;
    curTop += items[i].height;
  }
  const totalHeight = curTop;

  function createItemElement(it) {
    if (it.type === 'volbreak') {
      const volSep = document.createElement('div');
      volSep.className = 'brl-volumebreak';
      volSep.innerHTML = `<span class="brl-vol-tag">📚 Volume ${it.volNum} of ${it.totalVols}</span> <span class="brl-vol-page">(Starts at Page ${it.pageNum})</span>`;
      return volSep;
    }
    if (it.type === 'pagebreak') {
      const sep = document.createElement('div');
      sep.className = 'brl-pagebreak';
      sep.textContent = `page ${it.pageNum}`;
      return sep;
    }

    const row = document.createElement('div');
    row.className = 'brl-row';
    if (it.block != null && it.block >= 0) row.dataset.block = String(it.block);
    row.dataset.row = String(it.rowIndex);

    const rawLine = it.rawLine;
    const uni = brfToUnicodeBraille(rawLine);
    row._uni = uni;
    row._rowCells = rowCells ? rowCells[it.rowIndex] : null;
    row._rowIndex = it.rowIndex;

    if (it.isGraphic && it.blockObj) {
      const blockObj = it.blockObj;
      const gWrap = document.createElement('div');
      gWrap.className = 'brl-tactile-graphic-view size-' + (blockObj.size || 'half');
      
      const emb = opts.embosser || 'generic';
      const hasGraphics = opts.tactileGraphics !== false;
      const isTiger = hasGraphics && (emb === 'viewplus' || emb === 'aph');
      const isIndex = hasGraphics && (emb === 'index');
      const isMonarch = hasGraphics && (emb === 'monarch');
      const isDotpad = hasGraphics && (emb === 'dotpad');
      const isSwell = hasGraphics && (emb === 'swell' || emb === 'piaf');

      const badge = document.createElement('div');
      if (isTiger) {
        badge.className = 'hardware-badge tiger';
        badge.innerHTML = '<span>🖨 ViewPlus Tiger / PixBlaster</span> · <span>8-Height 3D Relief</span>';
      } else if (isMonarch) {
        badge.className = 'hardware-badge monarch';
        badge.innerHTML = '<span>🖨 APH Monarch Dynamic Display</span> · <span>32×10 Refreshable Tactile Grid</span>';
      } else if (isDotpad) {
        badge.className = 'hardware-badge dotpad';
        badge.innerHTML = '<span>📱 DotPad 320 Dynamic Display</span> · <span>60×40 Pin Grid + 20-Cell Braille</span>';
      } else if (isIndex) {
        badge.className = 'hardware-badge index';
        badge.innerHTML = '<span>🖨 Index Braille / PageBlaster</span> · <span>ESC +g Dot Matrix</span>';
      } else if (isSwell) {
        badge.className = 'hardware-badge swell';
        badge.innerHTML = '<span>📄 Swell Paper / PIAF</span> · <span>Microcapsule Thermal Tactile</span>';
      } else {
        badge.className = 'hardware-badge textonly';
        badge.innerHTML = '<span>🖨 Text Embosser</span> · <span>Transcriber Note Mode</span>';
      }
      gWrap.appendChild(badge);

      if (hasGraphics && blockObj.svg) {
        const canvas = document.createElement('canvas');
        canvas.className = 'tactile-dot-canvas';
        canvas.style.cssText = 'max-width:100%; border-radius:6px; box-shadow:0 1px 4px rgba(0,0,0,0.12); margin:4px auto; display:block;';
        gWrap.appendChild(canvas);
        
        renderTactileDotCanvas(canvas, blockObj.svg, {
          embosser: emb,
          widthCells: blockObj.widthCells || opts.cells || 38,
          heightLines: blockObj.heightLines || 15,
        });
      } else {
        const noteEl = document.createElement('div');
        noteEl.style.cssText = 'padding:10px; font-family:monospace; font-size:1.1em; color:var(--ink); background:var(--btn-bg); border-radius:6px;';
        noteEl.textContent = `[Transcriber's Note: Tactile diagram — ${blockObj.title || blockObj.alt || 'Graphic'}]`;
        gWrap.appendChild(noteEl);
      }
      row.appendChild(gWrap);
    }

    const isAscii = !!opts.asciiBraille;
    const fontFam = isAscii
      ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
      : '"APHfont", "Apple Braille", "Segoe UI Symbol", monospace';

    if (opts.interline && rawLine.trim()) {
      const printText = opts.rowPrintText ? (opts.rowPrintText[it.rowIndex] || '') : '';
      if (printText) {
        const interlineText = document.createElement('div');
        interlineText.className = 'brl-interline-print';
        interlineText.textContent = printText;
        row.appendChild(interlineText);
      }
    }
    const textContainer = document.createElement('div');
    textContainer.className = 'brl-text-wrap' + (isAscii ? ' brl-ascii' : '');
    textContainer.style.lineHeight = '1.4';
    textContainer.style.letterSpacing = 'normal';
    textContainer.style.fontFamily = fontFam;

    const displayChars = isAscii ? [...rawLine] : [...uni];
    if (!rawLine.trim()) {
      textContainer.textContent = (isAscii ? rawLine : uni) || (isAscii ? ' ' : '\u2800');
    } else if (deferCells) {
      textContainer.textContent = isAscii ? rawLine : uni;
      row._uni = uni;
      row._raw = rawLine;
      row._rowCells = rowCells ? rowCells[it.rowIndex] : null;
      row._rowIndex = it.rowIndex;
      row._isAscii = isAscii;
      row._expanded = false;
    } else {
      let innerHtml = '';
      const curRowCells = rowCells ? rowCells[it.rowIndex] : null;
      for (let ci = 0; ci < displayChars.length; ci++) {
        const ch = displayChars[ci];
        const src = curRowCells ? curRowCells[ci] : null;
        const link = src ? ` data-unit="${src.u}" data-char="${src.c}"` : '';
        innerHtml += `<span class="bcell" data-row="${it.rowIndex}" data-col="${ci}"${link}>${ch}</span>`;
      }
      textContainer.innerHTML = innerHtml;
      row._expanded = true;
    }
    textContainer.setAttribute('aria-hidden', 'true');
    row.appendChild(textContainer);

    if (rawLine.trim()) {
      const brfText = document.createElement('span');
      brfText.className = 'brl-sr-hint';
      brfText.textContent = rawLine;
      row.appendChild(brfText);
      row.setAttribute('aria-braillelabel', rawLine);
    } else {
      row.setAttribute('aria-hidden', 'true');
    }
    return row;
  }

  if (items.length <= 80) {
    for (const it of items) {
      fragment.appendChild(createItemElement(it));
    }
    container.appendChild(fragment);
    container._virtualBraille = null;
    return;
  }

  // Virtualized rendering for documents > 80 items
  const spacer = document.createElement('div');
  spacer.className = 'brl-virtual-spacer';
  spacer.style.cssText = `position:relative;width:100%;height:${totalHeight}px;pointer-events:none;`;

  const windowEl = document.createElement('div');
  windowEl.className = 'brl-virtual-window';
  windowEl.style.cssText = 'position:absolute;top:0;left:0;right:0;width:100%;pointer-events:auto;';
  spacer.appendChild(windowEl);
  container.appendChild(spacer);

  let activeLinkedBlock = null;
  let activeReadingBlock = null;
  let activeWordHl = null;

  function applyActiveClassesToRow(rowEl, it) {
    if (it.block != null) {
      if (activeLinkedBlock != null && it.block === activeLinkedBlock) {
        rowEl.classList.add('brl-linked');
      }
      if (activeReadingBlock != null && it.block === activeReadingBlock) {
        rowEl.classList.add('brl-reading');
      }
    }
  }

  function applyWordHighlightToRow(rowEl, it) {
    if (!activeWordHl || it.block !== activeWordHl.block) return;
    const rIdx = it.rowIndex != null ? it.rowIndex : (rowEl.dataset?.row != null ? Number(rowEl.dataset.row) : null);
    if (activeWordHl.rowIdx != null && activeWordHl.rowIdx >= 0 && rIdx != null && !isNaN(rIdx) && rIdx !== activeWordHl.rowIdx) return;
    expandRowCells(rowEl);
    const { unit, s, e, cw, ch } = activeWordHl;
    rowEl.querySelectorAll('.bcell[data-char]').forEach((c) => {
      if (Number(c.dataset.unit) !== unit) return;
      const n = +c.dataset.char;
      if (n < s || n >= e) return;
      c.classList.add('cell-hl');
      if (c.tagName.toLowerCase() === 'g') {
        const ci = +c.dataset.col;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'cell-box');
        rect.setAttribute('x', (ci * cw + 0.5).toFixed(1));
        rect.setAttribute('y', '0.5');
        rect.setAttribute('width', (cw - 1).toFixed(1));
        rect.setAttribute('height', (ch - 1).toFixed(1));
        rect.setAttribute('rx', '2.5');
        c.insertBefore(rect, c.firstChild);
      }
    });
  }

  let lastStart = -1, lastEnd = -1;

  function renderVisible(force = false) {
    const sTop = container.scrollTop;
    const vH = container.clientHeight || 600;
    const minTop = Math.max(0, sTop - 400);
    const maxTop = sTop + vH + 400;

    let low = 0, high = items.length - 1, startIdx = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (items[mid].top + items[mid].height >= minTop) {
        startIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    let endIdx = startIdx;
    while (endIdx < items.length && items[endIdx].top <= maxTop) {
      endIdx++;
    }

    if (!force && startIdx === lastStart && endIdx === lastEnd) {
      return;
    }
    lastStart = startIdx;
    lastEnd = endIdx;

    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      const it = items[i];
      const el = createItemElement(it);
      el.style.cssText = (el.style.cssText || '') + `;position:absolute;top:${it.top}px;left:0;right:0;`;
      applyActiveClassesToRow(el, it);
      applyWordHighlightToRow(el, it);
      frag.appendChild(el);
    }

    windowEl.textContent = '';
    windowEl.appendChild(frag);
  }

  let scrollRaf = null;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      renderVisible();
    });
  };
  container.addEventListener('scroll', onScroll, { passive: true });

  renderVisible(true);

  container._virtualBraille = {
    isVirtualized: () => true,
    getItems: () => items,
    getTotalHeight: () => totalHeight,
    getBlockOffset: (blockIdx) => {
      const itemIdx = blockFirstItem.get(blockIdx);
      return itemIdx != null ? items[itemIdx]?.top ?? 0 : null;
    },
    getBlockHeight: (blockIdx) => {
      const itemIdx = blockFirstItem.get(blockIdx);
      if (itemIdx == null) return null;
      let h = 0;
      for (let i = itemIdx; i < items.length && items[i].block === blockIdx; i++) {
        h += items[i].height;
      }
      return h > 0 ? h : (items[itemIdx]?.height ?? 20);
    },
    getVisibleBlock: () => {
      const sTop = container.scrollTop;
      let low = 0, high = items.length - 1, best = null;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (items[mid].top <= sTop + 50) {
          if (items[mid].block != null) best = items[mid].block;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return best;
    },
    scrollToBlock: (blockIdx, offset = 0) => {
      const itemIdx = blockFirstItem.get(blockIdx);
      if (itemIdx != null && items[itemIdx]) {
        let blockH = 0;
        for (let i = itemIdx; i < items.length && items[i].block === blockIdx; i++) {
          blockH += items[i].height;
        }
        if (blockH === 0) blockH = items[itemIdx].height || 20;
        const delta = (typeof offset === 'number' && offset >= 0 && offset <= 1)
          ? offset * blockH
          : (typeof offset === 'number' && offset < 0 ? -offset : 0);
        container.scrollTop = Math.max(0, items[itemIdx].top + delta);
        renderVisible(true);
      }
    },
    scrollToRow: (rowIndex, offset = null) => {
      const item = items.find((it) => it.rowIndex === rowIndex);
      if (item) {
        if (typeof offset === 'number') {
          container.scrollTop = Math.max(0, item.top - offset);
        } else {
          const vH = container.clientHeight || 400;
          container.scrollTop = Math.max(0, item.top - (vH / 2) + (item.height / 2));
        }
        renderVisible(true);
      }
    },
    setLinkedBlock: (blockIdx) => {
      activeLinkedBlock = blockIdx;
      windowEl.querySelectorAll('.brl-row.brl-linked').forEach((r) => r.classList.remove('brl-linked'));
      if (blockIdx != null) {
        windowEl.querySelectorAll(`.brl-row[data-block="${blockIdx}"]`).forEach((r) => r.classList.add('brl-linked'));
      }
    },
    setReadingBlock: (blockIdx) => {
      activeReadingBlock = blockIdx;
      windowEl.querySelectorAll('.brl-row.brl-reading').forEach((r) => r.classList.remove('brl-reading'));
      if (blockIdx != null) {
        windowEl.querySelectorAll(`.brl-row[data-block="${blockIdx}"]`).forEach((r) => r.classList.add('brl-reading'));
      }
    },
    setWordHighlight: (hl) => {
      activeWordHl = hl;
      windowEl.querySelectorAll('.bcell.cell-hl').forEach((c) => c.classList.remove('cell-hl'));
      windowEl.querySelectorAll('rect.cell-box').forEach((r) => r.remove());
      if (hl) {
        windowEl.querySelectorAll(`.brl-row[data-block="${hl.block}"]`).forEach((r) => {
          applyWordHighlightToRow(r, { block: hl.block });
        });
      }
    },
    clearWordHighlight: () => {
      activeWordHl = null;
      windowEl.querySelectorAll('.bcell.cell-hl').forEach((c) => c.classList.remove('cell-hl'));
      windowEl.querySelectorAll('rect.cell-box').forEach((r) => r.remove());
    },
    refresh: () => {
      lastStart = -1;
      lastEnd = -1;
      renderVisible(true);
    },
    cleanup: () => {
      container.removeEventListener('scroll', onScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
    },
  };
}
