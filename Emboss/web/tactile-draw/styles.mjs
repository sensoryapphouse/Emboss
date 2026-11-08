// Tactile drawing tool (W14): the dialog's look. Colours come from the page's own tokens (--ink, --muted, --line, --btn-bg, --accent ...), so the
// dialog follows light and dark; the drawing paper stays white (it stands for the embossed page) and the marks on it keep fixed colours that
// read on white.
export const CSS = `
.td-dialog { --td-on-bg: #1a5fb4; --td-on-fg: #fff; width: min(1260px, 97vw); max-width: none; max-height: 96vh; overflow: hidden; padding: 0; border: 1px solid var(--line, #eaebec); border-radius: 12px; background: var(--panel, #fff); color: var(--ink, #444); }
.td-dialog::backdrop { background: rgba(0,0,0,.45); }
.td-body { display: flex; flex-direction: column; gap: 8px; height: min(94vh, 920px); max-height: none !important; padding: 12px 16px; overflow: hidden; }
.td-head { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
.td-head h2 { margin: 0; font-size: 1.2rem; font-weight: 700; color: var(--accent-text, var(--ink, #444)); }
.td-meta { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; flex: 0 0 auto; }
.td-meta label, .td-field label { display: block; font-size: .8rem; color: var(--muted, #5c6462); margin-bottom: 2px; }
.td-dialog input[type="text"], .td-dialog input[type="number"], .td-dialog select { width: 100%; box-sizing: border-box; padding: 5px 8px; border: 1px solid var(--line, #c9cdd1); border-radius: 6px; background: var(--btn-bg, #fff); color: var(--ink, #444); font: inherit; font-size: .88rem; }
.td-bar { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; flex: 0 0 auto; }
.td-group { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.td-btn { border: 1px solid var(--line, #c9cdd1); background: var(--btn-bg, #fff); color: var(--ink, #444); border-radius: 8px; padding: 4px 10px; font: inherit; font-size: .85rem; cursor: pointer; }
.td-btn:hover:not(:disabled) { border-color: var(--accent, #2a7de1); }
.td-btn:disabled { opacity: .5; cursor: default; }
.td-btn[aria-pressed="true"] { background: var(--td-on-bg); color: var(--td-on-fg); border-color: var(--td-on-bg); font-weight: 700; }
.td-btn.primary { background: var(--td-on-bg); color: var(--td-on-fg); border-color: var(--td-on-bg); font-weight: 700; }
:root.dark .td-dialog { --td-on-bg: #e9f2fc; --td-on-fg: #0d1117; }
@media (prefers-color-scheme: dark) { :root:not(.light) .td-dialog { --td-on-bg: #e9f2fc; --td-on-fg: #0d1117; } }
.td-btn.danger { color: var(--danger, #b42318); border-color: var(--danger-line, #f0b4ae); }
.td-dialog :focus-visible { outline: 3px solid #1a5fb4; outline-offset: 1px; }
:root.dark .td-dialog :focus-visible { outline-color: #f5b800; }
.td-check { display: inline-flex; align-items: center; gap: 4px; font-size: .85rem; }
.td-main { display: grid; grid-template-columns: minmax(0, 1fr) 310px; grid-template-rows: minmax(0, 1fr); gap: 12px; flex: 1 1 0; min-height: 0; }
.td-main > * { min-height: 0; }
.td-stage { overflow: auto; border: 1px solid var(--line, #c9cdd1); border-radius: 8px; background: var(--panel-head, #f1f2f3); padding: 8px; min-height: 0; }
.td-svg { display: block; background: #fff; margin: 0 auto; touch-action: none; user-select: none; -webkit-user-select: none; }
.td-dots { display: block; margin: 0 auto; background: var(--td-paper, #fff); max-width: none; }
.td-dots-wrap { --td-paper: #fff; --td-ink: #000; }
.td-paper { fill: #fff; }
.td-gridpt { fill: #c3c8cd; }
.td-page { fill: none; stroke: #6b7280; stroke-width: 1px; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; pointer-events: none; }
.td-sel { fill: none; stroke: #1a5fb4; stroke-width: 1.5px; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; pointer-events: none; }
.td-handle { fill: #fff; stroke: #1a5fb4; stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
.td-warn { fill: none; stroke: #b35900; stroke-width: 2px; vector-effect: non-scaling-stroke; pointer-events: none; }
.td-draft { opacity: .6; pointer-events: none; }
.td-cursor line { stroke: #c2272d; stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
.td-overlay { pointer-events: none; }
.td-overlay .td-handle { pointer-events: all; }
.td-side { overflow: auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; padding-right: 2px; }
.td-panel { border: 1px solid var(--line, #c9cdd1); border-radius: 8px; padding: 8px 10px; }
.td-panel h3 { margin: 0 0 6px; font-size: .9rem; font-weight: 700; }
.td-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; }
.td-fields .wide { grid-column: 1 / -1; }
.td-layers { list-style: none; margin: 0; padding: 0; max-height: 170px; overflow: auto; }
.td-layers li { display: flex; gap: 4px; align-items: center; padding: 1px 0; }
.td-layers .td-layer { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-layers .td-btn { padding: 2px 7px; font-size: .78rem; }
.td-warns { list-style: none; margin: 0; padding: 0; }
.td-warns li { padding: 4px 0; border-top: 1px solid var(--line, #eaebec); font-size: .82rem; }
.td-warns li:first-child { border-top: 0; }
.td-rule { color: var(--muted, #5c6462); font-size: .75rem; }
.td-note { color: var(--muted, #5c6462); font-size: .8rem; margin: 4px 0; }
.td-keyrow { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
.td-keyrow svg { flex: 0 0 auto; background: #fff; border: 1px solid var(--line, #c9cdd1); }
.td-foot { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; border-top: 1px solid var(--line, #eaebec); padding-top: 8px; }
.td-status { flex: 1; font-size: .82rem; color: var(--muted, #5c6462); min-height: 1.2em; }
.td-confirm { display: flex; gap: 8px; align-items: center; }
.td-keys summary { cursor: pointer; font-size: .85rem; }
.td-keys dl { margin: 4px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; font-size: .8rem; }
.td-keys dt { font-weight: 700; }
.td-keys dd { margin: 0; }
@media (max-width: 900px) { .td-main { grid-template-columns: 1fr; } .td-meta { grid-template-columns: 1fr; } }
`;
