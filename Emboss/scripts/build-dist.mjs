// Assemble a self-contained, shareable Emboss build in ./dist.
// Copies only the runtime files, rewrites the project-root-absolute paths so the
// app is served from the dist root, and drops in a tiny server + README.
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  ['web/braille-table.mjs', 'braille-table.mjs'],
  ['web/braille-render.mjs', 'braille-render.mjs'],
  ['web/proofread.mjs', 'proofread.mjs'],
  ['web/zip.mjs', 'zip.mjs'],
  ['web/tts.mjs', 'tts.mjs'],
  ['web/handoff-db.mjs', 'handoff-db.mjs'],
  ['web/docx-export.mjs', 'docx-export.mjs'],
  ['web/formulas.js', 'formulas.js'],
  ['web/tactile-library.js', 'tactile-library.js'],
  ['web/tactile-browser.mjs', 'tactile-browser.mjs'],
  ['web/editor/index.html', 'editor/index.html'],
  ['web/editor/editor.mjs', 'editor/editor.mjs'],
  ['web/word/index.html', 'word/index.html'],
  ['web/word/word.mjs', 'word/word.mjs'],
  ['engine/louis-browser.mjs', 'engine/louis-browser.mjs'],
  ['engine/maths.mjs', 'engine/maths.mjs'],
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
  ['format/cell-dom.mjs', 'format/cell-dom.mjs'],
  ['input/load-audit.mjs', 'input/load-audit.mjs'],
  ['input/nimas-package.mjs', 'input/nimas-package.mjs'],
]) await copyRewrite(resolveSrc(s), path.join(DIST, d));

await copyRaw(path.join(EMBOSS_DIR, 'web/logo.svg'), path.join(DIST, 'logo.svg'));
for (const sz of [16, 32, 64, 80, 128, 512]) {
  await copyRaw(path.join(EMBOSS_DIR, `web/logo-${sz}.png`), path.join(DIST, `logo-${sz}.png`));
}
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
const SERVER = `// Emboss local server. Run:  node serve.mjs
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 8137);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.wasm':'application/wasm',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml' };
for (const e of ['.cti','.ctb','.uti','.dis','.tbl','.utb','.dic','.txt','.md','.brf']) MIME[e]='text/plain; charset=utf-8';
http.createServer(async (req,res)=>{
  let rel=decodeURIComponent(new URL(req.url,'http://x').pathname);
  if(rel==='/')rel='/editor/index.html';
  else if(rel==='/favicon.ico')rel='/logo.svg';
  const abs=path.join(ROOT,rel);
  if(!abs.startsWith(ROOT)){res.writeHead(403).end('forbidden');return;}
  try{const data=await fs.readFile(abs);
    res.writeHead(200,{'Content-Type':MIME[path.extname(abs).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);}catch{res.writeHead(404).end('not found: '+rel);}
}).listen(PORT,()=>{
  const targetUrl = 'http://localhost:' + PORT + '/editor/index.html';
  console.log('Emboss running at ' + targetUrl);
  if (process.env.NO_OPEN !== '1') {
    if (process.platform === 'darwin') exec('open ' + targetUrl);
    else if (process.platform === 'win32') exec('start ' + targetUrl);
    else exec('xdg-open ' + targetUrl);
  }
});
`;
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
