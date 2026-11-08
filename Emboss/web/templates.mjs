// Templates (task X1; Paul, 1 Nov 2026: "go with your suggestions"; plan: docs/templates-design.md).
//
// A template is a named set of the settings that shape the braille. A user picks one and is done; the details sit behind it in Settings.
//   - Two built-ins, protected: BANA and UKAAF. Their values are Emboss's own defaults for the standard (sanitizeSettings({ mode }), web/settings.mjs),
//     so anyone on an unmodified built-in gets exactly the braille they got before templates existed.
//   - Own templates: the settings in force saved under a name (Save As), saved over, renamed, deleted.
//   - "Modified": when the settings in force differ from the active template's, it shows as "BANA (modified)".
//   - Saved with the document (two <meta>s in the DTBook head; input/nimas-export.mjs writes them, input/parse.mjs reads them), so a job reopens as it was set up.
//   - Exported to and imported from a file, so an agency can share one.
//   - Nothing lost on upgrade: a user whose settings already differ from their standard's built-in gets them as the first own template, "My settings".
//
// The pure part (this file, no DOM) is tested in tests/templates.test.mjs; the Settings controls are in web/settings-panes.mjs. `emboss-settings`
// stays the one store every page reads: applying a template writes its values there. This file adds one more store, `emboss-templates`.
//
// What a template carries
//   settings part  TEMPLATE_SETTING_KEYS: only keys that change the braille (tests/templates.test.mjs makes the braille with two values of each and
//                  checks it differs). `language` and `grade` are not keys: both are derived from `brailleCode` (settingsPatch keeps them in step), and
//                  `language` is 'ueb' in a fresh store but 'en' after any Settings save, so as a key it would show every built-in as "modified".
//                  `codeIndicators`, `includeSpineLabels` and `includeCovers` (in the plan's list) are dropped: nothing in Emboss reads them (no exporter
//                  calls format/cover.mjs), so they change no braille. The "Tactile Volume Covers" checkbox stays where it was, in Advanced Production.
//   document part  the document-wide "Braille formatting options" of the Settings dialog (the docOptionsGroup of format/field-registry.mjs), stored the
//                  way the document stores them: only a value that differs from the default (a default-on rule as an explicit false, a default-off one as
//                  true, a text option as its text). Book details (the tp* fields) are about one book, not a job setup, and stay out.
//   producer part  (Paul, 2 Nov 2026, option A) the title-page facts that are the same on every job: PRODUCER_KEYS (agency, its place, country, reproduction
//                  notice, and the transcriber, proofreader and tactile specialist). They are document options, shown in Book details. Rules: applying a
//                  template (and a new document) fills only EMPTY producer fields of the open document, never overwriting one, and opening a document never
//                  changes them; they never count toward "(modified)"; Save and Save as take the open document's non-empty values over the template's
//                  (Quick Mode, with no document, keeps the template's own); an exported file leaves out the people's names (PRODUCER_NAME_KEYS) and so
//                  does an import. The book's own details (series, edition, ISBN ...) stay out.
//   contractions   (relaxed braille, A91; Paul, 2 Nov 2026: "relaxed braille is part of the template (one name)") the contractions a reader has learned -
//                  the template's "ticks": null = All (every contraction, ordinary braille; what BANA and UKAAF hold) or a list of catalogue keys
//                  (format/relaxed-signs.mjs; an empty list = none ticked). Reader profiles are no longer separately named things: a teacher makes a
//                  template per learner ("Sam - Year 2") with Save as. The ticks in force are the setting `contractions` of web/settings.mjs, so the
//                  braille reads them from there; a template carries them as a part of its own (NOT a settings key: the settings part of the file and
//                  of the document keeps its shape). Rules: a change of ticks makes the template "(modified)" like any braille setting - but only when
//                  relaxed braille is on (`cur.relaxed`, from ?relaxed=1); with it off the ticks are kept and ignored. Saved with Save and Save as,
//                  exported and imported in the template file (a `contractions` field, written only when not All), and saved in the document in one
//                  more meta, emboss-template-contractions (written only when not All). A file or document without ticks reads as All.
//   migration      the reader profiles the earlier preview stored (web/reader-profiles.mjs) become own templates, once (adoptReaderProfiles).
import { sanitizeSettings, SETTINGS_KEY } from './settings.mjs';
import { cleanContractions, contractionsSet, createProfileStore, ALL_NAME } from './reader-profiles.mjs';
import { GROUPS, CODECS, controlById, groupControlIds, fieldByKey } from '../format/field-registry.mjs';
import { CODES } from '../Translate/braille-codes.mjs';

export const TEMPLATE_STORE_KEY = 'emboss-templates';
export const TEMPLATE_STORE_VERSION = 1;
export const TEMPLATE_FILE_FORMAT = 'emboss-template';
export const TEMPLATE_FILE_VERSION = 1;
export const TEMPLATE_FILE_SUFFIX = '.emboss-template.json';
// The <meta name> of a saved document (input/nimas-export.mjs and input/parse.mjs write and read these two literals; a test holds them together).
export const TEMPLATE_META_NAME = 'emboss-template';
export const TEMPLATE_META_SETTINGS = 'emboss-template-settings';
export const TEMPLATE_META_CONTRACTIONS = 'emboss-template-contractions';   // relaxed braille: the template's ticks (written only when not All)
export { cleanContractions, contractionsSet };
export const MAX_NAME = 60;
const MAX_FILE_CHARS = 200000;
const MAX_TEXT_OPTION = 200;

// One Emboss (Paul, 4 Nov 2026, EMBOSS-TASKS section P) added three keys: `madeFor` (P-J: Paper / Monarch / DotPad; the device fixes the page size, and Monarch /
// DotPad show their emulator beside the braille), `embosserDuplex` (P-L: interpoint or single-sided; it changes the braille - facing-pages tables start on a
// left-hand page in interpoint, BANA 11.13.1b) and `embosser` (P-K: the paper embosser model; carried so a job knows which graphics its embosser can take,
// but it changes no text, so tests/templates.test.mjs lists it in CARRIED_ONLY rather than in the "changes the braille" check).
export const TEMPLATE_SETTING_KEYS = Object.freeze(['mode', 'brailleCode', 'mathCode', 'cells', 'lines', 'quoteStyle', 'listStyle', 'paragraphStyle', 'tableFormat', 'volumePages', 'toc', 'madeFor', 'embosser', 'embosserDuplex']);
export const TEMPLATE_KEYS_NOT_CHANGING_BRAILLE = Object.freeze(['embosser']);

const DOC_CONTROLS = groupControlIds(GROUPS.find((g) => g.id === 'docOptionsGroup')).map(controlById).filter(Boolean);
export const TEMPLATE_DOC_KEYS = Object.freeze(DOC_CONTROLS.map((c) => c.field));

const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

// The producer part (see the header). tpCountry is one of the registry's values; the others are text.
export const PRODUCER_KEYS = Object.freeze(['tpAgency', 'tpAgencyLocation', 'tpCountry', 'tpReproductionNotice', 'tpTranscriber', 'tpProofreader', 'tpTactileSpecialist']);
export const PRODUCER_NAME_KEYS = Object.freeze(['tpTranscriber', 'tpProofreader', 'tpTactileSpecialist']);
const MAX_PRODUCER_TEXT = 1000;
const COUNTRIES = (fieldByKey('tpCountry') || {}).values || [];
// Only the producer keys, each a non-empty cleaned value; `names: false` also leaves out the people's names.
export function cleanProducer(raw, { names = true } = {}) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of PRODUCER_KEYS) {
    if (!has(raw, k) || (!names && PRODUCER_NAME_KEYS.includes(k))) continue;
    const v = raw[k];
    if (typeof v !== 'string') continue;
    const text = v.trim();
    if (!text || text.length > MAX_PRODUCER_TEXT) continue;
    if (k === 'tpCountry' ? COUNTRIES.includes(text) : true) out[k] = text;
  }
  return out;
}
// The open document's options after a template's producer part is applied: only an empty producer field is filled, a value the document has stays.
export function producerPatch(templateProducer, options) {
  const out = { ...(options || {}) };
  const add = cleanProducer(templateProducer);
  for (const k of PRODUCER_KEYS) {
    const mine = out[k];
    if (add[k] !== undefined && (mine === undefined || mine === null || (typeof mine === 'string' && !mine.trim()))) out[k] = add[k];
  }
  return out;
}

export const pickSettings =(s) => Object.fromEntries(TEMPLATE_SETTING_KEYS.map((k) => [k, s ? s[k] : undefined]));

// ---- cleaning ----
// The document part: only the Braille formatting options, only a value that differs from the default, each checked as the Settings control checks it.
export function cleanDoc(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const ctl of DOC_CONTROLS) {
    if (!has(raw, ctl.field)) continue;
    const v = raw[ctl.field];
    if (ctl.codec === 'docBool') { if (v === true) out[ctl.field] = true; }
    else if (ctl.codec === 'docOff') { if (v === false) out[ctl.field] = false; }
    else if (ctl.codec === 'docText') {
      if (typeof v !== 'string') continue;
      const text = v.trim();
      if (!text || text.length > MAX_TEXT_OPTION) continue;
      const res = CODECS.docText.write(text, ctl);
      if (!res.err && res.value) out[ctl.field] = res.value;
    }
  }
  return out;
}

// The settings part, whatever it was given: the keys a template carries, each cleaned like any setting; a key not given takes the built-in value for
// the template's standard (so a short file is a complete template).
export function cleanTemplateSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const mode = has(r, 'mode') && r.mode === 'bana' ? 'bana' : 'ukaaf';
  const base = mode === 'bana' ? BANA_SETTINGS : UKAAF_SETTINGS;
  const merged = { ...base };
  for (const k of TEMPLATE_SETTING_KEYS) if (has(r, k) && r[k] !== undefined && r[k] !== null) merged[k] = r[k];
  if (typeof merged.brailleCode !== 'string' || !CODES.some((c) => c.id === merged.brailleCode)) merged.brailleCode = base.brailleCode;
  const clean = sanitizeSettings(merged);
  clean.toc = merged.toc === true;
  return pickSettings(clean);
}

// ---- the built-ins ----
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
const BANA_SETTINGS = pickSettings(sanitizeSettings({ mode: 'bana' }));
const UKAAF_SETTINGS = pickSettings(sanitizeSettings({ mode: 'ukaaf' }));
export const BUILTIN_TEMPLATES = deepFreeze([
  { id: 'bana', name: 'BANA', builtin: true, settings: BANA_SETTINGS, doc: {}, producer: {}, contractions: null },
  { id: 'ukaaf', name: 'UKAAF', builtin: true, settings: UKAAF_SETTINGS, doc: {}, producer: {}, contractions: null },
]);
export const DOCUMENT_TEMPLATE_ID = 'document';
const builtinFor = (mode) => (mode === 'bana' ? BUILTIN_TEMPLATES[0] : BUILTIN_TEMPLATES[1]);

// ---- comparing ----
const same = (a, b) => (typeof a === 'boolean' || typeof b === 'boolean' ? !!a === !!b : String(a) === String(b));
export function sameSettings(a, b) {
  return TEMPLATE_SETTING_KEYS.every((k) => same(a && a[k], b && b[k]));
}
// The ticks: null (All) or a list; the same when both are All, or both lists of the same keys (the lists are cleaned, so sorted).
export function sameContractions(a, b) {
  const x = cleanContractions(a), y = cleanContractions(b);
  return x === null || y === null ? x === y : x.length === y.length && x.every((k, i) => k === y[i]);
}

// ---- names ----
export const tidyName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const lc = (s) => tidyName(s).toLowerCase();
// null when the name can be used, else why not: 'empty' | 'long' | 'builtin' | 'duplicate'. `exceptId`: the template being renamed.
export function nameProblem(store, name, exceptId = null) {
  const n = tidyName(name);
  if (!n) return 'empty';
  if (n.length > MAX_NAME) return 'long';
  if (BUILTIN_TEMPLATES.some((b) => b.name.toLowerCase() === n.toLowerCase())) return 'builtin';
  if ((store.list || []).some((t) => t.id !== exceptId && lc(t.name) === n.toLowerCase())) return 'duplicate';
  return null;
}
function newId(store) {
  const taken = new Set((store.list || []).map((t) => t.id));
  const base = `u-${Date.now().toString(36)}`;
  if (!taken.has(base)) return base;
  for (let n = 1; ; n++) { const id = base + n.toString(36); if (!taken.has(id)) return id; }
}
function freeName(store, wanted) {
  const base = tidyName(wanted).slice(0, MAX_NAME - 4) || 'Imported template';
  if (!nameProblem(store, base)) return { name: base, renamed: false };
  for (let n = 2; ; n++) { const name = `${base} (${n})`; if (!nameProblem(store, name)) return { name, renamed: true }; }
}

// ---- the store: { version, active, list: [{ id, name, settings, doc, producer, contractions }], docTemplate: null | { name, settings, doc, contractions },
//      profilesMigrated?: true (the reader profiles of the earlier preview have been made templates; adoptReaderProfiles) } ----
const OWN_ID = /^u-[0-9a-z]+$/;
function normalizeStore(raw) {
  if (!isObj(raw) || raw.version !== TEMPLATE_STORE_VERSION || !Array.isArray(raw.list)) return null;
  const seen = new Set();
  const list = [];
  for (const t of raw.list) {
    if (!isObj(t) || typeof t.id !== 'string' || !OWN_ID.test(t.id) || seen.has(t.id)) continue;
    const name = tidyName(t.name).slice(0, MAX_NAME);
    if (!name || BUILTIN_TEMPLATES.some((b) => b.name.toLowerCase() === name.toLowerCase()) || list.some((x) => lc(x.name) === name.toLowerCase())) continue;
    seen.add(t.id);
    list.push({ id: t.id, name, settings: cleanTemplateSettings(t.settings), doc: cleanDoc(t.doc), producer: cleanProducer(t.producer), contractions: cleanContractions(t.contractions) });
  }
  let docTemplate = null;
  if (isObj(raw.docTemplate) && tidyName(raw.docTemplate.name)) {
    docTemplate = { name: tidyName(raw.docTemplate.name).slice(0, MAX_NAME), settings: cleanTemplateSettings(raw.docTemplate.settings), doc: isObj(raw.docTemplate.doc) ? cleanDoc(raw.docTemplate.doc) : null, contractions: cleanContractions(raw.docTemplate.contractions) };
  }
  const ids = new Set(['bana', 'ukaaf', ...list.map((t) => t.id), ...(docTemplate ? [DOCUMENT_TEMPLATE_ID] : [])]);
  return { version: TEMPLATE_STORE_VERSION, active: typeof raw.active === 'string' && ids.has(raw.active) ? raw.active : null, list, docTemplate, ...(raw.profilesMigrated === true ? { profilesMigrated: true } : {}) };
}
// The store for the settings in force, made from what was stored (nothing, or damage, or a good store). A store with no usable active template
// takes the built-in of the settings' standard. With nothing stored at all, settings that already differ from their standard's built-in become the
// first own template, "My settings" (Paul, 1 Nov, X1 decision 5), so nothing is lost.
export function migrateStore(stored, settings) {
  const cur = cleanTemplateSettings(settings);
  const norm = normalizeStore(stored);
  if (norm) {
    if (!norm.active) norm.active = builtinFor(cur.mode).id;
    return norm;
  }
  const builtin = builtinFor(cur.mode);
  const store = { version: TEMPLATE_STORE_VERSION, active: builtin.id, list: [], docTemplate: null };
  if (!sameSettings(cur, builtin.settings)) {
    const id = newId(store);
    store.list.push({ id, name: 'My settings', settings: cur, doc: {}, producer: {}, contractions: null });
    store.active = id;
  }
  return store;
}
// Read (and keep) the store; storage that is missing, blocked or damaged gives a store made from the settings, which then just is not kept.
export function loadStore(settings, storage = globalThis.localStorage) {
  let stored = null, text = null;
  try { text = storage ? storage.getItem(TEMPLATE_STORE_KEY) : null; stored = text == null ? null : JSON.parse(text); } catch { stored = null; }
  const store = migrateStore(stored, settings);
  if (text == null || JSON.stringify(store) !== JSON.stringify(stored)) writeStore(store, storage);
  return store;
}
export function writeStore(store, storage = globalThis.localStorage) {
  try { storage.setItem(TEMPLATE_STORE_KEY, JSON.stringify(store)); } catch { /* private mode, blocked, full: the templates then last for this page only */ }
}

export function allTemplates(store) {
  return [...BUILTIN_TEMPLATES, ...store.list, ...(store.docTemplate ? [{ ...store.docTemplate, id: DOCUMENT_TEMPLATE_ID, fromDocument: true }] : [])];
}
export const getTemplate = (store, id) => allTemplates(store).find((t) => t.id === id) || null;
export const activeTemplate = (store) => getTemplate(store, store.active) || builtinFor('ukaaf');
export const isProtected = (t) => !!t && (t.builtin === true || t.id === DOCUMENT_TEMPLATE_ID);

// What differs between the settings in force (and, in the editor, the open document's options) and the active template: the settings keys
// that differ (in TEMPLATE_SETTING_KEYS order), then 'contractions' (relaxed braille on only), then 'doc.<option>' for each document option. `cur.doc` undefined (Quick Mode) leaves the document part out.
export function differences(store, cur) {
  const t = activeTemplate(store);
  const out = TEMPLATE_SETTING_KEYS.filter((k) => !same(cur.settings && cur.settings[k], t.settings[k]));
  // The ticks count only with relaxed braille on (`cur.relaxed`, from ?relaxed=1): with it off they are kept and ignored (Paul, 2 Nov 2026).
  if (cur.relaxed === true && !sameContractions(cur.settings && cur.settings.contractions, t.contractions)) out.push('contractions');
  if (cur.doc !== undefined && t.doc != null) {
    const a = cleanDoc(cur.doc), b = cleanDoc(t.doc);
    for (const k of TEMPLATE_DOC_KEYS) {
      const va = has(a, k) ? a[k] : (fieldByKey(k) || {}).default, vb = has(b, k) ? b[k] : (fieldByKey(k) || {}).default;
      if (!same(va, vb)) out.push(`doc.${k}`);
    }
  }
  return out;
}
export const isModified = (store, cur) => differences(store, cur).length > 0;
const DEFAULT_WORDS = { modified: 'modified', fromDocument: 'from document' };
// The name as the picker shows it: "BANA", "BANA (modified)", "Elsewhere (from document)".
export function templateLabel(store, cur, words = DEFAULT_WORDS) {
  const t = activeTemplate(store);
  const w = { ...DEFAULT_WORDS, ...(words || {}) };
  const parts = [...(t.id === DOCUMENT_TEMPLATE_ID ? [w.fromDocument] : []), ...(isModified(store, cur) ? [w.modified] : [])];
  return parts.length ? `${t.name} (${parts.join(', ')})` : t.name;
}

// ---- changing the store (each returns a new store; the old one is not changed) ----
const withList = (store, list, over = {}) => ({ ...store, list, ...over });
// What Save and Save as keep: the settings and the document part in force, and the producer part - the open document's non-empty producer values over the
// ones the template already has (`existing`); `cur.producer` undefined (Quick Mode, no document) keeps the template's own.
const record = (cur, existing) => ({
  settings: cleanTemplateSettings(cur && cur.settings), doc: cleanDoc(cur && cur.doc),
  producer: { ...cleanProducer(existing), ...cleanProducer(cur && cur.producer) },
  contractions: cleanContractions(cur && cur.settings && cur.settings.contractions),   // the ticks in force, kept even when relaxed braille is off
});

export function saveAs(store, name, cur) {
  const problem = nameProblem(store, name);
  if (problem) return { error: problem };
  const t = { id: newId(store), name: tidyName(name), ...record(cur, activeTemplate(store).producer) };
  return { store: withList(store, [...store.list, t], { active: t.id, docTemplate: null }), template: t };
}
export function saveOver(store, id, cur) {
  const t = getTemplate(store, id);
  if (!t) return { error: 'missing' };
  if (isProtected(t)) return { error: 'builtin' };
  const next = { ...t, ...record(cur, t.producer) };
  return { store: withList(store, store.list.map((x) => (x.id === id ? next : x))), template: next };
}
export function rename(store, id, name) {
  const t = getTemplate(store, id);
  if (!t) return { error: 'missing' };
  if (isProtected(t)) return { error: 'builtin' };
  const problem = nameProblem(store, name, id);
  if (problem) return { error: problem };
  const next = { ...t, name: tidyName(name) };
  return { store: withList(store, store.list.map((x) => (x.id === id ? next : x))), template: next };
}
// Deleting the active template returns to the built-in of its standard.
export function remove(store, id) {
  const t = getTemplate(store, id);
  if (!t) return { error: 'missing' };
  if (isProtected(t)) return { error: 'builtin' };
  return { store: withList(store, store.list.filter((x) => x.id !== id), store.active === id ? { active: builtinFor(t.settings.mode).id } : {}), template: t };
}
export function select(store, id) {
  const t = getTemplate(store, id);
  if (!t) return { error: 'missing' };
  return { store: { ...store, active: id, docTemplate: id === DOCUMENT_TEMPLATE_ID ? store.docTemplate : null }, template: t };
}

// ---- applying ----
// The settings to save when a template is applied: its values, plus the grade (and, when the braille code changes, the language) that code means -
// the pages keep both beside brailleCode (settings-panes.mjs save(), editor.mjs onSet). `current`: the settings in force now.
export function settingsPatch(template, current = {}) {
  const s = { ...template.settings };
  const code = CODES.find((c) => c.id === s.brailleCode);
  const patch = { ...s, contractions: cleanContractions(template.contractions), grade: code ? (String(code.grade).includes('2') ? 'g2' : 'g1') : (current.grade === 'g1' ? 'g1' : 'g2') };
  if (code && current.brailleCode !== s.brailleCode) patch.language = code.lang;
  return patch;
}
// The document options after applying a template's document part: the group's options are replaced, Book details and anything else stay.
export function docPatch(templateDoc, options) {
  const out = {};
  for (const [k, v] of Object.entries(options || {})) if (!TEMPLATE_DOC_KEYS.includes(k)) out[k] = v;
  return { ...out, ...cleanDoc(templateDoc) };
}

// ---- files ----
export function exportTemplate(t) {
  const file = { format: TEMPLATE_FILE_FORMAT, version: TEMPLATE_FILE_VERSION, name: t.name, settings: cleanTemplateSettings(t.settings), doc: cleanDoc(t.doc), producer: cleanProducer(t.producer, { names: false }) };
  const ticks = cleanContractions(t.contractions);
  if (ticks) file.contractions = ticks;   // All: no field, so a file of today is what it was before the ticks existed
  return file;
}
export function exportFileName(name) {
  const base = tidyName(name).replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '').slice(0, MAX_NAME);
  return `${base || 'template'}${TEMPLATE_FILE_SUFFIX}`;
}
// Read a template file's text. { store, template, renamed } (it is added and made active), or { error }: 'too-big' | 'not-json' | 'not-template' | 'newer'.
export function importTemplate(store, text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_CHARS) return { error: 'too-big' };
  let raw;
  try { raw = JSON.parse(text); } catch { return { error: 'not-json' }; }
  if (!isObj(raw) || raw.format !== TEMPLATE_FILE_FORMAT || !Number.isInteger(raw.version) || raw.version < 1 || !isObj(raw.settings)) return { error: 'not-template' };
  if (raw.version > TEMPLATE_FILE_VERSION) return { error: 'newer' };
  const { name, renamed } = freeName(store, has(raw, 'name') ? raw.name : '');
  const t = { id: newId(store), name, settings: cleanTemplateSettings(raw.settings), doc: cleanDoc(raw.doc), producer: cleanProducer(raw.producer, { names: false }), contractions: cleanContractions(raw.contractions) };
  return { store: withList(store, [...store.list, t], { active: t.id, docTemplate: null }), template: t, renamed };
}

// ---- saved with the document ----
// What a saved document records: the active template's name and the settings in force (so a changed setting is saved as it is, not as the template had it),
// and the ticks in force when they are not All (a document of All records what it recorded before the ticks existed).
export function documentTemplate(store, cur) {
  const rec = { name: activeTemplate(store).name, settings: cleanTemplateSettings(cur && cur.settings) };
  const ticks = cleanContractions(cur && cur.settings && cur.settings.contractions);
  if (ticks) rec.contractions = ticks;
  return rec;
}
// A document that records a template is opened. `template` is { name, settings, contractions? } as the reader gives it; `docOptions` the document's own options (the
// editor's), or undefined (Quick Mode). Returns null when the document records nothing usable (nothing is changed), else
// { store, settings, contractions, status }: `settings` the values to apply (null when the file gave none: the settings stay as they are) and
// `contractions` the ticks to apply with them (null = All: a document that records none was made with all of them) and the store with the
// template of that name active (a built-in or an own template, case ignored; "(modified)" shows if the values differ), or, when nobody here has
// that name, a "from document" template that Save As can keep.
export function openedDocument(store, template, docOptions) {
  const name = tidyName(template && template.name).slice(0, MAX_NAME);
  if (!name) return null;
  const given = isObj(template.settings) && TEMPLATE_SETTING_KEYS.some((k) => has(template.settings, k));
  const settings = given ? cleanTemplateSettings(template.settings) : null;
  const contractions = given ? cleanContractions(template.contractions) : undefined;
  const known = allTemplates({ ...store, docTemplate: null }).find((t) => lc(t.name) === name.toLowerCase());
  if (known) return { store: { ...store, active: known.id, docTemplate: null }, settings, contractions, status: 'known', template: known };
  if (!settings) return null;
  const docTemplate = { name, settings, doc: docOptions === undefined ? null : cleanDoc(docOptions), contractions };
  return { store: { ...store, active: DOCUMENT_TEMPLATE_ID, docTemplate }, settings, contractions, status: 'from-document', template: { ...docTemplate, id: DOCUMENT_TEMPLATE_ID } };
}

// ---- the pages' calls (they keep the store in localStorage) ----
// A document that records a template is opened: the store is updated (see openedDocument) and { settings, status, template } is returned for the page to
// put in force (with `contractions`, the ticks), or null when there is nothing to do.
export function adoptDocumentTemplate(record, docOptions, currentSettings, storage = globalThis.localStorage) {
  const r = openedDocument(loadStore(currentSettings, storage), record, docOptions);
  if (r) writeStore(r.store, storage);
  return r;
}
// What a save records: the active template's name, the settings in force and (when not All) the ticks in force.
export function templateForSave(settings, storage = globalThis.localStorage) {
  return documentTemplate(loadStore(settings, storage), { settings });
}
// The active template's name, for the label where braille is made and the status bar's "Not in template: NAME" (relaxed braille).
export function activeTemplateName(settings, storage = globalThis.localStorage) {
  return activeTemplate(loadStore(settings, storage)).name;
}

// ---- the reader profiles of the earlier preview become templates, once (Paul, 2 Nov 2026) ----
// `legacy`: { profiles: [{ name, keys }], active: name | null } as web/reader-profiles.mjs stored them (All is not a profile). Each profile becomes an own
// template: the settings in force plus its ticks, under its name (renamed "NAME (2)" on a clash, or when it equals BANA or UKAAF). The profile that was in use
// makes its template the active one. Returns { store, added: [names], activeId }. A store marked `profilesMigrated` is returned as it is - it happens once.
export function migrateReaderProfiles(store, settings, legacy) {
  if (store.profilesMigrated) return { store, added: [], activeId: null };
  const cur = cleanTemplateSettings(settings);
  let next = { ...store, profilesMigrated: true };
  const added = [];
  let activeId = null;
  for (const p of (legacy && Array.isArray(legacy.profiles) ? legacy.profiles : [])) {
    if (!p || typeof p.name !== 'string' || !tidyName(p.name)) continue;
    const { name } = freeName(next, p.name);
    const t = { id: newId(next), name, settings: cur, doc: {}, producer: {}, contractions: cleanContractions(p.keys) };
    next = withList(next, [...next.list, t]);
    added.push(name);
    if (legacy.active && p.name === legacy.active) activeId = t.id;
  }
  if (activeId) next = { ...next, active: activeId, docTemplate: null };
  return { store: next, added, activeId };
}
// What the old store holds: the profiles other than All, and the one in use (null = All). Reads only; a missing, blocked or damaged value is "none".
export function readLegacyProfiles(storage = globalThis.localStorage) {
  const s = createProfileStore(storage || null);
  const active = s.activeName();
  return { profiles: s.list().filter((p) => !p.locked).map((p) => ({ name: p.name, keys: p.keys })), active: active === ALL_NAME ? null : active };
}
// The pages call this once, before they first read the settings. { migrated: how many templates were made, activeId }. Does nothing when there are no old
// profiles (a computer that never used them, or a first visit: it never touches the stores then) or when it has been done. The old keys stay where they are.
// When a profile was in use, its ticks are put in the stored settings so that the template in force is not "(modified)".
export function adoptReaderProfiles(storage = globalThis.localStorage) {
  const none = { migrated: 0, activeId: null };
  try {
    if (!storage) return none;
    const legacy = readLegacyProfiles(storage);
    if (!legacy.profiles.length) return none;
    let stored = null;
    try { const text = storage.getItem(TEMPLATE_STORE_KEY); stored = text == null ? null : JSON.parse(text); } catch { stored = null; }
    if (isObj(stored) && stored.profilesMigrated === true) return none;
    const rawSettings = storage.getItem(SETTINGS_KEY);
    if (rawSettings == null) return none;                                    // nothing set up yet: the settings are not there to make templates from
    let settings;
    try { settings = sanitizeSettings(JSON.parse(rawSettings || '{}')); } catch { settings = sanitizeSettings({}); }
    const r = migrateReaderProfiles(loadStore(settings, storage), settings, legacy);
    writeStore(r.store, storage);
    if (r.activeId) {
      const t = r.store.list.find((x) => x.id === r.activeId);
      storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings({ ...settings, contractions: t.contractions })));
    }
    return { migrated: r.added.length, activeId: r.activeId };
  } catch { return none; }
}
// The document part a new document (or an opened one that has no options of its own) starts with: the active template's.
export function activeDocPart(settings, storage = globalThis.localStorage) {
  return cleanDoc(activeTemplate(loadStore(settings, storage)).doc);
}
// The active template's producer part (a new document is given the fields it has empty).
export function activeProducer(settings, storage = globalThis.localStorage) {
  return cleanProducer(activeTemplate(loadStore(settings, storage)).producer);
}
