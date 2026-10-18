// Audit batch S3c (ChatGPT audit 15 Oct 2026, Emboss/docs/chatgpt-audit-15oct.md; Paul's decisions of 15 Oct), in a real browser:
//
//   #22 / A2  The four connection choices (USB serial, USB HID, Bluetooth, network) are real: the choice survives saving and a reload,
//             the Emboss button sends the BRF bytes with the matching sender (WebSerial / WebHID / Web Bluetooth / HTTP), a browser
//             without the API shows the choice disabled with its reason and Emboss says plainly that nothing was sent, and a cancelled
//             chooser, a refused chooser, a lost device and a failed write each give a plain message. The hardware controls stay hidden
//             in a beta build. EVERY device API is a mock: no real device is touched.
//   S2-Q2     The serial port / HID / Bluetooth chooser is asked for INSIDE the click, before the (possibly long) wait for the braille;
//             the braille is waited for after that, then sent. (The mock refuses a chooser asked for more than 1.5 s after the click,
//             as a browser does when it has forgotten the click; the braille is made deliberately slowly, 2.5 s.)
//   S2-Q3     Leaving a picture's description box without a real change does not mark the document unsaved; a description saved while
//             it was being typed is not "unsaved" when the box is left; a real change still is.
//   S2B-Q1    Quick Mode shows the import's own warnings (an EPUB with a missing chapter) in a short polite notice, cleared with the next file.
//   S2B-Q2    The editor's Download package: if the package builder refuses (a duplicate name), its message is in the status line and
//             announced, and nothing is downloaded.
//
// Usage: node Emboss/scripts/serve.mjs 8208 &   then   node Emboss/tests/test-s3c-hardware.mjs [port]
// EMBOSS_ENGINE=webkit|firefox runs it in another engine (WebKit has no WebSerial, WebHID or Web Bluetooth: the "not available" cases
// then use the real browser; the mocked-device cases are skipped there).
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { readFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import { launchBrowser, ENGINE, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail !== '' ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const errors = [];
const CHROMIUM = ENGINE === 'chrome';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// S3C_ONLY=q2,q3 runs only those sections (persist, send, none, fail, q2, net, beta, q3, q2b, q1b); the default is all of them.
const ONLY = String(process.env.S3C_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const on = (name) => !ONLY.length || ONLY.includes(name);

const browser = await launchBrowser({ args: ['--no-sandbox'] });

// The device APIs, mocked. window.__hw.calls: every chooser/open call with its time; written[kind]: the bytes sent; clickAt: when the Emboss
// button was last clicked. Behaviour is chosen by the test: pick ('cancel' | 'none'), maxAge (ms: refuse a chooser asked for this long after the click,
// as a browser does when it has forgotten the click), fail ('write' | 'connect').
const HW_INIT = (none) => {
  const hw = window.__hw = { calls: [], written: { serial: [], hid: [], ble: [], usb: [] }, clickAt: 0, pick: null, maxAge: 0, fail: null };
  const now = () => performance.now();
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('#embossBtn, #downloadEmbossItem')) hw.clickAt = now(); }, true);
  const err = (name, message) => { const e = new Error(message); e.name = name; return e; };
  const chooser = (kind) => {
    hw.calls.push({ kind, t: now(), sinceClick: now() - hw.clickAt });
    if (hw.pick === 'refuse' || (hw.maxAge && now() - hw.clickAt > hw.maxAge)) throw err('SecurityError', 'Must be handling a user gesture to show a permission request.');
    if (hw.pick === 'cancel') throw err('NotFoundError', 'No device selected.');
  };
  const def = (k, v) => { try { Object.defineProperty(Navigator.prototype, k, { get: () => v, configurable: true }); } catch {} try { Object.defineProperty(navigator, k, { get: () => v, configurable: true }); } catch {} };
  if (none) { for (const k of ['serial', 'hid', 'bluetooth', 'usb']) def(k, undefined); return; }
  const lost = () => err('NetworkError', 'The device has been lost.');
  const port = { readable: null, open: async () => { hw.calls.push({ kind: 'serial.open', t: now() }); }, close: async () => { hw.calls.push({ kind: 'serial.close', t: now() }); },
    writable: { getWriter: () => ({ write: async (c) => { if (hw.fail === 'write') throw lost(); hw.written.serial.push({ t: now(), bytes: Array.from(c) }); }, releaseLock() {} }) } };
  def('serial', { addEventListener() {}, removeEventListener() {}, getPorts: async () => [], requestPort: async () => { chooser('serial.requestPort'); return port; } });
  const hidDev = { opened: false, productName: 'Mock HID', open: async function () { this.opened = true; }, close: async function () { this.opened = false; },
    sendReport: async (id, data) => { if (hw.fail === 'write') throw lost(); hw.written.hid.push({ t: now(), bytes: Array.from(data) }); } };
  def('hid', { addEventListener() {}, removeEventListener() {}, requestDevice: async () => { chooser('hid.requestDevice'); return hw.pick === 'none' ? [] : [hidDev]; } });
  const NORDIC = '6e400001-b5a3-f393-e0a9-e50e24dcca9e', NORDIC_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const rx = { writeValueWithoutResponse: async (c) => { if (hw.fail === 'write') throw err('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.'); hw.written.ble.push({ t: now(), bytes: Array.from(c) }); } };
  const svc = { getCharacteristic: async (u) => { if (u === NORDIC_RX) return rx; throw err('NotFoundError', 'none'); } };
  const server = { getPrimaryService: async (u) => { if (u === NORDIC) return svc; throw err('NotFoundError', 'none'); } };
  const bleDev = { name: 'Mock BLE', gatt: { connected: false, connect: async () => { if (hw.fail === 'connect') throw err('NetworkError', 'Connection attempt failed.'); return server; }, disconnect() {} } };
  def('bluetooth', { addEventListener() {}, removeEventListener() {}, requestDevice: async () => { chooser('ble.requestDevice'); return bleDev; } });
  def('usb', undefined);   // the serial choice must use WebSerial when the browser has it
};

const newCtx = async (settings, { none = false, beta = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, serviceWorkers: 'block', locale: 'en-US' });
  await ctx.addInitScript(({ s, beta }) => { if (beta) window.EMBOSS_BETA = true; try { if (!sessionStorage.getItem('s3c-init')) { sessionStorage.setItem('s3c-init', '1'); localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} }, { s: settings, beta });
  if (CHROMIUM) await ctx.addInitScript(HW_INIT, none);
  return ctx;
};
const watch = (page, label) => { page.on('pageerror', (e) => errors.push(`${label}: ${String(e).slice(0, 200)}`)); page.on('dialog', (d) => d.accept().catch(() => {})); return page; };
const EDITOR_SET = (extra = {}) => ({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', expertHardware: true, embosser: 'generic', embosserDuplex: 'double', ...extra });
const openEditor = async (ctx, label) => {
  const page = watch(await ctx.newPage(), label);
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function' && typeof window.render === 'function', null, { timeout: 60000 });
  await sleep(1500);
  return page;
};
const setDoc = (page, t) => page.evaluate(async (txt) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: txt }] }); await window.render(); }, t);
const statusText = (page) => page.evaluate(() => document.getElementById('docStats')?.textContent || '');
const announced = (page) => page.evaluate(() => document.getElementById('announce')?.textContent || '');
// the live region is cleared and refilled a moment apart, so wait for the words to be in it
const announcedHas = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('announce')?.textContent || ''), re.source, { timeout: 3000 }).then(() => true, () => false);
const clickEmboss = (page) => page.evaluate(() => document.getElementById('embossBtn').click());
const waitStatus = (page, re, timeout = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('docStats')?.textContent || ''), re.source, { timeout }).then(() => true, () => false);
const hw = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__hw)));
// the stream the editor should have sent for the braille now showing, built by the spooler's own function with the editor's options
const expectedStream = (page) => page.evaluate(async () => {
  const { prepareEmbosserStream } = await import('/format/spooler.mjs');
  const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}');
  return Array.from(new TextEncoder().encode(prepareEmbosserStream(window.lastBrf, { embosser: s.embosser || 'generic', duplex: s.embosserDuplex || 'double', width: s.cells || 38, depth: s.lines || 25 })));
});
const sameBytes = (got, want, pad = false) => got.length >= want.length && want.every((b, i) => got[i] === b) && (pad ? got.slice(want.length).every((b) => b === 0) : got.length === want.length);
const flat = (written) => written.flatMap((w) => w.bytes);
const cleanUp = (page) => page.evaluate(() => { try { window.markDocumentClean?.(); } catch {} }).catch(() => {});

// ---------------------------------------------------------------------------------------------------------------------
console.log('--- #22 the four choices survive saving and a reload ---');
if (on('persist')) {
  const ctx = await newCtx(EDITOR_SET());
  const page = await openEditor(ctx, 'persist');
  for (const type of ['hid', 'ble', 'network', 'serial', 'hid']) {
    const stored = await page.evaluate(async (v) => {
      const sel = document.getElementById('set-connectionType');
      sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      return JSON.parse(localStorage.getItem('emboss-settings') || '{}').connectionType;
    }, type);
    ok(`${type}: the value saved in the settings is ${type} (it used to become serial)`, stored === type, stored);
    await page.evaluate(() => window.markDocumentClean());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await sleep(800);
    const shown = await page.evaluate(() => document.getElementById('set-connectionType').value);
    ok(`${type}: after a reload the list still shows ${type}`, shown === type, shown);
  }
  // the matching explanation group shows for each
  const groups = await page.evaluate(async () => {
    const out = {};
    for (const v of ['serial', 'hid', 'ble', 'network']) {
      const sel = document.getElementById('set-connectionType'); sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const vis = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
      out[v] = { net: vis('networkSettingsGroup'), baud: vis('serialBaudGroup'), hid: vis('hidSettingsGroup'), ble: vis('bleSettingsGroup') };
    }
    return out;
  });
  ok('the baud-rate field shows for serial only; each of the other choices shows its own help text', JSON.stringify(groups) === JSON.stringify({
    serial: { net: false, baud: true, hid: false, ble: false }, hid: { net: false, baud: false, hid: true, ble: false },
    ble: { net: false, baud: false, hid: false, ble: true }, network: { net: true, baud: false, hid: false, ble: false } }), groups);
  await cleanUp(page);
  await ctx.close();
}

if (CHROMIUM) {
  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- #22 the Emboss button sends the BRF bytes with the sender that matches the choice ---');
  if (on('send')) for (const [type, kind, call, padded] of [['serial', 'serial', 'serial.requestPort', false], ['hid', 'hid', 'hid.requestDevice', true], ['ble', 'ble', 'ble.requestDevice', false]]) {
    const ctx = await newCtx(EDITOR_SET({ connectionType: type }));
    const page = await openEditor(ctx, `send-${type}`);
    await setDoc(page, 'Hello embosser ' + type + '.');
    await clickEmboss(page);
    const done = await waitStatus(page, /Sent \d+ bytes/);
    const h = await hw(page);
    const want = await expectedStream(page);
    ok(`${type}: Emboss ends with a "Sent N bytes" message`, done, await statusText(page));
    ok(`${type}: the chooser was asked once, by the matching API`, h.calls.filter((c) => c.kind === call).length === 1, h.calls);
    ok(`${type}: the bytes sent are the document's BRF, prepared for the embosser`, want.length > 20 && sameBytes(flat(h.written[kind]), want, padded), { sent: flat(h.written[kind]).length, want: want.length });
    ok(`${type}: nothing went to the other senders`, ['serial', 'hid', 'ble', 'usb'].filter((k) => k !== kind).every((k) => h.written[k].length === 0), h.written);
    ok(`${type}: the result is announced to screen readers`, await announcedHas(page, /Sent \d+ bytes/), await announced(page));
    await cleanUp(page);
    await ctx.close();
  }

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- #22 a browser without the API: the choice is disabled with its reason, and Emboss says nothing was sent ---');
  if (on('none')) {
    const ctx = await newCtx(EDITOR_SET({ connectionType: 'hid' }), { none: true });
    const page = await openEditor(ctx, 'none');
    const opts = await page.evaluate(() => Object.fromEntries([...document.getElementById('set-connectionType').options].map((o) => [o.value, { disabled: o.disabled, text: o.textContent }])));
    ok('serial, hid and ble are disabled; network is not', opts.serial.disabled && opts.hid.disabled && opts.ble.disabled && !opts.network.disabled, opts);
    ok('each disabled choice carries "Not available in this browser — use Chrome or Edge"', ['serial', 'hid', 'ble'].every((k) => opts[k].text.includes('Not available in this browser — use Chrome or Edge')), opts);
    ok('the network choice has no such note', !/Not available/.test(opts.network.text), opts.network);
    const hint = await page.evaluate(() => { const h = document.getElementById('connectionUnavailableHint'); return { shown: getComputedStyle(h).display !== 'none', text: h.textContent }; });
    ok('the saved choice (hid) is kept, and a line under the list says it is not available here', hint.shown && /not available in this browser/i.test(hint.text), hint);
    ok('... the saved value is still hid (nothing was changed behind the user\'s back)', await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings')).connectionType) === 'hid');
    await setDoc(page, 'Nothing can be sent.');
    await clickEmboss(page);
    ok('Emboss says plainly that nothing was sent and why', await waitStatus(page, /^Nothing was sent: USB HID embossing is not available in this browser — use Chrome or Edge\./), await statusText(page));
    ok('... and announces it', await announcedHas(page, /Nothing was sent: USB HID embossing is not available/), await announced(page));
    // each of the three
    for (const type of ['serial', 'ble']) {
      await page.evaluate(async (v) => { const sel = document.getElementById('set-connectionType'); sel.disabled = false; sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); }, type);
      await clickEmboss(page);
      const name = { serial: 'USB serial', ble: 'Bluetooth' }[type];
      ok(`${type}: "Nothing was sent: ${name} embossing is not available in this browser — use Chrome or Edge."`, await waitStatus(page, new RegExp(`^Nothing was sent: ${name} embossing is not available in this browser — use Chrome or Edge\\.`)), await statusText(page));
    }
    await cleanUp(page);
    await ctx.close();
  }

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- #22 a cancelled or refused chooser, a lost device, a failed write: plain messages, nothing thrown ---');
  const CANCEL = { serial: /^Embosser port selection was cancelled\. Nothing was sent\.$/, hid: /^HID device selection was cancelled\. Nothing was sent\.$/, ble: /^Bluetooth embosser selection was cancelled\. Nothing was sent\.$/ };
  const LOST = { serial: /^The USB serial embosser was disconnected while sending\. Check the cable or connection, switch the embosser on and try again\. The job may be partly printed\.$/, hid: /^The USB HID embosser was disconnected while sending\./, ble: /^The Bluetooth embosser was disconnected while sending\./ };
  if (on('fail')) for (const type of ['serial', 'hid', 'ble']) {
    const ctx = await newCtx(EDITOR_SET({ connectionType: type }));
    const page = await openEditor(ctx, `fail-${type}`);
    await setDoc(page, 'Failing ' + type + '.');
    await page.evaluate(() => { window.__hw.pick = 'cancel'; });
    await clickEmboss(page);
    ok(`${type}: a cancelled chooser: "...selection was cancelled. Nothing was sent."`, await waitStatus(page, CANCEL[type]), await statusText(page));
    ok(`${type}: ... nothing was written`, Object.values((await hw(page)).written).every((a) => a.length === 0));
    await page.evaluate(() => { window.__hw.pick = null; window.__hw.fail = 'write'; });
    await clickEmboss(page);
    ok(`${type}: a device lost while writing: "...was disconnected while sending..."`, await waitStatus(page, LOST[type]), await statusText(page));
    ok(`${type}: ... announced as well`, await announcedHas(page, /disconnected while sending/), await announced(page));
    if (type === 'ble') {
      await page.evaluate(() => { window.__hw.fail = 'connect'; });
      await clickEmboss(page);
      ok('ble: a connection that fails: "...could not be opened (Could not connect to Mock BLE: Connection attempt failed)..."', await waitStatus(page, /^The Bluetooth embosser could not be opened \(Could not connect to Mock BLE: Connection attempt failed\)\./), await statusText(page));
    }
    if (type === 'serial') {
      await page.evaluate(() => { window.__hw.fail = null; window.__hw.pick = 'refuse'; });   // the browser has forgotten the click
      await clickEmboss(page);
      ok('serial: a chooser the browser refuses: "...Click Emboss again to choose the embosser."', await waitStatus(page, /^Nothing was sent: the browser did not allow the USB serial device chooser\. Click Emboss again to choose the embosser\.$/), await statusText(page));
    }
    await cleanUp(page);
    await ctx.close();
  }

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- S2-Q2 the device is asked for inside the click; the (slow) braille is waited for afterwards ---');
  if (on('q2')) for (const [type, kind, call, padded] of [['serial', 'serial', 'serial.requestPort', false], ['hid', 'hid', 'hid.requestDevice', true], ['ble', 'ble', 'ble.requestDevice', false]]) {
    const ctx = await newCtx(EDITOR_SET({ connectionType: type }));
    const page = await openEditor(ctx, `slow-${type}`);
    await setDoc(page, 'OLD document apple.');
    await page.evaluate(() => { window.__embossTestFormatDelay = 2500; window.__hw.maxAge = 1500; });   // the browser forgets the click after 1.5 s; the braille takes 2.5 s
    await page.evaluate(() => { window.modelToLexical({ blocks: [{ type: 'para', text: 'NEW document zebra.' }] }); document.getElementById('embossBtn').click(); });
    const done = await waitStatus(page, /Sent \d+ bytes|Nothing was sent|could not|did not allow/i, 30000);
    const h = await hw(page);
    const chooserCall = h.calls.find((c) => c.kind === call);
    const written = h.written[kind][0];
    const want = await expectedStream(page);
    ok(`${type}: the chooser was asked for at once (${chooserCall ? Math.round(chooserCall.sinceClick) : '-'} ms after the click), not after the wait`, !!chooserCall && chooserCall.sinceClick < 700, chooserCall);
    ok(`${type}: the chooser was not refused, so the braille was sent: "${(await statusText(page)).slice(0, 60)}"`, done && /Sent \d+ bytes/.test(await statusText(page)), await statusText(page));
    ok(`${type}: the sending began only after the braille was ready (about 2.5 s after the click)`, !!written && written.t - h.clickAt >= 2000, written && written.t - h.clickAt);
    ok(`${type}: what was sent is the braille of the NEW document`, sameBytes(flat(h.written[kind]), want, padded) && new TextDecoder().decode(new Uint8Array(want)).length > 5, { sent: flat(h.written[kind]).length, want: want.length });
    await cleanUp(page);
    await ctx.close();
  }
  if (on('q2')) {
    // a braille that cannot be made: the device was chosen, nothing is sent, and the usual "Nothing was sent to the embosser: ..." follows
    const ctx = await newCtx(EDITOR_SET({ connectionType: 'serial' }));
    const page = await openEditor(ctx, 'slow-fail');
    await setDoc(page, 'Will fail.');
    await page.evaluate(() => { window.__embossTestBreakBlock = () => true; window.modelToLexical({ blocks: [{ type: 'para', text: 'Will fail now.' }] }); document.getElementById('embossBtn').click(); });
    ok('a braille that cannot be made: "Nothing was sent to the embosser: ..." and no bytes', await waitStatus(page, /Nothing was sent to the embosser/, 30000) && (await hw(page)).written.serial.length === 0, await statusText(page));
    await cleanUp(page);
    await ctx.close();
  }

  // -------------------------------------------------------------------------------------------------------------------
  console.log('--- #22 the network choice still sends over HTTP; Quick Mode uses the same senders ---');
  if (on('net')) {
    const ctx = await newCtx(EDITOR_SET({ connectionType: 'network', networkHost: 'embosser.test', networkPort: 9100 }));
    const page = await openEditor(ctx, 'net');
    const posts = [];
    await page.route('http://embosser.test:9100/**', async (route) => {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
      posts.push((route.request().postDataBuffer() || Buffer.alloc(0)).toString('latin1'));
      return route.fulfill({ status: 200, headers: h, body: 'ok' });
    });
    await setDoc(page, 'Over the network.');
    await clickEmboss(page);
    await waitStatus(page, /Sent|Could not|rejected/);
    const h = await hw(page);
    ok('network: the BRF was posted and no device chooser was asked for', posts.length === 1 && posts[0].length > 10 && h.calls.length === 0, { posts: posts.length, calls: h.calls });
    await cleanUp(page);
    await ctx.close();
  }
  if (on('net')) {
    const ctx = await newCtx({ simpleMode: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', expertHardware: true, connectionType: 'hid' });
    const page = watch(await ctx.newPage(), 'quick-hid');
    await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => /^Ready/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
    await page.setInputFiles('#fileInput', { name: 'q.txt', mimeType: 'text/plain', buffer: Buffer.from('Quick mode to a HID embosser.') });
    await page.waitForFunction(() => !document.getElementById('result').hidden && (window.lastBrf || '').length > 0, null, { timeout: 30000 });
    // Changed 17 Oct 2026 (Paul, feedback item 9b): Quick Mode's Emboss button is now the Export menu's "Send to embosser" item (#downloadEmbossItem)
    await page.evaluate(() => document.getElementById('downloadEmbossItem').click());
    await page.waitForFunction(() => /Sent \d+ bytes/.test(document.getElementById('status').textContent), null, { timeout: 15000 }).catch(() => {});
    const h = await hw(page);
    ok('Quick Mode: a saved HID choice reaches the HID sender (it used to be serial)', h.calls.some((c) => c.kind === 'hid.requestDevice') && h.written.hid.length > 0 && h.written.serial.length === 0, { calls: h.calls, hid: h.written.hid.length });
    await ctx.close();
  }
} else {
  console.log(`  - ${ENGINE_LABEL}: the mocked-device cases need Chrome; the browser's own missing APIs are checked below`);
  const ctx = await newCtx(EDITOR_SET({ connectionType: 'hid' }));
  const page = await openEditor(ctx, 'native-none');
  const has = await page.evaluate(() => ({ serial: !!navigator.serial, hid: !!navigator.hid, bluetooth: !!navigator.bluetooth }));
  const opts = await page.evaluate(() => Object.fromEntries([...document.getElementById('set-connectionType').options].map((o) => [o.value, { disabled: o.disabled, text: o.textContent }])));
  ok(`${ENGINE_LABEL}: a choice whose API the browser lacks is disabled with the reason; a choice it has is not`, ['serial', 'hid', 'bluetooth'].every((k) => { const v = k === 'bluetooth' ? 'ble' : k; return has[k] ? !opts[v].disabled : (opts[v].disabled && opts[v].text.includes('Not available in this browser — use Chrome or Edge')); }) && !opts.network.disabled, { has, opts });
  await setDoc(page, 'No hardware here.');
  await clickEmboss(page);
  if (!has.hid) ok(`${ENGINE_LABEL}: Emboss says nothing was sent and why, without an error`, await waitStatus(page, /^Nothing was sent: USB HID embossing is not available in this browser/), await statusText(page));
  await cleanUp(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('--- #22 a beta build keeps the hardware controls hidden; ?tools=1 shows them ---');
if (on('beta')) {
  const shown = (page) => page.evaluate(() => ({ expert: document.body.classList.contains('expert-hardware'), emboss: getComputedStyle(document.getElementById('embossBtn')).display !== 'none' }));
  const ctx = await newCtx(EDITOR_SET({ connectionType: 'hid' }), { beta: true });
  const page = await openEditor(ctx, 'beta');
  let s = await shown(page);
  ok('beta: the Emboss button and the hardware controls are hidden even though the saved settings ask for them', !s.expert && !s.emboss, s);
  await page.goto(`${BASE}/web/editor/index.html?tools=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
  await sleep(1000);
  s = await shown(page);
  ok('beta with ?tools=1: they are shown', s.expert && s.emboss, s);
  await page.goto(`${BASE}/web/editor/index.html?tools=0`, { waitUntil: 'load' });
  await sleep(500);
  await cleanUp(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('--- S2-Q3 leaving a picture description without a real change does not mark the document unsaved ---');
if (on('q3')) {
  const ctx = await newCtx(EDITOR_SET({ expertHardware: false }));
  const page = await openEditor(ctx, 'alt');
  const load = async () => {
    await page.evaluate(async (src) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Before the picture.' }, { type: 'graphic', src, alt: 'A cat' }, { type: 'para', text: 'After it.' }] }); await window.render(); }, PNG);
    await sleep(600);
    await page.evaluate(() => window.markDocumentClean());
  };
  const dirty = () => page.evaluate(() => window.isDocumentDirty());
  const box = '#editor .doc-image-block textarea.doc-image-alt';
  await load();
  ok('setup: a saved document is clean', !(await dirty()));
  await page.click(box); await page.keyboard.press('Tab'); await sleep(400);
  ok('S2-Q3: entering the box and leaving it, nothing typed: still saved', !(await dirty()));
  await page.click(box); await page.keyboard.press('End'); await page.keyboard.type('x'); await page.keyboard.press('Backspace');
  ok('S2-Q3: a letter typed and deleted (the text is as it was) is not a change, even while the box has the focus', !(await dirty()));
  await page.keyboard.press('Tab'); await sleep(400);
  ok('S2-Q3: ... nor after leaving the box', !(await dirty()));
  await page.click(box); await page.keyboard.press('End'); await page.keyboard.type(' '); await page.keyboard.press('Tab'); await sleep(400);
  ok('S2-Q3: a space added at the end (the stored description is the same once tidied) is not a change', !(await dirty()));
  await page.click(box); await page.keyboard.press('End'); await page.keyboard.type('s');
  ok('a real change ("A cats") is unsaved while it is being typed', await dirty());
  await page.keyboard.press('Tab'); await sleep(400);
  ok('... and after leaving the box', await dirty());
  // typing back to the stored text after a real change: clean again once the box is left
  await page.click(box); await page.keyboard.press('End'); await page.keyboard.press('Backspace'); await page.keyboard.press('Tab'); await sleep(400);
  ok('... and back to the stored text, the undo-style comparison finds it saved again', !(await dirty()));

  // a description saved while it was being typed (the save reads the draft, S2a #5): leaving the box afterwards is not a change
  await load();
  await page.click(box); await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('A dog in a hat');
  ok('setup: a description is being typed (unsaved)', await dirty());
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.evaluate(() => document.getElementById('saveDocBtn').click())]);   // click() keeps the focus in the box
  const saved = (await readFile(await dl.path())).toString('utf8');
  ok('setup: the file saved holds the description as it was typed', saved.includes('A dog in a hat'), saved.slice(saved.indexOf('<img'), saved.indexOf('<img') + 120));
  ok('after the save the document is saved', !(await dirty()));
  await page.keyboard.press('Tab'); await sleep(500);
  ok('S2-Q3: leaving the box after that save does not mark the document unsaved', !(await dirty()));
  ok('... and the description is in the document', await page.evaluate(() => /A dog in a hat/.test(window.exportCurrentDocumentXml())));
  await cleanUp(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('--- S2B-Q2 Download package: a refusal is shown and announced; nothing is downloaded ---');
if (on('q2b')) {
  const ctx = await newCtx(EDITOR_SET({ expertHardware: false, transcriberTools: true }));
  const page = await openEditor(ctx, 'pkg');
  await setDoc(page, 'A package.');
  // a package that is made correctly downloads (the control)
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.evaluate(() => document.getElementById('downloadPackageItem').click())]);
  ok('control: a normal package downloads as a .zip', /\.zip$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  // the builder's own refusal (a duplicate file name), reached through the tests-only hook
  await setDoc(page, 'A package that is refused.');
  await page.evaluate(() => { window.__embossTestPackageFiles = (files) => [...files, { name: files[0].name, data: new Uint8Array([1]) }]; });
  let got = null;
  const h = (d) => { got = d.suggestedFilename(); };
  page.on('download', h);
  await page.evaluate(() => document.getElementById('downloadPackageItem').click());
  await sleep(1200);
  page.off('download', h);
  const st = await statusText(page);
  ok('S2B-Q2: the status line carries the builder\'s message', /The package cannot be saved: it would contain a duplicate file name/.test(st) && /The file was not written\./.test(st), st);
  ok('S2B-Q2: ... it is announced', await announcedHas(page, /duplicate file name/), await announced(page));
  ok('S2B-Q2: nothing was downloaded', got === null, got);
  ok('S2B-Q2: the document is still unsaved (the failed package was not its save)', await page.evaluate(() => window.isDocumentDirty()));
  // an unsafe path too
  await page.evaluate(() => { window.__embossTestPackageFiles = (files) => [{ name: '../escape.xml', data: new Uint8Array([1]) }, ...files]; document.getElementById('downloadPackageItem').click(); });
  await sleep(600);
  ok('S2B-Q2: an unsafe path is refused the same way', /unsafe path/.test(await statusText(page)), await statusText(page));
  await page.evaluate(() => { delete window.__embossTestPackageFiles; });
  await cleanUp(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('--- S2B-Q1 Quick Mode shows the import\'s own warnings ---');
if (on('q1b')) {
  // a tiny stored-only zip writer, and an EPUB whose second chapter is missing from the archive
  const crcOf = (u8) => zlib.crc32(u8) >>> 0;
  const zipOf = (entries) => {
    const parts = [], central = []; let offset = 0;
    for (const e of entries) {
      const name = Buffer.from(e.name), data = Buffer.from(e.data), crc = crcOf(data);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
      parts.push(lh, name, data); central.push(Buffer.concat([ch, name])); offset += 30 + name.length + data.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cd, end]);
  };
  const xhtml = (body) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
  const epub = (withB) => zipOf([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/book.opf', data: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Gappy book</dc:title><dc:language>en</dc:language><dc:identifier id="id">x</dc:identifier></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>' },
    { name: 'OEBPS/a.xhtml', data: xhtml('<p>Chapter A text</p>') },
    ...(withB ? [{ name: 'OEBPS/b.xhtml', data: xhtml('<p>Chapter B text</p>') }] : []),
  ]);
  const ctx = await newCtx({ simpleMode: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' });
  const page = watch(await ctx.newPage(), 'quick-notice');
  await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => /^Ready/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 60000 });
  const notice = () => page.evaluate(() => { const n = document.getElementById('importNotice'); return n ? { hidden: n.hidden, text: n.textContent.replace(/\s+/g, ' ').trim(), role: n.getAttribute('role'), live: n.getAttribute('aria-live'), shown: !n.hidden && getComputedStyle(n).display !== 'none' } : null; });
  const choose = (name, buffer, type) => page.setInputFiles('#fileInput', { name, mimeType: type, buffer });
  const ready = (name) => page.waitForFunction((n) => !document.getElementById('result').hidden && document.getElementById('fileName').textContent === n, name, { timeout: 30000 });
  let n0 = await notice();
  ok('there is a notice area, hidden before any file', !!n0 && n0.hidden && !n0.shown, n0);
  await choose('gappy.epub', epub(false), 'application/epub+zip'); await ready('gappy.epub');
  let n = await notice();
  ok('S2B-Q1: an EPUB with a chapter missing shows a notice that names it', n && n.shown && /^Notice: .*b\.xhtml/.test(n.text), n);
  ok('S2B-Q1: ... as a polite live region', n && n.role === 'status' && n.live === 'polite', n);
  ok('S2B-Q1: ... and the readable chapter is still brailled', await page.evaluate(() => (window.lastBrf || '').length > 0 && !!document.querySelector('#preview .brl-row')));
  await choose('whole.epub', epub(true), 'application/epub+zip'); await ready('whole.epub');
  n = await notice();
  ok('S2B-Q1: the next file (complete) clears it', n && !n.shown, n);
  await choose('gappy2.epub', epub(false), 'application/epub+zip'); await ready('gappy2.epub');
  n = await notice();
  ok('S2B-Q1: a damaged one shows it again', n && n.shown, n);
  await choose('plain.txt', Buffer.from('Just text.'), 'text/plain'); await ready('plain.txt');
  n = await notice();
  ok('S2B-Q1: a plain text file clears it', n && !n.shown, n);
  await choose('gappy3.epub', epub(false), 'application/epub+zip'); await ready('gappy3.epub');
  await page.click('#importNoticeDismiss');
  n = await notice();
  ok('S2B-Q1: the Dismiss button hides it', n && !n.shown, n);
  // a file that cannot be read at all leaves the previous document and its notice as they were
  await choose('gappy4.epub', epub(false), 'application/epub+zip'); await ready('gappy4.epub');
  await choose('bad.docx', Buffer.from('this is not really a word file at all, just text'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await page.waitForFunction(() => /damaged|incomplete|not a Word/i.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  n = await notice();
  ok('S2B-Q1: a file that cannot be read at all keeps the previous document and its notice', n && n.shown && /b\.xhtml/.test(n.text), n);
  await ctx.close();
}

console.log(`\n${ENGINE_LABEL}: ${pass} passed, ${failures.length} failed`);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
process.exit(failures.length ? 1 : 0);
