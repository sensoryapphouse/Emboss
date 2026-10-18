// Feedback 17 Oct 2026, item 6 (APH testers, Small NIMAS test.xml): clicking a link in the Table of Contents box pushed the whole interface up and
// left a band of white under the explanation bar. The link scrolled with element.scrollIntoView({block:'center'}), which also scrolls every
// scrollable ancestor — <main> is overflow:hidden but a script can still scroll it. Now only the text pane is scrolled (scrollWithin). The same
// applies to the other jumps that centre a word or block (the words-to-check badge, a warning's block, the braille pane's own jumps).
// Run: node Emboss/scripts/serve.mjs 8261 &   node Emboss/tests/test-toc-link-scroll.mjs 8261     (EMBOSS_ENGINE=webkit for Safari's engine)
import { openSuite, openEditor } from './lib/suite.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The testers' own "Small NIMAS test.xml" (a 12-item contents box over a document taller than the window): with it <main> overflows by about 100 px,
// which is what a centring scrollIntoView then scrolled.
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'feedback-17oct', 'small-nimas-test.xml');
const { page, ok, finish } = await openSuite('Table of Contents link scroll', { viewport: { width: 1030, height: 800 } });
try {
  await openEditor(page);
  await page.evaluate(() => { window.markDocumentClean?.(); window.__prevModel = window.lastModel; });
  await page.setInputFiles('#loadFileInput', FILE);
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel && (window.lastModel.blocks || []).length > 5, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const geometry = () => page.evaluate(() => {
    const moved = [];
    for (const el of [document.documentElement, document.body, document.querySelector('header'), document.querySelector('main'), document.querySelector('.panes'), ...document.querySelectorAll('.pane')]) if (el && (el.scrollTop || el.scrollLeft)) moved.push((el.id || el.className || el.tagName) + ':' + el.scrollTop);
    return { moved, statusBottom: Math.round(document.getElementById('statusBar').getBoundingClientRect().bottom), inner: window.innerHeight, scrollY: window.scrollY, editorTop: document.getElementById('editor').scrollTop };
  });
  const links = page.locator('#printTocContainer a[data-jump-block]');
  const n = await links.count();
  ok('the Table of Contents box has links to click', n >= 8, n);
  const before = await geometry();
  ok('before: nothing but the panes is scrolled, the explanation bar ends above the window\'s bottom edge', before.moved.length === 0 && before.statusBottom <= before.inner, before);
  let last = before.editorTop, scrolledText = 0, clean = true, detail = null;
  for (let i = 0; i < Math.min(n, 12); i++) {
    await links.nth(i).click();
    await page.waitForTimeout(500);
    const g = await geometry();
    if (g.editorTop !== last) scrolledText++;
    last = g.editorTop;
    if (g.moved.some((m) => !/^(editor|braille):/.test(m)) || g.statusBottom !== before.statusBottom || g.scrollY !== 0) { clean = false; detail = { i, g }; }
  }
  ok('every link took the text there (the text pane scrolled)', scrolledText >= 6, scrolledText);
  ok('and no link moved the page round the panes: <main>, the window and the explanation bar stay where they were', clean, detail);
} finally { await finish(); }
