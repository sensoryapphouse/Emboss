// Feedback 30 Sep 2026, item 8 (Paul, 1 Oct: "yes" to the recommendation): a picture's transcriber's note was "presented poorly,
// un-editable and appears in normal mode — should this just be alt text?" Now, in the editor:
//  - the picture card has an editable "Description for the braille reader" (the picture's alt text); what is typed becomes the
//    transcriber's note in the braille (BANA 6.2.2) and is saved as the alt text; undo puts it back;
//  - the "Picture type" menu (the note's label word) is a transcriber tool, hidden while Transcriber tools is off;
//  - the braille pane's tactile-graphic hardware preview (embosser badge, the note in large print) shows only with the expert
//    hardware features on (Ctrl/Cmd+Shift+\); otherwise the picture is its braille lines.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-picture-description.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('pd')) { sessionStorage.setItem('pd', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', expertHardware: false, transcriberTools: false })); } } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => page.waitForTimeout(ms);
const brf = () => page.evaluate(() => window.lastBrf || '');
const settle = async () => { let prev = null; for (let k = 0; k < 20; k++) { await wait(300); const b = await brf(); if (b === prev) return b; prev = b; } return prev; };
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await wait(1500);
  await page.evaluate(async (src) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Before the picture.' }, { type: 'graphic', src, alt: 'A small grey square' }, { type: 'para', text: 'After it.' }] }); await window.render(); }, PNG);
  let b = await settle();
  ok('the braille has the picture\'s note from its alt text', /,A SMALL GREY SQU>E/.test(b), b);
  const card = () => page.evaluate(() => {
    const box = document.querySelector('#editor .doc-image-block textarea.doc-image-alt');
    const lab = box && document.querySelector(`label[for="${box.id}"]`);
    const typeRow = document.querySelector('#editor .doc-image-block .doc-image-type-row');
    return { box: !!box, value: box ? box.value : null, label: lab ? lab.textContent : null, typeShown: !!typeRow && typeRow.getClientRects().length > 0, staticAlt: [...document.querySelectorAll('#editor .doc-image-desc')].map((e) => e.textContent) };
  });
  let c = await card();
  ok('the picture card has an editable description box, labelled for the braille reader', c.box && c.value === 'A small grey square' && /braille reader/i.test(c.label || ''), c);
  ok('... and no separate fixed "Alt:" line', !c.staticAlt.some((t) => /^Alt:/.test(t)), c.staticAlt);
  ok('the Picture type menu is hidden while Transcriber tools is off', !c.typeShown, c);
  ok('no tactile-graphic hardware preview in the braille pane (expert hardware off)', await page.evaluate(() => !document.querySelector('#braille .hardware-badge, #braille .brl-tactile-graphic-view')));
  // edit the description
  await page.click('#editor .doc-image-block textarea.doc-image-alt');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.evaluate(() => window.markDocumentClean());
  await page.keyboard.type('A red circle on a white card');
  ok('a description being typed counts as unsaved before the box is left (leaving the page asks first)', await page.evaluate(() => window.isDocumentDirty()));
  await page.keyboard.press('Tab');
  b = await settle();
  ok('the new description is the note in the braille', /,A R\$ CIRCLE ON A :ITE C>D/.test(b) && !/SQU>E/.test(b), b);
  ok('typing in the box did not change the text around the picture', await page.evaluate(() => window.lastModel.blocks.map((x) => x.type).join() === 'para,graphic,para'), await page.evaluate(() => window.lastModel.blocks.map((x) => x.type)));
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('it is saved as the picture\'s alt text', /alt="A red circle on a white card"/.test(xml), xml.slice(xml.indexOf('<img'), xml.indexOf('<img') + 200));
  await page.click('#editor');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  b = await settle();
  ok('undo puts the old description back', /SQU>E/.test(b) && (await card()).value === 'A small grey square', b);
  // Transcriber tools on: the picture type menu appears
  await page.evaluate(() => document.getElementById('set-transcriberTools').click());
  await wait(400);
  c = await card();
  ok('with Transcriber tools on, the Picture type menu is shown', c.typeShown, c);
  // expert hardware on: the preview appears
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, metaKey: false, shiftKey: true, bubbles: true })));
  await settle();
  await wait(600);
  const expert = await page.evaluate(() => ({ on: document.body.classList.contains('expert-hardware'), preview: !!document.querySelector('#braille .brl-tactile-graphic-view') }));
  ok('with the expert hardware features on, the tactile-graphic preview is shown', expert.on && expert.preview, expert);
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== Picture description [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
