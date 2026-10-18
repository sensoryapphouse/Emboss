// S4-Q2 (Paul, 17 Oct 2026): tell the user when Emboss can work without the internet. On a first visit the service worker quietly downloads
// everything Emboss needs (the braille tables, the maths engine, the fonts); its install finishes only when that is done
// (sw.js: install waits for the precache), so navigator.serviceWorker.ready - an active worker - means "ready to work offline".
//  - The status line says so ONCE: on the first visit in this browser (no worker controlled the page when it loaded,
//    window.__embossControlledAtLoad, set by the page's own registration script), never again.
//  - Help shows the state beside the version (#offlineState): "Ready to work offline" or "Still getting ready to work offline…".
// No pop-up, no badge. `text(key, fallback)` is the page's translator; `say(message)` puts a message in its status line.
const SAID_KEY = 'emboss-offline-ready-said';

export function watchOfflineReady({ text = (k, f) => f, say = null } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const show = (ready) => {
    const el = document.getElementById('offlineState');
    if (el) el.textContent = ready ? text('app.offline.ready_short', 'Ready to work offline') : text('app.offline.not_yet', 'Still getting ready to work offline…');
  };
  show(!!navigator.serviceWorker.controller);
  navigator.serviceWorker.ready.then(() => {
    show(true);
    let said = false;
    try { said = localStorage.getItem(SAID_KEY) === '1'; } catch { /* no storage: say nothing twice is not guaranteed, saying it is harmless */ }
    try { localStorage.setItem(SAID_KEY, '1'); } catch { /* */ }
    if (said || window.__embossControlledAtLoad) return;   // said before, or not a first visit
    if (typeof say === 'function') say(text('app.offline.ready', 'Emboss is ready to work offline.'));
  }).catch(() => {});
}
