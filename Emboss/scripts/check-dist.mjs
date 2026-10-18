// Verify a built dist/ is complete and self-contained.
//
//   node Emboss/scripts/check-dist.mjs            # checks <repo-root>/dist
//   node Emboss/scripts/check-dist.mjs some/dir   # checks another directory
//
// build-dist.mjs runs this as its final step, so a broken build exits 1 before
// deploy-emboss.sh can publish it. It checks that
//   * every file the app needs to start is present (pages, service worker,
//     manifest, both WebAssembly engines, the core UEB liblouis tables, and the
//     third-party notice with the licence texts it names), and
//   * no text file still resolves a path through the project layout: a quoted
//     string starting with /web/ (import specifier, fetch()/URL argument,
//     src/href attribute, precache entry) or any /liblouis/tables reference
//     would 404 when served from the dist root, and
//   * every module the build's scripts import (static `import … from '/x.mjs?v=…'`,
//     dynamic `import('/x.mjs')`, `<script src>`), and every precache entry in sw.js,
//     exists in the dist — build-dist.mjs copies an explicit list, and a module missing
//     from it (four were, Sep 2026) breaks the whole editor once deployed, and
//   * every first-party file reachable from index.html/editor/index.html (script/link/
//     stylesheet references, followed transitively through .mjs/.js/.css) is listed in
//     sw.js's ASSETS precache — build-dist.mjs generates ASSETS from this same scan
//     (see reachableFirstPartyFiles/EXTRA_PRECACHE below), so a module a page actually
//     loads can no longer be missing from the precache list without either a build
//     failure here or a bug in the scan itself (Fable review #8, 26 Sep 2026).
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REQUIRED_FILES = [
  'index.html',
  'editor/index.html',
  'sw.js',
  'manifest.webmanifest',
  'app.mjs',
  'editor/editor.mjs',
  'engine/louis-browser.mjs',
  'engine/liblouis-wasm.js',
  'engine/liblouis-wasm.wasm',
  'engine/mathcat/pkg-web/emboss_mathcat.js',
  'engine/mathcat/pkg-web/emboss_mathcat_bg.wasm',
  'licences/NOTICE-EMBOSS.md',
  'licences/Iconoir-MIT.txt',   // the pages' icons are Iconoir's (MIT): the licence text must travel with every copy, so a build without it fails
  'licences/liblouis-LGPL-2.1.txt',
  'licences/MathCAT-MIT.txt',
  'licences/Temml-MIT.txt',
  'licences/MathLive-MIT.txt',
  'licences/Lexical-MIT.txt',
  'licences/Inter-OFL-1.1.txt',
  'serve.mjs',
];

// The UEB table closure the English translator needs before any locale is
// chosen; all other tables ship too and are loaded on demand by name.
export const REQUIRED_TABLES = [
  'braille-patterns.cti', 'en-ueb-chardefs.uti', 'en-ueb-g1.ctb', 'en-ueb-g2.ctb',
  'en-ueb-math.ctb', 'en-us-brf.dis', 'latinLetterDef6Dots.uti',
  'latinUppercaseComp6.uti', 'spaces.uti', 'text_nabcc.dis', 'unicode.dis',
];

// ---- First-party reachability scan, shared by build-dist.mjs (to generate
// sw.js's ASSETS) and by checkDist below (to catch drift from that generation,
// or from a hand-edit made afterwards). ----
//
// Static analysis only: it follows literal quoted references it can see —
// `<script src>`/`<link href>` in the two shipped HTML pages, `from '...'`/
// `import('...')` in .mjs/.js, `url(...)` in .css, and manifest.webmanifest's
// icon "src" fields — transitively. It deliberately does NOT follow computed
// URLs (template-literal fetch() calls for liblouis tables, locale JSON,
// tactile packs, MathCAT's own wasm fetch): those are legitimately loaded on
// demand, and the small EXTRA_PRECACHE list below covers the ones that must
// still be available before the first offline load.
export const ENTRY_PAGES = ['index.html', 'editor/index.html'];
const RECURSE_EXT = new Set(['.html', '.mjs', '.js', '.css']);
const JS_REF = /(?:from\s*|import\s*\(\s*)(['"`])((?:\.\.?\/|\/(?!\/))[^'"`?#\s]+)(?:\?[^'"`]*)?\1/g;
const HTML_REF = /(?:src|href)\s*=\s*(['"])((?:\.\.?\/|\/(?!\/))[^'"#?]+)(?:\?[^'"]*)?\1/g;
const CSS_REF = /url\(\s*(['"]?)((?:\.\.?\/|\/(?!\/))[^'")?\s]+)(?:\?[^'")]*)?\1\s*\)/g;
const MANIFEST_ICON_REF = /"src"\s*:\s*"(\/[^"]+)"/g;

// The runtime-fetched assets no static reference names literally (computed
// URLs), that still must be in the cache before the app can work offline.
export function extraPrecache(requiredTables = REQUIRED_TABLES) {
  return [
    'build-info.json',
    'engine/liblouis-wasm.wasm',
    'engine/mathcat/pkg-web/emboss_mathcat_bg.wasm',
    'locales/en.json',
    ...requiredTables.map((t) => `tables/${t}`),
  ];
}

function refsIn(rel, text) {
  const ext = path.extname(rel).toLowerCase();
  const out = [];
  if (ext === '.html') for (const m of text.matchAll(HTML_REF)) out.push(m[2]);
  if (ext === '.mjs' || ext === '.js') for (const m of text.matchAll(JS_REF)) out.push(m[2]);
  if (ext === '.css') for (const m of text.matchAll(CSS_REF)) out.push(m[2]);
  if (rel.endsWith('manifest.webmanifest')) for (const m of text.matchAll(MANIFEST_ICON_REF)) out.push(m[1]);
  return out;
}

function resolveRef(rel, ref) {
  if (ref.startsWith('/')) return ref.slice(1);
  // A browser clamps `../` at the site root, so a root file's `../format/x` is
  // /format/x, not something that escapes the dist directory: join under a
  // leading '/' before normalizing so posix.normalize clamps the same way,
  // then strip it back off.
  return path.posix.normalize(path.posix.join('/', path.posix.dirname(rel), ref)).slice(1);
}

// Returns the set of dist-relative paths (posix, no leading slash) reachable
// from `entries` — including the entries themselves — plus any broken
// reference (a target that does not exist in dist), reported separately so
// callers can decide whether that is fatal.
export async function reachableFirstPartyFiles(dist, entries = ENTRY_PAGES) {
  const found = new Set();
  const broken = [];
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (found.has(rel)) continue;
    found.add(rel);
    const abs = path.join(dist, rel);
    if (!(await exists(abs))) { broken.push(rel); continue; }
    const ext = path.extname(rel).toLowerCase();
    if (!RECURSE_EXT.has(ext) && !rel.endsWith('manifest.webmanifest')) continue;
    const text = await fs.readFile(abs, 'utf8');
    for (const ref of refsIn(rel, text)) {
      const target = resolveRef(rel, ref);
      if (!found.has(target)) queue.push(target);
    }
  }
  return { found, broken };
}

const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg']);
const SKIP_DIRS = new Set(['tables', 'licences']);

// Same shape as the rewrite in build-dist.mjs: a path string that *starts*
// with /web/. Anything else containing "/web/" (e.g. an external URL) is fine.
const WEB_PREFIX = /(['"`]|url\()\/web\//;
const TABLES_PREFIX = /\/liblouis\/tables/;

async function* walk(dir, rel = '') {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!rel && SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name), relPath);
    } else {
      yield relPath;
    }
  }
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function checkDist(dist) {
  const problems = [];
  if (!(await exists(dist))) return [`dist directory does not exist: ${dist}`];

  for (const f of REQUIRED_FILES) {
    if (!(await exists(path.join(dist, f)))) problems.push(`missing required file: ${f}`);
  }
  for (const t of REQUIRED_TABLES) {
    if (!(await exists(path.join(dist, 'tables', t)))) problems.push(`missing liblouis table: tables/${t}`);
  }

  for await (const rel of walk(dist)) {
    if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
    const text = await fs.readFile(path.join(dist, rel), 'utf8');
    if (!WEB_PREFIX.test(text) && !TABLES_PREFIX.test(text)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (WEB_PREFIX.test(lines[i])) problems.push(`${rel}:${i + 1}: unrewritten /web/ path`);
      if (TABLES_PREFIX.test(lines[i])) problems.push(`${rel}:${i + 1}: unrewritten /liblouis/tables path`);
    }
  }

  // Every root-relative module reference must resolve to a file in the dist.
  const REF = /(?:from\s*|import\s*\(\s*|src=)(['"`])(\/[^'"`?#\s]+\.(?:mjs|js))(?:\?[^'"`]*)?\1/g;
  for await (const rel of walk(dist)) {
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.mjs' && ext !== '.js' && ext !== '.html') continue;
    const text = await fs.readFile(path.join(dist, rel), 'utf8');
    const seen = new Set();
    for (const m of text.matchAll(REF)) {
      const target = m[2];
      if (seen.has(target)) continue;
      seen.add(target);
      if (!(await exists(path.join(dist, target.slice(1))))) problems.push(`${rel}: imports ${target}, which is not in the dist`);
    }
    // Relative imports too: `../web/zip.mjs` from input/ resolved to /web/zip.mjs in the build.
    const REL = /(?:from\s*|import\s*\(\s*)(['"`])(\.\.?\/[^'"`?#\s]+\.(?:mjs|js))(?:\?[^'"`]*)?\1/g;
    for (const m of text.matchAll(REL)) {
      // A browser clamps `../` at the site root, so a root file's `../format/x` is /format/x.
      const target = path.posix.normalize(path.posix.join('/', path.posix.dirname(rel), m[2])).slice(1);
      if (!(await exists(path.join(dist, target)))) problems.push(`${rel}: imports ${m[2]}, which resolves to /${target} — not in the dist`);
    }
    if (rel === 'sw.js') {
      for (const m of text.matchAll(/'(\/[^']+\.(?:mjs|js|html|json|css|wasm|webmanifest))'/g)) {
        if (!(await exists(path.join(dist, m[1].slice(1))))) problems.push(`sw.js precaches ${m[1]}, which is not in the dist`);
      }
    }
  }

  // Everything the shipped pages actually load must be in sw.js's ASSETS, or a
  // first offline load 404s on it (Fable review #8). Recompute reachability
  // fresh from the dist rather than trusting how ASSETS was generated.
  if (await exists(path.join(dist, 'sw.js'))) {
    const { found: reachable, broken } = await reachableFirstPartyFiles(dist);
    for (const rel of broken) problems.push(`unreachable: ${ENTRY_PAGES.includes(rel) ? rel : 'a page'} references ${rel}, which is not in the dist`);
    const swText = await fs.readFile(path.join(dist, 'sw.js'), 'utf8');
    const assetsMatch = swText.match(/const ASSETS = \[([\s\S]*?)\];/);
    const assets = new Set(
      assetsMatch ? [...assetsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1].slice(1)) : []
    );
    const required = new Set([...reachable, ...extraPrecache()]);
    for (const rel of required) {
      if (!assets.has(rel)) problems.push(`sw.js ASSETS is missing ${rel} (reachable from a shipped page or required to work offline)`);
    }
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dist = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
  const problems = await checkDist(dist);
  if (problems.length) {
    console.error(`check-dist: ${problems.length} problem(s) in ${dist}`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`check-dist: ok (${dist})`);
}
