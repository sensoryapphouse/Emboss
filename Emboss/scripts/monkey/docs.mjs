// The documents the monkey test loads (Emboss/scripts/monkey-test.mjs).
//
// A document is named by a KEY (a short string kept in the session line, the failure folder and repro.json):
//   - a path relative to the Emboss folder for a file found in the sample folders ("tests/real_samples/docx/x.docx");
//   - "extra/<path>" for a file from the --extra-docs folder;
//   - "gen:<tag>" for a document generated for the run (monkey/gendoc.mjs), saved as <out>/generated/<tag>.<ext>;
//   - one of the old curated names below ('nimas', 'docx-maths', ...), or 'empty' (nothing is loaded);
//   - any other string: a path to a file (--docs FILE).
// A failure folder keeps a copy of every document its replay loads (docs/…); repro.json maps key -> that copy, and --replay
// registers those copies first, so a replay does not depend on the sample folders being unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genDocument } from './gendoc.mjs';

export const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IA = path.join(EMBOSS, 'tests', 'fixtures', 'import-audit');

// The kinds of file Emboss reads (Emboss/input/parse.mjs: parseFileByExt and BINARY_EXTS; the file pickers' accept lists). Files of
// any other kind in the sample folders (the .brf outputs, .emf, .py, .mjs, .json) are not documents and are left out.
// checkReaderExts() compares this list with parse.mjs's BINARY_EXTS at start-up, so a new binary reader is noticed.
export const READABLE_EXTS = new Set(['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'ott', 'fodt', 'epub', 'ebrl', 'ebraille', 'zip', 'html', 'htm', 'xhtml', 'md', 'markdown', 'rtf', 'txt', 'xml', 'nimas', 'dtbook']);
export async function checkReaderExts() {
  try {
    const m = await import('../../input/parse.mjs');
    const missing = [...m.BINARY_EXTS].filter((e) => !READABLE_EXTS.has(e));
    return missing.length ? `Emboss/input/parse.mjs reads .${missing.join(', .')} too, which monkey/docs.mjs READABLE_EXTS does not list yet` : null;
  } catch (e) { return null; }   // parse.mjs not loadable in node here: nothing to compare
}

// the old, fixed list (kept for --docs and as one small source of the pool): key -> { file, weight, large }
export const DOCS = {
  'nimas':        { file: path.join(EMBOSS, 'web', 'test_samples', 'nimas_comprehensive_structures_sample.xml'), weight: 5 },
  'docx-tables':  { file: path.join(IA, 'docx', 'w12-tables.docx'), weight: 2 },
  'docx-images':  { file: path.join(IA, 'docx', 'w13-images.docx'), weight: 2 },
  'docx-maths':   { file: path.join(IA, 'docx', 'w14-equations.docx'), weight: 4 },
  'docx-lists':   { file: path.join(IA, 'docx', 'w08-lists.docx'), weight: 2 },
  'docx-notes':   { file: path.join(IA, 'docx', 'w05-notes-comments.docx'), weight: 1 },
  'html-tables':  { file: path.join(IA, 'html', 'h04-tables.html'), weight: 2 },
  'html-media':   { file: path.join(IA, 'html', 'h05-media-maths-links.html'), weight: 3 },
  'md-maths':     { file: path.join(IA, 'md', 'm03-tables-maths.md'), weight: 2 },
  'md-notes':     { file: path.join(IA, 'md', 'm04-notes-images-html.md'), weight: 2 },
  'epub':         { file: path.join(IA, 'epub', 'e01-basic.epub'), weight: 1 },
  'odt-lists':    { file: path.join(IA, 'odt', 'o02-lists-tables.odt'), weight: 1 },
  'empty':        { file: null, weight: 2 },                    // a fresh, empty document (nothing is loaded)
  'large':        { file: path.join(EMBOSS, 'web', 'large-nimas.xml'), weight: 0.6, large: true },   // 1.4 MB: fewer actions, longer waits
};
export const DEFAULT_DOCS = Object.keys(DOCS);

export const BIG_BYTES = 1_000_000;           // above this a file is "big": rare, and its session gets fewer actions
const registry = new Map();                   // key -> { file, size, source }
export function registerDoc(key, file, source) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* missing: reported when it is read */ }
  registry.set(key, { key, file, size, source: source || 'file', large: size > BIG_BYTES });
  return registry.get(key);
}
for (const [k, d] of Object.entries(DOCS)) if (d.file) registerDoc(k, d.file, 'curated');
registry.set('empty', { key: 'empty', file: null, size: 0, source: 'empty', large: false });

// A key, a registered name or a file path -> { key, file, size, large, source }
export function resolveDoc(key) {
  if (registry.has(key)) return registry.get(key);
  const file = path.resolve(key);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return registerDoc(key, file, 'file');
  throw new Error(`unknown document "${key}" (keys: ${DEFAULT_DOCS.join(', ')}; or give a file path)`);
}
export const isLargeDoc = (key) => { try { return !!resolveDoc(key).large; } catch { return false; } };

const cache = new Map();
// { name, b64 } for a document, or null for the empty one. A file is read once and cached (the big ones are not: see below).
export function readDoc(key) {
  if (cache.has(key)) return cache.get(key);
  const d = resolveDoc(key);
  if (!d.file) return null;
  const v = { name: path.basename(d.file), b64: fs.readFileSync(d.file).toString('base64') };
  if (d.size < 3_000_000) cache.set(key, v);   // a 10 MB document is not kept for the rest of the run
  return v;
}

// ---------------------------------------------------------------- the pool
function walk(dir, out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));   // the same order on every machine: a seed picks the same file
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && READABLE_EXTS.has(path.extname(e.name).slice(1).toLowerCase())) out.push(p);
  }
  return out;
}

// Where the samples are, and how often a session starts from each source (weights; a source with no files is left out).
const SOURCE_DEFS = [
  { name: 'generated',     weight: 30 },                                                    // a fresh random document (monkey/gendoc.mjs)
  { name: 'import-audit',  weight: 14, dir: path.join(EMBOSS, 'tests', 'fixtures', 'import-audit') },
  { name: 'real-samples',  weight: 7,  dir: path.join(EMBOSS, 'tests', 'real_samples') },
  { name: 'nimas-samples', weight: 8,  dir: path.join(EMBOSS, 'tests', 'nimas_samples') },
  { name: 'libreoffice',   weight: 6,  dir: path.join(EMBOSS, 'tests', 'fixtures', 'libreoffice') },
  { name: 'test-samples',  weight: 4,  dir: path.join(EMBOSS, 'web', 'test_samples') },
  { name: 'corpus',        weight: 14, dir: path.join(EMBOSS, 'web', 'test_corpus_1000') },   // 1,201 generated files; skipped quietly if missing
  { name: 'extra',         weight: 12 },                                                    // --extra-docs DIR (extreme documents, testers' real books)
  { name: 'curated',       weight: 4 },                                                     // the old fixed list
  { name: 'empty',         weight: 4 },                                                     // nothing loaded
];

// extraDir: --extra-docs (or EMBOSS_MONKEY_DOCS); only: an optional list of source names to restrict to.
export function buildPool({ extraDir, only } = {}) {
  const sources = [];
  for (const def of SOURCE_DEFS) {
    if (only && only.length && !only.includes(def.name)) continue;
    let files = [];
    if (def.name === 'generated' || def.name === 'empty') files = null;
    else if (def.name === 'curated') files = Object.keys(DOCS).filter((k) => DOCS[k].file && !DOCS[k].large && fs.existsSync(DOCS[k].file)).map((k) => resolveDoc(k));
    else if (def.name === 'extra') {
      if (extraDir && fs.existsSync(extraDir)) {
        const base = path.resolve(extraDir);
        files = walk(base).map((f) => registerDoc('extra/' + path.relative(base, f).split(path.sep).join('/'), f, 'extra'));
      }
    } else if (fs.existsSync(def.dir)) {
      files = walk(def.dir).map((f) => registerDoc(path.relative(EMBOSS, f).split(path.sep).join('/'), f, def.name));
    }
    if (files && !files.length) continue;
    sources.push({ name: def.name, weight: def.weight, files });
  }
  return { sources, count: (n) => (sources.find((s) => s.name === n) || { files: [] }).files?.length || 0 };
}

// Draws one document key from the pool with rng. allowBig false: never a file over BIG_BYTES. Big files are rare: one that is
// drawn is kept only 1 time in 8, otherwise drawn again (the same rng, so the run stays reproducible).
// makeGenerated(): called when the 'generated' source is drawn; returns the key of a new generated document.
export function pickDoc(rng, pool, { allowBig = true, makeGenerated, allowEmpty = true } = {}) {
  for (let tries = 0; tries < 30; tries++) {
    const live = pool.sources.filter((s) => (allowEmpty || s.name !== 'empty') && (s.name !== 'generated' || makeGenerated));
    const src = rng.weighted(live.map((s) => [s.weight, s]));
    if (src.name === 'empty') return 'empty';
    if (src.name === 'generated') return makeGenerated();
    const d = rng.pick(src.files);
    if (d.large && (!allowBig || !rng.chance(0.125))) continue;
    return d.key;
  }
  return 'nimas';
}

// A generated document for tag (e.g. "<seed>-s<index>" or "<seed>-s<index>-l2"): written to <outDir>/generated/ and registered.
export function writeGenerated(rng, outDir, tag) {
  const g = genDocument(rng);
  const dir = path.join(outDir, 'generated');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `gen-${tag.replace(/[^a-z0-9_.-]+/gi, '_')}.${g.ext}`);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== g.text) fs.writeFileSync(file, g.text);
  const key = `gen:${tag}`;
  registerDoc(key, file, 'generated');
  registry.get(key).features = g.features;
  return key;
}
export const docFeatures = (key) => (registry.get(key) || {}).features || null;
export const docSource = (key) => { try { return resolveDoc(key).source; } catch { return 'unknown'; } };
export const docFile = (key) => { try { return resolveDoc(key).file; } catch { return null; } };
