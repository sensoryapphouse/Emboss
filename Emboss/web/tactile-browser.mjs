import { renderTactileDotCanvas } from '/format/tactile-svg.mjs';

let catalogIndex = null;
const loadedPacks = new Map();
let currentFilterDomain = 'all';
let currentFilterTarget = 'all';
let currentSearchQuery = '';
let currentPage = 1;
const PAGE_SIZE = 18;

function getDevicePreviewInfo(targetDevice) {
  let t = targetDevice;
  if (!t || t === 'all') {
    try {
      const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}');
      t = s.embosser && s.embosser !== 'generic' ? s.embosser : 'viewplus';
    } catch { /* ignore */ }
  }
  if (t === 'tiger' || t === 'viewplus') {
    return { id: 'tiger', name: 'ViewPlus Columbia / Premier (Tiger 8-Height)', badge: '🖨 ViewPlus Tiger · 8-Height Relief', supportsGraphics: true };
  }
  if (t === 'aph') {
    return { id: 'aph', name: 'APH PageBlaster / PixBlaster', badge: '🖨 APH PageBlaster · Tactile Relief', supportsGraphics: true };
  }
  if (t === 'swell' || t === 'piaf') {
    return { id: 'swell', name: 'Swell Paper / PIAF (Heat Fuser)', badge: '📄 Swell Paper · Vector Relief', supportsGraphics: true };
  }
  if (t === 'monarch') {
    return { id: 'monarch', name: 'APH Monarch Dynamic Display (32×10)', badge: '📱 APH Monarch · 32×10 Pin Grid', supportsGraphics: true };
  }
  if (t === 'dotpad') {
    return { id: 'dotpad', name: 'Dot Pad 320 Dynamic Display', badge: '⚡ Dot Pad 320 · Dynamic Matrix', supportsGraphics: true };
  }
  if (t === 'braillo') {
    return { id: 'generic', name: 'Braillo 300 / 600', badge: '🖨 Braillo · Text Only', supportsGraphics: false };
  }
  if (t === 'romeo') {
    return { id: 'generic', name: 'Romeo 60 / Enabling Juliet 120', badge: '🖨 Romeo / Juliet · Text Only', supportsGraphics: false };
  }
  if (t === 'generic' || t === 'custom') {
    return { id: 'generic', name: 'Generic BRF / Standard Embosser', badge: '🖨 Generic BRF · Text Only', supportsGraphics: false };
  }
  return { id: 'index', name: 'Index Basic-D / Everest-D V5', badge: '🖨 Index Braille · Dot Matrix', supportsGraphics: true };
}

/**
 * Initializes and loads the curriculum search index
 */
export async function initTactileBrowser() {
  if (catalogIndex) return catalogIndex;
  try {
    let res = await fetch('/tactile-assets/curriculum-index.json?v=1.405');
    if (!res.ok) res = await fetch('/web/tactile-assets/curriculum-index.json?v=1.405');
    if (res.ok) {
      catalogIndex = await res.json();
    } else {
      const fallback = await fetch('/tactile-symbols-catalog.json?v=1.405');
      catalogIndex = await fallback.json();
    }
  } catch (err) {
    console.warn('Could not load tactile catalog index:', err);
    catalogIndex = [];
  }
  return catalogIndex;
}

/**
 * Loads a specific category pack JSON containing embedded SVGs
 */
export async function getPackByFilename(packFilename) {
  if (loadedPacks.has(packFilename)) return loadedPacks.get(packFilename);
  try {
    let res = await fetch(`/tactile-assets/packs/${packFilename}?v=1.405`);
    if (!res.ok) res = await fetch(`/web/tactile-assets/packs/${packFilename}?v=1.405`);
    if (res.ok) {
      const pack = await res.json();
      const map = new Map(pack.map(item => [item.id, item]));
      loadedPacks.set(packFilename, map);
      return map;
    }
  } catch (err) {
    console.warn(`Failed to fetch pack ${packFilename}:`, err);
  }
  return new Map();
}

/**
 * Opens the Tactile Symbol Browser Modal
 */
export async function openTactileSymbolBrowser(onSelectSymbol, activeDevice = 'all') {
  await initTactileBrowser();
  currentFilterTarget = activeDevice || 'all';

  let modal = document.getElementById('tactile-symbol-modal');
  if (modal) modal.remove(); // Always recreate fresh DOM
  modal = createModalElement();
  document.body.appendChild(modal);

  modal._onSelect = onSelectSymbol;
  modal.style.display = 'flex';
  
  const targetSelect = modal.querySelector('#tsb-target-select');
  if (targetSelect) {
    targetSelect.value = currentFilterTarget;
  }

  renderSymbolGrid();
}

/**
 * Creates the modal DOM element with pure, self-contained CSS
 */
function createModalElement() {
  const modal = document.createElement('div');
  modal.id = 'tactile-symbol-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(4px);
    z-index: 99999;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  modal.innerHTML = `
    <div style="position: relative; background: #ffffff; width: 100%; max-width: 960px; max-height: 90vh; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e2e8f0;">
      
      <!-- Modal Header -->
      <div style="padding: 14px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; background: #f8fafc;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 36px; height: 36px; border-radius: 8px; background: #e0f2fe; color: #0284c7; display: flex; align-items: center; justify-content: center; font-size: 18px;">
            🖼
          </div>
          <div>
            <h2 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0;">
              Tactile Symbol Library
            </h2>
            <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">Search 1,400+ curriculum tactile graphics for Swell Paper, Tiger 3D, Monarch, Dot Pad & Index.</p>
          </div>
        </div>
        <button id="tsb-close-btn" style="border: 0; background: transparent; cursor: pointer; padding: 6px 10px; font-size: 18px; color: #64748b; border-radius: 6px;" aria-label="Close">✕</button>
      </div>

      <!-- Toolbar & Filters -->
      <div style="padding: 10px 20px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 12px; align-items: center; background: #ffffff;">
        <input type="text" id="tsb-search-input" placeholder="Search 1,400+ tactile graphics (e.g. beaker, decagon, compass, cell, microscope)..." 
               style="flex: 1; padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none;" />
        <div id="tsb-text-only-badge" style="display: none; flex: 1; align-items: center; gap: 8px; padding: 8px 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 13px; color: #991b1b; font-weight: 600;">
          <span>🚫 Text-Only Embosser Mode</span>
        </div>
        
        <select id="tsb-target-select" style="padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; font-weight: 600; background: #f8fafc; color: #334155;">
          <option value="viewplus">🖨 ViewPlus Columbia / Premier (Tiger 8-Height)</option>
          <option value="index">🖨 Index Basic-D / Everest-D V5</option>
          <option value="aph">🖨 APH PageBlaster / PixBlaster</option>
          <option value="monarch">📱 APH Monarch Dynamic Display (32×10)</option>
          <option value="braillo">🖨 Braillo 300 / 600</option>
          <option value="romeo">🖨 Romeo 60 / Enabling Juliet 120</option>
          <option value="swell">📄 Swell Paper / PIAF (Heat Fuser)</option>
          <option value="dotpad">⚡ Dot Pad 320 Dynamic Display</option>
          <option value="generic">🖨 Generic BRF / Standard Embosser</option>
        </select>
      </div>

      <!-- Domain Category Chips (All clearly visible without horizontal cut-off) -->
      <div id="tsb-cat-bar" style="padding: 8px 20px; border-bottom: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; gap: 6px 8px; background: #f8fafc;">
        <button class="tsb-cat-btn active" data-domain="all" style="padding: 4px 12px; border-radius: 16px; border: 0; font-size: 12px; font-weight: 600; cursor: pointer; background: #0284c7; color: #ffffff;">All</button>
        <button class="tsb-cat-btn" data-domain="maths-geometry" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">📐 Maths & Geometry</button>
        <button class="tsb-cat-btn" data-domain="science-stem" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">🔬 Science & STEM</button>
        <button class="tsb-cat-btn" data-domain="tools-technology" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">🔧 Tools & Tech</button>
        <button class="tsb-cat-btn" data-domain="living-world" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">🌿 Living World</button>
        <button class="tsb-cat-btn" data-domain="school-classroom" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">🏫 School & Classroom</button>
        <button class="tsb-cat-btn" data-domain="food-drink" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">🍎 Food & Drink</button>
        <button class="tsb-cat-btn" data-domain="geography-transport" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">🌍 Geography & Transport</button>
        <button class="tsb-cat-btn" data-domain="everyday-life" style="padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd5e1; font-size: 12px; font-weight: 500; cursor: pointer; background: #ffffff; color: #334155;">🏠 Everyday Life</button>
      </div>

      <!-- Symbols Grid Container (Zero vertical scrollbar; stepped page layout) -->
      <div id="tsb-grid-container" style="flex: 1; min-height: 380px; padding: 14px 20px; overflow: hidden; background: #ffffff; display: flex; flex-direction: column; position: relative;">
        <div id="tsb-grid" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; overflow: hidden; align-content: start; flex: 1;">
          <!-- Injected dynamically -->
        </div>
        <div id="tsb-empty-state" style="display: none; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; color: #94a3b8; flex: 1;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
          <p style="font-size: 13px; font-weight: 500; margin: 0;">No symbols match the current search or filter.</p>
        </div>

        <!-- Centered Non-Graphics State View -->
        <div id="tsb-no-graphics-state" style="display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px 30px; flex: 1;">
          <div style="width: 60px; height: 60px; border-radius: 50%; background: #fee2e2; display: flex; align-items: center; justify-content: center; font-size: 30px; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.15);">🚫</div>
          <h3 id="tsb-no-graphics-title" style="font-size: 19px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">Graphics not available for Braillo 300 / 600</h3>
          <p style="font-size: 13px; color: #64748b; max-width: 480px; line-height: 1.6; margin: 0 0 24px 0;">This embosser model is configured for volume braille text and does not support tactile graphic rendering. To browse and insert tactile graphics, switch to a graphics-capable embosser or swell paper:</p>
          <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;">
            <button id="tsb-switch-vp-btn" style="padding: 9px 18px; border-radius: 8px; border: 0; background: #0284c7; color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 2px 8px rgba(2,132,199,0.25);">🖨 ViewPlus Tiger</button>
            <button id="tsb-switch-index-btn" style="padding: 9px 18px; border-radius: 8px; border: 0; background: #1e293b; color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 2px 8px rgba(30,41,59,0.25);">🖨 Index Braille V5</button>
            <button id="tsb-switch-swell-btn" style="padding: 9px 18px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">📄 Swell Paper</button>
          </div>
        </div>
      </div>

      <!-- Footer & Pagination with Arrows -->
      <div id="tsb-footer" style="padding: 10px 20px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; background: #f8fafc; font-size: 12px; color: #64748b;">
        <div id="tsb-count-label">Showing 0 of 0 symbols</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="tsb-prev-btn" style="padding: 5px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; cursor: pointer; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; color: #1e293b;">&larr; Previous</button>
          <span id="tsb-page-label" style="font-weight: 600; color: #334155; min-width: 80px; text-align: center;">Page 1 of 1</span>
          <button id="tsb-next-btn" style="padding: 5px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; cursor: pointer; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; color: #1e293b;">Next &rarr;</button>
        </div>
      </div>

    </div>

    <!-- Floating Hover Embosser Simulation Tooltip -->
    <div id="tsb-hover-tooltip" style="position: fixed; z-index: 100002; pointer-events: none; background: #0f172a; color: #ffffff; border: 1px solid #334155; border-radius: 12px; padding: 12px; box-shadow: 0 20px 35px -5px rgba(0, 0, 0, 0.55); display: none; flex-direction: column; align-items: center; width: 220px; box-sizing: border-box; transition: opacity 0.12s ease;">
      <div style="width: 100%; display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <span id="tsb-tt-name" style="font-size: 12px; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;"></span>
        <span id="tsb-tt-domain" style="font-size: 9px; padding: 2px 6px; border-radius: 8px; background: #1e293b; color: #38bdf8; font-weight: 600; text-transform: uppercase;"></span>
      </div>
      <div id="tsb-tt-badge" style="font-size: 10px; color: #94a3b8; font-weight: 500; margin-bottom: 6px; width: 100%; text-align: left;"></div>
      <div style="width: 196px; min-height: 120px; border-radius: 8px; overflow: hidden; background: #1e293b; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 2px 4px rgba(0,0,0,0.3); border: 1px solid #334155; margin: 2px 0;">
        <canvas id="tsb-tt-canvas" style="width: 196px; height: 120px; display: block; border-radius: 6px;"></canvas>
      </div>
      <div style="font-size: 10px; color: #94a3b8; margin-top: 6px; text-align: center;">Simulated Embosser Output · Click to insert</div>
    </div>
  `;

  // Attach event handlers
  const closeModal = () => {
    modal.style.display = 'none';
    const tt = modal.querySelector('#tsb-hover-tooltip');
    if (tt) tt.style.display = 'none';
  };
  modal.querySelector('#tsb-close-btn').onclick = closeModal;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });
  
  const searchInput = modal.querySelector('#tsb-search-input');
  searchInput.oninput = (e) => {
    currentSearchQuery = e.target.value.toLowerCase().trim();
    currentPage = 1;
    renderSymbolGrid();
  };

  const targetSelect = modal.querySelector('#tsb-target-select');
  targetSelect.onchange = (e) => {
    currentFilterTarget = e.target.value;
    if (['generic', 'viewplus', 'index', 'aph', 'monarch', 'braillo', 'romeo'].includes(e.target.value)) {
      try {
        const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}');
        s.embosser = e.target.value;
        localStorage.setItem('emboss-settings', JSON.stringify(s));
      } catch {}
    }
    currentPage = 1;
    renderSymbolGrid();
  };

  const switchVpBtn = modal.querySelector('#tsb-switch-vp-btn');
  if (switchVpBtn) {
    switchVpBtn.onclick = () => {
      targetSelect.value = 'viewplus';
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }

  const switchIndexBtn = modal.querySelector('#tsb-switch-index-btn');
  if (switchIndexBtn) {
    switchIndexBtn.onclick = () => {
      targetSelect.value = 'index';
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }

  const switchSwellBtn = modal.querySelector('#tsb-switch-swell-btn');
  if (switchSwellBtn) {
    switchSwellBtn.onclick = () => {
      targetSelect.value = 'swell';
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }

  modal.querySelectorAll('.tsb-cat-btn').forEach(btn => {
    btn.onclick = () => {
      modal.querySelectorAll('.tsb-cat-btn').forEach(b => {
        b.style.background = '#ffffff';
        b.style.color = '#334155';
        b.style.border = '1px solid #cbd5e1';
      });
      btn.style.background = '#0284c7';
      btn.style.color = '#ffffff';
      btn.style.border = '0';
      currentFilterDomain = btn.dataset.domain;
      currentPage = 1;
      renderSymbolGrid();
    };
  });

  modal.querySelector('#tsb-prev-btn').onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      renderSymbolGrid();
    }
  };

  modal.querySelector('#tsb-next-btn').onclick = () => {
    currentPage++;
    renderSymbolGrid();
  };

  return modal;
}

/**
 * Renders the symbol grid based on active search, domain, and target filter
 */
async function renderSymbolGrid() {
  const modal = document.getElementById('tactile-symbol-modal');
  if (!modal || !catalogIndex) return;

  const grid = modal.querySelector('#tsb-grid');
  const emptyState = modal.querySelector('#tsb-empty-state');
  const noGraphicsState = modal.querySelector('#tsb-no-graphics-state');
  const noGraphicsTitle = modal.querySelector('#tsb-no-graphics-title');
  const catBar = modal.querySelector('#tsb-cat-bar');
  const footer = modal.querySelector('#tsb-footer');
  const searchInput = modal.querySelector('#tsb-search-input');
  const textOnlyBadge = modal.querySelector('#tsb-text-only-badge');
  const countLabel = modal.querySelector('#tsb-count-label');
  const pageLabel = modal.querySelector('#tsb-page-label');
  const prevBtn = modal.querySelector('#tsb-prev-btn');
  const nextBtn = modal.querySelector('#tsb-next-btn');

  const devInfo = getDevicePreviewInfo(currentFilterTarget);

  // If the selected embosser does not support graphics, cleanly show non-graphics state
  if (!devInfo.supportsGraphics) {
    if (grid) grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
    if (catBar) catBar.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (searchInput) searchInput.style.display = 'none';
    if (textOnlyBadge) textOnlyBadge.style.display = 'flex';
    if (noGraphicsState) {
      noGraphicsState.style.display = 'flex';
      if (noGraphicsTitle) {
        noGraphicsTitle.textContent = `Graphics not available for ${devInfo.name}`;
      }
    }
    const tt = modal.querySelector('#tsb-hover-tooltip');
    if (tt) tt.style.display = 'none';
    return;
  }

  // Restore interactive controls for graphics-capable devices
  if (grid) grid.style.display = 'grid';
  if (catBar) catBar.style.display = 'flex';
  if (footer) footer.style.display = 'flex';
  if (searchInput) searchInput.style.display = 'block';
  if (textOnlyBadge) textOnlyBadge.style.display = 'none';
  if (noGraphicsState) noGraphicsState.style.display = 'none';
function normalizeSearchText(text) {
  if (!text) return '';
  return text.toLowerCase()
    .replace(/\bcolour(ed)?\b/g, 'color$1')
    .replace(/\bcentre(d)?\b/g, 'center$1')
    .replace(/\bgrey\b/g, 'gray')
    .replace(/\btheatre\b/g, 'theater')
    .replace(/\bdisc\b/g, 'disk')
    .replace(/\bmetre\b/g, 'meter')
    .replace(/\blitre\b/g, 'liter')
    .replace(/\bflavour\b/g, 'flavor')
    .replace(/\borganise\b/g, 'organize')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesTactileSearch(item, query) {
  if (!query) return true;
  const normQuery = normalizeSearchText(query);
  if (!normQuery) return true;

  const normName = normalizeSearchText(item.name);
  const normDomain = normalizeSearchText(item.domain);
  const normSub = normalizeSearchText(item.sub || '');
  const combined = `${normName} ${normDomain} ${normSub}`;

  if (combined.includes(normQuery)) return true;

  const tokens = normQuery.split(' ').filter(Boolean);
  return tokens.every(tok => combined.includes(tok));
}

  // Filter by category domain and search query (all master symbols dynamically transform to the selected embosser/device)
  let filtered = catalogIndex.filter(item => {
    if (currentFilterDomain !== 'all' && item.domain !== currentFilterDomain) return false;
    if (currentSearchQuery && !matchesTactileSearch(item, currentSearchQuery)) return false;
    return true;
  });

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  countLabel.textContent = `Showing ${totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–${Math.min(totalItems, currentPage * PAGE_SIZE)} of ${totalItems} symbols`;
  pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;

  if (totalItems === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Group items by pack filename to fetch packs efficiently
  const neededPacks = new Set(pageItems.map(i => i.pack));
  const packs = {};
  for (const packFile of neededPacks) {
    packs[packFile] = await getPackByFilename(packFile);
  }

  const tooltip = modal.querySelector('#tsb-hover-tooltip');
  const ttName = modal.querySelector('#tsb-tt-name');
  const ttDomain = modal.querySelector('#tsb-tt-domain');
  const ttBadge = modal.querySelector('#tsb-tt-badge');
  const ttCanvas = modal.querySelector('#tsb-tt-canvas');

  let activeHoverId = null;

  grid.innerHTML = '';

  for (const item of pageItems) {
    const packMap = packs[item.pack];
    const fullItem = packMap ? packMap.get(item.id) : null;
    const rawSvg = fullItem ? fullItem.svg : '';

    const card = document.createElement('div');
    card.style.cssText = `
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      cursor: pointer;
      transition: all 0.15s ease;
      box-sizing: border-box;
    `;

    card.onmouseenter = () => {
      card.style.borderColor = '#0284c7';
      card.style.boxShadow = '0 4px 12px rgba(2, 132, 199, 0.15)';
      card.style.transform = 'translateY(-2px)';

      if (!rawSvg || !tooltip) return;
      activeHoverId = item.id;
      const devInfo = getDevicePreviewInfo(currentFilterTarget);
      if (ttName) ttName.textContent = item.name;
      if (ttDomain) ttDomain.textContent = item.domain || 'graphic';
      if (ttBadge) ttBadge.textContent = devInfo.badge;

      const rect = card.getBoundingClientRect();
      const ttWidth = 220;
      const ttHeight = 195;
      let left = rect.left + rect.width / 2 - ttWidth / 2;
      let top = rect.top - ttHeight - 10;

      if (top < 10) {
        top = rect.bottom + 10;
      }
      if (left < 10) left = 10;
      if (left + ttWidth > window.innerWidth - 10) left = window.innerWidth - ttWidth - 10;

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.display = 'flex';

      if (ttCanvas) {
        renderTactileDotCanvas(ttCanvas, rawSvg, {
          targetDevice: devInfo.id,
          widthCells: 24,
          heightLines: 12
        });
      }
    };

    card.onmouseleave = () => {
      card.style.borderColor = '#e2e8f0';
      card.style.boxShadow = 'none';
      card.style.transform = 'none';
      if (activeHoverId === item.id && tooltip) {
        tooltip.style.display = 'none';
      }
    };

    card.innerHTML = `
      <div style="width: 76px; height: 76px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 4px;">
        <div style="width: 64px; height: 64px; display: flex; align-items: center; justify-content: center;" class="tsb-svg-holder">
          ${rawSvg ? rawSvg : '<div style="font-size: 10px; color: #94a3b8;">Loading...</div>'}
        </div>
      </div>
      <span style="font-size: 11px; font-weight: 600; color: #1e293b; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2;" title="${item.name}">${item.name}</span>
    `;

    // Ensure SVGs inside the holder are constrained
    const svgEl = card.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = '64px';
      svgEl.style.maxHeight = '64px';
      svgEl.style.width = 'auto';
      svgEl.style.height = 'auto';
    }

    card.onclick = () => {
      if (tooltip) tooltip.style.display = 'none';
      if (modal._onSelect && rawSvg) {
        modal._onSelect(item, rawSvg);
        modal.style.display = 'none';
      }
    };

    grid.appendChild(card);
  }
}
