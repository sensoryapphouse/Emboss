// Code that runs inside the page for the monkey test (Emboss/scripts/monkey-test.mjs): installed with addInitScript, before the
// app starts. It must be a plain function (it is serialised and sent to the browser).
//
//   window.__embossPerf   - the editor records a [label, ms] mark per render step while this is an array; the test uses the
//                           'render:start' / 'render:formatDocument' marks to know when a render has finished.
//   window.__mk.modelId   - a number for each distinct window.lastModel object (changes whenever a render finishes).
//   window.__mk.sig()     - where the caret is, as a short string (see the comments inside).
//   window.__mk.atEdge()  - whether there is nowhere further to go from the caret in a direction.
//   window.__mk.renders() - [started, finished] render counts.
//   window.__mk.caretOk() - is the focus / caret somewhere sensible (not lost to document.body)?
export function pageInit(settingsJson) {
  // The settings this run starts with. Only when the browser holds none yet: a reload, a second tab, and the move to Quick Mode and
  // back must keep the settings the session has changed since (they are written by the page itself), not start again from these.
  try { if (localStorage.getItem('emboss-settings') === null) localStorage.setItem('emboss-settings', settingsJson); } catch { /* storage blocked: the app falls back to defaults */ }
  window.__embossPerf = [];
  const ids = new WeakMap();
  let nextId = 1;
  const CARDS = '.doc-table-block,.doc-image-block,.doc-break,.doc-print-page,.emboss-sidebar-card,math-field';
  const editor = () => document.getElementById('editor');
  const topOf = (n, ed) => { while (n && n.parentNode !== ed) n = n.parentNode; return n; };
  const pathOf = (node, ed) => {
    const p = [];
    for (let n = node; n && n !== ed; n = n.parentNode) p.push(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
    return p.reverse().join('.');
  };
  const caretRect = (r) => {
    let rc = r.getClientRects()[0];
    if (!rc || (rc.width === 0 && rc.height === 0 && rc.top === 0)) {
      const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      rc = el && el.getBoundingClientRect();
    }
    return rc;
  };
  window.__mk = {
    // Backspace pressed where nothing can take it (the focus or the caret is not in something editable) and that no handler of
    // the page dealt with: in Playwright's WebKit that is "Back" and leaves Emboss. It is stopped here and counted, so a session
    // goes on; the test reports it as an observation (it may be only that engine's default — see the report).
    backspaceBack: [],
    // One short string per block of window.lastModel: its type and its content, ignoring the keys a saved file adds (ids, render,
    // _key). Two editors holding the same document give the same list (the save/reopen check compares them).
    blockSigs() {
      const m = window.lastModel;
      // (a saved file adds ids, pageType "normal", alttext / altimg / display / namespace declarations and prefixes: not content)
      const drop = new Set(['_key', 'id', 'render', 'resources', 'bytes', 'altimg', 'alttext', 'src', 'pageType']);
      const mml = (s) => s.replace(/\s(xmlns(:\w+)?|alttext|altimg|display)="[^"]*"/g, '').replace(/<(\/?)\w+:/g, '<$1').replace(/<\/?math\s*>/g, '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
      const norm = (v) => JSON.stringify(v, (k, x) => (drop.has(k) ? undefined : (k === 'mathml' && typeof x === 'string') ? mml(x) : x));
      return (m && Array.isArray(m.blocks) ? m.blocks : []).map((b) => `${b.type}|${norm(b).slice(0, 1500)}`);
    },
    modelId() {
      const m = window.lastModel;
      if (!m || typeof m !== 'object') return 0;
      if (!ids.has(m)) ids.set(m, nextId++);
      return ids.get(m);
    },
    renders() {
      const a = window.__embossPerf || [];
      let s = 0, f = 0;
      for (const x of a) { if (x[0] === 'render:start') s++; else if (x[0] === 'render:formatDocument') f++; }
      return [s, f];
    },
    // The caret position as a string: "sel:<block>" when a card is selected as a whole, "mf:<n>:<pos>" inside an equation,
    // "out:<tag>#<id>" when the focus is on another control, "none" when there is no caret in the editor, otherwise
    // "<c|r>:<node path>:<offset>[>focus path:offset]" (c = collapsed).
    sig() {
      const ed = editor();
      if (!ed) return 'noeditor';
      const picked = ed.querySelector('.emboss-selected');
      if (picked) return 'sel:' + Array.prototype.indexOf.call(ed.children, topOf(picked, ed) || picked);
      const ae = document.activeElement;
      if (ae && ae.tagName === 'MATH-FIELD') return 'mf:' + Array.prototype.indexOf.call(ed.querySelectorAll('math-field'), ae) + ':' + (ae.position != null ? ae.position : '');
      if (ae && ae !== ed && !ed.contains(ae) && ae !== document.body) return 'out:' + ae.tagName + '#' + ae.id;
      const s = getSelection();
      if (!s || !s.anchorNode || !ed.contains(s.anchorNode)) return 'none';
      const a = pathOf(s.anchorNode, ed) + ':' + s.anchorOffset;
      return (s.isCollapsed ? 'c:' : 'r:') + a + (s.isCollapsed ? '' : '>' + pathOf(s.focusNode, ed) + ':' + s.focusOffset);
    },
    // dir: Up | Down | Left | Right. True when no text or card lies beyond the caret that way (so the key may do nothing).
    atEdge(dir) {
      const ed = editor();
      const picked = ed.querySelector('.emboss-selected');
      if (picked) {
        const i = Array.prototype.indexOf.call(ed.children, topOf(picked, ed) || picked);
        return (dir === 'Up' || dir === 'Left') ? i <= 0 : i >= ed.children.length - 1;
      }
      const s = getSelection();
      if (!s || !s.rangeCount) return true;
      const r = s.getRangeAt(0);
      const probe = document.createRange();
      try {
        if (dir === 'Up' || dir === 'Left') { probe.setStart(ed, 0); probe.setEnd(r.startContainer, r.startOffset); }
        else { probe.setStart(r.endContainer, r.endOffset); probe.setEnd(ed, ed.childNodes.length); }
      } catch { return true; }
      const txt = probe.toString().replace(/\s/g, '');
      const frag = probe.cloneContents();
      const hasCard = !!(frag.querySelector && frag.querySelector(CARDS));
      if (!txt.length && !hasCard) return true;
      if (dir === 'Left' || dir === 'Right') return false;
      const cr = caretRect(r);
      if (!cr) return false;
      const rects = Array.from(probe.getClientRects()).filter((x) => x.width > 0 || x.height > 0);
      if (dir === 'Down') return !rects.some((x) => x.top >= cr.bottom - 1);
      return !rects.some((x) => x.bottom <= cr.top + 1);
    },
    // After a click into the text: the focus must be in the editor, or the caret / a selected card must be.
    caretOk() {
      const ed = editor();
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== document.documentElement) return { ok: true };
      const s = getSelection();
      if (s && s.anchorNode && ed.contains(s.anchorNode)) return { ok: true };
      if (ed.querySelector('.emboss-selected')) return { ok: true };
      return { ok: false, active: ae ? ae.tagName : 'null', anchor: s && s.anchorNode ? (s.anchorNode.nodeName + (s.anchorNode.id ? '#' + s.anchorNode.id : '')) : 'none' };
    },
  };
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const sel = getSelection();
    const an = sel && sel.anchorNode;
    const el = an && (an.nodeType === 1 ? an : an.parentElement);
    const ce = el && el.closest ? el.closest('[contenteditable]') : null;
    const field = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const editable = field || (t && t.isContentEditable && (!ce || ce.getAttribute('contenteditable') !== 'false') && !(t.tagName === 'MATH-FIELD'));
    if (t && t.tagName === 'MATH-FIELD') return;
    if (!editable) {
      window.__mk.backspaceBack.push(`target ${t && t.tagName}${t && t.id ? '#' + t.id : ''}, caret in ${el ? el.tagName + '.' + String(el.className).split(' ')[0] : 'nothing'}`);
      e.preventDefault();
    }
  }, false);
}
