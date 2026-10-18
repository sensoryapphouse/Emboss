// Audit batch S3c, item 22 (ChatGPT audit 15 Oct 2026, Emboss/docs/chatgpt-audit-15oct.md; Paul: build all four connection choices
// properly) and S2-Q2 (Paul, 15 Oct: ask for the port / device FIRST, inside the click, then wait for the braille, then send).
//
// The pure half, in Node with every device API mocked (no hardware is touched):
//   - Settings keep each of the four connection choices (serial, hid, ble, network) through sanitising; anything else is serial.
//   - connectionSupport says no, with a short reason, when the browser lacks the API (Safari / Firefox: no WebSerial, WebHID, Web Bluetooth).
//   - chooseEmbosserTarget asks for the device at once (before anything slow) and sendToEmbosserTarget sends the BRF bytes with the
//     sender that matches the choice; a cancelled chooser, a lost device and a failed write each give a plain message and never throw.
// The page half (select -> save -> reload -> the Emboss button) is tests/test-s3c-hardware.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, CONNECTION_TYPES as SETTINGS_TYPES } from '../web/settings.mjs';
import {
  CONNECTION_TYPES, connectionSupport, chooseEmbosserTarget, sendToEmbosserTarget, describeEmbosserError, prepareEmbosserStream, BLE_GATT_SERVICES,
} from '../format/spooler.mjs';

const BRF = ',hello ,world\n';
const OPTS = { embosser: 'generic', duplex: 'double', width: 38, depth: 25, baudRate: 9600 };
const expectedBytes = () => new TextEncoder().encode(prepareEmbosserStream(BRF, OPTS));
const setNavigator = (nav) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
const dom = (name, message = name) => { const e = new Error(message); e.name = name; return e; };
const concat = (chunks) => { const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };

// ---- mocks ----
function serialMock({ ports = [], pick = 'port', writeFails = false } = {}) {
  const log = { calls: [], written: [] };
  const port = {
    readable: null,
    open: async () => { log.calls.push('open'); },
    close: async () => { log.calls.push('close'); },
    writable: { getWriter: () => ({
      write: async (c) => { if (writeFails) throw dom('NetworkError', 'The device has been lost.'); log.written.push(new Uint8Array(c)); },
      releaseLock() {},
    }) },
  };
  return { log, port, api: {
    getPorts: async () => ports.map(() => port),
    requestPort: async () => { log.calls.push('requestPort'); if (pick === 'cancel') throw dom('NotFoundError', 'No port selected by the user.'); if (pick === 'refused') throw dom('SecurityError', 'Must be handling a user gesture to show a permission request.'); return port; },
  } };
}
function hidMock({ pick = 'device', sendFails = false } = {}) {
  const log = { calls: [], reports: [] };
  const device = { opened: false, productName: 'Mock HID', open: async function () { this.opened = true; log.calls.push('open'); }, close: async () => { log.calls.push('close'); },
    sendReport: async (id, data) => { if (sendFails) throw dom('NetworkError', 'Failed to write the report.'); log.reports.push(new Uint8Array(data)); } };
  return { log, api: { requestDevice: async () => { log.calls.push('requestDevice'); if (pick === 'cancel') throw dom('NotFoundError', 'No device selected.'); if (pick === 'none') return []; if (pick === 'refused') throw dom('SecurityError', 'Must be handling a user gesture'); return [device]; } } };
}
function bleMock({ pick = 'device', writeFails = false, connectFails = false } = {}) {
  const log = { calls: [], written: [] };
  const rx = { writeValueWithoutResponse: async (c) => { if (writeFails) throw dom('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.'); log.written.push(new Uint8Array(c)); } };
  const service = { getCharacteristic: async (uuid) => { if (uuid === BLE_GATT_SERVICES.NORDIC_RX) return rx; throw dom('NotFoundError', 'no characteristic'); } };
  const server = { getPrimaryService: async (uuid) => { if (uuid === BLE_GATT_SERVICES.NORDIC_UART_SERVICE) return service; throw dom('NotFoundError', 'no service'); } };
  const device = { name: 'Mock BLE', gatt: { connected: false, connect: async () => { if (connectFails) throw dom('NetworkError', 'Connection attempt failed.'); log.calls.push('connect'); return server; }, disconnect() {} } };
  return { log, api: { requestDevice: async () => { log.calls.push('requestDevice'); if (pick === 'cancel') throw dom('NotFoundError', 'User cancelled the requestDevice() chooser.'); return device; } } };
}
function usbMock() {
  const log = { calls: [], written: [] };
  const device = {
    configuration: null, configurations: [{ interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] }],
    open: async () => { log.calls.push('open'); }, selectConfiguration: async () => {}, claimInterface: async () => {}, releaseInterface: async () => {}, close: async () => {},
    transferOut: async (ep, c) => { log.written.push(new Uint8Array(c)); return { status: 'ok' }; },
  };
  return { log, api: { requestDevice: async () => { log.calls.push('requestDevice'); return device; } } };
}

test('settings keep all four connection choices; anything else is serial; the lists agree', () => {
  for (const type of ['serial', 'hid', 'ble', 'network']) assert.equal(sanitizeSettings({ connectionType: type }).connectionType, type, type);
  for (const bad of ['usb', '', null, undefined, 'BLE', 42]) assert.equal(sanitizeSettings({ connectionType: bad }).connectionType, 'serial', String(bad));
  assert.deepEqual([...SETTINGS_TYPES], [...CONNECTION_TYPES], 'settings.mjs and spooler.mjs list the same connection types');
});

test('connectionSupport: a browser without the API says so, briefly and in full', () => {
  setNavigator({});   // Safari / Firefox: none of WebSerial, WebUSB, WebHID, Web Bluetooth
  assert.equal(connectionSupport('network').ok, true);
  for (const type of ['serial', 'hid', 'ble']) {
    const s = connectionSupport(type);
    assert.equal(s.ok, false, type);
    assert.equal(s.short, 'Not available in this browser — use Chrome or Edge');
    assert.match(s.message, /^Nothing was sent: .* embossing is not available in this browser — use Chrome or Edge\./, type);
  }
  setNavigator({ hid: {} });
  assert.equal(connectionSupport('hid').ok, true);
  assert.equal(connectionSupport('ble').ok, false);
  setNavigator({ usb: {} });   // a browser with WebUSB only (Chrome on Android) can still take the serial choice
  assert.equal(connectionSupport('serial').ok, true);
});

test('serial: the port is asked for at once; the BRF bytes go to that port', async () => {
  const m = serialMock(); setNavigator({ serial: m.api });
  const choice = await chooseEmbosserTarget('serial', OPTS);
  assert.equal(choice.ok, true); assert.equal(choice.via, 'web-serial');
  assert.deepEqual(m.log.calls, ['requestPort'], 'chosen; nothing sent yet');
  const res = await sendToEmbosserTarget(BRF, choice, OPTS);
  assert.equal(res.success, true, JSON.stringify(res)); assert.equal(res.method, 'web-serial');
  assert.deepEqual([...concat(m.log.written)], [...expectedBytes()]);
  assert.deepEqual(m.log.calls, ['requestPort', 'open', 'close']);
});

test('serial: the one port already allowed is used without a chooser', async () => {
  const m = serialMock({ ports: [1] }); setNavigator({ serial: m.api });
  const choice = await chooseEmbosserTarget('serial', OPTS);
  assert.equal(choice.ok, true); assert.deepEqual(m.log.calls, [], 'no chooser');
});

test('serial: with no WebSerial but WebUSB, the USB device is chosen and sent to', async () => {
  const m = usbMock(); setNavigator({ usb: m.api });
  const choice = await chooseEmbosserTarget('serial', OPTS);
  assert.equal(choice.ok, true); assert.equal(choice.via, 'web-usb');
  const res = await sendToEmbosserTarget(BRF, choice, OPTS);
  assert.equal(res.success, true, JSON.stringify(res)); assert.equal(res.method, 'web-usb');
  assert.deepEqual([...concat(m.log.written)], [...expectedBytes()]);
});

test('hid: the device is asked for at once; the BRF bytes go out in reports to that device', async () => {
  const m = hidMock(); setNavigator({ hid: m.api });
  const choice = await chooseEmbosserTarget('hid', OPTS);
  assert.equal(choice.ok, true); assert.equal(choice.via, 'web-hid');
  assert.deepEqual(m.log.calls, ['requestDevice']);
  const res = await sendToEmbosserTarget(BRF, choice, OPTS);
  assert.equal(res.success, true, JSON.stringify(res)); assert.equal(res.method, 'web-hid');
  const want = expectedBytes(), got = concat(m.log.reports);
  assert.deepEqual([...got.subarray(0, want.length)], [...want]);
  assert.ok(got.subarray(want.length).every((b) => b === 0), 'the last report is padded with zeros');
});

test('ble: the device is asked for at once; the BRF bytes are written to its characteristic', async () => {
  const m = bleMock(); setNavigator({ bluetooth: m.api });
  const choice = await chooseEmbosserTarget('ble', OPTS);
  assert.equal(choice.ok, true); assert.equal(choice.via, 'web-bluetooth');
  assert.deepEqual(m.log.calls, ['requestDevice']);
  const res = await sendToEmbosserTarget(BRF, choice, OPTS);
  assert.equal(res.success, true, JSON.stringify(res)); assert.equal(res.method, 'web-bluetooth');
  assert.deepEqual([...concat(m.log.written)], [...expectedBytes()]);
});

test('a cancelled chooser is reported as cancelled, per connection type', async () => {
  setNavigator({ serial: serialMock({ pick: 'cancel' }).api });
  let c = await chooseEmbosserTarget('serial', OPTS);
  assert.deepEqual([c.ok, c.method, c.message], [false, 'cancelled', 'Embosser port selection was cancelled.']);
  setNavigator({ hid: hidMock({ pick: 'cancel' }).api });
  c = await chooseEmbosserTarget('hid', OPTS);
  assert.deepEqual([c.ok, c.method, c.message], [false, 'cancelled', 'HID device selection was cancelled.']);
  setNavigator({ hid: hidMock({ pick: 'none' }).api });
  c = await chooseEmbosserTarget('hid', OPTS);
  assert.deepEqual([c.ok, c.method, c.message], [false, 'cancelled', 'No HID embosser selected.']);
  setNavigator({ bluetooth: bleMock({ pick: 'cancel' }).api });
  c = await chooseEmbosserTarget('ble', OPTS);
  assert.deepEqual([c.ok, c.method, c.message], [false, 'cancelled', 'Bluetooth embosser selection was cancelled.']);
});

test('a chooser the browser refuses (no recent click) says what to do', async () => {
  setNavigator({ serial: serialMock({ pick: 'refused' }).api });
  const c = await chooseEmbosserTarget('serial', OPTS);
  assert.equal(c.ok, false); assert.equal(c.method, 'error');
  assert.match(c.message, /^Nothing was sent: the browser did not allow the USB serial device chooser\. Click Emboss again to choose the embosser\.$/);
});

test('an unsupported choice is refused before anything is asked, with the reason', async () => {
  setNavigator({});
  for (const type of ['serial', 'hid', 'ble']) {
    const c = await chooseEmbosserTarget(type, OPTS);
    assert.equal(c.ok, false, type); assert.equal(c.method, 'unsupported', type);
    assert.match(c.message, /not available in this browser — use Chrome or Edge/, type);
  }
});

test('a device lost or a write that fails while sending gives a plain message and does not throw', async () => {
  let m = serialMock({ writeFails: true }); setNavigator({ serial: m.api });
  let res = await sendToEmbosserTarget(BRF, await chooseEmbosserTarget('serial', OPTS), OPTS);
  assert.equal(res.success, false);
  assert.match(res.message, /^The USB serial embosser was disconnected while sending\. Check the cable or connection, switch the embosser on and try again\. The job may be partly printed\.$/);
  assert.ok(m.log.calls.includes('close'), 'the port is closed again');

  const h = hidMock({ sendFails: true }); setNavigator({ hid: h.api });
  res = await sendToEmbosserTarget(BRF, await chooseEmbosserTarget('hid', OPTS), OPTS);
  assert.equal(res.success, false); assert.match(res.message, /^The USB HID embosser was disconnected while sending\./);

  const b = bleMock({ writeFails: true }); setNavigator({ bluetooth: b.api });
  res = await sendToEmbosserTarget(BRF, await chooseEmbosserTarget('ble', OPTS), OPTS);
  assert.equal(res.success, false); assert.match(res.message, /^The Bluetooth embosser was disconnected while sending\./);

  const b2 = bleMock({ connectFails: true }); setNavigator({ bluetooth: b2.api });
  res = await sendToEmbosserTarget(BRF, await chooseEmbosserTarget('ble', OPTS), OPTS);
  assert.equal(res.success, false); assert.equal(res.message, 'The Bluetooth embosser could not be opened (Could not connect to Mock BLE: Connection attempt failed). Check that it is switched on and that no other program is using it.');

  // a port that will not open (Chrome: NetworkError "Failed to open serial port.") is not a lost device
  const m3 = serialMock(); m3.port.open = async () => { throw dom('NetworkError', 'Failed to open serial port.'); }; setNavigator({ serial: m3.api });
  res = await sendToEmbosserTarget(BRF, await chooseEmbosserTarget('serial', OPTS), OPTS);
  assert.equal(res.success, false); assert.match(res.message, /^The USB serial embosser could not be opened \(.*Failed to open serial port\)\. Check that it is switched on/);
});

test('describeEmbosserError: other failures keep the device\'s own words', () => {
  assert.equal(describeEmbosserError('hid', new Error('Access denied'), 'send'), 'The braille could not be sent over USB HID: Access denied. The job may be partly printed.');
  assert.equal(describeEmbosserError('ble', new Error('boom'), 'choose'), 'Nothing was sent: the Bluetooth device could not be chosen (boom).');
});

test('sendToEmbosserTarget refuses an empty job, and the messages go through the caller\'s translator', async () => {
  const r = await sendToEmbosserTarget('', { type: 'hid' }, OPTS);
  assert.equal(r.success, false); assert.equal(r.message, 'There is no braille to send.');
  setNavigator({});
  const seen = [];
  const c = await chooseEmbosserTarget('hid', { text: (key, params, fallback) => { seen.push(key); return `[${key}]`; } });
  assert.equal(c.message, '[app.spool.unavailable]'); assert.deepEqual(seen.slice(-1), ['app.spool.unavailable']);
});
