// First, so it records any error from the moment the page starts (A89 step 2, Report a problem).
import { openProblemDialog } from '/web/problem-report.mjs';
import * as louis from '/engine/louis-browser.mjs';
import { formatDocument } from '/format/document.mjs';
import { parseFile, BINARY_EXTS } from '/input/parse.mjs';
import * as maths from '/engine/maths.mjs';
import { initMaths, isMathsReady } from '/engine/maths.mjs';
import { styledTranslate } from '/format/text-style.mjs';
import { loadSettings, saveSettings, effectiveMathCode, isPhoneScreen, betaLocked, keepNumbersInRange, largeFileWarning, largeFileQuestion, stayInQuickMode, clearStayInQuick } from '/web/settings.mjs';
import { mountSettingsDialog, bindSettingsDialog } from '/web/settings-panes.mjs';
import { renderBraille } from '/web/braille-render.mjs';
import { resolveTable, makeTranslators, UEB_TABLES, registryName, codeLanguage, settingsForTable } from '/web/braille-table.mjs';
import '/web/icons.mjs';   // adds the page's icon symbols (feedback 30 Sep, item 18)

import { spoolToEmbosser, chooseEmbosserTarget, sendToEmbosserTarget, isWebSerialSupported, initEmbosserAutoDetect } from '/format/spooler.mjs';
import { exportToPef } from '/format/pef.mjs';
import { exportToEbraille, ebrailleWarningText } from '/format/ebraille.mjs';
import { tactileDisplay } from '/format/tactile-display.mjs';
import { setHandoffDoc, readHandoff, confirmHandoff, newHandoffId, handoffHash, brailleKey, brailleFlags } from '/web/handoff-db.mjs';
import { initI18n, t, setLocale, getLocale, getOrderedLocales, translateDOM } from '/web/i18n.mjs';
import { getBuildInfo } from '/web/build-info.mjs';
import { makeZip } from '/web/zip.mjs';
import { watchOfflineReady } from '/web/offline-ready.mjs';

// "Start in Quick Mode" (Settings) decides only where Emboss OPENS: the site address goes to the editor when the user has turned it off.
// It is not "where am I now": a click on "Quick Mode" in the editor, or a reload of this page after it, stays here (stayInQuickMode, settings.mjs:
// the editor's switch leaves a mark for this tab), and switching between the pages no longer changes the setting (feedback 17 Oct 2026, item 12).
// (the address's #handoff=<id> goes with it: a document sent to this page belongs to its transfer id, not to a mode - S2a #4)
if (!isPhoneScreen() && !loadSettings().simpleMode && !stayInQuickMode()) location.replace('/web/editor/index.html' + location.hash);   // never on a phone: Quick Mode only (Paul, 18 Oct 2026)

// The Settings dialog is made from the one source the editor's uses too (web/settings-panes.mjs; item 9a), before anything looks for its controls.
mountSettingsDialog(document.getElementById('settingsDialog'), { page: 'quick' });
keepNumbersInRange(document.getElementById('settingsDialog'));   // Settings only: dialogs that check their own numbers say why (Braille formatting)

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $('dropzone'), fileInput: $('fileInput'), chooseBtn: $('chooseBtn'),
  fileName: $('fileName'), status: $('status'),
  result: $('result'), preview: $('preview'), resultMeta: $('resultMeta'),
  downloadBtn: $('downloadBtn'), engineVer: $('engineVer'), buildInfo: $('buildInfo'),
  settingsBtn: $('settingsBtn'), helpBtn: $('helpBtn'),
  settingsDialog: $('settingsDialog'), helpDialog: $('helpDialog'), helpClose: $('helpClose'),
  settingsSummary: $('settingsSummary'), advancedBtn: $('advancedBtn'),
};

let currentDoc = null;      // parsed document model
let currentName = 'document';
let unsavedFromEditor = false;   // the document came back from the editor with edits not yet saved to a file
let lastBrf = null;
Object.defineProperty(window, 'lastBrf', { get: () => lastBrf, configurable: true });   // tests read the braille shown, as they do in the editor
let lastFile = null;        // the file last chosen or dropped, even one that could not be read — Report a problem includes it
let lastOpts = null;        // format options the preview was built with (null while the braille shown came with the document from the editor: nothing was formatted here, see ensureOpts)
let lastWarnings = [];      // opts.warnings from the last transcribe() — Fable review #5
let engineReady = false;    // liblouis loaded — until then, defer transcription

// The Settings controls, wired by the one module the editor's Settings is made from (web/settings-panes.mjs; Paul, 17 Oct 2026, item 9a): it saves each
// change to settings.mjs and tells this page, which brailles again.
let settingsUi = null;
function onSettingsChange(info = {}) {
  if (info.code && info.code.table) louis.ensureTables(info.code.table).catch(console.error);
  updateSummary();
  if (info.locale) return;                          // the words changed, not the braille
  transcribe();
}
(async () => {
  try { await initI18n(loadSettings().uiLanguage || 'en'); } catch (_) {}
  watchOfflineReady({ text: (k, f) => { const v = t(k); return v && v !== k ? v : f; }, say: (m) => { offlineSay = m; sayOfflineWhenFree(); } });   // S4-Q2
  // Feedback item 6 (Paul, 1 Oct): the header and the preset list describe the settings just loaded (the header was worked out before they were).
  settingsUi = bindSettingsDialog(el.settingsDialog, { onChange: onSettingsChange });
  updateSummary();
})();

// kind 'loading' (F9 item I, Paul 9 Oct 2026): the engine-loading message gets a small spinner and words in the page's own font. The status
// line is a polite live region, so the words are spoken once: asking again while the same message still shows changes nothing.
// S4-Q2: "Emboss is ready to work offline" waits until the braille engine has loaded (it replaced the engine-loading message and its spinner,
// 18 Oct 2026), and then goes after the status shown ("Ready. Drop or choose a document to begin. Emboss is ready to work offline.").
let offlineSay = null;
function sayOfflineWhenFree() {
  if (!offlineSay || !engineReady) return;
  const m = offlineSay; offlineSay = null;
  const cur = (el.status.textContent || '').trim();
  setStatus(cur && !cur.includes(m) ? `${cur} ${m}` : m, 'ok');
}
function setStatus(msg, kind = '') {
  if (kind === 'loading') {
    if (el.status.querySelector('.engine-loading')) return;
    const wrap = document.createElement('span');
    wrap.className = 'engine-loading';
    const spin = document.createElement('span');
    spin.className = 'engine-spinner';
    spin.setAttribute('aria-hidden', 'true');
    const words = document.createElement('span');
    words.textContent = msg;
    wrap.append(spin, words);
    el.status.className = 'status';
    el.status.replaceChildren(wrap);
    return;
  }
  el.status.textContent = msg; el.status.className = 'status ' + kind;
}
const engineLoadingText = () => { const v = t('app.engine.loading'); return v && v !== 'app.engine.loading' ? v : 'Loading the braille engine…'; };

// ---- build identity (Help dialog) ----
getBuildInfo().then((info) => {
  if (el.buildInfo) el.buildInfo.textContent = info ? `${info.hash}, built ${info.date}` : 'development';
});

// ---- engine bootstrap ----
(async () => {
  try {
    setStatus(engineLoadingText(), 'loading');
    const ver = await louis.init({ tablesBaseUrl: '/liblouis/tables' });
    el.engineVer.textContent = ver;
    engineReady = true;
    if (currentDoc && lastBrf == null) transcribe();  // a file dropped before the engine was ready (braille that came with the document is already shown)
    else if (!currentDoc) setStatus('Ready. Drop or choose a document to begin.', 'ok');
    sayOfflineWhenFree();   // S4-Q2: held back while the engine loaded
    // Maths engine (MathCAT) loads in the background; non-fatal if it fails.
    // When it arrives, re-transcribe so any equations appear.
    initMaths().then(() => { if (currentDoc && lastOpts && documentHasMaths(currentDoc)) transcribe(); }).catch((e) => console.warn('maths engine unavailable:', e));   // not for a document without equations (item 13), nor for braille that came from the editor, made with the maths engine up
  } catch (e) {
    setStatus('Engine failed to load: ' + e.message, 'err');
    console.error(e);
  }
})();

// ---- a document sent back from the editor ----
// The editor's "Quick Mode" button hands its document over (the same IndexedDB handoff goEditor
// uses in the other direction), so it opens here with the edits instead of being lost. If those
// edits were never saved to a file, closing this page asks first, like the editor does.
(async () => {
  let doc = null, handoff = null;
  try { handoff = await readHandoff(); doc = handoff && handoff.doc; } catch (e) { console.warn('handoff retrieval error:', e); }
  if (!doc || !(doc.blocks || []).length) { await confirmHandoff(handoff); return; }
  unsavedFromEditor = !!doc._unsavedEdits;
  delete doc._unsavedEdits;
  // The braille the editor had already made comes with the document (feedback 17 Oct 2026, item 13): it is used, at once, with no formatting and no
  // wait for the engine, if its key is the key of this document under THIS page's settings and flags; otherwise the document is brailled here as before.
  // Decided before the document is put in place, so the engine's arrival cannot start brailling it in between.
  let carriedOk = false;
  const carried = handoff.braille;
  const s = loadSettings();
  if (carried && typeof carried.brf === 'string' && carried.brf && carried.key) {
    const key = await brailleKey(doc, brailleFlags(s, { titleInBraille: document.body.classList.contains('transcriber-tools'), toc: false, suppressHeader: false, mathsReady: true }));
    carriedOk = !!key && key === carried.key && !currentDoc && !selectionPending;
  }
  currentDoc = doc;
  const title = String(doc.title || '').trim();
  currentName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
  el.fileName.textContent = title || 'Document from the editor';
  window.__quickBrailleCarried = carriedOk;          // tests
  if (carriedOk) showBraille(carried.brf, carried.warnings, null, s);
  else if (engineReady) transcribe();                // otherwise the engine bootstrap transcribes it when ready
  await confirmHandoff(handoff);                     // loaded: the stored copy of this transfer can go (S2a #4)
})();
window.addEventListener('beforeunload', (e) => {
  if (unsavedFromEditor && currentDoc) { e.preventDefault(); e.returnValue = ''; }
});

// ---- file intake ----
// S2a #1 (audit 15 Oct 2026): a file chosen while an earlier one is still being read must not be replaced by it. Every selection
// takes a number; only the LATEST selection's result or error is applied; the name shown, the document, the braille and the
// download name are committed together when its read succeeds; and while it is being read the previous result is withdrawn
// (hidden, and refused by Download / Emboss / Read aloud / Advanced editor). A hard failure of the latest file ("userFacing":
// password-protected, damaged, not a Word file ...) still leaves the previous document and result as they were.
let loadGen = 0;                  // number of the latest file selection
let selectionPending = false;     // the latest selection is still being read
let beforeSelection = null;       // what the page showed before the pending selection(s) began, to put back on a hard failure
const STILL_READING = 'Still reading the file you chose. Try again in a moment.';
// S2B-Q1 (Paul 15 Oct): the import's own warnings (model.warnings) in a short notice, worded as the editor's ("Notice: ..."), in a polite
// live region, cleared with the next file. importNoticeText() is what is shown now (put back if the next file cannot be read at all).
function importNoticeText() { const n = $('importNotice'); return n && !n.hidden ? ($('importNoticeText').dataset.raw || '') : ''; }
function showImportNotice(warnings, raw = false) {
  const box = $('importNotice'), txt = $('importNoticeText');
  if (!box || !txt) return;
  const joined = raw ? String((warnings || [])[0] || '') : (Array.isArray(warnings) ? warnings.filter(Boolean).join('; ') : '');
  if (!joined) { box.hidden = true; txt.textContent = ''; delete txt.dataset.raw; return; }
  txt.dataset.raw = joined;
  txt.textContent = t('app.import.notice', { message: joined });
  box.hidden = false;
}
$('importNoticeDismiss')?.addEventListener('click', () => showImportNotice([]));
async function acceptFile(file) {
  if (unsavedFromEditor && currentDoc && !window.confirm('The document you edited has changes that have not been saved to a file. Open the new file anyway?')) return;
  const big = largeFileWarning(file.name, file.size);   // a very large book asks first (A89 / A90)
  if (big && !window.confirm(largeFileQuestion(t, big))) return;
  const gen = ++loadGen;
  lastFile = file;
  if (!selectionPending) beforeSelection = { name: el.fileName.textContent, resultHidden: el.result.hidden, notice: importNoticeText() };
  selectionPending = true;
  showImportNotice([]);                                            // S2B-Q1: the last file's notice goes with it
  el.result.hidden = true;                                         // the old result is not offered while the new file loads
  el.downloadBtn.disabled = true;                                  // nothing to export until the new braille is made
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    setStatus('Reading “' + file.name + '”…');
    const payload = BINARY_EXTS.has(ext) ? await file.arrayBuffer() : await file.text();
    const doc = await parseFile(file.name, payload);
    if (gen !== loadGen) return;                                   // a newer file was chosen meanwhile: this one is dropped
    currentDoc = doc;
    currentName = file.name.replace(/\.[^.]+$/, '') || 'document';   // set the download name only after a good parse
    el.fileName.textContent = file.name;
    unsavedFromEditor = false;
    selectionPending = false;
    lastBrf = null;                                                // the old document's braille is not downloadable while this one is brailled
    transcribe();                                     // transcribe immediately — no separate Convert step
    showImportNotice(doc && doc.warnings);            // S2B-Q1: what the import left out (missing EPUB chapters, damaged parts) - the editor shows the same
  } catch (e) {
    if (gen !== loadGen) return;                                   // an older selection failing is not news: the newer one stands
    selectionPending = false;
    if (e && e.userFacing) {
      // A hard failure — the file could not be read at all (password-protected, damaged,
      // Word 6/95, not a Word file: see parseDocxSniffed/doc.mjs's userError). Leave any
      // previously loaded document and result untouched, and show the reader's own plain
      // message rather than wrapping it — el.status is a role="status" live region, so this
      // is announced to screen readers the same way every other status update is.
      const b = beforeSelection;
      if (b) { el.fileName.textContent = b.name; el.result.hidden = b.resultHidden; el.downloadBtn.disabled = b.resultHidden || lastBrf == null; if (b.notice) showImportNotice([b.notice], true); }
      setStatus(e.message, 'err');
    } else {
      el.fileName.textContent = file.name;
      currentDoc = null; lastBrf = null; lastOpts = null; el.result.hidden = true; el.downloadBtn.disabled = true;
      setStatus('Could not read that file: ' + e.message, 'err');
    }
    console.error(e);
  }
}

el.chooseBtn.addEventListener('click', () => el.fileInput.click());
// No Load button in Quick Mode's header (Paul, 18 Oct 2026): a document comes in by dragging it on, or the drop zone's Choose file.
el.dropzone.addEventListener('click', (e) => { if (e.target === el.dropzone || e.target.closest('.dz-inner') && e.target.tagName !== 'BUTTON') el.fileInput.click(); });
el.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); } });
el.fileInput.addEventListener('change', () => { if (el.fileInput.files[0]) acceptFile(el.fileInput.files[0]); });

['dragenter', 'dragover'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove('drag'); }));
el.dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) acceptFile(f); });

// ---- settings summary (the line under the name) ----
function updateSummary() {
  const s = loadSettings();
  el.settingsSummary.textContent = `${s.mode.toUpperCase()} · Grade ${s.grade === 'g1' ? 1 : 2} · ${s.cells}×${s.lines}`;
}
updateSummary();

// Automatic hardware embosser USB hotplug detection
initEmbosserAutoDetect((profile) => {
  saveSettings(profile.presets);
  settingsUi?.apply();                              // the Settings controls show what was detected
  updateSummary();
  transcribe();
  setStatus(`Detected ${profile.name} — configured to ${profile.presets.cells}×${profile.presets.lines} at ${profile.presets.baudRate || 9600} baud.`, 'ok');
}, () => {
  setStatus('Embosser disconnected.');
});

// Switch to the live editor, carrying the uploaded document across so it opens there
// (the editor loads this stashed model instead of its demo). No re-parsing.
async function goEditor() {
  if (selectionPending) { setStatus(STILL_READING); return; }   // the document shown is about to be replaced (S2a #1)
  // S2a #4: this transfer has an id of its own, carried to the editor in the address, so another tab's transfer cannot take it
  const id = newHandoffId();
  if (currentDoc) {
    await setHandoffDoc({ ...currentDoc, _unsavedEdits: unsavedFromEditor }, id);   // the editor keeps it marked unsaved
  }
  unsavedFromEditor = false;   // it travels with the handoff, so the close guard below need not ask
  // Switching pages does not touch "Start in Quick Mode" (feedback 17 Oct 2026, item 12): that setting is where Emboss opens, not where this tab is.
  clearStayInQuick();
  location.href = '/web/editor/index.html' + (currentDoc ? handoffHash(id) : '');
}

// On a phone there is no editor (Paul, 18 Oct 2026: Quick Mode only): the button is hidden (html.is-phone) and does nothing there.
if (el.advancedBtn) el.advancedBtn.addEventListener('click', () => { if (!isPhoneScreen()) goEditor(); });
el.settingsBtn.addEventListener('click', () => el.settingsDialog.showModal());
el.helpBtn.addEventListener('click', () => el.helpDialog.showModal());
el.helpClose.addEventListener('click', () => el.helpDialog.close());
// Report a problem (A89 step 2): one file for the tester to email — the file they loaded, its braille, the settings, the errors.
document.getElementById('reportProblemBtn')?.addEventListener('click', () => {
  el.helpDialog.close();
  openProblemDialog({
    page: 'quick', t, settings: () => loadSettings(), buildInfo: getBuildInfo, makeZip,
    collect: async (includeDocument) => {
      const extra = { fileName: lastFile?.name || null, fileSize: lastFile?.size ?? null, status: el.status.textContent, converted: lastBrf != null, warnings: lastWarnings.length };
      if (!includeDocument) return { documentFiles: [], extra };
      const files = [];
      if (lastFile) files.push({ name: `original/${lastFile.name}`, data: new Uint8Array(await lastFile.arrayBuffer()) });
      if (lastBrf != null) files.push({ name: 'braille.brf', text: lastBrf });
      return { documentFiles: files, extra };
    },
    onSaved: (name, msg) => setStatus(msg, 'ok'),
  });
});
// close dialogs on backdrop click
for (const d of [el.settingsDialog, el.helpDialog]) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

// ---- transcribe ----
// Runs automatically as soon as a document is loaded, and again whenever a setting
// changes — no "Convert" step. Export stays the one deliberate action.
// The formatting options of the braille made from the saved settings (what the PEF / eBraille exports re-format with too). Needs the engine.
async function buildOpts(s = loadSettings()) {
  const table = resolveTable(s);
  // The code's own table list, fetched on demand (most of the 142 codes are not in the engine's filesystem until first use). The translators
  // normalise to BRF ASCII — the codes are listed with unicode.dis, and a .brf must never carry Unicode.
  await louis.ensureTables(table);
  const tr = makeTranslators(louis, table);
  const translateG1 = /en-ueb/.test(table) ? (t, tf) => makeTranslators(louis, UEB_TABLES.g1).translate(t, tf) : undefined;
  // tf: bold/italic/underline typeform; in contracted UEB a sub/superscript run longer than one item puts its word in grade 1 (text-style.mjs)
  const translate = styledTranslate((t, tf) => tr.translate(t, tf), s.quoteStyle || 'faithful', /en-ueb-g2/.test(table) ? translateG1 : null);
  return {
    mode: s.mode || 'ukaaf',
    width: Math.max(10, Number(s.cells) || 38),
    depth: Math.max(10, Number(s.lines) || 25),
    paragraphStyle: s.paragraphStyle || 'indented',
    listStyle: s.listStyle || 'compact',   // UK-5: UKAAF default is now 'compact'
    tableFormat: s.tableFormat || 'auto',
    interpoint: (s.embosserDuplex || 'double') !== 'single',   // K15: facing-pages tables start on an even page in interpoint
    translate, translateG1,
    titleInBraille: document.body.classList.contains('transcriber-tools'),   // F9 E2a (Paul, 9 Oct 2026): Quick Mode has no Title field; no title is added to the braille unless Transcriber tools is on
    mathToBrf: isMathsReady() ? (seg) => maths.mathToBrf(seg, effectiveMathCode(s)) : null,
    // What the eBraille export declares (S3b #17, #18): the braille system and language of the table this braille was made with, and the maths code.
    brailleSystem: registryName(settingsForTable(table)), brailleCode: settingsForTable(table).brailleCode, codeLanguage: codeLanguage(settingsForTable(table)), mathCode: effectiveMathCode(s),
  };
}
// The options the exports need, made on demand when the braille shown came with the document from the editor (no formatting was done here).
async function ensureOpts() {
  if (lastOpts) return lastOpts;
  const t0 = Date.now();
  while (!engineReady && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50));
  if (!engineReady) throw new Error('the braille engine did not load');
  lastOpts = await buildOpts();
  return lastOpts;
}
// Show braille that has been made (here, or by the editor): the preview drawn by the editor's own renderer (web/braille-render.mjs: dot cells,
// "page N" markers, the same size and spacing as the editor's braille pane), the meta line, the warnings badge and the Export menu.
function showBraille(brf, warnings, opts, s = loadSettings()) {
  lastBrf = brf;
  lastOpts = opts;                                   // the PEF/eBraille exports re-format with exactly these (null: made on demand, ensureOpts)
  lastWarnings = Array.isArray(warnings) ? warnings : [];   // Fable review #5: transcription-warnings channel
  updateQuickWarningsUI();
  el.result.hidden = false;                          // before drawing: the renderer sizes the cells to the box's width
  renderBraille(el.preview, brf, {
    cells: Number(s.cells) || 38, textMode: false, asciiBraille: !!s.asciiBraille, volumePages: Number(s.volumePages) || 0,
    embosser: s.embosser, tactileGraphics: s.tactileGraphics, hardwarePreview: false,
  });
  const pages = brf.split('\x0c').length;
  const gradeStr = String(s.brailleCode || 'en-ueb-g2').includes('g1') ? 'Grade 1' : 'Grade 2';
  el.resultMeta.textContent = `${Number(s.cells) || 38}×${Number(s.lines) || 25} · ${String(s.mode || 'ukaaf').toUpperCase()} · ${gradeStr} · ${pages} page${pages === 1 ? '' : 's'}`;
  el.downloadBtn.disabled = false;                   // there is braille to export
  if (s.embosser === 'monarch' && tactileDisplay.isConnected()) tactileDisplay.updateBraille(brf);
  setStatus('Braille ready below — change any setting to update it, then Export the .brf.', 'ok');
}
async function transcribe() {
  if (!currentDoc || selectionPending) return;   // a file is being read: its own commit transcribes (S2a #1)
  if (!engineReady) { setStatus(engineLoadingText(), 'loading'); return; }   // will re-run once init resolves
  try {
    setStatus('Transcribing…');
    const s = loadSettings();
    const opts = await buildOpts(s);
    const brf = formatDocument(currentDoc, opts);
    showBraille(brf, opts.warnings, opts, s);
  } catch (e) {
    // Never leave a stale, downloadable BRF that contradicts the current settings/preview.
    lastBrf = null; lastOpts = null; el.result.hidden = true; el.downloadBtn.disabled = true;
    setStatus('Transcription failed: ' + e.message, 'err');
    console.error(e);
  }
}
// Test hook (tests/test-mode-switch.mjs): the braille this page would make for the document now, formatted here with the saved settings.
window.__quickFreshBrf = async () => formatDocument(currentDoc, await buildOpts());
// Does the document have any maths? Only then does the maths engine's arrival need the braille to be made again.
const documentHasMaths = (doc) => { try { return /"type":"(?:math|equation)"|"(?:mathml|latex)":/.test(JSON.stringify(doc, (k, v) => (k === 'resources' ? undefined : v))); } catch { return true; } };

// ---- unified emboss / print & direct spool ----
async function handleEmbossPrint() {
  if (selectionPending) { setStatus(STILL_READING); return; }
  if (!lastBrf) return;
  const s = loadSettings();
  const conn = s.connectionType || 'serial';
  try {
    const modeLabel = conn === 'ble' ? 'Bluetooth' : (conn === 'hid' ? 'USB HID' : (conn === 'network' ? 'Network' : 'USB Serial'));
    setStatus(`Connecting to ${modeLabel} embosser…`);
    const opts = {
      connectionType: conn,
      embosser: s.embosser || 'generic',
      duplex: s.embosserDuplex || 'double',
      width: Number(s.cells) || 38,
      depth: Number(s.lines) || 25,
      baudRate: Number(s.baudRate) || 9600,
      networkHost: s.networkHost || '192.168.1.150',
      networkPort: Number(s.networkPort) || 9100,
      onStatus: (msg) => setStatus(msg, 'ok'),
    };
    // S3c (audit 15 Oct #22): serial, HID and Bluetooth go through the same choose-then-send path as the editor's Emboss button
    // (the browser's device chooser first, inside this click), with a plain message when the browser cannot do it.
    let res;
    if (conn === 'network') {
      res = await spoolToEmbosser(lastBrf, opts);
    } else {
      const choice = await chooseEmbosserTarget(conn, opts);
      if (!choice.ok) { setStatus(choice.method === 'cancelled' ? `${choice.message} Nothing was sent.` : choice.message); return; }
      res = await sendToEmbosserTarget(lastBrf, choice, opts);
    }
    if (res.success) {
      setStatus(res.message, 'ok');
    } else if (res.method === 'cancelled') {
      setStatus('Embosser selection cancelled. Nothing was sent.');
    } else if (res.message) {
      setStatus(res.message);
    }
  } catch (err) {
    console.warn('Direct embosser error:', err);
    setStatus(`Embosser error: ${err.message}`);
  }
}

// "Send to embosser" is an item of the Export menu now (it was a button beside Read and Download, and another in the drop zone); it is shown only
// once the hardware controls are revealed (Ctrl/Cmd+Shift+\), and never in a beta build that has not been unlocked.
$('downloadEmbossItem')?.addEventListener('click', () => { closeDownloadMenu(true); handleEmbossPrint(); });

// registryName (the eBraille Braille Codes Registry value of a braille code) now lives in web/braille-table.mjs, shared with the editor (S3b #17).

// ---- unified download BRF / PEF / eBraille popup menu ----
// THE SAME OPEN, CLOSE AND KEYBOARD BEHAVIOUR AS TRANSLATE'S EXPORT MENU (feedback 10 Oct, item 6; Paul: "I am happy with Translate's").
// The button opens and closes it; opening puts the focus on the first item; Down and Up move between the items and wrap; Escape closes it
// and puts the focus back on the button; Tab closes it and carries on along the page; a click anywhere else closes it and leaves the
// focus where the click put it; choosing an item closes it and puts the focus back on the button. Before, an item that had been chosen,
// or Escape, hid the menu with the focus still on an item that had just disappeared, so a keyboard user landed on nothing, and the arrow
// keys did nothing in it. Translate also speaks each step through its own voice; Emboss has none, and a screen reader announces
// aria-expanded and the focus move for itself.
const downloadMenu = $('downloadMenu');
const downloadBtn = $('downloadBtn');
// The items on offer. The PEF item is hidden (Paul, 25 Sep), and focus() on a hidden item does nothing, so the arrow keys must skip it.
const downloadItems = () => [...(downloadMenu ? downloadMenu.querySelectorAll('[role=menuitem]') : [])].filter((b) => !b.hidden && b.getClientRects().length > 0);   // not the PEF item (hidden) nor Send to embosser until the hardware controls are revealed

function closeDownloadMenu(focusButton) {
  if (!downloadMenu || downloadMenu.hidden) return;
  downloadMenu.hidden = true;
  downloadBtn?.setAttribute('aria-expanded', 'false');
  if (focusButton) downloadBtn?.focus();
}
function openDownloadMenu() {
  downloadMenu.hidden = false;
  downloadBtn.setAttribute('aria-expanded', 'true');
  downloadItems()[0]?.focus({ preventScroll: true });
}
downloadBtn?.addEventListener('click', () => {
  if (!downloadMenu) return;
  if (downloadMenu.hidden) openDownloadMenu(); else closeDownloadMenu(true);
});
// On the whole wrapper, not only the menu, so Escape also closes it when the focus is on the button (Translate's listens on the menu).
$('downloadMenuWrap')?.addEventListener('keydown', (e) => {
  if (!downloadMenu || downloadMenu.hidden) return;
  const items = downloadItems();
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeDownloadMenu(true); }
  else if (!items.length) return;
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i <= 0 ? items.length : i) - 1].focus(); }
  else if (e.key === 'Tab' && downloadMenu.contains(e.target)) closeDownloadMenu(false);
});

// Fable review #5: a small badge in the result bar (mirrors resultMeta, no persistent document
// here to jump within — Quick Mode is a one-shot convert-and-download) plus a short notice
// shown once before a BRF/PEF/eBraille download whenever the last transcribe() produced any
// transcription warnings ("Emboss had to skip or change N things — see details").
let quickWarnDismissTimer = null;
function updateQuickWarningsUI() {
  const badge = $('quickWarnBadge');
  if (!badge) return;
  const n = lastWarnings.length;
  if (!n) { badge.hidden = true; return; }
  badge.hidden = false;
  const label = n === 1 ? (t('app.warnings.badge_one') || '1 transcription warning') : (t('app.warnings.badge_other', { count: n }) || `${n} transcription warnings`);
  badge.textContent = label;
  const title = t('app.warnings.badge_title', { count: n }) || `Emboss had to skip or change ${n} thing(s) while brailling this document.`;
  badge.title = title;
  badge.setAttribute('aria-label', title);
}
function maybeShowExportWarningNotice() {
  if (!lastWarnings.length) return;
  const notice = $('exportWarnNotice'), textEl = $('exportWarnNoticeText');
  if (!notice || !textEl) return;
  const msg = t('app.warnings.export_notice', { count: lastWarnings.length }) || `Emboss had to skip or change ${lastWarnings.length} thing(s) — see details`;
  textEl.textContent = msg;
  notice.hidden = false;
  setStatus(msg, 'warn');
  if (quickWarnDismissTimer) clearTimeout(quickWarnDismissTimer);
  quickWarnDismissTimer = setTimeout(() => { notice.hidden = true; }, 12000);
}
$('exportWarnNoticeDismiss')?.addEventListener('click', () => {
  $('exportWarnNotice').hidden = true;
  if (quickWarnDismissTimer) clearTimeout(quickWarnDismissTimer);
});

async function triggerQuickDownload(format = 'brf') {
  closeDownloadMenu(true);
  if (selectionPending) { setStatus(STILL_READING); return; }
  if (lastBrf == null) return;
  maybeShowExportWarningNotice();
  const s = loadSettings();
  // PEF and eBraille are made again from the document, with the options the braille was made with: braille that came with the document
  // from the editor has none yet (nothing was formatted here), so they are made now (the .brf is the braille shown, as it is).
  if (format !== 'brf' && !lastOpts) { try { await ensureOpts(); } catch (e) { setStatus('Could not prepare the export: ' + e.message, 'err'); return; } }
  const opts = {
    ...(lastOpts || {}),
    mode: s.mode, width: Number(s.cells) || 38, depth: Number(s.lines) || 25,
    volumePages: Number(s.volumePages) || 0, includeCovers: !!s.includeCovers,
    duplex: s.embosserDuplex,
  };
  let content = lastBrf;
  let mimeType = 'application/octet-stream';
  let ext = '.brf';
  let ebrlWarnings = [];

  if (format === 'pef') {
    content = exportToPef(currentDoc || { title: currentName, blocks: [] }, opts);
    mimeType = 'application/x-pef+xml';
    ext = '.pef';
  } else if (format === 'ebrl' || format === 'ebrf') {
    // The document's own language, author, identifier and publisher come first; the code's language next; the browser's is the last fallback (B1).
    content = exportToEbraille(currentDoc || { title: currentName, blocks: [] }, { ...opts, language: (navigator.language || 'en') });
    mimeType = 'application/epub+zip';
    ext = '.ebrl';
    ebrlWarnings = content.warnings || [];
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = currentName + ext;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  // S3b #20 (Paul C1): table cells or labels that could not be brailled stand as transcriber's notes in the eBraille; say so, not just "Exported".
  if (ebrlWarnings.length) setStatus(ebrailleWarningText(ebrlWarnings, `${currentName}${ext}`), 'warn');
  else setStatus(`Exported ${currentName}${ext} document.`, 'ok');
}

$('downloadBrfItem')?.addEventListener('click', () => triggerQuickDownload('brf'));
$('downloadPefItem')?.addEventListener('click', () => triggerQuickDownload('pef'));
$('downloadEbrlItem')?.addEventListener('click', () => triggerQuickDownload('ebrl'));

// CAPTURING, as Translate's is: a handler further down that stopped a click from bubbling would otherwise leave the menu open behind
// whatever that click opened.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#downloadMenuWrap')) closeDownloadMenu(false);
}, true);

// ---- toolbar arrow keys (as Translate's toolbar; feedback 10 Oct, item 6) ----
// The header and the Read / Emboss / Download group are role="toolbar", and Left, Right, Home and End move between their buttons as an
// EXTRA way round: Tab still reaches each one on its own (no roving tabindex), so nothing became harder to reach.
// Screen readers are left alone, as in Translate: a screen reader's browse-mode arrow keys never reach the page, so this only runs when the
// browser itself delivers the key to one of these buttons.
// Two differences from Translate's, both for safety. A key held with Alt, Ctrl, Cmd or Shift is left to the browser (Alt+Left and Cmd+Left
// are Back, and Shift+Arrow is not a move between buttons). And in a right-to-left language the arrows follow the screen, so Left goes to
// the next button in the document, which sits on the left there.
// A LIVE QUERY on every key, as Translate's is: Emboss and Download can be hidden or revealed (Ctrl/Cmd+Shift+\), and a cached list would go stale.
function wireToolbar(toolbar, selector) {
  if (!toolbar) return;
  const buttons = () => [...toolbar.querySelectorAll(selector)].filter((b) => b.offsetParent !== null && !b.disabled);
  toolbar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const items = buttons();
    const from = items.indexOf(document.activeElement);
    if (from === -1) return;    // focus is on something else inside the toolbar, such as an open menu's items
    e.preventDefault();
    const rtl = getComputedStyle(toolbar).direction === 'rtl';
    const step = (e.key === 'ArrowRight') === !rtl ? 1 : -1;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (from + step + items.length) % items.length;
    items[to].focus();
  });
}
wireToolbar($('headRight'), '#advancedBtn, #downloadBtn, #helpBtn, #settingsBtn');

// ---- Expert Hardware & Serial mode toggle (Ctrl+Shift+\) ----
// The state is remembered across reloads (G1, 16 Sep): it lives in the shared settings
// (settings.expertHardware), the same setting the editor uses.
try { localStorage.removeItem('emboss_expert_hardware'); } catch {}   // the old, never-persisted key
// A beta build (feedback item 15): the hardware controls are not offered unless unlocked with ?tools=1.
const BETA_LOCKED = betaLocked();
if (BETA_LOCKED) document.body.classList.add('beta-locked');
let expertHardwareMode = loadSettings().expertHardware === true && !BETA_LOCKED;
document.body.classList.toggle('expert-hardware', expertHardwareMode);
// Settings shown only to transcribers (Paul, 7 Oct 2026: paragraph style and quotation marks): Transcriber tools is switched on in the editor's
// Settings and shared through the saved settings; a beta build keeps it off, as the editor does.
document.body.classList.toggle('transcriber-tools', loadSettings().transcriberTools === true && !BETA_LOCKED);

function toggleHardwareExpertMode() {
  if (BETA_LOCKED) return;
  expertHardwareMode = !expertHardwareMode;
  document.body.classList.toggle('expert-hardware', expertHardwareMode);
  saveSettings({ expertHardware: expertHardwareMode });
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
