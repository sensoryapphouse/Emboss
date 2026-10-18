// Shared Emboss settings, persisted to localStorage so the drag-and-drop converter
// ("Simple mode") and the live editor stay in sync and honour the same standard,
// grade, page geometry, quote style and list style.
const KEY = 'emboss-settings';
export const DEFAULTS = {
  simpleMode: true,            // checked on install → the drag-and-drop converter
  mode: 'ukaaf',               // 'ukaaf' | 'bana'
  grade: 'g2',                 // 'g2' | 'g1'
  cells: 38,                   // page width
  // UK-7 (28 Sep, James / decisions.md "UKAAF"): UKAAF's own default page is 38 cells x 27 lines,
  // not the US 40x25 size (James: "40x25 is a US size"). Default `mode` above is already 'ukaaf',
  // so this is the true new-install default; MODE_GEOMETRY.ukaaf below matches it for the
  // Quick-Mode standard dropdown's own reactive apply-on-change (app.mjs).
  lines: 27,                   // page depth
  quoteStyle: 'faithful',      // 'faithful' | 'exchange'
  // UK-5 (28 Sep, James / decisions.md "UKAAF"): UKAAF bulleted lists are usually 5-1, sub-items
  // 7-1 (the 'compact' house style) — this is now the default; 'spaced' (1-3, blank lines) stays
  // available as an option. BANA ignores this field entirely (isCompactList/nestedMargins,
  // format/document.mjs, ignore listStyle outside UKAAF mode), so the change is UKAAF-only.
  listStyle: 'compact',        // 'spaced' | 'compact'
  toc: false,                  // editor: table of contents
  sixKeyOn: false,             // editor: the toolbar's six-key button was left ON (F9-Q1b, Paul 9 Oct 2026); a new user starts with it off. Not the old sixKeyInput
  sixKeyInput: true,           // editor: allow direct braille entry with S D F / J K L (turn off for a braille-display user typing their own braille)
  brailleCellW: 18,            // editor: braille dot-cell size (legibility control)
  statusScale: 1,              // editor: status-bar text scale (drag handle), 0.6–2.5
  asciiBraille: false,         // display braille as ASCII braille (for braille displays)
  volumePages: 0,              // 0 = single volume; else max braille pages per volume
  ttsRate: 1,                  // read-aloud speed (0.5–2)
  connectionType: 'serial',    // 'serial' (WebSerial USB) | 'hid' (Universal WebHID) | 'ble' (Web Bluetooth) | 'network' (REST / WebSockets / IP)
  networkHost: '192.168.1.150',// IP address or hostname for network embossing
  networkPort: 9100,           // Network TCP port (standard JetDirect port 9100)
  embosser: 'generic',         // 'generic' | 'aph' | 'viewplus' | 'braillo' | 'index' | 'romeo' | 'custom'
  embosserDuplex: 'double',    // 'double' (interpoint) | 'single' (simplex)
  interline: false,            // interline view (print text line directly above braille line)
  language: 'ueb',             // 'ueb' | 'spanish' | 'french' | 'german' | 'italian' | 'welsh' | 'gaelic'
  mathCode: 'auto',            // 'auto' (follow the layout standard: UKAAF→UEB maths, BANA→Nemeth) | 'ueb' | 'nemeth'
  brailleCode: 'en-ueb-g2',    // active liblouis braille code ID
  recentCodes: ['en-ueb-g2'],   // up to 5 recently used braille codes (pinned at top)
  tableFormat: 'auto',         // 'auto' | 'listed' | 'columnar' | 'vertical' | 'facing' | 'interchange' | 'stairstep' | 'linear'
  codeIndicators: true,        // UEB computer code indicators
  paragraphStyle: 'indented',  // 'indented' (3-1 standard) | 'block' (1-1 with blank lines)
  baudRate: 9600,              // WebSerial embosser baud rate (9600, 19200, 38400, 115200)
  tactileGraphics: true,       // true: rasterize tactile graphics (Tiger/Index); false: text notes only
  // Off by default (23 Sep 2026, Paul). format/spooler.mjs's rasterizeSvgToTiger/
  // rasterizeSvgToIndex are implemented and unit-tested, but no embosser output path in
  // Emboss calls them yet — spoolToEmbosser/prepareEmbosserStream only ever send plain
  // BRF text (see format/spooler.mjs), and no other export path sends a raster stream
  // either. This setting is a documented placeholder for that still-unbuilt wiring, so a
  // transcriber who turns it on gets an honest "not yet connected, untested on real
  // hardware" message rather than a silent no-op. Turning it on today changes nothing.
  tactileRip: false,
  includeCovers: false,        // generate tactile volume covers when splitting volumes
  includeSpineLabels: false,   // generate braille spine labels
  uiLanguage: 'en',            // active UI localization language code ('en', 'es', 'fr', 'de', etc.)
  // The Ctrl/Cmd+Shift+\ "expert" toggle in the editor (G1, 16 Sep decision): when on, the
  // Emboss button, Insert > Graphic, the Embosser & Hardware settings tab and the Tactile
  // Graphic / Plot Tactile Graph slash commands are shown. Remembered across reloads.
  expertHardware: false,
  // "Transcriber tools" (Paul's decision, 24 Sep 2026; docs/transcriber-tools-setting.md): when on, the editor also
  // offers the controls for formal braille books (Transcriber's Notes / Special Symbols pages, the Braille formatting
  // options tagged 'transcriber' in format/field-registry.mjs, the document options). Off by default. It hides and
  // shows tools only; it never changes the braille. Remembered across reloads.
  transcriberTools: false,
  // The editor's Title field above the text (Paul, 7 Oct 2026): null = follow Transcriber tools (hidden for everyone else), true / false
  // once it is ticked or unticked in Settings > User Interface. It shows or hides the field only; the title is still brailled.
  showTitleField: null,
  // The editor's explanation bar under the text and braille (Paul, 17 Oct 2026): on by default; off hides it, with its drag handle. Speech is unaffected.
  showExplanationBar: true,
};
// UK-7: UKAAF's own default is 38x27 (James — "40x25 is a US size"). BANA 38x25 (Paul, 28 Sep, PAGE-BANA-1): BANA 1.7.1
// sets a MAXIMUM of 40 cells, and KD normally produces 38x25; switching a document to BANA no longer widens it to 40.
export const MODE_GEOMETRY = { ukaaf: { cells: 38, lines: 27 }, bana: { cells: 38, lines: 25 } };
// UK-7 (28 Sep, James / decisions.md "UKAAF"): the UK page sizes James gave — 12-inch paper
// (38x27 or 40x27) and A4 (28x27 or 30x27) — offered as presets wherever Settings offers page
// sizes, alongside the embosser presets (EMBOSSER_PRESETS below). "Always let the user choose"
// (James) — none of these is forced; the plain Cells/Lines fields still take any value 10-60/10-45.
// Feedback 30 Sep, item 6 (Paul, 1 Oct): US braille paper too (11 x 11.5 in: 38x25, KD's usual size and BANA's default here,
// PAGE-BANA-1; 40x25, BANA 1.7.1's maximum line), and the current standard's sizes are listed first (presetsFor).
export const PAGE_SIZE_PRESETS = [
  { id: 'us-38x25', cells: 38, lines: 25, standard: 'bana', label: 'US braille paper 11 × 11½ in (38 × 25)' },
  { id: 'us-40x25', cells: 40, lines: 25, standard: 'bana', label: 'US braille paper 11 × 11½ in (40 × 25)' },
  { id: 'uk-38x27', cells: 38, lines: 27, standard: 'ukaaf', label: 'UK 12in paper (38 × 27)' },
  { id: 'uk-40x27', cells: 40, lines: 27, standard: 'ukaaf', label: 'UK 12in paper (40 × 27)' },
  { id: 'uk-28x27', cells: 28, lines: 27, standard: 'ukaaf', label: 'UK A4 (28 × 27)' },
  { id: 'uk-30x27', cells: 30, lines: 27, standard: 'ukaaf', label: 'UK A4 (30 × 27)' },
];
export const UK_PAGE_SIZE_PRESETS = PAGE_SIZE_PRESETS.filter((p) => p.standard === 'ukaaf');
// Every preset, the given standard's own first.
export const presetsFor = (mode) => [...PAGE_SIZE_PRESETS.filter((p) => p.standard === mode), ...PAGE_SIZE_PRESETS.filter((p) => p.standard !== mode)];
// The preset whose size is exactly this Cells x Lines ('' when none is: a custom size) — so the preset list shows what is in use.
export const presetIdFor = (cells, lines) => (PAGE_SIZE_PRESETS.find((p) => p.cells === Number(cells) && p.lines === Number(lines)) || { id: '' }).id;
// The i18n key of a preset's label (en.json settings.page_size_us_38x25 ...).
export const presetLabelKey = (id) => `settings.page_size_${String(id).replace(/-/g, '_')}`;

// Fill a "Page size preset" <select> (Quick Mode #pageSize, the editor's #set-pageSize): "Custom size", then every preset with the
// standard's own first, and select the one that matches Cells x Lines (or "Custom size") — so the list always shows what is in
// use. `tr(key)` is the page's i18n lookup; each option also carries data-i18n so a language change re-labels it.
export function fillPageSizeSelect(sel, mode, cells, lines, tr = null) {
  if (!sel) return;
  const doc = sel.ownerDocument;
  const label = (key, fallback) => { const v = tr ? tr(key) : null; return v && v !== key ? v : fallback; };
  const opt = (value, key, fallback) => { const o = doc.createElement('option'); o.value = value; o.setAttribute('data-i18n', key); o.textContent = label(key, fallback); return o; };
  sel.replaceChildren(opt('', 'settings.page_size_custom', 'Custom size'), ...presetsFor(mode).map((p) => opt(p.id, presetLabelKey(p.id), p.label)));
  sel.value = presetIdFor(cells, lines);
}

// Feedback 30 Sep, item 6 (Paul, 1 Oct): on the very first run the standard follows the browser and machine. The first of the
// browser's languages that names a region decides — the United States or Canada (BANA's countries, and their territories) gives
// BANA, any other region UKAAF; with no region anywhere, a time zone in the Americas gives BANA. Without a browser (Node), the
// built-in default (UKAAF).
const BANA_REGIONS = new Set(['US', 'CA', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM']);
export function machineStandard(nav = globalThis.navigator, timeZone) {
  const langs = nav ? [...(Array.isArray(nav.languages) ? nav.languages : []), nav.language].filter((l) => typeof l === 'string' && l) : [];
  for (const l of langs) {
    let region = null;
    try { region = new Intl.Locale(l).region || null; } catch { region = (/^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2}|\d{3})\b/i.exec(l) || [])[1] || null; }
    if (region) return BANA_REGIONS.has(region.toUpperCase()) ? 'bana' : 'ukaaf';
  }
  if (!nav) return DEFAULTS.mode;
  let tz = timeZone;
  if (tz === undefined) { try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { tz = ''; } }
  return /^America\//.test(tz || '') ? 'bana' : DEFAULTS.mode;
}
export const EMBOSSER_NAMES = {
  generic: 'Generic BRF / Standard Embosser',
  monarch: 'APH Monarch Dynamic Display (32x10)',
  dotpad: 'DotPad Dynamic Display (30x10 + 20 Braille)',
  custom: 'Simple One-Page Braille Printer (30x20)',
  aph: 'APH PageBlaster / PixBlaster',
  viewplus: 'ViewPlus (Columbia / Premier)',
  braillo: 'Braillo (300 / 600)',
  index: 'Index Braille (Basic-D / Everest)',
  romeo: 'Romeo 60 / Enabling Juliet 120',
};
export const EMBOSSER_PRESETS = {
  generic: { cells: 38, lines: 25, baudRate: 9600 },
  monarch: { cells: 32, lines: 10, baudRate: 115200 },
  dotpad: { cells: 20, lines: 10, brailleCells: 20, baudRate: 115200 },
  custom: { cells: 30, lines: 20, baudRate: 115200 },
  aph: { cells: 34, lines: 25, baudRate: 38400 },
  viewplus: { cells: 40, lines: 25, baudRate: 115200 },
  braillo: { cells: 42, lines: 25, baudRate: 9600 },
  index: { cells: 42, lines: 25, baudRate: 38400 },
  romeo: { cells: 40, lines: 25, baudRate: 9600 },
};
export function isGraphicsSupported(st = {}) {
  if (st.tactileGraphics === false) return false;
  const emb = st.embosser || 'generic';
  return ['viewplus', 'aph', 'index', 'monarch', 'dotpad', 'generic', 'custom'].includes(emb);
}
export const LANGUAGE_TABLES = {
  ueb: { name: 'English (UEB)', tableG2: '/tables/en-us-brf.dis,/tables/en-ueb-g2.ctb', tableG1: '/tables/en-us-brf.dis,/tables/en-ueb-g1.ctb' },
  spanish: { name: 'Spanish', tableG2: '/tables/en-us-brf.dis,/tables/es-g2.ctb', tableG1: '/tables/en-us-brf.dis,/tables/es-g2.ctb' },
  french: { name: 'French', tableG2: '/tables/en-us-brf.dis,/tables/fr-bfu-g2.ctb', tableG1: '/tables/en-us-brf.dis,/tables/fr-bfu-g2.ctb' },
  german: { name: 'German', tableG2: '/tables/en-us-brf.dis,/tables/de-g2.ctb', tableG1: '/tables/en-us-brf.dis,/tables/de-g1.ctb' },
  italian: { name: 'Italian', tableG2: '/tables/en-us-brf.dis,/tables/it-it-comp6.utb', tableG1: '/tables/en-us-brf.dis,/tables/it-it-comp6.utb' },
  welsh: { name: 'Welsh', tableG2: '/tables/en-us-brf.dis,/tables/cy-cy-g2.ctb', tableG1: '/tables/en-us-brf.dis,/tables/cy-cy-g2.ctb' },
  gaelic: { name: 'Gaelic', tableG2: '/tables/en-us-brf.dis,/tables/ga-g2.ctb', tableG1: '/tables/en-us-brf.dis,/tables/ga-g2.ctb' },
};

export const CONNECTION_TYPES = ['serial', 'hid', 'ble', 'network'];   // the embosser connection choices (format/spooler.mjs has the senders)
export function sanitizeSettings(s) {
  const raw = s || {};
  const clean = { ...DEFAULTS, ...raw };
  clean.embosser = ['generic', 'monarch', 'dotpad', 'aph', 'viewplus', 'braillo', 'index', 'romeo', 'custom'].includes(clean.embosser) ? clean.embosser : 'generic';
  const preset = EMBOSSER_PRESETS[clean.embosser];
  const defaultCells = preset ? preset.cells : DEFAULTS.cells;
  const defaultLines = preset ? preset.lines : DEFAULTS.lines;
  clean.cells = Math.max(10, Math.min(60, Math.round(Number(clean.cells)) || defaultCells));
  clean.lines = Math.max(10, Math.min(45, Math.round(Number(clean.lines)) || defaultLines));
  clean.volumePages = Math.max(0, Math.min(300, Math.round(Number(clean.volumePages)) || 0));
  clean.brailleCellW = Math.max(8, Math.min(36, Math.round(Number(clean.brailleCellW)) || DEFAULTS.brailleCellW));
  clean.ttsRate = Math.max(0.5, Math.min(2.0, Number(clean.ttsRate) || 1));
  clean.statusScale = Math.max(0.6, Math.min(2.5, Number(clean.statusScale) || 1));
  clean.mode = clean.mode === 'bana' ? 'bana' : 'ukaaf';
  // Feedback item 6 (Paul, 1 Oct): a setup with no page size of its own takes its standard's (MODE_GEOMETRY: BANA 38x25, UKAAF
  // 38x27) — the built-in defaults are UKAAF's, and a saved BANA setup without a size was laid out on the UK page. A saved size,
  // or a hardware preset's, always wins.
  if ((!raw.embosser || raw.embosser === 'generic') && MODE_GEOMETRY[clean.mode]) {
    if (!(Number(raw.cells) > 0)) clean.cells = MODE_GEOMETRY[clean.mode].cells;
    if (!(Number(raw.lines) > 0)) clean.lines = MODE_GEOMETRY[clean.mode].lines;
  }
  clean.grade = clean.grade === 'g1' ? 'g1' : 'g2';
  clean.mathCode = ['auto', 'ueb', 'nemeth'].includes(clean.mathCode) ? clean.mathCode : 'auto';
  clean.quoteStyle = clean.quoteStyle === 'exchange' ? 'exchange' : 'faithful';
  clean.listStyle = clean.listStyle === 'compact' ? 'compact' : 'spaced';
  clean.paragraphStyle = clean.paragraphStyle === 'block' ? 'block' : 'indented';
  // The editor's Table Layout setting also offers the BANA wide-table formats (T4; K15 facing pages; BANA 11.15 interchanged
  // columns and rows): keep them on reload.
  clean.tableFormat = ['auto', 'listed', 'columnar', 'vertical', 'facing', 'interchange', 'stairstep', 'linear'].includes(clean.tableFormat) ? clean.tableFormat : 'auto';
  clean.baudRate = [9600, 19200, 38400, 57600, 115200].includes(Number(clean.baudRate)) ? Number(clean.baudRate) : 9600;
  // S3c (audit 15 Oct #22, Paul): all four choices Settings offers are kept (they used to become 'serial' on save).
  clean.connectionType = CONNECTION_TYPES.includes(clean.connectionType) ? clean.connectionType : 'serial';
  clean.networkHost = String(clean.networkHost || '192.168.1.150').trim();
  clean.networkPort = Math.max(1, Math.min(65535, Number(clean.networkPort) || 9100));
  clean.brailleCode = String(clean.brailleCode || 'en-ueb-g2');
  clean.tactileGraphics = clean.tactileGraphics !== false;
  clean.tactileRip = clean.tactileRip === true;
  clean.expertHardware = clean.expertHardware === true;
  clean.transcriberTools = clean.transcriberTools === true;
  clean.sixKeyOn = clean.sixKeyOn === true;
  clean.showTitleField = clean.showTitleField === true ? true : clean.showTitleField === false ? false : null;
  clean.showExplanationBar = clean.showExplanationBar !== false;
  return clean;
}

// The maths code actually in force: an explicit choice wins, otherwise it follows the
// layout standard (BANA → Nemeth, UKAAF → UEB maths). Both modes and every maths
// call site ask this, so the preview, the rule-info panel and the download agree.
export function effectiveMathCode(s) {
  if (s && s.mathCode === 'nemeth') return 'nemeth';
  if (s && s.mathCode === 'ueb') return 'ueb';
  return s && s.mode === 'bana' ? 'nemeth' : 'ueb';
}

export function loadSettings() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored == null) {
      // The very first run (nothing saved yet): the standard follows the browser and machine (machineStandard), and is saved at
      // once so it never changes by itself afterwards (feedback item 6, Paul, 1 Oct).
      // Emboss Plus (Paul, 16 Oct 2026, P1): a first visit starts with Transcriber tools on; a saved choice is never overridden.
      const first = sanitizeSettings({ mode: machineStandard(), ...(isPlusBuild() ? { transcriberTools: true } : {}) });
      try { localStorage.setItem(KEY, JSON.stringify(first)); } catch { /* private mode etc. */ }
      return first;
    }
    return sanitizeSettings(JSON.parse(stored || '{}'));
  }
  catch { return sanitizeSettings(DEFAULTS); }
}
export function saveSettings(patch) {
  const next = sanitizeSettings({ ...loadSettings(), ...(patch || {}) });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode etc. */ }
  return next;
}

// Feedback 30 Sep item 12 (Paul, 1 Oct): a phone, judged by the device's screen (its shorter side under 500 points, in either
// orientation), not the window — a narrow window on a computer is not a phone, and a tablet keeps the editor.
export function isPhoneScreen() {
  try { return Math.min(window.screen.width, window.screen.height) < 500; } catch { return false; }
}
// Feedback 17 Oct 2026, item 12 (Paul): "Start in Quick Mode" decides only where Emboss OPENS. The editor's "Quick Mode" button (and the phone notice's)
// leave this mark in the tab's session just before going to Quick Mode, so Quick Mode — which sends a fresh arrival to the editor when that setting is
// off — knows it was CHOSEN: it stays, for this switch and for a reload or Back to it afterwards. A fresh arrival (a new tab, the address typed
// some time later) has no mark and follows the setting. Quick Mode's own switch to the editor takes the mark away.
export const STAY_QUICK_KEY = 'emboss-stay-quick';
export function markStayInQuick() { try { sessionStorage.setItem(STAY_QUICK_KEY, String(Date.now())); } catch { /* private mode */ } }
export function clearStayInQuick() { try { sessionStorage.removeItem(STAY_QUICK_KEY); } catch { /* private mode */ } }
export function stayInQuickMode(now = Date.now()) {
  try {
    const t = Number(sessionStorage.getItem(STAY_QUICK_KEY));
    if (!t) return false;
    let type = '';
    try { type = (performance.getEntriesByType('navigation')[0] || {}).type || ''; } catch { /* no navigation timing */ }
    return now - t < 30000 || type === 'reload' || type === 'back_forward';
  } catch { return false; }
}
// "Open the editor anyway" is remembered until the tab is closed.
export const PHONE_EDITOR_ANYWAY_KEY = 'emboss-editor-anyway';

// Feedback 30 Sep item 15 (Paul, 2 Oct): a beta build (./deploy-emboss.sh --beta marks both pages with
// <meta name="emboss-beta" content="1">; a test may set window.EMBOSS_BETA) shows only the everyday editor: Transcriber tools and
// the hardware controls stay off and their switches are hidden. A link with ?tools=1 unlocks them on that computer (remembered);
// ?tools=0 locks them again. Not a separate codebase: the same code, with these switches.
export function isBetaBuild() {
  try {
    if (window.EMBOSS_BETA === true) return true;
    const m = document.querySelector('meta[name="emboss-beta"]');
    return !!m && m.getAttribute('content') === '1';
  } catch { return false; }
}
// Emboss Plus (./deploy-emboss.sh --plus marks both pages with <meta name="emboss-plus" content="1">; a test may set
// window.EMBOSS_PLUS): the full build, where a first visit starts with Transcriber tools on (loadSettings above).
export function isPlusBuild() {
  try {
    if (window.EMBOSS_PLUS === true) return true;
    const m = document.querySelector('meta[name="emboss-plus"]');
    return !!m && m.getAttribute('content') === '1';
  } catch { return false; }
}
const BETA_UNLOCK_KEY = 'emboss-beta-unlock';
export function betaToolsUnlocked() {
  try {
    const q = new URLSearchParams(location.search).get('tools');
    if (q === '1') localStorage.setItem(BETA_UNLOCK_KEY, '1');
    else if (q === '0') localStorage.removeItem(BETA_UNLOCK_KEY);
    return localStorage.getItem(BETA_UNLOCK_KEY) === '1';
  } catch { return false; }
}
// True when this is a beta build and nobody has unlocked the full tools on this computer.
export function betaLocked() { return isBetaBuild() && !betaToolsUnlocked(); }

// A number field takes the nearest allowed value as soon as it is changed (A89, found by random-action testing): Cells -1 became
// -1 in Quick Mode's braille settings, and Settings — a form — then refused to close ("An invalid form control … is not
// focusable"). One listener for the Settings dialog (the root given), in the capture phase so every other change handler already
// sees the value. Not page-wide: a dialog that checks its own numbers and says why (Braille formatting's Columns) keeps doing so.
export function keepNumbersInRange(root = globalThis.document) {
  if (!root || root.__embossNumbersInRange) return;
  root.__embossNumbersInRange = true;
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'number' || el.value === '') return;
    const min = el.min !== '' ? Number(el.min) : -Infinity;
    const max = el.max !== '' ? Number(el.max) : Infinity;
    let v = Number(el.value);
    if (!Number.isFinite(v)) v = Number.isFinite(min) ? min : 0;
    v = Math.min(max, Math.max(min, v));
    if (String(v) !== el.value) el.value = String(v);
  }, true);
}

// A very large book is not opened silently (A89 / A90; Paul, 2 Oct: a precaution — a book big enough to run a browser tab out of
// memory must not just crash it). Measured: a 10 MB book brailles at ~1.2 GB, a 60 MB one needs ~5 GB, beyond a tab's usual limit;
// real NIMAS books are 1–5 MB of text. Above 20 MB for a text format, or 100 MB for a packaged one (Word, ODT, EPUB, a zipped
// NIMAS book — pictures make those big without adding braille), Emboss asks first. Returns null, or { mb } for the question.
export const LARGE_TEXT_FILE_BYTES = 20 * 1024 * 1024;
export const LARGE_PACKAGE_FILE_BYTES = 100 * 1024 * 1024;
const PACKAGED_EXTS = new Set(['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'ott', 'epub', 'zip', 'nimas']);
export function largeFileWarning(name, bytes) {
  if (!(bytes > 0)) return null;
  const ext = String(name || '').split('.').pop().toLowerCase();
  const limit = PACKAGED_EXTS.has(ext) ? LARGE_PACKAGE_FILE_BYTES : LARGE_TEXT_FILE_BYTES;
  return bytes > limit ? { mb: Math.round(bytes / (1024 * 1024)) } : null;
}
export const largeFileQuestion = (t, w) => {
  const v = t && t('messages.large_file', { size: w.mb });
  return v && v !== 'messages.large_file' ? v : `This book is very large (${w.mb} MB) and may be slow to open, or fail to open, in the browser. Open it anyway?`;
};
