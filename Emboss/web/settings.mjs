// Shared Emboss settings, persisted to localStorage so the drag-and-drop converter
// ("Simple mode") and the live editor stay in sync and honour the same standard,
// grade, page geometry, quote style and list style.
import { cleanContractions, contractionsSet } from './reader-profiles.mjs';
const KEY = 'emboss-settings';
export const SETTINGS_KEY = KEY;
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
  // One Emboss (Paul, 4 Nov 2026: EMBOSS-TASKS section P). "Made for" (P-J) is a template setting: 'paper' | 'monarch' | 'dotpad'. Monarch and DotPad
  // set the page size (MADE_FOR_PAGE below: 32 x 10, 20 x 10) and their emulator tab always shows beside the braille, for everyone.
  madeFor: 'paper',
  // The paper embosser model (P-K: the names are kept - the model says which graphics a job can have, and at what level). A template setting,
  // shown to everyone under "Made for: Paper" (Paul, 4 Nov 2026: teachers need it too). It no longer sets the page size (the page size presets do); unused for printing while writing to devices is put aside.
  embosser: 'generic',         // 'generic' | 'aph' | 'viewplus' | 'braillo' | 'index' | 'romeo' | 'custom'
  embosserDuplex: 'double',    // 'double' (interpoint) | 'single' (simplex). A template setting (P-L: Settings > Template > Template settings > Interpoint / single-sided)
  interline: false,            // interline view (print text line directly above braille line)
  language: 'ueb',             // 'ueb' | 'spanish' | 'french' | 'german' | 'italian' | 'welsh' | 'gaelic'
  mathCode: 'auto',            // 'auto' (follow the layout standard: UKAAF→UEB maths, BANA→Nemeth) | 'ueb' | 'nemeth'
  brailleCode: 'en-ueb-g2',    // active liblouis braille code ID
  recentCodes: ['en-ueb-g2'],   // up to 5 recently used braille codes (pinned at top)
  tableFormat: 'auto',         // 'auto' | 'listed' | 'columnar' | 'vertical' | 'facing' | 'interchange' | 'stairstep' | 'linear'
  codeIndicators: true,        // UEB computer code indicators
  paragraphStyle: 'indented',  // 'indented' (3-1 standard) | 'block' (1-1 with blank lines) | 'indented-spaced' (UKAAF B004 s9 Ex2: blank line before each paragraph, cell 3)
  baudRate: 9600,              // WebSerial embosser baud rate (9600, 19200, 38400, 115200)
  tactileGraphics: true,       // true: rasterize tactile graphics (Tiger/Index); false: text notes only. Embosser output: its checkbox is hidden with the hardware controls (Paul, 4 Nov 2026, section P item 8)
  // (The "Tactile graphics RIP" setting was removed, Paul, 4 Nov 2026, P-F: it never did anything - no output path sent a raster stream.)
  includeCovers: false,        // generate tactile volume covers when splitting volumes
  includeSpineLabels: false,   // generate braille spine labels
  uiLanguage: 'en',            // active UI localization language code ('en', 'es', 'fr', 'de', etc.)
  // The Ctrl/Cmd+Shift+\ hardware toggle (G1, 16 Sep decision) shows the Emboss button and the Embosser & Hardware settings tab. One Emboss (Paul, 4 Nov
  // 2026, P-HW): writing to embossers and live displays is put aside - the code stays, unshown. The toggle works only where a test switches the hardware on
  // (hardwareEnabled below); for everyone else this setting is ignored. Insert > Graphic and the tactile graphic commands are Transcriber tools now (P-D).
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
  // Relaxed braille (A91; Paul, 2 Nov 2026: part of the template): the contractions the reader has learned, the "ticks" of the template in force.
  // null = All (every contraction: ordinary braille); else a list of catalogue keys (format/relaxed-signs.mjs), an empty list = none ticked. Only
  // used when relaxed braille is switched on (relaxedEnabled below) and the braille code is UEB contracted. A template carries it (web/templates.mjs).
  contractions: null,
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
// "Made for" (Paul, 4 Nov 2026, P-J): the device a template's braille is made for. Monarch and DotPad fix the page size (the same 32 x 10 and 20 x 10 the
// embosser presets above hold); Paper uses the page size presets. The emulator tab of a Monarch / DotPad template always shows beside the braille.
export const MADE_FOR = ['paper', 'monarch', 'dotpad'];
export const MADE_FOR_PAGE = { monarch: { cells: 32, lines: 10 }, dotpad: { cells: 20, lines: 10 } };
// The paper embosser models Settings offers under "Made for: Paper" (P-K). The Monarch and DotPad entries of EMBOSSER_NAMES are "Made for" choices now.
export const PAPER_EMBOSSERS = ['generic', 'aph', 'viewplus', 'braillo', 'index', 'romeo', 'custom'];
export function isGraphicsSupported(st = {}) {
  if (st.tactileGraphics === false) return false;
  if (st.madeFor === 'monarch' || st.madeFor === 'dotpad') return true;
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
  // Made for (P-J). An older setup that chose the Monarch or DotPad as its "embosser" is made for that device now (P-K: the paper models stay in `embosser`).
  clean.madeFor = MADE_FOR.includes(raw.madeFor) ? raw.madeFor : (raw.embosser === 'monarch' || raw.embosser === 'dotpad' ? raw.embosser : 'paper');
  clean.embosser = PAPER_EMBOSSERS.includes(clean.embosser) ? clean.embosser : 'generic';
  clean.embosserDuplex = clean.embosserDuplex === 'single' ? 'single' : 'double';
  // The model no longer sets the page size (P-K); a device fixes it (P-J): Monarch 32 x 10, DotPad 20 x 10, whatever Cells and Lines were given.
  const device = MADE_FOR_PAGE[clean.madeFor] || null;
  clean.cells = device ? device.cells : Math.max(10, Math.min(60, Math.round(Number(clean.cells)) || DEFAULTS.cells));
  clean.lines = device ? device.lines : Math.max(10, Math.min(45, Math.round(Number(clean.lines)) || DEFAULTS.lines));
  clean.volumePages = Math.max(0, Math.min(300, Math.round(Number(clean.volumePages)) || 0));
  clean.brailleCellW = Math.max(8, Math.min(36, Math.round(Number(clean.brailleCellW)) || DEFAULTS.brailleCellW));
  clean.ttsRate = Math.max(0.5, Math.min(2.0, Number(clean.ttsRate) || 1));
  clean.statusScale = Math.max(0.6, Math.min(2.5, Number(clean.statusScale) || 1));
  clean.mode = clean.mode === 'bana' ? 'bana' : 'ukaaf';
  // Feedback item 6 (Paul, 1 Oct): a setup with no page size of its own takes its standard's (MODE_GEOMETRY: BANA 38x25, UKAAF
  // 38x27) — the built-in defaults are UKAAF's, and a saved BANA setup without a size was laid out on the UK page. A saved size,
  // or a hardware preset's, always wins.
  if (!device && MODE_GEOMETRY[clean.mode]) {
    if (!(Number(raw.cells) > 0)) clean.cells = MODE_GEOMETRY[clean.mode].cells;
    if (!(Number(raw.lines) > 0)) clean.lines = MODE_GEOMETRY[clean.mode].lines;
  }
  clean.grade = clean.grade === 'g1' ? 'g1' : 'g2';
  clean.mathCode = ['auto', 'ueb', 'nemeth'].includes(clean.mathCode) ? clean.mathCode : 'auto';
  clean.quoteStyle = clean.quoteStyle === 'exchange' ? 'exchange' : 'faithful';
  clean.listStyle = clean.listStyle === 'compact' ? 'compact' : 'spaced';
  clean.paragraphStyle = ['block', 'indented-spaced'].includes(clean.paragraphStyle) ? clean.paragraphStyle : 'indented';   // 'indented-spaced': UKAAF B004 section 9 Example 2 (blank line before each paragraph; UKAAF only, ignored in BANA)
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
  delete clean.tactileRip;   // removed (Paul, 4 Nov 2026, P-F); an older saved setting just drops out
  clean.expertHardware = clean.expertHardware === true;
  clean.transcriberTools = clean.transcriberTools === true;
  clean.sixKeyOn = clean.sixKeyOn === true;
  clean.showTitleField = clean.showTitleField === true ? true : clean.showTitleField === false ? false : null;
  clean.showExplanationBar = clean.showExplanationBar !== false;
  clean.contractions = cleanContractions(clean.contractions);
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
    const link = toolsFromLink();   // ?tools=1 / ?tools=0 (see above): saved first, so everything that reads the settings sees it
    if (link !== null) {
      try {
        const was = localStorage.getItem(KEY);
        const base = was == null ? { mode: machineStandard() } : JSON.parse(was || '{}');
        localStorage.setItem(KEY, JSON.stringify(sanitizeSettings({ ...base, transcriberTools: link })));
      } catch { /* private mode etc. */ }
    }
    const stored = localStorage.getItem(KEY);
    if (stored == null) {
      // The very first run (nothing saved yet): the standard follows the browser and machine (machineStandard), and is saved at
      // once so it never changes by itself afterwards (feedback item 6, Paul, 1 Oct). Transcriber tools start off for everyone (Paul, 4 Nov 2026).
      const first = sanitizeSettings({ mode: machineStandard() });
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

// ONE EMBOSS (Paul, 4 Nov 2026: EMBOSS-TASKS section P). There is no beta lock and no Plus build any more: a page marked emboss-beta or emboss-plus (the deploy
// scripts still write the marker) behaves exactly like an unmarked one. Everyone starts in everyday braille mode (Transcriber tools off, no first-visit question)
// and turns Transcriber tools on in Settings > User Interface. The old isBetaBuild / isPlusBuild / betaLocked / betaToolsUnlocked are gone.
//
// A link with ?tools=1 (testers have them) turns Transcriber tools on, ?tools=0 turns them off; the choice is saved like any other, and a link is applied once
// per page load, before anything reads the settings.
let TOOLS_LINK_DONE = false;
function toolsFromLink() {
  if (TOOLS_LINK_DONE) return null;
  TOOLS_LINK_DONE = true;
  try {
    const q = new URLSearchParams(location.search).get('tools');
    return q === '1' ? true : q === '0' ? false : null;
  } catch { return null; }
}
// Writing to embossers and live tactile displays is put aside in this version (P-HW, P-M): the Emboss button, the Embosser & Hardware tab, the connection
// settings, the live Monarch / DotPad connection and Ctrl/Cmd+Shift+\ are not available. The code stays. A test (or a developer) can switch it back on with
// window.EMBOSS_HARDWARE = true before the page loads; nothing a user can do reaches it.
export function hardwareEnabled() {
  try { return window.EMBOSS_HARDWARE === true; } catch { return false; }
}

// Relaxed braille (A91, task 3; Paul 3 Oct 2026, decision L): UEB contracted braille that uses only the contractions a reader has
// learned, every other one spelled out. OFF unless switched on: a link with ?relaxed=1 turns it on for that computer (remembered in
// localStorage), ?relaxed=0 turns it off again; with it off, or with the All profile, the braille is byte-identical to today.
export const RELAXED_KEY = 'emboss-relaxed';
export function relaxedEnabled() {
  try {
    const q = new URLSearchParams(location.search).get('relaxed');
    if (q === '1') localStorage.setItem(RELAXED_KEY, '1');
    else if (q === '0') localStorage.removeItem(RELAXED_KEY);
    return localStorage.getItem(RELAXED_KEY) === '1';
  } catch { return false; }
}
// The ticks in force (Paul, 2 Nov 2026: relaxed braille is part of the template - one name): the setting `contractions`, which the template in
// force carries and Settings > Template > Contractions > Choose... changes. A Set of the catalogue keys (format/relaxed-signs.mjs) the reader
// holds, or null = All (and null whenever relaxed braille is off, whatever is stored). What makeTranslators(louis, table, { relaxed }) takes.
// Read afresh on every call, so a change made in another tab is used at the next render; it is cheap (the parsed Set is kept while the stored
// settings text is unchanged, so the same Set comes back and relaxedProfileKey below is worked out once).
let TICKS_MEMO = { raw: undefined, set: null };
export function activeRelaxedProfile() {
  if (!relaxedEnabled()) return null;
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { raw = null; }
  if (TICKS_MEMO.raw === raw && raw !== undefined) return TICKS_MEMO.set;
  let set = null;
  try { set = contractionsSet(raw == null ? null : JSON.parse(raw || '{}').contractions); } catch { set = null; }
  TICKS_MEMO = { raw, set };
  return set;
}
// A short text for anything that must tell braille made with different profiles apart (a cache key): '' when off or All.
const PROFILE_KEYS = new WeakMap();   // activeRelaxedProfile hands out the same Set while nothing changed, so the text is worked out once
export function relaxedProfileKey(p = activeRelaxedProfile()) {
  if (!p) return '';
  let k = PROFILE_KEYS.get(p);
  if (k === undefined) { k = `relaxed:${[...p].sort().join(',')}`; PROFILE_KEYS.set(p, k); }
  return k;
}

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
