// The random actions of the monkey test (Emboss/scripts/monkey-test.mjs): how they are drawn (genActions) and how each one is
// carried out in the browser (runAction).
//
// An action is a small plain object. Everything random is drawn when the list is made, and anything that depends on the page
// (which card, which menu item) is stored as a fraction 0..1 of what is there at the time, so any subset of a list can be
// replayed (that is how failures are minimised) and every list is exactly reproducible from its seed.
import { readDoc } from './docs.mjs';

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// ---------------------------------------------------------------- what gets typed
export const TOKENS = ['the', 'quick', 'brown', 'fox', 'Braille', 'Emboss', 'a', 'of', 'and', 'to', '12', '3.14', 'x+y=z', '(a)', '"quoted"', "it's", '—', '…', '½', 'é', 'ß', 'Ω', '中文', '😀', 'שלום', 'مرحبا', 'á', 'ﬁ', '#', '*', '<b>', '&amp;', '/', '\\', '1.', '- ', '> ', '```', '$x^2$', '​', ' ', 'A', 'Z', '0', '.', ',', ';', '?', '!', 'http://x.org', 'e.g.', 'Mr.', 'CAPS', '[1]', '{x}'];
const PASTE_TEXT = [
  'one\ntwo\n\nthree',
  'A single pasted line.',
  '\tindented\n\t\tdeeper\nback',
  '1. first\n2. second\n3. third',
  '- bullet one\n- bullet two',
  '# Heading\nbody text\n## Sub\nmore',
  'x'.repeat(3000),
  ('word '.repeat(40) + '\n').repeat(12),
  'שלום עולם\nمرحبا بالعالم\n中文字符\n😀😀😀',
  '',
  '\u0000\u0007 control chars \u001b',
];
const PASTE_HTML = [
  '<p>Pasted <b>bold</b> and <i>italic</i> text.</p>',
  '<h2>A heading</h2><p>and a paragraph</p>',
  '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>',
  '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
  '<table><tr><td>lonely</td></tr></table>',
  '<p>An equation <math><mi>x</mi><mo>+</mo><mn>2</mn></math> inline.</p>',
  '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
  '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="a pixel">',
  '<div><div><div><span>deeply</span> nested</div></div></div>',
  '<p>Broken <b>markup <i>here</p></b>',
  '<ol><li>a</li><li>b</li></ol><hr><blockquote>quote</blockquote><pre>code\n  line</pre>',
  '<a href="http://example.org">a link</a> and <sup>sup</sup> <sub>sub</sub>',
  '<script>window.__x=1</script><style>p{display:none}</style><p>after</p>',
  '<p>' + 'long '.repeat(600) + '</p>',
];
export function genText(rng) {
  const n = rng.weighted([[5, 1], [4, 2], [3, 4], [1, 12]]);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(rng.chance(0.25) ? String.fromCharCode(rng.range(32, 126)) : rng.pick(TOKENS));
  const glue = rng.weighted([[6, ' '], [3, ''], [1, '\n']]);
  return parts.join(glue);
}

// ---------------------------------------------------------------- drawing
export const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const SIZES = [[1300, 900], [1000, 700], [800, 800], [560, 800], [1600, 1000], [1300, 500]];

export const EDITOR_WEIGHTS = [
  [16, 'keyrun'], [9, 'clickText'], [3, 'clickBraille'], [11, 'key'], [3, 'modNav'], [5, 'shiftSel'], [10, 'type'], [4, 'undoRedo'],
  [1.5, 'selectAllType'], [0.5, 'selectAllDelete'], [4, 'blockStyle'], [5, 'menu'], [3, 'format'], [6, 'clickCard'], [3, 'paste'],
  [3, 'insert'], [1, 'resize'], [2, 'slash'], [2, 'scroll'], [2, 'toolbarBtn'], [1.5, 'load'], [1, 'exportXml'], [1, 'download'],
  [0.5, 'save'], [1, 'readAloud'], [1, 'docTitle'], [0.3, 'clear'],
];
export const QUICK_WEIGHTS = [
  [6, 'load'], [10, 'settings'], [3, 'help'], [4, 'download'], [3, 'readAloud'], [5, 'key'], [3, 'clickPreview'], [2, 'scroll'],
  [1, 'resize'], [2, 'type'], [2, 'menu'], [1, 'drop'],
];

// docKeys: the documents a mid-session "load" may pick (never the large one). large: a session on the large document.
export function genActions(rng, kind, n, docKeys) {
  const weights = kind === 'quick' ? QUICK_WEIGHTS : EDITOR_WEIGHTS;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = rng.weighted(weights);
    out.push(genOne(rng, kind, t, docKeys));
  }
  return out;
}

export function genOne(rng, kind, t, docKeys) {
  switch (t) {
    case 'keyrun': {
      const key = rng.weighted([[5, 'ArrowDown'], [4, 'ArrowUp'], [2, 'ArrowLeft'], [2, 'ArrowRight']]);
      return { t, key, n: rng.weighted([[1, 1], [1, 2], [6, rng.range(3, 6)], [2, rng.range(7, 14)]]) };
    }
    case 'clickText': case 'clickBraille': case 'clickPreview': return { t, fx: rng.frac(), fy: rng.frac(), n: rng.weighted([[8, 1], [1.5, 2], [0.5, 3]]) };
    case 'key': {
      const keys = kind === 'quick'
        ? ['Tab', 'Shift+Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']
        : ['Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Enter', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'Backspace', 'Delete', 'Shift+Enter', `${MOD}+Backspace`, 'Alt+Backspace', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+ArrowDown', 'Alt+ArrowUp'];
      return { t, key: rng.pick(keys), n: rng.weighted([[6, 1], [2, rng.range(2, 4)], [1, rng.range(5, 12)]]) };
    }
    case 'modNav': return { t, key: rng.pick(['ArrowUp', 'ArrowDown', 'Home', 'End']), shift: rng.chance(0.2) };
    case 'shiftSel': return { t, key: rng.pick(ARROWS), n: rng.range(1, 12), word: rng.chance(0.2) };
    case 'type': return { t, text: genText(rng) };
    case 'undoRedo': return { t, dir: rng.pick(['undo', 'undo', 'redo']), n: rng.weighted([[5, 1], [2, 2], [1, rng.range(3, 8)]]) };
    case 'selectAllType': return { t, text: genText(rng) };
    case 'selectAllDelete': return { t };
    case 'blockStyle': return { t, f: rng.frac() };
    case 'menu': {
      if (kind === 'quick') return { t, which: rng.pick(['download', 'settings', 'help']), f: rng.frac(), close: rng.pick(['escape', 'click-away']) };
      return { t, which: rng.weighted([[3, 'insert'], [2, 'braille'], [3, 'settings'], [2, 'help']]), f: rng.frac(), g: rng.frac(), close: rng.pick(['escape', 'escape', 'click-away', 'leave']) };
    }
    case 'settings': return { t, tab: rng.frac(), f: rng.frac(), v: rng.frac(), close: rng.pick(['escape', 'button']) };
    case 'help': return { t, close: rng.pick(['escape', 'button']) };
    case 'format': return { t, which: rng.pick(['btnBold', 'btnItalic', 'btnUnderline', 'btnStrike', 'btnScript', 'kbdBold', 'kbdItalic', 'kbdUnderline']) };
    case 'clickCard': return { t, f: rng.frac(), n: rng.weighted([[8, 1], [1, 2]]) };
    case 'paste': return rng.chance(0.55) ? { t, how: 'html', html: rng.pick(PASTE_HTML), text: rng.pick(PASTE_TEXT) } : { t, how: rng.pick(['text', 'text', 'insertText']), text: rng.pick(PASTE_TEXT) };
    case 'insert': return { t, f: rng.frac() };
    case 'resize': { const [w, h] = rng.pick(SIZES); return { t, w, h }; }
    case 'slash': return { t, q: rng.pick(['', '', 'h', 'ta', 'eq', 'li', 'br', 'q', 'zzzz']), down: rng.range(0, 4), end: rng.pick(['Enter', 'Enter', 'Escape', 'Backspace']) };
    case 'scroll': return { t, where: kind === 'quick' ? 'preview' : rng.pick(['editor', 'braille', 'editor']), dy: rng.pick([-3000, -800, -300, 300, 800, 3000]) };
    case 'toolbarBtn': return { t, id: rng.pick(['btnBlockedPara', 'btnDirectionsPara', 'btnBrailleFmt', 'btnUnbox', 'btnTnSuggest', 'btnSixKey', 'btnSymRegen', 'btnTitlepageRegen']), close: rng.pick(['escape', 'button']) };
    case 'load': case 'drop': return { t, doc: kind === 'quick' && !docKeys.length ? 'nimas' : rng.pick(docKeys) };
    case 'exportXml': case 'clear': case 'save': return { t };
    case 'download': return { t, f: rng.frac() };
    case 'readAloud': return { t, n: rng.pick([1, 2, 2]) };
    case 'docTitle': return { t, text: genText(rng) };
    default: throw new Error('unknown action type ' + t);
  }
}

// One line for the log.
export function fmtAction(a) {
  const { t, ...rest } = a;
  const bits = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v) : (v && typeof v === 'object') ? JSON.stringify(v).slice(0, 160) : v}`);
  return `${t}${bits.length ? ' ' + bits.join(' ') : ''}`;
}

// ---------------------------------------------------------------- doing
// Page errors are checked elsewhere; an action that cannot be done at the time (a button that is hidden, a menu item that
// is not there) is skipped, not a failure.
export class Skip extends Error {}
export const isSkip = (e) => e instanceof Skip;

export const T = 2500; // ms: how long a single click/key may wait to be possible
export const pause = async (page, ms = 60) => { await page.waitForTimeout(ms); };

export async function regionPoint(page, sel, fx, fy) {
  const r = await page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: Math.max(b.left, 0), t: Math.max(b.top, 0), r: Math.min(b.right, innerWidth), b: Math.min(b.bottom, innerHeight) };
  }, sel);
  if (!r || r.r - r.l < 4 || r.b - r.t < 4) throw new Skip('region ' + sel + ' not visible');
  return { x: r.l + fx * (r.r - r.l - 1), y: r.t + fy * (r.b - r.t - 1) };
}

export async function dialogOpen(page) { return page.evaluate(() => !!document.querySelector('dialog[open]')); }
export async function closeDialogs(page) {
  if (!(await dialogOpen(page))) return;
  await page.keyboard.press('Escape').catch(() => {});
  await pause(page, 80);
  if (await dialogOpen(page)) await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch { /* already closed */ } }));
}
export async function visibleEnabled(page, sel) {
  return page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || e.disabled || e.hidden) return false;
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  }, sel);
}
export async function clickIf(page, sel) {
  if (!(await visibleEnabled(page, sel))) throw new Skip(sel + ' not available');
  await page.click(sel, { timeout: T, noWaitAfter: true });
}
export const pickFrom = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];

// The generic "change one control in a settings dialog" action, for both pages.
async function changeSetting(page, dialogSel, a) {
  // switch to one of the dialog's tabs (the ones that are shown)
  const tabs = await page.evaluate((d) => [...document.querySelectorAll(`${d} .tab-btn`)].filter((b) => b.offsetWidth > 0).map((b) => b.dataset.tab), dialogSel);
  if (tabs.length) {
    const tab = pickFrom(tabs, a.tab);
    await page.click(`${dialogSel} .tab-btn[data-tab="${tab}"]`, { timeout: T, noWaitAfter: true }).catch(() => {});
    await pause(page, 50);
  }
  // all the shown selects / checkboxes / number inputs of the shown panel, not the ones that leave the page or need hardware
  const ctrls = await page.evaluate((d) => {
    const skip = new Set(['simpleMode', 'set-simpleMode']);
    const out = [];
    for (const e of document.querySelectorAll(`${d} select, ${d} input[type=checkbox], ${d} input[type=number], ${d} input[type=range]`)) {
      if (!e.id || skip.has(e.id) || e.disabled || !e.offsetWidth) continue;
      out.push({ id: e.id, tag: e.tagName, type: e.type, min: e.min, max: e.max, step: e.step });
    }
    return out;
  }, dialogSel);
  if (!ctrls.length) return;
  const c = pickFrom(ctrls, a.f);
  const sel = `#${c.id}`;
  if (c.tag === 'SELECT') {
    const opts = await page.evaluate((s) => [...document.querySelector(s).options].filter((o) => !o.disabled).map((o) => o.value), sel);
    if (!opts.length) return;
    await page.selectOption(sel, pickFrom(opts, a.v), { timeout: T, force: true });
  } else if (c.type === 'checkbox') {
    await page.click(sel, { timeout: T, force: true, noWaitAfter: true });
  } else {
    const lo = Number(c.min) || 0, hi = Number(c.max) || (lo + 100);
    // mostly inside the allowed range, now and then well outside it
    const v = a.v < 0.04 ? -1 : a.v > 0.96 ? 99999 : Math.round(lo + ((a.v - 0.04) / 0.92) * (hi - lo));
    await page.fill(sel, String(v), { timeout: T, force: true });
    await page.keyboard.press('Tab').catch(() => {});
  }
}

// download helper: click `steps` (selectors) and wait for the file the page hands out
async function downloadVia(env, steps, label) {
  const { page } = env;
  const wait = page.waitForEvent('download', { timeout: 12000 }).then((d) => ({ d }), (e) => ({ err: e }));
  try {
    for (const s of steps) await clickIf(page, s);
  } catch (e) { wait.catch(() => {}); throw e; }
  const r = await wait;
  if (r.err) return { expectedDownload: label };
  const p = await r.d.path();
  const fs = await import('node:fs');
  const size = p ? fs.statSync(p).size : 0;
  return { downloaded: { name: r.d.suggestedFilename(), size } };
}

export async function loadDoc(env, key) {
  const { page, kind } = env;
  const d = readDoc(key);
  if (!d) return;   // the empty document: nothing to load
  if (kind === 'quick') {
    await page.setInputFiles('#fileInput', { name: d.name, mimeType: 'application/octet-stream', buffer: Buffer.from(d.b64, 'base64') });
  } else {
    await page.evaluate(async ({ b64, name }) => {
      if (window.markDocumentClean) window.markDocumentClean();
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.importFile(new File([bin], name));
    }, d);
  }
}

// The index of the top-level block the end of the selection is in (null when it is not in the editor's text).
export async function focusBlock(page) {
  return page.evaluate(() => {
    const ed = document.getElementById('editor'); const s = getSelection();
    let n = s && s.focusNode;
    if (!n || !ed || !ed.contains(n)) return null;
    while (n && n.parentNode !== ed) n = n.parentNode;
    return n ? Array.prototype.indexOf.call(ed.children, n) : null;
  });
}
// One Shift+Arrow press (Shift+Alt+Arrow for a word). Invariant 'selection-jump': a single Shift+Up / Shift+Down moves the end of
// the selection by a line, so by at most a few top-level blocks (a run of empty paragraphs or cards is crossed one at a time); a
// jump of more than 4 is the selection running away (seen: Shift+Down in a paragraph with an equation, followed by a break, in
// Chrome, selected to the end of the book). Returns false when a violation was added (the caller stops pressing).
export async function shiftArrow(page, key, word, res) {
  const vertical = (key === 'ArrowUp' || key === 'ArrowDown') && !word;
  const before = vertical ? await focusBlock(page) : null;
  await page.keyboard.press(`Shift+${word ? 'Alt+' : ''}${key}`);
  if (!vertical || before == null) return true;
  await pause(page, 30);
  const after = await focusBlock(page);
  if (after != null && Math.abs(after - before) > 4) {
    res.viol.push({ inv: 'selection-jump', msg: `one ${`Shift+${key}`} moved the end of the selection from top-level block ${before} to block ${after} (${Math.abs(after - before)} blocks in one key press)` });
    return false;
  }
  return true;
}

// Carries one action out. Returns { viol: [{ inv, msg }], note } (viol only for the invariants that need to look inside the action).
export async function runAction(env, a) {
  const { page, kind } = env;
  const res = { viol: [], note: '' };
  const k = (key, opts) => page.keyboard.press(key, opts);
  const dialogNeedingActions = new Set(['menu', 'settings', 'help', 'toolbarBtn', 'insert', 'download', 'save', 'readAloud', 'resize', 'load', 'drop', 'exportXml', 'format', 'blockStyle']);
  if (!dialogNeedingActions.has(a.t)) await closeDialogs(page);

  switch (a.t) {
    // ---- keys
    case 'keyrun': {
      if (kind !== 'editor') { await k(a.key); break; }
      const dir = a.key.slice(5);
      let s = await page.evaluate(() => window.__mk.sig());
      let unchanged = 0;
      for (let i = 0; i < a.n; i++) {
        const before = s;
        await k(a.key);
        await pause(page, 70);
        let after = await page.evaluate(() => window.__mk.sig());
        if (after === before) { await pause(page, 220); after = await page.evaluate(() => window.__mk.sig()); }
        const collapsed = before.startsWith('c:') || before.startsWith('sel:') || before.startsWith('mf:');
        if (after === before && collapsed) {
          unchanged++;
          if (unchanged >= 3 && !(await page.evaluate((d) => window.__mk.atEdge(d), dir))) {
            const inCell = await page.evaluate(() => {
              const a = document.activeElement, n = getSelection().anchorNode, e = n && (n.nodeType === 1 ? n : n.parentElement);
              return !!((a && a.closest && a.closest('.table-cell-input')) || (e && e.closest && e.closest('.table-cell-input')));
            });
            const onBody = await page.evaluate(() => document.activeElement === document.body || document.activeElement === document.documentElement);
            // the keys belong to another control (a toolbar button, Help's button after Help closed): not the text's caret
            const elsewhere = await page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && a !== document.documentElement && !document.getElementById('editor')?.contains(a); });
            if (elsewhere) { unchanged = 0; continue; }
            res.viol.push({ inv: onBody ? 'stuck-focus-on-body' : inCell ? 'stuck-in-table-cell' : after.startsWith('mf:') ? 'stuck-in-equation' : 'stuck', msg: `${a.key} did not move the caret 3 times in a row${onBody ? ' (the focus is on the page itself, not in the editor, so the keys go nowhere)' : inCell ? ' (in a table cell)' : after.startsWith('mf:') ? ' (inside an equation)' : ''} (caret ${after})` });
            break;
          }
        } else unchanged = 0;
        s = after;
      }
      break;
    }
    case 'key':
      for (let i = 0; i < a.n; i++) { await k(a.key); if (a.n > 3) await pause(page, 15); } break;
    case 'modNav': await k(`${a.shift ? 'Shift+' : ''}${MOD}+${a.key}`); break;
    case 'shiftSel': for (let i = 0; i < a.n; i++) { if (!(await shiftArrow(page, a.key, a.word, res))) break; } break;
    case 'type': await page.keyboard.type(a.text, { delay: 0 }); break;
    case 'undoRedo': for (let i = 0; i < a.n; i++) { await k(a.dir === 'undo' ? `${MOD}+z` : `${MOD}+Shift+z`); await pause(page, 30); } break;
    case 'selectAllType': await k(`${MOD}+a`); await page.keyboard.type(a.text, { delay: 0 }); break;
    case 'selectAllDelete': await k(`${MOD}+a`); await k('Backspace'); break;

    // ---- the mouse
    case 'clickText': {
      const p = await regionPoint(page, kind === 'quick' ? '#preview' : '#editor', a.fx, a.fy);
      // What is really at that point: at phone width the explanation bar (footer#statusBar) sits over the bottom of the editor,
      // and a click there is a click on the bar, not in the text (found 3 Oct; typing after it still goes into the document).
      const over = kind === 'editor' ? await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && !e.closest('#editor') ? (e.closest('[id]')?.id || e.tagName) : null; }, p) : null;
      await page.mouse.click(p.x, p.y, { clickCount: a.n });
      await pause(page, 60);
      if (over) res.note = `the click fell on #${over}, over the editor`;
      if (kind === 'editor' && !over) {
        const c = await page.evaluate(() => window.__mk.caretOk());
        if (!c.ok) res.viol.push({ inv: 'caret-lost', msg: `after a click into the text the focus is on ${c.active} and the selection is in ${c.anchor}, not in the editor` });
      }
      break;
    }
    case 'clickPreview': {
      const p = await regionPoint(page, '#preview', a.fx, a.fy);
      await page.mouse.click(p.x, p.y, { clickCount: a.n });
      break;
    }
    case 'clickBraille': {
      const p = await regionPoint(page, '#braille', a.fx, a.fy);
      await page.mouse.click(p.x, p.y, { clickCount: a.n });
      break;
    }
    case 'clickCard': {
      const pt = await page.evaluate((f) => {
        const cards = [...document.querySelectorAll('#editor .doc-image-block, #editor .doc-table-block, #editor .doc-break, #editor .doc-print-page, #editor .emboss-sidebar-card, #editor math-field')];
        if (!cards.length) return null;
        const el = cards[Math.min(cards.length - 1, Math.floor(f * cards.length))];
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + Math.min(b.height / 2, 40), cls: el.className || el.tagName };
      }, a.f);
      if (!pt) throw new Skip('no cards in the document');
      await page.mouse.click(Math.max(1, Math.min(pt.x, 5000)), Math.max(1, pt.y), { clickCount: a.n });
      res.note = String(pt.cls).split(' ')[0];
      break;
    }
    case 'scroll': {
      const p = await regionPoint(page, a.where === 'braille' ? '#braille' : a.where === 'preview' ? '#preview' : '#editor', 0.5, 0.5);
      await page.mouse.move(p.x, p.y);
      await page.mouse.wheel(0, a.dy);
      break;
    }
    case 'resize': await page.setViewportSize({ width: a.w, height: a.h }); await pause(page, 150); break;

    // ---- the page's own controls (editor)
    case 'blockStyle': {
      await closeDialogs(page);
      if (!(await visibleEnabled(page, '#blockStyle'))) throw new Skip('#blockStyle');
      const opts = await page.evaluate(() => [...document.querySelector('#blockStyle').options].map((o) => o.value));
      await page.selectOption('#blockStyle', pickFrom(opts, a.f), { timeout: T, force: true });
      break;
    }
    case 'format': {
      if (a.which.startsWith('kbd')) { await k(`${MOD}+${{ kbdBold: 'b', kbdItalic: 'i', kbdUnderline: 'u' }[a.which]}`); break; }
      await closeDialogs(page);
      await clickIf(page, '#' + a.which);
      break;
    }
    case 'insert': {
      await closeDialogs(page);
      await clickIf(page, '#btnInsertMenu');
      await pause(page, 60);
      const ids = await page.evaluate(() => [...document.querySelectorAll('#insertDropdown .insert-item')].filter((e) => e.offsetWidth > 0 && !e.disabled).map((e) => e.id));
      if (ids.length) {
        const id = pickFrom(ids, a.f);
        res.note = id;
        await page.click('#' + id, { timeout: T, noWaitAfter: true }).catch(() => {});
        await pause(page, 150);
      }
      await closeDialogs(page);
      await k('Escape').catch(() => {});
      break;
    }
    case 'menu': {
      await closeDialogs(page);
      if (kind === 'quick') {
        const btn = { download: '#downloadBtn', settings: '#settingsBtn', help: '#helpBtn' }[a.which];
        await clickIf(page, btn);
        await pause(page, 120);
        if (a.which === 'download') {
          const items = await page.evaluate(() => [...document.querySelectorAll('#downloadMenu button')].filter((e) => e.offsetWidth > 0).map((e) => e.id));
          res.note = items.join(',');
        }
      } else if (a.which === 'insert') {
        await clickIf(page, '#btnInsertMenu');
        await pause(page, 100);
        // hover over the items without choosing one
        const ids = await page.evaluate(() => [...document.querySelectorAll('#insertDropdown .insert-item')].filter((e) => e.offsetWidth > 0).map((e) => e.id));
        if (ids.length) await page.hover('#' + pickFrom(ids, a.g), { timeout: T }).catch(() => {});
      } else if (a.which === 'braille') {
        await clickIf(page, '#downloadBtn');
        await pause(page, 100);
        const ids = await page.evaluate(() => [...document.querySelectorAll('#downloadMenu button')].filter((e) => e.offsetWidth > 0).map((e) => e.id));
        if (ids.length) await page.hover('#' + pickFrom(ids, a.g), { timeout: T }).catch(() => {});
      } else if (a.which === 'settings') {
        await clickIf(page, '#settingsBtn');
        await pause(page, 150);
        await changeSetting(page, '#settingsDialog', { tab: a.f, f: a.g, v: a.f });
        await pause(page, 100);
      } else {
        await clickIf(page, '#helpBtn');
        await pause(page, 150);
      }
      if (a.close === 'escape') await k('Escape');
      else if (a.close === 'click-away') {
        if (await dialogOpen(page)) await k('Escape'); else await page.mouse.click(2, 2).catch(() => {});
      }
      await pause(page, 80);
      if (a.close !== 'leave') await closeDialogs(page);
      else if (await dialogOpen(page)) await closeDialogs(page);   // a modal dialog would lock the rest of the session
      break;
    }
    case 'settings': {
      await closeDialogs(page);
      await clickIf(page, '#settingsBtn');
      await pause(page, 150);
      await changeSetting(page, '#settingsDialog', a);
      await pause(page, 150);
      if (a.close === 'escape') await k('Escape');
      else await page.click('#settingsDialog .dialog-head button, #settingsDialog button[value=close]', { timeout: T, noWaitAfter: true }).catch(() => {});
      await closeDialogs(page);
      break;
    }
    case 'help': {
      await closeDialogs(page);
      await clickIf(page, '#helpBtn');
      await pause(page, 150);
      if (a.close === 'escape') await k('Escape');
      else await page.click('#helpDialog button[value=close], #helpClose', { timeout: T, noWaitAfter: true }).catch(() => {});
      await closeDialogs(page);
      break;
    }
    case 'toolbarBtn': {
      await closeDialogs(page);
      await clickIf(page, '#' + a.id);
      await pause(page, 120);
      if (await dialogOpen(page)) { if (a.close === 'escape') await k('Escape'); await closeDialogs(page); }
      await k('Escape').catch(() => {});
      break;
    }
    case 'slash': {
      await page.keyboard.type('/' + a.q, { delay: 0 });
      await pause(page, 120);
      for (let i = 0; i < a.down; i++) await k('ArrowDown');
      await k(a.end);
      await pause(page, 100);
      await closeDialogs(page);
      break;
    }
    case 'docTitle': {
      await clickIf(page, '#docTitleInput');
      await page.keyboard.type(a.text, { delay: 0 });
      break;
    }
    case 'clear': {
      await closeDialogs(page);
      await clickIf(page, '#btnClear');
      await pause(page, 200);
      await closeDialogs(page);
      break;
    }
    case 'paste': {
      await closeDialogs(page);
      if (a.how === 'insertText') { await page.keyboard.insertText(a.text); break; }
      const r = await page.evaluate(({ html, text }) => {
        const ed = document.getElementById('editor');
        if (!ed) return 'noeditor';
        if (document.activeElement !== ed && !ed.contains(document.activeElement)) ed.focus();
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          if (html) dt.setData('text/html', html);
          const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          (document.activeElement && ed.contains(document.activeElement) ? document.activeElement : ed).dispatchEvent(ev);
          return 'dispatched';
        } catch (e) { return 'unsupported:' + e.message; }
      }, { html: a.how === 'html' ? a.html : '', text: a.text });
      if (r.startsWith('unsupported')) { await page.keyboard.insertText(a.text); res.note = 'insertText instead (' + r + ')'; }
      break;
    }
    case 'exportXml': {
      const r = await page.evaluate(() => {
        if (typeof window.exportCurrentDocumentXml !== 'function') return { skip: true };
        try {
          const xml = window.exportCurrentDocumentXml();
          const doc = new DOMParser().parseFromString(xml, 'application/xml');
          const bad = doc.querySelector('parsererror');
          return { len: String(xml).length, bad: bad ? bad.textContent.slice(0, 200) : null };
        } catch (e) { return { thrown: String((e && e.stack) || e).slice(0, 400) }; }
      });
      if (r.skip) throw new Skip('no exportCurrentDocumentXml');
      if (r.thrown) res.viol.push({ inv: 'save-export', msg: 'the save (exportCurrentDocumentXml) threw: ' + r.thrown });
      else if (r.bad) res.viol.push({ inv: 'save-export', msg: 'the save (exportCurrentDocumentXml) is not well-formed XML: ' + r.bad });
      res.note = `${r.len} chars`;
      break;
    }
    case 'download': case 'save': {
      await closeDialogs(page);
      let r;
      if (a.t === 'save') r = await downloadVia(env, ['#saveDocBtn'], 'the saved document');
      else if (kind === 'quick') r = await downloadVia(env, ['#downloadBtn', '#downloadBrfItem'], 'a BRF');
      else r = await downloadVia(env, ['#downloadBtn', '#downloadBrfItem'], 'a BRF');
      if (r.downloaded) {
        res.note = `${r.downloaded.name} ${r.downloaded.size} bytes`;
        if (!r.downloaded.size) res.viol.push({ inv: 'download-empty', msg: `the download ${r.downloaded.name} is empty` });
      } else if (r.expectedDownload && (await env.hasContent())) {
        res.viol.push({ inv: 'download-missing', msg: `clicking the download for ${r.expectedDownload} gave no file within 12 s although there is a document` });
      }
      await closeDialogs(page);
      await k('Escape').catch(() => {});
      break;
    }
    case 'readAloud': {
      await closeDialogs(page);
      const btn = kind === 'quick' ? ((await visibleEnabled(page, '#readBtn')) ? '#readBtn' : '#dzReadBtn') : '#btnRead';
      for (let i = 0; i < a.n; i++) { await clickIf(page, btn); await pause(page, 250); }
      break;
    }

    // ---- documents
    case 'load': case 'drop': {
      await closeDialogs(page);
      if (a.t === 'drop' && kind === 'quick') {
        const d = readDoc(a.doc);
        if (!d) throw new Skip('empty doc');
        await page.evaluate(async ({ b64, name }) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bin], name));
          const dz = document.getElementById('dropzone');
          for (const type of ['dragenter', 'dragover', 'drop']) dz.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
        }, d);
      } else await loadDoc(env, a.doc);
      res.note = a.doc;
      break;
    }
    default: throw new Error('unknown action ' + a.t);
  }
  return res;
}
