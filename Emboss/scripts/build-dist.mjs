// Assemble a self-contained, shareable Emboss build in ./dist.
// Copies only the runtime files, rewrites the project-root-absolute paths so the
// app is served from the dist root, and drops in a tiny server + README.
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const EMBOSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EMBOSS_DIR, '..');
const DIST = path.join(ROOT, 'dist');

const TABLES = [
  'braille-patterns.cti', 'en-ueb-chardefs.uti', 'en-ueb-g1.ctb', 'en-ueb-g2.ctb',
  'en-ueb-math.ctb', 'en-us-brf.dis', 'latinLetterDef6Dots.uti',
  'latinUppercaseComp6.uti', 'spaces.uti', 'text_nabcc.dis', 'unicode.dis',
];

// Rewrite the two path prefixes that differ between the project layout and the
// self-contained dist layout: /web/* -> /*  and  /liblouis/tables -> /tables .
const rewrite = (s) => s
  .replaceAll('/web/', '/')
  .replaceAll('/liblouis/tables', '/tables');

async function copyRewrite(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, rewrite(await fs.readFile(src, 'utf8')));
}
async function copyRaw(src, dest) {
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
async function copyDir(srcDir, destDir) {
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
  ['engine/louis-browser.mjs', 'engine/louis-browser.mjs'],
  ['engine/maths.mjs', 'engine/maths.mjs'],
  ['engine/brf-ascii.mjs', 'engine/brf-ascii.mjs'],
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
]) await copyRewrite(resolveSrc(s), path.join(DIST, d));

await copyRaw(path.join(EMBOSS_DIR, 'web/logo.svg'), path.join(DIST, 'logo.svg'));
await copyRaw(path.join(EMBOSS_DIR, 'web/large-nimas.xml'), path.join(DIST, 'large-nimas.xml'));
await copyRaw(path.join(EMBOSS_DIR, 'web/large-nimas.xml'), path.join(DIST, 'web/large-nimas.xml'));
await copyRaw(path.join(EMBOSS_DIR, 'web/vendor/temml.min.js'), path.join(DIST, 'vendor/temml.min.js'));
// editor: Lexical bundle + MathLive (with its fonts/sounds)
await copyRaw(path.join(EMBOSS_DIR, 'web/editor/vendor-lexical.mjs'), path.join(DIST, 'editor/vendor-lexical.mjs'));
await copyRaw(path.join(EMBOSS_DIR, 'web/editor/nimas_slice.json'), path.join(DIST, 'editor/nimas_slice.json'));
await copyRaw(path.join(EMBOSS_DIR, 'web/editor/nimas_full.json'), path.join(DIST, 'editor/nimas_full.json'));
await copyRaw(path.join(EMBOSS_DIR, 'web/vendor/mathlive.min.js'), path.join(DIST, 'vendor/mathlive.min.js'));
await copyRaw(path.join(EMBOSS_DIR, 'web/vendor/speech-script.js'), path.join(DIST, 'vendor/speech-script.js'));
await copyDir(path.join(EMBOSS_DIR, 'web/fonts'), path.join(DIST, 'fonts'));
await copyDir(path.join(EMBOSS_DIR, 'web/vendor/fonts'), path.join(DIST, 'vendor/fonts'));
await copyDir(path.join(EMBOSS_DIR, 'web/vendor/sounds'), path.join(DIST, 'vendor/sounds'));
await copyDir(path.join(EMBOSS_DIR, 'web/tactile-assets'), path.join(DIST, 'tactile-assets'));
await copyDir(path.join(EMBOSS_DIR, 'web/locales'), path.join(DIST, 'locales'));
await copyDir(path.join(EMBOSS_DIR, 'web/locales'), path.join(DIST, 'web/locales'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/liblouis-wasm.js'), path.join(DIST, 'engine/liblouis-wasm.js'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/liblouis-wasm.wasm'), path.join(DIST, 'engine/liblouis-wasm.wasm'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/mathcat/pkg-web/emboss_mathcat.js'), path.join(DIST, 'engine/mathcat/pkg-web/emboss_mathcat.js'));
await copyRaw(path.join(EMBOSS_DIR, 'engine/mathcat/pkg-web/emboss_mathcat_bg.wasm'), path.join(DIST, 'engine/mathcat/pkg-web/emboss_mathcat_bg.wasm'));
await copyDir(path.join(ROOT, 'liblouis/tables'), path.join(DIST, 'tables'));

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
