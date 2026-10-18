// "Report a problem" (A89 step 2, the robustness programme; Paul, 2 Oct 2026). Transcribers gave up on BrailleBlaster because it
// crashed and nobody could see why; a tester who meets a strange bug in Emboss saves ONE file and emails it, and the bug can be
// reproduced instead of guessed from a screenshot.
//
// From the moment this module is imported it keeps the last 200 errors the page has met (uncaught errors, rejected promises,
// console.error). reportFiles() builds the report: README.txt, report.json (what the tester wrote, the version, the browser, the
// settings, the errors) and — unless the tester leaves it out — the document and its braille, which the page passes in. The page
// zips it (web/zip.mjs) and saves it on the tester's computer. Nothing is sent anywhere from here: no network request at all.

const MAX_ENTRIES = 200;
const MAX_TEXT = 4000;
const LOG = [];

const trim = (s) => { s = String(s ?? ''); return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 2) + ' …' : s; };

let recorded = 0;   // how many problems have ever been recorded (the log itself keeps only the last MAX_ENTRIES)
export function problemCount() { return recorded; }
export function recordProblem(kind, message, { source = '', stack = '' } = {}) {
  recorded++;
  LOG.push({ time: new Date().toISOString(), kind, message: trim(message), ...(source ? { source: trim(source) } : {}), ...(stack ? { stack: trim(stack) } : {}) });
  if (LOG.length > MAX_ENTRIES) LOG.splice(0, LOG.length - MAX_ENTRIES);
}
export function problemLog() { return LOG.map((e) => ({ ...e })); }
export function clearProblemLog() { LOG.length = 0; }

// ResizeObserver's "loop completed with undelivered notifications" is the browser's own harmless warning, not a problem.
const harmless = (msg) => /ResizeObserver/.test(String(msg || ''));
if (globalThis.window && !globalThis.__embossProblemLog) {
  globalThis.__embossProblemLog = true;
  window.addEventListener('error', (e) => {
    if (harmless(e.message)) return;
    const file = (e.filename || '').split('/').pop();
    recordProblem('error', e.message || String(e.error), { source: file ? `${file}:${e.lineno}:${e.colno}` : '', stack: e.error?.stack || '' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (harmless(r?.message || r)) return;
    recordProblem('promise', r?.message || String(r), { stack: r?.stack || '' });
  });
  const origError = console.error.bind(console);
  console.error = (...args) => {
    try {
      const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
      if (!harmless(text)) recordProblem('console', text, { stack: args.find((a) => a instanceof Error)?.stack || '' });
    } catch { /* the log must never break the page */ }
    origError(...args);
  };
}

export function reportFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `emboss-problem-report-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

// What the browser says about itself — the user agent, languages, screen and window size. No identity, no location.
export function browserEnvironment() {
  const n = globalThis.navigator || {};
  const s = globalThis.screen || {};
  return {
    userAgent: n.userAgent || '', platform: n.platform || '', language: n.language || '', languages: [...(n.languages || [])],
    screen: s.width ? `${s.width}×${s.height}` : '', window: globalThis.innerWidth ? `${globalThis.innerWidth}×${globalThis.innerHeight}` : '',
    pixelRatio: globalThis.devicePixelRatio || 1, online: n.onLine !== false, timeZone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })(),
  };
}

// [{ name, text | data }] for makeZip. documentFiles: what the page could save of the document ({ name, text | data }).
export function reportFiles({ page, description = '', includeDocument = true, buildInfo = null, settings = {}, environment = {}, extra = {}, documentFiles = [] }) {
  const docs = includeDocument ? documentFiles.filter(Boolean) : [];
  const report = {
    app: 'Emboss',
    page,
    time: new Date().toISOString(),
    version: buildInfo ? { hash: buildInfo.hash, date: buildInfo.date, beta: buildInfo.beta === true } : 'development',
    description: String(description || '').trim(),
    includedDocument: !!includeDocument,
    files: docs.map((f) => f.name),
    settings,
    environment,
    extra,
    errors: problemLog(),
  };
  const readme = [
    'Emboss problem report',
    '',
    `Saved ${report.time} from Emboss ${typeof report.version === 'string' ? report.version : report.version.hash + (report.version.beta ? ' (beta)' : '')}, ${page === 'quick' ? 'Quick Mode' : 'the editor'}.`,
    '',
    'This file was saved on your own computer; nothing was sent anywhere. Email it to the person who asked you to try Emboss.',
    '',
    'It holds:',
    '- report.json: what you wrote, the Emboss version, your browser and screen size, your Emboss settings, and any errors since the page was opened.',
    ...(docs.length ? [`- ${docs.map((f) => f.name).join(', ')}: your document and its braille, so the problem can be seen exactly as you had it.`]
      : ['- Your document was left out.']),
    '',
  ].join('\n');
  return [{ name: 'README.txt', text: readme }, { name: 'report.json', text: JSON.stringify(report, null, 2) }, ...docs];
}

// ---- the dialog (both pages): "What happened?", "Include my document and its braille", Save report file / Cancel.
// opts: page ('editor' | 'quick'); t(key, vars) for the words (English fallbacks below); collect() → { documentFiles, extra };
// settings() → the settings object; buildInfo() → Promise of build-info (or null); makeZip(files) → Blob; onSaved(fileName).
const WORDS = {
  'app.report.title': 'Report a problem',
  'app.report.intro': 'This saves one file on your computer for you to email to the person who asked you to try Emboss. Nothing is sent from here.',
  'app.report.desc_label': 'What happened? (optional)',
  'app.report.desc_placeholder': 'What you were doing, and what went wrong',
  'app.report.include_doc': 'Include my document and its braille (recommended: it lets us see the problem)',
  'app.report.save': 'Save report file',
  'app.report.cancel': 'Cancel',
  'app.report.saved': 'Saved {file}. Email it to the person who asked you to try Emboss.',
};
let dialogEl = null;
export function openProblemDialog(opts) {
  const tr = (k, vars) => { let v = (opts.t && opts.t(k, vars)); if (!v || v === k) v = WORDS[k] || k; return vars ? v.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? vars[n] : m)) : v; };
  const opener = document.activeElement;
  if (!dialogEl) {
    dialogEl = document.createElement('dialog');
    dialogEl.id = 'problemDialog';
    dialogEl.className = 'dialog problem-dialog';
    dialogEl.setAttribute('aria-labelledby', 'problemTitle');
    dialogEl.innerHTML = `<form method="dialog" class="dialog-body">
      <div class="dialog-head"><h2 id="problemTitle"></h2></div>
      <p id="problemIntro" class="problem-intro"></p>
      <label for="problemDesc" id="problemDescLabel" class="problem-label"></label>
      <textarea id="problemDesc" rows="4"></textarea>
      <label class="check-label problem-include"><input type="checkbox" id="problemIncludeDoc" checked> <span id="problemIncludeLabel"></span></label>
      <div class="dialog-foot problem-foot"><button type="button" id="problemCancel" class="pill-btn"></button><button type="button" id="problemSave"></button></div>
    </form>`;
    document.body.appendChild(dialogEl);
    dialogEl.querySelector('#problemCancel').addEventListener('click', () => dialogEl.close());
    dialogEl.addEventListener('close', () => { if (dialogEl._opener && document.contains(dialogEl._opener)) dialogEl._opener.focus(); });
  }
  dialogEl.querySelector('#problemTitle').textContent = tr('app.report.title');
  dialogEl.querySelector('#problemIntro').textContent = tr('app.report.intro');
  dialogEl.querySelector('#problemDescLabel').textContent = tr('app.report.desc_label');
  dialogEl.querySelector('#problemDesc').placeholder = tr('app.report.desc_placeholder');
  dialogEl.querySelector('#problemIncludeLabel').textContent = tr('app.report.include_doc');
  dialogEl.querySelector('#problemCancel').textContent = tr('app.report.cancel');
  const save = dialogEl.querySelector('#problemSave');
  save.textContent = tr('app.report.save');
  dialogEl.querySelector('#problemDesc').value = '';
  dialogEl.querySelector('#problemIncludeDoc').checked = true;
  dialogEl._opener = opener;
  save.onclick = async () => {
    save.disabled = true;
    try {
      const includeDocument = dialogEl.querySelector('#problemIncludeDoc').checked;
      let collected = { documentFiles: [], extra: {} };
      try { collected = (await opts.collect(includeDocument)) || collected; }
      catch (e) { recordProblem('report', `Could not collect the document: ${e?.message || e}`, { stack: e?.stack || '' }); }
      let buildInfo = null;
      try { buildInfo = await opts.buildInfo(); } catch { /* development */ }
      let settings = {};
      try { settings = opts.settings() || {}; } catch { /* none */ }
      const files = reportFiles({ page: opts.page, description: dialogEl.querySelector('#problemDesc').value, includeDocument, buildInfo, settings, environment: browserEnvironment(), extra: collected.extra || {}, documentFiles: collected.documentFiles || [] });
      const name = reportFileName();
      const url = URL.createObjectURL(opts.makeZip(files));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      dialogEl.close();
      opts.onSaved?.(name, tr('app.report.saved', { file: name }));
    } finally { save.disabled = false; }
  };
  dialogEl.showModal();
  dialogEl.querySelector('#problemDesc').focus();
}
