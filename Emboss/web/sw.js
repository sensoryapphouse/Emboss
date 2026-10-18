// Offline app shell + engine + tables. Cache-first for known assets.
const CACHE = 'emboss-v121';
const SHELL_WAIT_MS = 3500;   // a page or script the network has not answered in this long comes from the store (when it is stored)
const ASSETS = [
  '/web/index.html', '/web/style.css', '/web/app.mjs', '/web/manifest.webmanifest', '/web/logo.svg',
  // manifest icons (PNG) so an installed app keeps its icon offline
  '/web/logo-64.png', '/web/logo-128.png', '/web/logo-512.png', '/web/apple-touch-icon.png',
  // UI localisation: imported by both app.mjs and editor.mjs; the dictionary is fetched
  // with a ?v= cache-buster, which the shell fallback below ignores (ignoreSearch)
  '/web/i18n.mjs', '/web/locales-data.mjs', '/web/locales/en.json',
  '/web/settings.mjs', '/web/settings-panes.mjs', '/web/offline-ready.mjs', '/web/icons.mjs', '/web/problem-report.mjs', '/web/braille-table.mjs', '/web/braille-render.mjs', '/web/proofread.mjs', '/web/zip.mjs', '/web/tts.mjs',
  '/web/handoff-db.mjs', '/web/docx-export.mjs', '/web/export-formats.mjs', '/web/formulas.js', '/web/tactile-library.js', '/web/tactile-browser.mjs',
  // output + hardware layer (imported by both modes — without these an offline first
  // load of app.mjs fails at import time even though the shell itself is cached)
  '/format/spooler.mjs', '/format/pef.mjs', '/format/ebraille.mjs', '/format/cover.mjs',
  '/format/tactile-display.mjs', '/format/cell-markup.mjs', '/format/cell-dom.mjs',
  // the optional-field registry: imported by input/nimas-export.mjs and the editor
  '/format/field-registry.mjs',
  // the eBraille export is an adapter over the shared writer (2026-09-02); offline
  // export needs the writer and its unzip cached too
  '/Translate/ebraille.mjs', '/Translate/unmxl.mjs',
  '/format/tactile-svg.mjs', '/format/math-plotter.mjs', '/format/tiger-raster.mjs', '/format/index-raster.mjs',
  '/Translate/braille-codes.mjs', '/Translate/ueb-maths-to-latex.mjs', '/Translate/ueb-symbols.mjs', '/Translate/nemeth-symbols.mjs',
  // offline fonts
  '/web/fonts/inter-latin.woff2', '/web/fonts/inter-latin-ext.woff2',
  '/web/fonts/inter-cyrillic.woff2', '/web/fonts/inter-cyrillic-ext.woff2',
  '/web/fonts/inter-greek.woff2', '/web/fonts/inter-greek-ext.woff2',
  '/web/fonts/inter-vietnamese.woff2',
  '/web/fonts/APH_Braille_Shadows.woff2', '/web/fonts/APH_Braille_Shadows.woff', '/web/fonts/APH_Braille_Shadows.ttf',
  // editor mode
  '/web/editor/index.html', '/web/editor/editor.mjs', '/web/editor/vendor-lexical.mjs', '/web/vendor/mathlive.min.js',
  '/web/vendor/temml.min.js', '/web/vendor/speech-script.js',
  '/engine/liblouis-wasm.js', '/engine/liblouis-wasm.wasm', '/engine/louis-browser.mjs', '/engine/unicode-nfc.mjs',
  '/engine/maths.mjs', '/engine/maths-core.mjs', '/engine/brf-ascii.mjs',
  '/engine/mathcat/pkg-web/emboss_mathcat.js', '/engine/mathcat/pkg-web/emboss_mathcat_bg.wasm',
  '/format/layout.mjs', '/format/page.mjs', '/format/document.mjs', '/format/text-style.mjs',
  '/format/styles.mjs', '/engine/mathml-to-latex.mjs', '/input/nimas-export.mjs',
  '/Translate/nemeth-rules.mjs', '/Translate/mathnode.mjs',
  '/input/parse.mjs', '/input/omml.mjs', '/input/load-audit.mjs', '/input/nimas-package.mjs',
  '/input/mtef.mjs', '/input/cfb.mjs', '/input/metafile.mjs', '/input/table-kind.mjs',
  '/input/doc.mjs', '/input/doc-fib.mjs', '/input/doc-props.mjs', '/input/doc-art.mjs', '/input/lang.mjs',
  '/liblouis/tables/braille-patterns.cti', '/liblouis/tables/en-ueb-chardefs.uti',
  '/liblouis/tables/en-ueb-g1.ctb', '/liblouis/tables/en-ueb-g2.ctb',
  '/liblouis/tables/en-ueb-math.ctb', '/liblouis/tables/en-us-brf.dis',
  '/liblouis/tables/latinLetterDef6Dots.uti', '/liblouis/tables/latinUppercaseComp6.uti',
  '/liblouis/tables/spaces.uti', '/liblouis/tables/text_nabcc.dis', '/liblouis/tables/unicode.dis',
];

// Cache ownership (audit 15 Oct, #29): this worker owns only caches named 'emboss-<build>'. Anything else on the same
// origin (another application's cache) is never touched.
const OWN_PREFIX = 'emboss-';

// Required vs optional (audit 15 Oct, #30). Every precache entry is REQUIRED — the install fails, so the previous worker and
// its cache stay in charge — except fonts and sounds (page fonts, MathLive's fonts and sounds: a missing one falls back to a
// system font or silence) and the manifest PNG icons. The shell, every module, the liblouis and MathCAT WASM, the default
// tables, en.json and build-info.json are all required. A pattern rather than a list, so it holds for the source worker
// (/web/...) and for the built one (generated ASSETS, root paths) alike.
const OPTIONAL = /(?:^|\/)(?:fonts|sounds)\/|\.(?:woff2?|ttf|wav|png)$/;
const isRequired = (u) => !OPTIONAL.test(u);

// Fetch one asset into the cache, once more if the first try fails (a dropped connection while updating).
function precache(c, u) {
  const add = () => c.add(new Request(u, { cache: 'reload' }));
  return add().catch(() => add());
}

self.addEventListener('install', (e) => {
  // Cache each asset individually rather than addAll(): addAll is atomic, so one renamed/404 optional file (a font) would
  // reject the whole precache. A REQUIRED asset that still fails after its retry rejects the install, so a half-filled build
  // never takes over and activation never deletes the previous cache. Optional failures are only logged.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((u) => precache(c, u).catch((err) => {
    if (isRequired(u)) throw new Error('[sw] required asset could not be cached: ' + u + ' (' + (err && err.message || err) + ')');
    console.warn('[sw] optional precache failed:', u, err);
  })))));
  // No skipWaiting() here: a freshly installed worker WAITS until the page asks for it
  // (SKIP_WAITING message below, sent from the "new version available — Reload" toast).
  // Activating immediately used to swap the cache underneath a running page, so an
  // open editor could load a new module against an old one mid-session.
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  // Only OLD EMBOSS caches go (#29): not the current one, and not another application's cache on this origin.
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(OWN_PREFIX) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;

  // App shell — HTML navigations + our JS/CSS/JSON modules — use NETWORK-FIRST so a new
  // deploy shows up immediately when online (falling back to cache offline). Cache-first
  // here was the bug: after an update, users kept getting the old app until the SW cycled.
  const isShell = sameOrigin && (e.request.mode === 'navigate' || /\.(?:mjs|js|css|html|webmanifest|json)$/.test(url.pathname));
  if (isShell) {
    // Offline: answer from THIS build's cache only (#29) — never another cache on the origin, so an old build's file or another
    // application's can never be served under this build.
    const fromCache = () => caches.open(CACHE).then((c) => c.match(e.request, { ignoreSearch: true }).then((hit) => hit || c.match(e.request)));
    const net = fetch(e.request).then((res) => {
      if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {}); }
      return res;
    });
    // A network that is slow but not down (18 Oct 2026, Paul: a switch or a reload sometimes "won't"): it was waited for with no limit, so the page
    // neither came nor failed. After SHELL_WAIT_MS this build's stored copy answers instead (the network's answer still refreshes the store);
    // with nothing stored, the network is waited for as before.
    e.respondWith((async () => {
      let timer;
      const late = new Promise((r) => { timer = setTimeout(() => r('late'), SHELL_WAIT_MS); });
      try {
        const first = await Promise.race([net, late]);
        if (first !== 'late') return first;
        const hit = await fromCache();
        net.catch(() => {});   // its answer, when it comes, only refreshes the store
        return hit || await net;
      } catch {
        const hit = await fromCache();
        if (hit) return hit;
        throw new Error('offline and not stored');
      } finally { clearTimeout(timer); }
    })());
    return;
  }

  // Everything else (WASM, liblouis tables, MathLive fonts/sounds, images) is large and
  // rarely changes → cache-first, runtime-caching same-origin GETs for offline use.
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request)).then((hit) => {
    if (hit) return hit;
    return fetch(e.request).then((res) => {
      if (res && res.ok && sameOrigin) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
      }
      return res;
    });
  }));
});
