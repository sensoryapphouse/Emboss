// One monkey session (Emboss/scripts/monkey-test.mjs): a fresh browser context, one page, one document, a list of actions, and
// the invariants checked after each action. Also the failure artefacts and the minimiser (delta debugging).
import fs from 'node:fs';
import path from 'node:path';
import { pageInit } from './pageinit.mjs';
import { isSkip, fmtAction, loadDoc, closeDialogs } from './actions.mjs';
import { runAnyAction } from './actions-wide.mjs';
import { saveReopenCheck, recoveryCheck, perfCheck, consoleText } from './checks.mjs';
import { settleEditor, settleQuick } from './settle.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(`timeout after ${ms} ms: ${what}`), { isTimeout: true })), ms))]);

// ---------------------------------------------------------------- messages that are not bugs
// Each entry: [test on "<source>: <message>", why it is harmless]. Add to this list only with a reason.
export const KNOWN_HARMLESS = [
  [/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i, 'a browser notice about layout observers, raised by MathLive / the panes when the window is resized; no effect on the page'],
  [/Image corrupt or truncated/i, 'Firefox says so when a document\'s own picture cannot be decoded (the Markdown fixture m04-notes-images-html.md carries a PNG that is cut short); the document is the cause, and Emboss shows the picture card regardless'],
  [/\/tables\/[^\s:]+:\d+: warning:/i, 'liblouis prints a warning about a line in one of its own braille tables (e.g. "literal is deprecated, use compbrl instead" in en-g3.ctb) through console.error when the table is first read; a table-authoring notice, not a fault of the page'],
  [/XML Parsing Error: not well-formed/i, 'Firefox logs its own XML parse error to the console when a document that is not well-formed is parsed (several files of web/test_corpus_1000 are not: an unescaped & in a <meta> value, say); Chrome and WebKit say nothing. The input is the cause; what the page does with the file is checked by the other invariants (added by the wide run, 2 Oct)'],
  [/\/tables\/[^\s:]+(,\/tables\/[^\s:]+)*: \d+ warnings? issued/i, 'the summary line liblouis prints after the per-line table warnings above ("/tables/unicode.dis,/tables/en-g3.ctb: 20 warnings issued") when the grade 3 table is first read (the random Settings action picks "English grade 3"); about the table files themselves, not the page (added by the wide run, 2 Oct)'],
];
export function isHarmless(src, msg) {
  const s = `${src}: ${msg}`;
  return KNOWN_HARMLESS.find(([re]) => re.test(s)) || null;
}

// What counts as "the same bug" while minimising: the invariant, plus (for errors) the message with its numbers blurred.
export function violationKey(v) {
  const blur = (m) => String(m).split('\n')[0].replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 90);
  if (v.inv === 'save-reopen') { const m = /first differing block: ([\w -]+)\]/.exec(String(v.msg)); return m ? `save-reopen: ${m[1]}` : 'save-reopen'; }   // by the kind of block that changed
  return (v.inv === 'page-error' || v.inv === 'console-error') ? `${v.inv}: ${blur(v.msg)}` : v.inv;
}

const URLS = { editor: '/web/editor/index.html', quick: '/web/index.html' };

// (settleEditor / settleQuick: monkey/settle.mjs)

// ---------------------------------------------------------------- invariants that look at the page
export async function checkEditorState(env) {
  const v = [];
  const st = await env.page.evaluate(() => {
    const b = document.getElementById('braille');
    const ed = document.getElementById('editor');
    const kids = [...ed.children];
    // an empty paragraph, or one with only empty equations (an equation with nothing in it makes no block), is not expected in the model
    const textOf = (e) => { const c = e.cloneNode(true); c.querySelectorAll('button,math-field,svg').forEach((x) => x.remove()); return c.textContent || ''; };
    // (WebKit puts <img data-lexical-managed-linebreak> into every empty paragraph: that is not a picture. Found by the first wide run:
    // an equation slash-command inserted an empty equation paragraph, which WebKit's placeholder made look "not empty".)
    // (an empty box or Transcriber's Notes / Symbols page — an emboss-sidebar-card with no text — gives no braille block either:
    // Emboss's own rule, tests/test-empty-containers.mjs)
    const isEmptyKid = (e) => !textOf(e).trim() && [...e.querySelectorAll('math-field')].every((m) => !String(m.value || '').trim()) && !e.querySelector('img:not([data-lexical-managed-linebreak]),table,.doc-image-block,.doc-table-block,.doc-break,.doc-print-page') && !/doc-image-block|doc-table-block|doc-break|doc-print-page/.test(e.className || '');
    const blocks = window.lastModel && Array.isArray(window.lastModel.blocks) ? window.lastModel.blocks : null;
    return {
      brfType: typeof window.lastBrf,
      brfText: typeof window.lastBrf === 'string' ? window.lastBrf.replace(/[\s\f]/g, '').length : -1,
      hasModel: !!blocks,
      blocks: blocks ? blocks.length : -1,
      kids: kids.length,
      emptyKids: kids.filter(isEmptyKid).length,
      paneText: (b.textContent || '').slice(0, 300),
      failed: /Braille could not be generated/.test(b.textContent || ''),
      rows: b.querySelectorAll('.brl-row').length,
      spacer: !!b.querySelector('.brl-virtual-spacer'),
      paneShown: b.offsetWidth > 0 && b.offsetHeight > 0,
      // the caret inside a card that cannot be typed in (a contenteditable=false block), with no card selected as a whole
      cardCaret: (() => {
        const s = getSelection();
        if (!s || !s.anchorNode || !s.isCollapsed || !ed.contains(s.anchorNode) || ed.querySelector('.emboss-selected')) return null;
        // only while the keys go to the text itself: with the focus in a card's own box (a picture's description, after a click on
        // its label) the page's caret is not where typing goes
        if (document.activeElement !== ed) return null;
        const el = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
        // (an inline equation is a card too, but the browser parks an ordinary caret right beside it, anchored in its span: not a fault)
        if (!el || el.closest('math-field') || el.closest('.math-embed')) return null;
        const ce = el.closest('[contenteditable]');
        return ce && ce !== ed && ce.getAttribute('contenteditable') === 'false' && ed.contains(ce) ? `${ce.tagName.toLowerCase()}.${String(ce.className).split(' ')[0]}` : null;
      })(),
    };
  });
  if (st.cardCaret) v.push({ inv: 'caret-in-card', msg: `a collapsed caret sits inside a card that cannot be typed in (${st.cardCaret}) and no card is selected` });
  if (st.brfType !== 'string') v.push({ inv: 'brf-missing', msg: `window.lastBrf is ${st.brfType}, not a string` });
  if (!st.hasModel) v.push({ inv: 'model-missing', msg: 'window.lastModel.blocks is missing' });
  if (st.failed) v.push({ inv: 'braille-failed', msg: 'the braille pane shows an error: ' + st.paneText.replace(/\s+/g, ' ') });
  else if (st.paneShown && st.brfText > 0 && !st.rows && !st.spacer) v.push({ inv: 'braille-pane-empty', msg: `the braille pane has no lines although lastBrf has ${st.brfText} characters; the pane says: ${st.paneText.replace(/\s+/g, ' ').slice(0, 160)}` });
  if (st.hasModel && !(st.blocks === st.kids || (st.blocks <= st.kids && st.kids - st.blocks <= st.emptyKids))) {
    v.push({ inv: 'block-count', msg: `the model has ${st.blocks} blocks but the text pane has ${st.kids} top-level blocks (${st.emptyKids} of them empty)` });
  }
  env.hasContentCache = st.brfText > 0;
  return v;
}
async function checkQuickState(env) {
  const v = [];
  const st = await env.page.evaluate(() => {
    const s = document.getElementById('status');
    const p = document.getElementById('preview');
    const r = document.getElementById('result');
    return { status: (s.textContent || ''), cls: s.className || '', resultShown: r && !r.hidden, preview: (p.textContent || '').replace(/\s/g, '').length };
  });
  if (/\berr\b/.test(st.cls)) v.push({ inv: 'quick-error', msg: 'the status line shows an error: ' + st.status.slice(0, 200) });
  else if (st.resultShown && !st.preview && env.loadedDoc) v.push({ inv: 'quick-preview-empty', msg: 'the result is shown but the braille preview is empty; status: ' + st.status.slice(0, 120) });
  env.hasContentCache = st.preview > 0;
  return v;
}

// ---------------------------------------------------------------- artefacts
async function saveArtefacts(env, dir, spec, log, violation, errors) {
  fs.mkdirSync(dir, { recursive: true });
  const { page } = env;
  const w = (name, data) => { try { fs.writeFileSync(path.join(dir, name), data); } catch { /* disk */ } };
  w('actions.log', log.join('\n') + '\n');
  w('meta.json', JSON.stringify({ seed: spec.runSeed, session: spec.index, engine: spec.engine, page: spec.kind, doc: spec.doc, settings: spec.settings, viewport: spec.viewport, violation, errors: errors.slice(-20) }, null, 1));
  const tryIt = async (fn) => { try { return await withTimeout(fn(), 15000, 'artefact'); } catch (e) { return null; } };
  const shot = await tryIt(() => page.screenshot({ type: 'png' }));
  if (shot) w('screenshot.png', shot);
  const html = await tryIt(() => page.evaluate(() => ({
    editor: (document.getElementById('editor') || {}).outerHTML || '',
    braille: (document.getElementById('braille') || document.getElementById('preview') || {}).outerHTML || '',
    model: (() => { try { return JSON.stringify(window.lastModel, null, 1); } catch (e) { return 'unserialisable: ' + e.message; } })(),
    brf: window.lastBrf || '',
  })));
  if (html) {
    w('editor.html', html.editor.slice(0, 3_000_000));
    w('braille.html', html.braille.slice(0, 3_000_000));
    w('lastModel.json', String(html.model || '').slice(0, 3_000_000));   // (Quick Mode has no window.lastModel: JSON.stringify(undefined) is undefined)
    w('lastBrf.brf', String(html.brf).slice(0, 1_000_000));
  }
}

// ---------------------------------------------------------------- the session
// spec: { engine, kind: 'editor'|'quick', doc, settings, viewport:{width,height}, actions, runSeed, index, large? }
// o: { port, artefactDir?, onLog? }
// Returns { violation: {inv,msg,key,index,errors}|null, done: number of actions run, log: [lines], ms }
export async function runSession(browser, spec, o) {
  const t0 = Date.now();
  const log = [];
  const errors = [];
  const navigated = [];
  const env = { kind: spec.kind, engine: spec.engine, page: null, renderBias: 0, loadedDoc: false, hasContentCache: false, large: !!spec.large, browser, ctx: null, errors, port: o.port, navOk: false, perf: null, checkOpts: { heapMb: o.heapMb || 300 } };
  env.hasContent = async () => env.hasContentCache;
  let ctx;
  let violation = null;
  const observations = [];
  let done = 0;
  const say = (s) => { log.push(s); if (o.onLog) o.onLog(s); };
  const phase = (p) => { if (o.state) o.state.phase = p; };
  try {
    phase('newContext');
    ctx = await withTimeout(browser.newContext({ viewport: spec.viewport, acceptDownloads: true, locale: 'en-US', serviceWorkers: 'block' }), 30000, 'browser.newContext');
    env.ctx = ctx;    await ctx.addInitScript(pageInit, JSON.stringify(spec.settings));
    const page = await ctx.newPage();
    env.page = page;
    page.on('pageerror', (e) => errors.push({ src: 'pageerror', msg: String((e && e.stack) || e).slice(0, 1200) }));
    page.on('console', async (m) => { if (m.type() === 'error') errors.push({ src: 'console.error', msg: (await consoleText(m)).slice(0, 600) + (m.location() && m.location().url ? `  [${m.location().url}:${m.location().lineNumber}]` : '') }); });
    page.on('crash', () => errors.push({ src: 'crash', msg: 'the page crashed' }));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    const base = `http://localhost:${o.port}`;
    // (a round trip to Quick Mode and back, and the recovery check's reload, navigate on purpose: env.navOk)
    page.on('framenavigated', (f) => { if (f === page.mainFrame() && !env.navOk && !f.url().startsWith(base + URLS[spec.kind])) navigated.push(f.url()); });

    const fail = (inv, msg, index) => { if (o.ignore && o.ignore.has(inv)) return; if (!violation) violation = { inv, msg, key: violationKey({ inv, msg }), index }; };
    const takeErrors = (index) => {
      const mine = errors.splice(0).filter((e) => !isHarmless(e.src, e.msg));
      if (mine.length) fail(mine[0].src === 'pageerror' ? 'page-error' : mine[0].src === 'crash' ? 'crash' : 'console-error', mine[0].msg, index);
      if (navigated.length) { fail('navigated-away', 'the page navigated away to ' + navigated[0], index); navigated.length = 0; }
      return mine;
    };
    const alive = async () => { try { return await withTimeout(page.evaluate(() => 1), 5000, 'page.evaluate(1)').then(() => true); } catch { return false; } };

    // -- load
    phase('goto');
    await page.goto(base + URLS[spec.kind], { waitUntil: 'load', timeout: 60000 });
    if (spec.kind === 'editor') await page.waitForFunction(() => typeof window.importFile === 'function' && window.lastModel && window.__mk, null, { timeout: 60000 });
    else await page.waitForFunction(() => { const s = document.getElementById('status'); return s && s.textContent && !/Loading braille engine/.test(s.textContent); }, null, { timeout: 60000 });
    await sleep(spec.kind === 'editor' ? 1200 : 600);
    // a phone-width window: the editor first asks (feedback 30 Sep item 12); the session goes on in the editor
    await page.evaluate(() => { const n = document.getElementById('phoneNotice'); const b = document.getElementById('phoneNoticeAnyway'); if (n && !n.hidden && b && n.offsetWidth > 0) b.click(); }).catch(() => {});
    if (spec.doc !== 'empty') {
      say(`load ${spec.doc}`);
      await withTimeout(loadDoc(env, spec.doc), env.large ? 120000 : 60000, 'initial load');
      env.loadedDoc = true;
      await sleep(400);
    }
    const settleAll = (full) => (spec.kind === 'editor' ? settleEditor(env, env.large ? 60000 : 15000, full ? 350 : 120) : settleQuick(env, env.large ? 90000 : 20000));
    const initial = await settleAll(true);
    const checkState = () => (spec.kind === 'editor' ? checkEditorState(env) : checkQuickState(env));
    takeErrors(-1);
    if (!violation) for (const x of await checkState()) { fail(x.inv, x.msg, -1); break; }
    if (violation) say(`!! violation after loading: ${violation.inv}: ${violation.msg}`);

    // -- the actions
    const NAV = new Set(['keyrun', 'clickText', 'clickBraille', 'clickPreview', 'clickCard', 'scroll', 'modNav', 'shiftSel', 'help', 'readAloud', 'download', 'save', 'colorScheme', 'zoom', 'phone']);
    for (let i = 0; i < spec.actions.length && !violation; i++) {
      const a = spec.actions[i];
      const tA = Date.now();
      phase(`action ${i}: ${fmtAction(a)}`);
      let r = { viol: [], note: '' };
      let skipped = null;
      try {
        r = await withTimeout(runAnyAction(env, a), (a.t === 'check' || a.t === 'roundTrip' || a.t === 'secondTab') ? 240000 : env.large ? 90000 : 40000, fmtAction(a));
      } catch (e) {
        if (e && e.isTimeout) { fail('hang', `an action did not finish: ${e.message}`, i); }
        else if (isSkip(e)) skipped = e.message;
        else if (/Execution context was destroyed|navigation/i.test(e.message || '')) { fail('navigated-away', 'the page navigated during an action: ' + e.message.split('\n')[0], i); }
        else if (/Target (page|closed)|has been closed|crashed/i.test(e.message || '')) { fail('crash', 'the page closed or crashed during an action: ' + e.message.split('\n')[0], i); }
        else skipped = (e.message || String(e)).split('\n')[0].slice(0, 160);
      }
      for (const x of r.viol) fail(x.inv, x.msg, i);
      await sleep(25);
      if (spec.kind === 'editor' && !violation) {
        const bb = await page.evaluate(() => window.__mk && window.__mk.backspaceBack.splice(0)).catch(() => []);
        for (const m of bb || []) observations.push({ type: 'backspace-back', index: i, msg: m });
      }
      takeErrors(i);
      if (!violation) {
        if (!(await alive())) {
          await sleep(100);
          takeErrors(i);   // a page that left (navigated away) or crashed is reported as that, not as unresponsive
          fail('unresponsive', `the page did not answer within 5 s after: ${fmtAction(a)}`, i);
        }
      }
      if (!violation) {
        phase(`settle after action ${i}`);
        const s = await settleAll(!NAV.has(a.t));
        if (a.t === 'load' || a.t === 'drop') { env.loadedDoc = true; if (env.perf) env.perf.base = null; }
        takeErrors(i);
        if (!violation && (s.settled || spec.kind === 'quick')) for (const x of await checkState()) { fail(x.inv, x.msg, i); break; }
        if (!violation && !s.settled && spec.kind === 'editor' && /never reported/.test(s.why || '')) { /* the error pane / console.error check reports a failed render */ await sleep(0); }
      }
      done = i + 1;
      say(`#${i} ${fmtAction(a)}${r.note ? '  [' + r.note + ']' : ''}${skipped ? '  (skipped: ' + skipped + ')' : ''}  ${Date.now() - tA} ms${violation ? '\n   !! VIOLATION ' + violation.inv + ': ' + violation.msg.split('\n')[0].slice(0, 300) : ''}`);
      if (Date.now() - t0 > (spec.large ? 900000 : 600000)) { say('(session time limit reached)'); break; }
    }
    // -- the end of the session: everything settled, once more
    if (!violation) {
      await closeDialogs(page).catch(() => {});
      const s = await settleAll(true);
      takeErrors(spec.actions.length);
      if (!violation && !(await alive())) fail('unresponsive', 'the page did not answer at the end of the session', spec.actions.length);
      if (!violation && s.settled) for (const x of await checkState()) { fail(x.inv, x.msg, spec.actions.length); break; }
      if (violation) say(`!! violation at the end: ${violation.inv}: ${violation.msg}`);
    }
    // -- the slow invariants once more at the end (editor sessions): heap and settle time, save/reopen, recovery
    if (!violation && spec.kind === 'editor' && spec.endChecks !== false) {
      const endRuns = [['settle time / heap', () => (env.large ? null : perfCheck(env, env.checkOpts))], ['save / reopen', () => saveReopenCheck(env, { port: o.port })], ['recovery', () => (env.large ? null : recoveryCheck(env, { port: o.port }))]];
      for (const [name, fn] of endRuns) {
        if (violation) break;
        phase(`end check: ${name}`);
        const tA = Date.now();
        let r = null;
        try { r = await withTimeout(Promise.resolve(fn()), 300000, `end check ${name}`); } catch (e) {
          if (e && e.isTimeout) fail('hang', `an end-of-session check did not finish: ${e.message}`, spec.actions.length);
          else say(`(end check ${name} skipped: ${String((e && e.message) || e).split('\n')[0].slice(0, 160)})`);
        }
        if (r) { for (const x of r.viol) fail(x.inv, x.msg, spec.actions.length); say(`end check ${name}: ${r.viol.length ? 'VIOLATION ' + r.viol[0].inv : 'ok'}${r.note ? ' [' + r.note + ']' : ''}  ${Date.now() - tA} ms`); }
        takeErrors(spec.actions.length);
      }
      if (violation) say(`!! violation at the end: ${violation.inv}: ${violation.msg}`);
    }
    phase('artefacts');
    if (violation && o.artefactDir) await saveArtefacts(env, o.artefactDir, spec, log, violation, errors);
    if (violation) violation.errors = errors.slice(-5);
  } catch (e) {
    // the harness itself failed (not a finding): report it as such
    say(`harness error: ${(e && e.stack) || e}`);
    if (!violation) violation = { inv: 'harness', msg: String((e && e.message) || e).split('\n')[0], key: 'harness', index: -2 };
  } finally {
    phase('close');
    if (ctx) { try { await withTimeout(ctx.close(), 15000, 'context close'); } catch { env.contextStuck = true; } }
  }
  return { violation, observations, done, log, ms: Date.now() - t0, contextStuck: !!env.contextStuck, perf: env.perf ? { heap: env.perf.heap, base: env.perf.base } : null };
}

// ---------------------------------------------------------------- minimising
// Finds a short list of actions that still gives the same violation. First the last 1, 2, 3, 5, 8, ... actions on their own
// (a fresh page and document each time), then delta debugging over what is left. Gives up at `deadline` (a Date.now() value)
// and keeps the shortest list found so far.
export async function minimise(ref, spec, violation, o, deadline) {
  const target = violation.key;
  let tests = 0;
  const same = async (actions) => {
    tests++;
    const r = await guardedRun(ref, { ...spec, actions }, { port: o.port, ignore: o.ignore });
    return !!(r.violation && r.violation.key === target);
  };
  let actions = spec.actions.slice(0, Math.max(0, violation.index + 1));
  const reproduces = await same(actions);
  if (!reproduces) {
    // one more try with the whole list (the violation may have been at the end of the session)
    return { reproducible: false, actions: spec.actions.slice(0, violation.index + 1), tests };
  }
  for (const size of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55]) {
    if (Date.now() > deadline) break;
    if (size >= actions.length) break;
    const sub = actions.slice(actions.length - size);
    if (await same(sub)) { actions = sub; break; }
  }
  // ddmin
  let n = 2;
  while (actions.length >= 2 && Date.now() < deadline) {
    const chunk = Math.ceil(actions.length / n);
    let reduced = false;
    for (let start = 0; start < actions.length; start += chunk) {
      if (Date.now() > deadline) break;
      const without = actions.slice(0, start).concat(actions.slice(start + chunk));
      if (!without.length) continue;
      if (await same(without)) { actions = without; n = Math.max(n - 1, 2); reduced = true; break; }
    }
    if (!reduced) { if (n >= actions.length) break; n = Math.min(actions.length, n * 2); }
  }
  // an empty list is also possible: the document alone
  if (actions.length === 1 && Date.now() < deadline && await same([])) actions = [];
  return { reproducible: true, actions, tests, timedOut: Date.now() >= deadline };
}

// runSession with a hard time limit: a browser that stops answering (seen once in WebKit) must not stop the whole run.
// ref: { browser, launch } - on a hang or a context that will not close, the browser is thrown away and started again.
export async function guardedRun(ref, spec, o) {
  const state = { phase: 'start' };
  const hard = spec.large ? 1500000 : 900000;
  let timer;
  const r = await Promise.race([
    runSession(ref.browser, spec, { ...o, state }),
    new Promise((res) => { timer = setTimeout(() => res({ hung: true }), hard); }),
  ]);
  clearTimeout(timer);
  const restart = async () => {
    try { await withTimeout(ref.browser.close(), 10000, 'browser close'); } catch { /* gone or stuck: start another */ }
    ref.browser = await ref.launch();
  };
  if (r.hung) {
    await restart();
    return { violation: { inv: 'harness', msg: `the session hung for ${hard / 1000} s (last step: ${state.phase}); the browser was restarted`, key: 'harness', index: -2 }, observations: [], done: 0, log: [], ms: hard };
  }
  if (r.contextStuck) await restart();
  return r;
}
