import * as louis from '/engine/louis-browser.mjs';
import { formatDocument } from '/format/document.mjs';
import { parseFile, BINARY_EXTS } from '/input/parse.mjs';
import * as maths from '/engine/maths.mjs';
import { initMaths, isMathsReady } from '/engine/maths.mjs';
import { styledTranslate } from '/format/text-style.mjs';
import { Reader, buildSpokenItems } from '/web/tts.mjs';
import { brfToUnicodeBraille } from '/engine/brf-ascii.mjs';
import { loadSettings, saveSettings, MODE_GEOMETRY, EMBOSSER_PRESETS, effectiveMathCode } from '/web/settings.mjs';
import { resolveTable, makeTranslators, UEB_TABLES } from '/web/braille-table.mjs';

import { spoolToEmbosser, isWebSerialSupported, initEmbosserAutoDetect } from '/format/spooler.mjs';
import { exportToPef } from '/format/pef.mjs';
import { exportToEbraille } from '/format/ebraille.mjs';
import { tactileDisplay } from '/format/tactile-display.mjs';
import { CODES } from '/Translate/braille-codes.mjs';
import { setHandoffDoc } from '/web/handoff-db.mjs';
import { initI18n, t, setLocale, getLocale, getOrderedLocales, translateDOM } from '/web/i18n.mjs';

// If the user turned Simple mode OFF, this page is the editor's — go there.
if (!loadSettings().simpleMode) location.replace('/web/editor/index.html');

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $('dropzone'), fileInput: $('fileInput'), chooseBtn: $('chooseBtn'),
  fileName: $('fileName'), mode: $('mode'), cells: $('cells'),
  lines: $('lines'), quoteStyle: $('quoteStyle'), listStyle: $('listStyle'), paragraphStyle: $('paragraphStyle'),
  embosser: $('embosser'), embosserDuplex: $('embosserDuplex'), asciiBraille: $('asciiBraille'), pinpoint: $('set-pinpoint') || $('pinpoint'),
  baudRate: $('baudRate'), includeCovers: $('includeCovers'),
  language: $('language'), tableFormat: $('tableFormat'), interline: $('interline'), status: $('status'),
  fileActions: $('fileActions'), dzReadBtn: $('dzReadBtn'), dzEmbossBtn: $('dzEmbossBtn'),
  result: $('result'), preview: $('preview'), resultMeta: $('resultMeta'),
  downloadBtn: $('downloadBtn'), downloadFormat: $('downloadFormat'), downloadPefBtn: $('downloadPefBtn'), spoolBtn: $('spoolBtn'),
  readBtn: $('readBtn'), embossBtn: $('embossBtn'), engineVer: $('engineVer'),
  settingsBtn: $('settingsBtn'), helpBtn: $('helpBtn'),
  settingsDialog: $('settingsDialog'), helpDialog: $('helpDialog'), helpClose: $('helpClose'),
  settingsSummary: $('settingsSummary'), simpleMode: $('simpleMode'), advancedBtn: $('advancedBtn'),
};

let currentDoc = null;      // parsed document model
let currentName = 'document';
let lastBrf = null;
let lastOpts = null;        // format options the preview was built with
let engineReady = false;    // liblouis loaded — until then, defer transcription
let reader = null;

let codesExpanded = false;
const displayNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }) : null;

function getLanguageLabel(c) {
  let name = c.lang;
  try { if (displayNames) name = displayNames.of(c.lang) || c.lang; } catch { /* fallback */ }
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return `${name}${c.grade ? ' (' + c.grade + ')' : ''}`;
}

function populateLanguageDropdown() {
  if (!el.language) return;
  const s = loadSettings();
  const inUseCode = s.brailleCode || `${s.language}_${s.grade}`;
  const recentList = Array.isArray(s.recentCodes) && s.recentCodes.length
    ? [...s.recentCodes]
    : [inUseCode];
  if (inUseCode && !recentList.includes(inUseCode)) {
    recentList.unshift(inUseCode);
  }
  const topCodes = recentList.slice(0, 5);

  const uiLoc = (s.uiLanguage || (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en').split('-');
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

  // Sort by rank first (Top 5 & Local top), then alphabetically by Display Name
  const shownCodes = base.slice().sort((a, b) => {
    const rA = rank(a), rB = rank(b);
    if (rA !== rB) return rA - rB;
    const nameA = getLanguageLabel(a);
    const nameB = getLanguageLabel(b);
    return nameA.localeCompare(nameB);
  });
  const restCount = CODES.length - shownCodes.length;

  el.language.innerHTML = '';
  for (const c of shownCodes) {
    const label = getLanguageLabel(c);
    el.language.appendChild(new Option(c.shipped !== false ? label : `${label} (needs internet first time)`, c.id));
  }
  if (!codesExpanded && restCount > 0) {
    el.language.appendChild(new Option(`… more languages (${restCount})`, '__more__'));
  }
  if (inUseCode && CODES.some((c) => c.id === inUseCode)) {
    el.language.value = inUseCode;
  } else if (el.language.options.length) {
    el.language.value = el.language.options[0].value;
  }
}

function populateUiLanguageDropdown() {
  const sel = $('set-uiLanguage');
  if (!sel) return;
  const s = loadSettings();
  const current = s.uiLanguage || getLocale() || 'en';
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

// apply the shared persisted settings to the controls, and persist changes back so
// the editor ("Simple mode off") stays in sync.
(async () => {
  const s = loadSettings();
  try {
    await initI18n(s.uiLanguage || 'en');
  } catch (_) {}
  if (el.mode) el.mode.value = s.mode;
  el.cells.value = s.cells; el.lines.value = s.lines;
  el.quoteStyle.value = s.quoteStyle; el.listStyle.value = s.listStyle;
  if (el.paragraphStyle) el.paragraphStyle.value = s.paragraphStyle || 'indented';
  if (el.embosser) el.embosser.value = s.embosser || 'generic';
  if (el.embosserDuplex) el.embosserDuplex.value = s.embosserDuplex || 'double';
  populateLanguageDropdown();
  populateUiLanguageDropdown();
  if (el.tableFormat) el.tableFormat.value = s.tableFormat || 'auto';
  if (el.baudRate) el.baudRate.value = String(s.baudRate || 9600);
  if (el.includeCovers) el.includeCovers.checked = !!s.includeCovers;
  if (el.interline) el.interline.checked = !!s.interline;
  if (el.pinpoint) el.pinpoint.checked = (s.dotStyle === 'pinpoint');
  if (el.asciiBraille) el.asciiBraille.checked = !!s.asciiBraille;
  if (el.simpleMode) el.simpleMode.checked = s.simpleMode;

  $('set-uiLanguage')?.addEventListener('change', async (e) => {
    const newLang = e.target.value;
    saveSettings({ uiLanguage: newLang });
    await setLocale(newLang);
    populateUiLanguageDropdown();
    populateLanguageDropdown();
  });
})();
function persistSettings() {
  const langVal = el.language ? el.language.value : 'en-ueb-g2';
  if (langVal === '__more__') {
    codesExpanded = true;
    populateLanguageDropdown();
    return;
  }
  const selectedCode = CODES.find((c) => c.id === langVal);
  const lang = selectedCode ? selectedCode.lang : (langVal.split('_')[0] || 'ueb');
  const gr = selectedCode ? (selectedCode.grade.includes('2') ? 'g2' : 'g1') : (langVal.split('_')[1] || 'g2');
  const s = loadSettings();
  let recent = Array.isArray(s.recentCodes) ? [...s.recentCodes] : [];
  recent = [langVal, ...recent.filter((id) => id !== langVal)].slice(0, 5);
  saveSettings({
    brailleCode: langVal,
    recentCodes: recent,
    language: lang,
    grade: gr,
    mode: el.mode ? el.mode.value : s.mode,
    cells: Number(el.cells.value) || 38, lines: Number(el.lines.value) || 25,
    quoteStyle: el.quoteStyle.value, listStyle: el.listStyle.value,
    paragraphStyle: el.paragraphStyle ? el.paragraphStyle.value : 'indented',
    embosser: el.embosser ? el.embosser.value : 'generic',
    embosserDuplex: el.embosserDuplex ? el.embosserDuplex.value : 'double',
    baudRate: el.baudRate ? Number(el.baudRate.value) : 9600,
    includeCovers: el.includeCovers ? el.includeCovers.checked : false,
    tableFormat: el.tableFormat ? el.tableFormat.value : 'auto',
    interline: el.interline ? el.interline.checked : false,
    dotStyle: (el.pinpoint && el.pinpoint.checked) ? 'pinpoint' : 'shadow',
    asciiBraille: el.asciiBraille ? el.asciiBraille.checked : false,
  });
  if (selectedCode && selectedCode.table) {
    louis.ensureTables(selectedCode.table).catch(console.error);
  }
}

function setStatus(msg, kind = '') { el.status.textContent = msg; el.status.className = 'status ' + kind; }

// ---- engine bootstrap ----
(async () => {
  try {
    setStatus('Loading braille engine…');
    const ver = await louis.init({ tablesBaseUrl: '/liblouis/tables' });
    el.engineVer.textContent = ver;
    engineReady = true;
    if (currentDoc) transcribe();                     // a file dropped before the engine was ready
    else setStatus('Ready. Drop or choose a document to begin.', 'ok');
    // Maths engine (MathCAT) loads in the background; non-fatal if it fails.
    // When it arrives, re-transcribe so any equations appear.
    initMaths().then(() => { if (currentDoc) transcribe(); }).catch((e) => console.warn('maths engine unavailable:', e));
  } catch (e) {
    setStatus('Engine failed to load: ' + e.message, 'err');
    console.error(e);
  }
})();

// ---- file intake ----
async function acceptFile(file) {
  el.fileName.textContent = file.name;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    setStatus('Reading “' + file.name + '”…');
    const payload = BINARY_EXTS.has(ext) ? await file.arrayBuffer() : await file.text();
    currentDoc = await parseFile(file.name, payload);
    currentName = file.name.replace(/\.[^.]+$/, '') || 'document';   // set the download name only after a good parse
    transcribe();                                     // transcribe immediately — no separate Convert step
  } catch (e) {
    currentDoc = null; lastBrf = null; el.result.hidden = true;
    setStatus('Could not read that file: ' + e.message, 'err');
    console.error(e);
  }
}

el.chooseBtn.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('click', (e) => { if (e.target === el.dropzone || e.target.closest('.dz-inner') && e.target.tagName !== 'BUTTON') el.fileInput.click(); });
el.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); } });
el.fileInput.addEventListener('change', () => { if (el.fileInput.files[0]) acceptFile(el.fileInput.files[0]); });

['dragenter', 'dragover'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove('drag'); }));
el.dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) acceptFile(f); });

// ---- settings dialog + summary ----
function updateSummary() {
  const s = loadSettings();
  el.settingsSummary.textContent =
    `${s.mode.toUpperCase()} · Grade ${s.grade === 'g1' ? 1 : 2} · ${el.cells.value}×${el.lines.value}`;
}
// Layout standard: UKAAF and BANA each have a default page geometry. Apply it when the
// standard changes unless a hardware preset already fixes the page size.
if (el.mode) el.mode.addEventListener('change', () => {
  const g = MODE_GEOMETRY[el.mode.value];
  if (g && (!el.embosser || el.embosser.value === 'generic')) { el.cells.value = g.cells; el.lines.value = g.lines; }
  updateSummary(); persistSettings(); transcribe();
});
if (el.embosser) el.embosser.addEventListener('change', () => {
  const p = EMBOSSER_PRESETS[el.embosser.value];
  if (p) {
    el.cells.value = p.cells;
    el.lines.value = p.lines;
    if (p.baudRate && el.baudRate) {
      el.baudRate.value = String(p.baudRate);
    }
  }
  updateSummary(); persistSettings(); transcribe();
});
[el.cells, el.lines, el.quoteStyle, el.listStyle, el.paragraphStyle, el.language, el.tableFormat, el.embosserDuplex, el.baudRate, el.includeCovers, el.pinpoint, el.interline, el.asciiBraille].forEach((c) => c?.addEventListener('change', () => { updateSummary(); persistSettings(); transcribe(); }));
updateSummary();

// Automatic hardware embosser USB hotplug detection
initEmbosserAutoDetect((profile) => {
  saveSettings(profile.presets);
  if (el.embosser) el.embosser.value = profile.presets.embosser || 'generic';
  if (el.cells) el.cells.value = profile.presets.cells;
  if (el.lines) el.lines.value = profile.presets.lines;
  if (el.baudRate) el.baudRate.value = String(profile.presets.baudRate || 9600);
  if (el.embosserDuplex) el.embosserDuplex.value = profile.presets.embosserDuplex || 'double';
  updateSummary();
  transcribe();
  setStatus(`🔌 Detected ${profile.name} — configured to ${profile.presets.cells}×${profile.presets.lines} at ${profile.presets.baudRate || 9600} baud.`, 'ok');
}, () => {
  setStatus('Embosser disconnected.');
});

// Switch to the live editor, carrying the uploaded document across so it opens there
// (the editor loads this stashed model instead of its demo). No re-parsing.
async function goEditor() {
  if (currentDoc) {
    await setHandoffDoc(currentDoc);
  }
  saveSettings({ simpleMode: false });
  location.href = '/web/editor/index.html';
}
// Simple mode OFF → switch to the live editor (persist the choice first)
if (el.simpleMode) el.simpleMode.addEventListener('change', () => {
  if (!el.simpleMode.checked) goEditor();
  else saveSettings({ simpleMode: true });
});

if (el.advancedBtn) el.advancedBtn.addEventListener('click', goEditor);
el.settingsBtn.addEventListener('click', () => el.settingsDialog.showModal());
el.helpBtn.addEventListener('click', () => el.helpDialog.showModal());
el.helpClose.addEventListener('click', () => el.helpDialog.close());
// close dialogs on backdrop click
for (const d of [el.settingsDialog, el.helpDialog]) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

// ---- transcribe ----
// Runs automatically as soon as a document is loaded, and again whenever a setting
// changes — no "Convert" step. Download stays the one deliberate action.
async function transcribe() {
  if (!currentDoc) return;
  if (!engineReady) { setStatus('Loading braille engine…'); return; }   // will re-run once init resolves
  try {
    setStatus('Transcribing…');
    const s = loadSettings();
    const langCode = s.brailleCode || 'en-ueb-g2';
    // The code's own table list, fetched on demand (most of the 142 codes are not in the
    // engine's filesystem until first use). The translators normalise to BRF ASCII —
    // the codes are listed with unicode.dis, and a .brf must never carry Unicode.
    const table = resolveTable(s);
    await louis.ensureTables(table);
    const tr = makeTranslators(louis, table);
    const quoteStyleVal = el.quoteStyle ? el.quoteStyle.value : (s.quoteStyle || 'faithful');
    const translate = styledTranslate((t, tf) => tr.translate(t, tf), quoteStyleVal);   // tf: bold/italic/underline typeform
    const translateG1 = /en-ueb/.test(table) ? (t) => makeTranslators(louis, UEB_TABLES.g1).translate(t) : undefined;
    const modeVal = s.mode || 'ukaaf';
    const cellsVal = el.cells ? Number(el.cells.value) : (s.cells || 38);
    const linesVal = el.lines ? Number(el.lines.value) : (s.lines || 25);
    const opts = {
      mode: modeVal,
      width: Math.max(10, cellsVal || 38),
      depth: Math.max(10, linesVal || 25),
      paragraphStyle: el.paragraphStyle ? el.paragraphStyle.value : (s.paragraphStyle || 'indented'),
      listStyle: el.listStyle ? el.listStyle.value : (s.listStyle || 'spaced'),
      tableFormat: el.tableFormat ? el.tableFormat.value : (s.tableFormat || 'auto'),
      translate, translateG1,
      mathToBrf: isMathsReady() ? (seg) => maths.mathToBrf(seg, effectiveMathCode(s)) : null,
    };
    lastBrf = formatDocument(currentDoc, opts);
    lastOpts = opts;                                   // the PEF/eBraille exports re-format with exactly these
    const displayTxt = s.asciiBraille ? lastBrf : brfToUnicodeBraille(lastBrf);
    el.preview.textContent = displayTxt.replace(/\x0c/g, '\n──────── page break ────────\n');
    const pages = lastBrf.split('\x0c').length;
    const gradeStr = langCode.includes('g1') ? 'Grade 1' : 'Grade 2';
    el.resultMeta.textContent = `${opts.width}×${opts.depth} · ${modeVal.toUpperCase()} · ${gradeStr} · ${pages} page${pages === 1 ? '' : 's'}`;
    el.result.hidden = false;
    if (el.fileActions) el.fileActions.style.display = 'flex';
    if (s.embosser === 'monarch' && tactileDisplay.isConnected()) {
      tactileDisplay.updateBraille(lastBrf);
    }
    setStatus('Braille ready below — change any setting to update it, then Download the .brf.', 'ok');
  } catch (e) {
    // Never leave a stale, downloadable BRF that contradicts the current settings/preview.
    lastBrf = null; el.result.hidden = true;
    if (el.fileActions) el.fileActions.style.display = 'none';
    setStatus('Transcription failed: ' + e.message, 'err');
    console.error(e);
  }
}

// ---- read aloud in Quick Mode ----
function handleReadAloud() {
  if (!currentDoc) return;
  if (!reader) reader = new Reader();
  if (reader.speaking) {
    reader.stop();
    if (el.readBtn) el.readBtn.textContent = '▶ Read Aloud';
    if (el.dzReadBtn) el.dzReadBtn.textContent = '▶ Read Aloud';
    setStatus('Speech stopped.', 'ok');
    return;
  }
  const items = buildSpokenItems(currentDoc);
  if (!items.length) { setStatus('Nothing to read.'); return; }
  if (el.readBtn) el.readBtn.textContent = '⏹ Stop Reading';
  if (el.dzReadBtn) el.dzReadBtn.textContent = '⏹ Stop Reading';
  setStatus('Reading document aloud…', 'ok');
  reader.speak(items);
}

if (el.readBtn) el.readBtn.addEventListener('click', handleReadAloud);
if (el.dzReadBtn) el.dzReadBtn.addEventListener('click', handleReadAloud);

// ---- unified emboss / print & direct spool ----
async function handleEmbossPrint() {
  if (!lastBrf) return;
  const s = loadSettings();
  const conn = s.connectionType || 'serial';
  try {
    const modeLabel = conn === 'ble' ? 'Bluetooth' : (conn === 'hid' ? 'USB HID' : (conn === 'network' ? 'Network' : 'USB Serial'));
    setStatus(`Connecting to ${modeLabel} embosser…`);
    const res = await spoolToEmbosser(lastBrf, {
      connectionType: conn,
      embosser: s.embosser || 'generic',
      duplex: s.embosserDuplex || 'double',
      width: Number(s.cells) || 38,
      depth: Number(s.lines) || 25,
      baudRate: Number(s.baudRate) || 9600,
      networkHost: s.networkHost || '192.168.1.150',
      networkPort: Number(s.networkPort) || 9100,
      onStatus: (msg) => setStatus(msg, 'ok'),
    });
    if (res.success) {
      setStatus(res.message, 'ok');
    } else if (res.method === 'cancelled') {
      setStatus('Embosser selection cancelled.');
    } else if (res.message) {
      setStatus(res.message);
    }
  } catch (err) {
    console.warn('Direct embosser error:', err);
    setStatus(`Embosser error: ${err.message}`);
  }
}

if (el.embossBtn) el.embossBtn.addEventListener('click', handleEmbossPrint);
if (el.dzEmbossBtn) el.dzEmbossBtn.addEventListener('click', handleEmbossPrint);
if (el.spoolBtn) el.spoolBtn.addEventListener('click', handleEmbossPrint);

// The eBraille Braille Codes Registry names UEB by grade; every other code
// this app can translate with has no registered name yet, so its own id is
// written - the spec says values SHOULD come from the registry, not MUST.
function registryName(s) {
  const code = String(s.brailleCode || `${s.language || 'en'}_${s.grade || ''}`);
  if (/ueb/i.test(code) && /g1|grade ?1|uncontracted/i.test(code)) return 'ueb grade1';
  if (/ueb/i.test(code)) return 'ueb grade2';
  return code;
}

// ---- unified download BRF / PEF / eBraille popup menu ----
const downloadMenu = $('downloadMenu');
const downloadBtn = $('downloadBtn');

function closeDownloadMenu() {
  if (downloadMenu && !downloadMenu.hidden) {
    downloadMenu.hidden = true;
    downloadBtn?.setAttribute('aria-expanded', 'false');
  }
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!downloadMenu) return;
    const willShow = downloadMenu.hidden;
    downloadMenu.hidden = !willShow;
    downloadBtn.setAttribute('aria-expanded', String(willShow));
    if (willShow) {
      downloadMenu.querySelector('.menu-dropdown-item')?.focus({ preventScroll: true });
    }
  });
}

function triggerQuickDownload(format = 'brf') {
  closeDownloadMenu();
  if (lastBrf == null) return;
  const s = loadSettings();
  const opts = {
    ...(lastOpts || {}),
    mode: s.mode, width: Number(s.cells) || 38, depth: Number(s.lines) || 25,
    volumePages: Number(s.volumePages) || 0, includeCovers: !!s.includeCovers,
    duplex: s.embosserDuplex,
  };
  let content = lastBrf;
  let mimeType = 'application/octet-stream';
  let ext = '.brf';

  if (format === 'pef') {
    content = exportToPef(currentDoc || { title: currentName, blocks: [] }, opts);
    mimeType = 'application/x-pef+xml';
    ext = '.pef';
  } else if (format === 'ebrl' || format === 'ebrf') {
    content = exportToEbraille(currentDoc || { title: currentName, blocks: [] }, {
      ...opts, brailleSystem: registryName(s), language: (navigator.language || 'en'),
    });
    mimeType = 'application/epub+zip';
    ext = '.ebrl';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = currentName + ext;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${currentName}${ext} document.`, 'ok');
}

$('downloadBrfItem')?.addEventListener('click', () => triggerQuickDownload('brf'));
$('downloadPefItem')?.addEventListener('click', () => triggerQuickDownload('pef'));
$('downloadEbrlItem')?.addEventListener('click', () => triggerQuickDownload('ebrl'));

document.addEventListener('click', (e) => {
  if (!e.target.closest('#downloadMenuWrap')) {
    closeDownloadMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDownloadMenu();
  }
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
  setStatus(msg, 'ok');
}

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '\\' || e.code === 'Backslash' || e.key === '|')) {
    e.preventDefault();
    toggleHardwareExpertMode();
  }
});
