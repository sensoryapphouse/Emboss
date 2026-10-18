// The optional-field registry (format/field-registry.mjs) is the one description of every optional formatting field.
// These checks keep the four places that use it in step:
//   1. save format   - every field round-trips model -> DTBook -> model (and again); every class token / <meta> name the
//                      exporter writes over a fixture using every field is in the registry, and every registry token is written;
//                      the exporter's tables are exactly the registry-derived ones.
//   2. editor carry  - editor.mjs takes its FMT_*_KEYS from the registry, and every key it stores on a node's fmt is a
//                      registry field (or a documented editor-only key).
//   3. UI            - every dialog / Settings control belongs to a registry field and to exactly one group; its label, help
//                      and option texts are en.json's; the dialog markup is generated (no hand-built controls in index.html).
//   4. formatter     - every field that changes braille and is read by formatBlock changes getBlockSignature's cache key,
//                      and a field that is not in the key does not change formatBlock's output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = await import('../format/field-registry.mjs');
const EX = await import('../input/nimas-export.mjs');
const { parseDtbook } = await import('../input/parse.mjs');
const { formatBlock, getBlockSignature } = await import('../format/document.mjs');
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const OPTS = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };

const clone = (x) => JSON.parse(JSON.stringify(x));
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
const EXPORT_OPTS = { uid: 'registry-test', date: '2026-01-01' };
const exportModel = (m) => quiet(() => EX.exportToNimasXml(clone(m), EXPORT_OPTS));
const parse = (xml) => quiet(() => parseDtbook(xml));
const samplesOf = (f) => (f.samples || (f.sample ? [f.sample] : []));
// A sample is a block, or { item: listBlock }, { segment: blockWithSegments }, { doc: options }.
const hostOf = (s) => s.item || s.segment || (s.doc ? null : s);
const modelFor = (s) => (s.doc ? { title: 'T', ...clone(s.doc), blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'para', text: 'Body.' }] }
  : { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, clone(hostOf(s))] });

// ---------------------------------------------------------------------------------------------------------------
test('registry: keys are unique, every field is described', () => {
  const keys = R.FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate keys');
  for (const f of R.FIELDS) {
    assert.ok(Array.isArray(f.where) && f.where.length, `${f.key}: where`);
    assert.ok(typeof f.type === 'string', `${f.key}: type`);
    assert.ok(['everyone', 'transcriber'].includes(f.audience), `${f.key}: audience`);
    assert.ok(typeof f.affectsBraille === 'boolean', `${f.key}: affectsBraille`);
    assert.ok(['key', 'page', 'nested', 'doc'].includes(f.cache), `${f.key}: cache`);
    assert.ok(Array.isArray(f.save), `${f.key}: save`);
    if (!f.save.length) assert.ok(f.note, `${f.key}: a field that is not saved says why (note)`);
    if (f.roundTrip !== false) assert.ok(samplesOf(f).length, `${f.key}: a round-trip sample (or roundTrip:false with a note)`);
    if (f.roundTrip === false) assert.ok(f.note || !f.save.length || f.key === 'xref', `${f.key}: roundTrip:false needs a note`);
  }
});

test('save format: the exporter tables are the registry-derived ones (thin aliases)', () => {
  assert.deepEqual(EX.BANA_FLAG_FIELDS, R.flagFieldTable());
  assert.deepEqual(EX.BANA_TEXT_FIELDS, R.textFieldTable());
  assert.deepEqual(EX.BANA_DOC_OPTIONS, R.docOptionTable());
  assert.deepEqual(EX.BANA_FIELD_NAMES, [...R.flagFieldTable(), ...R.textFieldTable()].map((f) => f.field));
  // title parts: distinct order numbers
  const orders = R.FIELDS.flatMap((f) => f.save.filter((s) => s.title != null).map((s) => s.title));
  assert.equal(new Set(orders).size, orders.length, 'two text fields share a title position');
});

// ---------------------------------------------------------------------------------------------------------------
// 1. Round trip: model -> DTBook -> model -> DTBook -> model keeps the field.
function pick(model, s) {
  if (s.doc) return model;
  const want = hostOf(s);
  const blocks = model.blocks.slice(1);
  return blocks.find((b) => b.type === want.type) || blocks.find((b) => b.type !== 'heading' || want.type === 'heading') || blocks[0];
}
function fieldValue(f, s, host) {
  const key = f.modelKey || f.key;
  if (s.doc) return host[key];
  if (s.item) return (host.items || []).map((it) => (it ? it[key] : undefined)).filter((v) => v != null);
  if (s.segment) return (host.segments || []).map((g) => (g ? g[key] : undefined)).filter((v) => v != null);
  return host[key];
}
for (const f of R.FIELDS) {
  if (f.roundTrip === false) continue;
  samplesOf(f).forEach((s, i) => {
    test(`round trip: ${f.key}${samplesOf(f).length > 1 ? ` #${i + 1}` : ''}`, () => {
      const m0 = modelFor(s);
      const want = fieldValue(f, s, s.doc ? s.doc : hostOf(s));
      assert.ok(want != null && !(Array.isArray(want) && !want.length), 'the sample carries the field');
      const x1 = exportModel(m0);
      const m1 = parse(x1);
      assert.deepEqual(fieldValue(f, s, pick(m1, s)), want, `after one save and reopen\n${x1}`);
      const x2 = exportModel(m1);
      const m2 = parse(x2);
      assert.deepEqual(fieldValue(f, s, pick(m2, s)), want, `after a second save and reopen\n${x2}`);
      assert.equal(x2, exportModel(m2), 'save -> reopen -> save is stable');
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 1b. Every token the exporter writes over a document using every field is in the registry, and vice versa.
function fixtureWithEveryField() {
  const blocks = [{ type: 'heading', level: 1, text: 'Every field' }];
  const doc = {};
  for (const f of R.FIELDS) for (const s of samplesOf(f)) {
    if (s.doc) Object.assign(doc, s.doc);
    else { blocks.push(clone(hostOf(s))); blocks.push({ type: 'para', text: 'Between.' }); }
  }
  return { title: 'Every field', ...doc, blocks };
}
const tokenMatches = (tok, pat) => (pat.endsWith('*') ? tok.startsWith(pat.slice(0, -1)) : tok === pat);
test('save format: every bana-* class token and <meta> name written is in the registry; every registry token is written', () => {
  const xml = exportModel(fixtureWithEveryField());
  const written = new Set();
  for (const m of xml.matchAll(/\sclass="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (t.startsWith('bana-') || t === 'blocked' || t === 'uncontracted') written.add(t);
  for (const m of xml.matchAll(/<meta name="(bana-[^"]+)"/g)) written.add(m[1]);
  const reg = [...R.registryTokens()];
  const known = [...reg, ...R.STRUCTURAL_TOKENS].map((p) => p.replace(/-N$/, '-*'));
  const unknown = [...written].filter((t) => !known.some((p) => tokenMatches(t, p)));
  assert.deepEqual(unknown, [], 'tokens written that the registry does not describe');
  const missing = reg.map((p) => p.replace(/-N$/, '-*')).filter((p) => ![...written].some((t) => tokenMatches(t, p)));
  assert.deepEqual(missing, [], 'registry tokens the exporter did not write for the every-field fixture');
});

test('save format: a document with no optional field writes no bana- field token', () => {
  const xml = exportModel({ title: 'Plain', blocks: [{ type: 'heading', level: 1, text: 'Plain' }, { type: 'para', text: 'Text.' }, { type: 'list', items: [{ text: 'a' }, { text: 'b' }] }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }] });
  const toks = [...xml.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((t) => t.startsWith('bana-'));
  assert.deepEqual(toks.filter((t) => !R.STRUCTURAL_TOKENS.some((p) => tokenMatches(t, p))), []);
  assert.ok(!/<meta name="bana-/.test(xml));
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Editor carry.
const EDITOR = fs.readFileSync(path.join(EMBOSS, 'web', 'editor', 'editor.mjs'), 'utf8');
const INDEX = fs.readFileSync(path.join(EMBOSS, 'web', 'editor', 'index.html'), 'utf8');
// Keys the editor keeps in a node's fmt that are not formatting fields of their own.
const EDITOR_ONLY_FMT_KEYS = {
  bulletMarker: 'a bullet list item keeps its print glyph for the save (the marker, not a formatting choice)',
  // list items with several paragraphs / a table (model item.blocks, list_item_blocks.test.mjs): structure, not formatting
  itemCont: 'a list line that is the previous item\'s further paragraph (saved into that item\'s blocks)',
  inItem: 'a table (or other block) that sits inside the list item before it (joined back on save: mergeListItemBlocks)',
  listResume: 'a list that goes on after a table inside one of its items (joined back on save: mergeListItemBlocks)',
  // K29 Stage 1c rework: a Title Page LINE's layout hint from the shared template (field-registry.mjs's
  // titlePageTemplateSegments) — 2.3.5e's uncontracted "et al." tail / 2.3.6f's cell-3 ISBN indent —
  // kept on the paragraph's own fmt so an edited page's braille still applies it after save/reload
  // (see editor.mjs's $fillTitlePage/$titlePageSegments and nimas-export.mjs/parse.mjs's
  // bana-tp-etal/bana-tp-cell3 class tokens). Not a per-block formatting CHOICE a transcriber sets.
  etAl: 'a Title Page Author-segment line needing the uncontracted "et al." braille tail (BANA 2.3.5e)',
  cell3: 'a Title Page Publisher-segment line (a second-or-later ISBN) needing a cell-3 indent (BANA 2.3.6f)',
};
test('editor carry: FMT_*_KEYS come from the registry (no hand-written key lists)', () => {
  for (const name of ['HEADING', 'CODE', 'LIST', 'ITEM', 'PARA', 'NOTE', 'PAGENUM', 'TABLE', 'PBB']) {
    const m = new RegExp(`const FMT_${name}_KEYS = ([^;]+);`).exec(EDITOR);
    assert.ok(m, `FMT_${name}_KEYS is defined`);
    assert.match(m[1], /^fmtKeysFor\('\w+'\)$/, `FMT_${name}_KEYS is derived: ${m[1]}`);
  }
  assert.match(EDITOR, /const FMT_OFF_KEYS = fmtOffKeys\(\);/);
  assert.match(EDITOR, /const DOC_OPTION_KEYS = docOptionFields\(\)/);
  for (const b of ['heading', 'code', 'list', 'item', 'para', 'note', 'pagenum', 'table', 'pbb']) assert.ok(R.fmtKeysFor(b).length, `bucket ${b} is not empty`);
});
test('editor carry: every key the editor writes into a node fmt is a registry field (or a documented editor-only key)', () => {
  const regKeys = new Set(R.FIELDS.flatMap((f) => [f.key, f.fmtKey].filter(Boolean)));
  const used = new Set();
  // The argument list of every setFmt( … ) / put( … ) call (balanced parentheses), and the object keys written in it.
  const calls = [];
  for (const m of EDITOR.matchAll(/\b(?:setFmt|put)\(/g)) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < EDITOR.length && depth; i++) { if (EDITOR[i] === '(') depth++; else if (EDITOR[i] === ')') depth--; }
    calls.push(EDITOR.slice(start, i - 1));
  }
  for (const c of calls) for (const k of c.matchAll(/[{,]\s*([a-zA-Z]+)\s*:/g)) used.add(k[1]);
  // (the dialog writes through the registry, patch[fmtKey]; these are the explicit writes: toolbar toggles, list numbering, bullets, load)
  assert.ok(used.size >= 8, `the scan finds the editor's explicit fmt writes (${[...used].join(' ')})`);
  const unknown = [...used].filter((k) => !regKeys.has(k) && !EDITOR_ONLY_FMT_KEYS[k]);
  assert.deepEqual(unknown, [], 'fmt keys written by editor.mjs that the registry does not describe');
  for (const k of Object.keys(EDITOR_ONLY_FMT_KEYS)) assert.ok(used.has(k) || EDITOR.includes(`${k}:`), `${k} is still used (else drop it from the allow-list)`);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. UI: dialog and Settings controls.
const EN = JSON.parse(fs.readFileSync(path.join(EMBOSS, 'web', 'locales', 'en.json'), 'utf8'));
const en = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), EN);
test('UI: every control belongs to a registry field and to exactly one group, and every group control exists', () => {
  const inGroups = R.GROUPS.flatMap((g) => R.groupControlIds(g));
  assert.equal(new Set(inGroups).size, inGroups.length, 'a control is listed twice');
  const ids = R.ALL_CONTROLS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'two controls share an id');
  assert.deepEqual([...inGroups].sort(), [...ids].sort(), 'GROUPS and the fields\' ui list the same controls');
  for (const c of R.ALL_CONTROLS) {
    assert.ok(R.fieldByKey(c.field), `${c.id}: field ${c.field}`);
    const g = R.GROUPS.find((gg) => R.groupControlIds(gg).includes(c.id));
    assert.equal(g.group, c.group, `${c.id}: its group (${c.group}) is the fieldset it is listed in (${g.group})`);
    assert.ok(c.codec === 'special' || R.CODECS[c.codec], `${c.id}: codec ${c.codec}`);
    if (c.part != null) assert.ok(['citation', 'guideDotNote', 'continuedNote'].includes(c.codec), `${c.id}: composite codec`);
  }
});
test('UI: labels, help, option and legend texts are en.json\'s', () => {
  for (const c of R.ALL_CONTROLS) {
    assert.equal(en(c.labelKey), c.label, `${c.id} label (${c.labelKey})`);
    if (c.helpKey) assert.equal(en(c.helpKey), c.help, `${c.id} help (${c.helpKey})`);
    for (const o of c.options || []) assert.equal(en(o.key), o.text, `${c.id} option ${o.value} (${o.key})`);
  }
  for (const g of R.GROUPS) {
    if (g.legendKey) assert.equal(en(g.legendKey), g.legend, `${g.id} legend`);
    for (const it of g.controls) if (it && it.note) assert.equal(en(it.key), it.text, `${it.note} text`);
  }
  for (const k of ['app.settings.transcriber_tools', 'app.settings.transcriber_tools_help', 'app.symbol_notice.text', 'app.symbol_notice.add', 'app.braille_fmt.transcriber_only']) assert.ok(en(k), k);
});
test('UI: the dialog and Settings controls are generated (none hand-built in index.html)', () => {
  for (const c of R.ALL_CONTROLS) assert.ok(!new RegExp(`id="${c.id}"`).test(INDEX), `${c.id} is still hand-written in index.html`);
  assert.match(INDEX, /id="brailleFmtGroups"/);
  // 17 Oct 2026 (feedback item 9a): the Settings dialog is built by web/settings-panes.mjs, one source for both pages, so its fieldset is there, not in the editor's page
  assert.match(fs.readFileSync(path.join(EMBOSS, "web", "settings-panes.mjs"), "utf8"), /<fieldset id="docOptionsGroup"/);
  // every special control has its explicit editor code
  const special = R.ALL_CONTROLS.filter((c) => c.codec === 'special').map((c) => c.id);
  const handled = new Set([...EDITOR.matchAll(/^  (fmt\w+): \{/gm)].map((m) => m[1]));
  for (const id of special) assert.ok(handled.has(id) || /^fmtSym[12]$/.test(id), `${id}: BF_SPECIAL entry`);
  for (const id of special) assert.ok(new RegExp(`${id}:`).test(EDITOR.slice(EDITOR.indexOf('function bfResolveTarget'))), `${id}: its value is read in bfResolveTarget`);
});
test('UI: codecs read and write the stored forms the hand-built dialog used', () => {
  const C = R.CODECS;
  assert.equal(C.tri.read(R.FMT_OFF), 'off'); assert.equal(C.tri.read(true), 'on'); assert.equal(C.tri.read(undefined), '');
  assert.equal(C.tri.write('off').value, R.FMT_OFF); assert.equal(C.tri.write('').value, null);
  assert.deepEqual(C.continuedNote.write({ mode: 'on', text: 'Cont.' }), { value: 'Cont.' });
  assert.equal(C.continuedNote.write({ mode: 'off', text: 'x' }).err, 'app.braille_fmt.err_continued_text');
  assert.deepEqual(C.citation.write({ text: 'Src', position: 'inside-box' }), { value: { text: 'Src', position: 'inside-box' } });
  assert.equal(C.citation.write({ text: '', position: 'inside-box' }).err, 'app.braille_fmt.err_citation_text');
  assert.deepEqual(C.guideDotNote.write({ on: true, text: '' }), { value: true });
  const cols = R.controlById('fmtColumns');
  assert.equal(C.int.write('1', cols).value, null); assert.equal(C.int.write('3', cols).value, 3); assert.ok(C.int.write('12', cols).err);
  assert.deepEqual(C.rows1.write('3, 1', {}, { rowCount: 4 }).value, [0, 2]); assert.ok(C.rows1.write('9', { errKey: 'e' }, { rowCount: 4 }).err);
  assert.deepEqual(C.rowText.write('2: Veg', {}, { rowCount: 3 }).value, [{ row: 1, text: 'Veg' }]);
  assert.deepEqual(C.csv.write('*, †', {}).value, ['*', '†']); assert.ok(C.csv.write('a,,b', { errKey: 'e' }).err);
  assert.equal(C.invert.read(true), false); assert.equal(C.invert.write(false).value, true);
  assert.equal(C.docOff.write(true).value, undefined); assert.equal(C.docOff.write(false).value, false);
  assert.ok(C.docText.write('a b c d', R.controlById('docLineIndicator')).err);
});
test('UI: audience tags (Transcriber tools)', () => {
  // every document option and every page-number field is a transcriber tool; everyday list / heading controls are not
  for (const f of R.docOptionFields()) assert.equal(f.audience, 'transcriber', f.key);
  for (const k of ['implied', 'through', 'spelled', 'combineWithNext', 'unnumbered', 'keyList', 'mentionSymbols', 'thesaurus', 'dictionary', 'interpointOmitEven', 'endOfVolume'])
    assert.equal(R.fieldByKey(k).audience, 'transcriber', k);
  for (const k of ['bullet', 'enum', 'start', 'symbols', 'columns', 'notConnected', 'pageBreakBefore']) assert.equal(R.fieldByKey(k).audience, 'everyone', k);
  // K29 Stage 1c (design doc transcriber-pages-customisation-design.md §4: "Transcriber tools only;
  // hidden when the setting is off, as agreed 24 Sep"): 'titlepage' joins tnpage/sympage as a third
  // transcriber-only style, so the style menu/slash command only offer it with Transcriber tools on.
  assert.deepEqual(R.TRANSCRIBER_STYLES, ['tnpage', 'sympage', 'titlepage']);
  // every dialog kind keeps at least one control for everyone, except a print page change (all page-number fields)
  for (const kind of ['list', 'heading', 'speaker', 'verse', 'note', 'directions', 'table', 'para', 'footnote', 'box'])
    assert.ok(R.groupsForKind(kind).some((g) => R.groupControlIds(g).some((id) => R.controlById(id).audience === 'everyone')), kind);
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Formatter cache key: a field formatBlock reads must change getBlockSignature; one outside the key must not change formatBlock.
const lines = (b, o = OPTS) => quiet(() => formatBlock(clone(b), { ...o }));
const sig = (b, o = OPTS) => getBlockSignature(clone(b), o, false);
const without = (b, key) => { const c = clone(b); delete c[key]; return c; };
function blockPair(f, s) {
  const key = f.modelKey || f.key;
  const req = f.requires || {};
  if (s.item) { const h = clone(s.item); h.items = h.items.map((it) => ({ ...it })); const off = clone(h); off.items.forEach((it) => delete it[key]); return [Object.assign(h, req), Object.assign(off, req)]; }
  if (s.segment) { const h = clone(s.segment); const off = clone(h); off.segments.forEach((g) => delete g[key]); return [Object.assign(h, req), Object.assign(off, req)]; }
  const h = { ...clone(s), ...req };
  return [h, without(h, key)];
}
const DOC_PROBES = [
  { type: 'para', text: 'He was comin’ . . . then “gone”.', segments: [{ type: 'text', text: 'He was comin’ . . . then ' }, { type: 'text', text: 'gone', tf: 1 }, { type: 'text', text: '.' }] },
  { type: 'list', items: [{ text: 'one', marker: '•' }, { text: 'two', level: 1, marker: '•' }, { text: 'three', level: 2, marker: '•' }] },
  { type: 'play', subtype: 'verse', style: 'verse', text: 'A line of verse' },
  { type: 'heading', level: 1, text: 'Contents' },
];
for (const f of R.FIELDS) {
  if (!f.affectsBraille) continue;
  samplesOf(f).forEach((s, i) => {
    test(`cache key: ${f.key}${samplesOf(f).length > 1 ? ` #${i + 1}` : ''} (${f.cache})`, () => {
      if (s.doc) {
        for (const b of DOC_PROBES) {
          const o2 = { ...OPTS, ...s.doc };
          if (sig(b, o2) === sig(b)) assert.deepEqual(lines(b, o2), lines(b), `${f.key} changes formatBlock for a ${b.type} but not its cache key`);
        }
        return;
      }
      const [on, off] = blockPair(f, s);
      if (f.cache === 'key' || f.cache === 'nested') assert.notEqual(sig(on), sig(off), `${f.key} is read by formatBlock but is not in getBlockSignature's key`);
      else assert.deepEqual(lines(on), lines(off), `${f.key} is marked cache:'${f.cache}' but changes formatBlock's output (add it to getBlockSignature)`);
    });
  });
}
test('cache key: fields without a sample that the formatter reads are in the key', () => {
  const t = { type: 'table', headers: ['A', 'B'], rows: [['1', '"'], ['2', '3']] };
  assert.notEqual(sig({ ...t, dittoMarks: true }), sig(t), 'dittoMarks');
  assert.notEqual(sig({ type: 'caption', text: 'A table', identifier: 'Table' }), sig({ type: 'caption', text: 'A table' }), 'identifier');
  assert.notEqual(sig({ type: 'graphic', src: 'a.png', alt: 'A map', figureType: 'Map' }), sig({ type: 'graphic', src: 'a.png', alt: 'A map' }), 'figureType');
  assert.notEqual(sig({ type: 'para', text: 'x', segments: [{ type: 'text', text: 'x', hyperlink: true }] }), sig({ type: 'para', text: 'x', segments: [{ type: 'text', text: 'x' }] }), 'hyperlink');
  assert.notEqual(sig({ type: 'xref', text: 'See p. 4.' }), sig({ type: 'note', text: 'See p. 4.' }), 'xref (a block type)');
  assert.notEqual(sig({ type: 'para', text: 'runs on', continued: true }), sig({ type: 'para', text: 'runs on' }), 'continued');
  assert.notEqual(sig({ type: 'para', text: 'resumes', continuation: true }), sig({ type: 'para', text: 'resumes' }), 'continuation');
  // and every such field is listed: a field with no sample that formatBlock reads must be one of these
  const noSample = R.FIELDS.filter((f) => f.affectsBraille && !samplesOf(f).length && (f.cache === 'key')).map((f) => f.key).sort();
  assert.deepEqual(noSample, ['continuation', 'continued', 'subdivisionHeading', 'xref'].sort(), 'a new cache:key field without a sample needs a check here');
});
