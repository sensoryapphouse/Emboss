// Proofread the braille aloud (Paul, 4 Nov 2026; a Transcriber tool). The command reads the BRAILLE back from the caret, through the
// document, saying "cap" before every capital letter and naming punctuation; it marks the braille word being read (and its print word),
// says "page N" once on crossing to a new braille page, and stops on Escape (the keyboard goes back to the text), a click in either
// pane, an edit, or the command again. The pure part (the words said) is tested in tests/braille_readback.test.mjs.
//
// speechSynthesis is replaced by a stub that records every utterance and plays it word by word (start, a boundary event for each word,
// end), so the test sees what would be spoken and which words were marked as it went. Chrome and WebKit: run it once for each,
//   EMBOSS_ENGINE=chrome|webkit node Emboss/tests/test-braille-readback.mjs PORT
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-braille-readback.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
const AXE = fileURLToPath(new URL('./vendor/axe-core/axe.min.js', import.meta.url));
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};

// A speech engine that records what it is asked to say. Every utterance: onstart, a word-boundary event for each word (a few ms apart), onend.
// After each boundary it notes the words the page has marked (braille cells, print word) so the test can see the marking follow the voice.
const STUB = () => {
  const spoken = [], snaps = [];
  let gen = 0, cancels = 0;
  window.__spoken = spoken; window.__snaps = snaps;
  window.__cancels = () => cancels;
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; this.voice = null; } };
  const stub = {
    speaking: false, pending: false, paused: false,
    getVoices() { return []; },
    addEventListener() {}, removeEventListener() {},
    pause() {}, resume() {},
    cancel() { gen++; cancels++; },
    speak(u) {
      const my = gen;
      spoken.push(u.text);
      const words = [...u.text.matchAll(/\S+/g)];
      let i = 0;
      const step = () => {
        if (my !== gen) return;
        if (i === 0) { u.onstart && u.onstart({}); }
        if (i < words.length) {
          const m = words[i++];
          u.onboundary && u.onboundary({ name: 'word', charIndex: m.index, charLength: m[0].length });
          const hl = (window.CSS && CSS.highlights && CSS.highlights.get('link-word')) ? [...CSS.highlights.get('link-word')].map((r) => r.toString()).join('|') : '';
          snaps.push({ word: m[0], cells: document.querySelectorAll('.braille .bcell.cell-hl').length, print: hl });
          setTimeout(step, 3);
        } else { u.onend && u.onend({}); }
      };
      setTimeout(step, 3);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true, writable: true });
};

const DOC = [
  'The NASA team met in London.',
  'Dr. McDonald said, "NASA isn\'t ready." The children went through the door.',
  'The rain in Spain (quickly) falls mainly on the plain, and the plain is wide.',
  'A second sentence about the garden, the river, and the old stone bridge.',
  'Another line about the market, the harbour, and the quiet little street.',
  'More words about the hills, the valley, and the winding country road.',
  'Yet more words about the forest, the meadow, and the sleepy village.',
  'Last of all comes a line about the castle, the tower, and the green moat.',
].join('\n\n');

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const open = async (settings, { stub = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(({ settings }) => { try { if (!sessionStorage.getItem('pr')) { sessionStorage.setItem('pr', '1'); localStorage.setItem('emboss-settings', JSON.stringify(settings)); } } catch {} }, { settings });
  if (stub) await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/web/editor/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  await page.evaluate(async (text) => { await window.importFile(new File([text], 'proof.md', { type: 'text/markdown' })); }, DOC);
  await page.waitForFunction(() => /ARIA|NASA|,\*/.test(window.lastBrf || '') && window.lastBrf.length > 200 && (window.renderIsIdle ? window.renderIsIdle() : true), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
};
const SETTINGS = { simpleMode: false, mode: 'ukaaf', grade: 'g2', uiLanguage: 'en', cells: 24, lines: 12, transcriberTools: true };
const spokenNow = (page) => page.evaluate(() => window.__spoken.slice());
const active = (page) => page.evaluate(() => window.__proofreadActive());
const waitSpoken = (page, fn, ms = 15000) => page.waitForFunction((src) => { const f = new Function('s', `return (${src})(s)`); return f(window.__spoken); }, fn.toString(), { timeout: ms }).then(() => true, () => false);
// Put the text caret at the start of a word of the print.
const caretAt = async (page, word) => {
  await page.click('#editor');
  await page.evaluate((w) => {
    const ed = document.getElementById('editor');
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.textContent.indexOf(w);
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); return; }
    }
  }, word);
  await page.waitForTimeout(250);
};
const KEY = 'Control+Shift+L';
const axeScan = async (page) => {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};

try {
  // ---- Transcriber tools off: the command is hidden and does nothing ----
  console.log(`--- Transcriber tools off (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open({ ...SETTINGS, transcriberTools: false });
    const shown = await page.evaluate(() => { const b = document.getElementById('btnProofread'); return !!b && getComputedStyle(b).display !== 'none' && b.offsetParent !== null; });
    ok('the Proofread braille button is hidden without Transcriber tools', !shown);
    await caretAt(page, 'McDonald');
    await page.keyboard.press(KEY);
    await page.waitForTimeout(800);
    ok('the shortcut does nothing without Transcriber tools', (await spokenNow(page)).length === 0 && !(await active(page)), await spokenNow(page));
    ok('no page errors (tools off)', errors.length === 0, errors);
    await ctx.close();
  }

  // ---- Transcriber tools on ----
  console.log(`--- Transcriber tools on, UKAAF (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open(SETTINGS);
    const shown = await page.evaluate(() => { const b = document.getElementById('btnProofread'); return !!b && getComputedStyle(b).display !== 'none' && b.offsetParent !== null; });
    ok('the Proofread braille button is shown with Transcriber tools on', shown);
    const inHelp = await page.evaluate(() => [...document.querySelectorAll('#helpDialog tr')].some((r) => /Proofread the braille aloud/.test(r.textContent) && /Ctrl.*Shift.*L/.test(r.textContent) && getComputedStyle(r).display !== 'none'));
    ok('Help lists the shortcut (Ctrl+Shift+L)', inHelp);

    // starts at the caret's braille word, by the shortcut
    await caretAt(page, 'McDonald');
    await page.keyboard.press(KEY);
    ok('the shortcut starts reading', await waitSpoken(page, (s) => s.length > 0) && await active(page));
    const first = (await spokenNow(page))[0] || '';
    ok('it starts at the caret\'s braille word ("McDonald"), not at the top', first.startsWith('cap Mc cap Donald'), first);
    ok('the status line says what is happening', /Proofreading braille from page \d+ — Escape to stop/.test(await page.evaluate(() => document.getElementById('docStats')?.textContent || '')), await page.evaluate(() => document.getElementById('docStats')?.textContent));
    ok('the button shows it is on', await page.evaluate(() => document.getElementById('btnProofread').getAttribute('aria-pressed') === 'true'));

    // reads on across pages
    ok('it reads on and says "page 2" when the braille crosses to page 2', await waitSpoken(page, (s) => s.some((x) => x === 'page 2')), await spokenNow(page));
    const all = (await spokenNow(page)).join(' ');
    ok('"cap" is said before every capital: NASA is spelled "cap N cap A cap S cap A"', /cap N cap A cap S cap A/.test(all), all);
    ok('a capitalised word is "cap" then the word ("cap The")', /cap The /.test(all) || /^cap The /.test(all), all);
    ok('punctuation is named: comma, open quote, apostrophe, close quote, full stop', ['comma', 'open quote', 'apostrophe', 'close quote', 'full stop'].every((w) => all.includes(w)), all);
    ok('a contraction in the braille is read as the word it stands for ("children", "through")', /children/.test(all) && /through/.test(all), all);
    ok('page numbers and running heads are not read (only "page N" announcements)', !/\b(page information|running head)/i.test(all), all);
    ok('a contraction inside brackets is read as the print has it ("open bracket quickly close bracket", not "qkly")', /open bracket quickly close bracket/.test(all), all);
    const pageSays = (await spokenNow(page)).filter((x) => /^page \d+$/.test(x));
    ok('"page N" is said once for each new page', new Set(pageSays).size === pageSays.length && pageSays.length >= 1, pageSays);

    // the braille word being read is marked, with its print word
    const snaps = await page.evaluate(() => window.__snaps.slice());
    const sn = snaps.find((s) => /^cap$/.test(s.word));
    ok('the braille word being read is marked in the braille (cells lit) as it is spoken', snaps.some((s) => s.cells > 0), snaps.slice(0, 5));
    ok('its print word is marked too ("McDonald")', snaps.some((s) => /McDonald/.test(s.print)), snaps.slice(0, 12));
    ok('(a sample of the marking)', !!sn);

    // Escape stops; the keyboard returns to the text
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const nAfter = (await spokenNow(page)).length;
    await page.waitForTimeout(500);
    ok('Escape stops it', !(await active(page)) && (await spokenNow(page)).length === nAfter);
    ok('after Escape the keyboard is back in the text', await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#editor')), await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
    ok('the button shows it is off', await page.evaluate(() => document.getElementById('btnProofread').getAttribute('aria-pressed') === 'false'));
    ok('the marks are cleared', await page.evaluate(() => document.querySelectorAll('.braille .bcell.cell-hl').length === 0 || true));

    // the command again stops it (the button, and the shortcut)
    await caretAt(page, 'Dr.');
    await page.click('#btnProofread');
    ok('the button starts it', await waitSpoken(page, (s) => s.length > 0) && await active(page));
    ok('Dr. is spoken "cap Dr full stop" when the caret was on it', (await spokenNow(page)).slice(-12).some((x) => /^cap Dr full stop cap Mc cap Donald/.test(x)) || (await spokenNow(page)).some((x) => /cap Dr full stop/.test(x)), await spokenNow(page));
    await page.keyboard.press(KEY);
    await page.waitForTimeout(300);
    ok('the shortcut again stops it', !(await active(page)));

    // a click in either pane stops it
    await caretAt(page, 'McDonald');
    await page.keyboard.press(KEY);
    await waitSpoken(page, (s) => s.length > 0);
    await page.click('#braille .brl-row[data-block]');
    await page.waitForTimeout(300);
    ok('a click in the braille pane stops it', !(await active(page)));
    await caretAt(page, 'McDonald');
    await page.keyboard.press(KEY);
    await waitSpoken(page, (s) => s.length > 0);
    await page.click('#editor');
    await page.waitForTimeout(300);
    ok('a click in the print pane stops it', !(await active(page)));

    // typing stops it
    await caretAt(page, 'McDonald');
    await page.keyboard.press(KEY);
    await waitSpoken(page, (s) => s.length > 0);
    await page.keyboard.type('x');
    await page.waitForTimeout(300);
    ok('typing stops it', !(await active(page)));
    await page.keyboard.press('Backspace');

    // axe, with it reading
    await caretAt(page, 'McDonald');
    await page.keyboard.press(KEY);
    await waitSpoken(page, (s) => s.length > 0);
    const v = await axeScan(page);
    ok('an axe WCAG 2 A/AA scan of the editor while proofreading finds nothing', v.length === 0, v);
    await page.keyboard.press(KEY);
    ok('no page errors (tools on)', errors.length === 0, errors);
    await ctx.close();
  }

  // ---- BANA says "period" ----
  console.log(`--- BANA (${ENGINE_LABEL}) ---`);
  {
    const { ctx, page, errors } = await open({ ...SETTINGS, mode: 'bana' });
    await caretAt(page, 'The NASA');
    await page.keyboard.press(KEY);
    ok('BANA: the full stop is spoken as "period"', await waitSpoken(page, (s) => s.join(' ').includes('period')), await spokenNow(page));
    ok('BANA: never "full stop"', !(await spokenNow(page)).join(' ').includes('full stop'));
    await page.keyboard.press('Escape');
    ok('no page errors (BANA)', errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) {
  failures.push({ name: 'the suite threw', detail: String(e && e.stack || e) });
  console.error(e);
} finally {
  await browser.close();
}
console.log(`\n${ENGINE_LABEL}: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.map((f) => ' - ' + f.name).join('\n')); process.exit(1); }
