// The small floating box over a run of braille typed with the six keys (X9 / W16, Paul, 4 Nov 2026: A1, B1, C1, D1 and the later addition).
//
// Every run of six-key braille has a light dotted underline (the `.ed-sixkey` class the editor's SixKeyNode puts on it; the style is here, so
// the look lives with the box). The box appears under the run while the pointer is over it and while the caret is in it, and says
//   Replaced print: …   (only for a run that replaced print; an equation is shown as maths, as the editor shows equations)
//   Reads as: …         (the typed braille turned back into print by the braille code in use)
// and, for a run that replaced print, offers "Put the print back". It never takes the keyboard focus (it is not focusable; the button is kept
// out of the tab order and its mouse-down is cancelled, so the caret and any selection stay where they were), it never covers the run it
// describes, it goes with Escape and when the caret and the pointer have left the run. While the caret is in a run the explanation bar says the
// same in words (the box is for the pointer; the bar, and the live region, are for the keyboard and a screen reader).
//
// All the editor knows is passed in (getRun, readsAs, putBack …), so this file holds only the page side and needs no Lexical.

const STYLE_ID = 'sixkey-box-style';
const CSS = `
.ed-sixkey { text-decoration-line: underline; text-decoration-style: dotted; text-decoration-thickness: 1.5px; text-underline-offset: 0.22em; text-decoration-color: rgba(70, 80, 78, 0.55); }
:root.dark .ed-sixkey { text-decoration-color: rgba(176, 186, 196, 0.7); }
@media (prefers-color-scheme: dark) { :root:not(.light) .ed-sixkey { text-decoration-color: rgba(176, 186, 196, 0.7); } }
#sixkeyBox { position: fixed; z-index: 60; max-width: min(34rem, calc(100vw - 16px)); box-sizing: border-box; padding: 6px 10px 7px; border: 1px solid var(--line, #d0d4d8); border-radius: 8px;
  background: var(--bg, #fff); color: var(--ink, #1b1f23); font: 0.85rem/1.4 system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18); pointer-events: auto; }
#sixkeyBox[hidden] { display: none; }
#sixkeyBox .skb-row { margin: 1px 0; overflow-wrap: anywhere; }
#sixkeyBox .skb-label { font-weight: 700; }
#sixkeyBox .skb-btn { margin-top: 5px; padding: 3px 10px; font: inherit; font-weight: 600; color: var(--ink, #1b1f23); background: var(--pill-bg, #eef0f2); border: 1px solid var(--line, #b9bec3); border-radius: 6px; cursor: pointer; }
#sixkeyBox .skb-btn:hover { border-color: var(--accent, #1f6feb); }
#sixkeyBox .skb-eq { display: inline-block; vertical-align: middle; }
#sixkeyBox .skb-key { color: var(--muted, #5c6462); font-size: 0.78rem; }
`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * opts: {
 *   editorEl,                          the contenteditable
 *   getRun(key) -> { text, print } | null   the run with that node key (print: array of strings / { latex, mathml })
 *   readsAs(text) -> string | null     the typed braille as print, by the braille code in use
 *   putBack(key) -> boolean            put the print back (one undoable change)
 *   t(key, fallback) -> string         a UI string
 *   renderEq(latex) -> html | null     an equation as maths
 *   setBar(html | null)                the explanation bar's content for the run under the caret (null: the bar is free again)
 *   announce(text)                     the live region
 *   typing() -> boolean                the writer is typing (do not announce)
 *   shortcut                           text of the keyboard shortcut for "put the print back", for the explanation bar
 * }
 */
export function initSixkeyBox(opts) {
  const { editorEl } = opts;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  const box = document.createElement('div');
  box.id = 'sixkeyBox';
  box.hidden = true;
  box.setAttribute('role', 'note');
  box.setAttribute('aria-label', opts.t('app.sixkey.box_label', 'Braille typed with the six keys'));
  document.body.appendChild(box);

  let shownEl = null;          // the run's element the box is under
  let hoverEl = null;          // the run the pointer is over (or in the box of)
  let caretEl = null;          // the run the caret is in
  let dismissed = null;        // the run whose box Escape put away, until the caret or pointer leaves it
  let hideTimer = null;
  let lastCaretKey = null;
  let barOwned = false;

  const keyOf = (el) => (el && el.dataset ? el.dataset.sixkey : null);
  const runElOf = (n) => {
    if (!n) return null;
    const el = n.nodeType === 3 ? n.parentElement : n;
    const r = el && el.closest ? el.closest('.ed-sixkey') : null;
    return r && editorEl.contains(r) ? r : null;
  };

  // The words of a run's explanation, as HTML (a row per fact) and as one plain sentence for the bar and the live region.
  function describe(run) {
    const text = String(run.text || '');
    const reads = opts.readsAs ? opts.readsAs(text) : null;
    const readsTxt = reads == null ? opts.t('app.sixkey.reads_na', '(not available)') : (String(reads).trim() || opts.t('app.sixkey.reads_blank', '(nothing)'));
    const printParts = Array.isArray(run.print) && run.print.length ? run.print : null;
    const eqHtml = (latex) => {
      const m = opts.renderEq ? opts.renderEq(latex) : null;
      return m ? `<span class="skb-eq" role="img" aria-label="${esc(opts.t('app.sixkey.equation', 'equation'))} ${esc(latex)}">${m}</span>` : `<span class="skb-eq">${esc(latex ? '$' + latex + '$' : opts.t('app.sixkey.equation', 'equation'))}</span>`;
    };
    const printHtml = printParts ? printParts.map((p) => (typeof p === 'string' ? esc(p).replace(/\n/g, ' ') : eqHtml(p.latex || ''))).join('') : '';
    const printTxt = printParts ? printParts.map((p) => (typeof p === 'string' ? p.replace(/\n/g, ' ') : `${opts.t('app.sixkey.equation', 'equation')} ${p.latex || ''}`)).join('') : '';
    const lbPrint = opts.t('app.sixkey.replaced_print', 'Replaced print:');
    const lbReads = opts.t('app.sixkey.reads_as', 'Reads as:');
    return { printParts, printHtml, readsTxt, lbPrint, lbReads,
      sentence: (printParts ? `${lbPrint} ${printTxt}. ` : '') + `${lbReads} ${readsTxt}.` + (printParts && opts.shortcut ? ' ' + opts.t('app.sixkey.press_to_put_back', 'Press {key} to put the print back.').replace('{key}', opts.shortcut) : '') };
  }

  function render(el) {
    const key = keyOf(el);
    const run = key ? opts.getRun(key) : null;
    if (!run) return null;
    const d = describe(run);
    box.replaceChildren();
    const row = (label, html) => { const r = document.createElement('div'); r.className = 'skb-row'; r.innerHTML = `<span class="skb-label">${esc(label)}</span> ${html}`; box.appendChild(r); };
    if (d.printParts) row(d.lbPrint, d.printHtml);
    row(d.lbReads, esc(d.readsTxt));
    if (d.printParts) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'skb-btn'; b.tabIndex = -1;
      b.textContent = opts.t('app.sixkey.put_back', 'Put the print back');
      b.addEventListener('mousedown', (e) => e.preventDefault());           // the caret and the selection stay where they are
      b.addEventListener('click', () => { const k = keyOf(shownEl); hide(); if (k) opts.putBack(k); });
      box.appendChild(b);
    }
    return d;
  }

  function place(el) {
    const rects = el.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : el.getBoundingClientRect();
    box.style.left = '0px'; box.style.top = '0px';
    const bw = box.offsetWidth, bh = box.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    let left = Math.min(Math.max(8, r.left), Math.max(8, vw - bw - 8));
    let top = r.bottom + 6;
    if (top + bh > vh - 4 && r.top - bh - 6 >= 4) top = r.top - bh - 6;     // no room below: above the run, never over it
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
  }

  function show(el) {
    if (!el || !el.isConnected || dismissed === el) return;
    const d = render(el);
    if (!d) { hide(); return; }
    shownEl = el;
    box.hidden = false;
    place(el);
  }
  function hide() { clearTimeout(hideTimer); hideTimer = null; box.hidden = true; shownEl = null; }
  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hideTimer = null; if (!hoverEl && !caretEl) hide(); }, 180);
  }

  // What should be showing now: the run under the caret (it wins, the writer is working there), else the run under the pointer.
  function refresh() {
    const want = caretEl && caretEl.isConnected ? caretEl : (hoverEl && hoverEl.isConnected ? hoverEl : null);
    if (!want) { if (!hideTimer) hide(); }
    else { clearTimeout(hideTimer); hideTimer = null; if (dismissed !== want) show(want); else hide(); }
    // the explanation bar and the live region follow the caret
    if (caretEl && caretEl.isConnected) {
      const key = keyOf(caretEl);
      const run = key ? opts.getRun(key) : null;
      if (run) {
        const d = describe(run);
        opts.setBar(`<span class="ri-note sixkey-explain" style="color:var(--ink)"><strong>${esc(opts.t('app.sixkey.bar_title', 'Braille typed with the six keys.'))}</strong> ${esc(d.sentence)}</span>`);
        barOwned = true;
        if (key !== lastCaretKey) { lastCaretKey = key; if (!opts.typing()) opts.announce(d.sentence); }
        return;
      }
    }
    lastCaretKey = null;
    if (barOwned) { barOwned = false; opts.setBar(null); }
  }

  function onSelection() {
    const sel = window.getSelection();
    let el = null;
    if (sel && sel.rangeCount && sel.isCollapsed && editorEl.contains(sel.anchorNode)) {
      el = runElOf(sel.anchorNode);
      if (!el && sel.anchorNode.nodeType === 1) el = runElOf(sel.anchorNode.childNodes[sel.anchorOffset - 1]) || null;   // a caret between nodes, right after a run
    }
    if (el !== caretEl) { if (dismissed && dismissed !== el) dismissed = null; caretEl = el; }
    refresh();
  }
  document.addEventListener('selectionchange', onSelection);

  editorEl.addEventListener('mouseover', (e) => {
    const el = runElOf(e.target);
    if (el === hoverEl) return;
    hoverEl = el;
    if (el && dismissed && dismissed !== el) dismissed = null;
    if (el) refresh(); else hideSoon();
  });
  editorEl.addEventListener('mouseleave', () => { hoverEl = null; if (dismissed && dismissed !== caretEl) dismissed = null; hideSoon(); });
  box.addEventListener('mouseenter', () => { clearTimeout(hideTimer); hideTimer = null; if (shownEl) hoverEl = shownEl; });
  box.addEventListener('mouseleave', () => { hoverEl = null; hideSoon(); });

  // Escape puts the box away (it is not consumed: in six-key mode it still ends that mode, as it always did)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !box.hidden) { dismissed = shownEl; hide(); }
  }, true);
  window.addEventListener('scroll', () => { if (!box.hidden && shownEl) place(shownEl); }, true);
  window.addEventListener('resize', () => { if (!box.hidden && shownEl) place(shownEl); });

  return {
    /** call after the document (and so the run's text or print) changed */
    refresh() { requestAnimationFrame(() => { onSelection(); }); },
    hide,
    /** true while the explanation bar shows a run's explanation */
    barOwned: () => barOwned,
    /** for tests */
    state: () => ({ visible: !box.hidden, shownKey: keyOf(shownEl), caretKey: keyOf(caretEl), hoverKey: keyOf(hoverEl) }),
  };
}
