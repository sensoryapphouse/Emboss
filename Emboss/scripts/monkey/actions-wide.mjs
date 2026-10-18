// The wider range of random actions (A89 step 3, Paul 2 Oct 2026: "broaden the scope/range of the test"), added to the ones in
// monkey/actions.mjs. Same rules: an action is a small plain object, everything random is drawn when the list is made, and what
// depends on the page is stored as a fraction or an index taken modulo what is there at the time, so any subset of a list can be
// replayed (that is how failures are shrunk) and a list is exactly reproducible from its seed.
//
//   selOp        a selection across several blocks (Shift+arrows, Shift+click, select all, a triple click, Shift+PageDown) followed
//                by cut, copy + paste elsewhere, delete, typing over it, a style from #blockStyle, or bold/italic/underline
//   dragText     a mouse drag of selected text to another place (Alt held: a copy)
//   insertAll    one item of the Insert menu, taken by index (a session cycles through them all; see `sweep`)
//   slashAll     one slash command, by index (typed "/", then Down, Enter)
//   undoRun      10-30 undos (and some redos), one after the other
//   setting      one setting changed through the Settings dialog in the middle of editing: standard (BANA/UKAAF), grade 1/2,
//                maths code (UEB/Nemeth), page size preset, Transcriber tools, interface language (right-to-left ones too, then
//                back to English a few actions later)
//   colorScheme  light / dark (page.emulateMedia)
//   phone        a phone-width window (390x844, 360x740) and, later, back
//   zoom         browser zoom with the keyboard (Cmd/Ctrl + = - 0) or CSS zoom on the page (and back to 100% later)
//   roundTrip    ← Quick Mode and back to the editor (Advanced editor): the document must arrive and survive
//   secondTab    a second tab on the same origin: edit in it, close it
//   expert       the Ctrl/Cmd+Shift+Backslash expert toggle (adds Graphic to the Insert menu and expert slash commands), and back
//   check        the slow invariants of monkey/checks.mjs (save/reopen, recovery, heap, settle time)
//
// `sweep` sessions (1 in 5) are made mostly of insertAll / slashAll so every Insert item and every slash command is tried.
import {
  genOne, EDITOR_WEIGHTS, QUICK_WEIGHTS, genText, MOD, Skip, T, pause, regionPoint, closeDialogs, dialogOpen, visibleEnabled, clickIf, pickFrom,
  loadDoc, shiftArrow, focusBlock, runAction, isSkip,
} from './actions.mjs';
import { readDoc } from './docs.mjs';
import { saveReopenCheck, recoveryCheck, perfCheck, hookErrors, normaliseXml, firstDiffs } from './checks.mjs';
import { settleEditor, settleQuick } from './settle.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(`timeout after ${ms} ms: ${what}`), { isTimeout: true })), ms))]);

export const WIDE_TYPES = new Set(['selOp', 'dragText', 'insertAll', 'slashAll', 'undoRun', 'setting', 'colorScheme', 'phone', 'zoom', 'roundTrip', 'secondTab', 'check', 'expert']);

const WIDE_EDITOR = [[7, 'selOp'], [2.5, 'dragText'], [2, 'insertAll'], [2.5, 'slashAll'], [1.5, 'undoRun'], [4, 'setting'], [0.7, 'colorScheme'], [0.8, 'phone'], [1, 'zoom'], [0.9, 'roundTrip'], [0.8, 'secondTab'], [0.6, 'expert']];
const WIDE_QUICK = [[5, 'setting'], [1, 'colorScheme'], [1, 'phone'], [1, 'zoom'], [1.2, 'roundTrip']];
// the interface languages tried: a few left-to-right ones and the right-to-left ones (Arabic, Hebrew, Persian, Yiddish)
const UI_LANGS = ['ar', 'he', 'fa', 'yi', 'ar', 'he', 'fr', 'de', 'es', 'ru', 'ja', 'zhc', 'ko', 'el', 'hi', 'pt', 'it', 'pl'];
const PHONES = [[390, 844], [360, 740], [414, 896]];
const ZOOMS = [0.5, 0.75, 1.25, 1.5, 2, 3];

// docKeys: documents a mid-session load may pick. opts: { sweep, checks (add 'check' actions every 15-25 actions) }
export function genActionsWide(rng, kind, n, docKeys, opts = {}) {
  const quick = kind === 'quick';
  const weights = (quick ? QUICK_WEIGHTS : EDITOR_WEIGHTS).map(([w, t]) => [t === 'load' ? w * 1.7 : w, t]).concat(quick ? WIDE_QUICK : WIDE_EDITOR);
  if (opts.sweep && !quick) for (const p of weights) if (p[1] === 'insertAll' || p[1] === 'slashAll') p[0] *= 7;
  const out = [];
  const pending = [];                       // restores owed: [{ at, a }]
  let insertN = rng.int(7), slashN = rng.int(40);
  let nextCheck = opts.checks && !quick ? rng.range(15, 25) : Infinity;
  while (out.length < n) {
    const i = out.length;
    if (pending.length && pending[0].at <= i) { out.push(pending.shift().a); continue; }
    if (i >= nextCheck) {
      out.push({ t: 'check', which: rng.weighted([[5, 'save'], [3, 'recovery'], [3, 'perf'], [1, 'all']]) });
      nextCheck = i + rng.range(15, 25);
      continue;
    }
    const t = rng.weighted(weights);
    if (!WIDE_TYPES.has(t)) { out.push(genOne(rng, kind, t, docKeys)); continue; }
    const owe = (a, lo = 4, hi = 16) => { if (rng.chance(0.85)) pending.push({ at: i + rng.range(lo, hi), a }); pending.sort((x, y) => x.at - y.at); };
    switch (t) {
      case 'selOp': {
        const ext = rng.weighted([[4, 'shiftDown'], [2, 'shiftUp'], [2, 'shiftClick'], [1, 'selectAll'], [1, 'shiftPage'], [1, 'triple'], [1, 'shiftEnd']]);
        const op = ext === 'selectAll'
          ? rng.weighted([[3, 'style'], [2, 'format'], [1, 'copyPaste'], [1, 'typeOver'], [1, 'delete'], [1, 'cut']])
          : rng.weighted([[3, 'cut'], [4, 'copyPaste'], [3, 'delete'], [3, 'typeOver'], [3, 'style'], [1, 'format']]);
        out.push({ t, fx: rng.frac(), fy: rng.frac(), ext, n: rng.range(1, 10), fx2: rng.frac(), fy2: rng.frac(), op, dx: rng.frac(), dy: rng.frac(), key: rng.pick(['Backspace', 'Delete']), text: genText(rng), f: rng.frac(), fmt: rng.pick(['b', 'i', 'u']) });
        break;
      }
      case 'dragText':
        out.push({ t, fx: rng.frac(), fy: rng.frac(), ext: rng.weighted([[3, 'shiftEnd'], [3, 'shiftDown'], [2, 'dbl'], [2, 'triple']]), n: rng.range(1, 4), tx: rng.frac(), ty: rng.frac(), alt: rng.chance(0.2) });
        break;
      case 'insertAll': out.push({ t, i: insertN++ }); break;
      case 'slashAll': out.push({ t, pf: rng.frac(), i: slashN++, q: rng.chance(0.15) ? rng.pick(['h', 'l', 'b', 'p']) : '', end: rng.weighted([[8, 'Enter'], [1, 'Escape']]) }); break;
      case 'undoRun': out.push({ t, n: rng.range(10, 30), redo: rng.chance(0.6) ? rng.range(3, 15) : 0 }); break;
      case 'setting': {
        const what = quick ? rng.weighted([[3, 'standard'], [3, 'grade'], [2, 'pageSize'], [3, 'ui']]) : rng.weighted([[3, 'standard'], [3, 'grade'], [2, 'mathCode'], [2, 'pageSize'], [2, 'tools'], [3, 'ui']]);
        const a = { t, what, close: rng.pick(['escape', 'button']) };
        if (what === 'standard') a.val = rng.pick(['ukaaf', 'bana']);
        else if (what === 'grade') a.val = rng.chance(0.5) ? 'g1' : 'g2';
        else if (what === 'mathCode') a.val = rng.pick(['auto', 'ueb', 'nemeth']);
        else if (what === 'pageSize') a.v = rng.frac();
        else if (what === 'tools') a.val = rng.chance(0.5);
        else { a.lang = rng.pick(UI_LANGS); }
        out.push(a);
        if (what === 'ui') owe({ t, what: 'ui', lang: 'en', close: 'escape' }, 3, 14);
        break;
      }
      case 'colorScheme': { const v = rng.pick(['dark', 'dark', 'light']); out.push({ t, v }); if (v === 'dark') owe({ t, v: 'light' }, 5, 25); break; }
      case 'phone': { const [w, h] = rng.pick(PHONES); out.push({ t, w, h }); owe({ t, w: 1300, h: 900 }, 3, 14); break; }
      case 'zoom': {
        if (rng.chance(0.5)) { out.push({ t, how: 'key', dir: rng.pick(['in', 'in', 'out']), n: rng.range(1, 4) }); owe({ t, how: 'key', dir: 'reset', n: 1 }, 3, 12); }
        else { out.push({ t, how: 'css', z: rng.pick(ZOOMS) }); owe({ t, how: 'css', z: 1 }, 3, 12); }
        break;
      }
      case 'roundTrip': out.push({ t }); break;
      case 'expert': out.push({ t }); owe({ t }, 5, 20); break;
      case 'secondTab': {
        const ops = [];
        for (let k = rng.range(1, 4); k > 0; k--) ops.push(rng.weighted([[5, { k: 'type', text: genText(rng) }], [2, { k: 'enter' }], [2, { k: 'undo' }], [1, { k: 'load', doc: rng.pick(docKeys && docKeys.length ? docKeys : ['nimas']) }], [1, { k: 'selall' }]]));
        out.push({ t, ops, keep: rng.pick([300, 1500, 3000]) });
        break;
      }
      default: throw new Error('unknown wide action ' + t);
    }
  }
  return out;
}

// ---------------------------------------------------------------- doing
async function typeInEditor(page, text) { await page.keyboard.type(text, { delay: 0 }); }

async function waitEditorReady(page, ms = 45000) {
  await page.waitForFunction(() => typeof window.importFile === 'function' && window.lastModel && window.__mk, null, { timeout: ms });
  await sleep(500);
}
async function waitQuickReady(page, ms = 45000) {
  await page.waitForFunction(() => { const s = document.getElementById('status'); return s && s.textContent && !/Loading braille engine/.test(s.textContent) && window.__mk; }, null, { timeout: ms });
  await sleep(400);
}
// On a phone-width window the editor / Advanced editor first asks (feedback 30 Sep item 12): "Open the editor anyway".
async function phoneAnyway(page) {
  const vis = await page.evaluate(() => { const n = document.getElementById('phoneNotice'); return !!(n && !n.hidden && n.offsetWidth > 0); });
  if (vis) await page.click('#phoneNoticeAnyway', { timeout: T, noWaitAfter: true }).catch(() => {});
  return vis;
}
// A collapsed caret in the text of the editor: if the focus or the caret is elsewhere (a card, an equation, a toolbar button), a click
// into a text paragraph (the pf-th of those that have text and no equation) puts it there.
async function ensureTextCaret(page, pf) {
  const ok = async () => (await page.evaluate(() => window.__mk.sig())).startsWith('c:') && (await page.evaluate(() => document.activeElement === document.getElementById('editor')));
  if (await ok()) return true;
  const pt = await page.evaluate((f) => {
    let ps = [...document.querySelectorAll('#editor > p')].filter((p) => p.textContent.trim() && !p.querySelector('math-field,.math-embed'));
    if (!ps.length) ps = [...document.querySelectorAll('#editor > p')];
    if (!ps.length) return null;
    const p = ps[Math.min(ps.length - 1, Math.floor(f * ps.length))];
    p.scrollIntoView({ block: 'center' });
    const r = p.getBoundingClientRect();
    return { x: r.left + Math.min(40, r.width / 2), y: r.top + Math.min(7, r.height / 2) };
  }, pf == null ? 0.5 : pf);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  await pause(page, 60);
  return ok();
}
const selectionLen = (page) => page.evaluate(() => getSelection().toString().length);

export async function runWide(env, a) {
  const { page, kind } = env;
  const res = { viol: [], note: '' };
  const k = (key) => page.keyboard.press(key);
  await closeDialogs(page);
  switch (a.t) {
    // ---- selections and what is done with them
    case 'selOp': {
      const p = await regionPoint(page, '#editor', a.fx, a.fy);
      await page.mouse.click(p.x, p.y);
      await pause(page, 40);
      if (a.ext === 'shiftDown' || a.ext === 'shiftUp') { for (let i = 0; i < a.n; i++) { if (!(await shiftArrow(page, a.ext === 'shiftDown' ? 'ArrowDown' : 'ArrowUp', false, res))) break; } }
      else if (a.ext === 'shiftClick') {
        const q = await regionPoint(page, '#editor', a.fx2, a.fy2);
        await page.keyboard.down('Shift'); await page.mouse.click(q.x, q.y); await page.keyboard.up('Shift');
      } else if (a.ext === 'selectAll') await k(`${MOD}+a`);
      else if (a.ext === 'shiftPage') await k('Shift+PageDown');
      else if (a.ext === 'triple') await page.mouse.click(p.x, p.y, { clickCount: 3 });
      else if (a.ext === 'shiftEnd') await k('Shift+End');
      if (res.viol.length) break;
      const len = await selectionLen(page);
      res.note = `${len} chars selected`;
      switch (a.op) {
        case 'cut': await k(`${MOD}+x`); break;
        case 'copyPaste': {
          await k(`${MOD}+c`);
          const q = await regionPoint(page, '#editor', a.dx, a.dy);
          await page.mouse.click(q.x, q.y);
          await pause(page, 40);
          await k(`${MOD}+v`);
          break;
        }
        case 'delete': await k(a.key); break;
        case 'typeOver': await typeInEditor(page, a.text); break;
        case 'style': {
          if (!(await visibleEnabled(page, '#blockStyle'))) throw new Skip('#blockStyle');
          const opts = await page.evaluate(() => [...document.querySelector('#blockStyle').options].map((o) => o.value));
          const v = pickFrom(opts, a.f);
          res.note += `, style ${v}`;
          await page.selectOption('#blockStyle', v, { timeout: T, force: true });
          break;
        }
        case 'format': await k(`${MOD}+${a.fmt}`); break;
        default: throw new Error('unknown selOp ' + a.op);
      }
      break;
    }
    case 'dragText': {
      const p = await regionPoint(page, '#editor', a.fx, a.fy);
      await page.mouse.click(p.x, p.y, { clickCount: a.ext === 'dbl' ? 2 : a.ext === 'triple' ? 3 : 1 });
      await pause(page, 40);
      if (a.ext === 'shiftEnd') await k('Shift+End');
      else if (a.ext === 'shiftDown') { for (let i = 0; i < a.n; i++) { if (!(await shiftArrow(page, 'ArrowDown', false, res))) break; } }
      if (res.viol.length) break;
      // the middle of the selected text, scrolled into view
      const src = await page.evaluate(() => {
        const s = getSelection();
        if (!s.rangeCount || s.isCollapsed) return null;
        const r = s.getRangeAt(0);
        const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        const rc = [...r.getClientRects()].find((x) => x.width > 2 && x.height > 2);
        return rc ? { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2, len: s.toString().length } : null;
      });
      if (!src) throw new Skip('nothing selected to drag');
      const dst = await regionPoint(page, '#editor', a.tx, a.ty);
      const before = await page.evaluate(() => document.getElementById('editor').innerText);
      await page.mouse.move(src.x, src.y);
      await page.mouse.down();
      await page.mouse.move(src.x + 4, src.y + 4, { steps: 2 });
      await page.mouse.move(dst.x, dst.y, { steps: 10 });
      if (a.alt) await page.keyboard.down('Alt');
      await page.mouse.up();
      if (a.alt) await page.keyboard.up('Alt');
      await pause(page, 120);
      const after = await page.evaluate(() => document.getElementById('editor').innerText);
      res.note = `${src.len} chars dragged${a.alt ? ' with Alt' : ''}; ${before === after ? 'the text is unchanged' : `the text changed (${before.length} -> ${after.length} characters)`}`;
      break;
    }

    // ---- every Insert item, every slash command
    case 'insertAll': {
      await clickIf(page, '#btnInsertMenu');
      await pause(page, 60);
      const ids = await page.evaluate(() => [...document.querySelectorAll('#insertDropdown .insert-item')].filter((e) => e.offsetWidth > 0 && !e.disabled).map((e) => e.id));
      if (ids.length) {
        const id = ids[((a.i % ids.length) + ids.length) % ids.length];
        res.note = id;
        await page.click('#' + id, { timeout: T, noWaitAfter: true }).catch(() => {});
        await pause(page, 200);
      }
      await closeDialogs(page);
      await k('Escape').catch(() => {});
      break;
    }
    case 'slashAll': {
      // the menu opens for a "/" at the start of a word, with a plain text caret (not in a card or an equation)
      if (!(await ensureTextCaret(page, a.pf))) throw new Skip('no text caret to type a slash at');
      await page.keyboard.type(' /' + a.q, { delay: 0 });
      await pause(page, 150);
      const names = await page.evaluate(() => [...document.querySelectorAll('#slashList > *')].map((e) => e.id.replace(/^slash-opt-/, '')));
      if (!names.length) { res.note = 'no slash menu'; await k('Escape').catch(() => {}); break; }
      const idx = ((a.i % names.length) + names.length) % names.length;
      res.note = `${names[idx]} (${idx + 1} of ${names.length})`;
      for (let i = 0; i < idx; i++) await k('ArrowDown');
      await k(a.end);
      await pause(page, 150);
      await closeDialogs(page);
      break;
    }
    case 'undoRun': {
      for (let i = 0; i < a.n; i++) { await k(`${MOD}+z`); await pause(page, 25); }
      for (let i = 0; i < a.redo; i++) { await k(`${MOD}+Shift+z`); await pause(page, 25); }
      break;
    }

    // ---- settings, in the middle of editing
    case 'setting': return runSetting(env, a, res);
    case 'colorScheme': await page.emulateMedia({ colorScheme: a.v }); res.note = a.v; await pause(page, 100); break;
    case 'phone': await page.setViewportSize({ width: a.w, height: a.h }); await pause(page, 250); res.note = `${a.w}x${a.h}`; break;
    case 'zoom': {
      if (a.how === 'key') {
        const key = a.dir === 'in' ? `${MOD}+=` : a.dir === 'out' ? `${MOD}+-` : `${MOD}+0`;
        for (let i = 0; i < a.n; i++) { await k(key); await pause(page, 60); }
        // the browser's own zoom is not reachable from a headless page; the page must simply carry on
      } else {
        await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, a.z);
        res.note = `css zoom ${a.z}`;
      }
      await pause(page, 200);
      break;
    }

    // Ctrl/Cmd+Shift+Backslash: the expert (hardware) toggle, which adds the Graphic item to the Insert menu and the expert slash commands
    case 'expert': await page.keyboard.press(`${MOD}+Shift+Backslash`); await pause(page, 150); res.note = await page.evaluate(() => (document.body.classList.contains('expert-hardware') ? 'expert on' : 'expert off')); break;

    // ---- Quick Mode and back, a second tab
    case 'roundTrip': return runRoundTrip(env, a, res);
    case 'secondTab': {
      if (kind !== 'editor') throw new Skip('editor only');
      const p2 = await env.ctx.newPage();
      try {
        hookErrors(p2, env.errors, 'second tab');
        await p2.goto(`http://localhost:${env.port}/web/editor/index.html`, { waitUntil: 'load', timeout: 60000 });
        await waitEditorReady(p2);
        await phoneAnyway(p2);
        const env2 = { page: p2, renderBias: 0 };
        await p2.click('#editor', { timeout: T }).catch(() => {});
        for (const op of a.ops) {
          if (op.k === 'type') await p2.keyboard.type(op.text, { delay: 0 });
          else if (op.k === 'enter') await p2.keyboard.press('Enter');
          else if (op.k === 'undo') await p2.keyboard.press(`${MOD}+z`);
          else if (op.k === 'selall') await p2.keyboard.press(`${MOD}+a`);
          else if (op.k === 'load') {
            const d = readDoc(op.doc);
            if (d) await withTimeout(p2.evaluate(async ({ b64, name }) => { if (window.markDocumentClean) window.markDocumentClean(); const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await window.importFile(new File([bin], name)); }, d), 60000, 'second tab load');
          }
          await sleep(60);
        }
        await settleEditor(env2, 20000, 250);
        await sleep(a.keep);                       // long enough, now and then, for the second tab's own backup to be written
        const st = await p2.evaluate(() => ({ brf: typeof window.lastBrf, failed: /Braille could not be generated/.test((document.getElementById('braille') || {}).textContent || '') }));
        if (st.failed) res.viol.push({ inv: 'braille-failed', msg: 'in the second tab the braille pane shows "Braille could not be generated"' });
        res.note = `${a.ops.length} step(s) in the second tab`;
      } finally {
        await p2.close({ runBeforeUnload: false }).catch(() => {});
        await page.bringToFront().catch(() => {});
      }
      break;
    }

    // ---- the slow invariants
    case 'check': {
      if (kind !== 'editor') throw new Skip('editor only');
      if (env.large) throw new Skip('too slow with a large document');
      const rs = [await perfCheck(env, env.checkOpts || {})];
      if (a.which === 'save' || a.which === 'all') rs.push(await saveReopenCheck(env, { port: env.port }));
      if (a.which === 'recovery' || a.which === 'all') rs.push(await recoveryCheck(env, { port: env.port }));
      for (const r of rs) { res.viol.push(...r.viol); if (r.note) res.note += (res.note ? '; ' : '') + r.note; }
      break;
    }
    default: throw new Error('unknown wide action ' + a.t);
  }
  return res;
}

// ---------------------------------------------------------------- Settings dialog
async function runSetting(env, a, res) {
  const { page, kind } = env;
  const ids = kind === 'quick'
    ? { standard: 'mode', grade: 'language', pageSize: 'pageSize', ui: 'set-uiLanguage' }
    : { standard: 'set-mode', grade: 'set-language', mathCode: 'set-mathCode', pageSize: 'set-pageSize', tools: 'set-transcriberTools', ui: 'set-uiLanguage' };
  const id = ids[a.what];
  if (!id) throw new Skip(`no ${a.what} setting on this page`);
  await clickIf(page, '#settingsBtn');
  await pause(page, 150);
  // show the panel the control is on
  await page.evaluate((cid) => {
    const e = document.getElementById(cid);
    const panel = e && e.closest('.settings-panel');
    const tab = panel && document.querySelector(`#settingsDialog .tab-btn[data-tab="${panel.id}"]`);
    if (tab) tab.click();
  }, id);
  await pause(page, 100);
  const sel = '#' + id;
  if (a.what === 'tools') {
    const cur = await page.evaluate((s) => document.querySelector(s).checked, sel);
    if (cur !== a.val) await page.click(sel, { timeout: T, force: true, noWaitAfter: true });
    res.note = `Transcriber tools ${a.val ? 'on' : 'off'}`;
  } else {
    const opts = await page.evaluate((s) => [...document.querySelector(s).options].filter((o) => !o.disabled).map((o) => o.value), sel);
    let val = null;
    if (a.what === 'standard' || a.what === 'mathCode') val = opts.includes(a.val) ? a.val : null;
    else if (a.what === 'grade') val = opts.find((o) => new RegExp(`ueb[-_]${a.val}$`, 'i').test(o)) || opts.find((o) => new RegExp(`${a.val}$`, 'i').test(o)) || null;
    else if (a.what === 'pageSize') { const real = opts.filter((o) => o); val = real.length ? pickFrom(real, a.v) : null; }
    else if (a.what === 'ui') val = opts.includes(a.lang) ? a.lang : null;
    if (val == null) { await closeDialogs(page); throw new Skip(`${a.what} option not offered`); }
    await page.selectOption(sel, val, { timeout: T, force: true });
    res.note = `${a.what} = ${val}`;
  }
  await pause(page, a.what === 'ui' ? 500 : 250);
  if (a.close === 'escape') await page.keyboard.press('Escape'); else await page.click('#settingsDialog .dialog-head button, #settingsDialog button[value=close]', { timeout: T, noWaitAfter: true }).catch(() => {});
  await closeDialogs(page);
  return res;
}

// ---------------------------------------------------------------- Quick Mode and back
async function runRoundTrip(env, a, res) {
  const { page, kind } = env;
  const base = `http://localhost:${env.port}`;
  const read = (k2) => page.evaluate((kk) => {
    if (kk === 'editor') { try { return { xml: window.exportCurrentDocumentXml(), brf: typeof window.lastBrf === 'string' ? window.lastBrf.replace(/[\s\f]/g, '').length : 0 }; } catch (e) { return { thrown: String((e && e.stack) || e).slice(0, 300) }; } }
    const p = document.getElementById('preview');
    return { preview: ((p && p.textContent) || '').replace(/\s/g, ''), shown: !!(document.getElementById('result') && !document.getElementById('result').hidden) };
  }, k2);
  env.navOk = true;
  try {
    if (kind === 'editor') {
      const before = await read('editor');
      if (before.thrown) { res.viol.push({ inv: 'save-export', msg: 'the save (exportCurrentDocumentXml) threw: ' + before.thrown }); return res; }
      await clickIf(page, '#backToSimple');
      await page.waitForURL(/\/web\/index\.html/, { timeout: 30000 });
      await waitQuickReady(page);
      env.renderBias = 0;
      const sq = await settleQuick(env, 60000);
      const q = await read('quick');
      res.note = `quick preview ${q.preview.length} chars`;
      if (before.brf > 0 && !q.preview.length && sq.settled) res.viol.push({ inv: 'roundtrip-quick-empty', msg: `the editor held a document with braille (${before.brf} characters) but after "← Quick Mode" Quick Mode's preview is empty` });
      await clickIf(page, '#advancedBtn');
      await sleep(300);
      await phoneAnyway(page);
      await page.waitForURL(/\/web\/editor\/index\.html/, { timeout: 30000 });
      await waitEditorReady(page);
      await phoneAnyway(page);
      await sleep(600);
      const s = await settleEditor(env, 60000, 350);
      const after = await read('editor');
      if (after.thrown) { res.viol.push({ inv: 'save-export', msg: 'after Quick Mode and back, the save (exportCurrentDocumentXml) threw: ' + after.thrown }); return res; }
      if (s.settled && before.brf > 0) {
        const x = normaliseXml(before.xml), y = normaliseXml(after.xml);
        if (x !== y) {
          const d = firstDiffs(x, y, (t) => String(t).replace(/></g, '>\n<').split('\n'));
          res.viol.push({ inv: 'roundtrip-differs', msg: 'the document that came back from Quick Mode is not the one that went there: ' + `before has ${d.la} lines, after has ${d.lb}; first differences: ` + d.diffs.map((z) => `line ${z.n}: before ${JSON.stringify(String(z.a).slice(0, 150))} / after ${JSON.stringify(String(z.b).slice(0, 150))}`).join(' | ') });
        }
      }
    } else {
      const before = await read('quick');
      await clickIf(page, '#advancedBtn');
      await sleep(300);
      await phoneAnyway(page);
      await page.waitForURL(/\/web\/editor\/index\.html/, { timeout: 30000 });
      await waitEditorReady(page);
      await phoneAnyway(page);
      await sleep(600);
      env.renderBias = 0;
      const s = await settleEditor(env, 60000, 350);
      const inEd = await read('editor');
      res.note = `editor braille ${inEd.brf} chars`;
      if (before.preview.length && s.settled && !inEd.brf) res.viol.push({ inv: 'roundtrip-editor-empty', msg: `Quick Mode held a document (preview ${before.preview.length} characters) but after "Advanced editor" the editor has no braille` });
      await clickIf(page, '#backToSimple');
      await page.waitForURL(/\/web\/index\.html/, { timeout: 30000 });
      await waitQuickReady(page);
      await settleQuick(env, 60000);
      const after = await read('quick');
      if (before.preview.length && after.preview !== before.preview) {
        const d = firstDiffs(before.preview, after.preview, (t) => String(t).match(/.{1,60}/g) || [''], 2);
        res.viol.push({ inv: 'roundtrip-differs', msg: `the braille preview after Advanced editor and back is not the one before (${before.preview.length} / ${after.preview.length} characters); first differences: ` + d.diffs.map((z) => `part ${z.n}: before ${JSON.stringify(z.a)} / after ${JSON.stringify(z.b)}`).join(' | ') });
      }
    }
  } finally {
    env.navOk = false;
  }
  return res;
}

// the one entry point for session.mjs
export async function runAnyAction(env, a) {
  if (WIDE_TYPES.has(a.t)) return runWide(env, a);
  return runAction(env, a);
}
export { isSkip };
