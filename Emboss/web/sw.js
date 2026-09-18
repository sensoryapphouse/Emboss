// Offline app shell + engine + tables. Cache-first for known assets.
const CACHE = 'emboss-v91';
const ASSETS = [
  '/web/index.html', '/web/style.css', '/web/app.mjs', '/web/manifest.webmanifest', '/web/logo.svg',
  // manifest icons (PNG) so an installed app keeps its icon offline
  '/web/logo-64.png', '/web/logo-128.png', '/web/logo-512.png',
  // UI localisation: imported by both app.mjs and editor.mjs; the dictionary is fetched
  // with a ?v= cache-buster, which the shell fallback below ignores (ignoreSearch)
  '/web/i18n.mjs', '/web/locales-data.mjs', '/web/locales/en.json',
  '/web/settings.mjs', '/web/braille-table.mjs', '/web/braille-render.mjs', '/web/proofread.mjs', '/web/zip.mjs', '/web/tts.mjs',
  '/web/handoff-db.mjs', '/web/docx-export.mjs', '/web/formulas.js', '/web/tactile-library.js', '/web/tactile-browser.mjs',
  // output + hardware layer (imported by both modes — without these an offline first
  // load of app.mjs fails at import time even though the shell itself is cached)
  '/format/spooler.mjs', '/format/pef.mjs', '/format/ebraille.mjs', '/format/cover.mjs',
  '/format/tactile-display.mjs', '/format/cell-markup.mjs', '/format/cell-dom.mjs',
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
  '/engine/liblouis-wasm.js', '/engine/liblouis-wasm.wasm', '/engine/louis-browser.mjs',
  '/engine/maths.mjs', '/engine/brf-ascii.mjs',
  '/engine/mathcat/pkg-web/emboss_mathcat.js', '/engine/mathcat/pkg-web/emboss_mathcat_bg.wasm',
  '/format/layout.mjs', '/format/page.mjs', '/format/document.mjs', '/format/text-style.mjs',
  '/format/styles.mjs', '/engine/mathml-to-latex.mjs', '/input/nimas-export.mjs',
  '/Translate/nemeth-rules.mjs', '/Translate/mathnode.mjs',
  '/input/parse.mjs', '/input/omml.mjs', '/input/load-audit.mjs', '/input/nimas-package.mjs',
  '/liblouis/tables/braille-patterns.cti', '/liblouis/tables/en-ueb-chardefs.uti',
  '/liblouis/tables/en-ueb-g1.ctb', '/liblouis/tables/en-ueb-g2.ctb',
  '/liblouis/tables/en-ueb-math.ctb', '/liblouis/tables/en-us-brf.dis',
  '/liblouis/tables/latinLetterDef6Dots.uti', '/liblouis/tables/latinUppercaseComp6.uti',
  '/liblouis/tables/spaces.uti', '/liblouis/tables/text_nabcc.dis', '/liblouis/tables/unicode.dis',
];

self.addEventListener('install', (e) => {
  // Cache each asset individually rather than addAll(): addAll is atomic, so a single
  // renamed/404 entry would reject the whole precache and silently leave the app with
  // NO offline cache. Here one bad URL is logged but the rest still cache.
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch((err) => console.warn('[sw] precache failed:', u, err)))))
    .catch((err) => console.warn('[sw] install failed:', err)));
  // No skipWaiting() here: a freshly installed worker WAITS until the page asks for it
  // (SKIP_WAITING message below, sent from the "new version available — Reload" toast).
  // Activating immediately used to swap the cache underneath a running page, so an
  // open editor could load a new module against an old one mid-session.
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match(e.request)))
    );
    return;
  }

  // Everything else (WASM, liblouis tables, MathLive fonts/sounds, images) is large and
  // rarely changes → cache-first, runtime-caching same-origin GETs for offline use.
  e.respondWith(caches.match(e.request).then((hit) => {
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
