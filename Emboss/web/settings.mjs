// Shared Emboss settings, persisted to localStorage so the drag-and-drop converter
// ("Simple mode") and the live editor stay in sync and honour the same standard,
// grade, page geometry, quote style and list style.
const KEY = 'emboss-settings';
export const DEFAULTS = {
  simpleMode: true,            // checked on install → the drag-and-drop converter
  mode: 'ukaaf',               // 'ukaaf' | 'bana'
  grade: 'g2',                 // 'g2' | 'g1'
  cells: 38,                   // page width
  lines: 25,                   // page depth
  quoteStyle: 'faithful',      // 'faithful' | 'exchange'
  listStyle: 'spaced',         // 'spaced' | 'compact'
  toc: false,                  // editor: table of contents
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
  tableFormat: 'auto',         // 'auto' | 'listed' | 'columnar'
  codeIndicators: true,        // UEB computer code indicators
  paragraphStyle: 'indented',  // 'indented' (3-1 standard) | 'block' (1-1 with blank lines)
  baudRate: 9600,              // WebSerial embosser baud rate (9600, 19200, 38400, 115200)
  tactileGraphics: true,       // true: rasterize tactile graphics (Tiger/Index); false: text notes only
  includeCovers: false,        // generate tactile volume covers when splitting volumes
  includeSpineLabels: false,   // generate braille spine labels
  uiLanguage: 'en',            // active UI localization language code ('en', 'es', 'fr', 'de', etc.)
};
export const MODE_GEOMETRY = { ukaaf: { cells: 38, lines: 25 }, bana: { cells: 40, lines: 25 } };
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

export function sanitizeSettings(s) {
  const clean = { ...DEFAULTS, ...(s || {}) };
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
  clean.grade = clean.grade === 'g1' ? 'g1' : 'g2';
  clean.mathCode = ['auto', 'ueb', 'nemeth'].includes(clean.mathCode) ? clean.mathCode : 'auto';
  clean.quoteStyle = clean.quoteStyle === 'exchange' ? 'exchange' : 'faithful';
  clean.listStyle = clean.listStyle === 'compact' ? 'compact' : 'spaced';
  clean.paragraphStyle = clean.paragraphStyle === 'block' ? 'block' : 'indented';
  clean.tableFormat = ['auto', 'listed', 'columnar'].includes(clean.tableFormat) ? clean.tableFormat : 'auto';
  clean.baudRate = [9600, 19200, 38400, 57600, 115200].includes(Number(clean.baudRate)) ? Number(clean.baudRate) : 9600;
  clean.connectionType = clean.connectionType === 'network' ? 'network' : 'serial';
  clean.networkHost = String(clean.networkHost || '192.168.1.150').trim();
  clean.networkPort = Math.max(1, Math.min(65535, Number(clean.networkPort) || 9100));
  clean.brailleCode = String(clean.brailleCode || 'en-ueb-g2');
  clean.tactileGraphics = clean.tactileGraphics !== false;
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
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return sanitizeSettings(DEFAULTS); }
}
export function saveSettings(patch) {
  const next = sanitizeSettings({ ...loadSettings(), ...(patch || {}) });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode etc. */ }
  return next;
}
