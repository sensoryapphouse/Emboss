// Assemble a self-contained, shareable Emboss build in ./dist.
// Copies only the runtime files, rewrites the project-root-absolute paths so the
// app is served from the dist root, and drops in a tiny server + README.
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EMBOSS_DIR, '..');
const DIST = path.join(ROOT, 'dist');

// Every liblouis table ships (dist/tables, ~14 MB): louis-browser.mjs loads
// tables on demand by name, and any of the 112 locales may ask for any of them.
// scripts/check-dist.mjs verifies the core UEB set is present after the build.

// Rewrite the two path prefixes that differ between the project layout and the
// self-contained dist layout: /web/* -> /*  and  /liblouis/tables -> /tables .
//
// The /web/ rewrite is deliberately NOT a blind replaceAll over the file: it
// only touches path strings the app itself resolves — quoted string literals
// (import specifiers, fetch()/URL arguments, src/href attribute values, the
// service-worker precache list) and CSS url() — that BEGIN with /web/. An
// external URL that merely contains "/web/" somewhere in its path is left alone.
const WEB_PREFIX = /(['"`]|url\()\/web\//g;
const rewrite = (s) => s
  .replace(WEB_PREFIX, '$1/')
  // A module under input/ or format/ that imports the app's own files relatively
  // (`../web/zip.mjs`, resolved to /web/… in the project) reaches them at the dist root.
  .replace(/(['"`])\.\.\/web\//g, '$1../')
  .replaceAll('/liblouis/tables', '/tables');

const die = (msg) => { console.error(`build-dist: ${msg}`); process.exit(1); };

// A listed source that is not on disk is a build failure, never a silent gap:
// a missing runtime file would otherwise only surface as a 404 in the field.
async function mustExist(src) {
  try {
    return await fs.stat(src);
  } catch (err) {
    if (err.code === 'ENOENT') die(`missing source file: ${src}\n  (remove it from the copy list if it is genuinely gone, or restore it)`);
    throw err;
  }
}
async function copyRewrite(src, dest) {
  await mustExist(src);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, rewrite(await fs.readFile(src, 'utf8')));
}
async function copyRaw(src, dest) {
  await mustExist(src);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}
async function copyDir(srcDir, destDir) {
  if (!(await mustExist(srcDir)).isDirectory()) die(`not a directory: ${srcDir}`);
  await fs.mkdir(destDir, { recursive: true });
  for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.name.endsWith('.zip')) continue; // Skip large standalone zip in web dist
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyRaw(srcPath, destPath);
    }
  }
}

const resolveSrc = (s) => (s.startsWith('Translate/') || s.startsWith('liblouis/'))
  ? path.join(ROOT, s)
  : path.join(EMBOSS_DIR, s);

await fs.rm(DIST, { recursive: true, force: true });

// text/code assets that may contain paths -> rewrite
for (const [s, d] of [
  ['web/index.html', 'index.html'],
  ['web/app.mjs', 'app.mjs'],
  ['web/sw.js', 'sw.js'],
  ['web/manifest.webmanifest', 'manifest.webmanifest'],
  ['web/style.css', 'style.css'],
  ['web/i18n.mjs', 'i18n.mjs'],
  ['web/locales-data.mjs', 'locales-data.mjs'],
  ['web/settings.mjs', 'settings.mjs'],
  // 17 Oct 2026 (feedback item 9a): the Settings dialog both pages are made from (imported by app.mjs and editor.mjs)
  ['web/settings-panes.mjs', 'settings-panes.mjs'],
  ['web/offline-ready.mjs', 'offline-ready.mjs'],
  // feedback 30 Sep, item 18: the Iconoir interface icons (imported by app.mjs, editor.mjs, braille-render.mjs)
  ['web/icons.mjs', 'icons.mjs'],
  // A89 step 2: Report a problem (imported by app.mjs and editor.mjs)
  ['web/problem-report.mjs', 'problem-report.mjs'],
  ['web/braille-table.mjs', 'braille-table.mjs'],
  ['web/braille-render.mjs', 'braille-render.mjs'],
  ['web/proofread.mjs', 'proofread.mjs'],
  ['web/zip.mjs', 'zip.mjs'],
  ['web/tts.mjs', 'tts.mjs'],
  ['web/handoff-db.mjs', 'handoff-db.mjs'],
  ['web/docx-export.mjs', 'docx-export.mjs'],
  ['web/export-formats.mjs', 'export-formats.mjs'],   // S5d: the txt / Markdown / HTML saves (imported by editor.mjs)
  ['web/build-info.mjs', 'build-info.mjs'],
  ['web/formulas.js', 'formulas.js'],
  ['web/tactile-library.js', 'tactile-library.js'],
  ['web/tactile-browser.mjs', 'tactile-browser.mjs'],
  ['web/editor/index.html', 'editor/index.html'],
  ['web/editor/editor.mjs', 'editor/editor.mjs'],
  // 28 Sep 2026: the editor's autosave (imported by editor.mjs).
  ['web/editor/autosave.mjs', 'editor/autosave.mjs'],
  ['web/word/index.html', 'word/index.html'],
  ['web/word/word.mjs', 'word/word.mjs'],
  ['engine/louis-browser.mjs', 'engine/louis-browser.mjs'],
  ['engine/unicode-nfc.mjs', 'engine/unicode-nfc.mjs'],   // S3a #16: the one NFC implementation louis-browser.mjs imports (louis.mjs, in Node, imports it too)
  ['engine/maths.mjs', 'engine/maths.mjs'],
  ['engine/maths-core.mjs', 'engine/maths-core.mjs'],   // S5b: the pure maths steps engine/maths.mjs imports (the Node test wrapper shares them)
  ['engine/brf-ascii.mjs', 'engine/brf-ascii.mjs'],
  ['engine/mathml-to-latex.mjs', 'engine/mathml-to-latex.mjs'],
  ['format/layout.mjs', 'format/layout.mjs'],
  ['format/page.mjs', 'format/page.mjs'],
  ['format/document.mjs', 'format/document.mjs'],
  ['format/text-style.mjs', 'format/text-style.mjs'],
  ['format/tactile-svg.mjs', 'format/tactile-svg.mjs'],
  ['format/math-plotter.mjs', 'format/math-plotter.mjs'],
  ['format/tiger-raster.mjs', 'format/tiger-raster.mjs'],
  ['format/index-raster.mjs', 'format/index-raster.mjs'],
  ['format/spooler.mjs', 'format/spooler.mjs'],
  ['format/tactile-display.mjs', 'format/tactile-display.mjs'],
  ['format/pef.mjs', 'format/pef.mjs'],
  ['format/ebraille.mjs', 'format/ebraille.mjs'],
  // format/ebraille.mjs is an adapter over the shared eBraille writer, which
  // imports its own unzip; both must travel or the export 404s in the build.
  ['Translate/ebraille.mjs', 'Translate/ebraille.mjs'],
  ['Translate/xml.mjs', 'Translate/xml.mjs'],   // Translate/ebraille.mjs's XML parser (f755ce69, reading other producers' eBraille)
  ['Translate/unmxl.mjs', 'Translate/unmxl.mjs'],
  ['format/cover.mjs', 'format/cover.mjs'],
  ['Translate/braille-codes.mjs', 'Translate/braille-codes.mjs'],
  ['Translate/ueb-maths-to-latex.mjs', 'Translate/ueb-maths-to-latex.mjs'],
  ['Translate/ueb-symbols.mjs', 'Translate/ueb-symbols.mjs'],
  ['Translate/ueb-rules.mjs', 'Translate/ueb-rules.mjs'],
  ['Translate/nemeth-symbols.mjs', 'Translate/nemeth-symbols.mjs'],
  ['Translate/nemeth-rules.mjs', 'Translate/nemeth-rules.mjs'],
  ['Translate/math-speech.mjs', 'Translate/math-speech.mjs'],
  ['Translate/mathnode.mjs', 'Translate/mathnode.mjs'],
  ['Translate/maths-hybrid.mjs', 'Translate/maths-hybrid.mjs'],
  ['Translate/mode-detect.mjs', 'Translate/mode-detect.mjs'],
  ['Translate/nemeth-switch.mjs', 'Translate/nemeth-switch.mjs'],
  ['Translate/verify.mjs', 'Translate/verify.mjs'],
  ['Translate/docx.mjs', 'Translate/docx.mjs'],
  ['format/styles.mjs', 'format/styles.mjs'],
  ['input/parse.mjs', 'input/parse.mjs'],
  ['input/nimas-export.mjs', 'input/nimas-export.mjs'],
  ['input/omml.mjs', 'input/omml.mjs'],
  // Added in Sep 2026 (A25, A2, A4, G15). check-dist.mjs now also resolves every import
  // in the build, so a module missing from this list fails the build instead of the site.
  ['format/cell-markup.mjs', 'format/cell-markup.mjs'],
  // 24 Sep 2026: the optional-field registry (imported by input/nimas-export.mjs and the editor).
  ['format/field-registry.mjs', 'format/field-registry.mjs'],
  ['format/cell-dom.mjs', 'format/cell-dom.mjs'],
  ['input/load-audit.mjs', 'input/load-audit.mjs'],
  ['input/nimas-package.mjs', 'input/nimas-package.mjs'],
  // 25 Sep 2026: old-style Word equations (Equation Editor 3.0 / MathType OLE objects):
  // mtef.mjs is imported by input/parse.mjs, cfb.mjs (OLE compound files) by mtef.mjs.
  ['input/mtef.mjs', 'input/mtef.mjs'],
  ['input/cfb.mjs', 'input/cfb.mjs'],
  // metafile.mjs (WMF/EMF → SVG) and table-kind.mjs (layout vs data tables) are imported by parse.mjs and doc.mjs.
  ['input/metafile.mjs', 'input/metafile.mjs'],
  ['input/table-kind.mjs', 'input/table-kind.mjs'],
  // 25 Sep 2026: the Word 97–2003 .doc reader (imported by input/parse.mjs).
  ['input/doc.mjs', 'input/doc.mjs'],
  ['input/doc-fib.mjs', 'input/doc-fib.mjs'],
  ['input/doc-props.mjs', 'input/doc-props.mjs'],
  ['input/doc-art.mjs', 'input/doc-art.mjs'],
  // 25 Sep 2026: the language of a passage (foreign-language runs; imported by input/parse.mjs and input/doc.mjs).
  ['input/lang.mjs', 'input/lang.mjs'],
  // 28 Sep 2026: the title page's print copy (imported by the editor).
  ['format/titlepage-print.mjs', 'format/titlepage-print.mjs'],
]) await copyRewrite(resolveSrc(s), path.join(DIST, d));

await copyRaw(path.join(EMBOSS_DIR, 'web/logo.svg'), path.join(DIST, 'logo.svg'));
for (const sz of [16, 32, 64, 80, 128, 512]) {
  await copyRaw(path.join(EMBOSS_DIR, `web/logo-${sz}.png`), path.join(DIST, `logo-${sz}.png`));
}
// Referenced by <link rel="apple-touch-icon"> in both shipped pages; was missing
// from this list (check-dist's new reachability scan below now catches this class
// of bug at build time instead of it surfacing as a 404 in the field).
await copyRaw(path.join(EMBOSS_DIR, 'web/apple-touch-icon.png'), path.join(DIST, 'apple-touch-icon.png'));
// Sample NIMAS book (used by tests/nimas_*.test.mjs against a served dist).
await copyRaw(path.join(EMBOSS_DIR, 'web/large-nimas.xml'), path.join(DIST, 'large-nimas.xml'));
await copyRaw(path.join(EMBOSS_DIR, 'web/vendor/temml.min.js'), path.join(DIST, 'vendor/temml.min.js'));
// editor: Lexical bundle + MathLive (with its fonts/sounds)
await copyRaw(path.join(EMBOSS_DIR, 'web/editor/vendor-lexical.mjs'), path.join(DIST, 'editor/vendor-lexical.mjs'));
await copyRaw(path.join(EMBOSS_DIR, 'web/vendor/mathlive.min.js'), path.join(DIST, 'vendor/mathlive.min.js'));
await copyRaw(path.join(EMBOSS_DIR, 'web/vendor/speech-script.js'), path.join(DIST, 'vendor/speech-script.js'));
await copyDir(path.join(EMBOSS_DIR, 'web/fonts'), path.join(DIST, 'fonts'));
await copyDir(path.join(EMBOSS_DIR, 'web/vendor/fonts'), path.join(DIST, 'vendor/fonts'));
await copyDir(path.join(EMBOSS_DIR, 'web/vendor/sounds'), path.join(DIST, 'vendor/sounds'));
await copyDir(path.join(EMBOSS_DIR, 'web/tactile-assets'), path.join(DIST, 'tactile-assets'));
// i18n.mjs tries `/web/locales/<lang>.json` then `/locales/<lang>.json`; the
// rewrite above turns the first into the second, so only dist/locales is fetched.
await copyDir(path.join(EMBOSS_DIR, 'web/locales'), path.join(DIST, 'locales'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/liblouis-wasm.js'), path.join(DIST, 'engine/liblouis-wasm.js'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/liblouis-wasm.wasm'), path.join(DIST, 'engine/liblouis-wasm.wasm'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/mathcat/pkg-web/emboss_mathcat.js'), path.join(DIST, 'engine/mathcat/pkg-web/emboss_mathcat.js'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/mathcat/pkg-web/emboss_mathcat_bg.wasm'), path.join(DIST, 'engine/mathcat/pkg-web/emboss_mathcat_bg.wasm'));
await copyDir(path.join(ROOT, 'liblouis/tables'), path.join(DIST, 'tables'));
// Third-party notices and full licence texts (licences/NOTICE-EMBOSS.md names
// each shipped component); they travel with every build, not just the repo.
await copyDir(path.join(ROOT, 'licences'), path.join(DIST, 'licences'));

// a tiny server that serves ITS OWN directory as the web root, with correct MIME
// S1 audit #25/#26: the server's source is its own file (scripts/dist-serve.template.mjs) so a test can run exactly what ships.
const SERVER = await fs.readFile(path.join(EMBOSS_DIR, 'scripts/dist-serve.template.mjs'), 'utf8');
await fs.writeFile(path.join(DIST, 'serve.mjs'), SERVER);

const MAC_LAUNCHER = `#!/bin/bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$PATH"
node serve.mjs
`;
await fs.writeFile(path.join(DIST, 'double-click-to-run.command'), MAC_LAUNCHER, { mode: 0o755 });

const WIN_LAUNCHER = `@echo off
cd /d "%~dp0"
node serve.mjs
`;
await fs.writeFile(path.join(DIST, 'double-click-to-run.bat'), WIN_LAUNCHER);

const README = `Emboss — run locally
===================

Double-click launcher:
  - macOS: Double-click "double-click-to-run.command"
  - Windows: Double-click "double-click-to-run.bat"

Or run from terminal (requires Node.js https://nodejs.org):

    node serve.mjs

This automatically opens http://localhost:8137/editor/index.html in your browser.
Everything runs locally in the browser; no document leaves the machine.

(Note: You cannot double-click index.html directly as a file:// page because browsers block JavaScript ES module imports and WebAssembly WASM loading on file:// URLs for security reasons. The launcher script / node serve.mjs serves the pages over local HTTP so all components load 100% offline.)
`;
await fs.writeFile(path.join(DIST, 'README.txt'), README);

// ---- Build identity + generated cache tags (Fable review #3, #8) ----
// A single build id (the git short hash, "+dirty" if the working tree had
// uncommitted changes) drives both dist/build-info.json (shown in both Help
// dialogs) and the service worker's cache name. It replaces the hand-edited
// `?v=` query tags that used to be bumped on individual import specifiers:
// the live site (checked 26 Sep 2026) sends `Cache-Control: public,
// max-age=0, must-revalidate` with a strong ETag on every asset, so the
// browser already revalidates with the server on every use — no query-string
// cache-buster is needed for HTTP-cache correctness. The one thing that DOES
// need a fresh identity per deploy is the service worker's own Cache Storage
// entry (`caches.open(CACHE)`); sw.js's `activate` handler deletes every older
// `emboss-` cache (never another app's: audit #29), so bumping it here forces a full,
// clean re-precache (via `cache: 'reload'`) and drops everything from the
// previous deploy.
let gitHash = 'nogit';
let dirty = false;
try {
  gitHash = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0;
} catch { /* not a git checkout — 'nogit' stands (e.g. a stripped-down artefact) */ }
const BUILD_ID = dirty ? `${gitHash}-dirty` : gitHash;
const BUILD_DATE = new Date().toISOString().slice(0, 10);
// A beta build (feedback 30 Sep item 15, Paul 2 Oct; `./deploy-emboss.sh --beta` sets EMBOSS_BETA=1): both pages carry
// <meta name="emboss-beta" content="1">, so Transcriber tools and the hardware controls stay off and hidden unless a link
// with ?tools=1 unlocks them on that computer (web/settings.mjs betaLocked). The same code; only this marker differs.
const BETA = process.env.EMBOSS_BETA === '1';
// Emboss Plus (`./deploy-emboss.sh --plus` sets EMBOSS_PLUS=1; Paul, 16 Oct 2026, P1): the full build, and both pages carry
// <meta name="emboss-plus" content="1"> so a FIRST visit starts with Transcriber tools on (web/settings.mjs isPlusBuild).
const PLUS = process.env.EMBOSS_PLUS === '1';
if (BETA && PLUS) die('a build cannot be both beta (EMBOSS_BETA=1) and Emboss Plus (EMBOSS_PLUS=1)');
const MARKER = BETA ? 'emboss-beta' : PLUS ? 'emboss-plus' : null;
if (MARKER) {
  for (const page of ['index.html', 'editor/index.html']) {
    const file = path.join(DIST, page);
    const html = await fs.readFile(file, 'utf8');
    if (!/<head[^>]*>/i.test(html)) die(`${MARKER} build: no <head> in ${page}`);
    await fs.writeFile(file, html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="${MARKER}" content="1" />`));
  }
}
await fs.writeFile(path.join(DIST, 'build-info.json'), JSON.stringify({ hash: BUILD_ID, date: BUILD_DATE, ...(BETA ? { beta: true } : {}), ...(PLUS ? { plus: true } : {}) }, null, 2) + '\n');

// Regenerate sw.js's CACHE name and ASSETS from the dist file list itself:
// ASSETS = every first-party file reachable from index.html/editor/index.html
// (scripts, stylesheets, their transitive imports, manifest icons) plus a
// short list of runtime-fetched extras no static reference names literally
// (see check-dist.mjs). A module newly added to a page's import graph is
// picked up automatically instead of needing a hand-edit to sw.js.
const { reachableFirstPartyFiles, extraPrecache } = await import('./check-dist.mjs');
const { found: reachable, broken } = await reachableFirstPartyFiles(DIST);
if (broken.length) die(`page(s) reference file(s) not in dist: ${broken.join(', ')}`);
// MathLive's fonts and sounds are fetched by MathLive at run time (no page names them, so the reachability scan cannot see them):
// precache them too, or an equation draws in a fallback font with no network (found by tests/test-offline-dist.mjs, Paul 10 Oct 2026).
const mathliveFiles = [];
for (const dir of ['vendor/fonts', 'vendor/sounds']) {
  try { for (const f of await fs.readdir(path.join(DIST, dir))) if (/\.(woff2|wav)$/.test(f)) mathliveFiles.push(`${dir}/${f}`); } catch { /* not built: nothing to add */ }
}
const assetPaths = [...new Set([...reachable, ...extraPrecache(), ...mathliveFiles])].sort().map((p) => '/' + p);
const swPath = path.join(DIST, 'sw.js');
let swSrc = await fs.readFile(swPath, 'utf8');
if (!/const CACHE = '[^']*';/.test(swSrc)) die('sw.js: could not find "const CACHE = \'...\';" to rewrite');
if (!/const ASSETS = \[[\s\S]*?\];/.test(swSrc)) die('sw.js: could not find "const ASSETS = [...];" to rewrite');
swSrc = swSrc.replace(/const CACHE = '[^']*';/, `const CACHE = 'emboss-${BUILD_ID}';`);
swSrc = swSrc.replace(/const ASSETS = \[[\s\S]*?\];/, 'const ASSETS = [\n' + assetPaths.map((p) => `  '${p}',`).join('\n') + '\n];');
await fs.writeFile(swPath, swSrc);
console.log(`build-info: ${BUILD_ID} (${BUILD_DATE})${BETA ? ' — BETA build (Transcriber tools and hardware controls locked; ?tools=1 unlocks)' : PLUS ? ' — PLUS build (the full build; Transcriber tools on for a first visit)' : ''}; sw.js cache "emboss-${BUILD_ID}", ${assetPaths.length} precached assets`);

console.log('built dist/ at', DIST);

// Last step: verify the build is complete and self-contained (required files
// present, no /web/ or /liblouis/tables path left unrewritten). A failed check
// fails the build, so a broken dist is never deployed by deploy-emboss.sh.
const { checkDist } = await import('./check-dist.mjs');
const problems = await checkDist(DIST);
if (problems.length) {
  console.error(`build-dist: check-dist found ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('check-dist: ok');
