// Templates (task X1; Paul, 1 Nov 2026: "go with your suggestions"; plan: docs/templates-design.md, build step 1 and 2).
// A template is a named set of the settings that shape the braille. These checks need no browser:
//   - the two built-ins are Emboss's own defaults for each standard (exactly sanitizeSettings({ mode })) and cannot be changed;
//   - every key a template carries really changes the braille (the plan's "the build checks each key");
//   - own templates: save as, save over, rename, delete, the active template, "modified", what differs;
//   - export and import (a file an agency can share), including a clash of names, junk, and a newer file;
//   - nothing lost on upgrade: a user's changed settings become their first own template;
//   - a saved document remembers its template and reopens with it (the metas in the DTBook head, round trip through the real writer and reader);
//   - the document part: the "Braille formatting options" a template carries.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = await import('../web/templates.mjs');
const { sanitizeSettings, DEFAULTS, effectiveMathCode } = await import('../web/settings.mjs');
const { formatDocument, formatVolumes } = await import('../format/document.mjs');
const { styledTranslate } = await import('../format/text-style.mjs');
const { exportToNimasXml } = await import('../input/nimas-export.mjs');
const { parseDtbook, parseNimasZip } = await import('../input/parse.mjs');
const { buildNimasPackageZip } = await import('../input/nimas-package.mjs');
const { makeMathToBrf } = await import('../format/node-maths-helper.mjs');
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));

const clone = (x) => JSON.parse(JSON.stringify(x));
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
const pick = (s) => Object.fromEntries(T.TEMPLATE_SETTING_KEYS.map((k) => [k, s[k]]));

// ---- the braille made from a set of template settings, the way the pages make it (app.mjs buildOpts, editor.mjs currentFormatOpts) ----
function opts(s) {
  const table = s.brailleCode === 'en-ueb-g1' ? louis.TABLES.uebG1 : louis.TABLES.uebG2;
  const tr = (t, tf) => louis.translate(t, table, tf || null);
  return {
    mode: s.mode, standard: s.mode, width: s.cells, depth: s.lines, paragraphStyle: s.paragraphStyle, listStyle: s.listStyle, tableFormat: s.tableFormat,
    toc: s.toc, volumePages: s.volumePages,
    interpoint: s.embosserDuplex !== 'single',   // Paul, 4 Nov 2026 (section P-L): interpoint / single-sided is a template setting; the pages read it the way app.mjs / editor.mjs do
    translate: styledTranslate(tr, s.quoteStyle, table === louis.TABLES.uebG2 ? (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null) : null),
    mathToBrf: (seg) => makeMathToBrf(effectiveMathCode(s) === 'nemeth' ? 'bana' : 'ukaaf')(seg),
  };
}
const brf = (doc, s) => quiet(() => formatDocument(clone(doc), opts(s)));
const volumes = (doc, s) => quiet(() => formatVolumes(clone(doc), opts(s)).map((v) => v.brf).join('\u0001'));

// ---------------------------------------------------------------------------------------------------------------
test('the built-ins are BANA and UKAAF: exactly the defaults of each standard, protected', () => {
  const [bana, ukaaf] = T.BUILTIN_TEMPLATES;
  assert.deepEqual([bana.id, bana.name, bana.builtin], ['bana', 'BANA', true]);
  assert.deepEqual([ukaaf.id, ukaaf.name, ukaaf.builtin], ['ukaaf', 'UKAAF', true]);
  // Paul, 1 Nov, X1: "default BANA and default UKAAF". Applying one must give today's sanitizeSettings({ mode }) values, so the braille of anyone on an unmodified built-in is unchanged.
  assert.deepEqual(bana.settings, pick(sanitizeSettings({ mode: 'bana' })));
  assert.deepEqual(ukaaf.settings, pick(sanitizeSettings({ mode: 'ukaaf' })));
  assert.deepEqual([bana.settings.cells, bana.settings.lines, ukaaf.settings.cells, ukaaf.settings.lines], [38, 25, 38, 27]);
  assert.equal(Object.isFrozen(bana) && Object.isFrozen(bana.settings), true, 'a built-in cannot be changed in place');
  assert.deepEqual(bana.doc, {});
  assert.deepEqual(ukaaf.doc, {});
});

test('the keys a template carries: braille-shaping settings only, none of the personal ones', () => {
  // Paul, 4 Nov 2026: one Emboss (EMBOSS-TASKS section P) — P-J "Made for", P-K the embosser model (names kept) and P-L interpoint / single-sided are template keys now (they were personal).
  assert.deepEqual([...T.TEMPLATE_SETTING_KEYS].sort(), ['brailleCode', 'cells', 'embosser', 'embosserDuplex', 'lines', 'listStyle', 'madeFor', 'mathCode', 'mode', 'paragraphStyle', 'quoteStyle', 'tableFormat', 'toc', 'volumePages']);
  for (const personal of ['uiLanguage', 'asciiBraille', 'simpleMode', 'connectionType', 'baudRate', 'networkHost', 'ttsRate', 'transcriberTools', 'expertHardware', 'showTitleField', 'showExplanationBar', 'brailleCellW', 'statusScale', 'sixKeyOn', 'recentCodes', 'tactileGraphics']) {
    assert.ok(!T.TEMPLATE_SETTING_KEYS.includes(personal), `${personal} is personal, not part of a template`);
  }
  // the document part is the Settings dialog's "Braille formatting options" group, and nothing from Book details (the tp* fields)
  assert.ok(T.TEMPLATE_DOC_KEYS.includes('verseKeep') && T.TEMPLATE_DOC_KEYS.includes('endMarkers') && T.TEMPLATE_DOC_KEYS.includes('tocHeading'));
  assert.ok(!T.TEMPLATE_DOC_KEYS.some((k) => /^tp[A-Z]/.test(k)), 'Book details are about one book, not a job setup');
  assert.equal(T.TEMPLATE_DOC_KEYS.length, 22);
  // dropped from the plan's list because nothing reads them, so they change no braille: includeCovers (no exporter calls format/cover.mjs), includeSpineLabels, codeIndicators
  for (const dead of ['includeCovers', 'includeSpineLabels', 'codeIndicators']) assert.ok(!T.TEMPLATE_SETTING_KEYS.includes(dead), dead);
});

// ---- the plan: "the build checks each key really changes the braille" ----
const PARAS = { title: 'Birds', blocks: [{ type: 'heading', level: 1, text: 'Birds' }, { type: 'para', text: 'The quick brown fox jumps over the lazy dog because the dog was far too slow to notice. Another paragraph begins here and runs on for quite a while so that it wraps.' }, { type: 'para', text: 'A second paragraph, also long enough to wrap onto a second line of braille.' }] };
const LONG = { title: 'Long', blocks: [{ type: 'heading', level: 1, text: 'Long' }, ...Array.from({ length: 40 }, (_, i) => ({ type: 'para', text: `Paragraph number ${i + 1} has some words in it.` }))] };
const LIST = { title: 'List', blocks: [{ type: 'heading', level: 1, text: 'List' }, { type: 'list', ordered: false, items: [{ text: 'first item' }, { text: 'second item' }, { text: 'third item' }] }] };
const TABLE = { title: 'Table', blocks: [{ type: 'heading', level: 1, text: 'Table' }, { type: 'table', rows: [[{ text: 'Name' }, { text: 'Colour' }, { text: 'Size' }], [{ text: 'apple' }, { text: 'red' }, { text: 'small' }], [{ text: 'melon' }, { text: 'green' }, { text: 'large' }]] }] };
const QUOTE = { title: 'Q', blocks: [{ type: 'heading', level: 1, text: 'Q' }, { type: 'para', text: "She said ‘hello there’ and left." }] };
const HEADINGS = { title: 'Book', blocks: [{ type: 'heading', level: 1, text: 'One' }, { type: 'para', text: 'Text of one.' }, { type: 'heading', level: 1, text: 'Two' }, { type: 'para', text: 'Text of two.' }] };
const FACING = { blocks: [{ type: 'table', format: 'facing', title: 'Table 3', headers: ['Country', '1900', '1910', '1920', '1930', '1940', '1950', '1960', '1970'], rows: Array.from({ length: 6 }, (_, i) => [`Land ${i + 1}`, ...Array.from({ length: 8 }, (_, k) => `${(i * 7 + k * 13) % 90 + 10}.${k}`)]) }] };
const MATHS = { title: 'M', blocks: [{ type: 'heading', level: 1, text: 'M' }, { type: 'para', segments: [{ type: 'text', text: 'Solve ' }, { type: 'math', mathml: '<math><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><mi>x</mi></math>' }] }] };

const CHANGES = {
  mode: ['bana', 'ukaaf', PARAS],
  brailleCode: ['en-ueb-g2', 'en-ueb-g1', PARAS],
  mathCode: ['ueb', 'nemeth', MATHS],
  cells: [38, 24, PARAS],
  lines: [25, 12, LONG],
  quoteStyle: ['faithful', 'exchange', QUOTE],
  listStyle: ['spaced', 'compact', LIST, { mode: 'ukaaf' }],
  paragraphStyle: ['indented', 'block', PARAS],
  tableFormat: ['listed', 'columnar', TABLE],
  toc: [false, true, HEADINGS],
  volumePages: [0, 2, LONG, { cells: 24 }],
  // Paul, 4 Nov 2026 (section P): a Monarch is 32 x 10 (the device fixes the page, so the settings go through sanitizeSettings as the pages' store does)
  madeFor: ['paper', 'monarch', LONG],
  // interpoint starts a facing-pages table on an even (left-hand) page, so a blank page is added (BANA 11.13.1b); only BANA chooses facing pages
  embosserDuplex: ['double', 'single', FACING, { mode: 'bana' }],
};
// Keys a template CARRIES that change no text. Paul, 4 Nov 2026 (EMBOSS-TASKS P-K): "keep the embosser names — the model says what graphics are available, and at what
// level", so the model is saved with the template, the document and the exported file; but while writing to embossers is put aside (P-HW) nothing reads it to make
// the braille (it decided the page size before; the page size presets do that now). So it is listed here with that reason instead of in CHANGES above.
const CARRIED_ONLY = { embosser: ['generic', 'braillo', PARAS, 'the model decides a job\'s graphics targets (P-K/P-E), not its text; the page size comes from the page size presets'] };
for (const key of T.TEMPLATE_SETTING_KEYS) {
  if (CARRIED_ONLY[key]) continue;
  test(`a template's "${key}" changes the braille`, () => {
    const [a, b, doc, base = {}] = CHANGES[key];
    const s = { ...T.BUILTIN_TEMPLATES[1].settings, ...base };
    const make = key === 'volumePages' ? volumes : brf;
    const set = (v) => (key === 'madeFor' ? pick(sanitizeSettings({ ...s, [key]: v })) : { ...s, [key]: v });
    const outA = make(doc, set(a)), outB = make(doc, set(b));
    assert.notEqual(outA, outB, `${key} ${a} and ${b} gave the same braille`);
  });
}
for (const [key, [a, b, doc, why]] of Object.entries(CARRIED_ONLY)) {
  test(`a template's "${key}" is carried but changes no text (${why})`, () => {
    assert.ok(T.TEMPLATE_SETTING_KEYS.includes(key));
    assert.ok(T.TEMPLATE_KEYS_NOT_CHANGING_BRAILLE.includes(key));
    const s = { ...T.BUILTIN_TEMPLATES[1].settings };
    assert.equal(brf(doc, { ...s, [key]: a }), brf(doc, { ...s, [key]: b }), `${key} must not change the braille`);
    // it does not change the page size either: sanitizeSettings keeps Cells and Lines whatever the model
    assert.deepEqual([sanitizeSettings({ cells: 38, lines: 27, [key]: b }).cells, sanitizeSettings({ cells: 38, lines: 27, [key]: b }).lines], [38, 27]);
  });
}
test('every key has a braille check above (or is listed as carried only)', () => {
  assert.deepEqual([...Object.keys(CHANGES), ...Object.keys(CARRIED_ONLY)].sort(), [...T.TEMPLATE_SETTING_KEYS].sort());
  assert.deepEqual([...T.TEMPLATE_KEYS_NOT_CHANGING_BRAILLE].sort(), Object.keys(CARRIED_ONLY).sort(), 'the list the code keeps and the list the test checks agree');
});

test('Made for (Paul, 4 Nov 2026, P-J): Monarch is 32 x 10, DotPad 20 x 10, Paper keeps the page given; an older "embosser: monarch" setup becomes Made for Monarch', () => {
  const p = (o) => sanitizeSettings(o);
  assert.deepEqual([p({ madeFor: 'monarch', cells: 38, lines: 25 }).cells, p({ madeFor: 'monarch', cells: 38, lines: 25 }).lines], [32, 10]);
  assert.deepEqual([p({ madeFor: 'dotpad' }).cells, p({ madeFor: 'dotpad' }).lines], [20, 10]);
  assert.deepEqual([p({ madeFor: 'paper', cells: 40, lines: 25 }).cells, p({ madeFor: 'paper', cells: 40, lines: 25 }).lines], [40, 25]);
  assert.equal(p({}).madeFor, 'paper');
  assert.equal(p({ madeFor: 'abacus' }).madeFor, 'paper');
  const old = p({ embosser: 'monarch', cells: 32, lines: 10 });
  assert.equal(old.madeFor, 'monarch');
  assert.equal(old.embosser, 'generic', 'the paper model is not the Monarch');
  assert.equal(p({ embosser: 'dotpad' }).madeFor, 'dotpad');
  // the model no longer sets the page size (P-K): a ViewPlus on the UKAAF page is still 38 x 27
  assert.deepEqual([p({ embosser: 'viewplus', mode: 'ukaaf' }).cells, p({ embosser: 'viewplus', mode: 'ukaaf' }).lines], [38, 27]);
  assert.deepEqual([p({ embosser: 'braillo', mode: 'bana' }).cells, p({ embosser: 'braillo', mode: 'bana' }).lines], [38, 25]);
  assert.equal(p({ embosser: 'viewplus' }).embosser, 'viewplus');
  assert.equal(p({ embosserDuplex: 'single' }).embosserDuplex, 'single');
  assert.equal(p({ embosserDuplex: 'weird' }).embosserDuplex, 'double');
  assert.equal('tactileRip' in p({ tactileRip: true }), false, 'the Tactile graphics RIP setting is gone (P-F)');
  // a template made for a Monarch applies a 32 x 10 page whatever Cells and Lines the file said
  const t = T.cleanTemplateSettings({ mode: 'bana', madeFor: 'monarch', cells: 40, lines: 25 });
  assert.deepEqual([t.madeFor, t.cells, t.lines], ['monarch', 32, 10]);
  // the three new keys survive the document record and a file, and an older template without them takes the built-in values
  const doc = T.cleanTemplateSettings({ mode: 'bana', madeFor: 'dotpad', embosser: 'index', embosserDuplex: 'single' });
  assert.deepEqual([doc.madeFor, doc.embosser, doc.embosserDuplex, doc.cells, doc.lines], ['dotpad', 'index', 'single', 20, 10]);
  const old2 = T.cleanTemplateSettings({ mode: 'bana', cells: 40, lines: 25 });
  assert.deepEqual([old2.madeFor, old2.embosser, old2.embosserDuplex], ['paper', 'generic', 'double']);
});

// ---------------------------------------------------------------------------------------------------------------
const current = (over = {}) => ({ settings: { ...pick(sanitizeSettings({ mode: 'ukaaf' })), ...over }, doc: undefined });
const fresh = (over = {}, doc) => T.migrateStore(null, { ...pick(sanitizeSettings({ mode: 'ukaaf' })), ...over }, doc);

test('first use: a user on the built-in settings gets the built-in as the active template and nothing else', () => {
  const st = fresh();
  assert.equal(st.active, 'ukaaf');
  assert.deepEqual(st.list, []);
  assert.equal(T.activeTemplate(st).name, 'UKAAF');
  assert.equal(T.isModified(st, current()), false);
  assert.deepEqual(T.differences(st, current()), []);
  const bana = fresh(pick(sanitizeSettings({ mode: 'bana' })));
  assert.equal(bana.active, 'bana');
});

test('upgrade: a user whose settings already differ gets them as their first own template, "My settings", active (Paul, 1 Nov, X1 decision 5)', () => {
  const st = fresh({ mode: 'bana', cells: 40, lines: 25, paragraphStyle: 'block' });
  assert.equal(st.list.length, 1);
  assert.equal(st.list[0].name, 'My settings');
  assert.equal(st.active, st.list[0].id);
  assert.match(st.list[0].id, /^u-[0-9a-z]+$/);
  assert.equal(st.list[0].settings.cells, 40);
  assert.equal(st.list[0].settings.paragraphStyle, 'block');
  assert.equal(st.list[0].settings.mode, 'bana');
  assert.equal(T.isModified(st, current({ mode: 'bana', cells: 40, lines: 25, paragraphStyle: 'block' })), false);
  // the same migration run again changes nothing
  assert.deepEqual(T.migrateStore(st, current().settings), st);
});

test('a stored store that is damaged is made again from the settings in force', () => {
  for (const bad of [null, undefined, '', 'x', 5, [], {}, { version: 1 }, { version: 1, active: 'nope', list: 'x' }]) {
    const st = T.migrateStore(bad, current().settings);
    assert.ok(st && Array.isArray(st.list) && ['bana', 'ukaaf'].includes(st.active) || st.list.length, JSON.stringify(bad));
  }
  // an active id that is gone falls back to the built-in of the settings' standard
  const st = T.migrateStore({ version: 1, active: 'u-gone', list: [] }, current({ mode: 'bana', lines: 25 }).settings);
  assert.equal(st.active, 'bana');
});

test('modified: a changed setting shows as "BANA (modified)" and says what changed', () => {
  const st = fresh(pick(sanitizeSettings({ mode: 'bana' })));
  const cur = { settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: 40, toc: true }, doc: undefined };
  assert.equal(T.isModified(st, cur), true);
  assert.deepEqual(T.differences(st, cur), ['cells', 'toc']);
  assert.equal(T.templateLabel(st, cur), 'BANA (modified)');
  assert.equal(T.templateLabel(st, { settings: pick(sanitizeSettings({ mode: 'bana' })) }), 'BANA');
  // numbers typed as text in a field are the same number
  assert.equal(T.isModified(st, { settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: '38' } }), false);
});

test('Save As: a name of its own, never over a built-in; the new template is active and holds the settings in force', () => {
  let st = fresh(pick(sanitizeSettings({ mode: 'bana' })));
  const cur = { settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: 40 }, doc: { endMarkers: true } };
  for (const bad of ['', '   ', 'BANA', 'bana', ' UKAAF ', 'x'.repeat(61)]) {
    const r = T.saveAs(st, bad, cur);
    assert.ok(r.error, `"${bad}" is refused`);
    assert.equal(r.store, undefined);
  }
  assert.equal(T.saveAs(st, 'BANA', cur).error, 'builtin');
  assert.equal(T.saveAs(st, '', cur).error, 'empty');
  assert.equal(T.saveAs(st, 'x'.repeat(61), cur).error, 'long');
  const r = T.saveAs(st, '  Agency   house  style ', cur);
  assert.equal(r.error, undefined);
  st = r.store;
  assert.equal(r.template.name, 'Agency house style', 'spaces tidied');
  assert.equal(st.active, r.template.id);
  assert.equal(st.list.length, 1);
  assert.equal(st.list[0].settings.cells, 40);
  assert.deepEqual(st.list[0].doc, { endMarkers: true });
  assert.equal(T.isModified(st, cur), false);
  assert.equal(T.saveAs(st, 'agency HOUSE style', cur).error, 'duplicate', 'a name of an own template is taken (any case)');
  assert.deepEqual(T.nameProblem(st, 'Agency house style', r.template.id), null, 'its own name is fine when renaming it');
});

test('Save: over an own template only, never a built-in', () => {
  let st = fresh(pick(sanitizeSettings({ mode: 'bana' })));
  assert.equal(T.saveOver(st, 'bana', current()).error, 'builtin');
  assert.equal(T.saveOver(st, 'ukaaf', current()).error, 'builtin');
  assert.equal(T.saveOver(st, 'u-none', current()).error, 'missing');
  const mine = T.saveAs(st, 'Mine', { settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: 36 } });
  st = mine.store;
  const cur = { settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: 32 } };
  assert.equal(T.isModified(st, cur), true);
  const r = T.saveOver(st, mine.template.id, cur);
  assert.equal(r.store.list[0].settings.cells, 32);
  assert.equal(r.store.list[0].name, 'Mine');
  assert.equal(T.isModified(r.store, cur), false);
  assert.equal(st.list[0].settings.cells, 36, 'the earlier store is not changed in place');
});

test('Rename and Delete: own templates only', () => {
  let st = fresh();
  const a = T.saveAs(st, 'Alpha', current({ cells: 30 })); st = a.store;
  const b = T.saveAs(st, 'Beta', current({ cells: 32 })); st = b.store;
  assert.equal(T.rename(st, 'bana', 'Z').error, 'builtin');
  assert.equal(T.remove(st, 'ukaaf').error, 'builtin');
  assert.equal(T.rename(st, a.template.id, 'beta').error, 'duplicate');
  assert.equal(T.rename(st, a.template.id, 'UKAAF').error, 'builtin');
  const r = T.rename(st, a.template.id, 'Alpha 2');
  assert.equal(r.store.list.find((x) => x.id === a.template.id).name, 'Alpha 2');
  assert.equal(r.store.active, b.template.id, 'renaming does not change which is active');
  // deleting the active own template returns to the built-in of its standard
  const d = T.remove(st, b.template.id);
  assert.equal(d.store.active, 'ukaaf');
  assert.equal(d.store.list.length, 1);
  const bana = T.saveAs(fresh(pick(sanitizeSettings({ mode: 'bana' }))), 'Banaish', { settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: 36 } });
  assert.equal(T.remove(bana.store, bana.template.id).store.active, 'bana');
  // deleting one that is not active keeps the active one
  assert.equal(T.remove(st, a.template.id).store.active, b.template.id);
});

test('select: makes a template active and gives the settings to apply, cleaned', () => {
  let st = fresh();
  const mine = T.saveAs(st, 'Mine', current({ mode: 'bana', cells: 36, lines: 25 })); st = mine.store;
  const r = T.select(st, 'bana');
  assert.equal(r.store.active, 'bana');
  assert.deepEqual(r.template.settings, pick(sanitizeSettings({ mode: 'bana' })));
  assert.equal(T.select(st, 'u-none').error, 'missing');
  // the patch to save: the template's settings plus the grade the braille code means (the pages keep both)
  const patch = T.settingsPatch(r.template, { brailleCode: 'en-ueb-g2', language: 'ueb', grade: 'g2' });
  assert.deepEqual(pick(patch), r.template.settings);
  const g1 = T.settingsPatch({ settings: { ...r.template.settings, brailleCode: 'en-ueb-g1' } }, { brailleCode: 'en-ueb-g2', language: 'ueb', grade: 'g2' });
  assert.equal(g1.grade, 'g1');
  assert.equal(g1.brailleCode, 'en-ueb-g1');
});

test('the document part: only the Braille formatting options, only values that differ from the default, cleaned', () => {
  assert.deepEqual(T.cleanDoc({ endMarkers: true, verseKeep: false, tocHeading: '  Index of things ', listPageRules: true, docEndMarker: true, tpSeries: 'x', nonsense: 1 }), { endMarkers: true, verseKeep: false, tocHeading: 'Index of things' });
  assert.deepEqual(T.cleanDoc({ lineIndicator: 'toolong' }), {}, 'a line indicator that is not 1-3 ASCII characters is dropped');
  assert.deepEqual(T.cleanDoc({ lineIndicator: '_' }), { lineIndicator: '_' });
  assert.deepEqual(T.cleanDoc(null), {});
  assert.deepEqual(T.cleanDoc('x'), {});
  const st = fresh();
  const cur = { settings: current().settings, doc: { endMarkers: true } };
  assert.equal(T.isModified(st, cur), true, 'a document option differs from the built-in');
  assert.deepEqual(T.differences(st, cur), ['doc.endMarkers']);
  assert.equal(T.isModified(st, { settings: current().settings, doc: {} }), false);
  assert.equal(T.isModified(st, { settings: current().settings, doc: undefined }), false, 'Quick Mode has no document part: only the settings are compared');
  assert.deepEqual(T.docPatch({ endMarkers: true }, { verseKeep: false, tpSeries: 'S', endMarkers: false }), { tpSeries: 'S', endMarkers: true }, 'applying replaces the document options of the group and leaves Book details alone');
});

// ---- the producer part (Paul, 2 Nov 2026, option A): the title-page facts that are the same on every job ----
const PROD = { tpAgency: 'Sensory Braille', tpAgencyLocation: 'Leeds', tpCountry: 'UK', tpReproductionNotice: 'Reproduced with permission.', tpTranscriber: 'Ann', tpProofreader: 'Bob', tpTactileSpecialist: 'Cy' };
test('producer part: exactly the agreed fields; the book\'s own details are not in it', () => {
  assert.deepEqual([...T.PRODUCER_KEYS].sort(), ['tpAgency', 'tpAgencyLocation', 'tpCountry', 'tpProofreader', 'tpReproductionNotice', 'tpTactileSpecialist', 'tpTranscriber']);
  assert.deepEqual([...T.PRODUCER_NAME_KEYS].sort(), ['tpProofreader', 'tpTactileSpecialist', 'tpTranscriber']);
  for (const own of ['tpSeries', 'tpGradeLevel', 'tpSubtitle', 'tpEdition', 'tpTranslator', 'tpEditors', 'tpPublishedBy', 'tpPublisherCity', 'tpPublisherUrl', 'tpCopyright', 'tpIsbn', 'tpPrintingHistory', 'tpYear', 'tpBrailleCode']) assert.ok(!T.PRODUCER_KEYS.includes(own), own);
  assert.deepEqual(T.cleanProducer({ ...PROD, tpSeries: 'x', tpCountry: 'Mars', tpAgency: '  ', nonsense: 1 }), { tpAgencyLocation: 'Leeds', tpReproductionNotice: 'Reproduced with permission.', tpTranscriber: 'Ann', tpProofreader: 'Bob', tpTactileSpecialist: 'Cy' });
  assert.deepEqual(T.BUILTIN_TEMPLATES[0].producer, {});
  assert.deepEqual(T.BUILTIN_TEMPLATES[1].producer, {});
});

test('producer rule 1: applying fills only EMPTY producer fields and never overwrites a value the document has', () => {
  assert.deepEqual(T.producerPatch({ tpAgency: 'Template Agency', tpCountry: 'UK' }, { tpSeries: 'S' }), { tpSeries: 'S', tpAgency: 'Template Agency', tpCountry: 'UK' });
  assert.deepEqual(T.producerPatch({ tpAgency: 'Template Agency', tpAgencyLocation: 'Leeds' }, { tpAgency: 'Own Agency', tpAgencyLocation: '   ' }), { tpAgency: 'Own Agency', tpAgencyLocation: 'Leeds' }, 'a value the document has stays; a blank one is filled');
  assert.deepEqual(T.producerPatch({ tpAgency: 'X' }, undefined), { tpAgency: 'X' });
  assert.deepEqual(T.producerPatch(undefined, { tpAgency: 'Own' }), { tpAgency: 'Own' });
  // opening a document never changes its producer fields: what opening a document gives the page carries no producer part
  const st = fresh();
  const r = T.openedDocument(st, { name: 'UKAAF', settings: current().settings }, { tpAgency: 'Doc agency' });
  assert.ok(!('producer' in r) && !('doc' in r));
  assert.deepEqual(Object.keys(T.documentTemplate(st, { settings: current().settings, producer: PROD })).sort(), ['name', 'settings'], 'a saved document records no producer part (it has its own title-page fields)');
});

test('producer rule 2: it never counts toward "(modified)"; Save and Save as take the document\'s non-empty values, Quick Mode keeps the template\'s own', () => {
  let st = fresh();
  const a = T.saveAs(st, 'Agency job', { settings: current().settings, doc: {}, producer: { tpAgency: 'First', tpTranscriber: 'Ann' } });
  st = a.store;
  assert.deepEqual(a.template.producer, { tpAgency: 'First', tpTranscriber: 'Ann' });
  const differing = { settings: current().settings, doc: {}, producer: { tpAgency: 'Something else', tpCountry: 'US' } };
  assert.equal(T.isModified(st, differing), false);
  assert.deepEqual(T.differences(st, differing), []);
  assert.equal(T.templateLabel(st, differing), 'Agency job');
  // Save: the document's non-empty values replace; empty ones leave the template's alone
  const saved = T.saveOver(st, a.template.id, { settings: current().settings, doc: {}, producer: { tpAgency: 'Second', tpAgencyLocation: '', tpCountry: 'UK' } });
  assert.deepEqual(saved.template.producer, { tpAgency: 'Second', tpTranscriber: 'Ann', tpCountry: 'UK' });
  // Quick Mode has no document: Save keeps the template's producer part; Save as copies the active template's
  const quickSave = T.saveOver(st, a.template.id, { settings: current({ cells: 33 }).settings });
  assert.deepEqual(quickSave.template.producer, { tpAgency: 'First', tpTranscriber: 'Ann' });
  const quickAs = T.saveAs(st, 'Copy', { settings: current({ cells: 33 }).settings });
  assert.deepEqual(quickAs.template.producer, { tpAgency: 'First', tpTranscriber: 'Ann' });
  // a built-in has none, so Save as from it takes only the document's
  const fromBuiltin = T.saveAs(fresh(), 'New', { settings: current().settings, doc: {}, producer: { tpAgency: 'A' } });
  assert.deepEqual(fromBuiltin.template.producer, { tpAgency: 'A' });
  assert.deepEqual(T.saveAs(fresh(), 'None', { settings: current().settings }).template.producer, {});
});

test('producer rule 3: an exported file leaves out the people\'s names, keeps agency, place, country and notice; import never brings names', () => {
  const st = T.saveAs(fresh(), 'Whole', { settings: current().settings, doc: {}, producer: PROD });
  assert.deepEqual(st.template.producer, PROD, 'the template on this computer keeps the names');
  const file = T.exportTemplate(st.template);
  assert.deepEqual(file.producer, { tpAgency: 'Sensory Braille', tpAgencyLocation: 'Leeds', tpCountry: 'UK', tpReproductionNotice: 'Reproduced with permission.' });
  assert.ok(!/Ann|Bob|Cy\b|tpTranscriber|tpProofreader|tpTactileSpecialist/.test(JSON.stringify(file)));
  // a file that has names anyway: import drops them
  const r = T.importTemplate(fresh(), JSON.stringify({ format: 'emboss-template', version: 1, name: 'Shared', settings: {}, producer: PROD }));
  assert.deepEqual(r.template.producer, file.producer);
  // an older file with no producer part imports as none
  assert.deepEqual(T.importTemplate(fresh(), JSON.stringify({ format: 'emboss-template', version: 1, name: 'Old', settings: {} })).template.producer, {});
});

test('producer: kept in the store; a damaged store loses nothing it can read', () => {
  const st = T.saveAs(fresh(), 'Keep', { settings: current().settings, doc: {}, producer: PROD });
  const again = T.migrateStore(JSON.parse(JSON.stringify(st.store)), current().settings);
  assert.deepEqual(again.list[0].producer, PROD);
  const bad = JSON.parse(JSON.stringify(st.store)); bad.list[0].producer = { tpAgency: 5, tpCountry: 'Mars', evil: 'x' };
  assert.deepEqual(T.migrateStore(bad, current().settings).list[0].producer, {});
});

test('export: a file with the name, the settings and the document part; the file name is safe', () => {
  const st = T.saveAs(fresh(), 'House: style/1', { settings: current({ cells: 30 }).settings, doc: { endMarkers: true } });
  const t = st.template;
  const file = T.exportTemplate(t);
  assert.equal(file.format, 'emboss-template');
  assert.equal(file.version, 1);
  assert.equal(file.name, 'House: style/1');
  assert.equal(file.settings.cells, 30);
  assert.deepEqual(file.doc, { endMarkers: true });
  assert.equal(T.exportFileName(t.name), 'House- style-1.emboss-template.json');
  assert.equal(T.exportFileName('  '), 'template.emboss-template.json');
  assert.equal(T.exportFileName('BANA'), 'BANA.emboss-template.json');
  assert.deepEqual(Object.keys(file).sort(), ['doc', 'format', 'name', 'producer', 'settings', 'version'], 'room for a later readerProfile: nothing else in the file today');
});

test('import: known keys only, cleaned; becomes active; a clash of names is renamed, never BANA or UKAAF', () => {
  let st = fresh();
  const text = JSON.stringify({ format: 'emboss-template', version: 1, name: 'Agency', settings: { mode: 'bana', cells: 99999, lines: 25, paragraphStyle: 'block', uiLanguage: 'fr', embosser: 'braillo', evil: '<script>', brailleCode: 'en-ueb-g1' }, doc: { endMarkers: true, tpSeries: 'no', nonsense: true } });
  let r = T.importTemplate(st, text);
  assert.equal(r.error, undefined);
  st = r.store;
  assert.equal(r.template.name, 'Agency');
  assert.equal(st.active, r.template.id);
  const s = r.template.settings;
  assert.deepEqual(Object.keys(s).sort(), [...T.TEMPLATE_SETTING_KEYS].sort(), 'every key is there, none else');
  assert.equal(s.cells, 60, 'cleaned like any setting');
  assert.equal(s.paragraphStyle, 'block');
  assert.equal(s.embosser, 'braillo', 'the embosser model is carried (P-K)');
  assert.equal(s.brailleCode, 'en-ueb-g1');
  assert.equal(s.listStyle, T.BUILTIN_TEMPLATES[0].settings.listStyle, 'a key the file leaves out takes the built-in value for its standard');
  assert.deepEqual(r.template.doc, { endMarkers: true });
  r = T.importTemplate(st, text);
  assert.equal(r.template.name, 'Agency (2)');
  assert.equal(r.renamed, true);
  r = T.importTemplate(r.store, text);
  assert.equal(r.template.name, 'Agency (3)');
  r = T.importTemplate(st, JSON.stringify({ format: 'emboss-template', version: 1, name: 'BANA', settings: {} }));
  assert.equal(r.template.name, 'BANA (2)');
  assert.equal(r.store.list.some((x) => x.name === 'BANA'), false);
  // no name: a name is made
  r = T.importTemplate(st, JSON.stringify({ format: 'emboss-template', version: 1, settings: { mode: 'ukaaf' } }));
  assert.equal(r.template.name, 'Imported template');
});

test('import: a file that is not a template gets a clear reason', () => {
  const st = fresh();
  assert.equal(T.importTemplate(st, 'not json at all').error, 'not-json');
  assert.equal(T.importTemplate(st, '').error, 'not-json');
  assert.equal(T.importTemplate(st, '[1,2]').error, 'not-template');
  assert.equal(T.importTemplate(st, '{"hello":1}').error, 'not-template');
  assert.equal(T.importTemplate(st, JSON.stringify({ format: 'something-else', version: 1 })).error, 'not-template');
  assert.equal(T.importTemplate(st, JSON.stringify({ format: 'emboss-template', version: 99, name: 'x', settings: {} })).error, 'newer');
  assert.equal(T.importTemplate(st, JSON.stringify({ format: 'emboss-template', version: 1, name: 'x', settings: 'no' })).error, 'not-template');
  assert.equal(T.importTemplate(st, 'x'.repeat(300000)).error, 'too-big');
  // an __proto__ key in the file does not reach any object
  const evil = T.importTemplate(st, '{"format":"emboss-template","version":1,"name":"E","settings":{"__proto__":{"polluted":1},"mode":"bana"},"doc":{"__proto__":{"polluted":1}}}');
  assert.equal(evil.error, undefined);
  assert.equal({}.polluted, undefined);
});

// ---- saved with the document ----
test('the document records its template: two metas in the head, and the reader gives them back', () => {
  const cur = { settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: 36 }, doc: {} };
  const st = T.migrateStore(null, cur.settings);   // "My settings" made from the changed settings
  const rec = T.documentTemplate(st, cur);
  assert.equal(rec.name, 'My settings');
  assert.deepEqual(rec.settings, cur.settings);
  const model = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'para', text: 'Body.' }], template: rec };
  const xml = quiet(() => exportToNimasXml(clone(model), { uid: 'tpl-test', date: '2026-01-01' }));
  assert.match(xml, /<meta name="emboss-template" content="My settings" \/>/);
  const m = /<meta name="emboss-template-settings" content="([^"]*)" \/>/.exec(xml);
  assert.ok(m, 'the settings meta');
  assert.deepEqual(JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')), cur.settings);
  const back = quiet(() => parseDtbook(xml));
  assert.deepEqual(back.template, { name: 'My settings', settings: cur.settings });
  // written again from what was read: the same bytes
  const again = quiet(() => exportToNimasXml({ ...clone(back), template: back.template }, { uid: 'tpl-test', date: '2026-01-01' }));
  assert.equal(again, xml, 'a second round trip is byte-identical');
  // a document with no template writes nothing
  const plain = quiet(() => exportToNimasXml({ title: 'T', blocks: [{ type: 'para', text: 'x' }] }, { uid: 'u', date: '2026-01-01' }));
  assert.ok(!/emboss-template/.test(plain));
  assert.equal(quiet(() => parseDtbook(plain)).template, undefined);
});

test('a NIMAS package keeps the template too', async () => {
  const rec = { name: 'Package house', settings: { ...pick(sanitizeSettings({ mode: 'bana' })), cells: 33 } };
  const zip = await buildNimasPackageZip({ title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'para', text: 'Body.' }], template: rec }, { mode: 'bana' });
  const back = await parseNimasZip(zip);
  assert.deepEqual(back.template, rec);
});

test('the exporter and the reader write and read the same two meta names the template code names', async () => {
  const fs = await import('node:fs');
  const exp = fs.readFileSync(path.join(EMBOSS, 'input', 'nimas-export.mjs'), 'utf8');
  const par = fs.readFileSync(path.join(EMBOSS, 'input', 'parse.mjs'), 'utf8');
  for (const name of [T.TEMPLATE_META_NAME, T.TEMPLATE_META_SETTINGS]) {
    assert.ok(exp.includes(`name="${name}"`), `nimas-export.mjs writes ${name}`);
    assert.ok(par.includes(`'${name}'`), `parse.mjs reads ${name}`);
  }
});

test('an odd name or damaged settings in a file never break the reader; what is read is cleaned by the template code', () => {
  const xml = quiet(() => exportToNimasXml({ title: 'T', blocks: [{ type: 'para', text: 'x' }], template: { name: 'Tom & "Jerry" <b>', settings: { cells: 31 } } }, { uid: 'u', date: '2026-01-01' }));
  assert.equal(quiet(() => parseDtbook(xml)).template.name, 'Tom & "Jerry" <b>');
  const broken = xml.replace(/(<meta name="emboss-template-settings" content=")[^"]*"/, '$1{not json"');
  const r = quiet(() => parseDtbook(broken));
  assert.equal(r.template.name, 'Tom & "Jerry" <b>');
  assert.deepEqual(r.template.settings, {}, 'unreadable settings read as none');
  assert.deepEqual(T.cleanTemplateSettings({ cells: 31, mode: 'bana', junk: 1 }).cells, 31);
});

test('reopening: a template of that name becomes active (modified if the values differ); otherwise it is "NAME (from document)"', () => {
  const banaSettings = pick(sanitizeSettings({ mode: 'bana' }));
  let st = fresh();
  // a built-in's name, values the same
  let r = T.openedDocument(st, { name: 'BANA', settings: banaSettings }, undefined);
  assert.equal(r.store.active, 'bana');
  assert.equal(T.isModified(r.store, { settings: r.settings }), false);
  assert.deepEqual(pick(r.settings), banaSettings);
  // an own template of that name, but the document's values differ: active, shown modified
  const mine = T.saveAs(st, 'House', current({ cells: 30 })); st = mine.store;
  r = T.openedDocument(st, { name: 'house', settings: { ...current().settings, cells: 34 } }, undefined);
  assert.equal(r.store.active, mine.template.id);
  assert.equal(T.isModified(r.store, { settings: r.settings }), true);
  assert.equal(r.settings.cells, 34, 'the document\'s own values are what is applied');
  // a name nobody here has
  r = T.openedDocument(st, { name: 'Elsewhere', settings: { ...current().settings, cells: 29 } }, { endMarkers: true });
  assert.equal(r.store.active, 'document');
  assert.equal(T.templateLabel(r.store, { settings: r.settings, doc: { endMarkers: true } }), 'Elsewhere (from document)');
  assert.equal(T.allTemplates(r.store).some((x) => x.id === 'document'), true);
  assert.equal(T.saveOver(r.store, 'document', current()).error, 'builtin', 'Save over it is not offered; Save As is');
  // picking another template drops it; Save As keeps it under a name
  assert.equal(T.select(r.store, 'ukaaf').store.docTemplate, null);
  const saved = T.saveAs(r.store, 'Elsewhere', { settings: r.settings, doc: { endMarkers: true } });
  assert.equal(saved.store.docTemplate, null);
  assert.equal(saved.store.active, saved.template.id);
  // a document with settings that are damaged: the settings stay as they are for the keys it does not give
  r = T.openedDocument(st, { name: 'Odd', settings: { cells: 'abc', mode: 'moon' } }, undefined);
  assert.ok(r.settings.cells >= 10 && ['bana', 'ukaaf'].includes(r.settings.mode));
  // a document that records no template leaves everything as it is
  assert.equal(T.openedDocument(st, undefined, undefined), null);
  assert.equal(T.openedDocument(st, { name: '', settings: {} }, undefined), null);
});

test('a template of the same name as a built-in in a file is read as the built-in, never as a new template', () => {
  const st = fresh();
  const r = T.openedDocument(st, { name: ' ukaaf ', settings: { cells: 33 } }, undefined);
  assert.equal(r.store.active, 'ukaaf');
  assert.equal(r.store.list.length, 0);
});

test('storage: the store is read and written through a localStorage-like object, and a store that cannot be written is not an error', () => {
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => mem.delete(k) };
  const st = T.loadStore(current().settings, ls);
  assert.equal(st.active, 'ukaaf');
  assert.ok(mem.has('emboss-templates'), 'made once and kept');
  const saved = T.saveAs(st, 'Mine', current({ cells: 30 }));
  T.writeStore(saved.store, ls);
  assert.equal(T.loadStore(current().settings, ls).active, saved.template.id);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(T.loadStore(current().settings, broken).active, 'ukaaf');
  assert.doesNotThrow(() => T.writeStore(saved.store, broken));
  mem.set('emboss-templates', '{ this is not json');
  assert.equal(T.loadStore(current().settings, ls).active, 'ukaaf');
});

test('ids: own templates are u-<base36 time>, never a built-in\'s, never two the same', () => {
  let st = fresh();
  const ids = new Set();
  for (let i = 0; i < 20; i++) { const r = T.saveAs(st, `T${i}`, current({ cells: 20 + i })); st = r.store; ids.add(r.template.id); }
  assert.equal(ids.size, 20);
  for (const id of ids) assert.match(id, /^u-[0-9a-z]+$/);
});

// =====================================================================================================================================
// Relaxed braille is part of the template (Paul, 2 Nov 2026: "relaxed braille is part of the template (one name)"; EMBOSS-TASKS.md rows X1
// and A91). A template carries the contractions a reader has learned ("ticks") as one more part, beside settings, doc and producer:
//   null = All (every contraction, ordinary braille; what BANA and UKAAF hold), or an array of catalogue keys (an empty array = none ticked).
// These checks were written before the code and failed against the earlier web/templates.mjs (no cleanContractions, no `contractions`).
//   - the ticks are saved with the template (Save, Save as), compared like any braille setting ("(modified)", Undo changes puts them back),
//     exported and imported with the template file, and saved in the document (one more <meta>, emboss-template-contractions);
//   - with relaxed braille OFF (the default; ?relaxed=1 switches it on) the ticks are kept but ignored: they never count toward "(modified)";
//   - the built-ins hold All; a document or file with no ticks reads as All;
//   - the reader profiles of the earlier preview become templates, once (decision 6).
const { UEB_CONTRACTION_SIGNS } = await import('../format/relaxed-signs.mjs');
const { makeTranslators, UEB_TABLES } = await import('../web/braille-table.mjs');
const ALL_KEYS = UEB_CONTRACTION_SIGNS.map((s) => s.key);
const STRONG = UEB_CONTRACTION_SIGNS.filter((s) => s.group === 'strong_contractions').map((s) => s.key);   // 12 keys
const ticksCur = (contractions, over = {}) => ({ settings: { ...pick(sanitizeSettings({ mode: 'ukaaf' })), contractions }, doc: undefined, relaxed: true, ...over });

test('ticks: cleaned to null (All) or a sorted list of catalogue keys; all of them is All; none is the empty list', () => {
  assert.equal(T.cleanContractions(null), null);
  assert.equal(T.cleanContractions(undefined), null);
  assert.equal(T.cleanContractions('x'), null, 'not a list: All');
  assert.equal(T.cleanContractions({}), null);
  assert.equal(T.cleanContractions(ALL_KEYS), null, 'every contraction ticked is All');
  assert.deepEqual(T.cleanContractions([]), [], 'nothing ticked is a real choice: every contraction spelled out');
  assert.deepEqual(T.cleanContractions(['strong_contractions:ch', 'nonsense', 5, 'strong_contractions:ch', 'alphabetic_wordsigns:but']), ['alphabetic_wordsigns:but', 'strong_contractions:ch'], 'unknown keys dropped, once each, catalogue order');
  assert.equal(T.cleanContractions(new Set(STRONG)).length, 12);
});

test('ticks: the built-ins hold All and cannot hold anything else', () => {
  for (const b of T.BUILTIN_TEMPLATES) assert.equal(b.contractions, null);
  assert.equal(Object.isFrozen(T.BUILTIN_TEMPLATES[0]), true);
  assert.deepEqual(T.TEMPLATE_SETTING_KEYS.includes('contractions'), false, 'the ticks are a part of their own, not a settings key (the file and document formats keep their settings part)');
});

test('ticks: sanitizeSettings keeps them in the settings store (null by default)', () => {
  assert.equal(DEFAULTS.contractions, null);
  assert.equal(sanitizeSettings({}).contractions, null);
  assert.deepEqual(sanitizeSettings({ contractions: STRONG }).contractions, [...STRONG].sort((a, b) => ALL_KEYS.indexOf(a) - ALL_KEYS.indexOf(b)));
  assert.deepEqual(sanitizeSettings({ contractions: [] }).contractions, []);
  assert.equal(sanitizeSettings({ contractions: ALL_KEYS }).contractions, null);
  assert.equal(sanitizeSettings({ contractions: 'junk' }).contractions, null);
});

test('ticks: a change makes the template "(modified)" when relaxed braille is on, and is ignored when it is off', () => {
  const st = fresh();
  assert.equal(T.isModified(st, ticksCur(null)), false);
  assert.deepEqual(T.differences(st, ticksCur(STRONG)), ['contractions']);
  assert.equal(T.templateLabel(st, ticksCur(STRONG)), 'UKAAF (modified)');
  assert.equal(T.isModified(st, ticksCur([])), true, 'none ticked differs from All');
  assert.equal(T.isModified(st, ticksCur(ALL_KEYS)), false, 'all ticked is All');
  // order of the keys does not matter
  const own = T.saveAs(st, 'Sam', ticksCur(STRONG)).store;
  assert.equal(T.isModified(own, ticksCur([...STRONG].reverse())), false);
  // off (the default): kept but ignored - never "(modified)", not even for an own template
  assert.equal(T.isModified(st, ticksCur(STRONG, { relaxed: false })), false);
  assert.equal(T.isModified(st, ticksCur(STRONG, { relaxed: undefined })), false);
  assert.equal(T.isModified(own, ticksCur(null, { relaxed: false })), false);
  assert.deepEqual(T.differences(own, ticksCur(null)), ['contractions'], 'on: the own template had ticks, All differs');
  // it sits among the other differences in a stable place: settings, then contractions, then document options
  const cur = { settings: { ...ticksCur(STRONG).settings, cells: 40 }, doc: { endMarkers: true }, relaxed: true };
  assert.deepEqual(T.differences(st, cur), ['cells', 'contractions', 'doc.endMarkers']);
});

test('ticks: Save as, Save and Rename keep them; Undo changes (applying the template) puts them back', () => {
  let st = fresh();
  const a = T.saveAs(st, 'Sam – Year 2', ticksCur(STRONG)); st = a.store;
  assert.deepEqual(a.template.contractions, T.cleanContractions(STRONG));
  assert.equal(st.active, a.template.id);
  assert.equal(T.isModified(st, ticksCur(STRONG)), false);
  assert.equal(T.isModified(st, ticksCur(null)), true);
  // Undo changes = apply the active template: the patch holds its ticks
  const patch = T.settingsPatch(T.activeTemplate(st), ticksCur(null).settings);
  assert.deepEqual(patch.contractions, T.cleanContractions(STRONG));
  assert.equal(T.isModified(st, { settings: { ...ticksCur(null).settings, ...patch }, relaxed: true }), false);
  // Save over: new ticks
  const saved = T.saveOver(st, a.template.id, ticksCur([]));
  assert.deepEqual(saved.template.contractions, []);
  assert.deepEqual(st.list[0].contractions, T.cleanContractions(STRONG), 'the earlier store is not changed in place');
  // Rename keeps them
  assert.deepEqual(T.rename(saved.store, a.template.id, 'Sam').template.contractions, []);
  // a built-in's patch is All
  assert.equal(T.settingsPatch(T.BUILTIN_TEMPLATES[1], {}).contractions, null);
  // Save as from a template when relaxed is off still keeps the ticks in force (they are kept, only ignored)
  assert.deepEqual(T.saveAs(fresh(), 'Kept', ticksCur(STRONG, { relaxed: false })).template.contractions, T.cleanContractions(STRONG));
});

test('ticks: the store keeps them across a reload, and a damaged store loses nothing it can read', () => {
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => mem.delete(k) };
  let st = T.loadStore(current().settings, ls);
  const a = T.saveAs(st, 'Sam', ticksCur(STRONG)); T.writeStore(a.store, ls);
  const again = T.loadStore(current().settings, ls);
  assert.deepEqual(again.list[0].contractions, T.cleanContractions(STRONG));
  const bad = JSON.parse(mem.get('emboss-templates'));
  bad.list[0].contractions = ['strong_contractions:ch', 'nonsense'];
  assert.deepEqual(T.migrateStore(bad, current().settings).list[0].contractions, ['strong_contractions:ch']);
  delete bad.list[0].contractions;   // a store written before the ticks existed
  assert.equal(T.migrateStore(bad, current().settings).list[0].contractions, null);
});

test('ticks: the template file carries them (only when not All); an old file reads as All; junk is cleaned', () => {
  let st = fresh();
  const a = T.saveAs(st, 'Sam', ticksCur(STRONG));
  const file = T.exportTemplate(a.template);
  assert.deepEqual(file.contractions, T.cleanContractions(STRONG));
  assert.deepEqual(Object.keys(file).sort(), ['contractions', 'doc', 'format', 'name', 'producer', 'settings', 'version']);
  assert.deepEqual(file.settings, T.cleanTemplateSettings(a.template.settings), 'the settings part is unchanged by the ticks');
  // All: no field at all, the file is exactly what it was before the ticks existed
  assert.deepEqual(Object.keys(T.exportTemplate(T.BUILTIN_TEMPLATES[1])).sort(), ['doc', 'format', 'name', 'producer', 'settings', 'version']);
  const r = T.importTemplate(fresh(), JSON.stringify(file));
  assert.deepEqual(r.template.contractions, T.cleanContractions(STRONG));
  assert.equal(r.store.active, r.template.id);
  assert.equal(T.importTemplate(fresh(), JSON.stringify({ format: 'emboss-template', version: 1, name: 'Old', settings: {} })).template.contractions, null);
  assert.deepEqual(T.importTemplate(fresh(), JSON.stringify({ format: 'emboss-template', version: 1, name: 'J', settings: {}, contractions: ['strong_contractions:th', 'evil', 7] })).template.contractions, ['strong_contractions:th']);
  assert.equal(T.importTemplate(fresh(), JSON.stringify({ format: 'emboss-template', version: 1, name: 'J', settings: {}, contractions: 'all' })).template.contractions, null);
});

test('ticks: the document records them in one more meta; the reader gives them back; All writes nothing', () => {
  const st = fresh();
  const none = T.documentTemplate(st, ticksCur(null));
  assert.deepEqual(Object.keys(none).sort(), ['name', 'settings'], 'All: the record is what it was before');
  const rec = T.documentTemplate(st, ticksCur(STRONG));
  assert.deepEqual(rec.contractions, T.cleanContractions(STRONG));
  const model = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'para', text: 'Body.' }], template: rec };
  const xml = quiet(() => exportToNimasXml(clone(model), { uid: 'tpl-test', date: '2026-01-01' }));
  assert.match(xml, /<meta name="emboss-template-contractions" content="[^"]+" \/>/);
  const back = quiet(() => parseDtbook(xml));
  assert.deepEqual(back.template.contractions, T.cleanContractions(STRONG));
  assert.deepEqual(back.template.settings, rec.settings, 'the settings meta is unchanged');
  const again = quiet(() => exportToNimasXml({ ...clone(back), template: back.template }, { uid: 'tpl-test', date: '2026-01-01' }));
  assert.equal(again, xml, 'a second round trip is byte-identical');
  // none ticked is a real value, kept
  const empty = quiet(() => exportToNimasXml(clone({ ...model, template: T.documentTemplate(st, ticksCur([])) }), { uid: 'u', date: '2026-01-01' }));
  assert.deepEqual(quiet(() => parseDtbook(empty)).template.contractions, []);
  // All: the file has no ticks meta, and is byte-identical to a file saved with no ticks field at all
  const plain = quiet(() => exportToNimasXml(clone({ ...model, template: none }), { uid: 'tpl-test', date: '2026-01-01' }));
  assert.ok(!/emboss-template-contractions/.test(plain));
  assert.equal(quiet(() => parseDtbook(plain)).template.contractions, undefined);
  // damaged ticks never break the reader
  const broken = xml.replace(/(<meta name="emboss-template-contractions" content=")[^"]*"/, '$1{not json"');
  assert.equal(quiet(() => parseDtbook(broken)).template.name, 'UKAAF');
});

test('ticks: the exporter and the reader write and read the same meta name the template code names', async () => {
  const fs = await import('node:fs');
  assert.equal(T.TEMPLATE_META_CONTRACTIONS, 'emboss-template-contractions');
  assert.ok(fs.readFileSync(path.join(EMBOSS, 'input', 'nimas-export.mjs'), 'utf8').includes(`name="${T.TEMPLATE_META_CONTRACTIONS}"`));
  assert.ok(fs.readFileSync(path.join(EMBOSS, 'input', 'parse.mjs'), 'utf8').includes(`'${T.TEMPLATE_META_CONTRACTIONS}'`));
});

test('ticks: a NIMAS package keeps them too', async () => {
  const rec = { name: 'Package house', settings: pick(sanitizeSettings({ mode: 'bana' })), contractions: T.cleanContractions(STRONG) };
  const zip = await buildNimasPackageZip({ title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'para', text: 'Body.' }], template: rec }, { mode: 'bana' });
  const back = await parseNimasZip(zip);
  assert.deepEqual(back.template.contractions, rec.contractions);
});

test('ticks: reopening a document applies the document\'s ticks (modified if they differ from the template of that name); no ticks recorded = All', () => {
  let st = fresh();
  const mine = T.saveAs(st, 'Sam', ticksCur(STRONG)); st = mine.store;
  let r = T.openedDocument(st, { name: 'sam', settings: ticksCur(null).settings, contractions: T.cleanContractions(['strong_contractions:ch']) }, undefined);
  assert.equal(r.store.active, mine.template.id);
  assert.deepEqual(r.contractions, ['strong_contractions:ch']);
  assert.equal(T.isModified(r.store, { settings: { ...r.settings, contractions: r.contractions }, relaxed: true }), true);
  assert.equal(T.isModified(r.store, { settings: { ...r.settings, contractions: r.contractions }, relaxed: false }), false);
  // no ticks recorded: All is what the document records (the template of that name is still the active one, shown modified when relaxed is on)
  r = T.openedDocument(st, { name: 'Sam', settings: ticksCur(null).settings }, undefined);
  assert.equal(r.contractions, null);
  assert.equal(T.isModified(r.store, { settings: { ...r.settings, contractions: r.contractions }, relaxed: true }), true);
  // a name nobody here has: the "from document" template keeps the ticks, and Save as keeps them under a name
  r = T.openedDocument(st, { name: 'Elsewhere', settings: ticksCur(null).settings, contractions: STRONG }, undefined);
  assert.equal(r.store.active, 'document');
  assert.deepEqual(r.store.docTemplate.contractions, T.cleanContractions(STRONG));
  assert.equal(T.isModified(r.store, { settings: { ...r.settings, contractions: r.contractions }, relaxed: true }), false);
  const saved = T.saveAs(r.store, 'Elsewhere', { settings: { ...r.settings, contractions: r.contractions } });
  assert.deepEqual(saved.template.contractions, T.cleanContractions(STRONG));
  // a document that records only a name (no settings) changes nothing
  assert.equal(T.openedDocument(fresh(), { name: 'Nobody' }, undefined), null);
  // through the pages' call
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => mem.delete(k) };
  const got = T.adoptDocumentTemplate({ name: 'Away', settings: { cells: 33 }, contractions: STRONG }, undefined, current().settings, ls);
  assert.deepEqual(got.contractions, T.cleanContractions(STRONG));
});

test('ticks: with the real engine, a template\'s ticks change the braille of UEB contracted (and only then)', () => {
  const S = 'The teacher said that children should go through the garden.';
  const table = UEB_TABLES.g2;
  const withTicks = (c) => makeTranslators(louis, table, { relaxed: T.contractionsSet(c) }).translate(S);
  assert.equal(T.contractionsSet(null), null);
  assert.equal(withTicks(null), makeTranslators(louis, table).translate(S), 'All is today\'s braille');
  assert.notEqual(withTicks(STRONG), withTicks(null));
  assert.notEqual(withTicks([]), withTicks(STRONG));
  assert.match(withTicks([]), /TEACHER/, 'nothing ticked: spelled out');
  // grade 1 is never relaxed
  assert.equal(makeTranslators(louis, UEB_TABLES.g1, { relaxed: T.contractionsSet([]) }).translate(S), makeTranslators(louis, UEB_TABLES.g1).translate(S));
});

// ---- the reader profiles of the earlier preview become templates, once (Paul, 2 Nov 2026, decision 6) ----
const memStorage = (init = {}) => {
  const mem = new Map(Object.entries(init));
  return { mem, getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => mem.delete(k) };
};
test('migration: each stored profile other than All becomes an own template (the settings in force + its ticks); a clash is renamed "NAME (2)"', () => {
  const settings = { ...pick(sanitizeSettings({ mode: 'bana' })) };
  const legacy = { profiles: [{ name: 'Sam – Year 2', keys: STRONG }, { name: 'BANA', keys: [] }, { name: 'UKAAF', keys: ['strong_contractions:ch'] }, { name: 'Kim', keys: ALL_KEYS }], active: null };
  const store = T.migrateStore(null, settings);
  const r = T.migrateReaderProfiles(store, settings, legacy);
  assert.deepEqual(r.store.list.map((x) => x.name), ['Sam – Year 2', 'BANA (2)', 'UKAAF (2)', 'Kim']);
  assert.deepEqual(r.store.list[0].contractions, T.cleanContractions(STRONG));
  assert.deepEqual(r.store.list[1].contractions, []);
  assert.equal(r.store.list[3].contractions, null, 'a profile with every box ticked is All');
  for (const t of r.store.list) { assert.deepEqual(t.settings, T.cleanTemplateSettings(settings)); assert.match(t.id, /^u-[0-9a-z]+$/); }
  assert.equal(new Set(r.store.list.map((x) => x.id)).size, 4);
  assert.equal(r.store.active, 'bana', 'no profile was in use: the active template does not change');
  assert.equal(r.activeId, null);
  assert.equal(r.store.profilesMigrated, true);
  // once: a store that has been migrated is returned as it is
  const again = T.migrateReaderProfiles(r.store, settings, legacy);
  assert.deepEqual(again.store, r.store);
  assert.deepEqual(T.migrateStore(JSON.parse(JSON.stringify(r.store)), settings).profilesMigrated, true, 'the mark survives a reload');
  // a name already used by an own template
  const taken = T.saveAs(T.migrateStore(null, settings), 'Sam – Year 2', { settings });
  assert.deepEqual(T.migrateReaderProfiles(taken.store, settings, { profiles: [{ name: 'sam – year 2', keys: [] }], active: null }).store.list.map((x) => x.name), ['Sam – Year 2', 'sam – year 2 (2)']);
});

test('migration: the profile that was in use makes its template the active one, and says which ticks are in force', () => {
  const settings = pick(sanitizeSettings({ mode: 'ukaaf' }));
  const legacy = { profiles: [{ name: 'A', keys: [] }, { name: 'Strong only', keys: STRONG }], active: 'Strong only' };
  const r = T.migrateReaderProfiles(T.migrateStore(null, settings), settings, legacy);
  const strong = r.store.list.find((x) => x.name === 'Strong only');
  assert.equal(r.store.active, strong.id);
  assert.equal(r.activeId, strong.id);
  assert.equal(T.isModified(r.store, { settings: { ...settings, contractions: strong.contractions }, relaxed: true }), false);
  // a profile in use that no longer exists changes nothing
  assert.equal(T.migrateReaderProfiles(T.migrateStore(null, settings), settings, { profiles: [{ name: 'A', keys: [] }], active: 'Ghost' }).store.active, 'ukaaf');
  // no profiles at all: the mark is made, nothing else
  const none = T.migrateReaderProfiles(T.migrateStore(null, settings), settings, { profiles: [], active: null });
  assert.deepEqual(none.store.list, []);
  assert.equal(none.store.profilesMigrated, true);
});

test('migration, through localStorage: read the old keys, make the templates, put the active profile\'s ticks in the settings, leave the old keys where they are, do it once', () => {
  const profiles = { v: 1, profiles: [{ name: 'Sam', keys: STRONG }, { name: 'Kim', keys: [] }] };
  const ls = memStorage({ 'emboss-settings': JSON.stringify(sanitizeSettings({ mode: 'bana' })), 'emboss-reader-profiles': JSON.stringify(profiles), 'emboss-reader-profile': 'Kim' });
  const r1 = T.adoptReaderProfiles(ls);
  assert.equal(r1.migrated, 2);
  const settings = JSON.parse(ls.mem.get('emboss-settings'));
  assert.deepEqual(settings.contractions, [], 'Kim (nothing ticked) was in use: its ticks are in force');
  assert.equal(settings.mode, 'bana', 'the rest of the settings are as they were');
  const st = T.loadStore(sanitizeSettings(settings), ls);
  assert.deepEqual(st.list.map((x) => x.name), ['Sam', 'Kim']);
  assert.equal(T.activeTemplate(st).name, 'Kim');
  assert.equal(T.isModified(st, { settings: { ...sanitizeSettings(settings) }, relaxed: true }), false);
  assert.equal(ls.mem.get('emboss-reader-profiles'), JSON.stringify(profiles), 'the old keys are left in place');
  assert.equal(ls.mem.get('emboss-reader-profile'), 'Kim');
  // once: the second load adds nothing, even if the user deleted a migrated template meanwhile
  const del = T.remove(st, st.list[0].id); T.writeStore(del.store, ls);
  const r2 = T.adoptReaderProfiles(ls);
  assert.equal(r2.migrated, 0);
  assert.deepEqual(T.loadStore(sanitizeSettings(settings), ls).list.map((x) => x.name), ['Kim']);
  // nothing stored at all, or damage: no error, nothing made
  assert.equal(T.adoptReaderProfiles(memStorage()).migrated, 0);
  assert.equal(T.adoptReaderProfiles(memStorage({ 'emboss-reader-profiles': '{not json', 'emboss-reader-profile': 'Ghost' })).migrated, 0);
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.doesNotThrow(() => T.adoptReaderProfiles(blocked));
});

test('the active template\'s name for the status bar and the label comes from the store', () => {
  const ls = memStorage();
  const st = T.loadStore(current().settings, ls);
  assert.equal(T.activeTemplateName(current().settings, ls), 'UKAAF');
  const a = T.saveAs(st, 'Sam – Year 2', ticksCur(STRONG)); T.writeStore(a.store, ls);
  assert.equal(T.activeTemplateName(current().settings, ls), 'Sam – Year 2');
});
