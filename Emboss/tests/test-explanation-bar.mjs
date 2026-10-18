// Feedback 17 Oct 2026, items 7 and 14 (APH testers) and 3b:
//  7a the explanation bar (#statusBar, with its drag handle) is hidden while MathLive's on-screen keyboard is open, and returns when it closes;
//  7b it is hidden in a small window by Translate's own rule (max-width 700px or max-height 520px);
//  7c Settings > User Interface > "Show the explanation bar" (on by default) turns it off everywhere;
//  3b MathLive's own keyboard toggle (a glyph that is not an Iconoir icon) is hidden in every equation and Emboss's own button, with Iconoir's
//     keypad icon, opens and closes the same keyboard;
//  14a the six-key "cell being typed" indicator (#skPending) is gone from the toolbar, and six-key typing still works;
//  14b while typing (ordinary keys, or six-key chords) the bar keeps showing its last explanation and updates only after a pause of about
//      700 ms: it never goes blank or back to its hint in between, and it does move on once the typing stops.
// Run: node Emboss/scripts/serve.mjs 8261 &   node Emboss/tests/test-explanation-bar.mjs 8261     (EMBOSS_ENGINE=webkit for Safari's engine)
import { openSuite, openEditor, loadIntoEditor } from './lib/suite.mjs';

const { page, ok, finish, ENGINE_LABEL } = await openSuite('Explanation bar', { viewport: { width: 1400, height: 900 } });
const barState = () => page.evaluate(() => {
  const bar = document.getElementById('statusBar'), rail = document.querySelector('.sb-grab-rail');
  const shown = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  return { bar: shown(bar), rail: rail ? getComputedStyle(rail).display !== 'none' : false };
});
const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bar</title></head><body><h1>The bar</h1><p>Plain words for the bar to explain, such as another and together.</p><p>A second paragraph with more ordinary words in it.</p></body></html>';
try {
  await openEditor(page);
  await loadIntoEditor(page, 'bar.html', html);
  const first = page.locator('#editor p').first();

  // ---- 7b: window size
  ok('7b: in a large window the explanation bar and its handle are there', JSON.stringify(await barState()) === '{"bar":true,"rail":true}', await barState());
  await page.setViewportSize({ width: 690, height: 800 }); await page.waitForTimeout(300);
  let st = await barState();
  ok('7b: at 690 px wide (max-width 700) both are hidden', !st.bar && !st.rail, st);
  await page.setViewportSize({ width: 1000, height: 510 }); await page.waitForTimeout(300);
  st = await barState();
  ok('7b: at 510 px high (max-height 520) both are hidden', !st.bar && !st.rail, st);
  await page.setViewportSize({ width: 1000, height: 800 }); await page.waitForTimeout(300);
  st = await barState();
  ok('7b: at 1000 x 800 both are back', st.bar && st.rail, st);
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(300);

  // ---- 7c: the setting
  ok('7c: the setting is on by default', await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings')).showExplanationBar !== false));
  await page.click('#settingsBtn');
  await page.click('.tab-btn[data-tab="tab-display"]');
  ok('7c: Settings > User Interface offers "Show the explanation bar", ticked', await page.evaluate(() => { const c = document.getElementById('set-showExplanationBar'); return !!c && c.checked && /explanation bar/i.test(c.closest('label').textContent); }));
  await page.uncheck('#set-showExplanationBar');
  await page.waitForTimeout(200);
  st = await barState();
  ok('7c: unticked: the bar and its handle are hidden', !st.bar && !st.rail, st);
  ok('7c: and the choice is kept in the settings', await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings')).showExplanationBar === false));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.evaluate(() => window.markDocumentClean?.());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 30000 }); await page.waitForTimeout(1200);
  st = await barState();
  ok('7c: still hidden after the page is reloaded', !st.bar && !st.rail, st);
  await page.click('#settingsBtn'); await page.click('.tab-btn[data-tab="tab-display"]');
  await page.check('#set-showExplanationBar'); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  st = await barState();
  ok('7c: ticked again: the bar is back', st.bar && st.rail, st);

  // ---- 3b and 7a: an equation, Emboss's keyboard button, the on-screen keyboard
  await loadIntoEditor(page, 'bar.html', html);
  await page.locator('#editor p').first().click({ position: { x: 10, y: 8 } });
  await page.click('#btnInsertMenu');
  await page.click('#btnMath');
  await page.waitForSelector('#editor math-field', { timeout: 15000 });
  await page.waitForTimeout(700);
  ok('3b: Emboss\'s own keyboard button is beside the equation, named, with an icon, closed', await page.evaluate(() => { const b = document.querySelector('#editor .math-kb-btn'); return !!b && /keyboard/i.test(b.getAttribute('aria-label')) && b.getAttribute('aria-expanded') === 'false' && !!b.querySelector('svg.icon use, svg.icon path'); }));
  ok('3b: MathLive\'s own toggle is hidden in the equation', await page.evaluate(() => { const mf = document.querySelector('#editor math-field'); const t = mf.shadowRoot && mf.shadowRoot.querySelector('[part~="virtual-keyboard-toggle"]'); return !t || getComputedStyle(t).display === 'none'; }));
  await page.click('#editor .math-kb-btn');
  await page.waitForFunction(() => window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  ok('3b: the button opens the on-screen keyboard (aria-expanded true, the keyboard is shown, the equation keeps the focus)', await page.evaluate(() => { const b = document.querySelector('#editor .math-kb-btn'); return window.mathVirtualKeyboard.visible && b.getAttribute('aria-expanded') === 'true' && !!document.activeElement.closest('math-field'); }), await page.evaluate(() => ({ vis: window.mathVirtualKeyboard.visible, act: document.activeElement.tagName })));
  st = await barState();
  ok('7a: while the keyboard is open the explanation bar and its handle are hidden', !st.bar && !st.rail, st);
  await page.click('#editor .math-kb-btn');
  await page.waitForFunction(() => !window.mathVirtualKeyboard.visible, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  ok('3b: the same button closes it', await page.evaluate(() => !window.mathVirtualKeyboard.visible && document.querySelector('#editor .math-kb-btn').getAttribute('aria-expanded') === 'false'));
  st = await barState();
  ok('7a: and the bar returns when the keyboard closes', st.bar && st.rail, st);

  // ---- 14a, 14b
  await loadIntoEditor(page, 'bar.html', html);
  ok('14a: the six-key "cell being typed" indicator is gone', await page.evaluate(() => !document.getElementById('skPending') && !document.querySelector('.sk-pending')));
  const hint = await page.evaluate(() => (window.__hint = document.querySelector('#ruleInfoBody .sb-hint')?.textContent || 'Click a word'));
  const watch = (ms) => page.evaluate(async (ms) => {
    const body = document.getElementById('ruleInfoBody'); const out = { blank: 0, hint: 0, samples: 0, last: '' };
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const txt = body.innerText.trim(); out.samples++;
      if (!txt) out.blank++; else if (body.querySelector('.sb-hint')) out.hint++;
      out.last = txt;
      await new Promise((r) => setTimeout(r, 20));
    }
    return out;
  }, ms);
  const wordBox = page.locator('#editor p', { hasText: 'Plain words' });
  await wordBox.click({ position: { x: 60, y: 8 } });
  await page.waitForTimeout(900);
  const initial = await page.evaluate(() => document.getElementById('ruleInfoBody').innerText.trim());
  ok('14b: clicking a word shows its explanation', initial.length > 3 && !/^Click a word/.test(initial), initial.slice(0, 100));
  // ordinary typing: a key every 120 ms for about 1.2 s, watching the bar the whole time
  const typed = (async () => { for (const ch of 'zebra') { await page.keyboard.type(ch); await page.waitForTimeout(120); } })();
  const during = await watch(1100);
  await typed;
  ok('14b: while typing the bar never went blank or back to its hint', during.blank === 0 && during.hint === 0, during);
  const heldFirst = await page.evaluate(() => document.getElementById('ruleInfoBody').innerText.trim());
  await page.waitForTimeout(1300);
  const after = await page.evaluate(() => document.getElementById('ruleInfoBody').innerText.trim());
  // the bar spells a word out letter by letter (w o z e b r ar d s), so the letters are joined to look for what was typed
  ok('14b: after a pause the bar has moved on to the word typed', /zebr/i.test(after.replace(/\s+/g, '')), after.slice(0, 160));
  // the bar waited: right after the last key it was still showing the earlier explanation, not the new word
  ok('14b: during the typing it kept the earlier explanation (it had not yet moved to the word being typed)', !/zebr/i.test(during.last.replace(/\s+/g, '')) || !/zebr/i.test(heldFirst.replace(/\s+/g, '')), during.last.slice(0, 100));
  // six-key: a chord of S and D (dots 1-2) and Space, with the bar watched
  await page.click('#btnSixKey');
  await page.locator('#editor').focus();
  const chords = (async () => { for (let i = 0; i < 4; i++) { await page.keyboard.down('KeyS'); await page.keyboard.down('KeyD'); await page.waitForTimeout(40); await page.keyboard.up('KeyS'); await page.keyboard.up('KeyD'); await page.waitForTimeout(110); } })();
  const sixDuring = await watch(900);
  await chords;
  ok('14b: while typing six-key braille the bar never went blank or back to its hint either', sixDuring.blank === 0 && sixDuring.hint === 0, sixDuring);
  ok('14a: six-key typing still makes braille characters', await page.evaluate(() => /[⠀-⣿]/.test(document.getElementById('editor').textContent)));
  await page.click('#btnSixKey');
} finally { await finish(); }
