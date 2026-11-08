// Tactile drawing tool (W14): the one module the editor loads (on demand, the first time a drawing is opened).
// The editor gives this module a `host` (its settings, its braille translator, and how to read, change and insert a graphic block), so the
// drawing tool needs no knowledge of the editor's internals.
//
//   host = {
//     cells(), lines(),                     // the template's braille page
//     translate(print) -> unicode braille,  // the document's braille code (liblouis)
//     fallback(print) -> unicode braille,   // used if translate gives nothing
//     announce(msg),                        // the page's own live region (optional)
//     read(key) -> {svg, title, alt} | null,            // a graphic block's content
//     update(key, {svg, title, alt}),                   // save a drawing into an existing block
//     insert({svg, title, alt}),                        // save a drawing into a new block
//   }
import { openTactileDraw } from './dialog.mjs';
export { openTactileDraw };

/** Open the drawing dialog for a new graphic (no key) or an existing graphic block (its key). */
export async function drawTactileGraphic(host, key = null) {
  const current = key ? host.read(key) : null;
  if (key && !current) return { saved: false };
  return openTactileDraw({
    svg: current ? current.svg : '',
    title: current ? current.title : '',
    alt: current ? current.alt : '',
    cells: host.cells(), lines: host.lines(),
    translate: host.translate, fallback: host.fallback, announce: host.announce,
    saveLabel: key ? 'Save changes' : 'Save to document',
    onSave: (v) => { if (key) host.update(key, v); else host.insert(v); },
  });
}

/**
 * Add the "Draw a tactile graphic" entries to the editor's Insert menu and to the graphic library dialog. Both are Transcriber tools (class
 * fmt-transcriber: the page hides it while Transcriber tools is off), like all tactile graphics (Paul, 4 Nov 2026, D2).
 */
export function installTactileDrawEntries(open) {
  const graphicBtn = document.getElementById('btnGraphic');
  if (graphicBtn && !document.getElementById('btnDrawGraphic')) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'btnDrawGraphic'; b.className = 'insert-item fmt-transcriber'; b.setAttribute('role', 'menuitem');
    b.innerHTML = '<span class="insert-icon" aria-hidden="true"><svg aria-hidden="true" focusable="false" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.125em"><path d="M3 21l3.5-1 12-12a2.1 2.1 0 00-3-3l-12 12L3 21z" stroke-linecap="round" stroke-linejoin="round"/></svg></span> <span class="insert-lbl">Draw a tactile graphic</span>';
    graphicBtn.after(b);
    b.addEventListener('click', () => { document.getElementById('insertDropdown')?.setAttribute('hidden', ''); document.getElementById('btnInsertMenu')?.setAttribute('aria-expanded', 'false'); open(); });
  }
  const search = document.getElementById('graphicSearch');
  if (search && !document.getElementById('graphicDrawBtn')) {
    const row = search.parentElement;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'graphicDrawBtn'; b.className = 'tb-btn fmt-transcriber'; b.textContent = 'Draw a tactile graphic';
    b.style.cssText = 'padding:6px 14px; border:1px solid var(--line); border-radius:8px; background:var(--btn-bg); color:var(--ink); font-size:.88rem; font-weight:600; cursor:pointer;';
    row.append(b);
    b.addEventListener('click', () => { document.getElementById('graphicDialog')?.close(); open(); });
  }
}
