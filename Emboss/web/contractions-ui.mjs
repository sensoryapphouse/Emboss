// Contractions - the Settings line and the "Choose contractions" dialog (relaxed braille, A91; Paul 3 Oct 2026, reworked 2 Nov 2026). Both pages (Quick
// Mode, the editor) use this one module; the page supplies only its Braille code <select>, the line's place in Settings and what to do when the braille
// must be made again. (It replaces web/reader-profile-ui.mjs.)
//
// PAUL, 2 NOV 2026: "relaxed braille is part of the template (one name)". There are no separately named reader profiles any more: the contractions a
// reader has learned - the "ticks" - belong to the TEMPLATE (web/templates.mjs). A teacher makes a template per learner ("Sam – Year 2") with the
// template's own Save as; the one picker and the one set of Save / Save as / Rename / Delete / Export / Import buttons are the template's. The ticks in
// force are the setting `contractions` of web/settings.mjs (null = All). This file only shows and changes them.
//
//   Settings > Template > Template settings, directly under Braille code, ONE line:   Contractions: All   [ Choose… ]
//                                   or  "Contractions: 41 of 181". It is shown only when relaxed braille is switched on (?relaxed=1, web/settings.mjs)
//                                   AND the selected braille code is UEB contracted (grade 2); with grade 1 or any other code there is nothing to choose.
//                                   There are no checkboxes in Settings itself.
//   The dialog "Choose contractions": the sample sentence (live from the working ticks), then ONE ROW PER GROUP of contractions, every group collapsed:
//                                   [ group checkbox (mixed when part of the group is ticked) ] [ name ] [ "6 of 12" ] [ Show / Hide ]
//                                   The Show button (aria-expanded, aria-controls) reveals that group's own checkboxes - a button beside the group
//                                   checkbox, never a checkbox inside a <summary> (nested interactive controls break screen readers). Under the rows,
//                                   "Left out in this document" (closed). Buttons: Done and Cancel (no profile list, no Save / Save as / Rename / Delete).
//   - Ticking changes a working copy. Done applies it: the setting is saved, the template shows "(modified)" if its own ticks differ, and the braille is
//     made again. Cancel throws the working copy away. Escape or the close button with unapplied changes asks first. Focus returns to Choose….
//   - The sample is a short sentence brailled with the ticks on screen (the document's braille changes only on Done); the teacher can type a sentence of
//     their own (remembered on this computer). "Left out in this document" counts the open document once (format/relaxed-report.mjs, in the background;
//     cached until its text changes) and re-lists from the counts at every tick. Neither is a live region: a screen reader is not interrupted at every tick.
//   - The label (Quick Mode's header, above the editor's braille) names the TEMPLATE in use - "Template: Sam – Year 2" - only when relaxed braille is on, the
//     code is UEB contracted and the template relaxes something (ticks other than All). It is a button that opens the dialog.
//
// The dialog is built here (like problem-report.mjs), so the two pages carry only the line. English words are in WORDS (and in locales/en.json,
// app.relaxed.*) - the page's t() is tried first, so a translation in any locale file is used.
import { UEB_CONTRACTION_GROUPS, UEB_CONTRACTION_SIGNS } from '../format/relaxed-signs.mjs';
import { cleanContractions, CONTRACTIONS_TOTAL, describeCells, groupTickState } from './reader-profiles.mjs';
import { relaxedEnabled, relaxedProfileKey, loadSettings, saveSettings, SETTINGS_KEY } from './settings.mjs';
import { resolveTable, RELAXABLE_TABLE_RE, makeTranslators } from './braille-table.mjs';
import { templateLabelShown } from './relaxed-explain.mjs';
import { loadStore, templateLabel, sameContractions, TEMPLATE_STORE_KEY } from './templates.mjs';
import { countSigns, leftOut, signUse, textSignature, DEFAULT_SAMPLE } from '../format/relaxed-report.mjs';
import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';

const WORDS = {
  'app.relaxed.line_all': 'Contractions: All',
  'app.relaxed.line_some': 'Contractions: {n} of {total}',
  'app.relaxed.choose': 'Choose…',
  'app.relaxed.label': 'Template: {name}',
  'app.relaxed.label_title': 'Choose contractions',
  'app.relaxed.title': 'Choose contractions',
  'app.relaxed.intro': 'Tick the contractions this reader has learned. Every contraction that is not ticked is spelled out in letters. Letters, capitals, numbers and punctuation do not change. The ticks belong to the template you are using.',
  'app.relaxed.close': 'Close',
  'app.relaxed.done': 'Done',
  'app.relaxed.cancel': 'Cancel',
  'app.relaxed.count': '{n} of {total} contractions ticked',
  'app.relaxed.dirty': 'Not applied yet. Press Done to use these ticks.',
  'app.relaxed.group_count': '{n} of {total}',
  'app.relaxed.group_show': 'Show',
  'app.relaxed.group_hide': 'Hide',
  'app.relaxed.table_label': 'Contractions, in groups',
  'app.relaxed.confirm_discard': 'Throw away the contractions you have ticked? They have not been applied yet.',
  'app.relaxed.sign_aria': '{print}, {dots}',
  // Stage 3 (decisions F, I; by template since 2 Nov 2026): the status bar's note on spelled-out contractions
  'app.relaxed.and': 'and',
  'app.relaxed.spelled_out': '{signs} spelled out. Not in template: {name}.',                // Q1 (Paul, 3 Oct 2026), by template (Paul, 2 Nov 2026)
  'app.relaxed.spelled_out_word': 'Spelled out. Not in template: {name}.',                   // Q2: the whole word is one sign
  // Stage 4 (decision H): the sample sentence and the contractions left out of the open document
  'app.relaxed.sample_title': 'Sample',
  'app.relaxed.sample_hint': 'Your ticks on a sentence. The braille below changes as you tick; the document changes when you press Done.',
  'app.relaxed.sample_label': 'Sample sentence',
  'app.relaxed.sample_reset': 'Use the standard sentence',
  'app.relaxed.sample_braille': 'Braille with these ticks',
  'app.relaxed.lo_title': 'Left out in this document',
  'app.relaxed.lo_short_nodoc': 'no document is open',
  'app.relaxed.lo_short_counting': 'counting…',
  'app.relaxed.lo_short_none': 'nothing',
  'app.relaxed.lo_short_one': '1 contraction',
  'app.relaxed.lo_short_n': '{kinds} contractions',
  'app.relaxed.lo_nodoc': 'No document is open, so there is nothing to count. Open a document to see which contractions these ticks leave out of it.',
  'app.relaxed.lo_counting': 'Counting…',
  'app.relaxed.lo_all': 'Nothing is left out: every contraction is ticked.',
  'app.relaxed.lo_nothing': 'Nothing is left out: every contraction in this document is ticked.',
  'app.relaxed.lo_summary_once': 'One contraction is left out, once. It is spelled out in letters.',
  'app.relaxed.lo_summary_one': 'One contraction is left out. It comes up {times} times and is spelled out in letters.',
  'app.relaxed.lo_summary_n': '{kinds} contractions are left out, {times} times in all. They are spelled out in letters. The commonest come first.',
  'app.relaxed.lo_col_sign': 'Contraction',
  'app.relaxed.lo_col_use': 'Used for',
  'app.relaxed.lo_col_group': 'Group',
  'app.relaxed.lo_col_times': 'Times',
  'app.relaxed.lo_use_whole': 'a whole word',
  'app.relaxed.lo_use_part': 'part of a word',
  'app.relaxed.lo_use_either': 'a word, or part of a word',
  'app.relaxed.lo_show_all': 'Show all {n}',
  'app.relaxed.lo_show_top': 'Show only the top {n}',
  // the template's own words, for the label (web/settings-panes.mjs has the originals; the page's t() is tried first)
  'templates.modified': 'modified',
  'templates.from_document': 'from document',
};

export const CONTRACTIONS_WORDS = WORDS;   // for the tests: the English words here and in locales/en.json must be the same

let cfg = null;          // { field, button, line, label, codeSelect, t, onChange, getCurrent, getEngine, getDocumentText } once a page has called initContractionsUI
let dlg = null;          // the dialog element, built on first open
let ui = null;           // its parts
let applied = null;      // the ticks in force when the dialog opened (null = All, else a cleaned list)
let work = new Set();    // the ticks on screen
let opener = null;
let engineAsk = 0;
let engine = null;       // { louis, table } of the page, for the sample and the count; null = not UEB contracted (both are hidden)
let lastKey = '';        // relaxedProfileKey() as this page last made its braille: another tab's change is noticed by comparing it
const SAMPLE_KEY = 'emboss-relaxed-sample';   // the teacher's own sample sentence (one for all templates; this computer only)
const LEFT_OPEN_KEY = 'emboss-relaxed-leftout-open';   // whether the teacher left the list open (a per-computer convenience)
const TOP_N = 15;
// the contractions left out of the open document: state 'idle' | 'nodoc' | 'counting' | 'ready'; cache = the last finished count
const lo = { state: 'idle', job: 0, result: null, cache: null, showAll: false };
const ALL_KEYS = UEB_CONTRACTION_SIGNS.map((s) => s.key);

function tr(key, vars) {
  let v = cfg && cfg.t ? cfg.t(key, vars) : '';
  if (!v || v === key) v = WORDS[key] || key;
  return vars ? v.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m)) : v;
}
/** The page's translation of an app.relaxed.* word (English if the locale has none), {placeholders} filled in. Other pages' status bars use it. */
export const contractionsText = (key, vars) => tr(key, vars);
const isAllTicked = () => work.size === ALL_KEYS.length;
const workList = () => cleanContractions(work);
const isDirty = () => !sameContractions(workList(), applied);
const inForce = () => cleanContractions(loadSettings().contractions);

// ---- the line in Settings ----------------------------------------------------------------------------------------------------------
/** Show or hide the Settings line and the label, and say how many contractions are ticked. Pages call it whenever the Braille code list is filled or changed, and the template changes. */
export function refreshContractionsLine() {
  if (!cfg) return;
  const v = cfg.codeSelect && cfg.codeSelect.value;
  if (v === '__more__') return;                                   // the list is being widened; the code has not changed
  let show = false;
  try { show = relaxedEnabled() && !!v && RELAXABLE_TABLE_RE.test(resolveTable({ brailleCode: v, grade: 'g2' })); } catch { show = false; }
  cfg.field.hidden = !show;
  // the help's section on relaxed braille is there whenever relaxed braille is switched on (?relaxed=1), whatever the code
  const help = document.getElementById('helpRelaxed');
  if (help) { let on = false; try { on = relaxedEnabled(); } catch { on = false; } help.hidden = !on; }
  const ticks = inForce();
  cfg.line.textContent = ticks ? tr('app.relaxed.line_some', { n: ticks.length, total: CONTRACTIONS_TOTAL }) : tr('app.relaxed.line_all');
  cfg.button.textContent = tr('app.relaxed.choose');
  refreshLabel(show, ticks);
}
/**
 * Decision F, by template: "Template: <name>" where braille is made (Quick Mode's header, above the editor's braille). Shown only with relaxed braille on, a
 * UEB contracted code (`relaxable`, worked out for the Settings line) and a template in force that relaxes something. The name is the template's as the picker
 * shows it ("Sam – Year 2", "Sam – Year 2 (modified)"). Plain text, or a button that opens the dialog; never a live region.
 */
function refreshLabel(relaxable, ticks) {
  const l = cfg && cfg.label;
  if (!l) return;
  const show = templateLabelShown({ enabled: relaxedEnabled(), relaxable, relaxes: !!ticks });
  l.hidden = !show;
  if (!show) return;
  let name = '';
  try {
    const c = cfg.getCurrent ? cfg.getCurrent() : { settings: loadSettings() };
    name = templateLabel(loadStore(c.settings), { ...c, relaxed: true }, { modified: tr('templates.modified'), fromDocument: tr('templates.from_document') });
  } catch { name = ''; }
  l.textContent = tr('app.relaxed.label', { name });
}

/**
 * page: { field, button, line, label, codeSelect, t, onChange, getCurrent, getEngine, getDocumentText }. field: the (hidden) Settings row holding the line and
 * the button; line: the text "Contractions: All"; button: Choose…; label (optional): the element that shows the template in use where braille is made - a
 * <button> also opens the dialog; codeSelect: the Braille code <select>; t: the page's translator; onChange(): the braille must be made again (the ticks
 * changed - here by Done, or by another tab); getCurrent(): { settings, doc?, producer? } as the template picker has it, for the label.
 * Stage 4: getEngine(): (a promise of) { louis, table } - the page's own engine and the table in force, for the sample sentence and the count (null, or a
 * table that is not UEB grade 2, hides both); getDocumentText(): the open document's text ('' when there is none).
 */
export function initContractionsUI(page) {
  cfg = page;
  lastKey = relaxedProfileKey();
  cfg.button.setAttribute('aria-haspopup', 'dialog');
  cfg.button.addEventListener('click', () => openContractionsDialog());
  if (cfg.label && cfg.label.tagName === 'BUTTON') {
    cfg.label.setAttribute('aria-haspopup', 'dialog');
    cfg.label.title = tr('app.relaxed.label_title');
    cfg.label.addEventListener('click', () => openContractionsDialog(cfg.label));
  }
  cfg.codeSelect.addEventListener('change', refreshContractionsLine);
  // The template picker (web/settings-panes.mjs) says when the template, or what it holds, changed: the line and the label follow.
  document.addEventListener('emboss:templates-refreshed', () => { lastKey = relaxedProfileKey(); refreshContractionsLine(); });
  // Another tab changed the settings or the templates: the line says so, and this page's braille is made again now when the ticks differ
  // (otherwise it would be at the page's next render, when it reads the stored ticks afresh).
  window.addEventListener('storage', (e) => {
    if (e.key !== SETTINGS_KEY && e.key !== TEMPLATE_STORE_KEY && e.key !== null) return;
    refreshContractionsLine();
    if (dlg && dlg.open && !isDirty()) syncFromSettings();
    if (relaxedEnabled()) {
      const k = relaxedProfileKey();
      if (k !== lastKey) { lastKey = k; cfg.onChange && cfg.onChange(); }
    }
  });
  refreshContractionsLine();
}

// ---- the dialog --------------------------------------------------------------------------------------------------------------------
function build() {
  dlg = document.createElement('dialog');
  dlg.id = 'contractionsDialog';
  dlg.className = 'dialog rp-dialog';
  dlg.setAttribute('aria-labelledby', 'rpTitle');
  dlg.innerHTML = `<div class="dialog-body rp-body">
    <div class="dialog-head"><h2 id="rpTitle"></h2><button type="button" id="rpClose" class="icon-btn"><svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-xmark"/></svg></button></div>
    <p id="rpIntro" class="rp-text"></p>
    <p class="rp-text rp-summary"><span id="rpCount"></span> <strong id="rpDirty" class="rp-dirty"></strong></p>
    <div class="rp-scroll" id="rpScroll">
    <div id="rpSample" class="rp-sample" role="group" aria-labelledby="rpSampleHead" hidden>
      <h3 id="rpSampleHead" class="rp-h"></h3>
      <p id="rpSampleHint" class="rp-sample-hint"></p>
      <div class="rp-sample-row">
        <label for="rpSampleText" id="rpSampleTextLabel"></label>
        <textarea id="rpSampleText" rows="2" maxlength="160" autocomplete="off" spellcheck="true"></textarea>
        <button type="button" class="rp-btn rp-small" id="rpSampleReset"></button>
      </div>
      <p class="rp-sample-lab" id="rpSampleBrlLab"></p>
      <p id="rpSampleBrl" class="rp-braille"></p>
    </div>
    <div id="rpTable" class="rp-table" role="group"></div>
    <details id="rpLeft" class="rp-leftout" hidden>
      <summary id="rpLeftSum"></summary>
      <div id="rpLeftBody" class="rp-leftout-body">
        <p id="rpLeftNote" class="rp-text"></p>
        <div id="rpLeftWrap" class="rp-lo-wrap">
          <table id="rpLeftTable" class="rp-lo-table">
            <thead><tr><th scope="col" id="rpLoColSign"></th><th scope="col" id="rpLoColUse"></th><th scope="col" id="rpLoColGroup"></th><th scope="col" id="rpLoColTimes" class="rp-lo-num"></th></tr></thead>
            <tbody id="rpLeftRows"></tbody>
          </table>
        </div>
        <button type="button" class="rp-btn" id="rpLeftMore" aria-expanded="false" hidden></button>
      </div>
    </details>
    </div>
    <div class="dialog-foot rp-foot"><button type="button" id="rpCancel" class="rp-btn"></button><button type="button" id="rpDone" class="rp-btn rp-done"></button></div>
  </div>`;
  document.body.appendChild(dlg);
  const q = (id) => dlg.querySelector('#' + id);
  ui = { title: q('rpTitle'), close: q('rpClose'), intro: q('rpIntro'), count: q('rpCount'), dirty: q('rpDirty'), table: q('rpTable'), done: q('rpDone'), cancel: q('rpCancel'),
    sample: q('rpSample'), sampleHead: q('rpSampleHead'), sampleHint: q('rpSampleHint'), sampleLabel: q('rpSampleTextLabel'), sampleText: q('rpSampleText'),
    sampleReset: q('rpSampleReset'), sampleBrlLab: q('rpSampleBrlLab'), sampleBrl: q('rpSampleBrl'),
    left: q('rpLeft'), leftSum: q('rpLeftSum'), leftNote: q('rpLeftNote'), leftWrap: q('rpLeftWrap'), leftRows: q('rpLeftRows'), leftMore: q('rpLeftMore') };

  ui.close.addEventListener('click', requestClose);
  ui.cancel.addEventListener('click', () => { if (dlg.open) dlg.close(); });            // Cancel: the working ticks are thrown away, with no question
  ui.done.addEventListener('click', apply);
  // Escape: ask first if there is anything to lose. (keydown, not just the dialog's 'cancel' event: a browser may ignore a prevented 'cancel' and close anyway.)
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    requestClose();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('close', () => {
    lo.job++;                                                       // stop any count still running
    // back to what opened it - the Choose… button or the template label - unless that is not on screen now (the label goes when the template relaxes
    // nothing, and Settings may be closed): then to the first of the Choose… button, the Settings icon
    const onScreen = (x) => !!x && document.contains(x) && !x.hidden && x.getClientRects().length > 0;
    const o = [opener, cfg && cfg.button, document.getElementById('settingsBtn')].find(onScreen) || (opener && document.contains(opener) ? opener : cfg && cfg.button);
    opener = null;
    if (o && o.focus) {
      o.focus();
      setTimeout(() => { if (document.activeElement !== o && !dlg.open) o.focus(); }, 0);   // Safari moves the focus to the dialog underneath just after 'close'
    }
  });
  renderGroups();
  // the rows: one delegated listener for every checkbox, one for the Show / Hide buttons
  ui.table.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb || cb.tagName !== 'INPUT') return;
    if (cb.dataset.group) {
      const g = UEB_CONTRACTION_GROUPS.find((x) => x.id === cb.dataset.group);
      for (const s of g.signs) { if (cb.checked) work.add(s.key); else work.delete(s.key); }
      for (const box of ui.table.querySelectorAll(`input[data-key][data-g="${g.id}"]`)) box.checked = cb.checked;
    } else if (cb.dataset.key) {
      if (cb.checked) work.add(cb.dataset.key); else work.delete(cb.dataset.key);
    }
    refreshState();
  });
  ui.table.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-expand]') : null;
    if (b) toggleGroup(b.dataset.expand);
  });
  // the sample sentence: the teacher's own, remembered; "Use the standard sentence" goes back
  ui.sampleText.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });          // one sentence: Enter does not start a new line
  ui.sampleText.addEventListener('input', () => {
    if (/[\r\n]/.test(ui.sampleText.value)) ui.sampleText.value = ui.sampleText.value.replace(/[\r\n]+/g, ' ');   // a pasted line break
    storeSample(ui.sampleText.value);
    refreshSample();
  });
  ui.sampleReset.addEventListener('click', () => { ui.sampleText.value = DEFAULT_SAMPLE; storeSample(null); refreshSample(); ui.sampleText.focus(); });
  // the list of contractions left out: the top 15, or all
  ui.leftMore.addEventListener('click', () => {
    lo.showAll = !lo.showAll;
    refreshLeftOut();
  });
  ui.left.addEventListener('toggle', () => { try { localStorage.setItem(LEFT_OPEN_KEY, ui.left.open ? '1' : '0'); } catch { /* a convenience only */ } });
}

/** One row per group, collapsed: [group checkbox][name][count][Show]; the group's own checkboxes follow in a region the button controls. Built once. */
function renderGroups() {
  ui.table.textContent = '';
  ui.table.setAttribute('aria-label', tr('app.relaxed.table_label'));
  for (const g of UEB_CONTRACTION_GROUPS) {
    const row = document.createElement('div');
    row.className = 'rp-grouprow';
    const head = document.createElement('div');
    head.className = 'rp-grouphead';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox'; allCb.id = `rpg-${g.id}`; allCb.dataset.group = g.id;
    allCb.setAttribute('aria-labelledby', `rpgn-${g.id}`);                 // named by the group's name ...
    allCb.setAttribute('aria-describedby', `rpgc-${g.id}`);                // ... and described by its count ("6 of 12")
    const name = document.createElement('label');
    name.id = `rpgn-${g.id}`; name.htmlFor = allCb.id; name.className = 'rp-gname'; name.textContent = g.label;
    const gcount = document.createElement('span');
    gcount.id = `rpgc-${g.id}`; gcount.className = 'rp-gcount'; gcount.dataset.gcount = g.id;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = `rpe-${g.id}`; btn.className = 'rp-btn rp-expand'; btn.dataset.expand = g.id;
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', `rpp-${g.id}`);
    btn.setAttribute('aria-labelledby', `${btn.id} ${name.id}`);           // "Show" + the group's name
    head.append(allCb, name, gcount, btn);
    const grid = document.createElement('div');
    grid.id = `rpp-${g.id}`; grid.className = 'rp-signs'; grid.hidden = true;
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-labelledby', name.id);
    for (const s of g.signs) {
      const label = document.createElement('label');
      label.className = 'rp-check rp-sign';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.dataset.key = s.key; cb.dataset.g = g.id;
      const shown = s.learnKey || s.print;                       // "be-" for the groupsign, as Paige Learn writes it
      cb.setAttribute('aria-label', tr('app.relaxed.sign_aria', { print: shown, dots: describeCells(s.braille) }));
      const pr = document.createElement('span'); pr.className = 'rp-print'; pr.textContent = shown;
      const cells = document.createElement('span'); cells.className = 'rp-cells'; cells.textContent = s.braille; cells.setAttribute('aria-hidden', 'true');
      label.append(cb, pr, cells);
      grid.appendChild(label);
    }
    row.append(head, grid);
    ui.table.appendChild(row);
  }
}
function toggleGroup(id, open) {
  const btn = ui.table.querySelector(`button[data-expand="${id}"]`), panel = ui.table.querySelector(`#rpp-${id}`);
  if (!btn || !panel) return;
  const on = open === undefined ? btn.getAttribute('aria-expanded') !== 'true' : !!open;
  btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  btn.textContent = tr(on ? 'app.relaxed.group_hide' : 'app.relaxed.group_show');
  panel.hidden = !on;
}

/** Group checkboxes (ticked / mixed / clear), the counts, and the not-applied note. */
function refreshState() {
  for (const g of UEB_CONTRACTION_GROUPS) {
    const cb = ui.table.querySelector(`input[data-group="${g.id}"]`);
    if (!cb) continue;
    const st = groupTickState(work, g);
    cb.checked = st === 'all';
    cb.indeterminate = st === 'some';                              // exposed to assistive technology as "mixed"
    const n = g.signs.filter((s) => work.has(s.key)).length;
    const gc = ui.table.querySelector(`[data-gcount="${g.id}"]`);
    if (gc) gc.textContent = tr('app.relaxed.group_count', { n, total: g.signs.length });
  }
  for (const box of ui.table.querySelectorAll('input[data-key]')) box.checked = work.has(box.dataset.key);
  ui.count.textContent = tr('app.relaxed.count', { n: work.size, total: CONTRACTIONS_TOTAL });
  ui.dirty.textContent = isDirty() ? tr('app.relaxed.dirty') : '';
  refreshSample();
  refreshLeftOut();
}

/** The ticks in force become the working copy (and what Cancel goes back to). */
function syncFromSettings() {
  applied = inForce();
  work = new Set(applied || ALL_KEYS);
  refreshState();
}

// ---- Stage 4: the sample sentence ----------------------------------------------------------------------------------------------------
function storedSample() {
  try { const v = localStorage.getItem(SAMPLE_KEY); if (typeof v === 'string' && v.trim()) return v.slice(0, 160); } catch { /* not readable: the standard sentence */ }
  return DEFAULT_SAMPLE;
}
function storeSample(text) {
  try {
    if (text == null || !String(text).trim() || String(text).trim() === DEFAULT_SAMPLE) localStorage.removeItem(SAMPLE_KEY);
    else localStorage.setItem(SAMPLE_KEY, String(text));
  } catch { /* a convenience only */ }
}
/** The sample sentence in braille, with the ticks on screen (the working copy). Not a live region: nothing is announced. */
function refreshSample() {
  if (!ui) return;
  ui.sample.hidden = !engine;
  if (!engine) return;
  const text = ui.sampleText.value;
  let brl = '';
  try { brl = brfToUnicodeBraille(makeTranslators(engine.louis, engine.table, { relaxed: isAllTicked() ? null : new Set(work) }).translate(text)).replace(/\s+/g, ' ').trim(); } catch { brl = ''; }
  ui.sampleBrl.textContent = brl;
}

// ---- Stage 4: the contractions left out of the open document ----------------------------------------------------------------------------
function docText() { try { return cfg && cfg.getDocumentText ? String(cfg.getDocumentText() || '') : ''; } catch { return ''; } }
const fmt = (n) => { try { return n.toLocaleString(); } catch { return String(n); } };

/** Count the open document's contractions (once; cached until its text changes), in the background. Every tick then only re-lists. */
async function startCounting() {
  if (!ui || !engine || lo.state === 'counting' || isAllTicked()) return;
  const text = docText();
  if (!text.trim()) { lo.state = 'nodoc'; lo.result = null; refreshLeftOut(); return; }
  const sig = textSignature(text);
  if (lo.cache && lo.cache.sig === sig) { lo.state = 'ready'; lo.result = lo.cache.result; refreshLeftOut(); return; }
  lo.state = 'counting'; lo.result = null;
  refreshLeftOut();
  const job = ++lo.job;
  const e = engine;
  let r = null;
  try {
    r = await countSigns(text, makeTranslators(e.louis, e.table).translatePos, { isCancelled: () => job !== lo.job });
  } catch { r = null; }
  if (job !== lo.job) return;                                      // closed, or opened again: that open counts for itself
  if (!r) { lo.state = 'stopped'; return; }                        // cancelled: nothing to show; the next open counts again
  lo.cache = { sig, result: r };
  lo.result = r;
  lo.state = 'ready';
  refreshLeftOut();
}

/** The "Left out in this document" part: from the counts (once made) and the ticks on screen. No translation happens here. */
function refreshLeftOut() {
  if (!ui) return;
  ui.left.hidden = !engine;
  if (!engine) return;
  const all = isAllTicked();
  if (!all && lo.state === 'idle') { startCounting(); }              // some contraction is unticked: count (a view with every box ticked never counts)
  const title = tr('app.relaxed.lo_title');
  let short, note = '', rows = [];
  if (all) { short = tr('app.relaxed.lo_short_none'); note = tr('app.relaxed.lo_all'); }
  else if (lo.state === 'nodoc') { short = tr('app.relaxed.lo_short_nodoc'); note = tr('app.relaxed.lo_nodoc'); }
  else if (lo.state === 'ready' && lo.result) {
    rows = leftOut(lo.result.counts, work);
    if (!rows.length) { short = tr('app.relaxed.lo_short_none'); note = tr('app.relaxed.lo_nothing'); }
    else {
      const times = rows.reduce((n, x) => n + x.count, 0);
      short = rows.length === 1 ? tr('app.relaxed.lo_short_one') : tr('app.relaxed.lo_short_n', { kinds: fmt(rows.length) });
      note = rows.length === 1
        ? (times === 1 ? tr('app.relaxed.lo_summary_once') : tr('app.relaxed.lo_summary_one', { times: fmt(times) }))
        : tr('app.relaxed.lo_summary_n', { kinds: fmt(rows.length), times: fmt(times) });
    }
  } else { short = tr('app.relaxed.lo_short_counting'); note = tr('app.relaxed.lo_counting'); }     // 'counting' (and the moment before it starts)
  ui.leftSum.textContent = `${title}: ${short}`;
  ui.leftNote.textContent = note;
  ui.left.setAttribute('aria-busy', lo.state === 'counting' && !all ? 'true' : 'false');
  ui.leftWrap.hidden = rows.length === 0;
  const shown = lo.showAll ? rows : rows.slice(0, TOP_N);
  // rebuild the rows only when they changed (a tick that does not change the list leaves the focus and the scroll alone)
  const sig = shown.map((x) => `${x.key}=${x.count}`).join('|');
  if (ui.leftRows.dataset.sig !== sig) {
    ui.leftRows.dataset.sig = sig;
    ui.leftRows.textContent = '';
    for (const x of shown) {
      const tr1 = document.createElement('tr');
      const c1 = document.createElement('th'); c1.scope = 'row'; c1.className = 'rp-lo-sign';
      const p = document.createElement('span'); p.className = 'rp-print'; p.textContent = x.sign.learnKey || x.sign.print;
      const cells = document.createElement('span'); cells.className = 'rp-cells'; cells.textContent = x.sign.braille; cells.setAttribute('aria-hidden', 'true');
      c1.appendChild(p); c1.appendChild(cells);
      const c2 = document.createElement('td'); c2.textContent = tr('app.relaxed.lo_use_' + signUse(x.sign));
      const grp = UEB_CONTRACTION_GROUPS.find((g) => g.id === x.sign.group);
      const c3 = document.createElement('td'); c3.textContent = grp ? grp.label : '';
      const c4 = document.createElement('td'); c4.className = 'rp-lo-num'; c4.textContent = fmt(x.count);
      tr1.append(c1, c2, c3, c4);
      ui.leftRows.appendChild(tr1);
    }
  }
  const more = rows.length > TOP_N;
  ui.leftMore.hidden = !more;
  ui.leftMore.setAttribute('aria-expanded', lo.showAll ? 'true' : 'false');
  ui.leftMore.textContent = lo.showAll ? tr('app.relaxed.lo_show_top', { n: TOP_N }) : tr('app.relaxed.lo_show_all', { n: fmt(rows.length) });
}

// ---- leaving the dialog ------------------------------------------------------------------------------------------------------------------
/** Done: the working ticks become the ticks in force. The template shows "(modified)" if they differ from its own; the braille is made again. */
function apply() {
  if (!dlg || !dlg.open) return;
  const next = workList();
  const changedTicks = !sameContractions(next, inForce());
  if (changedTicks) saveSettings({ contractions: next });
  dlg.close();
  if (changedTicks) {
    lastKey = relaxedProfileKey();
    refreshContractionsLine();
    if (cfg.onChange) cfg.onChange();
  }
}
function requestClose() {
  if (!dlg || !dlg.open) return;
  if (isDirty() && !window.confirm(tr('app.relaxed.confirm_discard'))) return;
  dlg.close();
}

/** Open the dialog. Every group is collapsed; the ticks in force are shown. The focus goes to the first group's checkbox and comes back to Choose… on close. */
export function openContractionsDialog(from) {
  if (!cfg) return;
  // The ways in are the Choose… button and the template label, and that is where the focus returns. (Not document.activeElement:
  // Safari does not focus a button when it is clicked, so it can be <body> or the Settings dialog.)
  opener = from || cfg.button;
  if (!dlg) build();
  ui.title.textContent = tr('app.relaxed.title');
  ui.close.setAttribute('aria-label', tr('app.relaxed.close'));
  ui.intro.textContent = tr('app.relaxed.intro');
  ui.done.textContent = tr('app.relaxed.done');
  ui.cancel.textContent = tr('app.relaxed.cancel');
  ui.table.setAttribute('aria-label', tr('app.relaxed.table_label'));
  for (const g of UEB_CONTRACTION_GROUPS) toggleGroup(g.id, false);          // every group collapsed
  // Stage 4 words and starting state: the sample sentence (the teacher's own if they typed one), the list of what is left out
  ui.sampleHead.textContent = tr('app.relaxed.sample_title');
  ui.sampleHint.textContent = tr('app.relaxed.sample_hint');
  ui.sampleLabel.textContent = tr('app.relaxed.sample_label');
  ui.sampleReset.textContent = tr('app.relaxed.sample_reset');
  ui.sampleBrlLab.textContent = tr('app.relaxed.sample_braille');
  ui.sampleText.value = storedSample();
  dlg.querySelector('#rpLoColSign').textContent = tr('app.relaxed.lo_col_sign');
  dlg.querySelector('#rpLoColUse').textContent = tr('app.relaxed.lo_col_use');
  dlg.querySelector('#rpLoColGroup').textContent = tr('app.relaxed.lo_col_group');
  dlg.querySelector('#rpLoColTimes').textContent = tr('app.relaxed.lo_col_times');
  try { ui.left.open = localStorage.getItem(LEFT_OPEN_KEY) === '1'; } catch { ui.left.open = false; }
  lo.job++; lo.state = 'idle'; lo.result = null; lo.showAll = false;      // any count still running for an earlier open stops
  syncFromSettings();
  dlg.showModal();
  const first = ui.table.querySelector('input[data-group]');
  if (first) first.focus();
  // the page's own engine and table: the sample and the count are made with them (UEB contracted only; otherwise both stay hidden)
  const asked = ++engineAsk;
  Promise.resolve(cfg.getEngine ? cfg.getEngine() : null).then((e) => {
    if (asked !== engineAsk) return;
    engine = e && e.louis && e.table && RELAXABLE_TABLE_RE.test(String(e.table)) ? e : null;
    if (dlg.open) refreshState();
  }).catch(() => { engine = null; if (dlg.open) refreshState(); });
}
